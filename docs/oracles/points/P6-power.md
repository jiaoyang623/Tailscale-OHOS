# MeshArc 单点判据 · 省电档位（O-POWER）

本文件覆盖 `scripts/test-vpn-power-policy.mjs` 的 5 条用例。
它守「应用在后台与熄屏时降频，但不牺牲隧道与恢复」。
档位由 P1 判定并写入 `filesDir/vpn-power-stage.json`。
P1 的界面定时器按档位启停。P2 的扩展定时器按档位取间隔。
父判据是接缝 O-SEAM-11（长时任务与恢复责任）与 O-SEAM-03（状态与心跳）。

### O-POWER-01 后台停止界面类探测但保留恢复看门狗
- 层级：单点
- 父判据：O-SEAM-11
- 强度：强
- 设计依据：需求 R-POWER-01「应用退到后台后停止界面类探测并降低刷新频率。隧道的保护与恢复不受影响」；架构 §2.6 横切约束 3「能量档位只影响观测频率」；HLD 契约 C-03、C-11
- 触发与前置条件：应用从 active 进入 background；意图为 `connected`
- 可观测点：`serviceRefreshTimer`、`homeLatencyRefreshTimer`、`deviceDetailRefreshTimer`、`transferProtocolRefreshTimer`、`offlinePeerStatusRefreshTimer`、`cacheSizePollTimer`、`connectionDurationTimer` 是否停止；`healthPollTimer`、`cardTimer` 是否继续；`vpn-power-stage.json` 的 `stage`
- 期望：正常：进入 background 后七个界面类定时器停止，健康轮询（1 s）与卡片轮询（5 s）保留；卡片定时器保持 5 s 以驱动恢复轮询，但桌面卡片刷新按档位放慢：active 每拍、background 每 3 拍、screen-off 每 12 拍；边界：`connectionDurationTimer` 只在详情页可见时运行，回到前台且详情页仍可见时恢复；失败与恢复：回到前台后七个定时器按各自条件恢复，间隔取 active 档；安全与质量：恢复看门狗不属于界面类定时器，不得被停止。判定在宿主侧桩边界（定时器为桩）下成立
- 失败信息：期望「后台停界面探测、留恢复看门狗」，实际「后台仍在每秒探测，或把恢复看门狗一起停掉」
- 来源：entry/src/main/ets/components/BridgeStatus.ets 的定时器生命周期；entry/src/main/ets/services/VpnPowerPolicy.ets；scripts/test-vpn-power-policy.mjs
- 上游：R-POWER-01
- 测试：scripts/test-vpn-power-policy.mjs::background stops UI probes but keeps the recovery watchdog
- 测试：scripts/test-vpn-power-policy.mjs::the desktop card refresh slows with the power stage
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-POWER-02 熄屏再降一档且不破坏状态新鲜度
- 层级：单点
- 父判据：O-SEAM-03、O-SEAM-11
- 强度：强
- 设计依据：需求 R-POWER-02「屏幕熄灭后再降一档：只保留心跳、命令应答与恢复所需的最小检查」；架构 §2.6；HLD 契约 C-03；LLD §3.6
- 触发与前置条件：档位从 background 变为 screen-off
- 可观测点：扩展命令环、状态环、快照环的间隔；心跳龄上限 `VPN_STATUS_FRESH_MS=15000`
- 期望：正常：命令环由 250 ms 变为 1000 ms，状态环由 2 s 变为 5 s，快照由 2 s 变为 15 s；边界：状态环 5 s 的三倍（15 s）不超过 `VPN_STATUS_FRESH_MS`，读取侧不因降频判 unknown；失败与恢复：`power.isActive()` 恢复为 true 时回到 background 档，间隔复原；安全与质量：隧道、网络重绑与停止请求的文件监听不降频。判定在宿主侧桩边界（定时器、`power.isActive` 为桩）下成立
- 失败信息：期望「熄屏降频且状态仍新鲜」，实际「降频后心跳超过 15 s，界面报 unknown」
- 来源：entry/src/main/ets/vpnextensionability/TailscaleVpnExtensionAbility.ets 的定时器常量；entry/src/main/ets/services/VpnPowerPolicy.ets；entry/src/main/ets/services/VpnStatusReader.ets 的新鲜度常量；scripts/test-vpn-power-policy.mjs
- 上游：R-POWER-02
- 测试：scripts/test-vpn-power-policy.mjs::screen off slows the extension cadence without breaking freshness
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-POWER-03 档位文件缺失或损坏时回落到 active
- 层级：单点
- 父判据：O-SEAM-03
- 强度：强
- 设计依据：需求 R-POWER-01、R-POWER-02；LLD §3.6 P7；设计增量 §2.5「档位文件缺失时按 active 处理」；HLD 契约 C-03
- 触发与前置条件：P2 读取 `filesDir/vpn-power-stage.json` 时，文件缺失、为空、不是合法 JSON，或 `stage` 不在词表内
- 可观测点：读取结果与定时器间隔；`vpn_power_stage_missing` 诊断事件
- 期望：正常：按 active 档处理，状态环 1 s、命令环 100 ms、快照 1 s；边界：档位文件写失败时 P2 保持上一档，不回落到最慢档；失败与恢复：下一轮重新读取，读到合法档位后切换；安全与质量：不得凭损坏文件降到最低档，使恢复与状态读取变慢。判定在宿主侧桩边界（fileIo 为内存文件系统）下成立
- 失败信息：期望「缺失或损坏回落到 active」，实际「文件坏了就降档，心跳变慢」
- 来源：entry/src/main/ets/services/VpnPowerPolicy.ets；scripts/test-vpn-power-policy.mjs
- 上游：R-POWER-01、R-POWER-02
- 测试：scripts/test-vpn-power-policy.mjs::a missing or corrupt stage file falls back to active
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核

### O-POWER-04 档位变化可观测
- 层级：单点
- 父判据：O-SEAM-11
- 强度：弱
- 设计依据：需求 R-POWER-01、R-POWER-02；架构 §2.6 横切约束 3；HLD 契约 C-03
- 触发与前置条件：档位按 active → background → screen-off → background → active 变化
- 可观测点：`vpn_power_stage_changed` 诊断事件；`vpn-power-stage.json` 的内容；写失败时的 `vpn_power_stage_write_failed`
- 期望：正常：每次档位变化写一条 `vpn_power_stage_changed`，含 from 与 to；边界：同一档位重复采样不写事件；失败与恢复：档位文件写失败记 `vpn_power_stage_write_failed`，下一次采样重试；安全与质量：事件只含档位名，不含屏幕内容、前台应用或用户活动。判定在宿主侧桩边界下成立
- 失败信息：期望「档位变化可查」，实际「降频发生了但诊断里没有任何记录，无法解释耗电与恢复延迟」
- 来源：entry/src/main/ets/services/VpnPowerPolicy.ets；scripts/test-vpn-power-policy.mjs
- 上游：R-POWER-01、R-POWER-02
- 测试：scripts/test-vpn-power-policy.mjs::stage changes are observable
- 状态：closed
- 不确定特征：none
- 归属：—
- 复核：待复核
