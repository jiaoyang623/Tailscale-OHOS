import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from '../lib/arkts-module.mjs';
import { memoryFileIo } from '../lib/memory-fs.mjs';

// Values built inside the vm realm carry that realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

// O-POWER-03, seam side: the extension reads the stage the app wrote.
//
// The extension and the app each own part of the power behaviour: the app
// chooses the stage and stops its own UI timers, the extension turns the stage
// into its loop intervals. They meet at one file. If the file is missing or
// damaged the extension must run at the active cadence, not the slow one.
const policySource = readFileSync(
  new URL('../../entry/src/main/ets/services/VpnPowerPolicy.ets', import.meta.url), 'utf8');
const storageSource = readFileSync(
  new URL('../../entry/src/main/ets/services/StoragePaths.ets', import.meta.url), 'utf8');

test('the extension runs at the stage the app wrote, active when it cannot tell', () => {
  const fileIo = memoryFileIo();
  const sandbox = {
    fileIo,
    power: { isActive: () => true },
    DiagnosticEventStore: { record: () => {} }
  };
  runModules(sandbox, [
    { source: storageSource, names: ['StoragePaths'] },
    { source: enumToObject(policySource, 'VpnPowerStage'), names: ['VpnPowerStage', 'VpnPowerPolicy'] }
  ]);
  const policy = sandbox.VpnPowerPolicy;
  const stage = sandbox.VpnPowerStage;

  assert.equal(policy.writeStage('/files', stage.BACKGROUND), true);
  const intervals = plain(policy.extensionIntervalsForFile('/files'));
  assert.deepEqual(intervals, { commandMs: 250, statusMs: 2000, snapshotMs: 2000 },
    'the extension did not pick up the stage the app wrote');

  // The file is the only channel. The extension has no other input.
  assert.deepEqual([...fileIo.files.keys()], ['/files/vpn-power-stage.json']);

  // A damaged file in the same place falls back to active, not to the slowest.
  fileIo.files.set('/files/vpn-power-stage.json', '{"stage":"');
  assert.deepEqual(plain(policy.extensionIntervalsForFile('/files')),
    { commandMs: 100, statusMs: 1000, snapshotMs: 1000 });
});
