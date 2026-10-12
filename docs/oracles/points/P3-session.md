# MeshArc 单点判据 · 无 UI VPN 控制器与后端交接（O-SESSION）

本文件覆盖 `scripts/test-vpn-session-controller.mjs` 的 6 条用例，守的是 headless 连接路径
（桌面卡片 `call` 事件、后台恢复）与它应答扩展后端交接的那半环。父判据是接缝
`O-SEAM-02`（后端交接）、`O-SEAM-01`（生命周期命令通道）、`O-SEAM-10`（编排分叉）、`O-SEAM-03`（状态与心跳）。

**口径说明（本文件通篇适用）**：这些用例不用桩件替身，而是把真实的
`entry/src/main/ets/services/VpnSessionController.ets` 与 `VpnStatusReader.ets` 读进来，
`stripTypeScriptTypes` 去类型后在 `node:vm` 沙箱里执行；平台边界被替换成桩——
`VpnCommandGateway`（文件命令协议）、`VpnStatusReader.read`、`ControlServerConfig.load`、
`DiagnosticEventStore.record`、`deviceInfo`、`setTimeout`（改为由用例手动放行的句柄）。
因此**决策逻辑是真的，平台边界是桩**：一条通过只说明「给定这组桩，决策正确」，
不证明真机上的文件协议、扩展存活、15 s 预算或系统拉起。凡结论依赖桩的地方在 `期望` 里写明。

### O-SESSION-01 已连接态下无 UI 连接判为 unchanged
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-08「无 UI 的入口（桌面卡片、后台恢复）也能独立完成连接」；架构 §五 O-CONN-07 行（无 UI 连接与 O-CONN-01 同一预算）、§七 SEAM-03 对照行
- 触发与前置条件：`VpnSessionController.connect(filesDir)` 被调用，`VpnStatusReader.read` 读到 state=connected
- 可观测点：connect 的返回值、`VpnCommandGateway.startVpnExtension` 的调用次数、后端 stop 次数、应答循环是否入队了 sleep 句柄
- 期望：正常：状态已是 connected 时立即返回 `VpnActionResult.UNCHANGED`；边界：不得调用 `startVpnExtension`，也不得启动交接应答轮询（sleep 队列为空）——「已经连上」不是一次新连接；失败与恢复：状态文件读不到或缺心跳时 `VpnStatusReader` 报 unknown 而不是 connected，由此走的是正常连接流程（O-SESSION-02）而不是这条早退
- 失败信息：期望「已连接时 connect 返回 unchanged 且不起扩展、不轮询」，实际「重复拉起扩展，或为空转的应答循环排入轮询」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:80 connect；:81-84 读状态并在 connected 时早退；:104 startVpnExtension；:108 answerBackendHandoff（未 await）；entry/src/main/ets/services/VpnStatusReader.ets:33-45 read 与 :43 新鲜度判定；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-08
- 测试：scripts/test-vpn-session-controller.mjs::a connect that is already up never starts or stops anything
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SESSION-02 无 UI 连接只拉起扩展一次并立即返回，交接在后台进行
- 层级：单点
- 父判据：O-SEAM-01、O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-08、R-CONN-01；架构 §五 O-CONN-07 行与责任空洞检查第 1 条（headless 是第二个应答方）；`VpnSessionController.ets:106-107` 明写「刻意不 await」
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
- 设计依据：需求 R-CONN-08；架构 §五 O-CONN-07 行、责任空洞检查第 1 条（250 ms × 60 与扩展 100 ms × 150 只是恰好相等）
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
- 设计依据：需求 R-CONN-03「连接窗口期内…应答扩展的后端交接请求」、R-CONN-08；架构 §五 责任空洞检查第 1 条（无人应答即扩展自毁）
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
- 设计依据：需求 R-CONN-03；架构 §五 O-CONN-07 行「应答但停不下来 ⇒ P1」、责任空洞检查第 1 条
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
- 设计依据：需求 R-CONN-08；`VpnSessionController.ets:156-160`（无法取得正整数 requestId 即拒）；架构 §五 责任空洞检查第 1 条
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
- 设计依据：需求 R-CONN-03；架构 §五 责任空洞检查第 1 条——「250 ms × 60 = 15 s 与扩展 100 ms × 150 = 15 s 只是恰好相等而无耦合，任何一侧单独调整都会静默失去应答」
- 触发与前置条件：headless 连接已拉起扩展，扩展开始它自己的 15 s 等待
- 可观测点：`BACKEND_HANDOFF_POLL_INTERVAL_MS × BACKEND_HANDOFF_MAX_ATTEMPTS` 与扩展侧等待常量的关系；把任一常量改小（例如 10 s）后应答仍不丢失
- 期望：正常：本侧的应答窗口不短于扩展的等待预算，使扩展不会在应答到达前销毁 VPN；边界：改小任一侧常量都应使这条判据失败，而不是静默失效；失败与恢复：若窗口短于预算，扩展记 `vpn_backend_handoff_timeout` 并销毁 VPN（`docs/background-vpn-reliability.md` Milestone 3 的第二次真实故障）；安全与质量：两个常量分处两进程、没有共享定义，判据要求以断言把关系钉死
- 失败信息：期望「本侧轮询窗口 ≥ 扩展等待预算，且该关系被一条用例守住」，实际「只靠注释声明两个 15 s『恰好相等』，任一侧改动后无人发现」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:27-30（注释与两个常量）；vpnextensionability/TailscaleVpnExtensionAbility.ets 的交接等待（100 ms × 150，见架构 §五责任空洞检查第 1 条与需求 R-CONN-03 行）；docs/architecture/architecture.md 第五节责任空洞检查第 1 条；scripts/test-vpn-session-controller.mjs（现有 6 条用例全部手动放行 sleep，未断言常量关系）
- 上游：R-CONN-03、R-CONN-08
- 待建测试：[单元] scripts/test-vpn-session-controller.mjs::交接应答窗口覆盖扩展十五秒等待（常量关系断言）
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-单元
- 复核：待复核
