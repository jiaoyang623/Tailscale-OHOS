# 完成判定与交接 · vpn-endurance

> verdict: incomplete

本文件是 C-02 的未签署草稿。它不是人工结论，也不代替 C-02 的签署。
结论按 `references/testing.md` 的完成证据表逐条核对。

## 结论

**未达到开发完成。** 两个用户报告的问题已修复。宿主侧 172 条用例全部通过。
最终 HAP 已在设备上运行：6 条通过，4 条跳过，0 失败。跳过不算通过。
下列条件仍不满足，批次不得作为下一批次的已完成基线。

## 条件逐条核对

| 条件 | 结果 | 证据或缺口 |
| --- | --- | --- |
| 四层设计与判据对应 | 满足 | 需求、架构、HLD、LLD 与判据已同步，P0 为 0 |
| 四层人工审核已通过 | 不满足 | 四层门禁均缺人工结论，见 O-1 |
| 集成与单元全绿 | 满足 | 172/172 通过，见 `checks/tests.txt` |
| E2E 全绿 | 不满足 | 设备通过 6 条，跳过 4 条。跳过原因见 O-2 |
| E2E 报告与发布链接 | 满足 | 见 `checks/e2e-published.txt`，HTTP 200 |
| 报告基线等于最终代码 | 满足 | 报告为 HAP 35928034，基线 `ec64476` |
| UI 还原核对 | 不适用 | 见 `checks/ui-restoration.json` 的结构性理由，待人工复审 |
| 高层次复查门禁 | 不满足 | blocking，1 条强漏项未处置，见 `checks/high-level-review-gate.json` |
| 12 小时锁屏存活 | 不满足 | 两次尝试均不成立。第一次在 9 小时 42 分时被用户停止。第二次被另一会话占用的设备打断，见 O-3 |
| 审核快照与判据一致 | 不满足 | 快照过期，需干净工作树，见 O-4 |

## 已交付并验证的部分

- 断连原因落盘：会话账本、意图文件、最近结束文件，235 个诊断事件名校验通过。
  账本改为每个写者一个文件，压缩不再重写对方文件；宿主用例与集成用例钉住该行为。
- 非用户断连恢复：意图驱动、无次数上限、退避 30/60/120/300 秒、离线延迟、稳定 60 秒记恢复。
- 网络变化：`netAvailable` 回调接入恢复决策。
- 省电：三档，后台降频、熄屏再降。扩展命令、状态与快照环按档位取间隔。
  界面停七个探测定时器。卡片刷新按档位放慢。
- 真机（最终 HAP 35928034，新设备 2LQGK24828000076 / ALN-AL00 / API 26）：
  安装重启恢复通过。720 秒锁屏静默通过，心跳 221 个，跨度 740 秒，最大间隔 6.9 秒。
  前台受控断开记为用户停止且不重连。

## 缺口与接收批次

| ID | 缺口 | 处置 | owner | 接收批次 |
| --- | --- | --- | --- | --- |
| O-1 | 四层人工审核结论 | 审查者从决策页导出 `a01-review-decisions/2` | 项目维护者 | vpn-endurance-r2 |
| O-2 | 设备侧 4 条用例跳过 | 补主机通道：扩展被杀、断网、后台掉线、卡片点击 | 项目维护者 | vpn-endurance-r2 |
| O-3 | 12 小时锁屏存活 | 两次尝试均不成立。第一次 9 小时 42 分时被用户停止，心跳 9,294 个，最大间隔 6.9 秒。第二次 5 小时 06 分后作废：另一会话在同一设备跑门禁，屏幕多次点亮，锁屏条件不成立。需要一次独占设备、全程无人操作的 12 小时运行 | 项目维护者 | vpn-endurance-r2 |
| O-4 | 审核快照过期 | 工作树干净或新提交后重建 | 项目维护者 | vpn-endurance-r2 |
| O-5 | 高层次复查 1 条强漏项 | P1 冻结或死亡时无人恢复；需平台恢复入口或人工接受残余风险 | 项目维护者 | vpn-endurance-r2 |

## 下一批次开工必读

- `checks/high-level-review.json` 中 `severity=strong` 且 `disposition=open` 的 1 条条目。
- 本文件上表的 O-1 到 O-5。
- 设备解锁方法：指纹或锁屏密码。`power-shell`、`uitest` 与 `uinput` 都不能绕过安全锁屏。
  每条 `screen-off-survival` 结束后设备会再次锁屏。
- 与本批次改动面相交的旧缺口：O-SEAM-11 责任空洞、LLD §1.4 的两项真机缺口。

## E2E 重跑命令

```bash
# 1. 人工解锁设备后，确认应用能启动。
hdc -t 2LQGK24828000076 shell aa start -a EntryAbility -b ren.w2h.mesharc

# 2. 重跑设备批次。
cd /opt/git/github/mesharc
sudo -n -u w2h env HOME=/home/w2h DEVECO_CLI_CLT_PATH=/opt/harmony/sdk \
  HVIGOR_USER_HOME=/opt/git/github/mesharc/.hvigor-user \
  PATH=/opt/harmony/sdk/sdk/default/openharmony/toolchains:/usr/local/bin:/usr/bin:/bin \
  DEVICE=2LQGK24828000076 bash scripts/e2e/run-batch.sh \
  install-restart-recovery endurance-recovery network-recovery \
  background-reconnect screen-off-survival

# 3. 合并日志，校验，生成报告，发布。
node scripts/e2e/lib/merge-steps.mjs
python3 /home/red/.claude/skills/a01/scripts/e2e-report.py \
  docs/changes/vpn-endurance/checks/e2e-steps.json --check
python3 /home/red/.claude/skills/a01/scripts/e2e-report.py \
  docs/changes/vpn-endurance/checks/e2e-steps.json \
  --output docs/changes/vpn-endurance/checks/e2e/index.html
python3 /home/red/.claude/skills/a01/scripts/e2e-publish.py \
  docs/changes/vpn-endurance/checks/e2e --project mesharc --change-id vpn-endurance \
  --record docs/changes/vpn-endurance/checks/e2e-published.txt
```

批次最后一条 `screen-off-survival` 会再次锁屏。跑完后需要人工解锁一次。

## 如何关闭剩余门禁

| 门禁 | 动作 |
| --- | --- |
| O-1 四层人工结论 | 打开 `docs/review/requirements/index.html`、`architecture/index.html`、`hld/index.html`、`lld/index.html`，逐层审查并从页面导出 `a01-review-decisions/2` 记录 |
| O-2 四条跳过 | 补主机通道：只结束扩展进程、造出无网状态、后台非主动掉线、卡片点击 |
| O-3 12 小时存活 | 解锁并连接后运行 `SURVIVAL_MS=43200000 node --test scripts/e2e/screen-off-survival.mjs`。运行期间不要解锁、不要点通知里的停止 |
| O-4 审核快照 | 提交当前工作树，然后在干净树上运行 `scripts/a01-review-pages.sh` |
| O-5 强漏项 | 为 P2 增加启动连接的恢复入口，或在 `checks/high-level-review.json` 中签字接受残余风险 |

四项人工结论与强漏项接受都不能由自动检查代替。未签字时门禁保持阻塞。

## 人工签署

| 项 | 结论 | 签字人 | 日期 |
| --- | --- | --- | --- |
| C-02 完成判定 | 未签署 | — | — |
| 高层次复查弱项接受 | 未签署 | — | — |
| UI 还原不适用理由 | 待复审 | — | — |