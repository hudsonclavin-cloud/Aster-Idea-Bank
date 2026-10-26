// wobble.js: the gravity-gradient tip-speed modulation of a spinning Skyhook tether, in closed form.
// Pure: no DOM, no clock, no randomness. Loads as a classic script (window.SpinWobble) for the page
// and with require() for the tests and the Node study. SI units inside (m, s, rad, m^3/s^2).
//
// The model [Certain for the equations, given its assumptions]: a rigid line body (any mass
// distribution along a straight line, hub and payloads included) spinning in the plane of a circular
// orbit. With theta the angle of the tether from the local vertical (measured in the orbiting frame,
// which turns at the orbital rate n = sqrt(mu/R^3)), the gravity-gradient torque to quadrupole order
// gives the pitch equation
//     theta'' = -3 n^2 sin(theta) cos(theta),
// whose first integral is
//     theta'^2 + 3 n^2 sin^2(theta) = C.
// theta' is the spin rate RELATIVE TO THE ORBITING FRAME. The tip's speed relative to the centre of
// mass (what Skyhook's twin measures and what EQ-3 adds to v_orb) uses the INERTIAL rate n + theta':
//     v(theta) = L (n + sqrt(C - 3 n^2 sin^2 theta)),
// with C fixed by the spin-up state: inertial tip speed v0 at angle theta0, so theta'(theta0) =
// v0/L - n and C = (v0/L - n)^2 + 3 n^2 sin^2 theta0.
// Over one modulation period (theta advancing by pi) the time-mean of theta' is the arithmetic-
// geometric mean of its largest and smallest values (Gauss: K(k) = pi / (2 AGM(1, k'))), so the
// rotation-mean tip speed is L (n + AGM(theta'_max, theta'_min)) in closed form.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpinWobble = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var isNum = function (x) { return typeof x === 'number' && isFinite(x); };

  function refusal(code, reason, whatWouldHelp) {
    return { ok: false, refusal: { code: code, reason: reason, what_would_help: whatWouldHelp } };
  }

  // Arithmetic-geometric mean of two positive numbers.
  function agm(a, b) {
    if (!(a > 0 && b > 0)) throw new Error('agm needs two positive numbers');
    for (var i = 0; i < 64; i++) {
      var a1 = 0.5 * (a + b);
      var b1 = Math.sqrt(a * b);
      if (Math.abs(a1 - b1) <= 1e-16 * a1) return 0.5 * (a1 + b1);
      a = a1; b = b1;
    }
    return 0.5 * (a + b);
  }

  // ---------------------------------------------------------------- the canon --------------------
  // `canon` is what snapshots/canon.data.js carries: { revA: <params/rev_a.json>, rEarthKm: {value,
  // line, path, commit} }. Everything the page shows about the tether is read from here.
  var TIERS = [
    { id: 'reference', path: ['kinematics', 'v_tip_kms'], label: 'Reference', role: 'GTO / high-elliptical' },
    { id: 'cislunar', path: ['kinematics', 'cislunar_revenue_gated_option', 'v_tip_kms'], label: 'Cislunar', role: 'revenue-gated option' },
    { id: 'phase3', path: ['kinematics', 'phase3_growth_option', 'v_tip_kms'], label: 'Phase 3', role: 'growth option' },
  ];
  var CANON_KEYS = {
    mu: ['orbital', 'mu_earth_m3s2'],
    altKm: ['orbital', 'com_altitude_km'],
    comRadiusFileKm: ['orbital', 'com_radius_km'],
    LKm: ['geometry', 'tether_half_length_km'],
    rotationPeriodMin: ['geometry', 'rotation_period_min'],
  };
  function dig(obj, path) {
    return path.reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function readCanon(canon) {
    if (!canon || typeof canon !== 'object' || !canon.revA || typeof canon.revA !== 'object') {
      return refusal('not_found', 'The Rev A canon snapshot (snapshots/canon.data.js, built from params/rev_a.json) is not loaded.',
        'Restore snapshots/canon.data.js (node ideas/16-spin-wobble/build-data.mjs) next to index.html.');
    }
    var out = { ok: true, tiers: [] };
    var keys = Object.keys(CANON_KEYS);
    for (var i = 0; i < keys.length; i++) {
      var v = dig(canon.revA, CANON_KEYS[keys[i]]);
      if (!isNum(v) || v <= 0) {
        return refusal('not_found', 'params/rev_a.json has no positive number at ' + CANON_KEYS[keys[i]].join('.') + '.',
          'Re-snapshot params/rev_a.json from the Skyhook checkout; the kernel will not substitute a value.');
      }
      out[keys[i]] = v;
    }
    for (var j = 0; j < TIERS.length; j++) {
      var t = TIERS[j];
      var vk = dig(canon.revA, t.path);
      if (!isNum(vk) || vk <= 0) {
        return refusal('not_found', 'params/rev_a.json has no tip speed at ' + t.path.join('.') + '.',
          'Re-snapshot params/rev_a.json; the tier ladder must come from the canon.');
      }
      out.tiers.push({ id: t.id, label: t.label, role: t.role, key: t.path.join('.'), vKms: vk });
    }
    var re = canon.rEarthKm;
    if (!re || !isNum(re.value) || re.value <= 0) {
      return refusal('not_found', 'The Earth radius the twin uses (R_EARTH_KM in tools/twin/physics.js) is not in the snapshot.',
        'Rebuild snapshots/canon.data.js from snapshots/twin-physics.mjs.');
    }
    out.rEarthKm = re.value;
    out.rEarthSource = re;
    // The two CoM-radius conventions (BRIEFING section 3; idea 01's finding): the twin and the
    // physics module use R_E + altitude; the file also states com_radius_km.
    out.radii = {
      twin: { id: 'twin', km: re.value + out.altKm, label: 'R_E + altitude (twin, golden run)' },
      file: { id: 'file', km: out.comRadiusFileKm, label: 'orbital.com_radius_km (file)' },
    };
    return out;
  }

  // ---------------------------------------------------------------- the closed form --------------
  // p: { mu, R, L, v0, theta0, rEarth? }  (SI; theta0 in rad; rEarth optional, for the ground check)
  function model(p) {
    if (!p || typeof p !== 'object') return refusal('insufficient_data', 'No inputs.', 'Pass mu, R, L, v0 and theta0.');
    var names = ['mu', 'R', 'L', 'v0', 'theta0'];
    for (var i = 0; i < names.length; i++) {
      if (!isNum(p[names[i]])) {
        return refusal('out_of_envelope', names[i] + ' must be a finite number (got ' + String(p[names[i]]) + ').',
          'Give ' + names[i] + ' as a finite number.');
      }
    }
    if (p.mu <= 0 || p.R <= 0 || p.L <= 0 || p.v0 <= 0) {
      return refusal('out_of_envelope', 'mu, R, L and the tip speed must all be positive.', 'Use positive values.');
    }
    if (p.L >= p.R) {
      return refusal('out_of_envelope', 'The half-length reaches the centre of the Earth.', 'Use a half-length shorter than the orbit radius.');
    }
    if (p.rEarth !== undefined) {
      if (!isNum(p.rEarth) || p.rEarth <= 0) return refusal('out_of_envelope', 'Earth radius must be a positive number.', 'Use the twin\'s R_EARTH_KM.');
      if (p.R - p.L <= p.rEarth) {
        return refusal('out_of_envelope', 'With this half-length the lower tip would sweep below the ground (tip radius ' +
          ((p.R - p.L) / 1e3).toFixed(0) + ' km against an Earth radius of ' + (p.rEarth / 1e3).toFixed(0) + ' km).',
          'Use a half-length shorter than the centre-of-mass altitude.');
      }
    }
    var n = Math.sqrt(p.mu / (p.R * p.R * p.R));
    var w0 = p.v0 / p.L;
    var r0 = w0 - n; // spin rate relative to the orbiting frame at spin-up
    if (r0 <= 0) {
      return refusal('out_of_envelope', 'The spin is no faster than the orbital rate, so the tether does not rotate prograde in the orbiting frame; this is not a rotovator.',
        'Use a tip speed above n L (' + (n * p.L).toFixed(0) + ' m/s here).');
    }
    var s0 = Math.sin(p.theta0);
    var C = r0 * r0 + 3 * n * n * s0 * s0;
    var minSq = C - 3 * n * n;
    if (minSq <= 0) {
      return refusal('out_of_envelope', 'Too slow to go over the top: the gravity gradient stops the spin before the tether reaches horizontal, so it librates instead of rotating and the rotating closed form does not apply.',
        'Spin faster: at this spin-up angle the tip speed must exceed ' +
        (p.L * (n + Math.sqrt(3 * n * n * (1 - s0 * s0)))).toFixed(0) + ' m/s.');
    }
    var rateMax = Math.sqrt(C);      // at theta = 0, pi (tether vertical)
    var rateMin = Math.sqrt(minSq);  // at theta = pi/2, 3pi/2 (tether horizontal)
    var rateMean = agm(rateMax, rateMin);
    var L = p.L;
    var nu = n / w0;
    var m = {
      ok: true,
      inputs: { mu: p.mu, R: p.R, L: p.L, v0: p.v0, theta0: p.theta0 },
      n: n, w0: w0, nu: nu, r0: r0, C: C,
      rateMax: rateMax, rateMin: rateMin, rateMean: rateMean,
      vVertical: L * (n + rateMax),
      vHorizontal: L * (n + rateMin),
      vMean: L * (n + rateMean),
      halfPeriod: Math.PI / rateMean,     // vertical to vertical (a tip at the bottom, then the other)
      halfPeriodNoGradient: Math.PI / r0, // the same with the inertial spin held at v0/L
      inertialPeriod: 2 * Math.PI / w0,   // 2 pi L / v0: rev_a.json's rotation_period_min
      orbitPeriod: 2 * Math.PI / n,
      // first-order (in n/omega) forms, for a radial (vertical) spin-up:
      firstOrderDip: 1.5 * nu * nu / (1 - nu),
      firstOrderMeanDip: 0.75 * nu * nu / (1 - nu),
      programDip: 1.5 * nu * nu, // the form stated in physics/tether_dynamics.py:260-261
    };
    m.dipFromVertical = 1 - m.vHorizontal / m.vVertical; // peak-to-trough, as a fraction of the vertical speed
    m.meanVsV0 = m.vMean / p.v0 - 1;
    m.verticalVsV0 = m.vVertical / p.v0 - 1;
    m.horizontalVsV0 = m.vHorizontal / p.v0 - 1;
    m.relRate = function (theta) { var s = Math.sin(theta); return Math.sqrt(C - 3 * n * n * s * s); };
    m.tipSpeed = function (theta) { return L * (n + m.relRate(theta)); };
    return m;
  }

  // Convenience: the model from the canon for a tier / half-length / spin-up phase / radius choice.
  function fromCanon(c, opts) {
    if (!c || !c.ok) return c || readCanon(null);
    opts = opts || {};
    var tier = null;
    if (isNum(opts.vKms)) tier = { id: 'custom', label: 'Custom', key: null, vKms: opts.vKms };
    else {
      for (var i = 0; i < c.tiers.length; i++) if (c.tiers[i].id === (opts.tier || 'reference')) tier = c.tiers[i];
      if (!tier) return refusal('not_found', 'No tier called ' + String(opts.tier) + ' in the canon.', 'Use reference, cislunar or phase3.');
    }
    var radius = c.radii[opts.radius || 'twin'];
    if (!radius) return refusal('not_found', 'No radius convention called ' + String(opts.radius) + '.', 'Use twin or file.');
    var LKm = opts.LKm === undefined ? c.LKm : opts.LKm;
    var thetaDeg = opts.theta0Deg === undefined ? 0 : opts.theta0Deg;
    if (!isNum(LKm)) return refusal('out_of_envelope', 'Half-length must be a finite number.', 'Give the half-length in km.');
    if (!isNum(thetaDeg)) return refusal('out_of_envelope', 'Spin-up angle must be a finite number.', 'Give the angle in degrees, 0 to 90.');
    var m = model({ mu: c.mu, R: radius.km * 1e3, L: LKm * 1e3, v0: tier.vKms * 1e3, theta0: thetaDeg * Math.PI / 180, rEarth: c.rEarthKm * 1e3 });
    if (m.ok) { m.tier = tier; m.radius = radius; m.LKm = LKm; m.theta0Deg = thetaDeg; }
    return m;
  }

  // ---------------------------------------------------------------- independent checks ----------
  // 1. Time integration of theta'' = -3 n^2 sin cos by fixed-step RK4 from the spin-up state. Samples
  // the tip speed AFTER each step and averages over the steps, exactly as tools/twin/verify.mjs and
  // scripts/generate_golden.py form mean_tip_speed_mps, so a window mean is comparable to golden.json.
  function integrate(m, opts) {
    var dt = opts.dt, steps = opts.steps, every = opts.sampleEvery || 0;
    var n2 = m.n * m.n, L = m.inputs.L, n = m.n;
    var f = function (th) { return -3 * n2 * Math.sin(th) * Math.cos(th); };
    var th = m.inputs.theta0, w = m.r0, t = 0;
    var sumV = 0, sumV2 = 0, minV = Infinity, maxV = -Infinity;
    var samples = [], crossings = [];
    var turns = Math.floor(th / Math.PI);
    for (var i = 0; i < steps; i++) {
      var k1t = w, k1w = f(th);
      var k2t = w + 0.5 * dt * k1w, k2w = f(th + 0.5 * dt * k1t);
      var k3t = w + 0.5 * dt * k2w, k3w = f(th + 0.5 * dt * k2t);
      var k4t = w + dt * k3w, k4w = f(th + dt * k3t);
      var thPrev = th;
      th += dt / 6 * (k1t + 2 * k2t + 2 * k3t + k4t);
      w += dt / 6 * (k1w + 2 * k2w + 2 * k3w + k4w);
      t += dt;
      var v = L * (n + w);
      sumV += v; sumV2 += v * v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      var k = Math.floor(th / Math.PI);
      if (k > turns) { // crossed a vertical (theta = k pi): interpolate the time
        var target = k * Math.PI;
        crossings.push(t - dt + dt * (target - thPrev) / (th - thPrev));
        turns = k;
      }
      if (every && (i + 1) % every === 0) samples.push([t, th, v]);
    }
    return { meanV: sumV / steps, meanV2: sumV2 / steps, minV: minV, maxV: maxV, samples: samples, verticalCrossings: crossings, theta: th, rate: w };
  }

  // 2. A rigid line body with EXACT point-mass gravity on every lump and the orbit free to respond:
  // no quadrupole truncation, no circular-orbit assumption. Given the twin's own lump masses and
  // arc positions, it isolates what rigidity alone predicts. State: centre of mass (x, y, vx, vy),
  // inertial angle phi of the +s direction, inertial spin rate w. Starts as the twin does: tether
  // radial (+s outward), CoM on a circular orbit, spin w0.
  function rigidLineBody(o) {
    var mu = o.mu, masses = o.masses, s = o.s, dt = o.dt, steps = o.steps, every = o.sampleEvery || 0;
    var M = 0, scm = 0;
    for (var i = 0; i < masses.length; i++) { M += masses[i]; scm += masses[i] * s[i]; }
    scm /= M;
    var d = s.map(function (si) { return si - scm; });
    var I = 0;
    for (var j = 0; j < masses.length; j++) I += masses[j] * d[j] * d[j];
    var tipArm = Math.abs(d[o.tipIndex === undefined ? 0 : o.tipIndex]);
    function deriv(st) {
      var ux = Math.cos(st[4]), uy = Math.sin(st[4]);
      var Fx = 0, Fy = 0, T = 0;
      for (var q = 0; q < masses.length; q++) {
        var x = st[0] + d[q] * ux, y = st[1] + d[q] * uy;
        var r2 = x * x + y * y, r3 = r2 * Math.sqrt(r2);
        var fx = -mu * masses[q] * x / r3, fy = -mu * masses[q] * y / r3;
        Fx += fx; Fy += fy;
        T += d[q] * (ux * fy - uy * fx);
      }
      return [st[2], st[3], Fx / M, Fy / M, st[5], T / I];
    }
    var st = [o.R, 0, 0, Math.sqrt(mu / o.R), 0, o.w0];
    var samples = [], sumV = 0, t = 0;
    for (var k = 0; k < steps; k++) {
      var k1 = deriv(st);
      var a = st.map(function (v, idx) { return v + 0.5 * dt * k1[idx]; });
      var k2 = deriv(a);
      var b = st.map(function (v, idx) { return v + 0.5 * dt * k2[idx]; });
      var k3 = deriv(b);
      var c = st.map(function (v, idx) { return v + dt * k3[idx]; });
      var k4 = deriv(c);
      st = st.map(function (v, idx) { return v + dt / 6 * (k1[idx] + 2 * k2[idx] + 2 * k3[idx] + k4[idx]); });
      t += dt;
      var vTip = tipArm * st[5];
      sumV += vTip;
      if (every && (k + 1) % every === 0) samples.push([t, st[4] - Math.atan2(st[1], st[0]), vTip]);
    }
    return { meanV: sumV / steps, samples: samples, I: I, M: M, tipArm: tipArm };
  }

  // Peak-to-trough dip against half-length at fixed tip speed: exact, first order, and the form the
  // program states. Lengths that refuse (tip below ground, libration) are returned with ok: false.
  function sweepHalfLength(base, LsM) {
    return LsM.map(function (L) {
      var m = model({ mu: base.mu, R: base.R, L: L, v0: base.v0, theta0: base.theta0, rEarth: base.rEarth });
      if (!m.ok) return { L: L, ok: false, code: m.refusal.code };
      return { L: L, ok: true, exact: m.dipFromVertical, firstOrder: m.firstOrderDip, program: m.programDip, mean: -m.meanVsV0 };
    });
  }

  return {
    agm: agm,
    refusal: refusal,
    TIERS: TIERS,
    CANON_KEYS: CANON_KEYS,
    readCanon: readCanon,
    model: model,
    fromCanon: fromCanon,
    integrate: integrate,
    rigidLineBody: rigidLineBody,
    sweepHalfLength: sweepHalfLength,
  };
});
