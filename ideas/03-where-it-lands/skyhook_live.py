#!/usr/bin/env python3
"""
skyhook_live.py -- run Skyhook's own finance model from a checkout, read-only, so the
live-checkout tests in model.test.mjs can hold this page's readings to the model itself
rather than only to the grid it reads.

    python3 -B -I ideas/03-where-it-lands/skyhook_live.py [--skyhook DIR] cells '<json>'
        <json> is a list of [tier, column, launch_per_kg]; prints a JSON list of
        finance.export_grid.compute_cell(...) results, one per request, in order.

    python3 -B -I ideas/03-where-it-lands/skyhook_live.py [--skyhook DIR] rebuild
        rebuilds the whole grid IN MEMORY with finance.export_grid.build_export() and
        compares it, point by point and field by field, with the grid embedded in
        snapshots/decision_grid.js; prints the counts as JSON.

Nothing is written anywhere: bytecode writing is switched off before Skyhook's modules are
imported (and -B does the same from the command line), build_export() does no file I/O
(its docstring: "no file I/O -- main() handles the atomic write"), and the workbook is read
by Skyhook's own openpyxl path in read-only mode.

Exit status: 0 on success; 2 when the checkout or a dependency (openpyxl) is missing, so
the caller can skip; 1 on any other failure.
"""
import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import json  # noqa: E402
from pathlib import Path  # noqa: E402

HERE = Path(__file__).resolve().parent
GRID_JS = HERE / "snapshots" / "decision_grid.js"
SKIP_META = {"points", "generated_at", "git_commit"}  # a rebuild stamps its own time and HEAD


def embedded_grid() -> dict:
    text = GRID_JS.read_text(encoding="utf-8")
    a = text.index("/*<json>*/") + len("/*<json>*/")
    b = text.index("/*</json>*/")
    return json.loads(text[a:b])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skyhook", default="/home/user/skyhook", help="path to the Skyhook checkout")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cells", help="compute_cell for a JSON list of [tier, column, launch]")
    c.add_argument("requests")
    sub.add_parser("rebuild", help="rebuild the grid in memory and diff it against the snapshot")
    a = ap.parse_args()

    repo = Path(a.skyhook).resolve()
    if not (repo / "finance" / "export_grid.py").is_file():
        print(json.dumps({"skip": f"no Skyhook checkout at {repo}"}))
        return 2
    sys.path.insert(0, str(repo))
    try:
        from finance.export_grid import build_export, compute_cell
        from finance.skyhook_finance import load_ladder_from_workbook
        ladder = load_ladder_from_workbook()
    except ImportError as e:  # openpyxl absent, or the module moved
        print(json.dumps({"skip": f"cannot import Skyhook's finance model: {e}"}))
        return 2

    if a.cmd == "cells":
        reqs = json.loads(a.requests)
        out = [compute_cell(ladder, t, col, float(L)) for t, col, L in reqs]
        print(json.dumps(out))
        return 0

    rebuilt = build_export()
    committed = embedded_grid()
    key = lambda p: (p["tier"], p["column"], p["construction_launch_per_kg"])  # noqa: E731
    rb = {key(p): p for p in rebuilt["points"]}
    field_diffs = []
    missing = 0
    for p in committed["points"]:
        q = rb.get(key(p))
        if q is None:
            missing += 1
            continue
        for k, v in p.items():
            if q.get(k) != v:
                field_diffs.append([*key(p), k, v, q.get(k)])
    meta_diffs = sorted(k for k in set(committed) | set(rebuilt)
                        if k not in SKIP_META and committed.get(k) != rebuilt.get(k))
    print(json.dumps({
        "rebuilt_points": len(rebuilt["points"]),
        "committed_points": len(committed["points"]),
        "missing_points": missing,
        "field_diffs": len(field_diffs),
        "first_diffs": field_diffs[:5],
        "meta_diffs": meta_diffs,
        "rev_a_md5_equal": rebuilt["rev_a_md5"] == committed["rev_a_md5"],
        "workbook_md5_equal": rebuilt["workbook_md5"] == committed["workbook_md5"],
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # report, do not hide
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
