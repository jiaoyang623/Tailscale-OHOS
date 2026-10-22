// E2E · 传输旅程之发送文字。O-XFER-02 的真机证据。
//
// 判据 O-XFER-02 要求：发送端输入非空文字后发送 → 接收端进入文字预览态并显示内容
// → 文字不落盘为普通文件 → 空白输入不发送 → 超过 1 MiB 时不静默截断或丢字。
//
// 收发对端都用得上：
//   发送端  传输页选中在线目标 → 点「文本」→ 编辑器 → 发送
//   接收端  对端推来一个 .txt → 收件箱行 → 点名字 → 预览态显示内容
// 本机只有一台设备，接收侧靠外部发送命令：
//   E2E_TAILDROP_PEER_SEND  一条能把文件推到本设备的命令，文件路径作为最后一个参数
// 没有第二台在线对端时整组跳过，理由写在每条 skip 上。
//
// 判据正文：docs/oracles/90-journeys/05-transfer.md O-XFER-02
// 源码位置（行号是写作时的，函数名是准的）：
//   BridgeStatus.ets:7861 chooseTaildropText          点「文本」开编辑器
//   BridgeStatus.ets:7955 sendTaildropText            空白输入直接返回，不发送
//   BridgeStatus.ets:7968 queueTaildropText           文字写成 .txt 再走发送
//   BridgeStatus.ets:13012 TaildropTextEditorSheet    TextArea，没有节点 id
//   BridgeStatus.ets:13049 TaildropTextEditorAction   发送键在空输入时禁用
//   BridgeStatus.ets:8090 startTaildropTextPreview    点文件名进预览
//   BridgeStatus.ets:8134 showCachedTaildropTextPreview 已缓存时直接出预览
//   BridgeStatus.ets:13191 readTaildropTextPreview    超过 1 MiB 返回 undefined
//   BridgeStatus.ets:198  TAILDROP_TEXT_CLIPBOARD_MAX_BYTES = 1 MiB
//   BridgeStatus.ets:8126 copyTaildropTextPreview     preview 到剪贴板
//   BridgeStatus.ets:9394 handleTaildropStagedFile(text) 剪贴板落地
//   BridgeStatus.ets:9346 completeTaildropReceive    完成后移除等待文件
//   BridgeStatus.ets:13133 TaildropWaitingFileRow    收件箱行（没有节点 id）
//
//   DEVICE=<序列号> node --test scripts/e2e/taildrop-text.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, boundsOfId, click, clickId, clickText, forceStop, layout, layoutTexts,
  pressBack, readAppFile, screenshot, serial, startApp, textOfId
} from './lib/device.mjs';

const log = new LogStream();
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `taildrop-text-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TEXT_FILE = process.env.E2E_TAILDROP_TEXT_FILE || 'mesharc-e2e-probe.txt';
const BIG_TEXT_FILE = process.env.E2E_TAILDROP_BIG_TEXT_FILE || 'mesharc-e2e-big.txt';
const PEER_SEND = process.env.E2E_TAILDROP_PEER_SEND || '';
// 置 1 时再发一个超过 1 MiB 的 .txt，验证上限。
const SEND_BIG_TEXT = process.env.E2E_TAILDROP_PEER_SEND_BIG_TEXT === '1';
// 发送侧要真人往编辑器里输入文字。脚本没有输入文字的通道。
const OPERATOR = process.env.E2E_TAILDROP_OPERATOR === '1';

const SKIP_NOT_SIGNED_IN = '这台设备还没登录 Tailscale，传输旅程不适用。先在设备上登录。';
const SKIP_NO_PEER = '缺第二台在线对端设备：Taildrop 目标里没有在线目标。'
  + '接上第二台设备，让它在同一 tailnet 登录并联网，然后重跑。';
const SKIP_NO_SENDER = '缺第二台在线对端设备的发送入口：E2E_TAILDROP_PEER_SEND 未设置。'
  + '把它设为一条能把文件推到本设备的命令（文件路径作为最后一个参数），然后重跑。';
const SKIP_NO_OPERATOR = '文字编辑器要真人输入。脚本没有输入文字的通道。'
  + '置 E2E_TAILDROP_OPERATOR=1 并守在设备旁，(或者给 lib 补一个 uitest uiInput inputText 的包装)。';

// 界面语言可能是中文或英文。两种都接受。
const ONLINE_BADGE = /Taildrop 在线|Taildrop online/;
// 暂存成功但读不出内容时给出的失败文案（BridgeStatus.ets:8144 与 :8108）。
const PREVIEW_FAILED = /无法保存收到的文件|Could not save the received file/;

// 诊断事件的来源标记。界面进程写 ui，扩展进程写 vpn。
const UI = (event) => new RegExp(`MeshArcDiag: ui ${event}\\b`);
const VPN = (event) => new RegExp(`MeshArcDiag: vpn ${event}\\b`);

const SNAPSHOT_FILE = 'taildrop-targets.json';
// 1 MiB + 1。判据的 TAILDROP_TEXT_CLIPBOARD_MAX_BYTES 是 1 MiB。
const BIG_TEXT_BYTES = 1024 * 1024 + 1;

let signedIn = false;
let peerKey = '';
let textMarker = '';
let textWaiting;

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

function waitingFiles() {
  const data = snapshot();
  return data === undefined || !Array.isArray(data.waitingFiles) ? [] : data.waitingFiles;
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

// 编辑器有没有打开。输入框是 TextArea，没有节点 id；实测布局树里也不带
// placeholder 文本，所以按节点类型判定，不按占位文字判定。
function textEditorOpen() {
  let hit = false;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (node.type === 'TextArea') { hit = true; return; }
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

// 界面文本连同纵向中心。收件箱行没有节点 id，只能按位置配对。
function textRows() {
  const rows = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    const text = node.text || node.content || node.description || '';
    if (typeof text === 'string' && text.trim() && Array.isArray(node.bounds)) {
      rows.push({ text: text.trim(), y: (node.bounds[1] + node.bounds[3]) / 2 });
    }
    walk(node.children || []);
  };
  walk(layout());
  return rows;
}

function rowTexts(anchor) {
  const rows = textRows();
  const hit = rows.find((row) => row.text.includes(anchor));
  if (hit === undefined) {
    return [];
  }
  return rows.filter((row) => Math.abs(row.y - hit.y) <= 30).map((row) => row.text);
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
    if (data !== undefined && Array.isArray(data.waitingFiles)) { return data; }
    await pause(2000);
  }
  return undefined;
}

async function waitForWaitingFile(name, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = waitingFiles().find((file) => file.name === name);
    if (hit !== undefined) { return hit; }
    await pause(2000);
  }
  return undefined;
}

async function waitForWaitingFileGone(name, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!waitingFiles().some((file) => file.name === name)) { return true; }
    await pause(2000);
  }
  return false;
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

function firstIndexAfter(pattern, baseline) {
  for (let i = baseline + 1; i < log.lines.length; i++) {
    if (pattern.test(log.lines[i])) { return i; }
  }
  return -1;
}

function lastIndex() {
  return log.lines.length - 1;
}

function makeFixture(name, content) {
  const root = mkdtempSync(join(tmpdir(), 'mesharc-taildrop-'));
  const path = join(root, name);
  writeFileSync(path, content);
  return path;
}

// 请对端发送。命令的最后一个参数是样本文件路径。
function peerSend(path) {
  return execSync(`${PEER_SEND} ${JSON.stringify(path)}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
}

// 复现系统通知的 save 动作。参数与 TaildropNotificationService.ets:125 构造的 Want 一致。
function startWithNotificationSave(file) {
  const args = ['shell', 'aa', 'start', '-a', 'EntryAbility', '-b', BUNDLE,
    '--pb', 'taildropOpenInbox', 'true',
    '--ps', 'taildropNotificationAction', 'save',
    '--ps', 'taildropNotificationFileName', file.name,
    '--pl', 'taildropNotificationFileSize', String(file.size),
    '--pl', 'taildropNotificationReceivedAtMs', String(file.receivedAtMs),
    '--ps', 'taildropNotificationEventId', `${file.receivedAtMs}:1`];
  return execFileSync(HDC, ['-t', serial(), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 编辑器的发送键是图标按钮，没有节点 id，也没有文本。
// 按结构定位：编辑器是包含 TextArea 的 Stack；它的 Row 里有两个 Button，
// 最后一个是发送键（前一个是关闭）。2026-10-22 实测布局：
//   Stack [78,1118,1182,1678] → TextArea [117,1131,1143,1639]
//                            → Row → Button 关闭 [851,1490,968,1607]
//                                   → Button 发送 [994,1490,1111,1607]
function clickEditorSend() {
  let stack = null;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node.children) && node.children.some((child) => child && child.type === 'TextArea')) {
      stack = node;
      return;
    }
    walk(node.children || []);
  };
  walk(layout());
  if (stack === null) { return false; }
  const row = (stack.children || []).find((child) => child && child.type === 'Row');
  const buttons = row ? (row.children || []).filter((child) => child && child.type === 'Button') : [];
  if (buttons.length === 0) { return false; }
  const send = buttons[buttons.length - 1];
  const bounds = send.bounds;
  if (!Array.isArray(bounds)) { return false; }
  click((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
  return true;
}

// 轮询界面文本，直到出现带 marker 的一行。
async function waitForTextInLayout(marker, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (layoutTexts().some((line) => line.includes(marker))) { return true; }
    await pause(1000);
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
  textMarker = `MESHARC-E2E-TEXT-${Date.now()}`;
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

function skipSender(t) {
  if (skipGroup(t)) { return true; }
  if (PEER_SEND.length === 0) { t.skip(SKIP_NO_SENDER); return true; }
  return false;
}

test('发送文字并在接收端预览', async (t) => {
  if (skipSender(t)) { return; }
  const baseline = lastIndex();
  const textPath = makeFixture(TEXT_FILE, `${textMarker}\n`);
  peerSend(textPath);
  textWaiting = await waitForWaitingFile(TEXT_FILE);
  assert.ok(textWaiting !== undefined,
    `对端发送后，等待文件列表里没有出现 ${TEXT_FILE}`);

  // 收件箱行把 .txt 标成「文本」。类型标记与文件名在同一行。
  const row = rowTexts(TEXT_FILE);
  assert.ok(row.some((line) => /^文本$|^Text$/.test(line)),
    `收件箱行里没有「文本」标记。同一行的文本：${JSON.stringify(row)}`);

  // 点文件名进预览态。行内的名字文本就是入口（BridgeStatus.ets:13133）。
  assert.ok(clickText(TEXT_FILE), '收件箱里的文件名点不到');
  assert.ok(await waitForTextInLayout(textMarker, 60000),
    '预览态没有显示文字内容，接收端没有进文字预览');
  screenshot('taildrop-text-preview');

  // 文字没有落盘为普通文件。判据的两条证据：
  //   预览直接把内容显示出来，没有弹系统文件保存器（界面还是传输页）
  //   对端等待文件还没被删，说明没有走「导出成普通文件」那条路
  assert.ok(idsInLayout().has('transfer-page-title'),
    '点开预览之后系统文件保存器盖住了应用，文字走了普通文件那条路');
  assert.equal(firstIndexAfter(VPN('taildrop_receive_delete_requested'), baseline), -1,
    '预览之后对端等待文件就被删了，文字被当成普通文件处理');
  assert.ok(waitingFiles().some((file) => file.name === TEXT_FILE),
    '预览之后等待文件就消失了');
});

test('O-XFER-02 预览可以复制到剪贴板并完成接收', async (t) => {
  if (skipSender(t)) { return; }
  const baseline = lastIndex();
  // 通知的 save 动作对文本走「暂存 → 读内容 → 进剪贴板 → 删等待文件」
  // （BridgeStatus.ets:1640 与 :9394）。这条路径不需要任何系统对话框。
  forceStop();
  await pause(2500);
  const output = startWithNotificationSave(textWaiting);
  assert.ok(!/error|fail/i.test(output), `带通知参数拉起应用失败：${output}`);
  const completed = await waitForNew(UI('taildrop_receive_completed'), baseline, 120000);
  assert.ok(completed > baseline, '剪贴板路径没有走到完成态（taildrop_receive_completed）');
  assert.equal(firstIndexAfter(UI('taildrop_receive_failed'), baseline), -1,
    '接收过程中出现了失败事件');
  // 导出成剪贴板成功之后才请求删除对端等待文件，删除请求早于完成事件。
  const deleted = firstIndexAfter(VPN('taildrop_receive_delete_requested'), baseline);
  assert.ok(deleted > baseline, '剪贴板路径没有产生删除等待文件的请求，导出没有落到这条路径');
  assert.ok(deleted <= completed, '删除等待文件的请求出现在接收完成之后，顺序不对');
  assert.equal(await waitForWaitingFileGone(TEXT_FILE, 60000), true,
    `复制成功后 ${TEXT_FILE} 仍在等待文件列表里`);
});

test('O-XFER-02 空白输入不发送', async (t) => {
  if (skipGroup(t)) { return; }
  // 编辑器开着时再点同一个目标的「文本」是关闭动作（BridgeStatus.ets:7936）。
  // 上一轮没关干净时，这里的点击会把编辑器关掉，看起来像入口点不开。
  if (textEditorOpen()) {
    pressBack();
    await pause(1500);
  }
  // 前面的用例会离开传输页（预览、剪贴板那几条）。这一条按当前布局断言会扑空，
  // 所以先回到传输页，再等入口渲染出来。入口只在目标在线且可发送时出现。
  clickId('tab-transfer');
  await pause(2500);
  const actionId = `taildrop-text-${peerKey}`;
  let entry = idsInLayout().has(actionId);
  for (let attempt = 0; attempt < 6 && !entry; attempt++) {
    await pause(2500);
    entry = idsInLayout().has(actionId);
  }
  assert.ok(entry, `在线目标上没有「文本」入口（${actionId}），发送文字不可达`);
  // 入口会随对端在线状态重绘。按 id 点击时，devecocli 自己重新读一次布局，
  // 读到点击之间节点可能已经被换掉，于是抛「节点不存在」。
  // 这里先取坐标再点，点完直接看编辑器有没有出现，失败就重新取坐标再试。
  let opened = false;
  for (let attempt = 0; attempt < 4 && !opened; attempt++) {
    const bounds = boundsOfId(actionId);
    if (bounds === null) {
      await pause(2000);
      continue;
    }
    click((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
    await pause(2500);
    opened = textEditorOpen();
    if (!opened) { await pause(1500); }
  }
  assert.ok(opened, '「文本」入口点不到，编辑器没有打开');

  const baseline = lastIndex();
  // 发送键只有图标，没有节点 id，也没有无障碍文本。按结构定位。
  if (!clickEditorSend()) {
    t.skip('编辑器的发送键按结构也定位不到，空白输入无法验证。'
      + '要覆盖这一条，需要给 TaildropTextEditorAction 补一个 id（BridgeStatus.ets:13049）。');
    return;
  }
  await pause(5000);
  assert.equal(firstIndexAfter(UI('taildrop_send_queued'), baseline), -1,
    '输入为空时点了发送键却发起了传输，空白输入没有被拦住');
  // 收尾关掉编辑器。编辑器开着时列表上的入口不在布局树里，
  // 点它会抛「节点不存在」。按返回键关掉这一层就够。
  if (!idsInLayout().has(actionId)) {
    pressBack();
    await pause(1500);
  }
});

test('O-XFER-02 输入非空文字后发送', async (t) => {
  if (skipGroup(t)) { return; }
  if (!OPERATOR) { t.skip(SKIP_NO_OPERATOR); return; }
  const actionId = `taildrop-text-${peerKey}`;
  if (!idsInLayout().has(`taildrop-target-${peerKey}`)) {
    clickId('tab-transfer');
    await pause(2500);
  }
  clickId(actionId);
  await pause(2000);
  assert.ok(textEditorOpen(), '文字编辑器没有打开');
  const baseline = lastIndex();
  console.log('  请在编辑器里输入任意文字，然后点发送键。');
  const queued = await waitForNew(UI('taildrop_send_queued'), baseline, 180000);
  assert.ok(queued > baseline, '输入文字后点发送，没有出现排队事件（taildrop_send_queued）');
  const requested = await waitForNew(VPN('taildrop_send_requested'), baseline, 60000);
  assert.ok(requested > queued, '排队之后扩展没有收到发送请求，顺序不对');
  const completed = await waitForNew(VPN('taildrop_send_completed'), baseline, 180000);
  assert.ok(completed > requested, '这次发送没有走到完成态（taildrop_send_completed）');
});

test('O-XFER-02 超过 1 MiB 的文字不静默截断', async (t) => {
  if (skipSender(t)) { return; }
  if (!SEND_BIG_TEXT) {
    t.skip('未要求发送大文本。置 E2E_TAILDROP_PEER_SEND_BIG_TEXT=1 并让对端的发送'
      + '命令推一个超过 1 MiB 的 .txt，然后重跑。');
    return;
  }
  const content = Buffer.alloc(BIG_TEXT_BYTES, 0x61);
  content.write(textMarker, 0);
  peerSend(makeFixture(BIG_TEXT_FILE, content));
  const big = await waitForWaitingFile(BIG_TEXT_FILE);
  assert.ok(big !== undefined, `对端发送后，等待文件列表里没有出现 ${BIG_TEXT_FILE}`);
  assert.equal(big.size, BIG_TEXT_BYTES, `等待文件大小不是 ${BIG_TEXT_BYTES}`);

  // 超过上限就不出预览（BridgeStatus.ets:13191 返回 undefined），也不静默截断。
  // 缓存路径只弹一条失败文案，不写诊断事件，所以文案要边轮询边看。
  const baseline = lastIndex();
  assert.ok(clickText(BIG_TEXT_FILE), '收件箱里的文件名点不到');
  let previewShown = false;
  let toastSeen = false;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const lines = layoutTexts();
    if (lines.some((line) => line.includes(textMarker))) { previewShown = true; break; }
    if (lines.some((line) => PREVIEW_FAILED.test(line))) { toastSeen = true; }
    await pause(1000);
  }
  assert.ok(!previewShown, '超过 1 MiB 的文本仍被预览出来，上限没有生效');
  assert.ok(waitingFiles().some((file) => file.name === BIG_TEXT_FILE),
    '超过上限之后等待文件被丢掉了，文字没有保留');
  assert.ok(toastSeen || firstIndexAfter(UI('taildrop_receive_failed'), baseline) > baseline,
    '超过上限时既没有失败文案，也没有失败事件，界面没有说明原因');
});
