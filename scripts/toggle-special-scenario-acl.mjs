#!/usr/bin/env node
// Toggle the restricted (ACL) background permission in entry/src/main/module.json5.
//
// Declaring one of these without a matching provisioning profile makes the app
// FAIL TO INSTALL, so the declaration must never be on by default. Turn it on
// only after AppGallery Connect has approved the permission, or while testing
// under a five-day trial debug profile.
//
//   node scripts/toggle-special-scenario-acl.mjs status
//   node scripts/toggle-special-scenario-acl.mjs enable
//   node scripts/toggle-special-scenario-acl.mjs enable --system
//   node scripts/toggle-special-scenario-acl.mjs disable
//
// --system selects ohos.permission.KEEP_BACKGROUND_RUNNING_SYSTEM, which is
// what MODE_TASK_KEEPING needs on a non-PC device. The default,
// KEEP_BACKGROUND_RUNNING_SPECIAL_SCENARIO, is what
// MODE_SPECIAL_SCENARIO_PROCESSING needs from API 24 onward.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODULE_JSON5 = fileURLToPath(new URL('../entry/src/main/module.json5', import.meta.url));

const ACL_PERMISSIONS = [
  'ohos.permission.KEEP_BACKGROUND_RUNNING_SPECIAL_SCENARIO',
  'ohos.permission.KEEP_BACKGROUND_RUNNING_SYSTEM',
];

const MARKER = '// Added by scripts/toggle-special-scenario-acl.mjs';
const ANCHOR = '"requestPermissions": [';

function present(source, permission) {
  return source.includes(`"name": "${permission}"`);
}

function report(source) {
  const declared = ACL_PERMISSIONS.filter(permission => present(source, permission));
  console.log(declared.length === 0
    ? 'ACL background permission: not declared (default)'
    : `ACL background permission: ${declared.join(', ')}`);
  return declared;
}

function enable(source, permission) {
  const others = ACL_PERMISSIONS.filter(candidate => candidate !== permission);
  for (const other of others) {
    if (present(source, other)) {
      throw new Error(`remove ${other} first; only one ACL permission is expected`);
    }
  }
  if (present(source, permission)) {
    return source;
  }
  const anchorIndex = source.indexOf(ANCHOR);
  if (anchorIndex < 0) {
    throw new Error(`anchor not found: ${ANCHOR}`);
  }
  const insertAt = anchorIndex + ANCHOR.length;
  const block = `\n      ${MARKER}\n      {\n        "name": "${permission}"\n      },`;
  return source.slice(0, insertAt) + block + source.slice(insertAt);
}

function disable(source) {
  let result = source;
  for (const permission of ACL_PERMISSIONS) {
    if (!present(result, permission)) {
      continue;
    }
    const entry = new RegExp(
      `\\n\\s*${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s*\\{\\n\\s*"name": "${permission}"\\n\\s*\\},`);
    if (!entry.test(result)) {
      throw new Error(`declared but not in the expected managed form: ${permission}; edit module.json5 by hand`);
    }
    result = result.replace(entry, '');
  }
  return result;
}

function main() {
  const [action, ...rest] = process.argv.slice(2);
  const source = readFileSync(MODULE_JSON5, 'utf8');

  if (!action || action === 'status') {
    report(source);
    return;
  }
  if (action === 'enable') {
    const permission = rest.includes('--system')
      ? 'ohos.permission.KEEP_BACKGROUND_RUNNING_SYSTEM'
      : 'ohos.permission.KEEP_BACKGROUND_RUNNING_SPECIAL_SCENARIO';
    const updated = enable(source, permission);
    writeFileSync(MODULE_JSON5, updated);
    console.log(updated === source ? `already declared: ${permission}` : `declared: ${permission}`);
    console.log('Rebuild and reinstall; an approved profile is required or the install will fail.');
    return;
  }
  if (action === 'disable') {
    const updated = disable(source);
    writeFileSync(MODULE_JSON5, updated);
    console.log(updated === source ? 'nothing to remove' : 'removed the ACL declaration');
    return;
  }
  throw new Error(`unknown action: ${action}`);
}

main();
