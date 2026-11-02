#!/usr/bin/env python3
"""build_data.py: derive the Required Life data files from a Skyhook checkout, then pack every
snapshot into data.js for the page (a classic script, so index.html works from file://).

Python 3 standard library only. It never writes inside the Skyhook checkout.

    python3 -B ideas/26-required-life/build_data.py --repo /home/user/skyhook   # derive + pack
    python3 -B ideas/26-required-life/build_data.py --pack-only                  # pack snapshots only
    python3 -B ideas/26-required-life/build_data.py --check                      # exit 1 if data.js is stale

Derived files (each gets a provenance sidecar from tools/snapshot.mjs --sidecar-only afterwards):
  snapshots/ladder.json             the workbook Assumptions ladder, rows named by the row map in
                                    finance/skyhook_finance.py (_LADDER_ROWS), columns B/C/D, read
                                    from the .xlsx zip with zipfile + xml.etree (no openpyxl)
  snapshots/finance_conventions.json  CAPEX_SPREAD, OPS_START_YEAR, RAMP_STEP, WINDOW_YEARS, the
                                    payback search horizon and the NPV rate, read from
                                    finance/skyhook_finance.py with ast (values and line numbers)
  snapshots/physics_constants.json  R_EARTH_KM from physics/skyhook_physics.py (the finance model's
                                    reboost line evaluates v_orb with it, not with rev_a's 6,988 km)
  snapshots/founding_hybrid.json    the construction-baseline sentence of docs/project_instructions.md
                                    (Part IV section 4.1) and the "~20 km" Zylon length it states

Copied snapshots (tools/snapshot.mjs) that data.js also packs: rev_a.excerpt.json, DECISION_LOG.md,
mp001_market_pricing.md, lr001_splice_literature.md. From the three Markdown copies data.js carries
quoted lines (file, line number, exact text) and the numbers parsed out of them; the tests check
each quote against the snapshot line by line.
"""
import argparse
import ast
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAP = HERE / "snapshots"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- derive from the checkout

def module_assigns(src):
    """Top-level NAME = literal assignments of a Python source, with their line numbers."""
    out = {}
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                out[node.targets[0].id] = (ast.literal_eval(node.value), node.lineno)
            except ValueError:
                pass
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            try:
                out[node.target.id] = (ast.literal_eval(node.value), node.lineno)
            except ValueError:
                pass
    return out


def finance_conventions(repo):
    rel = "finance/skyhook_finance.py"
    src = (repo / rel).read_text(encoding="utf-8")
    a = module_assigns(src)
    tree = ast.parse(src)
    payback_max = None
    npv_rate = None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "payback_year":
            for arg, default in zip(node.args.args[-len(node.args.defaults):], node.args.defaults):
                if arg.arg == "max_years":
                    payback_max = (ast.literal_eval(default), node.lineno)
        # summarize(): "npv_10pct_M": npv_M(s, 0.10)
        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value == "npv_10pct_M" and isinstance(v, ast.Call):
                    npv_rate = (ast.literal_eval(v.args[1]), v.lineno)
    need = ["CAPEX_SPREAD", "OPS_START_YEAR", "RAMP_STEP", "WINDOW_YEARS", "_LADDER_ROWS"]
    missing = [k for k in need if k not in a]
    if missing or payback_max is None or npv_rate is None:
        sys.exit(f"finance conventions not found in {rel}: {missing}")
    return {
        "source": rel,
        "capex_spread": {"value": list(a["CAPEX_SPREAD"][0]), "line": a["CAPEX_SPREAD"][1]},
        "ops_start_year": {"value": a["OPS_START_YEAR"][0], "line": a["OPS_START_YEAR"][1]},
        "ramp_step": {"value": a["RAMP_STEP"][0], "line": a["RAMP_STEP"][1]},
        "window_years": {"value": a["WINDOW_YEARS"][0], "line": a["WINDOW_YEARS"][1]},
        "payback_max_years": {"value": payback_max[0], "line": payback_max[1]},
        "npv_rate": {"value": npv_rate[0], "line": npv_rate[1]},
        "ladder_rows": {"value": a["_LADDER_ROWS"][0], "line": a["_LADDER_ROWS"][1]},
    }, a["_LADDER_ROWS"][0]


def physics_constants(repo):
    rel = "physics/skyhook_physics.py"
    a = module_assigns((repo / rel).read_text(encoding="utf-8"))
    if "R_EARTH_KM" not in a:
        sys.exit(f"R_EARTH_KM not found in {rel}")
    return {"source": rel, "R_EARTH_KM": {"value": a["R_EARTH_KM"][0], "line": a["R_EARTH_KM"][1]}}


def cell_value(c):
    t = c.get("t")
    if t == "inlineStr":
        return "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
    v = c.find("m:v", NS)
    if v is None:
        return None
    if t == "s":
        raise ValueError("shared strings not expected in this workbook")
    if t in (None, "n"):
        f = float(v.text)
        return int(f) if f.is_integer() else f
    return v.text


def ladder(repo, rows):
    rel = "tools/financial/skyhook_financial_model.xlsx"
    z = zipfile.ZipFile(repo / rel)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rid = None
    for sh in wb.find("m:sheets", NS):
        if sh.get("name") == "Assumptions":
            rid = sh.get(f"{{{REL_NS}}}id")
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = next(r.get("Target") for r in rels if r.get("Id") == rid)
    target = target.lstrip("/")
    if not target.startswith("xl/"):
        target = "xl/" + target
    sheet = ET.fromstring(z.read(target))
    cells = {}
    for c in sheet.iter(f"{{{NS['m']}}}c"):
        cells[c.get("r")] = cell_value(c)
    cols = {"Conservative": "B", "Baseline": "C", "Optimistic": "D"}
    out = {"source": rel, "sheet": "Assumptions", "row_map_from": "finance/skyhook_finance.py _LADDER_ROWS",
           "header": [cells.get(f"{c}2") for c in "ABCDE"], "columns": {}, "rows": {}}
    for name, col in cols.items():
        out["columns"][name] = {k: cells[f"{col}{r}"] for k, r in rows.items()}
    for k, r in rows.items():
        out["rows"][k] = {"row": r, "label": cells.get(f"A{r}"), "note": cells.get(f"E{r}")}
    return out


def founding_hybrid(repo):
    rel = "docs/project_instructions.md"
    lines = (repo / rel).read_text(encoding="utf-8").split("\n")
    hits = [i for i, l in enumerate(lines, start=1) if "Construction baseline (adopted from HASTOL Phase I" in l]
    if len(hits) != 1:
        sys.exit(f"expected one construction-baseline line in {rel}, found {len(hits)}")
    n = hits[0]
    line = lines[n - 1]
    m = re.search(r"(Spectra/Dyneema-class UHMWPE for the bulk of each arm, with the outer ~(\d+(?:\.\d+)?) km of the lower arm in heat-resistant Zylon[^.]*\.)", line)
    if not m:
        sys.exit("construction-baseline sentence changed; re-read it before rebuilding")
    return {"source": rel, "line": n, "line_text": line, "sentence": m.group(1),
            "zylon_outer_lower_arm_km": float(m.group(2))}


# ---------------------------------------------------------------- pack snapshots into data.js

QUOTES = [
    # key, snapshot file, substring that must occur once in that file
    ("item10_load", "DECISION_LOG.md", "At SF 2.5 the HMPE bulk sections carry a steady centrifugal load"),
    ("item10_outcomes", "DECISION_LOG.md", "**Admissible outcomes (not yet decided):**"),
    ("item10_evidence", "DECISION_LOG.md", "**Evidence that would close or change this entry:**"),
    ("item10_downstream", "DECISION_LOG.md", "**Downstream actions opened by this entry"),
    ("item6_triple", "DECISION_LOG.md", "Post-fix workbook results: Conservative"),
    ("item8_npv", "DECISION_LOG.md", "The Rule-4 conservative case **fails the 15-year window**"),
    ("mp001_creep_row", "mp001_market_pricing.md", "| HMPE creep guidance:"),
    ("mp001_3c", "mp001_market_pricing.md", "**3c · Creep vs SF 2.5"),
    ("mp001_hmpe_specs", "mp001_market_pricing.md", "| HMPE (SK78/SK99) specs:"),
    ("mp001_st002", "mp001_market_pricing.md", "**ST-002 (proposed"),
    ("mp001_register", "mp001_market_pricing.md", "2. **Risk register (Hudson, xlsx):**"),
    ("lr001_D", "lr001_splice_literature.md", "**D · Creep couples straight into MP-001 §3c.**"),
]


def number(pattern, text, label):
    m = re.search(pattern, text)
    if not m:
        sys.exit(f"could not parse {label} from: {text[:120]}")
    return float(m.group(1).replace(",", ""))


def quotes():
    out = {}
    for key, fname, needle in QUOTES:
        lines = (SNAP / fname).read_text(encoding="utf-8").split("\n")
        hits = [i for i, l in enumerate(lines, start=1) if needle in l]
        if len(hits) != 1:
            sys.exit(f"{fname}: expected one line containing {needle!r}, found {len(hits)}")
        side = json.loads((SNAP / (fname + ".provenance.json")).read_text(encoding="utf-8"))
        out[key] = {"file": fname, "path": side["path"], "line": hits[0], "text": lines[hits[0] - 1]}
    row = out["mp001_creep_row"]["text"]
    c3 = out["mp001_3c"]["text"]
    d = out["lr001_D"]["text"]
    t6 = out["item6_triple"]["text"]
    t8 = out["item8_npv"]["text"]
    values = {
        # MP-001 section 1, "HMPE creep guidance" row (secondary engineering guidance)
        "guidance_max_load_pct": number(r"sustained load ≤ ~(\d+)% of break", row, "guidance load"),
        "sk78_life_yr": number(r"SK78 ≈ (\d+(?:\.\d+)?) yr at", row, "SK78 life"),
        "sk78_life_load_pct": number(r"SK78 ≈ [\d.]+ yr at (\d+)% load", row, "SK78 load"),
        "sk78_life_temp_c": number(r"load, (\d+) °C", row, "SK78 temperature"),
        # MP-001 section 3c: 28-40% of rated break at SF 2.5
        "rev_a_load_low_pct": number(r"centrifugal load of (\d+)–\d+% of rated break", c3, "low load"),
        "rev_a_load_high_pct": number(r"centrifugal load of \d+–(\d+)% of rated break", c3, "high load"),
        # MP-001 section 1, HMPE specs row (secondary spec sheets): density, SK99 vs SK78 strength
        "hmpe_density_gcc": number(r"specs: ([\d.]+) g/cm³", out["mp001_hmpe_specs"]["text"], "HMPE density"),
        "sk99_over_sk78_low_pct": number(r"SK99 ≈ \+(\d+)–\d+% strength vs SK78", out["mp001_hmpe_specs"]["text"], "SK99 margin low"),
        "sk99_over_sk78_high_pct": number(r"SK99 ≈ \+\d+–(\d+)% strength vs SK78", out["mp001_hmpe_specs"]["text"], "SK99 margin high"),
        # MP-001 ST-002 paragraph: coupons at 20% and 40% of break
        "st002_low_pct": number(r"\((\d+)% of break\) and", out["mp001_st002"]["text"], "ST-002 low coupon"),
        "st002_high_pct": number(r"of break\) and ~[\d.]+ kg \((\d+)%\)", out["mp001_st002"]["text"], "ST-002 high coupon"),
        # LR-001 section D: DM20 creeps >50x slower than SK78
        "dm20_creep_factor": number(r"DM20 grade creeps >(\d+)× slower than SK78", d, "DM20 factor"),
        # DECISION_LOG items 6 and 8: the published conservative triple
        "published_mass_ratio": number(r"Conservative (\d+\.\d+)× /", t6, "mass ratio"),
        "published_fiber_t": number(r"Conservative [\d.]+× / (\d+) t /", t6, "fiber t"),
        "published_capex_M": number(r"Conservative [\d.]+× / \d+ t / \$([\d,]+)M", t6, "capex"),
        "published_payback_year": number(r"Conservative [\d.]+× / \d+ t / \$[\d,]+M / payback ~Y(\d+)", t6, "payback"),
        "published_npv10_M": -number(r"NPV@10% −\$([\d,]+)M", t8, "NPV"),
    }
    return out, values


def pack():
    data = {
        "builtBy": "build_data.py (do not edit by hand; rerun it)",
        "commit": json.loads((SNAP / "rev_a.excerpt.json.provenance.json").read_text(encoding="utf-8"))["commit"],
        "revA": json.loads((SNAP / "rev_a.excerpt.json").read_text(encoding="utf-8")),
        "ladder": json.loads((SNAP / "ladder.json").read_text(encoding="utf-8")),
        "conventions": json.loads((SNAP / "finance_conventions.json").read_text(encoding="utf-8")),
        "physics": json.loads((SNAP / "physics_constants.json").read_text(encoding="utf-8")),
        "founding": json.loads((SNAP / "founding_hybrid.json").read_text(encoding="utf-8")),
    }
    q, v = quotes()
    data["quotes"] = q
    data["sourced"] = v
    body = json.dumps(data, indent=1, ensure_ascii=False)
    return (
        "/* data.js: generated by build_data.py from snapshots/ (see their .provenance.json sidecars).\n"
        " * Loads as a classic script (window.RequiredLifeData) and with require(). */\n"
        "(function (root, data) {\n"
        "  if (typeof module === 'object' && module.exports) module.exports = data;\n"
        "  else root.RequiredLifeData = data;\n"
        "})(typeof self !== 'undefined' ? self : this, " + body + ");\n"
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default="/home/user/skyhook", help="Skyhook checkout to derive from")
    ap.add_argument("--pack-only", action="store_true", help="only rebuild data.js from snapshots/")
    ap.add_argument("--check", action="store_true", help="exit 1 if data.js differs from a fresh pack")
    args = ap.parse_args()
    if args.check:
        fresh = pack()
        cur = (HERE / "data.js").read_text(encoding="utf-8")
        if fresh != cur:
            print("data.js is stale: rerun build_data.py --pack-only")
            sys.exit(1)
        print("data.js matches snapshots/")
        return
    if not args.pack_only:
        repo = Path(args.repo)
        if not (repo / ".git").exists():
            sys.exit(f"not a git checkout: {repo}")
        conv, rows = finance_conventions(repo)
        write_json(SNAP / "finance_conventions.json", conv)
        write_json(SNAP / "physics_constants.json", physics_constants(repo))
        write_json(SNAP / "ladder.json", ladder(repo, rows))
        write_json(SNAP / "founding_hybrid.json", founding_hybrid(repo))
        print("derived: ladder.json, finance_conventions.json, physics_constants.json, founding_hybrid.json")
    (HERE / "data.js").write_text(pack(), encoding="utf-8")
    print("packed: data.js")


if __name__ == "__main__":
    main()
