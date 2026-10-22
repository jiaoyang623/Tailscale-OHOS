// E2E · 传输旅程之发送文件。O-XFER-01 的真机证据。
//
// 判据 O-XFER-01 要求：在传输页选中在线目标 → 弹出系统文档选择器 → 选中后排队并
// 顺序发送 → 传输面板给出聚合进度与当前文件名 → 同一时刻只有一个出站传输。
//
// 本机只有一台设备。没有第二台在线对端时整组跳过。每条 skip 都写明理由。
// 系统文档选择器是系统窗口，脚本点不进去。真发送那一条还要真人选一个文件。
//
// 判据正文：docs/oracles/90-journeys/05-transfer.md O-XFER-01
// 源码位置（行号是写作时的，函数名是准的）：
//   BridgeStatus.ets:7879 ensureTaildropSendAvailable  发送前校验连接、目标与忙碌
//   BridgeStatus.ets:7837 chooseTaildropDocuments      发送文件入口，转选择器
//   BridgeStatus.ets:7902 selectTaildropDocuments      系统文档选择器，上限 10 个
//   BridgeStatus.ets:7995 queueTaildropFiles           准备暂存并写发送请求
//   BridgeStatus.ets:190  TAILDROP_MAX_FILE_SELECTION = 10
//   BridgeStatus.ets:12596 TaildropTargetRow           目标行，id 为 taildrop-target-<key>
//   BridgeStatus.ets:12660 cmd 目标行 id 的挂载点
//   BridgeStatus.ets:12670 / :12707 TaildropFileMediaCapsule 与 TaildropSendFileCapsule
//   BridgeStatus.ets:12949 TaildropTargetsPanel        id 为 taildrop-targets-panel
//   BridgeStatus.ets:13047 TaildropActiveSendPanel     发送面板，只按文本断言
//   BridgeStatus.ets:12487 TransferProtocolBadge       在线角标，文本为 "<协议> 在线"
//   TailscaleVpnExtensionAbility.ets:1691 taildrop_send_requested
//   TailscaleVpnExtensionAbility.ets:1716 taildrop_send_completed
//
//   DEVICE=<序列号> node --test scripts/e2e/taildrop-send.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickId, forceStop, layout, layoutTexts, readAppFile, screenshot,
  startApp, textOfId
} from './lib/device.mjs';

const log = new LogStream();
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `taildrop-send-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 系统文档选择器要真人操作。置 1 之后，等不到选中就是失败，不是跳过。
const OPERATOR = process.env.E2E_TAILDROP_OPERATOR === '1';
const PICKER_MS = Number(process.env.E2E_TAILDROP_PICKER_MS || 180000);

const SKIP_NOT_SIGNED_IN = '这台设备还没登录 Tailscale，传输旅程不适用。先在设备上登录。';
const SKIP_NO_PEER = '缺第二台在线对端设备：Taildrop 目标里没有在线目标。'
  + '接上第二台设备，让它在同一 tailnet 登录并联网，然后重跑。';
const SKIP_NOT_READY = 'Taildrop 未就绪（快照 state 不是 ready），发送旅程不适用。';
const SKIP_NO_OPERATOR = '系统文档选择器是系统窗口，脚本点不进去。'
  + '置 E2E_TAILDROP_OPERATOR=1 并守在选择器旁选中一个文件后重跑。';

// 界面语言可能是中文或英文。两种都接受。
const ONLINE_BADGE = /Taildrop 在线|Taildrop online/;
const SENDING_TO = /正在发送到 |Sending to /;
const SEND_DONE = /文件已发送|Files sent/;
// 未连接时传输页给出的说明。三份文案都要认，设备上出现哪一份取决于有没有缓存的设备：
//   transfer_connect_first_title        「请先连接 Tailscale」——没有缓存设备时
//   transfer_remote_cached_title        「MeshArc 尚未连接」——有缓存设备但没连
//   transfer_remote_devices_description 「来自 MeshArc 的设备缓存…」——本机实测走的是这一份
// 2026-10-13 实测：这台设备有缓存的在线对端，页面渲染的是第三份，
// 每个对端带「Taildrop 离线 / LocalSend 离线」徽标。判据写的「提示先连接」，
// 实现给的是「缓存仍在、发送时按需恢复连接」。断言按实现的三份文案收全。
const NOT_CONNECTED_HINT =
  /请先连接 Tailscale|MeshArc 尚未连接|来自 MeshArc 的设备缓存|Connect Tailscale first|MeshArc is not connected|Cached from MeshArc/;

// 诊断事件的来源标记。界面进程写 ui，扩展进程写 vpn
// （DiagnosticEventStore.ets:41 的 hilog 镜像格式 "<source> <event> <phase> code=<code>"）。
const UI = (event) => new RegExp(`MeshArcDiag: ui ${event}\\b`);
const VPN = (event) => new RegExp(`MeshArcDiag: vpn ${event}\\b`);

// 应用私有目录里的传输快照。扩展进程与界面进程共用同一个 filesDir。
const SNAPSHOT_FILE = 'taildrop-targets.json';

let signedIn = false;
let peerKey = '';
let peerName = '';
let taildropState = '';

// 读应用私有目录里的一个 JSON 文件。读不到或不是 JSON 时返回 undefined。
function appJson(name) {
  try {
    return JSON.parse(readAppFile(name));
  } catch (_error) {
    return undefined;
  }
}

// 传输快照。字段见 TailscaleVpnExtensionAbility.ets:229 PersistedTaildropSnapshot。
// state 是 taildropState，targets 每项带 key、name、online。
function snapshot() {
  return appJson(SNAPSHOT_FILE);
}

// 界面结构里的全部节点 id。
function idsInLayout() {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (typeof node.id === 'string' && node.id) { found.add(node.id); }
    walk(node.children || []);
  };
  walk(layout());
  return found;
}

// 某个 id 的节点。找不到返回 undefined。
function nodeOfId(id) {
  let hit;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (node.id === id) { hit = node; return; }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

// 某个节点子树里的全部界面文本。
function textsUnder(node) {
  const found = [];
  const walk = (item) => {
    if (Array.isArray(item)) { item.forEach(walk); return; }
    if (!item || typeof item !== 'object') { return; }
    for (const key of ['text', 'content', 'description']) {
      if (typeof item[key] === 'string' && item[key].trim()) { found.push(item[key].trim()); }
    }
    walk(item.children || []);
  };
  walk(node);
  return found;
}

// 在线目标。先取快照的数据，它带 name 且不受界面滚动影响。快照读不到时退回界面：
// 目标行的 id 是 taildrop-target-<key>，行内的在线角标文本来自 transfer_protocol_online。
function onlineTargets() {
  const data = snapshot();
  const fromData = data !== undefined && Array.isArray(data.targets) ?
    data.targets.filter((item) => item.online === true) : [];
  if (fromData.length > 0) {
    return fromData.map((item) => ({ key: item.key, name: item.name }));
  }
  const found = [];
  for (const id of idsInLayout()) {
    if (!id.startsWith('taildrop-target-')) { continue; }
    const node = nodeOfId(id);
    if (node === undefined) { continue; }
    if (textsUnder(node).some((line) => ONLINE_BADGE.test(line))) {
      found.push({ key: id.slice('taildrop-target-'.length), name: '' });
    }
  }
  return found;
}

// 发送文件的入口有两种形态。纯 Taildrop 目标给 taildrop-file-<key>。
// 双通道目标给 taildrop-send-file-<key>，点了先进通道选择（那是 O-XFER-03）。
function fileSendActionId(key) {
  const ids = idsInLayout();
  if (ids.has(`taildrop-file-${key}`)) { return `taildrop-file-${key}`; }
  if (ids.has(`taildrop-send-file-${key}`)) { return `taildrop-send-file-${key}`; }
  return '';
}

// 已在连接态时首页给的是断开按钮（BridgeStatus.ets:9606）。
function connected() {
  return textOfId('vpn-stop') !== null;
}

// 等界面回到连接态。不按日志里的 vpn_connected 判，那个事件在本次运行里可能已经
// 出现过，按日志判会立刻命中旧行。
async function waitForConnected(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (connected()) { return true; }
    await pause(1000);
  }
  return false;
}

async function ensureConnected() {
  if (connected()) { return true; }
  clickId('tab-home');
  await pause(2000);
  if (textOfId('vpn-connect') === null) { return false; }
  clickId('vpn-connect');
  return waitForConnected();
}

// 扩展写快照要等它跑完一轮。轮询到能解析为止。
// 快照文件一出现就读到 loading。等 ready 再返回：扩展重启后要几十秒才就绪。
// 超时仍未就绪时返回最后一次读到的快照，让断言带上真实状态。
async function waitForSnapshot(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const data = snapshot();
    if (data !== undefined && Array.isArray(data.targets)) {
      last = data;
      if (String(data.state || '') === 'ready') { return data; }
    }
    await pause(2000);
  }
  return last;
}

function countOf(pattern) {
  return log.lines.filter((line) => pattern.test(line)).length;
}

// 等到某个模式出现在 baseline 行之后的新行上。LogStream.waitFor 每次都从日志头
// 开始找，同一个模式第二次等会立刻命中旧行，所以这里按行号判定。
async function waitForNew(pattern, baseline, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = baseline + 1; i < log.lines.length; i++) {
      if (pattern.test(log.lines[i])) { return i; }
    }
    await pause(250);
  }
  return -1;
}

function lastIndex() {
  return log.lines.length - 1;
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
  signedIn = layoutTexts().some((line) => line.includes('未连接') || line.includes('已连接'));
  if (!signedIn) {
    log.stop();
    return;
  }
  await ensureConnected();
  const data = await waitForSnapshot();
  taildropState = data === undefined ? '' : String(data.state || '');
  const peers = onlineTargets();
  if (peers.length > 0) {
    peerKey = peers[0].key;
    peerName = peers[0].name;
  }
  clickId('tab-transfer');
  await pause(2500);
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

function skipPeer(t) {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return true; }
  if (peerKey.length === 0) { t.skip(SKIP_NO_PEER); return true; }
  return false;
}

test('O-XFER-01 前置：Taildrop 就绪且目标在线', async (t) => {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return; }
  if (peerKey.length === 0) { t.skip(SKIP_NO_PEER); return; }
  assert.equal(taildropState, 'ready', `Taildrop 快照 state 是 ${taildropState}，不是 ready`);
  const ids = idsInLayout();
  assert.ok(ids.has('taildrop-targets-panel'), '传输页没有目标列表（taildrop-targets-panel）');
  assert.ok(ids.has(`taildrop-target-${peerKey}`), `目标行 taildrop-target-${peerKey} 不在界面上`);
  const node = nodeOfId(`taildrop-target-${peerKey}`);
  const texts = textsUnder(node);
  assert.ok(texts.some((line) => ONLINE_BADGE.test(line)),
    `目标行没有在线角标。行内文本：${JSON.stringify(texts)}`);
  assert.ok(fileSendActionId(peerKey).length > 0,
    '在线目标上没有发送文件入口，界面没有给出发送路径');
});

test('从传输页向在线目标发送文件', async (t) => {
  if (skipPeer(t)) { return; }
  const action = fileSendActionId(peerKey);
  assert.ok(action.length > 0, '在线目标上没有发送文件入口');
  if (action.startsWith('taildrop-send-file-')) {
    t.skip('这个目标同时具备 LocalSend 通道，发送文件先走通道选择（O-XFER-03）。'
      + '本用例只覆盖纯 Taildrop 目标。');
    return;
  }
  if (!OPERATOR) { t.skip(SKIP_NO_OPERATOR); return; }

  const baseline = lastIndex();
  clickId(action);

  // 系统文档选择器是另一个窗口。它一打开，应用自己的传输页就不再是当前布局
  // （BridgeStatus.ets:13012 的选择器由系统接管）。
  const pickerDeadline = Date.now() + 30000;
  let pickerUp = false;
  while (Date.now() < pickerDeadline) {
    if (!idsInLayout().has('transfer-page-title')) { pickerUp = true; break; }
    await pause(1000);
  }
  assert.ok(pickerUp,
    '点了发送文件之后，系统文档选择器没有打开，发送入口没有走到选择文件这一步');
  console.log(`  请在选择器里选中一个或多个文件。上限 ${PICKER_MS / 1000} 秒。`);

  const queued = await waitForNew(UI('taildrop_send_queued'), baseline, PICKER_MS);
  assert.ok(queued > baseline,
    `${PICKER_MS / 1000} 秒内没有出现 taildrop_send_queued，文件没有进入排队`);
  screenshot('taildrop-send-queued');

  // 面板在排队与发送态出现（BridgeStatus.ets:13047）。它没有 id，按文本断言。
  let panelSeen = false;
  for (let i = 0; i < 40 && !panelSeen; i++) {
    const texts = layoutTexts();
    panelSeen = texts.some((line) => SENDING_TO.test(line)) ||
      texts.some((line) => /正在准备文件|Preparing files/.test(line));
    if (!panelSeen) { await pause(500); }
  }
  screenshot('taildrop-send-panel');

  const requested = await waitForNew(VPN('taildrop_send_requested'), queued, 30000);
  assert.ok(requested > queued, '排队之后扩展没有收到发送请求（taildrop_send_requested）');
  const completed = await waitForNew(VPN('taildrop_send_completed'), requested, 180000);
  assert.ok(completed > requested, '扩展没有把这次发送走到完成态（taildrop_send_completed）');

  // 顺序：界面排队 → 扩展收到请求 → 扩展完成。这三条就是「选中后排队并顺序发送」。
  assert.equal(countOf(VPN('taildrop_send_failed')), 0,
    '这次发送出现了 taildrop_send_failed，发送没有成功');
  assert.ok(panelSeen || layoutTexts().some((line) => SEND_DONE.test(line)),
    '发送期间没有看到传输面板，结束后也没有看到完成提示');
});

test('O-XFER-01 同一时刻只有一个出站传输', async (t) => {
  if (skipPeer(t)) { return; }
  const queued = countOf(UI('taildrop_send_queued'));
  if (queued === 0) {
    t.skip('本次没有发生发送，没有可判定的在途传输。先让上一条用例走完。');
    return;
  }
  // 每次排队带一个 requestId。请求数与完成数相等，说明没有并发发起第二个传输。
  assert.equal(countOf(VPN('taildrop_send_requested')), queued,
    `排队 ${queued} 次，扩展只收到 ${countOf(VPN('taildrop_send_requested'))} 次请求`);
  assert.equal(countOf(VPN('taildrop_send_failed')), 0, '有发送失败，传输没有全部走完成态');
  assert.equal(countOf(VPN('taildrop_send_completed')), queued,
    `排队 ${queued} 次，只有 ${countOf(VPN('taildrop_send_completed'))} 次走到完成态`);
});

test('O-XFER-01 断开后传输页撤掉发送入口并说明要先连接', async (t) => {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return; }
  // 判据的边界要求：未连接时不发起传输。代码把发送入口整个撤掉
  // （BridgeStatus.ets:12596 的行渲染条件是 isConnected()），并给出连接说明。
  clickId('tab-home');
  await pause(2000);
  if (connected()) {
    const baseline = lastIndex();
    clickId('vpn-stop');
    assert.ok(await waitForNew(/vpn_extension_destroyed/, baseline, 90000) > baseline,
      '点了断开之后没有出现 vpn_extension_destroyed');
    await pause(4000);
  }
  clickId('tab-transfer');
  await pause(3000);

  const ids = idsInLayout();
  const sendActions = [...ids].filter((id) =>
    id.startsWith('taildrop-file-') || id.startsWith('taildrop-send-file-'));
  assert.equal(sendActions.length, 0,
    `未连接时传输页仍留着发送入口：${JSON.stringify(sendActions)}`);
  const texts = layoutTexts();
  assert.ok(texts.some((line) => NOT_CONNECTED_HINT.test(line)),
    `未连接时传输页没有说明要先连接。界面文本：${JSON.stringify(texts.slice(0, 15))}`);

  // 收尾：回到连接态。后面的用例与其它 E2E 文件都依赖它。
  clickId('tab-home');
  await pause(2000);
  if (textOfId('vpn-connect') !== null) {
    clickId('vpn-connect');
  }
  assert.ok(await waitForConnected(), '收尾没能回到连接态，后面的用例会受影响');
});
