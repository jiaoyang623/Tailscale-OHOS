# MeshArc 单点判据 · 连接保活与状态读取（P1）

覆盖 test-vpn-background-task.mjs（18 条）与 test-vpn-status-reader.mjs（13 条）。两条链同属 P1 进程侧：一条决定「连接期间要不要替无人应答的扩展活着」，另一条决定「状态文件到底读成了什么」。后者被卡片、FormExtensionAbility 与应用共用，措辞漂移会让卡片与应用对同一条隧道各说各话。

### O-BGTASK-01 前台连接即持有 dataTransfer 长时任务并用实况窗更新真实流量
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-04「已连接时切到其它应用、锁屏静置，隧道不中断」；架构 §3.2 运行视图「VpnBackgroundTaskManager —— 持有 dataTransfer 长时任务」、D6 三档发布节奏；HLD 契约 C-11
- 触发与前置条件：前台运行，status 文件新鲜且含 state=Running|tun=true，reconcile 首次判为 connected
- 可观测点：backgroundTaskManager.startBackgroundRunning 的模式参数与返回的 notificationId；notificationManager.publish 的请求体（id、slotType、systemLiveView.text、template.data.progressValue）；onBackground 后的 stopBackgroundRunning 次数
- 期望：正常：以 ['dataTransfer'] 取得任务，实况窗沿用系统分配的 notificationId，正文显示真实 ↑/↓ 字节，进度恒为 0（隧道没有完成度）；边界：同一任务在 NOTIFICATION_UPDATE_INTERVAL_MS=30000 内不重复 publish，满 30 s 才刷新一次且 id 不变；切到后台不释放、不重复启动；失败与恢复：—；安全与质量：不伪造完成百分比或流量数字。该判定在宿主侧桩边界（backgroundTaskManager、notificationManager 为桩）下成立，通过只说明决策逻辑正确，不等于真机真的授予了长时任务
- 失败信息：期望「前台连接即持有 dataTransfer 任务并以同一 id 更新实况窗」，实际「未持有任务、每次刷新换 id，或进度被写成非零」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:224 start；:309 updateNotification；:382 formatBytes；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-background-task.mjs::acquires protection in foreground and updates the same system live view with real traffic
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-02 状态陈旧或读取失败时把已持有的任务保留到有界宽限期
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-09「长时任务在状态缺失/陈旧时按不确定处理，有界宽限后释放」；架构 §2.5 错误处理「失败即降级为可读状态」；HLD 契约 C-03
- 触发与前置条件：已持有任务，status 心跳龄超过 VPN_STATUS_FRESH_MS=15000，或 fileIo.readTextSync 抛临时 I/O
- 可观测点：stopBackgroundRunning 调用次数；background_status_timeout 诊断事件；任务重新取得后的 starts 计数
- 期望：正常：新鲜且 connected 时持续持有不释放；边界：心跳龄 16 s 或读取抛错时仍保留（自 lastLiveAtMs 起算，VPN_STATUS_GRACE_MS=60000 内），超过宽限才 stop 一次并记 background_status_timeout；失败与恢复：读取恢复且重新 live 后再次取得任务（starts 由 1 变 2）；安全与质量：单次 I/O 抖动不得立刻撤销保护。判定在桩边界（fileIo、Date.now 为桩）下成立
- 失败信息：期望「陈旧心跳与读失败按不确定保留到 60 s 宽限」，实际「一读不到就释放任务，或永久持有不释放」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:171 reconcile 的宽限分支；:344 readStatus；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-background-task.mjs::stale heartbeat and read errors retain acquired protection for a bounded grace period
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-03 不以陈旧、未来、缺失的心跳或缺 TUN 的证据启动任务
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-09「状态缺失/陈旧时按不确定处理」；架构 D5 保留的 M1 门槛；HLD 契约 C-03
- 触发与前置条件：register 或 reconcile 时，status 缺 heartbeatMs、heartbeatMs=1、heartbeatMs=2000000（未来），或含 tun=false
- 可观测点：startBackgroundRunning 调用次数（starts 长度）
- 期望：正常：仅当心跳新鲜且 state=Running|tun=true 才启动；边界：以上四种证据不足的状态一律不启动，也不因「看不懂」而启动；失败与恢复：状态转为 live 后由下一次 reconcile 补上启动；安全与质量：无证据不得占用长时任务。判定在桩边界（fileIo、Date.now 为桩）下成立
- 失败信息：期望「证据不足不启动」，实际「按残缺状态或旧心跳抢占了长时任务」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:344 readStatus；:182 reconcile 启动条件；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-background-task.mjs::never starts from stale, future, missing heartbeat or missing TUN evidence
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-04 读到显式断开即刻释放长时任务
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-02「从首页一键断开：停止扩展、释放长时任务、回到未连接态」；HLD 契约 C-11
- 触发与前置条件：status 含 extension destroyed / vpn disconnected / state=stopped / 非 status unavailable 的 FAILED
- 可观测点：stopBackgroundRunning 调用次数；task 是否被置为 undefined
- 期望：正常：读到断开标记即 stop 一次并把 task 置空；边界：连接窗口期内读到断开同样立即释放；失败与恢复：—；安全与质量：断开即释放，不空转占着任务。判定在桩边界下成立
- 失败信息：期望「显式断开即刻释放」，实际「断开后仍持有任务，等待下一次超时」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:163 reconcile 的 disconnected 分支；:292 stop；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-02
- 测试：scripts/test-vpn-background-task.mjs::explicit disconnect promptly releases the task
- 测试：scripts/test-vpn-background-task.mjs::an explicit disconnect during the connect window releases promptly
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-05 快照读取失败按不确定处理，不立即撤销保护
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-09「状态缺失/陈旧时按不确定处理」；架构 §2.5 错误处理「不把可选服务失败宣称为隧道失败」；HLD 契约 C-03
- 触发与前置条件：status 为 `FAILED | VPN backend | status unavailable | heartbeatMs=…`
- 可观测点：stopBackgroundRunning 调用次数
- 期望：正常：—；边界：FAILED 但含 status unavailable 时不判 disconnected，已持有的任务不被立即释放；失败与恢复：真正断开的失败标记（如 VPN conflict）才释放；安全与质量：不把「读不到状态」当成隧道已停。判定在桩边界下成立
- 失败信息：期望「status unavailable 按不确定保留保护」，实际「一看到 FAILED 就撤销长时任务」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:354 readStatus 的 failed 例外；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-background-task.mjs::snapshot failure is uncertain and does not immediately revoke protection
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-06 用户取消保活后在同一会话内保持抑制，直到确认断开
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-10「用户主动取消保活通知后，不得在同一会话内自行恢复」；架构 §2.5 重试「重试必须能被用户意图打断」；HLD 契约 C-11
- 触发与前置条件：continuousTaskCancel 的 reason 为 USER_CANCEL(1) 或 USER_CANCEL_REMOVE_NOTIFICATION(3)
- 可观测点：suppressedUntilDisconnect 的效果（starts 计数）；background_user_cancelled 诊断事件
- 期望：正常：置抑制位，之后不再自动启动；边界：陈旧 telemetry（90 s 无心跳）与回到前台（onForeground 清 nextStartAtMs）都不解除抑制，starts 仍为 1；失败与恢复：只有读到确认断开、再转 live 后才恢复启动（starts 变 2）；安全与质量：绝不替用户撤销他自己按下的取消。判定在桩边界（backgroundTaskManager 的取消回调为桩）下成立
- 失败信息：期望「用户取消在同会话内始终被尊重」，实际「回前台或状态一变就自行恢复保活」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:57 cancelCallback；:182 启动条件里的抑制位；:144 onForeground；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-10
- 测试：scripts/test-vpn-background-task.mjs::user cancellation stays suppressed across stale telemetry and foreground until confirmed disconnect
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-07 系统取消后按指数退避重试启动
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-04「已连接时切到其它应用、锁屏静置，隧道不中断」；架构 §2.5 重试「VpnBackgroundTaskManager 系统取消后回退」；HLD 契约 C-11
- 触发与前置条件：continuousTaskCancel 的 reason 非用户取消（系统取消）
- 可观测点：startBackgroundRunning 调用次数随时间的变化；background_system_cancelled 诊断事件
- 期望：正常：scheduleRetry 按 START_RETRY_BASE_MS=30000×2^n（上限 START_RETRY_MAX_MS=300000）设下次启动时刻；边界：29999 ms 时不重试、满 30000 ms 才重试；再次系统取消后间隔翻倍（第二次 30 s 内不重试、满 30 s 才重试）；失败与恢复：—；安全与质量：失败不得退化成每秒重试。判定在桩边界（Date.now、backgroundTaskManager 为桩）下成立
- 失败信息：期望「系统取消按 30/60/120 s 退避重试」，实际「立刻重试或永不重试」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:70 cancelCallback 的系统分支；:392 scheduleRetry；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-background-task.mjs::system cancellation retries with exponential backoff
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-08 非本任务的取消事件被忽略
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-04「锁屏静置，隧道不中断」；架构 §2.5 异步陈旧「迟到结果不得覆盖新结果」；HLD 契约 C-11
- 触发与前置条件：continuousTaskCancel 的 info.id 不等于当前 task.continuousTaskId（例如 99 对 7）
- 可观测点：当前任务的 continuousTaskId 是否仍为原值
- 期望：正常：当前任务被保留；边界：不置抑制、不重试、不释放；失败与恢复：—；安全与质量：别的任务被取消不得误伤本任务。判定在桩边界下成立
- 失败信息：期望「按 id 匹配后才处理取消」，实际「任意取消事件都丢掉当前任务」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:59 cancelCallback 的 id 守卫；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-background-task.mjs::unrelated cancellation does not discard the VPN task
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-09 启动失败被节流，不按每次巡检重试
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-04「锁屏静置，隧道不中断」；架构 §2.5 重试「重试必须能被用户意图打断」；HLD 契约 C-11
- 触发与前置条件：startBackgroundRunning 抛 { code: 9800005 }
- 可观测点：startBackgroundRunning 调用次数随每秒巡检的增长
- 期望：正常：—；边界：失败后连续 20 s（每秒一次 reconcile）只尝试 1 次，starts 仍为 1；失败与恢复：退避期满（再 10 s，累计 30 s）后重试一次，starts 变 2；安全与质量：启动失败不得变成每秒一次的重试风暴。判定在桩边界下成立
- 失败信息：期望「失败后按 30 s 基数节流」，实际「每次巡检都重试」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:188 reconcile 的 catch；:392 scheduleRetry；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-background-task.mjs::a failed start is throttled instead of retried every second
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-10 启动期间收到的取消、断开或销毁不被迟到的启动结果覆盖
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-10「不得在同一会话内自行恢复」；架构 §2.5 异步陈旧「迟到结果不得覆盖新结果」；HLD 契约 C-11
- 触发与前置条件：startBackgroundRunning 尚未 resolve 时，收到 USER_CANCEL、读到断开、或调用 unregister
- 可观测点：task 是否被置空；stopBackgroundRunning 次数；publish 次数；监听回调表是否被清空
- 期望：正常：无中断的启动成功才落 task 并发通知；边界：三种中断下迟到的成功结果都必须被清理——取消后 task 为 undefined 且不 publish，断开后 stop 一次且不 publish，销毁后 stop 一次并清空回调（callbacks.size 为 0）；失败与恢复：—；安全与质量：用 cancellationRevision 与 lifecycleGeneration 双重守卫，迟到的成功不得复活已被取消或销毁的任务。判定在桩边界（startBackgroundRunning 用 deferred 门控）下成立
- 失败信息：期望「迟到结果按取消代数/世代被丢弃并清理」，实际「取消或销毁后任务又被迟到结果装上」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:206 start 的 revision 快照；:226 迟到结果守卫；:230 走后校验；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-10
- 测试：scripts/test-vpn-background-task.mjs::cancellation received during start cannot be overwritten by its late result
- 测试：scripts/test-vpn-background-task.mjs::disconnect during start cleans up the late successful task without publishing
- 测试：scripts/test-vpn-background-task.mjs::destroy during start cleans up the late successful task
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-11 通知发布在途时销毁，清理排在发布之后
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-02「释放长时任务」；架构 §2.5 异步陈旧「迟到结果不得覆盖新结果」；HLD 契约 C-11
- 触发与前置条件：updateNotification 的 publish 尚未 resolve 时调用 unregister
- 可观测点：stopBackgroundRunning 次数相对 publish 完成时刻的顺序
- 期望：正常：—；边界：销毁发生在发布在途时，发布未返回前不释放（stop 次数仍为 0），发布返回后清理一次（stop 次数变 1）；失败与恢复：—；安全与质量：不并发 stop 与 publish，避免出现「通知已撤而任务仍在」的中间态。判定在桩边界（publish 用 deferred 门控）下成立
- 失败信息：期望「清理排在发布之后串行完成」，实际「发布未回就释放，留下不一致的通知与任务」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:185 reconcile 的世代守卫；:191 finally 的收尾 stop；:315 updateNotification；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-02
- 测试：scripts/test-vpn-background-task.mjs::destroy during notification update serializes cleanup after publish
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-12 重新连接等待进行中的停止完成后再启动下一任务
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-04「锁屏静置，隧道不中断」；架构 §2.5 异步陈旧守卫；HLD 契约 C-11
- 触发与前置条件：stop 在途（stopBackgroundRunning 未返回）时读到 live 状态
- 可观测点：stop 未返回期间的 starts 计数；stop 完成后的 starts 计数
- 期望：正常：—；边界：停止在途期间新的 reconcile 不启动第二个任务（starts 仍为 1）；失败与恢复：stop 完成后下一次 reconcile 才启动（starts 变 2）；安全与质量：operationInFlight 与 stopping 守卫阻止并发启停造成的任务泄漏。判定在桩边界（stopBackgroundRunning 用 deferred 门控）下成立
- 失败信息：期望「先停稳再启」，实际「停止未完成就叠加新任务」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:152 reconcile 的 operationInFlight；:292 stop；:49 stopping 标志；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-background-task.mjs::reconnect waits for in-flight stop before starting the next task
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-13 连接窗口按 live 处理并提前持有任务
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-03「连接窗口期内应用进程必须持有长时任务，使切到后台后仍能应答扩展的后端交接请求」；架构 D5（§四）选择方案 (b)；HLD 契约 C-03
- 触发与前置条件：status 含 vpn interface established 且心跳新鲜（扩展已建 TUN、backend handoff pending）
- 可观测点：startBackgroundRunning 次数与模式；进入 connected 后是否出现第二个任务；切后台后的 stop 次数
- 期望：正常：把该状态解析为 connecting，与 connected 同级，立即以 dataTransfer 取得任务；边界：随后转为 state=Running 不产生第二个任务（connecting 平滑滚入 connected），切后台不释放；失败与恢复：—；安全与质量：这是 D5 特意放宽的门槛，用来消除「用到一半自己断了」的成因。判定在桩边界下成立，M3 的真机场景尚未重跑
- 失败信息：期望「连接窗口即持有任务」，实际「只在 state=Running 后才持有，交接窗口内进程被冻结」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:362 readStatus 的 connecting 分支；:171 reconcile 的 live 判定；:200 isLiveState；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-03
- 测试：scripts/test-vpn-background-task.mjs::holds protection through the connect window so the handoff can be answered
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-14 连接窗口需要接口建立的证据，不接受任意无法识别的状态
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-03「连接窗口期内必须持有长时任务」；架构 D5 保留的 M1 门槛「无法识别的状态仍然不持有任务」；HLD 契约 C-03
- 触发与前置条件：status 为 `VPN extension lifecycle entered`、`VPN probe TUN creation pending`，或 `state=Running | tun=false`
- 可观测点：startBackgroundRunning 次数
- 期望：正常：只有含 vpn interface established 的证据才判 connecting；边界：以上三种无法识别或缺 TUN 的状态一律不启动任务（starts 为 0）；失败与恢复：—；安全与质量：不得凭「看不懂」就持有长时任务。判定在桩边界下成立
- 失败信息：期望「只认接口建立的证据」，实际「任何陌生文案都被当成连接中并占住任务」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:362 readStatus 的 connecting 判据；:350 新鲜度守卫；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-03
- 测试：scripts/test-vpn-background-task.mjs::the connect window needs interface evidence, not just an unrecognised status
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-BGTASK-15 停滞的连接窗口超过宽限期仍释放保护
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-09「状态缺失/陈旧时按不确定处理，有界宽限后释放」；架构 D5「connecting 与 connected 等重，但要有界」；HLD 契约 C-03
- 触发与前置条件：进入 connecting 后扩展停止写心跳（status 不再更新）
- 可观测点：stopBackgroundRunning 次数随时间的变化
- 期望：正常：—；边界：心跳龄刚过 FRESH（20 s）时仍持有（stop 次数为 0）；失败与恢复：继续停滞到超过 GRACE（再 50 s，累计超过 60 s）释放一次（stop 次数为 1）；安全与质量：停滞的连接窗口不得永久占住长时任务。判定在桩边界下成立
- 失败信息：期望「停滞窗口按 60 s 宽限释放」，实际「一直持有，或一过 15 s 就释放」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:171 宽限分支；:175 VPN_STATUS_GRACE_MS 判据；scripts/test-vpn-background-task.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-background-task.mjs::a stalled connect window still releases protection
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-01 状态文件缺失或不可读时报告 unknown
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-09「状态缺失在读取侧按不确定处理」；架构 §2.5 错误处理「失败即降级为可读状态」；HLD 契约 C-03
- 触发与前置条件：VpnStatusReader.read 时 fileIo.accessSync 返回 false，或 readTextSync 抛错
- 可观测点：返回快照的 state
- 期望：正常：—；边界：文件不存在、原子替换或临时 I/O 失败，一律返回 unknown 而不是 disconnected；失败与恢复：文件重新可读且新鲜时再按后续各条判定；安全与质量：缺证据不等于断开，否则卡片会误报掉线。判定在桩边界（fileIo 为桩）下成立
- 失败信息：期望「缺文件或读失败报 unknown」，实际「报 disconnected，让卡片显示掉线」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:33 read；:37 accessSync 守卫；:63 catch；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-status-reader.mjs::a missing status file is unknown, not disconnected
- 测试：scripts/test-vpn-status-reader.mjs::an unreadable status file is unknown
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-02 运行且有 TUN 时报 connected 并带真实流量
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-04「锁屏静置，隧道不中断」；架构 §3.1 P3 卡片经 VpnStatusReader 只读；HLD 契约 C-03
- 触发与前置条件：status 含 state=Running 且 tun=true，心跳新鲜
- 可观测点：快照的 state、txBytes、rxBytes
- 期望：正常：state 为 connected，txBytes/rxBytes 按字段解析出真实值；边界：—；失败与恢复：—；安全与质量：—。判定在桩边界（fileIo、Date.now 为桩）下成立
- 失败信息：期望「Running 且 tun=true 报 connected 并带字节数」，实际「报 unknown 或字节数恒为 0」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:49 read 的 connected 分支；:77 field；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-status-reader.mjs::a running tunnel reports connected with real traffic
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-03 心跳新鲜度的三条边界都判 unknown
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-09「状态陈旧时按不确定处理」；架构 §2.5 不确定语义；HLD 契约 C-03
- 触发与前置条件：heartbeatMs 缺失或 ≤0、ageMs<0（心跳在未来）、或 ageMs>VPN_STATUS_FRESH_MS=15000
- 可观测点：返回快照的 state
- 期望：正常：—；边界：三者一律返回 unknown，即便同一行还写着 state=Running|tun=true——过期（heartbeatMs=900000）、未来（heartbeatMs 比 now 大 1）、无值（缺 heartbeatMs）都不例外；失败与恢复：—；安全与质量：陈旧心跳不得当作健康，否则卡片会显示早已冻结的隧道为已连接。判定在桩边界（fileIo、Date.now 为桩）下成立
- 失败信息：期望「过期、未来、缺值一律 unknown」，实际「拿旧心跳或坏字段当成 connected」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:41 read；:43 新鲜度守卫；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-status-reader.mjs::a heartbeat older than the freshness window is unknown, not healthy
- 测试：scripts/test-vpn-status-reader.mjs::a heartbeat from the future is unknown
- 测试：scripts/test-vpn-status-reader.mjs::a heartbeat without a value is unknown
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-04 终态标记报 disconnected
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-02「停止扩展、回到未连接态」；架构 §2.5 错误处理；HLD 契约 C-03
- 触发与前置条件：status 含 extension destroyed、vpn disconnected、state=stopped / stopped 开头，或非 status unavailable 的 FAILED 行
- 可观测点：返回快照的 state
- 期望：正常：—；边界：扩展拆除、显式停止、失败扩展（如 VPN conflict）三类都报 disconnected；失败与恢复：—；安全与质量：—。判定在桩边界下成立
- 失败信息：期望「终态标记报 disconnected」，实际「把它压成 unknown，卡片迟迟不显示已断开」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:56 read；:69 isDisconnected；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-02
- 测试：scripts/test-vpn-status-reader.mjs::extension teardown reports disconnected
- 测试：scripts/test-vpn-status-reader.mjs::an explicit stop reports disconnected
- 测试：scripts/test-vpn-status-reader.mjs::a failed extension reports disconnected
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-05 快照读取失败不当作已停止的隧道
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-09「状态缺失按不确定处理」；架构 §2.5 错误处理「不把可选服务失败宣称为隧道失败」；HLD 契约 C-03
- 触发与前置条件：status 为 `FAILED | VPN backend | status unavailable | heartbeatMs=…`
- 可观测点：返回快照的 state
- 期望：正常：—；边界：FAILED 但含 status unavailable 时报 unknown，不报 disconnected；失败与恢复：真正的失败（如 VPN conflict，不带该短语）才报 disconnected；安全与质量：不把「读不到状态」当成隧道已停，避免卡片与应用的判断分叉。判定在桩边界下成立
- 失败信息：期望「status unavailable 报 unknown」，实际「报 disconnected，误报隧道已停」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:69 isDisconnected 的 status unavailable 例外；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-status-reader.mjs::a failed snapshot read is not treated as a stopped tunnel
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-06 待登录报 needs_login
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-SETUP-06「经系统浏览器登录 Tailscale」；架构 §3.1 卡片与扩展共用同一状态词表；HLD 契约 C-03
- 触发与前置条件：status 含 needslogin 或 loginurlready=true，心跳新鲜
- 可观测点：返回快照的 state
- 期望：正常：state 为 needs_login；边界：—；失败与恢复：—；安全与质量：登录态是独立词表，不得混入 connected/disconnected。判定在桩边界下成立
- 失败信息：期望「待登录报 needs_login」，实际「报 unknown 或 disconnected，卡片无法提示去登录」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:59 read 的 needs_login 分支；scripts/test-vpn-status-reader.mjs
- 上游：R-SETUP-06
- 测试：scripts/test-vpn-status-reader.mjs::a pending sign-in reports needs_login
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-07 可用的隧道优先于陈旧的登录标记
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-04「隧道不中断」；架构 §3.1 卡片、FormExtensionAbility 与应用共用 VpnStatusReader，词表优先级必须一致；HLD 契约 C-03
- 触发与前置条件：status 同时含 NeedsLogin 与 state=Running|tun=true
- 可观测点：返回快照的 state
- 期望：正常：connected 的判定排在 needs_login 之前，报 connected；边界：登录标记不得盖过工作中的隧道，否则卡片会与应用对同一条隧道给出相反结论；失败与恢复：—；安全与质量：优先级写死在单一函数里，避免三处各写一份而漂移。判定在桩边界下成立
- 失败信息：期望「connected 优先于 needs_login」，实际「登录标记盖住可用隧道，卡片显示需登录而应用显示已连接」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:49 read（connected 分支先于 :59 的 needs_login）；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-04
- 测试：scripts/test-vpn-status-reader.mjs::a working tunnel wins over a stale sign-in marker
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-STATUS-08 只有 Running 而没有 TUN 不算连接
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-09「状态不完整按不确定处理」；架构 D5「state=Running | tun=false 仍不持有任务」；HLD 契约 C-03
- 触发与前置条件：status 含 state=Running 但 tun=false
- 可观测点：返回快照的 state
- 期望：正常：—；边界：缺 tun=true 时报 unknown 而不是 connected；失败与恢复：—；安全与质量：没有 TUN 就没有隧道，不得报 connected。判定在桩边界下成立
- 失败信息：期望「Running 无 TUN 报 unknown」，实际「只要见到 Running 就报 connected」
- 来源：entry/src/main/ets/services/VpnStatusReader.ets:49 read 的 connected 合取条件；scripts/test-vpn-status-reader.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-status-reader.mjs::running without a TUN is not connected
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核
