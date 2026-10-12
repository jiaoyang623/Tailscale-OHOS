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
    events: [],
    connectResult: 'started'
  };
  const sandbox = {
    Date: { now: () => f.now },
    VpnLinkState: enumMembers(readerSource, 'VpnLinkState'),
    VpnActionResult: { STARTED: 'started', STOPPED: 'stopped', UNCHANGED: 'unchanged', NEEDS_UI: 'needs_ui', FAILED: 'failed' },
    VpnStatusReader: { read: () => ({ state: f.state, txBytes: 0, rxBytes: 0 }) },
    VpnSessionController: class {
      connect() {
        f.connects++;
        return Promise.resolve(f.connectResult);
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
