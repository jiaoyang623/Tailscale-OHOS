// E2E · 断网再恢复后的自动重连。兼作判据 O-NET-04 的真机证据。
//
// 判据：O-NET-04（网络恢复后自动恢复）、O-CONN-09（网络不通时等待回调）、
// O-RECONN-11（离线不消耗退避）。
//
// 通道：`hdc shell svc wifi disable` 断网，`svc wifi enable` 恢复。两条命令
// 都要求设备 shell 有足够权限。命令失败或网络没有真正断开时，本用例显式 skip，
// 不把「没法造条件」记成通过。
//
// 设备联网状态用 `ping` 判定，不看应用日志：应用日志只说明它怎么想。
//
// 前置：设备已登录 Tailscale，Wi-Fi 是唯一的数据通道。
//
//   DEVICE=<序列号> node --test scripts/e2e/network-recovery.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  HDC, LogStream, clickBottomTab, clickId, forceStop, layoutTexts, readAppFile,
  readLedgerEntries, serial, startApp
} from './lib/device.mjs';
import { createRun, deviceEnvironment } from './lib/steps.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `network-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
// The ledger persists across runs. Judge only the entries this run appends.
let ledgerBaseline = 0;

const steps = createRun({
  suite: 'network-recovery',
  title: '断网再恢复后的自动重连',
  command: `DEVICE=${process.env.DEVICE || '<序列号>'} node --test scripts/e2e/network-recovery.mjs`,
  environment: deviceEnvironment(),
  notice: 'Wi-Fi 是唯一数据通道时才能造出断网。设备仍有其它通道时用例按原因跳过。'
});

function run(command) {
  try {
    execFileSync(HDC, ['-t', serial(), 'shell', command],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (_error) {
    return false;
  }
}

// 设备能不能上公网。ping 通即算在线；不走 DNS，排除域名解析的干扰。
function online() {
  return run('ping -c 1 -W 2 1.1.1.1');
}

function shows(text) {
  try {
    return layoutTexts().some((line) => line.includes(text));
  } catch (_error) {
    return false;
  }
}

function statusText() {
  return readAppFile('vpn-probe-status.txt');
}

function running() {
  return /state=Running/.test(statusText());
}

function sessionIdOf(text) {
  const found = /sessionId=([A-Za-z0-9_-]+)/.exec(text);
  return found === null ? '' : found[1];
}

function userStopWritten() {
  return readAppFile('vpn-intent.json').includes('"desired":"stopped"');
}

function ledgerEntries() {
  return readLedgerEntries();
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await pause(1000);
  }
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
    assert.ok(await log.waitFor(/vpn_connected/, 90000), '连不上，后面的断网测试没有意义');
  }
  // 监督器每 5 s 采样一次，等它记下 connected 再断网。
  assert.ok(await waitFor(running, 30000), '状态文件没有进入 Running');
  await pause(10000);
  ledgerBaseline = ledgerEntries().length;
});

after(() => {
  // 无论用例怎么结束，都把网络还回去，避免影响后面的 E2E 文件。
  run('svc wifi enable');
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  const written = steps.write();
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
  console.log(`结构化运行日志：${written}`);
});

test('断网后恢复网络自动重连', { timeout: 420000 }, async (t) => {
  const caseId = 'NET-RECOVERY';
  const title = '断网后恢复网络自动重连';
  const oracleIds = ['O-NET-04', 'O-CONN-09', 'O-RECONN-11'];
  if (!configured) {
    steps.case(caseId, title, oracleIds).skip('这台设备还没登录 Tailscale，本用例不适用。');
    t.skip('这台设备还没登录 Tailscale，本用例不适用。');
    return;
  }
  const record = steps.case(caseId, title, oracleIds);

  const offlineStep = record.step({
    id: 'S1', name: '断开网络', operation: 'hdc shell svc wifi disable 并等待 ping 失败',
    expected: ['命令成功', '设备不再能访问 1.1.1.1']
  });
  if (!online()) {
    const reason = '断网前设备就不在线，无法判断断网是否成功。';
    offlineStep.skip(reason, steps.output(reason));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  const sessionBefore = sessionIdOf(statusText());
  if (sessionBefore.length === 0) {
    const message = '状态文件没有 sessionId，无法区分恢复前后的会话';
    offlineStep.fail(message, steps.output(message));
    record.fail(message);
    assert.fail(message);
  }

  const markOffline = log.mark();
  if (!run('svc wifi disable')) {
    const reason = '`svc wifi disable` 被拒绝：本机 shell 没有改网络的权限。';
    offlineStep.skip(reason, steps.output(reason));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  const wentOffline = await waitFor(() => !online(), 30000);
  if (!wentOffline) {
    const reason = '`svc wifi disable` 执行了但设备仍在线（可能还有蜂窝通道），无法造出断网。';
    offlineStep.skip(reason, steps.output(reason));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  const offlineShot = steps.shot('network-recovery-offline', '操作后');
  offlineStep.pass('svc wifi disable 后 ping 1.1.1.1 失败', {
    kind: 'ui', screenshots: [offlineShot]
  });

  // 两条路都接受，但都必须成立：
  // (a) 应用看到掉线时进入等待，不下结论；
  // (b) 应用保持 Running 时，断网期间不得超过 30 s 心跳规则去重连。
  const waitStep = record.step({
    id: 'S2', name: '检查断网期间的行为', operation: '观察恢复等待事件与状态文件',
    expected: ['掉线时记录一次 vpn_session_recovery_deferred', '不在断网期间发起恢复']
  });
  const sawDeferred = await waitFor(
    () => log.countAfter(markOffline, /vpn_session_recovery_deferred/) > 0, 60000);
  const dropped = await waitFor(() => !running(), 60000);
  try {
    if (dropped) {
      assert.ok(sawDeferred, '状态离开 Running，但监督器没有记录网络等待');
      assert.equal(log.countAfter(markOffline, /vpn_session_recovery_deferred/), 1,
        '一次断网记了多次网络等待，重复进入等待');
      waitStep.pass('状态离开 Running，监督器记录一次网络等待', steps.output(
        'vpn_session_recovery_deferred 1 次；状态离开 Running'));
    } else {
      assert.equal(log.countAfter(markOffline, /vpn_session_recovery_attempt/), 0,
        '隧道一直 Running，监督器却发起了重复恢复');
      waitStep.pass('隧道保持 Running，断网期间没有重复恢复', steps.output(
        'vpn_session_recovery_attempt 0 次；状态保持 Running'));
    }
  } catch (error) {
    const message = String((error && error.message) || error);
    waitStep.fail(message, steps.output(message));
    record.fail(message);
    throw error;
  }

  const onlineStep = record.step({
    id: 'S3', name: '恢复网络', operation: 'hdc shell svc wifi enable 并等待 ping 成功',
    expected: ['命令成功', '设备重新访问 1.1.1.1']
  });
  const markOnline = log.mark();
  if (!run('svc wifi enable')) {
    const message = '`svc wifi enable` 失败，网络没有恢复';
    onlineStep.fail(message, steps.output(message));
    record.fail(message);
    assert.fail(message);
  }
  assert.ok(await waitFor(online, 90000), '网络没有恢复，后续断言没有意义');
  onlineStep.pass('svc wifi enable 后 ping 1.1.1.1 成功', steps.output('ping -c 1 -W 2 1.1.1.1 → 成功'));

  const result = record.step({
    id: 'S4', name: '校验恢复结果', operation: '读取状态文件、设备日志与意图文件',
    expected: ['网络恢复后隧道回到 Running', '新会话 ID 与旧会话不同',
      '出现 vpn_session_recovered', '意图仍为 connected']
  });
  try {
    if (dropped) {
      assert.ok(await log.waitForAfter(markOnline, /vpn_session_recovery_attempt/, 120000),
        '网络恢复后监督器没有发起恢复');
      assert.ok(await waitFor(running, 120000), '网络恢复后状态文件没有回到 Running');
      const sessionAfter = sessionIdOf(statusText());
      assert.ok(sessionAfter.length > 0, '恢复后的状态文件没有 sessionId');
      assert.notEqual(sessionAfter, sessionBefore, '网络恢复后仍是旧会话，隧道没有真正重建');
      assert.ok(await log.waitForAfter(markOnline, /vpn_session_recovered/, 150000),
        '恢复后没有在稳定窗口结束时记录 vpn_session_recovered');
      const restoredShot = steps.shot('network-recovery-restored', '结果');
      result.pass(`新会话 ${sessionAfter}，state=Running，已记录 vpn_session_recovered`, {
        kind: 'ui', screenshots: [offlineShot, restoredShot]
      });
    } else {
      assert.equal(log.countAfter(markOffline, /vpn_session_recovery_attempt/), 0,
        '隧道一直 Running，监督器却发起了重复恢复');
      assert.ok(await waitFor(running, 30000), '网络恢复后状态文件没有保持 Running');
      const restoredShot = steps.shot('network-recovery-restored', '结果');
      result.pass('隧道全程保持 Running，没有重复恢复', {
        kind: 'ui', screenshots: [offlineShot, restoredShot]
      });
    }

    assert.ok(!userStopWritten(), '用户没有点停止，意图文件却写成了 stopped');
    const ledger = ledgerEntries().slice(ledgerBaseline);
    assert.ok(!ledger.some((entry) => entry.reason === 'user_stop'),
      '用户没有点停止，本次运行的账本里却出现了 user_stop');
    record.step({
      id: 'S5', name: '校验意图与账本', operation: '读取 vpn-intent.json 与本次账本新增行',
      expected: ['意图仍为 connected', '本次账本没有 user_stop']
    }).pass('意图仍为 connected，本次账本没有 user_stop', steps.output(
      `意图：${readAppFile('vpn-intent.json').trim()}\n新增账本行：${JSON.stringify(ledger)}`));
  } catch (error) {
    const message = String((error && error.message) || error);
    if (result.status === 'skip') {
      result.fail(message, steps.output(message));
    }
    record.fail(message);
    throw error;
  }
});