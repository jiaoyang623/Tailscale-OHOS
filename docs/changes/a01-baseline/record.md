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

## 本轮程序与人工的分工

程序判出来的（可复跑，结论与谁跑无关）：判据 31 条、形式/关系/闭环三组 0 命中、P0 为 0、
闭环率 9.7%、索引 31 条、快照 98 条目结构通过、宿主侧 73 条用例 73 通过。

**只有人能签的**（已进快照未决项）：三条走查证据是否接受、D1 是否提前收敛、
「P1 被冻结期间的掉线恢复」这个责任空洞是否接受为已知风险、Q-03 保留期不一致该改代码还是改需求。

## 下一步

接缝判据收尾并生成架构层审核网页 → HLD（接口契约 + 单点分解）→ LLD → 再进入测试与实现流程
（集成测试 → 单元测试 → 有效 Red → 开发 → 两类全绿 → E2E）。
