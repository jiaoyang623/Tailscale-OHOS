#!/usr/bin/env bash
# MeshArc 的回归入口：宿主侧用例 + 判据三组检查。
#
# 这是本仓唯一的自动化门禁。项目没有 CI（见 docs/changes/a01-baseline/record.md 的 Q1），
# 所以「跑一遍」必须是一条能记住的命令，而不是一串手敲的参数。
#
# 用法：
#   scripts/run-checks.sh              # 报告模式，总是退出 0（除用例失败）
#   scripts/run-checks.sh --strict     # 判据命中 P0 时退出 1
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

A01="${A01_SKILL_DIR:-/home/w2h/.codex/skills/a01}"
STRICT=""
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT="--strict" ;;
    # 锚点后缀与测试入口由项目声明：本仓的测试通道是宿主侧 node:test，没有 .ets 测试。
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

rc=0

echo "== 宿主侧用例 =="
if ! node --test scripts/test-*.mjs; then
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
  --entries='scripts/test-*.mjs' \
  $STRICT || rc=1

exit "$rc"
