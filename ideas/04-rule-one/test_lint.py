"""Tests for Rule One (lint_canon.py). Run from the bank root:

    python3 -m unittest discover -s ideas/04-rule-one -p 'test_*.py'

What is pinned to something outside this code:
  * the five published Rev A mass ratios (40.32 / 64.30 / 121.83 / 295.27 /
    3085.95) are recomputed from the snapshot's sigma, rho, SF and tip speeds
    with EQ-6 and must reproduce the snapshot's own values to two decimals;
  * the rows of docs/DEVIATIONS.md (snapshotted) decide the classes, and row 8's
    0.60 / 0.72 / 0.85 rungs are what the scanner must find at
    skyhook_program_site.html:1135;
  * the quote card must carry the sha256 the bank's provenance sidecar recorded;
  * the fixture tree, excerpted line-for-line from the Skyhook checkout at
    34935cb, must give exactly the file:line findings listed below;
  * when the Skyhook checkout at that commit is present, a fresh run must equal
    example.txt line for line (the generation stamp aside).
"""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP_REV_A = os.path.join(HERE, "snapshots", "rev_a.json")
SNAP_DEV = os.path.join(HERE, "snapshots", "DEVIATIONS.md")
FIXTURES = os.path.join(HERE, "snapshots", "fixtures")
SCRIPT = os.path.join(HERE, "lint_canon.py")

_spec = importlib.util.spec_from_file_location("lint_canon", SCRIPT)
LC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LC)

PARAMS, SHA = LC.load_params(SNAP_REV_A)
FLAT = LC.flatten(PARAMS)
with open(SNAP_DEV, encoding="utf-8") as _fh:
    ALLOW = LC.parse_deviations(_fh.read())
with open(SNAP_REV_A + ".provenance.json", encoding="utf-8") as _fh:
    SIDECAR = json.load(_fh)
MR = "mass_ratio.integrated_tether_to_payload_both_arms."


def scan(text, path="docs/note.md", allow=None):
    sup, dec = [], []
    findings = LC.scan_text(text, path, PARAMS, FLAT, ALLOW if allow is None else allow, sup, dec)
    return findings, sup


def by_cls(findings, cls):
    return [f for f in findings if f["cls"] == cls]


def run_cli(*args, cwd=HERE):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, cwd=cwd)


class RoundingRule(unittest.TestCase):
    def test_literal_matches_canon_at_its_own_precision(self):
        cases = [("122", 121.83), ("121.8", 121.83), ("121.83", 121.83), ("121.826", 121.83), ("40", 40.32),
                 ("85,200", 85222), ("600", 609.1), ("3,086", 3085.95), ("3,000", 3085.95), ("7.6", 7.55), ("7.5", 7.55),
                 ("2.7", 2.73), ("1", 1.0), ("13", 13.4), ("2", 1.99), ("2.0", 1.99), ("10", 10.06), ("4.591", 4.59)]
        for lit, canon in cases:
            self.assertTrue(LC.rounds_to(lit, canon), f"{lit} should be a fair rounding of {canon}")

    def test_literal_that_is_not_a_rounding(self):
        cases = [("100", 121.83), ("200", 121.83), ("41", 40.32), ("600", 640), ("3", 2.5), ("2", 2.5), ("5", 2.5),
                 ("10.05", 10.06), ("0.6", 0.7), ("2500", 2.5), ("3.9", 3.6), ("0.72", 0.85)]
        for lit, canon in cases:
            self.assertFalse(LC.rounds_to(lit, canon), f"{lit} must not pass as {canon}")

    def test_scales_and_fraction_floor(self):
        self.assertFalse(LC.rounds_to("3.9e9", 3.6, 1e-9))
        self.assertTrue(LC.rounds_to("3.6e9", 3.6, 1e-9))
        self.assertTrue(LC.rounds_to("30", 0.3, 0.01))
        self.assertTrue(LC.rounds_to("2500", 2.5, 1e-3))
        # A round rung must not be read at integer precision: 0.6 is not a retention of 1.0
        # (the 5 % cap says so) and 0.4 is not a derate of 0 (only the 2-decimal floor says so,
        # since a canon of zero has no 5 % to cap with).
        self.assertFalse(LC.rounds_to("0.6", 1.0))
        self.assertFalse(LC.rounds_to("0.6", 1.0, 1.0, 2))
        self.assertTrue(LC.rounds_to("0.4", 0.0))
        self.assertFalse(LC.rounds_to("0.4", 0.0, 1.0, 2))
        self.assertTrue(LC.rounds_to("1", 1.0, 1.0, 2))
        self.assertTrue(LC.rounds_to("0", 0.0, 1.0, 2))

    def test_range_brackets_canon(self):
        self.assertTrue(LC.range_brackets("40", "122", 40.32))
        self.assertTrue(LC.range_brackets("2.7", "2.8", 2.73))
        self.assertTrue(LC.range_brackets("10", "30", 18))
        self.assertFalse(LC.range_brackets("100", "150", 290))
        self.assertFalse(LC.range_brackets("1.5", "2.0", 2.5))


class CanonReconciliation(unittest.TestCase):
    """EQ-6 from the snapshot's own inputs must give the snapshot's published ladder."""

    def test_published_ladder_reproduces(self):
        rows = {r["quantity"]: r for r in LC.verify_canon(PARAMS)}
        for key in ("optimistic_0pct_derate", "baseline_15pct_derate", "conservative_30pct_derate",
                    "cislunar_2p8kms_30pct_derate", "phase3_3p5kms_30pct_derate"):
            r = rows[f"mass ratio {key} (x)"]
            self.assertTrue(r["ok"], f"{key}: computed {r['computed']} vs canon {r['canon']}")
            self.assertAlmostEqual(r["computed"], FLAT[MR + key], places=1)
        # The published conservative figure the rest of the repository quotes (README, DECISION_LOG, CLAUDE.md).
        self.assertEqual(FLAT[MR + "conservative_30pct_derate"], 121.83)
        self.assertEqual(FLAT[MR + "optimistic_0pct_derate"], 40.32)
        self.assertEqual(FLAT[MR + "phase3_3p5kms_30pct_derate"], 3085.95)

    def test_exact_vc_not_rounded_vc_reproduces_the_ladder(self):
        vc_exact = (2 * PARAMS["materials"]["tensile_strength_GPa"] * 1e9 / PARAMS["materials"]["density_kgm3"]) ** 0.5 / 1e3
        sf = PARAMS["materials"]["safety_factor"]
        vt = PARAMS["kinematics"]["v_tip_kms"]
        self.assertAlmostEqual(LC.integrated_mass_ratio(vt, vc_exact, sf, 0.30), 121.83, places=2)
        self.assertNotAlmostEqual(LC.integrated_mass_ratio(vt, PARAMS["materials"]["V_c_kms"], sf, 0.30), 121.83, places=0)

    def test_three_derived_values_disagree_with_the_file(self):
        # A finding about the source repo, pinned so a future rev_a.json edit shows up here:
        # com_radius_km 6988 implies R_E 6378 while every kinematic value uses 6371.
        bad = sorted(r["quantity"] for r in LC.verify_canon(PARAMS) if not r["ok"])
        self.assertEqual(bad, ["CoM radius (km)", "v_orb from R_E + altitude (km/s)", "v_upper_release via com_radius_km (km/s)"])
        rows = {r["quantity"]: r for r in LC.verify_canon(PARAMS)}
        self.assertEqual(rows["CoM radius (km)"]["computed"], 6981.0)
        self.assertTrue(rows["C3 reference (km^2/s^2)"]["ok"])
        self.assertTrue(rows["apogee reference (km)"]["ok"])
        self.assertTrue(rows["apogee cislunar (km)"]["ok"])


class PlantedDrift(unittest.TestCase):
    def one(self, text, rule, cls="NEW", path="docs/note.md"):
        findings, _ = scan(text, path)
        hits = [f for f in findings if f["rule"] == rule]
        self.assertEqual(len(hits), 1, f"expected one {rule} finding in {text!r}, got {[(f['rule'], f['found'], f['cls']) for f in findings]}")
        self.assertEqual(hits[0]["cls"], cls)
        return hits[0]

    def test_sk99_prose_and_code(self):
        f = self.one("Dyneema SK99 is rated at 3.9 GPa in the calculator.", "sigma_sk99")
        self.assertEqual(f["canon"][0]["key"], "materials.alternative_fibers.Dyneema_SK99_GPa")
        self.assertEqual(f["canon"][0]["value"], 3.6)
        f = self.one('  "Dyneema SK99": { sigma: 3.9e9, rho: 970 },', "sigma_sk99", path="tools/sims/calc.jsx")
        self.assertEqual(f["found"], "3.9e9")

    def test_retention_and_ladder(self):
        self.one("The baseline strength retention 0.72 drives the mass ratio.", "derate")
        findings, _ = scan("const LADDER = {\n  Conservative: { derate: 0.6 },\n  Baseline: { derate: 0.72 },\n  Optimistic: { derate: 0.85 },\n};", "tools/x.jsx")
        rungs = [(f["what"].split()[0], f["found"]) for f in findings if f["rule"] == "ladder"]
        self.assertEqual(rungs, [("Conservative", "0.6"), ("Baseline", "0.72"), ("Optimistic", "0.85")])
        self.assertIn("optimistic_0pct_derate", findings[-1]["canon"][0]["key"])

    def test_stale_patterns(self):
        f = self.one("The tether masses 440× its payload.", "x440_unlabelled")
        self.assertEqual(f["canon"][0]["value"], FLAT[MR + "phase3_3p5kms_30pct_derate"])
        self.one("our 100–200× planning range", "x100_200")
        self.one("our 100-200x planning range", "x100_200")
        f = self.one("The tip speed is 3.5 km/s.", "v35_unlabelled")
        self.assertEqual(f["canon"][0]["value"], 2.5)
        self.one("const VTIP=3.5;", "v35_unlabelled", path="tools/sims/theater.html")

    def test_schema_paths(self):
        f = self.one("const r = revA.mass_ratio.nope_key[1] * 2;", "schema", path="tools/x.js")
        self.assertEqual(f["found"], "mass_ratio.nope_key")
        self.assertIn("integrated_tether_to_payload_both_arms", f["canon"][0]["value"])
        self.one('PARAMS["kinematics"]["v_tip"]', "schema", path="physics/x.py")
        self.one('REQUIRED = [["materials", "sigma_GPa"]]', "schema", path="tools/x.js")
        findings, _ = scan("x = revA.kinematics.v_tip_kms + params['materials']['V_c_kms'] + data.orbital.v_orb_kms", "tools/x.js")
        self.assertEqual(findings, [])

    def test_quantities(self):
        self.one("lower tip grazes ~100–150 km above the ground", "lower_tip_alt")
        self.one("a 600 km structure sweeping through LEO", "total_length")
        self.one("Zylon PBO at 5.6 GPa and 1560 kg/m³", "sigma_zylon")
        self.one("Zylon density 1,700 kg/m³", "rho_zylon")  # 1,600 would pass: 2.6 % is inside the 3 % trailing-zero rule
        self.one("apogee of roughly 90,000 km", "apogee")
        self.one("the dedicated Falcon 9 anchor at $2,835/kg", "launch_dedicated")
        self.one("TSS-1R flew 20.5 km of tether", "heritage_tss")
        self.one("the rotation period is 15 min", "rotation_period")
        self.one("release speed 10.5 km/s at the upper tip", "v_release")

    def test_regression_against_an_executed_row(self):
        findings, _ = scan('<input id="vtip" value="3.5">', "tools/sims/skyhook_program_site.html")
        self.assertEqual([f["cls"] for f in findings], ["NEW"])
        self.assertIn("Regression: DEVIATIONS #2", findings[0]["note"])

    def test_leave_row_is_accepted(self):
        findings, _ = scan("const ALT=610, L=320, VTIP=3.5;", "tools/sims/skyhook_orbit_theater.html")
        self.assertEqual([(f["cls"], f["deviation"]["no"]) for f in findings], [("ACCEPTED", 4)])

    def test_open_row_is_known_open(self):
        findings, _ = scan("var LAD={Conservative:{d:.6,loss:1800},Baseline:{d:.72},Optimistic:{d:.85}};", "tools/sims/skyhook_program_site.html")
        self.assertEqual([(f["cls"], f["deviation"]["no"], f["found"]) for f in findings],
                         [("KNOWN OPEN", 8, ".6"), ("KNOWN OPEN", 8, ".72"), ("KNOWN OPEN", 8, ".85")])


class AcceptableSilence(unittest.TestCase):
    def silent(self, text, path="docs/note.md"):
        findings, _ = scan(text, path)
        self.assertEqual([f for f in findings if f["cls"] in ("NEW", "KNOWN OPEN", "ACCEPTED")], [],
                         f"{text!r} produced {[(f['rule'], f['found'], f['cls']) for f in findings]}")
        return findings

    def test_roundings_of_canon(self):
        self.silent("a conservative 122× at 30 % derate")
        self.silent("the integrated two-arm mass ratio is 121.826× payload")
        self.silent("40× at 0 % derate, 64× at 15 %, and 122× at 30 %")
        self.silent("Dyneema SK99 3.6 GPa, T1100G ~7.0 GPa, Zylon 5.8 GPa and 1,560 kg/m³")
        self.silent("an apogee of roughly 85,200 km; the 2.8 km/s option reaches 397,819 km")
        self.silent("V_c ≈ 2.7–2.8 km/s today, orbital speed 7.55 km/s, release at ~10.06 km/s")
        self.silent("At Rev A reference (v_tip = 2.5 km/s, V_c = 2.73 km/s, SF = 2.5, no derate)")
        self.silent("the fiber mass is 609 t for the 5 t payload; ~600 t of Zylon")
        self.silent("v_tip 2.8 km/s reaches TLI; 3.3–3.5 km/s is Mars-class; the GTO threshold is 2.1 km/s")

    def test_labelled_options_are_not_findings(self):
        findings = self.silent("Mars-class escape is retained as a 3.5 km/s Phase 3 growth option")
        self.assertEqual(findings, [])
        self.silent("~3,086× at 3.5 km/s, the Phase 3 Mars-class option")
        self.silent("The historical unsourced 440× figure was chased to ground.")
        self.silent("the workbook had tip speed at 2.0 / 2.8 / 3.5 km/s across the ladder")
        self.silent("5.0 km/s at a 3.5 km/s effective exhaust velocity")

    def test_bounds_expressions_and_sinks(self):
        self.silent("the case closes if derate ≤ 21.2% or launch ≤ $1,674/kg")
        self.silent("v_orb + v_tip ≈ 10.06 km/s and v_orb − v_tip ≈ 5.1 km/s")
        self.silent("| Fiber @ 5 t payload | 609.1 t |")
        self.silent("a $550/kg anchor price; construction launch at $800/kg; Transporter $7,000/kg; Electron ~$25,000/kg")
        self.silent("Reaching LEO costs ≈ 9.3–9.5 km/s of Δv; required Δv falls to ≈ 6.9 km/s")
        self.silent("Our launch segment needs only ~4 km/s (~45 % of orbital velocity)")
        self.silent("The Rev A reference (2.5 km/s) sits at 0.92 V_c")
        self.silent("Dyneema modulus 120 GPa; carbon T1000G 6.4 GPa; Spectra 3.5 GPa")
        self.silent("GTO (apogee 35,786 km); Mars (C3 ≈ 12 km²/s²)")
        self.silent("a_tip = v_tip^2/L = 1.99 g; v_tip = 2500 m/s", "tests/x.py")
        self.silent("v_tip = 0.5 * (v_req - v_circ)", "finance/x.py")

    def test_inertial_lower_tip_speed_is_derived_from_canon(self):
        self.silent("lifting the payload from the ~5.06 km/s inertial lower-tip speed")
        self.silent("catch 5.05 km/s ECI")

    def test_declared_other_parameter_set_is_patterns_only(self):
        text = "Config source: `params/service_mxer_draft.json` at `5cbaa5c`.\nReference config: CoM perigee 600 km / apogee 7418 km, L_half 150 km, v_tip 1.071031 km/s, catch altitude 450 km.\n"
        sup, dec = [], []
        findings = LC.scan_text(text, "finance/REBOOST_BOUND_FINDINGS.md", PARAMS, FLAT, ALLOW, sup, dec)
        self.assertEqual(findings, [])
        self.assertEqual(dec, ["finance/REBOOST_BOUND_FINDINGS.md"])
        sup, dec = [], []
        findings = LC.scan_text("| v_tip | 1.071 km/s |", "docs/mentions_mxer_in_passing.md", PARAMS, FLAT, ALLOW, sup, dec)
        self.assertEqual([f["rule"] for f in findings], ["v_tip"])
        self.assertEqual(dec, [])


class Labelled(unittest.TestCase):
    def test_correction_banner_values_are_labelled_not_hidden(self):
        text = ("> **CANON CORRECTION (25 Aug 2026).** Reference numbers: catch 5.05 km/s ECI, release 10.05 km/s, "
                "tip 2.0 g, mass ratio ~41× (65×/123× at 15%/30% derate).")
        findings, _ = scan(text, "docs/program_manifest.md")
        self.assertEqual(sorted((f["rule"], f["found"], f["cls"]) for f in findings),
                         [("mass_ratio", "123 x", "LABELLED"), ("mass_ratio", "41 x", "LABELLED"),
                          ("mass_ratio", "65 x", "LABELLED"), ("v_release", "10.05 km/s", "LABELLED")])
        self.assertTrue(all(f["label"] for f in findings))

    def test_hypothetical_sf_is_labelled(self):
        findings, _ = scan("SF ≈ 5 would drive the mass ratio from ~41× to ~800×")
        self.assertEqual(sorted(f["cls"] for f in findings), ["LABELLED", "LABELLED", "LABELLED"])


class DeviationsRegister(unittest.TestCase):
    def test_rows_and_states(self):
        self.assertEqual([r["no"] for r in ALLOW], list(range(1, 10)))
        self.assertEqual({r["no"]: r["state"] for r in ALLOW},
                         {1: "accepted", 2: "fixed", 3: "accepted", 4: "accepted", 5: "accepted", 6: "fixed", 7: "accepted", 8: "open", 9: "fixed"})
        row8 = ALLOW[7]
        self.assertEqual(row8["paths"], ["tools/sims/skyhook_program_site.html"])
        for v in (0.6, 0.72, 0.85):
            self.assertIn(v, row8["values"])
        self.assertIn("meet our launch vehicle at, say, 3.5 km/s slower", ALLOW[4]["snippets"])
        self.assertIn("VTIP=3.5", ALLOW[3]["snippets"])


class FixtureTree(unittest.TestCase):
    """The excerpts under snapshots/fixtures keep the repository's line numbers."""

    @classmethod
    def setUpClass(cls):
        cls.sup, cls.dec = [], []
        cls.findings, cls.nfiles = LC.scan(FIXTURES, PARAMS, FLAT, ALLOW, cls.sup, cls.dec)

    def rows(self, cls_name):
        return [(f["path"], f["line"], f["rule"], f["found"], (f.get("deviation") or {}).get("no")) for f in by_cls(self.findings, cls_name)]

    def test_new(self):
        self.assertEqual(self.rows("NEW"), [
            ("docs/glossary.md", 27, "x100_200", "100–200×", None),
            ("docs/objections_faq.md", 38, "total_length", "600 km", None),
            ("tools/sims/skyhook_calculator.jsx", 11, "sigma_sk99", "3.9e9", None),
            ("tools/sims/skyhook_calculator.jsx", 20, "ladder", "0.6", None),
            ("tools/sims/skyhook_calculator.jsx", 21, "ladder", "0.72", None),
            ("tools/sims/skyhook_calculator.jsx", 22, "ladder", "0.85", None),
            ("tools/sims/skyhook_no_leo_stress_test.jsx", 48, "schema", "mass_ratio.tether_to_payload_single_arm_range", None),
            ("tools/sims/skyhook_program_site.html", 219, "lower_tip_alt", "100–150 km", None),
        ])

    def test_known_open(self):
        self.assertEqual(self.rows("KNOWN OPEN"), [
            ("tools/sims/skyhook_program_site.html", 1135, "ladder", ".6", 8),
            ("tools/sims/skyhook_program_site.html", 1135, "ladder", ".72", 8),
            ("tools/sims/skyhook_program_site.html", 1135, "ladder", ".85", 8),
        ])

    def test_accepted(self):
        self.assertEqual(self.rows("ACCEPTED"), [
            ("docs/original_README.md", 6, "v35_unlabelled", "3.5 km/s", 1),
            ("docs/project_instructions.md", 31, "v35_unlabelled", "3.5 km/s", 5),
            ("docs/project_instructions.md", 126, "v35_unlabelled", "3.5 km/s", 5),
            ("tools/sims/skyhook_orbit_theater.html", 39, "v35_unlabelled", "3.5 km/s", 4),
        ])

    def test_labelled(self):
        self.assertEqual(self.rows("LABELLED"), [
            ("docs/program_manifest.md", 6, "v_release", "10.05 km/s", None),
            ("docs/program_manifest.md", 6, "mass_ratio", "41 x", None),
            ("docs/program_manifest.md", 6, "mass_ratio", "65 x", None),
            ("docs/program_manifest.md", 6, "mass_ratio", "123 x", None),
            ("docs/program_manifest.md", 65, "sf", "5", None),
            ("docs/program_manifest.md", 65, "mass_ratio", "41 x", None),
        ])

    def test_skipped_pattern_mentions(self):
        self.assertEqual(len(self.sup), 18)
        self.assertIn(("docs/project_instructions.md", 46), [(s["path"], s["line"]) for s in self.sup])
        self.assertIn(("docs/program_manifest.md", 68), [(s["path"], s["line"]) for s in self.sup])
        self.assertEqual(self.dec, [])
        self.assertEqual(self.nfiles, 9)

    def test_stress_test_schema_finding_names_the_real_keys(self):
        f = [x for x in self.findings if x["rule"] == "schema"][0]
        self.assertEqual(f["canon"][0]["key"], "mass_ratio")
        self.assertEqual(f["canon"][0]["value"], ["_ratio_note", "integrated_tether_to_payload_both_arms", "tip_speed_to_Vc_ratio"])
        self.assertNotIn("tether_to_payload_single_arm_range", FLAT.__repr__())

    def test_every_fixture_has_a_sidecar_at_the_snapshot_commit(self):
        for dirpath, _, files in os.walk(FIXTURES):
            for fn in files:
                if fn.endswith(".provenance.json"):
                    continue
                side = os.path.join(dirpath, fn + ".provenance.json")
                self.assertTrue(os.path.exists(side), fn)
                with open(side, encoding="utf-8") as fh:
                    j = json.load(fh)
                self.assertEqual(j["commit"], SIDECAR["commit"])


class CommandLine(unittest.TestCase):
    def test_exit_1_on_new(self):
        r = run_cli(FIXTURES, "--params", SNAP_REV_A, "--deviations", SNAP_DEV)
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("Result: 8 NEW, 3 KNOWN OPEN, 4 ACCEPTED, 6 LABELLED, 18 labelled pattern mentions skipped. Exit 1.", r.stdout)
        self.assertIn("tools/sims/skyhook_no_leo_stress_test.jsx:48", r.stdout)

    def test_exit_0_when_clean(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "clean.md"), "w", encoding="utf-8") as fh:
                fh.write("Rev A: tip speed 2.5 km/s, 121.83x at 30 % derate, SK99 3.6 GPa, apogee ~85,200 km.\n")
            r = run_cli(d, "--params", SNAP_REV_A)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("Result: 0 NEW", r.stdout)
            self.assertIn("Allow-list: none", r.stdout)

    def test_exit_2_without_canon(self):
        with tempfile.TemporaryDirectory() as d:
            r = run_cli(d)
            self.assertEqual(r.returncode, 2)
            self.assertIn("cannot read the canon file", r.stderr)
        r = run_cli("--cite", "kinematics.nope", "--params", SNAP_REV_A)
        self.assertEqual(r.returncode, 2)
        self.assertIn("no such key", r.stderr)

    def test_cite_card(self):
        r = run_cli("--cite", "kinematics.v_tip_kms", "--params", SNAP_REV_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("kinematics.v_tip_kms = 2.5** km/s", r.stdout)
        self.assertIn(PARAMS["kinematics"]["_lower_tip_note"], r.stdout)
        self.assertIn(SIDECAR["sourceSha256"], r.stdout)
        self.assertIn(SIDECAR["commit"][:7], r.stdout)
        with open(SNAP_REV_A, "rb") as fh:
            self.assertEqual(hashlib.sha256(fh.read()).hexdigest(), SIDECAR["sourceSha256"])
        r = run_cli("--cite", "materials.alternative_fibers.Dyneema_SK99_GPa", "--params", SNAP_REV_A)
        self.assertIn("Corrected from 3.9 GPa per VM-001", r.stdout)
        self.assertIn("no [Certain]/[Likely]/[Speculative] label", r.stdout)

    def test_json_report(self):
        r = run_cli(FIXTURES, "--params", SNAP_REV_A, "--deviations", SNAP_DEV, "--format", "json")
        j = json.loads(r.stdout)
        self.assertEqual(j["counts"], {"NEW": 8, "KNOWN OPEN": 3, "ACCEPTED": 4, "LABELLED": 6})
        self.assertEqual(j["exit"], 1)
        self.assertEqual(j["meta"]["commit"], SIDECAR["commit"])
        self.assertEqual(j["meta"]["commit_source"], "provenance sidecar")
        self.assertEqual(j["meta"]["canon_sha256"], SIDECAR["sourceSha256"])

    def test_verify_and_rules_run(self):
        r = run_cli("--verify-canon", "--params", SNAP_REV_A)
        self.assertEqual(r.returncode, 0)
        self.assertIn("23 of 26 derived values reproduce", r.stdout)
        r = run_cli("--rules")
        self.assertEqual(r.returncode, 0)
        self.assertIn("sigma_sk99", r.stdout)


class SavedOutputs(unittest.TestCase):
    """example.txt and page-data.js are the saved run against the checkout."""

    def test_page_data_is_in_sync_with_snapshot_and_cards(self):
        with open(os.path.join(HERE, "page-data.js"), encoding="utf-8") as fh:
            raw = fh.read()
        data = json.loads(re.sub(r"^[\s\S]*?window\.RULE_ONE_DATA = ", "", raw).rstrip().rstrip(";"))
        self.assertEqual(data["rev_a"], PARAMS)
        self.assertEqual(data["meta"]["canon_sha256"], SHA)
        self.assertEqual(data["meta"]["commit"], SIDECAR["commit"])
        # The saved cards name the checkout's params path; the snapshot's card names the snapshot: compare from the commit on.
        strip = lambda s: "\n".join(re.sub(r"^> Source: .*? @ ", "> Source: @ ", l) for l in s.split("\n") if not l.startswith("> Cited "))
        for key in ("kinematics.v_tip_kms", "materials.alternative_fibers.Dyneema_SK99_GPa", MR + "conservative_30pct_derate"):
            self.assertEqual(strip(data["cards"][key]), strip(LC.cite(PARAMS, FLAT, key, SNAP_REV_A, SHA)))
            self.assertIn(SIDECAR["sourceSha256"], data["cards"][key])
        with open(os.path.join(HERE, "example.txt"), encoding="utf-8") as fh:
            ex = fh.read()
        m = re.search(r"Result: (\d+) NEW, (\d+) KNOWN OPEN, (\d+) ACCEPTED, (\d+) LABELLED", ex)
        self.assertEqual([int(x) for x in m.groups()], [data["counts"][c] for c in ("NEW", "KNOWN OPEN", "ACCEPTED", "LABELLED")])
        for f in data["findings"]:
            self.assertIn(f"{f['path']}:{f['line']}", ex)
        self.assertEqual(sorted(r["quantity"] for r in data["verify"] if not r["ok"]),
                         ["CoM radius (km)", "v_orb from R_E + altitude (km/s)", "v_upper_release via com_radius_km (km/s)"])

    def test_example_matches_a_fresh_run_when_the_checkout_is_present(self):
        with open(os.path.join(HERE, "example.txt"), encoding="utf-8") as fh:
            ex = fh.read()
        m = re.search(r"^Scanned (\S+) at ([0-9a-f]{7})", ex, re.M)
        checkout, short = m.group(1), m.group(2)
        head = subprocess.run(["git", "-C", checkout, "rev-parse", "HEAD"], capture_output=True, text=True)
        if head.returncode != 0 or not head.stdout.startswith(short):
            self.skipTest(f"{checkout} at {short} is not present here")
        r = run_cli(checkout)
        self.assertEqual(r.returncode, 1)
        drop = lambda s: [l for l in s.split("\n") if not l.startswith("Generated ")]
        self.assertEqual(drop(r.stdout), drop(ex))


if __name__ == "__main__":
    unittest.main()
