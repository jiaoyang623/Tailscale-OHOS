// E2E · 传输旅程之接收文件。O-XFER-04 的真机证据。
//
// 判据 O-XFER-04 要求：接收时按扩展名分流（图片与视频进相册，文本进预览，其它走
// 文件保存器）→ 等待文件按「名字 + 大小」配对 → 通知上的接收动作走同一条保存路径
// → 只有导出成功后才删除对端等待文件 → 未取走的文件保留到用户显式丢弃。
//
// 本机只有一台设备，「对端发来文件」这一步靠外部发送命令：
//   E2E_TAILDROP_PEER_SEND  一条能把文件推到本设备的命令，文件路径作为最后一个参数
// 例：E2E_TAILDROP_PEER_SEND='ssh peer tailscale file cp'   （后接本机生成的样本路径）
// 没有第二台在线对端时整组跳过，理由写在每条 skip 上。
//
// 通知动作不用手点系统通知。系统通知的 save 动作带的参数（TaildropNotificationService.ets:125
// taildropActionAgent）与 AppShellIntentAdapter 读的参数一致，所以用同参数的 aa start
// 能复现同一条保存路径。
//
// 判据正文：docs/oracles/90-journeys/05-transfer.md O-XFER-04
// 源码位置（行号是写作时的，函数名是准的）：
//   BridgeStatus.ets:6653 taildropContentKind          按扩展名分流
//   BridgeStatus.ets:6671 taildropContentKindText      行上的类型标记
//   BridgeStatus.ets:8192 routeTaildropReceive         选 text / media / file 策略
//   BridgeStatus.ets:8276 submitTaildropReceiveStage   发起 stage 请求
//   BridgeStatus.ets:8760 requestTaildropReceiveDelete 导出成功后请求删除
//   BridgeStatus.ets:9195 handleTaildropStagedFile     导出，失败返回 false
//   BridgeStatus.ets:9328 addTaildropReceiveRecord     写接收历史
//   BridgeStatus.ets:9346 completeTaildropReceive      完成并移除等待文件
//   BridgeStatus.ets:9377 completeTaildropDiscard      丢弃完成的收尾
//   BridgeStatus.ets:8330 confirmDiscardTaildropFile   丢弃确认对话框
//   BridgeStatus.ets:13133 TaildropWaitingFileRow      收件箱行（没有节点 id）
//   BridgeStatus.ets:1616 onTaildropNotificationAction 解析通知动作
//   BridgeStatus.ets:1640 saveTaildropFileFromNotification 通知直达保存
//   BridgeStatus.ets:7159 prefetchTaildropInboxFiles   自动暂存，文本类会先进缓存
//   AppShellIntentAdapter.ets:12 toFeatureAction       通知 Want 的参数契约
//   TailscaleVpnExtensionAbility.ets:1500 taildrop_receive_requested
//   TailscaleVpnExtensionAbility.ets:1513 taildrop_receive_<state>
//
//   DEVICE=<序列号> node --test scripts/e2e/taildrop-receive.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, click, clickId, clickText, forceStop, layout, layoutTexts,
  readAppFile, screenshot, serial, startApp, swipeUp, textOfId
} from './lib/device.mjs';

const log = new LogStream();
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `taildrop-receive-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 样本文件的名字决定分流：.txt 走文本，.bin 走文件保存器，.png 走相册。
const TEXT_FILE = process.env.E2E_TAILDROP_TEXT_FILE || 'mesharc-e2e-probe.txt';
const BLOB_FILE = process.env.E2E_TAILDROP_BLOB_FILE || 'mesharc-e2e-probe.bin';
const IMAGE_FILE = process.env.E2E_TAILDROP_IMAGE_FILE || 'mesharc-e2e-probe.png';
const PEER_SEND = process.env.E2E_TAILDROP_PEER_SEND || '';
// 置 1 时再发一个同名不同大小的文件，验证同名不同大小算两个文件。
const SEND_DUPLICATE = process.env.E2E_TAILDROP_PEER_SEND_DUPLICATE === '1';
// 相册创建对话框与文件保存器都要真人选一次，脚本点不进去。
const OPERATOR = process.env.E2E_TAILDROP_OPERATOR === '1';

const SKIP_NOT_SIGNED_IN = '这台设备还没登录 Tailscale，接收旅程不适用。先在设备上登录。';
const SKIP_NO_PEER = '缺第二台在线对端设备：Taildrop 目标里没有在线目标。'
  + '接上第二台设备，让它在同一 tailnet 登录并联网，然后重跑。';
const SKIP_NO_SENDER = '缺第二台在线对端设备的发送入口：E2E_TAILDROP_PEER_SEND 未设置。'
  + '把它设为一条能把文件推到本设备的命令（文件路径作为最后一个参数），然后重跑。';
const SKIP_NO_OPERATOR = '系统的保存对话框与相册创建对话框要真人选一次。'
  + '置 E2E_TAILDROP_OPERATOR=1 并守在设备旁重跑。';

// 界面语言可能是中文或英文。两种都接受。
const ONLINE_BADGE = /Taildrop 在线|Taildrop online/;
const KIND_TEXT = /^文本$|^Text$/;
const KIND_FILE = /^文件$|^File$/;
const KIND_IMAGE = /^图片$|^Image$/;
const INBOX_EMPTY = /其它设备发送到本机的文件会显示在这里|will appear here/;

// 诊断事件的来源标记。界面进程写 ui，扩展进程写 vpn。
const UI = (event) => new RegExp(`MeshArcDiag: ui ${event}\\b`);
const VPN = (event) => new RegExp(`MeshArcDiag: vpn ${event}\\b`);

const SNAPSHOT_FILE = 'taildrop-targets.json';// 1 像素 PNG。用作「图片」分流的样本。
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/0q6lAAAAAElFTkSuQmCC',
  'base64');

let signedIn = false;
let peerKey = '';
let textMarker = '';
let blobPath = '';
let imagePath = '';
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

// 与某个文本同处一行的全部文本。这样「类型标记」与「文件名」绑定在同一行，
// 不会命中发送目标行上的同名按钮。
function rowTexts(anchor) {
  const rows = textRows();
  const hit = rows.find((row) => row.text.includes(anchor));
  if (hit === undefined) {
    return [];
  }
  return rows.filter((row) => Math.abs(row.y - hit.y) <= 30).map((row) => row.text);
}

// 点某个收件箱行上的动作按钮。行没有节点 id，只能按行位置与无障碍文本对齐。
// 收件箱行每行都带「丢弃」按钮，直接取最后一个会点到别的行。
function clickRowAction(anchor, label) {
  const rows = textRows();
  const hit = rows.find((row) => row.text.includes(anchor));
  if (hit === undefined) { return false; }
  let point;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    const value = node.text || node.content || node.description || '';
    if (value === label && Array.isArray(node.bounds)) {
      const y = (node.bounds[1] + node.bounds[3]) / 2;
      if (Math.abs(y - hit.y) <= 30) {
        point = [(node.bounds[0] + node.bounds[2]) / 2, y];
      }
    }
    walk(node.children || []);
  };
  walk(layout());
  if (point === undefined) { return false; }
  click(point[0], point[1]);
  return true;
}

// 在线目标。先取快照的数据，快照读不到时退回界面上的目标行。
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

// 等到等待文件列表里出现某个名字。
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

// 在临时目录里造一个样本文件。内容固定，接收端能按内容断言。
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
// 传输时刻是 13 位毫秒，超出 int 范围，所以用 --pl。
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

// 点击界面上最后一个文本与给定字符串完全相同的节点。确认对话框的按钮在布局树里
// 的位置不确定，所以取最后一个。取第一个的写法留给兜底用。
function clickExact(text, takeLast) {
  let hit;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') { return; }
    for (const key of ['text', 'content', 'description']) {
      if (node[key] === text && Array.isArray(node.bounds)) {
        hit = [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2];
        if (!takeLast) { return; }
      }
    }
    if (!takeLast && hit !== undefined) { return; }
    walk(node.children || []);
  };
  walk(layout());
  if (hit === undefined) { return false; }
  click(hit[0], hit[1]);
  return true;
}

function clickLastExact(text) {
  return clickExact(text, true);
}

// 确认丢弃对话框。点一次之后对话框还在就换一种取的顺序再点。
async function confirmDiscardDialog() {
  if (!clickLastExact('丢弃') && !clickLastExact('Discard')) { return false; }
  await pause(2500);
  if (!layoutTexts().some((line) => /丢弃此文件|Discard this file/.test(line))) { return true; }
  clickExact('丢弃', false);
  clickExact('Discard', false);
  return true;
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
  // 样本内容带时间戳，预览里要按这个标记断言。
  textMarker = `MESHARC-E2E-RECEIVE-${Date.now()}`;
  blobPath = makeFixture(BLOB_FILE, Buffer.alloc(2048, 0x5a));
  imagePath = makeFixture(IMAGE_FILE, PNG_1X1);
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
  if (PEER_SEND.length === 0) { t.skip(SKIP_NO_SENDER); return true; }
  return false;
}

test('接收文件按类型落地并只在成功后删除等待文件', async (t) => {
  if (skipGroup(t)) { return; }
  const baseline = lastIndex();
  const textPath = makeFixture(TEXT_FILE, `${textMarker}\n`);
  peerSend(textPath);
  textWaiting = await waitForWaitingFile(TEXT_FILE);
  assert.ok(textWaiting !== undefined,
    `对端发送后，等待文件列表里没有出现 ${TEXT_FILE}`);

  // 界面把文本类文件标成「文本」，并按名字与大小列在收件箱里。
  const texts = layoutTexts();
  assert.ok(texts.includes(TEXT_FILE),
    `收件箱没有列出 ${TEXT_FILE}。界面文本：${JSON.stringify(texts.slice(0, 20))}`);
  const row = rowTexts(TEXT_FILE);
  assert.ok(row.some((line) => KIND_TEXT.test(line)),
    `收件箱行里没有「文本」标记。同一行的文本：${JSON.stringify(row)}`);
  screenshot('taildrop-receive-inbox');

  // 未取走的等待文件必须保留。还没导出，就不该有删除请求。
  assert.equal(firstIndexAfter(VPN('taildrop_receive_delete_requested'), baseline), -1,
    '还没导出，扩展就收到了删除请求，等待文件被提前删掉');

  // 点文件名进文本预览态。行的名字文本本身就是入口（BridgeStatus.ets:13133）。
  assert.ok(clickText(TEXT_FILE), '收件箱里的文件名点不到');
  const deadline = Date.now() + 60000;
  let previewed = false;
  while (Date.now() < deadline && !previewed) {
    previewed = layoutTexts().some((line) => line.includes(textMarker));
    if (!previewed) { await pause(1000); }
  }
  assert.ok(previewed,
    '点了文件名之后，界面上没有出现文字内容（接收端预览态没有显示内容）');
  assert.ok(waitingFiles().some((file) => file.name === TEXT_FILE),
    '预览之后等待文件就消失了，文字被当成普通文件吃掉');
});

test('O-XFER-04 通知的接收动作走同一条保存路径', async (t) => {
  if (skipGroup(t)) { return; }
  if (textWaiting === undefined) {
    t.skip('上一条没有拿到等待文件，没有可注入的通知目标。');
    return;
  }
  const baseline = lastIndex();
  // 关掉应用，再用通知动作的参数把它拉起来。通知的 save 路径与传输页同源。
  forceStop();
  await pause(2500);
  const output = startWithNotificationSave(textWaiting);
  assert.ok(!/error|fail/i.test(output), `带通知参数拉起应用失败：${output}`);

  const stored = await waitForNew(UI('taildrop_receive_completed'), baseline, 120000);
  assert.ok(stored > baseline, '通知动作没有走到完成态（taildrop_receive_completed）');
  const deleted = firstIndexAfter(VPN('taildrop_receive_delete_requested'), baseline);
  assert.ok(deleted > baseline, '通知路径没有产生删除等待文件的请求，导出没有落到同一条路径');
  assert.ok(deleted <= stored, '删除等待文件的请求出现在接收完成之后，顺序不对');
  assert.equal(firstIndexAfter(UI('taildrop_receive_failed'), baseline), -1,
    '通知路径出现了接收失败事件');
  assert.equal(await waitForWaitingFileGone(TEXT_FILE, 60000), true,
    `保存成功后 ${TEXT_FILE} 仍在等待文件列表里`);
});

test('O-XFER-04 其它类型走文件保存器', async (t) => {
  if (skipGroup(t)) { return; }
  if (!OPERATOR) { t.skip(SKIP_NO_OPERATOR); return; }
  peerSend(blobPath);
  const blob = await waitForWaitingFile(BLOB_FILE);
  assert.ok(blob !== undefined, `对端发送后，等待文件列表里没有出现 ${BLOB_FILE}`);
  const row = rowTexts(BLOB_FILE);
  assert.ok(row.length > 0, `收件箱没有列出 ${BLOB_FILE}`);
  assert.ok(row.some((line) => KIND_FILE.test(line)),
    `未知扩展名没有落到「文件」分流。同一行的文本：${JSON.stringify(row)}`);

  const baseline = lastIndex();
  console.log('  请点该行的保存键，并在系统保存对话框里选一个位置。');
  const deleted = await waitForNew(VPN('taildrop_receive_delete_requested'), baseline, 180000);
  assert.ok(deleted > baseline,
    '选了保存位置之后，扩展没有收到删除等待文件的请求，文件没有落地');
  assert.equal(firstIndexAfter(UI('taildrop_receive_failed'), baseline), -1, '保存过程出现了失败事件');
  assert.equal(await waitForWaitingFileGone(BLOB_FILE, 60000), true,
    `保存成功后 ${BLOB_FILE} 仍在等待文件列表里`);
});

test('O-XFER-04 图片经照片创建对话框落地', async (t) => {
  if (skipGroup(t)) { return; }
  if (!OPERATOR) { t.skip(SKIP_NO_OPERATOR); return; }
  const baseline = lastIndex();
  peerSend(imagePath);
  const image = await waitForWaitingFile(IMAGE_FILE);
  assert.ok(image !== undefined, `对端发送后，等待文件列表里没有出现 ${IMAGE_FILE}`);
  const row = rowTexts(IMAGE_FILE);
  assert.ok(row.some((line) => KIND_IMAGE.test(line)),
    `图片没有落到「图片」分流。同一行的文本：${JSON.stringify(row)}`);

  // 图片的暂存与预览在后台准备好，不需要人干预，日志里看得到。
  const mediaReady = /MeshArcDiag: ui taildrop_media_(preview_ready|ready_for_save)/;
  const ready = await waitForNew(mediaReady, baseline, 90000);
  assert.ok(ready > baseline,
    '图片没有走到可保存态（taildrop_media_preview_ready / taildrop_media_ready_for_save）');
  assert.equal(firstIndexAfter(VPN('taildrop_receive_delete_requested'), baseline), -1,
    '还没存进相册，扩展就收到了删除请求');

  console.log('  请点保存，并在照片创建对话框里确认。');
  const saved = await waitForNew(UI('taildrop_media_saved_to_gallery'), baseline, 180000);
  assert.ok(saved > baseline, '确认之后没有看到图片进相册的事件（taildrop_media_saved_to_gallery）');
  assert.equal(await waitForWaitingFileGone(IMAGE_FILE, 60000), true,
    `存进相册后 ${IMAGE_FILE} 仍在等待文件列表里`);
});

test('O-XFER-04 同名不同大小算两个等待文件', async (t) => {
  if (skipGroup(t)) { return; }
  if (!SEND_DUPLICATE) {
    t.skip('未要求重复发送。置 E2E_TAILDROP_PEER_SEND_DUPLICATE=1 并让对端的发送'
      + '命令第二次推一个同名但大小不同的文件，然后重跑。');
    return;
  }
  const duplicate = makeFixture(BLOB_FILE, Buffer.alloc(4096, 0x33));
  peerSend(duplicate);
  const deadline = Date.now() + 150000;
  let matched = [];
  while (Date.now() < deadline) {
    matched = waitingFiles().filter((file) => file.name === BLOB_FILE);
    if (matched.length >= 2) { break; }
    await pause(2000);
  }
  assert.ok(matched.length >= 2,
    `同名不同大小的两个文件没有同时留在列表里，只有 ${matched.length} 项`);
  const sizes = new Set(matched.map((file) => file.size));
  assert.equal(sizes.size, matched.length, '同名文件的大小相同，「名字 + 大小」配对没有被验证到');
});

test('O-XFER-04 等待文件名按 basename 清洗', async (t) => {
  if (skipGroup(t)) { return; }
  const files = waitingFiles();
  if (files.length === 0) {
    t.skip('本次没有等待文件，清洗规则无从判定。先让对端发一个文件。');
    return;
  }
  for (const file of files) {
    assert.ok(!file.name.includes('/') && !file.name.includes('\\'),
      `等待文件名带着路径分隔符：${file.name}`);
    assert.ok(file.name !== '.' && file.name !== '..', `等待文件名是 ${file.name}`);
    assert.ok(file.name.length <= 255, `等待文件名超过 255 字节：${file.name}`);
  }
});

test('O-XFER-04 未取走的等待文件可以显式丢弃', async (t) => {
  if (skipGroup(t)) { return; }
  let leftover = waitingFiles().find((file) => file.name === BLOB_FILE);
  if (leftover === undefined) {
    peerSend(blobPath);
    leftover = await waitForWaitingFile(BLOB_FILE);
    assert.ok(leftover !== undefined, `对端发送后，等待文件列表里没有出现 ${BLOB_FILE}`);
  }
  const baseline = lastIndex();
  // 收件箱行的删除按钮带「丢弃」无障碍文本（BridgeStatus.ets:13133）。
  assert.ok(clickRowAction(BLOB_FILE, '丢弃') || clickRowAction(BLOB_FILE, 'Discard'),
    '收件箱行上找不到丢弃按钮');
  await pause(1500);
  assert.ok(layoutTexts().some((line) => /丢弃此文件|Discard this file/.test(line)),
    '丢弃按钮没有弹出确认对话框');
  assert.ok(await confirmDiscardDialog(), '确认对话框里的丢弃按钮点不到');
  const requested = await waitForNew(UI('taildrop_receive_discard_requested'), baseline, 60000);
  assert.ok(requested > baseline,
    '确认丢弃之后没有产生丢弃请求（taildrop_receive_discard_requested）');
  assert.ok(await waitForNew(UI('taildrop_receive_discarded'), baseline, 60000) > baseline,
    '丢弃没有走到完成态（taildrop_receive_discarded）');
  assert.equal(await waitForWaitingFileGone(BLOB_FILE, 60000), true,
    `丢弃之后 ${BLOB_FILE} 仍在等待文件列表里`);
});

test('O-XFER-04 收件箱为空时给出说明而不是空白', async (t) => {
  if (!signedIn) { t.skip(SKIP_NOT_SIGNED_IN); return; }
  if (waitingFiles().length > 0) {
    t.skip('本次还有等待文件，空态说明不适用。');
    return;
  }
  clickId('tab-transfer');
  await pause(2000);
  // 收件箱在发送目标之下，而列表是懒渲染的：不滚下去，空态说明根本没被创建，
  // 读到的只有顶部的设备列表。先往下滚几屏再断言。
  let texts = layoutTexts();
  for (let attempt = 0; attempt < 4 && !texts.some((line) => INBOX_EMPTY.test(line)); attempt++) {
    swipeUp();
    await pause(1200);
    texts = layoutTexts();
  }
  assert.ok(texts.some((line) => INBOX_EMPTY.test(line)),
    `收件箱为空时没有给出说明。界面文本：${JSON.stringify(texts.slice(0, 20))}`);
});
