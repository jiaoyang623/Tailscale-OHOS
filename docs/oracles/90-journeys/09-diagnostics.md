# MeshArc 旅程判据 · 诊断区（解锁诊断 / 导出脱敏报告）

本文件覆盖「诊断」区的一条旅程：解锁工程诊断并导出脱敏报告。

### O-DIAG-01 解锁诊断并导出脱敏报告
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-DIAG-01「诊断入口默认隐藏，需在关于页连点版本号 5 次才出现」、R-DIAG-02「落盘诊断必须脱敏：URL、bearer/basic、token/secret 键、查询串令牌一律替换」、R-DIAG-03「诊断事件有按文件条数与字节的上限，超出淘汰最旧」、R-DIAG-04「诊断报告可导出并分享，报告有保留期，过期清理」、R-DIAG-05「关键链路（连接、握手、掉线、网络变化、扩展生命周期）留下可复核的事件」、R-NET-04「网络变化的地址数据不得写入日志或诊断」
- 触发与前置条件：应用正常运行，用户在设置 > 关于页连续点击版本号，相邻点击间隔不超过 1.5 s
- 可观测点：连点剩余次数提示与解锁提示、关于页在解锁后出现的诊断折叠区、诊断报告 zip 与系统分享面板、`diagnostic-ui-events.ndjson` 与 `diagnostic-vpn-events.ndjson`
- 期望：正常：连点 5 次且间隔 ≤ 1500 ms 后解锁，诊断折叠区出现在关于页；生成诊断报告得到缓存目录下的 zip 并可经系统分享导出；连接、握手、掉线、网络变化、扩展生命周期留下可复核事件。边界：间隔超过 1500 ms 计数清零并提示剩余次数；已解锁时再次点击只提示已解锁；生命周期重置时解锁标志清回 false，需重新连点。失败与恢复：报告生成中途失败或只写了部分内容时不分享半成品 zip，并删除残留；落盘前经脱敏替换 URL、bearer/basic、token/secret 键与查询串令牌；单个诊断文件上限 100 条且 24 KB，超出淘汰最旧；报告保留 24 h 后清理。安全与质量：诊断事件与报告不得含认证 URL、令牌、账号、tailnet 地址或设备标识；网络变化只留接口与网络身份相关事件，不落地址数据。
- 失败信息：期望「诊断默认隐藏，且导出的报告已脱敏」，实际「诊断入口默认可见，或报告中出现 token 或认证 URL」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:4939 onAppVersionTap；:4925 unlockDiagnostics；:14162 解锁后才渲染；:4227 generateDiagnosticReport；:12280 DiagnosticsReportPanel；:12359 DiagnosticsDisclosure；entry/src/main/ets/services/DiagnosticEventStore.ets:4-6 事件文件名；:111-120 超限淘汰最旧；entry/src/main/ets/services/DiagnosticPrivacy.ets:13-14 条数与字节上限；:47-55 redactForLog；entry/src/main/ets/services/DiagnosticReportService.ets:10 保留期 24 h；:213 createReport；:219-235 zip 落 cacheDir；:257 share；:646 cleanupExpiredReports
- 上游：R-DIAG-01、R-DIAG-02、R-DIAG-03、R-DIAG-04、R-DIAG-05、R-NET-04
- 待建测试：[E2E] scripts/e2e/diagnostics-report.mjs::解锁诊断并导出脱敏报告
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-DIAG-02 非用户原因的断连留下可导出的原因记录
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-12「非用户原因的断连都要落盘留证」、R-DIAG-05「关键链路（连接、握手、掉线、网络变化、扩展生命周期）留下可复核的事件」、R-DIAG-02「落盘诊断必须脱敏」；架构 §2.6、§五 O-CONN-08；HLD 契约 C-19
- 触发与前置条件：一次已连接会话以非用户原因结束——扩展 onDestroy、扩展崩溃、后端交接超时、系统策略停止或网络失效。用户未点击停止。
- 可观测点：会话账本（按写者分文件）的 `reason`、`writer`、`kind`、`timestampMs`；诊断报告中的同一记录；`vpn_session_end`、`vpn_session_end_observed`、`vpn_session_recovered` 事件
- 期望：正常：每次非用户结束写一条 `end` 记录，原因在受控词表内。P1 随后补写 `observed` 并进入恢复。恢复稳定 60 s 写 `vpn_session_recovered`。边界：同一 `sessionId` 的同一类记录只出现一次。用户主动停止写 `user_stop`，不进入恢复。失败与恢复：账本写失败不阻止进程退出，记 hilog。文件最后一行不完整时下一次写入前截断。安全与质量：记录只含时间戳、写方、类型、原因、阶段与数值码，不含地址、账号、令牌或设备标识。判定在宿主侧桩边界与真机走查下成立
- 失败信息：期望「每次非用户断连都能在设备上查到原因」，实际「断开后没有记录，无法区分用户停止、扩展崩溃与系统停止」
- 来源：entry/src/main/ets/services/SessionLedger.ets；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets 的 onDestroy；entry/src/main/ets/services/DiagnosticReportService.ets
- 上游：R-CONN-12、R-DIAG-05
- 测试：scripts/test-session-ledger.mjs::the ledger never stores addresses or identity fields
- 待接线测试：[E2E] scripts/e2e/endurance-recovery.mjs::扩展被杀后自动恢复并留下原因记录（设备未连接，待执行）
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=vpn-endurance（设备未连接，E2E 待执行）
- 复核：待复核
