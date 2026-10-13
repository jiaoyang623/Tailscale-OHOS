#!/usr/bin/env bash
# 一次真机运行的采集入口。
#
# 目的：把「一次上机」能拿到的信息尽量榨干。设备日志全程只采一次，
# 场景按顺序走，每个检查点抓截图与界面结构，结束后自动派生一批事实，
# 人工判定的部分留成待填的空表。
#
# 用法：
#   DEVICE=<serial> scripts/device-run.sh
#   DEVICE=<serial> scripts/device-run.sh --skip-build      # 已经装好了
#   DEVICE=<serial> scripts/device-run.sh --clean           # 先卸载再装（清掉登录态与旧诊断）
#
# 前置条件（脚本在第 0 步逐条打印）：
#   1. 手机上其它 VPN 应用（例如 shadowsocks）已停用，MeshArc 能拿到 VPN 通道
#   2. 设备在线：devecocli device list 能看到它
#   3. 应用内已登录且控制服务器已配置（M-14 的未登录分支除外）
#
# 采集产物落在 device-runs/<时间戳>/，可直接回填 manual-checks.md。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

DEVICE="${DEVICE:-}"
SKIP_BUILD=""
CLEAN=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --clean) CLEAN=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done
if [ -z "$DEVICE" ]; then
  echo "请指定设备：DEVICE=<serial> scripts/device-run.sh" >&2
  devecocli device list 2>&1 | sed 's/^/  /'
  exit 2
fi

BUNDLE="ren.w2h.mesharc"
# 采集走 hdc 的 hilog，不走 devecocli log --follow。
# 实测：跑本脚本时 devecocli 的 follow 会在启动约 28 秒后停止输出，
# 而进程还活着（kill -0 验不出），本脚本之外又复现不出来。
# hdc 是另一套子系统，实现在并发 ui 调用下一直稳。
HDC_BIN="${HDC:-/opt/harmony/sdk/sdk/default/openharmony/toolchains/hdc}"
STAMP="$(date +%Y%m%dT%H%M%S)"
# 仓库根目录归 w2h。以别的用户跑时建不了 device-runs/，整批会在第一步就死，
# 所以先探可写性，不可写就换到主目录下，并把实际位置打出来。
OUT_ROOT="${OUT_ROOT:-device-runs}"
if ! mkdir -p "$OUT_ROOT" 2>/dev/null || [ ! -w "$OUT_ROOT" ]; then
  OUT_ROOT="${HOME}/mesharc-device-runs"
  mkdir -p "$OUT_ROOT" || { echo "无法创建产物目录：$OUT_ROOT" >&2; exit 2; }
  echo "仓库根目录不可写，产物改放：$OUT_ROOT"
  echo "（要放进仓库就跑：sudo -n -u w2h scripts/device-run.sh）"
fi
OUT="$OUT_ROOT/$STAMP"
mkdir -p "$OUT" || { echo "无法创建 $OUT" >&2; exit 2; }
: > "$OUT/notes.txt" || { echo "无法写 $OUT/notes.txt" >&2; exit 2; }

say() { echo; echo "──────────────────────────────────────────────"; echo "$*"; echo "──────────────────────────────────────────────"; }
note() { echo "$*" >> "$OUT/notes.txt"; echo "  · $*"; }
shot() {
  if ! devecocli ui screenshot --device "$DEVICE" --path "$OUT/$1.png" >/dev/null 2>&1; then
    note "⚠️ 截图失败：$1（$1.png 没生成）"; return
  fi
  [ -s "$OUT/$1.png" ] || { note "⚠️ 截图是空文件：$1"; return; }
  note "截图 $1.png（$(stat -c%s "$OUT/$1.png") 字节）"
}
layout() {
  # 进度行（"- Dumping layout…"）走 stderr，混进 stdout 就不是合法 JSON。分开存。
  if ! devecocli ui layout --device "$DEVICE" --format json --mode full \
      > "$OUT/$1.layout.json" 2> "$OUT/$1.layout.err"; then
    note "⚠️ 界面结构读取失败：$1（见 $1.layout.err）"; return
  fi
  # 抓到了不等于能用。JSON 解析不过就是没抓到，这条要说出来。
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" \
      "$OUT/$1.layout.json" 2>/dev/null; then
    note "⚠️ 界面结构不是合法 JSON：$1（见 $1.layout.err）"; return
  fi
  note "界面结构 $1.layout.json（$(stat -c%s "$OUT/$1.layout.json") 字节，JSON 合法）"
}

say "0/6 前置检查"
devecocli device list 2>&1 | tee "$OUT/00-devices.txt"
echo
echo "开始之前请确认："
echo "  [ ] 手机上其它 VPN 应用已停用（shadowsocks 等），MeshArc 能拿到 VPN 通道"
echo "  [ ] 应用内已登录，控制服务器已配置"
echo "  [ ] 手机保持连线；USB/HDC 会改变电源行为，这条要写进结论的适用范围"
read -r -p "确认后回车开始，Ctrl-C 放弃： " _

say "1/6 构建与安装"
if [ -z "$SKIP_BUILD" ]; then
  sudo -n -u w2h bash .build/compile.sh 2>&1 | tee "$OUT/01-build.txt" | tail -5
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "构建失败，停止。" >&2; exit 1; }
else
  echo "（跳过构建）" > "$OUT/01-build.txt"
fi
if [ -n "$CLEAN" ]; then
  echo "（--clean：先卸载，登录态与上一轮诊断会被清掉）"
  devecocli run --device "$DEVICE" --skip-build --uninstall 2>&1 | tee "$OUT/02-install.txt" | tail -5
else
  devecocli run --device "$DEVICE" --skip-build 2>&1 | tee "$OUT/02-install.txt" | tail -5
fi
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "装机失败，停止。见 $OUT/02-install.txt" >&2; exit 1; }

# 应用没跑起来，后面的采集一无所获，而脚本会一直走到收尾才让人发现。
# devecocli 在没有运行中的进程时明说 "No running process"，就查这一句。
say "1.5/6 确认应用已经在跑"
echo "请在手机上打开一次 MeshArc，停在首页。若刚装完，它通常已经起来了。"
read -r -p "打开后回车： " _
# 不要用 --from：它的窗口按主机时间算，而设备时钟可能与主机相差数小时
# （本机实测差 3 小时），带 --from 的查询在那种设备上一行都取不到。
# --tail 1 在本机返回 0 行（工具自身的边界行为），用 5。
if ! devecocli log --device "$DEVICE" --bundle-name "$BUNDLE" --tail 5 \
    > "$OUT/00-app-alive.txt" 2>&1; then
  cat "$OUT/00-app-alive.txt" >&2
  echo "取应用日志失败或应用没在运行。这样开始采集，整批场景都会是空的。" >&2
  exit 1
fi
if ! grep -qE '^[0-9][0-9]-[0-9][0-9] ' "$OUT/00-app-alive.txt"; then
  cat "$OUT/00-app-alive.txt" >&2
  echo "没有取到任何本应用的日志行，无法确认它在跑。停止。" >&2
  exit 1
fi

say "2/6 开始采集设备日志"
# 采集可能中途停掉（实测遇到过一次，采集文件在场景跑到一半时就不再增长）。
# 所以采集成段：每个检查点验活，断了就续一段。每段记下设备当时的时间，
# 分析器按各段自己的起点过滤，段与段之间不会重复计数。
# 为什么要过滤：--follow 会先把设备日志缓冲区的全部积压回放一遍，
# 不过滤就会把上一次运行的事件当成这一次的证据。
CAPTURE_PARTS="$OUT/00-capture-parts.txt"
: > "$CAPTURE_PARTS"
PART_NO=0
LOG_PID=""

device_clock() {
  devecocli log --device "$DEVICE" --tail 5 > "$OUT/00-device-clock.txt" 2>&1 || true
  grep -E '^[0-9][0-9]-[0-9][0-9] ' "$OUT/00-device-clock.txt" | tail -1 | cut -c1-18
}

start_capture() {
  PART_NO=$((PART_NO + 1))
  if [ "$PART_NO" -eq 1 ]; then
    PART_FILE="$OUT/03-log.txt"
  else
    PART_FILE="$OUT/03-log-$PART_NO.txt"
  fi
  DEVICE_NOW="$(device_clock)"
  echo "设备当下时间：${DEVICE_NOW:-未取到}（主机 $(date '+%m-%d %H:%M:%S')）"
  printf '%s\t%s\n' "$(basename "$PART_FILE")" "$DEVICE_NOW" >> "$CAPTURE_PARTS"
  if [ ! -x "$HDC_BIN" ]; then
    echo "找不到 hdc：$HDC_BIN。设 HDC=<路径> 再跑。" >&2
    exit 2
  fi
  # 设备整机的 hilog 很大，按包名就地过滤，落盘的就只剩本应用的行。
  ( "$HDC_BIN" -t "$DEVICE" shell hilog 2>&1 \
      | grep --line-buffered -E 'ren\.w2h\.mesharc' > "$PART_FILE" ) &
  LOG_PID=$!
  sleep 5
  if ! kill -0 "$LOG_PID" 2>/dev/null; then
    echo "采集进程起不来，日志不会有内容。检查 --device 与 devecocli 的登录状态。" >&2
    tail -5 "$PART_FILE" >&2
    exit 1
  fi
  echo "第 $PART_NO 段采集写入 $PART_FILE（后台进程 $LOG_PID）"
}

check_capture() {
  if [ -n "$LOG_PID" ] && kill -0 "$LOG_PID" 2>/dev/null; then
    return 0
  fi
  note "⚠️ 采集在第 $PART_NO 段中断，已续采一段。中断期间的事件没有记录。"
  start_capture
}

cleanup() {
  [ -n "$LOG_PID" ] || return 0
  # LOG_PID 是子 shell，hdc 与 grep 是它的子进程，要一起停。
  pkill -P "$LOG_PID" 2>/dev/null
  kill "$LOG_PID" 2>/dev/null
  wait "$LOG_PID" 2>/dev/null
}
trap cleanup EXIT
start_capture

scenario() {
  local id="$1" title="$2" instruction="$3"
  say "$id · $title"
  echo "$instruction"
  echo
  read -r -p "做完后回车；跳过输入 s： " answer
  if [ "$answer" = "s" ]; then note "$id $title — 跳过（操作者选择）"; return; fi
  shot "$id"
  layout "$id"
  check_capture
  read -r -p "这一条看到什么？一句话： " observation
  note "$id $title — ${observation:-（未填）}"
}

say "3/6 场景"
scenario "M-13" "Q-01 两个进程里同一份 .so 是几个运行时" \
"连接 Tailscale 并等到状态显示已连接。
打开诊断面板，读出「本进程引擎状态」。
判定：本进程引擎显示 stopped/NoState → 两个独立运行时（D3 成立）；
显示 Running 且与扩展侧是同一实例 → 一个运行时（D3 失效）。"

scenario "M-14" "Q7-a 桌面卡片开关" \
"1. 长按桌面图标添加 2×2 卡片
2. 点卡片按钮连接，再点一次断开
3. 在应用内操作，确认卡片跟着变
4. 记录卡片文案与应用状态是否一致
卡片文案与自愈只能人工看，界面结构抓不到桌面。做不了就输入 s 跳过。"

scenario "M-15" "Q7-b Taildrive 真机共享节点" \
"需要同一 tailnet 内另有一台开启共享的设备：浏览共享目录、上传一个文件、再下载回来，
传输中断网一次看失败态与重试。没有第二台设备就输入 s 跳过，并在结论里写明原因。"

scenario "M-16" "Q7-c special-scenario 长时任务" \
"仅在 ACL 通过或装了试用调试 Profile 时做。没通过就输入 s 跳过。
要做的话这条会打断采集：先 scripts/toggle-special-scenario-acl.mjs 打开声明，
重新构建并重装，再回到这里继续。采集不停。
走了哪条路看 background_started_special_scenario 还是 background_started。
没走成的原因看四条 background_special_scenario_ 记录：unconfigured / unsupported / denied / failed。"

scenario "M-17" "Q-02（修订）VPN 冲突路径是否收敛" \
"1. 保留占用 VPN 通道的应用（shadowsocks）。
2. 发起连接，记下提示框的标题与正文。
3. 不点「确定」，等 60 秒。
4. 断开 shadowsocks，再连一次，确认这次能连上。
5. 再发起连接，冲突提示出现后立刻强杀应用进程。
6. 断开 shadowsocks，重启应用，读当前状态文字。
7. 再连一次，看是否报冲突。
判定：第 7 步报冲突而此刻没有其它 VPN，就证明应用死后扩展仍在空转，挡住了后续连接。"

say "M-18 · Q17 锁屏静置下的后台存活"
# 锁屏用设备自己的 power-shell，不需要人守着手机。心跳由扩展每秒镜像到设备日志，
# 收尾时由 device-analyze.py 算相邻两条的间隔。
SURVIVAL_S="${SURVIVAL_S:-720}"
if "$HDC_BIN" -t "$DEVICE" shell "which power-shell" >/dev/null 2>&1; then
  echo "把 Wi-Fi 关掉、改用蜂窝的，现在做；本次默认沿用当前网络。"
  echo "接下来锁屏静置 ${SURVIVAL_S} 秒。期间不要碰手机。"
  read -r -p "准备好后回车开始计时： " _
  "$HDC_BIN" -t "$DEVICE" shell power-shell suspend >/dev/null 2>&1
  T0="$(date +%s)"
  while [ $(( $(date +%s) - T0 )) -lt "$SURVIVAL_S" ]; do
    sleep 15
    printf '  已静置 %s 秒 / %s\r' "$(( $(date +%s) - T0 ))" "$SURVIVAL_S"
  done
  echo
  "$HDC_BIN" -t "$DEVICE" shell power-shell wakeup >/dev/null 2>&1
  sleep 5
  note "M-18 锁屏静置 $SURVIVAL_S 秒完成，心跳间隔见 04-analysis.txt"
else
  echo "设备上没有 power-shell，改人工：锁屏静置 ${SURVIVAL_S} 秒，期间不要碰手机。"
  read -r -p "静置完成后回车： " _
  note "M-18 人工锁屏静置，时长以操作者为准"
fi

say "M-19 · Q6 冷启动到可用"
# 不掐表。日志里有两个带设备时间戳的锚点：EntryAbility onCreate 与 ui_opened，
# 两者之差就是这一条要的耗时，收尾时由 device-analyze.py 算出来。
if [ -x "$HDC_BIN" ]; then
  COLD_RUNS="${COLD_RUNS:-5}"
  echo "自动跑 $COLD_RUNS 次冷启动（强杀 → 拉起 → 等 6 秒）。"
  for i in $(seq 1 "$COLD_RUNS"); do
    printf '  第 %s 次…' "$i"
    "$HDC_BIN" -t "$DEVICE" shell aa force-stop "$BUNDLE" >/dev/null 2>&1
    sleep 3
    "$HDC_BIN" -t "$DEVICE" shell aa start -a EntryAbility -b "$BUNDLE" >/dev/null 2>&1
    sleep 6
    echo " 完成"
  done
  note "M-19 冷启动：已自动跑 $COLD_RUNS 次，耗时见 04-analysis.txt"
else
  echo "找不到 hdc（$HDC_BIN），改人工：强杀应用，从点击图标计时到首页可交互，重复 5 次。"
  read -r -p "5 次耗时（秒，逗号分隔，可空）： " timings
  [ -n "$timings" ] && note "M-19 冷启动耗时（秒，人工）：$timings"
fi

say "4/6 导出诊断报告"
echo "在应用内导出一次诊断报告并分享给自己，把文件放到：$OUT/diagnostic-report.zip"
read -r -p "导出完成后回车：" _

say "5/6 停止采集"
check_capture
cleanup
trap - EXIT
echo "日志已停止，共 $(cat "$OUT"/03-log*.txt | wc -l) 行"

say "6/6 派生事实"
python3 scripts/device-analyze.py "$OUT" | tee "$OUT/04-analysis.txt"

say "完成"
echo "产物目录：$OUT"
echo "待填结论：$OUT/notes.txt"
echo "下一步：按 notes.txt 与 04-analysis.txt 回填 docs/changes/a01-baseline/manual-checks.md"
