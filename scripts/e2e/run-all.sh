#!/usr/bin/env bash
# E2E 层的统一入口。
#
# E2E 驱动真机，所以不在 run-checks.sh（CI 上没有设备）。上一次真机跑它，
# 与 run-checks.sh 并列：一个是宿主侧门禁，一个是设备侧门禁。
#
# 用法：
#   DEVICE=<序列号> scripts/e2e/run-all.sh              # 全部
#   DEVICE=<序列号> scripts/e2e/run-all.sh first-run     # 只跑其中一个
#   SURVIVAL_MS=60000 ... run-all.sh screen-off-survival # 缩短存活测试（冒烟用）
#
# 退出码：有任何一条失败就是 1。跳过不算失败，但会单独列出来。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

if [ -z "${DEVICE:-}" ]; then
  echo "请指定设备：DEVICE=<序列号> scripts/e2e/run-all.sh" >&2
  /opt/harmony/sdk/sdk/default/openharmony/toolchains/hdc list targets 2>&1 | sed 's/^/  /' >&2
  exit 2
fi
export DEVICE

ONLY="${1:-}"
OUT="${E2E_OUT:-$HOME/mesharc-e2e}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%dT%H%M%S)"
SUMMARY="$OUT/run-$STAMP.txt"
: > "$SUMMARY"

rc=0
printf '%-24s %6s %6s %8s\n' 用例 通过 失败 跳过 | tee -a "$SUMMARY"
printf '%s\n' "------------------------------------------------" | tee -a "$SUMMARY"

for file in scripts/e2e/*.mjs; do
  name="$(basename "$file" .mjs)"
  [ -z "$ONLY" ] || [ "$name" = "$ONLY" ] || continue
  # 一个文件一个进程：这些用例会冷启动应用、断开连接，串在一个进程里会互相影响。
  log="$OUT/e2e-$name-$STAMP.log"
  if node --test "$file" > "$log" 2>&1; then
    status=0
  else
    status=1
    rc=1
  fi
  pass=$(grep -m1 '^# pass ' "$log" | awk '{print $3}')
  fail=$(grep -m1 '^# fail ' "$log" | awk '{print $3}')
  skip=$(grep -m1 '^# skipped ' "$log" | awk '{print $3}')
  printf '%-24s %6s %6s %8s\n' "$name" "${pass:-?}" "${fail:-?}" "${skip:-?}" | tee -a "$SUMMARY"
  if [ "$status" -ne 0 ]; then
    echo "  失败详情：$log"
    grep -E '^not ok|error:' "$log" | head -6 | sed 's/^/    /'
  fi
done

echo | tee -a "$SUMMARY"
echo "汇总：$SUMMARY" | tee -a "$SUMMARY"
echo "证据目录：$OUT" | tee -a "$SUMMARY"
if [ "$rc" -eq 0 ]; then
  echo "E2E 全部通过（跳过的不算通过，逐条看上面的跳过列）。"
fi
exit "$rc"
