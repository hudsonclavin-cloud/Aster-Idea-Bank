"""Tests for reboost_bound_rev_a.py, the Python twin of ledger.js.

Run from the bank root: python3 -m unittest discover -s ideas/30-momentum-ledger -p 'test_*.py'

Teeth: the Python and the JavaScript are written separately; these tests make them agree to 1e-9 on
five configurations, pin the Python to params/rev_a.json's printed C3 and apogee, and check the CLI's
exit codes and that example.txt is its current output.
"""
import contextlib
import io
import json
import math
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True
import reboost_bound_rev_a as rb  # noqa: E402

CONFIGS = [
    ("reference", "0.3", 200.0, "canon"),
    ("reference", "0", 200.0, "canon"),
    ("reference", "0.15", 0.0, "loaded"),
    ("cislunar", "0.3", 200.0, "canon"),
    ("phase3", "0.3", 1000.0, "loaded"),
]


def run_cli(*args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = rb.main(list(args))
        except SystemExit as e:  # argparse --help / usage
            code = e.code
    return code, out.getvalue(), err.getvalue()


class CanonPins(unittest.TestCase):
    def setUp(self):
        self.rev_a = json.loads((HERE / "snapshots/rev_a.json").read_text(encoding="utf-8"))

    def result(self, *args):
        code, out, _ = run_cli("--json", *args)
        self.assertEqual(code, 0)
        return json.loads(out)

    def test_release_c3_and_apogee_match_rev_a(self):
        k = self.rev_a["kinematics"]
        en = self.result()["energy"]
        self.assertEqual(round(en["c3_km2s2"], 2), k["c3_kms2"])
        self.assertEqual(round(en["apogee_alt_km"]), k["apogee_altitude_km"])
        cis = self.result("--tier", "cislunar")["energy"]
        self.assertEqual(round(cis["c3_km2s2"], 2), k["cislunar_revenue_gated_option"]["c3_kms2"])
        self.assertEqual(round(cis["apogee_alt_km"]), k["cislunar_revenue_gated_option"]["apogee_altitude_km"])
        p3 = self.result("--tier", "phase3")["energy"]
        self.assertEqual(round(p3["c3_km2s2"], 2), k["phase3_growth_option"]["c3_kms2"])
        self.assertIsNone(p3["apogee_alt_km"])  # escape: JSON writes inf as null

    def test_energy_split_and_ledger_headline(self):
        res = self.result()
        en, led = res["energy"], res["ledger"]
        self.assertAlmostEqual(en["dE_per_kg_MJ"], en["momentum_view_MJ"] + en["lift_term_MJ"], places=12)
        self.assertEqual(f"{en['dE_per_kg_MJ']:.2f}", "43.03")
        self.assertEqual(f"{en['momentum_view_MJ']:.2f}", "37.78")
        self.assertEqual(f"{led['M_t']:.1f}", "809.1")
        self.assertEqual(f"{led['da_km']:.1f}", "64.4")
        self.assertEqual(f"{led['tip_lowest_alt_km']:.1f}", "165.1")
        self.assertEqual(res["throws_above_floor"], {"apogee": 0, "perigee": 0})

    def test_sizing_rule_reads_the_founding_document(self):
        res = self.result()
        self.assertEqual(res["intervals_d"], [5.0, 10.0])
        self.assertEqual(res["mature_interval_d"], 1.0)
        self.assertEqual(res["margin"], 0.3)
        row = next(r for r in res["required_power"] if r["eta"] == 0.26 and r["duty"] == 0.5)
        self.assertEqual(f"{row['10d_kw'] / 1e3:.2f}", "2.49")
        self.assertEqual(f"{row['5d_kw'] / 1e3:.2f}", "4.98")
        cons = res["workbook_cadence"][0]
        self.assertEqual((cons["column"], cons["eta"], cons["catches_per_day"]), ("Conservative", 0.15, 1.0))
        self.assertEqual(f"{cons['duty_0.5_mw']:.1f}", "43.2")


@unittest.skipUnless(shutil.which("node"), "node not installed")
class AgreesWithJavaScript(unittest.TestCase):
    def test_five_configurations(self):
        script = r"""
const K=require(process.argv[1]+'/ledger.js'), D=require(process.argv[1]+'/data.js');
const RE=parseFloat(D.values['skyhook_physics.r_earth_km'].text);
const out=JSON.parse(process.argv[2]).map(([tier,derate,hub,release])=>{
  const s=K.system(D.revA,{tier,derate,hubKg:hub*1e3,earthRadiusKm:RE,release});
  const e=K.energy(s), l=K.ledger(s);
  return {perKg:e.perKg, c3:e.c3, M:s.M, da:l.da, rp:l.perigeeDrop, ra:l.apogeeDrop, tip:l.tipLowestAfter, dv:l.dvEquiv,
          floorA:K.catchesToFloor(s,150e3,'apogee').count, floorP:K.catchesToFloor(s,150e3,'perigee').count};
});
console.log(JSON.stringify(out));
"""
        r = subprocess.run(["node", "-e", script, str(HERE), json.dumps(CONFIGS)], capture_output=True, text=True, check=True)
        js = json.loads(r.stdout)
        for cfg, j in zip(CONFIGS, js):
            tier, derate, hub, release = cfg
            code, out, _ = run_cli("--json", "--tier", tier, "--derate", derate, "--hub-t", str(hub), "--release", release, "--floor-km", "150")
            self.assertEqual(code, 0)
            p = json.loads(out)
            pairs = [(p["energy"]["dE_per_kg_MJ"] * 1e6, j["perKg"]), (p["energy"]["c3_km2s2"] * 1e6, j["c3"]),
                     (p["ledger"]["M_t"] * 1e3, j["M"]), (p["ledger"]["da_km"] * 1e3, j["da"]),
                     (p["ledger"]["perigee_drop_km"] * 1e3, j["rp"]), (p["ledger"]["apogee_drop_km"] * 1e3, j["ra"]),
                     (p["ledger"]["tip_lowest_alt_km"] * 1e3, j["tip"]), (p["ledger"]["dv_equiv_ms"], j["dv"])]
            for py, jv in pairs:
                self.assertTrue(math.isclose(py, jv, rel_tol=1e-9, abs_tol=1e-6), f"{cfg}: python {py} vs js {jv}")
            self.assertEqual(p["throws_above_floor"], {"apogee": j["floorA"], "perigee": j["floorP"]}, cfg)


class CommandLine(unittest.TestCase):
    def test_help_and_usage(self):
        code, out, _ = run_cli("--help")
        self.assertEqual(code, 0)
        self.assertIn("--tier", out)
        code, _, _ = run_cli("--tier", "jupiter")
        self.assertEqual(code, 3)

    def test_refusals_exit_2_with_a_structured_reason(self):
        for args, code_name in [(("--tier", "cislunar", "--derate", "0.15"), "insufficient_data"),
                                (("--payload-kg", "6000"), "out_of_envelope"),
                                (("--hub-t", "-5"), "invalid_input")]:
            code, out, _ = run_cli(*args)
            self.assertEqual(code, 2, args)
            j = json.loads(out)
            self.assertTrue(j["refused"])
            self.assertEqual(j["code"], code_name)
            self.assertTrue(j["what_would_help"])

    def test_floor_at_design_altitude_is_refused_in_the_report(self):
        code, out, _ = run_cli("--json", "--floor-km", "290")
        self.assertEqual(code, 0)
        self.assertIn("refused", json.loads(out)["throws_above_floor"])

    def test_example_txt_is_the_current_output(self):
        code, out, _ = run_cli()
        self.assertEqual(code, 0)
        self.assertEqual((HERE / "example.txt").read_text(encoding="utf-8"), out)


if __name__ == "__main__":
    unittest.main()
