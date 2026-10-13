#!/usr/bin/env python3
"""从一次真机运行的采集目录里派生事实。

只报它真的看到的东西。没看到就写「未观测到」，不写成「通过」——
登记册里 M-05 曾经被误当成通过证据使用，那是本项目已经犯过一次的错。
"""
import pathlib
import re
import sys

run = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
log_path = run / "03-log.txt"
if not log_path.exists():
    raise SystemExit(f"找不到日志：{log_path}")
raw = log_path.read_text(encoding="utf-8", errors="replace").split("\n")

# hilog 行以 MM-DD HH:MM:SS.mmm 开头。进度行与其它输出没有这个前缀。
# 毫秒可以缺，缺了按 0 算。
STAMP = re.compile(r"^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d\d\d))?")
# 时钟文件里那行带中文前缀，所以不锚定行首。
STAMP_ANY = re.compile(r"(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d\d\d))?")


def device_clock():
    """采集开始时设备的当下时间，由 device-run.sh 记在 00-device-clock.txt。"""
    path = run / "00-device-clock.txt"
    if not path.exists():
        return None
    found = STAMP_ANY.search(path.read_text(encoding="utf-8", errors="replace"))
    if not found:
        return None
    return tuple(int(part) if part is not None else 0 for part in found.groups())


start = device_clock()
if start is None:
    lines = raw
    print(f"日志：{log_path}（{len(lines)} 行）")
    print("⚠️ 没有设备时钟记录，无法剔除采集开始前的积压。"
          "若这次采集把整段缓冲区回放了，下面的事件可能来自上一次运行。")
else:
    # --follow 会先把缓冲区整个回放一遍再从当下往前流，所以必须按时间切一刀。
    lines = []
    for line in raw:
        found = STAMP.match(line)
        if found and tuple(int(part) if part is not None else 0
                           for part in found.groups()) >= start:
            lines.append(line)
    skipped = sum(1 for line in raw if STAMP.match(line)) - len(lines)
    print(f"日志：{log_path}（{len(raw)} 行，其中采集开始前的积压 {skipped} 行已剔除，"
          f"本次窗口 {len(lines)} 行）")
log = "\n".join(lines)
print()

# 监视的名字。按词边界匹配，否则 vpn_conflict 会把 vpn_conflict_acknowledged
# 一起算进去，报出并不存在的冲突。
WATCH = [
    ("vpn_extension_created", "扩展被拉起"),
    ("vpn_extension_destroyed", "扩展被销毁"),
    ("vpn_tun_created", "TUN 建立"),
    ("vpn_connected", "隧道可用"),
    ("vpn_backend_handoff_timeout", "后端交接超时（扩展等满 15 s 后自毁）"),
    ("background_started_special_scenario", "长时任务开始（special-scenario）"),
    ("background_started", "长时任务开始（回落 DATA_TRANSFER）"),
    ("background_special_scenario_unconfigured", "special-scenario：子类型常量还是 0"),
    ("background_special_scenario_unsupported", "special-scenario：isModeSupported() 为 false"),
    ("background_special_scenario_denied", "special-scenario：授权未拿到（code=UserAuthResult）"),
    ("background_special_scenario_failed", "special-scenario：startBackgroundRunning 抛异常"),
    ("background_status_timeout", "心跳陈旧超过宽限后释放"),
    ("background_stopped", "长时任务释放"),
    ("vpn_network_rebound", "网络重绑"),
    ("vpn_network_offline", "网络离线"),
    ("vpn_conflict", "VPN 通道冲突（扩展侧）"),
    ("vpn_conflict_detected", "冲突被应用检测到"),
    ("vpn_conflict_self_disconnect_requested", "应用请求停掉自己的扩展"),
    ("vpn_conflict_self_disconnect_completed", "自停清理走完（不证明成功）"),
    ("vpn_conflict_self_disconnect_failed", "自停失败"),
    ("vpn_conflict_acknowledged", "用户点了确定"),
    ("vpn_reconnect_attempt", "重连尝试"),
    ("vpn_reconnect_cancelled", "重连被取消"),
    ("vpn_reconnect_superseded", "重连被用户断开作废"),
    ("vpn_drop_after_requested_stop", "用户请求停止后的掉线（不恢复）"),
]

# 这三项是关键字，不是诊断事件名，所以不出现在登记表里。
# 它们只用来从设备日志里找相关行。
KEYWORDS = [
    ("Card toggle", "卡片动作结果"),
    ("taildrive", "Taildrive 相关"),
    ("media_probe", "媒体服务探测"),
]

# 名字带变量后缀的按前缀匹配，其余按整名匹配。
PREFIX_MATCH = {"vpn_network_rebound"}


def pattern_for(name):
    escaped = re.escape(name)
    if name in PREFIX_MATCH:
        return escaped
    return r"\b" + escaped + r"\b"


def count(name):
    return len(re.findall(pattern_for(name), log))


print("== 事件计数（在设备日志里出现过的）==")
found = {}
for name, label in WATCH + KEYWORDS:
    found[name] = count(name)
    if found[name]:
        print(f"  {found[name]:>4}  {name:<38} {label}")
missing = [f"{n}（{l}）" for n, l in WATCH + KEYWORDS if not found[n]]
if missing:
    print("\n未观测到：" + "、".join(missing))


def first(key):
    return next((i for i, line in enumerate(lines)
                 if re.search(pattern_for(key), line)), None)


print("\n== 可以机器判定的几条 ==")

# M-18 · QG-02 连接期保活覆盖
bg, vc = first("background_started"), first("vpn_connected")
if bg is None or vc is None:
    print("  QG-02 连接期保活覆盖：未观测到，无法判定"
          "（需要 background_started 与 vpn_connected 都出现）")
else:
    print(f"  QG-02 连接期保活覆盖：background_started 在 vpn_connected "
          f"{'之前 ✅' if bg < vc else '之后 ❌'}（行 {bg + 1} vs {vc + 1}）")

# M-18 · QG-01 心跳间隔。
# 心跳由 vpn-probe-status.txt 写入，扩展每秒刷一次，并在同一处镜像到设备日志。
# 相邻两条的间隔就是扩展停止写字的时长，这正是 QG-01 要问的量。
beats = [(i, int(m)) for i, line in enumerate(lines)
         for m in re.findall(r"heartbeatMs=(\d{10,})", line)]
if len(beats) >= 2:
    gaps = [((beats[i][1] - beats[i - 1][1]) / 1000, beats[i][0] + 1)
            for i in range(1, len(beats))]
    worst, worst_line = max(gaps)
    span = (beats[-1][1] - beats[0][1]) / 1000
    print(f"  QG-01 心跳：{len(beats)} 个采样，总跨度 {span:.0f} s，"
          f"最大间隔 {worst:.1f} s（阈值 15 s：{'✅' if worst <= 15 else '❌'}，行 {worst_line}）")
    if span < 600:
        print(f"    ⚠️ 总跨度只有 {span:.0f} s，没到 M-18 要求的 720 s，"
              "这一段不能当作连续存活证据")
    for gap, line in [g for g in gaps if g[0] > 15][:8]:
        print(f"    ⚠️ 行 {line} 前有 {gap:.1f} s 的空档")
elif len(beats) == 1:
    print("  QG-01 心跳：只采到 1 个 heartbeatMs，无法算间隔")
else:
    print("  QG-01 心跳：一个 heartbeatMs 都没采到。扩展的状态定时器每秒镜像一次；"
          "一个都没有说明镜像没生效，或采集窗口没覆盖连接期")

# M-18 · 扩展是否重启过。诊断事件不含 PID，用生命周期事件代替。
created, destroyed = found["vpn_extension_created"], found["vpn_extension_destroyed"]
if created == 0:
    print("  扩展生命周期：未观测到 vpn_extension_created，无法判定重启")
elif created == 1 and destroyed == 0:
    print("  扩展生命周期：拉起 1 次、销毁 0 次，全程同一个扩展 ✅")
else:
    print(f"  ⚠️ 扩展生命周期：拉起 {created} 次、销毁 {destroyed} 次，"
          "期间扩展被重建过，长时间存活的结论要打折")

# M-17 · 冲突路径是否收敛。
# completed 是无条件记录的，失败路径也走到它，所以判成功要看 failed 没出现。
if found["vpn_conflict"] or found["vpn_conflict_detected"]:
    if found["vpn_conflict_self_disconnect_failed"]:
        print("  M-17 冲突自停：出现 vpn_conflict_self_disconnect_failed，自停没成功 ❌")
    elif found["vpn_conflict_self_disconnect_completed"]:
        print("  M-17 冲突自停：completed 出现且 failed 未出现，自停成功 ✅")
    else:
        print("  ⚠️ M-17 冲突自停：检测到冲突，但既没有 completed 也没有 failed，清理流程没跑完")

    # 应用被杀之后没人停扩展，扩展会继续按 200 ms 空转，新会话会再撞上它。
    # 自停完成之后若再出现冲突，就是那个空洞。此刻有没有别的 VPN，由操作者对照步骤 6/7。
    last_done = None
    for i, line in enumerate(lines):
        if re.search(pattern_for("vpn_conflict_self_disconnect_completed"), line):
            last_done = i
    if last_done is None:
        print("    （没有 completed 行，跳过「自停之后是否又冲突」这一项）")
    else:
        again = pattern_for("vpn_conflict") + "|" + pattern_for("vpn_conflict_detected")
        after = [i for i, line in enumerate(lines)
                 if i > last_done and re.search(again, line)]
        if after:
            print(f"    ⚠️ 自停完成之后又出现 {len(after)} 条冲突记录（首次在行 {after[0] + 1}）。"
                  "若此刻没有其它 VPN，说明扩展仍在空转，挡住了后续连接")
        else:
            print("    自停完成之后没有再出现冲突记录 ✅")
else:
    print("  M-17 冲突路径：本次没有冲突，未观测到")

if found["vpn_backend_handoff_timeout"]:
    print("  ⚠️ 出现后端交接超时：这是用户最早报告「用到一半自己断了」的那条路径，必须单独看")
else:
    print("  后端交接：本次运行没有超时记录")

for word, label in (("FATAL", "FATAL"), ("crash", "crash"), ("Aborted", "Aborted")):
    if word in log:
        print(f"  ⚠️ 日志里出现 {label}")

print("\n== 取不到的东西，不要在这里找 ==")
print("  卡片文案与自愈：卡片在系统桌面，界面结构只覆盖本应用窗口，只能人工看。")
print("  冷启动耗时：靠操作者掐表，设备时间戳与点击时刻对不齐。")
print("  网关层失败：TaildriveGateway 没有任何日志，只能从界面表现判断。")
print("  诊断报告 zip 只装 summary.txt 与 report.json，不含 vpn-probe-status.txt，")
print("  所以心跳不要指望从它那里读。")
