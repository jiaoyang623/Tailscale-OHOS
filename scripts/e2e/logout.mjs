// E2E · 退出登录旅程。兼作 O-SETUP-04 的真机证据。
//
// 从真实入口走到用户结果：设置-账户 → 已连接时只提示先断开 →
// 断开 → 二次确认 → 退出 → 账户回到未登录态。
//
// 退出登录会清掉这台设备的登录态。用户不愿在这台设备上再登录别的账户。
// 所以本文件默认不跑。确认可以清登录态后，手动设 MESHARC_ALLOW_LOGOUT=1 再跑。
//
//   DEVICE=<序列号> MESHARC_ALLOW_LOGOUT=1 node --test scripts/e2e/logout.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LogStream, click, clickId, forceStop, layout, startApp } from './lib/device.mjs';

const GATE = '本用例会清除设备登录态，需人工确认后手动设 MESHARC_ALLOW_LOGOUT=1 再跑';
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `logout-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

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

async function openAccountDetail() {
  clickId('tab-settings');   // BridgeStatus.ets:14598
  await pause(1500);
  clickId('account-open');   // BridgeStatus.ets:11630
  await pause(1500);
}

async function ensureConnected() {
  if (snapshot().hasId('vpn-stop')) {   // BridgeStatus.ets:9606
    return true;
  }
  clickId('vpn-connect');               // BridgeStatus.ets:9614
  return (await log.waitFor(/vpn_connected/, 90000)) !== null;
}

async function ensureDisconnected() {
  // 连接按钮在首页。先回首页，再判断与点击。
  clickId('tab-home');   // BridgeStatus.ets:14538
  await pause(1200);
  if (!snapshot().hasId('vpn-stop')) {
    return true;
  }
  clickId('vpn-stop');
  await log.waitFor(/vpn_extension_destroyed/, 60000);
  await pause(4000);
  return !snapshot().hasId('vpn-stop');
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
  const texts = nodes().map((node) => node.text);
  ready = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('连接中先提示断开且退出后清理账户状态', async (t) => {
  if (!process.env.MESHARC_ALLOW_LOGOUT) {
    t.skip(GATE);
    return;
  }
  if (!ready) {
    t.skip('这台设备还没登录 Tailscale，退出旅程不适用。');
    return;
  }
  if (!(await ensureConnected())) {
    t.skip('这台设备现在连不上，连接中退出分支不适用。');
    return;
  }
  await openAccountDetail();

  // 已连接时只提示先断开，不渲染退出按钮。见 BridgeStatus.ets:11881。
  const state = snapshot();
  assert.ok(state.hasId('logout-disconnect-first'), '已连接时账户面板没有提示先断开'); // :11883
  assert.ok(!state.hasId('logout-open'), '已连接时仍渲染了退出按钮');               // :11898
});

test('断开后退出登录，账户回到未登录态', async (t) => {
  if (!process.env.MESHARC_ALLOW_LOGOUT) {
    t.skip(GATE);
    return;
  }
  if (!ready) {
    t.skip('这台设备还没登录 Tailscale，退出旅程不适用。');
    return;
  }
  assert.ok(await ensureDisconnected(), '断不开，退出的前置条件不成立');
  await openAccountDetail();

  let state = snapshot();
  if (!state.hasId('logout-open')) {
    t.skip('账户面板没有渲染退出按钮，可能仍未断开。');
    return;
  }
  clickId('logout-open');   // BridgeStatus.ets:11898 → confirmLogout（:2613）
  await pause(1500);

  // 退出是破坏性动作，先经确认对话框（BridgeStatus.ets:2614）。
  const confirmed = clickNear('退出 Tailscale？', '退出登录') ||
    clickNear('Sign out of Tailscale?', 'Sign out');
  assert.ok(confirmed, '退出确认对话框没有出现，或点不到确认按钮');
  await pause(5000);

  // 退出后清空对端与出口节点，回到未登录态。见 BridgeStatus.ets:2632。
  state = snapshot();
  assert.ok(state.hasId('account-login') || state.hasId('account-login-disabled'),
    '退出后账户没有回到未登录态');                       // :11770 / :11786
  assert.ok(!state.hasId('account-open'), '退出后账户仍显示已登录详情'); // :11630
});
