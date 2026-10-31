/* Burn Out: the Earth-departure burn as a finite burn. Idea 38 of the Aster Idea Bank, module 8 of "The Long Way Round".
 *
 * Idea 37 put the parking orbit on the calendar and handed on the point where an IMPULSIVE burn would leave along the
 * departure asymptote, and the delta-v it would take. No engine does that: the S-IVB took 351 s to leave for the Moon,
 * swinging through about a quarter of an orbit while it burned. This module flies the burn: thrust on, mass going down,
 * gravity pulling the vehicle round the Earth during the burn, a steering law, cutoff when the energy reaches the target
 * C3, and the ignition time solved so that the hyperbola actually leaves along the asymptote. Then it says what that
 * costs against the impulsive figure (the finite-burn or "gravity" loss), how the cost grows as thrust-to-weight falls,
 * what splitting the departure into perigee burns buys back, how much payload the stage can send, and it hands on the
 * hyperbolic state at cutoff, in J2000 with its epoch, for module 39.
 *
 * A pure kernel: no DOM, no network. What it reuses, unmodified: idea 37's kernel (snapshots/window.js): its gravity
 * (point mass with Aster's GM, plus J2 about the mean pole of date), its RK4 coast, its Earth orientation and time scales,
 * its impulsive departure (departureOf), its orbital elements and AS-512's parking orbit (as512Coast). What is new here:
 *
 *   powered flight  r'' = g(r) + (F/m) u, m' = -mdot, RK4 at a fixed step (1 s by default) with the cutoff found inside
 *                   the step by bisection on the specific energy; thrust in segments (constant F and mdot each), so a
 *                   flown engine's start transient and mixture-ratio shift can be replayed.
 *   steering        tangential (u along the inertial velocity: the greedy energy law), fixed (u held in one inertial
 *                   direction, as a spin-stabilised kick stage flies; the best direction is searched), optimised (u turned
 *                   from the velocity by an angle linear in time, a + b t, the two numbers searched for least propellant).
 *   targeting       the ignition time solved (secant) so the osculating hyperbola's outgoing asymptote at cutoff lies along
 *                   idea 37's asymptote in the orbit plane; the out-of-plane miss (J2 turning the plane) is reported.
 *   perigee burns   N burns, tangential, each centred in time on a perigee passage, the first N - 1 raising the apogee
 *                   to equal shares of the impulsive delta-v, the last reaching the C3; coasts with J2 between them.
 *   loss            delta-v expended (ve ln m0/mf, summed over burns) less idea 37's impulsive delta-v; the propellant
 *                   that costs; the payload the stage can still send (secant on the payload).
 *   Apollo 17       the S-IVB's translunar burn replayed from the flight report: Table 4-4's parking orbit coasted with J2
 *                   to the flown ignition, the measured start impulse, the 4.5 and 5.0 mixture-ratio phases fitted to the
 *                   measured total impulse and the mass tables, cutoff at Table 4-2's C3; against Tables 4-2, 4-5, 16-7.
 *
 * Frames: the burn is flown in idea 37's frame for the launch (mean equator and equinox of date at liftoff, z the spin
 * axis, where J2 acts); every state handed on is turned back to J2000 (ICRF axes, Aster's). Time: TDB seconds past J2000
 * beside UTC, as idea 37. SI units inside (m, s, kg, N, rad); degrees, km and minutes only at the edges.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BurnOut = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEG = Math.PI / 180, TWO_PI = 2 * Math.PI;
  // [Certain] Exact unit definitions: 1 lb = 0.45359237 kg (international pound, 1959), standard gravity 9.80665 m/s^2
  // (CGPM 1901); the flight report's lbf, lbm and lbf-s/lbm are these.
  var LB = 0.45359237, G0 = 9.80665, LBF = LB * G0;
  var STEERING = ['tangential', 'fixed', 'optimal'];

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
  function wrapPi(a) { a %= TWO_PI; if (a > Math.PI) a -= TWO_PI; if (a < -Math.PI) a += TWO_PI; return a; }
  function iso(ms) { return new Date(Math.round(ms)).toISOString(); }

  function create(deps) {
    var W = deps.W, AP = deps.apollo17, F512 = deps.as512, TLI = deps.tli, AST = deps.aster, EARTH = deps.earth;
    var MU = W.constants.MU, RE = W.constants.RE, J2 = W.constants.J2, RJ2 = W.constants.RJ2;
    var REQ = AST.radii_km[0] * 1000, RPOLE = AST.radii_km[2] * 1000;
    // J2 has nearly stopped mattering for the asymptote by 20 Earth radii (its pull falls as r^-4; measured in the tests:
    // following it on to 200 radii turns the chain's asymptote a further 6e-5 deg); the coast after cutoff is followed
    // out to here.
    var FAR = 20 * RJ2;
    var KERNEL = '38-burn-out/burnout.js';

    // ================================================================== small orbital helpers
    function energy(r, v) { return dot(v, v) / 2 - MU / norm(r); }
    /** The J2 part of the potential energy per unit mass (idea 37's accel is minus its gradient): mu J2 R^2 P2(z/r) / r^3. */
    function phiJ2(r) { var rn = norm(r), s = r[2] / rn; return MU * J2 * RJ2 * RJ2 * (3 * s * s - 1) / 2 / (rn * rn * rn); }
    /** Energy conserved on a coast under point mass + J2 (J2 is symmetric about the spin axis, so its potential does not
     * change with time in this frame): its value at cutoff is C3/2 at infinity, in this gravity model. */
    function energyJ2(r, v) { return energy(r, v) + phiJ2(r); }
    /** The osculating two-body conic at (r, v): energy, C3, eccentricity, and for a hyperbola the outgoing asymptote. */
    function conic(r, v) {
      var h = cross(r, v), hn = norm(h), rn = norm(r), E = energy(r, v), ev = sub(scale(cross(v, h), 1 / MU), scale(r, 1 / rn)), e = norm(ev);
      var o = { E: E, c3: 2 * E, e: e, h: scale(h, 1 / hn), p: hn * hn / MU, rp: hn * hn / MU / (1 + e) };
      if (E < 0) { o.a = -MU / (2 * E); o.ra = o.a * (1 + e); o.period = TWO_PI * Math.sqrt(o.a * o.a * o.a / MU); }
      if (E > 0 && e > 1) {
        var eh = scale(ev, 1 / e), q = cross(o.h, eh), nu = Math.acos(-1 / e);
        o.nuInf = nu; o.sHat = add(scale(eh, Math.cos(nu)), scale(q, Math.sin(nu))); o.vinf = Math.sqrt(2 * E);
      }
      return o;
    }
    /**
     * The hyperbola once J2 has done with it: the coast from (r, v) followed with idea 37's RK4 and gravity, the step
     * growing as r^1.5, out to FAR (20 Earth radii), and the osculating conic there. With J2 off, the conic at (r, v).
     */
    function farConic(r, v, j2) {
      if (!j2) { var c0 = conic(r, v); c0.far = { r: r, v: v, t: 0 }; return c0; }
      var y = r.concat(v), t = 0, r0 = norm(r);
      for (var i = 0; i < 20000; i++) {
        var rn = Math.sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2]);
        if (rn >= FAR) break;
        var h = Math.min(900, 10 * Math.pow(rn / r0, 1.5));
        y = W.rk4(y, h, true); t += h;
      }
      var c = conic(y.slice(0, 3), y.slice(3));
      c.far = { r: y.slice(0, 3), v: y.slice(3), t: t };
      return c;
    }
    /** Signed angle (rad) from the achieved asymptote to the target S within the orbit plane (positive: the target lies
     * ahead, along the motion), and S's angle out of that plane. */
    function asymptoteMiss(c, S) {
      var beta = Math.asin(Math.max(-1, Math.min(1, dot(S, c.h)))), Sp = unit(sub(S, scale(c.h, dot(S, c.h))));
      return { phi: Math.atan2(dot(c.h, cross(c.sHat, Sp)), dot(c.sHat, Sp)), beta: beta };
    }
    /** Geodetic latitude and altitude on Aster's pck00010 ellipsoid (the one idea 37 placed AS-512's orbit with). */
    function geodetic(r) {
      var a = REQ, e2 = 1 - (RPOLE / REQ) * (RPOLE / REQ), p = Math.hypot(r[0], r[1]), z = r[2];
      var phi = Math.atan2(z, p * (1 - e2)), h = 0, N;
      for (var i = 0; i < 12; i++) {
        N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
        h = Math.abs(Math.cos(phi)) > 1e-9 ? p / Math.cos(phi) - N : z / Math.sin(phi) - N * (1 - e2);
        phi = Math.atan2(z, p * (1 - e2 * N / (N + h)));
      }
      return { latDeg: phi / DEG, altitude: h };
    }
    /** Heading of a velocity, degrees east of north, at position r (z the spin axis), and the flight-path angle. */
    function headingOf(r, v) {
      var east = unit([-r[1], r[0], 0]), north = cross(unit(r), east);
      return { headingDeg: ((Math.atan2(dot(v, east), dot(v, north)) / DEG) + 360) % 360, fpaDeg: Math.asin(dot(unit(r), unit(v))) / DEG };
    }

    // ================================================================== powered flight
    /**
     * A steering law as a function (t, r, v) -> unit thrust direction. law: 'tangential' | 'fixed' | 'optimal'. P: for
     * fixed {U: unit vector}; for optimal {a, b (rad), t0 (ignition), T (reference duration)}: the thrust is turned from
     * the velocity toward the local "up" (r's part normal to v) by delta = a + b ((t - t0)/T - 1/2).
     */
    function steerer(law, P) {
      if (law === 'fixed') { var U = P.U; return function () { return U; }; }
      if (law === 'optimal') {
        return function (t, r, v) {
          var vh = unit(v), up = unit(sub(r, scale(vh, dot(r, vh)))), d = P.a + P.b * ((t - P.t0) / P.T - 0.5);
          return add(scale(vh, Math.cos(d)), scale(up, Math.sin(d)));
        };
      }
      return function (t, r, v) { return unit(v); };
    }
    /** A law turned out of the orbit plane by a constant yaw angle (rad), toward the angular momentum. */
    function yawed(steer, yaw) {
      if (!yaw) return steer;
      var c = Math.cos(yaw), s = Math.sin(yaw);
      return function (t, r, v) { var u = steer(t, r, v), n = unit(cross(r, v)); return add(scale(u, c), scale(n, s)); };
    }
    function deriv(t, y, seg, steer, j2) {
      var r = [y[0], y[1], y[2]], v = [y[3], y[4], y[5]], g = W.accel(r, j2), u = steer(t, r, v), a = seg.F / y[6];
      return [y[3], y[4], y[5], g[0] + a * u[0], g[1] + a * u[1], g[2] + a * u[2], -seg.mdot];
    }
    function rk4p(t, y, h, seg, steer, j2) {
      var k1 = deriv(t, y, seg, steer, j2), y2 = [], y3 = [], y4 = [], i;
      for (i = 0; i < 7; i++) y2[i] = y[i] + h / 2 * k1[i];
      var k2 = deriv(t + h / 2, y2, seg, steer, j2); for (i = 0; i < 7; i++) y3[i] = y[i] + h / 2 * k2[i];
      var k3 = deriv(t + h / 2, y3, seg, steer, j2); for (i = 0; i < 7; i++) y4[i] = y[i] + h * k3[i];
      var k4 = deriv(t + h, y4, seg, steer, j2), out = [];
      for (i = 0; i < 7; i++) out[i] = y[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      return out;
    }
    function En7(y, fn) { return (fn || energy)([y[0], y[1], y[2]], [y[3], y[4], y[5]]); }
    /**
     * Fly one burn. s0 {t, r, v, m}; segs [{dur, F, mdot}] (the last may be open-ended: dur Infinity); steer (from
     * steerer); stop {E (cutoff energy, J/kg), efn (the energy measured: two-body by default, or energyJ2), mFloor (mass
     * at which the propellant is gone), tMax (longest burn, s)};
     * opts {h (step, s), j2, sampleEvery (s)}. Returns {t, r, v, m, ended: 'target' | 'depleted' | 'timeout', dur,
     * samples, uEnd (thrust direction at cutoff)}.
     */
    function fly(s0, segs, steer, stop, opts) {
      opts = opts || {};
      var H = opts.h || 1, j2 = opts.j2 !== false, t = s0.t, y = s0.r.concat(s0.v, [s0.m]), si = 0, segStart = s0.t;
      var tEnd = s0.t + (stop.tMax || 2e4), samples = opts.sampleEvery ? [] : null, nextSample = s0.t, ended = null;
      var rec = function (tt, yy, sg) {
        var r = [yy[0], yy[1], yy[2]], v = [yy[3], yy[4], yy[5]], u = steer(tt, r, v);
        samples.push({ t: tt, r: r, v: v, m: yy[6], E: energy(r, v), F: sg.F, u: u });
      };
      for (var guard = 0; guard < 2e6; guard++) {
        var seg = segs[si], segEnd = segStart + seg.dur;
        if (samples && t >= nextSample - 1e-9) { rec(t, y, seg); nextSample += opts.sampleEvery; }
        var h = Math.min(H, segEnd - t, tEnd - t), depleting = false;
        if (seg.mdot > 0 && y[6] - seg.mdot * h <= stop.mFloor) { h = Math.max(0, (y[6] - stop.mFloor) / seg.mdot); depleting = true; }
        var yn = rk4p(t, y, h, seg, steer, j2);
        if (stop.E != null && En7(yn, stop.efn) >= stop.E) {
          var lo = 0, hi = h;
          for (var k = 0; k < 60 && hi - lo > 1e-12; k++) { var mid = (lo + hi) / 2; if (En7(rk4p(t, y, mid, seg, steer, j2), stop.efn) >= stop.E) hi = mid; else lo = mid; }
          y = rk4p(t, y, hi, seg, steer, j2); t += hi; ended = 'target'; break;
        }
        y = yn; t += h;
        if (depleting) { ended = 'depleted'; break; }
        if (t >= tEnd - 1e-9) { ended = 'timeout'; break; }
        if (t >= segEnd - 1e-9 && si < segs.length - 1) { si++; segStart = segEnd; }
      }
      var r = [y[0], y[1], y[2]], v = [y[3], y[4], y[5]];
      if (samples) rec(t, y, segs[si]);
      return { t: t, r: r, v: v, m: y[6], ended: ended, dur: t - s0.t, samples: samples, uEnd: steer(t, r, v), seg: segs[si] };
    }

    // ================================================================== coasts (idea 37's RK4 and gravity)
    /** A coast from (r0, v0) at t0 sampled at idea 37's step: nodes every dt to tEnd; at(t) is one partial RK4 step from
     * the node before t (exactly how idea 37's coastToDeparture lands on its departure point). */
    function coastTable(r0, v0, t0, tEnd, dt, j2) {
      var nodes = [r0.concat(v0)], y = nodes[0], n = Math.ceil((tEnd - t0) / dt);
      for (var i = 0; i < n; i++) { y = W.rk4(y, dt, j2); nodes.push(y); }
      return {
        t0: t0, tEnd: t0 + n * dt, dt: dt,
        at: function (t) {
          if (!(t >= t0 - 1e-9) || t > t0 + n * dt + 1e-9) return null;
          var k = Math.min(n, Math.max(0, Math.floor((t - t0) / dt + 1e-12))), tk = t0 + k * dt, yy = nodes[k];
          if (t - tk > 1e-12) yy = W.rk4(yy, t - tk, j2);
          return { t: t, r: yy.slice(0, 3), v: yy.slice(3, 6) };
        },
        nodes: nodes,
      };
    }
    /** Coast from a state until the next perigee after an apogee (radial speed from - to +), at idea 37's step; returns
     * {tp, table (with at())} or null if none within tMax. */
    function coastToPerigee(s, dt, j2, tMax) {
      var y = s.r.concat(s.v), t = s.t, nodes = [y], times = [t], apo = dot(s.r, s.v) < 0 ? false : false, vr0 = dot(s.r, s.v), passedApo = false;
      void apo;
      for (var i = 0; i < Math.ceil(tMax / dt); i++) {
        var yn = W.rk4(y, dt, j2), vr = yn[0] * yn[3] + yn[1] * yn[4] + yn[2] * yn[5];
        if (vr0 >= 0 && vr < 0) passedApo = true;
        if (passedApo && vr0 < 0 && vr >= 0) {
          var lo = 0, hi = dt;
          for (var k = 0; k < 60 && hi - lo > 1e-9; k++) { var mid = (lo + hi) / 2, ym = W.rk4(y, mid, j2); if (ym[0] * ym[3] + ym[1] * ym[4] + ym[2] * ym[5] >= 0) hi = mid; else lo = mid; }
          var tp = t + (lo + hi) / 2;
          nodes.push(yn); times.push(t + dt);
          return {
            tp: tp, nodes: nodes, times: times,
            at: function (tt) {
              var kk = Math.min(nodes.length - 1, Math.max(0, Math.floor((tt - times[0]) / dt + 1e-12)));
              var yy = nodes[kk]; if (tt - times[kk] > 1e-12) yy = W.rk4(yy, tt - times[kk], j2);
              return { t: tt, r: yy.slice(0, 3), v: yy.slice(3, 6) };
            },
          };
        }
        y = yn; t += dt; vr0 = vr; nodes.push(y); times.push(t);
      }
      return null;
    }

    // ================================================================== the engine
    /** Constant-thrust segments for an engine {F, mdot} scaled by k (thrust and flow together; ve unchanged). */
    function segsOf(eng, k) { return eng.segs ? eng.segs : [{ dur: Infinity, F: eng.F * (k || 1), mdot: eng.mdot * (k || 1) }]; }
    function veOf(eng) { var s = segsOf(eng); return s[s.length - 1].F / s[s.length - 1].mdot; }
    /** Burn time a delta-v would take from mass m0 on the engine's open segment (ideal rocket equation). */
    function burnTimeFor(dv, m0, eng, k) { var s = segsOf(eng, k), last = s[s.length - 1], ve = last.F / last.mdot; return m0 * (1 - Math.exp(-dv / ve)) / last.mdot; }

    // ================================================================== one burn, its targeting and its optimisation
    /**
     * Fly from the coast at tIg to the cutoff energy. sc: scenario (stateAt, m0, E, S, mode); law, P: steering;
     * opts.unlimited: burn past the propellant (to measure what the burn needs) down to 2 % of the ignition mass.
     */
    function burnAt(sc, tIg, law, P, opts) {
      opts = opts || {};
      var s = sc.stateAt(tIg);
      if (!s) return null;
      var m0 = sc.m0, pr = law === 'optimal' ? { a: P.a, b: P.b, t0: tIg, T: sc.tRef } : law === 'fixed' ? { U: P.U } : null;
      var mFloor = opts.unlimited === false ? m0 - sc.mp : 0.02 * m0;
      var res = fly({ t: tIg, r: s.r, v: s.v, m: m0 }, segsOf(sc.eng, sc.k), yawed(steerer(law, pr), opts.yaw), { E: sc.E, efn: sc.efn, mFloor: mFloor, tMax: sc.tMax }, { h: sc.h, j2: sc.j2, sampleEvery: opts.sampleEvery });
      res.tIg = tIg; res.yaw = opts.yaw || 0; res.m0 = m0; res.mUsed = m0 - res.m; res.start = s;
      if (res.ended === 'target' && sc.mode === 'asymptote') { res.conic = farConic(res.r, res.v, sc.j2); if (res.conic.sHat) { var mi = asymptoteMiss(res.conic, sc.S); res.phi = mi.phi; res.beta = mi.beta; } }
      return res;
    }
    /** The fixed law's direction: angle alpha (rad) from the reference horizontal toward the reference "up", in plane. */
    function fixedDir(sc, alpha) { return add(scale(sc.refH, Math.cos(alpha)), scale(sc.refUp, Math.sin(alpha))); }
    function lawParams(sc, law, x) { return law === 'fixed' ? { U: fixedDir(sc, x[0]) } : law === 'optimal' ? { a: x[0], b: x[1] } : {}; }
    /**
     * Solve one burn: for 'asymptote' scenarios the ignition time that puts the asymptote on S (secant on the in-plane
     * miss, from a guess centred on idea 37's departure point); for 'free' scenarios the given ignition. Returns the burn
     * (burnAt's result) with .iterations, or {refusal}.
     */
    function solveIgnition(sc, law, P, t0guess, yaw0, inPlane) {
      if (sc.mode !== 'asymptote') {
        var b0 = burnAt(sc, sc.tIgFixed, law, P);
        if (!b0) return { refusal: refusal('out_of_envelope', 'No coast state at the ignition time.', 'Another ignition time.') };
        if (b0.ended !== 'target') return { refusal: burnRefusal(sc, b0) };
        b0.iterations = 0; return b0;
      }
      if (inPlane) return target1(sc, function (t) { return burnAt(sc, t, law, P); }, num(t0guess) ? t0guess : sc.tGuess);
      return target2(sc, function (x) { return burnAt(sc, x[0], law, P, { yaw: x[1] }); }, [num(t0guess) ? t0guess : sc.tGuess, num(yaw0) ? yaw0 : 0]);
    }
    /**
     * The targeting: ignition time x[0] (s from idea 37's departure point) and a constant yaw x[1] (rad) that put the
     * asymptote (after J2, at 20 Earth radii) on S: in-plane miss and out-of-plane angle both to 1e-11 rad. Newton with a
     * finite-difference Jacobian, then Broyden updates. fly(x) returns a burn with .phi and .beta, or null.
     */
    function target2(sc, flyX, x) {
      var ev = function (xx) {
        var b = flyX(xx);
        if (!b) return { refusal: ignitionRefusal(sc, xx[0]) };
        if (b.ended !== 'target' || b.phi == null) return { refusal: burnRefusal(sc, b) };
        return b;
      };
      var b = ev(x);
      if (b.refusal) return b;
      var f = [b.phi, b.beta], J = null, it;
      var jac = function () {
        var bt = ev([x[0] + 1, x[1]]), by = ev([x[0], x[1] + 1e-4]);
        if (bt.refusal) return bt; if (by.refusal) return by;
        return [[(bt.phi - f[0]) / 1, (by.phi - f[0]) / 1e-4], [(bt.beta - f[1]) / 1, (by.beta - f[1]) / 1e-4]];
      };
      for (it = 0; it < 30; it++) {
        if (Math.abs(f[0]) < 1e-11 && Math.abs(f[1]) < 1e-11) break;
        if (!J || it % 6 === 5) { J = jac(); if (J.refusal) return J; }
        var det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        if (!num(det) || det === 0) break;
        var dx = [-(J[1][1] * f[0] - J[0][1] * f[1]) / det, -(-J[1][0] * f[0] + J[0][0] * f[1]) / det];
        if (Math.abs(dx[0]) > 2000) { dx[1] *= 2000 / Math.abs(dx[0]); dx[0] = Math.sign(dx[0]) * 2000; }
        if (Math.abs(dx[1]) > 0.2) { dx[0] *= 0.2 / Math.abs(dx[1]); dx[1] = Math.sign(dx[1]) * 0.2; }
        var xn = [x[0] + dx[0], x[1] + dx[1]], bn = ev(xn);
        if (bn.refusal) return bn;
        var fn = [bn.phi, bn.beta], df = [fn[0] - f[0], fn[1] - f[1]], dd = dx[0] * dx[0] + dx[1] * dx[1];
        // Broyden's update: J += (df - J dx) dx^T / |dx|^2
        var r0 = df[0] - (J[0][0] * dx[0] + J[0][1] * dx[1]), r1 = df[1] - (J[1][0] * dx[0] + J[1][1] * dx[1]);
        if (dd > 0) { J[0][0] += r0 * dx[0] / dd; J[0][1] += r0 * dx[1] / dd; J[1][0] += r1 * dx[0] / dd; J[1][1] += r1 * dx[1] / dd; }
        x = xn; b = bn; f = fn;
      }
      if (Math.abs(f[0]) > 1e-8 || Math.abs(f[1]) > 1e-8) return { refusal: refusal('out_of_envelope', 'The ignition time and yaw that put the asymptote on the target did not converge (miss ' + fmt(Math.hypot(f[0], f[1]) / DEG, 3) + ' deg).', 'More thrust, or fewer perigee burns.', { applies_to: 'targeting' }) };
      b.iterations = it + 1;
      return b;
    }
    /** In-plane targeting only: the ignition (or first-burn) time that zeroes the in-plane miss, no yaw (secant).
     * The out-of-plane angle is left as it falls. */
    function target1(sc, flyT, t0) {
      var ev = function (t) { var b = flyT(t); if (!b) return { refusal: ignitionRefusal(sc, t) }; if (b.ended !== 'target' || b.phi == null) return { refusal: burnRefusal(sc, b) }; return b; };
      var x0 = t0, x1 = t0 + 5, b0 = ev(x0);
      if (b0.refusal) return b0;
      var f0 = b0.phi, b1 = b0, it;
      for (it = 0; it < 40; it++) {
        b1 = ev(x1);
        if (b1.refusal) return b1;
        if (Math.abs(b1.phi) < 1e-11) break;
        var x2 = b1.phi !== f0 ? x1 - b1.phi * (x1 - x0) / (b1.phi - f0) : x1 + 1;
        if (Math.abs(x2 - x1) > 2000) x2 = x1 + Math.sign(x2 - x1) * 2000;
        x0 = x1; f0 = b1.phi; x1 = x2;
      }
      if (Math.abs(b1.phi) > 1e-8) return { refusal: refusal('out_of_envelope', 'The ignition time that puts the asymptote on the target did not converge.', 'More thrust, or fewer perigee burns.', { applies_to: 'targeting' }) };
      b1.iterations = it + 1;
      return b1;
    }
    function ignitionRefusal(sc, t) {
      return refusal('out_of_envelope', 'The burn would have to start ' + fmt(-t, 4) + ' s before idea 37\'s departure point, but the vehicle only reaches its parking orbit ' + fmt(sc.coast, 4) + ' s before it: the coast is too short for a finite burn here.', 'A longer minimum coast in idea 37 (the next revolution), or more thrust (a shorter burn).', { applies_to: 'ignition' });
    }
    function burnRefusal(sc, b) {
      if (b.ended === 'timeout') return refusal('out_of_envelope', 'At this thrust a single burn to C3 ' + fmt(sc.E * 2 / 1e6, 4) + ' km^2/s^2 runs past ' + fmt(sc.tMax / 3600, 3) + ' h: it would wind round the Earth while burning, outside what this model is for.', 'More thrust-to-weight, or split the departure into perigee burns.', { applies_to: 'burn_length' });
      return refusal('out_of_envelope', 'The burn reaches C3 ' + fmt(b.conic ? b.conic.c3 / 1e6 : NaN, 4) + ' km^2/s^2 without a departure asymptote.', 'A hyperbolic target (C3 > 0).', { applies_to: 'targeting' });
    }
    /** Minimise the propellant over the steering law's parameters (fixed: golden section on alpha; optimal: Nelder-Mead
     * on a, b), each trial with its own solved ignition. Returns {x, burn} or {refusal}. */
    function optimise(sc, law, opts) {
      opts = opts || {};
      var best = null, lastT = null, lastY = null;
      var f = function (x) {
        var b = solveIgnition(sc, law, lawParams(sc, law, x), lastT, lastY);
        if (b.refusal) return { v: Infinity, b: b };
        lastT = b.tIg; lastY = b.yaw;
        if (!best || b.mUsed < best.b.mUsed) best = { x: x.slice(), b: b };
        return { v: b.mUsed, b: b };
      };
      if (law === 'fixed') {
        // asymptote mode: the reference is the horizontal at idea 37's departure point, about which the burn is centred, so the
        // best direction is near it; free mode: the reference is the horizontal at ignition, and the best fixed direction is
        // near the horizontal half-way round the burn's arc, which reads as pitched down by about half the arc
        var arc = sc.arcEst, lo = sc.mode === 'asymptote' ? -0.6 : -arc - 0.6, hi = 0.6, g = (Math.sqrt(5) - 1) / 2;
        var c = hi - g * (hi - lo), d = lo + g * (hi - lo), fc = f([c]).v, fd = f([d]).v;
        for (var i = 0; i < (opts.iters || 40) && hi - lo > 1e-7; i++) {
          if (fc < fd) { hi = d; d = c; fd = fc; c = hi - g * (hi - lo); fc = f([c]).v; } else { lo = c; c = d; fc = fd; d = lo + g * (hi - lo); fd = f([d]).v; }
        }
      } else if (law === 'optimal') {
        var S = [[0, 0], [3 * DEG, 0], [0, 6 * DEG]].map(function (x) { return { x: x, v: f(x).v }; });
        for (var it = 0; it < (opts.iters || 120); it++) {
          S.sort(function (p, q) { return p.v - q.v; });
          if (Math.abs(S[2].v - S[0].v) < 1e-6 && Math.hypot(S[2].x[0] - S[0].x[0], S[2].x[1] - S[0].x[1]) < 1e-7) break;
          var cen = [(S[0].x[0] + S[1].x[0]) / 2, (S[0].x[1] + S[1].x[1]) / 2];
          var xr = [cen[0] + (cen[0] - S[2].x[0]), cen[1] + (cen[1] - S[2].x[1])], vr = f(xr).v;
          if (vr < S[0].v) { var xe = [cen[0] + 2 * (cen[0] - S[2].x[0]), cen[1] + 2 * (cen[1] - S[2].x[1])], ve = f(xe).v; S[2] = ve < vr ? { x: xe, v: ve } : { x: xr, v: vr }; }
          else if (vr < S[1].v) S[2] = { x: xr, v: vr };
          else {
            var xc = [cen[0] + 0.5 * (S[2].x[0] - cen[0]), cen[1] + 0.5 * (S[2].x[1] - cen[1])], vc = f(xc).v;
            if (vc < S[2].v) S[2] = { x: xc, v: vc };
            else for (var j = 1; j < 3; j++) { S[j].x = [S[0].x[0] + 0.5 * (S[j].x[0] - S[0].x[0]), S[0].x[1] + 0.5 * (S[j].x[1] - S[0].x[1])]; S[j].v = f(S[j].x).v; }
          }
        }
      }
      if (!best) { var r0 = solveIgnition(sc, law, lawParams(sc, law, law === 'fixed' ? [0] : [0, 0])); return { refusal: r0.refusal || refusal('out_of_envelope', 'No steering found that reaches the target.', 'Another steering law.') }; }
      return best;
    }

    // ================================================================== perigee burns
    /**
     * N burns, tangential: burn 1 from the coast at t1 to energy E_1; then coast to each perigee and burn again, centred
     * in time on it (ignition half the burn's rocket-equation duration before), to E_k; the last to the C3. E_k: the
     * impulsive delta-v from the reference state split into N equal shares. Returns {burns, final, coasts, ...}.
     */
    function flyMulti(sc, t1, opts) {
      opts = opts || {};
      var yawLast = opts.yaw || 0;
      var N = sc.N, steer = steerer('tangential'), segs = segsOf(sc.eng, sc.k), last = segs[segs.length - 1], burns = [], coasts = [];
      var vc = norm(sc.ref.v), pr0 = sc.potRef, dvShare = sc.dvImp / N, s = sc.stateAt(t1), m = sc.m0, minPerigee = Infinity;
      if (!s) return { refusal: ignitionRefusal(sc, t1) };
      var t = t1;
      for (var k = 1; k <= N; k++) {
        var Ek = k < N ? Math.pow(vc + k * dvShare, 2) / 2 + pr0 : sc.E;
        var b = fly({ t: t, r: s.r, v: s.v, m: m }, segs, k === N ? yawed(steer, yawLast) : steer, { E: Ek, efn: sc.efn, mFloor: opts.unlimited === false ? sc.m0 - sc.mp : 0.02 * sc.m0, tMax: sc.tMax }, { h: sc.h, j2: sc.j2, sampleEvery: opts.sampleEvery });
        b.tIg = t; b.m0 = m; b.mUsed = m - b.m; b.start = s; b.k = k; b.yaw = k === N ? yawLast : 0;
        burns.push(b);
        if (b.ended !== 'target') return { burns: burns, coasts: coasts, final: b, ended: b.ended, refusal: b.ended === 'timeout' ? burnRefusal(sc, b) : null };
        m = b.m;
        if (k === N) break;
        var cc = conic(b.r, b.v);
        minPerigee = Math.min(minPerigee, cc.rp);
        if (!(cc.E < 0)) return { refusal: refusal('out_of_envelope', 'Perigee burn ' + k + ' left the Earth before the last burn.', 'Fewer burns.', { applies_to: 'perigee_burns' }) };
        var cp = coastToPerigee({ t: b.t, r: b.r, v: b.v }, sc.coastDt, sc.j2, cc.period * 1.5 + 600);
        if (!cp) return { refusal: refusal('out_of_envelope', 'No perigee passage found after burn ' + k + '.', 'Fewer burns.', { applies_to: 'perigee_burns' }) };
        var sp = cp.at(cp.tp), Enext = k + 1 < N ? Math.pow(vc + (k + 1) * dvShare, 2) / 2 + pr0 : sc.E;
        var dvNext = Math.sqrt(2 * (Enext - sc.pot(sp.r))) - norm(sp.v), d = m * (1 - Math.exp(-dvNext * last.mdot / last.F)) / last.mdot;
        var tIgn = cp.tp - d / 2;
        if (tIgn < b.t) tIgn = b.t;
        coasts.push({ t0: b.t, t1: tIgn, tp: cp.tp, period: cc.period, rp: cc.rp, ra: cc.ra, at: cp.at });
        s = cp.at(tIgn); t = tIgn;
      }
      var fin = burns[burns.length - 1], c = sc.efn === energyJ2 ? farConic(fin.r, fin.v, true) : conic(fin.r, fin.v), out = { burns: burns, coasts: coasts, final: fin, ended: 'target', conic: c, minPerigee: minPerigee };
      if (c.sHat && sc.mode === 'asymptote') { var mi = asymptoteMiss(c, sc.S); out.phi = mi.phi; out.beta = mi.beta; }
      out.mUsed = sc.m0 - fin.m;
      return out;
    }
    function solveMulti(sc, guess, inPlane) {
      if (sc.mode !== 'asymptote') { var fm = flyMulti(sc, sc.tIgFixed); return fm; }
      if (inPlane) {
        var w1 = function (t) { var mm = flyMulti(sc, t); if (mm.refusal) return null; var f1 = mm.final; f1.phi = mm.phi; f1.beta = mm.beta; f1.multi = mm; return f1; };
        var b1 = target1(sc, w1, guess ? guess[0] : sc.tGuessMulti);
        if (b1.refusal) return b1;
        var m1 = b1.multi; m1.t1 = m1.burns[0].tIg; m1.iterations = b1.iterations; return m1;
      }
      var wrap = function (x) {
        var m = flyMulti(sc, x[0], { yaw: x[1] });
        if (m.refusal) return null;
        var fin = m.final; fin.phi = m.phi; fin.beta = m.beta; fin.multi = m;
        return fin;
      };
      var first = flyMulti(sc, guess ? guess[0] : sc.tGuessMulti, { yaw: guess ? guess[1] : 0 });
      if (first.refusal) return first;
      var b = target2(sc, wrap, guess || [sc.tGuessMulti, 0]);
      if (b.refusal) return b;
      var m = b.multi; m.t1 = m.burns[0].tIg; m.iterations = b.iterations;
      return m;
    }

    // ================================================================== scenarios
    function tw(F, m) { return F / (m * G0); }
    /** Common fields of a scenario once its coast, masses, engine and target are known. */
    function finishScenario(sc, set) {
      sc.k = set.thrustScale != null ? set.thrustScale : 1;
      sc.N = set.burns || 1;
      sc.h = set.dt || 1;
      sc.ve = veOf(sc.eng);
      sc.E = sc.c3 / 2;
      // the energy the cutoff measures: two-body (osculating C3, the flight report's definition, for the Apollo replay)
      // or point mass + J2 (conserved after cutoff, so the C3 reached is the C3 at infinity in this gravity model)
      var useJ2 = sc.j2 && sc.cutoff !== 'two-body';
      sc.efn = useJ2 ? energyJ2 : energy;
      sc.pot = useJ2 ? function (r) { return -MU / norm(r) + phiJ2(r); } : function (r) { return -MU / norm(r); };
      var ref = sc.ref, vc = norm(ref.v), rr = norm(ref.r);
      sc.potRef = sc.pot(ref.r);
      // the impulsive reference: at idea 37's departure point (its departureOf, fed the C3 that gives the same energy
      // with J2's potential counted there), or from the ignition state for the free scenarios
      if (sc.kind === 'window') {
        var c3eff = sc.c3 - 2 * (sc.potRef + MU / rr), hb = unit(cross(ref.r, ref.v));
        sc.dvImp = W.departureOf({ ev: { r: ref.r, v: ref.v }, hb: hb }, { asym: { c3: c3eff } }).dv;
      } else sc.dvImp = Math.sqrt(2 * (sc.E - sc.potRef)) - vc;
      sc.tRef = burnTimeFor(sc.dvImp, sc.m0, sc.eng, sc.k);
      sc.arcEst = sc.tRef * vc / rr;
      sc.tMax = set.tMax || 3 * 3600;
      sc.tGuess = sc.mode === 'asymptote' ? -sc.tRef / 2 : null;
      var d1 = burnTimeFor(sc.dvImp / sc.N, sc.m0, sc.eng, sc.k);
      sc.tGuessMulti = -d1 / 2;
      sc.refH = unit(cross(cross(ref.r, ref.v), ref.r)); sc.refUp = unit(ref.r);
      sc.tw0 = tw(segsOf(sc.eng, sc.k)[segsOf(sc.eng, sc.k).length - 1].F, sc.m0);
      return sc;
    }

    // ------------------------------------------------------------------ idea 37's handoff
    function rel(a, b) { return Math.abs(a - b) / Math.max(1e-30, Math.abs(b)); }
    /**
     * Read idea 37's handoff. Idea 37's own parseHandoff re-flies idea 36's ascent to check it, which needs ideas 33 to
     * 36's kernels (307 KB); this module checks what it can without them, with idea 37's own functions: the coast from
     * the insertion state to the departure point is re-flown and must land on it (1 m, 1 mm/s), the impulsive delta-v is
     * recomputed, the asymptote must lie in the plane there, the epochs must agree with the coast, and the engine's
     * thrust, flow and exhaust velocity must agree with each other and with idea 37's capacity. Returns the set-up
     * {h37, coast table, frame, masses, engine, target} or {refusal}.
     */
    function importWindow(h37) {
      var h = h37;
      if (typeof h37 === 'string') { try { h = JSON.parse(h37); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 37 (Window) or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 37 (Window) or from this page.') };
      if (h.from === '38-burn-out') return parseHandoff(h);
      if (h.from !== '37-window') return { refusal: refusal('invalid_input', 'This is a handoff from ' + h.from + '; Burn Out takes idea 37\'s (the departure point, its epoch and the asymptote).', 'Take it through idea 37 (Window) first.') };
      if (h.version !== 1) return { refusal: refusal('invalid_input', 'Idea 37 handoff version ' + h.version + ' is not the version 1 this page reads.', 'A version 1 handoff from idea 37.') };
      var O = h.outputs || {}, I = h.inputs || {};
      var need = ['launch', 'insertion_state_j2000', 'coast', 'departure_point', 'impulsive_departure', 'asymptote', 'propellant_for_departure', 'departure_delta_v_capacity'];
      var missing = need.filter(function (k) { return !O[k] || O[k].value == null; });
      if (missing.length) {
        var why = (h.refusals || []).filter(function (r) { return !r.from && ['earth_orientation', 'dogleg'].indexOf(r.applies_to) < 0; }).map(function (r) { return r.reason; });
        return { refusal: refusal('insufficient_data', 'Idea 37\'s handoff has no ' + missing.join(', ') + (why.length ? ' (its refusal: ' + why[0] + ')' : '') + ': there is no departure point to burn from.', 'A handoff from idea 37 with a launch inside a window and a hyperbolic asymptote (C3 > 0).', { applies_to: 'departure_point' }) };
      }
      var bad = function (what) { return { refusal: refusal('invalid_input', 'Idea 37\'s handoff is not self-consistent: ' + what + '. It was edited, or not made by idea 37.', 'The unedited handoff idea 37 exported.') }; };
      var L = O.launch.value, INS = O.insertion_state_j2000.value, DP = O.departure_point.value, CO = O.coast.value, AS = O.asymptote.value, IMP = O.impulsive_departure.value, CAP = O.departure_delta_v_capacity.value;
      var set37 = I.settings || {};
      if (AS.mode !== 'hyperbolic' || !(AS.c3_m2_s2 > 0)) return { refusal: refusal('out_of_envelope', 'Idea 37\'s asymptote is not hyperbolic (C3 ' + fmt(AS.c3_m2_s2 / 1e6, 4) + ' km^2/s^2): nothing to depart along.', 'A transfer with C3 > 0.', { applies_to: 'departure_point' }) };
      var launchMs = W.parseUtc(L.utc);
      if (launchMs == null) return bad('the launch time is not a UTC time');
      var T = W.orient(launchMs);
      if (T.refusal) return { refusal: T.refusal };
      if (Math.abs(T.tdb - L.tdb_s_past_j2000) > 1e-5) return bad('the launch TDB is not its UTC');
      var P = T.P, toMod = function (x) { return W.mxv(P, x); }, toJ2000 = function (x) { return W.mtxv(P, x); };
      var j2 = set37.j2 !== false, dt = set37.dt || 10;
      if (!(num(dt) && dt >= 1 && dt <= 60)) return bad('its coast step');
      var rI = toMod(INS.r_m), vI = toMod(INS.v_m_s), coast = CO.duration_s;
      if (!(coast >= 0)) return bad('the coast is negative');
      if (Math.abs(DP.tdb_s_past_j2000 - INS.tdb_s_past_j2000 - coast) > 1e-4) return bad('the departure epoch is not insertion plus the coast');
      var period = TWO_PI * Math.sqrt(Math.pow(1 / (2 / norm(rI) - dot(vI, vI) / MU), 3) / MU);
      var table = coastTable(rI, vI, -coast, 3 * period, dt, j2), dp = table.at(0), rD = toMod(DP.r_m), vD = toMod(DP.v_m_s);
      var dr = norm(sub(dp.r, rD)), dv = norm(sub(dp.v, vD));
      if (!(dr < 1 && dv < 1e-3)) return bad('its insertion state, coasted ' + fmt(coast, 6) + ' s with J2 ' + (j2 ? 'on' : 'off') + ', misses its departure point by ' + fmt(dr, 3) + ' m and ' + fmt(dv, 3) + ' m/s');
      var S = toMod(AS.s_hat_j2000);
      if (Math.abs(norm(AS.s_hat_j2000) - 1) > 1e-9 || rel(AS.vinf_m_s * AS.vinf_m_s, AS.c3_m2_s2) > 1e-9) return bad('its asymptote');
      var hb = unit(cross(rD, vD)), beta = Math.asin(dot(S, hb)) / DEG;
      if (Math.abs(beta) > 1e-6) return bad('the asymptote lies ' + fmt(beta, 3) + ' deg out of the plane at the departure point');
      var dep = W.departureOf({ ev: { r: rD, v: vD }, hb: hb }, { asym: { c3: AS.c3_m2_s2 } });
      if (rel(dep.dv, IMP.delta_v_m_s) > 1e-9 || rel(dep.vp, IMP.v_perigee_m_s) > 1e-9) return bad('its impulsive delta-v is not what its departure point gives');
      // the guided stage and its engine, from idea 34's vehicle inside idea 36's handoff
      var h36 = I.closed_loop_handoff, h35 = h36 && h36.inputs && h36.inputs.ascent_handoff, h34 = h35 && h35.inputs && h35.inputs.vehicle_handoff;
      if (!h34 || !h34.inputs || !h34.inputs.vehicle || !h34.inputs.engines) return bad('it carries no idea 34 vehicle (idea 36 > 35 > 34)');
      var cut = h36.outputs && h36.outputs.cutoff && h36.outputs.cutoff.value;
      var stg = cut && h34.inputs.vehicle.stages.filter(function (s) { return s.label === cut.stage; })[0];
      var e34 = stg && h34.inputs.engines[stg.engine];
      if (!e34 || !num(e34.thrust_vacuum_N) || !num(e34.mass_flow_kg_s)) return bad('the guided stage\'s engine is not in idea 34\'s vehicle');
      var cnt = stg.count || 1, Fv = e34.thrust_vacuum_N * cnt, md = e34.mass_flow_kg_s * cnt;
      if (rel(Fv / md, e34.specific_impulse_vacuum_m_s) > 1e-6 || rel(e34.specific_impulse_vacuum_m_s, CAP.exhaust_velocity_m_s) > 1e-9) return bad('the engine\'s thrust, flow and exhaust velocity disagree');
      var mIns = DP.mass_kg, mp = O.propellant_for_departure.value;
      if (rel(CAP.mass_at_insertion_kg, mIns) > 1e-12 || !(mp >= 0 && mp < mIns)) return bad('its masses');
      var payload = h34.outputs && h34.outputs.payload_mass && h34.outputs.payload_mass.value;
      if (!num(payload)) return bad('it carries no payload mass from idea 34');
      var fuel = (e34.propellant && e34.propellant.fuel || []).map(function (f) { return f.name; }).join('+');
      return {
        from: '37-window', h37: h, launchMs: launchMs, T: T, P: P, toMod: toMod, toJ2000: toJ2000, j2: j2, coastDt: dt, coast: coast, table: table, period: period,
        dp: { r: rD, v: vD, tdb: DP.tdb_s_past_j2000 }, S: S, c3: AS.c3_m2_s2, dvImp: IMP.delta_v_m_s, mIns: mIns, mp: mp, payload: payload, inert: mIns - mp - payload,
        eng: { F: Fv, mdot: md, label: stg.engine + (cnt > 1 ? ' x' + cnt : ''), stage: stg.label, count: cnt, fuel: fuel, source: 'idea 33\'s ' + stg.engine + ' deck in idea 34\'s vehicle (' + stg.label + ')' },
        asym: AS, refusals37: h.refusals || [], check: { coastMiss_m: dr, coastMiss_m_s: dv, planeResidualDeg: beta },
      };
    }
    /** The scenario for idea 37's departure, with settings {steering, burns, thrustScale, payloadKg, dt}. */
    function windowScenario(st, set) {
      var pay = set.payloadKg != null ? set.payloadKg : st.payload;
      var sc = { kind: 'window', mode: 'asymptote', stateAt: st.table.at, coast: st.coast, S: st.S, c3: st.c3, eng: st.eng, j2: st.j2, coastDt: st.coastDt,
        m0: st.inert + st.mp + pay, mp: st.mp, inert: st.inert, payload: pay, ref: st.dp, dvImp37: st.dvImp };
      return finishScenario(sc, set);
    }

    // ------------------------------------------------------------------ Apollo 17, from the flight report
    /** Apollo 17's translunar burn: the engine as flown, in three thrust segments. Start (STDV open to +2.5 s): section
     * 7.6's measured impulse over Table 16-7's ignition-to-mainstage mass. Mainstage: Table 7-2's thrust and flow for the
     * 5.0 mixture ratio after Table 2-2's valve shift; the 4.5 phase before it carries the rest of section 7.7's measured
     * total impulse and of Table 16-7's mainstage mass over the flown durations [Likely: the split assumes the 5.0
     * phase ran at Table 7-2's standard-altitude values]. */
    function apollo17Engine() {
      var B = F512.stageTables['S-IVB burn 2'].events, E7 = F512.engines.sivbSecondBurn, ev = TLI.events;
      var tIg = B['S-IVB ignition'].t, tMs = B['S-IVB mainstage'].t, tShift = ev.emrShift.t, tCut = B['S-IVB engine cutoff'].t;
      var mIg = B['S-IVB ignition'].vehicle, mMs = B['S-IVB mainstage'].vehicle;
      var mainRow = F512.sequence.filter(function (r) { return r[0] === 'MAINSTAGE'; }).pop(); // the second-burn mainstage row
      var mMain = -mainRow[1];
      var F5 = E7.thrustLbf * LBF, md5 = (E7.loxFlowLbmS + E7.fuelFlowLbmS) * LB, d5 = tCut - tShift, d45 = tShift - tMs;
      var Itot = TLI.mainstage.impulseLbfS * LBF, F45 = (Itot - F5 * d5) / d45, md45 = (mMain - md5 * d5) / d45;
      var Fb = TLI.buildup.impulseLbfS * LBF / TLI.buildup.durationS, mdb = (mIg - mMs) / TLI.buildup.durationS;
      return {
        segs: [{ dur: tMs - tIg, F: Fb, mdot: mdb, label: 'start (STDV open to +2.5 s)' }, { dur: d45, F: F45, mdot: md45, label: 'mainstage, EMR 4.5' }, { dur: Infinity, F: F5, mdot: md5, label: 'mainstage, EMR 5.0' }],
        tIg: tIg, tMs: tMs, tShift: tShift, tCut: tCut, mIg: mIg, mMs: mMs, mCut: B['S-IVB engine cutoff'].vehicle, mMain: mMain, Itot: Itot, F5: F5, md5: md5, F45: F45, md45: md45, Fb: Fb, mdb: mdb,
        meanF: Itot / (tCut - tMs), meanMdot: mMain / (tCut - tMs), label: 'J-2 (S-IVB-512) as flown', source: 'MPR-SAT-FE-73-1 sections 7.6-7.7, Tables 7-2, 16-7, 2-2',
      };
    }
    /** The flight's own delta-v: the ideal rocket equation over each segment as flown (start, 4.5, 5.0 to cutoff). */
    function apollo17FlownDv(eng) {
      var s = eng.segs, m1 = eng.mIg - s[0].mdot * s[0].dur, m2 = m1 - s[1].mdot * s[1].dur, mc = m2 - s[2].mdot * (eng.tCut - eng.tShift);
      var dv = s[0].F / s[0].mdot * Math.log(eng.mIg / m1) + s[1].F / s[1].mdot * Math.log(m1 / m2) + s[2].F / s[2].mdot * Math.log(m2 / mc);
      return { dv: dv, mCut: mc };
    }
    function apollo17Scenario(set) {
      var eng = apollo17Engine(), c = W.as512Coast({ toRangeTime: eng.tIg }), tIns = AP.insertion.rangeTime;
      var table = coastTable(c.r0, c.v0, tIns, eng.tIg + 600, 10, true), s = table.at(eng.tIg);
      var engUse = set.engine === 'mean' ? { F: eng.meanF, mdot: eng.meanMdot, label: 'J-2 at the burn\'s mean thrust and flow' } : set.engine === 'chain' && deps.chainJ2 ? deps.chainJ2 : eng;
      var sc = { kind: 'apollo17', mode: 'free', cutoff: 'two-body', stateAt: table.at, tIgFixed: eng.tIg, coast: eng.tIg - tIns, S: null, c3: F512.c3AtSivb2Gcs.actual[0], eng: engUse, j2: true, coastDt: 10,
        m0: eng.mIg, mp: eng.mIg - eng.mCut, inert: eng.mCut, payload: 0, ref: s, flight: eng };
      return finishScenario(sc, set);
    }

    // ------------------------------------------------------------------ a departure of your own
    /** A circular parking orbit at altitude h and inclination i (starting at the ascending node), a stage, an engine and
     * a C3; the asymptote is left free (the burn starts at the node). spec {altitudeKm, inclinationDeg, c3, inertKg,
     * propellantKg, payloadKg, thrustN, veMS, j2}. */
    function customScenario(spec, set) {
      var bad = function (w) { return { refusal: refusal('invalid_input', w, 'Typed values in the stated units.', { applies_to: 'custom' }) }; };
      if (!(spec && num(spec.altitudeKm) && spec.altitudeKm >= 100 && spec.altitudeKm <= 5000)) return bad('The parking-orbit altitude must be 100 to 5,000 km.');
      if (!(num(spec.inclinationDeg) && spec.inclinationDeg >= 0 && spec.inclinationDeg <= 180)) return bad('The inclination must be 0 to 180 deg.');
      if (!(num(spec.c3) && spec.c3 > -2e7 && spec.c3 <= 2e8)) return bad('C3 must be between -20 and 200 km^2/s^2.');
      if (!(num(spec.inertKg) && spec.inertKg > 0 && num(spec.propellantKg) && spec.propellantKg > 0 && num(spec.payloadKg) && spec.payloadKg >= 0)) return bad('Stage inert mass and propellant must be positive and the payload zero or more.');
      if (!(num(spec.thrustN) && spec.thrustN > 0 && num(spec.veMS) && spec.veMS >= 500 && spec.veMS <= 10000)) return bad('Thrust must be positive and the exhaust velocity 500 to 10,000 m/s.');
      var r = RE + spec.altitudeKm * 1000, vc = Math.sqrt(MU / r), i = spec.inclinationDeg * DEG;
      var r0 = [r, 0, 0], v0 = [0, vc * Math.cos(i), vc * Math.sin(i)], j2 = spec.j2 !== false;
      var table = coastTable(r0, v0, 0, 600, 10, j2);
      var sc = { kind: 'custom', mode: 'free', stateAt: table.at, tIgFixed: 0, coast: 0, S: null, c3: spec.c3, eng: { F: spec.thrustN, mdot: spec.thrustN / spec.veMS, label: 'typed engine' }, j2: j2, coastDt: 10,
        m0: spec.inertKg + spec.propellantKg + spec.payloadKg, mp: spec.propellantKg, inert: spec.inertKg, payload: spec.payloadKg, ref: { r: r0, v: v0 }, spec: clone(spec) };
      return finishScenario(sc, set);
    }

    // ================================================================== putting it together
    function validateSet(set) {
      if (STEERING.indexOf(set.steering) < 0) return refusal('invalid_input', 'Steering must be one of ' + STEERING.join(', ') + '.', 'A steering law.', { applies_to: 'steering' });
      if (!(set.burns === 1 || set.burns === 2 || set.burns === 3 || set.burns === 4)) return refusal('invalid_input', 'One to four burns.', 'A whole number of burns, 1 to 4.', { applies_to: 'burns' });
      if (set.burns > 1 && set.steering !== 'tangential') return refusal('invalid_input', 'Perigee burns are flown with tangential steering only here.', 'Tangential steering, or one burn.', { applies_to: 'burns' });
      if (!(num(set.thrustScale) && set.thrustScale >= 0.05 && set.thrustScale <= 10)) return refusal('invalid_input', 'The thrust scale must be 0.05 to 10.', 'A scale on the engine\'s thrust and flow.', { applies_to: 'thrust' });
      if (set.payloadKg != null && !(num(set.payloadKg) && set.payloadKg >= 0 && set.payloadKg <= 1e6)) return refusal('invalid_input', 'The payload must be 0 to 1,000,000 kg.', 'A payload in kg.', { applies_to: 'payload' });
      if (!(num(set.dt) && set.dt >= 0.05 && set.dt <= 5)) return refusal('invalid_input', 'The burn step must be 0.05 to 5 s.', 'A step in seconds.', { applies_to: 'step' });
      return null;
    }
    function defaults() { return { steering: 'tangential', burns: 1, thrustScale: 1, payloadKg: null, dt: 1, sweep: true, capability: true }; }
    /** Solve the departure for a scenario and settings: the burn(s), the depletion run when the propellant is short, the
     * losses. Returns {sc, law, burns, final, conic, phi, beta, mUsed, short, depleted, ...} or {refusal}. */
    function solve(sc, set, opts) {
      opts = opts || {};
      var law = set.steering, out = { sc: sc, law: law };
      if (sc.N > 1) {
        var m = solveMulti(sc);
        if (m.refusal) return { refusal: m.refusal, sc: sc, law: law };
        out.burns = m.burns; out.coasts = m.coasts; out.final = m.final; out.conic = m.conic; out.phi = m.phi; out.beta = m.beta; out.mUsed = m.mUsed; out.minPerigee = m.minPerigee; out.t1 = m.burns[0].tIg;
        out.yaw = m.final.yaw || 0;
        if (sc.mode === 'asymptote') {
          var ip = solveMulti(sc, [m.burns[0].tIg, 0], true);
          if (!ip.refusal) out.inPlane = { mUsed: ip.mUsed, dv: ip.burns.reduce(function (s2, bb) { return s2 + dvOf(sc, bb); }, 0), betaDeg: ip.beta / DEG };
          if (out.inPlane) out.inPlane.loss = out.inPlane.dv - sc.dvImp;
        }
        if (opts.samples) { var ms = flyMulti(sc, m.burns[0].tIg, { sampleEvery: opts.sampleEvery || 2, yaw: out.yaw }); out.burns = ms.burns; out.coasts = ms.coasts; out.final = ms.final; }
      } else {
        var b, x = null;
        if (law === 'tangential') b = solveIgnition(sc, law, {});
        else { var o = optimise(sc, law, opts); if (o.refusal) return { refusal: o.refusal, sc: sc, law: law }; b = o.b; x = o.x; }
        if (b.refusal) return { refusal: b.refusal, sc: sc, law: law };
        if (opts.samples) { var bs = burnAt(sc, b.tIg, law, lawParams(sc, law, x || []), { sampleEvery: opts.sampleEvery || 2, yaw: b.yaw }); bs.iterations = b.iterations; b = bs; }
        out.yaw = b.yaw || 0;
        out.burns = [b]; out.final = b; out.conic = b.conic || (sc.efn === energyJ2 ? farConic(b.r, b.v, true) : conic(b.r, b.v)); out.phi = b.phi; out.beta = b.beta; out.mUsed = b.mUsed; out.x = x;
        out.params = law === 'fixed' ? { alphaDeg: x[0] / DEG } : law === 'optimal' ? { aDeg: x[0] / DEG, bDeg: x[1] / DEG } : null;
      }
      out.dvFinite = out.burns.reduce(function (s, bb) { return s + dvOf(sc, bb); }, 0);
      out.dvImp = sc.dvImp;
      out.loss = out.dvFinite - sc.dvImp;
      out.mpImp = sc.m0 * (1 - Math.exp(-sc.dvImp / sc.ve));
      out.short = out.mUsed - sc.mp;
      if (out.short > 0 && sc.kind !== 'apollo17') out.depleted = depletionRun(sc, set, out);
      return out;
    }
    /** Delta-v expended by a burn: the ideal rocket equation over its thrust segments. */
    function dvOf(sc, b) {
      var segs = segsOf(sc.eng, sc.k), t = 0, m = b.m0, dv = 0;
      for (var i = 0; i < segs.length && t < b.dur - 1e-12; i++) {
        var d = Math.min(segs[i].dur, b.dur - t), m1 = m - segs[i].mdot * d;
        dv += segs[i].F / segs[i].mdot * Math.log(m / m1); m = m1; t += d;
      }
      return dv;
    }
    /** When the propellant is short: the same burn(s) flown until the tank is empty. What the stage reaches instead. */
    function depletionRun(sc, set, sol) {
      var r;
      if (sc.N > 1) r = flyMulti(sc, sol.burns[0].tIg, { unlimited: false, yaw: sol.yaw }).final;
      else r = burnAt(sc, sol.burns[0].tIg, set.steering, lawParams(sc, set.steering, sol.x || []), { unlimited: false, yaw: sol.yaw });
      if (!r) return null;
      var c = conic(r.r, r.v);
      return { t: r.t, r: r.r, v: r.v, m: r.m, c3: c.c3, apogeeAlt: c.ra ? c.ra - RE : null, period: c.period || null, ended: r.ended };
    }
    /** The largest payload the stage can send to the target with the propellant it has (finite burn, the steering law's
     * parameters held at the nominal solution's, ignition re-solved), and the impulsive equivalent (closed form). */
    function capability(sc, set, sol) {
      var ve = sc.ve, need = Math.exp(sc.dvImp / ve), pImp = sc.mp / (need - 1) - sc.inert;
      var out = { impulsive: pImp, inert: sc.inert, propellant: sc.mp, handed: sc.payload };
      if (!(pImp > 0)) { out.finite = null; out.impulsive = null; out.impulsiveRaw = pImp; out.none = true; return out; }
      var g = function (P) {
        var s2 = Object.assign({}, sc, { m0: sc.inert + sc.mp + P, payload: P }), r;
        if (sc.N > 1) r = solveMulti(s2, [sol.burns[0].tIg, sol.yaw || 0]); else r = solveIgnition(s2, set.steering, lawParams(sc, set.steering, sol.x || []), sol.burns[0].tIg, sol.yaw);
        return r.refusal ? null : r.mUsed - sc.mp;
      };
      var p0 = pImp * 0.98, p1 = pImp * 0.9, f0 = g(p0), f1 = g(p1);
      if (f0 == null || f1 == null) { out.finite = null; return out; }
      for (var it = 0; it < 30 && Math.abs(f1) > 1e-6; it++) {
        var p2 = p1 - f1 * (p1 - p0) / (f1 - f0);
        if (!(p2 > -sc.inert)) p2 = (p1 - sc.inert) / 2;
        p0 = p1; f0 = f1; p1 = p2; f1 = g(p1);
        if (f1 == null) { out.finite = null; return out; }
        if (Math.abs(p1 - p0) < 1e-6) break;
      }
      out.finite = p1 > 0 ? p1 : 0;
      out.finiteRaw = p1;
      return out;
    }
    /** Finite-burn loss against initial thrust-to-weight for N = 1, 2, 3 tangential burns (thrust and flow scaled
     * together, ve fixed), on this scenario, targeted in plane only (as if the launch plane were aimed for each
     * phasing: the yaw idea 37's plane would need is the selected point's, not the curve's). */
    function sweep(sc, opts) {
      opts = opts || {};
      // a flown engine in segments (Apollo 17) is swept at its mean thrust and flow
      var eng = sc.eng.segs ? { F: sc.eng.meanF, mdot: sc.eng.meanMdot, label: sc.eng.label + ' (mean)' } : sc.eng;
      var tws = opts.tws || [0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1.2, 1.6, 2.4, 3.2], base = eng.F / (sc.m0 * G0), out = [];
      (opts.ns || [1, 2, 3]).forEach(function (N) {
        tws.forEach(function (w) {
          var s2 = finishScenario(Object.assign({}, sc, { eng: eng }), { thrustScale: w / base, burns: N, dt: opts.h || 2, tMax: sc.tMax });
          s2.stateAt = sc.stateAt; s2.mode = sc.mode;
          var r = N > 1 ? solveMulti(s2, null, true) : solveIgnition(s2, 'tangential', {}, null, null, true);
          if (r.refusal) { out.push({ n: N, tw: w, loss: null, refused: r.refusal.applies_to || r.refusal.code }); return; }
          var bs = r.burns || [r], dv = bs.reduce(function (s, bb) { return s + dvOf(s2, bb); }, 0);
          out.push({ n: N, tw: w, loss: dv - s2.dvImp, lossPct: (dv - s2.dvImp) / s2.dvImp * 100, mp: r.mUsed, durationS: (bs[bs.length - 1].t - bs[0].tIg) });
        });
      });
      return out;
    }

    /**
     * Everything for one set-up. src: {window: importWindow's set-up} | {apollo17: true} | {custom: spec}; set (defaults()
     * shape). Returns {sc, sol, cap, sweep, refusals, refusal}.
     */
    function compute(src, set, opts) {
      opts = opts || {};
      var out = { refusals: [] }, bad = validateSet(set);
      if (bad) { out.refusal = bad; return out; }
      var sc;
      if (src.window) sc = windowScenario(src.window, set);
      else if (src.apollo17) { if (set.burns > 1) { out.refusal = refusal('invalid_input', 'The Apollo 17 replay is one burn, as flown.', 'One burn.', { applies_to: 'burns' }); return out; } sc = apollo17Scenario(set); }
      else if (src.custom) { sc = customScenario(src.custom, set); if (sc.refusal) { out.refusal = sc.refusal; return out; } }
      else { out.refusal = refusal('invalid_input', 'No departure to burn: import idea 37\'s handoff or choose a preset.', 'Idea 37\'s handoff.'); return out; }
      out.sc = sc;
      var sol = solve(sc, set, { samples: opts.samples !== false, sampleEvery: opts.sampleEvery });
      if (sol.refusal) { out.refusal = sol.refusal; return out; }
      out.sol = sol;
      if (sc.kind === 'apollo17') out.apollo = apollo17Compare(sc, sol);
      if (sc.kind !== 'apollo17' && set.capability !== false) out.cap = capability(sc, set, sol);
      if (set.sweep !== false && opts.sweep !== false) out.sweep = sweep(sc, { h: 2 });
      // refusals of this module's own
      var noPayload = out.cap && out.cap.none;
      if (sol.short > 0 && sc.kind !== 'apollo17') {
        var dpl = sol.depleted;
        out.refusals.push(refusal('out_of_envelope', 'The finite burn needs ' + fmt(sol.mUsed, 5) + ' kg of propellant and the ' + (sc.eng.stage || 'stage') + ' has ' + fmt(sc.mp, 5) + ' kg (short by ' + fmt(sol.short, 4) + ' kg): ' + (dpl ? 'burned to empty it reaches C3 ' + fmt(dpl.c3 / 1e6, 4) + ' km^2/s^2' + (dpl.apogeeAlt ? ', an orbit with apogee ' + fmt(dpl.apogeeAlt / 1000, 4) + ' km' : '') + ', not the ' + fmt(sc.c3 / 1e6, 4) + ' the transfer needs' : 'it cannot reach the C3') + '.',
          noPayload ? 'More propellant in the stage (module 34) or a lower C3 (module 39): no payload, however light, gets there on this propellant.' : 'A payload of at most ' + fmt(out.cap && out.cap.finite, 5) + ' kg (the capability), more propellant in the stage (module 34), or a lower C3 (module 39).', { applies_to: 'departure_propellant', needed_kg: sol.mUsed, available_kg: sc.mp }));
      }
      if (noPayload) out.refusals.push(refusal('out_of_envelope', 'Even with no payload the stage cannot reach C3 ' + fmt(sc.c3 / 1e6, 4) + ' km^2/s^2: its ' + fmt(sc.mp, 5) + ' kg of propellant on its own ' + fmt(sc.inert, 5) + ' kg give at most ' + fmt(sc.ve * Math.log((sc.inert + sc.mp) / sc.inert), 4) + ' m/s against the ' + fmt(sc.dvImp, 4) + ' m/s an impulsive burn needs.', 'More propellant in the stage (module 34), or a lower C3 (module 39).', { applies_to: 'payload_capability' }));
      if (sc.N > 1 && sc.kind === 'window') {
        var late = sol.final.t;
        out.refusals.push(refusal('insufficient_data', 'With ' + sc.N + ' perigee burns the last cutoff comes ' + fmt(late / 3600, 4) + ' h after idea 37\'s departure point, but the asymptote is the one for that day held fixed: the transfer leaving at the later time needs its own.', 'Module 39 (Lambert\'s Road) re-solving the transfer for the final burn\'s date.', { applies_to: 'asymptote_epoch', delay_s: late }));
      }
      if (sc.kind === 'window' && sol.minPerigee != null && sol.minPerigee < RE) out.refusals.push(refusal('out_of_envelope', 'A phasing orbit\'s perigee is below the Earth\'s surface.', 'Fewer perigee burns or more thrust.', { applies_to: 'perigee_burns' }));
      return out;
    }

    // ================================================================== Apollo 17: the model against the flight
    function apollo17Compare(sc, sol) {
      var E = sc.flight, b = sol.final, flown = apollo17FlownDv(E), gcs = F512.cutoff.sivb2Gcs, T45 = AP.tli;
      var g = geodetic(b.r), hd = headingOf(b.r, b.v);
      // the cutoff transient (section 7.8) as an impulse along the last thrust direction, then coast to Table 4-5's time
      var dvTail = TLI.cutoff.impulseLbfS * LBF / b.m, dtTli = T45.rangeTime - E.tCut;
      var v1 = add(b.v, scale(b.uEnd, dvTail)), tl = W.propagate(b.r, v1, dtTli, { dt: 1, j2: true }), ct = conic(tl.r, tl.v), gt = geodetic(tl.r), ht = headingOf(tl.r, tl.v);
      var dn = (W.nodeOf(unit(cross(tl.r, tl.v))) / DEG - 180 + 360) % 360, incl = Math.acos(unit(cross(tl.r, tl.v))[2]) / DEG;
      var start = sc.stateAt(E.tIg), dnIg = (W.nodeOf(unit(cross(start.r, start.v))) / DEG - 180 + 360) % 360;
      var rows = [
        { key: 'burn_time', label: 'Burn time, ignition (STDV open) to guidance cutoff', unit: 's', model: b.dur, flight: E.tCut - E.tIg, source: 'Table 16-7 / Table 2-2 items 88, 94' },
        { key: 'mass_cutoff', label: 'Vehicle mass at cutoff', unit: 'kg', model: b.m, flight: E.mCut, source: 'Table 16-7 (ACT, engine cutoff)' },
        { key: 'dv', label: 'Delta-v expended (ideal rocket equation)', unit: 'm/s', model: sol.dvFinite, flight: flown.dv, source: 'computed from sections 7.6-7.7 and Tables 7-2, 16-7 over the flown durations' },
        { key: 'altitude_cutoff', label: 'Altitude at guidance cutoff', unit: 'km', model: g.altitude / 1000, flight: gcs[1], source: 'Table 4-2 (ACT)' },
        { key: 'speed_cutoff', label: 'Space-fixed speed at guidance cutoff', unit: 'm/s', model: norm(b.v), flight: gcs[2], source: 'Table 4-2 (ACT)' },
        { key: 'accel_cutoff', label: 'Acceleration at cutoff', unit: 'm/s^2', model: b.seg.F / b.m, flight: F512.acceleration.sivb2[1], source: 'Table 4-1 (ACT, nearest time point)' },
        { key: 'altitude_tli', label: 'Altitude at TLI (cutoff + 10 s)', unit: 'km', model: gt.altitude / 1000, flight: T45.altitudeKm, source: 'Table 4-5 (ACT)' },
        { key: 'speed_tli', label: 'Space-fixed speed at TLI', unit: 'm/s', model: norm(tl.v), flight: T45.velocityMs, source: 'Table 4-5' },
        { key: 'fpa_tli', label: 'Flight-path angle at TLI', unit: 'deg', model: ht.fpaDeg, flight: T45.fpaDeg, source: 'Table 4-5' },
        { key: 'heading_tli', label: 'Space-fixed heading at TLI', unit: 'deg', model: ht.headingDeg, flight: T45.headingDeg, source: 'Table 4-5' },
        { key: 'c3_tli', label: 'C3 at TLI', unit: 'km^2/s^2', model: ct.c3 / 1e6, flight: T45.c3_m2s2 / 1e6, source: 'Table 4-5' },
        { key: 'ecc_tli', label: 'Eccentricity at TLI', unit: '', model: ct.e, flight: T45.eccentricity, source: 'Table 4-5' },
        { key: 'incl_tli', label: 'Inclination at TLI', unit: 'deg', model: incl, flight: T45.inclinationDeg, source: 'Table 4-5' },
        { key: 'node_tli', label: 'Descending node at TLI (from the launch meridian)', unit: 'deg', model: dn, flight: T45.descendingNodeDeg, source: 'Table 4-5' },
      ];
      rows.forEach(function (r) { r.gap = r.model - r.flight; });
      return { rows: rows, flownDv: flown.dv, flownMcut: flown.mCut, dvImp: sc.dvImp, flightLoss: flown.dv - sc.dvImp, modelLoss: sol.loss, nodeAtIgnitionDeg: dnIg, nodeAtInsertionDeg: AP.insertion.descendingNodeDeg,
        tailDv: dvTail, ignition: start, engine: E, latCutoffDeg: g.latDeg };
    }

    // ================================================================== the handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function cleanSet(set) { var s = {}; ['steering', 'burns', 'thrustScale', 'payloadKg', 'dt', 'sweep', 'capability', 'engine'].forEach(function (k) { if (set[k] !== undefined) s[k] = set[k]; }); return s; }
    /**
     * The handoff to module 39 (version 1, from: "38-burn-out"). inputs: idea 37's handoff whole (or the preset), the
     * settings. outputs (SI): burns, hyperbolic_departure_state (J2000, TDB), v_infinity, finite_burn_loss, propellant,
     * payload_capability, loss_vs_thrust_to_weight, engine.
     */
    function makeHandoff(src, set, R, extra) {
      extra = extra || {};
      var h = { handoff: 'long-way-round', version: 1, from: '38-burn-out', produced: extra.produced || new Date().toISOString(),
        inputs: { window_handoff: src.window ? src.window.h37 : null, preset: src.apollo17 ? 'apollo17' : src.custom ? 'custom' : null, custom: src.custom ? clone(src.custom) : null, settings: cleanSet(set) }, outputs: {}, refusals: [], assumptions: [
          'The burn is flown in idea 37\'s frame (mean equator and equinox of date at liftoff, J2 about its z axis) and every state handed on is turned back to J2000 (ICRF axes) with idea 37\'s precession; epochs in TDB seconds past J2000 beside UTC.',
          'Gravity: point mass (Aster\'s GM) plus J2 (WGS-84), as idea 37\'s coast; no drag, no Sun or Moon, no venting during the coast or the burn.',
          'Engine: constant vacuum thrust and flow (no start or cutoff transient, no throttling, no mixture-ratio shift) unless replaying Apollo 17; thrust scale multiplies thrust and flow together, exhaust velocity unchanged.',
          'Cutoff: when the energy conserved under point mass + J2 reaches C3/2 (so the C3 is reached at infinity in this gravity model; the two-body C3 at cutoff, idea 37\'s and Aster\'s convention, is handed beside it); the asymptote is the hyperbola\'s after the coast is followed with J2 to 20 Earth radii, targeted onto idea 37\'s by the ignition time and a constant yaw.',
          'Steering ' + set.steering + (set.burns > 1 ? ', ' + set.burns + ' perigee burns each centred in time on a perigee passage, the first ' + (set.burns - 1) + ' raising the apogee to equal shares of the impulsive delta-v' : ', one burn') + '; the plane is the parking orbit\'s (no yaw).',
        ] };
      var O = h.outputs, sc = R.sc, sol = R.sol;
      if (src.window) (src.window.refusals37 || []).forEach(function (x) { h.refusals.push(Object.assign({}, x, { from: x.from || '37-window' })); });
      if (R.refusal) { h.refusals.push(R.refusal); }
      if (sc && sol && !R.refusal) {
        var toJ = src.window ? src.window.toJ2000 : function (x) { return x; }, tdbOf = null, utcOf = null;
        if (src.window) { var w = src.window; tdbOf = function (t) { return w.dp.tdb + t; }; utcOf = function (t) { return iso(w.launchMs + (w.dp.tdb + t - w.T.tdb) * 1000); }; }
        O.engine = qv({ label: sc.eng.label, thrust_N: sc.eng.segs ? null : sc.eng.F * sc.k, mass_flow_kg_s: sc.eng.segs ? null : sc.eng.mdot * sc.k, exhaust_velocity_m_s: sc.ve, thrust_scale: sc.k, thrust_to_weight_ignition: sc.tw0, mass_ignition_kg: sc.m0 }, 'N, kg/s, m/s, kg', sc.k === 1 ? 'derived' : 'assumed', sc.eng.source || sc.eng.label);
        O.burns = qv(sol.burns.map(function (b) {
          var c = conic(b.r, b.v), arc = Math.acos(Math.max(-1, Math.min(1, dot(unit(b.start.r), unit(b.r))))) / DEG;
          return { ignition_utc: utcOf ? utcOf(b.tIg) : null, ignition_tdb_s_past_j2000: tdbOf ? tdbOf(b.tIg) : null, ignition_from_departure_point_s: sc.kind === 'window' ? b.tIg : null, cutoff_utc: utcOf ? utcOf(b.t) : null, cutoff_tdb_s_past_j2000: tdbOf ? tdbOf(b.t) : null,
            duration_s: b.dur, propellant_kg: b.mUsed, mass_ignition_kg: b.m0, mass_cutoff_kg: b.m, delta_v_m_s: dvOf(sc, b), burn_arc_deg: arc, c3_cutoff_m2_s2: c.c3, altitude_cutoff_m: norm(b.r) - RE };
        }), 's, kg, m/s, deg, m^2/s^2, m', 'derived', KERNEL + ' (' + sol.law + (sc.N > 1 ? ', ' + sc.N + ' perigee burns' : '') + ', RK4 at ' + sc.h + ' s)');
        O.finite_burn_loss = qv({ delta_v_finite_m_s: sol.dvFinite, delta_v_impulsive_m_s: sol.dvImp, loss_m_s: sol.loss, loss_fraction: sol.loss / sol.dvImp, propellant_finite_kg: sol.mUsed, propellant_impulsive_kg: sol.mpImp, extra_propellant_kg: sol.mUsed - sol.mpImp }, 'm/s, kg', 'derived', KERNEL + ' (impulsive delta-v: ' + (sc.kind === 'window' ? 'idea 37\'s departureOf()' : 'vis-viva from the ignition state') + ')');
        O.propellant = qv({ available_kg: sc.mp, needed_kg: sol.mUsed, remaining_kg: Math.max(0, sc.mp - sol.mUsed), short_kg: Math.max(0, sol.short) }, 'kg', 'derived', KERNEL);
        if (sol.short <= 0 && sol.conic && sol.conic.sHat) {
          // magnitude from the energy at cutoff (conserved under point mass + J2, so exact at infinity in this model; the
          // conic at 20 Earth radii still feels a little of J2's potential), direction from the conic at 20 Earth radii
          var f = sol.final, sJ = toJ(sol.conic.sHat), Ecut = sc.efn(f.r, f.v), vinfMag = Math.sqrt(2 * Ecut), vinfJ = scale(sJ, vinfMag);
          O.hyperbolic_departure_state = qv({ utc: utcOf ? utcOf(f.t) : null, tdb_s_past_j2000: tdbOf ? tdbOf(f.t) : null, r_m: toJ(f.r), v_m_s: toJ(f.v), mass_kg: f.m, altitude_m: norm(f.r) - RE, frame: src.window ? 'J2000 (ICRF axes)' : 'local (no epoch: not from idea 37)' }, 's, m, m/s, kg', 'derived', KERNEL + ' (state at the last cutoff)');
          O.v_infinity = qv({ vector_m_s: vinfJ, magnitude_m_s: vinfMag, c3_m2_s2: 2 * Ecut, c3_two_body_at_cutoff_m2_s2: 2 * energy(f.r, f.v), yaw_deg: (sol.yaw || 0) / DEG, rla_deg: (Math.atan2(sJ[1], sJ[0]) / DEG + 360) % 360, dla_deg: Math.asin(sJ[2]) / DEG, in_plane_miss_deg: sol.phi != null ? sol.phi / DEG : null, out_of_plane_deg: sol.beta != null ? sol.beta / DEG : null, j2_turn_after_cutoff_deg: sol.conic.far && sc.efn === energyJ2 ? Math.acos(Math.max(-1, Math.min(1, dot(conic(f.r, f.v).sHat || sol.conic.sHat, sol.conic.sHat)))) / DEG : 0 }, 'm/s, m^2/s^2, deg', 'derived', KERNEL + (sc.efn === energyJ2 ? ' (C3 from the energy conserved under point mass + J2; direction from the hyperbola followed with J2 to 20 Earth radii)' : ' (osculating hyperbola at cutoff, two-body)'));
        } else if (sol.depleted) {
          var d = sol.depleted;
          O.state_at_depletion = qv({ utc: utcOf ? utcOf(d.t) : null, tdb_s_past_j2000: tdbOf ? tdbOf(d.t) : null, r_m: toJ(d.r), v_m_s: toJ(d.v), mass_kg: d.m, c3_m2_s2: d.c3, apogee_altitude_m: d.apogeeAlt, period_s: d.period }, 's, m, m/s, kg, m^2/s^2', 'derived', KERNEL + ' (the same burn flown until the propellant is gone)');
        }
        if (R.cap) O.payload_capability = qv({ handed_kg: R.cap.handed, finite_burn_kg: R.cap.finite, impulsive_kg: R.cap.impulsive, stage_inert_kg: R.cap.inert, propellant_kg: R.cap.propellant }, 'kg', 'derived', KERNEL + ' capability(): the payload at which the burn reaches the C3 as the tank empties (the ascent not re-flown: a lighter payload would also arrive with more propellant, so this is a lower bound)');
        if (R.sweep) O.loss_vs_thrust_to_weight = qv(R.sweep.map(function (p) { return { burns: p.n, thrust_to_weight: p.tw, loss_m_s: p.loss, refused: p.refused || null }; }), 'm/s', 'derived', KERNEL + ' sweep() (tangential, RK4 at 2 s)');
      }
      (R.refusals || []).forEach(function (x) { h.refusals.push(x); });
      if (src.window && sc && sc.k === 1) h.refusals.push(refusal('insufficient_data', 'No start or cutoff transient and no venting: the engine runs at its deck\'s vacuum thrust from ignition to cutoff, and nothing boils off in the coast. On Apollo 17 the start and cutoff transients gave ' + fmt(TLI.buildup.impulseLbfS * LBF / 1000, 4) + ' and ' + fmt(TLI.cutoff.impulseLbfS * LBF / 1000, 4) + ' kN s, and the S-IVB vented ' + fmt(-F512.sequence.filter(function (r) { return r[0] === 'FUEL TANK LOSS'; })[0][1], 4) + ' kg of hydrogen in its 3 h coast (MPR-SAT-FE-73-1 sections 7.6, 7.8, Table 16-9).', 'Transient and venting models for this engine and stage.', { applies_to: 'transients' }));
      h.refusals.push(refusal('insufficient_data', 'The asymptote handed on has J2 followed out to 20 Earth radii but not the Moon or the Sun: their pull on the way out of the Earth\'s sphere of influence is not in it.', 'A propagation with the Moon and the Sun out of the Earth\'s sphere of influence (module 40).', { applies_to: 'post_cutoff' }));
      return h;
    }
    function firstDiff(a, b, where) {
      if (typeof a === 'number' || typeof b === 'number') return num(a) && num(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) ? null : where;
      if (Array.isArray(b)) { if (!Array.isArray(a) || a.length !== b.length) return where; for (var i = 0; i < b.length; i++) { var d = firstDiff(a[i], b[i], where + '[' + i + ']'); if (d) return d; } return null; }
      if (b && typeof b === 'object') { if (!a || typeof a !== 'object' || Array.isArray(a)) return where; var ks = Object.keys(b).concat(Object.keys(a).filter(function (k) { return !(k in b); })); for (var j = 0; j < ks.length; j++) { var d2 = firstDiff(a[ks[j]], b[ks[j]], where + '.' + ks[j]); if (d2) return d2; } return null; }
      return a === b ? null : where;
    }
    /** Read this module's handoff back: everything recomputed from its inputs and compared (numbers to 1e-6 relative),
     * the refusal codes compared. Returns {src, set, R} or {refusal}. */
    function parseHandoff(h) {
      var I = h.inputs || {};
      if (!I.settings) return { refusal: refusal('invalid_input', 'This 38-burn-out handoff carries no settings.', 'A handoff exported by this page.') };
      var src;
      if (I.window_handoff) { var st = importWindow(I.window_handoff); if (st.refusal) return st; if (st.from !== '37-window') return { refusal: refusal('invalid_input', 'A 38-burn-out handoff must carry idea 37\'s.', 'A handoff exported by this page.') }; src = { window: st }; }
      else if (I.preset === 'apollo17') src = { apollo17: true };
      else if (I.preset === 'custom' && I.custom) src = { custom: I.custom };
      else return { refusal: refusal('invalid_input', 'This 38-burn-out handoff carries no idea 37 handoff or preset.', 'A handoff exported by this page.') };
      var R = compute(src, I.settings), again = JSON.parse(JSON.stringify(makeHandoff(src, I.settings, R, { produced: h.produced })));
      var d = firstDiff(h.outputs || {}, again.outputs, 'outputs');
      if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      var codes = function (l) { return (l || []).map(function (x) { return (x.applies_to || '') + ':' + x.code; }).sort().join(', '); };
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals (' + (codes(h.refusals) || 'none') + ') are not the ones its inputs give (' + codes(again.refusals) + '): it was edited.', 'The unedited handoff this page exported.') };
      return { from: '38-burn-out', src: src, set: I.settings, R: R, h38: h };
    }

    return {
      LB: LB, G0: G0, LBF: LBF, STEERING: STEERING, constants: { MU: MU, RE: RE, REQ: REQ, RPOLE: RPOLE },
      energy: energy, energyJ2: energyJ2, phiJ2: phiJ2, farConic: farConic, FAR: FAR, conic: conic, asymptoteMiss: asymptoteMiss, geodetic: geodetic, headingOf: headingOf, steerer: steerer, fly: fly, coastTable: coastTable, coastToPerigee: coastToPerigee,
      segsOf: segsOf, burnTimeFor: burnTimeFor, burnAt: burnAt, solveIgnition: solveIgnition, optimise: optimise, flyMulti: flyMulti, solveMulti: solveMulti, lawParams: lawParams, fixedDir: fixedDir,
      importWindow: importWindow, windowScenario: windowScenario, apollo17Engine: apollo17Engine, apollo17FlownDv: apollo17FlownDv, apollo17Scenario: apollo17Scenario, customScenario: customScenario, finishScenario: finishScenario,
      defaults: defaults, validateSet: validateSet, solve: solve, dvOf: dvOf, capability: capability, sweep: sweep, compute: compute, apollo17Compare: apollo17Compare,
      makeHandoff: makeHandoff, parseHandoff: parseHandoff, firstDiff: firstDiff, W: W,
    };
  }
  return { create: create, DEG: DEG };
});
