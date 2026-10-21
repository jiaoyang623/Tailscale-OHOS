import { common, wantAgent, WantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { fileIo } from '@kit.CoreFileKit';
import { notificationManager } from '@kit.NotificationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { StoragePaths } from './StoragePaths';
import { VpnIntent, VpnIntentDesired, VpnSessionIntent } from './VpnSessionIntent';
import { VpnLinkSnapshot, VpnLinkState, VpnStatusReader } from './VpnStatusReader';
import { DiagnosticEventStore } from './DiagnosticEventStore';

const DOMAIN: number = 0x0000;
const TAG: string = 'VpnBackgroundTask';
const BUNDLE_NAME: string = 'ren.w2h.mesharc';
const ENTRY_ABILITY_NAME: string = 'EntryAbility';
const VPN_STATUS_GRACE_MS: number = 60000;
const CONNECTION_CHECK_INTERVAL_MS: number = 1000;
const NOTIFICATION_UPDATE_INTERVAL_MS: number = 30000;
const START_RETRY_BASE_MS: number = 30000;
const START_RETRY_MAX_MS: number = 300000;
/**
 * How long a fresh `connected` intent counts as evidence that a connect is in
 * flight. The page writes the intent before it stages any command, so a task
 * acquired inside this window is held before the extension can report
 * `connecting`. The window is longer than the controller's backend wait.
 */
const CONNECT_REQUEST_FRESH_MS: number = 60000;

/**
 * Sub-mode for the special-scenario continuous task.
 *
 * MODE_SPECIAL_SCENARIO_PROCESSING accepts only three sub-modes - media
 * processing, video broadcast and workout - and none of them describes a VPN.
 * Choosing one is a statement to Huawei about what this app does, so the value
 * is deliberately left unset: 0 keeps the whole path inert until whoever owns
 * the AppGallery Connect submission sets it to the scenario the restricted
 * permission was granted for.
 */
const SPECIAL_SCENARIO_SUBMODE: number = 0;

interface VpnRuntimeStatus {
  state: VpnLinkState;
  txBytes: number;
  rxBytes: number;
}

/**
 * Holds the continuous task while the user wants the tunnel.
 *
 * The task exists so the system does not freeze this process. Whether the
 * status file says connected, connecting, disconnected or nothing at all does
 * not decide that: a single uncertain read is not a user stop. Only three
 * events release the task:
 *
 *   1. the intent file says stopped;
 *   2. the user cancels the notification, and the app does not fight the system
 *      until the app is in the foreground again;
 *   3. the ability is destroyed.
 *
 * A real disconnect keeps the task, because recovery needs the process awake.
 * A `connected` intent written in the last minute is positive evidence that a
 * connect is in flight. The task starts then, before any interface exists.
 */
export class VpnBackgroundTaskManager {
  private context?: common.UIAbilityContext;
  private monitoring: boolean = false;
  private operationInFlight: boolean = false;
  private listenerRegistered: boolean = false;
  private suspendListenerRegistered: boolean = false;
  private lifecycleGeneration: number = 0;
  private cancellationRevision: number = 0;
  private monitorTimer: number = -1;
  private task?: backgroundTaskManager.ContinuousTaskNotification;
  private stopping: boolean = false;
  private suppressedUntilForeground: boolean = false;
  private foreground: boolean = false;
  private nextStartAtMs: number = 0;
  private retryCount: number = 0;
  private lastLiveAtMs: number = 0;
  private statusTimedOut: boolean = false;
  private nextNotificationAtMs: number = 0;
  private specialScenarioTask: boolean = false;

  private readonly cancelCallback =
    (info: backgroundTaskManager.ContinuousTaskCancelInfo): void => {
      if (this.stopping || (this.task?.continuousTaskId !== undefined &&
        info.id !== this.task.continuousTaskId)) {
        return;
      }
      // Cancellation can arrive before startBackgroundRunning resolves.
      this.cancellationRevision++;
      this.task = undefined;
      const userCancelled: boolean =
        info.reason === backgroundTaskManager.ContinuousTaskCancelReason.USER_CANCEL ||
        info.reason === backgroundTaskManager.ContinuousTaskCancelReason.USER_CANCEL_REMOVE_NOTIFICATION;
      if (userCancelled) {
        // Dismissing the notification is not a request to stop the tunnel.
        // In the foreground the app can ask for the task again at once. In
        // the background it waits for the next foreground edge, so it does
        // not fight the system.
        this.suppressedUntilForeground = !this.foreground;
        this.record('background_user_cancelled_kept_vpn', info.reason);
      } else {
        this.scheduleRetry();
        this.record('background_system_cancelled', info.reason);
      }
      hilog.info(DOMAIN, TAG, 'VPN background task cancelled. id=%{public}d reason=%{public}d',
        info.id, info.reason);
    };

  private readonly suspendCallback =
    (info: backgroundTaskManager.ContinuousTaskSuspendInfo): void => {
      if (info.continuousTaskId !== this.task?.continuousTaskId) {
        return;
      }
      this.record(info.suspendState ? 'background_suspended' : 'background_resumed', info.suspendReason);
      hilog.info(DOMAIN, TAG, 'VPN background task suspend=%{public}s reason=%{public}d',
        `${info.suspendState}`, info.suspendReason);
    };

  register(context: common.UIAbilityContext): void {
    if (this.monitoring) {
      return;
    }
    this.context = context;
    try {
      backgroundTaskManager.on('continuousTaskCancel', this.cancelCallback);
      this.listenerRegistered = true;
    } catch (error) {
      this.record('background_listener_failed', (error as BusinessError).code ?? -1);
    }
    try {
      backgroundTaskManager.on('continuousTaskSuspend', this.suspendCallback);
      this.suspendListenerRegistered = true;
    } catch (error) {
      this.record('background_suspend_listener_failed', (error as BusinessError).code ?? -1);
    }
    this.monitoring = true;
    ++this.lifecycleGeneration;
    this.reconcile(context);
    this.monitorTimer = setInterval(() => this.reconcile(context), CONNECTION_CHECK_INTERVAL_MS);
  }

  unregister(): void {
    this.monitoring = false;
    this.lifecycleGeneration++;
    if (this.monitorTimer >= 0) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = -1;
    }
    if (this.listenerRegistered) {
      try {
        backgroundTaskManager.off('continuousTaskCancel', this.cancelCallback);
      } catch (_error) {
        // Ability destruction also releases this process's listeners.
      }
      this.listenerRegistered = false;
    }
    if (this.suspendListenerRegistered) {
      try {
        backgroundTaskManager.off('continuousTaskSuspend', this.suspendCallback);
      } catch (_error) {
        // Best-effort teardown.
      }
      this.suspendListenerRegistered = false;
    }
    if (this.context !== undefined) {
      this.reconcile(this.context);
    }
  }

  onBackground(context: common.UIAbilityContext): void {
    this.foreground = false;
    this.record('background_entered');
    this.reconcile(context);
  }

  onForeground(context: common.UIAbilityContext): void {
    this.foreground = true;
    const wasSuppressed: boolean = this.suppressedUntilForeground;
    // Foreground permits retrying a system failure, and it is the only place
    // where the app asks for the task again after the user dismissed it.
    this.suppressedUntilForeground = false;
    this.nextStartAtMs = 0;
    this.retryCount = 0;
    if (wasSuppressed && this.intentConnected(context)) {
      this.record('background_protection_restored');
    }
    this.reconcile(context);
  }

  private async reconcile(context: common.UIAbilityContext): Promise<void> {
    if (this.operationInFlight) {
      return;
    }
    this.operationInFlight = true;
    const generation: number = this.lifecycleGeneration;
    try {
      if (!this.monitoring) {
        await this.stop(context);
        return;
      }
      const intent: VpnIntent = VpnSessionIntent.read(context.filesDir);
      if (intent.desired !== VpnIntentDesired.CONNECTED) {
        this.suppressedUntilForeground = false;
        this.nextStartAtMs = 0;
        this.retryCount = 0;
        this.lastLiveAtMs = 0;
        this.statusTimedOut = false;
        await this.stop(context);
        return;
      }
      const nowMs: number = Date.now();
      const status: VpnRuntimeStatus = this.readStatus(context.filesDir);
      const live: boolean = VpnBackgroundTaskManager.isLiveState(status.state);
      // The page writes the intent before it stages a command. A fresh intent
      // is positive evidence that a connect is in flight, so the task starts
      // before the extension can report `connecting`.
      const connectRequested: boolean = this.connectRequestedRecently(intent, nowMs);
      if (live) {
        this.lastLiveAtMs = nowMs;
        this.statusTimedOut = false;
      }
      if ((live || connectRequested) && this.task === undefined &&
        !this.suppressedUntilForeground && nowMs >= this.nextStartAtMs) {
        await this.start(context, generation);
      }
      if (live && this.monitoring && generation === this.lifecycleGeneration &&
        this.task !== undefined) {
        await this.updateNotification(context, status);
      }
      if (live || connectRequested) {
        return;
      }
      // The tunnel is down or its readings are uncertain, and the user still
      // wants it. Keep the task so recovery can run, and report a long gap in
      // telemetry once so a device run can see it.
      if (status.state === VpnLinkState.UNKNOWN && this.task !== undefined &&
        !this.statusTimedOut && this.lastLiveAtMs > 0 &&
        nowMs - this.lastLiveAtMs > VPN_STATUS_GRACE_MS) {
        this.statusTimedOut = true;
        this.record('background_status_timeout');
      }
    } catch (error) {
      this.scheduleRetry();
      this.record('background_operation_failed', (error as BusinessError).code ?? -1);
    } finally {
      // Destruction may happen during any awaited operation.
      if (!this.monitoring) {
        await this.stop(context);
      }
      this.operationInFlight = false;
    }
  }

  /** States in which the tunnel is coming up or running, so it must be held. */
  private static isLiveState(state: VpnLinkState): boolean {
    return state === VpnLinkState.CONNECTED || state === VpnLinkState.CONNECTING;
  }

  private intentConnected(context: common.UIAbilityContext): boolean {
    return VpnSessionIntent.read(context.filesDir).desired === VpnIntentDesired.CONNECTED;
  }

  private connectRequestedRecently(intent: VpnIntent, nowMs: number): boolean {
    return intent.changedAtMs > 0 && nowMs >= intent.changedAtMs &&
      nowMs - intent.changedAtMs <= CONNECT_REQUEST_FRESH_MS;
  }

  private async start(context: common.UIAbilityContext, generation: number): Promise<void> {
    const revision: number = this.cancellationRevision;
    const info: wantAgent.WantAgentInfo = {
      wants: [{ bundleName: BUNDLE_NAME, abilityName: ENTRY_ABILITY_NAME }],
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode: 1001,
      actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
    };
    const agent: WantAgent = await wantAgent.getWantAgent(info);
    const intent: VpnIntent = VpnSessionIntent.read(context.filesDir);
    if (!this.monitoring || generation !== this.lifecycleGeneration ||
      revision !== this.cancellationRevision ||
      intent.desired !== VpnIntentDesired.CONNECTED ||
      (!VpnBackgroundTaskManager.isLiveState(this.readStatus(context.filesDir).state) &&
        !this.connectRequestedRecently(intent, Date.now()))) {
      return;
    }
    if (await this.startSpecialScenario(context, agent, generation, revision)) {
      return;
    }
    // The numeric overload returns void and cannot supply the system-owned
    // notification ID needed for DATA_TRANSFER live-view updates.
    const task: backgroundTaskManager.ContinuousTaskNotification =
      await backgroundTaskManager.startBackgroundRunning(context, ['dataTransfer'], agent);
    if (revision !== this.cancellationRevision) {
      return;
    }
    this.task = task;
    if (!this.monitoring || generation !== this.lifecycleGeneration ||
      !this.intentConnected(context)) {
      await this.stop(context);
      return;
    }
    this.nextNotificationAtMs = 0;
    this.record('background_started');
    hilog.info(DOMAIN, TAG, 'VPN DATA_TRANSFER background task started. id=%{public}d',
      task.continuousTaskId ?? -1);
  }

  /**
   * Tries the special-scenario continuous task: the system's user-consented
   * "run in the background for a long time" mode. requestAuthFromUser asks the
   * user through a banner ("allow once" / "always allow") and
   * checkSpecialScenarioAuth reports the stored answer.
   *
   * Unlike the data-transfer task this one is not tied to a progress update
   * every ten minutes, which is what makes it a better fit for a tunnel. It is
   * unavailable by default: it needs a restricted permission granted through
   * AppGallery Connect, and declaring that permission without a matching
   * profile makes the app impossible to install. Every failure below - not
   * configured, unsupported device, no permission, refused by the user -
   * simply returns false so the documented DATA_TRANSFER task is used instead.
   */
  private async startSpecialScenario(context: common.UIAbilityContext, agent: WantAgent,
    generation: number, revision: number): Promise<boolean> {
    if (SPECIAL_SCENARIO_SUBMODE === 0) {
      // The subtype is a statement to Huawei about what this app is for, so it
      // stays unset until the submitting party picks it. Record why nothing ran.
      this.record('background_special_scenario_unconfigured');
      return false;
    }
    try {
      const request: backgroundTaskManager.ContinuousTaskRequest =
        new backgroundTaskManager.ContinuousTaskRequest();
      request.backgroundTaskModes = [backgroundTaskManager.BackgroundTaskMode.MODE_SPECIAL_SCENARIO_PROCESSING];
      request.backgroundTaskSubmodes = [SPECIAL_SCENARIO_SUBMODE];
      request.wantAgent = agent;
      // Special-scenario tasks must stand alone; notification merging is rejected.
      request.combinedTaskNotification = false;
      if (!request.isModeSupported()) {
        this.record('background_special_scenario_unsupported');
        return false;
      }
      const auth: backgroundTaskManager.UserAuthResult = await request.checkSpecialScenarioAuth(context);
      if (auth !== backgroundTaskManager.UserAuthResult.GRANTED_ONCE &&
        auth !== backgroundTaskManager.UserAuthResult.GRANTED_ALWAYS) {
        // The code carries the raw UserAuthResult, so a device run can tell
        // "the user declined" from "the system does not support the mode".
        this.record('background_special_scenario_denied', auth);
        return false;
      }
      const task: backgroundTaskManager.ContinuousTaskNotification =
        await backgroundTaskManager.startBackgroundRunning(context, request);
      if (!this.monitoring || generation !== this.lifecycleGeneration ||
        revision !== this.cancellationRevision) {
        await backgroundTaskManager.stopBackgroundRunning(context);
        return false;
      }
      this.task = task;
      this.specialScenarioTask = true;
      this.record('background_started_special_scenario');
      return true;
    } catch (error) {
      this.record('background_special_scenario_failed', (error as BusinessError).code ?? -1);
      return false;
    }
  }

  private async stop(context: common.UIAbilityContext): Promise<void> {
    if (this.task === undefined) {
      return;
    }
    this.stopping = true;
    try {
      await backgroundTaskManager.stopBackgroundRunning(context);
      this.task = undefined;
      this.specialScenarioTask = false;
      this.record('background_stopped');
    } catch (error) {
      this.record('background_stop_failed', (error as BusinessError).code ?? -1);
    } finally {
      this.stopping = false;
    }
  }

  private async updateNotification(context: common.UIAbilityContext, status: VpnRuntimeStatus): Promise<void> {
    if (this.specialScenarioTask) {
      // A special-scenario task carries a plain notification and must not be
      // rewritten as a data-transfer live view.
      return;
    }
    const task: backgroundTaskManager.ContinuousTaskNotification | undefined = this.task;
    if (task === undefined || Date.now() < this.nextNotificationAtMs) {
      return;
    }
    this.nextNotificationAtMs = Date.now() + NOTIFICATION_UPDATE_INTERVAL_MS;
    const title: string = context.resourceManager.getStringByNameSync('notification_vpn_background_title');
    const traffic: string = `↑ ${this.formatBytes(status.txBytes)}  ↓ ${this.formatBytes(status.rxBytes)}`;
    const request: notificationManager.NotificationRequest = {
      id: task.notificationId,
      notificationSlotType: notificationManager.SlotType.LIVE_VIEW,
      isAlertOnce: true,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW,
        systemLiveView: { typeCode: 8, title: title, text: traffic }
      },
      template: {
        name: 'downloadTemplate',
        // A tunnel has no completion percentage. Never invent cyclic progress
        // or traffic: leave progress at zero and display actual byte counters.
        data: { title: title, fileName: traffic, progressValue: 0 }
      }
    };
    try {
      await notificationManager.publish(request);
    } catch (error) {
      this.record('background_notification_failed', (error as BusinessError).code ?? -1);
    }
  }

  private readStatus(filesDir: string): VpnRuntimeStatus {
    const unknown: VpnRuntimeStatus = { state: VpnLinkState.UNKNOWN, txBytes: 0, rxBytes: 0 };
    try {
      const status: string = fileIo.readTextSync(StoragePaths.vpnStatusPath(filesDir));
      // One judgement, taken from VpnStatusReader. Two readers of this file used
      // to rank the same markers differently, so the app and the card could
      // report opposite states for one line.
      const reading: VpnLinkSnapshot = VpnStatusReader.readText(status, Date.now());
      return { state: reading.state, txBytes: reading.txBytes, rxBytes: reading.rxBytes };
    } catch (_error) {
      // Atomic file replacement or temporary I/O failure is uncertain state.
      return unknown;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  private scheduleRetry(): void {
    this.nextStartAtMs = Date.now() + Math.min(START_RETRY_MAX_MS,
      START_RETRY_BASE_MS * Math.pow(2, Math.min(this.retryCount, 4)));
    this.retryCount++;
  }

  private record(event: string, code: number = 0): void {
    hilog.info(DOMAIN, TAG, '%{public}s code=%{public}d', event, code);
    if (this.context !== undefined) {
      DiagnosticEventStore.record(this.context.filesDir, 'ui', event, 'background', code);
    }
  }
}