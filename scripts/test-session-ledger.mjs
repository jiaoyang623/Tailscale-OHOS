import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';
import { memoryFileIo } from './lib/memory-fs.mjs';

// Run the real session ledger against an in-memory filesystem.
//
// The ledger is the answer to "why did the tunnel end?". It is written by two
// processes, so it has to dedupe from the file alone, survive a torn last
// line, and keep its size bounded. The reason vocabulary is closed: a reason
// from outside it becomes unknown, and unknown always names the missing
// evidence in its phase.
const source = readFileSync(
  new URL('../entry/src/main/ets/services/SessionLedger.ets', import.meta.url), 'utf8');
const storageSource = readFileSync(
  new URL('../entry/src/main/ets/services/StoragePaths.ets', import.meta.url), 'utf8');

const LEDGER = '/files/vpn-session-ledger-vpn.ndjson';
const UI_LEDGER = '/files/vpn-session-ledger-ui.ndjson';

function fixture() {
  const f = { events: [], fileIo: memoryFileIo(), now: 5_000 };
  const sandbox = {
    Date: { now: () => f.now },
    fileIo: f.fileIo,
    hilog: { info: () => {}, error: () => {} },
    DiagnosticEventStore: { record: (_dir, _source, event) => f.events.push(event) }
  };
  runModules(sandbox, [
    { source: storageSource, names: ['StoragePaths'] },
    {
      source: enumToObject(enumToObject(source, 'SessionEndReason'), 'SessionLedgerKind'),
      names: ['SessionEndReason', 'SessionLedgerKind', 'SessionLedger', 'SESSION_END_REASONS']
    }
  ]);
  f.ledger = sandbox.SessionLedger;
  f.reason = sandbox.SessionEndReason;
  f.kind = sandbox.SessionLedgerKind;
  f.reasons = sandbox.SESSION_END_REASONS;
  f.lines = (writer = 'vpn') => {
    const path = writer === 'vpn' ? LEDGER : UI_LEDGER;
    const text = f.fileIo.files.get(path) ?? '';
    return text.length === 0 ? [] : text.split('\n').filter((line) => line.length > 0);
  };
  f.entries = () => f.lines().map((line) => JSON.parse(line));
  f.recordEnd = (sessionId, reason, phase = 'on_destroy') => f.ledger.recordEnd(
    '/files', 'vpn', sessionId, reason, phase, 0, f.now);
  return f;
}

test('every non-user end is recorded with a controlled reason', () => {
  const f = fixture();
  const reasons = ['extension_destroyed', 'extension_crash', 'handoff_timeout',
    'system_stopped', 'network_lost'];
  reasons.forEach((reason, index) => {
    f.now = 6_000 + index;
    assert.equal(f.recordEnd(`session-${index}`, reason), true, reason);
  });
  const entries = f.entries();
  assert.equal(entries.length, reasons.length);
  reasons.forEach((reason, index) => {
    const entry = entries[index];
    assert.equal(entry.reason, reason);
    assert.equal(entry.sessionId, `session-${index}`);
    assert.equal(entry.writer, 'vpn');
    assert.equal(entry.kind, 'end');
    assert.equal(entry.timestampMs, 6_000 + index);
    assert.deepEqual(Object.keys(entry).sort(),
      ['code', 'kind', 'phase', 'reason', 'sessionId', 'timestampMs', 'writer']);
  });
  assert.ok(f.events.includes('vpn_session_end'),
    'a written end is not visible in diagnostics');

  // A reason from outside the vocabulary is not stored as free text. It
  // becomes unknown, and its phase names the missing evidence.
  assert.equal(f.recordEnd('session-outside', 'disk_full', ''), true);
  const outside = f.entries().find((entry) => entry.sessionId === 'session-outside');
  assert.equal(outside.reason, 'unknown');
  assert.match(outside.phase, /reason/, `phase does not name the missing evidence: ${outside.phase}`);

  // A record without a session identity is refused rather than written.
  const count = f.lines().length;
  assert.equal(f.recordEnd('', 'extension_crash'), false);
  assert.equal(f.recordEnd(undefined, 'extension_crash'), false);
  assert.equal(f.lines().length, count, 'a record without a session was written');

  // A write the platform refuses returns false and never throws.
  const g = fixture();
  g.fileIo.failWrites = true;
  assert.equal(g.recordEnd('session-1', 'extension_crash'), false);
});

test('the ledger survives probe noise and bounds itself', () => {
  const f = fixture();
  // Six hundred ends with one-letter phases: the line cap is what trims this
  // run, and eviction is oldest first.
  for (let index = 0; index < 600; index++) {
    f.now = index + 1;
    assert.equal(f.recordEnd(String(index), 'unknown', 'x'), true);
  }
  const lines = f.lines();
  assert.equal(lines.length, 512, `the line cap kept ${lines.length} lines`);
  assert.equal(f.entries()[0].sessionId, '88', 'eviction is not oldest-first');
  assert.equal(f.entries()[511].sessionId, '599', 'the newest end was evicted');

  // The ledger is its own file. A diagnostic file full of probe noise does not
  // change its contents.
  const ledgerText = f.fileIo.files.get(LEDGER);
  f.fileIo.files.set('/files/diagnostic-ui-events.ndjson',
    `${'{"event":"probe"}\n'.repeat(100)}`);
  assert.equal(f.fileIo.files.get(LEDGER), ledgerText);
  assert.equal(f.ledger.read('/files').length, lines.length);

  // The byte cap also holds when phases are long, and at least one entry stays.
  const g = fixture();
  const longPhase = 'x'.repeat(32);
  for (let index = 0; index < 512; index++) {
    g.now = index + 1;
    g.recordEnd(String(index), 'unknown', longPhase);
  }
  const text = g.fileIo.files.get(LEDGER);
  assert.ok(text.length <= 64 * 1024, `the ledger grew to ${text.length} bytes`);
  assert.ok(g.lines().length >= 1, 'the byte cap removed every entry');
  assert.equal(g.entries()[g.lines().length - 1].sessionId, '511');
});

test('a writer compacts only its own file', () => {
  const f = fixture();
  // Fill the extension ledger past its cap.
  for (let index = 0; index < 600; index++) {
    f.now = index + 1;
    assert.equal(f.recordEnd(String(index), 'unknown', 'x'), true);
  }
  assert.equal(f.lines('vpn').length, 512);

  // The app writes to its own file. The next extension compaction must not
  // rewrite the app file, so no line of it can be lost.
  for (let index = 0; index < 3; index++) {
    f.now = 10_000 + index;
    assert.equal(f.ledger.recordObserved('/files', 'ui', `ui-session-${index}`,
      'extension_destroyed', 'on_destroy', 0, f.now), true);
  }
  f.now = 20_000;
  assert.equal(f.recordEnd('session-extra', 'unknown', 'x'), true);
  assert.equal(f.lines('vpn').length, 512, 'the capped file grew past its cap');
  assert.equal(f.lines('ui').length, 3, 'a compaction touched the other writer file');

  const merged = f.ledger.read('/files');
  assert.equal(merged.length, 515, 'the merged ledger lost a record');
  assert.equal(merged[merged.length - 1].sessionId, 'session-extra');

  // No legacy single file is created by new writes.
  assert.equal(f.fileIo.files.has('/files/vpn-session-ledger.ndjson'), false);
});

test('duplicate end records are written once', () => {
  const f = fixture();
  assert.equal(f.recordEnd('session-1', 'extension_destroyed'), true);
  assert.equal(f.recordEnd('session-1', 'extension_destroyed'), false,
    'a second writer appended the same end again');
  assert.equal(f.lines().length, 1, 'the duplicate was stored');

  // An observation is a different kind and is allowed once per session.
  assert.equal(f.ledger.recordObserved('/files', 'ui', 'session-1',
    'extension_destroyed', 'on_destroy', 0, f.now), true);
  assert.equal(f.ledger.recordObserved('/files', 'ui', 'session-1',
    'extension_destroyed', 'on_destroy', 0, f.now), false);
  assert.equal(f.lines('vpn').length, 1);
  assert.equal(f.lines('ui').length, 1, 'the observation is not in its own file');
  assert.equal(f.ledger.read('/files').length, 2, 'end and observed must be two entries');

  // A torn last line is not an entry, and the next write truncates it.
  f.fileIo.files.set(LEDGER, `${f.fileIo.files.get(LEDGER)}{"timestampMs":1`);
  assert.equal(f.ledger.read('/files').length, 2, 'a torn line was parsed as an entry');
  assert.equal(f.recordEnd('session-2', 'handoff_timeout'), true);
  assert.equal(f.ledger.read('/files').length, 3);
  assert.equal(f.lines().filter((line) => !line.endsWith('}')).length, 0,
    'a torn line survived the next write');

  // Dedupe is read from every writer file, so a fresh process sees the same answer.
  const f2 = fixture();
  for (const [path, text] of f.fileIo.files) {
    f2.fileIo.files.set(path, text);
  }
  assert.equal(f2.recordEnd('session-2', 'handoff_timeout'), false,
    'a fresh reader appended an end that the file already has');
  assert.equal(f2.ledger.recordEnd('/files', 'ui', 'session-1',
    'extension_crash', 'racy', 0, f2.now), false,
    'a second writer ignored the end in the other writer file');
});

test('the ledger never stores addresses or identity fields', () => {
  const f = fixture();
  f.recordEnd('1700000000000', 'extension_destroyed', 'on_destroy');
  const entry = JSON.parse(f.lines()[0]);

  // Only the contract fields are present.
  assert.deepEqual(Object.keys(entry).sort(),
    ['code', 'kind', 'phase', 'reason', 'sessionId', 'timestampMs', 'writer']);

  // Address-shaped or identity-shaped values cannot enter through any field.
  f.recordEnd('1700000000001', 'extension_crash', '192.0.2.10');
  f.recordEnd('1700000000002', 'extension_crash', 'peer-0123456789abcdef');
  const text = f.fileIo.files.get(LEDGER);
  assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'an address-shaped phase was stored');
  assert.doesNotMatch(text, /@/, 'an identity-shaped value was stored');
  assert.doesNotMatch(text, /wlan|rmnet/, 'an interface name was stored');

  // A session id that is not an opaque token is refused.
  assert.equal(f.recordEnd('100.64.0.1', 'extension_crash'), false);
  assert.equal(f.recordEnd('4096', 'extension_crash'), true);
});
