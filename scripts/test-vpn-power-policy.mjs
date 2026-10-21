import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';
import { memoryFileIo } from './lib/memory-fs.mjs';

// Run the real power policy against an in-memory filesystem.
//
// The app is told it uses too much power. The answer is not to stop the
// tunnel: the stage only changes how often the app looks. The stage table is
// one place, so the UI timers and the extension cadence cannot disagree.
const source = readFileSync(
  new URL('../entry/src/main/ets/services/VpnPowerPolicy.ets', import.meta.url), 'utf8');
const storageSource = readFileSync(
  new URL('../entry/src/main/ets/services/StoragePaths.ets', import.meta.url), 'utf8');

const STAGE_FILE = '/files/vpn-power-stage.json';
// Values built inside the vm realm carry that realm's prototypes, so compare
// a plain copy with the assertions below.
const plain = (value) => JSON.parse(JSON.stringify(value));
const FRESH_MS = 15000;

function fixture(initial = {}) {
  const f = { events: [], fileIo: memoryFileIo(initial), active: true };
  const sandbox = {
    fileIo: f.fileIo,
    power: { isActive: () => f.active },
    DiagnosticEventStore: { record: (_dir, _source, event) => f.events.push(event) }
  };
  runModules(sandbox, [
    { source: storageSource, names: ['StoragePaths'] },
    { source: enumToObject(source, 'VpnPowerStage'), names: ['VpnPowerStage', 'VpnPowerPolicy'] }
  ]);
  f.policy = sandbox.VpnPowerPolicy;
  f.stage = sandbox.VpnPowerStage;
  f.read = () => f.policy.readStage('/files');
  f.write = (stage) => f.policy.writeStage('/files', stage);
  f.file = () => JSON.parse(f.fileIo.files.get(STAGE_FILE));
  return f;
}

test('background stops UI probes but keeps the recovery watchdog', () => {
  const f = fixture();
  const ui = plain(f.policy.uiTimersToStop(f.stage.BACKGROUND));
  assert.deepEqual(ui.slice().sort(), ['cacheSize', 'connectionDuration', 'deviceDetail',
    'homeLatency', 'offlinePeerStatus', 'serviceRefresh', 'transferProtocol'].sort());
  for (const name of ['healthPoll', 'cardTimer']) {
    assert.equal(ui.includes(name), false, `${name} must not be stopped by the stage`);
  }
  assert.deepEqual(plain(f.policy.uiTimersToStop(f.stage.ACTIVE)), [], 'the active stage stopped a timer');
  assert.deepEqual(plain(f.policy.uiTimersToStop(f.stage.SCREEN_OFF)).sort(), ui.slice().sort(),
    'the screen-off stage stops a different set of UI timers');

  // The recovery watchdog is not one of the UI timers: it stays in every stage.
  for (const stage of [f.stage.ACTIVE, f.stage.BACKGROUND, f.stage.SCREEN_OFF]) {
    assert.equal(f.policy.recoveryWatchdogRuns(stage), true, `the watchdog stopped at ${stage}`);
  }

  // The background row of the stage table, and the screen-off row.
  assert.deepEqual(plain(f.policy.extensionIntervals(f.stage.BACKGROUND)),
    { commandMs: 250, statusMs: 2000, snapshotMs: 2000 });
  assert.deepEqual(plain(f.policy.extensionIntervals(f.stage.SCREEN_OFF)),
    { commandMs: 1000, statusMs: 5000, snapshotMs: 15000 });
  assert.deepEqual(plain(f.policy.extensionIntervals(f.stage.ACTIVE)),
    { commandMs: 100, statusMs: 1000, snapshotMs: 1000 });
});

test('screen off slows the extension cadence without breaking freshness', () => {
  const f = fixture();
  const off = f.policy.extensionIntervals(f.stage.SCREEN_OFF);
  // Three missed status ticks still leave the heartbeat inside the freshness
  // window, so a reader never calls the tunnel unknown just because it lowered
  // its rate.
  assert.ok(off.statusMs * 3 <= FRESH_MS,
    `three status ticks take ${off.statusMs * 3} ms, over the ${FRESH_MS} ms freshness window`);
  // The command loop is the slowest thing the extension does when idle, but it
  // is still faster than the freshness window, so a stop request is answered.
  assert.ok(off.commandMs < FRESH_MS);

  // Power follows the screen. With the app in the background and the screen
  // on, the stage is background; with the screen off it is screen-off.
  const g = fixture();
  assert.equal(g.policy.stageFor(false), g.stage.SCREEN_OFF);
  assert.equal(g.policy.stageFor(true), g.stage.BACKGROUND);
  g.active = false;
  assert.equal(g.policy.stageFor(true), g.stage.SCREEN_OFF);
  assert.equal(g.policy.stageFor(false), g.stage.SCREEN_OFF);
});

test('a missing or corrupt stage file falls back to active', () => {
  // Every damaged form runs at the active cadence and says why.
  const damaged = [undefined, '', 'not json', '{"stage":"turbo"}', '{}',
    '{"stage":3}'];
  for (const text of damaged) {
    const initial = text === undefined ? {} : { [STAGE_FILE]: text };
    const f = fixture(initial);
    const stage = f.read();
    assert.equal(stage, f.stage.ACTIVE, `"${text}" was read as ${stage}`);
    assert.deepEqual(plain(f.policy.extensionIntervals(stage)),
      { commandMs: 100, statusMs: 1000, snapshotMs: 1000 });
    assert.ok(f.events.includes('vpn_power_stage_missing'),
      `"${text}" did not record the missing stage: ${f.events.join(', ')}`);
  }

  // A failed write keeps the previous stage; it does not fall to the slowest.
  const f = fixture();
  assert.equal(f.write(f.stage.SCREEN_OFF), true);
  f.fileIo.failWrites = true;
  assert.equal(f.write(f.stage.ACTIVE), false);
  assert.ok(f.events.includes('vpn_power_stage_write_failed'));
  f.fileIo.failWrites = false;
  assert.equal(f.read(), f.stage.SCREEN_OFF, 'a failed write replaced the stage');
});

test('stage changes are observable', () => {
  const f = fixture();
  const path = [f.stage.ACTIVE, f.stage.BACKGROUND, f.stage.SCREEN_OFF,
    f.stage.BACKGROUND, f.stage.ACTIVE];
  const changes = [];
  for (const stage of path) {
    f.policy.applyStage('/files', stage, changes);
  }
  assert.deepEqual(plain(changes), [
    { from: 'active', to: 'background' },
    { from: 'background', to: 'screen-off' },
    { from: 'screen-off', to: 'background' },
    { from: 'background', to: 'active' }
  ]);
  assert.equal(f.events.filter((event) => event === 'vpn_power_stage_changed').length, 4);

  // Sampling the same stage again is not a change.
  const again = [];
  f.policy.applyStage('/files', f.stage.ACTIVE, again);
  assert.deepEqual(again, [], 'a repeated sample was recorded as a change');
  assert.equal(f.events.filter((event) => event === 'vpn_power_stage_changed').length, 4);

  // The file holds only the stage name.
  assert.deepEqual(Object.keys(f.file()), ['stage']);
  assert.equal(f.file().stage, 'active');
});

test('the desktop card refresh slows with the power stage', () => {
  // The card timer keeps the supervisor cadence at 5 s. The card system call
  // itself does not need that rate when the user is away.
  const f = fixture();
  assert.equal(f.policy.cardRefreshTicks(f.stage.ACTIVE), 1);
  assert.equal(f.policy.cardRefreshTicks(f.stage.BACKGROUND), 3);
  assert.equal(f.policy.cardRefreshTicks(f.stage.SCREEN_OFF), 12);
});
