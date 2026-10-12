# Background VPN reliability

## Milestone 1 — continuous task lifetime and screen-off verification

Scope: fix the existing UIAbility continuous task that protects the VPN starter
process. Preserve the VPN extension, native protocol, persisted state and user data.
The reported failure is disconnecting after several minutes locked or idle.

Official references checked through HarmonyOS Knowledge MCP:

- [VPN lifecycle](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/net-vpnextension): the system stops VPN when either its starter process or extension process exits.
- [Background tasks](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-resourceschedule-backgroundtaskmanager): Stage continuous tasks must be requested by UIAbility with `KEEP_BACKGROUND_RUNNING`. DATA_TRANSFER requires system live-view updates; missing updates for ten minutes can cancel the task. The string-array overload (API 12) returns the notification/task IDs; cancellation is available since API 15 and suspend/active events since API 20. All fit this project's API 23 minimum on phone, tablet and 2in1.
- [Notification template](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-inner-notification-notificationtemplate): downloadTemplate progress is 0–100; a VPN has no finite completion percentage. Show cumulative real traffic in notification text and leave percentage at zero, rather than fabricate download progress.

Implementation:

1. Keep the existing early foreground task acquisition. Use the returned task and notification IDs, and periodically update the same system live view with redacted traffic totals.
2. Treat missing/stale telemetry as uncertain, with a bounded grace period; explicit disconnect still releases the task promptly.
3. Serialize start/stop/update operations. Do not overwrite a cancellation received while start is pending. Honor user cancellation until a confirmed disconnect; back off system cancellation and API failures.
4. Record task creation, cancellation, suspension and cleanup errors in existing redacted diagnostics. Begin extension heartbeats before waiting for the peer probe; snapshot failures must not falsely announce a VPN failure.

Validation: deterministic lifecycle/race tests, repository debug build and artifact
checks, then a real-device background/lock test exceeding ten minutes with process,
heartbeat and peer reachability evidence. No Release build or upload in this milestone.
An attached HDC cable/charging changes power-management conditions; a passing run
does not establish indefinite survival on battery, force-stop or task removal.

### Milestone 1 results

- `node --test scripts/test-vpn-background-task.mjs`: 14 tests passed, including cancellation during start, destruction during start/publish, reconnect during stop, system retry backoff, user dismissal, stale/future/missing telemetry and live-view identity/traffic.
- Repository Debug build and Go/N-API artifact checks passed using the complete DevEco SDK `26.0.0.105`. The installed package is Debug `1.1.0` / `100000004` (the existing pending iteration's version).
- The build entry now prefers the official Hvigor wrapper and the complete DevEco SDK. Direct engine invocation with the injected IDE `NODE_PATH` failed before PreBuild; the project-local SDK copy `26.0.0.38` built but produced a runtime `@hms:collaboration.systemShare` module-resolution crash. The complete vendor SDK fixes startup without changing the sharing feature.
- Pre-lock real-device data-plane probe passed: browser-generated TUN traffic increased by 13 reads and 18 writes; the extension's peer probe was reachable.
- Uninterrupted locked idle run passed on HUAWEI Pura 80 Pro, HarmonyOS `7.0.0.105`: 721 seconds, 25 samples including the baseline, all 24 post-baseline samples in `SLEEP`, identical UI/VPN process IDs throughout, maximum heartbeat age 1,104 ms. The first run was interrupted by screen-on use and stopped; it is not counted as a continuous-lock pass. No active peer probes were sent during the uninterrupted idle interval; HDC read only process/heartbeat/power state.
- After the idle run, TSMP through WireGuard responded in 6 ms and the phone's PeerAPI HTTP endpoint responded in 8 ms. PowerManager reported the same `SLEEP` state before and after both requests, establishing network service while still asleep, beyond a UI status or process-existence check. ICMP was unavailable at the initial optional baseline; it is not used as evidence of success.
- Post-lock browser/TUN probe initially could not produce traffic while the keyguard was locked. After the user unlocked the screen, the probe passed with 16 additional TUN reads and 20 writes, and the peer probe remained reachable. The VPN app stayed in the background and both process IDs still matched the original baseline. The earlier locked TSMP/PeerAPI success is independent of this browser UI check.

The device remained attached to USB/HDC and charging. Continuous screen-off and
network service passed under those conditions; unplugged battery-only deep idle,
memory pressure, reboot and user force-stop are not covered by this run.

Reproduce the liveness test after connecting in the app, starting with the screen awake:

```powershell
node --test scripts/test-vpn-background-task.mjs
powershell -File scripts/build.ps1 -Product default
powershell -File scripts/device-vpn-data-probe.ps1
powershell -File scripts/device-background-vpn-probe.ps1 -DurationSeconds 720 -LockScreen
```

After the lock test, wake/unlock the device and rerun `device-vpn-data-probe.ps1`
to verify actual browser traffic while the VPN app remains in the background.
Redacted per-sample results are written under the ignored `.codex/background-vpn/`
directory. Do not upload app sandbox files, account state or signing materials.

## Milestone 2 — recovery after a drop, and the long-running modes that do not fit

Milestone 1 is unchanged. This milestone addresses what happens *after* a
tunnel is lost.

The reported symptom was the app being killed while in use. Device logs from
`56T0225330000021` (Pura X, HarmonyOS 7.0.0.105) say otherwise: the app process
was never killed. The only `onProcessDied` in the whole log buffer belonged to
the **VPN extension**, and it followed the system broadcast
`VPN_CONNECTION_STATUS_CHANGED, state: 0` by about two seconds, itself right
after a network change. The app then released its continuous task - which is
what Milestone 1 decided it should do - and stayed disconnected until the user
noticed. The gap was recovery, not survival.

### Drop recovery

`services/VpnReconnectSupervisor.ets` watches the same status file and, when a
connection that was up has gone, asks `VpnSessionController` to bring it back.
The trigger is deliberately narrow, because reconnecting fights the user when
it guesses wrong:

- only on `connected → disconnected`, never from `unknown`;
- only once this process has been in the background for ten seconds. A user
  disconnect requires the user to have just been looking at the app, so a drop
  that arrives after the app has been away is a real failure;
- never after a disconnect requested through an entry point we control (the
  card) - the supervisor is told directly;
- at most three attempts, backing off 30s → 60s → 120s, and only after the
  connection has held for 60 seconds is the attempt count cleared. A tunnel
  that flaps must not be able to reset the count every cycle and retry forever;
  a test pins this.

Every decision is recorded in the existing redacted diagnostics
(`vpn_reconnect_attempt`, `vpn_reconnect_succeeded`, `vpn_reconnect_exhausted`,
`vpn_drop_ignored_foreground`, `vpn_drop_after_requested_stop`), so the next
reproduction says why recovery did or did not happen. No new instrumentation was
added for the tunnel itself: `vpn_extension_created`/`_destroyed`,
`vpn_network_offline` and `vpn_conflict` already covered it.

### Long-running background modes, and why none of them fit a VPN

The platform does have first-class long-running background modes. Neither is
usable here.

| Mode | What it needs | Why not |
| --- | --- | --- |
| `MODE_TASK_KEEPING` (compute, e.g. antivirus) | Restricted permission `ohos.permission.KEEP_BACKGROUND_RUNNING_SYSTEM` on phones | The documented scenario is antivirus-like compute, not a tunnel |
| `MODE_SPECIAL_SCENARIO_PROCESSING` (API 22+) | Restricted permission, plus a sub-mode | Its only sub-modes are media processing, video broadcast and workout. There is no VPN scenario, and the docs require the scenario to match the sub-mode |

`MODE_SPECIAL_SCENARIO_PROCESSING` is the closest thing the platform has to an
Android foreground service: `requestAuthFromUser` asks the user through a
banner ("allow once" / "always allow"), `checkSpecialScenarioAuth` reads the
answer, and unlike `DATA_TRANSFER` it is not tied to a progress update every ten
minutes. The code path for it is implemented in `VpnBackgroundTaskManager`
(`startSpecialScenario`) and falls back to `DATA_TRANSFER` on any failure. It is
**inert by default**: `SPECIAL_SCENARIO_SUBMODE` is `0`, and the restricted
permission is not declared.

Declaring a restricted permission without a matching provisioning profile makes
the app **fail to install**, which is why the declaration is a switch rather
than a checked-in line: `scripts/toggle-special-scenario-acl.mjs` adds or
removes it and is idempotent. Turn it on only after AppGallery Connect approves
the permission, or while testing under a five-day trial debug profile.

### Validation

- `node --test scripts/test-vpn-reconnect-supervisor.mjs`: 9 tests, covering
  each guard above. Writing them found a real defect - the attempt counter was
  cleared on every `connected` sample, so a flapping tunnel retried forever.
- `node --test scripts/test-vpn-background-task.mjs`: 14 tests, unchanged;
  the special-scenario path is inert, so Milestone 1 behaviour is untouched.
- Repository debug build and device install verified.

**The recovery path has not been exercised against a real drop**, and the
special-scenario path has never run at all, since it needs a permission this
build does not declare. Reproduce per the Milestone 1 procedure.
