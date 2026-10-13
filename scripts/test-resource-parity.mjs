import assert from 'node:assert/strict';
import test from 'node:test';
import { diffResourceKeys } from './check-resource-parity.mjs';

// Build a resource document from a list of names.
// The value takes the name, because a difference check reads only the name.
function document(names) {
  return { string: names.map(name => ({ name, value: name })) };
}

test('equal key sets report no difference', () => {
  const result = diffResourceKeys(document(['a', 'b']), document(['a', 'b']));
  assert.deepEqual(result.onlyInBase, []);
  assert.deepEqual(result.onlyInZh, []);
  assert.equal(result.baseKeys, 2);
  assert.equal(result.zhKeys, 2);
});

test('a key only in base is reported as only in base', () => {
  const result = diffResourceKeys(document(['a', 'b']), document(['a']));
  assert.deepEqual(result.onlyInBase, ['b']);
  assert.deepEqual(result.onlyInZh, []);
});

test('a key only in zh_CN is reported as only in zh_CN', () => {
  const result = diffResourceKeys(document(['a']), document(['a', 'b']));
  assert.deepEqual(result.onlyInBase, []);
  assert.deepEqual(result.onlyInZh, ['b']);
});

test('a key on each side reports one difference per side', () => {
  const result = diffResourceKeys(document(['a', 'base_only']), document(['a', 'zh_only']));
  assert.deepEqual(result.onlyInBase, ['base_only']);
  assert.deepEqual(result.onlyInZh, ['zh_only']);
});

test('empty documents report no crash and no difference', () => {
  const result = diffResourceKeys({}, {});
  assert.deepEqual(result.onlyInBase, []);
  assert.deepEqual(result.onlyInZh, []);
  assert.equal(result.baseKeys, 0);
  assert.equal(result.zhKeys, 0);
});

test('an empty string member reports no difference', () => {
  const result = diffResourceKeys({ string: [] }, { string: [] });
  assert.equal(result.baseKeys, 0);
  assert.equal(result.zhKeys, 0);
});

test('an entry without a name is ignored', () => {
  const result = diffResourceKeys({ string: [{ value: 'x' }] }, document(['a']));
  assert.equal(result.baseKeys, 0);
  assert.deepEqual(result.onlyInZh, ['a']);
});
