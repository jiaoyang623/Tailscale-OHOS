# MeshArc 旅程判据 · 文件区（Taildrive 共享目录）

本文件覆盖「文件」区的两条旅程：浏览并操作 Taildrive 共享目录，以及从设备详情跳转到该设备的共享目录。

### O-DRIVE-01 浏览并操作 Taildrive 共享目录
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-DRIVE-01「未连接时 Files 页不给可操作入口」、R-DRIVE-02「可浏览共享目录、沿面包屑上溯、用系统返回键上一级；根目录允许退出应用」、R-DRIVE-03「支持上传、下载、新建文件夹、改名、移动、删除，操作有进度与结果反馈」、R-DRIVE-04「上传默认不覆盖，冲突要用户显式确认」、R-DRIVE-05「传输暂存 24 小时后清理，残留不无限增长」
- 触发与前置条件：已登录、已连接（VPN 状态含 `state=Running`），用户进入「文件」页并选中一个 tailnet 设备的共享目录
- 可观测点：TaildriveBrowser 的列表/网格视图与面包屑、多选计数、上传与下载的进行中状态和结束反馈、覆盖冲突确认弹窗、以及暂存目录随时间的清理结果
- 期望：正常：列出共享根目录，可沿面包屑上溯与下钻或系统返回键上一级；上传、下载、新建文件夹、改名、移动、删除都给出进行中状态与结束反馈（成功或失败原因）；多选后批量操作作用于所选条目。边界：未连接时列表置灰并显示「先连接 MeshArc」，不给任何可操作入口；根目录下系统返回键不放行到浏览器内部；目标同名且未要求覆盖时先弹覆盖确认（取消/替换），默认不覆盖。失败与恢复：查询、变更、传输各有独立超时（查询 32 s、变更 35 s、传输 30 min+10 s），扩展未应答或超时时以失败态返回并可重试，不残留半写状态。安全与质量：远程访问统一经 TaildriveGateway 的四条 IPC 通道串行化并由 VPN 扩展发起，应用侧只持暂存副本；暂存目录超过 24 h 由打开时的清理删除，不无限增长。
- 失败信息：期望「未连接时无可操作入口，上传同名文件默认不覆盖且须显式确认」，实际「未连接仍出现可点击入口，或同名文件被静默覆盖」
- 来源：entry/src/main/ets/components/TaildriveBrowser.ets:191 aboutToAppear；:193 cleanupStaleStaging；:2297 breadcrumbText；:1100 executeUpload；:1129 already_exists 分支；:1148 promptUploadOverwrite；:666 blockProtectedFolderContent；entry/src/main/ets/services/TaildriveGateway.ets:4-11 八个 IPC 文件；:14-17 通道超时；:155-157 requestThroughVpnExtension；:312 cleanupStaleStaging 默认 24 h；entry/src/main/ets/components/BridgeStatus.ets:13815 FilesContent；:13821 connected 门控
- 上游：R-DRIVE-01、R-DRIVE-02、R-DRIVE-03、R-DRIVE-04、R-DRIVE-05
- 待建测试：[E2E] scripts/e2e/taildrive-browser.mjs::浏览共享目录并完成上传与下载
- 待建测试：[真机] 真机走查 a01-baseline/manual-checks.md#M-15（Taildrive 真机共享节点）
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-DRIVE-02 从设备详情跳转到该设备的共享目录
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-DRIVE-06「从设备详情可直接跳到该设备的共享目录」
- 触发与前置条件：已连接，用户在设备详情面板点「远程文件」动作行
- 可观测点：设备详情是否收起、是否切到「文件」页、TaildriveBrowser 的目标机器名与列表是否刷新为所点设备
- 期望：正常：点击后设备详情收起，页签切到「文件」（index 2），TaildriveBrowser 以该 peer 的机器名为目标打开其共享根。边界：该动作行只在已连接时可用；目标打开请求带 targetRequestId 与 targetMachineName，重复点同一设备不重复发起。失败与恢复：未连接或 peer 离线时该入口不可用，不进入一个空目录。安全与质量：跳转只传机器名，不携带凭据或路径白名单外的内容。
- 失败信息：期望「点击后直接进入该设备的共享目录」，实际「停留在设备详情，或进入与所点设备不符的目录」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5688 openRemoteFilesFromDevice；:5692 navigateToTab(2)；:9988 remoteFilesEnabled=isConnected()；:9991 onOpenRemoteFiles；entry/src/main/ets/components/TaildriveBrowser.ets:403 requestTargetMachineOpen；:404 目标请求去重
- 上游：R-DRIVE-06
- 待建测试：[E2E] scripts/e2e/taildrive-browser.mjs::从设备详情跳转到该设备共享目录
- 待建测试：[真机] 真机走查 a01-baseline/manual-checks.md#M-15（Taildrive 真机共享节点）
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
