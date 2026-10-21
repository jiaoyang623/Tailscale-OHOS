import { common } from '@kit.AbilityKit';

const VPN_STATUS_FILE_NAME: string = 'vpn-probe-status.txt';
const VPN_INTENT_FILE_NAME: string = 'vpn-intent.json';
const VPN_SESSION_LEDGER_FILE_NAME: string = 'vpn-session-ledger.ndjson';
const VPN_SESSION_END_FILE_NAME: string = 'vpn-session-end.json';
const VPN_POWER_STAGE_FILE_NAME: string = 'vpn-power-stage.json';

/**
 * Read-only path adapter for existing private application storage.
 *
 * This adapter deliberately does not select an encryption area, create a
 * directory, or move data. `context.filesDir` remains the platform-resolved
 * path and therefore preserves the existing order and failure semantics.
 */
export class StoragePaths {
  static filesDir(context: common.Context): string {
    return context.filesDir;
  }

  static vpnStatusPath(filesDir: string): string {
    return `${filesDir}/${VPN_STATUS_FILE_NAME}`;
  }

  static vpnIntentPath(filesDir: string): string {
    return `${filesDir}/${VPN_INTENT_FILE_NAME}`;
  }

  static vpnSessionLedgerPath(filesDir: string): string {
    return `${filesDir}/${VPN_SESSION_LEDGER_FILE_NAME}`;
  }

  /**
   * Each writer owns one ledger file. A writer compacts only the file it owns,
   * so it cannot erase a line that the other process appends at the same time.
   */
  static vpnSessionLedgerPathFor(filesDir: string, writer: string): string {
    const suffix: string = writer === 'vpn' ? 'vpn' : 'ui';
    return `${filesDir}/vpn-session-ledger-${suffix}.ndjson`;
  }

  static vpnSessionEndPath(filesDir: string): string {
    return `${filesDir}/${VPN_SESSION_END_FILE_NAME}`;
  }

  static vpnSessionEndPathFor(filesDir: string, writer: string): string {
    const suffix: string = writer === 'vpn' ? 'vpn' : 'ui';
    return `${filesDir}/vpn-session-end-${suffix}.json`;
  }

  static vpnPowerStagePath(filesDir: string): string {
    return `${filesDir}/${VPN_POWER_STAGE_FILE_NAME}`;
  }
}
