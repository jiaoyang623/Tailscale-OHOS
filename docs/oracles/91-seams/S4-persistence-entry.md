# MeshArc 接缝判据 · 持久化与入口（O-SEAM-13、O-SEAM-14、O-SEAM-17）

本文件覆盖「应用 ↔ 外部应用与系统认证」「持久化配置所有权」「入口分发」三条接缝。
它们分别是架构 §七 把临时 SEAM-12 拆开后的外部应用分支、架构未在第五节单列的两条
（持久化、入口分发）。`期望` 只写数据/控制/责任怎么交出去，不写用户看到什么。

### O-SEAM-13 应用 ↔ 外部应用与系统认证
- 层级：接缝
- 父判据：O-SETUP-03、O-MEDIA-01、O-MEDIA-02、O-XFER-03、O-PRIV-01
- 强度：强
- 设计依据：架构 §二 2.1（外部参与者与边界）、§七 SEAM-12 拆分理由（深链失败归外部应用是否安装、认证失败归应用锁）；架构 A-SEAMS、A-D4
- 触发与前置条件：P1 需要把用户交给边界外的对端——系统浏览器（登录）、HosPlayer（媒体导入）、MoonlightOH（串流）、外部 LocalSend（双通道传输），或在应用锁/文件夹锁处取得用户在场证明（系统认证）
- 可观测点：拉起方式与结果的诊断事件（`secure_login_browser_opened` / `_type_fallback` / `_type_failed` / `_type_error` / `_open_link_failed` / `_failed`、`hosplayer_launch_*`、`moonlight_launch_*`、`transfer_localsend_open_failed`）；HosPlayer 深链的四个字段；系统认证弹窗与 `AUTH_TRUST_LEVEL`；外部应用是否安装
- 期望：正常：每一次「交给外部」都必须以显式目标交出可核验的参数，并由 P1 记账——登录用 `startAbilityByType('browser', BrowserStartParameters)`，失败依次回退 `openLink`、再回退 `startAbility(ohos.want.action.viewData)`，每次回退记录对应事件而不是静默换路；HosPlayer 的深链只含 `protocolVersion`/`type`/`endpoint`/`name` 四个字段，经 `validate` 通过后才拼装为 `hosplayer://server/import` 的 Want，凭据由播放器自取；外部 LocalSend 只按显式 Want（bundleName/moduleName/abilityName）拉起，不做跨应用包名查询；系统认证统一 `ATL2`，只接受已录入的 `FACE`/`FINGERPRINT`/`PIN`。边界：契约未定的外部目标不得猜测——`MOONLIGHT_INTEGRATION_CONFIG` 的 bundleName/abilityName/moduleName 在基线中是**空串**（`services/MoonlightIntegrationConfig.ets:10-15`），故 `MoonlightLauncher.isAvailable()` 恒返回 false，串流成功路径当前不可达，只能走到「未安装 MoonlightOH」分支；`LOCAL_SEND_APP_TARGETS` 的 `cn.biandangroup.bcshare` 是未验证的猜测（未决 Q4），判据不据此断言契约成立。失败与恢复：非法参数在拼装深链前就被拒——HosPlayer 的 `unsafe_server_url`（非 http(s)、超长、含 userinfo 或 fragment）与 `invalid_server_name`（空或 >96 字符）直接抛出，不生成深链、不拉起；没有可用认证方式时既不放过也不误报成功，认证失败停在锁定层可重试、不清除锁定标志。安全与质量：凭据（用户名/密码/token）一律不进深链、不进 Want；三种浏览器回退都只接受 http(s) 登录 URL，非 http(s) 一律不进入浏览器。文档/代码冲突（以代码为准）：`docs/hosplayer-integration-prototype.md:5,31` 记的是 `openLink()`，代码实际用 `startAbility` 提交同一 `hosplayer://server/import` 的 viewData Want——判据写的是后者。
- 失败信息：期望「凭据不进深链、非法地址在拼装前被拒、外部应用缺失时明确告知」，实际「深链里带上了 token 或白名单外端点，或缺失的外部应用被静默失败，或未经用户在场即放行受保护内容」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:2123-2171 openSecureLoginBrowser 三路回退；:154-159 LOCAL_SEND_APP_TARGETS；:5799 launchLocalSendApp；entry/src/main/ets/services/HosPlayerLauncher.ets:13-14 Want action/baseUri；:64-77 validate（unsafe_server_url / invalid_server_name）；entry/src/main/ets/services/MoonlightLauncher.ets:12-24 isAvailable；entry/src/main/ets/services/MoonlightIntegrationConfig.ets:10-15 三个空串字段；entry/src/main/ets/services/AppSecurityAuthenticator.ets:9 AUTH_TRUST_LEVEL=ATL2；:66-71 availableAuthTypes；docs/hosplayer-integration-prototype.md:5,31（与代码冲突）
- 上游：R-SETUP-06、R-MEDIA-02、R-XFER-09、R-PRIV-01
- 待建测试：[集成] scripts/integration/external-app-handoff.mjs::深链不含凭据且非法地址在拼装前被拒
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-14 持久化：配置所有权与默认值
- 层级：接缝
- 父判据：O-SETUP-02、O-UI-01
- 强度：强
- 设计依据：架构 §2.4 数据归属表、§一（R-SETUP-05 逼出全仓统一的 `.tmp` + rename）、§六 Q-03；架构 A-SEAMS、A-D3
- 触发与前置条件：P1（以及 P2 的扩展侧缓存）需要持久化配置或偏好，随后由读方在启动或刷新时取回
- 可观测点：`filesDir/control-server.json` 的内容与 `confirmed`/`updatedAtMs`；ArkData preferences 各 store（`mesh_arc_navigation`、`mesh_arc_animation`、`mesh_arc_security`、文件传输偏好）的键与默认值；`cacheDir` 下的可丢弃副本与遗留路径；重置后是否残留引擎状态目录
- 期望：正常：每类持久数据只有一个属主与一种写入方式——控制服务器配置由 P1 经 `ControlServerConfig.save:67` 以 `<path>.<updatedAtMs>.tmp` 写后 `renameSync` 原子替换，读方 `load:46` 在文件缺失、半写或 `confirmed` 为假时回落 `unconfigured()` 而不是抛错；界面偏好由 ArkData preferences 持有，读侧一律 `getSync(key, default)`，缺键即取默认（`NavigationPreferences.ets:34-36`、`AnimationPreferences.ets:56-59`、`AppSecurityPreferences.ets:21-24`、`FileTransferPreferences.ets:20`）；路径由适配器固定——`StoragePaths.filesDir` 直接透传 `context.filesDir` 且刻意不选加密区、不建目录、不搬数据，可丢弃副本（Taildrop 出站暂存）只落 `cacheDir`（`RecoverableCachePaths.ets:10`），遗留的 `filesDir/taildrop-outbox` 仅作兼容识别（`:14`）。边界：`reset` 必须同时删掉配置与 `filesDir/tailscale` 引擎状态目录（`ControlServerConfig.ets:105-120`），使重置后的首次读取回到未配置态、下一次后端启动不沿用旧引擎状态。失败与恢复：写入失败时磁盘保持原状、状态位标 failed；偏好读取失败回落默认顺序与全部可见（R-UI-02）。保留期不一致（未决 Q-03）：扩展侧 Taildrop 缓存 7 天（`TailscaleVpnExtensionAbility.ets:56`）与诊断报告 24 h（`DiagnosticReportService.ets:10`）是两份不同数据、不同属主；R-DRIVE-05 声称 Taildrive 暂存 24 h，但 `components/TaildriveBrowser.ets` 中**找不到**对应的清理常量（该文件的 24 h 只是「yesterday」的显示分组 `:1891`），判据不据此虚构常量，标注为需求与代码需要一方修正。安全与质量：配置损坏必须回落而不是崩溃；`filesDir` 对三进程是同一份目录、没有锁也没有租约，一致性靠单一写者 + 原子写 + 新鲜度阈值，三者任一被打破即产生脏读。
- 失败信息：期望「配置原子落盘、缺键取默认、损坏回落未配置」，实际「半写文件被当成有效配置，或偏好缺键导致界面异常，或重置后残留旧引擎状态被读成已连接」
- 来源：entry/src/main/ets/services/ControlServerConfig.ets:22 normalize；:46-63 load 回落；:67-86 save 的 .tmp+rename；:105-120 reset 连删 filesDir/tailscale；entry/src/main/ets/services/StoragePaths.ets:8-15 filesDir 透传与不选加密区；entry/src/main/ets/services/RecoverableCachePaths.ets:10 cacheDir 暂存；:14 遗留 compat 路径；entry/src/main/ets/services/NavigationPreferences.ets:34-36；entry/src/main/ets/services/AnimationPreferences.ets:56-59；entry/src/main/ets/services/AppSecurityPreferences.ets:21-24；entry/src/main/ets/services/FileTransferPreferences.ets:20；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:56 7 天；entry/src/main/ets/services/DiagnosticReportService.ets:10 24 h；entry/src/main/ets/components/TaildriveBrowser.ets:1891 显示分组而非清理；docs/architecture/architecture.md §2.4 与第六节 Q-03
- 上游：R-SETUP-05、R-UI-02
- 测试：scripts/integration/persistence-ownership.mjs::半写配置回落未配置态且偏好缺键取默认
- 状态：closed
- 不确定特征：UNCERTAIN-CONFLICT
- 归属：—
- 复核：待复核

### O-SEAM-17 入口分发：Want / 通知 / 卡片 call → 应用外壳
- 层级：接缝
- 父判据：O-CARD-01、O-XFER-04
- 强度：强
- 设计依据：架构 §三 3.1（三进程结构）、§四 D2（文件是三进程唯一共同可达的介质）、§七 SEAM-10 → O-SEAM-17；架构 A-SEAMS、A-D4
- 触发与前置条件：三种外部入口唤醒 P1——桌面卡片的 `call` 事件、通知的 Want、以及 P3（Form 进程）自身的定时刷新
- 可观测点：`callee 'toggleVpn'` 的注册与 `performCardToggle` 的结果回写；`handleTaildropNotificationWant` → `AppShellIntentAdapter.toFeatureAction` 的解析结果与 AppStorage 键（`taildropOpenInbox`、`taildropNotificationAction`、`updateChangelogAction`、`taildriveCurrentPath`、`taildriveFilesTabActive`、`taildriveBackRequest`、`taildriveLockedFolderPaths`）；`APP_FOREGROUND_EVENT` 的 eventHub 分发；`EntryFormAbility` 的存活窗口与更新节拍
- 期望：正常：入口分发必须把外部事件翻译成应用外壳能消费的内部信号，而不是让外部直接调业务——卡片的 `call` 经 `EntryAbility.callee.on('toggleVpn'):99` 交给 `performCardToggle:202`（该 handler 按 `VpnStatusReader.read` 的当前态决定连接或断开，并同步 `noteRequestedStop` / `noteRequestedStart`，然后 `FormCardService.refreshAll` 回写状态）；通知 Want 经 `AppShellIntentAdapter.toFeatureAction:12` 解析成 `AppShellFeatureAction` 后写成 AppStorage 键（`EntryAbility.ets:299-303`），应用外壳用 `@StorageLink` 消费；前台事件经 `context.eventHub.emit(APP_FOREGROUND_EVENT):172` 广播给 `BridgeStatus` 与 `TaildriveBrowser` 的监听者。边界：内容未就绪时（未登录、未配置控制服务器）卡片入口必须 `raiseWindow:229` 抬起窗口而不是静默失败；非法 Want 被 `isValidNotificationAction` 丢弃（只接受 `open`/`save`/`later`，文件名不得为空、>255、`.`/`..`、含分隔符或控制字符，大小必须是非负安全整数）。失败与恢复：P3 不能常驻——最后一次生命周期回调后约 10 s 被系统回收，且**不得**导入 `backgroundTaskManager`（`EntryFormAbility.ets:13-16`），因此卡片只能靠自身周期刷新自纠：`form_config.json` 的 `updateDuration:1` 对应系统以 30 min 为单位的刷新节拍，应用进程存活时另由边沿触发的 `updateForm` 推送；两者都失败时卡片保留上一次读到的状态，不写、不推断。安全与质量：卡片只渲染 provider 供给的字符串（本地化在 provider 侧完成），不导入模块、不含图片、不设透明度，避免一张卡片异常导致全部卡片白屏（R-UI-05）；分发只搬事件与键，不在入口处执行连接或保存逻辑。
- 失败信息：期望「外部事件被翻译成 AppStorage/eventHub 内部信号并正确路由，卡片不常驻也能自纠」，实际「点击卡片后无动作或状态超过 30 min 未自纠，或 Want/通知动作未被解析进入应用外壳，或入口越权直接执行业务」
- 来源：entry/src/main/ets/entryability/EntryAbility.ets:99 callee.on('toggleVpn')；:172 eventHub.emit(APP_FOREGROUND_EVENT)；:191-200 toggleVpnFromCard；:202-227 performCardToggle；:229 raiseWindow；:288-304 handleTaildropNotificationWant/deliverAppShellFeatureAction；entry/src/main/ets/services/AppShellIntentAdapter.ets:12 toFeatureAction；:40-42 isValidNotificationAction；entry/src/main/ets/services/AppLifecycleEvents.ets:1 APP_FOREGROUND_EVENT；entry/src/main/ets/entryformability/EntryFormAbility.ets:10-17 约 10 s 回收与不可导入 backgroundTaskManager；entry/src/main/resources/base/profile/form_config.json:16 updateDuration；entry/src/main/ets/components/BridgeStatus.ets:645/931/1252/1605 AppStorage 键读写；entry/src/main/ets/components/TaildriveBrowser.ets:2347 taildriveCurrentPath；entry/src/main/ets/pages/Index.ets:7
- 上游：R-UI-05、R-XFER-06
- 待建测试：[集成] scripts/integration/entry-dispatch.mjs::卡片 call 与通知 Want 被翻译成内部信号且非法 Want 被丢弃
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核
