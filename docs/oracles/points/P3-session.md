# MeshArc 单点判据 · 无 UI VPN 控制器与后端交接（O-SESSION）

本文件覆盖 `scripts/test-vpn-session-controller.mjs` 的 headless 连接路径
（桌面卡片 `call` 事件、后台恢复）与它应答扩展后端交接的那半环。
2026-10-20 起，它还覆盖意图文件（`scripts/test-vpn-session-intent.mjs`）
与会话账本（`scripts/test-session-ledger.mjs`）的 O-SESSION-09…13。
父判据是接缝 `O-SEAM-02`（后端交接）、`O-SEAM-01`（生命周期命令通道）、
`O-SEAM-10`（编排分叉）、`O-SEAM-03`（状态与心跳）、`O-SEAM-19`（会话结束事件与原因分类）。

**口径说明（本文件通篇适用）**：这些用例不用桩件替身，而是把真实的
`entry/src/main/ets/services/VpnSessionController.ets` 与 `VpnStatusReader.ets` 读进来，
`stripTypeScriptTypes` 去类型后在 `node:vm` 沙箱里执行；平台边界被替换成桩——
`VpnCommandGateway`（文件命令协议）、`VpnStatusReader.read`、`ControlServerConfig.load`、
`DiagnosticEventStore.record`、`deviceInfo`、`setTimeout`（改为由用例手动放行的句柄）。
因此**决策逻辑是真的，平台边界是桩**：一条通过只说明「给定这组桩，决策正确」，
不证明真机上的文件协议、扩展存活、15 s 预算或系统拉起。凡结论依赖桩的地方在 `期望` 里写明。

### O-SESSION-01 已连接或正在连接时无 UI 连接判为 unchanged
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-08「无 UI 的入口（桌面卡片、后台恢复）也能独立完成连接」；架构 §五 O-CONN-07 行（无 UI 连接与 O-CONN-01 同一预算）、§七 SEAM-03 对照行；HLD 契约 C-03
- 触发与前置条件：`VpnSessionController.connect(filesDir)` 被调用，`VpnStatusReader.read` 读到 state=connected、connecting，或 unknown 且意图在 30 秒内刚写为 connected
- 可观测点：connect 的返回值、`VpnCommandGateway.startVpnExtension` 的调用次数、后端 stop 次数、应答循环是否入队了 sleep 句柄、`VpnSessionIntent.read` 的 `changedAtMs`
- 期望：正常：状态已是 connected 时立即返回 `VpnActionResult.UNCHANGED`；边界：状态为 connecting 时同样返回 unchanged，不启动第二个扩展，但用户连接仍写意图 connected；状态为 unknown 但意图在 30 秒内刚写为 connected 时也返回 unchanged，因为原连接可能仍在后端或配置阶段；失败与恢复：unknown 且意图陈旧时走正常连接流程（O-SESSION-02），状态文件读不到或缺心跳不得被当成「正在连」
- 失败信息：期望「已连接或正在连接时 connect 返回 unchanged 且不起扩展」，实际「重复拉起扩展，或为空转的应答循环排入轮询」
- 来源：entry/src/main/ets/services/VpnSessionController.ets connect 的 connected、connecting 与 unknown 早退；CONNECT_REQUEST_FRESH_MS；VpnStatusReader.read 与新鲜度判定；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::a connect that is already up never starts or stops anything
- 测试：scripts/test-vpn-session-controller.mjs::a connect during the connect window does not start a second extension
- 测试：scripts/test-vpn-session-controller.mjs::a second connect during an uncertain status does not start again
- 测试：scripts/test-vpn-session-controller.mjs::an old connected intent does not block a connect during an uncertain status
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-02 无 UI 连接只拉起扩展一次并立即返回，交接在后台进行
- 层级：单点
- 父判据：O-SEAM-01、O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-08、R-CONN-01；架构 §五 O-CONN-07 行与责任空洞检查第 1 条（headless 是第二个应答方）；`VpnSessionController.ets:106-107` 明写「刻意不 await」；HLD 契约 C-01
- 触发与前置条件：未连接、控制服务器已确认、后端已就绪且 `requestVpnConfig` 返回不含 PENDING 的配置
- 可观测点：connect 的返回值与返回时机、`startVpnExtension` 次数、应答循环是否已挂起等待下一次 sleep、写下的文件名
- 期望：正常：投递连接配置到 `vpn-connect-config.json`、清空 `vpn-backend-handoff-request.json` 与 `vpn-backend-handoff-response.json`，再请求系统拉起扩展，然后立即返回 `STARTED`——不等待交接完成；边界：一次 connect 只拉起扩展一次，扩展已在跑也不重复拉起；失败与恢复：投递或拉起失败返回 `FAILED`，不进入应答循环；安全与质量：用的文件名必须与 UI 路径逐字相同（`VpnSessionController.ets:12-18` 声明镜像），否则扩展读不到请求
- 失败信息：期望「拉起扩展一次后立即返回 STARTED，交接在后台进行」，实际「connect 阻塞到交接完成，或文件名漂移导致扩展读不到配置」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:12-18 镜像 UI 侧的文件名常量；:100-104 投递配置、清交接文件、拉起扩展；:106-111 不 await 的应答循环与 STARTED 返回；:258-261 clearHandoffFiles；:67-69 vpnWant；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-08、R-CONN-01
- 测试：scripts/test-vpn-session-controller.mjs::a headless connect answers the extension backend handoff
- 测试：scripts/test-vpn-session-controller.mjs::the handoff answer keeps polling while no request has arrived
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-03 交接应答循环在请求到达前保持轮询而不是空答
- 层级：单点
- 父判据：O-SEAM-02、O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-08；架构 §五 O-CONN-07 行、责任空洞检查第 1 条（250 ms × 60 与扩展 100 ms × 150 只是恰好相等）；HLD 契约 C-02
- 触发与前置条件：headless connect 已返回 STARTED，扩展尚未写下它的交接请求
- 可观测点：`vpn-backend-handoff-response.json` 是否被写、stop 次数、应答循环是否仍有一个待放行的 sleep 句柄
- 期望：正常：请求文件为空或不存在时不写应答、不调 `stopBackend`，而是继续排下一次轮询；边界：空字符串与「文件不存在」都算「还没有请求」，不得把空文件当成一个 requestId 为 0 的请求去应答；失败与恢复：请求随后到达时仍能应答（由 O-SESSION-04 守）
- 失败信息：期望「没有请求时保持轮询且不作答」，实际「空转退出循环或对空请求写出应答」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:150-176 answerBackendHandoff；:151-153 次数上限与读请求文件；:154 只认非空；:174 轮询 sleep（250 ms）；:29-30 轮询间隔与次数常量；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::the handoff answer keeps polling while no request has arrived
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-04 有效交接请求先清请求文件再一次应答，回写同一 requestId 与后端状态
- 层级：单点
- 父判据：O-SEAM-02
- 强度：强
- 设计依据：需求 R-CONN-03「连接窗口期内…应答扩展的后端交接请求」、R-CONN-08；架构 §五 责任空洞检查第 1 条（无人应答即扩展自毁）；HLD 契约 C-02
- 触发与前置条件：应答循环读到含正整数 requestId 的 `vpn-backend-handoff-request.json`
- 可观测点：`vpn-backend-handoff-response.json` 的内容（requestId 与 status）、请求文件被清空、`stopBackend` 次数、诊断事件 `ui:vpn_backend_handoff_stopped`
- 期望：正常：先清空请求文件（使同一次请求不可能被应答第二次），再调 `stopBackend`，然后把 `{requestId, status}` 写进应答文件——requestId 与请求逐字相同，status 是后端返回的字符串；边界：请求文件必须在应答之前被清掉，否则下一次轮询会重复应答；失败与恢复：`stopBackend` 抛异常时仍走 O-SESSION-05 的失败应答分支；安全与质量：只应答本进程发起的请求，requestId 不匹配的一律不认（见 O-SESSION-06）
- 失败信息：期望「请求文件先清后答、应答里回写同一 requestId 与后端状态」，实际「应答不带 requestId、或请求文件没清导致重复应答」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:150-176 answerBackendHandoff；:155 先清请求文件；:156 requestIdOf；:163 stopBackend；:167-169 写应答；:170-171 记 vpn_backend_handoff_stopped；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-03、R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::a headless connect answers the extension backend handoff
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-05 后端停不下来时仍写出应答以释放扩展
- 层级：单点
- 父判据：O-SEAM-02
- 强度：强
- 设计依据：需求 R-CONN-03；架构 §五 O-CONN-07 行「应答但停不下来 ⇒ P1」、责任空洞检查第 1 条；HLD 契约 C-02
- 触发与前置条件：应答循环读到有效 requestId，但 `VpnCommandGateway.stopBackend()` 抛异常（例如后端已死）
- 可观测点：应答文件的 status、requestId、诊断事件 `ui:vpn_backend_handoff_stop_failed`
- 期望：正常：捕获停止失败后仍写应答，requestId 照抄请求，status 说明停止不可用（`FAILED | backend handoff | stop unavailable`）；边界：停止失败不得吞掉应答——扩展要的是「有人认领了这次交接」，不是后端确实停了；失败与恢复：记 `vpn_backend_handoff_stop_failed` 供诊断；安全与质量：失败路径不得把未停止的后端谎报为已停止（status 不以 OK 开头）
- 失败信息：期望「停止失败仍写应答并标 stop unavailable」，实际「异常冒泡导致应答缺失，扩展等满 15 s 后销毁 VPN」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:161-166 预置失败 status 与 try/catch；:167-171 写应答与按 status 前缀分派事件；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-03、R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::a backend that cannot be stopped still releases the extension
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-06 无效的交接请求被清除但既不停后端也不作答
- 层级：单点
- 父判据：O-SEAM-02
- 强度：强
- 设计依据：需求 R-CONN-08；`VpnSessionController.ets:156-160`（无法取得正整数 requestId 即拒）；架构 §五 责任空洞检查第 1 条；HLD 契约 C-02
- 触发与前置条件：请求文件的内容既可能是非法 JSON（如 `not json`），也可能是合法 JSON 但 requestId ≤ 0（如 `{"requestId":0}`）
- 可观测点：`stopBackend` 次数（必须为 0）、应答文件（必须未被写出）、请求文件被清空、诊断事件 `ui:vpn_backend_handoff_request_invalid`
- 期望：正常：两种情形都归入同一分支——先清空请求文件，记 `vpn_backend_handoff_request_invalid`，然后返回，不再轮询；边界：requestId 恰为 0、负数或缺失时都不得当成有效请求；畸形 JSON 与 requestId 非法在实现上是同一条路径，本判据按行为合并、按两条用例分别取证；失败与恢复：清空是关键——不清就会在同一轮循环里反复读同一条坏请求；安全与质量：**不得**因为一个无法辨认的请求就停止后端或写入应答，否则等于替扩展确认了一次并不存在的交接
- 失败信息：期望「无效请求被清掉但不作答、不停后端」，实际「把 requestId 0 当有效值去停后端，或对畸形内容写出应答」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:155 先清请求文件；:156-160 requestIdOf 返回值 ≤0 即记录 invalid 并返回；:178-185 requestIdOf 解析失败返回 0；:161-169 只有在 requestId 有效时才停后端并作答；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::a malformed handoff request is cleared, not answered
- 测试：scripts/test-vpn-session-controller.mjs::a stale request id is refused instead of confirming the handoff
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-07 交接应答的轮询预算必须覆盖扩展的等待预算
- 层级：单点
- 父判据：O-SEAM-02、O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-03；架构 §五 责任空洞检查第 1 条——「250 ms × 60 = 15 s 与扩展 100 ms × 150 = 15 s 只是恰好相等而无耦合，任何一侧单独调整都会静默失去应答」；HLD 契约 C-02
- 触发与前置条件：headless 连接已拉起扩展，扩展开始它自己的 15 s 等待
- 可观测点：`BACKEND_HANDOFF_POLL_INTERVAL_MS × BACKEND_HANDOFF_MAX_ATTEMPTS` 与扩展侧等待常量的关系；把任一常量改小（例如 10 s）后应答仍不丢失
- 期望：正常：本侧的应答窗口不短于扩展的等待预算，使扩展不会在应答到达前销毁 VPN；边界：改小任一侧常量都应使这条判据失败，而不是静默失效；失败与恢复：若窗口短于预算，扩展记 `vpn_backend_handoff_timeout` 并销毁 VPN（`docs/background-vpn-reliability.md` Milestone 3 的第二次真实故障）；安全与质量：两个常量分处两进程、没有共享定义，所以这条关系由一条用例直接读两个源文件来钉死（`scripts/test-vpn-session-controller.mjs`），任一侧单独调小都会让用例失败——已实测：把应答预算从 250 ms × 60 改成 250 ms × 20，用例报「answer window 5000 ms is shorter than the extension wait 15000 ms」
- 失败信息：期望「本侧轮询窗口 ≥ 扩展等待预算，且该关系被一条用例守住」，实际「只靠注释声明两个 15 s『恰好相等』，任一侧改动后无人发现」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:27-30（注释与两个常量）；vpnextensionability/TailscaleVpnExtensionAbility.ets 的交接等待（100 ms × 150，见架构 §五责任空洞检查第 1 条与需求 R-CONN-03 行）；docs/architecture/architecture.md 第五节责任空洞检查第 1 条；scripts/test-vpn-session-controller.mjs（用例 the handoff answer window covers the extension wait budget 直接读两个源文件里的四个常量并断言关系）
- 上游：R-CONN-03、R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::the handoff answer window covers the extension wait budget
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-08 生命周期销毁后命令状态机不保留旧态
- 层级：单点
- 父判据：O-SEAM-01
- 强度：强
- 设计依据：需求 R-CONN-02「停止扩展、回到未连接态」；架构 §四 D1（两条编排共用的命令机）；HLD 契约 C-01
- 触发与前置条件：`VpnCommandStateMachine.begin()` 之后 UI 生命周期被销毁（`BridgeStatus.ets:948`、`:1029` 调 `invalidateLifecycle()`）
- 可观测点：`currentState()` 与 `currentLifecycleGeneration()` 的返回值；迟到的 `complete()` / `timeout()` 的返回值与副作用
- 期望：正常：`invalidateLifecycle()` 之后 `currentState()` 回到 `stopped`，不保留这一代的命令结果；边界：上一代停在 `timed_out` 时也必须清掉，因为 `BridgeStatus.finishVpnExtensionStop`（`:2574`、`:2591`）用 `currentState() !== TIMED_OUT` 判断迟到结果能不能走完整停机路径，而那条路径会重启后端；失败与恢复：迟到的 `complete()` 与 `timeout()` 都返回 false 且不改变状态；安全与质量：销毁之后不得让「上一代的超时」把新生命周期里的后端重启一遍。判定在无平台桩的边界下成立
- 失败信息：期望「销毁后 currentState() 回到 stopped」，实际「停在 starting 或 timed_out，守卫据此走完整停机路径并重启后端」
- 来源：entry/src/main/ets/services/VpnCommandGateway.ets:63-73 invalidateLifecycle；entry/src/main/ets/components/BridgeStatus.ets:2574、:2591 的 currentState 守卫；scripts/test-vpn-command-state-machine.mjs
- 上游：R-CONN-02
- 测试：scripts/test-vpn-command-state-machine.mjs::a destroyed lifecycle does not keep reporting the command it superseded
- 测试：scripts/test-vpn-command-state-machine.mjs::a destroyed lifecycle does not keep reporting a timeout
- 测试：scripts/test-vpn-command-state-machine.mjs::a late timeout cannot move the state after a destroyed lifecycle
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-09 意图文件是唯一的状态意图来源
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-19
- 强度：强
- 设计依据：需求 R-CONN-11「用户没有点击停止时，连接不得停止」；架构 §2.6 横切约束 1「意图优先于观测」；HLD 契约 C-11、C-19
- 触发与前置条件：`VpnSessionIntent` 读、写 `filesDir/vpn-intent.json`；状态判读、长时任务、恢复三者读取同一份意图
- 可观测点：意图文件的 `desired`、`changedAtMs` 与 `by` 字段；`VpnSessionIntent.read` 的返回值；诊断事件 `vpn_intent_write_failed`、`vpn_intent_missing`
- 期望：正常：用户连接写 `desired=connected`，用户停止写 `desired=stopped`，`by` 取 `ui` 或 `card`；恢复连接不重写文件（意图已是 `connected`），恢复撤销只停扩展，不写意图、不记账本 `user_stop`。边界：文件缺失、空文件、非法 JSON、`desired` 不在词表内，一律读成 `stopped` 并记 `vpn_intent_missing`；一次状态判读不得写意图。失败与恢复：用户连接的意图写失败时，连接在下一个检查点取消，不启动扩展；写失败记 `vpn_intent_write_failed`；读方按 `stopped` 处理。安全与质量：意图文件只含这三个字段，不含地址、账号或令牌。判定在宿主侧桩边界（`fileIo` 为内存文件系统）下成立
- 失败信息：期望「意图只由用户动作与恢复写」，实际「状态判读顺带改了意图，用户停止后被打回 connected」
- 来源：entry/src/main/ets/services/VpnSessionIntent.ets；scripts/test-vpn-session-intent.mjs
- 上游：R-CONN-11
- 测试：scripts/test-vpn-session-intent.mjs::intent is the only writer that changes the desired state、scripts/test-vpn-session-controller.mjs::a recovery connect leaves the user intent untouched
- 测试：scripts/test-vpn-session-controller.mjs::a recovery undo leaves the user intent and the stop ledger alone
- 测试：scripts/test-vpn-session-controller.mjs::a user stop writes the intent and one user stop record
- 测试：scripts/test-vpn-session-controller.mjs::a user connect cancels when its intent write fails
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-10 非用户结束按受控原因词记录
- 层级：单点
- 父判据：O-SEAM-19
- 强度：强
- 设计依据：需求 R-CONN-12「非用户原因的断连都要落盘留证」；HLD 契约 C-19
- 触发与前置条件：`SessionLedger.recordEnd()` 收到一条结束记录；`reason` 来自任一写方
- 可观测点：账本文件的行内容（按写者分文件）；`SessionLedger` 的返回值；诊断事件 `vpn_session_end`、`vpn_session_end_observed`
- 期望：正常：记录写入 `sessionId`、`writer`、`kind`、`reason`、`phase`、`code` 与时间戳。`reason` 在词表内时原样保留。词表的七个原因各有写入方或明确的不适用理由：`user_stop` 由用户停止写，`extension_destroyed` 与 `handoff_timeout` 由扩展写，`extension_crash` 由心跳失效写，`network_lost` 由离线掉线写，`system_stopped` 由 VPN 冲突写，`unknown` 兜底。边界：词表外的 `reason` 替换为 `unknown`，`phase` 写明缺哪条证据。空 `sessionId` 的行不写。失败与恢复：写入失败返回 false，不抛异常。同一 `sessionId + kind` 第二次写入返回 false 且不追加。安全与质量：记录不含地址、账号、令牌与设备标识。判定在宿主侧桩边界（`fileIo` 为内存文件系统）下成立
- 失败信息：期望「每次非用户结束都有受控原因」，实际「原因缺失、拼写漂移或出现自由文本」
- 来源：entry/src/main/ets/services/SessionLedger.ets；scripts/test-session-ledger.mjs
- 上游：R-CONN-12
- 测试：scripts/test-session-ledger.mjs::every non-user end is recorded with a controlled reason
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::network loss defers recovery until the network returns
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a VPN conflict is recorded as a system stop and does not retry
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-11 账本有上限且不受探测噪声影响
- 层级：单点
- 父判据：O-SEAM-19、O-SEAM-15
- 强度：强
- 设计依据：需求 R-CONN-12、R-DIAG-03「诊断事件有按文件条数与字节的上限」；HLD 契约 C-19
- 触发与前置条件：连续写入超过 512 条结束记录，或单条记录使文件超过 64 KB
- 可观测点：账本文件的行数与字节数；保留下来的最早一条记录
- 期望：正常：每个写者的账本文件最多保留 512 行。边界：写入使该文件字节数超过 64 KB 时从最旧开始淘汰，直到回到上限内，至少保留 1 条。压缩只改本写者的文件。失败与恢复：结束记录与诊断事件分文件，探测噪声写满 `diagnostic-*-events.ndjson` 不影响账本。安全与质量：淘汰只按时间顺序，不按原因分类丢弃。判定在宿主侧桩边界下成立
- 失败信息：期望「账本有固定上限且不被探测事件挤掉」，实际「账本无限增长，或结束记录被诊断事件挤出」
- 来源：entry/src/main/ets/services/SessionLedger.ets；scripts/test-session-ledger.mjs
- 上游：R-CONN-12、R-DIAG-03
- 测试：scripts/test-session-ledger.mjs::the ledger survives probe noise and bounds itself
- 测试：scripts/test-session-ledger.mjs::a writer compacts only its own file
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-12 同一会话的同一类记录只写一次
- 层级：单点
- 父判据：O-SEAM-19
- 强度：强
- 设计依据：HLD 契约 C-19「同一 sessionId 的 end 记录只写一次」；架构 §2.6
- 触发与前置条件：P1 读到 P2 的结束记录后补写观测；P1 与 P2 都可能写 `end`
- 可观测点：账本中同一 `sessionId + kind` 的行数；`SessionLedger.recordEnd()` 的返回值
- 期望：正常：同一 `sessionId` 的 `end` 与 `observed` 各只有一行。边界：进程重启后以全部写者文件的内容为准，不重复写。失败与恢复：文件最后一行不完整时忽略该行，写入前截断到最后一个完整行。安全与质量：去重不依赖内存集合单独成立，也不依赖共享可写文件。判定在宿主侧桩边界下成立
- 失败信息：期望「一次结束只有一条记录」，实际「两个进程各写一遍，统计时重复计数」
- 来源：entry/src/main/ets/services/SessionLedger.ets；scripts/test-session-ledger.mjs
- 上游：R-CONN-12
- 测试：scripts/test-session-ledger.mjs::duplicate end records are written once
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-13 恢复后界面与快照回到一致状态
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-11、R-CONN-13；架构 §2.6；HLD 契约 C-11
- 触发与前置条件：`VpnSessionController.connect` 返回 `STARTED`，随后状态文件进入 `state=Running | tun=true`
- 可观测点：`trafficSession` 的变化；`refreshPeerSnapshot` 的调用；`vpn_session_recovered` 的写入；界面状态文案
- 期望：正常：恢复成功后立即刷新一次对端快照。`trafficSession` 与上一次不同则清零流量计量与图表样本。连接稳定 60 s 写 `vpn_session_recovered`。边界：恢复返回 `NEEDS_UI` 时不做上述刷新，写 `vpn_session_recovery_needs_ui`。恢复与前台连接同时进行时，后发起者由 `VpnCommandStateMachine.begin` 拒绝，恢复改为退避，不并发建隧道。失败与恢复：恢复失败不刷新快照，界面保持断开态。安全与质量：界面不得在恢复成功前显示已连接。判定在宿主侧桩边界下成立
- 失败信息：期望「恢复后快照与流量回到一致状态」，实际「恢复成功但界面仍显示旧流量与旧对端状态」
- 来源：entry/src/main/ets/services/VpnSessionController.ets；entry/src/main/ets/components/BridgeStatus.ets；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-11、R-CONN-13
- 测试：scripts/test-vpn-session-controller.mjs::a recovered session refreshes the snapshot and clears stale traffic
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核
