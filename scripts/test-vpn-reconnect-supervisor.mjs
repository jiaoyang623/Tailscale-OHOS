import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Run the real reconnect supervisor with stubbed boundaries.
//
// Reconnecting is a behaviour change, and the dangerous failure is fighting a
// user who just asked to disconnect. These tests pin the guards that stop it.
const HERE = import.meta.url;
const supervisorSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnReconnectSupervisor.ets', HERE), 'utf8');
const readerSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnStatusReader.ets', HERE), 'utf8');

// Read the enum members out of the real source so the stub cannot drift.
function enumMembers(text, name) {
  const match = text.match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `enum ${name} not found`);
  const members = {};
  for (const [, key, value] of match[1].matchAll(/(\w+)\s*=\s*'([^']*)'/g)) {
    members[key] = value;
  }
  assert.ok(Object.keys(members).length > 0, `enum ${name} has no members`);
  return members;
}

const javascript = stripTypeScriptTypes(supervisorSource.replace(/^import .*;\r?$/gm, '')
  .replace('export class VpnReconnectSupervisor', 'class VpnReconnectSupervisor'));

function fixture() {
  const f = {
    state: 'disconnected',
    now: 1_000_000,
    connects: 0,
    disconnects: 0,
    events: [],
    connectResult: 'started',
    connectGate: null,
    lastCancelled: null
  };
  const sandbox = {
    Date: { now: () => f.now },
    VpnLinkState: enumMembers(readerSource, 'VpnLinkState'),
    VpnActionResult: { STARTED: 'started', STOPPED: 'stopped', UNCHANGED: 'unchanged', NEEDS_UI: 'needs_ui', FAILED: 'failed', CANCELLED: 'cancelled' },
    VpnStatusReader: { read: () => ({ state: f.state, txBytes: 0, rxBytes: 0 }) },
    VpnSessionController: class {
      connect(_filesDir, cancelled) {
        f.connects++;
        f.lastCancelled = cancelled;
        return f.connectGate === null ? Promise.resolve(f.connectResult) : f.connectGate.promise;
      }
      disconnect() {
        f.disconnects++;
        return Promise.resolve('stopped');
      }
    },
    DiagnosticEventStore: { record: (...args) => f.events.push(args[2]) }
  };
  vm.runInNewContext(javascript + '\nglobalThis.Supervisor = VpnReconnectSupervisor;', sandbox);
  f.supervisor = new sandbox.Supervisor();
  f.reader = sandbox.VpnStatusReader;
  f.connected = () => { f.state = 'connected'; };
  f.dropped = () => { f.state = 'disconnected'; };
  f.push = async () => { await f.supervisor.poll('/files', f.now); await Promise.resolve(); };
  f.flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  f.holdConnect = () => {
    let release;
    f.connectGate = { promise: new Promise(r => { release = r; }), release };
  };
  return f;
}

test('a tunnel that drops well after backgrounding is brought back', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);
  assert.ok(f.events.includes('vpn_reconnect_attempt'));
});

test('a drop moments after backgrounding is left alone', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 2000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 0);
  assert.ok(f.events.includes('vpn_drop_ignored_foreground'));
});

test('a drop while the app is on screen is left alone', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.dropped();
  await f.push();
  assert.equal(f.connects, 0);
  assert.ok(f.events.includes('vpn_drop_ignored_foreground'));
});

test('a drop after the user asked to disconnect is not undone', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.supervisor.noteRequestedStop();
  f.dropped();
  await f.push();
  assert.equal(f.connects, 0);
  assert.ok(f.events.includes('vpn_drop_after_requested_stop'));
});

test('a deliberate reconnect re-arms recovery', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.noteRequestedStop();
  f.supervisor.noteRequestedStart();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);
});

test('recovery gives up instead of retrying forever', async () => {
  const f = fixture();
  f.connectResult = 'failed';
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  for (let round = 0; round < 6; round++) {
    f.now += 600000;
    f.connected();
    await f.push();
    f.dropped();
    await f.push();
  }
  assert.equal(f.connects, 3);
  assert.ok(f.events.includes('vpn_reconnect_exhausted'));
});

test('retries back off instead of firing on every sample', async () => {
  const f = fixture();
  f.connectResult = 'failed';
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  for (let sample = 0; sample < 5; sample++) {
    f.state = 'connected';
    await f.push();
    f.state = 'disconnected';
    await f.push();
  }
  assert.equal(f.connects, 1);
});

test('an unknown state is not treated as a drop', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.state = 'unknown';
  await f.push();
  assert.equal(f.connects, 0);
  assert.equal(f.events.length, 0);
});

test('returning to the foreground clears the retry ladder', async () => {
  const f = fixture();
  f.connectResult = 'failed';
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);
  f.supervisor.onForeground();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.connected();
  await f.push();
  f.dropped();
  await f.push();
  assert.equal(f.connects, 2);
});

test('a connection held past the stability window clears the retry ladder', async () => {
  // The attempt counter is only cleared once a connection has held for
  // STABLE_MS. Without that, a flapping tunnel would reset the count on every
  // cycle and retry forever; with it too short, the same thing happens. This
  // pins the window itself, which the give-up test never reaches because its
  // connect and drop happen at the same instant.
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);

  // One real drop well after backgrounding: burns attempt 1.
  f.now += 20000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);

  // Back up, but not yet stable: the counter must survive.
  f.now += 1000;
  f.connected();
  await f.push();
  assert.ok(!f.events.includes('vpn_reconnect_succeeded'),
    'connection had not held long enough to count as recovered');

  // Held past STABLE_MS: the ladder clears.
  f.now += 60000;
  f.connected();
  await f.push();
  assert.ok(f.events.includes('vpn_reconnect_succeeded'),
    `stability window did not clear the ladder: ${f.events.join(', ')}`);

  // And because it cleared, the full budget is available again: three more.
  for (let round = 0; round < 4; round++) {
    f.now += 600000;
    f.connected();
    await f.push();
    f.dropped();
    await f.push();
  }
  assert.equal(f.connects, 4, 'the ladder was not re-armed after a stable connection');
  assert.equal(f.events.filter((e) => e === 'vpn_reconnect_exhausted').length, 1);
});

test('a stop requested while a reconnect is in flight undoes the connect', async () => {
  // The connect cannot be stopped inside the extension start, so the attempt
  // loses its authority and undoes what it started. Without this the user's
  // disconnect is silently revoked a moment later.
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  f.holdConnect();
  await f.push();
  assert.equal(f.connects, 1);
  f.supervisor.noteRequestedStop();
  f.connectGate.release('started');
  await f.flush();
  assert.equal(f.disconnects, 1, 'the superseded connect was left in place');
  assert.ok(f.events.includes('vpn_reconnect_superseded'));
});

test('a connect that cancelled itself is not undone', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  f.holdConnect();
  await f.push();
  f.supervisor.noteRequestedStop();
  f.connectGate.release('cancelled');
  await f.flush();
  assert.equal(f.disconnects, 0, 'a cancelled connect cannot need undoing');
  assert.ok(f.events.includes('vpn_reconnect_cancelled'));
});

test('a reconnect that finishes with no stop is left alone', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  f.holdConnect();
  await f.push();
  f.connectGate.release('started');
  await f.flush();
  assert.equal(f.disconnects, 0);
  assert.ok(f.events.includes('vpn_reconnect_started'));
});

test('the supervisor hands the controller a cancellation token', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(typeof f.lastCancelled, 'function',
    'the reconnect started without a cancellation token');
  assert.equal(f.lastCancelled(), true, 'the token does not report the attempt as live');
  f.supervisor.noteRequestedStop();
  assert.equal(f.lastCancelled(), false, 'the token kept its authority after a stop request');
});
