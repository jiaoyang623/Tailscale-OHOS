#!/usr/bin/env python3
"""E2E 文件里用到的公共件，是不是都有来源。

这一类错误 `node --check` 抓不到：语法是合法的，只有真跑到那一行才抛
`X is not defined`，而那时设备已经跑了几十秒。2026-10-13 立的 E2E 层里
一次就出了两处（`headless-connect.mjs` 用了 assert 没 import、
`taildrop-receive.mjs` 用了 swipeUp 没 import），所以补这道静态检查。

「有来源」包含三种，缺一不可判：
  1. 从 `./lib/device.mjs` 具名 import；
  2. 文件自己定义（有些文件为了自足，本地也写了一份同名函数）；
  3. 从别处 import（含 `import assert from 'node:assert/strict'` 这种默认导入）。

扫之前先把注释与字符串去掉，免得注释里提到一个名字就判成用了。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
E2E = ROOT / "scripts/e2e"
LIB = E2E / "lib/device.mjs"

EXPORT = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)
# import {a, b as c} from '...' / import X from '...' / import X, {a} from '...'
NAMED_IMPORT = re.compile(r"import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}", re.DOTALL)
DEFAULT_IMPORT = re.compile(r"import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)", re.DOTALL)
LOCAL_DEF = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE)

LINE_COMMENT = re.compile(r"//[^\n]*")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
STRING = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", re.DOTALL)


def strip_noise(text):
    text = BLOCK_COMMENT.sub(" ", text)
    text = LINE_COMMENT.sub(" ", text)
    return STRING.sub("''", text)


def names_in(group):
    return {name.strip().split(" as ")[-1].strip() for name in group.split(",") if name.strip()}


def main():
    exports = set(EXPORT.findall(LIB.read_text(encoding="utf-8")))
    if not exports:
        print("读不出 lib/device.mjs 的导出名，检查解析规则是否失效。")
        return 1

    files = sorted(p for p in E2E.glob("*.mjs"))
    problems = []
    for path in files:
        raw = path.read_text(encoding="utf-8")
        # 从 import 之后的正文开始扫，否则 import 行自己就带着这些名字。
        first_import = raw.find("\nimport ")
        body_start = raw.rfind("\nimport ") if first_import >= 0 else len(raw)
        # 取最后一个 import 语句的结尾
        last = 0
        for match in re.finditer(r"^import[\s\S]*?from\s*'[^']*';?\s*$", raw, re.MULTILINE):
            last = max(last, match.end())
        body = strip_noise(raw[last:])

        available = set()
        for group in NAMED_IMPORT.finditer(raw):
            available |= names_in(group.group(1))
        for match in DEFAULT_IMPORT.finditer(raw):
            available.add(match.group(1))
        available |= set(LOCAL_DEF.findall(body))

        missing = sorted(name for name in exports
                         if name not in available and re.search(rf"\b{re.escape(name)}\b", body))
        if missing:
            problems.append(f"{path.name}：用了没来源的 {', '.join(missing)}")
        if "assert" not in available and re.search(r"\bassert\.", body):
            problems.append(f"{path.name}：用了 assert 没 import")
        if re.search(r"\b__dirname\b|\b__filename\b", body):
            problems.append(f"{path.name}：用了 ESM 里不存在的 __dirname/__filename")

    if problems:
        print("E2E 文件的公共件来源有问题：")
        for problem in problems:
            print("  -", problem)
        return 1
    print(f"E2E 文件的公共件来源检查通过：{len(files)} 个文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
