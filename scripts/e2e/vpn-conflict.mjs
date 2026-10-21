// E2E · 连接与存活区的 VPN 冲突旅程。
//
// 覆盖一条判据：
//   O-CONN-05 另一个系统 VPN 占用时的冲突处理
//
// 前置：设备已登录 Tailscale，并且设备上装了另一个 VPN 应用，
// 该应用已配置并占住了系统 VPN 通道。本机只有系统包
// com.huawei.hmos.vpndialog，没有第三方 VPN 应用，所以本用例在这台设备上跳过。
//
// 关于「自己占住槽位」：本机试过两条路，都失败。
// 一是 kill -9 <UI 进程> 返回 Operation not permitted。
// 二是 aa force-stop 会把 UI 与 :vpn 扩展进程一并杀掉，槽位被系统干净释放，
// 扩展下次照常 vpn_extension_created + vpn_connected，撞不上 2203002。
// 所以冲突必须由另一个 VPN 应用触发。
//
// 界面文案按 base 与 zh_CN 两套资源写。用例两种设备语言都能判。
//
// 本文件用到的界面 id 与来源：
//   tab-home                      BridgeStatus.ets:14538
//   vpn-connect / vpn-stop        BridgeStatus.ets:9614 / :9606（connectionActionNodeId）
// 文案来源：string.json 的 vpn_conflict_title、vpn_conflict_message、
//           vpn_conflict_confirm_action。
//
//   DEVICE=<序列号> node --test scripts/e2e/vpn-conflict.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, clickId, clickNearText, forceStop, layoutTexts,
  screenshot, serial, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `vpn-conflict-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// 系统自带的 VPN 相关包与本应用不算第三方 VPN 应用。
const KNOWN_NON_THIRD_PARTY = new Set([BUNDLE, 'com.huawei.hmos.vpndialog']);
// 第三方 VPN 应用的包名通常带这些词。
const VPN_NAME_HINT = /vpn|tunnel|clash|wireguard|openvpn|shadowsocks|outline|tailscale|nord|express|surfshark|proton/i;

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let vpnCandidates = null;

// 设备上的第三方 VPN 应用包名。
// 读不到包列表时返回 null，调用方按未知处理。
// 用 bm dump -a 列包名。bundleManager 的跨应用查询被限制，宿主机侧只能走这条。
function thirdPartyVpnBundles() {
  let output = '';
  try {
    output = execFileSync(HDC, ['-t', serial(), 'shell', 'bm dump -a'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch (_error) {
    return null;
  }
  const names = new Set();
  const matches = output.match(/[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/g) || [];
  for (const name of matches) {
    if (!KNOWN_NON_THIRD_PARTY.has(name) && VPN_NAME_HINT.test(name)) {
      names.add(name);
    }
  }
  return [...names];
}

// 等一段界面文本出现。接受一个字符串或一组同义文案。
async function waitForText(needle, timeoutMs = 15000) {
  const needles = Array.isArray(needle) ? needle : [needle];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (layoutTexts().some((line) => needles.some((item) => line.includes(item)))) {
      return true;
    }
    await pause(700);
  }
  return false;
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
  configured = layoutTexts().some((line) => line.includes('未连接') || line.includes('已连接'));
  if (!configured) {
    log.stop();
    return;
  }
  // 冲突只在一次连接尝试里触发。旅程从「未连接」开始。
  if (textOfId('vpn-stop') !== null) {
    clickId('vpn-stop');
    await log.waitFor(/vpn_extension_destroyed/, 60000);
    await pause(4000);
  }
  vpnCandidates = thirdPartyVpnBundles();
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('存在另一个系统 VPN 时给出冲突提示', async (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先在设备上登录。');
    return;
  }
  if (vpnCandidates === null) {
    t.skip('读不到设备包列表（bm dump -a 失败），无法判断有没有第三方 VPN 应用。');
    return;
  }
  if (vpnCandidates.length === 0) {
    t.skip('设备上没有第三方 VPN 应用，冲突路径无从触发。需人工在设备上安装并配置另一个 VPN 应用。');
    return;
  }

  clickId('tab-home');
  await pause(2000);
  clickId('vpn-connect');

  // 扩展开 TUN 撞上 VPN_EXISTS_ERROR_CODE(2203002) 时写
  // FAILED | VPN conflict | code=2203002（TailscaleVpnExtensionAbility.ets:564、:591）。
  // 首页轮询看到该状态后走冲突路径（BridgeStatus.ets:3394）。
  const detected = await log.waitFor(/MeshArcDiag: ui vpn_conflict_detected/, 90000);
  if (detected === null) {
    if (log.lines.some((line) => line.includes('vpn_connected'))) {
      t.skip('另一个 VPN 应用没有占住系统 VPN 通道，连接直接成功。冲突路径无从触发。');
      return;
    }
    assert.fail('点了连接后既没有冲突事件，也没有连上');
  }
  // 扩展侧也记录冲突来源。
  assert.ok(await log.waitFor(/MeshArcDiag: vpn vpn_conflict/, 10000),
    '设备日志里没有扩展侧的 vpn_conflict');
  // 先停掉本应用自己的扩展，不留半建 VPN（BridgeStatus.ets:4338）。
  assert.ok(await log.waitFor(/MeshArcDiag: ui vpn_conflict_self_disconnect_requested/, 20000),
    '没有看到 vpn_conflict_self_disconnect_requested');
  assert.ok(await log.waitFor(/MeshArcDiag: ui vpn_conflict_self_disconnect_completed/, 30000),
    '没有看到 vpn_conflict_self_disconnect_completed');

  // 界面给出可理解的提示。文案见 string.json 的 vpn_conflict_title 与 vpn_conflict_message。
  const title = ['请先断开其它 VPN', 'Disconnect the other VPN first'];
  const message = ['请断开其它 VPN 以连接 Tailscale', 'Disconnect other VPNs to connect Tailscale'];
  assert.ok(await waitForText(title, 15000) || await waitForText(message, 15000),
    `冲突时没有给出可理解的提示。界面文本：${JSON.stringify(layoutTexts().slice(0, 20))}`);
  screenshot('vpn-conflict-dialog');

  // 不得静默替换或销毁另一个 VPN：冲突路径里不能连上。
  assert.ok(log.lines.every((line) => !line.includes('vpn_connected')),
    '冲突路径里出现了 vpn_connected，另一个 VPN 可能被静默替换');

  // 用户点确定。确认动作文案见 string.json 的 vpn_conflict_confirm_action。
  // 用标题当锚点，取离它最近的确认按钮。
  const anchor = title.find((item) => layoutTexts().some((line) => line.includes(item))) ||
    message.find((item) => layoutTexts().some((line) => line.includes(item)));
  assert.ok(anchor !== undefined, '冲突提示的文字不见了');
  assert.ok(clickNearText(anchor, '确定') !== null || clickNearText(anchor, 'OK') !== null,
    '冲突提示里点不到确认');
  assert.ok(await log.waitFor(/MeshArcDiag: ui vpn_conflict_acknowledged/, 20000),
    '点了确认后没有看到 vpn_conflict_acknowledged');
  // 自停已经停过扩展，这里再停一次可能以失败收尾。两种收尾都算走完。
  assert.ok(await log.waitFor(/MeshArcDiag: ui vpn_conflict_confirm_disconnect_(completed|failed)/, 30000),
    '确认后的收尾没有完成');
  await pause(3000);
  assert.ok(layoutTexts().some((line) => line.includes('未连接')),
    '冲突收尾后界面没有回到未连接');
});
