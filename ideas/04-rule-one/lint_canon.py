#!/usr/bin/env python3
"""Rule One: a canon-drift scanner for the Skyhook repository.

Skyhook's Rule 1 says every tether number comes from params/rev_a.json, never
from memory. This script reads the prose, HTML, JSX, JS and Python of a checkout
and compares every number its rules attribute to a canonical quantity against
that file. It never edits anything; its only outputs are a report and a quote card.

    python3 lint_canon.py <checkout>                 Markdown report, exit 1 on NEW findings
    python3 lint_canon.py <checkout> --format json   the same report as JSON
    python3 lint_canon.py --cite kinematics.v_tip_kms --params params/rev_a.json
    python3 lint_canon.py --verify-canon --params params/rev_a.json
    python3 lint_canon.py --list-keys --params params/rev_a.json
    python3 lint_canon.py --rules                    the rule table as JSON
    python3 lint_canon.py <checkout> --label-coverage  how much Markdown a self-label would excuse

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
      ending in zeros is taken at the precision of its last non-zero digit
      within 3 % (85,200 km matches 85,222; 600 km does not match 640). A range
      (40-122x, 2.7-2.8 km/s) passes when it brackets a canonical value. A number
      preceded by a comparison sign (<=, >, below, at most ...) is a bound, not a
      claim; so is a number inside an arithmetic expression (v_orb + v_tip = 10.06).
      Each allowed value carries its tier (reference, cislunar option, Phase 3
      option, a derate rung, a market threshold, HASTOL heritage) from its key
      path: a number that is canon only for a tier its clause does not name is a
      "tier" finding (295x at "the 2.5 km/s reference"); a clause that names no
      tier is read as the reference.
  (b) stale patterns: "3.5 km/s" with no Phase-3 label in reach; "440x" with
      no unsourced/historical label; "100-200x" in any form; a Conservative /
      Baseline / Optimistic ladder whose derate or retention rungs are not the
      rev_a.json ladder.
  (c) schema drift: parameter paths in code (revA.a.b, PARAMS["a"]["b"],
      ["a", "b"] pairs) and dotted keys quoted in prose after "rev_a.json" are
      resolved against the JSON's keys; a path that does not exist is reported
      with the keys that do.

Every hit is classed from docs/DEVIATIONS.md, parsed by its table rows:
  ACCEPTED    the row's disposition STARTS with Leave (a deviation that states itself)
  KNOWN OPEN  the row is tracked but not marked EXECUTED
  NEW         not in the register, or in a row marked EXECUTED for that file (a regression)
  LABELLED    a quantity mismatch carrying a self-label: a STRONG marker (Phase 3,
              historical, superseded, unsourced, HASTOL, SF 5 ...) in the wide
              window (200 chars back, 120 forward, plus the Markdown heading), or a
              NEAR marker (corrected, earlier, wrong, sensitivity, _low ...) in the
              number's own clause. Common words (was, range, audit, option ...)
              never label a quantity. Shown, never fails.
A stale-pattern hit (3.5 km/s, 440x, 100-200x, ladder) with any self-label,
weak words included, is not a finding at all; it is counted and listed under
--verbose. A file that declares a non-rev_a parameter set (service_mxer_draft.json)
is scanned for patterns and schema only, and named in the report header.

Exit code: 0 no NEW findings; 1 NEW findings; 2 usage, unreadable inputs, or a
canon that lacks a key the rule table reads (the rule table then needs updating).

Confidence labels follow Skyhook's convention. [Certain] the arithmetic of the
rounding rule, the range rule, the key resolution and the self-check. [Likely] the
keyword windows, the tier words and the self-label vocabulary catch what a reader
would read as canon; all are heuristics and the README lists what they miss.
[Speculative] nothing here: the tool reports, it does not decide.
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

__version__ = "0.3.0"

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
    gap = gap.replace("**", " ").replace("__", " ")  # Markdown bold is emphasis, not an operator
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
    """(params, sha256 of the file's bytes as stored). The hash is taken over the
    bytes, not over decoded text, so a CRLF checkout prints its own sha256. [Certain]"""
    with open(path, "rb") as fh:
        raw = fh.read()
    return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()


def git_info(path):
    """HEAD, its date and dirtiness for the git checkout that path belongs to.
    A file must be tracked by that checkout (so a snapshot copied into another
    repository does not borrow that repository's commit). Returns {} otherwise."""
    is_dir = os.path.isdir(path)
    d = path if is_dir else os.path.dirname(os.path.abspath(path))
    try:
        # GIT_OPTIONAL_LOCKS=0: "git status" must not refresh (write) the checkout's index.
        env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
        run = lambda *a: subprocess.run(["git", "-C", d, *a], capture_output=True, text=True, timeout=20, env=env)
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

# Words that mark a number as knowingly non-canonical, in three strengths. [Likely]
# STRONG markers say outright that a number is not the current Rev A reference;
# they are read in the wide window (200 characters back, 120 forward, spilling into
# the neighbouring lines) and in the Markdown section heading.
STRONG_LABELS = [
    r"phase[ -]?[123]\b", r"by phase", r"lariat", r"pathfinder", r"growth option", r"hastol",
    r"historical", r"unsourced", r"superseded", r"retired", r"retracted", r"archival", r"pre-reconciliation",
    r"previously", r"formerly", r"no longer", r"purged", r"hypothetical",
    r"\bSF\s*[=≈~]?\s*[3-9]\b", r"safety factor\s*(?:of\s*)?[3-9]\b", r"\bmxer\b", r"\bdraft\b",
]
# NEAR markers count only in the number's own clause (". " or ";" ends one), at most
# 80 characters back and 60 forward, never from a heading or a neighbouring line:
# "Corrected from 3.9 GPa" marks the 3.9 as old, but a "Corrections" heading or a
# "CANON CORRECTION" banner says nothing about a number two sentences later.
NEAR_LABELS = [r"correct(?:ed|ion)", r"erratum", r"wrongly", r"\bwrong\b", r"earlier", r"\bold\b", r"stale", r"legacy",
               r"sensitivity", r"bracket", r"\bsweep\b", r"_low\b", r"_high\b", r"slider", r"illustrat", r"say,"]
# WEAK words are common in this repository's prose ("was", "range", "audit",
# "option", "supersedes" in the heading of a current section ...). They excuse a
# stale PATTERN hit (3.5 km/s, 440x, a ladder), as before, but never a quantity
# mismatch: a wrong number next to "was" stays NEW.
WEAK_LABELS = [r"supersedes", r"in-space", r"growth", r"\boption\b", r"\bmars\b", r"\bescape\b", r"threshold", r"\bwas\b",
               r"\bhad\b", r"removed", r"deviation", r"exhaust", r"\bIsp\b", r"conflat", r"mislabel", r"\bbug\b",
               r"before the fix", r"audit", r"derivation", r"memory", r"coincidence", r"\bvar(?:y|ies|ied)\b", r"perturb",
               r"convention", r"\brange\b", r"workbook", r"financial model"]
SELF_LABELS = STRONG_LABELS + NEAR_LABELS + WEAK_LABELS   # the stale-pattern vocabulary
SELF_LABEL_RE = re.compile("|".join(SELF_LABELS), re.I)
STRONG_LABEL_RE = re.compile("|".join(STRONG_LABELS), re.I)
NEAR_LABEL_RE = re.compile("|".join(NEAR_LABELS), re.I)
# A value of another tier is not excused by the tier's own name ("Phase 3", "growth option").
TIER_WORD_LABELS = (r"phase[ -]?[123]\b", r"by phase", r"growth option")
TIER_SAFE_LABEL_RE = re.compile("|".join(x for x in STRONG_LABELS if x not in TIER_WORD_LABELS), re.I)
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
         yields_to=["half_length"],  # "Each arm is 300 km long": the arm, not the whole tether
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
    dict(id="mass_ratio", what="integrated two-arm tether-to-payload mass ratio", kw=r"mass[\s-]*ratio|tether[\s-]*to[\s-]*payload|m_?tether|times (?:the )?payload|\bM/m\b|facility mass|tether\s*≈|tether mass\w*\s*[≈~=]|outweigh\w*|(?<=[×x] )payload\b|(?<=[×x])payload\b",
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

# Tiers. Each allowed value carries the tier its key path names (reference,
# cislunar_revenue_gated_option, phase3_growth_option, the NNpct_derate rungs, the
# market thresholds, HASTOL heritage). A number that rounds only to values of a tier
# its own clause does not name is a "tier" finding: 295x is right for the 2.8 km/s
# cislunar option and wrong for "the 2.5 km/s reference". [Likely]
TIER_WORDS = {
    "reference": re.compile(r"\breference\b", re.I),
    "cislunar": re.compile(r"cislunar|\bTLI\b|revenue[- ]gated", re.I),
    "phase3": re.compile(r"phase[ _-]?3(?![\d.])|growth option|\bmars\b", re.I),
}
RUNG_WORDS = {
    0: re.compile(r"optimistic|(?<![\d.])0\s*%|\bno derate|zero derate|un-?derated", re.I),
    15: re.compile(r"(?<!construction )\bbaseline\b(?! design| architecture| construction)|(?<![\d.])15\s*%", re.I),
    30: re.compile(r"conservative|(?<![\d.])30\s*%", re.I),
}
THRESHOLD_RE = re.compile(r"threshold|\breach\w*|\bescape\b|\bGTO\b|\bGEO\b|\bTLI\b|\bmars\b|\bC3\b|C₃|\bclass\b|\bneed\w*|\brequir\w*|minimum|lunar", re.I)
HERITAGE_RE = re.compile(r"hastol|boeing|tethers unlimited|heritage", re.I)
NEGATION_BEFORE = re.compile(r"\b(?:not|nor|no|non|never|isn't|aren't)\b(?:\W+(?:a|an|the))?\W{0,4}$", re.I)
CLAUSE_END = re.compile(r"(?<!\d)\.(?=[*_)\]\"”’]*(?:\s|$))|;")
TIER_NAMES = {"reference": "the reference", "cislunar": "the cislunar revenue-gated option",
              "phase3": "the Phase 3 growth option", "threshold": "a destination threshold", "heritage": "HASTOL heritage"}

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


def entry_tier(label):
    """(tier, rung) of an allowed value, read off its key path or derived label. [Certain for the reading]
    tier: reference | cislunar | phase3 | threshold | heritage | any; rung: the NNpct derate or None."""
    if "market_thresholds" in label:
        return "threshold", None
    if "HASTOL" in label:
        return "heritage", None
    m = re.search(r"(\d+)pct", label)
    rung = int(m.group(1)) if m else None
    if "cislunar" in label:
        return "cislunar", rung
    if "phase3" in label:
        return "phase3", rung
    if label.startswith(("kinematics.", MR)) or "inertial lower-tip" in label:
        return "reference", rung
    return "any", rung


def tip_speed_words(params):
    """Tier -> regex for its own tip speed written as a speed ("2.8 km/s"), from the canon.
    A speed inside a range (2.7-2.8 km/s) names nothing."""
    out = {}
    for tier, path in (("reference", ("kinematics", "v_tip_kms")),
                       ("cislunar", ("kinematics", "cislunar_revenue_gated_option", "v_tip_kms")),
                       ("phase3", ("kinematics", "phase3_growth_option", "v_tip_kms"))):
        v = params
        for k in path:
            v = v[k]
        out[tier] = re.compile(r"(?<![\d.–—\-])" + re.escape(f"{v:g}") + r"\s*km\s*/\s*s(?!\s*[–—\-]\s*\d)")
    return out


def _named(text, table):
    """Keys of table whose regex occurs in text, a negated mention ("not cislunar") excepted."""
    found = set()
    for name, rx in table.items():
        for m in rx.finditer(text):
            if not NEGATION_BEFORE.search(text[:m.start()]):
                found.add(name)
                break
    return found


def tier_context(line, s, e, heading, wide, speed_words):
    """What the number's clause says about tiers. The clause is the text between the
    nearest sentence ends (". " or ";") on the line, with the number itself
    left out; the Markdown heading is used only when the clause names no tier or rung.
    HASTOL heritage may be named anywhere on the line or in the wide window.
    Returns dict(tiers, rungs, threshold, heritage, source)."""
    a, b = _clause_bounds(line, s, e)
    text = line[a:s] + " | " + line[e:b]
    tiers = _named(text, TIER_WORDS) | _named(text, speed_words)
    rungs = _named(text, RUNG_WORDS)
    src = "clause"
    if not tiers and not rungs and heading:
        tiers = _named(heading, TIER_WORDS) | _named(heading, speed_words)
        rungs = _named(heading, RUNG_WORDS)
        src = "heading"
    return dict(tiers=tiers, rungs=rungs, threshold=bool(THRESHOLD_RE.search(text)),
                heritage=bool(HERITAGE_RE.search(line) or HERITAGE_RE.search(wide)), source=src)


def consistent(label, ctx):
    """True when an allowed value's tier fits what the clause names. A clause that names
    no tier is read as the reference, the design every unlabelled number in the
    repository is taken to describe (Rule 1); a destination threshold needs
    threshold words in the clause, a heritage figure needs HASTOL on the line."""
    tier, rung = entry_tier(label)
    if tier == "threshold":
        return ctx["threshold"]
    if tier == "heritage":
        return ctx["heritage"]
    if tier in TIER_WORDS and tier not in (ctx["tiers"] or {"reference"}):
        return False
    if rung is not None and ctx["rungs"] and rung not in ctx["rungs"]:
        return False
    return True


def _excerpt(line, start, end, width=100, limit=220):
    """The line, or for a long line the part centred on [start, end] with ellipses. [Certain]"""
    body = line.strip()
    if len(body) <= limit:
        return body
    lo = len(line) - len(line.lstrip())
    hi = len(line.rstrip())
    a, b = max(lo, start - width), min(hi, end + width)
    return ("…" if a > lo else "") + line[a:b].strip() + ("…" if b < hi else "")


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


def quantity_label_at(lines, heads, idx, start, end, strong=STRONG_LABEL_RE):
    """The label that makes a quantity mismatch LABELLED, or None: a strong marker in
    the wide window or heading, or a near marker in the number's own clause within 80
    characters back and 60 forward. Weak words never count here. [Likely]"""
    m = strong.search(_wide(lines, idx, start, end, heads[idx]))
    if m:
        return m.group(0)
    a, b = _clause_bounds(lines[idx], start, end)
    m = NEAR_LABEL_RE.search(lines[idx][max(a, start - 80):min(b, end + 60)])
    return m.group(0) if m else None


def _clause_bounds(line, s, e):
    """[a, b) of the clause around [s, e): between the nearest ". " or ";" on each side."""
    a = 0
    for m in CLAUSE_END.finditer(line[:s]):
        a = m.end()
    m = CLAUSE_END.search(line, e)
    return a, (m.start() if m else len(line))


def label_coverage(root):
    """How much of the Markdown a label would excuse: of the lines that carry a number
    (in files the quantity rules run on), how many would turn a mismatch at their
    first number into LABELLED, under the quantity rules' labels and under the full
    pattern vocabulary. [Certain for the count]"""
    lines_with_number = by_quantity = by_pattern = 0
    for full, rel in iter_files(root):
        if not rel.endswith(".md"):
            continue
        with open(full, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().split("\n")
        if OTHER_PARAMS_RE.search("\n".join(lines[:60])):
            continue  # declares the draft in-space set: no quantity rules run there
        heads = _headings(lines, rel)
        for idx, line in enumerate(lines):
            m = NUM_RE.search(line)
            if not m:
                continue
            lines_with_number += 1
            by_quantity += bool(quantity_label_at(lines, heads, idx, m.start(), m.end()))
            by_pattern += bool(SELF_LABEL_RE.search(_wide(lines, idx, m.start(), m.end(), heads[idx])))
    return dict(lines_with_number=lines_with_number, quantity_labelled=by_quantity, pattern_labelled=by_pattern)


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
    best, best_state = None, None
    for row in allow:
        rps = [rp for rp in row["paths"] if p == rp or p.endswith("/" + rp) or rp.endswith("/" + p)]
        if not rps:
            continue
        st = row.get("path_states", {}).get(rps[0], row["state"])
        if row["snippets"]:
            if any(s in line_text for s in row["snippets"]):
                best, best_state = row, st
                break
            continue
        by_value = any(abs(v - fv) < 1e-9 for v in row["values"] for fv in values)
        by_line = any(abs(f.get("line", 0) - l) <= 3 for l in row["lines"])
        if by_value:
            best, best_state = row, st
            break
        if by_line and not values and best is None:
            best, best_state = row, st
    if best is None:
        return "NEW", None
    if best_state == "accepted":
        return "ACCEPTED", best
    if best_state == "open":
        return "KNOWN OPEN", best
    f["note"] = (f.get("note", "") + f" Regression: DEVIATIONS #{best['no']} is marked EXECUTED for this file.").strip()
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
    speed_words = tip_speed_words(params)
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
                 canon=canon, note=note, text=lines[idx][start:end], context=_excerpt(lines[idx], start, end), heading=heads[idx])
        f["cls"], f["deviation"] = classify(f, allow, lines[idx])
        if labelled and f["cls"] == "NEW":
            f["cls"] = "LABELLED"
            f["label"] = labelled
            f["note"] = re.sub(r"\s*Regression: DEVIATIONS #\d+ is marked EXECUTED for this file\.", "", f["note"]).strip()
        findings.append(f)

    def suppressed(idx, start, end, rule, found, label):
        key = (idx, start, end)
        if key in seen:
            return
        seen.add(key)
        verbose_bucket.append(dict(path=path, line=idx + 1, rule=rule, found=found, label=label,
                                   context=_excerpt(lines[idx], start, end, 70, 160)))

    def self_label(idx, start, end, regex=SELF_LABEL_RE):
        m = regex.search(_wide(lines, idx, start, end, heads[idx]))
        return m.group(0) if m else None

    def quantity_label(idx, start, end, strong=STRONG_LABEL_RE):
        return quantity_label_at(lines, heads, idx, start, end, strong)

    def pattern_hit(idx, s, e, rule, what, found, canon, found_values, note, label_re):
        """A stale-pattern hit: a label suppresses it unless DEVIATIONS tracks it as Leave/open."""
        lab = self_label(idx, s, e, label_re)
        probe = dict(path=path, line=idx + 1, found_values=found_values)
        cls, dev = classify(probe, allow, lines[idx])
        if lab and cls == "NEW":
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
                _evaluate(cand, idx, line, lines, heads, path, params, flat, ladder, add, quantity_label, speed_words)

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
    Returns (rule or 'sink' or None, keyword text, gap text).

    Three keywords do not count: one that is an operand ("v_orb - v_tip"); one
    inside a parenthetical that closes before the number ("(tip-speed convention)
    to ~3.0 km/s"); and one after the number that is itself followed by a number
    ("At 2.5 km/s, v_release = 10.06", "2.5 km/s reference: release 10.06": the
    keyword names the 10.06). A rule with
    yields_to gives way to those rules' keywords within reach ("Each arm is 300 km
    long" is an arm length, not the total)."""
    s, ue = cand["s"], cand["unit_end"]
    lo, hi = max(0, s - 100), min(len(line), ue + 80)
    found = []  # (distance, before/after, unit mismatch, order, owner, kw, gap)
    for order, (owner, regex) in enumerate([(r, r["kw"]) for r in RULES if r.get("kw")] + [("sink", SINK_RE.pattern)]):
        # "Zylon" names both a strength and a density: at equal distance the rule stated in the number's unit wins.
        mismatch = 0 if owner == "sink" or owner.get("unit") == cand.get("unit") else 1
        for m in re.finditer(regex, line, re.I):
            if m.end() <= s and m.start() >= lo:
                if OPERATOR_ADJACENT.search(line[lo:m.start()]):
                    continue  # "v_orb - v_tip": the keyword is an operand, not a label
                gap = line[m.end():s]
                if gap.count(")") > gap.count("("):
                    continue  # the keyword sits in a parenthetical that closed before the number
                found.append((_tokens_between(gap), 0, mismatch, order, owner, m.group(0), gap))
            elif m.start() >= ue and m.end() <= hi:
                if re.match(r"\s*[+−×*/^\-]", line[m.end():]):
                    continue
                if re.match(r"[\s*_]*[=≈:]?[\s*_]*[~≈]?\s*[-−]?\d", line[m.end():]):
                    continue  # "v_release = 10.06", "release 10.06": it claims the number after it, not the one before
                gap = line[ue:m.start()]
                found.append((_tokens_between(gap), 1, mismatch, order, owner, m.group(0), gap))
    found = [t for t in found if t[0] <= MAX_TOKENS]
    if not found:
        return None, "", ""
    best = min(found, key=lambda t: t[:4])
    if best[4] != "sink" and best[4].get("yields_to"):
        give = [t for t in found if t[4] != "sink" and t[4]["id"] in best[4]["yields_to"]]
        if give:
            best = min(give, key=lambda t: t[:4])
    return best[4], best[5], best[6]


def _evaluate(cand, idx, line, lines, heads, path, params, flat, ladder, add, quantity_label, speed_words):
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
    matched = []
    for scale in scales:
        values = [_num_value(l) * scale for l in lits]
        if rule.get("fraction_only") and any(v > 1.0 + 1e-9 or v < 0 for v in values):
            if scale == scales[-1]:
                return  # not a fraction or a percentage: not a derate claim
            continue
        if rule.get("skip_values") and any(abs(v - sv) < 1e-9 for v in values for sv in rule["skip_values"]):
            return
        if len(lits) == 2:
            matched = [(k, v) for k, v in allowed if range_brackets(lits[0], lits[1], v, scale, md)]
        else:
            matched = [(k, v) for k, v in allowed if rounds_to(lits[0], v, scale, md)]
        if matched:
            break
    scale = scales[0]
    shown = ("–".join(lits) if len(lits) == 2 else lits[0]) + (f" {cand['unit']}" if cand.get("unit") else "")
    if scale not in (1.0,) and len(lits) == 1:
        shown = f"{lits[0]} (= {_num_value(lits[0]) * scale:g})"
    found_values = [_num_value(l) for l in lits]
    ctx = tier_context(line, s, e, heads[idx], _wide(lines, idx, s, e, heads[idx]), speed_words)
    fits = [(k, v) for k, v in allowed if consistent(k, ctx)]
    if matched:
        if any(consistent(k, ctx) for k, _ in matched):
            return
        # The number is canon, but for a tier, rung or context its clause does not name.
        names = [TIER_NAMES[t] for t in sorted(ctx["tiers"])] + [f"the {r} % derate rung" for r in sorted(ctx["rungs"])]
        theirs = "; ".join(f"{k} = {v:g} ({TIER_NAMES.get(entry_tier(k)[0], entry_tier(k)[0])})" for k, v in matched)
        tiered = any(entry_tier(k)[0] in TIER_WORDS for k, _ in matched)
        if tiered:
            said = (f"its {ctx['source']} names {' and '.join(names)}" if names
                    else "its clause names no tier, so it reads as the reference")
            note = (f"{shown} is {theirs}, but {said}"
                    + (f"; the value there is {', '.join(f'{v:g}' for _, v in fits)}." if fits else "; rev_a.json has no value for this quantity there."))
            canon = [dict(key=k, value=v) for k, v in (fits or matched)]
            add(idx, s, e, "tier", f"{rule['what']}: the value of another tier", shown, canon, found_values, note,
                labelled=quantity_label(idx, s, e, TIER_SAFE_LABEL_RE))
            return
        note = f"{shown} rounds only to {theirs}, which nothing in its clause refers to."
        canon = [dict(key=k, value=v) for k, v in (fits or allowed)]
        add(idx, s, e, rule["id"], rule["what"], shown, canon, found_values, note, labelled=quantity_label(idx, s, e))
        return
    canon = [dict(key=k, value=v) for k, v in allowed]
    add(idx, s, e, rule["id"], rule["what"], shown, canon, found_values, "", labelled=quantity_label(idx, s, e))


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
        path_states, leave_first, executed = disposition_states(disp, sorted(paths))
        states = set(path_states.values())
        state = states.pop() if len(states) == 1 else "mixed"
        rows.append(dict(no=no, paths=sorted(paths), values=nums, lines=sorted(set(line_refs)), snippets=snippets, state=state,
                         path_states=path_states, leave_first=leave_first, executed=executed,
                         shows=shows[:200], disposition=disp[:160]))
    return rows


_GENERIC_PATH_TOKENS = {"md", "html", "jsx", "js", "mjs", "py", "yml", "yaml", "json", "skyhook", "docs", "tools", "sims", "github", "workflows"}


def _path_tokens(path):
    """Distinctive words of a file's name: skyhook_program_site.html -> {program, site}."""
    base = path.replace("\\", "/").split("/")[-1]
    return {t.lower() for t in re.split(r"[_.\-]+", base) if len(t) >= 4 and t.lower() not in _GENERIC_PATH_TOKENS}


def disposition_states(disp, paths):
    """Per-file state of a register row from its disposition cell. [Likely]

    A row is Leave only when its recommendation STARTS with Leave ("**Leave.**",
    "**Leave content as-is; ...**"); an un-chosen alternative later in the cell
    ("Change default to 2.5, or leave untouched if Hudson prefers") is not a
    Leave. A row that does not start with Leave is fixed when it says EXECUTED,
    else open. A Leave-first row whose later clauses name one of its files (by a
    distinctive word of the file name, quoted text and parentheticals ignored)
    is split: that file takes the action's state (fixed if EXECUTED, else open)
    and the rest stay Leave. Row 7 ("Leave archival copies; when the site is
    next edited, update its equation legend ... EXECUTED") is therefore Leave for
    docs/original_README.md and fixed for skyhook_program_site.html.
    Returns (path -> 'accepted' | 'fixed' | 'open', leave_first, executed)."""
    text = re.sub(r"[*_`]+", "", disp).strip()
    executed = "EXECUTED" in text
    recommendation = re.split(r"[—–-]*\s*EXECUTED", text, maxsplit=1)[0].strip()
    leave_first = bool(re.match(r"leave\b", recommendation, re.I))
    action_state = "fixed" if executed else "open"
    if not leave_first:
        return {p: action_state for p in paths}, False, executed
    parts = re.split(r"[;.]\s+", recommendation, maxsplit=1)
    later = parts[1] if len(parts) > 1 else ""
    later = re.sub(r"\"[^\"]*\"|“[^”]*”|\([^)]*\)", " ", later).lower()
    words = set(re.findall(r"[a-z]+", later))
    return {p: (action_state if _path_tokens(p) & words else "accepted") for p in paths}, True, executed


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
        deviations_executed=[r["no"] for r in allow if r.get("executed")],
        deviations_leave_first=[r["no"] for r in allow if r.get("leave_first")],
        deviations_neither=[r["no"] for r in allow if not r.get("executed") and not r.get("leave_first")],
        deviations_states={s: sum(1 for r in allow for st in r.get("path_states", {}).values() if st == s) for s in ("accepted", "open", "fixed")},
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
    nos = lambda xs: ", ".join(f"#{n}" for n in xs) or "none"
    if meta["deviations_rows"]:
        out.append(f"Allow-list: {meta['deviations_path']} ({meta['deviations_rows']} rows; marked EXECUTED: {nos(meta['deviations_executed'])}; "
                   f"disposition starts with Leave: {nos(meta['deviations_leave_first'])}; neither: {nos(meta['deviations_neither'])}. "
                   f"Read per file as {ds.get('accepted', 0)} Leave, {ds.get('fixed', 0)} fixed, {ds.get('open', 0)} open.)")
    else:
        out.append(f"Allow-list: {meta['deviations_path'] or 'none'} (0 rows).")
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
              "ACCEPTED": "the DEVIATIONS.md row starts with Leave for this file: a deviation that states itself",
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

R_EARTH_KM = 6371.0           # mean radius, as physics/skyhook_physics.py:40 and the notes' r_tip = R_E + 610 + 320 = 7301 km [Certain]
SIDEREAL_DAY_S = 86164.0905   # IERS; gives the 0.465 km/s equatorial speed the notes use [Certain]
G0 = 9.80665                  # standard gravity [Certain]
GEO_ALTITUDE_KM = 35786.0     # geostationary altitude: the apogee a GTO throw must reach [Certain]
LUNAR_DISTANCE_KM = 384400.0  # mean Earth-Moon distance: the apogee radius a TLI-class throw must reach [Certain]

OPT_CIS = "kinematics.cislunar_revenue_gated_option."
OPT_P3 = "kinematics.phase3_growth_option."
# Every numeric key of rev_a.json is one of three things; test_lint.py checks that
# these lists and DERIVED_KEYS cover the file exactly, so a new key cannot go unchecked.
INPUT_KEYS = [
    "orbital.com_altitude_km", "orbital.mu_earth_m3s2", "geometry.tether_half_length_km",
    "kinematics.v_tip_kms", OPT_CIS + "v_tip_kms", OPT_P3 + "v_tip_kms",
    "materials.tensile_strength_GPa", "materials.density_kgm3", "materials.safety_factor", "materials.derate_fraction",
    MR + "payload_mass_kg_for_tonnage",
]
SOURCED_KEYS = [  # stated, not derivable from the file: measurements, prices, heritage, finance-model outputs
    "materials.alternative_fibers.Dyneema_SK99_GPa", "materials.alternative_fibers.T1100G_carbon_GPa",
    "economics.launch_price_anchor_dedicated_kgs", "economics.launch_price_rideshare_kgs",
    "economics.spacex_internal_marginal_kgs", "economics.phase0_capex_M",
    "heritage.SEDS_1_2_km", "heritage.TSS1R_km", "heritage.YES2_km", "heritage.TEPCE_year", "heritage.HASTOL_mass_ratio_at_SF3",
    OPT_CIS + "construction_launch_break_even_for_500_per_kg_customer_price",
    OPT_CIS + "customer_price_break_even_at_800_per_kg_construction_launch_Y15",
]
MARS_KEY = "market_thresholds.mars_class_C3_8_to_13_tip_speed_kms"
DERIVED_KEYS = [
    "materials.V_c_kms", "materials.specific_strength_MJkg", "orbital.com_radius_km", "orbital.v_orb_kms",
    "geometry.tip_altitude_lower_km", "geometry.rotation_period_min",
    "kinematics.v_upper_release_kms", "kinematics.v_lower_tip_groundrel_kms", "kinematics.tip_acceleration_g",
    "kinematics.c3_kms2", "kinematics.apogee_altitude_km",
    OPT_CIS + "v_upper_release_kms", OPT_CIS + "tip_acceleration_g", OPT_CIS + "c3_kms2", OPT_CIS + "apogee_altitude_km",
    OPT_CIS + "integrated_mass_ratio_30pct_derate_both_arms", OPT_CIS + "fiber_mass_t_at_5000kg_payload",
    OPT_P3 + "v_upper_release_kms", OPT_P3 + "v_lower_tip_groundrel_kms", OPT_P3 + "tip_acceleration_g", OPT_P3 + "c3_kms2",
    OPT_P3 + "integrated_mass_ratio_30pct_derate_both_arms", OPT_P3 + "fiber_mass_t_at_5000kg_payload",
    MR + "SF", MR + "reference_v_tip_kms",
] + [k for rung in ("optimistic_0pct", "baseline_15pct", "conservative_30pct", "cislunar_2p8kms_30pct", "phase3_3p5kms_30pct")
     for k in (MR + rung + "_derate", MR + rung + "_fiber_mass_t")] + [
    "mass_ratio.tip_speed_to_Vc_ratio",
    "market_thresholds.GTO_tip_speed_kms", "market_thresholds.cislunar_TLI_tip_speed_kms",
    "market_thresholds.escape_C3_0_tip_speed_kms", MARS_KEY + "[0]", MARS_KEY + "[1]", "market_thresholds.mars_escape_tip_speed_kms",
]


def integrated_mass_ratio(v_tip_kms, vc_kms, sf, derate, arms=2):
    """EQ-6, Moravec/Forward: arms * sqrt(pi) * x * exp(x^2) * erf(x). [Certain]"""
    x = (v_tip_kms / vc_kms) * math.sqrt(sf / (1.0 - derate))
    return arms * math.sqrt(math.pi) * x * math.exp(x * x) * math.erf(x)


def get_path(params, dotted):
    """Value at a dotted path with [i] list indices; KeyError naming the path when absent."""
    node = params
    for seg in dotted.split("."):
        m = re.match(r"^([^\[]+)(?:\[(\d+)\])?$", seg)
        try:
            node = node[m.group(1)]
            if m.group(2) is not None:
                node = node[int(m.group(2))]
        except (KeyError, IndexError, TypeError):
            raise KeyError(dotted) from None
    return node


def derived_values(params, r_earth_km):
    """rev_a.json key -> (value, how) for every derived value, at one Earth radius. [Certain for the formulas]
    The CoM radius is R_E + com_altitude_km and the upper-tip radius R_E + alt + L,
    as the file's notes state them; derate rungs and tip speeds are read off the keys."""
    g = lambda k: get_path(params, k)
    mu, alt, L = g("orbital.mu_earth_m3s2"), g("orbital.com_altitude_km"), g("geometry.tether_half_length_km")
    sig, rho, sf = g("materials.tensile_strength_GPa") * 1e9, g("materials.density_kgm3"), g("materials.safety_factor")
    payload = g(MR + "payload_mass_kg_for_tonnage")
    R = (r_earth_km + alt) * 1e3
    r_tip = R + L * 1e3
    v_orb = math.sqrt(mu / R) / 1e3
    v_eq = 2 * math.pi * r_earth_km / SIDEREAL_DAY_S
    vc = math.sqrt(2 * sig / rho) / 1e3
    tips = {"kinematics.": g("kinematics.v_tip_kms"), OPT_CIS: g(OPT_CIS + "v_tip_kms"), OPT_P3: g(OPT_P3 + "v_tip_kms")}
    out = {
        "materials.V_c_kms": (vc, "sqrt(2 sigma / rho)"),
        "materials.specific_strength_MJkg": (sig / rho / 1e6, "sigma / rho"),
        "orbital.com_radius_km": (R / 1e3, "R_E + com_altitude_km"),
        "orbital.v_orb_kms": (v_orb, "sqrt(mu / (R_E + alt))"),
        "geometry.tip_altitude_lower_km": (alt - L, "com_altitude_km - L"),
        "geometry.rotation_period_min": (2 * math.pi * L / tips["kinematics."] / 60, "2 pi L / v_tip"),
        MR + "SF": (sf, "= materials.safety_factor"),
        MR + "reference_v_tip_kms": (tips["kinematics."], "= kinematics.v_tip_kms"),
        "mass_ratio.tip_speed_to_Vc_ratio": (tips["kinematics."] / vc, "v_tip / V_c"),
    }
    for prefix, v in tips.items():
        vrel = (v_orb + v) * 1e3
        c3 = (vrel ** 2 - 2 * mu / r_tip) / 1e6
        out[prefix + "v_upper_release_kms"] = (v_orb + v, "v_orb + v_tip")
        out[prefix + "v_lower_tip_groundrel_kms"] = (v_orb - v - v_eq, "v_orb - v_tip - 2 pi R_E / sidereal day")
        out[prefix + "tip_acceleration_g"] = ((v * 1e3) ** 2 / (L * 1e3) / G0, "v_tip^2 / L / g0")
        out[prefix + "c3_kms2"] = (c3, "v_rel^2 - 2 mu / r_tip, v_rel = v_orb + v_tip, r_tip = R_E + alt + L")
        if c3 < 0:
            a = -mu / (c3 * 1e6)
            out[prefix + "apogee_altitude_km"] = ((2 * a - r_tip) / 1e3 - r_earth_km, "2a - r_tip - R_E, a = -mu / C3")
        else:  # an escape throw has no apogee: a stated one cannot follow from the inputs
            out[prefix + "apogee_altitude_km"] = (None, "none: C3 >= 0, the throw escapes")
    for k in [k for k in DERIVED_KEYS if k.startswith(MR) and k.endswith("_derate")] + \
             [OPT_CIS + "integrated_mass_ratio_30pct_derate_both_arms", OPT_P3 + "integrated_mass_ratio_30pct_derate_both_arms"]:
        v = tips[OPT_CIS] if "cislunar" in k else tips[OPT_P3] if "phase3" in k else tips["kinematics."]
        d = int(re.search(r"(\d+)pct", k).group(1)) / 100.0
        m = integrated_mass_ratio(v, vc, sf, d)
        out[k] = (m, "EQ-6 with the exact V_c from sigma, rho")
        fk = k.replace("_derate", "_fiber_mass_t") if k.startswith(MR) else k.replace(
            "integrated_mass_ratio_30pct_derate_both_arms", "fiber_mass_t_at_5000kg_payload")
        out[fk] = (m * payload / 1e3, "mass ratio x payload_mass_kg_for_tonnage")
    speed_for_c3 = lambda c3: math.sqrt(c3 * 1e6 + 2 * mu / r_tip) / 1e3 - v_orb
    speed_for_apogee = lambda ra: math.sqrt(2 * mu * ra / (r_tip * (r_tip + ra))) / 1e3 - v_orb
    lo, hi = (float(x) for x in re.search(r"C3_(\d+)_to_(\d+)", MARS_KEY).groups())
    out["market_thresholds.GTO_tip_speed_kms"] = (speed_for_apogee((r_earth_km + GEO_ALTITUDE_KM) * 1e3),
                                                  f"tip speed whose release apogee is GEO altitude {GEO_ALTITUDE_KM:,.0f} km")
    out["market_thresholds.cislunar_TLI_tip_speed_kms"] = (speed_for_apogee(LUNAR_DISTANCE_KM * 1e3),
                                                           f"tip speed whose apogee radius is the mean lunar distance {LUNAR_DISTANCE_KM:,.0f} km")
    out["market_thresholds.escape_C3_0_tip_speed_kms"] = (speed_for_c3(0.0), "tip speed for C3 = 0")
    out[MARS_KEY + "[0]"] = (speed_for_c3(lo), f"tip speed for C3 = {lo:g} (from the key name)")
    out[MARS_KEY + "[1]"] = (speed_for_c3(hi), f"tip speed for C3 = {hi:g} (from the key name)")
    out["market_thresholds.mars_escape_tip_speed_kms"] = (speed_for_c3(hi), f"tip speed for C3 = {hi:g}, the top of the Mars-class range")
    return out


def agrees(canon, computed):
    """A value written to d decimals agrees when it is the computed value rounded to d decimals. [Certain]"""
    if computed is None:
        return False
    d = _decimals_of(canon)
    return abs(computed - canon) <= 0.5 * 10 ** (-d) + 1e-9


def verify_canon(params):
    """Recompute every derived value in rev_a.json from the file's own inputs, under
    two Earth radii: R_E = 6371 km (the notes' r_tip = 7301 km, physics/skyhook_physics.py:40)
    and the R_E that com_radius_km implies (com_radius_km - com_altitude_km). Returns
    dict(rows, r_earth_km, r_earth_implied_km, inputs, sourced, constants)."""
    r_implied = get_path(params, "orbital.com_radius_km") - get_path(params, "orbital.com_altitude_km")
    a, b = derived_values(params, R_EARTH_KM), derived_values(params, r_implied)
    rows = []
    for key in DERIVED_KEYS:
        canon = get_path(params, key)
        (va, how), (vb, _) = a[key], b[key]
        rnd = lambda x: None if x is None else round(x, 4)
        rows.append(dict(key=key, canon=canon, how=how, computed=rnd(va), ok=agrees(canon, va),
                         computed_alt=rnd(vb), ok_alt=agrees(canon, vb),
                         radius_dependent=(va is None) != (vb is None) or (va is not None and abs(va - vb) > 1e-9)))
    return dict(rows=rows, r_earth_km=R_EARTH_KM, r_earth_implied_km=r_implied, inputs=INPUT_KEYS, sourced=SOURCED_KEYS,
                constants=dict(R_E_km=R_EARTH_KM, sidereal_day_s=SIDEREAL_DAY_S, g0_ms2=G0,
                               geo_altitude_km=GEO_ALTITUDE_KM, lunar_distance_km=LUNAR_DISTANCE_KM))


def verify_summary(v):
    """The self-check's conclusion in words, from the rows. [Certain]"""
    rows, n = v["rows"], len(v["rows"])
    bad_a = [r["key"] for r in rows if not r["ok"]]
    bad_b = [r["key"] for r in rows if not r["ok_alt"]]
    def one(label, bad):
        return f"{label}: {n - len(bad)} of {n} reproduce" + (f"; {len(bad)} do not: {', '.join(bad)}." if bad else ".")
    out = [one(f"Under R_E = {v['r_earth_km']:g} km (r_tip = R_E + alt + L as the file's notes state it; physics/skyhook_physics.py:40)", bad_a),
           one(f"Under R_E = {v['r_earth_implied_km']:g} km (implied by orbital.com_radius_km - com_altitude_km)", bad_b)]
    if bad_a and bad_b:
        out.append("No single Earth radius reproduces every derived value: the file mixes two.")
    out.append(f"Not derived: {len(v['inputs'])} inputs and {len(v['sourced'])} stated values the file cannot derive "
               f"(alternative fibres, prices, capex, heritage, two finance-model break-evens), listed as INPUT_KEYS and "
               f"SOURCED_KEYS in lint_canon.py. Constants not in the file: R_E {R_EARTH_KM:g} km, "
               f"sidereal day {SIDEREAL_DAY_S} s, g0 {G0} m/s^2, GEO altitude {GEO_ALTITUDE_KM:,.0f} km, "
               f"mean lunar distance {LUNAR_DISTANCE_KM:,.0f} km.")
    return out


def render_verify(v):
    a, b = f"{v['r_earth_km']:g}", f"{v['r_earth_implied_km']:g}"
    out = [f"| rev_a.json key | canon | at R_E {a} | verdict | at R_E {b} | verdict | how |", "|---|---|---|---|---|---|---|"]
    for r in v["rows"]:
        show = lambda x: "none" if x is None else f"{x:g}"
        out.append(f"| {r['key']} | {r['canon']} | {show(r['computed'])} | {'matches' if r['ok'] else 'DISAGREES'} | "
                   f"{show(r['computed_alt'])} | {'matches' if r['ok_alt'] else 'DISAGREES'} | {r['how']} |")
    out.append("")
    out.extend(verify_summary(v))
    return out


# ------------------------------------------------- required canon keys ---

def required_keys():
    """Every rev_a.json path this tool reads: the rule table's keys, the derived-value
    and pattern keys, the self-check's inputs and derived values. A canon that lacks
    one is refused (exit 2) rather than half-checked. [Certain for the list]"""
    keys = set(INPUT_KEYS) | set(DERIVED_KEYS) | set(LADDER_KEYS) | set(FIBER_KEYS) | set(TIP_KEYS)
    for r in RULES:
        keys |= set(r.get("keys", []))
    keys |= {"orbital.v_orb_kms", "kinematics.v_upper_release_kms", "geometry.tether_half_length_km"}  # the derived lambdas
    return sorted(keys)


def missing_keys(params):
    out = []
    for k in required_keys():
        try:
            v = get_path(params, k)
        except KeyError:
            out.append(k)
            continue
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            out.append(k)
    if not out and not isinstance(get_path(params, MR.rstrip(".")), dict):
        out.append(MR.rstrip("."))
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
    data.append(dict(id="tier", what="a canonical value of a tier, rung or context its clause does not name", keywords="(any quantity rule)",
                     unless="(strong markers other than tier names; near markers)", unit="(the rule's)",
                     keys=["tier words: " + " | ".join(f"{t}: {rx.pattern}" for t, rx in TIER_WORDS.items()),
                           "rung words: " + " | ".join(f"{r} %: {rx.pattern}" for r, rx in RUNG_WORDS.items()),
                           "threshold words: " + THRESHOLD_RE.pattern, "heritage words: " + HERITAGE_RE.pattern]))
    return dict(rules=data, sinks=SINKS, self_labels=dict(strong=STRONG_LABELS, near=NEAR_LABELS, weak_patterns_only=WEAK_LABELS),
                comparison_skip=COMPARISON_BEFORE.pattern, arithmetic_skip=ARITH_GAP.pattern, skip_files=sorted(SKIP_FILES),
                extensions=list(SCAN_EXT), max_tokens=MAX_TOKENS, required_keys=required_keys())


def write_page_data(dest, meta, findings, suppressed, params, flat, params_path, sha, verify_rows, report_md, allow):
    """page-data.js for index.html: the run as the page shows it. To stay small, the quote
    cards are stored once as a table of distinct lines plus, per key, [key, unit, indices of
    its lines] (the page joins them with newlines; card_text() below is the same join), and
    fields the page does not show (headings, parsed values, the skipped mentions' excerpts)
    are left out. The JSON report (--format json) keeps everything."""
    lines, where, cards = [], {}, []
    for k in numeric_keys(flat):
        idx = []
        for ln in cite(params, flat, k, params_path, sha).rstrip("\n").split("\n"):
            if ln not in where:
                where[ln] = len(lines)
                lines.append(ln)
            idx.append(where[ln])
        cards.append([k, unit_hint(k), idx])
    # The page prints the first canonical value with its key and only the values of the rest.
    slim = [dict({k: v for k, v in f.items() if k not in ("heading", "found_values", "deviation", "canon")},
                 canon=f["canon"][:1] + [{"value": c["value"]} for c in f["canon"][1:]],
                 deviation=({"no": f["deviation"]["no"]} if f.get("deviation") else None)) for f in findings]
    rules = rules_as_data()
    rules.pop("required_keys", None)
    rules["rules"] = [{k: v for k, v in r.items() if k not in ("code", "unless")} for r in rules["rules"]]
    payload = dict(meta=meta, counts={c: sum(1 for f in findings if f["cls"] == c) for c in CLASSES},
                   findings=slim, suppressed=[{k: v for k, v in x.items() if k != "context"} for x in suppressed],
                   verify=dict(verify_rows, summary=verify_summary(verify_rows)),
                   rev_a=params, card_lines=lines, cards=cards, rules=rules,
                   deviations=[{k: v for k, v in r.items() if k not in ("shows", "disposition")} for r in allow])
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write("// Generated by lint_canon.py --emit-page-data; do not edit. The report, the canon snapshot,\n"
                 "// the quote cards and the rule table index.html renders, all from one run.\n")
        fh.write("window.RULE_ONE_DATA = " + json.dumps(payload, separators=(",", ":"), default=str, ensure_ascii=False) + ";\n")


def card_text(data, key):
    """A quote card back from page-data's line table: the card's lines joined by newlines."""
    idx = next(c[2] for c in data["cards"] if c[0] == key)
    return "\n".join(data["card_lines"][i] for i in idx) + "\n"


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
    ap.add_argument("--label-coverage", action="store_true",
                    help="count the Markdown lines whose first number a self-label would excuse, and exit")
    ap.add_argument("--emit-page-data", metavar="FILE", help="also write a page-data.js (report + canon + cards) for index.html")
    ap.add_argument("--version", action="version", version=__version__)
    args = ap.parse_args(argv)

    if args.rules:
        print(json.dumps(rules_as_data(), indent=1))
        return 0
    if args.label_coverage:
        if not args.checkout or not os.path.isdir(args.checkout):
            sys.stderr.write("lint_canon: --label-coverage needs a checkout directory\n")
            return 2
        c = label_coverage(args.checkout)
        n = c["lines_with_number"] or 1
        print(f"{c['lines_with_number']} Markdown lines carry a number. A mismatch at the first number would be LABELLED on "
              f"{c['quantity_labelled']} of them ({100 * c['quantity_labelled'] / n:.0f} %) under the quantity rules' labels "
              f"(strong markers, near markers in the number's clause), and on {c['pattern_labelled']} ({100 * c['pattern_labelled'] / n:.0f} %) "
              f"under the full pattern vocabulary.")
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
    # The rule table and the self-check read these paths; a canon without one is refused, not half-checked.
    missing = missing_keys(params)
    if missing:
        sys.stderr.write(f"lint_canon: {params_path} lacks {', '.join(missing)}; the rule table needs updating "
                         f"before this canon can be checked\n")
        return 2
    try:
        verify_rows = verify_canon(params) if (args.verify_canon or args.emit_page_data) else None
    except (ValueError, ZeroDivisionError, OverflowError) as e:
        sys.stderr.write(f"lint_canon: the self-check cannot evaluate {params_path} ({e}); a value is out of its physical range\n")
        return 2
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

    # An explicitly named register must be readable: a typo must not silently turn
    # every ACCEPTED and KNOWN OPEN finding into NEW. Only the default path may be absent.
    dev_path = args.deviations or os.path.join(args.checkout, "docs", "DEVIATIONS.md")
    allow = []
    if args.deviations or os.path.exists(dev_path):
        try:
            with open(dev_path, encoding="utf-8") as fh:
                allow = parse_deviations(fh.read())
        except (OSError, UnicodeDecodeError) as e:
            sys.stderr.write(f"lint_canon: cannot read the deviations register {dev_path}: {e}\n")
            return 2
    else:
        dev_path = ""
    suppressed, declared = [], []
    findings, nfiles = scan(args.checkout, params, flat, allow, suppressed, declared)
    meta = build_meta(args.checkout, params_path, params, sha, allow, nfiles, dev_path, declared)
    new = sum(1 for f in findings if f["cls"] == "NEW")

    md = render_md(meta, findings, suppressed, args.verbose, verify_rows if args.verify_canon else None)
    if args.format == "json":
        report = dict(meta=meta, counts={c: sum(1 for f in findings if f["cls"] == c) for c in CLASSES},
                      findings=findings, suppressed=suppressed, verify=verify_rows if args.verify_canon else None, exit=1 if new else 0)
        text = json.dumps(report, indent=1, default=str) + "\n"
    else:
        text = md
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    if args.emit_page_data:
        write_page_data(args.emit_page_data, meta, findings, suppressed, params, flat, params_path, sha, verify_rows, md, allow)
    return 1 if new else 0


if __name__ == "__main__":
    sys.exit(main())
