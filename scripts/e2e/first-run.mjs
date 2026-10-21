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
import { appFileExists, LogStream, clickText, forceStop, layoutTexts, screenshot, startApp } from './lib/device.mjs';

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
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接')
    || line.includes('需要登录'));
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

// 判据 O-SETUP-01 声明的用例。完整旅程要一台两个标记都没写过的设备。
//
// 欢迎框与更新日志各有一个开关标记，都写在 filesDir：
//   welcome-acknowledged          BridgeStatus.ets:1409 读，:1428 确认时写
//   update-changelog-seen-version :1161 读，按版本号比对内容，:1180 关闭时写
// 没写过就弹，写过就不再弹。所以「首次展示」这一半只能在没有标记的设备上测。
test('首次启动展示欢迎与更新日志且确认后不再打扰', async (t) => {
  const welcomeSeen = appFileExists('welcome-acknowledged');
  const changelogSeen = appFileExists('update-changelog-seen-version');
  if (welcomeSeen || changelogSeen) {
    t.skip('这台设备已经确认过（welcome-acknowledged '
      + `${welcomeSeen ? '在' : '不在'}、update-changelog-seen-version `
      + `${changelogSeen ? '在' : '不在'}）。前半条要一台没装过的设备。`
      + '工程诊断里的「重置为首次运行」能清掉这两个标记，'
      + '但它会一并清掉控制服务器配置，本设备不做。'
      + '后半条已由下面的用例在本设备上验证。');
    return;
  }
  const welcome = await log.waitFor(/MeshArcDiag: ui welcome_dialog_shown/, 20000);
  assert.ok(welcome, '没有欢迎框标记，冷启动却没有弹出欢迎框');
  assert.ok(clickText('我知道了'), '欢迎框弹出来了却点不到确认按钮');
  await pause(3000);
  assert.ok(appFileExists('welcome-acknowledged'),
    '点了确认之后标记文件没有写下来，下次启动还会再弹');
  assert.ok(log.lines.some((line) => /welcome_dialog_acknowledged/.test(line)),
    '确认动作没有留下诊断事件');

  const changelog = await log.waitFor(/MeshArcDiag: ui update_changelog_shown/, 20000);
  assert.ok(changelog, '欢迎框确认之后没有接着弹更新日志');
  assert.ok(clickText('仅更新时显示'), '更新日志面板上没有「仅更新时显示」按钮');
  await pause(3000);
  assert.ok(appFileExists('update-changelog-seen-version'),
    '关闭更新日志之后没有写下版本标记，下次启动还会再弹');
});

// 已确认的设备能验证的那一半：确认过之后不再打扰。
test('首次运行：确认过欢迎框与更新日志后冷启动不再打扰', async (t) => {
  if (!appFileExists('welcome-acknowledged')
    || !appFileExists('update-changelog-seen-version')) {
    t.skip('这台设备还有标记没写过，这一条要在两个都确认过之后才有意义。');
    return;
  }
  const welcome = log.lines.filter((line) => /welcome_dialog_shown/.test(line));
  const changelog = log.lines.filter((line) => /update_changelog_shown/.test(line));
  assert.equal(welcome.length, 0,
    `欢迎框标记在，冷启动却仍弹了 ${welcome.length} 次`);
  assert.equal(changelog.length, 0,
    `更新日志标记在，冷启动却仍弹了 ${changelog.length} 次`);
});
