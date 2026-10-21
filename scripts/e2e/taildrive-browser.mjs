// E2E · 文件区（Taildrive 共享目录）旅程。
//
// 覆盖两条判据：
//   O-DRIVE-02 从设备详情跳转到该设备的共享目录
//   O-DRIVE-01 浏览并操作 Taildrive 共享目录
//
// 前置：设备已登录 Tailscale，已连接，tailnet 里有第二台在线对端，
// 该对端共享了一个目录。本机只有一台设备，所以本用例在这台设备上跳过。
//
// 已知局限：上传走系统文档选择器。选择器需要人工选文件。
// 默认只覆盖浏览与下载。上传的驱动代码由 E2E_UPLOAD=1 打开，并需人工值守。
//
// 界面文案按 base 与 zh_CN 两套资源写。用例两种设备语言都能判。
//
// 本文件用到的界面 id 与来源：
//   tab-home / tab-files          BridgeStatus.ets:14538 / :14578
//   vpn-connect / vpn-stop        BridgeStatus.ets:9614 / :9606（connectionActionNodeId）
//   home-peer-<slug>              BridgeStatus.ets:10618
//   taildrive-entry-<条目名>       TaildriveBrowser.ets:3182、:3249
//   taildrive-breadcrumb-root     TaildriveBrowser.ets:3716
//   taildrive-breadcrumb-<n>      TaildriveBrowser.ets:3727
//   taildrive-back                TaildriveBrowser.ets:3756
//   taildrive-browser             TaildriveBrowser.ets:4192
//   taildrive-upload              TaildriveBrowser.ets:3989
//   taildrive-preview-download-confirm  TaildriveBrowser.ets:2720
// 文案来源：string.json 的 device_detail_remote_files_title、taildrive_connect_first。
//
//   DEVICE=<序列号> node --test scripts/e2e/taildrive-browser.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, centerOfId, clickAt, clickId, clickText, forceStop, layout, layoutTexts,
  screenshot, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `taildrive-browser-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let peerRows = [];
const NO_PEER = '本机只有这一台设备，没有在线的第二台对端可以共享目录。Taildrive 旅程需要第二台在线对端。等有了对端再跑。';

// 界面树里所有以某前缀开头的节点 id。
// Taildrive 条目 id 形如 taildrive-entry-<条目名>（TaildriveBrowser.ets:3182、:3249）。
function idsWithPrefix(prefix) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (typeof node.id === 'string' && node.id.startsWith(prefix)) {
      found.push(node.id);
    }
    walk(node.children || []);
  };
  walk(layout());
  return found;
}

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
// 分组标签见 string.json 的 device_group_local / _online / _offline
// （BridgeStatus.ets:10774、:10784）。
// 设备行的 id 是 home-peer-<slug>（BridgeStatus.ets:10618）。
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

// 等某个 id 出现。id 与语言无关。
async function waitForId(id, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (centerOfId(id) !== null) {
      return true;
    }
    await pause(700);
  }
  return false;
}

// 面包屑深度。路径在根时为 0。分段 id 是 taildrive-breadcrumb-<n>（TaildriveBrowser.ets:3727）。
function breadcrumbDepth() {
  return idsWithPrefix('taildrive-breadcrumb-').length;
}

function taildriveEntryIds() {
  return idsWithPrefix('taildrive-entry-');
}

// 回到 Taildrive 根目录。返回按钮 id 是 taildrive-back（TaildriveBrowser.ets:3756）。
async function resetTaildriveToRoot() {
  for (let i = 0; i < 8 && breadcrumbDepth() > 0; i++) {
    clickId('taildrive-back');
    await pause(2500);
  }
}

// 点开共享目录里的一个文件条目，等下载完成。
// 目录条目会加深面包屑。判为目录就退回，再试下一个。
// 下载信号来自 TaildrivePreview 日志（TaildriveBrowser.ets:930、:944）。
async function downloadFirstFile() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const ids = taildriveEntryIds();
    if (ids.length === 0) {
      return false;
    }
    const before = breadcrumbDepth();
    clickId(ids[attempt % ids.length]);
    await pause(2500);
    if (await log.waitFor(/TaildrivePreview.*download requested/, 4000)) {
      return (await log.waitFor(/TaildrivePreview.*download response.*state=completed/, 30000)) !== null;
    }
    // 大文件先弹下载确认。确认按钮 id 是 taildrive-preview-download-confirm（TaildriveBrowser.ets:2720）。
    if (centerOfId('taildrive-preview-download-confirm') !== null) {
      clickId('taildrive-preview-download-confirm');
      return (await log.waitFor(/TaildrivePreview.*download response.*state=completed/, 30000)) !== null;
    }
    if (breadcrumbDepth() > before) {
      clickId('taildrive-back');
      await pause(3000);
    }
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
  // 旅程从已连接开始。上一次跑可能把设备留在未连接。
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

test('从设备详情跳转到该设备共享目录', async (t) => {
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
  // 动作行只在已连接且对端在线时出现（DeviceDetailSheet.ets:470）。
  // 文案见 string.json 的 device_detail_remote_files_title。
  const remoteFiles = ['远程文件管理', 'Remote file management'];
  assert.ok(await waitForText(remoteFiles, 20000),
    '设备详情里没有「远程文件管理」动作行，Taildrive 跳转入口不可用');
  screenshot('taildrive-jump-detail');
  assert.ok(clickText(remoteFiles[0]) || clickText(remoteFiles[1]),
    '点不到「远程文件管理」');
  // 期望：设备详情收起，页签切到文件，浏览器以该对端为目标打开共享根。
  assert.ok(await waitForTextGone(remoteFiles, 15000), '设备详情没有收起');
  assert.ok(await waitForId('taildrive-breadcrumb-root', 20000), 'Taildrive 路径栏没有面包屑根');
  await pause(5000);

  // 对端不一定共享了目录。2026-10-13 实测：选中的对端一个共享都没有，
  // 应用给出「未找到该设备的 Taildrive 共享，已显示全部共享」并退回全部共享。
  // 这是判据没写到的一支，但它是对的：不说空话，也不停在空白页。
  // 选中共享目录的对端才能验「深度 ≥ 2」，所以那一支在缺对端时跳过，
  // 不把这一支当成通过。
  const noShare = ['未找到该设备的 Taildrive 共享', 'No Taildrive shares'];
  if (layoutTexts().some((line) => noShare.some((text) => line.includes(text)))) {
    assert.ok(centerOfId('taildrive-browser') !== null, '退回全部共享后浏览器没有出现');
    t.skip('选中的对端没有共享任何目录，应用按设计退回全部共享。'
      + '要验「打开到该设备的共享根」，需要一台共享了目录的对端设备。');
    return;
  }

  assert.ok(breadcrumbDepth() >= 2,
    `跳转后没有打开到目标设备的共享根，面包屑深度 ${breadcrumbDepth()}。` +
    `界面文本：${JSON.stringify(layoutTexts().slice(0, 20))}`);
  assert.ok(centerOfId('taildrive-browser') !== null, '跳转后 Taildrive 浏览器没有出现');
  screenshot('taildrive-jump-opened');
});

test('浏览共享目录并完成上传与下载', async (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先在设备上登录。');
    return;
  }
  if (peerRows.length === 0) {
    t.skip(NO_PEER);
    return;
  }
  clickId('tab-files');
  await pause(3000);
  await resetTaildriveToRoot();
  assert.ok(taildriveEntryIds().length > 0, '文件页没有列出任何共享目录条目');
  // 未连接时列表置灰并显示 taildrive_connect_first（TaildriveBrowser.ets:4173）。已连接时不得出现。
  const connectFirst = ['请先连接 Tailscale 以浏览远程文件', 'Connect Tailscale to browse remote files'];
  assert.ok(layoutTexts().every((line) => !connectFirst.some((item) => line.includes(item))),
    '已连接，文件页却提示先连接');

  // 逐级下钻：tailnet → 设备 → 共享目录。
  for (let depth = 0; depth < 3; depth++) {
    const ids = taildriveEntryIds();
    if (ids.length === 0) {
      break;
    }
    clickId(ids[0]);
    await pause(3500);
  }
  assert.ok(breadcrumbDepth() >= 3,
    `没有下钻到共享目录，面包屑深度 ${breadcrumbDepth()}。` +
    `界面文本：${JSON.stringify(layoutTexts().slice(0, 20))}`);
  screenshot('taildrive-share-open');

  // 上传入口只在可写的共享目录里出现（TaildriveBrowser.ets:3989）。
  assert.ok(centerOfId('taildrive-upload') !== null, '共享目录里没有上传入口');

  // 下载：点开一个文件条目，等下载完成。
  assert.ok(await downloadFirstFile(), '共享目录里没有可下载的文件条目');
  screenshot('taildrive-downloaded');

  // 上传：文件选择走系统文档选择器。默认不驱动。
  if (process.env.E2E_UPLOAD === '1') {
    clickId('taildrive-upload');
    await pause(8000);
    t.diagnostic('上传的系统文件选择器已打开。需要人工选一个文件，再核对上传完成。');
  } else {
    t.diagnostic('上传未驱动：系统文档选择器需要人工选文件。设 E2E_UPLOAD=1 并在设备旁值守。');
  }
});
