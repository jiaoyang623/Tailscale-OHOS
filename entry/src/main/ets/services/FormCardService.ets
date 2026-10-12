import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { formBindingData, formInfo, formProvider } from '@kit.FormKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ControlServerConfig } from './ControlServerConfig';
import { VpnLinkSnapshot, VpnLinkState, VpnStatusReader } from './VpnStatusReader';

const DOMAIN: number = 0x0000;
const TAG: string = 'VpnCard';

/** No card is on the desktop; that is a normal state, not a failure. */
const NO_FORM_CONFIG_ERROR_CODE: number = 16500100;

const STATE_CONNECTED: string = 'connected';
const STATE_DISCONNECTED: string = 'disconnected';
const STATE_CONNECTING: string = 'connecting';
const STATE_NEEDS_LOGIN: string = 'needs_login';
const STATE_NEEDS_SETUP: string = 'needs_setup';

export class FormCardService {
  /**
   * Builds the card payload.
   *
   * Every value is a plain string and every user-visible text is already
   * localized here: a card that renders nothing but supplied strings cannot
   * throw, and a single card error takes down every card the app has.
   */
  static buildBindingData(context: common.Context, filesDir: string): formBindingData.FormBindingData {
    const snapshot: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
    const state: string = FormCardService.stateName(snapshot.state, filesDir);
    const payload: Record<string, string> = {
      'state': state,
      'stateText': FormCardService.text(context, `widget_vpn_state_${state}`),
      'actionText': FormCardService.text(context, FormCardService.actionResource(state)),
      'detailText': FormCardService.detail(snapshot),
      'workingText': FormCardService.text(context, 'widget_vpn_state_working'),
      // A push always clears the card's local in-flight flag.
      'pending': 'false'
    };
    return formBindingData.createFormBindingData(payload);
  }

  /**
   * Pushes current state to every card on the desktop. Returns how many were
   * updated; zero is normal when the user has not added a card.
   */
  static async refreshAll(context: common.Context, filesDir: string): Promise<number> {
    let forms: formInfo.RunningFormInfo[] = [];
    try {
      forms = await formProvider.getPublishedRunningFormInfos();
    } catch (error) {
      const code: number = (error as BusinessError).code ?? -1;
      if (code !== NO_FORM_CONFIG_ERROR_CODE) {
        hilog.info(DOMAIN, TAG, 'Card enumeration failed. code=%{public}d', code);
      }
      return 0;
    }
    if (forms.length === 0) {
      return 0;
    }
    const data: formBindingData.FormBindingData = FormCardService.buildBindingData(context, filesDir);
    let updated: number = 0;
    for (const form of forms) {
      try {
        await formProvider.updateForm(form.formId, data);
        updated++;
      } catch (error) {
        hilog.info(DOMAIN, TAG, 'Card update failed. code=%{public}d',
          (error as BusinessError).code ?? -1);
      }
    }
    return updated;
  }

  /** True when at least one card is on the desktop. */
  static async hasCards(): Promise<boolean> {
    try {
      const forms: formInfo.RunningFormInfo[] = await formProvider.getPublishedRunningFormInfos();
      return forms.length > 0;
    } catch (_error) {
      return false;
    }
  }

  private static stateName(state: VpnLinkState, filesDir: string): string {
    // A first run has no control server yet. That is a setup task the card
    // cannot perform, so it says so instead of offering a button that would
    // only bounce the user into the app.
    const setupRequired: boolean = !ControlServerConfig.load(filesDir).confirmed;
    if (state === VpnLinkState.CONNECTED) {
      return STATE_CONNECTED;
    }
    if (state === VpnLinkState.NEEDS_LOGIN) {
      return STATE_NEEDS_LOGIN;
    }
    if (setupRequired) {
      return STATE_NEEDS_SETUP;
    }
    // Unknown while configured means the tunnel is being brought up or the
    // extension just stopped; both read as "connecting" rather than as a
    // confident claim in either direction.
    return state === VpnLinkState.DISCONNECTED ? STATE_DISCONNECTED : STATE_CONNECTING;
  }

  private static actionResource(state: string): string {
    if (state === STATE_CONNECTED) {
      return 'action_disconnect';
    }
    if (state === STATE_NEEDS_SETUP) {
      return 'widget_vpn_action_setup';
    }
    return 'action_connect';
  }

  private static detail(snapshot: VpnLinkSnapshot): string {
    if (snapshot.state !== VpnLinkState.CONNECTED) {
      return '';
    }
    return `↑ ${FormCardService.formatBytes(snapshot.txBytes)}  ↓ ${FormCardService.formatBytes(snapshot.rxBytes)}`;
  }

  private static formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  private static text(context: common.Context, name: string): string {
    try {
      return context.resourceManager.getStringByNameSync(name);
    } catch (_error) {
      // Missing resources must never blank the card.
      return '';
    }
  }
}
