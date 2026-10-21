// E2E · 隐私区。兼作 O-PRIV-01 与 O-PRIV-02 的真机证据。
//
// O-PRIV-01：应用锁。开启与关闭都要经过系统认证，开启后回前台即锁定。
// O-PRIV-02：Taildrive 文件夹锁。受保护目录在解锁前不渲染内容，回前台清空授权。
//
// 本用例观察的界面节点与诊断事件，源码位置如下：
//   security-settings-panel        BridgeStatus.ets:13994
//   security-app-lock-toggle       BridgeStatus.ets:13961
//   security-folder-lock-toggle    BridgeStatus.ets:13985
//   security-app-lock-overlay      BridgeStatus.ets:14995
//   app_lock_setting_auth_started  BridgeStatus.ets:1337
//   app_lock_setting_saved         BridgeStatus.ets:1354
//   app_lock_setting_auth_completed BridgeStatus.ets:1346
//   folder_lock_setting_auth_started BridgeStatus.ets:1376
//   folder_lock_setting_saved      BridgeStatus.ets:1391
//   文件夹访问认证 folder_access_auth_started  TaildriveBrowser.ets:712
//
// 认证走系统组件（AppSecurityAuthenticator.ets:13，ATL2）。脚本不能代替人输入
// 生物识别或 PIN。设备是否有已录入的凭据未知。
//
// 前置：设备已登录 Tailscale。未登录时开关用例跳过。
//
//   DEVICE=<序列号> node --test scripts/e2e/security-locks.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, centerOfId, clickAt, clickId, forceStop, layoutTexts, pressBack, screenshot,
  scrollToId, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `security-locks-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const NOT_LOGGED_IN = '这台设备还没登录 Tailscale，安全设置不适用。先登录再跑。';
const AUTH_DIALOG = '系统认证弹窗等待人工操作。脚本不能完成生物识别或 PIN，跳过。';

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;

// 切到别的页签再切回设置，清空二级页面栈，回到设置首页（BridgeStatus.ets:1561）。
async function resetToSettingsHome() {
  // 二级页面会盖住页签栏，此时 tab-home 不在布局树里，clickId 会直接抛错。
  // 先按返回退出来，再切页签。
  for (let attempt = 0; attempt < 3 && !centerOfId('tab-home'); attempt++) {
    pressBack();
    await pause(1500);
  }
  if (centerOfId('tab-home')) {
    clickId('tab-home');
    await pause(1500);
  }
  if (centerOfId('tab-settings')) {
    clickId('tab-settings');
    await pause(2500);
  }
}

async function openSecurityDetail() {
  await resetToSettingsHome();
  const entry = await scrollToId('settings-security-entry');
  if (!entry) {
    return false;
  }
  clickAt(entry);
  await pause(2500);
  return textOfId('security-app-lock-toggle') !== null ||
    textOfId('security-folder-lock-toggle') !== null;
}

// 切换一个安全开关，并判定认证门的走向。
// 返回 'saved'、'rejected' 或 'waiting'（弹窗等人工）。
async function flipAndWatch(toggleId, startedPattern, mark) {
  clickId(toggleId);
  const started = await log.waitForAfter(mark, startedPattern, 15000);
  assert.ok(started, `切换 ${toggleId} 没有触发系统认证（没有 ${startedPattern}）`);
  const outcome = await log.waitForAfter(mark, /setting_saved|_auth_completed|setting_failed/, 20000);
  if (outcome === null) {
    // 系统认证窗还挂着等人工。用例会跳过，但**必须先把窗关掉**：
    // 它盖在应用之上，后面的用例连设置页都进不去（2026-10-13 实测，
    // 上一条跳过后下一条报「打不开安全设置页」）。
    pressBack();
    await pause(2000);
    return 'waiting';
  }
  if (/setting_saved/.test(outcome)) {
    return 'saved';
  }
  // 认证未通过：不得写入。
  assert.equal(log.countAfter(mark, /setting_saved/), 0,
    '认证没有通过，却记录了 setting_saved');
  return 'rejected';
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
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('安全设置：应用锁与文件夹锁开关都在面板里', async (t) => {
  if (!configured) {
    t.skip(NOT_LOGGED_IN);
    return;
  }
  assert.ok(await openSecurityDetail(), '打不开安全设置页');
  assert.ok(textOfId('security-app-lock-toggle') !== null, '没有应用锁开关');
  assert.ok(textOfId('security-folder-lock-toggle') !== null, '没有文件夹锁开关');
  screenshot('security-locks-panel');
});

test('应用锁：切换开关先走系统认证，未通过不误报成功', async (t) => {
  if (!configured) {
    t.skip(NOT_LOGGED_IN);
    return;
  }
  assert.ok(await openSecurityDetail(), '打不开安全设置页');
  const mark = log.mark();
  const outcome = await flipAndWatch('security-app-lock-toggle', /app_lock_setting_auth_started/, mark);
  if (outcome === 'waiting') {
    t.skip(AUTH_DIALOG);
    return;
  }
  if (outcome === 'saved') {
    // 认证通过，应用锁已开。改回原值：关闭同样要认证。
    clickId('security-app-lock-toggle');
    assert.ok(await log.waitForAfter(mark, /app_lock_setting_saved/, 20000), '关闭应用锁没有成功');
    return;
  }
  assert.equal(outcome, 'rejected', `认证门结果未知：${outcome}`);
});

test('文件夹锁：切换开关先走系统认证，未通过不误报成功', async (t) => {
  if (!configured) {
    t.skip(NOT_LOGGED_IN);
    return;
  }
  assert.ok(await openSecurityDetail(), '打不开安全设置页');
  const mark = log.mark();
  const outcome = await flipAndWatch('security-folder-lock-toggle', /folder_lock_setting_auth_started/, mark);
  if (outcome === 'waiting') {
    t.skip(AUTH_DIALOG);
    return;
  }
  if (outcome === 'saved') {
    clickId('security-folder-lock-toggle');
    assert.ok(await log.waitForAfter(mark, /folder_lock_setting_saved/, 20000), '关闭文件夹锁没有成功');
    return;
  }
  assert.equal(outcome, 'rejected', `认证门结果未知：${outcome}`);
});

test('应用锁：开启后回到前台显示锁定层', (t) => {
  // 要先开启应用锁，而开启要走系统认证。锁定层 security-app-lock-overlay 只在
  // 应用锁已开、且回到前台时才渲染（BridgeStatus.ets:15148 bindContentCover）。
  // 回到前台的驱动件已就绪（device.mjs sendHome），缺的是开启这一步。
  t.skip('本用例需要先开启应用锁。开启要走系统认证，脚本不能完成生物识别或 PIN。需人工在设备上开启后重跑。');
});

test('文件夹锁：受保护目录在解锁前不渲染内容', (t) => {
  // 受保护目录来自 Taildrive 浏览器的对端分享（TaildriveBrowser.ets:703 ensureFolderAccess）。
  // 进入目录前要过系统认证，且目录本身要由一台对端设备提供。
  t.skip('本用例需要连接状态、一台对端设备提供 Taildrive 内容，并需人工通过系统认证。本机没有第二台设备，跳过。');
});
