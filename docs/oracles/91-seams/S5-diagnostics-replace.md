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
- 待建测试：[集成] scripts/integration/diagnostic-redaction.mjs::两进程落盘文本共用脱敏边界且超限淘汰最旧
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核

### O-SEAM-16 VPN 替换批准通道
- 层级：接缝
- 父判据：O-CONN-05
- 强度：强
- 设计依据：架构 §2.2 依赖方向规则第 2 条、§四 D4（P2 无法显示界面，每个需用户决定的动作都必须反向请求一个文件命令）、§六 Q-02、§七 SEAM-06 → O-SEAM-16；架构 A-SEAMS、A-D2
- 触发与前置条件：P2 的扩展建 TUN 撞到 `VPN_EXISTS_ERROR_CODE`(2203002) 时，需要一个来自 P1（人）的批准来决定是否销毁既有 VPN 并重建
- 可观测点：`filesDir/vpn-replace-approved` 标记的存在与年龄；扩展侧的批准轮询与替换结果；`vpn_conflict` / `vpn_conflict_detected` / `vpn_conflict_acknowledged` 等诊断事件；冲突对话框 `showVpnConflictDialog:4316`；`vpn-probe-status.txt` 的 `FAILED | VPN conflict | code=2203002`
- 期望：正常（设计意图）：替换必须是「扩展请求—应用应答」的反向文件命令——P2 在 `createTunWithConflictReplacement` 里先读 `filesDir/vpn-replace-approved`，只有标记存在且年龄在 `[0, VPN_REPLACE_APPROVAL_TTL_MS(10000)]` 内才 `consumeVpnReplaceApproval:732` 通过并调 `replaceExistingVpn:610` 销毁既有 VPN 重建；否则每 `VPN_REPLACE_APPROVAL_POLL_INTERVAL_MS`(200 ms) 轮询等待批准，批准标记由 P1 在用户确认后写出。**实际（本基线）**：仓库内**找不到写这个标记的入口**（全仓只有扩展侧 `:27` 常量与 `:729` 路径构造两个引用，没有任何写入调用），因此批准的写方缺失、approved-replace 路径**不可达**；真正在跑的是 UI 冲突对话框：`BridgeStatus.showVpnConflictDialog:4316` 先停掉本应用自己的扩展以清掉半建 VPN，再提示用户「请先断开其它 VPN」，用户点确定后清理并恢复后端——责任落在用户侧，而不是应用侧的批准通道。边界：批准标记 TTL 只有 10 s，若对话框出现时用户正好切走，标记是否仍有效、扩展是否重问**未验证**（未决 Q-02）。失败与恢复：用户不批准即无法连接，扩展按冲突状态收尾；P2 记 `vpn_conflict`，P1 负责把它翻成人能读的提示。安全与质量：不得在用户批准前静默替换或销毁另一个 VPN——当前没有静默风险，因为批准通道断了；但判据要求任何将来接上写方的实现都必须先有用户批准、且 TTL 语义明确（批准过期即视为未批准并重新征求），不得以「标记存在即替换」的宽松读法绕过用户。
- 失败信息：期望「替换只在用户批准（10 s 内有效）后发生，未批准即给出可理解的冲突提示且不销毁其它 VPN」，实际「本基线批准的写方缺失使替换路径不可达（只能走提示用户先断开其它 VPN），或将来接上写方后未经批准即销毁其它 VPN」
- 来源：entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:24 轮询间隔；:27-28 标记文件名与 10 s TTL；:598-601 尝试消费并轮询等待；:610 replaceExistingVpn；:729-741 consumeVpnReplaceApproval 与年龄判定；entry/src/main/ets/components/BridgeStatus.ets:4316 showVpnConflictDialog；docs/architecture/architecture.md 第二节依赖方向规则第 2 条与第六节 Q-02
- 上游：R-CONN-07
- 待建测试：[集成] scripts/integration/vpn-replace-approval.mjs::无批准标记时不替换且无静默销毁
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核
