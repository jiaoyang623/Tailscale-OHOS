import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Loading real .ets sources in a host-side test.
//
// Three test files used to carry their own copy of this boilerplate. One
// vocabulary change had to touch all three, so the loader lives here now.

/**
 * Rewrites one exported string enum into an object with the same members.
 *
 * stripTypeScriptTypes removes types only, and it rejects enum syntax. Read the
 * members out of the real source so a test cannot drift from the real values.
 */
export function enumToObject(text, name) {
  const match = text.match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `enum ${name} not found`);
  const members = [...match[1].matchAll(/(\w+)\s*=\s*'([^']*)'/g)]
    .map((pair) => `${pair[1]}: '${pair[2]}'`);
  assert.ok(members.length > 0, `enum ${name} has no members`);
  return text.replace(match[0], `const ${name} = { ${members.join(', ')} };`);
}

/** Removes imports, exports and types so a module body can run in a vm context. */
export function toScript(source) {
  return stripTypeScriptTypes(source
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export\s+/gm, ''));
}

/**
 * Runs one or more real modules in one vm context.
 *
 * Each module body gets its own function scope, so two modules may declare the
 * same top-level name. A module that another one calls must appear first, and
 * its names must be listed in `names`. The names land on the context's global
 * object, which is how a later module finds them.
 */
export function runModules(sandbox, modules) {
  const context = vm.createContext(sandbox);
  for (const module of modules) {
    const body = toScript(module.source);
    const assignments = module.names
      .map((name) => `globalThis.${name} = ${name};`).join('\n');
    vm.runInContext(`(function(){\n${body}\n${assignments}\n})()`, context);
  }
  return context;
}
