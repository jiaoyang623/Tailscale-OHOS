# a01 判据检查器副本

本目录保存 a01 判据检查器的副本。
项目运行这个副本。
CI 从这里读检查器，不需要作者的本地技能目录。

## 文件清单

复制日期：2026-10-13。

| 文件 | 来源 | sha256 |
| --- | --- | --- |
| `scripts/a01/scripts/check-oracles.cjs` | `/home/w2h/.codex/skills/a01/scripts/check-oracles.cjs` | `0979bb4dd47b3cb40d93b2308bc026506a72d4e311465899bbf6d5ba740b57d0` |
| `scripts/a01/scripts/check-oracle-format.cjs` | `/home/w2h/.codex/skills/a01/scripts/check-oracle-format.cjs` | `01421dfd227952fdb9ec678d84849049482e7d4fb7470691d076a32237486d09` |
| `scripts/a01/scripts/check-oracle-closure.cjs` | `/home/w2h/.codex/skills/a01/scripts/check-oracle-closure.cjs` | `2aa367d00d0b6f070b2b8fa905a02bc1e400236eaa91d57a21cb652e513e6ffd` |
| `scripts/a01/scripts/oracle-graph.cjs` | `/home/w2h/.codex/skills/a01/scripts/oracle-graph.cjs` | `77e43673b1dfaa056fd5e5fd0c23e1ff212abeb50e7d2cca9e09d9599cc3a8a0` |
| `scripts/a01/references/templates.md` | `/home/w2h/.codex/skills/a01/references/templates.md` | `8019c5c07b85226396d30bf1504287c4c660a59c5e30c5a07bbd34d974fb37c7` |

四个 `.cjs` 文件逐字节复制。
`templates.md` 同样是逐字节复制。

## 目录布局

- 环境变量 `A01_SKILL_DIR` 指向 `scripts/a01`。
- `scripts/run-checks.sh` 从 `$A01/scripts/` 读检查器。
  所以四个检查器放在 `scripts/a01/scripts/`。
- `scripts/a01/` 下的四个 `.cjs` 是指向 `scripts/a01/scripts/` 同名文件的符号链接。
  两条路径都能跑检查器。
- `check-oracles.cjs --self-test` 从检查器目录的上一级读 `references/templates.md`。
  所以模板放在 `scripts/a01/references/templates.md`。

## 为什么需要模板文件

`node scripts/a01/check-oracles.cjs --self-test` 做两件事：

1. 跑三个检查器的自测。
2. 检查 `references/templates.md` 里的判据实例。

少了 `templates.md`，第二步失败。
所以副本包含五个文件，不是四个。

## 维护规则

- 上游技能改动后，把改动的文件重新复制到这里。
- 重新计算 sha256。
- 更新上面的文件清单。
- 只改这里或只改上游都会造成两处不一致。

## 审核链的生成器

`scripts/review.py` 与 `assets/review.html` 同样来自 `/home/w2h/.codex/skills/a01/`，
复制日期 `2026-10-13`。`scripts/a01-review-pages.sh` 默认用仓内副本生成四份审核页与快照，
所以干净检出也能重建审核产物。`review.py` 按 `__file__` 找 `../assets/review.html`，
两个文件必须一起复制，位置不能分开。
