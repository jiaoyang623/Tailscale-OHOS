// E2E · 连接窗口期切到其它应用。兼作判据 O-CONN-03 的真机证据。
//
// 这条判据问的是本批修复的回归：连接窗口期（扩展已建 TUN、后端未就绪）把应用切到
// 后台，界面进程是否还被冻结。修复前，进程被冻结，扩展等满 15 s 无人应答，
// 记 vpn_backend_handoff_timeout 并销毁 VPN，用户看到连接自己断掉。
//
// 判据：O-CONN-03 连接后切到其它应用，隧道保持。
//
// 断言覆盖判据的「可观测点」与「期望」两行：
//   - 连接窗口出现（vpn-probe-status.txt 含 VPN interface established）
//   - 窗口期切后台成功（background_entered）
//   - 切后台落在窗口内（vpn_tun_created 先于 background_entered）
//   - 隧道仍建成（vpn_connected）
//   - 没有 vpn_backend_handoff_timeout，扩展没有被超时销毁
//
// 前置：设备已登录 Tailscale。切后台走设备侧 uitest 的 HOME 键。
//
//   DEVICE=<序列号> node --test scripts/e2e/connect-window-background.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, clickId, forceStop, layoutTexts, screenshot, sendHome, serial, startApp
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `connect-window-background-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// 状态文件路径格式取自 scripts/device-exit-node-probe.ps1:25。
const FILES_DIR = `/data/app/el2/100/base/${BUNDLE}/haps/entry/files`;

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
let sawWindow = false;
let backgrounded = false;

// 读应用沙箱里的文本文件。读不到时返回空串。
function readAppFile(name) {
  try {
    return execFileSync(HDC, ['-t', serial(), 'shell', '-b', BUNDLE, 'cat', `${FILES_DIR}/${name}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_error) {
    return '';
  }
}

// 把应用切到后台。切后台走设备侧 uitest 的 HOME 键。
// 键名是 `Home`，全大写 `HOME` 会让 uitest 返回 Invalid parameters，命令不生效也不报错。
// 共用 lib/device.mjs 的实现，避免两份写法再次走偏。

function shows(text) {
  try {
    return layoutTexts().some((line) => line.includes(text));
  } catch (_error) {
    return false;
  }
}

// 从 mark 之后的行里等一个模式。避免命中更早一轮留下的同名事件。
async function waitForAfter(mark, pattern, timeoutMs) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = mark; i < log.lines.length; i++) {
      if (regex.test(log.lines[i])) {
        return log.lines[i];
      }
    }
    await pause(250);
  }
  return null;
}

// 轮询状态文件，等连接窗口出现。窗口状态含 VPN interface established
// （扩展 TailscaleVpnExtensionAbility.ets:624、:534）。
async function waitForWindow(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/vpn interface established/i.test(readAppFile('vpn-probe-status.txt'))) {
      return true;
    }
    await pause(250);
  }
  return false;
}

function firstIndexOf(pattern) {
  return log.lines.findIndex((line) => pattern.test(line));
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
  configured = shows('未连接') || shows('已连接');
  if (!configured) {
    log.stop();
    return;
  }
  // 归一状态：旅程从「未连接」开始。上一次跑可能把设备留在已连接上。
  if (shows('已连接')) {
    clickId('vpn-stop');
    await log.waitFor(/vpn_extension_destroyed/, 60000);
    await pause(4000);
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('窗口背景：连接窗口期内把应用切到后台', async (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先登录再跑。');
    return;
  }
  clickId('vpn-connect');
  sawWindow = await waitForWindow(30000);
  if (!sawWindow) {
    // 隧道若已建成，说明窗口太短，抓不到。这不算失败，只是这条用例不适用。
    if (await log.waitFor(/vpn_connected/, 5000)) {
      t.skip('连接在观测到窗口前就完成，切后台没落在窗口期，本用例不适用。');
      return;
    }
    assert.fail('发起连接后既没有连接窗口，也没有建成隧道。');
  }
  const mark = log.lines.length;
  sendHome();
  backgrounded = (await waitForAfter(mark, /MeshArcDiag: ui background_entered/, 12000)) !== null;
  assert.ok(backgrounded,
    '连接窗口期内没能把应用切到后台（HOME 键未生效），这条用例无法成立。');
});

test('窗口背景：切后台后隧道仍建成', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  if (!sawWindow || !backgrounded) {
    t.skip('上一条没有在窗口期内切到后台，隧道是否建成这条不适用。');
    return;
  }
  const connected = await log.waitFor(/MeshArcDiag: vpn vpn_connected/, 60000);
  screenshot('connect-window-background');
  assert.ok(connected, '窗口期切后台之后，设备日志里没有出现 vpn_connected，隧道没有建成');

  const tun = firstIndexOf(/MeshArcDiag: vpn vpn_tun_created/);
  const bg = firstIndexOf(/MeshArcDiag: ui background_entered/);
  const up = firstIndexOf(/MeshArcDiag: vpn vpn_connected/);
  assert.ok(tun >= 0 && bg >= 0 && up >= 0, '三个锚点没有集齐，窗口时序无从判定');
  assert.ok(tun < bg,
    '切后台发生在建 TUN 之前，没有落在连接窗口内（vpn_tun_created 应在 background_entered 之前）');
  assert.ok(bg < up, 'background_entered 出现在 vpn_connected 之后，时序不成立');
});

test('窗口背景：扩展没有被交接超时销毁', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  if (!sawWindow || !backgrounded) {
    t.skip('上一条没有在窗口期内切到后台，交接超时这条不适用。');
    return;
  }
  assert.ok(!/vpn_backend_handoff_timeout/.test(log.lines.join('\n')),
    '窗口期切后台后出现 vpn_backend_handoff_timeout，交接无人应答，修复没有生效');
});

test('窗口背景：收尾回到未连接', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  if (!sawWindow) {
    t.skip('上一条没有进入窗口，无需收尾。');
    return;
  }
  // 应用还在后台，先拉回前台再断开。
  startApp();
  await pause(3000);
  if (shows('已连接')) {
    clickId('vpn-stop');
    await log.waitFor(/vpn_extension_destroyed/, 60000);
    await pause(4000);
  }
  assert.ok(!shows('已连接'), '收尾没有回到未连接');
});
