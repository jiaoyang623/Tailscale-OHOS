import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The analyzer reads the device log by name. When a name leaves the source but
// stays in this list, every run reports a gap that can never close, and the
// operator has to work out that the gap is not real.
//
// That happened. vpn_replacement_approved and vpn_replace_retry stayed in the
// list after round 12 deleted their only producer, so the analyzer would have
// reported both as 未观测到 on every future device run.
//
// Every name in WATCH must still appear somewhere in the registry, either as a
// table row or in its 非字面量调用点 section. vpn_network_rebound gains a
// bearer suffix, so the registry carries it as a prefix with a variable.

const HERE = import.meta.url;
const read = (rel) => readFileSync(new URL(rel, HERE), 'utf8');

function watchNames() {
  const source = read('./device-analyze.py');
  const block = source.match(/WATCH = \[([\s\S]*?)\n\]/);
  assert.ok(block, 'device-analyze.py lost its WATCH list');
  return [...block[1].matchAll(/\("([^"]+)",/g)].map((match) => match[1]);
}

test('the analyzer only watches names the registry still carries', () => {
  const registry = read('../docs/diagnostics/event-names.md');
  const names = watchNames();
  assert.ok(names.length > 0, 'the analyzer watches nothing');
  const gone = names.filter((name) => !registry.includes(name));
  assert.deepEqual(gone, [],
    'the analyzer watches names the registry no longer carries');
});

test('the keyword list stays separate from the watched event names', () => {
  // Keywords are log substrings, not diagnostic event names, so they must not
  // be pulled into the registry check above.
  const source = read('./device-analyze.py');
  const block = source.match(/KEYWORDS = \[([\s\S]*?)\n\]/);
  assert.ok(block, 'device-analyze.py lost its KEYWORDS list');
  const keywords = [...block[1].matchAll(/\("([^"]+)",/g)].map((match) => match[1]);
  assert.ok(keywords.length > 0, 'the keyword list is empty');
  const watched = new Set(watchNames());
  const overlap = keywords.filter((name) => watched.has(name));
  assert.deepEqual(overlap, [], 'a name is both an event name and a keyword');
});
