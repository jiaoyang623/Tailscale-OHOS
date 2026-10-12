# 旅程判据 · 设备列表与设备详情（O-DEV-01 至 O-DEV-02）

### O-DEV-01 浏览设备列表（含未登录与加载态）
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-DEV-01「未登录、加载中、已登录三种状态给出不同表述，不显示空列表」、R-DEV-02「设备列表区分本机、在线、离线，并标出名称、系统与密钥过期」
- 触发与前置条件：用户打开应用进入首页；分别在未登录、后端加载中（尚无对端快照）、已登录三种状态下查看设备区。
- 可观测点：设备区标题与计数（devices_count）、devices-loading 加载指示、未登录态文案（account_profile_unavailable）、分组标题 device_group_local/online/offline、每行的名称（localDeviceName / peerDisplayName）、系统描述（peerDeviceDescription）与密钥过期徽标
- 期望：正常：未登录时显示 DevicesSignedOutPanel 的不可用文案，加载中且尚无对端时显示 DevicesLoadingPanel 的加载指示，已登录时按「本机 / 在线 / 离线」分组显示设备，本机行常驻，在线与离线分组只在非空时出现；每行标出名称与系统描述，密钥已过期或临近过期时显示过期徽标；边界：在线或离线分组为空时不渲染该分组标题，已登录但零对端时至少仍有本机行，不出现空白列表；失败与恢复：对端快照过期（vpn-peers.json 的 updatedAtMs 距今超过 5000 ms）时被丢弃并保留上一份有效列表，不把过期快照当新数据刷新；安全与质量：在线判定 peerEffectivelyOnline 同时考虑后端在线态与当前 VPN 连接态，未连接时不把对端误标为在线。
- 失败信息：期望「三种状态互斥呈现、分组只标非空组、过期快照不覆盖」，实际「未登录或加载中显示空列表，或把过期快照当新数据刷新」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:12428 三态互斥渲染；:10750 DevicesPanel；:10359 DevicesLoadingPanel；:10385 DevicesSignedOutPanel；:10592 密钥过期徽标；:5216 homeOnlinePeers 与 :5220 homeOfflinePeers 的分组；:4508 peerDeviceDescription；:3597 refreshPeerSnapshot 与 :3606 过期快照丢弃
- 上游：R-DEV-01、R-DEV-02
- 待建测试：[E2E] scripts/e2e/devices-journey.mjs::设备列表在未登录与加载态下不显示空列表
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-DEV-02 打开设备详情并读取服务与路径
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-DEV-03「设备详情展现在线状态、路径类型（直连/DERP）与延迟，可手动刷新」、R-DEV-04「设备详情内的服务行在离线或未连接时降级为 offline/disconnected，而不是报错」、R-DEV-05「对端探测结果过期即失效，不能拿旧结果覆盖新的路径」、R-DEV-06「设备详情被挂起时，用当前对端而不是打开时捕获的旧对端取数」
- 触发与前置条件：已登录（通常已连接）时，从设备列表点某一对端行打开详情；对端在线、离线、未连接三种状态下都适用。
- 可观测点：详情页路径行（device_path_direct / device_path_peer_relay / device_path_derp_relay / device_path_unreachable 文案与延迟）、服务行 Sunshine / 媒体 / Taildrop / LocalSend / Taildrive 的 label 与状态胶囊（available / unavailable / checking / unknown / offline / disconnected）、刷新按钮的加载态、详情页标题的名称、系统与在线态
- 期望：正常：打开详情时按 selectedPeerKey 捕获所选对端并启动秒级刷新轮询，路径行按 path.type 显示直连 / DERP / 对端中继与延迟，服务行按各探测结果显示可用 / 不可用 / 未知；手动刷新按预算重新探测并保留至少一帧刷新加载态；边界：对端离线时服务行状态为 offline、label 为「设备离线」，已登录但当前未连接 VPN 时为 disconnected、label 为「未连接」，而不是抛错；路径未知时显示未知态；失败与恢复：对端探测结果超过缓存 TTL（直连 25 s、瞬时结果 3 s）即失效，新的路径结果不得被旧的探测响应覆盖，刷新期间开始的探测会丢弃上一代的响应；安全与质量：详情页挂起后按 selectedPeerKey 取当前对端，而不是打开时捕获的旧对象，LocalSend 等即时状态来自当前目录。
- 失败信息：期望「服务行降级为 offline/disconnected 且不被旧探测覆盖」，实际「离线或未连接时服务行报错，或旧探测结果覆盖新路径」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5555 openPeerDetails；:5570 startDeviceDetailRefreshPolling；:5615 refreshSelectedPeerServicesManually；:5825 refreshPeerServices；components/DeviceDetailSheet.ets:222 pathLabel；:63 sunshineStatusState 的 offline/disconnected 降级；services/PeerPathService.ets:7 CACHE_TTL_MS 与 :58 过期判定；docs/vpn-network-recovery.md:162-167 详情页改用当前对端
- 上游：R-DEV-03、R-DEV-04、R-DEV-05、R-DEV-06
- 待建测试：[E2E] scripts/e2e/devices-journey.mjs::打开设备详情读取服务与路径并在离线时降级
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
