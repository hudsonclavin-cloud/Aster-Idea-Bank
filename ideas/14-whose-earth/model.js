// model.js — the arithmetic of "Whose Earth": reading a constant's literal, building an Earth from the
// concordance rows, recomputing every Earth-dependent number in Skyhook's params/rev_a.json under that
// Earth, the K2 interface quantities, Aster's own injection Δv, and four accountings of reboost energy.
// Pure: no DOM, no clock, no file access. Loads as a classic script (window.WhoseEarth) and with require().
// Two-body arithmetic at idea-bank fidelity; every formula names the source equation it mirrors.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhoseEarth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- literals and units
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

  // "398_600.4418", "6,378,137", "6371e3", "3.986e14", "3.986 × 10¹⁴", "398600000000000.0" -> a number.
  function parseLiteral(lit) {
    if (typeof lit !== 'string' || !lit.trim()) return NaN;
    const s = lit.trim();
    const sci = s.match(/^(\d+(?:\.\d+)?)\s*[×x]\s*10\^?([⁰¹²³⁴⁵⁶⁷⁸⁹⁻\d-]+)$/);
    if (sci) return Number(`${sci[1]}e${sci[2].split('').map((c) => SUP[c] || c).join('')}`);
    const plain = s.replace(/[_,]/g, '');
    if (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(plain)) return NaN;
    return Number(plain);
  }

  // Canonical units: mu km³/s², R km, g0 m/s², rotation km/s, energy MJ/kg (mechanical), elec kWh/kg (electrical).
  // Division for SI-to-km so 3.986004418e14 / 1e9 is the correctly rounded 398600.4418.
  const UNITS = {
    km3s2: { family: 'mu', label: 'km³/s²' },
    m3s2: { family: 'mu', div: 1e9, label: 'm³/s²' },
    km: { family: 'R', label: 'km' },
    m: { family: 'R', div: 1e3, label: 'm' },
    ms2: { family: 'g0', label: 'm/s²' },
    kms: { family: 'rot', label: 'km/s' },
    ms: { family: 'rot', div: 1e3, label: 'm/s' },
    mPerUT1s: { family: 'rot', div: 1e3, label: 'm of equator per s of UT1 error' },
    MJkg: { family: 'energy', label: 'MJ/kg' },
    kWhkg: { family: 'energy', mul: 3.6, label: 'kWh/kg (mechanical)' },
    kWhkgE: { family: 'elec', label: 'kWh/kg (electrical)' },
  };
  const CANON_UNIT = { mu: 'km³/s²', R: 'km', g0: 'm/s²', rot: 'km/s', energy: 'MJ/kg', elec: 'kWh/kg' };

  function toCanonical(x, unit) {
    const u = UNITS[unit];
    if (!u || !Number.isFinite(x)) return NaN;
    if (u.div) return x / u.div;
    if (u.mul) return x * u.mul;
    return x;
  }

  function refusal(code, reason, whatWouldHelp) {
    return { refused: true, code, reason, what_would_help: whatWouldHelp };
  }

  // The value a concordance row states, in canonical units. Implied radii are turned into an Earth radius:
  //   implied-parking: parking radius − the paired parking altitude (Aster delta-v.ts:4 with main.ts:981)
  //   implied-com:     CoM radius − rev_a.json orbital.com_altitude_km
  //   implied-tip:     upper-tip radius − com_altitude_km − geometry.tether_half_length_km
  function rowValue(row, byId, canon) {
    if (row.literal == null) return null;
    const v = toCanonical(parseLiteral(row.literal), row.unit);
    if (!Number.isFinite(v)) return NaN;
    if (row.kind === 'implied-parking') {
      const alt = byId[row.pair];
      if (!alt) return NaN;
      return v - toCanonical(parseLiteral(alt.literal), alt.unit);
    }
    if (row.kind === 'implied-com') return canon ? v - canon.orbital.com_altitude_km : NaN;
    if (row.kind === 'implied-tip') return canon ? v - canon.orbital.com_altitude_km - canon.geometry.tether_half_length_km : NaN;
    return v;
  }

  // An Earth from a set definition and the rows; a missing constant is null and the quantities that need it refuse.
  function earthFromSet(set, byId, canon) {
    const pick = (key) => {
      const id = set[key];
      if (!id) return { value: null, row: null };
      const row = byId[id];
      return { value: row ? rowValue(row, byId, canon) : NaN, row: row || null };
    };
    const mu = pick('mu');
    const R = pick('R');
    const g0 = pick('g0');
    const vRot = pick('vRot');
    return {
      id: set.id,
      label: set.label,
      mu: mu.value,
      R: R.value,
      g0: g0.value,
      vRot: vRot.value,
      sources: { mu: mu.row, R: R.row, g0: g0.row, vRot: vRot.row },
    };
  }

  function validEarth(earth) {
    const bad = [];
    if (!(earth.mu > 0)) bad.push('mu');
    if (!(earth.R > 0)) bad.push('R');
    if (!(earth.g0 > 0)) bad.push('g0');
    return bad;
  }

  // ---------------------------------------------------------------- rounding
  function decimalsOf(printed) {
    const s = String(printed);
    if (/e/i.test(s)) return 0;
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
  }

  // Does `computed` round to `printed` at the printed number's own decimals?
  function reproduces(computed, printed) {
    if (!Number.isFinite(computed) || !Number.isFinite(printed)) return false;
    const d = decimalsOf(printed);
    return Math.abs(computed - printed) <= 0.5 * Math.pow(10, -d) + 1e-9 * Math.max(1, Math.abs(printed));
  }

  // ---------------------------------------------------------------- Skyhook physics (mirrors physics/skyhook_physics.py)
  // erf by the all-positive series erf(x) = 2/√π · e^(−x²) · Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1)); no cancellation,
  // so it holds full double precision for the x ≈ 1–2.5 of the Rev A ladder (Python's math.erf is the cross-check).
  function erf(x) {
    if (!Number.isFinite(x)) return x > 0 ? 1 : x < 0 ? -1 : NaN;
    if (x < 0) return -erf(-x);
    if (x > 6) return 1;
    let term = x;
    let sum = x;
    const x2 = 2 * x * x;
    for (let n = 1; n < 500; n++) {
      term *= x2 / (2 * n + 1);
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    return (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
  }

  // EQ-4: V_c = sqrt(2σ/ρ), σ in GPa, ρ in kg/m³ -> km/s (skyhook_physics.py:182-194)
  const characteristicVelocityKms = (sigmaGPa, rho) => Math.sqrt((2 * sigmaGPa * 1e9) / rho) / 1e3;

  // EQ-6: M/m = arms·√π·x·e^(x²)·erf(x), x = (V_t/V_c)·√(SF/(1−derate)) (skyhook_physics.py:219-241, Moravec/Forward)
  function massRatio(vTip, Vc, SF, derate, arms) {
    if (!(derate >= 0 && derate < 1)) return NaN;
    const x = (vTip / Vc) * Math.sqrt(SF / (1 - derate));
    return (arms == null ? 2 : arms) * Math.sqrt(Math.PI) * x * Math.exp(x * x) * erf(x);
  }

  // EQ-2 and the Rev A geometry, all in km and km/s.
  function geometry(canon, earth) {
    const h = canon.orbital.com_altitude_km;
    const L = canon.geometry.tether_half_length_km;
    const rCom = earth.R + h;
    return { h, L, rCom, rTip: rCom + L, rLow: rCom - L, vOrb: Math.sqrt(earth.mu / rCom) };
  }

  // EQ-3b and EQ-7 (skyhook_physics.py:113-166): release at the upper-tip radius.
  function release(canon, earth, vTip) {
    const g = geometry(canon, earth);
    const vRel = g.vOrb + vTip;
    const c3 = vRel * vRel - (2 * earth.mu) / g.rTip;
    const apogee = c3 < 0 ? 2 * (-earth.mu / c3) - g.rTip - earth.R : null;
    return { vRel, c3, apogee, g };
  }

  // The tip speed that releases at a given C3 from the same radius (market_thresholds).
  function tipSpeedForC3(canon, earth, c3) {
    const g = geometry(canon, earth);
    return Math.sqrt(c3 + (2 * earth.mu) / g.rTip) - g.vOrb;
  }

  // ---------------------------------------------------------------- the canon, recomputed
  const TIER_DEFS = [
    { id: 'reference', label: 'reference 2.5 km/s', path: 'kinematics' },
    { id: 'cislunar', label: 'cislunar 2.8 km/s', path: 'kinematics.cislunar_revenue_gated_option' },
    { id: 'phase3', label: 'Phase 3 3.5 km/s', path: 'kinematics.phase3_growth_option' },
  ];

  function get(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function tiers(canon) {
    return TIER_DEFS.map((t) => {
      const block = get(canon, t.path);
      return Object.assign({}, t, { block, vTip: block && block.v_tip_kms });
    });
  }

  // Every number in rev_a.json that follows from its own inputs, recomputed under `earth`.
  // depends lists the Earth constants the number needs; [] means no Earth can change it.
  function deriveCanon(canon, earth) {
    const out = [];
    const bad = validEarth(earth);
    const g = bad.length ? null : geometry(canon, earth);
    function add(path, label, unit, depends, fn, extra) {
      const printed = get(canon, path);
      let value = null;
      let refused = null;
      const missing = depends.filter((k) => earth[k] == null || !Number.isFinite(earth[k]));
      if (missing.length) {
        const NAMES = { mu: 'gravitational parameter', R: 'Earth radius', g0: 'standard gravity', vRot: 'Earth rotation rate' };
        refused = refusal('insufficient_data', `${earth.label} states no ${missing.map((k) => NAMES[k] || k).join(', ')}`,
          missing.includes('vRot')
            ? 'an Earth rotation rate on the Aster side (Slice 21 Planets & Sites plans one: strategy/ASTER_ROADMAP_2026-08.md:283-285), or a K2 decision to import Skyhook\'s'
            : 'the missing constant, cited to a file and line');
      } else {
        value = fn();
      }
      out.push(Object.assign({ path, label, unit, depends, printed: printed === undefined ? null : printed, value, refused,
        reproduces: refused || printed == null || typeof printed !== 'number' ? null : reproduces(value, printed) }, extra || {}));
    }
    const m = canon.materials;
    const Vc = characteristicVelocityKms(m.tensile_strength_GPa, m.density_kgm3);
    add('orbital.com_radius_km', 'CoM orbit radius', 'km', ['R'], () => g.rCom);
    add('orbital.v_orb_kms', 'CoM orbital speed v_orb', 'km/s', ['mu', 'R'], () => g.vOrb);
    add('geometry.tip_altitude_lower_km', 'lower-tip altitude', 'km', [], () => canon.orbital.com_altitude_km - canon.geometry.tether_half_length_km);
    add('geometry.rotation_period_min', 'rotation period', 'min', [], () => (2 * Math.PI * canon.geometry.tether_half_length_km) / canon.kinematics.v_tip_kms / 60);
    for (const t of tiers(canon)) {
      const p = t.path;
      add(`${p}.v_upper_release_kms`, `${t.label}: release speed`, 'km/s', ['mu', 'R'], () => release(canon, earth, t.vTip).vRel, { tier: t.id });
      add(`${p}.c3_kms2`, `${t.label}: release C3`, 'km²/s²', ['mu', 'R'], () => release(canon, earth, t.vTip).c3, { tier: t.id });
      if (t.block.apogee_altitude_km !== undefined) {
        add(`${p}.apogee_altitude_km`, `${t.label}: apogee altitude`, 'km', ['mu', 'R'], () => release(canon, earth, t.vTip).apogee, { tier: t.id });
      }
      if (t.block.v_lower_tip_groundrel_kms !== undefined) {
        add(`${p}.v_lower_tip_groundrel_kms`, `${t.label}: lower tip, ground-relative`, 'km/s', ['mu', 'R', 'vRot'],
          () => g.vOrb - t.vTip - earth.vRot, { tier: t.id });
      }
      add(`${p}.tip_acceleration_g`, `${t.label}: tip acceleration`, 'g', ['g0'],
        () => ((t.vTip * 1e3) ** 2) / (canon.geometry.tether_half_length_km * 1e3) / earth.g0, { tier: t.id });
    }
    add('materials.V_c_kms', 'characteristic velocity V_c', 'km/s', [], () => Vc);
    add('materials.specific_strength_MJkg', 'specific strength σ/ρ', 'MJ/kg', [], () => (m.tensile_strength_GPa * 1e9) / m.density_kgm3 / 1e6);
    add('mass_ratio.tip_speed_to_Vc_ratio', 'v_tip / V_c', '', [], () => canon.kinematics.v_tip_kms / Vc);
    const block = canon.mass_ratio.integrated_tether_to_payload_both_arms;
    const SF = block.SF;
    const payloadT = block.payload_mass_kg_for_tonnage / 1000;
    for (const key of Object.keys(block)) {
      const mm = key.match(/^(.*?)(?:_(\d)p(\d)kms)?_(\d+)pct_derate$/);
      if (!mm) continue;
      const vTip = mm[2] ? Number(`${mm[2]}.${mm[3]}`) : block.reference_v_tip_kms;
      const derate = Number(mm[4]) / 100;
      const ratio = () => massRatio(vTip, Vc, SF, derate, 2);
      add(`mass_ratio.integrated_tether_to_payload_both_arms.${key}`, `EQ-6 ${vTip} km/s, ${mm[4]}% derate`, '×', [], ratio, { vTip, derate });
      const fk = key.replace(/_derate$/, '_fiber_mass_t');
      if (block[fk] !== undefined) {
        add(`mass_ratio.integrated_tether_to_payload_both_arms.${fk}`, `fiber mass at ${block.payload_mass_kg_for_tonnage} kg payload, ${vTip} km/s, ${mm[4]}%`, 't', [],
          () => ratio() * payloadT, { vTip, derate });
      }
    }
    for (const t of tiers(canon)) {
      if (t.block.integrated_mass_ratio_30pct_derate_both_arms !== undefined) {
        add(`${t.path}.integrated_mass_ratio_30pct_derate_both_arms`, `${t.label}: EQ-6 at 30% derate`, '×', [], () => massRatio(t.vTip, Vc, SF, 0.3, 2));
        add(`${t.path}.fiber_mass_t_at_5000kg_payload`, `${t.label}: fiber mass at 5000 kg`, 't', [], () => massRatio(t.vTip, Vc, SF, 0.3, 2) * 5);
      }
    }
    add('market_thresholds.escape_C3_0_tip_speed_kms', 'tip speed for C3 = 0', 'km/s', ['mu', 'R'], () => tipSpeedForC3(canon, earth, 0));
    const marsKey = Object.keys(canon.market_thresholds).find((k) => /^mars_class_C3_(\d+)_to_(\d+)_tip_speed_kms$/.test(k));
    if (marsKey) {
      const [, lo, hi] = marsKey.match(/^mars_class_C3_(\d+)_to_(\d+)_tip_speed_kms$/);
      const printed = canon.market_thresholds[marsKey];
      [Number(lo), Number(hi)].forEach((c3, i) => {
        const path = `market_thresholds.${marsKey}.${i}`;
        out.push({ path, label: `tip speed for C3 = ${c3}`, unit: 'km/s', depends: ['mu', 'R'], printed: printed[i],
          value: bad.length ? null : tipSpeedForC3(canon, earth, c3), refused: null,
          reproduces: bad.length ? null : reproduces(tipSpeedForC3(canon, earth, c3), printed[i]) });
      });
    }
    for (const key of ['GTO_tip_speed_kms', 'cislunar_TLI_tip_speed_kms']) {
      if (canon.market_thresholds[key] === undefined) continue;
      out.push({ path: `market_thresholds.${key}`, label: key === 'GTO_tip_speed_kms' ? 'tip speed for a GEO apogee' : 'tip speed for a lunar-distance apogee',
        unit: 'km/s', depends: ['mu', 'R', 'target'], printed: canon.market_thresholds[key], value: null, reproduces: null,
        refused: refusal('insufficient_data', 'needs a target apogee radius rev_a.json does not state',
          'a GEO radius and a lunar distance in params/rev_a.json (the only GEO radius in Skyhook is finance/reboost_bound.py:28, flagged)') });
    }
    return out;
  }

  // ---------------------------------------------------------------- K2: what the Earth choice does at the interface
  // C3 shift from Earth A to Earth B for one tip speed, split four ways:
  //   both       recompute everything with B (each program consistent with itself)
  //   muOnly     B's mu, A's radius
  //   rOnly      B's radius, A's mu
  //   mixed      v_orb from A but r_tip from B: what you get by mixing one program's speed with the other's radius
  function c3Shift(canon, A, B, vTip) {
    const base = release(canon, A, vTip).c3;
    const both = release(canon, B, vTip).c3 - base;
    const muOnly = release(canon, Object.assign({}, A, { mu: B.mu }), vTip).c3 - base;
    const rOnly = release(canon, Object.assign({}, A, { R: B.R }), vTip).c3 - base;
    const gA = geometry(canon, A);
    const gB = geometry(canon, B);
    const vRelA = gA.vOrb + vTip;
    const mixed = vRelA * vRelA - (2 * A.mu) / gB.rTip - base;
    return { base, both, muOnly, rOnly, mixed };
  }

  function apogeeOf(mu, R, rTip, c3) {
    return c3 < 0 ? 2 * (-mu / c3) - rTip - R : null;
  }

  // Tip Match (idea 01): speed of a parabolic arrival at r_tip minus the tip's speed. Trim at v∞ = 0.
  function trimAtParabolic(canon, earth, vTip) {
    const g = geometry(canon, earth);
    return Math.sqrt((2 * earth.mu) / g.rTip) - (g.vOrb + vTip);
  }

  // Aster's injection from C3 (src/v2/porkchop/delta-v.ts:18-26), ported for comparison, not modified.
  function injectionDvFromC3(c3, mu, parkingRadiusKm) {
    const vCirc = Math.sqrt(mu / parkingRadiusKm);
    const vHyp = Math.sqrt(c3 + (2 * mu) / parkingRadiusKm);
    return vHyp - vCirc;
  }

  function interfaceEffects(canon, A, B, parkingAltitudeKm) {
    return tiers(canon).map((t) => {
      const s = c3Shift(canon, A, B, t.vTip);
      const gA = geometry(canon, A);
      const gB = geometry(canon, B);
      const c3A = s.base;
      const c3B = s.base + s.both;
      const c3Mixed = s.base + s.mixed;
      const rParkB = B.R + parkingAltitudeKm;
      const rParkA = A.R + parkingAltitudeKm;
      return {
        tier: t.id,
        label: t.label,
        vTip: t.vTip,
        c3: { A: c3A, B: c3B, mixed: c3Mixed, shift: s },
        apogee: { A: apogeeOf(A.mu, A.R, gA.rTip, c3A), B: apogeeOf(B.mu, B.R, gB.rTip, c3B), mixed: apogeeOf(A.mu, A.R, gB.rTip, c3Mixed) },
        vInfStar: { A: c3A > 0 ? Math.sqrt(c3A) : null, B: c3B > 0 ? Math.sqrt(c3B) : null },
        trim0: { A: trimAtParabolic(canon, A, t.vTip), B: trimAtParabolic(canon, B, t.vTip) },
        // Aster's injection Δv to the same C3 from its 200 km parking orbit, on each Earth
        injection: {
          AonA: injectionDvFromC3(c3A, A.mu, rParkA),
          BonB: injectionDvFromC3(c3B, B.mu, rParkB),
          AonB: injectionDvFromC3(c3A, B.mu, rParkB),
        },
      };
    });
  }

  // ---------------------------------------------------------------- reboost energy per kilogram thrown
  // In Skyhook's own kinematics (EQ-3 without Earth rotation) the payload is caught at r_low moving v_orb − v_tip
  // and released at r_tip moving v_orb + v_tip. Energies in km²/s² = MJ/kg.
  //   momentum   2·v_orb·v_tip: the finance model's line (finance/skyhook_finance.py:211-215)
  //   orbital    the payload's specific orbital energy gain ½(v_rel² − v_catch²) + μ(1/r_low − 1/r_tip), which is what
  //              the facility loses (energy is conserved through the hold); finance/reboost_bound.py:118-120 books the
  //              in-space fork this way
  //   angular    n·ΔH, mean motion times the payload's angular-momentum gain r_tip·v_rel − r_low·v_catch: the energy a
  //              circular orbit gives up when it loses that angular momentum (a cross-check of `orbital`)
  //   groundRel  `orbital` with the ground-relative catch speed (v_orb − v_tip − v_rot): a frame mix-up, shown because
  //              it is the nearest principled candidate to MP-001's 44.8
  function reboost(canon, earth, vTip) {
    const g = geometry(canon, earth);
    const vRel = g.vOrb + vTip;
    const vCatch = g.vOrb - vTip;
    const momentum = 2 * g.vOrb * vTip;
    const kinetic = 0.5 * (vRel * vRel - vCatch * vCatch);
    const potential = earth.mu * (1 / g.rLow - 1 / g.rTip);
    const orbital = kinetic + potential;
    const angular = (g.vOrb / g.rCom) * (g.rTip * vRel - g.rLow * vCatch);
    const groundRel = earth.vRot == null ? null : 0.5 * (vRel * vRel - (vCatch - earth.vRot) ** 2) + potential;
    return { vTip, momentum, kinetic, potential, orbital, angular, groundRel };
  }

  // A sweep for MP-001's 44.8 MJ/kg: every combination of the readings a careful person might take from the canon.
  // radius ∈ the given radii; v_orb computed or the printed 7.55; release v_orb+v_tip or the printed 10.06; catch inertial,
  // ground-relative or the printed 4.59; potential term none, two-body μ(1/r_low − 1/r_tip), g0·2L, or μ/r_com²·2L.
  function reboostSweep(canon, opts) {
    const { radii, mu, g0, vRot, target } = opts;
    const k = canon.kinematics;
    const vTip = k.v_tip_kms;
    const L = canon.geometry.tether_half_length_km;
    const h = canon.orbital.com_altitude_km;
    const out = [];
    for (const R of radii) {
      const rCom = R + h;
      const rTip = rCom + L;
      const rLow = rCom - L;
      for (const [vOrbName, vOrb] of [['v_orb computed', Math.sqrt(mu / rCom)], ['v_orb printed', canon.orbital.v_orb_kms]]) {
        for (const [relName, vRel] of [['release v_orb+v_tip', vOrb + vTip], ['release printed', k.v_upper_release_kms]]) {
          for (const [catchName, vC] of [['catch inertial', vOrb - vTip], ['catch ground-relative', vOrb - vTip - vRot], ['catch printed', k.v_lower_tip_groundrel_kms]]) {
            for (const [peName, pe] of [['no potential term', 0], ['two-body potential', mu * (1 / rLow - 1 / rTip)], ['g0·Δh', (g0 / 1000) * 2 * L], ['g(r_com)·Δh', (mu / (rCom * rCom)) * 2 * L]]) {
              const e = 0.5 * (vRel * vRel - vC * vC) + pe;
              out.push({ R, vOrbName, relName, catchName, peName, value: e, distance: Math.abs(e - target) });
            }
          }
        }
      }
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  // Skyhook's decision grid prices reboost electricity as E/η/3.6·($/kWh) (finance/skyhook_finance.py:216).
  // Given the workbook's η and price per column, reproduce the grid's published reboost_electricity_per_kg.
  function reboostDollarsPerKg(energyMJkg, eta, pricePerKWh) {
    return (energyMJkg / eta / 3.6) * pricePerKWh;
  }

  // ---------------------------------------------------------------- concordance grouping
  // Groups rows of one family by the value they state (implied radii resolved), with the relative difference
  // to a reference value. Parking altitudes and formulas are not values of the family and are left out.
  function groupFamily(rows, family, byId, canon, refValue) {
    const groups = new Map();
    for (const r of rows) {
      if (r.family !== family && !(family === 'energy' && r.family === 'elec')) continue;
      if (r.kind === 'parking-altitude' || r.kind === 'formula' || r.literal == null) continue;
      const v = rowValue(r, byId, canon);
      const key = `${r.family}|${Number.isFinite(v) ? Number(v.toPrecision(10)) : 'NaN'}`;
      if (!groups.has(key)) groups.set(key, { family: r.family, value: v, rows: [] });
      groups.get(key).rows.push(r);
    }
    return [...groups.values()]
      .map((g) => Object.assign(g, { rel: g.family === family && refValue ? (g.value - refValue) / refValue : null }))
      .sort((a, b) => (a.family === b.family ? b.value - a.value : a.family < b.family ? -1 : 1));
  }

  // ---------------------------------------------------------------- Aster's own published injection values
  // Parsed from the verified line text of the registry rows, so the pins are Aster's words, not retyped numbers.
  function asterPins(rows) {
    const pins = [];
    for (const r of rows) {
      if (!r.text) continue;
      const where = `${r.path}:${r.line}`;
      let m;
      const zero = r.text.match(/C3=0 injection.*?Δv = (\d+\.\d+) km\/s/);
      if (zero) pins.push({ c3: 0, dv: Number(zero[1]), printed: zero[1], where });
      const re = /C3=(\d+(?:\.\d+)?) → (\d+\.\d+) km\/s/g;
      while ((m = re.exec(r.text))) pins.push({ c3: Number(m[1]), dv: Number(m[2]), printed: m[2], where });
      const smoke = r.text.match(/pinned C3=(\d+(?:\.\d+)?) → injection (\d+\.\d+)/);
      if (smoke) pins.push({ c3: Number(smoke[1]), dv: Number(smoke[2]), printed: smoke[2], where });
    }
    return pins;
  }

  // ---------------------------------------------------------------- the decision grid, reconciled
  const GRID_TIER = { reference: 'reference', cislunar_revenue_gated_option: 'cislunar', phase3_growth_option: 'phase3' };

  function checkGrid(canon, earths, workbook, grid) {
    if (!workbook || !grid) return { refused: refusal('not_found', 'no workbook or grid excerpt', 'run build-data.mjs against a Skyhook checkout') };
    const cols = workbook.columns;
    const col = (name, row) => workbook.rows[row].values[cols.indexOf(name)];
    const tierV = Object.fromEntries(tiers(canon).map((t) => [t.id, t.vTip]));
    const m = canon.materials;
    const Vc = characteristicVelocityKms(m.tensile_strength_GPa, m.density_kgm3);
    const SF = canon.mass_ratio.integrated_tether_to_payload_both_arms.SF;
    const points = grid.points.map((p) => {
      const tier = GRID_TIER[p.tier];
      const vTip = tierV[tier];
      const derate = 1 - col(p.column, workbook.retentionRow);
      const eta = col(p.column, workbook.etaRow);
      const price = col(p.column, workbook.priceRow);
      const ratio = massRatio(vTip, Vc, SF, derate, 2);
      const per = {};
      for (const e of earths) {
        const r = reboost(canon, e, vTip);
        per[e.id] = {
          momentum: reboostDollarsPerKg(r.momentum, eta, price),
          orbital: reboostDollarsPerKg(r.orbital, eta, price),
        };
      }
      return { tier, column: p.column, vTip, derate, eta, price, published: p, massRatio: ratio,
        massRatioReproduces: reproduces(ratio, p.mass_ratio_x), dollars: per };
    });
    // reboost_electricity_per_kg / v_tip is the same for every tier in a column iff the line is linear in v_tip
    const byColumn = {};
    for (const p of points) (byColumn[p.column] ||= []).push(p.published.reboost_electricity_per_kg / p.vTip);
    const proportionality = Object.fromEntries(Object.entries(byColumn).map(([c, v]) => [c, { min: Math.min(...v), max: Math.max(...v), spread: (Math.max(...v) - Math.min(...v)) / Math.min(...v) }]));
    return { points, proportionality };
  }

  // ---------------------------------------------------------------- everything, from the inputs
  function analyze(inputs) {
    const { canon, rows, sets, workbook, grid, expected } = inputs;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const earths = sets.map((s) => earthFromSet(s, byId, canon));
    const S = earths.find((e) => e.id === 'skyhook');
    const A = earths.find((e) => e.id === 'aster');
    const canonTables = Object.fromEntries(earths.map((e) => [e.id, deriveCanon(canon, e)]));
    const parkRow = A && A.sources.R && A.sources.R.pair ? byId[A.sources.R.pair] : null;
    const parkingAltitudeKm = parkRow ? toCanonical(parseLiteral(parkRow.literal), parkRow.unit) : null;
    const iface = S && A && parkingAltitudeKm != null ? interfaceEffects(canon, S, A, parkingAltitudeKm) : null;
    const reboostRows = tiers(canon).map((t) => ({ tier: t.id, label: t.label, vTip: t.vTip,
      byEarth: Object.fromEntries(earths.filter((e) => !validEarth(e).length).map((e) => [e.id, reboost(canon, e, t.vTip)])) }));
    const mpRow = expected && byId[expected.mp001EnergyRow];
    const target = mpRow ? rowValue(mpRow, byId, canon) : null;
    const radii = [...new Set(earths.map((e) => e.R).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);
    const sweep = S && Number.isFinite(target) ? reboostSweep(canon, { radii, mu: S.mu, g0: S.g0, vRot: S.vRot, target }) : [];
    const gridCheck = checkGrid(canon, earths, workbook, grid);
    const refReboost = reboostRows[0] && S ? reboostRows[0].byEarth.skyhook : null;
    const groups = {
      mu: groupFamily(rows, 'mu', byId, canon, S && S.mu),
      R: groupFamily(rows, 'R', byId, canon, S && S.R),
      g0: groupFamily(rows, 'g0', byId, canon, S && S.g0),
      rot: groupFamily(rows, 'rot', byId, canon, S && S.vRot),
      energy: groupFamily(rows, 'energy', byId, canon, refReboost && refReboost.momentum),
    };
    const pins = asterPins(expected ? rows.filter((r) => expected.asterPinRows.includes(r.id)) : []).map((p) => {
      const dvAster = A && parkingAltitudeKm != null ? injectionDvFromC3(p.c3, A.mu, A.R + parkingAltitudeKm) : null;
      const dvSky = S && parkingAltitudeKm != null ? injectionDvFromC3(p.c3, S.mu, S.R + parkingAltitudeKm) : null;
      return Object.assign(p, { dvAster, dvSky, reproduces: reproduces(dvAster, p.dv), reproducesOnSkyhook: reproduces(dvSky, p.dv) });
    });

    // reconciliation gates: what has to hold for this study's numbers to be trusted at these commits
    const gates = [];
    const gate = (id, ok, detail) => gates.push({ id, ok: !!ok, detail });
    if (S) {
      const t = canonTables.skyhook;
      const earthDep = t.filter((q) => q.depends.length && !q.refused && q.reproduces !== null);
      const failing = earthDep.filter((q) => !q.reproduces).map((q) => q.path).sort();
      const exp = expected ? expected.skyhookNonReproducing.slice().sort() : [];
      gate('canon-on-skyhook-earth', JSON.stringify(failing) === JSON.stringify(exp),
        `${earthDep.length - failing.length} of ${earthDep.length} Earth-dependent values reproduce on the Skyhook module Earth; not reproduced: ${failing.join(', ') || 'none'}`);
      const indep = t.filter((q) => !q.depends.length && q.reproduces !== null);
      gate('canon-earth-independent', indep.every((q) => q.reproduces), `${indep.filter((q) => q.reproduces).length} of ${indep.length} Earth-independent values reproduce`);
    }
    if (!gridCheck.refused) {
      const pts = gridCheck.points;
      gate('grid-mass-ratios', pts.every((p) => p.massRatioReproduces), `${pts.filter((p) => p.massRatioReproduces).length} of ${pts.length} decision-grid mass ratios reproduce at 4 decimals`);
      const onS = pts.filter((p) => reproduces(p.dollars.skyhook.momentum, p.published.reboost_electricity_per_kg)).length;
      const onA = pts.filter((p) => reproduces(p.dollars.aster.momentum, p.published.reboost_electricity_per_kg)).length;
      gate('grid-reboost-momentum-view', onS === pts.length, `${onS} of ${pts.length} reboost lines reproduce as 2·v_orb·v_tip on the Skyhook Earth (${onA} on the Aster Earth)`);
    }
    if (pins.length) gate('aster-injection-pins', pins.every((p) => p.reproduces), `${pins.filter((p) => p.reproduces).length} of ${pins.length} of Aster's published injection values reproduce with Aster's constants`);
    gate('mp001-not-reproduced', sweep.length && sweep[0].distance > 0.5 * Math.pow(10, -decimalsOf(target)),
      sweep.length ? `nearest of ${sweep.length} accountings to ${target} MJ/kg is ${sweep[0].value.toFixed(2)}` : 'no sweep');

    return { earths, canonTables, parkingAltitudeKm, iface, reboostRows, sweep, target, gridCheck, groups, pins, gates };
  }

  // ---------------------------------------------------------------- formatting
  const MINUS = '\u2212';
  function fmt(x, d) {
    if (x == null) return '—';
    if (!Number.isFinite(x)) return String(x);
    const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return x < 0 && /[1-9]/.test(s) ? MINUS + s : s;
  }
  function fmtSigned(x, d) {
    if (x == null || !Number.isFinite(x)) return fmt(x, d);
    const s = fmt(Math.abs(x), d);
    if (!/[1-9]/.test(s)) return s;
    return (x < 0 ? MINUS : '+') + s;
  }
  const SUPER = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function fmtRel(x) {
    if (x == null || !Number.isFinite(x)) return '—';
    if (x === 0) return '0';
    const [m, e] = Math.abs(x).toExponential(2).split('e');
    return `${x < 0 ? MINUS : '+'}${m}×10${e.replace('+', '').split('').map((c) => SUPER[c] || c).join('')}`;
  }
  // a printed JSON number as text, with a typographic minus
  const fmtPrinted = (v) => (v == null ? '' : Array.isArray(v) ? v.map(fmtPrinted).join(', ') : String(v).replace('-', MINUS));

  return {
    UNITS, CANON_UNIT, TIER_DEFS,
    parseLiteral, toCanonical, refusal, rowValue, earthFromSet, validEarth,
    decimalsOf, reproduces,
    erf, characteristicVelocityKms, massRatio, geometry, release, tipSpeedForC3, tiers, deriveCanon,
    c3Shift, apogeeOf, trimAtParabolic, injectionDvFromC3, interfaceEffects,
    reboost, reboostSweep, reboostDollarsPerKg,
    groupFamily, asterPins, checkGrid, GRID_TIER, analyze,
    fmt, fmtSigned, fmtRel, fmtPrinted, get,
  };
});
