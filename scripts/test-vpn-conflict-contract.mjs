import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Structural guard for the VPN conflict contract.
//
// The extension used to wait for a vpn-replace-approved file and then destroy
// the other VPN. That file had no writer anywhere in the repository, so the
// branch was unreachable and the extension spun for as long as the app let it.
// The reviewer removed the branch on 2026-10-13 (Q-02). The conflict path can
// only be exercised on a device, so this test pins the contract that can be
// read from the source: the extension never replaces another VPN, and the app
// tells the user to disconnect it.

const HERE = import.meta.url;
const read = (rel) => readFileSync(new URL(rel, HERE), 'utf8');

test('the extension has no approval file and no replacement branch', () => {
  const extension = read('../entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets');
  assert.ok(!extension.includes('vpn-replace-approved'),
    'the extension still references an approval file that nothing writes');
  assert.ok(!extension.includes('replaceExistingVpn'),
    'the extension still carries an unreachable replacement branch');
});

test('the extension republishes the conflict while it waits for the app', () => {
  const extension = read('../entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets');
  assert.ok(extension.includes('VPN_CONFLICT_HEARTBEAT_MS'),
    'the conflict wait lost its heartbeat interval');
  const loop = extension.slice(extension.indexOf('while (!this.destroying)'));
  assert.ok(loop.includes('FAILED | VPN conflict'),
    'the conflict loop no longer publishes the status the app reads');
});

test('the app tells the user to disconnect the other VPN', () => {
  // The product decision behind removing the branch. If this copy changes to
  // an approval wording, the extension needs a writer and this contract is void.
  const english = JSON.parse(read('../entry/src/main/resources/base/element/string.json'));
  const chinese = JSON.parse(read('../entry/src/main/resources/zh_CN/element/string.json'));
  const value = (doc, name) => (doc.string.find((e) => e.name === name) || {}).value || '';
  assert.match(value(english, 'vpn_conflict_message'), /disconnect other vpns/i);
  assert.match(value(chinese, 'vpn_conflict_message'), /断开其它 VPN/);
});
