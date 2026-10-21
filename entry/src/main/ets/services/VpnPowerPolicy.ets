import { fileIo } from '@kit.CoreFileKit';
import { power } from '@kit.BasicServicesKit';
import { DiagnosticEventStore } from './DiagnosticEventStore';
import { StoragePaths } from './StoragePaths';

export enum VpnPowerStage {
  ACTIVE = 'active',
  BACKGROUND = 'background',
  SCREEN_OFF = 'screen-off'
}

export interface VpnPowerIntervals {
  commandMs: number;
  statusMs: number;
  snapshotMs: number;
}

export interface VpnPowerStageChange {
  from: VpnPowerStage;
  to: VpnPowerStage;
}

interface VpnPowerStageFile {
  stage: string;
}

/**
 * The one table for how often the app and the extension look at the tunnel.
 *
 * The stage changes only the observation rate. It never stops the tunnel, the
 * network monitor or the recovery watchdog. The extension reads the stage file
 * every loop, so a stage change takes effect without a restart.
 *
 * A missing or damaged stage file means active. Running too often costs power.
 * Running too slowly hides a real drop from the user, which is worse.
 */
export class VpnPowerPolicy {
  private static lastMissingRecordAtMs: number = 0;

  /** Timers that exist only to keep an on-screen page fresh. */
  static uiTimersToStop(stage: VpnPowerStage): string[] {
    if (stage === VpnPowerStage.ACTIVE) {
      return [];
    }
    return ['serviceRefresh', 'homeLatency', 'deviceDetail', 'transferProtocol', 'offlinePeerStatus',
      'cacheSize', 'connectionDuration'];
  }

  /** The recovery watchdog observes the tunnel; a stage must never stop it. */
  static recoveryWatchdogRuns(stage: VpnPowerStage): boolean {
    return true;
  }

  /**
   * Card ticks between desktop refreshes. The card timer runs every 5 s so the
   * supervisor keeps its cadence. The card system call does not need that rate
   * when nobody looks at the screen.
   */
  static cardRefreshTicks(stage: VpnPowerStage): number {
    if (stage === VpnPowerStage.SCREEN_OFF) {
      return 12;
    }
    if (stage === VpnPowerStage.BACKGROUND) {
      return 3;
    }
    return 1;
  }

  static extensionIntervals(stage: VpnPowerStage): VpnPowerIntervals {
    if (stage === VpnPowerStage.BACKGROUND) {
      const background: VpnPowerIntervals = { commandMs: 250, statusMs: 2000, snapshotMs: 2000 };
      return background;
    }
    if (stage === VpnPowerStage.SCREEN_OFF) {
      // Three status ticks still fall inside the fifteen second freshness
      // window a reader uses, so a slow loop cannot make a live tunnel unknown.
      const screenOff: VpnPowerIntervals = { commandMs: 1000, statusMs: 5000, snapshotMs: 15000 };
      return screenOff;
    }
    const active: VpnPowerIntervals = { commandMs: 100, statusMs: 1000, snapshotMs: 1000 };
    return active;
  }

  /** The stage while the app is in the background. The screen can only lower it. */
  static stageFor(screenActive: boolean): VpnPowerStage {
    let screenOn: boolean = false;
    try {
      screenOn = power.isActive();
    } catch (_error) {
      // An unreadable screen state is treated as on, so the app keeps the
      // faster cadence instead of guessing that the user is away.
      screenOn = true;
    }
    return screenActive && screenOn ? VpnPowerStage.BACKGROUND : VpnPowerStage.SCREEN_OFF;
  }

  static readStage(filesDir: string): VpnPowerStage {
    try {
      const path: string = StoragePaths.vpnPowerStagePath(filesDir);
      if (!fileIo.accessSync(path)) {
        VpnPowerPolicy.recordMissing(filesDir);
        return VpnPowerStage.ACTIVE;
      }
      const text: string = fileIo.readTextSync(path);
      if (text.trim().length === 0) {
        VpnPowerPolicy.recordMissing(filesDir);
        return VpnPowerStage.ACTIVE;
      }
      const parsed: VpnPowerStageFile = JSON.parse(text) as VpnPowerStageFile;
      if (parsed.stage === VpnPowerStage.BACKGROUND) {
        return VpnPowerStage.BACKGROUND;
      }
      if (parsed.stage === VpnPowerStage.SCREEN_OFF) {
        return VpnPowerStage.SCREEN_OFF;
      }
      if (parsed.stage === VpnPowerStage.ACTIVE) {
        return VpnPowerStage.ACTIVE;
      }
    } catch (_error) {
      // Fall through to the active stage.
    }
    VpnPowerPolicy.recordMissing(filesDir);
    return VpnPowerStage.ACTIVE;
  }

  static writeStage(filesDir: string, stage: VpnPowerStage): boolean {
    const path: string = StoragePaths.vpnPowerStagePath(filesDir);
    const temporaryPath: string = `${path}.tmp`;
    const content: VpnPowerStageFile = { stage: stage };
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
      DiagnosticEventStore.record(filesDir, 'ui', 'vpn_power_stage_write_failed', 'power', 0);
      return false;
    }
  }

  /**
   * Applies a sampled stage. A change is reported once, in the same step that
   * writes the file, so the page and the extension cannot show different rows.
   */
  static applyStage(filesDir: string, stage: VpnPowerStage, changes: VpnPowerStageChange[]): void {
    const current: VpnPowerStage = VpnPowerPolicy.readStage(filesDir);
    if (current === stage) {
      return;
    }
    if (!VpnPowerPolicy.writeStage(filesDir, stage)) {
      return;
    }
    changes.push({ from: current, to: stage });
    DiagnosticEventStore.record(filesDir, 'ui', 'vpn_power_stage_changed', stage, 0);
  }

  /** The extension calls this at the top of each loop. */
  static extensionIntervalsForFile(filesDir: string): VpnPowerIntervals {
    return VpnPowerPolicy.extensionIntervals(VpnPowerPolicy.readStage(filesDir));
  }

  private static recordMissing(filesDir: string): void {
    // The extension reads the stage every loop. Before the app has ever
    // written one, that is once a second; report it once a minute instead.
    const nowMs: number = Date.now();
    if (nowMs - VpnPowerPolicy.lastMissingRecordAtMs < 60000) {
      return;
    }
    VpnPowerPolicy.lastMissingRecordAtMs = nowMs;
    DiagnosticEventStore.record(filesDir, 'ui', 'vpn_power_stage_missing', 'power', 0);
  }
}