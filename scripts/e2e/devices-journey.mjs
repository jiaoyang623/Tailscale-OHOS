// E2E · 设备列表与设备详情旅程。兼作 O-DEV-01 与 O-DEV-02 的真机证据。
//
// 从真实入口走到用户结果：冷启动 → 连上隧道 → 首页设备区 → 三态之一呈现 →
// 点某台对端 → 详情读取路径与服务 → 离线或未连接时降级。
//
// 这台设备所在的 tailnet 有多个对端，所以 O-DEV-02 走的是「对端在线」那一支。
// 对端的服务探测只在连接态发起，所以 before 里先把隧道连上，不靠上一个文件留下的状态。
//
//   DEVICE=<序列号> node --test scripts/e2e/devices-journey.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickAt, clickId, forceStop, layout, nodes, screenshot, scrollToId, startApp
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `devices-journey-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ready = false;
let connected = false;

// 界面节点。nodes() 由设备驱动层提供；分组标题这类节点没有 id，只能按文本找。

// 文案按 base 与 zh_CN 两套资源写。设备语言是哪种都能判。
function snapshot() {
  const all = nodes();
  const texts = all.map((node) => node.text).filter((line) => line.length > 0);
  const ids = all.map((node) => node.id).filter((id) => id.length > 0);
  return {
    texts,
    ids,
    has: (variants) => variants.some((line) => texts.includes(line)),
    hasId: (id) => ids.includes(id)
  };
}

function peerRowIds(state) {
  return state.ids.filter((id) => id.startsWith('home-peer-'));
}

before(async () => {
  log.start();
  await pause(4000);
  forceStop();
  await pause(2500);
  startApp();
  assert.ok(await log.waitFor(/MeshArcDiag: ui ui_opened/, 40000),
    '启动后没有出现 ui_opened，应用没有走到界面');
  // 等后端初始化落定。设备区要从加载态走到终态。
  await pause(9000);
  const state = snapshot();
  ready = state.has(['未连接', '已连接']) ||
    state.has(['登录以使用 Tailscale', 'Sign in to use Tailscale']);

  // 自己把隧道连上，不等上一个文件留下什么状态。
  // E2E 一个文件一个进程，但设备只有一台，状态在文件之间是留着的：
  // 排在前面的是 connect-journey 与 disconnect-journey，收尾都停在未连接。
  // 不连的话，对端的服务行按判据降级成「未连接」，探测不会发起，
  // 这一条就永远等不到 peer_service_refresh_start / peer_path_probe_start。
  if (ready && state.has(['未连接', 'Not connected'])) {
    clickId('vpn-connect');
    connected = Boolean(await log.waitFor(/vpn_connected/, 90000));
    await pause(4000);
  } else {
    connected = state.has(['已连接', 'Connected']);
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('设备列表在未登录与加载态下不显示空列表', (t) => {
  if (!ready) {
    t.skip('后端没有进入可判定状态，设备区旅程不适用。');
    return;
  }
  const state = snapshot();

  // 三态互斥渲染。见 BridgeStatus.ets:12437 的分支。
  // 加载面板与设备面板各有独立 id，落在首页。未登录面板没有 id，用「既不是加载也不是设备面板」判定。
  const loading = state.hasId('devices-loading');            // BridgeStatus.ets:10373
  const directory = state.hasId('home-device-directory');    // BridgeStatus.ets:10795
  assert.ok(!(loading && directory), '设备区同时渲染了加载面板与设备面板');
  const signedOut = state.has(['登录以使用 Tailscale', 'Sign in to use Tailscale']); // :10398

  if (loading) {
    // 加载态给出加载指示与说明，不是空列表。
    assert.ok(state.has(['初始化后端中', 'Initializing backend']), '加载面板没有加载指示与说明');
    return;
  }
  if (!directory) {
    // 未登录态给出不可用文案。文案本身即非空内容。
    assert.ok(signedOut, '设备区既没有加载面板也没有设备面板，也没有未登录文案');
    return;
  }

  // 已登录态：本机分组与本机行常驻。见 BridgeStatus.ets:10770、:10438。
  assert.ok(state.has(['本机', 'This device']), '已登录时没有「本机」分组标题');
  assert.ok(state.texts.some((line) => line.startsWith('HarmonyOS ')), '已登录时没有本机行');

  // 计数文案见 app.string.devices_count（zh_CN：「%d 台在线，共 %d 台」）。
  // 不要用 `peer-summary` 当锚点：那是一个高 1px、fontSize 1 的 Text('')，
  // 而且标了 accessibilityLevel('no')，布局导出里根本没有它（2026-10-13 实测）。
  assert.ok(state.texts.some((line) => /台在线，共\s*\d+\s*台/.test(line) || /online,/.test(line)),
    `已登录时没有设备区计数文案。界面文本：${JSON.stringify(state.texts)}`);

  // 边界：分组只在非空时渲染（BridgeStatus.ets:10773、:10783）。
  // 这台设备所在的 tailnet 有多个对端，所以走的是「有对端」那一支；
  // 零对端时在线与离线分组标题都不该出现，本机行仍在。
  if (peerRowIds(state).length === 0) {
    assert.ok(!state.has(['在线', 'Online']), '零对端时却渲染了「在线」分组标题');
    assert.ok(!state.has(['离线', 'Offline']), '零对端时却渲染了「离线」分组标题');
  }
});

test('打开设备详情读取服务与路径并在离线时降级', async (t) => {
  if (!ready) {
    t.skip('后端没有进入可判定状态，设备详情旅程不适用。');
    return;
  }
  const state = snapshot();
  if (state.has(['登录以使用 Tailscale', 'Sign in to use Tailscale'])) {
    t.skip('这台设备未登录 Tailscale，设备详情不适用。先登录再跑。');
    return;
  }
  const peers = peerRowIds(state);
  if (peers.length === 0) {
    t.skip('这台设备只有本机一个节点，点不出设备详情。需要一台同 tailnet 的对端设备。');
    return;
  }

  // 对端行的 id 见 BridgeStatus.ets:10618。点击走 openHomePeerDetails（:5287）。
  const point = await scrollToId(peers[0]);
  if (!point) {
    t.skip('找不到可点击的对端行，可能在页签栏之下。');
    return;
  }
  clickAt(point);
  await pause(4000);
  screenshot('devices-journey-detail');

  const sheet = snapshot();
  // 详情页有「可用服务」与「连接方式」两段。见 DeviceDetailSheet.ets:394、:487。
  assert.ok(sheet.has(['可用服务', 'Available services']), '详情页没有服务段标题');
  assert.ok(sheet.has(['连接方式', 'Connection path']), '详情页没有路径行');

  // 服务行标题固定。见 DeviceDetailSheet.ets:429-442。
  assert.ok(sheet.texts.includes('Taildrop'), '详情页没有 Taildrop 服务行');
  assert.ok(sheet.texts.includes('LocalSend'), '详情页没有 LocalSend 服务行');
  assert.ok(sheet.texts.includes('Taildrive'), '详情页没有 Taildrive 服务行');
  assert.ok(sheet.has(['影音服务', 'Media services']), '详情页没有影音服务行');

  // 路径行按 path.type 显示已知文案。见 DeviceDetailSheet.ets:222-242。
  const pathShown = sheet.texts.some((line) =>
    /直连|对端中继|DERP|当前不可达|尚未确认|离线|未连接/.test(line) ||
    /Direct ·|Peer relay|DERP relay|Unreachable|Not confirmed|Offline|Disconnected/.test(line));
  assert.ok(pathShown, `详情页路径行没有给出已知文案。界面文本：${JSON.stringify(sheet.texts)}`);

  // 服务行给出状态胶囊。降级态是「设备离线」「未连接」，不是报错。见 DeviceDetailSheet.ets:44-74。
  const stateShown = sheet.texts.some((line) =>
    ['可用', '不可用', '尚未确认', '设备离线', '未连接', '刷新中', '检测中'].includes(line) ||
    ['Available', 'Unavailable', 'Not confirmed', 'Device offline', 'Disconnected',
      'Refreshing', 'Checking'].includes(line));
  assert.ok(stateShown, `服务行没有给出状态胶囊文案。界面文本：${JSON.stringify(sheet.texts)}`);

  // 「设备离线」只由详情页发出（DeviceDetailSheet.ets:46）。它出现即所选对端离线。
  const peerOffline = sheet.has(['设备离线', 'Device offline']);
  const linkDown = sheet.has(['未连接', 'Disconnected']);
  if (!peerOffline && !linkDown) {
    // 对端在线且隧道连着时，打开详情会发起一次服务或路径探测。见 BridgeStatus.ets:5967、:6267。
    assert.ok(await log.waitFor(/peer_service_refresh_start|peer_path_probe_start|peer_path_result/, 20000),
      '在线对端打开详情后没有发起服务或路径探测');
  } else if (linkDown) {
    // 判据 O-DEV-02 的另一支：当前没连 VPN 时服务行降级成「未连接」，
    // 不发探测，也不报错。before 里没连上时走这里。
    assert.ok(!log.lines.some((line) => /peer_service_refresh_start/.test(line)),
      '隧道没连上却发起了服务探测，降级没有生效');
  }
});
