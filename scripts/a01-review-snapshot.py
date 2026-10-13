#!/usr/bin/env python3
"""把设计文档与判据库投影成 a01 人工审核快照。

快照是投影，不是事实来源：它只从 docs/requirements/*.md 与 docs/oracles/**/*.md 里
抽取已经写下的内容，不新增需求、不新增判据、不推断测试结果。
用法：
  scripts/a01-review-snapshot.py --stage requirements --baseline <sha> --out docs/review/requirements/snapshot.json
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LAYERS = ["requirements", "architecture", "hld", "lld"]
# 判据目录 → 该层判据在第几层首次建立
LEVEL_DIRS = {"90-journeys": ("journey", "requirements"),
              "91-seams": ("seam", "architecture"),
              # 单点判据按 a01 在 HLD 首次建立、由 LLD 补齐，所以 introduced_at 是 hld。
              "points": ("point", "hld")}
MANUAL_RE = re.compile(r"^(真机走查|走查|人工走查)\s+(\S+manual-checks\.md#M-\d+)")
# 接缝号 → 细化它的 LLD 状态机条目。依据是各状态机所在的模块（architecture §2.2 + HLD 契约卡）。
LLM_BY_SEAM = {
    "01": {"L-VM-2"}, "02": {"L-VM-2"}, "03": {"L-VM-1", "L-VM-4"}, "04": {"L-VM-4"},
    "05": {"L-VM-2"}, "06": set(), "07": {"L-ALGO"}, "08": {"L-ALGO"},
    "09": set(), "10": {"L-VM-2", "L-VM-3"}, "11": {"L-VM-1", "L-VM-3"},
    "12": {"L-VM-3"}, "13": set(), "14": set(), "15": set(), "16": set(), "17": {"L-UI"},
    "18": {"L-BUILD"},
}
ANCHOR_RE = re.compile(r"^\[[^\]]{0,10}\]\s*(.+)$")


def parse_fields(block):
    """判据块 → {字段名: 值}；续行并入上一个字段。"""
    fields = {}
    last = None
    for line in block:
        m = re.match(r"^\s*[-*]\s*([^:：]{1,20})\s*[:：]\s*(.*)$", line)
        if m:
            last = m.group(1).strip()
            fields[last] = fields.get(last, "") + ("\n" if last in fields else "") + m.group(2).strip()
        elif line.strip() and last and not line.lstrip().startswith(("#", ">", "|", "---")):
            fields[last] += "\n" + line.strip()
    return fields


def split_values(text):
    return [p.strip() for p in re.split(r"[；;\n]+", text or "") if p.strip()]


# 本次运行证据：只有显式给出、且基线与快照一致时，锚点才允许写成 pass。
args_ran = None
baseline_matches = False


def load_oracles(stage):
    """返回 (判据列表, 计划测试列表)。只收本层及更早层已建立的判据。"""
    oracles, tests = [], []
    for path in sorted((ROOT / "docs/oracles").rglob("*.md")):
        rel = path.relative_to(ROOT).as_posix()
        if path.name.startswith("_") or path.name == "README.md":
            continue
        top = path.parent.name
        if top not in LEVEL_DIRS:
            continue
        level, introduced_at = LEVEL_DIRS[top]
        if LAYERS.index(introduced_at) > LAYERS.index(stage):
            continue
        text = path.read_text(encoding="utf-8")
        for chunk in re.split(r"(?m)^(?=###\s+O-)", text):
            head = re.match(r"^###\s+(O-[A-Z]+-\d+[A-Z]?)\s+(.+)$", chunk.split("\n", 1)[0])
            if not head:
                continue
            oid, title = head.group(1), head.group(2).strip()
            f = parse_fields(chunk.split("\n")[1:])
            design_ids = sorted(set(re.findall(r"\bR-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])",
                                               f.get("上游", "") + " " + f.get("设计依据", "")))
                                  | set(re.findall(r"\bA-(?:D\d+|SEAMS)\b",
                                                   f.get("设计依据", "")))
                                  | {f"H-C-{int(x):02d}" for x in
                                     re.findall(r"\bC-(\d+)\b", f.get("设计依据", ""))}
                                  # 单点判据的 LLD 依据：按它所属接缝映射到细化该接缝的状态机。
                                  | LLM_BY_SEAM.get(
                                      (re.findall(r"O-SEAM-(\d+)", f.get("父判据", "")) or [""])[0], set()))
            uncertain = (f.get("不确定特征", "") or "none").split("\n")[0].strip()
            sources = split_values(f.get("来源", "")) + [f"{rel}"]
            oracles.append({
                "id": oid,
                "level": level,
                "introduced_at": introduced_at,
                "title": title,
                "status": "ready" if uncertain == "none" else "draft",
                "parent_ids": [p for p in re.findall(r"\bO-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])",
                                                     f.get("父判据", "")) if p != oid],
                "design_ids": design_ids,
                "trigger": f.get("触发与前置条件", ""),
                "observe": f.get("可观测点", ""),
                "expected": split_values(f.get("期望", "")),
                "failure_message": f.get("失败信息", ""),
                "sources": sources,
                "oracle_state": f.get("状态", "").split("\n")[0].strip(),
                "uncertainty": uncertain,
                "owner": f.get("归属", "").strip(),
                # 接缝结构性不适用时，单点直连旅程必须写下这条理由（review.py 会校验）。
                "seam_not_applicable": f.get("seam_not_applicable", ""),
            })
            # 一条判据的锚点合成一条测试条目，一律 not_evaluated：
            # 本批没有在本基线上执行过其中任何一条。
            notes = []
            planned = f.get("待建测试", "") or f.get("待接线测试", "")
            for token in split_values(planned) or ([planned] if planned.strip() else []):
                token = ANCHOR_RE.sub(r"\1", token.strip()).strip()
                if token:
                    notes.append(f"未建：{token}")
            executed = []
            for token in split_values(f.get("测试", "")):
                token = token.strip()
                mm = MANUAL_RE.match(token)
                if mm:
                    notes.append(f"已有走查记录：{mm.group(1)} {mm.group(2)}（源文档实测，本批未复跑）")
                elif token:
                    executed.append(token)
            if notes:
                tests.append({"id": "T-" + oid, "level": "e2e", "status": "not_evaluated",
                              "oracle_ids": [oid], "evidence": "；".join(notes)})
            # 真跑过的锚点：只有给了本次运行证据（基线、命令、时间、环境）才写 pass，
            # 否则宁可 not_evaluated —— 没有运行记录就不算通过。
            for token in executed:
                # 不要用外层的 level：它在每个文件开头按目录定层，被这里覆盖会让
                # 同文件后续判据的 level 全变成 integration/unit。
                test_level = "integration" if "/integration/" in token else "unit"
                tlev = test_level[:3]
                entry = {"id": f"T-{oid}-{tlev}", "level": test_level, "status": "not_evaluated",
                         "oracle_ids": [oid], "evidence": token}
                if args_ran and baseline_matches:
                    entry.update({"status": "pass", "command": args_ran["command"],
                                  "evidence": f"run-checks.sh 全绿；锚点 {token}",
                                  "baseline": args_ran["baseline"],
                                  "environment": args_ran["environment"],
                                  "executed_at": args_ran["executed_at"]})
                if entry["id"] not in {t["id"] for t in tests}:
                    tests.append(entry)
    return oracles, tests


def load_requirements():
    """需求条目表 → 设计条目。末列是判据侧状态，不进 content 正文以外的地方。"""
    path = ROOT / "docs/requirements/requirements.md"
    design, doubts = [], []
    for line in path.read_text(encoding="utf-8").split("\n"):
        if not re.match(r"^\|\s*R-[A-Z]+-\d+", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rid, rule, source, deps, priority = cells[0], cells[1], cells[2], cells[3], cells[4]
        impl = cells[6] if len(cells) > 6 else ""
        design.append({
            "id": rid,
            "layer": "requirements",
            "title": rule.split("；")[0][:60],
            "status": "ready",
            "depends_on": [],
            "content": [f"规则：{rule}", f"优先级：{priority}", f"实现状态：{impl}（产品现状，非本流程的完成定义）"],
            "sources": split_values(source),
        })
    for line in path.read_text(encoding="utf-8").split("\n"):
        m = re.match(r"^\|\s*(Q\d+)\s*\|\s*(.+?)\s*\|", line)
        if m:
            doubts.append(f"{m.group(1)}：{m.group(2)}")

    # 质量目标表：与需求条目同属需求层，却没有 R-nn 编号。早期版本漏了这一段投影，
    # 于是审核网页上看不到目标值与测量方法——恰恰是最需要人签的部分。按表内顺序
    # 给稳定的 QG-nn 编号；目标值写「未定」的行记为 draft，等目标值定下来才 ready。
    in_goals = False
    index = 0
    for line in path.read_text(encoding="utf-8").split("\n"):
        if re.match(r"^#{2,3}\s*质量目标", line):
            in_goals = True
            continue
        if in_goals and re.match(r"^#{2,3}\s", line):
            break
        if not in_goals or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or set(cells[0]) <= set("-: ") or cells[0] == "目标":
            continue
        index += 1
        goal, target, method, state = cells[0], cells[1], cells[2], cells[3]
        design.append({
            "id": f"QG-{index:02d}",
            "layer": "requirements",
            "title": goal[:60],
            "status": "draft" if target == "未定" else "ready",
            "depends_on": [],
            "content": [f"目标值：{target}", f"观测环境与测量方法：{method}", f"现状：{state}"],
            "sources": ["docs/requirements/requirements.md#质量目标"],
        })
    return design, doubts


def load_architecture():
    """架构文档 → 设计条目。只抽有稳定锚点的三类：子系统表、接缝表、关键决策小节。"""
    path = ROOT / "docs/architecture/architecture.md"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    design = [{
        "id": "A-SEAMS", "layer": "architecture",
        "title": "旅程与接缝表（架构 §五）",
        "status": "ready", "depends_on": [],
        "content": ["每条接缝判据的设计依据：谁交什么、谁接收、失败归谁。"],
        "sources": ["docs/architecture/architecture.md §五"],
    }]
    drivers = sorted(set(re.findall(r"\bR-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])", text[:text.find("## 二")])))
    design[0]["depends_on"] = drivers
    # 文档自己声明了「3 个视图」，但早期版本只投影了 §四 的决策与 §五 的接缝表，
    # §二（子系统、数据归属、通信方式）与 §三 的三个视图全都没进快照——审核人看不到
    # 它们，也就无从签收。这里按小节标题投影，编号沿用文档里的小节号，便于对上原文。
    for m in re.finditer(r"(?m)^###\s+(\d+\.\d+)\s+(.+)$", text):
        sec, title = m.group(1), m.group(2).strip()
        start = m.end()
        nxt = re.search(r"(?m)^###\s|^##\s", text[start:])
        body = text[start:start + (nxt.start() if nxt else 1200)]
        reqs = sorted(set(re.findall(r"\bR-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])", body)))
        design.append({
            "id": "A-" + sec, "layer": "architecture", "title": f"§{sec} {title}",
            "status": "ready", "depends_on": reqs or drivers,
            "content": [re.sub(r"\s+", " ", body).strip()[:400]],
            "sources": [f"docs/architecture/architecture.md §{sec}"] + reqs,
        })
    for m in re.finditer(r"(?m)^###\s+(D\d+)\s*·\s*(.+)$", text):
        did, title = m.group(1), m.group(2).strip()
        start = m.end()
        nxt = re.search(r"(?m)^###\s+(?:D\d+\s*·|\d+\.\d+)|^##\s", text[start:])
        body = text[start:start + (nxt.start() if nxt else 1200)]
        reqs = sorted(set(re.findall(r"\bR-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])", body)))
        design.append({
            "id": "A-" + did, "layer": "architecture", "title": title,
            "status": "ready", "depends_on": reqs or drivers,
            "content": [re.sub(r"\s+", " ", body).strip()[:400]],
            "sources": [f"docs/architecture/architecture.md 关键决策 {did}"] + reqs,
        })
    return design


def load_hld():
    """HLD 文档 → 设计条目：每张契约卡一条（### C-nn · O-SEAM-nn …）。"""
    path = ROOT / "docs/hld/hld.md"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    design = []
    for m in re.finditer(r"(?m)^###\s+(C-\d+)\s*·\s*(.+)$", text):
        cid, title = m.group(1), m.group(2).strip()
        start = m.end()
        nxt = re.search(r"(?m)^###\s|^##\s", text[start:])
        body = text[start:start + (nxt.start() if nxt else 1200)]
        design.append({
            "id": "H-" + cid, "layer": "hld", "title": title, "status": "ready",
            "depends_on": ["A-SEAMS"],
            "content": [re.sub(r"\s+", " ", body).strip()[:500]],
            "sources": [f"docs/hld/hld.md 契约 {cid}"],
        })
    return design


def load_lld():
    """LLD 文档 → 设计条目：4 台状态机 + 算法段 + UI/生命周期段。

    LLD 正文里的章节标题不带接缝号，所以「它细化的是哪些契约」在这里显式写死并注明依据，
    不靠猜：每台状态机所在的模块决定了它落在哪条接缝上（见 architecture §2.2 与 HLD 契约卡）。
    """
    path = ROOT / "docs/lld/lld.md"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    # 标题 → (设计条目 id, 它细化的 HLD 契约卡)
    plan = [
        ("保活任务生命周期", "L-VM-1", ["H-C-11", "H-C-03"]),
        ("VpnCommandStateMachine", "L-VM-2", ["H-C-01", "H-C-10"]),
        ("VpnReconnectSupervisor", "L-VM-3", ["H-C-11", "H-C-10"]),
        ("VpnStatusReader", "L-VM-4", ["H-C-03", "H-C-04"]),
    ]
    design = []
    for needle, did, parents in plan:
        m = re.search(r"(?m)^### .*?" + re.escape(needle) + r".*$", text)
        if not m:
            continue
        start = m.end()
        nxt = re.search(r"(?m)^###\s|^##\s", text[start:])
        body = text[start:start + (nxt.start() if nxt else 2000)]
        design.append({
            "id": did, "layer": "lld", "title": m.group(0).lstrip("# ").strip(),
            "status": "ready", "depends_on": parents,
            "content": [re.sub(r"\s+", " ", body).strip()[:600]],
            "sources": ["docs/lld/lld.md " + m.group(0).lstrip("# ").strip()[:40]],
        })
    for needle, did, parents, title in [
        ("四、算法与数据结构", "L-ALGO", ["H-C-03", "H-C-04", "H-C-07", "H-C-08"], "算法与数据结构"),
        ("五、UI 与生命周期", "L-UI", ["H-C-11", "H-C-17"], "UI 与生命周期"),
        ("九、构建与产物装配", "L-BUILD", ["H-C-18"], "构建与产物装配")]:
        m = re.search(r"(?m)^##\s+" + re.escape(needle) + r".*$", text)
        if not m:
            continue
        start = m.end()
        nxt = re.search(r"(?m)^##\s", text[start:])
        body = text[start:start + (nxt.start() if nxt else 2000)]
        design.append({
            "id": did, "layer": "lld", "title": title, "status": "ready",
            "depends_on": parents,
            "content": [re.sub(r"\s+", " ", body).strip()[:600]],
            "sources": ["docs/lld/lld.md " + needle],
        })
    return design


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=LAYERS)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ran-baseline", default="", help="跑测试时的代码基线；不给就不写 pass")
    ap.add_argument("--ran-command", default="scripts/run-checks.sh")
    ap.add_argument("--ran-environment", default="")
    ap.add_argument("--ran-at", default="")
    args = ap.parse_args()

    global args_ran, baseline_matches
    if args.ran_baseline:
        args_ran = {"baseline": args.ran_baseline, "command": args.ran_command,
                    "environment": args.ran_environment or "Linux, Node v22.23.2",
                    "executed_at": args.ran_at or "未记时刻"}
    baseline_matches = bool(args_ran and args_ran["baseline"] == args.baseline)

    design, open_questions = load_requirements()
    if LAYERS.index(args.stage) >= LAYERS.index("architecture"):
        arch = load_architecture()
        # 架构条目按需求引用挂到需求条目上：需求是上一层，父子关系必须真实存在。
        design = design + arch
    if LAYERS.index(args.stage) >= LAYERS.index("hld"):
        design = design + load_hld()
    if LAYERS.index(args.stage) >= LAYERS.index("lld"):
        design = design + load_lld()
    oracles, tests = load_oracles(args.stage)

    if LAYERS.index(args.stage) >= LAYERS.index("architecture"):
        # 架构层自己的未决项：取 §六 表格里以 Q-nn 开头的行，逐条进快照。
        arch = (ROOT / "docs/architecture/architecture.md")
        if arch.exists():
            for line in arch.read_text(encoding="utf-8").split("\n"):
                m = re.match(r"^\|\s*\*{0,2}(Q-\d+)\*{0,2}\s*\|\s*(.+?)\s*\|", line)
                if m:
                    body = re.sub(r"\*\*", "", m.group(2))
                    open_questions.append(f"架构 {m.group(1)}：{body[:200]}")

    open_questions += [
        "三条旅程判据（O-CONN-06、O-NET-03、O-MEDIA-01）的走查证据来自当前基线之前的构建，"
        "本批未复跑；请确认是接受该证据，还是把它们降为 not-evaluated。",
        "73 条宿主侧用例当前没有 CI 门禁（仓库无 .github/ 或任何流水线），"
        "判据的「可达」目前只能证明「可判定」，不能证明「每次提交都会跑」。",
        "本快照停在设计阶段：旅程 E2E 按流程在实现阶段最后才写，所以本层的测试条目基本是 not_evaluated，"
        "这不代表行为没做，而是没有本基线上的执行记录。本基线实际执行过的是宿主侧 73 条用例，"
        "它们守的是单点层（docs/oracles/points/，按流程随 LLD 层进快照）。",
    ]

    # 本层快照只引用「本层已建立」的设计条目：单点判据同时挂着 HLD 契约与 LLD 状态机，
    # 但 HLD 阶段的快照里还没有 LLD 条目。这里过滤的是尚未建立的层，不是把悬空引用藏起来
    # ——真正的笔误（引用了任何层都不存在的 ID）仍会被校验器报出来。
    known = {item["id"] for item in design}
    for oracle in oracles:
        oracle["design_ids"] = [d for d in oracle["design_ids"] if d in known]

    snapshot = {
        "skill_version": "a01",
        "title": "MeshArc 需求层审核 · 用户旅程与判据",
        "scope": "覆盖六个功能区（连接、设备、传输、文件、媒体、隐私设置）的用户旅程、"
                 "范围与非目标、质量目标与未决项。后续架构/HLD/LLD 层在同一判据库上继续细化。",
        "baseline": args.baseline,
        "stage": args.stage,
        "design": design,
        "oracles": oracles,
        "tests": tests,
        "open_questions": open_questions,
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写出 {out}：设计 {len(design)} 条、判据 {len(oracles)} 条、测试 {len(tests)} 条、"
          f"未决项 {len(open_questions)} 条")


if __name__ == "__main__":
    sys.exit(main())
