# MeshArc 接缝判据 · 编排与系统边界（O-SEAM-10 … O-SEAM-12）

本文件覆盖「编排分叉」「长时任务与实况窗」「网络回调与重绑」三条接缝。
它们分别是架构决策 D1 本身、D4/D5 的系统对端，以及 R-NET-03 逼出的扩展内重绑。
`期望` 只写数据/控制/责任怎么交出去，不写用户看到什么。

### O-SEAM-10 编排分叉：UI 路径 ↔ 无 UI 路径
- 层级：接缝
- 父判据：O-CONN-01、O-CONN-07、O-CARD-01
- 强度：强
- 设计依据：架构 §四 D1（两条连接编排的取舍与收敛触发）、§三 3.2(a)/(b)、§五 责任空洞检查第 1 条、§七 SEAM-01 对照行；架构 A-SEAMS、A-D1
- 触发与前置条件：一次连接或断开请求由两个入口之一发起——P1 内 `BridgeStatus` 的 UI 路径（`beginVpnConnection:2351` / `stopVpnProbe:2502`），或 headless 路径 `VpnSessionController.connect:80` / `disconnect:118`（由卡片 `EntryAbility.performCardToggle:202` 或 `VpnReconnectSupervisor` 触发）
- 可观测点：两条编排各自 stage 的文件名与 requestId（`vpn-connect-config.json`、`vpn-stop-request/-response.json`、`vpn-backend-handoff-request/-response.json`）、两侧诊断事件名的拼写、扩展侧的后端交接是否在 15 s 内被应答、`vpn-probe-status.txt` 的最终 state
- 期望：正常：两条路径必须对同一扩展交出同一套文件契约——逐字相同的文件名（`VpnSessionController.ets:12-18` 明确镜像 UI 侧的名字）、同一 requestId 匹配口径（发起前先清响应、只认 requestId 相等的应答）、同一状态词表，使扩展无需知道请求来自哪个入口；两条路径都必须实现交接应答半环：UI 路径在 `BridgeStatus.processVpnBackendHandoffRequest:3407`，headless 路径在 `VpnSessionController.answerBackendHandoff:150`（250 ms × 60 = 15 s，与扩展 100 ms × 150 的预算对齐）。边界：任一入口在已连接或断开在途时重复发起不得重入；headless 入口无法在没有界面时完成（未登录、未配置控制服务器、后端未就绪）时必须把结果交回 P1 的窗口而不是静默失败。失败与恢复：交接应答的责任在 P1——无人应答即由扩展记 `vpn_backend_handoff_timeout` 并销毁 VPN；这条分叉已经真实失败过一次：卡片路径起初不实现交接应答，使每一次 headless 连接都建 TUN、等 15 s、然后自毁（`docs/background-vpn-reliability.md` Milestone 3「a headless connect could never complete」）。收敛触发：出现第三个入口（系统分享面板接收、开机自动连接）时不得再抄第三份，必须把「文件名 + 超时 + 状态词表 + 命令状态机」抽成共享模块；在此之前两份实现是登记在案的债务（`VpnSessionController.ets:59-63`）。安全与质量：两套命令状态机与诊断事件名的重复是已知代价，接缝要求的是「同步」而不是「合并」——任一侧单方面改动文件名、超时或词表都会静默失去应答，因此三个对齐点（名字、超时、词表）都必须可被集成测试逐条比对。
- 失败信息：期望「两条入口对同一扩展交出同一套命名、超时与词表，并都实现后端交接应答」，实际「某一入口漏答交接使扩展等满 15 s 后自毁，或某一侧改了文件名/词表而另一侧未跟随，扩展读到不认识的请求」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:12-18 镜像的文件名常量；:53-63 头注声明第二路径与 known debt；:80 connect；:118 disconnect；:150 answerBackendHandoff 250 ms×60；entry/src/main/ets/components/BridgeStatus.ets:2351 beginVpnConnection；:2478 requestVpnExtensionStart；:2502 stopVpnProbe；:3407 processVpnBackendHandoffRequest；entry/src/main/ets/entryability/EntryAbility.ets:202-227 performCardToggle；docs/background-vpn-reliability.md:178 The second failure: a headless connect could never complete；docs/architecture/architecture.md 第四节 D1、第五节责任空洞检查第 1 条
- 上游：R-CONN-08
- 待建测试：[集成] scripts/integration/orchestration-fork.mjs::两条入口对同一扩展交出同一文件契约且都应答后端交接
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-11 应用进程 ↔ 系统：长时任务与实况窗
- 层级：接缝
- 父判据：O-CONN-06、O-CONN-03
- 强度：强
- 设计依据：架构 §三 3.1、§四 D4（长生命周期服务端放扩展进程）与 D5（连接窗口也算 live）、§五 责任空洞检查第 3 条；`module.json5` 声明 `backgroundModes ["dataTransfer"]`；架构 A-SEAMS、A-D5、A-D4
- 触发与前置条件：P1 进入前台并开始监测 VPN 状态；`VpnBackgroundTaskManager` 每 1000 ms（`CONNECTION_CHECK_INTERVAL_MS`）读 `vpn-probe-status.txt`，据此决定向系统申请或释放 DATA_TRANSFER 长时任务
- 可观测点：长时任务通知与 `background_started` / `background_stopped` / `background_status_timeout` / `background_started_special_scenario` 事件；UI 与 VPN 进程的存活、进程 ID、心跳龄（走查 M-01）；TUN 双向读写计数（走查 M-02）；`vpn-probe-status.txt` 的 state 词表
- 期望：正常：P1 把「系统长时任务」当作对 P2 存活窗口的承诺——只要读到 live 状态（`connected`，或含 `vpn interface established` 的新鲜心跳被解析为 `connecting`）且心跳龄 ≤ `VPN_STATUS_FRESH_MS`(15000 ms)，就持有 `dataTransfer` 长时任务，并把 txBytes/rxBytes 以 `SlotType.LIVE_VIEW` 的实况窗通知（`typeCode 8`）按 `NOTIFICATION_UPDATE_INTERVAL_MS` 刷新；start/stop 经 `operationInFlight` 串行化，一次只允许一个在途操作，生命周期代际（generation/cancellationRevision）保证销毁期间的迟到操作被丢弃。边界：心跳陈旧或缺失（>15 s）判为**不确定**而不是 connected，已持有的任务在 `VPN_STATUS_GRACE_MS`(60000 ms) 宽限后才释放并记 `background_status_timeout`，且从不凭旧证据新建任务；用户主动取消保活通知（`USER_CANCEL` / `USER_CANCEL_REMOVE_NOTIFICATION`）后 `suppressedUntilDisconnect` 置真，同一会话内不自行恢复。失败与恢复：只有系统侧取消（非用户）才由 `scheduleRetry` 安排退避重试（`START_RETRY_BASE_MS` 30000 起、指数、`START_RETRY_MAX_MS` 300000 封顶）；读到 `disconnected` 时立即清零重试态并释放任务。**责任空洞（本层确认的唯一空洞，必须写在此处）**：P1 在后台且未持有长时任务时会被系统冻结，此时若 P2 被杀导致掉线，没有任何子系统承诺「P1 被冻结期间的掉线恢复」——恢复责任在 `VpnReconnectSupervisor`，而它恰恰是可能已被冻结的一方；用户回到应用之前会一直保持断开（`docs/background-vpn-reliability.md` Milestone 2「stayed disconnected until the user noticed」，D4 风险）。安全与质量：把连接窗口与稳定连接等重持有不得放松 Milestone 1 的收紧原则——无法识别的状态（`state=Running | tun=false`、裸 lifecycle 行、陈旧心跳）仍不持有任务；实况窗只回显字节数与本地化标题，不含地址或凭据。已知局限：M-01/M-02 在 USB/HDC 连接且充电下完成，通过一次不代表电池深度休眠、拔线、强杀或重启仍成立；M-11 的 720 s 连续蜂窝锁屏未完成，不得据此宣称蜂窝下的长时间后台存活。
- 失败信息：期望「连接窗口与稳定连接期都持有 dataTransfer 长时任务、心跳陈旧按不确定有界宽限释放」，实际「窗口期 P1 被冻结、无人应答交接；或拿到陈旧证据就新建任务、用户取消后自行恢复；或后台掉线在 P1 被冻结期间无人恢复」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:14-16 新鲜度/宽限/1 s 节拍；:66-71 USER_CANCEL 判定；:151-198 reconcile；:171 与 :202 live 判定；:205-239 start 与串行化；:309-330 LIVE_VIEW 实况窗；:392-396 scheduleRetry 退避；entry/src/main/module.json5:29-30 backgroundModes [dataTransfer]；docs/background-vpn-reliability.md:56-67 Milestone 2 的恢复空洞；docs/architecture/architecture.md 第四节 D4/D5、第五节责任空洞检查第 3 条
- 上游：R-CONN-04、R-CONN-10
- 测试：真机走查 a01-baseline/manual-checks.md#M-01
  真机走查 a01-baseline/manual-checks.md#M-02
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SEAM-12 应用进程 ↔ 系统：网络变化回调与重绑
- 层级：接缝
- 父判据：O-NET-03
- 强度：强
- 设计依据：架构 §三 3.2(d)、§一（R-NET-03 逼出网络监听必须在扩展进程）、§五 O-NET-03 行；架构 A-SEAMS、A-D2、A-D4
- 触发与前置条件：P2 的 `VpnNetworkMonitor` 在扩展进程内注册系统默认网络回调；承载在蜂窝与 Wi-Fi 之间变化，或网络短暂 down/up 时触发
- 可观测点：`vpn_network_rebound_wifi` / `vpn_network_rebound_cellular` / `vpn_network_offline` / `vpn_network_refresh_failed` 事件；TUN 双向包计数与 discovery 响应时间（走查 M-03/M-04）；日志中是否出现地址数据；VPN 会话是否被重建
- 期望：正常：系统默认网络回调必须交给系统侧的重绑入口——`VpnNetworkMonitor.refresh:148` 把物理网络变化经 `nativeBridge.backendNetworkChangedAsync(network.interfaceName):164` 交给引擎重绑套接字并刷新 STUN，成功后按承载类别记 `vpn_network_rebound_wifi` / `vpn_network_rebound_cellular`；`interfaceName` 为空时记 `vpn_network_offline`。边界：回调抖动必须被合并、去抖和限速——`revision`/`appliedRevision` 保证等待重绑期间到达的最新变化不被丢弃（只有重绑完成后才标记 applied），`SETTLE_MS` 750 ms 与 `MIN_REBIND_MS` 3000 ms 限速，程序注册失败或重绑失败在 `RETRY_MS` 5000 ms 后重试。失败与恢复：重绑失败归引擎重绑逻辑（P2），有界 5 s 重试而不要求用户重连；M-03 实测同一次 VPN 会话内完成 cellular → Wi-Fi → cellular 重绑，回到 Wi-Fi 的直连 discovery 响应 11 ms（修复前基线 85 ms），Wi-Fi 下 TUN 流量 +142/+142 包、蜂窝下 +12/+20 包；M-04 短 `tailscale down`/`up` 后 436 ms 自动回到可用中继路径且 VPN session 不变。安全与质量：地址数据不得跨越这条接缝——只上报接口名、承载类别与数值错误码，地址与 DNS 只留在内存（R-NET-04，`VpnNetworkMonitor` 头注「never logs address data」）。已知局限：M-03/M-04 数值转抄自 `docs/vpn-network-recovery.md`，本批未复跑；两端皆硬 NAT 时六次 discovery 走 DERP，判据不把中继谎报为直连。
- 失败信息：期望「网络变化在扩展进程内被合并、去抖并有界重试地交给引擎重绑」，实际「网络变化后要求用户重连，或重绑失败后不再重试，或地址数据进入日志」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:5-7 三个节拍常量；:15-17 门内注释（回调留在 VPN 进程）；:148 refresh；:164 backendNetworkChangedAsync 重绑；:172-179 rebound/offline/refresh_failed 事件；:185-186 revision 与重试判定；entry/src/main/cpp/types/libtailscale_ohos/index.d.ts:9 backendNetworkChangedAsync 声明；docs/vpn-network-recovery.md:92-102 真机测量
- 上游：R-NET-03、R-NET-04
- 测试：真机走查 a01-baseline/manual-checks.md#M-03
  真机走查 a01-baseline/manual-checks.md#M-04
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核
