// E2E · 断开旅程。兼作判据 O-CONN-02 的真机证据。
//
// 从真实入口走到用户结果：设备已连接 → 首页点断开圆钮 → 扩展停止 →
// 长时任务释放 → 界面回到未连接。
//
// 判据：O-CONN-02 从首页一键断开。
//
// 断言覆盖判据的「可观测点」与「期望」两行：
//   - 连接圆钮与状态区文案回到未连接
//   - 诊断事件 disconnect_requested 先于 disconnect_completed
//   - 长时任务释放（background_stopped）
//   - vpn-probe-status.txt 落到已断开
//
// 前置：设备已登录 Tailscale（首页能看到状态文案）。未登录时本用例跳过。
//
//   DEVICE=<序列号> node --test scripts/e2e/disconnect-journey.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE, HDC, LogStream, centerOfId, clickId, forceStop, layoutTexts, screenshot,
  serial, startApp
} from './lib/device.mjs';

// 证据要落地。判据要求证据带位置，所以跑完把设备日志写到文件并打印路径。
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `disconnect-journey-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// 应用沙箱里的状态文件。路径格式取自 scripts/device-exit-node-probe.ps1:25。
// shell -b 在应用自己的沙箱上下文里执行，普通 shell 读不到。
const FILES_DIR = `/data/app/el2/100/base/${BUNDLE}/haps/entry/files`;

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;

// 读应用沙箱里的文本文件。读不到时返回空串，不抛错，让断言给出人话。
function readAppFile(name) {
  try {
    return execFileSync(HDC, ['-t', serial(), 'shell', '-b', BUNDLE, 'cat', `${FILES_DIR}/${name}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_error) {
    return '';
  }
}

function shows(text) {
  try {
    return layoutTexts().some((line) => line.includes(text));
  } catch (_error) {
    return false;
  }
}

// 断开流程自身的事件。取第一条，判据问的是本次点击的顺序。
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
  // 等后端初始化落定。
  await pause(8000);
  configured = shows('未连接') || shows('已连接');
  if (!configured) {
    log.stop();
    return;
  }
  // 归一状态：断开旅程必须从「已连接」开始。上一次跑可能把设备留在未连接上。
  if (!shows('已连接')) {
    clickId('vpn-connect');
    assert.ok(await log.waitFor(/vpn_connected/, 90000),
      '首页显示未连接，点连接后也没有建成隧道，断开旅程无从开始');
    await pause(4000);
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('断开旅程：已连接时首页给出断开入口', (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，断开旅程不适用。先登录再跑。');
    return;
  }
  // 连接圆钮的 id 由 connectionActionNodeId 生成：已连接时是 vpn-stop
  // （BridgeStatus.ets:9601）。
  assert.ok(centerOfId('vpn-stop') !== null, '已连接时首页没有断开圆钮（vpn-stop）');
  assert.ok(shows('已连接'), '首页状态区没有显示已连接');
});

test('断开旅程：点断开后界面回到未连接', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  clickId('vpn-stop');
  const completed = await log.waitFor(/MeshArcDiag: ui disconnect_completed/, 60000);
  screenshot('disconnect-journey-disconnected');
  assert.ok(completed, '点了断开之后，设备日志里没有出现 disconnect_completed');
  await pause(5000);
  assert.ok(shows('未连接'),
    `断开之后界面没有回到未连接。界面文本：${JSON.stringify(layoutTexts().slice(0, 15))}`);
});

test('断开旅程：请求先于完成落账', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  const requested = firstIndexOf(/MeshArcDiag: ui disconnect_requested/);
  const completed = firstIndexOf(/MeshArcDiag: ui disconnect_completed/);
  assert.ok(requested >= 0, '没有出现 disconnect_requested');
  assert.ok(completed >= 0, '没有出现 disconnect_completed');
  assert.ok(requested < completed,
    'disconnect_completed 出现在 disconnect_requested 之前，断开流程的次序不对');
});

test('断开旅程：断开后释放长时任务', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  const stopped = firstIndexOf(/MeshArcDiag: ui background_stopped/);
  assert.ok(stopped >= 0, '断开之后没有出现 background_stopped，长时任务没有释放');
  // \b 把 background_started 与 background_started_special_scenario 分开。
  const restarted = log.lines.slice(stopped + 1)
    .some((line) => /\bbackground_started\b/.test(line));
  assert.ok(!restarted, '长时任务释放之后又被拉起，断开没有落到稳定态');
});

test('断开旅程：状态文件落到已断开', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  const status = readAppFile('vpn-probe-status.txt').trim();
  assert.ok(/destroyed|disconnected|state=stopped/i.test(status),
    `断开后 vpn-probe-status.txt 不是已断开：${status.slice(0, 120)}`);
});
