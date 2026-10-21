// E2E · 经系统浏览器登录旅程。兼作 O-SETUP-03 的真机证据。
//
// 从真实入口走到用户结果：未登录 → 点登录 → 系统浏览器打开授权页 →
// 不完成授权就回到应用 → 仍是未登录态，可重试。
//
// 本案要先到未登录态。设备已登录时，本案会先退出登录，这会清掉登录态。
// 用户不愿在这台设备上再登录别的账户。所以本文件默认不跑。
// 确认可以清登录态后，手动设 MESHARC_ALLOW_LOGIN=1 再跑。
//
//   DEVICE=<序列号> MESHARC_ALLOW_LOGIN=1 node --test scripts/e2e/browser-login.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LogStream, click, clickId, forceStop, layout, startApp } from './lib/device.mjs';

const GATE = '本用例会清除设备登录态，需人工确认后手动设 MESHARC_ALLOW_LOGIN=1 再跑';
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `browser-login-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ready = false;

function nodes() {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const bounds = Array.isArray(node.bounds) ? node.bounds : null;
    const text = `${node.text || node.content || node.description || ''}`.trim();
    found.push({
      id: typeof node.id === 'string' ? node.id : '',
      text,
      center: bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null
    });
    walk(node.children || []);
  };
  walk(layout());
  return found;
}

function snapshot() {
  const all = nodes();
  return {
    ids: all.map((node) => node.id).filter((id) => id.length > 0),
    hasId: (id) => all.some((node) => node.id === id)
  };
}

// 确认对话框的按钮与面板里的同名按钮共用文案。
// 按离标题最近的那个点，才是对话框的按钮。
function clickNear(anchor, target) {
  const all = nodes().filter((node) => node.center);
  const anchorNode = all.find((node) => node.text.includes(anchor));
  const targets = all.filter((node) => node.text === target);
  if (!anchorNode || targets.length === 0) {
    return false;
  }
  const distance = (a, b) => Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
  targets.sort((a, b) => distance(a, anchorNode) - distance(b, anchorNode));
  click(targets[0].center[0], targets[0].center[1]);
  return true;
}

// 是否已登录。未登录时首页设备区给出不可用文案。
// 已登录时设置-账户详情有 account-open。
function signedIn() {
  const all = nodes();
  if (all.some((node) => node.id === 'account-open')) {   // BridgeStatus.ets:11630
    return true;
  }
  const texts = all.map((node) => node.text);
  const signedOut = texts.includes('登录以使用 Tailscale') ||
    texts.includes('Sign in to use Tailscale');
  return !signedOut;
}

async function ensureSignedOut() {
  if (!signedIn()) {
    return true;
  }
  // 已登录：先断开再退出。已连接时账户面板不渲染退出按钮。
  clickId('tab-home');                       // BridgeStatus.ets:14538
  await pause(1200);
  if (snapshot().hasId('vpn-stop')) {        // BridgeStatus.ets:9606
    clickId('vpn-stop');
    await log.waitFor(/vpn_extension_destroyed/, 60000);
    await pause(4000);
  }
  clickId('tab-settings');                   // BridgeStatus.ets:14598
  await pause(1500);
  clickId('account-open');
  await pause(1500);
  if (!snapshot().hasId('logout-open')) {    // BridgeStatus.ets:11898
    return false;
  }
  clickId('logout-open');
  await pause(1500);
  const confirmed = clickNear('退出 Tailscale？', '退出登录') ||
    clickNear('Sign out of Tailscale?', 'Sign out');
  if (!confirmed) {
    return false;
  }
  await pause(5000);
  return !signedIn();
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
  ready = nodes().length > 0;
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('经系统浏览器登录并回落到未登录态', async (t) => {
  if (!process.env.MESHARC_ALLOW_LOGIN) {
    t.skip(GATE);
    return;
  }
  if (!ready) {
    t.skip('界面没有起来，登录旅程不适用。');
    return;
  }
  if (!(await ensureSignedOut())) {
    t.skip('到不了未登录态，登录旅程不适用。');
    return;
  }

  // 控制服务器已确认时登录按钮可点。见 BridgeStatus.ets:11762。
  if (!snapshot().hasId('account-login')) {   // BridgeStatus.ets:11770
    t.skip('控制服务器未确认，登录按钮不可点。先配置控制服务器。');
    return;
  }

  clickId('account-login');   // BridgeStatus.ets:11770 → openSecureLogin（:2061）
  // 授权页由系统浏览器打开。三种拉起方式任一成功都记这一条。
  const opened = await log.waitFor(/secure_login_browser_opened/, 60000); // :2220
  assert.ok(opened, '点了登录之后系统浏览器没有被拉起（没有 secure_login_browser_opened）');

  // 回到应用。startApp 拉起已在运行的界面。授权没有完成，登录态不变。
  startApp();
  await pause(5000);

  // 回落为未登录态，可重试。见 BridgeStatus.ets:4219。
  const state = snapshot();
  assert.ok(!state.hasId('account-open'), '授权未完成，界面却当成已登录');
  assert.ok(state.hasId('account-login') || state.hasId('account-login-disabled'),
    '授权未完成后界面没有回到未登录态');
});
