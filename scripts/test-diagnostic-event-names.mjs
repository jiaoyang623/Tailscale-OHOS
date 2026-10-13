import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEventNames, extractEventNames } from './check-diagnostic-event-names.mjs';

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

// The next tests prove the checker reads every entry point that records a
// diagnostic event. Each fixture mirrors a real member in entry/src/main/ets/services.

const PRIVATE_METHOD_FIXTURE = `
export class VpnBackgroundTaskManager {
  private record(event: string, code: number = 0): void {
    DiagnosticEventStore.record(this.context.filesDir, 'ui', event, 'background', code);
  }
  onStarted(): void {
    this.record('background_started');
    this.record('background_stop_failed', (error as BusinessError).code ?? -1);
    this.record(userCancelled ? 'background_user_cancelled' : 'background_system_cancelled', info.reason);
  }
}
`;

test('private record method: event in first position is read', () => {
  const result = extractEventNames(PRIVATE_METHOD_FIXTURE);
  assert.deepEqual(result.names, [
    'background_started',
    'background_stop_failed',
    'background_user_cancelled',
    'background_system_cancelled'
  ]);
  assert.deepEqual(result.nonLiteral, []);
});

const FILESDIR_FIRST_FIXTURE = `
export class VpnReconnectSupervisor {
  private record(filesDir: string, event: string, code: number): void {
    DiagnosticEventStore.record(filesDir, 'ui', event, 'reconnect', code);
  }
  onAttempt(filesDir: string): void {
    this.record(filesDir, 'vpn_reconnect_attempt', this.attempts);
    this.record(filesDir,
      result === VpnActionResult.STARTED ? 'vpn_reconnect_started' : 'vpn_reconnect_not_started', 0);
  }
}
`;

test('private record method with filesDir first: event in second position is read', () => {
  const result = extractEventNames(FILESDIR_FIRST_FIXTURE);
  assert.deepEqual(result.names, [
    'vpn_reconnect_attempt',
    'vpn_reconnect_started',
    'vpn_reconnect_not_started'
  ]);
  assert.deepEqual(result.nonLiteral, []);
});

const CALLBACK_FIELD_FIXTURE = `
export class VpnNetworkMonitor {
  private readonly record: (event: string, code: number) => void;
  constructor(record: (event: string, code: number) => void) {
    this.record = record;
  }
  private changed(): void {
    this.record('vpn_network_monitor_started', 0);
    this.record(network.interfaceName.length === 0 ? 'vpn_network_offline' :
      \`vpn_network_rebound_\${network.bearer}\`, 0);
  }
}
`;

test('callback field: event position comes from the field type', () => {
  const result = extractEventNames(CALLBACK_FIELD_FIXTURE);
  assert.deepEqual(result.names, ['vpn_network_monitor_started', 'vpn_network_offline']);
  assert.equal(result.nonLiteral.length, 1);
  assert.match(result.nonLiteral[0].expression, /vpn_network_rebound_/);
});

const RECORD_EVENT_FIXTURE = `
export class AccountDiagnosticsGateway {
  recordEvent(context: common.Context, event: string, phase: string, code: number = 0): void {
    DiagnosticEventStore.record(context.filesDir, 'ui', event, phase, code);
  }
}
class BridgeStatus {
  private send(event: string, phase: string): void {
    this.accountDiagnosticsGateway.recordEvent(context, event, phase, code);
  }
}
`;

test('recordEvent method: event in second position is read', () => {
  const result = extractEventNames(RECORD_EVENT_FIXTURE);
  assert.deepEqual(result.names, []);
  assert.equal(result.nonLiteral.length, 1);
  assert.match(result.nonLiteral[0].expression, /^event$/);
});

const STORE_WRITER_FIXTURE = `
export class DiagnosticEventStore {
  static record(filesDir: string, source: string, event: string, phase: string, code: number = 0): void {
    writeLine(filesDir, event);
  }
}
class Caller {
  private record(event: string): void {
    DiagnosticEventStore.record(this.filesDir, 'ui', event, 'background', 0);
    DiagnosticEventStore.record(this.filesDir, 'ui', 'literal_name', 'background', 0);
  }
}
`;

test('the static store writer is not an event-name entry point', () => {
  const result = extractEventNames(STORE_WRITER_FIXTURE);
  assert.deepEqual(result.names, []);
});
