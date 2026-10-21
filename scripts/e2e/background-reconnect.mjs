// E2E · 后台非主动掉线的自动恢复。兼作判据 O-CONN-04 的真机证据。
//
// 判据：O-CONN-04 后台掉线自动恢复（非用户主动）。
//
// 判据有两条互相独立的要求：
//   (a) 非主动掉线（隧道曾在 connected 后掉到 disconnected，应用已切后台满 10 s，
//       且不是经本应用受控入口请求的断开）在后台自动重连；
//   (b) 用户的主动断开不得被自动恢复撤销。
//
// 本轮真机可以闭环 (b)：在应用前台点断开，意图先写成 stopped，监督器记
// vpn_drop_after_requested_stop 且不重连。前台掉线本身不再是「忽略」：
// 需求 R-CONN-11 要求用户没停止时立即恢复，所以 (a) 需要另造一次非主动掉线，
// 本文件目前只验证受控入口那一半。
//
// 前置：设备已登录 Tailscale。
//
//   DEVICE=<序列号> node --test scripts/e2e/background-reconnect.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickBottomTab, clickId, forceStop, layoutTexts, startApp
} from './lib/device.mjs';
import { createRun, deviceEnvironment } from './lib/steps.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `background-reconnect-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let launchEvidence = null;

const run = createRun({
  suite: 'background-reconnect',
  title: '后台重连与用户主动断开',
  command: `DEVICE=${process.env.DEVICE || '<序列号>'} node --test scripts/e2e/background-reconnect.mjs`,
  environment: deviceEnvironment(),
  notice: '用户主动断开在前台验证。后台非主动掉线缺制造通道，用例按原因跳过。'
});

function shows(text) {
  try {
    return layoutTexts().some((line) => line.includes(text));
  } catch (_error) {
    return false;
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
  await pause(8000);
  let texts = layoutTexts();
  if (!texts.some((line) => line.includes('未连接') || line.includes('已连接'))) {
    // 应用恢复了上次的页签。连接状态只在「设备」页。
    clickBottomTab('设备');
    await pause(3000);
    texts = layoutTexts();
  }
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
  if (!configured) {
    log.stop();
    return;
  }
  launchEvidence = run.shot('background-reconnect-launch', '操作后');
  if (shows('已连接')) {
    clickId('vpn-stop');
    await log.waitFor(/vpn_extension_destroyed/, 60000);
    await pause(4000);
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  const written = run.write();
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
  console.log(`结构化运行日志：${written}`);
});

test('重连监督：先连上隧道', async (t) => {
  if (!configured) {
    run.case('BG-CONNECT', '重连监督：先连上隧道', ['O-CONN-04']).skip('这台设备还没登录 Tailscale，本用例不适用。');
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先登录再跑。');
    return;
  }
  const record = run.case('BG-CONNECT', '重连监督：先连上隧道', ['O-CONN-04']);
  record.step({
    id: 'S1', name: '冷启动应用', operation: 'aa force-stop 后 aa start',
    expected: ['设备日志出现 ui_opened', '界面显示连接状态'],
    evidence: { kind: 'ui', screenshots: [launchEvidence] }
  }).pass('应用冷启动完成，界面显示连接状态', { kind: 'ui', screenshots: [launchEvidence] });

  const connect = record.step({
    id: 'S2', name: '建立隧道', operation: '界面处于未连接时点击连接按钮',
    expected: ['设备日志出现 vpn_connected', '监督器记录一轮 connected 采样']
  });
  try {
    const already = shows('已连接');
    if (!already) {
      clickId('vpn-connect');
      assert.ok(await log.waitFor(/vpn_connected/, 90000),
        '点了连接之后，设备日志里没有出现 vpn_connected');
    }
    // 监督器每 5 s 采样一次（EntryAbility.ets:251）。等够一轮，让它记下 connected。
    await pause(10000);
    const shot = run.shot('background-reconnect-connected', '结果');
    connect.pass(already ? '应用已处于已连接状态' : '点击连接后出现 vpn_connected，监督器已采样',
      { kind: 'ui', screenshots: [shot] });
  } catch (error) {
    const message = String((error && error.message) || error);
    connect.fail(message, { kind: 'log', output: message });
    record.fail(message);
    throw error;
  }
});

test('重连监督：前台主动断开记为用户停止且不重连', async (t) => {
  if (!configured) {
    run.case('BG-USER-STOP', '重连监督：前台主动断开记为用户停止且不重连', ['O-RECONN-10'])
      .skip('未登录，跳过');
    t.skip('未登录，跳过');
    return;
  }
  const record = run.case('BG-USER-STOP', '重连监督：前台主动断开记为用户停止且不重连',
    ['O-RECONN-10', 'O-SEAM-11']);
  const stop = record.step({
    id: 'S1', name: '前台点击断开', operation: '点击界面的断开按钮',
    expected: ['设备日志出现 vpn_drop_after_requested_stop', '界面回到未连接']
  });
  const quiet = record.step({
    id: 'S2', name: '确认没有自动重连', operation: '检索本次日志中的恢复事件',
    expected: ['不出现 vpn_session_recovery_attempt', '不出现 vpn_session_recovery_started']
  });
  try {
    clickId('vpn-stop');
    const stopped = await log.waitFor(/MeshArcDiag: ui vpn_drop_after_requested_stop/, 25000);
    const shot = run.shot('background-reconnect-foreground-drop', '结果');
    if (!stopped) {
      const message = '前台主动断开后没有出现 vpn_drop_after_requested_stop，意图没有被读到';
      stop.fail(message, { kind: 'ui', screenshots: [shot] });
      record.fail(message);
      assert.fail(message);
    }
    await pause(4000);
    const stillDisconnected = shows('未连接');
    if (stillDisconnected) {
      stop.pass('出现 vpn_drop_after_requested_stop，界面回到未连接',
        { kind: 'ui', screenshots: [shot] });
    } else {
      const message = '主动断开之后界面没有回到未连接';
      stop.fail(message, { kind: 'ui', screenshots: [shot] });
      record.fail(message);
      assert.fail(message);
    }
    const recovered = /vpn_session_recovery_attempt|vpn_session_recovery_started/
      .test(log.lines.join('\n'));
    if (recovered) {
      const message = '主动断开之后监督器仍发起了重连，用户的断开被撤销';
      quiet.fail(message, { kind: 'log', output: message });
      record.fail(message);
      assert.fail(message);
    }
    quiet.pass('日志中没有恢复事件', {
      kind: 'log',
      output: 'vpn_session_recovery_attempt 0 次，vpn_session_recovery_started 0 次'
    });
  } catch (error) {
    const message = String((error && error.message) || error);
    if (stop.status === 'skip') {
      stop.fail(message, { kind: 'log', output: message });
    }
    record.fail(message);
    throw error;
  }
});

test('重连监督：后台非主动掉线自动重连', async (t) => {
  // 主机侧没有命令制造一次「UI 进程仍活着而隧道掉到 disconnected」的掉线。
  // aa force-stop 会把 UI 与扩展一起杀掉，杀进程不发 onDestroy，状态文件停在旧值，
  // 被判成 UNKNOWN 而不是 disconnected。所以这条需要手动在系统设置里断开 VPN，
  // 或由另一条链路让扩展自己退出。
  const reason = '缺制造非主动掉线的能力：需要人工在系统设置里断开 VPN，'
    + '或一条只停扩展、不杀 UI 进程的通道。届时再补真机证据。';
  run.case('BG-BACKGROUND-DROP', '重连监督：后台非主动掉线自动重连', ['O-CONN-04']).skip(reason);
  t.skip(reason);
});

test('重连监督：受控入口的主动断开记 vpn_drop_after_requested_stop', async (t) => {
  // 受控入口是桌面卡片的 call 动作（EntryAbility.performCardToggle → noteRequestedStop）。
  // devecocli 只抓应用窗口树，卡片不在其中，主机也没有发送卡片 call 的命令。
  const reason = '缺桌面卡片通道：卡片不在应用窗口树里（manual-checks M-12/M-14 未执行），'
    + '需要人工点卡片或补一条发送卡片 call 的命令。';
  run.case('BG-CARD-STOP', '重连监督：受控入口的主动断开', ['O-RECONN-10']).skip(reason);
  t.skip(reason);
});
