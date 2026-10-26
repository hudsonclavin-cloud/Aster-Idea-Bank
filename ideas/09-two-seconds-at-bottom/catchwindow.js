// Two Seconds at the Bottom — the catch-window kernel. Pure: no DOM, no clock, no randomness.
// Loads as a classic script (window.CatchWindow) and via require() for the Node tests.
//
// Model [Certain for the equations, Likely as a description of the Rev A tether]:
//   a rigid rotor of half-length L spinning at omega = v_tip / L (inertial) about a centre of mass
//   on a circular orbit of radius R; a passive ("ballistic") vehicle exactly at the apex of its
//   arc, matched to the lower tip in position and velocity at the bottom of the swing (t = 0).
//   Both then move under point-mass gravity mu / r^2.
//
//   Tip inertial acceleration at the bottom, radially outward positive:  omega^2 L - mu / R^2
//   Vehicle inertial acceleration at the same point:                      - mu / (R - L)^2
//   Relative acceleration (tip minus vehicle), radial:
//       a_rel = v_tip^2 / L - mu / R^2 + mu / (R - L)^2
//   So the vehicle falls away from the tip:  separation = a_rel t^2 / 2,  relative speed = a_rel t.
//   Passive window inside a position envelope +-e:            |t| <= sqrt(2 e / a_rel)
//   Passive window inside a velocity tolerance +-v_tol:       |t| <= v_tol / a_rel
//   To track the tip instead, the vehicle must thrust at a_rel for the whole window: dv = a_rel T.
//
// What the model leaves out (stated, not computed): the gravity-gradient modulation of the spin
// (~+-1.5 % in tip speed per the twin's golden run; see modulationCaveat), tether elasticity,
// atmosphere at the tip altitude, grapple reach and reel dynamics, and any vehicle not at apex.
//
// Every tether number comes from the SKYHOOK_CANON object that build-data.mjs derives from the
// snapshots (params/rev_a.json, physics/skyhook_physics.py, tools/twin/golden.json). The only
// constants typed here are Earth's rotation period and radii from a cited NASA reference, used
// solely for the Earth-rotation convention comparison.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatchWindow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KERNEL_VERSION = '1.0.0';

  // External reference values, NOT from Skyhook's canon. Source: NASA NSSDC Earth Fact Sheet,
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html (rows quoted verbatim), read
  // 2026-10-26. [Likely]: a published reference value at the figures given, verified by fetch.
  const EARTH_REF = Object.freeze({
    siderealRotationPeriodHours: 23.9345, // "Sidereal rotation period (hrs)"
    equatorialRadiusKm: 6378.137, // "Equatorial radius (km)"
    volumetricMeanRadiusKm: 6371.0, // "Volumetric mean radius (km)"
    source: 'NASA NSSDC Earth Fact Sheet, nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html, read 2026-10-26',
  });
  const OMEGA_EARTH = (2 * Math.PI) / (EARTH_REF.siderealRotationPeriodHours * 3600); // rad/s

  // Validity envelope of the "ballistic vehicle" idealisation: below this tip altitude a vehicle at
  // 4.6 km/s is not ballistic (drag), and the page says so instead of extrapolating. The 150 km
  // figure is a scope choice of this prototype, not a Skyhook number.
  const ATMOSPHERE_CLEAR_KM = 150;

  // ------------------------------------------------------------------ refusals
  function refusal(code, reason, whatWouldHelp) {
    return { ok: false, refusal: { code, reason, what_would_help: whatWouldHelp } };
  }
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  function get(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // ------------------------------------------------------------------ canon
  // Reads what the kernel needs out of the derived SKYHOOK_CANON object and names the key of
  // anything missing. Nothing physical is defaulted.
  function create(canon) {
    if (!canon || typeof canon !== 'object' || !canon.revA) {
      return refusal(
        'not_found',
        'The Skyhook canon snapshot (snapshots/canon.data.js, derived from params/rev_a.json) is not loaded.',
        'Run build-data.mjs to regenerate snapshots/canon.data.js from the snapshots and open the page with it beside index.html.'
      );
    }
    const need = [
      ['orbital.mu_earth_m3s2', 'mu'],
      ['orbital.com_altitude_km', 'comAltitudeKm'],
      ['orbital.com_radius_km', 'comRadiusKmStated'],
      ['orbital.v_orb_kms', 'vOrbKmsStated'],
      ['geometry.tether_half_length_km', 'halfLengthKm'],
      ['geometry.rotation_period_min', 'rotationPeriodMinStated'],
      ['kinematics.v_tip_kms', 'vTipReference'],
      ['kinematics.v_lower_tip_groundrel_kms', 'groundrelReferenceStated'],
      ['kinematics.tip_acceleration_g', 'tipAccelReferenceStated'],
      ['kinematics.cislunar_revenue_gated_option.v_tip_kms', 'vTipCislunar'],
      ['kinematics.cislunar_revenue_gated_option.tip_acceleration_g', 'tipAccelCislunarStated'],
      ['kinematics.phase3_growth_option.v_tip_kms', 'vTipPhase3'],
      ['kinematics.phase3_growth_option.v_lower_tip_groundrel_kms', 'groundrelPhase3Stated'],
      ['kinematics.phase3_growth_option.tip_acceleration_g', 'tipAccelPhase3Stated'],
    ];
    const v = {};
    for (const [key, name] of need) {
      const x = get(canon.revA, key);
      if (!isNum(x)) {
        return refusal('not_found', `params/rev_a.json has no numeric "${key}".`, `Add or restore "${key}" in Skyhook params/rev_a.json and re-snapshot.`);
      }
      v[name] = x;
    }
    const pm = canon.physicsModule || {};
    for (const k of ['R_EARTH_KM', 'G_STD', 'v_earth_rot_kms']) {
      if (!pm[k] || !isNum(pm[k].value)) {
        return refusal('not_found', `physics/skyhook_physics.py constant ${k} was not found in the snapshot.`, 'Re-run build-data.mjs against a snapshot of physics/skyhook_physics.py that defines it.');
      }
    }
    if (v.halfLengthKm >= v.comAltitudeKm) {
      return refusal('out_of_envelope', 'The canon half-length is not below the CoM altitude: the lower tip would be underground.', 'Check geometry.tether_half_length_km against orbital.com_altitude_km.');
    }

    const prov = canon.revAProvenance || {};
    const constants = {
      revision: get(canon.revA, '_meta.revision'),
      mu: v.mu, // m^3/s^2
      comAltitudeKm: v.comAltitudeKm,
      earthRadiusKm: pm.R_EARTH_KM.value, // physics/skyhook_physics.py R_EARTH_KM
      rComKm: pm.R_EARTH_KM.value + v.comAltitudeKm, // the radius the module, the twin and the file's own C3 notes use
      comRadiusKmStated: v.comRadiusKmStated, // the file's orbital.com_radius_km (differs: see findings)
      vOrbKmsStated: v.vOrbKmsStated,
      halfLengthKm: v.halfLengthKm,
      rotationPeriodMinStated: v.rotationPeriodMinStated,
      g0: pm.G_STD.value,
      earthRotKmsEq3a: pm.v_earth_rot_kms.value, // EQ-3a's literal, km/s "at equator"
      omegaEarth: OMEGA_EARTH,
      earthRef: EARTH_REF,
      atmosphereClearKm: ATMOSPHERE_CLEAR_KM,
      tierOrder: ['reference', 'cislunar', 'phase3'],
      tiers: {
        reference: {
          key: 'reference',
          label: 'Reference (GTO / high-elliptical)',
          short: 'Reference',
          vTipKms: v.vTipReference,
          sourceKey: 'kinematics.v_tip_kms',
          stated: { groundrelKms: v.groundrelReferenceStated, tipAccelG: v.tipAccelReferenceStated, rotationPeriodMin: v.rotationPeriodMinStated },
        },
        cislunar: {
          key: 'cislunar',
          label: 'Cislunar, revenue-gated',
          short: 'Cislunar',
          vTipKms: v.vTipCislunar,
          sourceKey: 'kinematics.cislunar_revenue_gated_option.v_tip_kms',
          stated: { groundrelKms: null, tipAccelG: v.tipAccelCislunarStated, rotationPeriodMin: null },
        },
        phase3: {
          key: 'phase3',
          label: 'Phase 3 growth (Mars-class)',
          short: 'Phase 3',
          vTipKms: v.vTipPhase3,
          sourceKey: 'kinematics.phase3_growth_option.v_tip_kms',
          stated: { groundrelKms: v.groundrelPhase3Stated, tipAccelG: v.tipAccelPhase3Stated, rotationPeriodMin: null },
        },
      },
      sources: {
        revA: { path: prov.path, commit: prov.commit, commitDate: prov.commitDate, sha256: prov.sourceSha256 },
        physicsModule: {
          path: pm.path,
          commit: pm.commit,
          R_EARTH_KM: pm.R_EARTH_KM,
          G_STD: pm.G_STD,
          v_earth_rot_kms: pm.v_earth_rot_kms,
        },
        golden: canon.golden ? { path: canon.golden.path, commit: canon.golden.commit } : null,
      },
      golden: canon.golden || null,
    };
    return makeKernel(constants);
  }

  // ------------------------------------------------------------------ physics
  function kinematicsFrom(C, opts) {
    const o = opts || {};
    const vTipKms = o.vTipKms;
    const halfLengthKm = o.halfLengthKm === undefined ? C.halfLengthKm : o.halfLengthKm;
    const rComKm = o.rComKm === undefined ? C.rComKm : o.rComKm;
    if (!isNum(vTipKms) || vTipKms <= 0) return refusal('out_of_envelope', `Tip speed must be a positive number of km/s (got ${String(vTipKms)}).`, 'Pick a tier from the canon or give a positive tip speed.');
    if (!isNum(halfLengthKm) || halfLengthKm <= 0) return refusal('out_of_envelope', `Half-length must be a positive number of km (got ${String(halfLengthKm)}).`, 'Set the half-length between 1 km and the CoM altitude.');
    if (!isNum(rComKm) || rComKm <= C.earthRadiusKm) return refusal('out_of_envelope', 'The CoM radius must be above the Earth radius.', 'Check orbital.com_altitude_km.');
    const comAltKm = rComKm - C.earthRadiusKm;
    if (halfLengthKm >= comAltKm) {
      return refusal(
        'out_of_envelope',
        `A half-length of ${halfLengthKm} km with the centre of mass at ${comAltKm} km puts the lower tip at or below the ground (tip altitude ${(comAltKm - halfLengthKm).toFixed(0)} km). There is no catch to time.`,
        `Keep the half-length below the CoM altitude of ${comAltKm} km.`
      );
    }
    const L = halfLengthKm * 1e3;
    const R = rComKm * 1e3;
    const vTip = vTipKms * 1e3;
    const rTip = R - L;
    const omega = vTip / L;
    const vOrb = Math.sqrt(C.mu / R);
    const gHub = C.mu / (R * R);
    const gTip = C.mu / (rTip * rTip);
    const aCentripetal = (vTip * vTip) / L;
    const aTipInertial = aCentripetal - gHub; // outward positive
    const aRel = aCentripetal - gHub + gTip;
    const tipAltitudeKm = rTip / 1e3 - C.earthRadiusKm;
    const coRotTip = C.omegaEarth * rTip; // co-rotation speed at the tip radius (airspeed convention)
    const coRotEq = C.omegaEarth * C.earthRef.equatorialRadiusKm * 1e3; // equatorial surface speed
    return {
      ok: true,
      vTipKms,
      halfLengthKm,
      rComKm,
      rTipKm: rTip / 1e3,
      tipAltitudeKm,
      omega, // rad/s, inertial spin rate
      periodMin: (2 * Math.PI * L) / vTip / 60,
      vOrb, // m/s at the CoM radius
      gHub,
      gTip,
      gravityGradient: gTip - gHub,
      gravityGradientLinear: (2 * C.mu * L) / (R * R * R),
      aCentripetal,
      aCentripetalG: aCentripetal / C.g0,
      aTipInertial,
      aRel,
      aRelG: aRel / C.g0,
      vTipInertialBottom: vOrb - vTip, // m/s, inertial speed of the lower tip at the bottom
      vUpperInertialTop: vOrb + vTip,
      groundTrack: { speed: vOrb - vTip - C.earthRotKmsEq3a * 1e3, coRotation: C.earthRotKmsEq3a * 1e3, convention: 'EQ-3a: equatorial surface co-rotation subtracted (physics/skyhook_physics.py v_earth_rot)' },
      airspeed: { speed: vOrb - vTip - coRotTip, coRotation: coRotTip, convention: 'co-rotating atmosphere at the tip radius, omega_E * r_tip' },
      coRotationEquatorSurface: coRotEq,
      validity: {
        tipAboveGround: tipAltitudeKm > 0,
        atmosphereClear: tipAltitudeKm >= C.atmosphereClearKm,
        atmosphereClearKm: C.atmosphereClearKm,
        notes: [
          'rigid rotor: no gravity-gradient spin modulation, no elasticity (see modulationCaveat)',
          'vehicle exactly at apex, matched at t = 0; off-apex and climbing arcs are out of scope',
          'no atmosphere, no grapple reach, no reel dynamics',
        ],
      },
    };
  }

  function passive(args) {
    const { aRel, envelopeM, velTolMps } = args || {};
    if (!isNum(aRel) || aRel <= 0) return refusal('out_of_envelope', 'Relative acceleration must be positive.', 'Compute kinematics first.');
    if (!isNum(envelopeM) || envelopeM <= 0) return refusal('out_of_envelope', `The capture envelope must be a positive number of metres (got ${String(envelopeM)}).`, 'Set the envelope half-width, for example the founding document’s ±10 m.');
    if (!isNum(velTolMps) || velTolMps <= 0) return refusal('out_of_envelope', `The velocity tolerance must be a positive number of m/s (got ${String(velTolMps)}).`, 'Set the tolerance, for example the founding document’s ~1 m/s.');
    const tPos = Math.sqrt((2 * envelopeM) / aRel);
    const tVel = velTolMps / aRel;
    const tBoth = Math.min(tPos, tVel);
    return {
      ok: true,
      aRel,
      envelopeM,
      velTolMps,
      tPos, // half-window, s
      tVel,
      tBoth,
      totalPos: 2 * tPos,
      totalVel: 2 * tVel,
      totalBoth: 2 * tBoth,
      binding: tPos <= tVel ? 'position' : 'velocity',
      speedAtEnvelopeEdge: aRel * tPos, // = sqrt(2 a e)
      separationAtVelTol: (velTolMps * velTolMps) / (2 * aRel),
      // The longest any passive trajectory can stay inside +-e: enter at +e falling, turn at -e, leave at +e.
      bestPassive: { totalS: 4 * Math.sqrt(envelopeM / aRel), edgeSpeedMps: 2 * Math.sqrt(aRel * envelopeM) },
    };
  }

  // What a passive window of total duration T would need: envelope and the speed at its edge.
  function needs(args) {
    const { aRel, totalS } = args || {};
    if (!isNum(aRel) || aRel <= 0 || !isNum(totalS) || totalS <= 0) return refusal('out_of_envelope', 'Need a positive relative acceleration and window.', '');
    const half = totalS / 2;
    return { ok: true, totalS, envelopeM: 0.5 * aRel * half * half, edgeSpeedMps: aRel * half };
  }

  // Holding station with the tip for T seconds: the vehicle must supply a_rel the whole time.
  // The reel columns are the same kinematics paid by a line from the tip instead of by the vehicle.
  function held(args) {
    const { aRel, holdS, vGroundRel } = args || {};
    if (!isNum(aRel) || aRel <= 0) return refusal('out_of_envelope', 'Relative acceleration must be positive.', '');
    if (!isNum(holdS) || holdS <= 0) return refusal('out_of_envelope', `The hold time must be a positive number of seconds (got ${String(holdS)}).`, 'Set the window, for example 3 or 10 s from docs/project_instructions.md §4.3.');
    const half = holdS / 2;
    return {
      ok: true,
      holdS,
      accel: aRel,
      deltaV: aRel * holdS,
      reelExcursionM: 0.5 * aRel * half * half, // line paid in then out over a symmetric window
      reelPeakSpeedMps: aRel * half,
      fractionOfCatchSpeed: isNum(vGroundRel) && vGroundRel > 0 ? (aRel * holdS) / vGroundRel : null,
    };
  }

  function timeline(args) {
    const { aRel, tMaxS, n } = args || {};
    const N = Math.max(2, Math.floor(n || 201));
    const t = [];
    const sep = [];
    const dv = [];
    for (let i = 0; i < N; i++) {
      const ti = -tMaxS + (2 * tMaxS * i) / (N - 1);
      t.push(ti);
      sep.push(0.5 * aRel * ti * ti);
      dv.push(aRel * Math.abs(ti));
    }
    return { t, sep, dv };
  }

  // ------------------------------------------------------------------ exact two-body checks
  // The closed forms above are the t -> 0 limit. These integrate the real thing: the CoM on a
  // circular Kepler orbit, the tip on a rigid rotor about it, the vehicle in point-mass gravity
  // from the matched state. Used by the tests and by the page's "exact check" line.
  function makeExact(C, kin) {
    const mu = C.mu;
    const R = kin.rComKm * 1e3;
    const L = kin.halfLengthKm * 1e3;
    const w = kin.omega;
    const Om = Math.sqrt(mu / (R * R * R)); // orbital angular rate of the CoM
    // Prograde spin: at t = 0 the tether is vertical, lower tip Earthward and moving backward.
    const tipPos = (t) => [R * Math.cos(Om * t) - L * Math.cos(w * t), R * Math.sin(Om * t) - L * Math.sin(w * t)];
    const tipVel = (t) => [-R * Om * Math.sin(Om * t) + L * w * Math.sin(w * t), R * Om * Math.cos(Om * t) - L * w * Math.cos(w * t)];
    const tipAcc = (t) => [-(mu / (R * R)) * Math.cos(Om * t) + w * w * L * Math.cos(w * t), -(mu / (R * R)) * Math.sin(Om * t) + w * w * L * Math.sin(w * t)];
    const grav = (x, y) => {
      const r3 = Math.pow(x * x + y * y, 1.5);
      return [(-mu * x) / r3, (-mu * y) / r3];
    };
    function rk4(s, dt) {
      const f = (q) => {
        const g = grav(q[0], q[1]);
        return [q[2], q[3], g[0], g[1]];
      };
      const k1 = f(s);
      const s2 = s.map((v, i) => v + (dt / 2) * k1[i]);
      const k2 = f(s2);
      const s3 = s.map((v, i) => v + (dt / 2) * k2[i]);
      const k3 = f(s3);
      const s4 = s.map((v, i) => v + dt * k3[i]);
      const k4 = f(s4);
      return s.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
    // Separation and relative speed between tip and a ballistic vehicle matched at t = 0, at time t > 0.
    function passiveAt(tEnd, dt) {
      const h = dt || 0.002;
      const p0 = tipPos(0);
      const v0 = tipVel(0);
      let s = [p0[0], p0[1], v0[0], v0[1]];
      let t = 0;
      const n = Math.max(1, Math.round(tEnd / h));
      const step = tEnd / n;
      for (let i = 0; i < n; i++) {
        s = rk4(s, step);
        t += step;
      }
      const tp = tipPos(t);
      const tv = tipVel(t);
      return { t, sepM: Math.hypot(tp[0] - s[0], tp[1] - s[1]), relSpeedMps: Math.hypot(tv[0] - s[2], tv[1] - s[3]) };
    }
    // First time the separation exceeds e (linear interpolation across the crossing step).
    function passiveExitTime(envelopeM, dt) {
      const h = dt || 0.002;
      const p0 = tipPos(0);
      const v0 = tipVel(0);
      let s = [p0[0], p0[1], v0[0], v0[1]];
      let t = 0;
      let prevSep = 0;
      for (let i = 0; i < 1e6; i++) {
        s = rk4(s, h);
        t += h;
        const tp = tipPos(t);
        const sep = Math.hypot(tp[0] - s[0], tp[1] - s[1]);
        if (sep >= envelopeM) {
          const frac = (envelopeM - prevSep) / (sep - prevSep);
          return t - h + frac * h;
        }
        prevSep = sep;
      }
      return Infinity;
    }
    // Delta-v to track the tip exactly over [-T/2, T/2]: integral of |a_tip - g(tip)| (Simpson).
    function holdDeltaV(T, n) {
      const N = Math.max(2, 2 * Math.ceil((n || 2000) / 2));
      const a = -T / 2;
      const hh = T / N;
      const thrust = (t) => {
        const p = tipPos(t);
        const g = grav(p[0], p[1]);
        const at = tipAcc(t);
        return Math.hypot(at[0] - g[0], at[1] - g[1]);
      };
      let sum = thrust(a) + thrust(a + T);
      for (let i = 1; i < N; i++) sum += (i % 2 ? 4 : 2) * thrust(a + i * hh);
      return { T, deltaV: (sum * hh) / 3, thrustAtMatch: thrust(0), thrustAtEdge: thrust(T / 2) };
    }
    return { tipPos, tipVel, tipAcc, passiveAt, passiveExitTime, holdDeltaV, orbitalRate: Om };
  }

  // ------------------------------------------------------------------ kernel
  function makeKernel(C) {
    const kernel = { ok: true, constants: C, version: KERNEL_VERSION };

    kernel.kinematics = (opts) => kinematicsFrom(C, opts);
    kernel.passive = passive;
    kernel.needs = needs;
    kernel.held = held;
    kernel.timeline = timeline;
    kernel.exact = (kin) => makeExact(C, kin);

    kernel.tier = (key) => C.tiers[key] || null;

    // One call for the page: tier or tip speed, half-length, envelope, tolerance, hold time.
    kernel.evaluate = (inputs) => {
      const inp = inputs || {};
      let vTipKms = inp.vTipKms;
      let tier = null;
      if (inp.tier !== undefined) {
        tier = C.tiers[inp.tier];
        if (!tier) return refusal('not_found', `No tier "${String(inp.tier)}" in params/rev_a.json (have ${C.tierOrder.join(', ')}).`, 'Pick reference, cislunar or phase3.');
        vTipKms = tier.vTipKms;
      }
      const kin = kinematicsFrom(C, { vTipKms, halfLengthKm: inp.halfLengthKm, rComKm: inp.rComKm });
      if (!kin.ok) return kin;
      const pas = passive({ aRel: kin.aRel, envelopeM: inp.envelopeM, velTolMps: inp.velTolMps });
      if (!pas.ok) return pas;
      const hold = held({ aRel: kin.aRel, holdS: inp.holdS, vGroundRel: kin.groundTrack.speed });
      if (!hold.ok) return hold;
      const reqs = Array.isArray(inp.requirementWindowsS) ? inp.requirementWindowsS : [];
      const requirement = reqs.map((T) => ({ totalS: T, passive: needs({ aRel: kin.aRel, totalS: T }), held: held({ aRel: kin.aRel, holdS: T, vGroundRel: kin.groundTrack.speed }) }));
      return { ok: true, tier: tier ? tier.key : null, kin, passive: pas, held: hold, requirement };
    };

    // Passive window against half-length at fixed tip speed, tip kept above the ground.
    kernel.windowVsLength = (args) => {
      const a = args || {};
      const lMin = a.lMinKm === undefined ? 50 : a.lMinKm;
      const lMax = a.lMaxKm === undefined ? C.rComKm - C.earthRadiusKm - 1 : a.lMaxKm;
      const n = Math.max(2, a.n || 57);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const LKm = lMin + ((lMax - lMin) * i) / (n - 1);
        const k = kinematicsFrom(C, { vTipKms: a.vTipKms, halfLengthKm: LKm, rComKm: a.rComKm });
        if (!k.ok) continue;
        const p = passive({ aRel: k.aRel, envelopeM: a.envelopeM, velTolMps: a.velTolMps });
        if (!p.ok) continue;
        pts.push({ LKm, tipAltitudeKm: k.tipAltitudeKm, aRel: k.aRel, tPos: p.tPos, tVel: p.tVel, totalPos: p.totalPos, totalVel: p.totalVel });
      }
      return pts;
    };

    // The longest passive window any half-length allows at this tip speed: the tip at sea level.
    // Beyond it the tip is underground, so this bounds every real geometry from above.
    kernel.passiveCeiling = (args) => {
      const a = args || {};
      const comAltKm = (a.rComKm === undefined ? C.rComKm : a.rComKm) - C.earthRadiusKm;
      const k = kinematicsFrom(C, { vTipKms: a.vTipKms, halfLengthKm: comAltKm - 1e-9, rComKm: a.rComKm });
      if (!k.ok) return k;
      const p = passive({ aRel: k.aRel, envelopeM: a.envelopeM, velTolMps: a.velTolMps });
      if (!p.ok) return p;
      return { ok: true, atHalfLengthKm: comAltKm, aRel: k.aRel, totalPos: p.totalPos, totalVel: p.totalVel, tPos: p.tPos, tVel: p.tVel };
    };

    kernel.tierTable = (args) => {
      const a = args || {};
      return C.tierOrder.map((key) => {
        const t = C.tiers[key];
        const k = kinematicsFrom(C, { vTipKms: t.vTipKms, halfLengthKm: a.halfLengthKm, rComKm: a.rComKm });
        if (!k.ok) return { key, label: t.label, short: t.short, vTipKms: t.vTipKms, refusal: k.refusal };
        const p = passive({ aRel: k.aRel, envelopeM: a.envelopeM, velTolMps: a.velTolMps });
        const h = held({ aRel: k.aRel, holdS: a.holdS, vGroundRel: k.groundTrack.speed });
        return { key, label: t.label, short: t.short, vTipKms: t.vTipKms, stated: t.stated, kin: k, passive: p, held: h };
      });
    };

    // The golden run's mean tip speed is below the rigid-rotor v_tip: the gravity-gradient
    // modulation the glossary names. If the canon's v_tip were the rotation MEAN rather than the
    // bottom-of-swing value, the bottom speed would be higher by the same ratio, and a_rel with it.
    kernel.modulationCaveat = (opts) => {
      const g = C.golden;
      if (!g || !isNum(g.mean_tip_speed_mps)) return refusal('not_found', 'No golden run in the snapshot.', 'Snapshot tools/twin/golden.json.');
      const o = opts || {};
      const kin = kinematicsFrom(C, { vTipKms: o.vTipKms === undefined ? C.tiers.reference.vTipKms : o.vTipKms, halfLengthKm: o.halfLengthKm, rComKm: o.rComKm });
      if (!kin.ok) return kin;
      const vTip = kin.vTipKms * 1e3;
      const goldenVTip = g.meta && g.meta.config ? g.meta.config.v_tip_kms * 1e3 : null;
      const ratio = goldenVTip ? goldenVTip / g.mean_tip_speed_mps : null; // bottom / mean in the twin
      if (!ratio) return refusal('not_found', 'The golden run does not state its v_tip.', 'Check golden.meta.config.v_tip_kms.');
      const vBottomIfMean = vTip * ratio;
      const L = kin.halfLengthKm * 1e3;
      const aRelIfMean = (vBottomIfMean * vBottomIfMean) / L - kin.gHub + kin.gTip;
      return {
        ok: true,
        goldenMeanTipSpeedMps: g.mean_tip_speed_mps,
        goldenVTipMps: goldenVTip,
        meanBelowVTipFraction: 1 - g.mean_tip_speed_mps / goldenVTip,
        goldenMeanCentripetalMps2: g.mean_tip_centripetal_accel_mps2,
        vBottomIfVTipWereMean: vBottomIfMean,
        aRelIfVTipWereMean: aRelIfMean,
        aRelIncreaseFraction: aRelIfMean / kin.aRel - 1,
      };
    };

    return kernel;
  }

  return { create, refusal, passive, needs, held, timeline, EARTH_REF, OMEGA_EARTH, ATMOSPHERE_CLEAR_KM, KERNEL_VERSION };
});
