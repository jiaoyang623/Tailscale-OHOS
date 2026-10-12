import { Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { formBindingData, formProvider, FormExtensionAbility } from '@kit.FormKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { FormCardService } from '../services/FormCardService';

const DOMAIN: number = 0x0000;
const TAG: string = 'VpnCard';

/**
 * Supplies the VPN toggle card.
 *
 * This process is not allowed to stay alive: the system reclaims it about ten
 * seconds after the last lifecycle callback, and the background task module is
 * explicitly not importable here. So it only ever reads the status file - all
 * VPN control happens in the app process, woken by the card's `call` action.
 */
export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    hilog.info(DOMAIN, TAG, 'Card added');
    return this.currentData();
  }

  onUpdateForm(formId: string): void {
    // Timer and on-demand refreshes both land here, including while the app
    // process is dead. That is the only way a card self-corrects then.
    formProvider.updateForm(formId, this.currentData()).catch((error: BusinessError) => {
      hilog.info(DOMAIN, TAG, 'Card refresh failed. code=%{public}d', error.code ?? -1);
    });
  }

  onRemoveForm(formId: string): void {
    hilog.info(DOMAIN, TAG, 'Card removed');
  }

  private currentData(): formBindingData.FormBindingData {
    return FormCardService.buildBindingData(this.context, this.context.filesDir);
  }
}
