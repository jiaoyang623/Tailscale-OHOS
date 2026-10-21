// E2E · 安装重启后的意图恢复。
//
// 判据：O-CONN-08（用户没有停止时恢复）、O-DIAG-02（非用户原因的断连留下记录）、
// O-RECONN-02（意图驱动恢复）。
//
// 安装新 HAP 会结束应用与扩展进程，但不经过用户的停止入口，意图文件仍是
// connected。新进程启动后必须发现旧会话结束，记录原因，并按意图重建隧道。
//
// 前置：设备已登录 Tailscale，隧道处于 Running。
//
//   DEVICE=<序列号> HAP=<hap 路径> node --test scripts/e2e/install-restart-recovery.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, readAppFile, readLedgerEntries, serial, startApp
} from './lib/device.mjs';
import { createRun, deviceEnvironment } from './lib/steps.mjs';

const REPO = '/opt/git/github/mesharc';
const HAP = process.env.HAP ||
  join(REPO, 'entry/build/default/outputs/default/entry-default-signed.hap');
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `install-restart-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const steps = createRun({
  suite: 'install-restart-recovery',
  title: '安装重启后的意图恢复',
  command: `DEVICE=${process.env.DEVICE || '<序列号>'} HAP=${HAP} node --test scripts/e2e/install-restart-recovery.mjs`,
  environment: deviceEnvironment(),
  notice: '安装由本用例执行。安装会结束应用进程，应用数据保留。'
});

function hdc(args) {
  return execFileSync(HDC, ['-t', serial(), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function sessionIdOf(text) {
  const found = /sessionId=([A-Za-z0-9_-]+)/.exec(text);
  return found === null ? '' : found[1];
}

function statusText() {
  return readAppFile('vpn-probe-status.txt');
}

function ledgerEntries() {
  return readLedgerEntries();
}

let sessionBefore = '';

before(() => {
  log.start();
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  const written = steps.write();
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
  console.log(`结构化运行日志：${written}`);
});

test('安装重启后按意图恢复隧道', { timeout: 240000 }, async (t) => {
  const caseId = 'INSTALL-RESTART';
  const title = '安装重启后按意图恢复隧道';
  const oracleIds = ['O-CONN-08', 'O-DIAG-02', 'O-RECONN-02'];
  if (!existsSync(HAP)) {
    const reason = `找不到 HAP：${HAP}`;
    steps.case(caseId, title, oracleIds).skip(reason);
    t.skip(reason);
    return;
  }
  const record = steps.case(caseId, title, oracleIds);

  const pre = record.step({
    id: 'S1', name: '确认安装前状态', operation: '读取状态文件与意图文件',
    expected: ['状态为 Running', '意图为 connected', '状态文件带 sessionId']
  });
  await pause(3000);
  const before = statusText();
  const intent = readAppFile('vpn-intent.json');
  sessionBefore = sessionIdOf(before);
  if (!/state=Running/.test(before) || !intent.includes('"desired":"connected"') ||
    sessionBefore.length === 0) {
    const reason = '安装前隧道不在 Running，或意图不是 connected，本用例不适用。';
    pre.skip(reason, steps.output(`状态：${before.trim()}\n意图：${intent.trim()}`));
    record.skip(reason);
    t.skip(reason);
    return;
  }
  const ledgerBaseline = ledgerEntries().length;
  pre.pass(`会话 ${sessionBefore}，state=Running，意图 connected`,
    steps.output(`状态：${before.trim()}\n意图：${intent.trim()}`));

  const install = record.step({
    id: 'S2', name: '安装新 HAP', operation: `hdc install -r ${HAP}`,
    expected: ['安装成功', '应用与扩展进程被结束']
  });
  try {
    const output = hdc(['install', '-r', HAP]);
    assert.match(output, /install bundle successfully|AppMod finish/);
    install.pass('安装成功，应用数据保留', steps.output(output.trim()));
  } catch (error) {
    const message = String((error && error.message) || error);
    install.fail(message, steps.output(message));
    record.fail(message);
    throw error;
  }

  const restart = record.step({
    id: 'S3', name: '启动应用', operation: 'aa start -a EntryAbility',
    expected: ['启动成功', '设备日志出现 ui_opened']
  });
  try {
    startApp();
    assert.ok(await log.waitFor(/MeshArcDiag: ui ui_opened/, 60000),
      '启动后没有出现 ui_opened');
    const shot = steps.shot('install-restart-launched', '操作后');
    restart.pass('应用启动并显示界面', { kind: 'ui', screenshots: [shot] });
  } catch (error) {
    const message = String((error && error.message) || error);
    restart.fail(message, steps.output(message));
    record.fail(message);
    throw error;
  }

  const recover = record.step({
    id: 'S4', name: '等待记录与恢复', operation: '等待结束观测、恢复事件与新扩展',
    expected: ['出现 vpn_session_end_observed', '出现 vpn_session_recovery_attempt',
      '出现 vpn_session_recovery_started', '状态回到 Running 且 sessionId 改变']
  });
  try {
    assert.ok(await log.waitFor(/vpn_session_end_observed/, 120000),
      '新进程没有观测到旧会话结束');
    assert.ok(await log.waitFor(/vpn_session_recovery_attempt/, 120000),
      '监督器没有按意图发起恢复');
    assert.ok(await log.waitFor(/vpn_session_recovery_started/, 120000),
      '恢复没有进入 started');
    let status = '';
    const deadline = Date.now() + 120000;
    for (;;) {
      status = statusText();
      const current = sessionIdOf(status);
      if (/state=Running/.test(status) && current.length > 0 && current !== sessionBefore) {
        break;
      }
      if (Date.now() >= deadline) {
        break;
      }
      await pause(2000);
    }
    const sessionAfter = sessionIdOf(status);
    assert.match(status, /state=Running/, '恢复后状态文件没有回到 Running');
    assert.ok(sessionAfter.length > 0, '恢复后的状态文件没有 sessionId');
    assert.notEqual(sessionAfter, sessionBefore, '恢复后仍是旧会话');
    const shot = steps.shot('install-restart-recovered', '结果');
    recover.pass(`新会话 ${sessionAfter}，state=Running`, {
      kind: 'ui', screenshots: [shot]
    });

    const ledger = record.step({
      id: 'S5', name: '校验原因账本', operation: '读取会话账本（按写者分文件）',
      expected: ['旧会话有 observed 或 end 记录', '本次运行没有 user_stop']
    });
    const all = ledgerEntries();
    const old = all.filter((entry) => entry.sessionId === sessionBefore);
    const appended = all.slice(ledgerBaseline);
    if (!old.some((entry) => entry.kind === 'observed' || entry.kind === 'end')) {
      const message = '旧会话在账本里没有结束记录';
      ledger.fail(message, steps.output(JSON.stringify(all, null, 2)));
      record.fail(message);
      assert.fail(message);
    }
    if (appended.some((entry) => entry.reason === 'user_stop')) {
      const message = '用户没有点停止，本次账本却出现了 user_stop';
      ledger.fail(message, steps.output(JSON.stringify(appended, null, 2)));
      record.fail(message);
      assert.fail(message);
    }
    ledger.pass(`旧会话 ${sessionBefore} 已记录结束原因，本次没有 user_stop`,
      steps.output(JSON.stringify(old, null, 2)));
  } catch (error) {
    const message = String((error && error.message) || error);
    if (recover.status === 'skip') {
      recover.fail(message, steps.output(message));
    }
    record.fail(message);
    throw error;
  }
});