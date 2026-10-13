#!/usr/bin/env python3
"""审核快照是否还跟得上判据。

快照与审核网页都是投影。判据改了而快照没重建，网页就会显示过期内容，
而没有任何东西会报错。这个检查把投影与它的来源绑在一起。

只比判据正文，也就是 design 与 oracles 两类条目。tests 条目带运行证据
（基线、执行时刻、环境），每次重建都会变；比它会把「加了一个用例」
也判成漂移，那不是本检查要管的事。
"""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
LAYERS = ("requirements", "architecture", "hld", "lld")
GENERATOR = "scripts/a01-review-snapshot.py"


def main():
    baseline = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
        capture_output=True, text=True, check=True).stdout.strip()

    drifted = []
    with tempfile.TemporaryDirectory() as tmp:
        for layer in LAYERS:
            out = pathlib.Path(tmp) / f"{layer}.json"
            proc = subprocess.run(
                [sys.executable, str(ROOT / GENERATOR),
                 "--stage", layer, "--baseline", baseline, "--out", str(out)],
                cwd=ROOT, capture_output=True, text=True)
            if proc.returncode != 0:
                print(f"重建 {layer} 快照失败：")
                print(proc.stderr.strip()[:400])
                return 1
            fresh = json.loads(out.read_text(encoding="utf-8"))
            committed = json.loads(
                (ROOT / "docs" / "review" / layer / "snapshot.json")
                .read_text(encoding="utf-8"))
            for key in ("design", "oracles"):
                old = {item["id"]: item for item in committed[key]}
                new = {item["id"]: item for item in fresh[key]}
                for item_id in sorted(set(old) | set(new)):
                    if old.get(item_id) != new.get(item_id):
                        drifted.append(f"{layer}/{key}/{item_id}")

    if drifted:
        print("审核快照与判据不一致。跑 scripts/a01-review-pages.sh，并提交生成物。")
        for entry in drifted[:40]:
            print("  -", entry)
        if len(drifted) > 40:
            print(f"  …… 另有 {len(drifted) - 40} 条")
        return 1
    print("审核快照与判据一致。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
