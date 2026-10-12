#!/usr/bin/env bash
# 重建四层审核快照与网页。
#
# 顺序是有意的：先跑门禁，再用**这一次真实运行的结果**生成快照。没有该基线上的绿色运行，
# 就不写 pass——所以门禁不过时这个脚本不生成任何东西，而不是生成一份带旧证据的快照。
#
# 用法：
#   scripts/a01-review-pages.sh                  # 基线 = 当前 HEAD
#   scripts/a01-review-pages.sh --baseline <sha> # 指定基线号
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
A01="${A01_SKILL_DIR:-/home/w2h/.codex/skills/a01}"

BASELINE="$(git rev-parse --short HEAD)"
while [ $# -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

# 工作树不干净时，基线号指的不是正在生成的这份代码。先提交，再生成。
if [ -n "$(git status --porcelain -- entry scripts docs)" ]; then
  echo "entry/ scripts/ docs/ 下有未提交改动，基线号会失真；先提交再生成。" >&2
  git status --short -- entry scripts docs >&2
  exit 2
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
echo "== 门禁（基线 $BASELINE）=="
if ! scripts/run-checks.sh >"$OUT" 2>&1; then
  cat "$OUT" >&2
  echo "门禁未通过：不生成快照——没有该基线上的绿色运行就不写 pass。" >&2
  exit 1
fi
grep -E '^# (tests|pass|fail|skipped)' "$OUT"

TESTS="$(grep -m1 '^# tests ' "$OUT" | awk '{print $3}')"
PASS="$(grep -m1 '^# pass ' "$OUT" | awk '{print $3}')"
FAIL="$(grep -m1 '^# fail ' "$OUT" | awk '{print $3}')"
RAN_AT="$(date -Iseconds)"
RAN_ENV="Linux, Node $(node -v); ${TESTS} tests, pass ${PASS}, fail ${FAIL}"

echo
echo "== 四层快照与网页 =="
for layer in requirements architecture hld lld; do
  python3 scripts/a01-review-snapshot.py \
    --stage "$layer" --baseline "$BASELINE" \
    --out "docs/review/$layer/snapshot.json" \
    --ran-baseline "$BASELINE" --ran-command scripts/run-checks.sh \
    --ran-environment "$RAN_ENV" --ran-at "$RAN_AT"
  # --check 与 --output 一起用：结构不通过时不写出网页，也不把失败藏起来。
  python3 "$A01/scripts/review.py" "docs/review/$layer/snapshot.json" \
    --check --output "docs/review/$layer/index.html" || exit 2
done

echo
echo "基线 $BASELINE · 运行时刻 $RAN_AT"
echo "生成物已改动，核对后提交：git status --short docs/review"
