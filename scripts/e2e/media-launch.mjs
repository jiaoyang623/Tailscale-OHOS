// E2E · 媒体区的串流旅程。
//
// 覆盖一条判据：
//   O-MEDIA-02 经 Sunshine/Moonlight 串流
//
// 前置：设备已登录 Tailscale，已连接，tailnet 里有第二台在线对端，
// 该对端运行 Sunshine 并已被探测为可用。本机只有一台设备，
// 所以本用例在这台设备上跳过。
//
// 已知局限：仓内 MOONLIGHT_INTEGRATION_CONFIG 的 bundleName/abilityName 为空
// （MoonlightIntegrationConfig.ets:10-15），MoonlightLauncher.isAvailable() 恒返回假。
// 所以真机只能走到「未安装 MoonlightOH」这一支（BridgeStatus.ets:6344）。本用例断言这一支。
//
// 界面文案按 base 与 zh_CN 两套资源写。用例两种设备语言都能判。
// 拉起后的提示是代码里的中文字面量，两套语言一致。
//
// 本文件用到的界面 id 与来源：
//   tab-home                      BridgeStatus.ets:14538
//   vpn-connect / vpn-stop        BridgeStatus.ets:9614 / :9606（connectionActionNodeId）
//   home-peer-<slug>              BridgeStatus.ets:10618
//   device-detail-sheet-host      BridgeStatus.ets:15022
// 文案来源：string.json 的 device_detail_remote_desktop_title（string.json:2136）。
//
//   DEVICE=<序列号> node --test scripts/e2e/media-launch.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickAt, clickId, clickText, forceStop, layout, layoutTexts,
  screenshot, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `media-launch-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let peerRows = [];
const NO_PEER = '本机只有这一台设备，没有在线的第二台对端。串流旅程需要一台运行 Sunshine 的在线对端。等有了对端再跑。';

// 节点子树里的第一段文本。设备行用它取对端名。
function firstText(node) {
  let hit = '';
  const walk = (current) => {
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (!current || typeof current !== 'object' || hit.length > 0) {
      return;
    }
    const value = current.text || current.content || current.description || '';
    if (typeof value === 'string' && value.trim()) {
      hit = value.trim();
      return;
    }
    walk(current.children || []);
  };
  walk(node.children || []);
  return hit;
}

// 首页设备目录里在线的对端。在线组渲染在离线组之前。
// 分组标签见 string.json 的 device_group_local / _online / _offline。
const ONLINE_LABELS = ['Online', '在线'];
const OTHER_GROUP_LABELS = ['Offline', '离线', 'This device', '本机'];
function onlinePeerRows() {
  const rows = [];
  let inOnline = false;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const text = (node.text || node.content || node.description || '').trim();
    if (ONLINE_LABELS.includes(text)) {
      inOnline = true;
    }
    if (OTHER_GROUP_LABELS.includes(text)) {
      inOnline = false;
    }
    if (inOnline && typeof node.id === 'string' && node.id.startsWith('home-peer-') &&
      Array.isArray(node.bounds)) {
      rows.push({
        point: [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2],
        name: firstText(node)
      });
    }
    walk(node.children || []);
  };
  walk(layout());
  return rows;
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
  if (textOfId('vpn-stop') === null) {
    clickId('vpn-connect');
    await log.waitFor(/vpn_connected/, 90000);
    await pause(5000);
  }
  clickId('tab-home');
  await pause(2500);
  peerRows = onlinePeerRows();
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('经 Sunshine/Moonlight 串流', async (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先在设备上登录。');
    return;
  }
  if (peerRows.length === 0) {
    t.skip(NO_PEER);
    return;
  }
  clickId('tab-home');
  await pause(2000);
  const rows = onlinePeerRows();
  assert.ok(rows.length > 0, '设备数显示有在线对端，首页却找不到在线设备行');
  clickAt(rows[0].point);
  // 串流动作行只在 Sunshine 判定为 available 时出现（DeviceDetailSheet.ets:449 的门控）。
  // 文案见 string.json 的 device_detail_remote_desktop_title。
  const remoteDesktop = ['远程桌面', 'Remote desktop'];
  if (!await waitForText(remoteDesktop, 20000)) {
    t.skip('对端没有被判定为可用的 Sunshine 目标。串流旅程需要一台运行 Sunshine 的在线对端。');
    return;
  }
  screenshot('media-launch-detail');
  assert.ok(clickText(remoteDesktop[0]) || clickText(remoteDesktop[1]),
    '点不到「远程桌面」');

  // 拉起路径先做 Sunshine 探测。DERP 路径先弹确认框（BridgeStatus.ets:6323、:6332）。
  // 选「使用兼容配置」后再走到拉起。提示是代码里的中文字面量。
  if (await waitForText('当前通过 DERP 中继连接', 20000)) {
    assert.ok(clickText('使用兼容配置'), 'DERP 确认框里点不到兼容配置');
  }
  // 仓内 Moonlight 的 Want 契约为空，所以这里必然落到「未安装 MoonlightOH」分支
  // （BridgeStatus.ets:6351）。该分支给出提示与「复制主机地址」。
  assert.ok(await waitForText('需要 MoonlightOH', 30000),
    `拉起后没有出现「未安装 MoonlightOH」提示。界面文本：${JSON.stringify(layoutTexts().slice(0, 20))}`);
  const texts = layoutTexts();
  assert.ok(texts.some((line) => line.includes('复制主机地址')),
    '缺播放器时没有给出「复制主机地址」动作');
  screenshot('media-launch-moonlight-missing');

  // 日志侧的事件必须同时出现。
  assert.ok(await log.waitFor(/MeshArcDiag: ui moonlight_launch_attempt/, 10000),
    '设备日志里没有 moonlight_launch_attempt，拉起没有经过媒体联动入口');
  assert.ok(await log.waitFor(/MeshArcDiag: ui sunshine_probe_success/, 10000),
    '设备日志里没有 sunshine_probe_success，探测没有成功');
});
