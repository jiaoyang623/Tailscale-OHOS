# 本次增量 · a01 开发体系基线

- 流程版本：a01（ai-native-coding 第 01 版）
- 代码基线：`7ecf03f`（分支 `local-build`），工作树干净（本轮新增设计/判据/工具文件后另计），
  Node `v22.23.2`，Linux。真机：Pura X / `56T0225330000021` / HarmonyOS 7.0.0.105
- 目标：为 MeshArc 建立设计链、判据链、审核链三条链的完整基线，并把每条流程实际跑通
- 非目标：本次不实现新功能、不改动产品行为；不代替人工签字；不发布

## 本次范围

MeshArc 此前**没有**需求、架构、HLD、LLD 四层设计，**没有**判据库，**没有**审核网页，
**没有** CI；唯一的验证通道是 73 条宿主侧 `node --test scripts/test-*.mjs` 用例，
以及 8 个需要 Windows + 真机的 `scripts/device-*-probe.ps1` 探针。

本次把三条链从零建立起来，覆盖**整个应用**：需求与架构覆盖全部用户旅程与子系统边界，
HLD/LLD 逐子系统迭代补齐。已有事实来源（README、CONTRIBUTING、STATUS.md、docs/*.md、
73 条测试、真机实测数值）一律复用，不重写。

## 项目约定（让检查器知道）

a01 的判据锚点默认只认 ArkTS 的 `路径.ets::describe名#用例名`，闭环检查也只沿 `.ets` 与
`List.test.ets` 走可达闭包。MeshArc 没有任何 `.ets` 测试，唯一的测试通道是宿主侧
`node:test`。经确认，扩展检查器令其接受本项目声明的一套约定（默认行为不变，
`check-oracles.cjs --self-test` 全绿）：

| 约定 | 取值 | 说明 |
| --- | --- | --- |
| 锚点后缀 | `.mjs` | 锚点写成 `scripts/test-<名>.mjs::<用例名>`（`node:test` 平铺用例，没有 describe 层） |
| 测试文件后缀 | `.mjs` | 用例名从 `test('…')` 提取，只认行首，避免把 `if (/x/.test('y'))` 当用例 |
| 测试入口 | `scripts/test-*.mjs` | 通配入口，每个命中的文件本身是一个入口，对应 `node --test scripts/test-*.mjs` |
| 真机走查锚点 | `真机走查 a01-baseline/manual-checks.md#M-nn` | 登记册见 [manual-checks.md](manual-checks.md) |

改动落在 `/home/w2h/.codex/skills/a01/scripts/` 的三个检查器（`check-oracle-format.cjs`、
`check-oracle-closure.cjs`、`oracle-graph.cjs`）与转发参数的 `check-oracles.cjs`：
新增 `--anchor-exts`、`--test-exts`，`--entries` 支持通配；默认值仍是 `.ets`，
对既有 ArkTS 项目行为不变。判据规则本身（分层、字段、受控词表、闭环定义）未改动。

**唯一回归入口**（项目没有 CI，见 Q1）：

```bash
scripts/run-checks.sh            # 宿主侧 73 条用例 + 判据三组检查
scripts/run-checks.sh --strict   # 判据命中 P0 时退出 1
```

## 路径映射

| 内容 | 路径 |
| --- | --- |
| 流程记录 | `docs/changes/a01-baseline/record.md` |
| 真机走查登记册 | `docs/changes/a01-baseline/manual-checks.md` |
| 需求 / 架构 / HLD / LLD | `docs/requirements/`、`docs/architecture/`、`docs/hld/`、`docs/lld/` |
| 旅程判据 | `docs/oracles/90-journeys/` |
| 接缝判据 | `docs/oracles/91-seams/` |
| 单点判据 | `docs/oracles/points/` |
| 索引（生成物，不手改） | `docs/oracles/_ref-index.md` |
| 审核快照与网页 | `docs/review/<层>/snapshot.json`、`index.html`、`review-decisions.json` |

## 层进度

| 层 | 设计增量 | 判据增量 | 审核网页 | 人工结论 |
| --- | --- | --- | --- | --- |
| 需求 | `docs/requirements/requirements.md`（67 条） | `docs/oracles/90-journeys/` 31 条 | `docs/review/requirements/index.html` | 待审核 |
| 架构 | `docs/architecture/architecture.md` | `docs/oracles/91-seams/` 17 条 | `docs/review/architecture/index.html` | 待审核 |
| HLD | `docs/hld/hld.md`（17 张契约卡） | 无新增（单点补契约引用） | `docs/review/hld/index.html` | 待审核 |
| LLD | 待补 | `docs/oracles/points/` 69 条（已建，待 LLD 复核归属） | 随 LLD 层生成 | 待审核 |

判据库总计 **117 条**（31 旅程 + 17 接缝 + 69 单点），闭环 73 条（62.4%），三组检查 0 命中、0 P0。

## 需求状态位口径

需求表末列**只写验证状态**（闭环检查读这一列），实现情况写在前一列 `实现状态`。
原因：本仓是存量项目，功能已经上线，但绝大多数旅程还没有 E2E 判据。若把「已实现」写进末列，
检查器会把「需求说已实现、判据说没做完」判成 S7 冲突，而那句「已实现」说的其实是产品现状，
不是本流程的完成定义。两列分开写，既不隐藏现状，也不伪造冲突。

## 迭代记录

### 第 1 轮 · 需求层（完成待审）

| 项 | 结果 |
| --- | --- |
| 设计增量 | `docs/requirements/requirements.md`：67 条需求、6 个场景小节、8 项质量目标、5 个未决项 |
| 判据增量 | `docs/oracles/90-journeys/` 10 个文件、31 条旅程判据 |
| 索引 | `docs/oracles/_ref-index.md`（31 条，664 条共用承载件关系） |
| 审核网页 | `docs/review/requirements/index.html`（98 个条目：67 设计 + 31 判据） |
| 人工结论 | **待审核**（`review-decisions.json` 未生成） |

闭环检查（`check-oracles.cjs`，`--anchor-exts=.mjs --test-exts=.mjs --entries='scripts/test-*.mjs'`）：

```
① 形式  ✅ 无命中
② 关系  ✅ 无命中
③ 闭环  ✅ 无命中
进度：判据 31 条 · 状态 closed 3（闭环率 9.7%）
P0 合计 0 条 ✅
```

- 3 条 `closed` 靠**真机走查**锚点：O-CONN-06（M-01、M-02）、O-NET-03（M-03、M-04）、
  O-MEDIA-01（M-09）。走查证据是**转抄**仓库既有实测记录，本批未复跑，已在登记册与
  快照未决项里写明。
- 其余 28 条是 `pending-test`，全部写了 `owner=项目维护者 接收批次=a01-E2E`。
  这是流程规定的状态：E2E 在实现阶段的最后才写。
- 本层**没有在本基线上执行过任何旅程级测试**。本基线实际执行过的是宿主侧单元套件
  （`node --test scripts/test-*.mjs`，73 通过 / 0 失败 / 0 跳过），它守的是单点层，单点层尚未建立。
  因此快照里 31 条测试全部是 `not_evaluated`——没有拿旧基线的结果冒充本基线。

### 第 2 轮 · 架构层（完成待审）

| 项 | 结果 |
| --- | --- |
| 设计增量 | `docs/architecture/architecture.md`：3 个视图、6 个关键决策（D1–D6，各含失效条件）、24 行旅程→接缝映射、17 条接缝、8 个未决项 |
| 判据增量 | `docs/oracles/91-seams/` 5 个文件、17 条接缝判据 |
| 审核网页 | `docs/review/architecture/index.html`（122 个条目：74 设计 + 48 判据） |
| 人工结论 | **待审核** |

要点：

- 架构文档第五节用的是临时编号 `SEAM-01…12`，与判据库的稳定 `O-SEAM-01…17` 不一致；
  已在文档第七节补「接缝编号对照」，并把**判据库的编号定为唯一编号来源**。拆成 17 条而不是 12 条的理由：
  原文把「浏览器拉起 / 深链 / 网络回调 / 系统认证」合称 SEAM-12，但这四条的系统对端、超时语义与
  失败责任方都不一样，而「失败归谁」正是接缝判据的主要内容。
- 确认了**唯一一处责任空洞**：扩展进程死掉 ⇒ 断线 ⇒ 恢复责任在 UI 进程，而 UI 进程正是
  没有长时任务时会被冻结的那个（架构 D4 的失效条件）。这条写在 O-SEAM-11 的期望里。
- 2 条接缝靠真机走查闭环：O-SEAM-11（M-01/M-02）、O-SEAM-12（M-03/M-04）。
  **M-05 被有意排除**：登记册把它记为一个失败的握手样本，不能当通过证据用。

### 第 3 轮 · 单点判据（完成待审）

| 项 | 结果 |
| --- | --- |
| 判据增量 | `docs/oracles/points/` 4 个文件、41 条单点判据（O-BGTASK/O-STATUS/O-SESSION/O-PEER/O-LOCALSEND/O-BUILD） |
| 索引 | `docs/oracles/_ref-index.md` 重建为 98 条 |
| 审核网页 | 随 LLD 层生成（校验器要求单点判据引用的设计条目属于 hld/lld 层） |

**这一步是三条链第一次真正连上项目自己的测试。** 仓里 68 个字面用例名，51 个已被判据锚定，
闭环检查逐个核对了「点名的用例名在点名的文件里逐字存在」。剩下 17 个在 `P2` 里，一并补齐。

**流程顺序偏差（如实记录）**：按 a01，单点判据应在 HLD 细化接缝时产生、由 LLD 补齐；
本批先写了单点判据、HLD 设计文档随后。理由是存量项目的单点行为**已经实现且有测试**，
可以直接用真实用例名锚定；HLD 契约文档是另一份产物，落地后要**复核这些判据归属的接缝对不对**。
这条偏差不改判据状态（该 closed 的仍是 closed，因为锚点是真的），但 HLD 层收尾时要回查。

两条判据是真的没闭环，如实标了 `pending-test`：

- `O-PEER-11` —— `test-peer-reconnect.mjs` 的 5 个用例名由运行时循环生成（模板字符串），
  静态文本里找不到字面名，锚上去会被判 S3。缺口有主。
- `O-SESSION-07` —— 交接应答循环的预算（`VpnSessionController.ets` 250 ms × 60）与扩展的等待
  （`TailscaleVpnExtensionAbility.ets` 100 ms × 150）**只是恰好相等，没有任何东西把它们绑在一起**，
  任一侧单独调整就会静默失去应答。这是一个真实的脆弱点，不是形式缺口。

**已知未决（留给审核人）**：7 条构建判据（`O-BUILD-*`）暂时挂在 `O-SEAM-05`，并标
`UNCERTAIN-WIRING`。本批 17 条接缝里没有「构建与产物装配」这一条——构建不是两个**运行时**模块
之间的边界，所以没有为了凑数造一条假接缝。要不要为它单立一条，由审核人定。

### 第 4 轮 · HLD 层（完成待审）

| 项 | 结果 |
| --- | --- |
| 设计增量 | `docs/hld/hld.md`：17 张契约卡（C-01…C-17，对应 17 条接缝）、端到端交易（正常/边界/失败恢复）、数据与持久化、装配与验证边界、SWE BOK 六项逐项核对 |
| 判据增量 | 无新增；单点判据补上它所属接缝的契约卡引用（机械对应 O-SEAM-K → C-K） |
| 审核网页 | `docs/review/hld/index.html`（208 个条目：91 设计 + 117 判据） |
| 人工结论 | **待审核** |

### 第 6 轮 · LLD 层（完成待审）

| 项 | 结果 |
| --- | --- |
| 设计增量 | `docs/lld/lld.md`：4 台状态机共 43 条转换、34 条**非法组合**、算法边界、责任分配、判据→测试计划表（覆盖全部 69 条单点判据）、旅程复核 |
| 判据增量 | 无新增 |
| 审核网页 | `docs/review/lld/index.html`（214 个条目：97 设计 + 117 判据，其中 69 条测试带本次运行证据） |
| 人工结论 | **待审核** |

LLD 推导非法组合时又挖出三条真缺陷，逐条记进未决项 Q13–Q15（见下表）。另有两条接缝归属
问题（Q16）：`O-RECONN-01…09` 的父接缝在架构、HLD、单点三处有三种不同说法；
`O-BUILD-*` 的父接缝是自知占位的临时值。

### 审核链自己抓到的第一个错误

**我在接缝规范里把 M-05 列进了「可用走查」，这是错的。** M-05 在登记册里被记为
*失败的握手样本*，它的实测结果是 `vpn_backend_handoff_timeout`。写接缝判据的其中一个
subagent 按我的错误指引，把 O-SEAM-01、O-SEAM-02 判成了 `closed`；另一个 subagent 则
独立判断「M-05 不能当通过证据」，并把这个判断写进了它的报告。

我在验收时按判据逐条查锚点，发现这两条的通过证据是一条失败记录，遂改正：

- O-SEAM-01、O-SEAM-02 降为 `pending-test`，`不确定特征` 改 `NOT-EVALUATED`，
  写 `owner=项目维护者 接收批次=a01-集成`，锚点换成计划中的集成测试；
- 接缝规范里的 M-05 指引同步改正，避免下一批再犯。

闭环率因此从 75/117（64.1%）**降到 73/117（62.4%）**——这个下降是对的：它把两条被高估的
判据退回到真实状态。这条也说明程序检查（F/G/S 全绿）**不足以**发现「锚点合法但证据方向相反」，
必须有人读期望与登记册对照。

### 第 5 轮 · 测试与实现流程（试跑一条接缝）

按 a01 的测试顺序（集成测试 → 单元测试 → 有效 Red → 开发 → 两类全绿 → E2E），
先挑一条接缝把整条链走通一遍，证明这条流程在本仓真的能跑，而不是只写在文档里。

**选的是 O-SEAM-15（诊断：记录、脱敏与报告导出）**，因为它的两个模块
（`DiagnosticEventStore` 写盘、`DiagnosticPrivacy` 脱敏边界）都是纯逻辑，
唯一的平台面是 `fileIo`，可以在宿主侧用内存文件系统真跑。

| 步 | 做了什么 | 结果 |
| --- | --- | --- |
| 1 集成测试 | 按判据里已经写好的计划名，建 `scripts/integration/diagnostic-redaction.mjs::两进程落盘文本共用脱敏边界且超限淘汰最旧` | 用例名逐字对上判据的 `待建测试` |
| 2 装配 | 在一个 sandbox 里按生产顺序装配**两个真实模块**（脱敏边界先定义，事件存储的模块级常量才取得到它）；桩只有 `fileIo` | 不是假件：断言的是真实代码写出的落盘文本 |
| 3 断言 | 日志文本脱敏（URL / bearer / 令牌键值）；两进程各写各的文件但共用同一条边界；把秘密塞进事件名后磁盘上不得出现原文；每文件上限 100 条、超出丢最旧 | 4 组断言全过 |
| 4 有效 Red | 首跑因为相对路径少了一层而失败（`scripts/entry/...`），这是夹具错误**不是**有效 Red，修路径后重跑 | 区分了「夹具坏」和「行为缺」 |
| 5 转绿 | `node --test scripts/integration/diagnostic-redaction.mjs` → 1 通过 | — |
| 6 回填判据 | `O-SEAM-15` 从 `pending-test` 转 `closed`，锚点从 `待建测试` 移进 `测试`，`归属` 清空 | 闭环 73 → 74 |
| 7 进门禁 | `scripts/run-checks.sh` 现在同时跑两层：`scripts/test-*.mjs`（单元）+ `scripts/integration/*.mjs`（接缝），入口参数同步加上集成目录 | 74 通过 / 0 失败 |

这一步同时**首次证明**了一件事：本仓的判据可以走完整条「计划 → 建测试 → 跑 → 闭环」的路，
而不只是停在 `pending-test`。剩下的接缝按同样方式补，缺口已在各条判据的 `归属` 里写明批次。

## 闭环检查记录

每条命令、时刻、基线与信号条数都记在这里；程序出证据，人签结论。

| 轮次 | 时刻（+11:00） | 基线 | 命令 | 判据 | closed | F/G/S 命中 | P0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求层收尾 | 2026-10-12T17:5x | `7ecf03f` | `check-oracles.cjs --oracles=docs/oracles --tests=scripts --anchor-exts=.mjs --test-exts=.mjs --entries='scripts/test-*.mjs'` | 31 | 3 | 0 / 0 / 0 | 0 |
| 接缝判据补齐 | 2026-10-12T18:0x | 工作树 | 同上 | 98 | 57 | 0 / 0 / 0 | 0 |
| 单点判据补齐 | 2026-10-12T18:1x | `f742597` | 同上 | 117 | 75 | 0 / 0 / 0 | 0 |
| **M-05 过度声明改正后** | 2026-10-12T18:1x | `41282d6`+ | 同上 | 117 | 73 | 0 / 0 / 0 | 0 |
| 集成测试试跑后 | 2026-10-12T18:14 | 工作树 | `--entries='scripts/test-*.mjs,scripts/integration/*.mjs'` | 117 | 74 | 0 / 0 / 0 | 0 |
| **四层收尾（当前）** | 2026-10-12T18:18 | **`cc7ab88`** | `scripts/run-checks.sh`（同一命令内含判据三组检查） | 117 | **76** | 0 / 0 / 0 | 0 |

四层收尾这次是**在提交后的基线上跑的**：先提交（`cc7ab88`），再在该基线上跑
`scripts/run-checks.sh`（**76 通过 / 0 失败 / 0 跳过** = 73 单元 + 3 集成），
然后用同一个基线号重新生成四份审核快照。快照里 69 条测试因此带 `pass` 与运行证据
（命令、环境、时刻、基线）；其余保持 `not_evaluated`——**没有该基线上的运行记录就不写通过**。

当前分布：旅程 31 / 接缝 17 / 单点 69；状态 `closed` 74、`pending-test` 43。
三组检查（形式 F1–F14、关系 G1–G5、闭环 S1–S7）**全部 0 命中，P0 为 0**，索引 `--check` 为最新。

审核链的**回读**路径也验过一次（负向）：对三份快照跑
`review.py <snapshot> --require-reviewed`，三份都返回**退出码 1**（未通过人工审核）——
工具拒绝在没有真实人工接受记录的情况下宣称完成。**本次没有生成任何 `review-decisions.json`**：
那必须由真实审查人导出。

## 未决项

| # | 问题 | 阻塞范围 | 谁确认 | 何时阻塞 |
| --- | --- | --- | --- | --- |
| Q1 | 73 条用例没有 CI 门禁（无 `.github/`、无任何流水线）；「可达」目前只等于「可判定」 | 全部判据的闭环强度（L4） | 用户 | 声称开发完成之前 |
| Q2 | 8 个 `device-*-probe.ps1` 需 Windows + 真机，本机无法执行 | 真机判据只能锚走查登记册 | 用户 | 判据要标 `closed` 时 |
| Q3 | `test-peer-reconnect.mjs` 有 5 个用例名由运行时循环生成（模板字符串），静态文本无字面名 | 锚到这 5 条的判据会被判 S3 | 用户 | 对应判据要闭环时 |
| Q4 | LocalSend 外部拉起的 bundle/Want 契约未定；代码里硬编码 `cn.biandangroup.bcshare` | R-XFER-09、O-XFER-03、O-SEAM-13 | 用户 | 该旅程要闭环时 |
| Q5 | 设计文档与代码不一致（`docs/harmonyos-ui-design-system.md` 写 2 页签，实际 4 页签等） | 设计依据的来源可信度 | 用户 | 引用来源时 |
| Q6 | 「启动到可用」无目标值、无测量方法 | 需求质量目标表 | 用户 | 需求层通过前 |
| Q7 | 卡片、Taildrive 真机共享节点、special-scenario 三条路径从未真机验证 | 相应旅程与决策 | 用户 | 相应判据要闭环时 |
| Q8 | 架构 Q-01：平台把两个进程里加载的同一份 `.so` 视为一个运行时还是两个，**未验证**，且验证结果会反转架构决策 D3 | D3、O-SEAM-02、O-SEAM-05/06 | 用户（真机） | HLD 写接口契约之前 |
| Q9 | **同一个状态文件有两套新鲜度窗口**：`BridgeStatus` 用 5000 ms，`VpnBackgroundTaskManager` 与 `VpnStatusReader` 用 15000 ms。同一份 `vpn-probe-status.txt`，两处判定不一致 | O-SEAM-03、O-CONN-06、O-DEV-01 | 用户 | 接缝判据要定「新鲜」的口径时 |
| Q10 | **两套读状态词汇表不一致**：`vpn interface established` 在 `VpnBackgroundTaskManager` 里是新增的 `connecting` 态，在 `VpnStatusReader` 里仍返回 `unknown`。架构 §2.3 声称「同一个共享词汇表」，这句话与代码不符 | 架构 §2.3、O-SEAM-03、卡片显示 | 用户 | 架构层通过前要改正或改代码 |
| Q11 | **`vpn-connect-config.json` 有两个写方**：应用进程的 `stageConnectConfig` 与扩展断线后的快速重连 `stageVpnReconnectConfig`；架构「每类文件只有一个写方」的说法对这个文件不成立。该文件还是一次性的（读完即 unlink） | 架构 §2.4 数据归属、O-SEAM-01 | 用户 | 架构层通过前要改正 |
| Q13 | **同一个状态文件的两套读法优先级相反**：`VpnBackgroundTaskManager` 先判 disconnected 再判 connected（`:354`/`:358`），`VpnStatusReader` 先判 connected 再判 disconnected（`:49`/`:56`）。一行同时含 `state=Running\|tun=true` 与 `stopped` 标记时，两个读者给出**相反**的状态且没有护栏 | O-SEAM-03、O-SEAM-04、卡片与应用状态一致性 | 用户 | 两条接缝定「同一份状态只有一个判读」时 |
| Q14 | **`VpnCommandStateMachine.invalidateLifecycle()` 不重置 `state`**，销毁后 `currentState()` 仍返回陈旧值 | O-SEAM-01、O-SEAM-10 | 用户 | 该接缝要闭环时 |
| Q15 | **重连的 `connect()` 是发射即忘**（`VpnReconnectSupervisor.ets:129`，没有取消句柄），用户主动断开无法中止在途重连，最坏窗口约 20 s | O-SEAM-11、O-CONN-06（用户主动断开不被撤销） | 用户 | 该判据要闭环时 |
| Q16 | **接缝归属有三种说法**：`O-RECONN-01…09` 的父接缝，架构说 `O-SEAM-03 + O-SEAM-01`、HLD §3.3 说 `O-SEAM-11/03/01/02`、判据写的是 `O-SEAM-10`；另 `O-BUILD-*` 挂的 `O-SEAM-05` 是自知占位的临时值（上面「构建接缝要不要单立」那条） | 16 条判据的父子关系 | 用户 | 相应层通过前 |
| Q12 | 两条真缺口（不是形式缺口）：`O-PEER-11`（`test-peer-reconnect.mjs` 的 5 个用例名运行时生成，静态无字面名）与 `O-SESSION-07`（交接应答预算 250 ms×60 与扩展等待 100 ms×150 只是恰好相等，无任何耦合）；另有 `O-RECONN-09`（稳定 60 s 才清零重试计数）**有实现无测试** | O-SEAM-02、O-SEAM-03 | 用户 | 相应判据要闭环时 |

## 本轮程序与人工的分工

程序判出来的（可复跑，结论与谁跑无关）：判据 31 条、形式/关系/闭环三组 0 命中、P0 为 0、
闭环率 9.7%、索引 31 条、快照 98 条目结构通过、宿主侧 73 条用例 73 通过。

**只有人能签的**（已进快照未决项）：三条走查证据是否接受、D1 是否提前收敛、
「P1 被冻结期间的掉线恢复」这个责任空洞是否接受为已知风险、Q-03 保留期不一致该改代码还是改需求。

## 下一步

1. **LLD**：状态转换表（保活任务生命周期、指令状态机、重连监督器、状态判定优先级）、算法边界、
   判据→设计→计划测试对照表；同时**回查**第 3 轮 69 条单点判据归属的接缝与契约对不对
   （第 3 轮是逆序写的，见该轮记录）。
2. **测试与实现流程**：先写集成测试（`scripts/integration/` 下 7 个计划文件，见 HLD §5.3）→
   单元测试补齐两条缺口（`O-PEER-11`、`O-SESSION-07`）与一条有实现无测试的（`O-RECONN-09`）→
   确认有效 Red → 实现 → 两类全绿 → 最后写旅程 E2E（31 条计划用例）。
3. **人工审核**：三份网页（需求 / 架构 / HLD）逐条填结论导出 `review-decisions.json`。
   本轮不代签。
