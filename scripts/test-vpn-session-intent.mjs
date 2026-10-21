import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';
import { memoryFileIo } from './lib/memory-fs.mjs';

// Run the real intent store against an in-memory filesystem.
//
// The intent file is the one answer to "may the app reconnect?" A status read
// must never write it, and a missing or damaged file means stopped: the app
// would rather miss a recovery than build a tunnel the user never asked for.
const source = readFileSync(
  new URL('../entry/src/main/ets/services/VpnSessionIntent.ets', import.meta.url), 'utf8');
const storageSource = readFileSync(
  new URL('../entry/src/main/ets/services/StoragePaths.ets', import.meta.url), 'utf8');

const INTENT = '/files/vpn-intent.json';

function fixture(initial = {}) {
  const f = {
    now: 1_000_000,
    events: [],
    fileIo: memoryFileIo(initial)
  };
  const sandbox = {
    Date: { now: () => f.now },
    fileIo: f.fileIo,
    DiagnosticEventStore: {
      record: (_dir, _source, event) => f.events.push(event)
    }
  };
  runModules(sandbox, [
    { source: storageSource, names: ['StoragePaths'] },
    { source: enumToObject(source, 'VpnIntentDesired'), names: ['VpnIntentDesired', 'VpnSessionIntent'] }
  ]);
  f.intent = sandbox.VpnSessionIntent;
  f.desired = sandbox.VpnIntentDesired;
  f.read = () => f.intent.read('/files');
  f.file = () => {
    const text = f.fileIo.files.get(INTENT);
    return text === undefined ? undefined : JSON.parse(text);
  };
  return f;
}

test('intent is the only writer that changes the desired state', () => {
  const f = fixture();

  // A missing file is stopped, and it says so on the record.
  const missing = f.read();
  assert.equal(missing.desired, 'stopped');
  assert.equal(missing.present, false);
  assert.equal(missing.by, '');
  assert.ok(f.events.includes('vpn_intent_missing'),
    `a missing intent was not recorded: ${f.events.join(', ')}`);

  // The writer records who asked and when.
  f.now = 2_000_000;
  assert.equal(f.intent.write('/files', f.desired.CONNECTED, 'ui'), true);
  const written = f.file();
  assert.equal(written.desired, 'connected');
  assert.equal(written.by, 'ui');
  assert.equal(written.changedAtMs, 2_000_000);
  assert.deepEqual(Object.keys(written).sort(), ['by', 'changedAtMs', 'desired'],
    'the intent file carries fields that do not belong to it');

  // A read neither rewrites nor relabels the file, and it cannot change the
  // desired state no matter what the tunnel is doing.
  const before = f.fileIo.files.get(INTENT);
  const readBack = f.read();
  assert.equal(readBack.desired, 'connected');
  assert.equal(readBack.present, true);
  assert.equal(readBack.by, 'ui');
  assert.equal(f.fileIo.files.get(INTENT), before, 'a read rewrote the intent');

  // Every damaged form reads as stopped, and it is reported as missing.
  const damaged = [
    '',
    'not json',
    '{"desired":"running"}',
    '{"desired":"connected"}',
    '{"desired":3,"by":"ui","changedAtMs":1}'
  ];
  for (const text of damaged) {
    const g = fixture({ [INTENT]: text });
    const reading = g.read();
    assert.equal(reading.desired, 'stopped', `"${text}" was read as ${reading.desired}`);
    assert.equal(reading.present, false, `"${text}" was reported as present`);
    assert.ok(g.events.includes('vpn_intent_missing'),
      `"${text}" was not recorded as missing: ${g.events.join(', ')}`);
  }

  // A write the platform refuses reports failure and records it, and it never
  // throws: the command flow around it must keep running.
  const h = fixture();
  h.fileIo.failWrites = true;
  assert.equal(h.intent.write('/files', h.desired.CONNECTED, 'ui'), false);
  assert.ok(h.events.includes('vpn_intent_write_failed'));
  h.fileIo.failWrites = false;
  assert.equal(h.read().desired, 'stopped', 'the failed write still changed the intent');
});
