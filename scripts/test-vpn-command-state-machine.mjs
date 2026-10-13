import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enumToObject, runModules } from './lib/arkts-module.mjs';

// Run the real command state machine against no platform at all.
//
// The machine owns command generations. UI lifecycle invalidation rejects late
// Promise completions without touching the VPN's own lifecycle. That promise
// only holds if invalidation also clears the state, because BridgeStatus reads
// currentState() to decide whether a late stop result may finish the job.
const HERE = import.meta.url;

let source = readFileSync(
  new URL('../entry/src/main/ets/services/VpnCommandGateway.ets', HERE), 'utf8');
source = enumToObject(source, 'VpnCommandState');
source = enumToObject(source, 'VpnCoreCommand');

function fixture() {
  const sandbox = { Date: { now: () => 1 }, fileIo: {}, vpnExtension: {} };
  runModules(sandbox, [{
    source,
    names: ['VpnCommandStateMachine', 'VpnCommandState', 'VpnCoreCommand']
  }]);
  return {
    machine: new sandbox.VpnCommandStateMachine(),
    state: sandbox.VpnCommandState,
    command: sandbox.VpnCoreCommand
  };
}

test('a destroyed lifecycle does not keep reporting the command it superseded', () => {
  const f = fixture();
  f.machine.begin(f.command.CONNECT);
  assert.equal(f.machine.currentState(), f.state.STARTING);
  f.machine.invalidateLifecycle();
  assert.equal(f.machine.currentState(), f.state.STOPPED,
    'a destroyed lifecycle still reports the superseded command');
});

test('a destroyed lifecycle does not keep reporting a timeout', () => {
  // This is the case that matters. BridgeStatus.finishVpnExtensionStop takes the
  // full completion path when the state is TIMED_OUT, and that path restarts the
  // backend. A stale TIMED_OUT after destruction therefore restarts the backend
  // of a screen that no longer exists.
  const f = fixture();
  const id = f.machine.begin(f.command.CONNECT);
  f.machine.timeout(id);
  assert.equal(f.machine.currentState(), f.state.TIMED_OUT);
  f.machine.invalidateLifecycle();
  assert.equal(f.machine.currentState(), f.state.STOPPED,
    'a destroyed lifecycle still reports a timeout');
});

test('a late completion cannot move the state after a destroyed lifecycle', () => {
  const f = fixture();
  const id = f.machine.begin(f.command.CONNECT);
  f.machine.invalidateLifecycle();
  assert.equal(f.machine.complete(id, f.state.RUNNING), false);
  assert.equal(f.machine.currentState(), f.state.STOPPED);
});

test('a late timeout cannot move the state after a destroyed lifecycle', () => {
  const f = fixture();
  const id = f.machine.begin(f.command.CONNECT);
  f.machine.invalidateLifecycle();
  assert.equal(f.machine.timeout(id), false);
  assert.equal(f.machine.currentState(), f.state.STOPPED);
});

test('a destroyed lifecycle lets the next command start clean', () => {
  const f = fixture();
  f.machine.begin(f.command.CONNECT);
  f.machine.invalidateLifecycle();
  const next = f.machine.begin(f.command.DISCONNECT);
  assert.ok(next > 0, 'the next command was refused');
  assert.equal(f.machine.currentState(), f.state.STOPPING);
  assert.equal(f.machine.isActive(next), true);
});

test('invalidation advances the lifecycle generation', () => {
  const f = fixture();
  const before = f.machine.currentLifecycleGeneration();
  f.machine.invalidateLifecycle();
  assert.equal(f.machine.currentLifecycleGeneration(), before + 1);
});
