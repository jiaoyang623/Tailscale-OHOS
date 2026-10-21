// E2E · 连接旅程。兼作 M-13 与 QG-02 的真机证据。
//
// 从真实入口走到用户结果：系统拉起 EntryAbility → 首页显示未连接 →
// 点首页的连接按钮 → 隧道可用 → 界面显示已连接 → 再点一次 → 回到未连接。
//
// 同时断言两条判据要的东西：
//   QG-02 连接期保活覆盖：background_started 必须早于 vpn_connected
//   M-13  D3：两个进程各自起一份引擎，主机侧看得到扩展自己的生命周期事件
//
// 前置：设备已登录 Tailscale（首页能看到设备数量）。未登录时本用例跳过。
//
//   DEVICE=<序列号> node --test scripts/e2e/connect-journey.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickId, forceStop, layoutTexts, screenshot, startApp, textOfId
} from './lib/device.mjs';

// 证据要落地。判据要求证据带位置，所以跑完把设备日志写到文件并打印路径。
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `connect-journey-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let configured = false;
// 连接动作的日志分界。启动时的自动恢复也会写 vpn_connected，
// 整份日志扫描会把上一次的事件当成这一次的结果。
let connectMark = 0;

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
  const texts = layoutTexts();
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
  if (!configured) {
    log.stop();
    return;
  }
  // 归一状态：上一次跑可能把设备留在已连接上。旅程从「未连接」开始。
  if (textOfId('vpn-stop') !== null) {
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

test('连接旅程：未连接时首页给出连接入口', (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，连接旅程不适用。先登录再跑。');
    return;
  }
  const state = textOfId('vpn-connect');
  assert.ok(state !== null, '首页没有连接按钮（vpn-connect）');
});

// 判据 O-CONN-01 声明的用例名，保留原样以便 check-e2e-plan.py 对得上。
test('连接旅程：从首页连接后进入可用隧道', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  connectMark = log.mark();
  clickId('vpn-connect');

  const connected = await log.waitForAfter(connectMark, /vpn_connected/, 60000);
  screenshot('connect-journey-connected');
  assert.ok(connected, '点了连接之后，设备日志里没有出现 vpn_connected');

  await pause(2000);
  const texts = layoutTexts();
  assert.ok(texts.some((line) => line.includes('已连接')),
    `隧道可用但界面没有显示已连接。界面文本：${JSON.stringify(texts.slice(0, 15))}`);
});

test('连接旅程：QG-02 长时任务先于隧道可用', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  const connected = await log.waitForAfter(connectMark, /vpn_connected/, 5000);
  assert.ok(connected, '没有再找到 vpn_connected');
  // 长时任务可以在点击之前就取得：启动时意图仍是 connected，保护会提前建立。
  // QG-02 要的是「隧道可用那一刻任务已持有」，所以找连接前最近一次 start，
  // 并确认中间没有 stop。
  const connectIndex = log.lines.indexOf(connected);
  let lastStart = -1;
  for (let i = connectIndex - 1; i >= 0; i--) {
    if (/background_started/.test(log.lines[i])) {
      lastStart = i;
      break;
    }
  }
  let lastStop = -1;
  for (let i = connectIndex - 1; i > lastStart; i--) {
    if (/background_stopped/.test(log.lines[i])) {
      lastStop = i;
      break;
    }
  }
  assert.ok(lastStart >= 0, '连接期没有出现 background_started，长时任务没有覆盖连接窗口');
  assert.ok(lastStop < lastStart, '长时任务在隧道可用前被释放，连接窗口没有被覆盖');
});

test('连接旅程：M-13 扩展自己起一份引擎并记录生命周期', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  // 扩展进程的事件只可能由扩展产生。它出现，就说明扩展那一侧有自己的运行时，
  // 这正是 D3 假设的那一条。
  assert.ok(await log.waitFor(/vpn_extension_created/, 5000),
    '没有看到扩展被拉起的事件，D3 的「两个运行时」无从判定');
});

test('连接旅程：再点一次断开，界面回到未连接', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  clickId('vpn-stop');
  await log.waitFor(/vpn_extension_destroyed/, 60000);
  await pause(4000);
  const texts = layoutTexts();
  screenshot('connect-journey-disconnected');
  assert.ok(texts.some((line) => line.includes('未连接')),
    `断开之后界面没有回到未连接。界面文本：${JSON.stringify(texts.slice(0, 15))}`);
});
