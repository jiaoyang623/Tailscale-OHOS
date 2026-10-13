import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from '../lib/arkts-module.mjs';

// Integration: two readers of one status file must give one answer.
//
// The extension rewrites vpn-probe-status.txt every second. VpnStatusReader
// serves the app, the ArkTS card and the reconnect supervisor.
// VpnBackgroundTaskManager decides whether to hold the continuous task. Both
// parsed the same markers, but they ranked the markers differently, so one line
// could produce two answers. These cases pin one vocabulary and one ranking.
//
// The stubs are the platform face only: fileIo, Date.now and StoragePaths.

const HERE = import.meta.url;

const readerSource = readFileSync(
  new URL('../../entry/src/main/ets/services/VpnStatusReader.ets', HERE), 'utf8');
const managerSource = readFileSync(
  new URL('../../entry/src/main/ets/services/VpnBackgroundTaskManager.ets', HERE), 'utf8');

const NOW = 5_000_000;

function fixture(status, missing = false) {
  const sandbox = {
    Date: { now: () => NOW },
    fileIo: {
      accessSync: () => !missing,
      readTextSync: () => status
    },
    StoragePaths: { vpnStatusPath: (dir) => `${dir}/vpn-probe-status.txt` }
  };
  runModules(sandbox, [
    { source: enumToObject(readerSource, 'VpnLinkState'),
      names: ['VpnStatusReader', 'VpnLinkState', 'VPN_STATUS_FRESH_MS'] },
    { source: managerSource, names: ['VpnBackgroundTaskManager'] }
  ]);
  return {
    reader: sandbox.VpnStatusReader.read('/files').state,
    manager: sandbox.VpnBackgroundTaskManager.prototype.readStatus.call(
      new sandbox.VpnBackgroundTaskManager(), '/files').state,
    window: sandbox.VPN_STATUS_FRESH_MS
  };
}

function line(text, heartbeatMs = NOW) {
  return `${text} | heartbeatMs=${heartbeatMs}`;
}

const CASES = [
  { text: 'state=Running | tun=true', expect: 'connected' },
  { text: 'vpn interface established', expect: 'connecting' },
  { text: 'state=stopped', expect: 'disconnected' },
  { text: 'extension destroyed', expect: 'disconnected' },
  { text: 'vpn disconnected', expect: 'disconnected' },
  { text: 'needslogin | loginUrlReady=true', expect: 'needs_login' },
  { text: 'state=Running | tun=false', expect: 'unknown' },
  { text: 'nothing recognisable', expect: 'unknown' }
];

test('both readers give the same answer for every status line', () => {
  for (const item of CASES) {
    const reading = fixture(line(item.text));
    assert.equal(reading.reader, reading.manager,
      `the two readers disagree on "${item.text}"`);
    assert.equal(reading.reader, item.expect, `wrong state for "${item.text}"`);
  }
});

test('a terminal marker wins over a running tunnel in both readers', () => {
  // The ambiguous line. The extension writes one state per second, so this line
  // is a transitional or a concatenated one. Report the tunnel as down, because
  // holding a continuous task on a contradictory line is the worse error.
  const reading = fixture(line('state=Running | tun=true | extension destroyed'));
  assert.equal(reading.reader, 'disconnected');
  assert.equal(reading.manager, 'disconnected');
});

test('a stale heartbeat is unknown in both readers', () => {
  const reading = fixture(line('state=Running | tun=true', NOW - 15001));
  assert.equal(reading.reader, 'unknown');
  assert.equal(reading.manager, 'unknown');
});

test('a missing file is unknown in both readers', () => {
  const reading = fixture('', true);
  assert.equal(reading.reader, 'unknown');
  assert.equal(reading.manager, 'unknown');
});

test('one freshness window serves every reader, and the UI reads it from here', () => {
  assert.equal(fixture('').window, 15000);
  const bridge = readFileSync(
    new URL('../../entry/src/main/ets/components/BridgeStatus.ets', HERE), 'utf8');
  assert.ok(!bridge.includes('VPN_HEARTBEAT_FRESH_MS'),
    'BridgeStatus still defines its own freshness window for the status file');
  assert.ok(bridge.includes('VPN_STATUS_FRESH_MS'),
    'BridgeStatus does not read the shared freshness window');
});
