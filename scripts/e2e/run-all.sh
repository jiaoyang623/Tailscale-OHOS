#!/usr/bin/env bash
# E2E 层的统一入口：跑 scripts/e2e 下的全部用例文件。
#
# E2E 驱动真机，所以不在 run-checks.sh（CI 上没有设备）。上一次真机跑它，
# 与 run-checks.sh 并列：一个是宿主侧门禁，一个是设备侧门禁。
#
# 逐文件的执行、汇总、结果落盘都在 run-batch.sh 里。这里只负责把文件列出来。
# 两份实现会漂，所以不复制第二份。
#
# 用法：
#   DEVICE=<序列号> scripts/e2e/run-all.sh              # 全部
#   DEVICE=<序列号> scripts/e2e/run-all.sh first-run     # 只跑其中一个
#   SURVIVAL_MS=60000 ... run-all.sh screen-off-survival # 缩短存活测试（冒烟用）
#
# 退出码：有任何一条失败就是 1。跳过不算失败，但会在汇总里单列。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

if [ -z "${DEVICE:-}" ]; then
  echo "请指定设备：DEVICE=<序列号> scripts/e2e/run-all.sh" >&2
  /opt/harmony/sdk/sdk/default/openharmony/toolchains/hdc list targets 2>&1 | sed 's/^/  /' >&2
  exit 2
fi
export DEVICE

ONLY="${1:-}"
names=()
for file in scripts/e2e/*.mjs; do
  name="$(basename "$file" .mjs)"
  [ -z "$ONLY" ] || [ "$name" = "$ONLY" ] || continue
  names+=("$name")
done

if [ "${#names[@]}" -eq 0 ]; then
  echo "scripts/e2e 下没有可跑的用例文件。" >&2
  exit 2
fi

exec bash scripts/e2e/run-batch.sh "${names[@]}"
