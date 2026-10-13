// Compare the base and zh_CN string resources.
// The app ships both files together. A key in one file and not the other
// makes the fallback silent, so the gate fails on any difference.
//
// The pure functions below take parsed objects. They read no file.
// The CLI wrapper at the end reads the two real files and prints the result.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE_PATH = 'entry/src/main/resources/base/element/string.json';
const ZH_PATH = 'entry/src/main/resources/zh_CN/element/string.json';

// Read the key set from one parsed resource document.
// The file shape is { "string": [ { "name": ..., "value": ... }, ... ] }.
// A missing or wrong-shaped "string" member yields an empty set.
export function readKeys(document) {
  const entries = document && Array.isArray(document.string) ? document.string : [];
  const keys = new Set();
  for (const entry of entries) {
    if (entry && typeof entry.name === 'string') {
      keys.add(entry.name);
    }
  }
  return keys;
}

// Compare two parsed resource documents.
// Return the key count of each file and the keys that one file alone declares.
export function diffResourceKeys(baseDocument, zhDocument) {
  const baseKeys = readKeys(baseDocument);
  const zhKeys = readKeys(zhDocument);
  const onlyInBase = [...baseKeys].filter(key => !zhKeys.has(key));
  const onlyInZh = [...zhKeys].filter(key => !baseKeys.has(key));
  return {
    baseKeys: baseKeys.size,
    zhKeys: zhKeys.size,
    onlyInBase,
    onlyInZh
  };
}

// Read both files, compare them, and report.
// Return 0 when the key sets match. Return 1 when they differ.
function main() {
  const base = JSON.parse(readFileSync(BASE_PATH, 'utf8'));
  const zh = JSON.parse(readFileSync(ZH_PATH, 'utf8'));
  const result = diffResourceKeys(base, zh);
  if (result.onlyInBase.length === 0 && result.onlyInZh.length === 0) {
    console.log(`string keys match: base=${result.baseKeys} zh_CN=${result.zhKeys}`);
    return 0;
  }
  for (const key of result.onlyInBase) {
    console.error(`only in base: ${key}`);
  }
  for (const key of result.onlyInZh) {
    console.error(`only in zh_CN: ${key}`);
  }
  console.error(`string keys differ: base=${result.baseKeys} zh_CN=${result.zhKeys}`);
  return 1;
}

// Run main only when the shell starts this file. A test import does nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
