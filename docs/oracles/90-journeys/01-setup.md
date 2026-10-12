# MeshArc 旅程判据 · 安装与登录（O-SETUP-01 … O-SETUP-04）

### O-SETUP-01 首次启动：欢迎与更新日志
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-SETUP-01「首次启动引导用户认识本应用，确认后不再打扰」、R-SETUP-02「每个版本首次启动展示本次更新内容，可关闭、可不再显示、可在设置中重看」
- 触发与前置条件：全新安装后的首次启动（filesDir 下无 welcome-acknowledged 标记）；或升级到新的 appVersion/appVersionCode（update-changelog-seen-version 的内容与当前 `版本:版本号` 不一致）
- 可观测点：欢迎对话框（welcome_dialog_title / welcome_dialog_message）与更新日志 Sheet（UpdateChangelogSheet）的可见性；filesDir 下的 welcome-acknowledged 与 update-changelog-seen-version 文件内容；诊断事件 welcome_dialog_shown、welcome_dialog_acknowledged、update_changelog_shown、update_changelog_dismissed、update_changelog_only_on_update、update_changelog_opened
- 期望：正常：首次启动先弹欢迎对话框，用户确认后写入 welcome-acknowledged 标记并进入更新日志；更新日志可用「关闭」或「仅更新时显示」两种动作结束。边界：已确认过欢迎（标记存在）时不再弹欢迎；当前版本已被「仅更新时显示」标记（`only-on-update:<版本:版本号>`）时不再自动弹更新日志；欢迎与更新日志互斥，用 lifecycle 任务排队而不同时显示。失败与恢复：appShellReady、appVersionMetadataReady、securityPreferencesReady 未就绪或应用锁生效时不弹，元数据就绪后再判定；标记文件缺失或读取失败按「未见」处理，仍会展示，不会静默跳过新版本的更新内容。安全与质量：更新日志可在设置页手动重开（openUpdateChangelogFromSettings），「仅更新时显示」只关闭自动弹出、不阻止手动查看。
- 失败信息：期望「首次启动确认后不再自动打扰，且每个新版本首启展示一次更新内容」，实际「每次启动都重复弹欢迎/更新日志，或设置了『仅更新时显示』后仍被反复打扰」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:1399 showWelcomeDialogIfNeeded；entry/src/main/ets/components/BridgeStatus.ets:1143 showUpdateChangelogIfNeeded；entry/src/main/ets/components/BridgeStatus.ets:4963 openUpdateChangelogFromSettings；entry/src/main/ets/components/UpdateChangelogSheet.ets:44 requestAction；entry/src/main/ets/services/ReleaseChangelog.ets:21 RELEASE_CHANGELOG_ENTRIES
- 上游：R-SETUP-01、R-SETUP-02
- 待建测试：[E2E] scripts/e2e/first-run.mjs::首次启动展示欢迎与更新日志且确认后不再打扰
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-SETUP-02 配置控制服务器（含明文 HTTP 确认）
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-SETUP-03「登录前必须确认控制服务器地址；非法地址被拒并给出可理解原因」、R-SETUP-04「使用明文 HTTP 控制服务器须经用户显式确认风险后才生效」、R-SETUP-05「控制服务器配置原子落盘，损坏或缺失时回落到未配置态而不是崩溃」
- 触发与前置条件：未连接（不在 connecting / connected 状态）时，用户在设置页输入控制服务器地址并确认
- 可观测点：controlServerStatus 取值（saved / invalid / disconnect / failed）与对应界面文案；filesDir 下的 control-server.json 内容（controlURL、confirmed、updatedAtMs）；诊断事件 control_server_confirmed、control_server_confirm_failed、control_server_confirm_blocked、control_server_http_risk_shown、control_server_http_risk_cancelled
- 期望：正常：合法的 https 地址经 normalize 后写入 control-server.json（confirmed=true），状态显示已保存，并在地址变化时重启后端以改用新地址。边界：空串、非 http(s) 前缀、含 @ / ? / # / 空格、或长度超过 2048 的地址一律被拒并给出 invalid；已连接或正在连接时拒绝修改并提示先断开（disconnect）；明文 http:// 地址先弹风险确认对话框，取消则记 control_server_http_risk_cancelled 且不落盘，确认才写盘。失败与恢复：落盘走 `<path>.<updatedAtMs>.tmp` 再 renameSync 的原子替换；文件缺失、半写或 confirmed 为假时 load() 回落到 unconfigured() 而不是崩溃；写入失败时状态为 failed 且磁盘保持原状。安全与质量：明文 HTTP 必须经用户显式确认风险后才生效，且改成一个新的 http 地址要重新确认（requiresHttpControlServerRisk 比较 existing.confirmed 与地址）。
- 失败信息：期望「非法地址被拒并说明原因、明文 HTTP 未确认前不生效」，实际「非法地址被接受并在连接时才失败，或明文 HTTP 未经确认即被保存生效」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:1671 saveControlServer；entry/src/main/ets/components/BridgeStatus.ets:1694 confirmHttpControlServerRisk；entry/src/main/ets/services/ControlServerConfig.ets:22 normalize；entry/src/main/ets/services/ControlServerConfig.ets:67 save；entry/src/main/ets/services/ControlServerConfig.ets:46 load；entry/src/main/ets/services/SettingsPreferencesGateway.ets:37 requiresHttpControlServerRisk
- 上游：R-SETUP-03、R-SETUP-04、R-SETUP-05
- 待建测试：[E2E] scripts/e2e/control-server.mjs::配置控制服务器含明文 HTTP 风险确认与非法地址拒绝
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-SETUP-03 经系统浏览器登录 Tailscale
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-SETUP-06「登录通过系统浏览器完成；拉起浏览器的三种方式逐级回退」、R-SETUP-07「登录 URL 只能来自 http(s)；获取超时有明确失败态」
- 触发与前置条件：控制服务器已确认，用户在登录入口（未登录态）点击登录
- 可观测点：登录按钮内的加载态与 loginPrompt / loginHandoffStatus 文案；系统浏览器被拉起并打开 Tailscale 授权页；诊断事件 secure_login_browser_opened、secure_login_browser_type_fallback、secure_login_browser_type_failed、secure_login_browser_type_error、secure_login_browser_open_link_failed、secure_login_browser_failed
- 期望：正常：请求登录 URL 后依次尝试 startAbilityByType('browser', BrowserStartParameters)、openLink、startAbility(ohos.want.action.viewData) 三种方式拉起系统浏览器，打开授权页并记录 secure_login_browser_opened。边界：URL 为 PENDING、backend not ready、status unavailable 或 interactive login request 时按 60 次、每次 400 ms 轮询等待，每 10 次刷新状态并必要时重启后端，超时以 FAILED | login URL | timed out 收尾；控制服务器确认仍在进行时把轮询排在重启之后，避免首次点击与后端生命周期竞争。失败与恢复：拿到的 URL 不以 https:// 或 http:// 开头（含 rejected unexpected origin）时拒绝交给浏览器；三种拉起方式都失败时记 secure_login_browser_failed 并以 FAILED | secure browser handoff 结束，保持未登录态可重试。安全与质量：只接受 http(s) 来源的登录 URL，非 http(s) 一律不进入浏览器。
- 失败信息：期望「经系统浏览器打开 Tailscale 授权页完成登录」，实际「停在同一页面无响应，或把非 http(s) 的链接/intent 交给浏览器」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:2052 openSecureLogin；entry/src/main/ets/components/BridgeStatus.ets:2123 openSecureLoginBrowser；entry/src/main/ets/components/BridgeStatus.ets:2171 pollSecureLogin
- 上游：R-SETUP-06、R-SETUP-07
- 待建测试：[E2E] scripts/e2e/browser-login.mjs::经系统浏览器登录并回落到未登录态
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-SETUP-04 退出登录（须先断开）
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-SETUP-08「退出登录前必须先断开连接，否则只提示不执行」、R-SETUP-09「退出登录清理对端与出口节点状态，回到未登录态」
- 触发与前置条件：用户在设置-账户区查看或点击退出登录
- 可观测点：账户详情面板的文案与按钮（已连接时显示 logout_disconnect_first 提示且不渲染退出按钮，未连接时渲染 logout-open 按钮）；退出后的对端列表、出口节点与 loginHandoffStatus；logoutStatus 取值
- 期望：正常：未连接时点退出，经 confirmLogout 二次确认后调用后端 logout，成功后清空对端列表（applyPeers([])）、出口节点（exitNodes=[]）与登录轮询，loginHandoffStatus 回到 Secure Login Pending，回到未登录态。边界：已连接（isConnected）时账户面板只显示 logout_disconnect_first 提示文本、不渲染退出按钮，因此连接中无法退出；logoutInProgress 期间退出按钮禁用，重复点击不重入。失败与恢复：后端 logout 返回 FAILED 时 logoutStatus 以 FAILED 开头并保留现状、不误清状态；无对端或出口节点时清空是幂等的。安全与质量：退出是破坏性动作，必须先经确认对话框（logout_confirm_title / logout_confirm_message）确认。
- 失败信息：期望「连接中只提示先断开、不执行退出；退出后对端与出口节点状态被清空」，实际「连接中仍能退出，或退出后仍显示旧对端/旧出口节点」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:11873 logout_disconnect_first；entry/src/main/ets/components/BridgeStatus.ets:2604 confirmLogout；entry/src/main/ets/components/BridgeStatus.ets:2623 logout
- 上游：R-SETUP-08、R-SETUP-09
- 待建测试：[E2E] scripts/e2e/logout.mjs::连接中先提示断开且退出后清理账户状态
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
