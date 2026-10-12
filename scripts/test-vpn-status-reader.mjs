import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Run the real status reader against a deterministic file/clock boundary.
// The card, the FormExtensionAbility and the app all derive state from this
// one function, so a drift here would make the card disagree with the app.
const source = readFileSync(new URL('../entry/src/main/ets/services/VpnStatusReader.ets', import.meta.url), 'utf8');

// stripTypeScriptTypes only removes types; an enum is runtime syntax it
// rejects. Rewrite the enum into an equivalent object, reading the members
// straight out of the source so the test cannot drift from the real values.
function enumToObject(text, name) {
  const match = text.match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `enum ${name} not found`);
  const members = [...match[1].matchAll(/(\w+)\s*=\s*'([^']*)'/g)]
    .map(pair => `${pair[1]}: '${pair[2]}'`);
  assert.ok(members.length > 0, `enum ${name} has no members`);
  return text.replace(match[0], `const ${name} = { ${members.join(', ')} };`);
}

const javascript = stripTypeScriptTypes(
  enumToObject(source, 'VpnLinkState')
    .replace(/^import .*;\r?$/gm, '')
    .replace('export class VpnStatusReader', 'class VpnStatusReader'));

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
    StoragePaths: { vpnStatusPath: dir => `${dir}/vpn-probe-status.txt` }
  };
  vm.runInNewContext(javascript + '\nglobalThis.Reader = VpnStatusReader; globalThis.State = VpnLinkState;', sandbox);
  f.read = () => sandbox.Reader.read('/files');
  f.at = status => { f.status = `${status} | heartbeatMs=${f.now}`; };
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
  f.status = 'OK | state=Running | tun=true | heartbeatMs=900000';
  assert.equal(f.read().state, 'unknown');
});

test('a heartbeat from the future is unknown', () => {
  const f = fixture();
  f.status = 'OK | state=Running | tun=true | heartbeatMs=1000001';
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
  f.at('VPN disconnected | backend stopping');
  assert.equal(f.read().state, 'disconnected');
});

test('a failed extension reports disconnected', () => {
  const f = fixture();
  f.at('FAILED | VPN conflict | code=2203002');
  assert.equal(f.read().state, 'disconnected');
});

test('a failed snapshot read is not treated as a stopped tunnel', () => {
  const f = fixture();
  f.at('FAILED | VPN backend | status unavailable');
  assert.equal(f.read().state, 'unknown');
});

test('a pending sign-in reports needs_login', () => {
  const f = fixture();
  f.at('NeedsLogin | loginURLReady=true');
  assert.equal(f.read().state, 'needs_login');
});

test('a working tunnel wins over a stale sign-in marker', () => {
  const f = fixture();
  f.at('NeedsLogin | state=Running | tun=true');
  assert.equal(f.read().state, 'connected');
});

test('running without a TUN is not connected', () => {
  const f = fixture();
  f.at('state=Running | tun=false');
  assert.equal(f.read().state, 'unknown');
});
