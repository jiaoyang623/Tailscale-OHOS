// E2E · 传输区的双通道选择旅程。
//
// 覆盖一条判据：
//   O-XFER-03 从设备详情走双通道发送
//
// 前置：设备已登录并连接，tailnet 里有第二台在线对端，
// 该对端同时具备 MeshSend（Taildrop）与 LocalSend 两种通道。
// 本机只有一台设备，所以本用例在这台设备上跳过。
//
// 已知局限：外部 LocalSend 的拉起依赖未定的 bundle/Want 契约（未决 Q4）。
// 本用例只断言「双通道时先让用户显式选通道」，不拉起外部应用。
//
// 界面文案按 base 与 zh_CN 两套资源写。用例两种设备语言都能判。
//
// 本文件用到的界面 id 与来源：
//   tab-home                      BridgeStatus.ets:14538
//   vpn-connect / vpn-stop        BridgeStatus.ets:9614 / :9606（connectionActionNodeId）
//   home-peer-<slug>              BridgeStatus.ets:10618
//   device-detail-sheet-host      BridgeStatus.ets:15022
//   file-transfer-method-sheet-host  BridgeStatus.ets:15041
// 文案来源：string.json 的 device_detail_transfer_title、transfer_method_title、
//           transfer_method_tailsend_title、transfer_method_localsend_title。
//
//   DEVICE=<序列号> node --test scripts/e2e/meshsend-dual-channel.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickAt, clickId, clickNearText, clickText, forceStop, layout, layoutTexts,
  screenshot, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `meshsend-dual-channel-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let peerRows = [];
const NO_PEER = '本机只有这一台设备，没有在线的第二台对端。双通道选择需要一个同时具备 MeshSend 与 LocalSend 的在线的对端。等有了对端再跑。';

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

async function waitForTextGone(needle, timeoutMs = 10000) {
  const needles = Array.isArray(needle) ? needle : [needle];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!layoutTexts().some((line) => needles.some((item) => line.includes(item)))) {
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

test('双通道目标让用户显式选择传输方式', async (t) => {
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
  // 传输动作行只在有可用通道时出现（DeviceDetailSheet.ets:199 的 hasFileTransferAction）。
  // 文案见 string.json 的 device_detail_transfer_title。
  const sendFiles = ['发送文件', 'Send files'];
  if (!await waitForText(sendFiles, 20000)) {
    t.skip('对端没有可用的传输通道（MeshSend 与 LocalSend 都不可用）。双通道用例需要一个在线的双通道对端。');
    return;
  }
  assert.ok(clickText(sendFiles[0]) || clickText(sendFiles[1]), '点不到「发送文件」');

  // 双通道时先弹选择面板。标题见 string.json 的 transfer_method_title，
  // 由 BridgeStatus.ets:15041 的 file-transfer-method-sheet-host 承载。
  const methodTitle = ['选择传输方式', 'Choose a transfer method'];
  if (!await waitForText(methodTitle, 15000)) {
    t.skip('该对端只有单通道，没有弹出传输方式选择面板。双通道用例需要一个同时具备两种通道的对端。');
    return;
  }
  screenshot('meshsend-method-sheet');
  const texts = layoutTexts();
  // 两行的标题见 string.json 的 transfer_method_tailsend_title 与 transfer_method_localsend_title。
  assert.ok(texts.some((line) => line.includes('Taildrop')), '选择面板里没有 Taildrop 行');
  assert.ok(texts.some((line) => line.includes('捷传') || line.includes('Quick Transfer')),
    '选择面板里没有捷传（LocalSend）行');

  // 显式选 Taildrop。用面板标题当锚点，取离它最近的 Taildrop。
  const anchor = methodTitle.find((item) => layoutTexts().some((line) => line.includes(item)));
  assert.ok(anchor !== undefined, '选择面板标题不见了');
  assert.ok(clickNearText(anchor, 'Taildrop') !== null, '点不到 Taildrop 行');
  assert.ok(await waitForTextGone(methodTitle, 15000), '选了传输方式之后选择面板没有关闭');
  // 选了 Taildrop 就不该拉起外部 LocalSend 应用（R-XFER-09）。
  assert.ok(log.lines.every((line) => !line.includes('localsend_launch_attempt')),
    '选了 Taildrop，设备日志里却出现了 localsend_launch_attempt');
});
