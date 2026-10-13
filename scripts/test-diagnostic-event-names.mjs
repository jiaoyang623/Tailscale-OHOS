import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEventNames } from './check-diagnostic-event-names.mjs';

// The pure function reads two name lists.
// It returns the names the registry misses and the registry rows the source misses.

test('every source name is in the registry', () => {
  const result = checkEventNames(['a', 'b', 'c'], ['a', 'b', 'c']);
  assert.deepEqual(result, { unknown: [], unused: [] });
});

test('a source name that is not in the registry is unknown', () => {
  const result = checkEventNames(['a', 'b', 'new_event'], ['a', 'b']);
  assert.deepEqual(result, { unknown: ['new_event'], unused: [] });
});

test('a registry row that is not in the source is unused', () => {
  const result = checkEventNames(['a'], ['a', 'removed_event']);
  assert.deepEqual(result, { unknown: [], unused: ['removed_event'] });
});

test('empty input reports no difference', () => {
  const result = checkEventNames([], []);
  assert.deepEqual(result, { unknown: [], unused: [] });
});

test('one unknown name and one unused row are reported together', () => {
  const result = checkEventNames(['a', 'b'], ['a', 'c']);
  assert.deepEqual(result, { unknown: ['b'], unused: ['c'] });
});
