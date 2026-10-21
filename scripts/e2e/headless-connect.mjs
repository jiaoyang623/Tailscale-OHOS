// E2E · 无界面入口独立连接。兼作判据 O-CONN-07 的真机证据。
//
// 判据：O-CONN-07 无 UI 入口独立完成连接。
//
// 目标入口是设备桌面上的 MeshArc 卡片。卡片按钮 postCardAction(call) 唤醒
// EntryAbility.performCardToggle，用 VpnSessionController.connect 走与 UI 相同的文件协议，
// 并以 answerBackendHandoff 应答扩展的后端交接请求（EntryAbility.ets:202、
// VpnSessionController.ets:91 与 :167）。
//
// 本机无法自动触发这个入口，两类用例都写成显式 skip：
//   - 卡片挂在系统桌面，devecocli ui layout 只抓应用窗口树，抓不到卡片节点
//     （manual-checks M-12/M-14 未执行）。
//   - 主机侧也没有发送卡片 call 动作的命令。
//
// 前置：设备已登录 Tailscale。补上「发送卡片 call」的通道后，本节用例才可执行。
//
//   DEVICE=<序列号> node --test scripts/e2e/headless-connect.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LogStream, forceStop, layoutTexts, startApp } from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `headless-connect-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;

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
  configured = shows('未连接') || shows('已连接');
  if (!configured) {
    log.stop();
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

// 卡片必须在桌面上，且内置的 pending 文案与按钮可点。这两条本机看不全。
const CARD_REASON =
  '缺桌面卡片通道：卡片不在应用窗口树里（manual-checks M-12/M-14 未执行），主机也没有发送卡片 call 的命令。需要人工点卡片，或补一条发送卡片 call 的通道。';

test('无界面入口：卡片独立完成连接', (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先登录再跑。');
    return;
  }
  // 可执行时这里点卡片按钮（postCardAction call），再断言：
  //   - 日志出现 vpn_start_requested（VpnSessionController.ets:122）
  //   - vpn-probe-status.txt 进入 state=Running | tun=true
  //   - 无 UI 进程的 BridgeStatus 前台事件
  t.skip(CARD_REASON);
});

test('无界面入口：独立应答扩展的后端交接', (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  // 可执行时这里断言：
  //   - 日志出现 vpn_backend_handoff_stopped 或 vpn_backend_handoff_stop_failed
  //     （VpnSessionController.ets:187，无 UI 路径的应答点）
  //   - 不出现 vpn_backend_handoff_timeout
  //   - 断开时出现 vpn_stop_requested（VpnSessionController.ets:152）
  t.skip(CARD_REASON);
});
