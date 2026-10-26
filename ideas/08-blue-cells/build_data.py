#!/usr/bin/env python3
"""Derive this idea's small data files from a Skyhook checkout (README "Data" has the details).

    python3 ideas/08-blue-cells/build_data.py [/home/user/skyhook]

Writes only inside ideas/08-blue-cells/:
  snapshots/ladder_rows.json   _LADDER_ROWS, SCENARIOS and the column letters, read out of
                               finance/skyhook_finance.py with ast (never retyped), plus a sidecar.
  snapshots/DECISION_LOG.md    docs/DECISION_LOG.md lines 45-57 (items 6-8) verbatim, every other
                               line empty so file:line matches; plus a sidecar.
  fixtures/shuffled_assumptions.xlsx           Assumptions rows 5 and 10 swapped, chart removed.
  fixtures/recalculated_by_libreoffice.xlsx    chart removed, re-saved by soffice (when on PATH).
  fixtures/pre_fix_7bb5b5f.xlsx                blob 46bc02e, from the checkout or a read-only
                                               `gh api` GET; written only if the bytes hash to it.
The three raw snapshots are taken with tools/snapshot.mjs (README "Data"), never by this script.
"""
import ast
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.abspath(os.path.join(HERE, "..", ".."))
SNAPSHOT = os.path.join(BANK, "tools", "snapshot.mjs")
SNAPS = os.path.join(HERE, "snapshots")
FIXTURES = os.path.join(HERE, "fixtures")

FINANCE_PY = "finance/skyhook_finance.py"
DECISION_LOG = "docs/DECISION_LOG.md"
DECISION_LOG_LINES = (45, 57)

# The pre-fix workbook: GitHub's blob id for the path at 7bb5b5f (and at e0ff4d8, 800e58f).
PRE_FIX_BLOB = "46bc02ed26367805f0e920b00a52de9098e42613"
PRE_FIX_COMMIT = "7bb5b5f"
PRE_FIX_PATH = "tools/financial/skyhook_financial_model.xlsx"
GITHUB_REPO = "hudsonclavin-cloud/skyhook"
CHART_PARTS = ("xl/media/", "xl/drawings/", "xl/worksheets/_rels/sheet5.xml.rels")


def git_blob_id(data: bytes) -> str:
    """The id git gives a blob: sha1 of 'blob <length>\\0' followed by the bytes."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def sidecar(repo, rel, dest, note):
    r = subprocess.run(["node", SNAPSHOT, repo, rel, dest, "--sidecar-only", "--note", note],
                       capture_output=True, text=True)
    sys.stdout.write(r.stdout + r.stderr)
    if r.returncode != 0:
        raise SystemExit(r.returncode)


def read_rows_map(repo):
    """_LADDER_ROWS, SCENARIOS and load_ladder_from_workbook's `cols`, by ast, with line numbers."""
    path = os.path.join(repo, FINANCE_PY)
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    tree = ast.parse(src)
    out = {"source": FINANCE_PY, "lines": {}, "rows": None, "scenarios": None, "columns": None,
           "sheet": None}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name == "_LADDER_ROWS":
                out["rows"] = ast.literal_eval(node.value)
                out["lines"]["_LADDER_ROWS"] = [node.lineno, node.end_lineno]
            elif name == "SCENARIOS":
                out["scenarios"] = list(ast.literal_eval(node.value))
                out["lines"]["SCENARIOS"] = [node.lineno, node.end_lineno]
        if isinstance(node, ast.FunctionDef) and node.name == "load_ladder_from_workbook":
            for sub in ast.walk(node):
                if isinstance(sub, ast.Assign) and len(sub.targets) == 1 \
                        and isinstance(sub.targets[0], ast.Name) and sub.targets[0].id == "cols":
                    out["columns"] = ast.literal_eval(sub.value)
                    out["lines"]["cols"] = [sub.lineno, sub.end_lineno]
                if isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Name) \
                        and sub.value.id == "wb" and isinstance(sub.slice, ast.Constant):
                    out["sheet"] = sub.slice.value
                    out["lines"]["sheet"] = [sub.lineno, sub.lineno]
    missing = [k for k in ("rows", "scenarios", "columns", "sheet") if out[k] is None]
    if missing:
        raise SystemExit(f"could not read {missing} from {FINANCE_PY}")
    if set(out["columns"]) != set(out["scenarios"]):
        raise SystemExit("SCENARIOS and the cols map disagree in skyhook_finance.py")
    return out


def excerpt(text, first, last):
    lines = text.split("\n")
    out = [(ln if first <= i + 1 <= last else "") for i, ln in enumerate(lines[:last])]
    return "\n".join(out) + "\n"


def swap_rows(sheet_xml, a, b):
    """Swap two <row> elements' positions and cell references (r="5" / r="B5")."""
    def retag(block, old, new):
        block = re.sub(r'(<row r=")%d(")' % old, r'\g<1>%d\2' % new, block, count=1)
        return re.sub(r'(<c r="[A-Z]+)%d(")' % old, r'\g<1>%d\2' % new, block)

    rows = {}
    for m in re.finditer(r'<row r="(\d+)"[^>]*>.*?</row>', sheet_xml, flags=re.S):
        rows[int(m.group(1))] = m.group(0)
    if a not in rows or b not in rows:
        raise SystemExit(f"rows {a} and {b} must both exist in the sheet")
    ra, rb = retag(rows[a], a, b), retag(rows[b], b, a)
    marker_a, marker_b = "\0A\0", "\0B\0"
    xml = sheet_xml.replace(rows[a], marker_a).replace(rows[b], marker_b)
    return xml.replace(marker_a, rb).replace(marker_b, ra)


def without_chart(src_xlsx, dest, swap=None):
    """The workbook without chart parts (rows swap=(a, b) exchanged); returns the byte count."""
    with zipfile.ZipFile(src_xlsx) as zin:
        names = zin.namelist()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for name in names:
                if name.startswith(CHART_PARTS):
                    continue
                data = zin.read(name)
                if name == "xl/worksheets/sheet2.xml" and swap:
                    data = swap_rows(data.decode("utf-8"), *swap).encode("utf-8")
                elif name == "xl/worksheets/sheet5.xml":
                    data = re.sub(rb'<drawing [^>]*/>', b"", data)
                elif name == "[Content_Types].xml":
                    data = re.sub(rb'<Override[^>]*(drawing|image|png)[^>]*/>', b"", data)
                    data = re.sub(rb'<Default Extension="png"[^>]*/>', b"", data)
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                zout.writestr(info, data)
    with open(dest, "wb") as fh:
        fh.write(buf.getvalue())
    return len(buf.getvalue())


def recalculate_with_libreoffice(src_xlsx, dest):
    """Open and re-save the workbook (chart removed) with headless LibreOffice so every formula gets
    a cached value. Returns the byte count, or None when soffice is not installed or it fails."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src_dir, out_dir = os.path.join(tmp, "in"), os.path.join(tmp, "out")
        os.makedirs(src_dir)
        os.makedirs(out_dir)
        staged = os.path.join(src_dir, os.path.basename(src_xlsx))
        without_chart(src_xlsx, staged)
        r = subprocess.run([soffice, "--headless", "--norestore", "--convert-to", "xlsx:Calc MS Excel 2007 XML",
                            "--outdir", out_dir, staged], capture_output=True, text=True, timeout=300,
                           env=dict(os.environ, HOME=tmp))
        produced = os.path.join(out_dir, os.path.basename(src_xlsx))
        if r.returncode != 0 or not os.path.exists(produced):
            sys.stderr.write(f"libreoffice conversion failed: {r.stderr.strip()[:300]}\n")
            return None
        shutil.copy(produced, dest)
        return os.path.getsize(dest)


def fetch_pre_fix(repo, dest):
    """The pre-fix workbook from the checkout, else a read-only GitHub GET; written only if the
    bytes hash to PRE_FIX_BLOB. Returns where it came from, or None."""
    data, source = None, None
    r = subprocess.run(["git", "-C", repo, "cat-file", "blob", PRE_FIX_BLOB], capture_output=True)
    if r.returncode == 0:
        data, source = r.stdout, f"git cat-file blob {PRE_FIX_BLOB[:7]} in {repo}"
    elif shutil.which("gh"):
        r = subprocess.run(["gh", "api", "-H", "Accept: application/vnd.github.raw",
                            f"repos/{GITHUB_REPO}/contents/{PRE_FIX_PATH}?ref={PRE_FIX_COMMIT}"],
                           capture_output=True, timeout=120)
        if r.returncode == 0:
            data, source = r.stdout, f"gh api repos/{GITHUB_REPO}/contents/{PRE_FIX_PATH}?ref={PRE_FIX_COMMIT}"
    if data is None:
        return None
    if git_blob_id(data) != PRE_FIX_BLOB:
        sys.stderr.write(f"pre-fix workbook from {source} hashes to {git_blob_id(data)}, not {PRE_FIX_BLOB}; not written\n")
        return None
    with open(dest, "wb") as fh:
        fh.write(data)
    return source


def main(argv):
    repo = os.path.abspath(argv[1]) if len(argv) > 1 else "/home/user/skyhook"
    if not os.path.isdir(os.path.join(repo, ".git")):
        sys.stderr.write(f"usage: build_data.py <skyhook-checkout>  ({repo} is not a git checkout)\n")
        return 2
    os.makedirs(SNAPS, exist_ok=True)
    os.makedirs(FIXTURES, exist_ok=True)

    rows_map = read_rows_map(repo)
    dest = os.path.join(SNAPS, "ladder_rows.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(rows_map, fh, indent=1)
        fh.write("\n")
    ln = rows_map["lines"]
    sidecar(repo, FINANCE_PY, dest,
            "derived by build_data.py with the ast module: _LADDER_ROWS (lines %d-%d), SCENARIOS (line %d), "
            "the cols map (line %d) and the sheet name (line %d) of load_ladder_from_workbook; nothing retyped"
            % (ln["_LADDER_ROWS"][0], ln["_LADDER_ROWS"][1], ln["SCENARIOS"][0], ln["cols"][0], ln["sheet"][0]))

    with open(os.path.join(repo, DECISION_LOG), encoding="utf-8") as fh:
        log_text = fh.read()
    dest = os.path.join(SNAPS, "DECISION_LOG.md")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(excerpt(log_text, *DECISION_LOG_LINES))
    sidecar(repo, DECISION_LOG, dest,
            "derived by build_data.py: lines %d-%d (items 6-8: the workbook ladder fix and its 'post-fix workbook "
            "results' at :47, item 7's '$2,500/kg (workbook Assumptions B5)' at :51, item 8's conservative "
            "NPV@10%% at :57) copied verbatim, every other line left empty so line numbers match the source"
            % DECISION_LOG_LINES)

    src_xlsx = os.path.join(SNAPS, "skyhook_financial_model.xlsx")
    if not os.path.exists(src_xlsx):
        sys.stderr.write("take snapshots/skyhook_financial_model.xlsx with tools/snapshot.mjs first (see README)\n")
        return 2
    n = without_chart(src_xlsx, os.path.join(FIXTURES, "shuffled_assumptions.xlsx"), swap=(5, 10))
    print(f"fixture  fixtures/shuffled_assumptions.xlsx  ({n} bytes; Assumptions rows 5 and 10 swapped, chart removed)")
    lo = os.path.join(FIXTURES, "recalculated_by_libreoffice.xlsx")
    n = recalculate_with_libreoffice(src_xlsx, lo)
    if n is None:
        print("fixture  fixtures/recalculated_by_libreoffice.xlsx  not rewritten (soffice not available); "
              + ("the committed copy stands" if os.path.exists(lo) else "MISSING"))
    else:
        print(f"fixture  fixtures/recalculated_by_libreoffice.xlsx  ({n} bytes; chart removed, re-saved by headless "
              "LibreOffice, every formula now carries a cached result)")
    pre = os.path.join(FIXTURES, f"pre_fix_{PRE_FIX_COMMIT}.xlsx")
    source = fetch_pre_fix(repo, pre)
    if source is None:
        print(f"fixture  fixtures/pre_fix_{PRE_FIX_COMMIT}.xlsx  not rewritten (blob {PRE_FIX_BLOB[:7]} not in the "
              "checkout and gh unavailable); " + ("the committed copy stands" if os.path.exists(pre) else "MISSING"))
    else:
        print(f"fixture  fixtures/pre_fix_{PRE_FIX_COMMIT}.xlsx  ({os.path.getsize(pre)} bytes, blob {PRE_FIX_BLOB[:7]}, "
              f"from {source})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
