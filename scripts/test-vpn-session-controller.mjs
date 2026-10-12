import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

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
    extensionStarts: 0
  };
  const sandbox = {
    Date: { now: () => 1_000_000 },
    // Poll sleeps are released by the test, so the loop's timing is explicit.
    setTimeout: (resolve) => { f.sleeps.push(resolve); },
    VpnActionResult: enumMembers(controllerSource, 'VpnActionResult'),
    VpnLinkState: enumMembers(readerSource, 'VpnLinkState'),
    VpnStatusReader: { read: () => ({ state: f.state, txBytes: 0, rxBytes: 0 }) },
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
