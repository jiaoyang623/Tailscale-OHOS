import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';

// M-16 的走查靠四种「为什么没走 special-scenario」的记录来判路。
// 那四条记录是 2026-10-13 加的，加的时候没有测试守。这里把四条分支都打一遍，
// 守住 M-16 的证据通道：以后谁改坏了分支或改了事件名，这里先红。
//
// 出厂状态下 SPECIAL_SCENARIO_SUBMODE 是 0（故意不启用），只有第一条分支可达。
// 后三条要把常量改成非零才进得去，所以这里在载入前替换源码里的那一行。
// 真实设备上走哪条由 ACL 与授权决定，见 operator-sheet.md 的 M-16。
const RAW = readFileSync(
  new URL('../entry/src/main/ets/services/VpnBackgroundTaskManager.ets', import.meta.url), 'utf8');
const readerSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnStatusReader.ets', import.meta.url), 'utf8');
const registry = readFileSync(
  new URL('../docs/diagnostics/event-names.md', import.meta.url), 'utf8');

const SUBMODE_LINE = 'const SPECIAL_SCENARIO_SUBMODE: number = 0;';
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

function fixture(options = {}) {
  const { submode = 0, modeSupported = true, auth = 1, startError = null } = options;

  let source = RAW;
  if (submode !== 0) {
    assert.ok(source.includes(SUBMODE_LINE),
      `源码里找不到 '${SUBMODE_LINE}'，本用例改不动子类型常量`);
    source = source.replace(SUBMODE_LINE, `const SPECIAL_SCENARIO_SUBMODE: number = ${submode};`);
  }

  const f = { now: 1000000, status: '', starts: [], events: [], callbacks: new Map() };
  const context = { filesDir: '/files', resourceManager: { getStringByNameSync: () => 'VPN connected' } };
  const sandbox = {
    Date: { now: () => f.now }, setInterval: () => 1, clearInterval: () => {},
    wantAgent: { OperationType: { START_ABILITY: 1 }, WantAgentFlags: { UPDATE_PRESENT_FLAG: 1 },
      getWantAgent: async () => ({}) },
    backgroundTaskManager: {
      ContinuousTaskCancelReason: { USER_CANCEL: 1, USER_CANCEL_REMOVE_NOTIFICATION: 3 },
      BackgroundTaskMode: { MODE_SPECIAL_SCENARIO_PROCESSING: 6 },
      // 真机上的取值以系统 SDK 为准，这里只需要三个互不相同的数。
      UserAuthResult: { DENIED: 0, GRANTED_ONCE: 1, GRANTED_ALWAYS: 2 },
      ContinuousTaskRequest: class {
        isModeSupported() { return modeSupported; }
        async checkSpecialScenarioAuth() { return auth; }
      },
      on: (name, cb) => f.callbacks.set(name, cb), off: name => f.callbacks.delete(name),
      startBackgroundRunning: async (_ctx, modes) => {
        f.starts.push(modes);
        if (startError && !Array.isArray(modes)) {
          throw startError;
        }
        return { notificationId: 42, continuousTaskId: 7 };
      },
      stopBackgroundRunning: async () => {}
    },
    fileIo: { readTextSync: () => f.status },
    StoragePaths: {
      vpnStatusPath: dir => dir + '/vpn-probe-status.txt',
      vpnIntentPath: dir => dir + '/vpn-intent.json'
    },
    VpnIntentDesired: { CONNECTED: 'connected', STOPPED: 'stopped' },
    VpnSessionIntent: {
      read: () => ({ desired: 'connected', present: true, changedAtMs: 0, by: 'ui' })
    },
    notificationManager: {
      SlotType: { LIVE_VIEW: 4 }, ContentType: { NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW: 5 },
      publish: async () => {}
    },
    hilog: { info: () => {} },
    DiagnosticEventStore: { record: (...args) => f.events.push(args) }
  };
  runModules(sandbox, [
    { source: enumToObject(readerSource, 'VpnLinkState'), names: ['VpnStatusReader', 'VpnLinkState'] },
    { source, names: ['VpnBackgroundTaskManager'] }
  ]);
  f.manager = new sandbox.VpnBackgroundTaskManager();
  f.context = context;
  f.live = () => { f.status = `OK | state=Running | tun=true | heartbeatMs=${f.now}`; };
  // record() 写的是 [dir, 'ui', 事件名, 'background', code]。这里只取事件名。
  f.names = () => f.events.map(entry => entry[2]);
  f.codeOf = name => { const hit = f.events.find(e => e[2] === name); return hit ? hit[4] : null; };
  // 连接态下登记，协调器就会去起长时任务。
  f.arm = async () => { f.live(); f.manager.register(context); await flush(); };
  // 特殊场景那次调用传的是 ContinuousTaskRequest 对象，DATA_TRANSFER 传的是数组。
  f.specialStarts = () => f.starts.filter(s => !Array.isArray(s)).length;
  f.dataTransferStarts = () => f.starts.filter(s => Array.isArray(s)).length;
  return f;
}

test('出厂常量下不起 special-scenario，记下原因并回落到 DATA_TRANSFER', async () => {
  const f = fixture();
  await f.arm();
  assert.ok(f.names().includes('background_special_scenario_unconfigured'),
    `没有记下未配置的原因。记到的事件：${JSON.stringify(f.names())}`);
  assert.equal(f.specialStarts(), 0, '出厂常量下不应该真去起 special-scenario');
  assert.equal(f.dataTransferStarts(), 1, '没有回落到 DATA_TRANSFER');
  assert.ok(f.names().includes('background_started'), '回落之后没有记下长时任务已起');
});

test('设备不支持该模式时记 unsupported 并回落', async () => {
  const f = fixture({ submode: 1, modeSupported: false });
  await f.arm();
  assert.ok(f.names().includes('background_special_scenario_unsupported'),
    `没有记下不支持。记到的事件：${JSON.stringify(f.names())}`);
  assert.equal(f.dataTransferStarts(), 1, '没有回落到 DATA_TRANSFER');
});

test('授权被拒时记 denied，并把原始 UserAuthResult 带出来', async () => {
  const f = fixture({ submode: 1, auth: 0 });
  await f.arm();
  assert.ok(f.names().includes('background_special_scenario_denied'),
    `没有记下被拒。记到的事件：${JSON.stringify(f.names())}`);
  // 带原始取值，设备上才分得清「用户拒绝」和「系统不支持」。
  assert.equal(f.codeOf('background_special_scenario_denied'), 0,
    'denied 没有把原始 UserAuthResult 记进 code');
  assert.equal(f.dataTransferStarts(), 1, '没有回落到 DATA_TRANSFER');
});

test('已授权时起 special-scenario，不再起 DATA_TRANSFER', async () => {
  const f = fixture({ submode: 1, auth: 2 });
  await f.arm();
  assert.equal(f.specialStarts(), 1, '已授权却没有起 special-scenario');
  assert.equal(f.dataTransferStarts(), 0, 'special-scenario 起来了还去起 DATA_TRANSFER');
  assert.ok(f.names().includes('background_started_special_scenario'),
    `没有记下 special-scenario 已起。记到的事件：${JSON.stringify(f.names())}`);
});

test('起任务抛错时记 failed，并把 BusinessError.code 带出来', async () => {
  const f = fixture({ submode: 1, auth: 2, startError: { code: 401 } });
  await f.arm();
  assert.ok(f.names().includes('background_special_scenario_failed'),
    `没有记下失败。记到的事件：${JSON.stringify(f.names())}`);
  assert.equal(f.codeOf('background_special_scenario_failed'), 401,
    'failed 没有把 BusinessError.code 记进 code');
  assert.equal(f.dataTransferStarts(), 1, '失败之后没有回落到 DATA_TRANSFER');
});

test('四条原因记录都写在登记表里，走查读得到', () => {
  // M-16 的判定读事件名。名字改了而登记表没跟着改，走查就会读空。
  for (const name of ['background_special_scenario_unconfigured',
    'background_special_scenario_unsupported', 'background_special_scenario_denied',
    'background_special_scenario_failed', 'background_started_special_scenario']) {
    assert.ok(registry.includes(name), `登记表 docs/diagnostics/event-names.md 里没有 ${name}`);
  }
});
