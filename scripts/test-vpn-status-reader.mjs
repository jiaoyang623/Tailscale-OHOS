import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';

// Run the real status reader against a deterministic file/clock boundary.
// The card, the FormExtensionAbility and the app all derive state from this
// one function, so a drift here would make the card disagree with the app.
const source = readFileSync(
  new URL('../entry/src/main/ets/services/VpnStatusReader.ets', import.meta.url), 'utf8');

function fixture() {
  const f = { now: 1_000_000, status: '', missing: false, readError: false };
  const sandbox = {
    Date: { now: () => f.now },
    fileIo: {
      accessSync: () => !f.missing,
      readTextSync: () => {
        if (f.readError) {
          throw Error('temporary I/O');
        }
        return f.status;
      }
    },
    StoragePaths: { vpnStatusPath: (dir) => `${dir}/vpn-probe-status.txt` }
  };
  runModules(sandbox, [
    { source: enumToObject(source, 'VpnLinkState'),
      names: ['VpnStatusReader', 'VpnLinkState', 'VPN_STATUS_FRESH_MS'] }
  ]);
  f.read = () => sandbox.VpnStatusReader.read('/files');
  f.at = (status) => { f.status = `${status} | heartbeatMs=${f.now}`; };
  f.window = sandbox.VPN_STATUS_FRESH_MS;
  return f;
}

test('a missing status file is unknown, not disconnected', () => {
  const f = fixture();
  f.missing = true;
  assert.equal(f.read().state, 'unknown');
});

test('an unreadable status file is unknown', () => {
  const f = fixture();
  f.readError = true;
  assert.equal(f.read().state, 'unknown');
});

test('a running tunnel reports connected with real traffic', () => {
  const f = fixture();
  f.at('OK | state=Running | tun=true | txBytes=2048 | rxBytes=1048576');
  const snapshot = f.read();
  assert.equal(snapshot.state, 'connected');
  assert.equal(snapshot.txBytes, 2048);
  assert.equal(snapshot.rxBytes, 1048576);
});

test('a heartbeat older than the freshness window is unknown, not healthy', () => {
  const f = fixture();
  f.at('OK | state=Running | tun=true');
  f.now += f.window + 1;
  assert.equal(f.read().state, 'unknown');
});

test('a heartbeat from the future is unknown', () => {
  const f = fixture();
  f.at('OK | state=Running | tun=true');
  f.now -= 1;
  assert.equal(f.read().state, 'unknown');
});

test('a heartbeat without a value is unknown', () => {
  const f = fixture();
  f.status = 'OK | state=Running | tun=true';
  assert.equal(f.read().state, 'unknown');
});

test('extension teardown reports disconnected', () => {
  const f = fixture();
  f.at('VPN extension destroyed');
  assert.equal(f.read().state, 'disconnected');
});

test('an explicit stop reports disconnected', () => {
  const f = fixture();
  f.at('OK | state=stopped');
  assert.equal(f.read().state, 'disconnected');
});

test('a failed extension reports disconnected', () => {
  const f = fixture();
  f.at('FAILED | VPN start | code=1');
  assert.equal(f.read().state, 'disconnected');
});

test('a failed snapshot read is not treated as a stopped tunnel', () => {
  const f = fixture();
  f.at('FAILED | VPN backend | status unavailable');
  assert.equal(f.read().state, 'unknown');
});

test('a pending sign-in reports needs_login', () => {
  const f = fixture();
  f.at('OK | needsLogin=true');
  assert.equal(f.read().state, 'needs_login');
});

test('a working tunnel wins over a stale sign-in marker', () => {
  const f = fixture();
  f.at('OK | state=Running | tun=true | needsLogin=true');
  assert.equal(f.read().state, 'connected');
});

test('running without a TUN is not connected', () => {
  const f = fixture();
  f.at('OK | state=Running | tun=false');
  assert.equal(f.read().state, 'unknown');
});

test('the connect window reports connecting', () => {
  // The extension writes this line after it creates the TUN and before the
  // backend reports Running. The continuous task must be held here, so the
  // reader has to name the state instead of returning unknown.
  const f = fixture();
  f.at('VPN interface established | backend handoff pending');
  assert.equal(f.read().state, 'connecting');
});

test('a terminal marker wins over a running tunnel', () => {
  // The extension writes one state per second, so this line is transitional or
  // concatenated. Report the tunnel as down. Holding protection on a
  // contradictory line is the worse error.
  const f = fixture();
  f.at('OK | state=Running | tun=true | VPN extension destroyed');
  assert.equal(f.read().state, 'disconnected');
});

test('the freshness window is the one shared value', () => {
  assert.equal(fixture().window, 15000);
});
