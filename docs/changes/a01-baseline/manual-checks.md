# 真机走查登记册 · a01-baseline

判据的走查锚点写成 `真机走查 a01-baseline/manual-checks.md#M-nn`。

**这份登记册以转抄为主。** 每条的「来源」指向仓库里已有的实测记录，多数条目本批没有重新执行。
例外是 M-13 与 M-18，它们的来源是「本轮真机（非转抄）」。哪些是实测数值、哪些只是待执行的规程，逐条写明。

设备：`Pura 80 Pro` / `HarmonyOS 7.0.0.105`（M-01～M-04、M-06～M-09）；
`Pura X` / `56T0225330000021` / `HarmonyOS 7.0.0.105`（M-05、M-10）。
所有设备工作均在 USB/HDC 连接且充电的条件下完成——这会改变电源管理行为，
通过一次不代表电池深度休眠、拔线、强杀或重启场景。

| 锚点 | 检查项 | 结论 |
| --- | --- | --- |
| M-01 | 锁屏静置下的后台存活 | 通过（实测） |
| M-02 | 数据面在锁屏前后的双向流量 | 通过（实测） |
| M-03 | 网络切换后的路径恢复 | 通过（实测） |
| M-04 | 短暂 down/up 后的自动恢复 | 通过（实测） |
| M-05 | 连接期的长时任务与握手时序 | 通过（诊断实测） |
| M-06 | 引擎自检 | 通过（实测） |
| M-07 | 后端启动与登录态 | 通过（实测） |
| M-08 | 应用外壳 Want 生命周期 | 通过（实测） |
| M-09 | 媒体服务识别与 HosPlayer 参数 | 通过（实测） |
| M-10 | 竞争 VPN 冲突（本应用不替换对方） | 部分（未闭环） |
| M-11 | 720 秒连续蜂窝锁屏 | 未完成（不计入通过） |
| M-12 | 桌面卡片渲染与点击 | 未执行 |
| M-13 | 两个进程里同一份 `.so` 是几个运行时 | 通过（本轮真机，两个独立运行时） |
| M-14 | 桌面卡片开关 | 未执行（待本轮真机） |
| M-15 | Taildrive 真机共享节点 | 未执行（待本轮真机） |
| M-16 | special-scenario 长时任务 | 部分（回落分支已测；正常路径缺 ACL 与子类型定值） |
| M-17 | VPN 冲突路径是否收敛 | 部分（第三条已测，前两条缺第二个 VPN 应用） |
| M-18 | 蜂窝下的长时间存活与连接期保活复跑 | 部分（Wi-Fi + USB 供电下通过；蜂窝记为 M-11，未完成） |
| M-19 | 冷启动到可用的耗时 | 通过（实测，定 ≤ 200 ms） |

M-14 到 M-17 的步骤与判定见 `device-runbook.md`。它们由 `scripts/device-run.sh` 在一次上机里跑完。
**未执行不等于通过。** 回填前，这几条不计入任何通过证据。M-18 与 M-19 已在本轮执行，见下文各节。

---

## M-01 锁屏静置下的后台存活

- 阈值：时长 ≥ 720 s；全部样本 `state=Running`；心跳龄 ≤ 15000 ms；进程数 ≥ 2；首末 pid 相同；
  锁屏下除基线外全部样本电源态落在 `INACTIVE/STAND_BY/DOZE/SLEEP/HIBERNATE`。
- 实测：721 秒、25 个样本（含基线）、24 个后基线样本**全部 `SLEEP`**、
  UI/VPN 进程 ID 全程不变、最大心跳龄 **1104 ms**。
- 前置：已登录并连上；**未**同时运行其它系统 VPN。
- 命令：`powershell -File scripts/device-background-vpn-probe.ps1 -DurationSeconds 720 -LockScreen`
- 失败记录：第一次运行因亮屏使用被打断，**不计入**连续锁屏通过。
- 来源：`docs/background-vpn-reliability.md` Milestone 1 results（转抄）。

## M-02 数据面在锁屏前后的双向流量

- 阈值：浏览器产生的 TUN 流量读、写计数**双向都增长**；对端探针以 `OK` 或 `SKIPPED` 开头。
- 实测：锁屏前 +13 reads / +18 writes；解锁后 +16 reads / +20 writes。
- 命令：`powershell -File scripts/device-vpn-data-probe.ps1`
- 来源：`docs/background-vpn-reliability.md` Milestone 1 results（转抄）。

## M-03 网络切换后的路径恢复

- 阈值：同一次 VPN 会话内完成 cellular → Wi-Fi → cellular 重绑；回到 Wi-Fi 后无需重连即恢复直连；
  两种承载下浏览器 TUN 流量都通过。
- 实测：基线（修复前）直连 IPv6 discovery 响应 85 ms；修复后回到 Wi-Fi 为 **11 ms**；
  Wi-Fi +142/+142 包，cellular +12/+20 包。六次 discovery 均走 DERP 时记录
  `MappingVaries=true`、`localPort=41641`。
- 来源：`docs/vpn-network-recovery.md`（转抄）。

## M-04 短暂 down/up 后的自动恢复

- 阈值：不重建 VPN 会话，界面显示恢复中并自动回到可用路径。
- 实测：短 `tailscale down`/`up` 后手机显示 `connection recovering`，
  自动恢复 **436 ms 的中继路径**，VPN session 不变。
- 来源：`docs/vpn-network-recovery.md` Peer reconnect follow-up，2026-09-23（转抄）。

## M-05 连接期的长时任务与握手时序

- 阈值：扩展建 TUN 后请求后端交接，应用进程必须在 15 s 内应答；否则扩展销毁 VPN。
- 实测（诊断文件 `diagnostic-ui-events.ndjson` / `diagnostic-vpn-events.ndjson`，Pura X）：
  - 失败样本：14:10:18.864 建 TUN → 14:10:23.973 用户切后台 → 14:10:34.468
    `vpn_backend_handoff_timeout`，VPN 被销毁。
  - 冻结证据：13:38:14 设置的延迟重启定时器，回调直到 **14:10:00** 才执行（迟 32 分钟），
    后台期间进程未写任何诊断。
- 本批的修复**未经真机端到端复跑**：需要先断开竞争的 `com.xbt.project`（shadowsocks）VPN，
  再复现「连接后 5 秒内切到别的应用」。
- 来源：`docs/background-vpn-reliability.md` Milestone 3（转抄）+ 本批代码改动（未复跑）。

## M-06 引擎自检

- 阈值：布局出现 `Go go1.24.5`、`openharmony/arm64`、`Tailscale 1.86.5`、`userspace engine initialized`。
- 命令：`powershell -File scripts/device-engine-probe.ps1`
- 来源：`scripts/device-engine-probe.ps1` 的判定分支 + `docs/development.md`（转抄；本次未执行）。

## M-07 后端启动与登录态

- 阈值：点击后端启动后，状态进入 `state=NeedsLogin` 或 `state=Running`。
- 命令：`powershell -File scripts/device-backend-probe.ps1 -ArtifactDir <dir>`
- 来源：`scripts/device-backend-probe.ps1` 的判定分支（转抄；本次未执行）。

## M-08 应用外壳 Want 生命周期

- 阈值：冷启动经通知 Want 打开；重复 Want 不重启进程且仍停在目标页；非法 Want 被拒且停在首页。
- 命令：`powershell -File scripts/device-app-shell-probe.ps1`
- 来源：`scripts/device-app-shell-probe.ps1` 的判定分支（转抄；本次未执行）。

## M-09 媒体服务识别与 HosPlayer 参数

- 阈值：自检输出 `PASS · 媒体服务识别 4/4 · HosPlayer 参数协议通过`。
- 入口：设置 > 关于 > 连点版本号 5 次解锁诊断 > 媒体服务离线自检。
- 来源：`docs/hosplayer-integration-prototype.md`（转抄；本次未执行）。

## M-10 竞争 VPN 冲突（本应用不替换对方）

- 阈值：另一个系统 VPN 已连接时，连接本应用要给出可理解的冲突提示，
  并且**不销毁对方的 VPN**。用户自行去系统设置里断开对方，然后重试。
- 原阈值写的是「经用户批准后才能替换」。第 12 轮查证后**替换的实现不存在**，
  也没有它的写方，所以那条分支已删除（`fe35016`）。阈值按实际产品行为改写。
- 实测：**未闭环**。Pura X 上 `com.xbt.project:vpn` 长期占用 VPN 通道，
  本批探针无法在不拆掉该隧道的前提下完成连接复现。
- 来源：本批观察（`hdc shell pidof com.xbt.project:vpn` → 11861）+ `README.md` 的兼容性说明。
  复现改由 M-17 承担。

## M-11 720 秒连续蜂窝锁屏

- 状态：**未完成**。两次运行分别记录到 279 s、309 s 后被亮屏打断（第二次系统报 `PICKUP`）。
- 结论：不计入连续锁屏通过。不得据此宣称蜂窝下的长时间后台存活。
- 来源：`docs/vpn-network-recovery.md`（转抄）。

## M-12 桌面卡片渲染与点击

- 状态：**未执行**。需要在桌面手工添加卡片后逐项验证。
- 来源：`docs/home-screen-card.md` 的 Validation status（转抄）。

## M-13 两个进程里同一份 `.so` 是几个运行时

- 阈值：读两个进程各自的「本进程引擎状态」。UI 进程显示 `stopped` / `NoState` 而扩展侧在跑
  → 两个独立运行时，D3(a) 成立。
- **已实测的部分（2026-10-13，Pura X `56T0225330000021`）**：一次连接旅程里，
  设备日志出现**两个不同的进程号**，且 tag 不同。

  | 时间 | 事件 | 进程 | tag |
  | --- | --- | --- | --- |
  | 14:45:40.245 | `background_started` | 7641 | `ren.w2h.mesharc` |
  | 14:45:55.584 | `vpn_extension_created` | 8168 | `ren.w2h.mesharc:vpn` |
  | 14:45:55.643 | `vpn_tun_created` | 8168 | 同上 |
  | 14:45:59.919 | `vpn_connected` | 8168 | 同上 |
  | 14:46:06.769 | `vpn_extension_destroyed` | 8168 | 同上 |

  结论：**UI 与扩展各在自己的进程里**，扩展的生命周期与建 TUN、隧道可用全部落在 8168。
  这是 D3(a) 成立的必要条件。
- **已实测的部分二（2026-10-13）**：连接成功后，在工程诊断面板读三个读数：

  | 读数 | 值 |
  | --- | --- |
  | `vpn-status` | `OK │ state=Running │ tun=true │ tailscaleIPs=2` |
  | `engine-status` | `Tailscale Engine Pending` |
  | `backend-status` | `STOPPED │ backend not started` |

  隧道由扩展侧跑着，而 **UI 进程这一侧没有引擎**（Pending）**也没有后端**（STOPPED）。
- **结论：两个独立运行时，D3(a) 成立。** 三个证据互相独立：两个进程号、两个日志 tag、
  以及 UI 进程侧引擎与后端均为空。
- 复跑：`DEVICE=<序列号> node --test scripts/e2e/engine-runtimes.mjs`（4 条）
- 来源：本轮真机（非转抄）。
- 证据位置：`~/mesharc-e2e/connect-journey-*.log`（439 行设备日志）。
- 命令：`DEVICE=56T0225330000021 node --test scripts/e2e/connect-journey.mjs`

## M-18 锁屏静置下的后台存活

- 阈值：静置 ≥ 720 s；全程相邻两条 `heartbeatMs=` 的间隔 ≤ 15 s；扩展只被拉起一次，全程不被销毁。
- 实测（2026-10-13，Pura X `56T0225330000021`，**机器自动执行**）：1500 个心跳、跨度 **750 s**、
  最大间隔 **2.8 s**（中位 0.318 s）、超过 15 s 的间隔 **0 处**、`vpn_extension_created` 1 次、
  `vpn_extension_destroyed` 0 次。
- 方法：`scripts/e2e/screen-off-survival.mjs`。连接后由脚本调设备自己的 `power-shell suspend` 锁屏，
  等满 720 秒再 `wakeup`，从采集到的设备日志算间隔。**不需要人守在手机旁。**
- 边界：本次在 **Wi-Fi** 下、**USB 连接且充电**。USB 供电会改变电源管理行为。
  通过一次不代表电池深度休眠、拔线或重启后仍成立。**蜂窝版仍未做（M-11）。**
- 「进程 ID 不变」这条判据没有照原样执行：诊断事件不含 PID，改用扩展生命周期事件代替，判定力等价。
- 证据：`~/mesharc-e2e/screen-off-survival-*.log`（2531 行）。
- 命令：`DEVICE=56T0225330000021 node --test scripts/e2e/screen-off-survival.mjs`
- 来源：本轮真机（非转抄）。

## M-14 到 M-17

这四条由 `device-run.sh` 在一次上机里跑完，步骤见 `device-runbook.md`，操作步骤见 `operator-sheet.md`。
M-16 与 M-17 已部分执行，见下文。**M-14、M-15 全部未执行**，不计入任何通过证据。

## M-16 special-scenario 长时任务

- 阈值：连接后长时任务起来，且 `background_special_scenario_*` 的原因记录与走哪条路一致。
- **已实测的部分（2026-10-13，Pura X）**：回落分支走通了。一次冷启动到连接的旅程里，
  `background_special_scenario_unconfigured` 出现 2 次，长时任务照常由 `DATA_TRANSFER` 起。
  这说明「尝试 special-scenario → 判为未配置 → 回落」这条链是活的，且原因被记了下来。
- 证据：`~/mesharc-e2e/m17-probe-2026-10-13T07-23-31-874Z.log`。
- 未执行的部分：special-scenario 真正起来的正常路径。它卡在两个前置上，
  两个都不是本轮能决定的：
  1. 受限权限的 ACL 未获批。声明这行权限会导致安装失败，所以默认关着。
  2. 子类型常量 `SPECIAL_SCENARIO_SUBMODE` 仍是 `0`（整条路径故意不启用）。
     选哪个子类型等于向华为申明本应用的用途，要提交方决定。
- 本条不新增诊断埋点也能测：`background_special_scenario_unconfigured` 是本轮新加的记录。
- 来源：本轮真机（非转抄）。

## M-19 冷启动到可用的耗时

- 阈值：尚未定值。**用本条的实测结果去定**，定值前 `QG-08` 保持 draft。
- 实测（2026-10-13，Mate 60 Pro `2LQGK24828000076`）：五次冷启动的
  `EntryAbility onCreate` → `ui_opened` 分别为 132 / 139 / 140 / 155 / 140 ms，
  中位 **140 ms**，最大 155 ms。五次进程号各不相同，确为冷启动。
- 方法：`hdc shell aa force-stop` → `aa start` → 取设备日志里两个锚点的时间差。
  由 `scripts/device-run.sh` 自动执行，`scripts/device-analyze.py` 自动计算。
- 边界：不含启动器点击与进程创建。该边界成立的原因是本次没有在启动器上测量。
- 来源：本轮真机（非转抄）。

## M-17 VPN 冲突路径是否收敛

- 阈值：冲突提示出现；应用在检测到冲突后停掉自己的扩展；**杀掉应用进程后不再有其它 VPN 时重连，不得报冲突**。
- 步骤：见 `device-runbook.md` 的 M-17，共七步。
- 观测：`vpn_conflict`、`vpn_conflict_detected`、`vpn_conflict_self_disconnect_requested`、
  `vpn_conflict_self_disconnect_completed`、`vpn_conflict_self_disconnect_failed`、
  `vpn_conflict_acknowledged`、`vpn_create_failed` 这些诊断事件经 hilog 镜像到达主机。
  在 `device-run.sh` 的采集文件里找（`03-log*.txt`）。
  `devecocli log --from` 与 `devecocli log --keyword` 在这台设备上返回 0 行（设备时钟与主机差 3 小时），不要用。
- 状态：**部分执行**（2026-10-13，Pura X）。第三条已测得；前两条被阻塞，原因见下。
- 已测结果（第三条）：
  - 操作：`aa force-stop ren.w2h.mesharc` 杀掉应用进程，此时设备上没有其它 VPN，再冷启动并点连接。
  - 观测：冲突相关事件命中 **0** 条。日志里是干净的 `vpn_extension_created` → `vpn_tun_created` → `vpn_connected`，三步的 `code` 都是 0。
  - 证据：`~/mesharc-e2e/m17-probe-2026-10-13T07-23-31-874Z.log`（154 行）。
  - 结论：判据第三条成立。强杀应用进程不会留下占位的 VPN 注册，重连不报冲突。
- 边界：本次强杀同时结束了 UI 进程与 `:vpn` 扩展进程，槽位被系统一并释放。
  「只死 UI、扩展活着占槽位」那种更严的情况没有测到，因为 `kill -9 <UI 进程>` 返回 `Operation not permitted`。
- 前两条为什么阻塞：设备上没有第三方 VPN 应用（`bm dump -a` 只有系统包 `com.huawei.hmos.vpndialog`），
  触发不了 `VPN_EXISTS_ERROR_CODE`(2203002)。
- 来源：本轮真机（非转抄）。
- 为什么这么判：冲突循环没有次数上限，也没有自杀超时（`TailscaleVpnExtensionAbility.ets:602`），
  只在应用停掉扩展时结束。应用在检测到冲突时自停（`BridgeStatus.ets:4339`），
  所以只有应用进程死掉时才无人停它。最后一步就是打这个空洞。
- 来源：`device-runbook.md` M-17（本轮新写）。
