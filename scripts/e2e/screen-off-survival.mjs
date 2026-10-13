// E2E · 锁屏静置下的后台存活。兼作 M-18 与 QG-01 的真机证据。
//
// QG-01 的目标是「≥ 720 s 锁屏静置，全程心跳龄 ≤ 15 s」。心跳由扩展的状态定时器
// 每秒刷新一次，并镜像到设备日志（本轮加的）。相邻两条 `heartbeatMs=` 的间隔
// 就是扩展停止写字的时长，也就是这一条要问的量。
//
// 锁屏用设备自己的 `power-shell suspend`，所以这条不需要人守在手机旁边。
//
// 边界（要写进结论）：本次在 Wi-Fi 下跑，且手机通过 USB 连着主机并充电。
// USB 供电会改变电源管理行为，通过一次不代表电池深度休眠或拔线后仍成立。
//
//   DEVICE=<序列号> node --test scripts/e2e/screen-off-survival.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HDC, LogStream, clickId, forceStop, layoutTexts, startApp } from './lib/device.mjs';

const DURATION_MS = Number(process.env.SURVIVAL_MS || 720000);
const GRACE_MS = 20000;
const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `screen-off-survival-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
let configured = false;

function power(command) {
  execFileSync(HDC, ['-t', process.env.DEVICE, 'shell', `power-shell ${command}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
  configured = layoutTexts().some((line) => line.includes('未连接') || line.includes('已连接'));
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('锁屏存活：先连上隧道', async (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。');
    return;
  }
  if (!layoutTexts().some((line) => line.includes('已连接'))) {
    clickId('vpn-connect');
  }
  assert.ok(await log.waitFor(/vpn_connected/, 90000), '连不上，后面的存活测试没有意义');
});

test('锁屏存活：720 秒静置期间心跳不断', { timeout: DURATION_MS + 180000 }, async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  const beatsBefore = countBeats();
  power('suspend');
  await pause(DURATION_MS);
  power('wakeup');
  await pause(GRACE_MS);

  const beats = heartbeatTimes();
  assert.ok(beats.length > beatsBefore + 60,
    `锁屏 ${DURATION_MS / 1000} 秒里只采到 ${beats.length - beatsBefore} 个心跳，扩展没有持续写`);

  const span = beats[beats.length - 1] - beats[0];
  const gaps = [];
  for (let i = 1; i < beats.length; i++) {
    gaps.push(beats[i] - beats[i - 1]);
  }
  const worst = Math.max(...gaps);
  console.log(`  心跳 ${beats.length} 个，跨度 ${span.toFixed(0)} s，最大间隔 ${worst.toFixed(1)} s`);

  assert.ok(span >= DURATION_MS / 1000 - 30,
    `心跳跨度只有 ${span.toFixed(0)} s，没到 ${DURATION_MS / 1000} s`);
  assert.ok(worst <= 15,
    `心跳最大间隔 ${worst.toFixed(1)} s，超过 15 s 的阈值`);
});

test('锁屏存活：全程只有一个扩展进程', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  const created = log.lines.filter((line) => /vpn_extension_created/.test(line)).length;
  const destroyed = log.lines.filter((line) => /vpn_extension_destroyed/.test(line)).length;
  assert.equal(created, 1, `扩展被拉起 ${created} 次，期间重建过，长时间存活的结论要打折`);
  assert.equal(destroyed, 0, `扩展被销毁 ${destroyed} 次，隧道没有全程存活`);
});

// 用扩展自己写下的 heartbeatMs 值，不用日志投递时刻：
// 前者是扩展"什么时候写的"，后者还叠了传输延迟。
function heartbeatTimes() {
  const times = [];
  for (const line of log.lines) {
    const found = /heartbeatMs=(\d{10,})/.exec(line);
    if (found) {
      times.push(Number(found[1]) / 1000);
    }
  }
  return times;
}

function countBeats() {
  return heartbeatTimes().length;
}
