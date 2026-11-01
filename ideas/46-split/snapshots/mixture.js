/* Mixture: chemical-equilibrium combustion of rocket propellants by Gibbs-energy minimisation.
 *
 * Idea 31 of the Aster Idea Bank, the first module of "The Long Way Round". A pure kernel: no DOM, no
 * network, no data of its own. Thermodynamic data come in as the verbatim thermo.inp excerpt
 * (snapshots/thermo-excerpt.js, NASA Glenn coefficients, McBride, Zehe & Gordon, NASA/TP-2002-211556);
 * densities come in as snapshots/propellant-densities.js. Later modules copy this file unmodified.
 *
 * The method is NASA's: Gordon & McBride, NASA RP-1311 Part I (1994), the element-potential (Lagrange
 * multiplier) form of Gibbs minimisation with Newton-Raphson corrections (eqs 2.24-2.28), CEA's control
 * factor (eqs 3.1-3.3) and convergence tests (section 3.4), the equilibrium derivatives (eqs 2.50-2.71),
 * and the infinite-area-combustor rocket problem with an iterated sonic throat (chapter 6). Written from
 * the report's equations; NASA's CEA code is the oracle (oracle/cea_oracle.py), never a source.
 *
 * Gas-phase products only. Condensed products (graphite, liquid water, ice) are tested for stability at
 * every solution and, if one would form, the result is refused instead of being reported wrong.
 *
 * Units: SI throughout (Pa, K, kg, mol, J, m, s). Species amounts n_j are mol per kg of mixture.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mixture = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [Certain] Universal gas constant as CEA uses it (8314.51 J/(kmol K), cea/constants.py in nasa/cea
  // v3.3.4; RP-1311 uses 8.314510 J/(mol K)); the thermo.inp fits were made with the same value.
  var R = 8.31451;
  var P0 = 1e5; // [Certain] thermo.inp standard-state pressure, 1 bar
  var SIZE = 18.420681; // RP-1311 eq 3.2: ln(1e8); trace-species bound in the control factor
  var VALENCE = { C: 4, H: 1, O: -2, N: 0 }; // RP-1311 section 9 oxidation states (eqs 9.14-9.15), as in CEA's PHI
  // [Certain] Chamber pressures (Pa) compared with NASA CEA: oracle/cea-oracle.json (1-200 bar) and cea-review.json
  // (0.1, 300 bar). rocket() refuses outside unless opts.envelope widens it.
  var PC_ENVELOPE = [1e4, 3e7];
  var ELEMENT_ORDER = ['C', 'H', 'O', 'N'];

  // ---------------------------------------------------------------- thermo.inp parsing (RP-1311 Part II, App. A)
  function num(s) {
    var t = s.trim().replace(/D/g, 'E');
    return t === '' ? 0 : Number(t);
  }

  function parseRecord(lines, k) {
    var head = lines[k];
    var l2 = lines[k + 1];
    var nInt = parseInt(l2.slice(0, 2), 10);
    var rec = {
      name: head.slice(0, 15).trim(),
      comment: head.slice(18).trim(),
      dateCode: l2.slice(3, 9).trim(),
      elements: {},
      phase: parseInt(l2.slice(50, 52), 10) === 0 ? 'g' : 'c',
      M: num(l2.slice(52, 65)) / 1000, // kg/mol
      Hf: num(l2.slice(65, 80)), // J/mol: heat of formation at 298.15 K, or the assigned enthalpy if no intervals
      intervals: [],
      T0: null,
    };
    for (var e = 0; e < 5; e++) {
      var sym = l2.slice(10 + 8 * e, 12 + 8 * e).trim();
      var cnt = num(l2.slice(12 + 8 * e, 18 + 8 * e));
      if (sym && cnt) rec.elements[sym] = (rec.elements[sym] || 0) + cnt;
    }
    if (nInt === 0) {
      rec.T0 = num(lines[k + 2].slice(0, 11));
      return { rec: rec, len: 3 };
    }
    for (var i = 0; i < nInt; i++) {
      var a = lines[k + 2 + 3 * i];
      var b = lines[k + 3 + 3 * i];
      var c = lines[k + 4 + 3 * i];
      var exps = a.slice(23, 63).trim().split(/\s+/).map(Number);
      var want = [-2, -1, 0, 1, 2, 3, 4, 0];
      for (var q = 0; q < 8; q++) {
        if (exps[q] !== want[q]) throw new Error(rec.name + ': unexpected temperature exponents ' + exps.join(' '));
      }
      rec.intervals.push({
        Tmin: num(a.slice(0, 11)),
        Tmax: num(a.slice(11, 22)),
        a: [num(b.slice(0, 16)), num(b.slice(16, 32)), num(b.slice(32, 48)), num(b.slice(48, 64)),
          num(b.slice(64, 80)), num(c.slice(0, 16)), num(c.slice(16, 32))],
        b1: num(c.slice(48, 64)),
        b2: num(c.slice(64, 80)),
      });
      rec.dH298 = num(a.slice(65, 80));
    }
    return { rec: rec, len: 2 + 3 * nInt };
  }

  /** Parse a thermo.inp text (or excerpt) into a database: products (gas and condensed) and reactants. */
  function parseThermo(text) {
    var lines = String(text).split(/\r?\n/);
    var t = -1;
    for (var i = 0; i < lines.length; i++) if (lines[i].trim() === 'thermo') { t = i; break; }
    if (t < 0) throw new Error('no "thermo" line');
    var db = { header: lines[t + 1], products: {}, reactants: {}, gas: [], condensed: [] };
    var k = t + 2;
    var section = 'products';
    while (k < lines.length) {
      var L = lines[k];
      if (L.indexOf('END PRODUCTS') === 0) { section = 'reactants'; k++; continue; }
      if (L.indexOf('END REACTANTS') === 0) break;
      if (!L.trim() || L.charAt(0) === '!') { k++; continue; }
      var r = parseRecord(lines, k);
      if (section === 'products') {
        db.products[r.rec.name] = r.rec;
        (r.rec.phase === 'g' ? db.gas : db.condensed).push(r.rec.name);
      } else {
        db.reactants[r.rec.name] = r.rec;
      }
      k += r.len;
    }
    return db;
  }

  // ---------------------------------------------------------------- NASA 9-coefficient functions (RP-1311 eqs 4.6-4.8)
  function interval(rec, T) {
    var iv = rec.intervals;
    if (!iv.length || !(T >= iv[0].Tmin) || !(T <= iv[iv.length - 1].Tmax)) return null;
    for (var i = 0; i < iv.length; i++) if (T <= iv[i].Tmax) return iv[i];
    return iv[iv.length - 1];
  }
  /** cp/R, H/(RT) and S/R (standard state) of one species at T, or null outside its fitted range. */
  function thermoAt(rec, T) {
    var c = interval(rec, T);
    if (!c) return null;
    var a = c.a;
    var lnT = Math.log(T), T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    return {
      cp: a[0] / T2 + a[1] / T + a[2] + a[3] * T + a[4] * T2 + a[5] * T3 + a[6] * T4,
      h: -a[0] / T2 + a[1] * lnT / T + a[2] + a[3] * T / 2 + a[4] * T2 / 3 + a[5] * T3 / 4 + a[6] * T4 / 5 + c.b1 / T,
      s: -a[0] / (2 * T2) - a[1] / T + a[2] * lnT + a[3] * T + a[4] * T2 / 2 + a[5] * T3 / 3 + a[6] * T4 / 4 + c.b2,
    };
  }

  function refusal(code, reason, help) {
    return { code: code, reason: reason, what_would_help: help };
  }
  /** How an input value reads in a refusal: never 'NaN' or 'Infinity' on the page. */
  function shown(v, unit) {
    if (typeof v === 'number' && isFinite(v)) return 'got ' + v + (unit ? ' ' + unit : '');
    if (typeof v === 'number' && !isNaN(v)) return 'got an infinite value';
    return 'the value is empty or not a number';
  }

  // ---------------------------------------------------------------- reactants
  function reactantRecord(db, name) {
    return db.reactants[name] || db.products[name] || null;
  }

  /** Enthalpy of one reactant in J/mol at temperature T (or at the only temperature thermo.inp gives). */
  function reactantEnthalpy(db, name, T) {
    var rec = reactantRecord(db, name);
    if (!rec) return { refusal: refusal('not_found', 'No thermo.inp record named "' + name + '" in this excerpt.', 'Choose a reactant from the list, or rebuild the excerpt with build-data.mjs including it.') };
    if (!rec.intervals.length) {
      var T0 = rec.T0;
      if (T == null || Math.abs(T - T0) < 0.005) return { H: rec.Hf, T: T0, rec: rec };
      return { refusal: refusal('insufficient_data', 'thermo.inp gives the enthalpy of ' + name + ' only at ' + T0 + ' K, not at ' + T + ' K.', 'A heat-capacity fit for liquid ' + name + ' over the temperature range wanted, or use ' + T0 + ' K.') };
    }
    var Tu = T == null ? 298.15 : T;
    var th = thermoAt(rec, Tu);
    if (!th) return { refusal: refusal('out_of_envelope', name + ' has thermo data only between ' + rec.intervals[0].Tmin + ' and ' + rec.intervals[rec.intervals.length - 1].Tmax + ' K.', 'A reactant temperature inside that range.') };
    return { H: th.h * R * Tu, T: Tu, rec: rec };
  }

  function normaliseSide(side, label) {
    if (!Array.isArray(side) || !side.length) return { refusal: refusal('invalid_input', 'The ' + label + ' has no components.', 'Give at least one ' + label + ' component with a mass fraction.') };
    var sum = 0;
    for (var i = 0; i < side.length; i++) {
      var w = side[i].w;
      if (!(typeof w === 'number' && isFinite(w) && w >= 0)) return { refusal: refusal('invalid_input', 'The ' + label + ' mass fraction of ' + side[i].name + ' is not a non-negative number.', 'Mass fractions between 0 and 1.') };
      sum += w;
    }
    if (Math.abs(sum - 1) > 1e-6) return { refusal: refusal('invalid_input', 'The ' + label + ' mass fractions add up to ' + sum.toFixed(4) + ', not 1.', 'Fractions that sum to 1 (100 %).') };
    return { parts: side.filter(function (p) { return p.w > 0; }).map(function (p) { return { name: p.name, w: p.w / sum, T: p.T }; }) };
  }

  /**
   * Element amounts b0 (mol of atoms per kg of mixture) and enthalpy h0 (J/kg) of a propellant at a
   * given oxidizer-to-fuel mass ratio. ox and fuel are lists of {name, w (mass fraction), T?}.
   */
  function composeReactants(db, ox, fuel, of) {
    if (!(typeof of === 'number' && isFinite(of) && of > 0)) return { refusal: refusal('invalid_input', 'The mixture ratio O/F must be a positive number (' + shown(of) + ').', 'An O/F above zero.') };
    var o = normaliseSide(ox, 'oxidizer'); if (o.refusal) return o;
    var f = normaliseSide(fuel, 'fuel'); if (f.refusal) return f;
    var b0 = {}, h0 = 0, parts = [];
    var wo = of / (1 + of), wf = 1 / (1 + of);
    var sides = [[o.parts, wo, 'oxidizer'], [f.parts, wf, 'fuel']];
    for (var s = 0; s < 2; s++) {
      for (var i = 0; i < sides[s][0].length; i++) {
        var p = sides[s][0][i];
        var e = reactantEnthalpy(db, p.name, p.T);
        if (e.refusal) return e;
        for (var el in e.rec.elements) {
          if (!(el in VALENCE)) return { refusal: refusal('out_of_envelope', p.name + ' contains ' + el + '; this kernel handles C, H, O and N only.', 'A C/H/O/N reactant, or a kernel and excerpt extended to ' + el + ' species.') };
        }
        var mass = sides[s][1] * p.w; // kg of this reactant per kg of mixture
        var mol = mass / e.rec.M;
        for (el in e.rec.elements) b0[el] = (b0[el] || 0) + mol * e.rec.elements[el];
        h0 += mol * e.H;
        parts.push({ side: sides[s][2], name: p.name, massFraction: mass, T: e.T, H: e.H, M: e.rec.M });
      }
    }
    return { b0: b0, h0: h0, parts: parts };
  }

  /** Valence sum (RP-1311 eq 9.18) of one side per kg of that side. */
  function sideValence(db, side) {
    var n = normaliseSide(side, 'side'); if (n.refusal) return NaN;
    var v = 0;
    n.parts.forEach(function (p) {
      var rec = reactantRecord(db, p.name);
      if (!rec) { v = NaN; return; }
      var per = 0;
      for (var el in rec.elements) per += rec.elements[el] * (VALENCE[el] === undefined ? NaN : VALENCE[el]);
      v += p.w / rec.M * per;
    });
    return v;
  }

  /** Stoichiometric O/F from element valences (C +4, H +1, O -2, N 0), or NaN if it has no meaning. */
  function stoichiometricOF(db, ox, fuel) {
    var vo = sideValence(db, ox), vf = sideValence(db, fuel);
    if (!(vo < 0 && vf > 0)) return NaN;
    return -vf / vo;
  }

  // ---------------------------------------------------------------- linear algebra
  function solveLinear(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (!(Math.abs(M[p][c]) > 1e-300)) return null;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (r = c + 1; r < n; r++) {
        var f = M[r][c] / M[c][c];
        if (f !== 0) for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // ---------------------------------------------------------------- equilibrium (RP-1311 chapters 2 and 3)
  function presentElements(b0) {
    var els = [];
    ELEMENT_ORDER.forEach(function (e) { if (b0[e] > 1e-12) els.push(e); });
    for (var e in b0) if (ELEMENT_ORDER.indexOf(e) < 0 && b0[e] > 1e-12) els.push(e);
    return els;
  }

  function admissible(db, els, names) {
    var list = names || db.gas;
    return list.filter(function (nm) {
      var rec = db.products[nm];
      if (!rec || rec.phase !== 'g') return false;
      for (var e in rec.elements) if (els.indexOf(e) < 0) return false;
      return true;
    });
  }

  /** [lowest T, highest T] at which every one of these records has fitted data. */
  function fittedSpan(recs) {
    var lo = -Infinity, hi = Infinity;
    recs.forEach(function (r) { lo = Math.max(lo, r.intervals[0].Tmin); hi = Math.min(hi, r.intervals[r.intervals.length - 1].Tmax); });
    return [lo, hi];
  }

  /**
   * Gas-phase chemical equilibrium of a mixture with element amounts b0 at pressure P (Pa).
   * opts.mode: 'TP' (opts.T fixed), 'HP' (opts.h, J/kg, fixed) or 'SP' (opts.s, J/(kg K), fixed).
   * opts.species: product names to consider (default: every gas product in db with the mixture's elements).
   * opts.start: a previous result to start from (same species set), which speeds sweeps.
   * Returns a state (see properties()) with .converged, or an object with .refusal.
   */
  function equilibrate(db, b0, P, opts) {
    opts = opts || {};
    var mode = opts.mode || 'TP';
    if (!(P > 0 && isFinite(P))) return { refusal: refusal('invalid_input', 'Pressure must be a positive number of pascals.', 'A pressure above zero.') };
    var els = presentElements(b0);
    if (!els.length) return { refusal: refusal('invalid_input', 'The mixture has no elements.', 'Reactants with known compositions.') };
    var names = admissible(db, els, opts.species);
    var ns = names.length, l = els.length;
    var recs = names.map(function (nm) { return db.products[nm]; });
    var A = els.map(function (e) { return recs.map(function (r) { return r.elements[e] || 0; }); });
    for (var ei = 0; ei < l; ei++) {
      if (!A[ei].some(function (v) { return v > 0; })) return { refusal: refusal('insufficient_data', 'No product species in the excerpt contains ' + els[ei] + '.', 'Rebuild the excerpt with species of ' + els[ei] + '.') };
    }
    var bv = els.map(function (e) { return b0[e]; });
    var bmax = Math.max.apply(null, bv);
    var lnP = Math.log(P / P0);
    var lnn, lnT, lnnj = new Array(ns);
    var st = opts.start;
    if (st && st.names && st.names.length === ns && st.names.every(function (x, i) { return x === names[i]; })) {
      for (var j = 0; j < ns; j++) lnnj[j] = Math.max(st.lnnj[j], Math.log(st.n) - 2 * SIZE);
      lnn = Math.log(st.n);
      lnT = Math.log(mode === 'TP' ? opts.T : (opts.T || st.T));
    } else {
      // RP-1311 section 3.5: n = 0.1 mol/g, n_j = 0.1/NS, T = 3800 K for an assigned-enthalpy or -entropy start.
      lnn = Math.log(100);
      for (j = 0; j < ns; j++) lnnj[j] = Math.log(100 / ns);
      lnT = Math.log(mode === 'TP' ? opts.T : (opts.T || 3800));
    }
    if (!(isFinite(lnT))) return { refusal: refusal('invalid_input', 'No usable temperature for the ' + mode + ' problem.', 'A positive temperature.') };
    var hTarget = mode === 'HP' ? opts.h / R : 0; // K mol/kg
    var sTarget = mode === 'SP' ? opts.s / R : 0; // mol/kg
    var energy = mode !== 'TP';
    var m = l + 1 + (energy ? 1 : 0);
    var cp = new Array(ns), hRT = new Array(ns), s0 = new Array(ns), mu = new Array(ns), nj = new Array(ns), Sj = new Array(ns);
    var it, converged = false, pi = null, dlnT = 0;
    var maxIt = opts.maxIterations || 200;
    for (it = 1; it <= maxIt; it++) {
      var T = Math.exp(lnT);
      var n = Math.exp(lnn);
      for (j = 0; j < ns; j++) {
        var th = thermoAt(recs[j], T);
        if (!th) {
          var span = fittedSpan(recs);
          return { refusal: refusal('out_of_envelope', 'The solution reached ' + T.toFixed(0) + ' K, outside the fitted range of ' + names[j] + ' (' + recs[j].intervals[0].Tmin + '-' + recs[j].intervals[recs[j].intervals.length - 1].Tmax + ' K); the kernel does not extrapolate a fit.',
            'Conditions whose temperature stays between ' + span[0] + ' and ' + span[1] + ' K, where all ' + ns + ' species considered here have data, or a species list (opts.species) that leaves out, and says it leaves out, the trace species whose fits stop sooner.'), T: T };
        }
        cp[j] = th.cp; hRT[j] = th.h; s0[j] = th.s;
        nj[j] = Math.exp(lnnj[j]);
        var lnx = lnnj[j] - lnn;
        mu[j] = th.h - th.s + lnx + lnP; // mu_j/RT for an ideal-gas species
        Sj[j] = th.s - lnx - lnP; // S_j/R
      }
      // Assemble the reduced Newton-Raphson equations, RP-1311 eqs 2.24, 2.26 and 2.27 (HP) or 2.28 (SP).
      var G = [], rhs = [];
      var sumN = 0, sumNH = 0, sumNS = 0, sumNmu = 0, sumNHmu = 0, sumNSmu = 0, sumNcp = 0, sumNH2 = 0, sumNHS = 0;
      for (j = 0; j < ns; j++) {
        sumN += nj[j]; sumNH += nj[j] * hRT[j]; sumNS += nj[j] * Sj[j]; sumNmu += nj[j] * mu[j];
        sumNHmu += nj[j] * hRT[j] * mu[j]; sumNSmu += nj[j] * Sj[j] * mu[j]; sumNcp += nj[j] * cp[j];
        sumNH2 += nj[j] * hRT[j] * hRT[j]; sumNHS += nj[j] * hRT[j] * Sj[j];
      }
      var bi = new Array(l), biH = new Array(l), biS = new Array(l), biMu = new Array(l);
      for (var i = 0; i < l; i++) {
        var row = new Array(m).fill(0);
        bi[i] = 0; biH[i] = 0; biS[i] = 0; biMu[i] = 0;
        for (j = 0; j < ns; j++) {
          var aij = A[i][j];
          if (!aij) continue;
          var an = aij * nj[j];
          bi[i] += an; biH[i] += an * hRT[j]; biS[i] += an * Sj[j]; biMu[i] += an * mu[j];
          for (var k = 0; k < l; k++) if (A[k][j]) row[k] += A[k][j] * an;
        }
        row[l] = bi[i];
        if (energy) row[l + 1] = biH[i];
        G.push(row);
        rhs.push(bv[i] - bi[i] + biMu[i]);
      }
      var rowN = new Array(m).fill(0);
      for (i = 0; i < l; i++) rowN[i] = bi[i];
      rowN[l] = sumN - n;
      if (energy) rowN[l + 1] = sumNH;
      G.push(rowN);
      rhs.push(n - sumN + sumNmu);
      if (mode === 'HP') {
        var rowH = new Array(m).fill(0);
        for (i = 0; i < l; i++) rowH[i] = biH[i];
        rowH[l] = sumNH;
        rowH[l + 1] = sumNcp + sumNH2;
        G.push(rowH);
        rhs.push(hTarget / T - sumNH + sumNHmu);
      } else if (mode === 'SP') {
        var rowS = new Array(m).fill(0);
        for (i = 0; i < l; i++) rowS[i] = biS[i];
        rowS[l] = sumNS;
        rowS[l + 1] = sumNcp + sumNHS;
        G.push(rowS);
        rhs.push(sTarget - sumNS + n - sumN + sumNSmu);
      }
      var x = solveLinear(G, rhs);
      if (!x) return { refusal: refusal('out_of_envelope', 'The equilibrium equations became singular at iteration ' + it + '.', 'Different conditions; report the inputs if they are ordinary.') };
      pi = x.slice(0, l);
      var dlnn = x[l];
      dlnT = energy ? x[l + 1] : 0;
      var dlnnj = new Array(ns);
      for (j = 0; j < ns; j++) {
        var sAp = 0;
        for (i = 0; i < l; i++) if (A[i][j]) sAp += A[i][j] * pi[i];
        dlnnj[j] = -mu[j] + sAp + dlnn + hRT[j] * dlnT; // RP-1311 eq 2.18 (and 2.10 for TP)
      }
      // Convergence (RP-1311 section 3.4), tested on the corrections just computed.
      var ok = Math.abs(n * dlnn) / sumN <= 0.5e-5 && Math.abs(dlnT) <= 1e-4;
      for (j = 0; ok && j < ns; j++) if (nj[j] * Math.abs(dlnnj[j]) / sumN > 0.5e-5) ok = false;
      for (i = 0; ok && i < l; i++) if (Math.abs(bv[i] - bi[i]) > 1e-6 * bmax) ok = false;
      // Control factor lambda (RP-1311 eqs 3.1-3.3).
      var big = Math.max(5 * Math.abs(dlnT), 5 * Math.abs(dlnn));
      var lam2 = 1;
      for (j = 0; j < ns; j++) {
        var lnxj = lnnj[j] - lnn;
        if (lnxj > -SIZE) {
          if (dlnnj[j] > 0) big = Math.max(big, dlnnj[j]);
        } else if (dlnnj[j] >= 0) {
          var den = dlnnj[j] - dlnn;
          if (den > 0) lam2 = Math.min(lam2, Math.abs((-lnxj - 9.2103404) / den));
        }
      }
      var lam = Math.min(1, big > 2 ? 2 / big : 1, lam2);
      for (j = 0; j < ns; j++) lnnj[j] = Math.max(lnnj[j] + lam * dlnnj[j], -700);
      lnn += lam * dlnn;
      lnT += lam * dlnT;
      if (ok) { converged = true; break; }
    }
    var Tfin = Math.exp(lnT);
    if (!converged) return { refusal: refusal('out_of_envelope', 'The equilibrium iteration did not converge in ' + maxIt + ' steps (last T ' + Tfin.toFixed(0) + ' K).', 'Different conditions; the solver is checked against NASA CEA only inside the stated envelope.'), T: Tfin };
    return properties(db, { names: names, recs: recs, els: els, A: A, lnnj: lnnj, n: Math.exp(lnn), T: Tfin, P: P, pi: pi, iterations: it, mode: mode, b0: b0 });
  }

  /** Thermodynamic state of a converged gas mixture, with RP-1311's equilibrium derivatives. */
  function properties(db, st) {
    var ns = st.names.length, l = st.els.length, A = st.A, T = st.T, P = st.P;
    var lnP = Math.log(P / P0);
    var nj = new Array(ns), cp = new Array(ns), hRT = new Array(ns), s0 = new Array(ns);
    var sumN = 0;
    for (var j = 0; j < ns; j++) {
      var th = thermoAt(st.recs[j], T);
      nj[j] = Math.exp(st.lnnj[j]); cp[j] = th.cp; hRT[j] = th.h; s0[j] = th.s; sumN += nj[j];
    }
    var h = 0, s = 0, cpf = 0, sumNH = 0;
    for (j = 0; j < ns; j++) {
      var xj = nj[j] / sumN;
      h += nj[j] * hRT[j]; cpf += nj[j] * cp[j];
      s += nj[j] * (s0[j] - (xj > 0 ? Math.log(xj) : 0) - lnP);
    }
    sumNH = h;
    // Derivatives (RP-1311 section 2.5, tables 2.3 and 2.4): two linear systems sharing one matrix. Differentiating
    // ln n_j = sum_i a_ij pi_i - mu0_j/RT + ln n - ln(P/P0) with the element and n = sum n_j constraints gives
    // the right-hand sides below (checked in the limit of one species per element: dlnV/dlnP = -1, dlnV/dlnT = 1).
    var G = [], rT = [], rP = [];
    var bi = new Array(l), biH = new Array(l);
    for (var i = 0; i < l; i++) {
      var row = new Array(l + 1).fill(0);
      bi[i] = 0; biH[i] = 0;
      for (j = 0; j < ns; j++) {
        if (!A[i][j]) continue;
        var an = A[i][j] * nj[j];
        bi[i] += an; biH[i] += an * hRT[j];
        for (var k = 0; k < l; k++) if (A[k][j]) row[k] += A[k][j] * an;
      }
      row[l] = bi[i];
      G.push(row); rT.push(-biH[i]); rP.push(bi[i]);
    }
    var last = new Array(l + 1).fill(0);
    for (i = 0; i < l; i++) last[i] = bi[i];
    G.push(last); rT.push(-sumNH); rP.push(sumN);
    var xT = solveLinear(G, rT), xP = solveLinear(G, rP);
    var dlnVdlnT = 1 + xT[l];
    var dlnVdlnP = -1 + xP[l];
    var cpe = sumNH * xT[l] + cpf; // per R
    for (i = 0; i < l; i++) cpe += biH[i] * xT[i];
    for (j = 0; j < ns; j++) cpe += nj[j] * hRT[j] * hRT[j];
    var cpEq = cpe * R, cpFr = cpf * R;
    var cvEq = cpEq + sumN * R * dlnVdlnT * dlnVdlnT / dlnVdlnP; // RP-1311 eq 2.70
    var gammaEq = cpEq / cvEq;
    var gammaS = -gammaEq / dlnVdlnP; // eq 2.71
    var gammaFr = cpFr / (cpFr - sumN * R);
    var x = {};
    for (j = 0; j < ns; j++) x[st.names[j]] = nj[j] / sumN;
    var out = {
      converged: true, mode: st.mode, iterations: st.iterations,
      T: T, P: P, n: sumN, M: 1 / sumN, h: h * R * T, s: s * R,
      rho: P / (sumN * R * T),
      cp_eq: cpEq, cp_fr: cpFr, cv_eq: cvEq, gamma_s: gammaS, gamma_fr: gammaFr,
      dlnV_dlnT: dlnVdlnT, dlnV_dlnP: dlnVdlnP,
      a: Math.sqrt(sumN * R * T * gammaS),
      x: x, names: st.names, lnnj: st.lnnj, elements: st.els, pi: st.pi, b0: st.b0,
    };
    out.condensed = condensedCheck(db, out);
    return out;
  }

  /**
   * Would a condensed phase be stable here? For a pure condensed species c the gas-only solution is wrong
   * if mu_c/RT - sum_i a_ic pi_i < 0 (RP-1311 eq 3.7's test for adding a condensed species).
   */
  function condensedCheck(db, st) {
    var hits = [];
    db.condensed.forEach(function (nm) {
      var rec = db.products[nm];
      for (var e in rec.elements) if (st.elements.indexOf(e) < 0) return;
      var th = thermoAt(rec, st.T);
      if (!th) return;
      var g = th.h - th.s;
      for (var i = 0; i < st.elements.length; i++) g -= (rec.elements[st.elements[i]] || 0) * st.pi[i];
      if (g < 0) hits.push({ species: nm, drivingForce: -g });
    });
    return hits;
  }

  function condensedRefusal(st, where) {
    if (!st.condensed || !st.condensed.length) return null;
    var nm = st.condensed.map(function (c) { return c.species; }).join(' and ');
    return refusal('out_of_envelope', 'At the ' + where + ' (' + st.T.toFixed(0) + ' K) equilibrium would deposit ' + nm + '; this kernel is gas-only and would report a wrong state.',
      'A higher O/F (less fuel-rich), or a kernel extended with condensed phases (RP-1311 section 2.3).');
  }

  // ---------------------------------------------------------------- the rocket chamber and throat (RP-1311 chapter 6)
  /**
   * Infinite-area-combustor chamber and sonic throat for a propellant at mixture ratio of and chamber
   * pressure pc (Pa). prop = {oxidizer: [{name, w, T?}], fuel: [{name, w, T?}]}.
   * Returns {chamber, throat, cstar, cstarClosedForm, reactants, ...} or {refusal}.
   */
  function rocket(db, prop, of, pc, opts) {
    opts = opts || {};
    if (!(typeof pc === 'number' && isFinite(pc) && pc > 0)) return { refusal: refusal('invalid_input', 'Chamber pressure must be a positive number of pascals (' + shown(pc, 'Pa') + ').', 'A chamber pressure above zero.') };
    var env = opts.envelope || PC_ENVELOPE;
    if (pc < env[0] || pc > env[1]) {
      return { refusal: refusal('out_of_envelope', 'A chamber pressure of ' + +(pc / 1e5).toPrecision(6) + ' bar is outside the ' + env[0] / 1e5 + ' to ' + env[1] / 1e5 +
        ' bar this kernel was compared with NASA CEA over; beyond it nothing here is checked, and at high pressure the ideal-gas equation of state that CEA and this kernel share is itself an unchecked assumption.',
        'A chamber pressure between ' + env[0] / 1e5 + ' and ' + env[1] / 1e5 + ' bar, or a comparison with NASA CEA at this pressure (oracle/cea_review.py) before widening opts.envelope.') };
    }
    var mix = composeReactants(db, prop.oxidizer, prop.fuel, of);
    if (mix.refusal) return mix;
    var ch = equilibrate(db, mix.b0, pc, { mode: 'HP', h: mix.h0, species: opts.species, start: opts.start && opts.start.chamber });
    if (ch.refusal) return ch;
    var cr = condensedRefusal(ch, 'chamber');
    if (cr) return { refusal: cr, chamber: ch };
    // Throat: iterate ln(pc/pt) until the isentropic velocity equals the equilibrium sound speed.
    var g = ch.gamma_s;
    var lnr = (opts.start && opts.start.throat) ? Math.log(pc / opts.start.throat.P) : g / (g - 1) * Math.log((g + 1) / 2);
    var th = null, u2 = 0, a2 = 0, prev = ch, k;
    for (k = 0; k < 40; k++) {
      var pt = pc * Math.exp(-lnr);
      var Tguess = ch.T * Math.exp(-lnr * (g - 1) / g);
      th = equilibrate(db, mix.b0, pt, { mode: 'SP', s: ch.s, T: Tguess, species: opts.species, start: prev });
      if (th.refusal) return th;
      u2 = 2 * (ch.h - th.h);
      a2 = th.a * th.a;
      if (!(u2 > 0)) return { refusal: refusal('out_of_envelope', 'No enthalpy drop between chamber and throat estimate.', 'Report the inputs; ordinary propellants do not do this.') };
      if (Math.abs(u2 - a2) / u2 < 1e-9) break;
      lnr -= (u2 - a2) / (th.n * R * th.T * (th.gamma_s + 1));
      prev = th;
    }
    if (Math.abs(u2 - a2) / u2 > 1e-6) return { refusal: refusal('out_of_envelope', 'The sonic throat did not converge.', 'Different conditions.') };
    var crt = condensedRefusal(th, 'throat');
    if (crt) return { refusal: crt, chamber: ch, throat: th };
    var ut = Math.sqrt(u2);
    var cstar = pc / (th.rho * ut);
    var Gam = Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
    return {
      of: of, pc: pc, mixture: mix, chamber: ch, throat: th, throatVelocity: ut,
      cstar: cstar,
      // The textbook closed form with the chamber's equilibrium gamma: a comparison, not the answer.
      cstarClosedForm: Math.sqrt(R * ch.T / ch.M) / Gam,
      pressureRatio: pc / th.P,
    };
  }

  /** Rocket results over a list of O/F values, each started from its neighbour's solution. */
  function sweep(db, prop, pc, ofs, opts) {
    var out = [], start = null;
    for (var i = 0; i < ofs.length; i++) {
      var r = rocket(db, prop, ofs[i], pc, { species: opts && opts.species, envelope: opts && opts.envelope, start: start });
      out.push(r);
      start = r.refusal ? null : r;
    }
    return out;
  }

  /** O/F of maximum c* inside [lo, hi] by golden-section search (unimodal assumed). opts as for rocket(). */
  function maxCstar(db, prop, pc, lo, hi, opts) {
    var gr = (Math.sqrt(5) - 1) / 2;
    var f = function (x) { var r = rocket(db, prop, x, pc, opts && { species: opts.species, envelope: opts.envelope }); return r.refusal ? -Infinity : r.cstar; };
    var a = lo, b = hi, c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
    for (var i = 0; i < 40 && b - a > 1e-4; i++) {
      if (fc >= fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
    }
    var x = (a + b) / 2;
    return { of: x, cstar: f(x) };
  }

  // ---------------------------------------------------------------- densities
  function sameParts(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return k in b && Math.abs(a[k] - b[k]) < 1e-9; });
  }

  /**
   * Density of one side (a list of {name, w}) in kg/m^3. A measured blend or a single component carries
   * its measured value; any other blend gets the volume-additive estimate 1/rho = sum(w_k / rho_k).
   */
  function sideDensity(D, side, label) {
    var n = normaliseSide(side, label || 'side');
    if (n.refusal) return n;
    var parts = {};
    n.parts.forEach(function (p) { parts[p.name] = p.w; });
    for (var i = 0; i < D.blends.length; i++) {
      var b = D.blends[i];
      if (sameParts(parts, b.parts)) return { value: b.value, T: b.T, confidence: 'measured', source: D.sources[b.src] + ' (' + b.name + ' blend)', mixing: 'measured blend' };
    }
    var inv = 0, Ts = [], srcs = [];
    for (i = 0; i < n.parts.length; i++) {
      var row = D.components[n.parts[i].name];
      if (!row) return { refusal: refusal('insufficient_data', 'No measured density of ' + n.parts[i].name + ' on file' + (n.parts.length > 1 ? ' for this blend' : '') + '.', 'A measured density of ' + n.parts[i].name + (n.parts.length > 1 ? ', or of this exact blend,' : '') + ' in its storage state (temperature, and pressure for a gas) from a primary source such as NIST or a NASA propellant handbook.') };
      inv += n.parts[i].w / row.value;
      Ts.push(row.T);
      if (srcs.indexOf(D.sources[row.src]) < 0) srcs.push(D.sources[row.src]);
    }
    if (n.parts.length === 1) {
      var r1 = D.components[n.parts[0].name];
      return { value: r1.value, T: r1.T, confidence: 'measured', source: D.sources[r1.src], range: r1.range || null, mixing: 'single component' };
    }
    return { value: 1 / inv, T: Ts, confidence: 'derived', source: srcs.join('; '), mixing: 'volume-additive estimate (ideal mixing assumed)' };
  }

  /** Bulk density of the propellant load at mixture ratio of: (1 + of) / (of/rho_o + 1/rho_f). */
  function bulkDensity(rhoO, rhoF, of) {
    return (1 + of) / (of / rhoO + 1 / rhoF);
  }

  // ---------------------------------------------------------------- handoff (series schema v1)
  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    var t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  var KERNEL = '31-mixture/mixture.js';
  var THERMO_SRC = 'NASA Glenn thermo.inp (McBride, Zehe & Gordon, NASA/TP-2002-211556) at github.com/nasa/cea 2f79a64, via snapshots/thermo-excerpt.js';

  function q(value, units, confidence, source) {
    return { value: value, units: units, confidence: confidence, source: source };
  }

  /**
   * The handoff object module 32 imports. inputs = {preset?, oxidizer, fuel, of, pc}; r = rocket() result
   * (or a refusal); dens = {oxidizer, fuel} from sideDensity(); extra = {produced, envelope, assumptions}.
   */
  function makeHandoff(inputs, r, dens, extra) {
    extra = extra || {};
    var out = {
      handoff: 'long-way-round', version: 1, from: '31-mixture',
      produced: extra.produced || new Date().toISOString(),
      inputs: {
        preset: inputs.preset || null,
        oxidizer: inputs.oxidizer.map(function (p) { return { name: p.name, massFraction: p.w, T: p.T == null ? null : p.T }; }),
        fuel: inputs.fuel.map(function (p) { return { name: p.name, massFraction: p.w, T: p.T == null ? null : p.T }; }),
        mixture_ratio: isFinite(inputs.of) ? inputs.of : null,
        chamber_pressure_Pa: isFinite(inputs.pc) ? inputs.pc : null,
      },
      outputs: {},
      refusals: [],
      assumptions: [
        'Chemical equilibrium in the chamber and at the throat (shifting), infinite-area combustor, adiabatic, ideal gases (NASA RP-1311 Part I).',
        'Gas-phase products only: ' + (r && r.chamber ? r.chamber.names.length : '?') + ' species from the excerpt; a condensed phase that would be stable is refused, not modelled.',
        'Reactant enthalpies at the temperatures thermo.inp assigns (cryogens at their listed temperature, storables at 298.15 K).',
        'Frames and time scales: none (a thermochemical state has no position or epoch).',
      ].concat(extra.assumptions || []),
    };
    var O = out.outputs;
    if (isFinite(inputs.of)) O.mixture_ratio = q(inputs.of, '1', 'assumed', 'user input (oxidizer mass / fuel mass)');
    if (isFinite(inputs.pc)) O.chamber_pressure = q(inputs.pc, 'Pa', 'assumed', 'user input');
    if (r && !r.refusal) {
      var ch = r.chamber, th = r.throat, src = KERNEL + ' rocket(); ' + THERMO_SRC;
      O.chamber_temperature = q(ch.T, 'K', 'derived', src);
      O.chamber_molar_mass = q(ch.M, 'kg/mol', 'derived', src);
      O.chamber_gamma_s = q(ch.gamma_s, '1', 'derived', src + ' (equilibrium isentropic exponent, RP-1311 eq 2.71)');
      O.chamber_gamma_frozen = q(ch.gamma_fr, '1', 'derived', src + ' (frozen cp/cv)');
      O.chamber_cp_equilibrium = q(ch.cp_eq, 'J/(kg K)', 'derived', src);
      O.chamber_cp_frozen = q(ch.cp_fr, 'J/(kg K)', 'derived', src);
      O.chamber_enthalpy = q(ch.h, 'J/kg', 'derived', src + ' (equals the reactant enthalpy)');
      O.chamber_entropy = q(ch.s, 'J/(kg K)', 'derived', src + ' (thermo.inp reference state; conserved along an isentropic nozzle)');
      O.chamber_density = q(ch.rho, 'kg/m^3', 'derived', src);
      O.chamber_sound_speed = q(ch.a, 'm/s', 'derived', src);
      O.chamber_composition = q(roundComposition(ch.x, 1e-6), 'mol/mol', 'derived', src + ' (mole fractions >= 1e-6)');
      O.throat_pressure = q(th.P, 'Pa', 'derived', src + ' (sonic point of the shifting-equilibrium isentrope)');
      O.throat_temperature = q(th.T, 'K', 'derived', src);
      O.throat_molar_mass = q(th.M, 'kg/mol', 'derived', src);
      O.throat_gamma_s = q(th.gamma_s, '1', 'derived', src);
      O.throat_density = q(th.rho, 'kg/m^3', 'derived', src);
      O.throat_velocity = q(r.throatVelocity, 'm/s', 'derived', src + ' (equals the throat sound speed)');
      O.cstar = q(r.cstar, 'm/s', 'derived', src + ' (c* = pc / (rho_t u_t), RP-1311 eqs 6.11-6.12)');
      O.element_amounts = q(roundObj(r.mixture.b0, 10), 'mol/kg', 'derived', KERNEL + ' composeReactants(); molecular formulas from thermo.inp');
      O.reactant_enthalpy = q(r.mixture.h0, 'J/kg', 'derived', KERNEL + ' composeReactants(); assigned enthalpies from thermo.inp');
      O.species_set = q(ch.names.slice(), '-', 'derived', 'gas products considered (thermo.inp names); module 32 should equilibrate with the same set');
      if (extra.stoichiometric_mixture_ratio > 0) O.stoichiometric_mixture_ratio = q(extra.stoichiometric_mixture_ratio, '1', 'derived', KERNEL + ' stoichiometricOF() (valences C+4 H+1 O-2 N0)');
    } else if (r && r.refusal) {
      out.refusals.push(r.refusal);
    }
    ['oxidizer', 'fuel'].forEach(function (side) {
      var d = dens && dens[side];
      if (!d) return;
      if (d.refusal) { out.refusals.push(Object.assign({ applies_to: side + '_density' }, d.refusal)); return; }
      O[side + '_density'] = q(d.value, 'kg/m^3', d.confidence, d.source + '; ' + d.mixing + '; at ' + [].concat(d.T).join('/') + ' K');
    });
    if (O.oxidizer_density && O.fuel_density && inputs.of > 0 && isFinite(inputs.of)) {
      O.bulk_density = q(bulkDensity(O.oxidizer_density.value, O.fuel_density.value, inputs.of), 'kg/m^3', 'derived', KERNEL + ' bulkDensity(): (1+O/F)/(O/F/rho_o + 1/rho_f)');
    }
    if (extra.thermo) O.thermo_database = q(extra.thermo, '-', 'measured', THERMO_SRC);
    return out;
  }

  function roundObj(o, sig) {
    var r = {};
    for (var k in o) r[k] = Number(o[k].toPrecision(sig));
    return r;
  }
  function roundComposition(x, floor) {
    var keys = Object.keys(x).filter(function (k) { return x[k] >= floor; }).sort(function (a, b) { return x[b] - x[a]; });
    var r = {};
    keys.forEach(function (k) { r[k] = Number(x[k].toPrecision(7)); });
    return r;
  }

  /**
   * Read a handoff: a JSON string, an object, a '#h=<base64url>' fragment or a bare base64url string.
   * Returns {handoff} or {refusal}. Accepts this module's own handoff (to restore its inputs) and any
   * long-way-round v1 object whose inputs carry oxidizer, fuel, mixture_ratio and chamber_pressure_Pa.
   */
  function parseHandoff(input) {
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
    if (!obj || obj.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'The object is not a long-way-round handoff (its "handoff" field is not "long-way-round").', 'A handoff exported by a module of this series.') };
    if (obj.version !== 1) return { refusal: refusal('invalid_input', 'Handoff version ' + obj.version + ' is not understood; this module reads version 1.', 'A version 1 handoff.') };
    var inp = obj.inputs || {};
    var conv = function (side) {
      return Array.isArray(side) ? side.map(function (p) { return { name: p.name, w: p.massFraction != null ? p.massFraction : p.w, T: p.T == null ? undefined : p.T }; }) : null;
    };
    var ox = conv(inp.oxidizer), fu = conv(inp.fuel);
    var of = inp.mixture_ratio, pc = inp.chamber_pressure_Pa;
    if (!ox || !fu || !(of > 0) || !(pc > 0)) return { refusal: refusal('insufficient_data', 'The handoff (from ' + (obj.from || 'unknown') + ') does not carry a propellant, a mixture ratio and a chamber pressure in its inputs.', 'A handoff from 31-mixture, or one whose inputs name oxidizer, fuel, mixture_ratio and chamber_pressure_Pa.') };
    return { handoff: obj, inputs: { preset: inp.preset || null, oxidizer: ox, fuel: fu, of: of, pc: pc } };
  }

  return {
    R: R, P0: P0, VALENCE: VALENCE, PC_ENVELOPE: PC_ENVELOPE,
    parseThermo: parseThermo, thermoAt: thermoAt, reactantEnthalpy: reactantEnthalpy,
    composeReactants: composeReactants, stoichiometricOF: stoichiometricOF,
    equilibrate: equilibrate, rocket: rocket, sweep: sweep, maxCstar: maxCstar,
    sideDensity: sideDensity, bulkDensity: bulkDensity,
    makeHandoff: makeHandoff, parseHandoff: parseHandoff, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode,
    solveLinear: solveLinear,
  };
});
