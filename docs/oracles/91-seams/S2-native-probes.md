# 接缝判据 · 原生引擎边界与扩展的业务通道（O-SEAM-05 … O-SEAM-09）

本文件覆盖两类接缝：应用进程与 Go 引擎之间的两条原生边界（生命周期面、只读与设置面），
以及应用进程与 VPN 扩展之间的三条业务通道（Taildrop、Taildrive、探测）。前者没有跨进程序列化，
交接物是 N-API 的返回字符串；后者全部走 `filesDir` 下的请求/应答文件 + `requestId`，
方向都是「应用进程请求、扩展执行并应答」，但四条通道的超时预算与责任归属各不相同。

### O-SEAM-05 应用进程 ↔ Go 引擎：生命周期面
- 层级：接缝
- 父判据：O-CONN-01、O-CONN-02
- 强度：强
- 设计依据：架构 §二 2.2 子系统 S4（引擎边界，P1 与 P2 各一份）与 §四 D3（两个进程各加载一份 `.so`）、§六 Q-01；需求 R-CONN-01「从首页一键连接：拉起 VPN 扩展、经系统授权、进入可用的隧道」、R-CONN-02「从首页一键断开：停止扩展、释放长时任务、回到未连接态」；架构 A-SEAMS、A-D3
- 触发与前置条件：应用进程要在自己这一侧起/停引擎、取登录 URL 或取 VPN 配置时——连接前必须先起引擎才能拿到配置（`services/VpnCommandGateway.ets:99-117`）；扩展要在拿到 TUN fd 后重启引擎时走另一条入口 `backendRestartWithTun`（`vpnextensionability/TailscaleVpnExtensionAbility.ets:537`）
- 可观测点：`nativeBridge` 各入口的返回字符串（`state=…`）、两侧进程各自的后端状态、`filesDir/tailscale` 状态目录的写者、诊断事件 `vpn_backend_handoff_stopped` / `vpn_backend_handoff_stop_failed`
- 期望：正常：应用进程侧的入口集中在 `VpnCommandGateway`——`startBackend(stateDir, model, os, controlUrl)` 同步返回状态串、`stopBackend()` 异步返回状态串、`backendStatus()` 同步读、`requestVpnConfig()` 与 `requestLoginUrl()` 取配置与登录 URL（`services/VpnCommandGateway.ets:99-117`），`stateDir` 恒为 `filesDir/tailscale`；扩展侧唯一入口是 `backendRestartWithTun(stateDir, model, os, controlURL, tunFd)`，它同时交出发起方拿不到的 TUN fd（`entry/src/main/cpp/types/libtailscale_ohos/index.d.ts:45-46`；扩展 `:537`）。C++ 侧在 `napi_init.cpp` 用 `AsyncInputOperation` 枚举加分支把 ArkTS 调用映射到 `TSBackend*` 函数（`napi_init.cpp:19-34` 与 `:102-120`），因此接口面每加一处都要同时落在 `index.d.ts` 与那份分支上，缺一边就是运行期空转。边界：状态串的语义由调用方解析而不由类型保证——`services/VpnSessionController.ets:241-247` 用 `includes('state=Running')` 判就绪，`BridgeStatus` 同法；无法辨认的返回值不得被当作就绪。失败与恢复：同一时刻只允许一个进程用 `filesDir/tailscale` 起引擎，交接靠 O-SEAM-02 的协议而不是锁（架构 §二 2.4「没有锁、没有租约」）；`startBackend` 抛错时调用方以 `NEEDS_UI` / `FAILED` 收尾而不是重试成环，`stopBackend` 抛错时仍必须回写交接应答（O-SEAM-02）。Q-01 未决且会反转结论：若平台把两进程加载的同一份 `.so` 视为同一个运行时，P1 的一次 `backendStopAsync` 会连带停掉 P2 的隧道，而文件协议仍会把它读成「扩展自己停了」；本层不假设答案，必须先按架构 §六 Q-01 的要求在两个进程里各调一次 `backendStatus()` / `probeEngine()` 观察是否互相可见。安全与质量：这一面没有跨进程序列化，凭据与登录态始终留在引擎侧，调用方只拿到状态串、配置串与 URL；日志只记状态类别与数字码（R-DIAG-02）。　**2026-10-13 真机已验证**：连接成功时扩展侧 `vpn-status=state=Running|tun=true`，而 UI 进程侧 `engine-status=Tailscale Engine Pending`、`backend-status=STOPPED|backend not started`。两侧各有一份独立引擎，本条的前提由条件成立转为已验证。证据 `manual-checks.md#M-13`，复跑 `scripts/e2e/engine-runtimes.mjs`。
- 失败信息：期望「两侧各自的引擎实例只由本进程的命令驱动，状态串是唯一的交接物」，实际「一侧的命令把另一侧的引擎一起停掉，或状态串被误解析后进程自认为已经就绪」
- 来源：entry/src/main/ets/services/VpnCommandGateway.ets:99-117 startBackend/stopBackend/backendStatus/requestVpnConfig/requestLoginUrl；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:537 backendRestartWithTun；entry/src/main/cpp/types/libtailscale_ohos/index.d.ts:45 backendRestartWithTun 的 TUN fd 形参；entry/src/main/cpp/napi_init.cpp:102-120 ExecuteAsyncInput
- 上游：R-CONN-01、R-CONN-02
- 待建测试：[集成] scripts/integration/native-engine-lifecycle.mjs::两进程各起一份引擎后互不可见
- 测试：真机走查 a01-baseline/manual-checks.md#M-13（两个进程里同一份 .so 是几个运行时）
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-06 应用进程 ↔ Go 引擎：只读与设置面
- 层级：接缝
- 父判据：O-NET-01、O-NET-02、O-DEV-02
- 强度：强
- 设计依据：架构 §五 O-NET-01/02 行「设置变更必须在断开时生效」；需求 R-NET-01「连接前可选择出口节点；已连接时不可改，并提示先断开」、R-NET-02「连接前可开关「使用子网路由」与「出口节点允许访问局域网」」、R-DEV-02「设备列表区分本机、在线、离线，并标出名称、系统与密钥过期」；架构 A-SEAMS、A-D3
- 触发与前置条件：应用进程要读设备、账号、出口节点或网络设置，或在未连接态写出口节点与两个开关时；写入前必须先经调用方的前置门控（已连接时不可改）
- 可观测点：`HomeReadOnlyGateway` 三个读方法返回的 JSON、`NetworkSettingsGateway` 的读写返回串、`NetworkSettingsUpdateQueue` 的代次、`HomeReadOnlyRequestGuard` 的代次、界面上设置与开关的取值与失败文案
- 期望：正常：读面集中在 `HomeReadOnlyGateway`——`readBackendSnapshot()` / `readPeers()` / `readAccount()` 分别转调 `nativeBridge.backendSnapshot` / `backendPeers` / `backendAccount` 并 `JSON.parse`（`services/HomeReadOnlyGateway.ets:8-17`）；设置面集中在 `NetworkSettingsGateway`——`readExitNodes()` / `writeExitNode()` / `readNetworkSettings()` / `writeNetworkSetting()`（`services/NetworkSettingsGateway.ets:52-66`），对应原生侧 `backendExitNodes` / `backendSetExitNodeAsync` / `backendNetworkSettings` / `backendSetNetworkSettingAsync`。异步陈旧由两个守卫吸收：`HomeReadOnlyRequestGuard` 用 generation 拒绝上一代 Home 生命周期的迟到结果（`services/HomeReadOnlyGateway.ets:22-35`），`NetworkSettingsUpdateQueue` 只保留最后一次用户选择并按 generation 判定完成结果是否权威（`services/NetworkSettingsGateway.ets:14-48`）。边界：已连接、连接中或更新在途时改设置由调用方在接口之外拦下（`components/BridgeStatus.ets:1938` 的串行化与 `:10344` 的禁用门控），引擎不提供「热改」这条路径；一次开关的连续快速切换被队列串行化，最后一次胜出。失败与恢复：写入失败必须让调用方看到失败串并回到已知设置，不允许界面停在一个没落盘的开关位；被守卫丢弃的迟到完成不得改写当前值。Q-01 未决：这份只读面读的是本进程引擎实例的状态，若平台共享运行时，读到的可能是另一个进程正在写的状态；本层不假设答案。安全与质量：这一面只传设置键、布尔值与节点标识，不传凭据；读面的返回串由调用方 `JSON.parse`，解析失败要按不可用处理而不是让异常穿透。　**2026-10-13 真机已验证**：连接成功时扩展侧 `vpn-status=state=Running|tun=true`，而 UI 进程侧 `engine-status=Tailscale Engine Pending`、`backend-status=STOPPED|backend not started`。两侧各有一份独立引擎，本条的前提由条件成立转为已验证。证据 `manual-checks.md#M-13`，复跑 `scripts/e2e/engine-runtimes.mjs`。
- 失败信息：期望「设置只在断开时生效、旧代次的完成结果被丢弃」，实际「已连接时设置被写进引擎，或上一代读的结果覆盖了当前设备与设置」
- 来源：entry/src/main/ets/services/HomeReadOnlyGateway.ets:8-17 三个读方法；entry/src/main/ets/services/HomeReadOnlyGateway.ets:22-35 RequestGuard；entry/src/main/ets/services/NetworkSettingsGateway.ets:52-66 设置面；entry/src/main/ets/services/NetworkSettingsGateway.ets:14-48 UpdateQueue；entry/src/main/ets/components/BridgeStatus.ets:1938 queueExitNodeUpdate
- 上游：R-NET-01、R-NET-02、R-DEV-02
- 待建测试：[集成] scripts/integration/native-engine-settings.mjs::已连接时出口节点变更被拒
- 测试：真机走查 a01-baseline/manual-checks.md#M-13（两个进程里同一份 .so 是几个运行时）
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-07 应用进程 ↔ VPN 扩展：Taildrop 通道
- 层级：接缝
- 父判据：O-XFER-01、O-XFER-04、O-XFER-05
- 强度：强
- 设计依据：架构 §五 SEAM-07（Taildrop，100 ms 请求环与 250 ms 接收半环）与空洞检查第 4 条「责任与执行分离」；需求 R-XFER-02「从 Transfer 页可选文件/图片发送，选择数量有上限」、R-XFER-05「接收方按内容类型分流：图片/视频存入照片，其它交给文件保存器；同名不同大小必须区分」、R-XFER-07「接收完成后才删除对端等待文件；未取走的文件保留到用户显式丢弃」；架构 A-SEAMS、A-D2
- 触发与前置条件：发送方在传输页发起出站传输、取消传输或重试，接收方要取走或丢弃对端等待文件时；通道共 8 个文件名（发送/取消请求、接收请求与应答、目标快照、收件箱快照）加历史与暂存
- 可观测点：`taildrop-send-request.json`、`taildrop-cancel-request.json`、`taildrop-receive-request.json` 与 `taildrop-receive-response.json` 的 `requestId` 与 `action`（stage / delete / clear）、`taildrop-targets.json` 的 `updatedAtMs`、`taildrop-history.json`、`cacheDir/taildrop-outbox`、诊断事件 `taildrop_send_queued` / `taildrop_send_cancelled` / `taildrop_receive_requested` / `taildrop_receive_<state>` / `taildrop_receive_failed`
- 期望：正常：出站——应用进程把 `{requestId,targetKey,outboxRoot,files}` 用 `.tmp.<requestId>` + rename 原子写进 `taildrop-send-request.json`（`components/BridgeStatus.ets:7793-7795`、`:7555-7573`），暂存副本落在 `cacheDir/taildrop-outbox`（`services/RecoverableCachePaths.ets:10-12`）；扩展在 100 ms 请求环里处理发送、取消与接收请求（`vpnextensionability/TailscaleVpnExtensionAbility.ets:884-898`），实际传输由引擎完成（`:1745`）。入站——应用进程按 `action` 发 `stage` / `delete` / `clear` 到 `taildrop-receive-request.json`，扩展在 250 ms 接收环与 100 ms 请求环里都会处理（`:901-903`、`:1539-1568`），处理完把结果原子写回 `taildrop-receive-response.json`（`:1549-1568`），无效请求或引擎失败也要回写 `failed` 结果，不让调用方等到超时。目标与收件箱快照由扩展原子写 `taildrop-targets.json`（`:996-998`）。边界：取消请求只在传输处于 `queued` / `sending` 且 `requestId` 与当前传输一致时才被采纳（`:1470-1477`）；对端等待文件以「名称 + 大小」配对，同名不同大小视为不同文件；扩展启动时清空全部 Taildrop 握手文件（`:344-347`），陈旧请求不会驱动新会话。失败与恢复：删除对端等待文件必须发生在导出成功之后——应用进程在导出处理成功后才调 `requestTaildropReceiveDelete`（`components/BridgeStatus.ets:8674`、`:8751`），导出失败走 `failTaildropReceive` 而不发 `delete`，未取走的等待文件保留到确认丢弃（`:8321`）。请求写失败时调用方清理暂存并落成失败记录，不静默重试（`:8015-8022`）。已知缺口：接收与导出、文字预览这两条腿从未真机验证（`docs/taildrop-technical-plan.md:41` 标为 Missing validation）；历史上限在代码里是 10 条，方案文档写 20 条（`components/BridgeStatus.ets:180` 对 `docs/taildrop-technical-plan.md:37`）。安全与质量：等待文件名先按 basename 清洗才参与配对（`:7798-7807`），不接受绝对路径或路径分隔符；请求与应答文件里只有 `requestId`、动作、名称与大小。Q-01 邻接：未连接但本进程后端已在 Running 时，接收直接走 `nativeBridge.backendTaildropReceiveAsync` 而不经文件通道（`:8214`、`:8229`），这条快路径是否只作用于本进程的引擎实例取决于 Q-01，本层不假设答案。
- 失败信息：期望「导出成功后才发删除请求、取消只在 queued/sending 生效、每个请求都有带 requestId 的应答」，实际「先删对端等待文件再导出导致丢文件，或取消请求因 requestId 不匹配被静默丢弃」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:7555-7573 原子请求写；entry/src/main/ets/components/BridgeStatus.ets:8674 导出成功后才发删除；entry/src/main/ets/components/BridgeStatus.ets:8751 requestTaildropReceiveDelete；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:884-898 100ms 请求环；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1539-1568 接收请求处理与应答
- 上游：R-XFER-02、R-XFER-05、R-XFER-07
- 待建测试：[集成] scripts/integration/taildrop-channel.mjs::导出成功后才写删除请求
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-08 应用进程 ↔ VPN 扩展：Taildrive 通道
- 层级：接缝
- 父判据：O-DRIVE-01
- 强度：强
- 设计依据：架构 §五 SEAM-08（Taildrive，四对请求，超时 32 s / 35 s / 30 min + 10 s / 5 s）；需求 R-DRIVE-03「支持上传、下载、新建文件夹、改名、移动、删除，操作有进度与结果反馈」、R-DRIVE-04「上传默认不覆盖，冲突要用户显式确认」；架构 A-SEAMS、A-D2
- 触发与前置条件：已连接时应用进程的 `TaildriveBrowser` 要列目录、做变更或传输；四个通道（query / transfer / manualTransfer / control）各有独立的请求与应答文件
- 可观测点：`taildrive-query-request/response.json`、`taildrive-transfer-*`、`taildrive-manual-transfer-*`、`taildrive-control-*` 的 `requestId` 与 `operation`；按通道串行化的队列；超时后请求文件被清空；`TaildriveTransferSnapshot` 的 state
- 期望：正常：应用进程按通道发请求——`{requestId,operation,payload}` 先清应答再写请求（`services/TaildriveGateway.ets:185-196`），四个通道各有独立队列互不阻塞（`:160-178`），单请求超时按通道取值：query 32 s、mutation 35 s、transfer 与 manualTransfer 30 min + 10 s、control 5 s（`:14-17`，manualTransfer 复用 transfer 的预算，见 `:130-133`）。扩展在 100 ms 请求环里处理四类请求（`vpnextensionability/TailscaleVpnExtensionAbility.ets:884-898`），并统一经 `completeTaildriveRequest` 原子写回 `{requestId,result}`（`:1381-1408`）。边界：只有 `requestId` 匹配的应答被采纳，旧应答被清空（`services/TaildriveGateway.ets:209-213`）；超时后调用方清掉自己的请求文件（`:219`），使迟到的扩展不会拿一个没人等待的请求去动远端文件。失败与恢复：任一通道超时都以抛错收尾、由调用方转成失败态并可重试，不残留半写状态；上传默认不覆盖，遇同名由调用方先弹冲突确认再重发，引擎侧不自行决定（R-DRIVE-04 的落点在 `TaildriveBrowser` 的 `already_exists` 分支）。安全与质量：跨进程只传操作名、路径与结果串，暂存副本留在应用侧；四个通道的文件名在扩展启动时被清空（`vpnextensionability/TailscaleVpnExtensionAbility.ets:348-355`），陈旧请求不驱动新会话。
- 失败信息：期望「四个通道各有独立超时、只认 requestId 匹配的应答、超时后连请求一起清掉」，实际「慢通道把快通道拖住，或超时后扩展仍按没人等待的请求改动远端文件」
- 来源：entry/src/main/ets/services/TaildriveGateway.ets:14-17 通道超时；entry/src/main/ets/services/TaildriveGateway.ets:185-196 请求握手与超时清理；entry/src/main/ets/services/TaildriveGateway.ets:160-178 按通道串行；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1381-1408 completeTaildriveRequest
- 上游：R-DRIVE-03、R-DRIVE-04
- 待建测试：[集成] scripts/integration/taildrive-channel.mjs::超时的 Taildrive 请求以失败态返回并清掉请求文件
- 待建测试：[真机] 真机走查 a01-baseline/manual-checks.md#M-15（Taildrive 真机共享节点）
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-09 应用进程 ↔ VPN 扩展：探测通道
- 层级：接缝
- 父判据：O-DEV-02、O-MEDIA-01、O-MEDIA-02
- 强度：强
- 设计依据：架构 §五 SEAM-09（探测，挂在扩展的状态环与请求环内）；需求 R-DEV-03「设备详情展现在线状态、路径类型（直连/DERP）与延迟，可手动刷新」、R-MEDIA-01「设备详情可探测 Jellyfin/Emby/Plex，并说明探测不到的原因」、R-MEDIA-04「检测到 Sunshine 且路径为 DERP 时先向用户确认再串流」
- 触发与前置条件：应用进程要在设备详情里读路径、探测媒体服务、探测串流能力或刷新 LocalSend 状态时；四类探测各有独立的请求与应答文件名
- 可观测点：`peer-connectivity-request/response.json`、`sunshine-probe-request/response.json`、`media-service-probe-request/response.json`、`localsend-refresh-request/response.json` 的 `requestId`；各探测服务自己的缓存 age 与代次；各探测的 `TIMEOUT_MS`；诊断事件与设备详情行上的取值
- 期望：正常：三类探测由应用进程的独立服务发起，各自「清应答 → 写 `{requestId,…}` 请求 → 150 ms 轮询应答」：`PeerPathService`（`services/PeerPathService.ets:86-96`，超时 12 s）、`SunshineProbeService`（`:84-92`，超时 3.5 s）、`MediaServiceProbeService`（`:97-105`，超时 4 s）；LocalSend 刷新由 `BridgeStatus` 发起并最多等 25 s（`components/BridgeStatus.ets:4158-4187`、`:152`）。扩展侧：100 ms 请求环处理 peer-connectivity 与 LocalSend 刷新（`vpnextensionability/TailscaleVpnExtensionAbility.ets:896`、`:1010-1057`），1 s 快照环处理 peer-connectivity / sunshine / media（`:926-928`），三者分别由引擎的 `backendPeerConnectivityAsync` / `backendSunshineProbeAsync` / `backendMediaServiceProbeAsync` 完成（`:1157`、`:1206`、`:1256`），应答都回带原 `requestId`。边界：对端不在线或未连接时不发探测而直接给 `unknown`（`services/PeerPathService.ets:53-56` 的 `mesh_disconnected`），避免无谓的跨进程往返；路径结果按类型分档过期——直连 25 s、瞬时结果 3 s（`:7`、`:10`、`:58-60`）。失败与恢复：探测超时或扩展未应答时以失败态返回，不把上一次结果当成新结果；同一对端的并发探测用代次守卫，不是本次的响应直接丢弃（`:62-68`），刷新期间开始的探测会作废上一代。责任划分：探测执行在扩展，过期判定与作废在应用进程。已知缺口：LocalSend 的官方 bundle/Want 契约未定（架构 §六 Q-04），`localsend-refresh` 返回的状态串不能作为「外部应用可用」的结论。安全与质量：探测请求里只传 peer key 与主机地址，应答里只有状态与数值；地址数据不进诊断（R-NET-04）。走查覆盖：M-09 覆盖的是离线自检——用仓库内置的 Jellyfin / Emby / Plex / 非媒体 HTTP 样本识别媒体服务并校验 HosPlayer 深链参数（`PASS · 媒体服务识别 4/4 · HosPlayer 参数协议通过`），不访问网络、也不真正拉起播放器，因此它验证的是探测的识别与消费侧，没有走这条跨进程文件通道；通道本身目前只有单点用例。
- 失败信息：期望「四类探测各自带 requestId 往返、过期即失效、不拿旧结果当新结果」，实际「应答不匹配却被采纳，或探测超时后详情页沿用上一次的路径与可用性」
- 来源：entry/src/main/ets/services/PeerPathService.ets:86-96 requestThroughVpnExtension；entry/src/main/ets/services/PeerPathService.ets:7-10 缓存 TTL 与超时；entry/src/main/ets/services/SunshineProbeService.ets:84-92；entry/src/main/ets/services/MediaServiceProbeService.ets:97-105；entry/src/main/ets/components/BridgeStatus.ets:4158-4187 LocalSend 刷新；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1138-1260 探测请求处理
- 上游：R-DEV-03、R-MEDIA-01、R-MEDIA-04
- 测试：真机走查 a01-baseline/manual-checks.md#M-09
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核
