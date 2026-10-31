/* Long Coast: the cruise from Earth to a near-Earth asteroid. Idea 40 of the Aster Idea Bank, module 10 of
 * "The Long Way Round".
 *
 * Idea 39 handed on a patched-conic transfer: a Kepler arc about the Sun from Earth's centre to the asteroid's two-body
 * position, and a refusal (`dynamics`) saying the Sun was the only body in it. This module flies that transfer through
 * the real solar system: the departure hyperbola from Aster's 6,578 km parking orbit (or the state idea 38 actually
 * flew), the Earth (with its J2) and the Moon pulling on the way out, Mercury to Neptune all the way, the Sun's
 * relativistic term and, when a spacecraft area is given, sunlight. It aims at where the asteroid will really be (Aster's
 * elements integrated through the same forces, not Kepler), finds the trajectory-correction manoeuvres (TCMs) that get it
 * there, and runs a navigation covariance analysis: how well the Deep Space Network's range, Doppler and Delta-DOR know
 * the spacecraft as the cruise goes on, how the injection error and each manoeuvre's own error spread the trajectory, and
 * what each TCM must therefore budget (mean and 99th percentile). It hands module 41/42 the arrival state, its
 * uncertainty, and the TCM budget.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, m/s, rad). Time: TDB seconds past J2000 (Aster's convention; UTC =
 * TDB - 69.184 s from Aster's utc-to-tdb.ts; UT1 taken as UTC). Frame: heliocentric ICRF/J2000 axes, Sun centre (as
 * idea 39 and Aster); the planets' accelerations include the indirect term (the Sun's own acceleration toward them).
 *
 * Methods and where they come from:
 *   Integrator     Dormand-Prince 5(4) (J. R. Dormand and P. J. Prince, J. Comp. Appl. Math. 6, 1980), adaptive, with the
 *                  6x6 state transition matrix integrated alongside from the gravity gradient (variational equations).
 *   Ephemerides    Earth: idea 39's Chebyshev fit of Aster's Horizons file (idea 39's own evaluator). The Moon, Mercury,
 *                  Venus, Mars: Chebyshev fits of Aster's daily Horizons records (build-data.mjs). Jupiter..Neptune
 *                  barycentres: Chebyshev fits of fetched Horizons records. GMs from JPL DE440's header, except the Sun's
 *                  and the Earth's, which are Aster's (the chain's) values.
 *   Earth J2       DE440's J2E and RE, pole along the ICRF z axis (precession since J2000 ignored).
 *   Relativity     Schwarzschild term of the Sun, PPN beta = gamma = 1 (the form JPL's integrators use; c from DE440).
 *   Sunlight       cannonball: Cr (A/m) L_sun / (4 pi c r^2), L_sun from NASA's Sun fact sheet; no eclipses.
 *   Targeting      fixed-time position targeting by Newton's method on the state transition matrix.
 *   Navigation     linear covariance analysis (Maybeck; as Orion EM-1's analysis, AAS 15-758): truth dispersion and
 *                  navigation (knowledge) covariances propagated by the STM, a Kalman update for every measurement,
 *                  TCMs that null the estimated arrival miss, Gates' execution-error model (JPL TR 32-504).
 *   Measurements   two-way range and Doppler from DSS-14, DSS-43 and DSS-63 (DSN 810-005 module 301) turning with the
 *                  Earth rotation angle (ERFA era00 constants, idea 37's snapshot), and Delta-DOR angles on the
 *                  Goldstone-Canberra and Goldstone-Madrid baselines; light time ignored.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LongCoast = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, TWO_PI = 2 * PI, DEG = PI / 180, DAY = 86400, HOUR = 3600;
  var KERNEL = '40-long-coast/coast.js';

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
  function angle(a, b) { return Math.atan2(norm(cross(a, b)), dot(a, b)); }

  // ------------------------------------------------------------------ small dense matrices (row-major flat arrays)
  function mzero(n, m) { var a = new Array(n * (m || n)); for (var i = 0; i < a.length; i++) a[i] = 0; return a; }
  function meye(n) { var a = mzero(n); for (var i = 0; i < n; i++) a[i * n + i] = 1; return a; }
  /** C = A (n x k) B (k x m) */
  function mmul(A, B, n, k, m) {
    var C = mzero(n, m);
    for (var i = 0; i < n; i++) for (var p = 0; p < k; p++) { var a = A[i * k + p]; if (a === 0) continue; for (var j = 0; j < m; j++) C[i * m + j] += a * B[p * m + j]; }
    return C;
  }
  function mT(A, n, m) { var B = mzero(m, n); for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) B[j * n + i] = A[i * m + j]; return B; }
  function madd(A, B) { var C = new Array(A.length); for (var i = 0; i < A.length; i++) C[i] = A[i] + B[i]; return C; }
  function msym(A, n) { for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) { var s = 0.5 * (A[i * n + j] + A[j * n + i]); A[i * n + j] = s; A[j * n + i] = s; } return A; }
  /** A P A^T for square n */
  function sandwich(A, P, n) { return msym(mmul(mmul(A, P, n, n, n), mT(A, n, n), n, n, n), n); }
  function inv3(M) {
    var a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7], i = M[8];
    var A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
    if (!(Math.abs(det) > 0) || !isFinite(det)) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  function block(P, n, r0, c0, r, c) { var B = mzero(r, c); for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) B[i * c + j] = P[(r0 + i) * n + c0 + j]; return B; }
  /** Lower Cholesky factor of a symmetric 3x3 (with a tiny floor so a rank-deficient covariance still samples). A pivot
   * at or below the floor gets the floor and no column below it, so round-off (a covariance that is zero up to 1e-13,
   * with negative diagonals, as after a TCM with no new data) cannot divide by ~0 into Infinity (review fix); below
   * 1e-24 (m/s)^2 in all the factor is zero. Positive-definite matrices factor exactly as before. */
  function chol3(S) {
    var tr = Math.abs(S[0]) + Math.abs(S[4]) + Math.abs(S[8]), eps = 1e-14 * tr;
    if (!(tr > 1e-24)) return mzero(3);
    var p1 = S[0] > eps, l11 = Math.sqrt(p1 ? S[0] : eps), l21 = p1 ? S[3] / l11 : 0, l31 = p1 ? S[6] / l11 : 0;
    var d2 = S[4] - l21 * l21, p2 = d2 > eps, l22 = Math.sqrt(p2 ? d2 : eps), l32 = p2 ? (S[7] - l31 * l21) / l22 : 0;
    var l33 = Math.sqrt(Math.max(S[8] - l31 * l31 - l32 * l32, eps));
    return [l11, 0, 0, l21, l22, 0, l31, l32, l33];
  }
  /** Seeded uniform generator (mulberry32) and standard normals by Box-Muller: the statistics repeat exactly. */
  function rng(seed) {
    var s = seed >>> 0, spare = null;
    function u() { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    function n() { if (spare !== null) { var z = spare; spare = null; return z; } var a = u() || 1e-12, b = u(), r = Math.sqrt(-2 * Math.log(a)); spare = r * Math.sin(TWO_PI * b); return r * Math.cos(TWO_PI * b); }
    return { u: u, n: n };
  }
  function quantile(sorted, q) { if (!sorted.length) return null; var x = q * (sorted.length - 1), i = Math.floor(x), f = x - i; return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i]; }

  // ------------------------------------------------------------------ Dormand-Prince 5(4)
  var DP = {
    c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
    a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
      [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
    e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]   // b5 - b4
  };
  /**
   * Integrate y' = f(t, y) from t0 to t1 (either direction). Error control on the first `nErr` components only, each
   * scaled by atol[i] + rtol |y_i|, or, when opts.scale(t, y) gives [length, speed], by atol[i] + rtol times those (the
   * kernel passes the distance and speed relative to the nearer of the Sun and the Earth, so the departure hyperbola is
   * held to the same relative accuracy as the cruise). Returns {y, steps, rejected, h} or {failed}.
   */
  function dopri(f, t0, y0, t1, opts) {
    var n = y0.length, nErr = opts.nErr || n, rtol = opts.rtol, atol = opts.atol, dir = t1 >= t0 ? 1 : -1;
    var h = Math.min(Math.abs(opts.h || (t1 - t0) / 100), Math.abs(t1 - t0)) * dir, t = t0, y = y0.slice(), steps = 0, rej = 0;
    var k = [f(t, y)], ytmp = new Array(n), maxSteps = opts.maxSteps || 2e5;
    if (t1 === t0) return { y: y, steps: 0, rejected: 0, h: h };
    while (dir * (t1 - t) > 0) {
      if (dir * (t + h - t1) > 0) h = t1 - t;
      for (var s = 1; s < 7; s++) {
        for (var i = 0; i < n; i++) { var acc = 0, row = DP.a[s]; for (var j = 0; j < s; j++) acc += row[j] * k[j][i]; ytmp[i] = y[i] + h * acc; }
        k[s] = f(t + DP.c[s] * h, ytmp.slice());
      }
      var err = 0, L = opts.scale ? opts.scale(t, y) : null;
      for (var q = 0; q < nErr; q++) {
        var ei = 0; for (var m = 0; m < 7; m++) ei += DP.e[m] * k[m][q];
        var sc = atol[q] + rtol * (L ? L[q < 3 ? 0 : 1] : Math.max(Math.abs(y[q]), Math.abs(ytmp[q])));
        var r = h * ei / sc; err = Math.max(err, Math.abs(r));
      }
      if (!(err <= 1) && isFinite(err)) {
        h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2)); rej++;
        if (Math.abs(h) < 1e-6) return { failed: 'step size underflow at t = ' + t };
        continue;
      }
      if (!isFinite(err)) { h *= 0.2; rej++; if (Math.abs(h) < 1e-6) return { failed: 'non-finite derivative at t = ' + t }; continue; }
      t = (dir * (t1 - (t + h)) <= 0) ? t1 : t + h; y = ytmp.slice(); k[0] = k[6]; steps++;
      h *= Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2));
      if (steps > maxSteps) return { failed: 'more than ' + maxSteps + ' steps' };
    }
    return { y: y, steps: steps, rejected: rej, h: h };
  }

  // ------------------------------------------------------------------ Chebyshev ephemerides (base-36 coefficients)
  function decodeBody(B) {
    var segs = B.b36.split(';').map(function (s) { return s.split('|').map(function (ax) { return ax.split(',').map(function (x) { return parseInt(x, 36) * B.unit_m; }); }); });
    return { edges: B.segEdges, segs: segs, jd0: B.jd0, jdEnd: B.jdEnd, center: B.center };
  }
  /** Position (m) of a decoded body at TDB seconds past J2000, about its centre; null outside its span. */
  function chebPos(D, t) {
    var jd = 2451545 + t / DAY;
    if (!(jd >= D.jd0 && jd <= D.jdEnd)) return null;
    var e = D.edges, lo = 0, hi = e.length - 2;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (e[mid] <= jd) lo = mid; else hi = mid - 1; }
    var a = e[lo], b = e[lo + 1], half = (b - a) / 2, tau = (jd - a - half) / half, seg = D.segs[lo], out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {   // Clenshaw
      var co = seg[c], b1 = 0, b2 = 0;
      for (var k = co.length - 1; k >= 1; k--) { var b0 = 2 * tau * b1 - b2 + co[k]; b2 = b1; b1 = b0; }
      out[c] = tau * b1 - b2 + co[0];
    }
    return out;
  }

  // ==================================================================================================================
  function create(deps) {
    var LR = deps.LambertsRoad, C = deps.constants, DE = deps.de440, NAV = deps.nav, ERFA = deps.erfa;
    var CAT = deps.catalog, TRUTH = deps.truth || null;
    var K39 = LR.create({ constants: C, earth: deps.earth, bodies: deps.bodies || CAT, refs: deps.refs });
    var MU_SUN = C.gmSun_m3_s2, MU_E = C.earthMu_m3_s2, AU = C.au_m;
    var GM = {
      mercury: DE.gm_m3_s2.mercury, venus: DE.gm_m3_s2.venus, earth: MU_E, moon: DE.gm_m3_s2.moon, mars: DE.gm_m3_s2.mars,
      jupiter: DE.gm_m3_s2.jupiter, saturn: DE.gm_m3_s2.saturn, uranus: DE.gm_m3_s2.uranus, neptune: DE.gm_m3_s2.neptune
    };
    var CLIGHT = DE.c_m_s, J2E = DE.earthJ2, RE = DE.earthRadius_m;
    var P_SUN_1AU = NAV.sun.luminosity_W / (4 * PI * AU * AU * CLIGHT);   // N/m^2 on a perfect absorber at 1 au
    var EPH = {};
    ['moon', 'mercury', 'venus', 'mars'].forEach(function (k) { EPH[k] = decodeBody(deps.asterBodies.bodies[k]); });
    ['jupiter', 'saturn', 'uranus', 'neptune'].forEach(function (k) { EPH[k] = decodeBody(deps.outerPlanets.bodies[k]); });
    var PERTURBERS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
    var span = { start: K39.earthSpan.start, end: K39.earthSpan.end };
    Object.keys(EPH).forEach(function (k) { span.start = Math.max(span.start, (EPH[k].jd0 - 2451545) * DAY); span.end = Math.min(span.end, (EPH[k].jdEnd - 2451545) * DAY); });

    /** Heliocentric positions (m) of every perturber at t (TDB s past J2000); the Earth's velocity too. Null outside. */
    function ephemeris(t) {
      var E = K39.earthState(t);
      if (!E) return null;
      var out = { earth: E.r, earthV: E.v }, mo = chebPos(EPH.moon, t);
      if (!mo) return null;
      out.moonGeo = mo; out.moon = add(E.r, mo);
      for (var i = 0; i < PERTURBERS.length; i++) {
        var k = PERTURBERS[i]; if (k === 'earth' || k === 'moon') continue;
        var p = chebPos(EPH[k], t); if (!p) return null; out[k] = p;
      }
      return out;
    }

    // -------------------------------------------------------------- forces
    var FORCE_DEFAULT = { earth: true, moon: true, planets: true, earthJ2: true, relativity: true, srp_m2_kg: 0, cr: 1 };
    function forceModel(fm) { var o = clone(FORCE_DEFAULT); if (fm) for (var k in fm) o[k] = fm[k]; return o; }
    /**
     * Acceleration (m/s^2) on a body at heliocentric (r, v) at t under force model fm, and when G is requested the
     * gravity gradient d a / d r (3x3, point masses only). Null outside the ephemerides.
     */
    function accel(t, r, v, fm, wantG, ephIn) {
      var eph = ephIn || ephemeris(t);
      if (!eph) return null;
      var rn2 = dot(r, r), rn = Math.sqrt(rn2), rn3 = rn2 * rn, a = scale(r, -MU_SUN / rn3);
      var G = wantG ? gradTerm(r, rn, MU_SUN, null) : null;
      if (fm.relativity) {   // Schwarzschild, PPN beta = gamma = 1: (mu / c^2 r^3) [(4 mu / r - v^2) r + 4 (r.v) v]
        var k = MU_SUN / (CLIGHT * CLIGHT * rn3), v2 = dot(v, v), rv = dot(r, v);
        a = add(a, add(scale(r, k * (4 * MU_SUN / rn - v2)), scale(v, 4 * k * rv)));
      }
      for (var i = 0; i < PERTURBERS.length; i++) {
        var name = PERTURBERS[i];
        if (name === 'moon' ? !fm.moon : (name === 'earth' ? !fm.earth : !fm.planets)) continue;
        var pj = eph[name], mu = GM[name], d = sub(r, pj), dn2 = dot(d, d), dn = Math.sqrt(dn2), pn = norm(pj);
        a = add(a, add(scale(d, -mu / (dn2 * dn)), scale(pj, -mu / (pn * pn * pn))));   // direct + indirect
        if (G) gradTerm(d, dn, mu, G);
        if (name === 'earth' && fm.earthJ2) {   // J2 about the ICRF z axis (its gradient by central differences, 1 m)
          a = add(a, j2acc(d, mu));
          if (G && dn < 1e8) for (var jj = 0; jj < 3; jj++) {
            var dp = d.slice(), dm = d.slice(); dp[jj] += 1; dm[jj] -= 1;
            var ap = j2acc(dp, mu), am = j2acc(dm, mu);
            for (var ii = 0; ii < 3; ii++) G[ii * 3 + jj] += (ap[ii] - am[ii]) / 2;
          }
        }
      }
      if (fm.srp_m2_kg > 0) a = add(a, scale(r, fm.cr * fm.srp_m2_kg * P_SUN_1AU * AU * AU / rn3));
      return { a: a, G: G };
    }
    function j2acc(d, mu) {
      var dn2 = dot(d, d), dn = Math.sqrt(dn2), z2 = d[2] * d[2] / dn2, f = -1.5 * J2E * mu * RE * RE / (dn2 * dn2 * dn);
      return [f * d[0] * (1 - 5 * z2), f * d[1] * (1 - 5 * z2), f * d[2] * (3 - 5 * z2)];
    }
    /** Adds mu (3 u u^T - I) / d^3 to G (or makes it). */
    function gradTerm(d, dn, mu, G) {
      var k = mu / (dn * dn * dn), u = [d[0] / dn, d[1] / dn, d[2] / dn], out = G || mzero(3);
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out[i * 3 + j] += k * (3 * u[i] * u[j] - (i === j ? 1 : 0));
      return out;
    }
    /**
     * The Earth's own acceleration as the ephemeris has it: the derivative of idea 39's Chebyshev velocity by a central
     * difference kept inside one 32-day segment (its fits are independent, so the velocity steps by up to mm/s across a
     * boundary). Integrating relative to this Earth is the heliocentric problem exactly, without its round-off; the
     * series' acceleration differs from the dynamical one (Sun, Moon, planets) by ~2e-8 m/s^2, its wiggle between the
     * daily records it was fitted to (measured, README).
     */
    var CH = deps.earth, SEG_S = CH.segDays * DAY, H_FD = 30;
    function accelEarth(t) {
      var k = Math.min(CH.segs.length - 1, Math.max(0, Math.floor((t - CH.t0_tdb_s) / SEG_S))), a = CH.t0_tdb_s + k * SEG_S, b = Math.min(a + SEG_S, CH.tEnd_tdb_s);
      var lo = Math.max(a + 1e-3, t - H_FD), hi = Math.min(b - 1e-3, t + H_FD);
      if (hi - lo < H_FD) { if (lo === a + 1e-3) hi = lo + 2 * H_FD; else lo = hi - 2 * H_FD; }
      var E1 = K39.earthState(lo), E2 = K39.earthState(hi);
      if (!E1 || !E2) return null;
      return scale(sub(E2.v, E1.v), 1 / (hi - lo));
    }
    /** The dynamical acceleration of the Earth in this model (Sun, its relativity, Moon, planets, indirect terms): used
     * only to measure the ephemeris' own acceleration against (tests). */
    function accelEarthModel(t, fm) {
      var eph = ephemeris(t); if (!eph) return null;
      var rE = eph.earth, rn = norm(rE), out = scale(rE, -MU_SUN / (rn * rn * rn));
      if (fm.relativity) { var k = MU_SUN / (CLIGHT * CLIGHT * rn * rn * rn), vE = eph.earthV; out = add(out, add(scale(rE, k * (4 * MU_SUN / rn - dot(vE, vE))), scale(vE, 4 * k * dot(rE, vE)))); }
      PERTURBERS.forEach(function (name) {
        if (name === 'earth' || (name === 'moon' ? !fm.moon : !fm.planets)) return;
        var pj = eph[name], mu = GM[name], d = sub(rE, pj), dn = norm(d), pn = norm(pj);
        out = add(out, add(scale(d, -mu / (dn * dn * dn)), scale(pj, -mu / (pn * pn * pn))));
      });
      return out;
    }
    /**
     * The derivative of [r, v] (6) or [r, v, Phi] (42, Phi row-major 6x6) under fm. In the 'geo' frame the state is
     * relative to the Earth's centre and the ephemeris Earth's acceleration (accelEarth) is taken off: the same problem,
     * but near the Earth the heliocentric form loses ~1e-5 m/s an hour to round-off (positions of 1.5e11 m carry 3e-5 m
     * of it) and the geocentric one does not. The STM is the same in both frames (the Earth's motion is not a state).
     */
    function deriv(fm, withStm, frame) {
      return function (t, y) {
        var eph = ephemeris(t);
        if (!eph) return null;
        var r = [y[0], y[1], y[2]], v = [y[3], y[4], y[5]];
        if (frame === 'geo') { r = add(r, eph.earth); v = add(v, eph.earthV); }
        var A = accel(t, r, v, fm, withStm, eph);
        if (!A) return null;
        var aE = frame === 'geo' ? accelEarth(t) : null;
        if (frame === 'geo' && !aE) return null;
        var acc = frame === 'geo' ? sub(A.a, aE) : A.a;
        var out = [y[3], y[4], y[5], acc[0], acc[1], acc[2]];
        if (withStm) {   // dPhi/dt = [[0, I], [G, 0]] Phi: top rows are Phi's bottom rows, bottom rows G times Phi's top rows
          for (var i = 0; i < 3; i++) for (var j = 0; j < 6; j++) out.push(y[6 + (3 + i) * 6 + j]);
          for (var i2 = 0; i2 < 3; i2++) for (var j2 = 0; j2 < 6; j2++) { var s = 0; for (var m = 0; m < 3; m++) s += A.G[i2 * 3 + m] * y[6 + m * 6 + j2]; out.push(s); }
        }
        return out;
      };
    }
    var TOL = { rtol: 1e-12, atol: [1e-6, 1e-6, 1e-6, 1e-12, 1e-12, 1e-12] };
    var R_GEO = 1e9;   // m: within this distance of the Earth the state is integrated relative to it
    function errScale(t, y) { return [Math.hypot(y[0], y[1], y[2]), Math.hypot(y[3], y[4], y[5])]; }
    function safeDeriv(f) { return function (t, y) { var d = f(t, y); if (!d) throw new Error('EPHEMERIS_SPAN'); return d; }; }
    /** Which frame a heliocentric state at t is best integrated in, and the conversions. */
    function frameOf(t, x, fm) { if (!fm.earth) return 'helio'; var E = K39.earthState(t); if (!E) return 'helio'; return norm(sub(x.slice(0, 3), E.r)) < R_GEO ? 'geo' : 'helio'; }
    function toFrame(t, x, frame) { if (frame !== 'geo') return x.slice(0, 6); var E = K39.earthState(t); return sub(x.slice(0, 3), E.r).concat(sub(x.slice(3, 6), E.v)); }
    function fromFrame(t, y, frame) { if (frame !== 'geo') return y.slice(0, 6); var E = K39.earthState(t); return add(y.slice(0, 3), E.r).concat(add(y.slice(3, 6), E.v)); }
    /**
     * Integrate a heliocentric state from t0 to t1 in chunks, each in the frame its start calls for (geocentric within
     * R_GEO of the Earth, so a departure or a flyby keeps its precision; heliocentric elsewhere, so the ephemeris Earth's
     * 32-day segment joins, which step its velocity by up to a few mm/s, never enter the motion), with the STM alongside
     * when Phi0 (6x6, row-major) is given. {x, Phi, steps, rejected, h} or {refusal}.
     */
    function integrate(x0, t0, t1, fm, Phi0, opts) {
      opts = opts || {};
      var withStm = !!Phi0, fH = safeDeriv(deriv(fm, withStm, 'helio')), fG = safeDeriv(deriv(fm, withStm, 'geo'));
      var x = x0.slice(0, 6), Phi = Phi0 ? Phi0.slice() : null, t = t0, dir = t1 >= t0 ? 1 : -1, steps = 0, rej = 0, h = opts.h || 60;
      try {
        while (dir * (t1 - t) > 0) {
          var fr = frameOf(t, x, fm), E = fm.earth ? K39.earthState(t) : null, chunk;
          if (E) {   // short chunks near the Earth, so a fast flyby does not cross into R_GEO unseen
            var g = sub(x.slice(0, 3), E.r), gv = sub(x.slice(3, 6), E.v), gn = norm(g), sp = Math.max(norm(gv), 1);
            chunk = fr === 'geo' ? Math.max(600, Math.min(5 * DAY, 0.5 * gn / sp)) : Math.max(3600, Math.min(20 * DAY, 0.5 * (gn - R_GEO) / sp));
          } else chunk = 20 * DAY;
          var tn = dir > 0 ? Math.min(t1, t + chunk) : Math.max(t1, t - chunk);
          var y0 = toFrame(t, x, fr); if (withStm) y0 = y0.concat(Phi);
          var res = dopri(fr === 'geo' ? fG : fH, t, y0, tn, { rtol: opts.rtol || TOL.rtol, atol: TOL.atol, nErr: 6, h: dir * Math.abs(h), scale: errScale });
          if (res.failed) return { refusal: refusal('not_found', 'The integration failed: ' + res.failed + '.', 'Another departure or force model.', { applies_to: 'integration' }) };
          x = fromFrame(tn, res.y, fr); if (withStm) Phi = res.y.slice(6); t = tn; steps += res.steps; rej += res.rejected; h = res.h;
        }
        return { x: x, Phi: Phi, steps: steps, rejected: rej, h: h };
      } catch (e) {
        if (e.message === 'EPHEMERIS_SPAN') return { refusal: spanRefusal(t0, t1) };
        throw e;
      }
    }
    /** Propagate a heliocentric state x = [r, v] from t0 to t1 under fm (no STM). {x, steps} or {refusal}. */
    function propagate(x0, t0, t1, fm, opts) { return integrate(x0, t0, t1, fm, null, opts); }
    function spanRefusal(t0, t1) {
      return refusal('out_of_envelope', 'The cruise (' + K39.utcOf(Math.min(t0, t1)).slice(0, 10) + ' to ' + K39.utcOf(Math.max(t0, t1)).slice(0, 10) + ') runs outside the planetary ephemerides here (' + K39.tdbDate(span.start) + ' to ' + K39.tdbDate(span.end) + ', Aster\'s Horizons span).', 'A transfer inside that span, or a longer Horizons span (Aster\'s H0 item).', { applies_to: 'ephemeris_span' });
    }
    /**
     * Propagate x0 from t0 through the node times `nodes` (ascending, nodes[0] = t0) with the STM restarted at every node:
     * returns {X: heliocentric states at the nodes, Phi: per-interval STMs (Phi[k] maps node k to node k+1)}; impulses
     * {nodeIndex: dv} are applied at the node (after arriving there).
     */
    function propagateNodes(x0, nodes, fm, impulses) {
      var X = [x0.slice(0, 6)], Phi = [], x = x0.slice(0, 6), h = 60, steps = 0, I6 = meye(6);
      for (var k = 0; k < nodes.length - 1; k++) {
        if (impulses && impulses[k]) { x[3] += impulses[k][0]; x[4] += impulses[k][1]; x[5] += impulses[k][2]; X[k] = x.slice(0, 6); }
        var res = integrate(x, nodes[k], nodes[k + 1], fm, I6, { h: h });
        if (res.refusal) return { refusal: res.refusal };
        h = res.h; steps += res.steps; x = res.x;
        X.push(x.slice()); Phi.push(res.Phi);
      }
      return { X: X, Phi: Phi, steps: steps };
    }

    // -------------------------------------------------------------- the departure
    /**
     * The geocentric periapsis state of the hyperbola from Aster's parking radius whose outgoing asymptote is vinf (ICRF,
     * m/s), in the least-inclined plane that contains it (inclination |DLA|, prograde). {r, v} geocentric, m and m/s.
     */
    function hyperbolaFromVinf(vinf, rp) {
      rp = rp || C.parkingRadius_m;
      var vi = norm(vinf), s = scale(vinf, 1 / vi), zx = cross([0, 0, 1], s), e;
      e = norm(zx) > 1e-9 ? unit(zx) : [0, 1, 0];
      var n = unit(cross(s, e)), ecc = 1 + rp * vi * vi / MU_E, thInf = Math.acos(-1 / ecc);
      var p = sub(scale(s, Math.cos(thInf)), scale(cross(n, s), Math.sin(thInf))), q = cross(n, p);
      var vp = Math.sqrt(vi * vi + 2 * MU_E / rp);
      return { r: scale(p, rp), v: scale(q, vp), eccentricity: ecc, nuInfDeg: thInf / DEG, inclinationDeg: Math.acos(Math.max(-1, Math.min(1, n[2]))) / DEG };
    }
    /** The asymptote of a geocentric two-body state: v-infinity vector (m/s) or null when not hyperbolic. */
    function asymptoteOf(r, v) {
      var rn = norm(r), v2 = dot(v, v), en = v2 / 2 - MU_E / rn;
      if (!(en > 0)) return null;
      var h = cross(r, v), ev = sub(scale(cross(v, h), 1 / MU_E), scale(r, 1 / rn)), e = norm(ev), vi = Math.sqrt(2 * en);
      var p = unit(ev), q = unit(cross(h, p)), th = Math.acos(-1 / e);
      return scale(add(scale(p, Math.cos(th)), scale(q, Math.sin(th))), vi);
    }
    /** The departure options a 39 run offers: 38's flown cutoff state, 37's planned impulsive departure, 39's patched conic. */
    function departureOptions(R39) {
      var tr = R39.transfer, out = {};
      if (!tr) return out;
      var hp = hyperbolaFromVinf(tr.sol.vinfDep);
      out.patched_conic = { key: 'patched_conic', label: 'Idea 39\'s v-infinity from Aster\'s 6,578 km parking orbit at its departure epoch', tdb: tr.depTdb, rGeo: hp.r, vGeo: hp.v, vinf: tr.sol.vinfDep, hyperbola: hp, source: '39-lamberts-road transfer (synthesised periapsis, least-inclined plane)' };
      var ch = R39.chain;
      if (ch && ch.departure && ch.departure.rGeo && ch.departure.vGeo) {
        var d = ch.departure;
        out.flown_38 = { key: 'flown_38', label: 'The state idea 38 flew, at its last cutoff', tdb: d.tdb, rGeo: d.rGeo.slice(), vGeo: d.vGeo.slice(), vinf: d.vinf.slice(), source: '38-burn-out hyperbolic_departure_state (through 39\'s import)' };
      }
      var W = ch && ch.h38 && ch.h38.inputs && ch.h38.inputs.window_handoff, O = W && W.outputs;
      if (O && O.departure_point && O.impulsive_departure && O.asymptote) {
        var s37 = O.asymptote.value.s_hat_j2000, aligned = angle(s37, tr.sol.vinfDep) / DEG;
        if (aligned < 1e-3) {
          var dp = O.departure_point.value, dv = O.impulsive_departure.value.delta_v_j2000_m_s, vg = add(dp.v_m_s, dv);
          out.planned_37 = { key: 'planned_37', label: 'Idea 37\'s planned impulsive departure from its parking orbit', tdb: dp.tdb_s_past_j2000, rGeo: dp.r_m.slice(), vGeo: vg, vinf: asymptoteOf(dp.r_m, vg), source: '37-window departure_point + impulsive_departure (through 38 and 39)' };
        }
      }
      return out;
    }
    function helio(dep) { var E = K39.earthState(dep.tdb); if (!E) return null; return add(E.r, dep.rGeo).concat(add(E.v, dep.vGeo)); }

    // -------------------------------------------------------------- the target
    /** Aster's elements, integrated through the same forces (no non-gravitational forces) from the element epoch. */
    function targetState(b, t, fm, how) {
      if (how === 'two_body') { var s = K39.bodyState(b, t); return s ? { r: s.r, v: s.v } : null; }
      var t0 = K39.jdTdbToTdb(b.elements.epochTdbJd), A = K39.bodyState(b, t0);
      if (!A) return null;
      var f2 = clone(fm); f2.srp_m2_kg = 0;
      var p = propagate(A.r.concat(A.v), t0, t, f2);
      if (p.refusal) return { refusal: p.refusal };
      return { r: p.x.slice(0, 3), v: p.x.slice(3) };
    }

    // -------------------------------------------------------------- targeting: fixed-time position
    /**
     * The velocity change at (t, x) that brings the spacecraft to rTarget at tArr under fm: Newton on the STM, to 1 m.
     * {dv, x (after the burn), iterations, missBefore_m, miss_m} or {refusal}.
     */
    function aim(t, x, tArr, rTarget, fm, maxIter) {
      var dv = [0, 0, 0], it = 0, missBefore = null, miss = Infinity, P = null, evals = 0;
      function shoot(d) { evals++; var xs = x.slice(0, 3).concat(add(x.slice(3), d)); var Q = propagateNodes(xs, [t, tArr], fm); if (Q.refusal) return Q; Q.xs = xs; Q.dr = sub(rTarget, Q.X[1].slice(0, 3)); Q.miss = norm(Q.dr); return Q; }
      P = shoot(dv); if (P.refusal) return { refusal: P.refusal };
      missBefore = miss = P.miss;
      for (; it < (maxIter || 30); it++) {
        if (miss < 1) return { dv: dv, x: P.xs, iterations: it, evaluations: evals, missBefore_m: missBefore, miss_m: miss, Phi: P.Phi[0] };
        var Prv = block(P.Phi[0], 6, 0, 3, 3, 3), inv = inv3(Prv);
        if (!inv) return { refusal: refusal('not_found', 'The targeting matrix is singular at ' + K39.utcOf(t) + '.', 'A manoeuvre at another time.', { applies_to: 'targeting' }) };
        var step = mmul(inv, P.dr, 3, 3, 1), lam = 1, Q = null;
        // Newton with backtracking: halve the step until the miss shrinks (from near the Earth the map is far from linear)
        for (var bt = 0; bt < 30; bt++) {
          Q = shoot(add(dv, scale(step, lam)));
          if (!Q.refusal && Q.miss < miss) break;
          lam /= 2; Q = null;
        }
        if (!Q) break;
        dv = add(dv, scale(step, lam)); P = Q; miss = Q.miss;
      }
      if (miss < 1) return { dv: dv, x: P.xs, iterations: it, evaluations: evals, missBefore_m: missBefore, miss_m: miss, Phi: P.Phi[0] };
      return { refusal: refusal('not_found', 'Targeting from ' + K39.utcOf(t) + ' did not converge (' + it + ' iterations, miss ' + fmt(miss / 1000, 4) + ' km).', 'A manoeuvre later in the cruise, or a transfer away from an Earth encounter.', { applies_to: 'targeting' }) };
    }
    /**
     * Re-aim the injection: the v-infinity (m/s, ICRF) whose periapsis departure from Aster's parking radius at tDep (the
     * least-inclined plane, as hyperbolaFromVinf) reaches rTarget at tArr through every force in fm. Newton on a
     * finite-difference Jacobian (the escape is analytic in v-infinity, so this map is near linear where the periapsis
     * velocity map is not), with backtracking. {vinf, dvinf, iterations, miss_m, departure} or {refusal}.
     */
    // From the periapsis a 1 cm/s change in v-infinity moves the arrival by ~300 km, and the integrator's own noise there
    // (its step sequence changes with the aim) is tens to hundreds of metres at arrival: the re-aimed injection is
    // converged to 1 km (a TCM from 10 days out converges to 1 m).
    var AIM_TOL_INJ = 1000;
    function aimVinf(vinf0, tDep, tArr, rTarget, fm, guess) {
      var evals = 0;
      function depOf(v) { var hp = hyperbolaFromVinf(v); return { tdb: tDep, rGeo: hp.r, vGeo: hp.v, hp: hp }; }
      function shoot(v, withStm) {
        evals++;
        var dep = depOf(v), x0 = helio(dep);
        if (!x0) return { refusal: spanRefusal(tDep, tArr) };
        var p = withStm ? propagateNodes(x0, [tDep, tArr], fm) : propagate(x0, tDep, tArr, fm);
        if (p.refusal) return p;
        var xe = withStm ? p.X[1] : p.x, dr = sub(rTarget, xe.slice(0, 3));
        return { dr: dr, miss: norm(dr), dep: dep, Phi: withStm ? p.Phi[0] : null };
      }
      /** d r_end / d vinf = Phi[r rows] (6 x 6 -> 3 x 6) times d x_periapsis / d vinf (6 x 3, central differences of the
       * analytic hyperbola: no integration noise in it). */
      function jacobian(v, Phi) {
        var D = mzero(6, 3), hd = 1e-3;
        for (var j = 0; j < 3; j++) {
          var vp = v.slice(), vm = v.slice(); vp[j] += hd; vm[j] -= hd;
          var a = depOf(vp), b = depOf(vm);
          for (var i = 0; i < 3; i++) { D[i * 3 + j] = (a.rGeo[i] - b.rGeo[i]) / (2 * hd); D[(3 + i) * 3 + j] = (a.vGeo[i] - b.vGeo[i]) / (2 * hd); }
        }
        return mmul(block(Phi, 6, 0, 0, 3, 6), D, 3, 6, 3);
      }
      // start from idea 39's v-infinity, or from the guess (39's plus TCM-1's correction) when that misses by less
      var v = vinf0.slice(), P = shoot(v, true), it = 0;
      if (P.refusal) return { refusal: P.refusal };
      var missBefore = P.miss;
      if (guess) { var Pg = shoot(guess, true); if (!Pg.refusal && Pg.miss < P.miss) { v = guess.slice(); P = Pg; } }
      for (; it < 40 && P.miss >= AIM_TOL_INJ; it++) {
        var inv = inv3(jacobian(v, P.Phi));
        if (!inv) return { refusal: refusal('not_found', 'The injection targeting matrix is singular.', 'Fly the departure as given and correct at TCM-1.', { applies_to: 'targeting' }) };
        var step = mmul(inv, P.dr, 3, 3, 1), lam = 1, N = null;
        for (var bt = 0; bt < 12; bt++) { N = shoot(add(v, scale(step, lam)), true); if (!N.refusal && N.miss < P.miss) break; lam /= 2; N = null; }
        if (!N) break;
        v = add(v, scale(step, lam)); P = N;
      }
      if (!(P.miss < AIM_TOL_INJ)) return { refusal: refusal('not_found', 'Re-aiming the injection did not converge (' + it + ' iterations, miss ' + fmt(P.miss / 1000, 4) + ' km).', 'Fly the departure as given and correct at TCM-1.', { applies_to: 'targeting' }) };
      return { vinf: v, dvinf: sub(v, vinf0), iterations: it, evaluations: evals, missBefore_m: missBefore, miss_m: P.miss, departure: { tdb: tDep, rGeo: P.dep.rGeo, vGeo: P.dep.vGeo }, hyperbola: P.dep.hp };
    }
    // ================================================================== tracking geometry (DSN)
    var ERA_RATE = TWO_PI * (1 + ERFA.era.c1) / DAY;   // rad/s, from ERFA era00's rate
    var STATIONS = NAV.stations.list.map(function (s) { return { id: s.id, complex: s.complex, xyz: s.xyz_m }; });
    var EL_MIN = NAV.stations.elevationMinDeg * DEG;
    var BASELINES = [['DSS-14', 'DSS-43', 'Goldstone-Canberra'], ['DSS-14', 'DSS-63', 'Goldstone-Madrid']];
    function stationById(id) { for (var i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return STATIONS[i]; return null; }
    /** Earth rotation angle at TDB t (UT1 taken as UTC = TDB - 69.184 s), ERFA era00 with idea 37's constants. */
    function era(t) { var du = (t - C.tdbMinusUtc_s) / DAY, f = du - Math.floor(du); var a = TWO_PI * (f + ERFA.era.c0 + ERFA.era.c1 * du); a %= TWO_PI; return a < 0 ? a + TWO_PI : a; }
    /** A station's geocentric position and velocity in ICRF axes at t (rotation about z by the ERA; no precession,
     * nutation or polar motion). */
    function stationState(st, t) {
      var th = era(t), c = Math.cos(th), s = Math.sin(th), x = st.xyz;
      var r = [c * x[0] - s * x[1], s * x[0] + c * x[1], x[2]];
      return { r: r, v: [-ERA_RATE * r[1], ERA_RATE * r[0], 0] };
    }
    function elevation(st, t, rhoGeo) { var S = stationState(st, t), rho = sub(rhoGeo, S.r); return Math.asin(Math.max(-1, Math.min(1, dot(unit(rho), unit(S.r))))); }
    /** Partials (1 x 6, against the heliocentric state) and values of two-way range and Doppler from station st. */
    function rangeDoppler(st, t, xs, E) {
      var S = stationState(st, t), rho = sub(sub(xs.slice(0, 3), E.r), S.r), rv = sub(sub(xs.slice(3), E.v), S.v), rn = norm(rho), u = scale(rho, 1 / rn), rr = dot(u, rv);
      var hR = [u[0], u[1], u[2], 0, 0, 0], tp = scale(sub(rv, scale(u, rr)), 1 / rn), hD = [tp[0], tp[1], tp[2], u[0], u[1], u[2]];
      return { range: rn, rangeRate: rr, hRange: hR, hDoppler: hD };
    }
    /** Delta-DOR on a baseline: the line-of-sight angle along the baseline's projection on the plane of the sky. */
    function ddor(b, t, xs, E) {
      var A = stationState(stationById(b[0]), t), B = stationState(stationById(b[1]), t), rho = sub(xs.slice(0, 3), E.r), rn = norm(rho), u = scale(rho, 1 / rn);
      var base = sub(B.r, A.r), proj = sub(base, scale(u, dot(base, u))), pn = norm(proj);
      if (!(pn > 0)) return null;
      var e = scale(proj, 1 / pn);
      return { h: [e[0] / rn, e[1] / rn, e[2] / rn, 0, 0, 0], baselineProjection_m: pn, name: b[2] };
    }

    // ================================================================== presets and settings
    var EXEC = {
      lucy: (function () { var P = NAV.presets.lucy.execution; return { name: 'Lucy (30 mm/s + 4 %, 3 sigma, spherical)', sigmaFixed_m_s: P.fixed3sigma_m_s / 3, sigmaProp: P.proportional3sigma / 3, source: NAV.presets.lucy.source }; })(),
      em1: (function () { var P = NAV.presets.em1.execution3sigma; return { name: 'Orion EM-1 (noise and bias 3 mm/s, scale 30 ppm, misalignment 0.03 deg, 3 sigma)', sigmaFixed_m_s: Math.hypot(P.noise_m_s, P.bias_m_s) / 3, sigmaScale: P.scaleFactor / 3, sigmaPoint_rad: P.misalignmentDeg * DEG / 3, source: NAV.presets.em1.source }; })(),
      none: { name: 'perfect execution', sigmaFixed_m_s: 0, sigmaProp: 0 }
    };
    /** Gates' four errors (JPL TR 32-504): along u, proportional (sigma_s) and fixed (sigma_r); across, proportional
     * (sigma_p) and fixed (sigma_a). A spherical preset has sigma_s = sigma_p and sigma_r = sigma_a. */
    function gatesOf(ex) {
      if (ex.sigmaScale !== undefined) return { s: ex.sigmaScale, r: ex.sigmaFixed_m_s, p: ex.sigmaPoint_rad, a: ex.sigmaFixed_m_s };
      return { s: ex.sigmaProp, r: ex.sigmaFixed_m_s, p: ex.sigmaProp, a: ex.sigmaFixed_m_s };
    }
    function navPreset(key) {
      var L = NAV.presets.lucy, D = NAV.presets.dsn;
      if (key === 'dsn') return { preset: 'dsn', doppler_m_s: D.doppler_m_s, range_m: D.range_m, ddor_ns: D.ddor_ns, passesPerWeek: L.passesPerWeek, passHours: L.passHours, ddorPerWeek: L.ddorSessionsPerWeek,
        contDepDays: 7, contArrDays: L.continuousTrackingBeforeArrival_d, cutoffDays: L.cutoffLead_d, stochastic_m_s2: L.stochasticAccel_m_s2, stochasticBatch_s: L.stochasticBatch_s, dumps: true };
      return { preset: 'lucy', doppler_m_s: L.doppler_m_s, range_m: L.range_m, ddor_ns: L.ddor_ns, passesPerWeek: L.passesPerWeek, passHours: L.passHours, ddorPerWeek: L.ddorSessionsPerWeek,
        contDepDays: 7, contArrDays: L.continuousTrackingBeforeArrival_d, cutoffDays: L.cutoffLead_d, stochastic_m_s2: L.stochasticAccel_m_s2, stochasticBatch_s: L.stochasticBatch_s, dumps: true };
    }
    function defaults() {
      return {
        departure: 'auto', aim: 'injection', target: 'nbody',
        force: { earth: true, moon: true, planets: true, earthJ2: true, relativity: true, srp_m2_kg: 0, cr: 1 },
        tcms: [{ name: 'TCM-1', from: 'departure', days: 10 }, { name: 'TCM-2', from: 'departure', days: 60 }, { name: 'TCM-3', from: 'arrival', days: 60 }, { name: 'TCM-4', from: 'arrival', days: 30 }, { name: 'TCM-5', from: 'arrival', days: 7 }],
        injection: 'coveap', execution: 'lucy', nav: navPreset('lucy'), nodeHours: 2, samples: 4000, seed: 40
      };
    }
    function validSettings(S, tof) {
      var e = [];
      if (['auto', 'patched_conic', 'planned_37', 'flown_38'].indexOf(S.departure) < 0) e.push('departure must be auto, patched_conic, planned_37 or flown_38');
      if (['injection', 'tcm1'].indexOf(S.aim) < 0) e.push('aim must be injection or tcm1');
      if (['nbody', 'two_body'].indexOf(S.target) < 0) e.push('target must be nbody or two_body');
      if (['coveap', 'requirement', 'inca', 'none'].indexOf(S.injection) < 0) e.push('injection must be coveap, requirement, inca or none');
      if (!EXEC[S.execution]) e.push('execution must be lucy, em1 or none');
      var F = S.force || {};
      if (!(num(F.srp_m2_kg) && F.srp_m2_kg >= 0 && F.srp_m2_kg <= 0.1)) e.push('the sunlit area per mass must be 0 to 0.1 m^2/kg');
      if (!(num(F.cr) && F.cr >= 1 && F.cr <= 2)) e.push('Cr must be 1 to 2');
      if (!(S.nodeHours === 1 || S.nodeHours === 2 || S.nodeHours === 3 || S.nodeHours === 4 || S.nodeHours === 6)) e.push('the node spacing must be 1, 2, 3, 4 or 6 hours');
      if (!(Number.isInteger(S.samples) && S.samples >= 200 && S.samples <= 20000)) e.push('samples must be 200 to 20000');
      var N = S.nav || {};
      [['doppler_m_s', 1e-6, 1e-2], ['range_m', 0.1, 1e4], ['ddor_ns', 0.001, 10], ['passesPerWeek', 0, 21], ['passHours', 1, 24], ['ddorPerWeek', 0, 7], ['contDepDays', 0, 60], ['contArrDays', 0, 60], ['cutoffDays', 0.5, 14], ['stochastic_m_s2', 0, 1e-6]].forEach(function (q) {
        if (!(num(N[q[0]]) && N[q[0]] >= q[1] && N[q[0]] <= q[2])) e.push('nav.' + q[0] + ' must be ' + q[1] + ' to ' + q[2]);
      });
      if (!Array.isArray(S.tcms) || S.tcms.length > 8) e.push('at most 8 TCMs');
      else S.tcms.forEach(function (m, i) {
        if (!(m && (m.from === 'departure' || m.from === 'arrival') && num(m.days) && m.days > 0)) e.push('TCM ' + (i + 1) + ' needs from departure|arrival and positive days');
        else if (tof && m.days * DAY >= tof) e.push((m.name || 'TCM ' + (i + 1)) + ' at ' + m.days + ' days lies outside the ' + fmt(tof / DAY, 4) + '-day cruise');
      });
      return e;
    }

    // ================================================================== the navigation covariance analysis
    function injectionCov(key, xGeo) {
      if (key === 'none') return mzero(6);
      var J = NAV.presets.em1.injection3sigma[key], U = unit(xGeo.r), W = unit(cross(xGeo.r, xGeo.v)), V = cross(W, U);
      var axes = [U, V, W], P = mzero(6);
      for (var blk = 0; blk < 2; blk++) {
        var sig = blk === 0 ? J.position_m : J.velocity_m_s;
        for (var a = 0; a < 3; a++) { var s2 = (sig[a] / 3) * (sig[a] / 3), ax = axes[a]; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) P[(3 * blk + i) * 6 + 3 * blk + j] += s2 * ax[i] * ax[j]; }
      }
      return P;
    }
    function processQ(q, dt) {   // white acceleration noise, PSD q (m^2/s^3)
      var Q = mzero(6), a = q * dt * dt * dt / 3, b = q * dt * dt / 2, c = q * dt;
      for (var i = 0; i < 3; i++) { Q[i * 6 + i] = a; Q[i * 6 + 3 + i] = b; Q[(3 + i) * 6 + i] = b; Q[(3 + i) * 6 + 3 + i] = c; }
      return Q;
    }
    function kalman(Pn, Pe, h, s2) {   // scalar update; returns false when the datum carries no information
      var Ph = mmul(Pn, h, 6, 6, 1), S = dot6(h, Ph) + s2;
      if (!(S > 0)) return false;
      for (var i = 0; i < 6; i++) for (var j = 0; j < 6; j++) { var d = Ph[i] * Ph[j] / S; Pn[i * 6 + j] -= d; Pe[i * 6 + j] += d; }
      return true;
    }
    function dot6(a, b) { var s = 0; for (var i = 0; i < 6; i++) s += a[i] * b[i]; return s; }
    function posSigma(P) { return Math.sqrt(Math.max(0, P[0] + P[7] + P[14])); }   // RSS of the position standard deviations
    function velSigma(P) { return Math.sqrt(Math.max(0, P[21] + P[28] + P[35])); }
    /**
     * Linear covariance analysis along the reference (times T, states X, per-interval STMs Phi). Events: tracking (per
     * the schedule in N), the TCMs (node indices in tcmNodes, each targeting the position at the last node), momentum
     * dumps. Returns the history (sampled), the TCM statistics and the covariances at arrival.
     */
    function navigate(T, X, Phi, tcmNodes, detDv, S, injCov, trace) {
      var N = S.nav, n = T.length, tArr = T[n - 1], t0 = T[0], ex = gatesOf(EXEC[S.execution]);
      var Pn = injCov.slice(), Pe = mzero(6), q = N.stochastic_m_s2 * N.stochastic_m_s2 * N.stochasticBatch_s, lastData = 0;
      // every Kalman update goes through here; `trace` (tests) records the type and the weight each one used
      function upd(h, s2, type, k, bl) { if (!kalman(Pn, Pe, h, s2)) return false; counts[type]++; if (trace) trace.push({ type: type, s2: s2, k: k, baseline: bl }); return true; }
      // Psi_k = Phi(tArr, t_k), kept at the TCM nodes and every sampled node
      var every = Math.max(1, Math.round(6 / S.nodeHours)), keep = {}, Psi = meye(6);
      tcmNodes.forEach(function (k) { keep[k] = true; });
      var PsiAt = {}; PsiAt[n - 1] = Psi.slice();
      for (var k = n - 2; k >= 0; k--) { Psi = mmul(Psi, Phi[k], 6, 6, 6); if (keep[k] || k % every === 0) PsiAt[k] = Psi; }
      // the data schedule
      var cut = tcmNodes.map(function (k) { return [T[k] - N.cutoffDays * DAY, T[k]]; });
      function blocked(t) { for (var i = 0; i < cut.length; i++) if (t >= cut[i][0] && t < cut[i][1]) return true; return false; }
      function regime(t) { if (t - t0 < N.contDepDays * DAY || tArr - t <= N.contArrDays * DAY) return 'continuous'; return 'passes'; }
      var counts = { doppler: 0, range: 0, ddor: 0, ddorSkipped: 0, blockedNodes: 0 }, history = [], tcm = [], rand = rng(S.seed >>> 0);
      var dayPlans = {}, rangeEvery = Math.max(1, Math.round(N.passHours / S.nodeHours));
      function plan(dayIdx) {   // which nodes of this day carry Doppler/range (pass) and Delta-DOR
        if (dayPlans[dayIdx]) return dayPlans[dayIdx];
        var a = t0 + dayIdx * DAY, nodes = [], p = { doppler: {}, range: {}, ddor: {} };
        for (var k2 = 0; k2 < n; k2++) if (T[k2] >= a && T[k2] < a + DAY) nodes.push(k2);
        var isPass = Math.floor((dayIdx + 1) * N.passesPerWeek / 7) > Math.floor(dayIdx * N.passesPerWeek / 7);
        var isDdor = Math.floor((dayIdx + 1.5) * N.ddorPerWeek / 7) > Math.floor((dayIdx + 0.5) * N.ddorPerWeek / 7);
        if (nodes.length) {
          var elev = {}, E = {};
          nodes.forEach(function (k3) { E[k3] = K39.earthState(T[k3]); var g = sub(X[k3].slice(0, 3), E[k3].r); elev[k3] = STATIONS.map(function (st) { return elevation(st, T[k3], g); }); });
          if (isPass) {   // the complex that sees the spacecraft longest today; the pass centred on its highest point
            var bestSt = -1, bestN = 0;
            STATIONS.forEach(function (st, j) { var c = nodes.filter(function (k4) { return elev[k4][j] >= EL_MIN; }).length; if (c > bestN) { bestN = c; bestSt = j; } });
            if (bestSt >= 0) {
              var top = nodes[0]; nodes.forEach(function (k5) { if (elev[k5][bestSt] > elev[top][bestSt]) top = k5; });
              var half = N.passHours * HOUR / 2, first = true;
              nodes.forEach(function (k6) { if (Math.abs(T[k6] - T[top]) <= half && elev[k6][bestSt] >= EL_MIN) { p.doppler[k6] = bestSt; if (first || k6 === top) { p.range[k6] = bestSt; first = false; } } });
              // one range point per pass, at its highest node
              p.range = {}; p.range[top] = bestSt;
            }
          }
          if (isDdor) BASELINES.forEach(function (bl) {
            var ia = STATIONS.indexOf(stationById(bl[0])), ib = STATIONS.indexOf(stationById(bl[1])), best = -1, bestEl = EL_MIN;
            nodes.forEach(function (k7) { var m = Math.min(elev[k7][ia], elev[k7][ib]); if (m >= bestEl) { bestEl = m; best = k7; } });
            if (best >= 0) { p.ddor[best] = (p.ddor[best] || []).concat([bl]); } else p.ddorSkipped = (p.ddorSkipped || 0) + 1;
          });
        }
        dayPlans[dayIdx] = p;
        return p;
      }
      var tcmIdx = {}; tcmNodes.forEach(function (k, i) { tcmIdx[k] = i; });
      var nextDump = N.dumps ? 4 * DAY : Infinity, dumpSig = NAV.presets.lucy.momentumDumps.sigma3PerAxis_m_s / 3;
      var ddorSigmaDelay = N.ddor_ns * 1e-9 * CLIGHT;   // metres of delay
      var countedDays = {};
      for (var k = 0; k < n; k++) {
        var t = T[k];
        // 1. a TCM at this node, designed on the knowledge so far
        if (tcmIdx[k] !== undefined) {
          var Pk = PsiAt[k], Prv = block(Pk, 6, 0, 3, 3, 3), Prr = block(Pk, 6, 0, 0, 3, 3), inv = inv3(Prv);
          if (!inv) return { refusal: refusal('not_found', 'The TCM at ' + K39.utcOf(t) + ' cannot target the arrival (singular map).', 'Move it earlier.', { applies_to: 'tcm_schedule' }) };
          var A = mmul(inv, Prr, 3, 3, 3), G = mzero(3, 6);
          for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) { G[i * 6 + j] = -A[i * 3 + j]; G[i * 6 + 3 + j] = (i === j ? -1 : 0); }
          var Sdv = msym(mmul(mmul(G, Pe, 3, 6, 6), mT(G, 3, 6), 3, 6, 3), 3), m = detDv[tcmIdx[k]] || [0, 0, 0];
          // no datum since the last TCM: the estimate still predicts no miss, so G x_est is zero (not round-off)
          if (tcm.length && counts.doppler + counts.range + counts.ddor === lastData) Sdv = mzero(3);
          var stats = dvStats(m, Sdv, ex, S.samples, rand);
          var nData = counts.doppler + counts.range + counts.ddor;   // data in hand when it is designed (all before its cutoff)
          tcm.push({ index: tcmIdx[k], node: k, tdb: t, deterministic: m, cov: Sdv, stats: stats, knowledgePos_m: posSigma(Pn), knowledgeVel_m_s: velSigma(Pn), dispersionPos_m: posSigma(madd(Pe, Pn)), dispersionVel_m_s: velSigma(madd(Pe, Pn)), dataTotal: nData, dataNew: nData - lastData });
          lastData = nData;
          // the estimate moves by B G; the knowledge error gains the execution error
          var IBG = meye(6); for (var i2 = 0; i2 < 3; i2++) for (var j2 = 0; j2 < 6; j2++) IBG[(3 + i2) * 6 + j2] += G[i2 * 6 + j2];
          Pe = sandwich(IBG, Pe, 6);
          var Le = stats.execCov; for (var i3 = 0; i3 < 3; i3++) for (var j3 = 0; j3 < 3; j3++) Pn[(3 + i3) * 6 + 3 + j3] += Le[i3 * 3 + j3];
        }
        // 2. momentum dumps (an unknown small velocity change each)
        if (t - t0 >= nextDump) { for (var a2 = 3; a2 < 6; a2++) Pn[a2 * 6 + a2] += dumpSig * dumpSig; nextDump += 4 * DAY; }
        // 3. tracking at this node
        if (blocked(t)) counts.blockedNodes++;
        else {
          var E = K39.earthState(t), g = sub(X[k].slice(0, 3), E.r), di = Math.floor((t - t0) / DAY);
          if (regime(t) === 'continuous') {
            var bj = -1, be = EL_MIN; STATIONS.forEach(function (st, j4) { var el = elevation(st, t, g); if (el >= be) { be = el; bj = j4; } });
            if (bj >= 0) {
              var md = rangeDoppler(STATIONS[bj], t, X[k], E);
              upd(md.hDoppler, N.doppler_m_s * N.doppler_m_s, 'doppler', k);
              if (k % rangeEvery === 0) upd(md.hRange, N.range_m * N.range_m, 'range', k);
            }
          } else {
            var pl = plan(di);
            if (pl.doppler[k] !== undefined) upd(rangeDoppler(STATIONS[pl.doppler[k]], t, X[k], E).hDoppler, N.doppler_m_s * N.doppler_m_s, 'doppler', k);
            if (pl.range[k] !== undefined) upd(rangeDoppler(STATIONS[pl.range[k]], t, X[k], E).hRange, N.range_m * N.range_m, 'range', k);
          }
          if (tArr - t > N.contArrDays * DAY) {
            var pl2 = plan(di);
            if (pl2.ddor[k]) pl2.ddor[k].forEach(function (bl) { var dd = ddor(bl, t, X[k], E); if (dd) { var s = ddorSigmaDelay / dd.baselineProjection_m; upd(dd.h, s * s, 'ddor', k, bl); } });
            if (!countedDays[di]) { countedDays[di] = true; counts.ddorSkipped += pl2.ddorSkipped || 0; }
          }
        }
        // 4. the history (every 6 h): knowledge now, and knowledge and dispersion mapped to the arrival
        if (PsiAt[k] && (k % every === 0 || k === n - 1)) {
          var Pt = madd(Pe, Pn), Mk = PsiAt[k];
          history.push({ tdb: t, knowledge_m: posSigma(Pn), knowledgeVel_m_s: velSigma(Pn), dispersion_m: posSigma(Pt), knowledgeAtArrival_m: posSigma(sandwich(Mk, Pn, 6)), dispersionAtArrival_m: posSigma(sandwich(Mk, Pt, 6)) });
        }
        // 5. on to the next node
        if (k < n - 1) { Pn = madd(sandwich(Phi[k], Pn, 6), processQ(q, T[k + 1] - t)); Pe = sandwich(Phi[k], Pe, 6); }
      }
      return { history: history, tcm: tcm, counts: counts, arrival: { knowledge: Pn, dispersion: madd(Pe, Pn) } };
    }
    /** Statistics of |dv| for dv ~ N(m, S), and Gates' execution covariance for it (the same seeded samples). */
    function dvStats(m, Sdv, ex, nSamp, rand) {
      var L = chol3(Sdv), mags = [], Gg = mzero(3), Lu = mzero(3);
      for (var i = 0; i < nSamp; i++) {
        var z = [rand.n(), rand.n(), rand.n()], u = [m[0] + L[0] * z[0], m[1] + L[3] * z[0] + L[4] * z[1], m[2] + L[6] * z[0] + L[7] * z[1] + L[8] * z[2]];
        var v2 = dot(u, u); mags.push(Math.sqrt(v2));
        for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) { Lu[a * 3 + b] += u[a] * u[b] / nSamp; if (v2 > 0) Gg[a * 3 + b] += u[a] * u[b] / v2 / nSamp; }
      }
      mags.sort(function (x, y) { return x - y; });
      var V2 = Lu[0] + Lu[4] + Lu[8], Le = mzero(3);
      for (var a2 = 0; a2 < 3; a2++) for (var b2 = 0; b2 < 3; b2++) {
        var I = a2 === b2 ? 1 : 0;
        Le[a2 * 3 + b2] = ex.s * ex.s * Lu[a2 * 3 + b2] + ex.r * ex.r * Gg[a2 * 3 + b2] + ex.p * ex.p * (V2 * I - Lu[a2 * 3 + b2]) + ex.a * ex.a * (I - Gg[a2 * 3 + b2]);
      }
      var sum = 0; mags.forEach(function (x) { sum += x; });
      return { mean_m_s: sum / nSamp, p50_m_s: quantile(mags, 0.5), p99_m_s: quantile(mags, 0.99), p9973_m_s: quantile(mags, 0.9973), rss_m_s: Math.sqrt(V2), execCov: msym(Le, 3), samples: nSamp };
    }

    // ================================================================== the whole page state
    /** The body record idea 39's kernel reads, rebuilt from the target a 39 handoff carries (SI back to Aster's km). */
    function bodyFromTarget(T) {
      var E = T.elements_ecliptic_j2000;
      return { designation: T.designation, name: T.name, spkId: T.spk_id, orbitClass: T.orbit_class, H: T.H, estimatedRadiusM: T.estimated_radius_m, conditionCode: T.condition_code, dataArcDays: T.data_arc_days, tier: T.aster_tier,
        elements: { aKm: E.a_m / 1000, e: E.e, iRad: E.i_rad, omRad: E.node_rad, wRad: E.argp_rad, maRad: E.mean_anomaly_rad, epochTdbJd: E.epoch_tdb_jd } };
    }
    var K39BY = {};
    function k39For(b) {   // idea 39's kernel with this body in its catalog (the six here, or one taken from a handoff)
      if (!b) return K39;
      for (var i = 0; i < CAT.list.length; i++) if (CAT.list[i].designation === b.designation) return K39;
      if (!K39BY[b.designation]) K39BY[b.designation] = LR.create({ constants: C, earth: deps.earth, bodies: { list: CAT.list.concat([b]) }, refs: deps.refs });
      return K39BY[b.designation];
    }
    /**
     * Read a 39 handoff: idea 39's own parseHandoff re-derives it (and through it idea 38's checks). A target among the
     * six bodies here must carry Aster's elements exactly; any other of idea 39's bodies is taken with the elements its
     * handoff carries (idea 39 checked them against its 61-body excerpt; this folder keeps six).
     */
    function importLambertsRoad(h39) {
      var h = h39;
      if (typeof h39 === 'string') { try { h = JSON.parse(h39); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 39 (Lambert\'s Road) or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 39 (Lambert\'s Road) or from this page.') };
      if (h.from === '40-long-coast') return parseHandoff(h);
      if (h.from !== '39-lamberts-road') return { refusal: refusal('invalid_input', 'This is a handoff from ' + h.from + '; Long Coast takes idea 39\'s (the transfer it chose).', h.from === '38-burn-out' ? 'Take it through idea 39 (Lambert\'s Road) first.' : 'A handoff from idea 39.') };
      var T = h.outputs && h.outputs.target && h.outputs.target.value;
      if (!T || !T.elements_ecliptic_j2000) return { refusal: refusal('invalid_input', 'Idea 39\'s handoff names no target.', 'The unedited handoff idea 39 exported.') };
      var known = null; CAT.list.forEach(function (b) { if (b.designation === T.designation) known = b; });
      var body = known || bodyFromTarget(T), check = bodyFromTarget(T);
      if (known) {
        var e1 = known.elements, e2 = check.elements, bad = ['aKm', 'e', 'iRad', 'omRad', 'wRad', 'maRad', 'epochTdbJd'].filter(function (k) { return !(Math.abs(e1[k] - e2[k]) <= 1e-12 * Math.max(1, Math.abs(e1[k]))); });
        if (bad.length) return { refusal: refusal('invalid_input', 'The handoff gives ' + T.designation + ' elements that are not Aster\'s (' + bad.join(', ') + ').', 'The unedited handoff idea 39 exported.') };
      }
      var P = k39For(body).parseHandoff(h);
      if (P.refusal) return { refusal: refusal('invalid_input', 'Idea 39\'s own check refuses this handoff: ' + P.refusal.reason, P.refusal.what_would_help) };
      if (!P.R || !P.R.transfer) return { refusal: refusal('insufficient_data', 'Idea 39\'s handoff carries no transfer (its refusals say why): there is nothing to fly.', 'A transfer selected in idea 39.', { applies_to: 'transfer' }) };
      return { h39: h, R39: P.R, targetFromCatalog: !!known };
    }
    /** A 39 handoff made here by idea 39's kernel from its settings (no porkchop grid): the presets and the default. */
    function lambertsRoadFrom(settings, produced) {
      var K = K39, R = K.run(settings, null, { grid: false });
      if (R.refusal) return { refusal: R.refusal };
      if (!R.transfer) return { refusal: R.refusals[0] || refusal('not_found', 'Idea 39 selected no transfer.', 'Other settings.') };
      return K.buildHandoff(R, produced || '2026-10-31T12:00:00Z');
    }
    function chooseDeparture(S, opts) {
      if (S.departure !== 'auto') return opts[S.departure] || null;
      return opts.flown_38 || opts.patched_conic;
    }
    function nodeTimes(t0, t1, stepS, extra) {
      var T = [], set = {};
      for (var t = t0; t < t1 - 1; t += stepS) { T.push(t); }
      (extra || []).forEach(function (x) { if (x > t0 && x < t1) T.push(x); });
      T.push(t1);
      T.sort(function (a, b) { return a - b; });
      return T.filter(function (x, i) { if (i > 0 && Math.abs(x - T[i - 1]) < 1) return false; return true; });
    }
    /**
     * Everything the page shows and the handoff carries. src {h39, R39} from importLambertsRoad; S the settings.
     */
    function run(src, Sin, cache) {
      var S = clone(Sin), R39 = src.R39, tr = R39.transfer, b = R39.body, R = { S: S, src: src, refusals: [] };
      var errs = validSettings(S, tr.tofS);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      // results that do not depend on the navigation settings are kept between runs (a slider moves only the analysis)
      var M = (cache && cache.memo) || {}, pre = src.h39.produced + '|' + tr.depTdb + '|' + tr.arrTdb + '|' + b.designation + '|';
      if (Object.keys(M).length > 40) M = {};
      R.memo = M;
      function memo(key, fn) { var k = pre + key; if (!(k in M)) M[k] = fn(); return M[k]; }
      var fm = forceModel(S.force), tArr = tr.arrTdb, fkey = JSON.stringify(S.force);
      R.fm = fm; R.body = b; R.transfer = tr;
      if (tr.depTdb < span.start || tArr > span.end) { R.refusals.push(spanRefusal(tr.depTdb, tArr)); return R; }
      var opts = departureOptions(R39), dep = chooseDeparture(S, opts);
      R.departureOptions = Object.keys(opts);
      if (!dep) { R.refusals.push(refusal('not_found', 'The departure "' + S.departure + '" is not available for this transfer (available: ' + Object.keys(opts).join(', ') + ').', 'Choose an available departure.', { applies_to: 'departure' })); return R; }
      R.departure = dep;
      // the target, where it really is and where idea 39 put it
      var tg = memo('target|' + fkey, function () { return { n: targetState(b, tArr, fm, 'nbody'), two: targetState(b, tArr, fm, 'two_body') }; });
      if (!tg.n || tg.n.refusal) { R.refusals.push(tg.n && tg.n.refusal ? tg.n.refusal : refusal('not_found', 'No target state at arrival.', 'Another transfer.', { applies_to: 'target' })); return R; }
      R.target = { nbody: tg.n, two_body: tg.two, shift_m: norm(sub(tg.n.r, tg.two.r)), how: S.target };
      var tgt = S.target === 'nbody' ? tg.n : tg.two;
      // the uncorrected flight (the departure as given, every force, no TCM)
      var x0 = helio(dep);
      var unc = memo('unc|' + dep.key + '|' + fkey, function () { return propagate(x0, dep.tdb, tArr, fm); });
      if (unc.refusal) { R.refusals.push(unc.refusal); return R; }
      R.uncorrected = { missAtArrival_m: norm(sub(unc.x.slice(0, 3), tgt.r)), steps: unc.steps };
      // the aim: re-aimed injection, or the departure as given with the deterministic part at TCM-1
      var aimMode = S.aim;
      if (aimMode === 'injection' && dep.key !== 'patched_conic') {
        aimMode = 'tcm1';
        R.refusals.push(refusal('out_of_envelope', 'The ' + (dep.key === 'flown_38' ? 'departure idea 38 flew' : 'departure idea 37 planned') + ' is a state, not a target: it cannot be re-aimed here, so TCM-1 carries its correction.', 'Choose the patched-conic departure to see a re-aimed injection, or take the re-aimed v-infinity back through ideas 37 and 38.', { applies_to: 'aim' }));
      }
      R.aim = aimMode;
      // the TCMs, each on a node of a fixed grid from the departure (moved by at most half the node spacing), so a new
      // schedule reuses the same reference trajectory unless a deterministic correction moves with it
      var step = S.nodeHours * HOUR, T = nodeTimes(dep.tdb, tArr, step, []);
      var tcmsSorted = S.tcms.map(function (m, i) {
        var t = m.from === 'departure' ? dep.tdb + m.days * DAY : tArr - m.days * DAY, k = Math.max(1, Math.min(T.length - 2, Math.round((t - dep.tdb) / step)));
        return { name: m.name || ('TCM-' + (i + 1)), from: m.from, days: m.days, node: k, tdb: T[k] };
      }).sort(function (x, y) { return x.node - y.node; });
      for (var q2 = 1; q2 < tcmsSorted.length; q2++) if (tcmsSorted[q2].node === tcmsSorted[q2 - 1].node) { R.refusals.push(refusal('invalid_input', tcmsSorted[q2 - 1].name + ' and ' + tcmsSorted[q2].name + ' fall on the same ' + S.nodeHours + '-hour node.', 'Separate them by more than ' + S.nodeHours + ' h.', { applies_to: 'tcm_schedule' })); return R; }
      R.tcms = tcmsSorted;
      var tcmNodes = tcmsSorted.map(function (m) { return m.node; });
      var depFinal = dep, detDv = tcmsSorted.map(function () { return [0, 0, 0]; });
      // TCM-1 for the departure as given: what the deterministic correction costs there
      if (!tcmsSorted.length) R.refusals.push(refusal('insufficient_data', 'No TCM is scheduled: the injection error is never corrected and the arrival dispersion is the injection error mapped forward.', 'Add a TCM.', { applies_to: 'tcm_schedule' }));
      var first = tcmsSorted[0], a1 = null;
      if (first) {
        a1 = memo('tcm1|' + dep.key + '|' + S.target + '|' + fkey + '|' + first.tdb, function () {
          var p1 = propagate(x0, dep.tdb, first.tdb, fm);
          return p1.refusal ? p1 : aim(first.tdb, p1.x, tArr, tgt.r, fm);
        });
        if (a1.refusal) {
          if (aimMode === 'tcm1') { R.refusals.push(a1.refusal); return R; }
          R.refusals.push(refusal(a1.refusal.code, 'For comparison only (the injection is re-aimed): ' + a1.refusal.reason, a1.refusal.what_would_help, { applies_to: 'tcm1_as_given' }));
          a1 = null;
        }
        else R.tcm1AsGiven = { dv: a1.dv, dv_m_s: norm(a1.dv), iterations: a1.iterations, tdb: first.tdb };
      }
      if (aimMode === 'injection') {
        // the Newton start depends on TCM-1's correction, so its time is in the key: without it a page that moved TCM-1
        // reused a re-aim a fresh run would not find (1 km apart), and its own export was refused on import (review fix)
        var ai = memo('aimv|' + S.target + '|' + fkey + '|' + (a1 ? first.tdb : ''), function () { return aimVinf(dep.vinf, dep.tdb, tArr, tgt.r, fm, a1 ? add(dep.vinf, a1.dv) : null); });
        if (ai.refusal) { R.refusals.push(refusal(ai.refusal.code, ai.refusal.reason, 'Aim with TCM-1 instead (the departure as given, corrected ' + (first ? first.days + ' days out' : 'later') + ').', { applies_to: 'targeting' })); return R; }
        depFinal = { key: dep.key, label: dep.label + ', re-aimed', tdb: dep.tdb, rGeo: ai.departure.rGeo, vGeo: ai.departure.vGeo, vinf: ai.vinf, source: dep.source };
        R.reaim = { vinf: ai.vinf, dvinf: ai.dvinf, dvinf_m_s: norm(ai.dvinf), periapsisSpeedChange_m_s: norm(ai.departure.vGeo) - norm(dep.vGeo), iterations: ai.iterations, miss_m: ai.miss_m, c3: dot(ai.vinf, ai.vinf), dla: K39.dlaDeg(ai.vinf), rla: K39.rlaDeg(ai.vinf), band: K39.band(K39.dlaDeg(ai.vinf), R39.S.site) };
      }
      if (R.reaim && R.reaim.dvinf_m_s > 0.5 * norm(dep.vinf)) R.refusals.push(refusal('out_of_envelope', 'The re-aimed v-infinity (' + fmt(norm(R.reaim.vinf), 4) + ' m/s) differs from idea 39\'s (' + fmt(norm(dep.vinf), 4) + ' m/s) by ' + fmt(R.reaim.dvinf_m_s, 4) + ' m/s, more than half of it: at this energy the Earth and the Sun shape the departure so much that the patched conic is not a starting point, and the n-body transfer found here may be a different one from the cell idea 39 chose.', 'A transfer with a larger departure C3, or a departure designed in the full n-body problem from the start.', { applies_to: 'patched_conic' }));
      R.departureFlown = depFinal;
      if (aimMode === 'tcm1' && a1) detDv[0] = a1.dv;
      // the reference trajectory, node by node with its STMs
      var x0f = helio(depFinal), imp = {};
      tcmNodes.forEach(function (k, i) { if (norm(detDv[i]) > 0) imp[k] = detDv[i]; });
      var ref = memo('ref|' + JSON.stringify([dep.key, aimMode, S.target, S.force, S.nodeHours, imp, depFinal.rGeo, depFinal.vGeo]), function () { return propagateNodes(x0f, T, fm, imp); });
      if (ref.refusal) { R.refusals.push(ref.refusal); return R; }
      var xEnd = ref.X[ref.X.length - 1];
      R.reference = { T: T, X: ref.X, Phi: ref.Phi, steps: ref.steps, missAtArrival_m: norm(sub(xEnd.slice(0, 3), tgt.r)), tcmNodes: tcmNodes, detDv: detDv };
      var ER = earthReturn(T, ref.X), out = ER.leftSphere, ret = ER.ret;
      R.reference.earthReturn = { leftSphere: out, minDistance_m: ER.minDistance_m, tdb: ER.tdb };
      if (!out) R.refusals.push(refusal('out_of_envelope', 'The spacecraft never gets ' + fmt(R_GEO / 1e3, 4) + ' km from the Earth before the arrival: this is not a cruise between the Earth and an asteroid.', 'A transfer that leaves the Earth.', { applies_to: 'cruise_earth_encounter' }));
      else if (ret) R.refusals.push(refusal('out_of_envelope', 'The cruise comes back inside the Earth\'s sphere of influence (' + fmt(K39.soi_m / 1e3, 4) + ' km) on ' + K39.utcOf(ret.tdb).slice(0, 10) + ', ' + fmt(ret.distance_m / 1e3, 4) + ' km from it: an Earth flyby this module neither targets nor navigates (no flyby B-plane, no Earth tracking geometry for it).', 'A transfer that does not return to the Earth, or a flyby designed as its own leg.', { applies_to: 'cruise_earth_encounter', encounter_tdb_s_past_j2000: ret.tdb, encounter_distance_m: ret.distance_m }));
      R.arrival = { tdb: tArr, r: xEnd.slice(0, 3), v: xEnd.slice(3), targetR: tgt.r, targetV: tgt.v, vinf: sub(xEnd.slice(3), tgt.v) };
      // the navigation analysis
      var injCov = injectionCov(S.injection, { r: depFinal.rGeo, v: depFinal.vGeo });
      var nav = navigate(T, ref.X, ref.Phi, tcmNodes, detDv, S, injCov);
      if (nav.refusal) { R.refusals.push(nav.refusal); return R; }
      // a TCM designed before any tracking datum has nothing to act on: its "statistics" would be those of a zero
      // estimate (1e-157 m/s), so the budget is refused rather than shown (review fix)
      var blind = nav.tcm.filter(function (m) { return m.dataTotal === 0; })[0];
      if (blind) { R.refusals.push(refusal('insufficient_data', tcmsSorted[blind.index].name + ' (' + K39.utcOf(blind.tdb).slice(0, 10) + ') is designed before any tracking datum (data cut off ' + S.nav.cutoffDays + ' days before it; tracking as set): there is no estimate to correct, so no budget or delivery can be stated.', 'A later ' + tcmsSorted[blind.index].name + ', a shorter data cutoff, or tracking after launch.', { applies_to: 'tcm_schedule' })); return R; }
      var budget = budgetOf(nav, tcmsSorted), delivery = bplane(nav.arrival, R.arrival);
      if (![budget, delivery, nav.arrival].every(allFinite)) { R.refusals.push(refusal('not_found', 'The navigation analysis did not stay finite for these settings.', 'Other tracking or TCM settings.', { applies_to: 'tracking' })); return R; }
      R.nav = nav;
      R.budget = budget;
      R.delivery = delivery;
      ownRefusals(R, S, dep, tcmsSorted, nav);
      return R;
    }
    /** A return to the Earth along a path (times T, heliocentric states X): once it is out of R_GEO, the first node back
     * inside the Earth's sphere of influence (Laplace's, idea 39's), and the closest node after leaving. */
    function earthReturn(T, X) {
      var out = false, ret = null, minAfter = Infinity, minAt = null;
      for (var kq = 0; kq < T.length; kq++) {
        var Eq = K39.earthState(T[kq]), dq = norm(sub(X[kq].slice(0, 3), Eq.r));
        if (!out) { if (dq > R_GEO) out = true; continue; }
        if (dq < minAfter) { minAfter = dq; minAt = T[kq]; }
        if (!ret && dq < K39.soi_m) ret = { tdb: T[kq], distance_m: dq };
      }
      return { leftSphere: out, minDistance_m: out ? minAfter : null, tdb: minAt, ret: ret };
    }
    function allFinite(o) { if (typeof o === 'number') return isFinite(o); if (o && typeof o === 'object') { for (var k in o) if (!allFinite(o[k])) return false; } return true; }
    function budgetOf(nav, tcms) {
      var rows = nav.tcm.map(function (m, i) { return { name: tcms[i].name, tdb: m.tdb, deterministic_m_s: norm(m.deterministic), mean_m_s: m.stats.mean_m_s, p99_m_s: m.stats.p99_m_s, p9973_m_s: m.stats.p9973_m_s, knowledgePos_m: m.knowledgePos_m, dispersionPos_m: m.dispersionPos_m }; });
      var sum = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); };
      return { rows: rows, totalDeterministic_m_s: sum('deterministic_m_s'), totalMean_m_s: sum('mean_m_s'), totalP99_m_s: sum('p99_m_s'), totalP9973_m_s: sum('p9973_m_s') };
    }
    /** Position covariances at arrival on the approach plane: S along the arrival v-infinity, T in the ecliptic, R. */
    function bplane(arr, A) {
      var Sh = unit(A.vinf), Th = unit(cross(Sh, K39.eclipticPole)), Rh = cross(Sh, Th), M = [Th, Rh, Sh];
      function proj(P) {
        var Pp = block(P, 6, 0, 0, 3, 3), Mm = [M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]];
        var Q = msym(mmul(mmul(Mm, Pp, 3, 3, 3), mT(Mm, 3, 3), 3, 3, 3), 3), a = Q[0], b2 = Q[1], c = Q[4];
        var tr2 = a + c, det = a * c - b2 * b2, l1 = tr2 / 2 + Math.sqrt(Math.max(0, tr2 * tr2 / 4 - det)), l2 = tr2 / 2 - Math.sqrt(Math.max(0, tr2 * tr2 / 4 - det));
        var th = 0.5 * Math.atan2(2 * b2, a - c);
        return { semiMajor3s_m: 3 * Math.sqrt(Math.max(0, l1)), semiMinor3s_m: 3 * Math.sqrt(Math.max(0, l2)), thetaDeg: th / DEG, along3s_m: 3 * Math.sqrt(Math.max(0, Q[8])), time3s_s: 3 * Math.sqrt(Math.max(0, Q[8])) / norm(A.vinf), cov: Q };
      }
      return { knowledge: proj(arr.knowledge), dispersion: proj(arr.dispersion), axes: { T: Th, R: Rh, S: Sh } };
    }
    function ownRefusals(R, S, dep, tcms, nav) {
      // carried on, except the two this module lifts: idea 39's `dynamics` (patched conics) and idea 38's `post_cutoff`
      // (its asymptote followed J2 to 20 Earth radii but not the Moon or the Sun): the departure here is flown from the
      // periapsis with the Earth, its J2, the Moon, the Sun and the planets
      var LIFTED = { dynamics: true, post_cutoff: true };
      var src = R.src, carried = (src.h39.refusals || []).filter(function (r) { return !LIFTED[r.applies_to]; }).map(function (r) { var q = clone(r); if (!q.from) q.from = '39-lamberts-road'; return q; });
      carried.forEach(function (r) { R.refusals.push(r); });
      if (S.force.srp_m2_kg === 0) R.refusals.push(refusal('insufficient_data', 'Sunlight is not modelled: no spacecraft area per mass is given (the chain has no spacecraft yet). It is not small: JPL\'s OSIRIS-APEX predict, flown here without it, drifts 9,400 km from JPL\'s in 200 days of 2026 (it fits 0.013 m^2/kg, oracle), and a TCM can absorb it only if it is modelled.', 'The spacecraft\'s sunlit area, mass and reflectivity (set the area per mass here).', { applies_to: 'srp' }));
      R.refusals.push(refusal('insufficient_data', 'The asteroid\'s own orbit uncertainty is not mapped to the arrival: the spacecraft is delivered relative to where Aster\'s elements put it, and the approach (optical navigation) that cuts the target\'s uncertainty is module 42\'s.', 'The orbit\'s covariance from JPL\'s Small-Body Database, and approach optical navigation (module 42).', { applies_to: 'target_knowledge' }));
      if (nav.counts.ddorSkipped > 0) R.refusals.push(refusal('out_of_envelope', nav.counts.ddorSkipped + ' Delta-DOR baseline sessions found no hour with both stations above ' + NAV.stations.elevationMinDeg + ' deg: the spacecraft\'s declination puts it out of their common sky.', 'Another agency\'s antennas for a north-south baseline (ESA, as Lucy\'s paper notes), or fewer sessions.', { applies_to: 'ddor' }));
      tcms.forEach(function (m, i) {
        var prev = i === 0 ? dep.tdb : tcms[i - 1].tdb;
        if (m.tdb - S.nav.cutoffDays * DAY <= dep.tdb + 0.5 * DAY) R.refusals.push(refusal('insufficient_data', m.name + ' is designed on less than half a day of tracking (data cut off ' + S.nav.cutoffDays + ' days before it): its statistics assume the injection error is barely measured.', 'A later ' + m.name + ', or a shorter data cutoff.', { applies_to: 'tcm_schedule' }));
        else if (i > 0 && nav.tcm[i] && nav.tcm[i].dataNew === 0) R.refusals.push(refusal('insufficient_data', m.name + ' gets no tracking datum after ' + tcms[i - 1].name + ' (data cut off ' + S.nav.cutoffDays + ' days before it): it learns nothing new, so its statistical delta-v is zero and it corrects nothing.', 'More passes or Delta-DOR sessions, or another schedule.', { applies_to: 'tcm_schedule' }));
        else if (m.tdb - prev < S.nav.cutoffDays * DAY) R.refusals.push(refusal('insufficient_data', m.name + ' comes ' + fmt((m.tdb - prev) / DAY, 3) + ' days after the previous event, inside its ' + S.nav.cutoffDays + '-day data cutoff: it is designed without tracking the previous one\'s execution.', 'Space the TCMs further apart.', { applies_to: 'tcm_schedule' }));
      });
    }

    // ================================================================== handoff (version 1, from "40-long-coast")
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function covOut(P, n) { var o = []; for (var i = 0; i < n; i++) o.push(P.slice(i * n, i * n + n)); return o; }
    function buildHandoff(R, produced) {
      var S = R.S, h = { handoff: 'long-way-round', version: 1, from: '40-long-coast', produced: produced || new Date().toISOString() };
      h.inputs = { lamberts_road_handoff: R.src.h39, settings: clone(S) };
      var O = {}, u = K39.utcOf;
      if (R.arrival && R.budget) {
        O.arrival_state = qv({ tdb_s_past_j2000: R.arrival.tdb, utc: u(R.arrival.tdb), r_m: R.arrival.r, v_m_s: R.arrival.v, target_r_m: R.arrival.targetR, target_v_m_s: R.arrival.targetV, v_infinity_arrival_m_s: R.arrival.vinf, v_infinity_arrival_magnitude_m_s: norm(R.arrival.vinf), target_ephemeris: S.target, frame: 'heliocentric ICRF/J2000, Sun centre' },
          's, m, m/s', 'derived', KERNEL + ' reference trajectory: n-body (Sun, Mercury..Neptune, the Moon, Earth J2, solar relativity' + (S.force.srp_m2_kg > 0 ? ', sunlight' : '') + '), aimed at the target\'s ' + (S.target === 'nbody' ? 'n-body' : 'two-body') + ' position at idea 39\'s arrival epoch');
        O.arrival_covariance = qv({ knowledge_m_m_s: covOut(R.nav.arrival.knowledge, 6), dispersion_m_m_s: covOut(R.nav.arrival.dispersion, 6), knowledge_position_sigma_rss_m: posSigma(R.nav.arrival.knowledge), dispersion_position_sigma_rss_m: posSigma(R.nav.arrival.dispersion),
          approach_plane: { axes: R.delivery.axes, knowledge: stripCov(R.delivery.knowledge), dispersion: stripCov(R.delivery.dispersion) } },
          'm, m/s', 'derived', KERNEL + ' navigate(): linear covariance analysis, ' + S.nav.preset + ' tracking assumptions, ' + S.injection + ' injection accuracy, ' + S.execution + ' execution errors');
        O.tcm_budget = qv({ tcms: R.budget.rows.map(function (r) { return { name: r.name, tdb_s_past_j2000: r.tdb, utc: u(r.tdb), deterministic_m_s: r.deterministic_m_s, statistical_mean_m_s: r.mean_m_s, statistical_p99_m_s: r.p99_m_s, statistical_p9973_m_s: r.p9973_m_s, knowledge_position_sigma_m: r.knowledgePos_m }; }),
          total_deterministic_m_s: R.budget.totalDeterministic_m_s, total_mean_m_s: R.budget.totalMean_m_s, total_p99_m_s: R.budget.totalP99_m_s, total_p9973_m_s: R.budget.totalP9973_m_s, samples: S.samples, seed: S.seed, total_rule: 'sum of per-TCM percentiles (as Orion EM-1\'s Table 7 totals its 99.73 % values)' },
          'm/s', 'derived', KERNEL + ' dvStats(): |dv| of N(deterministic, G P_est G^T), seeded samples');
        O.departure = qv({ kind: R.departure.key, tdb_s_past_j2000: R.departure.tdb, utc: u(R.departure.tdb), r_geocentric_m: R.departure.rGeo, v_geocentric_m_s: R.departure.vGeo, vinf_as_given_m_s: R.departure.vinf, aim: R.aim, reaimed: R.reaim ? { vinf_m_s: R.reaim.vinf, change_m_s: R.reaim.dvinf, change_magnitude_m_s: R.reaim.dvinf_m_s, periapsis_speed_change_m_s: R.reaim.periapsisSpeedChange_m_s, c3_m2_s2: R.reaim.c3, dla_deg: R.reaim.dla, rla_deg: R.reaim.rla, band: R.reaim.band } : null },
          's, m, m/s, m^2/s^2, deg', 'derived', KERNEL + ' departureOptions(), aimVinf()');
        O.patched_conic_check = qv({ uncorrected_miss_at_arrival_m: R.uncorrected.missAtArrival_m, tcm1_as_given_m_s: R.tcm1AsGiven ? R.tcm1AsGiven.dv_m_s : null, target_shift_two_body_to_nbody_m: R.target.shift_m, reference_miss_m: R.reference.missAtArrival_m },
          'm, m/s', 'derived', KERNEL + ' (idea 39\'s departure flown through every force with no correction; the TCM-1 that would correct it; Aster\'s two-body target against the same elements integrated)');
        O.tracking = qv({ preset: S.nav.preset, counts: R.nav.counts, stations: STATIONS.map(function (s) { return s.id; }), elevation_min_deg: NAV.stations.elevationMinDeg, light_time: 'ignored' }, 'count', 'assumed', KERNEL + ' navigate() with ' + NAV.presets[S.nav.preset].source);
      }
      h.outputs = O;
      h.refusals = R.refusals.map(clone);
      h.assumptions = [
        'Frame: heliocentric ICRF/J2000 axes, Sun centre (as idea 39 and Aster); time TDB seconds past J2000, UTC = TDB - ' + C.tdbMinusUtc_s + ' s, UT1 = UTC.',
        'Forces: the Sun (GM ' + MU_SUN + ', Aster), the Earth (GM ' + MU_E + ', Aster; J2 ' + J2E + ' about the ICRF z axis, DE440), the Moon and Mercury..Neptune system barycentres (DE440 GMs), the Sun\'s Schwarzschild term (c ' + CLIGHT + ' m/s); planets by Chebyshev fits of JPL Horizons (Aster\'s daily file and fetched records); no asteroid perturbers, no non-gravitational forces on the target.',
        'Integrator: Dormand-Prince 5(4), relative tolerance ' + TOL.rtol + '; the state transition matrix integrated from the point-mass gravity gradient (J2, relativity and sunlight left out of it).',
        'Navigation: linear covariance analysis; Doppler every ' + S.nodeHours + ' h of a pass, one range point per pass, Delta-DOR on two baselines; stations turned by the Earth rotation angle only; light time ignored; data cut off ' + S.nav.cutoffDays + ' days before each TCM.',
        'TCMs: impulsive, fixed-time position targeting of the arrival; statistics from ' + S.samples + ' seeded samples of N(deterministic, G P G^T); execution errors by Gates\' model.'
      ];
      return h;
    }
    // Reading a handoff back: every output recomputed from the inputs and compared. Epochs to 1 ms; position vectors to
    // 100 m and the reference's own miss to 1 km (the injection aim converges to 1 km, and two JavaScript engines land its
    // last iterate ~15 m apart); covariance entries to 1e-6 of sqrt(P_ii P_jj); every other number to 1e-6 relative. A
    // browser's export read in Node differs by at most 5e-8 relative (measured, README), so the margin is 20x.
    var REL_TOL = 1e-6, EPOCH_TOL_S = 1e-3, POS_TOL_M = 100, MISS_TOL_M = 1000;
    var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    function numDiff(a, b, path) {
      if (/_m_m_s$/.test(path) && Array.isArray(a) && Array.isArray(b) && a.length === 6 && b.length === 6) {
        for (var i = 0; i < 6; i++) for (var j = 0; j < 6; j++) {
          var x = a[i] && a[i][j], y = b[i] && b[i][j];
          if (!(typeof x === 'number' && typeof y === 'number')) return path + '.' + i + '.' + j;
          var sc = Math.sqrt(Math.abs(a[i][i] * a[j][j])) || 1;
          if (Math.abs(x - y) > REL_TOL * sc) return path + '.' + i + '.' + j;
        }
        return null;
      }
      if (typeof a === 'number' || typeof b === 'number') {
        if (!(typeof a === 'number' && typeof b === 'number')) return path;
        if (a === b) return null;
        if (/tdb_s_past_j2000$/.test(path)) return Math.abs(a - b) <= EPOCH_TOL_S ? null : path;
        if (/reference_miss_m$/.test(path)) return Math.abs(a - b) <= MISS_TOL_M ? null : path;
        if (/\.(r_m|target_r_m|r_geocentric_m)\.\d$/.test(path)) return Math.abs(a - b) <= POS_TOL_M ? null : path;
        return Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b)) ? null : path;
      }
      if (typeof a === 'string' && typeof b === 'string' && ISO_RE.test(a) && ISO_RE.test(b)) return Math.abs(Date.parse(a) - Date.parse(b)) <= 1000 * EPOCH_TOL_S ? null : path;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : path;
      if (Array.isArray(a) !== Array.isArray(b)) return path;
      var ks = {}; Object.keys(a).forEach(function (k) { ks[k] = 1; }); Object.keys(b).forEach(function (k) { ks[k] = 1; });
      for (var k in ks) { var d = numDiff(a[k], b[k], path + '.' + k); if (d) return d; }
      return null;
    }
    function codes(L) { return (L || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join(','); }
    /** Read a 40 handoff back: idea 39's inside re-checked by idea 39's kernel, the cruise recomputed and compared. */
    function parseHandoff(h40) {
      var h = h40;
      if (typeof h40 === 'string') { try { h = JSON.parse(h40); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 39 or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round' || h.from !== '40-long-coast' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 handoff from idea 39 or 40.', 'A handoff from idea 39 (Lambert\'s Road) or from this page.') };
      var I = h.inputs || {};
      if (!I.lamberts_road_handoff || !I.settings) return { refusal: refusal('invalid_input', 'This 40-long-coast handoff carries no idea 39 handoff or no settings.', 'A handoff exported by this page.') };
      var src = importLambertsRoad(I.lamberts_road_handoff);
      if (src.refusal) return src;
      if (src.h40) return { refusal: refusal('invalid_input', 'A 40 handoff cannot carry another 40 handoff as its input.', 'A handoff exported by this page.') };
      var R = run(src, I.settings);
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced), keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) {
        var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i]);
        if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '40-long-coast', h40: h, h39: src.h39, R39: src.R39, settings: I.settings, R: R, targetFromCatalog: src.targetFromCatalog };
    }
    function stripCov(p) { return { semi_major_3sigma_m: p.semiMajor3s_m, semi_minor_3sigma_m: p.semiMinor3s_m, theta_deg: p.thetaDeg, along_track_3sigma_m: p.along3s_m, arrival_time_3sigma_s: p.time3s_s }; }

    return {
      constants: C, de440: DE, nav: NAV, k39: K39, span: span, GM: GM, P_SUN_1AU: P_SUN_1AU, STATIONS: STATIONS, EXEC: EXEC,
      ephemeris: ephemeris, accel: accel, accelEarth: accelEarth, accelEarthModel: accelEarthModel, deriv: deriv, propagate: propagate, frameOf: frameOf, R_GEO: R_GEO, propagateNodes: propagateNodes, forceModel: forceModel,
      dopri: dopri, chebPos: chebPos, EPH: EPH, hyperbolaFromVinf: hyperbolaFromVinf, asymptoteOf: asymptoteOf,
      departureOptions: departureOptions, helio: helio, targetState: targetState, aim: aim, aimVinf: aimVinf,
      era: era, stationState: stationState, elevation: elevation, rangeDoppler: rangeDoppler, ddor: ddor, kalman: kalman, gatesOf: gatesOf, dvStats: dvStats,
      injectionCov: injectionCov, processQ: processQ, navPreset: navPreset, defaults: defaults, validSettings: validSettings, navigate: navigate,
      importLambertsRoad: importLambertsRoad, lambertsRoadFrom: lambertsRoadFrom, bodyFromTarget: bodyFromTarget, run: run, earthReturn: earthReturn, buildHandoff: buildHandoff, parseHandoff: parseHandoff, numDiff: numDiff, bplane: bplane, posSigma: posSigma
    };
  }

  return { create: create, dopri: dopri, mmul: mmul, mT: mT, meye: meye, mzero: mzero, sandwich: sandwich, inv3: inv3, chol3: chol3, rng: rng, quantile: quantile, DAY: DAY, DEG: DEG };
});
