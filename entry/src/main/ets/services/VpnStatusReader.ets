import { fileIo } from '@kit.CoreFileKit';
import { StoragePaths } from './StoragePaths';

/**
 * The extension rewrites its status file every second. A file older than this
 * means the extension is gone or frozen, which is uncertain - not evidence
 * that the tunnel is healthy.
 *
 * Exported because BridgeStatus read the same file with its own five-second
 * window, so the UI and the app could call one tunnel down and up at once.
 */
export const VPN_STATUS_FRESH_MS: number = 15000;

export enum VpnLinkState {
  DISCONNECTED = 'disconnected',
  CONNECTED = 'connected',
  NEEDS_LOGIN = 'needs_login',
  CONNECTING = 'connecting',
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
 * available to the app process, a FormExtensionAbility and an ArkTS card.
 * VpnBackgroundTaskManager.readStatus calls judge() here, so the card can never
 * disagree with the app about the state.
 */
export class VpnStatusReader {
  static read(filesDir: string): VpnLinkSnapshot {
    const unknown: VpnLinkSnapshot = { state: VpnLinkState.UNKNOWN, txBytes: 0, rxBytes: 0 };
    try {
      const path: string = StoragePaths.vpnStatusPath(filesDir);
      if (!fileIo.accessSync(path)) {
        return unknown;
      }
      return VpnStatusReader.readText(fileIo.readTextSync(path), Date.now());
    } catch (_error) {
      // A concurrent atomic replace or an I/O failure is uncertain state.
      return unknown;
    }
  }

  /**
   * The one judgement for the text of vpn-probe-status.txt.
   *
   * The order is deliberate, and it decides what the app, the card and the
   * continuous task all believe at the same moment:
   *
   *   1. a stale, future or missing heartbeat is uncertain, not evidence;
   *   2. a terminal marker means down, even beside a running tunnel, because
   *      holding protection on a contradictory line is the worse error;
   *   3. a running tunnel with a TUN is up;
   *   4. a pending sign-in stays actionable;
   *   5. an established interface with the backend still starting is connecting.
   *
   * The extension writes one state per second, so rule 2 sees a transitional or
   * a concatenated line. Treat that line as down.
   */
  static readText(status: string, nowMs: number): VpnLinkSnapshot {
    const state: VpnLinkState = VpnStatusReader.judge(status, nowMs);
    if (state === VpnLinkState.CONNECTED) {
      return {
        state,
        txBytes: VpnStatusReader.field(status, 'txBytes'),
        rxBytes: VpnStatusReader.field(status, 'rxBytes')
      };
    }
    return { state, txBytes: 0, rxBytes: 0 };
  }

  /** Returns the state only. VpnBackgroundTaskManager maps it to its own record. */
  static judge(status: string, nowMs: number): VpnLinkState {
    const heartbeatMs: number = VpnStatusReader.field(status, 'heartbeatMs');
    const ageMs: number = nowMs - heartbeatMs;
    if (heartbeatMs <= 0 || ageMs < 0 || ageMs > VPN_STATUS_FRESH_MS) {
      return VpnLinkState.UNKNOWN;
    }
    const normalized: string = status.toLowerCase();
    if (VpnStatusReader.isDisconnected(normalized)) {
      return VpnLinkState.DISCONNECTED;
    }
    if (normalized.includes('state=running') && normalized.includes('tun=true')) {
      return VpnLinkState.CONNECTED;
    }
    if (normalized.includes('needslogin') || normalized.includes('loginurlready=true')) {
      return VpnLinkState.NEEDS_LOGIN;
    }
    if (normalized.includes('vpn interface established')) {
      return VpnLinkState.CONNECTING;
    }
    return VpnLinkState.UNKNOWN;
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
