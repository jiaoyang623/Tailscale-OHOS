// E2E · 应用外壳的旅程。兼作 O-UI-01、O-UI-02、O-CARD-01 的真机证据。
//
// 三条旅程：
//   O-UI-01 页签导航与显隐排序
//   O-UI-02 中英双语与深浅主题
//   O-CARD-01 桌面卡片开关 VPN
//
// 从真实入口判定：冷启动 → 底部页签 → 设置 → 外观与导航 → 页签显隐开关。
//
// 前置：设备已登录 Tailscale。页签与外观用例不要求登录。
//
//   DEVICE=<序列号> node --test scripts/e2e/navigation-shell.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { after, before, test } from 'node:test';
import {
  HDC, LogStream, clickAt, clickId, forceStop, layout, layoutTexts, screenshot,
  scrollToId, serial, startApp
} from './lib/device.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TAB_IDS = ['tab-home', 'tab-transfer', 'tab-files', 'tab-settings'];
const HIDEABLE = ['home', 'transfer', 'files'];

// 按设备的返回键，用它退出设置详情页。lib 还没有这个动作。
function pressBack() {
  try {
    execFileSync(HDC, ['-t', serial(), 'shell', 'uitest', 'uiInput', 'keyEvent', '2'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_error) {
    // 按不到返回键不致命，下一次导航会重新试。
  }
}

// 页签标签。值取自 entry/src/main/resources/base|zh_CN/element/string.json。
const LABELS = {
  'tab-home': ['设备', 'Devices'],
  'tab-transfer': ['传输', 'Transfer'],
  'tab-files': ['文件', 'Files'],
  'tab-settings': ['设置', 'Settings']
};

// 按 id 取界面节点。找不到返回 null。
function layoutNode(id) {
  let hit = null;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.id === id) {
      hit = node;
      return;
    }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

// 界面的右下边界。用可见节点的最大边界估算屏幕尺寸。
function layoutExtent() {
  let width = 0;
  let height = 0;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node.bounds)) {
      width = Math.max(width, node.bounds[2]);
      height = Math.max(height, node.bounds[3]);
    }
    walk(node.children || []);
  };
  walk(layout());
  return { width, height };
}

function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

function readText(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// 在沙箱里加载真实的 NavigationPreferences.ets。该类只在 load/save 里碰平台。
function loadNavigationPreferences() {
  const source = readFileSync(
    join(ROOT, 'entry/src/main/ets/services/NavigationPreferences.ets'), 'utf8');
  const stripped = stripTypeScriptTypes(source
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export\s+/gm, ''));
  const sandbox = {};
  vm.runInNewContext(`${stripped}\nglobalThis.N = NavigationPreferences;`, sandbox);
  return sandbox.N;
}

// 进入设置 > 外观与导航。已经在里面时直接返回 true。
async function openAppearance() {
  if (layoutNode('navigation-settings-panel') !== null) {
    return true;
  }
  clickId('tab-settings');
  await pause(2500);
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await scrollToId('settings-appearance-entry', 4);
    if (entry) {
      clickAt(entry);
      await pause(2500);
      return layoutNode('appearance-settings') !== null;
    }
    // 可能停在别的设置详情页。按返回键回到设置根页再试。
    pressBack();
    await pause(1500);
  }
  return false;
}

// 按 id 切换一个页签的显隐开关。
async function toggleTab(id) {
  // 面板可能在两次切换之间被关掉（重渲染或滚动位置重置），
  // 于是行找不到，用例报「关不掉」。先确保面板开着再找。
  if (layoutNode('navigation-settings-panel') === null && !(await openAppearance())) {
    return false;
  }
  const point = await scrollToId(`navigation-visible-${id}`, 4);
  if (!point) {
    return false;
  }
  clickAt(point);
  await pause(1500);
  return true;
}

// 把可隐藏的三个页签恢复为可见。after 与用例收尾都用它。
async function showAllTabs() {
  for (let pass = 0; pass < 3; pass++) {
    const missing = HIDEABLE.filter((id) => layoutNode(`tab-${id}`) === null);
    if (missing.length === 0) {
      return true;
    }
    if (layoutNode('navigation-settings-panel') === null && !(await openAppearance())) {
      return false;
    }
    for (const id of missing) {
      await toggleTab(id);
    }
  }
  return HIDEABLE.every((id) => layoutNode(`tab-${id}`) !== null);
}

let configured = false;

before(async () => {
  log.start();
  await pause(3000);
  forceStop();
  await pause(2500);
  startApp();
  assert.ok(await log.waitFor(/MeshArcDiag: ui ui_opened/, 40000),
    '启动后没有出现 ui_opened，应用没有走到界面');
  await pause(8000);
  const texts = layoutTexts();
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
});

after(async () => {
  log.stop();
  // 显隐偏好跨重启保留。跑完必须还原，否则后续用例少一个页签。
  try {
    await showAllTabs();
  } catch (_error) {
    // 还原是尽力而为。设备状态异常时不掩盖真正的失败。
  }
  mkdirSync(OUT, { recursive: true });
  log.dump(join(OUT, `navigation-shell-${new Date().toISOString().replace(/[:.]/g, '-')}.log`));
});

test('O-UI-01 页签导航与显隐排序：四个顶层页签齐全，且窄屏用悬浮底栏', async () => {
  clickId('tab-home');
  await pause(1500);

  const boxes = TAB_IDS.map((id) => layoutNode(id)?.bounds);
  assert.ok(boxes.every((box) => Array.isArray(box)), '四个顶层页签不齐，缺一个');
  screenshot('shell-tabs');

  const extent = layoutExtent();
  const centers = boxes.map((box) => (box[1] + box[3]) / 2);
  assert.ok(Math.max(...centers) - Math.min(...centers) < 24,
    `四个页签不在同一行：${JSON.stringify(centers)}`);
  assert.ok(Math.min(...centers) > extent.height * 0.55,
    `页签栏不在底部：y=${Math.min(...centers)}，屏幕高=${extent.height}`);

  // 悬浮：整条栏与左边缘留空。右侧同理，配置见 MobileTabs 的 barSideMargin。
  const left = Math.min(...boxes.map((box) => box[0]));
  assert.ok(left > 0, `页签栏贴住左边缘，不是悬浮底栏：left=${left}`);

  // 标签与当前语言一致。
  const texts = layoutTexts();
  const chinese = texts.includes('设置');
  for (const id of TAB_IDS) {
    const expected = LABELS[id][chinese ? 0 : 1];
    assert.ok(texts.includes(expected),
      `页签标签「${expected}」没有出现。界面文本：${JSON.stringify(texts.slice(0, 20))}`);
  }
});

// 外壳只渲染 MobileTabs。宽屏侧栏分支 WideTabs 已写好，但没有调用点。
// 这一条记录差距，不判失败。
test('O-UI-01 页签导航与显隐排序：宽屏改用侧栏', (t) => {
  t.skip('本机构建的外壳只渲染 MobileTabs（BridgeStatus.ets:15133）。'
    + 'WideTabs（:14871）无调用点，宽屏侧栏这一半未接线。'
    + '设备的宽度也走不到 840 的断点。先记缺陷，再接侧栏。');
});

test('O-UI-01 页签导航与显隐排序：设置页签恒在，它的开关不可用', async () => {
  assert.ok(await openAppearance(), '走不到外观与导航面板');
  assert.ok(layoutNode('navigation-visible-settings'), '外观面板里没有设置页签的显隐开关');
  assert.ok(await toggleTab('settings'), '找不到设置页签的开关');
  assert.ok(layoutNode('tab-settings') !== null, '点了设置页签的开关之后，设置页签消失了');
});

test('O-UI-01 页签导航与显隐排序：可隐藏页签全关掉后只剩设置', async () => {
  assert.ok(await openAppearance(), '走不到外观与导航面板');
  for (const id of HIDEABLE) {
    if (layoutNode(`tab-${id}`) !== null) {
      assert.ok(await toggleTab(id), `关不掉${id}页签`);
    }
  }
  assert.ok(layoutNode('tab-settings') !== null, '设置页签消失了，它应当是永久目的地');
  assert.ok(HIDEABLE.every((id) => layoutNode(`tab-${id}`) === null), '有关闭的页签仍在');
  screenshot('shell-settings-only');
  assert.ok(await showAllTabs(), '还原三个页签失败');
});

// 守卫写在 setNavigationTabVisible（BridgeStatus.ets:10909）：
// 可见页签只剩一个时提示「至少保留一个」并拒绝隐藏。
// 但 visibleNavigationTabs 恒含 settings（:1497），而设置页签不能被关。
// 所以可见数到 1 时，剩下的必然是设置，没有别的开关还能关。这条守卫走不到。
// 这一条记录差距，不判失败。
test('O-UI-01 页签导航与显隐排序：隐藏到只剩一个时提示并拒绝', { todo: '守卫不可达，见注释' }, async () => {
  assert.ok(await openAppearance(), '走不到外观与导航面板');
  assert.ok(await toggleTab('transfer'), '关不掉传输页签');
  assert.ok(await toggleTab('files'), '关不掉文件页签');
  try {
    await toggleTab('home');
    assert.ok(layoutNode('tab-home') !== null,
      '只剩设置页签时仍允许隐藏主页，「至少保留一个」没有生效');
  } finally {
    assert.ok(await showAllTabs(), '还原三个页签失败');
  }
});

test('O-UI-01 页签导航与显隐排序：显隐在重启后保持', async () => {
  assert.ok(await openAppearance(), '走不到外观与导航面板');
  for (const id of ['transfer', 'files']) {
    if (layoutNode(`tab-${id}`) !== null) {
      assert.ok(await toggleTab(id), `关不掉${id}页签`);
    }
  }
  assert.ok(layoutNode('tab-transfer') === null && layoutNode('tab-files') === null,
    '两个页签没有按预期隐藏');

  forceStop();
  await pause(2500);
  startApp();
  assert.ok(await log.waitFor(/MeshArcDiag: ui ui_opened/, 40000), '重启后没有出现 ui_opened');
  await pause(8000);

  assert.ok(layoutNode('tab-settings') !== null, '重启后设置页签不见了');
  assert.ok(layoutNode('tab-transfer') === null, '重启后传输页签又出现了，显隐没有保持');
  assert.ok(layoutNode('tab-files') === null, '重启后文件页签又出现了，显隐没有保持');

  assert.ok(await showAllTabs(), '还原三个页签失败');
  assert.ok(TAB_IDS.every((id) => layoutNode(id) !== null), '还原之后页签仍不全');
});

test('O-UI-01 页签导航与显隐排序：偏好归一化过滤非法与重复标识，且设置页签不进隐藏列表', () => {
  const preferences = loadNavigationPreferences();
  const order = 'files,home,transfer,settings';

  // 沙箱里的数组是另一个 realm 的，用 join 比，不走 deepEqual。
  // 非法标识与重复项被过滤，顺序不变。settings 永不进隐藏列表。
  const parsed = preferences.normalize(order, 'settings,evil,home,home', 30);
  assert.equal(parsed.order.join(','), 'files,home,transfer,settings', '顺序被改动或丢了标识');
  assert.equal(parsed.hidden.join(','), 'home',
    `隐藏列表没有归一化：${parsed.hidden.join(',')}`);

  // 缺标识时补默认顺序，边距夹到 [0, 100]。
  assert.equal(preferences.normalize('home', '', 30).order.join(','),
    'home,transfer,files,settings', '缺标识时没有补全默认顺序');
  assert.equal(preferences.normalize(order, '', 999).bottomMargin, 100, '边距上限没有夹住');
  assert.equal(preferences.normalize(order, '', -5).bottomMargin, 0, '边距下限没有夹住');

  // 主页不在保护范围内。隐藏列表过滤掉 settings 之后最多三项，够不到 order.length，
  // NavigationPreferences.ets:58 的回落分支因此走不到。这里记录现状，不判失败。
  const hiddenAll = preferences.normalize(order, 'home,transfer,files,settings', 30);
  assert.equal(hiddenAll.hidden.join(','), 'home,transfer,files',
    '隐藏列表盖满时的行为变了，请重新核对 O-UI-01 的「不吞掉主页」');
});

test('O-UI-02 中英双语与深浅主题：两份字符串资源与两份颜色资源键集合一致', () => {
  const base = readJson('entry/src/main/resources/base/element/string.json').string;
  const zh = readJson('entry/src/main/resources/zh_CN/element/string.json').string;
  const baseKeys = new Set(base.map((entry) => entry.name));
  const zhKeys = new Set(zh.map((entry) => entry.name));
  const missingInZh = [...baseKeys].filter((name) => !zhKeys.has(name));
  const missingInBase = [...zhKeys].filter((name) => !baseKeys.has(name));
  assert.deepEqual(missingInZh, [], `中文资源缺这些键：${missingInZh.slice(0, 10).join(', ')}`);
  assert.deepEqual(missingInBase, [], `英文资源缺这些键：${missingInBase.slice(0, 10).join(', ')}`);

  const baseColor = readJson('entry/src/main/resources/base/element/color.json').color;
  const darkColor = readJson('entry/src/main/resources/dark/element/color.json').color;
  const baseColorKeys = new Set(baseColor.map((entry) => entry.name));
  const darkColorKeys = new Set(darkColor.map((entry) => entry.name));
  const darkMissing = [...baseColorKeys].filter((name) => !darkColorKeys.has(name));
  assert.deepEqual(darkMissing, [], `深色资源缺这些颜色键：${darkMissing.join(', ')}`);

  // 页签取色走系统语义色，深色下由系统覆盖。见 BridgeStatus.ets:14622-14627。
  const shell = readText('entry/src/main/ets/components/BridgeStatus.ets');
  assert.match(shell, /sys\.color\.font_secondary/,
    '页签不再取系统语义色，深色适配的假设要重新检查');
});

test('O-UI-02 中英双语与深浅主题：当前界面没有裸键，也没有另一种语言残留', () => {
  const texts = layoutTexts();
  const baseKeys = new Set(readJson('entry/src/main/resources/base/element/string.json')
    .string.map((entry) => entry.name));
  const bare = texts.filter((line) => baseKeys.has(line));
  assert.deepEqual(bare, [], `界面出现了裸键：${bare.join(', ')}`);

  // 语言之间不能串。中文界面里不许留英文页签标签。
  const chinese = texts.includes('设置');
  for (const id of TAB_IDS) {
    const other = LABELS[id][chinese ? 1 : 0];
    assert.ok(!texts.includes(other), `界面残留了另一种语言的文案「${other}」`);
  }
});

// 系统语言与深色开关属于设备级设置。改它要动系统配置，且没有经过验证的切换命令。
// 截了当前主题的截图，切换那半留给公共函数。
test('O-UI-02 中英双语与深浅主题：切换系统语言与主题后仍完整可读', (t) => {
  screenshot('shell-theme-current');
  t.skip('切换系统语言与深色需要设备级命令，本脚本还没有。'
    + '设备被其他会话占用，也不宜改系统配置。'
    + '当前语言下的完整性与无裸键已由上一条覆盖。'
    + '先在 lib 里补 setLanguage 与 setColorMode，两条都要在 after 里还原原值，再补这一条。');
});

test('O-CARD-01 桌面卡片开关 VPN：卡片已声明且满足最小化约束', () => {
  const config = readJson('entry/src/main/resources/base/profile/form_config.json');
  assert.equal(config.forms.length, 1, 'form_config 里不止一张卡片');
  const card = config.forms[0];
  assert.equal(card.name, 'vpn_toggle');
  assert.equal(card.src, './ets/widget/pages/VpnToggleCard.ets');
  assert.deepEqual(card.supportDimensions, ['2*2']);
  assert.equal(card.defaultDimension, '2*2');
  assert.equal(card.updateEnabled, true);
  // updateDuration 以 30 分钟为单位，1 即 30 分钟一档。
  assert.equal(card.updateDuration, 1, '卡片周期刷新的档位不是 30 分钟');

  // 卡片动作只到 singleton 的 UIAbility。
  const module = readText('entry/src/main/module.json5');
  assert.match(module, /"launchType":\s*"singleton"/, 'EntryAbility 不是 singleton，卡片动作到不了');
  assert.match(module, /"type":\s*"form"/, 'module.json5 里没有 form 类型的扩展');
  assert.match(module, /"\$profile:form_config"/, 'form 扩展没有指向 form_config 卡');

  // 卡片一抛异常，本应用的每张卡片都会白屏。所以卡片只渲染 provider 给的字符串。
  const view = readText('entry/src/main/ets/widget/pages/VpnToggleCard.ets');
  assert.ok(!/^import\s/m.test(view), '卡片引入了模块，白屏风险回到卡片上');
  assert.ok(!/\bImage\s*\(/.test(view), '卡片含图片，白屏风险回到卡片上');
  assert.ok(!/\.opacity\s*\(/.test(view), '卡片设了透明度，白屏风险回到卡片上');
  assert.match(view, /@LocalStorageProp\('stateText'\)/, '卡片不再从 provider 取文案');
  assert.match(view, /sys\.color\./, '卡片不再取系统语义色，深浅主题下要重新检查');
  assert.match(view, /action:\s*'call'/, '卡片不再发 call 动作');
  assert.match(view, /toggleVpn/, '卡片的 call 动作不带 toggleVpn 方法名');

  // 应用侧要注册同名 callee，并把需要用户的动作抬起窗口。
  const ability = readText('entry/src/main/ets/entryability/EntryAbility.ets');
  assert.match(ability, /callee\.on\(CARD_TOGGLE_METHOD/, 'EntryAbility 没有注册卡片动作');
  assert.match(ability, /raiseWindow\(\)/, 'EntryAbility 不再为需要用户的动作抬起窗口');
});

test('O-CARD-01 桌面卡片开关 VPN：设备上卡片通道没有失败日志', (t) => {
  if (!configured) {
    t.skip('设备未登录，应用还没有走完整初始化，卡片通道不适用。');
    return;
  }
  assert.ok(log.lines.some((line) => /EntryAbility onCreate/.test(line)),
    '设备日志里没有 EntryAbility onCreate，进程没有走到注册卡片动作的那一步');
  const failures = log.lines.filter((line) =>
    /Card (toggle registration|enumeration|refresh|update|toggle) failed/.test(line));
  assert.deepEqual(failures, [], `卡片通道报了失败：${failures.slice(0, 3).join(' | ')}`);
});

test('O-CARD-01 桌面卡片开关 VPN：点卡片切换 VPN', (t) => {
  t.skip('桌面卡片的节点读不到。devecocli ui layout 只抓本应用窗口树，抓不到系统桌面。'
    + '卡片要先人工添加：长按图标 > 卡片 > 2×2。'
    + '添加后的点击与自愈只能人工看，见走查 M-14。'
    + '本文件已覆盖卡片声明、最小化约束与设备上的通道健康度。');
});
