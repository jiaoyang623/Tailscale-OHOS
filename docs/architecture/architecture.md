# MeshArc 架构设计

- 流程版本：a01 · 层：架构 · 代码基线：`7ecf03f`（分支 `local-build`）
- 上层输入：`docs/requirements/requirements.md`（73 条需求、31 个旅程判据 ID）
- 事实来源：生产代码（逐条给 `file:line`）、`README.md`、`CONTRIBUTING.md`、`STATUS.md`、
  `docs/background-vpn-reliability.md`、`docs/vpn-network-recovery.md`、`docs/home-screen-card.md`、
  `docs/taildrop-technical-plan.md`、`scripts/*`、`docs/changes/a01-baseline/record.md`
- 判据落点：旅程判据 `docs/oracles/90-journeys/`、接缝判据 `docs/oracles/91-seams/`（均**待建**，本层只给候选接缝）
- 本层不做的：不新增需求、不改行为、不给 HLD 级接口契约（字段级契约留给 HLD 的「接口与事件契约」）

**引用可信度声明**：`record.md` 未决项 Q5 指出多份设计文档与代码不一致。本文所有架构论断一律以
生产代码为准，文档只用于解释动机；两者冲突处标为未决项（§六 Q-03）。

---

## 一、上层需求与架构驱动

原则：只列**决定全系统取舍**的需求。判据是「换一个选择，会有多个子系统同时改」。

| 需求 ID | 它决定了什么 | 架构上的后果 |
| --- | --- | --- |
| R-CONN-03、R-CONN-04 | 连接窗口期与后台存活——**谁**在无人应答时活着 | 逼出「长生命周期服务端只能放在扩展进程」以及「UI 进程必须持有长时任务」这两个前提。整个三进程分权由此而来（`services/VpnBackgroundTaskManager.ets:171`、`:182`；`vpnextensionability/TailscaleVpnExtensionAbility.ets:645`） |
| R-CONN-08、R-UI-05 | 无 UI 入口（卡片、后台恢复）必须能独立完成连接并应答交接 | 逼出第二条连接编排 `VpnSessionController`（`services/VpnSessionController.ets:53-63`）与卡片/应用间契约（`services/FormCardService.ets`、`entryability/EntryAbility.ets:191`） |
| R-CONN-05、R-CONN-06 | 自动恢复 vs 用户意图 | 逼出「意图必须被显式记录」：`VpnReconnectSupervisor.noteRequestedStop`（`services/VpnReconnectSupervisor.ets:62`）与窄触发条件（`:114`、`:119`） |
| R-CONN-07 | 平台单 VPN 限制 | 逼出「替换必须经用户批准」的跨进程命令文件与 TTL：`vpn-replace-approved`（`vpnextensionability/TailscaleVpnExtensionAbility.ets:27-28`，消费于 `consumeVpnReplaceApproval:732`、`replaceExistingVpn:610`）。**但本基线在仓库内找不到写方**，实际生效的是「提示用户先断开其它 VPN」：`BridgeStatus.showVpnConflictDialog:4316` —— 见 §六 Q-02 |
| R-CONN-09、R-CONN-10 | 状态缺失/陈旧按不确定处理；用户取消后不得自行恢复 | 逼出「心跳新鲜度 + 有界宽限」的统一判读口径（`services/VpnBackgroundTaskManager.ets:14-15`；`services/VpnStatusReader.ets:7`） |
| R-NET-03 | 网络承载切换后同会话重绑 | 逼出网络监听**必须在扩展进程**：只有它持有 TUN 与套接字，且只有它能调 `backendNetworkChangedAsync`（`services/VpnNetworkMonitor.ets:164`；`entry/src/main/cpp/types/libtailscale_ohos/index.d.ts:9`） |
| R-DIAG-02、R-NET-04 | 脱敏是系统级约束，不是某个模块的属性 | 逼出「所有跨进程落盘文本必须过同一个边界」：`DiagnosticPrivacy`（`services/DiagnosticPrivacy.ets:47-55`）被 `DiagnosticEventStore` 与 hilog 共同依赖（`entryability/EntryAbility.ets:20`、`:88-91`） |
| R-DIAG-05 | 关键链路留下可复核事件 | 逼出「诊断按进程分文件、由两侧共同写」的归属：`diagnostic-ui-events.ndjson` / `diagnostic-vpn-events.ndjson`（`services/DiagnosticEventStore.ets:5-6`、`:45`） |
| R-PRIV-01…04 | 锁在切后台后仍然有效 | 逼出「锁状态归 UI 进程，且以前台事件为重新认证触发点」（`services/AppSecurityPreferences.ets:10`、`components/TaildriveBrowser.ets:315`） |
| R-XFER-07 | 只有接收方确认后才删除对端等待文件 | 逼出「等待文件归引擎侧，删除指令必须跨进程下发」（`components/BridgeStatus.ets:8205`、`:8228`） |
| R-XFER-05、R-XFER-06 | 接收按内容类型分流，通知上可直接完成保存 | 逼出「接收编排在 UI 进程（需要 picker 与媒体库权限），而下载归扩展进程」 |
| R-UI-03、R-UI-04 | 双语与深色是**交付**约束 | 逼出「任何子系统的用户可见串都必须进资源表」（`entry/src/main/resources/base|zh_CN|dark`；`CONTRIBUTING.md` 第 3 条） |
| R-SETUP-05 | 配置损坏必须回落而不是崩溃 | 逼出全仓统一的落盘方式：`.tmp` + rename（`services/ControlServerConfig.ets:71-`） |

**技术约束（不可选）**

- 目标 HarmonyOS 6.1 / API 23、arm64，手机 / 平板 / 2in1（`entry/src/main/module.json5:7-11`、
  `build-profile.json5` 的 `compatibleSdkVersion: 6.1.0(23)`）。
- 引擎固定 Tailscale 1.86.5 + OpenHarmony Go 1.24（`README.md:26`、`scripts/build-go.sh:2`）。
- 一个设备同时只能有一个系统 VPN（`README.md:30`）。
- Form 卡片进程**不允许常驻**，且 `backgroundTaskManager` 在该进程不可导入
  （`docs/home-screen-card.md`「State freshness, and its hard limit」）。
- 扩展进程不能被 UI 直接调用方法，UI 进程也不能被扩展直接调用；两进程之间只有文件系统。

**非功能驱动（只在有方案或已确认风险时才算被覆盖）**

| 质量场景 | 架构方案落点 | 覆盖状态 |
| --- | --- | --- |
| 锁屏静置 ≥ 720 s 存活 | 扩展进程常驻 + UI 进程长时任务 | 有实测（`docs/background-vpn-reliability.md` M-01），蜂窝版未完成 |
| 连接窗口不漏接交接 | 连接窗口纳入 live 判据 + 双路径应答 | 逻辑闭环（单元），**真机未复跑** |
| 网络切换同会话恢复 | 扩展内 `VpnNetworkMonitor` | 有实测 11 ms |
| 诊断不含凭据 | `DiagnosticPrivacy` 边界 | 有单元；**无端到端验证** |
| 双语 key 一致 | 资源表 | **未验证**（§六 Q-05） |

---

## 二、系统上下文与子系统

### 2.1 外部参与者与边界

```
                  ┌─────────────────── 系统边界（MeshArc，bundle ren.w2h.mesharc）───────────────────┐
                  │                                                                                  │
 用户 ──触屏/卡片─▶│  [P1 UI 进程]  EntryAbility + BridgeStatus(15,149 行) + 组件                │
                  │        │  ▲                                                                    │
                  │        │  │ callee 'toggleVpn' / formProvider.updateForm                        │
 卡片宿主(系统) ────▶│  [P3 Form 进程] EntryFormAbility + FormCardService   （~10 s 即回收）        │
                  │        │                                                                        │
                  │        │  文件协议（filesDir 下的一组 JSON/txt，见 §2.3）                        │
                  │        ▼                                                                        │
                  │  [P2 VPN 扩展进程] TailscaleVpnExtensionAbility(2,010 行) + VpnNetworkMonitor   │
                  │        │  ── 唯一的长生命周期「服务端」                                          │
                  └────────┼────────────────────────────────────────────────────────────────────────┘
                           │  N-API
 系统 VPN 框架 ──TUN fd──▶ │  libtailscale_ohos.so ──▶ libtailscale_go.so（Tailscale 1.86.5, c-shared）
 系统网络管理 ──默认网络─▶ │        （P1 与 P2 各自加载一份）
 系统认证/Biometric ──▶ [P1]
 系统浏览器 ──登录页──▶  tailnet 控制平面（远端，本项目只是客户端）
 外部应用(HosPlayer/MoonlightOH/LocalSend/文件选择器) ◀──深链/Want── [P1]
```

**边界定义**：MeshArc 是一个 HAP，包含 **三个进程**（UI / VPN 扩展 / Form）与 **两个本地库**
（`libtailscale_ohos.so` 是 N-API 胶水，`libtailscale_go.so` 是引擎）。控制平面、tailnet 内其它设备、
外部播放器与 LocalSend 都在边界外，只通过 Want/深链/HTTP(S) 交互。

**UI 进程是唯一有界面、且唯一能做「需要用户在场」的动作的进程**：登录（拉起系统浏览器
`components/BridgeStatus.ets:2052`）、控制服务器确认（`:1671`）、替换 VPN 批准（`:605` 对应的应答侧）、
文件选择器与媒体库保存（`:8183`、`:8196`）、系统认证（`services/AppSecurityAuthenticator.ets`）。

### 2.2 子系统、职责与允许依赖

| 编号 | 子系统 | 所在进程 | 职责 | 允许依赖 |
| --- | --- | --- | --- | --- |
| S1 | **界面外壳** `entryability/EntryAbility.ets`、`components/BridgeStatus.ets`、`components/*`、`pages/Index.ets` | P1 | 导航与四页签（`:14609`/`:14862`）、状态呈现、需要用户在场的动作、应用锁覆盖层（`:14957`） | S5、S6、S7、S8、S10；**禁止**直接写扩展私有的状态机 |
| S2 | **无 UI 控制面** `services/VpnSessionController.ets`、`services/VpnReconnectSupervisor.ets`、`services/VpnBackgroundTaskManager.ets`、`EntryAbility` 的 callee | P1 | 卡片/后台恢复的独立连接与断开；掉线自动恢复；长时任务持有与释放 | S4、S5、S6、S8 |
| S3 | **VPN 扩展** `vpnextensionability/TailscaleVpnExtensionAbility.ets`、`services/VpnNetworkMonitor.ets` | P2 | 创建/销毁 TUN；驱动引擎（启动、重绑、快照、探测转发）；发布状态与对端快照；承载 Taildrop/Taildrive 的引擎侧 | S4、S6、S7、S8 |
| S4 | **引擎边界** `entry/src/main/cpp/napi_init.cpp` → `libtailscale_ohos.so` → `libtailscale_go.so`，声明于 `entry/src/main/cpp/types/libtailscale_ohos/index.d.ts`（46 条 `export const`） | P1 与 P2 **各一份** | 把 Go 引擎的能力暴露成 ArkTS 可调函数；把 TUN fd 交给引擎 | 无（叶子） |
| S5 | **跨进程文件协议**（无独立代码文件，由 S1/S2/S3 的收发两端共同实现，文件名见 §2.3） | 横跨 P1/P2 | 请求-应答与状态发布；「清响应 → 写请求 → 轮询响应」握手；`requestId` 匹配 | S6 |
| S6 | **持久化与状态** `services/ControlServerConfig.ets`、`StoragePaths.ets`、`RecoverableCachePaths.ets`、`*Preferences.ets`、`services/DiagnosticEventStore.ets` | P1/P2/P3 | 见 §2.4 数据归属 | 无（叶子） |
| S7 | **卡片** `entryformability/EntryFormAbility.ets`、`services/FormCardService.ets`、`widget/pages/VpnToggleCard.ets` | P3 | 只读状态文件渲染卡片；把点击转成对 P1 的 `call` | **只允许** `VpnStatusReader`（读 `vpn-probe-status.txt`）与 `FormCardService` |
| S8 | **横切策略** `services/DiagnosticPrivacy.ets`、`services/DiagnosticReportService.ets`、`services/HosPlayerLauncher.ets`、`*RequestGuard`、hilog(domain `0x0000`) | 全部 | 脱敏、报告导出、深链参数校验、陈旧异步结果的世代守卫 | 无（被依赖） |
| S9 | **构建与交付** `scripts/build.sh`(macOS)/`build.ps1`(Windows)、`scripts/build-go.sh`、`scripts/verify-artifacts.ps1` | 构建机 | 交叉编译引擎 → 装配 HAP → 签名 → 产物校验 | 不在运行期 |

**依赖方向规则（必须成立，否则 §五 的接缝就出现责任空洞）**

1. `S1 → S5 → S3`：UI 请求扩展，只经文件；**没有** S1 直接调 S3 方法的路径。
2. `S3 → S5 → S1`：扩展只能请求，不能命令。设计上唯一「必须由人回答」的反向命令是替换 VPN 批准
   （S1 写 `vpn-replace-approved` → S3 读），但**本基线在仓库内没有写出该文件的入口**，因此这条反向通道
   实际不可达（§六 Q-02）；真正在跑的是「UI 提示用户先手动断开其它 VPN」。
3. `S7 → S6/S8` 之外**无依赖**：卡片不导入 `backgroundTaskManager`、不导入原生桥
   （`docs/home-screen-card.md`；`services/VpnStatusReader.ets` 头注「Deliberately free of the native bridge」）。
4. `S4` 可被 S1/S2/S3 依赖，但**不得**被 S7 依赖。

### 2.3 子系统间的通信方式（S5 的实际形态）

**全部为文件**，位于 `context.filesDir`（`StoragePaths.ets:6-7` 说明该目录跨能力共享）。握手口径：

> 发起方先清空响应文件 → 写请求（`requestId = Date.now()`）→ 轮询响应直到 `response.requestId === requestId`
> 或超时。示例：`vpnextensionability/TailscaleVpnExtensionAbility.ets:648-671`（扩展侧发问）；
> `services/VpnSessionController.ets:126-139`、`:228-239`（进程侧作答）。

| 类别 | 文件 | 谁写 | 谁读 | 节拍/超时 |
| --- | --- | --- | --- | --- |
| VPN 生命周期 | `vpn-connect-config.json` | P1（`VpnCommandGateway.stageConnectConfig:127`） | P2（`readConnectConfig`） | TTL 15 s（扩展 `:62`） |
| | `vpn-stop-request.json` / `vpn-stop-response.json` | P1 写请求，P2 写响应 | 互读 | 50 ms × 150（`VpnSessionController.ets:20-21`） |
| | `vpn-backend-handoff-request.json` / `-response.json` | P2 写请求，P1 写响应 | 互读 | 100 ms × 150 = **15 s**（扩展 `:31-32`）；应答侧轮询 250 ms × 60（`VpnSessionController.ets:29-30`） |
| | `vpn-replace-approved` | **仓库内无写方**（仅扩展读：`consumeVpnReplaceApproval:732`） | P2 | 读侧 TTL 10 s，200 ms 轮询等待（扩展 `:24`、`:28`、`:741`） |
| 状态/心跳 | `vpn-probe-status.txt` | P2，每 **1 s**（`:905`、`:951`） | P1 全部读方、P3 | 新鲜度 15 s，只在 `VpnStatusReader.ets:12` 定义一次；`BridgeStatus` 借用同一个常量，不再自带门限 |
| 对端快照 | `vpn-peers.json` | P2，随 1 s 快照（`:1005`） | P1 | 新鲜度 5 s（`BridgeStatus.ets:3606` 的比较；`requirements.md` 边界场景）。这与状态文件的 15 s 是两个不同的文件，不是两个口径 |
| | `vpn-config-summary.txt`、`vpn-peer-probe-status.txt` | P2 | P1 | 随心跳 |
| Taildrop | `taildrop-send-request.json`、`taildrop-cancel-request.json`、`taildrop-receive-request/-response.json`、`taildrop-targets.json`、`taildrop-inbox-snapshot.json` | 双向 | 双向 | 请求环 **100 ms**（`:884-897`）；接收环 **250 ms**（`:901-903`） |
| Taildrive | `taildrive-query-*`、`taildrive-transfer-*`、`taildrive-manual-transfer-*`、`taildrive-control-*` | P1 请求 / P2 应答 | 双向 | 单请求超时 32 s / 35 s / 30 min+10 s / 5 s（`services/TaildriveGateway.ets:14-17`） |
| 探测 | `peer-connectivity-*`、`sunshine-probe-*`、`media-service-probe-*`、`localsend-refresh-*` | P1 请求 / P2 应答 | 双向 | 挂在 1 s 快照环内（`:928-931`） |

**写方式**：快照类一律原子写（扩展 `writeAtomicTextFile`，见 `:996`、`:1006`）；握手类的请求/响应是
小文本，先清后写（`VpnSessionController.ets:127-129`）。

### 2.4 数据归属

| 数据 | 位置 | 属主 | 生命周期与一致性 |
| --- | --- | --- | --- |
| 控制服务器配置 | `filesDir/control-server.json` | P1 | 原子写 `.tmp` + rename（`services/ControlServerConfig.ets:67-`）；`load()` 缺失/半写/未确认一律回落 `unconfigured()`（`:46-63`） |
| 引擎状态目录 | `filesDir/tailscale` | P2（正常），P1（无 UI 直连时） | 由 `backendStart/backendRestartWithTun` 的 `stateDir` 决定（`VpnCommandGateway.ets:100`、扩展 `:538`）；控制服务器重置时删除 |
| VPN 就绪状态 | `filesDir/vpn-probe-status.txt` | P2 只写；P1/P3 只读 | 每 1 s 覆写；>15 s 视为**不确定**而非健康 |
| 对端快照 | `filesDir/vpn-peers.json` | P2 只写；P1 只读 | 随快照；>5 s 丢弃 |
| Taildrop 历史 | `filesDir`（上限 10 条，`BridgeStatus.ets:180`） | P1 | 超出淘汰最旧（`:3804`、`:9333`） |
| Taildrop 出站暂存 | `cacheDir/taildrop-outbox`（`RecoverableCachePaths.ets:10`） | P1 | 可丢弃副本；`filesDir/taildrop-outbox` 为遗留兼容路径（`:14`） |
| Taildrop 缓存保留 | 扩展侧常量 7 天（`TailscaleVpnExtensionAbility.ets:56`） | P2 | 与 R-DRIVE-05 所述「24 h」**不是同一份数据**（§六 Q-03） |
| 诊断事件 | `filesDir/diagnostic-ui-events.ndjson`、`diagnostic-vpn-events.ndjson` | P1 写前者、P2 写后者 | 每文件 100 事件 / 24 KB 上限，超出淘汰最旧（`services/DiagnosticPrivacy.ets:12-13`、`DiagnosticEventStore.ets:112-116`） |
| 诊断报告 | `cacheDir` | P1 | 保留 24 h（`services/DiagnosticReportService.ets:10`、`:654`） |
| 界面偏好 | ArkData preferences：`mesh_arc_navigation`、`mesh_arc_animation`、`mesh_arc_security`、文件传输偏好（`NavigationPreferences.ets:16`、`AnimationPreferences.ets:18`、`AppSecurityPreferences.ets:10`、`FileTransferPreferences.ets`） | P1 | 重启保持（R-UI-02） |
| 一次性标记 | `filesDir/welcome-acknowledged`、`update-changelog-seen-version` | P1 | 存在即视为已确认（`AccountDiagnosticsGateway.ets:14`、`BridgeStatus.ets:1399`） |

**关键一致性事实**：`filesDir` 对三进程是同一份目录，**没有锁、没有租约**。一致性靠
（a）单一写者约定（每类文件只有一个写方）、（b）原子写、（c）新鲜度阈值。三者任一被打破即产生脏读。

**已核出的两处与「单一写者」「单一词汇表」不符的事实（本层收尾修订）**：

1. `vpn-connect-config.json` **有两个写方**：应用进程的 `VpnCommandGateway.stageConnectConfig`
   （`services/VpnCommandGateway.ets:127`）与扩展在断线后做快速重连时的 `stageVpnReconnectConfig`
   （`vpnextensionability/TailscaleVpnExtensionAbility.ets:1116-1127`）。该文件还是**一次性的**：
   `consumeVpnConnectConfig` 读完即 `unlink`（同文件 `:780-798`）。所以「每类文件只有一个写方」
   对本文件不成立；它靠的是 TTL 15 s 加一次性消费，不是单一写者。
2. 状态文件的**新鲜度阈值有两套**：`BridgeStatus` 用 5000 ms（`:142`、`:3313`），
   `VpnBackgroundTaskManager`（`:14`）与 `VpnStatusReader`（`:9`）用 15000 ms。同一份
   `vpn-probe-status.txt` 在两个读者眼里「新鲜」的窗口不一样。§2.3 声称的「同一个共享词汇表」
   也只在部分成立：`vpn interface established` 在 `VpnBackgroundTaskManager` 里是 `connecting`，
   在 `VpnStatusReader` 里仍是 `unknown`（卡片侧靠把 `unknown` 显示成连接中来兜）。
   这两条已记入流程记录的 Q9、Q10、Q11，需在架构层通过前定论。

### 2.5 横切策略

| 横切关注 | 落点 | 约束形式 |
| --- | --- | --- |
| 脱敏 | `DiagnosticPrivacy.redactForLog`（`:47-55`）：URL、bearer/basic、token/secret 键、查询串令牌 | 所有落盘文本与 hilog 的必经边界；网络变化只上报承载类别与数字错误码（`docs/vpn-network-recovery.md`） |
| 可观测 | hilog domain `0x0000`（`EntryAbility.ets:24`、扩展 `:18`）+ NDJSON 诊断 | 事件名是自由字符串，**没有受控词表**（§六 Q-06） |
| 错误处理 | 统一「失败即降级为可读状态」：快照失败保留上一次已知状态（扩展 `:939-947`） | 不把可选服务失败宣称为隧道失败 |
| 重试 | 三处指数退避：`VpnReconnectSupervisor`（30/60/120 s，`docs/background-vpn-reliability.md` M2）、`VpnBackgroundTaskManager` 系统取消后回退（`:182`）、`VpnNetworkMonitor` 注册失败 5 s 重试 | 重试必须能被用户意图打断（R-CONN-06） |
| 异步陈旧 | `*RequestGuard`（`HomeReadOnlyGateway.begin/isCurrent:25/33`、`VpnCommandGateway.begin/isActive:31/46`）+ `requestId` | 迟到结果不得覆盖新结果（R-DEV-06、R-DEV-05） |
| 身份与安全 | 系统认证（`services/AppSecurityAuthenticator.ets`）+ `AppSecurityPreferences`；深链校验（`services/HosPlayerLauncher.ets` 的 `unsafe_server_url`） | 锁状态归 P1；凭据不进深链 |
| 国际化 | `resources/base`（英文）与 `resources/zh_CN`；深色在 `resources/dark` | 界面改动必须同时维护两份（`CONTRIBUTING.md` 第 3 条） |

---

## 三、适用视图

### 3.1 结构视图 —— 关注点：责任边界与依赖方向

```
        ┌──────────────────────── P1 UI 进程 ────────────────────────┐
        │ EntryAbility(单例, module.json5:28)                        │
        │   ├ VpnBackgroundTaskManager ── 持有 dataTransfer 长时任务  │
        │   ├ VpnReconnectSupervisor   ── 掉线恢复(意图记忆)          │
        │   └ callee 'toggleVpn'       ── 卡片入口                    │
        │ BridgeStatus(15,149 行: UI + 大部分业务逻辑 + 第二条连接编排) │
        │ Gateways: VpnCommand / HomeReadOnly / NetworkSettings /     │
        │           AccountDiagnostics / Taildrive / Taildrop*        │
        │ libtailscale_ohos.so ─▶ libtailscale_go.so   ← 第 1 份引擎   │
        └───────────────┬─────────────────────────────────────────────┘
                        │ filesDir 文件协议（§2.3），无直接调用
        ┌───────────────▼─────────────────────────────────────────────┐
        │ P2 VPN 扩展进程（唯一常驻）                                   │
        │ TailscaleVpnExtensionAbility(2,010 行)                       │
        │   ├ createVpnConnection → TUN fd → backendRestartWithTun     │
        │   ├ 状态环 1 s / 请求环 100 ms / 接收环 250 ms                │
        │   ├ Taildrop + Taildrive + 探测的引擎侧                      │
        │   └ VpnNetworkMonitor（默认网络回调 → backendNetworkChanged）│
        │ libtailscale_ohos.so ─▶ libtailscale_go.so   ← 第 2 份引擎   │
        └──────────────────────────────────────────────────────────────┘
        ┌──────────────── P3 Form 进程（~10 s 回收）──────────────────┐
        │ EntryFormAbility → FormCardService → VpnStatusReader(只读)   │
        └──────────────────────────────────────────────────────────────┘
```

**S1 内部的一个结构性事实**：`components/BridgeStatus.ets` 有 15,149 行，且**不是**纯视图——它同时
持有连接命令状态机（`beginVpnConnection:2351`、`stopVpnProbe:2502`）、后端交接应答
（`processVpnBackendHandoffRequest:3407`）、Taildrop 编排（`:7878`、`:8321`）、媒体与 Taildrive 入口。
界面外壳与业务逻辑在同一个程序单元内，这是 D1（§四）的第一个根因，也是本次架构层**不改变**该结构的
理由：改动它不影响任何需求的取舍，只影响 LLD 的可维护性。

### 3.2 运行视图 —— 关注点：谁在什么时候做什么、超时与失败归谁

**(a) 正常连接（UI 按钮路径，O-CONN-01）**

```
用户点连接
  BridgeStatus.beginVpnConnection:2351
    → 检查控制服务器 / 登录态
    → QueueExitNodeUpdate(如需) → requestVpnExtensionStart:2478
        → VpnCommandGateway.begin() 取得 commandId；stageConnectConfig() 写 vpn-connect-config.json (TTL 15 s)
        → startVpnExtension(Want{ren.w2h.mesharc/TailscaleVpnExtensionAbility})
  [P2] onCreate:339 → createVpnConnection:373 → createTunWithConflictReplacement:509
        → backendRestartWithTun(stateDir, model, os, controlURL, tunFd):537
        → requestUiBackendHandoff:645  写 vpn-backend-handoff-request.json{requestId}
             └ 轮询 100 ms × 150（=15 s）等 vpn-backend-handoff-response.json
  [P1] processVpnBackendHandoffRequest:3407 读到请求 → stopBackend() → 写响应{requestId,status}
  [P2] 收到匹配响应 → 隧道可用 → 1 s 状态环写 vpn-probe-status.txt
  [P1] VpnBackgroundTaskManager 读到 heartbeat 的 'vpn interface established' → 判为 connecting → 已提前持有长时任务
```

**为什么需要 `processVpnBackendHandoffRequest`**：`libtailscale_ohos.so` 被**两个进程各加载一份**
（§四 D3），P1 里那份可能已经把引擎跑起来并生成了登录 URL / 配置；P2 要接手 TUN，必须先让 P1 侧引擎
停掉，否则同一 `filesDir/tailscale` 会被两个引擎实例写。

**(b) 卡片连接（无 UI 路径，O-CARD-01）**

```
用户点卡片 → 卡片 post 'call' → [P3/P1 边界] EntryAbility.toggleVpnFromCard:191
  → VpnSessionController.connect:80
      → ensureBackendReady:191（backendStart + 轮询 250 ms × 40）
      → requestConnectConfig:216（后端答 PENDING 时 500 ms × 20 重试）
      → stageConnectConfig → clearHandoffFiles → startVpnExtension
      → answerBackendHandoff:150（不 await；250 ms × 60 轮询应答）
  → formProvider.updateForm 推新状态
```

**(c) 后台掉线恢复（O-CONN-04）**

```
[P1 后台] VpnReconnectSupervisor.onBackground:180 记时刻
  仅当 connected→disconnected 且已后台 ≥ BACKGROUND_SETTLE_MS(10 s)
  且未 noteRequestedStop → 交 VpnSessionController.connect
  最多 3 次，退避 30/60/120 s，稳定 STABLE_MS(60 s) 才清零
```

**(d) 网络承载切换（O-NET-03）**

```
[P2] VpnNetworkMonitor 默认网络回调 → 合并事件、序列化、限速
  → nativeBridge.backendNetworkChangedAsync(interfaceName):164
  → 引擎重绑套接字并刷新 STUN；空 host route hint 表示离线
  地址数据不落日志（只记承载类别与数字码）
```

**(e) 一帧状态的可观测路径（O-CONN-06 的取证基础）**

```
[P2] setInterval 1 s → writeCurrentStatusHeartbeat()（先写，保证存活独立于快照耗时）
                    → backendSnapshot() → writeStatus()/writePeerSnapshot()/writeTaildropSnapshot()
                    → 顺带处理 4 类探测请求
[P1] 任意读方：fileIo.accessSync + readTextSync + 新鲜度检查 → 4 值状态机
```

### 3.3 部署视图 —— 关注点：产物形态与可安装性

| 项 | 值 | 来源 |
| --- | --- | --- |
| 产物 | 一个 HAP，`compatibleSdkVersion 6.1.0(23)`，`compileSdkVersion 26.0.0`，runtimeOS HarmonyOS | `build-profile.json5` |
| ABI | arm64-v8a 单一；`entry/libs/arm64-v8a/libtailscale_go.so`（≈38 MB） | `scripts/build-go.sh:40-41`、`entry/libs/arm64-v8a/` |
| 装载 | `libtailscale_ohos.so`(napi_init.cpp) 动态链接 `libtailscale_go.so`；`add_library(tailscale_go SHARED IMPORTED)` | `entry/src/main/cpp/CMakeLists.txt:7-13` |
| 能力声明 | `EntryAbility`(singleton, 后台模式 dataTransfer)、`TailscaleVpnExtensionAbility`(type=vpn, exported=false)、`EntryFormAbility`(type=form) | `entry/src/main/module.json5:15-69` |
| 权限 | INTERNET、GET_NETWORK_INFO、GET_BUNDLE_INFO、KEEP_BACKGROUND_RUNNING、VIBRATE、ACCESS_BIOMETRIC | `entry/src/main/module.json5:70-89` |
| 两种发行身份 | AppGallery 版与自编译版包名/签名不同；本仓基线 `ren.w2h.mesharc` | `README.md`、`services/VpnSessionController.ets:9` |
| 构建入口 | `scripts/build.sh`(macOS) / `scripts/build.ps1`(Windows) → 先 `build-go.sh` 再 hvigor `assembleHap`，签名走 devecocli | `scripts/build.sh:1-3`、`scripts/build-go.sh:1-3` |
| 产物校验 | `scripts/verify-artifacts.ps1`（AArch64 动态库 + 已打进 HAP） | `scripts/verify-artifacts.ps1` |
| **CI** | **无**。73 条 `node --test scripts/test-*.mjs` 靠人工运行 | `docs/changes/a01-baseline/record.md` 未决 Q1 |

**部署上的架构性含义**：`libtailscale_go.so` 只有 arm64-v8a 一份，因此「两个进程各加载一份」
在设计上是同一份**文件**被两个进程映射，而不是两份不同构建。这削弱但不能排除「平台是否共享同一运行时」
的问题（§四 D3、§六 Q-01）。

---

## 四、关键决策

每条给：问题 / 可行选项 / 选择与理由 / 代价 / 风险 / **失效条件**（什么情况下这个选择不再成立）。

### D1 · 两条连接编排，还是收敛成一条

**问题**：连接/断开需要命令状态机、诊断、配置投递、交接应答四件事。UI 按钮与卡片都需要它们。

**可行选项**
- (a) 现状：`BridgeStatus` 私有 UI 路径 + `VpnSessionController` 无 UI 路径，两份实现。
- (b) 收敛到 `VpnSessionController`，`BridgeStatus` 只留界面与文案。
- (c) 收敛到 `BridgeStatus`，卡片改为 `startAbility` 拉起 UI 进程再走按钮路径。

**选择**：**(a)**，并把它登记为已知债务。理由：(c) 与「卡片进程不能常驻」冲突——卡片唤醒 UI 进程
会在用户没看界面时弹出窗口，直接违反 `docs/home-screen-card.md` 的「不需要界面时不弹窗」设计；
(b) 要求把 15,149 行组件里的 `@State` 绑定与 `getUIContext()` 依赖全部切出去，属于纯重构，本层不
改变需求取舍。代码自己把这条债务写明了：`services/VpnSessionController.ets:53-63`
（"This is a second, smaller path over the same primitives … Keeping the two in step is tracked as known debt"）。

**代价**：两套命令状态机、两套诊断事件名、文件名与状态词表必须逐字同步（`VpnSessionController.ets:12-18`）。

**风险**：漂移。**这不是假设，已经发生过**：扩展的后端交接最初只有 `BridgeStatus` 会应答，于是
**每一次**无 UI 连接（卡片、后台恢复）都建了 TUN、等 15 s、然后销毁 VPN
（`docs/background-vpn-reliability.md` M3「The second failure: a headless connect could never complete」）。

**失效条件 / 收敛触发**：出现**第三个**入口（例如系统分享面板接收文件、开机自动连接）。届时不应再抄
第三份，而应把「文件名 + 超时 + 状态词表 + 命令状态机」抽成一个共享模块，两条路径都只调它。
在触发之前，(a) 是合理选择；触发之后，(a) 立即变成缺陷来源。

### D2 · 跨进程用文件协议，还是绑定服务 / RPC

**问题**：P1 与 P2 需要双向、带超时、可被对方进程死亡打断的通信。

**可行选项**
- (a) 现状：`context.filesDir` 下的请求/应答文件 + 轮询。
- (b) `@ohos.rpc` 绑定服务（`bindService` / `connectServiceExtensionAbility`）。
- (c) 公共事件（`commonEventManager`）或应用内事件总线。
- (d) 把两侧合进一个进程（不可行：见 D4）。

**选择**：**(a)**。理由有三，且都是硬约束：(1) **生命周期方向相反**——卡片要唤醒 P1，P2 要比 P1 活得
久，绑定服务要求被绑方先活着，正好反向；(2) **文件是三进程唯一共同可达的介质**，P3 明确不允许常驻
也不允许导入 `backgroundTaskManager`（`docs/home-screen-card.md`），但**可以**读 `vpn-probe-status.txt`
（`services/VpnStatusReader.ets` 头注明确说明这是为了同时服务应用、Form 扩展与卡片）；(3) **状态文件顺带
承担恢复职责**：进程重启后重新拉起时，磁盘上的文件就是唯一事实（`requirements.md` 边界场景「进程重启后
重新拉起 → 不沿用旧快照」）。

**代价**：没有推送，延迟 = 轮询间隔 + 文件 IO；每次交互都要 JSON 序列化，没有类型检查；没有背压，
取消只能靠再写一个 cancel 文件；请求/响应的正确性靠「先清响应」+ `requestId` 这类纪律而非机制；
写入者之间没有锁。

**风险**：（i）半写被读——已用原子写缓解（`.tmp` + rename，扩展 `writeAtomicTextFile`）；
（ii）陈旧响应被误当本次答案——已用 `requestId` 与「先清空」缓解（`TailscaleVpnExtensionAbility.ets:653`、
`VpnSessionController.ets:125-129`）；（iii）**无锁多写者**仍是暴露面：同一份 `filesDir/tailscale` 如果被
两个引擎实例同时打开，文件协议无法阻止（这正是 D3 的风险）。

**失效条件**：出现需要低延迟或高吞吐的跨进程数据（例如逐帧的预览数据、每秒多次的遥测）。
那时轮询文件不成立，应按数据分流而非整体替换。

### D3 · Go 引擎在两个进程各加载一份，还是只留一个属主

**2026-10-13 真机确认 (a) 成立。** 连接成功后在工程诊断面板读到：扩展侧
`vpn-status = state=Running | tun=true`，而 UI 进程侧 `engine-status = Tailscale Engine Pending`、
`backend-status = STOPPED | backend not started`。两侧还有各自的进程号与日志 tag。
所以两个进程确实各有一份独立的引擎运行时，选 (a) 不需要改。证据与复跑命令见
`docs/changes/a01-baseline/manual-checks.md#M-13` 与 `scripts/e2e/engine-runtimes.mjs`。

**问题**：`libtailscale_ohos.so` → `libtailscale_go.so` 被 7 个 ArkTS 文件导入
（`components/BridgeStatus.ets`、`vpnextensionability/TailscaleVpnExtensionAbility.ets` 与 5 个 gateway）。
原生库在 P1 与 P2 各被加载。

**可行选项**
- (a) 现状：两个进程各加载一份，各自可起自己的引擎实例。
- (b) 单一属主＝P2：P1 完全不加载原生库，全部数据经文件协议取。
- (c) 单一属主＝P1：P2 只做 TUN 转发，不驱动引擎。

**选择**：**(a)**。理由：(c) 不可能——TUN fd 由 P2 的 `vpnExtension.createVpnConnection` 产生
（扩展 `:373`），必须交给引擎，而引擎要能重绑、探测、发 Taildrop，都发生在 P2；把引擎放 P1 会让网络
事件（P2 才有 `net.connection` 回调，`VpnNetworkMonitor.ets:164`）与引擎脱节。(b) 与连接流程冲突——
连上之前需要拿登录 URL 与 VPN 配置（`VpnCommandGateway.requestLoginUrl:115`、
`requestVpnConfig:111`），此时扩展尚未被拉起，「先起引擎再起扩展」的顺序决定了 P1 必须能起引擎。
而且 P1 有一处**明确的**直连用法：未连接但本进程后端已在 Running 时，Taildrop 接收直接走
`nativeBridge.backendTaildropReceiveAsync`（`BridgeStatus.ets:8214`、`:8229`），绕过文件协议。

**代价**：引擎原生状态可能同时存在两份；`filesDir/tailscale` 这一个状态目录有两个潜在写者；
进程间没有任何机制保证「另一个实例已经停了」——只能靠 D1/SEAM-01 的交接协议约定。

**风险**：`backendStop/backendLogout` 在 P1 调（`AccountDiagnosticsGateway.ets:49`，R-SETUP-09 退出登录）
是否只作用于 P1 自己的实例？如果平台把两个进程里的同一份 `.so` 视为**同一个运行时**（静态变量共享），
那么 P1 的一次 stop 会连带把 P2 的隧道引擎停掉，而文件协议仍会把它读成「扩展自己停了」。

**这是我无法在本层证伪的核心不确定性**：无论平台给的是「一个运行时」还是「两个运行时」，上述两种后果
是相反的，而**代码与文档都没有记录验证过**（本仓无相关测试；`scripts/test-*.mjs` 全部是宿主侧纯逻辑测试，
不加载 `.so`）。→ **§六 Q-01，必须在 HLD 前用真机验证**：
在两个进程里各调一次 `probeEngine()`/`backendStatus()`，观察是否互相可见。

**失效条件**：若验证结果是「一个运行时」，则 (a) 必须改为 (b)，因为交接协议会失去意义，
`filesDir/tailscale` 的单写者假设被打破。

### D4 · 长生命周期「服务端」放扩展进程，还是放 UI 进程

**问题**：三进程里只有 P2 由系统在 VPN 会话期间维持；P1 在后台无长时任务时会被冻结。

**可行选项**
- (a) 现状：P2 做服务端（状态、探测、Taildrop/Taildrive 引擎侧），P1 按需前台。
- (b) P1 做服务端，持续保活，P2 只做 TUN 转发。

**选择**：**(a)**。理由是平台事实而非偏好：官方文档说明「启动进程或扩展进程任一退出，系统都会停掉 VPN」
（`docs/background-vpn-reliability.md` M1 引用的官方链接），且 M3 的取证显示一个被冻结的 P1 里
`setTimeout` 迟到了 **32 分钟**才执行——P1 在后台且无长时任务时不可依赖。只有 P2 能在用户不在场时继续应答。

**代价**：P2 承载 2,010 行（含 Taildrop、Taildrive、网络监听三类逻辑与三个定时器），这些逻辑与 P1 对
同一份数据的呈现**分离**；P2 无法显示界面，因此每一个需要用户决定的动作都必须反向请求一个文件命令
（替换 VPN 批准是唯一实现出来的例子，`vpn-replace-approved`）。

**风险**：**恢复能力的不对称**。P2 被杀时隧道必然断开，而恢复的责任方是 P1 的 `VpnReconnectSupervisor`
——可它恰恰是「后台可能已被冻结」的那一个。`docs/background-vpn-reliability.md` M2 原文记录了这个洞：
「The app then released its continuous task … and stayed disconnected until the user noticed.」
即：**掉线恢复只在前台或刚进后台 10 s 后的窗口内可靠**。

**失效条件**：如果平台提供合法的 VPN 类长时任务模式，恢复责任可以移回常驻侧。当前不行：
`MODE_TASK_KEEPING` 与 `MODE_SPECIAL_SCENARIO_PROCESSING` 都被排除，后者的子模式只有媒体处理/视频广播/
锻炼，没有 VPN 场景（`docs/background-vpn-reliability.md` M2 表格）。该路径在代码里已实现但**默认惰性**：
`SPECIAL_SCENARIO_SUBMODE` 为 0 且未声明受限权限（`VpnBackgroundTaskManager.ets:261-280`）。

### D5 · 长时任务的存活判据：隧道 Running，还是把连接窗口也算 live

**问题**：R-CONN-03 要求「连接窗口期内应用进程必须持有长时任务」，否则扩展的 15 s 交接无人应答。

**可行选项**
- (a) 旧行为：只在状态含 `state=Running | tun=true` 时持有长时任务。
- (b) 现状：把「新心跳且状态含 `vpn interface established`」也解析为 `connecting`，与 `connected` 同级持有。
- (c) 无条件在进入应用时持有，靠宽限释放。

**选择**：**(b)**。理由是 (a) 正是用户报告「用到一半自己断了」的成因：M3 记录中，扩展 14:10:18.864 建
TUN 并写 `backend handoff pending`，用户 14:10:23.973 切后台，14:10:34.468 扩展记
`vpn_backend_handoff_timeout` 并拆掉 VPN——那 15 s 内 P1 没有任务，被冻结。(c) 不可接受：会让应用在
没连接时也常驻，违背 R-CONN-02 的「断开即释放」与平台功耗模型。

**代价**：`connecting` 成为与 `connected` 等重的状态，长时任务在连接尝试期间就常驻；判据依赖对状态文本
的字符串解析（`VpnBackgroundTaskManager.ets:350-368`）。

**风险**：字符串解析脆弱——扩展改一句文案就会静默失去保护。M1 设置的门槛被刻意保留：无法识别的状态
（`state=Running | tun=false`、裸生命周期行、陈旧心跳）仍然不持有任务（`docs/background-vpn-reliability.md` M3）。

**失效条件**：端到端复现**尚未真机重跑**（M3 原文：需要断开竞争的 shadowsocks VPN 并在窗口内切应用）。
复跑前，这条决策的成立只依赖单元测试与旧录像。

### D6 · 状态与请求的发布：单档轮询，还是三档节奏

**问题**：P2 要同时服务「秒级状态」与「用户操作后的即时请求」。

**可行选项**
- (a) 单档（例如统一 1 s）轮询处理全部请求与状态。
- (b) 现状三档：状态 1 s（`:905`）、请求 100 ms（`:884-897`）、接收通知 250 ms（`:901-903`）。
- (c) 请求+状态合一，状态先写、快照异步（这正是现状在该档内采取的折中，见 `:906-914`）。

**选择**：**(b)**。理由：快照查询可能耗时数秒（`backendSnapshot` 要查文件目标与收件箱），若与请求共用
一档，用户的取消/接收操作会被快照阻塞；`clearInterval` 的三档拆分注释明确写了这一点
（`:883-884`、`:900-901`）。同时状态**心跳先于快照写**，使 liveness 不被快照延迟污染（`:906-908`）。

**代价**：三个定时器 + 三个 `inFlight` 标志；`destroying` / `backendStopInFlight` 必须在每个回环入口
重复检查（`:886`、`:909`、`:1015`）；关环与定时器泄漏需要显式清理（`:1955-1974`）。

**风险**：100 ms 档的请求环意味着**每条请求的平均延迟 50 ms、最坏 100 ms**，且请求处理与状态快照在同一
线程上串行；一次慢的 Taildrive 查询会把后续请求推后（代码用「请求环不等快照」缓解，但两者仍在同一
事件循环上）。

**失效条件**：若单条请求处理开始超过 100 ms（例如同步文件操作变重），100 ms 档失去意义，
应改为「快路径处理请求、慢路径后台执行」的任务模型。

---

## 五、旅程与接缝

**说明**：`docs/oracles/91-seams/` 目前为空，下表给出的是**候选接缝**（SEAM-xx）与它们服务的旅程判据；
接缝判据正文待建。旅程 ID 取自 `docs/requirements/requirements.md` 的「旅程判据」列。

| 旅程判据 | 子系统路径 | 接缝判据 | 故障责任 | 质量约束 |
| --- | --- | --- | --- | --- |
| O-SETUP-01 首次启动 | S1（`BridgeStatus.ets:1399`）→ S6 | 无跨进程接缝（P1 内 + 文件标记） | P1 | 标记缺失按「未见」处理，不静默跳过 |
| O-SETUP-02 控制服务器 | S1 → S6 | 无跨进程接缝 | P1 | 原子写 `.tmp`+rename；非法地址必拒（R-SETUP-05） |
| O-SETUP-03 浏览器登录 | S1 → S1 → 系统浏览器 | SEAM-12（系统边界：三路回退拉起浏览器） | P1；系统无浏览器时 P1 记失败态 | 只接受 http(s) 登录 URL（R-SETUP-07） |
| O-SETUP-04 退出登录 | S1 → S4(P1 侧引擎) → S6 | SEAM-11 的邻接：`backendLogoutAsync` 作用于**哪个**引擎实例（Q-01） | P1 | 必须先断开（R-SETUP-08）；清对端与出口节点状态 |
| O-CONN-01 一键连接 | S1 → S5 → S3 → S4(P2) | **SEAM-01 后端交接**、SEAM-02 连接配置投递 | 无人应答 ⇒ **P1**（未持有长时任务）；应答但停不下来 ⇒ P1；扩展超时自毁 ⇒ P2 记账 | 15 s 硬预算；配置 TTL 15 s；R-CONN-03 |
| O-CONN-02 一键断开 | S1 → S5 → S3 | SEAM-05 停止/断开（`requestId` 匹配） | 请求方 P1 超时（50 ms×150）后仍调 `stopVpnExtension`，视为无害 | 断开即释放长时任务 |
| O-CONN-03 连接窗口保活 | S1(S2) ⇄ S3 | SEAM-03 状态/心跳（`connecting` 解析） | P1（判据误解析即失去保护） | 15 s 心跳新鲜度；有界宽限（R-CONN-09） |
| O-CONN-04 掉线自动恢复 | S2 → S5 → S3 | **O-SEAM-11 恢复责任 + O-SEAM-03 状态判读**（审查人裁决 Q16a，2026-10-12；原记 SEAM-03 + SEAM-05） | P2 被杀 ⇒ 隧道断，**恢复责任在 P1**，而 P1 可能已被冻结（D4 风险） | 最多 3 次、指数退避、稳定 60 s 清零；用户意图不可被撤销（R-CONN-05/06） |
| O-CONN-05 替换其它 VPN | S3 → S5 → **（无写方）** / S1 提示 | **SEAM-06 替换批准**：`vpn-replace-approved` 只有读方，替换路径不可达；实际走的是 `showVpnConflictDialog` 的「先断开其它 VPN」提示 | 用户不批准 ⇒ 无法连接，责任在用户侧；P2 记账 `vpn_conflict`，P1 负责把状态翻成人能读的提示 | 单 VPN 平台限制；不得在用户批准前静默替换（当前无静默风险，因为通道断了） |
| O-CONN-06 后台存活 | S2 ⇄ S3 | SEAM-03、SEAM-12（系统长时任务） | P1 若未持有任务即被冻结 | ≥720 s、心跳龄 ≤15 s、进程 ID 不变 |
| O-CONN-07 无 UI 连接 | S2 → S5 → S3 | **SEAM-01**（`VpnSessionController.answerBackendHandoff:150` 是第二个应答方，D1） | 应答方 P1；漏答即扩展自毁 | 与 O-CONN-01 同一 15 s 预算与同一文件名 |
| O-CARD-01 卡片开关 | S7 → S1(callee) → S2 → S5 → S3 | **SEAM-10 卡片↔应用**（`callee 'toggleVpn'` + `formProvider.updateForm`） | P7 只读不写：状态陈旧归系统刷新配额；动作失败归 P1 | 卡片进程不常驻；乐观翻转只能由下一次 `updateForm` 校正 |
| O-NET-01/02 出口节点与子网路由 | S1 → S4(P1) / S1 → S5 → S3 | SEAM-02 邻接（设置变更必须在断开时生效） | P1 | 已连接时不可改，提示先断开 |
| O-NET-03 网络切换 | S3(S4) → 系统网络管理 | **SEAM-12**：默认网络回调 → `backendNetworkChangedAsync` | P2 | 同会话重绑；**地址数据不得落日志**（R-NET-04） |
| O-DEV-01 设备列表三态 | S1 → S5 → S3（`vpn-peers.json`） | **SEAM-04 对端快照**（1 s 写 / 5 s 新鲜度） | P2（发布方）；P1 读过期快照 ⇒ P1 | 不显示空列表；区分本机/在线/离线 |
| O-DEV-02 设备详情 | S1 → S5 → S3 | SEAM-04 + SEAM-09 探测 | P2（探测方）；结果过期失效归 P1 的缓存判定 | 过期即失效，旧结果不得覆盖新路径（R-DEV-05/06） |
| O-XFER-01/02 发送文件 | S1 → S5 → S3 | **SEAM-07 Taildrop**（100 ms 请求环） | P1（单传输门控）；P2（实际传输） | 同时只允许一个出站；忙碌即提示不排队 |
| O-XFER-03 双通道选择 | S1 → S1 → 外部应用 | SEAM-09（LocalSend 刷新）+ SEAM-12（Want 拉起） | P1 | 契约未定时不得猜测（R-XFER-09，§六 Q-04） |
| O-XFER-04 接收与保存 | S3 下载 → S1 落盘（picker/媒体库） | **SEAM-07 的接收半环**（250 ms）+ SEAM-11 邻接 | P1（分流与保存）；P2（下载与对端等待文件） | **接收方确认后才删对端文件**（R-XFER-07）；同名不同大小必须区分 |
| O-XFER-05 进度/取消/重试 | S1 ⇄ S3 ⇄ S1 | SEAM-07 | P1 | 取消必须真的到达 P2；历史上限 10 条 |
| O-DRIVE-01 文件页 | S1 → S5 → S3 | **SEAM-08 Taildrive**（4 对请求，超时 32 s/35 s/30 min+10 s/5 s） | P1（超时与冲突确认）；P2（文件系统操作） | 上传默认不覆盖，冲突必须显式确认（R-DRIVE-04） |
| O-DRIVE-02 从设备跳转共享目录 | S1 → S1 → SEAM-08 | SEAM-08 + SEAM-04 | P1 | 未连接不给可操作入口（R-DRIVE-01） |
| O-MEDIA-01/02 媒体发现与打开 | S1 → S5 → S3 → S1 → 外部播放器 | SEAM-09 探测 + SEAM-12 深链 | P1（校验与拉起）；P2（探测） | 深链不得含凭据；非法地址必拒（R-MEDIA-02/03）；DERP 路径先确认 |
| O-PRIV-01/02 应用锁与文件夹锁 | S1 → 系统认证 → S1 | SEAM-12（系统认证能力） | P1 | 认证失败停在锁定层；回前台清授权（R-PRIV-02/04） |
| O-DIAG-01 诊断与脱敏 | S1 与 S3 → S6/S8 | **SEAM-11 诊断落盘**（两进程分文件，共用 `DiagnosticPrivacy`） | 写出方各自负责；读取方 P1 合并 | 每文件 100 事件/24 KB；脱敏不可绕过（R-DIAG-02/03） |
| O-UI-01 页签与自适应 | S1 | 无跨进程接缝 | P1 | 窄屏底栏/宽屏侧栏；偏好重启保持 |
| O-UI-02 双语与深色 | 全部子系统的资源 | 无跨进程接缝，但**是交付级约束** | 每个改界面的提交 | `base` 与 `zh_CN` key 必须一致（§六 Q-05） |

**接缝责任空洞检查（本层结论）**

1. **SEAM-01（后端交接）**是唯一有「双应答方」的接缝：`BridgeStatus` 与 `VpnSessionController` 各实现
   一遍（D1）。责任没有空洞（总有人应答），但有**重复责任**，且 `answerBackendHandoff` 的轮询窗口
   （250 ms × 60 = 15 s）与扩展的预算（100 ms × 150 = 15 s）只是**恰好**相等而无耦合，任何一侧单独调整
   都会静默失去应答。
2. **SEAM-03（状态/心跳）**的责任在「不确定」语义上被刻意留空：陈旧/缺失 → `unknown`，**不是** disconnected。
   P1 在读侧负责把不确定转成不持有长时任务（有界宽限），P2 在写侧只保证 1 s 覆写。责任完整。
3. **恢复责任空洞（唯一确认的空洞）**：P2 被杀 ⇒ 断线 ⇒ 恢复责任在 P1，而 P1 在后台无长时任务时会被
   冻结（D4）。当前没有任何子系统承诺「P1 被冻结期间的掉线恢复」。这是**已知的、被文档记录的**缺口，
   不是遗漏（`docs/background-vpn-reliability.md` M2）。
4. **SEAM-07 的接收半环**：对端等待文件的删除必须发生在接收方确认之后（R-XFER-07）。责任在 P1（它才有
   picker 与媒体库权限），命令跨到 P2 执行——责任与执行分离，需要接缝判据显式钉住「先确认后删」。
5. **SEAM-11**：两进程各写自己的 NDJSON 文件、共用一个脱敏边界。没有空洞，但**没有端到端验证**
   （`requirements.md` 质量目标表末段）。

---

## 六、未决项与审核问题

| # | 问题 | 影响 | 谁确认 | 何时阻塞 |
| --- | --- | --- | --- | --- |
| **Q-01** | ~~平台把两个进程里加载的同一份 `libtailscale_ohos.so` 视为一个运行时还是两个？~~ **已解答（2026-10-13 真机）：两个。** 连接成功时扩展侧 `state=Running` 而 UI 进程侧引擎 Pending、后端 STOPPED，两侧进程号与日志 tag 也不同。D3(a) 成立，交接协议与单写者假设不变。证据 `manual-checks.md#M-13`，复跑 `scripts/e2e/engine-runtimes.mjs` | D3、SEAM-01、O-SETUP-04、O-CONN-01 | 用户（真机） | 已解除 |
| **Q-02** | R-CONN-07 的替换批准路径：`vpn-replace-approved` 的写方在 UI 进程，而 TTL 只有 10 s（`TailscaleVpnExtensionAbility.ets:28`）。若批准对话框出现时用户正好切走，10 s 后批准文件是否还有效、扩展是否重问——**未验证** | O-CONN-05、SEAM-06 | 用户 | O-CONN-05 要闭环时 |
| **Q-03** | 缓存保留期在代码与需求之间不一致：扩展的 Taildrop 缓存是 **7 天**（`TailscaleVpnExtensionAbility.ets:56`），诊断报告是 **24 h**（`DiagnosticReportService.ets:10`），而 R-DRIVE-05 写的是 Taildrive 暂存 **24 h**——在 `TaildriveBrowser.ets` 中**找不到**对应的保留常量（该文件的 24 h 出现在按「今天」分组的显示逻辑 `:1891`，不是清理逻辑）。需求与代码必有一方需要修正 | R-DRIVE-05、§2.4 数据归属 | 用户 | 架构层通过前（数据归属表要定稿） |
| **Q-04** | LocalSend 的官方 bundle/Want 契约未定（承接 `record.md` Q4 / 需求 Q4），O-XFER-03 只能 `not-evaluated` | O-XFER-03、SEAM-12 | 用户 | O-XFER-03 要闭环时 |
| **Q-05** | `base` 与 `zh_CN` 的 key 集合**本批已实测一致**：各 657 个 key、差集为空。仍未验证的是译文质量与真机渲染；这条交付约束目前**没有守门人**（没有测试或脚本比对两份资源） | R-UI-03、O-UI-02 | 用户 | O-UI-02 要闭环时 |
| **Q-06** | 诊断事件名是自由字符串（`recordDiagnosticEvent('vpn_...')`），**没有受控词表**，也没有跨进程的事件名登记表。两进程各自命名，`VpnSessionController.record` 把 UI 侧事件也写进 UI 文件（`:187-189`），因此同一语义可能有两种拼写 | R-DIAG-05、SEAM-11 | 用户 | 接缝判据要写「可观测点」时 |
| **Q-07** | 无 CI（承接 `record.md` Q1）。架构上意味着 3.3 节所列的「产物校验」全部是人工步骤，「接缝无空洞」的结论无法被自动守住 | 全部接缝的闭环强度 | 用户 | 声称开发完成之前 |
| **Q-08** | 卡片、Taildrive 真机共享节点、special-scenario 三条路径从未真机验证（承接需求 Q7）。其中 special-scenario 是 D4「失效条件」里唯一的潜在出路，**从未运行过** | D4 的失效条件、O-CARD-01、O-DRIVE-* | 用户 | 相应旅程/决策要定论时 |

**给审核人的问题（架构层应回答、且只有人能回答的）**

1. **责任边界是否完整**：§五 的第 3 条空洞——「P1 被冻结期间的掉线恢复」——是否接受为已确认风险？
   若接受，应记录它对应的用户可见行为（用户回到应用前一直断开）；若不接受，需要一个新的常驻载体，
   而平台没有提供（D4 失效条件）。
2. **D1 的收敛触发条件**是否同意？我主张「出现第三个入口时必须收敛」；如果审核人认为两条路径的漂移
   风险已经不可接受（M3 已经因此产生过一次真实故障），那么收敛应从本层直接进入 HLD，而不是等触发。
3. **D3 是否必须先验证再继续**？我的判断是：这是唯一一个「验证结果会反转架构选择」的未知，
   其余未决项都只影响实现细节。
4. **Q-03（保留期不一致）**应由需求侧修正还是代码侧修正？这决定 §2.4 数据归属表能否定稿。

---

## 七、接缝编号对照（本层收尾补写）

第五节用的是本文档的临时编号 `SEAM-01…SEAM-12`。判据库里用的是稳定的 `O-SEAM-nn`，
两者是同一组边界的两种划分口径，对照如下。**判据库的 `O-SEAM-nn` 是唯一编号来源**，
本文档第五节的临时编号不再用于判据 ID。

| 本文档临时编号 | 判据库 ID | 说明 |
| --- | --- | --- |
| SEAM-01 后端交接 | O-SEAM-02 | 一对双应答方的接缝（D1） |
| SEAM-02 连接配置投递 + SEAM-05 停止/断开 | O-SEAM-01 | 同一条「生命周期命令通道」，都是请求/应答文件 + requestId |
| SEAM-03 状态/心跳 | O-SEAM-03 | — |
| SEAM-04 对端快照 | O-SEAM-04 | — |
| SEAM-06 替换批准 | O-SEAM-16 | 独立成条：本层已发现它的写方缺失 |
| SEAM-07 Taildrop | O-SEAM-07 | — |
| SEAM-08 Taildrive | O-SEAM-08 | — |
| SEAM-09 探测 | O-SEAM-09 | — |
| SEAM-10 卡片↔应用 | O-SEAM-17 | 入口分发的一部分 |
| SEAM-11 诊断落盘 | O-SEAM-15 | — |
| SEAM-12 系统边界 | O-SEAM-11（长时任务）、O-SEAM-12（网络回调）、O-SEAM-13（外部应用与系统认证） | 拆成三条：它们的失败责任方不同 |
| （本文档未单列） | O-SEAM-05、O-SEAM-06 | 应用进程 ↔ Go 引擎的两个面 |
| （本文档未单列） | O-SEAM-10 | 编排分叉（D1 本身） |
| （本文档未单列） | O-SEAM-14 | 持久化所有权与默认值 |

拆分的理由：第五节把「浏览器拉起 / 深链 / 网络回调 / 系统认证」合称 SEAM-12，
但这四条的系统对端、超时语义与失败责任方都不一样（网络回调失败归引擎重绑逻辑，
认证失败归应用锁，深链失败归外部应用是否安装）。合成一条会让「失败归谁」写不清，
而写明失败责任正是接缝判据的主要内容。
