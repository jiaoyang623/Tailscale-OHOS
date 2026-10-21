import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';

// Run the real lifecycle coordinator with deterministic platform boundaries.
// ArkTS compilation is verified separately by the repository debug build.
//
// 2026-10-20: protection now follows the user's intent, not one uncertain
// status read. A missing tunnel reading does not release the task while the
// intent says connected; only a stopped intent does.
const source = readFileSync(new URL('../entry/src/main/ets/services/VpnBackgroundTaskManager.ets', import.meta.url), 'utf8');
const readerSource = readFileSync(new URL('../entry/src/main/ets/services/VpnStatusReader.ets', import.meta.url), 'utf8');
const intentSource = readFileSync(new URL('../entry/src/main/ets/services/VpnSessionIntent.ets', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function fixture() {
  const f = {
    now: 1000000, status: '', starts: [], stops: 0, notifications: [], events: [],
    callbacks: new Map(), startGate: null, publishGate: null, startError: null,
    stopGate: null, readError: false, intent: 'connected', intentChangedAtMs: 0
  };
  const context = { filesDir: '/files', resourceManager: { getStringByNameSync: () => 'VPN connected' } };
  const sandbox = {
    Date: { now: () => f.now }, setInterval: () => 1, clearInterval: () => {},
    wantAgent: { OperationType: { START_ABILITY: 1 }, WantAgentFlags: { UPDATE_PRESENT_FLAG: 1 },
      getWantAgent: async () => ({}) },
    backgroundTaskManager: {
      ContinuousTaskCancelReason: { USER_CANCEL: 1, USER_CANCEL_REMOVE_NOTIFICATION: 3 },
      on: (name, cb) => f.callbacks.set(name, cb), off: name => f.callbacks.delete(name),
      startBackgroundRunning: async (_ctx, modes) => {
        f.starts.push(modes);
        if (f.startError) throw f.startError;
        if (f.startGate) await f.startGate.promise;
        return { notificationId: 42, continuousTaskId: 7 };
      },
      stopBackgroundRunning: async () => { f.stops++; if (f.stopGate) await f.stopGate.promise; }
    },
    fileIo: { readTextSync: () => { if (f.readError) throw Error('temporary I/O'); return f.status; } },
    StoragePaths: {
      vpnStatusPath: dir => dir + '/vpn-probe-status.txt',
      vpnIntentPath: dir => dir + '/vpn-intent.json'
    },
    VpnIntentDesired: { CONNECTED: 'connected', STOPPED: 'stopped' },
    VpnSessionIntent: {
      read: () => ({ desired: f.intent, present: true, changedAtMs: f.intentChangedAtMs, by: 'ui' })
    },
    notificationManager: {
      SlotType: { LIVE_VIEW: 4 }, ContentType: { NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW: 5 },
      publish: async request => { f.notifications.push(request); if (f.publishGate) await f.publishGate.promise; }
    },
    hilog: { info: () => {} }, DiagnosticEventStore: { record: (...args) => f.events.push(args) }
  };
  runModules(sandbox, [
    { source: enumToObject(readerSource, 'VpnLinkState'), names: ['VpnStatusReader', 'VpnLinkState'] },
    { source, names: ['VpnBackgroundTaskManager'] }
  ]);
  f.manager = new sandbox.VpnBackgroundTaskManager();
  f.live = () => { f.status = `OK | state=Running | tun=true | txBytes=2048 | rxBytes=1048576 | heartbeatMs=${f.now}`; };
  f.connecting = () => {
    f.status = `VPN interface established | backend handoff pending | heartbeatMs=${f.now}`;
  };
  f.disconnected = () => { f.status = `VPN extension destroyed | heartbeatMs=${f.now}`; };
  f.tick = async () => { await f.manager.reconcile(context); await flush(); };
  f.start = async () => { f.live(); f.manager.register(context); await flush(); };
  f.stopIntent = () => { f.intent = 'stopped'; };
  f.cancel = (reason, id = 7) => f.callbacks.get('continuousTaskCancel')({ id, reason });
  f.context = context;
  return f;
}

test('acquires protection in foreground and updates the same system live view with real traffic', async () => {
  const f = fixture(); await f.start();
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0][0], 'dataTransfer');
  assert.equal(f.notifications[0].id, 42);
  assert.match(f.notifications[0].content.systemLiveView.text, /2.0 KiB.*1.0 MiB/);
  assert.equal(f.notifications[0].template.data.progressValue, 0);
  f.manager.onBackground(f.context); await flush();
  assert.equal(f.stops, 0);
  assert.equal(f.starts.length, 1);
  assert.equal(f.notifications.length, 1);
  f.now += 30000; f.live(); await f.tick();
  assert.equal(f.notifications.length, 2);
  assert.equal(f.notifications[1].id, 42);
});

test('protection follows intent, not a single uncertain status read', async () => {
  const f = fixture(); await f.start();
  assert.equal(f.starts.length, 1);

  // Stale heartbeat, then a read error, then more than the old grace window.
  f.now += 16000; await f.tick(); assert.equal(f.stops, 0);
  f.readError = true; f.now += 20000; await f.tick(); assert.equal(f.stops, 0);
  f.readError = false; f.now += 25000; await f.tick(); assert.equal(f.stops, 0);
  assert.ok(f.events.some(args => args[2] === 'background_status_timeout'),
    'uncertain telemetry was not visible in diagnostics');

  // Only the user's stop releases it.
  f.stopIntent(); await f.tick(); assert.equal(f.stops, 1);
});

test('a disconnect while the intent is connected keeps protection', async () => {
  const f = fixture(); await f.start();
  f.disconnected(); await f.tick();
  assert.equal(f.stops, 0, 'a disconnect revoked protection while the user still wanted it');
  assert.notEqual(f.manager.task, undefined, 'the task was discarded');
});

test('a stopped intent releases protection promptly', async () => {
  const f = fixture(); await f.start();
  f.stopIntent(); await f.tick();
  assert.equal(f.stops, 1);
  assert.equal(f.manager.task, undefined);
});

test('never starts from stale, future, missing heartbeat or missing TUN evidence', async () => {
  for (const status of ['OK | state=Running | tun=true',
    'OK | state=Running | tun=true | heartbeatMs=1',
    'OK | state=Running | tun=true | heartbeatMs=2000000',
    'OK | state=Running | tun=false | heartbeatMs=1000000']) {
    const f = fixture(); f.status = status; f.manager.register(f.context); await flush();
    assert.equal(f.starts.length, 0, status);
  }
});

test('snapshot failure is uncertain and does not immediately revoke protection', async () => {
  const f = fixture(); await f.start();
  f.status = `FAILED | VPN backend | status unavailable | heartbeatMs=${f.now}`;
  await f.tick(); assert.equal(f.stops, 0);
});

test('user dismissed notification keeps the vpn and re-arms on foreground', async () => {
  const f = fixture(); await f.start(); f.cancel(1);
  assert.equal(f.stops, 0, 'cancelling the notification stopped the tunnel');
  assert.ok(f.events.some(args => args[2] === 'background_user_cancelled_kept_vpn'),
    'the decision to keep the tunnel was not recorded');

  // Backgrounded, the app does not fight the system for the task.
  f.now += 90000; f.live(); await f.tick();
  assert.equal(f.starts.length, 1, 'the app re-acquired the task in the background');

  // Back in the foreground, the intent still stands, so protection returns.
  f.manager.onForeground(f.context); await flush();
  assert.equal(f.starts.length, 2, 'foreground did not re-arm protection');
  assert.ok(f.events.some(args => args[2] === 'background_protection_restored'));
});

test('system cancellation retries with exponential backoff', async () => {
  const f = fixture(); await f.start(); f.cancel(2);
  f.now += 29999; f.live(); await f.tick(); assert.equal(f.starts.length, 1);
  f.now++; f.live(); await f.tick(); assert.equal(f.starts.length, 2);
  f.cancel(2); f.now += 30000; f.live(); await f.tick(); assert.equal(f.starts.length, 2);
  f.now += 30000; f.live(); await f.tick(); assert.equal(f.starts.length, 3);
});

test('unrelated cancellation does not discard the VPN task', async () => {
  const f = fixture(); await f.start(); f.cancel(1, 99); await f.tick();
  assert.equal(f.manager.task.continuousTaskId, 7);
});

test('a failed start is throttled instead of retried every second', async () => {
  const f = fixture(); f.startError = { code: 9800005 }; await f.start();
  for (let i = 0; i < 20; i++) { f.now += 1000; f.live(); await f.tick(); }
  assert.equal(f.starts.length, 1);
  f.now += 10000; f.live(); await f.tick(); assert.equal(f.starts.length, 2);
});

test('cancellation received during start cannot be overwritten by its late result', async () => {
  const f = fixture(); f.startGate = deferred(); await f.start(); f.cancel(1);
  f.startGate.resolve(); await flush();
  assert.equal(f.manager.task, undefined); assert.equal(f.notifications.length, 0);
  await f.tick(); assert.equal(f.starts.length, 1);
});

test('a stopped intent during start cleans up the late task without publishing', async () => {
  const f = fixture(); f.startGate = deferred(); await f.start();
  f.stopIntent();
  f.startGate.resolve(); await flush();
  assert.equal(f.stops, 1, 'the late task was left in place');
  assert.equal(f.notifications.length, 0, 'the late task published a notification');
});

test('destroy during start cleans up the late successful task', async () => {
  const f = fixture(); f.startGate = deferred(); await f.start(); f.manager.unregister();
  f.startGate.resolve(); await flush();
  assert.equal(f.stops, 1); assert.equal(f.notifications.length, 0);
  assert.equal(f.callbacks.size, 0);
});

test('destroy during notification update serializes cleanup after publish', async () => {
  const f = fixture(); f.publishGate = deferred(); await f.start(); f.manager.unregister();
  assert.equal(f.stops, 0);
  f.publishGate.resolve(); await flush(); assert.equal(f.stops, 1);
});

test('reconnect waits for in-flight stop before starting the next task', async () => {
  const f = fixture(); await f.start(); f.stopGate = deferred(); f.stopIntent();
  const stopping = f.tick(); await flush(); f.intent = 'connected'; f.live(); await f.tick();
  assert.equal(f.starts.length, 1);
  f.stopGate.resolve(); await stopping; await f.tick(); assert.equal(f.starts.length, 2);
});

test('holds protection through the connect window so the handoff can be answered', async () => {
  // The extension asks this process to hand the backend over while the tunnel
  // is still coming up. A backgrounded process with no continuous task is
  // frozen before it can answer, so the task has to be held before the tunnel
  // reports state=Running.
  const f = fixture(); f.connecting(); f.manager.register(f.context); await flush();
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0][0], 'dataTransfer');
  f.manager.onBackground(f.context); await flush();
  assert.equal(f.stops, 0);
  f.live(); await f.tick();
  assert.equal(f.starts.length, 1, 'connecting must roll into connected without a second task');
  assert.equal(f.stops, 0);
});

test('the connect window needs interface evidence, not just an unrecognised status', async () => {
  for (const status of ['VPN extension lifecycle entered',
    'VPN probe TUN creation pending',
    'OK | state=Running | tun=false']) {
    const f = fixture();
    f.status = `${status} | heartbeatMs=${f.now}`;
    f.manager.register(f.context); await flush();
    assert.equal(f.starts.length, 0, status);
  }
});

test('a fresh connected intent holds protection before any interface evidence', async () => {
  // The page writes the intent before it stages a command. The extension can
  // spend up to 20 s in backend and config work, so the process must already
  // own the task when the handoff request arrives.
  const f = fixture();
  f.status = '';
  f.intentChangedAtMs = f.now;
  f.manager.register(f.context); await flush();
  assert.equal(f.starts.length, 1);
  f.manager.onBackground(f.context); await flush();
  assert.equal(f.stops, 0);
  // The window ages out without interface evidence. The task that exists is
  // kept while the intent stands, so recovery can still run.
  f.now += 61000; await f.tick();
  assert.equal(f.stops, 0);
});

test('an old connected intent does not start protection on its own', async () => {
  const f = fixture();
  f.status = '';
  f.intentChangedAtMs = f.now - 61000;
  f.manager.register(f.context); await flush();
  assert.equal(f.starts.length, 0);
});

test('dismissing the notification in the foreground re-arms protection at once', async () => {
  const f = fixture(); await f.start();
  f.manager.onForeground(f.context); await flush();
  f.cancel(1);
  assert.equal(f.stops, 0, 'cancelling the notification stopped the tunnel');
  f.now += 1000; f.live(); await f.tick();
  assert.equal(f.starts.length, 2, 'the foreground did not re-acquire the task');
  f.manager.onBackground(f.context); await flush();
  assert.equal(f.starts.length, 2, 'the re-acquired task was not kept in the background');
});

test('a stalled connect window keeps protection while the intent stands', async () => {
  const f = fixture(); f.connecting(); f.manager.register(f.context); await flush();
  assert.equal(f.starts.length, 1);
  // The extension stops writing heartbeats: uncertain, not live.
  f.now += 20000; await f.tick(); assert.equal(f.stops, 0);
  f.now += 50000; await f.tick(); assert.equal(f.stops, 0,
    'a stalled connect window released protection');
  // Only the user's stop releases it.
  f.stopIntent(); await f.tick(); assert.equal(f.stops, 1);
});
