# MeshArc 旅程判据 · 应用外壳区（页签导航 / 双语主题 / 桌面卡片）

本文件覆盖「应用外壳」区的三条旅程：页签导航与显隐排序、中英双语与深浅主题、桌面卡片开关 VPN。

### O-UI-01 页签导航与显隐排序
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-UI-01「四个顶层页签（主页/传输/文件/设置），窄屏悬浮底栏、宽屏侧栏」、R-UI-02「页签可显隐与排序，且重启后保持」
- 触发与前置条件：应用进入主界面；用户在设置 > 外观里调整页签显隐或顺序
- 可观测点：窄屏的悬浮底栏与宽屏的侧栏、页签图标与标签、设置里的显隐开关与顺序项、重启后的页签排列
- 期望：正常：四个顶层页签为主页/传输/文件/设置；窄屏用悬浮底栏（底部、悬浮、两侧留边），宽屏改用侧栏。边界：设置页签为永久主要目的地，不可隐藏；隐藏到只剩 1 个时提示「至少保留一个」，并拒绝该次隐藏；顺序与显隐写入导航偏好，重启后保持不变。失败与恢复：偏好读取失败时回落默认顺序（主页/传输/文件/设置）且全部可见。安全与质量：非法或重复的页签标识在归一化时被过滤，隐藏列表不会吞掉主页与设置。
- 失败信息：期望「显隐与排序在重启后保持，且设置页签始终可见」，实际「重启后回到默认顺序，或设置页签被隐藏」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:14609 MobileTabs；:14640 barFloatingStyle；:14862 WideTabs；:10889 setNavigationTabVisible；:10900-10903 至少保留一个；:10914 moveNavigationTab；entry/src/main/ets/services/NavigationPreferences.ets:22-52 load/save；:54-76 normalize
- 上游：R-UI-01、R-UI-02
- 待建测试：[E2E] scripts/e2e/navigation-shell.mjs::页签导航与显隐排序
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-UI-02 中英双语与深浅主题
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-UI-03「英文与中文界面都完整可用；界面改动必须同时维护两份资源」、R-UI-04「浅色与深色主题下都可读」
- 触发与前置条件：系统语言切换为中文或英文；系统深浅色切换为浅色或深色
- 可观测点：界面文案、两份字符串资源文件、深色资源文件与界面实际取色
- 期望：正常：英文与中文界面都完整可用，浅色与深色主题下文字与状态色都可读；颜色多数取自系统语义色（`sys.color.*`），需要定制的状态色由深色资源覆盖。边界：本次静态比对两份字符串资源的 key 集合一致（各 657 键，无差集），但 key 一致不等于取值已被正确翻译——取值质量与真机渲染尚未验证（对应需求表未决 Q5）。失败与恢复：某键缺失时界面回落而非崩坏。安全与质量：界面改动须同时维护两份资源（贡献指南第 3 条）；深色下不得出现前景与背景同色导致不可读。
- 失败信息：期望「切换语言与主题后界面都完整可读」，实际「某一语言下出现裸键或英文残留，或深色下文字与背景同色不可读」
- 来源：entry/src/main/resources/base/element/string.json；entry/src/main/resources/zh_CN/element/string.json；entry/src/main/resources/dark/element/color.json；CONTRIBUTING.md 第 3 条；entry/src/main/ets/components/BridgeStatus.ets:14622-14627 页签取色
- 上游：R-UI-03、R-UI-04
- 待建测试：[E2E] scripts/e2e/navigation-shell.mjs::中英双语与深浅主题
- 状态：pending-test
- 不确定特征：UNCERTAIN-VALUE
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-CARD-01 桌面卡片开关 VPN
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：弱
- 设计依据：需求 R-UI-05「桌面卡片可开关 VPN，卡片状态与应用一致」
- 触发与前置条件：用户长按应用图标 > 卡片 > 添加 2×2 卡片到桌面；已登录且已配置控制服务器
- 可观测点：卡片上的状态文案与操作文案、卡片进程、应用进程收到卡片 `call` 后的连接/断开结果、卡片是否随状态更新
- 期望：正常：卡片显示当前 VPN 状态与操作文案，点击后经 `call` 动作在后台唤醒应用外壳的 `toggleVpn` 处理，由无 UI 会话控制器执行连接或断开，随后把新状态推回卡片；按钮先乐观翻到「处理中」文案。边界：卡片进程在最后一次生命周期回调后约 10 s 被系统回收，且不得导入后台任务模块，故卡片只能靠自身周期刷新（每 30 min 一次）自纠；应用进程存活时由边沿触发的推送更新。失败与恢复：需要用户介入时（未登录或未配置控制服务器）抬起窗口而不是静默失败；桌面无卡片时刷新返回 0 属正常态。安全与质量：卡片只渲染 provider 供给的字符串（本地化在 provider 侧完成），不导入任何模块、不含图片、不设透明度，避免一张卡片异常导致全部卡片白屏。已知局限：卡片渲染与点击路径从未在真机执行（走查 M-12 未执行，卡片设计文档的验证状态亦如此声明）。
- 失败信息：期望「点卡片即可在不打开应用的情况下切换 VPN 并回写状态」，实际「卡片空白或不刷新，或点击后状态未变」
- 来源：entry/src/main/ets/entryformability/EntryFormAbility.ets:10-17 进程回收与不可导入后台任务模块；:19-30 onAddForm/onUpdateForm；entry/src/main/ets/widget/pages/VpnToggleCard.ets:45-54 postCardAction；entry/src/main/ets/entryability/EntryAbility.ets:99 callee.on；:191 toggleVpnFromCard；:202 performCardToggle；:219-223 结果回写；:229 raiseWindow；entry/src/main/ets/services/FormCardService.ets:28 buildBindingData；:47 refreshAll；:85 stateName；entry/src/main/ets/services/VpnSessionController.ets:80 connect；:118 disconnect；:150 answerBackendHandoff；entry/src/main/resources/base/profile/form_config.json:16 updateDuration；docs/home-screen-card.md:51-67 刷新时效；:95-104 验证状态
- 上游：R-UI-05
- 待建测试：[E2E] scripts/e2e/navigation-shell.mjs::桌面卡片开关 VPN
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
