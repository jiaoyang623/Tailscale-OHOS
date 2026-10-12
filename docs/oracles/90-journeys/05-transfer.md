# 旅程判据 · 文件与文字传输（O-XFER-01 至 O-XFER-05）

### O-XFER-01 从传输页发送文件
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-XFER-01「只允许一个 Taildrop 出站传输；忙碌时给出提示而不是排队」、R-XFER-02「从 Transfer 页可选文件/图片发送，选择数量有上限」
- 触发与前置条件：已连接且 Taildrop 就绪（taildropState === 'ready'）；在传输页选中一个在线目标，点发送文件或发送图片。
- 可观测点：目标行、系统文档选择器 / 图片选择器、传输面板的排队与发送状态、忙碌提示文案 transfer_busy_message、传输历史记录
- 期望：正常：选中在线目标后弹出系统文档选择器（最多 TAILDROP_MAX_FILE_SELECTION=10 个）或图片选择器（最多 TAILDROP_MAX_MEDIA_SELECTION=100 个），选中后排队并顺序发送，传输面板展示聚合进度与当前文件名；边界：未连接或 Taildrop 未就绪时提示先连接，目标离线时提示目标不可用，选择数量被上限截断而不是全部发起；失败与恢复：已有出站传输在途时再次发送显示「忙碌」提示并拒绝，而不是排队第二个传输；选择失败或准备失败时关闭选择态并给出失败文案；安全与质量：发送前后端重新校验目标资格与暂存文件，不信任界面缓存的目标状态；真机走查已就绪的发送路径曾在 HarmonyOS 到 Windows 上完成 619,844 字节的实测发送并达到完成态。
- 失败信息：期望「同时只有一个出站传输、忙碌时提示、数量有上限」，实际「并发发起第二个传输，或超过上限未被截断」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:7870 ensureTaildropSendAvailable；:7880 忙碌提示；:7893 selectTaildropDocuments；:7902 与 :7923 选择上限；:7914 selectTaildropMedia；:181 TAILDROP_MAX_FILE_SELECTION；docs/taildrop-technical-plan.md:35 发送引擎与真机验证
- 上游：R-XFER-01、R-XFER-02
- 待建测试：[E2E] scripts/e2e/taildrop-send.mjs::从传输页向在线目标发送文件
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-XFER-02 发送文字并在接收端预览
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-XFER-03「可发送文字，接收端在预览中看到内容而不是落盘文件」
- 触发与前置条件：已连接且 Taildrop 就绪；选中在线目标后选择「发送文字」，输入非空文字。
- 可观测点：文字编辑器、发送后的传输记录、接收端文字预览视图（taildropReceivedText）、复制预览文本到剪贴板的动作
- 期望：正常：输入非空文字后发送，接收端进入文字预览态并显示内容，而不是把文字落盘为普通文件；边界：空白输入不发送；文字超过 TAILDROP_TEXT_CLIPBOARD_MAX_BYTES（1 MiB）时按实现上限处理，不静默截断或丢字；接收端已有文字预览在途时，新的预览请求按顺序排队而不是互相打断；失败与恢复：预览暂存失败时给出接收失败文案并复位接收态；接收繁忙时显示忙碌提示；安全与质量：接收端优先显示内容预览，用户可以复制预览文本，而不是只得到落盘文件。已知局限：接收端的文字预览与剪贴板落地路径从未在真机验证（docs/taildrop-technical-plan.md:41 标为 Missing validation）。
- 失败信息：期望「接收端在预览中看到文字内容」，实际「文字被直接落盘为文件，或空白输入也被发送」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:7946 sendTaildropText；:8081 startTaildropTextPreview；:8125 showCachedTaildropTextPreview；:189 TAILDROP_TEXT_CLIPBOARD_MAX_BYTES；docs/taildrop-technical-plan.md:77 文本按 1 MiB 上限进剪贴板
- 上游：R-XFER-03
- 待建测试：[E2E] scripts/e2e/taildrop-text.mjs::发送文字并在接收端预览
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-XFER-03 从设备详情走双通道发送
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-XFER-08「从设备详情发起传输时，双通道目标让用户显式选通道」、R-XFER-09「外部 LocalSend 应用按显式 Want 拉起；契约未定时不得猜测」
- 触发与前置条件：已登录并连接，从设备列表打开某对端详情并点「传输」；目标同时具备 MeshSend（Taildrop）与 LocalSend 两种通道时。
- 可观测点：传输方式选择面板（FileTransferMethodContent 的 tailsend / localsend 行）、按能力裁剪后的通道列表、外部 LocalSend 应用的拉起结果、失败提示 transfer_localsend_open_failed
- 期望：正常：目标双通道可用时先弹出通道选择，用户显式选择后按所选通道发起，所选通道被记住；边界：仅单通道可用时不弹选择、直接走该通道（仅 Taildrop 走 Taildrop 发送，仅 LocalSend 拉起外部应用），无任何可用通道时关闭详情并提示无目标；失败与恢复：外部 LocalSend 拉起失败（未安装或拒绝显式 ability）时给出失败提示，不静默失败；安全与质量：外部应用只按显式 Want（bundleName / moduleName / abilityName）拉起，不通过包名查询猜测目标，未确认 bundle 契约前不构造其它拉起方式。已知局限：外部 LocalSend 拉起依赖未定的官方 bundle/Want 契约（未决 Q4），且从未在真机验证。
- 失败信息：期望「双通道时由用户显式选通道、外部应用按显式 Want 拉起」，实际「未让用户选通道即自动发起，或凭猜测的包名拉起外部应用」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:5718 startFileTransferForPeer；:5725 双通道弹出 FileTransferMethodContent；:10172 FileTransferMethodContent；:5741 selectFileTransferTransport；:5799 launchLocalSendApp；:5802 显式 Want 构造；:5809 不做跨应用 bundle 查询的注释；:156 LOCAL_SEND_APP_TARGETS
- 上游：R-XFER-08、R-XFER-09
- 待建测试：[E2E] scripts/e2e/meshsend-dual-channel.mjs::双通道目标让用户显式选择传输方式
- 状态：pending-test
- 不确定特征：UNCERTAIN-WIRING
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-XFER-04 接收文件并按类型落地
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-XFER-05「接收方按内容类型分流：图片/视频存入照片，其它交给文件保存器；同名不同大小必须区分」、R-XFER-06「通知上的接收操作可直接完成保存，不必先进应用」、R-XFER-07「接收完成后才删除对端等待文件；未取走的文件保留到用户显式丢弃」
- 触发与前置条件：已连接且 Taildrop 就绪，对端发来文件；接收方在传输页的等待文件列表或系统通知上操作。
- 可观测点：等待文件列表、接收策略（media / file / text）、系统文件保存器与照片创建对话框、通知动作、显式丢弃确认对话框、接收态与失败文案
- 期望：正常：接收时按扩展名分类——图片/视频经照片创建对话框存入相册，文本进入预览/剪贴板，其它走文件保存器（selectTaildropReceiveDestination）；等待文件以「名称 + 大小」配对，同名不同大小视为不同文件；通知上的接收动作被解析并触发与传输页相同的保存路径，用户无需先进应用再手动点保存；边界：未知扩展名走文件保存器；接收策略在途时新的等待文件先复位并顺序处理；失败与恢复：只有导出成功后才删除对端等待文件（DeleteWaitingFile），未取走的等待文件保留到用户在确认对话框里显式丢弃；接收失败给出失败文案并复位接收态，不误删等待文件；安全与质量：等待文件名按 basename 清洗，不接收绝对路径或路径分隔符；接收请求经原子写文件发布，过期请求不得被接受。已知局限：接收与导出路径、通知入口从未在真机验证（docs/taildrop-technical-plan.md:41 标为 Missing validation）。
- 失败信息：期望「按类型分流落地、导出成功后才删除对端等待文件」，实际「先删对端等待文件再导出导致丢文件，或按错误类型落地」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:8183 routeTaildropReceive；:8196 selectTaildropReceiveDestination；:8321 confirmDiscardTaildropFile；:1591 onTaildropOpenInbox；:1597 onTaildropNotificationAction；:1630 saveTaildropFileFromNotification；docs/taildrop-technical-plan.md:40 按类型接收与导出后才删
- 上游：R-XFER-05、R-XFER-06、R-XFER-07
- 待建测试：[E2E] scripts/e2e/taildrop-receive.mjs::接收文件按类型落地并只在成功后删除等待文件
- 状态：pending-test
- 不确定特征：UNCERTAIN-PLATFORM
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-XFER-05 传输的取消、重试与历史上限
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-XFER-04「发送过程显示进度、速度与预计剩余时间，可取消、可重试」、R-XFER-10「Taildrop 历史有上限，超出后淘汰最旧」
- 触发与前置条件：传输处于 queued/sending 态或已有失败记录时，在传输面板上操作取消或重试；历史达到上限后新增记录。
- 可观测点：传输面板的进度、平滑速度与预计剩余时间、取消动作与取消态、失败记录的重试动作、传输历史的条数与顺序
- 期望：正常：发送中显示聚合字节进度、平滑速度与 ETA，可发起取消；取消经原子写取消请求（taildrop-cancel-request.json）并进入取消态；失败的发送记录可对同一在线目标重试；边界：不在 queued/sending 态或取消在途时取消为无操作；非发送或非失败记录不可重试，目标离线时提示目标不可用；历史超过 TAILDROP_HISTORY_LIMIT（代码为 10 条）时淘汰最旧，只保留最新上限条；失败与恢复：取消请求写失败时给出取消失败文案，不清掉进行中的传输；重试重新打开内容选择而不是复用可能已失效的暂存；安全与质量：历史按上限裁剪后原子持久化，重启恢复时同样裁剪，不会无界增长。已知冲突：docs/taildrop-technical-plan.md:37 记「bounded 20-record」，代码 TAILDROP_HISTORY_LIMIT 为 10，二者不一致。
- 失败信息：期望「可取消可重试且历史有上限」，实际「取消无响应，或历史无界增长」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:8032 cancelTaildropSend；:8047 retryTaildropSend；:180 TAILDROP_HISTORY_LIMIT；:3804 历史裁剪；:7501 恢复历史时按上限裁剪；docs/taildrop-technical-plan.md:36 进度/速度/ETA/取消
- 上游：R-XFER-04、R-XFER-10
- 待建测试：[E2E] scripts/e2e/taildrop-history.mjs::取消重试与历史上限
- 状态：pending-test
- 不确定特征：UNCERTAIN-CONFLICT
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
