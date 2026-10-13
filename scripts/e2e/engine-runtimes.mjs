// E2E · 两个进程各自有没有引擎。兼作 M-13 的真机证据。
//
// 架构决策 D3 假设 UI 进程与 VPN 扩展进程各有一份独立的引擎运行时。
// 若平台把同一份 .so 的两个实例视为一个运行时，那么一侧停引擎会连带停掉另一侧，
// 文件交接协议与「同一时刻只有一个写方」的假设同时失效。
//
// 这条从真实入口判定：冷启动 → 解锁工程诊断 → 连接 → 读两个读数。
//   vpn-status      扩展侧的隧道状态
//   engine-status   UI 进程自己那份引擎
//   backend-status  UI 进程的后端
//
// 判定：隧道已可用，而 UI 进程的引擎仍是 Pending、后端仍是 STOPPED
//       → 两个独立运行时，D3(a) 成立。
//
// 前置：设备已登录 Tailscale。
//
//   DEVICE=<序列号> node --test scripts/e2e/engine-runtimes.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickAt, clickId, fastTap, forceStop, layoutTexts, screenshot,
  scrollToId, startApp, textOfId
} from './lib/device.mjs';

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `engine-runtimes-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
let configured = false;

// 走到「关于与帮助」页上的工程诊断区。解锁状态只在进程内存里，冷启动会丢，所以每次重新点。
async function openDiagnostics() {
  clickId('tab-settings');
  await pause(2500);
  // 设置页比一屏长，「关于与帮助」要先滚出来。
  const about = await scrollToId('settings-about-entry');
  if (!about) {
    return false;
  }
  clickAt(about);
  await pause(3000);
  const version = await scrollToId('app-version-action', 3);
  if (!version) {
    return false;
  }
  fastTap(version[0], version[1], 5);
  await pause(2500);
  return true;
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
  if (!configured) {
    log.stop();
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('引擎归属：先连上隧道', async (t) => {
  if (!configured) {
    t.skip('这台设备还没登录 Tailscale，本用例不适用。先在设备上登录。');
    return;
  }
  clickId('vpn-connect');
  const connected = await log.waitFor(/vpn_connected/, 90000);
  assert.ok(connected, '点了连接之后，设备日志里没有出现 vpn_connected');
});

test('引擎归属：隧道可用，但 UI 进程自己那份引擎没有起来', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  assert.ok(await openDiagnostics(), '走不到工程诊断区，读不到两个读数');

  const vpn = textOfId('vpn-status') || '';
  const engine = textOfId('engine-status') || '';
  const backend = textOfId('backend-status') || '';
  screenshot('engine-runtimes');

  // 扩展侧确实在跑。
  assert.match(vpn, /state=Running/, `扩展侧隧道状态不是 Running：${vpn}`);
  assert.match(vpn, /tun=true/, `扩展侧没有 TUN：${vpn}`);

  // UI 进程这一侧没有引擎。这正是 D3(a) 要的那条。
  assert.ok(!/state=Running/.test(backend),
    `UI 进程的后端也在跑，两个运行时无法区分：${backend}`);
  assert.match(engine, /Pending|NoState|stopped/i,
    `UI 进程的引擎状态既不是 Pending 也不是 stopped：${engine}`);
});

test('引擎归属：两个进程各有各的日志来源', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  // 扩展进程的行带 :vpn 后缀，UI 进程的行不带。这是进程分离在日志上的第三个证据。
  const extension = await log.waitFor(/ren\.w2h\.mesharc:vpn\//, 10000);
  assert.ok(extension, '设备日志里没有扩展进程的行，两个运行时的判据缺一半');
});

test('引擎归属：断开后回到未连接', async (t) => {
  if (!configured) {
    t.skip('未登录，跳过');
    return;
  }
  clickId('tab-home');
  await pause(2500);
  clickId('vpn-stop');
  await log.waitFor(/vpn_extension_destroyed/, 90000);
  await pause(4000);
  assert.ok(layoutTexts().some((line) => line.includes('未连接')),
    '断开之后界面没有回到未连接');
});
