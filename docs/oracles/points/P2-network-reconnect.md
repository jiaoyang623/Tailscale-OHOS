# MeshArc 单点判据 · 网络重绑与掉线恢复（P2）

覆盖 test-vpn-network-monitor.mjs（8 条）与 test-vpn-reconnect-supervisor.mjs（9 条）。
前者守在扩展进程内的系统网络回调与重绑，后者守「后台掉线后替用户恢复」的意图判读——
它的每一条守卫都是为了不跟刚刚点了断开的用户抢。

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
- 父判据：O-SEAM-10、O-SEAM-11
- 强度：强
- 设计依据：需求 R-CONN-05「非用户主动的掉线在后台自动恢复：最多 3 次、指数退避、稳定 60 s 才清零计数」；架构 O-SEAM-11 责任空洞第 3 条（恢复责任在 VpnReconnectSupervisor）；HLD 契约 C-10
- 触发与前置条件：上一次采样为 connected；onBackground 之后已过 BACKGROUND_SETTLE_MS=10000（测试取 60000）；本次采样为 disconnected
- 可观测点：VpnSessionController.connect 的调用次数；vpn_reconnect_attempt 诊断事件
- 期望：正常：调用 connect 一次并记 vpn_reconnect_attempt；边界：只有 connected→disconnected 的边沿才算掉线（同日两次采样都是 disconnected 不重复触发）；失败与恢复：—；安全与质量：恢复责任落在 P1，而 P1 在后台无长时任务时可能已被冻结——这正是 O-SEAM-11 登记的空洞，本判据只保证「能跑时判定正确」，不承诺冻结期间一定恢复。判定在宿主侧桩边界（VpnStatusReader、VpnSessionController 为桩）下成立
- 失败信息：期望「后台静置后的掉线触发一次恢复」，实际「掉线后一直等到用户自己发现，或在前台就抢着重连」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:78 poll；:107 handleDrop；:11 BACKGROUND_SETTLE_MS；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a tunnel that drops well after backgrounding is brought back
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-02 前台可见或刚进入后台的掉线视为用户主动
- 层级：单点
- 父判据：O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-06「用户的主动断开不得被自动恢复撤销」；架构 §2.5 重试「重试必须能被用户意图打断」；HLD 契约 C-10
- 触发与前置条件：掉线发生在应用仍在前台；或 onBackground 之后不足 BACKGROUND_SETTLE_MS=10000（测试取 2000）
- 可观测点：connect 调用次数；vpn_drop_ignored_foreground 诊断事件
- 期望：正常：—；边界：两种情形都不 connect，并记 vpn_drop_ignored_foreground；失败与恢复：—；安全与质量：用户刚看过应用时的掉线更可能是他自己按的，宁可不重试。判定在桩边界下成立
- 失败信息：期望「前台或刚进后台的掉线按用户主动处理」，实际「用户刚点了断开又被自动连上」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:112 handleDrop 的前台/静置守卫；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-06
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a drop moments after backgrounding is left alone
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a drop while the app is on screen is left alone
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-03 用户已请求停止后的掉线不被恢复撤销
- 层级：单点
- 父判据：O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-06「用户的主动断开不得被自动恢复撤销」；架构 §3.2 S2 无 UI 控制面的意图记忆；HLD 契约 C-10
- 触发与前置条件：noteRequestedStop() 之后，后台静置足够久，再读到掉线
- 可观测点：connect 调用次数；vpn_drop_after_requested_stop 诊断事件
- 期望：正常：—；边界：stopRequested 优先于「已后台足够久」的判据，不 connect，并记 vpn_drop_after_requested_stop；失败与恢复：—；安全与质量：这条是整套守卫里最重要的一条——与刚点了断开的用户抢夺比漏掉一次重试更糟。判定在桩边界下成立
- 失败信息：期望「已请求停止的掉线不恢复」，实际「卡片或应用断开后，后台又把隧道拉了回来」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:62 noteRequestedStop；:108 handleDrop 的 stopRequested 分支；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-06
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::a drop after the user asked to disconnect is not undone
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-04 显式重新连接重置停止意图并重新武装恢复
- 层级：单点
- 父判据：O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-05「非用户主动的掉线在后台自动恢复」；O-SEAM-10 两条入口共享同一意图记忆；HLD 契约 C-10
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

### O-RECONN-05 恢复尝试有上限，耗尽后放弃
- 层级：单点
- 父判据：O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-05「最多 3 次」；架构 §2.5 重试；HLD 契约 C-10
- 触发与前置条件：连续六轮后台掉线、每轮间隔 600000 ms，且 connect 结果始终为 failed
- 可观测点：connect 调用次数；vpn_reconnect_exhausted 诊断事件
- 期望：正常：—；边界：尝试数达到 MAX_ATTEMPTS=3 后不再 connect（connects 恰为 3），并记 vpn_reconnect_exhausted；失败与恢复：—；安全与质量：不无限重试，也不把失败静默吞掉。判定在桩边界下成立
- 失败信息：期望「最多 3 次后放弃并记账」，实际「无限重试或一次失败就放弃且不留痕」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:119 handleDrop；:14 MAX_ATTEMPTS；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 测试：scripts/test-vpn-reconnect-supervisor.mjs::recovery gives up instead of retrying forever
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-RECONN-06 重试按指数退避，不按每次采样触发
- 层级：单点
- 父判据：O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-05「指数退避」；架构 §2.5 重试「三处指数退避」；HLD 契约 C-10
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
- 父判据：O-SEAM-03、O-SEAM-10
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
- 父判据：O-SEAM-10
- 强度：强
- 设计依据：需求 R-CONN-05「稳定 60 s 才清零计数」与 R-CONN-06「用户意图优先」；架构 §2.5 重试；HLD 契约 C-10
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
- 父判据：O-SEAM-10
- 强度：弱
- 设计依据：需求 R-CONN-05「稳定 60 s 才清零计数」；架构 §2.5 重试；HLD 契约 C-10
- 触发与前置条件：一次恢复成功使状态回到 connected，并保持超过 STABLE_MS=60000
- 可观测点：attempts 与 nextAttemptAtMs 的归零；vpn_reconnect_succeeded 诊断事件
- 期望：正常：连接持续 ≥60 s 才记 vpn_reconnect_succeeded 并把重试阶梯归零；边界：短于 60 s 的短暂连接不清零，避免「连一下又断」的抖动隧道把计数反复归零而无限重试；失败与恢复：—；安全与质量：—。判定在桩边界（Date.now 为桩）下成立
- 失败信息：期望「稳定 60 s 才清零重试计数」，实际「每次短暂连上就清零，抖动隧道无限重连」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:91 poll 的稳定性判据；:20 STABLE_MS；scripts/test-vpn-reconnect-supervisor.mjs
- 上游：R-CONN-05
- 待建测试：[单元] scripts/test-vpn-reconnect-supervisor.mjs::a connection held past the stability window clears the retry ladder
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-单元
- 复核：待复核
