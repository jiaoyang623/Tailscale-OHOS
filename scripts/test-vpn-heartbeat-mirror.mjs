import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The host cannot read files inside the app sandbox, and devecocli has no
// file-pull command. The extension's liveness timestamp lives in
// vpn-probe-status.txt as `heartbeatMs=<epoch ms>`, refreshed by the status
// timer. Before this mirror existed, no device run could answer QG-01 at all:
// the 720 s survival threshold was unmeasurable from the device log, and the
// exported diagnostic report carries only summary.txt and report.json, so it
// does not hold the status file either.
//
// A gap between two mirrored lines measures how long the extension stopped
// writing. That is the quantity QG-01 asks about, which is why the mirror
// belongs in the writer that the status timer already calls every second.
//
// The mirror copies the timestamp only. The status text stays in the file, so
// the device log gains no new disclosure.

const HERE = import.meta.url;
const EXTENSION =
  '../entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets';

function heartbeatWriter() {
  const source = readFileSync(new URL(EXTENSION, HERE), 'utf8');
  const start = source.indexOf('private writeCurrentStatusHeartbeat');
  assert.ok(start >= 0, 'the extension lost its heartbeat writer');
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start, 'the heartbeat writer has no end');
  return source.slice(start, end);
}

// Return the argument text of the first hilog call inside the writer.
function mirrorArguments(body) {
  const at = body.search(/hilog\.(info|debug|warn|error)\(/);
  assert.ok(at >= 0,
    'the heartbeat never reaches the device log, so a device run cannot measure it');
  const open = body.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '(') {
      depth++;
    } else if (body[i] === ')') {
      depth--;
      if (depth === 0) {
        return body.slice(open, i + 1);
      }
    }
  }
  assert.fail('the mirror call is not closed');
}

test('the heartbeat writer mirrors its timestamp to the device log', () => {
  const call = mirrorArguments(heartbeatWriter());
  assert.match(call, /heartbeatMs=/,
    'the mirror line must carry heartbeatMs=, which is the field the analyzer '
    + 'parses and the keyword the runbook tells the operator to filter on');
});

test('the heartbeat mirror does not widen what the device log discloses', () => {
  const call = mirrorArguments(heartbeatWriter());
  assert.ok(!call.includes('currentVisibleStatus'),
    'the mirror must not copy the status text into the device log');
});
