/* Way Home: leaving the asteroid. Idea 47 of the Aster Idea Bank, module 17 of "The Long Way Round".
 *
 * Idea 46 handed on the propellant made at the asteroid (mass, mixture ratio, Isp), the dry mass going home, the day
 * the stay ended and how fast the liquid boils. This module finds the ways home: a return porkchop from the asteroid to
 * the Earth (departure date by flight time), what each costs at the asteroid, what the propellant can push home with
 * it, and the Earth-arrival v-infinity, date and entry speed it hands module 48.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, m/s). Time: TDB seconds past J2000 (UTC = TDB - 69.184 s,
 * Aster's utc-to-tdb.ts via idea 39). Frame: heliocentric ICRF/J2000 axes, Sun centre (as ideas 39, 40 and Aster);
 * geocentric ICRF near the Earth; declinations are from the ICRF equator (as NHATS gives them).
 *
 * Nothing physical is re-implemented here: Lambert is idea 39's (Izzo), the asteroid's orbit and the flight through
 * the solar system are idea 40's n-body integrator (Aster's elements integrated with the Sun, the planets, the Moon,
 * Earth's J2 and relativity), the Earth is idea 39's Chebyshev fit of Aster's Horizons file. What is new: the return
 * grid and its refusals, the mass ledger (boil-off while waiting and on the way, Tsiolkovsky in two burns), the
 * B-plane re-aim of the return through idea 40's forces, and the checks against JPL's NHATS return legs, JPL's
 * close approach of Apophis in 2029 and OSIRIS-REx's flown return.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WayHome = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, DAY = 86400, HOUR = 3600;
  var KERNEL = '47-way-home/home.js';

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
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function rv(a) { return a.map(r9); }

  // ------------------------------------------------------------------ SHA-256 (to digest a bundled upstream handoff)
  var KS = (function () { var k = [], n = 2, c = 0; while (c < 64) { var p = true; for (var d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { k.push((Math.pow(n, 1 / 3) % 1) * 4294967296 >>> 0); c++; } n++; } return k; })();
  function sha256(str) {
    var bytes = [], i, j;
    for (i = 0; i < str.length; i++) {   // UTF-8
      var cp = str.codePointAt(i); if (cp > 0xffff) i++;
      if (cp < 0x80) bytes.push(cp); else if (cp < 0x800) bytes.push(0xc0 | cp >> 6, 0x80 | cp & 63);
      else if (cp < 0x10000) bytes.push(0xe0 | cp >> 12, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
      else bytes.push(0xf0 | cp >> 18, 0x80 | cp >> 12 & 63, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
    }
    var L = bytes.length * 8; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (L >>> (8 * i)) & 255);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], W = new Array(64);
    function ror(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (i = 0; i < bytes.length; i += 64) {
      for (j = 0; j < 16; j++) W[j] = (bytes[i + 4 * j] << 24 | bytes[i + 4 * j + 1] << 16 | bytes[i + 4 * j + 2] << 8 | bytes[i + 4 * j + 3]) >>> 0;
      for (j = 16; j < 64; j++) { var s0 = ror(W[j - 15], 7) ^ ror(W[j - 15], 18) ^ (W[j - 15] >>> 3), s1 = ror(W[j - 2], 17) ^ ror(W[j - 2], 19) ^ (W[j - 2] >>> 10); W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + KS[j] + W[j]) >>> 0, t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map(function (x) { return x >>> 0; });
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }
  function digest(h) { var s = JSON.stringify(h); return { pruned: true, from: h.from, produced: h.produced, bytes: s.length, sha256: sha256(s) }; }

  // ==================================================================================================================
  function create(deps) {
    var LC = deps.LongCoast, LR = deps.LambertsRoad, O = deps.oracles, OUT = deps.outbound || null, CHAIN = deps.chain || null;
    var K40 = LC.create({ LambertsRoad: LR, constants: deps.constants, earth: deps.earth, catalog: deps.catalog, asterBodies: deps.asterBodies,
      outerPlanets: deps.outerPlanets, de440: deps.de440, nav: deps.nav, erfa: deps.erfa });
    var K39 = K40.k39, C = K39.constants, DE = deps.de440;
    var MU_SUN = C.gmSun_m3_s2, MU_E = C.earthMu_m3_s2, RE = DE.earthRadius_m, SOI = K39.soi_m, ECL = K39.eclipticPole;
    var FM = K40.forceModel();                       // every force idea 40 has, no sunlight (no area per mass)
    var NHQ = O.nhats_quotes, ENTRY_LIMIT = NHQ.entryLimit_m_s, ENTRY_ALT = NHQ.entryAltitude_m;
    var EXEC = K40.EXEC.lucy;                        // Lucy's execution error, 1 sigma: fixed + proportional (idea 40)
    var SPAN = { start: K40.span.start, end: K40.span.end };
    var CHAIN_DIGEST = CHAIN ? digest(CHAIN).sha256 : null;
    var BODY_KEYS = { apophis: '99942', bennu: '101955', ryugu: '162173', didymos: '65803', eros: '433', '2000sg344': '2000 SG344' };

    function utc(t) { return K39.utcOf(t); }
    function inSpan(t) { return t >= SPAN.start && t <= SPAN.end; }
    function spanRefusal(what) {
      return refusal('out_of_envelope', what + ' lies outside the ephemerides here (' + K39.tdbDate(SPAN.start) + ' to ' + K39.tdbDate(SPAN.end) + ', Aster\'s Horizons span as ideas 39 and 40 fit it).', 'Dates inside that span, or a longer Horizons span (Aster\'s H0 item).', { applies_to: 'ephemeris_span' });
    }

    // -------------------------------------------------------------- the asteroid, where it really is (idea 40)
    var EPH = {};
    /** Aster's elements integrated through idea 40's forces: daily nodes from the element epoch, then one short
     * propagation from the nearest node to t. Deterministic: a state at t is always reached the same way. */
    function ephemeris(b) {
      if (EPH[b.designation]) return EPH[b.designation];
      var tEp = K39.jdTdbToTdb(b.elements.epochTdbJd), A = K39.bodyState(b, tEp);
      var o = { body: b, tEp: tEp, fwd: [A.r.concat(A.v)], back: [A.r.concat(A.v)] };
      function node(k) {
        var arr = k >= 0 ? o.fwd : o.back, kk = Math.abs(k), dir = k >= 0 ? 1 : -1;
        while (arr.length <= kk) {
          var n = arr.length, t0 = tEp + dir * (n - 1) * DAY, p = K40.propagate(arr[n - 1], t0, t0 + dir * DAY, FM);
          if (p.refusal) return null;
          arr.push(p.x);
        }
        return arr[kk];
      }
      o.state = function (t) {
        if (!inSpan(t)) return null;
        var k = Math.round((t - tEp) / DAY), x = node(k);
        if (!x) return null;
        var tk = tEp + k * DAY;
        if (t === tk) return { r: x.slice(0, 3), v: x.slice(3) };
        var p = K40.propagate(x, tk, t, FM);
        return p.refusal ? null : { r: p.x.slice(0, 3), v: p.x.slice(3) };
      };
      o.encounters = function (t0, t1) { return encounters(o, t0, t1); };
      EPH[b.designation] = o;
      return o;
    }
    function earthDistance(eph, t) { var A = eph.state(t), E = K39.earthState(t); return A && E ? norm(sub(A.r, E.r)) : NaN; }
    /** The asteroid's own Earth encounters below Aster's 0.05 au screening distance in [t0, t1]: daily scan, then golden
     * section to 1 s; with the geocentric osculating v-infinity and speed at closest approach. */
    function encounters(eph, t0, t1) {
      var lim = C.encounterAu * C.au_m, out = [], prev2 = NaN, prev = NaN;
      t0 = Math.max(t0, SPAN.start); t1 = Math.min(t1, SPAN.end);
      for (var t = t0; t <= t1 + 0.5; t += DAY) {
        var d = earthDistance(eph, t);
        if (num(prev) && num(prev2) && prev < prev2 && prev <= d && prev < lim) out.push(goldenMin(function (s) { return earthDistance(eph, s); }, t - 2 * DAY, t, 0.5));
        prev2 = prev; prev = d;
      }
      return out.map(function (tc) {
        var A = eph.state(tc), E = K39.earthState(tc), r = sub(A.r, E.r), v = sub(A.v, E.v), rn = norm(r), en = dot(v, v) / 2 - MU_E / rn;
        return { tdb: tc, utc: utc(tc), distance_m: rn, speed_m_s: norm(v), v_infinity_m_s: en > 0 ? Math.sqrt(2 * en) : null };
      });
    }
    function goldenMin(f, a, b, tol) {
      var g = (Math.sqrt(5) - 1) / 2, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
      while (b - a > tol) {
        if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
      }
      return (a + b) / 2;
    }

    // -------------------------------------------------------------- one return cell (idea 39's Lambert, reversed)
    function entrySpeed(vinf, alt) { var r = RE + (num(alt) ? alt : ENTRY_ALT); return Math.sqrt(vinf * vinf + 2 * MU_E / r); }
    function vinfMax(limit, alt) { var r = RE + (num(alt) ? alt : ENTRY_ALT), q = limit * limit - 2 * MU_E / r; return q > 0 ? Math.sqrt(q) : 0; }
    /** Every return from the asteroid at tDep to the Earth's centre after tofS, for the revolution families in revs. */
    function cell(eph, tDep, tofS, revs, A0) {
      var A = A0 || eph.state(tDep), tArr = tDep + tofS, E = inSpan(tArr) ? K39.earthState(tArr) : null;
      if (!A) return { ok: false, refusal: spanRefusal('A departure on ' + utc(tDep).slice(0, 10)) };
      if (!E) return { ok: false, refusal: spanRefusal('An arrival on ' + utc(tArr).slice(0, 10)) };
      var L = LR.lambert(A.r, E.r, tofS, MU_SUN, { revs: revs || [0] });
      if (L.refusal) return { ok: false, refusal: L.refusal };
      var sols = [];
      L.sols.forEach(function (q) {
        if (!q.converged) return;
        var dv = sub(q.v1, A.v), vi = sub(q.v2, E.v), vin = norm(vi);
        sols.push({ M: q.M, branch: q.branch, x: q.x, v1: q.v1, v2: q.v2, dv: dv, dvMag: norm(dv), vinf: vi, vinfMag: vin, decDeg: Math.asin(vi[2] / vin) / DEG,
          raDeg: ((Math.atan2(vi[1], vi[0]) / DEG) + 360) % 360, bound: dot(q.v1, q.v1) / 2 - MU_SUN / norm(A.r) < 0 });
      });
      return { ok: sols.length > 0, tDep: tDep, tofS: tofS, asteroid: A, earth: E, theta: L.theta, sols: sols, tmin: L.tmin };
    }
    /** Why a solution is refused as a selection: 0 none, 3 within 5 deg of 180 deg (the plane hangs on small offsets,
     * idea 39's rule), 4 unbound about the Sun, 5 the asteroid inside the Earth's sphere of influence at departure. */
    function exclusion(c, q) {
      var th = ((c.theta / DEG) % 360 + 360) % 360;
      if (Math.abs(th - 180) < C.nearPiDeg) return 3;
      if (!q.bound) return 4;
      var Ed = K39.earthState(c.tDep);
      if (Ed && norm(sub(c.asteroid.r, Ed.r)) < SOI) return 5;
      return 0;
    }

    // -------------------------------------------------------------- the mass ledger
    /** The propellant budget from idea 46's handoff (or the stand-alone inputs). */
    function budgetOf(src, S) {
      if (!src || src.propellant_kg === null) return null;
      var held = S.hold === 'held' && src.holdAllowed, rf = held ? 0 : src.boil.fuel, ro = held ? 0 : src.boil.ox;
      return { fuel: src.fuel_kg, ox: src.ox_kg, of: src.of, species: src.species, ve: src.ve_m_s, isp: src.isp_s, dry: src.dry_kg, rf: rf, ro: ro, held: held,
        cap: src.material_available_kg, stayEnd: src.stayEnd };
    }
    function burnable(B, f, o) { return B.species ? Math.max(0, Math.min(f, o / B.of)) * (1 + B.of) : Math.max(0, f + o); }
    function burn(B, f, o, used) { if (!B.species) return { f: f - used, o: o }; return { f: f - used / (1 + B.of), o: o - used * B.of / (1 + B.of) }; }
    function tcmOf(dv, S) { return S.tcm === 'execution' ? 3 * (EXEC.sigmaFixed_m_s + EXEC.sigmaProp * dv) : (num(S.tcm) ? S.tcm : 0); }
    /** The burns a return needs: departure (with margin and the first correction) and, if asked, braking to the entry limit. */
    function burnsOf(dvDep, vinf, S) {
      var dv1 = dvDep * (1 + S.margin) + tcmOf(dvDep, S), vmax = vinfMax(S.entryLimit_m_s, S.entryAlt_m);
      var dv2 = S.arrival === 'brake' ? Math.max(0, vinf - vmax) * (1 + S.margin) : 0;
      return { dv1: dv1, dv2: dv2, vinfAfter: S.arrival === 'brake' ? Math.min(vinf, vmax) : vinf, vinfMax: vmax };
    }
    /** Can the craft carry material m home on this window? The full ledger, step by step. */
    function ledger(B, waitS, tofS, burns, m) {
      var w = waitS / DAY, f1 = Math.max(0, B.fuel - B.rf * w), o1 = Math.max(0, B.ox - B.ro * w);
      var M0 = B.dry + m + f1 + o1, used1 = M0 * (1 - Math.exp(-burns.dv1 / B.ve)), ok1 = used1 <= burnable(B, f1, o1) * (1 + 1e-12);
      var s2 = burn(B, f1, o1, used1), d = tofS / DAY, f3 = Math.max(0, s2.f - B.rf * d), o3 = Math.max(0, s2.o - B.ro * d);
      var M2 = B.dry + m + f3 + o3, used2 = burns.dv2 > 0 ? M2 * (1 - Math.exp(-burns.dv2 / B.ve)) : 0, ok2 = used2 <= burnable(B, f3, o3) * (1 + 1e-12);
      var s4 = burn(B, f3, o3, used2);
      return { ok: ok1 && ok2, wait_days: w, fuel_departure_kg: f1, ox_departure_kg: o1, boiloff_wait_kg: (B.fuel - f1) + (B.ox - o1), mass_departure_kg: M0,
        burned_departure_kg: used1, boiloff_cruise_kg: Math.max(0, s2.f - f3) + Math.max(0, s2.o - o3), burned_braking_kg: used2,
        fuel_arrival_kg: Math.max(0, s4.f), ox_arrival_kg: Math.max(0, s4.o), mass_arrival_kg: B.dry + m + Math.max(0, s4.f) + Math.max(0, s4.o) };
    }
    /** The most material the propellant can push home on this window (kg; negative: the craft cannot get home even empty). */
    function materialMax(B, waitS, tofS, burns) {
      var w = waitS / DAY, f1 = Math.max(0, B.fuel - B.rf * w), o1 = Math.max(0, B.ox - B.ro * w), q = 1 - Math.exp(-burns.dv1 / B.ve);
      var m1 = q > 0 ? burnable(B, f1, o1) / q - (B.dry + f1 + o1) : Infinity;
      if (!(burns.dv2 > 0)) return m1;
      if (!(m1 >= 0) || !ledger(B, waitS, tofS, burns, 0).ok) return Math.min(m1, -1e-9);
      var lo = 0, hi = num(m1) ? m1 : 1e12;
      for (var i = 0; i < 80 && hi - lo > 1e-6 * Math.max(1, hi); i++) { var mid = (lo + hi) / 2; if (ledger(B, waitS, tofS, burns, mid).ok) lo = mid; else hi = mid; }
      return lo;
    }
    function capacity(B, waitS) {   // delta-v with no material, departure alone
      var w = waitS / DAY, f1 = Math.max(0, B.fuel - B.rf * w), o1 = Math.max(0, B.ox - B.ro * w), M0 = B.dry + f1 + o1, b = burnable(B, f1, o1);
      return B.ve * Math.log(M0 / (M0 - b));
    }

    // -------------------------------------------------------------- objective, grid, refine
    var OBJECTIVES = { material: 'most material home', dv: 'least delta-v at the asteroid', vinf: 'slowest arrival at the Earth' };
    function score(q, c, S, B, wait) {
      var bu = burnsOf(q.dvMag, q.vinfMag, S);
      if (S.objective === 'vinf') { if (!B) return q.vinfMag; return materialMax(B, wait, c.tofS, bu) >= 0 ? q.vinfMag : 1e9 + q.vinfMag; }
      if (S.objective === 'material' && B) {
        var m = materialMax(B, wait, c.tofS, bu), cap = num(B.cap) ? B.cap : Infinity;
        return m >= 0 ? -Math.min(m, cap) + 1e-9 * (bu.dv1 + bu.dv2) : 1e9 + bu.dv1 + bu.dv2;
      }
      return bu.dv1 + bu.dv2;
    }
    function bestOf(c, S, B, wait, fam) {
      var bi = -1, bv = Infinity, why = 0;
      c.sols.forEach(function (q, i) {
        if (fam && (q.M !== fam.M || q.branch !== fam.branch)) return;
        var ex = exclusion(c, q); if (ex) { if (!why) why = ex; return; }
        var v = score(q, c, S, B, wait); if (v < bv) { bv = v; bi = i; }
      });
      return { i: bi, v: bv, why: why };
    }
    function linspace(a, b, n) { var o = []; for (var i = 0; i < n; i++) o.push(n === 1 ? a : a + (b - a) * i / (n - 1)); return o; }
    function revsOf(S) { var r = []; for (var m = 0; m <= S.revs; m++) r.push(m); return r; }
    /** The porkchop: departure (from the stay's end plus the wait) by flight time. Typed arrays over k = j*nDep + i. */
    function grid(eph, S, B, t0) {
      var nD = S.nDep, nT = S.nTof, deps = linspace(t0 + S.waitMinDays * DAY, t0 + S.waitMaxDays * DAY, nD), tofs = linspace(S.tofMinDays * DAY, S.tofMaxDays * DAY, nT), n = nD * nT;
      var G = { nDep: nD, nTof: nT, deps: deps, tofs: tofs, dv: new Float64Array(n), vinf: new Float64Array(n), entry: new Float64Array(n), mat: new Float64Array(n), val: new Float64Array(n),
        fam: new Int8Array(n), excl: new Uint8Array(n), solved: 0, unsolved: 0, excluded: { plane: 0, unbound: 0, soi: 0 }, best: null, revs: revsOf(S) };
      var best = { k: -1, v: Infinity };
      for (var i = 0; i < nD; i++) {
        var A = eph.state(deps[i]);
        for (var j = 0; j < nT; j++) {
          var k = j * nD + i; G.dv[k] = G.vinf[k] = G.entry[k] = G.mat[k] = G.val[k] = NaN; G.fam[k] = -1;
          if (!A) { G.unsolved++; continue; }
          var c = cell(eph, deps[i], tofs[j], G.revs, A);
          if (!c.ok) { G.unsolved++; continue; }
          var bo = bestOf(c, S, B, deps[i] - t0), q;
          if (bo.i < 0) { G.solved++; G.excl[k] = bo.why; G.excluded[bo.why === 3 ? 'plane' : bo.why === 4 ? 'unbound' : 'soi']++; q = c.sols[0]; }
          else { G.solved++; q = c.sols[bo.i]; G.val[k] = bo.v; if (bo.v < best.v) best = { k: k, v: bo.v }; }
          G.dv[k] = q.dvMag; G.vinf[k] = q.vinfMag; G.entry[k] = entrySpeed(q.vinfMag, S.entryAlt_m); G.fam[k] = q.M * 3 + (q.branch === 'single' ? 0 : q.branch === 'left' ? 1 : 2);
          if (B) G.mat[k] = materialMax(B, deps[i] - t0, tofs[j], burnsOf(q.dvMag, q.vinfMag, S));
        }
      }
      if (best.k >= 0) G.best = { depTdb: deps[best.k % nD], tofS: tofs[Math.floor(best.k / nD)], fam: famOf(G.fam[best.k]), value: best.v, k: best.k };
      return G;
    }
    function famOf(code) { if (code < 0) return null; var M = Math.floor(code / 3), r = code % 3; return { M: M, branch: r === 0 ? 'single' : r === 1 ? 'left' : 'right' }; }
    /** Riding the asteroid home: for each departure, the flight that arrives at the asteroid's own Earth encounter. */
    function rides(eph, S, B, t0, G, encs) {
      var out = [];
      encs.forEach(function (en) {
        var best = null;
        G.deps.forEach(function (td) {
          var tof = en.tdb - td; if (tof < S.tofMinDays * DAY || tof > S.tofMaxDays * DAY) return;
          var c = cell(eph, td, tof, G.revs); if (!c.ok) return;
          var bo = bestOf(c, S, B, td - t0); if (bo.i < 0) return;
          if (!best || bo.v < best.value) best = { depTdb: td, tofS: tof, fam: { M: c.sols[bo.i].M, branch: c.sols[bo.i].branch }, value: bo.v };
        });
        if (best) { best.encounter = en; out.push(best); }
      });
      return out;
    }
    /** Nelder-Mead on (departure, arrival) for one family, inside the window: the local optimum of the objective. */
    function refine(eph, seed, S, B, t0) {
      var dMin = t0 + S.waitMinDays * DAY, dMax = t0 + S.waitMaxDays * DAY, fam = seed.fam;
      function f(p) {
        var td = p[0], ta = p[1], tof = ta - td;
        if (td < dMin || td > dMax || tof < S.tofMinDays * DAY || tof > S.tofMaxDays * DAY) return Infinity;
        var c = cell(eph, td, tof, [fam.M]); if (!c.ok) return Infinity;
        var bo = bestOf(c, S, B, td - t0, fam); return bo.i < 0 ? Infinity : bo.v;
      }
      var P = [[seed.depTdb, seed.depTdb + seed.tofS], [seed.depTdb + 2 * DAY, seed.depTdb + seed.tofS], [seed.depTdb, seed.depTdb + seed.tofS + 0.5 * DAY]];
      var F = P.map(f), it = 0;
      for (; it < 600; it++) {
        var ord = [0, 1, 2].sort(function (a, b) { return F[a] - F[b]; }); P = ord.map(function (q) { return P[q]; }); F = ord.map(function (q) { return F[q]; });
        var size = Math.max(Math.abs(P[1][0] - P[0][0]), Math.abs(P[2][0] - P[0][0]), Math.abs(P[1][1] - P[0][1]), Math.abs(P[2][1] - P[0][1]));
        if (size < 1) break;
        var cen = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], xr = [2 * cen[0] - P[2][0], 2 * cen[1] - P[2][1]], fr = f(xr);
        if (fr < F[0]) { var xe = [3 * cen[0] - 2 * P[2][0], 3 * cen[1] - 2 * P[2][1]], fe = f(xe); if (fe < fr) { P[2] = xe; F[2] = fe; } else { P[2] = xr; F[2] = fr; } }
        else if (fr < F[1]) { P[2] = xr; F[2] = fr; }
        else {
          var xc = [(cen[0] + P[2][0]) / 2, (cen[1] + P[2][1]) / 2], fc = f(xc);
          if (fc < F[2]) { P[2] = xc; F[2] = fc; }
          else { for (var s = 1; s < 3; s++) { P[s] = [(P[0][0] + P[s][0]) / 2, (P[0][1] + P[s][1]) / 2]; F[s] = f(P[s]); } }
        }
      }
      return { depTdb: P[0][0], tofS: P[0][1] - P[0][0], fam: fam, value: F[0], iterations: it, source: seed.source };
    }

    // -------------------------------------------------------------- flown through idea 40's solar system
    /** Closest approach to the Earth after flying x0 from t0, searched from tArr - 8 d to tArr + 8 d. */
    function approach(x0, t0, tArr) {
      var tS = Math.max(t0, tArr - 8 * DAY), p = tS > t0 ? K40.propagate(x0, t0, tS, FM) : { x: x0.slice() };
      if (p.refusal) return { refusal: p.refusal };
      var x = p.x, t = tS, best = { d: Infinity }, step = 2 * HOUR, nodes = [];
      for (var k = 0; k < 16 * 24 / 2 + 1; k++) {
        var E = K39.earthState(t); if (!E) return { refusal: spanRefusal('The flight home') };
        var d = norm(sub(x.slice(0, 3), E.r)); nodes.push({ t: t, x: x, d: d });
        if (d < best.d) best = { d: d, k: nodes.length - 1 };
        if (nodes.length > 2 && d > nodes[nodes.length - 2].d && nodes[nodes.length - 2].d === best.d) break;
        var q = K40.propagate(x, t, t + step, FM); if (q.refusal) return { refusal: q.refusal }; x = q.x; t += step;
      }
      var a = nodes[Math.max(0, best.k - 1)], b = nodes[Math.min(nodes.length - 1, best.k + 1)];
      function at(s) { var q = K40.propagate(a.x, a.t, s, FM); return q.refusal ? null : q.x; }
      function dist(s) { var x1 = at(s), E1 = K39.earthState(s); return x1 && E1 ? norm(sub(x1.slice(0, 3), E1.r)) : Infinity; }
      var tc = goldenMin(dist, a.t, b.t, 0.01), xc = at(tc), Ec = K39.earthState(tc);
      // the conic is read where it is well defined: at closest approach, or (when that is deep in the well, inside
      // 10 Earth radii, where a near-radial dive makes it ill-conditioned) at the last node outside 10 Earth radii
      var pre = null;
      for (var j = best.k; j >= 0; j--) if (nodes[j].d > 10 * RE) { var Ej = K39.earthState(nodes[j].t); pre = { t: nodes[j].t, r: sub(nodes[j].x.slice(0, 3), Ej.r), v: sub(nodes[j].x.slice(3), Ej.v) }; break; }
      var ca = { t: tc, r: sub(xc.slice(0, 3), Ec.r), v: sub(xc.slice(3), Ec.v), d: norm(sub(xc.slice(0, 3), Ec.r)), edge: best.k === nodes.length - 1 };
      ca.conicAt = ca.d < 10 * RE && pre ? pre : ca;
      return ca;
    }
    /** The approach hyperbola at closest approach: v-infinity, the incoming asymptote S, the B vector (B = b S x h),
     * B.T and B.R with T in the ecliptic (idea 40's convention), and the time of periapsis. */
    function bplaneOf(st) {
      var r = st.r, v = st.v, rn = norm(r), en = dot(v, v) / 2 - MU_E / rn;
      if (!(en > 0)) return null;
      var h = cross(r, v), hn = norm(h), ev = sub(scale(cross(v, h), 1 / MU_E), scale(r, 1 / rn)), e = norm(ev), vi = Math.sqrt(2 * en);
      if (!(e > 1)) return null;
      var eh = scale(ev, 1 / e), hh = scale(h, 1 / hn), S = add(scale(eh, 1 / e), scale(cross(hh, eh), Math.sqrt(e * e - 1) / e));
      var b = hn / vi, B = scale(unit(cross(S, hh)), b), T = unit(cross(S, ECL)), R = cross(S, T);
      var a = -MU_E / (2 * en), cF = Math.max(1, (1 - rn / a) / e), F = (dot(r, v) < 0 ? -1 : 1) * Math.log(cF + Math.sqrt(cF * cF - 1));   // hyperbolic anomaly
      var tp = st.t - (e * Math.sinh(F) - F) / Math.sqrt(MU_E / (-a * a * a));
      return { vinf: vi, S: S, b: b, BT: dot(B, T), BR: dot(B, R), rp: a * (1 - e), tp: tp, vinfVec: scale(S, vi), e: e };
    }
    /** Fly the patched-conic return through every force, then re-aim the departure (Newton on a finite-difference
     * Jacobian) so the flight passes the Earth at the aim altitude, on the uncorrected flight's B-plane angle and time. */
    function fly(eph, sel, S) {
      var A = eph.state(sel.depTdb), tArr = sel.depTdb + sel.tofS, evals = 0;
      function shoot(dv) { evals++; var ca = approach(A.r.concat(add(A.v, dv)), sel.depTdb, tArr); if (ca.refusal) return ca; var bp = bplaneOf(ca.conicAt); return bp ? { ca: ca, bp: bp } : { refusal: refusal('not_found', 'Flown through every force, the return is not on a hyperbola about the Earth where its approach is read (closest approach ' + fmt(ca.d / 1000, 4) + ' km on ' + utc(ca.t).slice(0, 10) + '): it arrives too slowly, or not at all, for a flyby to be aimed. The patched-conic numbers stand alone.', 'Another window (a faster arrival), or the patched conic as it is.', { applies_to: 'nbody_check' }) }; }
      var u = shoot(sel.q.dv); if (u.refusal) return { refusal: u.refusal };
      var th = Math.atan2(u.bp.BR, u.bp.BT), tp0 = u.bp.tp, rpT = RE + S.aimAlt_m;
      function resid(P) { var bs = rpT * Math.sqrt(1 + 2 * MU_E / (rpT * P.bp.vinf * P.bp.vinf)); return [P.bp.BT - bs * Math.cos(th), P.bp.BR - bs * Math.sin(th), (P.bp.tp - tp0) * P.bp.vinf]; }
      var dv = sel.q.dv.slice(), P = u, F = resid(P), it = 0, eps = 1e-3;
      for (; it < 14 && norm(F) > 1000; it++) {
        var J = [];
        for (var c = 0; c < 3; c++) { var d2 = dv.slice(); d2[c] += eps; var Pc = shoot(d2); if (Pc.refusal) return { refusal: Pc.refusal }; var Fc = resid(Pc); J.push([(Fc[0] - F[0]) / eps, (Fc[1] - F[1]) / eps, (Fc[2] - F[2]) / eps]); }
        var Jm = [J[0][0], J[1][0], J[2][0], J[0][1], J[1][1], J[2][1], J[0][2], J[1][2], J[2][2]], inv = LC.inv3(Jm);
        if (!inv) break;
        var step = LC.mmul(inv, F, 3, 3, 1).map(function (x) { return -x; }), lam = 1, Q = null;
        for (var bt = 0; bt < 12; bt++) { var dt = add(dv, scale(step, lam)), Pq = shoot(dt); if (!Pq.refusal && norm(resid(Pq)) < norm(F)) { Q = { P: Pq, dv: dt }; break; } lam /= 2; }
        if (!Q) break;
        dv = Q.dv; P = Q.P; F = resid(P);
      }
      var conv = norm(F) <= 1000;
      // the arrival is read off the closest approach (as JPL's close-approach tables give v-infinity) unless that is
      // below the ground, where the conic outside 10 Earth radii stands
      var atCA = P.ca.d > RE ? bplaneOf(P.ca) : null, Pv = atCA || P.bp;
      var out = { converged: conv, iterations: it, evaluations: evals, residual_m: norm(F), dv: dv, dvMag: norm(dv), patchedMag: sel.q.dvMag,
        uncorrected: { perigee_altitude_m: u.bp.rp - RE, closest_m: u.ca.d, perigee_tdb: u.bp.tp, b_m: u.bp.b, bt_m: u.bp.BT, br_m: u.bp.BR, v_infinity_m_s: u.bp.vinf },
        flown: { perigee_altitude_m: P.ca.d - RE, conic_perigee_altitude_m: P.bp.rp - RE, perigee_tdb: P.ca.t, r_geo_m: P.ca.r, v_geo_m_s: P.ca.v, v_infinity_m_s: Pv.vinf, v_infinity_vector_m_s: Pv.vinfVec, read_at: atCA ? 'closest approach' : 'outside 10 Earth radii',
          dec_deg: Math.asin(Pv.S[2]) / DEG, ra_deg: ((Math.atan2(Pv.S[1], Pv.S[0]) / DEG) + 360) % 360, b_m: P.bp.b, bt_m: P.bp.BT, br_m: P.bp.BR } };
      if (!conv) out.refusal = refusal('not_found', 'Re-aiming the return through every force did not converge (' + it + ' iterations, residual ' + fmt(norm(F) / 1000, 3) + ' km): the patched-conic numbers stand alone.', 'Another window, or a flight time away from an Earth encounter.', { applies_to: 'nbody_check' });
      return out;
    }

    // -------------------------------------------------------------- idea 46's handoff
    function findBody(site) {
      var key = site && site.key && BODY_KEYS[site.key], b = key ? K39.findBody(key) : null;
      if (!b && site && site.body) { var lead = String(site.body).split(' ')[0]; b = K39.findBody(lead); }
      return b;
    }
    function bad(why) { return { refusal: refusal('invalid_input', why, 'A handoff exported by idea 46 (Split) or by this page.') }; }
    /** Check idea 46's handoff without re-running idea 46 (that needs ideas 31 and 32's kernels): its envelope, units,
     * and its own arithmetic (propellant = fuel + oxidizer, O/F, dry total, its delta-v estimate from ve and masses). */
    function importSplit(h46) {
      var h = h46;
      if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { return bad('That is not JSON.'); } }
      if (!h || h.handoff !== 'long-way-round') return bad('That is not a Long Way Round handoff.');
      if (h.from === '47-way-home') return { own: true, h: h };
      if (h.from !== '46-split') return bad('This is a handoff from ' + h.from + '; this page takes idea 46\'s (the propellant made at the asteroid).');
      if (h.version !== 1) return bad('Version ' + h.version + ' of idea 46\'s handoff is not one this page reads (it reads version 1).');
      var O2 = h.outputs || {}, need = { propellant: 'kg', site: 'kg', dry_mass: 'kg', delta_v_estimate: 'm/s', totals: 'kg' };
      for (var k in need) if (!O2[k] || typeof O2[k].units !== 'string' || O2[k].units.indexOf(need[k]) < 0) return bad('Idea 46\'s handoff has no ' + k + ' in ' + need[k] + '.');
      var P = O2.propellant.value, Sx = O2.site.value, D = O2.dry_mass.value;
      if (!Sx || typeof Sx.stay_end_utc !== 'string' || !num(K39.parseUtc(Sx.stay_end_utc))) return bad('Idea 46\'s handoff gives no date for the end of the stay.');
      if (!num(D.total_kg) || D.total_kg <= 0 || Math.abs(D.craft_kg + D.tanks_kg + D.coolers_kg - D.total_kg) > 1e-6 * D.total_kg) return bad('Idea 46\'s dry mass does not add up (craft + tanks + coolers).');
      var b = findBody(Sx);
      if (!b) return { refusal: refusal('not_found', 'The asteroid ' + Sx.body + ' is not one of the six bodies here (Aster\'s elements with an n-body oracle in idea 40).', 'One of Apophis, Bennu, Ryugu, Didymos, Eros or 2000 SG344, or idea 40\'s build-data.mjs for another body.', { applies_to: 'target' }) };
      var src = { from: '46-split', h46: h, body: b, stayEnd: K39.parseUtc(Sx.stay_end_utc), stayEndUtc: Sx.stay_end_utc, site: Sx, dry_kg: D.total_kg, dryParts: D,
        route: P.route, refusals46: (h.refusals || []).map(function (r) { var q = clone(r); if (!q.from) q.from = '46-split'; return q; }) };
      if (P.mass_kg === null || P.mass_kg === undefined) {
        src.propellant_kg = null;
      } else {
        if (!num(P.mass_kg) || P.mass_kg < 0 || !num(P.isp_s) || !num(P.ve_m_s) || P.ve_m_s <= 0) return bad('Idea 46\'s propellant has no mass, Isp or exhaust speed.');
        var species = P.oxidizer !== null && P.oxidizer !== undefined && num(P.mixture_ratio);
        if (species) {
          if (Math.abs(P.fuel_kg + P.oxidizer_kg - P.mass_kg) > 1e-6 * Math.max(1, P.mass_kg)) return bad('Idea 46\'s propellant is not its fuel plus its oxidizer.');
          if (P.fuel_kg > 0 && Math.abs(P.oxidizer_kg / P.fuel_kg - P.mixture_ratio) > 1e-6 * P.mixture_ratio) return bad('Idea 46\'s oxidizer and fuel are not at its mixture ratio.');
        }
        var est = P.ve_m_s * Math.log((D.total_kg + P.mass_kg) / D.total_kg);
        if (!num(O2.delta_v_estimate.value) || Math.abs(est - O2.delta_v_estimate.value) > 1e-6 * Math.max(1, est)) return bad('Idea 46\'s delta-v estimate is not what its own propellant, exhaust speed and dry mass give: it was edited.');
        src.propellant_kg = P.mass_kg; src.isp_s = P.isp_s; src.ve_m_s = P.ve_m_s; src.species = species; src.of = species ? P.mixture_ratio : null;
        src.fuel_kg = species ? P.fuel_kg : P.mass_kg; src.ox_kg = species ? P.oxidizer_kg : 0; src.fuelName = P.fuel; src.oxName = P.oxidizer || null;
      }
      var cryo = O2.cryo && O2.cryo.value, bo = cryo && cryo.boiloff_passive_kg_per_day;
      src.boil = bo && P.route === 'cryo' ? { fuel: bo.h2 || 0, ox: bo.o2 || 0 } : { fuel: 0, ox: 0 };
      var badDays = src.refusals46.some(function (r) { return r.from === '46-split' && (r.applies_to === 'cooler20' || r.applies_to === 'zbo'); });
      src.holdAllowed = P.route === 'cryo' && !!(cryo && cryo.zbo) && !badDays;
      src.holdWhyNot = P.route !== 'cryo' ? 'nothing boils: the ' + P.route + ' route stores no cryogen' : (!(cryo && cryo.zbo) ? 'idea 46 ran its coolers without zero boil-off' : (badDays ? 'idea 46\'s arrays could not hold the boil-off on some days (its cooler20/zbo refusal)' : null));
      // material: what idea 45 dug over the stay, less its water (read from idea 45's handoff inside idea 46's, when it is carried whole)
      var dig = h.inputs && h.inputs.dig_handoff, wr = dig && !dig.pruned && dig.outputs && dig.outputs.water_rate && dig.outputs.water_rate.value;
      if (wr && num(wr.regolith_kg_per_day) && num(wr.days) && num(wr.total_kg)) { src.material_available_kg = wr.regolith_kg_per_day * wr.days - wr.total_kg; src.materialSource = 'idea 45: ' + fmt(wr.regolith_kg_per_day, 6) + ' kg of regolith a day for ' + wr.days + ' days, less ' + fmt(wr.total_kg, 4) + ' kg of water baked out'; }
      else src.material_available_kg = null;
      return src;
    }
    function customSource(cu) {
      var b = K39.findBody(cu.body), t = K39.parseUtc(cu.stay_end_utc);
      if (!b) return bad('Choose one of the six bodies.');
      if (!num(t)) return bad('The stay\'s end must be a date.');
      if (!(cu.propellant_kg >= 0 && cu.isp_s > 0 && cu.dry_kg > 0 && cu.boiloff_kg_per_day >= 0)) return bad('Propellant, Isp, dry mass and boil-off must be positive numbers.');
      var ve = cu.isp_s * cu.g0;
      return { from: 'custom', body: b, stayEnd: t, stayEndUtc: cu.stay_end_utc, dry_kg: cu.dry_kg, propellant_kg: cu.propellant_kg, isp_s: cu.isp_s, ve_m_s: ve, species: false, of: null,
        fuel_kg: cu.propellant_kg, ox_kg: 0, boil: { fuel: cu.boiloff_kg_per_day, ox: 0 }, holdAllowed: false, holdWhyNot: 'stand-alone inputs carry no cooler', material_available_kg: null, refusals46: [], route: 'custom' };
    }

    // -------------------------------------------------------------- settings
    function defaults() {
      return { case: 'chain', custom: null, waitMinDays: 0, waitMaxDays: 730, tofMinDays: 20, tofMaxDays: 720, nDep: 90, nTof: 70, revs: 1, objective: 'material',
        margin: C.marginFraction, tcm: 'execution', hold: 'passive', arrival: 'handon', entryLimit_m_s: ENTRY_LIMIT, entryAlt_m: ENTRY_ALT, aimAlt_m: ENTRY_ALT,
        material: 'max', nbody: true, selection: null };
    }
    function customDefaults() {   // the stand-alone craft starts as the chain's, with its numbers editable
      var s = CHAIN && importSplit(CHAIN);
      return { body: '99942', stay_end_utc: s && !s.refusal ? s.stayEndUtc : '2028-10-10T00:00:00Z', propellant_kg: s && !s.refusal ? s.propellant_kg : 0, isp_s: s && !s.refusal ? s.isp_s : 0,
        dry_kg: s && !s.refusal ? s.dry_kg : 0, boiloff_kg_per_day: 0, g0: s && !s.refusal ? s.ve_m_s / s.isp_s : null };
    }
    function validSettings(Sin) {
      var S = defaults(); for (var k in Sin || {}) S[k] = Sin[k];
      function bad2(w, h) { return { refusal: refusal('invalid_input', w, h) }; }
      if (!(S.waitMinDays >= 0 && S.waitMaxDays >= S.waitMinDays && S.waitMaxDays - S.waitMinDays <= 4000)) return bad2('The departure window must run forward from the stay\'s end (0 to 4,000 days of waiting).', 'A wait from 0 days, and a window under 11 years.');
      if (!(S.tofMinDays >= 5 && S.tofMaxDays > S.tofMinDays && S.tofMaxDays <= 2000)) return bad2('Flight times must run from at least 5 days to at most 2,000 days, shortest first.', 'For example 20 to 720 days.');
      if (!(S.nDep >= 10 && S.nDep <= 240 && S.nTof >= 10 && S.nTof <= 200)) return bad2('The grid must be 10 to 240 departures by 10 to 200 flight times.', 'The default 90 by 70.');
      if ([0, 1, 2].indexOf(S.revs) < 0) return bad2('Revolutions about the Sun: up to 0, 1 or 2.', 'Up to 1.');
      if (!OBJECTIVES[S.objective]) return bad2('Unknown objective ' + S.objective + '.', 'material, dv or vinf.');
      if (!(S.margin >= 0 && S.margin <= 1)) return bad2('The delta-v margin must be 0 to 100 %.', 'Aster\'s 10 %.');
      if (!(S.tcm === 'execution' || (num(S.tcm) && S.tcm >= 0 && S.tcm <= 1000))) return bad2('The correction allowance must be "execution" or 0 to 1,000 m/s.', 'The departure burn\'s own execution error (idea 40\'s Lucy model).');
      if (['passive', 'held'].indexOf(S.hold) < 0 || ['handon', 'brake'].indexOf(S.arrival) < 0) return bad2('Unknown boil-off or arrival option.', 'passive or held; handon or brake.');
      if (!(S.entryLimit_m_s >= 11000 && S.entryLimit_m_s <= 20000)) return bad2('The entry-speed limit must be 11 to 20 km/s.', 'NHATS\'s 12 km/s.');
      if (!(S.entryAlt_m >= 50000 && S.entryAlt_m <= 200000)) return bad2('The entry altitude must be 50 to 200 km.', 'NHATS\'s 125 km.');
      if (!(S.aimAlt_m >= -6000000 && S.aimAlt_m <= 2000000)) return bad2('The aim perigee altitude must be -6,000 to 2,000 km.', 'NHATS\'s 125 km entry altitude.');
      if (!(S.material === 'max' || (num(S.material) && S.material >= 0))) return bad2('Material home must be "max" or a mass in kg.', 'max.');
      if (S.selection && !(num(S.selection.depTdb) && num(S.selection.tofS) && S.selection.tofS > 0 && [0, 1, 2].indexOf(S.selection.M) >= 0)) return bad2('The selected window is not a departure, a flight time and a revolution count.', 'Pick a cell on the porkchop.');
      return { S: S };
    }

    // -------------------------------------------------------------- one run
    /** run(settings, {split: idea 46's handoff} or null for the stand-alone craft in settings.custom). */
    function run(Sin, input) {
      var v = validSettings(Sin); if (v.refusal) return v;
      var S0 = v.S, S = clone(S0), src;   // S0: the settings as given (exported); S: as used (a window moved into the ephemerides, a hold refused)
      if (S.case === 'custom') { var cu = S.custom || customDefaults(); S.custom = cu; S0.custom = clone(cu); src = customSource(cu); }
      else src = importSplit(input && input.split !== undefined ? input.split : CHAIN);
      if (src.refusal) return src;
      if (src.own) return bad('That is this page\'s own handoff: import it with "Import" (it is read back), not as idea 46\'s.');
      var R = { S: S, S0: S0, src: src, refusals: [], body: src.body };
      var eph = ephemeris(src.body), t0 = src.stayEnd, B = budgetOf(src, S);
      if (S.hold === 'held' && !src.holdAllowed) { S.hold = 'passive'; R.refusals.push(refusal('out_of_envelope', 'The coolers cannot hold the boil-off here: ' + src.holdWhyNot + '. Passive boil-off is used.', 'Idea 46\'s liquid route with zero boil-off on every day.', { applies_to: 'hold' })); B = budgetOf(src, S); }
      var dep0 = t0 + S.waitMinDays * DAY, dep1 = t0 + S.waitMaxDays * DAY;
      if (dep0 < SPAN.start) {
        R.refusals.push(refusal('out_of_envelope', 'The stay ended on ' + src.stayEndUtc.slice(0, 10) + ', before the ephemerides here begin (' + K39.tdbDate(SPAN.start) + '): no departure before then can be computed, so the window starts there, after ' + fmt((SPAN.start - t0) / DAY, 4) + ' days of waiting.', 'Aster\'s Earth ephemeris extended back (its H0 item), or a stay inside 2026-2040.', { applies_to: 'ephemeris_span' }));
        S.waitMinDays = Math.ceil((SPAN.start - t0) / DAY + 1); if (S.waitMaxDays < S.waitMinDays + 30) S.waitMaxDays = S.waitMinDays + 730;
        dep0 = t0 + S.waitMinDays * DAY; dep1 = t0 + S.waitMaxDays * DAY;
      }
      if (dep1 + S.tofMinDays * DAY > SPAN.end) return { refusal: spanRefusal('The whole departure window (' + utc(dep0).slice(0, 10) + ' to ' + utc(dep1).slice(0, 10) + ')') };
      R.encounters = encounters(eph, dep0, dep1 + S.tofMaxDays * DAY);
      R.grid = grid(eph, S, B, t0);
      if (!B) R.refusals.push(refusal('insufficient_data', 'Idea 46 refused the propellant (its engine refusal), so nothing here says what can come home: the porkchop is the cost of the return alone.', 'A propellant idea 46 can burn (another mixture ratio there).', { applies_to: 'propellant' }));
      var sel = null;
      if (S.selection) {
        var fam = { M: S.selection.M, branch: S.selection.branch || 'single' };
        sel = { depTdb: S.selection.depTdb, tofS: S.selection.tofS, fam: fam, source: S.selection.source || 'chosen' };
      } else {
        var seeds = [];
        if (R.grid.best) seeds.push({ depTdb: R.grid.best.depTdb, tofS: R.grid.best.tofS, fam: R.grid.best.fam, source: 'grid' });
        R.rides = rides(eph, S, B, t0, R.grid, R.encounters);
        R.rides.forEach(function (rd) { seeds.push({ depTdb: rd.depTdb, tofS: rd.tofS, fam: rd.fam, source: 'ride' }); });
        var bestR = null;
        seeds.forEach(function (sd) { var q = refine(eph, sd, S, B, t0); if (num(q.value) && (!bestR || q.value < bestR.value)) bestR = q; });
        if (bestR) sel = bestR;
        else R.refusals.push(refusal('not_found', 'No return in this window passes the selection rules (' + R.grid.solved + ' solved: ' + R.grid.excluded.plane + ' within 5 deg of 180 deg, ' + R.grid.excluded.unbound + ' unbound about the Sun, ' + R.grid.excluded.soi + ' leaving inside the Earth\'s sphere of influence).', 'A longer window or other flight times.', { applies_to: 'selection' }));
      }
      if (sel) {
        var waitS = sel.depTdb - t0;
        if (waitS < S.waitMinDays * DAY - 1 || waitS > S.waitMaxDays * DAY + 1) R.refusals.push(refusal('out_of_envelope', 'The chosen departure is outside the window set.', 'A departure inside it.', { applies_to: 'selection' }));
        var c = cell(eph, sel.depTdb, sel.tofS, [sel.fam.M]);
        var qi = -1; if (c.ok) c.sols.forEach(function (q, i) { if (q.branch === sel.fam.branch) qi = i; });
        if (!c.ok || qi < 0) { R.refusals.push(c.refusal || refusal('not_found', 'No ' + sel.fam.M + '-revolution (' + sel.fam.branch + ') return exists for that departure and flight time.', 'Another cell.', { applies_to: 'lambert' })); }
        else {
          var q = c.sols[qi], ex = exclusion(c, q);
          if (ex) R.refusals.push(refusal('out_of_envelope', ex === 3 ? 'The transfer angle is within ' + C.nearPiDeg + ' deg of 180 deg: its plane hangs on small offsets (idea 39\'s rule), so its delta-v is not trustworthy.' : ex === 4 ? 'The return is unbound about the Sun.' : 'The asteroid is inside the Earth\'s sphere of influence at departure (' + fmt(norm(sub(c.asteroid.r, K39.earthState(c.tDep).r)) / 1000, 4) + ' km): a heliocentric arc from there is not a patched conic.', ex === 5 ? 'Leave before or after the encounter.' : 'A few days either way.', { applies_to: ex === 3 ? 'transfer_plane' : ex === 4 ? 'transfer_orbit' : 'soi_departure' }));
          R.sel = { depTdb: sel.depTdb, tofS: sel.tofS, arrTdb: sel.depTdb + sel.tofS, fam: sel.fam, source: sel.source, cell: c, q: q, excluded: ex };
          R.ride = R.encounters.filter(function (en) { return Math.abs(en.tdb - R.sel.arrTdb) < 3 * DAY; })[0] || null;
          var tb = K39.bodyState(src.body, sel.depTdb);
          if (tb) { var Ltb = LR.lambert(tb.r, c.earth.r, sel.tofS, MU_SUN, { revs: [sel.fam.M] }), stb = Ltb.sols.filter(function (z) { return z.converged && z.branch === sel.fam.branch; })[0];
            R.twoBody = { offset_m: norm(sub(tb.r, c.asteroid.r)), dv_m_s: stb ? norm(sub(stb.v1, tb.v)) : null }; }
          if (S.nbody && !ex) R.flight = fly(eph, R.sel, S);
          finishMass(R, B);
        }
      }
      ownRefusals(R);
      return R;
    }
    function finishMass(R, B) {
      var S = R.S, sel = R.sel, fl = R.flight && R.flight.converged ? R.flight : null;
      var dvDep = fl ? fl.dvMag : sel.q.dvMag, vinf = fl ? fl.flown.v_infinity_m_s : sel.q.vinfMag;
      var bu = burnsOf(dvDep, vinf, S);
      R.dvBasis = fl ? 'n_body' : 'patched_conic';
      R.burns = bu; R.entry = { speed_m_s: entrySpeed(bu.vinfAfter, S.entryAlt_m), before_braking_m_s: entrySpeed(vinf, S.entryAlt_m), limit_m_s: S.entryLimit_m_s, altitude_m: S.entryAlt_m };
      if (!B) return;
      var wait = sel.depTdb - R.src.stayEnd, mMax = materialMax(B, wait, sel.tofS, bu), cap = num(B.cap) ? B.cap : null;
      var chosen = S.material === 'max' ? Math.max(0, cap === null ? mMax : Math.min(mMax, cap)) : S.material;
      var L = ledger(B, wait, sel.tofS, bu, chosen);
      R.mass = { material_max_kg: mMax, material_available_kg: cap, material_kg: mMax >= 0 ? chosen : null, ledger: mMax >= 0 ? L : ledger(B, wait, sel.tofS, bu, 0), capacity_m_s: capacity(B, wait), limited_by: cap !== null && mMax > cap ? 'material' : 'propellant' };
      if (!(mMax >= 0)) R.refusals.push(refusal('out_of_envelope', 'The craft cannot get home on this window even empty: it needs ' + fmt(bu.dv1 + bu.dv2, 4) + ' m/s (with margin) and its propellant gives ' + fmt(R.mass.capacity_m_s, 4) + ' m/s on ' + fmt(B.dry, 5) + ' kg dry.', 'A cheaper window (the porkchop), more propellant (idea 46: more arrays or a longer stay), or a lighter craft.', { applies_to: 'return' }));
      else if (S.material !== 'max' && S.material > mMax) R.refusals.push(refusal('out_of_envelope', fmt(S.material, 5) + ' kg of material is more than the propellant can push home on this window (' + fmt(mMax, 5) + ' kg).', 'Less material or a cheaper window.', { applies_to: 'material' }));
      else if (S.material !== 'max' && cap !== null && S.material > cap) R.refusals.push(refusal('out_of_envelope', fmt(S.material, 5) + ' kg is more than idea 45 dug (' + fmt(cap, 5) + ' kg).', 'Less material, or a longer stay at idea 45.', { applies_to: 'material' }));
    }
    function ownRefusals(R) {
      var S = R.S, src = R.src;
      src.refusals46.forEach(function (r) { R.refusals.push(r); });
      R.refusals.push(refusal('insufficient_data', 'The asteroid\'s orbit is Aster\'s elements (epoch ' + K39.tdbDateOfJd(src.body.elements.epochTdbJd) + ') integrated through idea 40\'s forces, without Yarkovsky or asteroid perturbers and without its orbit uncertainty. JPL\'s NHATS return legs, computed with JPL\'s own ephemerides, are the check (this page\'s reality table): the gap grows after an Earth encounter.', 'JPL\'s SPK for the body and its covariance (Horizons, or the Small-Body Database).', { applies_to: 'asteroid_ephemeris' }));
      R.refusals.push(refusal('insufficient_data', 'The asteroid\'s own gravity is left out of the departure burn and the craft leaves from its centre of mass.', 'The escape speed from the stand-off (idea 43\'s field) added to the burn.', { applies_to: 'asteroid_gravity' }));
      R.refusals.push(refusal('insufficient_data', 'The return\'s navigation is not analysed: the departure burn carries Aster\'s ' + fmt(S.margin * 100, 3) + ' % margin and ' + (S.tcm === 'execution' ? 'one correction the size of its own 3-sigma execution error (Lucy\'s 30 mm/s + 4 %, idea 40)' : fmt(S.tcm, 4) + ' m/s for corrections') + '; orbit-determination errors and the TCMs that cut them are not budgeted.', 'A covariance analysis of the return like idea 40\'s for the outbound (its 116.6 m/s was mostly the launcher\'s injection error, which does not apply here).', { applies_to: 'navigation' }));
      if (src.material_available_kg === null && src.from === '46-split') R.refusals.push(refusal('insufficient_data', 'How much material was collected is not in this handoff (idea 45\'s output is not carried whole inside it), so the material home is limited by the propellant only.', 'Idea 46\'s handoff with idea 45\'s handoff inside it unpruned.', { applies_to: 'material_available' }));
      if (src.from === 'custom') R.refusals.push(refusal('insufficient_data', 'Stand-alone craft: the propellant, Isp, dry mass and boil-off are typed in, not made by the chain.', 'Idea 46\'s handoff.', { applies_to: 'craft' }));
      R.refusals.push(refusal('insufficient_data', 'No structure, container or heat shield is counted for the material: the craft\'s dry mass is idea 46\'s, and whatever holds the material home (and protects it at entry, module 49) is not on file.', 'A container and capsule mass (OSIRIS-REx\'s and Hayabusa2\'s capsules are the flown references).', { applies_to: 'material_structure' }));
      if (R.sel && R.entry && S.arrival === 'handon' && R.entry.before_braking_m_s > S.entryLimit_m_s) R.refusals.push(refusal('out_of_envelope', 'Arriving at ' + fmt(R.entry.before_braking_m_s / 1000, 4) + ' km/s at ' + fmt(S.entryAlt_m / 1000, 3) + ' km, above NHATS\'s ' + fmt(S.entryLimit_m_s / 1000, 3) + ' km/s entry limit: as handed on, it needs braking, aerocapture or a catch.', 'Module 48 (Catch) compares the options; or brake here to the limit (NHATS\'s rule).', { applies_to: 'entry_speed' }));
      if (R.sel && R.flight && !R.flight.converged && R.flight.refusal) R.refusals.push(R.flight.refusal);
      if (R.sel && !S.nbody) R.refusals.push(refusal('insufficient_data', 'Patched conics only: the return has not been flown through the planets (the n-body check is off), so the delta-v is the Sun-only Lambert value.', 'Turn the n-body check on.', { applies_to: 'dynamics' }));
    }

    // -------------------------------------------------------------- checks against reality (computed live)
    function nhatsChecks() {
      var cols = O.nhats_columns, rows = [];
      O.nhats.forEach(function (a) {
        var t = {}; cols.forEach(function (c, i) { t[c.split(' ')[0]] = a[i]; });
        var b = K39.findBody(t.des); if (!b) return;
        var tDep = Date.parse(t.launch + 'T00:00:00Z') / 1000 - C.unixToJ2000Days * DAY + (t.dur_out + t.dur_at) * DAY, tof = t.dur_ret * DAY;   // NHATS dates read as 0h TDB
        if (!inSpan(tDep) || !inSpan(tDep + tof)) return;
        var eph = ephemeris(b), c = cell(eph, tDep, tof, [0]); if (!c.ok) return;
        var q = c.sols[0], vmax = vinfMax(NHQ.entryLimit_m_s, NHQ.entryAltitude_m);
        var vNh = t.v_arr_earth < NHQ.entryLimit_m_s / 1000 - 5e-4 ? Math.sqrt(Math.pow(t.v_arr_earth * 1000, 2) - 2 * MU_E / (RE + NHQ.entryAltitude_m)) : vmax + t.vrel_arr_earth * 1000;
        var A2 = K39.bodyState(b, tDep), L2 = A2 ? LR.lambert(A2.r, c.earth.r, tof, MU_SUN, { revs: [0] }) : null, dv2 = L2 && L2.sols[0].converged ? norm(sub(L2.sols[0].v1, A2.v)) : null;
        rows.push({ des: t.des, tid: t.tid, departure: utc(tDep), tof_days: t.dur_ret, dv_m_s: q.dvMag, dv_nhats_m_s: t.vrel_dep_neo * 1000, vinf_m_s: q.vinfMag, vinf_nhats_m_s: vNh,
          dec_deg: q.decDeg, dec_nhats_deg: t.dec_arr, entry_m_s: entrySpeed(q.vinfMag, NHQ.entryAltitude_m), braked: t.vrel_arr_earth > 0, dv_two_body_m_s: dv2, vrel_arr_neo_m_s: t.vrel_arr_neo * 1000 });
      });
      return rows;
    }
    function stats(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return { n: s.length, median: s.length ? s[Math.floor((s.length - 1) / 2)] / 2 + s[Math.ceil((s.length - 1) / 2)] / 2 : null, max: s.length ? s[s.length - 1] : null }; }
    /** OSIRIS-REx: Lambert from Bennu's Horizons state just after the departure burn to the Earth at the flown perigee,
     * against JPL's reconstruction of what the spacecraft did. */
    function osirisRexCheck() {
      var X = O.osiris_rex, k = 1, sc = X.craft_helio_adm[k], bn = X.bennu_helio_adm[k], before = X.craft_helio_adm[0], bn0 = X.bennu_helio_adm[0];
      var km = function (a) { return scale(a, 1000); }, tAdm = K39.jdTdbToTdb(sc.jd_tdb);
      var actual = sub(km(sc.v_km_s), km(bn.v_km_s)), pre = sub(km(before.v_km_s), km(bn0.v_km_s));
      // the last hourly approach row still bound for the atmosphere (osculating perigee below the entry altitude):
      // after it the capsule is released and the spacecraft diverts to fly by
      var g = null, rp = null;
      X.craft_geo_arrival.forEach(function (row) {
        var r1 = km(row.r_km), v1 = km(row.v_km_s), en1 = dot(v1, v1) / 2 - MU_E / norm(r1), a1 = -MU_E / (2 * en1), h1 = cross(r1, v1), e1 = Math.sqrt(1 + 2 * en1 * dot(h1, h1) / (MU_E * MU_E));
        if (a1 * (1 - e1) < RE + ENTRY_ALT) { g = row; rp = a1 * (1 - e1); }
      });
      var tg = K39.jdTdbToTdb(g.jd_tdb), r = km(g.r_km), v = km(g.v_km_s), rn = norm(r), en = dot(v, v) / 2 - MU_E / rn, a = -MU_E / (2 * en), hv = cross(r, v), e = Math.sqrt(1 + 2 * en * dot(hv, hv) / (MU_E * MU_E));
      var F = -Math.acosh((1 - rn / a) / e), n = Math.sqrt(MU_E / Math.pow(-a, 3)), tp = tg + (-(e * Math.sinh(F) - F)) / n;
      var bp = bplaneOf({ r: r, v: v, t: tp });
      var E = X.earth_helio_arrival, i0 = Math.floor((K39.jdTdbToTdb(E[0].jd_tdb) <= tp ? (tp - K39.jdTdbToTdb(E[0].jd_tdb)) / HOUR : 0)), e0 = E[i0], e1 = E[i0 + 1];
      var u = (tp - K39.jdTdbToTdb(e0.jd_tdb)) / HOUR, re = [0, 1, 2].map(function (c) { return 1000 * ((1 - u) * e0.r_km[c] + u * e1.r_km[c]); }), ve = [0, 1, 2].map(function (c) { return 1000 * ((1 - u) * e0.v_km_s[c] + u * e1.v_km_s[c]); });
      var L = LR.lambert(km(bn.r_km), re, tp - tAdm, MU_SUN, { maxRevs: 2 }), best = null;
      L.sols.forEach(function (q) { if (!q.converged) return; var dv = sub(q.v1, km(bn.v_km_s)); if (!best || norm(dv) < norm(best.dv)) best = { M: q.M, branch: q.branch, dv: dv, vinf: sub(q.v2, ve) }; });
      return { adm_tdb: tAdm, perigee_tdb: tp, tof_days: (tp - tAdm) / DAY, actual_dv_m_s: norm(actual), before_dv_m_s: norm(pre), lambert_dv_m_s: norm(best.dv), dv_angle_deg: Math.acos(dot(best.dv, actual) / (norm(best.dv) * norm(actual))) / DEG,
        actual_vinf_m_s: bp.vinf, lambert_vinf_m_s: norm(best.vinf), actual_dec_deg: Math.asin(bp.S[2]) / DEG, lambert_dec_deg: Math.asin(best.vinf[2] / norm(best.vinf)) / DEG,
        actual_perigee_alt_m: rp - RE, approach_row_tdb: g.cal_tdb, M: best.M, branch: best.branch, earth_interp: 'linear between hourly Horizons rows' };
    }
    function apophisCheck() {
      var b = K39.findBody('99942'), eph = ephemeris(b), J = O.apophis2029, tJ = K39.jdTdbToTdb(J.jd_tdb);
      var en = encounters(eph, tJ - 5 * DAY, tJ + 5 * DAY)[0];
      return { jpl: { tdb: tJ, distance_m: J.dist_au * C.au_m, v_infinity_m_s: J.v_inf_km_s * 1000, v_rel_m_s: J.v_rel_km_s * 1000 }, here: en };
    }
    var CHECKS = null;
    function reality() {
      if (CHECKS) return CHECKS;
      var rows = nhatsChecks(), d = rows.map(function (q) { return Math.abs(q.dv_m_s - q.dv_nhats_m_s); }), vi = rows.map(function (q) { return Math.abs(q.vinf_m_s - q.vinf_nhats_m_s); }), dc = rows.map(function (q) { return Math.abs(q.dec_deg - q.dec_nhats_deg); });
      var tb = rows.filter(function (q) { return num(q.dv_two_body_m_s); }).map(function (q) { return Math.abs(q.dv_two_body_m_s - q.dv_nhats_m_s); });
      var sym = rows.map(function (q) { return q.dv_nhats_m_s / q.vrel_arr_neo_m_s; });
      CHECKS = { nhats: rows, nhatsStats: { dv: stats(d), vinf: stats(vi), dec: stats(dc), twoBody: stats(tb), symmetric: stats(sym), symMin: Math.min.apply(null, sym) }, osirisRex: osirisRexCheck(), apophis: apophisCheck(), outbound: OUT };
      return CHECKS;
    }

    // -------------------------------------------------------------- the handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function buildHandoff(R, produced) {
      if (!R || R.refusal || !R.sel) return null;
      var S = R.S, sel = R.sel, q = sel.q, c = sel.cell, src = R.src, fl = R.flight && R.flight.converged ? R.flight : null, M = R.mass;
      var conf = src.from === 'custom' ? 'assumed' : (src.refusals46.some(function (r) { return r.applies_to === 'water'; }) ? 'assumed' : 'derived');
      var inputs = { split_handoff: src.from === '46-split' ? (CHAIN && JSON.stringify(src.h46) === JSON.stringify(CHAIN) ? digest(src.h46) : src.h46) : null, settings: settingsOut(R) };
      var el = LR.elementsOf(c.asteroid.r, q.v1, MU_SUN), ve = K39.toEcliptic(cross(c.asteroid.r, q.v1));
      var out = {
        earth_arrival: qv({ utc: fl ? utc(fl.flown.perigee_tdb) : utc(sel.arrTdb), tdb_s_past_j2000: fl ? fl.flown.perigee_tdb : sel.arrTdb, basis: fl ? 'n_body perigee (idea 40 forces)' : 'patched conic (Earth centre)',
          v_infinity_m_s: r9(fl ? fl.flown.v_infinity_m_s : q.vinfMag), v_infinity_vector_m_s: rv(fl ? fl.flown.v_infinity_vector_m_s : q.vinf), declination_deg: r9(fl ? fl.flown.dec_deg : q.decDeg), right_ascension_deg: r9(fl ? fl.flown.ra_deg : q.raDeg),
          perigee_altitude_m: fl ? r9(fl.flown.perigee_altitude_m) : null, perigee_state_geocentric: fl ? { r_m: rv(fl.flown.r_geo_m), v_m_s: rv(fl.flown.v_geo_m_s) } : null,
          entry_speed_m_s: r9(R.entry.speed_m_s), entry_speed_before_braking_m_s: r9(R.entry.before_braking_m_s), entry_altitude_m: S.entryAlt_m, entry_limit_m_s: S.entryLimit_m_s, braking_m_s: r9(R.burns.dv2),
          v_infinity_after_braking_m_s: r9(R.burns.vinfAfter), patched_conic: { utc: utc(sel.arrTdb), tdb_s_past_j2000: sel.arrTdb, v_infinity_m_s: r9(q.vinfMag), v_infinity_vector_m_s: rv(q.vinf), declination_deg: r9(q.decDeg) }, frame: 'geocentric ICRF/J2000 axes; TDB' },
          'm/s, m, deg, s', 'derived', KERNEL + ' run(): idea 39\'s Lambert to the Earth\'s centre, then (when converged) flown through idea 40\'s forces and re-aimed to the perigee'),
        return_transfer: qv({ departure_utc: utc(sel.depTdb), departure_tdb_s_past_j2000: sel.depTdb, time_of_flight_s: sel.tofS, arrival_utc: utc(sel.arrTdb), revolutions: sel.fam.M, branch: sel.fam.branch,
          transfer_angle_deg: r9(c.theta / DEG), selected_by: sel.source, objective: S.objective, wait_days: r9((sel.depTdb - src.stayEnd) / DAY),
          departure_dv_m_s: r9(q.dvMag), departure_dv_vector_m_s: rv(q.dv), asteroid_state: { r_m: rv(c.asteroid.r), v_m_s: rv(c.asteroid.v) }, craft_after_burn_v_m_s: rv(q.v1), earth_state_at_arrival: { r_m: rv(c.earth.r), v_m_s: rv(c.earth.v) },
          transfer_orbit: { a_m: r9(el.a), e: r9(el.e), i_ecliptic_deg: r9(Math.acos(ve[2] / norm(ve)) / DEG), perihelion_m: r9(el.q), aphelion_m: r9(el.Q) },
          rides_encounter: R.ride ? { utc: R.ride.utc, distance_m: r9(R.ride.distance_m), v_infinity_m_s: r9(R.ride.v_infinity_m_s) } : null, frame: 'heliocentric ICRF/J2000 axes, Sun centre; TDB' },
          's, m, m/s, deg', 'derived', KERNEL + ' grid()/refine(): idea 39\'s Lambert from the asteroid (idea 40\'s n-body ephemeris) to idea 39\'s Earth'),
        nbody_check: qv(R.flight ? { converged: R.flight.converged, dv_m_s: r9(R.flight.dvMag), dv_vector_m_s: rv(R.flight.dv), patched_conic_dv_m_s: r9(R.flight.patchedMag), gap_m_s: r9(R.flight.dvMag - R.flight.patchedMag),
          aim_perigee_altitude_m: S.aimAlt_m, iterations: R.flight.iterations, uncorrected: { perigee_altitude_m: r9(R.flight.uncorrected.perigee_altitude_m), perigee_utc: utc(R.flight.uncorrected.perigee_tdb), b_m: r9(R.flight.uncorrected.b_m) },
          flown: { perigee_altitude_m: r9(R.flight.flown.perigee_altitude_m), perigee_utc: utc(R.flight.flown.perigee_tdb), v_infinity_m_s: r9(R.flight.flown.v_infinity_m_s), b_m: r9(R.flight.flown.b_m) },
          two_body_asteroid: R.twoBody ? { offset_m: r9(R.twoBody.offset_m), dv_m_s: r9(R.twoBody.dv_m_s) } : null } : null,
          'm/s, m', 'derived', KERNEL + ' fly(): idea 40\'s integrator (Sun, planets, Moon, Earth J2, relativity), B-plane Newton from the asteroid'),
        mass: qv(M ? { basis: R.dvBasis, dv_departure_used_m_s: r9(R.burns.dv1), dv_braking_used_m_s: r9(R.burns.dv2), margin: S.margin, capacity_m_s: r9(M.capacity_m_s), dry_kg: r9(src.dry_kg),
          material_kg: M.material_kg === null ? null : r9(M.material_kg), material_max_kg: r9(M.material_max_kg), material_available_kg: M.material_available_kg === null ? null : r9(M.material_available_kg), limited_by: M.limited_by,
          propellant_stay_end_kg: r9(src.fuel_kg + src.ox_kg), boiloff_wait_kg: r9(M.ledger.boiloff_wait_kg), burned_departure_kg: r9(M.ledger.burned_departure_kg), boiloff_cruise_kg: r9(M.ledger.boiloff_cruise_kg),
          burned_braking_kg: r9(M.ledger.burned_braking_kg), propellant_arrival_kg: { fuel: r9(M.ledger.fuel_arrival_kg), oxidizer: r9(M.ledger.ox_arrival_kg) }, mass_departure_kg: r9(M.ledger.mass_departure_kg), mass_arrival_kg: r9(M.ledger.mass_arrival_kg),
          hold: S.hold, boiloff_rates_kg_per_day: { fuel: B0(src).fuel, oxidizer: B0(src).ox, applied: S.hold === 'passive' } } : null, 'kg, m/s', conf, KERNEL + ' ledger(): Tsiolkovsky with idea 46\'s exhaust speed, burned at its mixture ratio, boil-off at its passive rates'),
        propulsion: qv(src.propellant_kg === null ? null : { route: src.route, fuel: src.fuelName || null, oxidizer: src.oxName || null, mixture_ratio: src.of, isp_s: src.isp_s, ve_m_s: src.ve_m_s }, 's, m/s', src.from === 'custom' ? 'assumed' : 'derived', src.from === 'custom' ? 'typed in (stand-alone)' : 'idea 46 propellant, passed through'),
        asteroid: qv({ designation: src.body.designation, name: src.body.name, ephemeris: 'Aster elements (epoch JD ' + src.body.elements.epochTdbJd + ' TDB) integrated by idea 40', encounters: (R.encounters || []).map(function (e) { return { utc: e.utc, distance_m: r9(e.distance_m), v_infinity_m_s: r9(e.v_infinity_m_s) }; }) }, 'm, m/s', 'derived', KERNEL + ' encounters()'),
        porkchop: qv({ departure_first_utc: utc(R.grid.deps[0]), departure_last_utc: utc(R.grid.deps[R.grid.nDep - 1]), tof_min_s: R.grid.tofs[0], tof_max_s: R.grid.tofs[R.grid.nTof - 1], n_departure: R.grid.nDep, n_time_of_flight: R.grid.nTof,
          solved: R.grid.solved, unsolved: R.grid.unsolved, excluded: R.grid.excluded, best_cell: R.grid.best ? { departure_utc: utc(R.grid.best.depTdb), tof_s: R.grid.best.tofS, value: r9(R.grid.best.value) } : null }, 's', 'derived', KERNEL + ' grid()'),
      };
      return { handoff: 'long-way-round', version: 1, from: '47-way-home', produced: produced || new Date().toISOString(), inputs: inputs, outputs: out, refusals: R.refusals.map(function (r) { var o = clone(r); if (!o.from) o.from = '47-way-home'; return o; }),
        assumptions: [
          'Time TDB inside (UTC = TDB - 69.184 s); heliocentric ICRF/J2000 axes; declinations from the ICRF equator.',
          'The asteroid: Aster\'s elements integrated through idea 40\'s forces (no Yarkovsky, no asteroid perturbers). The Earth: idea 39\'s fit of Aster\'s Horizons file.',
          'The return: one impulsive burn at the asteroid (Lambert to the Earth\'s centre); the craft leaves from the asteroid\'s centre of mass; ' + (R.flight ? 'flown through every force and re-aimed to a perigee of ' + fmt(S.aimAlt_m / 1000, 4) + ' km.' : 'not flown (patched conic).'),
          'Mass: Tsiolkovsky at idea 46\'s exhaust speed, burned at its mixture ratio (left-over oxidizer is carried as dead mass), with Aster\'s ' + fmt(S.margin * 100, 3) + ' % delta-v margin and ' + (S.tcm === 'execution' ? 'one correction the size of the burn\'s 3-sigma execution error' : S.tcm + ' m/s of corrections') + '; boil-off ' + (S.hold === 'held' ? 'held at zero by the coolers' : 'at idea 46\'s passive rates while waiting and on the way') + '.',
          'Entry: v_entry = sqrt(v_inf^2 + 2 mu / (R_E + ' + fmt(S.entryAlt_m / 1000, 4) + ' km)) with DE440\'s R_E; NHATS\'s limit ' + fmt(S.entryLimit_m_s / 1000, 4) + ' km/s; braking (when chosen) lowers v_inf far from the Earth, as NHATS\'s Earth return dV does.'] };
    }
    function B0(src) { return src.boil || { fuel: 0, ox: 0 }; }
    function settingsOut(R) {
      var S = clone(R.S0);
      if (!S.selection && R.sel) S.selection = { depTdb: R.sel.depTdb, tofS: R.sel.tofS, M: R.sel.fam.M, branch: R.sel.fam.branch, source: R.sel.source };
      return S;
    }
    // Read-back tolerances. Patched-conic numbers are compared tightly (epochs to 1 ms, positions to 100 m, the rest to
    // 1e-9). The n-body numbers come out of a Newton search stopped at 1 km, and two JavaScript engines land on
    // different iterates inside it (measured, Chromium against Node: 8 m of perigee altitude, 13 m of perigee position,
    // 0.013 m/s of perigee velocity, 1e-6 of the burn's components): they are compared to the targeting tolerance.
    var EPOCH_TOL_S = 1e-3;
    function tolOf(p, a, b) {
      var m = Math.max(Math.abs(a), Math.abs(b));
      if (/perigee_state_geocentric\.v_m_s/.test(p)) return 1;
      if (/perigee_altitude_m|\.b_m$|perigee_state_geocentric\.r_m/.test(p)) return 1000;
      if (/(earth_arrival|nbody_check)\.value\.tdb_s_past_j2000$/.test(p)) return 0.1;
      if (/tdb|tof|time_of_flight/.test(p)) return EPOCH_TOL_S;
      if (/r_m|asteroid_state|earth_state/.test(p) && m > 1e5) return Math.max(100, 1e-9 * m);
      if (/nbody_check|earth_arrival|mass/.test(p)) return 1e-5 * m;
      return 1e-9 * Math.max(m, 1e-12);
    }
    function numDiff(a, b, p) {
      if (typeof a === 'number' || typeof b === 'number') {
        if (!(typeof a === 'number' && typeof b === 'number')) return p;
        return Math.abs(a - b) <= tolOf(p, a, b) ? null : p;
      }
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : p;
      var ks = {}; Object.keys(a).forEach(function (k) { ks[k] = 1; }); Object.keys(b).forEach(function (k) { ks[k] = 1; });
      for (var k in ks) {
        if (/utc$/.test(k) && typeof a[k] === 'string' && typeof b[k] === 'string') { if (Math.abs(Date.parse(a[k]) - Date.parse(b[k])) > (/perigee|earth_arrival\.value$/.test(p + '.' + k) || /earth_arrival\.value\.utc$/.test(p + '.' + k) ? 100 : 1)) return p + '.' + k; continue; }
        var d = numDiff(a[k], b[k], p + '.' + k); if (d) return d;
      }
      return null;
    }
    function codes(L) { return (L || []).map(function (r) { return (r.from || '') + ':' + r.code + '/' + (r.applies_to || ''); }).sort().join(','); }
    /** Read a handoff: idea 46's (imported) or this page's (re-run from its inputs and compared). */
    function parseHandoff(input) {
      var h = input;
      if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { return bad('That is not JSON.'); } }
      if (!h || h.handoff !== 'long-way-round') return bad('That is not a Long Way Round handoff.');
      if (h.from === '46-split') { var s = importSplit(h); return s.refusal ? s : { from: '46-split', split: h, src: s }; }
      if (h.from !== '47-way-home') return bad('This is a handoff from ' + h.from + '; this page takes idea 46\'s or its own.');
      if (h.version !== 1) return bad('Version ' + h.version + ' is not one this page reads.');
      var I = h.inputs || {}, sp = I.split_handoff, S = I.settings;
      if (!S) return bad('This handoff carries no settings.');
      if (sp && sp.pruned) { if (!CHAIN || sp.sha256 !== CHAIN_DIGEST) return { refusal: refusal('not_found', 'Its idea 46 handoff is carried as a digest that matches none bundled here (only the chain\'s sample is).', 'The handoff with idea 46\'s handoff inside it whole.', { applies_to: 'split_handoff' }) }; sp = CHAIN; }
      var R = run(S, S.case === 'custom' ? null : { split: sp });
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced); if (!again) return bad('Its inputs no longer give a return.');
      var keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) { var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i]); if (d) return bad('The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.'); }
      if (codes(h.refusals) !== codes(again.refusals)) return bad('The handoff\'s refusals are not the ones its inputs give: it was edited.');
      return { from: '47-way-home', h47: h, split: sp, settings: S, R: R };
    }
    function b64urlEncode(s) { var b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function b64urlDecode(s) { var b = s.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8'); }

    return {
      K40: K40, K39: K39, constants: C, SPAN: SPAN, ENTRY_LIMIT: ENTRY_LIMIT, ENTRY_ALT: ENTRY_ALT, RE: RE, MU_E: MU_E, OBJECTIVES: OBJECTIVES, EXEC: EXEC, chain: CHAIN, oracles: O, outbound: OUT,
      ephemeris: ephemeris, encounters: encounters, cell: cell, exclusion: exclusion, entrySpeed: entrySpeed, vinfMax: vinfMax, budgetOf: budgetOf, burnsOf: burnsOf, ledger: ledger, materialMax: materialMax, capacity: capacity, tcmOf: tcmOf,
      grid: grid, rides: rides, refine: refine, approach: approach, bplaneOf: bplaneOf, fly: fly, importSplit: importSplit, customSource: customSource, customDefaults: customDefaults,
      defaults: defaults, validSettings: validSettings, run: run, reality: reality, nhatsChecks: nhatsChecks, osirisRexCheck: osirisRexCheck, apophisCheck: apophisCheck,
      buildHandoff: buildHandoff, parseHandoff: parseHandoff, numDiff: numDiff, digest: digest, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode, findBody: findBody
    };
  }

  return { create: create, sha256: sha256, digest: digest, KERNEL: KERNEL };
});
