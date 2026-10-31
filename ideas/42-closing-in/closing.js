/* Closing In: arriving at the asteroid. Idea 42 of the Aster Idea Bank, module 12 of "The Long Way Round".
 *
 * Idea 40 flew the cruise and delivered the spacecraft at the asteroid with a v-infinity (4.16 km/s at Apophis on the
 * chain's transfer); idea 41 said how long a command takes to get there. This module flies the last two months: the
 * braking burns that take that speed out, the slow approach through a corridor of waypoints, the asteroid's first
 * appearance in the camera, and the spacecraft holding station at a chosen point near a body whose gravity is weaker
 * than sunlight. It hands on the spacecraft at stand-off: its state, the body's gravity and Hill sphere, the propellant
 * left, and what holding station costs per day.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, N). Time: TDB seconds past J2000 (Aster's convention via ideas
 * 39-41; UTC = TDB - 69.184 s). Frame: asteroid-centred, ICRF/J2000 axes, not rotating; the asteroid itself flies about
 * the Sun on a conic (idea 39's propagate()) from the state idea 40 handed on. Display angles use the Sun Anti-Momentum
 * (SAM) frame of AAS 19-035 (x toward the Sun, z against the asteroid's orbital angular momentum).
 *
 * Forces on the spacecraft, relative to the asteroid: the asteroid as a point mass (module 43 replaces it with a shape);
 * the Sun's tide, exact (the Sun's pull on the spacecraft minus its pull on the asteroid, not Hill's linearisation);
 * sunlight on a flat absorber of the given area per mass (idea 40's solar pressure, coast.js line 179), cut off in the
 * asteroid's cylindrical shadow. No planets: the module refuses where the Earth's tide would matter (Apophis in 2029).
 * Integrator: idea 40's Dormand-Prince 5(4), unmodified.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClosingIn = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, DAY = 86400, HOUR = 3600, KERNEL = '42-closing-in/closing.js';
  var C_LIGHT = 299792458;              // m/s, exact by the SI definition (idea 40 carries the same in de440-constants.js)
  var G0 = 9.80665;                     // m/s^2, standard gravity, exact by definition (3rd CGPM, 1901); Aster's launch-vehicles.ts uses it
  var J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

  function refusal(code, reason, help, extra) { var r = { code: code, reason: reason, what_would_help: help }; if (extra) for (var k in extra) r[k] = extra[k]; return r; }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; }
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function vr9(v) { return v.map(r9); }
  function log10(x) { return Math.log(x) / Math.LN10; }
  function tdbOfJd(jd) { return (jd - 2451545.0) * DAY; }

  // ==================================================================================================================
  function create(deps) {
    var LR = deps.lambert, LC = deps.coast, K = deps.constants, NAV = deps.nav, HZ = deps.horizons, BD = deps.bodies.bodies, SRC = deps.sources;
    var MU_SUN = K.gmSun_m3_s2, AU = K.au_m, MU_EARTH = K.earthMu_m3_s2, TDB_UTC = K.tdbMinusUtc_s;
    var P1AU = NAV.sun.luminosity_W / (4 * PI * AU * AU * C_LIGHT);   // N/m^2 on an absorber at 1 au (idea 40, coast.js:179)
    var G_NEWTON = SRC.nist.G_m3_kg_s2;
    var A19 = SRC.aas19035, A24 = SRC.aas24063, CRAFT = SRC.spacecraft;
    var TOL = { rtol: 1e-11, atol: [1e-4, 1e-4, 1e-4, 1e-10, 1e-10, 1e-10], nErr: 6, maxSteps: 400000 };

    function utcOf(tdb) { return new Date(J2000_UNIX_MS + (tdb - TDB_UTC) * 1000).toISOString(); }
    function tdbOfUtc(iso) { return (Date.parse(iso) - J2000_UNIX_MS) / 1000 + TDB_UTC; }

    // -------------------------------------------------------------------------------------- the asteroid about the Sun
    /** The asteroid's heliocentric state at any time: idea 39's Kepler propagation from one state (r m, v m/s, at t0). */
    function conic(r0, v0, t0) {
      var cache = { t: null, s: null };
      return function (t) {
        if (cache.t === t) return cache.s;
        var s = t === t0 ? { r: r0.slice(), v: v0.slice() } : LR.propagate(r0, v0, t - t0, MU_SUN);
        cache.t = t; cache.s = s; return s;
      };
    }
    /** SAM frame (AAS 19-035 p. 4): x toward the Sun from the body, z against its orbital angular momentum, y = z x x. */
    function samAxes(A) {
      var x = scale(unit(A.r), -1), h = cross(A.r, A.v), z = scale(unit(h), -1), y = cross(z, x);
      return { x: x, y: y, z: z, omega: scale(h, 1 / dot(A.r, A.r)) };   // omega: the frame's rotation (rad/s, ICRF)
    }
    function toSam(rho, A) { var F = samAxes(A); return [dot(rho, F.x), dot(rho, F.y), dot(rho, F.z)]; }
    function fromSam(range, latDeg, lonDeg, A) {
      var F = samAxes(A), cl = Math.cos(latDeg * DEG);
      return add(add(scale(F.x, range * cl * Math.cos(lonDeg * DEG)), scale(F.y, range * cl * Math.sin(lonDeg * DEG))), scale(F.z, range * Math.sin(latDeg * DEG)));
    }
    function samAngles(rho, A) {
      var s = toSam(rho, A), r = norm(s);
      return { range_m: r, lat_deg: Math.asin(Math.max(-1, Math.min(1, s[2] / r))) / DEG, lon_deg: Math.atan2(s[1], s[0]) / DEG, phase_deg: Math.acos(Math.max(-1, Math.min(1, s[0] / r))) / DEG };
    }

    // -------------------------------------------------------------------------------------- forces and the flight
    /**
     * Acceleration of the spacecraft relative to the asteroid (m/s^2, ICRF) at t and relative position rho.
     * ctx: {mu (m^3/s^2), radius (m), astAt(t) -> {r, v}, am (m^2/kg), cr, shadow (bool), parts (bool)}.
     */
    function accel(t, rho, ctx) {
      var A = ctx.astAt(t); if (!A) return null;
      var r2 = dot(rho, rho), r = Math.sqrt(r2), R = add(A.r, rho), Rn = norm(R), An = norm(A.r);
      var g = ctx.mu > 0 ? scale(rho, -ctx.mu / (r2 * r)) : [0, 0, 0];
      var tide = add(scale(R, -MU_SUN / (Rn * Rn * Rn)), scale(A.r, MU_SUN / (An * An * An)));
      var srp = [0, 0, 0];
      if (ctx.am > 0) {
        var lit = true;
        if (ctx.shadow && ctx.radius > 0) { var u = scale(A.r, 1 / An), along = dot(rho, u); if (along > 0 && norm(sub(rho, scale(u, along))) < ctx.radius) lit = false; }
        if (lit) srp = scale(R, ctx.cr * P1AU * AU * AU * ctx.am / (Rn * Rn * Rn));
      }
      var a = add(add(g, tide), srp);
      return ctx.parts ? { a: a, gravity: g, tide: tide, srp: srp } : a;
    }
    function deriv(ctx) { return function (t, y) { var a = accel(t, [y[0], y[1], y[2]], ctx); return [y[3], y[4], y[5], a[0], a[1], a[2]]; }; }
    /** Fly from (t0, y0 = [rho, v]) to t1 (either direction). opts.samples: n evenly spaced outputs; opts.stop(t, y) ends early. */
    function fly(t0, y0, t1, ctx, opts) {
      opts = opts || {};
      var n = opts.samples || 1, f = deriv(ctx), y = y0.slice(), t = t0, out = [{ t: t0, y: y0.slice() }];
      for (var k = 1; k <= n; k++) {
        var tk = t0 + (t1 - t0) * k / n, res = LC.dopri(f, t, y, tk, TOL);
        if (res.failed) return { failed: res.failed, out: out };
        y = res.y; t = tk; out.push({ t: t, y: y.slice() });
        if (opts.stop && opts.stop(t, y)) return { y: y, t: t, out: out, stopped: true };
      }
      return { y: y, t: t1, out: out };
    }
    /** Impulsive targeting: the velocity at (t0, r0) that reaches r1 at t1 (to 1 m, or 1e-9 of the range) under every force above (Newton, finite-difference Jacobian). */
    function aim(t0, r0, vGuess, t1, r1, ctx) {
      var v = vGuess.slice(), tol = Math.max(1, 1e-9 * Math.max(norm(r0), norm(r1))), miss = null;   // 1 m: the integrator's own noise over a 175,000 km leg is ~0.1 m
      for (var it = 0; it < 15; it++) {
        var y = fly(t0, r0.concat(v), t1, ctx); if (y.failed) return { failed: y.failed };
        miss = sub([y.y[0], y.y[1], y.y[2]], r1);
        if (norm(miss) < tol) return { v: v, miss_m: norm(miss), iters: it, arrive: [y.y[3], y.y[4], y.y[5]] };
        var J = new Array(9), d = 1e-6 * Math.max(1, norm(v));
        for (var j = 0; j < 3; j++) {
          var vp = v.slice(); vp[j] += d;
          var yp = fly(t0, r0.concat(vp), t1, ctx); if (yp.failed) return { failed: yp.failed };
          for (var i = 0; i < 3; i++) J[i * 3 + j] = (yp.y[i] - y.y[i]) / d;
        }
        var Ji = LC.inv3(J); if (!Ji) return { failed: 'singular targeting Jacobian' };
        v = sub(v, [Ji[0] * miss[0] + Ji[1] * miss[1] + Ji[2] * miss[2], Ji[3] * miss[0] + Ji[4] * miss[1] + Ji[5] * miss[2], Ji[6] * miss[0] + Ji[7] * miss[1] + Ji[8] * miss[2]]);
      }
      return { failed: 'targeting did not converge (miss ' + (miss ? norm(miss).toFixed(1) : '?') + ' m)' };
    }

    // -------------------------------------------------------------------------------------- burns and mass
    function ve(isp) { return isp * G0; }
    function propellantFor(m0, dv, isp) { return m0 * (1 - Math.exp(-dv / ve(isp))); }
    /**
     * A burn of dv by thrust F from mass m0 in a uniform field: duration T = (m0 ve / F)(1 - e^(-dv/ve)), and the distance
     * covered while braking from v0 straight down: s = v0 T - ve (m0/mdot)(1 - u + u ln u), u = m1/m0 (closed form).
     */
    function finiteBurn(m0, dv, F, isp, v0) {
      var c = ve(isp), mdot = F / c, m1 = m0 * Math.exp(-dv / c), T = (m0 - m1) / mdot, u = m1 / m0;
      var s = num(v0) ? v0 * T - c * (m0 / mdot) * (1 - u + u * Math.log(u)) : null;
      return { duration_s: T, propellant_kg: m0 - m1, m1_kg: m1, distance_m: s, accel0_m_s2: F / m0 };
    }

    // -------------------------------------------------------------------------------------- the body
    /** The body's physical model: SBDB where measured; Apophis's GM from AAS 24-063; otherwise volume x an assumed density. */
    function bodyModel(des, S, target) {
      var b = BD[des] || null, out = { designation: des, name: b ? b.name : (target && target.name) || des };
      out.H = b && num(b.H) ? b.H : (target && num(target.H) ? target.H : null);
      out.G = b && num(b.G) ? b.G : null;
      out.rotation_h = b ? b.rotation_h : null;
      if (b && num(b.diameter_m)) { out.radius_m = b.diameter_m / 2; out.radius_source = 'SBDB diameter (' + b.diameter_ref + ')'; out.radius_confidence = 'measured'; }
      else if (target && num(target.estimated_radius_m)) { out.radius_m = target.estimated_radius_m; out.radius_source = 'Aster\'s estimate from H under its assumed albedo (idea 39 target)'; out.radius_confidence = 'assumed'; }
      else return { refusal: refusal('insufficient_data', 'No size for ' + out.name + ': SBDB gives no diameter and the handoff no estimate.', 'A measured diameter (radar, occultation) or an H magnitude and albedo.', { applies_to: 'body' }) };
      var vol = 4 / 3 * PI * Math.pow(out.radius_m, 3);
      var mode = S.gm;
      if (mode === 'measured' && b && num(b.GM_m3_s2)) {
        out.GM_m3_s2 = b.GM_m3_s2; out.GM_confidence = 'measured'; out.GM_source = 'SBDB GM (' + b.GM_ref + ')';
        out.GM_range_m3_s2 = num(b.GM_sigma_m3_s2) ? [b.GM_m3_s2 - b.GM_sigma_m3_s2, b.GM_m3_s2 + b.GM_sigma_m3_s2] : null;
      } else if ((mode === 'measured' || mode === 'estimate') && des === '99942') {
        var E = A24.apophisGM_m3_s2;
        out.GM_m3_s2 = E[S.gmCase || 'best']; out.GM_confidence = 'assumed'; out.GM_range_m3_s2 = [E.min, E.max];
        out.GM_source = 'AAS 24-063 ' + E.page + ': ' + E.best + ' (' + E.min + '-' + E.max + ') m^3/s^2, the ' + (S.gmCase || 'best') + ' value';
      } else if (mode === 'density' || mode === 'measured' || mode === 'estimate') {
        // review: where SBDB publishes a bulk density but no GM (Didymos), "measured or published" uses SBDB's density
        var sbdbRho = mode !== 'density' && b && num(b.density_kg_m3) ? b.density_kg_m3 : null;
        var rho = sbdbRho !== null ? sbdbRho : num(S.density_kg_m3) ? S.density_kg_m3 : null;
        if (!(rho > 0)) return { refusal: refusal('insufficient_data', 'No measured mass for ' + out.name + ' and no density given.', 'A density (the measured bulk densities of Bennu, Ryugu, Itokawa and Eros are 1190 to 2670 kg/m^3, SBDB).', { applies_to: 'body' }) };
        out.GM_m3_s2 = G_NEWTON * rho * vol; out.GM_confidence = 'assumed'; out.GM_range_m3_s2 = null;
        out.GM_source = 'G (NIST CODATA 2022) x ' + rho + ' kg/m^3 (' + (sbdbRho !== null ? 'SBDB density, ' + b.density_ref : 'assumed') + ') x the volume of a ' + (2 * out.radius_m).toFixed(0) + ' m sphere';
      } else return { refusal: refusal('invalid_input', 'Unknown mass mode ' + mode + '.', 'measured, estimate or density.') };
      out.density_kg_m3 = out.GM_m3_s2 / (G_NEWTON * vol);
      out.surface_gravity_m_s2 = out.GM_m3_s2 / (out.radius_m * out.radius_m);
      out.escape_speed_m_s = Math.sqrt(2 * out.GM_m3_s2 / out.radius_m);
      return out;
    }
    /** Hill radius d (mu/(3 muS))^(1/3); the ANH3BP length unit d (mu/muS)^(1/3) and its SRP number beta~ (AAS 24-063 eq. 2b). */
    function regimes(mu, d, am, cr) {
      var eps = Math.pow(mu / MU_SUN, 1 / 3), DU = d * eps, aSrp = cr * P1AU * am * (AU / d) * (AU / d), aUnit = MU_SUN / (d * d) * eps;
      var beta = aSrp / aUnit;   // = G1/(B muS eps) when G1 = P1AU AU^2 cr
      // the dark-side equilibrium on the anti-Sun axis: 1/x^2 = beta + 3x (circular ANH3BP, AAS 24-063 eq. 2a with r' = r'' = 0)
      var lo = 1e-9, hi = 1, x = 0.5;   // f(x) = 1/x^2 - beta - 3x falls monotonically on x > 0: bisection
      for (var i = 0; i < 200; i++) { x = 0.5 * (lo + hi); if (1 / (x * x) - beta - 3 * x > 0) lo = x; else hi = x; if (hi - lo < 1e-15 * hi) break; }
      return { hill_radius_m: d * Math.pow(mu / (3 * MU_SUN), 1 / 3), du_m: DU, beta: beta, srp_accel_m_s2: aSrp, gravity_equals_srp_m: Math.sqrt(mu / aSrp), dark_equilibrium_m: x * DU, sun_distance_m: d };
    }

    // -------------------------------------------------------------------------------------- brightness (H-G law)
    function hgPhi(alphaDeg) { var t = Math.tan(alphaDeg * DEG / 2), H = SRC.hgLaw; return [Math.exp(-H.A[0] * Math.pow(t, H.B[0])), Math.exp(-H.A[1] * Math.pow(t, H.B[1]))]; }
    /** Apparent V magnitude: Horizons' asteroid law H + 5 log10(r delta) - 2.5 log10((1-G) phi1 + G phi2), r and delta in au. */
    function apparentMag(H, G, rAu, dAu, alphaDeg) { var p = hgPhi(alphaDeg); return H + 5 * log10(rAu * dAu) - 2.5 * log10((1 - G) * p[0] + G * p[1]); }

    // ==================================================================================================================
    // Settings, the arrival, and the plan
    function defaults() {
      return { craft: 'near', dry_kg: CRAFT.near.dry_kg, propellant_kg: CRAFT.near.propellant_kg, thrust_N: CRAFT.near.mainThrust_N, smallThrust_N: CRAFT.near.smallThrust_N,
        isp_s: null, tanks: 'sized', tcm: 'p99', am_m2_kg: 1 / A24.massToArea_kg_m2, cr: 1,
        gm: 'measured', gmCase: 'best', density_kg_m3: 2000,
        template: 'orex', firstBurnRange_m: A19.table1[0][2] * 1000, directDays: 14,
        standoff_m: A19.arrivalRange_km * 1000, standoffLat_deg: A19.table1[7][3], standoffLon_deg: A19.table1[7][4],
        box_m: 1000, simDays: 10, stayDays: 90, groundLoopDays: A19.odLeadDays.finalDesign[0], lateUpdateHours: A19.odLeadDays.lateUpdate_h, detectV: null, scan: false };
    }
    function nearIsp() { var n = CRAFT.near; return n.deltaV_capacity_m_s / (G0 * Math.log((n.dry_kg + n.propellant_kg) / n.dry_kg)); }
    var RANGES = {
      dry_kg: [50, 20000], propellant_kg: [0, 50000], thrust_N: [0.01, 50000], smallThrust_N: [0.001, 5000], isp_s: [100, 5000], am_m2_kg: [0, 0.2], cr: [0, 2],
      density_kg_m3: [200, 8000], firstBurnRange_m: [1e5, 5e9], directDays: [1, 120], standoff_m: [100, 1e8], standoffLat_deg: [-90, 90], standoffLon_deg: [-180, 180],
      box_m: [1, 1e6], simDays: [1, 60], stayDays: [0, 3650], groundLoopDays: [0, 60], lateUpdateHours: [0, 720], detectV: [0, 30]
    };
    function validSettings(S) {
      var e = [];
      for (var k in RANGES) { if (S[k] === null && (k === 'isp_s' || k === 'detectV')) continue; if (!num(S[k]) || S[k] < RANGES[k][0] || S[k] > RANGES[k][1]) e.push(k + ' must be a number in [' + RANGES[k][0] + ', ' + RANGES[k][1] + ']'); }
      if (['near', 'custom'].indexOf(S.craft) < 0) e.push('craft is near or custom');
      if (['sized', 'asbuilt'].indexOf(S.tanks) < 0) e.push('tanks is sized or asbuilt');
      if (['mean', 'p99', 'p9973', 'none'].indexOf(S.tcm) < 0) e.push('tcm is mean, p99, p9973 or none');
      if (['measured', 'estimate', 'density'].indexOf(S.gm) < 0) e.push('gm is measured, estimate or density');
      if (['best', 'min', 'max'].indexOf(S.gmCase) < 0) e.push('gmCase is best, min or max');
      if (['orex', 'direct'].indexOf(S.template) < 0) e.push('template is orex or direct');
      if (typeof S.scan !== 'boolean') e.push('scan is true or false');
      return e;
    }

    /** Waypoints after the first burn: AAS 19-035 Table 1 (AAM-2a waived, as flown) at their days after AAM-1, or one leg. */
    function waypoints(S, t1) {
      var W = [];
      if (S.template === 'orex') {
        var T = A19.table1, tA = Date.parse(T[0][1]);
        for (var i = 1; i < T.length; i++) {
          if (T[i][0] === 'AAM-2a') continue;
          var last = i === T.length - 1;
          W.push({ name: last ? 'Stand-off' : T[i][0], t: t1 + (Date.parse(T[i][1]) - tA) / 1000, range_m: last ? S.standoff_m : T[i][2] * 1000, lat: last ? S.standoffLat_deg : T[i][3], lon: last ? S.standoffLon_deg : T[i][4] });
        }
      } else W.push({ name: 'Stand-off', t: t1 + S.directDays * DAY, range_m: S.standoff_m, lat: S.standoffLat_deg, lon: S.standoffLon_deg });
      return W;
    }

    /**
     * The approach. arr: {t, rho, v (m, m/s, relative to the asteroid at the nominal arrival), astR, astV (heliocentric at t)}.
     * The incoming arc is flown backwards from the arrival without the asteroid's pull (at km/s it bends the path by ~1e-8
     * rad) to the first-burn range; each burn then targets the next waypoint under every force; the last stops the
     * spacecraft at the stand-off point, fixed in the rotating SAM frame.
     */
    function approach(arr, S, body, firstBurnAt) {
      var astAt = conic(arr.astR, arr.astV, arr.t);
      var ctx = { mu: body.GM_m3_s2, radius: body.radius_m, astAt: astAt, am: S.am_m2_kg, cr: S.cr, shadow: true };
      var ctx0 = { mu: 0, radius: 0, astAt: astAt, am: S.am_m2_kg, cr: S.cr, shadow: false };
      var y0 = arr.rho.concat(arr.v), vinf = norm(arr.v), t1, y1;
      if (num(firstBurnAt)) {             // the as-flown case: the first burn is at a given epoch on the incoming arc
        t1 = firstBurnAt; var f0 = fly(arr.t, y0, t1, ctx0); if (f0.failed) return { refusal: refusal('out_of_envelope', 'Incoming arc: ' + f0.failed, 'Another arrival.') }; y1 = f0.y;
      } else {
        if (!(vinf > 0)) return { refusal: refusal('invalid_input', 'The arrival has no relative velocity.', 'An arrival state with a v-infinity.') };
        t1 = arr.t - S.firstBurnRange_m / vinf;
        for (var it = 0; it < 30; it++) {
          var fb = fly(arr.t, y0, t1, ctx0); if (fb.failed) return { refusal: refusal('out_of_envelope', 'Incoming arc: ' + fb.failed, 'Another arrival.') };
          y1 = fb.y; var rr = norm(y1.slice(0, 3)), rdot = dot(y1.slice(0, 3), y1.slice(3)) / rr, dt = (S.firstBurnRange_m - rr) / rdot;   // range(t + dt) = R1
          t1 += dt; if (Math.abs(dt) < 1e-3) { y1 = fly(arr.t, y0, t1, ctx0).y; break; }
        }
      }
      var W = waypoints(S, t1), burns = [], legs = [], t = t1, r = y1.slice(0, 3), vIn = y1.slice(3), name = S.template === 'orex' ? 'AAM-1' : 'Braking';
      for (var k = 0; k < W.length; k++) {
        var w = W[k], target = fromSam(w.range_m, w.lat, w.lon, astAt(w.t));
        var guess = scale(sub(target, r), 1 / (w.t - t));
        var A = aim(t, r, guess, w.t, target, ctx);
        if (A.failed) return { refusal: refusal('out_of_envelope', name + ' cannot reach ' + w.name + ': ' + A.failed + '.', 'Fewer or longer legs, or another stand-off.', { applies_to: 'approach' }) };
        burns.push({ name: name, t: t, r: r.slice(), vBefore: vIn.slice(), vAfter: A.v.slice(), dv: sub(A.v, vIn) });
        var leg = fly(t, r.concat(A.v), w.t, ctx, { samples: 48 });
        legs.push({ from: name, to: w.name, t0: t, t1: w.t, out: leg.out });
        t = w.t; r = target; vIn = A.arrive; name = w.name;
      }
      // stop at the stand-off: velocity of a point fixed in the rotating SAM frame
      var Fs = samAxes(astAt(t)), vHold = cross(Fs.omega, r);
      burns.push({ name: 'Stand-off', t: t, r: r.slice(), vBefore: vIn.slice(), vAfter: vHold, dv: sub(vHold, vIn) });
      // the incoming arc for the charts, from up to 60 days before the first burn
      var tPre = t1 - Math.min(60 * DAY, Math.max(10 * DAY, 30 * S.firstBurnRange_m / vinf)), pre = fly(t1, y1, tPre, ctx0, { samples: 60 });
      return { ctx: ctx, astAt: astAt, t1: t1, y1: y1, burns: burns, legs: legs, incoming: pre.out.slice().reverse(), standoff: { t: t, r: r, v: vHold } };
    }

    /** Detection and optical knowledge along the incoming arc (H-G law; the camera's angular error x range). */
    function detection(ap, body, S) {
      if (!num(body.H) || !num(body.G)) return { refusal: refusal('insufficient_data', 'No H and G for ' + body.name + ' in SBDB: its brightness on the way in is not computed.', 'A measured H and G (lightcurve photometry).', { applies_to: 'detection' }) };
      var vLim = num(S.detectV) ? S.detectV : orexFirstImageV().V, rows = [];
      var pts = ap.incoming.concat(ap.legs[0] ? ap.legs[0].out.slice(1) : []);
      for (var i = 0; i < pts.length; i++) {
        var A = ap.astAt(pts[i].t), rho = pts[i].y.slice(0, 3), d = norm(rho), sc = add(A.r, rho);
        var alpha = Math.acos(Math.max(-1, Math.min(1, dot(scale(rho, 1 / d), scale(unit(A.r), -1))))) / DEG;
        rows.push({ t: pts[i].t, range_m: d, phase_deg: alpha, V: apparentMag(body.H, body.G, norm(A.r) / AU, d / AU, alpha), sunDist_m: norm(sc) });
      }
      var first = null;
      for (var j = 0; j < rows.length; j++) if (rows[j].V <= vLim) { first = rows[j]; break; }
      var cam = A19.imagers[0], sigPx = A19.centroid.unresolvedAchieved_px, ifov = cam[2] * 1e-6;
      // review: bright enough at the first computed point means first sight is earlier than the arc reaches, so the lead
      // is a lower bound (not a value); a negative lead means the camera first sees it after the first burn
      return { rows: rows, vLimit: vLim, first: first, imager: cam[0], ifov_rad: ifov, centroid_px: sigPx,
        lateralSigma: function (range) { return range * ifov * sigPx; },
        leadToFirstBurn_s: first ? ap.t1 - first.t : null, leadIsLowerBound: first === rows[0],
        before: first ? null : 'not bright enough within ' + ((ap.t1 - rows[0].t) / DAY).toFixed(0) + ' days of the first burn' };
    }
    var _orexV = null;
    /** Bennu's V at OSIRIS-REx's first PolyCam image (AAS 19-035 p. 5), from Horizons' geometry on 2018-08-17 and the H-G law. */
    function orexFirstImageV() {
      if (_orexV) return _orexV;
      var B = HZ.hg.bennuFromOrex, row = B.rows[0];
      _orexV = { V: apparentMag(B.H, B.G, row[2], row[3], row[4]), horizonsV: row[1], range_m: row[3] * AU, phase_deg: row[4], utc: A19.firstImage.utc };
      return _orexV;
    }

    /** Holding station at a point fixed in the SAM frame: the control acceleration, its cost per day, a deadband's cycle. */
    function hover(t, rho, ctx, box) {
      var A = ctx.astAt(t), F = samAxes(A), w = F.omega, rv = norm(A.r), rdot = dot(A.r, A.v) / rv;
      var wdot = scale(w, -2 * rdot / rv);                              // |h| constant: |omega| = |h|/r^2
      var need = add(cross(wdot, rho), cross(w, cross(w, rho)));       // a point fixed in the rotating frame
      var P = accel(t, rho, Object.assign({}, ctx, { parts: true }));
      var ac = sub(need, P.a), a = norm(ac);
      return { control_m_s2: ac, accel_m_s2: a, dv_per_day_m_s: a * DAY, gravity_m_s2: norm(P.gravity), tide_m_s2: norm(P.tide), srp_m_s2: norm(P.srp), frame_m_s2: norm(need),
        cycle_s: box > 0 && a > 0 ? 2 * Math.sqrt(2 * box / a) : null, dv_per_cycle_m_s: box > 0 ? 2 * Math.sqrt(2 * a * box) : null };
    }
    /**
     * A deadband hover flown: the spacecraft drifts under every force; when it leaves a sphere of diameter `box` about the
     * hover point on the side it is being pushed out of, a burn sends it back along the control acceleration fast enough
     * to coast to the far wall and fall back (the 1-D bounce: a burn of 2 sqrt(2 a box) every 2 sqrt(2 box / a)), with
     * any sideways offset walked out over the same cycle.
     */
    function deadband(t0, rho0, ctx, box, days) {
      var Fh = hover(t0, rho0, ctx, box), F0 = samAxes(ctx.astAt(t0)), samRho = toSam(rho0, ctx.astAt(t0));
      function holdAt(t) { var A = ctx.astAt(t), F = samAxes(A), r = add(add(scale(F.x, samRho[0]), scale(F.y, samRho[1])), scale(F.z, samRho[2])); return { r: r, v: cross(F.omega, r) }; }
      var y = rho0.concat(cross(F0.omega, rho0)), t = t0, tEnd = t0 + days * DAY;
      var dt = Math.min(HOUR, Math.max(60, (Fh.cycle_s || DAY) / 200)), f = deriv(ctx), dvTot = 0, burns = 0, maxOff = 0, track = [];
      while (t < tEnd - 1e-6) {
        var tn = Math.min(t + dt, tEnd), res = LC.dopri(f, t, y, tn, TOL);
        if (res.failed) return { failed: res.failed };
        y = res.y; t = tn;
        var H = holdAt(t), e = sub(y.slice(0, 3), H.r), eRate = sub(y.slice(3), H.v), en = norm(e);
        maxOff = Math.max(maxOff, en);
        // fire at a wall the spacecraft is being pushed out of (the control points inward there); at the far wall it only
        // stalls and falls back, and firing there would double the cost
        var acNow = hover(t, H.r, ctx, box).control_m_s2;
        if (en >= box / 2 && dot(e, eRate) > 0 && dot(acNow, e) < 0) {
          // aim along the control acceleration so the coast tops out at the far wall, and walk the sideways offset out
          // over that one cycle (aiming at the centre instead lets the exits creep sideways, where cycles are short and dear)
          var an = norm(acNow), ah = scale(acNow, 1 / an), ePar = dot(e, ah), ePerp = sub(e, scale(ah, ePar));
          var uu = Math.sqrt(2 * an * Math.max(box / 2 - ePar, 0)), Tc = 2 * uu / an;
          var vNew = add(H.v, sub(scale(ah, uu), scale(ePerp, 1 / Tc))), dv = norm(sub(vNew, y.slice(3)));
          y = y.slice(0, 3).concat(vNew); dvTot += dv; burns++;
        }
        if (track.length < 2000) track.push([(t - t0) / DAY, en]);
      }
      // the prediction, averaged over the flight (the Sun's distance, so sunlight, changes over weeks)
      var pred = 0, np = Math.max(2, Math.ceil(days)) ;
      for (var q = 0; q <= np; q++) { var tq = t0 + days * DAY * q / np; pred += (q === 0 || q === np ? 0.5 : 1) * hover(tq, holdAt(tq).r, ctx, box).dv_per_day_m_s; }
      return { dv_m_s: dvTot, burns: burns, dv_per_day_m_s: dvTot / days, predicted_per_day_m_s: pred / np, predicted_at_start_per_day_m_s: Fh.dv_per_day_m_s, max_offset_m: maxOff, track: track, days: days };
    }

    /** Circular orbits started at each radius in the terminator plane (normal toward the Sun) and in the noon-midnight plane. */
    function orbitScan(t0, ctx, body, rH, days) {
      var A = ctx.astAt(t0), F = samAxes(A), rMin = 1.5 * body.radius_m, rMax = Math.min(rH, 200 * body.radius_m), n = 14, out = [];
      for (var i = 0; i < n; i++) {
        var r = rMin * Math.pow(rMax / rMin, i / (n - 1)), vc = Math.sqrt(body.GM_m3_s2 / r), row = { r_m: r };
        [['terminator', F.y, F.z], ['noon_midnight', F.x, F.z]].forEach(function (pl) {
          var p0 = scale(pl[1], r), v0 = add(scale(pl[2], vc), cross(F.omega, p0)), fate = 'survived', tEnd = t0 + days * DAY;
          var res = fly(t0, p0.concat(v0), tEnd, ctx, { samples: Math.ceil(days * 2), stop: function (t, y) { var d = norm(y.slice(0, 3)); if (d < body.radius_m) { fate = 'impact'; return true; } if (d > rH) { fate = 'escape'; return true; } return false; } });
          row[pl[0]] = { fate: res.failed ? 'failed' : fate, days: ((res.t || tEnd) - t0) / DAY };
        });
        out.push(row);
      }
      return out;
    }

    // ==================================================================================================================
    // The chain: importing idea 41's handoff
    var REL = 1e-9;
    /**
     * Idea 41's handoff, checked for its internal consistency (this page does not re-fly ideas 40 and 41: their kernels
     * and ephemerides are 420 KB and ten seconds; idea 41's own page re-checks it, and this module's tests run idea 41's
     * parser on the committed sample). Returns the arrival, the target and what 41 says about the link.
     */
    function importSignal(h41) {
      var h = h41;
      if (typeof h41 === 'string') { try { h = JSON.parse(h41); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 41 or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 41 (Signal) or from this page.') };
      if (h.from !== '41-signal') return { refusal: refusal('invalid_input', 'That handoff is from ' + h.from + '; this module takes idea 41\'s.', h.from === '40-long-coast' ? 'Open it in idea 41 (Signal) first and bring its export.' : 'A handoff from idea 41 (Signal) or from this page.') };
      var I = h.inputs || {}, O = h.outputs || {}, h40 = I.long_coast_handoff, problems = [];
      if (!h40 || h40.from !== '40-long-coast' || !h40.outputs || !h40.outputs.arrival_state) return { refusal: refusal('invalid_input', 'This 41 handoff carries no idea 40 handoff with an arrival state.', 'The unedited handoff idea 41 exported.') };
      var AS = h40.outputs.arrival_state.value, h39 = h40.inputs && h40.inputs.lamberts_road_handoff, tgt = h39 && h39.outputs && h39.outputs.target && h39.outputs.target.value;
      if (!tgt) return { refusal: refusal('invalid_input', 'The handoff carries no target (idea 39\'s output inside idea 40\'s).', 'The unedited handoff idea 41 exported.') };
      var vec = function (v) { return Array.isArray(v) && v.length === 3 && v.every(num); };
      if (!num(AS.tdb_s_past_j2000) || !vec(AS.r_m) || !vec(AS.v_m_s) || !vec(AS.target_r_m) || !vec(AS.target_v_m_s) || !vec(AS.v_infinity_arrival_m_s)) return { refusal: refusal('invalid_input', 'The arrival state is incomplete.', 'The unedited handoff idea 41 exported.') };
      var vinf = sub(AS.v_m_s, AS.target_v_m_s), rho = sub(AS.r_m, AS.target_r_m);
      if (norm(sub(vinf, AS.v_infinity_arrival_m_s)) > REL * norm(vinf) + 1e-6) problems.push('its v-infinity is not the spacecraft minus the target velocity');
      if (Math.abs(norm(vinf) - AS.v_infinity_arrival_magnitude_m_s) > 1e-6 * norm(vinf)) problems.push('its v-infinity magnitude disagrees with the vector');
      if (norm(rho) > 1e5) problems.push('the arrival is ' + (norm(rho) / 1000).toFixed(0) + ' km from the target, not at it');
      if (utcOf(AS.tdb_s_past_j2000).slice(0, 19) !== String(AS.utc).slice(0, 19)) problems.push('its arrival UTC does not match its TDB');
      var AL = O.arrival_link && O.arrival_link.value;
      if (!AL || !num(AL.range_m) || !num(AL.owlt_s) || !num(AL.rtlt_s)) problems.push('it has no arrival link');
      else {
        if (Math.abs(AL.tdb_s_past_j2000 - AS.tdb_s_past_j2000) > 1e-3) problems.push('the link and the arrival are at different epochs');
        if (Math.abs(AL.owlt_s * C_LIGHT - AL.range_m) > 1e-6 * AL.range_m) problems.push('its one-way light time is not its range / c');
        if (Math.abs(AL.rtlt_s / AL.owlt_s - 2) > 1e-3) problems.push('its round trip is not about twice the one-way light time');
      }
      var CT = O.comms_timeline && O.comms_timeline.value;
      if (!CT || !Array.isArray(CT.utc) || !Array.isArray(CT.range_m) || CT.utc.length !== CT.range_m.length) problems.push('it has no comms timeline');
      var cov = h40.outputs.arrival_covariance && h40.outputs.arrival_covariance.value;
      if (!cov || !num(cov.knowledge_position_sigma_rss_m)) problems.push('idea 40\'s arrival covariance is missing');
      if (!Array.isArray(h.refusals)) problems.push('it has no refusals list');
      else { var own = h.refusals.filter(function (r) { return !r.from; }).map(function (r) { return r.applies_to; }); if (own.indexOf('spacecraft') < 0 || own.indexOf('uplink') < 0) problems.push('idea 41\'s own refusals (spacecraft, uplink) are missing'); }
      if (problems.length) return { refusal: refusal('invalid_input', 'The handoff is not self-consistent: ' + problems.join('; ') + '. It was edited, or is not idea 41\'s.', 'The unedited handoff idea 41 exported.') };
      return { from: '41-signal', h41: h, target: tgt, arrival: { t: AS.tdb_s_past_j2000, rho: rho, v: vinf, astR: AS.target_r_m.slice(), astV: AS.target_v_m_s.slice() },
        knowledgeSigma_m: cov.knowledge_position_sigma_rss_m, link: AL, telecom: O.telecom && O.telecom.value, timeline: CT, tcm: h40.outputs.tcm_budget && h40.outputs.tcm_budget.value };
    }
    /** The as-flown OSIRIS-REx case: Horizons' state relative to Bennu on 2018-08-01 and Bennu about the Sun. */
    function orexCase() {
      var D = HZ.orex.daily, s = D.rel[0], b = D.bennuHelio[0];
      return { from: 'orex2018', target: { designation: '101955', name: BD['101955'].name },
        arrival: { t: tdbOfJd(D.jd0), rho: s.slice(0, 3), v: s.slice(3), astR: b.slice(0, 3), astV: b.slice(3) },
        firstBurnAt: tdbOfUtc(A19.table1[0][1]), knowledgeSigma_m: null, link: null, telecom: null, timeline: null, tcm: null };
    }

    /** Earth's tide on the approach and the stay against the Sun's, from idea 41's weekly Earth range. */
    function earthTideCheck(src, tFrom, tTo, astAt) {
      var T = src.timeline; if (!T) return null;
      var worst = null;
      for (var i = 0; i < T.utc.length; i++) {
        var t = tdbOfUtc(T.utc[i] + 'T00:00:00Z'); if (t < tFrom - 7 * DAY || t > tTo + 7 * DAY) continue;
        // review: the Sun's tide at the asteroid's own distance from the Sun on that date (it was taken at 1 au)
        var A = astAt ? astAt(t) : null, dSun = A ? norm(A.r) : AU;
        var ratio = (MU_EARTH / Math.pow(T.range_m[i], 3)) / (MU_SUN / Math.pow(dSun, 3));
        if (!worst || ratio > worst.ratio) worst = { ratio: ratio, utc: T.utc[i], range_m: T.range_m[i], sun_distance_m: dSun };
      }
      return worst;
    }

    // ==================================================================================================================
    function run(src, Sin) {
      var S = clone(Sin), R = { S: S, src: src, refusals: [] };
      var errs = validSettings(S);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      var isp = S.craft === 'near' ? nearIsp() : S.isp_s;
      if (!num(isp)) return { refusal: refusal('insufficient_data', 'A custom spacecraft needs a specific impulse.', 'Its engine\'s specific impulse (s).', { applies_to: 'settings' }), S: S };
      if (S.craft === 'near') { S.dry_kg = CRAFT.near.dry_kg; S.propellant_kg = CRAFT.near.propellant_kg; S.thrust_N = CRAFT.near.mainThrust_N; S.smallThrust_N = CRAFT.near.smallThrust_N; }
      R.isp_s = isp;
      var des = String(src.target.designation);
      var body = bodyModel(des, S, src.target); if (body.refusal) return { refusal: body.refusal, S: S };
      R.body = body;
      // review: a stand-off at or below the surface is not a place to hold station (it was flown as one)
      if (!(S.standoff_m > body.radius_m)) return { refusal: refusal('invalid_input', 'The stand-off (' + S.standoff_m + ' m from the centre) is inside ' + body.name + ', whose radius is ' + body.radius_m.toFixed(0) + ' m (' + body.radius_source + ').', 'A stand-off above the surface (module 44 lands).', { applies_to: 'standoff' }), S: S };
      if (body.GM_confidence !== 'measured') R.refusals.push(refusal('insufficient_data', body.name + '\'s mass has not been measured: GM ' + body.GM_m3_s2.toPrecision(3) + ' m^3/s^2 is ' + (des === '99942' && body.GM_range_m3_s2 ? 'the OSIRIS-APEX team\'s estimate (' + body.GM_range_m3_s2.join(' to ') + ')' : 'a density (' + body.density_kg_m3.toPrecision(4) + ' kg/m^3) times a sphere') + '. Orbits and hover costs near it move with it.', 'A radio-science mass from a spacecraft at the body (as OSIRIS-REx measured Bennu\'s; OSIRIS-APEX will measure Apophis\'s).', { applies_to: 'body_mass' }));
      var ap = approach(src.arrival, S, body, src.firstBurnAt);
      if (ap.refusal) return { refusal: ap.refusal, S: S };
      R.ap = ap;
      var reg = regimes(body.GM_m3_s2, norm(ap.astAt(ap.standoff.t).r), S.am_m2_kg, S.cr);
      R.regimes = reg;
      // mass ledger: TCMs (idea 40) then each burn, main engine above 1 m/s, small thrusters below
      var tcmDv = 0;
      if (src.tcm && S.tcm !== 'none') tcmDv = S.tcm === 'mean' ? src.tcm.total_mean_m_s : S.tcm === 'p99' ? src.tcm.total_p99_m_s : src.tcm.total_p9973_m_s;
      var hv = hover(ap.standoff.t, ap.standoff.r, ap.ctx, S.box_m);
      R.hover = hv;
      var stayDv = hv.dv_per_day_m_s * S.stayDays, burnDv = ap.burns.reduce(function (s, b) { return s + norm(b.dv); }, 0);
      var needDv = tcmDv + burnDv + stayDv, ratio = Math.exp(needDv / ve(isp)), needProp = S.dry_kg * (ratio - 1);
      var loaded = S.tanks === 'sized' ? needProp : S.propellant_kg;
      var m = S.dry_kg + loaded, launch = m, ledger = [{ item: 'Launch (dry ' + S.dry_kg + ' kg + propellant)', dv_m_s: 0, mass_kg: m }];
      if (tcmDv > 0) { m *= Math.exp(-tcmDv / ve(isp)); ledger.push({ item: 'Cruise TCMs (idea 40, ' + S.tcm + ')', dv_m_s: tcmDv, mass_kg: m }); }
      var mArr = m;
      R.burns = ap.burns.map(function (b) {
        var dv = norm(b.dv), main = dv > 1, F = main ? S.thrust_N : S.smallThrust_N, fb = finiteBurn(m, dv, F, isp, norm(b.vBefore) * (main ? 1 : 0));
        var A = ap.astAt(b.t), ang = samAngles(b.r, A), row = { name: b.name, t: b.t, range_m: ang.range_m, lat_deg: ang.lat_deg, lon_deg: ang.lon_deg, phase_deg: ang.phase_deg,
          speed_before_m_s: norm(b.vBefore), speed_after_m_s: norm(b.vAfter), dv_m_s: dv, dv_vec: b.dv, engine: main ? 'main' : 'small', thrust_N: F, mass_before_kg: m,
          propellant_kg: fb.propellant_kg, duration_s: fb.duration_s, distance_m: main ? fb.distance_m : null };
        m = fb.m1_kg; ledger.push({ item: b.name, dv_m_s: dv, mass_kg: m });
        return row;
      });
      var mStand = m;
      if (stayDv > 0) { m *= Math.exp(-stayDv / ve(isp)); ledger.push({ item: 'Holding station ' + S.stayDays + ' days', dv_m_s: stayDv, mass_kg: m }); }
      R.mass = { isp_s: isp, dry_kg: S.dry_kg, loaded_kg: loaded, launch_kg: launch, arrival_kg: mArr, standoff_kg: mStand, end_of_stay_kg: m, required_propellant_kg: needProp, required_dv_m_s: needDv,
        tcm_dv_m_s: tcmDv, burns_dv_m_s: burnDv, stay_dv_m_s: stayDv, ledger: ledger, asbuilt_kg: S.craft === 'near' ? CRAFT.near.propellant_kg : S.propellant_kg };
      if (S.tanks === 'asbuilt' && needProp > S.propellant_kg) {
        return { refusal: refusal('out_of_envelope', 'The tanks run dry: this approach needs ' + needDv.toFixed(0) + ' m/s (' + needProp.toFixed(0) + ' kg of propellant on a ' + S.dry_kg + ' kg spacecraft at ' + isp.toFixed(0) + ' s), the spacecraft carries ' + S.propellant_kg + ' kg (' + (ve(isp) * Math.log((S.dry_kg + S.propellant_kg) / S.dry_kg)).toFixed(0) + ' m/s).', 'Tanks sized to the job, an arrival with a smaller v-infinity (idea 39), or a spacecraft with more propellant.', { applies_to: 'tankage' }), S: S, R: R };
      }
      if (needProp > S.propellant_kg + 1e-9) R.refusals.push(refusal('out_of_envelope', (S.craft === 'near' ? 'NEAR Shoemaker' : 'This spacecraft') + ' as built carried ' + R.mass.asbuilt_kg + ' kg of propellant (' + (ve(isp) * Math.log((S.dry_kg + R.mass.asbuilt_kg) / S.dry_kg)).toFixed(0) + ' m/s); this approach needs ' + needDv.toFixed(0) + ' m/s, so the tanks are sized to ' + needProp.toFixed(0) + ' kg with the dry mass held at ' + S.dry_kg + ' kg, which understates a real redesign (bigger tanks weigh more).', 'A spacecraft designed for this arrival, or a transfer with a smaller arrival v-infinity (idea 39).', { applies_to: 'tankage' }));
      // finite burns that would not fit in their own leg
      R.burns.forEach(function (b, i) { if (b.engine === 'main' && num(b.distance_m) && b.distance_m > 0.5 * b.range_m) R.refusals.push(refusal('out_of_envelope', b.name + ' takes ' + (b.duration_s / HOUR).toFixed(1) + ' h at ' + b.thrust_N + ' N and covers ' + (b.distance_m / 1000).toFixed(0) + ' km while braking, more than half the ' + (b.range_m / 1000).toFixed(0) + ' km to the asteroid: the impulsive plan does not hold.', 'More thrust, or brake farther out.', { applies_to: 'finite_burn' })); });
      // navigation: the ground's loop against each leg, and detection
      var loop = S.groundLoopDays * DAY + (src.link ? src.link.rtlt_s : 0);
      R.legsShort = [];
      for (var i = 0; i + 1 < R.burns.length; i++) { var lt = R.burns[i + 1].t - R.burns[i].t; if (lt < loop) R.legsShort.push({ from: R.burns[i].name, to: R.burns[i + 1].name, days: lt / DAY }); }
      var det = detection(ap, body, S);
      if (det.refusal) R.refusals.push(det.refusal); else R.detection = det;
      var DT = R.detection;
      if (DT && DT.first && DT.leadIsLowerBound && DT.leadToFirstBurn_s < loop) R.refusals.push(refusal('insufficient_data', 'The camera already sees ' + body.name + ' (V ' + DT.vLimit.toFixed(1) + ') where the computed arc begins, ' + (DT.leadToFirstBurn_s / DAY).toFixed(1) + ' days before the first burn: first sight is earlier, by an amount this arc does not reach, so it cannot say whether it beats the ' + S.groundLoopDays + '-day ground loop.', 'A shorter ground loop, or the cruise\'s own record of first sight (idea 40).', { applies_to: 'autonomy' }));
      else if (DT && (!DT.first || DT.leadToFirstBurn_s < loop)) R.refusals.push(refusal('out_of_envelope', DT.first ? 'The camera first sees ' + body.name + ' (V ' + DT.vLimit.toFixed(1) + ') ' + (DT.leadToFirstBurn_s >= 0 ? (DT.leadToFirstBurn_s / DAY).toFixed(1) + ' days before the first braking burn, less than' : (-DT.leadToFirstBurn_s / DAY).toFixed(1) + ' days after the first braking burn, inside') + ' the ' + S.groundLoopDays + '-day ground loop (AAS 19-035: final maneuver designs 5-7 days ahead): the burn would be aimed without the asteroid in sight.' : 'The camera does not see ' + body.name + ' before the first burn (' + DT.before + ').', 'Onboard optical navigation and autonomous targeting, a slower arrival, or braking farther out on radio navigation alone.', { applies_to: 'autonomy' }));
      // knowledge before the camera: the spacecraft (idea 40) and the asteroid's own orbit (Horizons, at the chain's arrival)
      R.knowledge = { spacecraft_m: src.knowledgeSigma_m, asteroid_m: null };
      if (des === '99942' && src.from === '41-signal') { var sg = HZ.apophisArrival.sigma_xyz_m; R.knowledge.asteroid_m = Math.sqrt(sg[0] * sg[0] + sg[1] * sg[1] + sg[2] * sg[2]); }
      // planets: the Earth's tide over the approach and the stay, from idea 41's Earth range
      var et = earthTideCheck(src, ap.t1, ap.standoff.t + S.stayDays * DAY, ap.astAt);
      R.earthTide = et;
      if (et && et.ratio > 0.01) R.refusals.push(refusal('out_of_envelope', 'On ' + et.utc + ' the Earth is ' + (et.range_m / AU).toFixed(3) + ' au away and its tide is ' + (100 * et.ratio).toFixed(0) + '% of the Sun\'s (at ' + (et.sun_distance_m / AU).toFixed(3) + ' au from the Sun): the planets are not in this model.', 'A stay that ends before the Earth comes close, or a model with the planets (idea 40\'s propagator).', { applies_to: 'planets' }));
      // the stand-off and the stay
      var sim = deadband(ap.standoff.t, ap.standoff.r, ap.ctx, S.box_m, S.simDays);
      R.deadband = sim.failed ? null : sim;
      var late = S.lateUpdateHours * HOUR + (src.link ? src.link.rtlt_s : 0);   // AAS 19-035 p. 12: 24-hour maneuver late updates in proximity operations
      R.lateLoop_s = late;
      if (hv.cycle_s && hv.cycle_s < late) R.refusals.push(refusal('out_of_envelope', 'Holding a ' + S.box_m + ' m box needs a burn every ' + (hv.cycle_s / HOUR).toFixed(1) + ' h, faster than the ground can turn a maneuver round (' + (late / HOUR).toFixed(1) + ' h, a late update plus the light time): station-keeping must be autonomous, or the box larger.', 'A larger box (the cycle grows as its square root), or onboard station-keeping.', { applies_to: 'station_keeping' }));
      if (S.scan) R.scan = orbitScan(ap.standoff.t, ap.ctx, body, reg.hill_radius_m, 30);
      if (ap.standoff.r && norm(ap.standoff.r) > reg.hill_radius_m) R.refusals.push(refusal('out_of_envelope', 'The stand-off (' + (S.standoff_m / 1000).toFixed(1) + ' km) is outside ' + body.name + '\'s Hill sphere (' + (reg.hill_radius_m / 1000).toFixed(1) + ' km): the spacecraft is flying in formation with the asteroid about the Sun, not near it.', 'A stand-off inside the Hill sphere.', { applies_to: 'standoff' }));
      // always: the gravity is a point mass, and the spacecraft is borrowed
      R.refusals.push(refusal('insufficient_data', 'Gravity is a point mass: ' + body.name + '\'s shape and spin are not in it, so orbits within a few radii are not right here.', 'A shape model and density (module 43, Lumpy).', { applies_to: 'gravity_field' }));
      R.refusals.push(refusal('insufficient_data', 'The chain has no spacecraft yet: the engine is ' + (S.craft === 'near' ? 'NEAR Shoemaker\'s (NSSDCA: 450 N, 1450 m/s from 318 kg on 487 kg dry, so ' + isp.toFixed(1) + ' s effective)' : 'a custom one') + ', the sunlit area per mass ' + (S.am_m2_kg === 1 / A24.massToArea_kg_m2 ? 'OSIRIS-APEX\'s (AAS 24-063: 81.119 kg/m^2)' : S.am_m2_kg > 0 ? r9(S.am_m2_kg) + ' m^2/kg (set here)' : 'zero (sunlight off)') + '.', 'The mission\'s own spacecraft: dry mass, tanks, engines and their specific impulse, sunlit area.', { applies_to: 'spacecraft' }));
      return R;
    }

    // ==================================================================================================================
    // Handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function buildHandoff(R, produced) {
      var S = R.S, src = R.src, ap = R.ap, b = R.body, so = ap.standoff, A = ap.astAt(so.t), ang = samAngles(so.r, A);
      var h = { handoff: 'long-way-round', version: 1, from: '42-closing-in', produced: produced || new Date().toISOString(), inputs: { signal_handoff: src.h41 || null, case: src.h41 ? null : src.from, settings: clone(S) }, outputs: {} };
      var O = h.outputs;
      O.standoff_state = qv({ tdb_s_past_j2000: so.t, utc: utcOf(so.t), frame: 'asteroid-centred ICRF/J2000 (not rotating)', r_m: vr9(so.r), v_m_s: vr9(so.v),
        sam: { range_m: r9(ang.range_m), lat_deg: r9(ang.lat_deg), lon_deg: r9(ang.lon_deg), phase_deg: r9(ang.phase_deg) },
        asteroid_heliocentric: { r_m: vr9(A.r), v_m_s: vr9(A.v), frame: 'heliocentric ICRF/J2000, Sun centre' }, spacecraft_heliocentric: { r_m: vr9(add(A.r, so.r)), v_m_s: vr9(add(A.v, so.v)) } },
        's, m, m/s, deg', 'derived', KERNEL + ' approach(): idea 40\'s arrival flown back to the first burn, then each burn targeted under the asteroid point mass, the Sun\'s exact tide and sunlight; the asteroid on idea 39\'s conic');
      O.body = qv({ designation: b.designation, name: b.name, GM_m3_s2: r9(b.GM_m3_s2), GM_range_m3_s2: b.GM_range_m3_s2 ? vr9(b.GM_range_m3_s2) : null, GM_confidence: b.GM_confidence, GM_source: b.GM_source,
        radius_m: r9(b.radius_m), radius_confidence: b.radius_confidence, radius_source: b.radius_source, bulk_density_kg_m3: r9(b.density_kg_m3), rotation_h: b.rotation_h, H: b.H, G: b.G,
        surface_gravity_m_s2: r9(b.surface_gravity_m_s2), escape_speed_m_s: r9(b.escape_speed_m_s), hill_radius_m: r9(R.regimes.hill_radius_m), sun_distance_m: r9(R.regimes.sun_distance_m) },
        'm^3/s^2, m, kg/m^3, h, m/s^2, m/s', b.GM_confidence === 'measured' ? 'measured' : 'assumed', 'JPL SBDB (snapshots/bodies.js), AAS 24-063 Table 2 for Apophis\'s GM, NIST G');
      O.environment = qv({ srp_accel_m_s2: r9(R.regimes.srp_accel_m_s2), gravity_at_standoff_m_s2: r9(R.hover.gravity_m_s2), tide_at_standoff_m_s2: r9(R.hover.tide_m_s2), srp_at_standoff_m_s2: r9(R.hover.srp_m_s2),
        gravity_equals_srp_m: r9(R.regimes.gravity_equals_srp_m), anh3bp_length_unit_m: r9(R.regimes.du_m), anh3bp_beta: r9(R.regimes.beta), dark_side_equilibrium_m: r9(R.regimes.dark_equilibrium_m), area_per_mass_m2_kg: r9(S.am_m2_kg) },
        'm/s^2, m', 'derived', KERNEL + ' regimes(), hover(): solar pressure ' + r9(P1AU) + ' N/m^2 at 1 au (idea 40), area per mass ' + r9(S.am_m2_kg) + ' m^2/kg; the dark-side equilibrium is AAS 24-063\'s circular ANH3BP point with no shadow (on the anti-Sun axis it lies in the asteroid\'s shadow, where this model has no sunlight)');
      O.approach = qv({ template: S.template, first_burn_utc: utcOf(ap.t1), standoff_utc: utcOf(so.t), duration_s: r9(so.t - ap.t1), total_dv_m_s: r9(R.mass.burns_dv_m_s),
        burns: R.burns.map(function (q) { return { name: q.name, utc: utcOf(q.t), tdb_s_past_j2000: q.t, range_m: r9(q.range_m), lat_deg: r9(q.lat_deg), lon_deg: r9(q.lon_deg), dv_m_s: r9(q.dv_m_s), dv_vec_m_s: vr9(q.dv_vec), speed_before_m_s: r9(q.speed_before_m_s), engine: q.engine, propellant_kg: r9(q.propellant_kg), duration_s: r9(q.duration_s) }; }),
        legs_shorter_than_ground_loop: R.legsShort.map(function (l) { return { from: l.from, to: l.to, days: r9(l.days) }; }) },
        's, m, deg, m/s, kg', 'derived', KERNEL + ' approach(): impulsive burns targeted by Newton iteration; durations by the rocket equation at the main or small thrust');
      O.mass = qv({ isp_s: r9(R.mass.isp_s), dry_kg: r9(R.mass.dry_kg), propellant_loaded_kg: r9(R.mass.loaded_kg), launch_kg: r9(R.mass.launch_kg), arrival_kg: r9(R.mass.arrival_kg), standoff_kg: r9(R.mass.standoff_kg), end_of_stay_kg: r9(R.mass.end_of_stay_kg),
        required_propellant_kg: r9(R.mass.required_propellant_kg), required_dv_m_s: r9(R.mass.required_dv_m_s), tcm_dv_m_s: r9(R.mass.tcm_dv_m_s), tanks: S.tanks },
        'kg, s, m/s', 'assumed', 'NSSDCA 1996-008A (NEAR Shoemaker) or the settings; the rocket equation over idea 40\'s TCMs, the burns and the stay');
      O.station_keeping = qv({ point_sam: { range_m: r9(ang.range_m), lat_deg: r9(ang.lat_deg), lon_deg: r9(ang.lon_deg) }, control_accel_m_s2: r9(R.hover.accel_m_s2), dv_per_day_m_s: r9(R.hover.dv_per_day_m_s), box_m: S.box_m,
        cycle_s: r9(R.hover.cycle_s), dv_per_cycle_m_s: r9(R.hover.dv_per_cycle_m_s), stay_days: S.stayDays, stay_dv_m_s: r9(R.mass.stay_dv_m_s),
        simulated: R.deadband ? { days: R.deadband.days, dv_m_s: r9(R.deadband.dv_m_s), burns: R.deadband.burns, max_offset_m: r9(R.deadband.max_offset_m) } : null },
        'm/s^2, m/s, m, s', 'derived', KERNEL + ' hover(), deadband(): a point fixed in the SAM frame; the deadband flown under every force');
      O.navigation = qv({ spacecraft_knowledge_sigma_m: r9(R.knowledge.spacecraft_m), asteroid_ephemeris_sigma_m: r9(R.knowledge.asteroid_m),
        detection: R.detection ? { v_limit: r9(R.detection.vLimit), imager: R.detection.imager, first_seen_utc: R.detection.first ? utcOf(R.detection.first.t) : null, first_seen_range_m: R.detection.first ? r9(R.detection.first.range_m) : null,
          lead_to_first_burn_s: r9(R.detection.leadToFirstBurn_s), lead_is_lower_bound: !!(R.detection.first && R.detection.leadIsLowerBound), optical_sigma_at_first_burn_m: r9(R.detection.lateralSigma(R.burns[0].range_m)) } : null,
        ground_loop_s: r9(S.groundLoopDays * DAY + (src.link ? src.link.rtlt_s : 0)), round_trip_light_time_s: src.link ? r9(src.link.rtlt_s) : null },
        'm, s', 'derived', 'Horizons 1-sigma for Apophis at the arrival; idea 40\'s knowledge covariance; AAS 19-035 PolyCam iFOV and centroiding; the H-G law (Horizons manual)');
      h.refusals = (src.h41 ? (src.h41.refusals || []).map(function (r) { var q = clone(r); if (!q.from) q.from = '41-signal'; return q; }) : []).concat(R.refusals.map(clone));
      h.assumptions = [
        'Frame: asteroid-centred ICRF/J2000 axes, not rotating; the asteroid on a conic about the Sun (idea 39\'s propagate()) from idea 40\'s arrival state; SAM angles as AAS 19-035 defines them. Time TDB s past J2000, UTC = TDB - ' + TDB_UTC + ' s.',
        'Forces: the asteroid as a point mass (GM ' + r9(b.GM_m3_s2) + ' m^3/s^2), the Sun\'s tide exact, sunlight on an absorber of ' + r9(S.am_m2_kg) + ' m^2/kg (cr ' + S.cr + ') cut off in a cylindrical shadow; no planets, no asteroid shape or spin.',
        'Burns impulsive for targeting; main engine (' + S.thrust_N + ' N) above 1 m/s, small thrusters (' + S.smallThrust_N + ' N) below; one specific impulse (' + r9(R.isp_s) + ' s) for all; no settling burns, no execution errors, no navigation errors.',
        'The incoming arc is flown without the asteroid\'s pull; the first burn is where it reaches ' + (S.firstBurnRange_m / 1000).toFixed(0) + ' km; waypoints ' + (S.template === 'orex' ? 'from AAS 19-035 Table 1 (OSIRIS-REx at Bennu, AAM-2a waived as flown) at the same days after AAM-1' : 'one leg of ' + S.directDays + ' days') + '.',
        'Station-keeping holds a point fixed in the rotating SAM frame; its cost is the control acceleration\'s size per day; the deadband is a sphere of diameter ' + S.box_m + ' m.'
      ];
      return h;
    }
    function numDiff(a, b, path) {
      if (typeof a === 'number' || typeof b === 'number') {
        if (!(typeof a === 'number' && typeof b === 'number')) return path;
        if (a === b) return null;
        if (/tdb_s_past_j2000$/.test(path)) return Math.abs(a - b) <= 1e-3 ? null : path;
        var tol = /(_m|r_m\.\d|v_m_s\.\d)$/.test(path) ? 1e-6 : 1e-6;
        return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) ? null : path;
      }
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : path;
      if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return path;
      var ks = {}; Object.keys(a).forEach(function (k) { ks[k] = 1; }); Object.keys(b).forEach(function (k) { ks[k] = 1; });
      for (var k in ks) { var d = numDiff(a[k], b[k], path + '.' + k); if (d) return d; }
      return null;
    }
    function codes(L) { return (L || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join(','); }
    /** Read a 42 handoff back: the 41 inside checked, everything recomputed and compared (1e-6 relative, epochs 1 ms). */
    function parseHandoff(h42) {
      var h = h42;
      if (typeof h42 === 'string') { try { h = JSON.parse(h42); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 41 or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 41 (Signal) or from this page.') };
      if (h.from === '41-signal') { var s41 = importSignal(h); return s41.refusal ? s41 : { from: '41-signal', src: s41 }; }
      if (h.from !== '42-closing-in') return importSignal(h);
      var I = h.inputs || {}, src;
      if (I.signal_handoff) { src = importSignal(I.signal_handoff); if (src.refusal) return src; }
      else if (I.case === 'orex2018') src = orexCase();
      else return { refusal: refusal('invalid_input', 'This 42 handoff carries neither idea 41\'s handoff nor a known case.', 'The unedited handoff this page exported.') };
      if (!I.settings) return { refusal: refusal('invalid_input', 'This 42 handoff has no settings.', 'The unedited handoff this page exported.') };
      var R = run(src, I.settings);
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced), keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) {
        var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i]);
        if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '42-closing-in', h42: h, src: src, settings: I.settings, R: R };
    }

    // ==================================================================================================================
    // Oracles: OSIRIS-REx at Bennu as flown (Horizons), AAS 19-035's maneuvers, SBDB's GM, Horizons' magnitudes
    function bennuCtx(row, t0, am, mu) { return { mu: mu, radius: BD['101955'].diameter_m / 2, astAt: conic(row.slice(0, 3), row.slice(3), t0), am: am, cr: 1, shadow: true }; }
    function burnRows(ev) {
      var B = HZ.orex.burns, k = B.events.indexOf(ev); if (k < 0) return null;
      var o = {}; B.offsetsH.forEach(function (h, j) { var i = k * 4 + j; o[h] = { t: tdbOfJd(B.jd[i]), rel: B.rel[i], ast: B.bennuHelio[i] }; });
      return o;
    }
    /** A maneuver's dv measured from the reconstructed trajectory: fly the state `span` hours before to `span` hours after, ballistic, and difference. */
    function measuredDv(ev, span, am) {
      var o = burnRows(ev), a = o[-span], b = o[span], ctx = bennuCtx(a.ast, a.t, am, BD['101955'].GM_m3_s2);
      var f = fly(a.t, a.rel.slice(), b.t, ctx); if (f.failed) return null;
      return { dv_m_s: norm(sub(b.rel.slice(3), [f.y[3], f.y[4], f.y[5]])), pos_mismatch_m: norm(sub(b.rel.slice(0, 3), [f.y[0], f.y[1], f.y[2]])) };
    }
    /** The planner on the flown state: from 3 h before a maneuver, coast to its epoch, target the next Table 1 location. */
    function plannedDv(ev, next, am) {
      var o = burnRows(ev), a = o[-3], ctx = bennuCtx(a.ast, a.t, am, BD['101955'].GM_m3_s2), T = A19.table1;
      var row = T.filter(function (q) { return q[0] === ev; })[0], nrow = T.filter(function (q) { return q[0] === next; })[0];
      var tb = tdbOfUtc(row[1]), tn = tdbOfUtc(nrow[1]), c = fly(a.t, a.rel.slice(), tb, ctx);
      var target = fromSam(nrow[2] * 1000, nrow[3], nrow[4], ctx.astAt(tn)), r = c.y.slice(0, 3), vIn = c.y.slice(3);
      var A = aim(tb, r, scale(sub(target, r), 1 / (tn - tb)), tn, target, ctx);
      if (A.failed) return null;
      return { dv_m_s: norm(sub(A.v, vIn)), from: samAngles(r, ctx.astAt(tb)) };
    }
    /** Fly a Horizons state on, ballistic, and compare with Horizons at each later day. */
    function ballistic(i0, i1, am, mu) {
      var D = HZ.orex.daily, t0 = tdbOfJd(D.jd0) + i0 * DAY, ctx = bennuCtx(D.bennuHelio[i0], t0, am, mu), y = D.rel[i0].slice(), errs = [];
      for (var i = i0 + 1; i <= i1; i++) { var f = fly(t0 + (i - 1 - i0) * DAY, y, t0 + (i - i0) * DAY, ctx); y = f.y; errs.push(norm(sub(y.slice(0, 3), D.rel[i].slice(0, 3)))); }
      return { final_m: errs[errs.length - 1], max_m: Math.max.apply(null, errs), days: i1 - i0, errs: errs };
    }
    /** Fit the area per mass on a ballistic arc (golden section on the final miss). */
    function fitAm(i0, i1) {
      var lo = 0, hi = 0.05, g = (Math.sqrt(5) - 1) / 2, f = function (am) { return ballistic(i0, i1, am, BD['101955'].GM_m3_s2).final_m; };
      var a = hi - g * (hi - lo), b = lo + g * (hi - lo), fa = f(a), fb = f(b);
      for (var it = 0; it < 40; it++) { if (fa < fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = f(a); } else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = f(b); } }
      var am = (lo + hi) / 2; return { am_m2_kg: am, final_m: f(am) };
    }
    /** Orbital A: fit the initial state, Bennu's GM and the area per mass to Horizons' hourly states (damped Gauss-Newton; arcs over 72 h by continuation from the 72-h fit). */
    function fitOrbitA(hours, opts) {
      opts = opts || {};
      var O = HZ.orex.orbitA, t0 = tdbOfJd(O.jd0), n = Math.min(hours, (O.rel.length - 1) * O.stepHours), stride = opts.stride || 4;
      var obs = []; for (var i = stride; i <= n; i += stride) obs.push({ t: t0 + i * HOUR, r: O.rel[i / O.stepHours].slice(0, 3) });
      var ast = conic(O.bennuHelio0.slice(0, 3), O.bennuHelio0.slice(3), t0);
      var v0 = O.rel[0].slice(3), r0 = O.rel[0].slice(0, 3);
      // starting guesses independent of SBDB: the circular-orbit GM v^2 r of the first state, and OSIRIS-APEX's area per mass
      var p = O.rel[0].slice().concat([num(opts.mu0) ? opts.mu0 : dot(v0, v0) * norm(r0), num(opts.am0) ? opts.am0 : 1 / A24.massToArea_kg_m2]);
      // continuation: a long arc started cold falls into a wrong minimum, so fit 72 h first and lengthen from there
      if (n > 72 && !opts.p0) { var short = fitOrbitA(72, { stride: stride }); if (short.failed) return short; p = short.p.slice(); }
      if (opts.p0) p = opts.p0.slice();
      function resid(q) {
        var ctx = { mu: q[6], radius: BD['101955'].diameter_m / 2, astAt: ast, am: q[7], cr: 1, shadow: true }, y = q.slice(0, 6), t = t0, out = [];
        for (var k = 0; k < obs.length; k++) { var f = fly(t, y, obs[k].t, ctx); if (f.failed) return null; y = f.y; t = obs[k].t; out.push(y[0] - obs[k].r[0], y[1] - obs[k].r[1], y[2] - obs[k].r[2]); }
        return out;
      }
      var rms = null, np = 8;
      for (var it = 0; it < 12; it++) {
        var r0 = resid(p); if (!r0) return { failed: true };
        var m = r0.length, J = [];
        for (var j = 0; j < np; j++) { var dp = j < 3 ? 1 : j < 6 ? 1e-6 : j === 6 ? 1e-4 : 1e-5, q = p.slice(); q[j] += dp; var rj = resid(q); J.push(rj.map(function (x, i) { return (x - r0[i]) / dp; })); }
        // normal equations (8x8) by Gaussian elimination
        var N = [], g = [];
        for (var a = 0; a < np; a++) { N.push([]); var s = 0; for (var i2 = 0; i2 < m; i2++) s += J[a][i2] * r0[i2]; g.push(-s); for (var b = 0; b < np; b++) { var s2 = 0; for (var i3 = 0; i3 < m; i3++) s2 += J[a][i3] * J[b][i3]; N[a].push(s2); } }
        for (var c = 0; c < np; c++) { var piv = c; for (var rr = c + 1; rr < np; rr++) if (Math.abs(N[rr][c]) > Math.abs(N[piv][c])) piv = rr; var tmp = N[c]; N[c] = N[piv]; N[piv] = tmp; var tg = g[c]; g[c] = g[piv]; g[piv] = tg;
          for (var r2 = c + 1; r2 < np; r2++) { var fct = N[r2][c] / N[c][c]; for (var cc = c; cc < np; cc++) N[r2][cc] -= fct * N[c][cc]; g[r2] -= fct * g[c]; } }
        var dx = new Array(np); for (var r3 = np - 1; r3 >= 0; r3--) { var s3 = g[r3]; for (var c3 = r3 + 1; c3 < np; c3++) s3 -= N[r3][c3] * dx[c3]; dx[r3] = s3 / N[r3][r3]; }
        // damped: GM may change by at most 30% a step; halve the step until the residuals exist and do not grow
        var lim = Math.abs(dx[6]) > 0.3 * Math.abs(p[6]) ? 0.3 * Math.abs(p[6]) / Math.abs(dx[6]) : 1, s0 = 0, rn = null, pTry = null;
        for (var i5 = 0; i5 < r0.length; i5++) s0 += r0[i5] * r0[i5];
        for (var half = 0; half < 20; half++) {
          pTry = p.map(function (x, k) { return x + lim * dx[k]; }); rn = resid(pTry);
          if (rn) { var sT = 0; for (var i6 = 0; i6 < rn.length; i6++) sT += rn[i6] * rn[i6]; if (sT <= s0 * (1 + 1e-9)) break; }
          lim /= 2;
        }
        if (!rn) return { failed: true };
        p = pTry;
        var ss = 0; for (var i4 = 0; i4 < rn.length; i4++) ss += rn[i4] * rn[i4];
        var newRms = Math.sqrt(ss / (rn.length / 3));
        if (rms !== null && Math.abs(rms - newRms) < 1e-4 * newRms) { rms = newRms; break; }
        rms = newRms;
      }
      return { GM_m3_s2: p[6], am_m2_kg: p[7], rms_m: rms, hours: n, points: obs.length, sbdbGM_m3_s2: BD['101955'].GM_m3_s2, p: p };
    }
    function hgCheck() {
      var out = [];
      [['Bennu from OSIRIS-REx', HZ.hg.bennuFromOrex], ['Apophis from the Earth', HZ.hg.apophisFromEarth]].forEach(function (c) {
        var worst = 0, ph = [1e9, 0];
        c[1].rows.forEach(function (r) { if (r[4] > 120) return; var V = apparentMag(c[1].H, c[1].G, r[2], r[3], r[4]); worst = Math.max(worst, Math.abs(V - r[1])); ph[0] = Math.min(ph[0], r[4]); ph[1] = Math.max(ph[1], r[4]); });
        out.push({ label: c[0], rows: c[1].rows.length, worst_mag: worst, phase_deg: ph });
      });
      return out;
    }

    return {
      MU_SUN: MU_SUN, AU: AU, P1AU: P1AU, G_NEWTON: G_NEWTON, G0: G0, C_LIGHT: C_LIGHT, sources: SRC, horizons: HZ, bodies: BD,
      utcOf: utcOf, tdbOfUtc: tdbOfUtc, tdbOfJd: tdbOfJd, conic: conic, samAxes: samAxes, toSam: toSam, fromSam: fromSam, samAngles: samAngles,
      accel: accel, fly: fly, aim: aim, ve: ve, propellantFor: propellantFor, finiteBurn: finiteBurn, bodyModel: bodyModel, regimes: regimes,
      hgPhi: hgPhi, apparentMag: apparentMag, defaults: defaults, nearIsp: nearIsp, validSettings: validSettings, waypoints: waypoints, approach: approach,
      detection: detection, orexFirstImageV: orexFirstImageV, hover: hover, deadband: deadband, orbitScan: orbitScan,
      importSignal: importSignal, orexCase: orexCase, earthTideCheck: earthTideCheck, run: run, buildHandoff: buildHandoff, parseHandoff: parseHandoff, numDiff: numDiff, codes: codes,
      burnRows: burnRows, measuredDv: measuredDv, plannedDv: plannedDv, ballistic: ballistic, fitAm: fitAm, fitOrbitA: fitOrbitA, hgCheck: hgCheck, bennuCtx: bennuCtx
    };
  }
  return { create: create, DEG: DEG, DAY: DAY };
});
