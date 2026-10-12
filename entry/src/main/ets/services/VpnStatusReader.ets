import { fileIo } from '@kit.CoreFileKit';
import { StoragePaths } from './StoragePaths';

/**
 * The extension rewrites its status file every second. A file older than this
 * means the extension is gone or frozen, which is uncertain - not evidence
 * that the tunnel is healthy.
 */
const VPN_STATUS_FRESH_MS: number = 15000;

export enum VpnLinkState {
  DISCONNECTED = 'disconnected',
  CONNECTED = 'connected',
  NEEDS_LOGIN = 'needs_login',
  UNKNOWN = 'unknown'
}

export interface VpnLinkSnapshot {
  state: VpnLinkState;
  txBytes: number;
  rxBytes: number;
}

/**
 * Reads the VPN extension's status file.
 *
 * Deliberately free of the native bridge and of ArkUI so the same reading is
 * available to the app process, a FormExtensionAbility and an ArkTS card. The
 * vocabulary must stay identical to VpnBackgroundTaskManager.readStatus and
 * BridgeStatus so the card can never disagree with the app about the state.
 */
export class VpnStatusReader {
  static read(filesDir: string): VpnLinkSnapshot {
    const unknown: VpnLinkSnapshot = { state: VpnLinkState.UNKNOWN, txBytes: 0, rxBytes: 0 };
    try {
      const path: string = StoragePaths.vpnStatusPath(filesDir);
      if (!fileIo.accessSync(path)) {
        return unknown;
      }
      const status: string = fileIo.readTextSync(path);
      const heartbeatMs: number = VpnStatusReader.field(status, 'heartbeatMs');
      const ageMs: number = Date.now() - heartbeatMs;
      if (heartbeatMs <= 0 || ageMs < 0 || ageMs > VPN_STATUS_FRESH_MS) {
        return unknown;
      }
      const normalized: string = status.toLowerCase();
      // Connected wins over the other markers, matching the app's own
      // precedence, so a busy login URL cannot hide a working tunnel.
      if (normalized.includes('state=running') && normalized.includes('tun=true')) {
        return {
          state: VpnLinkState.CONNECTED,
          txBytes: VpnStatusReader.field(status, 'txBytes'),
          rxBytes: VpnStatusReader.field(status, 'rxBytes')
        };
      }
      if (VpnStatusReader.isDisconnected(normalized)) {
        return { state: VpnLinkState.DISCONNECTED, txBytes: 0, rxBytes: 0 };
      }
      if (normalized.includes('needslogin') || normalized.includes('loginurlready=true')) {
        return { state: VpnLinkState.NEEDS_LOGIN, txBytes: 0, rxBytes: 0 };
      }
      return unknown;
    } catch (_error) {
      // A concurrent atomic replace or an I/O failure is uncertain state.
      return unknown;
    }
  }

  private static isDisconnected(normalized: string): boolean {
    return normalized.includes('extension destroyed') ||
      normalized.includes('vpn disconnected') ||
      normalized.includes('state=stopped') ||
      normalized.startsWith('stopped') ||
      (normalized.startsWith('failed') && !normalized.includes('status unavailable'));
  }

  private static field(status: string, name: string): number {
    const match: RegExpMatchArray | null = status.match(new RegExp(`(?:^|\\s)${name}=(\\d+)(?:\\s|$)`));
    const value: number = match === null ? 0 : Number(match[1]);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
}
