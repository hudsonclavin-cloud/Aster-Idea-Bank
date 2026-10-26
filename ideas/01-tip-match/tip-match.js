// Tip Match — the K2 kernel: can a payload arriving at Earth with hyperbolic excess speed v∞
// be met at a rotating tether's upper tip, and what speed mismatch (trim Δv) would remain?
//
// Pure logic, no DOM. Loads as a classic script (window.TipMatch) and via require() for the
// Node tests and the CLI. Every tether number comes from the rev_a.json snapshot handed to
// create(); the v∞ domain bound and the NHATS arrival speeds come from the Aster data module
// (snapshots/aster.data.js, derived by build-data.mjs); nothing is retyped here. Two-body,
// Earth-centred, instantaneous; energy condition only. Plane and phase are structured refusals
// (Aster EvidenceEnvelope shape, mcp/src/envelope).
//
// Confidence labels follow the Skyhook convention: [Certain] derivable from first principles,
// [Likely] minor modelling assumptions, [Speculative] estimate.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TipMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KERNEL_VERSION = '0.2.0';
  const CODE_PATH = 'ideas/01-tip-match/tip-match.js';
  const CODE_COMMIT = 'Aster-Idea-Bank: first committed in a35dec0; this revision is the next bank commit touching ideas/01-tip-match (git log -- ideas/01-tip-match)';
  const REFUSAL_CODES = ['insufficient_data', 'out_of_envelope', 'not_found'];
  const CONFIDENCES = ['measured', 'derived', 'assumed'];
  const RANK = { assumed: 0, derived: 1, measured: 2 };
  // The one default this kernel owns. Skyhook docs/project_instructions.md:124 @ 34935cb asks for
  // "relative velocity within ~1 m/s at the moment of capture" (a planning requirement for an
  // ascending payload, not a rev_a.json value); the page and the CLI read it from here.
  const DEFAULT_TOLERANCE_MS = 1;
  const TOLERANCE_SOURCE = 'Skyhook docs/project_instructions.md:124 @ 34935cb ("relative velocity within ~1 m/s at the moment of capture")';

  // The three tip-speed tiers rev_a.json carries, with the dot-paths of the file's own stated
  // numbers so the tests can reconcile what this kernel derives against what the file says.
  const TIERS = [
    {
      key: 'reference',
      label: 'Reference',
      detail: 'Rev A reference, GTO / high-elliptical class',
      vTipPath: 'kinematics.v_tip_kms',
      statedC3Path: 'kinematics.c3_kms2',
      statedApogeePath: 'kinematics.apogee_altitude_km',
      statedReleasePath: 'kinematics.v_upper_release_kms',
      statedMassRatioPath: 'mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_derate',
    },
    {
      key: 'cislunar',
      label: 'Cislunar',
      detail: 'revenue-gated option, needs a named anchor customer',
      vTipPath: 'kinematics.cislunar_revenue_gated_option.v_tip_kms',
      statedC3Path: 'kinematics.cislunar_revenue_gated_option.c3_kms2',
      statedApogeePath: 'kinematics.cislunar_revenue_gated_option.apogee_altitude_km',
      statedReleasePath: 'kinematics.cislunar_revenue_gated_option.v_upper_release_kms',
      statedMassRatioPath: 'kinematics.cislunar_revenue_gated_option.integrated_mass_ratio_30pct_derate_both_arms',
    },
    {
      key: 'phase3',
      label: 'Phase 3',
      detail: 'Mars-class growth option, not the near-term reference',
      vTipPath: 'kinematics.phase3_growth_option.v_tip_kms',
      statedC3Path: 'kinematics.phase3_growth_option.c3_kms2',
      statedApogeePath: null,
      statedReleasePath: 'kinematics.phase3_growth_option.v_upper_release_kms',
      statedMassRatioPath: 'kinematics.phase3_growth_option.integrated_mass_ratio_30pct_derate_both_arms',
    },
  ];
  // Two readings of NHATS's v_arr_earth (an Earth-entry speed): the altitude NHATS's entry
  // constraint is stated at, and the Trajectory Browser's reentry altitude. The record cannot
  // tell which the API means (ideas/05-round-trip-ledger documents the ambiguity).
  const READINGS = {
    'entry-125': { citedKey: 'nhats_entry_altitude_km', label: 'NHATS entry altitude' },
    'reentry-200': { citedKey: 'browser_reentry_altitude_km', label: 'Trajectory Browser reentry altitude' },
  };

  function getPath(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function isFiniteNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
  }
  function has(obj, key) {
    return obj !== null && typeof obj === 'object' && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
  }
  function isoDate(d) {
    return (d instanceof Date ? d : new Date()).toISOString().slice(0, 10);
  }

  // A speed difference in words a person can compare with a tolerance: m/s with enough digits
  // that a non-zero difference never prints as zero, km/s from 1 km/s up.
  function formatSpeedDiff(ms) {
    const a = Math.abs(ms);
    if (!Number.isFinite(a)) return String(ms);
    if (a === 0) return '0 m/s';
    if (a >= 1000) return `${(a / 1000).toFixed(3)} km/s`;
    if (a >= 10) return `${a.toFixed(1)} m/s`;
    if (a >= 1) return `${a.toFixed(2)} m/s`;
    return `${a.toPrecision(2)} m/s`;
  }
  function signedSpeedDiff(ms) {
    return `${ms >= 0 ? '+' : '−'}${formatSpeedDiff(ms)}`;
  }

  // A Quantity in Aster's sense: value + units, and because every envelope here has mixed
  // provenance, a confidence and the ids of the sources it rests on.
  function Q(value, units, confidence, sourceIds) {
    if (!isFiniteNumber(value)) throw new TypeError(`Quantity ${units} must be finite, got ${value}`);
    return { value, units, confidence, sourceIds: sourceIds.slice() };
  }

  // ------------------------------------------------------------------ constants from the canon
  // Reads what the kernel needs out of a rev_a.json object. Returns { ok: true, c } or
  // { ok: false, refusal } when the file does not say something the kernel cannot do without.
  function readConstants(revA) {
    const missing = [];
    const need = (p) => {
      const v = getPath(revA, p);
      if (!isFiniteNumber(v)) missing.push(p);
      return v;
    };
    const muM3s2 = need('orbital.mu_earth_m3s2');
    const comAltKm = need('orbital.com_altitude_km');
    const halfLengthKm = need('geometry.tether_half_length_km');
    const sigmaGPa = need('materials.tensile_strength_GPa');
    const rhoKgm3 = need('materials.density_kgm3');
    const vTips = TIERS.map((t) => need(t.vTipPath));
    if (missing.length) {
      return {
        ok: false,
        refusal: {
          code: 'not_found',
          reason: `rev_a.json does not carry: ${missing.join(', ')}`,
          what_would_help: 'A Rev A params file with these keys; the kernel never substitutes a remembered value.',
        },
      };
    }

    // [Certain] rev_a.json never states an Earth radius as a key. It states the upper-tip radius
    // three times in prose ("r_tip=7301 km", "r=R_E+610+320=7301 km"); that is the number its
    // own C3 and apogee entries were evaluated at, so the kernel takes r_tip from the C3 note and
    // derives R_E = r_tip − altitude − half-length. (orbital.com_radius_km is NOT used: 6988 km
    // implies R_E = 6378 and does not reproduce the file's C3; see README Findings, F1.)
    const c3Note = String(getPath(revA, 'kinematics._c3_note') || '');
    const m = /r_tip\s*=\s*(\d+(?:\.\d+)?)\s*km/.exec(c3Note);
    if (!m) {
      return {
        ok: false,
        refusal: {
          code: 'not_found',
          reason: 'rev_a.json kinematics._c3_note does not state the upper-tip radius (r_tip=… km), so the Earth radius its C3 was evaluated with cannot be recovered.',
          what_would_help: 'An explicit earth_radius_km (or r_tip_km) key in rev_a.json; physics/skyhook_physics.py:40 uses R_EARTH_KM = 6371.0.',
        },
      };
    }
    const rTipKm = Number(m[1]);
    const earthRadiusKm = rTipKm - comAltKm - halfLengthKm;
    const rComKm = earthRadiusKm + comAltKm;
    const rLowKm = rComKm - halfLengthKm;
    const muKm3s2 = muM3s2 / 1e9;
    const vOrbKms = Math.sqrt(muKm3s2 / rComKm); // EQ-2 [Certain]
    const vCKms = Math.sqrt((2 * sigmaGPa * 1e9) / rhoKgm3) / 1e3; // EQ-4 [Certain]
    const ratioNote = String(getPath(revA, 'mass_ratio._ratio_note') || '');
    const g = /(\d+(?:\.\d+)?)x mass-growth guardrail/.exec(ratioNote);
    const guardrail = g ? Number(g[1]) : null;
    const statedNum = (p) => {
      const v = getPath(revA, p);
      return isFiniteNumber(v) ? v : null;
    };

    const tiers = {};
    TIERS.forEach((t, i) => {
      tiers[t.key] = {
        key: t.key,
        label: t.label,
        detail: t.detail,
        v_tip_kms: vTips[i],
        v_tip_path: t.vTipPath,
        stated: {
          c3_kms2: getPath(revA, t.statedC3Path),
          apogee_altitude_km: t.statedApogeePath ? getPath(revA, t.statedApogeePath) : null,
          v_upper_release_kms: getPath(revA, t.statedReleasePath),
          mass_ratio_30pct_derate: statedNum(t.statedMassRatioPath),
          mass_ratio_path: t.statedMassRatioPath,
        },
      };
    });

    return {
      ok: true,
      c: {
        revision: getPath(revA, '_meta.revision'),
        mu_km3s2: muKm3s2,
        com_altitude_km: comAltKm,
        half_length_km: halfLengthKm,
        r_tip_km: rTipKm,
        r_tip_source: 'kinematics._c3_note',
        earth_radius_km: earthRadiusKm,
        r_com_km: rComKm,
        r_low_km: rLowKm,
        com_radius_km_as_stated: getPath(revA, 'orbital.com_radius_km'),
        v_orb_kms: vOrbKms,
        v_orb_kms_as_stated: getPath(revA, 'orbital.v_orb_kms'),
        v_c_kms: vCKms,
        v_c_kms_as_stated: getPath(revA, 'materials.V_c_kms'),
        guardrail_tip_over_vc: guardrail,
        mars_escape_tip_speed_kms_as_stated: statedNum('market_thresholds.mars_escape_tip_speed_kms'),
        derate_fraction_as_stated: statedNum('materials.derate_fraction'),
        rotation_period_min_as_stated: getPath(revA, 'geometry.rotation_period_min'),
        tiers,
        tierOrder: TIERS.map((t) => t.key),
      },
    };
  }

  // ------------------------------------------------------------------ constants from the Aster data module
  // [Certain] The upper end of the v∞ domain. A returning payload is bound to the Sun, so its
  // heliocentric speed where it meets Earth is below solar escape speed there; Earth's own speed
  // adds at most head-on. Both are largest at Earth's perihelion, so for any Sun-bound arrival
  // v∞ < sqrt(2 μ☉ / r_p) + sqrt(μ☉ (2 / r_p − 1 / a)), r_p = a (1 − e). Patched conic.
  function readAster(aster) {
    const missing = [];
    const need = (p) => {
      const v = getPath(aster, p);
      if (!isFiniteNumber(v)) missing.push(p);
      return v;
    };
    const gm = need('helio.gm_sun_m3s2');
    const au = need('helio.au_m');
    const aAu = need('helio.earth_a_au');
    const e = need('helio.earth_e');
    if (missing.length) {
      return {
        ok: false,
        refusal: {
          code: 'not_found',
          reason: `The Aster data module does not carry ${missing.join(', ')}, so the largest v∞ a Sun-bound arrival can have cannot be stated and no v∞ can be accepted.`,
          what_would_help: 'snapshots/aster.data.js rebuilt by build-data.mjs --aster from an Aster checkout (GM_sun, AU and Earth\'s a, e from src/physics/constants/index.ts).',
        },
      };
    }
    const gmKm3s2 = gm / 1e9;
    const aKm = (aAu * au) / 1e3;
    const rpKm = aKm * (1 - e);
    const vEscKms = Math.sqrt((2 * gmKm3s2) / rpKm);
    const vEarthKms = Math.sqrt(gmKm3s2 * (2 / rpKm - 1 / aKm));
    const out = {
      ok: true,
      helio: { gm_sun_km3s2: gmKm3s2, earth_perihelion_km: rpKm, v_esc_sun_at_rp_kms: vEscKms, v_earth_at_rp_kms: vEarthKms, vinf_max_kms: vEscKms + vEarthKms, source: getPath(aster, 'helio.source') },
      porkchop: null,
      nhats: null,
      provenance: (aster && aster.provenance) || {},
    };
    const muE = getPath(aster, 'porkchop.earth_mu_km3s2');
    const rPark = getPath(aster, 'porkchop.leo_parking_radius_km');
    const hPark = getPath(aster, 'cited.leo_parking_altitude_km.value');
    if (isFiniteNumber(muE) && isFiniteNumber(rPark) && isFiniteNumber(hPark)) {
      out.porkchop = { earth_mu_km3s2: muE, leo_parking_radius_km: rPark, leo_parking_altitude_km: hPark, earth_radius_km: rPark - hPark, source: getPath(aster, 'porkchop.source') };
    }
    const recs = getPath(aster, 'nhats.records');
    if (out.porkchop && Array.isArray(recs)) {
      out.nhats = { records: recs, skipped: getPath(aster, 'nhats.skipped') || [], files_read: getPath(aster, 'nhats.files_read'), dirs: getPath(aster, 'nhats.dirs') || [], cited: getPath(aster, 'cited') || {} };
    }
    return out;
  }

  // ------------------------------------------------------------------ the physics
  // [Certain] Release/catch energy at the upper tip. The tip at the top of its swing moves at
  // v_orb + v_tip, horizontal and prograde (rigid rotation, circular CoM orbit). Its specific
  // energy at r_tip gives C3 = v² − 2μ/r_tip (Skyhook EQ-7, apogee_from_release).
  function tierEnergy(c, tierKey) {
    if (!has(c.tiers, tierKey)) return null;
    const t = c.tiers[tierKey];
    const vTipInertial = c.v_orb_kms + t.v_tip_kms;
    const c3 = vTipInertial * vTipInertial - (2 * c.mu_km3s2) / c.r_tip_km;
    const eps = c3 / 2;
    let apogeeAltKm = null;
    if (eps < 0) {
      const a = -c.mu_km3s2 / (2 * eps);
      apogeeAltKm = 2 * a - c.r_tip_km - c.earth_radius_km;
    }
    return {
      key: t.key,
      v_tip_kms: t.v_tip_kms,
      v_tip_inertial_kms: vTipInertial,
      c3_kms2: c3,
      bound: eps < 0,
      apogee_altitude_km: apogeeAltKm,
      // [Certain] The one v∞ this tier meets with zero trim: v∞* = sqrt(C3) when C3 > 0.
      vinf_star_kms: c3 > 0 ? Math.sqrt(c3) : null,
      v_lower_tip_inertial_kms: c.v_orb_kms - t.v_tip_kms,
    };
  }

  // [Certain] Vis-viva on the arrival hyperbola at radius r: v² = v∞² + 2μ/r, whatever the perigee.
  function speedAtRadius(c, vinfKms, rKm) {
    return Math.sqrt(vinfKms * vinfKms + (2 * c.mu_km3s2) / rKm);
  }

  // [Certain] The tip speed a tether at this altitude/length would need to meet v∞ with zero trim.
  function zeroTrimTipSpeed(c, vinfKms) {
    return speedAtRadius(c, vinfKms, c.r_tip_km) - c.v_orb_kms;
  }

  // ------------------------------------------------------------------ envelopes
  function refuse(tool, code, reason, whatWouldHelp, extras) {
    extras = extras || {};
    if (!REFUSAL_CODES.includes(code)) throw new TypeError(`Unknown refusal code: ${code}`);
    const provenance = (extras.provenance || []).slice();
    return {
      envelope_version: '1',
      tool,
      as_of: extras.as_of || isoDate(),
      value: null,
      confidence: provenance.length ? confidenceMin(provenance) : 'assumed',
      provenance,
      assumptions: (extras.assumptions || []).slice(),
      validity_envelope: extras.validity_envelope || 'not evaluated',
      refusal: { code, reason, what_would_help: whatWouldHelp },
    };
  }

  function confidenceMin(provenance) {
    return provenance.reduce((w, s) => (RANK[s.confidence] < RANK[w] ? s.confidence : w), 'measured');
  }

  function sourceRefs(sidecar, asterProv, asOf, c) {
    const commit = (sidecar && sidecar.commit) || 'unknown';
    const path = (sidecar && sidecar.path) || 'params/rev_a.json';
    const aCommit = (asterProv && asterProv.commit) || 'unknown';
    return {
      'rev-a-mu': {
        id: 'rev-a-mu',
        kind: 'repo',
        path,
        commit,
        confidence: 'measured',
        note: `orbital.mu_earth_m3s2 (${c ? c.mu_km3s2 * 1e9 : 'unread'} m³/s²), a measured physical constant; snapshot sha256 ${(sidecar && sidecar.sourceSha256) || 'unknown'}`,
      },
      'rev-a-design': {
        id: 'rev-a-design',
        kind: 'repo',
        path,
        commit,
        confidence: 'assumed',
        note: 'orbital.com_altitude_km, geometry.tether_half_length_km, kinematics.*.v_tip_kms, materials σ/ρ: Rev A design choices (nothing has flown); r_tip taken from kinematics._c3_note',
      },
      'vinf-input': {
        id: 'vinf-input',
        kind: 'external',
        name: 'Earth-arrival v∞ typed by the user',
        retrieved: asOf,
        confidence: 'assumed',
        note: 'K1 (Aster return-leg porkchop) would supply this; it has not been built, and Aster computes no Earth-arrival v∞. Aster\'s test fixtures hold JPL NHATS Earth-entry speeds (external data; see tip-match.nhats-arrivals).',
      },
      'tolerance-input': {
        id: 'tolerance-input',
        kind: 'external',
        name: 'Grapple relative-velocity tolerance declared by the user',
        retrieved: asOf,
        confidence: 'assumed',
        note: `Default ${DEFAULT_TOLERANCE_MS} m/s is the requirement in ${TOLERANCE_SOURCE}, written for ascending payloads; not in rev_a.json.`,
      },
      'aster-helio': {
        id: 'aster-helio',
        kind: 'repo',
        path: 'src/physics/constants/index.ts',
        commit: aCommit,
        confidence: 'measured',
        note: 'GM_sun, AU and Earth\'s a, e (Standish 1992 elements): measured constants, used only for the largest v∞ a Sun-bound arrival can have',
      },
      'aster-porkchop': {
        id: 'aster-porkchop',
        kind: 'repo',
        path: 'src/v2/porkchop/delta-v.ts',
        commit: aCommit,
        confidence: 'measured',
        note: 'EARTH_MU_KM3_PER_S2 and LEO_PARKING_RADIUS_KM; R_E = LEO_PARKING_RADIUS_KM minus the 200 km parking altitude stated at src/v2/app/porkchop/main.ts:981',
      },
      'nhats-fixtures': {
        id: 'nhats-fixtures',
        kind: 'external',
        name: 'NASA/JPL NHATS Data API min_dv_traj records committed as Aster test fixtures (tests/fixtures/v2/nhats-validation-targets, tests/fixtures/v2/oq7-nhats-coorbital)',
        retrieved: `Aster @ ${String(aCommit).slice(0, 7)}`,
        confidence: 'derived',
        note: 'JPL\'s own Lambert computations; v_arr_earth and dec_arr kept as the strings the API returned. Not computed by Aster.',
      },
      'nhats-altitude': {
        id: 'nhats-altitude',
        kind: 'repo',
        path: 'src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md',
        commit: aCommit,
        confidence: 'assumed',
        note: 'The altitude at which v_arr_earth is read: 125 km (:42, NHATS entry constraint) or 200 km (:17, Trajectory Browser reentry). The record itself does not say.',
      },
      'two-body': {
        id: 'two-body',
        kind: 'computation',
        method: 'Earth-centred two-body vis-viva: payload speed at the upper-tip radius sqrt(v∞² + 2μ/r_tip), the speed on the arrival hyperbola at r_tip whatever its perigee (the perigee speed only if perigee = r_tip); tip speed v_orb + v_tip with v_orb = sqrt(μ/r_com); trim = v_payload − v_tip_inertial; C3 = v_tip_inertial² − 2μ/r_tip; v∞* = sqrt(C3); for NHATS records v∞ = sqrt(v_arr_earth² − 2μ/(R_E + h_entry))',
        code: { path: CODE_PATH, commit: CODE_COMMIT },
        confidence: 'derived',
        note: 'Kernel ' + KERNEL_VERSION,
      },
    };
  }

  function validity(vinfMax) {
    return (
      `Two-body, Earth-centred, instantaneous. Accepted input: 0 ≤ v∞ ≤ ${vinfMax.toFixed(2)} km/s, i.e. a hyperbolic or parabolic arrival by a body bound to the Sun (the upper end is solar escape speed plus Earth's speed, head-on, at Earth's perihelion). ` +
      'Bound arrivals (geocentric C3 < 0, e.g. a payload falling back from a high Earth orbit or from the Moon) are outside this input domain; on its own release orbit, read backwards, such a payload meets the reference and cislunar tips with zero trim. ' +
      'The payload\'s speed at the upper-tip radius follows from v∞ alone (vis-viva), whatever its perigee; the trim reported is that scalar speed difference, which equals the vector mismatch only when the payload\'s velocity is parallel to the tip\'s, i.e. its perigee is at the upper-tip radius and it moves horizontally and prograde. A lower perigee adds a radial component, so the reported trim is a lower bound on the true velocity mismatch. ' +
      'Tether centre of mass on a circular orbit, rigid rotation, catch at the top of the swing. No J2, drag, lunar perturbation, gravity-gradient spin modulation, tether dynamics, grapple geometry or momentum-ledger effect. Energy condition only: plane and phase are not evaluated here.'
    );
  }

  // Built from the instance's own constants so no number in the prose is typed by hand.
  function assumptionsFor(c, pk) {
    const list = [
      `Earth radius ${c.earth_radius_km} km is implied by rev_a.json's own r_tip = ${c.r_tip_km} km note (kinematics._c3_note) and matches physics/skyhook_physics.py:40; orbital.com_radius_km (${c.com_radius_km_as_stated}, implying ${c.com_radius_km_as_stated - c.com_altitude_km}) is not used because it does not reproduce the file's C3 of ${c.tiers.reference.stated.c3_kms2} km²/s².`,
      `The tip's inertial speed is v_orb + v_tip with v_orb evaluated at the centre-of-mass radius, as Skyhook's apogee_from_release does; the tip itself is ${c.half_length_km} km higher, where a free body would orbit slower, but the tip is not a free body.`,
      'The payload is treated as a point mass that does not disturb the tether; catching tonnes at 10 km/s is a tether-dynamics question (Skyhook physics/tether_dynamics.py models only a lower-tip catch of an upbound payload).',
      '"Energy-matched" means |trim Δv| is within the declared grapple tolerance. It is necessary, not sufficient: plane and phase are refused separately.',
    ];
    if (pk) {
      list.push(`v∞ is the quantity handed across: Aster-side numbers (μ ${pk.earth_mu_km3s2} km³/s², R_E ${pk.earth_radius_km.toFixed(3)} km) and Skyhook-side numbers (μ ${c.mu_km3s2} km³/s², R_E ${c.earth_radius_km} km) each act on their own side of it; the two μ differ by ${(Math.abs(pk.earth_mu_km3s2 - c.mu_km3s2) / c.mu_km3s2 * 1e6).toFixed(1)} parts per million.`);
    }
    return list;
  }

  // ------------------------------------------------------------------ the instance
  function create(revA, sidecar, aster) {
    const read = readConstants(revA);
    const c = read.ok ? read.c : null;
    const ast = readAster(aster);
    const asterProv = ast.provenance || {};

    const tierKey0 = () => (c ? c.tierOrder[0] : undefined);
    // Shared input checks for the envelopes that take a tier and a tolerance. Returns a refusal
    // envelope or { tierKey, tol }.
    function checkTierTol(tool, input, asOf) {
      if (!read.ok) return { refusal: refuse(tool, read.refusal.code, read.refusal.reason, read.refusal.what_would_help, { as_of: asOf }) };
      const tierKey = input.tier;
      if (!has(c.tiers, tierKey)) {
        return { refusal: refuse(tool, 'not_found', `No tier ${JSON.stringify(String(tierKey))} in rev_a.json; tiers are ${c.tierOrder.join(', ')}.`, 'Pick one of the tiers rev_a.json defines (kinematics.v_tip_kms and the two options).', { as_of: asOf }) };
      }
      const tol = input.tolerance_ms === undefined ? DEFAULT_TOLERANCE_MS : input.tolerance_ms;
      if (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0) {
        return { refusal: refuse(tool, 'out_of_envelope', `Grapple tolerance must be a finite, non-negative speed in m/s; got ${typeof tol === 'string' ? JSON.stringify(tol) : String(tol)}.`, `Declare the relative-velocity tolerance the grapple can absorb, in m/s (the default, ${DEFAULT_TOLERANCE_MS} m/s, is the requirement in ${TOLERANCE_SOURCE}).`, { as_of: asOf }) };
      }
      return { tierKey, tol };
    }

    function energyEnvelope(input) {
      input = input || {};
      const asOf = input.as_of || isoDate();
      const tool = 'tip-match.energy';
      if (!read.ok) return refuse(tool, read.refusal.code, read.refusal.reason, read.refusal.what_would_help, { as_of: asOf });
      if (!has(c.tiers, input.tier)) return checkTierTol(tool, input, asOf).refusal;

      const vinf = input.vinf_kms;
      if (vinf === undefined || vinf === null || (typeof vinf === 'string' && vinf.trim() === '')) {
        return refuse(tool, 'insufficient_data', 'No Earth-arrival v∞ was given. Aster does not compute one (K1, the return-leg porkchop, is CONCEPT), and the screening cache\'s vInfDep/vInfArr are outbound-leg quantities.', 'Build K1 (swap the Lambert endpoints, body → Earth) so an arrival v∞ with provenance exists; until then type one, or read one off the JPL NHATS records in Aster\'s test fixtures (external data, shown by tip-match.nhats-arrivals).', { as_of: asOf });
      }
      if (typeof vinf !== 'number' || !Number.isFinite(vinf)) {
        return refuse(tool, 'insufficient_data', `v∞ must be a finite number in km/s; got ${typeof vinf === 'number' ? String(vinf) : JSON.stringify(vinf)}.`, 'A finite, non-negative Earth-arrival hyperbolic excess speed in km/s.', { as_of: asOf });
      }
      if (vinf < 0) {
        return refuse(tool, 'out_of_envelope', `v∞ is a speed and cannot be negative (got ${vinf} km/s). A bound arrival (geocentric C3 < 0) is not a negative v∞, and it is outside this kernel's input domain.`, 'Enter v∞ ≥ 0 km/s (0 is a parabolic arrival, the slowest a body from beyond Earth\'s sphere of influence can arrive). For a payload falling back from a bound Earth orbit, the arrival is described by its C3 instead; on a tier\'s own release orbit it meets the reference and cislunar tips with zero trim.', { as_of: asOf });
      }
      if (!ast.ok) return refuse(tool, ast.refusal.code, ast.refusal.reason, ast.refusal.what_would_help, { as_of: asOf });
      const vinfMax = ast.helio.vinf_max_kms;
      if (vinf > vinfMax) {
        const nh = nhatsEnvelope({ tier: tierKey0(), as_of: asOf });
        const seen = nh.value ? ` (the JPL NHATS records in Aster's test fixtures imply ${nh.value.summary.vinf_min_kms.value.toFixed(2)}–${nh.value.summary.vinf_max_kms.value.toFixed(2)} km/s at the ${nh.value.reading.entry_altitude_km.value} km reading)` : '';
        return refuse(tool, 'out_of_envelope', `v∞ = ${vinf} km/s is above ${vinfMax.toFixed(2)} km/s, the fastest a body bound to the Sun can meet Earth (solar escape speed ${ast.helio.v_esc_sun_at_rp_kms.toFixed(2)} km/s plus Earth's ${ast.helio.v_earth_at_rp_kms.toFixed(2)} km/s, head-on, at Earth's perihelion). A payload returning from an asteroid is bound to the Sun.`, `Enter 0 ≤ v∞ ≤ ${vinfMax.toFixed(2)} km/s. Returns from near-Earth asteroids arrive at a few km/s${seen}.`, { as_of: asOf });
      }
      const ck = checkTierTol(tool, input, asOf);
      if (ck.refusal) return ck.refusal;
      const { tierKey, tol } = ck;
      const t = c.tiers[tierKey];

      const refs = sourceRefs(sidecar, asterProv, asOf, c);
      const e = tierEnergy(c, tierKey);
      const vPay = speedAtRadius(c, vinf, c.r_tip_km);
      const trim = vPay - e.v_tip_inertial_kms;
      const trimMs = trim * 1000;
      const matched = Math.abs(trimMs) <= tol;
      const vPayLow = speedAtRadius(c, vinf, c.r_low_km);
      const lowGap = vPayLow - e.v_lower_tip_inertial_kms;
      const vTipNeeded = zeroTrimTipSpeed(c, vinf);
      const ratio = vTipNeeded / c.v_c_kms;

      const D = ['rev-a-mu', 'rev-a-design', 'two-body'];
      const V = ['rev-a-mu', 'vinf-input', 'two-body'];
      const DV = ['rev-a-mu', 'rev-a-design', 'vinf-input', 'two-body'];

      const value = {
        kernel_version: KERNEL_VERSION,
        tier: { key: t.key, label: t.label, detail: t.detail, v_tip_kms: Q(t.v_tip_kms, 'km/s', 'assumed', ['rev-a-design']), v_tip_path: t.v_tip_path },
        input: {
          vinf_kms: Q(vinf, 'km/s', 'assumed', ['vinf-input']),
          vinf_domain_max_kms: Q(vinfMax, 'km/s', 'derived', ['aster-helio', 'two-body']),
        },
        geometry: {
          earth_radius_km: Q(c.earth_radius_km, 'km', 'assumed', ['rev-a-design']),
          r_com_km: Q(c.r_com_km, 'km', 'assumed', ['rev-a-design']),
          r_tip_km: Q(c.r_tip_km, 'km', 'assumed', ['rev-a-design']),
          r_low_km: Q(c.r_low_km, 'km', 'assumed', ['rev-a-design']),
          v_orb_kms: Q(c.v_orb_kms, 'km/s', 'derived', D),
        },
        upper_tip: {
          v_tip_inertial_kms: Q(e.v_tip_inertial_kms, 'km/s', 'derived', D),
          v_payload_kms: Q(vPay, 'km/s', 'derived', V),
          trim_dv_kms: Q(trim, 'km/s', 'derived', DV),
          trim_dv_ms: Q(trimMs, 'm/s', 'derived', DV),
          // sign: positive = payload faster than tip, a retrograde burn would be needed
          payload_faster_than_tip: trim > 0,
          c3_tier_kms2: Q(e.c3_kms2, 'km²/s²', 'derived', D),
          release_bound: e.bound,
          apogee_altitude_km: e.apogee_altitude_km === null ? null : Q(e.apogee_altitude_km, 'km', 'derived', D),
          vinf_star_kms: e.vinf_star_kms === null ? null : Q(e.vinf_star_kms, 'km/s', 'derived', D),
          parabolic_speed_at_tip_kms: Q(speedAtRadius(c, 0, c.r_tip_km), 'km/s', 'derived', ['rev-a-mu', 'rev-a-design', 'two-body']),
        },
        zero_trim: {
          tip_speed_needed_kms: Q(vTipNeeded, 'km/s', 'derived', DV),
          over_vc: Q(ratio, 'ratio to Zylon V_c', 'derived', DV),
          v_c_kms: Q(c.v_c_kms, 'km/s', 'derived', D),
          guardrail_over_vc: c.guardrail_tip_over_vc === null ? null : Q(c.guardrail_tip_over_vc, 'ratio to V_c', 'assumed', ['rev-a-design']),
          beyond_guardrail: c.guardrail_tip_over_vc === null ? null : ratio > c.guardrail_tip_over_vc,
        },
        lower_tip: {
          v_tip_inertial_kms: Q(e.v_lower_tip_inertial_kms, 'km/s', 'derived', D),
          v_payload_kms: Q(vPayLow, 'km/s', 'derived', V),
          gap_kms: Q(lowGap, 'km/s', 'derived', DV),
          verdict: lowGap > 0 ? 'not reachable' : 'reachable',
        },
        match: {
          tolerance_ms: Q(tol, 'm/s', 'assumed', ['tolerance-input']),
          energy_matched: matched,
          verdict: matched
            ? `energy-matched within ${tol} m/s: payload and tip differ by ${formatSpeedDiff(trimMs)} (plane and phase not evaluated)`
            : `not energy-matched: payload arrives ${formatSpeedDiff(trimMs)} ${trim > 0 ? 'faster' : 'slower'} than the tip`,
        },
        conditions: [
          { condition: 'energy', status: 'computed' },
          { condition: 'plane', status: 'refused', refusal: planeRefusal() },
          { condition: 'phase', status: 'refused', refusal: phaseRefusal(c) },
        ],
      };

      const provenance = [refs['rev-a-mu'], refs['rev-a-design'], refs['vinf-input'], refs['tolerance-input'], refs['aster-helio'], refs['two-body']];
      return {
        envelope_version: '1',
        tool,
        as_of: asOf,
        value,
        confidence: confidenceMin(provenance),
        provenance,
        assumptions: assumptionsFor(c, ast.ok ? ast.porkchop : null),
        validity_envelope: validity(vinfMax),
      };
    }

    // The JPL NHATS records in Aster's test fixtures, read as Earth-arrival v∞ and set against a
    // tier. External data (JPL's Lambert computations), labelled as such; the entry altitude at
    // which v_arr_earth is read is an assumption with two cited readings.
    function nhatsEnvelope(input) {
      input = input || {};
      const asOf = input.as_of || isoDate();
      const tool = 'tip-match.nhats-arrivals';
      const ck = checkTierTol(tool, input, asOf);
      if (ck.refusal) return ck.refusal;
      if (!ast.ok || !ast.nhats) {
        return refuse(tool, 'not_found', 'The Aster data module carries no NHATS records or no porkchop Earth constants, so no arrival speed can be read off them.', 'snapshots/aster.data.js rebuilt by build-data.mjs --aster from an Aster checkout that still commits tests/fixtures/v2/nhats-validation-targets and oq7-nhats-coorbital.', { as_of: asOf });
      }
      const readingKey = input.reading === undefined ? 'entry-125' : input.reading;
      const reading = has(READINGS, readingKey) ? READINGS[readingKey] : null;
      const hEntry = reading ? getPath(ast.nhats.cited, `${reading.citedKey}.value`) : undefined;
      if (!reading || !isFiniteNumber(hEntry)) {
        return refuse(tool, 'not_found', `No entry-altitude reading ${JSON.stringify(String(readingKey))}; readings are ${Object.keys(READINGS).join(', ')}.`, 'Pick entry-125 (NHATS\'s entry constraint, research note :42) or reentry-200 (Trajectory Browser, :17).', { as_of: asOf });
      }
      const { tierKey, tol } = ck;
      const t = c.tiers[tierKey];
      const e = tierEnergy(c, tierKey);
      const pk = ast.porkchop;
      const rEntry = pk.earth_radius_km + hEntry;
      const vEsc = Math.sqrt((2 * pk.earth_mu_km3s2) / rEntry);
      const refs = sourceRefs(sidecar, asterProv, asOf, c);
      const N = ['nhats-fixtures'];
      const NV = ['nhats-fixtures', 'aster-porkchop', 'nhats-altitude', 'two-body'];
      const NVT = ['nhats-fixtures', 'aster-porkchop', 'nhats-altitude', 'rev-a-mu', 'rev-a-design', 'two-body'];

      const rows = [];
      const unconverted = [];
      for (const r of ast.nhats.records) {
        const s = String(r.v_arr_earth);
        const v = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
        if (!Number.isFinite(v)) {
          unconverted.push({ des: r.des, v_arr_earth: s, reason: 'not a decimal number' });
          continue;
        }
        if (v < vEsc) {
          unconverted.push({ des: r.des, v_arr_earth: s, reason: `below escape speed at ${hEntry} km (a bound arrival, outside this input domain)` });
          continue;
        }
        const vinf = Math.sqrt(v * v - vEsc * vEsc);
        const vPay = speedAtRadius(c, vinf, c.r_tip_km);
        const trimMs = (vPay - e.v_tip_inertial_kms) * 1000;
        // the record is rounded to its last printed digit: half a unit there, carried through
        // d(trim)/d(v_arr) = (v_arr / v∞)(v∞ / v_pay) = v_arr / v_pay
        const decimals = (s.split('.')[1] || '').length;
        const halfUnitKms = 0.5 * Math.pow(10, -decimals);
        rows.push({ r, v, vinf, trimMs, halfUnitKms, roundMs: ((halfUnitKms * v) / vPay) * 1000 });
      }
      if (!rows.length) {
        return refuse(tool, 'out_of_envelope', `No NHATS record's v_arr_earth exceeds escape speed at ${hEntry} km (${vEsc.toFixed(4)} km/s), so none is a hyperbolic arrival under this reading.`, 'Use the other entry-altitude reading, or records that are hyperbolic at it.', { as_of: asOf });
      }
      rows.sort((a, b) => a.vinf - b.vinf);
      const n = rows.length;
      const median = n % 2 ? rows[(n - 1) / 2].vinf : (rows[n / 2 - 1].vinf + rows[n / 2].vinf) / 2;
      const byTrim = rows.slice().sort((a, b) => Math.abs(a.trimMs) - Math.abs(b.trimMs));
      const row = (x) => ({
        des: x.r.des,
        fullname: x.r.fullname,
        v_arr_earth_kms: Q(x.v, 'km/s', 'derived', N),
        vinf_kms: Q(x.vinf, 'km/s', 'derived', NV),
        trim_dv_ms: Q(x.trimMs, 'm/s', 'derived', NVT),
        trim_rounding_ms: Q(x.roundMs, 'm/s', 'derived', NVT),
        dec_arr_deg: /^-?\d+(\.\d+)?$/.test(String(x.r.dec_arr)) ? Q(Number(x.r.dec_arr), 'deg', 'derived', N) : null,
      });

      const value = {
        kernel_version: KERNEL_VERSION,
        reading: {
          key: readingKey,
          label: reading.label,
          entry_altitude_km: Q(hEntry, 'km', 'assumed', ['nhats-altitude']),
          earth_radius_km: Q(pk.earth_radius_km, 'km', 'measured', ['aster-porkchop']),
          r_entry_km: Q(rEntry, 'km', 'derived', ['aster-porkchop', 'nhats-altitude']),
          escape_speed_kms: Q(vEsc, 'km/s', 'derived', ['aster-porkchop', 'nhats-altitude', 'two-body']),
          cite: getPath(ast.nhats.cited, `${reading.citedKey}.cite`) || null,
        },
        tier: { key: t.key, label: t.label, v_tip_kms: Q(t.v_tip_kms, 'km/s', 'assumed', ['rev-a-design']), vinf_star_kms: e.vinf_star_kms === null ? null : Q(e.vinf_star_kms, 'km/s', 'derived', ['rev-a-mu', 'rev-a-design', 'two-body']) },
        source: {
          files_read: ast.nhats.files_read,
          bodies: ast.nhats.records.length,
          skipped_files: ast.nhats.skipped.length,
          duplicate_bodies: ast.nhats.records.filter((r) => Array.isArray(r.files) && r.files.length > 1).map((r) => r.des),
          not_converted: unconverted,
        },
        summary: {
          count: n,
          vinf_min_kms: Q(rows[0].vinf, 'km/s', 'derived', NV),
          vinf_min_des: rows[0].r.des,
          vinf_median_kms: Q(median, 'km/s', 'derived', NV),
          vinf_max_kms: Q(rows[n - 1].vinf, 'km/s', 'derived', NV),
          vinf_max_des: rows[n - 1].r.des,
          payload_faster: rows.filter((x) => x.trimMs > 0).length,
          payload_slower: rows.filter((x) => x.trimMs < 0).length,
          energy_matched: rows.filter((x) => Math.abs(x.trimMs) <= tol).length,
          tolerance_ms: Q(tol, 'm/s', 'assumed', ['tolerance-input']),
        },
        closest: byTrim.slice(0, 5).map(row),
        records: rows.map((x) => ({ des: x.r.des, vinf_kms: Q(x.vinf, 'km/s', 'derived', NV), trim_dv_ms: Q(x.trimMs, 'm/s', 'derived', NVT) })),
      };
      const provenance = [refs['nhats-fixtures'], refs['aster-porkchop'], refs['nhats-altitude'], refs['rev-a-mu'], refs['rev-a-design'], refs['tolerance-input'], refs['two-body']];
      return {
        envelope_version: '1',
        tool,
        as_of: asOf,
        value,
        confidence: confidenceMin(provenance),
        provenance,
        assumptions: [
          `v_arr_earth is read as the speed at ${hEntry} km altitude (${reading.label}); the record does not state its altitude, and the two cited readings move every v∞ (sibling deposit ideas/05-round-trip-ledger documents the ambiguity).`,
          'R_E = 6378.137 km and μ = 398,600.4418 km³/s² from Aster\'s porkchop module invert the entry speed; the tether side uses rev_a.json\'s. v∞ is the quantity handed across.',
          'These are JPL\'s minimum-Δv round trips for each body, one trajectory per body, not every return a mission could fly; a different return date gives a different v∞.',
          'The frame of dec_arr is stated nowhere in the Aster checkout; it is shown, not used.',
        ],
        validity_envelope: `JPL NHATS min_dv_traj records only (${ast.nhats.records.length} bodies). v∞ = sqrt(v_arr_earth² − 2μ/(R_E + ${hEntry} km)); a record below escape speed there is listed, not converted. The records are rounded to ${Math.max(...rows.map((x) => x.halfUnitKms)) * 2} km/s, which is at most ±${Math.max(...rows.map((x) => x.roundMs)).toFixed(2)} m/s of trim. Energy condition only, same tether model as tip-match.energy.`,
      };
    }

    function planeRefusal() {
      return {
        code: 'insufficient_data',
        reason: 'The energy condition says nothing about direction. Meeting the upper tip needs the arrival hyperbola\'s plane to contain the tether\'s velocity at the catch point: the asymptote\'s declination and right ascension against the tether orbit\'s inclination and node. The typed input is a scalar v∞; Aster\'s screening cache keeps only scalar vInfDep/vInfArr (src/v2/boundary/lambert-screen-cache.ts:43-49); the JPL NHATS records in Aster\'s test fixtures carry dec_arr, the asymptote\'s declination, but no right ascension, in a frame the checkout does not state; and rev_a.json states no orbit plane for the tether.',
        what_would_help: 'The Earth-arrival v∞ vector from K1 in ICRF/equatorial with its frame established by measurement (Aster INV-021), plus the tether orbit\'s inclination and RAAN. Then the plane condition is one angle: between the arrival asymptote and the tether\'s orbital angular momentum. With a declination δ alone (as NHATS gives), one necessary condition can be stated once rev_a.json names an inclination i: |δ| ≤ i.',
      };
    }
    function phaseRefusal(cc) {
      const period = cc && isFiniteNumber(cc.rotation_period_min_as_stated) ? `${cc.rotation_period_min_as_stated} min (rev_a.json geometry.rotation_period_min, reference tier)` : 'one rotation period';
      return {
        code: 'insufficient_data',
        reason: `The tip is at the top of its swing once per rotation (${period}) and over any given point once per orbit; the payload\'s perigee passage is one instant. Whether they coincide needs the tether\'s ephemeris (orbit epoch and spin phase) and the payload\'s perigee epoch. No tether has flown, so no ephemeris exists, and K1 has not produced an arrival epoch.`,
        what_would_help: 'A tether state vector and spin phase at an epoch, and the payload\'s perigee epoch from K1. Then phase margin is a two-body propagation and a comparison modulo the rotation period, and on the payload\'s side a matter of launch timing (Skyhook docs/project_instructions.md:122-124 budgets a 3–10 s window).',
      };
    }

    function planeEnvelope(input) {
      input = input || {};
      const asOf = input.as_of || isoDate();
      const r = planeRefusal();
      return refuse('tip-match.plane', r.code, r.reason, r.what_would_help, { as_of: asOf, validity_envelope: 'not evaluated: no v∞ vector and no tether orbit plane' });
    }
    function phaseEnvelope(input) {
      input = input || {};
      const asOf = input.as_of || isoDate();
      const r = phaseRefusal(c);
      return refuse('tip-match.phase', r.code, r.reason, r.what_would_help, { as_of: asOf, validity_envelope: 'not evaluated: no tether ephemeris and no arrival epoch' });
    }

    // The page offers "take v∞ from Aster's screening cache" and this is the answer.
    function vinfSourceEnvelope(source, input) {
      input = input || {};
      const asOf = input.as_of || isoDate();
      if (source === 'typed') return null;
      if (source === 'aster-cache') {
        return refuse(
          'tip-match.vinf-source',
          'not_found',
          'Aster computes no Earth-arrival v∞. Its Lambert screening cache holds c3, vInfDep and vInfArr per window (src/v2/boundary/lambert-screen-cache.ts:43-49): vInfDep is departure from Earth and vInfArr is arrival at the asteroid, both on the outbound leg. Neither is an Earth-arrival v∞ for a return leg, and presenting one as such would be a fabrication.',
          'K1, the return-leg porkchop (Aster strategy/IDEA_KERNELS_2026-09.md §3 item 2): the same Lambert grid with the endpoints swapped (body → Earth) yields Earth-arrival v∞ with provenance. Until then the nearest real numbers are external: the JPL NHATS min-Δv round trips committed as Aster test fixtures (tests/fixtures/v2/nhats-validation-targets, oq7-nhats-coorbital) carry v_arr_earth, an Earth-entry speed that gives v∞ once its altitude is fixed (125 km or 200 km; ideas/05-round-trip-ledger documents the ambiguity). tip-match.nhats-arrivals reads them, labelled as JPL\'s numbers, not Aster\'s.',
          { as_of: asOf, validity_envelope: 'not evaluated: Aster computes no such quantity' }
        );
      }
      return refuse('tip-match.vinf-source', 'not_found', `Unknown v∞ source ${JSON.stringify(String(source))}.`, 'Use "typed" or "aster-cache".', { as_of: asOf });
    }

    return {
      ok: read.ok,
      constants: c,
      refusal: read.ok ? null : read.refusal,
      aster: ast.ok ? { helio: ast.helio, porkchop: ast.porkchop, has_nhats: !!ast.nhats } : null,
      asterRefusal: ast.ok ? null : ast.refusal,
      tierEnergy: (k) => (c ? tierEnergy(c, k) : null),
      speedAtRadius: (v, r) => speedAtRadius(c, v, r),
      zeroTrimTipSpeed: (v) => zeroTrimTipSpeed(c, v),
      energy: energyEnvelope,
      nhats: nhatsEnvelope,
      plane: planeEnvelope,
      phase: phaseEnvelope,
      vinfSource: vinfSourceEnvelope,
    };
  }

  // ------------------------------------------------------------------ envelope validation
  // A re-implementation of the checks Aster's makeEnvelope/refuse/validateLeafRefs perform
  // (mcp/src/envelope/index.ts), so an envelope produced here would be accepted there.
  // Returns a list of problems; empty means valid.
  function validateEnvelope(env) {
    const problems = [];
    if (!env || typeof env !== 'object') return ['envelope is not an object'];
    if (env.envelope_version !== '1') problems.push('envelope_version must be "1"');
    if (typeof env.tool !== 'string' || !env.tool.trim()) problems.push('tool must be non-empty');
    if (!CONFIDENCES.includes(env.confidence)) problems.push(`confidence "${env.confidence}" not in ${CONFIDENCES.join('/')}`);
    if (!Array.isArray(env.provenance)) problems.push('provenance must be an array');
    if (!Array.isArray(env.assumptions) || env.assumptions.some((a) => typeof a !== 'string')) problems.push('assumptions must be an array of strings');
    if (typeof env.validity_envelope !== 'string' || !env.validity_envelope.trim()) problems.push('validity_envelope must be non-empty');
    const ids = new Set();
    (env.provenance || []).forEach((s, i) => {
      if (!s || typeof s !== 'object') return problems.push(`provenance[${i}] not an object`);
      if (!CONFIDENCES.includes(s.confidence)) problems.push(`provenance[${i}].confidence invalid`);
      if (s.id) ids.add(s.id);
      if (s.kind === 'repo') {
        if (typeof s.path !== 'string' || typeof s.commit !== 'string' || !s.commit) problems.push(`provenance[${i}] repo ref needs path and commit`);
      } else if (s.kind === 'external') {
        if (typeof s.name !== 'string' || typeof s.retrieved !== 'string') problems.push(`provenance[${i}] external ref needs name and retrieved`);
      } else if (s.kind === 'computation') {
        if (typeof s.method !== 'string' || !s.code || typeof s.code.path !== 'string' || typeof s.code.commit !== 'string') problems.push(`provenance[${i}] computation ref needs method and code{path,commit}`);
        if (s.confidence !== 'derived') problems.push(`provenance[${i}] computation ref must be "derived"`);
      } else problems.push(`provenance[${i}].kind "${s.kind}" unknown`);
    });
    if (env.value === null || env.value === undefined) {
      if (!env.refusal) problems.push('null value without a refusal');
      else {
        if (!REFUSAL_CODES.includes(env.refusal.code)) problems.push(`refusal.code "${env.refusal.code}" invalid`);
        if (typeof env.refusal.reason !== 'string' || !env.refusal.reason.trim()) problems.push('refusal.reason empty');
        if (typeof env.refusal.what_would_help !== 'string' || !env.refusal.what_would_help.trim()) problems.push('refusal.what_would_help empty');
      }
      if ((env.provenance || []).length && env.confidence !== confidenceMin(env.provenance)) problems.push('refusal confidence is not the weakest provenance');
    } else {
      if (env.refusal) problems.push('a value envelope must not carry a refusal');
      if (!(env.provenance || []).length) problems.push('value envelope needs non-empty provenance');
      else if (env.confidence !== confidenceMin(env.provenance)) problems.push(`confidence "${env.confidence}" is not the weakest provenance (${confidenceMin(env.provenance)})`);
      const mixed = (env.provenance || []).length > 1 || new Set((env.provenance || []).map((s) => s.confidence)).size > 1;
      walk(env.value, 'value', (v, path) => {
        if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`non-finite number at ${path}`);
        if (isQuantity(v)) {
          if (mixed) {
            if (!CONFIDENCES.includes(v.confidence)) problems.push(`quantity at ${path} lacks confidence`);
            if (!Array.isArray(v.sourceIds) || !v.sourceIds.length) problems.push(`quantity at ${path} lacks sourceIds`);
          }
          (v.sourceIds || []).forEach((id) => {
            if (!ids.has(id)) problems.push(`quantity at ${path} cites unknown source "${id}"`);
          });
        }
      });
    }
    return problems;
  }
  function isQuantity(v) {
    return v !== null && typeof v === 'object' && typeof v.value === 'number' && typeof v.units === 'string';
  }
  function walk(v, path, visit) {
    visit(v, path);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, visit));
    else if (v !== null && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], `${path}.${k}`, visit));
  }

  return {
    KERNEL_VERSION,
    CODE_PATH,
    DEFAULT_TOLERANCE_MS,
    TOLERANCE_SOURCE,
    TIERS: TIERS.map((t) => ({ key: t.key, label: t.label, detail: t.detail, vTipPath: t.vTipPath })),
    READINGS: Object.keys(READINGS),
    REFUSAL_CODES: REFUSAL_CODES.slice(),
    CONFIDENCES: CONFIDENCES.slice(),
    readConstants,
    readAster,
    create,
    validateEnvelope,
    confidenceMin,
    formatSpeedDiff,
    signedSpeedDiff,
    isoDate,
  };
});
