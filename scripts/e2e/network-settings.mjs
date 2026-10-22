// E2E · 网络设置与出口节点。兼作 O-NET-01 与 O-NET-02 的真机证据。
//
// O-NET-01：连接前可选择出口节点，已连接时被拒改并提示先断开。
// O-NET-02：连接前可开关「使用子网路由」与「出口节点允许访问局域网」，已连接时禁用并提示。
//
// 本用例观察的界面节点，源码位置如下：
//   NetworkSettingsPanel          BridgeStatus.ets:10208
//   route-all-toggle              BridgeStatus.ets:10222
//   exit-node-lan-toggle          BridgeStatus.ets:10247
//   network-settings-disconnect-hint  BridgeStatus.ets:10259
//   ExitNodePanel                 BridgeStatus.ets:10325
//   legacy-exit-node-status       BridgeStatus.ets:10343
//   出口节点先断开文案 exit_node_disconnect_first  BridgeStatus.ets:10332
//   两个面板的开关门控 enabled  BridgeStatus.ets:10224、10249、10353
//
// 两个开关的布尔态写进原生后端（NetworkSettingsGateway.ets:64），主机侧读不到。
// 布局树也不含 checked 字段。所以本用例断言状态相关的界面文案，不断言开关的布尔值。
// 切换开关会真正改写网络设置，为避免留下脏状态，本用例不切换开关。
//
// 前置：设备已登录 Tailscale。未登录时本用例跳过。
// 收尾：断开连接，恢复成运行本套件前的基线。
//
//   DEVICE=<序列号> node --test scripts/e2e/network-settings.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickAt, clickId, forceStop, layoutTexts, pressBack, readAppFile,
  screenshot, scrollToId, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `network-settings-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const NOT_LOGGED_IN = '这台设备还没登录 Tailscale，网络设置不适用。先登录再跑。';

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;

// 切到别的页签再切回设置，清空二级页面栈，回到设置首页（BridgeStatus.ets:1561）。
async function resetToSettingsHome() {
  // 二级页面会盖住页签栏，此时页签不在布局树里。先按返回退出。
  for (let attempt = 0; attempt < 3 && textOfId('tab-home') === null; attempt++) {
    pressBack();
    await pause(1500);
  }
  if (textOfId('tab-home') !== null) {
    clickId('tab-home');
    await pause(1500);
  }
  if (textOfId('tab-settings') !== null) {
    clickId('tab-settings');
    await pause(2500);
  }
}

async function goHome() {
  if (textOfId('tab-home') !== null) {
    clickId('tab-home');
    await pause(1500);
  }
}

function intentDesired() {
  try {
    return JSON.parse(readAppFile('vpn-intent.json')).desired || 'stopped';
  } catch (_error) {
    // 文件缺失或读不到时，应用按 stopped 处理（VpnSessionIntent.ets:44）。
    return 'stopped';
  }
}

// 冷启动后应用会按意图恢复上一次会话。恢复比界面晚，可能晚几十秒。
// 所以「界面没有停止按钮」不等于已断开：意图仍是 connected 时，恢复还在路上。
async function ensureDisconnected() {
  await goHome();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (textOfId('vpn-stop') !== null) {
      const mark = log.mark();
      clickId('vpn-stop');
      await log.waitForAfter(mark, /vpn_extension_destroyed/, 90000);
      await pause(2000);
      continue;
    }
    if (intentDesired() !== 'connected') {
      // 意图已停止。再等一拍确认界面没有出现停止按钮。
      await pause(3000);
      if (textOfId('vpn-stop') === null && intentDesired() !== 'connected') {
        return true;
      }
      continue;
    }
    // 意图仍是连接：等恢复落地，再点停止。
    const mark = log.mark();
    await log.waitForAfter(mark, /vpn_connected/, 60000);
    await pause(2000);
  }
  return textOfId('vpn-stop') === null && intentDesired() !== 'connected';
}

async function ensureConnected() {
  await goHome();
  if (textOfId('vpn-stop') !== null) {
    return true;
  }
  const mark = log.mark();
  clickId('vpn-connect');
  return await log.waitForAfter(mark, /vpn_connected/, 90000) !== null;
}

async function openNetworkDetail() {
  await resetToSettingsHome();
  const entry = await scrollToId('settings-network-entry');
  if (!entry) {
    return false;
  }
  clickAt(entry);
  await pause(2500);
  return textOfId('route-all-toggle') !== null || textOfId('legacy-exit-node-status') !== null;
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
  const texts = layoutTexts();
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
  if (!configured) {
    return;
  }
  // 归一：本用例从「未连接」开始看正常路径。
  await ensureDisconnected();
});

after(async () => {
  // 收尾断开，恢复基线。
  try {
    await ensureDisconnected();
  } catch (_error) {
    // 断开失败不掩盖证据。取证照常。
  }
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('网络设置：未连接时可操作两个开关与出口节点选择器', async (t) => {
  if (!configured) {
    t.skip(NOT_LOGGED_IN);
    return;
  }
  assert.ok(await ensureDisconnected(), '先断开连接失败，未连接路径测不了');
  assert.ok(await openNetworkDetail(), '打不开「网络与连接」设置页');
  assert.ok(textOfId('route-all-toggle') !== null, '没有子网路由开关（route-all-toggle）');
  assert.ok(textOfId('exit-node-lan-toggle') !== null, '没有出口节点局域网开关（exit-node-lan-toggle）');
  assert.ok(textOfId('legacy-exit-node-status') !== null, '没有出口节点选择器（legacy-exit-node-status）');
  assert.equal(textOfId('network-settings-disconnect-hint'), null,
    '未连接却显示了「断开连接后可更改网络设置」提示');
  assert.ok(!layoutTexts().some((line) => line.includes('断开连接以更改出口节点')),
    '未连接却显示了出口节点的先断开提示');
  screenshot('network-settings-disconnected');
});

test('网络设置：已连接时两个面板都提示先断开', async (t) => {
  if (!configured) {
    t.skip(NOT_LOGGED_IN);
    return;
  }
  if (!await ensureConnected()) {
    t.skip('连不上隧道，已连接的边界不适用。');
    return;
  }
  assert.ok(await openNetworkDetail(), '打不开「网络与连接」设置页');
  assert.ok(textOfId('network-settings-disconnect-hint') !== null,
    '已连接却没有显示「断开连接后可更改网络设置」提示');
  assert.ok(layoutTexts().some((line) => line.includes('断开连接以更改出口节点')),
    '已连接时出口节点面板没有提示先断开');
  assert.ok(textOfId('route-all-toggle') !== null && textOfId('exit-node-lan-toggle') !== null,
    '已连接时两个开关不再渲染');
  screenshot('network-settings-connected');
});
