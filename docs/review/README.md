# 人工审核网页 · 使用说明

本目录保存每一层的**人工审核快照与网页**。网页是设计文档与判据库的**投影**，
不新增需求、不新增判据、不推断测试结果；事实来源永远是
`docs/requirements/`、`docs/architecture/`、`docs/hld/`、`docs/lld/`、`docs/oracles/`。

## 生成与查看

```bash
# 1. 从事实来源重建快照（内容变了就重建，否则工具不知道文件已改）
python3 scripts/a01-review-snapshot.py --stage requirements \
  --baseline "$(git rev-parse --short HEAD)" \
  --out docs/review/requirements/snapshot.json

# 2. 检查结构（不代表判据语义完整，也不代表测试通过）
python3 /home/w2h/.codex/skills/a01/scripts/review.py \
  docs/review/requirements/snapshot.json --check

# 3. 生成网页
python3 /home/w2h/.codex/skills/a01/scripts/review.py \
  docs/review/requirements/snapshot.json \
  --output docs/review/requirements/index.html
```

用浏览器打开 `docs/review/<层>/index.html`。逐条读设计、判据、来源与未决项，
填写审查人，选择「接受 / 需修改」，写意见，然后**导出** JSON，
保存为 `docs/review/<层>/review-decisions.json`：

```bash
# 4. 回读真实导出的审核记录（未导出的网页选择不是持久证据）
python3 /home/w2h/.codex/skills/a01/scripts/review.py \
  docs/review/requirements/snapshot.json \
  --decisions docs/review/requirements/review-decisions.json \
  --require-reviewed
```

## 纪律

- **人工结论不得由自动检查代替。** 工具不会生成审查人，也不会自动接受；
  没收到结论时保留「待审核」，不自动记通过。
- **被审对象变了，旧结论就失效。** 修改上游（需求 / 父判据）会让依赖条目的结论过期，
  需要重审。新增无关条目不会让不受影响的结论过期。
- **来源要自己核。** 工具只把它当文本显示，不验证来源文件的内容与版本。
- **缺口不等于闭环。** 写了 owner 与接收批次只表示「有人接」，不表示「已经补上」。

## 各层进度

| 层 | 快照 | 网页 | 人工结论 |
| --- | --- | --- | --- |
| 需求 | `requirements/snapshot.json` | `requirements/index.html` | 待审核 |
| 架构 | 待生成 | 待生成 | 待审核 |
| HLD | 待生成 | 待生成 | 待审核 |
| LLD | 待生成 | 待生成 | 待审核 |
