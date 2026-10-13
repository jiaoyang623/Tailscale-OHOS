# LLD 详细设计

- 流程版本：a01 · 层：LLD
- 上层输入：`docs/hld/hld.md`（17 张契约卡 C-01…C-17，对应接缝 O-SEAM-01…O-SEAM-17）、`docs/oracles/91-seams/`（S1…S5）、`docs/oracles/90-journeys/`（29 条旅程判据）
- 下层输入：`docs/oracles/points/`（P1…P5，共 **70** 条单点判据：O-BGTASK-01…15、O-STATUS-01…09、O-NETMON-01…10、O-RECONN-01…09、O-SESSION-01…07、O-PEER-01…11、O-LOCALSEND-01…02、O-BUILD-01…07）
- 事实来源：生产代码 `entry/src/main/ets/**`，逐条给 `file:line`（本层把上一层的行号重核了一遍，**发现并更正了一处引用偏差**，见 §八 D-4）
- 本层做的：把每条单点判据补成**可独立断言的条件与结果**；把四台状态机写全（状态 / 事件 / 条件 / 下一状态 / 输出 / **非法组合**）；把算法边界钉死；把 70 条判据全部收进测试计划表
- 本层不做的：不新增判据 ID；不改行为；不把计划写成实现；不修复任何代码或判据文件（发现的问题只登记在 §八）

**引用可信度声明**：契约与行号一律以当前工作区代码为准。文档与代码冲突处登记进 §八，**不抹平**。本层的「现状」栏只描述代码里已经存在的行为；尚未存在的（集成测试、真机复现、special-scenario 路径）一律标 `不存在` 或 `不可达`，绝不写成实现。

---

## 一、上层 HLD 与现状盘点

### 1.1 盘点口径

三栏，互斥：**已有**（代码里已在跑，可指到 `file:line`）、**修改**（本层要求的改动；本层不做，只登记）、**新增**（尚不存在的，含计划中的测试）。**任何「新增」都不写成实现。**

### 1.2 已有（证据逐条）

| 单元 | 位置 | 已有的事实 |
| --- | --- | --- |
| 保活任务生命周期 | `services/VpnBackgroundTaskManager.ets`（381 行） | 常量 :11–:19；15 个实例字段 :40–:55；两个系统回调 :57 / :78；`register`/`unregister`/`onBackground`/`onForeground` :88/:111/:139/:144；`reconcile` :151；`isLiveState` :201；`start` :205；`startSpecialScenario` :255；`stop` :292；`updateNotification` :309；`readStatus` :344（调 `VpnStatusReader.readText`，不再自解析）；`formatBytes` :359；`scheduleRetry` :369；`record` :375 |
| 命令状态机 | `services/VpnCommandGateway.ets:25-75` | 6 状态枚举 :6-13、3 命令枚举 :15-19、5 个字段 :26-29、`begin`/`isActive`/`complete`/`timeout`/`invalidateLifecycle`/`currentState`/`currentLifecycleGeneration` :31/:46/:50/:59/:63/:68/:72 |
| 掉线恢复监督者 | `services/VpnReconnectSupervisor.ets`（144 行） | 5 常量 :11–:20；9 字段 :37–:45；`onForeground`/`onBackground`/`noteRequestedStop`/`noteRequestedStart`/`poll`/`handleDrop` :47/:56/:62/:69/:78/:107 |
| 状态读取与判定优先级 | `services/VpnStatusReader.ets`（115 行） | `VPN_STATUS_FRESH_MS`（15000，全仓唯一定义）:12；5 状态枚举 :14-20；`read` :37-44（catch :45-48）；`readText` :67-78；`judge` :80-100（全仓唯一判读，顺序固定）；`isDisconnected` :102-108；`field` :110-114。**Q9/Q10/Q13 决策后，词表与判读只有一份：`VpnBackgroundTaskManager.readStatus` 调 `readText`，`BridgeStatus` 借用此处导出的 `VPN_STATUS_FRESH_MS`** |
| 卡片侧状态词表 | `services/FormCardService.ets:14-18, 86-108` | 卡片自己的 5 个态名常量；`stateName` 把 `UNKNOWN` 映射成 `connecting`（:102） |
| 状态文件路径适配 | `services/StoragePaths.ets:17-19` | `vpnStatusPath = ${filesDir}/vpn-probe-status.txt` |
| 无 UI 编排 | `services/VpnSessionController.ets`（287 行） | 镜像 UI 侧文件名 :14-18；超时常量 :20-30；`connect` :80；`disconnect` :118；`answerBackendHandoff` :150；`requestIdOf` :178；`awaitBackendStop` :228；`matchesRequest` :263 |
| UI 侧编排与交接应答 | `components/BridgeStatus.ets`（15 149 行） | 状态轮询 250 ms（:139 `CONNECTION_POLL_INTERVAL_MS`）；状态文件读取与心跳判定 :3300-:3320；宽限态 :3497-:3520；`commitConnectedStatus` :3570；`processVpnBackendHandoffRequest` :3407；停止轮询 `requestId` 匹配 :2545-:2555 |
| 对端/接收侧算法 | `components/BridgeStatus.ets` | 对端快照 5 s 新鲜度 :3606；Taildrop 快照 5 s 新鲜度 :3878；等待文件身份 `name:size` :6981；形状校验 :6985；接收超时常量 :183-:184 与按状态二选一 :8461-:8463；通知动作按 name+size(+receivedAtMs) 找文件 :1609-1611 |
| Taildrive 上传冲突 | `components/TaildriveBrowser.ets:1100-1160, 1411-1450`；`services/TaildriveGateway.ets:56-57, 74, 266-270` | 默认 `overwrite=false` 上传；`already_exists`/`file_exists` 且未 overwrite → 弹覆盖对话框；暂存目录已存在即抛 |
| 已闭环的单点判据 | `scripts/test-*.mjs`（宿主侧纯逻辑） | 67 / 70 条 `状态：closed`，各带字面用例名 |

### 1.3 修改（本层提出、本层不实施）

| # | 内容 | 为什么 | 影响判据 |
| --- | --- | --- | --- |
| M-1 | 三个「状态文件新鲜度」常量收敛为单一权威源。**Q9 决策已解决**：`VPN_STATUS_FRESH_MS` 只在 `VpnStatusReader.ets:12` 定义一次（见 §八 D-1） | 同一个文件被两个不同的窗口读 | O-STATUS-01…09、O-BGTASK-02/03/13/14/15 |
| M-2 | 状态词表增补 `connecting`。**Q10 决策已解决**：`VpnLinkState` 增 `CONNECTING`，`judge` 增 connecting 分支（见 §八 D-2） | 卡片与读取器曾经各用一套词表 | O-BGTASK-13、O-BGTASK-14、O-STATUS-*（卡片一致性） |
| M-3 | `VpnLinkState` 判定顺序与 `readStatus` 判定顺序对齐。**Q13 决策已解决**：`readStatus` 调 `judge`，两处只有一份顺序（见 §三 表 4 与 §八 D-3） | 同一行在两侧曾可解析出相反结果 | O-STATUS-02、O-STATUS-04、O-STATUS-07 |
| M-4 | 四台状态机的转换表落成可执行断言的表驱动用例（见 §六） | 现在只有行为用例，没有转换覆盖 | 全部 |

**M-1…M-3 已由 Q9、Q10、Q13 决策落地**（代码与判据均已改动）。**M-4 仍未实施**：转换表尚未落成表驱动用例。两条记录都保留在此，作为「曾出过什么错、后来怎么改」的凭证。

### 1.4 新增 / 不存在 / 不可达（绝不写成实现）

| 项 | 现状 | 依据 |
| --- | --- | --- |
| 集成测试 | **部分存在**。第 8 轮起有 3 个文件：`scripts/integration/diagnostic-redaction.mjs`、`persistence-ownership.mjs`、`status-vocabulary.mjs`。它们把两个**真实模块**放进同一个桩边界里，经真实落盘路径交接，但不加载 `.so`，也不跨进程 | HLD §5.3 |
| special-scenario 长时任务 | **不可达**。`SPECIAL_SCENARIO_SUBMODE = 0`（`VpnBackgroundTaskManager.ets:31`）使 `startSpecialScenario` 在 :257-259 直接返回 false | HLD Q-08 |
| VPN 替换批准通道 | **写方缺失，不可达**。全仓只有常量与读路径 | HLD C-16 / Q-03 |
| Moonlight 串流 | **不可达**。三字段空串使 `isAvailable()` 恒 false | HLD C-13 / Q-04 |
| 连接窗口 15 s 真机复现 | **未重跑** | HLD §3.3 |
| 720 s 蜂窝锁屏存活 | **未完成**（M-11） | S3/O-SEAM-11 已知局限 |

**结论**：本层之下，MeshArc 的「已有」是四台状态机 + 两套编排 + 70 条宿主侧单点判据；「没有」是全部跨进程证据。LLD 只能把「没有」变成**可写成断言的行**，不能把它变成「有」。

---

## 二、类、方法与责任

可见性一律照抄代码：`private` 只在类内，`static` 不依赖实例，`readonly` 用于回调字段。

### 2.1 `VpnBackgroundTaskManager`（S2，P1）

| 成员 | 可见性 | 责任 | 调用者 | 依赖 |
| --- | --- | --- | --- | --- |
| `register(context)` | public | 注册两个系统监听、起身 1 s 巡检 | `EntryAbility` | `backgroundTaskManager`、`fileIo` |
| `unregister()` | public | 摘监听、停巡检、世代 +1、收尾 reconcile | `EntryAbility` | 同上 |
| `onBackground` / `onForeground(ctx)` | public | 生命周期边沿；前台只清退避、**不清用户抑制** | `EntryAbility` | — |
| `reconcile(ctx)` | private async | **唯一决策点**：读状态 → 分类 → 启/停任务 → 刷通知 | 1 s 定时器、三个生命周期入口 | `readStatus`、`start`、`stop`、`updateNotification` |
| `start(ctx, generation)` | private async | 取 `dataTransfer` 长时任务；三处世代/取消代数守卫 | `reconcile` | `wantAgent`、`backgroundTaskManager` |
| `startSpecialScenario(...)` | private async | 特殊场景任务；**默认惰性** | `start` | `backgroundTaskManager` |
| `stop(ctx)` | private async | 释放任务；失败只记账不抛 | `reconcile`、`start` 的善后 | `backgroundTaskManager` |
| `updateNotification(ctx, status)` | private async | LIVE_VIEW 实况窗，30 s 节流 | `reconcile` | `notificationManager` |
| `readStatus(filesDir)` | private | 状态文件 → `{state, tx, rx}`；**委托 `VpnStatusReader.readText`**，不再自解析 | `reconcile`、`start` | `VpnStatusReader`、`fileIo`、`StoragePaths` |
| `isLiveState(state)` | private static | `connected` 或 `connecting` 即应持有任务 | `reconcile`、`start` | — |
| `formatBytes(bytes)` | private | 字节格式化 | `updateNotification` | — |
| `scheduleRetry()` | private | 指数退避设 `nextStartAtMs` | 取消回调、`reconcile` 的 catch | — |
| `cancelCallback` / `suspendCallback` | private readonly | 系统回调 | `backgroundTaskManager` | — |

**责任边界**：本类**只**决定「要不要替一个没有 UI 的进程活着」，不读引擎、不写状态文件、不碰文件协议。它的输入只有 `vpn-probe-status.txt` 与系统回调。

### 2.2 `VpnCommandStateMachine`（S1，P1）

| 成员 | 可见性 | 责任 | 调用者（全部在 `BridgeStatus`） |
| --- | --- | --- | --- |
| `begin(command)` | public | 取号；**在途时返回 0**；按命令种类设初态 | :2061（LOGIN）、:2359（CONNECT）、:2512（DISCONNECT） |
| `isActive(id)` | public | `id > 0 && id === activeCommandId` | 16 处（:2076…:2491 等） |
| `complete(id, state)` | public | 归还号并把状态置为给定值 | :2104/:2115/:2417/:2427/:2436/:2498/:2511/:2583/:2600/:3574/:4326 |
| `timeout(id)` | public | `complete(id, TIMED_OUT)` | :2537 |
| `invalidateLifecycle()` | public | 世代 +1、在途号清零；**状态不变** | :948、:1029 |
| `currentState()` | public | 读当前状态 | :2575、:2592 |
| `currentLifecycleGeneration()` | public | 读世代，用于迟到 `.then` 的丢弃 | :3466、:3469、:3478 |

**关键责任事实（必须写进测试）**：这台机器**只有一个实例、只被 UI 路径使用**（`BridgeStatus.ets:760`）。headless 路径（`VpnSessionController`）**不**用它——它用的是 `VpnActionResult`（`VpnSessionController.ets:41-51`）。这就是 C-10「两套命令状态机」的准确含义：不是「同一台机器被两处用」，而是「一套命令状态机 + 一套返回值枚举」。O-SEAM-10 的「两套命令状态机与诊断事件名的重复」应据此理解为**两种记法**。

### 2.3 `VpnReconnectSupervisor`（S2，P1）

| 成员 | 可见性 | 责任 | 调用者 |
| --- | --- | --- | --- |
| `onForeground()` / `onBackground(nowMs)` | public | 生命周期边沿；前台清阶梯 | `EntryAbility` |
| `noteRequestedStop()` / `noteRequestedStart()` | public | 记用户意图；两者都清阶梯 | `EntryAbility.performCardToggle` :210/:212，UI 断开/连接路径 |
| `poll(filesDir, nowMs)` | public async | **唯一决策点**：采样一次、判边沿、交 `handleDrop` | `EntryAbility` 的巡检 |
| `handleDrop(filesDir, nowMs)` | private | 四道守卫后发起 `controller.connect` | `poll` |
| `record(filesDir, event, code)` | private | 诊断；自身 try/catch 使诊断永不反噬恢复 | 全部 |

**责任边界**：本类持有**意图记忆**，不持有连接。它调 `VpnSessionController.connect`（headless 路径），因此是 O-SEAM-10 的**入口之一**，但它自己的判据主题是「该不该重连」，不是「两条编排是否同步」——这正是 §八 A-1 的归属问题。

### 2.4 `VpnStatusReader`（S7/S1/S2 共用，P1）

导出的 `VPN_STATUS_FRESH_MS`（:12，15000）是全仓唯一的新鲜度定义（Q9 决策）。`VpnLinkState` 现在有 5 个成员，含 `CONNECTING`（:14-20）。

| 成员 | 可见性 | 责任 | 调用者 |
| --- | --- | --- | --- |
| `read(filesDir)` | public static | 文件访问：`accessSync` + `readTextSync`，再调 `readText`（:37-44，catch :45-48） | `VpnReconnectSupervisor.poll`、`VpnSessionController.connect/disconnect`、`FormCardService.buildBindingData`、`EntryAbility` |
| `readText(status, nowMs)` | public static | 状态文本 → `VpnLinkSnapshot`；调 `judge`，connected 时读 tx/rx 字节计数（:67-78） | `VpnBackgroundTaskManager.readStatus` |
| `judge(status, nowMs)` | public static | **全仓唯一判读**；顺序固定（:80-100） | `readText` |
| `isDisconnected(normalized)` | private static | 5 个终态标记 | `judge` |
| `field(status, name)` | private static | 数字字段解析 | `judge`、`readText` |

`judge` 的顺序（:80-100）就是唯一的判读口径：陈旧、未来或缺失心跳 → `unknown`；终态标记 → `disconnected`，且压过运行中的隧道；`state=running` 且 `tun=true` → `connected`；`needslogin` 或 `loginurlready=true` → `needs_login`；`vpn interface established` → `connecting`；其余 → `unknown`。

**这是全仓唯一的「同一份读取被三处消费」点**：卡片（P3）、应用外壳、恢复监督者。Q10 与 Q13 决策把一致性从「头注里的声明」变成代码事实：`VpnBackgroundTaskManager.readStatus` 调 `readText`，两处不再各判一遍。§八 D-2 与 D-3 记录旧的不一致及解决方式。

### 2.5 责任分配总表（SWEBOK「责任分配」）

| 问题 | 归谁 | 不归谁 | 证据 |
| --- | --- | --- | --- |
| 连接窗口内 P1 会不会被冻结 | `VpnBackgroundTaskManager`（持有任务） | 扩展 | `judge:96-98` 报 connecting → `isLiveState:201` → `reconcile:182` 取得任务 |
| 扩展交接超时后自毁 | P1（漏答） | 扩展 | HLD C-02「责任在 P1」 |
| 后台掉线后谁恢复 | `VpnReconnectSupervisor` | 无（**责任空洞**） | HLD Q-09、S3/O-SEAM-11 |
| 状态文件该读成什么 | `VpnStatusReader.judge`（唯一判读，卡片与保活共用） | 无人另判 | Q9/Q10/Q13 决策；§八 D-1/D-2/D-3（已解决） |
| 上传覆盖与否 | 用户（对话框） | 应用不静默覆盖 | `TaildriveBrowser.ets:1129`、R-DRIVE-04 |
| 另一个 VPN 占用 | 用户（提示先断开） | 应用不静默替换 | HLD C-16、Q-03 |

---

## 三、状态转换与行为

四台状态机。每台给出：状态集、事件集、转换表（含守卫）、输出、**非法组合**。行号已逐个复核。

### 3.1 VM-1 · 保活任务生命周期（`services/VpnBackgroundTaskManager.ets`）

**状态集**（由「是否持有任务」与四个正交标志定义；代码里没有单一 enum，这就是它难以测试的原因）

| 状态 | 定义（字段条件） | 代码 |
| --- | --- | --- |
| `IDLE` 未持有 | `task === undefined && !suppressedUntilDisconnect && nextStartAtMs === 0` | :48, :50, :51 |
| `HELD_DATA` 持有(dataTransfer) | `task !== undefined && !specialScenarioTask` | :48, :55 |
| `HELD_SPECIAL` 持有(special-scenario) | `task !== undefined && specialScenarioTask` | :48, :55 |
| `SUPPRESSED` 已抑制(用户取消) | `task === undefined && suppressedUntilDisconnect` | :50 |
| `BACKOFF` 退避中 | `task === undefined && !suppressed && Date.now() < nextStartAtMs` | :51, :392 |
| `STOPPING` 停止在途 | `stopping === true` | :49 |

**事件集**：`E1` 状态文件变化（1 s 巡检，:108）；`E2` 前台（:144）；`E3` 后台（:139）；`E4` 系统取消（:70）；`E5` 用户取消（:66-68）；`E6` 启动失败/操作异常（:188）；`E7` 释放超时（:175）；`E8` 销毁（:111）。

**转换表**

| # | 当前 | 事件 | 守卫 | 下一 | 输出 | 代码 |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 任意 | E1，`state==='disconnected'` | — | IDLE | 清 `suppressed`/`nextStartAt`/`retryCount`/`lastLiveAtMs`，`stop` 一次 | :163-169 |
| T2 | 任意 | E1，`connecting\|connected` 且 `task===undefined` | `!suppressed && now>=nextStartAtMs` | HELD_DATA（或 HELD_SPECIAL 若 :219 命中） | `startBackgroundRunning(['dataTransfer'])`；`background_started` | :171, :182-183, :224-236 |
| T3 | 已持有 | E1，`live` | `generation` 与 `monitoring` 未变 | 不变 | 30 s 节流后 `publish` LIVE_VIEW | :185-187, :316-319 |
| T4 | 已持有 | E1，`!live` | `now - lastLiveAtMs > 60000` | IDLE | `stop`；`background_status_timeout` | :172-178 |
| T5 | 已持有 | E1，`!live` | `now - lastLiveAtMs <= 60000` | 不变 | 无（**保留**） | :172-179 |
| T6 | 任意 | E4 系统取消 | `info.id === task.continuousTaskId`（或 task 无 id） | BACKOFF | `scheduleRetry`；`background_system_cancelled` | :59-62, :70-72 |
| T7 | 任意 | E5 用户取消 | 同上 | SUPPRESSED | **不**重试；`background_user_cancelled` | :66-69, :73 |
| T8 | HELD_* | E8 销毁 | — | IDLE | `stop`；`background_stopped` | :111-136, :193-195 |
| T9 | BACKOFF | E2 前台 | — | IDLE | `nextStartAtMs=0`，`retryCount=0`，立刻 reconcile | :146-148 |
| T10 | BACKOFF | E6 启动失败 | — | BACKOFF（基数×2^min(n,4)，封顶 300 000） | `background_operation_failed` | :188-190, :392-396 |
| T11 | STOPPING | 任意 | `task===undefined` → `stop` 立即返回 | 不变 | 无 | :293-295 |
| T12 | 任意 | E5 之后 E1，`live` | `suppressedUntilDisconnect===true` | SUPPRESSED（不启动） | 无 | :182 |
| T13 | HELD_SPECIAL | E1，`live` | `specialScenarioTask` | 不变 | **不刷实况窗**（早退） | :310-314 |

**启动窗口的三重守卫（T2 的实现细节，必须逐条断言）**

1. 取号前查 `monitoring/generation/revision` 且**再读一次状态**（:214-218）——状态在这几毫秒里变成 disconnected 就不启动；
2. `startBackgroundRunning` 返回后再查 `revision`（:226-228）——期间收到取消就丢弃这个迟到的成功结果；
3. 落 `task` 后再查 `monitoring/generation` 与**再一次**读状态（:230-234）——不成立就立刻 `stop`。

**非法组合（本状态机必须永不出现，以及被问到时的行为）**

| # | 非法组合 | 代码遇到时的行为 | 判定 |
| --- | --- | --- | --- |
| I1 | 同一时刻存在两个 `dataTransfer` 任务 | `operationInFlight`（:152）与 `stopping`（:49, :296）串行化；`stop` 在途时 `task` 仍非空（:293 有值才停），新的 reconcile 只走 T4/T5 分支，不起第二个 | 已守 |
| I2 | 迟到启动成功复活「已被取消」的任务 | `revision` 快照（:206）比对（:226）→ 丢弃 | 已守（O-BGTASK-10） |
| I3 | 迟到启动成功复活「已销毁」的任务 | `generation`（:156/:214/:230）→ `stop` 善后 | 已守（O-BGTASK-10） |
| I4 | 用户取消后自行恢复 | `suppressedUntilDisconnect` 只在读到 **disconnected** 时清（:164），前台不清 | 已守（O-BGTASK-06） |
| I5 | 凭陈旧/未来/缺失心跳新建任务 | `VpnStatusReader.judge:83` 三条守卫 → `unknown` → 不 live（:172） | 已守（O-BGTASK-03） |
| I6 | 停滞的连接窗口永久占住任务 | `lastLiveAtMs` 只在 live 时推进（:181）；停滞 60 s 后 T4 | 已守（O-BGTASK-15） |
| I7 | 非本任务的取消事件误伤本任务 | `info.id !== task.continuousTaskId` → return（:59-62） | 已守（O-BGTASK-08） |
| I8 | 销毁与 `publish` 并发（留下「通知已撤而任务仍在」） | `updateNotification` 由 reconcile 的 `await` 串起，`finally`（:193-195）在 publish 返回后才 stop | 已守（O-BGTASK-11） |
| I9 | special-scenario 与 dataTransfer 同时持有 | `startSpecialScenario` 成功即 `return`（:219-221），走不到 `startBackgroundRunning` | 已守；但**整条路径不可达**（:257-259），本行只证明「不可达时不会误伤」 |
| I10 | `HELD_DATA` 被当成 `HELD_SPECIAL` 去刷实况窗 | `specialScenarioTask` 早退（:310） | 已守 |
| I11 | **同一份状态文件在 `readStatus` 与 `VpnStatusReader` 里得到相反的态** | **已守（Q13 决策）**。`readStatus:351` 调 `VpnStatusReader.readText`，两处只有一份顺序。`judge:87-89` 先判终态标记，因此一行同时含 `state=Running\|tun=true` 与 `state=stopped` 时两边都报 disconnected | 已守（O-STATUS-04；§八 D-3） |

### 3.2 VM-2 · `VpnCommandStateMachine`（`services/VpnCommandGateway.ets:25-75`）

**状态集**：`stopped` / `starting` / `needs_login` / `running` / `stopping` / `timed_out`（:6-13）＋一个正交的 **`activeCommandId`（0 或正整数）**。真正决定「是否在途」的是后者，不是状态名。

**事件集**：`begin(connect|login|disconnect)`、`complete(id, state)`、`timeout(id)`、`invalidateLifecycle()`。

**转换表**

| # | 当前 | 事件 | 守卫 | 下一状态 | `activeCommandId` | 输出 | 代码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U1 | `stopped` | `begin(CONNECT)` | `activeCommandId === 0` | `starting` | `nextCommandId++` | 返回新号 | :32-37 |
| U2 | `stopped` | `begin(LOGIN)` | 同上 | `needs_login` | 同上 | 返回新号 | :38-39 |
| U3 | `stopped` | `begin(DISCONNECT)` | 同上 | `stopping` | 同上 | 返回新号 | :40-42 |
| U4 | 任意 | `begin(*)` | `activeCommandId > 0` | **不变** | 不变 | **返回 0**（拒绝） | :32-34 |
| U5 | 在途 | `complete(id, S)` | `isActive(id)` | `S` | 0 | 返回 true | :50-57 |
| U6 | 在途 | `complete(id', S)` | `id' !== activeCommandId` | 不变 | 不变 | 返回 false（**静默忽略**） | :51-53 |
| U7 | 在途 | `timeout(id)` | `isActive(id)` | `timed_out` | 0 | 返回 true | :59-61 |
| U8 | 任意 | `invalidateLifecycle()` | — | **不变** | 0 | 无 | :63-66 |

**代码里的实际落点**（把表接到生产行为上）

| 转换 | 生产调用点 |
| --- | --- |
| U1 | `BridgeStatus.ets:2359` |
| U2 | :2061 |
| U3 | :2512 |
| U4（返回 0） | 所有 `begin` 返回值都被当作可判空；`connectCommandId = 0` 时后续 `isActive` 恒 false |
| U5→`running` | :3574（连接成功 `commitConnectedStatus`）、:2115（登录完成） |
| U5→`needs_login` | :2104、:2417 |
| U5→`stopped` | :2427、:2436、:2498、:2511、:2583、:2600、:4326 |
| U7 | :2537（停止应答 7.5 s 超时） |
| U6 的读法 | :2575、:2592 用 `currentState() !== TIMED_OUT` 决定是否补记「已停」 |
| U8 | :948、:1029（UI 生命周期失效） |

**非法组合**

| # | 非法组合 | 行为 | 判定 |
| --- | --- | --- | --- |
| J1 | 两个命令同时在途 | U4 使第二个 `begin` 拿不到号（返回 0） | 已守 |
| J2 | 把 `0` 当成有效命令号 | `isActive` 的 `commandId > 0`（:47）使它恒 false；`complete(0, S)` 恒返回 false | 已守 |
| J3 | 迟到的 `.then` 覆盖新一轮命令 | U6 静默忽略；跨生命周期的迟到用 `currentLifecycleGeneration()` 比对（:3466/:3469/:3478） | 已守 |
| J4 | **`invalidateLifecycle` 之后 `currentState()` 报告旧态** | `invalidateLifecycle` **不重置** `state`（:63-66 只动世代与在途号）。销毁后 `currentState()` 可能仍返回 `running`/`starting` | **未守（登记）**：调用点 :2575/:2592 只比 `TIMED_OUT`，不查在途号，因此这条「陈旧态」不会被误用为「有在途命令」，但把它当成「当前状态」会读到失效的值 |
| J5 | `begin(CONNECT)` 在已连接时启动新一轮 | **无守卫**。本机不看状态文件，「已连上」由调用方在 `BridgeStatus.beginVpnConnection` 侧早退；命令状态机本身允许 `starting` | 未守（分层责任：幂等由 O-SESSION-01/早退守） |
| J6 | `stopping` 与 `starting` 交错（先断后连） | 由 `BridgeStatus` 的 `disconnectInProgress`/`connectInProgress` 与 U4 共同隔离；机器本身不区分 | 部分守 |

### 3.3 VM-3 · `VpnReconnectSupervisor`（`services/VpnReconnectSupervisor.ets`）

**状态集**（同样是「标志 + 边沿」而非 enum）

| 状态 | 定义 |
| --- | --- |
| `WATCHING` 观察中 | `lastState !== DISCONNECTED` 或尚未见过掉线边沿 |
| `OFFLINE_PENDING` 已掉线待恢复 | 刚由 `CONNECTED → DISCONNECTED` 边沿进入，正判是否重连 |
| `BACKOFF` 退避中 | `attempts >= 1 && now < nextAttemptAtMs` |
| `EXHAUSTED` 已耗尽 | `attempts >= 3` |
| `USER_STOPPED` 已被用户请求停止 | `stopRequested === true` |
| 正交标志 | `inForeground`、`backgroundSinceMs`、`connectedSinceMs`、`polling`（重入互斥） |

**事件集**：`poll` 的一次采样（`connected` / `disconnected` / `needs_login` / `unknown`）；`onForeground`；`onBackground`；`noteRequestedStop`；`noteRequestedStart`；`STABLE_MS` 到期。

**转换表**

| # | 当前 | 事件 | 守卫 | 下一 | 输出 | 代码 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | WATCHING | 采样 connected，上一态非 connected | — | WATCHING（记 `connectedSinceMs`） | 无 | :88-90 |
| R2 | WATCHING | 采样 connected，`attempts > 0` | `now - connectedSinceMs >= 60000` | WATCHING（`attempts=0`，`nextAttemptAt=0`） | `vpn_reconnect_succeeded` | :91-95 |
| R3 | WATCHING | 采样 connected，`attempts > 0` | 稳定不足 60 s | WATCHING（**不清零**） | 无 | :91 |
| R4 | WATCHING | 采样 disconnected，上一态 connected | 无 | OFFLINE_PENDING → 立即进 R5…R9 | — | :98-101 |
| R5 | OFFLINE_PENDING | 同上 | `stopRequested` | USER_STOPPED | `vpn_drop_after_requested_stop` | :108-111 |
| R6 | OFFLINE_PENDING | 同上 | `inForeground \|\| backgroundSinceMs===0 \|\| now-backgroundSince < 10000` | WATCHING | `vpn_drop_ignored_foreground` | :112-118 |
| R7 | OFFLINE_PENDING | 同上 | `attempts >= 3` | EXHAUSTED | `vpn_reconnect_exhausted` | :119-122 |
| R8 | OFFLINE_PENDING | 同上 | `now < nextAttemptAtMs` | BACKOFF | **无输出**（静默） | :123-125 |
| R9 | OFFLINE_PENDING | 同上 | 四道守卫全过 | BACKOFF | `attempts++`；`nextAttemptAt = now + min(300000, 30000·2^(attempts-1))`；`vpn_reconnect_attempt`；`controller.connect` 不 await → `vpn_reconnect_started`/`_not_started`/`_failed` | :126-134 |
| R10 | 任意 | 采样 disconnected，上一态**不是** connected | — | 不变 | **无输出** | :98 |
| R11 | 任意 | 采样 unknown / needs_login | `state !== DISCONNECTED` | 不变 | **无输出** | :98 |
| R12 | 任意 | `onForeground()` | — | WATCHING（`attempts=0`，`nextAttemptAt=0`） | 无 | :47-54 |
| R13 | 任意 | `onBackground(now)` | — | 不变 | 记 `backgroundSinceMs` | :56-59 |
| R14 | USER_STOPPED | `noteRequestedStart()` | — | WATCHING | 清 `stopRequested`/`attempts`/`nextAttemptAt` | :69-73 |
| R15 | 任意 | `poll` 重入 | `polling === true` | 不变 | 立即返回 | :79-81 |

**非法组合**

| # | 非法组合 | 行为 | 判定 |
| --- | --- | --- | --- |
| K1 | 两次连续 `disconnected` 各触发一次重连 | 边沿触发（:98 `previous !== CONNECTED` 即返回） | 已守（O-RECONN-01 边界） |
| K2 | `unknown` 被当成掉线 | R11 无输出；**连诊断事件都不记** | 已守（O-RECONN-07） |
| K3 | 用户已按断开后又把隧道拉回来 | R5 优先于「后台够久」 | 已守（O-RECONN-03） |
| K4 | 刚进后台/在前台的掉线被恢复 | R6 的 10 s 静置 | 已守（O-RECONN-02） |
| K5 | 网络抖动变成每秒重连 | R8 的退避窗口 | 已守（O-RECONN-06） |
| K6 | 抖动隧道无限重连 | R2 要求连续 60 s 才清零 | 已守，**但无用例**（§八 G-3） |
| K7 | 无限重试 | R7 上限 3 | 已守 |
| K8 | **重连在途时用户按下断开，连接不被中止** | `controller.connect(filesDir)` 是 **fire-and-forget**（:129），无取消句柄；`noteRequestedStop` 只防**将来**的恢复（R5），不能撤销**已经发出**的那一次 | **未守（登记）**。窗口 = 一次 `connect` 的历时（含 `ensureBackendReady` 250 ms×40 ≈ 10 s + `requestConnectConfig` 500 ms×20 ≈ 10 s，`VpnSessionController.ets:22-25`），最坏 ~20 s |
| K9 | 前台 `onForeground` 与在途 `poll` 交错 | R15 使 poll 不重入；`handleDrop` 在调用时读 `this.inForeground`（:112）故即时生效 | 已守 |
| K10 | 恢复成功但状态停在 `needs_login` | R11 无输出；`connect` 返回的 `NEEDS_UI` 由 O-RECONN 未覆盖 | 未守（无判据；见 §八 G-3 邻域） |

### 3.4 VM-4 · `VpnStatusReader` 判定优先级（`services/VpnStatusReader.ets`）

这不是「状态机」而是**优先级判定**：谁压过谁。Q13 决策把口径定死在一处，`judge`（:80-100）是唯一的顺序，终态标记压过运行中的隧道。

**顺序（短路，前者命中即返回）**

| 优先级 | 条件 | 结果 | 代码 |
| --- | --- | --- | --- |
| P0 | `!accessSync(path)` → 文件不存在 | `unknown` | :41-43 |
| P0′ | `heartbeatMs <= 0 \|\| ageMs < 0 \|\| ageMs > VPN_STATUS_FRESH_MS` | `unknown`（**短路一切**，即使同一行还写着 `state=Running\|tun=true`） | :81-85 |
| P1 | 5 个终态标记之一 | `disconnected`（**压过运行中的隧道**） | :87-89, :102-108 |
| P2 | `state=running && tun=true` | `connected`（+ tx/rx） | :90-92 |
| P3 | `needslogin \|\| loginurlready=true` | `needs_login` | :93-95 |
| P4 | `vpn interface established` | `connecting` | :96-98 |
| P5 | 其余 | `unknown` | :99 |

文件读取失败（`readTextSync` / `accessSync` 抛错）在 `read` 的 catch（:45-48）归 `unknown`。

**非法组合**

| # | 非法组合 | 行为 | 判定 |
| --- | --- | --- | --- |
| L1 | 陈旧/未来/缺失心跳被当成健康 | P0′ 短路 | 已守（O-STATUS-03） |
| L2 | `Running` 无 `tun=true` 报 connected | P2 是合取 | 已守（O-STATUS-08） |
| L3 | 陈旧登录标记盖过可用隧道 | P2 先于 P3 | 已守（O-STATUS-07） |
| L4 | `FAILED` 但含 `status unavailable` 被当成已停 | P1 的 `!includes('status unavailable')`（:107） | 已守（O-STATUS-05） |
| L5 | 缺文件报 disconnected | P0 | 已守（O-STATUS-01） |
| L6 | **同一行在 VM-1 与 VM-4 得到相反结果** | **已守（Q13 决策）**：两处只有一份顺序（见 I11）。旧的分歧是 VM-1 先判 disconnected 而 VM-4 先判 connected | 已守（§八 D-3） |
| L7 | **`connecting` 被卡片看见** | **可达（Q10 决策）**：`VpnLinkState` 增 `CONNECTING`，`judge` 报 connecting，卡片照此渲染 | 已闭环（O-STATUS-09；§八 D-2） |
| L8 | 同一行同时含 `state=Running\|tun=true` 与终态标记 | P1 先于 P2，两处都报 `disconnected` | 已守（O-STATUS-04；Q13 决策） |

### 3.5 四台机器的非法组合汇总（跨机器）

| 跨机器非法组合 | 现状 |
| --- | --- |
| VM-1 说「任务该持有」而 VM-4 说 `unknown` | **已消除（Q10/Q13 决策）**：两处调同一份 `judge`。连接窗口内 VM-1 与 VM-4 都报 `connecting`（`judge:96-98`），卡片照此显示（`FormCardService:102`） |
| VM-2 的 `running` 与 VM-3 的 `WATCHING` 不一致 | 无守卫。VM-2 由 UI 命令驱动，VM-3 由状态文件驱动；两者可以同时成立（VM-2=`running` 且 VM-3 已见掉线边沿）。这是设计（两套独立判据），但**没有任何判据断言它们的分歧有界** |
| VM-3 发起 `connect` 时 VM-2 未参与 | 正常：headless 路径不用 VM-2（§2.2） |
| VM-1 的 `HELD_*` 与 VM-3 的恢复同时作用 | 可以同时动作：VM-3 只做「请求连接」，VM-1 只做「持有任务」，不冲突 |

---

## 四、算法与数据结构

每节：输入 / 输出 / 不变量 / 边界 / 异常。复杂度只在适用处写。

### 4.1 字节格式化（`formatBytes`）

两处**独立实现**，逐字相同：`VpnBackgroundTaskManager.ets:359-367` 与 `FormCardService.ets:122-130`。调用点：保活实况窗 :321、卡片详情 :119。

- **输入**：`bytes: number`（来自状态文件 `txBytes`/`rxBytes` 的数字字段）。
- **输出**：`≥1 GiB` → `x.x GiB`；`≥1 MiB` → `x.x MiB`；否则 `x.x KiB`。**没有 B 档**。
- **不变量**：输出恒为「一位小数 + 空格 + 三选一单位」；永不为空、永不抛错（纯算术）。
- **边界（必须断言）**：
  - `0` → `0.0 KiB`（**不是** `0 B`）；
  - `1023` → `1.0 KiB`（**向上进位**：`1023/1024 = 0.999…` → `toFixed(1)` = `1.0`）；
  - `1024` → `1.0 KiB`；`1048575` → `1024.0 KiB`（**不是** `1.0 MiB`，因为判定用 `>=` 于 1 MiB 之前的那一档）；
  - `1048576` → `1.0 MiB`；`1073741824` → `1.0 GiB`；
  - `NaN`/`Infinity`：`NaN >= x` 恒 false → 落到 KiB 分支，输出 `NaN KiB`。**上游不给 NaN**（`VpnStatusReader.field:110-114` 只返回安全非负整数），所以这是「不可达但未防御」的边界，登记不修改。
- **异常**：无（无 I/O、无分配）。
- **重复**：同一算法两份实现，任一改动都会让实况窗与卡片对同一字节数显示不同单位。本层登记为**已知重复**（HLD §七 第 4 条同源）。

### 4.2 状态文件解析：心跳缺失 / 未来 / 陈旧

只有一个实现：`VpnStatusReader.field:110-114`（Q10 决策删除了 `VpnBackgroundTaskManager.statusNumber`）。正则：

```
new RegExp(`(?:^|\s)${field}=(\\d+)(?:\s|$)`)
```

- **输入**：整份状态文件文本（形如 `<可见状态> | heartbeatMs=<ms>`）。
- **输出**：`{ state, txBytes, rxBytes }`（VM-1）或 `VpnLinkSnapshot`（VM-4）。
- **不变量**：
  1. 新鲜度守卫**先于**任何语义判定（唯一判读 `judge:83`）；
  2. 任何不确定 → `unknown`，**从不**→ `disconnected`（安全方向：缺证据不等于断开）；
  3. 字段缺失 → 0（正则不匹配），而非抛错。
- **边界（三条，均已闭环）**：

| 边界 | 输入 | `ageMs` | 结果 | 判据 |
| --- | --- | --- | --- | --- |
| 缺失 | 无 `heartbeatMs=` | `now-0` 巨大 | `unknown` | O-STATUS-03 / O-BGTASK-03 |
| ≤0 | `heartbeatMs=0` 或 `=1` | `>=0` 但 `heartbeatMs<=0` | `unknown` | 同上 |
| 未来 | `heartbeatMs = now+1` | `<0` | `unknown` | O-STATUS-03 |
| 陈旧 | `heartbeatMs = now-15001` | `>15000` | `unknown` | O-STATUS-03 |
| 恰好新鲜 | `ageMs === 15000` | `=15000` | **不触发守卫**（`>` 非 `>=`）→ 继续语义判定 | 未单列判据 |

- **异常**：`readTextSync`/`accessSync` 抛错 → catch → `unknown`（`VpnStatusReader.read:45-48`）。原子替换期间的半写也走这条。
- **不变量 4（跨文件）**：同一份文件的两个读者必须给出**同一态**。**现已成立**（Q9/Q10/Q13 决策）：两处调同一份 `judge`，也共用同一个新鲜度常量。旧的假状态见 §八 D-1/D-3。
- **复杂度**：O(n)，n = 文件字节数；每 1 s 一次（VM-1）与每 250 ms 一次（`BridgeStatus` :139）。无累积状态。

### 4.3 `requestId` 匹配

三处实现，口径必须一致：

| 位置 | 逻辑 | 代码 |
| --- | --- | --- |
| headless 停止应答 | `JSON.parse(response).requestId === requestId`；解析失败 → false | `VpnSessionController.ets:263-270` |
| UI 停止应答 | `response.requestId === this.vpnStopRequestId` | `BridgeStatus.ets:2547` |
| headless 交接请求 | `requestIdOf(requestText)`；**解析失败或 ≤0 即拒** | `VpnSessionController.ets:156-159, 178-185` |

- **输入 / 输出**：应答 JSON 文本 + 期望号 → 布尔。
- **不变量**：
  1. **先清响应再写请求**（`VpnSessionController.ets:126-129`、`BridgeStatus` :2521）——否则上一轮的应答会被当成本轮的；
  2. 命中后**清响应**（`VpnSessionController.ets:233`、`BridgeStatus.ets:2549`）——使同一个应答不被消费两次；
  3. 不匹配**不消费**（继续轮询）；
  4. 请求侧：`requestId <= 0` 或非 JSON → 清请求、记 `vpn_backend_handoff_request_invalid`、**不作答**（:157-160）——不得替扩展确认一次不存在的交接。
- **边界**：`requestId` 恰为 `0`（合法 JSON）；负号；浮点（`requestIdOf` 直接 `Number`，例如 `1.5` 会**通过** `<=0` 检查——**这是未防御的边界**，扩展侧只发整数，故登记不修改）；`requestId` 超过 `Number.MAX_SAFE_INTEGER`（字符串比对会成功，但 `===` 在 JS 里会失配）。
- **异常**：`JSON.parse` 抛 → 按非法处理（不吞成「有效 0」）。

### 4.4 Taildrop 同名不同大小的区分

- **身份定义**：`taildropWaitingFileKey(file) = \`${file.name}:${file.size}\``（`BridgeStatus.ets:6981`）。
- **使用点**（三处，口径必须一致）：
  1. 等待文件列表去重（:3821-3826）：`candidate.name === file.name && candidate.size === file.size` 时**沿用旧的 `receivedAtMs`**，否则用新时间戳；
  2. 通知动作定位（:1609-1611）：`name === request.fileName && size === request.size && (request.receivedAtMs < 0 || candidate.receivedAtMs === request.receivedAtMs)`；
  3. 待删标记（:7010-7012）：`name === file.name && size === file.size`。
- **不变量**：**同名不同大小是两个不同条目**；同名同大小是同一个条目（沿用首次 `receivedAtMs`，避免刷新把它顶到列表最前）。
- **边界**：

| 情形 | 期望 | 依据 |
| --- | --- | --- |
| `a.bin (100 B)` 与 `a.bin (200 B)` 同批到达 | 两条独立条目，各自可保存/删除 | :6981, :3823 |
| `a.bin (100 B)` 再次出现在下一批 | 同一目，`receivedAtMs` 不变 | :3824 |
| 名称含路径分隔符 / `.` / `..` / 空 / >255 | 形状非法，被过滤 | :6985-6988 |
| `size < 0` | 形状非法 | :6988 |
| 通知只带名称不带大小 | **无法匹配**（合取要求 size 相等）；`request.receivedAtMs < 0` 只放宽时间戳，不放宽大小 | :1609-1611 |
| 排序 | 先按 `receivedAtMs` 降序，再按小写名称，最后按 `size` | :7002-7008 |

- **异常**：无 I/O 在这段；纯函数式过滤 + 排序。
- **未覆盖**：`taildropWaitingFileKey`（:6981）与 `isTaildropPendingDelete`（:7010）在 P4 的 70 条判据里**没有对应用例**；`name:size` 这条身份规则只在 :1609 / :3821 间接被覆盖。登记为覆盖空缺（§八 G-4）。

### 4.5 上传冲突判定（Taildrive）

- **输入**：`TaildriveTransferRequest { requestId, remotePath, localRoot, localPath, sourceModifiedAtMs?, overwrite? }`（`TaildriveGateway.ets:67-75`）与原生返回的 `TaildriveTransferSnapshot { state, reason, … }`（:77-88）。
- **不变量**：
  1. **默认不覆盖**：`overwrite` 未传即 falsy；
  2. 冲突是**终态返回**，不是抛错：`reason ∈ {'already_exists','file_exists'}`；
  3. 只有「未要求覆盖」且「原生报冲突」时才弹对话框（`TaildriveBrowser.ets:1129`）；
  4. 用户确认后**以 `overwrite: true` 重发同一请求**（:1446），而不是就地改文件；
  5. 暂存目录以 `requestId` 命名，已存在即抛（`TaildriveGateway.ets:266-270`），并在失败时 `cleanupStagedDirectory` 回收（:295）。
- **边界**：原生返回 `state==='completed'` 但 `reason` 非空（**以 state 为准**，:1124）；`reason` 为空串 → 回落 `'upload_failed'`（:1131）；暂存校验失败（大小不符）→ 抛（:288-290）。
- **异常**：整个 `executeUpload` 的 catch 归 `upload_failed` + `setRetry('upload')`（:1137-1141），不吞成成功。
- **覆盖空缺**：8 条 O-BUILD/ODRIVE 判据里**没有**上传冲突用例；O-DRIVE-01/02 是旅程判据，无单点判据挂接（§八 G-4）。

### 4.6 数据组织小结

| 数据 | 结构 | 不变量 | 越界行为 |
| --- | --- | --- | --- |
| 保活任务标志 | 15 个布尔/数字标量（无 struct） | 见 §3.1 状态集定义 | 无守卫；靠 §3.1 转换表穷举 |
| 命令状态 | `{generation, activeCommandId, nextCommandId, state}` | `activeCommandId === 0` ⟺ 无在途 | `0` 是哨兵 |
| 恢复阶梯 | `{attempts, nextAttemptAtMs, backgroundSinceMs, connectedSinceMs}` | `attempts <= 3` 由 R7 保证 | 与前台/后台边沿耦合 |
| 等待文件列表 | `TaildropWaitingFileSummary[]`，身份 `name:size` | §4.4 | 形状过滤 :6985 |
| Taildrive 请求 | `{requestId, operation, payload}` | 四通道各自串行 | 单请求超时 32 s/35 s/30 min+10 s/5 s |

---

## 五、UI 与生命周期

### 5.1 交互与状态反馈

| UI 面 | 数据来源 | 反馈 | 代码 |
| --- | --- | --- | --- |
| 首页连接状态 | `BridgeStatus` 自己的 250 ms 轮询 + `fileIo.createWatcher(CLOSE_WRITE)` | `vpnStatus` 文本；连接窗口内的宽限文案 | :139, :3524-:3536, :3497-:3520 |
| 卡片（P3） | `VpnStatusReader.read` → `FormCardService.stateName` | 5 个态名：`connected`/`disconnected`/`connecting`/`needs_login`/`needs_setup` | `FormCardService.ets:14-18, 86-108` |
| 实况窗 | `VpnBackgroundTaskManager.updateNotification` | `↑ <tx>  ↓ <rx>`，`typeCode 8`，进度恒 0 | :319-336 |
| 覆盖确认（Taildrive） | 原生返回 `already_exists` | 模态对话框，取消 / 替换 | `TaildriveBrowser.ets:1147-1160` |
| 冲突提示（其它 VPN） | `vpn_conflict` → `showVpnConflictDialog` | 提示用户**手动**断开其它 VPN | `BridgeStatus.ets:4350-4375` |

**卡片与应用曾经可能各说各话的地方**（本层发现的用户可见分歧）：连接窗口内读取器曾返回 `unknown`，卡片把它渲染成 `connecting`（`FormCardService.ets:102`）。**现已消除**（Q10/Q13 决策）：读取器报 `connecting`，卡片、应用与保活任务用同一份结果。旧的词表不一致见 §八 D-2。

### 5.2 异步取消（逐台机器）

| 机器 | 取消机制 | 覆盖 | 缺口 |
| --- | --- | --- | --- |
| VM-1 | `cancellationRevision`（:64）+ `lifecycleGeneration`（:106/:113）+ `operationInFlight`（:152）+ `stopping`（:49） | 迟到启动结果（O-BGTASK-10 三条用例）、销毁与 publish 串行（O-BGTASK-11）、停止与启动串行（O-BGTASK-12） | 无 |
| VM-2 | 在途号（`isActive`）+ `currentLifecycleGeneration()` 比对（:3466-3478） | J3 迟到结果（在 `BridgeStatus` 侧用世代比对） | J4：`invalidateLifecycle` 不重置状态名 |
| VM-3 | `polling` 重入互斥（:79-81）+ 意图标志 | R15 | **K8：在途的 `connect` 不可取消**（无句柄） |
| VM-4 | 无异步（纯同步读） | 不适用——它没有异步状态需要取消，读一次得一个快照 | 不适用 |

**K8 是唯一真正的取消缺口**：`VpnReconnectSupervisor.handleDrop` 里 `this.controller.connect(filesDir).then(...).catch(...)`（:129-134）不持有任何可取消对象。用户在重连在途时按断开，只能靠 R5 阻止**下一次**，不能中止**这一次**。最坏窗口 ≈ 20 s（`ensureBackendReady` 10 s + `requestConnectConfig` 10 s，`VpnSessionController.ets:22-25, 201-224`）。**本层只登记，不修复，不加判据 ID。**

### 5.3 资源释放

| 资源 | 释放点 | 幂等 | 代码 |
| --- | --- | --- | --- |
| 长时任务 | `stop`（:292）；`task === undefined` 早退 :293 | 是 | :292-307 |
| 系统监听 | `unregister` 的 `off`（:120/:128），各自 try/catch | 是（`listenerRegistered` 标志） | :111-133 |
| 巡检定时器 | `clearInterval` + `monitorTimer = -1`（:114-117） | 是 | 同上 |
| WantAgent | 不显式释放（系统持有） | — | :213 |
| 卡片刷新 | `refreshAll` 全量推送，幂等 | 是 | `FormCardService.ets:47-73` |
| 诊断事件 | 每文件 100 条 / 24 KB，淘汰最旧 | 是 | `DiagnosticEventStore.ets:112-116` |

**不适用说明**：VM-4（`VpnStatusReader`）**没有资源生命周期**——它是静态纯函数，不持有 fd、定时器或缓存；因此「异步取消与资源释放」对它是**不适用**，理由是没有需要释放的状态。VM-2 同理（无 I/O 句柄；命令文件由写方负责），唯一需注意的资源是它自身的 `activeCommandId`，其释放即 U5/U7 的归零。

### 5.4 生命周期边沿的完整序（必须一次走全）

`EntryAbility.onCreate` → `VpnBackgroundTaskManager.register`（:88）→ 1 s 巡检起身
→ `onBackground`（:139）→ 巡检持续 → 连接窗口内取得任务（T2）
→ `onForeground`（:144）→ 只清退避（:146-147）
→ 用户断开 → T1 → IDLE
→ `aboutToDisappear`/`onDestroy` → `VpnCommandStateMachine.invalidateLifecycle()`（`BridgeStatus.ets:948/:1029`）+ `unregister`（:111）

---

## 六、判据与测试计划

**本表收录 `docs/oracles/points/` 全部 70 条单点判据。** 已闭环的写它锚的用例；未闭环的写在「单元测试计划」栏并注明归属（对齐判据的 `归属`）。父接缝与 HLD 契约两栏照抄判据现文，**分歧不加修饰**（复核结论见 §八 A）。

状态口径：**closed = 67 条**；**pending-test = 3 条**（O-RECONN-09、O-SESSION-07、O-PEER-11）。

### 6.1 O-BGTASK-01…15 / O-STATUS-01…09（`P1-background-status.md`）

| 单点判据 | 类/方法 | 父接缝 | 单元测试计划 | 对应集成场景 |
| --- | --- | --- | --- | --- |
| O-BGTASK-01 | `VpnBackgroundTaskManager.start` :224 / `updateNotification` :309 / `formatBytes` :382 | O-SEAM-11（HLD C-11） | closed：`test-vpn-background-task.mjs::acquires protection in foreground and updates the same system live view with real traffic` | O-CONN-01/06（O-SEAM-11 无集成锚点，HLD §5.3 记待建） |
| O-BGTASK-02 | `reconcile` :171 宽限分支 / `readStatus` :344 | O-SEAM-03、O-SEAM-11（HLD **仅 C-03**） | closed：`…::stale heartbeat and read errors retain acquired protection for a bounded grace period` | O-CONN-06 |
| O-BGTASK-03 | `readStatus` :344 / `reconcile` :182 启动条件 | O-SEAM-03、O-SEAM-11（HLD **仅 C-03**） | closed：`…::never starts from stale, future, missing heartbeat or missing TUN evidence` | O-CONN-06；边界路径 §3.2 |
| O-BGTASK-04 | `reconcile` :163 disconnected 分支 / `stop` :292 | O-SEAM-11（C-11） | closed：`…::explicit disconnect promptly releases the task`；`…::an explicit disconnect during the connect window releases promptly` | O-CONN-02 |
| O-BGTASK-05 | `judge` 的 `isDisconnected` failed 例外 :107 | O-SEAM-03、O-SEAM-11（HLD **仅 C-03**） | closed：`…::snapshot failure is uncertain and does not immediately revoke protection` | O-CONN-06 |
| O-BGTASK-06 | `cancelCallback` :57 / 启动条件 :182 / `onForeground` :144 | O-SEAM-11（C-11） | closed：`…::user cancellation stays suppressed across stale telemetry and foreground until confirmed disconnect` | O-CONN-06 |
| O-BGTASK-07 | `cancelCallback` 系统分支 :70 / `scheduleRetry` :392 | O-SEAM-11（C-11） | closed：`…::system cancellation retries with exponential backoff` | O-CONN-06 |
| O-BGTASK-08 | `cancelCallback` 的 id 守卫 :59 | O-SEAM-11（C-11） | closed：`…::unrelated cancellation does not discard the VPN task` | O-CONN-06 |
| O-BGTASK-09 | `reconcile` catch :188 / `scheduleRetry` :392 | O-SEAM-11（C-11） | closed：`…::a failed start is throttled instead of retried every second` | O-CONN-06 |
| O-BGTASK-10 | `start` 的 revision :206 / :226 / 后校验 :230 | O-SEAM-11（C-11） | closed：`…::cancellation received during start cannot be overwritten by its late result`；`…::disconnect during start cleans up the late successful task without publishing`；`…::destroy during start cleans up the late successful task` | O-CONN-06；VM-1 I2/I3 |
| O-BGTASK-11 | `reconcile` 世代守卫 :185 / `finally` :191 / `updateNotification` :315 | O-SEAM-11（C-11） | closed：`…::destroy during notification update serializes cleanup after publish` | O-CONN-06；VM-1 I8 |
| O-BGTASK-12 | `reconcile` 的 `operationInFlight` :152 / `stop` :292 / `stopping` :49 | O-SEAM-11（C-11） | closed：`…::reconnect waits for in-flight stop before starting the next task` | O-CONN-06；VM-1 I1 |
| O-BGTASK-13 | `judge` connecting 分支 :96-98 / `reconcile` live 判定 :171 / `isLiveState` :201 | O-SEAM-03、O-SEAM-11（HLD **仅 C-03**） | closed：`…::holds protection through the connect window so the handoff can be answered` | **O-CONN-03**（HLD §3.3 的失败恢复路径）+ O-SEAM-02/10/11 |
| O-BGTASK-14 | `judge` connecting 判据 :96-98 / 新鲜度守卫 :83 | O-SEAM-03（C-03） | closed：`…::the connect window needs interface evidence, not just an unrecognised status` | O-CONN-03；边界路径 §3.2 |
| O-BGTASK-15 | `reconcile` 宽限分支 :171 / `VPN_STATUS_GRACE_MS` :175 | O-SEAM-03、O-SEAM-11（HLD **仅 C-03**） | closed：`…::a stalled connect window still releases protection` | O-CONN-03/06 |
| O-STATUS-01 | `VpnStatusReader.read` :37-44 / accessSync 守卫 :41 / catch :45-48 | O-SEAM-03（C-03） | closed：`test-vpn-status-reader.mjs::a missing status file is unknown, not disconnected`；`…::an unreadable status file is unknown` | O-CONN-06；卡片/应用一致性 |
| O-STATUS-02 | `judge` connected 分支 :90-92 / `field` :110-114 | O-SEAM-03（C-03） | closed：`…::a running tunnel reports connected with real traffic` | O-DEV-01 |
| O-STATUS-03 | `judge` 新鲜度守卫 :83 | O-SEAM-03（C-03） | closed：`…::a heartbeat older than the freshness window is unknown, not healthy`；`…::a heartbeat from the future is unknown`；`…::a heartbeat without a value is unknown` | 边界路径 §3.2 |
| O-STATUS-04 | `judge` 终态分支 :87-89 / `isDisconnected` :102-108 | O-SEAM-03（C-03） | closed：`…::extension teardown reports disconnected`；`…::an explicit stop reports disconnected`；`…::a failed extension reports disconnected`；`…::a terminal marker wins over a running tunnel` | O-CONN-02 |
| O-STATUS-05 | `isDisconnected` 的 status unavailable 例外 :107 | O-SEAM-03（C-03） | closed：`…::a failed snapshot read is not treated as a stopped tunnel` | O-CONN-06 |
| O-STATUS-06 | `judge` needs_login 分支 :93-95 | O-SEAM-03（C-03） | closed：`…::a pending sign-in reports needs_login` | O-SETUP-03 |
| O-STATUS-07 | `judge` :90-92 先于 :93-95 | O-SEAM-03（C-03） | closed：`…::a working tunnel wins over a stale sign-in marker` | O-CARD-01 |
| O-STATUS-08 | `judge` connected 合取 :90-92 | O-SEAM-03（C-03） | closed：`…::running without a TUN is not connected` | O-DEV-01 |
| O-STATUS-09 | `judge` connecting 分支 :96-98 | O-SEAM-03（C-03） | closed：`test-vpn-status-reader.mjs::the connect window reports connecting`；`integration/status-vocabulary.mjs::both readers give the same answer for every status line` | O-CONN-03；卡片/应用一致性 |

### 6.2 O-NETMON-01…10 / O-RECONN-01…09（`P2-network-reconnect.md`）

| 单点判据 | 类/方法 | 父接缝 | 单元测试计划 | 对应集成场景 |
| --- | --- | --- | --- | --- |
| O-NETMON-01 | `VpnNetworkMonitor.start` :35 / `changed` :104 / `schedule` :112 | O-SEAM-12（C-12） | closed：`test-vpn-network-monitor.mjs::uses the current default network, coalesces duplicates, never logs address data` | O-NET-03（HLD §5.3 无独立集成锚点） |
| O-NETMON-02 | `readDefaultNetwork` 注释 :140 / `record` :172 | O-SEAM-12、O-SEAM-15（HLD **仅 C-12**） | closed：同上 | O-NET-03 + O-DIAG-01（脱敏） |
| O-NETMON-03 | `readDefaultNetwork` 二次取样 :131 / `refresh` revision 守卫 :159 | O-SEAM-12（C-12） | closed：`…::discards a stale read when default net changes before properties return` | O-NET-03 |
| O-NETMON-04 | `fingerprint` :144 / `refresh` 比较 :162 | O-SEAM-12（C-12） | closed：`…::same interface on a new Wi-Fi network and address renewal both trigger refresh` | O-NET-03 |
| O-NETMON-05 | `readDefaultNetwork` 离线分支 :126 / `record` :172 | O-SEAM-12（C-12） | closed：`…::clears the route hint when offline and applies the restored bearer` | O-NET-03 |
| O-NETMON-06 | `refresh` 失败抛错 :168 / catch :176 / 重试调度 :181 | O-SEAM-12（C-12） | closed：`…::failed native refresh retries without another platform callback` | O-NET-03 |
| O-NETMON-07 | `refresh` revision 快照 :153 / `appliedRevision` :175 / 重放 :181 | O-SEAM-12（C-12） | closed：`…::replays a cellular transition whose timer fires during an in-flight Wi-Fi rebind` | O-NET-03 |
| O-NETMON-08 | `register` 回调 :83 / `schedule(RETRY_MS)` :89 | O-SEAM-12（C-12） | closed：`…::registration failures retry and do not leak a listener after stop` | O-NET-03 |
| O-NETMON-09 | `stop` :45 / netConnection 置空 :52 / `unregister` :59 | O-SEAM-12（C-12） | closed：`…::registration failures retry and do not leak a listener after stop`；`…::stop during native work cancels replay and releases the registered listener` | O-NET-03 |
| O-NETMON-10 | `stop` 清定时器 :48 / generation 守卫 :153 | O-SEAM-12（C-12） | closed：`…::stop during native work cancels replay and releases the registered listener` | O-NET-03 |
| O-RECONN-01 | `VpnReconnectSupervisor.poll` :78 / `handleDrop` :107 | O-SEAM-10、O-SEAM-11 → **归属见 §八 A-1**（HLD C-10） | closed：`test-vpn-reconnect-supervisor.mjs::a tunnel that drops well after backgrounding is brought back` | O-CONN-04 |
| O-RECONN-02 | `handleDrop` 前台/静置守卫 :112 | O-SEAM-10 → 同上（C-10） | closed：`…::a drop moments after backgrounding is left alone`；`…::a drop while the app is on screen is left alone` | O-CONN-04 |
| O-RECONN-03 | `noteRequestedStop` :62 / `handleDrop` 分支 :108 | O-SEAM-10 → 同上（C-10） | closed：`…::a drop after the user asked to disconnect is not undone` | O-CONN-04 / O-CARD-01 |
| O-RECONN-04 | `noteRequestedStart` :69 | O-SEAM-10 → 同上（C-10） | closed：`…::a deliberate reconnect re-arms recovery` | O-CONN-04 |
| O-RECONN-05 | `handleDrop` :119 / `MAX_ATTEMPTS` :14 | O-SEAM-10 → 同上（C-10） | closed：`…::recovery gives up instead of retrying forever` | O-CONN-04 |
| O-RECONN-06 | `handleDrop` 退避判据 :123 / `nextAttemptAtMs` :127 | O-SEAM-10 → 同上（C-10） | closed：`…::retries back off instead of firing on every sample` | O-CONN-04 |
| O-RECONN-07 | `poll` 边沿判定 :98 | O-SEAM-03、O-SEAM-10（HLD **仅 C-03**） | closed：`…::an unknown state is not treated as a drop` | O-CONN-04；VM-3 R11 |
| O-RECONN-08 | `onForeground` :47 | O-SEAM-10 → 同上（C-10） | closed：`…::returning to the foreground clears the retry ladder` | O-CONN-04 |
| **O-RECONN-09** | `poll` 稳定性判据 :91 / `STABLE_MS` :20 | O-SEAM-10 → 同上（C-10） | **开**：`[单元] test-vpn-reconnect-supervisor.mjs::a connection held past the stability window clears the retry ladder`；归属 `owner=项目维护者 接收批次=a01-单元`。缺口：`STABLE_MS` 逻辑已实现（:91-95）但无用例（§八 G-3） | O-CONN-04；VM-3 R2/R3 |

### 6.3 O-SESSION-01…07（`P3-session.md`）

| 单点判据 | 类/方法 | 父接缝 | 单元测试计划 | 对应集成场景 |
| --- | --- | --- | --- | --- |
| O-SESSION-01 | `VpnSessionController.connect` :80 / :81-84 早退 | O-SEAM-03、O-SEAM-10（HLD **仅 C-03**） | closed：`test-vpn-session-controller.mjs::a connect that is already up never starts or stops anything` | O-CONN-07 |
| O-SESSION-02 | `connect` :100-104 / :106-111 / `clearHandoffFiles` :258 / `vpnWant` :67 | O-SEAM-01、O-SEAM-10（HLD **仅 C-01**） | closed：`…::a headless connect answers the extension backend handoff`；`…::the handoff answer keeps polling while no request has arrived` | O-CONN-07；`integration/orchestration-fork.mjs`（待建） |
| O-SESSION-03 | `answerBackendHandoff` :150-176 / 常量 :29-30 | O-SEAM-02、O-SEAM-10（HLD **仅 C-02**） | closed：`…::the handoff answer keeps polling while no request has arrived` | O-CONN-07 |
| O-SESSION-04 | `answerBackendHandoff` :150-176 / :155 先清 | O-SEAM-02（C-02） | closed：`…::a headless connect answers the extension backend handoff` | O-CONN-07 |
| O-SESSION-05 | `answerBackendHandoff` :161-171 | O-SEAM-02（C-02） | closed：`…::a backend that cannot be stopped still releases the extension` | O-CONN-07 |
| O-SESSION-06 | `answerBackendHandoff` :155-160 / `requestIdOf` :178-185 | O-SEAM-02（C-02） | closed：`…::a malformed handoff request is cleared, not answered`；`…::a stale request id is refused instead of confirming the handoff` | O-CONN-07 |
| **O-SESSION-07** | `VpnSessionController` 常量 :27-30 ↔ 扩展 100 ms×150 | O-SEAM-02、O-SEAM-10（HLD **仅 C-02**） | **开**：`[单元] test-vpn-session-controller.mjs::交接应答窗口覆盖扩展十五秒等待（常量关系断言）`；归属 `owner=项目维护者 接收批次=a01-单元`。缺口：两侧 15 s 只是**恰好相等**，无共享定义、无断言（§八 G-2） | O-CONN-01/07；`integration/orchestration-fork.mjs`（待建） |

### 6.4 O-PEER-01…11 / O-LOCALSEND-01…02（`P4-peers.md`）

| 单点判据 | 类/方法 | 父接缝 | 单元测试计划 | 对应集成场景 |
| --- | --- | --- | --- | --- |
| O-PEER-01 | `PeerPathService.probe` :48-50 / `probeInternal` :52-61 / `cache.set` :70 | O-SEAM-09、O-SEAM-04（HLD **仅 C-09**） | closed：`test-peer-path-cache.mjs::a transient relay cache expires so a later direct response can replace it` | O-DEV-02 |
| O-PEER-02 | `PeerPathService` 常量 :7 / :58-59 / :60 | O-SEAM-09、O-SEAM-04（HLD **仅 C-09**） | closed：同上 | O-DEV-02 |
| O-PEER-03 | `probeInternal` !vpnConnected 分支 :52-57 / `clearCache` :36-42 | O-SEAM-09、O-SEAM-04（HLD **仅 C-09**） | closed：`…::disconnect overrides a previously cached direct path` | O-DEV-02；O-CONN-02 |
| O-PEER-04 | `BridgeStatus.peerEffectivelyOnline` :5286-5291 / `peerCardStatus` 离线早退 :5319-5322 | O-SEAM-04（C-04） | closed：`test-peer-reconnect.mjs::an online peer with a failed old probe stays in the online group and shows recovery` | O-DEV-01 |
| O-PEER-05 | `peerCardStatus` :5319-5342 | O-SEAM-04（C-04） | closed：同上 | O-DEV-01 |
| O-PEER-06 | `applyPeers` :863-901（:873-877 只处理翻转项 / :880-890 cancel+clearCache） | O-SEAM-04、O-SEAM-09（HLD **仅 C-04**） | closed：`…::offline then online invalidates pending results and lets the same VPN session rediscover services` | O-DEV-01/02 |
| O-PEER-07 | `autoProbeConnectedPeerServices` :5961-5977（:5965 会话号 / :5971-5974 门控） | O-SEAM-09（C-09） | closed：`…::offline then online invalidates pending results and lets the same VPN session rediscover services` | O-DEV-02 |
| O-PEER-08 | 同 :5968-5975（先判在途、后写标记） | O-SEAM-09（C-09） | closed：`…::a busy old service request does not consume the reconnect discovery attempt` | O-DEV-02 |
| O-PEER-09 | `updateStreamingState` :6013-6029 / `copyStreamingState` :6002-6011 | O-SEAM-04、O-SEAM-09（HLD **仅 C-04**） | closed：`…::a slow service response cannot overwrite a more recent recovered path` | O-DEV-02 |
| O-PEER-10 | `refreshHomeLatency` :4035-4062（:4049-4050 强制探测 / :4059-4061 finally 复位） | O-SEAM-09、O-SEAM-04（HLD **仅 C-09**） | closed：`…::home polling retries an online peer despite an old unreachable path` | O-DEV-01 |
| **O-PEER-11** | `refreshHomeLatency` 守卫 :4047-4055 / `finally` :4059-4061 | O-SEAM-09、O-SEAM-04（HLD **仅 C-09**） | **开**：`[单元] test-peer-reconnect.mjs::过期的首页探测结果在离线、新会话、新生命周期、取消、移除五种情形下都不重新引入路径`；归属 `owner=项目维护者 接收批次=a01-单元`。缺口：5 条用例名由模板串**运行时生成**（`test-peer-reconnect.mjs:99-114`），静态文本无字面名故不锚（§八 G-1） | O-DEV-01/02 |
| O-LOCALSEND-01 | `localSendAvailableForPeer` :4537-4541 / `localSendStatusForPeer` :4543-4547 | O-SEAM-04、O-SEAM-09（HLD **仅 C-04**） | closed：`test-localsend-status.mjs::a mounted detail sheet reads a fresh LocalSend result despite its captured old peer` | O-DEV-02 |
| O-LOCALSEND-02 | 同上 + `peerEffectivelyOnline` :5286-5291 | O-SEAM-09、O-SEAM-04（HLD **仅 C-09**） | closed：`…::current peer presence and VPN connection override an old available service` | O-DEV-02；O-XFER-03 |

### 6.5 O-BUILD-01…07（`P5-build.md`）

**父判据口径**：该文件自述「17 条接缝里没有『构建/装配』这条……暂挂 `O-SEAM-05`……并记 `UNCERTAIN-WIRING`」（`P5-build.md:6-8`）。**本层沿用其自述，不视为隐藏错误，但记入 §八 A-2。**

| 单点判据 | 类/方法 | 父接缝 | 单元测试计划 | 对应集成场景 |
| --- | --- | --- | --- | --- |
| O-BUILD-01 | `scripts/build-go.sh:54-66 apply_patch`（:60 reverse-check / :63 apply） | O-SEAM-05（暂挂；HLD C-05） | closed：`test-macos-build.mjs::fresh and already-patched checkouts build and copy both outputs` | 无（构建不在运行期接缝上） |
| O-BUILD-02 | `build-go.sh:43-45` / `:87-89` / `:91-92` | 同上 | closed：同上 | 无 |
| O-BUILD-03 | `build-go.sh:87-89` -ldflags 双 stamp | 同上 | closed：同上 | 无 |
| O-BUILD-04 | `build-go.sh:54-66` 不读工作区整体状态 | 同上 | closed：`…::unrelated dirty files do not suppress the required Tailscale patch` | 无 |
| O-BUILD-05 | `build-go.sh:10` `set -euo pipefail` / `:56-63` / `:86-89` | 同上 | closed：`…::conflicting patch stops before compiling and preserves the source` | 无 |
| O-BUILD-06 | `build.sh:6-12` 产品门 / `:51` | 同上 | closed：`…::Release and unknown products are rejected before any build or signing` | 无 |
| O-BUILD-07 | `build.sh:13` / `:28-30` / `:36` / `:53-59` | 同上 | closed：`…::Debug uses the project directory, wrapper, and explicit debug flags` | 无 |

### 6.6 表外但必须建的计划项（来自 HLD §5.3，尚未存在）

| 用例 | 守的接缝 | 状态 |
| --- | --- | --- |
| `integration/vpn-lifecycle-channel.mjs` | O-SEAM-01 | 不存在 |
| `integration/orchestration-fork.mjs` | O-SEAM-10（**O-SESSION-02/07 的收敛点**） | 不存在 |
| `integration/vpn-replace-approval.mjs` | O-SEAM-16 | 不存在 |
| `integration/external-app-handoff.mjs` | O-SEAM-13 | 不存在 |
| `integration/persistence-ownership.mjs` | O-SEAM-14 | **已建**（1 条用例，closed） |
| `integration/diagnostic-redaction.mjs` | O-SEAM-15（与 O-NETMON-02 相邻） | **已建**（1 条用例，closed） |
| `integration/entry-dispatch.mjs` | O-SEAM-17 | 不存在 |
| `integration/status-vocabulary.mjs` | O-SEAM-03（**计划外新增**：Q9/Q10/Q13 决策要求两个读者对同一行给出同一答案） | **已建**（第 8 轮，5 条用例，给 O-SEAM-03 与 O-STATUS-09 闭环） |

**开口小结**：单点判据层面 3 条开（O-RECONN-09、O-SESSION-07、O-PEER-11）；接缝层面 O-SEAM-10、O-SEAM-13、O-SEAM-16、O-SEAM-17 只有 `pending-test`（O-SEAM-14 与 O-SEAM-15 已由集成用例闭环）；集成层 8 个文件里 3 个已建、5 个仍不存在。

---

## 七、旅程复核

方法：把 §三 的四张转换表与 §六 的 70 条单点按旅程重新组合，检查**接缝与单点组合后是否仍满足完整旅程**。逐条给「结论 + 依据 + 残留风险」。

| 旅程判据 | 涉及的接缝 | 涉及的单点 | 复核结论 | 残留风险 |
| --- | --- | --- | --- | --- |
| **O-CONN-01** 一键连接 | O-SEAM-01/02/03/05/11 | O-BGTASK-13 | **成立（宿主侧）**。VM-1 T2 在连接窗口内取得任务（`judge:96-98` → `isLiveState:201` → `:182`），使交接能被应答 | 真机 15 s 窗口未重跑（HLD §3.3）；`Q-01`（两进程引擎实例）未验证 |
| **O-CONN-02** 一键断开 | O-SEAM-01 | 无专属单点 | **成立**。VM-1 T1 读到 disconnected 即释放；停止应答 7.5 s 超时后仍调 `stopVpnExtension` | 无（超时被显式定为无害） |
| **O-CONN-03** 连接窗口保活 | O-SEAM-03/11 | O-BGTASK-13/14/15 | **成立**。VM-1 把 connecting 与 connected 等重（:171），且有界（T4） | **VM-3 K8**：重连在途用户按断开不可中止（本旅程邻域） |
| **O-CONN-04** 后台掉线自动恢复 | O-SEAM-10/11/03（**归属分歧** §八 A-1） | O-RECONN-01…09 | **部分成立**。VM-3 的意图判读（R5/R6/R7/R8）完整；**但 K8 与 O-RECONN-09 的缺口**使「稳定 60 s 才清零」这条防线没有证据 | **责任空洞**（HLD Q-09）：P1 被冻结时无人恢复，本层转换表无法覆盖 |
| **O-CONN-05** 其它 VPN 冲突 | O-SEAM-16（不可达）/ O-SEAM-10 | 无 | **成立（走的是替代路径）**。实际是 `showVpnConflictDialog`；批准通道不可达 | 批准 TTL 10 s 与写方缺失（Q-03/Q-06） |
| **O-CONN-06** 后台长时存活 | O-SEAM-03/11 | O-BGTASK-01…15、O-STATUS-01…09 | **成立**。VM-1 全表 + VM-4 P0–P5 全序都有用例 | 蜂窝 720 s（M-11）未完成；D-1/D-2 已由 Q9/Q10 决策解决 |
| **O-CONN-07** 无 UI 连接 | O-SEAM-10/01/02/17 | O-SESSION-01…07 | **部分成立**。VM-2 不参与（§2.2），headless 用 `VpnActionResult`；交接半环有 6 条用例；**O-SESSION-07 未闭环**——R 侧 15 s 与扩展 15 s 无耦合 | `orchestration-fork.mjs` 不存在 |
| **O-NET-01/02** 出口节点与子网路由 | O-SEAM-06（待建） | 无 | **不能复核**（无单点判据、无集成锚点） | HLD §5.3 记待建 |
| **O-NET-03** 网络切换重绑 | O-SEAM-12 | O-NETMON-01…10 | **成立**。10 条覆盖合并/限速/离线/重试/重放/停止 | M-03/M-04 数值转抄未复跑 |
| **O-DEV-01/02** 设备列表与详情 | O-SEAM-04/09 | O-PEER-01…10、O-LOCALSEND-01/02 | **部分成立**。**O-PEER-11 未闭环**——五种过期情形无锚 | 切片式取码（P4:12-17）使「通过」弱于类级加载 |
| **O-XFER-01…05** 传输 | O-SEAM-07/17 | 无专属单点 | **不能复核**。Taildrop 通道无单点判据；§4.4/§4.5 的两条身份与冲突规则**无判据** | 同名不同大小、上传冲突、接收 45 s/60 s 超时均无覆盖 |
| **O-DRIVE-01/02** Taildrive | O-SEAM-08 | 无（O-BUILD 挂的是构建） | **不能复核**。四通道超时无判据；上传冲突无判据 | Q-02（24 h 保留期不一致） |
| **O-MEDIA-01/02** 媒体 | O-SEAM-13/09 | 无 | **不可达**（Moonlight 三字段空串） | Q-04 |
| **O-SETUP-01…04** 首次配置 | O-SEAM-14/13 | 无 | **不能复核**（O-SEAM-14 pending-test） | — |
| **O-UI-01/02** 导航与主题 | O-SEAM-14 | 无 | **不能复核** | — |
| **O-PRIV-01/02** 应用锁 | O-SEAM-13 | 无 | **不能复核** | — |
| **O-DIAG-01** 诊断导出 | O-SEAM-15 | O-NETMON-02（相邻） | **部分成立**。脱敏有 O-NETMON-02 一条邻接证据；**O-SEAM-15 本身 pending-test** | 事件名词表无受控（Q-05） |
| **O-CARD-01** 卡片开关 | O-SEAM-17/10 | O-SESSION-01…03 | **部分成立**。VM-4 P1/P3/P4（connecting）有用例；卡片词表分歧已由 Q10 决策解决（D-2） | 卡片真机未验证（Q-08） |

**复核结论（三条）**

1. **连接类旅程（O-CONN-01…07）在宿主侧成立**：四台状态机的转换表覆盖了它们的每一次判定；残留的是真机证据与两处登记偏差，不是逻辑缺口。
2. **非连接类旅程大量「不能复核」**：设备/传输/Taildrive/媒体/配置/诊断六组共 15 条旅程判据，**没有**单点判据挂接，对应接缝多为 `pending-test` 或「待建」。这是本项目当前最大的覆盖空洞，**不是** LLD 能靠补转换表填上的。
3. **两条算法规则（同名不同大小、上传冲突）实现完整但无判据**（§八 G-4）：它们是 O-XFER-04 / O-DRIVE-01 的核心，却在 70 条里没有对应行。

---

## 八、未决项与复核发现

### A. 接缝归属复核（判据写于 HLD 契约卡之前——已登记的顺序偏差）

方法：对每条判据，把 `父判据` 的 `O-SEAM-nn` 按**位置映射**（O-SEAM-nn ↔ C-nn）换算成契约号，与 `设计依据` 里的 `HLD 契约 C-nn` 逐条比对。**未修改任何判据文件**，仅报告。

**A-1（实质性分歧 · 最重）`O-RECONN-01…09` 的父接缝 `O-SEAM-10` 与 HLD 自身不符**

**已由审查人裁决（Q16a，2026-10-12）**：父判据重定为 `O-SEAM-11`（恢复责任，即 §五 那条责任空洞）与 `O-SEAM-03`（状态判读）。架构 §五 与 HLD §3.3 同步收敛到同一套。

**已执行（2026-10-13）**：判据文件的 `父判据` 字段已改。证据：`P2-network-reconnect.md:186` 与 `:289` 均写 `O-SEAM-11、O-SEAM-03`。接收批次 `a01-判据`。下面保留当初的分歧记录。

| 来源 | 对「后台掉线自动恢复」（O-CONN-04）的归属 |
| --- | --- |
| 判据现文（P2，9 条） | `O-SEAM-10`（O-RECONN-01 另加 `O-SEAM-11`），HLD `C-10` |
| **HLD §3.3 失败恢复路径**（`docs/hld/hld.md:284`） | `O-SEAM-11、O-SEAM-03、O-SEAM-01/02` |
| **架构 §五 O-CONN-04 行**（`architecture.md:485`） | `SEAM-03 + SEAM-05` → §七 对照表 :563 映射为 `O-SEAM-03 + O-SEAM-01` |
| HLD §六 O-SEAM-10 行（`hld.md:368`） | 单点判据只列 `O-SESSION-01、02、03、07`——**未认领任何 O-RECONN** |

即：三处归属互不相同，且 `O-SEAM-10` 是唯一**在本层看来站得住但不能单独站住**的一处——S3 的 O-SEAM-10 触发条件确实把 `VpnReconnectSupervisor` 列为 headless 入口之一（`S3-orchestration-system.md:12`），所以「重连经由 headless 编排」成立；但 O-RECONN-01…09 断言的是**该不该重连**（静置、意图、退避、上限、稳定性），不是**两条编排是否交出同一套契约**（C-10 的主题）。**建议**：父接缝合为 `O-SEAM-10、O-SEAM-11`，契约栏补 `C-11`；或另立一条「恢复意图」接缝。**本层不改判据，交由判据库裁决。**

**A-2（已声明的暂挂）`O-BUILD-01…07` 的父接缝 `O-SEAM-05`**

**原裁决（Q16b，2026-10-12，已于 2026-10-13 撤销）**：不为构建单立接缝。7 条改为直连旅程，并逐条写 `seam_not_applicable` 理由。

**撤销理由**：该裁决与 a01 的工具规则冲突。单点判据就绪时必须引用 HLD 或 LLD 设计条目。构建流程当时没有承载件，7 条因此永远停在 draft。

**修订后的裁决（Q16b 修订，2026-10-13）**：给构建流程补一条接缝。7 条的父判据改为 `O-SEAM-18 构建与产物装配`。承载件是 HLD 契约 `C-18` 与 LLD 条目 `L-BUILD`（本文档 §九）。`seam_not_applicable` 字段已删除，`不确定特征` 由 `UNCERTAIN-WIRING` 改为 `none`。下面保留当初的分歧记录。

`P5-build.md:6-8` 自述「17 条接缝里没有构建这条……暂挂 O-SEAM-05，并在 `不确定特征` 记 `UNCERTAIN-WIRING`」。**这是显式声明，不是隐藏错误**。但仍应记录：`C-05` 的正文（引擎生命周期 N-API 面）**不描述**构建行为——它描述的是构建产物所服务的那条边。7 条判据的**真实归属是 S9「构建与交付」**（HLD §一），而 S9 没有对应的 O-SEAM。**建议**：在接缝库补一条构建接缝，或把 7 条的父判据改为「S9（无接缝 ID）」并保留 `UNCERTAIN-WIRING`。

**A-3（引用不对称）16 条判据的 `父判据` 有两个接缝，`设计依据` 只引一个契约**

| 判据 | 父判据（换算） | 引用的契约 | 缺的引用 |
| --- | --- | --- | --- |
| O-BGTASK-02/03/05/13/15 | C-03 + C-11 | 仅 C-03 | **C-11**（而 C-11 正文 :163 明写「单点判据：O-BGTASK-01…15」，即 C-11 **反向认领**了它们） |
| O-NETMON-02 | C-12 + C-15 | 仅 C-12 | C-15（脱敏） |
| O-RECONN-01 | C-10 + C-11 | 仅 C-10 | C-11（其 `设计依据` 正文却引了「架构 O-SEAM-11 责任空洞第 3 条」） |
| O-RECONN-07 | C-03 + C-10 | 仅 C-03 | C-10 |
| O-SESSION-01 | C-03 + C-10 | 仅 C-03 | C-10（C-10 正文与 §六 均认领 O-SESSION-01） |
| O-SESSION-02 | C-01 + C-10 | 仅 C-01 | C-10 |
| O-SESSION-03 | C-02 + C-10 | 仅 C-02 | C-10 |
| O-SESSION-07 | C-02 + C-10 | 仅 C-02 | C-10（而 C-10 正文 :152 把「15 s 预算」列为它的三个对齐点之一） |
| O-PEER-01/02/03 | C-04 + C-09 | 仅 C-09 | C-04 |
| O-PEER-06 | C-04 + C-09 | 仅 C-04 | C-09 |
| O-PEER-09 | C-04 + C-09 | 仅 C-04 | C-09 |
| O-PEER-10 | C-04 + C-09 | 仅 C-09 | C-04 |
| O-PEER-11 | C-04 + C-09 | 仅 C-09 | C-04 |
| O-LOCALSEND-01 | C-04 + C-09 | 仅 C-04 | C-09 |
| O-LOCALSEND-02 | C-04 + C-09 | 仅 C-09 | C-04 |

**性质**：这是**引用不全**，不是归属错误——每一条引的契约都**确实**描述它的行为，只是少了另一半。其中 **O-BGTASK-13 与 O-SESSION-07 最值得修**：前者是 C-11 在 §3.1 明确点名的连接窗口锚点（`hld.md:253`），后者是 C-10 三个对齐点之一；漏引这两处，正是 §八 G-2/G-3 两条缺口长期未被发现的原因之一。

**未发现**：没有任何一条判据引用了**完全不相关**的契约（即「引错边」）。O-PEER/O-LOCALSEND 的 C-04/C-09 双亲是**真实的跨接缝属性**（探测结果 + 对端快照共同决定路径显示），不是错误。

### B. 三处真实缺口，以及「LLD 设计是否改变了什么」

**结论先说：LLD 不改变这三处中的任何一处代码；它把每一处从「没人知道」变成「有一行可断言」。** 本层不加判据 ID（判据库的职责），只把缺口写清楚。

**G-1 `O-PEER-11`——`test-peer-reconnect.mjs` 的 5 个用例名在运行时生成**

- 事实：`scripts/test-peer-reconnect.mjs:99-114` 用模板串生成 5 条用例名（`an obsolete home probe cannot reintroduce a path after ${scenario}`，scenario ∈ offline / new_session / new_lifecycle / cancelled / removed）。静态文本里**没有**这 5 个字面名，所以**锚不上**。
- LLD 的设计：VM-3 与 `refreshHomeLatency`（`BridgeStatus.ets:4047-4055`）的守卫是**合取**——代际 / 会话 / 外壳就绪 / 在线性 / `errorMessage !== 'cancelled'`。LLD 把它写成 5 行独立的可断言条件（对应 5 个 scenario），使测试可以在**不改模板串**的前提下锚到「五个 scenario 各一条断言」或「一条参数化断言」。**代码不变**：守卫已实现，缺的只是可锚的名字。
- 归属：`owner=项目维护者 接收批次=a01-单元`（判据现文）。

**G-2 `O-SESSION-07`——250 ms × 60 与 100 ms × 150 只是恰好相等**

- 事实：`VpnSessionController.ets:29-30` 定义 `BACKEND_HANDOFF_POLL_INTERVAL_MS = 250`、`BACKEND_HANDOFF_MAX_ATTEMPTS = 60`（= 15 s），注释 :27-28 自己承认「扩展轮询 15 s，所以这边必须至少看那么久」；扩展侧的 100 ms × 150 在另一进程、**没有任何共享定义**。
- LLD 的设计（**这是本层对 G-2 的唯一贡献**）：把「本侧应答窗口 ≥ 扩展等待预算」写成**一条不变量**，并要求断言以**关系的形状**而非数值出现：
  - 若两侧在同一仓库（同一构建产物），可用一条集成测试同时读出两个常量并断言 `A_interval × A_attempts ≥ B_interval × B_attempts`；
  - 单元层无法跨进程读扩展常量，因此单元用例只能断言「本侧 ≥ 15 s」这个**下界**，并在失败信息里指回扩展侧。
  **代码不变**：常量已实现，缺的是耦合与断言。**本层不建议把扩展侧常量抽成共享模块**（那会跨进程引入新依赖），只建议在 `orchestration-fork.mjs` 里做成一条跨侧断言。
- 归属：`owner=项目维护者 接收批次=a01-单元`（判据现文）。

**G-3 `O-RECONN-09`——60 s 稳定性窗口已实现但无用例**

- 事实：`VpnReconnectSupervisor.ets:91-95` 已实现（`attempts > 0 && now - connectedSinceMs >= STABLE_MS` → 记 `vpn_reconnect_succeeded` 并清零）；`STABLE_MS = 60000`（:20）。判据强度是**弱**，状态 `pending-test`。
- LLD 的设计：VM-3 的转换表把 R2/R3 写成两条**互斥**行——「稳定 ≥60 s 才清零」与「不足 60 s 不清零」——这就是该用例必须覆盖的两个分支（含「抖动隧道不得无限重连」这一失败信息）。**代码不变**：逻辑与常量都已存在，缺的只是用例。
- **本层补充发现（K10，登记不修）**：VM-3 对 `needs_login` 与 `unknown` 一样是**静默**（R11），因此「恢复后停在待登录」这一结局没有任何事件、也没有判据。这与 O-RECONN-09 是同一邻域的另一半，登记为**新识别的空缺**（不新增判据 ID）。
- 归属：`owner=项目维护者 接收批次=a01-单元`（判据现文）。

### C. 三处文档化不一致，以及 LLD 设计认为它们应该是（Q9/Q10/Q13 决策已全部解决）

**D-1 同一个状态文件上的两个新鲜度窗口（5000 ms vs 15000 ms）——已解决（Q9 决策）**

- 事实（问题发生时，三处独立常量）：
  - `components/BridgeStatus.ets` 的 `VPN_HEARTBEAT_FRESH_MS = 5000`，用于 `heartbeatIsFresh → extensionIsLive` 与 `heartbeatUnavailable` 送入宽限判定——**读的就是 `vpn-probe-status.txt`**（该文件路径显式拼出）；
  - `services/VpnBackgroundTaskManager.ets:14` `VPN_STATUS_FRESH_MS = 15000`；
  - `services/VpnStatusReader.ets` 另有 `VPN_STATUS_FRESH_MS = 15000`。
- **不要混淆**：`BridgeStatus.ets:3606` 与 `:3878` 也用字面量 `5000`，但那是 `vpn-peers.json` 与 `taildrop-targets.json`（HLD C-04 的 5 s 快照新鲜度），**不是**本一致性问题的对象。
- HLD 的契约值：C-03 明写「新鲜度：>15 s 视为**不确定**而非健康」。
- **Q9 决策的实施**：`VPN_STATUS_FRESH_MS = 15000` 现在只在 `services/VpnStatusReader.ets:12` 定义一次；`VpnBackgroundTaskManager` 自带的那份删除；`BridgeStatus` 改为 `import { VPN_STATUS_FRESH_MS }`（`BridgeStatus.ets:32`，使用点 :3313、:3506）。`vpn-peers.json` 的 5 s 属另一个文件，未动。集成用例 `integration/status-vocabulary.mjs::one freshness window serves every reader, and the UI reads it from here` 钉住这一条。

**D-2 同一行状态的两套词表（`connecting` vs `unknown`）——已解决（Q10 决策，按选项 (a)）**

- 事实（问题发生时，比简报更精确：**三套词**）：
  - `VpnBackgroundTaskManager.readStatus`：含 `vpn interface established` 的新鲜行 → `connecting`；
  - `VpnStatusReader.read`：**没有这条分支**，同上数据 → `unknown`；
  - `FormCardService.stateName:102`：把 `VpnLinkState.UNKNOWN` 映射为态名 `connecting`（:16 `STATE_CONNECTING = 'connecting'`）。
- 即：**语义上三方一致**（连接窗口都被当作「连接中」），**代码词表上不一致**（`VpnLinkState` 里当时没有 `connecting` 这个成员）。
- **Q10 决策选 (a) 扩词表，并已实施**：`VpnLinkState` 增 `CONNECTING`（`VpnStatusReader.ets:18`），`judge` 增 connecting 分支（:96-98），`readStatus` 调 `judge`，不再自己映射词表。卡片仍经 `FormCardService.stateName` 渲染，但输入已是一个真实的 `CONNECTING`。判据 O-STATUS-09 与集成用例 `integration/status-vocabulary.mjs` 钉住这一条。
- **当时给过的另一个选项 (b)（保留 `unknown`，改头注声明）被否**：理由是 C-11（:159）把「`connecting` 也算 live」写成契约的一部分，契约里不该出现读取器无法表达的态。

**D-3 同一行的判定顺序相反（VM-1 vs VM-4）——已解决（Q13 决策）**

- 事实（问题发生时）：同一份状态文件有两个读者，标记集相同但顺序相反。`VpnBackgroundTaskManager.readStatus` 先判 disconnected 再判 connected；`VpnStatusReader` 先判 connected 再判 disconnected。一行同时含 `state=Running\|tun=true` 与 `state=stopped` 时，前者报 disconnected、后者报 connected（§3.1 I11、§3.4 L6）。
- **Q13 决策定口径并已实施**：同一份状态只有一份判读。`VpnBackgroundTaskManager.readStatus:351` 调 `VpnStatusReader.readText`，两处共用 `judge` 的固定顺序，终态标记压过运行中的隧道。判据 O-STATUS-04 与集成用例 `integration/status-vocabulary.mjs::a terminal marker wins over a running tunnel in both readers` 钉住这一条。

### D. 本层复核中更正的引用偏差

**D-4** 简报与本层初稿曾按「`VpnBackgroundTaskManager.ets:344-374` 为 readStatus、`:14` 为新鲜度」引用，**复核后全部核对无误**；但把 **`components/BridgeStatus.ets` 的 5000 ms 窗口**定位为 `:142`（常量）/ `:3313`、`:3506`（使用点），**而非 HLD C-04 引的 `:3606`** ——`:3606` 是 `vpn-peers.json` 的快照窗口（不同文件）。上一层的 C-04 引用本身正确，问题在于「5000」这个数字在同一文件里出现两次（:3606/:3878 为快照，:142 为状态），引用时容易互相顶替。**登记，供上一层在 C-03 里补一个精确的 `file:line`。Q9 决策删除了状态文件的 5000 ms 窗口，因此 `:142` 现在是历史引用；C-04 的对端快照窗口 `:3606` 未变。**

### E. 仍开放的问题（沿用上层，不重复论证）

| # | 项 | 阻塞 |
| --- | --- | --- |
| Q-01 | 两进程加载同一份 `.so` 是一个运行时还是两个 | 唯一会反转决策的未知 |
| Q-03 / Q-06 | 替换批准写方缺失 / 批准 TTL 10 s | O-CONN-05 |
| Q-05 | 诊断事件名无受控词表 | 接缝判据的「可观测点」栏 |
| Q-07 | ~~无 CI~~ **已解决**（第 8 轮加了 `.github/workflows/checks.yml`）。剩下的缺口是 5 个计划中的集成文件尚未建立 | 声称开发完成之前 |
| Q-08 | 卡片 / Taildrive 真机 / special-scenario 从未真机验证 | 相应旅程 |
| Q-09 | 责任空洞：P1 被冻结期间的掉线恢复无人承诺 | O-CONN-04（本层 VM-3 的转换表**无法**覆盖：冻结时没有任何事件到达 `poll`） |
| **新** K8 | 重连在途时用户断开不可中止（~20 s 窗口） | 无判据；登记，待判据库裁决 |
| **新** K10 | 恢复后停在 `needs_login` 无事件、无判据 | 同上 |
| **新** J4 | `invalidateLifecycle` 不重置状态名，`currentState()` 会返回失效值 | 无判据；登记 |

**本层（LLD）当时没有修改任何判据文件、没有新增判据 ID、没有改动任何生产代码。** 以上 A–E 全部交由判据库与上一层裁决。**后续：Q9、Q10、Q13 三条决策落地，改了 `VpnStatusReader.ets`、`VpnBackgroundTaskManager.ets`、`BridgeStatus.ets` 三处生产代码，新增判据 O-STATUS-09（判据库 117 → 118 条，本层单点判据 69 → 70 条），并补了单元与集成用例。本层保留原结论与新的解决说明，作为记录。**

---

## 九、构建与产物装配（S9，契约 C-18）

**本层新增的顶层小节。** 它把 HLD 契约 `C-18` 细化成 7 条单点判据（`O-BUILD-01…07`）站立的行为面。
构建流程不在运行期，也不跨两个运行时模块。所以这一节描述的是**构建机与产物**之间的交接。
设计依据：架构 §2.2 的子系统 S9 与 §3.3 的部署视图。事实来源是脚本本身，逐条给 `file:line`。

### 9.1 两级流程

| 级 | 入口 | 动作 | 产物 |
| --- | --- | --- | --- |
| 1 引擎 | `scripts/build-go.sh` | 应用补丁 → `go build -buildmode=c-shared` → 复制 | `entry/libs/arm64-v8a/libtailscale_go.so` 与 `.h` |
| 2 装配 | `scripts/build.sh`（macOS/Linux）、`scripts/build.ps1`（Windows） | hvigor `assembleHap` | Debug HAP 落 `entry/build/default/outputs/default/` |

`.build/compile.sh` 用同样的两级。它的注释写作「stage 1/2」与「stage 2/2」（`.build/compile.sh:20-26`）。

### 9.2 幂等的补丁应用

`scripts/build-go.sh:54-66` 的 `apply_patch` 只做两件事。它先 `git apply --reverse --check --ignore-space-change --ignore-whitespace`。
reverse-check 成功即判定补丁已应用，打印 `Patch already applied` 并继续（`:60-61`）。否则它 `git apply --ignore-space-change --ignore-whitespace` 应用补丁（`:63`）。
判定只看补丁自身，不读工作区整体状态。所以与补丁无关的本地脏文件既不阻止补丁，也不被覆盖。
两棵源码树各有一个补丁。`patches/ohos-go-interface-resources.patch` 落 Go 工具链源码树 `$go_root`。`patches/tailscale-ohos.patch` 落 `third_party/tailscale`（`:67-68`）。
`$go_root` 默认 `~/.ohos-go-build/ohos-go`，回退 `third_party/ohos-go`（`:15-20`）。
补丁冲突时 `git apply` 非零退出。`set -euo pipefail` 让脚本在编译前中止（`scripts/build-go.sh:10`）。源码保持冲突时的原状。

### 9.3 产物路径与版本戳

输出目录与装配目录在脚本开头定义。`output_dir` 是 `native/go_bridge/dist/arm64-v8a`。`hap_lib_dir` 是 `entry/libs/arm64-v8a`。两者都先 `mkdir -p`（`scripts/build-go.sh:43-45`）。
`go build` 用 `-buildmode=c-shared -trimpath`。它用 `-ldflags` 注入两个版本戳（`scripts/build-go.sh:86-89`）。
两个版本戳是 `tailscale.com/version.longStamp=1.86.5` 与 `tailscale.com/version.shortStamp=1.86.5`。它们取自同一版本号，与 `native/go_bridge/go.mod` 声明的 v1.86.5 一致。
`-ldflags` 同时设 `-extldflags=-Wl,-soname,libtailscale_go.so`。`-trimpath` 让产物路径不含构建机目录。
构建后脚本把 `.so` 与 `.h` 一起复制进 `hap_lib_dir`（`scripts/build-go.sh:91-92`）。HAP 从 `hap_lib_dir` 取库。

### 9.4 产品拒绝

macOS 入口只支持 default Debug 产品。参数多于一个或产品名不是 `default` 时，脚本在开头打印错误并退出（`scripts/build.sh:6-12`）。
错误文案指出 Release 的正确入口是 Windows 的 `build.ps1 -Product release`。这个门在任何构建或签名动作之前。
Windows 入口用 `ValidateSet` 只接受 `default` 与 `release`（`scripts/build.ps1:1-4`）。
release 产品还要先过 changelog 校验（`scripts/build.ps1:126-132`），装配后再过 `verify-artifacts.ps1`（`:194-198`）。
构建模式不是独立的校验项。它由产品派生。release 产品用 `buildMode=release` 与 `debuggable=false`。default 产品用 `buildMode=debug` 与 `debuggable=true`（`scripts/build.ps1:134-135`）。
macOS 入口固定传 `buildMode=debug` 与 `debuggable=true`（`scripts/build.sh:58-59`）。装配用 hvigor wrapper，并在调用前 `unset NODE_PATH`（`scripts/build.sh:53-57`）。

### 9.5 与 7 条单点判据的对应

| 单点判据 | 本节的锚点 |
| --- | --- |
| O-BUILD-01 补丁应用幂等 | §9.2 |
| O-BUILD-02 产物复制 | §9.3 |
| O-BUILD-03 版本戳 | §9.3 |
| O-BUILD-04 无关脏文件不阻止补丁 | §9.2 |
| O-BUILD-05 补丁冲突在编译前失败 | §9.2 |
| O-BUILD-06 产品拒绝 | §9.4 |
| O-BUILD-07 装配参数 | §9.4 |
