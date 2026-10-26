// Tip Match — the K2 kernel: can a payload arriving at Earth with hyperbolic excess speed v∞
// be met at a rotating tether's upper tip, and what speed mismatch (trim Δv) would remain?
//
// Pure logic, no DOM. Loads as a classic script (window.TipMatch) and via require() for the
// Node tests and the CLI. Every tether number comes from the rev_a.json snapshot handed to
// create(); nothing is retyped here. Two-body, Earth-centred, instantaneous; energy condition
// only. Plane and phase are structured refusals (Aster EvidenceEnvelope shape, mcp/src/envelope).
//
// Confidence labels follow the Skyhook convention: [Certain] derivable from first principles,
// [Likely] minor modelling assumptions, [Speculative] estimate.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TipMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KERNEL_VERSION = '0.1.0';
  const CODE_PATH = 'ideas/01-tip-match/tip-match.js';
  const CODE_COMMIT = 'uncommitted idea-bank prototype (see README: Where it would land)';
  const REFUSAL_CODES = ['insufficient_data', 'out_of_envelope', 'not_found'];
  const CONFIDENCES = ['measured', 'derived', 'assumed'];
  const RANK = { assumed: 0, derived: 1, measured: 2 };

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
    },
    {
      key: 'cislunar',
      label: 'Cislunar',
      detail: 'revenue-gated option, needs a named anchor customer',
      vTipPath: 'kinematics.cislunar_revenue_gated_option.v_tip_kms',
      statedC3Path: 'kinematics.cislunar_revenue_gated_option.c3_kms2',
      statedApogeePath: 'kinematics.cislunar_revenue_gated_option.apogee_altitude_km',
      statedReleasePath: 'kinematics.cislunar_revenue_gated_option.v_upper_release_kms',
    },
    {
      key: 'phase3',
      label: 'Phase 3',
      detail: 'Mars-class growth option, not the near-term reference',
      vTipPath: 'kinematics.phase3_growth_option.v_tip_kms',
      statedC3Path: 'kinematics.phase3_growth_option.c3_kms2',
      statedApogeePath: null,
      statedReleasePath: 'kinematics.phase3_growth_option.v_upper_release_kms',
    },
  ];

  function getPath(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function isFiniteNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
  }
  function isoDate(d) {
    return (d instanceof Date ? d : new Date()).toISOString().slice(0, 10);
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
    // implies R_E = 6378 and does not reproduce the file's C3; see README Findings.)
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
        rotation_period_min_as_stated: getPath(revA, 'geometry.rotation_period_min'),
        tiers,
        tierOrder: TIERS.map((t) => t.key),
      },
    };
  }

  // ------------------------------------------------------------------ the physics
  // [Certain] Release/catch energy at the upper tip. The tip at the top of its swing moves at
  // v_orb + v_tip, horizontal and prograde (rigid rotation, circular CoM orbit). Its specific
  // energy at r_tip gives C3 = v² − 2μ/r_tip (Skyhook EQ-7, apogee_from_release).
  function tierEnergy(c, tierKey) {
    const t = c.tiers[tierKey];
    if (!t) return null;
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

  // [Certain] Vis-viva on the arrival hyperbola at radius r: v² = v∞² + 2μ/r.
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

  function sourceRefs(sidecar, asOf) {
    const commit = (sidecar && sidecar.commit) || 'unknown';
    const path = (sidecar && sidecar.path) || 'params/rev_a.json';
    return {
      'rev-a-mu': {
        id: 'rev-a-mu',
        kind: 'repo',
        path,
        commit,
        confidence: 'measured',
        note: 'orbital.mu_earth_m3s2 (3.986e14 m³/s²), a measured physical constant; snapshot sha256 ' + ((sidecar && sidecar.sourceSha256) || 'unknown'),
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
        note: 'K1 (Aster return-leg porkchop) would supply this; it has not been built. Aster\'s screening cache carries no Earth-arrival v∞.',
      },
      'tolerance-input': {
        id: 'tolerance-input',
        kind: 'external',
        name: 'Grapple relative-velocity tolerance declared by the user',
        retrieved: asOf,
        confidence: 'assumed',
        note: 'Default 1 m/s is the "~1 m/s at the moment of capture" requirement in Skyhook docs/project_instructions.md:124 (a planning requirement for ascending payloads, not in rev_a.json).',
      },
      'two-body': {
        id: 'two-body',
        kind: 'computation',
        method: 'Earth-centred two-body vis-viva: v_payload = sqrt(v∞² + 2μ/r_tip) at the hyperbola\'s perigee; tip speed v_orb + v_tip with v_orb = sqrt(μ/r_com); trim = v_payload − v_tip_inertial; C3 = v_tip_inertial² − 2μ/r_tip; v∞* = sqrt(C3)',
        code: { path: CODE_PATH, commit: CODE_COMMIT },
        confidence: 'derived',
        note: 'Kernel ' + KERNEL_VERSION,
      },
    };
  }

  const VALIDITY =
    'Two-body, Earth-centred, instantaneous. The payload\'s speed at the upper-tip radius follows from v∞ alone (vis-viva), whatever its perigee; the trim reported is that scalar speed difference, which equals the vector mismatch only when the payload\'s velocity is parallel to the tip\'s, i.e. its perigee is at the upper-tip radius and it moves horizontally and prograde. A lower perigee adds a radial component, so the reported trim is a lower bound on the true velocity mismatch. Tether centre of mass on a circular orbit, rigid rotation, catch at the top of the swing. No J2, drag, lunar perturbation, gravity-gradient spin modulation, tether dynamics, grapple geometry or momentum-ledger effect. Energy condition only: plane and phase are not evaluated here.';

  const ASSUMPTIONS = [
    'Earth radius 6371 km is implied by rev_a.json\'s own r_tip = 7301 km note (kinematics._c3_note) and matches physics/skyhook_physics.py:40; orbital.com_radius_km (6988, implying 6378) is not used because it does not reproduce the file\'s C3 of −8.06 km²/s².',
    'The tip\'s inertial speed is v_orb + v_tip with v_orb evaluated at the centre-of-mass radius, as Skyhook\'s apogee_from_release does; the tip itself is 320 km higher, where a free body would orbit slower, but the tip is not a free body.',
    'The payload is treated as a point mass that does not disturb the tether; catching tonnes at 10 km/s is a tether-dynamics question (Skyhook physics/tether_dynamics.py models only a lower-tip catch of an upbound payload).',
    '"Energy-matched" means |trim Δv| is within the declared grapple tolerance. It is necessary, not sufficient: plane and phase are refused separately.',
  ];

  // ------------------------------------------------------------------ the instance
  function create(revA, sidecar) {
    const read = readConstants(revA);
    const c = read.ok ? read.c : null;

    function energyEnvelope(input) {
      input = input || {};
      const asOf = input.as_of || isoDate();
      const tool = 'tip-match.energy';
      if (!read.ok) return refuse(tool, read.refusal.code, read.refusal.reason, read.refusal.what_would_help, { as_of: asOf });

      const tierKey = input.tier;
      const t = c.tiers[tierKey];
      if (!t) {
        return refuse(tool, 'not_found', `No tier "${tierKey}" in rev_a.json; tiers are ${c.tierOrder.join(', ')}.`, 'Pick one of the tiers rev_a.json defines (kinematics.v_tip_kms and the two options).', { as_of: asOf });
      }
      const vinf = input.vinf_kms;
      if (vinf === undefined || vinf === null || vinf === '') {
        return refuse(tool, 'insufficient_data', 'No Earth-arrival v∞ was given. Aster does not compute one yet (K1, the return-leg porkchop, is CONCEPT), and the screening cache\'s vInfDep/vInfArr are outbound-leg quantities.', 'Build K1 (swap the Lambert endpoints, body → Earth) so an arrival v∞ with provenance exists; until then type one.', { as_of: asOf });
      }
      if (typeof vinf !== 'number' || !Number.isFinite(vinf)) {
        return refuse(tool, 'insufficient_data', `v∞ must be a finite number in km/s; got ${typeof vinf === 'number' ? String(vinf) : JSON.stringify(vinf)}.`, 'A finite, non-negative Earth-arrival hyperbolic excess speed in km/s.', { as_of: asOf });
      }
      if (vinf < 0) {
        return refuse(tool, 'out_of_envelope', `v∞ is a speed and cannot be negative (got ${vinf} km/s).`, 'Enter v∞ ≥ 0 km/s (0 is a parabolic arrival, the slowest a body from beyond Earth\'s sphere of influence can arrive).', { as_of: asOf });
      }
      const tol = input.tolerance_ms === undefined ? 1 : input.tolerance_ms;
      if (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0) {
        return refuse(tool, 'out_of_envelope', `Grapple tolerance must be a finite, non-negative speed in m/s; got ${String(tol)}.`, 'Declare the relative-velocity tolerance the grapple can absorb, in m/s (Skyhook\'s requirement text says ~1 m/s).', { as_of: asOf });
      }

      const refs = sourceRefs(sidecar, asOf);
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
        input: { vinf_kms: Q(vinf, 'km/s', 'assumed', ['vinf-input']) },
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
            ? `energy-matched within ${tol} m/s (plane and phase not evaluated)`
            : `not energy-matched: payload arrives ${Math.abs(trim).toFixed(3)} km/s ${trim > 0 ? 'faster' : 'slower'} than the tip`,
        },
        conditions: [
          { condition: 'energy', status: 'computed' },
          { condition: 'plane', status: 'refused', refusal: planeRefusal() },
          { condition: 'phase', status: 'refused', refusal: phaseRefusal(c) },
        ],
      };

      const provenance = [refs['rev-a-mu'], refs['rev-a-design'], refs['vinf-input'], refs['tolerance-input'], refs['two-body']];
      return {
        envelope_version: '1',
        tool,
        as_of: asOf,
        value,
        confidence: confidenceMin(provenance),
        provenance,
        assumptions: ASSUMPTIONS.slice(),
        validity_envelope: VALIDITY,
      };
    }

    function planeRefusal() {
      return {
        code: 'insufficient_data',
        reason: 'The energy condition says nothing about direction. Meeting the upper tip needs the arrival hyperbola\'s plane to contain the tether\'s velocity at the catch point: the asymptote\'s declination and right ascension against the tether orbit\'s inclination and node. The input here is a scalar v∞; the vector is not supplied, Aster\'s screening cache keeps only scalar vInfDep/vInfArr (src/v2/boundary/lambert-screen-cache.ts:43-49), and rev_a.json states no orbit plane for the tether.',
        what_would_help: 'The Earth-arrival v∞ vector from K1 in ICRF/equatorial with its frame established by measurement (Aster INV-021), plus the tether orbit\'s inclination and RAAN. Then the plane condition is one angle: between the arrival asymptote and the tether\'s orbital angular momentum.',
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
          'Aster\'s Lambert screening cache holds c3, vInfDep and vInfArr per window (src/v2/boundary/lambert-screen-cache.ts:43-49). vInfDep is departure from Earth and vInfArr is arrival at the asteroid, both on the outbound leg. Neither is an Earth-arrival v∞ for a return leg, and presenting one as such would be a fabrication.',
          'K1, the return-leg porkchop (Aster strategy/IDEA_KERNELS_2026-09.md §3 item 2): the same Lambert grid with the endpoints swapped (body → Earth) yields Earth-arrival v∞ with provenance.',
          { as_of: asOf, validity_envelope: 'not evaluated: no such input exists' }
        );
      }
      return refuse('tip-match.vinf-source', 'not_found', `Unknown v∞ source "${source}".`, 'Use "typed" or "aster-cache".', { as_of: asOf });
    }

    return {
      ok: read.ok,
      constants: c,
      refusal: read.ok ? null : read.refusal,
      tierEnergy: (k) => (c ? tierEnergy(c, k) : null),
      speedAtRadius: (v, r) => speedAtRadius(c, v, r),
      zeroTrimTipSpeed: (v) => zeroTrimTipSpeed(c, v),
      energy: energyEnvelope,
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
    TIERS: TIERS.map((t) => ({ key: t.key, label: t.label, detail: t.detail, vTipPath: t.vTipPath })),
    REFUSAL_CODES: REFUSAL_CODES.slice(),
    CONFIDENCES: CONFIDENCES.slice(),
    readConstants,
    create,
    validateEnvelope,
    confidenceMin,
    isoDate,
  };
});
