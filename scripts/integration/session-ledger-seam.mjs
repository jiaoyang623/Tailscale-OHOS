import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from '../lib/arkts-module.mjs';
import { memoryFileIo } from '../lib/memory-fs.mjs';

// O-SEAM-19, host side: two processes, one logical ledger.
//
// The extension writes an end before it exits. The app writes the observation,
// and may itself write a user stop before the extension sees the request. Each
// writer owns one file, so a compaction in one process cannot erase a line
// appended by the other. Both share one closed reason vocabulary, and the set
// of files alone decides whether a record is already there.
const source = readFileSync(
  new URL('../../entry/src/main/ets/services/SessionLedger.ets', import.meta.url), 'utf8');
const storageSource = readFileSync(
  new URL('../../entry/src/main/ets/services/StoragePaths.ets', import.meta.url), 'utf8');

test('two writers append to one ledger and neither rewrite drops the other record', () => {
  const fileIo = memoryFileIo();
  const events = [];
  const sandbox = {
    Date: { now: () => 9_000 },
    fileIo,
    hilog: { info: () => {}, error: () => {} },
    DiagnosticEventStore: { record: (_dir, _source, event) => events.push(event) }
  };
  runModules(sandbox, [
    { source: storageSource, names: ['StoragePaths'] },
    {
      source: enumToObject(enumToObject(source, 'SessionEndReason'), 'SessionLedgerKind'),
      names: ['SessionEndReason', 'SessionLedgerKind', 'SessionLedger', 'SESSION_END_REASONS']
    }
  ]);
  const ledger = sandbox.SessionLedger;
  const vocabulary = sandbox.SESSION_END_REASONS;

  // The extension is the first writer: it sees onDestroy.
  assert.equal(ledger.recordEnd('/files', 'vpn', '1700000000001',
    sandbox.SessionEndReason.EXTENSION_DESTROYED, 'on_destroy', 0, 9_000), true);

  // The app is the second writer: it observes the same end and records it.
  assert.equal(ledger.recordObserved('/files', 'ui', '1700000000001',
    sandbox.SessionEndReason.EXTENSION_DESTROYED, 'on_destroy', 0, 9_100), true);

  // A second end for the same session is refused, whichever writer sends it.
  assert.equal(ledger.recordEnd('/files', 'ui', '1700000000001',
    sandbox.SessionEndReason.USER_STOP, 'user', 0, 9_200), false);

  const entries = ledger.read('/files');
  assert.deepEqual(JSON.parse(JSON.stringify(entries.map((entry) => entry.kind))), ['end', 'observed']);
  assert.deepEqual(JSON.parse(JSON.stringify(entries.map((entry) => entry.writer))), ['vpn', 'ui']);
  assert.equal(entries[0].sessionId, entries[1].sessionId);
  for (const entry of entries) {
    assert.ok(vocabulary.includes(entry.reason),
      `${entry.reason} is outside the shared vocabulary`);
  }

  // Each writer used its own file. A compaction in one process therefore cannot
  // rewrite the other process file.
  const ledgerPaths = [...fileIo.files.keys()].filter((path) => path.includes('ledger')).sort();
  assert.deepEqual(ledgerPaths,
    ['/files/vpn-session-ledger-ui.ndjson', '/files/vpn-session-ledger-vpn.ndjson']);
  assert.equal(fileIo.files.has('/files/vpn-session-ledger.ndjson'), false,
    'a new write used the legacy shared file');

  // The last end is published for the next reader, and the reader clears it
  // after taking it so a restart cannot observe the same end twice.
  const end = ledger.readEndFile('/files');
  assert.equal(end.reason, 'extension_destroyed');
  assert.equal(end.sessionId, '1700000000001');
  assert.equal(ledger.recordObserved('/files', 'ui', end.sessionId, end.reason,
    end.phase, 0, 9_300), false, 'the end was observed twice');
  ledger.clearEndFile('/files');
  assert.equal(ledger.readEndFile('/files'), undefined);
});
