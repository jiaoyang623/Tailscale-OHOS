# 诊断事件名登记表

本表是诊断事件名的受控词表。两个进程都向本表登记。UI 进程的事件写入 `diagnostic-ui-events.ndjson`。VPN 扩展进程的事件写入 `diagnostic-vpn-events.ndjson`。

检查器 `scripts/check-diagnostic-event-names.mjs` 核对成员资格。检查器核对三件事。第一，源码中的每个字面量事件名必须出现在本表。第二，本表中的每个名字必须仍在源码中使用。第三，本表每个 `file:line` 必须等于该名字在源码中的首次出现位置。行号不是自由文本。改代码后必须刷新行号。

检查器不核对含义。检查器不核对阶段。检查器读取直接传给 `recordDiagnosticEvent` 的字面量。检查器也读取传给名字含 `record` 的类成员的字面量。类成员包括 `record`、`recordEvent`、`recordFeatureDiagnosticEvent` 与 `recordSecurityDiagnostic`。检查器从成员的形参表推导事件名实参的位置。检查器不读取静态写入器 `DiagnosticEventStore.record` 的调用点。检查器也不读取由变量或模板串拼出的名字。这类调用点见 `非字面量调用点`。

## 事件名登记表

`阶段` 列取自首次出现位置。一个事件名可以在其他调用点使用别的阶段。`进程` 列按文件路径判定。`vpnextensionability/` 下的文件属于 VPN 扩展进程。其余文件属于 UI 进程。

| 事件名 | 阶段 | 首次出现位置 | 进程 |
| --- | --- | --- | --- |
| `app_lock_auth_completed` | passed | `entry/src/main/ets/components/BridgeStatus.ets:1313` | UI |
| `app_lock_auth_failed` | exception | `entry/src/main/ets/components/BridgeStatus.ets:1323` | UI |
| `app_lock_auth_started` | foreground | `entry/src/main/ets/components/BridgeStatus.ets:1301` | UI |
| `app_lock_setting_auth_completed` | rejected | `entry/src/main/ets/components/BridgeStatus.ets:1346` | UI |
| `app_lock_setting_auth_started` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1337` | UI |
| `app_lock_setting_failed` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1357` | UI |
| `app_lock_setting_saved` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1354` | UI |
| `appearance_background_changed` | cleared | `entry/src/main/ets/components/BridgeStatus.ets:5452` | UI |
| `appearance_background_failed` | picker | `entry/src/main/ets/components/BridgeStatus.ets:5690` | UI |
| `appearance_glow_changed` | level | `entry/src/main/ets/components/BridgeStatus.ets:5001` | UI |
| `appearance_home_layout_changed` | `mode` | `entry/src/main/ets/components/BridgeStatus.ets:5488` | UI |
| `appearance_immersive_color_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:5446` | UI |
| `backend_recovery_completed` | connect_preflight | `entry/src/main/ets/components/BridgeStatus.ets:2463` |
| `backend_recovery_failed` | connect_preflight | `entry/src/main/ets/components/BridgeStatus.ets:2467` |
| `backend_recovery_requested` | connect_preflight、vpn_process_lost | `entry/src/main/ets/components/BridgeStatus.ets:2454` |
| `backend_restart_deferred` | fast_reconnect_window | `entry/src/main/ets/components/BridgeStatus.ets:2319` |
| `backend_restart_deferred_completed` | timeout | `entry/src/main/ets/components/BridgeStatus.ets:2326` |
| `backend_start_failed` | start | `entry/src/main/ets/components/BridgeStatus.ets:1818` |
| `backend_start_requested` | visible、silent | `entry/src/main/ets/components/BridgeStatus.ets:1813` |
| `background_entered` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:140` | UI |
| `background_listener_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:97` | UI |
| `background_notification_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:348` |
| `background_operation_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:190` | UI |
| `background_resumed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:83` | UI |
| `background_special_scenario_denied` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:280` | UI |
| `background_special_scenario_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:295` | UI |
| `background_special_scenario_unconfigured` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:260` | UI |
| `background_special_scenario_unsupported` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:272` | UI |
| `background_started` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:236` | UI |
| `background_started_special_scenario` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:292` |
| `background_status_timeout` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:176` | UI |
| `background_stop_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:311` |
| `background_stopped` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:309` |
| `background_suspend_listener_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:103` | UI |
| `background_suspended` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:83` | UI |
| `background_system_cancelled` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:73` | UI |
| `background_user_cancelled` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:73` | UI |
| `connect_requested` | preflight | `entry/src/main/ets/components/BridgeStatus.ets:2404` |
| `control_probe_skipped` | backend_selection | `entry/src/main/ets/components/BridgeStatus.ets:2251` |
| `control_server_confirm_blocked` | connected | `entry/src/main/ets/components/BridgeStatus.ets:1683` |
| `control_server_confirm_failed` | invalid、storage | `entry/src/main/ets/components/BridgeStatus.ets:1689` |
| `control_server_confirmed` | official、custom | `entry/src/main/ets/components/BridgeStatus.ets:1735` |
| `control_server_editor_closed` | account | `entry/src/main/ets/components/BridgeStatus.ets:1676` |
| `control_server_editor_opened` | account | `entry/src/main/ets/components/BridgeStatus.ets:1676` |
| `control_server_http_risk_cancelled` | confirmation | `entry/src/main/ets/components/BridgeStatus.ets:1710` |
| `control_server_http_risk_shown` | confirmation | `entry/src/main/ets/components/BridgeStatus.ets:1718` |
| `control_server_tip_shown` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1456` |
| `device_list_scroll_verification_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:5274` | UI |
| `device_list_scroll_verification_clicked` | `peer.key` | `entry/src/main/ets/components/BridgeStatus.ets:5290` | UI |
| `device_list_scroll_verification_opened` | home | `entry/src/main/ets/components/BridgeStatus.ets:5284` | UI |
| `diagnostic_crash_simulation_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14863` |
| `diagnostic_crash_simulation_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14838` |
| `diagnostic_crash_simulation_staged` | abort | `entry/src/main/ets/components/BridgeStatus.ets:14855` |
| `diagnostic_first_run_reset_completed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14753` |
| `diagnostic_first_run_reset_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14763` |
| `diagnostic_first_run_reset_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14703` |
| `diagnostic_module_changed` | `${feature}_${enabled ? 'enabled' : 'disabled'}` | `entry/src/main/ets/components/BridgeStatus.ets:11170` | UI |
| `diagnostic_report_failed` | generate | `entry/src/main/ets/components/BridgeStatus.ets:4315` |
| `diagnostic_report_generated` | share | `entry/src/main/ets/components/BridgeStatus.ets:4304` |
| `diagnostic_report_requested` | generate | `entry/src/main/ets/components/BridgeStatus.ets:4245` |
| `diagnostic_share_opened` | system | `entry/src/main/ets/components/BridgeStatus.ets:4309` |
| `diagnostic_vpn_cut_completed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14792` |
| `diagnostic_vpn_cut_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14806` |
| `diagnostic_vpn_cut_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14777` |
| `disconnect_completed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2588` |
| `disconnect_failed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2605` |
| `disconnect_requested` | user | `entry/src/main/ets/components/BridgeStatus.ets:2526` |
| `fake_media_service_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:12167` | UI |
| `fast_reconnect_config_failed` | backend_config | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1065` |
| `fast_reconnect_config_staged` | disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1074` |
| `fast_reconnect_failed` | persistence | `entry/src/main/ets/components/BridgeStatus.ets:2302` |
| `fast_reconnect_used` | cached_config | `entry/src/main/ets/components/BridgeStatus.ets:2306` |
| `feature_diagnostics_refresh_completed` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11255` | UI |
| `feature_diagnostics_refresh_failed` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11264` | UI |
| `feature_diagnostics_refresh_started` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11242` | UI |
| `feature_diagnostics_unlocked` | settings | `entry/src/main/ets/components/BridgeStatus.ets:4937` | UI |
| `feedback_email_opened` | about | `entry/src/main/ets/components/BridgeStatus.ets:1447` |
| `folder_access_auth_completed` | passed | `entry/src/main/ets/components/TaildriveBrowser.ets:719` | UI |
| `folder_access_auth_started` | protected_folder | `entry/src/main/ets/components/TaildriveBrowser.ets:712` | UI |
| `folder_lock_setting_auth_completed` | rejected | `entry/src/main/ets/components/BridgeStatus.ets:1385` | UI |
| `folder_lock_setting_auth_started` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1376` | UI |
| `folder_lock_setting_failed` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1394` | UI |
| `folder_lock_setting_saved` | `phase` | `entry/src/main/ets/components/BridgeStatus.ets:1391` | UI |
| `folder_policy_auth_completed` | failed | `entry/src/main/ets/components/TaildriveBrowser.ets:825` | UI |
| `folder_policy_auth_started` | `operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:818` | UI |
| `folder_policy_change_failed` | `operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:836` | UI |
| `folder_policy_changed` | `operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:834` | UI |
| `folder_policy_reconcile_failed` | `request.operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:794` | UI |
| `folder_policy_reconciled` | `request.operation` | `entry/src/main/ets/components/TaildriveBrowser.ets:789` | UI |
| `hosplayer_contract_copied` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6510` | UI |
| `hosplayer_contract_failed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6513` | UI |
| `hosplayer_contract_rejected` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6452` | UI |
| `hosplayer_launch_attempt` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6419` | UI |
| `hosplayer_launch_failed` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6442` | UI |
| `hosplayer_launch_success` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6434` | UI |
| `localsend_launch_attempt` | explicit_want | `entry/src/main/ets/components/BridgeStatus.ets:5816` | UI |
| `localsend_launch_failed` | explicit_want | `entry/src/main/ets/components/BridgeStatus.ets:5826` | UI |
| `localsend_launch_success` | explicit_want | `entry/src/main/ets/components/BridgeStatus.ets:5822` | UI |
| `media_probe_available` | service_confirmed | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1208` |
| `media_probe_completed` | no_service | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1208` |
| `media_probe_failed` | exception、extension、request_parse | `entry/src/main/ets/components/BridgeStatus.ets:6219` |
| `media_probe_no_service` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5922` |
| `media_probe_rejected` | invalid_request | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1197` |
| `media_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6175` |
| `media_probe_started` | requested | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1201` |
| `media_probe_success` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5922` |
| `media_self_test_failed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6486` |
| `media_self_test_passed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6486` | UI |
| `media_self_test_started` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6472` | UI |
| `media_service_detected` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6202` |
| `moonlight_launch_attempt` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6345` |
| `moonlight_launch_failed` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6380` |
| `moonlight_launch_success` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6375` |
| `peer_path_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6268` |
| `peer_path_result` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5919` |
| `peer_service_refresh_failed` | exception | `entry/src/main/ets/components/BridgeStatus.ets:5946` |
| `peer_service_refresh_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:5967` |
| `secure_login_browser_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2228` |
| `secure_login_browser_open_link_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2168` |
| `secure_login_browser_opened` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2220` |
| `secure_login_browser_type_error` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2147` |
| `secure_login_browser_type_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2142` |
| `secure_login_browser_type_fallback` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2159` |
| `security_self_test_failed` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11287` |
| `security_self_test_passed` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11287` | UI |
| `security_self_test_started` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11280` | UI |
| `service_status_changed` | `receiverState` | `entry/src/main/ets/components/BridgeStatus.ets:11154` |
| `sunshine_probe_failed` | `sunshine.state`、exception | `entry/src/main/ets/components/BridgeStatus.ets:5920` |
| `sunshine_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6267` |
| `sunshine_probe_success` | `sunshine.state` | `entry/src/main/ets/components/BridgeStatus.ets:5920` |
| `sunshine_probe_timeout` | `sunshine.state` | `entry/src/main/ets/components/BridgeStatus.ets:5920` |
| `taildrop_file_cache_ready` | `result.name` | `entry/src/main/ets/components/BridgeStatus.ets:8617` |
| `taildrop_media_asset_create_failed` | creation_dialog | `entry/src/main/ets/components/BridgeStatus.ets:9132` |
| `taildrop_media_mtime_restored` | video | `entry/src/main/ets/components/BridgeStatus.ets:9144` |
| `taildrop_media_preview_failed` | `reason` | `entry/src/main/ets/components/BridgeStatus.ets:9439` |
| `taildrop_media_preview_ready` | `result.name` | `entry/src/main/ets/components/BridgeStatus.ets:8594` |
| `taildrop_media_ready_for_save` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8639` |
| `taildrop_media_receive_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8309` |
| `taildrop_media_save_failed` | `extension.length > 0 ? `${mediaKind}_${extension}` : mediaKind` | `entry/src/main/ets/components/BridgeStatus.ets:8950` |
| `taildrop_media_save_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8843` |
| `taildrop_media_saved_to_gallery` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9159` |
| `taildrop_pending_delete_completed` | reconnect | `entry/src/main/ets/components/BridgeStatus.ets:8814` |
| `taildrop_pending_delete_deferred` | `reason` | `entry/src/main/ets/components/BridgeStatus.ets:8820` |
| `taildrop_pending_delete_requested` | reconnect | `entry/src/main/ets/components/BridgeStatus.ets:8803` |
| `taildrop_receive_cache_clear_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8448` |
| `taildrop_receive_cache_cleared` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8705` |
| `taildrop_receive_completed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9363` |
| `taildrop_receive_delete_deferred` | `result.reason`、request_unavailable、`reason` | `entry/src/main/ets/components/BridgeStatus.ets:8549` |
| `taildrop_receive_delete_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1501` |
| `taildrop_receive_discard_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8386` |
| `taildrop_receive_discarded` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9392` |
| `taildrop_receive_failed` | clear_failed、`reason`、extension_error | `entry/src/main/ets/components/BridgeStatus.ets:8441` |
| `taildrop_receive_inbox_unavailable` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8288` |
| `taildrop_receive_invalid_busy_state` | timeout | `entry/src/main/ets/components/BridgeStatus.ets:8457` |
| `taildrop_receive_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8309` |
| `taildrop_receive_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1501` |
| `taildrop_receive_submit_failed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8084` |
| `taildrop_receive_timeout` | `this.taildropReceive.state` | `entry/src/main/ets/components/BridgeStatus.ets:8476` |
| `taildrop_send_cancel_failed` | extension_error | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1434` |
| `taildrop_send_cancel_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8053` |
| `taildrop_send_cancelled` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1432` |
| `taildrop_send_completed` | `result.reason` | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1703` |
| `taildrop_send_failed` | invalid_result、`result.reason`、extension_error | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1699` |
| `taildrop_send_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8032` |
| `taildrop_send_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1691` |
| `taildrop_text_preview_ready` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8656` |
| `taildrop_text_preview_submit_failed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8128` |
| `taildrop_thumbnail_failed` | imagekit、video | `entry/src/main/ets/components/BridgeStatus.ets:7332` |
| `taildrop_thumbnail_unavailable` | image、video | `entry/src/main/ets/components/BridgeStatus.ets:8573` |
| `ui_opened` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:987` |
| `update_changelog_dismissed` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1184` |
| `update_changelog_only_on_update` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1182` |
| `update_changelog_opened` | settings | `entry/src/main/ets/components/BridgeStatus.ets:4978` |
| `update_changelog_shown` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1175` |
| `vpn_backend_handoff_request_failed` | vpn_handoff | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:621` |
| `vpn_backend_handoff_request_invalid` | vpn_handoff | `entry/src/main/ets/services/VpnSessionController.ets:175` | UI |
| `vpn_backend_handoff_stop_failed` | vpn_handoff | `entry/src/main/ets/components/BridgeStatus.ets:3441` |
| `vpn_backend_handoff_stopped` | vpn_handoff | `entry/src/main/ets/components/BridgeStatus.ets:3441` |
| `vpn_backend_handoff_timeout` | vpn_handoff | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:645` |
| `vpn_backend_stop_failed` | disconnect、destroy | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1052` |
| `vpn_backend_stop_timeout` | disconnect | `entry/src/main/ets/components/BridgeStatus.ets:2545` |
| `vpn_backend_stopped` | disconnect、destroy | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1052` |
| `vpn_config_handoff_failed` | persistence | `entry/src/main/ets/components/BridgeStatus.ets:2432` |
| `vpn_config_handoff_fallback` | backend_restore | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:708` |
| `vpn_config_handoff_staged` | preflight | `entry/src/main/ets/components/BridgeStatus.ets:2430` |
| `vpn_config_handoff_used` | preflight | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:705` |
| `vpn_conflict` | create | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:564` |
| `vpn_conflict_acknowledged` | dialog | `entry/src/main/ets/components/BridgeStatus.ets:4380` |
| `vpn_conflict_confirm_disconnect_completed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4385` |
| `vpn_conflict_confirm_disconnect_failed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4389` |
| `vpn_conflict_confirm_disconnect_requested` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4382` |
| `vpn_conflict_detected` | connect | `entry/src/main/ets/components/BridgeStatus.ets:4330` |
| `vpn_conflict_self_disconnect_completed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4352` |
| `vpn_conflict_self_disconnect_failed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4342` |
| `vpn_conflict_self_disconnect_requested` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4338` |
| `vpn_connected` | backend | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:544` |
| `vpn_control_server_missing` | preflight | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:397` |
| `vpn_create_failed` | extension、create、replace | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:378` |
| `vpn_drop_after_requested_stop` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:119` | UI |
| `vpn_drop_ignored_foreground` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:126` | UI |
| `vpn_extension_created` | lifecycle | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:338` |
| `vpn_extension_destroyed` | lifecycle | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1912` |
| `vpn_failed_extension_stop_failed` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3490` |
| `vpn_failed_extension_stop_requested` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3474` |
| `vpn_failed_extension_stopped` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3481` |
| `vpn_network_monitor_failed` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:90` | UI |
| `vpn_network_monitor_started` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:95` | UI |
| `vpn_network_offline` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:172` | UI |
| `vpn_network_refresh_failed` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:178` | UI |
| `vpn_preflight_failed` | backend_config、exception | `entry/src/main/ets/components/BridgeStatus.ets:2422` |
| `vpn_process_protect_failed` | network | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:520` |
| `vpn_process_protected` | network | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:516` |
| `vpn_reconnect_attempt` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:138` | UI |
| `vpn_reconnect_cancelled` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:143` | UI |
| `vpn_reconnect_exhausted` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:130` | UI |
| `vpn_reconnect_failed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:159` | UI |
| `vpn_reconnect_not_started` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:156` |
| `vpn_reconnect_started` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:156` |
| `vpn_reconnect_succeeded` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:102` | UI |
| `vpn_reconnect_superseded` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:150` | UI |
| `vpn_reconnect_undo_failed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:152` | UI |
| `vpn_snapshot_unavailable` | status | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:886` |
| `vpn_start_failed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2503` |
| `vpn_start_requested` | system | `entry/src/main/ets/components/BridgeStatus.ets:2495` |
| `vpn_status_grace_expired` | heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3505` |
| `vpn_status_grace_recovered` | heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3348` |
| `vpn_status_grace_started` | tun_transition、heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3524` |
| `vpn_stop_requested` | system | `entry/src/main/ets/services/VpnSessionController.ets:152` | UI |
| `vpn_tun_created` | create | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:511` |
| `vpn_tun_destroy_failed` | cleanup、disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:664` |
| `vpn_tun_destroyed` | disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1043` |
| `welcome_dialog_acknowledged` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1434` |
| `welcome_dialog_shown` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1441` |

## 非字面量调用点

检查器不能静态读取以下调用点的事件名实参。检查器不登记这些调用点拼出的名字。

- `entry/src/main/ets/components/BridgeStatus.ets:11089`：事件名实参是变量 `safeEvent`。该处是 `recordFeatureDiagnosticEvent` 的转发点。转发点上游的调用者用字面量，检查器看得到。
- `entry/src/main/ets/services/VpnNetworkMonitor.ets:172`：事件名实参是三元表达式。字面分支 `vpn_network_offline` 已登记。另一个分支是模板串 `vpn_network_rebound_${network.bearer}`，检查器不登记它拼出的名字。
- `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:327`：事件名实参是变量 `event`。
- `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1510`：事件名实参是三元表达式。字面分支 `taildrop_receive_failed` 已登记。另一个分支是模板串 `taildrop_receive_${persisted.state}`，检查器不登记它拼出的名字。

## 新增事件名

按以下步骤增加一个事件名。

1. 选定名字。名字只用小写字母、数字和下划线。
2. 在调用点写字符串字面量。不要用变量拼名字。
3. 在本表的 `事件名登记表` 中加一行。填写四列：事件名、阶段、首次出现位置、进程。
4. 运行 `node scripts/check-diagnostic-event-names.mjs`。退出码 0 表示通过。

如果新名字只在非字面量调用点出现，检查器不会发现它。此时在第 3 步手动登记，并在 `非字面量调用点` 一节说明原因。
