# 本次增量 · VPN 常驻、断连恢复与省电

- 流程版本：a01（ai-native-coding 第 01 版）。基线流程见 [a01-baseline](../a01-baseline/record.md)。
- change-id：`vpn-endurance`
- 开工日期：2026-10-20
- 代码基线：`ec64476`（分支 `local-build`）。工作树有未提交改动，见「开工时的工作树」。
- 真机：Pura X / `56T0225330000021` / HarmonyOS 7.0.0.105。2026-10-20 换机后改为
  HUAWEI ALN-AL00 / `2LQGK24828000076` / API 26。新设备由用户完成 Tailscale 登录。

## 用户报告

来源：2026-10-20 的用户消息。原文要点：

1. 手机连续使用几天后出现几次长时间使用中的 VPN 断连。
2. 用户没有点击停止连接时，连接不得停止。
3. 网络不通时要监听网络变化。网络恢复后恢复连接。
4. 系统提示耗电较多。用户不在用时不要一直计算，要加省电逻辑。
5. 排查不出来时，要把日志存到本地。非用户原因的断连都要记录。

## 开工时的工作树

开工快照（`git status --short`，2026-10-20）：

- 已修改：`docs/changes/a01-baseline/manual-checks.md`、`operator-sheet.md`、`record.md`、
  `scripts/a01-review-snapshot.py`、`scripts/device-run.sh`、`scripts/e2e/*`、`scripts/run-checks.sh`。
- 未跟踪：`docs/changes/a01-baseline/e2e-results.json`、`scripts/check-e2e-*.py`、
  `scripts/e2e/` 下 26 个 E2E 脚本、`scripts/test-vpn-special-scenario.mjs`。

这些改动属于上一批次（E2E 层）的未提交产物。本批次不改动它们，也不把它们当作本批次的证据。
本批次自己的改动逐条列在「改动清单」。

## 开工取证（真机，2026-10-20）

证据来自设备沙箱的诊断文件，不是推断：

- `diagnostic-ui-events.ndjson`（99 条）
- `diagnostic-vpn-events.ndjson`（99 条）
- `vpn-probe-status.txt`
- `process`：`ren.w2h.mesharc` 的 pid 自 2026-10-20 01:20:08 起未变，一直是 131。

时间线（本地时间，取自事件时间戳）：

| 时刻 | 事件 | 说明 |
| --- | --- | --- |
| 04:17:03 | `background_status_timeout`、`background_stopped` | 状态心跳超时，长时任务被释放 |
| 04:17:04 | `background_special_scenario_unconfigured`、`background_started` | 重新取得 dataTransfer 任务 |
| 05:19:31 | `background_user_cancelled`（reason=1） | 用户取消了保活通知 |
| 05:19:34 | 扩展 `media_probe_completed` | 扩展最后一次写入诊断事件 |
| 11:01:56 | `vpn_network_rebound_cellular` | 网络切到蜂窝，会话保持 |
| 11:51:52 | `vpn_network_rebound_wifi` | 网络切回 Wi-Fi，会话保持 |
| 14:35 左右 | 各命令文件更新时间 | 扩展仍持有命令通道 |
| 17:34:57 | 当前 `vpn-probe-status.txt` 心跳 | 会话仍为 `state=Running | tun=true` |

事实与结论：

1. **应用进程没有死。** pid 131 持续运行，进程状态 `S`。
2. **扩展进程也没有在 05:19 之后重启。** `vpn_network_rebound_*` 事件由扩展进程写入，说明
   05:19 之后扩展仍活着。
3. **05:19:31 之后 UI 进程没有任何后台事件。** 这与一条平台事实一致：后台且无长时任务的进程会被冻结，
   它的 JS 定时器停止运行。上一批次已用迟到 32 分钟的 `setTimeout` 证明过这一点。
4. **用户看到的「断连」没有被现有日志覆盖。** 现有日志只记录保活任务、网络重绑和状态判读。
   它不记录会话为什么结束、谁结束的。

## 排查结论

本批次只确认了一条因果关系，其余列为待真机留证。

### 已确认：长时任务可能在连接期间被系统回收，且回收后不恢复

证据：

- `background_user_cancelled`（05:19:31）之后，`VpnBackgroundTaskManager.suppressedUntilDisconnect`
  置为 true。
- 该标志只在读到 `DISCONNECTED` 时清零（`VpnBackgroundTaskManager.ets:163-167`）。
- 若期间状态读取落在 `UNKNOWN`（心跳陈旧、文件正被原子替换），任务不会重新取得。
- 结果是：隧道仍在运行，但 UI 进程没有任何长时任务。此时 UI 进程被冻结或被回收，扩展进程仍然存活，
  但扩展依赖 UI 进程应答的三类请求失去应答方。

### 待真机留证：扩展进程自行销毁

平台 FAQ 明确列出 `Ondestroy` / `OnProcessDied` 等扩展销毁路径，也明确说明「启动进程或扩展进程任一退出，
系统都会停掉 VPN」。当前代码只记录 `vpn_extension_created` 与 `vpn_extension_destroyed` 两个生命周期事件，
不记录销毁的触发者。所以真机上再次出现断连时，现有日志无法区分以下四种原因：

1. 用户经 UI 或卡片断开。
2. UI 进程冻结导致扩展等待后端交接超时。
3. 扩展进程崩溃或被系统回收。
4. 系统策略（EDM、低电量策略、被替换）停止 VPN。

### 已确认：省电口径没有实现

代码证据：

- 扩展进程每 100 ms 轮询 9 个命令文件（`TailscaleVpnExtensionAbility.ets:831-844`）。
- 扩展进程每 250 ms 刷新接收通知，每秒读取一次完整后端快照。
- UI 进程在详情页打开时每 2 s 探测一次全部在线对端与媒体服务。
- UI 进程没有读取屏幕状态。锁屏后这些循环照常运行。

## 范围

本批次解决五件事：

| # | 内容 | 判据 |
| --- | --- | --- |
| 1 | 断连原因记录：所有非用户主动的断连写本地日志，带原因分类 | 新增 |
| 2 | 长时任务恢复：任务丢失后，只要会话仍在，系统取消或系统回收都要恢复 | 新增 |
| 3 | 断连后自动恢复：网络恢复后恢复连接；网络不通时等待网络变化，不盲目重试 | 新增 |
| 4 | 省电：后台降频，熄屏再降一档 | 新增 |
| 5 | 真机验证：12 小时锁屏、网络切换、熄屏唤醒后的恢复 | 新增 |

## 非目标

- 不改 Tailscale 引擎版本（固定 1.86.5）。
- 不改 VPN 冲突的用户交互。
- 不申请受限权限（`KEEP_BACKGROUND_RUNNING_SYSTEM` 等）。申请与 ACL 审批不在本批次。
- 不改上一批次未提交的 E2E 产物。事件名变化后，只更新受影响的断言
  （`scripts/e2e/background-reconnect.mjs`）。

## 路径映射

| 内容 | 路径 |
| --- | --- |
| 状态文件 | `docs/changes/vpn-endurance/flow.json` |
| 流程记录 | 本文件 |
| 设计增量 | `docs/changes/vpn-endurance/design.md` |
| 需求、架构、HLD、LLD 的修订 | 各自既有文档的修订节 |
| 判据增量 | `docs/oracles/` 既有文件的修订节与新增条目 |
| 审核快照与网页 | `docs/review/<层>/` |
| E2E 与真机证据 | `docs/changes/vpn-endurance/e2e-results.json`、`device-runs/` |

## 层进度

| 层 | 设计增量 | 判据增量 | 审核网页 | 人工结论 |
| --- | --- | --- | --- | --- |
| 需求 | 已写（R-CONN-11…13、R-NET-05、R-POWER-01/02；修订 R-CONN-05/09/10） | 已写（O-DIAG-02、O-NET-04 新增；旅程判据修订） | `docs/review/requirements/index.html` | 待审核 |
| 架构 | 已写（§2.6、§五 O-CONN-08、§七 O-SEAM-19） | 已写（O-SEAM-19 新增） | `docs/review/architecture/index.html` | 待审核 |
| HLD | 已写（C-03、C-11、C-15、C-19） | 已写（O-BGTASK 02/04/06/10/15 修订） | `docs/review/hld/index.html` | 待审核 |
| LLD | 已写（VM-5、VM-6、§4.7、§4.8、§6.7） | 已写（O-SESSION-09…13、O-POWER-01…04 新增；O-RECONN 02/05/11/12 修订） | `docs/review/lld/index.html` | 待审核 |

## 缺口回读

上一批次 `docs/changes/a01-baseline/` 没有 `gaps.md`。它的未决项记在
`docs/lld/lld.md §八` 与本记录各轮。与本批次改动面相交的条目：

| 缺口 | 来源 | 与本批的关系 |
| --- | --- | --- |
| O-SEAM-11 责任空洞：UI 进程冻结时恢复责任无人承担 | 架构 §四 D4 | 本批次正面处理 |
| 720 s 蜂窝锁屏存活未完成 | LLD §1.4 | 本批次重跑，延长到 12 h |
| 连接窗口 15 s 真机复现未重跑 | LLD §1.4 | 本批次一并复跑 |
| `VpnReconnectSupervisor` 最多 3 次后放弃 | R-CONN-05 | 与「用户未停止不得停止」冲突，本批次修订 |

## 审核链（2026-10-20）

| 项 | 结果 |
| --- | --- |
| 代码基线 | `ec64476` |
| 快照 | `docs/review/<层>/snapshot.json`，四层结构检查通过 |
| 人读决策页 | `docs/review/<层>/index.html`，由 `review-brief.cjs` 生成 |
| 机器追溯页 | `docs/review/<层>/oracles.html`，由 `review.py` 生成 |
| 决策说明 | `docs/review/<层>/review-brief.json` |
| 决策数 | 需求 5、架构 4、HLD 4、LLD 4 |
| 图数 | 需求 4、架构 7、HLD 6、LLD 5 |
| 门禁 | 四层均 fail，原因只有一条：缺少人工结论 |

门禁结果不是缺陷。a01 要求人工结论由审查者从页面导出。
本批没有生成任何接受记录。`docs/review/<层>/review-decisions.json` 仍保留基线批次的旧格式记录，
新决策页要求 `a01-review-decisions/2` 格式。审查者需要从新页面重新导出。

实现完成后，判据文档再次修改（O-SESSION/POWER/BGTASK 的状态与 O-DIAG-02 的锚点）。
`docs/review/<层>/snapshot.json` 因此与当前文档不一致。重新生成快照要求工作树干净或新提交，
用户尚未授权提交。该事项记为 `flow.json` 的 O-4。

判据检查命令与结果见 `checks/design-check.txt`。四段检查 P0 为 0。

文件与证据：

- `checks/design-check.txt`：`scripts/run-checks.sh` 全量输出。
- `checks/review-check.txt`：快照检查、决策说明检查与门禁结果。

## 实现与验证（2026-10-20）

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| I-01 集成测试 | 2 个文件：账本双向追加、档位跨进程一致 | `scripts/integration/session-ledger-seam.mjs`、`power-stage-seam.mjs` |
| I-02 单元测试 | 7 个文件：意图、账本、档位、恢复、长时任务、控制器、特殊场景 | `scripts/test-*.mjs` |
| I-03 有效 Red | 实现前 27 条失败，原因与计划一致 | `checks/red.txt` |
| I-04 开发 | 12 个生产文件改动（3 个新增） | 见「改动清单」 |
| I-05 宿主侧全绿 | 172 条用例，172 条通过，0 失败 | `checks/tests.txt` |
| 构建 | Debug HAP 构建成功。最终构建 35928034 字节 | `checks/build.txt` |
| I-06 E2E | 5 个文件在设备上运行。通过 6 条，跳过 4 条，失败 0。最终 HAP 的报告已发布 | `checks/e2e-steps.json`、`checks/e2e/`、`checks/device-run.txt` |

设备执行（2026-10-20 20:16 起，设备已连接）：

- 新 HAP 已安装（`hdc install -r`，保留应用数据）。
- `endurance-recovery.mjs`：跳过。设备 shell 的 uid 是 2000，不能向应用进程发信号。
  `hdc shell -b` 不切换 uid，应用私有目录也不能写。因此主机没有「只结束扩展」的通道。
- `network-recovery.mjs`：跳过。`svc wifi disable` 返回成功，但设备仍能上网。
  设备还有其它数据通道，主机无法造出离线条件。`svc data` 在本机不支持。
- `screen-off-survival.mjs`：720 秒静置运行通过。心跳 580 个，跨度 738 秒，最大间隔 6.9 秒。
  证据见 `checks/device-run.txt` 与 `checks/e2e-run/screen-off-survival-run2.*`。
- 安装重启恢复（手工检查）：通过。事件顺序为 `vpn_session_end_observed`、
  `vpn_session_recovery_attempt`、`vpn_session_recovery_started`、`vpn_session_recovered`。
  新旧 `sessionId` 不同，状态为 `state=Running`。证据见 `checks/device-run.txt`。

E2E 结构化运行日志（`checks/e2e-steps.json`）、报告（`checks/e2e/index.html`）与发布记录
已在最终批次生成，见下节 `最终验证（I-06/I-07）`。O-6 关闭。

因此以下项未取得真机证据，不记通过：

- 12 小时锁屏存活（O-CONN-06）。
- 断网后恢复网络自动重连（O-NET-04、O-CONN-09）。
- 扩展被杀后的恢复与原因记录（O-DIAG-02）。安装重启场景已通过，扩展被杀场景仍缺信号通道。
- UI 还原核对与发布。

全量检查（`bash scripts/run-checks.sh`，记录见 `checks/run-checks.txt`）：

- 宿主用例 172 条全部通过。
- 判据检查 P0 为 0。闭环组无命中。closed 95/140。
- 判据索引、资源键 657/657、诊断事件名 235 个、E2E 计划与公共件来源全部通过。
- 审核快照与判据不一致。原因是判据文档在本轮被修改，而快照重建要求工作树干净。
  该项记入 `flow.json` 的 O-4。

### 取消令牌修正（2026-10-20 21:00）

- 现象：安装重启后每次恢复在 3 到 12 毫秒内返回 `cancelled`。扩展没有启动。
- 原因：`VpnSessionController.connect` 把令牌读成「已取消」。
  `VpnReconnectSupervisor` 传的函数是「仍有授权」。两侧语义相反。
- 漏检：控制器用例按「true 表示取消」写，监督器用例按「true 表示仍有授权」写。
  两侧各自通过，接缝没有用例。
- 修正：控制器参数改名 `authorised`，判定改为 `!authorised()`。
  监督器测试桩按控制器真实语义判定。新增「后端等待后失去授权」用例。
- 验证：设备上恢复成功。宿主用例 158 条通过。

### 高层次复查后的修正（2026-10-20 21:40）

四个独立子 agent 按八项维度复查。下列强项在复查当天修复并补测试：

| 强项 | 修正 | 测试 |
| --- | --- | --- |
| 恢复撤销会停掉用户的新连接并写 stop 意图 | 撤销前先读意图，只在用户已停止时断开 | `a card reconnect supersedes an in-flight recovery without stopping the tunnel` |
| 无界面连接在第一次检查后不再复查用户停止 | 后端就绪后与启动扩展前各复查一次 | `a stop after the backend wait cancels the connect` |
| 连接窗口内可重复启动扩展 | CONNECTING 状态早退 | `a connect during the connect window does not start a second extension` |
| 卡片后台刷新不受档位治理 | 按档位放慢卡片刷新 | `the desktop card refresh slows with the power stage` |

## 最终验证（I-06/I-07）

### 账本写者隔离（2026-10-20 22:40）

高层复查的 HLR-07/08/09 指向同一处：两个进程重写同一账本，压缩会擦掉对方刚追加的行。
修正如下：

- 每个写者一个文件：P1 写 `vpn-session-ledger-ui.ndjson`，P2 写 `vpn-session-ledger-vpn.ndjson`。
  写者只追加和压缩自己的文件。
- 去重读取全部账本文件。读取按 `timestampMs` 升序合并，按 `sessionId + kind` 保留第一条。
- 旧版单文件与旧版 `vpn-session-end.json` 只读，升级后仍参与合并。
- HLD C-19 新增「并发与合并」契约。LLD 4.7 同步不变量。O-SEAM-19 与 O-SESSION-11/12 同步。
- 新增宿主用例 `a writer compacts only its own file`。集成用例改名为
  `two writers append to one ledger and neither rewrite drops the other record`。
- 宿主侧 172 条用例全部通过。

### 新设备最终批次（2026-10-21 00:02）

- 设备：`2LQGK24828000076` / HUAWEI ALN-AL00 / API 26。用户完成 Tailscale 登录。
- 命令：`scripts/e2e/run-batch.sh install-restart-recovery endurance-recovery network-recovery background-reconnect screen-off-survival`
- HAP：35928034 字节，22:45 构建。
- 结果：10 条用例，通过 6，失败 0，跳过 4。步骤 21 条，通过 15，跳过 6，失败 0。
- 锁屏存活：心跳 221 个，跨度 740 秒，最大间隔 6.9 秒。扩展创建 1 次、销毁 0 次。
- 安装重启恢复：旧会话 1792501348074 记录结束原因，新会话 1792501414003 为 `state=Running`，
  没有 `user_stop`。按写者分文件的账本读取器成功合并旧记录。
- 跳过 4 条与原因：扩展被杀无信号权限、断网后仍有蜂窝、后台掉线无通道、卡片点击无通道。
- 报告：`checks/e2e/index.html`，发布记录见 `checks/e2e-published.txt`，HTTP 200。
- 元数据更正：`deviceEnvironment` 曾硬编码旧机型。本次记录的环境字段按设备参数更正，
  用例、步骤、截图与时间戳未改动。生成器改为查询设备参数。

### 12 小时锁屏存活尝试（2026-10-21 03:24 至 15:24）

- 结果：失败。心跳跨度 34,826 秒，未到 43,200 秒。
- 锁屏期：9,294 个心跳，最大间隔 6.9 秒，扩展创建 1 次。
- 结束原因：13:07:14 屏幕变为 `active`，13:07:15 界面写入 `user_stop` 并把意图置为 stopped。
  这是用户主动停止，不是应用自行断连。用例前提「全程无人操作」被破坏。
- 日志采集在 13:05 停止，比停止动作早约 2 分钟。诊断文件完整记录了停止序列。
- 结论：12 小时连续存活未取得。O-CONN-06 不记通过。记录见 `checks/device-run.txt`。

### 日志流重连修正（2026-10-21 21:12）

- 现象：第一次 12 小时尝试的 hilog 流在 9 小时 42 分时断开，比停止动作早 2 分钟。
  长跑中一旦断流，心跳统计就停止，用例会因主机侧原因失败。
- 修正：`LogStream` 在子进程退出后 2 秒重连。重连会回放设备缓冲区，按整行去重。
- 提交：`b6a634a fix(e2e): reconnect the device log stream after hdc drops`。
- 验证：本机杀掉任务子进程后 2 秒出现新进程，行集合无重复。

### 12 小时锁屏存活复跑（2026-10-21 22:00 至 2026-10-22 04:52）

- 22:00 第一次起跑失败。设备处于安全锁屏，`devecocli ui layout` 返回
  `Empty dumpLayout response from device`。应用能启动，但 4 秒后转后台。
- 23:41 第二次起跑。起跑前检查电源为 `AWAKE` 且焦点窗口属于应用。连接用例 34 秒通过。
- 04:52 作废。另一会话在同一设备跑真机门禁，屏幕在 23:47–02:17、02:54–03:04、
  03:17–03:56、04:22–04:33 等区间点亮。锁屏条件不成立，测量不能作为 O-CONN-06 证据。
- 期间隧道未断连：无 `user_stop`，无 `vpn_session_end`，扩展未销毁。
- 处置：停止全部相关进程，恢复默认熄屏超时，设备交给另一会话。
- 结论：O-CONN-06 仍未通过。需要一次独占设备、全程无人操作的 12 小时运行。
  记录见 `checks/device-run.txt`。

### 旧设备最终批次（2026-10-20 23:33）

- 设备：Pura X `56T0225330000021`。用户换机前完成。
- 结果与新区一致：通过 6，失败 0，跳过 4。锁屏存活心跳 218 个，跨度 739 秒，最大间隔 7.0 秒。
- 此前 22:45 的批次全部失败在启动应用。原因：设备停在安全锁屏。人工解锁后复跑得到上述结果。
  失败记录保留在 `checks/device-run.txt`。

### UI 还原核对

- 判定：`not-applicable`，退出码 0。
- 理由：只改运行行为与定时器节拍，不改布局、颜色、字体、图标与控件结构。
  项目未配置 UI 还原适配器与设计稿来源。
- 报告：http://100.111.99.60/proj/mesharc-ui/e2e/vpn-endurance/index.html
- 该理由待人工复审。

### 高层次复查

- 清单：`checks/high-level-review.json`。49 条合并漏项，8 项覆盖说明，4 个独立上下文。
- 门禁：`blocking`，退出码 1。1 条强项 open，30 条弱项 open，0 条签字接受。
- 本轮处置的强项：
  1. 新鲜连接意图在扩展报出 connecting 前取得保护。
  2. 前台关闭通知后立即重新武装保护。
  3. UNKNOWN 状态不再第二次启动扩展。
  4. 原因词表补齐系统停止与网络失效的生产者。
  5. 熄屏快照窗口与读取侧接受窗口一致。
  6. 后台停止剩余界面定时器。
  7. 后台健康轮询不再触发对端与媒体探测。
  8. 账本并发压缩改为写者隔离（3 条同锚点）。
- 未处置的强项：P1 被冻结或死亡时没有子系统负责恢复。P2 没有启动连接的恢复入口，
  平台也不提供应用进程死亡后让扩展自行恢复的回调。见 HLD C-11 与 O-CONN-08 的不确定特征。
- 报告：http://100.111.99.60/proj/mesharc-hlr/e2e/vpn-endurance/index.html

### 生成报告按钮不可达修正（2026-10-22 13:11）

- 现象：`diagnostics-report` 第 2 条与第 5 条找不到 `diagnostic-report-generate`。
- 实测：按钮在第 8 次上滑后进入布局树，位置在页签栏下方。第 9 次上滑后升到页签栏上方。
  页面已到底。旧循环滑完最后一次不再复查，差一步返回 null。
- 修正：每次滑动后复查。节点位置连续三次不变即判到底。调用点上限从 8 改 12。
- 提交：`17bd461 fix(e2e): check the scroll position after the last swipe`。
- 设备复跑：diagnostics-report 5 条通过，1 条失败，1 条跳过。失败项是状态行。
  状态行的应用修正见下一节。

### 报告状态行修正（2026-10-22 13:20）

- 现象：诊断报告生成完成并打开系统分享后，状态行仍显示「正在生成诊断报告…」。
- 实测：设备日志有 `diagnostic_report_generated` 与 `diagnostic_share_opened`。
  状态行文字在 15 秒内不变化。
- 原因：状态行把状态字符串按值传给 `@Builder`。`@Builder` 保留第一次的值。
  第二次赋值不更新已建的 `Text`。
- 修正：`DiagnosticsReportPanel` 直接读 `diagnosticReportStatus`。样式与 `DiagnosticStatus` 一致。
- 提交：`11f8b44 fix(ui): refresh the report status line after generation`。
- 同类风险：其余约 20 处状态行仍按值传参。记 O-6。
- 附带修正：补丁使文件下移 17 行，9 条诊断事件登记行号失真。
  `docs/diagnostics/event-names.md` 已更新，235 个名字校验通过。
- 宿主检查：172 条通过，0 失败，0 跳过。判据 P0 为 0。

### 全量设备批次（2026-10-22 14:25）

- 设备：2LQGK24828000076 / ALN-AL00 / API 26。HAP 35934430 字节，14:12 构建。
- 命令：`scripts/e2e/run-batch.sh` 28 个文件。基线 d681465。
- 报告：10 条用例通过 7、失败 0、跳过 3。基线 d681465。HTTP 200。
- diagnostics-report：7 条通过，0 失败，0 跳过。上一批为 4 通过、2 失败、1 跳过。
  两条失败都已修：生成按钮不可达、状态行不刷新。
- endurance-recovery：1 条通过，0 失败，0 跳过。上一批为跳过。
  通道是应用诊断动作「手动切断系统 VPN 连接」。旧会话记 extension_destroyed，
  新会话 state=Running，没有 user_stop。
- 跳过 3 条：后台非主动掉线、卡片点击、断网恢复。原因见 O-2。
- 批次内 24 个文件无失败。复跑 endurance-recovery 后为 25 个。
  环境受限的失败：taildrive-browser、taildrop-text。
- taildrop-send：前置检查读到 taildrop=loading，40 秒未到 ready。
  设备日志显示扩展在检查窗口内重启，随后 taildrop 回到 ready。
  用例已改为等 ready 再判定，复跑结果见 `checks/device-run.txt`。

### 审核快照重建（2026-10-22 15:36）

- 命令：`scripts/a01-review-pages.sh --baseline d681465`。
- 四层快照重新生成：需求 121 条、架构 156 条、HLD 260 条、LLD 269 条。
  每层 `review.py --check` 通过，退出码 0。
- 全量 `scripts/run-checks.sh` 退出码 0。172 条用例通过，P0 合计 0 条。
  新鲜度检查输出「审核快照与判据一致」。
- 提交：`ae61dcc docs(a01): rebuild the review snapshots at d681465`。
- 证据：`checks/tests.txt`、`checks/run-checks-final.log`。O-4 关闭。

### 最终判定

最终代码状态修复了两个用户报告的缺陷。按 a01 完成条件，本批次判 `incomplete`。
原因：高层次复查门禁 blocking（1 条强项）、四层人工结论缺失、3 条设备用例跳过、
12 小时锁屏存活未取得。审核快照已重建。
交接见 `completion.md`。

## 改动清单

| 文件 | 改动 | 判据 | 测试锚点 |
| --- | --- | --- | --- |
| `services/VpnSessionIntent.ets` | 新增。意图文件读写。缺失或损坏读成 stopped。写失败记事件 | O-SESSION-09 | `test-vpn-session-intent.mjs::intent is the only writer that changes the desired state` |
| `services/SessionLedger.ets` | 新增。按写者分文件的账本追加、跨文件去重、上限、原因词表、最近结束文件 | O-SESSION-10/11/12、O-DIAG-02、O-SEAM-19 | `test-session-ledger.mjs` 5 条、`integration/session-ledger-seam.mjs` 1 条 |
| `services/VpnPowerPolicy.ets` | 新增。三档判定、档位文件、档位事件、卡片刷新节拍 | O-POWER-01…04 | `test-vpn-power-policy.mjs` 5 条 |
| `services/StoragePaths.ets` | 新增意图、账本、最近结束、档位路径；账本与结束文件按写者分路径 | — | 由上述用例加载 |
| `services/VpnStatusReader.ets` | 快照加 `sessionId` 与 `heartbeatMs`。新增快照跟踪 | O-SESSION-13、O-STATUS | `test-vpn-status-reader.mjs`、`test-vpn-session-controller.mjs` |
| `services/VpnReconnectSupervisor.ets` | 重写为意图驱动。不设次数上限。离线等待网络回调。持续 unknown 30 s 判掉线。冲突记系统停止 | O-RECONN-02/05/11/12/13、O-CONN-04/08/09 | `test-vpn-reconnect-supervisor.mjs` 25 条 |
| `services/VpnBackgroundTaskManager.ets` | 释放只看意图。断开但意图仍连接时保留任务。新鲜连接意图提前取得保护。前台取消立即重新武装 | O-BGTASK-02/04/06/10/13/14/15 | `test-vpn-background-task.mjs` 21 条 |
| `services/VpnSessionController.ets` | 用户连接与断开写意图与账本。恢复连接不重写意图。新增 `by` 参数。授权令牌为正向，三处检查。不确定状态的新鲜意图不重复启动 | O-SESSION-01/09/13、O-SEAM-19、O-RECONN-10 | `test-vpn-session-controller.mjs` 20 条 |
| `services/AppLifecycleEvents.ets` | 新增 `appBackground` 事件名 | O-POWER-01 | `test-vpn-power-policy.mjs` |
| `entryability/EntryAbility.ets` | 档位采样。网络回调 `netAvailable`。卡片动作带 `by` | O-POWER-01/02、O-RECONN-11 | `test-vpn-reconnect-supervisor.mjs`、E2E |
| `components/BridgeStatus.ets` | 后台停五个探测定时器。写意图与账本。跟踪 sessionId | O-POWER-01、O-SESSION-09/13 | `test-vpn-session-controller.mjs`、E2E |
| `vpnextensionability/TailscaleVpnExtensionAbility.ets` | 生成 `sessionId`。心跳带 sessionId。销毁与交接超时写账本。按档位重建定时器 | O-SESSION-10/13、O-POWER-02、O-SEAM-19 | `test-session-ledger.mjs`、`integration/power-stage-seam.mjs` |
| `scripts/lib/memory-fs.mjs` | 新增。宿主侧内存文件系统，支持 `fileIo` 的 fd 写 | — | 全部新用例 |
| `scripts/test-vpn-reconnect-supervisor.mjs` | 改写。覆盖意图、网络等待、持续 unknown、无上限、页面停止与登录等待、冲突不重试 | O-RECONN-02/05/11/12/13 | 25 条 |
| `scripts/test-vpn-background-task.mjs` | 改写。覆盖意图守卫、用户取消、迟到启动、新鲜意图提前保护、前台取消重新武装 | O-BGTASK-02/04/06/10/13/14/15 | 21 条 |
| `scripts/test-vpn-session-controller.mjs` | 增补。覆盖意图、账本、快照刷新、授权取消不写意图、恢复不重写意图、连接中不重复启动、写失败取消、恢复撤销不写意图、不确定状态的新鲜意图 | O-SESSION-01/09/13、O-RECONN-10 | 20 条 |
| `scripts/test-vpn-special-scenario.mjs` | 增补意图桩 | — | 夹具更新（文件 6 条） |
| `scripts/e2e/lib/device.mjs` | 新增 `readLedgerEntries`：读两个写者账本与旧版单文件，按时间合并并去重 | O-SEAM-19 | E2E 账本断言 |
| `scripts/integration/session-ledger-seam.mjs` | 新增。两个写者各用一文件，压缩不擦对方记录 | O-SEAM-19 | 1 条 |
| `scripts/integration/power-stage-seam.mjs` | 新增 | O-POWER-01/02 | 1 条 |
| `scripts/e2e/endurance-recovery.mjs` | 新增。设备侧扩展被杀取证。写 a01 结构化步骤日志 | O-DIAG-02 | 设备运行跳过（无信号权限） |
| `scripts/e2e/network-recovery.mjs` | 新增。设备侧断网恢复。写 a01 结构化步骤日志 | O-NET-04、O-CONN-09 | 设备运行跳过（Wi-Fi 关闭后仍在线） |
| `scripts/e2e/install-restart-recovery.mjs` | 新增。安装重启后的意图恢复 | O-CONN-08、O-DIAG-02、O-RECONN-02 | 设备运行通过 |
| `scripts/e2e/lib/steps.mjs` | 新增。a01 运行日志记录器：用例、步骤、证据、截图 | — | 报告生成器校验通过 |
| `scripts/e2e/lib/merge-steps.mjs` | 新增。合并各文件的步骤日志 | — | 报告生成器校验通过 |
| `scripts/e2e/background-reconnect.mjs` | 更新事件名与断言。前台掉线按意图恢复。写结构化步骤日志 | O-CONN-04、O-RECONN-10 | 设备运行通过（受控断开） |
| `scripts/e2e/screen-off-survival.mjs` | 心跳下限按锁屏档位与运行时长计算。写结构化步骤日志 | O-CONN-06 | 设备运行通过（720 秒） |
| `scripts/device-analyze.py` | 监视名单换成新事件名 | — | `test-device-analyzer-names.mjs` |
| `docs/diagnostics/event-names.md` | 新增 13 行。删除 11 行。235 个名字校验通过 | — | `check-diagnostic-event-names.mjs` |
