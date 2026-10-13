#!/usr/bin/env python3
import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path


LAYERS = ("requirements", "architecture", "hld", "lld")
LEVELS = ("journey", "seam", "point")
LABELS = {
    "requirements": "需求分析", "architecture": "架构设计",
    "hld": "HLD 概要设计", "lld": "LLD 详细设计",
    "journey": "旅程判据", "seam": "接缝判据", "point": "单点判据",
    "integration": "集成测试", "unit": "单元测试", "e2e": "E2E 测试",
    "draft": "草稿", "ready": "内容就绪", "blocked": "阻塞",
    "pending": "待人工审核", "accepted": "人工接受", "changes_requested": "需要修改",
    "stale": "旧结论已过期", "pass": "通过", "fail": "失败",
    "skip": "跳过", "not_evaluated": "未验证",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def strings(value, nonempty=False):
    return (isinstance(value, list) and all(text(entry) for entry in value)
            and (not nonempty or bool(value)))


def digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def load_json(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "JSON 重复字段：" + key)
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("JSON 不允许非有限数字：" + value)

    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=unique_keys,
                      parse_constant=invalid_constant)


def validate_snapshot(data):
    require(isinstance(data, dict), "快照必须是 JSON 对象")
    require(data.get("skill_version") == "a01", "skill_version 必须是 a01")
    for key in ("title", "scope", "baseline"):
        require(text(data.get(key)), key + " 必须是非空字符串")
    require(data.get("stage") in LAYERS, "stage 必须是 requirements/architecture/hld/lld")
    for key in ("design", "oracles", "tests", "open_questions"):
        require(isinstance(data.get(key), list), key + " 必须是数组")
    require(bool(data["design"]), "至少需要一个设计条目")
    require(strings(data["open_questions"]), "open_questions 必须是字符串数组")

    items = {}
    test_ids = set()
    for item in data["design"] + data["oracles"]:
        require(isinstance(item, dict), "设计与判据条目必须是对象")
        item_id = item.get("id")
        require(text(item_id), "每个条目必须有非空 id")
        require(item_id not in items, "重复条目 ID：" + item_id)
        items[item_id] = item
        require(text(item.get("title")), item_id + " 缺少 title")
        require(item.get("status") in ("draft", "ready", "blocked"), item_id + " 的 status 无效")
        require(strings(item.get("sources"), True), item_id + " 缺少可复核 sources")

    designs = {item["id"]: item for item in data["design"]}
    oracles = {item["id"]: item for item in data["oracles"]}
    for item in data["design"]:
        item_id = item["id"]
        layer = item.get("layer")
        require(layer in LAYERS, item_id + " 的 layer 无效")
        require(LAYERS.index(layer) <= LAYERS.index(data["stage"]), item_id + " 超出当前设计层")
        require(strings(item.get("content"), True), item_id + " 缺少 content")
        parents = item.get("depends_on")
        require(strings(parents), item_id + " 的 depends_on 必须是字符串数组")
        require(len(set(parents)) == len(parents), item_id + " 重复上层引用")
        if layer == "requirements":
            require(not parents, item_id + " 的需求条目不应有设计父条目")
        else:
            previous = LAYERS[LAYERS.index(layer) - 1]
            require(bool(parents), item_id + " 必须关联上层设计")
            for parent in parents:
                require(parent in designs, item_id + " 悬空设计引用：" + parent)
                require(designs[parent]["layer"] == previous, item_id + " 应关联 " + previous)

    for item in data["oracles"]:
        item_id = item["id"]
        level = item.get("level")
        require(level in LEVELS, item_id + " 的 level 无效")
        introduced = item.get("introduced_at")
        require(introduced in LAYERS, item_id + " 的 introduced_at 无效")
        require(LAYERS.index(introduced) <= LAYERS.index(data["stage"]), item_id + " 超出当前设计层")
        for key in ("trigger", "observe", "failure_message"):
            require(text(item.get(key)), item_id + " 缺少 " + key)
        require(strings(item.get("expected"), True), item_id + " 缺少 expected")
        design_ids = item.get("design_ids")
        parents = item.get("parent_ids")
        require(strings(design_ids, True), item_id + " 缺少 design_ids")
        require(strings(parents), item_id + " 的 parent_ids 无效")
        require(len(set(parents)) == len(parents), item_id + " 重复父判据")
        for design_id in design_ids:
            require(design_id in designs, item_id + " 悬空设计引用：" + design_id)
        if level == "journey":
            require(not parents, item_id + " 的旅程判据不应有父判据")
        else:
            require(bool(parents), item_id + " 缺少父判据")
            for parent in parents:
                require(parent in oracles, item_id + " 悬空父判据：" + parent)
                parent_level = oracles[parent]["level"]
                if level == "point" and parent_level == "journey":
                    require(text(item.get("seam_not_applicable")), item_id + " 直连旅程需说明接缝不适用理由")
                else:
                    require(parent_level == LEVELS[LEVELS.index(level) - 1], item_id + " 父判据层级错误")
                require(LAYERS.index(oracles[parent]["introduced_at"]) <= LAYERS.index(introduced),
                        item_id + " 不能先于父判据建立")
        if item["status"] == "ready":
            expected_layers = {"journey": ("requirements",), "seam": ("architecture", "hld"),
                               "point": ("hld", "lld")}[level]
            require(any(designs[entry]["layer"] in expected_layers for entry in design_ids),
                    item_id + " 缺少本层设计依据")

    for test in data["tests"]:
        require(isinstance(test, dict), "测试条目必须是对象")
        test_id = test.get("id")
        require(text(test_id), "测试条目缺少 id")
        require(test_id not in test_ids and test_id not in items, "重复 ID：" + test_id)
        test_ids.add(test_id)
        require(test.get("level") in ("integration", "unit", "e2e"), test_id + " 的测试层无效")
        require(test.get("status") in ("pass", "fail", "skip", "blocked", "not_evaluated"),
                test_id + " 的测试结果无效")
        require(strings(test.get("oracle_ids"), True), test_id + " 缺少验证判据")
        for oracle_id in test["oracle_ids"]:
            require(oracle_id in oracles, test_id + " 悬空判据引用：" + oracle_id)
        if test["status"] in ("pass", "fail"):
            for key in ("command", "evidence", "baseline", "environment", "executed_at"):
                require(text(test.get(key)), test_id + " 的运行结果缺少 " + key)
            require(test["baseline"] == data["baseline"], test_id + " 的运行结果不属于当前代码基线")
    return items


def fingerprints(items):
    result = {}

    def visit(item_id):
        if item_id not in result:
            item = items[item_id]
            parents = item.get("depends_on", []) + item.get("design_ids", []) + item.get("parent_ids", [])
            dependencies = {parent: visit(parent) for parent in sorted(set(parents))}
            result[item_id] = digest({"item": item, "dependencies": dependencies})
        return result[item_id]

    for item_id in items:
        visit(item_id)
    return result


def load_decisions(path, items, hashes):
    if path is None:
        return {}, {}
    data = load_json(path)
    require(isinstance(data, dict) and data.get("skill_version") == "a01", "审核记录的 skill_version 必须是 a01")
    require(isinstance(data.get("items"), list), "审核记录的 items 必须是数组")
    current = {}
    stale = {}
    seen = set()
    for entry in data["items"]:
        require(isinstance(entry, dict), "审核结论必须是对象")
        item_id = entry.get("id")
        require(text(item_id) and item_id not in seen, "审核记录 ID 缺失或重复")
        seen.add(item_id)
        require(entry.get("decision") in ("pending", "accepted", "changes_requested"), item_id + " 审核结论无效")
        require(text(entry.get("content_sha256")), item_id + " 缺少审核对象摘要")
        require(isinstance(entry.get("note", ""), str), item_id + " 的审核意见必须是字符串")
        if entry["decision"] != "pending":
            require(text(entry.get("reviewer")) and text(entry.get("reviewed_at")), item_id + " 缺少人工审查人或时间")
        if item_id not in items or entry["content_sha256"] != hashes[item_id]:
            stale[item_id] = entry
        else:
            require(entry["decision"] != "accepted" or items[item_id]["status"] == "ready",
                    item_id + " 草稿或阻塞条目不能被记录为接受")
            current[item_id] = entry
    return current, stale


def escaped(value):
    return html.escape(str(value), quote=True)


def linked(ids):
    return " ".join('<a class="chip" href="#item-' + escaped(item_id) + '">' + escaped(item_id) + '</a>'
                    for item_id in ids) or '<span class="muted">无</span>'


def bullet_list(values):
    return "<ul>" + "".join("<li>" + escaped(value) + "</li>" for value in values) + "</ul>"


def review_form(item, state, entry):
    options = []
    for decision in ("pending", "accepted", "changes_requested"):
        selected = " selected" if decision == (state if state != "stale" else "pending") else ""
        disabled = " disabled" if decision == "accepted" and item["status"] != "ready" else ""
        options.append('<option value="' + decision + '"' + selected + disabled + '>' + LABELS[decision] + '</option>')
    previous = ""
    if entry.get("reviewer"):
        previous = '<p class="muted">已有记录：' + escaped(entry["reviewer"]) + " · " + escaped(entry["reviewed_at"]) + '</p>'
    return ('<div class="review-form"><label>人工结论<select class="decision">' + "".join(options)
            + '</select></label><label>审核意见<textarea class="note" rows="2" placeholder="指出问题或记录接受依据">'
            + escaped(entry.get("note", "")) + '</textarea></label>' + previous + '</div>')


def render(data, items, hashes, current, stale):
    cards = []
    for item in data["design"] + data["oracles"]:
        item_id = item["id"]
        kind = item.get("layer", item.get("level"))
        state = current.get(item_id, {}).get("decision", "stale" if item_id in stale else "pending")
        entry = current.get(item_id, stale.get(item_id, {}))
        body = ""
        if "layer" in item:
            body += bullet_list(item["content"])
            body += '<p>上层设计：' + linked(item["depends_on"]) + '</p>'
        else:
            body += '<dl>' + ''.join('<dt>' + label + '</dt><dd>' + escaped(item[key]) + '</dd>'
                                    for key, label in (("trigger", "触发与前置"), ("observe", "可观测点"))) + '</dl>'
            body += '<h4>期望</h4>' + bullet_list(item["expected"])
            body += '<p><strong>失败信息：</strong>' + escaped(item["failure_message"]) + '</p>'
            body += '<p>父判据：' + linked(item["parent_ids"]) + '</p><p>设计依据：' + linked(item["design_ids"]) + '</p>'
            if item.get("seam_not_applicable"):
                body += '<p>接缝不适用：' + escaped(item["seam_not_applicable"]) + '</p>'
        body += '<details><summary>事实来源</summary>' + bullet_list(item["sources"]) + '</details>'
        cards.append('<article class="card" id="item-' + escaped(item_id) + '" data-id="' + escaped(item_id)
                     + '" data-kind="' + kind + '" data-review="' + state + '"><div class="card-top"><span>'
                     + LABELS[kind] + '</span><span class="badge ' + state + '">' + LABELS[state]
                     + '</span></div><h3>' + escaped(item["title"]) + '</h3><p class="muted">'
                     + escaped(item_id) + ' · ' + LABELS[item["status"]] + '</p>' + body
                     + review_form(item, state, entry) + '</article>')

    design_chain = ''.join('<div><strong>' + LABELS[layer] + '</strong><p>'
                           + linked([entry["id"] for entry in data["design"] if entry["layer"] == layer]) + '</p></div>'
                           for layer in LAYERS)
    oracle_chain = ''
    for journey in [entry for entry in data["oracles"] if entry["level"] == "journey"]:
        oracle_chain += '<div class="journey"><strong>旅程</strong> ' + linked([journey["id"]])
        seams = [entry for entry in data["oracles"] if entry["level"] == "seam" and journey["id"] in entry["parent_ids"]]
        for seam in seams:
            points = [entry["id"] for entry in data["oracles"] if entry["level"] == "point" and seam["id"] in entry["parent_ids"]]
            oracle_chain += '<div class="seam">接缝 ' + linked([seam["id"]]) + '<div class="points">单点 ' + linked(points) + '</div></div>'
        direct_points = [entry["id"] for entry in data["oracles"] if entry["level"] == "point" and journey["id"] in entry["parent_ids"]]
        if direct_points:
            oracle_chain += '<div class="seam">接缝不适用 → 单点 ' + linked(direct_points) + '</div>'
        if not seams and not direct_points:
            oracle_chain += '<p class="muted">本层尚未分解接缝与单点。</p>'
        oracle_chain += '</div>'

    test_rows = ''
    for test in data["tests"]:
        evidence = [test.get(key, "") for key in ("command", "environment", "executed_at", "baseline", "evidence")]
        test_rows += '<tr><td>' + escaped(test["id"]) + '<br>' + LABELS[test["level"]] + '</td><td>' + linked(test["oracle_ids"])
        test_rows += '</td><td><span class="badge ' + test["status"] + '">' + LABELS[test["status"]] + '</span></td>'
        test_rows += '<td>' + '<br>'.join(escaped(value) for value in evidence if value) + '</td></tr>'
    if not test_rows:
        test_rows = '<tr><td colspan="4">尚无测试结果；不表示测试通过。</td></tr>'
    questions = bullet_list(data["open_questions"]) if data["open_questions"] else '<p>快照未登记未决项；仍需人工检查。</p>'
    counts = {"accepted": 0, "pending": 0, "stale": 0, "changes_requested": 0}
    for item_id in items:
        state = current.get(item_id, {}).get("decision", "stale" if item_id in stale else "pending")
        counts[state] += 1
    summary = ' · '.join(LABELS[state] + ' ' + str(count) for state, count in counts.items())
    payload = json.dumps({"hashes": hashes, "current": current, "baseline": data["baseline"],
                          "snapshot_sha256": digest(data), "ids": list(items)}, ensure_ascii=False).replace("<", "\\u003c")
    template = (Path(__file__).resolve().parent.parent / "assets" / "review.html").read_text(encoding="utf-8")
    replacements = {"TITLE": escaped(data["title"]), "SCOPE": escaped(data["scope"]), "BASELINE": escaped(data["baseline"]),
                    "STAGE": LABELS[data["stage"]], "SUMMARY": summary, "DESIGN_CHAIN": design_chain,
                    "ORACLE_CHAIN": oracle_chain or '<p>尚未建立旅程判据。</p>', "CARDS": ''.join(cards),
                    "QUESTIONS": questions, "TEST_ROWS": test_rows, "PAYLOAD": payload}
    return re.sub(r"@@([A-Z_]+)@@", lambda match: replacements[match.group(1)], template)


def main():
    parser = argparse.ArgumentParser(description="A01 本地人工审核网页：结构检查不代表人工接受或开发完成。")
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--output", type=Path, help="生成独立 HTML 文件")
    parser.add_argument("--decisions", type=Path, help="回读真实人工导出的审核记录")
    parser.add_argument("--check", action="store_true", help="检查快照结构与引用")
    parser.add_argument("--require-reviewed", action="store_true", help="要求本快照所有条目就绪且具有有效人工接受记录")
    args = parser.parse_args()
    if not args.output and not args.check and not args.require_reviewed:
        parser.error("至少指定 --output、--check 或 --require-reviewed")
    try:
        data = load_json(args.snapshot)
        items = validate_snapshot(data)
        hashes = fingerprints(items)
        current, stale = load_decisions(args.decisions, items, hashes)
        if args.output:
            protected = [args.snapshot, args.decisions, Path(__file__).resolve(),
                         Path(__file__).resolve().parent.parent / "assets" / "review.html"]
            require(all(path is None or (args.output.resolve() != path.resolve()
                        and not (args.output.exists() and path.exists() and args.output.samefile(path)))
                        for path in protected),
                    "HTML 输出不能覆盖输入快照、审核记录或工具文件")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(render(data, items, hashes, current, stale), encoding="utf-8")
            print("已生成人工审核网页：" + str(args.output))
        print("结构检查通过；不表示人工接受、测试通过或开发完成。")
        print("条目：" + str(len(items)) + "；过期/已移除对象的审核记录：" + str(len(stale)))
        if args.require_reviewed:
            pending = [item_id for item_id, item in items.items() if item["status"] != "ready"
                       or current.get(item_id, {}).get("decision") != "accepted"]
            if pending or data["open_questions"]:
                print("人工审核未通过：" + ', '.join(pending) + ("；存在未决项" if data["open_questions"] else ""), file=sys.stderr)
                return 1
            print("本快照条目均有有效人工接受记录；测试与开发完成条件仍需核验。")
        return 0
    except (ValueError, OSError, TypeError, KeyError, RecursionError) as error:
        print("A01 检查失败：" + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
