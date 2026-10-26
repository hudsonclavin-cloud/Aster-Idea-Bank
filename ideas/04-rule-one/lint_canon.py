#!/usr/bin/env python3
"""Rule One: a canon-drift scanner for the Skyhook repository.

Skyhook's Rule 1 says every tether number comes from params/rev_a.json, never
from memory. This script reads the prose, HTML, JSX, JS and Python of a checkout
and compares every number that claims to be a canonical quantity against that
file. It never edits anything; its only outputs are a report and a quote card.

    python3 lint_canon.py <checkout>                 Markdown report, exit 1 on NEW findings
    python3 lint_canon.py <checkout> --format json   the same report as JSON
    python3 lint_canon.py --cite kinematics.v_tip_kms --params params/rev_a.json
    python3 lint_canon.py --verify-canon --params params/rev_a.json
    python3 lint_canon.py --list-keys --params params/rev_a.json
    python3 lint_canon.py --rules                    the rule table as JSON

Three detectors, one rule table (RULES below):

  (a) quantity rules. A number followed by a unit (GPa, kg/m3, km/s, km, g,
      min, km2/s2, x, $/kg, $M, t) is attributed to the NEAREST keyword in its
      line, counted in tokens (ties go to the keyword before the number, and a
      keyword more than 8 tokens away does not count). If that keyword names a
      canonical quantity ("SK99", "mass ratio", "apogee" ...) the number is
      compared with the rev_a.json keys the rule lists; if it names a known
      non-canonical quantity (a SINK such as "payload", "exhaust", "price",
      "perigee") the number is left alone. Assignment forms in code
      (VTIP=3.5, sigma: 3.9e9) are attributed directly. The comparison is
      rounding-aware: a literal matches when canon rounded to the literal's own
      precision equals it (122x, 121.8x and 121.83x all match 121.83; so does
      121.826x, since the lesser precision of the two is used); an integer
      ending in zeros is taken at the precision of its last non-zero digit but
      never looser than 2 percent (85,200 km matches 85,222; 100x does not
      match 121.83). A range (40-122x, 2.7-2.8 km/s) passes when it brackets a
      canonical value. A number preceded by a comparison sign (<=, >, below,
      at most ...) is a bound, not a claim, and is skipped; so is a number
      inside an arithmetic expression (v_orb + v_tip = 10.06).
  (b) stale patterns: "3.5 km/s" with no Phase-3 label in reach; "440x" with
      no unsourced/historical label; "100-200x" in any form; a Conservative /
      Baseline / Optimistic ladder whose derate or retention rungs are not the
      rev_a.json ladder.
  (c) schema drift: parameter paths in code (revA.a.b, PARAMS["a"]["b"],
      ["a", "b"] pairs) and dotted keys quoted in prose after "rev_a.json" are
      resolved against the JSON's keys; a path that does not exist is reported
      with the keys that do.

Every hit is classed from docs/DEVIATIONS.md, parsed by its table rows:
  ACCEPTED    the row's disposition says Leave (a deviation that states itself)
  KNOWN OPEN  the row is tracked but not marked EXECUTED
  NEW         not in the register, or in a row marked EXECUTED (a regression)
  LABELLED    a quantity mismatch whose wide window (200 chars back, 120
              forward, plus the section heading in Markdown) carries a
              self-label such as Phase 3, growth option, historical,
              superseded, retired, was, HASTOL, SF 5 ... Shown, never fails.
A stale-pattern hit (3.5 km/s, 440x, 100-200x, ladder) with such a label is not
a finding at all; it is counted and listed under --verbose. A file that
declares a non-rev_a parameter set (service_mxer_draft.json) is scanned for
patterns and schema only, and named in the report header.

Exit code: 0 no NEW findings; 1 NEW findings; 2 usage or unreadable inputs.

Confidence labels follow Skyhook's convention. [Certain] the arithmetic of the
rounding rule, the range rule and the key resolution. [Likely] the keyword
windows and the self-label vocabulary catch what a reader would read as canon;
both are heuristics and the README lists what they miss. [Speculative] nothing
here: the tool reports, it does not decide.
"""
import argparse
import datetime as _dt
import hashlib
import json
import math
import os
import re
import subprocess
import sys

__version__ = "0.2.0"

SCAN_EXT = (".md", ".html", ".jsx", ".js", ".mjs", ".py", ".yml", ".yaml")
SKIP_DIRS = {".git", "node_modules", "__pycache__", "assets"}
# The canon itself, and the two registers whose job is to quote the wrong numbers.
SKIP_FILES = {"params/rev_a.json", "docs/DEVIATIONS.md", "docs/verification_memo.md"}
# A file that says, near its top, that it runs on the DRAFT in-space parameter
# set rather than rev_a.json. Mentioning MXER in passing does not count.
OTHER_PARAMS_RE = re.compile(
    r"(?i)(?:config source|config_path|draft config|reads|loads|written by this script)[^\n]{0,120}service_mxer_draft"
    r"|service_mxer_draft[^\n]{0,80}(?:is draft|non-canonical)|draft mxer-style")
MAX_TOKENS = 8  # a keyword farther than this from the number does not claim it

# ---------------------------------------------------------------- numbers ---

NUM = r"(?:[-−])?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?|(?:[-−])?\.\d+"
NUM_RE = re.compile(r"(?<![\w.])(?:" + NUM + r")")
RANGE_SEP = r"(?:\s*[–—]\s*|-(?=\d)|\s+to\s+)"
LEAD = r"(?<![\w.])(?:[~≈]\s*)?"
COMPARISON_BEFORE = re.compile(
    r"(?:[<>≤≥]|<=|>=|&lt;|&gt;|at most|at least|up to|below|above|under|over|exceed\w*|beyond|past|than)\s*[~≈]?\s*$", re.I)
# Text between a keyword and its number that means "not this quantity": an
# operator (v_orb + v_tip = 10.06), an "at" sign (fiber @ 5 t), or another
# number with words around it (sits at 0.92 V_c). A bare list of values
# ("mass ratio ~41x (65x/123x") is fine: every number in it is the keyword's.
ARITH_GAP = re.compile(r"[+−×*/^²@]|\bplus\b|\bminus\b|\btimes\b|\bsum\b|\bdifference\b|\bproduct\b|\bfalls?\b|\bdrops?\b")
LIST_GAP = re.compile(r"^(?:[\s\d.,;/()–\-~≈%]|×|\bx\b|\bat\b|\band\b|\bor\b|\bto\b|\bfrom\b|\bbetween\b|\bof\b|km/s|km|GPa|kg/m3|\bkg\b|\bg\b|\bt\b|min|derate|retention|ECI|release|catch|tip)*$", re.I)


def _gap_breaks(gap):
    """True when the text between a keyword and a number disqualifies the pairing:
    a bare list of values is fine; an operator, an @, or another number with
    words around it is not."""
    if LIST_GAP.match(gap):
        return False
    return bool(ARITH_GAP.search(gap)) or bool(re.search(r"\d", gap))


OPERATOR_ADJACENT = re.compile(r"[+−×*/^\-]\s*$")

UNITS = {
    "GPa": r"GPa\b",
    "kg/m3": r"kg\s*(?:/|·|\*)\s*m\s*(?:³|\^3|3|⁻³|\^-3)",
    "km/s": r"km\s*(?:/\s*s|·\s*s⁻¹|\s*s\^-1)(?![\w²^])",
    "km": r"km(?![\w/·²^])",
    "g": r"g(?![\w/])",
    "min": r"min(?:utes?)?\b",
    "x": r"[×x](?!\w)",
    "km2/s2": r"km\s*(?:²|\^2|2)\s*/\s*s\s*(?:²|\^2|2)",
    "t": r"t(?:onnes?)?\b(?!\s*/)",
    "kg": r"kg\b(?!\s*/)",
    "$/kg": None,  # built below: $ before the number
    "$M": None,
}
UNIT_RE = {}
for _u, _pat in UNITS.items():
    if _u == "$/kg":
        UNIT_RE[_u] = re.compile(r"\$\s*(?P<a>" + NUM + r")(?:" + RANGE_SEP + r"\$?\s*(?P<b>" + NUM + r"))?\s*(?:/|per)\s*kg", re.I)
    elif _u == "$M":
        UNIT_RE[_u] = re.compile(r"\$\s*(?P<a>" + NUM + r")(?:" + RANGE_SEP + r"\$?\s*(?P<b>" + NUM + r"))?\s*(?:M\b|million\b)")
    else:
        UNIT_RE[_u] = re.compile(LEAD + r"(?P<a>" + NUM + r")(?:" + RANGE_SEP + r"(?P<b>" + NUM + r"))?\s*(?:" + _pat + r")")


def _num_value(text):
    return float(text.replace(",", "").replace("−", "-"))


def _num_decimals(text):
    """Digits after the point in the literal as written (exponent-free form)."""
    t = text.replace(",", "")
    if "e" in t.lower():
        s = f"{_num_value(text):.10g}"
        return len(s.split(".")[1]) if "." in s else 0
    return len(t.split(".")[1]) if "." in t else 0


def _trailing_zeros(text):
    t = text.replace(",", "")
    if "." in t or "e" in t.lower():
        return 0
    digits = t.lstrip("-−")
    return len(digits) - len(digits.rstrip("0")) if digits.strip("0") else 0


def _decimals_of(value):
    s = repr(float(value))
    if "e" in s:
        return 0
    frac = s.split(".")[1] if "." in s else ""
    return len(frac.rstrip("0"))


ROUND_CAP = 0.05       # a rounding may never be looser than 5 % of canon ("SF 3" is not 2.5)
TRAILING_CAP = 0.03    # an integer's trailing zeros may never hide more than 3 % ("600 km" is not 640)


def rounds_to(literal, canon, scale=1.0, min_decimals=0):
    """True when the literal is a fair rounding of canon. [Certain]

    literal: the text of the number as written (commas, minus sign and exponent
    allowed). scale: multiply the literal by this before comparing (1e-9 reads
    3.9e9 Pa as 3.9 GPa, 0.01 reads 30 % as 0.30, 1e-3 reads 2500 m/s as 2.5).
    The lesser of the two precisions decides the tolerance, so a literal more
    precise than canon (121.826 vs 121.83) still matches at canon's precision;
    min_decimals stops a round canon such as a retention of 1.0 from being read
    at integer precision. The tolerance is capped at ROUND_CAP of canon, and an
    integer ending in zeros is read at the precision of its last non-zero digit
    within TRAILING_CAP of canon.
    """
    v = _num_value(literal) * scale
    if scale != 1.0:
        d = _decimals_of(round(v, 9))
        tz = 0
    else:
        d = _num_decimals(literal)
        tz = _trailing_zeros(literal)
    p = min(d, max(_decimals_of(canon), min_decimals))
    tol = min(0.5 * 10 ** (-p), ROUND_CAP * abs(canon)) if canon else 0.5 * 10 ** (-p)
    diff = abs(canon - v)
    if diff <= tol + 1e-9:
        return True
    if d == 0 and tz > 0:
        unit = 10 ** tz
        if diff <= unit / 2 + 1e-9 and diff <= TRAILING_CAP * abs(canon):
            return True
    return False


def range_brackets(lo_lit, hi_lit, canon, scale=1.0, min_decimals=0):
    """True when canon lies inside [lo, hi], each end widened by its own rounding. [Certain]"""
    lo, hi = _num_value(lo_lit) * scale, _num_value(hi_lit) * scale
    if lo > hi:
        lo, hi = hi, lo
    tl = min(0.5 * 10 ** (-max(_num_decimals(lo_lit), min_decimals)), ROUND_CAP * abs(canon)) if scale == 1.0 else 1e-9
    th = min(0.5 * 10 ** (-max(_num_decimals(hi_lit), min_decimals)), ROUND_CAP * abs(canon)) if scale == 1.0 else 1e-9
    return lo - tl - 1e-9 <= canon <= hi + th + 1e-9


# ------------------------------------------------------------- the canon ---

def flatten(obj, prefix=""):
    """Dotted path -> value for every leaf of rev_a.json (lists by index). [Certain]"""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(flatten(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = obj
    return out


def numeric_keys(flat):
    return {k: v for k, v in flat.items()
            if isinstance(v, (int, float)) and not isinstance(v, bool)
            and not k.split(".")[-1].startswith("_")}


def unit_hint(key):
    """Unit from the key's own suffix, the file's naming convention. [Likely]"""
    leaf = key.split(".")[-1].split("[")[0]
    table = [("_kms2", "km^2/s^2"), ("_kms", "km/s"), ("_km", "km"), ("_GPa", "GPa"),
             ("_kgm3", "kg/m^3"), ("_m3s2", "m^3/s^2"), ("_g", "g"), ("_min", "min"),
             ("_M", "$M"), ("_kgs", "$/kg"), ("_t", "t"), ("_MJkg", "MJ/kg"),
             ("_fraction", "fraction"), ("_year", "year"), ("_payload", "t"), ("_kg", "kg"),
             ("_derate", "x (mass ratio)"), ("_both_arms", "x (mass ratio)"), ("_ratio", "ratio")]
    for suf, unit in table:
        if leaf.endswith(suf):
            return unit
    if "price" in leaf or "break_even" in leaf:
        return "$/kg"
    if "SF" in leaf or "safety_factor" in leaf or "mass_ratio" in leaf:
        return "(dimensionless)"
    if "payload_mass_kg" in leaf:
        return "kg"
    return ""


def load_params(path):
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    return json.loads(raw), hashlib.sha256(raw.encode("utf-8")).hexdigest()


def git_info(path):
    """HEAD, its date and dirtiness for the git checkout that path belongs to.
    A file must be tracked by that checkout (so a snapshot copied into another
    repository does not borrow that repository's commit). Returns {} otherwise."""
    is_dir = os.path.isdir(path)
    d = path if is_dir else os.path.dirname(os.path.abspath(path))
    try:
        run = lambda *a: subprocess.run(["git", "-C", d, *a], capture_output=True, text=True, timeout=20)
        head = run("rev-parse", "HEAD")
        if head.returncode != 0:
            return {}
        if not is_dir and run("ls-files", "--error-unmatch", os.path.basename(path)).returncode != 0:
            return {}
        return {"commit": head.stdout.strip(), "commit_date": run("log", "-1", "--format=%cI").stdout.strip(),
                "dirty": bool(run("status", "--porcelain").stdout.strip())}
    except (OSError, subprocess.SubprocessError):
        return {}


def sidecar_info(params_path):
    """Provenance sidecar written by the Idea Bank's snapshot.mjs, if present."""
    side = params_path + ".provenance.json"
    if os.path.exists(side):
        try:
            with open(side, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}
    return {}


def provenance(params_path, root=None):
    """Where the canon file's commit comes from: its provenance sidecar if it is a
    snapshot, else the checkout that tracks it. Sidecar first, so a snapshot never
    reports the commit of the repository it was copied into."""
    side = sidecar_info(params_path)
    if side.get("commit"):
        return dict(commit=side["commit"], commit_date=side.get("commitDate", ""),
                    dirty=not side.get("readMatchesCommitted", True), source="provenance sidecar")
    g = git_info(params_path)
    if g.get("commit"):
        return dict(commit=g["commit"], commit_date=g["commit_date"], dirty=g["dirty"], source="git")
    if root:
        g = git_info(root)
        if g.get("commit"):
            return dict(commit=g["commit"], commit_date=g["commit_date"], dirty=g["dirty"], source="git (scanned checkout)")
    return dict(commit="", commit_date="", dirty=False, source="unknown")


# ---------------------------------------------------------- rule table ---

# Words that mark a number as knowingly non-canonical. [Likely] A quantity
# mismatch with one of these in its wide window is LABELLED, not NEW; a stale
# pattern with one is not a finding at all.
SELF_LABELS = [
    r"phase[ -]?[123]\b", r"by phase", r"lariat", r"pathfinder", r"growth", r"\boption\b", r"\bmars\b", r"\bescape\b",
    r"hastol", r"threshold", r"historical", r"unsourced", r"superseded", r"supersedes", r"retired", r"retracted",
    r"correct(?:ed|ion)", r"erratum", r"wrongly", r"\bwrong\b", r"stale", r"deviation", r"archival",
    r"pre-reconciliation", r"previously", r"earlier", r"formerly", r"\bold\b", r"\bwas\b", r"\bhad\b", r"no longer",
    r"removed", r"purged", r"illustrat", r"say,", r"hypothetical", r"\bSF\s*[=≈~]?\s*[3-9]\b",
    r"safety factor\s*(?:of\s*)?[3-9]\b", r"exhaust", r"\bIsp\b", r"\bmxer\b", r"in-space", r"\bdraft\b", r"conflat",
    r"mislabel", r"\bbug\b", r"before the fix", r"audit", r"derivation", r"memory", r"legacy", r"coincidence",
    r"_low\b", r"_high\b", r"sensitivity", r"bracket", r"\bsweep\b", r"\bvar(?:y|ies|ied)\b", r"perturb", r"convention",
    r"slider", r"\brange\b", r"workbook", r"financial model",
]
SELF_LABEL_RE = re.compile("|".join(SELF_LABELS), re.I)
X440_LABEL_RE = re.compile(SELF_LABEL_RE.pattern + r"|\berror\b|\bflag\w*|chased|no derivation", re.I)
# The retired 100-200x range is excused only by words that place it in the past.
X100_LABEL_RE = re.compile(r"purged|removed|\bold\b|\bwas\b|\bhad\b|historical|superseded|retired|previously|earlier|formerly|no longer|replaced", re.I)

MR = "mass_ratio.integrated_tether_to_payload_both_arms."
LADDER_KEYS = [MR + "optimistic_0pct_derate", MR + "baseline_15pct_derate", MR + "conservative_30pct_derate",
               MR + "cislunar_2p8kms_30pct_derate", MR + "phase3_3p5kms_30pct_derate"]
FIBER_KEYS = [MR + "optimistic_0pct_fiber_mass_t", MR + "baseline_15pct_fiber_mass_t",
              MR + "conservative_30pct_fiber_mass_t", MR + "cislunar_2p8kms_30pct_fiber_mass_t",
              MR + "phase3_3p5kms_30pct_fiber_mass_t"]
TIP_KEYS = ["kinematics.v_tip_kms", "kinematics.cislunar_revenue_gated_option.v_tip_kms",
            "kinematics.phase3_growth_option.v_tip_kms", "market_thresholds.GTO_tip_speed_kms",
            "market_thresholds.cislunar_TLI_tip_speed_kms", "market_thresholds.escape_C3_0_tip_speed_kms",
            "market_thresholds.mars_class_C3_8_to_13_tip_speed_kms[0]",
            "market_thresholds.mars_class_C3_8_to_13_tip_speed_kms[1]", "market_thresholds.mars_escape_tip_speed_kms"]
MATERIAL_OTHER = r"sk99|dyneema|t1000|t1100|spectra|\bm5\b|\bcnt\b|carbon|hmpe|uhmwpe|kevlar|vectran|aramid"

# Each quantity rule: id, what, kw (keyword regex that claims a number), unit
# (key of UNITS), keys (rev_a.json paths whose values are allowed), optional
# unless (regex in the near window that vetoes), derived (extra allowed values
# from the params), code (assignment regex with group "n"), code_scales (unit
# conversions tried for code forms), code_kw (the line must also mention this).
RULES = [
    dict(id="sigma_zylon", what="Zylon PBO tensile strength", kw=r"zylon|\bpbo\b|primary fiber", unless=r"modulus|stiffness|young",
         unit="GPa", keys=["materials.tensile_strength_GPa"], code=r"\bsigma\s*[:=]\s*(?P<n>" + NUM + r")", code_scales=[1.0, 1e-9], code_kw=r"zylon|pbo"),
    dict(id="sigma_sk99", what="Dyneema SK99 tensile strength (VM-001 corrected 3.9 to 3.6)", kw=r"sk99|dyneema", unless=r"modulus|stiffness|single[- ]fib",
         unit="GPa", keys=["materials.alternative_fibers.Dyneema_SK99_GPa"], code=r"\bsigma\s*[:=]\s*(?P<n>" + NUM + r")", code_scales=[1.0, 1e-9], code_kw=r"sk99|dyneema"),
    dict(id="sigma_t1100g", what="Toray T1100G tensile strength", kw=r"t1100g", unless=r"modulus|stiffness",
         unit="GPa", keys=["materials.alternative_fibers.T1100G_carbon_GPa"], code=r"\bsigma\s*[:=]\s*(?P<n>" + NUM + r")", code_scales=[1.0, 1e-9], code_kw=r"t1100g"),
    dict(id="rho_zylon", what="Zylon PBO density", kw=r"zylon|\bpbo\b", unless="",
         unit="kg/m3", keys=["materials.density_kgm3"], code=r"\brho\s*[:=]\s*(?P<n>" + NUM + r")", code_kw=r"zylon|pbo"),
    dict(id="v_c", what="characteristic velocity V_c of Zylon", kw=r"\bv_?c\b|characteristic velocity|v<sub>c</sub>", unless=MATERIAL_OTHER,
         unit="km/s", keys=["materials.V_c_kms"]),
    dict(id="v_orb", what="orbital speed of the CoM", kw=r"orbital (?:speed|velocity)|\bv_?orb\w*|circular (?:speed|velocity)|hub speed",
         unless=r"slower than|below orbital|less than orbital|relative to|% of|percent of|fraction of|of orbital",
         unit="km/s", keys=["orbital.v_orb_kms"]),
    dict(id="v_tip", what="tip speed", kw=r"tip[\s_-]?speed|\bv_?tip\b|\bvtip\b|tip velocity|spins? at|spinning at",
         unless=r"exhaust|\bIsp\b|modulat|±|Δv|delta-?v|required|falls|drops",
         unit="km/s", keys=TIP_KEYS, code=r"\b(?:v_?tip|VTIP|v_tip_kms|vTipKms)\s*[:=]\s*(?P<n>" + NUM + r")", code_scales=[1.0, 1e-3]),
    dict(id="v_release", what="upper-tip release speed", kw=r"release (?:speed|velocity)|released? at|release at|release(?=\s*[~≈]?\s*\d)|upper[- ]tip (?:speed|velocity)|\bv_?upper\w*|\bv_?release\w*|throws? (?:it |them |payloads? )?(?:out |off )?at|(?<=km/s )release",
         unless=r"exhaust|\bIsp\b|timing|window|slower",
         unit="km/s", keys=["kinematics.v_upper_release_kms", "kinematics.cislunar_revenue_gated_option.v_upper_release_kms",
                           "kinematics.phase3_growth_option.v_upper_release_kms"]),
    dict(id="v_catch", what="lower-tip catch speed (ground-relative, or inertial = v_orb - v_tip)",
         kw=r"ground[\s_-]?rel\w*|catch speed|catch(?=\s*[~≈]?\s*\d)|lower[\s_-]tip (?:speed|velocity)|rendezvous speed|meets? the tether at|catch\w* at|\bv_?lower\w*|\bv_?catch\w*",
         unless=r"exhaust|\bIsp\b|slower than|timing|window|mach",
         unit="km/s", keys=["kinematics.v_lower_tip_groundrel_kms", "kinematics.phase3_growth_option.v_lower_tip_groundrel_kms"],
         derived=[("inertial lower-tip speed: orbital.v_orb_kms - kinematics.v_tip_kms", lambda p: round(p["orbital"]["v_orb_kms"] - p["kinematics"]["v_tip_kms"], 6)),
                  ("inertial lower-tip speed: kinematics.v_upper_release_kms - 2 v_tip_kms", lambda p: round(p["kinematics"]["v_upper_release_kms"] - 2 * p["kinematics"]["v_tip_kms"], 6))]),
    dict(id="tip_g", what="tip acceleration", kw=r"tip accel\w*|g-load\w*|at the tip|tip g\b|\btip(?=\s*[~≈]?\s*\d+(?:\.\d+)?\s*g\b)|a_?tip|V\^?2\s*/\s*L|v_tip\^2\s*/\s*L|v²/L",
         unless=r"gram|weigh|scale|load factor|dynamic|qualification|warning",
         unit="g", keys=["kinematics.tip_acceleration_g", "kinematics.cislunar_revenue_gated_option.tip_acceleration_g",
                        "kinematics.phase3_growth_option.tip_acceleration_g"]),
    dict(id="c3", what="C3 at the upper-tip radius", kw=r"\bC3\b|C₃|C<sub>3</sub>", unless=r"C3\s*=\s*0|C3=0|jupiter|venus|moon|\bmars\b|destination|target",
         unit="km2/s2", keys=["kinematics.c3_kms2", "kinematics.cislunar_revenue_gated_option.c3_kms2", "kinematics.phase3_growth_option.c3_kms2"]),
    dict(id="apogee", what="apogee altitude", kw=r"apogee", unless=r"perigee\s*\d|lunar distance|moon|\bGTO\b|\bGEO\b|circular|transfer|destination|target",
         unit="km", keys=["kinematics.apogee_altitude_km", "kinematics.cislunar_revenue_gated_option.apogee_altitude_km"]),
    dict(id="com_alt", what="CoM orbit altitude", kw=r"\bcom\b|com[\s_-]?alt\w*|cent(?:er|re) of mass|\bhub\b|orbit(?:al)? altitude|altitude of|(?<=km )orbit\b|(?<=km-)altitude|hub altitude",
         unless=r"lower[- ]tip|upper[- ]tip|apogee|perigee|hastol|mach|hand[- ]?off|catch|radius|structure|sweep|class",
         unit="km", keys=["orbital.com_altitude_km"], code=r"\b(?:ALT|com_altitude(?:_km)?|comAltitudeKm)\s*[:=]\s*(?P<n>" + NUM + r")"),
    dict(id="lower_tip_alt", what="lower-tip altitude", kw=r"lower[\s_-]tip|tip[\s_-]?alt\w*|catch altitude|atmosphere[- ]grazing|grazes?", unless=r"hastol|mach|km/s|speed",
         unit="km", keys=["geometry.tip_altitude_lower_km"]),
    dict(id="half_length", what="tether half-length L", kw=r"half[- ]length|\bL\s*[=≈~]|arm length|each arm|per arm|L_half", unless=r"total|2L|tip[- ]to[- ]tip|hastol",
         unit="km", keys=["geometry.tether_half_length_km"], code=r"(?<![\w/*+\-^])(?:L|halfLength(?:Km)?|half_length_km|tether_half_length_km)\s*[:=]\s*(?P<n>" + NUM + r")", code_scales=[1.0, 1e-3]),
    dict(id="total_length", what="total tether length 2L", kw=r"total length|\b2\s*L\b|tip[- ]to[- ]tip|end[- ]to[- ]end|(?<=km[- ])long\b|(?<=km )structure|long structure|structure sweeping", unless=r"hastol|half",
         unit="km", keys=[], derived=[("2 x geometry.tether_half_length_km", lambda p: 2 * p["geometry"]["tether_half_length_km"])]),
    dict(id="rotation_period", what="rotation period", kw=r"rotation period|spin period|period of rotation|rotates every|one rotation|per rotation|per revolution", unless=r"orbit(?:al)? period",
         unit="min", keys=["geometry.rotation_period_min"]),
    dict(id="sf", what="safety factor", kw="", unless=r"hastol|zero taper|no taper",
         unit=None, bare=r"(?:safety factor|\bSF\b)\s*(?:of\s*|=\s*|:\s*|≈\s*)?(?P<n>" + NUM + r")(?![\d.])", keys=["materials.safety_factor"],
         code=r"\b(?:SF|safety_factor|safetyFactor)\s*[:=]\s*(?P<n>" + NUM + r")", skip_values=[1.0]),
    dict(id="derate", what="strength derate / retention", kw="", unless=r"creep",
         unit=None, bare=r"(?:derate|retention|strength reduction)\D{0,16}?(?P<n>" + NUM + r")\s*(?P<pct>%)?|(?P<n2>" + NUM + r")\s*(?P<pct2>%)?\s*(?:strength\s*)?(?:derate|retention)",
         keys=["materials.derate_fraction"], derived="ladder", fraction_only=True,
         code=r"\b(?:derate|retention|derate_fraction|strength_retention|sigma_derate)\s*[:=]\s*(?P<n>" + NUM + r")"),
    dict(id="mass_ratio", what="integrated two-arm tether-to-payload mass ratio", kw=r"mass[\s-]*ratio|tether[\s-]*to[\s-]*payload|m_?tether|times (?:the )?payload|\bM/m\b|facility mass|tether\s*≈|tether mass\w*\s*[≈~=]|outweigh\w*|× payload",
         unless=r"taper|:1|warp|cadence|365|arm integral|load factor|too (?:low|high|light|heavy)",
         unit="x", keys=LADDER_KEYS + ["heritage.HASTOL_mass_ratio_at_SF3"]),
    dict(id="fiber_mass", what="fiber mass at the 5 t design payload", kw=r"fib(?:er|re) mass|tether mass|of fib(?:er|re)|t of zylon|fib(?:er|re) launch|\bfib(?:er|re)\b", unless=r"per catch|rotovator|hardware|creep",
         unit="t", keys=FIBER_KEYS),
    dict(id="launch_dedicated", what="dedicated-launch price anchor (Falcon 9)", kw=r"dedicated|falcon(?:\s*9)?|\bf9\b",
         unless=r"rideshare|marginal|construction|customer|break-?even|floor|starship|electron|transporter|haste|\bleg\b|anchor price",
         unit="$/kg", keys=["economics.launch_price_anchor_dedicated_kgs"]),
    dict(id="launch_rideshare", what="rideshare price anchor", kw=r"rideshare|transporter", unless=r"dedicated|marginal|construction|customer|floor",
         unit="$/kg", keys=["economics.launch_price_rideshare_kgs"]),
    dict(id="launch_marginal", what="SpaceX internal marginal cost (speculative floor)", kw=r"spacex internal|internal marginal|internal cost|marginal launch|launch floor|internal_marginal",
         unless=r"dedicated|rideshare|construction|customer|\bleg\b|recurring|\bask\b|target",
         unit="$/kg", keys=["economics.spacex_internal_marginal_kgs"]),
    dict(id="phase0_capex", what="Phase 0 capex", kw=r"phase[ -]?0", unless=r"per year|/yr",
         unit="$M", keys=["economics.phase0_capex_M"]),
    dict(id="heritage_seds", what="SEDS tether length", kw=r"\bseds\b", unless=r"altitude", unit="km", keys=["heritage.SEDS_1_2_km"]),
    dict(id="heritage_tss", what="TSS-1R tether length", kw=r"tss-?1r", unless=r"altitude|\bV\b|volt", unit="km", keys=["heritage.TSS1R_km"]),
    dict(id="heritage_yes2", what="YES2 tether length", kw=r"\byes-?2\b", unless=r"altitude", unit="km", keys=["heritage.YES2_km"]),
]

# Keywords that claim a number so a canonical rule cannot, and are never checked:
# quantities the repo legitimately states that are not in rev_a.json. [Likely]
SINKS = [
    r"payload", r"Δv", r"delta-?v", r"\bdv\b", r"exhaust", r"\bIsp\b", r"v_?e\b", r"escape (?:speed|velocity)", r"v_?esc\b",
    r"perigee", r"\bmach\b", r"\bGTO\b", r"\bGEO\b", r"\bLEO\b", r"\bTLI\b", r"lunar", r"\bmoon\b", r"jupiter", r"venus",
    r"insur\w*", r"\bprice\b", r"\bcost\b", r"\bask\b", r"revenue", r"capex", r"amort\w*", r"\bNRE\b", r"budget",
    r"modulus", r"stiffness", r"creep", r"break(?:ing)? (?:strength|load)", r"\bload\b", r"taper", r"cadence", r"catches",
    r"warp", r"\byear\b", r"\byr\b", r"hub mass", r"station mass", r"control station", r"rotovator", r"stage", r"vehicle",
    r"spectra\b", r"t1000g", r"\bm5\b", r"\bcnt\b", r"kevlar", r"vectran", r"aramid", r"hmpe", r"uhmwpe", r"zing-?it",
    r"circular", r"transfer", r"altitude of the", r"grazes?", r"\bmm\b", r"diameter", r"line\b", r"rope", r"throw line",
    r"ascent loss\w*", r"losses", r"power", r"\beff\w*", r"kwh", r"electric\w*", r"energy", r"\bC3\s*=\s*0",
    r"tonnage", r"upmass", r"demand", r"t/yr", r"per year", r"annual", r"margin", r"discount", r"share", r"multiple",
]
SINK_RE = re.compile("|".join(SINKS), re.I)

LADDER_RE = re.compile(r"(Conservative|Baseline|Optimistic)\W{0,6}(?:\{\s*)?(?:derate|retention|d)\s*:\s*(" + NUM + r")", re.I)
V35_RE = re.compile(LEAD + r"(3\.5)\s*(?:km\s*/\s*s|km\s*s⁻¹)(?![\w²^])|\b(?:VTIP|v_?tip)\s*[:=]\s*(3\.5)\b|(?:useState\(|value=[\"'])(3\.5)[\"')]", re.I)
X440_RE = re.compile(r"(?<![\d.])(440)\s*[×x](?!\w)")
X100_200_RE = re.compile(r"(?<![\d.])(100)\s*(?:[–—-]|\s*to\s*)\s*(200)\s*[×x](?!\w)")
PHASE3_EXTRA_RE = re.compile(r"C3\s*[≈~=+]?\s*\+?13|\boriginal\b|→", re.I)

PATH_ROOTS = r"(?:revA|rev_a|REV_A|PARAMS|params|data|cfg|\bp)"
CODE_PATH_RE = re.compile(r"\b" + PATH_ROOTS + r"((?:\?\.|\.)[A-Za-z_]\w*(?:(?:\?\.|\.)[A-Za-z_]\w*|\[\s*[\"'][\w ]+[\"']\s*\])*|(?:\[\s*[\"'][\w ]+[\"']\s*\])+)")
PAIR_PATH_RE = re.compile(r"\[\s*\"([A-Za-z_]\w*)\"\s*,\s*\"([A-Za-z_]\w*)\"\s*\]")
PROSE_PATH_RE = re.compile(r"rev_a\.json[^\n`]{0,160}?`([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)`")
PROSE_LEAF_RE = re.compile(r"rev_a\.json[^\n`]{0,80}?`([a-z]\w*_\w+)`")
HASH_RE = re.compile(r"\b[0-9a-f]{7,40}\b")


def ladder_values(params):
    """Derate and retention rungs from rev_a.json: derate_fraction plus the
    NNpct_derate rungs named in the mass-ratio keys, each also as 1 - x. [Certain]"""
    rungs = {float(params["materials"]["derate_fraction"])}
    for k in params["mass_ratio"]["integrated_tether_to_payload_both_arms"]:
        m = re.search(r"(\d+)pct_derate", k)
        if m:
            rungs.add(int(m.group(1)) / 100.0)
    allowed = []
    for d in sorted(rungs):
        allowed.append((f"derate {d:g}", d))
        allowed.append((f"retention 1-{d:g}", round(1 - d, 6)))
    return allowed


def ladder_tiers(params):
    """Tier -> (derate, retention) from the mass-ratio key names
    (conservative_30pct_derate, baseline_15pct_derate, optimistic_0pct_derate). [Certain]"""
    tiers = {}
    for k in params["mass_ratio"]["integrated_tether_to_payload_both_arms"]:
        m = re.match(r"(conservative|baseline|optimistic)_(\d+)pct_derate$", k)
        if m:
            d = int(m.group(2)) / 100.0
            tiers[m.group(1)] = (d, round(1 - d, 6))
    return tiers


# ----------------------------------------------------------- the scanner ---

def _tokens_between(text):
    return len(re.findall(r"\S+", text))


def _wide(lines, idx, start, end, heading=""):
    """Wide window: 200 chars back and 120 forward around the literal (the
    literal included, so "SF 5" reads as one phrase), spilling into neighbour
    lines, plus the nearest preceding Markdown heading."""
    line = lines[idx]
    before = line[max(0, start - 200):start]
    after = line[end:end + 120]
    if len(before) < 200 and idx > 0:
        before = lines[idx - 1][-(200 - len(before)):] + " " + before
    if len(after) < 120 and idx + 1 < len(lines):
        after = after + " " + lines[idx + 1][:120 - len(after)]
    return heading + " | " + before + line[start:end] + after


def _headings(lines, path):
    """For each line, the nearest preceding Markdown heading (Markdown only)."""
    out, cur = [], ""
    for ln in lines:
        if path.endswith(".md") and ln.startswith("#"):
            cur = ln.strip("# ").strip()
        out.append(cur)
    return out


def classify(f, allow, line_text=""):
    """(cls, row) for a finding against the DEVIATIONS rows: ACCEPTED / KNOWN OPEN /
    NEW and the matched row (None when untracked). A row matches when its file
    matches and either one of the snippets it quotes occurs in the finding's
    line, or, for a row without usable snippets, one of the numbers it names is
    the number found. [Certain for the matching rule]"""
    p = f["path"].replace(os.sep, "/")
    values = f.get("found_values") or []
    best = None
    for row in allow:
        if not any(p == rp or p.endswith("/" + rp) or rp.endswith("/" + p) for rp in row["paths"]):
            continue
        if row["snippets"]:
            if any(s in line_text for s in row["snippets"]):
                best = row
                break
            continue
        by_value = any(abs(v - fv) < 1e-9 for v in row["values"] for fv in values)
        by_line = any(abs(f.get("line", 0) - l) <= 3 for l in row["lines"])
        if by_value:
            best = row
            break
        if by_line and not values and best is None:
            best = row
    if best is None:
        return "NEW", None
    if best["state"] == "accepted":
        return "ACCEPTED", best
    if best["state"] == "open":
        return "KNOWN OPEN", best
    f["note"] = (f.get("note", "") + f" Regression: DEVIATIONS #{best['no']} is marked EXECUTED.").strip()
    return "NEW", best


def scan_text(text, path, params, flat, allow, verbose_bucket, declared=None):
    """Scan one file's text. Returns a list of finding dicts."""
    findings = []
    lines = text.split("\n")
    heads = _headings(lines, path)
    seen = set()
    ladder = ladder_values(params)
    ladder_allowed = [v for _, v in ladder]
    tiers = ladder_tiers(params)
    other_params = bool(OTHER_PARAMS_RE.search("\n".join(lines[:60])))
    if other_params and declared is not None:
        declared.append(path)
    is_code = path.endswith((".js", ".jsx", ".mjs", ".html", ".py"))

    def add(idx, start, end, rule, what, found, canon, found_values, note="", labelled=None):
        key = (idx, start, end)
        if key in seen:
            return
        seen.add(key)
        f = dict(path=path, line=idx + 1, col=start + 1, rule=rule, what=what, found=found, found_values=found_values,
                 canon=canon, note=note, context=lines[idx].strip()[:220], heading=heads[idx])
        f["cls"], f["deviation"] = classify(f, allow, lines[idx])
        if labelled and f["cls"] == "NEW":
            f["cls"] = "LABELLED"
            f["label"] = labelled
            f["note"] = re.sub(r"\s*Regression: DEVIATIONS #\d+ is marked EXECUTED\.", "", f["note"]).strip()
        findings.append(f)

    def suppressed(idx, start, end, rule, found, label):
        key = (idx, start, end)
        if key in seen:
            return
        seen.add(key)
        verbose_bucket.append(dict(path=path, line=idx + 1, rule=rule, found=found, label=label,
                                   context=lines[idx].strip()[:160]))

    def self_label(idx, start, end, regex=SELF_LABEL_RE):
        m = regex.search(_wide(lines, idx, start, end, heads[idx]))
        return m.group(0) if m else None

    def pattern_hit(idx, s, e, rule, what, found, canon, found_values, note, label_re):
        """A stale-pattern hit: a label suppresses it unless DEVIATIONS tracks it as Leave/open."""
        lab = self_label(idx, s, e, label_re)
        probe = dict(path=path, line=idx + 1, found_values=found_values)
        cls, dev = classify(probe, allow, lines[idx])
        if lab and (dev is None or dev["state"] == "fixed"):
            suppressed(idx, s, e, rule, found, lab)
            return
        add(idx, s, e, rule, what, found, canon, found_values, note)

    # (b) stale patterns first, so they own their literal.
    for idx, line in enumerate(lines):
        for m in V35_RE.finditer(line):
            g = next(i for i in (1, 2, 3) if m.group(i))
            canon = [dict(key="kinematics.v_tip_kms", value=flat["kinematics.v_tip_kms"]),
                     dict(key="kinematics.phase3_growth_option.v_tip_kms", value=flat["kinematics.phase3_growth_option.v_tip_kms"])]
            pattern_hit(idx, m.start(g), m.end(g), "v35_unlabelled", "3.5 km/s with no Phase-3 label in reach", "3.5 km/s", canon, [3.5],
                        "3.5 km/s is the Phase 3 growth option; the reference is 2.5 km/s. Label it or cite the option key.",
                        re.compile(SELF_LABEL_RE.pattern + "|" + PHASE3_EXTRA_RE.pattern, re.I))
        for m in X440_RE.finditer(line):
            canon = [dict(key=MR + "phase3_3p5kms_30pct_derate", value=flat[MR + "phase3_3p5kms_30pct_derate"]),
                     dict(key=MR + "conservative_30pct_derate", value=flat[MR + "conservative_30pct_derate"])]
            pattern_hit(idx, m.start(1), m.end(1), "x440_unlabelled", "the unsourced 440x figure, unlabelled", "440x", canon, [440.0],
                        "DECISION_LOG item 1: 440x is EQ-6 at 3.5 km/s and 0 % derate, never a Rev A number.", X440_LABEL_RE)
        for m in X100_200_RE.finditer(line):
            canon = [dict(key=k, value=flat[k]) for k in LADDER_KEYS[:3]]
            pattern_hit(idx, m.start(1), m.end(2), "x100_200", "the retired 100-200x planning range", line[m.start(1):m.end(2) + 1].strip(), canon, [100.0, 200.0],
                        "The Rev A ladder is 40.32 / 64.30 / 121.83x at 0 / 15 / 30 % derate (rev_a.json mass_ratio).", X100_LABEL_RE)
        for m in LADDER_RE.finditer(line):
            rung, lit = m.group(1), m.group(2)
            tier = tiers.get(rung.lower())
            expected = list(tier) if tier else ladder_allowed
            if any(rounds_to(lit, v, 1.0, 2) for v in expected):
                continue
            key = f"mass_ratio.*.{rung.lower()}_{int(round(tier[0] * 100))}pct_derate" if tier else "materials.derate_fraction and the NNpct_derate rungs"
            canon = [dict(key=key, value=(f"derate {tier[0]:g} or retention {tier[1]:g}" if tier else " / ".join(f"{l}={v:g}" for l, v in ladder)))]
            pattern_hit(idx, m.start(2), m.end(2), "ladder", f"{rung} rung of a derate/retention ladder", lit, canon, [_num_value(lit)],
                        "DEVIATIONS #8 pattern: each rung must be its tier's rev_a.json derate (0.30/0.15/0) or retention (0.70/0.85/1.00).", SELF_LABEL_RE)

    # (a) quantity rules, unless the file declares another parameter set.
    if not other_params:
        for idx, line in enumerate(lines):
            if not NUM_RE.search(line):
                continue
            for cand in _candidates(line, is_code):
                _evaluate(cand, idx, line, lines, heads, path, params, flat, ladder, add, self_label, seen)

    # (c) schema drift.
    top = set(params.keys())
    for idx, line in enumerate(lines):
        for m in CODE_PATH_RE.finditer(line):
            segs = re.findall(r"[A-Za-z_]\w*", m.group(1))
            if not segs or segs[0] not in top:
                continue
            missing = resolve(params, segs)
            if missing:
                add(idx, m.start(), m.end(), "schema", "parameter path not in rev_a.json", ".".join(segs),
                    [dict(key=missing["parent"], value=missing["keys"])], [],
                    f"'{missing['missing']}' is not a key of {missing['parent']}; a consumer indexing it gets undefined.")
        for m in PAIR_PATH_RE.finditer(line):
            segs = [m.group(1), m.group(2)]
            if segs[0] in top:
                missing = resolve(params, segs)
                if missing:
                    add(idx, m.start(), m.end(), "schema", "parameter path not in rev_a.json", ".".join(segs),
                        [dict(key=missing["parent"], value=missing["keys"])], [])
        for m in PROSE_PATH_RE.finditer(line):
            segs = m.group(1).split(".")
            if segs[0] in top:
                missing = resolve(params, segs)
                if missing:
                    lab = HASH_RE.search(_wide(lines, idx, m.start(1), m.end(1))) or self_label(idx, m.start(1), m.end(1))
                    if lab:
                        suppressed(idx, m.start(1), m.end(1), "schema", m.group(1), lab if isinstance(lab, str) else "commit hash nearby")
                        continue
                    add(idx, m.start(1), m.end(1), "schema", "quoted key path not in rev_a.json", m.group(1),
                        [dict(key=missing["parent"], value=missing["keys"])], [])
        for m in PROSE_LEAF_RE.finditer(line):
            leaf = m.group(1)
            if leaf in top or any(seg == leaf for k in flat for seg in re.split(r"[.\[]", k)):
                continue
            lab = HASH_RE.search(_wide(lines, idx, m.start(1), m.end(1))) or self_label(idx, m.start(1), m.end(1))
            if lab:
                suppressed(idx, m.start(1), m.end(1), "schema", leaf, lab if isinstance(lab, str) else "commit hash nearby")
                continue
            add(idx, m.start(1), m.end(1), "schema", "quoted key name not in rev_a.json", leaf,
                [dict(key="rev_a.json top-level keys", value=sorted(top))], [])
    return findings


def _candidates(line, is_code):
    """Every number on the line that carries a unit, an assignment or a bare
    SF/derate form. Each: dict(s, e, lits, unit, scale, rule, direct)."""
    out = []
    taken = set()
    for unit, pat in UNIT_RE.items():
        for m in pat.finditer(line):
            s = m.start("a")
            e = m.end("b") if m.group("b") else m.end("a")
            span = (s, e)
            if any(s < te and e > ts for ts, te in taken):
                continue
            taken.add(span)
            out.append(dict(s=s, e=e, unit_end=m.end(), lits=[m.group("a")] + ([m.group("b")] if m.group("b") else []),
                            unit=unit, scale=1.0, rule=None, direct=False))
    for rule in RULES:
        if rule.get("code") and is_code:
            for m in re.finditer(rule["code"], line):
                if rule.get("code_kw") and not re.search(rule["code_kw"], line, re.I):
                    continue
                before = line[:m.start()].rstrip()
                if before and before[-1] in "+-*/^":
                    continue  # part of an expression
                tail = line[m.end("n"):].lstrip()
                if tail and tail[0] in "*+/-^" and not tail.startswith("-"):
                    continue
                out.append(dict(s=m.start("n"), e=m.end("n"), unit_end=m.end("n"), lits=[m.group("n")], unit=None,
                                scale=1.0, rule=rule, direct=True, scales=rule.get("code_scales", [1.0])))
        if rule.get("bare"):
            for m in re.finditer(rule["bare"], line, re.I):
                for g, pg in (("n", "pct"), ("n2", "pct2")):
                    if g in m.groupdict() and m.group(g):
                        scale = 0.01 if (pg in m.groupdict() and m.group(pg)) else 1.0
                        out.append(dict(s=m.start(g), e=m.end(g), unit_end=m.end(g), lits=[m.group(g)], unit=None,
                                        scale=scale, rule=rule, direct=True, scales=[scale]))
    return out


def _attribute(line, cand):
    """Nearest keyword (by tokens, ties to the one before) among RULES and SINKS.
    Returns (rule or 'sink' or None, keyword text, gap text)."""
    s, ue = cand["s"], cand["unit_end"]
    lo, hi = max(0, s - 100), min(len(line), ue + 80)
    best = None  # (distance, before/after, unit mismatch, order, owner, kw, gap)
    for order, (owner, regex) in enumerate([(r, r["kw"]) for r in RULES if r.get("kw")] + [("sink", SINK_RE.pattern)]):
        # "Zylon" names both a strength and a density: at equal distance the rule stated in the number's unit wins.
        mismatch = 0 if owner == "sink" or owner.get("unit") == cand.get("unit") else 1
        for m in re.finditer(regex, line, re.I):
            if m.end() <= s and m.start() >= lo:
                if OPERATOR_ADJACENT.search(line[lo:m.start()]):
                    continue  # "v_orb - v_tip": the keyword is an operand, not a label
                gap = line[m.end():s]
                cand_t = (_tokens_between(gap), 0, mismatch, order, owner, m.group(0), gap)
            elif m.start() >= ue and m.end() <= hi:
                if re.match(r"\s*[+−×*/^\-]", line[m.end():]):
                    continue
                gap = line[ue:m.start()]
                cand_t = (_tokens_between(gap), 1, mismatch, order, owner, m.group(0), gap)
            else:
                continue
            if best is None or cand_t[:4] < best[:4]:
                best = cand_t
    if best is None or best[0] > MAX_TOKENS:
        return None, "", ""
    return best[4], best[5], best[6]


def _evaluate(cand, idx, line, lines, heads, path, params, flat, ladder, add, self_label, seen):
    if cand["direct"]:
        rule, gap = cand["rule"], ""
    else:
        rule, kw, gap = _attribute(line, cand)
        if rule is None or rule == "sink":
            return
        if rule.get("unit") != cand["unit"]:
            return  # the nearest quantity is not stated in this unit
        if _gap_breaks(gap):
            return  # an expression or another quantity sits between keyword and number
    s, e = cand["s"], cand["e"]
    near = line[max(0, s - 80):s] + " " + line[e:e + 60]
    if rule.get("unless") and re.search(rule["unless"], near, re.I):
        return
    if COMPARISON_BEFORE.search(line[max(0, s - 14):s]):
        return
    allowed = [(k, flat[k]) for k in rule.get("keys", []) if k in flat]
    if rule.get("derived") == "ladder":
        allowed += ladder
    elif rule.get("derived"):
        allowed += [(lab, fn(params)) for lab, fn in rule["derived"]]
    if not allowed:
        return
    lits = cand["lits"]
    scales = cand.get("scales") or [cand["scale"]]
    md = 2 if rule.get("fraction_only") else 0
    for scale in scales:
        values = [_num_value(l) * scale for l in lits]
        if rule.get("fraction_only") and any(v > 1.0 + 1e-9 or v < 0 for v in values):
            if scale == scales[-1]:
                return  # not a fraction or a percentage: not a derate claim
            continue
        if rule.get("skip_values") and any(abs(v - sv) < 1e-9 for v in values for sv in rule["skip_values"]):
            return
        if len(lits) == 2:
            if any(range_brackets(lits[0], lits[1], v, scale, md) for _, v in allowed):
                return
        elif any(rounds_to(lits[0], v, scale, md) for _, v in allowed):
            return
    scale = scales[0]
    shown = ("–".join(lits) if len(lits) == 2 else lits[0]) + (f" {cand['unit']}" if cand.get("unit") else "")
    if scale not in (1.0,) and len(lits) == 1:
        shown = f"{lits[0]} (= {_num_value(lits[0]) * scale:g})"
    canon = [dict(key=k, value=v) for k, v in allowed]
    lab = self_label(idx, s, e)
    add(idx, s, e, rule["id"], rule["what"], shown, canon, [_num_value(l) for l in lits], "", labelled=lab)


def resolve(params, segs):
    node, parent = params, "rev_a.json"
    for s in segs:
        if isinstance(node, dict) and s in node:
            node = node[s]
            parent = s if parent == "rev_a.json" else f"{parent}.{s}"
        else:
            keys = sorted(node.keys()) if isinstance(node, dict) else []
            return dict(parent=parent, missing=s, keys=keys)
    return None


# ------------------------------------------------- the DEVIATIONS allow-list ---

def parse_deviations(text):
    """Table rows of docs/DEVIATIONS.md -> allow-list rows. [Certain for the parse;
    Likely that 'Leave' / 'EXECUTED' are the right disposition keywords]"""
    rows = []
    for raw in text.split("\n"):
        if not re.match(r"^\|\s*\d+\s*\|", raw):
            continue
        cells = [c.strip() for c in raw.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue
        no = int(cells[0])
        where, shows, disp = cells[1], cells[2], " ".join(cells[4:])
        paths = set(re.findall(r"`([\w./-]+\.(?:md|html|jsx|js|mjs|py|yml|json))`", where))
        paths |= set(re.findall(r"`([\w./-]+/[\w./-]+)`", where))
        nums = []
        for t in NUM_RE.findall(where + " " + shows):
            try:
                nums.append(_num_value(t))
            except ValueError:
                pass
        line_refs = [int(x) for x in re.findall(r"lines?\s*~?\s*(\d+)", where, re.I)]
        line_refs += [int(x) for x in re.findall(r"~(\d{2,})", where)]
        # What the row quotes: "..." and `...` snippets that carry a number and are
        # not elided, so a finding is matched to the row by the text it names.
        snippets = []
        for s in re.findall(r"\"([^\"]{6,})\"|`([^`]{6,})`", where + " " + shows):
            s = (s[0] or s[1]).strip()
            s = re.sub(r"^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$", "", s)  # an elided end is still a prefix
            if "..." in s or "…" in s or not re.search(r"\d", s) or s in paths:
                continue
            snippets.append(s)
        if re.search(r"\bleave\b", disp, re.I):
            state = "accepted"
        elif re.search(r"EXECUTED", disp):
            state = "fixed"
        else:
            state = "open"
        rows.append(dict(no=no, paths=sorted(paths), values=nums, lines=sorted(set(line_refs)), snippets=snippets, state=state,
                         shows=shows[:200], disposition=disp[:160]))
    return rows


# ------------------------------------------------------------- the report ---

def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for fn in sorted(filenames):
            if fn.endswith(SCAN_EXT):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, root).replace(os.sep, "/")
                if rel in SKIP_FILES or rel.endswith(".provenance.json"):
                    continue
                yield full, rel


CLASS_ORDER = {"NEW": 0, "KNOWN OPEN": 1, "ACCEPTED": 2, "LABELLED": 3}
CLASSES = ("NEW", "KNOWN OPEN", "ACCEPTED", "LABELLED")


def scan(root, params, flat, allow, verbose_bucket, declared):
    findings, n = [], 0
    for full, rel in iter_files(root):
        try:
            with open(full, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        n += 1
        findings.extend(scan_text(text, rel, params, flat, allow, verbose_bucket, declared))
    findings.sort(key=lambda f: (CLASS_ORDER[f["cls"]], f["path"], f["line"], f["col"]))
    return findings, n


def build_meta(root, params_path, params, sha, allow, nfiles, dev_path, declared):
    prov = provenance(params_path, root)
    return dict(
        tool=f"lint_canon.py {__version__}",
        generated=_dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
        scanned=root or "", files_scanned=nfiles, extensions=list(SCAN_EXT), skipped=sorted(SKIP_FILES),
        declared_other_params=sorted(declared),
        commit=prov["commit"], commit_source=prov["source"], commit_date=prov["commit_date"], dirty=prov["dirty"],
        canon_path=params_path, canon_sha256=sha,
        revision=params.get("_meta", {}).get("revision", ""),
        last_verified=params.get("_meta", {}).get("last_verified", ""),
        verification_memo=params.get("_meta", {}).get("verification_memo", ""),
        deviations_path=dev_path or "", deviations_rows=len(allow),
        deviations_states={s: sum(1 for r in allow if r["state"] == s) for s in ("accepted", "open", "fixed")},
    )


def fmt_canon(c):
    if not c:
        return ""
    first = c[0]
    v = first["value"]
    if isinstance(v, list):
        v = ", ".join(map(str, v))
    s = f"{first['key']} = {v}"
    if len(c) > 1:
        s += "; also allowed: " + ", ".join(str(x["value"]) for x in c[1:])
    return s


def render_md(meta, findings, suppressed, verbose=False, verify_rows=None):
    counts = {c: sum(1 for f in findings if f["cls"] == c) for c in CLASSES}
    out = ["# Rule One: canon-drift report", ""]
    where = meta["scanned"] or "(no checkout)"
    c7 = meta["commit"][:7] if meta["commit"] else "unknown commit"
    dirty = " (working tree dirty)" if meta.get("dirty") else ""
    out.append(f"Scanned {where} at {c7}{dirty}, {meta['files_scanned']} files ({' '.join(meta['extensions'])}).")
    out.append(f"Canon: {meta['canon_path']} ({meta['revision']}, last verified {meta['last_verified']}, {meta['verification_memo']}); sha256 {meta['canon_sha256'][:16]}...")
    ds = meta["deviations_states"]
    out.append(f"Allow-list: {meta['deviations_path'] or 'none'} ({meta['deviations_rows']} rows: {ds.get('accepted', 0)} Leave, {ds.get('open', 0)} open, {ds.get('fixed', 0)} executed).")
    out.append(f"Skipped on purpose: {', '.join(meta['skipped'])}.")
    if meta.get("declared_other_params"):
        out.append(f"Declared non-rev_a parameter set (patterns and schema only): {', '.join(meta['declared_other_params'])}.")
    out.append(f"Generated {meta['generated']}. This report is dated to that commit; the next commit may add or fix findings.")
    out.append("")
    out.append(f"Result: {counts['NEW']} NEW, {counts['KNOWN OPEN']} KNOWN OPEN, {counts['ACCEPTED']} ACCEPTED, {counts['LABELLED']} LABELLED, "
               f"{len(suppressed)} labelled pattern mentions skipped. Exit {1 if counts['NEW'] else 0}.")
    out.append("")
    blurbs = {"NEW": "not in DEVIATIONS.md; these fail the run",
              "KNOWN OPEN": "tracked in DEVIATIONS.md, not yet fixed",
              "ACCEPTED": "DEVIATIONS.md says Leave: a deviation that states itself",
              "LABELLED": "a mismatch with a self-label nearby; shown, never fails; read these too"}
    for cls in CLASSES:
        out.append(f"## {cls} ({counts[cls]}): {blurbs[cls]}")
        out.append("")
        for f in [x for x in findings if x["cls"] == cls]:
            dev = f" [DEVIATIONS #{f['deviation']['no']}]" if f.get("deviation") else ""
            lab = f" label \"{f['label']}\"" if f.get("label") else ""
            out.append(f"- {f['path']}:{f['line']}  found {f['found']}  [{f['rule']}] {f['what']}{dev}{lab}")
            out.append(f"    canon: {fmt_canon(f['canon'])}")
            if f.get("note"):
                out.append(f"    note: {f['note']}")
            out.append(f"    > {f['context']}")
        if not counts[cls]:
            out.append("- none")
        out.append("")
    out.append(f"## Skipped labelled pattern mentions ({len(suppressed)}){'' if verbose else ': run with --verbose to list them'}")
    out.append("")
    if verbose:
        for s in suppressed:
            out.append(f"- {s['path']}:{s['line']}  {s['found']}  [{s['rule']}] label \"{s['label']}\"")
            out.append(f"    > {s['context']}")
        out.append("")
    if verify_rows:
        out.append("## Canon self-check (--verify-canon)")
        out.append("")
        out.extend(render_verify(verify_rows))
    return "\n".join(out).rstrip() + "\n"


# ------------------------------------------------------------ quote card ---

def _tokens(name):
    return {t.lower() for t in re.split(r"[_\[\]\d]+", name)
            if t and t.lower() not in {"note", "kms", "km", "g", "min", "m", "s", "t", "pct", "gpa", "kgm", "kgs"}}


def cite(params, flat, key, params_path, sha):
    if key not in flat:
        close = [k for k in flat if key.split(".")[-1] in k]
        raise KeyError(f"no such key {key}" + (f"; did you mean: {', '.join(close[:6])}" if close else ""))
    value = flat[key]
    parent_path = key.rsplit(".", 1)[0] if "." in key else ""
    parent = params
    for seg in (parent_path.split(".") if parent_path else []):
        parent = parent[re.sub(r"\[\d+\]$", "", seg)]
    leaf = key.split(".")[-1]
    notes = []
    if isinstance(parent, dict):
        ktoks = _tokens(leaf)
        for nk, nv in parent.items():
            if not isinstance(nv, str):
                continue
            if nk.startswith("_") and nk.endswith("note"):
                if ktoks & _tokens(nk) or re.search(r"\b" + re.escape(leaf.split("_")[0]) + r"\b", nv):
                    notes.append((nk, nv))
            elif nk in ("note", "confidence", "source", "equation"):
                notes.append((nk, nv))
    labels = sorted({m for _, nv in notes for pair in re.findall(r"\[(Certain|Likely|Speculative)[^\]]*\]|;\s*(Certain|Likely|Speculative)\b", nv) for m in pair if m})
    prov = provenance(params_path)
    commit = prov["commit"] or "unknown"
    meta = params.get("_meta", {})
    unit = unit_hint(key)
    card = [f"> **{key} = {value}**{(' ' + unit) if unit else ''}"]
    for nk, nv in notes:
        card.append(f"> {nk}: {nv}")
    if labels:
        card.append(f"> Confidence: {', '.join('[' + l + ']' for l in labels)} (as labelled in the notes above)")
    else:
        card.append("> Confidence: no [Certain]/[Likely]/[Speculative] label on this key or its notes")
    card.append(f"> Source: {params_path} @ {commit[:7]} ({meta.get('revision', '?')}, last verified {meta.get('last_verified', '?')}, "
                f"{meta.get('verification_memo', '?')}); sha256 {sha}")
    card.append(f"> Cited {_dt.date.today().isoformat()} with lint_canon.py --cite {key}")
    return "\n".join(card) + "\n"


# ------------------------------------------------------ canon self-check ---

R_EARTH_KM = 6371.0           # mean radius, as physics/skyhook_physics.py:40 [Certain]
SIDEREAL_DAY_S = 86164.0905   # IERS; gives the 0.465 km/s equatorial speed the notes use [Certain]
G0 = 9.80665                  # standard gravity [Certain]


def integrated_mass_ratio(v_tip_kms, vc_kms, sf, derate, arms=2):
    """EQ-6, Moravec/Forward: arms * sqrt(pi) * x * exp(x^2) * erf(x). [Certain]"""
    x = (v_tip_kms / vc_kms) * math.sqrt(sf / (1.0 - derate))
    return arms * math.sqrt(math.pi) * x * math.exp(x * x) * math.erf(x)


def verify_canon(params):
    """Recompute rev_a.json's derived values from its own inputs. Returns rows of
    dict(quantity, computed, canon, ok, how)."""
    mu = params["orbital"]["mu_earth_m3s2"]
    alt = params["orbital"]["com_altitude_km"]
    R_file = params["orbital"]["com_radius_km"]
    L = params["geometry"]["tether_half_length_km"]
    sig = params["materials"]["tensile_strength_GPa"] * 1e9
    rho = params["materials"]["density_kgm3"]
    sf = params["materials"]["safety_factor"]
    vt = params["kinematics"]["v_tip_kms"]
    mr = params["mass_ratio"]["integrated_tether_to_payload_both_arms"]
    cis = params["kinematics"]["cislunar_revenue_gated_option"]
    p3 = params["kinematics"]["phase3_growth_option"]
    rows = []

    def row(q, computed, canon, how, nd=2):
        ok = rounds_to(f"{canon:.{nd}f}", computed) if canon is not None else None
        rows.append(dict(quantity=q, computed=round(computed, 4), canon=canon, ok=ok, how=how))

    vc = math.sqrt(2 * sig / rho) / 1e3
    row("V_c (km/s)", vc, params["materials"]["V_c_kms"], "sqrt(2 sigma / rho)")
    r_from_alt = R_EARTH_KM + alt
    row("CoM radius (km)", r_from_alt, R_file, f"R_E {R_EARTH_KM:g} + com_altitude_km", nd=0)
    v_orb_file = math.sqrt(mu / (R_file * 1e3)) / 1e3
    v_orb_alt = math.sqrt(mu / (r_from_alt * 1e3)) / 1e3
    row("v_orb from com_radius_km (km/s)", v_orb_file, params["orbital"]["v_orb_kms"], "sqrt(mu / com_radius_km)")
    row("v_orb from R_E + altitude (km/s)", v_orb_alt, params["orbital"]["v_orb_kms"], "sqrt(mu / (R_E + alt))")
    v_eq = 2 * math.pi * R_EARTH_KM / SIDEREAL_DAY_S
    for label, v_orb in (("com_radius_km", v_orb_file), ("R_E + alt", v_orb_alt)):
        row(f"v_upper_release via {label} (km/s)", v_orb + vt, params["kinematics"]["v_upper_release_kms"], "v_orb + v_tip")
        row(f"v_lower_tip_groundrel via {label} (km/s)", v_orb - vt - v_eq, params["kinematics"]["v_lower_tip_groundrel_kms"], "v_orb - v_tip - 0.465")
    row("tip_acceleration_g", (vt * 1e3) ** 2 / (L * 1e3) / G0, params["kinematics"]["tip_acceleration_g"], "v_tip^2 / L / g0")
    row("rotation_period_min", 2 * math.pi * L / vt / 60, params["geometry"]["rotation_period_min"], "2 pi L / v_tip", nd=1)
    r_tip = (R_EARTH_KM + alt + L) * 1e3
    for name, v, c3_key, apo_key in (("reference", vt, params["kinematics"]["c3_kms2"], params["kinematics"]["apogee_altitude_km"]),
                                     ("cislunar", cis["v_tip_kms"], cis["c3_kms2"], cis["apogee_altitude_km"]),
                                     ("phase3", p3["v_tip_kms"], p3["c3_kms2"], None)):
        vrel = (v_orb_alt + v) * 1e3
        row(f"C3 {name} (km^2/s^2)", (vrel ** 2 - 2 * mu / r_tip) / 1e6, c3_key, "v_rel^2 - 2 mu / r_tip at r_tip = R_E + alt + L")
        eps = vrel ** 2 / 2 - mu / r_tip
        if apo_key is not None and eps < 0:
            row(f"apogee {name} (km)", (-mu / eps - r_tip) / 1e3 - R_EARTH_KM, apo_key, "2a - r_tip - R_E with a = -mu / (2 eps)", nd=0)
    for v, d, key in ((vt, 0.0, "optimistic_0pct_derate"), (vt, 0.15, "baseline_15pct_derate"), (vt, 0.30, "conservative_30pct_derate"),
                      (cis["v_tip_kms"], 0.30, "cislunar_2p8kms_30pct_derate"), (p3["v_tip_kms"], 0.30, "phase3_3p5kms_30pct_derate")):
        m = integrated_mass_ratio(v, vc, sf, d)
        row(f"mass ratio {key} (x)", m, mr[key], "EQ-6 with the exact V_c from sigma, rho")
        fk = key.replace("_derate", "_fiber_mass_t")
        row(f"fiber mass {fk} (t)", m * mr["payload_mass_kg_for_tonnage"] / 1e3, mr[fk], "mass ratio x 5000 kg payload", nd=1)
    row("tip_speed_to_Vc_ratio", vt / vc, params["mass_ratio"]["tip_speed_to_Vc_ratio"], "v_tip / V_c")
    return rows


def render_verify(rows):
    out = ["| quantity | from inputs | canon | verdict | how |", "|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['quantity']} | {r['computed']:g} | {r['canon']} | {'matches' if r['ok'] else 'DISAGREES'} | {r['how']} |")
    bad = [r for r in rows if not r["ok"]]
    out.append("")
    out.append(f"{len(rows) - len(bad)} of {len(rows)} derived values reproduce from the file's own inputs"
               + (f"; {len(bad)} do not: " + "; ".join(r["quantity"] for r in bad) if bad else "."))
    return out


# ----------------------------------------------------------------- CLI ---

def rules_as_data():
    data = []
    for r in RULES:
        data.append(dict(id=r["id"], what=r["what"], keywords=r.get("kw", ""), unless=r.get("unless", ""),
                         unit=r.get("unit") or ("bare number" if r.get("bare") else "code"), keys=r.get("keys", []),
                         derived=(r["derived"] if isinstance(r.get("derived"), str) else [d[0] for d in r.get("derived", [])]),
                         code=r.get("code", ""), bare=r.get("bare", "")))
    data.append(dict(id="v35_unlabelled", what="3.5 km/s with no Phase-3 label", keywords="3.5 km/s | VTIP=3.5 | useState(3.5)",
                     unless="(self-labels)", unit="pattern", keys=["kinematics.v_tip_kms", "kinematics.phase3_growth_option.v_tip_kms"]))
    data.append(dict(id="x440_unlabelled", what="440x with no unsourced/historical label", keywords="440x", unless="(self-labels, error, flag, chased)",
                     unit="pattern", keys=[MR + "phase3_3p5kms_30pct_derate"]))
    data.append(dict(id="x100_200", what="the retired 100-200x planning range", keywords="100-200x", unless="(self-labels)", unit="pattern", keys=LADDER_KEYS[:3]))
    data.append(dict(id="ladder", what="Conservative/Baseline/Optimistic derate or retention rungs", keywords=LADDER_RE.pattern, unless="(self-labels)",
                     unit="pattern", keys=["materials.derate_fraction", "mass_ratio.*.NNpct_derate"]))
    data.append(dict(id="schema", what="parameter paths resolved against rev_a.json", keywords=CODE_PATH_RE.pattern, unless="", unit="path", keys=["(every key)"]))
    return dict(rules=data, sinks=SINKS, self_labels=SELF_LABELS, comparison_skip=COMPARISON_BEFORE.pattern,
                arithmetic_skip=ARITH_GAP.pattern, skip_files=sorted(SKIP_FILES), extensions=list(SCAN_EXT), max_tokens=MAX_TOKENS)


def write_page_data(dest, meta, findings, suppressed, params, flat, params_path, sha, verify_rows, report_md, allow):
    cards = {k: cite(params, flat, k, params_path, sha) for k in numeric_keys(flat)}
    units = {k: unit_hint(k) for k in numeric_keys(flat)}
    payload = dict(meta=meta, counts={c: sum(1 for f in findings if f["cls"] == c) for c in CLASSES},
                   findings=findings, suppressed=suppressed, verify=verify_rows,
                   rev_a=params, cards=cards, units=units, rules=rules_as_data(), deviations=allow)
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write("// Generated by lint_canon.py --emit-page-data; do not edit. The report, the canon snapshot,\n"
                 "// the quote cards and the rule table index.html renders, all from one run.\n")
        fh.write("window.RULE_ONE_DATA = " + json.dumps(payload, separators=(",", ":"), default=str, ensure_ascii=False) + ";\n")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lint_canon.py", description=__doc__.split("\n\n")[0],
                                 epilog="Exit 0: no NEW findings. 1: NEW findings. 2: usage or unreadable inputs.")
    ap.add_argument("checkout", nargs="?", help="directory to scan (a Skyhook checkout, or a fixture tree)")
    ap.add_argument("--params", help="path to rev_a.json (default <checkout>/params/rev_a.json)")
    ap.add_argument("--deviations", help="path to DEVIATIONS.md (default <checkout>/docs/DEVIATIONS.md; may be absent)")
    ap.add_argument("--format", choices=("md", "json"), default="md")
    ap.add_argument("--out", help="write the report here instead of stdout")
    ap.add_argument("--verbose", action="store_true", help="list the labelled pattern mentions that were skipped")
    ap.add_argument("--cite", metavar="KEY", help="print a quote card for a rev_a.json key and exit")
    ap.add_argument("--list-keys", action="store_true", help="list every numeric key with its value and unit hint")
    ap.add_argument("--verify-canon", action="store_true", help="recompute rev_a.json's derived values from its inputs")
    ap.add_argument("--rules", action="store_true", help="print the rule table as JSON and exit")
    ap.add_argument("--emit-page-data", metavar="FILE", help="also write a page-data.js (report + canon + cards) for index.html")
    ap.add_argument("--version", action="version", version=__version__)
    args = ap.parse_args(argv)

    if args.rules:
        print(json.dumps(rules_as_data(), indent=1))
        return 0
    params_path = args.params or (os.path.join(args.checkout, "params", "rev_a.json") if args.checkout else None)
    if not params_path or not os.path.exists(params_path):
        sys.stderr.write(f"lint_canon: cannot read the canon file {params_path or '(none given)'}; pass --params or a checkout with params/rev_a.json\n")
        return 2
    try:
        params, sha = load_params(params_path)
    except (OSError, ValueError) as e:
        sys.stderr.write(f"lint_canon: {params_path} is not readable JSON: {e}\n")
        return 2
    flat = flatten(params)

    if args.list_keys:
        for k, v in numeric_keys(flat).items():
            print(f"{k} = {v} {unit_hint(k)}".rstrip())
        return 0
    if args.cite:
        try:
            sys.stdout.write(cite(params, flat, args.cite, params_path, sha))
        except KeyError as e:
            sys.stderr.write(f"lint_canon: {e.args[0]}\n")
            return 2
        return 0
    verify_rows = verify_canon(params) if args.verify_canon else None
    if args.verify_canon and not args.checkout:
        print("\n".join(render_verify(verify_rows)))
        return 0
    if not args.checkout:
        ap.print_usage(sys.stderr)
        sys.stderr.write("lint_canon: give a checkout to scan, or --cite / --list-keys / --verify-canon / --rules\n")
        return 2
    if not os.path.isdir(args.checkout):
        sys.stderr.write(f"lint_canon: {args.checkout} is not a directory\n")
        return 2

    dev_path = args.deviations or os.path.join(args.checkout, "docs", "DEVIATIONS.md")
    allow = []
    if os.path.exists(dev_path):
        with open(dev_path, encoding="utf-8") as fh:
            allow = parse_deviations(fh.read())
    else:
        dev_path = ""
    suppressed, declared = [], []
    findings, nfiles = scan(args.checkout, params, flat, allow, suppressed, declared)
    meta = build_meta(args.checkout, params_path, params, sha, allow, nfiles, dev_path, declared)
    new = sum(1 for f in findings if f["cls"] == "NEW")

    md = render_md(meta, findings, suppressed, args.verbose, verify_rows)
    if args.format == "json":
        report = dict(meta=meta, counts={c: sum(1 for f in findings if f["cls"] == c) for c in CLASSES},
                      findings=findings, suppressed=suppressed, verify=verify_rows, exit=1 if new else 0)
        text = json.dumps(report, indent=1, default=str) + "\n"
    else:
        text = md
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    if args.emit_page_data:
        write_page_data(args.emit_page_data, meta, findings, suppressed, params, flat, params_path, sha,
                        verify_rows or verify_canon(params), md, allow)
    return 1 if new else 0


if __name__ == "__main__":
    sys.exit(main())
