#!/usr/bin/env python3
"""
fiber_sweep.py — what a fiber quote would do to the Skyhook Rev A case.

params/rev_a.json carries economics.fiber_cost_per_kg: null ("WEAKEST INPUT — no vendor quote"),
and docs/DECISION_LOG.md item 8 notes that finance/skyhook_finance.py prices fiber LAUNCH, not fiber
PURCHASE, so a quote adds capex nobody has counted. This script re-derives that finance chain from
the workbook ladder (snapshots/ladder.json) and the canonical parameters (snapshots/rev_a.excerpt.json),
gates itself at price 0 against the published triples, then adds the missing line:

    fiber purchase capex ($M) = price ($/kg) × multiplier × fiber mass (kg) / 1e6

spread 15/30/35/20 over years 1-4 like every other capex dollar in the workbook, and sweeps the price.
The multiplier (finished-tether $/kg ÷ quoted $/kg, for weaving, jackets, splices, waste) defaults to
1.0 and is labelled unsourced. The hardware mass factor is NOT applied to the purchase line: it scales
launched mass (hub, arrays, tips), not fiber bought.

    python3 ideas/13-the-null-input/fiber_sweep.py                    gate + sweep + thresholds + markers
    python3 ideas/13-the-null-input/fiber_sweep.py --quote 300        the quote-day card at $300/kg
    python3 ideas/13-the-null-input/fiber_sweep.py --quote            read the price from rev_a; null -> exit 2
    python3 ideas/13-the-null-input/fiber_sweep.py --json             everything, machine-readable
    python3 ideas/13-the-null-input/fiber_sweep.py --help

Exit codes: 0 ok; 2 refused (no price for a card, gate failure, bad arguments). Output carries no
dates or absolute paths, so two runs are byte-identical.

Confidence labels follow the Skyhook convention. [Certain as mirror] marks a formula copied from
finance/skyhook_finance.py @ 34935cb; the schedule itself is the workbook's planning assumption.
Standard library only.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAP = HERE / "snapshots"
DEFAULT_PARAMS = SNAP / "rev_a.excerpt.json"
DEFAULT_LADDER = SNAP / "ladder.json"
DEFAULT_MARKERS = SNAP / "markers.json"

# ── Conventions mirrored from finance/skyhook_finance.py @ 34935cb [Certain as mirror] ───────
CAPEX_SPREAD = (0.15, 0.30, 0.35, 0.20)   # years 1-4                       (skyhook_finance.py:74)
OPS_START_YEAR = 5                        # first revenue year               (:75)
RAMP_STEP = 0.3                           # year-6 ramp = min(1, ramp_y1 + 0.3)  (:76)
WINDOW_YEARS = 15                         # NPV / breakeven window           (:77)
MAX_PAYBACK_SEARCH = 40                   # payback_year(max_years=40)       (:264)
R_EARTH_KM = 6371.0                       # physics/skyhook_physics.py:40 (mean radius; rev_a.json's
                                          # com_radius_km 6988 implies 6378 — see README findings)
COLUMNS = ("Conservative", "Baseline", "Optimistic")
DEFAULT_PRICES = (0.0, 10.0, 30.0, 100.0, 300.0, 1000.0, 3000.0)   # $/kg, half-decade log grid
BISECT_ITERS = 80                         # sensitivity.py relaxation_threshold (:130)
MAX_STRETCH = 5.0                         # sensitivity.py (:107)
STOP_PRICE_CAP = 20000.0                  # $/kg; a single that still closes here is reported as "> cap"

# The fiber a quote is for. Every fiber mass here is rev_a's EQ-6 mass for materials.primary_fiber
# (Zylon PBO). The asks outstanding at 34935cb are not all for it (docs/outreach_log.md:5-17 and
# :27-29, snapshotted): Toyobo and Avient were asked about Zylon PBO, FibrXL about Dyneema SK78
# (UHMWPE), and the Toray T1100G ask is retired. A quote for a fiber other than PBO is refused.
MATERIALS = {
    "pbo": "Zylon PBO (the Toyobo and Avient asks)",
    "uhmwpe": "UHMWPE / Dyneema (the FibrXL SK78 ask)",
    "carbon": "carbon fiber (the Toray T1100G ask, retired on 31 Aug)",
    "other": "a fiber other than Zylon PBO",
}

# The eight sensitivity inputs, label and the direction that improves the case (sensitivity.py:45-54).
INPUTS = {
    "customer_price_per_kg":      ("Customer price ($/kg)", "up"),
    "construction_launch_per_kg": ("Construction launch ($/kg)", "down"),
    "catches_per_day":            ("Cadence (catches/day)", "up"),
    "payload_kg":                 ("Payload per catch (kg)", "up"),
    "derate_fraction":            ("Fiber strength derate (fraction)", "down"),
    "hardware_mass_factor":       ("Hardware mass factor (x)", "down"),
    "program_fleet_capex_M":      ("Program+fleet capex ($M)", "down"),
    "fixed_ops_M":                ("Fixed annual ops ($M)", "down"),
}
SHORT = {  # column headers for the threshold table
    "customer_price_per_kg": "price", "construction_launch_per_kg": "launch", "catches_per_day": "cadence",
    "payload_kg": "payload", "derate_fraction": "derate", "hardware_mass_factor": "hw factor",
    "program_fleet_capex_M": "prog capex", "fixed_ops_M": "fixed ops",
}

# ── Published anchors the p=0 gate must reproduce. Each cites where it is written down in the
# Skyhook checkout at 34935cb; the test file checks every one of these strings against the
# snapshots in ./snapshots so none can be retyped wrong here. ─────────────────────────────────
PUBLISHED = {
    "columns": {
        # total capex $M (rounded), payback year, NPV@10% $M (rounded); all three columns at 2.5 km/s
        "Conservative": {"total_capex_M": 8741, "payback_year": 17, "npv_10pct_M": -3883,
                         "where": "docs/DECISION_LOG.md item 6 ('$8,741M / payback ~Y17') and item 8 ('NPV@10% −$3,883M'); finance/SENSITIVITY_FINDINGS.md headline"},
        "Baseline": {"total_capex_M": 5772, "payback_year": 9,
                     "where": "docs/DECISION_LOG.md item 6 ('Baseline 64.30× / 322 t / $5,772M / Y9')"},
        "Optimistic": {"total_capex_M": 4226, "payback_year": 7,
                       "where": "docs/DECISION_LOG.md item 6 ('Optimistic 40.32× / 202 t / $4,226M / Y7')"},
    },
    "variant": {"name": "Conservative-except-launch@800", "launch_per_kg": 800.0, "total_capex_M": 6877, "payback_year": 14,
                "where": "docs/DECISION_LOG.md item 7 ('total capex $6,877M, payback Y14'); finance/SENSITIVITY_FINDINGS.md caveat 4"},
    "mass_ratio_keys": {
        # rev_a.json mass_ratio.integrated_tether_to_payload_both_arms: (ratio key, fiber-mass key), per row
        "Conservative": ("conservative_30pct_derate", "conservative_30pct_fiber_mass_t"),
        "Baseline": ("baseline_15pct_derate", "baseline_15pct_fiber_mass_t"),
        "Optimistic": ("optimistic_0pct_derate", "optimistic_0pct_fiber_mass_t"),
        "cislunar_revenue_gated_option": ("cislunar_2p8kms_30pct_derate", "cislunar_2p8kms_30pct_fiber_mass_t"),
        "phase3_growth_option": ("phase3_3p5kms_30pct_derate", "phase3_3p5kms_30pct_fiber_mass_t"),
    },
    "thresholds": {
        # finance/SENSITIVITY_FINDINGS.md §headline table, 'Closes at'; rounded as printed there
        "customer_price_per_kg": 550, "construction_launch_per_kg": 1674, "catches_per_day": 1.10,
        "payload_kg": 5758, "derate_fraction": 0.212, "hardware_mass_factor": 1.21,
        "program_fleet_capex_M": 5095, "fixed_ops_M": None,
        "where": "finance/SENSITIVITY_FINDINGS.md headline table; docs/DECISION_LOG.md item 8",
    },
    "singles": {
        # finance/SENSITIVITY_FINDINGS.md §2: the four baseline-value singles that close, with payback
        "catches_per_day": 11, "construction_launch_per_kg": 15, "derate_fraction": 15, "program_fleet_capex_M": 15,
        "where": "finance/SENSITIVITY_FINDINGS.md §2 'Singles that close (4)'",
    },
    "cislunar": {
        # rev_a.json kinematics.cislunar_revenue_gated_option, conservative column with only tip speed swapped
        "construction_launch_break_even_for_500_per_kg_customer_price": 686,
        "customer_price_break_even_at_800_per_kg_construction_launch_Y15": 517,
        "where": "params/rev_a.json kinematics.cislunar_revenue_gated_option (same two keys)",
    },
}


# ── Inputs ────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Scenario:
    """One ladder column, optionally with a tier's tip speed swapped in (skyhook_finance.ScenarioInputs)."""
    name: str
    column: str
    tier: str
    strength_retention: float
    ascent_losses_ms: float
    construction_launch_per_kg: float
    power_chain_efficiency: float
    electricity_per_kwh: float
    ops_wear_per_kg: float
    hardware_mass_factor: float
    customer_price_per_kg: float
    catches_per_day: float
    payload_kg: float
    revenue_ramp_y1: float
    fixed_ops_M: float
    tip_speed_kms: float
    program_fleet_capex_M: float

    @property
    def derate_fraction(self) -> float:
        return 1.0 - self.strength_retention


class RefusedError(Exception):
    """A structured refusal: a code, what is missing and what would help."""

    def __init__(self, what: str, help_text: str, code: str = "null_input"):
        super().__init__(what)
        self.what = what
        self.help_text = help_text
        self.code = code

    def as_dict(self) -> dict:
        return {"code": self.code, "what": self.what, "what_would_help": self.help_text}


def material_refusal(params: dict, material: str) -> RefusedError | None:
    """None for Zylon PBO, the only fiber rev_a gives EQ-6 inputs for; a refusal for anything else."""
    if material == "pbo":
        return None
    mat = params["materials"]
    return RefusedError(
        f"the quote is for {MATERIALS[material]}, but every fiber mass here is rev_a.json's EQ-6 mass for "
        f"materials.primary_fiber = {mat['primary_fiber']} (σ {mat['tensile_strength_GPa']:g} GPa, ρ {mat['density_kgm3']:,g} kg/m³). "
        f"materials.alternative_fibers = {json.dumps(mat.get('alternative_fibers'), ensure_ascii=False)} gives strengths, "
        "with a density only in a free-text note, so there is no canonical tether mass to multiply this price by",
        "a VM-verified strength and density for that fiber in params/rev_a.json materials, and the tether's mass in it "
        "(materials.construction_baseline is a UHMWPE-core / Zylon-arm hybrid whose split rev_a does not give); "
        "until then this tool prints no fiber line for it",
        code="material_not_in_canon")


def material_note(params: dict) -> str:
    mat = params["materials"]
    return (f"{mat['primary_fiber']} (rev_a materials.primary_fiber): every fiber mass is its EQ-6 mass at "
            f"σ {mat['tensile_strength_GPa']:g} GPa, ρ {mat['density_kgm3']:,g} kg/m³, SF {mat['safety_factor']:g}; "
            "a quote for another fiber (FibrXL's is Dyneema SK78, UHMWPE) does not price this mass (--material refuses it)")


def first_non_finite(obj, path: str = "") -> str | None:
    """Dotted path of the first float that is NaN or infinite in a nested dict/list, or None."""
    if isinstance(obj, float):
        return None if math.isfinite(obj) else (path or "value")
    if isinstance(obj, dict):
        for k, v in obj.items():
            bad = first_non_finite(v, f"{path}.{k}" if path else str(k))
            if bad:
                return bad
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            bad = first_non_finite(v, f"{path}[{i}]")
            if bad:
                return bad
    return None


def check_markers(markers: dict) -> None:
    """Raise ValueError unless markers.json has the shape the study reads."""
    for mk in markers["markers"]:
        for k in ("id", "label", "file", "line", "status", "prices_per_kg"):
            if k not in mk:
                raise ValueError(f"marker {mk.get('id', '?')} has no {k!r}")
        for key, v in mk["prices_per_kg"].items():
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
                raise ValueError(f"marker {mk['id']} {key} price is not a finite non-negative number: {v!r}")


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_ladder(path: Path = DEFAULT_LADDER) -> dict[str, Scenario]:
    data = load_json(path)
    out = {}
    for col in COLUMNS:
        vals = data["columns"][col]
        out[col] = Scenario(name=col, column=col, tier="reference", **{k: float(v) for k, v in vals.items()})
    return out


class Model:
    """The Rev A physics-to-economics chain, read from the rev_a.json excerpt [Certain as mirror]."""

    def __init__(self, params: dict):
        self.params = params
        mat = params["materials"]
        self.sigma_GPa = float(mat["tensile_strength_GPa"])
        self.rho = float(mat["density_kgm3"])
        self.SF = float(mat["safety_factor"])
        self.mu = float(params["orbital"]["mu_earth_m3s2"])
        self.com_altitude_km = float(params["orbital"]["com_altitude_km"])
        kin = params["kinematics"]
        # Tier name -> tip speed, discovered the way skyhook_finance.load_tiers_from_params does.
        self.tiers = {"reference": float(kin["v_tip_kms"])}
        for key, block in kin.items():
            if isinstance(block, dict) and "v_tip_kms" in block:
                self.tiers[key] = float(block["v_tip_kms"])

    # EQ-4, physics/skyhook_physics.py characteristic_velocity_kms
    @property
    def Vc_kms(self) -> float:
        return math.sqrt(2.0 * self.sigma_GPa * 1e9 / self.rho) / 1e3

    # EQ-2, physics/skyhook_physics.py v_orbital_kms (R_E = 6371 km)
    @property
    def v_orb_kms(self) -> float:
        return math.sqrt(self.mu / ((self.com_altitude_km + R_EARTH_KM) * 1e3)) / 1e3

    # EQ-6, physics/skyhook_physics.py integrated_mass_ratio (Moravec/Forward, two arms)
    def integrated_mass_ratio(self, v_tip_kms: float, derate: float, arms: float = 2.0) -> float:
        if not 0.0 <= derate < 1.0:
            raise ValueError("derate must be in [0, 1)")
        x = (v_tip_kms / self.Vc_kms) * math.sqrt(self.SF / (1.0 - derate))
        return arms * math.sqrt(math.pi) * x * math.exp(x * x) * math.erf(x)

    def for_tier(self, s: Scenario, tier: str) -> Scenario:
        if tier not in self.tiers:
            raise KeyError(f"unknown tier {tier!r}; valid tiers: {sorted(self.tiers)}")
        return replace(s, name=f"{s.column}@{tier}", tier=tier, tip_speed_kms=self.tiers[tier])

    # ── Physics-to-economics chain (skyhook_finance.py:172-232) ──────────────────────────────
    def mass_ratio(self, s: Scenario) -> float:
        return self.integrated_mass_ratio(s.tip_speed_kms, s.derate_fraction)

    def fiber_mass_t(self, s: Scenario) -> float:
        return self.mass_ratio(s) * s.payload_kg / 1000.0

    def system_capex_M(self, s: Scenario) -> float:
        """Tether launch + hardware: fiber t × $/kg construction launch × hardware mass factor."""
        return self.fiber_mass_t(s) * 1000.0 * s.construction_launch_per_kg * s.hardware_mass_factor / 1e6

    def fiber_purchase_M(self, s: Scenario, price: float, mult: float) -> float:
        """THE LINE THE MODEL DOES NOT HAVE: fiber bought, $M = $/kg × multiplier × fiber kg / 1e6.
        No hardware mass factor (that scales launched mass, not fiber bought)."""
        return self.fiber_mass_t(s) * 1000.0 * price * mult / 1e6

    def total_capex_M(self, s: Scenario, price: float = 0.0, mult: float = 1.0) -> float:
        return self.system_capex_M(s) + s.program_fleet_capex_M + self.fiber_purchase_M(s, price, mult)

    def marginal_cost_per_kg(self, s: Scenario) -> float:
        reboost_MJ_per_kg = 2.0 * self.v_orb_kms * s.tip_speed_kms
        elec = reboost_MJ_per_kg / s.power_chain_efficiency / 3.6 * s.electricity_per_kwh
        return elec + s.ops_wear_per_kg

    def annual_upmass_t(self, s: Scenario) -> float:
        return s.catches_per_day * 365.0 * s.payload_kg / 1000.0

    def annual_revenue_M(self, s: Scenario) -> float:
        return self.annual_upmass_t(s) * 1000.0 * s.customer_price_per_kg / 1e6

    def annual_marginal_cost_M(self, s: Scenario) -> float:
        return self.annual_upmass_t(s) * 1000.0 * self.marginal_cost_per_kg(s) / 1e6

    # ── Cash flow, payback, NPV, breakeven (skyhook_finance.py:237-298) ──────────────────────
    @staticmethod
    def ramp_multiplier(ops_year: int, ramp_y1: float) -> float:
        if ops_year <= 0:
            return 0.0
        if ops_year == 1:
            return ramp_y1
        if ops_year == 2:
            return min(1.0, ramp_y1 + RAMP_STEP)
        return 1.0

    def net_cash_flows_M(self, s: Scenario, price: float = 0.0, mult: float = 1.0,
                         years: int = WINDOW_YEARS) -> list[float]:
        capex = self.total_capex_M(s, price, mult)
        rev = self.annual_revenue_M(s)
        var = self.annual_marginal_cost_M(s)
        flows = []
        for year in range(1, years + 1):
            spend = capex * CAPEX_SPREAD[year - 1] if year <= len(CAPEX_SPREAD) else 0.0
            ops_year = year - OPS_START_YEAR + 1
            m = self.ramp_multiplier(ops_year, s.revenue_ramp_y1)
            revenue = rev * m
            opex = (var * m + s.fixed_ops_M) if ops_year >= 1 else 0.0
            flows.append(revenue - spend - opex)
        return flows

    def payback_year(self, s: Scenario, price: float = 0.0, mult: float = 1.0) -> int | None:
        cum = 0.0
        for i, cf in enumerate(self.net_cash_flows_M(s, price, mult, years=MAX_PAYBACK_SEARCH), start=1):
            cum += cf
            if cum > 0:
                return i
        return None

    def npv_M(self, s: Scenario, rate: float, price: float = 0.0, mult: float = 1.0) -> float:
        return sum(cf / (1.0 + rate) ** t
                   for t, cf in enumerate(self.net_cash_flows_M(s, price, mult), start=1))

    def breakeven_customer_price_y15(self, s: Scenario, price: float = 0.0, mult: float = 1.0) -> float:
        ops_years = WINDOW_YEARS - OPS_START_YEAR + 1
        sum_mult = sum(self.ramp_multiplier(k, s.revenue_ramp_y1) for k in range(1, ops_years + 1))
        upmass_kg = self.annual_upmass_t(s) * 1000.0
        fixed_total_M = s.fixed_ops_M * ops_years
        var_total_M = self.annual_marginal_cost_M(s) * sum_mult
        need_M = self.total_capex_M(s, price, mult) + fixed_total_M + var_total_M
        return need_M * 1e6 / (upmass_kg * sum_mult)

    def summarize(self, s: Scenario, price: float = 0.0, mult: float = 1.0) -> dict:
        return {
            "scenario": s.name, "column": s.column, "tier": s.tier,
            "tip_speed_kms": s.tip_speed_kms, "derate_fraction": round(s.derate_fraction, 4),
            "fiber_price_per_kg": price, "fiber_multiplier": mult,
            "mass_ratio_x": self.mass_ratio(s), "fiber_mass_t": self.fiber_mass_t(s),
            "system_capex_M": self.system_capex_M(s),
            "fiber_purchase_M": self.fiber_purchase_M(s, price, mult),
            "total_capex_M": self.total_capex_M(s, price, mult),
            "payback_year": self.payback_year(s, price, mult),
            "npv_8pct_M": self.npv_M(s, 0.08, price, mult),
            "npv_10pct_M": self.npv_M(s, 0.10, price, mult),
            "npv_12pct_M": self.npv_M(s, 0.12, price, mult),
            "breakeven_customer_price_y15": self.breakeven_customer_price_y15(s, price, mult),
            "partial_tier_model": s.tier != "reference",
        }

    # ── Sensitivity (finance/sensitivity.py) ──────────────────────────────────────────────────
    @staticmethod
    def set_input(s: Scenario, field: str, value: float) -> Scenario:
        if field == "derate_fraction":
            return replace(s, strength_retention=1.0 - value)
        return replace(s, **{field: value})

    @staticmethod
    def get_input(s: Scenario, field: str) -> float:
        return s.derate_fraction if field == "derate_fraction" else getattr(s, field)

    def closes(self, s: Scenario, price: float = 0.0, mult: float = 1.0) -> bool:
        pb = self.payback_year(s, price, mult)
        return pb is not None and pb <= WINDOW_YEARS

    @staticmethod
    def relaxation_far(base: Scenario, field: str) -> float:
        """The far end of sensitivity.py's bisection: a MAX_STRETCH-fold improvement (x5 up, /5 down),
        with derate and fixed ops floored at 0."""
        v0 = Model.get_input(base, field)
        if INPUTS[field][1] == "up":
            return v0 * MAX_STRETCH
        if field in ("fixed_ops_M", "derate_fraction"):
            return 0.0
        return v0 / MAX_STRETCH

    def relaxation_threshold(self, base: Scenario, field: str, price: float = 0.0, mult: float = 1.0) -> float | None:
        """Bisect (as sensitivity.py) for the value of `field` alone at which payback first comes inside
        Y15, at the given fiber price. None if a MAX_STRETCH-fold improvement does not close the case."""
        v0 = self.get_input(base, field)
        _, direction = INPUTS[field]
        far = self.relaxation_far(base, field)
        if not self.closes(self.set_input(base, field, far), price, mult):
            return None
        if self.closes(base, price, mult):
            # sensitivity.py assumes the base does not close; here (e.g. a cheap tier) it can.
            # Report the base value itself: no relaxation is needed.
            return v0
        lo, hi = (v0, far) if direction == "up" else (far, v0)
        for _ in range(BISECT_ITERS):
            mid = 0.5 * (lo + hi)
            if direction == "up":
                if self.closes(self.set_input(base, field, mid), price, mult):
                    hi = mid
                else:
                    lo = mid
            else:
                if self.closes(self.set_input(base, field, mid), price, mult):
                    lo = mid
                else:
                    hi = mid
        return hi if direction == "up" else lo

    def thresholds(self, base: Scenario, price: float = 0.0, mult: float = 1.0) -> dict[str, float | None]:
        return {f: self.relaxation_threshold(base, f, price, mult) for f in INPUTS}

    def baseline_singles(self, cons: Scenario, base: Scenario, price: float = 0.0, mult: float = 1.0) -> list[dict]:
        """Every input whose baseline-column value differs from the conservative one, swapped alone,
        with whether that closes the conservative case at this fiber price (sensitivity.py:145-160)."""
        out = []
        for f in INPUTS:
            if self.get_input(cons, f) == self.get_input(base, f):
                continue
            s = self.set_input(cons, f, self.get_input(base, f))
            out.append({"field": f, "label": INPUTS[f][0], "baseline_value": self.get_input(base, f),
                        "payback_year": self.payback_year(s, price, mult), "closes": self.closes(s, price, mult)})
        return out

    def stop_price(self, s: Scenario, mult: float = 1.0) -> float | None:
        """The fiber price at which scenario `s` stops closing the case (payback inside Y15): bisection
        on price over [0, STOP_PRICE_CAP]. None if it does not close even at $0; math.inf if it still
        closes at the cap. Closed form, since the purchase line only moves years 1-4 and cum15 falls
        linearly with price: cum15(0) x 1000 / (fiber_t x m) (the tests hold the two to 1e-6)."""
        if not self.closes(s, 0.0, mult):
            return None
        if self.closes(s, STOP_PRICE_CAP, mult):
            return math.inf
        lo, hi = 0.0, STOP_PRICE_CAP
        for _ in range(BISECT_ITERS):
            mid = 0.5 * (lo + hi)
            if self.closes(s, mid, mult):
                lo = mid
            else:
                hi = mid
        return lo

    def single_stop_price(self, cons: Scenario, base: Scenario, field: str, mult: float = 1.0) -> float | None:
        """The fiber price at which the single substitution of `field` to its baseline value stops
        closing the conservative case."""
        return self.stop_price(self.set_input(cons, field, self.get_input(base, field)), mult)

    def threshold_vanish_price(self, base: Scenario, field: str, mult: float = 1.0) -> float | None:
        """The fiber price above which no value of `field` alone within the MAX_STRETCH-fold stretch
        closes the case, i.e. above which relaxation_threshold returns None. It is the stop price of
        the stretch's far end. For construction launch this is (L*(0) - L0/5) x hmf / m."""
        return self.stop_price(self.set_input(base, field, self.relaxation_far(base, field)), mult)


# ── The p = 0 gate ────────────────────────────────────────────────────────────────────────────

def run_gate(model: Model, ladder: dict[str, Scenario]) -> dict:
    """Reproduce the published figures at fiber price 0. Returns {'ok': bool, 'checks': [...]}."""
    checks = []

    def check(label, got, want, ok):
        checks.append({"label": label, "got": got, "want": want, "ok": bool(ok)})

    audit = model.params["mass_ratio"]["integrated_tether_to_payload_both_arms"]
    for col in COLUMNS:
        s = ladder[col]
        r = model.summarize(s)
        pub = PUBLISHED["columns"][col]
        check(f"{col} total capex $M", round(r["total_capex_M"]), pub["total_capex_M"], round(r["total_capex_M"]) == pub["total_capex_M"])
        check(f"{col} payback year", r["payback_year"], pub["payback_year"], r["payback_year"] == pub["payback_year"])
        if "npv_10pct_M" in pub:
            check(f"{col} NPV@10% $M", round(r["npv_10pct_M"]), pub["npv_10pct_M"], round(r["npv_10pct_M"]) == pub["npv_10pct_M"])
        rk, fk = PUBLISHED["mass_ratio_keys"][col]
        check(f"{col} mass ratio (rev_a {rk})", round(r["mass_ratio_x"], 2), audit[rk], round(r["mass_ratio_x"], 2) == audit[rk])
        check(f"{col} fiber mass t (rev_a {fk})", round(r["fiber_mass_t"], 1), audit[fk], round(r["fiber_mass_t"], 1) == audit[fk])
    cons = ladder["Conservative"]
    v = PUBLISHED["variant"]
    sv = replace(cons, name=v["name"], construction_launch_per_kg=v["launch_per_kg"])
    check("variant total capex $M", round(model.total_capex_M(sv)), v["total_capex_M"], round(model.total_capex_M(sv)) == v["total_capex_M"])
    check("variant payback year", model.payback_year(sv), v["payback_year"], model.payback_year(sv) == v["payback_year"])
    for tier in ("cislunar_revenue_gated_option", "phase3_growth_option"):
        st = model.for_tier(cons, tier)
        rk, fk = PUBLISHED["mass_ratio_keys"][tier]
        check(f"{tier} mass ratio (rev_a {rk})", round(model.mass_ratio(st), 2), audit[rk], round(model.mass_ratio(st), 2) == audit[rk])
        check(f"{tier} fiber mass t (rev_a {fk})", round(model.fiber_mass_t(st), 1), audit[fk], round(model.fiber_mass_t(st), 1) == audit[fk])
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


# ── The study ─────────────────────────────────────────────────────────────────────────────────

def tier_rows(model: Model, ladder: dict[str, Scenario]) -> list[Scenario]:
    """The five rows the sweep reports: three columns at the reference tier, then the two option tiers
    on the conservative column (as finance/skyhook_finance.py's TIER LADDER does)."""
    rows = [ladder[c] for c in COLUMNS]
    cons = ladder["Conservative"]
    for tier, _ in sorted(model.tiers.items(), key=lambda kv: kv[1]):
        if tier != "reference":
            rows.append(model.for_tier(cons, tier))
    return rows


def compute_study(model: Model, ladder: dict[str, Scenario], prices: tuple[float, ...], mult: float,
                  markers: dict | None) -> dict:
    cons, base = ladder["Conservative"], ladder["Baseline"]
    rows = tier_rows(model, ladder)
    sweep = []
    for p in prices:
        sweep.append({
            "fiber_price_per_kg": p,
            "rows": [model.summarize(s, p, mult) for s in rows],
            "conservative_thresholds": model.thresholds(cons, p, mult),
            "baseline_singles": model.baseline_singles(cons, base, p, mult),
        })
    def capped(sp: float | None):
        return None if sp is None else ("> cap" if sp == math.inf else sp)

    stops = {}
    for f in INPUTS:
        if model.get_input(cons, f) == model.get_input(base, f):
            continue
        stops[f] = capped(model.single_stop_price(cons, base, f, mult))
    marker_rows = []
    if markers:
        for mk in markers["markers"]:
            lines = mk.get("lines_per_key", {})
            for key, price in mk["prices_per_kg"].items():
                marker_rows.append({
                    "id": mk["id"], "label": mk["label"], "key": key, "price_per_kg": price,
                    "file": mk["file"], "line": lines.get(key, mk["line"]), "status": mk["status"],
                    "rows": [model.summarize(s, price, mult) for s in rows],
                })
    return {
        "fiber_multiplier": mult,
        "fiber_multiplier_status": "unsourced; 1.0 reads the quoted $/kg as the finished-tether $/kg",
        "price_grid": list(prices),
        # Always at $0, whatever the grid: what the singles and thresholds are before any fiber line.
        "at_zero": {
            "conservative_thresholds": model.thresholds(cons, 0.0, mult),
            "baseline_singles": model.baseline_singles(cons, base, 0.0, mult),
        },
        "sweep": sweep,
        "single_stop_prices": stops,
        # Above this fiber price the input alone cannot close the case within the 5x stretch (exact,
        # by bisection on price; not read off the grid).
        "threshold_vanish_prices": {f: capped(model.threshold_vanish_price(cons, f, mult)) for f in INPUTS},
        "single_stop_cap_per_kg": STOP_PRICE_CAP,
        "markers": marker_rows,
    }


def quote_card(model: Model, ladder: dict[str, Scenario], price: float, mult: float, source: str) -> dict:
    cons, base = ladder["Conservative"], ladder["Baseline"]
    rows = []
    for s in tier_rows(model, ladder):
        r0, r1 = model.summarize(s, 0.0, mult), model.summarize(s, price, mult)
        rows.append({"before": r0, "after": r1,
                     "added_capex_M": r1["total_capex_M"] - r0["total_capex_M"],
                     "added_capex_pct": (r1["total_capex_M"] / r0["total_capex_M"] - 1.0) * 100.0})
    return {
        "fiber_price_per_kg": price, "fiber_multiplier": mult, "effective_price_per_kg": price * mult,
        "price_source": source,
        "material": {"key": "pbo", "name": model.params["materials"]["primary_fiber"],
                     "tensile_strength_GPa": model.sigma_GPa, "density_kgm3": model.rho, "safety_factor": model.SF},
        "rows": rows,
        "conservative_thresholds_before": model.thresholds(cons, 0.0, mult),
        "conservative_thresholds_after": model.thresholds(cons, price, mult),
        "baseline_singles_after": model.baseline_singles(cons, base, price, mult),
        "rev_a_key_to_fill": "economics.fiber_cost_per_kg",
        "rev_a_note_key": "_fiber_cost_note",
    }


# ── Formatting ────────────────────────────────────────────────────────────────────────────────

def money(x: float) -> str:
    """$M with thousands separators and a leading minus, e.g. -$3,883M."""
    r = round(x)
    return f"{'-' if r < 0 else ''}${abs(r):,}M"


def pb_str(pb: int | None, mark_extrapolated: bool = True) -> str:
    if pb is None:
        return f">Y{MAX_PAYBACK_SEARCH}"
    return f"Y{pb}" + ("*" if (pb > WINDOW_YEARS and mark_extrapolated) else "")


def thr_str(field: str, v: float | None) -> str:
    if v is None:
        return "cannot"
    if field == "customer_price_per_kg":
        return f"${v:,.0f}"
    if field == "construction_launch_per_kg":
        return f"${v:,.0f}"
    if field == "catches_per_day":
        return f"{v:.3f}/day"
    if field == "payload_kg":
        return f"{v:,.0f} kg"
    if field == "derate_fraction":
        return f"{v * 100:.1f}%"
    if field == "hardware_mass_factor":
        return f"{v:.3f}x"
    if field in ("program_fleet_capex_M", "fixed_ops_M"):
        return f"${v:,.0f}M"
    return f"{v:g}"


def row_label(r: dict) -> str:
    if r["tier"] == "reference":
        return f"{r['column']} {r['tip_speed_kms']:.1f} km/s ({r['derate_fraction'] * 100:.0f}% derate)"
    short = {"cislunar_revenue_gated_option": "Cislunar", "phase3_growth_option": "Phase 3"}.get(r["tier"], r["tier"])
    return f"{short} {r['tip_speed_kms']:.1f} km/s @ {r['column']} column"


def number_str(x: float) -> str:
    """The number as typed, as JavaScript's String() prints it: 300, 123.456789, 1e+300."""
    return str(int(x)) if float(x).is_integer() and abs(x) < 1e21 else repr(float(x))


def price_str(p: float) -> str:
    return f"${p:,.0f}" if float(p).is_integer() else f"${p:,.2f}"


def format_header(model: Model, mult: float, params_path: Path, ladder_path: Path, ladder_meta: dict) -> list[str]:
    econ = model.params["economics"]
    fc = econ.get("fiber_cost_per_kg")
    note = econ.get("_fiber_cost_note", "")
    commit = (ladder_meta.get("commit") or "")[:7]
    return [
        "THE NULL INPUT — fiber purchase price on the Skyhook Rev A finance chain",
        f"rev_a.json economics.fiber_cost_per_kg = {json.dumps(fc)}   (\"{note}\")",
        f"inputs: {params_path.name} (orbital, kinematics, materials, mass_ratio, economics) and {ladder_path.name} "
        f"(workbook Assumptions rows 3-16, three columns) @ {commit}",
        f"fiber: {material_note(model.params)}",
        f"finished-tether multiplier: {mult:.2f}  [unsourced; 1.0 reads the quoted $/kg as the finished-tether $/kg]",
        f"purchase line: $/kg × multiplier × fiber kg, added to total capex, spread {'/'.join(f'{int(x * 100)}' for x in CAPEX_SPREAD)}% over Y1-4; "
        "hardware mass factor not applied (it scales launched mass, not fiber bought)",
    ]


def format_gate(gate: dict) -> list[str]:
    out = ["", "GATE at $0/kg — the chain must reproduce the published figures before any fiber line is printed"]
    n_ok = sum(c["ok"] for c in gate["checks"])
    for c in gate["checks"]:
        got = c["got"] if not isinstance(c["got"], float) else f"{c['got']:g}"
        out.append(f"  {'ok ' if c['ok'] else 'BAD'} {c['label']:<62} got {got!s:>10}  published {c['want']}")
    out.append(f"  gate: {n_ok} of {len(gate['checks'])} anchors reproduced"
               + ("" if gate["ok"] else " — REFUSING to print any fiber line"))
    return out


def format_rows_table(rows: list[dict], indent: str = "  ") -> list[str]:
    out = [f"{indent}{'row':<44}{'fiber t':>10}{'added $M':>10}{'capex $M':>11}{'payback':>9}{'NPV@10%':>10}{'Y15 b/e':>9}"]
    for r in rows:
        out.append(f"{indent}{row_label(r):<44}{r['fiber_mass_t']:>10,.1f}{r['fiber_purchase_M']:>10,.0f}"
                   f"{r['total_capex_M']:>11,.0f}{pb_str(r['payback_year']):>9}{r['npv_10pct_M']:>10,.0f}"
                   f"{r['breakeven_customer_price_y15']:>8,.0f}/kg")
    return out


def format_study(study: dict, ladder: dict[str, Scenario]) -> list[str]:
    out = ["", "SWEEP — fiber purchase price, three columns at 2.5 km/s and the two option tiers on the conservative column"]
    for step in study["sweep"]:
        out.append(f"  fiber price {price_str(step['fiber_price_per_kg'])}/kg × {study['fiber_multiplier']:.2f}:")
        out.extend(format_rows_table(step["rows"], indent="    "))
    out.append(f"  (* payback beyond the {WINDOW_YEARS}-year window: steady-state extrapolation; >Y{MAX_PAYBACK_SEARCH} never pays back within {MAX_PAYBACK_SEARCH} years."
               " Option-tier rows are the PARTIAL TIER MODEL: only tip speed is tier-specific; every other assumption stays at the reference column's value.)")

    out += ["", "CONSERVATIVE THRESHOLDS vs fiber price — the value of each input ALONE that brings payback inside Y15 (bisection, as finance/sensitivity.py)"]
    fields = list(INPUTS)
    W = 13
    out.append(f"  {'fiber $/kg':>10}" + "".join(f"{SHORT[f] + ' ' + ('>=' if INPUTS[f][1] == 'up' else '<='):>{W}}" for f in fields))
    for step in study["sweep"]:
        thr = step["conservative_thresholds"]
        out.append(f"  {price_str(step['fiber_price_per_kg']):>10}" + "".join(f"{thr_str(f, thr[f]):>{W}}" for f in fields))
    cons = ladder["Conservative"]
    vanish = study["threshold_vanish_prices"]

    def vanish_str(f: str) -> str:
        v = vanish[f]
        if v is None:
            return f"{SHORT[f]} never"
        if v == "> cap":
            return f"{SHORT[f]} beyond ${study['single_stop_cap_per_kg']:,.0f}"
        return f"{SHORT[f]} ${v:,.0f}"
    out.append("  'cannot' from this fiber price up (exact, by bisection on price; x"
               f"{study['fiber_multiplier']:.2f}): " + ", ".join(vanish_str(f) for f in fields))
    out.append("  (conservative values: " + ", ".join(f"{SHORT[f]} {thr_str(f, Model.get_input(cons, f))}" for f in fields)
               + "; 'cannot' = no value within a 5x stretch, or none physical, closes the case. The launch threshold falls by"
               " multiplier ÷ hardware mass factor $/kg per $/kg of fiber; the up-thresholds rise. A hw factor below the"
               " optimistic column's 1.4x is implausible and below 1.0x unphysical: printed as the arithmetic says, as sensitivity.py does.)")

    out += ["", "BASELINE-VALUE SINGLES — each conservative input swapped alone to its baseline-column value; the fiber price at which it stops closing the case"]
    for sg in study["at_zero"]["baseline_singles"]:
        f = sg["field"]
        sp = study["single_stop_prices"].get(f)
        at0 = f"{pb_str(sg['payback_year'])} at $0" if sg["closes"] else f"does not close at $0 ({pb_str(sg['payback_year'])})"
        if sp is None:
            tail = "never closes"
        elif sp == "> cap":
            tail = f"still closes at ${study['single_stop_cap_per_kg']:,.0f}/kg"
        else:
            tail = f"stops closing at ${sp:,.0f}/kg of fiber"
        out.append(f"  {sg['label']:<34} -> {thr_str(f, sg['baseline_value']):<12} {at0:<32} {tail}")

    if study["markers"]:
        out += ["", "MARKERS the repository already carries — not quotes, not defaults here; what the sweep says at each"]
        for mk in study["markers"]:
            out.append(f"  {mk['label']} [{mk['key']}] {price_str(mk['price_per_kg'])}/kg — {mk['file']}:{mk['line']}")
            out.append(f"    {mk['status']}")
            out.extend(format_rows_table(mk["rows"], indent="    "))
    return out


def format_card(card: dict) -> list[str]:
    p, m = card["fiber_price_per_kg"], card["fiber_multiplier"]
    out = ["", f"QUOTE-DAY CARD — fiber at {price_str(p)}/kg × {m:.2f} (finished-tether multiplier, unsourced) = {price_str(card['effective_price_per_kg'])}/kg of tether mass",
           f"  price source: {card['price_source']}",
           f"  material: {card['material']['name']}, priced against its EQ-6 mass (σ {card['material']['tensile_strength_GPa']:g} GPa, "
           f"ρ {card['material']['density_kgm3']:,g} kg/m³, SF {card['material']['safety_factor']:g}); a quote for another fiber does not apply"]
    for r in card["rows"]:
        b, a = r["before"], r["after"]
        out.append(f"  {row_label(a)}, {a['fiber_mass_t']:,.1f} t fiber:")
        out.append(f"    adds {money(r['added_capex_M'])} capex ({money(b['total_capex_M'])} -> {money(a['total_capex_M'])}, +{r['added_capex_pct']:.1f}%)"
                   f" | payback {pb_str(b['payback_year'])} -> {pb_str(a['payback_year'])}"
                   f" | NPV@10% {money(b['npv_10pct_M'])} -> {money(a['npv_10pct_M'])}"
                   f" | Y15 breakeven price ${b['breakeven_customer_price_y15']:,.0f} -> ${a['breakeven_customer_price_y15']:,.0f}/kg")
    tb, ta = card["conservative_thresholds_before"], card["conservative_thresholds_after"]
    out.append("  conservative single-input thresholds move: " + " | ".join(
        f"{SHORT[f]} {'>=' if INPUTS[f][1] == 'up' else '<='} {thr_str(f, tb[f])} -> {thr_str(f, ta[f])}"
        for f in INPUTS if f != "fixed_ops_M"))
    out.append("  baseline singles at this price: " + "; ".join(
        f"{SHORT[sg['field']]} -> {thr_str(sg['field'], sg['baseline_value'])} {'closes' if sg['closes'] else 'does not close'} ({pb_str(sg['payback_year'])})"
        for sg in card["baseline_singles_after"]))
    out.append(f"  to fill: rev_a.json {card['rev_a_key_to_fill']} = {number_str(p)} and {card['rev_a_note_key']} with vendor, date, currency, yarn-or-finished-rope, MOQ;"
               " then finance/skyhook_finance.py needs this purchase line (it has none) and the workbook's Assumptions sheet a row for it.")
    out.append("  (* beyond the 15-year window, extrapolated; option-tier rows are the partial tier model)")
    return out


# ── CLI ───────────────────────────────────────────────────────────────────────────────────────

def parse_prices(text: str) -> tuple[float, ...]:
    try:
        vals = tuple(float(x) + 0.0 for x in text.split(",") if x.strip())   # + 0.0 turns -0 into 0
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"--prices wants a comma list of numbers in $/kg, got {text!r}") from e
    if not vals or any(not math.isfinite(v) or v < 0 for v in vals):
        raise argparse.ArgumentTypeError("--prices wants a comma list of finite, non-negative $/kg values")
    return vals


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="fiber_sweep.py",
        description="What a fiber quote would do to the Skyhook Rev A case: adds the fiber PURCHASE line the finance model "
                    "does not have, gated at price 0 to the published figures, sweeps the price, and prints a quote-day card.",
        epilog="Exit 2 when no price exists for a card (rev_a.json economics.fiber_cost_per_kg is null and no --quote P was given), "
               "when the p=0 gate fails, or on bad arguments. Standard library only.")
    ap.add_argument("--quote", nargs="?", const="rev_a", default=None, metavar="P",
                    help="print the quote-day card at P $/kg; bare --quote reads rev_a's economics.fiber_cost_per_kg and refuses if it is null")
    ap.add_argument("--multiplier", type=float, default=1.0, metavar="M",
                    help="finished-tether $/kg per quoted $/kg (weaving, jackets, splices, waste); default 1.0, unsourced")
    ap.add_argument("--material", choices=sorted(MATERIALS), default="pbo",
                    help="the fiber the quote is for; every mass here is rev_a's Zylon PBO EQ-6 mass, so anything but "
                         "pbo (Toyobo, Avient) is refused: uhmwpe (FibrXL's Dyneema SK78), carbon (Toray, retired), other")
    ap.add_argument("--prices", type=parse_prices, default=DEFAULT_PRICES, metavar="A,B,C",
                    help=f"sweep grid in $/kg (default {','.join(f'{p:g}' for p in DEFAULT_PRICES)})")
    ap.add_argument("--no-sweep", action="store_true", help="print only the gate (and the card if --quote)")
    ap.add_argument("--json", action="store_true", help="machine-readable output of everything computed")
    ap.add_argument("--params", type=Path, default=DEFAULT_PARAMS, help="rev_a.json (or an excerpt with the five blocks)")
    ap.add_argument("--ladder", type=Path, default=DEFAULT_LADDER, help="ladder.json derived from the workbook by build_data.py")
    ap.add_argument("--markers", type=str, default=str(DEFAULT_MARKERS), help="markers.json; pass '' or - to omit the markers")
    return ap


def resolve_quote(arg: str | None, params: dict) -> tuple[float | None, str | None]:
    """Returns (price, source) or raises RefusedError when a card was asked for without a usable price."""
    if arg is None:
        return None, None
    if arg == "rev_a":
        fc = params["economics"].get("fiber_cost_per_kg")
        if fc is None:
            raise RefusedError(
                "no fiber price: rev_a.json economics.fiber_cost_per_kg is null and no --quote P was given",
                "pass --quote P with the vendor's $/kg for Zylon PBO (the Toyobo and Avient asks are pending; state yarn vs "
                "finished rope, MOQ, currency, date), or fill economics.fiber_cost_per_kg in params/rev_a.json with its source "
                "in _fiber_cost_note. A FibrXL reply is for Dyneema SK78, a different fiber: --material uhmwpe refuses it. "
                "This tool prints no fiber line without a price (mirrors finance/inspace_fork.py require_non_null).")
        if isinstance(fc, bool) or not isinstance(fc, (int, float)) or not math.isfinite(fc) or fc < 0:
            raise RefusedError(f"rev_a.json economics.fiber_cost_per_kg is not a finite non-negative $/kg: {fc!r}",
                               "fix the value in params/rev_a.json", code="invalid_input")
        return float(fc) + 0.0, "rev_a.json economics.fiber_cost_per_kg (check _fiber_cost_note says it is a vendor quote)"
    try:
        p = float(arg) + 0.0   # + 0.0 turns -0 into 0
    except ValueError as e:
        raise RefusedError(f"--quote wants a number in $/kg, got {arg!r}", "pass --quote 300, for example", code="invalid_input") from e
    if not math.isfinite(p) or p < 0:
        raise RefusedError(f"--quote wants a finite non-negative $/kg, got {arg!r}", "pass --quote 300, for example", code="invalid_input")
    return p, "--quote flag (rev_a.json economics.fiber_cost_per_kg is still null)"


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if not math.isfinite(args.multiplier) or args.multiplier <= 0:
        print("refused: --multiplier must be a finite positive number", file=sys.stderr)
        return 2
    mult = args.multiplier + 0.0
    try:
        params = load_json(args.params)
        ladder_data = load_json(args.ladder)
        ladder = load_ladder(args.ladder)
        model = Model(params)
        params["economics"]  # noqa: B018  (read below; a missing block is an input error, not a crash)
        markers = None
        if args.markers.strip() not in ("", "-"):
            markers = load_json(Path(args.markers))
            check_markers(markers)
        gate = run_gate(model, ladder)
    except (OSError, KeyError, ValueError, TypeError) as e:
        print(f"refused: cannot read inputs: {type(e).__name__}: {e}", file=sys.stderr)
        return 2

    refusal = material_refusal(params, args.material)
    price, source = None, None
    if refusal is None:
        try:
            price, source = resolve_quote(args.quote, params)
        except RefusedError as e:
            refusal = e

    study = card = None
    if gate["ok"] and (refusal is None or refusal.code == "null_input"):
        if not args.no_sweep:
            study = compute_study(model, ladder, args.prices, mult, markers)
        if price is not None:
            card = quote_card(model, ladder, price, mult, source)
        bad = first_non_finite({"study": study, "quote_card": card})
        if bad:
            study = card = None
            refusal = RefusedError(
                f"a computed value is not finite ({bad}): price x multiplier x fiber mass overflows a double",
                "a $/kg and a multiplier of the size a vendor quote has",
                code="invalid_input")

    if args.json:
        out = {
            "inputs": {"params": Path(args.params).name, "ladder": Path(args.ladder).name,
                       "ladder_commit": ladder_data.get("_meta", {}).get("commit"),
                       "fiber_cost_per_kg_in_rev_a": params["economics"].get("fiber_cost_per_kg"),
                       "material": args.material,
                       "Vc_kms": model.Vc_kms, "v_orb_kms": model.v_orb_kms, "tiers": model.tiers},
            "gate": gate,
            "study": study,
            "quote_card": card,
            "refusal": None if refusal is None else refusal.as_dict(),
        }
        print(json.dumps(out, indent=1, sort_keys=True))
        return 2 if (not gate["ok"] or refusal is not None) else 0

    lines = format_header(model, mult, Path(args.params), Path(args.ladder), ladder_data.get("_meta", {}))
    lines += format_gate(gate)
    if not gate["ok"]:
        print("\n".join(lines))
        print("refused: the p=0 gate did not reproduce the published figures; nothing below it is trustworthy", file=sys.stderr)
        return 2
    if study is not None:
        lines += format_study(study, ladder)
    if card is not None:
        lines += format_card(card)
    elif refusal is None:
        lines += ["", "QUOTE CARD: not printed. No fiber price is set (rev_a.json economics.fiber_cost_per_kg is null) and no --quote P was given; "
                  "every row above is a hypothetical price, labelled as such. Pass --quote P ($/kg) for the quote-day card."]
    print("\n".join(lines))
    if refusal is not None:
        print(f"\nrefused ({refusal.code}): {refusal.what}\n  what would help: {refusal.help_text}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
