# 真机批次清单 · a01-baseline

> **执行方式：一次跑完。** 整套批次由 `scripts/device-run.sh` 在一次上机里跑完：
> 日志全程只采一次（`devecocli log --follow`），场景按顺序提示操作者执行，
> 每个检查点自动抓截图与界面结构，收尾时 `scripts/device-analyze.py` 派生一批
> 机器可判定的事实（心跳最大间隔、`background_started` 与 `vpn_connected` 的先后、
> 交接超时是否出现、崩溃标记），人工判定的部分留成待填表。
>
> ```
> DEVICE=<serial> scripts/device-run.sh              # 构建 + 安装 + 采集
> DEVICE=<serial> scripts/device-run.sh --skip-build # 已装好
> ```
>
> 产物落在 `device-runs/<时间戳>/`：`03-log.txt`（全程日志）、`04-analysis.txt`（派生事实）、
> `notes.txt`（待填结论）、每个场景一张截图与一份界面结构。
> **一次运行的产出要尽量多**，所以下面的条目都排在同一个脚本里，不拆成多次上机。
>
> 支撑这条链路的一个改动：诊断事件此前只写应用沙箱里的文件，主机侧读不到；
> 现在 `DiagnosticEventStore.record` 同时镜像到设备日志（脱敏之后镜像，不会多泄露），
> 所以一次 `log --follow` 就能拿到完整时间线。

第 7 轮审查时没有真机可跑，这批把卡在硬件上的项一次排完。**当前是清单，不是记录**：
执行后逐条回填结论，并把它写进 `manual-checks.md` 的登记册。

## 为什么不需要 Windows

`manual-checks.md` 与 `record.md` 的 Q2 一直写着「8 个 `device-*-probe.ps1` 需要 Windows 加真机」。
本次核对发现**不需要**：`devecocli` 在 Linux 上提供了全部所需能力。

| 需要的能力 | 命令 |
| --- | --- |
| 设备列表与详情 | `devecocli device list`、`devecocli device view` |
| 装机并拉起 | `devecocli run --device <serial> --skip-build` |
| 应用日志（按包名、取末尾若干行） | `devecocli log --device <serial> --bundle-name ren.w2h.mesharc --tail 40` |
| 实时跟踪 | `devecocli log --device <serial> --follow` |
| 崩溃日志 | `devecocli log --device <serial> --crash` |
| 界面结构、截图、点击 | `devecocli ui layout`、`devecocli ui screenshot`、`devecocli ui click <x> <y>` |

所以 Q2 的「需要 Windows」是个过时的约束；八个 `.ps1` 探针可以作为历史保留，
但不再是唯一途径。

## 每一条都要先做的事

1. 停用手机上其它 VPN 应用（例如 shadowsocks），让 MeshArc 能拿到 VPN 通道。
   官方约束原文：系统在 starter 进程或 extension 进程任一退出时停止 VPN；
   两个 VPN 同时占用通道时本应用的连接会失败或被顶掉。
2. 确认设备在线：`devecocli device list`。
3. 装机：`DEVICE=<serial> scripts/device-run.sh`。它构建、安装，然后开始采集。
   默认**保留应用数据**，所以登录态还在，不用在真机时段里重新登录。
4. **不需要手工清上一轮的诊断文件。** 本批的证据是这次运行采到的设备日志。
   采集从脚本开启 `log --follow` 起、到脚本收尾止，这条窗口就是证据边界，旧文件混不进来。
   沙箱里的诊断文件另有条数与字节上限，也不会无限增长。
   只有确实想要一份干净的沙箱诊断文件时才加 `--clean`。代价是登录态被清掉。

**所有真机结论都受一个条件限制，必须一起写进登记册**：USB/HDC 连接且充电会改变电源管理行为。
通过一次不代表电池深度休眠、拔线、强杀或重启仍成立。这不是免责声明，是这批证据的适用边界。

---

## M-13 · Q-01：两个进程里同一份 `.so` 是几个运行时

**为什么**：这一条会反转架构决策 D3。若平台把两个进程里加载的同一份 `libtailscale_ohos.so`
视为**一个**运行时，那么 P1 的一次 `backendStopAsync` 会连带停掉 P2 的隧道，
而文件协议仍会把它读成「扩展自己停了」——交接协议与 `filesDir/tailscale` 的单写者假设同时破。

**步骤**

1. 连接 Tailscale，等到状态显示已连接。
2. 打开应用的诊断面板，读「本进程引擎状态」（M-06 引擎自检读到的就是这个）。
3. 记下扩展侧的状态：在采集文件里找：`grep vpn_connected device-runs/<时间戳>/03-log.txt`。
4. 断开连接，观察扩展进程是否随之销毁。

**判定**

| 观察 | 结论 |
| --- | --- |
| P1 的引擎状态在连接成功后仍是 `stopped` / `NoState` | **两个独立运行时**，D3(a) 成立，现有交接协议与单写者假设不变 |
| P1 的引擎状态显示 `Running`，且与扩展侧描述同一实例 | **一个运行时**，D3 失效，需重做交接协议 |

**影响**：D3、`O-SEAM-05`、`O-SEAM-06`、`O-CONN-07`。

---

## M-14 · Q7-a：桌面卡片开关

**为什么**：卡片这条路径从未真机验证，而它是无 UI 入口的主要形态。
`O-CARD-01` 目前只有计划中的 E2E 用例。

**步骤**

1. 长按桌面 MeshArc 图标，添加 2×2 卡片。
2. 未登录状态下点卡片按钮，确认它把应用拉到前台走登录流程，而不是静默失败。
3. 登录并连接后，点卡片按钮断开；再点一次连接。
4. 在应用内操作连接/断开，确认卡片跟着变。
5. 杀掉应用进程，等待，确认卡片在 30 分钟内自愈到正确状态。

**观察**：在采集文件里找 `Card toggle`。应用打的是 `Card toggle result=…`
（`EntryAbility.ets:218`）与 `Card toggle failed`（`:225`）。
**`performCardToggle` 是方法名，不是日志串**，按它过滤取不到任何东西。

**只能人工看的**：卡片挂在系统桌面上，`devecocli ui layout` 只抓本应用的窗口树，抓不到卡片节点。
所以「是否白屏」与「文案是否与连接状态相反」必须用眼睛看。第 5 步的自愈只在失败时留下
`Card refresh failed`（`EntryFormAbility.ets:28`），成功是静默的，同样只能人工看。

**判定**：卡片不得白屏；文案不得与应用的连接状态相反；未登录时必须把窗口拉到前台。
第 2 步的未登录分支可从 `Card toggle result=` 里读出 NEEDS_UI，窗口是否真拉起来靠截图。

**边界**：应用进程完全退出后卡片最多滞后 30 分钟，这是 HarmonyOS 卡片机制的硬限制，不算缺陷。

**影响**：`O-CARD-01`、`O-SEAM-17`、`O-SESSION-01`。

---

## M-15 · Q7-b：Taildrive 真机共享节点

**为什么**：Taildrive 需要第二个节点才有意义，从未在真机上跑过。

**前置**：同一 tailnet 内另有一台开启共享的设备（另一台手机或一台电脑）。

**步骤**

1. 连接后进入「文件」页签，浏览共享目录。
2. 上传一个文件到共享目录，再下载回来。
3. 在传输过程中断网，观察失败态与重试。

**观察**：在采集文件里找 `taildrive`；`docs/` 里 Taildrive 的请求环超时（32 s / 35 s / 30 min+10 s / 5 s）。

**一半是盲的。** 界面层（`TaildriveBrowser.ets`）有 hilog，列表与传输的起止看得见。
网关层 `TaildriveGateway.ets` 有 446 行，**没有任何 hilog，也没有任何诊断事件**，
所以断网后网关层的失败与重试在日志里看不见，只能从界面表现判断。这条限制写进结论。

**影响**：`O-DRIVE-01`、`O-DRIVE-02`、`O-SEAM-08`。

---

## M-16 · Q7-c：special-scenario 长时任务

**为什么**：这是 D4 失效条件里唯一的潜在出路——如果它成立，
「P1 在后台被冻结导致掉线无人恢复」这个责任空洞就有解。它从未运行过。

**前置**：受限权限的 ACL 审核通过，或创建了「试用调试 Profile」。
权限声明用 `scripts/toggle-special-scenario-acl.mjs` 打开——**默认必须是关的**，
声明与 Profile 不匹配会导致应用安装失败。

**步骤**

1. 打开权限声明，重新构建并确认能装上去。
2. 设置子类型常量（`SUBMODE_*`），重新构建并安装。
3. 连接后切到后台，观察日志里走了哪条路。

**判定**

| 观察到 | 含义 |
| --- | --- |
| `background_started_special_scenario` | 走的是 special-scenario |
| `background_started` | 回落到 `DATA_TRANSFER` |
| `background_special_scenario_unconfigured` | 子类型常量还是 0，什么都没试 |
| `background_special_scenario_unsupported` | `isModeSupported()` 返回 false |
| `background_special_scenario_denied` | 授权没拿到，`code` 是原始的 `UserAuthResult` 数值 |
| `background_special_scenario_failed` | `startBackgroundRunning` 抛异常，`code` 是错误码 |

后四个名字是本轮新加的埋点。在此之前这四个返回点是静默的，真机上只看得到「没走成」，
看不到「为什么没走成」。回落路径必须与现在完全一致。

**注意**：子类型的选定等于向华为申明本应用的用途。这是一个需要提交方承担的决定，
不由实现者代选。

**影响**：D4 的失效条件、`O-BGTASK-01`、`Q17`。

---

## M-17 · Q-02（修订）：VPN 冲突路径是否收敛

**为什么**：Q-02 原问「替换批准的 10 s TTL」。复核发现那个批准文件的写方不存在，整个替换分支已删（`fe35016`）。剩下的冲突路径有一条真机风险：冲突时扩展用 200 ms 心跳保持存活，等应用来停它（`TailscaleVpnExtensionAbility.ets:602`）。这个循环没有次数上限，也没有自杀超时。应用侧在检测到冲突时就调 `stopVpnExtension`（`BridgeStatus.ets:4339`），不等用户点确定。所以**「应用检测不到」是唯一的空洞**，本条的步骤就是往这个空洞上打。

**步骤**

1. 手机上保留另一个占用 VPN 通道的应用（shadowsocks）。
2. 在应用内发起连接，记下提示框的标题与正文。
3. 不点「确定」，等 60 s。该对话框 `autoCancel: false`，点框外不会关。
4. 断开 shadowsocks，再发起一次连接，确认这次能连上。
5. 冲突提示出现后立刻强杀应用进程。
6. 断开 shadowsocks，重启应用，读当前状态文字。
7. 再发起一次连接，看是否报冲突。

**观察**：在采集文件里找 `vpn_conflict`、`vpn_conflict_self_disconnect`、`vpn_create_failed`；
`devecocli log --device <serial> --crash`；`devecocli ui layout`。

**判「自停成功」要看 failed 那条没出现，不能只看 completed。** `completed` 在
`finishVpnConflictCleanup`（`BridgeStatus.ets:4352`）里无条件记录，`stopVpnExtension` 失败时
也经 `:4342` 的失败分支走到它。所以 `completed` 只证明清理流程走完，不证明自停成功。

**判定**

| 观察 | 结论 |
| --- | --- |
| 第 2 步标题「请先断开其它 VPN」、正文「请断开其它 VPN 以连接 Tailscale」 | 冲突文案与代码一致，登记册 M-10 的「部分」可升级 |
| 第 3 步出现 `vpn_conflict_self_disconnect_completed`，且**没有** `vpn_conflict_self_disconnect_failed` | 应用侧自停有效，删除替换分支没有留下空洞 |
| 第 6 步状态文字仍是冲突 | 应用被杀后扩展仍在空转，新会话把它读成在场的冲突 |
| 第 7 步报冲突，而此刻没有其它 VPN | 空洞确认：无人停的扩展会挡住后续连接。需要给心跳加自杀超时 |

**影响**：`O-SEAM-16`、`R-CONN-07`、登记册 M-10、D4 的责任空洞。

---

## M-18 · Q17：蜂窝下的长时间存活与连接期保活复跑

**为什么**：两件事挤在一起。`QG-01` 的目标值写着「≥ 720 s」，但蜂窝版的 M-11 **从未完成**；
`QG-02` 的「连接期保活覆盖」逻辑已由单元测试闭环，真机却没复跑。

**步骤**

1. 关掉 Wi-Fi，用蜂窝数据连接。
2. 锁屏静置，保持 **720 s 以上**。
3. 心跳序列不用手工取，`device-analyze.py` 收尾时会从采集文件里算出来
   （扩展的状态定时器每秒刷新一次，本次已给它加了设备日志镜像）。
4. 另外单独跑一次连接期保活：从扩展建 TUN 到隧道可用，确认全程持有长时任务。

**判定**：相邻两条 `heartbeatMs=` 的间隔全程 ≤ 15 s；`vpn_extension_created` 全程只出现一次，
且没有 `vpn_extension_destroyed`；`background_started` 早于 `vpn_connected`。

**「进程 ID 不变」这条已换掉。** 诊断事件只有时间戳、来源、事件名、阶段、错误码，不含 PID；
`devecocli` 也没有取进程列表的命令。扩展重启会再打一条 `vpn_extension_created`，
所以用生命周期事件代替 PID，判定力等价。

**影响**：`QG-01`、`QG-02`、M-11、`O-BGTASK-13`。

---

## M-19 · Q6：冷启动到可用的耗时

**为什么**：质量目标表里的「启动到可用」既没有目标值也没有测量方法，
审查人决定「定值并实测」。

**步骤**

1. 强杀应用，等系统回收完成。
2. 冷启动，从点击图标起计时到最后一次界面可交互（首页出现且状态已读）。
3. 重复 5 次，记录中位数与最大值。

**判定**：用这 5 次的结果定目标值，并把测量方法写进质量目标表；
在那之前 `QG-08` 只能是 draft。

**影响**：`QG-08`、需求质量目标表。

---

## 真机上不能用 `--from` 与 `--keyword`

2026-10-13 在 Mate 60 Pro（`2LQGK24828000076`）上实测：

| 命令 | 结果 |
| --- | --- |
| `log --bundle-name X --from 30m` | 0 行（设备时钟比主机慢 3 小时，`--from` 的窗口按主机时间算，两者不重叠） |
| `log --bundle-name X --keyword MeshArcDiag` | 0 行 |
| `log --bundle-name X --tail 40` | 40 行，可用 |
| `log --follow` | 可用，但**会先把整个缓冲区从头回放** |

所以：日志只采一次，之后一律在采集文件里本地过滤。
`device-run.sh` 在采集开始时记下设备当下时间，`device-analyze.py` 据此把回放的部分剔掉，
否则上一次运行的事件会被当成这一次的证据。

## 一次运行取不到的东西

下面几项不要指望从设备日志或界面结构里拿到。`device-analyze.py` 收尾时也会把它们打出来。

| 项 | 为什么取不到 | 怎么办 |
| --- | --- | --- |
| 卡片文案、白屏、30 分钟自愈 | 卡片挂在系统桌面，界面结构只覆盖本应用窗口。自愈成功路径没有日志，只有失败才打 `Card refresh failed` | 人工看，写进结论 |
| 冷启动耗时（M-19） | 设备时间戳与操作者点击时刻对不齐，「界面可交互」没有日志锚点 | 人工掐表，5 次 |
| Taildrive 网关层失败（M-15） | `TaildriveGateway.ets` 没有 hilog，也没有诊断事件 | 只能从界面表现判断，把这条限制写进结论 |
| 授权横幅（M-16） | `requestAuthFromUser` 全仓库没有调用点，只在注释里出现过，触发入口不存在 | 本轮不做。为什么没走成 special-scenario 改由四个新埋点回答 |
| 进程 ID（M-18） | 诊断事件只有时间戳、来源、事件名、阶段、错误码，不含 PID。`devecocli` 也没有取进程列表的命令 | 用扩展生命周期事件代替：扩展重启会再打一条 `vpn_extension_created` |

**已经补掉的两项**：

1. 心跳。它原先只写进沙箱文件，主机读不到，`QG-01` 因此永远判不了。扩展现在把时间戳镜像到设备日志。
2. 诊断事件到主机。先前只有文件，`DiagnosticEventStore.record` 现在同时镜像到 hilog。

**心跳现在可判了，但有一条前提**：镜像要生效，采集窗口要覆盖连接期。日志里一个 `heartbeatMs=` 都没有，就是这两条里有一条没满足。

## 回填规则

每条的结论按 `manual-checks.md` 现有的格式写：一句结论、来源、测得数值、
以及「未闭环」时要写清哪一部分没做到。**不允许把「没跑到」写成「通过」**——
登记册里 M-05 曾经被误当成通过证据使用，那是本项目已经犯过一次的错。
