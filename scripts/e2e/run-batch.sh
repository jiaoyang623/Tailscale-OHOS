#!/usr/bin/env bash
# 跑指定的几个 E2E 文件，一个文件一个进程，最后给一张汇总。
# 与 run-all.sh 的区别只有一个：可以只挑几个文件跑。
# 用法：DEVICE=<序列号> run-batch.sh connect-journey devices-journey
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

if [ -z "${DEVICE:-}" ]; then
  echo "请指定设备：DEVICE=<序列号> $0 <文件名...>" >&2
  exit 2
fi
export DEVICE

# 设备侧的 shell。守卫脚本用它读电源状态、把应用拉回前台。
HDC="${HDC:-/opt/harmony/sdk/sdk/default/openharmony/toolchains/hdc}"

OUT="${E2E_OUT:-$HOME/mesharc-e2e}"
mkdir -p "$OUT"
# 每次批次从空的结构化日志开始，避免上一批的跳过项混进来。
rm -f docs/changes/vpn-endurance/checks/.e2e-steps-*.json
STAMP="$(date +%Y%m%dT%H%M%S)"
SUMMARY="$OUT/batch-$STAMP.txt"
: > "$SUMMARY"
# 机器可读的结果。回填判据结论时读这份，不读上面那张表。
RESULTS="$OUT/e2e-results-$STAMP.json"
RESULTS_TSV="$OUT/.e2e-results-$STAMP.tsv"
: > "$RESULTS_TSV"

rc=0
printf '%-28s %6s %6s %8s %7s\n' 用例 通过 失败 跳过 秒 | tee -a "$SUMMARY"
printf '%s\n' "--------------------------------------------------------" | tee -a "$SUMMARY"

for name in "$@"; do
  file="scripts/e2e/$name.mjs"
  if [ ! -f "$file" ]; then
    printf '%-28s %s\n' "$name" "文件不存在" | tee -a "$SUMMARY"
    rc=1
    continue
  fi
  log="$OUT/e2e-$name-$STAMP.log"
  started="$(date +%s)"
  # 界面读不到有两种原因：锁屏，或前台被别的应用占着。
  # 锁屏后应用起不到前台，后续每条都会失败，整批结果变成噪声，这里直接停批。
  # 前台被占时把应用拉回前台再试一次，不停批：屏幕亮着说明设备有人用。
  if ! devecocli ui layout --device "$DEVICE" --format json --mode full >/dev/null 2>&1; then
    state=$($HDC -t "$DEVICE" shell "hidumper -s PowerManagerService -a '-a'" 2>/dev/null | awk -F': ' '/Current State:/{print $2; exit}')
    case "$state" in
      AWAKE*)
        $HDC -t "$DEVICE" shell "aa start -a EntryAbility -b ren.w2h.mesharc" >/dev/null 2>&1
        sleep 5
        ;;
    esac
    if ! devecocli ui layout --device "$DEVICE" --format json --mode full >/dev/null 2>&1; then
      printf '%-28s %s\n' "$name" "未跑：设备界面读不到，可能已锁屏" | tee -a "$SUMMARY"
      rc=1
      break
    fi
  fi
  if node --test "$file" > "$log" 2>&1; then
    status=0
  else
    status=1
    rc=1
  fi
  elapsed=$(( $(date +%s) - started ))
  pass=$(grep -m1 '^# pass ' "$log" | awk '{print $3}')
  fail=$(grep -m1 '^# fail ' "$log" | awk '{print $3}')
  skip=$(grep -m1 '^# skipped ' "$log" | awk '{print $3}')
  printf '%-28s %6s %6s %8s %7s\n' "$name" "${pass:-?}" "${fail:-?}" "${skip:-?}" "$elapsed" | tee -a "$SUMMARY"
  if [ "$status" -ne 0 ]; then
    echo "  失败详情：$log" | tee -a "$SUMMARY"
    grep -E '^not ok|error:|AssertionError' "$log" | head -8 | sed 's/^/    /' | tee -a "$SUMMARY"
  fi
  # 每个文件一行机器可读的结果。跳过不算通过，所以 verdict 分三档。
  # 这份数据是「判据 → 用例 → 结论」回填的输入，别只留人看的表格。
  if [ "${fail:-1}" = "0" ] && [ "${skip:-1}" = "0" ]; then
    verdict=pass
  elif [ "${fail:-1}" = "0" ]; then
    verdict=partial
  else
    verdict=fail
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$name" "${pass:-0}" "${fail:-0}" "${skip:-0}" "$verdict" "$log" >> "$RESULTS_TSV"
done

echo | tee -a "$SUMMARY"
echo "汇总：$SUMMARY" | tee -a "$SUMMARY"
echo "结果数据：$RESULTS" | tee -a "$SUMMARY"

# 结构化运行日志。报告生成器只读这一份。
if ! node scripts/e2e/lib/merge-steps.mjs; then
  rc=1
fi

# 汇总成一份 JSON。回填脚本读它，不读上面那张给人看的表。
python3 - "$RESULTS_TSV" "$RESULTS" "$STAMP" "$*" <<'PY'
import json
import os
import pathlib
import subprocess
import sys

tsv, out, stamp, names = sys.argv[1:5]
baseline = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                          capture_output=True, text=True).stdout.strip()
files = {}
for line in pathlib.Path(tsv).read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    name, passed, failed, skipped, verdict, log = line.split("\t")
    files[name] = {
        "pass": int(passed), "fail": int(failed), "skip": int(skipped),
        "verdict": verdict, "log": log,
    }
record = {
    "ran_at": stamp,
    "device": os.environ.get("DEVICE", ""),
    "command": f"scripts/e2e/run-batch.sh {names}",
    "baseline": baseline,
    "files": files,
}
pathlib.Path(out).write_text(
    json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"结果数据：{out}（{len(files)} 个文件）")

# 合并进仓库里那一份。判据快照读的是它，所以只有跨批累积，
# 一次跑一半才不会把另一半的结论抹掉。写不进去就只留工作副本。
REPO = pathlib.Path.cwd() / "docs/changes/a01-baseline/e2e-results.json"
try:
    merged = json.loads(REPO.read_text(encoding="utf-8")) if REPO.exists() else {"files": {}}
    merged.setdefault("files", {}).update(files)
    merged["ran_at"] = stamp
    merged["device"] = record["device"]
    merged["baseline"] = baseline
    REPO.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已并入 docs/changes/a01-baseline/e2e-results.json（累计 {len(merged['files'])} 个文件）")
except OSError as error:
    print(f"仓库里那一份没写成（{error}），只留工作副本", file=sys.stderr)
PY

exit "$rc"
