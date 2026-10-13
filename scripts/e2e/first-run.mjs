// E2E · 首次运行的旅程。
//
// 从真实入口走到用户结果：系统拉起 EntryAbility → 界面出现 → 首次运行的提示
// 与系统权限对话框被处理 → 停在首页。
//
// 这条不需要登录，所以在拿到真机的当天就能执行。它是本层的第一条，
// 用来验证「设备驱动的 E2E」这套架子真的能跑，而不是纸上的一条计划。
//
//   DEVICE=<序列号> node --test scripts/e2e/first-run.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LogStream, clickText, forceStop, layoutTexts, screenshot, startApp } from './lib/device.mjs';

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 这台设备是否已经配置过。在 before 里算一次，三条用例共用同一个判断，
// 不能各算各的：应用还没稳定时算出来的是假，会让用例时跑时跳。
let configured = false;
const SKIP = '这台设备已经配置并登录过，首次运行的旅程不适用。换一台没装过的设备再跑。';

before(async () => {
  log.start();
  // hilog 起流要一点时间，先让它连上，否则会漏掉启动最初的行。
  await pause(4000);
  forceStop();
  await pause(2500);
  startApp();
  const opened = await log.waitFor(/MeshArcDiag: ui ui_opened/, 40000);
  assert.ok(opened, '启动后没有出现 ui_opened，应用没有走到界面');
  // 等后端初始化落定再判断状态。
  await pause(9000);
  const texts = layoutTexts();
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
});

after(() => {
  log.stop();
});

test('首次运行：系统权限对话框被处理后停在首页', async (t) => {
  if (configured) {
    t.skip(SKIP);
    return;
  }
  // 权限对话框只在第一次出现。出现就处理掉，这也是旅程的一部分。
  if (layoutTexts().includes('允许')) {
    assert.ok(clickText('允许'), '看到权限对话框却点不到允许');
    await pause(3000);
    assert.ok(!layoutTexts().includes('允许“MeshArc”向你发送通知？'),
      '点了允许之后系统权限对话框还在');
  }

  const texts = layoutTexts();
  screenshot('first-run-home');
  assert.ok(texts.some((line) => line.includes('MeshArc')),
    `首页没有出现应用名。界面文本：${JSON.stringify(texts.slice(0, 20))}`);
});

test('首次运行：未配置后端服务器时如实说明，不假装可用', (t) => {
  if (configured) { t.skip(SKIP); return; }
  const texts = layoutTexts();
  assert.ok(texts.some((line) => line.includes('后端服务器')),
    `未配置服务器时首页没有给出说明。界面文本：${JSON.stringify(texts.slice(0, 20))}`);
  assert.ok(texts.some((line) => line.includes('登录')),
    '首页没有给出登录入口');
});

test('首次运行：提示是诊断事件，主机侧看得到', async (t) => {
  if (configured) { t.skip(SKIP); return; }
  // 这条同时守住证据通道：界面上的东西必须同时有一条设备日志。
  const tip = await log.waitFor(/MeshArcDiag: ui control_server_tip_shown/, 10000);
  assert.ok(tip, '首页给了服务器提示，设备日志里却没有对应事件');
});
