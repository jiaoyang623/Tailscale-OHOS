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
log = log_path.read_text(encoding="utf-8", errors="replace")
lines = log.split("\n")

print(f"日志：{log_path}（{len(lines)} 行）")
print()

WATCH = [
    ("vpn_extension_created", "扩展被拉起"),
    ("vpn_tun_created", "TUN 建立"),
    ("vpn_connected", "隧道可用"),
    ("vpn_backend_handoff_timeout", "后端交接超时（扩展等满 15 s 后自毁）"),
    ("background_started", "长时任务开始"),
    ("background_status_timeout", "心跳陈旧超过宽限后释放"),
    ("background_stopped", "长时任务释放"),
    ("vpn_network_rebound", "网络重绑"),
    ("vpn_conflict", "VPN 通道冲突"),
    ("vpn_replacement_approved", "读到替换批准文件"),
    ("vpn_replace_retry", "替换重试"),
    ("vpn_reconnect_attempt", "重连尝试"),
    ("vpn_reconnect_cancelled", "重连被取消"),
    ("vpn_reconnect_superseded", "重连被用户断开作废"),
    ("vpn_drop_after_requested_stop", "用户请求停止后的掉线（不恢复）"),
    ("card", "卡片相关"),
    ("media_probe", "媒体服务探测"),
]

print("== 事件计数（在设备日志里出现过的）==")
found = {}
for key, label in WATCH:
    n = log.count(key)
    found[key] = n
    if n:
        print(f"  {n:>4}  {key:<34} {label}")
missing = [f"{k}（{l}）" for k, l in WATCH if not found[k]]
if missing:
    print("\n未观测到：" + "、".join(missing))

print("\n== 可以机器判定的几条 ==")

first = lambda key: next((i for i, l in enumerate(lines) if key in l), None)
bg, vc = first("background_started"), first("vpn_connected")
if bg is None or vc is None:
    print("  QG-02 连接期保活覆盖：未观测到，无法判定（需要 background_started 与 vpn_connected 都出现）")
else:
    print(f"  QG-02 连接期保活覆盖：background_started 在 vpn_connected "
          f"{'之前 ✅' if bg < vc else '之后 ❌'}（行 {bg+1} vs {vc+1}）")

beats = [int(m) for m in re.findall(r"heartbeatMs=(\d{10,})", log)]
if len(beats) >= 2:
    beats.sort()
    gaps = [(b - a) / 1000 for a, b in zip(beats, beats[1:])]
    worst = max(gaps)
    print(f"  QG-01 心跳：{len(beats)} 个采样，最大间隔 {worst:.1f} s"
          f"（阈值 15 s：{'✅' if worst <= 15 else '❌'}）；总跨度 {(beats[-1]-beats[0])/1000:.0f} s")
else:
    print(f"  QG-01 心跳：只采到 {len(beats)} 个 heartbeatMs，无法算跨度"
          "（设备日志默认不含该字段时，改从导出的诊断报告里读）")

if log.count("vpn_backend_handoff_timeout"):
    print("  ⚠️ 出现后端交接超时：这是用户最早报告「用到一半自己断了」的那条路径，必须单独看")
else:
    print("  后端交接：本次运行没有超时记录")

for word, label in (("FATAL", "FATAL"), ("crash", "crash"), ("Aborted", "Aborted")):
    if word in log:
        print(f"  ⚠️ 日志里出现 {label}")

print("\n== 未观测到的原因提示 ==")
print("  设备日志只覆盖 hilog 缓冲区。诊断事件文件的完整内容要靠")
print("  diagnostic-report.zip；本目录里若有 diagnostic-report.zip，请解开后一并核对。")
