# MeshArc 单点判据 · 网络重绑与掉线恢复（P2）

覆盖 test-vpn-network-monitor.mjs 与 test-vpn-reconnect-supervisor.mjs。
前者守在扩展进程内的系统网络回调与重绑。后者守「意图为连接时替用户恢复」的判读。
2026-10-20 起，恢复不再限制次数，也不再忽略前台掉线。唯一的停止条件是用户意图。

O-RECONN-01…13 的父判据由审查人裁决 Q16a（2026-10-12）重定。
旧值混用 O-SEAM-10、O-SEAM-11、O-SEAM-03。
新值统一为 O-SEAM-11（恢复责任）与 O-SEAM-03（状态判读）。
理由：这些判据断言的是该不该重连，不是两条编排是否交出同一套契约。
设计依据随之改为引 C-11，只读状态的一条引 C-03。

### O-NETMON-01 用系统默认网络取样并合并重复回调
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「网络在蜂窝/Wi-Fi 之间变化时，同一次 VPN 会话内自动重绑并恢复直连」；架构 §3.2(d) 与 §五 O-NET-03 行；HLD 契约 C-12
- 触发与前置条件：start() 后的首个采样；以及 netAvailable / netLost / netCapabilitiesChange / netConnectionPropertiesChange 回调在 SETTLE_MS=750 内重复到达
- 可观测点：nativeBridge.backendNetworkChangedAsync 的调用次数与实参（接口名）
- 期望：正常：以 connection.getDefaultNet 取样（排除 VPN 网络），首次以接口名 wlan0 重绑一次；边界：同一默认网络的重复回调在 SETTLE 窗口内被合并成一次重绑（调用仍为 ['wlan0']）；失败与恢复：—；安全与质量：不按接口名优先级、也不按「最近一次回调是哪个承载」选接口。判定在宿主侧桩边界（connection、nativeBridge 为桩）下成立，通过不等于真机网络切换一定重绑成功
- 失败信息：期望「按系统默认网络取样并把抖动合并成一次重绑」，实际「取错接口、或每个回调都各重绑一次」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:35 start；:104 changed；:112 schedule；:122 readDefaultNetwork；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::uses the current default network, coalesces duplicates, never logs address data
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-02 网络地址与 DNS 不进入诊断或日志
- 层级：单点
- 父判据：O-SEAM-12、O-SEAM-15
- 强度：强
- 设计依据：需求 R-NET-04「网络变化的地址数据不得写入日志或诊断」；架构 §2.5 脱敏、O-SEAM-12「未记录地址数据」；HLD 契约 C-12
- 触发与前置条件：任何一次采样或重绑产生的诊断事件
- 可观测点：诊断事件文本（事件名与错误码）；fingerprint 是否只留在内存
- 期望：正常：重绑事件只带承载类别（vpn_network_rebound_wifi / vpn_network_rebound_cellular / vpn_network_offline）与数字错误码；边界：事件文本中不得出现接口名或 IP 地址（addresses 与 DNS 只参与内存中的 fingerprint）；失败与恢复：—；安全与质量：地址数据不得跨越这条接缝落盘。判定在桩边界下成立
- 失败信息：期望「只上报承载类别与错误码」，实际「把接口名、IP 或 DNS 写进诊断事件」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:140 readDefaultNetwork 的「kept in memory only」注释；:172 record；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-04
- 测试：scripts/test-vpn-network-monitor.mjs::uses the current default network, coalesces duplicates, never logs address data
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-03 取样期间默认网络变化则丢弃该次读
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「同一次 VPN 会话内自动重绑」；架构 §2.5 异步陈旧「迟到结果不得覆盖新结果」；HLD 契约 C-12
- 触发与前置条件：getConnectionProperties 在途未返回时，默认网络从 netId 11 变为 netId 20
- 可观测点：backendNetworkChangedAsync 的调用序列
- 期望：正常：—；边界：properties 返回后再次 getDefaultNet，netId 不一致即抛错弃读，被丢弃的旧读不得先发一次（序列恰为 ['wlan0','rmnet0']）；失败与恢复：弃读引发的新一轮采样以新网络重绑一次；安全与质量：revision 与 generation 守卫保证迟到结果不覆盖新结果。判定在桩边界（properties 用 deferred 门控）下成立
- 失败信息：期望「默认网络变了就丢弃在途读」，实际「拿旧网络的结果去重绑当前网络」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:131 readDefaultNetwork 的二次取样；:159 refresh 的 revision/generation 守卫；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::discards a stale read when default net changes before properties return
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-04 同一接口落在新网络或地址续期也算变化
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「网络变化后同会话内自动重绑」；架构 §3.2(d)；HLD 契约 C-12
- 触发与前置条件：接口仍为 wlan0 但默认网络 netId 由 10 变为 11；以及 netConnectionPropertiesChange 回调带来地址由 192.0.2.2 变为 192.0.2.3
- 可观测点：backendNetworkChangedAsync 的调用次数
- 期望：正常：fingerprint 由 `netId|接口|地址列表|DNS` 组成，任一项不同即视为变化并重绑；边界：两次变化各触发一次刷新（累计 3 次调用）；失败与恢复：—；安全与质量：—。判定在桩边界下成立
- 失败信息：期望「接口名相同也按 netId/地址/DNS 识别变化」，实际「只看接口名，换了 Wi-Fi 或地址续期后不重绑」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:144 fingerprint；:162 refresh 的比较；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::same interface on a new Wi-Fi network and address renewal both trigger refresh
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-05 离线清空路由提示，恢复时按新承载重绑
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「同一次会话内自动重绑并恢复直连」；O-SEAM-12「interfaceName 为空时记 vpn_network_offline」；HLD 契约 C-12
- 触发与前置条件：netLost 后 getDefaultNet 的 netId 为 0；随后 netAvailable 到 rmnet0
- 可观测点：backendNetworkChangedAsync 的序列与实参；vpn_network_offline / vpn_network_rebound_cellular 事件
- 期望：正常：离线时以空接口名重绑一次以清空路由提示，记 vpn_network_offline；边界：恢复时以新接口 rmnet0 重绑并记 vpn_network_rebound_cellular；失败与恢复：—；安全与质量：离线的判定来自系统默认网络 netId=0，不靠猜。判定在桩边界下成立
- 失败信息：期望「离线清空、恢复重绑」，实际「离线仍沿用旧接口名，或恢复后不重绑」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:126 readDefaultNetwork 的离线分支；:172 record；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::clears the route hint when offline and applies the restored bearer
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-06 原生重绑失败后自愈重试，不依赖新的平台回调
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「不要求用户重连」；O-SEAM-12「重绑失败在 RETRY_MS 5000 后重试」；HLD 契约 C-12
- 触发与前置条件：backendNetworkChangedAsync 返回非 OK（'FAILED | refresh'）
- 可观测点：vpn_network_refresh_failed 事件；随后 RETRY_MS 内的再次调用
- 期望：正常：—；边界：失败不更新 fingerprint、记 vpn_network_refresh_failed 并置重试标志；失败与恢复：RETRY_MS=5000 后自动重试成功（调用序列 ['wlan0','wlan0']），期间不需要任何平台回调再次触发；安全与质量：不以「等下个回调再说」为由放弃重绑。判定在桩边界（nativeBridge 为桩、Date.now 为桩）下成立
- 失败信息：期望「重绑失败后 5 s 自愈重试」，实际「失败后悬停，直到用户手动重连」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:168 refresh 的失败抛错；:176 catch；:181 重试调度；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::failed native refresh retries without another platform callback
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-07 重绑在途时到达的新修订在完成后被重放
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「蜂窝/Wi-Fi 变化时同会话内重绑」；O-SEAM-12「revision/appliedRevision 保证等待重绑期间到达的最新变化不被丢弃」；HLD 契约 C-12
- 触发与前置条件：Wi-Fi 重绑在途（nativeBridge 未返回）时，蜂窝 netAvailable 到达
- 可观测点：在途期间的调用序列；原生返回后的调用序列
- 期望：正常：—；边界：在途期间到达的变化不并发重绑（此时序列仍为 ['wlan0']）；失败与恢复：原生返回后按最新修订重放一次（序列变为 ['wlan0','rmnet0']），Wi-Fi→蜂窝的最终过渡不被丢掉；安全与质量：只有重绑完成后才标记 appliedRevision。判定在桩边界（nativeBridge 用 deferred 门控）下成立
- 失败信息：期望「在途期间的新变化在完成后被重放」，实际「重绑期间的最后一次切换被吞掉，停在旧网络」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:153 refresh 的 revision 快照；:175 appliedRevision；:181 重放判定；:185；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::replays a cellular transition whose timer fires during an in-flight Wi-Fi rebind
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-08 平台回调注册失败按退避重试
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「同会话自动重绑」；O-SEAM-12「程序注册失败在 RETRY_MS 后重试」；HLD 契约 C-12
- 触发与前置条件：monitor.register 的回调收到错误（{ code: 201 }）
- 可观测点：vpn_network_monitor_failed 事件；registered 计数；vpn_network_monitor_started 事件
- 期望：正常：—；边界：注册失败记 vpn_network_monitor_failed 并按 RETRY_MS 重试注册；失败与恢复：下一次重试成功（registered 变 2）后进入正常刷新；安全与质量：—。判定在桩边界下成立
- 失败信息：期望「注册失败退避重试直到成功」，实际「注册一次失败就再也不监听网络变化」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:83 register 的回调；:89 schedule(RETRY_MS)；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::registration failures retry and do not leak a listener after stop
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-09 停止后注销监听，平台回调不再触发任何工作
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「同会话重绑」；架构 §3.1「VpnNetworkMonitor 随扩展进程存活」；HLD 契约 C-12
- 触发与前置条件：stop() 之后平台回调（netAvailable）到达
- 可观测点：unregister 调用次数；停止后 backendNetworkChangedAsync 的调用次数
- 期望：正常：stop 注销监听（unregistered 为 1）；边界：停止后到达的平台回调不产生任何重绑（调用数不增）；失败与恢复：—；安全与质量：不泄漏 NetConnection 监听，避免进程被回收后仍被系统唤起。判定在桩边界下成立
- 失败信息：期望「停止即注销且不再响应」，实际「监听泄漏，停止后系统回调仍驱动重绑」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:45 stop；:52 netConnection 置空；:59 unregister；:72 changed 的 active/generation 守卫；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::registration failures retry and do not leak a listener after stop
- 测试：scripts/test-vpn-network-monitor.mjs::stop during native work cancels replay and releases the registered listener
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NETMON-10 停止取消进行中的重放并清空定时器
- 层级：单点
- 父判据：O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-03「同会话重绑」；架构 §2.5 异步陈旧守卫；HLD 契约 C-12
- 触发与前置条件：backendNetworkChangedAsync 在途时调用 stop()
- 可观测点：停止后的调用序列；未触发的定时器数量
- 期望：正常：—；边界：停止后在途结果不再重放（序列仍为 ['wlan0']）；失败与恢复：定时器被清空（timers.size 为 0），不遗留待触发的重绑；安全与质量：世代失配的在途结果直接丢弃，不产生游离工作。判定在桩边界（nativeBridge 用 deferred 门控）下成立
- 失败信息：期望「停止打断在途工作且清空定时器」，实际「停止后仍重放一次重绑，留下孤立的定时器」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:48 stop 清定时器；:153 refresh 的 generation 守卫；:181 finally 的重放条件；scripts/test-vpn-network-monitor.mjs
- 上游：R-NET-03
- 测试：scripts/test-vpn-network-monitor.mjs::stop during native work cancels replay and releases the registered listener
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-01 后台静置足够久后的掉线触发一次恢复
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-05「非用户主动的掉线在后台自动恢复：指数退避，退避上限 300 s；稳定 60 s 后清零计数。恢复不设次数上限」；架构 O-SEAM-11 责任空洞第 3 条（恢复责任在 VpnReconnectSupervisor）；HLD 契约 C-11
- 触发与前置条件：意图为 `connected`；上一次采样为 connected；本次采样为 disconnected（不论应用在前台还是后台）
- 可观测点：VpnSessionController.connect 的调用次数；`vpn_session_recovery_attempt` 诊断事件
- 期望：正常：调用 connect 一次并记 `vpn_session_recovery_attempt`；边界：只有 connected→disconnected 的边沿（或回退到未连接）才算一次掉线，连续两次 disconnected 不重复触发；失败与恢复：用户停止后不恢复（O-RECONN-03）；安全与质量：恢复责任落在 P1，而 P1 在后台无长时任务时可能已被冻结——这正是 O-SEAM-11 登记的空洞，本判据只保证「能跑时判定正确」，不承诺冻结期间一定恢复。判定在宿主侧桩边界（VpnStatusReader、VpnSessionController 为桩）下成立
- 失败信息：期望「后台静置后的掉线触发一次恢复」，实际「掉线后一直等到用户自己发现，或在前台就抢着重连」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets 的 poll 与恢复状态机；entry/src/main/ets/services/VpnSessionIntent.ets；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a tunnel that drops well after backgrounding is brought back
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-02 意图为连接时前台或刚进后台的掉线立即恢复
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-11「用户没有点击停止时，连接不得停止」、R-CONN-13「恢复不设次数上限」；架构 §2.6「意图优先于观测」；HLD 契约 C-11
- 触发与前置条件：应用在前台，或刚进入后台；意图为 `connected`；隧道从 connected 掉到 disconnected
- 可观测点：`connect` 的调用次数与时机；`vpn_session_recovery_attempt` 的写入；`vpn_drop_ignored_foreground` 不再出现
- 期望：正常：意图为 connected 时立即恢复，前台与刚进后台都不延迟；边界：用户点停止会先写意图 stopped，在途恢复的授权令牌随即返回 false；失败与恢复：恢复失败按退避继续，不退化为「当作没发生」；安全与质量：前台恢复不得抢在用户自己的连接命令之前——同一时刻由 `VpnCommandStateMachine.begin` 拒绝后发起者。判定在宿主侧桩边界（`Date.now`、`fileIo` 为桩）下成立
- 失败信息：期望「前台与刚进后台的掉线都恢复」，实际「前台掉线被当作用户主动，从不恢复」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets；entry/src/main/ets/services/VpnSessionIntent.ets；entry/src/main/ets/services/VpnCommandGateway.ets；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-11、R-CONN-13
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a foreground drop is recovered without the ten second settle
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-03 用户已请求停止后的掉线不被恢复撤销
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-06「用户的主动断开不得被自动恢复撤销」；架构 §3.2 S2 无 UI 控制面的意图记忆；HLD 契约 C-11
- 触发与前置条件：意图文件为 `stopped`（用户停止后的状态），再读到掉线
- 可观测点：connect 调用次数；vpn_drop_after_requested_stop 诊断事件
- 期望：正常：—；边界：意图 stopped 优先于任何掉线判据，不 connect，并记 `vpn_drop_after_requested_stop`；失败与恢复：—；安全与质量：这条是整套守卫里最重要的一条——与刚点了断开的用户抢夺比漏掉一次重试更糟。判定在桩边界下成立
- 失败信息：期望「已请求停止的掉线不恢复」，实际「卡片或应用断开后，后台又把隧道拉了回来」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets 的 poll 意图分支；entry/src/main/ets/services/VpnSessionIntent.ets；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-06
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a drop after the user asked to disconnect is not undone
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-04 显式重新连接重置停止意图并重新武装恢复
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-05「非用户主动的掉线在后台自动恢复」；O-SEAM-11 恢复意图的重新武装；HLD 契约 C-11
- 触发与前置条件：noteRequestedStop() 之后调用 noteRequestedStart()
- 可观测点：stopRequested 的效果（后续掉线是否 connect）；connect 调用次数
- 期望：正常：—；边界：停止意图清零、尝试计数与退避归零，之后的合法后台掉线重新触发一次恢复（connects 变 1）；失败与恢复：—；安全与质量：—。判定在桩边界下成立
- 失败信息：期望「用户重新连接后恢复重新武装」，实际「一次停止后永久关闭自动恢复」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:69 noteRequestedStart；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a deliberate reconnect re-arms recovery
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-05 意图未停止时恢复不设次数上限，退避封顶
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-13「断连后自动恢复不设次数上限」、R-CONN-05「指数退避，退避上限 300 s」；架构 §2.6 恢复状态机；HLD 契约 C-11
- 触发与前置条件：意图为 `connected`，`connect` 连续失败超过 3 次（测试取 5 次），每次间隔超过当前退避
- 可观测点：`connect` 的调用次数；退避间隔序列；`vpn_session_recovery_exhausted` 是否出现（不应出现）；`vpn_session_recovery_attempt` 的尝试序号
- 期望：正常：第 4 次及以后仍调用 `connect`；边界：退避序列为 30/60/120/300/300… s，封顶 300 s；失败与恢复：意图变为 stopped 后立即停止，且不存在「放弃」事件；安全与质量：不得无限快速重试。判定在宿主侧桩边界（`Date.now` 为桩）下成立
- 失败信息：期望「一直重试到成功或用户停止」，实际「3 次后永久放弃」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets 的退避与恢复状态机（本批移除 `MAX_ATTEMPTS`）；entry/src/main/ets/services/VpnSessionIntent.ets；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05、R-CONN-13
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::recovery never exhausts while the user keeps the intent
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-06 重试按指数退避，不按每次采样触发
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-05「指数退避」；架构 §2.5 重试「三处指数退避」；HLD 契约 C-11
- 触发与前置条件：后台掉线后，反复 connected↔disconnected 采样五轮（时间几乎不推进）
- 可观测点：connect 调用次数
- 期望：正常：首次掉线后 connect 一次；边界：退避窗口（RETRY_BASE_MS=30000 起，上限 RETRY_MAX_MS=300000）内再次掉线不再 connect（connects 仍为 1）；失败与恢复：—；安全与质量：网络抖动不得变成每秒重连。判定在桩边界（Date.now 为桩）下成立
- 失败信息：期望「退避窗口内不重试」，实际「每次采样都重连一次」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:123 handleDrop 的退避判据；:127 nextAttemptAtMs；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::retries back off instead of firing on every sample
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-07 未知状态不当作掉线
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-09「状态缺失/陈旧按不确定处理」；O-SEAM-03「陈旧或缺失一律是不确定，而不是已断开」；HLD 契约 C-03
- 触发与前置条件：后台静置之后，采样状态为 unknown（心跳陈旧或状态文件不可读）
- 可观测点：connect 调用次数；诊断事件条数
- 期望：正常：—；边界：unknown 既不算 connected 也不算 disconnected，不触发恢复，也不产生任何诊断事件（events 为空）；失败与恢复：—；安全与质量：不确定不得被当成断线，否则会在状态抖动时反复重连。判定在桩边界下成立
- 失败信息：期望「unknown 不作为掉线证据」，实际「一读到 unknown 就走恢复流程」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:98 poll 的边沿判定；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-09
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::an unknown state is not treated as a drop
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-08 回到前台清零重试阶梯
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：强
- 设计依据：需求 R-CONN-05「稳定 60 s 才清零计数」与 R-CONN-06「用户意图优先」；架构 §2.5 重试；HLD 契约 C-11
- 触发与前置条件：一次恢复尝试失败后，onForeground() 再 onBackground()
- 可观测点：connect 调用次数
- 期望：正常：—；边界：onForeground 清 attempts 与 nextAttemptAtMs，用户回到应用再离开后的合法掉线重新触发一次恢复（connects 由 1 变 2）；失败与恢复：—；安全与质量：用户在场时可以自行处理，回前台即重置阶梯，不把过期退避背到下一次后台。判定在桩边界下成立
- 失败信息：期望「前台访问清零阶梯」，实际「退避计数跨前台/后台累积，用户回来后仍被旧退避挡住」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:47 onForeground；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::returning to the foreground clears the retry ladder
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-09 连接稳定 60 s 才清零重试计数
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-03
- 强度：弱
- 设计依据：需求 R-CONN-05「稳定 60 s 才清零计数」；架构 §2.5 重试；HLD 契约 C-11
- 触发与前置条件：一次恢复成功使状态回到 connected，并保持超过 STABLE_MS=60000
- 可观测点：attempts 与 nextAttemptAtMs 的归零；`vpn_session_recovered` 诊断事件
- 期望：正常：连接持续 ≥60 s 才记 `vpn_session_recovered` 并把重试阶梯归零；边界：短于 60 s 的短暂连接不清零，避免「连一下又断」的抖动隧道把计数反复归零而无限重试；失败与恢复：—；安全与质量：—。判定在桩边界（Date.now 为桩）下成立
- 失败信息：期望「稳定 60 s 才清零重试计数」，实际「每次短暂连上就清零，抖动隧道无限重连」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets 的 poll 稳定性判据与 STABLE_MS；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a connection held past the stability window records a recovery
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-10 用户请求停止后作废在途重连
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-06「用户的主动断开不得被自动恢复撤销」；架构 §五 责任空洞检查第 3 条；HLD 契约 C-11
- 触发与前置条件：`handleDrop` 已经发起 `VpnSessionController.connect`，该 connect 仍在途时入口点调 `noteRequestedStop()`
- 可观测点：传给 `connect` 的授权令牌的返回值（true 表示仍有授权）；`vpn_session_recovery_cancelled` 与 `vpn_session_recovery_superseded` 事件；`disconnect` 的调用次数；扩展是否被启动
- 期望：正常：没有停止请求时，重连照常完成并记 `vpn_session_recovery_started`，不调用 `disconnect`；边界：停止请求到达后令牌立即返回 false，连接在写意图之前、后端就绪之后与启动扩展之前各查一次，命中即返回 `cancelled` 且**不启动扩展**；失败与恢复：万一窗口落在最后一次检查之后，完成时先读意图。意图为 `stopped` 才撤销自己刚建起的隧道并记 `vpn_session_recovery_superseded`，撤销失败记 `vpn_session_recovery_undo_failed`，撤销不写意图、不记 `user_stop`。意图仍为 `connected`（卡片重新连接）时不撤销，隧道留给新的连接。返回 `cancelled` 时不需要撤销，记 `vpn_session_recovery_cancelled`；安全与质量：`connect` 在扩展启动中途没有中断点，所以保证是「用户停止后不留下隧道」，不是「隧道从不被短暂建起」。判定在桩边界下成立
- 失败信息：期望「停止请求作废在途重连并且不留下隧道」，实际「重连照常完成，用户刚点下的断开被静默撤销」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets 的 noteRequestedStop / authorised / 撤销分支；entry/src/main/ets/services/VpnSessionController.ets 的三处授权检查与 CANCELLED；scripts/test-vpn-reconnect-supervisor.mjs；scripts/test-vpn-session-controller.mjs
- 上游：R-CONN-06、R-CONN-08
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a stop requested while a reconnect is in flight undoes the connect
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a connect that cancelled itself is not undone
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a card reconnect supersedes an in-flight recovery without stopping the tunnel
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::the supervisor hands the controller a positive authority token
- 测试：scripts/test-vpn-session-controller.mjs::a connect that lost its authority never starts the extension
- 测试：scripts/test-vpn-session-controller.mjs::a stop after the backend wait cancels the connect
- 测试：scripts/test-vpn-session-controller.mjs::a recovery undo leaves the user intent and the stop ledger alone
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-11 网络离线时等待网络回调，不消耗恢复次数
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-12
- 强度：强
- 设计依据：需求 R-NET-05「网络不通时监听系统网络变化。网络恢复后自动恢复连接，不盲等固定间隔」；架构 §2.6；HLD 契约 C-11、C-12
- 触发与前置条件：意图为 connected，隧道不可用，`connection.getDefaultNet()` 返回 `netId=0`；之后系统回调 `netAvailable`
- 可观测点：`connect` 的调用次数与时机；`vpn_session_recovery_deferred` 与 `vpn_session_recovery_attempt` 的写入；退避计数；账本 `observed` 记录的 `reason`
- 期望：正常：离线期间不调用 `connect`，只写一次 `vpn_session_recovery_deferred`；边界：离线期间多次采样不写重复记录，也不增加退避计数；观察到的心跳失效掉线记为 `network_lost`，phase 为 `network_offline`；失败与恢复：收到 `netAvailable` 后立即调用一次 `connect`，不等退避到期；网络再次离线时回到等待。安全与质量：只读 `netId`，不记录地址或接口名。判定在宿主侧桩边界（`connection` 为桩）下成立
- 失败信息：期望「离线等待、恢复后立即重试」，实际「离线期间按固定间隔重试并耗尽次数，或网络恢复后仍不重试」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets；entry/src/main/ets/entryability/EntryAbility.ets；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-NET-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::network loss defers recovery until the network returns
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-12 已连接后的持续未知按掉线处理
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-11「用户没有点击停止时，连接不得停止」、R-CONN-13；架构 §2.6；HLD 契约 C-03、C-11
- 触发与前置条件：意图为 connected，隧道曾在 connected，之后心跳停止（状态判读为 unknown）持续超过 30 s
- 可观测点：恢复是否发起；`vpn_session_end_observed` 的 `reason`；单次 unknown 采样时的恢复次数
- 期望：正常：unknown 持续超过 30 s 时按掉线进入恢复，`reason` 为 `extension_crash`（账本无结束记录时）；边界：短暂 unknown（少于 30 s）不触发，也不写结束记录；失败与恢复：恢复发起后未知解除且回到 connected，写 `vpn_session_recovered`。安全与质量：不得把一次未知当成掉线，也不得永远停在未知。判定在宿主侧桩边界（`Date.now` 为桩）下成立
- 失败信息：期望「持续未知按掉线恢复」，实际「扩展死亡后永远停在 unknown，界面显示未知但不再恢复」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-11、R-CONN-13
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::sustained unknown after a connection is a drop
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-13 VPN 冲突记为系统停止并停止重试
- 层级：单点
- 父判据：O-SEAM-11、O-SEAM-19
- 强度：强
- 设计依据：需求 R-CONN-12「原因分类含系统策略」、R-CONN-11；HLD 契约 C-11、C-19
- 触发与前置条件：意图为 connected，状态行含 `code=2203002`（系统 VPN 冲突）
- 可观测点：`connect` 的调用次数；账本 `observed` 记录的 `reason` 与 `phase`；`vpn_session_recovery_needs_ui` 事件
- 期望：正常：冲突发生时不调用 `connect`，写一条 `system_stopped` / `vpn_conflict`，并写 `vpn_session_recovery_needs_ui`；边界：同一冲突多次采样不重复写结束记录；失败与恢复：意图时间戳变新（用户重新操作）后恢复一次；安全与质量：冲突期间不得消耗退避次数，也不得反复拉起扩展。判定在宿主侧桩边界下成立
- 失败信息：期望「冲突记为系统停止并等待用户」，实际「冲突被当成普通掉线，监督器无限重试」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets observeEnd 与 poll；entry/src/main/ets/services/VpnStatusReader.ets readText；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-11、R-CONN-12
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a VPN conflict is recorded as a system stop and does not retry
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核
