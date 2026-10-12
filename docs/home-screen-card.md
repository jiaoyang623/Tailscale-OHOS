# Home screen card

A 2×2 ArkTS card that starts and stops the VPN without opening the app, and
shows the current state.

## Why a card and not a control center toggle

A control center tile, the Android `TileService` equivalent, is not available
to third-party apps on HarmonyOS. The documented answer (FAQ
`faqs-ability-173`) is that quick toggles are reserved for system apps and that
the only route for anyone else is guiding the user to build a "manual tap"
scene in 智慧生活 and add that to the control center; even collapsing the
control center after a tap is withheld for security. The one API that looks
relevant, `statusBarManager` from Desktop Extension Kit, declares
`SystemCapability.PCService.StatusBarManager`, so it is PC/2in1 only.

A home screen card is the closest entry point the platform does offer. The card
is added the standard way: long-press the app icon → 卡片 → add to desktop.

## What is in the tree

| Path | Responsibility |
| --- | --- |
| `entry/src/main/ets/services/VpnStatusReader.ets` | Derives state from `vpn-probe-status.txt`. Free of the native bridge and of ArkUI so the app, the form extension and the card all share one rule set. |
| `entry/src/main/ets/services/VpnSessionController.ets` | UI-free connect/disconnect over `VpnCommandGateway`. |
| `entry/src/main/ets/services/FormCardService.ets` | Builds the card payload and pushes it to every card on the desktop. |
| `entry/src/main/ets/services/VpnReconnectSupervisor.ets` | Drop recovery; see `background-vpn-reliability.md`. |
| `entry/src/main/ets/entryformability/EntryFormAbility.ets` | The card provider. |
| `entry/src/main/ets/widget/pages/VpnToggleCard.ets` | The card UI. |
| `entry/src/main/resources/base/profile/form_config.json` | Card configuration. |

`EntryAbility` must stay `launchType: "singleton"` in `module.json5`: the card's
`call` action only reaches a singleton UIAbility, and that declaration is
explicit rather than relying on the default.

## How a tap works

The card posts a `call` action, which wakes `EntryAbility` in the background
without showing it. `EntryAbility` registers a callee named `toggleVpn` and
runs the toggle through `VpnSessionController`, then pushes the new state back
with `formProvider.updateForm`.

The button flips to a "working" label immediately, because the authoritative
state only arrives with the next `updateForm`. That optimistic flip is the
documented remedy for tap latency (FAQ `faqs-performance-33`).

Anything that genuinely needs the user - signing in, or choosing a control
server - cannot be done headlessly, so the handler raises the window instead of
failing silently.

## State freshness, and its hard limit

A card can only be refreshed through `formProvider.updateForm`. The
FormExtensionAbility process is not allowed to stay alive: the system reclaims
it roughly ten seconds after its last lifecycle callback, and
`@ohos.resourceschedule.backgroundTaskManager` is explicitly not importable
there. There is therefore no way for a card to poll for itself.

| Situation | Mechanism | Freshness |
| --- | --- | --- |
| App process alive (guaranteed while the VPN is up by the continuous task) | Edge-triggered push from `EntryAbility`; state changes push, traffic refreshes at most once a minute | seconds |
| Card tapped | Push immediately after the action settles | immediate |
| App process gone | The card's own periodic refresh, `updateDuration: 1` | up to 30 minutes |

`updateDuration` is one 30-minute unit rather than `setFormNextRefreshTime(5)`
because periodic refresh has a quota of 50 per card per day, and 30 minutes is
48.

## Card UI constraints

One exception inside a card blanks every card the app has, so the card is
deliberately minimal and audits clean against all five documented white-screen
causes (FAQ `faqs-form-25`):

- It imports **nothing**, which rules out the unsupported-module cause.
- It contains **no images**, which rules out the invalid image descriptor and
  shared-memory-timeout causes.
- It renders only strings the provider supplies, with `@LocalStorageProp`
  defaults of `''`, so there is no property chain or index that can throw.
- It sets no opacity.

All user-visible text is localized by the provider rather than by the card, so
the card never resolves a resource.

## Known debt

The card drives a second connect/disconnect path. `BridgeStatus.ets` keeps its
own orchestration, which is private to a large component and bound to `@State`
and `getUIContext()`; refactoring it was out of scope. The two paths share
`VpnCommandGateway` and the file protocol, and must not drift - in particular
the status vocabulary in `VpnStatusReader` and the handoff file names in
`VpnSessionController` are mirrored from the UI path on purpose. Converging
them is future work.

## Validation status

Unit tested: `node --test scripts/test-vpn-status-reader.mjs` and
`scripts/test-vpn-reconnect-supervisor.mjs`. The build and the HAP contents
were verified (the form extension, the `ohos.extension.form` metadata, the
profile and the compiled `ets/widgets.abc` are all present), and the installed
device reports the form extension in its own `<bundle>:form` process.

**Card rendering and the tap path have not been exercised on a device.** They
require adding the card to the desktop by hand.
