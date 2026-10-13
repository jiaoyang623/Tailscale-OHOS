import { DiagnosticEventStore } from './DiagnosticEventStore';
import { VpnActionResult, VpnSessionController } from './VpnSessionController';
import { VpnLinkSnapshot, VpnLinkState, VpnStatusReader } from './VpnStatusReader';

/**
 * How long the app must have been out of the foreground before a drop is
 * treated as involuntary. A user disconnect needs the user to have just been
 * looking at the app - either tapping the button or the card - so a drop that
 * arrives while the app has been away for a while is a real failure.
 */
const BACKGROUND_SETTLE_MS: number = 10000;
const RETRY_BASE_MS: number = 30000;
const RETRY_MAX_MS: number = 300000;
const MAX_ATTEMPTS: number = 3;
/**
 * How long a connection must hold before it clears the retry ladder. Without
 * this, a tunnel that flaps - connects for a moment, drops again - would reset
 * the attempt count every cycle and retry forever.
 */
const STABLE_MS: number = 60000;

/**
 * Recovers a tunnel that dropped on its own.
 *
 * Huawei's own guidance covers keeping the VPN alive, and that part is
 * implemented and validated (docs/background-vpn-reliability.md). What was
 * missing is the step after a drop: the app released its continuous task and
 * stayed disconnected until the user noticed.
 *
 * Reconnecting is a behaviour change, so the trigger is deliberately narrow.
 * It fires only when the tunnel was connected, is now gone, this app process
 * has been in the background for a while, and no disconnect was requested
 * through an entry point we control. Anything else is left alone, because
 * fighting a user who just tapped "Disconnect" is worse than a missed retry.
 */
export class VpnReconnectSupervisor {
  private readonly controller: VpnSessionController = new VpnSessionController();
  private lastState: VpnLinkState = VpnLinkState.UNKNOWN;
  private attempts: number = 0;
  private nextAttemptAtMs: number = 0;
  private backgroundSinceMs: number = 0;
  private connectedSinceMs: number = 0;
  private inForeground: boolean = true;
  private stopRequested: boolean = false;
  private polling: boolean = false;
  /**
   * Bumped whenever an attempt loses its authority. A connect that is already
   * running cannot be stopped in the middle of the extension start, so the
   * completion checks this token and undoes what it started.
   */
  private attemptId: number = 0;

  onForeground(): void {
    this.inForeground = true;
    this.backgroundSinceMs = 0;
    // A foreground visit clears the retry ladder and any stale intent: the
    // user is here and can act.
    this.attempts = 0;
    this.nextAttemptAtMs = 0;
  }

  onBackground(nowMs: number): void {
    this.inForeground = false;
    this.backgroundSinceMs = nowMs;
  }

  /** Called by entry points that disconnect on the user's behalf. */
  noteRequestedStop(): void {
    this.stopRequested = true;
    this.attempts = 0;
    this.nextAttemptAtMs = 0;
    // Cancel any attempt that is already in flight.
    this.attemptId++;
  }

  /** Called once the connection is established again or on an explicit connect. */
  noteRequestedStart(): void {
    this.stopRequested = false;
    this.attempts = 0;
    this.nextAttemptAtMs = 0;
    // An explicit connect supersedes an attempt that is still in flight.
    this.attemptId++;
  }

  /**
   * Samples the tunnel once. Safe to call on a timer; it never overlaps.
   */
  async poll(filesDir: string, nowMs: number): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const snapshot: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
      const previous: VpnLinkState = this.lastState;
      this.lastState = snapshot.state;
      if (snapshot.state === VpnLinkState.CONNECTED) {
        if (previous !== VpnLinkState.CONNECTED) {
          this.connectedSinceMs = nowMs;
        }
        if (this.attempts > 0 && nowMs - this.connectedSinceMs >= STABLE_MS) {
          this.record(filesDir, 'vpn_reconnect_succeeded', this.attempts);
          this.attempts = 0;
          this.nextAttemptAtMs = 0;
        }
        return;
      }
      if (snapshot.state !== VpnLinkState.DISCONNECTED || previous !== VpnLinkState.CONNECTED) {
        return;
      }
      this.handleDrop(filesDir, nowMs);
    } finally {
      this.polling = false;
    }
  }

  private handleDrop(filesDir: string, nowMs: number): void {
    if (this.stopRequested) {
      this.record(filesDir, 'vpn_drop_after_requested_stop', 0);
      return;
    }
    if (this.inForeground ||
      this.backgroundSinceMs === 0 ||
      nowMs - this.backgroundSinceMs < BACKGROUND_SETTLE_MS) {
      // The app was on screen moments ago; the user most likely asked for this.
      this.record(filesDir, 'vpn_drop_ignored_foreground', 0);
      return;
    }
    if (this.attempts >= MAX_ATTEMPTS) {
      this.record(filesDir, 'vpn_reconnect_exhausted', this.attempts);
      return;
    }
    if (nowMs < this.nextAttemptAtMs) {
      return;
    }
    this.attempts++;
    this.nextAttemptAtMs = nowMs + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, this.attempts - 1));
    this.record(filesDir, 'vpn_reconnect_attempt', this.attempts);
    const attemptId: number = ++this.attemptId;
    const stillAuthorised = (): boolean => attemptId === this.attemptId && !this.stopRequested;
    this.controller.connect(filesDir, stillAuthorised).then((result: VpnActionResult): void => {
      if (result === VpnActionResult.CANCELLED) {
        this.record(filesDir, 'vpn_reconnect_cancelled', 0);
        return;
      }
      if (result === VpnActionResult.STARTED && !stillAuthorised()) {
        // The user asked to disconnect, and this attempt lost its authority
        // after the last cancellation point. Undo it rather than leave a tunnel
        // the user just killed.
        this.record(filesDir, 'vpn_reconnect_superseded', 0);
        this.controller.disconnect(filesDir).catch((): void => {
          this.record(filesDir, 'vpn_reconnect_undo_failed', 0);
        });
        return;
      }
      this.record(filesDir,
        result === VpnActionResult.STARTED ? 'vpn_reconnect_started' : 'vpn_reconnect_not_started', 0);
    }).catch((): void => {
      this.record(filesDir, 'vpn_reconnect_failed', 0);
    });
  }

  private record(filesDir: string, event: string, code: number): void {
    try {
      DiagnosticEventStore.record(filesDir, 'ui', event, 'reconnect', code);
    } catch (_error) {
      // Diagnostics must never break recovery.
    }
  }
}
