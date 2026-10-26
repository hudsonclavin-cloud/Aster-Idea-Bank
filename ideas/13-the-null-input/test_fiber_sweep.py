"""
test_fiber_sweep.py — unittest (standard library) for ideas/13-the-null-input.

Run from the bank root:  python3 -m unittest discover -s ideas/13-the-null-input -p 'test_*.py'

What is pinned to something outside this folder's own code:
  * the published figures in the snapshots (DECISION_LOG.md items 6/7/8, SENSITIVITY_FINDINGS.md,
    rev_a.json's mass-ratio ladder and its two cislunar breakeven keys), reproduced at fiber price 0;
  * a hand-worked purchase line (609.13 t × $300/kg = $182.74M) from EQ-6 written out in the test;
  * closed forms: the launch threshold falls by m/hardware_mass_factor $/kg per $/kg of fiber, the
    customer-price threshold equals the Y15 breakeven price, and a single's stop price is
    cum15(0) × 1000 / (fiber_t × m);
  * the saved outputs (reference.json, example.txt) against fresh runs, and the workbook itself
    (re-derived by build_data.py when the Skyhook checkout is present).
"""

from __future__ import annotations

import json
import math
import os
import re
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
BANK = HERE.parent.parent
sys.path.insert(0, str(HERE))

import fiber_sweep as fs  # noqa: E402

SNAP = HERE / "snapshots"
PY = [sys.executable, "-B", str(HERE / "fiber_sweep.py")]
ENV = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
SKYHOOK = Path(os.environ.get("SKYHOOK_DIR", "/home/user/skyhook"))


def run(*args: str, cwd: Path = BANK) -> subprocess.CompletedProcess:
    return subprocess.run(PY + list(args), cwd=cwd, capture_output=True, text=True, env=ENV)


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.params = fs.load_json(fs.DEFAULT_PARAMS)
        cls.ladder = fs.load_ladder()
        cls.model = fs.Model(cls.params)
        cls.cons = cls.ladder["Conservative"]
        cls.base = cls.ladder["Baseline"]
        cls.findings = (SNAP / "SENSITIVITY_FINDINGS.md").read_text(encoding="utf-8")
        cls.declog = (SNAP / "DECISION_LOG.md").read_text(encoding="utf-8")
        cls.mp001 = (SNAP / "mp001_market_pricing.md").read_text(encoding="utf-8")


# ── 1. The p = 0 gate: published figures reproduced ─────────────────────────────────────────

class TestGate(Base):
    def test_gate_reproduces_every_anchor(self):
        gate = fs.run_gate(self.model, self.ladder)
        bad = [c for c in gate["checks"] if not c["ok"]]
        self.assertEqual(bad, [], f"gate failures: {bad}")
        self.assertEqual(len(gate["checks"]), 19)
        self.assertTrue(gate["ok"])

    def test_published_constants_are_in_the_snapshot_text(self):
        """Every number PUBLISHED retypes is found verbatim in the snapshotted source documents."""
        for s in ["$8,741M", "Y17", "−$3,883M", "$5,772M", "Y9", "$4,226M", "Y7", "$6,877M", "payback Y14",
                  "609 t", "322 t", "202 t", "121.83×", "64.30×", "40.32×"]:
            self.assertIn(s, self.declog, s)
        for s in ["≥ 1.10 catches/day", "≥ $550/kg", "≥ 5,758 kg", "≤ $5,095M", "≤ 21.2%", "≤ $1,674/kg", "≤ 1.21×",
                  "cannot close alone", "cadence→2/day (payback **Y11**)", "construction launch→$1,500/kg (Y15)",
                  "derate→15% (Y15)", "program capex→$5,000M (Y15)", "capex $6,877M, payback Y14"]:
            self.assertIn(s, self.findings, s)
        pub = fs.PUBLISHED
        self.assertEqual((pub["columns"]["Conservative"]["total_capex_M"], pub["columns"]["Conservative"]["payback_year"],
                          pub["columns"]["Conservative"]["npv_10pct_M"]), (8741, 17, -3883))
        self.assertEqual((pub["columns"]["Baseline"]["total_capex_M"], pub["columns"]["Baseline"]["payback_year"]), (5772, 9))
        self.assertEqual((pub["columns"]["Optimistic"]["total_capex_M"], pub["columns"]["Optimistic"]["payback_year"]), (4226, 7))
        self.assertEqual((pub["variant"]["total_capex_M"], pub["variant"]["payback_year"]), (6877, 14))

    def test_mass_ratio_ladder_from_rev_a(self):
        """EQ-6 at the snapshot's sigma, rho, SF and tip speeds reproduces the five published ratios and masses."""
        audit = self.params["mass_ratio"]["integrated_tether_to_payload_both_arms"]
        m = self.model
        for col, (rk, fk) in fs.PUBLISHED["mass_ratio_keys"].items():
            s = self.ladder[col] if col in fs.COLUMNS else m.for_tier(self.cons, col)
            self.assertEqual(round(m.mass_ratio(s), 2), audit[rk], col)
            self.assertEqual(round(m.fiber_mass_t(s), 1), audit[fk], col)
        self.assertEqual(round(m.Vc_kms, 2), self.params["materials"]["V_c_kms"])
        self.assertEqual(round(m.v_orb_kms, 2), 7.56, "v_orb from R_E = 6371 km and 610 km is 7.5563 km/s")
        self.assertEqual(self.params["orbital"]["v_orb_kms"], 7.55, "the file's rounded value follows its com_radius_km 6988 instead (README finding)")

    def test_thresholds_at_zero_match_findings(self):
        thr = self.model.thresholds(self.cons)
        self.assertEqual(round(thr["customer_price_per_kg"]), 550)
        self.assertEqual(round(thr["construction_launch_per_kg"]), 1674)
        self.assertEqual(round(thr["catches_per_day"], 2), 1.10)
        self.assertEqual(round(thr["payload_kg"]), 5758)
        self.assertEqual(round(thr["derate_fraction"] * 100, 1), 21.2)
        self.assertEqual(round(thr["hardware_mass_factor"], 2), 1.21)
        self.assertEqual(round(thr["program_fleet_capex_M"]), 5095)
        self.assertIsNone(thr["fixed_ops_M"])

    def test_singles_at_zero_match_findings(self):
        singles = {s["field"]: s for s in self.model.baseline_singles(self.cons, self.base)}
        closing = {f: s["payback_year"] for f, s in singles.items() if s["closes"]}
        self.assertEqual(closing, {"catches_per_day": 11, "construction_launch_per_kg": 15,
                                   "derate_fraction": 15, "program_fleet_capex_M": 15})
        self.assertFalse(singles["hardware_mass_factor"]["closes"])
        self.assertFalse(singles["fixed_ops_M"]["closes"])
        self.assertNotIn("customer_price_per_kg", singles, "price is 500 in both columns")
        self.assertNotIn("payload_kg", singles)

    def test_rev_a_cislunar_breakeven_keys(self):
        """rev_a.json's own two cislunar economics keys fall out of the chain (conservative column, tip speed swapped)."""
        cis = self.model.for_tier(self.cons, "cislunar_revenue_gated_option")
        block = self.params["kinematics"]["cislunar_revenue_gated_option"]
        self.assertEqual(round(self.model.relaxation_threshold(cis, "construction_launch_per_kg")),
                         block["construction_launch_break_even_for_500_per_kg_customer_price"])  # 686
        at800 = fs.replace(cis, construction_launch_per_kg=800.0)
        self.assertEqual(round(self.model.breakeven_customer_price_y15(at800)),
                         block["customer_price_break_even_at_800_per_kg_construction_launch_Y15"])  # 517

    def test_tier_ladder_matches_the_module_run(self):
        """Not a committed number: these are what `python3 finance/skyhook_finance.py` printed at 34935cb
        when run while building this (TIER LADDER section). Recorded here as a reconciliation."""
        m = self.model
        cis = m.summarize(m.for_tier(self.cons, "cislunar_revenue_gated_option"))
        p3 = m.summarize(m.for_tier(self.cons, "phase3_growth_option"))
        self.assertEqual((round(cis["total_capex_M"]), cis["payback_year"], round(cis["npv_10pct_M"]), round(cis["breakeven_customer_price_y15"])),
                         (12644, 22, -6946, 767))
        self.assertEqual((round(p3["total_capex_M"]), p3["payback_year"], round(p3["npv_10pct_M"]), round(p3["breakeven_customer_price_y15"])),
                         (75434, None, -56176, 4244))
        self.assertTrue(cis["partial_tier_model"] and p3["partial_tier_model"])
        self.assertFalse(m.summarize(self.cons)["partial_tier_model"])

    def test_gate_refuses_a_tampered_ladder(self):
        bad = fs.replace(self.cons, construction_launch_per_kg=2600.0)
        gate = fs.run_gate(self.model, {**self.ladder, "Conservative": bad})
        self.assertFalse(gate["ok"])
        self.assertIn("Conservative total capex $M", [c["label"] for c in gate["checks"] if not c["ok"]])


# ── 2. The purchase line ─────────────────────────────────────────────────────────────────────

class TestPurchaseLine(Base):
    def test_hand_check_at_300_per_kg(self):
        """EQ-6 written out: x = (V_t/V_c)·sqrt(SF/(1−derate)); M/m = 2·sqrt(pi)·x·e^(x²)·erf(x). Zylon sigma 5.8 GPa,
        rho 1560 kg/m³, SF 2.5, 2.5 km/s, 30% derate -> 121.826x -> 609.13 t at 5,000 kg; × $300/kg = $182.74M."""
        mat = self.params["materials"]
        Vc = math.sqrt(2 * mat["tensile_strength_GPa"] * 1e9 / mat["density_kgm3"]) / 1e3
        x = (self.params["kinematics"]["v_tip_kms"] / Vc) * math.sqrt(mat["safety_factor"] / (1 - mat["derate_fraction"]))
        ratio = 2 * math.sqrt(math.pi) * x * math.exp(x * x) * math.erf(x)
        fiber_t = ratio * 5000 / 1000
        self.assertAlmostEqual(fiber_t, 609.1304, places=3)
        self.assertAlmostEqual(fiber_t * 300 / 1000, 182.739, places=2)
        self.assertAlmostEqual(self.model.fiber_purchase_M(self.cons, 300.0, 1.0), 182.739, places=2)
        self.assertAlmostEqual(self.model.fiber_purchase_M(self.cons, 300.0, 1.3), 237.561, places=2)

    def test_linear_in_price_and_multiplier(self):
        m = self.model
        for s in fs.tier_rows(m, self.ladder):
            c0 = m.total_capex_M(s)
            ft = m.fiber_mass_t(s)
            for p, mult in [(10, 1), (300, 1), (300, 1.3), (3000, 0.8), (12345.6, 2.0)]:
                self.assertAlmostEqual(m.total_capex_M(s, p, mult) - c0, p * mult * ft / 1000, delta=1e-9 * c0)

    def test_hardware_mass_factor_not_applied_to_the_purchase_line(self):
        m = self.model
        a = m.fiber_purchase_M(self.cons, 300.0, 1.0)
        b = m.fiber_purchase_M(fs.replace(self.cons, hardware_mass_factor=3.0), 300.0, 1.0)
        self.assertEqual(a, b)
        self.assertGreater(m.system_capex_M(fs.replace(self.cons, hardware_mass_factor=3.0)), m.system_capex_M(self.cons))

    def test_only_capex_years_change(self):
        """The purchase line is capex: cash flows differ by −added×spread in years 1-4 and by nothing after."""
        m = self.model
        f0 = m.net_cash_flows_M(self.cons, 0.0, 1.0, years=20)
        f1 = m.net_cash_flows_M(self.cons, 300.0, 1.0, years=20)
        added = m.fiber_purchase_M(self.cons, 300.0, 1.0)
        for y, (a, b) in enumerate(zip(f0, f1), start=1):
            want = -added * fs.CAPEX_SPREAD[y - 1] if y <= 4 else 0.0
            self.assertAlmostEqual(b - a, want, places=9, msg=f"year {y}")
        self.assertAlmostEqual(sum(fs.CAPEX_SPREAD), 1.0)
        for s in fs.tier_rows(m, self.ladder):
            r0, r1 = m.summarize(s), m.summarize(s, 300.0, 1.0)
            for k in ("mass_ratio_x", "fiber_mass_t", "system_capex_M"):
                self.assertEqual(r0[k], r1[k], k)

    def test_monotone_in_price(self):
        m = self.model
        grid = [0, 1, 10, 30, 100, 300, 1000, 3000, 10000]
        for s in fs.tier_rows(m, self.ladder):
            prev = None
            for p in grid:
                r = m.summarize(s, p, 1.0)
                pb = r["payback_year"] if r["payback_year"] is not None else 999
                if prev is not None:
                    self.assertGreaterEqual(pb, prev["pb"], f"{s.name} payback at {p}")
                    for k in ("npv_8pct_M", "npv_10pct_M", "npv_12pct_M"):
                        self.assertLessEqual(r[k], prev[k], f"{s.name} {k} at {p}")
                    self.assertGreaterEqual(r["breakeven_customer_price_y15"], prev["breakeven_customer_price_y15"])
                    self.assertGreaterEqual(r["total_capex_M"], prev["total_capex_M"])
                prev = {**r, "pb": pb}

    def test_breakeven_shift_closed_form(self):
        """Δ(Y15 breakeven price) = added capex / (upmass × Σ ramp): $182.74M / (1,825,000 kg × 9.9) = $10.11/kg."""
        m = self.model
        sum_mult = sum(m.ramp_multiplier(k, self.cons.revenue_ramp_y1) for k in range(1, 12))
        self.assertAlmostEqual(sum_mult, 0.3 + 0.6 + 9 * 1.0)
        d = m.breakeven_customer_price_y15(self.cons, 300.0) - m.breakeven_customer_price_y15(self.cons)
        self.assertAlmostEqual(d, 182.739 * 1e6 / (1825000 * 9.9), places=2)
        self.assertEqual(round(m.breakeven_customer_price_y15(self.cons, 300.0)), 560)

    def test_headline_numbers_at_300(self):
        """The numbers the README and the page quote for a $300/kg quote (m = 1)."""
        m = self.model
        r = m.summarize(self.cons, 300.0)
        self.assertEqual((round(r["fiber_purchase_M"]), round(r["total_capex_M"]), r["payback_year"], round(r["npv_10pct_M"])),
                         (183, 8924, 17, -4026))
        cis = m.summarize(m.for_tier(self.cons, "cislunar_revenue_gated_option"), 300.0)
        self.assertEqual((round(cis["fiber_purchase_M"]), round(cis["total_capex_M"]), cis["payback_year"]), (443, 13086, 22))
        p3 = m.summarize(m.for_tier(self.cons, "phase3_growth_option"), 300.0)
        self.assertEqual((round(p3["fiber_purchase_M"]), round(p3["total_capex_M"]), p3["payback_year"]), (4629, 80063, None))
        self.assertEqual(m.summarize(self.cons, 3000.0)["payback_year"], 19)
        self.assertEqual(m.summarize(m.for_tier(self.cons, "cislunar_revenue_gated_option"), 1000.0)["payback_year"], 23)


# ── 3. Thresholds and singles ────────────────────────────────────────────────────────────────

class TestThresholds(Base):
    def test_launch_threshold_closed_form(self):
        """Fiber bought must be paid for by cheaper launch of fiber_t × hmf kg: dL*/dp = −m/hmf."""
        m = self.model
        L0 = m.relaxation_threshold(self.cons, "construction_launch_per_kg")
        for mult in (1.0, 1.3):
            for p in (10, 100, 300, 1000):
                L = m.relaxation_threshold(self.cons, "construction_launch_per_kg", p, mult)
                self.assertAlmostEqual(L, L0 - p * mult / self.cons.hardware_mass_factor, delta=1e-6 * L0, msg=f"p={p} m={mult}")
        self.assertEqual(round(m.relaxation_threshold(self.cons, "construction_launch_per_kg", 300.0)), 1508)
        self.assertIsNone(m.relaxation_threshold(self.cons, "construction_launch_per_kg", 3000.0),
                          "at $3,000/kg even launch at 1/5 of conservative does not close")

    def test_directions_with_price(self):
        m = self.model
        grid = [0, 30, 100, 300, 1000]
        launch = [m.relaxation_threshold(self.cons, "construction_launch_per_kg", p) for p in grid]
        cadence = [m.relaxation_threshold(self.cons, "catches_per_day", p) for p in grid]
        price = [m.relaxation_threshold(self.cons, "customer_price_per_kg", p) for p in grid]
        derate = [m.relaxation_threshold(self.cons, "derate_fraction", p) for p in grid]
        capex = [m.relaxation_threshold(self.cons, "program_fleet_capex_M", p) for p in grid]
        self.assertEqual(launch, sorted(launch, reverse=True))
        self.assertEqual(derate, sorted(derate, reverse=True))
        self.assertEqual(capex, sorted(capex, reverse=True))
        self.assertEqual(cadence, sorted(cadence))
        self.assertEqual(price, sorted(price))
        self.assertTrue(all(x is not None for x in launch + cadence + price + derate + capex))
        self.assertTrue(all(m.relaxation_threshold(self.cons, "fixed_ops_M", p) is None for p in grid))

    def test_price_threshold_equals_breakeven_price(self):
        """Two routes to the same number: bisection on payback <= Y15 vs the closed-form Y15 breakeven."""
        m = self.model
        for p in (0, 100, 300, 3000):
            thr = m.relaxation_threshold(self.cons, "customer_price_per_kg", p)
            be = m.breakeven_customer_price_y15(self.cons, p)
            self.assertAlmostEqual(thr, be, delta=1e-6 * be, msg=f"p={p}")

    def test_single_stop_price_closed_form(self):
        """cum15(p) = cum15(0) − fiber_t·m·p/1000, so a single stops closing at p* = cum15(0)·1000/(fiber_t·m)."""
        m = self.model
        for f in ("construction_launch_per_kg", "derate_fraction", "program_fleet_capex_M", "catches_per_day"):
            for mult in (1.0, 1.3):
                s = m.set_input(self.cons, f, m.get_input(self.base, f))
                cum15 = sum(m.net_cash_flows_M(s, 0.0, mult, years=15))
                p_star = cum15 * 1000 / (m.fiber_mass_t(s) * mult)
                got = m.single_stop_price(self.cons, self.base, f, mult)
                self.assertAlmostEqual(got, p_star, delta=1e-6 * p_star, msg=f"{f} m={mult}")
                self.assertTrue(m.closes(s, p_star * (1 - 1e-6), mult))
                self.assertFalse(m.closes(s, p_star * (1 + 1e-6), mult))
        self.assertEqual(round(m.single_stop_price(self.cons, self.base, "construction_launch_per_kg")), 314)
        self.assertEqual(round(m.single_stop_price(self.cons, self.base, "program_fleet_capex_M")), 156)
        self.assertEqual(round(m.single_stop_price(self.cons, self.base, "derate_fraction")), 1210)
        self.assertEqual(round(m.single_stop_price(self.cons, self.base, "catches_per_day")), 12822)
        self.assertIsNone(m.single_stop_price(self.cons, self.base, "hardware_mass_factor"))
        self.assertIsNone(m.single_stop_price(self.cons, self.base, "fixed_ops_M"))

    def test_singles_at_300(self):
        m = self.model
        singles = {s["field"]: s for s in m.baseline_singles(self.cons, self.base, 300.0)}
        self.assertTrue(singles["construction_launch_per_kg"]["closes"])      # 300 < 314
        self.assertFalse(singles["program_fleet_capex_M"]["closes"])          # 300 > 156
        self.assertTrue(singles["derate_fraction"]["closes"])                 # 300 < 1210
        self.assertTrue(singles["catches_per_day"]["closes"])
        singles390 = {s["field"]: s for s in m.baseline_singles(self.cons, self.base, 300.0, 1.3)}
        self.assertFalse(singles390["construction_launch_per_kg"]["closes"])  # 390 > 314

    def test_payback_is_strictly_positive_cumulative(self):
        """skyhook_finance.py:273 pays back on cum > 0, not >= 0: an all-zero cash flow never pays back."""
        m = self.model
        zero = fs.replace(self.cons, customer_price_per_kg=0.0, program_fleet_capex_M=0.0, construction_launch_per_kg=0.0,
                          fixed_ops_M=0.0, ops_wear_per_kg=0.0, electricity_per_kwh=0.0)
        self.assertEqual(m.net_cash_flows_M(zero, 0.0, 1.0, years=20), [0.0] * 20)
        self.assertIsNone(m.payback_year(zero))
        self.assertFalse(m.closes(zero))

    def test_relaxation_threshold_on_a_case_that_already_closes(self):
        m = self.model
        self.assertEqual(m.relaxation_threshold(self.base, "customer_price_per_kg"), self.base.customer_price_per_kg)


# ── 4. Command line ──────────────────────────────────────────────────────────────────────────

class TestCLI(unittest.TestCase):
    def test_help(self):
        r = run("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("--quote", r.stdout)
        self.assertIn("--multiplier", r.stdout)

    def test_bare_quote_refuses_with_the_null_input_message(self):
        r = run("--quote", "--no-sweep")
        self.assertEqual(r.returncode, 2)
        self.assertIn("economics.fiber_cost_per_kg is null", r.stderr)
        self.assertIn("what would help", r.stderr)
        self.assertNotIn("QUOTE-DAY CARD", r.stdout)
        self.assertNotIn("adds $", r.stdout)
        self.assertIn("gate: 19 of 19", r.stdout)

    def test_quote_300_prints_the_card(self):
        r = run("--quote", "300", "--no-sweep")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("QUOTE-DAY CARD — fiber at $300/kg × 1.00", r.stdout)
        self.assertIn("adds $183M capex ($8,741M -> $8,924M, +2.1%) | payback Y17* -> Y17* | NPV@10% -$3,883M -> -$4,026M", r.stdout)
        self.assertIn("1,476.3 t fiber", r.stdout)
        self.assertIn("adds $443M capex ($12,644M -> $13,086M", r.stdout)
        self.assertIn("15,429.8 t fiber", r.stdout)
        self.assertIn("adds $4,629M capex ($75,434M -> $80,063M", r.stdout)
        self.assertIn("launch <= $1,674 -> $1,508", r.stdout)
        self.assertIn("economics.fiber_cost_per_kg = 300", r.stdout)
        self.assertNotIn("SWEEP", r.stdout)

    def test_default_run_prints_no_card(self):
        r = run()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("SWEEP", r.stdout)
        self.assertIn("QUOTE CARD: not printed", r.stdout)
        self.assertNotIn("QUOTE-DAY CARD", r.stdout)
        self.assertIn("stops closing at $314/kg", r.stdout)
        self.assertIn("MARKERS", r.stdout)
        self.assertIn("mp001_market_pricing.md:24", r.stdout)

    def test_bad_arguments(self):
        for args in (["--quote", "abc"], ["--quote", "-5"], ["--quote", "nan"], ["--multiplier", "0", "--quote", "300"],
                     ["--prices", "-1,5"]):
            r = run(*args, "--no-sweep")
            self.assertEqual(r.returncode, 2, args)

    def test_output_is_byte_identical_across_runs(self):
        a, b = run("--quote", "300"), run("--quote", "300")
        self.assertEqual(a.stdout, b.stdout)
        c, d = run("--json", "--quote", "300", "--multiplier", "1.3"), run("--json", "--quote", "300", "--multiplier", "1.3")
        self.assertEqual(c.stdout, d.stdout)
        self.assertEqual(json.loads(c.stdout)["quote_card"]["effective_price_per_kg"], 390.0)

    def test_json_shape(self):
        r = run("--json", "--quote", "300")
        self.assertEqual(r.returncode, 0)
        d = json.loads(r.stdout)
        self.assertTrue(d["gate"]["ok"])
        self.assertEqual(len(d["study"]["sweep"]), 7)
        self.assertEqual([step["fiber_price_per_kg"] for step in d["study"]["sweep"]], [0, 10, 30, 100, 300, 1000, 3000])
        self.assertEqual(len(d["study"]["sweep"][0]["rows"]), 5)
        self.assertEqual(len(d["study"]["markers"]), 5)
        self.assertEqual(d["quote_card"]["rev_a_key_to_fill"], "economics.fiber_cost_per_kg")
        self.assertIsNone(d["refusal"])
        r2 = run("--json", "--quote")
        self.assertEqual(r2.returncode, 2)
        d2 = json.loads(r2.stdout)
        self.assertIsNone(d2["quote_card"])
        self.assertIn("null", d2["refusal"]["what"])

    def test_reference_json_is_current(self):
        """reference.json (the fixture model.test.mjs reconciles the JS port against) equals a fresh run."""
        r = run("--json", "--quote", "300")
        self.assertEqual(r.stdout, (HERE / "reference.json").read_text(encoding="utf-8"))

    def test_gate_failure_exits_2_before_any_sweep(self):
        ladder = json.loads((SNAP / "ladder.json").read_text(encoding="utf-8"))
        ladder["columns"]["Conservative"]["construction_launch_per_kg"] = 2600.0
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "ladder.json"
            p.write_text(json.dumps(ladder), encoding="utf-8")
            r = run("--ladder", str(p), "--quote", "300")
        self.assertEqual(r.returncode, 2)
        self.assertIn("REFUSING", r.stdout)
        self.assertIn("BAD Conservative total capex $M", r.stdout)
        self.assertNotIn("SWEEP", r.stdout)
        self.assertNotIn("QUOTE-DAY CARD", r.stdout)

    def test_a_filled_rev_a_key_is_read_by_bare_quote(self):
        params = json.loads((SNAP / "rev_a.excerpt.json").read_text(encoding="utf-8"))
        params["economics"]["fiber_cost_per_kg"] = 300
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rev_a.json"
            p.write_text(json.dumps(params), encoding="utf-8")
            r = run("--params", str(p), "--quote", "--no-sweep")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("price source: rev_a.json economics.fiber_cost_per_kg", r.stdout)
        self.assertIn("adds $183M capex", r.stdout)

    def test_example_txt_is_a_real_run(self):
        """example.txt is blocks of '$ command', its stdout, its stderr and '[exit N]'; each re-runs identically."""
        text = (HERE / "example.txt").read_text(encoding="utf-8")
        blocks = re.split(r"^(?=\$ )", text, flags=re.M)
        blocks = [b for b in blocks if b.strip()]
        self.assertGreaterEqual(len(blocks), 3)
        for b in blocks:
            cmd, _, body = b.partition("\n")
            argv = shlex.split(cmd[2:])
            self.assertEqual(argv[0], "python3")
            r = subprocess.run([sys.executable, "-B", *argv[1:]], cwd=BANK, capture_output=True, text=True, env=ENV)
            want = r.stdout + (r.stderr if r.stderr else "") + f"[exit {r.returncode}]\n"
            self.assertEqual(body.rstrip("\n") + "\n", want.rstrip("\n") + "\n", cmd)


# ── 5. The snapshots and the page data ───────────────────────────────────────────────────────

class TestData(Base):
    def test_ladder_shape_and_anti_conflation(self):
        ladder = json.loads((SNAP / "ladder.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(ladder["columns"]), sorted(fs.COLUMNS))
        for col in fs.COLUMNS:
            self.assertEqual(len(ladder["columns"][col]), 14)
            self.assertEqual(ladder["columns"][col]["tip_speed_kms"], self.params["kinematics"]["v_tip_kms"],
                             "every column runs the reference tip speed; conservatism is derate only (DECISION_LOG item 6)")
        self.assertEqual([ladder["columns"][c]["strength_retention"] for c in fs.COLUMNS], [0.7, 0.85, 1.0])
        self.assertAlmostEqual(1 - ladder["columns"]["Conservative"]["strength_retention"], self.params["materials"]["derate_fraction"])
        self.assertEqual(ladder["rows"]["construction_launch_per_kg"]["row"], 5)
        self.assertEqual(ladder["_meta"]["commit"][:7], "34935cb")

    def test_markers_match_the_mp001_snapshot(self):
        markers = json.loads((SNAP / "markers.json").read_text(encoding="utf-8"))["markers"]
        mp = next(m for m in markers if m["id"] == "mp001_marketplace_proxy")
        self.assertEqual(mp["prices_per_kg"], {"conservative": 300.0, "baseline": 259.0, "optimistic": 170.0})
        self.assertEqual(self.mp001.splitlines()[mp["line"] - 1], mp["text"])
        self.assertIn("not** a Toyobo quote", mp["text"])
        ids = {m["id"]: m for m in markers}
        self.assertEqual(ids["inspace_fork_surface_placeholder"]["prices_per_kg"], {"placeholder": 1000.0})
        self.assertEqual(ids["stress_test_sim_default"]["prices_per_kg"], {"default": 250.0})
        self.assertEqual(fs.PUBLISHED["cislunar"]["construction_launch_break_even_for_500_per_kg_customer_price"], 686)

    def test_markers_are_never_defaults(self):
        self.assertEqual(fs.DEFAULT_PRICES[0], 0.0)
        src = (HERE / "fiber_sweep.py").read_text(encoding="utf-8")
        self.assertNotRegex(src, r"default\s*=\s*(300|259|170|250|1000)\b")
        self.assertIsNone(fs.build_parser().get_default("quote"))

    def test_every_snapshot_has_a_sidecar_at_the_commit(self):
        for f in SNAP.iterdir():
            if f.name.endswith(".provenance.json"):
                continue
            side = json.loads(Path(str(f) + ".provenance.json").read_text(encoding="utf-8"))
            self.assertEqual(side["commit"][:7], "34935cb", f.name)
            self.assertTrue(side["readMatchesCommitted"], f.name)
            self.assertIn("skyhook", side["repo"])

    def test_data_js_embeds_the_snapshots(self):
        import hashlib
        js = (HERE / "data.js").read_text(encoding="utf-8")
        body = js[js.index("window.NullInputData = ") + len("window.NullInputData = "):].rstrip().rstrip(";")
        d = json.loads(body)
        for name in ("rev_a.excerpt.json", "ladder.json", "markers.json"):
            self.assertEqual(d["snapshot_sha256"][name], hashlib.sha256((SNAP / name).read_bytes()).hexdigest(), name)
        self.assertEqual(d["ladder"]["columns"], json.loads((SNAP / "ladder.json").read_text(encoding="utf-8"))["columns"])
        self.assertEqual(d["rev_a"], self.params)
        self.assertEqual(d["published"]["columns"]["Conservative"]["total_capex_M"], 8741)
        self.assertEqual(d["price_grid"], list(fs.DEFAULT_PRICES))
        self.assertTrue(all(v is not None for v in d["provenance"].values()))

    @unittest.skipUnless((SKYHOOK / "tools/financial/skyhook_financial_model.xlsx").exists(), "Skyhook checkout not present")
    def test_ladder_rederives_from_the_workbook(self):
        import build_data
        fresh = build_data.derive_ladder(SKYHOOK)
        saved = json.loads((SNAP / "ladder.json").read_text(encoding="utf-8"))
        self.assertEqual(fresh["columns"], saved["columns"])
        self.assertEqual(fresh["_meta"]["xlsx_sha256"], saved["_meta"]["xlsx_sha256"])
        fresh_m = build_data.derive_markers(SKYHOOK)
        saved_m = json.loads((SNAP / "markers.json").read_text(encoding="utf-8"))
        self.assertEqual([m["prices_per_kg"] for m in fresh_m["markers"]], [m["prices_per_kg"] for m in saved_m["markers"]])
        r = subprocess.run([sys.executable, "-B", str(HERE / "build_data.py"), str(SKYHOOK), "--check"],
                           capture_output=True, text=True, env=ENV, cwd=BANK)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    @unittest.skipUnless((SKYHOOK / "finance/skyhook_finance.py").exists(), "Skyhook checkout not present")
    def test_mirrors_the_live_finance_module(self):
        """When the checkout is present (and openpyxl is installed there), the live module's numbers equal ours."""
        code = (
            "import sys, json; sys.path.insert(0, sys.argv[1])\n"
            "from finance.skyhook_finance import *\n"
            "L = load_ladder_from_workbook(); out = {}\n"
            "for n in SCENARIOS:\n"
            "    s = L[n]; out[n] = [total_capex_M(s), payback_year(s), npv_M(s, 0.10), breakeven_customer_price_y15(s), fiber_mass_t(s)]\n"
            "c = L['Conservative']\n"
            "for t in load_tiers_from_params():\n"
            "    s = scenario_for_tier(c, t); out[t] = [total_capex_M(s), payback_year(s), npv_M(s, 0.10), breakeven_customer_price_y15(s), fiber_mass_t(s)]\n"
            "print(json.dumps(out))\n")
        r = subprocess.run([sys.executable, "-B", "-c", code, str(SKYHOOK)], capture_output=True, text=True, env=ENV, cwd=tempfile.gettempdir())
        if r.returncode != 0:
            self.skipTest(f"live module not runnable here: {r.stderr.strip().splitlines()[-1] if r.stderr else r.returncode}")
        live = json.loads(r.stdout)
        m = self.model
        for key, vals in live.items():
            s = self.ladder[key] if key in fs.COLUMNS else m.for_tier(self.cons, key)
            ours = [m.total_capex_M(s), m.payback_year(s), m.npv_M(s, 0.10), m.breakeven_customer_price_y15(s), m.fiber_mass_t(s)]
            self.assertEqual(ours[1], vals[1], key)
            for a, b in zip((ours[0], ours[2], ours[3], ours[4]), (vals[0], vals[2], vals[3], vals[4])):
                self.assertAlmostEqual(a, b, delta=1e-9 * max(1.0, abs(b)), msg=key)


if __name__ == "__main__":
    unittest.main()
