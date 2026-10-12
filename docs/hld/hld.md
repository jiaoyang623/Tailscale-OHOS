# HLD 概要设计

- 流程版本：a01 · 层：HLD
- 上层输入：`docs/architecture/architecture.md`（§2.2 子系统、§2.3 通信方式、§三 视图、§四 D1–D6、§五 旅程↔接缝、§六 未决项、§七 编号对照）
- 接缝判据：`docs/oracles/91-seams/`（已落 O-SEAM-10…17）；O-SEAM-01…09 的 ID 与范围以 `/tmp/mesharc/a01/SEAM-SPEC.md` 末表为准（正文待建）
- 单点判据：`docs/oracles/points/P1-background-status.md`、`docs/oracles/points/P3-session.md`
- 事实来源：生产代码 `entry/src/main/ets/**`、`entry/src/main/cpp/types/libtailscale_ohos/index.d.ts`，逐条给 `file:line`
- 本层做的：把每条接缝从「责任边界」细化成**接口与事件契约**（消费方不读提供方实现即可正确调用），并给出它分解出的单点判据归属
- 本层不做的：不新增需求、不改行为、不写单点判据正文（LLD 收尾）、不把计划写成实现

**引用可信度声明**：契约一律以生产代码为准；文档与代码冲突处标进 §七 未决项，不抹平。

---

## 一、上层架构与模块职责

HLD 模块沿用架构 §2.2 的子系统编号（S1…S9），只补一层「提供什么能力、消费什么能力、允许依赖谁」。依赖方向必须成立，否则 §五 的接缝出现责任空洞。

| 模块 | 所在进程 | 提供能力 | 消费能力 | 允许依赖 |
| --- | --- | --- | --- | --- |
| S1 界面外壳 `entryability/EntryAbility.ets`、`components/BridgeStatus.ets`、`components/*`、`pages/Index.ets` | P1 | 四页签导航与呈现；连接命令状态机；后端交接应答（UI 路径）；Taildrop 接收编排（picker/媒体库）；外部应用拉起；应用锁 | S5 文件协议、S4 引擎（P1 侧一份）、S6 持久化、S7 卡片契约、S8 横切 | S5、S6、S7、S8、S10；**禁止**直接写扩展私有的状态机 |
| S2 无 UI 控制面 `services/VpnSessionController.ets`、`VpnReconnectSupervisor.ets`、`VpnBackgroundTaskManager.ets`、`EntryAbility` 的 callee | P1 | 卡片/后台恢复的独立连接与断开；后端交接第二应答方；掉线自动恢复；长时任务持有与释放 | S4（P1 侧引擎）、S5 文件协议、S6、S8 | S4、S5、S6、S8 |
| S3 VPN 扩展 `vpnextensionability/TailscaleVpnExtensionAbility.ets`、`services/VpnNetworkMonitor.ets` | P2 | 创建/销毁 TUN；驱动引擎（启动、重绑、快照、探测转发）；发布状态与对端快照；Taildrop/Taildrive 引擎侧；网络回调重绑 | S4（P2 侧一份）、S6、S7、S8 | S4、S6、S7、S8 |
| S4 引擎边界 `entry/src/main/cpp/napi_init.cpp` → `libtailscale_ohos.so` → `libtailscale_go.so`，声明于 `index.d.ts`（**46 条 `export const`**，其中 `backendStart`、`backendRestartWithTun` 两条声明各占两行） | P1 与 P2 **各一份** | 把 Go 引擎能力暴露成 ArkTS 可调函数；把 TUN fd 交给引擎 | 无（叶子） | 无（叶子） |
| S5 跨进程文件协议（无独立代码文件，由收发两端共同实现） | 横跨 P1/P2/P3 | 请求-应答与状态发布；「清响应 → 写请求 → 轮询响应」握手；`requestId` 匹配 | S6 | S6 |
| S6 持久化与状态 `services/ControlServerConfig.ets`、`StoragePaths.ets`、`RecoverableCachePaths.ets`、`*Preferences.ets`、`services/DiagnosticEventStore.ets` | P1/P2/P3 | 见 §四 数据归属 | 无（叶子） | 无（叶子） |
| S7 卡片 `entryformability/EntryFormAbility.ets`、`services/FormCardService.ets`、`widget/pages/VpnToggleCard.ets` | P3 | 只读状态文件渲染卡片；把点击转成对 P1 的 `call` | **只允许** `VpnStatusReader`（读 `vpn-probe-status.txt`）与 `FormCardService` | 只允许 S6/S8 |
| S8 横切策略 `services/DiagnosticPrivacy.ets`、`DiagnosticReportService.ets`、`HosPlayerLauncher.ets`、`MoonlightLauncher.ets`、`*RequestGuard`、hilog(domain `0x0000`) | 全部 | 脱敏、报告导出、深链参数校验、陈旧异步结果的世代守卫 | 无（被依赖） | 无（被依赖） |
| S9 构建与交付 `scripts/build.sh`(macOS)/`build.ps1`(Windows)、`scripts/build-go.sh`、`scripts/verify-artifacts.ps1` | 构建机 | 交叉编译引擎 → 装配 HAP → 签名 → 产物校验 | 不在运行期 | 不在运行期 |

**依赖方向规则（必须成立）**

1. `S1 → S5 → S3`：UI 请求扩展只经文件，**没有** S1 直接调 S3 方法的路径。
2. `S3 → S5 → S1`：扩展只能请求，不能命令。设计上唯一「必须由人回答」的反向命令是替换 VPN 批准（S1 写 `vpn-replace-approved` → S3 读），但**本基线在仓库内找不到写方**（§七 Q-03）；真正在跑的是「UI 提示用户先手动断开其它 VPN」。
3. `S7 → S6/S8` 之外**无依赖**：卡片不导入 `backgroundTaskManager`、不导入原生桥。
4. `S4` 可被 S1/S2/S3 依赖，但**不得**被 S7 依赖。

**结构性事实（承接架构 §3.1，本层不改）**：`components/BridgeStatus.ets` 15,149 行，**不是**纯视图，同时持有连接命令状态机、后端交接应答、Taildrop 编排、媒体/Taildrive 入口。这是 D1（两条编排）的第一个根因；本层只在契约里逐字钉住两条路径必须交出同一套文件名、超时与词表。

---

## 二、接口与事件契约

**本层主体。每条接缝一张契约卡，字段固定：通道 / 方向 / 载荷格式 / 顺序与时机 / 错误与责任 / 幂等性 / 可观测点。** 17 条接缝 O-SEAM-01…O-SEAM-17 全部出现；不掌握处写 `不确定特征` 并记入未决项，但不缺席。所有文件路径均为 `context.filesDir`（`StoragePaths.ets:6-7` 说明该目录跨能力共享）；文件名与常量逐字取自代码。

### C-01 · O-SEAM-01 应用进程 ↔ VPN 扩展：生命周期命令通道

- **通道**：三条文件——`vpn-connect-config.json`（连接配置投递）、`vpn-stop-request.json`（停止请求）、`vpn-stop-response.json`（停止应答）。常量分别见 `VpnCommandGateway.ets:127` 调用点与 `TailscaleVpnExtensionAbility.ets:61-62`、`:58-59`；`VpnSessionController.ets:14-16` 逐字镜像同一批名字（`VPN_CONNECT_CONFIG_FILE_NAME` / `VPN_STOP_REQUEST_FILE_NAME` / `VPN_STOP_RESPONSE_FILE_NAME`）。
- **方向**：配置：P1 写（`BridgeStatus.stageVpnConnectConfig`，`stageConnectConfig` 见 `VpnCommandGateway.ets:127-147`；headless 路径 `VpnSessionController.connect:100`），P2 读并消费（`consumeVpnConnectConfig:780-802`）。停止：P1 写请求（`BridgeStatus.stopVpnProbe:2502`、`VpnSessionController.disconnect:118-140`），P2 读并写应答（`processBackendStopRequest:1057-1082`、`stopVpnAndBackend:1084-1114`），P1 读应答。
- **载荷格式**：
  - `vpn-connect-config.json`：`VpnConnectConfigHandoff = { createdAtMs: number, config: string }`（`VpnCommandGateway.ets:178-181`）。`config` 是引擎返回的 VPN 配置串（地址/路由/MTU 的 `|` 分隔文本）。
  - `vpn-stop-request.json`：`VpnStopRequest = { requestId: number }`（扩展 `:111-113`）。
  - `vpn-stop-response.json`：`VpnStopResponse = { requestId: number, status: string }`（扩展 `:115-118`）。
- **顺序与时机**：配置**先原子写后拉起扩展**——`.tmp` + `renameSync`（`VpnCommandGateway.ets:129-135`），扩展侧校验 TTL `VPN_CONNECT_CONFIG_TTL_MS`(15000 ms)（`:62`）、`0 < config.length ≤ 8192`、不以 `FAILED` 开头，且**读到即删**（`consumeVpnConnectConfig:783-791`）。停止：P1 先清响应（`VpnSessionController.ets:126-129` / `BridgeStatus:2521`）再写请求；扩展读请求后**先清请求文件**（`:1070`）再处理；P1 轮询响应 50 ms × 150 = 7.5 s（`BridgeStatus.ets:161-162`；`VpnSessionController.ets:20-21`）。扩展除 1 s 状态环外，用 `fileIo.createWatcher(requestPath, FILE_WATCH_CLOSE_WRITE)` 监听停止请求（`:958-969`），watcher 注册失败时 1 s 状态环兜底（`:967`）。
- **错误与责任**：配置 TTL 过期/超长/`FAILED` → 扩展放弃投递配置，回退 `restoreBackendVpnConfig`（`:747-778`：`backendStart` + `backendVpnConfig` 250 ms × 60 轮询）。停止超时（7.5 s 无匹配应答）→ P1 仍调 `stopVpnExtension`，视为无害（`pollVpnStopResponse:2535-2539`「Unanswered means the extension is already gone」），记 `vpn_backend_stop_timeout`。扩展停后端失败记 `vpn_backend_stop_failed`，仍回写应答。
- **幂等性**：`requestId` 匹配（`VpnSessionController.matchesRequest:263-270`、`BridgeStatus:2547`）；扩展处理前清请求文件使同一请求不被二次处理；`onCreate` 清掉上一会话遗留的 `vpn-stop-request/-response`（`:358-359`），避免旧请求停掉新会话。
- **可观测点**：扩展 `vpn_config_handoff_used` / `vpn_config_handoff_fallback`（`:758`、`:761`）、`vpn_tun_destroyed`、`vpn_backend_stopped` / `vpn_backend_stop_failed`（`:1105-1108`）、`fast_reconnect_config_staged` / `fast_reconnect_config_failed`（`:1127`、`:1118`）；UI `connect_requested`、`vpn_start_requested` / `vpn_start_failed`、`disconnect_requested` / `disconnect_completed` / `disconnect_failed`、`vpn_backend_stop_timeout`、`vpn_config_handoff_staged` / `vpn_config_handoff_failed`（`BridgeStatus.ets:2395`、`:2486`、`:2494`、`:2517`、`:2536`、`:2579`、`:2596`、`:2421`、`:2423`）。

### C-02 · O-SEAM-02 应用进程 ↔ VPN 扩展：后端交接

- **通道**：`vpn-backend-handoff-request.json`（P2 → P1）、`vpn-backend-handoff-response.json`（P1 → P2）。常量：扩展 `:29-30`；`BridgeStatus.ets:163-164`；`VpnSessionController.ets:17-18`。
- **方向**：P2 写请求、读应答；**两个应答方**——UI 路径 `BridgeStatus.processVpnBackendHandoffRequest:3407`，headless 路径 `VpnSessionController.answerBackendHandoff:150`（架构 D1）。
- **载荷格式**：请求 `VpnBackendHandoffRequest = { requestId: number }`（扩展 `:120-122`、`VpnSessionController.ets:32-34`）；应答 `VpnBackendHandoffResponse = { requestId: number, status: string }`（扩展 `:124-127`、`VpnSessionController.ets:36-39`）。
- **顺序与时机**：P2 `requestUiBackendHandoff:645-681` 先清响应（`:653`）、原子写请求（`:654`）、写状态 `VPN interface established | backend handoff pending`（`:658`），再轮询 100 ms × 150 = **15 s**（`:31-32`、`:659`）；命中同 `requestId` 时**先清响应再返回 status**（`:668-670`）。P1 两实现都在读请求后**先清请求文件**再停后端再写应答（`BridgeStatus:3420-3436`；`VpnSessionController:155-169`）。headless 应答循环 250 ms × 60 = 15 s，且**刻意不 await**（`VpnSessionController.ets:106-110`）。UI 应答由 1 s 连接轮询触发（调用点 `BridgeStatus.ets:3315`），前置条件 `connectInProgress && 命令存续 && visibleStatus 含 backend handoff pending`（`:3408-3412`）。
- **错误与责任**：无人应答 → P2 记 `vpn_backend_handoff_timeout` 并 `destroyProbeTun`（`:679-680`、`:531-534`）。停后端失败 → 应答方**仍写应答**，status = `FAILED | backend handoff | stop unavailable`（`VpnSessionController.ets:161`），记 `vpn_backend_handoff_stop_failed`——扩展要的是「有人认领交接」，不是后端真停。请求 `requestId ≤ 0` 或非 JSON → 清请求、记 `vpn_backend_handoff_request_invalid`、**不作答**（`:156-160`、`:178-185`）。
- **幂等性**：`requestId` 匹配；应答方清请求文件使同一次请求不会被应答两次；P1 发起连接前清空两个交接文件（`clearVpnBackendHandoffFiles:3401-3405`、`VpnSessionController.clearHandoffFiles:258-261`）。
- **可观测点**：扩展 `vpn_backend_handoff_request_failed`（`:655`）、`vpn_backend_handoff_timeout`（`:679`）；UI `vpn_backend_handoff_stopped` / `vpn_backend_handoff_stop_failed`（`BridgeStatus:3432-3433`、`VpnSessionController:170-171`）、`vpn_backend_handoff_request_invalid`（`VpnSessionController:158`）。

### C-03 · O-SEAM-03 VPN 扩展 → 应用进程：状态与心跳

- **通道**：`vpn-probe-status.txt`（主状态）；随环发布 `vpn-config-summary.txt`、`vpn-peer-probe-status.txt`（`TailscaleVpnExtensionAbility.ets:955`、`:702-726`）。路径适配见 `StoragePaths.vpnStatusPath`（`StoragePaths.ets:17-19`）。
- **方向**：P2 只写（`writeStatus:1904-1907`、`writeCurrentStatusHeartbeat:1909-1912`）；P1 全部读方与 P3 只读（`VpnStatusReader.read:33-67`、`VpnBackgroundTaskManager.readStatus:344-374`、`FormCardService.buildBindingData:28-41`）。
- **载荷格式**：`<可见状态文本> | heartbeatMs=<毫秒时间戳>`（`:1910-1911`）。可见状态文本来自 `backendSnapshot().status`，含 `state=Running`、`tun=true`、`txBytes=<n>`、`rxBytes=<n>` 等字段；`vpn-config-summary.txt` 是 `addressCount=… | routeCount=… | hasIPv4Address=…` 等（`:719-725`）；`vpn-peer-probe-status.txt` 为原始探测串。
- **顺序与时机**：1 s `statusTimer`（`:905-951`）**先写心跳再拍快照**，使 liveness 独立于可能耗时数秒的 `backendSnapshot`（`:906-908`）；快照完成后覆写状态与两份快照文件。写用原子写 `.tmp` + `renameSync`（`writeAtomicTextFile:1935-1953`）。新鲜度：>15 s 视为**不确定**而非健康（`VpnStatusReader.ets:9,43`；`VpnBackgroundTaskManager.ets:14`）。
- **错误与责任**：写状态 best-effort，**永不阻断 VPN 启动**（`writeTextFile:1921-1923` 注释）；快照失败保留上一次已知 backend 状态并记 `vpn_snapshot_unavailable`（`:939-946`）。读侧把不确定转成「不新建长时任务、已持有的有界宽限后才释放」（C-11）。`onDestroy` 写 `VPN extension destroyed`（`:1995`）。
- **幂等性**：每秒整文件覆写（last-writer-wins）；`VpnStatusReader` 与 `readStatus` 词表必须逐字一致（`VpnStatusReader.ets:27-31` 头注）。
- **可观测点**：扩展 `vpn_snapshot_unavailable`、`vpn_connected`（`:546`）；P1 侧由读方派生状态；长时任务事件见 C-11（`background_started`、`background_status_timeout` 等）。

### C-04 · O-SEAM-04 VPN 扩展 → 应用进程：对端快照

- **通道**：`vpn-peers.json`。常量：扩展 `:57`；`BridgeStatus.ets:203`。路径 `peerSnapshotFilePath`（`BridgeStatus.ets:3592-3595`）。
- **方向**：P2 只写（`writePeerSnapshot:1000-1008`，随 1 s 快照）；P1 只读（`refreshPeerSnapshot:3597-3634`）。
- **载荷格式**：`PersistedPeerSnapshot = { peers: PeerSummary[], meshArcReceiver: MeshArcReceiverStatus, updatedAtMs: number }`；`PeerSummary = { key, name, os, osVersion?, deviceModel, deviceType, addresses: string[], online: boolean, exitNode: boolean, keyExpired: boolean, keyExpiryUnixMs: number, localSend? }`（扩展 `:67-88`）。
- **顺序与时机**：随 1 s 快照环原子写（`writeAtomicTextFile`）。P1 接受条件：`updatedAtMs > 0 && 0 ≤ age ≤ 5000 ms`（`BridgeStatus.ets:3606`），且只保留 `key` 匹配 `/^peer-[a-f0-9]{16}$/` 且 `name` 非空的项（`:3610`）。
- **错误与责任**：写侧失败不影响隧道（快照是可选服务）；读侧超 5 s 或解析失败**保留上一次有效列表、不清空**（`:3631-3634`），避免闪成空列表。`onCreate` 写空快照（`:341`）。
- **幂等性**：每环整文件替换；P1 用 `peerSnapshotSignature` 去重（`:3620-3623`）。
- **可观测点**：P1 `applyPeers`、`logServiceStatusIfChanged`（`:3622`、`:3627`）；无专门诊断事件名（自由字符串）。

### C-05 · O-SEAM-05 应用进程 ↔ Go 引擎：生命周期面

- **通道**：N-API 方法（逐字，`index.d.ts`）：`backendStart(stateDir, deviceModel, osVersion, controlURL)`、`backendStop()`、`backendStopAsync()`、`backendLogout()`、`backendLogoutAsync()`、`backendStatus()`、`backendSnapshot()`、`backendRestartWithTun(stateDir, deviceModel, osVersion, controlURL, fd)`、`tunFdProbe(fd)`、`probeEngine()` / `probeEngineAsync()`、`hello()`。声明于 `index.d.ts:1-48`。
- **方向**：两进程各加载一份（架构 D3）。P1 经 `VpnCommandGateway.ets:99-117`、`AccountDiagnosticsGateway.ets:48-69` 调用；P2 直接调 `nativeBridge.backendRestartWithTun`（`:537`）、`backendStop/Async`（`:1104`、`:1976`）、`backendVpnConfig(Async)`。
- **载荷格式**：入参与返回均为 `string`；`backendStatus()` 形如 `state=Running | tun=true …`（读侧以 `includes('state=Running')` 判活跃，`VpnSessionController.ets:243`）；`backendSnapshot()` 返回 JSON 串（`{status, peers, taildrop, meshArcReceiver}`，见扩展 `:922`、`:853`）；`tunFdProbe` 返回以 `OK` 开头的串。
- **顺序与时机**：正常连接 P1 `backendVpnConfigWithRecovery`（`BridgeStatus.ets:2440-2460`，失败后 `startBackend` + 500 ms × 20 重试）取得配置；扩展 `restoreBackendVpnConfig`（`:747-778`）无投递配置时 `backendStart` + `backendVpnConfig` 250 ms × 60；建 TUN 后 `backendRestartWithTun`（`:537`），再 `waitForVpnBackend` 100 ms × 150（`:840-870`）。交接：P1 在扩展重启前 `stopBackend`（C-02）。断开：扩展 `backendStopAsync`；`onDestroy` 调 `backendStop`（`:1976`）。
- **错误与责任**：返回串以 `FAILED` 开头即失败态，调用方保留并转成可读状态；`backendStop/Logout` 只在 P1 调（`AccountDiagnosticsGateway.ets:49`）——**它作用于哪个实例未验证**（§七 Q-01）。
- **幂等性**：`stateDir` 固定 `filesDir/tailscale`（`VpnCommandGateway.ets:100`、扩展 `:538`、`:751`）。**Q-01**：若平台把两个进程里的同一份 `.so` 视为一个运行时，则 P1 的一次 stop 会连带停掉 P2 引擎，单写者假设被打破。
- **可观测点**：P1 `backend_recovery_requested` / `backend_recovery_completed` / `backend_recovery_failed`、`vpn_preflight_failed`、`vpn_start_requested`（`BridgeStatus.ets:2445`、`:2454`、`:2458`、`:2413`）；扩展 `vpn_connected`。

### C-06 · O-SEAM-06 应用进程 ↔ Go 引擎：只读与设置面

- **通道**：N-API：`backendPeers()`、`backendAccount()`、`backendExitNodes()`、`backendNetworkSettings()`、`backendSetExitNode(id)` / `backendSetExitNodeAsync(id)`、`backendSetNetworkSetting(key, enabled)` / `backendSetNetworkSettingAsync(key, enabled)`、`backendSnapshot()`、`controlProbe()`、`mediaProbeSelfTestAsync()`、`tailscaleVersion()`（`index.d.ts:19-33,47`）。
- **方向**：P1 只读经 `HomeReadOnlyGateway.ets:8-18`；设置经 `NetworkSettingsGateway.ets:51-67`；账户/诊断经 `AccountDiagnosticsGateway.ets:44-90`。
- **载荷格式**：`string` 进 / `string` 出，JSON 由 ArkTS 侧 `JSON.parse`。设置 `key ∈ {'routeAll', 'exitNodeAllowLANAccess'}`（`NetworkSettingsGateway.ets:3`），`enabled: boolean`。
- **顺序与时机**：设置写入被 `NetworkSettingsUpdateQueue` 串行化，只保留最新选择、以代际判权威（`NetworkSettingsGateway.ets:14-48`）；出口节点/子网路由变更必须在未连接时生效（连接前 `queueExitNodeUpdate`，`BridgeStatus.ets:1938`）。
- **错误与责任**：读失败/迟到结果用 `*RequestGuard` 世代守卫丢弃（`HomeReadOnlyGateway.ets:22-36`、`AccountDiagnosticsGateway.ets:23-38`）；原生异常经 `DiagnosticPrivacy.formatNativeFailure`（`AccountDiagnosticsGateway.ets:59,67,76`）。
- **幂等性**：设置写按 generation 只认当前值；重复投递覆盖 pending。
- **可观测点**：无专门事件名；`inspectNativeBridge`、`probeEngine` 结果进入诊断报告。

### C-07 · O-SEAM-07 应用进程 ↔ VPN 扩展：Taildrop 通道

- **通道**：请求环文件 `taildrop-send-request.json`、`taildrop-cancel-request.json`（P1 → P2）；接收环 `taildrop-receive-request.json`（P1 → P2）、`taildrop-receive-response.json`（P2 → P1）；发布文件 `taildrop-targets.json`（P2 → P1 的 1 s 快照，`writeTaildropSnapshot:983-998`）。常量：扩展 `:41-47`；`BridgeStatus.ets:167-174`。
- **方向**：发送/取消 P1 写、P2 读（`processTaildropSendRequest:1713`、`processTaildropCancelRequest:1456`）；接收 P1 写请求、P2 写应答（`processTaildropReceiveRequest:1533`）；快照 P2 写、P1 读（`refreshTaildropSnapshot:3867`，读 `taildrop-targets.json`）。
- **载荷格式**：
  - `TaildropSendRequest = { requestId: number, targetKey: string, outboxRoot: string, files: {path: string, name: string, size: number}[] }`（扩展 `:182-193`；`BridgeStatus` 侧 `TaildropSendFile` 多一个 `previewPath: string`，`BridgeStatus.ets:370-382`）。
  - `TaildropCancelRequest = { requestId: number }`（扩展 `:195-197`）。
  - `TaildropReceiveRequest = { requestId: number, action: string, name: string, inboxRoot: string, path: string }`（`action ∈ {'stage','delete','clear'}`，`TaildropReceiveGateway.ets:10-16`）。
  - `TaildropReceiveResult = { requestId, action, state, reason, name, size, path }`（`state ∈ {'staged','completed','failed'}`，扩展 `:199-2xx`、`:1522-1531`）。
- **顺序与时机**：请求环 **100 ms**（`:884-897`），接收环 **250 ms**（`:901-903`）与 1 s 快照环；P1 先清响应再写请求、按 `requestId` 轮询。接收 UI 侧超时：backend 45 s、保存 60 s（`BridgeStatus.ets:183-184`、`:8461-8463`）。
- **错误与责任**：发送请求非法 → P2 写失败 summary 并清理请求文件（`:1728-1732`）；接收请求非法 → 写 `failed | invalid_request`（`:1548-1551`）；原生异常 → `extension_error`。**接收完成后才删对端等待文件**（R-XFER-07）；删除走 `delete`/`pending-delete` 分支（`confirmDiscardTaildropFile:8321`、`discardTaildropFile:8343`）。
- **幂等性**：`requestId` 匹配；P2 读请求后清文件；`TaildropReceiveGateway.claimRemoteDelete`（`:82-92`）与 `claimNotificationAction`（`:50-57`）去重；取消要求 `requestId === latestTaildropSnapshot.transfer.requestId` 且状态 `queued|sending`（`:1471-1474`）。
- **可观测点**：`taildrop_send_requested` / `taildrop_send_completed` / `taildrop_send_failed` / `taildrop_send_cancelled` / `taildrop_send_cancel_failed`（扩展 `:1744`、`:1756-1757`、`:1485`、`:1487`）、`taildrop_receive_requested` / `taildrop_receive_staged` / `taildrop_receive_completed` / `taildrop_receive_failed` / `taildrop_receive_delete_requested` / `taildrop_receive_cache_clear_requested`（`:1554-1556`、`:1563-1564`）；P1 侧 `taildrop_send_queued`、`taildrop_receive_queued`、`taildrop_media_receive_queued`、`taildrop_receive_timeout`、`taildrop_receive_inbox_unavailable`、`taildrop_receive_delete_deferred`、`taildrop_pending_delete_requested`、`taildrop_file_cache_ready`、`taildrop_media_preview_ready`、`taildrop_thumbnail_unavailable`。
- **旁路事实（架构 D3 的明确直连用法）**：当 `!isConnected() && backendStatus.includes('state=Running')` 时，P1 的 Taildrop 接收**直接调 `nativeBridge.backendTaildropReceiveAsync`**，绕过文件协议（`BridgeStatus.ets:8213-8229`，`useDirectTaildropBackend`）。这是 O-SEAM-05/07 交界处需在集成测试中显式覆盖的路径。

### C-08 · O-SEAM-08 应用进程 ↔ VPN 扩展：Taildrive 通道

- **通道**：四对请求/应答文件——query：`taildrive-query-request.json` / `taildrive-query-response.json`；transfer：`taildrive-transfer-request.json` / `-response.json`；manualTransfer：`taildrive-manual-transfer-request.json` / `-response.json`；control：`taildrive-control-request.json` / `-response.json`。常量：扩展 `:48-55`；`TaildriveGateway.ets:4-11`。
- **方向**：P1 写请求、读应答（`TaildriveGateway.requestThroughVpnExtension:155-221`）；P2 读请求、写应答（`processTaildriveQueryRequest:1284`、`processTaildriveTransferRequest:1306`、`processTaildriveManualTransferRequest:1325`、`processTaildriveControlRequest:1340`）。
- **载荷格式**：请求 `TaildriveExtensionRequest = { requestId: number, operation: string, payload: string }`（`TaildriveGateway.ets:19-23`）；应答 `TaildriveExtensionResponse = { requestId: number, result: string }`（`:25-28`）。`operation` 允许集：query `['list','stat','mutate']`、transfer `['download','upload']`、manualTransfer `['download']`、control `['snapshot','cancel']`（扩展 `:1289,1311,1330,1345`）。
- **顺序与时机**：P1 先清响应（`TaildriveGateway.ets:193`）再写请求（`:194`），每 100 ms 轮询直到 `response.requestId === requestId`（`:198-213`）。单请求超时：query **32 s**、mutation **35 s**、transfer **30 min + 10 s**、control **5 s**（`:14-17`）。P2 读请求后清文件、校验 `requestId > 0`、`operation ∈ allowed`、`payload.length ≤ 32768`（`takeTaildriveRequest:1356-1379`），原生任务完成后**原子写**应答（`completeTaildriveRequest:1381-1413`）。
- **错误与责任**：P1 超时 → 写空请求文件并 `throw`（`:219-220`，由 UI 侧转成冲突/失败确认）；P2 原生 reject → 写 `state:"failed"` 的 JSON（`taildriveExtensionFailure:1415-1430`）。上传默认不覆盖，冲突需显式确认（R-DRIVE-04）。
- **幂等性**：`requestId` 匹配；四通道各自串行队列（`queryQueue`/`transferQueue`/`manualTransferQueue`/`controlQueue`，`TaildriveGateway.ets:103-106,160-178`），同一通道同时只有一个在途请求。
- **可观测点**：扩展 hilog（`Taildrive native task completed/rejected`、`Taildrive response write`，`:1391-1400`）；**无诊断事件名**（自由字符串）。

### C-09 · O-SEAM-09 应用进程 ↔ VPN 扩展：探测通道

- **通道**：`peer-connectivity-request.json` / `-response.json`、`sunshine-probe-request.json` / `-response.json`、`media-service-probe-request.json` / `-response.json`、`localsend-refresh-request.json` / `-response.json`。常量：扩展 `:33-40`。
- **方向**：P1 写请求、读应答（`PeerPathService.ets:86-115`、`SunshineProbeService.ets:83-112`、`MediaServiceProbeService.ets:96-125`、`BridgeStatus` 的 LocalSend 刷新 `:4162-4187`）；P2 读请求、写应答（`processPeerConnectivityRequest:1138`、`processSunshineProbeRequest:1187`、`processMediaServiceProbeRequest:1234`、`processLocalSendRefreshRequest:1010`）。
- **载荷格式**：请求 `{ requestId: number, peerKey: string }`（`SunshineProbeService.ets:88`；LocalSend 刷新无 peerKey）；应答 `{ requestId: number, result: string }`，`result` 是原生 JSON 串。
- **顺序与时机**：P1 先清响应再写请求，每 150 ms 轮询至超时：peer 12 s（`PeerPathService.ets:9`）、sunshine 3.5 s（`SunshineProbeService.ets:9`）、media 4 s（`MediaServiceProbeService.ets:17`）、LocalSend 25 s（`BridgeStatus.ets:152`）。P2 在 100 ms 请求环内处理（`:896`），部分探测也挂在 1 s 快照环（`:926-928`）。
- **错误与责任**：P2 原生 reject → 写 `extension_error` 结果 JSON（`:1162-1169`、`:1211-1216`、`:1266-1273`）；P1 解析为 `unknown`/`timeout`/`error` 并按 TTL 缓存（peer 25 s / 3 s、sunshine 60 s / 25 s、media 5 min / 60 s）。`peerKey` 必须匹配 `/^peer-[a-f0-9]{16}$/`，否则 P2 丢弃（`:1153`、`:1202`、`:1249`）。
- **幂等性**：`requestId` 匹配；P2 处理前清请求文件；`*InFlight` 标志防并发（`:1139`、`:1188`、`:1235`、`:1011`）；P1 用 `requestIds` 世代守卫丢弃迟到结果（`PeerPathService.ets:62-68`）。
- **可观测点**：`media_probe_started` / `media_probe_available` / `media_probe_completed` / `media_probe_failed` / `media_probe_rejected`（扩展 `:1250`、`:1254`、`:1261`、`:1272`、`:1280`）；peer/sunshine 探测无专门事件名。

### C-10 · O-SEAM-10 编排分叉：UI 路径 ↔ 无 UI 路径

- **通道**：不是单一文件，而是「两条编排对同一扩展交出同一套文件契约」——`vpn-connect-config.json`、`vpn-stop-request/-response.json`、`vpn-backend-handoff-request/-response.json`（`VpnSessionController.ets:12-18` 明确镜像 UI 侧名字）。
- **方向**：两条入口都是 P1 → P2；扩展无需知道请求来自哪个入口。
- **载荷格式**：与 C-01、C-02 逐字相同（本卡不重复字段，只钉「同步」）。
- **顺序与时机**：UI 路径 `BridgeStatus.beginVpnConnection:2351` → … → `requestVpnExtensionStart:2478`；headless 路径 `VpnSessionController.connect:80` → `ensureBackendReady`（250 ms × 40）→ `requestConnectConfig`（PENDING 时 500 ms × 20）→ `stageConnectConfig` → `clearHandoffFiles` → `startVpnExtension` → `answerBackendHandoff`（不 await）。两路径都必须实现交接应答半环（C-02）。
- **错误与责任**：交接无人应答 → 扩展记 `vpn_backend_handoff_timeout` 并自毁；**责任在 P1**。这条分叉已经真实失败过一次：卡片路径起初不应答交接，使每次 headless 连接都建 TUN、等 15 s、然后自毁（`docs/background-vpn-reliability.md`「a headless connect could never complete」）。收敛触发：出现**第三个**入口时必须抽共享模块，此前两份实现是登记在案的债务（`VpnSessionController.ets:53-63`）。
- **幂等性**：任一入口在已连接或断开在途时重复发起不得重入（`connect:81-84` 早退 UNCHANGED、`disconnect:119-122`）；命令状态机 `begin` 在途时返回 0（`VpnCommandGateway.ets:31-44`）。
- **可观测点**：三条对齐点必须可被集成测试逐条比对——**名字**（文件名）、**超时**（15 s 预算）、**词表**（状态词）。UI `vpn_start_requested` / `disconnect_completed`；headless `ui:vpn_stop_requested`、`ui:vpn_backend_handoff_*`（`VpnSessionController.record:187-189`）。

### C-11 · O-SEAM-11 应用进程 ↔ 系统：长时任务与实况窗

- **通道**：系统回调与 API——`backgroundTaskManager.on('continuousTaskCancel', …)`、`on('continuousTaskSuspend', …)`、`startBackgroundRunning(context, ['dataTransfer'], agent)`、`stopBackgroundRunning(context)`；实况窗 `notificationManager.publish`（`SlotType.LIVE_VIEW`，`typeCode 8`）。`module.json5:29-30` 声明 `backgroundModes ["dataTransfer"]`。
- **方向**：P1（`VpnBackgroundTaskManager`）向系统申请/释放；系统回调进入 P1。P3 明确**不可导入** `backgroundTaskManager`（`EntryFormAbility.ets:13-16`）。
- **载荷格式**：`startBackgroundRunning` 的 `WantAgentInfo` 指向 `EntryAbility`（`:207-212`）；实况窗 `NotificationRequest.content.systemLiveView = { typeCode: 8, title, text }`，`text = "↑ <tx>  ↓ <rx>"`（`:309-341`）。
- **顺序与时机**：每 1000 ms（`CONNECTION_CHECK_INTERVAL_MS`，`:16`）读 `vpn-probe-status.txt`；live 判定 = `connected`（`state=Running | tun=true`）或 `connecting`（含 `vpn interface established` 的新鲜心跳，`:171`、`:362-369`）；start/stop 经 `operationInFlight` 串行化（`:152`）。心跳龄 ≤ `VPN_STATUS_FRESH_MS`(15000)（`:14`）；陈旧/缺失时已持有的任务在 `VPN_STATUS_GRACE_MS`(60000) 宽限后才释放并记 `background_status_timeout`（`:15`、`:175-178`）；**从不凭旧证据新建任务**（`:182`）。实况窗按 `NOTIFICATION_UPDATE_INTERVAL_MS`(30000) 刷新（`:17`）。
- **错误与责任**：只有系统侧取消（非用户）才 `scheduleRetry`（`START_RETRY_BASE_MS` 30000 起、指数、`START_RETRY_MAX_MS` 300000 封顶，`:18-19`、`:392-396`）；用户取消（`USER_CANCEL`/`USER_CANCEL_REMOVE_NOTIFICATION`）→ `suppressedUntilDisconnect = true`，同一会话内不自行恢复（`:66-73`、`:182`）；读到 `disconnected` 立即清零重试态并释放（`:163-169`）。**责任空洞（本层确认的唯一空洞）**：P1 在后台且未持任务时会被冻结，此时若 P2 被杀导致掉线，没有任何子系统承诺恢复——恢复责任在 `VpnReconnectSupervisor`，而它恰恰是可能已被冻结的一方（`docs/background-vpn-reliability.md` Milestone 2；架构 D4 风险）。用户回到应用前保持断开。
- **幂等性**：`cancellationRevision` / `lifecycleGeneration` 保证销毁期间的迟到 start 结果被丢弃（`:206`、`:214-218`、`:226-234`）；非本任务的取消事件被忽略（`:59-62`）。`SPECIAL_SCENARIO_SUBMODE = 0` 使 special-scenario 路径**默认惰性**（`:31`、`:257-259`）。
- **可观测点**：`background_started`、`background_stopped`、`background_status_timeout`、`background_entered`、`background_user_cancelled`、`background_system_cancelled`、`background_suspended` / `background_resumed`、`background_listener_failed`、`background_suspend_listener_failed`、`background_operation_failed`、`background_stop_failed`、`background_notification_failed`、`background_started_special_scenario`（`:73,83,97,103,140,176,190,236,285,301,303,340`）。
- **单点判据**：O-BGTASK-01…15（P1-background-status.md）。

### C-12 · O-SEAM-12 应用进程 ↔ 系统：网络变化回调与重绑

- **通道**：系统默认网络回调（`@kit.NetworkKit` 的 `net.connection`），入口 `VpnNetworkMonitor.refresh:148`；重绑经 N-API `backendNetworkChangedAsync(interfaceName)`（`index.d.ts:9`，调用点 `VpnNetworkMonitor.ets:164`）。
- **方向**：回调进入 P2（`VpnNetworkMonitor` 在扩展进程注册，`:15-17` 注释「回调留在 VPN 进程」）；P2 把重绑交给引擎。P1 不参与。
- **载荷格式**：`interfaceName: string`（物理网络接口名）；**地址数据不跨越这条接缝**，只记承载类别与数值错误码（R-NET-04）。
- **顺序与时机**：变化被合并、去抖、限速——`SETTLE_MS` 750 ms 与 `MIN_REBIND_MS` 3000 ms（`VpnNetworkMonitor.ets:5-7`）；`revision`/`appliedRevision` 保证等待重绑期间到达的最新变化不被丢弃（`:185-186`）；`interfaceName` 空 → 记 `vpn_network_offline`。
- **错误与责任**：重绑失败归引擎重绑逻辑（P2），有界 5 s 重试（`RETRY_MS`，`:164` 附近），不要求用户重连。
- **幂等性**：同一承载重复回调被合并；只有重绑完成后才标记 applied。
- **可观测点**：`vpn_network_rebound_wifi` / `vpn_network_rebound_cellular` / `vpn_network_offline` / `vpn_network_refresh_failed`（`VpnNetworkMonitor.ets:172-179`）。**日志中不得出现地址数据**。

### C-13 · O-SEAM-13 应用 ↔ 外部应用与系统认证

- **通道**：系统拉起目标——浏览器 `context.startAbilityByType('browser', BrowserStartParameters)` → 回退 `context.openLink(url, { appLinkingOnly: false })` → 回退 `context.startAbility({ action: 'ohos.want.action.viewData', uri, entities: ['entity.system.browsable'] })`（`BridgeStatus.ets:2123-2169`）；HosPlayer `startAbility({ action: 'ohos.want.action.viewData', uri: 'hosplayer://server/import?…' })`（`HosPlayerLauncher.ets:12-14,57-62`）；MoonlightOH `startAbility({ bundleName, moduleName, abilityName, parameters })`（`MoonlightLauncher.ets:26-50`）；LocalSend `startAbility({ bundleName, moduleName, abilityName })`（`BridgeStatus.ets:154-160,5799`）；系统认证 `userAuth.getUserAuthInstance(…).start()`（`AppSecurityAuthenticator.ets:47-55`）。
- **方向**：P1 → 边界外对端；认证结果回到 P1。
- **载荷格式**：HosPlayer 深链只含 `protocolVersion` / `type` / `endpoint` / `name` 四字段（`HosPlayerLauncher.ets:26-32`）；系统认证 `AuthTrustLevel.ATL2`，`authType ∈ {FACE, FINGERPRINT, PIN}`（`AppSecurityAuthenticator.ets:9,66-84`）。
- **顺序与时机**：浏览器三路**逐级回退**，每次回退记对应事件而不是静默换路（`BridgeStatus.ets:2133,2138,2150,2159`）；HosPlayer 深链在 `validate` 通过后才拼装（`HosPlayerLauncher.ets:25,64-77`）。
- **错误与责任**：非法参数在拼装前被拒——HosPlayer `unsafe_server_url`（非 http(s)、含 userinfo、超长、含 `#`）与 `invalid_server_name`（空或 >96）直接抛（`:68-77`）；**凭据不进深链**；认证失败停在锁定层可重试、不清锁标志（`AppSecurityAuthenticator.ets:37-42`）。
- **幂等性**：`AppShellIntentAdapter` 的 `deliveredNotificationKeys` 去重（见 C-17）；认证每次重新挑战（16 字节随机，`AppSecurityAuthenticator.ets:44-45`）。
- **可观测点**：`secure_login_browser_type_failed` / `_type_error` / `_type_fallback` / `_open_link_failed`（`BridgeStatus.ets:2133,2138,2150,2159`）；`hosplayer_launch_*`、`moonlight_launch_*`、`transfer_localsend_open_failed`。
- **不确定特征**：`UNCERTAIN-WIRING`——`MOONLIGHT_INTEGRATION_CONFIG` 三字段为**空串**（`MoonlightIntegrationConfig.ets:10-15`），`MoonlightLauncher.isAvailable()` 恒 false，串流成功路径当前不可达；`LOCAL_SEND_APP_TARGETS` 的 `cn.biandangroup.bcshare` 是**未验证的猜测**（§七 Q-04）。

### C-14 · O-SEAM-14 持久化：配置所有权与默认值

- **通道**：`filesDir/control-server.json`（`ControlServerConfig.FILE_NAME`，`:12`）；ArkData preferences store：`mesh_arc_navigation`（`NavigationPreferences.ets:16`）、`mesh_arc_animation`（`AnimationPreferences.ets:18`）、`mesh_arc_security`（`AppSecurityPreferences.ets:10`）、文件传输偏好（`FileTransferPreferences.ets`）；可丢弃副本 `cacheDir/taildrop-outbox`（`RecoverableCachePaths.ets:10-11`）；遗留路径 `filesDir/taildrop-outbox`（`:15-17`）。
- **方向**：每类数据单一属主（P1，或 P2 的扩展侧缓存）；读方按需取回。
- **载荷格式**：`ControlServerSettings = { controlURL: string, confirmed: boolean, updatedAtMs: number }`（`ControlServerConfig.ets:5-9`）；偏好为键值：`navigation_order`/`navigation_hidden`/`navigation_bottom_margin`、`app_lock_enabled`/`folder_lock_enabled`/`locked_folder_paths`。
- **顺序与时机**：控制服务器配置 `.tmp` + `renameSync` 原子替换（`ControlServerConfig.ets:78,86`）；偏好 `getSync(key, default)`，缺键即默认（`NavigationPreferences.ets:34-37`、`AppSecurityPreferences.ets:21-24`）。读取在启动或刷新时进行。
- **错误与责任**：文件缺失/半写/`confirmed` 为假 → 回落 `unconfigured()` 而不抛错（`ControlServerConfig.ets:46-64`）；偏好读取失败回落默认（`:39-41`）。`reset` 同时删配置与 `filesDir/tailscale` 引擎状态目录（`:105-120`），使重置后不沿用旧引擎状态。
- **幂等性**：原子写 + 单一写者；重复 `save` 以新的 `updatedAtMs` 覆盖。**一致性前提**：`filesDir` 对三进程是同一份目录，**没有锁、没有租约**（架构 §2.4），一致性靠单一写者 + 原子写 + 新鲜度阈值。
- **可观测点**：无专门事件名；偏好 store 键可枚举。
- **不确定特征**：`UNCERTAIN-CONFLICT`——保留期在代码与需求间不一致（§七 Q-02）。

### C-15 · O-SEAM-15 诊断：记录、脱敏与报告导出

- **通道**：`filesDir/diagnostic-ui-events.ndjson`（P1 写）、`filesDir/diagnostic-vpn-events.ndjson`（P2 写）（`DiagnosticEventStore.ets:5-6`）；报告 zip 落 `cacheDir`（`DiagnosticReportService.ets:219-220`），经 `systemShare.ShareController` 分享（`:257-266`）。
- **方向**：P1 与 P2 各写自己的文件；读取方 P1 合并（`DiagnosticEventStore.load:33-42`，按 `timestampMs` 排序）。
- **载荷格式**：每行一条 `DiagnosticEvent = { timestampMs: number, source: string, event: string, phase: string, code: number }`（`DiagnosticEventStore.ets:8-14`）；`source` 决定落哪个文件（`vpn` → VPN 文件，否则 UI 文件，`:44-46`）。
- **顺序与时机**：写入即读-改-写整文件并套字节上限（`:27-30`）；单文件 `MAX_EVENTS_PER_FILE` = 100 事件（`DiagnosticPrivacy.ets:13`）、`MAX_EVENT_FILE_BYTES` = 24 KB（`:14`），超出淘汰最旧（`DiagnosticEventStore.ets:111-119`）；报告保留 `REPORT_RETENTION_MS` = 24 h 后 `cleanupExpiredReports` 清理（`DiagnosticReportService.ets:10,646-654`）。
- **错误与责任**：所有可能落盘/离开进程的文本（含 hilog）**必须**先经 `DiagnosticPrivacy.redactForLog:47-55`——URL、bearer/basic、token/secret 键、查询串令牌一律替换；错误只保留稳定类别 + 数字码（`classifyError:18-34`），原生错误文本从不保留。诊断 best-effort，永不影响 VPN 生命周期（`DiagnosticEventStore.ets:98-99`）。报告生成中途失败不分享半成品 zip 并删除残留（`DiagnosticReportService.ets:246-248`）。
- **幂等性**：追加写；超限淘汰最旧；`load` 去重靠截断（`:40-41`）。
- **可观测点**：事件名是**自由字符串、无受控词表**（§七 Q-05）；同一语义在两进程可能两种拼写（`VpnSessionController.record:187-189` 把 UI 侧事件写进 UI 文件）。

### C-16 · O-SEAM-16 VPN 替换批准通道

- **通道**：`filesDir/vpn-replace-approved`（扩展侧常量 `VPN_REPLACE_APPROVAL_FILE_NAME`，`:27`；路径 `vpnReplaceApprovalFilePath:728-730`）。**仓库内无写方**（全仓只有常量与读路径构造两个引用，`grep` 无任何写入调用）。
- **方向**：设计意图 P1 写、P2 读；**实际不可达**。
- **载荷格式**：文件内容为批准的毫秒时间戳（`approvedAtMs: number`，`consumeVpnReplaceApproval:738`）。
- **顺序与时机**（设计意图）：P2 `createTunWithConflictReplacement:577-608` 撞到 `VPN_EXISTS_ERROR_CODE`(2203002) 后，每 `VPN_REPLACE_APPROVAL_POLL_INTERVAL_MS`(200 ms) 轮询等待批准（`:597-606`），只有标记存在且年龄 ∈ `[0, VPN_REPLACE_APPROVAL_TTL_MS]`(10000 ms) 才 `consumeVpnReplaceApproval` 并 `replaceExistingVpn` 销毁既有 VPN 重建（`:598-599`、`:610-643`）。
- **错误与责任**：**实际（本基线）**：批准写方缺失 → approved-replace 路径不可达；真正在跑的是 UI 冲突对话框 `BridgeStatus.showVpnConflictDialog:4316`——先停掉本应用自己的扩展以清半建 VPN，再提示用户「请先断开其它 VPN」，责任落在用户侧。P2 记 `vpn_conflict`（`:566,593`），P1 把它翻成人能读的提示。
- **幂等性**：`consumeVpnReplaceApproval` 读到即清（`:739`）；TTL 过期即视为未批准。
- **可观测点**：`vpn_conflict`、`vpn_conflict_detected`、`vpn_conflict_acknowledged`、`vpn_replacement_approved`、`vpn_existing_destroyed` / `vpn_existing_destroy_failed`、`vpn_replace_retry`（`:612,617,620,637`）；状态 `FAILED | VPN conflict | code=2203002`。
- **不确定特征**：`UNCERTAIN-WIRING`——写方缺失；TTL 仅 10 s，用户切走时批准是否仍有效未验证（§七 Q-06）。

### C-17 · O-SEAM-17 入口分发：Want / 通知 / 卡片 call → 应用外壳

- **通道**：三种外部入口——卡片 `call`（`EntryAbility.callee.on('toggleVpn', …)`，`:99`）、通知 Want（`handleTaildropNotificationWant:288-295` → `AppShellIntentAdapter.toFeatureAction:12`）、P3 定时刷新；前台事件 `context.eventHub.emit(APP_FOREGROUND_EVENT)`（`:172`）。
- **方向**：外部事件 → P1 应用外壳；分发只搬事件与键，不在入口执行连接/保存逻辑。
- **载荷格式**：`AppShellFeatureAction = { openTaildropInbox: boolean, taildropNotificationAction: string }`（`AppShellIntentAdapter.ets:3-6`）；Want 参数键 `taildropOpenInbox`、`taildropNotificationAction`、`taildropNotificationFileName`、`taildropNotificationFileSize`、`taildropNotificationReceivedAtMs`、`taildropNotificationEventId`（`:14-19`）；内部信号写 AppStorage 键 `taildropOpenInbox`、`taildropNotificationAction`（`EntryAbility.ets:298-303`）。
- **顺序与时机**：卡片 `call` → `performCardToggle:202`（按 `VpnStatusReader.read` 当前态决定连接或断开，先 `noteRequestedStop`/`noteRequestedStart` 再调 `VpnSessionController`，然后 `FormCardService.refreshAll` 回写）；内容未就绪（未登录/未配控制服务器）时 `raiseWindow:229`，不静默失败。通知 Want → `toFeatureAction` 解析后经 `pendingAppShellFeatureActions` 排队，`pages/Index` 加载后投递（`:143-147`）。P3 不能常驻，靠 `form_config.json` 的 `updateDuration:1` 周期刷新（30 min 单位）自纠，应用进程存活时另由边沿触发 `updateForm` 推送（`FormCardService.refreshAll:47-73`）。
- **错误与责任**：非法 Want 被 `isValidNotificationAction:40-59` 丢弃（只接受 `open`/`save`/`later`，文件名不得空、>255、`.`、`..`、含分隔符或控制字符，大小必须非负安全整数）；`deliveredNotificationKeys` 去重（`:25-31`）；卡片更新失败保留上一次读到的状态，不写、不推断。
- **幂等性**：`eventId:action` 去重，超 64 条淘汰最旧（`AppShellIntentAdapter.ets:28-31`）；卡片 `refreshAll` 是幂等的全量推送。
- **可观测点**：无专门诊断事件名；`callee 'toggleVpn'` 注册失败记 hilog（`EntryAbility.ets:102`）。

### SWEBOK 六项逐项核对

| 项 | 适用性 | 说明 |
| --- | --- | --- |
| **输入事件** | 适用 | 进入系统的外部驱动：用户触屏（`BridgeStatus.beginVpnConnection:2351` 等）、卡片 `call`（`EntryAbility.ets:99,191`）、通知 Want（`:288`）、系统网络回调（`VpnNetworkMonitor.refresh:148`）、系统长时任务回调（`VpnBackgroundTaskManager.ets:57,78`）、系统认证结果（`AppSecurityAuthenticator.ets:29-34`）、扩展侧定时器（1 s / 100 ms / 250 ms）。契约见 C-01…C-17 的「方向」栏。 |
| **输出事件** | 适用 | 系统对外发出的信号：状态/心跳文件（C-03）、对端快照（C-04）、交接请求/应答（C-02）、Taildrop/Taildrive/探测应答（C-07/08/09）、长时任务与实况窗通知（C-11）、诊断 NDJSON（C-15）、卡片 `formProvider.updateForm`（C-17）、深链/Want 拉起外部应用（C-13）。 |
| **格式与协议** | 适用 | 两种协议：(a) 文件 JSON/txt，字段逐字见各卡「载荷格式」；(b) N-API `string` 进 / `string` 出（C-05/06），声明的 46 条 `export const` 见 `index.d.ts`。没有类型检查、没有 schema 版本；正确性靠 `requestId`、原子写与新鲜度。 |
| **顺序与时机** | 适用 | 握手「清响应 → 写请求 → 按 requestId 轮询响应」是全仓统一口径（各卡「顺序与时机」）；关键预算：交接 15 s（P2 100 ms × 150、P1 250 ms × 60）、停止 7.5 s（50 ms × 150）、Taildrive 32 s/35 s/30 min+10 s/5 s、探测 12 s/3.5 s/4 s/25 s、状态新鲜度 15 s、快照新鲜度 5 s、配置 TTL 15 s、批准 TTL 10 s。 |
| **端到端交易** | 适用 | §三 给出正常 / 边界 / 失败恢复三条路径并注明旅程与接缝判据。 |
| **持久化** | 部分适用 | 适用：配置与偏好（C-14）、诊断事件与报告（C-15）、一次性标记、引擎状态目录 `filesDir/tailscale`。**不适用**于 C-09 探测通道与 C-12 网络重绑——它们的结果只进内存缓存/引擎内存，探测结果按 TTL 过期，网络地址数据**刻意不落盘**（R-NET-04）；这两条接缝的持久化不适用，原因是其数据被设计为瞬态且（网络地址）出于安全不得持久化。 |

---

## 三、端到端交易

三条路径分别覆盖正常 / 边界 / 失败恢复，注明旅程判据（`O-*`）与接缝判据（`O-SEAM-*`）。

### 3.1 正常路径

**旅程 O-CONN-01 一键连接（UI 路径）**
`BridgeStatus.beginVpnConnection:2351` → 检查控制服务器/登录态 → `QueueExitNodeUpdate` → `requestVpnExtensionStart:2478`：`VpnCommandGateway.begin()` 取 commandId → `stageConnectConfig()` 原子写 `vpn-connect-config.json`（TTL 15 s）→ `startVpnExtension(Want)`。
`[P2]` `onCreate:339` → `createProbeTun:373` → `restoreBackendVpnConfig`（无投递配置则 `backendStart` + 250 ms × 60）→ `createTunWithConflictReplacement:509` → `backendRestartWithTun:537` → `requestUiBackendHandoff:645` 写 `vpn-backend-handoff-request.json{requestId}`，轮询 100 ms × 150。
`[P1]` `processVpnBackendHandoffRequest:3407` 读到请求 → `stopBackend()` → 写响应 `{requestId,status}`。
`[P2]` 命中响应 → 隧道可用 → 1 s 状态环写 `vpn-probe-status.txt`；`[P1]` `VpnBackgroundTaskManager` 读到 `vpn interface established` 判 `connecting`，已提前持有长时任务。
- **接缝判据**：O-SEAM-01（配置投递）、O-SEAM-02（后端交接）、O-SEAM-03（状态）、O-SEAM-05（引擎生命周期）、O-SEAM-11（长时任务）。
- **单点判据**：O-BGTASK-13（连接窗口按 live 持有）。

**旅程 O-CONN-07 无 UI 连接（卡片/后台恢复）**
`EntryAbility.performCardToggle:202` → `VpnSessionController.connect:80` → `ensureBackendReady`（250 ms × 40）→ `requestConnectConfig`（PENDING 时 500 ms × 20）→ `stageConnectConfig` → `clearHandoffFiles` → `startVpnExtension` → `answerBackendHandoff:150`（不 await，250 ms × 60）→ `formProvider.updateForm` 推新状态。
- **接缝判据**：O-SEAM-10（分叉）、O-SEAM-01、O-SEAM-02、O-SEAM-17（卡片入口）、O-SEAM-11。
- **单点判据**：O-SESSION-01…07、O-BGTASK-*。

**旅程 O-CONN-06 后台存活**
`[P1]` 后台静置中，`VpnBackgroundTaskManager.reconcile` 每 1 s 读状态；live 即持续持有 `dataTransfer` 长时任务并按 30 s 刷新实况窗；心跳龄 ≤ 15 s。
- **接缝判据**：O-SEAM-11、O-SEAM-03。**单点判据**：O-BGTASK-01…15、O-STATUS-01…08。

**旅程 O-NET-03 网络切换**
`[P2]` `VpnNetworkMonitor.refresh:148` 合并/去抖/限速 → `backendNetworkChangedAsync(interfaceName):164` → 引擎重绑并刷新 STUN；地址数据不落日志。
- **接缝判据**：O-SEAM-12（系统回调与重绑）、O-SEAM-05（引擎）。

**旅程 O-XFER-04 接收与保存**
`[P1]` `routeTaildropReceive:8183` 按内容类型分流（text / media / file）→ `submitTaildropReceiveStage:8267` 写 `taildrop-receive-request.json`（或 `useDirectTaildropBackend` 时直调原生）→ `[P2]` `processTaildropReceiveRequest:1533` 下载并对端等待文件保留 → `[P1]` `handleTaildropReceiveResult:8529` 落盘（picker / 媒体库）。
- **接缝判据**：O-SEAM-07（Taildrop）、O-SEAM-17（通知入口 O-XFER-06）。**约束**：接收方确认后才删对端等待文件（R-XFER-07），同名不同大小必须区分。

### 3.2 边界路径

- **控制服务器为空/非法/明文 HTTP**（O-SETUP-02）：`ControlServerConfig.load` 回落 `unconfigured()`；`normalize` 拒绝非法地址。→ O-SEAM-14。
- **状态文件缺失、半写或心跳过期**（需求 §四 边界）：`VpnStatusReader.read` 与 `readStatus` 均返回 `unknown`，**不是** disconnected；已成型的 `*Preferences` 缺键取默认。→ O-SEAM-03、O-SEAM-14。单点：O-STATUS-01、03、05；O-BGTASK-03、14。
- **对端快照过期或进程重启**：`vpn-peers.json` >5 s 或 key 不符即忽略，**不沿用旧快照**（`BridgeStatus.ets:3606,3610`；需求边界场景「进程重启后重新拉起 → 不沿用旧快照」）。→ O-SEAM-04。单点：O-DEV-05（R-DEV-05）。
- **同名不同大小的接收文件、超上限批量、暂存超时**：`TAILDROP_MAX_FILE_SELECTION`=10 / `TAILDROP_MAX_MEDIA_SELECTION`=100（`BridgeStatus.ets:181-182`）、接收超时 45 s/60 s。→ O-SEAM-07。
- **另一系统 VPN 占用**（O-CONN-05）：`VPN_EXISTS_ERROR_CODE` 2203002 → 冲突提示；replace-approved 写方缺失，实际走 `showVpnConflictDialog:4316`。→ O-SEAM-16（不可达）、O-SEAM-10。
- **外部契约未定**（O-XFER-03 / O-MEDIA-02）：Moonlight 三字段空串、LocalSend 目标未验证 → 只能走「未安装」分支。→ O-SEAM-13。**不确定特征** UNCERTAIN-WIRING。

### 3.3 失败恢复路径

- **连接窗口期内用户切走 → 交接无人应答 → 扩展 15 s 后销毁 VPN**（本批修复，O-CONN-03）：P2 记 `vpn_backend_handoff_timeout` 并 `destroyProbeTun`；修复点是 D5——把 `connecting` 也算 live 提前持有长时任务，使 P1 有机会应答。→ O-SEAM-02、O-SEAM-10、O-SEAM-11。单点：O-BGTASK-13、O-SESSION-07。**注意**：端到端真机复现尚未重跑（`docs/background-vpn-reliability.md`）。
- **后台掉线自动恢复**（O-CONN-04）：`VpnReconnectSupervisor` 仅在 `connected→disconnected` 且已后台 ≥10 s 且未 `noteRequestedStop` 时交 `VpnSessionController.connect`；最多 3 次，退避 30/60/120 s，稳定 60 s 才清零。**责任空洞**：P1 若已被冻结（无长时任务），恢复不可靠——没有任何子系统承诺（架构 §五 第 3 条空洞）。→ O-SEAM-11、O-SEAM-03、O-SEAM-01/02。
- **停止请求无人应答**（O-CONN-02）：P1 超时（50 ms × 150）后仍调 `stopVpnExtension`，视为无害。→ O-SEAM-01。
- **报告生成中途失败**：不分享半成品 zip 并删除残留（O-DIAG-01）。→ O-SEAM-15。
- **网络重绑失败**：P2 有界 5 s 重试，不要求用户重连（O-NET-03）。→ O-SEAM-12。

---

## 四、数据与持久化

**归属、生命周期、一致性、恢复**（承接架构 §2.4，本层只补契约视角）。所有路径均在 `context.filesDir`，除非另注；三进程是**同一份目录，没有锁、没有租约**。

| 数据 | 位置 | 属主（写方） | 读方 | 生命周期与一致性 | 恢复策略 |
| --- | --- | --- | --- | --- | --- |
| 控制服务器配置 | `filesDir/control-server.json` | P1（`ControlServerConfig.save:67-103`） | 全部 | 原子写 `.tmp` + rename；`load` 缺失/半写/未确认一律回落 `unconfigured()`（`:46-64`） | 损坏即回落默认，不崩溃；`reset` 删配置 + `filesDir/tailscale`（`:105-120`） |
| 引擎状态目录 | `filesDir/tailscale` | P2（正常）；P1（无 UI 直连时） | 引擎 | 由 `backendStart/backendRestartWithTun` 的 `stateDir` 决定（`VpnCommandGateway.ets:100`、扩展 `:538`） | 控制服务器重置时删除；**Q-01**：两个潜在写者无锁 |
| VPN 就绪状态 | `filesDir/vpn-probe-status.txt` | P2 只写（`writeCurrentStatusHeartbeat:1909`） | P1、P3 | 每 1 s 覆写；>15 s 视为**不确定** | 陈旧/缺失 → unknown，不新建长时任务 |
| 对端快照 | `filesDir/vpn-peers.json` | P2 只写（`writePeerSnapshot:1000`） | P1 | 随 1 s 快照；>5 s 丢弃 | 过期保留上一次有效列表，不清空 |
| Taildrop 快照与目标 | `filesDir/taildrop-targets.json` | P2 只写（`writeTaildropSnapshot:996`） | P1（`refreshTaildropSnapshot:3867`） | 随 1 s 快照；原子写 | 解析失败保留上一次 |
| Taildrop 历史与收件箱 | `filesDir/taildrop-history.json`、`filesDir/taildrop-inbox-snapshot.json`（P1 本地）、`filesDir/taildrop-inbox-export/` | P1 | P1 | 历史上限 10 条（`BridgeStatus.ets:180`），超出淘汰最旧 | 持久化到 `taildrop-inbox-snapshot.json`（`:7790`） |
| Taildrop 出站暂存 | `cacheDir/taildrop-outbox`（`RecoverableCachePaths.ets:11`）；遗留 `filesDir/taildrop-outbox` | P1 | P2（消费并清理） | 可丢弃副本；`onCreate` 清理（扩展 `:1803`） | 失败重试不阻断；`cleanupStaleTaildropOutbox` 每次启动回收 |
| Taildrive 暂存 | 请求目录 `${requestId}/upload.taildrive` | P1（`TaildriveGateway.stageUpload:265`） | P2 | `cleanupStaleStaging` 默认 24 h（`:312`） | staging 非权威，失败可重来 |
| 诊断事件 | `filesDir/diagnostic-ui-events.ndjson`（P1）、`diagnostic-vpn-events.ndjson`（P2） | P1 写前者、P2 写后者 | P1 合并 | 每文件 100 事件 / 24 KB 上限，超出淘汰最旧（`DiagnosticEventStore.ets:112-116`） | best-effort，失败不影响隧道 |
| 诊断报告 | `cacheDir/TailscaleOHOS-Diagnostic-*.zip` | P1（`DiagnosticReportService`） | 用户分享 | 保留 24 h（`:10`），`cleanupExpiredReports` 清理（`:646`） | 半成品 zip 删除、不分享 |
| 界面偏好 | ArkData preferences：`mesh_arc_navigation`、`mesh_arc_animation`、`mesh_arc_security`、文件传输偏好 | P1 | P1 | 重启保持（R-UI-02）；缺键取默认 | 读取失败回落默认 |
| 一次性标记 | `filesDir/welcome-acknowledged`、`update-changelog-seen-version` | P1 | P1 | 存在即视为已确认（`AccountDiagnosticsGateway.ets:14`、`BridgeStatus.ets:1399`） | 存在即跳过引导 |

**关键一致性事实**：一致性靠（a）单一写者约定（每类文件只有一个写方）、（b）原子写、（c）新鲜度阈值。三者任一被打破即产生脏读（架构 §2.4）。**唯一暴露面**是 `filesDir/tailscale` 可能有 P1/P2 两个引擎实例的潜在写者（架构 D3 / Q-01）。

---

## 五、装配与验证边界

### 5.1 真实生产装配入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 构建 | `scripts/build.sh`(macOS) / `scripts/build.ps1`(Windows) → 先 `scripts/build-go.sh`（交叉编译 Tailscale 1.86.5 + OpenHarmony Go 1.24 → `entry/libs/arm64-v8a/libtailscale_go.so`，≈38 MB）→ hvigor `assembleHap` → 签名走 devecocli | 产物是一个 HAP；`compatibleSdkVersion 6.1.0(23)`、arm64-v8a 单一 |
| 产物校验 | `scripts/verify-artifacts.ps1`（AArch64 动态库 + 已打进 HAP）、`scripts/verify-release-changelog.ps1` | Windows 校验；版本三处一致（R-UI-06） |
| 原生链接 | `entry/src/main/cpp/CMakeLists.txt:7-13`：`libtailscale_ohos.so`(napi_init.cpp) 动态链接 `libtailscale_go.so` | `add_library(tailscale_go SHARED IMPORTED)` |
| 应用进程装配 | `entryability/EntryAbility.onCreate:95`（注册长时任务、卡片 callee、taildrop Want）；`onWindowStageCreate:125`（加载 `pages/Index`、窗口环境、通知授权） | P1 单例（`module.json5:28`） |
| 扩展装配 | `vpnextensionability/TailscaleVpnExtensionAbility.onCreate:339`（清一批请求/应答文件 → `startBackendStopWatcher` → `createVpnConnection` → `createProbeTun`）；`onDestroy:1955`（停环、停监控、`backendStop`） | P2 唯一常驻；`type=vpn, exported=false`（`module.json5`） |
| Form 装配 | `entryformability/EntryFormAbility` → `FormCardService` → `VpnStatusReader`（只读） | P3；约 10 s 回收，不可导入 `backgroundTaskManager` |

### 5.2 外部依赖

- **平台能力**：系统 VPN 框架（`vpnExtension.createVpnConnection` → TUN fd）、`backgroundTaskManager`（dataTransfer 长时任务）、`notificationManager`（LIVE_VIEW 实况窗）、`picker.DocumentViewPicker` / `photoAccessHelper`（接收保存）、`userAuth`（系统认证）、`bundleManager`、`systemShare`、`zlib`（报告压缩）。
- **引擎**：`libtailscale_ohos.so` → `libtailscale_go.so`（Tailscale 1.86.5），**P1 与 P2 各加载一份**（架构 D3 / Q-01）。
- **边界外对端**：tailnet 控制平面（HTTP(S)）、系统浏览器、HosPlayer、MoonlightOH（当前不可达）、外部 LocalSend（契约未定）。
- **构建机**：macOS `bash`/`git` 或 Windows PowerShell；无 CI（`record.md` Q1）。

### 5.3 计划集成测试

**当前不存在 `scripts/integration/`**（现有 73 条为 `scripts/test-*.mjs` 宿主侧纯逻辑单元用例，不加载 `.so`）。各接缝判据里已写出待建集成用例（`状态：pending-test`，`归属：owner=项目维护者 接收批次=a01-集成`）：

| 计划文件 / 用例 | 守的接缝 | 断言点（可据此写测试） |
| --- | --- | --- |
| `scripts/integration/vpn-lifecycle-channel.mjs::扩展未启动时停止请求不挂起` | O-SEAM-01 | 先清响应再写请求；50 ms × 150 超时后仍调 `stopVpnExtension` |
| `scripts/integration/orchestration-fork.mjs::两条入口对同一扩展交出同一文件契约且都应答后端交接` | O-SEAM-10 | 文件名/超时/词表逐字一致；两路径都实现交接应答 |
| `scripts/integration/vpn-replace-approval.mjs::无批准标记时不替换且无静默销毁` | O-SEAM-16 | 无标记不调 `replaceExistingVpn` |
| `scripts/integration/external-app-handoff.mjs::深链不含凭据且非法地址在拼装前被拒` | O-SEAM-13 | `validate` 先于拼装；深链四字段 |
| `scripts/integration/persistence-ownership.mjs::半写配置回落未配置态且偏好缺键取默认` | O-SEAM-14 | `load` 回落；`getSync` 默认 |
| `scripts/integration/diagnostic-redaction.mjs::两进程落盘文本共用脱敏边界且超限淘汰最旧` | O-SEAM-15 | `redactForLog`；100 事件 / 24 KB |
| `scripts/integration/entry-dispatch.mjs::卡片 call 与通知 Want 被翻译成内部信号且非法 Want 被丢弃` | O-SEAM-17 | AppStorage 键；`isValidNotificationAction` |

其余接缝（O-SEAM-02/03/04/05/06/07/08/09/11/12）尚无独立的集成测试锚点，记入 §七 待建。

---

## 六、接缝细化

每条接缝列出它分解出的单点判据 ID；`docs/oracles/points/` 里已有的直接引用（**P1-background-status.md**：O-BGTASK-01…15、O-STATUS-01…08；**P3-session.md**：O-SESSION-01…07），没有的写「待建」并记入未决项。
「旅程结果」栏写该接缝服务哪些旅程判据及其可观测结果。

| 接缝判据 | 提供方 | 消费方 | 单点判据 | 旅程结果 |
| --- | --- | --- | --- | --- |
| O-SEAM-01 生命周期命令通道 | P1（`VpnCommandGateway.stageConnectConfig:127`、`BridgeStatus.stopVpnProbe:2502`、`VpnSessionController.connect:100`） | P2（`consumeVpnConnectConfig:780`、`processBackendStopRequest:1057`） | O-SESSION-02 | O-CONN-01：配置 15 s 内被消费 → 建 TUN；O-CONN-02：停止应答 `requestId` 匹配 |
| O-SEAM-02 后端交接 | P2（`requestUiBackendHandoff:645`）；P1 双应答方（`BridgeStatus:3407`、`VpnSessionController:150`） | P1（UI 路径）/ P1（headless 路径） | O-SESSION-03、04、05、06、07 | O-CONN-01/O-CONN-07：15 s 内被应答 → 隧道可用；无人应答 → 自毁 |
| O-SEAM-03 状态与心跳 | P2（`writeCurrentStatusHeartbeat:1909`，1 s） | P1（`VpnStatusReader:33`、`VpnBackgroundTaskManager:344`）、P3（`FormCardService:28`） | O-STATUS-01…08、O-BGTASK-02、03、05、13、14、15、O-SESSION-01 | O-CONN-06：心跳龄 ≤15 s；O-DEV-01：状态三态；卡片状态与应用一致 |
| O-SEAM-04 对端快照 | P2（`writePeerSnapshot:1000`） | P1（`refreshPeerSnapshot:3597`） | 待建（R-DEV-05 有单元测试 `scripts/test-peer-path-cache.mjs`，但未挂接缝） | O-DEV-01/O-DEV-02：5 s 内显示三态与路径/延迟 |
| O-SEAM-05 引擎生命周期面 | S4（`libtailscale_ohos.so`：`backendStart`、`backendRestartWithTun`、`backendStop(Async)`、`backendLogout(Async)`、`backendStatus`、`backendSnapshot`、`tunFdProbe`） | P1（`VpnCommandGateway`、`AccountDiagnosticsGateway`）、P2（扩展） | 待建 | O-CONN-01/O-CONN-02/O-SETUP-04：引擎起停；**Q-01** 决定 stop 作用域 |
| O-SEAM-06 引擎只读与设置面 | S4（`backendPeers`、`backendAccount`、`backendExitNodes`、`backendNetworkSettings`、`backendSetExitNode(Async)`、`backendSetNetworkSetting(Async)`、`controlProbe`） | P1（`HomeReadOnlyGateway`、`NetworkSettingsGateway`、`AccountDiagnosticsGateway`） | 待建 | O-NET-01/O-NET-02/O-DEV-02：出口节点/子网路由；设备列表数据源 |
| O-SEAM-07 Taildrop 通道 | P1（`writeTaildropSendRequest:7793`、`submitTaildropReceiveStage:8267`、`discardTaildropFile:8343`）与 P2（`processTaildropSendRequest:1713`、`processTaildropReceiveRequest:1533`）双向 | 双向 | 待建 | O-XFER-01/02/04/05：100 ms 请求环、250 ms 接收环；确认后才删对端文件 |
| O-SEAM-08 Taildrive 通道 | P1（`TaildriveGateway.performVpnExtensionRequest:180`） | P2（`processTaildriveQueryRequest:1284` 等四处理器） | 待建 | O-DRIVE-01/O-DRIVE-02：四对请求；超时 32 s/35 s/30 min+10 s/5 s |
| O-SEAM-09 探测通道 | P1（`PeerPathService`、`SunshineProbeService`、`MediaServiceProbeService`） | P2（`processPeerConnectivityRequest:1138`、`processSunshineProbeRequest:1187`、`processMediaServiceProbeRequest:1234`、`processLocalSendRefreshRequest:1010`） | 待建 | O-DEV-02/O-MEDIA-01/O-MEDIA-02：探测结果 + 路径类型；过期即失效 |
| O-SEAM-10 编排分叉 | P1（`BridgeStatus.beginVpnConnection:2351` 与 `VpnSessionController.connect:80`） | P2（同一扩展） | O-SESSION-01、02、03、07 | O-CONN-01/O-CONN-07/O-CARD-01：两入口同一契约；漏答即失败 |
| O-SEAM-11 长时任务与实况窗 | P1（`VpnBackgroundTaskManager`） | 系统 `backgroundTaskManager` / `notificationManager` | O-BGTASK-01…15 | O-CONN-06/O-CONN-03：连接窗口与稳定连接都持有；陈旧有界宽限释放 |
| O-SEAM-12 网络变化回调与重绑 | 系统网络管理 → P2（`VpnNetworkMonitor.refresh:148`） | P2 引擎（`backendNetworkChangedAsync:164`） | 待建（`scripts/test-vpn-network-monitor.mjs` 为单元） | O-NET-03：同会话重绑；地址不落日志 |
| O-SEAM-13 外部应用与系统认证 | P1（`openSecureLoginBrowser:2123`、`HosPlayerLauncher`、`MoonlightLauncher`、`AppSecurityAuthenticator`） | 系统浏览器 / 播放器 / LocalSend / `userAuth` | 待建 | O-SETUP-03/O-MEDIA-01/O-MEDIA-02/O-XFER-03/O-PRIV-01：三路回退；凭据不进深链 |
| O-SEAM-14 持久化所有权与默认值 | P1（`ControlServerConfig.save:67`、`*Preferences.save`）、P2（扩展缓存） | 各读方 | 待建 | O-SETUP-02/O-UI-01：原子写、缺键默认、损坏回落 |
| O-SEAM-15 诊断记录、脱敏与报告导出 | P1（`DiagnosticEventStore` + `DiagnosticReportService`）、P2（`DiagnosticEventStore`） | P1 合并、用户分享 | 待建 | O-DIAG-01：脱敏不可绕过；100 事件/24 KB；报告 24 h |
| O-SEAM-16 VPN 替换批准通道 | **P1（写方缺失，不可达）** | P2（`consumeVpnReplaceApproval:732`） | 待建 | O-CONN-05：批准路径不可达，实际走冲突对话框 |
| O-SEAM-17 入口分发 | 外部（卡片 `call`、通知 Want、P3 定时刷新）→ P1（`EntryAbility`） | P1 `BridgeStatus` / `TaildriveBrowser` | 待建 | O-CARD-01/O-XFER-04/O-SETUP-03/O-MEDIA-01/O-MEDIA-02/O-XFER-03：翻译成内部信号；非法 Want 丢弃 |

---

## 七、未决项与审核问题

**必须带进本层、不抹平的项：**

| # | 问题 | 影响 | 谁确认 | 何时阻塞 |
| --- | --- | --- | --- | --- |
| **Q-01** | **平台把两个进程里加载的同一份 `libtailscale_ohos.so` 视为一个运行时还是两个？** 若是「一个」，D3(a) 失效，交接协议与 `filesDir/tailscale` 单写者假设同时被打破；`AccountDiagnosticsGateway.logout`（`:49`）的一次 `backendLogout` 会连带停掉 P2 引擎。本层**未能验证**：仓内 73 条测试全是宿主侧纯逻辑，不加载 `.so` | O-SEAM-05、O-SEAM-02、O-SEAM-14、D3 | 用户（真机：两进程各调 `probeEngine()`/`backendStatus()` 观察是否互相可见） | **唯一会反转决策的未知**；契约定稿前 |
| **Q-02** | 保留期在代码与需求间不一致：扩展侧 Taildrop 缓存 **7 天**（`TailscaleVpnExtensionAbility.ets:56`）、诊断报告 **24 h**（`DiagnosticReportService.ets:10`）、R-DRIVE-05 声称 Taildrive 暂存 **24 h**——但 `components/TaildriveBrowser.ets` 中**找不到**对应清理常量（该文件的 24 h 是显示分组 `:1891`）；Taildrive staging 的 24 h 实际来自 `TaildriveGateway.cleanupStaleStaging` 的默认参数（`:312`）。需求与代码必有一方修正 | R-DRIVE-05、O-SEAM-14、O-SEAM-08、§四 数据归属 | 用户 | 数据归属表定稿前 |
| **Q-03** | `vpn-replace-approved` 路径**死路**：仓库内**无写方**（只有常量 `:27` 与读路径 `:729` 两个引用），approved-replace 不可达；真正在跑的是 `showVpnConflictDialog:4316` 提示用户手动断开其它 VPN。O-SEAM-16 只能记为「设计意图 vs 实际」 | O-CONN-05、O-SEAM-16 | 用户 | O-CONN-05 要闭环时 |
| **Q-04** | LocalSend 外部拉起契约未定：`LOCAL_SEND_APP_TARGETS` 的 `cn.biandangroup.bcshare` 是**未验证的猜测**（`BridgeStatus.ets:154-160`）；Moonlight 三字段为空串（`MoonlightIntegrationConfig.ets:10-15`）使串流路径不可达。O-XFER-03 / O-MEDIA-02 只能 `not-evaluated` | R-XFER-09、O-SEAM-13 | 用户 | O-XFER-03 闭环时 |
| **Q-05** | 诊断事件名是**自由字符串、无受控词表**，也没有跨进程事件名登记表（两进程各自命名，`VpnSessionController.record:187-189` 把 UI 侧事件写进 UI 文件），同一语义可能两种拼写 | R-DIAG-05、O-SEAM-15 | 用户 | 接缝判据写「可观测点」时 |
| **Q-06** | O-SEAM-16 批准 TTL 仅 10 s（`:28`），若对话框出现时用户切走，标记是否仍有效、扩展是否重问——**未验证** | O-CONN-05、O-SEAM-16 | 用户 | O-CONN-05 闭环时 |
| **Q-07** | 无 CI（`record.md` Q1）：§5.3 的集成测试全部待建，「接缝无空洞」无法被自动守住 | 全部接缝闭环强度 | 用户 | 声称开发完成之前 |
| **Q-08** | 卡片、Taildrive 真机共享节点、special-scenario 三条路径从未真机验证；special-scenario（D4 唯一潜在出路）在代码里默认惰性（`SPECIAL_SCENARIO_SUBMODE = 0`，`VpnBackgroundTaskManager.ets:31`），**从未运行过** | D4 失效条件、O-CARD-01、O-DRIVE-* | 用户 | 相应旅程/决策定论时 |
| **Q-09** | **责任空洞（本层确认的唯一空洞）**：P1 被冻结期间的掉线恢复没有任何子系统承诺（恢复责任在 `VpnReconnectSupervisor`，而它可能已被冻结）。用户回到应用前保持断开 | O-SEAM-11、O-CONN-04 | 用户（是否接受为已确认风险） | 架构层审核问题延续至本层 |

**本层编码/契约与架构文档的对照发现（不是文档错误，是需在 LLD 前钉住的事实）：**

1. `index.d.ts` 是 **46 条 `export const`**（`backendStart` 与 `backendRestartWithTun` 各占两行），架构 §2.2 与需求引用一致。
2. N-API 调用权归属：扩展拥有大多数（`backendRestartWithTun`、`tunFdProbe`、`probeEngine`、`backendTaildropReceiveAsync`、`backendTaildrive*`、`backendNetworkChangedAsync` 等）；UI 进程只经 `VpnCommandGateway`、`HomeReadOnlyGateway`、`NetworkSettingsGateway`、`AccountDiagnosticsGateway`——**但当自身后端实例 Running 时，`BridgeStatus` 直接调引擎做 Taildrop 接收，绕过文件协议**（`:8214-8229`）。这条旁路是本层与架构的共同发现，集成测试必须显式覆盖。
3. 扩展 `TAILDROP_INBOX_SNAPSHOT_FILE_NAME`（`:45`）与 `TAILDROP_TARGETS_FILE_NAME`（`:42`）是**两份不同数据**：前者是 P1 本地收件箱持久化（`BridgeStatus.ets:6964,7790`），后者才是 P2 每秒发布的跨进程快照（扩展 `:996`，P1 读 `:3589`）。契约 C-07 按后者描述。
4. 保留期与硬编码常量散落各处（Q-02）：`TAILDROP_CACHE_RETENTION_MS` 7 天在扩展 `:56` 与 `BridgeStatus.ets:176` 各定义一份——LLD 应考虑收敛到单一常量源。

---

### 附：本层对 O-SEAM-01…09 的覆盖说明

SEAM-SPEC 末表列出 17 条稳定接缝；`docs/oracles/91-seams/` 目前仅落了 O-SEAM-10…17 的正文（另一 agent 正在写 O-SEAM-01…09）。本层的契约卡 C-01…C-09 严格按 SEAM-SPEC 末表的 **ID 与标题**写 O-SEAM-01…09，全部取自生产代码（`file:line` 已逐条核对），未使用第五节的临时 `SEAM-xx` 编号。末表 15 条版与 17 条版的差异（O-SEAM-11/13/14/16/17 的拆分与重命名）以末表为准。
