// E2E · 诊断的旅程。兼作 O-DIAG-01 与 QG-06 的真机证据。
//
// 从真实入口判定：冷启动 → 设置 → 关于与帮助 → 连点版本号 5 次解锁 →
// 生成报告 → 系统分享 → 报告落盘。
//
// 解锁要求在 1500 ms 内点满 5 次（BridgeStatus.ets:4949 onAppVersionTap）。
// 每次 devecocli ui click 要起一个进程，来不及。所以连点走设备侧的 uitest。
//
// 报告 zip 落在 cacheDir。宿主侧读不到，要 file recv 拉回来再看。
// 拉不回来时那一条跳过，并写明原因。
//
// 前置：设备已安装本批构建。报告生成不要求登录。
//
//   DEVICE=<序列号> node --test scripts/e2e/diagnostics-report.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import {
  HDC, LogStream, clickAt, clickId, fastTap, forceStop, layout, layoutTexts,
  readAppFile, screenshot, scrollToId, serial, startApp, textOfId
} from './lib/device.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');

// 与 lib/device.mjs 的 FILES_DIR 同一根。100 是这台设备上的用户号。
const CACHE_DIR = '/data/app/el2/100/base/ren.w2h.mesharc/haps/entry/cache';
const UI_EVENTS = 'diagnostic-ui-events.ndjson';
const VPN_EVENTS = 'diagnostic-vpn-events.ndjson';
const EVENT_KEYS = ['code', 'event', 'phase', 'source', 'timestampMs'];

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let reportZip = '';
let configured = false;

// 裸 hdc。lib 只导出设备动作，报告 zip 要自己拉。
function hdcRaw(args) {
  return execFileSync(HDC, ['-t', serial(), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}

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

// 读一个落盘的事件文件，解析成事件数组。
function readEvents(name) {
  return readAppFile(name).split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

// 进设置 > 关于与帮助。返回 true 表示已到关于页。
async function openAbout() {
  // 已经停在关于页时直接返回。切换页签不销毁设置页的导航栈。
  if (layoutNode('app-version-action') !== null) {
    return true;
  }
  clickId('tab-settings');
  await pause(2500);
  for (let attempt = 0; attempt < 3; attempt++) {
    const about = await scrollToId('settings-about-entry', 3);
    if (about) {
      clickAt(about);
      await pause(3000);
      return true;
    }
    // 可能停在别的设置详情页。按返回键回到设置根页再试。
    pressBack();
    await pause(1500);
  }
  return false;
}

// 走到关于页的工程诊断区。解锁状态只在进程内存里，冷启动会丢，所以每次重新点。
async function openDiagnostics() {
  if (!(await openAbout())) {
    return false;
  }
  const version = await scrollToId('app-version-action', 3);
  if (!version) {
    return false;
  }
  fastTap(version[0], version[1], 5);
  await pause(2500);
  return layoutNode('diagnostics-disclosure') !== null;
}

// 按设备的返回键。用它关掉系统分享面板，也用它退出设置详情页。
function pressBack() {
  try {
    hdcRaw(['shell', 'uitest', 'uiInput', 'keyEvent', '2']);
  } catch (_error) {
    // 按不到返回键不致命，压栈的面板不影响后面的读写。
  }
}

// 从 zip 里取一个文本条目。宿主用 python3 解压。
function unzipEntry(zipPath, entry) {
  const script = 'import sys, zipfile\n'
    + 'z = zipfile.ZipFile(sys.argv[1])\n'
    + 'sys.stdout.write(z.read(sys.argv[2]).decode("utf-8"))';
  return execFileSync('python3', ['-I', '-c', script, zipPath, entry],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

// 加载真实的 DiagnosticPrivacy.ets。该类不依赖平台，可直接在沙箱里跑。
function loadDiagnosticPrivacy() {
  const source = readFileSync(join(ROOT, 'entry/src/main/ets/services/DiagnosticPrivacy.ets'), 'utf8');
  const stripped = stripTypeScriptTypes(source
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export\s+/gm, ''));
  const sandbox = {};
  vm.runInNewContext(`${stripped}\nglobalThis.P = DiagnosticPrivacy;`, sandbox);
  return sandbox.P;
}

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

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(join(OUT, `diagnostics-report-${new Date().toISOString().replace(/[:.]/g, '-')}.log`));
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：关于页默认没有诊断入口', async () => {
  assert.ok(await openAbout(), '走不到设置 > 关于与帮助');
  assert.ok(layoutNode('app-version-action'), '关于页没有版本号行，连点解锁无从开始');
  assert.ok(layoutNode('diagnostics-disclosure') === null,
    '还没连点版本号，诊断折叠区就已经渲染出来了');
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：连点 5 次解锁，折叠区出现', async () => {
  assert.ok(await openDiagnostics(), '连点 5 次之后诊断折叠区没有出现');
  assert.ok(await log.waitFor(/MeshArcDiag: ui feature_diagnostics_unlocked/, 10000),
    '解锁了却没有留下 feature_diagnostics_unlocked 事件');
  screenshot('diagnostics-unlocked');
  const generate = await scrollToId('diagnostic-report-generate', 8);
  assert.ok(generate, '解锁后的诊断区里找不到生成报告按钮');
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：连接、握手与扩展生命周期留下可复核事件', async (t) => {
  if (!configured) {
    t.skip('设备未登录，连接这一段走不到，先登录再跑。');
    return;
  }
  assert.ok(layoutNode('tab-settings'), '界面结构读不到，先回到应用再跑这条');
  clickId('tab-home');
  await pause(2000);
  if (layoutNode('vpn-stop') === null) {
    clickId('vpn-connect');
    assert.ok(await log.waitFor(/vpn_connected/, 90000),
      '点了连接之后设备日志里没有出现 vpn_connected');
  }
  await pause(4000);

  const ui = readEvents(UI_EVENTS);
  const vpn = readEvents(VPN_EVENTS);
  assert.ok(ui.length > 0, `${UI_EVENTS} 是空的，UI 进程一个事件也没落盘`);
  assert.ok(vpn.length > 0, `${VPN_EVENTS} 是空的，扩展进程一个事件也没落盘`);

  // 连接：UI 进程。
  assert.ok(ui.some((item) => ['connect_requested', 'vpn_start_requested', 'background_started']
    .includes(item.event)), 'UI 事件里没有连接相关的事件');
  // 扩展生命周期与 TUN 握手：扩展进程。
  const vpnNames = vpn.map((item) => item.event);
  assert.ok(vpnNames.includes('vpn_extension_created'),
    `扩展生命周期事件没有落盘：${vpnNames.slice(-5).join(', ')}`);
  assert.ok(vpnNames.includes('vpn_tun_created'),
    `TUN 握手事件没有落盘：${vpnNames.slice(-5).join(', ')}`);
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：落盘事件只含安全字段', () => {
  for (const name of [UI_EVENTS, VPN_EVENTS]) {
    const events = readEvents(name);
    assert.ok(events.length > 0, `${name} 是空的`);
    for (const item of events) {
      assert.deepEqual(Object.keys(item).sort(), EVENT_KEYS,
        `${name} 里出现了五个字段以外的东西：${JSON.stringify(item)}`);
    }
    // 事件名与阶段是归一化过的 token。文件里不许出现认证 URL、bearer 或密码。
    const raw = readAppFile(name);
    for (const pattern of ['://', 'Bearer', 'tskey', 'password', 'secret=']) {
      assert.ok(!raw.includes(pattern), `${name} 里出现了「${pattern}」：落盘前没有脱敏`);
    }
  }
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：生成报告得到 zip，并打开系统分享', async () => {
  // 上一条切到了首页，解锁标志随生命周期清回 false，这里重新解锁。
  assert.ok(await openDiagnostics(), '重新解锁诊断失败');
  const generate = await scrollToId('diagnostic-report-generate', 8);
  assert.ok(generate, '找不到生成报告按钮');
  clickAt(generate);

  assert.ok(await log.waitFor(/MeshArcDiag: ui diagnostic_report_requested/, 15000),
    '点了生成之后没有 diagnostic_report_requested 事件');
  assert.ok(await log.waitFor(/MeshArcDiag: ui diagnostic_report_generated/, 60000),
    '报告没有生成：设备日志里没有 diagnostic_report_generated');
  assert.ok(!log.lines.some((line) => /diagnostic_report_failed/.test(line)),
    '报告生成失败，设备日志里有 diagnostic_report_failed');

  // 状态文字是 diagnosticReportStatus。应用在记 diagnostic_report_generated 之前
  // 就把它改成文件名（BridgeStatus.ets:4303），所以事件到了，状态就该是文件名。
  // 2026-10-13 两次实测主机都读到旧值「正在生成诊断报告…」，原因未定。
  // 疑似系统分享面板持有焦点时，布局导出不反映应用窗口的新一帧。
  // 这里先等分享事件，再关面板，再读状态行。
  assert.ok(await log.waitFor(/MeshArcDiag: ui diagnostic_share_opened/, 30000),
    '报告生成了，但没有走到系统分享：设备日志里没有 diagnostic_share_opened');
  pressBack();
  await pause(3000);

  // 状态行给出文件名与大小。文件名形如 TailscaleOHOS-Diagnostic-<时间戳>.zip。
  let status = '';
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    status = textOfId('diagnostic-report-status') || '';
    if (/^TailscaleOHOS-Diagnostic-.*\.zip \(\d+ KB\)$/.test(status)) {
      break;
    }
    await pause(1500);
  }
  assert.match(status, /^TailscaleOHOS-Diagnostic-.*\.zip \(\d+ KB\)$/,
    `诊断报告状态行不可读或不对：${JSON.stringify(status)}`);

  // 记下 zip 名字，下一条拉回来审查。缓存目录读不到时留空，那条会跳过。
  try {
    const listing = hdcRaw(['shell', 'ls', CACHE_DIR]);
    reportZip = listing.split(/\s+/).find((name) => /^TailscaleOHOS-Diagnostic-.*\.zip$/.test(name)) || '';
  } catch (_error) {
    reportZip = '';
  }
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：导出的 zip 不含令牌、认证 URL、账号与 tailnet 地址', async (t) => {
  if (!reportZip) {
    t.skip('缓存目录里没读到报告 zip。宿主侧需要 file recv，本脚本还没有公共函数。'
      + '请先在 lib 里补 pullAppFile 与 readCacheFile，本条才能无条件执行。');
    return;
  }
  const localDir = join(tmpdir(), `mesharc-report-${Date.now()}`);
  mkdirSync(localDir, { recursive: true });
  const localZip = join(localDir, reportZip);
  try {
    hdcRaw(['file', 'recv', `${CACHE_DIR}/${reportZip}`, localZip]);
  } catch (error) {
    t.skip(`拉不回报告 zip：${error.message}。先补 lib 的 pullAppFile 再跑本条。`);
    return;
  }

  const summary = unzipEntry(localZip, 'summary.txt');
  const report = JSON.parse(unzipEntry(localZip, 'report.json'));

  // 报告自己声明的四项排除。见 DiagnosticReportService.ets:310 的 privacy 块。
  assert.equal(report.privacy.rawHiLogIncluded, false, '报告里带了原始 HiLog');
  assert.equal(report.privacy.rawBackendSnapshotIncluded, false, '报告里带了原始后端快照');
  assert.equal(report.privacy.identityFieldsIncluded, false, '报告里带了账号身份');
  assert.equal(report.privacy.networkAddressesIncluded, false, '报告里带了网络地址');

  // 地址只留计数。见 DiagnosticReportService.ets:506 的 summary 行。
  assert.ok(summary.includes('Submitted VPN configuration (addresses redacted)'),
    '摘要没有声明地址已抹掉');
  assert.equal(typeof report.vpnConfig.addressCount, 'number', 'VPN 配置里没有地址计数');
  assert.equal(report.vpnConfig.addresses, undefined, 'VPN 配置里出现了原始地址列表');
  assert.equal(report.network.addresses, undefined, '网络段里出现了原始地址列表');

  // 令牌、认证 URL、账号与 tailnet 地址一律不许出现。
  const text = `${summary}\n${JSON.stringify(report)}`;
  assert.ok(!text.includes('://'), '报告里出现了 URL');
  assert.ok(!/Bearer\s/i.test(text), '报告里出现了 bearer');
  assert.ok(!/tskey/i.test(text), '报告里出现了 Tailscale 令牌');
  assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text), '报告里出现了账号标识');
  // 100.64.0.0/10 与 fd7a:115c:a1e0::/48 是 tailnet 的地址段。
  assert.ok(!/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(text), '报告里出现了 tailnet IPv4 地址');
  assert.ok(!/fd7a:115c:a1e0/i.test(text), '报告里出现了 tailnet IPv6 地址');

  // 摘要末尾必须声明排除了哪些东西。
  assert.ok(summary.includes('Privacy'), '摘要里没有 Privacy 段');
  assert.ok(summary.includes('network addresses'), 'Privacy 段没有声明排除网络地址');
});

test('O-DIAG-01 解锁诊断并导出脱敏报告：脱敏边界逐条抹掉 URL、bearer、令牌键与查询令牌', () => {
  const privacy = loadDiagnosticPrivacy();

  // 认证 URL：整段替换成 <redacted>。
  assert.equal(privacy.redactForLog('open https://controlplane.tailscale.com/key?x=1 done'),
    'open https://<redacted> done');
  // bearer 与 basic：替换成 <redacted-auth>。
  assert.equal(privacy.redactForLog('auth Bearer tskey-auth-abcdef'), 'auth <redacted-auth>');
  assert.equal(privacy.redactForLog('auth Basic dXNlcjpwYXNz'), 'auth <redacted-auth>');
  // token/secret 键：替换成 <redacted-secret>。
  assert.equal(privacy.redactForLog('access_token=abc123 secret:xyz'), '<redacted-secret> <redacted-secret>');
  // 查询串里的令牌：只抹值，保留键名。
  assert.equal(privacy.redactForLog('?token=t-99&sig=aa'), '?token=<redacted>&sig=<redacted>');

  // 落盘上限。见 R-DIAG-03。
  assert.equal(privacy.MAX_EVENTS_PER_FILE, 100, '单文件条数上限变了');
  assert.equal(privacy.MAX_EVENT_FILE_BYTES, 24 * 1024, '单文件字节上限变了');
  assert.equal(privacy.MAX_REPORT_JSON_BYTES, 128 * 1024, 'report.json 的字节上限变了');
});
