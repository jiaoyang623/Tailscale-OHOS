# 操作者清单 · a01-baseline 真机批次

这份清单给拿着手机的人用。五条要动手，机器做不了。
每条都有六块：前置条件、操作步骤、机器会抓到什么、边界、回填位置、做完推动什么。
「操作步骤」是一张表，每行给出应看到什么与失败长什么样。

每条末尾有一句「做完推动什么」。这句话说明这一条解锁哪条判据。

步骤与判定见 `device-runbook.md`。结论回填到 `manual-checks.md`。

---

## 通用须知（先读一遍）

- 设备：当前登录好的是 Pura X `56T0225330000021`。
- 采集：`DEVICE=56T0225330000021 scripts/device-run.sh`。脚本会构建、安装，然后按顺序提示每个场景。
- 产物：仓库根目录归 w2h，以别的用户跑时脚本落到 `~/mesharc-device-runs/<时间戳>/`。脚本开头会打印实际路径。日志在 `03-log.txt`。采集中断过就有 `03-log-2.txt` 等分段。
- 找日志：在采集文件里找。例：`grep 'Card toggle' ~/mesharc-device-runs/<时间戳>/03-log*.txt`。
- **不要用 `devecocli log` 取日志。** 2026-10-13 实测：同一次连接里 `hdc hilog -x` 有 247 条心跳，`devecocli log --tail 400` 一条都没有。`--from` 与 `--keyword` 同样取不到东西（设备时钟与主机差 3 小时）。采集脚本用的是 `hdc hilog`，查也在采集文件里查。
- 快照：每个场景抓一张 `<编号>.png` 与一份 `<编号>.layout.json`。例：`M-14.png`。
- 界面结构只覆盖本应用窗口树。系统桌面的卡片抓不到。桌面上的东西只能人工看。
- 区分两种失败。「没做到」是操作没生效。「做到了但结果不对」是操作生效了、结果与预期不符。每步都写明这两者的长相。
- **电源边界（所有结论都要带）**：全程 USB/HDC 连接且充电。这会改变电源管理行为。
  通过一次不等于电池深度休眠、拔线、强杀或重启后仍成立。
- 任一场景做不了时直接输 `s` 跳过。跳过的项在结论里写「未执行」与原因。

---

## M-14 · 桌面卡片开关

**目标**：确认 2×2 桌面卡片能加、能点、能跟状态同步、杀进程后能自愈。

卡片只有 2×2 一种尺寸（`form_config.json` 的 `supportDimensions`）。所以选尺寸时只有一个选项。

### 前置条件

- 应用已安装本批构建。
- 应用内已登录，控制服务器已配置。未配置时卡片的按钮会落到 `needs_setup`。
- 本批安装默认保留登录态。第 2 步要测未登录分支，所以要先登出。
  做法：把第 2 步放在最前（装完先不登录），或放在最后（做完前四步再登出）。

### 操作步骤

| 步骤 | 应看到什么 | 失败长什么样 |
| --- | --- | --- |
| 1. 长按桌面 MeshArc 图标 → 点「卡片」→ 选尺寸 2×2 → 拖到桌面 | 桌面出现一张 2×2 卡片。卡片有状态文字和一个按钮。日志出现 `Card added` | 长按菜单里没有「卡片」项 = 卡片没被注册。卡片白屏 = 渲染异常。日志没有 `Card added` |
| 2. 登出后点卡片按钮 | 卡片把应用窗口拉到前台，停在登录界面 | 日志出现 `Card toggle result=unchanged`、`cancelled` 或 `failed` = 没走 `needs_ui`。日志有 `needs_ui` 但窗口没起来 = 静默失败 |
| 3. 登录并连接后，点卡片按钮断开，再点一次连接 | 按钮文字先变「处理中…」，随后状态文字变「未连接」，再变「已连接」。应用内的连接状态同步变化。日志出现 `Card toggle result=stopped`，随后出现 `started` | 日志出现 `needs_ui` 或 `failed` = 动作没执行到。卡片文字不跟着应用变 = 同步坏了 |
| 4. 在应用内连接、断开各一次 | 卡片的文字与按钮跟应用状态一致。连接时按钮是「断开连接」，未连接时按钮是「连接 Tailscale」 | 卡片文字与应用的连接状态相反 = 同步坏了。卡片只变一半 = 部分刷新 |
| 5. 杀掉应用进程（设置 → 应用 → 强行停止），等 30 分钟 | 卡片在 30 分钟内自行刷到正确状态 | 30 分钟后卡片仍是旧状态 = 自愈没生效。日志出现 `Card refresh failed`、`Card update failed` 或 `Card enumeration failed` |

第 4 步与第 5 步的结果只能人工看。卡片在系统桌面，界面结构抓不到它。

### 机器会抓到什么

在采集文件里找这些串。按 `Card toggle` 过滤最容易。

- 卡片动作结果：`Card toggle result=`（`EntryAbility.ets:218`）。
  值是 `started`、`stopped`、`unchanged`、`needs_ui`、`cancelled`、`failed` 之一。
- 卡片动作异常：`Card toggle failed. code=`（`EntryAbility.ets:225`）。
- 卡片增删：`Card added`（`EntryFormAbility.ets:20`）、`Card removed`（`EntryFormAbility.ets:33`）。
- 卡片刷新失败：`Card refresh failed. code=`（`EntryFormAbility.ets:28`）。
- 卡片更新失败：`Card update failed. code=`（`FormCardService.ets:68`）。
- 卡片枚举失败：`Card enumeration failed. code=`（`FormCardService.ets:54`）。
- 卡片动作注册失败：`Card toggle registration failed`（`EntryAbility.ets:102`）。
- 快照：`M-14.png`、`M-14.layout.json`。

按 `performCardToggle` 过滤取不到任何东西。那是方法名，不是日志串。

### 边界

- 卡片挂在系统桌面。`devecocli ui layout` 只抓本应用窗口树，抓不到卡片节点。
  白屏、文案方向、自愈，全部只能人工看。
- 应用进程完全退出后，卡片靠系统定时更新。配置是 `updateDuration: 1`，即 30 分钟一档。
  滞后 ≤30 分钟是平台机制，不算缺陷。
- 成功刷新不打日志。只有失败才留上面那几条 `Card * failed`。
  所以「日志里没有失败」加上「眼睛看到状态正确」才算通过。

### 回填

`manual-checks.md` 顶部登记表的 M-14 行（第 28 行）。另按 M-19（第 171 行）的格式新增一节。

### 做完推动什么

`O-CARD-01`、`O-SEAM-17`、`O-SESSION-01` 从「只有计划中的 E2E」变成有真机实测。

---

## M-15 · Taildrive 真机共享节点

**目标**：确认能在真机上浏览、上传、下载一台共享设备的目录，并看清断网后的表现。

### 前置条件

- 应用已连接 Tailscale。
- 同一 tailnet 内另有一台开启 Taildrive 共享的设备，另一台手机或一台电脑。
  这台设备要在 Tailscale 管理控制台开启 Taildrive、导出共享目录，并且 tailnet ACL 允许本机访问。
- 没有第二台设备就输 `s` 跳过，并在结论里写明原因。

### 操作步骤

| 步骤 | 应看到什么 | 失败长什么样 |
| --- | --- | --- |
| 1. 连接后进入「远程文件」页签 | 列出第二台设备的共享目录 | 列表为空且提示「请先连接 Tailscale 以浏览远程文件」= 本机没连上。列表为空但已连接 = 第二台设备没开共享，或 ACL 不允许。日志里没有 `taildrive` 行 = 界面层没走到 |
| 2. 上传一个文件到共享目录 | 界面显示上传进度。结束后文件出现在列表里 | 进度一直转圈 = 网关层在等超时（见下）。上传后列表里没有该文件 = 写失败 |
| 3. 把刚上传的文件下载回来 | 界面显示下载进度。文件落到本地 | 进度卡住或报错 = 传输失败。下载的文件大小不对 = 传输截断 |
| 4. 传输中途关 Wi-Fi（或开飞行模式） | 界面显示失败态，或显示重试 | 界面一直转圈不报错 = 请求在等超时。界面立刻说成功但文件不对 = 假成功 |

第 4 步要按超时量级等。网关层有四档超时（`TaildriveGateway.ets:14-17`）：查询 32 s、变更 35 s、传输 30 min+10 s、控制 5 s。

### 机器会抓到什么

- 在采集文件里找 `taildrive`。这一条只有界面层 `TaildriveBrowser.ets` 有 hilog。列表与传输的起止看得见。
- **网关层是盲区。** `TaildriveGateway.ets` 有 446 行，没有任何 hilog，也没有任何诊断事件。
  断网后网关层的失败与重试在日志里看不见。只能从界面表现判断。这条限制要写进结论。
- 快照：`M-15.png`、`M-15.layout.json`。

### 边界

- 界面层与网关层不对称。上传、下载、断网的重试只看得到界面层。
- 写结论时要写明：网关层失败无日志，第 4 步的结论来自界面表现。
- 电源边界同通用须知。

### 回填

`manual-checks.md` 顶部登记表的 M-15 行（第 29 行）。另按 M-19 的格式新增一节。

### 做完推动什么

`O-DRIVE-01`、`O-DRIVE-02`、`O-SEAM-08` 从「从未真机跑过」变成有实测。

---

## M-16 · special-scenario 长时任务

**目标**：确认 special-scenario 长时任务能不能走通。这是 D4 失效条件里唯一的潜在出路。

### 前置条件

- 受限权限的 ACL 审核通过，或装了「试用调试 Profile」。
  没有这个时打开权限声明会导致应用安装失败（见 `toggle-special-scenario-acl.mjs` 的注释）。
- 权限声明默认必须是关的。用 `node scripts/toggle-special-scenario-acl.mjs status` 查。
- 子类型常量 `SPECIAL_SCENARIO_SUBMODE` 当前是 `0`（`VpnBackgroundTaskManager.ets:31`）。
  `0` 表示整条路径故意不启用。此时只会记录 `background_special_scenario_unconfigured`。
- 要让这条真正跑起来，必须先把常量改成一个非零的 `SUBMODE_*`，重新构建并安装。
  子类型的选定等于向华为申明本应用的用途。这是提交方的决定，不在本清单里代选。
- **应用不会弹授权提示框。** 全仓库没有 `requestAuthFromUser` 的调用点，它只出现在
  `VpnBackgroundTaskManager.ets:243` 的注释里。代码实际走的是 `checkSpecialScenarioAuth`，
  它只读取已存的授权结果。授权只能来自已批准的 ACL 或 Profile。
  不要去找授权提示框，也不要等它。

### 操作步骤

| 步骤 | 应看到什么 | 失败长什么样 |
| --- | --- | --- |
| 1. 打开权限声明。用 `node scripts/toggle-special-scenario-acl.mjs enable`。默认加 `ohos.permission.KEEP_BACKGROUND_RUNNING_SPECIAL_SCENARIO`，正是 special-scenario 需要的。只有获批的是 system 权限时才加 `--system`。再用 `status` 确认已声明。然后重新构建并装机 | 应用能装上 | 安装失败 = 声明与 Profile 不匹配。跑 `disable` 回退 |
| 2. 选一个 `SUBMODE_*`，写入 `VpnBackgroundTaskManager.ets:31`。重新构建并安装 | 应用能装上 | 常量仍是 `0` = 第 2 步没生效。后面的判定会看到 `unconfigured` |
| 3. 连接后切到后台，等几秒 | 日志里出现且只出现一条长时任务的开始记录，以及最多一条 `background_special_scenario_*` 原因记录 | 两类记录都没有 = 长时任务没起。看有没有 `background_listener_failed`、`background_operation_failed` |

### 机器会抓到什么

在采集文件里找这些串。用它们判断「走了哪条路」和「为什么没走成」。

- 走了 special-scenario：`background_started_special_scenario`（`VpnBackgroundTaskManager.ets:292`）。
- 回落到 DATA_TRANSFER：`background_started`（`VpnBackgroundTaskManager.ets:236`）。
- 子类型常量还是 `0`：`background_special_scenario_unconfigured`（`:260`）。
- `isModeSupported()` 返回 false：`background_special_scenario_unsupported`（`:272`）。
- 授权没拿到：`background_special_scenario_denied`（`:280`）。`code` 是 `UserAuthResult` 原始数值。
- `startBackgroundRunning` 抛异常：`background_special_scenario_failed`（`:295`）。`code` 是错误码。
- 快照：`M-16.png`、`M-16.layout.json`。

`UserAuthResult` 数值对照（`background_special_scenario_denied` 的 `code`）：

| code | 含义 |
| --- | --- |
| 1 | NOT_DETERMINED。从没请求过授权 |
| 2 | DENIED。授权被拒 |
| 3 | GRANTED_ONCE。本次授权 |
| 4 | GRANTED_ALWAYS。一直授权 |

### 边界

- 后四条 `background_special_scenario_*` 是本轮新加的埋点。在此之前这四个返回点是静默的。
  真机上只看得到「没走成」，看不到「为什么没走成」。
- 回落路径必须与现在完全一致。出现 `background_started` 是正常回落，不是失败。
- 这条要改 `VpnBackgroundTaskManager.ets:31` 才真跑得起来。不改就只能测到 `unconfigured`。
- 电源边界同通用须知。

### 回填

`manual-checks.md` 顶部登记表的 M-16 行（第 30 行）。另按 M-19 的格式新增一节。

### 做完推动什么

D4 的失效条件、`O-BGTASK-01`、`Q17` 可以往前走。

---

## M-17 · VPN 冲突路径是否收敛

**目标**：往「应用检测不到冲突」这个空洞上打。冲突时扩展用 200 ms 心跳保持存活，等应用来停它。
这个循环没有次数上限，也没有自杀超时。应用检测到冲突时立刻停自己的扩展（`BridgeStatus.ets:4339`），
不等用户点确定。所以只有应用进程死掉时才无人停它。

### 前置条件

- 手机上另一个占用 VPN 通道的应用保持可用（shadowsocks，包名 `com.xbt.project`）。
- 应用已登录，控制服务器已配置。

### 操作步骤

| 步骤 | 应看到什么 | 失败长什么样 |
| --- | --- | --- |
| 1. 保持 shadowsocks 连接，占用 VPN 通道 | 系统设置里 VPN 标志属于 shadowsocks | shadowsocks 没占住通道 = 后面测不出冲突 |
| 2. 在应用内发起连接 | 弹出冲突框。标题「请先断开其它 VPN」，正文「请断开其它 VPN 以连接 Tailscale」，按钮「确定」 | 没弹框 = 应用没检测到冲突。这正是本条要打的空洞。文案不同 = 登记册 M-10 的「部分」不能升级 |
| 3. 不点「确定」，等 60 s | 框一直在。点框外不会关。日志出现 `vpn_conflict_self_disconnect_requested`，随后出现 `vpn_conflict_self_disconnect_completed` | 出现 `vpn_conflict_self_disconnect_failed` = 自停没成功 |
| 4. 断开 shadowsocks，再发起一次连接 | 这次连上。日志出现 `vpn_connected` | 仍报冲突 = 冲突没清掉 |
| 5. 再发起一次连接，冲突框出现后立刻强杀应用进程（设置 → 强行停止） | 应用进程消失 | 杀不掉 = 换用 `hdc shell aa force-stop ren.w2h.mesharc` |
| 6. 断开 shadowsocks，重启应用，读当前状态文字 | 状态不再显示冲突 | 仍显示冲突 = 应用被杀后扩展仍在空转，新会话把它读成在场的冲突 |
| 7. 再发起一次连接 | 此刻没有其它 VPN，不应报冲突。这次能连上 | 报冲突 = 空洞确认。无人停的扩展挡住了后续连接。需要给心跳加自杀超时 |

### 机器会抓到什么

在采集文件里找这些诊断事件。不要用 `devecocli log --keyword` 取，这台设备取不到。

- 扩展侧冲突：`vpn_conflict`（`TailscaleVpnExtensionAbility.ets:591`）。
- 应用侧检测到：`vpn_conflict_detected`（`BridgeStatus.ets:4330`）。
- 应用请求停自己的扩展：`vpn_conflict_self_disconnect_requested`（`BridgeStatus.ets:4338`）。
- 清理走完：`vpn_conflict_self_disconnect_completed`（`BridgeStatus.ets:4352`）。
- 自停失败：`vpn_conflict_self_disconnect_failed`（`BridgeStatus.ets:4342`）。
- 用户点确定：`vpn_conflict_acknowledged`（`BridgeStatus.ets:4380`）。
- TUN 创建失败（非冲突）：`vpn_create_failed`。
- 崩溃标记：`device-analyze.py` 会看日志里的 `FATAL`、`crash`、`Aborted`。
- 快照：`M-17.png`、`M-17.layout.json`。

**判「自停成功」要看 `failed` 没出现，不能只看 `completed`。**
`completed` 在 `finishVpnConflictCleanup`（`BridgeStatus.ets:4352`）里无条件记录。
`stopVpnExtension` 失败时也经 `:4342` 的失败分支走到它。所以 `completed` 只证明流程走完。

### 边界

- 强杀应用后扩展的空转是设计上的已知空洞。循环无次数上限，也无自杀超时。
- 冲突框是 `autoCancel: false`（`BridgeStatus.ets:4364`）。点框外不会关。
- 电源边界同通用须知。

### 回填

`manual-checks.md` 现有的 `## M-17`（第 182 行）。

### 做完推动什么

`O-SEAM-16`、`R-CONN-07`、登记册 M-10、D4 的责任空洞可以往前走。

---

## M-18 · 蜂窝下的长时间存活与连接期保活复跑

**目标**：跑满 720 s 的连续蜂窝锁屏，并复跑连接期保活。两件事挤在一起测。

### 前置条件

- 关掉 Wi-Fi，用蜂窝数据。应用已登录并已连接。
- 这条要 720 s 的静置。做之前安排好时间。

### 操作步骤

| 步骤 | 应看到什么 | 失败长什么样 |
| --- | --- | --- |
| 1. 关 Wi-Fi，用蜂窝数据连接 | 应用显示已连接 | 连不上 = 先解决连接，再做本步 |
| 2. 锁屏静置，保持 720 s 以上。期间不碰手机 | 无。记录实际时长 | 没满 720 s 就回车 = 在结论里写明实际时长，不能当连续存活证据 |
| 3. 心跳不用手工取。`device-analyze.py` 收尾时自动算最大间隔 | 见 04-analysis.txt 的输出 | 见下面的判定 |
| 4. 单独跑一次连接期保活：从扩展建 TUN 到隧道可用 | 全程持有长时任务 | 见下面的判定 |

### 机器会抓到什么

- 心跳：`status heartbeatMs=<epoch ms>`（`TailscaleVpnExtensionAbility.ets:1865`）。
  扩展的状态定时器每秒刷一次（`:852`），本轮已给它加了设备日志镜像。
  `device-analyze.py` 从采集文件里算相邻两条的最大间隔。
- 连接期保活：`background_started` 是否早于 `vpn_connected`。
- 扩展是否重启过：`vpn_extension_created` 与 `vpn_extension_destroyed`。
- 总跨度不足 600 s 时，分析器会打印「没到 720 s，不能当连续存活证据」。
- 快照：`M-18.png`、`M-18.layout.json`。

### 判定阈值

- 相邻两条 `heartbeatMs=` 的间隔全程 ≤ 15 s。
- `vpn_extension_created` 全程只出现一次，且没有 `vpn_extension_destroyed`。
- `background_started` 早于 `vpn_connected`。

### 失败长什么样

- 最大间隔 > 15 s = 扩展停写过，后台被冻结。
- 出现 `vpn_extension_destroyed` = 扩展被重建，长时间存活的结论要打折。
- `background_started` 晚于或缺失于 `vpn_connected` = 连接期没有全程持有长时任务。
- 一个 `heartbeatMs` 都采不到 = 镜像没生效，或采集窗口没覆盖连接期。

### 边界

- 全程 USB/HDC 连接且充电。这会改变电源管理行为。
  通过一次不等于电池深度休眠、拔线、强杀或重启后仍成立。
- 没满 720 s 就回车时，在结论里写明实际时长。这一段不能当连续存活证据。
- 「进程 ID 不变」这条已换掉。诊断事件不含 PID，`devecocli` 也没有取进程列表的命令。
  现在用生命周期事件代替 PID，判定力等价。
- 本轮另有一条自动化 E2E `scripts/e2e/screen-off-survival.mjs`，用 `power-shell suspend` 锁屏。
  它可用时，锁屏段不必人工守。用哪条跑要写进结论。

### 回填

`manual-checks.md` 顶部登记表的 M-18 行（第 32 行），并更新 M-11（第 121 行）。

### 做完推动什么

`QG-01`、`QG-02`、M-11、`O-BGTASK-13` 可以往前走。

---

## 回填速查

| 条目 | 登记册位置 |
| --- | --- |
| M-14 | `manual-checks.md:28`（表行）+ 新增一节 |
| M-15 | `manual-checks.md:29`（表行）+ 新增一节 |
| M-16 | `manual-checks.md:30`（表行）+ 新增一节 |
| M-17 | `manual-checks.md:182`（现有 `## M-17` 一节） |
| M-18 | `manual-checks.md:32`（表行）。连带更新 `manual-checks.md:121` 的 M-11 |

回填格式照 `manual-checks.md` 现有条目：一句结论、来源、测得数值。
未闭环时写清哪一部分没做到。**不允许把「没跑到」写成「通过」。**
