# 旅程判据 · 网络设置与网络切换（O-NET-01 至 O-NET-03）

### O-NET-01 连接前选择出口节点
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-NET-01「连接前可选择出口节点；已连接时不可改，并提示先断开」
- 触发与前置条件：已登录且控制服务器已确认；用户在未连接态打开首页设置区的出口节点选择器。已连接态下打开同一面板属边界。
- 可观测点：出口节点选择器（id legacy-exit-node-status）的选项与当前值、exitNodeStatus 文案（未使用出口节点 / 已选择：<名称> / 出口节点列表暂不可用）、Select 的启用与透明度、tailscale 出口节点状态刷新后的回显
- 期望：正常：未连接且已登录时，选择器列出「不使用」加全部在线或已选中的出口节点，选择后经 queueExitNodeUpdate 写入并在刷新后回显所选名称，状态区显示「已选择：<名称>」；边界：未登录时选择器显示「不可用」（setting_unavailable），列表为空时显示「出口节点列表暂不可用」或空态文案，选择「不使用」清除出口节点；已连接、连接中或更新在途时选择器禁用且透明度降低，并在面板上显示「请先断开连接」提示；失败与恢复：写入失败时状态位显示 FAILED 开头的文案且不改变当前选择，用户可重新选择；安全与质量：出口节点更新经 queueExitNodeUpdate 串行化，旧响应的到达不得覆盖用户更新的选择。
- 失败信息：期望「未连接时可改、已连接时禁用并提示先断开、写入失败不改变当前选择」，实际「已连接仍可改，或写入失败后界面回显成功」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:10278 exitNodeSelectOptions；:10316 ExitNodePanel；:10344 已连接/连接中/在途时 Select 禁用；:1938 queueExitNodeUpdate；:10323 已连接时的 exit_node_disconnect_first 提示
- 上游：R-NET-01
- 待建测试：[E2E] scripts/e2e/network-settings.mjs::连接前选择出口节点并在已连接时被拒改
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-NET-02 配置子网路由与出口节点允许访问局域网
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-NET-02「连接前可开关「使用子网路由」与「出口节点允许访问局域网」」
- 触发与前置条件：已登录且控制服务器已确认；用户在未连接态打开首页设置区的网络设置面板，操作两个开关。已连接、未认证态下打开同一面板属边界。
- 可观测点：route-all-toggle 与 exit-node-lan-toggle 的开关态与禁用态、network-settings-disconnect-hint 文案、network-setting-status 的失败文案、networkSettings 状态对象在刷新后的取值
- 期望：正常：未连接且已登录时两个开关可切换，切换即时反映在开关态并经 queueNetworkSettingUpdate 写入后端，读到的新设置刷新后保持；边界：已连接时两个开关禁用并降低透明度，面板底部显示「请先断开连接」提示；未认证时开关同样禁用；同一开关的连续快速切换串行化，最后一次选择生效；失败与恢复：读写失败时显示失败文案并回到已知设置，不得静默保留一个未落盘的开关位；安全与质量：更新失败后界面与后端实际设置不得长期不一致。
- 失败信息：期望「未连接时可切换、已连接时禁用并提示、失败时不静默保留」，实际「已连接仍可切换，或写入失败后开关停在未生效的位置」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:10199 NetworkSettingsPanel；:1982 toggleNetworkSetting；:10212 与 :10237 两个 Toggle 的 enabled 门控；:10248 已连接时的 network-settings-disconnect-hint
- 上游：R-NET-02
- 待建测试：[E2E] scripts/e2e/network-settings.mjs::切换子网路由与出口节点局域网开关
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-NET-03 网络切换后同会话恢复直连
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-NET-03「网络在蜂窝/Wi-Fi 之间变化时，同一次 VPN 会话内自动重绑并恢复直连，不要求用户重连」
- 触发与前置条件：已连接且隧道可用；手机在蜂窝与 Wi-Fi 之间切换承载（或将所连网络断开再恢复），期间不重建 VPN 会话。
- 可观测点：切换后浏览器产生的 TUN 双向包计数、直连 discovery 响应时间、诊断事件 vpn_network_rebound_wifi / vpn_network_rebound_cellular / vpn_network_offline / vpn_network_refresh_failed、界面「connection recovering」文案、VPN 会话是否重建
- 期望：正常：承载在蜂窝与 Wi-Fi 间变化时，同一次 VPN 会话内自动重绑（调用 backendNetworkChangedAsync 后记录 vpn_network_rebound_<bearer>），回到 Wi-Fi 后无需重连即恢复直连；真机走查 M-03 实测修复后回到 Wi-Fi 的直连 discovery 响应为 11 ms（修复前基线 85 ms），Wi-Fi 下 TUN 流量 +142/+142 包、蜂窝下 +12/+20 包；短尾 tailscale down/up 后走查 M-04 实测界面出现 connection recovering 并在 436 ms 内自动回到可用中继路径，VPN session 不变；边界：两端都处于硬 NAT、无可用共享公网 IPv6 时六次 discovery 走 DERP，应用如实显示中继路径（手机侧 UDP/IPv4/IPv6 均可用、MappingVaries=true、localPort=41641），不把中继谎报为直连；失败与恢复：重绑失败记录 vpn_network_refresh_failed 并在 5 s 后重试，覆盖读取期间到达的最新变化而不丢最后一次 Wi-Fi/蜂窝切换；安全与质量：只上报接口名、承载类别与数值错误码，地址与 DNS 只留在内存，不进入诊断日志。已知局限：M-03/M-04 的数值转抄自 docs/vpn-network-recovery.md，本批未复跑；设备工作均在 USB/HDC 连接且充电条件下完成，拔线、电池深度休眠、强杀、重启与物理网卡断开/重连均未覆盖。
- 失败信息：期望「同会话内自动重绑并恢复直连，失败有界重试」，实际「网络变化后要求用户重连，或重绑失败后不再重试」
- 来源：entry/src/main/ets/services/VpnNetworkMonitor.ets:148 refresh；:164 backendNetworkChangedAsync 重绑；:172 记录 vpn_network_rebound_<bearer>；docs/vpn-network-recovery.md:92-102 真机测量
- 上游：R-NET-03
- 测试：真机走查 a01-baseline/manual-checks.md#M-03、真机走查 a01-baseline/manual-checks.md#M-04
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-NET-04 网络不通时等待回调，网络恢复后自动恢复连接
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-NET-05「网络不通时监听系统网络变化。网络恢复后自动恢复连接，不盲等固定间隔」、R-CONN-13；架构 §2.6；HLD 契约 C-11、C-12
- 触发与前置条件：意图为 `connected`，隧道不可用，`connection.getDefaultNet()` 返回 `netId=0`。之后 Wi-Fi 或蜂窝恢复。
- 可观测点：`vpn_session_recovery_deferred` 与 `vpn_session_recovery_attempt` 的写入顺序与时间；`connect` 的调用时刻；`vpn_session_recovered`；界面的连接状态文案
- 期望：正常：离线期间只写一次 `vpn_session_recovery_deferred`，不按固定间隔盲目调用 `connect`。收到 `netAvailable` 后立即尝试一次，不等退避到期。恢复成功后写 `vpn_session_recovered`，界面回到已连接。边界：离线期间多次采样不写重复记录，也不消耗退避。网络在恢复在途时再次变化，恢复由新的网络事件重新驱动。失败与恢复：恢复失败按退避继续。网络再次离线时回到等待。安全与质量：只读 `netId` 与承载类别，不记录地址、接口名或 DNS。判定在真机走查下成立
- 失败信息：期望「离线等待、网络恢复后自动重连」，实际「离线期间重试耗尽，网络恢复后仍保持断开」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets；entry/src/main/ets/entryability/EntryAbility.ets 的网络回调；entry/src/main/ets/services/VpnSessionIntent.ets
- 上游：R-NET-05、R-CONN-13
- 待接线测试：[E2E] scripts/e2e/network-recovery.mjs::断网后恢复网络自动重连（设备未连接，待执行）
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=vpn-endurance（设备未连接，E2E 待执行）
- 复核：待复核
