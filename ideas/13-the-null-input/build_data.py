#!/usr/bin/env python3
"""
build_data.py — derive the three data files this deposit needs from a Skyhook checkout,
with the Python 3 standard library only (no openpyxl).

    python3 ideas/13-the-null-input/build_data.py [/path/to/skyhook]      (default /home/user/skyhook)
    python3 ideas/13-the-null-input/build_data.py [/path/to/skyhook] --check   (exit 1 if a derived file is stale)

What it writes, and from what:

  snapshots/ladder.json   The three ladder columns (Conservative / Baseline / Optimistic) of the
                          workbook's 'Assumptions' sheet, tools/financial/skyhook_financial_model.xlsx,
                          read from the .xlsx zip directly (xl/workbook.xml -> sheet rel -> sheet XML).
                          The row map is the one finance/skyhook_finance.py uses (_LADDER_ROWS, rows
                          3-16, columns B/C/D), copied here with the same key names so a reader can
                          diff them. Column A's label and column E's "Source / note" are kept per row.
  snapshots/markers.json  The fiber prices the repository already carries, none a quote and none
                          EVER used as a default here, from three sources: the MP-001 Zylon
                          marketplace proxy (docs/research/mp001_market_pricing.md, the table row
                          beginning "| Zylon (PBO) marketplace proxy": 300 / 259 / 170),
                          finance/inspace_fork.py's FIBER_PRICE_BRACKET_PER_KG and
                          SURFACE_FIBER_PRICE_PER_KG (200 / 500 / 1,000), and
                          tools/sims/skyhook_no_leo_stress_test.jsx's fiberPriceKg default and its
                          conservative / optimistic presets (250; 400 / 150). Each marker records
                          file, the line of each price, the matched text and the commit.
                          (params/service_mxer_draft.json:34-39 repeats the inspace_fork bracket as
                          that script's written output; it is not a separate source.)
  data.js                 The page's data: the two snapshots above, the rev_a.json excerpt
                          (snapshots/rev_a.excerpt.json, made with the bank's snapshot.mjs), the
                          published anchors fiber_sweep.py gates on, and every sidecar's commit and
                          sha256. Classic script: window.NullInputData = {...}. The page fetches nothing.

After writing, record provenance for the two derived snapshots with the bank's tool:
  node tools/snapshot.mjs <repo> tools/financial/skyhook_financial_model.xlsx \
       ideas/13-the-null-input/snapshots/ladder.json --sidecar-only --note "derived by build_data.py: ..."
  node tools/snapshot.mjs <repo> finance/inspace_fork.py \
       ideas/13-the-null-input/snapshots/markers.json --sidecar-only --note "derived by build_data.py: ..."
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAP = HERE / "snapshots"

# The workbook cell map of finance/skyhook_finance.py (_LADDER_ROWS), Assumptions sheet, rows 3-16.
LADDER_ROWS = {
    "strength_retention": 3,
    "ascent_losses_ms": 4,
    "construction_launch_per_kg": 5,
    "power_chain_efficiency": 6,
    "electricity_per_kwh": 7,
    "ops_wear_per_kg": 8,
    "hardware_mass_factor": 9,
    "customer_price_per_kg": 10,
    "catches_per_day": 11,
    "payload_kg": 12,
    "revenue_ramp_y1": 13,
    "fixed_ops_M": 14,
    "tip_speed_kms": 15,
    "program_fleet_capex_M": 16,
}
COLUMNS = {"Conservative": "B", "Baseline": "C", "Optimistic": "D"}
WORKBOOK = "tools/financial/skyhook_financial_model.xlsx"
SHEET = "Assumptions"

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def git(repo: Path, *args: str) -> str | None:
    try:
        return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


# ── xlsx, standard library ───────────────────────────────────────────────────────

def read_sheet_cells(xlsx: Path, sheet_name: str) -> dict[str, object]:
    """Return {cell_ref: value} for one worksheet. Numbers -> float, shared strings -> str,
    inline strings -> str. Formulas are returned by their cached value (none here: the
    Assumptions sheet is literal inputs)."""
    with zipfile.ZipFile(xlsx) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rid = None
        for sh in wb.find("m:sheets", NS):
            if sh.get("name") == sheet_name:
                rid = sh.get(f"{{{NS['r']}}}id")
        if rid is None:
            raise KeyError(f"no sheet named {sheet_name!r} in {xlsx}")
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target")
        if target is None:
            raise KeyError(f"no relationship {rid} in workbook.xml.rels")
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        cells: dict[str, object] = {}
        for c in ET.fromstring(z.read(target)).iter(f"{{{NS['m']}}}c"):
            ref = c.get("r")
            t = c.get("t")
            v = c.find("m:v", NS)
            if t == "s" and v is not None:
                cells[ref] = shared[int(v.text)]
            elif t == "inlineStr":
                cells[ref] = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
            elif v is not None and v.text is not None:
                try:
                    cells[ref] = float(v.text)
                except ValueError:
                    cells[ref] = v.text
        return cells


def derive_ladder(repo: Path) -> dict:
    cells = read_sheet_cells(repo / WORKBOOK, SHEET)
    columns = {}
    for name, col in COLUMNS.items():
        vals = {}
        for key, row in LADDER_ROWS.items():
            v = cells.get(f"{col}{row}")
            if not isinstance(v, float):
                raise ValueError(f"{SHEET}!{col}{row} ({key}) is not numeric: {v!r}")
            vals[key] = v
        columns[name] = vals
    rows = {
        key: {"row": row, "label": cells.get(f"A{row}"), "source_note": cells.get(f"E{row}")}
        for key, row in LADDER_ROWS.items()
    }
    xlsx_bytes = (repo / WORKBOOK).read_bytes()
    return {
        "_meta": {
            "source": WORKBOOK,
            "sheet": SHEET,
            "sheet_title": cells.get("A1"),
            "columns": COLUMNS,
            "row_map_from": "finance/skyhook_finance.py _LADDER_ROWS (rows 3-16 of the Assumptions sheet)",
            "commit": git(repo, "rev-parse", "HEAD"),
            "xlsx_sha256": sha256(xlsx_bytes),
            "derived_by": "ideas/13-the-null-input/build_data.py (zipfile + ElementTree; no openpyxl)",
        },
        "rows": rows,
        "columns": columns,
    }


# ── the three markers ────────────────────────────────────────────────────────────

def find_line(text: str, pattern: str) -> tuple[int, str]:
    for i, line in enumerate(text.splitlines(), start=1):
        if re.search(pattern, line):
            return i, line
    raise LookupError(f"pattern {pattern!r} not found")


def derive_markers(repo: Path) -> dict:
    commit = git(repo, "rev-parse", "HEAD")
    markers = []

    p = "docs/research/mp001_market_pricing.md"
    n, line = find_line((repo / p).read_text(encoding="utf-8"), r"^\|\s*Zylon \(PBO\) marketplace proxy")
    cols = [c.strip() for c in line.strip().strip("|").split("|")]
    # | Input | Cons | Base | Opt | Unit | Source class |
    markers.append({
        "id": "mp001_marketplace_proxy",
        "label": "MP-001 Zylon (PBO) marketplace proxy",
        "short": "MP-001",
        "prices_per_kg": {"conservative": float(cols[1]), "baseline": float(cols[2]), "optimistic": float(cols[3])},
        "unit": cols[4],
        "source_class": cols[5],
        "qualifier": cols[0],
        "file": p, "line": n, "text": line.strip(), "commit": commit,
        "status": "marketplace listing, low confidence, 10 kg MOQ, not a Toyobo quote (the row's own words); a marker, never a default",
    })

    p = "finance/inspace_fork.py"
    text = (repo / p).read_text(encoding="utf-8")
    nb, bline = find_line(text, r"^FIBER_PRICE_BRACKET_PER_KG\s*=")
    bracket = [float(x) for x in re.findall(r"[\d.]+", bline.split("=", 1)[1])]
    if len(bracket) != 3:
        raise ValueError(f"{p}:{nb} does not hold a three-price bracket: {bline!r}")
    ns, sline = find_line(text, r"^SURFACE_FIBER_PRICE_PER_KG\s*=")
    surface = float(sline.split("=")[1].strip().split()[0])
    if surface != bracket[2]:
        raise ValueError(f"{p}: the surface placeholder {surface} is no longer the bracket's top {bracket[2]}; re-key the marker")
    markers.append({
        "id": "inspace_fork_bracket",
        "label": "inspace_fork.py fiber-price bracket",
        "short": "inspace_fork",
        "prices_per_kg": {"bracket low": bracket[0], "bracket mid": bracket[1], "bracket high / surface": surface},
        "lines_per_key": {"bracket low": nb, "bracket mid": nb, "bracket high / surface": ns},
        "file": p, "line": nb, "text": bline.strip(), "commit": commit,
        "texts": [bline.strip(), sline.strip()],
        "status": "the DRAFT, non-canonical MXER in-space fork's explicit fiber-price bracket and the placeholder its v2 surface uses "
                  "because rev_a economics.fiber_cost_per_kg is null (require_non_null), flagged 'no vendor quote' in its own output; "
                  "params/service_mxer_draft.json capex_inputs carries the same bracket as that fork's written result; markers, never defaults",
    })

    p = "tools/sims/skyhook_no_leo_stress_test.jsx"
    text = (repo / p).read_text(encoding="utf-8")
    n, line = find_line(text, r"^\s*fiberPriceKg:\s*\d")
    nc, cline = find_line(text, r'preset === "conservative".*fiberPriceKg:\s*\d')
    no, oline = find_line(text, r'preset === "optimistic".*fiberPriceKg:\s*\d')
    val = lambda ln: float(re.search(r"fiberPriceKg:\s*([\d.]+)", ln).group(1))  # noqa: E731
    markers.append({
        "id": "stress_test_sim_prices",
        "label": "skyhook_no_leo_stress_test.jsx fiberPriceKg",
        "short": "stress-test sim",
        "prices_per_kg": {"cons. preset": val(cline), "default": val(line), "opt. preset": val(oline)},
        "lines_per_key": {"cons. preset": nc, "default": n, "opt. preset": no},
        "file": p, "line": n, "text": line.strip(), "commit": commit,
        "texts": [line.strip(), cline.strip(), oline.strip()],
        "status": "the React strategy simulator's slider default, labelled [Speculative] 'needs quote' on its own line, and its "
                  "conservative and optimistic preset values; fiberCost_M is never read (README finding 1), so none of them "
                  "changes what the simulator reports; markers, never defaults here",
    })
    return {"_meta": {"commit": commit, "derived_by": "ideas/13-the-null-input/build_data.py",
                      "note": "fiber prices the repository already carries, from three sources; none is a vendor quote and none is used as a default by fiber_sweep.py or the page"},
            "markers": markers}


# ── page data ────────────────────────────────────────────────────────────────────

def read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def sidecar_summary(p: Path) -> dict | None:
    """The sidecar snapshot.mjs wrote beside a snapshot, or None when it has not been written yet
    (first pass: derive, then run snapshot.mjs --sidecar-only, then build again; --check fails on None)."""
    side = Path(str(p) + ".provenance.json")
    if not side.exists():
        print(f"build_data: no sidecar yet for {p.name}; run tools/snapshot.mjs --sidecar-only, then build again", file=sys.stderr)
        return None
    s = read_json(side)
    return {k: s.get(k) for k in ("repo", "path", "commit", "commitDate", "pathLastChanged", "mode", "sourceSha256", "writtenSha256", "readMatchesCommitted", "note")}


def build_page_data() -> tuple[str, list[str]]:
    """Returns (data.js text, names of snapshots whose sidecar is missing)."""
    sys.path.insert(0, str(HERE))
    import fiber_sweep  # noqa: E402  (the PUBLISHED anchors and the grid live there, once)

    rev_a = read_json(SNAP / "rev_a.excerpt.json")
    ladder = read_json(SNAP / "ladder.json")
    markers = read_json(SNAP / "markers.json")
    data = {
        "rev_a": rev_a,
        "ladder": ladder,
        "markers": markers,
        "published": fiber_sweep.PUBLISHED,
        "price_grid": list(fiber_sweep.DEFAULT_PRICES),
        "provenance": {
            "rev_a.excerpt.json": sidecar_summary(SNAP / "rev_a.excerpt.json"),
            "ladder.json": sidecar_summary(SNAP / "ladder.json"),
            "markers.json": sidecar_summary(SNAP / "markers.json"),
            "SENSITIVITY_FINDINGS.md": sidecar_summary(SNAP / "SENSITIVITY_FINDINGS.md"),
            "DECISION_LOG.md": sidecar_summary(SNAP / "DECISION_LOG.md"),
            "mp001_market_pricing.md": sidecar_summary(SNAP / "mp001_market_pricing.md"),
            "outreach_log.md": sidecar_summary(SNAP / "outreach_log.md"),
        },
        "snapshot_sha256": {
            "rev_a.excerpt.json": sha256((SNAP / "rev_a.excerpt.json").read_bytes()),
            "ladder.json": sha256((SNAP / "ladder.json").read_bytes()),
            "markers.json": sha256((SNAP / "markers.json").read_bytes()),
        },
    }
    missing = [k for k, v in data["provenance"].items() if v is None]
    body = json.dumps(data, indent=1, ensure_ascii=False)  # file order kept, as the CLI reads it
    return ("// Generated by build_data.py from the snapshots in ./snapshots (do not edit by hand).\n"
            "// Classic script so index.html works from file://; the page computes everything from this with model.js.\n"
            f"window.NullInputData = {body};\n"), missing


def dumps(obj) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    pos = [a for a in argv if not a.startswith("--")]
    repo = Path(pos[0] if pos else "/home/user/skyhook").resolve()
    if not (repo / WORKBOOK).exists():
        print(f"build_data: no workbook at {repo / WORKBOOK}", file=sys.stderr)
        return 2
    outputs = {
        SNAP / "ladder.json": dumps(derive_ladder(repo)),
        SNAP / "markers.json": dumps(derive_markers(repo)),
    }
    stale = []
    for dest, text in outputs.items():
        if check:
            if not dest.exists() or dest.read_text(encoding="utf-8") != text:
                stale.append(dest.name)
        else:
            dest.write_text(text, encoding="utf-8")
            print(f"wrote {dest.relative_to(HERE)} ({len(text)} bytes)")
    page, missing = build_page_data()
    dest = HERE / "data.js"
    if check:
        if not dest.exists() or dest.read_text(encoding="utf-8") != page:
            stale.append(dest.name)
        for name in missing:
            stale.append(f"data.js (no sidecar for {name})")
        if stale:
            print("stale: " + ", ".join(stale))
            return 1
        print("build_data --check: ladder.json, markers.json and data.js are current")
        return 0
    dest.write_text(page, encoding="utf-8")
    print(f"wrote {dest.relative_to(HERE)} ({len(page)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
