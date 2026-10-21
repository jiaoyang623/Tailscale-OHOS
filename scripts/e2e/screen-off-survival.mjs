// E2E · 锁屏静置下的后台存活。兼作 M-18 与 QG-01 的真机证据。
//
// QG-01 的目标是「≥ 720 s 锁屏静置，全程心跳龄 ≤ 15 s」。心跳由扩展的状态定时器
// 刷新，并镜像到设备日志。锁屏档位的间隔是 5 s，所以心跳龄要按 15 s 的上限判定，
// 不能按每秒一条判定。相邻两条 `heartbeatMs=` 的间隔就是扩展停止写字的时长。
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
import {
  HDC, LogStream, clickBottomTab, clickId, forceStop, layoutTexts, startApp, unlockScreen
} from './lib/device.mjs';
import { createRun, deviceEnvironment } from './lib/steps.mjs';

const DURATION_MS = Number(process.env.SURVIVAL_MS || 720000);
const GRACE_MS = 20000;
const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `screen-off-survival-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
let configured = false;
let launchEvidence = null;
let connectedEvidence = null;
let beforeSuspendEvidence = null;

const run = createRun({
  suite: 'screen-off-survival',
  title: '锁屏 720 秒后台存活',
  command: `DEVICE=${process.env.DEVICE || '<序列号>'} node --test scripts/e2e/screen-off-survival.mjs`,
  environment: deviceEnvironment(),
  notice: '本次在 Wi-Fi 下运行，手机通过 USB 连接并充电。通过一次不代表电池深度休眠或拔线后仍成立。'
});

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
  let texts = layoutTexts();
  if (!texts.some((line) => line.includes('未连接') || line.includes('已连接'))) {
    // 应用恢复了上次的页签。连接状态只在「设备」页。
    clickBottomTab('设备');
    await pause(3000);
    texts = layoutTexts();
  }
  configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
  launchEvidence = run.shot('survival-launch', '操作后');
});

after(() => {
  // 本文件把设备锁了。用例中途失败时不会走到最后那次 wakeup，
  // 所以收尾必须自己确保屏幕解开，否则后面的用例起不来应用。
  power('wakeup');
  unlockScreen();
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  const written = run.write();
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
  console.log(`结构化运行日志：${written}`);
});

test('锁屏存活：先连上隧道', async (t) => {
  if (!configured) {
    run.case('SURV-CONNECT', '锁屏存活：先连上隧道', ['O-CONN-06'])
      .skip('这台设备还没登录 Tailscale，本用例不适用。');
    t.skip('这台设备还没登录 Tailscale，本用例不适用。');
    return;
  }
  const record = run.case('SURV-CONNECT', '锁屏存活：先连上隧道', ['O-CONN-06']);
  record.step({
    id: 'S1', name: '冷启动应用', operation: 'aa force-stop 后 aa start',
    expected: ['设备日志出现 ui_opened', '界面显示未连接或已连接'],
    evidence: { kind: 'ui', screenshots: [launchEvidence] }
  }).pass('应用冷启动完成，界面显示连接状态', { kind: 'ui', screenshots: [launchEvidence] });

  const connect = record.step({
    id: 'S2', name: '建立隧道', operation: '界面处于未连接时点击连接按钮',
    expected: ['设备日志出现 vpn_connected']
  });
  const already = layoutTexts().some((line) => line.includes('已连接'));
  try {
    if (!already) {
      clickId('vpn-connect');
    }
    assert.ok(await log.waitFor(/vpn_connected/, 90000), '连不上，后面的存活测试没有意义');
    connectedEvidence = run.shot('survival-connected', '结果');
    const line = log.lines.filter((entry) => /vpn_connected/.test(entry)).slice(-1)[0] || '';
    connect.pass(already ? '应用已处于已连接状态' : '点击连接后出现 vpn_connected',
      { kind: 'ui', screenshots: [connectedEvidence] });
  } catch (error) {
    const evidence = { kind: 'log', output: String((error && error.message) || error) };
    connect.fail(String((error && error.message) || error), evidence);
    record.fail(String((error && error.message) || error));
    throw error;
  }
});

test('锁屏存活：720 秒静置期间心跳不断', { timeout: DURATION_MS + 180000 }, async (t) => {
  if (!configured) {
    run.case('SURV-SCREEN-OFF', '锁屏 720 秒静置期间心跳不断', ['O-CONN-06']).skip('未登录，跳过');
    t.skip('未登录，跳过');
    return;
  }
  const record = run.case('SURV-SCREEN-OFF', '锁屏 720 秒静置期间心跳不断', ['O-CONN-06']);
  const wait = record.step({
    id: 'S1', name: '锁屏静置', operation: `power-shell suspend 后等待 ${DURATION_MS / 1000} 秒并唤醒`,
    expected: ['设备进入锁屏', '到点后唤醒成功']
  });
  let beatsBefore = 0;
  let beats = [];
  let statsText = '';
  try {
    beforeSuspendEvidence = run.shot('survival-before-suspend', '操作前');
    beatsBefore = countBeats();
    power('suspend');
    await pause(DURATION_MS);
    power('wakeup');
    await pause(GRACE_MS);
    const after = run.shot('survival-after-wakeup', '操作后');
    wait.pass(`锁屏 ${DURATION_MS / 1000} 秒后唤醒`, {
      kind: 'ui', screenshots: [beforeSuspendEvidence, after]
    });
  } catch (error) {
    const message = String((error && error.message) || error);
    wait.fail(message, { kind: 'log', output: message });
    record.fail(message);
    throw error;
  }

  const check = record.step({
    id: 'S2', name: '校验心跳', operation: '统计锁屏期间扩展写入的心跳',
    expected: ['心跳数量达到下限', `心跳跨度达到 ${DURATION_MS / 1000} 秒`, '最大间隔不超过 15 秒']
  });
  // Only beats written after the suspend count. The connect step can restart
  // the extension, and that restart gap says nothing about screen-off survival.
  beats = heartbeatTimes().slice(beatsBefore);
  // The screen-off cadence is 5 s, and the contract allows up to 15 s between
  // beats. Scale the minimum with the run length so a short smoke run is not
  // judged by a count meant for twelve hours.
  const minimumBeats = Math.max(3, Math.floor(DURATION_MS / 15000));
  const span = beats.length > 1 ? beats[beats.length - 1] - beats[0] : 0;
  const gaps = [];
  for (let i = 1; i < beats.length; i++) {
    gaps.push(beats[i] - beats[i - 1]);
  }
  const worst = gaps.length > 0 ? Math.max(...gaps) : 0;
  statsText = `心跳 ${beats.length} 个，跨度 ${span.toFixed(0)} s，最大间隔 ${worst.toFixed(1)} s`;
  console.log(`  ${statsText}`);

  const problems = [];
  if (beats.length < minimumBeats) {
    problems.push(`锁屏 ${DURATION_MS / 1000} 秒里只采到 ${beats.length} 个心跳（下限 ${minimumBeats}），扩展没有持续写`);
  }
  if (span < DURATION_MS / 1000 - 30) {
    problems.push(`心跳跨度只有 ${span.toFixed(0)} s，没到 ${DURATION_MS / 1000} s`);
  }
  if (worst > 15) {
    problems.push(`心跳最大间隔 ${worst.toFixed(1)} s，超过 15 s 的阈值`);
  }
  if (problems.length > 0) {
    check.fail(problems.join('；'), { kind: 'log', output: `${statsText}\n${problems.join('\n')}` });
    record.fail(problems.join('；'));
    assert.fail(problems.join('；'));
  }
  check.pass(statsText, { kind: 'log', output: statsText });
});

test('锁屏存活：全程只有一个扩展进程', async (t) => {
  if (!configured) {
    run.case('SURV-ONE-PROCESS', '锁屏存活：全程只有一个扩展进程', ['O-CONN-06']).skip('未登录，跳过');
    t.skip('未登录，跳过');
    return;
  }
  const record = run.case('SURV-ONE-PROCESS', '锁屏存活：全程只有一个扩展进程', ['O-CONN-06']);
  const created = log.lines.filter((line) => /vpn_extension_created/.test(line)).length;
  const destroyed = log.lines.filter((line) => /vpn_extension_destroyed/.test(line)).length;
  const actual = `vpn_extension_created ${created} 次，vpn_extension_destroyed ${destroyed} 次`;
  const step = record.step({
    id: 'S1', name: '统计扩展进程', operation: '检索设备日志中的扩展创建与销毁事件',
    expected: ['vpn_extension_created 出现 1 次', 'vpn_extension_destroyed 出现 0 次']
  });
  if (created !== 1 || destroyed !== 0) {
    const message = destroyed === 0
      ? `扩展被拉起 ${created} 次，期间重建过，长时间存活的结论要打折`
      : `扩展被销毁 ${destroyed} 次，隧道没有全程存活`;
    step.fail(`${actual}。${message}`, { kind: 'log', output: `${actual}\n${message}` });
    record.fail(message);
    assert.fail(message);
  }
  step.pass(actual, { kind: 'log', output: actual });
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
