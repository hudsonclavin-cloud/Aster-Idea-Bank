/* Lambert's Road: the heliocentric transfer to a real near-Earth asteroid. Idea 39 of the Aster Idea Bank, module 9 of
 * "The Long Way Round".
 *
 * Idea 38 burned the departure and handed on a hyperbolic state at cutoff, with its v-infinity in J2000 and its TDB epoch.
 * That v-infinity came from one cell of Aster's porkchop (idea 37 took it from Aster's own DLA oracle: Apophis, departure
 * 2026-07-02, 677.177 days, one revolution). This module computes the cell, and every cell around it, from first
 * principles, for any body in an excerpt of Aster's catalog: where Earth is (Horizons, Chebyshev-fitted here), where the
 * asteroid is (Aster's two-body propagation of Aster's own elements), and the conic between them that takes exactly the
 * time of flight (Lambert's problem, solved by Izzo's 2015 method for zero, one and two revolutions). Then the porkchop,
 * the chosen window, the transfer's orbit, and, when idea 38's handoff closes, what the departure it actually flew would
 * do (the miss at the asteroid if nothing is corrected, and the correction that re-aims it).
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, m/s, rad); km, days and degrees only at the edges. Time: TDB seconds
 * past J2000 (Aster's convention, TDB - UTC = 69.184 s from Aster's utc-to-tdb.ts). Frame: heliocentric ICRF/J2000 axes
 * (Aster's measured frame, INV-021; DLA is asin(vz/|v|) with no rotation, as Aster's dla.ts).
 *
 * Methods and where they come from:
 *   Lambert          D. Izzo, "Revisiting Lambert's problem", Celest. Mech. Dyn. Astr. 121 (2015) 1-15: the lambda/x
 *                    formulation, Lancaster-Blanchard time of flight with Battin's hypergeometric series near x = 1 and
 *                    Lagrange's form between, Householder iterations, his initial guesses, T_min by Halley. Written here
 *                    from the paper's equations as known from the paper and its open implementations (secondary); not
 *                    ported from Aster's izzo.ts. Checked against hapsira's izzo and lamberthub's gooding1990 (oracle/).
 *   Earth            NASA/JPL Horizons geocentre about the Sun's centre, ICRF, daily 2026-2040 (Aster's
 *                    src/v2/data/horizons-inner-solar-system-2026-2040.json), fitted by build-data.mjs with Chebyshev
 *                    polynomials (32-day segments); velocity is the series' derivative. Aster interpolates the same
 *                    records by cubic Hermite (src/v2/core/interpolators/hermite.ts); hermiteEphemeris() below does that
 *                    too, for reconciliation with Aster's own numbers.
 *   Asteroid         Aster's keplerian.ts, formula for formula: mean anomaly at GM_SUN 1.32712440018e20, Newton on
 *                    Kepler's equation (start M, or +-pi above e 0.8, tolerance 1e-12), perifocal to ecliptic, then the
 *                    J2000 obliquity 84381.448 arcsec once to ICRF.
 *   Delta-v stack    Aster's delta-v.ts: injection by vis-viva from C3 at 6,578.137 km with mu 398,600.4418, rendezvous
 *                    = arrival v-infinity, the same again home for sample return, 150 m/s station-keeping, 10 % margin.
 *   DLA band         Aster's feasibility.ts: GREEN |DLA| <= iMin, AMBER <= ceiling, RED beyond (screening only, INV-016d).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LambertsRoad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, TWO_PI = 2 * Math.PI, DEG = PI / 180, DAY = 86400;
  var KERNEL = '39-lamberts-road/lambert.js';
  var OBJECTIVES = ['c3', 'dv_oneway', 'dv_return', 'vinf_arr'];

  // ------------------------------------------------------------------ small helpers
  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) { return num(v) ? +v.toPrecision(d || 4) + '' : String(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; }
  /** Angle between two vectors, atan2(|a x b|, a.b): no acos floor near zero (Aster's DLA oracle learned this). */
  function angle(a, b) { return Math.atan2(norm(cross(a, b)), dot(a, b)); }

  // ================================================================== Lambert's problem (Izzo 2015)
  /** 2F1(3, 1; 5/2; z), Battin's series, summed to a relative term below tol. */
  function hyp2f1b(z, tol) {
    var S = 1, C = 1, j = 0;
    for (;;) {
      C = C * (3 + j) * (1 + j) / (2.5 + j) * z / (j + 1);
      S += C;
      j++;
      if (Math.abs(C) < tol || j > 2000) return S;
    }
  }
  /** Non-dimensional time of flight T(x) for N complete revolutions (Izzo 2015, eqs. 18, 20 and the Battin form). */
  function x2tof(x, N, lam) {
    var dist = Math.abs(x - 1);
    if (dist < 0.2 && dist > 0.01) {          // Lagrange's form between the two series' regions
      var a = 1 / (1 - x * x), alfa, beta;
      if (a > 0) {
        alfa = 2 * Math.acos(Math.max(-1, Math.min(1, x)));
        beta = 2 * Math.asin(Math.sqrt(lam * lam / a));
        if (lam < 0) beta = -beta;
        return a * Math.sqrt(a) * ((alfa - Math.sin(alfa)) - (beta - Math.sin(beta)) + TWO_PI * N) / 2;
      }
      alfa = 2 * Math.acosh(x);
      beta = 2 * Math.asinh(Math.sqrt(-lam * lam / a));
      if (lam < 0) beta = -beta;
      return -a * Math.sqrt(-a) * ((beta - Math.sinh(beta)) - (alfa - Math.sinh(alfa))) / 2;
    }
    var K = lam * lam, E = x * x - 1, rho = Math.abs(E), z = Math.sqrt(1 + K * E);
    if (dist < 0.01) {                        // Battin's series near the parabola
      var eta = z - lam * x, S1 = 0.5 * (1 - lam - x * eta);
      var Q = 4 / 3 * hyp2f1b(S1, 1e-11);
      return (eta * eta * eta * Q + 4 * lam * eta) / 2 + N * PI / Math.pow(rho, 1.5);
    }
    var y = Math.sqrt(rho), g = x * z - lam * E, d;   // Lancaster-Blanchard
    if (E < 0) d = N * PI + Math.acos(Math.max(-1, Math.min(1, g)));
    else d = Math.log(y * (z - lam * x) + g);
    return (x - lam * z - d / y) / E;
  }
  /** First three derivatives of T(x) (Izzo 2015, eq. 22). */
  function dTdx(x, T, lam) {
    var l2 = lam * lam, l3 = l2 * lam, umx2 = 1 - x * x, y = Math.sqrt(1 - l2 * umx2), y2 = y * y, y3 = y2 * y;
    var d1 = (3 * T * x - 2 + 2 * l3 * x / y) / umx2;
    var d2 = (3 * T + 5 * x * d1 + 2 * (1 - l2) * l3 / y3) / umx2;
    var d3 = (7 * x * d2 + 8 * d1 - 6 * (1 - l2) * l2 * l3 * x / y3 / y2) / umx2;
    return [d1, d2, d3];
  }
  /** Householder's third-order iteration on T(x) = T. Returns {x, iters, converged}. */
  function householder(T, x0, N, lam, tol, maxIter) {
    var x = x0, it = 0;
    for (; it < maxIter; it++) {
      var t = x2tof(x, N, lam), d = dTdx(x, t, lam), delta = t - T, d1s = d[0] * d[0];
      var xn = x - delta * (d1s - delta * d[1] / 2) / (d[0] * (d1s - delta * d[1]) + d[2] * delta * delta / 6);
      if (!num(xn)) return { x: x, iters: it + 1, converged: false };
      var err = Math.abs(x - xn);
      x = xn;
      if (err < tol) { it++; break; }
    }
    var ok = num(x) && x > -1 && (N === 0 || x < 1);
    if (ok) { var res = Math.abs(x2tof(x, N, lam) - T); ok = res <= 1e-10 * Math.max(1, T); }
    return { x: x, iters: it, converged: ok };
  }
  /** The minimum non-dimensional time of flight for N revolutions, by Halley's method on dT/dx = 0 from x = 0. */
  function tMin(N, lam) {
    if (N === 0) return { T: 0, x: 1 };   // parabolic limit is the M = 0 floor (approached, never reached)
    var T00 = Math.acos(lam) + lam * Math.sqrt(1 - lam * lam);
    var x = 0, T = T00 + N * PI;
    for (var it = 0; it < 30; it++) {
      var d = dTdx(x, T, lam), xn = x;
      if (d[0] !== 0) xn = x - d[0] * d[1] / (d[1] * d[1] - d[0] * d[2] / 2);
      if (!num(xn) || xn <= -1 || xn >= 1) break;
      var err = Math.abs(x - xn);
      x = xn; T = x2tof(x, N, lam);
      if (err < 1e-13) break;
    }
    return { T: T, x: x };
  }

  /**
   * Solve Lambert's problem. r1, r2 position vectors (m), tof (s), mu (m^3/s^2).
   * opts.maxRevs: highest revolution count to solve (0, 1, 2; default 0). opts.revs: an explicit list instead.
   * opts.retrograde: the other sense of motion. opts.pole: the axis "prograde" is judged about (default the frame's z,
   * as Aster's lambertMultiRev and izzo.ts do; heliocentric ICRF z is the Earth's pole, 23.44 deg from the ecliptic's).
   * Returns {ok, theta, lambda, T, s, c, sols: [{M, branch: 'single'|'left'|'right', x, iters, converged, v1, v2}],
   *          tmin: {M: seconds}, refusal}. 'left' is the multi-revolution root nearer x = -1 (Izzo's guess from
   *          (M pi + pi)/8T; poliastro's and hapsira's high path), 'right' the one nearer +1 (their low path).
   */
  function lambert(r1, r2, tof, mu, opts) {
    opts = opts || {};
    if (!(num(tof) && tof > 0)) return { ok: false, sols: [], refusal: refusal('invalid_input', 'The time of flight must be a positive number of seconds (got ' + tof + ').', 'A positive time of flight.') };
    if (!(num(mu) && mu > 0)) return { ok: false, sols: [], refusal: refusal('invalid_input', 'The gravitational parameter must be positive.', 'The Sun\'s GM.') };
    var r1n = norm(r1), r2n = norm(r2);
    if (!(r1n > 0 && r2n > 0)) return { ok: false, sols: [], refusal: refusal('invalid_input', 'A position vector has zero length.', 'Two positions away from the central body.') };
    var cv = sub(r2, r1), cn = norm(cv), s = (r1n + r2n + cn) / 2;
    var ir1 = scale(r1, 1 / r1n), ir2 = scale(r2, 1 / r2n), hv = cross(ir1, ir2), hn = norm(hv);
    var theta = Math.atan2(hn, dot(ir1, ir2));          // 0..pi, before the sense of motion is applied
    if (!(hn > 1e-12)) {
      return { ok: false, sols: [], theta: theta, refusal: refusal('out_of_envelope', 'The two positions are ' + (dot(ir1, ir2) > 0 ? 'in the same direction' : 'exactly opposite') + ' from the Sun (transfer angle ' + fmt(theta / DEG, 6) + ' deg): the plane of the transfer is undefined.', 'Another date or time of flight (a few days either way).', { applies_to: 'lambert' }) };
    }
    var ih = scale(hv, 1 / hn), pole = opts.pole || [0, 0, 1];
    var lam = Math.sqrt(Math.max(0, 1 - cn / s)), it1, it2;
    if (dot(ih, pole) < 0) { lam = -lam; it1 = cross(ir1, ih); it2 = cross(ir2, ih); theta = TWO_PI - theta; }
    else { it1 = cross(ih, ir1); it2 = cross(ih, ir2); }
    if (opts.retrograde) { lam = -lam; it1 = scale(it1, -1); it2 = scale(it2, -1); theta = TWO_PI - theta; }
    var T = Math.sqrt(2 * mu / (s * s * s)) * tof;
    var tScale = 1 / Math.sqrt(2 * mu / (s * s * s));
    var revs = opts.revs ? opts.revs.slice() : (function () { var a = []; for (var m = 0; m <= (opts.maxRevs || 0); m++) a.push(m); return a; })();
    var T00 = Math.acos(lam) + lam * Math.sqrt(1 - lam * lam), T1 = 2 / 3 * (1 - lam * lam * lam);
    var sols = [], tmin = {};
    var tol = opts.tol || 1e-13, maxIter = opts.maxIter || 40;
    var gamma = Math.sqrt(mu * s / 2), rho = (r1n - r2n) / cn, sigma = Math.sqrt(Math.max(0, 1 - rho * rho));
    function velocities(x) {
      var y = Math.sqrt(1 - lam * lam + lam * lam * x * x);
      var vr1 = gamma * ((lam * y - x) - rho * (lam * y + x)) / r1n;
      var vr2 = -gamma * ((lam * y - x) + rho * (lam * y + x)) / r2n;
      var vt = gamma * sigma * (y + lam * x);
      return { v1: add(scale(ir1, vr1), scale(it1, vt / r1n)), v2: add(scale(ir2, vr2), scale(it2, vt / r2n)) };
    }
    revs.forEach(function (M) {
      if (M === 0) {
        var x0;
        if (T >= T00) x0 = -(T - T00) / (T - T00 + 4);
        else if (T <= T1) x0 = T1 * (T1 - T) / (2 / 5 * (1 - Math.pow(lam, 5)) * T) + 1;
        else x0 = Math.pow(T / T00, 0.69314718055994529 / Math.log(T1 / T00)) - 1;
        var h = householder(T, x0, 0, lam, tol, maxIter), v = velocities(h.x);
        tmin[0] = 0;
        sols.push({ M: 0, branch: 'single', x: h.x, iters: h.iters, converged: h.converged, v1: v.v1, v2: v.v2 });
        return;
      }
      var tm = tMin(M, lam);
      tmin[M] = tm.T * tScale;
      if (T < tm.T) return;                          // no M-revolution solution: too short
      var tl = Math.pow((M * PI + PI) / (8 * T), 2 / 3), tr = Math.pow(8 * T / (M * PI), 2 / 3);
      var guesses = [['left', (tl - 1) / (tl + 1)], ['right', (tr - 1) / (tr + 1)]];
      guesses.forEach(function (g) {
        var hh = householder(T, g[1], M, lam, tol, maxIter), vv = velocities(hh.x);
        sols.push({ M: M, branch: g[0], x: hh.x, iters: hh.iters, converged: hh.converged, v1: vv.v1, v2: vv.v2 });
      });
    });
    return { ok: sols.some(function (q) { return q.converged; }), theta: theta, lambda: lam, T: T, s: s, c: cn, sols: sols, tmin: tmin };
  }

  // ================================================================== two-body propagation
  /** Kepler propagation of a state (r m, v m/s) by dt seconds about mu: elliptic only (universal form in delta-E). */
  function propagate(r0, v0, dt, mu) {
    var rn = norm(r0), v2 = dot(v0, v0), a = 1 / (2 / rn - v2 / mu);
    if (!(a > 0)) return null;                       // not bound: refused by callers
    var sqmu = Math.sqrt(mu), sig = dot(r0, v0) / sqmu, sqa = Math.sqrt(a), n = sqmu / (a * sqa);
    var Mdt = n * dt, dE = Mdt;                       // n dt = dE - sig/sqrt(a) (cos dE - 1) - (1 - r0/a) sin dE
    for (var i = 0; i < 60; i++) {
      var c = Math.cos(dE), s = Math.sin(dE);
      var f = dE - sig / sqa * (c - 1) - (1 - rn / a) * s - Mdt;
      var fp = 1 + sig / sqa * s - (1 - rn / a) * c;
      var step = f / fp;
      dE -= step;
      if (Math.abs(step) < 1e-14 * Math.max(1, Math.abs(dE))) break;
    }
    var cE = Math.cos(dE), sE = Math.sin(dE);
    var r = a + (rn - a) * cE + sig * sqa * sE;
    var F = 1 - a / rn * (1 - cE), G = dt + Math.sqrt(a * a * a / mu) * (sE - dE);
    var Fd = -Math.sqrt(mu * a) / (r * rn) * sE, Gd = 1 - a / r * (1 - cE);
    return { r: add(scale(r0, F), scale(v0, G)), v: add(scale(r0, Fd), scale(v0, Gd)) };
  }
  /** Classical elements of a state about mu, in the frame given (rotate first for ecliptic elements). */
  function elementsOf(r, v, mu) {
    var rn = norm(r), h = cross(r, v), hn = norm(h), nv = [-h[1], h[0], 0], nn = norm(nv);
    var ev = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rn)), e = norm(ev);
    var a = 1 / (2 / rn - dot(v, v) / mu), i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
    var Om = nn > 0 ? Math.atan2(nv[1], nv[0]) : 0;
    var w = nn > 0 && e > 0 ? Math.atan2(dot(cross(nv, ev), h) / hn, dot(nv, ev)) : 0;
    return { a: a, e: e, i: i, node: (Om + TWO_PI) % TWO_PI, argp: (w + TWO_PI) % TWO_PI, q: a * (1 - e), Q: a * (1 + e), h: hn };
  }

  function create(deps) {
    var C = deps.constants, BODIES = deps.bodies, CHEB = deps.earth, REFS = deps.refs || null;
    var MU_SUN = C.gmSun_m3_s2, EPS = C.obliquity_rad, CE = Math.cos(EPS), SE = Math.sin(EPS);
    var ECL_POLE = [0, -SE, CE];   // the ecliptic pole of J2000 in ICRF axes (Aster's rotation applied to +z)
    var AU = C.au_m;
    // Laplace's sphere of influence of the Earth about the Sun, r = a (mu_E / mu_S)^(2/5), at a = 1 au, from Aster's two GMs:
    // inside it the Earth's pull dominates and a heliocentric arrival point is not a patched-conic arrival.
    var SOI = AU * Math.pow(C.earthMu_m3_s2 / C.gmSun_m3_s2, 0.4);
    var byDes = {};
    BODIES.list.forEach(function (b) { byDes[b.designation] = b; });

    // -------------------------------------------------------------- time (Aster's utc-to-tdb.ts)
    var UNIX_TO_J2000_S = C.unixToJ2000Days * DAY;
    function utcMsToTdb(ms) { return ms / 1000 - UNIX_TO_J2000_S + C.tdbMinusUtc_s; }
    function tdbToUtcMs(t) { return (t + UNIX_TO_J2000_S - C.tdbMinusUtc_s) * 1000; }
    function parseUtc(s) {
      if (typeof s !== 'string') return null;
      var iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
      var ms = Date.parse(iso);
      return num(ms) ? utcMsToTdb(ms) : null;
    }
    function utcOf(t) { return new Date(Math.round(tdbToUtcMs(t))).toISOString(); }
    function dateOf(t) { return utcOf(t).slice(0, 10); }
    /** The calendar date of a TDB instant, read on the TDB scale (for epochs Horizons and Aster's catalog give in TDB). */
    function tdbDate(t) { return new Date((t + UNIX_TO_J2000_S) * 1000).toISOString().slice(0, 10) + ' TDB'; }
    function jdTdbToTdb(jd) { return (jd - 2451545.0) * DAY; }
    function tdbDateOfJd(jd) { return new Date((jd - 2440587.5) * DAY * 1000).toISOString().slice(0, 10) + ' TDB'; }

    // -------------------------------------------------------------- Earth (Chebyshev fit of Horizons, build-data.mjs)
    var SEG = CHEB.segDays * DAY, T0 = CHEB.t0_tdb_s, NSEG = CHEB.segs.length, T_END = CHEB.tEnd_tdb_s;
    function chebEarth(t) {
      if (!(t >= T0 && t <= T_END)) return null;
      var k = Math.min(NSEG - 1, Math.floor((t - T0) / SEG)), a = T0 + k * SEG, b = Math.min(a + SEG, T_END), half = (b - a) / 2;
      var tau = (t - (a + half)) / half, seg = CHEB.segs[k], r = [0, 0, 0], v = [0, 0, 0];
      for (var c = 0; c < 3; c++) {
        var co = seg[c], n = co.length;
        // Clenshaw for the value; the derivative by the recurrence U_n of the second kind (T_n' = n U_{n-1}).
        var t0 = 1, t1 = tau, u0 = 1, u1 = 2 * tau, p = co[0] + (n > 1 ? co[1] * tau : 0), d = n > 1 ? co[1] : 0;
        for (var j = 2; j < n; j++) {
          var t2 = 2 * tau * t1 - t0; p += co[j] * t2; t0 = t1; t1 = t2;
          d += co[j] * j * u1; var u2 = 2 * tau * u1 - u0; u0 = u1; u1 = u2;
        }
        r[c] = p * 1000; v[c] = d * 1000 / half;     // coefficients are km
      }
      return { r: r, v: v };
    }
    /** Aster's own Earth: cubic Hermite between Horizons records [[jdTdb, x, y, z, vx, vy, vz] km, km/s]. */
    function hermiteEphemeris(records) {
      var recs = records.map(function (q) { return { t: jdTdbToTdb(q[0]), r: [q[1], q[2], q[3]], v: [q[4], q[5], q[6]] }; });
      return function (t) {
        for (var i = 0; i < recs.length; i++) if (recs[i].t === t) return { r: scale(recs[i].r, 1000), v: scale(recs[i].v, 1000) };
        for (var k = 0; k < recs.length - 1; k++) {
          var s0 = recs[k], s1 = recs[k + 1];
          if (t > s0.t && t < s1.t) {
            var dt = s1.t - s0.t, u = (t - s0.t) / dt, u2 = u * u, u3 = u2 * u;
            var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
            var d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u, r = [], v = [];
            for (var c = 0; c < 3; c++) {
              r.push(1000 * (h00 * s0.r[c] + h10 * s0.v[c] * dt + h01 * s1.r[c] + h11 * s1.v[c] * dt));
              v.push(1000 * (d00 * s0.r[c] + d10 * s0.v[c] * dt + d01 * s1.r[c] + d11 * s1.v[c] * dt) / dt);
            }
            return { r: r, v: v };
          }
        }
        return null;
      };
    }
    var earthState = chebEarth;

    // -------------------------------------------------------------- the asteroid (Aster's keplerian.ts, formula for formula)
    function keplerE(M, e) {
      var tau = TWO_PI, m = ((M % tau) + tau) % tau; if (m > PI) m -= tau;
      var E = e < 0.8 ? m : (m >= 0 ? PI : -PI);
      for (var i = 0; i < 50; i++) {
        var f = E - e * Math.sin(E) - m, d = f / (1 - e * Math.cos(E));
        E -= d;
        if (Math.abs(d) <= 1e-12) return E;
      }
      return NaN;
    }
    function bodyElements(b) {
      var el = b.elements;
      return { aM: el.aKm * 1000, e: el.e, iRad: el.iRad, omRad: el.omRad, wRad: el.wRad, maRad: el.maRad, epochTdbSeconds: jdTdbToTdb(el.epochTdbJd) };
    }
    function bodyState(b, t) {
      var el = bodyElements(b);
      if (!(el.aM > 0 && el.e >= 0 && el.e < 1)) return null;
      var n = Math.sqrt(MU_SUN / (el.aM * el.aM * el.aM)), M = el.maRad + n * (t - el.epochTdbSeconds), E = keplerE(M, el.e);
      if (!num(E)) return null;
      var cE = Math.cos(E), sE = Math.sin(E), den = 1 - el.e * cE, sq = Math.sqrt(1 - el.e * el.e);
      var px = el.aM * (cE - el.e), py = el.aM * sq * sE, vx = -el.aM * n * sE / den, vy = el.aM * n * sq * cE / den;
      var cO = Math.cos(el.omRad), sO = Math.sin(el.omRad), cI = Math.cos(el.iRad), sI = Math.sin(el.iRad), cW = Math.cos(el.wRad), sW = Math.sin(el.wRad);
      var q11 = cO * cW - sO * sW * cI, q12 = -cO * sW - sO * cW * cI, q21 = sO * cW + cO * sW * cI, q22 = -sO * sW + cO * cW * cI, q31 = sW * sI, q32 = cW * sI;
      function rot(x, y) { var ex = q11 * x + q12 * y, ey = q21 * x + q22 * y, ez = q31 * x + q32 * y; return [ex, ey * CE - ez * SE, ey * SE + ez * CE]; }
      return { r: rot(px, py), v: rot(vx, vy) };
    }
    function findBody(des) { return byDes[des] || null; }

    // -------------------------------------------------------------- delta-v stack and DLA (Aster's)
    function injectionDv(c3) { var mu = C.earthMu_m3_s2, r = C.parkingRadius_m; return Math.sqrt(c3 + 2 * mu / r) - Math.sqrt(mu / r); }
    function dvStack(c3, vArr) {
      var inj = injectionDv(c3), sk = C.stationkeeping_m_s, m = C.marginFraction;
      var one = (inj + vArr + sk), ret = (inj + 2 * vArr + sk);
      return { injection_m_s: inj, rendezvous_m_s: vArr, return_departure_m_s: vArr, stationkeeping_m_s: sk, margin_fraction: m, total_oneway_m_s: one * (1 + m), total_return_m_s: ret * (1 + m) };
    }
    function dlaDeg(v) { var n = norm(v); if (!(n >= C.dlaEpsilon_m_s)) return null; return Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / DEG; }
    function rlaDeg(v) { var n = Math.hypot(v[0], v[1]); if (!(norm(v) >= C.dlaEpsilon_m_s) || n === 0) return null; return ((Math.atan2(v[1], v[0]) / DEG) + 360) % 360; }
    function band(dla, siteKey) {
      var site = C.sites[siteKey || 'cape'];
      if (dla === null || !num(dla)) return null;
      var a = Math.abs(dla);
      return a <= site.iMinDeg ? 'GREEN' : (a <= site.dlaCeilingDeg ? 'AMBER' : 'RED');
    }
    function objectiveOf(sol, obj) {
      if (obj === 'c3') return sol.c3;
      if (obj === 'vinf_arr') return sol.vInfArr;
      if (obj === 'dv_return') return sol.dv.total_return_m_s;
      return sol.dv.total_oneway_m_s;
    }

    // -------------------------------------------------------------- one cell
    /**
     * Every transfer from Earth at depTdb to body b after tofS: all converged revolution branches in opts.revs, each with
     * its v-infinities (ICRF, m/s), C3, DLA/RLA, band and Aster's delta-v stack; .best the one the objective prefers.
     */
    function cell(b, depTdb, tofS, opts) {
      opts = opts || {};
      var E = (opts.earth || earthState)(depTdb), A = bodyState(b, depTdb + tofS);
      if (!E) return { ok: false, refusal: refusal('out_of_envelope', 'No Earth state at ' + utcOf(depTdb) + ': the Earth ephemeris here spans ' + tdbDate(T0) + ' to ' + tdbDate(T_END) + ' (Aster\'s Horizons fixture).', 'A departure inside that span, or a longer Horizons span (Aster\'s H0 item).', { applies_to: 'departure_date' }) };
      if (!A) return { ok: false, refusal: refusal('out_of_envelope', b.designation + ' has no bound two-body orbit in this excerpt.', 'An elliptic orbit.', { applies_to: 'target' }) };
      var L = lambert(E.r, A.r, tofS, MU_SUN, { revs: opts.revs || [0], pole: opts.pole });
      if (L.refusal) return { ok: false, refusal: L.refusal, earth: E, target: A };
      var sols = [];
      L.sols.forEach(function (q) {
        if (!q.converged) { sols.push({ M: q.M, branch: q.branch, converged: false, x: q.x }); return; }
        var vd = sub(q.v1, E.v), va = sub(q.v2, A.v), vD = norm(vd), vA = norm(va), c3 = vD * vD, dla = dlaDeg(vd);
        sols.push({ M: q.M, branch: q.branch, converged: true, x: q.x, iters: q.iters, v1: q.v1, v2: q.v2, vinfDep: vd, vinfArr: va, vInfDep: vD, vInfArr: vA, c3: c3, dlaDeg: dla, rlaDeg: rlaDeg(vd), band: band(dla, opts.site), dv: dvStack(c3, vA) });
      });
      var obj = opts.objective || 'c3', best = -1, bv = Infinity;
      sols.forEach(function (q, i) { if (q.converged) { var v = objectiveOf(q, obj); if (v < bv) { bv = v; best = i; } } });
      var tminDays = {}; for (var m in L.tmin) tminDays[m] = L.tmin[m] / DAY;
      return { ok: best >= 0, depTdb: depTdb, tofS: tofS, earth: E, target: A, theta: L.theta, sols: sols, best: best, tminDays: tminDays,
        refusal: best >= 0 ? null : refusal('not_found', 'No ' + (opts.revs || [0]).map(function (m) { return m === 0 ? 'direct' : m + '-revolution'; }).join(' or ') + ' transfer of ' + fmt(tofS / DAY, 5) + ' days exists' + (function () { var a = []; (opts.revs || [0]).forEach(function (m) { if (m > 0 && L.tmin[m]) a.push(m + ' rev needs at least ' + fmt(L.tmin[m] / DAY, 4) + ' d'); }); return a.length ? ' (' + a.join('; ') + ')' : ''; })() + '.', 'A longer time of flight or fewer revolutions.', { applies_to: 'lambert' }) };
    }

    // -------------------------------------------------------------- the porkchop grid
    function linspace(a, b, n) { var o = []; for (var i = 0; i < n; i++) o.push(n === 1 ? a : a + (b - a) * i / (n - 1)); return o; }
    /**
     * P: {depStart, depEnd (TDB s), tofMin, tofMax (s), nDep, nTof, revs, objective}. Returns typed arrays over
     * index j*nDep + i (i departure, j time of flight): the objective, C3, arrival v-infinity, DLA, and the chosen family.
     */
    function grid(b, P) {
      var nD = P.nDep, nT = P.nTof, deps = linspace(P.depStart, P.depEnd, nD), tofs = linspace(P.tofMin, P.tofMax, nT);
      var n = nD * nT, val = new Float64Array(n), c3 = new Float64Array(n), va = new Float64Array(n), dla = new Float64Array(n), fam = new Int8Array(n), bad = new Uint8Array(n);
      var best = { k: -1, v: Infinity }, bestC3 = { k: -1, v: Infinity }, rawBest = { k: -1, v: Infinity }, solved = 0, unsolved = 0, red = 0, flagged = 0;
      var tEp = jdTdbToTdb(b.elements.epochTdbJd), enc = encounters(b, Math.min(tEp, P.depStart), Math.max(tEp, P.depEnd + P.tofMax));
      function crossed(tArr, A) {
        for (var e = 0; e < enc.length; e++) if ((enc[e].t - tEp) * (enc[e].t - tArr) < 0) return true;
        if (enc.length) { var Ea = earthState(tArr); if (Ea && norm(sub(A.r, Ea.r)) < SOI) return true; }
        return false;
      }
      for (var i = 0; i < nD; i++) {
        var E = earthState(deps[i]);
        for (var j = 0; j < nT; j++) {
          var k = j * nD + i;
          val[k] = c3[k] = va[k] = dla[k] = NaN; fam[k] = -1;
          if (!E) { unsolved++; continue; }
          var c = cell(b, deps[i], tofs[j], { revs: P.revs, objective: P.objective, earth: function () { return E; } });
          if (!c.ok) { unsolved++; continue; }
          var q = c.sols[c.best];
          val[k] = objectiveOf(q, P.objective); c3[k] = q.c3; va[k] = q.vInfArr; dla[k] = q.dlaDeg === null ? NaN : q.dlaDeg;
          fam[k] = q.M * 3 + (q.branch === 'single' ? 0 : q.branch === 'left' ? 1 : 2);
          solved++;
          if (q.band === 'RED') red++;
          if (val[k] < rawBest.v) rawBest = { k: k, v: val[k] };
          if (enc.length && crossed(deps[i] + tofs[j], c.target)) { bad[k] = 1; flagged++; continue; }
          if (val[k] < best.v) best = { k: k, v: val[k] };
          if (q.c3 < bestC3.v) bestC3 = { k: k, v: q.c3 };
        }
      }
      function at(kk) { return kk < 0 ? null : { i: kk % nD, j: Math.floor(kk / nD), depTdb: deps[kk % nD], tofS: tofs[Math.floor(kk / nD)], value: val[kk], c3: c3[kk], fam: fam[kk] }; }
      return { nDep: nD, nTof: nT, deps: deps, tofs: tofs, val: val, c3: c3, vinfArr: va, dla: dla, fam: fam, unreliable: bad, solved: solved, unsolved: unsolved, red: red, flagged: flagged, encounters: enc, elementEpoch: tEp,
        min: at(best.k), minC3: at(bestC3.k), rawMin: at(rawBest.k), objective: P.objective, revs: P.revs };
    }
    function famOf(code) { if (code < 0) return null; var M = Math.floor(code / 3), r = code % 3; return { M: M, branch: r === 0 ? 'single' : r === 1 ? 'left' : 'right' }; }

    // -------------------------------------------------------------- refining a window (Nelder-Mead on departure and flight time)
    /** The local minimum of the objective near (depTdb, tofS) on one family {M, branch}, kept inside bounds. */
    function refine(b, seed, objective, bounds) {
      var fam = { M: seed.M, branch: seed.branch };
      function f(x) {
        var d = x[0], t = x[1];
        if (bounds && (d < bounds.depStart || d > bounds.depEnd || t < bounds.tofMin || t > bounds.tofMax)) return Infinity;
        if (!(t > 0)) return Infinity;
        var c = cell(b, d, t, { revs: [fam.M] });
        if (!c.sols) return Infinity;
        for (var i = 0; i < c.sols.length; i++) { var q = c.sols[i]; if (q.converged && q.branch === fam.branch) return objectiveOf(q, objective); }
        return Infinity;
      }
      var s0 = [seed.depTdb, seed.tofS], step = [Math.max(DAY, (bounds ? (bounds.depEnd - bounds.depStart) : 100 * DAY) / 60), Math.max(DAY, (bounds ? (bounds.tofMax - bounds.tofMin) : 100 * DAY) / 60)];
      var S = [s0, [s0[0] + step[0], s0[1]], [s0[0], s0[1] + step[1]]].map(function (x) { return { x: x, v: f(x) }; });
      if (!num(S[0].v)) return { refusal: refusal('not_found', 'No ' + (fam.M ? fam.M + '-revolution ' + fam.branch : 'direct') + ' transfer at the starting point to refine from.', 'Pick a cell where that family has a solution.', { applies_to: 'refine' }) };
      for (var it = 0; it < 400; it++) {
        S.sort(function (a, c) { return a.v - c.v; });
        if (Math.abs(S[2].x[0] - S[0].x[0]) < 1 && Math.abs(S[2].x[1] - S[0].x[1]) < 1 && Math.abs(S[2].x[0] - S[1].x[0]) < 1) break;
        var cx = [(S[0].x[0] + S[1].x[0]) / 2, (S[0].x[1] + S[1].x[1]) / 2];
        var xr = [cx[0] + (cx[0] - S[2].x[0]), cx[1] + (cx[1] - S[2].x[1])], fr = f(xr);
        if (fr < S[0].v) {
          var xe = [cx[0] + 2 * (cx[0] - S[2].x[0]), cx[1] + 2 * (cx[1] - S[2].x[1])], fe = f(xe);
          S[2] = fe < fr ? { x: xe, v: fe } : { x: xr, v: fr };
        } else if (fr < S[1].v) S[2] = { x: xr, v: fr };
        else {
          var xc = [cx[0] + 0.5 * (S[2].x[0] - cx[0]), cx[1] + 0.5 * (S[2].x[1] - cx[1])], fc = f(xc);
          if (fc < S[2].v) S[2] = { x: xc, v: fc };
          else { for (var k = 1; k < 3; k++) { S[k].x = [S[0].x[0] + 0.5 * (S[k].x[0] - S[0].x[0]), S[0].x[1] + 0.5 * (S[k].x[1] - S[0].x[1])]; S[k].v = f(S[k].x); } }
        }
      }
      S.sort(function (a, c) { return a.v - c.v; });
      var onEdge = bounds && (Math.abs(S[0].x[0] - bounds.depStart) < 2 * DAY || Math.abs(S[0].x[0] - bounds.depEnd) < 2 * DAY || Math.abs(S[0].x[1] - bounds.tofMin) < 2 * DAY || Math.abs(S[0].x[1] - bounds.tofMax) < 2 * DAY);
      return { depTdb: S[0].x[0], tofS: S[0].x[1], M: fam.M, branch: fam.branch, value: S[0].v, iterations: it, onEdge: !!onEdge };
    }

    // -------------------------------------------------------------- encounters and the transfer's own geometry
    /** Every Earth encounter of body b closer than the screening distance between t0 and t1 (local minima of the
     * distance on a 1-day scan, each refined by golden section), inside the Earth ephemeris. */
    function encounters(b, t0, t1, limit_m) {
      limit_m = limit_m || C.encounterAu * AU;
      var a = Math.max(Math.min(t0, t1), T0), z = Math.min(Math.max(t0, t1), T_END), out = [];
      if (!(z > a)) return out;
      function d(t) { var E = earthState(t), A = bodyState(b, t); return A ? norm(sub(A.r, E.r)) : Infinity; }
      var prev2 = d(a), prev = d(Math.min(z, a + DAY));
      for (var t = a + 2 * DAY; t <= z + DAY; t += DAY) {
        var tt = Math.min(t, z), cur = d(tt);
        if (prev <= prev2 && prev <= cur && prev < 3 * limit_m) {
          var lo = tt - 2 * DAY, hi = tt, g = (Math.sqrt(5) - 1) / 2;
          for (var k = 0; k < 60; k++) { var m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo); if (d(m1) < d(m2)) hi = m2; else lo = m1; }
          var tm = (lo + hi) / 2, dm = d(tm);
          if (dm < limit_m && !out.some(function (e) { return Math.abs(e.t - tm) < 2 * DAY; })) out.push({ t: tm, distance_m: dm });
        }
        prev2 = prev; prev = cur;
        if (tt === z) break;
      }
      return out;
    }
    /** Points along the transfer (for drawing) and its heliocentric orbit, both in ICRF and about the ecliptic. */
    function arc(r1, v1, tofS, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) { var p = propagate(r1, v1, tofS * i / n, MU_SUN); pts.push(p ? p.r : null); }
      return pts;
    }
    function toEcliptic(v) { return [v[0], v[1] * CE + v[2] * SE, -v[1] * SE + v[2] * CE]; }
    function transfer(b, depTdb, tofS, M, branch, opts) {
      opts = opts || {};
      var c = cell(b, depTdb, tofS, { revs: [M], earth: opts.earth });
      if (!c.sols) return { refusal: c.refusal };
      var q = null;
      c.sols.forEach(function (s) { if (s.converged && s.branch === branch) q = s; });
      if (!q) return { refusal: c.refusal || refusal('not_found', 'The ' + (M ? M + '-revolution ' + branch : 'direct') + ' branch has no solution at ' + dateOf(depTdb) + ' + ' + fmt(tofS / DAY, 5) + ' d.', 'Another cell, or another family.', { applies_to: 'lambert' }), cell: c };
      var el = elementsOf(toEcliptic(c.earth.r), toEcliptic(q.v1), MU_SUN);
      var rmin = Infinity, rmax = 0, pts = arc(c.earth.r, q.v1, tofS, opts.arcPoints || 180);
      pts.forEach(function (p) { if (p) { var r = norm(p); if (r < rmin) rmin = r; if (r > rmax) rmax = r; } });
      // perihelion and aphelion inside the flight, when the flight passes them
      var Earr = earthState(depTdb + tofS);
      var earthDist = Earr ? norm(sub(c.target.r, Earr.r)) : null;
      var elong = Earr ? angle(scale(Earr.r, -1), sub(c.target.r, Earr.r)) / DEG : null;
      var sep = angle(c.earth.r, c.target.r) / DEG;
      return { cell: c, sol: q, depTdb: depTdb, tofS: tofS, arrTdb: depTdb + tofS, M: M, branch: branch, elements: el, transferAngleDeg: c.theta / DEG + 360 * M, sunDistance: { min_m: rmin, max_m: rmax }, earthDistanceArrival_m: earthDist, elongationArrivalDeg: elong, separationDeg: sep, arc: pts };
    }

    // -------------------------------------------------------------- idea 38's departure, flown and re-aimed
    /** As flown: Earth's centre at t with Earth's velocity plus idea 38's v-infinity, coasted about the Sun; the closest
     * approach to body b within +-span of tArr. Re-aimed: Lambert from the same epoch to the body at tArr, same family. */
    function flown(b, t, vinf, tArr, M, branch, span) {
      var E = earthState(t);
      if (!E) return { refusal: refusal('out_of_envelope', 'No Earth state at idea 38\'s departure epoch ' + utcOf(t) + '.', 'A departure inside ' + tdbDate(T0) + ' to ' + tdbDate(T_END) + '.', { applies_to: 'chain_departure' }) };
      var v0 = add(E.v, vinf);
      var probe = propagate(E.r, v0, 1, MU_SUN);
      if (!probe) return { refusal: refusal('out_of_envelope', 'Idea 38\'s v-infinity leaves the Sun\'s gravity (heliocentric orbit not bound).', 'A smaller v-infinity.', { applies_to: 'chain_departure' }) };
      span = span || 60 * DAY;
      function dist(tt) { var p = propagate(E.r, v0, tt - t, MU_SUN), A = bodyState(b, tt); return { d: norm(sub(p.r, A.r)), p: p, A: A }; }
      var lo = Math.max(t + DAY, tArr - span), hi = tArr + span, best = { t: lo, d: dist(lo).d };
      for (var tt = lo; tt <= hi; tt += DAY / 4) { var dd = dist(tt).d; if (dd < best.d) best = { t: tt, d: dd }; }
      var a = best.t - DAY / 4, z = best.t + DAY / 4, g = (Math.sqrt(5) - 1) / 2;
      for (var k = 0; k < 80; k++) { var m1 = z - g * (z - a), m2 = a + g * (z - a); if (dist(m1).d < dist(m2).d) z = m2; else a = m1; }
      var tc = (a + z) / 2, at = dist(tc), atArr = dist(tArr);
      var re = transfer(b, t, tArr - t, M, branch);
      var out = { departTdb: t, earth: E, vinfFlown: vinf, closest: { tdb: tc, distance_m: at.d, relSpeed_m_s: norm(sub(at.p.v, at.A.v)) }, missAtArrival_m: atArr.d };
      if (re.refusal) { out.reaim = null; out.reaimRefusal = re.refusal; return out; }
      var need = re.sol.vinfDep, corr = sub(need, vinf);
      out.reaim = { vinfNeeded: need, correction: corr, correction_m_s: norm(corr), c3Needed: re.sol.c3, arrivalVinf: re.sol.vInfArr, transfer: re };
      return out;
    }

    // -------------------------------------------------------------- refusals the target and dates carry
    function targetRefusals(b, depTdb, arrTdb) {
      var out = [];
      if (b.tier === 'not-kepler-safe') out.push(refusal('out_of_envelope', b.designation + ' is tagged not-kepler-safe in Aster\'s catalog (INV-014): its two-body propagation is not trusted.', 'An n-body ephemeris for it (JPL Horizons) instead of elements.', { applies_to: 'target_ephemeris' }));
      var t0 = jdTdbToTdb(b.elements.epochTdbJd), lo = Math.min(t0, arrTdb), hi = Math.max(t0, arrTdb), ep = tdbDateOfJd(b.elements.epochTdbJd);
      var encs = encounters(b, lo, hi), enc = { checked: hi > T0 && lo < T_END, partial: lo < T0 || hi > T_END };
      encs.forEach(function (e) {
        out.push(refusal('out_of_envelope', b.designation + '\'s elements (epoch ' + ep + ') are propagated two-body through an Earth encounter at ' + fmt(e.distance_m / AU, 3) + ' au (' + fmt(e.distance_m / 1000, 4) + ' km, two-body) on ' + dateOf(e.t) + ', closer than the ' + C.encounterAu + ' au Aster\'s catalog screens encounters at: after it the asteroid is not where this page puts it.', 'Elements anchored after ' + dateOf(e.t) + ' (JPL Horizons osculating elements at a later epoch), an arrival before it, or an n-body propagation (module 40).', { applies_to: 'target_ephemeris', encounter_tdb_s_past_j2000: e.t, encounter_distance_m: e.distance_m }));
      });
      var Ea = earthState(arrTdb), Aa = bodyState(b, arrTdb);
      if (Ea && Aa && norm(sub(Aa.r, Ea.r)) < SOI) out.push(refusal('out_of_envelope', 'At arrival ' + b.designation + ' is ' + fmt(norm(sub(Aa.r, Ea.r)) / 1000, 4) + ' km from the Earth, inside its sphere of influence (' + fmt(SOI / 1000, 4) + ' km, Laplace): a heliocentric Lambert arc does not describe a rendezvous there.', 'An arrival when the asteroid is outside the Earth\'s sphere of influence, or a geocentric approach model.', { applies_to: 'arrival_geometry' }));
      if (!enc.checked || enc.partial) out.push(refusal('insufficient_data', 'Earth encounters between the element epoch (' + ep + ') and the arrival (' + dateOf(arrTdb) + ') are checked only inside the Earth ephemeris (' + tdbDate(T0) + ' to ' + tdbDate(T_END) + ').', 'A longer Earth ephemeris.', { applies_to: 'encounter_check' }));
      if (b.conditionCode !== null && b.conditionCode >= 7) out.push(refusal('insufficient_data', b.designation + '\'s orbit has condition code ' + b.conditionCode + ' (' + (b.dataArcDays === null ? 'arc unknown' : b.dataArcDays + '-day arc') + '): where it will be at arrival is uncertain beyond what a porkchop can show.', 'More astrometry (a longer arc), or the orbit\'s covariance mapped to arrival.', { applies_to: 'target_orbit' }));
      return out;
    }
    function nearPiRefusal(tr) {
      var th = ((tr.transferAngleDeg % 360) + 360) % 360;
      if (Math.abs(th - 180) < C.nearPiDeg) return refusal('out_of_envelope', 'The transfer sweeps ' + fmt(th, 4) + ' deg (within ' + C.nearPiDeg + ' deg of 180): the plane through the Sun, Earth and the asteroid is set by small out-of-plane offsets, so this ballistic arc is inclined ' + fmt(tr.elements.i / DEG, 3) + ' deg to the ecliptic and its delta-v is a poor guide.', 'A broken-plane transfer (a plane change mid-course, not computed here) or a cell away from the 180-deg ridge.', { applies_to: 'transfer_plane' });
      return null;
    }

    // ================================================================== idea 38's handoff
    var RECOG_TOL = 1e-9;
    function importBurnOut(h38) {
      var h = h38;
      if (typeof h38 === 'string') { try { h = JSON.parse(h38); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 38 (Burn Out) or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 38 (Burn Out) or from this page.') };
      if (h.from !== '38-burn-out') return { refusal: refusal('invalid_input', 'This is a handoff from ' + h.from + '; Lambert\'s Road takes idea 38\'s (the hyperbolic departure state and its v-infinity).', 'Take it through idea 38 (Burn Out) first.') };
      if (h.version !== 1) return { refusal: refusal('invalid_input', 'Idea 38 handoff version ' + h.version + ' is not the version 1 this page reads.', 'A version 1 handoff from idea 38.') };
      if (!h.outputs || !h.inputs || !Array.isArray(h.refusals)) return { refusal: refusal('invalid_input', 'Idea 38\'s handoff has no outputs, inputs or refusals.', 'The unedited handoff idea 38 exported.') };
      var bad = function (what) { return { refusal: refusal('invalid_input', 'Idea 38\'s handoff is not self-consistent: ' + what + '. It was edited, or not made by idea 38.', 'The unedited handoff idea 38 exported.') }; };
      var O = h.outputs, W = h.inputs.window_handoff, asym = null, cellRef = null;
      if (W) {
        if (W.from !== '37-window' || !W.inputs || !W.outputs || !W.outputs.asymptote) return bad('its idea 37 handoff is malformed');
        var A = W.inputs.asymptote || {};
        asym = { vinf: A.vinf_m_s || null, dateUtc: A.dateUtc || null, source: A.source || null, s_hat: W.outputs.asymptote.value.s_hat_j2000, c3: W.outputs.asymptote.value.c3_m2_s2 };
        // Is it one of Aster's own cells (the vector idea 37 copied)? Recognised by the vector, never by the prose.
        if (asym.vinf && REFS && REFS.cells) REFS.cells.forEach(function (rc) {
          var d = norm(sub(asym.vinf, rc.vinfDep_m_s)) / norm(rc.vinfDep_m_s);
          if (d < RECOG_TOL) cellRef = rc;
        });
      }
      var dep = null, V = O.v_infinity && O.v_infinity.value, S = O.hyperbolic_departure_state && O.hyperbolic_departure_state.value;
      if (S && V) {
        if (!Array.isArray(V.vector_m_s) || V.vector_m_s.length !== 3 || !V.vector_m_s.every(num)) return bad('v_infinity has no vector');
        var vm = norm(V.vector_m_s);
        if (Math.abs(vm - V.magnitude_m_s) > 1e-6 * vm) return bad('v_infinity\'s magnitude is not its vector\'s');
        if (Math.abs(vm * vm - V.c3_m2_s2) > 1e-9 * vm * vm) return bad('v_infinity\'s C3 is not its magnitude squared');
        if (Math.abs(dlaDeg(V.vector_m_s) - V.dla_deg) > 1e-6 || Math.abs(((rlaDeg(V.vector_m_s) - V.rla_deg + 540) % 360) - 180) > 1e-6) return bad('v_infinity\'s RLA or DLA is not its vector\'s');
        if (!num(S.tdb_s_past_j2000)) return bad('the departure state has no TDB epoch');
        var utcBack = Date.parse(S.utc);
        if (!num(utcBack) || Math.abs(utcMsToTdb(utcBack) - S.tdb_s_past_j2000) > 0.002) return bad('the departure state\'s UTC and TDB disagree');
        var burns = O.burns && O.burns.value;
        if (!burns || !burns.length || Math.abs(burns[burns.length - 1].cutoff_tdb_s_past_j2000 - S.tdb_s_past_j2000) > 1e-6) return bad('the departure state is not at the last burn\'s cutoff');
        if (asym && asym.s_hat && angle(V.vector_m_s, asym.s_hat) / DEG > 1e-3) return bad('v_infinity does not lie along idea 37\'s asymptote (' + fmt(angle(V.vector_m_s, asym.s_hat) / DEG, 3) + ' deg off)');
        if (asym && Math.abs(V.c3_m2_s2 - asym.c3) > 1e-6 * asym.c3) return bad('the C3 reached is not idea 37\'s');
        dep = { tdb: S.tdb_s_past_j2000, utc: S.utc, vinf: V.vector_m_s.slice(), c3: V.c3_m2_s2, mass_kg: S.mass_kg, rGeo: S.r_m, vGeo: S.v_m_s };
      }
      var refs = h.refusals.map(function (r) { var q = clone(r); if (!q.from) q.from = '38-burn-out'; return q; });
      return { from: '38-burn-out', h38: h, asymptote: asym, cellRef: cellRef, departure: dep, refusals: refs, preset: h.inputs.preset || null };
    }

    // ================================================================== the whole page state
    function defaults() {
      return { target: '99942', depStartUtc: '2026-01-01', depEndUtc: '2027-07-01', tofMinDays: 120, tofMaxDays: 900, nDep: 120, nTof: 90, revs: [0, 1], objective: 'c3', site: 'cape', selection: null };
    }
    function chainCellSelection(rc) { return { depTdb: rc.depTdb, tofS: rc.tofDays * DAY, M: rc.M, branch: rc.branch, source: 'aster_cell' }; }
    function validSettings(S) {
      var errs = [];
      if (!findBody(S.target)) errs.push('target "' + S.target + '" is not in this excerpt of Aster\'s catalog');
      var a = parseUtc(S.depStartUtc), z = parseUtc(S.depEndUtc);
      if (a === null || z === null) errs.push('a departure date does not parse');
      else if (!(z > a)) errs.push('the departure range must run forwards');
      if (!(num(S.tofMinDays) && num(S.tofMaxDays) && S.tofMinDays > 0 && S.tofMaxDays > S.tofMinDays)) errs.push('the time-of-flight range must be positive and run forwards');
      if (num(S.tofMaxDays) && S.tofMaxDays > 3000) errs.push('times of flight above 3,000 days are outside this page\'s envelope');
      if (!(S.nDep >= 2 && S.nDep <= 400 && S.nTof >= 2 && S.nTof <= 300)) errs.push('the grid must be 2-400 departures by 2-300 flight times');
      if (!Array.isArray(S.revs) || !S.revs.length || !S.revs.every(function (m) { return m === 0 || m === 1 || m === 2; })) errs.push('revolutions must be among 0, 1, 2');
      if (OBJECTIVES.indexOf(S.objective) < 0) errs.push('objective must be one of ' + OBJECTIVES.join(', '));
      if (!C.sites[S.site]) errs.push('site must be cape or vandenberg');
      return errs;
    }
    /**
     * Everything the page shows and the handoff carries. S the settings; src {chain} from importBurnOut or null.
     * opts.grid false skips the porkchop (the handoff check recomputes the transfer alone); opts.gridCache {key, grid}
     * reuses a porkchop computed for the same target, ranges and families (a click moves only the selection).
     */
    function run(Sin, src, opts) {
      opts = opts || {};
      var S = clone(Sin), errs = validSettings(S);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      var b = findBody(S.target), P = { depStart: parseUtc(S.depStartUtc), depEnd: parseUtc(S.depEndUtc), tofMin: S.tofMinDays * DAY, tofMax: S.tofMaxDays * DAY, nDep: S.nDep, nTof: S.nTof, revs: S.revs, objective: S.objective };
      var R = { S: S, body: b, P: P, refusals: [], chain: src && src.chain ? src.chain : null };
      if (P.depStart < T0 || P.depEnd > T_END) R.refusals.push(refusal('out_of_envelope', 'Departures from ' + S.depStartUtc + ' to ' + S.depEndUtc + ' run outside the Earth ephemeris (' + tdbDate(T0) + ' to ' + tdbDate(T_END) + '); those columns are left empty.', 'Departures inside that span, or a longer Horizons span (Aster\'s H0 item).', { applies_to: 'departure_date' }));
      if (opts.gridCache && opts.gridCache.key === JSON.stringify([S.target, P, S.site])) R.grid = opts.gridCache.grid;
      else if (opts.grid !== false) { R.grid = grid(b, P); R.gridKey = JSON.stringify([S.target, P, S.site]); }
      // the selection: typed, else the chain's (Aster's cell when idea 37 used it), else the grid's minimum
      var sel = S.selection;
      if (!sel && R.chain && R.chain.cellRef && R.chain.cellRef.designation === b.designation) sel = chainCellSelection(R.chain.cellRef);
      if (!sel && REFS && REFS.cells) REFS.cells.forEach(function (rc) {
        if (!sel && rc.designation === b.designation && rc.depTdb >= P.depStart && rc.depTdb <= P.depEnd && rc.tofDays * DAY >= P.tofMin && rc.tofDays * DAY <= P.tofMax && S.revs.indexOf(rc.M) >= 0) sel = chainCellSelection(rc);
      });
      if (!sel && R.grid && R.grid.min) { var f = famOf(R.grid.min.fam); sel = { depTdb: R.grid.min.depTdb, tofS: R.grid.min.tofS, M: f.M, branch: f.branch, source: 'grid_minimum' }; }
      if (!sel) { R.refusals.push(refusal('not_found', 'No transfer in this grid converged.', 'Wider ranges, or more revolutions.', { applies_to: 'selection' })); return R; }
      R.selection = sel;
      var tr = transfer(b, sel.depTdb, sel.tofS, sel.M, sel.branch);
      if (tr.refusal) { R.refusals.push(tr.refusal); return R; }
      R.transfer = tr;
      targetRefusals(b, sel.depTdb, tr.arrTdb).forEach(function (r) { R.refusals.push(r); });
      var np = nearPiRefusal(tr); if (np) R.refusals.push(np);
      if (tr.sol.dlaDeg === null) R.refusals.push(refusal('insufficient_data', 'The departure v-infinity is below ' + C.dlaEpsilon_m_s + ' m/s: its declination is undefined (Aster\'s dla.ts guard).', 'A cell with a larger C3.', { applies_to: 'dla' }));
      else if (tr.sol.band === 'RED') R.refusals.push(refusal('out_of_envelope', 'DLA ' + fmt(tr.sol.dlaDeg, 4) + ' deg is beyond ' + C.sites[S.site].name + '\'s ' + C.sites[S.site].dlaCeilingDeg + ' deg ceiling (Aster\'s band model): this departure needs a dogleg or a plane change Aster does not price.', 'A cell with |DLA| under the ceiling, or the other site.', { applies_to: 'dla' }));
      // Aster's cell, when the target is the one in Aster's DLA oracle
      if (REFS && REFS.cells) REFS.cells.forEach(function (rc) {
        if (rc.designation !== b.designation) return;
        var c = cell(b, rc.depTdb, rc.tofDays * DAY, { revs: [rc.M] }), q = null;
        if (c.sols) c.sols.forEach(function (s) { if (s.converged && s.branch === rc.branch) q = s; });
        R.asterCell = { ref: rc, sol: q, dv_m_s: q ? norm(sub(q.vinfDep, rc.vinfDep_m_s)) : null };
      });
      if (R.chain) {
        R.chain.refusals.forEach(function (r) { R.refusals.push(r); });
        if (R.chain.departure) {
          var d = R.chain.departure, M = sel.M, br = sel.branch, tArr = sel.depTdb + sel.tofS;
          if (!(Math.abs(d.tdb - sel.depTdb) < 30 * DAY)) R.refusals.push(refusal('out_of_envelope', 'Idea 38 departs on ' + d.utc.slice(0, 10) + ', ' + fmt((d.tdb - sel.depTdb) / DAY, 3) + ' days from the selected transfer\'s departure: the flown departure is not this transfer\'s.', 'Select a cell departing within a month of idea 38\'s burn, or take this transfer back through ideas 37 and 38.', { applies_to: 'chain_departure' }));
          else {
            var fl = flown(b, d.tdb, d.vinf, tArr, M, br);
            if (fl.refusal) R.refusals.push(fl.refusal);
            else { R.flown = fl; if (fl.reaimRefusal) R.refusals.push(fl.reaimRefusal); }
          }
        } else {
          R.refusals.push(refusal('insufficient_data', 'Idea 38 hands on no hyperbolic departure state (its refusals say why), so there is no flown departure to carry along this transfer: the transfer shown is the one the chain set out to fly.', 'A departure that closes in idea 38 (more propellant, a lighter payload, or a lower C3).', { applies_to: 'chain_departure', from_refused: true }));
        }
        if (R.chain.asymptote && !R.chain.cellRef) R.refusals.push(refusal('insufficient_data', 'Idea 37\'s asymptote is not one of Aster\'s cells this page recognises (' + (R.chain.asymptote.source || 'typed') + '): which body and arrival date it was meant for is not stated, so the selected transfer is compared with it only at the departure.', 'Choose the target and the arrival here, then take this transfer back through idea 37.', { applies_to: 'chain_target' }));
      }
      R.refusals.push(refusal('insufficient_data', 'Patched conics: the transfer starts at Earth\'s centre at the departure epoch and ends at the asteroid\'s, about the Sun alone. Earth\'s and the Moon\'s pull on the way out, the planets on the way, and solar radiation pressure are not in it.', 'An n-body propagation of the transfer (module 40).', { applies_to: 'dynamics' }));
      return R;
    }

    // ================================================================== handoff (version 1, from "39-lamberts-road")
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function buildHandoff(R, produced) {
      var S = R.S, b = R.body, tr = R.transfer, h = { handoff: 'long-way-round', version: 1, from: '39-lamberts-road', produced: produced || new Date().toISOString() };
      var settings = clone(S); if (R.selection) settings.selection = { depTdb: R.selection.depTdb, tofS: R.selection.tofS, M: R.selection.M, branch: R.selection.branch, source: R.selection.source };
      h.inputs = { burnout_handoff: R.chain ? R.chain.h38 : null, settings: settings };
      var O = {};
      O.target = qv({ designation: b.designation, name: b.name, spk_id: b.spkId, orbit_class: b.orbitClass, H: b.H, estimated_radius_m: b.estimatedRadiusM, condition_code: b.conditionCode, data_arc_days: b.dataArcDays, aster_tier: b.tier, elements_ecliptic_j2000: { a_m: b.elements.aKm * 1000, e: b.elements.e, i_rad: b.elements.iRad, node_rad: b.elements.omRad, argp_rad: b.elements.wRad, mean_anomaly_rad: b.elements.maRad, epoch_tdb_jd: b.elements.epochTdbJd } }, 'm, rad', 'measured', 'Aster tests/fixtures/v2/nea-catalog-slice9.json (62ddb17), excerpt snapshots/neo-excerpt.js; estimated_radius_m is from H under Aster\'s assumed albedo');
      if (tr) {
        var q = tr.sol, uq = utcOf;
        O.transfer = qv({ departure_utc: uq(tr.depTdb), departure_tdb_s_past_j2000: tr.depTdb, arrival_utc: uq(tr.arrTdb), arrival_tdb_s_past_j2000: tr.arrTdb, time_of_flight_s: tr.tofS, revolutions: tr.M, branch: tr.branch, lambert_x: q.x, transfer_angle_deg: tr.transferAngleDeg, selected_by: R.selection.source, objective: S.objective },
          's, deg', 'derived', KERNEL + ' lambert() (Izzo 2015) between Earth (Horizons, Chebyshev fit) and the target (Aster\'s two-body elements)');
        O.v_infinity_departure = qv({ vector_m_s: q.vinfDep, magnitude_m_s: q.vInfDep, c3_m2_s2: q.c3, rla_deg: q.rlaDeg, dla_deg: q.dlaDeg, band: q.band, site: C.sites[S.site].name }, 'm/s, m^2/s^2, deg', 'derived', KERNEL + ' (DLA asin(vz/|v|) in ICRF, Aster\'s dla.ts; band Aster\'s feasibility.ts)');
        O.v_infinity_arrival = qv({ vector_m_s: q.vinfArr, magnitude_m_s: q.vInfArr }, 'm/s', 'derived', KERNEL + ' (spacecraft minus target velocity at arrival, ICRF)');
        O.heliocentric_departure_state = qv({ tdb_s_past_j2000: tr.depTdb, r_m: tr.cell.earth.r, v_m_s: q.v1, earth_v_m_s: tr.cell.earth.v, frame: 'heliocentric ICRF/J2000, Sun centre' }, 's, m, m/s', 'derived', KERNEL + ' (Earth\'s centre, patched conic)');
        O.heliocentric_arrival_state = qv({ tdb_s_past_j2000: tr.arrTdb, r_m: tr.cell.target.r, v_m_s: q.v2, target_v_m_s: tr.cell.target.v, frame: 'heliocentric ICRF/J2000, Sun centre' }, 's, m, m/s', 'derived', KERNEL + ' (the target\'s two-body position)');
        O.transfer_orbit = qv({ a_m: tr.elements.a, e: tr.elements.e, i_ecliptic_deg: tr.elements.i / DEG, perihelion_m: tr.elements.q, aphelion_m: tr.elements.Q, sun_distance_min_m: tr.sunDistance.min_m, sun_distance_max_m: tr.sunDistance.max_m }, 'm, deg', 'derived', KERNEL + ' elementsOf() about the J2000 ecliptic');
        O.delta_v_stack = qv(q.dv, 'm/s', 'derived', 'Aster src/v2/porkchop/delta-v.ts buildDeltaVStack (snapshots/aster-delta-v.ts.txt) on this transfer');
        O.arrival_geometry = qv({ earth_distance_m: tr.earthDistanceArrival_m, solar_elongation_deg: tr.elongationArrivalDeg }, 'm, deg', 'derived', KERNEL + ' (Earth at arrival from the Chebyshev ephemeris)');
      }
      if (R.grid) {
        var g = R.grid, mm = function (p) { if (!p) return null; var f = famOf(p.fam); return { departure_utc: utcOf(p.depTdb), departure_tdb_s_past_j2000: p.depTdb, time_of_flight_s: p.tofS, revolutions: f.M, branch: f.branch, c3_m2_s2: p.c3, objective_value: p.value }; };
        O.porkchop = qv({ objective: g.objective, revolutions: g.revs, n_departure: g.nDep, n_time_of_flight: g.nTof, solved_cells: g.solved, unsolved_cells: g.unsolved, red_cells: g.red, minimum: mm(g.min), minimum_c3: mm(g.minC3) }, 's, m^2/s^2, m/s', 'derived', KERNEL + ' grid()');
      }
      if (R.asterCell) {
        var ac = R.asterCell;
        O.aster_cell_check = qv({ source: ac.ref.source, aster_vinf_m_s: ac.ref.vinfDep_m_s, this_page_vinf_m_s: ac.sol ? ac.sol.vinfDep : null, difference_m_s: ac.dv_m_s }, 'm/s', 'derived', KERNEL + ' against Aster\'s DLA oracle cell');
      }
      if (R.flown) {
        var fl = R.flown;
        O.chain_departure = qv({ departure_utc: utcOf(fl.departTdb), departure_tdb_s_past_j2000: fl.departTdb, vinf_flown_m_s: fl.vinfFlown, miss_at_arrival_m: fl.missAtArrival_m, closest_approach: { tdb_s_past_j2000: fl.closest.tdb, utc: utcOf(fl.closest.tdb), distance_m: fl.closest.distance_m, relative_speed_m_s: fl.closest.relSpeed_m_s },
          reaimed: fl.reaim ? { vinf_needed_m_s: fl.reaim.vinfNeeded, correction_m_s: fl.reaim.correction, correction_magnitude_m_s: fl.reaim.correction_m_s, c3_needed_m2_s2: fl.reaim.c3Needed, arrival_vinf_m_s: fl.reaim.arrivalVinf, arrival_tdb_s_past_j2000: fl.reaim.transfer.arrTdb, departure_r_m: fl.reaim.transfer.cell.earth.r, departure_v_m_s: fl.reaim.transfer.sol.v1, arrival_r_m: fl.reaim.transfer.cell.target.r, arrival_v_m_s: fl.reaim.transfer.sol.v2 } : null },
          's, m, m/s', 'derived', KERNEL + ' flown(): idea 38\'s v-infinity from Earth\'s centre at its cutoff epoch, coasted two-body about the Sun; re-aimed by Lambert to the same arrival');
      }
      h.outputs = O;
      h.refusals = R.refusals.map(clone);
      h.assumptions = [
        'Frame: heliocentric ICRF/J2000 axes (Aster\'s measured frame, INV-021); time TDB seconds past J2000, TDB - UTC = ' + C.tdbMinusUtc_s + ' s (Aster\'s utc-to-tdb.ts).',
        'Earth: JPL Horizons geocentre about the Sun, daily ' + tdbDate(T0) + ' to ' + tdbDate(T_END) + ' (Aster\'s fixture), fitted with Chebyshev polynomials over ' + CHEB.segDays + '-day segments (degree ' + (CHEB.degree) + '); worst fit residual at a Horizons record ' + fmt(CHEB.fit.maxPos_km, 3) + ' km and ' + fmt(CHEB.fit.maxVel_m_s * 1000, 3) + ' mm/s.',
        'Target: Aster\'s catalog elements propagated two-body about the Sun (GM ' + MU_SUN + ' m^3/s^2), as Aster\'s keplerian.ts.',
        'Lambert: Izzo (2015), prograde about the frame\'s z axis (as Aster), revolutions ' + S.revs.join(', ') + '; patched conic (departure from Earth\'s centre, arrival at the asteroid\'s).',
        'Delta-v stack: Aster\'s delta-v.ts (impulsive injection from a ' + (C.parkingRadius_m / 1000) + ' km circular orbit; rendezvous equal to the arrival v-infinity; ' + C.stationkeeping_m_s + ' m/s station-keeping; ' + (C.marginFraction * 100) + ' % margin).'
      ];
      return h;
    }
    function settingsDiff(a, b) {
      var keys = ['target', 'depStartUtc', 'depEndUtc', 'tofMinDays', 'tofMaxDays', 'nDep', 'nTof', 'objective', 'site'];
      for (var i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return keys[i];
      if (JSON.stringify(a.revs) !== JSON.stringify(b.revs)) return 'revs';
      return null;
    }
    function numDiff(a, b, path) {
      if (typeof a === 'number' || typeof b === 'number') {
        if (!(typeof a === 'number' && typeof b === 'number')) return path;
        if (a === b) return null;
        return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : path;
      }
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : path;
      if (Array.isArray(a) !== Array.isArray(b)) return path;
      var ks = {}; Object.keys(a).forEach(function (k) { ks[k] = 1; }); Object.keys(b).forEach(function (k) { ks[k] = 1; });
      for (var k in ks) { var d = numDiff(a[k], b[k], path + '.' + k); if (d) return d; }
      return null;
    }
    /** Read a 39 handoff back: idea 38's inside re-checked, the transfer recomputed from the inputs and compared. */
    function parseHandoff(h39) {
      var h = h39;
      if (typeof h39 === 'string') { try { h = JSON.parse(h39); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 38 or from this page.') }; } }
      if (h && h.from === '38-burn-out') { var c = importBurnOut(h); if (c.refusal) return c; return { from: '38-burn-out', chain: c }; }
      if (!h || h.handoff !== 'long-way-round' || h.from !== '39-lamberts-road' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 handoff from idea 38 or 39.', 'A handoff from idea 38 (Burn Out) or from this page.') };
      var I = h.inputs || {};
      if (!I.settings) return { refusal: refusal('invalid_input', 'This 39-lamberts-road handoff carries no settings.', 'A handoff exported by this page.') };
      var chain = null;
      if (I.burnout_handoff) { chain = importBurnOut(I.burnout_handoff); if (chain.refusal) return chain; }
      var R = run(I.settings, { chain: chain }, { grid: !!(h.outputs && h.outputs.porkchop) });
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced), keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) {
        var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i]);
        if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      var codes = function (L) { return (L || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join(','); };
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '39-lamberts-road', chain: chain, settings: I.settings, R: R, h39: h };
    }

    return {
      constants: C, bodies: BODIES, refs: REFS, earthSpan: { start: T0, end: T_END }, cheb: CHEB, soi_m: SOI,
      utcMsToTdb: utcMsToTdb, tdbToUtcMs: tdbToUtcMs, parseUtc: parseUtc, utcOf: utcOf, dateOf: dateOf, tdbDate: tdbDate, jdTdbToTdb: jdTdbToTdb,
      earthState: earthState, hermiteEphemeris: hermiteEphemeris, bodyState: bodyState, findBody: findBody,
      injectionDv: injectionDv, dvStack: dvStack, dlaDeg: dlaDeg, rlaDeg: rlaDeg, band: band, objectiveOf: objectiveOf,
      cell: cell, grid: grid, famOf: famOf, refine: refine, transfer: transfer, encounters: encounters, flown: flown, tdbDateOfJd: tdbDateOfJd,
      targetRefusals: targetRefusals, importBurnOut: importBurnOut, defaults: defaults, validSettings: validSettings, run: run,
      buildHandoff: buildHandoff, parseHandoff: parseHandoff, toEcliptic: toEcliptic, eclipticPole: ECL_POLE
    };
  }

  return { create: create, lambert: lambert, propagate: propagate, elementsOf: elementsOf, x2tof: x2tof, tMin: tMin, hyp2f1b: hyp2f1b, DEG: DEG, DAY: DAY, OBJECTIVES: OBJECTIVES };
});
