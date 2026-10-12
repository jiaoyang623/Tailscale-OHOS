# MeshArc 旅程判据 · 媒体区（媒体探测 / 串流）

本文件覆盖「媒体」区的两条旅程：探测媒体服务并交给 HosPlayer，以及经 Sunshine/Moonlight 串流。

### O-MEDIA-01 探测媒体服务并交给 HosPlayer
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-MEDIA-01「设备详情可探测 Jellyfin/Emby/Plex，并说明探测不到的原因」、R-MEDIA-02「交给 HosPlayer 时只传类型、端点与名称，凭据由播放器自己收集」、R-MEDIA-03「未识别的服务地址或非法名称必须拒绝，不得拼进深链」
- 触发与前置条件：已登录、已连接，用户对某个在线且地址非空的设备执行媒体服务探测；或在诊断里运行媒体服务离线自检
- 可观测点：设备详情媒体行的状态文案、HosPlayer 导入深链（`hosplayer://server/import?...`）、拉起结果、媒体服务离线自检的 `PASS` 文案、诊断事件 `media_probe_*` 与 `hosplayer_launch_*`
- 期望：正常：对在线对端探测 `8096/8920/32400` 三类端点，识别到 Jellyfin/Emby/Plex 后显示「Found: <名称>」；用户选择交给 HosPlayer 时应用生成只含 `protocolVersion`、`type`、`endpoint`、`name` 四个字段的深链并拉起播放器，凭据由播放器自取。边界：真机走查 M-09 覆盖的是离线自检——设置 > 关于 > 连点版本号 5 次解锁诊断 > 运行媒体服务离线自检，命中文案「PASS · 媒体服务识别 4/4 · HosPlayer 参数协议通过」，其中 4/4 取自仓库内置的 Jellyfin、Emby、Plex 与非媒体 HTTP 样本，不访问网络、也不真正拉起 HosPlayer；深链自检另断言 URI 不含 `password` 与 `token`。失败与恢复：探测不到时按不可用/超时/失败三态给出可读原因，不显示空列表；未连接或设备离线时提示先连接，而不是发起探测。安全与质量：深链不含用户名、密码或 token；地址须为 http(s)、长度 ≤ 2048、不含 userinfo 与 fragment，否则以 `unsafe_server_url` 拒绝；名称为空或超过 96 字符以 `invalid_server_name` 拒绝，拒绝时不拼接深链。
- 失败信息：期望「探测不到时说明原因，且交给播放器的参数不含任何凭据」，实际「显示空列表，或深链中出现地址白名单外的端点或凭据」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:6146 detectMediaForPeer；:6190-6194 探测诊断事件；:4623 openMediaMethodForPeer；:6401 openHosPlayer；:6412-6417 请求字段；:6456 runMediaIntegrationSelfTest；:6471-6475 自检文案；:10095 MediaMethodContent；entry/src/main/ets/services/HosPlayerLauncher.ets:12-15 契约；:64-77 validate；:39-55 runOfflineSelfTest；entry/src/main/ets/services/MediaServiceProbeService.ets:61-83 probe；:163-169 parseType；:179-183 safeServerUrl；entry/src/main/ets/components/DeviceConnectionInfoPanel.ets:44-61 状态文案；docs/hosplayer-integration-prototype.md:44-59
- 上游：R-MEDIA-01、R-MEDIA-02、R-MEDIA-03
- 测试：真机走查 a01-baseline/manual-checks.md#M-09
- 状态：closed
- 不确定特征：UNCERTAIN-CONFLICT
- 归属：—
- 复核：待复核

### O-MEDIA-02 经 Sunshine/Moonlight 串流
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-MEDIA-04「检测到 Sunshine 且路径为 DERP 时先向用户确认再串流」、R-MEDIA-05「未安装 MoonlightOH 时明确告知，并允许复制主机地址」
- 触发与前置条件：已登录、已连接，用户在设备详情对某个在线设备点「远程串流」，且该设备被判定为 Sunshine 候选
- 可观测点：串流行的 checking/available/timeout/unavailable 文案、DERP 确认弹窗、MoonlightOH 缺失弹窗与「复制主机地址」动作、诊断事件 `sunshine_probe_*` 与 `moonlight_launch_*`
- 期望：正常：发起 Sunshine 探测（最多等待 5 s），探测到 `available` 且路径可达时进入拉起；路径为直连或 peerRelay 时按档位拉起 MoonlightOH。边界：路径为 DERP 时先弹确认框，给出「使用兼容配置」（relay_safe：5000 kbps / 1280×720 / 60）与「使用原有配置」两个选择；探测超时提示检查目标电脑防火墙或网络状态；未检测到 Sunshine 提示确认电脑已启动 Sunshine。失败与恢复：探测失败或当前无法访问目标设备时给出对应提示并复位 launching 态；拉起失败记 `moonlight_launch_failed` 并提示稍后重试。安全与质量：传给 MoonlightOH 的 Want 只含 host、displayName、dnsName、pathType、relayRegion、latencyMs 与串流档位，不含任何凭据。已知局限：树内 `MOONLIGHT_INTEGRATION_CONFIG` 的 bundleName/abilityName/moduleName 三个字段为空，`MoonlightLauncher.isAvailable()` 恒返回 false，故真机目前只能走到「未安装 MoonlightOH」分支，串流成功路径当前不可观测。
- 失败信息：期望「DERP 路径先确认、缺播放器时明确告知并可复制主机地址」，实际「不经确认直接串流，或缺失播放器时静默失败」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:6266 launchRemoteStream；:6291 5 s 探测上限；:6304 completeStreamLaunch；:6316 DERP 分支；:6323 showDerpStreamConfirmation；:6333 openMoonlight；:6344 未安装分支；entry/src/main/ets/services/MoonlightLauncher.ets:12-24 isAvailable；:26-50 launch；entry/src/main/ets/services/MoonlightIntegrationConfig.ets:10-15；entry/src/main/ets/services/StreamProfileBuilder.ets:3-37；entry/src/main/ets/services/SunshineProbeService.ets:47 probe
- 上游：R-MEDIA-04、R-MEDIA-05
- 待建测试：[E2E] scripts/e2e/media-launch.mjs::经 Sunshine/Moonlight 串流
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
