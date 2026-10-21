import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Run the real reconnect supervisor with stubbed boundaries.
//
// 2026-10-20: the question is no longer "was the user looking at the app?" but
// "did the user stop the connection?". The supervisor reads one intent file,
// keeps retrying for as long as that intent says connected, waits for a
// network callback while the device is offline, and treats a sustained unknown
// reading as a drop.
const HERE = import.meta.url;
const supervisorSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnReconnectSupervisor.ets', HERE), 'utf8');
const readerSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnStatusReader.ets', HERE), 'utf8');
const intentSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnSessionIntent.ets', HERE), 'utf8');
const ledgerSource = readFileSync(
  new URL('../entry/src/main/ets/services/SessionLedger.ets', HERE), 'utf8');

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
    lastAuthorised: null,
    lastDisconnectBy: null,
    desired: 'connected',
    netId: 11,
    conflict: false,
    ledger: [],
    endFile: undefined,
    sessionId: '',
    heartbeatMs: 0,
    intent: { desired: 'connected', present: true, changedAtMs: 0, by: 'ui' }
  };
  const sandbox = {
    Date: { now: () => f.now },
    VpnLinkState: enumMembers(readerSource, 'VpnLinkState'),
    VpnIntentDesired: enumMembers(intentSource, 'VpnIntentDesired'),
    SessionEndReason: enumMembers(ledgerSource, 'SessionEndReason'),
    VpnActionResult: { STARTED: 'started', STOPPED: 'stopped', UNCHANGED: 'unchanged', NEEDS_UI: 'needs_ui', FAILED: 'failed', CANCELLED: 'cancelled' },
    VpnStatusReader: { read: () => ({ state: f.state, txBytes: 0, rxBytes: 0, sessionId: f.sessionId,
      heartbeatMs: f.heartbeatMs, conflict: f.conflict }) },
    VpnSessionIntent: {
      read: () => ({ desired: f.intent.desired, present: f.intent.present,
        changedAtMs: f.intent.changedAtMs, by: f.intent.by })
    },
    connection: {
      getDefaultNetSync: () => ({ netId: f.netId })
    },
    SessionLedger: {
      recordObserved: (...args) => { f.ledger.push(args); return true; },
      recordEnd: (...args) => { f.ledger.push(args); return true; },
      readEndFile: () => f.endFile,
      clearEndFile: () => { f.endFile = undefined; }
    },
    VpnSessionController: class {
      connect(_filesDir, authorised) {
        f.connects++;
        f.lastAuthorised = authorised;
        // Mirror the controller: a token that reports lost authority cancels
        // the connect before any work. The polarity is part of the seam.
        if (authorised !== undefined && !authorised()) {
          return Promise.resolve('cancelled');
        }
        if (f.connectGate === null) {
          return Promise.resolve(f.connectResult);
        }
        return f.connectGate.promise;
      }
      disconnect(_filesDir, by) {
        f.disconnects++;
        f.lastDisconnectBy = by;
        return Promise.resolve('stopped');
      }
    },
    DiagnosticEventStore: { record: (...args) => f.events.push(args[2]) },
    hilog: { info: () => {} }
  };
  vm.runInNewContext(javascript + '\nglobalThis.Supervisor = VpnReconnectSupervisor;', sandbox);
  f.supervisor = new sandbox.Supervisor();
  f.reader = sandbox.VpnStatusReader;
  f.connected = () => { f.state = 'connected'; f.heartbeatMs = f.now; };
  f.dropped = () => { f.state = 'disconnected'; };
  f.push = async () => { await f.supervisor.poll('/files', f.now); await Promise.resolve(); };
  f.flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  f.holdConnect = () => {
    let release;
    f.connectGate = { promise: new Promise(r => { release = r; }), release };
  };
  f.setIntent = (desired) => {
    f.intent = { desired, present: true, changedAtMs: f.now, by: 'ui' };
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
  assert.ok(f.events.includes('vpn_session_recovery_attempt'));
});

test('a foreground drop is recovered without the ten second settle', async () => {
  // The user did not stop the connection. Whether the app is on screen says
  // nothing about that, so a foreground drop is recovered immediately.
  const f = fixture();
  f.connected();
  await f.push();
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1, 'a foreground drop was not recovered');
  assert.ok(!f.events.includes('vpn_drop_ignored_foreground'));
});

test('a drop moments after backgrounding is recovered', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 2000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);
});

test('a drop after the user asked to disconnect is not undone', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.setIntent('stopped');
  f.dropped();
  await f.push();
  assert.equal(f.connects, 0);
  assert.ok(f.events.includes('vpn_drop_after_requested_stop'));
});

test('a deliberate reconnect re-arms recovery', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.setIntent('stopped');
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 0);
  f.setIntent('connected');
  f.supervisor.noteRequestedStart();
  f.connected();
  await f.push();
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);
});

test('recovery never exhausts while the user keeps the intent', async () => {
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
  assert.equal(f.connects, 6, 'the supervisor gave up while the intent stayed connected');
  assert.ok(!f.events.includes('vpn_session_recovery_exhausted'));
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
  // The extension may be between two heartbeats. A short unknown reading is
  // not evidence, and it must not write anything into diagnostics either.
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 10000;
  f.state = 'unknown';
  await f.push();
  assert.equal(f.connects, 0);
  assert.equal(f.events.length, 0);
});

test('sustained unknown after a connection is a drop', async () => {
  // The extension was killed. Its last heartbeat ages out and every read is
  // unknown; without this the app would sit on unknown forever.
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.state = 'unknown';
  f.now += 10000;
  await f.push();
  assert.equal(f.connects, 0, 'a short unknown was treated as a drop');
  f.now += 21000;
  await f.push();
  assert.equal(f.connects, 1, 'a sustained unknown never became a drop');
  assert.ok(f.events.includes('vpn_session_end_observed'));
  assert.equal(f.ledger[0][3], 'extension_crash',
    'a crash without an end record must be observed as extension_crash');
});

test('a fresh connect intent is not a missing-heartbeat drop', async () => {
  // The user just asked to connect. A poll before the first heartbeat must not
  // race that start, but an old intent with no heartbeat is a real drop.
  const f = fixture();
  f.state = 'unknown';
  f.heartbeatMs = 0;
  f.setIntent('connected');
  await f.push();
  assert.equal(f.connects, 0, 'the supervisor raced the connect the user just asked for');
  f.now += 31000;
  await f.push();
  assert.equal(f.connects, 1, 'an old intent with no heartbeat never recovered');
});

test('a stale user-stop record does not label the next session drop', async () => {
  // A user stop writes an end record. After a new session starts, that record
  // must not be read as the reason the new session dropped.
  const f = fixture();
  f.sessionId = 'session-a';
  f.connected();
  await f.push();
  f.endFile = { sessionId: 'session-a', reason: 'user_stop', phase: 'user_stop' };
  f.sessionId = 'session-b';
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1, 'the new session did not recover');
  assert.equal(f.ledger[0][2], 'session-b');
  assert.equal(f.ledger[0][3], 'unknown',
    'an end record from an earlier session named this drop');
  assert.equal(f.endFile, undefined, 'the stale record was left for the next reader');
});

test('a stale end record still leaves the heartbeat evidence', async () => {
  const f = fixture();
  f.sessionId = 'session-a';
  f.connected();
  await f.push();
  f.endFile = { sessionId: 'session-a', reason: 'user_stop', phase: 'user_stop' };
  f.sessionId = 'session-b';
  f.state = 'unknown';
  f.now += 31000;
  await f.push();
  assert.equal(f.connects, 1);
  assert.equal(f.ledger[0][3], 'extension_crash',
    'the stale record hid the expired heartbeat');
  assert.equal(f.ledger[0][4], 'heartbeat_expired_stale_end');
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

test('a connection held past the stability window records a recovery', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);

  f.now += 20000;
  f.dropped();
  await f.push();
  assert.equal(f.connects, 1);

  // Back up, but not yet stable: no recovery is claimed.
  f.now += 1000;
  f.connected();
  await f.push();
  assert.ok(!f.events.includes('vpn_session_recovered'),
    'connection had not held long enough to count as recovered');

  // Held past STABLE_MS: the recovery is recorded.
  f.now += 60000;
  f.connected();
  await f.push();
  assert.ok(f.events.includes('vpn_session_recovered'),
    `stability window did not record the recovery: ${f.events.join(', ')}`);
});

test('a stop requested while a reconnect is in flight undoes the connect', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  f.holdConnect();
  await f.push();
  assert.equal(f.connects, 1);
  f.setIntent('stopped');
  f.supervisor.noteRequestedStop();
  f.connectGate.release('started');
  await f.flush();
  assert.equal(f.disconnects, 1, 'the superseded connect was left in place');
  assert.ok(f.events.includes('vpn_session_recovery_superseded'));
});

test('a sign-in prompt stops retries until the user acts', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.now += 60000;
  f.dropped();
  f.connectResult = 'needs_ui';
  await f.push();
  assert.equal(f.connects, 1);
  assert.ok(f.events.includes('vpn_session_recovery_needs_ui'));
  f.now += 600000;
  await f.push();
  assert.equal(f.connects, 1, 'the supervisor retried through a sign-in prompt');
});

test('a connect from the page clears the sign-in wait', async () => {
  // The page writes the intent file and holds no reference to the supervisor.
  // A user who was already in the app gets no new foreground event.
  const f = fixture();
  f.connected();
  await f.push();
  f.now += 60000;
  f.dropped();
  f.connectResult = 'needs_ui';
  await f.push();
  assert.equal(f.connects, 1);
  f.now += 1000;
  f.connectResult = 'started';
  f.setIntent('connected');
  await f.push();
  assert.equal(f.connects, 2, 'a page connect did not end the sign-in wait');
});

test('a stop written only to the intent supersedes an in-flight reconnect', async () => {
  // The page writes the intent file and holds no reference to the supervisor.
  // The stop must reach the attempt through the file, not through a method.
  const f = fixture();
  f.connected();
  await f.push();
  f.now += 60000;
  f.dropped();
  f.holdConnect();
  await f.push();
  assert.equal(f.connects, 1);
  f.setIntent('stopped');
  f.connectGate.release('started');
  await f.flush();
  assert.equal(f.disconnects, 1, 'a page stop left the in-flight connect in place');
  assert.equal(f.lastDisconnectBy, 'recovery',
    'the undo must not write the user intent or a user stop record');
  assert.ok(f.events.includes('vpn_session_recovery_superseded'));
});

test('a card reconnect supersedes an in-flight recovery without stopping the tunnel', async () => {
  // noteRequestedStart invalidates the attempt. That is not a user stop: the
  // user asked for a tunnel, so the recovery must not stop the one it started.
  const f = fixture();
  f.connected();
  await f.push();
  f.now += 60000;
  f.dropped();
  f.holdConnect();
  await f.push();
  assert.equal(f.connects, 1);
  f.setIntent('connected');
  f.supervisor.noteRequestedStart();
  f.connectGate.release('started');
  await f.flush();
  assert.equal(f.disconnects, 0, 'a user reconnect was undone by the recovery');
  assert.ok(f.events.includes('vpn_session_recovery_superseded'));
  assert.ok(!f.events.includes('vpn_session_recovery_undo_failed'));
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
  f.setIntent('stopped');
  f.supervisor.noteRequestedStop();
  f.connectGate.release('cancelled');
  await f.flush();
  assert.equal(f.disconnects, 0, 'a cancelled connect cannot need undoing');
  assert.ok(f.events.includes('vpn_session_recovery_cancelled'));
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
  assert.ok(f.events.includes('vpn_session_recovery_started'));
});

test('the supervisor hands the controller a positive authority token', async () => {
  // The controller cancels only when this token reports false. A token with the
  // opposite polarity made every recovery cancel itself on the device.
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.dropped();
  await f.push();
  assert.equal(typeof f.lastAuthorised, 'function',
    'the reconnect started without an authority token');
  assert.equal(f.lastAuthorised(), true, 'the token does not report the attempt as live');
  f.setIntent('stopped');
  f.supervisor.noteRequestedStop();
  assert.equal(f.lastAuthorised(), false, 'the token kept its authority after a stop request');
});

test('network loss defers recovery until the network returns', async () => {
  // Offline is not a reason to spend attempts. The device is told when the
  // network is back, so that is when the next attempt happens - not on a timer.
  const f = fixture();
  f.connected();
  await f.push();
  f.supervisor.onBackground(f.now);
  f.now += 60000;
  f.netId = 0;
  // A lost network makes the extension stop writing, so the last reading is
  // unknown with a stale heartbeat.
  f.state = 'unknown';
  f.heartbeatMs = f.now - 31000;
  await f.push();
  await f.push();
  await f.push();
  assert.equal(f.connects, 0, 'an offline device still tried to connect');
  assert.equal(f.events.filter((e) => e === 'vpn_session_recovery_deferred').length, 1,
    'offline was recorded once per sample instead of once');
  assert.equal(f.ledger[0][3], 'network_lost',
    'an offline drop was not recorded as a network loss');

  // Retry timers do not start the tunnel while the network is down.
  f.now += 600000;
  await f.push();
  assert.equal(f.connects, 0, 'a retry timer fired while offline');

  // The callback is the trigger, and it does not wait for a backoff to expire.
  f.netId = 11;
  f.supervisor.onNetworkAvailable(f.now);
  await f.push();
  assert.equal(f.connects, 1, 'the network callback did not start the recovery');
  assert.ok(f.events.includes('vpn_session_recovery_attempt'));
});

test('a VPN conflict is recorded as a system stop and does not retry', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.now += 1000;
  f.state = 'disconnected';
  f.heartbeatMs = f.now;
  f.conflict = true;
  await f.push();
  assert.equal(f.connects, 0, 'a conflict was retried');
  const observed = f.ledger.find((entry) => entry[3] === 'system_stopped');
  assert.ok(observed, 'the conflict was not recorded as a system stop');
  assert.equal(observed[4], 'vpn_conflict');
  assert.ok(f.events.includes('vpn_session_recovery_needs_ui'));

  // The user acted. A newer intent ends the wait.
  f.conflict = false;
  f.dropped();
  f.intent.changedAtMs = f.now + 1;
  f.now += 1000;
  await f.push();
  assert.equal(f.connects, 1, 'a new user action did not resume recovery');
});

test('an intent that is stopped never recovers on a network callback', async () => {
  const f = fixture();
  f.connected();
  await f.push();
  f.setIntent('stopped');
  f.netId = 0;
  f.dropped();
  await f.push();
  f.netId = 11;
  f.supervisor.onNetworkAvailable(f.now);
  await f.push();
  assert.equal(f.connects, 0, 'a stopped intent was recovered after the network returned');
});
