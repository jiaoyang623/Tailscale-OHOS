const BUNDLE_NAME: string = 'ren.w2h.mesharc';
const ENTRY_ABILITY_NAME: string = 'EntryAbility';
const TOGGLE_METHOD: string = 'toggleVpn';

let storage: LocalStorage = new LocalStorage();

@Entry(storage)
@Component
struct VpnToggleCard {
  // Every value arrives as a string from FormCardService. Keeping the card
  // free of resources, clocks and branching logic is deliberate: one exception
  // here blanks every card this app has on the desktop.
  @LocalStorageProp('stateText') stateText: string = '';
  @LocalStorageProp('actionText') actionText: string = '';
  @LocalStorageProp('detailText') detailText: string = '';
  @LocalStorageProp('workingText') workingText: string = '';
  @LocalStorageProp('pending') pending: string = 'false';

  build() {
    Column() {
      Column() {
        Text(this.stateText)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('sys.color.font_primary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(this.detailText)
          .fontSize(11)
          .fontColor($r('sys.color.font_secondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 2 })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      Button(this.pending === 'true' ? this.workingText : this.actionText)
        .fontSize(14)
        .height(32)
        .width('100%')
        .enabled(this.pending !== 'true')
        .onClick(() => {
          // Optimistic: the label flips now, and the authoritative state
          // arrives with the provider's next updateForm.
          this.pending = 'true';
          postCardAction(this, {
            action: 'call',
            bundleName: BUNDLE_NAME,
            abilityName: ENTRY_ABILITY_NAME,
            params: { method: TOGGLE_METHOD }
          });
        })
    }
    .width('100%')
    .height('100%')
    .padding(12)
    .justifyContent(FlexAlign.SpaceBetween)
    .backgroundColor($r('sys.color.background_primary'))
  }
}
