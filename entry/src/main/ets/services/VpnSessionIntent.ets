import { fileIo } from '@kit.CoreFileKit';
import { DiagnosticEventStore } from './DiagnosticEventStore';
import { StoragePaths } from './StoragePaths';

// A missing intent is the normal state before the user ever connects. Report it
// at most once a minute, so a reader that samples every second does not fill
// the diagnostic file with the same line.
const INTENT_MISSING_RECORD_INTERVAL_MS: number = 60000;

export enum VpnIntentDesired {
  CONNECTED = 'connected',
  STOPPED = 'stopped'
}

export interface VpnIntent {
  desired: VpnIntentDesired;
  present: boolean;
  changedAtMs: number;
  by: string;
}

interface VpnIntentFile {
  desired: string;
  changedAtMs: number;
  by: string;
}

/**
 * The one record of what the user asked the tunnel to do.
 *
 * A status read cannot change this file. Only the entry points that carry a
 * user action write it: the page, the card, and a recovery that starts or
 * undoes a connect. Every decision to hold the continuous task or to recover
 * reads it.
 *
 * A missing or damaged file means stopped. A missed recovery is visible and
 * the user can act on it. A tunnel the user never asked for is not.
 */
export class VpnSessionIntent {
  private static lastMissingRecordAtMs: number = 0;

  static read(filesDir: string): VpnIntent {
    const stopped: VpnIntent = {
      desired: VpnIntentDesired.STOPPED,
      present: false,
      changedAtMs: 0,
      by: ''
    };
    let text: string = '';
    try {
      const path: string = StoragePaths.vpnIntentPath(filesDir);
      if (!fileIo.accessSync(path)) {
        VpnSessionIntent.recordMissing(filesDir);
        return stopped;
      }
      text = fileIo.readTextSync(path);
    } catch (_error) {
      VpnSessionIntent.recordMissing(filesDir);
      return stopped;
    }
    if (text.trim().length === 0) {
      VpnSessionIntent.recordMissing(filesDir);
      return stopped;
    }
    try {
      const parsed: VpnIntentFile = JSON.parse(text) as VpnIntentFile;
      if (parsed.desired !== VpnIntentDesired.CONNECTED &&
        parsed.desired !== VpnIntentDesired.STOPPED) {
        VpnSessionIntent.recordMissing(filesDir);
        return stopped;
      }
      if (typeof parsed.by !== 'string' || parsed.by.length === 0) {
        VpnSessionIntent.recordMissing(filesDir);
        return stopped;
      }
      if (!Number.isFinite(parsed.changedAtMs) || parsed.changedAtMs < 0) {
        VpnSessionIntent.recordMissing(filesDir);
        return stopped;
      }
      return {
        desired: parsed.desired === VpnIntentDesired.CONNECTED ?
          VpnIntentDesired.CONNECTED : VpnIntentDesired.STOPPED,
        present: true,
        changedAtMs: parsed.changedAtMs,
        by: parsed.by
      };
    } catch (_error) {
      VpnSessionIntent.recordMissing(filesDir);
      return stopped;
    }
  }

  /**
   * Writes the desired state and who asked for it.
   *
   * The temporary file and the rename keep a reader in the other process from
   * seeing half a JSON object. A failure is reported, never thrown: the user
   * command that follows must still run.
   */
  static write(filesDir: string, desired: VpnIntentDesired, by: string): boolean {
    const content: VpnIntentFile = {
      desired: desired,
      changedAtMs: Date.now(),
      by: by
    };
    const path: string = StoragePaths.vpnIntentPath(filesDir);
    const temporaryPath: string = `${path}.tmp`;
    let file: fileIo.File | undefined = undefined;
    try {
      file = fileIo.openSync(temporaryPath,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(file.fd, JSON.stringify(content));
      fileIo.closeSync(file);
      file = undefined;
      fileIo.renameSync(temporaryPath, path);
      return true;
    } catch (_error) {
      if (file !== undefined) {
        try {
          fileIo.closeSync(file);
        } catch (_closeError) {
          // The descriptor may already be closed after a platform write failure.
        }
      }
      DiagnosticEventStore.record(filesDir, 'ui', 'vpn_intent_write_failed', 'intent', 0);
      return false;
    }
  }

  private static recordMissing(filesDir: string): void {
    const nowMs: number = Date.now();
    if (nowMs - VpnSessionIntent.lastMissingRecordAtMs < INTENT_MISSING_RECORD_INTERVAL_MS) {
      return;
    }
    VpnSessionIntent.lastMissingRecordAtMs = nowMs;
    DiagnosticEventStore.record(filesDir, 'ui', 'vpn_intent_missing', 'intent', 0);
  }
}
