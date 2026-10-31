/* Engine Deck: a whole liquid rocket engine. Thrust, specific impulse and mass flow against altitude and throttle,
 * and the pump-fed cycle's power balance (gas generator, staged combustion, expander), with real engines as presets
 * beside their published figures.
 *
 * Idea 33 of the Aster Idea Bank, module 3 of "The Long Way Round". A pure kernel: no DOM, no network. It has no
 * physics of its own for the chamber or the nozzle: at every throttle point it re-runs idea 31's chamber
 * (snapshots/mixture.js, unmodified) and idea 32's nozzle (snapshots/bell.js, unmodified); turbine drive gas is
 * idea 31's equilibrium too, or NASA SP-8110's tabulated gas where idea 31 must refuse (fuel-rich kerosene deposits
 * graphite). What is new here:
 *
 *   delivered performance   c*_del = eta_c* c*; CF_vac,del = eta_CF lambda CF_vac,ideal (idea 32's lambda);
 *                           F(pa) = (CF_vac,del - eps pa/pc) pc At; mdot = pc At / c*_del; Isp = F / mdot.
 *                           So F(pa) = F_vac - pa Ae while the nozzle flows full (idea 32's separation test).
 *   pumps                   power = mdot dp / (rho eta_p)  (incompressible; head = dp / (rho g0))
 *   turbines                isentropic enthalpy drop over the pressure ratio: idea 31's SP equilibrium for
 *                           equilibrium gas; cp T (1 - PR^-(gamma-1)/gamma) for a tabulated (SP-8110) or ideal
 *                           hydrogen gas with inlet properties; power = mdot eta_t dh_is.
 *   gas generator (open)    the turbine flow that balances the pumps: mdot_gg = sum(mdot_i w_i) / (eta dh - sum x_i w_i);
 *                           the engine's Isp is bracketed between dumping that flow with no thrust and expanding it
 *                           completely (u <= sqrt(2 cp T_out)).
 *   staged combustion       the turbine pressure ratio that balances the pumps when the turbine sits between the
 *   and expander (closed)   pumps and the chamber: pump discharge pressures rise with it, so it is solved, and a
 *                           cycle that cannot close is refused with how far short it falls.
 *
 * Every cycle parameter (pressure-ladder ratios, efficiencies, turbine inlet temperatures, pressure ratios, flow
 * routing) is computed from a published engine (SP-8107's 1973 tables; NASA TM-107318's RL10A-3-3A cycle), never
 * typed: an engine you build is run "with the F-1's ladder" and says so.
 *
 * Units: SI throughout (Pa, K, kg, s, m, W, J/kg; Isp in m/s). English units only in the published tables and
 * their checks, converted with exact definitions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EngineDeck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [Certain] Exact unit definitions: 1 lb = 0.45359237 kg, standard gravity 9.80665 m/s^2, 1 ft = 0.3048 m,
  // 1 hp = 550 ft lbf/s, 1 Btu(IT)/lb = 2326 J/kg, 1 Btu(IT)/(lb degR) = 4186.8 J/(kg K).
  var LBM = 0.45359237, G_STD = 9.80665, FT = 0.3048, INCH = 0.0254;
  var LBF = LBM * G_STD, PSI = LBF / (INCH * INCH), HP = 550 * FT * LBF;
  var BTU_PER_LB = 2326, BTU_PER_LB_R = 4186.8, FTLBF_PER_LBM_R = FT * LBF / LBM * 1.8, LB_FT3 = LBM / (FT * FT * FT);
  function FtoK(f) { return (f + 459.67) / 1.8; }
  function KtoF(k) { return k * 1.8 - 459.67; }
  function RtoK(r) { return r / 1.8; }
  // Altitudes (m) the deck table is printed at; null is vacuum. The 1976 table ends at 86 km (idea 32's isa()).
  var DECK_ALTITUDES = [0, 2000, 5000, 10000, 15000, 20000, 30000, 40000, 50000, 70000, 86000, null];
  // Efficiencies a user may type (calibrations may exceed 1 when a source's pressures are not on one basis; see README).
  var ETA_ENVELOPE = [0.5, 1.1];

  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function fmt(v, d) { return (typeof v === 'number' && isFinite(v)) ? +v.toPrecision(d || 4) + '' : String(v); }
  function lerp(xs, ys, x) {
    for (var i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
    return ys[ys.length - 1];
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }

  function create(deps) {
    var M = deps.Mixture, db = deps.db, B = deps.B, TD = deps.turbo, ROWS = deps.table, PRE = deps.presets, DENS = deps.densities, isa = deps.isa, g0 = deps.g0;
    var R = M.R, H2 = db.products.H2;

    function presetProp(id) {
      for (var i = 0; i < PRE.length; i++) if (PRE[i].id === id) return { id: id, oxidizer: PRE[i].oxidizer, fuel: PRE[i].fuel, label: PRE[i].label };
      return null;
    }
    function propKey(prop) { return JSON.stringify([prop.oxidizer, prop.fuel]); }
    function densities(prop) {
      return { ox: M.sideDensity(DENS, prop.oxidizer, 'oxidizer'), fuel: M.sideDensity(DENS, prop.fuel, 'fuel') };
    }

    // ================================================================== thrust chamber deck
    /**
     * An engine context. spec: {prop, of, pc (nominal, Pa), eps, contour: {type:'bell', Lf}|{type:'cone', alpha},
     * mode: 'shifting'|'frozen', freeze: 'chamber'|'throat', At (m^2), etaCstar, etaCF}.
     */
    function context(spec) {
      var c = { spec: spec, refusals: [], cache: {} };
      var ct = spec.contour || {};
      var lam = ct.type === 'cone' ? B.lambdaCone(ct.alpha) : B.lambdaBell(ct.Lf, spec.eps);
      if (lam.refusal) { c.refusals.push(Object.assign({ applies_to: 'divergence_efficiency' }, lam.refusal)); c.lambda = null; } else c.lambda = lam;
      if (!(typeof spec.At === 'number' && isFinite(spec.At) && spec.At > 0)) {
        c.refusals.push(refusal('insufficient_data', 'No throat area, so there is no thrust or mass flow, only specific impulse and thrust coefficient.', 'A thrust to size the throat for (here, or in idea 32), or an engine preset with a published throat area.', { applies_to: 'throat_area' }));
      }
      ['etaCstar', 'etaCF'].forEach(function (k) {
        var v = spec[k];
        if (!(typeof v === 'number' && isFinite(v))) c.refusals.push(refusal('invalid_input', 'The ' + (k === 'etaCstar' ? 'c* efficiency' : 'thrust-coefficient efficiency') + ' must be a number.', 'A number between ' + ETA_ENVELOPE[0] + ' and ' + ETA_ENVELOPE[1] + ' (1 is the ideal).', { applies_to: k }));
        else if (v < ETA_ENVELOPE[0] || v > ETA_ENVELOPE[1]) c.refusals.push(refusal('out_of_envelope', 'An efficiency of ' + fmt(v) + ' is outside ' + ETA_ENVELOPE[0] + ' to ' + ETA_ENVELOPE[1] + '.', 'A value nearer 1; real engines deliver a few percent below the ideal (idea 32: 2.1 to 9.0 % in Isp).', { applies_to: k }));
      });
      c.ok = !c.refusals.some(function (r) { return r.applies_to !== 'throat_area'; });
      return c;
    }
    /** Idea 31's chamber and idea 32's exit station at chamber pressure pc (cached per pc). */
    function flowAt(c, pc) {
      var key = String(pc);
      if (c.cache[key]) return c.cache[key];
      var s = c.spec;
      var r = M.rocket(db, s.prop, s.of, pc);
      var out;
      if (r.refusal) out = { refusal: r.refusal };
      else {
        var b = B.flow(r, s.mode === 'frozen' ? (s.freeze === 'throat' ? 'frozen-throat' : 'frozen') : 'shifting');
        if (b.refusal) out = { refusal: b.refusal };
        else {
          var st = B.stationAtArea(b, s.eps);
          out = st.refusal ? { refusal: st.refusal } : { rocket: r, base: b, exit: st };
        }
      }
      c.cache[key] = out;
      return out;
    }
    /** One operating point: chamber pressure pc (Pa) at ambient pressure pa (Pa). */
    function point(c, pc, pa) {
      var s = c.spec, o = { pc: pc, pa: pa, throttle: pc / s.pc };
      if (!c.ok) { o.refusal = c.refusals.filter(function (r) { return r.applies_to !== 'throat_area'; })[0]; return o; }
      var f = flowAt(c, pc);
      if (f.refusal) { o.refusal = f.refusal; return o; }
      var perf = B.performance(f.base, f.exit, pa, c.lambda.value);
      o.cstarIdeal = f.base.cstar; o.cstar = s.etaCstar * f.base.cstar;
      o.cfVacIdeal = perf.cfVacIdeal; o.cfVac = s.etaCF * perf.cfVac;
      o.cf = o.cfVac - s.eps * pa / pc;
      o.ispVac = o.cfVac * o.cstar; o.ispVacIdeal = perf.IvacIdeal;
      o.pe = f.exit.P; o.Te = f.exit.T;
      o.sep = B.separation(pc, pa, f.exit.P);
      o.status = o.sep.status;
      o.sepOnset = B.separationAmbient(pc, f.exit.P, false);
      o.sepMargin = B.separationAmbient(pc, f.exit.P, true);
      var At = s.At > 0 ? s.At : null;
      if (At) {
        o.mdot = pc * At / o.cstar;
        o.mdotOx = o.mdot * s.of / (1 + s.of); o.mdotFuel = o.mdot / (1 + s.of);
        o.Fvac = o.cfVac * pc * At; o.Ae = s.eps * At;
      }
      if (o.sep.status === 'separated') {
        o.refusal = refusal('out_of_envelope', 'At ' + fmt(pc / 1e5) + ' bar chamber and ' + fmt(pa / 1e3) + ' kPa ambient the nozzle separates (exit ' + fmt(f.exit.P / 1e3) + ' kPa, SP-8120 separation at ' + fmt(o.sep.pSep / 1e3) + ' kPa): a full-flowing thrust would be wrong and no separated-flow model is offered.',
          'A higher throttle, a smaller area ratio, or an ambient below ' + fmt(o.sepOnset / 1e3) + ' kPa.', { applies_to: 'thrust' });
      } else if (!(o.cf > 0)) {
        o.refusal = refusal('out_of_envelope', 'The thrust coefficient at this ambient is ' + fmt(o.cf) + ': the engine would not push.', 'A lower ambient pressure or a higher chamber pressure.', { applies_to: 'thrust' });
      } else {
        o.isp = o.cf * o.cstar;
        if (At) o.F = o.cf * pc * At;
      }
      return o;
    }
    /** Ambient pressure (Pa) at geometric altitude z (m), or 0 for null (vacuum); refuses outside the 1976 table. */
    function ambientAt(z) {
      if (z == null) return { pa: 0, label: 'vacuum' };
      var a = B.ambient({ kind: 'altitude', alt_m: z });
      return a.refusal ? a : { pa: a.pa, label: fmt(z / 1e3, 3) + ' km' };
    }
    /** The deck: every throttle (fraction of nominal pc) at every altitude (m, null = vacuum). */
    function deck(c, throttles, altitudes) {
      altitudes = altitudes || DECK_ALTITUDES;
      var amb = altitudes.map(ambientAt);
      var rows = throttles.map(function (tau) {
        var pc = tau * c.spec.pc;
        var cells = amb.map(function (a, i) {
          if (a.refusal) return { alt: altitudes[i], refusal: a.refusal };
          var p = point(c, pc, a.pa);
          p.alt = altitudes[i];
          return p;
        });
        var vac = point(c, pc, 0);
        var onsetAlt = vac.sepOnset != null ? B.altitudeOfPressure(vac.sepOnset) : null;
        return { throttle: tau, pc: pc, cells: cells, vac: vac, sepOnsetAltitude: onsetAlt, flowsFullAtSeaLevel: vac.sepOnset > isa(0).P_Pa };
      });
      return { throttles: throttles, altitudes: altitudes, rows: rows };
    }
    /** The lowest throttle (fraction of nominal) at which the nozzle still flows full at ambient pa, by bisection. */
    function minThrottleFull(c, pa, lo, hi) {
      lo = lo || 0.05; hi = hi || 1.2;
      var full = function (t) { var p = point(c, t * c.spec.pc, pa); return !p.refusal || p.refusal.applies_to !== 'thrust' ? (!p.refusal) : false; };
      if (!full(hi)) return { refusal: refusal('out_of_envelope', 'The nozzle separates at this ambient even at ' + fmt(hi * 100, 3) + ' % throttle.', 'A smaller area ratio or a lower ambient pressure.') };
      if (full(lo)) return { throttle: lo, atFloor: true };
      for (var i = 0; i < 40 && hi - lo > 1e-4; i++) { var m = (lo + hi) / 2; if (full(m)) hi = m; else lo = m; }
      return { throttle: hi };
    }
    /**
     * Calibrate eta_c* and eta_CF so the deck reproduces one published operating point: thrust F (N) and specific
     * impulse isp (m/s) at ambient pa, chamber pressure c.spec.pc and throat area c.spec.At.
     */
    function calibrate(c, F, isp, pa) {
      var save = [c.spec.etaCstar, c.spec.etaCF];
      c.spec.etaCstar = 1; c.spec.etaCF = 1;
      var p = point(c, c.spec.pc, pa);
      c.spec.etaCstar = save[0]; c.spec.etaCF = save[1];
      if (p.refusal && p.refusal.applies_to !== 'thrust') return { refusal: p.refusal };
      var mdot = F / isp, s = c.spec;
      var etaCstar = s.pc * s.At / mdot / p.cstarIdeal;
      var cfDel = F / (s.pc * s.At);
      var etaCF = (cfDel + s.eps * pa / s.pc) / (p.cfVacIdeal * c.lambda.value);
      return { etaCstar: etaCstar, etaCF: etaCF, mdot: mdot, cstarIdeal: p.cstarIdeal, cfVacIdeal: p.cfVacIdeal, lambda: c.lambda.value,
        exceedsUnity: etaCstar > 1 || etaCF > 1 };
    }

    // ================================================================== turbine drive gas
    function gasFromEq(e, extra) {
      var g = { kind: 'equilibrium', T: e.T, p: e.P, h: e.h, s: e.s, cp: e.cp_fr, gamma: e.gamma_fr, gammaS: e.gamma_s, M: e.M, b0: e.b0, raw: e };
      if (extra) for (var k in extra) g[k] = extra[k];
      return g;
    }
    function condensedRefusal(e, where) {
      var nm = e.condensed.map(function (x) { return x.species; }).join(' and ');
      return refusal('out_of_envelope', 'At ' + where + ' (' + e.T.toFixed(0) + ' K, ' + fmt(e.P / 1e5) + ' bar) equilibrium would deposit ' + nm + '; idea 31\'s kernel is gas-only.',
        'A tabulated drive gas from a source (NASA SP-8110 Table III has fuel-rich LOX/RP-1), or a less fuel-rich mixture.');
    }
    /** Adiabatic gas generator / preburner gas: idea 31's HP equilibrium of prop at mixture ratio of and pressure p. */
    function gasEq(prop, of, p) {
      var mix = M.composeReactants(db, prop.oxidizer, prop.fuel, of);
      if (mix.refusal) return { refusal: mix.refusal };
      var e = M.equilibrate(db, mix.b0, p, { mode: 'HP', h: mix.h0 });
      if (e.refusal) return { refusal: e.refusal };
      if (e.condensed && e.condensed.length) return { refusal: condensedRefusal(e, 'the gas generator') };
      return gasFromEq(e, { prop: prop, of: of, source: '31-mixture equilibrate() HP at O/F ' + fmt(of, 5) });
    }
    /**
     * The gas generator mixture ratio whose adiabatic flame temperature is T (K) at pressure p, on the fuel-rich
     * ('fuel') or oxidizer-rich ('ox') side of stoichiometric, by safeguarded secant in ln(O/F).
     */
    function gasAtTemperature(prop, T, p, side) {
      var st = M.stoichiometricOF(db, prop.oxidizer, prop.fuel);
      if (!(st > 0)) return { refusal: refusal('invalid_input', 'No stoichiometric mixture ratio for this pair.', 'An oxidizer and a fuel.') };
      if (!(typeof T === 'number' && T > 0 && isFinite(T))) return { refusal: refusal('invalid_input', 'A drive-gas temperature must be a positive number of kelvin.', 'A turbine inlet temperature from a source.') };
      // d(x) = +(T(x) - T) on the fuel-rich side (x = ln O/F, T rises toward stoichiometric), -(T(x) - T) on the
      // oxidizer-rich side; march out from stoichiometric in steps of ln 1.5 until the flame is colder than T.
      var f = function (x) { var g = gasEq(prop, Math.exp(x), p); return g.refusal ? g : { g: g, d: (side === 'ox' ? -1 : 1) * (g.T - T) }; };
      var x0 = Math.log(st), f0 = f(x0), step = Math.log(1.5) * (side === 'ox' ? 1 : -1);
      if (f0.refusal) return f0;
      var noMix = function (why) { return { refusal: refusal('out_of_envelope', 'No ' + (side === 'ox' ? 'oxidizer' : 'fuel') + '-rich mixture of this pair burns at ' + fmt(T) + ' K (' + fmt(KtoF(T), 4) + ' F) at ' + fmt(p / 1e5) + ' bar' + (why ? ': ' + why : '') + '.', 'A temperature between the reactants\' and the stoichiometric flame temperature that the kernel can reach.') }; };
      if (!((side === 'ox' ? -f0.d : f0.d) > 0)) return noMix('even the stoichiometric flame is colder');
      var xa = x0, fa0 = f0, xb = null, fb0 = null;
      for (var j = 0; j < 40; j++) {
        var xn = xa + step, fn = f(xn);
        if (fn.refusal) return noMix('the kernel refuses before the flame is that cold (' + fn.refusal.reason + ')');
        if ((side === 'ox' ? -fn.d : fn.d) <= 0) { xb = xn; fb0 = fn; break; }
        xa = xn; fa0 = fn;
      }
      if (xb == null) return noMix('not within a factor 1e7 of stoichiometric');
      var lo = side === 'ox' ? xa : xb, hi = side === 'ox' ? xb : xa, flo = side === 'ox' ? fa0 : fb0, fhi = side === 'ox' ? fb0 : fa0;
      var best = null;
      for (var k = 0; k < 60; k++) {
        var x = hi - fhi.d * (hi - lo) / (fhi.d - flo.d);
        if (!(x > lo && x < hi)) x = (lo + hi) / 2;
        var fx = f(x);
        if (fx.refusal) return fx;
        best = fx.g;
        if (Math.abs(fx.d) < 1e-9 * T) break;
        if (fx.d < 0) { lo = x; flo = fx; fhi.d /= 2; } else { hi = x; fhi = fx; flo.d /= 2; }
      }
      best.source = '31-mixture equilibrate() HP; O/F ' + fmt(best.of, 6) + ' found to burn at ' + fmt(T, 6) + ' K';
      return best;
    }
    /** The gas of mixture g (same elements) at temperature T and pressure p (TP equilibrium). */
    function gasTP(g, T, p) {
      var e = M.equilibrate(db, g.b0, p, { mode: 'TP', T: T, start: g.raw });
      if (e.refusal) return { refusal: e.refusal };
      if (e.condensed && e.condensed.length) return { refusal: condensedRefusal(e, 'the turbine inlet') };
      return gasFromEq(e, { prop: g.prop, of: g.of, source: '31-mixture equilibrate() TP at ' + fmt(T, 6) + ' K, O/F ' + fmt(g.of, 6) });
    }
    /** SP-8110 Table III gas properties interpolated linearly in temperature; never extrapolated. */
    function gasTab(name, T) {
      var t = TD.SP8110_GAS[name];
      if (!t) return { refusal: refusal('not_found', 'SP-8110 Table III has no ' + name + ' drive gas.', 'Gas properties for this pair from a source.') };
      var F = KtoF(T);
      if (!(F >= t.T[0] - 1e-6 && F <= t.T[t.T.length - 1] + 1e-6)) {
        return { refusal: refusal('out_of_envelope', 'SP-8110 Table III tabulates ' + name + ' turbine gas from ' + t.T[0] + ' to ' + t.T[t.T.length - 1] + ' F; ' + fmt(F, 4) + ' F is outside it and the table is not extrapolated.', 'A turbine inlet temperature inside the table, or a computed gas (idea 31) where it applies.') };
      }
      var gamma = lerp(t.T, t.gamma, F), cp = lerp(t.T, t.cp, F) * BTU_PER_LB_R, Rg = lerp(t.T, t.R, F) * FTLBF_PER_LBM_R;
      return { kind: 'tabulated', name: name, T: T, gamma: gamma, cp: cp, Rgas: Rg, source: 'NASA SP-8110 Table III, ' + name + (t.pSource ? ' (source chamber ' + t.pSource + ' psi)' : '') + ', interpolated at ' + fmt(F, 5) + ' F' };
    }
    /** Ideal-gas hydrogen at T from the NASA Glenn H2 record (idea 31's excerpt); refuses below its fitted range. */
    function gasH2(T, p) {
      var th = M.thermoAt(H2, T);
      if (!th) return { refusal: refusal('out_of_envelope', 'The NASA Glenn H2 fit in idea 31\'s excerpt starts at ' + H2.intervals[0].Tmin + ' K; ' + fmt(T, 5) + ' K (' + fmt(KtoF(T), 4) + ' F) is below it and the fit is not extrapolated.', 'A turbine inlet temperature of ' + H2.intervals[0].Tmin + ' K or more, or real-fluid hydrogen data (NIST) for colder gas.') };
      var Rg = R / H2.M, cp = th.cp * Rg;
      return { kind: 'hydrogen', T: T, p: p, cp: cp, gamma: cp / (cp - Rg), Rgas: Rg, source: 'NASA Glenn H2 (ideal gas) via idea 31\'s thermo excerpt, cp at the turbine inlet' };
    }
    /**
     * One turbine (stage group): gas g at its inlet, pressure ratio pr (inlet total / outlet), efficiency eta.
     * Returns {dhIs, dh, Tis, out} where out is the actual outlet gas (for a turbine in series).
     */
    function turbine(g, pin, pr, eta) {
      if (!(typeof pr === 'number' && isFinite(pr) && pr > 1)) return { refusal: refusal('invalid_input', 'A turbine pressure ratio must be a number above 1.', 'A pressure ratio such as SP-8107 Table III\'s.') };
      var pout = pin / pr;
      if (g.kind === 'equilibrium') {
        var g0p = g;
        if (Math.abs(g.p / pin - 1) > 1e-12) {
          var e0 = M.equilibrate(db, g.b0, pin, { mode: 'TP', T: g.T, start: g.raw });
          g0p = gasFromEq(e0, { prop: g.prop, of: g.of });
        }
        var e = M.equilibrate(db, g0p.b0, pout, { mode: 'SP', s: g0p.s, start: g0p.raw });
        if (e.refusal) return { refusal: e.refusal };
        if (e.condensed && e.condensed.length) return { refusal: condensedRefusal(e, 'the turbine exit') };
        var dhIs = g0p.h - e.h, hOut = g0p.h - eta * dhIs;
        var a = M.equilibrate(db, g0p.b0, pout, { mode: 'HP', h: hOut, start: e });
        if (a.refusal) return { refusal: a.refusal };
        return { dhIs: dhIs, dh: eta * dhIs, Tis: e.T, pout: pout, out: gasFromEq(a, { prop: g.prop, of: g.of }), method: 'shifting equilibrium (idea 31 SP)' };
      }
      var x = Math.pow(pr, -(g.gamma - 1) / g.gamma);
      var dh = g.cp * g.T * (1 - x);
      var Tout = g.T - eta * dh / g.cp;
      var out = Object.assign({}, g, { T: Tout, p: pout });
      return { dhIs: dh, dh: eta * dh, Tis: g.T * x, pout: pout, out: out, method: 'calorically perfect, inlet cp and gamma' };
    }
    /** The pressure ratio at which turbine gas g yields isentropic drop dhIs (perfect-gas closed form; for equilibrium, bisection). */
    function pressureRatioFor(g, pin, dhIs) {
      if (g.kind !== 'equilibrium') {
        var y = 1 - dhIs / (g.cp * g.T);
        if (!(y > 0)) return { refusal: refusal('out_of_envelope', 'No pressure ratio extracts that much work from this gas.', 'A hotter or richer drive gas.') };
        return { pr: Math.pow(y, -g.gamma / (g.gamma - 1)) };
      }
      var lo = 1, hi = 2;
      while (true) { var t = turbine(g, pin, hi, 1); if (t.refusal) return t; if (t.dhIs >= dhIs) break; lo = hi; hi *= 2; if (hi > 1e3) return { refusal: refusal('out_of_envelope', 'No pressure ratio below 1000 gives that much work.', 'A hotter drive gas.') }; }
      for (var k = 0; k < 80 && hi / lo - 1 > 1e-12; k++) { var m = Math.sqrt(lo * hi); var tm = turbine(g, pin, m, 1); if (tm.refusal) return tm; if (tm.dhIs < dhIs) lo = m; else hi = m; }
      return { pr: Math.sqrt(lo * hi) };
    }

    // ================================================================== pumps
    /** Pump: mass flow (kg/s), inlet and outlet pressure (Pa), density (kg/m^3), efficiency. */
    function pump(mdot, pin, pout, rho, eta) {
      var dp = pout - pin;
      return { dp: dp, head: dp / (rho * g0), work: dp / (rho * eta), power: mdot * dp / (rho * eta) };
    }

    // ================================================================== published turbomachinery (SP-8107, SP-8110, TM-107318)
    function t1(engine) { return TD.SP8107_T1.filter(function (r) { return r.engine === engine; })[0] || null; }
    function pumpsOf(engine) { return TD.SP8107_PUMPS.filter(function (r) { return r.engine === engine; }); }
    function turbinesOf(engine) { return TD.SP8107_TURBINES.filter(function (r) { return r.engine === engine; }); }
    function isOx(fluid) { return /oxygen|N2O4|IRFNA/i.test(fluid); }
    var GAS_TABLE = { 'O2/RP-1': 'LOX/RP-1', 'O2/H2': 'LOX/LH2', 'N2O4/A-50': 'N2O4/50-50', 'Hydrogen': 'Hydrogen' };
    var GAS_PROP = { 'O2/H2': 'lox-lh2', 'O2/RP-1': 'lox-rp1', 'N2O4/A-50': 'nto-a50' };

    /** One SP-8107 Table II pump: the head its pressures and density imply, and the power its head, flow and efficiency imply. */
    function pumpCheck(row) {
      var out = { engine: row.engine, fluid: row.fluid, headPublished: row.head, powerPublished: row.hp };
      out.headFromPressure = (row.pd - row.pin) * 144 / row.rho; // ft: psi x 144 in^2/ft^2 / (lbm/ft^3), lbf = lbm at standard g
      out.headGap = out.headFromPressure / row.head - 1;
      if (row.eff == null) { out.refusal = refusal('insufficient_data', row.engine + ' ' + row.fluid + ' pump: SP-8107 Table II prints no efficiency, so no power can be computed.', 'The pump efficiency.'); return out; }
      var p = row.w * row.head / (row.eff / 100) / 550; // hp
      if (row.second) { out.secondStage = row.second.w * row.second.head / (row.second.eff / 100) / 550; p += out.secondStage; }
      out.power = p;
      if (row.hp != null) out.powerGap = p / row.hp - 1;
      return out;
    }
    /**
     * One SP-8107 Table III turbine: power from flow x efficiency x isentropic drop, with the drive gas from
     * SP-8110 Table III ('table') and, for O2/H2 and hydrogen, from idea 31 ('computed').
     */
    function turbineCheck(row) {
      var out = { engine: row.engine, turbine: row.turbine || '', fluid: row.fluid, powerPublished: row.hp, methods: {} };
      var T = FtoK(row.Tin), pin = row.pin * PSI;
      if (row.eff == null) { out.refusal = refusal('insufficient_data', row.engine + ' turbine: SP-8107 Table III prints no efficiency.', 'The turbine efficiency.'); return out; }
      var eta = row.eff / 100, w = row.w * LBM;
      var finish = function (g, label) {
        if (g.refusal) { out.methods[label] = { refusal: g.refusal }; return; }
        var t = turbine(g, pin, row.pr, eta);
        if (t.refusal) { out.methods[label] = { refusal: t.refusal }; return; }
        var P = w * t.dh / HP;
        out.methods[label] = { power: P, gap: P / row.hp - 1, dhIs: t.dhIs, Tout: t.out.T, gas: g, source: g.source };
      };
      var tab = GAS_TABLE[row.fluid];
      if (tab) finish(gasTab(tab, T), 'table');
      else out.methods.table = { refusal: refusal('not_found', 'SP-8110 Table III has no ' + row.fluid + ' gas.', 'Drive-gas properties for ' + row.fluid + '.') };
      if (row.fluid === 'O2/H2') {
        if (row.engine === 'J-2' && row.turbine === 'Oxidizer') {
          // In series after the fuel turbine: the gas generator's mixture (the O/F that burns at the fuel turbine's
          // inlet temperature), at this turbine's own published inlet temperature and pressure.
          var fuelRow = turbinesOf('J-2').filter(function (r) { return r.turbine === 'Fuel'; })[0];
          var gg = gasAtTemperature(presetProp('lox-lh2'), FtoK(fuelRow.Tin), fuelRow.pin * PSI, 'fuel');
          finish(gg.refusal ? gg : gasTP(gg, T, pin), 'computed');
        } else finish(gasAtTemperature(presetProp('lox-lh2'), T, pin, 'fuel'), 'computed');
      } else if (row.fluid === 'Hydrogen') finish(gasH2(T, pin), 'computed');
      else if (GAS_PROP[row.fluid]) {
        var g = gasAtTemperature(presetProp(GAS_PROP[row.fluid]), T, pin, 'fuel');
        finish(g, 'computed');
      } else out.methods.computed = { refusal: refusal('not_found', 'Idea 31 has no thermodynamic data for ' + row.fluid + '.', 'NASA Glenn records for its propellants.') };
      out.powerFromPumps = pumpsOf(row.engine).filter(function (p) { return row.drives.indexOf(p.fluid) >= 0; }).reduce(function (a, p) { return a + (p.hp || 0); }, 0);
      return out;
    }
    /**
     * The turbine flow a gas-generator engine's pumps demand, from SP-8107 alone: pump powers from Table II's head,
     * flow and efficiency; turbine work per kilogram from Table III's inlet temperature, pressure ratio and
     * efficiency on SP-8110's gas (or idea 31's). Compared with Table III's published turbine flow.
     */
    function ggFlowCheck(engine, method) {
      var turbs = turbinesOf(engine), pumps = pumpsOf(engine);
      var out = { engine: engine, method: method };
      var pc = pumps.map(pumpCheck);
      if (pc.some(function (p) { return p.refusal; })) { out.refusal = pc.filter(function (p) { return p.refusal; })[0].refusal; return out; }
      turbs = turbs.slice().sort(function (a, b) { return b.Tin - a.Tin; });
      var first = turbs[0], tc = turbineCheck(first), m = tc.methods[method];
      if (!m || m.refusal) { out.refusal = m ? m.refusal : refusal('not_found', 'No ' + method + ' drive gas for ' + engine + '.', 'Gas properties.'); return out; }
      var driven = pc.filter(function (p) { return first.drives.indexOf(p.fluid) >= 0; });
      var Ppump = driven.reduce(function (a, p) { return a + p.power; }, 0) * HP;
      var perKg = m.dhIs * first.eff / 100;
      out.flow = Ppump / perKg / LBM; out.flowPublished = first.w; out.gap = out.flow / first.w - 1;
      out.pumpPower = Ppump / HP; out.workPerLb = perKg * LBM / HP;
      if (turbs.length > 1) {
        // second turbine in series (J-2 oxidizer turbine), fed by the first one's outlet gas
        var sec = turbs[1];
        var t1r = turbine(m.gas, first.pin * PSI, first.pr, first.eff / 100);
        out.seriesInletT = t1r.out.T; out.seriesInletTPublished = FtoK(sec.Tin);
        var g2 = t1r.out;
        if (g2.kind === 'tabulated') { g2 = gasTab(g2.name, g2.T); }
        if (g2.refusal) out.secondRefusal = g2.refusal;
        else {
          var t2 = turbine(g2, t1r.pout, sec.pr, sec.eff / 100);
          if (t2.refusal) out.secondRefusal = t2.refusal;
          else {
            var P2 = pc.filter(function (p) { return sec.drives.indexOf(p.fluid) >= 0; }).reduce(function (a, p) { return a + p.power; }, 0) * HP;
            out.secondFlow = P2 / t2.dh / LBM; out.secondFlowPublished = sec.w; out.secondGap = out.secondFlow / sec.w - 1;
          }
        }
      }
      return out;
    }
    /** Staged combustion (SSME, SP-8107): the pressure ratio each turbine needs to drive its pump, against the published one. */
    function scPressureRatioCheck(method) {
      var eng = 'SSME (EPL)', out = [];
      var pcs = pumpsOf(eng).map(pumpCheck);
      turbinesOf(eng).forEach(function (row) {
        var tc = turbineCheck(row), m = tc.methods[method];
        var o = { turbine: row.turbine, prPublished: row.pr };
        if (!m || m.refusal) { o.refusal = m ? m.refusal : null; out.push(o); return; }
        var P = pcs.filter(function (p) { return row.drives.indexOf(p.fluid) >= 0; }).reduce(function (a, p) { return a + p.power; }, 0) * HP;
        var dhIs = P / (row.w * LBM) / (row.eff / 100);
        var r = pressureRatioFor(m.gas, row.pin * PSI, dhIs);
        if (r.refusal) o.refusal = r.refusal; else { o.pr = r.pr; o.gap = (r.pr - 1) / (row.pr - 1) - 1; o.pin = row.pin; o.poutPublished = row.pin / row.pr; o.pout = row.pin / r.pr; }
        out.push(o);
      });
      return out;
    }
    /**
     * Expander (RL10A-3-3A, NASA TM-107318 Table 6.1.1): pump powers from head, flow and efficiency (and from torque
     * x speed), the turbine's isentropic drop on ideal-gas hydrogen at the table's inlet state, and the pressure
     * ratio that balances them, against the table's.
     */
    function expanderCheck() {
      var X = TD.RL10A33A, out = {};
      var rhoF = X.fuel[1][5], rhoO = X.ox[1][5];
      var wF = X.pumps[0][2] * 0.13368055555555556 / 60 * rhoF; // gpm -> ft^3/s (231 in^3/gal / 1728) x lb/ft^3
      out.pumps = X.pumps.map(function (p, i) {
        var rho = i < 2 ? (i === 0 ? X.fuel[1][5] : X.fuel[2][5]) : rhoO;
        var w = p[2] * (231 / 1728) / 60 * rho;
        return { stage: p[0], flow: w, powerFromHead: w * p[1] / p[5] / 550, powerFromTorque: p[4] * p[3] * 2 * Math.PI / 60 / 12 / 550 };
      });
      out.pumpPowerHead = out.pumps.reduce(function (a, p) { return a + p.powerFromHead; }, 0);
      out.pumpPowerTorque = out.pumps.reduce(function (a, p) { return a + p.powerFromTorque; }, 0);
      var ti = X.fuel[6], T = RtoK(ti[3]), pin = ti[2] * PSI, w = ti[4];
      out.turbinePowerTorque = X.turbine.torque * X.pumps[0][3] * 2 * Math.PI / 60 / 12 / 550;
      out.turbinePowerPublishedDh = w * X.turbine.dh * BTU_PER_LB * LBM / HP;
      var g = gasH2(T, pin);
      if (g.refusal) { out.refusal = g.refusal; return out; }
      var t = turbine(g, pin, X.turbine.pr_ts, X.turbine.eff);
      out.dh = t.dh / BTU_PER_LB; out.dhPublished = X.turbine.dh; out.dhGap = out.dh / X.turbine.dh - 1;
      out.TisK = t.Tis; out.ToutK = t.out.T; out.ToutPublishedK = RtoK(X.turbine.T_exit);
      out.turbinePower = w * LBM * t.dh / HP;
      var need = out.pumpPowerTorque * HP / (w * LBM) / X.turbine.eff;
      var r = pressureRatioFor(g, pin, need);
      if (r.refusal) out.prRefusal = r.refusal; else { out.pr = r.pr; out.prPublished = X.turbine.pr_ts; out.prGap = (r.pr - 1) / (X.turbine.pr_ts - 1) - 1; }
      out.gas = g; out.wFuelFromGpm = wF;
      return out;
    }

    // ================================================================== real engines and published-figure checks
    function row8120(name) { return ROWS.filter(function (r) { return r.engine === name; })[0] || null; }
    function cond(arr, c) { for (var i = 0; i < arr.length; i++) if (arr[i][1] === c) return arr[i][0]; return null; }
    /**
     * Engines with both a sea-level and an altitude thrust in SP-8120 Table I: F(sl) = F(alt) - p_sl Ae, with Ae as
     * printed, against the published sea-level thrust (and Isp at the same mass flow).
     */
    function ambientLawCheck() {
      var pSL = isa(0).P_Pa;
      return ROWS.filter(function (r) { return cond(r.thrust, 'sl') != null && cond(r.thrust, 'alt') != null; }).map(function (r) {
        var n = r.chambers || 1, Fa = cond(r.thrust, 'alt') * LBF / n, Fs = cond(r.thrust, 'sl') * LBF / n, Ae = r.Ae * INCH * INCH;
        var Fpred = Fa - pSL * Ae, ia = cond(r.isp, 'alt'), is = cond(r.isp, 'sl');
        var o = { engine: r.engine, Falt: Fa, FslPublished: Fs, Fsl: Fpred, gap: Fpred / Fs - 1, Ae: Ae };
        if (ia && is) { o.ispSl = ia * Fpred / Fa; o.ispSlPublished = is; o.ispGap = o.ispSl / is - 1; }
        return o;
      });
    }
    /**
     * Which mass flow does SP-8120's specific impulse divide by? For each engine in both SP-8120 Table I and SP-8107:
     * the engine's (all the pumps deliver) and the thrust chamber's (pumps minus a gas generator's turbine flow).
     */
    var BASIS_PAIRS = [['F-1', 'F-1', 'sl'], ['H-1C and H-1D', 'H-1', 'sl'], ['J-2', 'J-2', 'alt'], ['RL10A-3-3', 'RL10A-3-3', 'alt'], ['LR89-NA-7', 'MA-5 booster', 'sl'], ['LR79-NA-11', 'MB-3', 'sl']];
    function ispBasisCheck() {
      return BASIS_PAIRS.map(function (p) {
        var r = row8120(p[0]), pumps = pumpsOf(p[1]), turbs = turbinesOf(p[1]);
        var F = cond(r.thrust, p[2]) / (r.chambers || 1), isp = cond(r.isp, p[2]);
        var wPumps = pumps.reduce(function (a, x) { return a + x.w; }, 0);
        var gg = p[1] === 'RL10A-3-3' ? 0 : turbs.reduce(function (a, x) { return Math.max(a, x.w); }, 0); // expander: closed, no flow leaves
        var o = { engine: p[0], turbopump: p[1], condition: p[2], thrust: F, ispPublished: isp, pumpFlow: wPumps, turbineFlow: gg };
        o.ispEngine = F / wPumps; o.ispChamber = gg ? F / (wPumps - gg) : null;
        o.engineGap = isp / o.ispEngine - 1; o.chamberGap = gg ? isp / o.ispChamber - 1 : null;
        o.basis = !gg ? 'closed cycle (one value)' : Math.abs(o.engineGap) < Math.abs(o.chamberGap) ? 'engine' : 'thrust chamber';
        return o;
      });
    }

    /** Engine presets: a real engine's chamber, nozzle and throat from SP-8120 Table I, and its turbomachinery. */
    var ENGINES = [
      { id: 'F-1', table: 'F-1', turbo: 'F-1', cycle: 'gas-generator', calib: 'alt' },
      { id: 'H-1', table: 'H-1C and H-1D', turbo: 'H-1', cycle: 'gas-generator', calib: 'alt' },
      { id: 'J-2', table: 'J-2', turbo: 'J-2', cycle: 'gas-generator', calib: 'alt' },
      { id: 'LR89-NA-7', table: 'LR89-NA-7', turbo: 'MA-5 booster', cycle: 'gas-generator', calib: 'sl' },
      { id: 'RL10A-3-3', table: 'RL10A-3-3', turbo: 'RL10A-3-3', cycle: 'expander', calib: 'alt' },
      { id: 'YLR113-AJ-1', table: 'YLR113-AJ-1', turbo: null, cycle: null, calib: 'sl', range: true },
    ];
    function parseRange(v) { if (typeof v === 'number') return [v, v]; var m = String(v).replace(/ /g, '').match(/^([0-9.]+)to([0-9.]+)$/); return m ? [+m[1], +m[2]] : null; }
    /** Build the deck context of an engine preset (nominal = SP-8120 Table I's operating point) and calibrate it there. */
    function engineSpec(id) {
      var E = ENGINES.filter(function (e) { return e.id === id; })[0];
      if (!E) return { refusal: refusal('not_found', 'No engine preset "' + id + '".', 'One of ' + ENGINES.map(function (e) { return e.id; }).join(', ') + '.') };
      var r = row8120(E.table), prop = presetProp(r.prop);
      var pcs = E.range ? parseRange(r.pc[0][0]) : [r.pc[0][0], r.pc[0][0]];
      var pc = pcs[1] * PSI;
      var Rt = r.Dt * INCH / 2, contour;
      if (/conical/i.test(r.exit)) contour = { type: 'cone', alpha: parseFloat(r.divergence) };
      else {
        var Lf = r.L != null ? B.lengthFraction(r.L * INCH, Rt, r.eps) : null;
        var note = null;
        if (Lf != null && (Lf < 0.6 || Lf > 1)) { note = 'its ' + fmt(Lf * 100, 3) + ' % length is outside SP-125 Figure 4-12; the nearest end is used (as idea 32 does)'; Lf = Math.min(Math.max(Lf, 0.6), 1); }
        contour = { type: 'bell', Lf: Lf, note: note };
      }
      var spec = { id: id, label: id + ' (' + r.application + ')', prop: prop, preset: r.prop, of: r.mr, pc: pc, eps: r.eps, contour: contour, mode: 'shifting', freeze: 'chamber',
        At: r.At * INCH * INCH, etaCstar: 1, etaCF: 1, chambers: r.chambers || 1, cycle: E.cycle, turbo: E.turbo, row: r, entry: E,
        pcRange: E.range ? [pcs[0] * PSI, pcs[1] * PSI] : null };
      var c = context(spec);
      var F = parseRange(cond(r.thrust, E.calib)), I = parseRange(cond(r.isp, E.calib));
      var pa = E.calib === 'sl' ? isa(0).P_Pa : 0;
      var cal = calibrate(c, F[1] * LBF / spec.chambers, I[1] * g0, pa);
      if (!cal.refusal) { spec.etaCstar = cal.etaCstar; spec.etaCF = cal.etaCF; }
      spec.calibration = Object.assign({ condition: E.calib, F: F[1] * LBF / spec.chambers, isp: I[1] * g0, pa: pa }, cal);
      return { spec: spec, context: context(spec) };
    }
    /**
     * The throttle check: SP-8120 Table I gives the YLR113-AJ-1 sled engine as ranges (thrust 50 000 to 150 000 lbf,
     * chamber 235 to 595 psia, Isp 195 to 240 s at sea level). Calibrated at the top of the range, the deck predicts
     * the bottom; the ranges' ends are taken to correspond.
     */
    function throttleCheck() {
      var e = engineSpec('YLR113-AJ-1');
      if (e.refusal) return e;
      var r = e.spec.row, F = parseRange(cond(r.thrust, 'sl')), I = parseRange(cond(r.isp, 'sl'));
      var p = point(e.context, e.spec.pcRange[0], isa(0).P_Pa);
      var o = { engine: r.engine, pcLow: e.spec.pcRange[0], pcHigh: e.spec.pcRange[1], calibration: e.spec.calibration, FPublished: F[0] * LBF, ispPublished: I[0] * g0 };
      if (p.refusal) { o.refusal = p.refusal; return o; }
      o.F = p.F; o.isp = p.isp; o.Fgap = p.F / o.FPublished - 1; o.ispGap = p.isp / o.ispPublished - 1; o.status = p.status;
      return o;
    }

    // ================================================================== cycle references (parameters from published engines)
    /** Cycle parameters derived from a published engine's figures; every ratio is computed here, none typed. */
    function cycleReference(id) {
      if (id === 'F-1' || id === 'H-1' || id === 'MA-5 booster' || id === 'J-2') {
        var t = t1(id), ps = pumpsOf(id), ts = turbinesOf(id).slice().sort(function (a, b) { return b.Tin - a.Tin; });
        var po = ps.filter(function (p) { return isOx(p.fluid); })[0], pf = ps.filter(function (p) { return !isOx(p.fluid); })[0];
        return { id: id, cycle: 'gas-generator', source: 'NASA SP-8107 Tables I-III (' + id + ', mid-1973 data)', fluid: ts[0].fluid,
          pc: t.pc * PSI,
          ox: { kOut: po.pd / t.pc, pin: po.pin * PSI, eta: po.eff / 100 }, fuel: { kOut: pf.pd / t.pc, pin: pf.pin * PSI, eta: pf.eff / 100 },
          turbines: ts.map(function (r) { return { label: r.turbine || 'turbine', T: FtoK(r.Tin), kIn: r.pin / t.pc, pr: r.pr, eta: r.eff / 100, flowFrac: r.w / ts[0].w }; }) };
      }
      if (id === 'SSME (EPL)') {
        var t2 = t1(id), P = pumpsOf(id), T = turbinesOf(id);
        var po2 = P.filter(function (p) { return isOx(p.fluid); })[0], pf2 = P.filter(function (p) { return !isOx(p.fluid); })[0];
        var tf = T.filter(function (r) { return /fuel/i.test(r.turbine); })[0], to = T.filter(function (r) { return /oxidizer/i.test(r.turbine); })[0];
        return { id: id, cycle: 'staged-combustion', rich: 'fuel', source: 'NASA SP-8107 Tables I-III (SSME at emergency power level, 1973 design values)', pc: t2.pc * PSI,
          kTurbineOut: (tf.pin / tf.pr) / t2.pc, kRichPump: pf2.pd / tf.pin, kLeanPump: po2.pd / t2.pc, kLeanBoost: po2.second.pd / to.pin, leanBoostFrac: po2.second.w / po2.w,
          ox: { pin: po2.pin * PSI, eta: po2.eff / 100, etaBoost: po2.second.eff / 100 }, fuel: { pin: pf2.pin * PSI, eta: pf2.eff / 100 },
          // per kg/s of main fuel flow, each turbine's flow (it scales with the fuel flow) and inlet temperature
          turbines: [tf, to].map(function (r) { return { label: r.turbine, T: FtoK(r.Tin), eta: r.eff / 100, flowPerFuel: r.w / pf2.w, prPublished: r.pr }; }) };
      }
      if (id === 'RL10A-3-3A') {
        var X = TD.RL10A33A, pc = X.overall.pc_injector_face;
        var stH = X.pumps[0][1] + X.pumps[1][1], etaF = stH / (X.pumps[0][1] / X.pumps[0][5] + X.pumps[1][1] / X.pumps[1][5]);
        return { id: id, cycle: 'expander', source: 'NASA TM-107318 Table 6.1.1 (RL10A-3-3A model output)', pc: pc * PSI,
          T: RtoK(X.fuel[6][3]), eta: X.turbine.eff, bypass: 1 - X.fuel[6][4] / X.fuel[5][4],
          kTurbineOut: X.turbine.p_exit_static / pc, kJacket: X.fuel[3][2] / X.fuel[6][2], kOx: X.ox[2][2] / pc,
          fuel: { pin: X.fuel[1][2] * PSI, eta: etaF }, ox: { pin: X.ox[1][2] * PSI, eta: X.pumps[2][5] }, prPublished: X.turbine.pr_ts };
      }
      return { refusal: refusal('not_found', 'No cycle reference "' + id + '".', 'F-1, H-1, MA-5 booster, J-2, SSME (EPL) or RL10A-3-3A.') };
    }
    var CYCLE_REFS = ['F-1', 'H-1', 'MA-5 booster', 'J-2', 'SSME (EPL)', 'RL10A-3-3A'];

    /** Drive gas for a turbine at temperature T and pressure p burning prop: idea 31 if it can, else SP-8110's table. */
    var PROP_TABLE = { 'lox-rp1': 'LOX/RP-1', 'lox-lh2': 'LOX/LH2', 'nto-a50': 'N2O4/50-50' };
    function driveGas(prop, T, p, side) {
      var g = gasAtTemperature(prop, T, p, side || 'fuel');
      if (!g.refusal) return g;
      var tab = prop.id && PROP_TABLE[prop.id];
      if (tab && (side || 'fuel') === 'fuel') {
        var t = gasTab(tab, T);
        if (!t.refusal) { t.note = 'idea 31 refused (' + g.refusal.reason + '), so SP-8110\'s tabulated gas is used'; return t; }
        return { refusal: refusal(t.refusal.code, 'No drive gas: idea 31 refused (' + g.refusal.reason + ') and ' + t.refusal.reason, t.refusal.what_would_help) };
      }
      return g;
    }

    /**
     * Solve the cycle at one operating point. op: {pc, mdotOx, mdotFuel, prop, rhoOx, rhoFuel}; ref: cycleReference();
     * opts: {richSide, TinOverride (K)} for staged combustion.
     */
    function cycle(ref, op, opts) {
      opts = opts || {};
      if (!ref || ref.refusal) return { refusal: ref ? ref.refusal : refusal('insufficient_data', 'No cycle chosen.', 'A cycle reference.') };
      if (!(op.mdotOx > 0 && op.mdotFuel > 0)) return { refusal: refusal('insufficient_data', 'No mass flows at this operating point (no throat area).', 'A throat area: a thrust in idea 32, or an engine preset.') };
      if (!(op.rhoOx > 0 && op.rhoFuel > 0)) return { refusal: refusal('insufficient_data', 'No measured propellant density, so no pump power.', 'Densities for both propellants (idea 31\'s density table).') };
      if (ref.cycle === 'gas-generator') return cycleGG(ref, op);
      if (ref.cycle === 'staged-combustion') return cycleSC(ref, op, opts);
      if (ref.cycle === 'expander') return cycleExpander(ref, op, opts);
      return { refusal: refusal('invalid_input', 'Unknown cycle.', 'gas-generator, staged-combustion or expander.') };
    }
    function cycleGG(ref, op) {
      var out = { cycle: 'gas-generator', reference: ref.id, source: ref.source };
      var po = op.pc * ref.ox.kOut, pf = op.pc * ref.fuel.kOut;
      var wo = (po - ref.ox.pin) / (op.rhoOx * ref.ox.eta), wf = (pf - ref.fuel.pin) / (op.rhoFuel * ref.fuel.eta);
      var t0 = ref.turbines[0], pin = op.pc * t0.kIn;
      var g = driveGas(op.prop, t0.T, pin, 'fuel');
      if (g.refusal) { out.refusal = g.refusal; return out; }
      out.gas = g;
      // turbines in series: the second gets flowFrac of the first one's flow (J-2's oxidizer turbine)
      var stages = [], gas = g, p = pin, perKg = 0;
      for (var i = 0; i < ref.turbines.length; i++) {
        var tr = ref.turbines[i];
        if (gas.kind === 'tabulated' && i > 0) { gas = gasTab(gas.name, gas.T); if (gas.refusal) { out.refusal = gas.refusal; return out; } }
        var t = turbine(gas, p, tr.pr, tr.eta);
        if (t.refusal) { out.refusal = t.refusal; return out; }
        stages.push({ label: tr.label, Tin: gas.T, pin: p, pr: tr.pr, eta: tr.eta, dhIs: t.dhIs, dh: t.dh, flowFrac: tr.flowFrac, Tout: t.out.T });
        perKg += tr.flowFrac * t.dh;
        gas = t.out; p = t.pout;
      }
      // the gas generator's own flow is pumped too, split by its mixture ratio (idea 31's) or, for a tabulated gas
      // whose mixture ratio no source gives, by the main mixture ratio [assumed]
      var r = g.of != null ? g.of : op.mdotOx / op.mdotFuel;
      var xo = r / (1 + r), xf = 1 / (1 + r);
      out.ggSplit = { of: r, assumed: g.of == null };
      var den = perKg - xo * wo - xf * wf;
      if (!(den > 0)) { out.refusal = refusal('out_of_envelope', 'The turbine extracts ' + fmt(perKg / 1e3) + ' kJ/kg, less than pumping its own flow costs: no gas-generator flow balances.', 'A hotter gas generator, a higher turbine pressure ratio or efficiency.'); return out; }
      var mgg = (op.mdotOx * wo + op.mdotFuel * wf) / den;
      out.mdotGG = mgg; out.ggFraction = mgg / (op.mdotOx + op.mdotFuel + mgg);
      out.pumps = { ox: { pout: po, power: (op.mdotOx + xo * mgg) * wo, flow: op.mdotOx + xo * mgg }, fuel: { pout: pf, power: (op.mdotFuel + xf * mgg) * wf, flow: op.mdotFuel + xf * mgg } };
      out.turbinePower = mgg * perKg; out.stages = stages;
      out.pumpPower = out.pumps.ox.power + out.pumps.fuel.power;
      // exhaust: bracket between no thrust and complete expansion of the last stage's outlet gas
      var last = stages[stages.length - 1];
      var cpOut = gas.kind === 'equilibrium' ? gas.cp : gas.cp;
      out.exhaustVelocityMax = Math.sqrt(2 * cpOut * last.Tout);
      out.Tout = last.Tout;
      return out;
    }
    function cycleSC(ref, op, opts) {
      var rich = opts.richSide || ref.rich || 'fuel';
      var out = { cycle: 'staged-combustion', reference: ref.id, rich: rich, source: ref.source };
      var mRich = rich === 'fuel' ? op.mdotFuel : op.mdotOx, mLean = rich === 'fuel' ? op.mdotOx : op.mdotFuel;
      var rhoRich = rich === 'fuel' ? op.rhoFuel : op.rhoOx, rhoLean = rich === 'fuel' ? op.rhoOx : op.rhoFuel;
      var pumpRich = rich === 'fuel' ? ref.fuel : ref.ox, pumpLean = rich === 'fuel' ? ref.ox : ref.fuel;
      var pTout = op.pc * ref.kTurbineOut;
      var turbs = ref.turbines.map(function (t) { return { label: t.label, T: (opts.TinOverride > 0 ? opts.TinOverride : t.T), eta: t.eta, flowPerFuel: t.flowPerFuel }; });
      if (rich === 'ox' && !(opts.TinOverride > 0)) { out.refusal = refusal('insufficient_data', 'An oxidizer-rich preburner needs its turbine inlet temperature, and no fetched source gives one (the SSME reference is fuel-rich).', 'A sourced oxidizer-rich preburner temperature, typed in kelvin.'); return out; }
      // preburner gas: each turbine's mixture ratio is the one that burns at its inlet temperature at the reference
      // preburner pressure; it is held while the pressure ratio is solved
      var pRefPB = ref.pc * ref.kTurbineOut * ref.turbines[0].prPublished;
      var gases = [];
      for (var i = 0; i < turbs.length; i++) {
        var g = gasAtTemperature(op.prop, turbs[i].T, op.pc / ref.pc * pRefPB, rich);
        if (g.refusal) { out.refusal = g.refusal; return out; }
        gases.push(g);
      }
      // flows: each turbine's flow scales with the rich propellant's flow; lean propellant drawn into the preburners
      var mT = turbs.map(function (t) { return t.flowPerFuel * mRich; });
      var leanToPB = 0, richToPB = 0;
      gases.forEach(function (g, j) { var r = rich === 'fuel' ? g.of : 1 / g.of; leanToPB += mT[j] * r / (1 + r); richToPB += mT[j] / (1 + r); });
      if (richToPB > mRich * (1 + 1e-9)) { out.refusal = refusal('out_of_envelope', 'The preburners would need ' + fmt(richToPB) + ' kg/s of the rich propellant, more than the ' + fmt(mRich) + ' kg/s the engine burns.', 'A hotter preburner (less of its flow), or a reference with smaller turbine flows.'); return out; }
      if (leanToPB > mLean) { out.refusal = refusal('out_of_envelope', 'The preburners would need more of the lean propellant than the engine burns.', 'A cooler preburner.'); return out; }
      var pLeanMain = op.pc * ref.kLeanPump;
      var wLeanMain = (pLeanMain - pumpLean.pin) / (rhoLean * pumpLean.eta);
      var boostFlow = mLean * ref.leanBoostFrac;
      var evalPR = function (pr) {
        var ppb = pr * pTout, pRichOut = ref.kRichPump * ppb, pBoost = ref.kLeanBoost * ppb;
        var Pp = mRich * (pRichOut - pumpRich.pin) / (rhoRich * pumpRich.eta) + mLean * wLeanMain + boostFlow * Math.max(0, pBoost - pLeanMain) / (rhoLean * pumpLean.etaBoost);
        var Pt = 0, st = [];
        for (var j = 0; j < gases.length; j++) {
          var gj = gasEq(op.prop, gases[j].of, ppb);
          if (gj.refusal) return { refusal: gj.refusal };
          var t = turbine(gj, ppb, pr, turbs[j].eta);
          if (t.refusal) return { refusal: t.refusal };
          Pt += mT[j] * t.dh; st.push({ label: turbs[j].label, Tin: gj.T, of: gj.of, flow: mT[j], dhIs: t.dhIs, dh: t.dh, power: mT[j] * t.dh });
        }
        return { pr: pr, ppb: ppb, pRichOut: pRichOut, pBoost: pBoost, Pp: Pp, Pt: Pt, f: Pt - Pp, stages: st };
      };
      var grid = [], prev = null, hit = null, best = null;
      for (var gq = 1.01; gq <= 10.0001; gq *= 1.05) grid.push(gq);
      var stop = null;
      for (var k = 0; k < grid.length; k++) {
        var e = evalPR(grid[k]);
        if (e.refusal) { if (!best) { out.refusal = e.refusal; return out; } stop = { pr: grid[k], refusal: e.refusal }; break; }
        if (!best || e.Pt / e.Pp > best.Pt / best.Pp) best = e;
        if (e.f >= 0) { hit = [prev, e]; break; }
        prev = e;
      }
      if (!hit) {
        out.refusal = refusal('out_of_envelope', 'The cycle does not close: at best (pressure ratio ' + fmt(best.pr, 3) + ') the turbines deliver ' + fmt(100 * best.Pt / best.Pp, 3) + ' % of the pump power, because raising the pressure ratio raises the pump discharge pressure with it' +
          (stop ? ' (the search stopped at pressure ratio ' + fmt(stop.pr, 3) + ': ' + stop.refusal.reason + ')' : '') + '.',
          'A lower chamber pressure, hotter preburners (type a turbine inlet temperature), or more efficient turbomachinery.', { applies_to: 'cycle' });
        out.bestRatio = best.Pt / best.Pp; out.bestPR = best.pr; return out;
      }
      // Illinois false position on the bracket [a, b] (f(a) < 0 <= f(b))
      var a = hit[0] || evalPR(1 + 1e-6), b = hit[1], fa = a.f, fb = b.f, side = 0, s = b;
      if (a.refusal) { out.refusal = a.refusal; return out; }
      for (var it = 0; it < 80; it++) {
        var x = (a.pr * fb - b.pr * fa) / (fb - fa);
        if (!(x > a.pr && x < b.pr)) x = (a.pr + b.pr) / 2;
        var ex = evalPR(x);
        if (ex.refusal) { out.refusal = ex.refusal; return out; }
        s = ex;
        if (Math.abs(ex.f) <= 1e-10 * ex.Pp || b.pr - a.pr < 1e-13 * b.pr) break;
        if (ex.f < 0) { a = ex; fa = ex.f; if (side === -1) fb /= 2; side = -1; }
        else { b = ex; fb = ex.f; if (side === 1) fa /= 2; side = 1; }
      }
      out.pr = s.pr; out.preburnerPressure = s.ppb; out.turbineOutletPressure = pTout;
      out.pumps = { rich: { pout: s.pRichOut, flow: mRich }, lean: { pout: pLeanMain, flow: mLean }, boost: { pout: s.pBoost, flow: boostFlow } };
      out.pumpPower = s.Pp; out.turbinePower = s.Pt; out.stages = s.stages;
      out.richToPreburners = richToPB; out.leanToPreburners = leanToPB;
      out.pumpDischargeOverChamber = s.pRichOut / op.pc;
      return out;
    }
    function cycleExpander(ref, op, opts) {
      opts = opts || {};
      var out = { cycle: 'expander', reference: ref.id, source: ref.source };
      var g = gasH2(opts.TinOverride > 0 ? opts.TinOverride : ref.T, op.pc * ref.kTurbineOut * ref.prPublished);
      if (g.refusal) { out.refusal = g.refusal; return out; }
      if (!/H2/.test(JSON.stringify(op.prop.fuel))) { out.refusal = refusal('out_of_envelope', 'This expander reference drives its turbine with hydrogen heated in the cooling jacket; the fuel here is not hydrogen.', 'Liquid hydrogen fuel, or a gas-generator or staged-combustion cycle.'); return out; }
      var mt = op.mdotFuel * (1 - ref.bypass);
      var po = op.pc * ref.kOx, Po = op.mdotOx * (po - ref.ox.pin) / (op.rhoOx * ref.ox.eta);
      var pTout = op.pc * ref.kTurbineOut;
      // pump power rises with the turbine inlet pressure: Pf = mf (kJ PR pTout - pin) / (rho eta); turbine: mt eta cp T (1 - PR^-k)
      var k = (g.gamma - 1) / g.gamma, A = mt * ref.eta * g.cp * g.T;
      var Pp = function (pr) { return op.mdotFuel * (ref.kJacket * pr * pTout - ref.fuel.pin) / (op.rhoFuel * ref.fuel.eta) + Po; };
      var f = function (pr) { return A * (1 - Math.pow(pr, -k)) - Pp(pr); };
      var lo = 1 + 1e-9, hi = null, best = { pr: 1, r: 0 };
      for (var pr = 1.02; pr <= 10.0001; pr *= 1.02) { var ratio = A * (1 - Math.pow(pr, -k)) / Pp(pr); if (ratio > best.r) best = { pr: pr, r: ratio }; if (f(pr) >= 0) { hi = pr; break; } lo = pr; }
      if (hi == null) { out.refusal = refusal('out_of_envelope', 'The expander cycle does not close: at best (pressure ratio ' + fmt(best.pr, 3) + ') the turbine delivers ' + fmt(100 * best.r, 3) + ' % of the pump power at this turbine inlet temperature.', 'More heat into the hydrogen (a hotter turbine inlet: the jacket\'s heat pick-up is not modelled here), a lower chamber pressure, or better turbomachinery.', { applies_to: 'cycle' }); out.bestRatio = best.r; return out; }
      for (var it = 0; it < 100 && hi - lo > 1e-13; it++) { var m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
      var prs = (lo + hi) / 2;
      out.pr = prs; out.turbineInletPressure = prs * pTout; out.turbineOutletPressure = pTout; out.Tin = g.T; out.gas = g;
      out.pumps = { fuel: { pout: ref.kJacket * prs * pTout, flow: op.mdotFuel }, ox: { pout: po, flow: op.mdotOx } };
      out.pumpPower = Pp(prs); out.turbinePower = A * (1 - Math.pow(prs, -k)); out.turbineFlow = mt;
      out.pumpDischargeOverChamber = out.pumps.fuel.pout / op.pc;
      return out;
    }

    /** Engine-level numbers at an operating point: thrust chamber plus a gas generator's flow (bracketed exhaust thrust). */
    function engineLevel(p, cyc) {
      var o = { F: p.F, mdot: p.mdot, isp: p.isp, Fvac: p.Fvac, ispVac: p.ispVac };
      if (!cyc || cyc.refusal || cyc.cycle !== 'gas-generator' || !(p.mdot > 0)) return o;
      var m = p.mdot + cyc.mdotGG;
      o.mdot = m; o.mdotGG = cyc.mdotGG;
      if (p.F != null) { o.ispLow = p.F / m; o.ispHigh = (p.F + cyc.mdotGG * cyc.exhaustVelocityMax) / m; o.isp = o.ispLow; }
      o.ispVacLow = p.Fvac / m; o.ispVacHigh = (p.Fvac + cyc.mdotGG * cyc.exhaustVelocityMax) / m;
      return o;
    }

    // ================================================================== handoff (series schema v1)
    var KERNEL = '33-engine-deck/engine.js';
    function q(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }

    /**
     * Read a handoff: idea 32's (a chamber and a nozzle), idea 31's (refused: no nozzle), or this module's own.
     * Recomputes the chamber with idea 31's kernel (idea 32's check, 1e-8) and the nozzle with idea 32's analyze(),
     * and refuses if the handoff's nozzle numbers are not what idea 32 computes for its inputs.
     */
    function parseHandoff(input) {
      var p = M.parseHandoff(input);
      if (p.refusal) return p;
      var h = p.handoff, h32 = h;
      if (h.from === '33-engine-deck') { h32 = h.inputs && h.inputs.nozzle_handoff; if (!h32 || h32.from !== '32-bell') return { refusal: refusal('insufficient_data', 'This 33-engine-deck handoff does not carry the nozzle handoff it was built from.', 'A handoff exported by this page, or one from 32-bell.') }; }
      else if (h.from === '31-mixture') return { refusal: refusal('insufficient_data', 'A 31-mixture handoff is a chamber without a nozzle; an engine needs both.', 'Open it in idea 32 (Bell), choose a nozzle and a thrust there, and export that handoff.') };
      else if (h.from !== '32-bell') return { refusal: refusal('invalid_input', 'A handoff from ' + (h.from || 'an unknown module') + ' is not a nozzle; this module reads idea 32\'s handoff (or its own).', 'A handoff exported by 32-bell.') };
      var pb = B.parseHandoff(h32);
      if (pb.refusal) return pb;
      var r = B.chamberFromHandoff(pb.chamberHandoff, pb.inputs);
      if (r.refusal) return { refusal: r.refusal };
      var nz = pb.nozzle || {};
      var opts = { eps: nz.area_ratio, contour: nz.contour, ambient: nz.ambient, design: nz.design_flow, freeze: nz.freeze_point, thrust: nz.thrust_N };
      var A = B.analyze(r, opts);
      var O = h32.outputs || {};
      var checks = [['specific_impulse_vacuum_ideal_shifting', A.flows.shifting && A.flows.shifting.exit && A.flows.shifting.exit.Ivac], ['throat_area', A.sizing && A.sizing.At], ['divergence_efficiency', A.lambda && A.lambda.value]];
      for (var i = 0; i < checks.length; i++) {
        var o = O[checks[i][0]], v = checks[i][1];
        if (v == null && !o) continue;
        if (!o || typeof o.value !== 'number' || v == null || Math.abs(o.value / v - 1) > 1e-8) {
          return { refusal: refusal('invalid_input', 'The nozzle handoff says ' + checks[i][0] + ' = ' + (o ? fmt(o.value, 9) : 'nothing') + ', but idea 32\'s kernel computes ' + fmt(v, 9) + ' for its inputs: it was edited or made with other data.', 'The unedited handoff 32-bell exported.') };
        }
      }
      var res = { handoff: h, nozzleHandoff: h32, chamberHandoff: pb.chamberHandoff, inputs: pb.inputs, nozzle: nz, rocket: r, analysis: A };
      if (h.from === '33-engine-deck') res.engine = h.inputs.engine;
      return res;
    }
    /** A deck spec from a parsed idea 32 handoff (its sizing gives the throat; without one, no thrust or flow). */
    function specFromNozzle(parsed, extra) {
      extra = extra || {};
      var nz = parsed.nozzle, inp = parsed.inputs;
      var prop = { id: inp.preset, oxidizer: inp.oxidizer, fuel: inp.fuel, label: inp.preset || 'imported propellant' };
      return { id: 'imported', label: 'From idea 32 (' + (inp.preset || 'custom propellant') + ', area ratio ' + fmt(nz.area_ratio) + ')', prop: prop, preset: inp.preset, of: inp.of, pc: inp.pc, eps: nz.area_ratio,
        contour: nz.contour, mode: nz.design_flow === 'frozen' ? 'frozen' : 'shifting', freeze: nz.freeze_point || 'chamber',
        At: parsed.analysis.sizing ? parsed.analysis.sizing.At : (extra.At || null), etaCstar: extra.etaCstar == null ? 1 : extra.etaCstar, etaCF: extra.etaCF == null ? 1 : extra.etaCF, chambers: 1, cycle: null, imported: true };
    }

    /**
     * The handoff module 34 (Stack) imports. h32: idea 32's handoff (imported, or built with idea 32's own
     * makeHandoff for a preset); spec: the deck spec; D: deck(); cyc: cycle at nominal; extra: {produced, throttle, reference}.
     */
    function makeHandoff(h32, spec, D, cyc, extra) {
      extra = extra || {};
      var src32 = function (o) { return Object.assign({}, o, { source: '32-bell (passed through): ' + o.source }); };
      var out = {
        handoff: 'long-way-round', version: 1, from: '33-engine-deck', produced: extra.produced || new Date().toISOString(),
        inputs: {
          preset: h32.inputs.preset, oxidizer: h32.inputs.oxidizer, fuel: h32.inputs.fuel, mixture_ratio: h32.inputs.mixture_ratio, chamber_pressure_Pa: h32.inputs.chamber_pressure_Pa,
          engine: { id: spec.id, label: spec.label, throat_area_m2: spec.At || null, efficiencies: { cstar: spec.etaCstar, thrust_coefficient: spec.etaCF, basis: spec.calibration ? 'calibrated on ' + spec.id + ' at SP-8120 Table I (' + spec.calibration.condition + ')' : 'user input' },
            throttle: extra.throttle || null, cycle_reference: extra.reference || null, rich_side: extra.richSide || null, chambers: spec.chambers || 1 },
          nozzle_handoff: h32,
        },
        outputs: {}, refusals: [],
        assumptions: [
          'Thrust chamber: idea 31\'s equilibrium chamber and idea 32\'s ' + (spec.mode === 'frozen' ? 'frozen' : 'shifting') + ' nozzle, re-run at every throttle point at the same mixture ratio and geometry; delivered c* = eta_c* x ideal c*, vacuum C_F = eta_CF x divergence efficiency x ideal, both efficiencies held over the throttle range.',
          'F(pa) = F_vac - pa x exit_area while the nozzle flows full (pa below separation_onset_ambient_pressure); mass flow does not depend on altitude.',
          'Ambient pressure from the 1976 US Standard Atmosphere (PartForge isa(), via ideas 02 and 32), 0 to 86 km; vacuum above.',
          'Pumps incompressible (power = mdot dp / (rho eta)); turbines isentropic drop x efficiency; every cycle parameter (pressure ladder, efficiencies, inlet temperatures, routing) from the named reference engine, held over the throttle range.',
          'Frames and time scales: none (an engine deck has no position or epoch).',
        ].concat(extra.assumptions || []),
      };
      var O = out.outputs;
      ['mixture_ratio', 'chamber_pressure', 'chamber_temperature', 'cstar_shifting', 'oxidizer_density', 'fuel_density', 'bulk_density', 'area_ratio', 'divergence_efficiency'].forEach(function (k) {
        if (h32.outputs && h32.outputs[k]) O[k] = src32(h32.outputs[k]);
      });
      (h32.refusals || []).forEach(function (rf) { out.refusals.push(Object.assign({ from: rf.from || '32-bell' }, rf)); });
      var fs = KERNEL + ' point() on 31-mixture and 32-bell kernels';
      var nominal = D && D.rows.filter(function (r) { return Math.abs(r.throttle - 1) < 1e-12; })[0];
      var conf = spec.calibration ? 'derived' : 'derived';
      if (spec.At) O.throat_area = q(spec.At, 'm^2', spec.row ? 'measured' : 'derived', spec.row ? 'NASA SP-8120 Table I (' + spec.row.engine + '), via idea 32\'s transcription' : '32-bell size() (passed through)');
      O.cstar_efficiency = q(spec.etaCstar, '1', spec.calibration ? 'derived' : 'assumed', spec.calibration ? KERNEL + ' calibrate() on SP-8120 Table I\'s thrust and Isp (' + spec.calibration.condition + ')' : 'user input');
      O.thrust_coefficient_efficiency = q(spec.etaCF, '1', spec.calibration ? 'derived' : 'assumed', spec.calibration ? KERNEL + ' calibrate() on SP-8120 Table I\'s thrust and Isp (' + spec.calibration.condition + ')' : 'user input (applied after idea 32\'s divergence efficiency)');
      if (nominal) {
        var v = nominal.vac, sl = nominal.cells.filter(function (c) { return c.alt === 0; })[0];
        if (v.refusal) out.refusals.push(Object.assign({ applies_to: 'nominal' }, v.refusal));
        else {
          O.specific_impulse_vacuum_chamber = q(v.ispVac, 'm/s', conf, fs + ' (thrust chamber, vacuum, nominal throttle)');
          O.separation_onset_ambient_pressure = q(v.sepOnset, 'Pa', 'derived', 'SP-8120 criterion via 32-bell separationAmbient() at nominal throttle');
          if (v.mdot) {
            O.thrust_vacuum_chamber = q(v.Fvac, 'N', conf, fs + ' (thrust chamber, vacuum)');
            O.mass_flow_chamber = q(v.mdot, 'kg/s', conf, fs + ' (pc At / c*_del)');
            O.exit_area = q(v.Ae, 'm^2', 'derived', 'area ratio x throat area');
          }
          if (sl && !sl.refusal) {
            O.specific_impulse_sea_level_chamber = q(sl.isp, 'm/s', conf, fs + ' (thrust chamber, 0 km, 101325 Pa)');
            if (sl.F != null) O.thrust_sea_level_chamber = q(sl.F, 'N', conf, fs + ' (thrust chamber, 0 km)');
          } else if (sl && sl.refusal) out.refusals.push(Object.assign({}, sl.refusal, { applies_to: 'thrust_sea_level' }));
          // engine level
          var el = engineLevel(sl && !sl.refusal ? sl : { Fvac: v.Fvac, mdot: v.mdot, ispVac: v.ispVac }, cyc);
          var elv = engineLevel(v, cyc);
          if (cyc && !cyc.refusal && cyc.cycle === 'gas-generator' && v.mdot) {
            O.mass_flow = q(elv.mdot, 'kg/s', conf, KERNEL + ' cycleGG(): chamber + gas-generator flow');
            O.gas_generator_flow = q(cyc.mdotGG, 'kg/s', 'derived', KERNEL + ' cycleGG() power balance, reference ' + cyc.reference);
            O.specific_impulse_vacuum = q(elv.ispVacLow, 'm/s', conf, KERNEL + ' engine level, turbine exhaust giving no thrust (lower bound)');
            O.specific_impulse_vacuum_upper = q(elv.ispVacHigh, 'm/s', conf, KERNEL + ' engine level, turbine exhaust expanded completely (upper bound)');
            O.thrust_vacuum = q(v.Fvac, 'N', conf, fs + ' (thrust chamber only; the turbine exhaust adds between 0 and ' + fmt(cyc.mdotGG * cyc.exhaustVelocityMax, 4) + ' N)');
            if (el.ispLow != null) { O.specific_impulse_sea_level = q(el.ispLow, 'm/s', conf, KERNEL + ' engine level, exhaust giving no thrust (lower bound)'); O.thrust_sea_level = q(sl.F, 'N', conf, fs + ' (thrust chamber only)'); }
          } else if (v.mdot && (!spec.cycle || (cyc && !cyc.refusal))) {
            O.mass_flow = q(v.mdot, 'kg/s', conf, fs + ' (closed cycle or pressure-fed: all flow through the chamber)');
            O.specific_impulse_vacuum = q(v.ispVac, 'm/s', conf, fs);
            O.thrust_vacuum = q(v.Fvac, 'N', conf, fs);
            if (sl && !sl.refusal) { O.specific_impulse_sea_level = q(sl.isp, 'm/s', conf, fs); O.thrust_sea_level = q(sl.F, 'N', conf, fs); }
          } else if (cyc && cyc.refusal) {
            out.refusals.push(Object.assign({ applies_to: 'engine_level' }, cyc.refusal, { reason: 'Engine-level flow and Isp need the cycle, which is refused: ' + cyc.refusal.reason }));
          }
          if (O.mass_flow) {
            var mo = v.mdotOx + (cyc && cyc.pumps && cyc.cycle === 'gas-generator' ? cyc.pumps.ox.flow - v.mdotOx : 0), mf = O.mass_flow.value - mo;
            O.mass_flow_oxidizer = q(mo, 'kg/s', conf, KERNEL + ' (chamber split by mixture ratio' + (cyc && cyc.cycle === 'gas-generator' ? ' plus the gas generator\'s share' : '') + ')');
            O.mass_flow_fuel = q(mf, 'kg/s', conf, KERNEL);
            O.engine_mixture_ratio = q(mo / mf, '1', conf, KERNEL + ' (oxidizer / fuel flow at the engine inlet)');
            if (O.oxidizer_density && O.fuel_density) O.engine_bulk_density = q((1 + mo / mf) / (mo / mf / O.oxidizer_density.value + 1 / O.fuel_density.value), 'kg/m^3', 'derived', '31-mixture bulkDensity() formula at the engine mixture ratio');
          }
        }
      }
      if (D) {
        O.deck = q({
          throttle: D.throttles, altitude_m: D.altitudes, chamber_pressure_Pa: D.rows.map(function (r) { return r.pc; }),
          mass_flow_chamber: D.rows.map(function (r) { return r.vac.mdot != null ? +r.vac.mdot.toPrecision(8) : null; }),
          thrust: D.rows.map(function (r) { return r.cells.map(function (c) { return c.F != null ? +c.F.toPrecision(8) : null; }); }),
          specific_impulse: D.rows.map(function (r) { return r.cells.map(function (c) { return c.isp != null ? +c.isp.toPrecision(8) : null; }); }),
          status: D.rows.map(function (r) { return r.cells.map(function (c) { return c.refusal ? (c.status === 'separated' ? 'separated' : 'refused') : c.status; }); }),
          separation_onset_altitude_m: D.rows.map(function (r) { return r.sepOnsetAltitude == null ? null : +r.sepOnsetAltitude.toFixed(1); }),
        }, 'thrust N, specific_impulse m/s, mass_flow kg/s, pressure Pa, altitude m (null = vacuum)', conf, fs + ' deck(); thrust chamber values (a gas generator\'s flow is in gas_generator_flow); null where refused (status says why)');
        var tmin = D.throttles[0], tmax = D.throttles[D.throttles.length - 1];
        O.throttle_min = q(tmin, '1', 'assumed', 'user input (fraction of nominal chamber pressure)');
        O.throttle_max = q(tmax, '1', 'assumed', 'user input');
      }
      if (cyc && !cyc.refusal) {
        var cs = KERNEL + ' cycle(' + cyc.cycle + '), parameters from ' + cyc.source;
        O.cycle = q(cyc.cycle, '-', 'assumed', 'user choice; reference ' + cyc.reference);
        O.turbine_power = q(cyc.turbinePower, 'W', 'derived', cs);
        O.pump_power = q(cyc.pumpPower, 'W', 'derived', cs);
        if (cyc.cycle === 'gas-generator') {
          O.pump_discharge_pressure_oxidizer = q(cyc.pumps.ox.pout, 'Pa', 'derived', cs + ' (reference ratio x chamber pressure)');
          O.pump_discharge_pressure_fuel = q(cyc.pumps.fuel.pout, 'Pa', 'derived', cs + ' (reference ratio x chamber pressure)');
          O.turbine_inlet_temperature = q(cyc.stages[0].Tin, 'K', 'derived', cyc.gas.source);
        } else {
          O.turbine_pressure_ratio = q(cyc.pr, '1', 'derived', cs + ' (solved: turbine power = pump power)');
          O.pump_discharge_pressure_max = q(cyc.cycle === 'expander' ? cyc.pumps.fuel.pout : cyc.pumps.rich.pout, 'Pa', 'derived', cs + ' (solved)');
          if (cyc.preburnerPressure) O.preburner_pressure = q(cyc.preburnerPressure, 'Pa', 'derived', cs);
        }
      } else if (cyc && cyc.refusal) out.refusals.push(Object.assign({ applies_to: 'cycle' }, cyc.refusal));
      else if (spec.cycle == null && !spec.imported) out.refusals.push({ applies_to: 'cycle', code: 'insufficient_data', reason: 'No turbomachinery data for ' + spec.id + ' in the fetched sources, so no cycle and no engine-level flow beyond the chamber.', what_would_help: 'Its feed system (pump and turbine figures, or pressure-fed).' });
      out.refusals.push({ applies_to: 'engine_dry_mass', code: 'insufficient_data', reason: 'No engine dry mass is computed or given here: the fetched sources (SP-8107, SP-8110, SP-8120, TM-107318) give turbopump weights, not engine weights.', what_would_help: 'A sourced engine dry mass for module 34 (Stack), from the engine\'s data sheet or the vehicle\'s mass breakdown.' });
      return out;
    }

    return {
      context: context, point: point, deck: deck, ambientAt: ambientAt, minThrottleFull: minThrottleFull, calibrate: calibrate,
      gasEq: gasEq, gasAtTemperature: gasAtTemperature, gasTP: gasTP, gasTab: gasTab, gasH2: gasH2, turbine: turbine, pressureRatioFor: pressureRatioFor, pump: pump,
      pumpCheck: pumpCheck, turbineCheck: turbineCheck, ggFlowCheck: ggFlowCheck, scPressureRatioCheck: scPressureRatioCheck, expanderCheck: expanderCheck,
      ambientLawCheck: ambientLawCheck, ispBasisCheck: ispBasisCheck, throttleCheck: throttleCheck,
      ENGINES: ENGINES, engineSpec: engineSpec, CYCLE_REFS: CYCLE_REFS, cycleReference: cycleReference, driveGas: driveGas, cycle: cycle, engineLevel: engineLevel,
      parseHandoff: parseHandoff, specFromNozzle: specFromNozzle, makeHandoff: makeHandoff,
      presetProp: presetProp, densities: densities, g0: g0, DECK_ALTITUDES: DECK_ALTITUDES, ETA_ENVELOPE: ETA_ENVELOPE,
    };
  }

  return { create: create, LBM: LBM, LBF: LBF, PSI: PSI, INCH: INCH, FT: FT, HP: HP, BTU_PER_LB: BTU_PER_LB, BTU_PER_LB_R: BTU_PER_LB_R, FTLBF_PER_LBM_R: FTLBF_PER_LBM_R, LB_FT3: LB_FT3, FtoK: FtoK, KtoF: KtoF, RtoK: RtoK, median: median };
});
