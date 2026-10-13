# 诊断事件名登记表

本表是诊断事件名的受控词表。两个进程都向本表登记。UI 进程的事件写入 `diagnostic-ui-events.ndjson`。VPN 扩展进程的事件写入 `diagnostic-vpn-events.ndjson`。

检查器 `scripts/check-diagnostic-event-names.mjs` 核对成员资格。检查器核对两件事。第一，源码中的每个字面量事件名必须出现在本表。第二，本表中的每个名字必须仍在源码中使用。

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
| `backend_recovery_completed` | connect_preflight | `entry/src/main/ets/components/BridgeStatus.ets:2454` | UI |
| `backend_recovery_failed` | connect_preflight | `entry/src/main/ets/components/BridgeStatus.ets:2458` | UI |
| `backend_recovery_requested` | connect_preflight、vpn_process_lost | `entry/src/main/ets/components/BridgeStatus.ets:2445` | UI |
| `backend_restart_deferred` | fast_reconnect_window | `entry/src/main/ets/components/BridgeStatus.ets:2310` | UI |
| `backend_restart_deferred_completed` | timeout | `entry/src/main/ets/components/BridgeStatus.ets:2317` | UI |
| `backend_start_failed` | start | `entry/src/main/ets/components/BridgeStatus.ets:1809` | UI |
| `backend_start_requested` | visible、silent | `entry/src/main/ets/components/BridgeStatus.ets:1804` | UI |
| `background_entered` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:140` | UI |
| `background_listener_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:97` | UI |
| `background_notification_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:340` | UI |
| `background_operation_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:190` | UI |
| `background_resumed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:83` | UI |
| `background_special_scenario_denied` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:280` | UI |
| `background_special_scenario_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:295` | UI |
| `background_special_scenario_unconfigured` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:260` | UI |
| `background_special_scenario_unsupported` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:272` | UI |
| `background_started` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:236` | UI |
| `background_started_special_scenario` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:285` | UI |
| `background_status_timeout` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:176` | UI |
| `background_stop_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:303` | UI |
| `background_stopped` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:301` | UI |
| `background_suspend_listener_failed` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:103` | UI |
| `background_suspended` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:83` | UI |
| `background_system_cancelled` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:73` | UI |
| `background_user_cancelled` | background | `entry/src/main/ets/services/VpnBackgroundTaskManager.ets:73` | UI |
| `connect_requested` | preflight | `entry/src/main/ets/components/BridgeStatus.ets:2395` | UI |
| `control_probe_skipped` | backend_selection | `entry/src/main/ets/components/BridgeStatus.ets:2242` | UI |
| `control_server_confirm_blocked` | connected | `entry/src/main/ets/components/BridgeStatus.ets:1674` | UI |
| `control_server_confirm_failed` | invalid、storage | `entry/src/main/ets/components/BridgeStatus.ets:1680` | UI |
| `control_server_confirmed` | official、custom | `entry/src/main/ets/components/BridgeStatus.ets:1726` | UI |
| `control_server_editor_closed` | account | `entry/src/main/ets/components/BridgeStatus.ets:1667` | UI |
| `control_server_editor_opened` | account | `entry/src/main/ets/components/BridgeStatus.ets:1667` | UI |
| `control_server_http_risk_cancelled` | confirmation | `entry/src/main/ets/components/BridgeStatus.ets:1701` | UI |
| `control_server_http_risk_shown` | confirmation | `entry/src/main/ets/components/BridgeStatus.ets:1709` | UI |
| `control_server_tip_shown` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1447` | UI |
| `device_list_scroll_verification_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:5274` | UI |
| `device_list_scroll_verification_clicked` | `peer.key` | `entry/src/main/ets/components/BridgeStatus.ets:5290` | UI |
| `device_list_scroll_verification_opened` | home | `entry/src/main/ets/components/BridgeStatus.ets:5284` | UI |
| `diagnostic_crash_simulation_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14854` | UI |
| `diagnostic_crash_simulation_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14829` | UI |
| `diagnostic_crash_simulation_staged` | abort | `entry/src/main/ets/components/BridgeStatus.ets:14846` | UI |
| `diagnostic_first_run_reset_completed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14744` | UI |
| `diagnostic_first_run_reset_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14754` | UI |
| `diagnostic_first_run_reset_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14694` | UI |
| `diagnostic_module_changed` | `${feature}_${enabled ? 'enabled' : 'disabled'}` | `entry/src/main/ets/components/BridgeStatus.ets:11170` | UI |
| `diagnostic_report_failed` | generate | `entry/src/main/ets/components/BridgeStatus.ets:4306` | UI |
| `diagnostic_report_generated` | share | `entry/src/main/ets/components/BridgeStatus.ets:4295` | UI |
| `diagnostic_report_requested` | generate | `entry/src/main/ets/components/BridgeStatus.ets:4236` | UI |
| `diagnostic_share_opened` | system | `entry/src/main/ets/components/BridgeStatus.ets:4300` | UI |
| `diagnostic_vpn_cut_completed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14783` | UI |
| `diagnostic_vpn_cut_failed` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14797` | UI |
| `diagnostic_vpn_cut_requested` | diagnostics | `entry/src/main/ets/components/BridgeStatus.ets:14768` | UI |
| `disconnect_completed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2579` | UI |
| `disconnect_failed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2596` | UI |
| `disconnect_requested` | user | `entry/src/main/ets/components/BridgeStatus.ets:2517` | UI |
| `fake_media_service_changed` | `enabled ? 'enabled' : 'disabled'` | `entry/src/main/ets/components/BridgeStatus.ets:12167` | UI |
| `fast_reconnect_config_failed` | backend_config | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1118` | 扩展 |
| `fast_reconnect_config_staged` | disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1127` | 扩展 |
| `fast_reconnect_failed` | persistence | `entry/src/main/ets/components/BridgeStatus.ets:2293` | UI |
| `fast_reconnect_used` | cached_config | `entry/src/main/ets/components/BridgeStatus.ets:2297` | UI |
| `feature_diagnostics_refresh_completed` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11255` | UI |
| `feature_diagnostics_refresh_failed` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11264` | UI |
| `feature_diagnostics_refresh_started` | manual | `entry/src/main/ets/components/BridgeStatus.ets:11242` | UI |
| `feature_diagnostics_unlocked` | settings | `entry/src/main/ets/components/BridgeStatus.ets:4937` | UI |
| `feedback_email_opened` | about | `entry/src/main/ets/components/BridgeStatus.ets:1438` | UI |
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
| `media_probe_available` | service_confirmed | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1261` | 扩展 |
| `media_probe_completed` | no_service | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1261` | 扩展 |
| `media_probe_failed` | exception、extension、request_parse | `entry/src/main/ets/components/BridgeStatus.ets:6210` | UI |
| `media_probe_no_service` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5913` | UI |
| `media_probe_rejected` | invalid_request | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1250` | 扩展 |
| `media_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6166` | UI |
| `media_probe_started` | requested | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1254` | 扩展 |
| `media_probe_success` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5913` | UI |
| `media_self_test_failed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6487` | UI |
| `media_self_test_passed` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6486` | UI |
| `media_self_test_started` | offline | `entry/src/main/ets/components/BridgeStatus.ets:6472` | UI |
| `media_service_detected` | `service.type` | `entry/src/main/ets/components/BridgeStatus.ets:6193` | UI |
| `moonlight_launch_attempt` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6336` | UI |
| `moonlight_launch_failed` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6371` | UI |
| `moonlight_launch_success` | `state.path.type` | `entry/src/main/ets/components/BridgeStatus.ets:6366` | UI |
| `peer_path_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6259` | UI |
| `peer_path_result` | `path.type` | `entry/src/main/ets/components/BridgeStatus.ets:5910` | UI |
| `peer_service_refresh_failed` | exception | `entry/src/main/ets/components/BridgeStatus.ets:5937` | UI |
| `peer_service_refresh_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:5958` | UI |
| `secure_login_browser_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2219` | UI |
| `secure_login_browser_open_link_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2159` | UI |
| `secure_login_browser_opened` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2211` | UI |
| `secure_login_browser_type_error` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2138` | UI |
| `secure_login_browser_type_failed` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2133` | UI |
| `secure_login_browser_type_fallback` | handoff | `entry/src/main/ets/components/BridgeStatus.ets:2150` | UI |
| `security_self_test_failed` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11288` | UI |
| `security_self_test_passed` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11287` | UI |
| `security_self_test_started` | system_auth | `entry/src/main/ets/components/BridgeStatus.ets:11280` | UI |
| `service_status_changed` | `receiverState` | `entry/src/main/ets/components/BridgeStatus.ets:11145` | UI |
| `sunshine_probe_failed` | `sunshine.state`、exception | `entry/src/main/ets/components/BridgeStatus.ets:5911` | UI |
| `sunshine_probe_start` | requested | `entry/src/main/ets/components/BridgeStatus.ets:6258` | UI |
| `sunshine_probe_success` | `sunshine.state` | `entry/src/main/ets/components/BridgeStatus.ets:5911` | UI |
| `sunshine_probe_timeout` | `sunshine.state` | `entry/src/main/ets/components/BridgeStatus.ets:5911` | UI |
| `taildrop_file_cache_ready` | `result.name` | `entry/src/main/ets/components/BridgeStatus.ets:8608` | UI |
| `taildrop_media_asset_create_failed` | creation_dialog | `entry/src/main/ets/components/BridgeStatus.ets:9123` | UI |
| `taildrop_media_mtime_restored` | video | `entry/src/main/ets/components/BridgeStatus.ets:9135` | UI |
| `taildrop_media_preview_failed` | `reason` | `entry/src/main/ets/components/BridgeStatus.ets:9430` | UI |
| `taildrop_media_preview_ready` | `result.name` | `entry/src/main/ets/components/BridgeStatus.ets:8585` | UI |
| `taildrop_media_ready_for_save` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8630` | UI |
| `taildrop_media_receive_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8300` | UI |
| `taildrop_media_save_failed` | `extension.length > 0 ? `${mediaKind}_${extension}` : mediaKind` | `entry/src/main/ets/components/BridgeStatus.ets:8941` | UI |
| `taildrop_media_save_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8834` | UI |
| `taildrop_media_saved_to_gallery` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9150` | UI |
| `taildrop_pending_delete_completed` | reconnect | `entry/src/main/ets/components/BridgeStatus.ets:8805` | UI |
| `taildrop_pending_delete_deferred` | `reason` | `entry/src/main/ets/components/BridgeStatus.ets:8811` | UI |
| `taildrop_pending_delete_requested` | reconnect | `entry/src/main/ets/components/BridgeStatus.ets:8794` | UI |
| `taildrop_receive_cache_clear_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8439` | UI |
| `taildrop_receive_cache_cleared` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8696` | UI |
| `taildrop_receive_completed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9354` | UI |
| `taildrop_receive_delete_deferred` | `result.reason`、request_unavailable、`reason` | `entry/src/main/ets/components/BridgeStatus.ets:8540` | UI |
| `taildrop_receive_delete_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1554` | 扩展 |
| `taildrop_receive_discard_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8377` | UI |
| `taildrop_receive_discarded` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:9383` | UI |
| `taildrop_receive_failed` | clear_failed、`reason`、extension_error | `entry/src/main/ets/components/BridgeStatus.ets:8432` | UI |
| `taildrop_receive_inbox_unavailable` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8279` | UI |
| `taildrop_receive_invalid_busy_state` | timeout | `entry/src/main/ets/components/BridgeStatus.ets:8448` | UI |
| `taildrop_receive_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8300` | UI |
| `taildrop_receive_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1554` | 扩展 |
| `taildrop_receive_submit_failed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8075` | UI |
| `taildrop_receive_timeout` | `this.taildropReceive.state` | `entry/src/main/ets/components/BridgeStatus.ets:8467` | UI |
| `taildrop_send_cancel_failed` | extension_error | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1487` | 扩展 |
| `taildrop_send_cancel_requested` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8044` | UI |
| `taildrop_send_cancelled` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1485` | 扩展 |
| `taildrop_send_completed` | `result.reason` | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1756` | 扩展 |
| `taildrop_send_failed` | invalid_result、`result.reason`、extension_error | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1752` | 扩展 |
| `taildrop_send_queued` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8023` | UI |
| `taildrop_send_requested` | transfer | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1744` | 扩展 |
| `taildrop_text_preview_ready` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8647` | UI |
| `taildrop_text_preview_submit_failed` | transfer | `entry/src/main/ets/components/BridgeStatus.ets:8119` | UI |
| `taildrop_thumbnail_failed` | imagekit、video | `entry/src/main/ets/components/BridgeStatus.ets:7323` | UI |
| `taildrop_thumbnail_unavailable` | image、video | `entry/src/main/ets/components/BridgeStatus.ets:8564` | UI |
| `ui_opened` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:978` | UI |
| `update_changelog_dismissed` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1175` | UI |
| `update_changelog_only_on_update` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1173` | UI |
| `update_changelog_opened` | settings | `entry/src/main/ets/components/BridgeStatus.ets:4969` | UI |
| `update_changelog_shown` | lifecycle | `entry/src/main/ets/components/BridgeStatus.ets:1166` | UI |
| `vpn_backend_handoff_request_failed` | vpn_handoff | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:655` | 扩展 |
| `vpn_backend_handoff_request_invalid` | vpn_handoff | `entry/src/main/ets/services/VpnSessionController.ets:175` | UI |
| `vpn_backend_handoff_stop_failed` | vpn_handoff | `entry/src/main/ets/components/BridgeStatus.ets:3432` | UI |
| `vpn_backend_handoff_stopped` | vpn_handoff | `entry/src/main/ets/components/BridgeStatus.ets:3432` | UI |
| `vpn_backend_handoff_timeout` | vpn_handoff | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:679` | 扩展 |
| `vpn_backend_stop_failed` | disconnect、destroy | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1105` | 扩展 |
| `vpn_backend_stop_timeout` | disconnect | `entry/src/main/ets/components/BridgeStatus.ets:2536` | UI |
| `vpn_backend_stopped` | disconnect、destroy | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1105` | 扩展 |
| `vpn_config_handoff_failed` | persistence | `entry/src/main/ets/components/BridgeStatus.ets:2423` | UI |
| `vpn_config_handoff_fallback` | backend_restore | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:761` | 扩展 |
| `vpn_config_handoff_staged` | preflight | `entry/src/main/ets/components/BridgeStatus.ets:2421` | UI |
| `vpn_config_handoff_used` | preflight | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:758` | 扩展 |
| `vpn_conflict` | create | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:566` | 扩展 |
| `vpn_conflict_acknowledged` | dialog | `entry/src/main/ets/components/BridgeStatus.ets:4371` | UI |
| `vpn_conflict_confirm_disconnect_completed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4376` | UI |
| `vpn_conflict_confirm_disconnect_failed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4380` | UI |
| `vpn_conflict_confirm_disconnect_requested` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4373` | UI |
| `vpn_conflict_detected` | connect | `entry/src/main/ets/components/BridgeStatus.ets:4321` | UI |
| `vpn_conflict_self_disconnect_completed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4343` | UI |
| `vpn_conflict_self_disconnect_failed` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4333` | UI |
| `vpn_conflict_self_disconnect_requested` | cleanup | `entry/src/main/ets/components/BridgeStatus.ets:4329` | UI |
| `vpn_connected` | backend | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:546` | 扩展 |
| `vpn_control_server_missing` | preflight | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:399` | 扩展 |
| `vpn_create_failed` | extension、create、replace | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:380` | 扩展 |
| `vpn_drop_after_requested_stop` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:119` | UI |
| `vpn_drop_ignored_foreground` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:126` | UI |
| `vpn_extension_created` | lifecycle | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:340` | 扩展 |
| `vpn_extension_destroyed` | lifecycle | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1958` | 扩展 |
| `vpn_failed_extension_stop_failed` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3481` | UI |
| `vpn_failed_extension_stop_requested` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3465` | UI |
| `vpn_failed_extension_stopped` | recovery | `entry/src/main/ets/components/BridgeStatus.ets:3472` | UI |
| `vpn_network_monitor_failed` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:90` | UI |
| `vpn_network_monitor_started` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:95` | UI |
| `vpn_network_offline` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:172` | UI |
| `vpn_network_refresh_failed` | network | `entry/src/main/ets/services/VpnNetworkMonitor.ets:178` | UI |
| `vpn_preflight_failed` | backend_config、exception | `entry/src/main/ets/components/BridgeStatus.ets:2413` | UI |
| `vpn_process_protect_failed` | network | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:522` | 扩展 |
| `vpn_process_protected` | network | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:518` | 扩展 |
| `vpn_reconnect_attempt` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:138` | UI |
| `vpn_reconnect_cancelled` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:143` | UI |
| `vpn_reconnect_exhausted` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:130` | UI |
| `vpn_reconnect_failed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:159` | UI |
| `vpn_reconnect_not_started` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:157` | UI |
| `vpn_reconnect_started` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:157` | UI |
| `vpn_reconnect_succeeded` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:102` | UI |
| `vpn_reconnect_superseded` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:150` | UI |
| `vpn_reconnect_undo_failed` | reconnect | `entry/src/main/ets/services/VpnReconnectSupervisor.ets:152` | UI |
| `vpn_snapshot_unavailable` | status | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:939` | 扩展 |
| `vpn_start_failed` | system | `entry/src/main/ets/components/BridgeStatus.ets:2494` | UI |
| `vpn_start_requested` | system | `entry/src/main/ets/components/BridgeStatus.ets:2486` | UI |
| `vpn_status_grace_expired` | heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3496` | UI |
| `vpn_status_grace_recovered` | heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3339` | UI |
| `vpn_status_grace_started` | tun_transition、heartbeat | `entry/src/main/ets/components/BridgeStatus.ets:3515` | UI |
| `vpn_stop_requested` | system | `entry/src/main/ets/services/VpnSessionController.ets:152` | UI |
| `vpn_tun_created` | create | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:513` | 扩展 |
| `vpn_tun_destroy_failed` | cleanup、disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:698` | 扩展 |
| `vpn_tun_destroyed` | disconnect | `entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1096` | 扩展 |
| `welcome_dialog_acknowledged` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1425` | UI |
| `welcome_dialog_shown` | first_run | `entry/src/main/ets/components/BridgeStatus.ets:1432` | UI |

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
