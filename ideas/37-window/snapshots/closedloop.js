/* Closed Loop: ascent guidance to a chosen orbit. Idea 36 of the Aster Idea Bank, module 6 of "The Long Way Round".
 *
 * Takes idea 35's ascent (its handoff, or idea 34's vehicle) and flies the upper stages to a target orbit with the
 * Space Shuttle's Unified Powered Flight Guidance (Brand, Brown and Higgins, 1973; snapshots/upfg-1973.txt), a
 * linear-tangent law that re-solves itself every guidance cycle; sets it beside open-loop pitch programmes (idea 35's
 * linear programme, and the guided flight's own attitude history replayed on a clock); and flies both through Monte
 * Carlo dispersions of thrust, flow, propellant, dry mass and air density sized from Apollo 17's flight report.
 *
 * A pure kernel: no DOM, no network. Idea 35's kernel (snapshots/ascent.js, unmodified) flies the first stage, supplies
 * the integrator, the equations of motion, the atmosphere, the orbit and the vehicle import; what is new here:
 *
 *   upper     the upper-stage flight loop (idea 35's fly() loop, re-walked so that a guidance cycle can change the
 *             thrust direction and a guided cutoff can end a burn early): staging drops, coasts, shed mass, jettisons and
 *             engine cutoffs on the burn clock, RK4 steps landing on every event. With idea 35's own steering it
 *             reproduces idea 35's fly() to round-off (a test).
 *   steering  a commanded inertial thrust direction u is held through each cycle by idea 35's 'linear' steering mode in
 *             the plane through Earth's centre containing r and u, its pitch turned down at the rate the local
 *             horizontal turns, so u stays fixed in inertial space to first order.
 *   guidance  UPFG standard ascent (mode 1): time-to-go from the rocket equation over the remaining phases, the thrust
 *             integrals L J S Q H P, the turning rate with a free downrange position, the thrust-rotation biases, gravity
 *             from the special coasting trajectory (its Kepler step is idea 35's integrator coasting), the desired
 *             cutoff state from a target radius, speed, flight-path angle and plane. The guidance flies a nominal model
 *             of the vehicle (idea 34's ledger) and senses only the current thrust acceleration and its velocity change.
 *   cutoff    the guided burn ends when the orbital energy reaches the target's (a velocity cutoff, as the Saturn V's
 *             S-IVB did), the last cycles' steering frozen; or when its propellant runs out.
 *   scatter   Monte Carlo: per stage thrust-and-flow and specific impulse, per stage propellant and dry mass, and air
 *             density, normal draws from a seeded generator; the same draws fly the closed loop and the open loop.
 *
 * Frame and time as idea 35: Earth-centred inertial fixed at liftoff (z the spin axis, x through the launch meridian at
 * liftoff), seconds from liftoff, no epoch. SI units inside (m, s, kg, N, rad); degrees only at the edges.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClosedLoop = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEG = Math.PI / 180;

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
  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    var i = 1; while (xs[i] < x) i++;
    return ys[i - 1] + (x - xs[i - 1]) / (xs[i] - xs[i - 1]) * (ys[i] - ys[i - 1]);
  }
  /** mulberry32: a small seeded generator (public-domain idiom), so a Monte Carlo run is reproducible from its seed. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** Standard normal draws by Box-Muller from a uniform generator. */
  function normals(u) { var spare = null; return function () { if (spare != null) { var s = spare; spare = null; return s; } var a = 0; while (a <= 1e-300) a = u(); var b = u(); var m = Math.sqrt(-2 * Math.log(a)); spare = m * Math.sin(2 * Math.PI * b); return m * Math.cos(2 * Math.PI * b); }; }
  function stats(xs) {
    var n = xs.length; if (!n) return { n: 0 };
    var m = 0; xs.forEach(function (x) { m += x; }); m /= n;
    var v = 0; xs.forEach(function (x) { v += (x - m) * (x - m); });
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var q = function (p) { var i = p * (n - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
    return { n: n, mean: m, sd: n > 1 ? Math.sqrt(v / (n - 1)) : 0, min: s[0], max: s[n - 1], p01: q(0.01), p50: q(0.5), p99: q(0.99) };
  }

  function create(deps) {
    var A = deps.A, S = deps.S, EARTH = deps.earth, T512 = deps.trajectory, G512 = deps.guidance512, PARK = deps.parking;
    var K = A.constants, MU = K.MU, RE = K.RE, OMEGA = K.OMEGA, ATM_TOP = K.ATM_TOP, NY = K.NY;
    var LBF = deps.lbf, LBM = deps.lbm; // unit definitions, used only to restate the report's lbf and lbm figures

    // ================================================================== target orbit and plane
    /**
     * The target: insertion at perigee (flight-path angle 0) of an orbit with the given perigee and apogee heights above
     * the sphere, in the plane with the given inclination that contains the launch pad at liftoff, on the branch whose
     * inertial heading at the pad points north or south of east/west. Returns {rd, vd, gammaD, n (orbit normal), iy (=
     * -n, UPFG's sense), ...} or {refusal}.
     */
    function targetOrbit(spec, latDeg) {
      var hp = spec.perigeeAlt, ha = spec.apogeeAlt, inc = spec.inclinationDeg, br = spec.branch === 'south' ? 'south' : 'north';
      if (!(num(hp) && num(ha) && num(inc))) return { refusal: refusal('invalid_input', 'The target needs a perigee height, an apogee height and an inclination, as numbers.', 'Three numbers.', { applies_to: 'target' }) };
      if (!(hp > ATM_TOP)) return { refusal: refusal('out_of_envelope', 'A target perigee of ' + fmt(hp / 1000, 4) + ' km is inside the atmosphere this chain models (below ' + fmt(ATM_TOP / 1000, 3) + ' km): it would not stay up.', 'A perigee above ' + fmt(ATM_TOP / 1000, 3) + ' km.', { applies_to: 'target' }) };
      if (!(ha >= hp)) return { refusal: refusal('invalid_input', 'The apogee height must be at least the perigee height.', 'An apogee at or above the perigee.', { applies_to: 'target' }) };
      if (!(ha < 1e9)) return { refusal: refusal('out_of_envelope', 'An apogee of ' + fmt(ha / 1000, 4) + ' km is a departure, not a parking orbit.', 'A parking orbit; the departure burn is module 38\'s.', { applies_to: 'target' }) };
      if (!(inc >= 0 && inc <= 180)) return { refusal: refusal('invalid_input', 'Inclination must be between 0 and 180 degrees.', 'An inclination.', { applies_to: 'target' }) };
      var phi = latDeg * DEG, sb = Math.cos(inc * DEG) / Math.cos(phi);
      if (Math.abs(sb) > 1 + 1e-12) return { refusal: refusal('out_of_envelope', 'No plane of inclination ' + fmt(inc, 4) + ' deg passes over a launch site at ' + fmt(latDeg, 4) + ' deg latitude: an orbit cannot be inclined less than the latitude it starts from (or more than 180 deg minus it) without a plane change.', 'An inclination between ' + fmt(Math.abs(latDeg), 4) + ' and ' + fmt(180 - Math.abs(latDeg), 4) + ' deg, or a dogleg (not modelled here).', { applies_to: 'target' }) };
      sb = Math.max(-1, Math.min(1, sb));
      var bN = Math.asin(sb), beta = br === 'north' ? bN : Math.PI - bN; // inertial azimuth at the pad, from north toward east
      var r0 = [RE * Math.cos(phi), 0, RE * Math.sin(phi)], up = unit(r0), east = [0, 1, 0], north = cross(up, east);
      var d0 = add(scale(north, Math.cos(beta)), scale(east, Math.sin(beta)));
      var n = unit(cross(r0, d0));
      var rp = RE + hp, ra = RE + ha, a = (rp + ra) / 2, e = (ra - rp) / (ra + rp), vd = Math.sqrt(MU * (2 / rp - 1 / a));
      // the Earth-relative azimuth that heading needs at the pad, if the vehicle were already at speed vd there
      var vE = OMEGA * RE * Math.cos(phi), azGround = Math.atan2(vd * Math.sin(beta) - vE, vd * Math.cos(beta)) / DEG;
      return { rd: rp, vd: vd, gammaD: 0, n: n, iy: scale(n, -1), a: a, e: e, energy: -MU / (2 * a), perigeeAlt: hp, apogeeAlt: ha, inclinationDeg: inc, branch: br,
        inertialAzimuthDeg: ((beta / DEG) + 360) % 360, groundAzimuthDeg: (azGround + 360) % 360, spec: clone(spec) };
    }

    // ================================================================== the upper-stage programme
    /** Upper burns flown in the ascent (idea 35's ascentBurns, from the second stage on), with the propellant each may
     * use: its own, or, for the last one when guided, the whole stage's (the later burns' propellant is what is left for
     * them). Each: {si, bi, P, Pown, later: [{bi, P, shed}], coast (before ignition, s), k (flow scale)}. */
    function upperBurns(veh, plan, guided) {
      var flown = A.ascentBurns(veh).flown.filter(function (f) { return f.si > 0; });
      return flown.map(function (f, j) {
        var s = veh.stages[f.si], b = s.burns[f.bi], last = j === flown.length - 1, later = [];
        if (last) for (var q = f.bi + 1; q < s.burns.length; q++) later.push({ bi: q, P: s.burns[q].propellant, shed: s.burns[q].shed || 0 });
        var P = b.propellant + (guided && last ? later.reduce(function (x, y) { return x + y.P; }, 0) : 0);
        return { si: f.si, bi: f.bi, P: P, Pown: b.propellant, later: later, last: last, coast: f.bi === 0 ? (plan.stagingCoast[f.si - 1] || 0) : 0, k: plan.flowScale[f.si] || 1 };
      });
    }
    /** The guidance's model of the vehicle: constant-thrust phases between events on each burn's clock, from idea 34's
     * ledger masses (mIgnition after shed) with the plan's flow scale. Each: {ub (index into upperBurns), t0, t1 (burn
     * clock), m0, n, F (vacuum, all engines), mdot, ve, coastBefore}. The last burn's last phase runs to its usable
     * propellant. */
    function guidancePhases(veh, engines, plan, ledger, ubs) {
      var out = [];
      ubs.forEach(function (u, j) {
        var s = veh.stages[u.si], b = s.burns[u.bi], e = engines[s.engine], lb = ledger.stages[u.si].burns[u.bi];
        var F1 = e.thrustVac * u.k, md1 = e.mdot * u.k, n = s.count, m = lb.mIgnition, t = 0, burned = 0;
        var ev = [];
        (b.jettisons || []).forEach(function (x) { ev.push({ t: x.t, mass: x.mass }); });
        (b.engineOut || []).forEach(function (x) { ev.push({ t: x.t, out: x.count }); });
        ev.sort(function (a, c) { return a.t - c.t; });
        var first = true;
        for (var q = 0; q <= ev.length; q++) {
          var tEnd = t + (u.P - burned) / (n * md1);
          var stop = q < ev.length && ev[q].t < tEnd - 1e-9 ? ev[q].t : tEnd;
          var atEvent = stop < tEnd - 1e-9;
          if (stop > t + 1e-9) {
            out.push({ ub: j, t0: t, t1: stop, m0: m, n: n, F: n * F1, mdot: n * md1, ve: F1 / md1, coastBefore: first ? u.coast : 0, endsAtEvent: atEvent, drop: 0, out: 0 });
            first = false;
          }
          burned += (stop - t) * n * md1; m -= (stop - t) * n * md1; t = stop;
          if (!atEvent) break;
          if (ev[q].mass) m -= ev[q].mass; if (ev[q].out) n -= ev[q].out;
          if (out.length && out[out.length - 1].ub === j) { out[out.length - 1].drop += ev[q].mass || 0; out[out.length - 1].out += ev[q].out || 0; }
        }
      });
      return out;
    }

    // ================================================================== UPFG (snapshots/upfg-1973.txt)
    /** Kepler routine: a coast in vacuum by idea 35's integrator (point-mass gravity, Aster GM), steps of at most 30 s. */
    var COAST = { omega: 0, uniformG: false, drag: false, dragCurve: 'forebody', dragScale: 0, Sref: 0, np: [0, 0, 1], engines: 0, Fvac: 0, mdot: 0, Ae: 0, steer: 'vertical' };
    function kepler(r, v, T, maxStep) {
      if (!(T > 0)) return { r: r.slice(), v: v.slice() };
      var nst = Math.max(1, Math.ceil(T / (maxStep || 30)));
      var y = [r[0], r[1], r[2], v[0], v[1], v[2], 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var res = A.integrate(0, y, T, COAST, T / nst * (1 + 1e-12));
      return { r: [res.y[0], res.y[1], res.y[2]], v: [res.y[3], res.y[4], res.y[5]] };
    }
    /** Time-to-go over the phases for a velocity-to-be-gained of magnitude Lneed (UPFG 4.3), and the thrust integrals
     * (4.4) over it. phases: [{tb (s available), tau (s), ve (m/s), coastBefore (s)}], current first. Returns
     * {tgo, L, J, S, Q, H, P, last, tb[], short}. The integrals use moments about each phase start shifted to the
     * horizon (equal to UPFG's two-step accumulation; a test checks both against quadrature). */
    function thrustIntegrals(phases, Lneed) {
      var Lacc = 0, t = 0, tbs = [], last = -1, short = 0;
      for (var i = 0; i < phases.length; i++) {
        var p = phases[i]; t += p.coastBefore || 0;
        var Li = -p.ve * Math.log(1 - p.tb / p.tau);
        if (Lacc + Li >= Lneed) { var tb = p.tau * (1 - Math.exp(-(Lneed - Lacc) / p.ve)); tbs.push(tb); t += tb; Lacc = Lneed; last = i; break; }
        tbs.push(p.tb); t += p.tb; Lacc += Li; last = i;
      }
      if (Lacc < Lneed - 1e-9) short = Lneed - Lacc;
      var T = t, L = 0, J = 0, H = 0, M3 = 0; t = 0;
      for (var k = 0; k <= last; k++) {
        var ph = phases[k], b = tbs[k], tau = ph.tau, ve = ph.ve; t += ph.coastBefore || 0;
        var l = -ve * Math.log(1 - b / tau), j1 = l * tau - ve * b, h2 = j1 * tau - ve * b * b / 2, m3 = h2 * tau - ve * b * b * b / 3;
        L += l; J += t * l + j1; H += t * t * l + 2 * t * j1 + h2; M3 += t * t * t * l + 3 * t * t * j1 + 3 * t * h2 + m3;
        t += b;
      }
      return { tgo: T, L: L, J: J, H: H, S: T * L - J, Q: T * J - H, P: T * H - M3, last: last, tb: tbs, short: short };
    }
    /** One UPFG pass (Blocks 3 to 8) on guidance state G at position r, velocity v. Mutates G; returns the command. */
    function upfgPass(G, r, v, phases, tgt) {
      var lam = unit(G.vgo), I = thrustIntegrals(phases, norm(G.vgo)), tgo = I.tgo;
      if (!(tgo > 0) || !num(I.L) || I.L <= 0) return { ok: false, why: 'no thrust left to steer with' };
      var L = I.L, J = I.J, S = I.S, Q = I.Q, H = I.H, P = I.P;
      // Block 5: turning rate
      if (G.tgoPrev > 0) G.rgrav = scale(G.rgrav, (tgo / G.tgoPrev) * (tgo / G.tgoPrev));
      var rgo = sub(G.rd, add(add(r, scale(v, tgo)), G.rgrav));
      var iz = unit(cross(G.rd, tgt.iy));
      var rgoxy = sub(rgo, scale(iz, dot(iz, rgo)));
      var rgoz = (S - dot(lam, rgoxy)) / dot(lam, iz);
      rgo = add(add(rgoxy, scale(iz, rgoz)), G.rbias);
      var lamDot = scale(sub(rgo, scale(lam, S)), 1 / (Q - S * J / L));
      var iF = unit(sub(lam, scale(lamDot, J / L)));
      var phi = Math.acos(Math.max(-1, Math.min(1, dot(iF, lam)))), phiDot = -phi * L / J, uld = unit(lamDot);
      var vThrust = sub(scale(lam, L - 0.5 * L * phi * phi - J * phi * phiDot - 0.5 * H * phiDot * phiDot), scale(uld, L * phi + J * phiDot));
      var rThrust = sub(scale(lam, S - 0.5 * S * phi * phi - Q * phi * phiDot - 0.5 * P * phiDot * phiDot), scale(uld, S * phi + Q * phiDot));
      var vbias = sub(G.vgo, vThrust); G.rbias = sub(rgo, rThrust);
      // Block 7: gravity over the special coasting trajectory
      var rc1 = sub(sub(r, scale(rThrust, 0.1)), scale(vThrust, tgo / 30)), vc1 = sub(add(v, scale(rThrust, 1.2 / tgo)), scale(vThrust, 0.1));
      var kc = kepler(rc1, vc1, tgo);
      var vgrav = sub(kc.v, vc1); G.rgrav = sub(sub(kc.r, rc1), scale(vc1, tgo));
      // Block 8: desired state (standard ascent); the projection onto the target plane is this module's addition
      var rp = add(add(add(r, scale(v, tgo)), G.rgrav), rThrust);
      rp = sub(rp, scale(tgt.iy, dot(rp, tgt.iy)));
      G.rd = scale(unit(rp), tgt.rd);
      var ix = unit(G.rd), izd = cross(ix, tgt.iy);
      var vd = add(scale(ix, tgt.vd * Math.sin(tgt.gammaD)), scale(izd, tgt.vd * Math.cos(tgt.gammaD)));
      G.vgo = add(sub(sub(vd, v), vgrav), vbias);
      var dt = G.tgoPrev > 0 ? Math.abs(tgo - G.tgoPrev) : Infinity;
      G.tgoPrev = tgo; G.lambda = lam; G.lambdaDot = lamDot; G.JL = J / L; G.iF = iF; G.tgo = tgo; G.short = I.short; G.lastPhase = I.last;
      return { ok: num(iF[0]) && num(tgo), iF: iF, tgo: tgo, dtgo: dt, short: I.short };
    }
    /** Prethrust: a first guess (the target speed along the plane's downrange direction from here, gravity as half g
     * tgo^2), then UPFG passes until time-to-go settles (at most 60). */
    function upfgInit(r, v, phases, tgt) {
      var rdir = unit(sub(r, scale(tgt.iy, dot(r, tgt.iy))));
      var G = { rd: scale(rdir, tgt.rd), rbias: [0, 0, 0], rgrav: [0, 0, 0], tgoPrev: 0, vgo: null };
      var iz = cross(rdir, tgt.iy);
      G.vgo = sub(scale(iz, tgt.vd), v);
      var I0 = thrustIntegrals(phases, norm(G.vgo));
      G.rgrav = scale(r, -0.5 * MU / Math.pow(norm(r), 3) * I0.tgo * I0.tgo); G.tgoPrev = I0.tgo;
      var c = null, it;
      for (it = 0; it < 60; it++) { c = upfgPass(G, r, v, phases, tgt); if (!c.ok) break; if (it > 2 && c.dtgo < 1e-3) break; }
      G.initIterations = it < 60 ? it + 1 : 60; G.converged = !!(c && c.ok && c.dtgo < 1e-2);
      return G;
    }

    // ================================================================== steering through a cycle
    /** Idea 35's 'linear' steering context that points the thrust along inertial unit vector u at state (r, v) and keeps
     * it there to first order over dt: the plane through Earth's centre containing r and u, the pitch above the local
     * horizontal in it, turned down by the angle the local vertical sweeps in that plane. */
    function holdContext(u, r, v, t, dt, npFallback) {
      var np = cross(r, u), nn = norm(np);
      np = nn > 1e-9 * norm(r) ? scale(np, 1 / nn) : npFallback;
      var rh = unit(r), down = cross(np, rh), p0 = Math.asin(Math.max(-1, Math.min(1, dot(u, rh))));
      var turn = dot(v, down) / norm(r) * dt;
      return { steer: 'linear', np: np, pitch0: p0, pitch1: p0 - turn, tu0: t, tu1: t + dt, pitch: p0 };
    }

    // ================================================================== the flight
    /**
     * Fly the vehicle: the first stage by idea 35's fly() (open loop through the air, unchanged), then the upper stages
     * by this module's loop under a steering law:
     *   law.mode 'maxq'    idea 35's upper-stage programme from plan.upper (reproduces idea 35's fly() exactly)
     *   law.mode 'upfg'    guidance to target tgt, starting law.startAfter s after first-stage cutoff (attitude held from
     *                      that cutoff until then), every law.cycle s
     *   law.mode 'replay'  a recorded command history law.commands [{t, u}] held on the clock, cutoff at law.cutoffT
     * opts: {samples (default true)}. Returns {ok, refusals, stage1, stageEnds, final, orbit, losses, commands, ...}.
     */
    function flyClosed(veh, engines, plan, law, tgt, opts, nominal) {
      opts = opts || {};
      var keep = opts.samples !== false;
      // the guidance settings (they also arrive in imported handoffs): a cycle the page offers, a start that is not before
      // first-stage cutoff (review: an imported cycle of -1 s flew a garbage orbit and one of 0.01 s took seconds)
      if (law.mode === 'upfg') {
        if (!(num(law.cycle) && law.cycle >= 0.5 && law.cycle <= 4)) return { ok: false, refusals: [refusal('invalid_input', 'The guidance cycle must be a number of seconds from 0.5 to 4 (got ' + fmt(law.cycle, 4) + ').', 'A cycle of 0.5, 1, 2 or 4 s.', { applies_to: 'guidance' })] };
        if (!(num(law.startAfter) && law.startAfter >= 0)) return { ok: false, refusals: [refusal('invalid_input', 'Guidance must start zero or more seconds after first-stage cutoff (got ' + fmt(law.startAfter, 4) + ').', 'A start time in seconds after first-stage cutoff.', { applies_to: 'guidance' })] };
      }
      var r1 = opts.stage1 || A.fly(veh, engines, plan, { burns: 1, samples: keep });
      if (!r1.ok) return { ok: false, refusals: r1.refusals, stage1: r1 };
      var stop1 = r1.refusals.filter(function (x) { return x.applies_to !== 'orbit'; });
      if (stop1.length) return { ok: false, refusals: stop1, stage1: r1 };
      if (veh.stages.length < 2) return { ok: false, refusals: [refusal('invalid_input', 'A one-stage vehicle has no upper stage to guide: this module guides the stages above the atmosphere.', 'A stack with an upper stage.', { applies_to: 'vehicle' })], stage1: r1 };
      var ledger = r1.ledger, guided = law.mode === 'upfg' || law.mode === 'replay';
      var ubs = upperBurns(veh, plan, guided);
      var nomV = nominal ? nominal.veh : veh, nomE = nominal ? nominal.engines : engines, nomP = nominal ? nominal.plan : plan;
      var phasesNom = law.mode === 'upfg' ? guidancePhases(nomV, nomE, nomP, nominal ? nominal.ledger : ledger, upperBurns(nomV, nomP, true)) : null;
      var f1 = r1.final, L1 = r1.losses, LR1 = r1.lossesRel;
      var y = [f1.r[0], f1.r[1], f1.r[2], f1.v[0], f1.v[1], f1.v[2], f1.mass, L1.ideal, L1.pressure, L1.drag, L1.gravity, L1.steering, L1.dragOutsideData, LR1.gravity, LR1.steering, LR1.centrifugal, LR1.drag];
      var t = r1.t, pad = A.padState(plan.site.latitudeDeg, plan.rotation !== false);
      var base = { omega: plan.rotation !== false ? OMEGA : 0, uniformG: plan.gravity === 'uniform', drag: plan.drag !== 'none' && plan.dragScale > 0, dragCurve: plan.drag, dragScale: plan.dragScale, Sref: Math.PI * plan.diameter * plan.diameter / 4 };
      base.np = A.launchPlane(pad.r, plan.azimuthDeg * DEG);
      var spins = 0, atGuidance = null, segLog = [], samples = [], events = [], stageEnds = [r1.stageEnds[0]], commands = [], cycles = [], warnings = (r1.warnings || []).slice();
      var crashed = null, reentry = null, sep = null, above = r1.final.altitude >= ATM_TOP, carried = 0;
      var stage1End = r1.t, tgEnd = null, h1 = r1.final.altitude;
      // the jettisons the first burn did not reach ride to separation (idea 34's rule, as idea 35 applies it)
      (veh.stages[0].burns[0].jettisons || []).forEach(function (j) { if (j.t > r1.stageEnds[0].burnTime + 1e-9) carried += j.mass; });
      // first-stage thrust direction at cutoff (the gravity turn: Earth-relative velocity in the launch plane), held after
      var vrel1 = [f1.v[0] + base.omega * f1.r[1], f1.v[1] - base.omega * f1.r[0], f1.v[2]];
      var uHold = unit(sub(vrel1, scale(base.np, dot(vrel1, base.np))));
      var tGuide = law.mode === 'upfg' ? stage1End + law.startAfter : Infinity, cyc = law.cycle || 2;
      var outOfReach = null, G = null, terminal = false, gFail = null, lastU = uHold, lastCmdT = -Infinity, cutoffAt = law.mode === 'replay' ? law.cutoffT : null, vPrev = null, rPrev = null, tPrev = null;
      var maxqCtx = null;
      if (law.mode === 'maxq') {
        var up = plan.upper, T0u = null;
        maxqCtx = function (tt) {
          if (T0u == null) { T0u = tt; var Tsum = 0; ubs.forEach(function (u2, j2) { Tsum += ledger.stages[u2.si].burns[u2.bi].time / u2.k; if (j2 > 0 && u2.bi === 0) Tsum += u2.coast; }); maxqCtx.tu1 = tt + Tsum; }
          var mode = up.mode === 'hold' ? 'pitch' : up.mode;
          return { steer: mode, np: base.np, pitch: (up.startDeg || 0) * DEG, pitch0: (up.startDeg || 0) * DEG, pitch1: (up.endDeg || 0) * DEG, tu0: T0u, tu1: maxqCtx.tu1 };
        };
      }
      function gAt(r) { var rn = norm(r); return scale(r, -MU / (rn * rn * rn)); }
      var sepNow = null; // {e, si} while an upper burn is lit: the nozzle-separation check after every step, as idea 35's
      function record(tt, yy, info, si, extra) {
        var h = info.h;
        if (sepNow && info.F > 0 && !sep && info.P > interp(sepNow.e.deckVac.throttle, sepNow.e.deckVac.separation_onset_pa, 1)) sep = { t: tt, h: h, P: info.P, onset: interp(sepNow.e.deckVac.throttle, sepNow.e.deckVac.separation_onset_pa, 1), stage: si };
        if (h < -1 && !crashed) crashed = { t: tt, stage: si };
        // falling back: into the atmosphere from above it (idea 35's check), or, for the guided and replayed flights, 10 km
        // below the first-stage cutoff (idea 35's own programme keeps idea 35's checks, so that it reproduces fly())
        if (h >= ATM_TOP) above = true; else if ((above || (law.mode !== 'maxq' && h < h1 - 10e3)) && !reentry) reentry = { t: tt, stage: si };
        if (!keep) return;
        var r = [yy[0], yy[1], yy[2]], v = [yy[3], yy[4], yy[5]], vn = norm(v), rh = unit(r), u = info.u;
        var s = { t: tt, h: h, v: vn, fpa: Math.asin(Math.max(-1, Math.min(1, dot(v, rh) / vn))) / DEG, m: yy[6], stage: si, F: info.F,
          pitch: info.F > 0 ? Math.asin(Math.max(-1, Math.min(1, dot(u, rh)))) / DEG : null, yaw: info.F > 0 && tgt ? Math.asin(Math.max(-1, Math.min(1, -dot(u, tgt.iy)))) / DEG : null };
        if (extra) for (var k in extra) s[k] = extra[k];
        samples.push(s);
      }
      var tmp = new Array(NY);
      var curStage = 0;
      var stopsAt = function () { return crashed || sep || (reentry && law.mode !== 'maxq'); }; // idea 35 flies on through a re-entry and reports it at the end
      for (var j = 0; j < ubs.length && !stopsAt(); j++) {
        var u = ubs[j], si = u.si, s = veh.stages[si], b = s.burns[u.bi], e = engines[s.engine];
        if (si !== curStage) {
          var sp = veh.stages[curStage];
          y[6] -= sp.dry + sp.remaining + carried; carried = 0;
          if (u.coast > 0) {
            var cc = Object.assign({}, base, { engines: 0, mdot: 0, Fvac: 0, Ae: 0, steer: 'gravity' });
            if (opts.recordContexts) segLog.push({ t0: t, t1: t + u.coast, m0: y[6], n: 0, Fvac: 0, mdot: 0, Ae: 0, steer: 'coast', stage: si });
            var rr = A.integrate(t, y, t + u.coast, cc, plan.dt.atmosphere, function (tt, yy, inf) { record(tt, yy, inf, si); });
            events.push({ kind: 'coast', stage: si, t0: t, t1: rr.t }); t = rr.t; y = rr.y;
            if (stopsAt()) break;
          }
          curStage = si;
        }
        y[6] -= b.shed || 0;
        var tB0 = t, n = s.count, P = u.P, burned = 0;
        var F1 = interp(e.deckVac.throttle, e.deckVac.thrust_vac, 1) * u.k, chamber1 = e.deckVac.mass_flow_chamber[e.deckVac.throttle.indexOf(1)];
        var md1 = e.mdot * interp(e.deckVac.throttle, e.deckVac.mass_flow_chamber, 1) / chamber1 * u.k;
        var bps = [];
        (b.jettisons || []).forEach(function (x) { bps.push({ t: x.t, kind: 'jettison', mass: x.mass, label: x.label }); });
        (b.engineOut || []).forEach(function (x) { bps.push({ t: x.t, kind: 'engine-out', count: x.count, label: x.label }); });
        bps.sort(function (a1, a2) { return a1.t - a2.t; });
        var applied = [], endedBy = null;
        while (burned < P * (1 - 1e-12)) {
          var tc = t - tB0;
          for (var q0 = 0; q0 < bps.length; q0++) if (applied.indexOf(q0) < 0 && bps[q0].t <= tc + 1e-9) {
            var bp = bps[q0]; applied.push(q0);
            if (bp.kind === 'jettison') { y[6] -= bp.mass; events.push({ kind: 'jettison', stage: si, t: t, label: bp.label, mass: bp.mass }); }
            else { n -= bp.count; events.push({ kind: 'engine-out', stage: si, t: t, label: bp.label }); }
          }
          var c = Object.assign({}, base, { engines: n, Fvac: n * F1, mdot: n * md1, Ae: n * e.exitArea });
          // separation check (idea 33's criterion via idea 35): ambient pressure against the nozzle's onset at 100 %
          var hNow = norm([y[0], y[1], y[2]]) - RE, Pa = A.atmosphere(hNow).P, onset = interp(e.deckVac.throttle, e.deckVac.separation_onset_pa, 1);
          if (Pa > onset) { sep = { t: t, h: hNow, P: Pa, onset: onset, stage: si }; break; }
          // steering for this stretch
          var tNext = Infinity, stopFn = null;
          if (law.mode === 'maxq') Object.assign(c, maxqCtx(t));
          else {
            var r = [y[0], y[1], y[2]], v = [y[3], y[4], y[5]];
            if (law.mode === 'upfg' && t >= tGuide - 1e-9 && !terminal && t >= lastCmdT + cyc - 1e-9) {
              var info0 = A.deriv(t, y, c, tmp), aMeas = (n * F1 - info0.P * n * e.exitArea) / y[6];
              var ph = currentPhases(phasesNom, j, tc, aMeas, { m: y[6], Pleft: P - burned, n: n });
              var dvS = vPrev ? sub(sub(v, vPrev), scale(add(gAt(rPrev), gAt(r)), 0.5 * (t - tPrev))) : null;
              var cmd;
              if (!G) {
                atGuidance = { t: t, r: r, v: v, mass: y[6], burnClock: tc, stage: si };
                G = upfgInit(r, v, ph, tgt); cmd = { ok: G.converged, iF: G.iF, tgo: G.tgo, short: G.short, why: 'its first call did not settle in ' + G.initIterations + ' passes' };
                var from = fmt((norm(r) - RE) / 1000, 4) + ' km, ' + fmt(norm(v), 5) + ' m/s, flight-path angle ' + fmt(Math.asin(Math.max(-1, Math.min(1, dot(v, unit(r)) / norm(v)))) / DEG, 3) + ' deg';
                // review: a first call that does not settle used to hold the attitude silently and report whatever followed
                // (a fall-back) as if guidance had flown it; the nominal flight is now refused here, with the reason
                if (!G.converged && !opts.flyShort) return { ok: false, stage1: r1, guidance: G, warnings: warnings, samples: samples, partial: true, stageEnds: stageEnds, commands: commands, cycles: cycles,
                  refusals: [refusal('out_of_envelope', 'Guidance cannot steer to this target: when it starts (' + fmt(t, 4) + ' s; ' + from + ') UPFG\'s first call does not settle in ' + G.initIterations + ' passes. Either the target is out of this vehicle\'s reach from there, or it is outside what UPFG\'s small-angle thrust-rotation terms can steer to (README, the envelope); this module cannot tell which, and flies nothing past this point.', 'A first-stage cutoff nearer the target\'s path (another kick), a target nearer the vehicle\'s path, or a shorter guidance cycle.', { applies_to: 'guidance', t: t })] };
                if (G.converged && G.short > 1 && !opts.flyShort) return { ok: false, stage1: r1, guidance: G, refusals: [refusal('out_of_envelope', 'Out of reach, by guidance\'s own estimate: when it starts (' + fmt(t, 4) + ' s; ' + from + ') UPFG puts the velocity still to gain at ' + fmt(norm(G.vgo), 5) + ' m/s and the upper stages carry ' + fmt(norm(G.vgo) - G.short, 5) + ' m/s: ' + fmt(G.short, 4) + ' m/s short of this target. This is UPFG\'s prediction, not an optimisation: outside its small-angle envelope it can call a reachable target out of reach (README).', 'A lower or less inclined target, more upper-stage propellant, or a lighter payload.', { applies_to: 'target', short_m_s: G.short })] };
              } else { G.vgo = sub(G.vgo, dvS); cmd = upfgPass(G, r, v, ph, tgt); }
              if (!cmd.ok || !num(cmd.tgo)) { gFail = { t: t, why: cmd.why || 'no solution' }; warnings.push({ applies_to: 'guidance', reason: 'UPFG failed at ' + fmt(t, 5) + ' s: ' + gFail.why + '; attitude held.' }); terminal = true; }
              else if (cmd.short > 1) {
                // out of reach in flight (a dispersed vehicle): hold the attitude and burn to depletion; a real vehicle
                // would change target or abort (not modelled)
                lastU = cmd.iF; lastCmdT = t; terminal = true; outOfReach = { t: t, short: cmd.short };
                cycles.push({ t: t, tgo: cmd.tgo, vgo: norm(G.vgo), short: cmd.short, phase: j });
                warnings.push({ applies_to: 'guidance', reason: 'At ' + fmt(t, 5) + ' s guidance\'s own estimate put the target ' + fmt(cmd.short, 3) + ' m/s out of reach; attitude held to depletion.' });
              } else {
                lastU = cmd.iF; lastCmdT = t;
                cycles.push({ t: t, tgo: cmd.tgo, vgo: norm(G.vgo), short: cmd.short, phase: j });
                // the last cycles: freeze the steering once the cutoff is under two cycles away and inside this burn
                if (cmd.tgo < 2 * cyc && G.lastPhase < ph.nCur) { terminal = true; tgEnd = t + cmd.tgo; }
              }
              vPrev = v; rPrev = r; tPrev = t;
            } else if (law.mode === 'replay') {
              var cu = null; for (var qi = 0; qi < law.commands.length; qi++) { if (law.commands[qi].t <= t + 1e-9) cu = law.commands[qi]; else break; }
              lastU = cu ? cu.u : uHold;
            }
            if (!commands.length || commands[commands.length - 1].u !== lastU) commands.push({ t: t, u: lastU });
            if (law.mode === 'upfg' && !terminal) tNext = t < tGuide - 1e-9 ? tGuide : lastCmdT + cyc;
            if (law.mode === 'replay') { for (var qj = 0; qj < law.commands.length; qj++) if (law.commands[qj].t > t + 1e-9) { tNext = law.commands[qj].t; break; } }
            var dtHold = Math.min(isFinite(tNext) ? tNext - t : cyc, cyc * 4);
            Object.assign(c, holdContext(lastU, r, v, t, dtHold, base.np));
            if (law.mode === 'upfg' && terminal && !outOfReach) {
              stopFn = function (tt, yy) { var rr2 = norm([yy[0], yy[1], yy[2]]), vv = norm([yy[3], yy[4], yy[5]]); return vv * vv / 2 - MU / rr2 >= tgt.energy ? 'energy' : false; };
            }
          }
          var tOut = (P - burned) / (n * md1), tEnd = t + tOut, isBp = false, kind = 'burnout';
          var nb = null; for (var qq = 0; qq < bps.length; qq++) if (applied.indexOf(qq) < 0 && bps[qq].t > tc + 1e-9) { nb = qq; break; }
          if (nb != null && tB0 + bps[nb].t < tEnd - 1e-9) { tEnd = tB0 + bps[nb].t; isBp = true; kind = 'event'; }
          if (tNext < tEnd - 1e-9) { tEnd = tNext; isBp = false; kind = 'cycle'; }
          if (cutoffAt != null && cutoffAt < tEnd - 1e-9) { tEnd = Math.max(cutoffAt, t); kind = 'timer'; }
          var dtS = hNow < ATM_TOP ? plan.dt.atmosphere : plan.dt.vacuum;
          var sNow = si;
          sepNow = { e: e, si: si };
          var yStart = y.slice(), tStart = t;
          var res = A.integrate(t, y, tEnd, c, dtS, function (tt, yy, inf) { record(tt, yy, inf, sNow); }, stopFn);
          if (opts.recordContexts) segLog.push({ t0: tStart, t1: res.stopped ? null : res.t, m0: yStart[6], n: n, Fvac: c.Fvac, mdot: c.mdot, Ae: c.Ae, steer: c.steer, np: c.np, pitch0: c.pitch0, pitch1: c.pitch1, tu0: c.tu0, tu1: c.tu1, pitch: c.pitch, stage: si });
          sepNow = null;
          if (stopsAt()) { t = res.t; y = res.y; break; }
          if (res.stopped === 'energy') {
            var lo = res.tPrev, hi = res.t, y0s = res.yPrev;
            for (var it = 0; it < 50 && hi - lo > 1e-7; it++) { var mid = (lo + hi) / 2, ym = rkTo(res.tPrev, y0s, mid, c); if (stopFn(mid, ym)) hi = mid; else lo = mid; }
            var yh = rkTo(res.tPrev, y0s, hi, c);
            if (opts.recordContexts) segLog[segLog.length - 1].t1 = hi;
            burned += y[6] - yh[6]; t = hi; y = yh; endedBy = 'guidance'; record(t, y, A.deriv(t, y, c, tmp), si); break;
          }
          burned += y[6] - res.y[6]; t = res.t; y = res.y;
          if (kind === 'timer' && t >= cutoffAt - 1e-9) { endedBy = 'timer'; break; }
          if (++spins > 200000) { warnings.push({ applies_to: 'trajectory', reason: 'The upper-stage loop stopped making progress at ' + fmt(t, 5) + ' s.' }); endedBy = 'stalled'; break; }
          if (kind === 'event') { /* applied at the top of the loop */ }
          else if (kind === 'burnout') { burned = P; endedBy = 'depletion'; }
        }
        bps.forEach(function (bp2, q2) { if (applied.indexOf(q2) < 0 && bp2.kind === 'jettison') carried += bp2.mass; });
        if (stopsAt()) break;
        stageEnds.push({ stage: si, burn: u.bi, label: s.label, tIgnition: tB0, t: t, burnTime: t - tB0, state: A.stateOf(t, y, base.omega), engines: n, endedBy: endedBy || 'depletion',
          propellantUsed: burned, propellantAvailable: P, propellantLeft: Math.max(0, P - burned), propellantOwn: u.Pown, later: u.later });
        events.push({ kind: 'cutoff', stage: si, burn: u.bi, t: t, label: s.label + (s.burns.length > 1 ? ' burn ' + (u.bi + 1) : '') + ' cutoff', endedBy: endedBy });
        if (endedBy === 'guidance' || endedBy === 'timer') break; // the stages above (if any) are not lit
      }
      var refusals = [];
      if (sep) refusals.push(refusal('out_of_envelope', 'Stage ' + (sep.stage + 1) + '\'s nozzle separates at ' + fmt(sep.h / 1000, 3) + ' km (' + fmt(sep.t, 4) + ' s): ambient pressure ' + fmt(sep.P, 4) + ' Pa is above its separation onset ' + fmt(sep.onset, 4) + ' Pa (idea 33\'s criterion).', 'Light the stage higher.', { applies_to: 'stage ' + (sep.stage + 1) }));
      if (crashed) refusals.push(refusal('out_of_envelope', 'The vehicle comes back to the ground at ' + fmt(crashed.t, 4) + ' s (stage ' + (crashed.stage + 1) + ').', 'More thrust, a shorter staging coast, or a target the vehicle can reach.', { applies_to: 'trajectory' }));
      if (reentry && law.mode !== 'maxq') refusals.push(refusal('out_of_envelope', 'The upper stages fall back (below ' + fmt(Math.min(ATM_TOP, h1 - 10e3) / 1000, 3) + ' km at ' + fmt(reentry.t, 4) + ' s, stage ' + (reentry.stage + 1) + '): this steering cannot hold this vehicle up.', 'A steeper first-stage cutoff (a smaller kick), an earlier guidance start, or more upper-stage thrust.', { applies_to: 'trajectory', t: reentry.t }));
      // whatever stopped the flight first is the refusal (a stack that sinks also meets thicker air and the ground)
      var tOf = function (x) { return x.t != null ? x.t : Infinity; };
      if (sep) refusals[refusals.indexOf(refusals.filter(function (x) { return /separates/.test(x.reason); })[0])].t = sep.t;
      if (crashed) refusals.filter(function (x) { return /ground/.test(x.reason); }).forEach(function (x) { x.t = crashed.t; });
      refusals.sort(function (a1, a2) { return tOf(a1) - tOf(a2); });
      if (refusals.length > 1) refusals.length = 1;
      // say what guidance was doing when the flight was lost (review: a held attitude used to read as guidance's flight)
      var gNote = law.mode !== 'upfg' ? '' : !G ? ' Guidance had not started (it was due at ' + fmt(tGuide, 4) + ' s): the attitude at first-stage cutoff was being held.'
        : gFail ? ' Guidance had stopped steering at ' + fmt(gFail.t, 4) + ' s (UPFG: ' + gFail.why + '); the attitude was held from then on.' : '';
      if (refusals.length) { refusals[0].reason += gNote; return { ok: false, refusals: refusals, stage1: r1, samples: samples, partial: true, stageEnds: stageEnds, commands: commands, cycles: cycles, warnings: warnings }; }
      if (law.mode === 'upfg' && !G) return { ok: false, stage1: r1, samples: samples, partial: true, stageEnds: stageEnds, commands: commands, cycles: cycles, warnings: warnings,
        refusals: [refusal('invalid_input', 'Guidance never starts: it is set for ' + fmt(law.startAfter, 4) + ' s after first-stage cutoff (' + fmt(tGuide, 4) + ' s), but the upper stages have burned out by ' + fmt(t, 4) + ' s. What flew was the first-stage attitude held to burnout, not guidance.', 'A guidance start before the upper stages burn out (AS-512 flew its at 42.9 s; Table 2-2).', { applies_to: 'guidance' })] };
      var fin = A.stateOf(t, y, base.omega), orbit = A.orbitOf([y[0], y[1], y[2]], [y[3], y[4], y[5]]);
      var last = stageEnds[stageEnds.length - 1];
      var out = { ok: true, refusals: [], warnings: warnings, stage1: r1, stageEnds: stageEnds, events: events, samples: samples, commands: commands, cycles: cycles, t: t, final: fin, orbit: orbit,
        losses: { ideal: y[7], pressure: y[8], drag: y[9], gravity: y[10], steering: y[11] }, lossesRel: { ideal: y[7], pressure: y[8], drag: y[16], gravity: y[13], steering: y[14], centrifugal: y[15] },
        segments: opts.recordContexts ? segLog : null, atGuidance: atGuidance, endedBy: last.endedBy, guidanceStart: law.mode === 'upfg' ? tGuide : null, terminalAt: tgEnd, outOfReach: outOfReach, ledger: ledger, ubs: ubs, uHold: uHold, base: base, guided: last };
      out.inOrbit = orbit.bound && orbit.perigeeAlt >= ATM_TOP && !reentry;
      if (reentry) out.refusals.push(refusal('out_of_envelope', 'The trajectory leaves the atmosphere and comes back into it (below ' + fmt(ATM_TOP / 1000, 3) + ' km at ' + fmt(reentry.t, 4) + ' s, stage ' + (reentry.stage + 1) + ').', 'Another programme, or guidance.', { applies_to: 'trajectory' }));
      if (tgt) out.errors = insertionErrors(fin, orbit, tgt);
      if (!orbit.bound) out.refusals.push(refusal('out_of_envelope', 'The cutoff state escapes Earth (C3 ' + fmt(orbit.c3 / 1e6, 4) + ' km^2/s^2).', 'A lower target energy.', { applies_to: 'orbit' }));
      else if (!out.inOrbit) out.refusals.push(refusal('out_of_envelope', 'Not in orbit: perigee ' + fmt(orbit.perigeeAlt / 1000, 4) + ' km, inside the atmosphere' + (last.endedBy === 'depletion' && law.mode === 'upfg' ? ', because the guided stage ran out of propellant before guidance cut it off' + (outOfReach ? ' (guidance\'s own estimate put the target ' + fmt(outOfReach.short, 3) + ' m/s out of reach at ' + fmt(outOfReach.t, 4) + ' s)' : '') + ': either the target is beyond this propellant, or guidance diverged (outside UPFG\'s small-angle envelope a reachable target can end this way; README, the envelope)' : '') + '.' + gNote, law.mode === 'upfg' ? 'More upper-stage propellant, a lower or less inclined target, or a lighter payload.' : 'Closed-loop guidance, or another programme.', { applies_to: 'orbit' }));
      if (law.mode === 'upfg' && last.endedBy === 'depletion' && out.inOrbit) out.refusals.push(refusal('out_of_envelope', 'The guided stage ran out of propellant before it reached the target: the orbit is ' + fmt(orbit.perigeeAlt / 1000, 4) + ' x ' + fmt(orbit.apogeeAlt / 1000, 4) + ' km, not the target.', 'More upper-stage propellant or a lower target.', { applies_to: 'orbit' }));
      return out;
    }
    function rkTo(t0, y0, t1, c) { return A.integrate(t0, y0, t1, c, (t1 - t0) * (1 + 1e-12) + 1e-12).y; }
    /** The guidance's phases from now: the nominal model's, the current one cut to what remains of it on the burn
     * clock, its tau from the sensed thrust acceleration (UPFG: tau = v_ex / a). */
    function currentPhases(nom, ubIndex, tc, aMeas, gauge) {
      // the burn now lit: its remaining stretches between events on the burn clock, from the gauged mass and propellant
      // and the sensed thrust acceleration (flow = m a / v_ex, v_ex nominal); the burns after it: the nominal model
      var out = [], cur = nom.filter(function (p) { return p.ub === ubIndex; });
      out.nCur = 0;
      if (cur.length) {
        var ve = cur[0].ve, m = gauge.m, P = gauge.Pleft, n = gauge.n, t = tc;
        var mdE = aMeas > 0 ? m * aMeas / ve / n : cur[0].mdot / cur[0].n; // per engine
        for (var k = 0; k < cur.length && P > 1e-9; k++) {
          var p = cur[k];
          if (p.endsAtEvent && p.t1 <= t + 1e-9) { continue; }
          var dur = P / (n * mdE);
          if (p.endsAtEvent) dur = Math.min(dur, p.t1 - t);
          var tau = m / (n * mdE);
          out.push({ tb: Math.min(Math.max(dur, 1e-3), tau * (1 - 1e-6)), tau: tau, ve: ve, coastBefore: 0 }); out.nCur++;
          m -= n * mdE * dur; P -= n * mdE * dur; t += dur;
          if (!p.endsAtEvent) break;
          m -= p.drop; n -= p.out;
        }
      }
      nom.forEach(function (p) {
        if (p.ub <= ubIndex) return;
        var tau2 = p.m0 / p.mdot;
        out.push({ tb: Math.min(p.t1 - p.t0, tau2 * (1 - 1e-6)), tau: tau2, ve: p.ve, coastBefore: p.coastBefore });
      });
      return out;
    }
    function insertionErrors(fin, orbit, tgt) {
      var rn = norm(fin.r), vn = fin.speed, n = unit(cross(fin.r, fin.v));
      return { radius: rn - tgt.rd, speed: vn - tgt.vd, fpaDeg: fin.fpaDeg - tgt.gammaD / DEG, inclinationDeg: orbit.inclinationDeg - tgt.inclinationDeg,
        planeDeg: Math.acos(Math.max(-1, Math.min(1, dot(n, tgt.n)))) / DEG, perigee: orbit.perigeeAlt - tgt.perigeeAlt, apogee: orbit.bound ? orbit.apogeeAlt - tgt.apogeeAlt : null,
        semiMajorAxis: orbit.bound ? orbit.a - tgt.a : null };
    }

    // ================================================================== a flight set-up from a handoff
    var T0_512 = A.as512T0();
    function isAS512(veh) { return veh && veh.id === 'AS-512'; }
    /** The target this module opens on: for AS-512, the parking orbit the flight reached (Table 4-4); otherwise a circle
     * at Aster's assumed parking radius in the plane idea 35's launch azimuth gives. */
    function defaultTarget(veh, plan) {
      var az = ((plan.azimuthDeg % 360) + 360) % 360, branch = az > 90 && az < 270 ? 'south' : 'north';
      if (isAS512(veh)) return { perigeeAlt: T512.insertion.perigeeKm * 1000, apogeeAlt: T512.insertion.apogeeKm * 1000, inclinationDeg: T512.insertion.inclination, branch: branch, source: 'AS-512 parking orbit, MPR-SAT-FE-73-1 Table 4-4' };
      var h = PARK.leoParkingRadius_m - RE, phi = plan.site.latitudeDeg * DEG;
      var inc = Math.acos(Math.max(-1, Math.min(1, Math.cos(phi) * Math.sin(az * DEG)))) / DEG;
      return { perigeeAlt: h, apogeeAlt: h, inclinationDeg: inc, branch: branch, source: 'Aster delta-v.ts LEO_PARKING_RADIUS_KM (circular), inclination of the launch azimuth' };
    }
    /** When guidance starts, in seconds after first-stage cutoff: AS-512's IGM began 42.9 s into time base 3 (which
     * starts at S-IC outboard cutoff, Table 2-2 item 36); other vehicles at upper-stage ignition. */
    function defaultGuidance(veh, plan) {
      return isAS512(veh) ? { startAfter: G512.events.igmPhase1FromBase, cycle: 2, startSource: 'Table 2-2 item 36: IGM phase 1 at 204.1 s range time, 42.9 s after S-IC outboard cutoff' }
        : { startAfter: plan.stagingCoast[0] || 0, cycle: 2, startSource: 'at upper-stage ignition (assumed)' };
    }
    /**
     * A flight set-up from a handoff: idea 34's (a vehicle: idea 35's default plan, AS-512 with the F-1 at its
     * flight-average flow, the kick fitted to Table 4-2's S-IC cutoff angle and idea 35's upper programme solved for a
     * level burnout, as idea 35's page opens), idea 35's (its vehicle and plan as exported), or this module's own.
     * Returns {veh, engines, h34, h35, plan, guidance, target, from} or {refusal}.
     */
    function setup(input) {
      var h = input;
      if (typeof input === 'string') { try { h = JSON.parse(input); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 34, 35 or 36.') }; } }
      if (!h || typeof h !== 'object' || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 34 (a vehicle), 35 (an ascent) or 36 (this page).') };
      if (h.from === '36-closed-loop') return parseHandoff(h);
      if (h.from === '35-max-q') {
        var p = A.parseHandoff(h);
        if (p.refusal) return p;
        var plan = clone(p.plan);
        return { veh: p.vehicle, engines: p.engines, h34: p.handoff34, h35: h, plan: plan, guidance: defaultGuidance(p.vehicle, plan), target: defaultTarget(p.vehicle, plan), from: '35-max-q' };
      }
      if (h.from === '34-stack') {
        var v = A.vehicleFromHandoff(h);
        if (v.refusal) return v;
        var pl = A.defaultPlan(v.vehicle);
        if (isAS512(v.vehicle)) {
          pl.flowScale[0] = A.as512FlowScale(v.engines);
          var k = A.solveKick(v.vehicle, v.engines, pl, T512.cutoff.sicOeco.fpa); if (k.refusal) return k;
          pl.kickDeg = k.kickDeg; pl.fitKick = true;
        } else { pl.kickDeg = 1; pl.upper = { mode: 'linear', startDeg: 0, endDeg: 0 }; }
        if (v.vehicle.stages.length > 1) { var li = A.solveInsertion(v.vehicle, v.engines, pl); if (!li.refusal) { pl.upper.mode = pl.upper.mode === 'gravity' ? 'linear' : pl.upper.mode; pl.upper.startDeg = li.pitchDeg; pl.fitInsertion = true; } }
        return { veh: v.vehicle, engines: v.engines, h34: h, h35: null, plan: pl, guidance: defaultGuidance(v.vehicle, pl), target: defaultTarget(v.vehicle, pl), from: '34-stack' };
      }
      if (/^3[123]-/.test(h.from || '')) return { refusal: refusal('insufficient_data', 'A ' + h.from + ' handoff is part of an engine, not a vehicle: guidance needs stages, propellant and masses.', 'Build a stack in idea 34 and fly it in idea 35.') };
      return { refusal: refusal('invalid_input', 'A handoff from ' + (h.from || 'an unknown module') + ' is not something this module flies.', 'A handoff from idea 34, 35 or 36.') };
    }
    /** Fly a set-up both ways: closed loop (UPFG) and idea 35's own open-loop programme (its fly(), unchanged). */
    function run(ctx, opts) {
      opts = opts || {};
      var tgt = targetOrbit(ctx.target, ctx.plan.site.latitudeDeg);
      var out = { target: tgt };
      var maxq = A.fly(ctx.veh, ctx.engines, ctx.plan, { samples: opts.samples !== false });
      out.openLoop = maxq;
      if (tgt.refusal) { out.guided = { ok: false, refusals: [tgt.refusal] }; return out; }
      var r1 = A.fly(ctx.veh, ctx.engines, ctx.plan, { burns: 1, samples: opts.samples !== false });
      out.guided = flyClosed(ctx.veh, ctx.engines, ctx.plan, { mode: 'upfg', startAfter: ctx.guidance.startAfter, cycle: ctx.guidance.cycle }, tgt, { samples: opts.samples !== false, stage1: r1 });
      if (out.guided.ok) out.replay = flyClosed(ctx.veh, ctx.engines, ctx.plan, replayLaw(out.guided), tgt, { samples: false, stage1: r1 });
      return out;
    }
    /** The guided flight's own attitude history as an open-loop programme on the clock, cut off on a timer. */
    function replayLaw(g) { return { mode: 'replay', commands: g.commands, cutoffT: g.t }; }

    // ================================================================== dispersions
    /**
     * The dispersion table: one-sigma fractions per stage (flow: thrust and flow together; isp: thrust at fixed flow;
     * propellant; dry mass) and air density (as a factor on drag). Defaults: how far AS-512 itself strayed from its
     * prediction (MPR-SAT-FE-73-1; snapshots/as512-guidance.js), used as one sigma: assumed, since one flight is one draw.
     * A vehicle with other than three stages takes the S-IC's figures for its first stage, the S-IVB's for its last and
     * the S-II's between.
     */
    function dispersionTable(veh) {
      var Dv = G512.deviations, sv = Dv.sivb;
      var sivbFlow = (sv.loxFlowLbmS[1] + sv.fuelFlowLbmS[1]) / (sv.loxFlowLbmS[0] + sv.fuelFlowLbmS[0]) - 1;
      var by = [
        { flow: Dv.sic.flowPct / 100, isp: Dv.sic.ispPct / 100, propellant: Dv.sic.propellantConsumedPct / 100, src: 'S-IC, section 5.1: consumption rate +0.16 %, Isp +0.14 %, propellant consumed -0.14 %' },
        { flow: Dv.sii.flowPct / 100, isp: Dv.sii.ispPct / 100, propellant: G512.mass.siiIgnitionMassPct / 100, src: 'S-II, section 6.3: flow -0.19 %, Isp +0.05 %; section 16.2: mass at S-II ignition -0.11 % (mostly its LOX load)' },
        { flow: sivbFlow, isp: sv.ispLbfSLbm[3] / 100, propellant: G512.sivbLoad.loxPct / 100, src: 'S-IVB, Table 7-1: LOX + fuel flow ' + fmt(100 * sivbFlow, 3) + ' %, Isp -0.14 %; section 7.9: LOX load +0.027 %' },
      ];
      var rows = [], n = veh.stages.length;
      veh.stages.forEach(function (st, si) {
        var b = by[si === 0 ? 0 : si === n - 1 ? 2 : 1];
        rows.push({ key: 'flow' + si, kind: 'flow', stage: si, label: st.label + ' thrust and flow', sigma: Math.abs(b.flow), source: b.src });
        rows.push({ key: 'isp' + si, kind: 'isp', stage: si, label: st.label + ' specific impulse', sigma: Math.abs(b.isp), source: b.src });
        rows.push({ key: 'prop' + si, kind: 'propellant', stage: si, label: st.label + ' propellant', sigma: Math.abs(b.propellant), source: b.src });
        rows.push({ key: 'dry' + si, kind: 'dry', stage: si, label: st.label + ' dry mass', sigma: G512.mass.dryWithinPct / 100, source: 'Section 16.2: dry weights all within 0.9 % of predicted' });
      });
      rows.push({ key: 'density', kind: 'density', stage: 0, label: 'Air density (drag)', sigma: G512.density.withinPct / 100, source: 'Appendix A.5.3: density within 4 % of the reference atmosphere below 36 km' });
      return rows;
    }
    /** The S-IC burn time's one-sigma from the flow and propellant rows (idea 34's ledger, central differences), and the
     * factor on every sigma that makes three of it MSFC's pre-flight S-IC cutoff band (+5.99/-4.22 s, mean half-width). */
    function msfcScale(ctx, table) {
      var t = function (dk, dp) { var v = clone(ctx.veh); v.stages[0].burns.forEach(function (b) { b.propellant *= 1 + dp; }); var pl = clone(ctx.plan); pl.flowScale[0] *= 1 + dk; var r = A.fly(v, ctx.engines, pl, { burns: 1, samples: false }); return r.stageEnds && r.stageEnds[0] ? r.stageEnds[0].burnTime : NaN; };
      var row = function (k) { return table.filter(function (x) { return x.key === k; })[0]; };
      var sf = row('flow0').sigma, sp = row('prop0').sigma;
      var dk = (t(sf, 0) - t(-sf, 0)) / 2, dp = (t(0, sp) - t(0, -sp)) / 2, s1 = Math.sqrt(dk * dk + dp * dp);
      var band = G512.deviations.sic.oeco3SigmaS, half = (band[0] - band[1]) / 2;
      return { sigma1: s1, band: band, halfWidth: half, scale: half / 3 / s1 };
    }
    /** A dispersed copy of the set-up: z maps table keys to standard-normal draws; every sigma times sigmaScale. */
    function disperse(ctx, table, z, sigmaScale) {
      var veh = clone(ctx.veh), plan = clone(ctx.plan), engines = {};
      for (var k in ctx.engines) engines[k] = ctx.engines[k];
      var f = function (row) { return 1 + (z[row.key] || 0) * row.sigma * (sigmaScale == null ? 1 : sigmaScale); };
      table.forEach(function (row) {
        var x = f(row), st = veh.stages[row.stage];
        if (x === 1) return;
        if (row.kind === 'flow') plan.flowScale[row.stage] = (plan.flowScale[row.stage] || 1) * x;
        else if (row.kind === 'propellant') st.burns.forEach(function (b) { b.propellant *= x; });
        else if (row.kind === 'dry') st.dry *= x;
        else if (row.kind === 'density') plan.dragScale *= x;
        else if (row.kind === 'isp') {
          var e0 = ctx.engines[st.engine], id = st.engine + '#' + row.stage, e = Object.assign({}, e0);
          e.id = id; e.thrustVac = e0.thrustVac * x; e.ispVac = e0.ispVac * x;
          if (e0.thrustSL != null) e.thrustSL = e0.thrustSL + e0.thrustVac * (x - 1);
          if (e0.ispSL != null) e.ispSL = e.thrustSL / e0.mdot;
          e.deckVac = Object.assign({}, e0.deckVac, { thrust_vac: e0.deckVac.thrust_vac.map(function (F) { return F * x; }) });
          engines[id] = e; st.engine = id;
        }
      });
      return { veh: veh, engines: engines, plan: plan };
    }
    function metricsOf(r, tgt) {
      if (!r || !r.ok) return { ok: false, reason: r && r.refusals && r.refusals[0] ? r.refusals[0].reason : 'no flight' };
      var o = r.orbit, g = r.guided;
      return { ok: true, inOrbit: r.inOrbit, onTarget: r.inOrbit && r.endedBy !== 'depletion', perigee: o.perigeeAlt, apogee: o.bound ? o.apogeeAlt : null, inclination: o.inclinationDeg,
        radiusErr: r.errors ? r.errors.radius : null, speedErr: r.errors ? r.errors.speed : null, fpaErr: r.errors ? r.errors.fpaDeg : null, planeErr: r.errors ? r.errors.planeDeg : null,
        propellantLeft: g ? g.propellantLeft : null, cutoffT: r.t, stage1T: r.stage1.stageEnds[0].burnTime, endedBy: r.endedBy };
    }
    /** The nominal guidance's view of a set-up (what the dispersed flights' guidance believes). */
    function nominalOf(ctx) { return { veh: ctx.veh, engines: ctx.engines, plan: ctx.plan, ledger: S.evaluate(ctx.veh, ctx.engines, { timeline: false }) }; }
    /** One dispersed flight, both ways: the closed loop on the nominal model, and the nominal guided flight's attitude
     * history replayed on its clock (cut off at the nominal cutoff time). */
    function flyDispersed(ctx, tgt, nominalGuided, table, z, sigmaScale, nom) {
      var d = disperse(ctx, table, z, sigmaScale);
      var r1 = A.fly(d.veh, d.engines, d.plan, { burns: 1, samples: false });
      var g = flyClosed(d.veh, d.engines, d.plan, { mode: 'upfg', startAfter: ctx.guidance.startAfter, cycle: ctx.guidance.cycle }, tgt, { samples: false, stage1: r1, flyShort: true }, nom);
      var o = flyClosed(d.veh, d.engines, d.plan, replayLaw(nominalGuided), tgt, { samples: false, stage1: r1 });
      return { guided: metricsOf(g, tgt), replay: metricsOf(o, tgt) };
    }
    /**
     * Monte Carlo. opts {n, seed, sigmaScale, table}. Returns a runner: step(k) flies k more samples and returns true when
     * done; result() summarises. Draws come from a seeded generator in table order, so a run is reproducible.
     */
    function monteCarlo(ctx, nominalRun, opts) {
      var tgt = nominalRun.target, table = opts.table || dispersionTable(ctx.veh), N = opts.n || 100, gen = normals(rng(opts.seed == null ? 1 : opts.seed));
      var nom = nominalOf(ctx), samples = [], sc = opts.sigmaScale == null ? 1 : opts.sigmaScale;
      return {
        table: table, n: N,
        step: function (k) {
          for (var i = 0; i < k && samples.length < N; i++) {
            var z = {}; table.forEach(function (row) { z[row.key] = gen(); });
            var s = flyDispersed(ctx, tgt, nominalRun.guided, table, z, sc, nom); s.z = z; samples.push(s);
          }
          return samples.length >= N;
        },
        done: function () { return samples.length >= N; },
        samples: samples,
        result: function () { return summarise(samples, nominalRun, table, sc, opts.seed == null ? 1 : opts.seed); },
      };
    }
    function summarise(samples, nominalRun, table, sc, seed) {
      var pick = function (which, key, filt) { return samples.map(function (s) { return s[which]; }).filter(function (m) { return m.ok && (!filt || filt(m)); }).map(function (m) { return m[key]; }).filter(num); };
      var res = { n: samples.length, seed: seed, sigmaScale: sc, table: table.map(function (r) { return { key: r.key, sigma: r.sigma }; }) };
      ['guided', 'replay'].forEach(function (w) {
        var flown = samples.filter(function (s) { return s[w].ok; }).length, orbit = samples.filter(function (s) { return s[w].ok && s[w].inOrbit; }).length;
        res[w] = { flown: flown, inOrbit: orbit, onTarget: samples.filter(function (s) { return s[w].ok && s[w].onTarget; }).length,
          perigee: stats(pick(w, 'perigee')), apogee: stats(pick(w, 'apogee')), inclination: stats(pick(w, 'inclination')),
          radiusErr: stats(pick(w, 'radiusErr')), speedErr: stats(pick(w, 'speedErr')), fpaErr: stats(pick(w, 'fpaErr')), planeErr: stats(pick(w, 'planeErr')),
          propellantLeft: stats(pick(w, 'propellantLeft')), cutoffT: stats(pick(w, 'cutoffT')), stage1T: stats(pick(w, 'stage1T')) };
      });
      var g = nominalRun.guided, nomLeft = g && g.ok ? g.guided.propellantLeft : null, pl = res.guided.propellantLeft;
      if (num(nomLeft) && pl.n > 1) res.reserve = { nominalLeft: nomLeft, mean: pl.mean, sd: pl.sd, threeSigma: 3 * pl.sd, minLeft: pl.min, worstUse: nomLeft - pl.min, note: 'three standard deviations of the propellant left, assuming it is normal; with ' + pl.n + ' samples the 0.135 % tail itself is not measured' };
      return res;
    }
    /** Linear covariance: each dispersion alone at plus and minus one sigma (central difference), its share of the
     * scatter in the guided stage's propellant left, the replayed open loop's perigee, and the first stage's burn time,
     * and their root-sum-square: what Monte Carlo should approach when the dispersions are small. */
    function sensitivities(ctx, nominalRun, opts) {
      var tgt = nominalRun.target, table = (opts && opts.table) || dispersionTable(ctx.veh), sc = opts && opts.sigmaScale != null ? opts.sigmaScale : 1, nom = nominalOf(ctx);
      var rows = [], tot = { propellantLeft: 0, replayPerigee: 0, replayApogee: 0, stage1T: 0 };
      var base0 = flyDispersed(ctx, tgt, nominalRun.guided, table, {}, sc, nom);
      table.forEach(function (row) {
        if (!(row.sigma > 0)) return;
        var z1 = {}, z2 = {}; z1[row.key] = 1; z2[row.key] = -1;
        var a = flyDispersed(ctx, tgt, nominalRun.guided, table, z1, sc, nom), b = flyDispersed(ctx, tgt, nominalRun.guided, table, z2, sc, nom);
        var d = function (w, k) { return a[w].ok && b[w].ok && num(a[w][k]) && num(b[w][k]) ? (a[w][k] - b[w][k]) / 2 : null; };
        var side = function (w, k, m) { return m[w].ok && num(m[w][k]) && num(base0[w][k]) ? m[w][k] - base0[w][k] : null; };
        var r = { key: row.key, label: row.label, sigma: row.sigma * sc, propellantLeft: d('guided', 'propellantLeft'), replayPerigee: d('replay', 'perigee'), replayApogee: d('replay', 'apogee'), stage1T: d('guided', 'stage1T'),
          both: [side('guided', 'propellantLeft', b), side('guided', 'propellantLeft', a)], perigeeBoth: [side('replay', 'perigee', b), side('replay', 'perigee', a)] };
        for (var k in tot) if (num(r[k])) tot[k] += r[k] * r[k];
        rows.push(r);
      });
      for (var k2 in tot) tot[k2] = Math.sqrt(tot[k2]);
      return { rows: rows, total: tot, nominal: base0 };
    }

    // ================================================================== AS-512 against its flight report
    /** Rows {group, label, model, flight, units, gap, note}: the guided AS-512 against MPR-SAT-FE-73-1. Times are range
     * time (model t + 0.24 s). */
    function as512Rows(ctx, R) {
      var g = R.guided, rows = [], X = T512.cutoff, t0 = T0_512;
      var add = function (group, label, model, flight, units, note) { rows.push({ group: group, label: label, model: model, flight: flight, units: units, gap: num(model) && num(flight) ? model - flight : null, note: note || '' }); };
      if (!g || !g.ok) return rows;
      var e2 = g.stageEnds[1], e3 = g.stageEnds[2];
      if (e2) {
        add('S-II cutoff', 'Time', e2.t + t0, X.siiOeco.t, 's', 'Table 4-2. Idea 33\'s J-2 runs at mixture ratio 5.5 throughout and burns the flown propellant faster than the flight\'s 5.5-then-4.8 schedule (Table 2-2 item 39).');
        add('S-II cutoff', 'Altitude', e2.state.altitude / 1000, X.siiOeco.altKm, 'km', 'Guidance shapes this: a prediction. Geodetic in the report; above the sphere here.');
        add('S-II cutoff', 'Space-fixed velocity', e2.state.speed, X.siiOeco.v, 'm/s');
        add('S-II cutoff', 'Flight-path angle', e2.state.fpaDeg, X.siiOeco.fpa, 'deg');
      }
      if (e3) {
        add('S-IVB first cutoff', 'Time', e3.t + t0, X.sivb1Gcs.t, 's', 'Table 4-2 (guidance cutoff signal).');
        add('S-IVB first cutoff', 'Burn time', e3.burnTime, G512.sivbBurn1.burnTimeS, 's', 'Section 7.3: 138.8 s, ended by a guidance velocity cutoff; idea 33\'s J-2 flows faster than the flight\'s at mixture ratio 5.0.');
        add('S-IVB first cutoff', 'Propellant burned', e3.propellantUsed, e3.propellantOwn, 'kg', 'Flight: idea 34\'s S-IVB first-burn propellant, from the report\'s Table 16-5 masses. The chain\'s vehicle needs more to reach the same orbit.');
        add('S-IVB first cutoff', 'Altitude', e3.state.altitude / 1000, X.sivb1Gcs.altKm, 'km', 'The target is Table 4-4\'s perigee above the sphere (166.6 km); the report\'s 170.5 km is geodetic.');
        add('S-IVB first cutoff', 'Space-fixed velocity', e3.state.speed, X.sivb1Gcs.v, 'm/s');
        add('S-IVB first cutoff', 'Flight-path angle', e3.state.fpaDeg, X.sivb1Gcs.fpa, 'deg');
        var left = e3.propellantLeft, tli = e3.later && e3.later[0] ? e3.later[0].P : null;
        add('Left for the departure burn', 'S-IVB propellant', left, tli, 'kg', 'Flight: what the translunar injection burned (idea 34, from Table 16-7). ' + (num(tli) && left < tli ? 'Short by ' + fmt(tli - left, 4) + ' kg.' : ''));
        add('Parking orbit', 'Perigee height', g.orbit.perigeeAlt / 1000, T512.insertion.perigeeKm, 'km', 'Targeted (Table 4-4): agreement here is the guidance working, not a prediction.');
        add('Parking orbit', 'Apogee height', g.orbit.apogeeAlt / 1000, T512.insertion.apogeeKm, 'km', 'Targeted.');
        add('Parking orbit', 'Inclination', g.orbit.inclinationDeg, T512.insertion.inclination, 'deg', 'Targeted.');
        add('Cutoff accuracy', 'Radius against the target', g.errors.radius, G512.insertionVsPrediction.radiusM, 'm', 'Flight (section 9.3): the LVDC\'s radius at first S-IVB cutoff was 30.8 m above the operational trajectory\'s. Here: perfect navigation and a vehicle that is exactly its own model.');
        add('Cutoff accuracy', 'Speed against the target', g.errors.speed, G512.insertionVsPrediction.velocityMs, 'm/s', 'Flight: 0.20 m/s below the operational trajectory.');
      }
      return rows;
    }

    // ================================================================== handoff (series schema v1)
    var KERNEL = '36-closed-loop/closedloop.js';
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    /** The idea 35 handoff a set-up carries: the one imported, or the one idea 35's own kernel makes for this vehicle and
     * plan (its open-loop flight), so the chain is always 36 -> 35 -> 34 -> 33. */
    function ascentHandoffOf(ctx, produced) {
      if (ctx.h35) return ctx.h35;
      var r = A.fly(ctx.veh, ctx.engines, ctx.plan, { samples: false });
      return A.makeHandoff(ctx.h34, ctx.veh, ctx.plan, r, { produced: produced });
    }
    function makeHandoff(ctx, R, mc, extra) {
      extra = extra || {};
      var produced = extra.produced || new Date().toISOString();
      var h35 = ascentHandoffOf(ctx, produced), g = R.guided, tgt = R.target;
      var out = { handoff: 'long-way-round', version: 1, from: '36-closed-loop', produced: produced,
        inputs: { ascent_handoff: h35, guidance: { law: 'UPFG standard ascent (Brand, Brown and Higgins 1973)', startAfterStage1Cutoff_s: ctx.guidance.startAfter, cycle_s: ctx.guidance.cycle }, target: clone(ctx.target) },
        outputs: {}, refusals: [], assumptions: [
          'Frame and time as idea 35: Earth-centred inertial fixed at liftoff (z the spin axis, x through the launch meridian at liftoff), seconds from liftoff; no epoch, so the node in J2000 is module 37\'s. The orbit\'s node here is measured from that x axis.',
          'First stage: idea 35\'s open-loop flight, unchanged (plan in the ascent handoff). Upper stages: Unified Powered Flight Guidance (NTRS 19740004402) from ' + fmt(ctx.guidance.startAfter, 4) + ' s after first-stage cutoff (attitude held until then), a command every ' + fmt(ctx.guidance.cycle, 3) + ' s held fixed in inertial space, the last cycles frozen; cutoff when the orbital energy reaches the target\'s.',
          'Navigation is perfect: guidance knows the true position and velocity, and senses the true thrust acceleration; its model of the vehicle is idea 34\'s nominal ledger.',
          'Earth, gravity and atmosphere as idea 35 (sphere, point mass, 1976 atmosphere below 86 km, no wind, no J2).',
        ].concat(extra.assumptions || []) };
      var O = out.outputs, src = KERNEL + ' flyClosed() (UPFG)';
      (h35.refusals || []).forEach(function (x) { if (x.applies_to !== 'guidance' && x.applies_to !== 'orbit' && x.applies_to !== 'trajectory') out.refusals.push(Object.assign({ from: x.from || '35-max-q' }, x)); });
      if (tgt && !tgt.refusal) O.target_orbit = qv({ perigee_altitude_m: tgt.perigeeAlt, apogee_altitude_m: tgt.apogeeAlt, inclination_deg: tgt.inclinationDeg, branch: tgt.branch, cutoff_radius_m: tgt.rd, cutoff_speed_m_s: tgt.vd, cutoff_flight_path_angle_deg: 0, plane_normal: tgt.n }, 'm, m/s, deg', 'assumed', ctx.target.source || 'user');
      if (!g || !g.ok) { (g && g.refusals || []).forEach(function (x) { out.refusals.push(x); }); return out; }
      var f = g.final, o = g.orbit, nvec = unit(cross(f.r, f.v)), node = Math.atan2(nvec[0], -nvec[1]) / DEG;
      O.insertion_state = qv({ t_s: f.t, r_m: f.r, v_m_s: f.v, mass_kg: f.mass }, 's, m, m/s, kg', 'derived', src + ' (ECI at liftoff)');
      O.parking_orbit = qv({ bound: o.bound, semi_major_axis_m: o.a, eccentricity: o.e, inclination_deg: o.inclinationDeg, ascending_node_from_launch_meridian_deg: (node + 360) % 360, perigee_altitude_m: o.perigeeAlt, apogee_altitude_m: o.apogeeAlt, period_s: o.period, c3_m2_s2: o.c3 }, 'm, deg, s', 'derived', KERNEL + ' (idea 35 orbitOf(), Aster GM)');
      O.insertion_errors = qv({ radius_m: g.errors.radius, speed_m_s: g.errors.speed, flight_path_angle_deg: g.errors.fpaDeg, inclination_deg: g.errors.inclinationDeg, plane_angle_deg: g.errors.planeDeg, perigee_m: g.errors.perigee, apogee_m: g.errors.apogee }, 'm, m/s, deg', 'derived', src + ' (achieved minus target)');
      O.cutoff = qv({ t_s: g.t, ended_by: g.endedBy, stage: g.guided.label, burn: g.guided.burn + 1, burn_time_s: g.guided.burnTime, propellant_used_kg: g.guided.propellantUsed, propellant_left_kg: g.guided.propellantLeft }, 's, kg', 'derived', src);
      O.stage_cutoffs = qv(g.stageEnds.map(function (e) { var s = e.state; return { stage: e.label, burn: e.burn + 1, t_s: e.t, burn_time_s: e.burnTime, altitude_m: s.altitude, speed_m_s: s.speed, flight_path_angle_deg: s.fpaDeg, mass_kg: s.mass, ended_by: e.endedBy || 'depletion' }; }), 's, m, m/s, deg, kg', 'derived', src);
      var rest = [], ge = g.guided, left = ge.propellantLeft, pool = left;
      // the guided stage's later burns (a restart) get what is left in it, in order; the last of them takes the remainder
      (ge.later || []).forEach(function (b, i) { var P = i === ge.later.length - 1 ? pool : Math.min(b.P, pool); pool -= P; rest.push({ stage: ge.stage, burn: b.bi + 1, label: ge.label + ' burn ' + (b.bi + 1), propellant: P, propellant_planned: b.P, shed: b.shed }); });
      var noRestart = !rest.length && left > 0;
      if (noRestart) rest.push({ stage: ge.stage, burn: null, label: ge.label + ' residual after guided cutoff (no restart in idea 34\'s vehicle)', propellant: left, propellant_planned: 0 });
      ctx.veh.stages.forEach(function (st, si) { if (si > ge.stage) st.burns.forEach(function (b, bi) { rest.push({ stage: si, burn: bi + 1, label: st.label + ' burn ' + (bi + 1), propellant: b.propellant, propellant_planned: b.propellant }); }); });
      O.remaining_burns = qv(rest, 'kg', 'derived', src + ' (what the guided stage has left for later burns; module 38 burns it)');
      O.propellant_left_in_guided_stage = qv(left, 'kg', 'derived', src);
      O.delta_v_ideal_flown = qv(g.losses.ideal, 'm/s', 'derived', src + ' (integral of F_vac/m to cutoff)');
      O.loss_gravity = qv(g.lossesRel.gravity, 'm/s', 'derived', src + ' (against the Earth-relative speed, as idea 35)');
      O.loss_steering = qv(g.lossesRel.steering, 'm/s', 'derived', src);
      O.loss_drag = qv(g.lossesRel.drag, 'm/s', 'derived', src);
      O.loss_back_pressure = qv(g.losses.pressure, 'm/s', 'derived', src);
      O.guidance_cycles = qv(g.cycles.length, '1', 'derived', src);
      var ol = R.openLoop;
      if (ol) O.open_loop_programme = qv(ol.ok ? { in_orbit: !(ol.refusals || []).some(function (x) { return x.applies_to === 'orbit'; }), perigee_altitude_m: ol.orbit.perigeeAlt, apogee_altitude_m: ol.orbit.apogeeAlt, burnout_speed_m_s: ol.final.speed, burnout_altitude_m: ol.final.altitude, speed_short_of_target_m_s: tgt && !tgt.refusal ? tgt.vd - ol.final.speed : null } : { refused: ol.refusals && ol.refusals[0] && ol.refusals[0].reason }, 'm, m/s', 'derived', '35-max-q/ascent.js fly() on the same plan (idea 35\'s open-loop upper programme)');
      if (mc) {
        var gm = mc.guided, rm = mc.replay;
        O.scatter = qv({ n: mc.n, seed: mc.seed, sigma_scale: mc.sigmaScale, sigmas: mc.table || null,
          guided: { in_orbit: gm.inOrbit, on_target: gm.onTarget, perigee_sd_m: gm.perigee.sd, apogee_sd_m: gm.apogee.sd, inclination_sd_deg: gm.inclination.sd, radius_error_sd_m: gm.radiusErr.sd, speed_error_sd_m_s: gm.speedErr.sd, propellant_left_mean_kg: gm.propellantLeft.mean, propellant_left_sd_kg: gm.propellantLeft.sd, propellant_left_min_kg: gm.propellantLeft.min },
          open_loop_replay: { in_orbit: rm.inOrbit, perigee_mean_m: rm.perigee.mean, perigee_sd_m: rm.perigee.sd, apogee_sd_m: rm.apogee.sd, inclination_sd_deg: rm.inclination.sd },
          reserve_3sd_kg: mc.reserve ? mc.reserve.threeSigma : null }, 'm, m/s, deg, kg', 'derived', KERNEL + ' monteCarlo() (dispersions assumed, see refusals)');
      }
      (g.refusals || []).forEach(function (x) { out.refusals.push(x); });
      if (noRestart) out.refusals.push({ applies_to: 'restart', code: 'insufficient_data', reason: 'Guidance cut ' + ge.label + ' off with ' + fmt(left, 5) + ' kg unburned, but idea 34\'s vehicle gives that stage no second burn: whether it can restart for a departure is not stated.', what_would_help: 'A second burn for this stage in idea 34 (a restartable engine, with its coast losses), or a separate departure stage.' });
      out.refusals.push({ applies_to: 'navigation', code: 'insufficient_data', reason: 'Navigation is perfect here: guidance knows the true state. The flight\'s own cutoff was 30.8 m and 0.20 m/s from its prediction (section 9.3).', what_would_help: 'An inertial-platform error model (ST-124M drift and accelerometer errors) to fly guidance on a navigated state.' });
      var def = dispersionTable(ctx.veh), changed = mc && mc.table ? mc.table.filter(function (r, i) { return !def[i] || def[i].key !== r.key || Math.abs(r.sigma - def[i].sigma) > 1e-12 * Math.max(1, def[i].sigma); }).length : 0;
      out.refusals.push({ applies_to: 'dispersions', code: 'insufficient_data', reason: 'The dispersion sizes are one flight\'s deviations from its prediction (AS-512), used as one sigma' + (changed ? ' (' + changed + ' of them scaled or edited here: scatter.sigmas lists what was flown)' : '') + (mc && mc.sigmaScale !== 1 ? ' and scaled by ' + fmt(mc.sigmaScale, 3) : '') + ': a population of flights is not in the report.', what_would_help: 'MSFC\'s three-sigma dispersion tables for Saturn V (the operational trajectory documents), or the deviations of several flights.' });
      return out;
    }
    /** The first place two JSON-shaped values differ (numbers to 1e-6 relative, with a 1e-6 floor), or null. */
    function firstDiff(a, b, where) {
      if (typeof a === 'number' || typeof b === 'number') return num(a) && num(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) ? null : where;
      if (Array.isArray(b)) {
        if (!Array.isArray(a) || a.length !== b.length) return where;
        for (var i = 0; i < b.length; i++) { var d = firstDiff(a[i], b[i], where + '[' + i + ']'); if (d) return d; }
        return null;
      }
      if (b && typeof b === 'object') {
        if (!a || typeof a !== 'object' || Array.isArray(a)) return where;
        var keys = Object.keys(b).concat(Object.keys(a).filter(function (k) { return !(k in b); }));
        for (var j = 0; j < keys.length; j++) { var d2 = firstDiff(a[keys[j]], b[keys[j]], where + '.' + keys[j]); if (d2) return d2; }
        return null;
      }
      return a === b ? null : where;
    }
    function pathValue(o, where) {
      var v = o; ('.' + where).replace(/\.([^.[\]]+)|\[(\d+)\]/g, function (m, k, i) { v = v == null ? undefined : v[k != null ? k : +i]; return m; });
      return v;
    }
    /** Read this module's handoff back: the idea 35 handoff inside is re-checked (and through it 34's), the guided flight
     * re-flown with the handoff's own target and guidance settings, every output re-made and compared (numbers to 1e-6),
     * the list of refusals compared, and a Monte Carlo scatter re-flown from its seed, size and sigmas. (Review: it used
     * to compare four numbers, so an edited insertion state, departure-burn propellant or reserve passed, and a handoff
     * with its parking_orbit deleted skipped the check altogether.) */
    function parseHandoff(input) {
      var h = input;
      if (typeof input === 'string') { try { h = JSON.parse(input); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 34, 35 or 36.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 34, 35 or 36.') };
      if (h.from !== '36-closed-loop') return setup(h);
      var I = h.inputs || {};
      if (!I.ascent_handoff || !I.target || !I.guidance) return { refusal: refusal('invalid_input', 'This 36-closed-loop handoff carries no ascent, target or guidance settings.', 'A handoff exported by this page.') };
      var ctx = setup(I.ascent_handoff);
      if (ctx.refusal) return ctx;
      ctx.target = clone(I.target); ctx.guidance = { startAfter: I.guidance.startAfterStage1Cutoff_s, cycle: I.guidance.cycle_s, startSource: 'imported' };
      ctx.from = '36-closed-loop';
      var O = h.outputs || {}, show = function (x) { return x === undefined ? '(missing)' : typeof x === 'number' ? fmt(x, 9) : x && typeof x === 'object' ? (Array.isArray(x) ? '(a list of ' + x.length + ')' : '(an object)') : JSON.stringify(x); },
        edited = function (where, got, want) { return { refusal: refusal('invalid_input', 'The handoff says ' + where + ' = ' + show(got) + ', but flying its own ascent, target and guidance settings gives ' + show(want) + ': it was edited, or made with other data.', 'The unedited handoff this page exported.') }; };
      var R = run(ctx, { samples: false });
      // every output but the scatter, and the refusals, as this kernel makes them for these inputs
      var again = JSON.parse(JSON.stringify(makeHandoff(ctx, R, null, { produced: h.produced })));
      var mine = clone(O); delete mine.scatter;
      var d = firstDiff(mine, again.outputs, 'outputs');
      if (d) return edited(d, pathValue({ outputs: mine }, d), pathValue(again, d));
      var codes = function (list) { return (list || []).map(function (x) { return (x.applies_to || '') + ':' + x.code; }).sort().join(', '); };
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals (' + (codes(h.refusals) || 'none') + ') are not the ones flying its own settings gives (' + codes(again.refusals) + '): it was edited.', 'The unedited handoff this page exported.') };
      var sc = O.scatter && O.scatter.value;
      if (sc) {
        if (!R.guided.ok) return { refusal: refusal('invalid_input', 'The handoff carries a Monte Carlo scatter, but its own guided flight is refused, so there is nothing to disperse: it was edited.', 'The unedited handoff this page exported.') };
        var base = dispersionTable(ctx.veh), table = base, list = sc.sigmas;
        if (!(Number.isInteger(sc.n) && sc.n >= 2 && sc.n <= 1000 && Number.isInteger(sc.seed) && num(sc.sigma_scale) && sc.sigma_scale >= 0 && sc.sigma_scale <= 100)) return { refusal: refusal('invalid_input', 'The scatter\'s size, seed or sigma scale is not one this page makes (2 to 1,000 flights, an integer seed, a scale from 0 to 100).', 'The unedited handoff this page exported.') };
        if (list != null) {
          if (!Array.isArray(list) || list.length !== base.length || !list.every(function (x, i) { return x && x.key === base[i].key && num(x.sigma) && x.sigma >= 0 && x.sigma <= 1; })) return { refusal: refusal('invalid_input', 'The scatter\'s sigmas are not this vehicle\'s dispersion table (one per row, each a fraction from 0 to 1).', 'The unedited handoff this page exported.') };
          table = base.map(function (row, i) { return Object.assign({}, row, { sigma: list[i].sigma }); });
        }
        var mc = monteCarlo(ctx, R, { n: sc.n, seed: sc.seed, sigmaScale: sc.sigma_scale, table: table }); mc.step(sc.n);
        var res = mc.result(), want = JSON.parse(JSON.stringify(makeHandoff(ctx, R, res, { produced: h.produced }).outputs.scatter));
        if (list == null) delete want.value.sigmas; // a scatter exported before the review carries no sigmas: flown with the defaults
        var d3 = firstDiff(O.scatter, want, 'outputs.scatter');
        if (d3) return edited(d3, pathValue({ outputs: { scatter: O.scatter } }, d3), pathValue({ outputs: { scatter: want } }, d3));
        ctx.mcResult = res;
      }
      ctx.result = R;
      return ctx;
    }

    return { targetOrbit: targetOrbit, upperBurns: upperBurns, guidancePhases: guidancePhases, thrustIntegrals: thrustIntegrals, upfgPass: upfgPass, upfgInit: upfgInit, kepler: kepler,
      holdContext: holdContext, flyClosed: flyClosed, currentPhases: currentPhases, insertionErrors: insertionErrors, A: A, S: S,
      defaultTarget: defaultTarget, defaultGuidance: defaultGuidance, setup: setup, run: run, replayLaw: replayLaw, dispersionTable: dispersionTable, msfcScale: msfcScale,
      disperse: disperse, flyDispersed: flyDispersed, nominalOf: nominalOf, monteCarlo: monteCarlo, sensitivities: sensitivities, as512Rows: as512Rows,
      makeHandoff: makeHandoff, parseHandoff: parseHandoff, ascentHandoffOf: ascentHandoffOf, isAS512: isAS512, T0_512: T0_512, metricsOf: metricsOf, summarise: summarise,
      constants: { MU: MU, RE: RE, OMEGA: OMEGA, ATM_TOP: ATM_TOP } };
  }

  return { create: create, DEG: DEG, rng: rng, normals: normals, stats: stats };
});
