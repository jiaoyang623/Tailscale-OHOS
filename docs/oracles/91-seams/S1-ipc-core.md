# 接缝判据 · 应用进程 ↔ VPN 扩展的生命周期与状态面（O-SEAM-01 … O-SEAM-04）

本文件覆盖 P1（应用进程）与 P2（VPN 扩展进程）之间文件协议里最靠近「谁交给谁什么」的四条接缝：
生命周期命令通道、后端交接、状态与心跳、对端快照。两进程之间不能互相调用方法，全部交接都落在
`context.filesDir` 这一份**无锁、无租约**的共享目录上（`services/StoragePaths.ets:12`），
所以每条期望都以「文件名 + 原子写（`.tmp` + rename）+ requestId 或新鲜度」三件套为口径，
并逐条写明失败归哪一侧。

### O-SEAM-01 应用进程 ↔ VPN 扩展：生命周期命令通道
- 层级：接缝
- 父判据：O-CONN-01、O-CONN-02
- 强度：强
- 设计依据：架构 §五「旅程与接缝」SEAM-02（连接配置投递）与 SEAM-05（停止/断开），§七 对照到 O-SEAM-01；需求 R-CONN-01「从首页一键连接：拉起 VPN 扩展、经系统授权、进入可用的隧道」、R-CONN-02「从首页一键断开：停止扩展、释放长时任务、回到未连接态」；架构 A-SEAMS、A-D2
- 触发与前置条件：应用进程要拉起或停掉 VPN 扩展时——UI 路径由 `BridgeStatus.beginVpnConnection` / `stopVpnProbe` 发起，无 UI 路径由 `VpnSessionController.connect` / `disconnect` 发起，两条路径写同一组文件名；此时 `filesDir` 对两进程是同一份目录，没有锁
- 可观测点：`filesDir/vpn-connect-config.json` 的内容与创建时间、`filesDir/vpn-stop-request.json` 与 `vpn-stop-response.json` 的 `requestId`、扩展进程的创建与销毁、诊断事件 `vpn_extension_created` / `vpn_start_requested` / `vpn_stop_requested` / `vpn_backend_stop_timeout`
- 期望：正常：应用进程用 `VpnCommandGateway.begin()` 取 `commandId` 并以 `isActive()` 守卫迟到结果（`services/VpnCommandGateway.ets:31`、`:46`），把本进程引擎取回的配置经 `stageConnectConfig` 以 `.tmp` + rename 原子写进 `vpn-connect-config.json`（`:127-129`），再用 `startVpnExtension` 把 `Want{ren.w2h.mesharc/TailscaleVpnExtensionAbility}` 交给系统（`:119-120`）；扩展在 `onCreate` 读同一份配置并建 TUN，两侧的文件名与轮询常量逐字相同（`services/VpnSessionController.ets:12-30` 是 `BridgeStatus` 那组字面量的镜像）。断开方向相反：发起方先写空 `vpn-stop-response.json` 清掉陈旧应答，再写 `requestId = Date.now()` 的 `vpn-stop-request.json`（`services/VpnSessionController.ets:126-131`），轮询到 `requestId` 匹配的应答后调 `stopVpnExtension` 并记 `vpn_stop_requested`（`:134-135`）。边界：配置带 15 s TTL（`vpnextensionability/TailscaleVpnExtensionAbility.ets:62`），过期配置不驱动建 TUN；扩展启动时把上一进程可能残留的 `vpn-stop-request` / `vpn-stop-response` 与后端交接两个文件清空（`:344-363`，注释写明「绝不让陈旧请求停掉新建会话」），使陈旧请求不会误停新会话；扩展从未启动时停止请求不挂起，以发起方自身的 150 次轮询预算收尾。失败与恢复：发起方在 150 次 × 50 ms 内没等到匹配应答时记 `vpn_backend_stop_timeout`，把本次应答判为无效，并仍按 Ability 生命周期调 `stopVpnExtension` 兜底（`services/VpnSessionController.ets:20-21`、`:228-239`；`components/BridgeStatus.ets:2502` / `:2531` / `:2570`）——超时意味着失去确认，不等于失败；配置原子写返回 false 时发起方以 `FAILED` 收尾，不让半写文件被当作配置；扩展建 TUN 失败则以 `FAILED | VPN start | code=<code>` 交出状态，是否重试由发起方决定。走查覆盖：M-05 记录了一次完整连接窗口（配置投递 → 扩展拉起 → 建 TUN 成功），因此连接这一半有真机证据；断开方向的 `requestId` 应答没有走查证据，只有单点用例。安全与质量：每类握手文件只有一个写方（发起方写请求、扩展写响应），请求先清响应再写，应答只认本次 `requestId`；请求与应答文件里只有 `requestId` 与状态行，配置内容只在本应用私有的 `filesDir` 内传递。
- 失败信息：期望「配置以原子写落在同一文件名上、扩展在 TTL 内据此建 TUN，停止请求只被本次 requestId 的应答解除」，实际「半写配置被读走、过期配置仍驱动建 TUN，或停止请求等不到匹配应答而把扩展留在半停状态」
- 来源：entry/src/main/ets/services/VpnCommandGateway.ets:119 startVpnExtension；entry/src/main/ets/services/VpnCommandGateway.ets:127 stageConnectConfig 的原子写；entry/src/main/ets/services/VpnSessionController.ets:126-135 停止请求与应答；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:62 VPN_CONNECT_CONFIG_TTL_MS；entry/src/main/ets/components/BridgeStatus.ets:2502 stopVpnProbe
- 上游：R-CONN-01、R-CONN-02
- 待建测试：[集成] scripts/integration/vpn-lifecycle-channel.mjs::停止请求带 requestId 且迟到的应答不被采信
- 状态：pending-test
- 不确定特征：NOT-EVALUATED
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-02 应用进程 ↔ VPN 扩展：后端交接
- 层级：接缝
- 父判据：O-CONN-01、O-CONN-03、O-CONN-07
- 强度：强
- 设计依据：架构 §五 SEAM-01（后端交接，§七 对照 O-SEAM-02）、§四 D1（同一接缝有双应答方）与 D5（连接窗口计入 live）；需求 R-CONN-03「连接窗口期内应用进程必须持有长时任务，使切到后台后仍能应答扩展的后端交接请求」、R-CONN-08「无 UI 的入口（桌面卡片、后台恢复）也能独立完成连接，且应答扩展的后端交接」；架构 A-SEAMS、A-D1、A-D2、A-D3
- 触发与前置条件：扩展 `createVpnConnection` 拿到 TUN fd、要用 `backendRestartWithTun` 抢过后端时（`vpnextensionability/TailscaleVpnExtensionAbility.ets:537`）；此时两个进程各自的引擎实例都可能已经跑起来（架构 §四 D3），谁先停手是本接缝要解决的事
- 可观测点：`filesDir/vpn-backend-handoff-request.json` 与 `-response.json` 的 `requestId`；`vpn-probe-status.txt` 中的 `VPN interface established | backend handoff pending`；诊断事件 `vpn_backend_handoff_request_failed` / `vpn_backend_handoff_stopped` / `vpn_backend_handoff_stop_failed` / `vpn_backend_handoff_timeout`
- 期望：正常：扩展生成 `requestId = Date.now()`，先清空响应文件（`:653`），再原子写请求（`:654`），并把状态写成 `VPN interface established | backend handoff pending`（`:658`），然后以 100 ms × 150（= 15 s，常量在 `:31-32`）轮询响应，只在 `response.requestId === requestId` 时认账并把响应清空（`:667-671`）。应答方有两个（D1）：`BridgeStatus.processVpnBackendHandoffRequest`（`:3407`，仅当连接在途、命令代次有效且可见状态含 `backend handoff pending` 时才动手）与 `VpnSessionController.answerBackendHandoff`（`:150`，250 ms × 60 轮询同一请求文件）。两者都先停本进程后端再原子写 `{requestId,status}` 的响应，停后端抛错也必须回写（`components/BridgeStatus.ets:3434-3436`、`:3442-3447`；`services/VpnSessionController.ets:161-172`）。扩展认账后才走完建隧道流程，之后由 1 s 状态环开始发布状态。边界：扩展只认 `requestId` 匹配的应答，旧应答被清空而不是被采信（`:667-672`）；扩展已 `destroying` 时立刻返回 `FAILED | backend handoff | extension stopped`，不再耗满预算（`:646-648`、`:660-662`）。两个应答方的窗口（250 ms × 60 = 15 s）与扩展的预算（100 ms × 150 = 15 s）只是数值恰好相等而没有耦合，任一侧单独调整就会静默漏答（架构 §五 空洞检查第 1 条）——「预算必须成对调整」是本接缝的显式质量约束。失败与恢复：15 s 内无匹配应答时扩展记 `vpn_backend_handoff_timeout`、返回 `FAILED | backend handoff | stop timeout`，并销毁 VPN（`:679-680`）；失败责任落在应答方一侧（连接窗口里 P1 若未持有长时任务会被冻结，D5）。无 UI 路径的应答失败同样要回写以释放扩展，并记 `vpn_backend_handoff_stop_failed`。Q-01 未决：若平台把两进程里加载的同一份 `.so` 视为同一个运行时，应答方「停掉自己的后端」可能连带停掉扩展那一份，这条交接协议存在的理由随之改变；本层不假设答案。走查覆盖：M-05 是这条接缝的机上时序样本，但它记录下来的是一次超时失败（14:10:18.864 建 TUN → 14:10:23.973 切后台 → 14:10:34.468 `vpn_backend_handoff_timeout`），本批修复未在真机端到端复跑。安全与质量：请求与应答里只有 `requestId` 与状态字符串，没有凭据与地址；应答方停后端失败也必须回写，避免把扩展吊死整个预算。
- 失败信息：期望「扩展写请求后 15 s 内拿到 requestId 匹配的应答并继续建隧道，无 UI 路径也必答」，实际「无人应答、扩展记 vpn_backend_handoff_timeout 并销毁 VPN，或陈旧应答被当作本次答案」
- 来源：entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:645 requestUiBackendHandoff；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:31-32 交接轮询常量；entry/src/main/ets/components/BridgeStatus.ets:3407 processVpnBackendHandoffRequest；entry/src/main/ets/services/VpnSessionController.ets:150 answerBackendHandoff
- 上游：R-CONN-03、R-CONN-08
- 待建测试：[集成] scripts/integration/vpn-backend-handoff.mjs::应答方在预算内回写响应否则扩展销毁隧道
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-03 VPN 扩展 → 应用进程：状态与心跳
- 层级：接缝
- 父判据：O-CONN-06、O-CONN-03、O-DEV-01
- 强度：强
- 设计依据：架构 §五 SEAM-03（状态/心跳，§七 对照 O-SEAM-03）、§四 D5（连接窗口算 live）与 D6（三档节奏）；需求 R-CONN-04「已连接时切到其它应用、锁屏静置，隧道不中断」、R-CONN-09「长时任务在状态缺失/陈旧时按不确定处理，有界宽限后释放」；架构 A-SEAMS、A-D5、A-D6
- 触发与前置条件：扩展处在任何生命周期状态时都在写；应用进程的长时任务、设备分区、卡片进程都在读同一份 `vpn-probe-status.txt`
- 可观测点：`filesDir/vpn-probe-status.txt` 的状态行与 `heartbeatMs=…`；`vpn-config-summary.txt`、`vpn-peer-probe-status.txt`；诊断事件 `background_status_timeout` / `background_started` / `vpn_status_grace_started` / `vpn_status_grace_expired`；读侧解析出的四值状态（connected / connecting / disconnected / unknown）
- 期望：正常：扩展的 1 s 状态环先调 `writeCurrentStatusHeartbeat()`，把 `<currentVisibleStatus> | heartbeatMs=Date.now()` 原子写进 `vpn-probe-status.txt`（`vpnextensionability/TailscaleVpnExtensionAbility.ets:1909-1911`），再等 `backendSnapshot` 完成后覆写状态与三份快照——心跳先写，存活判据不被快照耗时污染（`:905-951`）。读方只有一个判读：`services/VpnStatusReader.ets:80-100` 的 `judge()`。`services/VpnBackgroundTaskManager.readStatus`（`services/VpnBackgroundTaskManager.ets:344-354`）调它，而不是自己再解析一遍；`components/BridgeStatus.ets` 只借用同一个新鲜窗口常量 `VPN_STATUS_FRESH_MS`（`VpnStatusReader.ets:12`），不再自带 5000 ms 门限。判读顺序固定：陈旧、未来或缺失的心跳一律 unknown（`VpnStatusReader.ets:83-85`）；终态标记压过运行中的隧道（`:87-89`）；`state=Running` 且 `tun=true` 判 connected（`:90-92`）；`needsLogin` 判 needs_login（`:93-95`）；`vpn interface established` 判 connecting（`:96-98`）。边界：陈旧或缺失一律是「不确定」而不是「已断开」（`VpnStatusReader.ets:12` 的注释与 `:83-85` 的早返回都写明这一点）；一条同时含 connected 与终态标记的行报 disconnected，因为扩展每秒只写一个状态，这种行只来自过渡或拼接，而凭一条自相矛盾的行持有长时任务是更坏的错误；持有长时任务的一方只在 connected/connecting 且心跳新鲜时新建任务，无法辨认的行（`state=Running | tun=false`、裸 lifecycle 行、陈旧心跳）既不新建任务也不凭旧证据取任务（`services/VpnBackgroundTaskManager.ets:171-183`、`:350-368`）。失败与恢复：已持有任务而心跳转陈旧时，宽限 60 s（`VPN_STATUS_GRACE_MS`，`services/VpnBackgroundTaskManager.ets:15`）后释放并记 `background_status_timeout`（`:175`）；系统取消才是 `scheduleRetry` 的触发条件，用户取消后同一会话不再自行恢复（`:182`、`:392`）。写侧失败按 best-effort 处理：状态落盘失败绝不中断 VPN（`vpnextensionability/TailscaleVpnExtensionAbility.ets:1921-1924` 的注释）。走查覆盖：M-01 在锁屏静置 721 s 内采了 25 个样本，UI/VPN 进程 ID 全程不变、最大心跳龄 1104 ms，直接观测的就是这条 1 s 覆写与新鲜度判读；已知局限是走查在 USB/HDC 连接并充电的条件下完成，蜂窝下的长时间存活（M-11）未闭环，且 M-01/M-02 未直接观测 R-CONN-09 的宽限释放。安全与质量：状态行是自由文本，读侧靠字面量匹配（connecting 的判据是一条 `includes`），所以扩展改一句文案就会静默取消保护。这条耦合已由 `scripts/integration/status-vocabulary.mjs` 逐条钉住；写侧只承诺 1 s 覆写、读侧负责把不确定转成有界宽限，责任划分不可反置。
- 失败信息：期望「1 s 覆写 + 15 s 新鲜窗口，陈旧即判不确定并走有界宽限」，实际「陈旧心跳被判成已连接，或状态文案一改读侧就再也认不出连接窗口」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:80-100 judge（唯一判读）；entry/src/main/ets/services/VpnStatusReader.ets:12 VPN_STATUS_FRESH_MS；entry/src/main/ets/services/VpnBackgroundTaskManager.ets:344-354 readStatus 委托；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1909 writeCurrentStatusHeartbeat；entry/src/main/ets/components/BridgeStatus.ets:3313 借用同一个窗口；scripts/integration/status-vocabulary.mjs
- 上游：R-CONN-04、R-CONN-09
- 测试：真机走查 a01-baseline/manual-checks.md#M-01
- 测试：scripts/integration/status-vocabulary.mjs::both readers give the same answer for every status line
- 测试：scripts/integration/status-vocabulary.mjs::one freshness window serves every reader, and the UI reads it from here
- 测试：scripts/integration/status-vocabulary.mjs::a terminal marker wins over a running tunnel in both readers
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SEAM-04 VPN 扩展 → 应用进程：对端快照
- 层级：接缝
- 父判据：O-DEV-02
- 强度：强
- 设计依据：架构 §五 SEAM-04（对端快照，§七 对照 O-SEAM-04）、§二 2.4 数据归属表；需求 R-DEV-03「设备详情展现在线状态、路径类型（直连/DERP）与延迟，可手动刷新」、R-DEV-05「对端探测结果过期即失效，不能拿旧结果覆盖新的路径」；架构 A-SEAMS、A-D6
- 触发与前置条件：扩展每 1 s 快照环里随 `backendSnapshot` 一起产出；应用进程的设备列表与设备详情读同一份 `vpn-peers.json`
- 可观测点：`filesDir/vpn-peers.json` 的 `peers`、`meshArcReceiver` 与 `updatedAtMs`；应用侧 `peerSnapshotSignature` 是否更新；扩展 `onCreate` 先写的那份空快照
- 期望：正常：扩展把 `peers` + `meshArcReceiver` + `updatedAtMs` 用 `writeAtomicTextFile` 原子写进 `vpn-peers.json`（`vpnextensionability/TailscaleVpnExtensionAbility.ets:1004-1007`），每 1 s 一轮，且两者在同一次写里，不存在半新半旧。应用进程 `refreshPeerSnapshot`（`components/BridgeStatus.ets:3597-3630`）只在 `updatedAtMs` 距今不超过 5000 ms、`ageMs` 不为负、且 `peer.key` 匹配 `/^peer-[a-f0-9]{16}$/` 与 `name` 非空时接受这份快照（`:3605-3610`），并用 signature 去重，没有变化就不重复刷新（`:3620-3625`）。边界：文件缺席（扩展未启动或被回收）与文件过期走同一条路——保留上一份有效列表（`:3600-3607` 的早返回）；key 不合规的条目被逐条过滤而不是整份拒绝（`:3609-3610`）；扩展在 `onCreate` 先写一份空快照（`:341`），使「空」是一个明确的已发布值而不是缺席。失败与恢复：过期（> 5000 ms）、`updatedAtMs` 非正、时间倒流、JSON 解析失败四种情况一律丢弃本次快照并保留上一份（`:3606-3608` 与 `:3631-3634` 的 catch），刷新责任留给下一轮 1 s 轮询；发布责任在扩展（它承诺 1 s 覆写），若读侧的 5000 ms 判定被放宽，陈旧数据就会以「当前」呈现，属数据错误而由读侧负责。安全与质量：原子写保证读不到半写 JSON；快照里只有对端 key、名称、系统、在线态与计数，不含凭据与地址；卡片进程不读这份文件——`services/VpnStatusReader.ets:28-35` 的头注写明它只读状态文件、不依赖原生桥，所以「隧道健康」与「设备数据」的判据必须分开，不能互相顶替。
- 失败信息：期望「超过 5 s、时间倒流或 key 不合规的快照被丢弃，只接受整份原子写出的当前快照」，实际「过期快照被当作新数据刷新列表，或异形 key 的对端被渲染成有效设备」
- 来源：entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:1004-1007 writePeerSnapshot；entry/src/main/ets/components/BridgeStatus.ets:3597-3630 refreshPeerSnapshot；entry/src/main/ets/components/BridgeStatus.ets:3606 五秒新鲜门限；entry/src/main/ets/services/VpnStatusReader.ets:28-35 卡片只读状态文件的边界
- 上游：R-DEV-03、R-DEV-05
- 待建测试：[集成] scripts/integration/vpn-peer-snapshot.mjs::超过五秒的对端快照被丢弃
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核
