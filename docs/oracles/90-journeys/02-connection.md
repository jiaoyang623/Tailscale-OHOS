# MeshArc 旅程判据 · 连接与存活（O-CONN-01 … O-CONN-07）

### O-CONN-01 从首页一键连接并进入可用隧道
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-01「从首页一键连接：拉起 VPN 扩展、经系统授权、进入可用的隧道」、R-CONN-03「连接窗口期内应用进程必须持有长时任务，使切到后台后仍能应答扩展的后端交接请求」
- 触发与前置条件：已登录、控制服务器已确认、当前无其它系统 VPN，用户在首页点连接圆钮
- 可观测点：连接圆钮文案与状态区文案（vpnStatus）；filesDir 下 vpn-probe-status.txt 的 state=Running 与 tun=true 及心跳；诊断事件 connect_requested、vpn_config_handoff_staged、vpn_start_requested、vpn_tun_created、vpn_connected
- 期望：正常：beginVpnConnection 进入连接态，先向原生后端取 VPN 配置（requestVpnConfig，失败时 20 次、每次 500 ms 恢复）并 stage 成 vpn-connect-config.json，再 startVpnExtension 拉起 TailscaleVpnExtensionAbility；扩展建 TUN、答完后端交接后重启后端并写回 state=Running | tun=true，首页进入已连接。边界：未确认控制服务器时改跳设置页而不发起连接；已在连接或正在断开时不重复发起；系统 VPN 授权由系统弹窗完成。失败与恢复：预检失败以 FAILED | VPN preflight | backend unavailable 或 config handoff unavailable 收尾，扩展启动失败以 FAILED | VPN start | code=<code> 收尾并回到未连接；后端重启窗口内可走缓存配置的快路径（tryFastReconnect）跳过取配置。安全与质量：连接窗口期（connecting，即 TUN 已建、后端未就绪）应用进程持有 DATA_TRANSFER 长时任务，保证切走应用后仍能应答扩展的后端交接请求（细节见 O-CONN-03）。
- 失败信息：期望「进入 state=Running | tun=true 的可用隧道」，实际「状态停在 FAILED | VPN preflight | backend unavailable、FAILED | VPN start | code=<code>，或长时间停在请求授权」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:2351 beginVpnConnection；entry/src/main/ets/components/BridgeStatus.ets:2440 backendVpnConfigWithRecovery；entry/src/main/ets/components/BridgeStatus.ets:2478 requestVpnExtensionStart；entry/src/main/ets/components/BridgeStatus.ets:2286 tryFastReconnect；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:645 requestUiBackendHandoff
- 上游：R-CONN-01、R-CONN-03
- 待建测试：[E2E] scripts/e2e/connect-journey.mjs::从首页连接后进入可用隧道
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-CONN-02 从首页一键断开
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-02「从首页一键断开：停止扩展、释放长时任务、回到未连接态」
- 触发与前置条件：当前处于已连接或连接窗口期，用户在首页点断开
- 可观测点：连接圆钮文案与状态区文案；vpn-probe-status.txt 变为 disconnected / state=stopped；诊断事件 disconnect_requested、vpn_backend_stop_timeout、disconnect_completed、disconnect_failed；保活通知与长时任务消失（background_stopped）
- 期望：正常：stopVpnProbe 写 vpn-stop-request.json 并先清空 response，轮询 vpn-stop-response.json（最多 150 次）收到 requestId 匹配的应答后 finishVpnExtensionStop 停止扩展、记 disconnect_completed 并回到未连接。边界：断开进行中（disconnectInProgress）时重复点击直接返回、不重入；扩展未在 150 次内应答时记 vpn_backend_stop_timeout 并按 Ability 生命周期停止兜底。失败与恢复：stopVpnExtension 失败以 FAILED | VPN stop | code=<code> 收尾但仍完成断开流程；断开后缓存配置做快速重连准备（deferBackendRestart），超时才重启后端。安全与质量：断开后 VpnBackgroundTaskManager 读到 disconnected 立即释放长时任务（先清零 suppressedUntilDisconnect，再 stop），不残留保活通知。
- 失败信息：期望「扩展停止、长时任务释放、回到未连接」，实际「界面已回到未连接但保活通知/长时任务仍在，或状态停在 FAILED | VPN stop | code=<code>」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:2502 stopVpnProbe；entry/src/main/ets/components/BridgeStatus.ets:2531 pollVpnStopResponse；entry/src/main/ets/components/BridgeStatus.ets:2570 finishVpnExtensionStop；entry/src/main/ets/services/VpnBackgroundTaskManager.ets:163
- 上游：R-CONN-02
- 待建测试：[E2E] scripts/e2e/disconnect-journey.mjs::从首页断开后回到未连接并释放长时任务
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-CONN-03 连接后切到其它应用，隧道保持
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-03「连接窗口期内应用进程必须持有长时任务，使切到后台后仍能应答扩展的后端交接请求」
- 触发与前置条件：用户点连接后，在扩展建 TUN 到隧道可用之间的连接窗口期内（状态为 VPN interface established、原生后端尚未就绪）切到其它应用
- 可观测点：诊断文件 diagnostic-ui-events.ndjson 与 diagnostic-vpn-events.ndjson 中 background_started 与 vpn_connected 的先后、是否出现 vpn_backend_handoff_timeout；vpn-probe-status.txt 是否进入 state=Running | tun=true；两者都不应出现 extension destroyed 或进程被冻结的长间隔
- 期望：正常：连接窗口期的状态（readStatus 把含 VPN interface established 的新鲜心跳解析为 connecting）被当作 live state，VpnBackgroundTaskManager 与 connected 一样持有 DATA_TRANSFER 长时任务；扩展以 100 ms 乘 150 次（约 15 s）轮询 vpn-backend-handoff-request.json，应用进程即使切到后台也能被唤醒并在 BridgeStatus.processVpnBackendHandoffRequest 或 VpnSessionController.answerBackendHandoff 里应答，扩展随后重启后端进入 state=Running | tun=true。边界：只有心跳新鲜（heartbeatMs 在 15 s 内）且状态含 VPN interface established 才计为 connecting；无法辨认的状态（state=Running | tun=false、裸 lifecycle 行、心跳陈旧或缺失）仍不新建任务，不凭旧证据取任务。失败与恢复：连接窗口期内心跳超时（VPN_STATUS_GRACE_MS=60000）时释放任务；窗口期内用户主动断开也及时释放。本批修复正是这条——进程在窗口期被冻结，扩展等 15 s 无人应答后记 vpn_backend_handoff_timeout 并销毁 VPN；该修复只经单元用例与既有诊断记录验证，尚未在真机上复跑端到端（manual-checks.md 的 M-05 是失败的握手样本，M-10 显示竞争 VPN 场景仍未闭环）。安全与质量：修复没有放松 Milestone 1 的收紧原则，只有扩展明确说接口存在才持有任务。
- 失败信息：期望「连接窗口期切到后台后进程仍在运行并应答交接，隧道建成」，实际「进程被冻结、扩展记 vpn_backend_handoff_timeout 并销毁 VPN，用户看到连接自己断掉」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:362 readStatus；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:645 requestUiBackendHandoff；entry/src/main/ets/services/VpnSessionController.ets:150 answerBackendHandoff；entry/src/main/ets/components/BridgeStatus.ets:3407 processVpnBackendHandoffRequest；docs/changes/a01-baseline/manual-checks.md
- 上游：R-CONN-03
- 待建测试：[E2E] scripts/e2e/connect-window-background.mjs::连接窗口期切到其它应用仍建成隧道
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-CONN-04 后台掉线自动恢复（非用户主动）
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-05「非用户主动的掉线在后台自动恢复：最多 3 次、指数退避、稳定 60 s 才清零计数」、R-CONN-06「用户的主动断开不得被自动恢复撤销」
- 触发与前置条件：隧道曾在 connected 后掉到 disconnected，且应用已切到后台满 10 s，且不是经本应用受控入口请求的断开
- 可观测点：诊断事件 vpn_reconnect_attempt、vpn_reconnect_started、vpn_reconnect_not_started、vpn_reconnect_failed、vpn_reconnect_succeeded、vpn_reconnect_exhausted、vpn_drop_ignored_foreground、vpn_drop_after_requested_stop；vpn-probe-status.txt 是否回到 state=Running | tun=true
- 期望：正常：VpnReconnectSupervisor 只在 connected 掉到 disconnected 时触发（不从未知态触发），后台满 10 s（BACKGROUND_SETTLE_MS）才认定为非主动掉线，调 VpnSessionController.connect 重连；最多 3 次（MAX_ATTEMPTS），退避 30 s→60 s→120 s（RETRY_BASE_MS 指数退避、上限 300 s），连接稳定满 60 s（STABLE_MS）才清零尝试计数。边界：回到前台即清空尝试计数与重试梯（onForeground）；连接只维持片刻又掉的 flapping 情形因 60 s 稳定门限不会每轮清零而无限重试。失败与恢复：用户主动断开（卡片 call 触发 noteRequestedStop）后的掉线记 vpn_drop_after_requested_stop 且不重连；前台附近的掉线记 vpn_drop_ignored_foreground 且不重连；达到 3 次后记 vpn_reconnect_exhausted 停止自动恢复。安全与质量：用户的主动断开绝不能被自动恢复撤销。
- 失败信息：期望「非主动掉线在后台自动恢复、主动断开不被撤销」，实际「掉线后一直不恢复直到用户发现，或用户刚断开又被自动连回」
- 来源：entry/src/main/ets/services/VpnReconnectSupervisor.ets:107 handleDrop；entry/src/main/ets/services/VpnReconnectSupervisor.ets:91；entry/src/main/ets/services/VpnReconnectSupervisor.ets:62 noteRequestedStop；entry/src/main/ets/entryability/EntryAbility.ets:202 performCardToggle；entry/src/main/ets/entryability/EntryAbility.ets:251
- 上游：R-CONN-05、R-CONN-06
- 待建测试：[E2E] scripts/e2e/background-reconnect.mjs::后台非主动掉线自动恢复且不撤销主动断开
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-CONN-05 另一个系统 VPN 占用时的冲突处理
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-07「另一个系统 VPN 占用通道时给出可理解的冲突提示，经用户批准才替换」
- 触发与前置条件：设备上已有另一个系统 VPN 占用 VPN 通道，用户连接本应用，扩展 create() 返回 VPN_EXISTS_ERROR_CODE（2203002）
- 可观测点：冲突对话框（vpn_conflict_title / vpn_conflict_message / vpn_conflict_confirm_action）；vpn-probe-status.txt 出现 FAILED | VPN conflict | code=2203002；诊断事件 vpn_conflict、vpn_conflict_detected、vpn_conflict_self_disconnect_requested、vpn_conflict_self_disconnect_completed、vpn_conflict_acknowledged
- 期望：正常：扩展建 TUN 撞到 VPN_EXISTS_ERROR_CODE 时写 FAILED | VPN conflict | code=2203002，首页轮询看到该状态后 showVpnConflictDialog 先停掉本应用自己的扩展（避免留下半建 VPN），再弹出可理解的提示「请先断开其它 VPN 以连接 Tailscale」，用户点确定后清理并恢复后端，须先断开另一个 VPN 才能连接。边界：冲突时取消本次连接命令（complete STOPPED），用户断开其它 VPN 后可重新连接；扩展侧 replaceExistingVpn 只有在 vpn-replace-approved 标记存在且年龄不超过 10 s（VPN_REPLACE_APPROVAL_TTL_MS）时才销毁既有 VPN 并重建，否则每 200 ms 轮询等待批准。失败与恢复：扩展自停失败也继续走向提示；确定后 stopVpnExtension 失败仍继续收尾并恢复后端。安全与质量：不得在用户批准前静默替换或销毁另一个 VPN。本基线在仓库内未找到写 vpn-replace-approved 标记的入口，替换路径实际不可达，真正生效的是「提示用户先断开其它 VPN」这条路。
- 失败信息：期望「给出可理解的冲突提示、经用户批准才替换」，实际「连接无提示地失败，或在用户不知情、未批准时替换或销毁另一个 VPN」
- 来源：entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:577 createTunWithConflictReplacement；entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets:610 replaceExistingVpn；entry/src/main/ets/components/BridgeStatus.ets:4316 showVpnConflictDialog；entry/src/main/ets/components/BridgeStatus.ets:4347 openVpnConflictDialog；README.md
- 上游：R-CONN-07
- 待建测试：[E2E] scripts/e2e/vpn-conflict.mjs::存在另一个系统 VPN 时给出冲突提示
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-CONN-06 锁屏静置下长时间保持连接
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-04「已连接时切到其它应用、锁屏静置，隧道不中断」、R-CONN-09「长时任务在状态缺失/陈旧时按不确定处理，有界宽限后释放」、R-CONN-10「用户主动取消保活通知后，不得在同一会话内自行恢复」
- 触发与前置条件：已登录并连上、未同时运行其它系统 VPN，设备切到其它应用或锁屏静置
- 可观测点：scripts/device-background-vpn-probe.ps1 的逐样本进程数、进程 ID、电源态与心跳龄；scripts/device-vpn-data-probe.ps1 的 TUN 双向读写计数；vpn-probe-status.txt 的 state
- 期望：正常：已连接后切到其它应用或锁屏静置，隧道与 UI/VPN 两端进程都不中断。走查覆盖：M-01 在 Pura 80 Pro（HarmonyOS 7.0.0.105）实测 721 s、25 个样本全为 SLEEP、UI/VPN 进程 ID 全程不变、最大心跳龄 1104 ms；M-02 锁屏前 +13 reads / +18 writes、解锁后 +16 reads / +20 writes，反向也增长。边界：状态缺失或心跳陈旧（超过 15 s 新鲜窗口）时按不确定处理，已持有的任务在 60 s 宽限（VPN_STATUS_GRACE_MS）后释放，且不凭旧证据新建任务；用户主动取消保活通知（USER_CANCEL / REMOVE_NOTIFICATION）后 suppressedUntilDisconnect 为真，同一会话内不自行恢复。失败与恢复：心跳超时释放任务记 background_status_timeout；系统取消（非用户）才用 scheduleRetry 安排退避重试（30 s 起、指数、上限 300 s）。安全与质量：已知局限——M-01/M-02 在 USB/HDC 连接且充电条件下完成，通过一次不代表电池深度休眠、拔线、强杀或重启下仍然成立；M-11 的 720 s 连续蜂窝锁屏未完成（两次各 279 s、309 s 被亮屏打断），不得据此宣称蜂窝下长时间后台存活；R-CONN-09 与 R-CONN-10 目前只有单元用例闭环，M-01/M-02 未直接观测这两条。
- 失败信息：期望「锁屏静置不少于 720 s 隧道不中断、心跳龄不超过 15 s、进程 ID 不变、TUN 双向流量都增长」，实际「锁屏后扩展/进程被回收、心跳龄超过 15 s，或 TUN 流量只有单向增长」
- 来源：entry/src/main/ets/services/VpnBackgroundTaskManager.ets:175；entry/src/main/ets/services/VpnBackgroundTaskManager.ets:182；entry/src/main/ets/services/VpnBackgroundTaskManager.ets:66；entry/src/main/ets/services/VpnBackgroundTaskManager.ets:392；docs/background-vpn-reliability.md；docs/changes/a01-baseline/manual-checks.md
- 上游：R-CONN-04、R-CONN-09、R-CONN-10
- 测试：真机走查 a01-baseline/manual-checks.md#M-01
  真机走查 a01-baseline/manual-checks.md#M-02
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-CONN-07 无 UI 入口独立完成连接
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-CONN-08「无 UI 的入口（桌面卡片、后台恢复）也能独立完成连接，且应答扩展的后端交接」
- 触发与前置条件：设备桌面上的 MeshArc 卡片被点击（card call 事件）或后台恢复发起连接，此时应用可能没有前台界面
- 可观测点：卡片状态文案与按钮（stateText / actionText / detailText / pending，由 FormCardService 从 vpn-probe-status.txt 生成）；vpn-probe-status.txt 是否进入 state=Running | tun=true；诊断事件 vpn_start_requested、vpn_backend_handoff_stopped、vpn_backend_handoff_stop_failed、vpn_stop_requested
- 期望：正常：卡片按钮 postCardAction(call) 唤醒 EntryAbility.performCardToggle，用 VpnSessionController.connect 走与 UI 相同的文件协议——确认控制服务器、确保后端就绪、取配置、stage vpn-connect-config.json、startVpnExtension，并立即以 answerBackendHandoff 轮询应答扩展的后端交接请求，扩展据此建成 state=Running | tun=true 隧道。边界：已连接时再点即走 disconnect，并用 noteRequestedStop / noteRequestedStart 同步重连监督器；需要登录或未配置控制服务器时返回 NEEDS_UI，performCardToggle 调 raiseWindow 拉起窗口而不是静默失败。失败与恢复：answerBackendHandoff 以 250 ms 乘 60 次（与扩展 15 s 预算对齐）轮询，收到 requestId 匹配的请求后停掉原生后端并回写响应，停后端失败仍回写以释放扩展并记 vpn_backend_handoff_stop_failed；后端未就绪或取配置失败时返回 NEEDS_UI。安全与质量：卡片进程不能常驻（EntryFormAbility 只读状态文件），所以全部 VPN 控制都在应用进程完成；请求与应答都带 requestId，陈旧应答不会被误认。该入口的真机走查尚未执行（manual-checks.md M-12 为桌面卡片渲染与点击，未执行）。
- 失败信息：期望「无 UI 入口也能建成隧道并应答交接」，实际「点卡片后 TUN 已建但 15 s 无人应答、VPN 被销毁，或静默失败没有任何提示」
- 来源：entry/src/main/ets/services/VpnSessionController.ets:80 connect；entry/src/main/ets/services/VpnSessionController.ets:150 answerBackendHandoff；entry/src/main/ets/entryability/EntryAbility.ets:202 performCardToggle；entry/src/main/ets/entryformability/EntryFormAbility.ets:18 EntryFormAbility；entry/src/main/ets/widget/pages/VpnToggleCard.ets:45
- 上游：R-CONN-08
- 待建测试：[E2E] scripts/e2e/headless-connect.mjs::无界面入口独立完成连接并应答后端交接
- 待建测试：[真机] 真机走查 a01-baseline/manual-checks.md#M-13（两个进程里同一份 .so 是几个运行时）
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
