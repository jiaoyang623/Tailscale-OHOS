// E2E · 传输旅程之取消、重试与历史上限。O-XFER-05 的真机证据。
//
// 判据 O-XFER-05 要求：发送中可取消，取消经原子写取消请求进入取消态 → 失败的发送
// 记录可对同一在线目标重试 → 非发送或非失败记录不可重试 → 历史超过上限时淘汰最旧。
//
// 历史落在应用私有目录的 taildrop-history.json（BridgeStatus.ets:7527 persistTaildropHistory）。
// 这个文件能从主机侧读出来（lib 的 readAppFile），所以上限与顺序可以直接按数据断言，
// 不用靠数界面上的行。取消请求的交接文件是 taildrop-cancel-request.json
// （BridgeStatus.ets:8041 cancelTaildropSend 写，扩展处理完清空）。
//
// 取消一条要在途的传输，所以需要真人选一个大文件。重试的两条要有历史记录。
// 没有第二台在线对端时整组跳过，理由写在每条 skip 上。
//
// 判据正文：docs/oracles/90-journeys/05-transfer.md O-XFER-05
// 已知冲突：技术方案记的是 bounded 20 条，代码是 10 条。本用例按代码断言，
// 冲突记在判据正文里。
//
// 源码位置（行号是写作时的，函数名是准的）：
//   BridgeStatus.ets:8041 cancelTaildropSend      写取消请求，失败给文案
//   BridgeStatus.ets:8056 retryTaildropSend       只对 send + failed 生效
//   BridgeStatus.ets:189  TAILDROP_HISTORY_LIMIT = 10
//   BridgeStatus.ets:3879 收尾时把记录插到最前并按上限裁剪
//   BridgeStatus.ets:7503 loadTaildropHistory     恢复时同样裁剪
//   BridgeStatus.ets:7512 validTaildropHistoryRecord 记录合法性
//   BridgeStatus.ets:13447 TaildropHistoryRow     历史行，失败时显示「重试」
//   BridgeStatus.ets:13047 TaildropActiveSendPanel 发送面板与取消键
//   TailscaleVpnExtensionAbility.ets:1406 processTaildropCancelRequest
//   TailscaleVpnExtensionAbility.ets:1432 taildrop_send_cancelled
//
//   DEVICE=<序列号> node --test scripts/e2e/taildrop-history.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, click, clickId, forceStop, layout, layoutTexts, readAppFile,
  screenshot, startApp, textOfId
} from './lib/device.mjs';

const log = new LogStream();
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `taildrop-history-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 在途传输能取消的窗口取决于文件大小。选大文件才有时间点取消。
const PICKER_MS = Number(process.env.E2E_TAILDROP_PICKER_MS || 180000);
const OPERATOR = process.env.E2E_TAILDROP_OPERATOR === '1';

const SKIP_NOT_SIGNED_IN = '这台设备还没登录 Tailscale，传输旅程不适用。先在设备上登录。';
const SKIP_NO_PEER = '缺第二台在线对端设备：Taildrop 目标里没有在线目标。'
  + '接上第二台设备，让它在同一 tailnet 登录并联网，然后重跑。';
const SKIP_NO_OPERATOR = '取消一条在途传输要在系统文档选择器里选一个大文件。'
  + '置 E2E_TAILDROP_OPERATOR=1 并守在设备旁重跑。';

// 界面语言可能是中文或英文。两种都接受。
const ONLINE_BADGE = /Taildrop 在线|Taildrop online/;
const RETRY_PROMPT = /请选择要重新发送的内容|Choose the content to resend/;
const TARGET_GONE = /所选设备当前不可用|The selected device is no longer available/;

// 诊断事件的来源标记。界面进程写 ui，扩展进程写 vpn。
const UI = (event) => new RegExp(`MeshArcDiag: ui ${event}\\b`);
const VPN = (event) => new RegExp(`MeshArcDiag: vpn ${event}\\b`);

const SNAPSHOT_FILE = 'taildrop-targets.json';
const HISTORY_FILE = 'taildrop-history.json';
const CANCEL_REQUEST_FILE = 'taildrop-cancel-request.json';
// 代码里的上限。判据正文记的冲突：技术方案写 20 条。
const HISTORY_LIMIT = 10;

let signedIn = false;
let peerKey = '';

function appJson(name) {
  try {
    return JSON.parse(readAppFile(name));
  } catch (_error) {
    return undefined;
  }
}

function snapshot() {
  return appJson(SNAPSHOT_FILE);
}

// 历史记录。文件是 { records: [...] }（BridgeStatus.ets:427 PersistedTaildropHistory）。
// 文件不存在或结构不对时返回 undefined。
function history() {
  const persisted = appJson(HISTORY_FILE);
  if (persisted === undefined || !Array.isArray(persisted.records)) { return undefined; }
  return persisted.records;
}

// 等到历史条数超过给定的下限。记录由收尾流程异步写入。
async function waitForHistoryGrowth(count, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const records = history();
    if (records !== undefined && records.length > count) { return records; }
    await pause(2000);
  }
  return undefined;
}

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

function connected() {
  return textOfId('vpn-stop') !== null;
}

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

async function waitForSnapshot(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = snapshot();
    if (data !== undefined && Array.isArray(data.targets)) { return data; }
    await pause(2000);
  }
  return undefined;
}

// 在途传输的 requestId 由扩展写在快照里。取消请求要按它对齐（扩展侧 :1418 校验）。
function transferRequestId() {
  const data = snapshot();
  return data === undefined || data.transfer === undefined ? 0 : Number(data.transfer.requestId) || 0;
}

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

function firstIndexAfter(pattern, baseline) {
  for (let i = baseline + 1; i < log.lines.length; i++) {
    if (pattern.test(log.lines[i])) { return i; }
  }
  return -1;
}

function lastIndex() {
  return log.lines.length - 1;
}

// 界面上最后一个文本与给定字符串完全相同的节点。发送面板的取消键与历史行都在
// 页面上部之后渲染，所以要取最后一个。
function clickLastExact(text) {
  let hit;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    for (const key of ['text', 'content', 'description']) {
      if (node[key] === text && Array.isArray(node.bounds)) {
        hit = [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2];
      }
    }
    walk(node.children || []);
  };
  walk(layout());
  if (hit === undefined) { return false; }
  click(hit[0], hit[1]);
  return true;
}

// 界面上最后一个包含给定文本的节点。历史行的标题由文件名或目标名生成
// （BridgeStatus.ets:6951 taildropTransferRecordTitle）。
function clickLastContaining(text) {
  let hit;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    for (const key of ['text', 'content', 'description']) {
      const value = node[key];
      if (typeof value === 'string' && value.includes(text) && Array.isArray(node.bounds)) {
        hit = [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2];
      }
    }
    walk(node.children || []);
  };
  walk(layout());
  if (hit === undefined) { return false; }
  click(hit[0], hit[1]);
  return true;
}

// 轮询界面文本，看有没有出现某个提示。提示是短时浮层，要边轮询边看。
async function toastSeen(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (layoutTexts().some((line) => pattern.test(line))) { return true; }
    await pause(500);
  }
  return false;
}

// 清掉上一次运行留下的空请求文件，让「扩展取走请求」这一步可判。
function requestFileText() {
  return readAppFile(CANCEL_REQUEST_FILE);
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
  await waitForSnapshot();
  const peers = onlineTargets();
  if (peers.length > 0) { peerKey = peers[0].key; }
  clickId('tab-transfer');
  await pause(2500);
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

function skipGroup(t) {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return true; }
  if (peerKey.length === 0) { t.skip(SKIP_NO_PEER); return true; }
  return false;
}

test('取消重试与历史上限', async (t) => {
  if (skipGroup(t)) { return; }
  if (!OPERATOR) { t.skip(SKIP_NO_OPERATOR); return; }
  const before = history();
  const beforeCount = before === undefined ? 0 : before.length;

  // 从传输页发起一次发送。选大文件才有时间点取消。
  const ids = idsInLayout();
  const action = ids.has(`taildrop-file-${peerKey}`) ? `taildrop-file-${peerKey}` :
    (ids.has(`taildrop-send-file-${peerKey}`) ? `taildrop-send-file-${peerKey}` : '');
  assert.ok(action.length > 0, '在线目标上没有发送文件入口，取消无从测起');
  clickId(action);
  console.log(`  请在系统文档选择器里选一个大文件。上限 ${PICKER_MS / 1000} 秒。`);

  const queuedAt = await waitForNew(UI('taildrop_send_queued'), lastIndex(), PICKER_MS);
  if (queuedAt < 0) {
    t.skip('本次没有文件进入排队，没有在途传输可取消。');
    return;
  }
  const requestId = transferRequestId();
  assert.ok(requestId > 0, '在途传输没有写出 requestId，取消请求对不上目标');

  // 在途态点取消。发送面板的取消键只在 queued / sending 出现（BridgeStatus.ets:13063）。
  assert.ok(clickLastExact('取消') || clickLastExact('Cancel'),
    '发送面板上找不到取消键，取消动作不可达');
  const cancelRequested = await waitForNew(UI('taildrop_send_cancel_requested'), queuedAt, 30000);
  if (cancelRequested < 0) {
    // 取消键点下去时传输可能已经走完，此时取消是无操作，符合判据的边界。
    t.skip('本次传输在取消落下之前就走完了，取消是无操作。用更大的文件重跑。');
    return;
  }
  const cancelled = await waitForNew(VPN('taildrop_send_cancelled'), cancelRequested, 60000);
  assert.ok(cancelled > cancelRequested,
    '取消请求写下去了，扩展没有把发送取消掉（taildrop_send_cancelled）');
  assert.equal(firstIndexAfter(VPN('taildrop_send_cancel_failed'), cancelRequested), -1,
    '扩展侧取消了失败（taildrop_send_cancel_failed）');
  assert.equal(firstIndexAfter(VPN('taildrop_send_completed'), queuedAt), -1,
    '取消之后这次发送仍走到了完成态');
  assert.equal(requestFileText().trim(), '',
    '取消请求文件没有被扩展取走后清空，交接没有闭环');

  // 取消的结果要落到历史里，状态是失败，原因是 cancelled
  // （native/go_bridge/backend.go:1446 cancelTaildropTransfer）。
  const after = await waitForHistoryGrowth(beforeCount);
  assert.ok(after !== undefined,
    `取消之后历史没有新增记录，仍是 ${beforeCount} 条`);
  assert.equal(after[0].direction, 'send', '新增的历史记录方向不是发送');
  assert.equal(after[0].state, 'failed', '取消过的发送没有以失败态记进历史');
  assert.equal(after[0].reason, 'cancelled', `新增记录的失败原因不是 cancelled：${after[0].reason}`);
});

test('O-XFER-05 历史有上限且只保留最新', async (t) => {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return; }
  const records = history();
  if (records === undefined) {
    t.skip(`应用私有目录里没有 ${HISTORY_FILE}，这台设备还没产生传输记录。`);
    return;
  }
  assert.ok(records.length > 0, '历史文件存在但没有记录');
  assert.ok(records.length <= HISTORY_LIMIT,
    `历史有 ${records.length} 条，超过上限 ${HISTORY_LIMIT} 条`);
  for (const record of records) {
    assert.ok(Number.isInteger(record.requestId) && record.requestId > 0,
      `历史记录的 requestId 不合法：${JSON.stringify(record)}`);
    assert.ok(record.direction === 'send' || record.direction === 'receive',
      `历史记录的方向不合法：${record.direction}`);
    assert.ok(record.state === 'completed' || record.state === 'failed',
      `历史记录的状态不合法：${record.state}`);
    assert.ok(record.fileCount > 0, `历史记录的文件数不合法：${record.fileCount}`);
    assert.ok(record.completedAtMs > 0, `历史记录的完成时刻不合法：${record.completedAtMs}`);
    assert.ok(typeof record.fileName === 'string' && record.fileName.length <= 255,
      '历史记录的文件名不合法');
  }
  // 最新的排在最前（BridgeStatus.ets:3879 用 [record].concat(history)）。
  for (let i = 1; i < records.length; i++) {
    assert.ok(records[i - 1].completedAtMs >= records[i].completedAtMs,
      `历史记录没有按时间倒序：第 ${i - 1} 条 ${records[i - 1].completedAtMs} 早于第 ${i} 条`);
  }
  screenshot('taildrop-history');
});

test('O-XFER-05 非失败记录不可重试', async (t) => {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return; }
  const records = history();
  const completed = records === undefined ? undefined :
    records.find((record) => !(record.direction === 'send' && record.state === 'failed'));
  if (completed === undefined) {
    t.skip('历史里没有已完成或非发送的记录，没有可点的不该重试的目标。');
    return;
  }
  clickId('tab-transfer');
  await pause(2500);
  const title = completed.fileName.trim().length > 0 ? completed.fileName : 'Received file';
  const baseline = lastIndex();
  if (!clickLastContaining(title)) {
    t.skip(`历史行点不到（标题「${title}」）。历史行没有节点 id（BridgeStatus.ets:13447）。`);
    return;
  }
  // 提示是短时浮层，边等边看。这 6 秒也在覆盖「没有发起新传输」。
  const prompted = await toastSeen(RETRY_PROMPT, 6000);
  assert.equal(prompted, false,
    '点了已完成的记录却弹出了重新选择内容的提示，非失败记录被当成可重试');
  assert.equal(firstIndexAfter(UI('taildrop_send_queued'), baseline), -1,
    '点了已完成的记录却发起了新的传输，非失败记录被当成可重试');
});

test('O-XFER-05 失败的发送记录可重试', async (t) => {
  if (skipGroup(t)) { return; }
  const records = history();
  const failed = records === undefined ? undefined :
    records.find((record) => record.direction === 'send' && record.state === 'failed');
  if (failed === undefined) {
    t.skip('历史里没有失败的发送记录，重试路径没有入口。先造一次失败的发送。');
    return;
  }
  const title = failed.fileName.trim().length > 0 ? failed.fileName : failed.targetName;
  const baseline = lastIndex();
  if (!clickLastContaining(title)) {
    t.skip(`历史行点不到（标题「${title}」）。历史行没有节点 id（BridgeStatus.ets:13447）。`);
    return;
  }
  // 重试会重新打开内容选择，而不是复用可能已失效的暂存（BridgeStatus.ets:8056）。
  // 目标离线时给的是「所选设备当前不可用」。两种提示都算重试被受理。
  const retry = await toastSeen(RETRY_PROMPT, 5000);
  const gone = retry ? false : await toastSeen(TARGET_GONE, 5000);
  assert.ok(retry || gone,
    '点了失败的发送记录，既没有重新选择内容的提示，也没有目标不可用的提示');
  assert.equal(firstIndexAfter(UI('taildrop_send_queued'), baseline), -1,
    '重试直接发起了传输，没有重新走内容选择');
});
