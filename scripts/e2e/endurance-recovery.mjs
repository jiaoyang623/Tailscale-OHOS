// E2E · 扩展进程非正常结束后的记录与恢复。
//
// 判据：O-DIAG-02（非用户原因的断连必须留下记录）、O-CONN-08（用户没有停止时恢复）。
//
// 通道：`hdc shell ps -ef` 找到扩展进程，`hdc shell -b <bundle> kill -9 <pid>`
// 以应用自己的身份结束本应用的一个进程。若该设备把扩展放在 UI 同一进程里，
// 本用例无法只杀扩展，显式 skip 并写明原因。
//
// 前置：设备已登录 Tailscale。
//
//   DEVICE=<序列号> node --test scripts/e2e/endurance-recovery.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, clickBottomTab, clickId, forceStop, layoutTexts, readAppFile,
  readLedgerEntries, serial, startApp
} from './lib/device.mjs';
import { createRun, deviceEnvironment } from './lib/steps.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `endurance-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let sessionBefore = '';

const run = createRun({
  suite: 'endurance-recovery',
  title: '扩展被杀后的记录与恢复',
  command: `DEVICE=${process.env.DEVICE || '<序列号>'} node --test scripts/e2e/endurance-recovery.mjs`,
  environment: deviceEnvironment(),
  notice: '结束进程需要设备 shell 向应用进程发信号的权限。没有该权限时用例按原因跳过。'
});
// The ledger persists across runs. Only entries appended by this run can judge
// this run; an old user stop from an earlier session must not fail the case.
let ledgerBaseline = 0;

function shows(text) {
  try {
    return layoutTexts().some((line) => line.includes(text));
  } catch (_error) {
    return false;
  }
}

function statusFile() {
  return readAppFile('vpn-probe-status.txt');
}

function sessionIdOf(text) {
  const found = /sessionId=([A-Za-z0-9_-]+)/.exec(text);
  return found === null ? '' : found[1];
}

function ledgerEntries() {
  return readLedgerEntries();
}

// 只认命令列里带 vpn 的那个进程。扩展与界面共用一个进程时，ps 行里看不出
// 两者，宁可跳过，也不能凭「最后一行」去猜：猜错就杀掉界面进程，本用例
// 证明了别的东西。
function extensionPids() {
  let text = '';
  try {
    text = execFileSync(HDC, ['-t', serial(), 'shell', 'ps', '-ef'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_error) {
    return [];
  }
  const pids = [];
  for (const line of text.split('\n')) {
    if (!line.includes(BUNDLE) || line.includes('ps -ef') || !/vpn/i.test(line)) {
      continue;
    }
    const match = line.match(/^\S+\s+(\d+)\s+(\d+)/);
    if (match !== null) {
      pids.push({ pid: Number(match[1]), ppid: Number(match[2]), line: line.trim() });
    }
  }
  return pids;
}

function killAsApp(pid) {
  try {
    // `hdc shell` exits 0 even when the kill is denied, so read the command's
    // own status word instead of the process exit code.
    const text = execFileSync(HDC, ['-t', serial(), 'shell', '-b', BUNDLE,
      `kill -9 ${pid}; echo rc=$?`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /rc=0/.test(text);
  } catch (_error) {
    return false;
  }
}

function processGone(pid) {
  let text = '';
  try {
    text = execFileSync(HDC, ['-t', serial(), 'shell', 'ps', '-ef'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_error) {
    return false;
  }
  return !text.split('\n').some((line) => new RegExp(`\\s${pid}\\s`).test(line));
}

before(async () => {
  log.start();
  await pause(4000);
  forceStop();
  await pause(2500);
  startApp();
  assert.ok(await log.waitFor(/MeshArcDiag: ui ui_opened/, 40000),
    '启动后没有出现 ui_opened，应用没有走到界面');
  await pause(9000);
  configured = shows('未连接') || shows('已连接');
  if (!configured) {
    // 应用恢复了上次的页签。连接状态只在「设备」页。
    clickBottomTab('设备');
    await pause(3000);
    configured = shows('未连接') || shows('已连接');
  }
  if (!configured) {
    return;
  }
  if (!shows('已连接')) {
    clickId('vpn-connect');
    assert.ok(await log.waitFor(/vpn_connected/, 90000), '连不上，后面的恢复测试没有意义');
  }
  // Give the supervisor one sampling round with a connected reading.
  await pause(10000);
  sessionBefore = sessionIdOf(statusFile());
  ledgerBaseline = ledgerEntries().length;
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  const written = run.write();
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
  console.log(`结构化运行日志：${written}`);
});

test('扩展被杀后自动恢复并留下原因记录', { timeout: 240000 }, async (t) => {
  const caseId = 'ENDURANCE-RECOVERY';
  const title = '扩展被杀后自动恢复并留下原因记录';
  const oracleIds = ['O-DIAG-02', 'O-CONN-08'];
  if (!configured) {
    run.case(caseId, title, oracleIds).skip('这台设备还没登录 Tailscale，本用例不适用。');
    t.skip('这台设备还没登录 Tailscale，本用例不适用。');
    return;
  }
  const record = run.case(caseId, title, oracleIds);
  const find = record.step({
    id: 'S1', name: '定位扩展进程', operation: 'hdc shell ps -ef 并筛选带 vpn 的应用进程',
    expected: ['只有一个带 vpn 的应用进程', '状态文件带 sessionId']
  });
  if (sessionBefore.length === 0) {
    const message = '状态文件没有 sessionId，无法区分恢复前后的会话';
    find.fail(message, run.output(message));
    record.fail(message);
    assert.fail(message);
  }
  const pids = extensionPids();
  if (pids.length !== 1) {
    const reason = pids.length === 0
      ? 'ps 输出里没有单独的扩展进程；扩展与界面同进程时不能只杀扩展。'
      : `看到 ${pids.length} 个带 vpn 的应用进程，无法确定哪一个属于本次会话。`;
    find.skip(reason, run.output(reason));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  find.pass(`扩展进程 ${pids[0].pid}，会话 ${sessionBefore}`, run.output(pids[0].line));

  const kill = record.step({
    id: 'S2', name: '结束扩展进程', operation: `以应用身份 kill -9 ${pids[0].pid}`,
    expected: ['kill 返回 rc=0', '该 PID 从进程表消失']
  });
  const mark = log.mark();
  const killed = killAsApp(pids[0].pid);
  if (!killed) {
    const reason = '结束扩展进程被拒绝：设备 shell 没有向应用进程发信号的权限。';
    kill.skip(reason, run.output(reason));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  await pause(2000);
  if (!processGone(pids[0].pid)) {
    const reason = `kill 报告成功，但进程 ${pids[0].pid} 仍在运行。`;
    kill.skip(reason, run.output(reason));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  kill.pass(`进程 ${pids[0].pid} 已结束`, run.output(`kill -9 ${pids[0].pid} → rc=0\nPID 已从 ps 输出消失`));

  const recover = record.step({
    id: 'S3', name: '等待自动恢复', operation: '等待设备日志出现恢复事件与新扩展',
    expected: ['出现 vpn_session_recovery_attempt', '出现 vpn_extension_created', '状态回到 Running']
  });
  try {
    assert.ok(await log.waitForAfter(mark, /vpn_session_recovery_attempt/, 120000),
      '扩展被杀后监督器没有发起恢复');
    assert.ok(await log.waitForAfter(mark, /vpn_extension_created/, 120000),
      '恢复请求发出后扩展没有重新拉起');
    await pause(12000);
    const status = statusFile();
    assert.match(status, /state=Running/, '恢复后状态文件没有回到 Running');
    assert.match(status, /tun=true/, '恢复后没有 TUN');
    const sessionAfter = sessionIdOf(status);
    assert.ok(sessionAfter.length > 0, '恢复后的状态文件没有新的 sessionId');
    assert.notEqual(sessionAfter, sessionBefore, '恢复后仍是旧会话，隧道没有真正重建');
    const killedShot = run.shot('endurance-recovery-killed', '操作后');
    const restoredShot = run.shot('endurance-recovery-restored', '结果');
    recover.pass(`新会话 ${sessionAfter}，state=Running，tun=true`, {
      kind: 'ui', screenshots: [killedShot, restoredShot]
    });

    const ledger = record.step({
      id: 'S4', name: '校验原因账本', operation: '读取会话账本（按写者分文件）的新增行',
      expected: ['旧会话有 end 或 observed 记录', '原因属于 extension_crash / extension_destroyed',
        '没有 user_stop']
    });
    const entries = ledgerEntries().slice(ledgerBaseline);
    const end = entries.find((entry) => entry.sessionId === sessionBefore && entry.kind === 'end');
    const observed = entries.find((entry) => entry.sessionId === sessionBefore &&
      entry.kind === 'observed');
    if (end === undefined && observed === undefined) {
      const message = '旧会话在账本里没有任何结束记录';
      ledger.fail(message, run.output(`${message}\n新增行：${JSON.stringify(entries)}`));
      record.fail(message);
      assert.fail(message);
    }
    const reason = end !== undefined ? end.reason : observed.reason;
    if (reason !== 'extension_crash' && reason !== 'extension_destroyed') {
      const message = `结束原因不是扩展异常或销毁：${reason}`;
      ledger.fail(message, run.output(`${message}\n新增行：${JSON.stringify(entries)}`));
      record.fail(message);
      assert.fail(message);
    }
    if (!entries.every((entry) => entry.reason !== 'user_stop')) {
      const message = '用户没有点停止，账本里却出现了 user_stop';
      ledger.fail(message, run.output(`${message}\n新增行：${JSON.stringify(entries)}`));
      record.fail(message);
      assert.fail(message);
    }
    ledger.pass(`旧会话 ${sessionBefore} 记录 ${reason}，没有 user_stop`,
      run.output(JSON.stringify(entries, null, 2)));
  } catch (error) {
    const message = String((error && error.message) || error);
    if (recover.status === 'skip') {
      recover.fail(message, run.output(message));
    }
    record.fail(message);
    throw error;
  }
});
