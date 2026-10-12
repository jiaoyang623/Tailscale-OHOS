# MeshArc 单点判据 · 对端路径缓存、重连与 LocalSend 状态（O-PEER / O-LOCALSEND）

本文件覆盖三个文件共 9 条字面用例：`scripts/test-peer-path-cache.mjs`（2 条，守 `PeerPathService`）、
`scripts/test-peer-reconnect.mjs`（5 条字面用例，另有一个 `for` 循环在运行时生成 5 条模板名用例）、
`scripts/test-localsend-status.mjs`（2 条）。父判据是接缝 `O-SEAM-04`（对端快照）与 `O-SEAM-09`（探测通道）。

**口径说明（本文件通篇适用）**：三个文件都是把生产源码读进来、`stripTypeScriptTypes` 去类型后放进
`node:vm` 沙箱执行。差异在**取代码的方式**：

- `test-peer-path-cache.mjs` 加载整个 `services/PeerPathService.ets` 的类，只桩掉 `requestThroughVpnExtension`
  这一个出口（`Date.now` 也被桩成可推进的假时钟）。类是真的，平台边界是桩。
- `test-peer-reconnect.mjs` 与 `test-localsend-status.mjs` **不加载类**，而是按 `  private <name>(` 字符串搜索
  从 `components/BridgeStatus.ets` 里把方法体切片出来（切到第一个 `\n  }` 为止），拼成一个只含这几个方法的
  合成类，再把 `@State` 字段与被调用的兄弟方法全部手工塞成桩。**切片方式本身有风险**：方法体里若出现
  首个 `\n  }` 之前就被截断的嵌套块，取到的就不是完整的生产代码；且这些方法在生产里依赖的
  `peers`/`trafficSession`/`lifecycleGeneration` 等状态在沙箱里是裸值，与 ArkUI 运行时不同。
  通过只说明「切片出来的这段决策逻辑对给定的桩状态成立」。
- `scripts/test-peer-reconnect.mjs:99-114` 的 5 条用例名由模板字符串在运行时生成
  （`an obsolete home probe cannot reintroduce a path after ${scenario}`，scenario 取
  offline / new_session / new_lifecycle / cancelled / removed），静态文本里没有这 5 个字面名，
  因此不锚，改记为 O-PEER-11 的 `待建测试`。

### O-PEER-01 瞬态（非直连）探测结果按短 TTL 过期，允许被后来的直连结果替换
- 层级：单点
- 父判据：O-SEAM-09、O-SEAM-04
- 强度：强
- 设计依据：需求 R-DEV-05「对端探测结果过期即失效，不能拿旧结果覆盖新的路径」；架构 §五 O-DEV-02 行（「结果过期失效归 P1 的缓存判定」）
- 触发与前置条件：`PeerPathService.probe(peerKey, true)` 已缓存一条 type=derp 的结果；假时钟推进超过瞬态 TTL 后同一对端再次被探测（非 force）
- 可观测点：`probe` 返回的 type、`requestThroughVpnExtension` 的调用次数、缓存项是否被替换
- 期望：正常：中继/未知类结果按 `TRANSIENT_CACHE_TTL_MS`(3000 ms) 计算新鲜度，未过期时直接复用缓存不发起新请求；边界：恰好越过 3000 ms 后必须重新探测——新请求返回 direct 时，缓存与返回值都换成 direct；失败与恢复：重新探测失败由 O-PEER-03 与解析分支处理，本判据只管「过期 ⇒ 必须重探」
- 失败信息：期望「瞬态结果 3000 ms 后失效并被新的直连结果替换」，实际「中继结果被长期钉住，直连永远显示不出来」
- 来源：entry/src/main/ets/services/PeerPathService.ets:10 TRANSIENT_CACHE_TTL_MS=3000；:48-50 probe；:52-61 probeInternal 的缓存新鲜度判定；:70 cache.set；scripts/test-peer-path-cache.mjs
- 上游：R-DEV-05
- 测试：scripts/test-peer-path-cache.mjs::a transient relay cache expires so a later direct response can replace it
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-02 直连结果的缓存 TTL 更长，同一会话内的重复探测复用缓存
- 层级：单点
- 父判据：O-SEAM-09、O-SEAM-04
- 强度：弱
- 设计依据：需求 R-DEV-05；`PeerPathService.ets:7,58-59`——直连比瞬态结果更长寿，避免把已建立的直连反复打回中继
- 触发与前置条件：缓存里是一条 type=direct 的结果；假时钟推进 20 s（小于 `CACHE_TTL_MS`=25000 ms）后再次探测同一对端
- 可观测点：`requestThroughVpnExtension` 调用次数是否保持不变、`probe` 返回的 type
- 期望：正常：直连结果在 25000 ms 内命中缓存，不再发起探测；边界：瞬态 TTL 与直连 TTL 必须是两个不同的窗口（3000 ms vs 25000 ms），把两者写成同一常量会使本判据或 O-PEER-01 失败；失败与恢复：这正是「中继缓存过期后直连能顶上来、而直连自己不会被频繁重探」这一对的另一半
- 失败信息：期望「直连结果在 25000 ms 内复用缓存」，实际「直连结果被当成瞬态结果很快丢弃，或与瞬态结果共用一个 TTL」
- 来源：entry/src/main/ets/services/PeerPathService.ets:7 CACHE_TTL_MS=25000；:58-59 按 cached.type 选择 TTL；:60 命中即返回；scripts/test-peer-path-cache.mjs
- 上游：R-DEV-05
- 测试：scripts/test-peer-path-cache.mjs::a transient relay cache expires so a later direct response can replace it
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-03 未连接优先于缓存：探测返回 unknown/mesh_disconnected 并删除缓存
- 层级：单点
- 父判据：O-SEAM-09、O-SEAM-04
- 强度：强
- 设计依据：需求 R-DEV-05；架构 §五 O-DEV-02 行（探测结果的责任在 P2、过期与失效判定在 P1）
- 触发与前置条件：缓存里已有一条 type=direct 的结果（可能还很新鲜），随后以 `vpnConnected=false` 调 `probe`
- 可观测点：返回值的 type 与 errorMessage、该 peerKey 的缓存项是否被删除
- 期望：正常：VPN 未连接时立即返回 `{type:'unknown', errorMessage:'mesh_disconnected'}`，不读缓存、不发探测请求；边界：**必须删除已缓存的直连结果**——否则断开重连后旧路径会先被当成有效结果读出来；失败与恢复：删除而非仅跳过，使下次连接后的第一次探测一定重新请求
- 失败信息：期望「未连接返回 unknown/mesh_disconnected 并清掉缓存」，实际「返回旧的 direct 缓存，让已断开的会话显示为直连」
- 来源：entry/src/main/ets/services/PeerPathService.ets:52-57 probeInternal 的 !vpnConnected 分支（先 delete 再返回）；:36-42 clearCache；scripts/test-peer-path-cache.mjs
- 上游：R-DEV-05
- 测试：scripts/test-peer-path-cache.mjs::disconnect overrides a previously cached direct path
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-04 在线性只看当前控制面快照，失败的旧探测不得把在线对端移出在线组
- 层级：单点
- 父判据：O-SEAM-04
- 强度：强
- 设计依据：需求 R-DEV-02「设备列表区分本机、在线、离线」、R-DEV-05；`BridgeStatus.ets:5287-5289` 的门内注释（探测描述的是临时可达性，不得移动在线分组）
- 触发与前置条件：对端 `online=true`，而 `streamingStates` 里存着一条 `type=unreachable`、checkedAt 更早的路径结果；错误原因覆盖 `no_response` / `peer_offline` / `peer_not_found` 三种
- 可观测点：`peerEffectivelyOnline(peer)` 的返回值、对端在列表里落入的分组
- 期望：正常：只要控制面快照里 peer.online 为真就判在线，三种失败原因都不得翻转它；边界：对端快照本身 online=false 时才判离线——探测结果不参与这个判断；失败与恢复：不在线组里的对端仍可被探测以恢复（见 O-PEER-10），所以判「离线」的代价是再也探测不到
- 失败信息：期望「在线性只由控制面快照决定」，实际「一次探测失败就把在线对端移入离线组，从此不再重探」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5286-5291 peerEffectivelyOnline；:5319-5322 peerCardStatus 里的离线早退；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-02、R-DEV-05
- 测试：scripts/test-peer-reconnect.mjs::an online peer with a failed old probe stays in the online group and shows recovery
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-05 卡片状态文案：在线对端带失败的旧探测时是「恢复中」，离线对端是「离线」
- 层级：单点
- 父判据：O-SEAM-04
- 强度：弱
- 设计依据：需求 R-DEV-03「设备详情展现在线状态、路径类型（直连/DERP）与延迟」
- 触发与前置条件：`peerCardStatus(peer)` 在两种输入下被调用——在线对端且路径 unreachable/带 errorMessage；对端快照 online=false
- 可观测点：返回的资源引用（`app.string.connection_recovering` / `app.string.peer_offline`）
- 期望：正常：在线但路径探不通时给「恢复中」而不是「离线」，让用户知道应用还在试着恢复；边界：对端快照离线时一律「离线」，不看路径结果；直接/中继/DERP 路径分别给对应的延迟文案（由 `peerCardStatus` 其余分支守，本批无用例）；失败与恢复：`unreachable` 与「有 errorMessage 的其他类型」归入同一分支
- 失败信息：期望「在线对端带失败探测显示恢复中、离线对端显示离线」，实际「在线对端被显示成离线，用户以为设备不可达」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5319-5342 peerCardStatus；:5320-5322 离线早退；:5323-5325 未连接时的等待态；:5328-5330 checking/未探测；:5337-5340 unreachable 或带 errorMessage 时的恢复文案；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-03
- 测试：scripts/test-peer-reconnect.mjs::an online peer with a failed old probe stays in the online group and shows recovery
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-06 对端在线性翻转时作废在途请求与探测缓存
- 层级：单点
- 父判据：O-SEAM-04、O-SEAM-09
- 强度：强
- 设计依据：需求 R-DEV-05；`BridgeStatus.ets:878-879` 的门内注释（对端独立于本 VPN 会话重连，必须丢弃上一段连接的成果）
- 触发与前置条件：`applyPeers` 收到的新快照里某个对端的 online 值与上一次不同（离线→在线或在线→离线），且该对端有在途的 streaming/media 请求号与缓存
- 可观测点：`streamingRequestIds` / `mediaRequestIds` 里该 peerKey 是否被删除、`sunshineProbeService`/`peerPathService`/`mediaServiceProbeService` 的 `cancel` 与 `clearCache` 是否被调、`autoProbedPeerSessions`/失败计数是否被清
- 期望：正常：online 值一变就对三个探测服务 cancel + clearCache，并删除该对端的请求号、发现标记与失败计数；边界：online 值未变的对端不得被误伤——只处理前后 online 不同的那些；失败与恢复：在途请求被 cancel 后其迟到应答必须被判为过期（见 O-PEER-11）；安全与质量：三个服务必须都被作废，只清一个会留下一个能返回旧结果的通道
- 失败信息：期望「在线性翻转即作废在途请求与三路探测缓存」，实际「旧连接的探测结果与请求号被留到新连接，显示上一段的路径」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:863-901 applyPeers；:873-877 只对 online 变化的对端处理；:880-890 cancel/clearCache 与各类标记删除；:894-901 按 online 过滤 streamingStates/mediaStates；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-05
- 测试：scripts/test-peer-reconnect.mjs::offline then online invalidates pending results and lets the same VPN session rediscover services
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-07 同一次 VPN 会话内对端重新上线后重新发现服务
- 层级：单点
- 父判据：O-SEAM-09
- 强度：强
- 设计依据：需求 R-DEV-03；`BridgeStatus.ets:878-879`（对端独立重连不得消耗本会话的发现名额）
- 触发与前置条件：本 VPN 会话（`trafficSession`）编号未变，某个在线对端先被观察到离线、随后又上线，然后 `autoProbeConnectedPeerServices()` 被调用
- 可观测点：`autoProbedPeerSessions` 里该 peerKey 的记录、`refreshPeerServices` 被调用的次数、`peerEffectivelyOnline` 的结果
- 期望：正常：重新上线的对端在同一会话内被再探测一次服务（`refreshPeerServices` 恰好一次）——因为翻出离线时 `autoProbedPeerSessions` 的条目已被删；边界：同一会话内、在线性没变过的对端不得被重复探测（会话门控在 O-PEER-08 一并说明）；失败与恢复：不重探则对端回来后设备详情一直空着，只能靠用户手动刷新
- 失败信息：期望「同一会话内对端重回在线即重新发现服务」，实际「会话内发现名额未回收，对端回来了服务列表仍是空的」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5961-5977 autoProbeConnectedPeerServices；:5965 会话号（`Math.max(1, trafficSession)`）；:5971-5974 会话门控与标记写入；:5975 refreshPeerServices；:888 翻出离线时删除 autoProbedPeerSessions；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-03、R-DEV-05
- 测试：scripts/test-peer-reconnect.mjs::offline then online invalidates pending results and lets the same VPN session rediscover services
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-08 在途的服务刷新不消耗本会话的发现名额
- 层级：单点
- 父判据：O-SEAM-09
- 强度：强
- 设计依据：需求 R-DEV-03；`BridgeStatus.ets:5968-5970` 的早退顺序（先判在途、再写会话标记）
- 触发与前置条件：`peerServiceRefreshInFlight` 里已有该 peerKey（上一次刷新还没回来），随后调用 `autoProbeConnectedPeerServices()`
- 可观测点：`autoProbedPeerSessions` 是否被写入该 peerKey、`refreshPeerServices` 调用次数；在途集合清空后再调用同一方法的次数
- 期望：正常：在途时直接跳过且**不写**会话标记，因此等这次刷新结束后下一次仍会真的去探测（次数从 0 变 1）；边界：会话标记必须在「确实发起了刷新」之后才写——漏了这一步就是「一次被跳过的尝试静默吃掉本会话仅有的发现机会」；失败与恢复：顺序调换（先写标记再判在途）会使对端在整个会话里再也探测不到服务
- 失败信息：期望「在途刷新只跳过不算数，清空后仍能探测」，实际「标记被提前写入，本会话的发现名额被一次未执行的尝试消耗掉」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5961-5977 autoProbeConnectedPeerServices；:5968-5970 peerServiceRefreshInFlight 早退；:5971-5973 会话门控；:5974 写标记；:5975 refreshPeerServices；:5825-5959 refreshPeerServices 在 finally 里删除在途标记；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-03
- 测试：scripts/test-peer-reconnect.mjs::a busy old service request does not consume the reconnect discovery attempt
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-09 迟到的服务结果不得覆盖更新的路径，但服务结果本身仍被接受
- 层级：单点
- 父判据：O-SEAM-04、O-SEAM-09
- 强度：强
- 设计依据：需求 R-DEV-05「不能拿旧结果覆盖新的路径」；`BridgeStatus.ets:6022-6023` 的门内注释（服务发现可能晚于更新的首页路径探测）
- 触发与前置条件：`updateStreamingState` 先写入一条 checkedAt 较新的 direct 路径，随后用一条 checkedAt 更早的 unreachable 路径（但带一个 checkedAt 更新的 sunshine 结果）再次更新同一对端
- 可观测点：该对端 `streamingState` 的 `path.type` / `path.checkedAt` 与 `sunshine.state` / `sunshine.checkedAt`
- 期望：正常：`update.path.checkedAt` 小于已存路径的 checkedAt 时保留已存路径，同时**接受**这次更新里的 sunshine 结果——两条时间线各自取新，而不是整条状态一起丢弃；边界：checkedAt 相等或更大时整体采用新值；失败与恢复：整条丢弃会让晚到的媒体探测结果白做，全盘覆盖则让旧路径顶掉新路径
- 失败信息：期望「保留更新的路径、接受迟到的服务结果」，实际「旧路径覆盖新路径，或连同服务结果一起被丢弃」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:6013-6029 updateStreamingState；:6024-6026 以 path.checkedAt 比较并保留较新者（用 copyStreamingState 只替换 path）；:6002-6011 copyStreamingState；:5987-6000 streamingState；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-05
- 测试：scripts/test-peer-reconnect.mjs::a slow service response cannot overwrite a more recent recovered path
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-10 首页轮询对在线对端强制重探，旧的 unreachable 结果不阻止刷新
- 层级：单点
- 父判据：O-SEAM-09、O-SEAM-04
- 强度：强
- 设计依据：需求 R-DEV-05；`BridgeStatus.ets:5287-5289`（在线对端必须能被重探，「不得阻止恢复所需的探测」）
- 触发与前置条件：已连接、应用外壳就绪、有在线且带地址的对端；该对端已存着一条 unreachable 路径；`refreshHomeLatency()` 被调用
- 可观测点：`peerPathService.probe` 是否被以 force 调用、更新后 `streamingState` 的 path.type、`peerEffectivelyOnline` 的结果
- 期望：正常：首页轮询对每个在线对端发起强制探测（绕过缓存），成功回来后写入新路径（例如 derp）；边界：探测结果写入前要通过代际/会话/在线性/取消的守卫（见 O-PEER-11），本判据只要求「旧 unreachable 不得成为不探测的理由」；失败与恢复：一次 `homeLatencyRefreshInFlight` 只允许一轮在途刷新，刷新结束（含失败）后必须复位，否则后续轮询永久停摆
- 失败信息：期望「首页轮询强制重探在线对端并写回新路径」，实际「因为已有 unreachable 结果就不再探测，路径永远停在不可达」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:4035-4062 refreshHomeLatency；:4037-4039 在途与连接态门控；:4041-4045 只取在线且有地址的对端；:4046 置在途；:4049-4050 probe(key, true, true) 强制探测；:4057-4058 写回路径；:4059-4061 finally 复位在途标记；scripts/test-peer-reconnect.mjs
- 上游：R-DEV-05
- 测试：scripts/test-peer-reconnect.mjs::home polling retries an online peer despite an old unreachable path
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-PEER-11 过期的首页探测不得重新引入路径（离线 / 新会话 / 新生命周期 / 已取消 / 已移除）
- 层级：单点
- 父判据：O-SEAM-09、O-SEAM-04
- 强度：强
- 设计依据：需求 R-DEV-05；`BridgeStatus.ets:4047-4055` 的守卫（代际、会话、外壳就绪、在线性、cancelled）
- 触发与前置条件：`refreshHomeLatency` 发起探测后，在应答到达前发生五种变化之一——对端离线、`trafficSession` 递增（新会话）、`lifecycleGeneration` 递增（新生命周期）、探测被标记 cancelled、对端从列表移除
- 可观测点：`streamingStates` 是否仍为空（不得被塞进一条路径）、`homeLatencyRefreshInFlight` 是否已复位
- 期望：正常：五种情形下迟到的探测结果都被丢弃，既不写入 `streamingStates`，也不把在途标记永久留真；边界：守卫是合取——任一条不成立即丢弃，「新会话里的旧探测」与「旧生命周期里的探测」都算过期；失败与恢复：没有这条守卫，切走再回来或断开重连后会出现一条属于上一段连接的路径；安全与质量：丢弃后必须仍然复位 `homeLatencyRefreshInFlight`，否则首页延迟刷新永久停摆
- 失败信息：期望「过期的首页探测结果一律不写入并在途标记复位」，实际「迟到的探测把上一段会话的路径重新塞进列表，或让在途标记卡住」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:4035-4062 refreshHomeLatency；:4047-4048 开始前捕获 generation 与 session；:4049-4055 应答后的守卫（appShellReady / isConnected / generation / session / currentPeer 存在且在线 / errorMessage !== 'cancelled'）；:4059-4061 finally 复位在途标记；scripts/test-peer-reconnect.mjs:99-114（5 条用例名由模板字符串在运行时生成，静态文本里不是字面量，故不锚）
- 上游：R-DEV-05
- 待建测试：[单元] scripts/test-peer-reconnect.mjs::过期的首页探测结果在离线、新会话、新生命周期、取消、移除五种情形下都不重新引入路径
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-单元
- 复核：待复核

### O-LOCALSEND-01 挂起中的详情页按 peerKey 读当前对端，而不是打开时捕获的旧对端
- 层级：单点
- 父判据：O-SEAM-04、O-SEAM-09
- 强度：强
- 设计依据：需求 R-DEV-06「设备详情被挂起时，用当前对端而不是打开时捕获的旧对端取数」
- 触发与前置条件：详情面板用稳定的 ForEach key 保持挂载，其闭包里捕获的对端对象已经过时；`localSendAvailableForPeer(capturedPeer)` / `localSendStatusForPeer(peerKey)` 被调用，而 `this.peers` 已换成新的快照
- 可观测点：`localSendAvailableForPeer` 的返回值、`localSendStatusForPeer` 返回的 `LocalSendStatus`（或 undefined）
- 期望：正常：两个方法都只按 `peer.key` 去当前 `peers` 里查，捕获的旧对象只用来取 key——当前快照里的 localSend.state 决定结果（unavailable→false，available→true，再变回 unavailable→false）；边界：凭据在旧对象上（例如旧的 localSend.state=unavailable）不得影响判断；失败与恢复：当前快照里没有这个 key 时返回 false / undefined（见 O-LOCALSEND-02）；安全与质量：不缓存对端对象，避免详情页显示上一段的 LocalSend 状态
- 失败信息：期望「按 peerKey 读当前对端」，实际「读打开时捕获的旧对端，详情页长期停在旧状态」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:4537-4541 localSendAvailableForPeer（按 key 查当前 peers 再判）；:4543-4547 localSendStatusForPeer（门内注释：稳定 key 让详情页保持挂载，必须读当前目录）；scripts/test-localsend-status.mjs
- 上游：R-DEV-06
- 测试：scripts/test-localsend-status.mjs::a mounted detail sheet reads a fresh LocalSend result despite its captured old peer
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-LOCALSEND-02 LocalSend 可用性要求当前对端在线且 VPN 已连接
- 层级：单点
- 父判据：O-SEAM-09、O-SEAM-04
- 强度：强
- 设计依据：需求 R-DEV-06、R-DEV-04「设备详情内的服务行在离线或未连接时降级，而不是报错」
- 触发与前置条件：捕获的对端上记着 localSend.state=available，但当前状态不满足条件——当前快照里该对端 online=false；或当前快照里没有该 key；或 `isConnected()` 为 false
- 可观测点：`localSendAvailableForPeer` 的返回值、`localSendStatusForPeer(peerKey)` 的返回值
- 期望：正常：只有「VPN 已连接 ∧ 当前对端存在 ∧ 当前对端在线 ∧ 当前对端 localSend.state='available'」四者同时成立才返回 true；边界：对端离线→false，对端不在快照里→false 且 `localSendStatusForPeer` 返回 undefined，VPN 未连接→false（即使 localSend 仍记着 available）；失败与恢复：旧的 available 结果不得单独成立——它是上一段连接的观测；安全与质量：不可用一律降级为不可用，不得报错也不得显示可点击的入口
- 失败信息：期望「离线/未连接/已移除时 LocalSend 一律不可用」，实际「旧的 available 结果让已离线对端仍显示可用入口」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:4537-4541 localSendAvailableForPeer（isConnected ∧ current 存在 ∧ peerEffectivelyOnline(current) ∧ localSend.state === 'available'）；:4543-4547 localSendStatusForPeer；:5286-5291 peerEffectivelyOnline；scripts/test-localsend-status.mjs
- 上游：R-DEV-06、R-DEV-04
- 测试：scripts/test-localsend-status.mjs::current peer presence and VPN connection override an old available service
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核
