/*
 * Split (idea 46): turn the asteroid's water into return propellant.
 *
 * Idea 45 hands on water made per day at the asteroid. This kernel splits it in a PEM electrolyser powered by the
 * spacecraft's solar arrays, liquefies or compresses the hydrogen and oxygen (or keeps the water to boil in a steam
 * thruster), loses some to boil-off, and asks which mixture ratio is worth burning: idea 31's equilibrium chamber and
 * idea 32's nozzle, both unmodified, calibrated once to the RL10A-3-3. It hands module 47 the propellant (mass, Isp).
 *
 * Units are SI inside (m, s, kg, N, Pa, K, J, W); time is UTC as idea 45 hands it on. Every constant comes from a
 * snapshot: idea 31's NASA Glenn thermo (and its gas constant), snapshots/split-sources.js (CODATA, JANAF, DOE, ISS OGA,
 * NEAR, Psyche, MHTB, NASA's 20 K cryocooler, NBS 1958, NIST WebBook), PartForge's flight metals and NASA factor.
 *
 * Loads as a classic script (window.Split) and with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Split = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KERNEL = '46-split/split.js';

  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function fmt(v, d) { return (typeof v === 'number' && isFinite(v)) ? String(+v.toPrecision(d || 4)) : String(v); }
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function interp(xs, ys, x) {
    var n = xs.length;
    if (!(x >= xs[0] && x <= xs[n - 1])) return NaN;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    if (xs[hi] === xs[lo]) return ys[lo];
    return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
  }
  function b64urlEncode(s) {
    var b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    var b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    return typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8');
  }

  /** SHA-256 of a string's UTF-8 bytes, hex (FIPS 180-4); the tests compare it with Node's crypto. */
  function sha256(str) {
    var bytes = unescape(encodeURIComponent(str)), n = bytes.length, i, j;
    var K = [], H = [], primes = [], cand = 2;
    while (primes.length < 64) { var isP = true; for (j = 0; j < primes.length && primes[j] * primes[j] <= cand; j++) if (cand % primes[j] === 0) { isP = false; break; } if (isP) primes.push(cand); cand++; }
    var frac = function (x) { return ((x - Math.floor(x)) * 4294967296) >>> 0; };
    for (i = 0; i < 64; i++) { K[i] = frac(Math.cbrt(primes[i])); if (i < 8) H[i] = frac(Math.sqrt(primes[i])); }
    var words = [], L = ((n + 9 + 63) >> 6) << 4;
    for (i = 0; i < L; i++) words[i] = 0;
    for (i = 0; i < n; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 255) << (24 - (i % 4) * 8);
    words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
    words[L - 1] = (n * 8) >>> 0; words[L - 2] = Math.floor(n * 8 / 4294967296);
    var rot = function (x, r) { return (x >>> r) | (x << (32 - r)); }, W = new Array(64);
    for (i = 0; i < L; i += 16) {
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        if (j < 16) W[j] = words[i + j] | 0;
        else { var w15 = W[j - 15], w2 = W[j - 2]; W[j] = (W[j - 16] + (rot(w15, 7) ^ rot(w15, 18) ^ (w15 >>> 3)) + W[j - 7] + (rot(w2, 17) ^ rot(w2, 19) ^ (w2 >>> 10))) | 0; }
        var t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + W[j]) | 0;
        var t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  /**
   * Idea 45's handoff with every handoff nested in its own inputs (idea 44's, which holds 43's to 39's) replaced by a
   * digest: {pruned, from, produced, bytes, sha256 of JSON.stringify(it)}. Nothing here reads idea 45's inputs, and
   * carrying the whole cascade would make this handoff 124 KB and its #h= link longer still.
   */
  function pruneUpstream(h) {
    if (!h || !h.inputs) return h;
    var out = Object.assign({}, h), inp = {};
    Object.keys(h.inputs).forEach(function (k) {
      var v = h.inputs[k];
      if (v && typeof v === 'object' && v.handoff === 'long-way-round') { var s = JSON.stringify(v); inp[k] = { pruned: true, from: v.from, produced: v.produced, bytes: s.length, sha256: sha256(s) }; }
      else inp[k] = v;
    });
    out.inputs = inp;
    return out;
  }

  function create(deps) {
    var M = deps.Mixture, db = deps.db, B = deps.B, S = deps.sources, MAT = deps.materials, FAC = deps.factor;
    var TABLE = deps.table, PRESETS = deps.presets, G0 = deps.g0;
    var R = M.R, P0 = M.P0;
    var F = S.codata.F;
    var SIGMA = S.sigma.W_m2_K4;
    var REC = { w: db.products['H2O(L)'], h2: db.products.H2, o2: db.products.O2, steam: db.products.H2O };
    var MW = { h2o: REC.w.M, h2: REC.h2.M, o2: REC.o2.M };
    // Mass of each product per kg of water split: H2O -> H2 + 1/2 O2.
    var FH = MW.h2 / MW.h2o, FO = 0.5 * MW.o2 / MW.h2o;
    var R_ST = 0.5 * MW.o2 / MW.h2; // the mixture ratio the water itself carries (7.937)
    var DAY = 86400, ATM = 101325;
    var T_CELL_ENV = [S.janaf.rows[0][0], S.janaf.rows[S.janaf.rows.length - 1][0]]; // checked against JANAF over this span

    // ------------------------------------------------------------------------------------------ electrolysis
    function species(rec, T) {
      var t = M.thermoAt(rec, T);
      if (!t) return null;
      return { H: t.h * R * T, S: t.s * R, cp: t.cp * R };
    }
    /** H2O(l) -> H2 + 1/2 O2 at T and the 1 bar standard state: dH, dS, dG (J/mol), E_rev and E_tn (V). */
    function electrolysis(T) {
      if (!finite(T)) return { refusal: refusal('invalid_input', 'The cell temperature must be a number of kelvin.', 'A temperature between ' + T_CELL_ENV[0] + ' and ' + T_CELL_ENV[1] + ' K.') };
      if (T < T_CELL_ENV[0] - 1e-9 || T > T_CELL_ENV[1] + 1e-9) return { refusal: refusal('out_of_envelope', 'A cell at ' + fmt(T) + ' K is outside the ' + T_CELL_ENV[0] + ' to ' + T_CELL_ENV[1] + ' K over which this kernel\'s water-splitting energies were checked against NIST-JANAF (liquid water at 1 bar).', 'A liquid-water cell between ' + T_CELL_ENV[0] + ' and ' + T_CELL_ENV[1] + ' K; steam or solid-oxide electrolysis is not modelled.') };
      var w = species(REC.w, T), h = species(REC.h2, T), o = species(REC.o2, T);
      var dH = h.H + 0.5 * o.H - w.H, dS = h.S + 0.5 * o.S - w.S, dG = dH - T * dS;
      return { T: T, dH: dH, dS: dS, dG: dG, Erev: dG / (2 * F), Etn: dH / (2 * F) };
    }
    /** Extra reversible voltage to deliver both gases at pressure p (Pa) rather than at 1 bar (ideal gases, unit water activity). */
    function nernst(T, p) { return R * T / (2 * F) * 1.5 * Math.log(p / P0); }
    /** The cell: voltage, energy per kg of water split, heat rejected. cellSpec = {V (V at 1 bar), etaF, T, p}. */
    function cell(spec) {
      var el = electrolysis(spec.T);
      if (el.refusal) return el;
      if (!(spec.etaF > 0 && spec.etaF <= 1)) return { refusal: refusal('invalid_input', 'The Faraday efficiency must be above 0 and at most 1 (got ' + fmt(spec.etaF) + ').', 'A fraction such as the ISS OGA\'s implied ' + fmt(OGA_ETA, 4) + '.') };
      var dN = nernst(spec.T, spec.p);
      var V = spec.V + dN;
      var Erev = el.Erev + dN;
      if (!(V > Erev)) return { refusal: refusal('out_of_envelope', 'A cell at ' + fmt(V, 4) + ' V is at or below the reversible voltage, ' + fmt(Erev, 4) + ' V at ' + fmt(spec.T) + ' K and ' + fmt(spec.p / 1e6, 3) + ' MPa: no water is split.', 'A cell voltage above ' + fmt(Erev, 4) + ' V.') };
      var e = 2 * F * V / (MW.h2o * spec.etaF); // J per kg of water split
      var heat = e - el.dH / MW.h2o; // what does not end up as the products' enthalpy
      return { V: V, V1bar: spec.V, Vnernst: dN, Erev: Erev, Etn: el.Etn, etaF: spec.etaF, T: spec.T, p: spec.p, e_J_per_kg_water: e, heat_J_per_kg_water: heat,
        kWh_per_kg_h2: 2 * F * V / (MW.h2 * spec.etaF) / 3.6e6, el: el };
    }
    // The ISS OGA: 28 cells at 46.9 A make 9.25 kg of O2 a day; Faraday's law at 100 % makes this much.
    var OGA = S.oga;
    var OGA_IDEAL = OGA.cells * OGA.current_A * DAY / (4 * F) * MW.o2;
    var OGA_ETA = OGA.o2_kg_day / OGA_IDEAL;
    var CELL_PRESETS = {};
    Object.keys(S.doe.points).forEach(function (k) { CELL_PRESETS[k] = { V: S.doe.points[k].V_cell, label: S.doe.points[k].label + ' (' + S.doe.points[k].j_A_cm2 + ' A/cm² at ' + S.doe.points[k].V_cell + ' V)', j_A_cm2: S.doe.points[k].j_A_cm2 }; });

    // ------------------------------------------------------------------------------------------ the arrays
    var ARRAYS = { near: { P1: S.arrays.near.P_1au_W, label: S.arrays.near.label }, psyche: { P1: S.arrays.psyche.P_1au_W, label: S.arrays.psyche.label } };
    function arrayPower(P1, r) { return P1 / (r * r); }

    // ------------------------------------------------------------------------------------------ cryogenics
    var NIST = S.nist;
    function table(t) { return { T: t.gas.map(function (r) { return r[0]; }), h: t.gas.map(function (r) { return r[1]; }), sat: t.sat }; }
    var PH2 = table(NIST.ph2_1atm), LO2 = table(NIST.o2_1atm);
    var CAL = S.calorie_th_J;
    var Q_CONV = S.orthoPara.conversion_cal_mol * CAL / MW.h2; // J per kg of H2, normal -> para at 20 K
    var T_UP = S.twoStage.T_upper_K, T_LOW = S.twoStage.T_lower_K;
    var CC = S.cryo20, CC_LIFT = CC.table.map(function (r) { return r[0]; }), CC_PIN = CC.table.map(function (r) { return r[1]; });
    var CC_QMAX = CC_LIFT[CC_LIFT.length - 1];
    var CC_FCARNOT = CC.table[CC.table.length - 1][3] / 100;
    var CC_UNIT_KG = S.cryoKpp.lift_W * S.cryoKpp.specificMass_kg_W;
    var T_REJ = CC.T_reject_K;
    function hfg(t) { return t.sat.h_v - t.sat.h_l; }
    /** Heat to remove from 1 kg of gas at 1 atm from Tin down to saturated liquid, split at the upper stage's temperature. */
    function liquefaction(Tin) {
      if (!(Tin >= T_UP && Tin <= PH2.T[PH2.T.length - 1])) return { refusal: refusal('out_of_envelope', 'Gas entering the liquefier at ' + fmt(Tin) + ' K is outside the NIST tables carried here (' + T_UP + ' to ' + PH2.T[PH2.T.length - 1] + ' K).', 'An electrolyser temperature inside that span.') };
      var hH = interp(PH2.T, PH2.h, Tin), hH1 = interp(PH2.T, PH2.h, T_UP);
      var hO = interp(LO2.T, LO2.h, Tin);
      if (!(LO2.sat.T > T_UP)) return { refusal: refusal('out_of_envelope', 'The upper stage at ' + T_UP + ' K cannot condense oxygen boiling at ' + fmt(LO2.sat.T) + ' K.', 'A colder upper stage.') };
      return {
        h2_hi: hH - hH1, // J/kg H2 removed by the 90 K stage
        h2_lo: hH1 - PH2.sat.h_l + Q_CONV, // J/kg H2 removed by the 20 K stage, conversion to para included
        h2_conv: Q_CONV,
        o2: hO - LO2.sat.h_l, // J/kg O2, all by the 90 K stage
        Tin: Tin,
      };
    }
    /** Electrical input of the 20 K stage for a lift Q (W): enough NASA/Creare units, each on its measured turndown curve. */
    function cooler20(Q) {
      if (!(Q > 0)) return { P: 0, units: 0 };
      var n = Math.ceil(Q / CC_QMAX - 1e-12);
      return { P: n * interp(CC_LIFT, CC_PIN, Q / n), units: n };
    }
    function sp90(fCarnot) { return (T_REJ / T_UP - 1) / fCarnot; } // W in per W lifted at 90 K
    /** MLI heat flux (W/m^2) at a warm-boundary temperature, power law through MHTB's two measured points (no extrapolation). */
    function mliFlux(Twb) {
      var p = S.mhtb.points;
      if (!(Twb >= p[0][0] && Twb <= p[1][0])) return { refusal: refusal('out_of_envelope', 'A warm boundary at ' + fmt(Twb) + ' K is outside MHTB\'s measured ' + p[0][0] + ' to ' + p[1][0] + ' K.', 'A warm-boundary temperature between ' + p[0][0] + ' and ' + p[1][0] + ' K, or MLI data measured at this one.') };
      var n = Math.log(p[1][1] / p[0][1]) / Math.log(p[1][0] / p[0][0]);
      return { q: p[0][1] * Math.pow(Twb / p[0][0], n), n: n };
    }
    function sphereArea(V) { return Math.pow(36 * Math.PI, 1 / 3) * Math.pow(V, 2 / 3); }

    // ------------------------------------------------------------------------------------------ tanks
    var FS = FAC.ultimate.ultimate_design_factor;
    function material(key) { var m = MAT.metals[key]; return m ? { key: key, name: m.name, rho: m.den_g_cm3 * 1000, su: m.su_MPa * 1e6, verify: m.verify, src: m.src } : null; }
    /** Thin-walled sphere that bursts at FS x p: wall mass = 3/2 p V rho_m FS / su. */
    function tankMass(p, V, mat) { return 1.5 * p * V * mat.rho * FS / mat.su; }
    function gasDensity(which, p) {
      var rows = NIST[which].rows;
      var xs = rows.map(function (r) { return r[0]; }), ys = rows.map(function (r) { return r[1]; });
      return interp(xs, ys, p);
    }
    var P_GAS_ENV = [NIST.h2_293K.rows[0][0], NIST.h2_293K.rows[NIST.h2_293K.rows.length - 1][0]];
    var WATER_RHO = interp(NIST.water_1atm.rows.map(function (r) { return r[0]; }), NIST.water_1atm.rows.map(function (r) { return r[1]; }), NIST.h2_293K.T_K);

    // ------------------------------------------------------------------------------------------ engines (ideas 31 and 32)
    var RL10 = (function () {
      var row = TABLE.ROWS.filter(function (r) { return r.engine === 'RL10A-3-3'; })[0];
      var c = B.engineCase(row, PRESETS);
      var pt = c.points[0];
      return { row: row, Lf: c.Lf, pc: c.pcChem, eps: c.eps, of: c.mr, published: pt.ispPublished, shifting: pt.shifting.isp, frozen: pt.frozen.isp, eta: pt.ispPublished / pt.shifting.isp, lambda: c.lambda };
    })();
    var PROP = {
      liquid: { oxidizer: [{ name: 'O2(L)', w: 1 }], fuel: [{ name: 'H2(L)', w: 1 }] },
      gas: { oxidizer: [{ name: 'O2', w: 1, T: NIST.h2_293K.T_K }], fuel: [{ name: 'H2', w: 1, T: NIST.h2_293K.T_K }] },
    };
    function steamProp(T) { return { oxidizer: [{ name: 'H2O', w: 1, T: T }], fuel: [{ name: 'H2O', w: 1, T: T }] }; }
    var CACHE = {};
    function guarded(fn, what) {
      try { return fn(); } catch (e) {
        return { refusal: refusal('out_of_envelope', 'Idea 31\'s kernel failed on ' + what + ' (it threw "' + String(e && e.message || e).slice(0, 80) + '"): the expansion fell below the 200 K floor of its thermodynamic fits, where it has no data, instead of refusing.', 'A smaller area ratio or a higher chamber temperature; see Findings in the README.') };
      }
    }
    /** Vacuum Isp (m/s) of a propellant at a mixture ratio: shifting and frozen ideal, divergence lambda, delivered = eta x shifting. */
    function engineIsp(prop, key, of, pc, eps, Lf, eta) {
      var ck = key + '|' + of + '|' + pc + '|' + eps + '|' + Lf + '|' + eta;
      if (CACHE[ck]) return CACHE[ck];
      var out = guarded(function () {
        var lam = B.lambdaBell(Lf, eps);
        if (lam.refusal) return { refusal: lam.refusal };
        var r = M.rocket(db, prop, of, pc);
        if (r.refusal) return { refusal: r.refusal };
        var res = { of: of, Tc: r.chamber.T, cstar: r.cstar, lambda: lam.value, Mc: r.chamber.M, gamma: r.chamber.gamma_s };
        ['shifting', 'frozen'].forEach(function (mode) {
          var b = B.flow(r, mode);
          if (b.refusal) { res[mode] = { refusal: b.refusal }; return; }
          var st = B.stationAtArea(b, eps);
          if (st.refusal) { res[mode] = { refusal: st.refusal }; return; }
          // Idea 32's stationAtArea can stop on a collapsed bracket and hand back the last station that converged, at
          // another area ratio, without refusing (Findings). Check the station is the one asked for.
          if (!(Math.abs(st.eps / eps - 1) < 1e-6)) {
            var below = B.stationAtPressure(b, st.P * 0.98, null);
            res[mode] = { refusal: refusal('out_of_envelope', 'Idea 32\'s ' + mode + ' expansion stopped at area ratio ' + fmt(st.eps, 5) + ' (' + fmt(st.P / 1e5, 4) + ' bar, ' + fmt(st.T, 4) + ' K) instead of ' + fmt(eps) + ' and handed that station back without refusing' +
              (below.refusal ? '; started from the throat\'s state, idea 31\'s equilibrium refuses just below it ("' + below.refusal.reason.replace(/^In the nozzle at [^:]*: /, '').slice(0, 90) + '")' : '') + '.', 'A smaller area ratio, or the frozen expansion (see Findings in the README).'), stopped: { eps: st.eps, P: st.P, T: st.T } };
            return;
          }
          var p = B.performance(b, st, 0, lam.value);
          res[mode] = { ivac: p.Ivac, Te: st.T, pe: st.P };
        });
        if (res.shifting.refusal && res.frozen.refusal) return { refusal: res.shifting.refusal, partial: res };
        res.delivered = res.shifting.ivac ? eta * res.shifting.ivac : null;
        return res;
      }, key + ' at O/F ' + fmt(of) + ', ' + fmt(pc / 1e5) + ' bar, area ratio ' + fmt(eps));
      CACHE[ck] = out;
      return out;
    }
    function clearCache() { CACHE = {}; }
    /** O/F sweep of delivered Isp and the Delta-v it buys with mH kg of hydrogen and at most mO kg of oxygen on mDry. */
    function ofTrade(state, mH, mO, mDry, eng) {
      var prop = PROP[state];
      var rMax = Math.min(R_ST, mH > 0 ? mO / mH : R_ST);
      var lo = 2;
      function dv(r) {
        var e = engineIsp(prop, state, r, eng.pc, eng.eps, eng.Lf, eng.eta);
        if (e.refusal || !e.delivered) return { r: r, refusal: e.refusal || refusal('out_of_envelope', 'No shifting expansion at O/F ' + fmt(r) + '.', 'Another mixture ratio.'), isp: null, dv: -Infinity };
        var fuel = Math.min(mH, mO / r), ox = fuel * r;
        return { r: r, isp: e.delivered, ideal: e.shifting.ivac, frozen: e.frozen && e.frozen.ivac, Tc: e.Tc, fuel: fuel, ox: ox, dv: e.delivered * Math.log((mDry + fuel + ox) / mDry) };
      }
      var pts = [];
      var n = 24;
      for (var i = 0; i <= n; i++) pts.push(dv(lo + (R_ST - lo) * i / n));
      // golden-section refinement of the best point inside [lo, rMax]
      var best = null;
      pts.forEach(function (p) { if (p.r <= rMax + 1e-12 && p.dv > (best ? best.dv : -Infinity)) best = p; });
      var opt = null;
      if (best && rMax > lo) {
        var a = Math.max(lo, best.r - (R_ST - lo) / n), b = Math.min(rMax, best.r + (R_ST - lo) / n), g = (Math.sqrt(5) - 1) / 2;
        var c = b - g * (b - a), d = a + g * (b - a), fc = dv(c), fd = dv(d);
        for (var k = 0; k < 30 && b - a > 1e-4; k++) {
          if (fc.dv >= fd.dv) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = dv(c); }
          else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = dv(d); }
        }
        opt = dv((a + b) / 2);
        var atMax = dv(rMax);
        if (atMax.dv >= opt.dv) opt = atMax;
        if (best.dv > opt.dv) opt = best;
      } else if (rMax >= lo) opt = dv(rMax);
      return { pts: pts, opt: opt, rMax: rMax, lo: lo, dv: dv };
    }

    // ------------------------------------------------------------------------------------------ importing idea 45
    function parseInput(input) {
      var obj = input;
      try {
        if (typeof input === 'string') {
          var s = input.trim();
          var m = s.match(/(?:^|[#&?])h=([A-Za-z0-9_-]+)/);
          if (m) s = b64urlDecode(m[1]);
          else if (/^[A-Za-z0-9_-]+$/.test(s) && s.length > 16) s = b64urlDecode(s);
          obj = JSON.parse(s);
        }
      } catch (e) {
        return { refusal: refusal('invalid_input', 'That is not a handoff: it does not read as JSON or as a base64url #h= fragment.', 'Paste the JSON a module exported, or its link.') };
      }
      if (!obj || typeof obj !== 'object' || obj.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'The object is not a long-way-round handoff (its "handoff" field is not "long-way-round").', 'A handoff exported by a module of this series.') };
      if (obj.version !== 1) return { refusal: refusal('invalid_input', 'Handoff version ' + obj.version + ' is not understood; this module reads version 1.', 'A version 1 handoff.') };
      return { obj: obj };
    }
    var close = function (a, b, tol) { return Math.abs(a - b) <= tol * Math.abs(b) + 1e-12; };
    // Idea 45 rounds its day-by-day timeline to 6 significant figures and its totals to 9 (dig.js buildHandoff), so its
    // own arithmetic holds here to about 1e-5, not to the 1e-9 its kernel keeps.
    var TL_TOL = 2e-5;
    /** Check idea 45's handoff (its envelope, units and its own arithmetic) and pull out what this module needs. */
    function importDig(h) {
      if (h.from !== '45-dig') {
        var hint = /^4[0-4]-/.test(String(h.from)) ? ' Open it in idea 45 (Dig) first, then bring that page\'s export here.' : '';
        return { refusal: refusal('invalid_input', 'This handoff is from ' + (h.from || 'an unknown module') + '; Split reads idea 45\'s (Dig).' + hint, 'A handoff exported by 45-dig, or this page\'s own.') };
      }
      var O = h.outputs || {};
      var need = { water_rate: 'kg/day, kg', timeline: 'days, au, h, J, kg', site: 'm/s^2, deg, kg, N', feedstock: 'kg/kg, K, K/s', collector: 'm^2, W/m^2' };
      for (var k in need) {
        if (!O[k] || !O[k].value) return { refusal: refusal('invalid_input', 'Idea 45\'s handoff has no "' + k + '" output.', 'The whole handoff idea 45 exported.') };
        if (O[k].units !== need[k]) return { refusal: refusal('invalid_input', 'Idea 45\'s "' + k + '" is in "' + O[k].units + '", not "' + need[k] + '".', 'A handoff from idea 45 as committed.') };
      }
      var w = O.water_rate.value, tl = O.timeline.value, fs = O.feedstock.value;
      var n = tl.day && tl.day.length;
      if (!(n > 0) || ['utc0', 'r_au', 'lit_h', 'water_kg', 'regolith_kg'].some(function (f) { return !Array.isArray(tl[f]) || tl[f].length !== n; }))
        return { refusal: refusal('invalid_input', 'Idea 45\'s timeline is ragged or empty.', 'The handoff idea 45 exported, unedited.') };
      var tot = 0, mn = Infinity, mx = -Infinity;
      for (var i = 0; i < n; i++) {
        var wd = tl.water_kg[i];
        if (!(wd >= 0) || !(tl.r_au[i] > 0) || !(tl.lit_h[i] >= 0 && tl.lit_h[i] <= 24)) return { refusal: refusal('invalid_input', 'Idea 45\'s day ' + (i + 1) + ' has an impossible value.', 'The handoff idea 45 exported, unedited.') };
        if (!close(wd, tl.regolith_kg[i] * fs.water_mass_fraction, TL_TOL)) return { refusal: refusal('invalid_input', 'Idea 45\'s day ' + (i + 1) + ' says ' + fmt(wd, 7) + ' kg of water from ' + fmt(tl.regolith_kg[i], 7) + ' kg of regolith at ' + fmt(fs.water_mass_fraction, 6) + ' kg/kg; its own arithmetic does not hold.', 'The handoff idea 45 exported, unedited.') };
        tot += wd; mn = Math.min(mn, wd); mx = Math.max(mx, wd);
      }
      if (!close(tot, w.total_kg, TL_TOL) || !close(tot / n, w.mean_kg_per_day, TL_TOL) || !close(mn, w.min_kg_per_day, TL_TOL) || !close(mx, w.max_kg_per_day, TL_TOL) || w.days !== n)
        return { refusal: refusal('invalid_input', 'Idea 45\'s water totals (' + fmt(w.total_kg, 7) + ' kg over ' + w.days + ' days) do not add up from its own day-by-day water (' + fmt(tot, 7) + ' kg over ' + n + ').', 'The handoff idea 45 exported, unedited.') };
      if (!(O.site.value.mass_kg > 0)) return { refusal: refusal('invalid_input', 'Idea 45\'s site carries no spacecraft mass.', 'The handoff idea 45 exported.') };
      var carried = (h.refusals || []).map(function (r) { return Object.assign({}, r, { from: r.from || '45-dig' }); });
      var og = fs.other_gases_mass_fraction || {};
      var otherFrac = (og.co2 || 0) + (og.so2 || 0) + (og.organics || 0);
      var days = [];
      for (i = 0; i < n; i++) days.push({ day: tl.day[i], utc0: tl.utc0[i], r_au: tl.r_au[i], lit_h: tl.lit_h[i], water_kg: tl.water_kg[i] });
      var end = new Date(Date.parse(tl.utc0[n - 1]) + DAY * 1000).toISOString();
      return { h45: h, site: O.site.value, water: w, feedstock: fs, collector: O.collector.value, days: days, carried: carried, otherFrac: otherFrac, bound: w.bound, end_utc: end };
    }

    // ------------------------------------------------------------------------------------------ settings
    function defaults(src) {
      return {
        route: 'cryo', cell: 'status2022', V_custom: CELL_PRESETS.status2022.V, etaF: OGA_ETA, T_cell: 333.15,
        array: 'near', P1au: ARRAYS.near.P1,
        Twb: S.mhtb.points[1][0], zbo: true, fCarnot90: CC_FCARNOT,
        p_store_MPa: 20, material: '6061-T6',
        of_mode: 'optimal', of: RL10.of, pc: RL10.pc, eps: RL10.eps, Lf: RL10.Lf,
        T_heat: src && src.feedstock && src.feedstock.peak_K || 1023.15, pc_steam: 1e6, eps_steam: 10,
        dry_kg: src && src.site ? src.site.mass_kg : null,
      };
    }
    function validSettings(st) {
      var bad = function (what, help) { return refusal('invalid_input', what, help); };
      if (['cryo', 'gas', 'steam'].indexOf(st.route) < 0) return bad('Unknown route "' + st.route + '".', 'cryo, gas or steam.');
      if (st.cell !== 'custom' && !CELL_PRESETS[st.cell]) return bad('Unknown electrolyser preset "' + st.cell + '".', Object.keys(CELL_PRESETS).join(', ') + ' or custom.');
      if (st.cell === 'custom' && !(st.V_custom > 1 && st.V_custom <= 3)) return bad('A custom cell voltage must be a number between 1 and 3 V (got ' + fmt(st.V_custom) + ').', 'A cell voltage such as DOE\'s 1.6 to 1.9 V.');
      if (!(st.etaF > 0 && st.etaF <= 1)) return bad('The Faraday efficiency must be above 0 and at most 1.', 'A fraction such as ' + fmt(OGA_ETA, 4) + '.');
      if (!finite(st.T_cell)) return bad('The cell temperature must be a number.', 'Kelvin between ' + T_CELL_ENV[0] + ' and ' + T_CELL_ENV[1] + '.');
      if (!(st.P1au > 0 && st.P1au <= 1e7)) return bad('The array power at 1 au must be above 0 W and at most 10 MW (got ' + fmt(st.P1au) + ').', 'A preset or a power in watts.');
      if (!(st.dry_kg > 0 && st.dry_kg <= 1e7)) return bad('The spacecraft dry mass must be above 0 kg (got ' + fmt(st.dry_kg) + ').', 'Idea 45\'s mass on the ground, or a mass in kg.');
      if (st.route === 'cryo') {
        if (!finite(st.Twb)) return bad('The insulation\'s warm-boundary temperature must be a number.', 'Kelvin between 164 and 305.');
        if (!(st.fCarnot90 > 0 && st.fCarnot90 <= 1)) return bad('The 90 K stage\'s fraction of Carnot must be above 0 and at most 1.', 'A fraction such as the 20 K unit\'s ' + fmt(CC_FCARNOT, 4) + '.');
      }
      if (st.route === 'gas') {
        if (!(st.p_store_MPa * 1e6 >= P_GAS_ENV[0] && st.p_store_MPa * 1e6 <= P_GAS_ENV[1])) return bad('The storage pressure must be between ' + P_GAS_ENV[0] / 1e6 + ' and ' + P_GAS_ENV[1] / 1e6 + ' MPa, the span of the NIST tables carried here (got ' + fmt(st.p_store_MPa) + ').', 'A pressure inside that span.');
        if (!material(st.material)) return bad('Unknown tank material "' + st.material + '".', Object.keys(MAT.metals).join(', ') + '.');
      }
      if (st.route === 'steam' && !material(st.material)) return bad('Unknown tank material "' + st.material + '".', Object.keys(MAT.metals).join(', ') + '.');
      if (st.route !== 'steam') {
        if (['optimal', 'stoich', 'fixed'].indexOf(st.of_mode) < 0) return bad('Unknown mixture-ratio choice "' + st.of_mode + '".', 'optimal, stoich or fixed.');
        if (st.of_mode === 'fixed' && !(st.of >= 2 && st.of <= R_ST + 1e-9)) return bad('A mixture ratio must be between 2 and ' + fmt(R_ST, 5) + ', the most oxygen the water itself carries (got ' + fmt(st.of) + ').', 'O/F between 2 and ' + fmt(R_ST, 5) + '.');
        if (!(st.pc > 0) || !(st.eps > 1) || !(st.Lf >= 0.6 && st.Lf <= 1)) return bad('The engine needs a chamber pressure above 0, an area ratio above 1 and a bell length between 60 and 100 % of a 15-degree cone.', 'Values like the RL10A-3-3\'s.');
      } else {
        if (!(st.T_heat >= 500 && st.T_heat <= 3500)) return bad('The steam heater temperature must be between 500 and 3500 K (got ' + fmt(st.T_heat) + ').', 'A heater temperature inside that span.');
        if (!(st.pc_steam > 0) || !(st.eps_steam > 1)) return bad('The steam thruster needs a chamber pressure above 0 and an area ratio above 1.', 'Values such as 1 MPa and 10.');
      }
      return null;
    }

    // ------------------------------------------------------------------------------------------ the stay, day by day
    function ledger(src, st, ctx) {
      var cellR = ctx.cell, e = cellR ? cellR.e_J_per_kg_water : 0;
      var rows = [], buffer = 0, H = 0, O = 0, made = { h2: 0, o2: 0 }, vented = 0, boil = { h2: 0, o2: 0 }, split = 0, energy = 0, zboShort = 0, coolMax = 0;
      var keepO = ctx.keepO; // kg of O2 kept per kg of H2 made
      src.days.forEach(function (d) {
        var lit = d.lit_h * 3600, dark = DAY - lit;
        var P = arrayPower(st.P1au, d.r_au);
        buffer += d.water_kg;
        var w = 0, limit = 'water', zboOn = false, cool = { P: 0, units: 0 }, Pused = 0;
        if (st.route === 'steam') { limit = 'none'; }
        else if (lit <= 0) { limit = 'dark'; }
        else {
          var maxW = buffer / lit;
          var loads = function (rate, zbo) {
            var pel = rate * e;
            if (st.route !== 'cryo') return { P: pel, cool: { P: 0, units: 0 } };
            var hRate = rate * FH, oRate = hRate * keepO;
            var q20 = hRate * ctx.liq.h2_lo + (zbo ? ctx.leak.h2 : 0);
            var q90 = hRate * ctx.liq.h2_hi + oRate * ctx.liq.o2 + (zbo ? ctx.leak.o2 : 0);
            var c20 = cooler20(q20);
            return { P: pel + c20.P + q90 * ctx.sp90, cool: c20 };
          };
          zboOn = st.route === 'cryo' && st.zbo && (H > 0 || O > 0 || maxW > 0);
          if (zboOn && loads(0, true).P > P) { zboOn = false; zboShort++; }
          var top = loads(maxW, zboOn);
          if (top.P <= P) { w = maxW; limit = 'water'; cool = top.cool; Pused = top.P; }
          else {
            var lo = 0, hi = maxW;
            for (var k = 0; k < 60; k++) { var mid = (lo + hi) / 2; if (loads(mid, zboOn).P <= P) lo = mid; else hi = mid; }
            w = lo; limit = 'power'; var L0 = loads(w, zboOn); cool = L0.cool; Pused = L0.P;
          }
        }
        var sp = w * lit;
        buffer -= sp; if (buffer < 1e-15) buffer = Math.max(0, buffer);
        split += sp; energy += Pused * lit;
        coolMax = Math.max(coolMax, cool.units);
        var hMade = sp * FH, oMade = sp * FO, oKeep = Math.min(oMade, hMade * keepO);
        made.h2 += hMade; made.o2 += oMade; vented += oMade - oKeep;
        H += hMade; O += oKeep;
        var bH = 0, bO = 0;
        if (st.route === 'cryo') {
          var tb = zboOn ? dark : DAY;
          bH = Math.min(H, ctx.leak.h2 * tb / hfg(PH2)); bO = Math.min(O, ctx.leak.o2 * tb / hfg(LO2));
          H -= bH; O -= bO; boil.h2 += bH; boil.o2 += bO;
        }
        rows.push({ day: d.day, utc0: d.utc0, r_au: d.r_au, lit_h: d.lit_h, P_W: P, used_W: Pused, water_in: d.water_kg, split_kg: sp, buffer_kg: buffer, h2_kg: H, o2_kg: O, boil_h2: bH, boil_o2: bO, limit: limit, zbo: zboOn, coolers: cool.units });
      });
      return { rows: rows, buffer: buffer, H: H, O: O, made: made, vented: vented, boil: boil, split: split, energy: energy, zboShort: zboShort, coolMax: coolMax };
    }

    function run(src, settings) {
      var st = Object.assign(defaults(src), settings || {});
      var bad = validSettings(st);
      if (bad) return { refusal: bad, settings: st };
      clearCacheIfNeeded();
      var own = [];
      var waterTotal = src.water.total_kg;
      var ctx = { keepO: R_ST };
      var res = { settings: st, src: src, own: own };
      if (st.route !== 'steam') {
        var V = st.cell === 'custom' ? st.V_custom : CELL_PRESETS[st.cell].V;
        var pOut = st.route === 'gas' ? st.p_store_MPa * 1e6 : ATM;
        var c = cell({ V: V, etaF: st.etaF, T: st.T_cell, p: pOut });
        if (c.refusal) return { refusal: c.refusal, settings: st };
        ctx.cell = c; res.cell = c;
      }
      var eng = { pc: st.pc, eps: st.eps, Lf: st.Lf, eta: RL10.eta };
      var state = st.route === 'cryo' ? 'liquid' : 'gas';
      var mat = st.route !== 'cryo' ? material(st.material) : null;
      if (st.route === 'cryo') {
        var liq = liquefaction(st.T_cell);
        if (liq.refusal) return { refusal: liq.refusal, settings: st };
        var mf = mliFlux(st.Twb);
        if (mf.refusal) return { refusal: mf.refusal, settings: st };
        ctx.liq = liq; ctx.mli = mf; ctx.sp90 = sp90(st.fCarnot90);
        res.liq = liq; res.mli = mf; res.sp90 = ctx.sp90;
      }
      // Tanks are sized at the start for everything idea 45 could make (its total water), so the insulation's leak is
      // that of the full-size tank all stay. In 'optimal' mode the oxygen kept depends on the burn, so iterate.
      function sizeTanks(keepO) {
        var mH = waterTotal * FH, mO = mH * keepO;
        if (st.route === 'cryo') {
          var VH = mH / PH2.sat.rho_l, VO = mO / LO2.sat.rho_l;
          var AH = VH > 0 ? sphereArea(VH) : 0, AO = VO > 0 ? sphereArea(VO) : 0;
          return { VH: VH, VO: VO, AH: AH, AO: AO, leak: { h2: ctx.mli.q * AH, o2: ctx.mli.q * AO } };
        }
        if (st.route === 'gas') {
          var p = st.p_store_MPa * 1e6, rH = gasDensity('h2_293K', p), rO = gasDensity('o2_293K', p);
          var VHg = mH / rH, VOg = mO / rO;
          return { VH: VHg, VO: VOg, rhoH: rH, rhoO: rO, mH_tank: tankMass(p, VHg, mat), mO_tank: tankMass(p, VOg, mat), p: p,
            ZH: p * MW.h2 / (rH * R * NIST.h2_293K.T_K), ZO: p * MW.o2 / (rO * R * NIST.o2_293K.T_K) };
        }
        var Vw = waterTotal / WATER_RHO;
        return { VW: Vw, mW_tank: tankMass(st.pc_steam, Vw, mat), rhoW: WATER_RHO };
      }
      var tanks, L, trade = null, rTarget, it;
      if (st.route === 'steam') {
        tanks = sizeTanks(0);
        L = ledger(src, st, ctx);
      } else {
        rTarget = st.of_mode === 'fixed' ? st.of : R_ST;
        var craftDry = st.dry_kg;
        for (it = 0; it < 4; it++) {
          ctx.keepO = rTarget;
          tanks = sizeTanks(rTarget);
          if (st.route === 'cryo') ctx.leak = tanks.leak;
          L = ledger(src, st, ctx);
          var dryNow = craftDry + (tanks.mH_tank || 0) + (tanks.mO_tank || 0) + (st.route === 'cryo' ? L.coolMax * CC_UNIT_KG : 0);
          trade = ofTrade(state, L.H, L.O, dryNow, eng);
          if (st.of_mode !== 'optimal') break;
          var rNew = trade.opt ? trade.opt.r : R_ST;
          if (Math.abs(rNew - rTarget) < 1e-3) break;
          rTarget = rNew;
        }
        res.iterations = it + 1;
      }
      res.tanks = tanks; res.L = L;
      // --- the propellant
      var prop = null, dryHome = st.dry_kg;
      if (st.route === 'steam') {
        var sp = engineSteam(st);
        res.steam = sp;
        var mat2 = material(st.material);
        dryHome = st.dry_kg + tanks.mW_tank;
        var isp = sp.refusal ? null : (sp.frozenOnly ? sp.frozen : sp.shifting);
        prop = { route: 'steam', fuel: 'H2O', oxidizer: null, mixture_ratio: null, mass_kg: L.buffer, fuel_kg: L.buffer, oxidizer_kg: 0, isp_s: isp ? isp / G0 : null,
          isp_ideal_s: sp.shifting ? sp.shifting / G0 : null, isp_frozen_s: sp.frozen ? sp.frozen / G0 : null, ve_m_s: isp, Tc_K: sp.Tc, pc_Pa: st.pc_steam, eps: st.eps_steam,
          reactant_state: 'water stored liquid at ' + NIST.h2_293K.T_K + ' K, heated to ' + fmt(st.T_heat) + ' K as steam', heat_J_per_kg: sp.heat, tank: { material: mat2.name, mass_kg: tanks.mW_tank, volume_m3: tanks.VW } };
        if (sp.refusal) own.push(Object.assign({ applies_to: 'steam' }, sp.refusal));
      } else {
        var choose = st.of_mode === 'fixed' ? trade.dv(Math.min(st.of, trade.rMax)) : st.of_mode === 'stoich' ? trade.dv(trade.rMax) : trade.opt;
        dryHome = st.dry_kg + (tanks.mH_tank || 0) + (tanks.mO_tank || 0) + (st.route === 'cryo' ? L.coolMax * CC_UNIT_KG : 0);
        res.choice = choose;
        if (!choose || choose.refusal || !finite(choose.isp)) {
          own.push(Object.assign({ applies_to: 'engine' }, (choose && choose.refusal) || refusal('insufficient_data', 'No hydrogen was made, so there is no mixture to burn.', 'Water and the power to split it.')));
        }
        var ok = choose && !choose.refusal && finite(choose.isp) && choose.fuel > 0;
        if (choose && !choose.refusal && finite(choose.isp) && !(choose.fuel > 0)) own.push({ applies_to: 'propellant', code: 'out_of_envelope', reason: 'No hydrogen is left at the end of the stay: ' + fmt(L.made.h2, 3) + ' kg was made and ' + fmt(L.boil.h2, 3) + ' kg boiled off' + (L.split < 1e-9 ? ' (nothing was split)' : '') + ', so there is nothing to burn.', what_would_help: 'More array power for the coolers and the cell, smaller tanks, or the gas or steam route.' });
        var eAt = ok ? engineIsp(PROP[state], state, choose.r, eng.pc, eng.eps, eng.Lf, eng.eta) : null;
        prop = { route: st.route, fuel: 'H2', oxidizer: 'O2', mixture_ratio: ok ? choose.r : null, mass_kg: ok ? choose.fuel + choose.ox : 0, fuel_kg: ok ? choose.fuel : 0, oxidizer_kg: ok ? choose.ox : 0,
          isp_s: ok ? choose.isp / G0 : null, isp_ideal_s: ok ? choose.ideal / G0 : null, isp_frozen_s: ok && choose.frozen ? choose.frozen / G0 : null, ve_m_s: ok ? choose.isp : null, Tc_K: ok ? eAt.Tc : null, pc_Pa: st.pc, eps: st.eps,
          reactant_state: st.route === 'cryo' ? 'liquid oxygen and parahydrogen at their 1 atm boiling points (idea 31\'s O2(L) 90.17 K and H2(L) 20.27 K records)' : 'gaseous oxygen and hydrogen at ' + NIST.h2_293K.T_K + ' K',
          calibration: { engine: 'RL10A-3-3', published_isp_s: RL10.published / G0, shifting_isp_s: RL10.shifting / G0, eta: RL10.eta, of: RL10.of, source: 'NASA SP-8120 Table I via idea 32\'s engineCase()' },
          h2_left_kg: ok ? L.H - choose.fuel : L.H, o2_left_kg: ok ? L.O - choose.ox : L.O };
        if (st.route === 'gas') prop.tanks = { material: mat.name, h2_kg: tanks.mH_tank, o2_kg: tanks.mO_tank, h2_m3: tanks.VH, o2_m3: tanks.VO, p_Pa: tanks.p };
        if (st.route === 'cryo') prop.tanks = { h2_m3: tanks.VH, o2_m3: tanks.VO, h2_area_m2: tanks.AH, o2_area_m2: tanks.AO, coolers20: L.coolMax, coolers20_kg: L.coolMax * CC_UNIT_KG };
      }
      res.prop = prop;
      res.dryHome = dryHome;
      res.dv = prop && prop.ve_m_s && prop.mass_kg > 0 ? prop.ve_m_s * Math.log((dryHome + prop.mass_kg) / dryHome) : 0;
      res.trade = trade;
      res.rTarget = rTarget;
      ownRefusals(res);
      return res;
    }
    function clearCacheIfNeeded() { var n = Object.keys(CACHE).length; if (n > 4000) CACHE = {}; }

    function engineSteam(st) {
      var T = st.T_heat;
      var e = engineIsp(steamProp(T), 'steam' + T, 1, st.pc_steam, st.eps_steam, st.Lf, 1);
      var w = species(REC.w, NIST.h2_293K.T_K), g = species(REC.steam, T);
      var heat = g && w ? (g.H - w.H) / MW.h2o : null;
      if (e.refusal && !(e.partial && e.partial.frozen && e.partial.frozen.ivac)) return { refusal: e.refusal, heat: heat };
      var res = e.refusal ? e.partial : e;
      var out = { Tc: res.Tc, shifting: res.shifting && res.shifting.ivac || null, frozen: res.frozen && res.frozen.ivac || null, heat: heat, lambda: res.lambda };
      out.frozenOnly = !out.shifting;
      out.shiftRefusal = res.shifting && res.shifting.refusal || null;
      out.thrustPerW = (out.shifting || out.frozen) / heat;
      return out;
    }

    function ownRefusals(res) {
      var st = res.settings, src = res.src, own = res.own, L = res.L;
      if (src.bound === 'upper') own.push({ applies_to: 'water', code: 'insufficient_data', reason: 'Idea 45\'s water is an upper bound (all of Itokawa\'s 510 ppm counted as released), so every propellant figure here is an upper bound too.', what_would_help: 'A measured water release for this asteroid\'s rock (idea 45\'s "release" refusal).' });
      if (src.otherFrac > 0) {
        var og = src.days.reduce(function (a, d) { return a + d.water_kg; }, 0) / src.days.length * src.otherFrac / src.feedstock.water_mass_fraction;
        own.push({ applies_to: 'cleanup', code: 'insufficient_data', reason: 'About ' + fmt(og, 3) + ' kg a day of CO₂, SO₂ and organics come off with the water (idea 45); they must be separated before a PEM cell (sulfur poisons its catalysts). The separation, its power and its losses are not modelled: the water is treated as pure.', what_would_help: 'A gas-cleanup and water-purification design with its power and yield.' });
      }
      if (st.route !== 'steam') {
        own.push({ applies_to: 'electrolyser', code: 'insufficient_data', reason: 'The electrolyser\'s mass, and its pumps, dryers and power conditioning, are not on file (DOE gives $/kW and kWh/kg, not kg/kW); it is assumed to stay on the asteroid and is not in the return dry mass.', what_would_help: 'A flight electrolyser\'s mass per kW (the ISS OGA\'s, for instance).' });
        own.push({ applies_to: 'arrays', code: 'insufficient_data', reason: 'Array power is scaled as 1/r² from its 1 au value, ignoring cell temperature: checked only beyond 1 au, where it reads 7.0 % low for NEAR at 2.2 au and 3.5 to 17 % low for Psyche; ' + (Math.min.apply(null, src.days.map(function (d) { return d.r_au; })) < 1 ? 'this stay is inside 1 au, where hotter cells make it likely optimistic.' : 'this stay is beyond 1 au, so the power is likely a little low.'), what_would_help: 'The array\'s measured power against Sun distance and temperature.' });
        if (Math.abs(res.prop.mixture_ratio - RL10.of) > 0.25) own.push({ applies_to: 'engine', code: 'insufficient_data', reason: 'Delivered Isp is the shifting ideal times ' + fmt(RL10.eta, 4) + ', the RL10A-3-3\'s published/ideal at O/F ' + RL10.of + ' (SP-8120 Table I). At O/F ' + fmt(res.prop.mixture_ratio, 3) + ' that factor is carried, not measured; no flown hydrogen-oxygen engine on file runs there.', what_would_help: 'Hot-fire data for a hydrogen-oxygen engine at this mixture ratio.' });
      }
      if (st.route === 'cryo') {
        own.push({ applies_to: 'cryo_tanks', code: 'insufficient_data', reason: 'Cryogenic tank walls, insulation blankets and supports are not given a mass (they are set by minimum gauge and structure, not by pressure, and none are on file); their volumes and areas are computed.', what_would_help: 'A small flight cryogenic tank\'s mass per litre.' });
        own.push({ applies_to: 'mli', code: 'insufficient_data', reason: 'The heat leak is MHTB\'s ' + S.mhtb.layers + '-layer insulation on an ' + S.mhtb.tank_m3 + ' m³ tank, ' + fmt(res.mli.q, 3) + ' W/m² at ' + fmt(st.Twb) + ' K; tanks this small (' + fmt(res.tanks.VH * 1000, 3) + ' L of hydrogen) leak more per m² through supports and pipes, so boil-off here is a lower bound.', what_would_help: 'Heat-leak data for a tank of this size.' });
        own.push({ applies_to: 'cooler90', code: 'insufficient_data', reason: 'No 90 K cryocooler\'s measured efficiency or mass is on file: the 90 K stage is costed at ' + fmt(st.fCarnot90 * 100, 4) + ' % of Carnot (the 20 K unit\'s at full lift, NASA/Creare 2026), ' + fmt(res.sp90, 4) + ' W per W, and given no mass.', what_would_help: 'A flight 90 K cryocooler\'s measured input power and mass (NASA\'s 150 W class).' });
        if (L.zboShort > 0) own.push({ applies_to: 'zbo', code: 'out_of_envelope', reason: 'On ' + L.zboShort + ' day(s) the arrays could not even run the coolers that hold the boil-off, so the tanks boiled all day.', what_would_help: 'More array power, or turning zero boil-off off.' });
        if (st.zbo) own.push({ applies_to: 'night', code: 'insufficient_data', reason: 'There are no batteries: coolers and electrolyser run only while the Sun is up at the site, and the tanks boil in the dark.', what_would_help: 'A battery and its mass.' });
      }
      if (st.route === 'gas') own.push({ applies_to: 'pressure', code: 'insufficient_data', reason: 'The electrolyser delivers both gases at ' + fmt(st.p_store_MPa) + ' MPa by itself, costing only the Nernst voltage (' + fmt(res.cell.Vnernst * 1000, 3) + ' mV); the hydrogen that crosses the membrane rises with pressure and is not modelled, nor is a compressor. Tanks are thin-walled ' + material(st.material).name + ' spheres at PartForge\'s NASA-STD-5001B metallic ultimate factor ' + FS + ' (pressure vessels are governed by other standards, not on file)' + (material(st.material).verify ? '; PartForge marks this material\'s strengths "verify"' : '') + '.', what_would_help: 'High-pressure electrolysis crossover data and a pressure-vessel standard\'s burst factor.' });
      if (st.route === 'steam') {
        own.push({ applies_to: 'steam', code: 'insufficient_data', reason: 'No flown steam thruster\'s performance is on file, so the Isp is ideal (idea 31\'s equilibrium chamber, idea 32\'s nozzle) with no delivered-to-ideal factor.', what_would_help: 'A flown or hot-fired water thruster\'s measured Isp at a known heater temperature.' });
        if (res.steam && res.steam.frozenOnly) {
          var why = res.steam.shiftRefusal ? res.steam.shiftRefusal.reason : '';
          own.push(/deposit H2O/.test(why) ? { applies_to: 'steam', code: 'out_of_envelope', reason: 'Expanded in equilibrium the steam would condense in the nozzle (' + why.slice(0, 110) + '); the Isp shown is the frozen, supersaturated expansion, which ignores the droplets.', what_would_help: 'A smaller area ratio or a hotter heater, or a two-phase nozzle model.' }
            : { applies_to: 'steam', code: 'out_of_envelope', reason: 'The shifting expansion has no answer here: ' + why + ' The Isp shown is the frozen expansion; at these temperatures almost nothing dissociates, so the two agree to a few parts per million wherever both exist (NASA CEA at 1500 K: 0.02 %).', what_would_help: 'A smaller area ratio or a hotter heater.' });
        }
        var Ttop = stagnation(res.src.collector);
        if (Ttop && st.T_heat > Ttop) own.push({ applies_to: 'steam', code: 'out_of_envelope', reason: 'Idea 45\'s concentrator (' + fmt(res.src.collector.concentration) + '×, η ' + fmt(res.src.collector.eta_opt) + ') reaches at most ' + fmt(Ttop, 4) + ' K at the first day\'s sunlight, below this ' + fmt(st.T_heat) + ' K heater; the heater would have to be electric.', what_would_help: 'More concentration, or an electric heater and its power.' });
      }
      if (L.buffer > 1e-9 && st.route !== 'steam') own.push({ applies_to: 'power', code: 'out_of_envelope', reason: fmt(L.buffer, 3) + ' kg of the stay\'s ' + fmt(res.src.water.total_kg, 4) + ' kg of water is left unsplit: the arrays limited ' + L.rows.filter(function (r) { return r.limit === 'power'; }).length + ' of ' + L.rows.length + ' days.', what_would_help: 'More array power, a more efficient cell, or a longer stay.' });
    }
    /** Highest cavity temperature idea 45's concentrator reaches (eps sigma T^4 = C eta S) on the stay's first day. */
    function stagnation(col) {
      if (!col || !(col.concentration > 0) || !(col.S_epoch_W_m2 > 0)) return null;
      return Math.pow(col.concentration * col.eta_opt * col.S_epoch_W_m2 / ((col.emissivity || 1) * SIGMA), 0.25);
    }

    // ------------------------------------------------------------------------------------------ reality checks (live)
    function reality() {
      var rows = [];
      var j = S.janaf.rows.filter(function (r) { return r[0] === 298.15; })[0];
      var el = electrolysis(298.15);
      rows.push({ id: 'erev', check: 'Reversible voltage at 298.15 K, from idea 31\'s NASA Glenn data', reality: -j[4] * 1000 / (2 * F), model: el.Erev, units: 'V', source: 'NIST-JANAF H-063: ΔfG° ' + j[4] + ' kJ/mol' });
      rows.push({ id: 'etn', check: 'Thermoneutral voltage at 298.15 K', reality: -j[3] * 1000 / (2 * F), model: el.Etn, units: 'V', source: 'NIST-JANAF H-063: ΔfH° ' + j[3] + ' kJ/mol' });
      Object.keys(S.doe.points).forEach(function (k) {
        var p = S.doe.points[k];
        var c = cell({ V: p.V_cell, etaF: 1 - S.doe.crossover_loss, T: 298.15, p: P0 });
        rows.push({ id: 'doe-' + k, check: p.label + ': stack energy at ' + p.V_cell + ' V with DOE\'s 2.5 % crossover', reality: p.stack_kWh_kg, model: c.kWh_per_kg_h2, units: 'kWh/kg H₂', source: S.doe.cite.split(',')[0] });
      });
      rows.push({ id: 'oga', check: 'ISS OGA: ' + OGA.cells + ' cells at ' + OGA.current_A + ' A, by Faraday\'s law at 100 %', reality: OGA.o2_kg_day, model: OGA_IDEAL, units: 'kg O₂/day', source: 'ICES-2024-101; the gap is the implied Faraday efficiency, ' + fmt(OGA_ETA, 4) });
      var n = S.arrays.near;
      rows.push({ id: 'near', check: 'NEAR\'s arrays at ' + n.r_far_au + ' au, from ' + n.P_1au_W + ' W at 1 au by 1/r²', reality: n.P_far_W, model: arrayPower(n.P_1au_W, n.r_far_au), units: 'W', source: 'NSSDCA 1996-008A' });
      var ps = S.arrays.psyche, po = S.arrays.psycheOrbit;
      rows.push({ id: 'psyche-Q', check: 'Psyche\'s arrays at aphelion ' + po.Q_au + ' au (SBDB)', reality: ps.P_orbit_W[0], model: arrayPower(ps.P_1au_W, po.Q_au), units: 'W', source: 'NASA Psyche spacecraft page (low end of 2.3 to 3.4 kW)' });
      rows.push({ id: 'psyche-q', check: 'Psyche\'s arrays at perihelion ' + po.q_au + ' au (SBDB)', reality: ps.P_orbit_W[1], model: arrayPower(ps.P_1au_W, po.q_au), units: 'W', source: 'NASA Psyche spacecraft page (high end)' });
      rows.push({ id: 'rl10', check: 'RL10A-3-3 vacuum Isp, ideal shifting (ideas 31 and 32) at its own conditions', reality: RL10.published / G0, model: RL10.shifting / G0, units: 's', source: 'NASA SP-8120 Table I: 444 s; this ratio is the delivered-Isp factor' });
      rows.push({ id: 'hvap', check: 'Heat of vaporization of liquid hydrogen (NIST, parahydrogen, 1 atm)', reality: S.orthoPara.vaporization_cal_mol * CAL / MW.h2, model: hfg(PH2), units: 'J/kg', source: 'Weitzel et al. (1958): 216 cal/mol' });
      rows.push({ id: 'lox', check: 'Liquid oxygen density at its 1 atm boiling point (this NIST table) against idea 31\'s at 90.17 K', reality: densityOf('O2(L)'), model: LO2.sat.rho_l, units: 'kg/m\u00b3', source: 'idea 31\'s snapshot: NIST WebBook at 90.17 K' });
      rows.push({ id: 'lh2', check: 'Liquid parahydrogen density at its 1 atm boiling point against idea 31\'s at 20.27 K', reality: densityOf('H2(L)'), model: PH2.sat.rho_l, units: 'kg/m\u00b3', source: 'idea 31\'s snapshot: NIST WebBook at 20.27 K' });
      rows.forEach(function (r) { r.gap = finite(r.reality) && finite(r.model) ? (r.model - r.reality) / r.reality : null; });
      return rows;
    }
    function densityOf(name) {
      var row = deps.densities && deps.densities.components && deps.densities.components[name];
      return row && finite(row.value) ? row.value : null;
    }

    // ------------------------------------------------------------------------------------------ handoff
    function q(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function r6(x) { return finite(x) ? +x.toPrecision(9) : x; }
    function round(o) {
      if (Array.isArray(o)) return o.map(round);
      if (o && typeof o === 'object') { var out = {}; for (var k in o) out[k] = round(o[k]); return out; }
      return typeof o === 'number' ? r6(o) : o;
    }
    function r6a(rows, k) { return rows.map(function (r) { return finite(r[k]) ? +r[k].toPrecision(6) : r[k]; }); }
    function settingsOut(st) { var o = {}; Object.keys(st).forEach(function (k) { o[k] = st[k]; }); return o; } // full precision: a re-run must reproduce the outputs exactly
    function buildHandoff(res, produced) {
      var st = res.settings, L = res.L, p = res.prop, src = res.src;
      var upper = src.bound === 'upper';
      var conf = upper ? 'assumed' : 'derived';
      var outputs = {
        propellant: q(round(p), 'kg, s, m/s, K, Pa', conf, KERNEL + ' run(): ' + (st.route === 'steam' ? 'water kept for a steam thruster' : 'electrolysis products at the chosen mixture ratio, Isp from ideas 31 and 32 times the RL10A-3-3 factor')),
        site: q(round({ body: src.site.body, key: src.site.key, spectral_class: src.site.spectral_class, mass_kg: src.site.mass_kg, stay_start_utc: src.days[0].utc0, stay_end_utc: src.end_utc, r_au_end: src.days[src.days.length - 1].r_au }), 'kg, au', 'derived', 'idea 45\'s site, passed through; the stay\'s end is its last day plus one'),
        dry_mass: q(round({ craft_kg: st.dry_kg, tanks_kg: (p.tanks && (p.tanks.h2_kg || 0) + (p.tanks.o2_kg || 0)) || (p.tank && p.tank.mass_kg) || 0, coolers_kg: p.tanks && p.tanks.coolers20_kg || 0, total_kg: res.dryHome, refused: st.route === 'cryo' ? ['cryogenic tank walls and insulation', '90 K cooler', 'cooler electronics'] : [] }), 'kg', 'assumed', KERNEL + ': the craft as idea 45 hands it on plus the propellant tanks and coolers carried home; the electrolyser stays behind'),
        delta_v_estimate: q(r6(res.dv), 'm/s', 'derived', 'Tsiolkovsky with the dry mass above, for comparison only; module 47 computes the return'),
        totals: q(round({ water_in_kg: L.rows.reduce(function (a, r) { return a + r.water_in; }, 0), water_split_kg: L.split, water_left_kg: L.buffer, h2_made_kg: L.made.h2, o2_made_kg: L.made.o2, o2_vented_kg: L.vented, boiloff_h2_kg: L.boil.h2, boiloff_o2_kg: L.boil.o2, h2_end_kg: L.H, o2_end_kg: L.O, energy_J: L.energy, days: L.rows.length }), 'kg, J, days', conf, KERNEL + ' ledger()'),
        ledger: q({ first_day_utc: src.days[0].utc0, days: L.rows.length, P_W: r6a(L.rows, 'P_W'), used_W: r6a(L.rows, 'used_W'), split_kg: r6a(L.rows, 'split_kg'), buffer_kg: r6a(L.rows, 'buffer_kg'), h2_kg: r6a(L.rows, 'h2_kg'), o2_kg: r6a(L.rows, 'o2_kg'), limit: L.rows.map(function (r) { return r.limit; }) }, 'days, W, kg', conf, KERNEL + ' ledger(): day by day, one entry per day from first_day_utc (6 significant figures)'),
      };
      if (res.cell) outputs.electrolyser = q(round({ preset: st.cell, V_cell: res.cell.V, V_1bar: res.cell.V1bar, V_nernst: res.cell.Vnernst, E_rev: res.cell.Erev, E_tn: res.cell.Etn, etaF: res.cell.etaF, T_K: res.cell.T, p_Pa: res.cell.p, J_per_kg_water: res.cell.e_J_per_kg_water, heat_J_per_kg_water: res.cell.heat_J_per_kg_water, kWh_per_kg_h2: res.cell.kWh_per_kg_h2 }), 'V, J/kg, K, Pa', 'derived', KERNEL + ' cell(): Faraday\'s law with idea 31\'s NASA Glenn thermodynamics');
      if (st.route === 'cryo') {
        outputs.cryo = q(round({ liquefaction_J_per_kg: { h2_upper: res.liq.h2_hi, h2_lower: res.liq.h2_lo, h2_conversion: res.liq.h2_conv, o2: res.liq.o2 }, upper_K: T_UP, lower_K: T_LOW, sp90_W_per_W: res.sp90, mli_W_m2: res.mli.q, warm_boundary_K: st.Twb, zbo: st.zbo,
          leak_W: res.tanks.leak, boiloff_passive_kg_per_day: { h2: res.tanks.leak.h2 * DAY / hfg(PH2), o2: res.tanks.leak.o2 * DAY / hfg(LO2) }, coolers20: L.coolMax }), 'J/kg, K, W, kg/day', 'derived', KERNEL + ': NIST WebBook enthalpies, NBS 1958 conversion heat, NASA/Creare 20 K cooler, MHTB insulation');
      }
      if (res.trade) outputs.of_trade = q(round({ of: res.trade.pts.map(function (x) { return x.r; }), isp_s: res.trade.pts.map(function (x) { return x.isp ? x.isp / G0 : null; }), dv_m_s: res.trade.pts.map(function (x) { return finite(x.dv) ? x.dv : null; }), of_max: res.trade.rMax, of_opt: res.trade.opt && res.trade.opt.r }), '1, s, m/s', 'derived', KERNEL + ' ofTrade()');
      var own = res.own.map(function (r) { return Object.assign({ from: '46-split' }, r); });
      return {
        handoff: 'long-way-round', version: 1, from: '46-split', produced: produced || new Date().toISOString(),
        inputs: { dig_handoff: pruneUpstream(src.h45), settings: settingsOut(st) },
        outputs: outputs,
        refusals: src.carried.concat(own),
        assumptions: assumptions(res),
      };
    }
    function assumptions(res) {
      var st = res.settings, a = [];
      a.push('Time is UTC as idea 45 hands it on; the stay is idea 45\'s ' + res.L.rows.length + ' days; power comes only while the Sun is up at the site (idea 45\'s lit hours), with no batteries.');
      if (st.route !== 'steam') {
        a.push('Electrolysis: liquid water at ' + fmt(st.T_cell) + ' K (a design choice), ' + fmt(res.cell.V, 4) + ' V per cell, Faraday efficiency ' + fmt(st.etaF, 4) + ' (the ISS OGA\'s implied value by default); overpotentials do not change with pressure; the water is pure.');
        a.push('Arrays: ' + fmt(st.P1au) + ' W at 1 au, scaled as 1/r² with idea 45\'s distance each day.');
        a.push('Mixture ratio: ' + (st.of_mode === 'optimal' ? 'the one that buys the most Δv with the hydrogen made, on the dry mass here' : st.of_mode === 'stoich' ? 'all the oxygen the water carries (or what boil-off left)' : 'fixed at ' + fmt(st.of)) + '; oxygen beyond it is vented, not stored. Delivered Isp = ideal shifting × the RL10A-3-3\'s ' + fmt(RL10.eta, 4) + '.');
      }
      if (st.route === 'cryo') a.push('Liquefaction at 1 atm: gas from the cell at ' + fmt(st.T_cell) + ' K cooled to ' + T_UP + ' K by a 90 K stage (' + fmt(st.fCarnot90 * 100, 4) + ' % of Carnot, rejecting at ' + T_REJ + ' K), hydrogen then liquefied and converted to para by NASA/Creare 20 K units on their measured turndown curve; tanks are spheres sized for idea 45\'s whole stay, insulated as MHTB.');
      if (st.route === 'gas') a.push('Gas storage at 293.15 K and ' + fmt(st.p_store_MPa) + ' MPa (NIST densities), thin-walled spheres of ' + material(st.material).name + '.');
      if (st.route === 'steam') a.push('Steam: water stored liquid at 293.15 K in a pressure-fed ' + material(st.material).name + ' sphere at the chamber pressure, heated to ' + fmt(st.T_heat) + ' K, expanded through idea 32\'s nozzle (area ratio ' + fmt(st.eps_steam) + ').');
      return a;
    }
    /** Read a handoff: idea 45's (to run on), or this module's own (re-run from its inputs and compared). */
    function parseHandoff(input) {
      var p = parseInput(input);
      if (p.refusal) return p;
      var h = p.obj;
      if (h.from === '46-split') {
        var inner = h.inputs && h.inputs.dig_handoff;
        if (!inner) return { refusal: refusal('invalid_input', 'This handoff from 46-split does not carry idea 45\'s handoff in its inputs.', 'A handoff this page exported, unedited.') };
        var src = importDig(inner);
        if (src.refusal) return src;
        var st = h.inputs.settings || {};
        var R2 = run(src, st);
        if (R2.refusal) return { refusal: R2.refusal };
        var again = buildHandoff(R2, h.produced);
        var a = h.outputs.propellant && h.outputs.propellant.value, b = again.outputs.propellant.value;
        var same = a && ['mass_kg', 'isp_s', 'fuel_kg', 'oxidizer_kg'].every(function (k) { return a[k] === b[k] || (finite(a[k]) && finite(b[k]) && close(a[k], b[k], 1e-6)); });
        if (!same) return { refusal: refusal('invalid_input', 'This handoff\'s propellant (' + fmt(a && a.mass_kg) + ' kg at ' + fmt(a && a.isp_s) + ' s) is not what its own inputs give here (' + fmt(b.mass_kg) + ' kg at ' + fmt(b.isp_s) + ' s): it was edited or made with other data.', 'Re-export it from this page.') };
        var codesA = (h.refusals || []).map(function (r) { return r.code + ':' + (r.applies_to || ''); }).join('|'), codesB = again.refusals.map(function (r) { return r.code + ':' + (r.applies_to || ''); }).join('|');
        if (codesA !== codesB) return { refusal: refusal('invalid_input', 'This handoff\'s refusals do not match what its own inputs give here: a refusal was dropped or added.', 'Re-export it from this page.') };
        return { from: '46-split', h46: h, src: src, settings: st, R: R2 };
      }
      var s2 = importDig(h);
      if (s2.refusal) return s2;
      return { from: '45-dig', src: s2, settings: null };
    }

    return {
      F: F, FH: FH, FO: FO, R_ST: R_ST, MW: MW, RL10: RL10, OGA_ETA: OGA_ETA, OGA_IDEAL: OGA_IDEAL, CELL_PRESETS: CELL_PRESETS, ARRAYS: ARRAYS, PH2: PH2, LO2: LO2, Q_CONV: Q_CONV, CC_QMAX: CC_QMAX, CC_FCARNOT: CC_FCARNOT, CC_UNIT_KG: CC_UNIT_KG, FS: FS, T_CELL_ENV: T_CELL_ENV, P_GAS_ENV: P_GAS_ENV, WATER_RHO: WATER_RHO,
      electrolysis: electrolysis, nernst: nernst, cell: cell, arrayPower: arrayPower, liquefaction: liquefaction, cooler20: cooler20, sp90: sp90, mliFlux: mliFlux, hfg: hfg, sphereArea: sphereArea,
      material: material, tankMass: tankMass, gasDensity: gasDensity, engineIsp: engineIsp, engineSteam: engineSteam, PROP: PROP, steamProp: steamProp, ofTrade: ofTrade, stagnation: stagnation,
      importDig: importDig, defaults: defaults, validSettings: validSettings, ledger: ledger, run: run, reality: reality, buildHandoff: buildHandoff, parseHandoff: parseHandoff,
      b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode, clearCache: clearCache, sources: S, materials: MAT, pruneUpstream: pruneUpstream, sha256: sha256,
    };
  }

  return { create: create, KERNEL: KERNEL, sha256: sha256, pruneUpstream: pruneUpstream };
});
