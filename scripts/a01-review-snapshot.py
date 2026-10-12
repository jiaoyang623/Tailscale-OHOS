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
              "points": ("point", "lld")}
MANUAL_RE = re.compile(r"^(真机走查|走查|人工走查)\s+(\S+manual-checks\.md#M-\d+)")
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
                                                   f.get("设计依据", ""))))
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
            })
            # 一条判据的锚点合成一条测试条目，一律 not_evaluated：
            # 本批没有在本基线上执行过其中任何一条。
            notes = []
            planned = f.get("待建测试", "") or f.get("待接线测试", "")
            for token in split_values(planned) or ([planned] if planned.strip() else []):
                token = ANCHOR_RE.sub(r"\1", token.strip()).strip()
                if token:
                    notes.append(f"未建：{token}")
            for token in split_values(f.get("测试", "")):
                mm = MANUAL_RE.match(token.strip())
                if mm:
                    notes.append(f"已有走查记录：{mm.group(1)} {mm.group(2)}（源文档实测，本批未复跑）")
            if notes:
                tests.append({"id": "T-" + oid, "level": "e2e", "status": "not_evaluated",
                              "oracle_ids": [oid], "evidence": "；".join(notes)})
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=LAYERS)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    design, open_questions = load_requirements()
    if LAYERS.index(args.stage) >= LAYERS.index("architecture"):
        arch = load_architecture()
        # 架构条目按需求引用挂到需求条目上：需求是上一层，父子关系必须真实存在。
        design = design + arch
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
