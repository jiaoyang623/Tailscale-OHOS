#!/usr/bin/env bash
# MeshArc 的回归入口：宿主侧用例 + 判据三组检查。
#
# 这是本仓唯一的门禁，本地与 CI 都跑它（.github/workflows/checks.yml），
# 所以「跑一遍」必须是一条能记住的命令，而不是一串手敲的参数。
#
# 用法：
#   scripts/run-checks.sh              # 报告模式，总是退出 0（除用例失败）
#
# 测试通道两层：scripts/test-*.mjs 是单元层（被测类 + 桩边界），
# scripts/integration/*.mjs 是接缝层（两个真实模块经同一个桩边界交接）。
#   scripts/run-checks.sh --strict     # 判据命中 P0 时退出 1
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

# The repository carries its own copy of the checkers under scripts/a01, so a
# clean checkout and CI both work. Set A01_SKILL_DIR to use an installed skill.
A01="${A01_SKILL_DIR:-scripts/a01}"
STRICT=""
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT="--strict" ;;
    # 锚点后缀与测试入口由项目声明：本仓的测试通道是宿主侧 node:test，没有 .ets 测试。
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

rc=0

echo "== 宿主侧用例（单元 + 集成）=="
if ! node --test scripts/test-*.mjs scripts/integration/*.mjs; then
  echo "用例失败" >&2
  rc=1
fi

echo
echo "== 判据检查 =="
node "$A01/scripts/check-oracles.cjs" \
  --root=. \
  --oracles=docs/oracles \
  --requirements=docs/requirements \
  --tests=scripts \
  --anchor-exts=.mjs \
  --test-exts=.mjs \
  --entries='scripts/test-*.mjs,scripts/integration/*.mjs' \
  $STRICT || rc=1

# Two project-owned guards. Both fail the gate on drift, and both print the
# offending entries, so a red run says what to fix.
# 索引是生成物，可以静默过期：判据改了却忘了重建，检查仍会通过。
# 生成器自带 --check，它自己渲染一遍再与仓里的副本逐字节比对。
echo
echo "== 判据索引是否最新 =="
node "$A01/scripts/oracle-graph.cjs" --root=. --oracles=docs/oracles \
  --anchor-exts=.mjs --test-exts=.mjs --check || {
  echo "重建：node $A01/scripts/oracle-graph.cjs --root=. --oracles=docs/oracles --anchor-exts=.mjs --test-exts=.mjs --write" >&2
  rc=1
}

echo "== 资源键一致性（base 与 zh_CN）=="
node scripts/check-resource-parity.mjs || rc=1

echo
echo "== 诊断事件名登记表 =="
node scripts/check-diagnostic-event-names.mjs || rc=1

# 审核快照也是生成物，也会静默过期：判据改了却忘了重建，网页就显示旧内容。
# 这个守卫只比判据正文，不比 tests 的运行证据（那部分每次重建都会变）。
echo
echo "== 审核快照是否跟得上判据 =="
python3 scripts/check-review-freshness.py || {
  echo "重建：scripts/a01-review-pages.sh（工作树要干净），然后提交 docs/review" >&2
  rc=1
}

exit "$rc"
