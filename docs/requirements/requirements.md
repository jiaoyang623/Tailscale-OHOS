# MeshArc 需求分析

- 流程版本：a01 · 层：需求 · 代码基线：`7ecf03f`
- 事实来源：`README.md`、`CONTRIBUTING.md`、`STATUS.md`、`docs/*.md`、生产代码（逐条给 `file:line`）、
  73 条宿主侧用例、[真机走查登记册](../changes/a01-baseline/manual-checks.md)
- 本层的旅程判据见 `docs/oracles/90-journeys/`

## 一、用户、问题与结果

**用户**：持有 HarmonyOS NEXT 设备（手机 / 平板 / 2in1）、已经在别处跑着一个 tailnet 的人。
不是 Tailscale 运维，不会读日志，期望「装上、登录、连上、然后忘掉它」。

**要解决的问题**：HarmonyOS 上没有官方 Tailscale 客户端，用户无法从手机访问自己 tailnet 内的
NAS、电脑和自建服务，也无法把手机上的文件送到那些设备。

**用户结果**（本层的验收语言）：

1. 手机能加入 tailnet，并用 Tailscale IP 直接访问其中的设备与服务。
2. 连接在用户切换应用、锁屏静置时**不中断**；断了（网络变化、系统回收）能自己回来。
3. 文件能在手机与 tailnet 设备之间双向流动（Taildrop 收发、Taildrive 共享目录浏览与传输）。
4. tailnet 里的媒体服务器能被发现并交给播放器打开。
5. 应用本身的内容可以在设备被他人拿到时锁住。
6. 上述一切在中英两种界面下都成立。

## 二、范围、非目标与环境

**范围**：`entry` 应用的六个功能区（连接、设备、传输、文件、媒体、隐私设置）与它们的
用户可见行为；支撑这些行为的本机权限、持久化与诊断。

**非目标**（本版不做，且不作为判据）：

- MagicDNS 名称解析（`README.md:28`：只能用 Tailscale IP）。
- 开机 / 重启后自动重连（`README.md:29`、`docs/getting-started.md`：重启后手动重连）。
- 系统分享面板直接接收文件（`docs/taildrop-technical-plan.md`：属第二里程碑）。
- 控制中心快捷开关（平台只对系统应用开放；替代入口是桌面卡片，见 R-UI-05）。
- 服务端 / 控制平面：本项目只是客户端。

**环境约束**：

- 目标 HarmonyOS 6.1 / API 23 起，arm64；`build-profile.json5` 的 `compatibleSdkVersion` 为 `6.1.0(23)`。
- 引擎固定 Tailscale 1.86.5 + OpenHarmony Go 1.24 工具链（`README.md:26`）。
- 一个设备同时只能有一个 VPN；连接前必须断开其它系统 VPN（`README.md:30`）。
- AppGallery 版与自编译版的签名、包名不同（本仓库基线包名为 `ren.w2h.mesharc`）。

## 三、需求条目

末列 `验证状态`是**判据侧**的状态（`有判据闭环` / `判据待建` / `判据待接线` / `不适用`），
检查器读这一列；`实现状态`另列，记录产品现状。两列分开的理由见[流程记录](../changes/a01-baseline/record.md)。

| ID | 规则或质量目标 | 来源与理由 | 依赖/约束 | 优先级 | 旅程判据 | 实现状态 | 验证状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-SETUP-01 | 首次启动引导用户认识本应用，确认后不再打扰 | `components/BridgeStatus.ets:1399` `showWelcomeDialogIfNeeded`；标记文件 `welcome-acknowledged` | 无 | 低 | O-SETUP-01 | 已实现 | 判据待建 |
| R-SETUP-02 | 每个版本首次启动展示本次更新内容，可关闭、可不再显示、可在设置中重看 | `BridgeStatus.ets:1143`；`components/UpdateChangelogSheet.ets`；`services/ReleaseChangelog.ets` | 依赖版本号一致（R-UI-06） | 低 | O-SETUP-01 | 已实现 | 判据待建 |
| R-SETUP-03 | 登录前必须确认控制服务器地址；非法地址被拒并给出可理解原因 | `BridgeStatus.ets:1671` `saveControlServer`；`services/ControlServerConfig.ets:21` `normalize` | 未连接时才可改 | 高 | O-SETUP-02 | 已实现 | 判据待建 |
| R-SETUP-04 | 使用明文 HTTP 控制服务器须经用户显式确认风险后才生效 | `BridgeStatus.ets:1694` `confirmHttpControlServerRisk` | 依赖 R-SETUP-03 | 高（安全） | O-SETUP-02 | 已实现 | 判据待建 |
| R-SETUP-05 | 控制服务器配置原子落盘，损坏或缺失时回落到未配置态而不是崩溃 | `ControlServerConfig.ets:71`（`.tmp` + rename）、`:14-20` `unconfigured()` | 无 | 高 | O-SETUP-02 | 已实现 | 判据待建 |
| R-SETUP-06 | 登录通过系统浏览器完成；拉起浏览器的三种方式逐级回退 | `BridgeStatus.ets:2053` `openSecureLogin`、`:2126`/`:2144`/`:2156`/`:2168` | 依赖 R-SETUP-03 | 高 | O-SETUP-03 | 已实现 | 判据待建 |
| R-SETUP-07 | 登录 URL 只能来自 http(s)；获取超时有明确失败态 | `BridgeStatus.ets:2200+` `pollSecureLogin`（60×400ms） | 依赖 R-SETUP-06 | 中（安全） | O-SETUP-03 | 已实现 | 判据待建 |
| R-SETUP-08 | 退出登录前必须先断开连接，否则只提示不执行 | `BridgeStatus.ets:11876`（`logout_disconnect_first`） | 依赖 R-CONN-02 | 中 | O-SETUP-04 | 已实现 | 判据待建 |
| R-SETUP-09 | 退出登录清理对端与出口节点状态，回到未登录态 | `BridgeStatus.ets:2623` `logout`、`:2606` `confirmLogout` | 依赖 R-SETUP-08 | 中 | O-SETUP-04 | 已实现 | 判据待建 |
| R-CONN-01 | 从首页一键连接：拉起 VPN 扩展、经系统授权、进入可用的隧道 | `BridgeStatus.ets:2346` `beginVpnConnection`、`:2465` `requestVpnExtensionStart` | 依赖 R-SETUP-03 与 R-SETUP-06 | 高 | O-CONN-01 | 已实现 | 判据待建 |
| R-CONN-02 | 从首页一键断开：停止扩展、释放长时任务、回到未连接态 | `BridgeStatus.ets:2512` `stopVpnProbe`、`:2579-2596` | 无 | 高 | O-CONN-02 | 已实现 | 判据待建 |
| R-CONN-03 | 连接窗口期内应用进程必须持有长时任务，使切到后台后仍能应答扩展的后端交接请求 | `services/VpnBackgroundTaskManager.ets`（`connecting` 态持有任务）；`vpnextensionability/TailscaleVpnExtensionAbility.ets:644` `requestUiBackendHandoff` 等待 15 s | 依赖 R-CONN-01 | 高 | O-CONN-01、O-CONN-03 | 已实现 | 有判据闭环（单元） |
| R-CONN-04 | 已连接时切到其它应用、锁屏静置，隧道不中断 | `docs/background-vpn-reliability.md` Milestone 1；走查 M-01/M-02 | 依赖 R-CONN-03 | 高 | O-CONN-06 | 已实现 | 有判据闭环（走查） |
| R-CONN-05 | 非用户主动的掉线自动恢复：指数退避，退避上限 300 s；稳定 60 s 后清零计数。恢复不设次数上限 | `services/VpnReconnectSupervisor.ets`（`RETRY_BASE_MS`/`RETRY_MAX_MS`/`STABLE_MS`） | 依赖 R-CONN-04；2026-10-20 修订，原值「最多 3 次」与 R-CONN-11 冲突 | 高 | O-CONN-04 | 部分实现 | 判据待建 |
| R-CONN-06 | 用户的主动断开不得被自动恢复撤销 | `VpnReconnectSupervisor.ets` `noteRequestedStop`；`VpnSessionController` | 依赖 R-CONN-05 | 高 | O-CONN-04 | 已实现 | 有判据闭环（单元） |
| R-CONN-07 | 另一个系统 VPN 占用通道时给出可理解的冲突提示，经用户批准才替换 | `TailscaleVpnExtensionAbility.ets:605` `replaceExistingVpn`；`README.md:30` | 平台单 VPN 限制 | 中 | O-CONN-05 | 已实现 | 判据待建 |
| R-CONN-08 | 无 UI 的入口（桌面卡片、后台恢复）也能独立完成连接，且应答扩展的后端交接 | `services/VpnSessionController.ets` `connect`/`answerBackendHandoff` | 依赖 R-CONN-03 | 中 | O-CONN-07、O-CARD-01 | 已实现 | 有判据闭环（单元） |
| R-CONN-09 | 长时任务在状态缺失或陈旧时保留保护，不因一次不确定判读释放。只有确认断开或用户停止才释放 | `VpnBackgroundTaskManager.ets` 的意图守卫；`services/VpnSessionIntent.ets`；2026-10-20 修订，原值为「有界宽限后释放」 | 依赖 R-CONN-04、R-CONN-11 | 高 | O-CONN-06、O-CONN-08 | 部分实现 | 判据待建 |
| R-CONN-10 | 用户取消保活通知不等于停止连接。后台不抢；回到前台且连接意图仍在时重新申请保护 | `VpnBackgroundTaskManager.ets` `suppressedUntilForeground`（本批由 `suppressedUntilDisconnect` 重命名）；2026-10-20 修订 | 依赖 R-CONN-04、R-CONN-11 | 中 | O-CONN-06、O-CONN-08 | 部分实现 | 判据待建 |
| R-NET-01 | 连接前可选择出口节点；已连接时不可改，并提示先断开 | `BridgeStatus.ets:10285` `exitNodeSelectOptions`、`:10316`、`:1938` `queueExitNodeUpdate` | 依赖 R-CONN-01 | 中 | O-NET-01 | 已实现 | 判据待建 |
| R-NET-02 | 连接前可开关「使用子网路由」与「出口节点允许访问局域网」 | `BridgeStatus.ets:10199` `NetworkSettingsPanel`、`:1982` `toggleNetworkSetting` | 依赖 R-SETUP-03 | 中 | O-NET-02 | 已实现 | 判据待建 |
| R-NET-03 | 网络在蜂窝/Wi-Fi 之间变化时，同一次 VPN 会话内自动重绑并恢复直连，不要求用户重连 | `services/VpnNetworkMonitor.ets`；`docs/vpn-network-recovery.md` | 依赖 R-CONN-04 | 高 | O-NET-03 | 已实现 | 有判据闭环（走查） |
| R-NET-04 | 网络变化的地址数据不得写入日志或诊断 | `VpnNetworkMonitor.ets`（`never logs address data`）；`services/DiagnosticPrivacy.ets:47-55` | 依赖 R-DIAG-02 | 高（安全） | O-DIAG-01 | 已实现 | 有判据闭环（单元） |
| R-DEV-01 | 未登录、加载中、已登录三种状态给出不同表述，不显示空列表 | `BridgeStatus.ets:10385` `DevicesSignedOutPanel`、`:10359` `DevicesLoadingPanel` | 依赖 R-SETUP-06 | 中 | O-DEV-01 | 已实现 | 判据待建 |
| R-DEV-02 | 设备列表区分本机、在线、离线，并标出名称、系统与密钥过期 | `BridgeStatus.ets:10750` `DevicesPanel`、`:10601`；`services/HomeReadOnlyGateway.ets` | 依赖 R-CONN-01 | 中 | O-DEV-01 | 已实现 | 判据待建 |
| R-DEV-03 | 设备详情展现在线状态、路径类型（直连/DERP）与延迟，可手动刷新 | `BridgeStatus.ets:5555` `openPeerDetails`、`:5567` `startDeviceDetailRefreshPolling`；`components/DeviceDetailSheet.ets` | 依赖 R-DEV-02 | 中 | O-DEV-02 | 已实现 | 判据待建 |
| R-DEV-04 | 设备详情内的服务行在离线或未连接时降级为 offline/disconnected，而不是报错 | `DeviceDetailSheet.ets` label 逻辑；`BridgeStatus.ets:5841` `refreshPeerServices` | 依赖 R-DEV-03 | 中 | O-DEV-02 | 已实现 | 判据待建 |
| R-DEV-05 | 对端探测结果过期即失效，不能拿旧结果覆盖新的路径 | `services/PeerPathService.ets`；`scripts/test-peer-path-cache.mjs` | 依赖 R-DEV-03 | 中 | O-DEV-02 | 已实现 | 有判据闭环（单元） |
| R-DEV-06 | 设备详情被挂起时，用当前对端而不是打开时捕获的旧对端取数 | `scripts/test-localsend-status.mjs` | 依赖 R-DEV-03 | 低 | O-DEV-02 | 已实现 | 有判据闭环（单元） |
| R-XFER-01 | 只允许一个 Taildrop 出站传输；忙碌时给出提示而不是排队 | `BridgeStatus.ets:7878-7885` `ensureTaildropSendAvailable` | 依赖 R-CONN-01 | 中 | O-XFER-01 | 已实现 | 判据待建 |
| R-XFER-02 | 从 Transfer 页可选文件/图片发送，选择数量有上限 | `BridgeStatus.ets:7894` `selectTaildropDocuments`、`:7919`、`TAILDROP_MAX_FILE_SELECTION` | 依赖 R-XFER-01 | 中 | O-XFER-01 | 已实现 | 判据待建 |
| R-XFER-03 | 可发送文字，接收端在预览中看到内容而不是落盘文件 | `BridgeStatus.ets:7946` `sendTaildropText`、`:8081` `startTaildropTextPreview` | 依赖 R-XFER-01 | 低 | O-XFER-02 | 已实现 | 判据待建 |
| R-XFER-04 | 发送过程显示进度、速度与预计剩余时间，可取消、可重试 | `BridgeStatus.ets:8032` `cancelTaildropSend`、`:8047` `retryTaildropSend` | 依赖 R-XFER-02 | 中 | O-XFER-05 | 已实现 | 判据待建 |
| R-XFER-05 | 接收方按内容类型分流：图片/视频存入照片，其它交给文件保存器；同名不同大小必须区分 | `BridgeStatus.ets:8183` `routeTaildropReceive`、`:8196` `selectTaildropReceiveDestination` | 依赖 R-CONN-01 | 中 | O-XFER-04 | 已实现 | 判据待建 |
| R-XFER-06 | 通知上的接收操作可直接完成保存，不必先进应用 | `BridgeStatus.ets:1591` `onTaildropOpenInbox`、`:1630` | 依赖 R-XFER-05 | 中 | O-XFER-04 | 已实现 | 判据待建 |
| R-XFER-07 | 接收完成后才删除对端等待文件；未取走的文件保留到用户显式丢弃 | `BridgeStatus.ets:8321` `confirmDiscardTaildropFile`；`DeleteWaitingFile` | 依赖 R-XFER-05 | 高 | O-XFER-04 | 已实现 | 判据待建 |
| R-XFER-08 | 从设备详情发起传输时，双通道目标让用户显式选通道 | `BridgeStatus.ets:5695` `openFileTransferFromDevice`、`:10172` `FileTransferMethodContent` | 依赖 R-DEV-03 | 低 | O-XFER-03 | 已实现 | 判据待建 |
| R-XFER-09 | 外部 LocalSend 应用按显式 Want 拉起；契约未定时不得猜测 | `BridgeStatus.ets:5802`/`:6326`；`STATUS.md` 2026-08-11 条目 | 依赖官方 bundle/Want 契约（未决 Q4） | 低 | O-XFER-03 | 部分实现 | 判据待建 |
| R-XFER-10 | Taildrop 历史有上限，超出后淘汰最旧 | `BridgeStatus.ets:178` `TAILDROP_HISTORY_LIMIT` | 无 | 低 | O-XFER-05 | 已实现 | 判据待建 |
| R-DRIVE-01 | 未连接时 Files 页不给可操作入口 | `BridgeStatus.ets:13817`（`connected` 门控） | 依赖 R-CONN-01 | 中 | O-DRIVE-01 | 已实现 | 判据待建 |
| R-DRIVE-02 | 可浏览共享目录、沿面包屑上溯、用系统返回键上一级；根目录允许退出应用 | `components/TaildriveBrowser.ets`；`pages/Index.ets` `onBackPress` | 依赖 R-DRIVE-01 | 中 | O-DRIVE-01 | 已实现 | 判据待建 |
| R-DRIVE-03 | 支持上传、下载、新建文件夹、改名、移动、删除，操作有进度与结果反馈 | `TaildriveBrowser.ets`；`services/TaildriveGateway.ets` | 依赖 R-DRIVE-02 | 中 | O-DRIVE-01 | 已实现 | 判据待建 |
| R-DRIVE-04 | 上传默认不覆盖，冲突要用户显式确认 | `TaildriveBrowser.ets` 冲突确认分支 | 依赖 R-DRIVE-03 | 高 | O-DRIVE-01 | 已实现 | 判据待建 |
| R-DRIVE-05 | 每一类传输暂存都写明适用对象与保留期，且不无限增长：Taildrop 出站暂存在 `cacheDir` 且是可丢弃副本（`services/RecoverableCachePaths.ets:10`），扩展侧 Taildrop 缓存保留 7 天（`vpnextensionability/TailscaleVpnExtensionAbility.ets:56`），诊断报告保留 24 h（`services/DiagnosticReportService.ets:10`）；**Taildrive 暂存当前没有清理实现**，`components/TaildriveBrowser.ets:1891` 的 24 h 只是「yesterday」的分组显示 | 本行原写「24 小时后清理」，来源指 `TaildriveBrowser.ets`，实为显示分组。按 Q-03 决定改写为代码现状 | 无 | 低 | O-DRIVE-01 | Taildrop 与诊断报告已实现；Taildrive 暂存**未实现** | 判据待建 |
| R-DRIVE-06 | 从设备详情可直接跳到该设备的共享目录 | `BridgeStatus.ets:5688` `openRemoteFilesFromDevice`、`:5692` | 依赖 R-DEV-03 | 低 | O-DRIVE-02 | 已实现 | 判据待建 |
| R-MEDIA-01 | 设备详情可探测 Jellyfin/Emby/Plex，并说明探测不到的原因 | `BridgeStatus.ets:6146` `detectMediaForPeer`；`services/MediaServiceProbeService.ets` | 依赖 R-CONN-01 | 中 | O-MEDIA-01 | 已实现 | 判据待建 |
| R-MEDIA-02 | 交给 HosPlayer 时只传类型、端点与名称，凭据由播放器自己收集 | `services/HosPlayerLauncher.ets`；`BridgeStatus.ets:6401` `openHosPlayer` | 依赖 R-MEDIA-01 | 高（安全） | O-MEDIA-01 | 已实现 | 有判据闭环（走查） |
| R-MEDIA-03 | 未识别的服务地址或非法名称必须拒绝，不得拼进深链 | `HosPlayerLauncher.validate`（`unsafe_server_url`/`invalid_server_name`） | 依赖 R-MEDIA-02 | 高（安全） | O-MEDIA-01 | 已实现 | 判据待建 |
| R-MEDIA-04 | 检测到 Sunshine 且路径为 DERP 时先向用户确认再串流 | `BridgeStatus.ets:6290` `showDerpStreamConfirmation`、`:6266` `launchRemoteStream` | 依赖 R-CONN-01 | 中 | O-MEDIA-02 | 已实现 | 判据待建 |
| R-MEDIA-05 | 未安装 MoonlightOH 时明确告知，并允许复制主机地址 | `BridgeStatus.ets:6344` | 依赖 R-MEDIA-04 | 低 | O-MEDIA-02 | 已实现 | 判据待建 |
| R-PRIV-01 | 应用锁开启与关闭都要经过系统认证；开启后回到前台即锁定 | `BridgeStatus.ets:1318` `updateAppLockEnabled`、`:1277` `requireAppAuthentication`、`:14957` `AppLockOverlay` | 依赖系统认证能力 | 高（安全） | O-PRIV-01 | 已实现 | 判据待建 |
| R-PRIV-02 | 认证失败停在锁定层可重试，不得放行 | `BridgeStatus.ets:1286` `authenticateApplication` | 依赖 R-PRIV-01 | 高（安全） | O-PRIV-01 | 已实现 | 判据待建 |
| R-PRIV-03 | 被锁的 Taildrive 路径在解锁前不得渲染内容，且锁定时清空已显示的内容 | `TaildriveBrowser.ets` `blockProtectedFolderContent`、`folderAccessGrants` | 依赖 R-DRIVE-02 | 高（安全） | O-PRIV-02 | 已实现 | 判据待建 |
| R-PRIV-04 | 回到前台即清除文件夹授权，需要重新认证 | `TaildriveBrowser.ets:315` `handleAppForeground` | 依赖 R-PRIV-03 | 高（安全） | O-PRIV-02 | 已实现 | 判据待建 |
| R-DIAG-01 | 诊断入口默认隐藏，需在关于页连点版本号 5 次才出现 | `BridgeStatus.ets:4939` `onAppVersionTap`、`:4953` | 无 | 低 | O-DIAG-01 | 已实现 | 判据待建 |
| R-DIAG-02 | 落盘诊断必须脱敏：URL、bearer/basic、token/secret 键、查询串令牌一律替换 | `DiagnosticPrivacy.ets:47-55` | 无 | 高（安全） | O-DIAG-01 | 已实现 | 判据待建 |
| R-DIAG-03 | 诊断事件有按文件条数与字节的上限，超出淘汰最旧 | `DiagnosticEventStore.ets:13-14`、`:111-120` | 无 | 中 | O-DIAG-01 | 已实现 | 判据待建 |
| R-DIAG-04 | 诊断报告可导出并分享，报告有保留期，过期清理（`REPORT_RETENTION_MS = 24 h`，`services/DiagnosticReportService.ets:10`；导出与分享在 `:94-160`） | `services/DiagnosticReportService.ets:10` 保留期常量；`:94-160` 导出与分享 | 依赖 R-DIAG-02 | 低 | O-DIAG-01 | 已实现 | 判据待建 |
| R-DIAG-05 | 关键链路（连接、握手、掉线、网络变化、扩展生命周期）留下可复核的事件 | `DiagnosticEventStore.ets`；`docs/background-vpn-reliability.md` Milestone 3 的取证 | 依赖 R-DIAG-02 | 中 | O-DIAG-01 | 已实现 | 判据待建 |
| R-UI-01 | 四个顶层页签（主页/传输/文件/设置），窄屏悬浮底栏、宽屏侧栏 | `BridgeStatus.ets:14609` `MobileTabs`、`:14862` `WideTabs` | 无 | 中 | O-UI-01 | 已实现 | 判据待建 |
| R-UI-02 | 页签可显隐与排序，且重启后保持 | `BridgeStatus.ets:10889` `setNavigationTabVisible`、`:10914` `moveNavigationTab`；`services/NavigationPreferences.ets` | 依赖 R-UI-01 | 低 | O-UI-01 | 已实现 | 判据待建 |
| R-UI-03 | 英文与中文界面都完整可用；界面改动必须同时维护两份资源 | `resources/base/element/string.json`、`resources/zh_CN/element/string.json`；`CONTRIBUTING.md` 第 3 条 | 无 | 中 | O-UI-02 | 已实现 | 判据待建 |
| R-UI-04 | 浅色与深色主题下都可读 | `resources/dark/element/color.json`；`$r('sys.color.*')` 用法 | 无 | 中 | O-UI-02 | 已实现 | 判据待建 |
| R-UI-05 | 桌面卡片可开关 VPN，卡片状态与应用一致 | `entryformability/EntryFormAbility.ets`、`widget/pages/VpnToggleCard.ets`、`services/FormCardService.ets` | 卡片进程不能常驻 | 低 | O-CARD-01 | 已实现 | 判据待建 |
| R-UI-06 | 版本名与版本号在清单、更新日志与发布校验三处保持一致 | `AppScope/app.json5`、`services/ReleaseChangelog.ets`、`scripts/verify-release-changelog.ps1` | 无 | 中 | —（发布校验守，非用户旅程） | 部分实现 | 判据待建 |
| R-BUILD-01 | 产物必须是 AArch64 动态库且被正确打进 HAP | `scripts/verify-artifacts.ps1`；`scripts/build-go.sh` | 需要 Windows 校验 | 高 | —（构建约束，判据挂单点层） | 已实现 | 判据待接线 |
| R-BUILD-02 | 构建脚本对参数与路径的处理可被测试守住 | `scripts/test-macos-build.mjs`（5 条） | 需要 `bash` 与 `git` | 中 | —（构建约束，判据挂单点层） | 已实现 | 有判据闭环（单元） |
| R-CONN-11 | 用户没有点击停止时，连接不得停止。长时任务被系统取消或丢失后，只要会话仍在就恢复保护 | 本批新增（2026-10-20）。来源：用户报告「长时间使用会断连」；`VpnBackgroundTaskManager.suppressedUntilDisconnect` 只在读到 `DISCONNECTED` 时清零 | 依赖 R-CONN-04；平台单 VPN 限制 | 高 | O-CONN-08 | 已实现 | 有判据闭环（O-SESSION-09、O-BGTASK-02/04） |
| R-CONN-12 | 非用户原因的断连都要落盘留证。每条记录带原因分类：扩展崩溃、进程回收、交接超时、系统策略、网络失效 | 本批新增（2026-10-20）。来源：用户要求「非用户原因的断连都要记录」 | 依赖 R-DIAG-02、R-DIAG-05 | 高 | O-CONN-08、O-DIAG-02 | 已实现 | 有判据闭环（O-SESSION-10/11/12、O-DIAG-02） |
| R-CONN-13 | 断连后自动恢复不设次数上限。用户在场且连接可用时重连；用户主动停止后不恢复 | 本批修订 R-CONN-05 的「最多 3 次」。来源：用户要求「用户没有点击停止时不要停止连接」 | 依赖 R-CONN-05、R-CONN-06 | 高 | O-CONN-04、O-CONN-09 | 已实现 | 有判据闭环（O-RECONN-05） |
| R-NET-05 | 网络不通时监听系统网络变化。网络恢复后自动恢复连接，不盲等固定间隔 | 本批新增（2026-10-20）。扩展进程已有 `VpnNetworkMonitor`；本批把它接到恢复决策 | 依赖 R-NET-03、R-CONN-13 | 高 | O-CONN-09、O-NET-04 | 已实现 | 有判据闭环（O-RECONN-11）；真机通道待补（O-NET-04） |
| R-POWER-01 | 应用退到后台后停止界面类探测并降低刷新频率。隧道的保护与恢复不受影响 | 本批新增（2026-10-20）。来源：用户报告「系统提示耗电较多」 | 依赖 R-CONN-11 | 中 | O-POWER-01 | 已实现 | 有判据闭环（O-POWER-01） |
| R-POWER-02 | 屏幕熄灭后再降一档：只保留心跳、命令应答与恢复所需的最小检查 | 本批新增（2026-10-20）。官方 `power.isActive()` 有屏设备亮屏为活动、熄屏为非活动 | 依赖 R-POWER-01 | 中 | O-POWER-02 | 已实现 | 有判据闭环（O-POWER-02/03/04） |

## 四、场景

### 正常场景

- **首次使用**：安装 → 启动（欢迎 → 更新日志）→ 确认控制服务器 → 浏览器登录 → 关掉其它 VPN → 连接。
- **日常**：打开即连接 → 看设备 → 打开某台设备的详情 → 发文件 / 浏览共享目录 / 打开媒体。
- **离开**：切到别的应用或锁屏，连接保持；回来时状态与流量是最新的。

### 边界场景

- 控制服务器为空 / 非法 / 明文 HTTP。
- 对端离线、密钥过期、路径为 DERP。
- 同名不同大小的接收文件；超过选择上限的批量发送；接收暂存超时。
- 设备重启后（按非目标，需手动重连）。
- 状态文件缺失、只写了一半、或心跳过期。

### 失败与恢复场景

- 连接窗口期内用户切走 → 应用进程被冻结 → 后端交接无人应答 → 扩展 15 s 后销毁 VPN（本批修复）。
- 后台掉线 → 自动恢复，最多 3 次；用户主动断开不被撤销。
- 网络从 Wi-Fi 切到蜂窝再切回 → 同会话内重绑，不要求重连。
- 有另一个系统 VPN → 冲突提示 + 用户批准后替换。
- 进程重启后重新拉起 → 后端重新初始化，不沿用旧快照（`vpn-peers.json` 超过 5 s 即忽略）。
- 长时任务被系统取消或丢失 → 会话仍在时恢复保护，用户看不到中断（R-CONN-11）。
- 断连后用户不在场 → 记录原因分类后自动恢复。网络不通时等网络回调，不按固定间隔盲目重试（R-CONN-12、R-CONN-13、R-NET-05）。
- 用户主动断开 → 不恢复，记录为用户原因（R-CONN-06）。

### 安全与隐私场景

- 诊断不得落盘认证 URL、令牌、账号、tailnet 地址与设备标识。
- 网络变化只上报接口与网络身份，不落地址数据。
- 应用锁与文件夹锁必须在认证失败时保持锁定。
- 交给外部播放器的参数不得包含凭据，非法地址必须拒绝。
- 控制服务器允许 HTTP，但必须经用户显式确认。

### 质量目标（含观测环境与测量方法）

| 目标 | 目标值 | 观测环境与测量方法 | 现状 |
| --- | --- | --- | --- |
| 锁屏静置后台存活 | ≥ 12 h，全程心跳龄 ≤ 15 s，扩展只拉起一次 | 真机：`scripts/e2e/endurance-survival.mjs` 连接后锁屏静置 12 h，扩展每秒把 `heartbeatMs=` 镜像进设备日志，脚本按相邻两条算间隔，并取每天的前台/后台/熄屏事件 | **待实测（2026-10-20）**。上一批次 720 s 已通过，见本表下方历史行 |
| 锁屏静置后台存活（历史） | ≥ 720 s（12 min），全程心跳龄 ≤ 15 s，扩展只拉起一次 | 真机：`scripts/e2e/screen-off-survival.mjs` 连接后用 `power-shell suspend` 锁屏静置，扩展每秒把 `heartbeatMs=` 镜像进设备日志，脚本按相邻两条算间隔 | **已实测（2026-10-13，Pura X）**：1500 个心跳、跨度 750 s、最大间隔 2.8 s、扩展只拉起一次。Wi-Fi 且 USB 供电。蜂窝版**未完成**（M-11） |
| 非用户断连可归因 | 每次非用户断连都有一条 `vpn_session_end` 或 `vpn_session_end_observed` 记录，原因分类在受控词表内 | 真机诊断文件 `diagnostic-vpn-events.ndjson`；字段 `reason` 取值来自登记表 | **待实现（2026-10-20）** |
| 省电：后台探测停止 | 退到后台后 5 s 内不再发起对端、媒体、Sunshine、LocalSend 探测 | 真机诊断文件：后台期间无 `peer_path_result` / `media_probe_*` / `sunshine_probe_*` 新事件 | **待实测（2026-10-20）** |
| 省电：熄屏降频 | 熄屏后扩展命令轮询从 100 ms 降到 ≥ 1000 ms，状态快照从 1 s 降到 ≥ 5 s | 真机：按 1 h 对比熄屏前后诊断事件条数与进程 CPU 时间（`/proc/<pid>/stat` 的 utime+stime） | **待实测（2026-10-20）** |
| 连接期保活覆盖 | 从扩展建 TUN 到隧道可用，全程持有长时任务 | 真机诊断文件中的 `background_started` 与 `vpn_connected` 先后顺序 | 已真机实测（2026-10-13，Pura X）：`background_started` 14:45:40 早于 `vpn_connected` 14:45:59，连接窗口全程持有长时任务。证据 `~/mesharc-e2e/connect-journey-*.log`，命令 `DEVICE=<序列号> node --test scripts/e2e/connect-journey.mjs` |
| 网络切换恢复 | 同会话内自动恢复直连，无需重连 | 真机切换承载，测 discovery 响应时间与 TUN 双向包数 | 已实测 11 ms / +142 包（M-03） |
| 掉线自动恢复 | 不重建 VPN 会话即回到可用路径 | 真机短 down/up，记录恢复路径与耗时 | 已实测 436 ms（M-04） |
| 传输完整性 | 双向双向计数都增长，不丢方向 | `scripts/device-vpn-data-probe.ps1` | 已实测 +13/+18、+16/+20（M-02） |
| 诊断脱敏 | 报告 zip 中不含 token、认证 URL、账号、tailnet 地址 | 人工审查导出报告 + 单元测试 | 实现存在，**无端到端验证** |
| 双语完整 | `base` 与 `zh_CN` 的 key 集合一致 | 程序比对两份 `string.json` 的 key | **未验证**（未决 Q5） |
| 启动到可用 | ≤ 200 ms | 真机：`hdc shell aa force-stop` 后 `aa start`，取设备日志里 `EntryAbility onCreate` 与 `ui_opened` 的时间差。`scripts/device-run.sh` 自动跑 5 次，`scripts/device-analyze.py` 自动计算 | 已实测 5 次（M-19）：中位 140 ms，最大 155 ms。**边界：不含启动器点击与进程创建** |

## 四之二、状态与生命周期

本批次新增用户可见状态「连接意图」。下表写它的进入、退出、生产者与落点。

| 状态 | 进入事件 | 退出事件 | 生产者 | 落点 |
| --- | --- | --- | --- | --- |
| 意图为连接 | 用户点击连接，或卡片切换为连接，或恢复成功 | 用户点击停止，或恢复撤销自身刚建的隧道 | 应用界面进程、卡片进程、恢复看门狗 | `vpn-intent.json` 的 `desired` |
| 意图为停止 | 用户点击停止，或卡片切换为停止，或意图文件缺失 | 用户点击连接 | 应用界面进程、卡片进程 | `vpn-intent.json` 的 `desired` |
| 会话结束（非用户） | 扩展销毁、交接超时、进程回收、系统策略停止 | 下一次会话建立 | 先退出的进程写结束记录，后感知的进程补写观测 | `vpn-session-ledger.ndjson` |
| 省电档位为前台 | 应用回到前台 | 应用进入后台 | 应用界面进程 | `vpn-power-stage.json` 的 `stage` |
| 省电档位为后台 | 应用进入后台且屏幕亮 | 回到前台，或屏幕熄灭 | 应用界面进程 | `vpn-power-stage.json` 的 `stage` |
| 省电档位为熄屏 | 应用在后台且屏幕熄灭 | 屏幕点亮，或回到前台 | 应用界面进程 | `vpn-power-stage.json` 的 `stage` |

## 五、未决项

| # | 问题 | 影响范围 | 谁确认 | 何时阻塞 |
| --- | --- | --- | --- | --- |
| Q4 | LocalSend 的官方 bundle/ability 契约未定，外部拉起无法验证 | R-XFER-09、O-XFER-03 | 用户 | O-XFER-03 要闭环时 |
| Q5 | `base` 与 `zh_CN` 的 key 集合已核对：各 657 个 key、差集为空（本批实测）。仍未验证的是译文质量与真机渲染，另外多份设计文档与代码不一致（如 2 页签 vs 实际 4 页签） | R-UI-03、R-UI-04 | 用户 | O-UI-02 要闭环时 |
| Q6 | ~~「启动到可用」没有目标值，也没有测量方法~~ **已解除**（2026-10-13）：审查人定 ≤ 200 ms，测量方法写进质量目标表，真机实测 5 次中位 140 ms | 质量目标表最后一行、`QG-08` | 用户 | 已解除 |
| Q7 | 卡片、Taildrive 真机共享节点、special-scenario 三条路径从未真机验证 | R-UI-05、R-DRIVE-*、R-CONN-* | 用户 | 相应旅程要闭环时 |
| Q8 | 73 条用例无 CI 门禁，判据的「可达」目前只是「可判定」 | 全部判据的闭环强度 | 用户 | 声称开发完成之前 |
