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
| 应用日志（按包名、按时间窗、按关键字） | `devecocli log --device <serial> --bundle-name ren.w2h.mesharc --from 5m --keyword <词>` |
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
3. 装机：`devecocli run --device <serial> --skip-build`（先在本机构建）。
4. 清空上一轮的诊断文件，避免旧事件混进来。

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
3. 记下扩展侧的状态：`devecocli log --device <serial> --bundle-name ren.w2h.mesharc --keyword vpn_connected`。
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

**观察**：`devecocli ui layout` 读卡片节点文本；`devecocli log --keyword performCardToggle`。

**判定**：卡片不得白屏；文案不得与应用的连接状态相反；未登录时必须拉起窗口。

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

**观察**：`devecocli log --keyword taildrive`；`docs/` 里 Taildrive 的请求环超时（32 s / 35 s / 30 min+10 s / 5 s）。

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
2. 设置子类型常量（`SUBMODE_*`），先在应用内触发 `requestAuthFromUser`，看用户授权横幅。
3. 连接后切到后台，观察是走 special-scenario 还是回落到 `DATA_TRANSFER`。

**判定**：`isModeSupported()` 与 `checkSpecialScenarioAuth()` 的实际返回值要记下来；
回落路径必须与现在完全一致。

**注意**：子类型的选定等于向华为申明本应用的用途。这是一个需要提交方承担的决定，
不由实现者代选。

**影响**：D4 的失效条件、`O-BGTASK-01`、`Q17`。

---

## M-17 · Q-02：VPN 替换批准的 10 秒 TTL（并与 M-10 合并）

**为什么**：`vpn-replace-approved` 的读侧 TTL 只有 10 s，
而写方在 UI 进程。批准对话框弹出时用户正好切走，10 s 后批准还灵不灵，未验证。
另外**全仓库目前找不到这个文件的写方**——"批准后替换"这条路径没有实现。

**步骤**

1. 手机上保留另一个占用 VPN 通道的应用（shadowsocks）。
2. 在 MeshArc 里发起连接，等冲突提示与批准对话框出现。
3. 立刻切到别的应用，等待超过 10 s，再回到 MeshArc。
4. 记录扩展是重问、直接失败，还是静默继续。

**观察**：`devecocli log --keyword vpn_replace`、`vpn_conflict`、`vpn_replacement_approved`。

**影响**：`O-SEAM-16`、`R-CONN-07`、登记册的 M-10（目前记为「部分」）。

---

## M-18 · Q17：蜂窝下的长时间存活与连接期保活复跑

**为什么**：两件事挤在一起。`QG-01` 的目标值写着「≥ 720 s」，但蜂窝版的 M-11 **从未完成**；
`QG-02` 的「连接期保活覆盖」逻辑已由单元测试闭环，真机却没复跑。

**步骤**

1. 关掉 Wi-Fi，用蜂窝数据连接。
2. 锁屏静置，保持 **720 s 以上**。
3. 期间按 `device-background-vpn-probe.ps1` 的同一节拍采样（或 `devecocli log --from 12m --keyword heartbeatMs`）。
4. 另外单独跑一次连接期保活：从扩展建 TUN 到隧道可用，确认全程持有长时任务。

**判定**：心跳龄全程 ≤ 15 s、进程 ID 不变、`background_started` 早于 `vpn_connected`。

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

## 回填规则

每条的结论按 `manual-checks.md` 现有的格式写：一句结论、来源、测得数值、
以及「未闭环」时要写清哪一部分没做到。**不允许把「没跑到」写成「通过」**——
登记册里 M-05 曾经被误当成通过证据使用，那是本项目已经犯过一次的错。
