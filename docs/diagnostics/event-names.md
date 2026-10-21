# 诊断事件名登记表

本表是诊断事件名的受控词表。两个进程都向本表登记。UI 进程的事件写入 `diagnostic-ui-events.ndjson`。VPN 扩展进程的事件写入 `diagnostic-vpn-events.ndjson`。

检查器 `scripts/check-diagnostic-event-names.mjs` 核对成员资格。检查器核对三件事。第一，源码中的每个字面量事件名必须出现在本表。第二，本表中的每个名字必须仍在源码中使用。第三，本表每个 `file:line` 必须等于该名字在源码中的首次出现位置。行号不是自由文本。改代码后必须刷新行号。

检查器不核对含义。检查器不核对阶段。检查器读取直接传给 `recordDiagnosticEvent` 的字面量。检查器也读取传给名字含 `record` 的类成员的字面量。类成员包括 `record`、`recordEvent`、`recordFeatureDiagnosticEvent` 与 `recordSecurityDiagnostic`。检查器从成员的形参表推导事件名实参的位置。检查器不读取静态写入器 `DiagnosticEventStore.record` 的调用点。检查器也不读取由变量或模板串拼出的名字。这类调用点见 `非字面量调用点`。

## 事件名登记表

`阶段` 列取自首次出现位置。一个事件名可以在其他调用点使用别的阶段。`进程` 列按文件路径判定。`vpnextensionability/` 下的文件属于 VPN 扩展进程。其余文件属于 UI 进程。

| 事件名 | 阶段 | 首次出现位置 | 进程 |
| --- | --- | --- | --- |
| `app_lock_auth_completed` | passed | `entry/src/main/ets/components/BridgeStatus.ets:1363` | UI |
| `app_lock_auth_failed` | exception | `entry/src/main/ets/components/BridgeStatus.ets:1373` | UI |
| `app_lock_auth_started` | foreground | `entry/src/main/ets/components/BridgeStatus.ets:1351` | UI |
| `app_lock_setting_auth_completed` | rejected | `entry/src/main/ets/components/BridgeStatus.ets:1396` | UI |
| `app_lock_setting_auth_started` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1387` | UI |
| `app_lock_setting_failed` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1407` | UI |
| `app_lock_setting_saved` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1404` | UI |
| `appearance_background_changed` | cleared | `entry/src/main/ets/components/BridgeStatus.ets:5526` | UI |
| `appearance_background_failed` | picker | `entry/src/main/ets/components/BridgeStatus.ets:5764` | UI |
| `appearance_glow_changed` | level | `entry/src/main/ets/components/BridgeStatus.ets:5075` | UI |
| `appearance_home_layout_changed` | `mode` | `entry/src/main/ets/components/BridgeStatus.ets:5562` | UI |
| `appearance_immersive_color_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:5520` | UI |
| `backend_recovery_completed` | connect_preflight | `entry/src/main/ets/components/BridgeStatus.ets:2517` |
| `backend_recovery_failed` | connect_preflight | `entry/src/main/ets/components/BridgeStatus.ets:2521` |
| `backend_recovery_requested` | connect_preflight、vpn_process_lost | `entry/src/main/ets/components/BridgeStatus.ets:2508` |
| `backend_restart_deferred` | fast_reconnect_window | `entry/src/main/ets/components/BridgeStatus.ets:2369` |
| `backend_restart_deferred_completed` | timeout | `entry/src/main/ets/components/BridgeStatus.ets:2376` |
| `backend_start_failed` | start | `entry/src/main/ets/components/BridgeStatus.ets:1868` |
| `backend_start_requested` | visible、silent | `entry/src/main/ets/components/BridgeStatus.ets:1863` |
| `background_entered` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:174` | UI |
| `background_listener_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:130` | UI |
| `background_notification_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:416` |
| `background_operation_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:246` | UI |
| `background_protection_restored` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:187` | UI |
| `background_resumed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:116` | UI |
| `background_special_scenario_denied` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:348` | UI |
| `background_special_scenario_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:363` | UI |
| `background_special_scenario_unconfigured` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:328` | UI |
| `background_special_scenario_unsupported` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:340` | UI |
| `background_started` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:304` | UI |
| `background_started_special_scenario` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:360` |
| `background_status_timeout` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:242` | UI |
| `background_stop_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:379` |
| `background_stopped` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:377` |
| `background_suspend_listener_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:136` | UI |
| `background_suspended` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:116` | UI |
| `background_system_cancelled` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:105` | UI |
| `background_user_cancelled_kept_vpn` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:102` | UI |
| `connect_requested` | preflight | `entry/src/main/ets/components/BridgeStatus.ets:2458` |
| `control_probe_skipped` | backend_selection | `entry/src/main/ets/components/BridgeStatus.ets:2301` |
| `control_server_confirm_blocked` | connected | `entry/src/main/ets/components/BridgeStatus.ets:1733` |
| `control_server_confirm_failed` | invalid、storage | `entry/src/main/ets/components/BridgeStatus.ets:1739` |
| `control_server_confirmed` | official、custom | `entry/src/main/ets/components/BridgeStatus.ets:1785` |
| `control_server_editor_closed` | account | `entry/src/main/ets/components/BridgeStatus.ets:1726` |
| `control_server_editor_opened` | account | `entry/src/main/ets/components/BridgeStatus.ets:1726` |
| `control_server_http_risk_cancelled` | confirmation | `entry/src/main/ets/components/BridgeStatus.ets:1760` |
| `control_server_http_risk_shown` | confirmation | `entry/src/main/ets/components/BridgeStatus.ets:1768` |
| `control_server_tip_shown` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1506` |
| `device_list_scroll_verification_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:5348` | UI |
| `device_list_scroll_verification_clicked` | `peer.key` | `entry/src/main/ets/components/BridgeStatus.ets:5364` | UI |
| `device_list_scroll_verification_opened` | home | `entry/src/main/ets/components/BridgeStatus.ets:5358` | UI |
| `diagnostic_crash_simulation_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14937` |
| `diagnostic_crash_simulation_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14912` |
| `diagnostic_crash_simulation_staged` | abort | `entry/src/main/ets/components/BridgeStatus.ets:14929` |
| `diagnostic_first_run_reset_completed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14827` |
| `diagnostic_first_run_reset_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14837` |
| `diagnostic_first_run_reset_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14777` |
| `diagnostic_module_changed` | `${feature}_${enabled ? 'enabled' : 'disabled'}` | `entry/src/main/ets/components/BridgeStatus.ets:11244` | UI |
| `diagnostic_report_failed` | generate | `entry/src/main/ets/components/BridgeStatus.ets:4389` |
| `diagnostic_report_generated` | share | `entry/src/main/ets/components/BridgeStatus.ets:4378` |
| `diagnostic_report_requested` | generate | `entry/src/main/ets/components/BridgeStatus.ets:4319` |
| `diagnostic_share_opened` | system | `entry/src/main/ets/components/BridgeStatus.ets:4383` |
| `diagnostic_vpn_cut_completed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14866` |
| `diagnostic_vpn_cut_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14880` |
| `diagnostic_vpn_cut_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14851` |
| `disconnect_completed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2648` |
| `disconnect_failed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2665` |
| `disconnect_requested` | user | `entry/src/main/ets/components/BridgeStatus.ets:2587` |
| `fake_media_service_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:12241` | UI |
| `fast_reconnect_config_failed` | backend_config | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1094` |
| `fast_reconnect_config_staged` | disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1103` |
| `fast_reconnect_failed` | persistence | `entry/src/main/ets/components/BridgeStatus.ets:2352` |
| `fast_reconnect_used` | cached_config | `entry/src/main/ets/components/BridgeStatus.ets:2356` |
| `feature_diagnostics_refresh_completed` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11329` | UI |
| `feature_diagnostics_refresh_failed` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11338` | UI |
| `feature_diagnostics_refresh_started` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11316` | UI |
| `feature_diagnostics_unlocked` | settings | `entry/src/main/ets/components/BridgeStatus.ets:5011` | UI |
| `feedback_email_opened` | about | `entry/src/main/ets/components/BridgeStatus.ets:1497` |
| `folder_access_auth_completed` | passed | `entry/src/main/ets/components/TaildriveBrowser.ets:719` | UI |
| `folder_access_auth_started` | protected_folder | `entry/src/main/ets/components/TaildriveBrowser.ets:712` | UI |
| `folder_lock_setting_auth_completed` | rejected | `entry/src/main/ets/components/BridgeStatus.ets:1435` | UI |
| `folder_lock_setting_auth_started` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1426` | UI |
| `folder_lock_setting_failed` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1444` | UI |
| `folder_lock_setting_saved` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1441` | UI |
| `folder_policy_auth_completed` | failed | `entry/src/main/ets/components/TaildriveBrowser.ets:825` | UI |
| `folder_policy_auth_started` | `operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:818` | UI |
| `folder_policy_change_failed` | `operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:836` | UI |
| `folder_policy_changed` | `operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:834` | UI |
| `folder_policy_reconcile_failed` | `request.operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:794` | UI |
| `folder_policy_reconciled` | `request.operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:789` | UI |
| `hosplayer_contract_copied` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6584` | UI |
| `hosplayer_contract_failed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6587` | UI |
| `hosplayer_contract_rejected` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6526` | UI |
| `hosplayer_launch_attempt` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6493` | UI |
| `hosplayer_launch_failed` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6516` | UI |
| `hosplayer_launch_success` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6508` | UI |
| `localsend_launch_attempt` | explicit_want | `entry/src/main/ets/components/BridgeStatus.ets:5890` | UI |
| `localsend_launch_failed` | explicit_want | `entry/src/main/ets/components/BridgeStatus.ets:5900` | UI |
| `localsend_launch_success` | explicit_want | `entry/src/main/ets/components/BridgeStatus.ets:5896` | UI |
| `media_probe_available` | service_confirmed | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1237` |
| `media_probe_completed` | no_service | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1237` |
| `media_probe_failed` | exception、extension、request_parse | `entry/src/main/ets/components/BridgeStatus.ets:6293` |
| `media_probe_no_service` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5996` |
| `media_probe_rejected` | invalid_request | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1226` |
| `media_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6249` |
| `media_probe_started` | requested | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1230` |
| `media_probe_success` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5996` |
| `media_self_test_failed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6560` |
| `media_self_test_passed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6560` | UI |
| `media_self_test_started` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6546` | UI |
| `media_service_detected` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6276` |
| `moonlight_launch_attempt` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6419` |
| `moonlight_launch_failed` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6454` |
| `moonlight_launch_success` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6449` |
| `peer_path_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6342` |
| `peer_path_result` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5993` |
| `peer_service_refresh_failed` | exception | `entry/src/main/ets/components/BridgeStatus.ets:6020` |
| `peer_service_refresh_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6041` |
| `secure_login_browser_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2278` |
| `secure_login_browser_open_link_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2218` |
| `secure_login_browser_opened` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2270` |
| `secure_login_browser_type_error` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2197` |
| `secure_login_browser_type_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2192` |
| `secure_login_browser_type_fallback` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2209` |
| `security_self_test_failed` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11361` |
| `security_self_test_passed` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11361` | UI |
| `security_self_test_started` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11354` | UI |
| `service_status_changed` | `receiverState` | `entry/src/main/ets/components/BridgeStatus.ets:11228` |
| `sunshine_probe_failed` | `sunshine.state`、exception | `entry/src/main/ets/components/BridgeStatus.ets:5994` |
| `sunshine_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6341` |
| `sunshine_probe_success` | `sunshine.state` | `entry/src/main/ets/components/BridgeStatus.ets:5994` |
| `sunshine_probe_timeout` | `sunshine.state` | `entry/src/main/ets/components/BridgeStatus.ets:5994` |
| `taildrop_file_cache_ready` | `result.name` | `entry/src/main/ets/components/BridgeStatus.ets:8691` |
| `taildrop_media_asset_create_failed` | creation_dialog | `entry/src/main/ets/components/BridgeStatus.ets:9206` |
| `taildrop_media_mtime_restored` | video | `entry/src/main/ets/components/BridgeStatus.ets:9218` |
| `taildrop_media_preview_failed` | `reason` | `entry/src/main/ets/components/BridgeStatus.ets:9513` |
| `taildrop_media_preview_ready` | `result.name` | `entry/src/main/ets/components/BridgeStatus.ets:8668` |
| `taildrop_media_ready_for_save` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8713` |
| `taildrop_media_receive_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8383` |
| `taildrop_media_save_failed` | `extension.length > 0 ? `${mediaKind}_${extension}` : mediaKind` | `entry/src/main/ets/components/BridgeStatus.ets:9024` |
| `taildrop_media_save_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8917` |
| `taildrop_media_saved_to_gallery` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9233` |
| `taildrop_pending_delete_completed` | reconnect | `entry/src/main/ets/components/BridgeStatus.ets:8888` |
| `taildrop_pending_delete_deferred` | `reason` | `entry/src/main/ets/components/BridgeStatus.ets:8894` |
| `taildrop_pending_delete_requested` | reconnect | `entry/src/main/ets/components/BridgeStatus.ets:8877` |
| `taildrop_receive_cache_clear_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8522` |
| `taildrop_receive_cache_cleared` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8779` |
| `taildrop_receive_completed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9437` |
| `taildrop_receive_delete_deferred` | `result.reason`、request_unavailable、`reason` | `entry/src/main/ets/components/BridgeStatus.ets:8623` |
| `taildrop_receive_delete_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1530` |
| `taildrop_receive_discard_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8460` |
| `taildrop_receive_discarded` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9466` |
| `taildrop_receive_failed` | clear_failed、`reason`、extension_error | `entry/src/main/ets/components/BridgeStatus.ets:8515` |
| `taildrop_receive_inbox_unavailable` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8362` |
| `taildrop_receive_invalid_busy_state` | timeout | `entry/src/main/ets/components/BridgeStatus.ets:8531` |
| `taildrop_receive_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8383` |
| `taildrop_receive_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1530` |
| `taildrop_receive_submit_failed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8158` |
| `taildrop_receive_timeout` | `this.taildropReceive.state` | `entry/src/main/ets/components/BridgeStatus.ets:8550` |
| `taildrop_send_cancel_failed` | extension_error | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1463` |
| `taildrop_send_cancel_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8127` |
| `taildrop_send_cancelled` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1461` |
| `taildrop_send_completed` | `result.reason` | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1732` |
| `taildrop_send_failed` | invalid_result、`result.reason`、extension_error | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1728` |
| `taildrop_send_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8106` |
| `taildrop_send_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1720` |
| `taildrop_text_preview_ready` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8730` |
| `taildrop_text_preview_submit_failed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8202` |
| `taildrop_thumbnail_failed` | imagekit、video | `entry/src/main/ets/components/BridgeStatus.ets:7406` |
| `taildrop_thumbnail_unavailable` | image、video | `entry/src/main/ets/components/BridgeStatus.ets:8647` |
| `ui_opened` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1006` |
| `ui_probes_paused` | power | `entry/src/main/ets/components/BridgeStatus.ets:1116` | UI |
| `update_changelog_dismissed` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1234` |
| `update_changelog_only_on_update` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1232` |
| `update_changelog_opened` | settings | `entry/src/main/ets/components/BridgeStatus.ets:5052` |
| `update_changelog_shown` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1225` |
| `vpn_backend_handoff_request_failed` | vpn_handoff | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:631` |
| `vpn_backend_handoff_request_invalid` | vpn_handoff | `entry/src/main/ets/services/VpnSessionController.ets:223` | UI |
| `vpn_backend_handoff_stop_failed` | vpn_handoff | `entry/src/main/ets/components/BridgeStatus.ets:3515` |
| `vpn_backend_handoff_stopped` | vpn_handoff | `entry/src/main/ets/components/BridgeStatus.ets:3515` |
| `vpn_backend_handoff_timeout` | vpn_handoff | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:655` |
| `vpn_backend_stop_failed` | disconnect、destroy | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1081` |
| `vpn_backend_stop_timeout` | disconnect | `entry/src/main/ets/components/BridgeStatus.ets:2605` |
| `vpn_backend_stopped` | disconnect、destroy | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1081` |
| `vpn_config_handoff_failed` | persistence | `entry/src/main/ets/components/BridgeStatus.ets:2486` |
| `vpn_config_handoff_fallback` | backend_restore | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:720` |
| `vpn_config_handoff_staged` | preflight | `entry/src/main/ets/components/BridgeStatus.ets:2484` |
| `vpn_config_handoff_used` | preflight | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:717` |
| `vpn_conflict` | create | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:574` |
| `vpn_conflict_acknowledged` | dialog | `entry/src/main/ets/components/BridgeStatus.ets:4454` |
| `vpn_conflict_confirm_disconnect_completed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4459` |
| `vpn_conflict_confirm_disconnect_failed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4463` |
| `vpn_conflict_confirm_disconnect_requested` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4456` |
| `vpn_conflict_detected` | connect | `entry/src/main/ets/components/BridgeStatus.ets:4404` |
| `vpn_conflict_self_disconnect_completed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4426` |
| `vpn_conflict_self_disconnect_failed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4416` |
| `vpn_conflict_self_disconnect_requested` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4412` |
| `vpn_connected` | backend | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:554` |
| `vpn_control_server_missing` | preflight | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:407` |
| `vpn_create_failed` | extension、create、replace | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:388` |
| `vpn_drop_after_requested_stop` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:150` | UI |
| `vpn_extension_created` | lifecycle | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:348` |
| `vpn_extension_destroyed` | lifecycle | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1945` |
| `vpn_failed_extension_stop_failed` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3564` |
| `vpn_failed_extension_stop_requested` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3548` |
| `vpn_failed_extension_stopped` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3555` |
| `vpn_network_monitor_failed` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:90` | UI |
| `vpn_network_monitor_started` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:95` | UI |
| `vpn_network_offline` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:172` | UI |
| `vpn_network_refresh_failed` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:178` | UI |
| `vpn_preflight_failed` | backend_config、exception | `entry/src/main/ets/components/BridgeStatus.ets:2476` |
| `vpn_process_protect_failed` | network | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:530` |
| `vpn_process_protected` | network | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:526` |
| `vpn_session_end_observed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:283` | UI |
| `vpn_session_recovered` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:140` | UI |
| `vpn_session_recovery_attempt` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:289` | UI |
| `vpn_session_recovery_cancelled` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:309` | UI |
| `vpn_session_recovery_deferred` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:238` | UI |
| `vpn_session_recovery_failed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:344` | UI |
| `vpn_session_recovery_needs_ui` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:191` | UI |
| `vpn_session_recovery_started` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:330` | UI |
| `vpn_session_recovery_superseded` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:315` | UI |
| `vpn_session_recovery_undo_failed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:320` | UI |
| `vpn_snapshot_unavailable` | status | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:915` |
| `vpn_start_failed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2557` |
| `vpn_start_requested` | system | `entry/src/main/ets/components/BridgeStatus.ets:2549` |
| `vpn_status_grace_expired` | heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3579` |
| `vpn_status_grace_recovered` | heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3410` |
| `vpn_status_grace_started` | tun_transition、heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3598` |
| `vpn_stop_requested` | system | `entry/src/main/ets/services/VpnSessionController.ets:200` | UI |
| `vpn_tun_created` | create | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:521` |
| `vpn_tun_destroy_failed` | cleanup、disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:676` |
| `vpn_tun_destroyed` | disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1072` |
| `welcome_dialog_acknowledged` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1484` |
| `welcome_dialog_shown` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1491` |

## 非字面量调用点

检查器不能静态读取以下调用点的事件名实参。检查器不登记这些调用点拼出的名字。

- `entry/src/main/ets/components/BridgeStatus.ets:11089`：事件名实参是变量 `safeEvent`。该处是 `recordFeatureDiagnosticEvent` 的转发点。转发点上游的调用者用字面量，检查器看得到。
- `entry/src/main/ets/services/VpnNetworkMonitor.ets:172`：事件名实参是三元表达式。字面分支 `vpn_network_offline` 已登记。另一个分支是模板串 `vpn_network_rebound_${network.bearer}`，检查器不登记它拼出的名字。
- `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:327`：事件名实参是变量 `event`。
- `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1510`：事件名实参是三元表达式。字面分支 `taildrop_receive_failed` 已登记。另一个分支是模板串 `taildrop_receive_${persisted.state}`，检查器不登记它拼出的名字。

- `entry/src/main/ets/services/VpnSessionIntent.ets:136`：`vpn_intent_missing` 与 `vpn_intent_write_failed` 直接传给静态写入器 `DiagnosticEventStore.record`。检查器不读取静态写入器调用点；两者手动登记在此。
- `entry/src/main/ets/services/VpnPowerPolicy.ets:156`：`vpn_power_stage_missing`、`vpn_power_stage_changed` 与 `vpn_power_stage_write_failed` 直接传给静态写入器。检查器不读取静态写入器调用点；三者手动登记在此。
- `entry/src/main/ets/services/SessionLedger.ets:175`：事件名是三元表达式，`vpn_session_end` 由此写入。`vpn_session_end_observed` 另有字面量调用点（重连监督器），已登记。

## 新增事件名

按以下步骤增加一个事件名。

1. 选定名字。名字只用小写字母、数字和下划线。
2. 在调用点写字符串字面量。不要用变量拼名字。
3. 在本表的 `事件名登记表` 中加一行。填写四列：事件名、阶段、首次出现位置、进程。
4. 运行 `node scripts/check-diagnostic-event-names.mjs`。退出码 0 表示通过。

如果新名字只在非字面量调用点出现，检查器不会发现它。此时在第 3 步手动登记，并在 `非字面量调用点` 一节说明原因。
