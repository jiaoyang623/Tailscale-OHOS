import {
  AbilityConstant,
  Configuration,
  ConfigurationConstant,
  UIAbility,
  Want
} from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { BusinessError, power } from '@kit.BasicServicesKit';
import { rpc } from '@kit.IPCKit';
import { notificationManager } from '@kit.NotificationKit';
import { connection } from '@kit.NetworkKit';
import { APP_BACKGROUND_EVENT, APP_FOREGROUND_EVENT } from '../services/AppLifecycleEvents';
import { AppShellFeatureAction, AppShellIntentAdapter } from '../services/AppShellIntentAdapter';
import { FormCardService } from '../services/FormCardService';
import { VpnReconnectSupervisor } from '../services/VpnReconnectSupervisor';
import { VpnActionResult, VpnSessionController } from '../services/VpnSessionController';
import { VpnLinkSnapshot, VpnLinkState, VpnStatusReader } from '../services/VpnStatusReader';
import { VpnBackgroundTaskManager } from '../services/VpnBackgroundTaskManager';
import { VpnPowerPolicy, VpnPowerStage, VpnPowerStageChange } from '../services/VpnPowerPolicy';
import { DiagnosticPrivacy } from '../services/DiagnosticPrivacy';
import { WindowEnvironment } from '../services/WindowEnvironment';

const DOMAIN = 0x0000;
const TAG = 'TailscaleOHOS';
const BUNDLE_NAME: string = 'ren.w2h.mesharc';
const ENTRY_ABILITY_NAME: string = 'EntryAbility';

/** Card method name; must match the `params.method` the card posts. */
const CARD_TOGGLE_METHOD: string = 'toggleVpn';
const CARD_POLL_INTERVAL_MS: number = 5000;
/** Traffic is cosmetic; state changes are what must feel immediate. */
const CARD_TRAFFIC_REFRESH_MS: number = 60000;
/** Re-checking the desktop is far cheaper than reading status every tick. */
const CARD_PRESENCE_CHECK_TICKS: number = 12;
/** The screen can change while the app is out of sight. */
const POWER_STAGE_SAMPLE_INTERVAL_MS: number = 30000;

/** The `call` action requires a Parcelable return value. */
class CardActionReply implements rpc.Parcelable {
  accepted: boolean = true;

  marshalling(messageSequence: rpc.MessageSequence): boolean {
    messageSequence.writeInt(this.accepted ? 1 : 0);
    return true;
  }

  unmarshalling(messageSequence: rpc.MessageSequence): boolean {
    this.accepted = messageSequence.readInt() === 1;
    return true;
  }
}

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private readonly vpnBackgroundTask: VpnBackgroundTaskManager = new VpnBackgroundTaskManager();
  private readonly vpnReconnect: VpnReconnectSupervisor = new VpnReconnectSupervisor();
  private readonly appShellIntentAdapter: AppShellIntentAdapter = new AppShellIntentAdapter();
  private readonly windowEnvironment: WindowEnvironment = new WindowEnvironment();
  private appShellContentReady: boolean = false;
  private pendingAppShellFeatureActions: AppShellFeatureAction[] = [];
  private cardTimer: number = -1;
  private cardTicks: number = 0;
  private cardPresent: boolean = false;
  private cardRefreshInFlight: boolean = false;
  private lastCardState: string = '';
  private lastCardPushAtMs: number = 0;
  private powerStageTimer: number = -1;
  /** The stage this process last wrote. Used to pace the card refresh. */
  private powerStage: VpnPowerStage = VpnPowerStage.ACTIVE;
  private netConnection?: connection.NetConnection;

  /**
   * The default network came back. This is the trigger that makes a deferred
   * recovery start at once instead of waiting for a retry timer.
   */
  private readonly netAvailableCallback = (_net: connection.NetHandle): void => {
    this.vpnReconnect.onNetworkAvailable(Date.now());
  };

  private applyEdgeToEdge(colorMode?: ConfigurationConstant.ColorMode): void {
    const mainWindow = this.mainWindow;
    if (mainWindow === undefined) {
      return;
    }
    const darkMode: boolean = colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    const shellPolicy = WindowEnvironment.shellWindowPolicy();
    if (shellPolicy.edgeToEdge) {
      mainWindow.setWindowLayoutFullScreen(true).catch((error: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'Failed to enable edge-to-edge. %{public}s', DiagnosticPrivacy.formatLogError(error));
      });
    }
    if (shellPolicy.systemBarsVisible) {
      mainWindow.setWindowSystemBarEnable(['status', 'navigation']).catch((error: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'Failed to keep system bars visible. %{public}s', DiagnosticPrivacy.formatLogError(error));
      });
    }
    // The freeform system title area remains system-owned and visible. HDS
    // title bars own content safe-area avoidance inside the edge-to-edge shell.
    mainWindow.setWindowSystemBarProperties({
      statusBarColor: '#00000000',
      navigationBarColor: '#00000000',
      statusBarContentColor: darkMode ? '#FFFFFFFF' : '#FF000000',
      navigationBarContentColor: darkMode ? '#FFFFFFFF' : '#FF000000'
    }).catch((error: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'Failed to update system bar colors. %{public}s', DiagnosticPrivacy.formatLogError(error));
    });
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.vpnBackgroundTask.register(this.context);
    this.applyPowerStage(VpnPowerStage.ACTIVE);
    try {
      const monitor: connection.NetConnection = connection.createNetConnection();
      monitor.on('netAvailable', this.netAvailableCallback);
      monitor.register((error: BusinessError) => {
        if (error !== undefined && error.code !== 0) {
          hilog.warn(DOMAIN, TAG, 'Network availability registration failed. %{public}s',
            DiagnosticPrivacy.formatLogError(error));
        }
      });
      this.netConnection = monitor;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'Network availability listener failed. %{public}s',
        DiagnosticPrivacy.formatLogError(error as BusinessError));
    }
    this.handleTaildropNotificationWant(want);
    try {
      this.callee.on(CARD_TOGGLE_METHOD, this.toggleVpnFromCard);
    } catch (error) {
      // Without the callee the card still renders; its button just cannot act.
      hilog.warn(DOMAIN, TAG, 'Card toggle registration failed. %{public}s',
        DiagnosticPrivacy.formatLogError(error as BusinessError));
    }
    this.startCardUpdates();
    hilog.info(DOMAIN, TAG, 'EntryAbility onCreate. ability=%{public}s reason=%{public}d',
      want.abilityName ?? '', launchParam.launchReason);
  }

  onDestroy(): void {
    if (this.powerStageTimer >= 0) {
      clearInterval(this.powerStageTimer);
      this.powerStageTimer = -1;
    }
    const monitor: connection.NetConnection | undefined = this.netConnection;
    this.netConnection = undefined;
    if (monitor !== undefined) {
      try {
        monitor.unregister((_error: BusinessError) => {});
      } catch (_error) {
        // Ability destruction also releases this process's listeners.
      }
    }
    if (this.cardTimer >= 0) {
      clearInterval(this.cardTimer);
      this.cardTimer = -1;
    }
    try {
      this.callee.off(CARD_TOGGLE_METHOD);
    } catch (_error) {
      // Ability destruction also releases this process's callee handlers.
    }
    this.windowEnvironment.detach();
    this.vpnBackgroundTask.unregister();
    hilog.info(DOMAIN, TAG, 'EntryAbility onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'EntryAbility onWindowStageCreate');
    try {
      this.mainWindow = windowStage.getMainWindowSync();
    } catch (error) {
      const businessError = error as BusinessError;
      hilog.error(DOMAIN, TAG, 'Failed to get main window. code=%{public}d', businessError.code);
    }
    this.applyEdgeToEdge(this.context.config.colorMode);
    if (this.mainWindow !== undefined) {
      this.windowEnvironment.attach(this.mainWindow, this.context.config);
    }
    this.requestNotificationAuthorization();
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'Failed to load pages/Index. code=%{public}d', err.code);
        return;
      }
      this.appShellContentReady = true;
      this.pendingAppShellFeatureActions.forEach((featureAction: AppShellFeatureAction) => {
        this.deliverAppShellFeatureAction(featureAction);
      });
      this.pendingAppShellFeatureActions = [];
      hilog.info(DOMAIN, TAG, 'pages/Index loaded');
    });
  }

  onWindowStageDestroy(): void {
    this.windowEnvironment.detach();
    this.mainWindow = undefined;
    this.appShellContentReady = false;
    hilog.info(DOMAIN, TAG, 'EntryAbility onWindowStageDestroy');
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    this.windowEnvironment.updateConfiguration(newConfig);
    this.applyEdgeToEdge(newConfig.colorMode);
  }

  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    this.handleTaildropNotificationWant(want);
  }

  onForeground(): void {
    this.vpnBackgroundTask.onForeground(this.context);
    this.vpnReconnect.onForeground();
    this.stopPowerStageSampling();
    this.applyPowerStage(VpnPowerStage.ACTIVE);
    this.applyEdgeToEdge(this.context.config.colorMode);
    this.context.eventHub.emit(APP_FOREGROUND_EVENT);
    // Coming back is a good moment to reconcile the desktop with reality.
    this.lastCardState = '';
    hilog.info(DOMAIN, TAG, 'EntryAbility onForeground');
  }

  onBackground(): void {
    this.vpnBackgroundTask.onBackground(this.context);
    this.vpnReconnect.onBackground(Date.now());
    this.applyPowerStage(VpnPowerPolicy.stageFor(true));
    this.startPowerStageSampling();
    this.context.eventHub.emit(APP_BACKGROUND_EVENT);
    hilog.info(DOMAIN, TAG, 'EntryAbility onBackground');
  }

  /**
   * Writes the observation rate the extension reads. A failed write keeps the
   * previous stage, so a full disk cannot silently slow the extension.
   */
  private applyPowerStage(stage: VpnPowerStage): void {
    this.powerStage = stage;
    const changes: VpnPowerStageChange[] = [];
    VpnPowerPolicy.applyStage(this.context.filesDir, stage, changes);
  }

  private startPowerStageSampling(): void {
    this.stopPowerStageSampling();
    this.powerStageTimer = setInterval(() => {
      this.applyPowerStage(VpnPowerPolicy.stageFor(true));
    }, POWER_STAGE_SAMPLE_INTERVAL_MS);
  }

  private stopPowerStageSampling(): void {
    if (this.powerStageTimer >= 0) {
      clearInterval(this.powerStageTimer);
      this.powerStageTimer = -1;
    }
  }

  /**
   * Runs a card toggle.
   *
   * The `call` action wakes this ability in the background without showing it,
   * so anything that genuinely needs the user (sign-in, control-server setup)
   * has to raise the window instead of failing silently.
   */
  private readonly toggleVpnFromCard = (data: rpc.MessageSequence): CardActionReply => {
    try {
      // Params arrive as a JSON string; the form id is injected by the system.
      JSON.parse(data.readString());
    } catch (_error) {
      // A malformed payload still toggles; there is nothing to report back.
    }
    this.performCardToggle();
    return new CardActionReply();
  };

  private performCardToggle(): void {
    const filesDir: string = this.context.filesDir;
    const controller: VpnSessionController = new VpnSessionController();
    const snapshot: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
    const disconnecting: boolean = snapshot.state === VpnLinkState.CONNECTED;
    // Tell the reconnect supervisor what the user just asked for, so it does
    // not undo a deliberate disconnect.
    if (disconnecting) {
      this.vpnReconnect.noteRequestedStop();
    } else {
      this.vpnReconnect.noteRequestedStart();
    }
    const action: Promise<VpnActionResult> = disconnecting
      ? controller.disconnect(filesDir, 'card')
      : controller.connect(filesDir, undefined, 'card');
    action.then((result: VpnActionResult): Promise<number> => {
      hilog.info(DOMAIN, TAG, 'Card toggle result=%{public}s', result);
      if (result === VpnActionResult.NEEDS_UI) {
        this.raiseWindow();
      }
      this.lastCardState = '';
      return FormCardService.refreshAll(this.context, filesDir);
    }).catch((error: BusinessError) => {
      hilog.info(DOMAIN, TAG, 'Card toggle failed. code=%{public}d', error.code ?? -1);
    });
  }

  private raiseWindow(): void {
    this.context.startAbility({
      bundleName: BUNDLE_NAME,
      abilityName: ENTRY_ABILITY_NAME
    }).catch((error: BusinessError) => {
      hilog.info(DOMAIN, TAG, 'Raising the window failed. code=%{public}d', error.code ?? -1);
    });
  }

  /**
   * Keeps cards in step with the app while this process is alive. The desktop
   * is only re-checked every CARD_PRESENCE_CHECK_TICKS so an app without a
   * card costs one cheap call a minute, not one every tick. When the process
   * is gone only the card's own timer refresh runs, which is why the card
   * config asks for a periodic update.
   */
  private startCardUpdates(): void {
    if (this.cardTimer >= 0) {
      return;
    }
    this.cardTimer = setInterval(() => {
      this.cardTicks++;
      this.vpnReconnect.poll(this.context.filesDir, Date.now());
      const cardEvery: number = VpnPowerPolicy.cardRefreshTicks(this.powerStage);
      const due: boolean = this.cardPresent ? this.cardTicks % cardEvery === 0 : false;
      if (this.cardTicks % CARD_PRESENCE_CHECK_TICKS === 0 || due) {
        this.refreshCardsIfChanged();
      }
    }, CARD_POLL_INTERVAL_MS);
  }

  private refreshCardsIfChanged(): void {
    if (this.cardRefreshInFlight) {
      return;
    }
    this.cardRefreshInFlight = true;
    const filesDir: string = this.context.filesDir;
    FormCardService.hasCards().then((hasCards: boolean): Promise<number> => {
      this.cardPresent = hasCards;
      if (!hasCards) {
        this.lastCardState = '';
        return Promise.resolve(0);
      }
      const snapshot: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
      const now: number = Date.now();
      const stateChanged: boolean = snapshot.state !== this.lastCardState;
      const trafficDue: boolean = snapshot.state === VpnLinkState.CONNECTED &&
        now - this.lastCardPushAtMs >= CARD_TRAFFIC_REFRESH_MS;
      if (!stateChanged && !trafficDue) {
        return Promise.resolve(0);
      }
      this.lastCardState = snapshot.state;
      this.lastCardPushAtMs = now;
      return FormCardService.refreshAll(this.context, filesDir);
    }).catch((error: BusinessError) => {
      hilog.info(DOMAIN, TAG, 'Card sync failed. code=%{public}d', error.code ?? -1);
    }).finally(() => {
      this.cardRefreshInFlight = false;
    });
  }

  private handleTaildropNotificationWant(want: Want): void {
    const featureAction: AppShellFeatureAction = this.appShellIntentAdapter.toFeatureAction(want);
    if (!this.appShellContentReady) {
      this.pendingAppShellFeatureActions.push(featureAction);
      return;
    }
    this.deliverAppShellFeatureAction(featureAction);
  }

  private deliverAppShellFeatureAction(featureAction: AppShellFeatureAction): void {
    if (featureAction.openTaildropInbox) {
      AppStorage.setOrCreate('taildropOpenInbox', Date.now());
    }
    if (featureAction.taildropNotificationAction.length > 0) {
      AppStorage.setOrCreate('taildropNotificationAction', featureAction.taildropNotificationAction);
    }
  }

  private requestNotificationAuthorization(): void {
    notificationManager.isNotificationEnabled().then((enabled: boolean) => {
      if (!enabled) {
        return notificationManager.requestEnableNotification(this.context);
      }
      return Promise.resolve();
    }).catch((error: BusinessError) => {
      hilog.info(DOMAIN, TAG, 'Notification authorization unavailable. code=%{public}d', error.code ?? -1);
    });
  }
}
