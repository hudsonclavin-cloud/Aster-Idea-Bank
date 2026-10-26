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
// Validity [Certain, checked by the exact integration below]: the closed forms are the t -> 0
// limit. Every half-window the kernel returns is held to at most 4 % of a rotation (omega t <=
// 0.25 rad), where they agree with the exact two-body scene to 0.3 %; beyond that it refuses.
//
// What the rigid rotor leaves out, and where it is handled: the gravity-gradient modulation of the
// spin is computed separately (kernel.modulation, a rigid line body librating on a circular orbit,
// checked against the twin's golden run); it does not change the scene at the catch, only which
// speed the tip has at the vertical, which is an open convention question about v_tip. Tether
// elasticity, atmosphere at the tip altitude, grapple reach, reel dynamics and any vehicle not at
// apex are stated, not computed.
//
// Every tether number comes from the SKYHOOK_CANON object that build-data.mjs derives from the
// snapshots (params/rev_a.json, physics/skyhook_physics.py, tools/twin/golden.json). The only
// constants typed here are Earth's rotation period and radii from a cited NASA reference, used
// solely for the Earth-rotation convention comparison, and the two scope bounds named below.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatchWindow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KERNEL_VERSION = '1.1.0';

  // External reference values, NOT from Skyhook's canon. Source: NASA NSSDC Earth Fact Sheet,
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html (rows quoted verbatim), read
  // 2026-10-26. [Likely]: a published reference value at the figures given, verified by fetch.
  const EARTH_REF = Object.freeze({
    siderealRotationPeriodHours: 23.9345, // "Sidereal rotation period (hrs)"
    equatorialRadiusKm: 6378.137, // "Equatorial radius (km)"
    volumetricMeanRadiusKm: 6371.0, // "Volumetric mean radius (km)"
    reference: 'NASA NSSDC Earth Fact Sheet',
    read: '2026-10-26',
    source: 'NASA NSSDC Earth Fact Sheet, nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html, read 2026-10-26',
  });
  const OMEGA_EARTH = (2 * Math.PI) / (EARTH_REF.siderealRotationPeriodHours * 3600); // rad/s

  // Validity envelope of the "ballistic vehicle" idealisation: below this tip altitude a vehicle at
  // 4.6 km/s is not ballistic (drag), and the page says so instead of extrapolating. The 150 km
  // figure is a scope choice of this prototype, not a Skyhook number.
  const ATMOSPHERE_CLEAR_KM = 150;

  // Scope bounds of the closed forms, both choices of this prototype (not Skyhook numbers):
  // a half-length of at least 1 km, and no half-window longer than 4 % of a rotation. At 4 % the
  // exact two-body integration and the closed forms differ by at most 0.3 % (tested for 2.5 and
  // 3.5 km/s at L = 10 to 600 km), an order of magnitude below the v_tip convention question.
  const MIN_HALF_LENGTH_KM = 1;
  const CLOSED_FORM_MAX_ROTATION_FRACTION = 0.04;

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
    if (!isNum(halfLengthKm) || halfLengthKm <= 0) return refusal('out_of_envelope', `Half-length must be a positive number of km (got ${String(halfLengthKm)}).`, `Set the half-length between ${MIN_HALF_LENGTH_KM} km and the CoM altitude.`);
    if (halfLengthKm < MIN_HALF_LENGTH_KM) return refusal('out_of_envelope', `A half-length of ${halfLengthKm} km is below this kernel's ${MIN_HALF_LENGTH_KM} km minimum: a tether that short is not a catch geometry the closed forms were checked for.`, `Set the half-length between ${MIN_HALF_LENGTH_KM} km and the CoM altitude.`);
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
    const periodS = (2 * Math.PI * L) / vTip;
    const vInertial = vOrb - vTip; // lower tip at the bottom, prograde equatorial orbit assumed
    // Three Earth-relative speeds, all for a prograde equatorial orbit (rev_a.json states no
    // inclination; EQ-3a's subtraction of the full equatorial speed assumes the same):
    const coRotTip = C.omegaEarth * rTip; // co-rotation speed of the Earth-fixed frame at the tip radius
    const coRotEq = C.omegaEarth * C.earthRef.equatorialRadiusKm * 1e3; // equatorial surface speed
    const rEarth = C.earthRadiusKm * 1e3;
    return {
      ok: true,
      vTipKms,
      halfLengthKm,
      rComKm,
      rTipKm: rTip / 1e3,
      tipAltitudeKm,
      omega, // rad/s, inertial spin rate
      periodS,
      periodMin: periodS / 60,
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
      vTipInertialBottom: vInertial, // m/s, inertial speed of the lower tip at the bottom
      vUpperInertialTop: vOrb + vTip,
      // EQ-3a (the file's v_lower_tip_groundrel_kms): inertial speed minus the equatorial SURFACE
      // speed. Launch-site bookkeeping: what a vehicle launched from the equator still has to add.
      eq3a: { speed: vInertial - C.earthRotKmsEq3a * 1e3, coRotation: C.earthRotKmsEq3a * 1e3, convention: 'EQ-3a: inertial speed minus the equatorial surface speed (physics/skyhook_physics.py v_earth_rot), launch-site bookkeeping' },
      // The tip's velocity relative to the rotating Earth at its own radius: the physically
      // ground-relative velocity, and also its airspeed in a co-rotating atmosphere.
      earthFixed: { speed: vInertial - coRotTip, coRotation: coRotTip, convention: 'velocity in the Earth-fixed frame at the tip radius (= airspeed in a co-rotating atmosphere), omega_E * r_tip subtracted' },
      // The speed of the point beneath the tip across the ground (ground track), on the module's R_EARTH_KM.
      subPoint: { speed: (vInertial / rTip - C.omegaEarth) * rEarth, radiusKm: C.earthRadiusKm, convention: 'ground-track (sub-point) speed, (v / r_tip - omega_E) * R_E' },
      coRotationEquatorSurface: coRotEq,
      validity: {
        tipAboveGround: tipAltitudeKm > 0,
        atmosphereClear: tipAltitudeKm >= C.atmosphereClearKm,
        atmosphereClearKm: C.atmosphereClearKm,
        closedFormMaxHalfWindowS: CLOSED_FORM_MAX_ROTATION_FRACTION * periodS,
        closedFormMaxRotationFraction: CLOSED_FORM_MAX_ROTATION_FRACTION,
        notes: [
          'rigid rotor at the catch: the spin modulation only sets which speed the tip has at the vertical (see modulation)',
          'vehicle exactly at apex, matched at t = 0; off-apex and climbing arcs are out of scope',
          'no atmosphere, no grapple reach, no reel dynamics',
        ],
      },
    };
  }

  // The closed forms hold only while the half-window is a small part of a rotation. When the caller
  // passes the bound (kin.validity.closedFormMaxHalfWindowS), a longer half-window is refused.
  function beyondClosedForm(halfS, maxHalfS, what) {
    if (!isNum(maxHalfS) || halfS <= maxHalfS) return null;
    const pct = Math.round(CLOSED_FORM_MAX_ROTATION_FRACTION * 100);
    return refusal(
      'out_of_envelope',
      `${what} is ±${halfS.toPrecision(3)} s, longer than ±${maxHalfS.toPrecision(3)} s (${pct} % of this tether's ${((maxHalfS / CLOSED_FORM_MAX_ROTATION_FRACTION)).toFixed(0)} s rotation). There the tip has swung far enough from the vertical that a_rel t²/2 is no longer the motion, and this page does not extrapolate.`,
      'Use a smaller envelope, tolerance or held window, or a longer tether (a slower rotation).'
    );
  }

  function passive(args) {
    const { aRel, envelopeM, velTolMps, maxHalfWindowS } = args || {};
    if (!isNum(aRel) || aRel <= 0) return refusal('out_of_envelope', 'Relative acceleration must be positive.', 'Compute kinematics first.');
    if (!isNum(envelopeM) || envelopeM <= 0) return refusal('out_of_envelope', `The capture envelope must be a positive number of metres (got ${String(envelopeM)}).`, 'Set the envelope half-width, for example the founding document’s ±10 m.');
    if (!isNum(velTolMps) || velTolMps <= 0) return refusal('out_of_envelope', `The velocity tolerance must be a positive number of m/s (got ${String(velTolMps)}).`, 'Set the tolerance, for example the founding document’s ~1 m/s.');
    const tPos = Math.sqrt((2 * envelopeM) / aRel);
    const tVel = velTolMps / aRel;
    const tooLong = beyondClosedForm(tPos, maxHalfWindowS, `The passive window inside ±${envelopeM} m`) || beyondClosedForm(tVel, maxHalfWindowS, `The passive window inside ±${velTolMps} m/s`);
    if (tooLong) return tooLong;
    const tBoth = Math.min(tPos, tVel);
    const bestTotal = 4 * Math.sqrt(envelopeM / aRel);
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
      // its half-span is sqrt(2) t_pos, so it can pass the closed-form bound before t_pos does
      bestPassive: { totalS: bestTotal, edgeSpeedMps: 2 * Math.sqrt(aRel * envelopeM), withinClosedForm: !isNum(maxHalfWindowS) || bestTotal / 2 <= maxHalfWindowS },
    };
  }

  // What a passive window of total duration T would need: envelope and the speed at its edge.
  function needs(args) {
    const { aRel, totalS, maxHalfWindowS } = args || {};
    if (!isNum(aRel) || aRel <= 0 || !isNum(totalS) || totalS <= 0) return refusal('out_of_envelope', 'Need a positive relative acceleration and window.', 'Give a positive window in seconds.');
    const half = totalS / 2;
    const tooLong = beyondClosedForm(half, maxHalfWindowS, `A ${totalS} s window`);
    if (tooLong) return tooLong;
    return { ok: true, totalS, envelopeM: 0.5 * aRel * half * half, edgeSpeedMps: aRel * half };
  }

  // Holding station with the tip for T seconds: the vehicle must supply a_rel the whole time.
  // The reel columns are the same kinematics paid by a line from the tip instead of by the vehicle.
  // vGroundRel is the catch speed the Δv is compared with: EQ-3a's figure, the file's convention.
  function held(args) {
    const { aRel, holdS, vGroundRel, maxHalfWindowS } = args || {};
    if (!isNum(aRel) || aRel <= 0) return refusal('out_of_envelope', 'Relative acceleration must be positive.', 'Compute kinematics first.');
    if (!isNum(holdS) || holdS <= 0) return refusal('out_of_envelope', `The hold time must be a positive number of seconds (got ${String(holdS)}).`, 'Set the window, for example 3 or 10 s from docs/project_instructions.md §4.3.');
    const half = holdS / 2;
    const tooLong = beyondClosedForm(half, maxHalfWindowS, `A held window of ${holdS} s`);
    if (tooLong) return tooLong;
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

  // ------------------------------------------------------------------ spin modulation
  // [Likely] A rigid line body (any mass distribution along the line) on a circular orbit pitches
  // under the gravity gradient as  theta'' = -(3/2) Omega^2 sin(2 theta),  theta measured in the
  // orbit frame from the local vertical (the standard planar gravity-gradient pitch equation, known
  // here from secondary sources). Its energy integral is
  //     theta'^2 = theta_v'^2 - 3 Omega^2 sin^2(theta),
  // so the spin is fastest at the vertical, the catch [Certain within the model]. The tip speed
  // relative to the CoM, in the inertial frame, is v = L (theta' + Omega). Over one orbit-frame
  // rotation the time mean of theta' is 2 pi / T with T = (4 / theta_v') K(k), k^2 = 3 Omega^2 /
  // theta_v'^2, i.e. mean theta' = theta_v' * AGM(1, sqrt(1 - k^2)). One modulation cycle is half an
  // orbit-frame rotation. Checked against the twin's golden run in the tests.
  function agm(a, b) {
    let x = a;
    let y = b;
    for (let i = 0; i < 64 && Math.abs(x - y) > 1e-16 * x; i++) {
      const m = (x + y) / 2;
      y = Math.sqrt(x * y);
      x = m;
    }
    return x;
  }

  function makeLibration(C, kin) {
    const R = kin.rComKm * 1e3;
    const L = kin.halfLengthKm * 1e3;
    const Om = Math.sqrt(C.mu / (R * R * R));
    const k2 = (thdV) => (3 * Om * Om) / (thdV * thdV);
    const meanThetaDot = (thdV) => thdV * agm(1, Math.sqrt(1 - k2(thdV)));
    const speedAtVertical = (thdV) => L * (thdV + Om);
    const meanSpeed = (thdV) => L * (meanThetaDot(thdV) + Om);
    // the orbit-frame spin at the vertical that makes the rotation-mean tip speed equal v (bisection)
    function thetaDotForMean(v) {
      let lo = v / L - Om; // the mean is below the vertical value, so the answer is above this
      let hi = Math.sqrt(lo * lo + 3 * Om * Om); // its slowest point is at least lo, so the mean is too
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (meanSpeed(mid) < v) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    // integrate the pitch equation from the vertical (theta = 0), sampling like run_measuring: the
    // mean of the speed after each step
    function integrate(thdV, durationS, dtS, sampleTimesS) {
      const n = Math.max(1, Math.round(durationS / dtS));
      const h = durationS / n;
      const f = (th, w) => [w, -1.5 * Om * Om * Math.sin(2 * th)];
      let th = 0;
      let w = thdV;
      let sumV = 0;
      let sumA = 0;
      const want = (sampleTimesS || []).map((t) => ({ t, step: Math.round(t / h) }));
      const samples = [];
      for (const s of want) if (s.step === 0) samples.push({ t: 0, speed: speedAtVertical(thdV), thetaDeg: 0 });
      for (let i = 1; i <= n; i++) {
        const k1 = f(th, w);
        const k2v = f(th + (h / 2) * k1[0], w + (h / 2) * k1[1]);
        const k3 = f(th + (h / 2) * k2v[0], w + (h / 2) * k2v[1]);
        const k4 = f(th + h * k3[0], w + h * k3[1]);
        th += (h / 6) * (k1[0] + 2 * k2v[0] + 2 * k3[0] + k4[0]);
        w += (h / 6) * (k1[1] + 2 * k2v[1] + 2 * k3[1] + k4[1]);
        const v = L * (w + Om);
        sumV += v;
        sumA += (v * v) / L;
        for (const s of want) if (s.step === i) samples.push({ t: s.t, speed: v, thetaDeg: (th * 180) / Math.PI });
      }
      return { meanSpeed: sumV / n, meanCentripetal: sumA / n, samples };
    }
    return { orbitalRate: Om, meanThetaDot, speedAtVertical, meanSpeed, thetaDotForMean, integrate, k2 };
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
      const maxHalfWindowS = kin.validity.closedFormMaxHalfWindowS;
      const pas = passive({ aRel: kin.aRel, envelopeM: inp.envelopeM, velTolMps: inp.velTolMps, maxHalfWindowS });
      if (!pas.ok) return pas;
      const hold = held({ aRel: kin.aRel, holdS: inp.holdS, vGroundRel: kin.eq3a.speed, maxHalfWindowS });
      if (!hold.ok) return hold;
      const reqs = Array.isArray(inp.requirementWindowsS) ? inp.requirementWindowsS : [];
      // a requirement window beyond the closed form's range comes back as a refusal in its own slot
      const requirement = reqs.map((T) => ({ totalS: T, passive: needs({ aRel: kin.aRel, totalS: T, maxHalfWindowS }), held: held({ aRel: kin.aRel, holdS: T, vGroundRel: kin.eq3a.speed, maxHalfWindowS }) }));
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
        const p = passive({ aRel: k.aRel, envelopeM: a.envelopeM, velTolMps: a.velTolMps, maxHalfWindowS: k.validity.closedFormMaxHalfWindowS });
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
      const p = passive({ aRel: k.aRel, envelopeM: a.envelopeM, velTolMps: a.velTolMps, maxHalfWindowS: k.validity.closedFormMaxHalfWindowS });
      if (!p.ok) return p;
      return { ok: true, atHalfLengthKm: comAltKm, aRel: k.aRel, totalPos: p.totalPos, totalVel: p.totalVel, tPos: p.tPos, tVel: p.tVel };
    };

    kernel.tierTable = (args) => {
      const a = args || {};
      return C.tierOrder.map((key) => {
        const t = C.tiers[key];
        const k = kinematicsFrom(C, { vTipKms: t.vTipKms, halfLengthKm: a.halfLengthKm, rComKm: a.rComKm });
        if (!k.ok) return { key, label: t.label, short: t.short, vTipKms: t.vTipKms, refusal: k.refusal };
        const maxHalfWindowS = k.validity.closedFormMaxHalfWindowS;
        const p = passive({ aRel: k.aRel, envelopeM: a.envelopeM, velTolMps: a.velTolMps, maxHalfWindowS });
        if (!p.ok) return { key, label: t.label, short: t.short, vTipKms: t.vTipKms, refusal: p.refusal };
        const h = held({ aRel: k.aRel, holdS: a.holdS, vGroundRel: k.eq3a.speed, maxHalfWindowS });
        if (!h.ok) return { key, label: t.label, short: t.short, vTipKms: t.vTipKms, refusal: h.refusal };
        // the file states tip_acceleration_g only at its own half-length; elsewhere there is nothing to reconcile with
        const atCanonL = k.halfLengthKm === C.halfLengthKm;
        const stated = Object.assign({}, t.stated, atCanonL ? {} : { tipAccelG: null });
        return { key, label: t.label, short: t.short, vTipKms: t.vTipKms, stated, statedTipAccelAtCanonLOnly: !atCanonL, kin: k, passive: p, held: h };
      });
    };

    // Which speed is v_tip? The gravity gradient makes the tip fastest at the vertical (the catch)
    // and slowest at the horizontal. Read as the speed at the vertical (the twin's initial
    // condition), the kinematics above stand. Read as the rotation mean (physics/tether_dynamics.py
    // run_measuring docstring), the tip passes the vertical faster and a_rel is higher. This returns
    // both, for any tier and half-length, from the libration model, plus the golden-run check where
    // the twin's configuration is the one selected.
    kernel.modulation = (opts) => {
      const o = opts || {};
      const kin = kinematicsFrom(C, { vTipKms: o.vTipKms === undefined ? C.tiers.reference.vTipKms : o.vTipKms, halfLengthKm: o.halfLengthKm, rComKm: o.rComKm });
      if (!kin.ok) return kin;
      const lib = makeLibration(C, kin);
      const Om = lib.orbitalRate;
      const L = kin.halfLengthKm * 1e3;
      const v = kin.vTipKms * 1e3;
      const thdA = v / L - Om; // orbit-frame spin at the vertical if v_tip is the speed there
      if (!(thdA * thdA > 3 * Om * Om)) {
        return refusal('out_of_envelope', 'At this tip speed and half-length the spin is too slow to carry the tether through the horizontal against the gravity gradient: it would librate, not rotate, and has no rotation mean.', 'Use a faster tip speed or a shorter tether.');
      }
      const vMeanA = lib.meanSpeed(thdA);
      const vHorizA = L * (Math.sqrt(thdA * thdA - 3 * Om * Om) + Om);
      const thdB = lib.thetaDotForMean(v);
      const vVertB = lib.speedAtVertical(thdB);
      const aRelAt = (vv) => (vv * vv) / L - kin.gHub + kin.gTip;
      const aA = kin.aRel;
      const aB = aRelAt(vVertB);
      const orbitFrameRotationS = (2 * Math.PI) / lib.meanThetaDot(thdA);
      let golden = null;
      const g = C.golden;
      if (g && g.meta && g.meta.config && isNum(g.mean_tip_speed_mps)) {
        const cfg = g.meta.config;
        const applicable =
          cfg.gravity === true && cfg.v_tip_kms === kin.vTipKms && cfg.half_length_km === kin.halfLengthKm && Math.abs(cfg.com_altitude_km - (kin.rComKm - C.earthRadiusKm)) < 1e-9;
        golden = {
          applicable,
          config: { vTipKms: cfg.v_tip_kms, halfLengthKm: cfg.half_length_km, comAltitudeKm: cfg.com_altitude_km, nNodes: cfg.n_nodes },
          durationS: g.meta.duration_s,
          meanTipSpeedMps: g.mean_tip_speed_mps,
          meanCentripetalMps2: g.mean_tip_centripetal_accel_mps2,
        };
        if (applicable) {
          // the twin's 600 s is not a whole number of rotations or modulation cycles, so its mean is a
          // 600 s mean, not a rotation mean; the model reproduces it over the same 600 s
          golden.rotationsCovered = g.meta.duration_s / kin.periodS;
          golden.modulationCyclesCovered = g.meta.duration_s / (orbitFrameRotationS / 2);
          golden.model = lib.integrate(thdA, g.meta.duration_s, g.meta.dt, g.meta.checkpoints_s);
        }
      }
      return {
        ok: true,
        vTipKms: kin.vTipKms,
        halfLengthKm: kin.halfLengthKm,
        orbitalRate: Om,
        orbitFrameRotationS,
        modulationPeriodS: orbitFrameRotationS / 2,
        // if v_tip is the speed at the vertical (as this page's kinematics take it)
        vertical: { vAtVerticalMps: v, rotationMeanMps: vMeanA, atHorizontalMps: vHorizA, aRel: aA },
        peakToTroughFraction: (v - vHorizA) / v,
        meanBelowVerticalFraction: 1 - vMeanA / v,
        // if v_tip is the rotation mean
        mean: { vAtVerticalMps: vVertB, rotationMeanMps: lib.meanSpeed(thdB), aRel: aB },
        aRelRange: [aA, aB],
        aRelIncreaseFraction: aB / aA - 1,
        envelopeWindowShorteningFraction: 1 - Math.sqrt(aA / aB),
        velocityWindowShorteningFraction: 1 - aA / aB,
        golden,
        libration: lib,
      };
    };

    return kernel;
  }

  return { create, refusal, passive, needs, held, timeline, EARTH_REF, OMEGA_EARTH, ATMOSPHERE_CLEAR_KM, MIN_HALF_LENGTH_KM, CLOSED_FORM_MAX_ROTATION_FRACTION, KERNEL_VERSION };
});
