// Controlled vocabulary for diagnostic event names.
//
// The registry lives in docs/diagnostics/event-names.md.
// The checker builds two name sets.
//   Set 1 holds the literal names in recordDiagnosticEvent calls.
//   Set 2 holds the names in the registry table.
// A name in one set and not the other fails the check.
//
// The check reads membership only. It does not read meaning.
// A call site that passes a variable or a template string is not read.
// The registry lists those call sites in its 非字面量调用点 section.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SOURCE_DIR = 'entry/src/main/ets';
const REGISTRY_FILE = 'docs/diagnostics/event-names.md';
const CALL_PATTERN = /\brecordDiagnosticEvent\s*\(/g;

// Pure function. It reads no file.
// It returns the names the registry misses and the registry rows the source misses.
export function checkEventNames(foundNames, registryNames) {
  const found = new Set(foundNames);
  const registry = new Set(registryNames);
  const unknown = [...found].filter((name) => !registry.has(name)).sort();
  const unused = [...registry].filter((name) => !found.has(name)).sort();
  return { unknown, unused };
}

function lineNumberAt(sourceText, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (sourceText[i] === '\n') {
      line++;
    }
  }
  return line;
}

function normalize(expression) {
  return expression.replace(/\s+/g, ' ').trim();
}

// Return the text of one argument of the call that starts at openParenIndex.
function readArgument(sourceText, openParenIndex, position) {
  const args = [];
  let depth = 0;
  let start = -1;
  for (let i = openParenIndex; i < sourceText.length; i++) {
    const character = sourceText[i];
    if (character === '(') {
      depth++;
      if (depth === 1) {
        start = i + 1;
      }
    } else if (character === ')') {
      depth--;
      if (depth === 0) {
        args.push(sourceText.slice(start, i));
        break;
      }
    } else if (character === ',' && depth === 1) {
      args.push(sourceText.slice(start, i));
      start = i + 1;
    }
  }
  return args[position] === undefined ? '' : args[position].trim();
}

// Resolve an argument expression to its literal string leaves.
// The condition of a conditional expression holds no value.
// A variable and a template string hold no literal value.
function resolveLiteralLeaves(expression) {
  const text = expression.trim();
  let depth = 0;
  let question = -1;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '(' || character === '[' || character === '{') {
      depth++;
    } else if (character === ')' || character === ']' || character === '}') {
      depth--;
    } else if (character === '?' && depth === 0) {
      question = i;
      break;
    }
  }
  if (question === -1) {
    const literal = text.match(/^'([^'\\]*(?:\\.[^'\\]*)*)'$/);
    if (literal) {
      return { literal: true, values: [literal[1]] };
    }
    return { literal: false, values: [] };
  }
  let nested = 0;
  let colon = -1;
  for (let i = question + 1; i < text.length; i++) {
    const character = text[i];
    if (character === '(' || character === '[' || character === '{') {
      nested++;
    } else if (character === ')' || character === ']' || character === '}') {
      nested--;
    } else if (character === ':' && nested === 0) {
      colon = i;
      break;
    }
  }
  if (colon === -1) {
    return { literal: false, values: [] };
  }
  const whenTrue = resolveLiteralLeaves(text.slice(question + 1, colon));
  const whenFalse = resolveLiteralLeaves(text.slice(colon + 1));
  return {
    literal: whenTrue.literal && whenFalse.literal,
    values: [...whenTrue.values, ...whenFalse.values]
  };
}

// Read every literal event name in one source text.
// A call site with no literal event name is a non-literal call site.
export function extractEventNames(sourceText) {
  const names = [];
  const nonLiteral = [];
  CALL_PATTERN.lastIndex = 0;
  let match;
  while ((match = CALL_PATTERN.exec(sourceText)) !== null) {
    const prefix = sourceText.slice(Math.max(0, match.index - 8), match.index);
    if (/private\s*$/.test(prefix)) {
      continue;
    }
    const open = match.index + match[0].length - 1;
    const resolved = resolveLiteralLeaves(readArgument(sourceText, open, 0));
    if (resolved.literal && resolved.values.length > 0) {
      names.push(...resolved.values);
    } else {
      nonLiteral.push({
        line: lineNumberAt(sourceText, match.index),
        expression: normalize(readArgument(sourceText, open, 0))
      });
    }
  }
  return { names, nonLiteral };
}

// List every .ets file under a directory.
export function listSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (entry.endsWith('.ets')) {
      files.push(path);
    }
  }
  return files.sort();
}

// Read the literal names from the registry table.
// A table row starts with a backtick name in its first cell.
export function parseRegistryNames(markdownText) {
  const names = [];
  const pattern = /^\|\s*`([a-z0-9_]+)`\s*\|/gm;
  let match;
  while ((match = pattern.exec(markdownText)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function collectSourceNames() {
  const names = [];
  const nonLiteral = [];
  for (const file of listSourceFiles(join(REPO_ROOT, SOURCE_DIR))) {
    const result = extractEventNames(readFileSync(file, 'utf8'));
    names.push(...result.names);
    for (const site of result.nonLiteral) {
      nonLiteral.push({ file: file.slice(REPO_ROOT.length + 1), ...site });
    }
  }
  return { names, nonLiteral };
}

function main() {
  const found = collectSourceNames();
  const registry = parseRegistryNames(readFileSync(join(REPO_ROOT, REGISTRY_FILE), 'utf8'));
  const result = checkEventNames(found.names, registry);
  if (result.unknown.length === 0 && result.unused.length === 0) {
    console.log(`诊断事件名检查通过：${new Set(found.names).size} 个名字。`);
    return 0;
  }
  console.error('诊断事件名检查失败。');
  console.error(`未登记的名字（${result.unknown.length}）：`);
  for (const name of result.unknown) {
    console.error(`  - ${name}`);
  }
  console.error(`已失效的登记行（${result.unused.length}）：`);
  for (const name of result.unused) {
    console.error(`  - ${name}`);
  }
  return 1;
}

const invokedPath = process.argv[1] === undefined ? '' : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  process.exit(main());
}
