import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';

// Run the real headless VPN controller against a stubbed filesystem.
//
// A connect that nobody finishes is the worst outcome this path can produce:
// the extension creates the TUN, waits fifteen seconds for the backend
// handoff, then destroys the VPN. These tests pin that the handoff is answered
// from here, because BridgeStatus only answers while its own connect runs.
const HERE = import.meta.url;
const controllerSource = readFileSync(
  new URL('../entry/src/main/ets/services/VpnSessionController.ets', HERE), 'utf8');
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

// VpnActionResult is declared in the file under test; drop it so the sandbox
// can supply the same members as plain values.
const actionEnum = controllerSource.match(/export enum VpnActionResult \{[\s\S]*?\n\}\n/);
assert.ok(actionEnum, 'enum VpnActionResult not found');
const javascript = stripTypeScriptTypes(
  controllerSource.replace(actionEnum[0], '')
    .replace(/^import .*;\r?$/gm, '')
    .replace('export class VpnSessionController', 'class VpnSessionController'));

const CONFIG = 'OK | config | {"privateKey":"k"}';

function fixture() {
  const f = {
    files: new Map(),
    sleeps: [],
    stops: 0,
    stopResult: 'OK | backend stopped',
    stopThrows: false,
    events: [],
    state: 'disconnected',
    extensionStarts: 0,
    intentWrites: [],
    intentDesired: 'connected',
    intentChangedAtMs: 0,
    intentWriteFails: false,
    ledgerEnds: []
  };
  const sandbox = {
    Date: { now: () => 1_000_000 },
    // Poll sleeps are released by the test, so the loop's timing is explicit.
    setTimeout: (resolve) => { f.sleeps.push(resolve); },
    VpnActionResult: enumMembers(controllerSource, 'VpnActionResult'),
    VpnLinkState: enumMembers(readerSource, 'VpnLinkState'),
    VpnIntentDesired: enumMembers(intentSource, 'VpnIntentDesired'),
    SessionEndReason: enumMembers(ledgerSource, 'SessionEndReason'),
    VpnStatusReader: { read: () => ({ state: f.state, txBytes: 0, rxBytes: 0, sessionId: '' }) },
    VpnSessionIntent: {
      write: (_dir, desired, by) => {
        if (f.intentWriteFails) {
          return false;
        }
        f.intentWrites.push({ desired, by });
        f.intentDesired = desired;
        return true;
      },
      read: () => ({ desired: f.intentDesired, present: true, changedAtMs: f.intentChangedAtMs, by: 'ui' })
    },
    SessionLedger: {
      recordEnd: (...args) => { f.ledgerEnds.push(args); return true; },
      recordObserved: () => true
    },
    ControlServerConfig: { load: () => ({ confirmed: true, controlURL: 'https://control.example' }) },
    DeviceNameService: { model: () => 'device' },
    deviceInfo: { majorVersion: 7, seniorVersion: 0, osFullName: 'OpenHarmony-7.0.0.105' },
    DiagnosticEventStore: { record: (_dir, source, event) => f.events.push(`${source}:${event}`) },
    VpnCommandGateway: class {
      startBackend() { return 'OK'; }
      stopBackend() {
        f.stops++;
        return f.stopThrows ? Promise.reject(new Error('stop failed'))
          : Promise.resolve(f.stopResult);
      }
      backendStatus() { return 'OK | state=Running'; }
      requestVpnConfig() { return Promise.resolve(CONFIG); }
      startVpnExtension() { f.extensionStarts++; return Promise.resolve(); }
      stopVpnExtension() { return Promise.resolve(); }
      stageConnectConfig(_dir, name, config) { f.files.set(name, config); return true; }
      writeCommandFile(_dir, name, content) { f.files.set(name, content); return true; }
      readCommandFile(_dir, name) {
        const value = f.files.get(name);
        return value === undefined || value.length === 0 ? undefined : value;
      }
    }
  };
  vm.runInNewContext(javascript + '\nglobalThis.Controller = VpnSessionController;', sandbox);
  f.controller = new sandbox.Controller();
  f.response = () => {
    const value = f.files.get('vpn-backend-handoff-response.json');
    // An empty file is what the extension sees as "no answer yet".
    return value === undefined || value.length === 0 ? undefined : value;
  };
  return f;
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// The extension writes its request once its TUN exists, which is after the
// start request - connect clears the handoff files first, so the order matters.
async function arrive(f, requestText) {
  f.files.set('vpn-backend-handoff-request.json', requestText);
  const wake = f.sleeps.shift();
  assert.equal(typeof wake, 'function', 'the answer loop stopped polling');
  wake();
  await flush();
}

test('a headless connect answers the extension backend handoff', async () => {
  const f = fixture();
  assert.equal(await f.controller.connect('/files'), 'started');
  assert.equal(f.extensionStarts, 1);
  await arrive(f, JSON.stringify({ requestId: 77 }));
  assert.equal(f.stops, 1);
  const response = JSON.parse(f.response());
  assert.equal(response.requestId, 77);
  assert.equal(response.status, 'OK | backend stopped');
  assert.equal(f.files.get('vpn-backend-handoff-request.json'), '',
    'the request must be cleared so it is answered once');
  assert.ok(f.events.includes('ui:vpn_backend_handoff_stopped'),
    `handoff was not recorded: ${f.events.join(', ')}`);
});

test('the handoff answer keeps polling while no request has arrived', async () => {
  const f = fixture();
  assert.equal(await f.controller.connect('/files'), 'started');
  await flush();
  assert.equal(f.response(), undefined, 'nothing to answer yet');
  assert.equal(f.stops, 0);
  assert.ok(f.sleeps.length > 0, 'the answer loop must keep waiting for the request');
  await arrive(f, JSON.stringify({ requestId: 91 }));
  assert.equal(f.stops, 1);
  assert.equal(JSON.parse(f.response()).requestId, 91);
});

test('a backend that cannot be stopped still releases the extension', async () => {
  const f = fixture();
  f.stopThrows = true;
  await f.controller.connect('/files');
  await arrive(f, JSON.stringify({ requestId: 12 }));
  const response = JSON.parse(f.response());
  assert.equal(response.requestId, 12);
  assert.match(response.status, /stop unavailable/);
  assert.ok(f.events.includes('ui:vpn_backend_handoff_stop_failed'));
});

test('a malformed handoff request is cleared, not answered', async () => {
  const f = fixture();
  await f.controller.connect('/files');
  await arrive(f, 'not json');
  assert.equal(f.stops, 0);
  assert.equal(f.response(), undefined);
  assert.equal(f.files.get('vpn-backend-handoff-request.json'), '');
  assert.ok(f.events.includes('ui:vpn_backend_handoff_request_invalid'));
});

test('a stale request id is refused instead of confirming the handoff', async () => {
  const f = fixture();
  await f.controller.connect('/files');
  await arrive(f, JSON.stringify({ requestId: 0 }));
  assert.equal(f.stops, 0, 'a request without an id must not stop the backend');
  assert.equal(f.response(), undefined);
});

test('a connect that is already up never starts or stops anything', async () => {
  const f = fixture();
  f.state = 'connected';
  assert.equal(await f.controller.connect('/files'), 'unchanged');
  await flush();
  assert.equal(f.extensionStarts, 0);
  assert.equal(f.stops, 0);
  assert.equal(f.sleeps.length, 0, 'an unchanged connect must not poll');
});

test('a connect that lost its authority never starts the extension', async () => {
  // The reconnect supervisor withdraws its authority when the user disconnects.
  // The token reports true while the attempt is live, so false cancels it.
  const f = fixture();
  f.state = 'disconnected';
  let asked = 0;
  const result = await f.controller.connect('/files', () => { asked++; return false; });
  assert.equal(result, 'cancelled');
  assert.equal(f.extensionStarts, 0, 'a cancelled connect started the extension');
  assert.ok(asked > 0, 'the connect never consulted the authority token');
});

test('a connect that lost its authority leaves the user intent alone', async () => {
  // The user can stop between the supervisor's decision and this call. A
  // connect that writes the intent first would erase that stop.
  const f = fixture();
  f.state = 'disconnected';
  const result = await f.controller.connect('/files', () => false);
  assert.equal(result, 'cancelled');
  assert.equal(f.intentWrites.length, 0,
    'a cancelled connect wrote connected over the stop the user just made');
  assert.equal(f.extensionStarts, 0);
});

test('a connect that keeps its authority still starts the extension', async () => {
  const f = fixture();
  f.state = 'disconnected';
  const result = await f.controller.connect('/files', () => true);
  assert.equal(result, 'started');
  assert.equal(f.extensionStarts, 1);
});

test('a stop after the backend wait cancels the connect', async () => {
  // The backend wait is the long step. Authority lost during it must stop the
  // connect before the extension starts.
  const f = fixture();
  f.state = 'disconnected';
  let calls = 0;
  const result = await f.controller.connect('/files', () => ++calls === 1);
  assert.equal(result, 'cancelled');
  assert.ok(calls >= 2, `the token was not asked again after the backend wait: ${calls}`);
  assert.equal(f.extensionStarts, 0, 'an unauthorised connect started the extension');
});

test('a headless connect records the user intent before the command', async () => {
  const f = fixture();
  assert.equal(await f.controller.connect('/files', undefined, 'card'), 'started');
  assert.deepEqual(JSON.parse(JSON.stringify(f.intentWrites)), [{ desired: 'connected', by: 'card' }],
    'the connect did not leave the intent the supervisor and the task manager read');
  assert.equal(f.extensionStarts, 1);
});

test('a recovery connect leaves the user intent untouched', async () => {
  // The supervisor recovers only while the intent says connected. Rewriting it
  // here could erase a stop that landed between its read and this call.
  const f = fixture();
  f.state = 'disconnected';
  assert.equal(await f.controller.connect('/files', undefined, 'recovery'), 'started');
  assert.equal(f.intentWrites.length, 0, 'the recovery rewrote the intent the user owns');
  assert.equal(f.extensionStarts, 1);
});

test('a connect during the connect window does not start a second extension', async () => {
  // The status reader reports CONNECTING once the TUN exists. A second start
  // would race the first and can leave two start requests for one session.
  const f = fixture();
  f.state = 'connecting';
  const result = await f.controller.connect('/files', undefined, 'card');
  assert.equal(result, 'unchanged');
  assert.equal(f.extensionStarts, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.intentWrites)),
    [{ desired: 'connected', by: 'card' }],
    'the user connect must still re-assert the intent');
});

test('a second connect during an uncertain status does not start again', async () => {
  // The first card tap wrote the intent seconds ago. No heartbeat exists yet,
  // so the reader says unknown. A second tap must not stage a second start.
  const f = fixture();
  f.state = 'unknown';
  f.intentDesired = 'connected';
  f.intentChangedAtMs = 1_000_000;
  const result = await f.controller.connect('/files', undefined, 'card');
  assert.equal(result, 'unchanged');
  assert.equal(f.extensionStarts, 0);
});

test('an old connected intent does not block a connect during an uncertain status', async () => {
  const f = fixture();
  f.state = 'unknown';
  f.intentDesired = 'connected';
  f.intentChangedAtMs = 1_000_000 - 31000;
  const connecting = f.controller.connect('/files', undefined, 'card');
  await flush();
  assert.equal(f.extensionStarts, 1);
  // Answer the handoff so the test does not leave the loop polling.
  await arrive(f, JSON.stringify({ requestId: 1 }));
  await connecting;
  assert.equal(f.extensionStarts, 1);
});

test('a user connect cancels when its intent write fails', async () => {
  // Fail closed: a missing intent means the task manager and the supervisor
  // would treat the session as stopped, so the tunnel must not start.
  const f = fixture();
  f.state = 'disconnected';
  f.intentDesired = 'stopped';
  f.intentWriteFails = true;
  const result = await f.controller.connect('/files', undefined, 'card');
  assert.equal(result, 'cancelled');
  assert.equal(f.extensionStarts, 0);
});

test('a recovery undo leaves the user intent and the stop ledger alone', async () => {
  // A recovery undo stops the extension it started. It must not write stopped
  // over a new connect, and it must not record a user stop the user did not make.
  const f = fixture();
  f.state = 'disconnected';
  const result = await f.controller.disconnect('/files', 'recovery');
  assert.equal(result, 'unchanged');
  assert.equal(f.intentWrites.length, 0, 'the recovery undo rewrote the user intent');
  assert.equal(f.ledgerEnds.length, 0, 'the recovery undo wrote a user stop record');
});

test('a user stop writes the intent and one user stop record', async () => {
  const f = fixture();
  f.state = 'disconnected';
  const result = await f.controller.disconnect('/files', 'card');
  assert.equal(result, 'unchanged');
  assert.deepEqual(JSON.parse(JSON.stringify(f.intentWrites)),
    [{ desired: 'stopped', by: 'card' }]);
  assert.equal(f.ledgerEnds.length, 1);
  assert.equal(f.ledgerEnds[0][3], 'user_stop');
});

test('a recovered session refreshes the snapshot and clears stale traffic', () => {
  // O-SESSION-13. A recovery builds a new tunnel under the user's feet. The
  // page must not keep the old peer snapshot or the old traffic numbers, and
  // the new session must be visible to the page on its next read.
  const source = readFileSync(new URL(
    '../entry/src/main/ets/services/VpnStatusReader.ets', import.meta.url), 'utf8');
  const sandbox = {};
  runModules(sandbox, [{
    source: enumToObject(source, 'VpnLinkState'),
    names: ['VpnLinkState', 'VpnStatusReader', 'VpnSnapshotTracker']
  }]);
  const tracker = new sandbox.VpnSnapshotTracker();
  const connected = (sessionId, txBytes, rxBytes) =>
    ({ state: 'connected', txBytes, rxBytes, sessionId });

  const first = tracker.observe(connected('100', 10, 20));
  assert.equal(first.sessionId, '100');
  assert.equal(first.refreshDue, false, 'the first reading must not force a refresh');

  assert.equal(tracker.observe(connected('100', 30, 40)).refreshDue, false,
    'the same session forced a refresh');

  const recovered = tracker.observe(connected('200', 1, 2));
  assert.equal(recovered.refreshDue, true, 'a new session did not force a refresh');
  assert.equal(recovered.previousSessionId, '100');
  assert.equal(recovered.trafficReset, true, 'old traffic was carried into the new session');
  assert.equal(recovered.snapshotStale, true, 'the old peer snapshot was kept');

  // Going down and coming back with the same session id is not a new session,
  // but it is still a change the page has to see.
  tracker.observe({ state: 'disconnected', txBytes: 0, rxBytes: 0, sessionId: '200' });
  const back = tracker.observe(connected('200', 5, 6));
  assert.equal(back.refreshDue, true, 'a reconnected session did not force a refresh');
  assert.equal(back.trafficReset, false, 'traffic was reset without a new session');

  // A missing session id cannot be compared, so the previous one is kept and
  // no reset is invented from silence.
  const quiet = tracker.observe({ state: 'unknown', txBytes: 0, rxBytes: 0, sessionId: '' });
  assert.equal(quiet.sessionId, '200');
  assert.equal(quiet.trafficReset, false);
});

test('the handoff answer window covers the extension wait budget', () => {
  // Two processes, two pairs of constants, and until now nothing tied them
  // together. They only happened to be equal, so changing either side alone
  // would silently lose the answer and the extension would destroy the VPN
  // fifteen seconds later. Read the real sources and assert the relation.
  const extension = readFileSync(new URL(
    '../entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets',
    import.meta.url), 'utf8');
  const controller = readFileSync(new URL(
    '../entry/src/main/ets/services/VpnSessionController.ets', import.meta.url), 'utf8');
  const number = (text, name) => {
    const match = text.match(new RegExp(`${name}\\s*:\\s*number\\s*=\\s*([0-9_]+)`));
    assert.ok(match, `${name} not found`);
    return Number(match[1].replace(/_/g, ''));
  };
  const extensionWait = number(extension, 'VPN_BACKEND_HANDOFF_POLL_INTERVAL_MS')
    * number(extension, 'VPN_BACKEND_HANDOFF_MAX_ATTEMPTS');
  const answerWindow = number(controller, 'BACKEND_HANDOFF_POLL_INTERVAL_MS')
    * number(controller, 'BACKEND_HANDOFF_MAX_ATTEMPTS');
  assert.ok(answerWindow >= extensionWait,
    `the answer window ${answerWindow} ms is shorter than the extension wait ${extensionWait} ms`);
});
