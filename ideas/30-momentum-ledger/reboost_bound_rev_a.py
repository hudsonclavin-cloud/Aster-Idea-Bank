#!/usr/bin/env python3
"""reboost_bound_rev_a.py - the ED-reboost energy bound and momentum ledger for the Rev A ladder.

A sibling of Skyhook's finance/reboost_bound.py (which covers only the DRAFT in-space fork,
params/service_mxer_draft.json), written in its table format so the two can be diffed. Python standard
library only; an independent implementation of the same arithmetic as ledger.js, which the tests compare.

Scope line (reboost_bound.py's, which applies unchanged): this is an ENERGY bound, not a Lorentz-force
thrust model. Plasma density, field geometry, current collection, arcing and eclipse are folded into the
efficiency and duty brackets [FLAGGED]. The ledger adds one step: what the throw does to the tether's own
orbit, from energy conservation and the loaded tether's flip about the combined centre of mass [Likely].

Reads this idea's snapshots by default; --skyhook DIR reads params/rev_a.json and the cited lines from a
live Skyhook checkout instead (read-only). Exit codes: 0 printed; 1 a self-check failed; 2 refused (the
canon lacks what the question needs); 3 usage.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAP = HERE / "snapshots"
DAY_S = 86400.0

TIER_KEYS = {
    "reference": ("kinematics.v_tip_kms", {
        "0": "mass_ratio.integrated_tether_to_payload_both_arms.optimistic_0pct_fiber_mass_t",
        "0.15": "mass_ratio.integrated_tether_to_payload_both_arms.baseline_15pct_fiber_mass_t",
        "0.3": "mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_fiber_mass_t"}),
    "cislunar": ("kinematics.cislunar_revenue_gated_option.v_tip_kms", {
        "0.3": "mass_ratio.integrated_tether_to_payload_both_arms.cislunar_2p8kms_30pct_fiber_mass_t"}),
    "phase3": ("kinematics.phase3_growth_option.v_tip_kms", {
        "0.3": "mass_ratio.integrated_tether_to_payload_both_arms.phase3_3p5kms_30pct_fiber_mass_t"}),
}

# (file, line, regex) for every non-canon number this script reads; the value is the named group.
CITED = {
    "r_earth_km": ("physics/skyhook_physics.py", 40, r"^R_EARTH_KM = (?P<v>[\d.]+)"),
    "hub_kg": ("physics/tether_dynamics.py", 77, r"hub_mass_kg: float = (?P<v>[\d.e]+)"),
    "eta_ladder_pct": ("docs/research/mp001_market_pricing.md", 37, r"Ladder at (?P<v>\d+% / \d+% / \d+%) efficiency"),
    "duty": ("finance/reboost_bound.py", 32, r"DUTY_FACTORS = \((?P<v>[\d., ]+)\)"),
    "specific_power_wkg": ("finance/reboost_bound.py", 33, r"SPECIFIC_POWER_WKG = \((?P<v>[\d., ]+)\)"),
    "rb_powers_kw": ("finance/reboost_bound.py", 30, r"INSTALLED_POWER_KW = \((?P<v>[\d., ]+)\)"),
    "intervals": ("docs/project_instructions.md", 145, r"\(initially (?P<v>\d+.\d+) days, shrinking to < \d+ day at maturity\)"),
    "mature_interval_d": ("docs/project_instructions.md", 145, r"shrinking to < (?P<v>\d+) day at maturity"),
    "margin_pct": ("docs/project_instructions.md", 145, r"with (?P<v>\d+)% margin"),
}
LINE_FILES = {
    "physics/skyhook_physics.py": "skyhook_physics", "physics/tether_dynamics.py": "tether_dynamics",
    "docs/research/mp001_market_pricing.md": "mp001", "finance/reboost_bound.py": "reboost_bound",
    "docs/project_instructions.md": "project_instructions",
}
# Powers this script adds above reboost_bound.py's 50-500 kW so the grid reaches the sizing rule. [FLAGGED]
EXTRA_POWERS_KW = (1000.0, 2500.0, 5000.0, 10000.0, 25000.0, 50000.0)


class Refused(Exception):
    def __init__(self, code: str, reason: str, help_: str):
        super().__init__(reason)
        self.code, self.reason, self.help = code, reason, help_


def dig(obj: dict, dotted: str):
    for k in dotted.split("."):
        if not isinstance(obj, dict) or k not in obj:
            return None
        obj = obj[k]
    return obj


def floats(text: str) -> list[float]:
    return [float(x) for x in re.findall(r"[\d.]+(?:e\d+)?", text)]


def load_inputs(skyhook: Path | None) -> tuple[dict, dict, dict]:
    """Return (rev_a, cited values, provenance) from snapshots or a live checkout."""
    if skyhook is not None:
        rev_a = json.loads((skyhook / "params/rev_a.json").read_text(encoding="utf-8"))
        def line(path, no):
            return (skyhook / path).read_text(encoding="utf-8").split("\n")[no - 1].rstrip("\r")
        wb = json.loads((SNAP / "workbook-ladder.json").read_text(encoding="utf-8"))  # xlsx: see build_data.py
        source = f"live checkout {skyhook}"
    else:
        rev_a = json.loads((SNAP / "rev_a.json").read_text(encoding="utf-8"))
        def line(path, no):
            return json.loads((SNAP / f"{LINE_FILES[path]}.lines.json").read_text(encoding="utf-8"))["lines"][str(no)]
        wb = json.loads((SNAP / "workbook-ladder.json").read_text(encoding="utf-8"))
        prov = json.loads((SNAP / "rev_a.json.provenance.json").read_text(encoding="utf-8"))
        source = f"snapshots of Skyhook {prov['commit'][:7]}"
    vals, prov = {}, {}
    for key, (path, no, rx) in CITED.items():
        text = line(path, no)
        m = re.search(rx, text)
        if not m:
            raise Refused("insufficient_data", f"{path}:{no} no longer says what this script reads: {text!r}",
                          "update CITED in reboost_bound_rev_a.py to the line's new place")
        vals[key] = m.group("v")
        prov[key] = f"{path}:{no}"
    cited = {
        "r_earth_km": float(vals["r_earth_km"]),
        "hub_kg": float(vals["hub_kg"]),
        "etas": [p / 100.0 for p in floats(vals["eta_ladder_pct"])],
        "duties": floats(vals["duty"]),
        "specific_power_wkg": floats(vals["specific_power_wkg"]),
        "rb_powers_kw": floats(vals["rb_powers_kw"]),
        "intervals_d": floats(vals["intervals"].replace("–", " ").replace("-", " ")),
        "mature_interval_d": float(vals["mature_interval_d"]),
        "margin": float(vals["margin_pct"]) / 100.0,
        "workbook": wb["rows"],
    }
    return rev_a, cited, {"source": source, **prov}


def build_system(rev_a: dict, cited: dict, tier: str, derate: str, hub_kg: float, payload_kg: float | None,
                 release: str) -> dict:
    if tier not in TIER_KEYS:
        raise Refused("invalid_input", f"unknown tier {tier!r}", "reference, cislunar or phase3")
    vtip_key, fibre_keys = TIER_KEYS[tier]
    if derate not in fibre_keys:
        raise Refused("insufficient_data",
                      f"params/rev_a.json prints no fibre mass for tier {tier} at {float(derate):.0%} derate "
                      f"(only at {', '.join(f'{float(d):.0%}' for d in fibre_keys)})",
                      "a canon fibre-mass key for this tier and derate in params/rev_a.json")
    if not (hub_kg >= 0 and math.isfinite(hub_kg)):
        raise Refused("invalid_input", "hub mass must be zero or more", "a hub mass budget")
    design = dig(rev_a, "mass_ratio.integrated_tether_to_payload_both_arms.payload_mass_kg_for_tonnage")
    m = design if payload_kg is None else payload_kg
    if not m > 0:
        raise Refused("invalid_input", "payload must be more than zero", "a payload mass in kg")
    if m > design:
        raise Refused("out_of_envelope", f"every tier is sized for a {design} kg payload; {m:g} kg would overload it",
                      "a tether sized for this payload")
    mu = dig(rev_a, "orbital.mu_earth_m3s2")
    R = (cited["r_earth_km"] + dig(rev_a, "orbital.com_altitude_km")) * 1e3
    fibre = dig(rev_a, fibre_keys[derate]) * 1e3
    M = fibre + hub_kg
    return {"tier": tier, "derate": derate, "mu": mu, "RE": cited["r_earth_km"] * 1e3, "R": R,
            "L": dig(rev_a, "geometry.tether_half_length_km") * 1e3, "v": math.sqrt(mu / R),
            "vt": dig(rev_a, vtip_key) * 1e3, "m": m, "fibre": fibre, "hub": hub_kg, "M": M,
            "f": (M - m) / (M + m) if release == "loaded" else 1.0, "release": release}


def eps(mu: float, r: float, v: float) -> float:
    return v * v / 2.0 - mu / r


def throw(s: dict, r: float, v: float) -> dict:
    """One catch-and-throw with the CoM at an apside (r, v): energy conservation + the loaded flip."""
    mu, L, vt, m, M, f = s["mu"], s["L"], s["vt"], s["m"], s["M"], s["f"]
    gain = eps(mu, r + L * f, v + vt * f) - eps(mu, r - L, v - vt)
    e1 = eps(mu, r, v) - m / M * gain
    r1 = r - 2.0 * m * L / (M + m)
    v1sq = 2.0 * (e1 + mu / r1)
    if not (e1 < 0 and v1sq > 0):
        raise Refused("out_of_envelope", "after this throw the tether has no bound orbit", "a heavier hub")
    a1 = -mu / (2.0 * e1)
    other = 2.0 * a1 - r1
    return {"gain": gain, "a1": a1, "rp": min(r1, other), "ra": max(r1, other), "dv": m / M * gain / v}


def energy_summary(s: dict) -> dict:
    mu, R, L, v, vt, f = s["mu"], s["R"], s["L"], s["v"], s["vt"], s["f"]
    e_in, e_out = eps(mu, R - L, v - vt), eps(mu, R + L * f, v + vt * f)
    out = {"r_catch_km": (R - L) / 1e3, "r_release_km": (R + L * f) / 1e3, "v_catch_kms": (v - vt) / 1e3,
           "v_release_kms": (v + vt * f) / 1e3, "E_in_jkg": e_in, "E_out_jkg": e_out,
           "dE_per_kg_MJ": (e_out - e_in) / 1e6, "dE_per_kg_kWh": (e_out - e_in) / 3.6e6,
           "dE_throw_j": s["m"] * (e_out - e_in), "c3_km2s2": 2.0 * e_out / 1e6,
           "momentum_view_MJ": 2.0 * v * vt / 1e6, "lift_term_MJ": (mu / (R - L) - mu / (R + L)) / 1e6}
    if e_out < 0:
        a = -mu / (2.0 * e_out)
        out["apogee_alt_km"] = (2.0 * a - (R + L * f)) / 1e3 - s["RE"] / 1e3
    else:
        out["apogee_alt_km"] = math.inf
    return out


def recovery_days(E: float, p_w: float, eta: float, duty: float) -> float:
    return E / (p_w * eta * duty) / DAY_S


def ledger_one(s: dict) -> dict:
    t = throw(s, s["R"], s["v"])
    return {"M_t": s["M"] / 1e3, "da_km": (s["R"] - t["a1"]) / 1e3, "perigee_drop_km": (s["R"] - t["rp"]) / 1e3,
            "apogee_drop_km": (s["R"] - t["ra"]) / 1e3, "tip_lowest_alt_km": (t["rp"] - s["L"] - s["RE"]) / 1e3,
            "tip_alt_before_km": (s["R"] - s["L"] - s["RE"]) / 1e3, "dv_equiv_ms": t["dv"]}


def floor_count(s: dict, floor_m: float, phasing: str, max_n: int = 500) -> int:
    if floor_m >= s["R"] - s["L"] - s["RE"]:
        raise Refused("out_of_envelope", "a floor at or above the design tip altitude allows no throw",
                      "a floor below the design lower-tip altitude")
    a = rp = ra = s["R"]
    n = 0
    while n < max_n:
        r = rp if phasing == "perigee" else ra
        v = math.sqrt(s["mu"] * (2.0 / r - 1.0 / a))
        try:
            t = throw(s, r, v)
        except Refused:
            break
        if t["rp"] - s["L"] - s["RE"] < floor_m:
            break
        n += 1
        a, rp, ra = t["a1"], t["rp"], t["ra"]
    return n


def compute(rev_a: dict, cited: dict, args) -> dict:
    s = build_system(rev_a, cited, args.tier, args.derate, args.hub_t * 1e3 if args.hub_t is not None else cited["hub_kg"],
                     args.payload_kg, args.release)
    en = energy_summary(s)
    E = en["dE_throw_j"]
    powers_kw = list(cited["rb_powers_kw"]) + list(EXTRA_POWERS_KW)
    lo_d, hi_d = cited["intervals_d"]
    k = 1.0 + cited["margin"]
    rows = []
    for eta in cited["etas"]:
        for duty in cited["duties"]:
            for p in powers_kw:
                t = recovery_days(E, p * 1e3, eta, duty)
                rows.append({"eta": eta, "duty": duty, "power_kw": p, "t_rec_days": t,
                             "support": "both" if k * t <= lo_d else (f"{hi_d:g} d only" if k * t <= hi_d else "neither")})
    req = []
    for eta in cited["etas"]:
        for duty in cited["duties"]:
            req.append({"eta": eta, "duty": duty, **{f"{d:g}d_kw": k * E / (eta * duty * d * DAY_S) / 1e3
                                                    for d in (lo_d, hi_d, cited["mature_interval_d"])}})
    wb = cited["workbook"]
    cadence = []
    for col in ("Conservative", "Baseline", "Optimistic"):
        eta, per_day = float(wb["6"][col]), float(wb["11"][col])
        cadence.append({"column": col, "eta": eta, "catches_per_day": per_day,
                        **{f"duty_{d:g}_mw": k * E * per_day / (eta * d * DAY_S) / 1e6 for d in cited["duties"]}})
    led = ledger_one(s)
    floor_m = args.floor_km * 1e3
    try:
        floors = {"apogee": floor_count(s, floor_m, "apogee"), "perigee": floor_count(s, floor_m, "perigee")}
    except Refused as r:
        floors = {"refused": r.reason}
    return {"system": {k2: s[k2] for k2 in ("tier", "derate", "m", "fibre", "hub", "M", "release")},
            "energy": en, "grid": rows, "required_power": req, "workbook_cadence": cadence, "ledger": led,
            "floor_km": args.floor_km, "throws_above_floor": floors, "intervals_d": [lo_d, hi_d],
            "mature_interval_d": cited["mature_interval_d"], "margin": cited["margin"],
            "specific_power_wkg": cited["specific_power_wkg"]}


def self_checks(res: dict) -> list[str]:
    bad = []
    en = res["energy"]
    if abs(en["dE_per_kg_MJ"] - (en["momentum_view_MJ"] + en["lift_term_MJ"])) > 1e-9 and res["system"]["release"] == "canon":
        bad.append("energy split: momentum view + lift term != orbital-energy gain")
    for eta in {r["eta"] for r in res["grid"]}:
        for duty in {r["duty"] for r in res["grid"]}:
            ts = [r["t_rec_days"] for r in res["grid"] if r["eta"] == eta and r["duty"] == duty]
            if any(a < b for a, b in zip(ts, ts[1:])):
                bad.append(f"power monotonicity eta={eta} duty={duty}")
    if not res["ledger"]["da_km"] > 0:
        bad.append("a throw must lower the orbit")
    return bad


def render(res: dict, prov: dict) -> str:
    s, en, led = res["system"], res["energy"], res["ledger"]
    lo, hi = res["intervals_d"]
    out = [
        "# ED Reboost Energy Bound - Rev A ladder (idea-bank prototype; not a Skyhook artefact)",
        f"Inputs: {prov['source']}. Earth radius {prov['r_earth_km']}; hub default {prov['hub_kg']}; "
        f"efficiency ladder {prov['eta_ladder_pct']}; duty {prov['duty']}; sizing rule {prov['intervals']}.",
        f"Reference config: tier {s['tier']}, derate {float(s['derate']):.0%}, payload {s['m']:.0f} kg, fibre {s['fibre'] / 1e3:.1f} t (canon), "
        f"hub {s['hub'] / 1e3:.1f} t [Speculative], system mass {s['M'] / 1e3:.1f} t, release model {s['release']}.",
        "",
        "ENERGY SUMMARY",
        f"- r_catch = {en['r_catch_km']:.1f} km; r_release = {en['r_release_km']:.1f} km; v_catch = {en['v_catch_kms']:.6f} km/s; v_release = {en['v_release_kms']:.6f} km/s",
        f"- E_in = {en['E_in_jkg']:,.0f} J/kg; E_out = {en['E_out_jkg']:,.0f} J/kg (C3 {en['c3_km2s2']:.3f} km^2/s^2, apogee altitude "
        + (f"{en['apogee_alt_km']:,.0f} km)" if math.isfinite(en["apogee_alt_km"]) else "escape)"),
        f"- dE per kg = {en['dE_per_kg_MJ']:.4f} MJ/kg = {en['dE_per_kg_kWh']:.3f} kWh/kg "
        f"(momentum view 2 v_orb v_tip {en['momentum_view_MJ']:.4f} + lift term {en['lift_term_MJ']:.4f} MJ/kg)",
        f"- dE_throw = {en['dE_throw_j']:.6e} J",
        "",
        f"Sizing rule intervals (docs/project_instructions.md:145): {lo:g} and {hi:g} days, {res['mature_interval_d']:g} day at maturity, "
        f"with {res['margin']:.0%} margin: supportable means {1 + res['margin']:.1f} x t_rec <= interval.",
        "",
        "RECOVERY-TIME GRID",
        "| eta | duty | installed power kW | t_rec days | supportability |",
        "|---:|---:|---:|---:|---|",
    ]
    for r in res["grid"]:
        out.append(f"| {r['eta']:.2f} | {r['duty']:.1f} | {r['power_kw']:.0f} | {r['t_rec_days']:.1f} | {r['support']} |")
    out += ["", "MINIMUM INSTALLED POWER FOR THE SIZING RULE (margin included)",
            f"| eta | duty | {lo:g}-day kW | {hi:g}-day kW | {res['mature_interval_d']:g}-day kW |", "|---:|---:|---:|---:|---:|"]
    for r in res["required_power"]:
        out.append(f"| {r['eta']:.2f} | {r['duty']:.1f} | {r[f'{lo:g}d_kw']:,.0f} | {r[f'{hi:g}d_kw']:,.0f} | {r[f'{res['mature_interval_d']:g}d_kw']:,.0f} |")
    duties = sorted({r["duty"] for r in res["grid"]})
    out += ["", "AT THE WORKBOOK'S MATURE CADENCE (Assumptions rows 6 and 11; margin included)",
            "| column | eta | catches/day | " + " | ".join(f"MW at duty {d:g}" for d in duties) + " |",
            "|---|---:|---:|" + "---:|" * len(duties)]
    for c in res["workbook_cadence"]:
        out.append(f"| {c['column']} | {c['eta']:.2f} | {c['catches_per_day']:g} | " + " | ".join(f"{c[f'duty_{d:g}_mw']:.1f}" for d in duties) + " |")
    out += ["", "POWER-SYSTEM MASS CHECK (array specific power from reboost_bound.py:33)",
            "| installed power MW | W/kg | array mass t | vs hub |", "|---:|---:|---:|---:|"]
    cons = res["workbook_cadence"][0]
    for d in duties:
        p = cons[f"duty_{d:g}_mw"] * 1e6
        for sp in res["specific_power_wkg"]:
            mt = p / sp / 1e3
            out.append(f"| {p / 1e6:.1f} | {sp:.0f} | {mt:,.0f} | {mt / (s['hub'] / 1e3):.1f}x |" if s["hub"] > 0 else f"| {p / 1e6:.1f} | {sp:.0f} | {mt:,.0f} | n/a |")
    out += ["", "LEDGER: ONE THROW FROM THE CANON CIRCULAR ORBIT, NO REBOOST",
            f"- system mass {led['M_t']:.1f} t ({s['M'] / s['m']:.1f}x the payload)",
            f"- semi-major axis drop {led['da_km']:.2f} km; energy-equivalent reboost dv {led['dv_equiv_ms']:.2f} m/s",
            f"- throw point drops {led['apogee_drop_km']:.2f} km; half an orbit later the CoM is {led['perigee_drop_km']:.2f} km lower",
            f"- lower tip: {led['tip_alt_before_km']:.0f} km design altitude -> lowest {led['tip_lowest_alt_km']:.1f} km after the throw",
            f"- throws before the lower tip would pass below {res['floor_km']:g} km: " +
            ("refused: " + res["throws_above_floor"]["refused"] if "refused" in res["throws_above_floor"] else
             f"{res['throws_above_floor']['apogee']} (each at apogee), {res['throws_above_floor']['perigee']} (each at perigee)"),
            "", "LOAD-BEARING PARAMETERS",
            "- hub mass [Speculative - tether_dynamics.py placeholder until a hub mass budget exists]",
            "- eta = MP-001 section 3a ladder [FLAGGED - wall-to-momentum efficiency]; duty = reboost_bound.py brackets [FLAGGED]",
            f"- installed powers above 500 kW ({', '.join(f'{p:g}' for p in EXTRA_POWERS_KW)} kW) added by this script [FLAGGED]",
            "- ledger: spin assumed to end where it started; tip lowest altitude = CoM perigee - L [Likely, within ~10 km of Skyhook's own 17-node twin]",
            "- no $/kg: params/rev_a.json carries no electricity price [refused]",
            ""]
    return "\n".join(out)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        sys.exit(3)


def main(argv=None) -> int:
    ap = Parser(description=__doc__.split("\n\n")[0], epilog="Exit 0 printed, 1 self-check failed, 2 refused, 3 usage.")
    ap.add_argument("--tier", default="reference", choices=sorted(TIER_KEYS))
    ap.add_argument("--derate", default="0.3", choices=["0", "0.15", "0.3"])
    ap.add_argument("--hub-t", type=float, default=None, help="hub mass in tonnes (default: the 200 t placeholder, tether_dynamics.py:77)")
    ap.add_argument("--payload-kg", type=float, default=None, help="payload mass (default: the canon design payload)")
    ap.add_argument("--release", default="canon", choices=["canon", "loaded"])
    ap.add_argument("--floor-km", type=float, default=200.0, help="lower-tip altitude floor for the throw count (an input, not canon)")
    ap.add_argument("--skyhook", default=None, help="read a live Skyhook checkout instead of the snapshots (read-only)")
    ap.add_argument("--json", action="store_true", help="print the results as JSON")
    args = ap.parse_args(argv)
    try:
        rev_a, cited, prov = load_inputs(Path(args.skyhook).resolve() if args.skyhook else None)
        res = compute(rev_a, cited, args)
    except Refused as r:
        print(json.dumps({"refused": True, "code": r.code, "reason": r.reason, "what_would_help": r.help}, indent=2))
        return 2
    bad = self_checks(res)
    if args.json:
        res["provenance"] = prov
        if not math.isfinite(res["energy"]["apogee_alt_km"]):
            res["energy"]["apogee_alt_km"] = None  # escape; JSON has no infinity
        print(json.dumps(res, indent=1))
    else:
        print(render(res, prov))
    if bad:
        print("SELF-CHECK FAILED: " + "; ".join(bad), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
