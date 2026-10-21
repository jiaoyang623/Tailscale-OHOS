#!/usr/bin/env python3
"""核对判据声明的 E2E 用例是否真的写下来了。

a01 的完成条件里有一条：计划测试清单与实际执行清单要一致。判据正文的
「待建测试」行就是计划清单：它写明哪条判据由哪个文件的哪条用例来证。

判定分两级，因为两种缺法的含义不同：

  文件在，但里面找不到声明它的那条判据的 ID  → 判红。声明过的东西没落地，是不一致。
  文件整个还不存在                          → 只报告。这是 E2E 层的待办进度。

为什么按判据 ID 认，不按用例名逐字比：一条判据的场景常常要拆成好几条设备用例
（例如 O-CONN-02 拆成「有断开入口」「点了回到未连接」「请求先于完成」「释放长时任务」
「状态文件落地」）。逐字比会逼出人造的用例名。判据 ID 落在文件里是更强的约束：
用例改名、拆分、合并都不影响它，而「这条判据有没有人证」始终可查。
用例名逐字命中只作信息报告。

文件全部写完之后，「待建」一栏自然归零，这个门禁就变成完全强制。

用法：
  python3 scripts/check-e2e-plan.py            # 报告
  python3 scripts/check-e2e-plan.py --strict   # 待办也判红（交付前用）
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORACLES = ROOT / "docs" / "oracles"
E2E_DIR = ROOT / "scripts" / "e2e"

DECLARED = re.compile(r"\[E2E\]\s+(scripts/e2e/[A-Za-z0-9_-]+\.mjs)::([^；\n]+)")
# 判据小节标题：### O-DEV-01 浏览设备列表（含未登录与加载态）
HEADING = re.compile(r"^#+\s+(O-[A-Z0-9]+-\d+)\b")
TEST_CALL = re.compile(r"\btest\(")


def declared_cases():
    """收集判据声明的 (判据ID, 文件, 用例名, 判据所在文件)。"""
    found = []
    for path in sorted(ORACLES.rglob("*.md")):
        current = None
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            heading = HEADING.match(line)
            if heading:
                current = heading.group(1)
                continue
            for match in DECLARED.finditer(line):
                found.append((current, match.group(1), match.group(2).strip(), path, number))
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true",
                        help="文件还不存在的待办项也判红")
    args = parser.parse_args()

    entries = declared_cases()
    if not entries:
        print("判据里没有声明任何 E2E 用例，检查解析规则是否失效。")
        return 1

    no_file, no_oracle, no_test, name_hit = [], [], [], 0
    for oracle, rel, case, source, line in entries:
        target = ROOT / rel
        if not target.exists():
            no_file.append((oracle, rel, case))
            continue
        text = target.read_text(encoding="utf-8")
        if case in text:
            name_hit += 1
        if oracle and oracle not in text:
            no_oracle.append((oracle, rel, source, line))
        elif not oracle:
            no_oracle.append(("（判据小节没解析出 ID）", rel, source, line))
        if not TEST_CALL.search(text):
            no_test.append(rel)

    declared_files = {rel for _, rel, _, _, _ in entries}
    extra = sorted(p.name for p in E2E_DIR.glob("*.mjs")
                   if f"scripts/e2e/{p.name}" not in declared_files)

    total = len(entries)
    done = total - len(no_file) - len(no_oracle)
    print(f"判据声明的 E2E 用例 {total} 条：判据 ID 已落到文件里 {done}，"
          f"文件待建 {len(no_file)}，判据 ID 找不到 {len(no_oracle)}")
    print(f"其中用例名逐字命中的有 {name_hit} 条（只作参考，不作判定）")

    if no_oracle:
        print("\n判据 ID 在目标文件里找不到（判红）：这条判据没有可追的证。")
        seen = set()
        for oracle, rel, source, line in no_oracle:
            if (oracle, rel) in seen:
                continue
            seen.add((oracle, rel))
            print(f"  {rel} 里没有 {oracle}")
            print(f"    声明处 {source.relative_to(ROOT)}:{line}")

    if no_test:
        print("\n文件里没有任何 test(（判红）：")
        for rel in sorted(set(no_test)):
            print(f"  {rel}")

    label = "文件还不存在" + ("（--strict 下判红）：" if args.strict else "（只报告）：")
    if no_file:
        print(f"\n{label}")
        by_file = {}
        for _, rel, _ in no_file:
            by_file[rel] = by_file.get(rel, 0) + 1
        for rel in sorted(by_file):
            print(f"  {rel}（{by_file[rel]} 条）")

    if extra:
        print("\n未被判据引用的文件（额外证据，不算错误）：")
        for name in extra:
            print(f"  scripts/e2e/{name}")

    if no_oracle or no_test or (no_file and args.strict):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
