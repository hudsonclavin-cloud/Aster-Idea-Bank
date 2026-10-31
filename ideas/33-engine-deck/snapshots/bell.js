/* Bell: rocket nozzle flow, performance against ambient pressure, flow separation and a bell contour.
 *
 * Idea 32 of the Aster Idea Bank, module 2 of "The Long Way Round". A pure kernel: no DOM, no network, no data
 * of its own. It runs on idea 31's chemical-equilibrium kernel (snapshots/mixture.js, unmodified) and its
 * thermo.inp excerpt; NASA charts and rules come in as snapshots (nozzle-charts.js, nozzle-rules.js), the
 * standard atmosphere as PartForge's isa() (snapshots/partforge.js, via idea 02).
 *
 * Expansion (Gordon & McBride, NASA RP-1311 Part I, chapter 6, written from the equations; CEA is the oracle):
 *   shifting  each station is a constant-entropy equilibrium (idea 31's equilibrate(), mode SP) at its pressure;
 *   frozen    the composition is fixed at the chamber (CEA's default frozen case) or at the throat, and each
 *             station is the temperature at which that fixed mixture has the chamber entropy.
 * Velocity from the enthalpy drop, u^2 = u0^2 + 2 (h0 - h); area ratio from the mass flux, eps = (rho u)_t / (rho u).
 * Vacuum specific impulse Ivac = u + p/(rho u); at ambient pa, Isp = Ivac - pa/(rho u); CF = Isp / c*.
 * Separation: SP-8120's quoted criterion (Schilling): the wall separates where p < pa 0.583 (pa/pc)^0.195;
 * the 1-D exit pressure stands for the exit wall pressure. Divergence: lambda = (1 + cos a)/2 for a cone
 * (SP-125 eq 4-8); for a bell, SP-125 Figure 4-12 (digitized), applied to the vacuum thrust coefficient as
 * that figure defines it. Contour: Rao's canted parabola as SP-125 lays it out, angles from SP-8120 Figure 5(b).
 *
 * Units: SI throughout (Pa, K, kg, mol, J, m, s; Isp in m/s). Lengths in m. Angles in degrees at the API.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bell = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  // [Certain] Exact unit definitions: 1 lb = 0.45359237 kg, standard gravity 9.80665 m/s^2, 1 in = 0.0254 m.
  var LBF = 0.45359237 * 9.80665; // N
  var INCH = 0.0254; // m
  var PSI = LBF / (INCH * INCH); // Pa
  // [Certain] Area ratios compared with NASA CEA 3.3.4 (oracle/cea-nozzle.json: 1.5 to 400); refused outside.
  var EPS_ENVELOPE = [1.5, 400];
  // Species below this mole fraction are left out of a frozen mixture (their fits may stop at 300 K).
  var FROZEN_TRACE = 1e-10;
  var MODES = ['shifting', 'frozen', 'frozen-throat'];

  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function fmt(v, d) { return (typeof v === 'number' && isFinite(v)) ? +v.toPrecision(d || 4) + '' : String(v); }

  /** Supersonic Mach number for area ratio eps at constant gamma (a starting guess only). */
  function machFromArea(eps, g) {
    var lo = 1, hi = 60;
    var f = function (M) { return Math.pow(2 / (g + 1) * (1 + (g - 1) / 2 * M * M), (g + 1) / (2 * (g - 1))) / M - eps; };
    for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }

  /** Linear interpolation in a sorted node list; returns null outside. */
  function interp1(xs, ys, x) {
    if (!(x >= xs[0] && x <= xs[xs.length - 1])) return null;
    for (var i = 0; i < xs.length - 1; i++) {
      if (x <= xs[i + 1]) {
        if (ys[i] == null || ys[i + 1] == null) return null;
        return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
      }
    }
    return ys[ys.length - 1];
  }

  function create(deps) {
    var M = deps.Mixture, db = deps.db, charts = deps.charts, rules = deps.rules, isa = deps.isa, g0 = deps.g0;
    var R = M.R, P0 = M.P0;

    // ------------------------------------------------------------------ frozen mixtures
    function freezeOf(state, where, u0) {
      var names = [], recs = [], nj = [], dropped = [];
      state.names.forEach(function (nm) {
        var x = state.x[nm];
        if (x >= FROZEN_TRACE) { names.push(nm); recs.push(db.products[nm]); nj.push(x * state.n); }
        else dropped.push(nm);
      });
      var n = nj.reduce(function (a, b) { return a + b; }, 0);
      var smix = 0;
      for (var j = 0; j < nj.length; j++) smix -= nj[j] * Math.log(nj[j] / n);
      var lo = -Infinity, hi = Infinity;
      recs.forEach(function (r) { lo = Math.max(lo, r.intervals[0].Tmin); hi = Math.min(hi, r.intervals[r.intervals.length - 1].Tmax); });
      var F = { where: where, names: names, recs: recs, nj: nj, n: n, smix: smix, Tlo: lo, Thi: hi, dropped: dropped, u0: u0 || 0, T0: state.T, P0: state.P };
      // Reference values of this (kept) mixture at the freeze point, so the frozen isentrope starts there exactly.
      var ref = frozenProps(F, state.T, state.P);
      F.s = ref.s; F.h0 = ref.h;
      return F;
    }
    function frozenProps(F, T, p) {
      var s = 0, h = 0, cp = 0, lnP = Math.log(p / P0);
      for (var j = 0; j < F.recs.length; j++) {
        var th = M.thermoAt(F.recs[j], T);
        if (!th) return null;
        s += F.nj[j] * th.s; h += F.nj[j] * th.h; cp += F.nj[j] * th.cp;
      }
      return { s: R * (s + F.smix - F.n * lnP), h: R * T * h, cp: R * cp };
    }
    /** The frozen mixture F at pressure p on its isentrope. */
    function frozenState(F, p, Tguess) {
      var T = Math.min(Math.max(Tguess || F.T0, F.Tlo), F.Thi), pr;
      for (var k = 0; k < 100; k++) {
        pr = frozenProps(F, T, p);
        var d = (F.s - pr.s) / pr.cp;
        d = Math.max(-0.5, Math.min(0.5, d));
        var Tn = T * Math.exp(d);
        if (Tn < F.Tlo) {
          var atLo = frozenProps(F, F.Tlo, p);
          if (atLo.s > F.s) {
            var short = [];
            F.recs.forEach(function (r, j) { if (r.intervals[0].Tmin >= F.Tlo) short.push(F.names[j]); });
            return { refusal: refusal('out_of_envelope', 'The frozen expansion cools below ' + F.Tlo + ' K at ' + fmt(p / 1e5) + ' bar, where the fits of ' + short.slice(0, 4).join(', ') + (short.length > 4 ? ' and ' + (short.length - 4) + ' more' : '') + ' stop; the kernel does not extrapolate a fit (NASA CEA does).',
              'A smaller area ratio or a higher chamber pressure, so the exit stays above ' + F.Tlo + ' K.') };
          }
          Tn = F.Tlo;
        }
        if (Tn > F.Thi) Tn = F.Thi;
        if (Math.abs(Math.log(Tn / T)) < 1e-13) { T = Tn; break; }
        T = Tn;
      }
      pr = frozenProps(F, T, p);
      var gam = pr.cp / (pr.cp - F.n * R);
      var u2 = F.u0 * F.u0 + 2 * (F.h0 - pr.h);
      return { P: p, T: T, n: F.n, M: 1 / F.n, h: pr.h, cp: pr.cp, gamma: gam, a: Math.sqrt(gam * F.n * R * T), rho: p / (F.n * R * T), u2: u2 };
    }

    // ------------------------------------------------------------------ flows
    /**
     * A nozzle flow from a chamber (idea 31's rocket() result). mode: 'shifting' (equilibrium all the way),
     * 'frozen' (composition fixed at the chamber; the throat is frozen too, so c* changes) or 'frozen-throat'
     * (shifting to the throat, frozen after it). Returns the flow context or {refusal}.
     */
    function flow(r, mode) {
      if (!r || r.refusal) return { refusal: r && r.refusal ? r.refusal : refusal('insufficient_data', 'There is no chamber state to expand.', 'A chamber from idea 31 (a propellant, mixture ratio and pressure it accepts).') };
      if (MODES.indexOf(mode) < 0) return { refusal: refusal('invalid_input', 'Unknown flow model "' + mode + '".', 'One of ' + MODES.join(', ') + '.') };
      var ch = r.chamber, th = r.throat;
      var base = { mode: mode, pc: r.pc, b0: r.mixture.b0, hc: ch.h, sc: ch.s, names: ch.names, chamber: ch, rocket: r };
      if (mode === 'frozen') {
        base.freeze = freezeOf(ch, 'chamber', 0);
        var t = frozenThroat(base);
        if (t.refusal) return t;
        base.throat = t;
      } else {
        base.throat = { P: th.P, T: th.T, rho: th.rho, u: r.throatVelocity, a: th.a, gamma: th.gamma_s, M: th.M, raw: th };
        if (mode === 'frozen-throat') base.freeze = freezeOf(th, 'throat', r.throatVelocity);
      }
      base.G = base.throat.rho * base.throat.u;
      base.cstar = base.pc / base.G;
      return base;
    }
    function frozenThroat(base) {
      var F = base.freeze, g = base.chamber.gamma_fr, pc = base.pc;
      var lnr = g / (g - 1) * Math.log((g + 1) / 2), st = null, T = F.T0;
      for (var k = 0; k < 60; k++) {
        st = frozenState(F, pc * Math.exp(-lnr), T);
        if (st.refusal) return st;
        var a2 = st.a * st.a;
        if (!(st.u2 > 0)) return { refusal: refusal('out_of_envelope', 'No enthalpy drop to the frozen throat.', 'Report the inputs.') };
        if (Math.abs(st.u2 - a2) / st.u2 < 1e-13) break;
        lnr -= (st.u2 - a2) / (st.n * R * st.T * (st.gamma + 1));
        T = st.T;
      }
      st.u = Math.sqrt(st.u2);
      return st;
    }

    /** One supersonic station at static pressure p (Pa). prev: a neighbouring station (warm start). */
    function stationAtPressure(base, p, prev) {
      if (!(p > 0 && isFinite(p))) return { refusal: refusal('invalid_input', 'A nozzle station needs a positive pressure.', 'A pressure above zero.') };
      if (!(p < base.throat.P)) return { refusal: refusal('out_of_envelope', 'At ' + fmt(p / 1e5) + ' bar the flow is not supersonic: the throat is at ' + fmt(base.throat.P / 1e5) + ' bar, so a chamber at ' + fmt(base.pc / 1e5) + ' bar cannot expand to this pressure in the divergent section.', 'A lower exit or ambient pressure, or a higher chamber pressure.') };
      var st;
      if (base.mode === 'shifting') {
        var eq = M.equilibrate(db, base.b0, p, { mode: 'SP', s: base.sc, species: base.names, start: (prev && prev.raw) || base.throat.raw });
        if (eq.refusal) {
          return { refusal: refusal(eq.refusal.code, 'In the nozzle at ' + fmt(p / 1e5) + ' bar: ' + eq.refusal.reason, eq.refusal.what_would_help) };
        }
        if (eq.condensed && eq.condensed.length) {
          var nm = eq.condensed.map(function (c) { return c.species; }).join(' and ');
          return { refusal: refusal('out_of_envelope', 'At ' + fmt(p / 1e5) + ' bar in the nozzle (' + eq.T.toFixed(0) + ' K) shifting equilibrium would deposit ' + nm + '; this kernel is gas-only and would report a wrong state.',
            'A smaller area ratio, a less fuel-rich mixture, or a frozen-flow estimate (the frozen model keeps the gas composition).') };
        }
        st = { P: p, T: eq.T, n: eq.n, M: eq.M, h: eq.h, gamma: eq.gamma_s, a: eq.a, rho: eq.rho, u2: 2 * (base.hc - eq.h), raw: eq };
      } else {
        st = frozenState(base.freeze, p, prev ? prev.T : undefined);
        if (st.refusal) return st;
      }
      if (!(st.u2 > 0)) return { refusal: refusal('out_of_envelope', 'No enthalpy drop to ' + fmt(p / 1e5) + ' bar.', 'Report the inputs.') };
      st.u = Math.sqrt(st.u2);
      st.G = st.rho * st.u;
      st.eps = base.G / st.G;
      st.mach = st.u / st.a;
      st.Ivac = st.u + p / st.G;
      st.cfVac = st.Ivac / base.cstar;
      return st;
    }

    /** The supersonic station whose area ratio is eps (safeguarded Newton on ln(pc/p)); near: a neighbouring station to start from. */
    function stationAtArea(base, eps, near) {
      if (!(typeof eps === 'number' && isFinite(eps))) return { refusal: refusal('invalid_input', 'The area ratio must be a number.', 'An exit-to-throat area ratio between ' + EPS_ENVELOPE[0] + ' and ' + EPS_ENVELOPE[1] + '.') };
      if (eps < EPS_ENVELOPE[0] * (1 - 1e-6) || eps > EPS_ENVELOPE[1] * (1 + 1e-6)) {
        return { refusal: refusal('out_of_envelope', 'An area ratio of ' + fmt(eps) + ' is outside the ' + EPS_ENVELOPE[0] + ' to ' + EPS_ENVELOPE[1] + ' this kernel was compared with NASA CEA over.',
          'An area ratio between ' + EPS_ENVELOPE[0] + ' and ' + EPS_ENVELOPE[1] + ', or a CEA comparison at this one (oracle/cea_nozzle.py) before widening the envelope.') };
      }
      var pc = base.pc, xt = Math.log(pc / base.throat.P), g = base.throat.gamma;
      var Mg = machFromArea(eps, g);
      var x = xt + g / (g - 1) * Math.log((1 + (g - 1) / 2 * Mg * Mg) / ((g + 1) / 2));
      var prev = null, last = null, lastRef = null;
      if (near && !near.refusal && near.eps > 1) {
        // one Newton step from the neighbour: d ln eps / d ln(pc/p) = (M^2 - 1) / (gamma M^2)
        x = Math.log(pc / near.P) + Math.log(eps / near.eps) * near.gamma * near.mach * near.mach / (near.mach * near.mach - 1);
        prev = near;
      }
      var lo = xt, hi = Infinity;
      for (var k = 0; k < 80; k++) {
        var st = stationAtPressure(base, pc * Math.exp(-x), prev);
        if (st.refusal) {
          lastRef = st;
          hi = Math.min(hi, x);
          if (hi - lo < 1e-9) return lastRef;
          x = (lo + hi) / 2;
          continue;
        }
        var f = Math.log(st.eps / eps);
        if (Math.abs(f) < 1e-12) { st.iterations = k + 1; return st; }
        if (f < 0) lo = Math.max(lo, x); else hi = Math.min(hi, x);
        var df = (st.mach * st.mach - 1) / (st.gamma * st.mach * st.mach);
        var xn = x - f / df;
        if (!(xn > lo && xn < hi) || !isFinite(xn)) xn = isFinite(hi) ? (lo + hi) / 2 : x + 1;
        if (hi - lo < 1e-13) { st.iterations = k + 1; return st; }
        x = xn; prev = st; last = st;
      }
      return lastRef || { refusal: refusal('out_of_envelope', 'The area-ratio iteration did not converge at eps ' + fmt(eps) + '.', 'Report the inputs.') };
    }

    /** Performance of a station against ambient pressure pa (Pa), with divergence efficiency lam on the vacuum C_F. */
    function performance(base, st, pa, lam) {
      lam = lam == null ? 1 : lam;
      var cfVac = lam * st.cfVac;
      var cf = cfVac - st.eps * pa / base.pc;
      return { cfVacIdeal: st.cfVac, IvacIdeal: st.Ivac, cfVac: cfVac, Ivac: cfVac * base.cstar, cf: cf, isp: cf * base.cstar, pa: pa, lambda: lam };
    }

    /**
     * The bracket for a separated nozzle (m/s): lower = flowing full (the pressure deficit acts on the whole skirt),
     * upper = the nozzle cut at SP-8120's separation plane (the skirt beyond contributes nothing). Review fix: when
     * SP-8120's separation pressure is at or above the throat pressure there is no separation plane in the divergent
     * section and no bracket (the kernel used to offer "-34060 m/s" at 10 MPa ambient); a non-positive lower end is
     * dropped rather than offered as a bound.
     */
    function sepBracket(base, st, sep, pa, lam, ambPerf) {
      var br = { lower: ambPerf.isp, upper: null, cut: null, notes: [] };
      if (!(sep.pSep < base.throat.P)) {
        br.lower = null;
        br.none = 'SP-8120 puts separation at ' + fmt(sep.pSep / 1e3) + ' kPa, at or above the throat pressure (' + fmt(base.throat.P / 1e3) + ' kPa): the flow would break away at or before the throat, so this nozzle would not run supersonic at all and no bracket is offered';
        return br;
      }
      var cut = stationAtPressure(base, sep.pSep, st);
      if (cut.refusal) br.notes.push('no upper end: the separation plane cannot be located (' + cut.refusal.reason + ')');
      else {
        br.cut = { eps: cut.eps, station: cut, cfUpper: lam * cut.cfVac - cut.eps * pa / base.pc };
        br.cut.ispUpper = br.cut.cfUpper * base.cstar;
        br.upper = br.cut.ispUpper;
      }
      if (!(br.lower > 0)) { br.notes.push('the full-flowing value (' + fmt(br.lower, 4) + ' m/s) is not positive, so it bounds nothing'); br.lower = null; }
      return br;
    }
    function bracketText(br) {
      if (br.none) return 'No bracket: ' + br.none + '.';
      var s = br.lower != null && br.upper != null ? 'Bracket: ' + fmt(br.lower, 4) + ' to ' + fmt(br.upper, 4) + ' m/s (full-flowing to cut at the separation plane)'
        : br.upper != null ? 'Bracket: up to ' + fmt(br.upper, 4) + ' m/s (the nozzle cut at the separation plane)'
        : br.lower != null ? 'Bracket: above ' + fmt(br.lower, 4) + ' m/s (flowing full)' : 'No bracket';
      return s + (br.notes.length ? '; ' + br.notes.join('; ') : '') + '.';
    }

    // ------------------------------------------------------------------ ambient and separation
    /** spec: {kind: 'vacuum'} | {kind: 'altitude', alt_m} | {kind: 'pressure', pa}. Returns {pa, label, source} or {refusal}. */
    function ambient(spec) {
      spec = spec || { kind: 'vacuum' };
      if (spec.kind === 'vacuum') return { pa: 0, label: 'vacuum', source: 'assumed (vacuum)' };
      if (spec.kind === 'pressure') {
        if (!(typeof spec.pa === 'number' && isFinite(spec.pa) && spec.pa >= 0)) return { refusal: refusal('invalid_input', 'Ambient pressure must be zero or a positive number of pascals.', 'A pressure of 0 (vacuum) or more.') };
        return { pa: spec.pa, label: fmt(spec.pa / 1e3) + ' kPa', source: 'user input' };
      }
      if (spec.kind === 'altitude') {
        var z = spec.alt_m;
        if (!(typeof z === 'number' && isFinite(z))) return { refusal: refusal('invalid_input', 'Altitude must be a number of metres.', 'A geometric altitude in metres.') };
        if (z < -5000 || z > 86000) return { refusal: refusal('out_of_envelope', 'The 1976 US Standard Atmosphere table covers -5 to 86 km geometric; ' + fmt(z / 1e3) + ' km is outside it.', 'An altitude inside the table, or vacuum (above 86 km the ambient pressure is under 0.4 Pa and its effect on thrust is negligible next to the separation question).') };
        var s = isa(z);
        return { pa: s.P_Pa, label: fmt(z / 1e3) + ' km', source: 'PartForge isa() (1976 US Standard Atmosphere), via idea 02, at ' + z + ' m geometric', alt_m: z };
      }
      return { refusal: refusal('invalid_input', 'Unknown ambient kind.', 'vacuum, altitude or pressure.') };
    }

    /** Geometric altitude (m) at which the 1976 standard atmosphere has pressure pa, or null outside -5 to 86 km. */
    function altitudeOfPressure(pa) {
      if (!(pa > 0) || pa > isa(-5000).P_Pa || pa < isa(86000).P_Pa) return null;
      var lo = -5000, hi = 86000;
      for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (isa(m).P_Pa > pa) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }

    /** SP-8120's separation criterion for exit pressure pe at ambient pa and chamber pressure pc. */
    function separation(pc, pa, pe) {
      var S = rules.separation;
      if (!(pa > 0)) return { status: 'vacuum', pSep: 0, pMarginal: 0, earlyRule: false };
      var pSep = pa * S.a * Math.pow(pa / pc, S.b);
      var pMarg = pSep * (1 + S.margin.fraction);
      return { status: pe < pSep ? 'separated' : pe < pMarg ? 'marginal' : 'full', pSep: pSep, pMarginal: pMarg, exitToAmbient: pe / pa, earlyRule: pe < S.early.ratio * pa };
    }
    /** The ambient pressure at which a nozzle with exit pressure pe begins to separate (margin: true -> SP-8120's 20 % line). */
    function separationAmbient(pc, pe, margin) {
      var S = rules.separation;
      var a = S.a * (margin ? 1 + S.margin.fraction : 1);
      return Math.pow(pe * Math.pow(pc, S.b) / a, 1 / (1 + S.b));
    }

    // ------------------------------------------------------------------ divergence efficiency
    // Review fix: the cone's lambda is refused over the same 0-45 degree envelope as its contour (coneContour), so a
    // cone the page cannot draw is not given a thrust coefficient either; a non-number is invalid_input, not "NaN".
    function lambdaCone(alphaDeg) {
      if (!(typeof alphaDeg === 'number' && isFinite(alphaDeg))) return { refusal: refusal('invalid_input', 'The cone half-angle must be a number of degrees.', 'A half-angle such as 15 degrees (SP-125: 12 to 18 is usual).') };
      if (!(alphaDeg > 0 && alphaDeg <= 45)) return { refusal: refusal('out_of_envelope', 'A cone half-angle of ' + fmt(alphaDeg) + ' degrees is outside 0 to 45, the cones this page draws and evaluates.', 'A half-angle such as 15 degrees (SP-125: 12 to 18 is usual).') };
      return { value: (1 + Math.cos(alphaDeg * DEG)) / 2, source: 'SP-125 eq (4-8), lambda = (1 + cos a) / 2', confidence: 'derived', exact: true };
    }
    function lambdaBell(Lf, eps) {
      var C = charts.bellLambda, pct = Lf * 100;
      // Review fix: an area ratio that is not a number, or outside the kernel's envelope, gets no lambda (it used to
      // return 0 for NaN and the nearest curve for, say, -5).
      if (!(typeof Lf === 'number' && isFinite(Lf))) return { refusal: refusal('invalid_input', 'The bell length must be a number (a percentage of a 15-degree cone).', 'A length between 60 and 100 % of a 15-degree cone, or a cone.') };
      if (!(typeof eps === 'number' && isFinite(eps))) return { refusal: refusal('invalid_input', 'The area ratio must be a number, so there is no divergence efficiency to read.', 'An exit-to-throat area ratio between ' + EPS_ENVELOPE[0] + ' and ' + EPS_ENVELOPE[1] + '.') };
      if (eps < EPS_ENVELOPE[0] * (1 - 1e-6) || eps > EPS_ENVELOPE[1] * (1 + 1e-6)) return { refusal: refusal('out_of_envelope', 'An area ratio of ' + fmt(eps) + ' is outside the ' + EPS_ENVELOPE[0] + ' to ' + EPS_ENVELOPE[1] + ' this kernel works over, so no divergence efficiency is read for it.', 'An area ratio between ' + EPS_ENVELOPE[0] + ' and ' + EPS_ENVELOPE[1] + '.') };
      if (!(pct >= C.Lf[0] - 1e-9 && pct <= C.Lf[C.Lf.length - 1] + 1e-9)) {
        return { refusal: refusal('out_of_envelope', 'A ' + fmt(pct, 3) + ' % bell is outside SP-125 Figure 4-12, which covers 60 to 100 %.', 'A length between 60 and 100 % of a 15-degree cone, or a cone.') };
      }
      pct = Math.min(Math.max(pct, C.Lf[0]), C.Lf[C.Lf.length - 1]);
      var byEps = C.eps.map(function (e) { return interp1(C.Lf, C.percent[String(e)], pct); });
      var e = Math.min(Math.max(eps, C.eps[0]), C.eps[C.eps.length - 1]);
      var v = interp1(C.eps, byEps, e);
      var out = { value: v / 100, source: 'SP-125 Figure 4-12 (digitized), ' + fmt(pct, 3) + ' % bell at eps ' + fmt(e, 3), confidence: 'derived' };
      if (eps < C.eps[0] || eps > C.eps[C.eps.length - 1]) {
        var i = eps < C.eps[0] ? 0 : C.eps.length - 2;
        out.extrapolated = true;
        out.spread = Math.abs(byEps[i + 1] - byEps[i]) / 100;
        out.note = 'the chart has curves for area ratios 10 to 40 only; eps ' + fmt(eps, 3) + ' uses the eps ' + fmt(e, 3) + ' curve. Its neighbouring curve differs by ' + fmt(out.spread * 100, 2) + ' percentage points here.';
      }
      return out;
    }

    // ------------------------------------------------------------------ contour
    function raoAngles(eps, Lf) {
      var A = charts.raoAngles, pct = Lf * 100;
      if (!(typeof eps === 'number' && isFinite(eps))) return { refusal: refusal('invalid_input', 'The area ratio must be a number, so there are no parabola angles to read.', 'An area ratio between ' + A.eps[0] + ' and ' + A.eps[A.eps.length - 1] + ', or a cone.') };
      if (!(typeof Lf === 'number' && isFinite(Lf))) return { refusal: refusal('invalid_input', 'The bell length must be a number (a percentage of a 15-degree cone).', 'A length between 60 and 100 %.') };
      if (!(eps >= A.eps[0] && eps <= A.eps[A.eps.length - 1])) {
        return { refusal: refusal('out_of_envelope', 'SP-8120 Figure 5(b) gives parabola angles for area ratios ' + A.eps[0] + ' to ' + A.eps[A.eps.length - 1] + ' (beyond ' + A.dashedFrom + ' dashed); eps ' + fmt(eps) + ' is outside it.', 'An area ratio inside the chart, or a cone (any area ratio), or a method-of-characteristics contour (not in this module).') };
      }
      if (!(pct >= 60 - 1e-9 && pct <= 100 + 1e-9)) return { refusal: refusal('out_of_envelope', 'Parabola angles are charted for 60 to 100 % bells; ' + fmt(pct, 3) + ' % is outside.', 'A length between 60 and 100 %.') };
      pct = Math.min(Math.max(pct, 60), 100);
      var lx = A.eps.map(Math.log), le = Math.log(eps);
      function at(table) {
        var byLf = A.Lf.map(function (L) { return interp1(lx, table[String(L)], le); });
        return interp1(A.Lf, byLf, pct);
      }
      var out = { thetaN: at(A.thetaN), thetaE: at(A.thetaE), dashed: eps > A.dashedFrom, source: 'SP-8120 Figure 5(b) (digitized)' };
      var B = charts.raoAnglesSP125;
      if (B && eps >= B.eps[0] && eps <= B.eps[B.eps.length - 1]) {
        var bx = B.eps;
        var fN = B.Lf.map(function (L) { return interp1(bx, B.thetaN[String(L)], eps); });
        var fE = B.Lf.map(function (L) { return interp1(bx, B.thetaE[String(L)], eps); });
        var sn = fN.every(function (v) { return v != null; }) ? interp1(B.Lf, fN, pct) : null;
        var se = fE.every(function (v) { return v != null; }) ? interp1(B.Lf, fE, pct) : null;
        out.sp125 = { thetaN: sn, thetaE: se };
      }
      return out;
    }

    /** Length of the 15-degree reference cone SP-125 measures bells against (eq 4-7 with the 0.382 Rt arc). */
    function referenceConeLength(Rt, eps) {
      var a = rules.bell.referenceConeDeg * DEG, Rd = rules.bell.downstreamArc * Rt;
      return (Rt * (Math.sqrt(eps) - 1) + Rd * (1 / Math.cos(a) - 1)) / Math.tan(a);
    }
    function lengthFraction(L, Rt, eps) { return L / referenceConeLength(Rt, eps); }

    function upstreamStub(Rt, pts) {
      var Ru = rules.bell.upstreamArc * Rt;
      for (var i = 0; i <= 12; i++) { var f = 45 * DEG * (1 - i / 12); pts.push([-Ru * Math.sin(f), Rt + Ru * (1 - Math.cos(f))]); }
    }
    function wetted(pts) {
      var A = 0;
      for (var i = 1; i < pts.length; i++) {
        if (pts[i][0] <= 0) continue;
        var dx = pts[i][0] - pts[i - 1][0], dr = pts[i][1] - pts[i - 1][1];
        A += Math.PI * (pts[i][1] + pts[i - 1][1]) * Math.sqrt(dx * dx + dr * dr);
      }
      return A;
    }

    /** Rao's canted parabola (SP-125 Fig 4-13): throat radius Rt (m), area ratio eps, length fraction Lf (0.6-1). */
    function bellContour(Rt, eps, Lf, angles) {
      var ang = angles || raoAngles(eps, Lf);
      if (ang.refusal) return ang;
      var B = rules.bell, Rd = B.downstreamArc * Rt;
      var tn = ang.thetaN * DEG, te = ang.thetaE * DEG;
      var Ln = Lf * referenceConeLength(Rt, eps), Re = Rt * Math.sqrt(eps);
      var N = [Rd * Math.sin(tn), Rt + Rd * (1 - Math.cos(tn))], E = [Ln, Re];
      // Control point Q: the tangents at N (angle tn) and E (angle te) meet; the quadratic Bezier N-Q-E is a parabola.
      var dx = E[0] - N[0], dy = E[1] - N[1];
      // t (cos tn, sin tn) + s (cos te, sin te) = E - N, so Q = N + t (cos tn, sin tn) = E - s (cos te, sin te).
      var det = Math.sin(te - tn);
      var t = (dx * Math.sin(te) - dy * Math.cos(te)) / det;
      var s = (dy * Math.cos(tn) - dx * Math.sin(tn)) / det;
      var Q = [N[0] + t * Math.cos(tn), N[1] + t * Math.sin(tn)];
      if (!(t > 0 && s > 0 && Q[0] > N[0] && Q[0] < E[0])) {
        return { refusal: refusal('out_of_envelope', 'The parabola angles (' + fmt(ang.thetaN, 3) + ' and ' + fmt(ang.thetaE, 3) + ' degrees) cannot join the throat arc to the exit lip at this length.', 'A different length fraction or area ratio.') };
      }
      var pts = [];
      upstreamStub(Rt, pts);
      for (var i = 1; i <= 10; i++) { var f = tn * i / 10; pts.push([Rd * Math.sin(f), Rt + Rd * (1 - Math.cos(f))]); }
      for (i = 1; i <= 40; i++) {
        var u = i / 40, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        pts.push([w0 * N[0] + w1 * Q[0] + w2 * E[0], w0 * N[1] + w1 * Q[1] + w2 * E[1]]);
      }
      return { type: 'bell', Rt: Rt, Re: Re, eps: eps, Lf: Lf, length: Ln, referenceLength: Ln / Lf, thetaN: ang.thetaN, thetaE: ang.thetaE, angles: ang,
        N: N, E: E, Q: Q, downstreamArc: Rd, upstreamArc: B.upstreamArc * Rt, points: pts, wettedArea: wetted(pts) };
    }

    /** Conical nozzle (SP-125 Fig 4-10, eq 4-7): half-angle alpha (deg), downstream throat arc RdFrac * Rt. */
    function coneContour(Rt, eps, alphaDeg, RdFrac) {
      if (!(typeof alphaDeg === 'number' && isFinite(alphaDeg))) return { refusal: refusal('invalid_input', 'The cone half-angle must be a number of degrees.', 'A half-angle such as 15 degrees (SP-125: 12 to 18 is usual).') };
      if (!(typeof eps === 'number' && isFinite(eps) && eps > 1)) return { refusal: refusal('invalid_input', 'The area ratio must be a number above 1 to draw a cone.', 'An area ratio between ' + EPS_ENVELOPE[0] + ' and ' + EPS_ENVELOPE[1] + '.') };
      if (!(alphaDeg > 0 && alphaDeg <= 45)) return { refusal: refusal('out_of_envelope', 'A cone half-angle of ' + fmt(alphaDeg) + ' degrees is outside 0 to 45.', 'A half-angle such as 15 degrees (SP-125: 12 to 18 is usual).') };
      var a = alphaDeg * DEG, Rd = (RdFrac == null ? rules.cone.downstreamArc : RdFrac) * Rt, Re = Rt * Math.sqrt(eps);
      var Ln = (Rt * (Math.sqrt(eps) - 1) + Rd * (1 / Math.cos(a) - 1)) / Math.tan(a);
      var T1 = [Rd * Math.sin(a), Rt + Rd * (1 - Math.cos(a))];
      var pts = [];
      upstreamStub(Rt, pts);
      for (var i = 1; i <= 10; i++) { var f = a * i / 10; pts.push([Rd * Math.sin(f), Rt + Rd * (1 - Math.cos(f))]); }
      for (i = 1; i <= 20; i++) { var u = i / 20; pts.push([T1[0] + u * (Ln - T1[0]), T1[1] + u * (Re - T1[1])]); }
      return { type: 'cone', Rt: Rt, Re: Re, eps: eps, alpha: alphaDeg, length: Ln, downstreamArc: Rd, upstreamArc: rules.bell.upstreamArc * Rt, tangent: T1, points: pts, wettedArea: wetted(pts),
        Lf: Ln / referenceConeLength(Rt, eps) };
    }

    /** Throat and exit for thrust F (N) at a thrust coefficient cf and chamber pressure pc, with c* for the mass flow. */
    function size(F, cf, pc, cstar, eps) {
      if (!(typeof F === 'number' && isFinite(F) && F > 0)) return { refusal: refusal('invalid_input', 'Thrust must be a positive number of newtons.', 'A thrust above zero.') };
      if (!(cf > 0)) return { refusal: refusal('out_of_envelope', 'The thrust coefficient at the design ambient is ' + fmt(cf) + ', so no throat gives that thrust there.', 'A smaller area ratio, a higher chamber pressure, or a design ambient nearer vacuum.') };
      var At = F / (cf * pc), Dt = Math.sqrt(4 * At / Math.PI);
      return { At: At, Dt: Dt, Rt: Dt / 2, Ae: eps * At, De: Dt * Math.sqrt(eps), mdot: pc * At / cstar };
    }

    // ------------------------------------------------------------------ one whole nozzle
    /**
     * Analyse a nozzle on a chamber r (idea 31's rocket() result).
     * opts: {eps, contour: {type: 'bell', Lf} | {type: 'cone', alpha}, ambient: spec, design: 'shifting'|'frozen',
     *        freeze: 'chamber'|'throat', thrust: N or null, designAmbient: spec (default: ambient)}
     */
    function analyze(r, opts) {
      var out = { refusals: [], flows: {} };
      if (!r || r.refusal) { out.refusals.push(Object.assign({ applies_to: 'chamber' }, r && r.refusal ? r.refusal : refusal('insufficient_data', 'No chamber.', 'A chamber from idea 31.'))); return out; }
      var frozenMode = opts.freeze === 'throat' ? 'frozen-throat' : 'frozen';
      var design = opts.design === 'frozen' ? 'frozen' : 'shifting';
      out.design = design; out.frozenMode = frozenMode;
      var amb = ambient(opts.ambient);
      if (amb.refusal) { out.refusals.push(Object.assign({ applies_to: 'ambient' }, amb.refusal)); amb = null; }
      out.ambient = amb;
      // divergence efficiency (independent of size)
      var lam = null, c = opts.contour || { type: 'bell', Lf: 0.8 };
      if (c.type === 'cone') lam = lambdaCone(c.alpha);
      else lam = lambdaBell(c.Lf, opts.eps);
      if (lam.refusal) { out.refusals.push(Object.assign({ applies_to: 'divergence_efficiency' }, lam.refusal)); lam = null; }
      out.lambda = lam;
      // Review fix: with the divergence efficiency refused there is no after-divergence C_F or Isp and no sizing (the
      // kernel used to fall back to lambda = 1 silently while the outputs still said "x divergence efficiency").
      var lamv = lam ? lam.value : null;
      if (lamv == null) out.lambdaRefused = out.refusals.filter(function (x) { return x.applies_to === 'divergence_efficiency'; })[0] || null;
      ['shifting', frozenMode].forEach(function (mode) {
        var key = mode === 'shifting' ? 'shifting' : 'frozen';
        var b = flow(r, mode);
        if (b.refusal) { out.refusals.push(Object.assign({ applies_to: key }, b.refusal)); return; }
        var st = stationAtArea(b, opts.eps);
        if (st.refusal) { out.refusals.push(Object.assign({ applies_to: key + '_exit' }, st.refusal)); out.flows[key] = { base: b }; return; }
        var F = { base: b, exit: st };
        if (lamv != null) F.vac = performance(b, st, 0, lamv);
        if (amb) {
          F.sep = separation(b.pc, amb.pa, st.P);
          if (lamv != null) F.amb = performance(b, st, amb.pa, lamv);
          if (F.sep.status === 'separated' && F.amb) F.bracket = sepBracket(b, st, F.sep, amb.pa, lamv, F.amb);
        }
        if (F.bracket && F.bracket.cut) F.sepCut = F.bracket.cut;
        F.sepOnset = separationAmbient(b.pc, st.P, false);
        F.sepMarginOnset = separationAmbient(b.pc, st.P, true);
        out.flows[key] = F;
      });
      // sizing and contour at the design flow model
      var D = out.flows[design];
      var Rt = null;
      if (opts.thrust != null && D && D.exit && lamv == null) {
        out.refusals.push({ applies_to: 'sizing', code: (out.lambdaRefused && out.lambdaRefused.code) || 'insufficient_data', reason: 'No divergence efficiency for this contour (refused above), so there is no thrust coefficient to size the throat with.', what_would_help: (out.lambdaRefused && out.lambdaRefused.what_would_help) || 'A contour inside the charts.' });
      } else if (opts.thrust != null && D && D.exit) {
        var damb = opts.designAmbient ? ambient(opts.designAmbient) : amb;
        if (damb && damb.refusal) out.refusals.push(Object.assign({ applies_to: 'sizing' }, damb.refusal));
        else if (damb) {
          var sepD = separation(D.base.pc, damb.pa, D.exit.P);
          if (sepD.status === 'separated') {
            out.refusals.push({ applies_to: 'sizing', code: 'out_of_envelope', reason: 'At the design ambient (' + damb.label + ') the nozzle separates (exit ' + fmt(D.exit.P / 1e3) + ' kPa, separation at ' + fmt(sepD.pSep / 1e3) + ' kPa), so a thrust coefficient for sizing is not defined.', what_would_help: 'A design ambient nearer vacuum, a smaller area ratio, or a higher chamber pressure.' });
          } else {
            var pd = performance(D.base, D.exit, damb.pa, lamv);
            var sz = size(opts.thrust, pd.cf, D.base.pc, D.base.cstar, opts.eps);
            if (sz.refusal) out.refusals.push(Object.assign({ applies_to: 'sizing' }, sz.refusal));
            else { sz.F = opts.thrust; sz.cf = pd.cf; sz.isp = pd.isp; sz.ambient = damb; sz.separation = sepD; out.sizing = sz; Rt = sz.Rt; }
          }
        }
      }
      var geomRt = Rt || 1;
      var geo = c.type === 'cone' ? coneContour(geomRt, opts.eps, c.alpha) : bellContour(geomRt, opts.eps, c.Lf);
      if (geo.refusal) out.refusals.push(Object.assign({ applies_to: 'contour' }, geo.refusal));
      else { geo.scaled = !!Rt; out.contour = geo; }
      return out;
    }

    // ------------------------------------------------------------------ sweeps for the charts
    /** Isp at each ambient pressure for one nozzle (exit state fixed), plus the ideally expanded envelope. */
    function ambientSweep(base, st, lam, pas) {
      return pas.map(function (pa, i) {
        var p = performance(base, st, pa, lam);
        var sep = separation(base.pc, pa, st.P);
        var row = { pa: pa, isp: p.isp, cf: p.cf, status: sep.status };
        if (pa > 0 && pa < base.throat.P) {
          var opt = stationAtPressure(base, pa);
          if (!opt.refusal && opt.eps <= EPS_ENVELOPE[1]) { row.ispOptimum = opt.u; row.epsOptimum = opt.eps; }
        }
        return row;
      });
    }
    /** Isp at ambient pa across area ratios (lamFn(eps) gives the divergence efficiency, or null for ideal). */
    function areaSweep(base, pa, epsList, lamFn) {
      var prev = null;
      return epsList.map(function (e) {
        var st = stationAtArea(base, e, prev);
        if (st.refusal) { prev = null; return { eps: e, refusal: st.refusal }; }
        var lv = lamFn ? lamFn(e) : 1;
        // review fix: a missing divergence efficiency refuses the point instead of silently becoming 1
        if (!(typeof lv === 'number' && isFinite(lv))) { prev = st; return { eps: e, refusal: refusal('insufficient_data', 'No divergence efficiency at area ratio ' + fmt(e) + '.', 'A contour inside the charts.') }; }
        var p = performance(base, st, pa, lv);
        var sep = separation(base.pc, pa, st.P);
        prev = st;
        return { eps: e, isp: p.isp, ispIdeal: st.Ivac - pa / st.G, pe: st.P, status: sep.status };
      });
    }

    // ------------------------------------------------------------------ real engines (SP-8120 Table I)
    function presetProp(presets, id) {
      for (var i = 0; i < presets.length; i++) if (presets[i].id === id) return { oxidizer: presets[i].oxidizer, fuel: presets[i].fuel, label: presets[i].label };
      return null;
    }
    /** Model the nozzle of one Table I engine and compare it with the table's thrust and specific impulse. */
    function engineCase(row, presets) {
      if (!row.prop) return { engine: row.engine, refusal: refusal('not_found', row.engine + ' burns ' + row.ox + '/' + row.fuel + ', which idea 31 has no thermodynamic data for.', 'NASA Glenn records for ' + (row.ox === 'IRFNA' ? 'inhibited red fuming nitric acid' : row.fuel) + ' in idea 31\'s excerpt.') };
      if (row.excluded) return { engine: row.engine, refusal: refusal('insufficient_data', row.engine + ': ' + row.excluded + '.', 'One operating point: thrust, chamber pressure and specific impulse together.') };
      var prop = presetProp(presets, row.prop);
      var pcChem = row.pc[0][0] * PSI;
      var pNoz = pcChem, pNozNote = row.pc[0][1];
      row.pc.forEach(function (p) { if (p[1] === 'throat' || p[1] === 'nozzle stagnation') { pNoz = p[0] * PSI; pNozNote = p[1]; } });
      var r = M.rocket(db, prop, row.mr, pcChem);
      if (r.refusal) return { engine: row.engine, refusal: r.refusal };
      var Rt = row.Dt * INCH / 2, eps = row.eps, lam, Lf = null, contourNote;
      if (/conical/i.test(row.exit)) { lam = lambdaCone(parseFloat(row.divergence)); contourNote = 'cone, ' + row.divergence + ' deg'; }
      else {
        if (row.L != null) { Lf = lengthFraction(row.L * INCH, Rt, eps); contourNote = 'bell, ' + fmt(Lf * 100, 3) + ' % of a 15-degree cone (from its length)'; }
        else { var m = /([0-9.]+)% bell/.exec(row.exit); Lf = m ? +m[1] / 100 : null; contourNote = row.exit; }
        lam = Lf == null ? { refusal: refusal('insufficient_data', 'No length.', 'The nozzle length.') } : lambdaBell(Math.min(Math.max(Lf, 0.6), 1), eps);
        if (Lf != null && (Lf < 0.6 || Lf > 1)) { lam.outsideChart = true; lam.note = 'its ' + fmt(Lf * 100, 3) + ' % length is outside the chart; the nearest end (60 or 100 %) is used'; }
      }
      var lamv = lam.refusal ? 1 : lam.value;
      var res = { engine: row.engine, application: row.application, prop: prop.label, mr: row.mr, pcChem: pcChem, pNozzle: pNoz, pNozzleNote: pNozNote, eps: eps, Lf: Lf, lambda: lam, contourNote: contourNote, points: [] };
      var flows = {};
      ['shifting', 'frozen'].forEach(function (mode) {
        var b = flow(r, mode); if (b.refusal) { flows[mode] = b; return; }
        var st = stationAtArea(b, eps); flows[mode] = st.refusal ? st : { base: b, exit: st };
      });
      res.cstarShifting = flows.shifting.base ? flows.shifting.base.cstar : null;
      res.flows = flows;
      row.isp.forEach(function (ip) {
        var cond = ip[1], pa = cond === 'sl' ? isa(0).P_Pa : 0;
        var pt = { condition: cond, pa: pa, ispPublished: ip[0] * g0 };
        ['shifting', 'frozen'].forEach(function (mode) {
          var f = flows[mode];
          if (!f || f.refusal) { pt[mode] = { refusal: f ? f.refusal : null }; return; }
          var p = performance(f.base, f.exit, pa, lamv);
          var sep = separation(f.base.pc, pa, f.exit.P);
          var o = { isp: p.isp, cf: p.cf, cstar: f.base.cstar, status: sep.status, gap: (pt.ispPublished - p.isp) / p.isp };
          if (sep.status === 'separated') {
            var br = sepBracket(f.base, f.exit, sep, pa, lamv, p);
            if (br.cut) { o.ispUpper = br.upper; o.epsSep = br.cut.eps; }
          }
          pt[mode] = o;
        });
        // the table's own thrust at the same condition gives a delivered C_F and c* (per chamber)
        var th = null;
        row.thrust.forEach(function (t) { if (t[1] === cond || (cond === 'alt' && t[1] === 'vac') || (cond === 'vac' && t[1] === 'alt')) th = t[0]; });
        if (typeof th === 'number') {
          var Fn = th * LBF / (row.chambers || 1), At = row.At * INCH * INCH;
          pt.thrustPublished = Fn;
          pt.cfDelivered = Fn / (pNoz * At);
          pt.cstarDelivered = pt.ispPublished / pt.cfDelivered;
          if (pt.shifting && pt.shifting.cf) { pt.cfEfficiency = pt.cfDelivered / pt.shifting.cf; pt.cstarEfficiency = pt.cstarDelivered / pt.shifting.cstar; }
        }
        res.points.push(pt);
      });
      return res;
    }

    // ------------------------------------------------------------------ handoff (series schema v1)
    var KERNEL = '32-bell/bell.js';
    function q(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }

    /**
     * The handoff module 33 imports. h31: idea 31's handoff for the chamber (imported, or built here with idea 31's
     * own makeHandoff); inputs: {eps, contour, ambient, design, freeze, thrust}; A: analyze() result.
     */
    function makeHandoff(h31, inputs, A, extra) {
      extra = extra || {};
      var src31 = function (o) { return Object.assign({}, o, { source: '31-mixture (passed through): ' + o.source }); };
      var out = {
        handoff: 'long-way-round', version: 1, from: '32-bell', produced: extra.produced || new Date().toISOString(),
        inputs: {
          preset: h31.inputs.preset, oxidizer: h31.inputs.oxidizer, fuel: h31.inputs.fuel,
          mixture_ratio: h31.inputs.mixture_ratio, chamber_pressure_Pa: h31.inputs.chamber_pressure_Pa,
          nozzle: { area_ratio: inputs.eps, contour: inputs.contour, ambient: inputs.ambient, design_flow: inputs.design || 'shifting', freeze_point: inputs.freeze || 'chamber', thrust_N: inputs.thrust == null ? null : inputs.thrust },
          chamber_handoff: h31,
        },
        outputs: {}, refusals: [],
        assumptions: [
          'Isentropic, adiabatic, one-dimensional expansion of ideal gases from idea 31\'s infinite-area-combustor chamber (NASA RP-1311 chapter 6); shifting equilibrium and frozen composition bound the real, finite-rate flow.',
          'Frozen composition from the ' + (inputs.freeze === 'throat' ? 'throat' : 'chamber') + '; species under 1e-10 mole fraction left out of the frozen mixture.',
          'Divergence efficiency applied to the vacuum thrust coefficient, as SP-125 Figure 4-12 defines it; no boundary-layer, kinetic or combustion-efficiency losses.',
          'Separation by SP-8120\'s criterion with the one-dimensional exit pressure standing for the exit wall pressure; a separated nozzle\'s thrust is bracketed, not predicted.',
          'C_F at ambient pa: C_F(pa) = C_F,vac - eps pa / pc while the nozzle flows full (pa below separation_onset_ambient_pressure).',
          'Frames and time scales: none (a nozzle has no position or epoch).',
        ].concat(extra.assumptions || []),
      };
      var O = out.outputs;
      ['mixture_ratio', 'chamber_pressure', 'chamber_temperature', 'cstar', 'oxidizer_density', 'fuel_density', 'bulk_density'].forEach(function (k) {
        if (h31.outputs && h31.outputs[k]) O[k === 'cstar' ? 'cstar_shifting' : k] = src31(h31.outputs[k]);
      });
      (h31.refusals || []).forEach(function (rf) { out.refusals.push(Object.assign({ from: '31-mixture' }, rf)); });
      (A.refusals || []).forEach(function (rf) { out.refusals.push(rf); });
      if (isFinite(inputs.eps)) O.area_ratio = q(inputs.eps, '1', 'assumed', 'user input (exit area / throat area)');
      var c = inputs.contour || {};
      O.contour_type = q(c.type || 'bell', '-', 'assumed', 'user input');
      if (c.type === 'cone' && isFinite(c.alpha)) O.cone_half_angle = q(c.alpha, 'deg', 'assumed', 'user input');
      if (c.type !== 'cone' && isFinite(c.Lf)) O.length_fraction = q(c.Lf, '1', 'assumed', 'user input (bell length / 15-degree cone length, SP-125)');
      if (A.ambient) O.ambient_pressure = q(A.ambient.pa, 'Pa', A.ambient.alt_m != null ? 'derived' : 'assumed', A.ambient.source);
      var fs = KERNEL + ' on 31-mixture/mixture.js and the same thermo.inp excerpt';
      ['shifting', 'frozen'].forEach(function (k) {
        var F = A.flows[k];
        if (!F || !F.exit) return;
        var tag = k === 'shifting' ? 'shifting equilibrium' : 'frozen at the ' + (A.frozenMode === 'frozen-throat' ? 'throat' : 'chamber');
        var s = fs + ' (' + tag + ')';
        O['exit_pressure_' + k] = q(F.exit.P, 'Pa', 'derived', s);
        O['exit_temperature_' + k] = q(F.exit.T, 'K', 'derived', s);
        O['exit_mach_' + k] = q(F.exit.mach, '1', 'derived', s);
        O['exit_velocity_' + k] = q(F.exit.u, 'm/s', 'derived', s);
        O['exit_molar_mass_' + k] = q(F.exit.M, 'kg/mol', 'derived', s);
        O['exit_gamma_' + k] = q(F.exit.gamma, '1', 'derived', s + (k === 'shifting' ? ' (gamma_s)' : ' (frozen cp/cv)'));
        O['thrust_coefficient_vacuum_ideal_' + k] = q(F.exit.cfVac, '1', 'derived', s + ' (no divergence loss)');
        O['specific_impulse_vacuum_ideal_' + k] = q(F.exit.Ivac, 'm/s', 'derived', s + ' (no divergence loss)');
        if (F.vac) {
          O['thrust_coefficient_vacuum_' + k] = q(F.vac.cfVac, '1', 'derived', s + ' x divergence efficiency');
          O['specific_impulse_vacuum_' + k] = q(F.vac.Ivac, 'm/s', 'derived', s + ' x divergence efficiency');
        } else {
          // review fix: no divergence efficiency, so no after-divergence numbers (the ideal ones above stand)
          var lr = A.lambdaRefused || {};
          out.refusals.push({ applies_to: 'specific_impulse_' + k, code: lr.code || 'insufficient_data', reason: 'No divergence efficiency for this contour (' + (lr.reason || 'refused') + '), so the ' + tag + ' thrust coefficient and specific impulse after divergence loss, in vacuum and at the ambient, are not given; the ideal-nozzle values (no divergence loss) are.',
            what_would_help: lr.what_would_help || 'A contour inside the charts.' });
        }
        if (k === 'frozen') O.cstar_frozen = q(F.base.cstar, 'm/s', 'derived', s + (A.frozenMode === 'frozen' ? ' (frozen throat)' : ' (equals the shifting c*: frozen after the throat)'));
        O['separation_onset_ambient_pressure_' + k] = q(F.sepOnset, 'Pa', 'derived', 'SP-8120 separation criterion (Schilling): ambient pressure at which the wall would separate at this exit pressure');
        O['separation_margin_ambient_pressure_' + k] = q(F.sepMarginOnset, 'Pa', 'derived', 'SP-8120: the ambient pressure at which the exit pressure is within 20 percent of separation');
        if (F.amb && F.sep && F.sep.status !== 'separated') {
          O['thrust_coefficient_ambient_' + k] = q(F.amb.cf, '1', 'derived', s + ' at the ambient pressure, flowing full (' + F.sep.status + ')');
          O['specific_impulse_ambient_' + k] = q(F.amb.isp, 'm/s', 'derived', s + ' at the ambient pressure, flowing full');
        } else if (F.sep && F.sep.status === 'separated') {
          out.refusals.push({ applies_to: 'specific_impulse_ambient_' + k, code: 'out_of_envelope', reason: 'At this ambient the ' + tag + ' nozzle separates (exit ' + fmt(F.exit.P / 1e3) + ' kPa, separation at ' + fmt(F.sep.pSep / 1e3) + ' kPa); a full-flowing C_F would be wrong and no separated-flow model is offered.',
            what_would_help: 'A smaller area ratio, a higher chamber pressure, or an ambient below ' + fmt(F.sepOnset / 1e3) + ' kPa.' + (F.bracket ? ' ' + bracketText(F.bracket) : '') });
        }
      });
      if (A.lambda) O.divergence_efficiency = q(A.lambda.value, '1', 'derived', A.lambda.source + (A.lambda.note ? '; ' + A.lambda.note : ''));
      if (A.contour) {
        var g = A.contour, cs = KERNEL + (g.type === 'bell' ? ' bellContour(): Rao parabola per SP-125 Fig 4-13, angles from SP-8120 Fig 5(b)' : ' coneContour(): SP-125 Fig 4-10 and eq 4-7');
        if (g.type === 'bell') {
          O.wall_angle_initial = q(g.thetaN, 'deg', 'derived', 'SP-8120 Figure 5(b), digitized' + (g.angles.dashed ? ' (SP-8120 draws this area ratio dashed: its own extrapolation)' : ''));
          O.wall_angle_exit = q(g.thetaE, 'deg', 'derived', 'SP-8120 Figure 5(b), digitized');
        }
        if (g.scaled) {
          O.nozzle_length = q(g.length, 'm', 'derived', cs + ', throat to exit plane');
          O.divergent_wetted_area = q(g.wettedArea, 'm^2', 'derived', cs + ', throat to exit');
          O.contour = q(g.points.map(function (p) { return [+p[0].toPrecision(6), +p[1].toPrecision(6)]; }), 'm', 'derived', cs + ' ([axial x from the throat, radius]; the first 13 points are the upstream throat arc)');
        } else {
          O.nozzle_length_per_throat_radius = q(g.length, '1', 'derived', cs + ' (no thrust given, so lengths are per unit throat radius)');
        }
      }
      if (A.sizing) {
        var z = A.sizing, ss = KERNEL + ' size(): At = F / (C_F pc), mdot = pc At / c* (' + A.design + ' flow, ideal c*)';
        O.design_thrust = q(z.F, 'N', 'assumed', 'user input');
        O.design_ambient_pressure = q(z.ambient.pa, 'Pa', z.ambient.alt_m != null ? 'derived' : 'assumed', z.ambient.source);
        O.thrust_coefficient_design = q(z.cf, '1', 'derived', ss);
        O.throat_area = q(z.At, 'm^2', 'derived', ss);
        O.throat_diameter = q(z.Dt, 'm', 'derived', ss);
        O.exit_area = q(z.Ae, 'm^2', 'derived', ss);
        O.exit_diameter = q(z.De, 'm', 'derived', ss);
        O.mass_flow = q(z.mdot, 'kg/s', 'derived', ss);
      }
      return out;
    }

    /** Read a handoff: idea 31's (a chamber) or this module's own (a chamber and a nozzle). */
    function parseHandoff(input) {
      var p = M.parseHandoff(input);
      if (p.refusal) return p;
      var h = p.handoff, chamberH = h;
      if (h.from === '32-bell') {
        chamberH = h.inputs && h.inputs.chamber_handoff;
        if (!chamberH || chamberH.from !== '31-mixture') return { refusal: refusal('insufficient_data', 'This 32-bell handoff does not carry the chamber handoff it was built from.', 'A handoff exported by this page, or one from 31-mixture.') };
      } else if (h.from !== '31-mixture') {
        return { refusal: refusal('invalid_input', 'A handoff from ' + (h.from || 'an unknown module') + ' is not a chamber; this module reads idea 31\'s handoff (or its own).', 'A handoff exported by 31-mixture.') };
      }
      var res = { handoff: h, chamberHandoff: chamberH, inputs: p.inputs };
      if (h.from === '32-bell') res.nozzle = h.inputs.nozzle;
      return res;
    }
    /**
     * Recompute idea 31's chamber for a handoff's inputs with idea 31's own kernel and check it is the state the
     * handoff states (c*, chamber temperature and entropy to 1e-8). A mismatch means other data or an edit.
     */
    function chamberFromHandoff(chamberH, inputs) {
      var r = M.rocket(db, { oxidizer: inputs.oxidizer, fuel: inputs.fuel }, inputs.of, inputs.pc);
      var O = chamberH.outputs || {};
      if (r.refusal) {
        var up = (chamberH.refusals || []).filter(function (x) { return !x.applies_to; })[0];
        return { refusal: up ? Object.assign({}, up, { reason: 'Refused upstream by 31-mixture: ' + up.reason }) : r.refusal };
      }
      var checks = [['cstar', r.cstar], ['chamber_temperature', r.chamber.T], ['chamber_entropy', r.chamber.s]];
      for (var i = 0; i < checks.length; i++) {
        var o = O[checks[i][0]];
        if (!o || typeof o.value !== 'number') return { refusal: refusal('insufficient_data', 'The chamber handoff has no ' + checks[i][0] + ' although idea 31\'s kernel computes one for its inputs.', 'The unedited handoff 31-mixture exported.') };
        if (Math.abs(o.value / checks[i][1] - 1) > 1e-8) {
          return { refusal: refusal('invalid_input', 'The handoff says ' + checks[i][0] + ' = ' + fmt(o.value, 9) + ', but idea 31\'s kernel computes ' + fmt(checks[i][1], 9) + ' for its inputs: it was made with other data or edited, so its chamber cannot be expanded here.', 'The unedited handoff 31-mixture exported, made with thermo.inp sha256 fa774657...') };
        }
      }
      return r;
    }

    /**
     * Idea 31's handoff for a chamber chosen on this page, built the way idea 31's page builds it (its rocket(),
     * sideDensity(), stoichiometricOF() and makeHandoff(), unmodified), so the stand-alone path and the import
     * path feed the nozzle the same object. sel = {preset, oxidizer, fuel, of, pc}.
     */
    function chamberHandoff(sel, densities, thermo, produced) {
      var r = M.rocket(db, { oxidizer: sel.oxidizer, fuel: sel.fuel }, sel.of, sel.pc);
      var dens = densities ? { oxidizer: M.sideDensity(densities, sel.oxidizer, 'oxidizer'), fuel: M.sideDensity(densities, sel.fuel, 'fuel') } : null;
      var h = M.makeHandoff(sel, r, dens, { produced: produced, stoichiometric_mixture_ratio: M.stoichiometricOF(db, sel.oxidizer, sel.fuel), thermo: thermo,
        assumptions: ['Built stand-alone on the 32-bell page with idea 31\'s kernel and makeHandoff(), unmodified.'] });
      return { handoff: h, rocket: r };
    }

    return {
      chamberHandoff: chamberHandoff,
      flow: flow, stationAtPressure: stationAtPressure, stationAtArea: stationAtArea, performance: performance,
      ambient: ambient, altitudeOfPressure: altitudeOfPressure, separation: separation, separationAmbient: separationAmbient,
      lambdaCone: lambdaCone, lambdaBell: lambdaBell, raoAngles: raoAngles, referenceConeLength: referenceConeLength, lengthFraction: lengthFraction,
      bellContour: bellContour, coneContour: coneContour, size: size, analyze: analyze,
      ambientSweep: ambientSweep, areaSweep: areaSweep, engineCase: engineCase, sepBracket: sepBracket, bracketText: bracketText,
      makeHandoff: makeHandoff, parseHandoff: parseHandoff, chamberFromHandoff: chamberFromHandoff,
      g0: g0,
    };
  }

  return { create: create, EPS_ENVELOPE: EPS_ENVELOPE, FROZEN_TRACE: FROZEN_TRACE, PSI: PSI, INCH: INCH, LBF: LBF, machFromArea: machFromArea, interp1: interp1 };
});
