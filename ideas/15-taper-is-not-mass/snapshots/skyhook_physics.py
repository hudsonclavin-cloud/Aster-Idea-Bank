"""
skyhook_physics.py — Canonical physics module for the Skyhook program.

All equations reference the founding document (skyhook_project_instructions.md)
and are verified against VM-001. Every function states its confidence level and
primary source. No magic numbers: all constants are imported from rev_a.json or
defined with citations here.

EQ references:
  EQ-1  Tsiolkovsky rocket equation
  EQ-2  Orbital velocity
  EQ-3  Tip velocity / tether kinematics
  EQ-4  Characteristic velocity (material figure of merit)
  EQ-5  Taper ratio (cross-section growth toward center)
  EQ-6  Integrated tether mass ratio (Moravec/Forward taper-optimized tether)
  EQ-7  Upper-tip release energy and apogee

Confidence labels follow project convention:
  [Certain]     — supported by strong evidence / derivable from first principles
  [Likely]      — supported by evidence, minor modeling assumptions
  [Speculative] — educated estimate, explicit flag required
"""

import json
import math
from pathlib import Path

# ── Load canonical parameters ──────────────────────────────────────────────────
_PARAMS_PATH = Path(__file__).parent.parent / "params" / "rev_a.json"

def load_params() -> dict:
    """Return the Rev A canonical parameter dict."""
    with open(_PARAMS_PATH) as f:
        return json.load(f)

PARAMS = load_params()

# ── Physical constants ─────────────────────────────────────────────────────────
MU_EARTH = PARAMS["orbital"]["mu_earth_m3s2"]   # 3.986e14 m³/s²  [Certain]
R_EARTH_KM = 6371.0                             # mean radius      [Certain]
G_STD = 9.80665                                 # m/s²             [Certain]


# ── EQ-1: Tsiolkovsky rocket equation ─────────────────────────────────────────
def delta_v_required_kms(v_e_kms: float, mass_ratio: float) -> float:
    """
    EQ-1: Δv = v_e · ln(m0/mf)
    Source: Tsiolkovsky 1903; Instructions §2.1
    Confidence: [Certain]

    Args:
        v_e_kms: Effective exhaust velocity (km/s). Kerosene/LOX ~3.0, H2/LOX ~4.5
        mass_ratio: m0/mf (initial/final mass)
    Returns:
        Δv in km/s
    """
    return v_e_kms * math.log(mass_ratio)


def mass_ratio_required(delta_v_kms: float, v_e_kms: float) -> float:
    """
    Inverse of EQ-1: m0/mf = exp(Δv / v_e)
    Confidence: [Certain]
    """
    return math.exp(delta_v_kms / v_e_kms)


def payload_fraction(delta_v_kms: float, v_e_kms: float) -> float:
    """
    Payload fraction = 1 - (1 - 1/mass_ratio) ≈ 1/exp(Δv/v_e)
    Confidence: [Certain]
    Returns value in [0, 1].
    """
    mr = mass_ratio_required(delta_v_kms, v_e_kms)
    return 1.0 / mr


# ── EQ-2: Orbital velocity ─────────────────────────────────────────────────────
def v_orbital_kms(altitude_km: float) -> float:
    """
    EQ-2: v_orb = sqrt(μ / R_orbit)
    Source: Newton; Instructions §2.2
    Confidence: [Certain]

    Args:
        altitude_km: Orbital altitude above Earth's surface
    Returns:
        Orbital velocity in km/s
    """
    r_orbit_m = (altitude_km + R_EARTH_KM) * 1e3
    return math.sqrt(MU_EARTH / r_orbit_m) / 1e3


# ── EQ-3: Tether kinematics ───────────────────────────────────────────────────
def v_lower_tip_groundrel_kms(
    com_altitude_km: float,
    v_tip_kms: float,
    equatorial_prograde: bool = True
) -> float:
    """
    EQ-3a: v_lower_tip_groundrel = v_orb - v_tip [- v_earth_rot if equatorial prograde]
    Source: Instructions §2.2; Moravec 1977
    Confidence: [Likely] — ignores atmospheric effects and tip oscillation

    Note: Prograde equatorial orbit gains ~0.46 km/s from Earth's rotation;
    this helps the launch vehicle requirement.
    """
    v_orb = v_orbital_kms(com_altitude_km)
    v_earth_rot = 0.465 if equatorial_prograde else 0.0  # km/s at equator [Certain]
    return v_orb - v_tip_kms - v_earth_rot


def v_upper_release_kms(com_altitude_km: float, v_tip_kms: float) -> float:
    """
    EQ-3b: v_upper_release = v_orb + v_tip
    Source: Instructions §2.2
    Confidence: [Certain] — first-order; ignores orbital radius difference upper/lower tip
    """
    return v_orbital_kms(com_altitude_km) + v_tip_kms


def tip_acceleration_g(v_tip_kms: float, L_km: float) -> float:
    """
    EQ-3c: a_tip = v_tip² / L
    Source: Instructions §2.2
    Confidence: [Certain]

    At Rev A: (2500)² / 320000 = 19.53 m/s² = 1.99 g
    """
    a_ms2 = (v_tip_kms * 1e3) ** 2 / (L_km * 1e3)
    return a_ms2 / G_STD


def rotation_period_min(v_tip_kms: float, L_km: float) -> float:
    """
    Period = 2π·L / v_tip
    Confidence: [Certain]
    """
    circumference_km = 2 * math.pi * L_km
    return circumference_km / v_tip_kms / 60.0


def apogee_from_release(v_tip_kms: float) -> dict:
    """
    [Certain] Return release C3 and apogee altitude from upper-tip release.

    The release speed is v_rel = v_orb_com + v_tip. Specific orbital energy is
    evaluated at the upper-tip radius r = R_Earth + CoM altitude + tether half-length,
    not at the CoM radius. For bound trajectories, apogee is derived from
    eps = v_rel^2/2 - mu/r, a = -mu/(2*eps), r_apogee = 2*a - r.
    For eps >= 0, C3 is positive and apogee altitude is math.inf.
    """
    com_altitude_km = PARAMS["orbital"]["com_altitude_km"]
    tether_half_length_km = PARAMS["geometry"]["tether_half_length_km"]
    mu_km3s2 = MU_EARTH / 1e9
    r_tip_km = R_EARTH_KM + com_altitude_km + tether_half_length_km
    v_rel_kms = v_orbital_kms(com_altitude_km) + v_tip_kms
    eps = 0.5 * v_rel_kms * v_rel_kms - mu_km3s2 / r_tip_km
    c3 = 2.0 * eps
    if eps >= 0.0:
        apogee_altitude_km = math.inf
    else:
        semi_major_axis_km = -mu_km3s2 / (2.0 * eps)
        apogee_radius_km = 2.0 * semi_major_axis_km - r_tip_km
        apogee_altitude_km = apogee_radius_km - R_EARTH_KM
    return {"c3_kms2": c3, "apogee_altitude_km": apogee_altitude_km}


def c3_kms2(com_altitude_km: float, v_tip_kms: float) -> float:
    """
    C3 = v_rel^2 - v_escape^2 at the upper-tip release radius.
    C3 > 0 means hyperbolic (escape capable).
    Source: orbital mechanics; Instructions Section 2.2
    Confidence: [Certain]
    """
    if com_altitude_km != PARAMS["orbital"]["com_altitude_km"]:
        raise ValueError("c3_kms2 uses the canonical Rev A upper-tip geometry; use apogee_from_release for Rev A release energy")
    return apogee_from_release(v_tip_kms)["c3_kms2"]


# ── EQ-4: Characteristic velocity ─────────────────────────────────────────────
def characteristic_velocity_kms(
    tensile_strength_GPa: float,
    density_kgm3: float
) -> float:
    """
    EQ-4: V_c = sqrt(2·σ/ρ)
    Source: Moravec 1977; Instructions §2.3
    Confidence: [Certain]

    V_c is the maximum tip speed a taper-ratio=1 tether can sustain at SF=1.
    """
    sigma_Pa = tensile_strength_GPa * 1e9
    return math.sqrt(2 * sigma_Pa / density_kgm3) / 1e3


# ── EQ-5: Taper ratio ─────────────────────────────────────────────────────────
def taper_ratio(
    v_tip_kms: float,
    V_c_kms: float,
    safety_factor: float = 2.5
) -> float:
    """
    EQ-5: Taper = exp[ (v_tip / V_c)^2 * SF ]
    Source: Moravec 1977; Instructions Section 2.3
    Confidence: [Certain] -- assumes uniform material, single fiber species

    [Certain] Returns cross-sectional AREA ratio: center / tip.
    WARNING: this is not tether mass / payload mass. The peak cross-section
    exists only near the center, so use integrated_mass_ratio() or
    tether_mass_ratio() for tether mass accounting.

    At Rev A reference (v_tip=2.5, V_c=2.73, SF=2.5):
      taper = exp[(2.5/2.73)^2 * 2.5] ~= 8.2
    """
    return math.exp((v_tip_kms / V_c_kms) ** 2 * safety_factor)


def integrated_mass_ratio(
    v_tip_kms: float,
    V_c_material_kms: float,
    safety_factor: float = 2.5,
    sigma_derate: float = 0.30,
    arms: float = 2.0
) -> float:
    """
    [Certain] Integrated tether-to-payload mass ratio for a taper-optimized rotovator.

    Moravec/Forward form:
      M_tether / m_payload = arms * sqrt(pi) * x * exp(x^2) * erf(x)
      x = (V_t / V_c_material) * sqrt(SF / (1 - sigma_derate))

    V_c_material is the material characteristic velocity before safety factor or
    derate. This integrates the tapered cross-section over tether length; it is
    not the same quantity as the peak area taper ratio returned by taper_ratio().
    """
    if not 0.0 <= sigma_derate < 1.0:
        raise ValueError("sigma_derate must be in [0, 1)")
    x = (v_tip_kms / V_c_material_kms) * math.sqrt(safety_factor / (1.0 - sigma_derate))
    single_arm = math.sqrt(math.pi) * x * math.exp(x * x) * math.erf(x)
    return arms * single_arm


def tether_mass_ratio(
    v_tip_kms: float,
    V_c_kms: float,
    safety_factor: float = 2.5,
    sigma_derate: float = 0.30
) -> float:
    """
    [Certain] Tether-to-payload mass ratio (both arms combined), using the
    Moravec/Forward integrated taper-optimized form.

    Accounts for material derate on tensile strength (joints, weave, degradation).
    sigma_derate=0.30 is the conservative Rev A planning case.
    """
    return integrated_mass_ratio(v_tip_kms, V_c_kms, safety_factor, sigma_derate)


def verify_rev_a(tolerance: float = 0.02) -> dict:
    """
    Assert canonical Rev A values against computed results.
    Any test failure means a parameter changed without VM-001 update.
    Returns dict of {check: bool}.
    Tolerance: 2% relative error allowed for floating-point / approximation.
    """
    p = PARAMS
    alt  = p["orbital"]["com_altitude_km"]
    L    = p["geometry"]["tether_half_length_km"]
    vtip = p["kinematics"]["v_tip_kms"]
    sf   = p["materials"]["safety_factor"]
    sig  = p["materials"]["tensile_strength_GPa"]
    rho  = p["materials"]["density_kgm3"]
    derate = p["materials"]["derate_fraction"]

    Vc   = characteristic_velocity_kms(sig, rho)
    vorb = v_orbital_kms(alt)
    vup  = v_upper_release_kms(alt, vtip)
    atip = tip_acceleration_g(vtip, L)

    def close(actual, expected, label):
        rel = abs(actual - expected) / abs(expected)
        ok  = rel < tolerance
        print(f"  {'✓' if ok else '✗'} {label}: computed={actual:.4f}  expected={expected:.4f}  rel_err={rel:.2%}")
        return ok

    print("── Rev A Physics Verification ───────────────────────────────")
    results = {}
    results["V_c_kms"]              = close(Vc,   p["materials"]["V_c_kms"],           "V_c (km/s)")
    results["v_orb_kms"]            = close(vorb, p["orbital"]["v_orb_kms"],            "v_orb (km/s)")
    results["v_upper_release_kms"]  = close(vup,  p["kinematics"]["v_upper_release_kms"], "v_upper_release (km/s)")
    results["tip_accel_g"]          = close(atip, p["kinematics"]["tip_acceleration_g"], "tip accel (g)")

    # Mass ratio: verify the canonical integrated two-arm conservative case.
    mr = tether_mass_ratio(vtip, Vc, sf, sigma_derate=0.30)
    expected_mr = p["mass_ratio"]["integrated_tether_to_payload_both_arms"]["conservative_30pct_derate"]
    results["mass_ratio_integrated"] = close(mr, expected_mr, "integrated tether/payload mass ratio")

    all_pass = all(results.values())
    print(f"── {'ALL PASS' if all_pass else 'FAILURES DETECTED — check params/rev_a.json'} ──")
    return results


if __name__ == "__main__":
    verify_rev_a()
