# MeshArc 接缝判据 · 诊断与替换批准（O-SEAM-15、O-SEAM-16）

本文件覆盖「诊断：记录、脱敏与报告导出」与「VPN 替换批准通道」两条接缝。
前者是两个进程各写自己的文件、共用一个脱敏边界（架构 §七 SEAM-11 对照行）；
后者是设计上唯一「必须由人回答」的反向命令，本层已发现它的写方缺失（§六 Q-02）。
`期望` 只写数据/控制/责任怎么交出去，不写用户看到什么。

### O-SEAM-15 诊断：记录、脱敏与报告导出
- 层级：接缝
- 父判据：O-DIAG-01
- 强度：强
- 设计依据：架构 §2.5 横切策略（脱敏是所有落盘文本与 hilog 的必经边界）、§三 3.2(e)、§五 责任空洞检查第 5 条、§六 Q-06；架构 A-SEAMS、A-D2、A-D6
- 触发与前置条件：P1 与 P2 各自在关键链路（连接、握手、掉线、网络变化、扩展生命周期）写诊断事件；用户在诊断解锁后生成并分享报告
- 可观测点：`filesDir` 下 `diagnostic-ui-events.ndjson`（P1 写）与 `diagnostic-vpn-events.ndjson`（P2 写）；两文件的条数与字节上限；`cacheDir` 下的报告 zip 与系统分享面板；事件名拼写
- 期望：正常：两个进程各写自己的文件，共享同一个脱敏边界——任何可能离开本进程或落盘的文本（含 hilog）都必须先经 `DiagnosticPrivacy.redactForLog:47-55`（URL、bearer/basic、token/secret 键、查询串令牌一律替换），错误只保留一个稳定类别 + 数字码：`classifyError` 只输出 `category`/`code`/`retryable`，原生错误文本从不被保留；单文件上限 `MAX_EVENTS_PER_FILE`=100 事件与 `MAX_EVENT_FILE_BYTES`=24 KB，超出淘汰最旧（`DiagnosticEventStore.ets:112-116`）。边界：读取方（P1）把两份文件合并呈现，合并时按事件自带的时间戳排序；报告生成中途失败或只写了部分内容时不分享半成品 zip，并删除残留。失败与恢复：报告在 `cacheDir` 生成，保留 `REPORT_RETENTION_MS`=24 h 后由 `cleanupExpiredReports` 过期清理（只清 `REPORT_PREFIX` + `.zip`），经 `systemShare.ShareController` 分享。安全与质量：脱敏**不可绕过**——两进程共用 `DiagnosticPrivacy` 而不是各写一份，接缝要求任何新增落盘点都必须经过这个边界；网络变化的地址数据不进入事件（R-NET-04）。已知局限：事件名是自由字符串，没有受控词表，也没有跨进程的事件名登记表（未决 Q-06），同一语义可能有两种拼写；这条接缝**没有端到端验证**（只有单元覆盖），架构 §五 责任空洞检查第 5 条已记录。
- 失败信息：期望「两进程各写自己的文件、共用同一脱敏边界、超限淘汰最旧、报告过期清理」，实际「报告或日志里出现 token 或认证 URL，或两进程各自脱敏导致口径不一，或半成品 zip 被分享、过期报告不清理」
- 来源：entry/src/main/ets/services/DiagnosticEventStore.ets:4-6 两个进程的文件名；:112-116 超限淘汰最旧；entry/src/main/ets/services/DiagnosticPrivacy.ets:12-13 条数与字节上限；:17-20 classifyError 只留类别与数字码；:47-55 redactForLog；entry/src/main/ets/services/DiagnosticReportService.ets:10 REPORT_RETENTION_MS=24 h；:216-251 zip 落 cacheDir 且不分享半成品；:257-266 systemShare 分享；:646-654 cleanupExpiredReports；docs/architecture/architecture.md 第五节责任空洞检查第 5 条、第六节 Q-06
- 上游：R-DIAG-02、R-DIAG-03、R-DIAG-04
- 测试：scripts/integration/diagnostic-redaction.mjs::两进程落盘文本共用脱敏边界且超限淘汰最旧
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-SEAM-16 VPN 冲突：扩展存活并把冲突交给应用
- 层级：接缝
- 父判据：O-CONN-05
- 强度：强
- 设计依据：需求 R-CONN-07「给出可理解的冲突提示，经用户批准才替换」；架构 §2.2 依赖方向规则第 2 条、§四 D4（P2 无法显示界面）、§六 Q-02、§七 SEAM-06 对照；架构 A-SEAMS、A-D2
- 触发与前置条件：P2 的扩展建 TUN 撞到 `VPN_EXISTS_ERROR_CODE`(2203002)，即有另一个 VPN 占着通道
- 可观测点：`vpn-probe-status.txt` 的 `FAILED | VPN conflict | code=2203002`；扩展的冲突心跳（每 `VPN_CONFLICT_HEARTBEAT_MS` 200 ms 重发一次）；诊断事件 `vpn_conflict`（P2），以及 `vpn_conflict_detected` / `vpn_conflict_acknowledged` / `vpn_conflict_self_disconnect_requested` / `vpn_conflict_self_disconnect_completed`（P1）；冲突对话框 `BridgeStatus.showVpnConflictDialog`
- 期望：正常：扩展在冲突时不销毁任何东西，只把冲突状态反复写进状态文件并保持存活，让应用进程读得到；应用读到后**停掉自己的扩展**（清掉半建的 VPN），弹出对话框告诉用户去系统设置里断开另一个 VPN，用户确认后应用清理并恢复后端，责任落在用户侧。边界：冲突循环没有自己的超时，它只在应用停掉扩展（`destroying`）时结束——这正是应用能把冲突讲清楚的前提，所以循环不能提前返回。失败与恢复：用户不断开另一个 VPN 就连不上，应用停在冲突提示上；扩展记 `vpn_conflict`，应用负责把它翻成人能读的文案。安全与质量：不得静默销毁另一个 VPN。**2026-10-13 按 Q-02 删除**：扩展原先还有一条「等 `vpn-replace-approved` 文件、10 秒内有效就销毁对方 VPN 再重建」的分支，而全仓**没有这个文件的写方**；对话框文案（`app.string.vpn_conflict_message`「请断开其它 VPN」与 `vpn_conflict_confirm_action`「确定」）说明产品的选择是让用户自行处理，所以那条分支不可能有写方。它已连同常量、路径构造函数与 `consumeVpnReplaceApproval` 一并删除。这条保证现在由 `scripts/test-vpn-conflict-contract.mjs` 的结构断言守住：源码里不得再出现批准文件或替换分支，冲突循环必须仍然发布状态，应用的冲突文案必须仍是「请断开其它 VPN」。
- 失败信息：期望「冲突时扩展不销毁任何 VPN 并保持可被读到，应用把决定交回用户」，实际「未经用户知情就销毁另一个 VPN，或扩展提前退出使应用读不到冲突原因」
- 来源：entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:22-27 VPN_EXISTS_ERROR_CODE 与 VPN_CONFLICT_HEARTBEAT_MS；:578-610 冲突分支与等待循环；entry/src/main/ets/components/BridgeStatus.ets:4325 showVpnConflictDialog 起的自停与提示；entry/src/main/resources/base/element/string.json 的 vpn_conflict_message；scripts/test-vpn-conflict-contract.mjs
- 上游：R-CONN-07
- 测试：scripts/test-vpn-conflict-contract.mjs::the extension has no approval file and no replacement branch
- 测试：scripts/test-vpn-conflict-contract.mjs::the extension republishes the conflict while it waits for the app
- 测试：scripts/test-vpn-conflict-contract.mjs::the app tells the user to disconnect the other VPN
- 待建测试：[真机] 真机走查 a01-baseline/device-runbook.md#M-17（冲突提示与用户自行断开的完整路径）
- 状态：pending-test
- 不确定特征：NOT-EVALUATED
- 归属：owner=项目维护者 接收批次=真机批次（device-runbook.md 的 M-17）
- 复核：待复核
