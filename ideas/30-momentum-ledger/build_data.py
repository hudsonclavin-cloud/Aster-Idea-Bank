#!/usr/bin/env python3
"""Rebuild this idea's snapshots and data.js from a Skyhook checkout (read-only).

    python3 ideas/30-momentum-ledger/build_data.py [--skyhook DIR] [--check]

What it writes (all inside this folder):
  snapshots/rev_a.json                 whole copy of params/rev_a.json            (tools/snapshot.mjs, copy)
  snapshots/service_mxer_draft.json    excerpt of params/service_mxer_draft.json  (tools/snapshot.mjs, --pick)
  snapshots/REBOOST_BOUND_FINDINGS.md  whole copy of finance/REBOOST_BOUND_FINDINGS.md
  snapshots/twin-physics.mjs           whole copy of tools/twin/physics.js (Skyhook's own 17-node tether model)
  snapshots/twin-classic.js            the same file with its 6 `export ` keywords removed and a classic-script
                                       wrapper added, so the page can run it from file:// (derived, --sidecar-only)
  snapshots/workbook-ladder.json       Assumptions rows 2, 6, 7, 9, 11, 12 of tools/financial/skyhook_financial_model.xlsx,
                                       read with zipfile + xml.etree (derived, --sidecar-only)
  snapshots/<name>.lines.json          the exact text of each cited source line (derived, --sidecar-only)
  data.js                              everything above the page needs, as one classic script (window.LedgerData)

Every value in data.js is parsed out of a snapshot by a regular expression over the cited line, never typed here.
--check rebuilds into memory and exits 1 if any written file would change (the provenance sidecars' timestamps
are ignored). Exit 2 if the checkout is missing or a cited line no longer says what this script expects.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
BANK = HERE.parent.parent
SNAP = HERE / "snapshots"
SNAPSHOT_TOOL = BANK / "tools" / "snapshot.mjs"

# Each cited line, and a regular expression the line must still match (the value is parsed from the match).
LINES = {
    "skyhook_physics": ("physics/skyhook_physics.py", {40: r"^R_EARTH_KM = (?P<r_earth_km>[\d.]+)"}),
    "tether_dynamics": ("physics/tether_dynamics.py", {
        75: r"\[Speculative\] hub mass",
        76: r"(?P<hub_lo_t>\d+)-(?P<hub_hi_t>\d+) t hub; (?P<hub_mid_t>\d+) t midpoint used until a hub mass budget exists",
        77: r"hub_mass_kg: float = (?P<hub_mass_kg>[\d.e]+)",
    }),
    "project_instructions": ("docs/project_instructions.md", {
        42: r"Worked baseline example \(our Phase 2 reference design\)",
        44: r"lower tip reaches down to roughly \*\*(?P<hastol_lo_km>\d+).(?P<hastol_hi_km>\d+) km altitude",
        118: r"solar arrays \(hundreds of kW in Phase 2, multi-MW in Phase 3\).*ballast mass improves catch dynamics",
        143: r"Power levels of (?P<ed_p_lo_kw>\d+) kW.(?P<ed_p_hi_mw>\d+) MW yield meaningful daily momentum restoration",
        145: r"restore the momentum of one full design-payload boost within the planned inter-catch interval \(initially (?P<interval_lo_d>\d+).(?P<interval_hi_d>\d+) days, shrinking to < (?P<interval_mature_d>\d+) day at maturity\) with (?P<margin_pct>\d+)% margin",
        193: r"hub mass of order (?P<hub_lo_t>\d+).(?P<hub_hi_t>\d+) t",
        218: r"restoring ~(?P<founding_mj_per_kg>\d+) MJ/kg of orbital energy",
    }),
    "mp001": ("docs/research/mp001_market_pricing.md", {
        37: r"Rev A imparts (?P<mp001_mj_per_kg>[\d.]+) MJ/kg = (?P<mp001_kwh_per_kg>[\d.]+) kWh/kg.*placeholder.*?(?P<mp001_eta_mid_pct>\d+)% wall-to-momentum.*Ladder at (?P<eta_lo_pct>\d+)% / (?P<eta_mid_pct>\d+)% / (?P<eta_hi_pct>\d+)% efficiency",
    }),
    "skyhook_finance": ("finance/skyhook_finance.py", {
        211: r"Reboost energy 2\*v_orb\*v_tip MJ/kg",
        215: r"reboost_MJ_per_kg = 2\.0 \* v_orb \* s\.tip_speed_kms",
        216: r"elec = reboost_MJ_per_kg / s\.power_chain_efficiency / 3\.6",
    }),
    "test_analysis_layer": ("tests/test_analysis_layer.py", {
        77: r"bound\.dE_throw_j == pytest\.approx\((?P<golden_dE_j>[\d.e]+), rel=(?P<golden_rel>[\d.]+)\)",
        78: r"min_power_for_56_kw\(bound, ref, 0\.5, 0\.5\) == pytest\.approx\((?P<golden_pmin_55_kw>[\d.]+), rel=0\.01\)",
        79: r"min_power_for_56_kw\(bound, ref, 0\.3, 0\.3\) == pytest\.approx\((?P<golden_pmin_33_kw>[\d.]+), rel=0\.01\)",
    }),
    "glossary": ("docs/glossary.md", {
        35: r"\*\*Momentum bank / Momentum ledger\*\*",
        36: r"Every catch-and-throw of an upbound payload is a \"withdrawal\" \(tether orbit drops\)",
    }),
    "reboost_bound": ("finance/reboost_bound.py", {
        28: r"^R_GEO_KM = (?P<r_geo_km>[\d_.]+)  # \[FLAGGED\]",
        118: r"e_in_jkg = -MU_EARTH / \(2\.0 \* r_catch_km \* 1000\.0\)",
        119: r"e_out_jkg = -MU_EARTH / \(2\.0 \* a_transfer_km \* 1000\.0\)",
        120: r"dE_throw_j = ref\.payload_t \* 1000\.0 \* \(e_out_jkg - e_in_jkg\)",
        147: r"return dE_throw_j / \(power_kw \* 1000\.0 \* eta \* duty\) / 86400\.0",
        29: r"ENERGY_CROSSCHECK_J",
        30: r"INSTALLED_POWER_KW = \((?P<rb_powers_kw>[\d., ]+)\)",
        31: r"ETA_CHAIN = \((?P<rb_eta>[\d., ]+)\)",
        32: r"DUTY_FACTORS = \((?P<rb_duty>[\d., ]+)\)",
        33: r"SPECIFIC_POWER_WKG = \((?P<rb_specific_power_wkg>[\d., ]+)\)",
        36: r"this is an ENERGY bound, not a Lorentz-force thrust model",
    }),
    "program_site": ("tools/sims/skyhook_program_site.html", {
        847: r"if\(boost\)\{ var sp=Math\.hypot\(st\.vx\[i\],st\.vy\[i\]\); ax\+=(?P<site_boost_accel_kms2>[\d.e-]+)\*st\.vx\[i\]/sp",
    }),
}

WHOLE = [
    ("params/rev_a.json", "rev_a.json", None, "whole file: the Rev A canon (Rule 1)"),
    ("params/service_mxer_draft.json", "service_mxer_draft.json",
     "status,confidence,catch_origin,tether_com_orbit,tether,payload_class,capex_inputs.hub_mass_t,capex_inputs.hub_mass_note",
     "excerpt: the DRAFT in-space fork config finance/reboost_bound.py reads, for the cross-check against its golden"),
    ("finance/REBOOST_BOUND_FINDINGS.md", "REBOOST_BOUND_FINDINGS.md", None,
     "whole file: reboost_bound.py's published energy, recovery grid and minimum-power tables, reproduced by the tests"),
    ("tools/twin/physics.js", "twin-physics.mjs", None,
     "whole file, verbatim (renamed .mjs so Node imports it as an ES module): Skyhook's 17-node lumped-mass tether model, run by the tests as an independent check"),
]

WORKBOOK = "tools/financial/skyhook_financial_model.xlsx"
WORKBOOK_ROWS = (2, 6, 7, 9, 11, 12)


def fail(msg: str) -> None:
    print(f"build_data: {msg}", file=sys.stderr)
    sys.exit(2)


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def read_lines(repo: Path) -> tuple[dict, dict]:
    out, values = {}, {}
    for name, (rel, wanted) in LINES.items():
        text = (repo / rel).read_text(encoding="utf-8").split("\n")
        got = {}
        for no, rx in sorted(wanted.items()):
            if no > len(text):
                fail(f"{rel}:{no} is past the end of the file")
            line = text[no - 1].rstrip("\r")
            m = re.search(rx, line)
            if not m:
                fail(f"{rel}:{no} no longer matches /{rx}/: {line!r}")
            got[str(no)] = line
            for k, v in m.groupdict().items():
                values[f"{name}.{k}"] = {"text": v, "path": rel, "line": no}
        out[name] = {"path": rel, "lines": got}
    return out, values


def read_workbook(repo: Path) -> dict:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
          "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
    with zipfile.ZipFile(repo / WORKBOOK) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rid = next(s.get(f"{{{ns['r']}}}id") for s in wb.find("m:sheets", ns) if s.get("name") == "Assumptions")
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == rid)
        sheet = ET.fromstring(z.read("xl/" + target.lstrip("/").removeprefix("xl/")))
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")) for si in sst]
    rows = {}
    for row in sheet.iter(f"{{{ns['m']}}}row"):
        r = int(row.get("r"))
        if r not in WORKBOOK_ROWS:
            continue
        cells = {}
        for c in row.iter(f"{{{ns['m']}}}c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            t = c.get("t")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{ns['m']}}}t"))
            else:
                v = c.find("m:v", ns)
                val = None if v is None else v.text
                if t == "s" and val is not None:
                    val = shared[int(val)]
                elif t not in ("s", "str") and val is not None:
                    val = float(val)
            cells[col] = val
        rows[str(r)] = {"label": cells.get("A"), "Conservative": cells.get("B"), "Baseline": cells.get("C"),
                        "Optimistic": cells.get("D"), "note": cells.get("E")}
    if set(rows) != {str(r) for r in WORKBOOK_ROWS}:
        fail(f"workbook rows missing: wanted {WORKBOOK_ROWS}, got {sorted(rows)}")
    return {"path": WORKBOOK, "sheet": "Assumptions", "rows": rows}


def classic_twin(src: str) -> str:
    exports = re.findall(r"^export (?:const|function|class) ", src, flags=re.M)
    if len(exports) != 6:
        fail(f"tools/twin/physics.js: expected 6 top-level exports, found {len(exports)}")
    body = re.sub(r"^export ((?:const|function|class) )", r"\1", src, flags=re.M)
    head = ("// DERIVED by ideas/30-momentum-ledger/build_data.py from snapshots/twin-physics.mjs (Skyhook tools/twin/physics.js):\n"
            "// the file verbatim except that the 6 top-level `export ` keywords are removed and it is wrapped as a classic\n"
            "// script exposing window.SkyhookTwin, because ES modules do not load from file://. Do not edit by hand.\n"
            "(function (root) {\n")
    tail = ("\nroot.SkyhookTwin = { R_EARTH_KM: R_EARTH_KM, G_STD: G_STD, characteristicVelocityKms: characteristicVelocityKms,"
            " erf: erf, TetherConfig: TetherConfig, TetherSim: TetherSim };\n"
            "})(typeof self !== 'undefined' ? self : this);\n")
    return head + body + tail


def build(repo: Path) -> dict[str, str]:
    """Return {relative path in this folder: content} for every file this script derives (not the copies)."""
    lines, values = read_lines(repo)
    workbook = read_workbook(repo)
    files = {}
    for name, block in lines.items():
        files[f"snapshots/{name}.lines.json"] = json.dumps(block, indent=2, ensure_ascii=False) + "\n"
    files["snapshots/workbook-ladder.json"] = json.dumps(workbook, indent=2, ensure_ascii=False) + "\n"
    files["snapshots/twin-classic.js"] = classic_twin((repo / "tools/twin/physics.js").read_text(encoding="utf-8"))
    return files, lines, values, workbook


def data_js(repo: Path, lines: dict, values: dict, workbook: dict) -> str:
    rev_a = json.loads((repo / "params/rev_a.json").read_text(encoding="utf-8"))
    mxer = json.loads((SNAP / "service_mxer_draft.json").read_text(encoding="utf-8"))
    findings = (repo / "finance/REBOOST_BOUND_FINDINGS.md").read_text(encoding="utf-8")
    grid = [dict(eta=float(a), duty=float(b), power_kw=float(c), t_rec_days=float(d), support=e.strip())
            for a, b, c, d, e in re.findall(r"^\| (\d\.\d) \| (\d\.\d) \| (\d+) \| ([\d.]+) \| ([a-z0-9 ]+) \|$", findings, flags=re.M)]
    pmin = [dict(eta=float(a), duty=float(b), power_kw=float(c))
            for a, b, c in re.findall(r"^\| (\d\.\d) \| (\d\.\d) \| ([\d.]+) \|$", findings, flags=re.M)]
    golden = re.search(r"^- dE_throw = ([\d.e+]+) J$", findings, flags=re.M)
    scope = re.search(r"^Scope line: (.+)$", findings, flags=re.M)
    if len(grid) != 24 or len(pmin) != 6 or not golden or not scope:
        fail("finance/REBOOST_BOUND_FINDINGS.md tables changed shape")
    commit = git(repo, "rev-parse", "HEAD")
    data = {
        "skyhookCommit": commit,
        "skyhookCommitShort": commit[:7],
        "revA": rev_a,
        "mxer": mxer,
        "reboostBoundFindings": {"path": "finance/REBOOST_BOUND_FINDINGS.md", "grid": grid, "minPower56": pmin,
                                 "dE_throw_j": float(golden.group(1)), "scopeLine": scope.group(1)},
        "workbook": workbook,
        "lines": lines,
        "values": values,
    }
    body = json.dumps(data, indent=1, ensure_ascii=False)
    return ("// DERIVED by build_data.py from this folder's snapshots of Skyhook " + commit[:7] + ". Do not edit by hand.\n"
            "(function (root, factory) {\n"
            "  if (typeof module === 'object' && module.exports) module.exports = factory();\n"
            "  else root.LedgerData = factory();\n"
            "})(typeof self !== 'undefined' ? self : this, function () {\n  return " + body + ";\n});\n")


def snapshot(repo: Path, rel: str, dest: Path, *, pick=None, note="", sidecar_only=False) -> None:
    cmd = ["node", str(SNAPSHOT_TOOL), str(repo), rel, str(dest)]
    if pick:
        cmd += ["--pick", pick]
    if note:
        cmd += ["--note", note]
    if sidecar_only:
        cmd.append("--sidecar-only")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--skyhook", default="/home/user/skyhook", help="Skyhook checkout to read (read-only)")
    ap.add_argument("--check", action="store_true", help="rebuild in memory; exit 1 if anything written would change")
    args = ap.parse_args()
    repo = Path(args.skyhook).resolve()
    if not (repo / ".git").exists():
        fail(f"not a git checkout: {repo}")

    if args.check:
        files, lines, values, workbook = build(repo)
        files["data.js"] = data_js(repo, lines, values, workbook)
        stale = [p for p, c in files.items() if not (HERE / p).exists() or (HERE / p).read_text(encoding="utf-8") != c]
        for rel, name, pick, _ in WHOLE:
            src = (repo / rel).read_bytes()
            if pick is None and (SNAP / name).read_bytes() != src:
                stale.append(f"snapshots/{name}")
        print("stale: " + ", ".join(stale) if stale else "up to date")
        sys.exit(1 if stale else 0)

    SNAP.mkdir(exist_ok=True)
    for rel, name, pick, note in WHOLE:
        snapshot(repo, rel, SNAP / name, pick=pick, note=note)
    files, lines, values, workbook = build(repo)
    notes = {
        "snapshots/workbook-ladder.json": (WORKBOOK, "derived by build_data.py: Assumptions sheet rows 2, 6, 7, 9, 11, 12 (header, power-chain efficiency, electricity $/kWh, hardware mass factor, mature cadence, payload per catch), columns A-E, read with zipfile + xml.etree"),
        "snapshots/twin-classic.js": ("tools/twin/physics.js", "derived by build_data.py: the file verbatim with its 6 top-level `export ` keywords removed, wrapped as a classic script (window.SkyhookTwin) so the page can run it from file://"),
    }
    for name, (rel, _) in LINES.items():
        notes[f"snapshots/{name}.lines.json"] = (rel, f"derived by build_data.py: the exact text of the cited lines {', '.join(str(n) for n in sorted(LINES[name][1]))}")
    for p, content in files.items():
        (HERE / p).write_text(content, encoding="utf-8")
        rel, note = notes[p]
        snapshot(repo, rel, HERE / p, note=note, sidecar_only=True)
    (HERE / "data.js").write_text(data_js(repo, lines, values, workbook), encoding="utf-8")
    print(f"wrote {len(files) + len(WHOLE) + 1} files from {repo} at {git(repo, 'rev-parse', '--short', 'HEAD')}")


if __name__ == "__main__":
    main()
