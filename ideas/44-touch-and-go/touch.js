/* Touch and Go: descent and contact in milligravity. Idea 44 of the Aster Idea Bank, module 14 of "The Long Way Round".
 *
 * Idea 43 gave the asteroid its real shape and handed on a landing site with its gravity, slope and escape speeds. This
 * module flies the spacecraft down to that site and touches it, the way OSIRIS-REx touched Bennu on 20 October 2020:
 * a departure burn, a Checkpoint burn high above the site, a Matchpoint burn that matches the turning surface, a free
 * fall at about 10 cm/s, contact, a few seconds of sampling, and a back-away burn. Every leg is flown under idea 43's
 * exact polyhedron gravity with the body turning (Bennu's pole and prime meridian; Apophis tumbling), plus idea 42's
 * sunlight. It then asks what a person planning a touchdown needs to know:
 *   - what each burn costs and what propellant that takes (and whether the chain's spacecraft has it);
 *   - how far from the aim point the spacecraft touches, given navigation and burn errors (linear covariance through
 *     the exact field, against OSIRIS-REx's published Monte Carlo);
 *   - how deep the sampler sinks in Bennu-like regolith before it backs away (from NASA's measured 48.8 cm in ~6 s);
 *   - for a lander that stays: whether it bounces, how far and for how long, or whether it escapes;
 *   - how hard it can push on the ground before it lifts off, and what holding it down with thrusters costs;
 *   - how much a TAGSAM-class sampler collects (the published sampleability numbers against the 121.6 g returned).
 * The Bennu case is the reality test: the module flies OSIRIS-REx's own reconstructed descent (JPL Horizons) and
 * compares its burns, its contact and its errors with what the spacecraft did.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, N, Pa). Time TDB seconds past J2000 (UTC = TDB - 69.184 s).
 * Frames: ICRF/J2000 axes about the asteroid's centre of mass for flight; the body-fixed frame of idea 43's shape
 * (APOPHIS_CK, IAU_BENNU) for the site, the surface and velocities relative to the ground.
 *
 * What it reuses, unmodified (snapshots/): idea 43's kernel (lumpy.js: fieldRaw, fly, attitude, surface, site,
 * parseHandoff) with its shapes, spin data and idea 40's integrator; idea 42's sunlight, tabulated along the Bennu
 * descent by build-data.mjs (as idea 43 did for Orbital B) and, for the chain, idea 42's handed-on sunlight magnitude.
 * Methods written here: impulsive targeting by Newton shooting through the exact field; linear covariance by finite-
 * difference state transition matrices (checked against a Monte Carlo of the nonlinear flights in the tests); a
 * constant-resistance penetration model; ballistic hops with a coefficient of restitution; statics of holding down.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Touch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, HOUR = 3600;
  var G0 = 9.80665;   // m/s^2, standard gravity, exact by definition (3rd CGPM, 1901); Aster's src/v2/porkchop/launch-vehicles.ts G0_MPS2 and idea 42 use it
  var KERNEL = '44-touch-and-go/touch.js';
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
  function mv(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function mtv(M, v) { return [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]]; }
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function vr9(v) { return v.map(r9); }
  /** Solve A x = b (n x n, row-major nested arrays) by Gaussian elimination with partial pivoting; null if singular. */
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (!(Math.abs(M[p][c]) > 0)) return null;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (r = c + 1; r < n; r++) { var f = M[r][c] / M[c][c]; for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) { var s = M[i][n]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }
  /** Symmetric 2x2 [a b; b c]: eigenvalues (descending) and the major axis angle. */
  function eig2(a, b, c) { var m = (a + c) / 2, d = Math.sqrt(((a - c) / 2) * ((a - c) / 2) + b * b); return { l1: m + d, l2: Math.max(0, m - d), ang: 0.5 * Math.atan2(2 * b, a - c) }; }
  /** P(|x| < R) for x ~ N(0, diag(s1^2, s2^2)) in 2D, by quadrature in polar coordinates (exact to ~1e-6). */
  function pInsideCircle(s1, s2, R) {
    if (!(s1 > 0) || !(s2 > 0)) return 1;
    var nr = 200, nt = 180, P = 0, dr = R / nr, dt = 2 * PI / nt;
    for (var i = 0; i < nr; i++) { var r = (i + 0.5) * dr; for (var j = 0; j < nt; j++) { var t = (j + 0.5) * dt, x = r * Math.cos(t), y = r * Math.sin(t); P += Math.exp(-0.5 * (x * x / (s1 * s1) + y * y / (s2 * s2))) * r * dr * dt; } }
    return Math.min(1, P / (2 * PI * s1 * s2));
  }

  function create(deps) {
    var L = deps.lumpy, REC = deps.recon, SRC = deps.sources, LC = deps.coast;
    var TDB_UTC = deps.constants.tdbMinusUtc_s, G_NEWTON = deps.nist.G_m3_kg_s2;
    function utcOf(tdb) { return new Date(J2000_UNIX_MS + (tdb - TDB_UTC) * 1000).toISOString(); }

    // ------------------------------------------------------------------------------------------------ body and site
    /** The body's frame at t (idea 43's attitude: Bennu's PCK; Apophis's CK sample flown by Euler's equations), cached. */
    function attAt(B, t) {
      B._att = B._att || {};
      var k = t.toFixed(3); if (B._att[k]) return B._att[k];
      var a = L.attitudeAt(B.key, t); if (a.refusal) return a;
      return (B._att[k] = a);
    }
    /** The body model with its attitude moved to t (idea 43's fly() starts a tumbler from B.att at B.epoch). */
    function bodyAt(B, t) {
      if (B.att.kind !== 'tumbling' || Math.abs(t - B.epoch) < 1e-6) return B;
      var a = attAt(B, t); if (a.refusal) return a;
      var C = Object.assign({}, B); C.att = a; C.epoch = t; C._att = B._att; return C;
    }
    /** First hit of the ray o + s d (s > 0, body frame, centre-of-mass origin) with the shape: plate, distance, point. */
    function rayHit(P, o, d) {
      d = unit(d); var best = null, V = P.V, F = P.F;
      for (var f = 0; f < P.nf; f++) {
        var i = 3 * F[3 * f], j = 3 * F[3 * f + 1], k = 3 * F[3 * f + 2];
        var a = [V[i], V[i + 1], V[i + 2]], e1 = sub([V[j], V[j + 1], V[j + 2]], a), e2 = sub([V[k], V[k + 1], V[k + 2]], a);
        var pv = cross(d, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
        var tv = sub(o, a), u = dot(tv, pv) / det; if (u < -1e-12 || u > 1 + 1e-12) continue;
        var qv = cross(tv, e1), v = dot(d, qv) / det; if (v < -1e-12 || u + v > 1 + 1e-12) continue;
        var s = dot(e2, qv) / det; if (s > 1e-9 && (!best || s < best.s)) best = { face: f, s: s };
      }
      if (best) best.point = add(o, scale(d, best.s));
      return best;
    }
    /** The landing site: plate, aim point (body frame, centre-of-mass origin), outward normal, and idea 43's environment there. */
    function siteOf(R43, point) {
      var P = R43.P, st = R43.site, f = st.face;
      return { face: f, point: point || [P.FC[3 * f], P.FC[3 * f + 1], P.FC[3 * f + 2]], normal: [P.FN[3 * f], P.FN[3 * f + 1], P.FN[3 * f + 2]], s43: st };
    }

    // ------------------------------------------------------------------------------------------------ the cases
    /** Idea 43's handoff, re-run by idea 43's own parseHandoff (everything recomputed and compared to 1e-6). */
    function importLumpy(h) {
      var o = h;
      if (typeof h === 'string') { try { o = JSON.parse(h); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 43 or from this page.') }; } }
      if (!o || o.handoff !== 'long-way-round' || o.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 43 (Lumpy) or from this page.') };
      if (o.from !== '43-lumpy') return { refusal: refusal('invalid_input', 'That handoff is from ' + o.from + '; this module takes idea 43\'s.', o.from === '42-closing-in' ? 'Open it in idea 43 (Lumpy) first and bring its export.' : 'A handoff from idea 43 (Lumpy) or from this page.') };
      var p;
      try { p = L.parseHandoff(o); } catch (e) { return { refusal: refusal('invalid_input', 'Idea 43\'s parser failed on it (' + e.message + ').', 'The unedited handoff idea 43 exported.') }; }
      if (p.refusal) return { refusal: refusal('invalid_input', 'Idea 43 refuses this handoff: ' + p.refusal.reason, p.refusal.what_would_help) };
      var R = p.R, h42 = p.src.h42;
      if (!h42) return { refusal: refusal('invalid_input', 'This is idea 43\'s stand-alone Bennu case (Orbital B, 2019), not the chain: it carries no spacecraft or stand-off to descend from.', 'Idea 43\'s chain handoff (from idea 42), or this page\'s own Bennu TAG case.') };
      var O = h42.outputs, mass = O.mass.value, env = O.environment.value, ss = O.standoff_state.value;
      var carried = (o.refusals || []).map(function (r) { var c = clone(r); if (!c.from) c.from = '43-lumpy'; return c; });
      return { kind: 'chain', from: '43-lumpy', h43: o, R43: R, B: R.B, site: siteOf(R), t0: ss.tdb_s_past_j2000, x0: ss.r_m.slice(), v0: ss.v_m_s.slice(), carried: carried,
        craft: { name: h42.inputs.settings.craft, mass_kg: mass.standoff_kg, dry_kg: mass.dry_kg, isp_s: mass.isp_s, srp_m_s2: env.srp_accel_m_s2, smallThrust_N: h42.inputs.settings.smallThrust_N, source: 'idea 42 mass block (' + O.mass.source + ')' },
        sunDir: unit(ss.asteroid_heliocentric.r_m) };
    }
    function recRow(t) { for (var i = 0; i < REC.t.length; i++) if (Math.abs(REC.t[i] - t) < 0.01) return REC.s[i]; return null; }
    function burnMid(k) { return 0.5 * (REC.burns[k].pre + REC.burns[k].post); }
    /** OSIRIS-REx at Bennu, 20 Oct 2020: the reconstructed state just before Orbit Departure, Nightingale as published. */
    var bennuCache = {};
    function bennuCase(gm) {
      gm = gm || 'measured'; if (bennuCache[gm]) return bennuCache[gm];
      var pre = REC.burns.ODM.pre, s = recRow(pre), d = norm(REC.bennuHelio.s.slice(0, 3)), GEO = deps.lumpyDeps.geophysics;
      var src = { from: 'bennuTAG', h42: null, designation: '101955', name: '101955 Bennu', epoch: pre, standoff: { r: s.slice(0, 3), v: s.slice(3) }, sunDistance_m: d,
        body: { designation: '101955', name: '101955 Bennu', GM_m3_s2: GEO.scheeres2020.zonals['GM (m3/s2)'].particle, GM_range_m3_s2: null, GM_confidence: 'measured', GM_source: 'Scheeres et al. 2020' }, env: null, carried: [] };
      var B = L.bodyModel(src, Object.assign(L.defaults(), { gm: gm || 'measured' })); if (B.refusal) return { refusal: B.refusal };
      var P = B.P, la = SRC.sample.site_lat_deg.v * DEG, lo = SRC.sample.site_lon_deg.v * DEG, dir = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      var hit = rayHit(P, scale(P.shift, -1), dir);   // from the DSK origin (the published latitude and longitude are planetocentric about it)
      var surf = L.surface(B), st = L.site(B, surf, hit.face);
      var R43 = { B: B, P: P, surface: surf, site: st };
      return (bennuCache[gm] = { kind: 'bennu', from: 'bennuTAG', h43: null, R43: R43, B: B, site: siteOf(R43, hit.point), t0: pre, x0: s.slice(0, 3), v0: s.slice(3), carried: [],
        craft: { name: 'OSIRIS-REx', mass_kg: null, dry_kg: SRC.spacecraft.dry_kg.v, wet_kg: SRC.spacecraft.wet_kg.v, isp_s: null, srp_m_s2: null, source: 'JPL Horizons -64 header (dry and wet masses only; the mass at TAG is not published in these sources)' } });
    }

    // ------------------------------------------------------------------------------------------------ forces and flight
    function sunTable(t) {
      var T = REC.t, i = 0; if (t <= T[0]) return REC.sun[0].slice(); if (t >= T[T.length - 1]) return REC.sun[T.length - 1].slice();
      var lo = 0, hi = T.length - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; } i = lo;
      var f = (t - T[i]) / (T[i + 1] - T[i]); return [0, 1, 2].map(function (j) { return REC.sun[i][j] + f * (REC.sun[i + 1][j] - REC.sun[i][j]); });
    }
    /** Sunlight for the chain: idea 42's handed-on magnitude, along the Sun-to-asteroid line, off in the asteroid's
     *  cylindrical shadow (idea 42's accel() rule, radius = idea 43's volume-equivalent radius). The tide is left out. */
    function srpChain(src) {
      var a = src.craft.srp_m_s2, u = src.sunDir, Rb = src.B.Req;
      return function (t, x) { var along = dot(x, u); if (along > 0 && norm(sub(x, scale(u, along))) < Rb) return [0, 0, 0]; return scale(u, a); };   // u points away from the Sun: the shadow is on the far side
    }
    function extraOf(src, sun) { if (!sun) return null; return src.kind === 'bennu' ? function (t) { return sunTable(t); } : srpChain(src); }
    /** Fly (t0, x0, v0) for dt under the shape (idea 43's fly) plus sunlight; returns the end state and optional track. */
    function flyLeg(ctx, t0, x0, v0, dt, opts) {
      opts = opts || {};
      var B = bodyAt(ctx.B, t0); if (B.refusal) return { failed: B.refusal.reason };
      var f = L.fly(B, opts.model || 'poly', t0, x0, v0, dt, { extra: ctx.extra, samples: opts.samples || 1, stop: opts.stop, rtol: opts.rtol || 1e-10 });   // rtol 1e-10: idea 43's own orbit tolerance
      if (f.failed) return { failed: f.failed };
      var o = f.out[f.out.length - 1];
      return { x: o.x, v: o.v, t: o.t, out: f.out, stopped: !!f.stopped };
    }
    /** Inertial position of the point h metres above the site (along its normal) at t. */
    function aimAt(ctx, t, h) { var a = attAt(ctx.B, t); return mtv(a.C, add(ctx.site.point, scale(ctx.site.normal, h))); }
    /** Velocity relative to the turning ground, in body axes, and its normal and horizontal parts. */
    function relVel(ctx, t, x, v) {
      var a = attAt(ctx.B, t), xb = mv(a.C, x), vb = sub(mv(a.C, v), cross(a.w, xb)), n = ctx.site.normal, vn = dot(vb, n);
      return { vb: vb, vn: vn, vh: norm(sub(vb, scale(n, vn))), xb: xb, att: a };
    }

    // ------------------------------------------------------------------------------------------------ targeting
    /** The velocity at (t0, x0) that reaches `target` at t0 + T: Newton with a finite-difference Jacobian, refreshed by Broyden's
     *  rank-one update while it keeps working (each long flight is the cost), with backtracking; to 1 mm. */
    function aimFixed(ctx, t0, x0, vGuess, T, target) {
      var v = vGuess.slice(), J = null, f = flyLeg(ctx, t0, x0, v, T, { rtol: 1e-8 }); if (f.failed) return { failed: f.failed };
      var r = sub(f.x, target), m = norm(r);
      function fdJ() {
        var M = [[], [], []], dv = 1e-4;
        for (var k = 0; k < 3; k++) { var vp = v.slice(); vp[k] += dv; var g = flyLeg(ctx, t0, x0, vp, T, { rtol: 1e-8 }); if (g.failed) return null; var c = scale(sub(g.x, f.x), 1 / dv); M[0][k] = c[0]; M[1][k] = c[1]; M[2][k] = c[2]; }
        return M;
      }
      for (var it = 0; it < 30; it++) {
        if (m < 1e-3) { var fin = flyLeg(ctx, t0, x0, v, T); return { v: v, miss_m: norm(sub(fin.x, target)), iters: it, end: fin }; }
        if (!J) { J = fdJ(); if (!J) return { failed: 'a perturbed flight failed' }; }
        var d = solve(J, scale(r, -1)); if (!d) return { failed: 'singular targeting Jacobian' };
        var lam = 1, ok = false;
        for (var b = 0; b < 8; b++) {
          var vt = add(v, scale(d, lam)), ft = flyLeg(ctx, t0, x0, vt, T, { rtol: 1e-8 });
          if (!ft.failed && norm(sub(ft.x, target)) < m) {
            var rt = sub(ft.x, target), s = sub(vt, v), y = sub(rt, r), Js = [dot(J[0], s), dot(J[1], s), dot(J[2], s)], ss = dot(s, s);
            for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) J[i][j] += (y[i] - Js[i]) * s[j] / ss;   // Broyden
            v = vt; f = ft; r = rt; m = norm(rt); ok = true; break;
          }
          lam /= 2;
        }
        if (!ok) { if (J.fresh) return { failed: 'targeting diverged (miss ' + m.toFixed(1) + ' m)' }; J = fdJ(); if (!J) return { failed: 'a perturbed flight failed' }; J.fresh = true; continue; }
        J.fresh = false;
      }
      return { failed: 'targeting did not converge in 30 iterations' };
    }
    /**
     * Checkpoint and Matchpoint together, as OSIRIS-REx's guidance did ("two burns to target the TAG site position and TAG
     * velocity"): the velocity leaving Checkpoint and the Matchpoint burn such that, at the contact time, the spacecraft's
     * reference point is `arm` metres above the aim point and moving at -vtd along the site normal with no horizontal
     * speed relative to the turning ground. Six unknowns, six conditions; Newton with a finite-difference Jacobian and
     * backtracking. The Matchpoint's height is an outcome, not an input.
     */
    function aimTag(ctx, tcp, xcp, vGuess, dvGuess, tmp, tc, arm, vtd) {
      var n = ctx.site.normal, z = vGuess.concat(dvGuess);
      function F(zz) {
        var a = flyLeg(ctx, tcp, xcp, zz.slice(0, 3), tmp - tcp); if (a.failed) return a;
        var b = flyLeg(ctx, tmp, a.x, add(a.v, zz.slice(3)), tc - tmp); if (b.failed) return b;
        var rv = relVel(ctx, tc, b.x, b.v), e = sub(b.x, aimAt(ctx, tc, arm)), ev = add(rv.vb, scale(n, vtd));
        return { r: [e[0], e[1], e[2], ev[0] * 1000, ev[1] * 1000, ev[2] * 1000], mp: a, end: b, rel: rv };   // velocity rows in mm/s, position rows in m
      }
      var base = F(z); if (base.failed) return { failed: base.failed };
      for (var it = 0; it < 30; it++) {
        var m = Math.sqrt(base.r.reduce(function (s, x) { return s + x * x; }, 0));
        if (Math.hypot(base.r[0], base.r[1], base.r[2]) < 1e-3 && Math.hypot(base.r[3], base.r[4], base.r[5]) < 1e-3) return { v: z.slice(0, 3), dv: z.slice(3), iters: it, mp: base.mp, end: base.end, rel: base.rel };
        var J = [[], [], [], [], [], []], st = 1e-4;
        for (var k = 0; k < 6; k++) { var zp = z.slice(); zp[k] += st; var g = F(zp); if (g.failed) return { failed: g.failed }; for (var i = 0; i < 6; i++) J[i][k] = (g.r[i] - base.r[i]) / st; }
        var d = solve(J, base.r.map(function (x) { return -x; })); if (!d) return { failed: 'singular Checkpoint/Matchpoint Jacobian' };
        var lam = 1, ok = false;
        for (var bt = 0; bt < 8; bt++) {
          var zt = z.map(function (x, i) { return x + lam * d[i]; }), ft = F(zt);
          if (!ft.failed && Math.sqrt(ft.r.reduce(function (s, x) { return s + x * x; }, 0)) < m) { z = zt; base = ft; ok = true; break; }
          lam /= 2;
        }
        if (!ok) return { failed: 'Checkpoint/Matchpoint targeting diverged' };
      }
      return { failed: 'Checkpoint/Matchpoint targeting did not converge' };
    }

    // ------------------------------------------------------------------------------------------------ the descent
    /** Does a leg pass through the body (the passive-safety check)? Samples every ~20 s. */
    // The passive-safety check, cheaply: the leg is flown with a sample every ~120 s; at each sample the height above the shape
    // along the ray from the centre is found (rayHit); where a sample is lower than twice the distance flown between samples,
    // that stretch is flown again every 20 s with idea 43's solid-angle inside test. Returns the first time inside, if any.
    function hitsBody(ctx, t0, x0, v0, T) {
      var B = ctx.B, P = B.P, n = Math.max(4, Math.min(B.att.kind === 'tumbling' ? 60 : 120, Math.ceil(T / 120))), dt = T / n;
      var c = flyLeg(ctx, t0, x0, v0, T, { samples: n }); if (c.failed) return { hit: null, track: [] };
      var hit = null;
      for (var i = 1; i < c.out.length && hit === null; i++) {
        var o = c.out[i - 1], q = c.out[i], low = false;
        [o, q].forEach(function (s) {
          if (norm(s.x) > P.rMax + 2 * norm(s.v) * dt) return;
          var C = s.C || attAt(B, s.t).C, xb = mv(C, s.x), h = rayHit(P, [0, 0, 0], xb);
          if (!h || norm(xb) - h.s < 2 * norm(s.v) * dt) low = true;
        });
        if (!low) continue;
        var f = flyLeg(ctx, o.t, o.x, o.v, q.t - o.t, { samples: Math.max(2, Math.ceil((q.t - o.t) / 20)), stop: function (t, x, v, Cf) {
          if (norm(x) > P.rMax) return false;
          var C = Cf || attAt(B, t).C; if (L.inside(P, mv(C, x))) { hit = t; return true; } return false;
        } });
      }
      return { hit: hit, track: c.out };
    }
    function plan(ctx, S) {
      var B = ctx.B, src = ctx.src, t0 = src.t0, x0 = src.x0, v0 = src.v0;
      if (src.kind === 'bennu') { var tm = burnMid('ODM'), g = flyLeg(ctx, t0, x0, v0, tm - t0); if (g.failed) return { failed: g.failed }; t0 = tm; x0 = g.x; v0 = g.v; }
      var tcp = t0 + S.depToCp_h * HOUR, tmp = tcp + S.cpToMp_min * 60, tc = tmp + S.mpToTag_min * 60;
      // departure: Newton from the coasting velocity (an orbit's own sense of travel) when starting close in, else from the
      // straight line to Checkpoint; the other guess if the first fails
      var cpAim = aimAt(ctx, tcp, S.h_cp), line = scale(sub(cpAim, x0), 1 / (tcp - t0)), guesses = norm(x0) < 5 * B.P.rMax ? [v0, line] : [line, v0], A;
      var dkey = [t0, S.depToCp_h, S.h_cp, S.sun, ctx.B.GM].join('|'); src._dep = src._dep || {};
      if (src._dep[dkey]) A = src._dep[dkey];   // the departure leg does not depend on anything after Checkpoint: cached per source
      else for (var gi = 0; gi < 2; gi++) { A = aimFixed(ctx, t0, x0, guesses[gi], tcp - t0, cpAim); if (!A.failed) { A.safety = hitsBody(ctx, t0, x0, A.v, tcp - t0); src._dep[dkey] = A; break; } }
      if (A.failed) return { failed: 'Departure: ' + A.failed };
      // first guess: a straight path from Checkpoint to a point 40% of the way down, then a straight fall; then both burns at once
      var hG = S.arm_m + 0.4 * (S.h_cp - S.arm_m), G = aimFixed(ctx, tcp, A.end.x, scale(sub(aimAt(ctx, tmp, hG), A.end.x), 1 / (tmp - tcp)), tmp - tcp, aimAt(ctx, tmp, hG));
      if (G.failed) return { failed: 'Checkpoint: ' + G.failed };
      var C = aimTag(ctx, tcp, A.end.x, G.v, sub(scale(sub(aimAt(ctx, tc, S.arm_m), G.end.x), 1 / (tc - tmp)), G.end.v), tmp, tc, S.arm_m, S.v_td);
      if (C.failed) return { failed: C.failed };
      var xc = C.end.x, vc = C.end.v;
      var burns = [{ name: 'Departure', t: t0, dv: sub(A.v, v0) }, { name: 'Checkpoint', t: tcp, dv: sub(C.v, A.end.v) }, { name: 'Matchpoint', t: tmp, dv: C.dv }];
      var Bb = { v: C.v, end: { x: C.mp.x, v: C.mp.v } };
      burns.forEach(function (b) { b.dv_m_s = norm(b.dv); });
      // back-away: after the contact time, push off along the site normal at bab relative to the ground
      var att = attAt(B, tc), nI = mtv(att.C, ctx.site.normal), wI = mtv(att.C, att.w), surfV = cross(wI, xc), vBab = add(surfV, scale(nI, S.bab_m_s));
      var U = L.field(B.P, B.Grho, mv(att.C, xc)).U, escapes = 0.5 * dot(vBab, vBab) > U;
      // safety and tracks: each leg flown sampled, and a check that the first two legs do not pass through the body
      var hA = A.safety, hB = hitsBody(ctx, tcp, A.end.x, Bb.v, tmp - tcp), hC = hitsBody(ctx, tmp, Bb.end.x, add(Bb.end.v, C.dv), tc - tmp - 0.5);
      var after = flyLeg(ctx, tc, xc, vBab, 1800, { samples: 12 });
      var total = burns.reduce(function (s, b) { return s + b.dv_m_s; }, 0) + S.bab_m_s;
      return { t0: t0, x0: x0, v0: v0, tcp: tcp, tmp: tmp, tc: tc, xc: xc, vc: vc, rel: C.rel, burns: burns, bab: { dv_m_s: S.bab_m_s, v: vBab, inertial_m_s: norm(vBab), escape_m_s: Math.sqrt(2 * U), escapes: escapes, after: after.failed ? [] : after.out },
        states: { cpIn: A.end, cpOut: { x: A.end.x, v: Bb.v }, mpIn: Bb.end, mpOut: { x: Bb.end.x, v: add(Bb.end.v, C.dv) } }, mpHeight_m: dot(sub(mv(attAt(B, tmp).C, Bb.end.x), ctx.site.point), ctx.site.normal), legs: [hA.track, hB.track, hC.track], hits: [hA.hit, hB.hit, hC.hit], total_dv_m_s: total, iters: [A.iters, G.iters, C.iters] };
    }
    /** Height above the site plane, ground distance and straight-line distance from the aim point, body frame, for a flown track. */
    function profileOf(ctx, out) {
      var s = ctx.site; return out.map(function (o) {
        var C = o.C || attAt(ctx.B, o.t).C, xb = sub(mv(C, o.x), s.point), h = dot(xb, s.normal);
        return { t: o.t, h: h, d: norm(sub(xb, scale(s.normal, h))), r: norm(xb) };
      });
    }

    // ------------------------------------------------------------------------------------------------ dispersions
    /**
     * Linear covariance of the contact from Checkpoint on, as OSIRIS-REx flew it: the onboard (NFT) estimate at Checkpoint is
     * off by its knowledge error, both remaining burns are computed from that estimate, and each burn's components (the
     * spacecraft's Z axis along the site normal, X along the burn's horizontal part, Y completing) carry Berry et al.'s
     * execution errors. State transition matrices by finite differences of the exact flights; the 3-sigma figures in the
     * paper's tables are taken as 3 sigma. Returns the contact ellipse on the site plane and the contact speeds' spread.
     */
    function dispersion(ctx, pl, S) {
      var E = SRC.execution[S.errors], N = SRC.nft[S.errors], k = S.errScale;
      var tcp = pl.tcp, tmp = pl.tmp, tc = pl.tc, cp = pl.states.cpOut, mpv = pl.burns[2].dv;
      function endFromCp(dx) {   // fly a perturbed Checkpoint state, add the planned Matchpoint burn, fly to the planned contact time
        var a = flyLeg(ctx, tcp, add(cp.x, dx.slice(0, 3)), add(cp.v, dx.slice(3)), tmp - tcp); if (a.failed) return null;
        var b = flyLeg(ctx, tmp, a.x, add(a.v, mpv), tc - tmp); return b.failed ? null : b;
      }
      function endFromMp(dv) { var b = flyLeg(ctx, tmp, pl.states.mpOut.x, add(pl.states.mpOut.v, dv), tc - tmp); return b.failed ? null : b; }
      var nom = endFromCp([0, 0, 0, 0, 0, 0]); if (!nom) return { failed: 'nominal flight failed' };
      var steps = [1, 1, 1, 1e-3, 1e-3, 1e-3], Pcp = [], Pmp = [];
      for (var j = 0; j < 6; j++) { var dx = [0, 0, 0, 0, 0, 0]; dx[j] = steps[j]; var e = endFromCp(dx); if (!e) return { failed: 'perturbed flight failed' }; Pcp.push(sub(e.x, nom.x).concat(sub(e.v, nom.v)).map(function (q) { return q / steps[j]; })); }
      for (j = 0; j < 3; j++) { var d = [0, 0, 0]; d[j] = 1e-3; e = endFromMp(d); if (!e) return { failed: 'perturbed flight failed' }; Pmp.push(sub(e.x, nom.x).concat(sub(e.v, nom.v)).map(function (q) { return q / 1e-3; })); }
      // execution-error covariance of a burn split into body-axis components
      var nI = mtv(attAt(ctx.B, tcp).C, ctx.site.normal);
      function burnCov(dv, tag, nAxis) {
        var Z = nAxis, hz = sub(dv, scale(Z, dot(dv, Z))), X = norm(hz) > 1e-9 ? unit(hz) : unit(cross(Z, Math.abs(Z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), Y = cross(Z, X), Q = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        [[X, 'X'], [Y, 'Y'], [Z, 'Z']].forEach(function (ax) {
          var u = ax[0], c = E[tag + ax[1]], m = Math.abs(dot(dv, u)) * 1000;   // mm/s
          var sm = Math.sqrt(c[0] * c[0] + Math.pow(c[1] / 100 * m, 2)) / 3 / 1000 * k, stv = (c[2] + c[3] / 100 * m) / 3 / 1000 * k;
          for (var i = 0; i < 3; i++) for (var q = 0; q < 3; q++) Q[i][q] += (sm * sm - stv * stv) * u[i] * u[q] + (i === q ? stv * stv : 0);
        });
        return Q;
      }
      var Qcp = burnCov(pl.burns[1].dv, 'CP', nI), Qmp = burnCov(pl.burns[2].dv, 'MP', mtv(attAt(ctx.B, tmp).C, ctx.site.normal));
      var sp = N.pos_m / 3 * k, sv = N.vel_mm_s / 3 / 1000 * k;
      // contributions to the 6x6 contact covariance from each source: sum over columns  C = Phi Q Phi^T
      function covFrom(Phi, Q, idx) { var C = []; for (var a = 0; a < 6; a++) { C.push([]); for (var b = 0; b < 6; b++) { var s = 0; for (var i = 0; i < idx.length; i++) for (var q = 0; q < idx.length; q++) s += Phi[idx[i]][a] * Q[i][q] * Phi[idx[q]][b]; C[a].push(s); } } return C; }
      var I3 = function (s) { return [[s * s, 0, 0], [0, s * s, 0], [0, 0, s * s]]; };
      var parts = { 'onboard position': covFrom(Pcp, I3(sp), [0, 1, 2]), 'onboard velocity': covFrom(Pcp, I3(sv), [3, 4, 5]), 'Checkpoint burn': covFrom(Pcp, Qcp, [3, 4, 5]), 'Matchpoint burn': covFrom(Pmp, Qmp, [0, 1, 2]) };
      // map to the site plane: the contact happens where the path crosses the aim plane, at the ground-relative velocity
      var att = attAt(ctx.B, tc), n = ctx.site.normal, Cb = att.C, vr = pl.rel.vb, a0 = Cb, xcB = mv(Cb, pl.xc);
      var e1 = unit(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), e2 = cross(n, e1);
      function toPlane(C6) {
        // body-frame position and ground-relative velocity errors at the planned contact time, then shifted along the path to the plane
        // linear map: inertial error (6) -> [site-plane position e1, e2; ground-relative velocity e1, e2, normal]
        var Lm = [];
        for (var c = 0; c < 6; c++) {
          var dxi = [0, 0, 0, 0, 0, 0]; dxi[c] = 1;
          var drb = mv(a0, dxi.slice(0, 3)), dvb = sub(mv(a0, dxi.slice(3)), cross(att.w, drb));
          var dt = -dot(drb, n) / dot(vr, n), drs = add(drb, scale(vr, dt));
          Lm.push([dot(drs, e1), dot(drs, e2), dot(dvb, e1), dot(dvb, e2), dot(dvb, n)]);
        }
        var out = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
        for (var a = 0; a < 5; a++) for (var b = 0; b < 5; b++) { var s = 0; for (var i = 0; i < 6; i++) for (var q = 0; q < 6; q++) s += Lm[i][a] * C6[i][q] * Lm[q][b]; out[a][b] = s; }
        return out;
      }
      var tot = null, budget = {};
      Object.keys(parts).forEach(function (key) {
        var P5 = toPlane(parts[key]); budget[key] = Math.sqrt(eig2(P5[0][0], P5[0][1], P5[1][1]).l1) * 3;
        tot = tot ? tot.map(function (r, i) { return r.map(function (x, j) { return x + P5[i][j]; }); }) : P5;
      });
      var ep = eig2(tot[0][0], tot[0][1], tot[1][1]), eh = eig2(tot[2][2], tot[2][3], tot[3][3]);
      var s1 = Math.sqrt(ep.l1), s2 = Math.sqrt(ep.l2);
      return { pos3_m: [3 * s1, 3 * s2], angle_deg: ep.ang / DEG, horiz3_m_s: 3 * Math.sqrt(eh.l1), vert3_m_s: 3 * Math.sqrt(tot[4][4]), pSafe: pInsideCircle(s1, s2, S.safeRadius_m),
        budget_pos3_m: budget, cov5: tot, axes: { e1: e1, e2: e2 }, phiCp: Pcp, phiMp: Pmp, Qcp: Qcp, Qmp: Qmp, sigmaNft: [sp, sv], nominalEnd: nom };
    }

    // ------------------------------------------------------------------------------------------------ contact
    /**
     * The regolith's resistance, inferred from NASA's numbers for TAG: contact at v0 = 10 cm/s, the head sunk d = 48.8 cm,
     * the back-away ~6 s after contact, and still plunging then. A constant net deceleration a fits v0 tau - a tau^2/2 = d,
     * so a = 2 (v0 tau - d) / tau^2; the resistance is m (a + g_n) on the head's 32 cm base plate. The mass at TAG is not
     * in these sources, so it is bracketed by the dry and wet masses: a pressure range.
     */
    function regolithFromTag(gN) {
      var C = SRC.contact, v0 = C.v_contact_m_s.v, tau = C.contact_s.v, d = C.penetration_m.v, A = PI * Math.pow(SRC.tagsam.base_d_m.v / 2, 2);
      var a = 2 * (v0 * tau - d) / (tau * tau), m = [SRC.spacecraft.dry_kg.v, SRC.spacecraft.wet_kg.v];
      return { a_m_s2: a, v_at_tau_m_s: v0 - a * tau, area_m2: A, mass_kg: m, p_Pa: m.map(function (x) { return x * (a + gN) / A; }), gN: gN, v0: v0, tau: tau, d: d };
    }
    /** Constant-resistance penetration of a head of area A on a craft of mass m arriving at v0 (normal), gravity gN pulling in. */
    function penetration(v0, m, A, p, gN, tau) {
      var a = p * A / m - gN, out = { a_m_s2: a };
      if (a <= 0) { out.stops = false; out.d_tau = v0 * tau - a * tau * tau / 2; out.v_tau = v0 - a * tau; return out; }
      var ts = v0 / a; out.stops = true; out.stop_s = ts; out.stop_m = v0 * v0 / (2 * a);
      var tt = Math.min(tau, ts); out.d_tau = v0 * tt - a * tt * tt / 2; out.v_tau = Math.max(0, v0 - a * tau); out.stoppedBeforeBab = ts < tau;
      return out;
    }

    // ------------------------------------------------------------------------------------------------ bouncing
    /**
     * A lander that stays: on rigid ground it rebounds with normal speed e v_n (tangential speed kept), flies ballistically under
     * the shape as the body turns, lands again and repeats until the normal speed is under 1 mm/s, it escapes, or 12 hops.
     * Impacts are found on idea 43's 25 m plates by the solid-angle inside test, refined by bisection to 1 ms.
     */
    function bounce(ctx, tc, xb0, vRelB0, e, maxHops) {
      var B = ctx.B, P = B.P, hops = [], t = tc, xb = xb0.slice(), vb = vRelB0.slice(), n = ctx.site.normal.slice(), face = ctx.site.face, total = 0, escaped = false;
      maxHops = maxHops || 12;
      for (var h = 0; h < maxHops; h++) {
        var vn = dot(vb, n); if (vn >= 0) break;
        var vt = sub(vb, scale(n, vn)), vOut = add(vt, scale(n, -e * vn));
        if (Math.abs(e * vn) < 1e-3) break;
        var att = attAt(B, t), xI = mtv(att.C, add(xb, scale(n, 1e-3))), vI = mtv(att.C, add(vOut, cross(att.w, xb)));
        var U = L.field(P, B.Grho, mv(att.C, xI)).U;
        if (0.5 * dot(vI, vI) > U) { escaped = true; hops.push({ t0: t, escape: true, speed_m_s: norm(vOut) }); break; }
        var g = Math.max(1e-9, ctx.site.s43.accel_mag_m_s2), Tg = Math.max(60, 4 * Math.abs(e * vn) / g), dtS = Math.max(1, Tg / 50);   // Tg: twice the flat-ground hop time
        var Bt = bodyAt(B, t), prev = null, hitT = null, maxH = 0, path = [[t - tc, 0]];   // each hop's track starts on the ground
        var f = L.fly(Bt, 'poly', t, xI, vI, 6 * Tg, { samples: Math.ceil(6 * Tg / dtS), extra: ctx.extra, rtol: 1e-10, stop: function (tt, x, v, Cf) {
          var C = Cf || attAt(B, tt).C, xx = mv(C, x), hh = norm(xx) - norm(xb); maxH = Math.max(maxH, hh); if (path.length < 300) path.push([tt - tc, hh]);
          if (norm(x) < P.rMax && L.inside(P, xx)) { hitT = tt; return true; }
          prev = { t: tt, x: x, v: v }; return false;
        } });
        if (f.failed || hitT === null) { hops.push({ t0: t, lost: true }); break; }
        // bisection between the last outside sample and the first inside one
        var lo = prev ? prev.t : t, s0 = prev ? prev : { x: xI, v: vI }, hi = hitT, ylo = s0;
        for (var it = 0; it < 30 && hi - lo > 1e-3; it++) {
          var mid = 0.5 * (lo + hi), g2 = flyLeg(ctx, lo, ylo.x, ylo.v, mid - lo); if (g2.failed) break;
          var Cm = attAt(B, mid).C; if (L.inside(P, mv(Cm, g2.x))) hi = mid; else { lo = mid; ylo = { x: g2.x, v: g2.v }; }
        }
        var attN = attAt(B, lo), xbN = mv(attN.C, ylo.x), vbN = sub(mv(attN.C, ylo.v), cross(attN.w, xbN));
        var hit = rayHit(P, [0, 0, 0], xbN); face = hit ? hit.face : face; n = [P.FN[3 * face], P.FN[3 * face + 1], P.FN[3 * face + 2]];
        hops.push({ t0: t - tc, dt_s: lo - t, from_m: xb, to_m: xbN, chord_m: norm(sub(xbN, xb)), maxHeight_m: maxH, inSpeed_m_s: norm(vbN), face: face, path: path });
        total += lo - t; t = lo; xb = xbN; vb = vbN;
      }
      var last = hops.length ? hops[hops.length - 1] : null;
      return { hops: hops, settled_s: total, escaped: escaped, rest_m: xb, rest_from_site_m: norm(sub(xb, ctx.site.point)), face: face };
    }

    // ------------------------------------------------------------------------------------------------ holding down, sampling
    function holdDown(ctx, m, isp, reactionN) {
      var st = ctx.site.s43, a = st.accel_mag_m_s2, sl = st.slope_deg * DEG, Wn = m * a * Math.cos(sl), Wt = m * a * Math.sin(sl);
      var need = Math.max(0, reactionN - Wn), rate = isp ? need / (isp * G0) * HOUR : null;
      return { weight_N: m * a, normal_N: Wn, along_slope_N: Wt, friction_needed: Math.tan(sl), reaction_N: reactionN, holdThrust_N: need, propellant_kg_h: rate, liftsOff: reactionN > Wn };
    }
    /** TAGSAM-class collection: Walsh et al. (2022)'s published Nightingale predictions and tilt efficiency (exponential, 50% at 3.7 deg). */
    function tiltEff(deg) { return Math.pow(2, -Math.max(0, deg) / SRC.tagsam.tilt_half_deg.v); }
    function sampleOf(ctx, S, rho) {
      var Sm = SRC.sample, P = Sm.predicted_g, eff0 = Sm.rock_tilt_eff.v, key = S.mobility + '_' + S.particles;
      var zeroTilt_g = P[key] / eff0, eff = tiltEff(S.rockTilt_deg), g = zeroTilt_g * eff, scaleRho = rho / Sm.bulk_density_kg_m3.v;
      return { key: key, published_g: P[key], zeroTilt_g: zeroTilt_g, efficiency: eff, impliedTilt_deg: SRC.tagsam.tilt_half_deg.v * Math.log(1 / eff0) / Math.log(2),
        mass_kg: ctx.src.kind === 'bennu' ? g / 1000 : null, analog_kg: g * scaleRho / 1000, densityRatio: scaleRho, returned_kg: Sm.returned_g.v / 1000 };
    }

    // ------------------------------------------------------------------------------------------------ reality (Bennu)
    /** OSIRIS-REx's own descent, leg by leg: each leg flown from the reconstructed state after one burn to the row before the next. */
    function reality(ctx) {
      var legs = [['Departure to Checkpoint', REC.burns.ODM.post, REC.burns.CP.pre], ['Checkpoint to Matchpoint', REC.burns.CP.post, REC.burns.MP.pre], ['Matchpoint to contact', REC.burns.MP.post, REC.contact.t]];
      var out = legs.map(function (q) {
        var a = recRow(q[1]), b = recRow(q[2]), row = { leg: q[0], t0: q[1], t1: q[2], hours: (q[2] - q[1]) / HOUR };
        ['poly', 'pm'].forEach(function (model) {
          var f = flyLeg(ctx, q[1], a.slice(0, 3), a.slice(3), q[2] - q[1], { model: model }); if (f.failed) { row[model] = null; return; }
          var e = sub(f.x, b.slice(0, 3)), ev = sub(f.v, b.slice(3)), u = unit(b.slice(0, 3));
          row[model] = { dr_m: norm(e), dr_radial_m: dot(e, u), dv_m_s: norm(ev), dv_radial_m_s: dot(ev, u) };
        });
        return row;
      });
      // the flown burns: the state before flown forward and the state after flown back to the burn's middle
      var flown = ['ODM', 'CP', 'MP'].map(function (k) {
        var m = burnMid(k), a = recRow(REC.burns[k].pre), b = recRow(REC.burns[k].post);
        var f1 = flyLeg(ctx, REC.burns[k].pre, a.slice(0, 3), a.slice(3), m - REC.burns[k].pre), f2 = flyLeg(ctx, REC.burns[k].post, b.slice(0, 3), b.slice(3), m - REC.burns[k].post);
        return { burn: k, t: m, dv: sub(f2.v, f1.v), dv_m_s: norm(sub(f2.v, f1.v)), gap_m: norm(sub(f2.x, f1.x)) };
      });
      // the reconstructed contact: the last row of the descent segment
      var c = recRow(REC.contact.t), rv = relVel(ctx, REC.contact.t, c.slice(0, 3), c.slice(3)), P = ctx.B.P, xd = add(rv.xb, P.shift), rn = norm(xd);
      var hit = rayHit(P, rv.xb, scale(ctx.site.normal, -1)), alt = hit ? hit.s : null;
      var cpRow = recRow(REC.burns.CP.pre), mpRow = recRow(REC.burns.MP.pre);
      function heightAt(t, s) { var a = attAt(ctx.B, t); return dot(sub(mv(a.C, s.slice(0, 3)), ctx.site.point), ctx.site.normal); }
      var recvUtc = new Date(Date.parse(utcOf(REC.contact.t)) + REC.lightTime_min_at_2150utc * 60000).toISOString();
      return { legs: out, flownBurns: flown, contact: { t: REC.contact.t, utc: utcOf(REC.contact.t), lat_deg: Math.asin(xd[2] / rn) / DEG, lon_deg: Math.atan2(xd[1], xd[0]) / DEG, vn_m_s: rv.vn, vh_m_s: rv.vh,
        heightAboveSite_m: dot(sub(rv.xb, ctx.site.point), ctx.site.normal), aboveShapeAlongNormal_m: alt, earthReceiveUtc: recvUtc, segmentJump_m: REC.contact.jump_m },
        heights: { cp_m: heightAt(REC.burns.CP.pre, cpRow), mp_m: heightAt(REC.burns.MP.pre, mpRow) } };
    }

    /** The reconstruction's own heights above the site and ground distances, ODM to contact (for the page's chart). */
    function reconProfile(ctx) {
      var out = [];
      for (var i = 0; i < REC.t.length; i++) { if (REC.t[i] < REC.burns.ODM.post) continue; out.push({ t: REC.t[i], x: REC.s[i].slice(0, 3) }); }
      return profileOf(ctx, out);
    }

    // ------------------------------------------------------------------------------------------------ settings and run
    function defaults(kind) {
      var P = SRC.profile, bennu = kind === 'bennu';
      return { gm: 'measured', mode: 'tag', depToCp_h: bennu ? +((burnMid('CP') - burnMid('ODM')) / HOUR).toFixed(6) : 24, h_cp: P.h_cp_m.v, cpToMp_min: bennu ? +((burnMid('MP') - burnMid('CP')) / 60).toFixed(6) : P.cp_to_mp_min.v,
        mpToTag_min: bennu ? +((REC.contact.t - burnMid('MP')) / 60).toFixed(6) : P.mp_to_tag_min_2014.v, v_td: P.v_td_m_s.v, arm_m: SRC.tagsam.arm_m.v, bab_m_s: P.bab_m_s.v, contact_s: bennu ? SRC.contact.contact_s.v : P.bab_after_contact_s.v, errors: 'late', errScale: 1, safeRadius_m: P.safe_radius_m.v,
        mass_kg: null, surface: 'regolith', e: 0.5, reaction_N: 1, mobility: 'low', particles: 'unresolved', rockTilt_deg: 0, sun: true };
    }
    function validSettings(S, kind) {
      var e = [], r = function (k, lo, hi, txt) { if (!(num(S[k]) && S[k] >= lo && S[k] <= hi)) e.push(k + ' must be ' + lo + ' to ' + hi + (txt || '')); };
      if (['measured', 'measured_sc'].indexOf(S.gm) < 0) e.push('gm must be measured or measured_sc');
      if (['tag', 'stay'].indexOf(S.mode) < 0) e.push('mode must be tag or stay');
      r('depToCp_h', 0.5, 72); r('h_cp', 20, 2000, ' m'); r('cpToMp_min', 2, 120); r('mpToTag_min', 2, 120); r('v_td', 0.02, 0.5, ' m/s'); r('arm_m', 0, 10, ' m'); r('bab_m_s', 0, 2, ' m/s');
      r('contact_s', 0.5, 30, ' s'); r('errScale', 0, 10); r('safeRadius_m', 0.5, 100, ' m'); r('e', 0, 0.95); r('reaction_N', 0, 1000, ' N'); r('rockTilt_deg', 0, 45, ' deg');
      if (num(S.h_cp) && num(S.arm_m) && !(S.h_cp > S.arm_m + 10)) e.push('the Checkpoint must be more than 10 m above the arm');
      if (S.mass_kg !== null && !(num(S.mass_kg) && S.mass_kg >= 1 && S.mass_kg <= 100000)) e.push('mass_kg must be left empty (the mass handed on) or 1 to 100000 kg');
      if (['late', 'prelaunch'].indexOf(S.errors) < 0) e.push('errors must be late or prelaunch');
      if (['regolith', 'rigid'].indexOf(S.surface) < 0) e.push('surface must be regolith or rigid');
      if (['low', 'high'].indexOf(S.mobility) < 0) e.push('mobility must be low or high');
      if (['resolved', 'unresolved'].indexOf(S.particles) < 0) e.push('particles must be resolved or unresolved');
      if (typeof S.sun !== 'boolean') e.push('sun must be true or false');
      return e;
    }
    /** Everything for one case and settings. src: importLumpy(h43) or bennuCase(). */
    function run(src, settings) {
      var S = Object.assign(defaults(src.kind), settings || {}), errs = validSettings(S, src.kind);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      if (src.kind === 'bennu' && S.gm !== 'measured') { var s2 = bennuCase(S.gm); if (s2.refusal) return { refusal: s2.refusal, S: S }; src = s2; }
      var ctx = { src: src, B: src.B, site: src.site }; ctx.extra = extraOf(src, S.sun);
      var pl = plan(ctx, S);
      if (pl.failed) return { refusal: refusal('out_of_envelope', 'No descent found: ' + pl.failed + '.', 'A longer departure leg, a higher Checkpoint or Matchpoint, or another site.', { applies_to: 'descent' }), S: S };
      var own = [], st = ctx.site.s43;
      pl.hits.forEach(function (h, i) { if (h !== null && i === 2) own.push(refusal('out_of_envelope', 'In the last fall the spacecraft\'s reference point meets the shape ' + ((pl.tc - h)).toFixed(0) + ' s before the planned contact: neighbouring plates stand above the aim point.', 'A site on flatter ground, or a longer arm.', { applies_to: 'terrain' })); if (h !== null && i < 2) own.push(refusal('out_of_envelope', (i ? 'The Checkpoint-to-Matchpoint' : 'The departure') + ' leg passes through the body ' + ((h - pl.t0) / 60).toFixed(1) + ' min after departure: it is not passively safe, and as planned it crashes.', 'A higher Checkpoint, a shorter leg, or departure from another side.', { applies_to: 'descent' })); });
      var disp = dispersion(ctx, pl, S);
      if (disp.failed) return { refusal: refusal('out_of_envelope', 'The dispersion analysis failed: ' + disp.failed + '.', 'Other settings.', { applies_to: 'dispersion' }), S: S };
      // contact, in the regolith model
      var aSite = st.accel_mag_m_s2, gN = aSite * Math.cos(st.slope_deg * DEG), reg = regolithFromTag(src.kind === 'bennu' ? gN : (function () { var b = bennuCase('measured'); return b.site.s43.accel_mag_m_s2 * Math.cos(b.site.s43.slope_deg * DEG); })());
      var vIn = -pl.rel.vn, m = S.mass_kg !== null ? S.mass_kg : src.craft.mass_kg;
      var masses = m !== null ? [m] : reg.mass_kg, A = reg.area_m2;
      var pens = [];
      // Bennu with no mass given: each pressure with the mass it was inferred for (dry, wet); otherwise the craft's mass with both ends of the pressure range
      reg.p_Pa.forEach(function (p, i) { (m !== null ? [m] : [masses[i]]).forEach(function (mm) { pens.push(Object.assign({ p_Pa: p, m_kg: mm }, penetration(vIn, mm, A, p, gN, S.contact_s))); }); });
      var contact = { v_in_m_s: vIn, vh_m_s: pl.rel.vh, regolith: reg, cases: pens, gN: gN };
      // propellant
      var prop = null;
      if (src.craft.isp_s && num(m)) {
        var dvAll = S.mode === 'tag' ? pl.total_dv_m_s : pl.total_dv_m_s - S.bab_m_s, used = m * (1 - Math.exp(-dvAll / (src.craft.isp_s * G0))), avail = src.craft.mass_kg - src.craft.dry_kg;
        prop = { dv_m_s: dvAll, needed_kg: used, available_kg: avail, isp_s: src.craft.isp_s };
        if (used > avail) own.push(refusal('out_of_envelope', 'The descent' + (S.mode === 'tag' ? ' and back-away need ' : ' needs ') + dvAll.toFixed(3) + ' m/s, ' + used.toFixed(3) + ' kg of propellant at Isp ' + src.craft.isp_s.toFixed(1) + ' s; the chain\'s spacecraft reaches the stand-off with ' + avail.toFixed(3) + ' kg (idea 42\'s mass block).', 'More propellant at launch (idea 42\'s tankage), a lighter spacecraft, or a slower departure leg.', { applies_to: 'propellant' }));
      }
      // staying: sink (regolith) or bounce (rigid)
      var stay = null;
      if (S.mode === 'stay') {
        if (S.surface === 'rigid') stay = { surface: 'rigid', e: S.e, bounce: bounce(ctx, pl.tc, ctx.site.point.slice(), pl.rel.vb, S.e) };   // the lander's feet at the aim point on the plate
        else stay = { surface: 'regolith', sinks: pens.map(function (q) { return { p_Pa: q.p_Pa, m_kg: q.m_kg, stop_m: q.stop_m, stop_s: q.stop_s }; }) };
      }
      var eStar = st.escape_up_m_s / Math.max(1e-9, vIn);   // a first rebound faster than idea 43's straight-up escape speed leaves
      var mHold = num(m) ? m : null;
      var hold = mHold ? holdDown(ctx, mHold, src.craft.isp_s, S.reaction_N) : null;
      var smp = sampleOf(ctx, S, src.B.rho);
      var real = src.kind === 'bennu' ? reality(ctx) : null;
      // own refusals
      own.push(refusal('insufficient_data', 'The site is a ' + st.area_m2.toFixed(0) + ' m^2 plate of idea 43\'s 25 m shape: boulders, craters and slopes at the scale of the ' + S.safeRadius_m + ' m safe radius and the 0.32 m sampler head are not in it, so the chance of an unsafe contact is not computed (only the chance of landing inside the safe radius).', src.kind === 'bennu' ? 'NAIF\'s 5 cm Nightingale DSK (bennu_l_00050mm_alt_dtm_5595n04217_v021.bds, 67 MB) and a hazard map like the mission\'s.' : 'A local terrain model from OSIRIS-APEX imaging, then a hazard map.', { applies_to: 'hazards' }));
      own.push(refusal('insufficient_data', src.kind === 'bennu' ? 'The regolith\'s resistance is inferred from NASA\'s published figures for this very contact (10 cm/s, 48.8 cm, ~6 s) under a constant-deceleration model, with the spacecraft\'s mass at TAG bracketed by its dry and wet masses: a range, not a measurement.' : 'The regolith\'s resistance is Bennu\'s at Nightingale (inferred from NASA\'s 48.8 cm in ~6 s at 10 cm/s), carried to ' + src.B.name + ' as an analog: nothing has touched its surface.', 'The spacecraft\'s accelerometer record of the contact (Walsh et al. 2022, Sci. Adv.) or, for another body, a touch.', { applies_to: 'regolith' }));
      if (src.kind === 'chain') own.push(refusal('insufficient_data', 'No particle-size map of ' + src.B.name + ' exists, and TAGSAM-class collection depends on the smallest and largest particles and their size distribution (Walsh et al. 2022); the sample mass is not computed. The Nightingale analog below is labelled as such.', 'Imaging at better than 1 cm/pixel of the site (OSIRIS-APEX), then the sampleability algorithm.', { applies_to: 'sample' }));
      if (src.kind === 'bennu' && S.mass_kg === null) own.push(refusal('insufficient_data', 'OSIRIS-REx\'s mass at TAG is not in these sources (dry ' + SRC.spacecraft.dry_kg.v + ' kg, wet at launch ' + SRC.spacecraft.wet_kg.v + ' kg): resistance, hold-down and propellant are given across that range or not at all.', 'The spacecraft\'s mass at TAG (mission reports), or set it here.', { applies_to: 'spacecraft_mass' }));
      own.push(refusal('insufficient_data', 'Anchors that rely on the ground\'s strength (harpoons, screws) are not modelled: Bennu\'s near surface is "loosely packed and lightly bound" (NASA, 2022), and no strength is known for ' + src.B.name + '. Holding down is by weight and thrust only.', 'A measured cohesion or an anchor pull test in situ.', { applies_to: 'anchors' }));
      if (pl.rel.vh * 1000 > SRC.delivery.vel_req_mm_s.v) own.push(refusal('out_of_envelope', 'The planned contact has ' + (pl.rel.vh * 1000).toFixed(1) + ' mm/s of horizontal speed, over OSIRIS-REx\'s ' + SRC.delivery.vel_req_mm_s.v + ' mm/s limit.', 'A lower Matchpoint or a shorter fall.', { applies_to: 'contact_velocity' }));
      var assumptions = [
        'Frames: flight in ICRF axes about the centre of mass; the site, ground-relative velocities and heights in the body frame of idea 43\'s shape (' + src.B.P.meta.frame.split(':')[0] + '). Time TDB s past J2000; UTC = TDB - ' + TDB_UTC + ' s.',
        'Gravity: idea 43\'s constant-density polyhedron (' + src.B.P.nf + ' plates, density ' + src.B.rho.toFixed(1) + ' kg/m^3), turning with the body; ' + (src.kind === 'bennu' ? 'sunlight and the solar tide: idea 42\'s accel() tabulated along the reconstruction' : 'sunlight: idea 42\'s ' + src.craft.srp_m_s2.toExponential(3) + ' m/s^2 along the Sun line, off in the body\'s shadow cylinder; the solar tide (~1e-11 m/s^2 here) left out') + (S.sun ? '' : ' (switched off by the settings)') + '.',
        'Burns: impulsive. Profile after OSIRIS-REx (Berry et al. 2020): departure, Checkpoint ' + S.h_cp + ' m above the aim point along the site normal ' + S.depToCp_h.toFixed(2) + ' h later, Matchpoint ' + S.cpToMp_min.toFixed(1) + ' min after that, contact ' + S.mpToTag_min.toFixed(1) + ' min after Matchpoint; the Checkpoint and Matchpoint burns target the contact point and a contact velocity of ' + (S.v_td * 100).toFixed(0) + ' cm/s along the normal with no horizontal speed relative to the ground (the Matchpoint height is an outcome); the spacecraft\'s reference point ' + S.arm_m + ' m (the TAGSAM arm) above the site at contact.',
        'Dispersions: linear covariance from Checkpoint, onboard knowledge ' + SRC.nft[S.errors].pos_m + ' m / ' + SRC.nft[S.errors].vel_mm_s + ' mm/s (3 sigma per axis) and Berry et al. 2021 Table 2 execution errors (' + S.errors + ' columns, read as 3 sigma), scaled by ' + S.errScale + '; gravity, sunlight and attitude errors are not included.',
        'Contact: the head (32 cm base plate) meets a constant resistance; the arm\'s constant-force spring, the gas jet and tipping are not modelled.'
      ];
      return { src: src, S: S, ctx: ctx, mass_kg: m, plan: pl, profile: pl.legs.map(function (o) { return profileOf(ctx, o); }), dispersion: disp, contact: contact, propellant: prop, stay: stay, eStar: eStar, hold: hold, sample: smp, reality: real,
        own: own, carried: src.carried, assumptions: assumptions };
    }

    // ------------------------------------------------------------------------------------------------ handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function buildHandoff(R, produced) {
      var pl = R.plan, d = R.dispersion, src = R.src, st = src.site, s43 = st.s43, S = R.S, att = attAt(src.B, pl.tc);
      var inputs = { lumpy_handoff: src.h43, case: src.kind === 'bennu' ? 'bennuTAG' : null, settings: clone(S) };
      var stayVal = R.stay ? (R.stay.surface === 'rigid' ? { surface: 'rigid', e: S.e, hops: R.stay.bounce.hops.length, escaped: R.stay.bounce.escaped, settled_s: r9(R.stay.bounce.settled_s), rest_body_m: vr9(R.stay.bounce.rest_m), rest_from_site_m: r9(R.stay.bounce.rest_from_site_m), rest_face: R.stay.bounce.face }
        : { surface: 'regolith', sinks: R.stay.sinks.map(function (q) { return { p_Pa: r9(q.p_Pa), m_kg: q.m_kg, stop_m: r9(q.stop_m), stop_s: r9(q.stop_s) }; }) }) : null;
      var out = {
        descent: qv({ site: { face: st.face, aim_body_m: vr9(st.point), normal_body: vr9(st.normal), frame: src.B.P.meta.frame.split(':')[0] + ', origin the uniform-density centre of mass' },
          departure_tdb_s: pl.t0, departure_utc: utcOf(pl.t0), checkpoint_utc: utcOf(pl.tcp), matchpoint_utc: utcOf(pl.tmp), contact_tdb_s: r9(pl.tc), contact_utc: utcOf(pl.tc),
          burns: pl.burns.map(function (b) { return { name: b.name, tdb_s: r9(b.t), dv_icrf_m_s: vr9(b.dv), dv_m_s: r9(b.dv_m_s) }; }), backaway_m_s: S.mode === 'tag' ? S.bab_m_s : 0, total_dv_m_s: r9(S.mode === 'tag' ? pl.total_dv_m_s : pl.total_dv_m_s - S.bab_m_s),
          contact_state_icrf: { r_m: vr9(pl.xc), v_m_s: vr9(pl.vc) }, contact_rel_body_m_s: vr9(pl.rel.vb), contact_normal_m_s: r9(pl.rel.vn), contact_horizontal_m_s: r9(pl.rel.vh),
          fall_s: r9(pl.tc - pl.tmp) }, 'm, m/s, s', 'derived', KERNEL + ' plan(): Newton shooting through idea 43\'s polyhedron, turning body, sunlight'),
        dispersion: qv({ contact_ellipse_3sigma_m: vr9(d.pos3_m), major_axis_deg: r9(d.angle_deg), horizontal_speed_3sigma_m_s: r9(d.horiz3_m_s), vertical_speed_3sigma_m_s: r9(d.vert3_m_s),
          safe_radius_m: S.safeRadius_m, p_inside_safe_radius: r9(d.pSafe), budget_major_3sigma_m: Object.keys(d.budget_pos3_m).reduce(function (o, k) { o[k] = r9(d.budget_pos3_m[k]); return o; }, {}), errors: S.errors, scale: S.errScale },
          'm, m/s, deg', 'derived', KERNEL + ' dispersion(): linear covariance, finite-difference state transition through the exact field; inputs Berry et al. 2021 Tables 2-3'),
        contact: qv({ v_in_m_s: r9(R.contact.v_in_m_s), head_area_m2: r9(R.contact.regolith.area_m2), inferred_deceleration_m_s2: r9(R.contact.regolith.a_m_s2), resistance_Pa: vr9(R.contact.regolith.p_Pa),
          contact_s: S.contact_s, cases: R.contact.cases.map(function (q) { return { p_Pa: r9(q.p_Pa), m_kg: r9(q.m_kg), deceleration_m_s2: r9(q.a_m_s2), depth_at_backaway_m: r9(q.d_tau), speed_at_backaway_m_s: r9(q.v_tau), stop_m: r9(q.stop_m), stop_s: r9(q.stop_s) }; }) },
          'm, m/s, Pa, kg, s', 'assumed', KERNEL + ' regolithFromTag(), penetration(): constant resistance from NASA\'s 48.8 cm in ~6 s at 10 cm/s'),
        backaway: qv(S.mode === 'tag' ? { dv_m_s: S.bab_m_s, inertial_speed_m_s: r9(pl.bab.inertial_m_s), escape_speed_m_s: r9(pl.bab.escape_m_s), escapes: pl.bab.escapes } : null, 'm/s', 'derived', S.mode === 'tag' ? KERNEL + ' plan(): energy in a non-rotating field (idea 43\'s convention)' : 'stay mode: no back-away'),
        surface_state: qv({ mode: S.mode, body: src.B.name, epoch_tdb_s: r9(pl.tc), epoch_utc: utcOf(pl.tc), site_face: st.face, aim_body_m: vr9(st.point), normal_body: vr9(st.normal), C_icrf_to_body: vr9(att.C), omega_body_rad_s: vr9(att.w),
          gravity_m_s2: r9(s43.gravity_mag_m_s2), accel_m_s2: r9(s43.accel_mag_m_s2), slope_deg: r9(s43.slope_deg), escape_up_m_s: r9(s43.escape_up_m_s),
          spacecraft_mass_kg: num(R.mass_kg) ? r9(R.mass_kg) : null, weight_N: R.hold ? r9(R.hold.weight_N) : null, hold_normal_N: R.hold ? r9(R.hold.normal_N) : null, along_slope_N: R.hold ? r9(R.hold.along_slope_N) : null,
          friction_needed_to_stay: r9(Math.tan(s43.slope_deg * DEG)), isp_s: src.craft.isp_s ? r9(src.craft.isp_s) : null,
          hold_propellant_kg_per_N_hour: src.craft.isp_s ? r9(HOUR / (src.craft.isp_s * G0)) : null,
          // none is left when the descent needs more than the craft carries (the propellant refusal says so): the shortfall travels, never a negative mass
          propellant_left_kg: R.propellant && R.propellant.needed_kg <= R.propellant.available_kg ? r9(R.propellant.available_kg - R.propellant.needed_kg) : null,
          propellant_short_kg: R.propellant && R.propellant.needed_kg > R.propellant.available_kg ? r9(R.propellant.needed_kg - R.propellant.available_kg) : null, stay: stayVal },
          'm, m/s^2, deg, N, kg', 'derived', KERNEL + ' holdDown(): idea 43\'s site acceleration and slope; Isp from idea 42'),
        propellant: qv(R.propellant ? { dv_m_s: r9(R.propellant.dv_m_s), needed_kg: r9(R.propellant.needed_kg), available_kg: r9(R.propellant.available_kg), isp_s: r9(R.propellant.isp_s) } : null, 'kg, m/s, s', 'derived', R.propellant ? 'rocket equation, idea 42\'s Isp and mass at the stand-off' : 'no Isp or mass for this spacecraft'),
        sample: qv({ sampler: 'TAGSAM-class (32 cm head, 21 cm opening)', scenario: R.sample.key, rock_tilt_deg: S.rockTilt_deg, tilt_efficiency: r9(R.sample.efficiency), mass_kg: R.sample.mass_kg === null ? null : r9(R.sample.mass_kg),
          nightingale_analog_kg: r9(R.sample.analog_kg), density_ratio: r9(R.sample.densityRatio), bennu_returned_kg: R.sample.returned_kg },
          'kg', 'assumed', 'Walsh et al. 2022 (Space Sci. Rev. 218:20) Nightingale predictions and tilt function; NASA 2024 (121.6 g returned)'),
        reality: qv(R.reality ? { legs: R.reality.legs.map(function (q) { return { leg: q.leg, hours: r9(q.hours), polyhedron: { dr_m: r9(q.poly.dr_m), dv_m_s: r9(q.poly.dv_m_s) }, point_mass: { dr_m: r9(q.pm.dr_m), dv_m_s: r9(q.pm.dv_m_s) } }; }),
          flown_burns_m_s: R.reality.flownBurns.map(function (b) { return r9(b.dv_m_s); }), contact_utc: R.reality.contact.utc, contact_lat_lon_deg: [r9(R.reality.contact.lat_deg), r9(R.reality.contact.lon_deg)], contact_normal_m_s: r9(R.reality.contact.vn_m_s), contact_horizontal_m_s: r9(R.reality.contact.vh_m_s), earth_receive_utc: R.reality.contact.earthReceiveUtc } : null,
          'm, m/s', 'measured', R.reality ? 'JPL Horizons OSIRIS-REx reconstruction (snapshots/tag-recon.js)' : 'Bennu case only')
      };
      return { handoff: 'long-way-round', version: 1, from: '44-touch-and-go', produced: produced || new Date().toISOString(), inputs: inputs, outputs: out, refusals: R.carried.concat(R.own).map(clone), assumptions: R.assumptions.slice() };
    }
    function codes(rs) { return (rs || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join('|'); }
    /** Read this page's own handoff back: idea 43's inside is re-run by idea 43, everything here recomputed and compared to 1e-6. */
    function parseHandoff(h) {
      var o = h;
      if (typeof h === 'string') { try { o = JSON.parse(h); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 43 or from this page.') }; } }
      if (!o || o.handoff !== 'long-way-round' || o.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 43 or from this page.') };
      if (o.from === '43-lumpy') return importLumpy(o);
      if (o.from !== '44-touch-and-go') return { refusal: refusal('invalid_input', 'That handoff is from ' + o.from + '; this module takes idea 43\'s or its own.', o.from === '42-closing-in' ? 'Open it in idea 43 (Lumpy) first and bring its export.' : 'A handoff from idea 43 (Lumpy) or from this page.') };
      var I = o.inputs || {}, src;
      if (I.lumpy_handoff) { src = importLumpy(I.lumpy_handoff); if (src.refusal) return src; }
      else if (I.case === 'bennuTAG') src = bennuCase('measured');
      else return { refusal: refusal('invalid_input', 'This 44 handoff carries neither idea 43\'s handoff nor a known case.', 'The unedited handoff this page exported.') };
      if (!I.settings) return { refusal: refusal('invalid_input', 'This 44 handoff has no settings.', 'The unedited handoff this page exported.') };
      var R = run(src, I.settings); if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, o.produced);
      for (var k in again.outputs) {
        var dd = L.numDiff(o.outputs && o.outputs[k] && o.outputs[k].value, again.outputs[k].value, k, 1e-6);
        if (dd) return { refusal: refusal('invalid_input', 'The handoff says ' + dd + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      if (codes(o.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '44-touch-and-go', h44: o, src: src, settings: I.settings, R: R };
    }

    return {
      G0: G0, utcOf: utcOf, attAt: attAt, bodyAt: bodyAt, rayHit: rayHit, importLumpy: importLumpy, bennuCase: bennuCase, recRow: recRow, burnMid: burnMid, sunTable: sunTable, srpChain: srpChain,
      flyLeg: flyLeg, hitsBody: hitsBody, aimAt: aimAt, relVel: relVel, aimFixed: aimFixed, aimTag: aimTag, plan: plan, profileOf: profileOf, dispersion: dispersion, regolithFromTag: regolithFromTag, penetration: penetration,
      bounce: bounce, holdDown: holdDown, tiltEff: tiltEff, sampleOf: sampleOf, reality: reality, reconProfile: reconProfile, defaults: defaults, validSettings: validSettings, run: run, buildHandoff: buildHandoff, parseHandoff: parseHandoff, codes: codes,
      pInsideCircle: pInsideCircle, eig2: eig2, solve: solve, sources: SRC, recon: REC
    };
  }
  return { create: create, G0: G0, pInsideCircle: pInsideCircle, eig2: eig2, solve: solve };
});
