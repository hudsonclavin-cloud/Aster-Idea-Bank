"""Independent recomputation of Whose Earth's numbers in Python (standard library only).

From the bank root: python3 -m unittest discover -s ideas/14-whose-earth -p 'test_*.py'

Reads the constants straight out of this folder's snapshots with its own regular expressions (not through
registry.js), recomputes with math.erf and plain two-body formulas, and compares with what
`node whose-earth.mjs --offline --json` reports. A sign, factor or radius slip in model.js shows up here
as a disagreement between two implementations that share no code.
"""

import json
import math
import os
import re
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(HERE, "snapshots")


def read(*parts):
    with open(os.path.join(SNAP, *parts), encoding="utf-8") as f:
        return f.read()


def grab(text, pattern):
    m = re.search(pattern, text)
    if not m:
        raise AssertionError(f"pattern not found: {pattern}")
    return m.group(1)


CANON = json.loads(read("rev_a.json"))
PHYS = read("excerpts", "skyhook", "physics", "skyhook_physics.py.lines.txt")
DV = read("delta-v.ts")
MAIN = read("excerpts", "aster", "src", "v2", "app", "porkchop", "main.ts.lines.txt")
LV = read("excerpts", "aster", "src", "v2", "porkchop", "launch-vehicles.ts.lines.txt")

SKY = {
    "mu": CANON["orbital"]["mu_earth_m3s2"] / 1e9,
    "R": float(grab(PHYS, r"R_EARTH_KM = ([\d.]+)")),
    "g0": float(grab(PHYS, r"G_STD = ([\d.]+)")),
    "vrot": float(grab(PHYS, r"v_earth_rot = ([\d.]+)")),
}
PARK_ALT = float(grab(MAIN, r"(\d+) km circular LEO"))
AST = {
    "mu": float(grab(DV, r"EARTH_MU_KM3_PER_S2 = ([\d_.]+);").replace("_", "")),
    "R": float(grab(DV, r"LEO_PARKING_RADIUS_KM = ([\d_.]+);").replace("_", "")) - PARK_ALT,
    "g0": float(grab(LV, r"G0_MPS2 = ([\d.]+);")),
}
H = CANON["orbital"]["com_altitude_km"]
L = CANON["geometry"]["tether_half_length_km"]
K = CANON["kinematics"]
TIERS = [
    ("reference", K["v_tip_kms"]),
    ("cislunar", K["cislunar_revenue_gated_option"]["v_tip_kms"]),
    ("phase3", K["phase3_growth_option"]["v_tip_kms"]),
]


def geom(e):
    rc = e["R"] + H
    return rc, rc + L, rc - L, math.sqrt(e["mu"] / rc)


def c3(e, vt):
    rc, rt, rl, vo = geom(e)
    return (vo + vt) ** 2 - 2 * e["mu"] / rt


def mass_ratio(vt, derate):
    m = CANON["materials"]
    vc = math.sqrt(2 * m["tensile_strength_GPa"] * 1e9 / m["density_kgm3"]) / 1e3
    x = vt / vc * math.sqrt(CANON["mass_ratio"]["integrated_tether_to_payload_both_arms"]["SF"] / (1 - derate))
    return 2 * math.sqrt(math.pi) * x * math.exp(x * x) * math.erf(x)


def run_cli():
    # exit 1 (a failed gate) still prints the full JSON; compare the numbers anyway and test `ok` on its own
    p = subprocess.run(["node", os.path.join(HERE, "whose-earth.mjs"), "--offline", "--json"], capture_output=True, text=True, timeout=60)
    if p.returncode not in (0, 1):
        raise AssertionError(p.stdout + p.stderr)
    return json.loads(p.stdout), p.returncode


class CrossCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out, cls.code = run_cli()
        cls.a = cls.out["analysis"]

    def test_cli_reports_every_gate_passing(self):
        self.assertEqual(self.code, 0)
        self.assertTrue(self.out["ok"])
        self.assertTrue(all(g["ok"] for g in self.a["gates"]), [g for g in self.a["gates"] if not g["ok"]])

    def test_earths_read_independently_match(self):
        earths = {e["id"]: e for e in self.a["earths"]}
        for k in ("mu", "R", "g0"):
            self.assertAlmostEqual(earths["skyhook"][k], SKY[k], places=12)
            self.assertAlmostEqual(earths["aster"][k], AST[k], places=9)
        self.assertEqual(earths["skyhook"]["vRot"], SKY["vrot"])
        self.assertIsNone(earths["aster"]["vRot"])
        self.assertEqual(PARK_ALT, 200)

    def test_canon_values_both_earths(self):
        for eid, e in (("skyhook", SKY), ("aster", AST)):
            table = {q["path"]: q for q in self.a["canonTables"][eid]}
            rc, rt, rl, vo = geom(e)
            self.assertAlmostEqual(table["orbital.v_orb_kms"]["value"], vo, places=12)
            for name, vt in TIERS:
                path = "kinematics" if name == "reference" else ("kinematics.cislunar_revenue_gated_option" if name == "cislunar" else "kinematics.phase3_growth_option")
                self.assertAlmostEqual(table[f"{path}.c3_kms2"]["value"], c3(e, vt), places=10)
                cc = c3(e, vt)
                if cc < 0 and f"{path}.apogee_altitude_km" in table:
                    self.assertAlmostEqual(table[f"{path}.apogee_altitude_km"]["value"], 2 * (-e["mu"] / cc) - rt - e["R"], places=6)

    def test_mass_ratios_with_math_erf(self):
        table = {q["path"]: q for q in self.a["canonTables"]["skyhook"]}
        pre = "mass_ratio.integrated_tether_to_payload_both_arms."
        cases = {"optimistic_0pct_derate": (2.5, 0.0), "baseline_15pct_derate": (2.5, 0.15), "conservative_30pct_derate": (2.5, 0.30),
                 "cislunar_2p8kms_30pct_derate": (2.8, 0.30), "phase3_3p5kms_30pct_derate": (3.5, 0.30)}
        for key, (vt, d) in cases.items():
            mine = mass_ratio(vt, d)
            self.assertAlmostEqual(table[pre + key]["value"], mine, delta=1e-9 * mine)
            printed = CANON["mass_ratio"]["integrated_tether_to_payload_both_arms"][key]
            self.assertEqual(round(mine, 2), printed)

    def test_interface_shifts(self):
        for t, (name, vt) in zip(self.a["iface"], TIERS):
            self.assertEqual(t["tier"], name)
            both = c3(AST, vt) - c3(SKY, vt)
            mu_only = c3(dict(SKY, mu=AST["mu"]), vt) - c3(SKY, vt)
            r_only = c3(dict(SKY, R=AST["R"]), vt) - c3(SKY, vt)
            _, rt_a, _, _ = geom(AST)
            _, rt_s, _, vo_s = geom(SKY)
            mixed = (vo_s + vt) ** 2 - 2 * SKY["mu"] / rt_a - c3(SKY, vt)
            s = t["c3"]["shift"]
            self.assertAlmostEqual(s["both"], both, places=12)
            self.assertAlmostEqual(s["muOnly"], mu_only, places=12)
            self.assertAlmostEqual(s["rOnly"], r_only, places=12)
            self.assertAlmostEqual(s["mixed"], mixed, places=12)

    def test_reboost_energies(self):
        for row, (name, vt) in zip(self.a["reboostRows"], TIERS):
            rc, rt, rl, vo = geom(SKY)
            b = row["byEarth"]["skyhook"]
            self.assertAlmostEqual(b["momentum"], 2 * vo * vt, places=10)
            orbital = 0.5 * ((vo + vt) ** 2 - (vo - vt) ** 2) + SKY["mu"] * (1 / rl - 1 / rt)
            self.assertAlmostEqual(b["orbital"], orbital, places=10)
            self.assertAlmostEqual(b["angular"], (vo / rc) * (rt * (vo + vt) - rl * (vo - vt)), places=10)
            self.assertAlmostEqual(b["groundRel"], 0.5 * ((vo + vt) ** 2 - (vo - vt - SKY["vrot"]) ** 2) + SKY["mu"] * (1 / rl - 1 / rt), places=10)

    def test_aster_injection_pins(self):
        # Aster's injection Δv (delta-v.ts:18-26) recomputed here; the published values are in the excerpts' text
        slice11 = read("excerpts", "aster", "src", "v2", "SLICE_11_FOUNDING.md.lines.txt")
        pins = [(float(c), v) for c, v in re.findall(r"C3=(\d+(?:\.\d+)?) → (\d+\.\d+) km/s", slice11)]
        pins += [(float(c), v) for c, v in re.findall(r"pinned C3=(\d+(?:\.\d+)?) → injection (\d+\.\d+)", slice11)]
        audit = read("excerpts", "aster", "tools", "audit", "sanity-69472a3", "s19-5-runs", "verify-REPORT.md.lines.txt")
        pins.append((0.0, grab(audit, r"Δv = (\d+\.\d+) km/s")))
        self.assertEqual(len(pins), 4)
        rp = AST["R"] + PARK_ALT
        for c, printed in pins:
            dv = math.sqrt(c + 2 * AST["mu"] / rp) - math.sqrt(AST["mu"] / rp)
            decimals = len(printed.split(".")[1])
            self.assertEqual(f"{dv:.{decimals}f}", printed, f"C3={c}")
        self.assertEqual(sorted(p["printed"] for p in self.a["pins"]), sorted(p for _, p in pins))

    def test_decision_grid_reboost(self):
        wb = json.loads(read("workbook-assumptions.json"))
        grid = json.loads(read("decision-grid-excerpt.json"))
        cols = wb["columns"]
        tier_v = {"reference": TIERS[0][1], "cislunar_revenue_gated_option": TIERS[1][1], "phase3_growth_option": TIERS[2][1]}
        _, _, _, vo = geom(SKY)
        for p in grid["points"]:
            i = cols.index(p["column"])
            eta = wb["rows"]["6"]["values"][i]
            price = wb["rows"]["7"]["values"][i]
            dollars = 2 * vo * tier_v[p["tier"]] / eta / 3.6 * price
            self.assertEqual(round(dollars, 4), p["reboost_electricity_per_kg"], p)
            self.assertAlmostEqual(mass_ratio(tier_v[p["tier"]], 1 - wb["rows"]["3"]["values"][i]), p["mass_ratio_x"], delta=5e-5)


if __name__ == "__main__":
    unittest.main()
