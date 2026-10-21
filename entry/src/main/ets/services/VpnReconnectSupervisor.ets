import { connection } from '@kit.NetworkKit';
import { DiagnosticEventStore } from './DiagnosticEventStore';
import { SessionEndReason, SessionLedger, SessionLedgerEntry } from './SessionLedger';
import { VpnIntent, VpnIntentDesired, VpnSessionIntent } from './VpnSessionIntent';
import { VpnActionResult, VpnSessionController } from './VpnSessionController';
import { VpnLinkSnapshot, VpnLinkState, VpnStatusReader } from './VpnStatusReader';

/**
 * What the user wants decides whether the app recovers a tunnel. Time spent in
 * the background says nothing about that, so a drop is recovered at once in the
 * foreground, in the background, and moments after the app leaves the screen.
 *
 * A retry never stops while the intent says connected. The delay grows to five
 * minutes and stays there, so a device outage costs one attempt every five
 * minutes instead of one every second.
 */
const RETRY_DELAYS_MS: number[] = [30000, 60000, 120000, 300000];
/**
 * A reading that is not connected does not prove a drop on its own: the
 * extension may be between two heartbeats. After a connected reading, thirty
 * seconds without a connected reading is evidence enough, because the
 * extension writes every second.
 */
const UNKNOWN_DROP_MS: number = 30000;
/** A connection that holds this long counts as recovered, not as a retry. */
const STABLE_MS: number = 60000;

/**
 * Recovers a tunnel that dropped while the user still wants it.
 *
 * The supervisor reads two things: the user intent file and the extension
 * status. It never writes the intent. A stop request, a drop that follows one,
 * and an offline device all lead to no connect. Everything else that leaves
 * the intent at connected is retried for as long as the app runs.
 */
export class VpnReconnectSupervisor {
  private readonly controller: VpnSessionController = new VpnSessionController();
  private lastState: VpnLinkState = VpnLinkState.UNKNOWN;
  private lastSessionId: string = '';
  private connectedSinceMs: number = 0;
  private wasUp: boolean = false;
  private recovering: boolean = false;
  private deferred: boolean = false;
  private needsUi: boolean = false;
  private needsUiAtMs: number = 0;
  private attempts: number = 0;
  private nextAttemptAtMs: number = 0;
  private polling: boolean = false;
  private attemptInFlight: boolean = false;
  private filesDir: string = '';
  /**
   * Bumped whenever an attempt loses its authority. A connect that is already
   * running cannot be stopped in the middle of the extension start, so the
   * completion checks this token and undoes what it started.
   */
  private attemptId: number = 0;

  /**
   * The user is looking at the app: an immediate retry is allowed. The intent
   * file already said whether recovery is wanted, so nothing else changes.
   */
  onForeground(): void {
    this.needsUi = false;
    this.attempts = 0;
    this.nextAttemptAtMs = 0;
  }

  /**
   * Kept for the lifecycle calls. Background time no longer gates recovery,
   * because it says nothing about whether the user stopped the tunnel.
   */
  onBackground(nowMs: number): void {
    if (nowMs <= 0) {
      return;
    }
  }

  /** Called by entry points that disconnect on the user's behalf. */
  noteRequestedStop(): void {
    this.resetAfterStop();
    // Cancel any attempt that is already in flight.
    this.attemptId++;
  }

  /** Called on an explicit connect, which makes recovery wanted again. */
  noteRequestedStart(): void {
    this.needsUi = false;
    this.attempts = 0;
    this.nextAttemptAtMs = 0;
    this.attemptId++;
  }

  /**
   * A network callback, not a timer. While the device was offline the
   * supervisor waited, so this attempt does not spend a retry delay.
   */
  onNetworkAvailable(nowMs: number): void {
    if (this.filesDir.length === 0) {
      return;
    }
    const intent: VpnIntent = VpnSessionIntent.read(this.filesDir);
    if (intent.desired !== VpnIntentDesired.CONNECTED) {
      return;
    }
    this.deferred = false;
    this.nextAttemptAtMs = 0;
    if (this.recovering) {
      this.tryRecover(this.filesDir, nowMs);
    }
  }

  /**
   * Samples the tunnel once. Safe to call on a timer; it never overlaps.
   *
   * A connect is started without awaiting it: the extension handoff takes
   * seconds, and the next status sample must not wait behind it.
   */
  async poll(filesDir: string, nowMs: number): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    this.filesDir = filesDir;
    try {
      const intent: VpnIntent = VpnSessionIntent.read(filesDir);
      const snapshot: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
      if (snapshot.sessionId.length > 0) {
        this.lastSessionId = snapshot.sessionId;
      }
      const previous: VpnLinkState = this.lastState;
      this.lastState = snapshot.state;

      if (snapshot.state === VpnLinkState.CONNECTED) {
        if (previous !== VpnLinkState.CONNECTED) {
          this.connectedSinceMs = nowMs;
        }
        this.wasUp = true;
        this.deferred = false;
        if (this.recovering && nowMs - this.connectedSinceMs >= STABLE_MS) {
          this.record(filesDir, 'vpn_session_recovered', this.attempts);
          this.recovering = false;
          this.attempts = 0;
          this.nextAttemptAtMs = 0;
        }
        return;
      }

      if (intent.desired !== VpnIntentDesired.CONNECTED) {
        if (previous === VpnLinkState.CONNECTED || this.wasUp) {
          this.record(filesDir, 'vpn_drop_after_requested_stop', 0);
        }
        this.resetAfterStop();
        return;
      }

      if (this.needsUi) {
        // No retry can finish a sign-in. A newer intent means the user acted
        // in the page, so the wait ends there; onForeground alone misses a
        // user who was already looking at the app.
        if (intent.changedAtMs > this.needsUiAtMs) {
          this.needsUi = false;
          this.attempts = 0;
          this.nextAttemptAtMs = 0;
        } else {
          return;
        }
      }

      // The extension writes its heartbeat every second. An unknown reading
      // with a heartbeat older than UNKNOWN_DROP_MS means the writer is gone,
      // even if this process has just started and never saw it connected.
      // With no heartbeat at all, age the evidence from the user's connect
      // instead, so a poll cannot race the start the user just asked for.
      const heartbeatAgeMs: number = nowMs - snapshot.heartbeatMs;
      const intentAgeMs: number = nowMs - intent.changedAtMs;
      const unknownIsDrop: boolean = snapshot.state === VpnLinkState.UNKNOWN &&
        (snapshot.heartbeatMs > 0 ? heartbeatAgeMs > UNKNOWN_DROP_MS :
          intentAgeMs > UNKNOWN_DROP_MS);
      if (snapshot.state === VpnLinkState.DISCONNECTED || unknownIsDrop) {
        this.wasUp = false;
        if (!this.recovering) {
          this.recovering = true;
          this.observeEnd(filesDir, nowMs, snapshot, unknownIsDrop,
            this.networkAvailable(), snapshot.conflict);
        }
        if (snapshot.conflict) {
          // No retry can settle which VPN the system should use. Wait for the
          // user to act, the same as a sign-in prompt.
          this.needsUi = true;
          this.needsUiAtMs = nowMs;
          this.record(filesDir, 'vpn_session_recovery_needs_ui', 0);
          return;
        }
        this.tryRecover(filesDir, nowMs);
        return;
      }

      // Connecting, a short unknown, or a sign-in prompt: no new drop.
      if (this.recovering || this.deferred) {
        this.tryRecover(filesDir, nowMs);
      }
    } finally {
      this.polling = false;
    }
  }

  private tryRecover(filesDir: string, nowMs: number): void {
    if (this.attemptInFlight) {
      return;
    }
    if (nowMs < this.nextAttemptAtMs) {
      return;
    }
    if (!this.networkAvailable()) {
      this.enterDeferred(filesDir);
      return;
    }
    this.deferred = false;
    this.recover(filesDir, nowMs);
  }

  private networkAvailable(): boolean {
    try {
      return connection.getDefaultNetSync().netId !== 0;
    } catch (_error) {
      // If the platform cannot answer, attempt anyway. A failed connect
      // backs off; a silent stop would leave the user without a tunnel.
      return true;
    }
  }

  private enterDeferred(filesDir: string): void {
    if (this.deferred) {
      return;
    }
    this.deferred = true;
    this.nextAttemptAtMs = 0;
    this.record(filesDir, 'vpn_session_recovery_deferred', 0);
  }

  /** Records why the session ended, once per drop episode. */
  private observeEnd(filesDir: string, nowMs: number, snapshot: VpnLinkSnapshot,
    unknownIsDrop: boolean, networkWasAvailable: boolean, conflict: boolean): void {
    let reason: SessionEndReason = SessionEndReason.UNKNOWN;
    let phase: string = 'status_disconnected';
    if (conflict) {
      // The system refused the VPN because another VPN owns the slot. No retry
      // can succeed until the user picks one.
      reason = SessionEndReason.SYSTEM_STOPPED;
      phase = 'vpn_conflict';
    } else {
      const end: SessionLedgerEntry | undefined = SessionLedger.readEndFile(filesDir);
      if (end !== undefined) {
        SessionLedger.clearEndFile(filesDir);
        const currentSessionId: string = snapshot.sessionId.length > 0 ?
          snapshot.sessionId : this.lastSessionId;
        const fromThisSession: boolean = end.sessionId.length > 0 &&
          end.sessionId === currentSessionId;
        if (fromThisSession && end.reason !== SessionEndReason.USER_STOP) {
          reason = end.reason;
          phase = end.phase;
        } else if (fromThisSession) {
          // The intent says connected, so a user-stop end is superseded. Keep
          // it visible, but do not treat it as the reason recovery was wanted.
          reason = SessionEndReason.USER_STOP;
          phase = 'end_record_user_stop';
        } else if (unknownIsDrop) {
          // A record from an earlier session cannot explain this drop, so it
          // is discarded above. The heartbeat evidence still can.
          reason = networkWasAvailable ? SessionEndReason.EXTENSION_CRASH :
            SessionEndReason.NETWORK_LOST;
          phase = networkWasAvailable ? 'heartbeat_expired_stale_end' :
            'network_offline_stale_end';
        }
      } else if (unknownIsDrop) {
        reason = networkWasAvailable ? SessionEndReason.EXTENSION_CRASH :
          SessionEndReason.NETWORK_LOST;
        phase = networkWasAvailable ? 'heartbeat_expired' : 'network_offline';
      }
    }
    const sessionId: string = snapshot.sessionId.length > 0 ? snapshot.sessionId : this.lastSessionId;
    SessionLedger.recordObserved(filesDir, 'ui', sessionId, reason, phase, 0, nowMs);
    this.record(filesDir, 'vpn_session_end_observed', 0);
  }

  private recover(filesDir: string, nowMs: number): void {
    this.attempts++;
    this.nextAttemptAtMs = nowMs + VpnReconnectSupervisor.delayFor(this.attempts);
    this.record(filesDir, 'vpn_session_recovery_attempt', this.attempts);
    const attemptId: number = ++this.attemptId;
    // Read the intent at each checkpoint. The page writes the intent directly
    // and holds no reference to this object, so a user stop there must cancel
    // an in-flight attempt through the file, not through a method call. The
    // token is positive: true means the attempt still holds its authority.
    const authorised = (): boolean => {
      if (attemptId !== this.attemptId) {
        return false;
      }
      try {
        return VpnSessionIntent.read(filesDir).desired === VpnIntentDesired.CONNECTED;
      } catch (_error) {
        return false;
      }
    };
    this.attemptInFlight = true;
    this.controller.connect(filesDir, authorised, 'recovery').then((result: VpnActionResult): void => {
      this.attemptInFlight = false;
      if (result === VpnActionResult.CANCELLED) {
        this.record(filesDir, 'vpn_session_recovery_cancelled', 0);
        return;
      }
      if (result === VpnActionResult.STARTED && !authorised()) {
        // The token is false for two reasons. The intent tells them apart.
        const intent: VpnIntent = VpnSessionIntent.read(filesDir);
        this.record(filesDir, 'vpn_session_recovery_superseded', 0);
        if (intent.desired !== VpnIntentDesired.CONNECTED) {
          // The user stopped after the last checkpoint. Undo the tunnel this
          // attempt started.
          this.controller.disconnect(filesDir, 'recovery').catch((): void => {
            this.record(filesDir, 'vpn_session_recovery_undo_failed', 0);
          });
          return;
        }
        // A new connect (card) superseded this attempt. The user wants the
        // tunnel, so leave it alone.
        this.recovering = false;
        return;
      }
      if (result === VpnActionResult.STARTED) {
        this.record(filesDir, 'vpn_session_recovery_started', this.attempts);
        return;
      }
      if (result === VpnActionResult.NEEDS_UI) {
        // No retry can finish a sign-in. Wait for the user; the page shows the
        // prompt on its next read.
        this.needsUi = true;
        // Use the result time, not the sample time. The failed attempt wrote the
        // intent after the sample began, and that write is not a user action.
        this.needsUiAtMs = Date.now();
        this.recovering = false;
        this.record(filesDir, 'vpn_session_recovery_needs_ui', 0);
        return;
      }
      this.record(filesDir, 'vpn_session_recovery_failed', this.attempts);
    }).catch((): void => {
      this.attemptInFlight = false;
      this.record(filesDir, 'vpn_session_recovery_failed', this.attempts);
    });
  }

  private static delayFor(attempts: number): number {
    const index: number = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1);
    return RETRY_DELAYS_MS[index];
  }

  private resetAfterStop(): void {
    this.recovering = false;
    this.deferred = false;
    this.needsUi = false;
    this.wasUp = false;
    this.attempts = 0;
    this.nextAttemptAtMs = 0;
  }

  private record(filesDir: string, event: string, code: number): void {
    try {
      DiagnosticEventStore.record(filesDir, 'ui', event, 'reconnect', code);
    } catch (_error) {
      // Diagnostics must never break recovery.
    }
  }
}
