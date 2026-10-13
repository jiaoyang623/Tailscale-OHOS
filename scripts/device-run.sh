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
# --follow 会先把设备日志缓冲区的**全部积压**回放一遍，再从当下往前流。
# 记下设备此刻的时间，分析器据此把回放的部分剔掉，否则上一次运行的事件
# 会被当成这一次的证据。
devecocli log --device "$DEVICE" --tail 5 > "$OUT/00-device-clock.txt" 2>&1 || true
DEVICE_NOW="$(grep -E '^[0-9][0-9]-[0-9][0-9] ' "$OUT/00-device-clock.txt" | tail -1 | cut -c1-18)"
HOST_NOW="$(date '+%m-%d %H:%M:%S')"
echo "设备当下时间：${DEVICE_NOW:-未取到}（主机 $HOST_NOW）"
if [ -n "$DEVICE_NOW" ]; then
  echo "设备当下时间：$DEVICE_NOW（主机 $HOST_NOW）" > "$OUT/00-device-clock.txt"
fi
devecocli log --device "$DEVICE" --bundle-name "$BUNDLE" --follow > "$OUT/03-log.txt" 2>&1 &
LOG_PID=$!
cleanup() { kill "$LOG_PID" 2>/dev/null; wait "$LOG_PID" 2>/dev/null; }
trap cleanup EXIT
echo "日志写入 $OUT/03-log.txt（后台进程 $LOG_PID，收尾时停止）"
# 起不来的采集会让整批场景白跑，所以在这里就确认它活着。
sleep 5
if ! kill -0 "$LOG_PID" 2>/dev/null; then
  echo "采集进程已经退出，日志不会有内容。检查 --device 与 devecocli 的登录状态。" >&2
  tail -5 "$OUT/03-log.txt" >&2
  exit 1
fi
echo "采集进程存活，开始走场景。"

scenario() {
  local id="$1" title="$2" instruction="$3"
  say "$id · $title"
  echo "$instruction"
  echo
  read -r -p "做完后回车；跳过输入 s： " answer
  if [ "$answer" = "s" ]; then note "$id $title — 跳过（操作者选择）"; return; fi
  shot "$id"
  layout "$id"
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
"让手机上另一个应用继续占用 VPN 通道（shadowsocks）。
1. 发起连接，记下提示框的标题与正文。
2. 不点「确定」，等 60 秒。
3. 断开 shadowsocks，再连一次，确认这次能连上。
4. 再发起连接，冲突提示出现后立刻强杀应用进程。
5. 断开 shadowsocks，重启应用，读当前状态文字。
6. 再连一次，看是否报冲突。
判定：第 6 步报冲突而此刻没有其它 VPN，就证明应用死后扩展仍在空转，挡住了后续连接。"

scenario "M-18" "Q17 蜂窝下的长时间存活" \
"关掉 Wi-Fi，用蜂窝连接，锁屏静置 720 秒以上。
这条要的就是等待，期间不要碰手机。等满之后回车。
没满 720 秒就回车的话，结论里要写明实际时长，不能当成连续存活证据。"

say "M-19 · Q6 冷启动到可用"
echo "强杀应用，冷启动，从点击图标计时到最后一次界面可交互。重复 5 次。"
read -r -p "5 次耗时（秒，逗号分隔，可空）： " timings
[ -n "$timings" ] && note "M-19 冷启动耗时（秒）：$timings"

say "4/6 导出诊断报告"
echo "在应用内导出一次诊断报告并分享给自己，把文件放到：$OUT/diagnostic-report.zip"
read -r -p "导出完成后回车：" _

say "5/6 停止采集"
cleanup
trap - EXIT
echo "日志已停止，共 $(wc -l < "$OUT/03-log.txt") 行"

say "6/6 派生事实"
python3 scripts/device-analyze.py "$OUT" | tee "$OUT/04-analysis.txt"

say "完成"
echo "产物目录：$OUT"
echo "待填结论：$OUT/notes.txt"
echo "下一步：按 notes.txt 与 04-analysis.txt 回填 docs/changes/a01-baseline/manual-checks.md"
