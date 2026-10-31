/* Signal: talking to the spacecraft all mission. Idea 41 of the Aster Idea Bank, module 11 of "The Long Way Round".
 *
 * Idea 40 flew the cruise to the asteroid through the real solar system. This module asks what the ground hears from
 * it, every day from the departure to the end of a stay at the asteroid: how far it is and how long its signal takes
 * (one-way and round trip, Newtonian light time iterated on the ephemerides), where it sits in the sky against the Sun
 * (Sun-Earth-probe angle, and the ray's closest approach to the Sun), which Deep Space Network complex sees it and for
 * how long, and what an X- or Ka-band downlink from a real spacecraft's radio closes at: the DSN's own published gain,
 * noise-temperature and atmosphere model for each antenna and elevation, the Sun's noise in the beam near conjunction,
 * the solar corona's scintillation that stops telemetry near conjunction, and the mission's own modulation, coding and
 * rate table. It hands on the comms timeline, the conjunctions, the link at arrival and the data volume.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, W, Hz, K; decibels as dimensionless dB, dBm and dB-Hz). Time: TDB
 * seconds past J2000 (Aster's convention via idea 39; UTC = TDB - 69.184 s, UT1 = UTC). Frame: heliocentric ICRF/J2000
 * axes, Sun centre (as ideas 39 and 40); stations in ITRF93 turned by the Earth rotation angle (idea 40's model).
 *
 * Methods and where they come from (all hand-transcribed into snapshots/, cited there):
 *   Light time      down-leg Newtonian light time iterated to 1 ns (as JPL Horizons' observer tables define it).
 *   DSN antennas    810-005 module 104 Rev. Q Appendix A (34-m BWG) and 101 Rev. I (70-m): gain against elevation and
 *                   frequency, antenna-microwave noise, atmosphere loss and noise by cumulative weather distribution.
 *   Sun noise       810-005 module 105 Rev. E eqs. (10)-(11) (34-m BWG, X and Ka).
 *   Corona          810-005 module 106 Rev. B: scintillation index eq. (7) with the m >= 0.3 frame-error threshold;
 *                   electron density eq. (2) integrated along the ray for the group delay eq. (1).
 *   Spacecraft      JPL DESCANSO articles (Dawn, Juno, Deep Impact): transmitter, antenna, losses, coding, rate tables,
 *                   and, where published, each rate's required Pt/No.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Signal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, DAY = 86400, HOUR = 3600, KERNEL = '41-signal/signal.js';

  function refusal(code, reason, help, extra) { var r = { code: code, reason: reason, what_would_help: help }; if (extra) for (var k in extra) r[k] = extra[k]; return r; }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) { return num(v) ? +v.toPrecision(d || 4) + '' : String(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function angle(a, b) { return Math.atan2(norm(cross(a, b)), dot(a, b)); }
  function log10(x) { return Math.log(x) / Math.LN10; }
  function db(x) { return 10 * log10(x); }
  function lerp(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  // Gauss-Legendre, 24 nodes on [-1, 1] (abscissae and weights by Newton on P24 at load: no typed table)
  var GL = (function (n) {
    var x = [], w = [];
    for (var i = 1; i <= n; i++) {
      var z = Math.cos(PI * (i - 0.25) / (n + 0.5)), pp = 0;
      for (var it = 0; it < 100; it++) {
        var p1 = 1, p2 = 0;
        for (var j = 1; j <= n; j++) { var p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
        pp = n * (z * p1 - p2) / (z * z - 1);
        var z1 = z; z = z1 - p1 / pp; if (Math.abs(z - z1) < 1e-15) break;
      }
      x.push(z); w.push(2 / ((1 - z * z) * pp * pp));
    }
    return { x: x, w: w };
  })(24);

  // ==================================================================================================================
  function create(deps) {
    var K40 = deps.K40, K39 = K40.k39, D = deps.dsn, CR = deps.craft, P40 = deps.presets40;
    var C = D.c_m_s, KB = D.k_B, AU = K39.constants.au_m;

    // ------------------------------------------------------------------------------------------- geometry
    /**
     * What a ground station at the Earth's centre receives at tR (TDB s): the signal left the spacecraft at tR - owlt.
     * craftAt(t) and earthAt(t) return heliocentric {r, v} (m, m/s) or null. Returns range, light time, range rate,
     * Sun-Earth-probe angle, the ray's closest approach to the Sun and the equivalent elongation it implies, RA and Dec.
     */
    function downleg(tR, craftAt, earthAt) {
      var E = earthAt(tR); if (!E) return null;
      var S = craftAt(tR), tau = 0;
      if (!S) return null;
      for (var i = 0; i < 8; i++) {
        var tn = norm(sub(S.r, E.r)) / C;
        if (Math.abs(tn - tau) < 1e-9) { tau = tn; break; }
        tau = tn; S = craftAt(tR - tau); if (!S) return null;
      }
      S = craftAt(tR - tau); if (!S) return null;
      var rho = sub(S.r, E.r), d = norm(rho), u = scale(rho, 1 / d);
      var seg = sub(S.r, E.r), s = -dot(E.r, seg) / dot(seg, seg), sc = Math.max(0, Math.min(1, s)), p = norm(add(E.r, scale(seg, sc)));
      var rE = norm(E.r);
      return {
        tR: tR, tT: tR - tau, owlt_s: tau, range_m: d, rangeRate_m_s: dot(u, sub(S.v, E.v)),
        sep_deg: angle(scale(E.r, -1), rho) / DEG, spe_deg: angle(scale(S.r, -1), scale(rho, -1)) / DEG,
        impact_m: p, epsEff_deg: Math.asin(Math.min(1, p / rE)) / DEG, superior: s > 0 && s < 1,
        dec_deg: Math.asin(u[2]) / DEG, ra_deg: ((Math.atan2(u[1], u[0]) / DEG) + 360) % 360, rhoGeo: rho, earth: E, craft: S
      };
    }
    /** Round-trip light time for a signal that reaches the spacecraft at tT (s): up-leg from the Earth, down-leg back. */
    function roundTrip(tT, craftAt, earthAt) {
      var S = craftAt(tT); if (!S) return null;
      var up = 0, dn = 0, i;
      for (i = 0; i < 8; i++) { var E1 = earthAt(tT - up); if (!E1) return null; var un = norm(sub(S.r, E1.r)) / C; if (Math.abs(un - up) < 1e-9) { up = un; break; } up = un; }
      for (i = 0; i < 8; i++) { var E2 = earthAt(tT + dn); if (!E2) return null; var dd = norm(sub(S.r, E2.r)) / C; if (Math.abs(dd - dn) < 1e-9) { dn = dd; break; } dn = dd; }
      return { up_s: up, down_s: dn, rtlt_s: up + dn, sent: tT - up, back: tT + dn };
    }

    // ------------------------------------------------------------------------------------------- DSN
    function station(id) { var s = D.stations[id]; return s ? { id: id, complex: s.complex, size: s.size, xyz: s.xyz_m, X: s.X, Ka: s.Ka } : null; }
    function azen(complex, band, cd) {
      var T = D.azen_dB[band] && D.azen_dB[band][complex], c = D.azen_dB.cd;
      if (!T || !(cd >= c[0] && cd <= c[c.length - 1])) return null;
      for (var i = 0; i < c.length - 1; i++) if (cd <= c[i + 1]) return T[i] + (T[i + 1] - T[i]) * (cd - c[i]) / (c[i + 1] - c[i]);
      return T[T.length - 1];
    }
    /** 810-005 104 Appendix A (34 m) and 101 (70 m): vacuum gain at f and elevation, atmosphere loss, noise parts. */
    function dsnRx(id, band, elDeg, cd, fHz) {
      var st = D.stations[id];
      if (!st) return { refusal: refusal('not_found', 'No station ' + id + '.', 'A DSN station in the snapshot.') };
      var p = st[band];
      if (!p) return { refusal: refusal('out_of_envelope', id + ' has no ' + band + '-band receive model in 810-005 (' + (st.size === 70 ? '70-m antennas receive S and X only' : 'not equipped') + ').', 'X band, or a 34-m BWG station with Ka.', { applies_to: 'band' }) };
      if (!(elDeg >= 6 && elDeg <= 90)) return { refusal: refusal('out_of_envelope', 'Elevation ' + fmt(elDeg, 3) + ' deg is outside the model (6 to 90 deg, 810-005 104 Appendix A).', 'A pass above 6 deg.', { applies_to: 'elevation' }) };
      var f0 = band === 'Ka' ? D.f0_Hz.Ka34 : (st.size === 70 ? D.f0_Hz.X70 : D.f0_Hz.X34);
      var A0 = azen(st.complex, band, cd);
      if (A0 === null) return { refusal: refusal('out_of_envelope', 'Weather CD ' + cd + ' is outside the tabulated 0 to 0.90.', 'A cumulative distribution between 0 and 0.90.', { applies_to: 'weather' }) };
      var sinEl = Math.sin(elDeg * DEG), A = A0 / sinEl, L = Math.pow(10, A / 10), Tp = D.Tp.base_K + D.Tp.perCD_K * cd;
      var gainVac = p.G0 + 20 * log10(fHz / f0) - p.G1 * (elDeg - p.gamma) * (elDeg - p.gamma);
      var Tamw = p.T1 + p.T2 * Math.exp(-p.a * elDeg), Tatm = Tp * (1 - 1 / L), Tcmb = D.Tcmb_K / L;
      return { gainVac_dBi: gainVac, atm_dB: A, azen_dB: A0, Tamw_K: Tamw, Tatm_K: Tatm, Tcmb_K: Tcmb, Tp_K: Tp, size: st.size, complex: st.complex };
    }
    /** 105 Rev. E eqs. (10)-(11): the Sun's noise in a 34-m BWG beam pointed sepDeg from the Sun's centre. */
    function sunNoise(band, sepDeg, size) {
      var s = D.sunNoise;
      if (sepDeg > s.negligibleBeyond_deg) return { T_K: 0 };
      if (size === 70) return { refusal: refusal('insufficient_data', 'Within ' + s.negligibleBeyond_deg + ' deg of the Sun the 70-m antenna\'s solar noise is given only as a curve (810-005 105 Figure 19), not an expression.', 'A 34-m BWG station, or the 70-m noise curve digitised.', { applies_to: 'sun_noise' }) };
      if (sepDeg < s.minValid_deg) return { refusal: refusal('out_of_envelope', 'At ' + fmt(sepDeg, 3) + ' deg from the Sun\'s centre the solar noise is "likely in excess of 300 K" (810-005 105 section 2.4.1): no expression covers it.', 'Wait for the Sun-Earth-probe angle to exceed ' + s.minValid_deg + ' deg.', { applies_to: 'sun_noise' }) };
      var c = sepDeg <= s.split_deg ? s[band].inner : s[band].outer;
      return { T_K: c[0] * Math.exp(-c[1] * sepDeg) };
    }
    /** 106 Rev. B eq. (7): solar scintillation index at elongation epsDeg (1 below the saturation angle). */
    function scintillation(band, epsDeg) {
      var s = D.scintillation[band], x = Math.abs(epsDeg) - s.et;
      if (x < 0) return { m: 1, valid: true };
      var a = s.a, m = Math.exp(-a[0] * x) + a[1] + a[2] * x + a[3] * x * x;
      return { m: Math.max(0, Math.min(1, m)), valid: x < D.scintillation.validBelow_deg };
    }
    /** 106 Rev. B eq. (2) integrated along the straight ray from rA to rB (heliocentric, m): slant electrons per m^2. */
    function stec(rA, rB) {
      var K = D.corona, seg = sub(rB, rA), Lseg = norm(seg), u = scale(seg, 1 / Lseg);
      var xA = dot(rA, u), foot = sub(rA, scale(u, xA)), pf = Math.max(norm(foot), 1);   // rA = foot + xA u: positions along u from the foot
      var xa = xA, xb = xA + Lseg, pa = Math.atan(xa / pf), pb = Math.atan(xb / pf), sum = 0;
      function Ne(r) { var q = r / K.R0_m; return K.n1 * Math.pow(q, -K.p1) + K.n2 * Math.pow(q, -K.p2); }
      // x = pf tan(phi): dx = pf sec^2(phi) dphi, r = pf sec(phi); split at phi = 0 when the foot is inside
      var pieces = (pa < 0 && pb > 0) ? [[pa, 0], [0, pb]] : [[pa, pb]];
      pieces.forEach(function (pc) {
        var h = (pc[1] - pc[0]) / 2, m = (pc[1] + pc[0]) / 2;
        for (var i = 0; i < GL.x.length; i++) { var ph = m + h * GL.x[i], cs = Math.cos(ph); sum += GL.w[i] * h * Ne(pf / cs) * pf / (cs * cs); }
      });
      return sum;
    }
    function coronaDelay_s(stecVal, fHz) { var f = fHz / 1e9; return D.corona.delayCoef_us_GHz2 * stecVal / (f * f) * 1e-6; }

    // ------------------------------------------------------------------------------------------- the spacecraft's radio
    var CRAFT_KEYS = Object.keys(CR.presets);
    function presetRates(P, ranging) {
      if (P.rates && P.rates[0].length === 3) return P.rates.map(function (r) { return { bps: r[0], modDeg: r[1], loopHz: r[2], reqPtN0: null }; });
      if (P.ratesNoRanging) return (ranging ? P.rates : P.ratesNoRanging).map(function (r) { return { bps: r[1], nominal: r[0], modDeg: r[2], loopHz: P.loopBW_Hz, reqPtN0: r[3] }; });
      return P.rates.map(function (r) { return { bps: r[0], modDeg: r[1], loopHz: P.loopBW_Hz, reqPtN0: ranging ? r[3] : r[2] }; });
    }
    /** The radio the settings describe: a preset's, with its power, dish size and band changed as asked. */
    function radio(S) {
      var P = CR.presets[S.craft];
      if (!P) return { refusal: refusal('invalid_input', 'No spacecraft preset "' + S.craft + '".', 'One of ' + CRAFT_KEYS.join(', ') + '.') };
      var ka = S.band === 'Ka', fHz = ka ? D.f0_Hz.Ka34 : P.f_Hz;
      var gain = P.gain_dBi + 20 * log10(S.diameter_m / P.diameter_m) + (ka ? 20 * log10(fHz / P.f_Hz) : 0);
      var rates = presetRates(P, S.ranging), top = rates[rates.length - 1];
      return {
        rateMode: S.rateMode, decoderMax_bps: D.decoderMax_bps[P.decoder], topModDeg: top.modDeg, topLoopHz: top.loopHz,
        key: S.craft, name: P.name, article: P.article, f_Hz: fHz, band: S.band, Pt_dBm: db(S.power_W * 1000), power_W: S.power_W, circuitLoss_dB: P.circuitLoss_dB,
        gain_dBi: gain, diameter_m: S.diameter_m, polLoss_dB: P.polLoss_dB, losses_dB: P.losses_dB, code: P.code, reqEbN0_dB: P.reqEbN0_dB,
        ranging: S.ranging ? P.ranging : null, rates: rates, maxRate_bps: rates[rates.length - 1].bps, published: rates.some(function (r) { return r.reqPtN0 !== null; }),
        presetPower_W: Math.pow(10, P.Pt_dBm / 10) / 1000, presetDiameter_m: P.diameter_m
      };
    }
    function suppression(rd, modDeg) {
      var th = modDeg * DEG, rc = rd.ranging ? rd.ranging.carrier_dB : 0, rdd = rd.ranging ? rd.ranging.data_dB : 0;
      return { carrier_dB: 20 * log10(Math.cos(th)) + rc, data_dB: 20 * log10(Math.sin(th)) + rdd, tlmCarrier_dB: 20 * log10(Math.cos(th)), tlmData_dB: 20 * log10(Math.sin(th)), rngCarrier_dB: rc, rngData_dB: rdd };
    }
    /** The Pt/No a rate needs (dB-Hz) by this model: rate + required Eb/No + losses - data suppression; and the carrier's. */
    function thresholdPtN0(rd, rate) {
      var sp = suppression(rd, rate.modDeg);
      return { data: db(rate.bps) + rd.reqEbN0_dB + rd.losses_dB - sp.data_dB, carrier: D.carrierLoopMin_dB + db(rate.loopHz) - sp.carrier_dB };
    }
    /**
     * A design control table, line by line, for range_m and the station at elDeg (TDB t only labels it). sepDeg brings
     * in the Sun's noise. Returns the lines, Pt/No, and the best rate in the radio's table that keeps margin_dB.
     */
    function linkBudget(rd, range_m, stId, elDeg, cd, sepDeg, margin_dB, scPointLoss_dB) {
      var rx = dsnRx(stId, rd.band, elDeg, cd, rd.f_Hz);
      if (rx.refusal) return { refusal: rx.refusal };
      var sun = sunNoise(rd.band, sepDeg, rx.size);
      if (sun.refusal) return { refusal: sun.refusal };
      var L = {};
      L.Pt_dBm = rd.Pt_dBm; L.circuit_dB = -rd.circuitLoss_dB; L.scGain_dBi = rd.gain_dBi; L.scPoint_dB = -(scPointLoss_dB || 0);
      L.eirp_dBm = L.Pt_dBm + L.circuit_dB + L.scGain_dBi + L.scPoint_dB;
      L.spaceLoss_dB = -20 * log10(4 * PI * range_m * rd.f_Hz / C);
      L.atm_dB = -rx.atm_dB; L.dsnGain_dBi = rx.gainVac_dBi; L.dsnPoint_dB = -D.pointingLoss_dB[rd.band]; L.pol_dB = -rd.polLoss_dB;
      L.pr_dBm = L.eirp_dBm + L.spaceLoss_dB + L.atm_dB + L.dsnGain_dBi + L.dsnPoint_dB + L.pol_dB;
      L.tAmw_K = rx.Tamw_K; L.tAtm_K = rx.Tatm_K; L.tCmb_K = rx.Tcmb_K; L.tSun_K = sun.T_K;
      L.snt_K = L.tAmw_K + L.tAtm_K + L.tCmb_K + L.tSun_K;
      L.n0_dBmHz = db(KB * L.snt_K) + 30;
      L.ptn0_dBHz = L.pr_dBm - L.n0_dBmHz;
      var best = null, rows = rd.rates.map(function (rt) {
        var th = thresholdPtN0(rd, rt), req = rt.reqPtN0 !== null ? rt.reqPtN0 : th.data, need = Math.max(req, th.carrier);
        var sp = suppression(rd, rt.modDeg);
        var row = { bps: rt.bps, modDeg: rt.modDeg, loopHz: rt.loopHz, reqPtN0_dBHz: req, reqSource: rt.reqPtN0 !== null ? 'published' : 'computed', carrierNeed_dBHz: th.carrier,
          pcn0_dBHz: L.ptn0_dBHz + sp.carrier_dB, cnr_dB: L.ptn0_dBHz + sp.carrier_dB - db(rt.loopHz), pdn0_dBHz: L.ptn0_dBHz + sp.data_dB,
          ebn0_dB: L.ptn0_dBHz + sp.data_dB - db(rt.bps), margin_dB: L.ptn0_dBHz - need };
        row.closes = row.margin_dB >= margin_dB;
        if (row.closes && (!best || rt.bps > best.bps)) best = row;
        return row;
      });
      if (rd.rateMode === 'continuous') {
        // the highest rate the link closes with margin_dB at the radio's top-rate modulation index, up to the DSN decoder
        var spc = suppression(rd, rd.topModDeg), cnr = L.ptn0_dBHz + spc.carrier_dB - db(rd.topLoopHz);
        var rmax = Math.pow(10, (L.ptn0_dBHz + spc.data_dB - rd.losses_dB - rd.reqEbN0_dB - margin_dB) / 10), capped = rmax > rd.decoderMax_bps;
        var rc = Math.min(rmax, rd.decoderMax_bps);
        best = cnr - D.carrierLoopMin_dB >= margin_dB && rc > 0 ? { bps: rc, modDeg: rd.topModDeg, loopHz: rd.topLoopHz, reqPtN0_dBHz: db(rc) + rd.reqEbN0_dB + rd.losses_dB - spc.data_dB, reqSource: 'computed', pcn0_dBHz: L.ptn0_dBHz + spc.carrier_dB, cnr_dB: cnr,
          pdn0_dBHz: L.ptn0_dBHz + spc.data_dB, ebn0_dB: L.ptn0_dBHz + spc.data_dB - db(rc), margin_dB: L.ptn0_dBHz - (db(rc) + rd.reqEbN0_dB + rd.losses_dB - spc.data_dB), closes: true, decoderCapped: capped } : null;
      }
      return { lines: L, rows: rows, best: best, station: stId, complex: rx.complex, elevation_deg: elDeg, cd: cd, size: rx.size, saturates: rx.size === 34 && L.pr_dBm > D.maxRx_dBm };
    }

    // ------------------------------------------------------------------------------------------- settings
    function defaults(craftKey, nav40) {
      var P = CR.presets[craftKey || 'dawn'];
      return { craft: craftKey || 'dawn', power_W: +(Math.pow(10, P.Pt_dBm / 10) / 1000).toPrecision(6), diameter_m: P.diameter_m, band: 'X', ranging: P.rangingDefault,
        antenna: '34m', cd: 0.9, elMin_deg: 10, margin_dB: 3, scPointLoss_dB: 0,
        passHours: nav40 ? nav40.passHours : 8, passesPerWeek: nav40 ? nav40.passesPerWeek : 3, stayDays: 365, rateMode: 'table' };
    }
    function validSettings(S) {
      var e = [];
      if (!CR.presets[S.craft]) e.push('craft must be one of ' + CRAFT_KEYS.join(', '));
      if (!(S.power_W >= 0.1 && S.power_W <= 1000)) e.push('power must be 0.1 to 1000 W');
      if (!(S.diameter_m >= 0.1 && S.diameter_m <= 6)) e.push('dish diameter must be 0.1 to 6 m');
      if (S.band !== 'X' && S.band !== 'Ka') e.push('band must be X or Ka');
      if (typeof S.ranging !== 'boolean') e.push('ranging must be true or false');
      if (S.rateMode !== 'table' && S.rateMode !== 'continuous') e.push('rate mode must be table or continuous');
      if (!D.subnets[S.antenna]) e.push('antenna must be 34m or 70m');
      if (S.antenna === '70m' && S.band === 'Ka') e.push('the 70-m antennas have no Ka-band receive model (810-005 101)');
      if (!(S.cd >= 0 && S.cd <= 0.9)) e.push('weather CD must be 0 to 0.90');
      if (!(S.elMin_deg >= 6 && S.elMin_deg <= 45)) e.push('minimum elevation must be 6 to 45 deg');
      if (!(S.margin_dB >= 0 && S.margin_dB <= 10)) e.push('margin must be 0 to 10 dB');
      if (!(S.scPointLoss_dB >= 0 && S.scPointLoss_dB <= 10)) e.push('spacecraft pointing loss must be 0 to 10 dB');
      if (!(S.passHours >= 1 && S.passHours <= 24)) e.push('pass length must be 1 to 24 h');
      if (!(S.passesPerWeek >= 0 && S.passesPerWeek <= 21)) e.push('passes a week must be 0 to 21');
      if (!(S.stayDays >= 0 && S.stayDays <= 1500 && Math.floor(S.stayDays) === S.stayDays)) e.push('stay must be a whole number of days, 0 to 1500');
      return e;
    }

    // ------------------------------------------------------------------------------------------- trajectory sources
    /** Cubic Hermite between states (the interpolant of idea 39's hermiteEphemeris), on node times T (s) by bisection. */
    function hermite(T, X) {
      var n = T.length;
      return function (t) {
        if (!(t >= T[0] - 1e-6 && t <= T[n - 1] + 1e-6)) return null;
        var lo = 0, hi = n - 1;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
        var s0 = X[lo], s1 = X[hi], dt = T[hi] - T[lo], u = Math.max(0, Math.min(1, (t - T[lo]) / dt)), u2 = u * u, u3 = u2 * u;
        var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        var d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u, r = [], v = [];
        for (var c = 0; c < 3; c++) {
          r.push(h00 * s0[c] + h10 * s0[c + 3] * dt + h01 * s1[c] + h11 * s1[c + 3] * dt);
          v.push((d00 * s0[c] + d10 * s0[c + 3] * dt + d01 * s1[c] + d11 * s1[c + 3] * dt) / dt);
        }
        return { r: r, v: v };
      };
    }
    /** The asteroid after the arrival, flown by idea 40's propagator through the same forces; every 6 h, every 15 min near the Earth. */
    function stayPath(R40, days) { return pathFrom(R40.arrival.targetR.concat(R40.arrival.targetV), R40.arrival.tdb, R40.arrival.tdb + days * DAY, R40.fm); }
    /** A body's path from heliocentric state x0 at t0 to t1 through idea 40's forces fm, as nodes T (s) and states X (m, m/s). */
    function pathFrom(x0, t0, t1, fm) {
      var x = x0.slice(0, 6), T = [t0], X = [x.slice()], t = t0, span = K40.span;
      var stop = Math.min(t1, span.end - DAY);
      while (t < stop - 1) {
        var E = K39.earthState(t), dE = E ? norm(sub(x.slice(0, 3), E.r)) : Infinity, h = dE < 3e9 ? 900 : 6 * HOUR, tn = Math.min(t + h, stop);
        var p = K40.propagate(x, t, tn, fm);
        if (p.refusal) return { refusal: p.refusal, T: T, X: X };
        x = p.x; t = tn; T.push(t); X.push(x.slice());
      }
      return { T: T, X: X, truncated: stop < t1 };
    }
    /** Idea 40's handoff, read back by idea 40's own kernel (which re-flies and re-checks it). */
    function importLongCoast(h) {
      var x = h;
      if (typeof h === 'string') { try { x = JSON.parse(h); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 40 (Long Coast) or from this page.') }; } }
      if (!x || x.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 40 (Long Coast) or from this page.') };
      if (x.from === '41-signal') return parseHandoff(x);
      if (x.from !== '40-long-coast') return { refusal: refusal('invalid_input', 'This is a handoff from ' + x.from + '; Signal takes idea 40\'s (the cruise it flew).', /^(3\d|39)-/.test(x.from) ? 'Take it through idea 40 (Long Coast) first: the link needs the flown trajectory, not a Kepler arc.' : 'A handoff from idea 40.') };
      var P = K40.parseHandoff(x);
      if (P.refusal) return { refusal: refusal('invalid_input', 'Idea 40\'s own check refuses this handoff: ' + P.refusal.reason, P.refusal.what_would_help) };
      if (!P.R || !P.R.reference || !P.R.arrival) return { refusal: refusal('insufficient_data', 'Idea 40\'s handoff carries no flown cruise (its refusals say why): there is nothing to talk to.', 'A cruise that idea 40 flies to the arrival.', { applies_to: 'trajectory' }) };
      return { h40: x, R40: P.R };
    }
    /** A preset: idea 39's kernel picks the transfer, idea 40's flies it with its own defaults, as idea 40's page does. */
    function fromPreset(key, produced) {
      var p = null; P40.list.forEach(function (q) { if (q.key === key) p = q; });
      if (!p) return { refusal: refusal('not_found', 'No transfer preset "' + key + '".', 'One of ' + P40.list.map(function (q) { return q.key; }).join(', ') + '.') };
      var h39 = K40.lambertsRoadFrom(p.settings, produced || '2026-10-31T12:00:00Z');
      if (h39.refusal) return h39;
      var src = K40.importLambertsRoad(h39);
      if (src.refusal) return src;
      var R40 = K40.run(src, K40.defaults());
      if (R40.refusal || !R40.reference || !R40.arrival) return { refusal: refusal('insufficient_data', 'Idea 40 flies no cruise for this preset: ' + ((R40.refusal || R40.refusals[0] || {}).reason || 'no reason given') + '.', 'Another transfer.', { applies_to: 'trajectory' }) };
      return { h40: K40.buildHandoff(R40, produced || '2026-10-31T12:00:00Z'), R40: R40, preset: key };
    }

    // ------------------------------------------------------------------------------------------- the timeline
    var STEP_S = 600;   // elevation sampling, 10 min
    function utcMidnightAfter(t) { var ms = K39.tdbToUtcMs(t), d = new Date(ms); var m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); return K39.utcMsToTdb(m); }
    /** The day's best pass: per complex, the culmination inside [t0, t0 + 1 d) and the arc above elMin around it. */
    function passesOf(t0, g0, g1, ids, elMin) {
      var out = [];
      ids.forEach(function (id) {
        var st = station(id), n = Math.round(2 * DAY / STEP_S), el = new Array(n + 1);
        for (var k = 0; k <= n; k++) {
          var t = t0 - 0.5 * DAY + k * STEP_S, u = (t - t0) / DAY;
          el[k] = K40.elevation(st, t, lerp(g0.rhoGeo, g1.rhoGeo, u)) / DEG;
        }
        var kc = -1;
        for (k = Math.round(0.5 * DAY / STEP_S); k < Math.round(1.5 * DAY / STEP_S); k++) if (el[k] >= el[k - 1] && el[k] > el[k + 1] && (kc < 0 || el[k] > el[kc])) kc = k;
        if (kc < 0 || el[kc] < elMin) { out.push({ id: id, complex: st.complex, visible: false, maxEl_deg: kc < 0 ? null : el[kc] }); return; }
        var a = kc, b = kc; while (a > 0 && el[a - 1] >= elMin) a--; while (b < n && el[b + 1] >= elMin) b++;
        out.push({ id: id, complex: st.complex, visible: true, maxEl_deg: el[kc], culm: t0 - 0.5 * DAY + kc * STEP_S, rise: t0 - 0.5 * DAY + a * STEP_S, set: t0 - 0.5 * DAY + b * STEP_S, el: el, k0: a, k1: b, kc: kc, visibleHours: (b - a) * STEP_S / HOUR });
      });
      return out;
    }
    function run(src, Sin) {
      var R40 = src.R40, S = clone(Sin), R = { S: S, src: src, refusals: [] };
      var errs = validSettings(S);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      var rd = radio(S); if (rd.refusal) return { refusal: rd.refusal, S: S };
      R.radio = rd;
      var tDep = R40.reference.T[0], tArr = R40.arrival.tdb, ids = D.subnets[S.antenna];
      var cruise = hermite(R40.reference.T, R40.reference.X), stay = null;
      // the asteroid's path after the arrival: the stay, and at least two days so the arrival's own day has a pass
      var stayDays = Math.max(S.stayDays, 2);
      {
        var sp = stayPath(R40, stayDays);
        if (sp.refusal) R.refusals.push(refusal(sp.refusal.code, 'The stay at the asteroid stops on ' + K39.dateOf(sp.T[sp.T.length - 1]) + ': ' + sp.refusal.reason, sp.refusal.what_would_help, { applies_to: 'stay' }));
        else if (sp.truncated && S.stayDays > 0) R.refusals.push(refusal('out_of_envelope', 'The stay is cut on ' + K39.dateOf(sp.T[sp.T.length - 1]) + ', where the ephemerides end (' + K39.dateOf(K40.span.end) + ').', 'A shorter stay.', { applies_to: 'stay' }));
        stay = { fn: hermite(sp.T, sp.X), end: sp.T[sp.T.length - 1] };
      }
      var tEnd = stay.end, tRows = Math.min(tEnd, tArr + S.stayDays * DAY);
      function craftAt(t) { if (t < tDep || t > tEnd) return null; return t <= tArr ? cruise(t) : stay.fn(t); }
      var earthAt = K39.earthState;
      R.craftAt = craftAt; R.tDep = tDep; R.tArr = tArr; R.tEnd = tEnd;
      // days: from the first UTC midnight after the departure (plus a light time) to the last before the end
      var days = [], t0 = utcMidnightAfter(tDep), prev = null;
      for (var t = t0; t + DAY <= tRows + 1 || (t <= tArr && t + DAY <= tEnd); t += DAY) {
        var g0 = prev && Math.abs(prev.tR - t) < 1 ? prev : downleg(t, craftAt, earthAt), g1 = downleg(t + DAY, craftAt, earthAt);
        if (!g0 || !g1) break;
        prev = g1;
        var row = dayRow(t, g0, g1, rd, S, ids);
        row.phase = t + DAY / 2 <= tArr ? 'cruise' : 'stay';
        days.push(row);
      }
      R.days = days;
      R.conjunctions = conjunctions(days, rd);
      R.arrival = arrivalLink(tArr, craftAt, earthAt, rd, S, ids, days);
      R.totals = totals(days, S);
      ownRefusals(R, S, rd);
      return R;
    }
    function dayRow(t, g0, g1, rd, S, ids) {
      var ps = passesOf(t, g0, g1, ids, S.elMin_deg), vis = ps.filter(function (p) { return p.visible; });
      var row = { tdb: t, utc: K39.utcOf(t).slice(0, 10), range_m: g0.range_m, owlt_s: g0.owlt_s, rangeRate_m_s: g0.rangeRate_m_s, sep_deg: g0.sep_deg, epsEff_deg: g0.epsEff_deg,
        dec_deg: g0.dec_deg, superior: g0.superior, complexes: ps.map(function (p) { return { id: p.id, complex: p.complex, hours: p.visible ? p.visibleHours : 0, maxEl_deg: p.maxEl_deg }; }) };
      var sc = scintillation(rd.band, g0.epsEff_deg); row.m = sc.m;
      row.blackout = sc.m >= D.scintillation.frameErrorAt_m;
      if (!vis.length) { row.status = 'no_view'; row.rate_bps = 0; row.passHours = 0; return row; }
      var best = vis.reduce(function (a, b) { return b.maxEl_deg > a.maxEl_deg ? b : a; });
      // the scheduled pass: passHours centred on the culmination, inside the arc above elMin
      var half = Math.round(S.passHours * HOUR / 2 / STEP_S), k0 = Math.max(best.k0, best.kc - half), k1 = Math.min(best.k1, best.kc + half);
      var elLow = Math.max(S.elMin_deg, Math.min(best.el[k0], best.el[k1]));
      row.station = best.id; row.complex = best.complex; row.maxEl_deg = best.maxEl_deg; row.passEl_deg = elLow; row.passHours = (k1 - k0) * STEP_S / HOUR;
      var lb = linkBudget(rd, g0.range_m, best.id, elLow, S.cd, g0.sep_deg, S.margin_dB, S.scPointLoss_dB);
      if (row.blackout) { row.status = 'blackout'; row.rate_bps = 0; if (!lb.refusal) { row.ptn0_dBHz = lb.lines.ptn0_dBHz; row.snt_K = lb.lines.snt_K; } return row; }
      if (lb.refusal) { row.status = 'refused'; row.refusal = lb.refusal.applies_to; row.rate_bps = null; return row; }
      row.ptn0_dBHz = lb.lines.ptn0_dBHz; row.pr_dBm = lb.lines.pr_dBm; row.snt_K = lb.lines.snt_K; row.tSun_K = lb.lines.tSun_K; row.saturates = lb.saturates;
      row.rate_bps = lb.best ? lb.best.bps : 0; row.margin_dB = lb.best ? lb.best.margin_dB : null;
      row.status = lb.best ? 'ok' : 'no_rate';
      return row;
    }
    function conjunctions(days, rd) {
      var out = [], cur = null, CAUTION = 5;
      days.forEach(function (d, i) {
        var inside = d.sep_deg < CAUTION || d.blackout;
        if (inside && !cur) cur = { start: d.utc, minSep_deg: d.sep_deg, minAt: d.utc, blackoutDays: 0, days: 0, superior: d.superior, iMin: i };
        if (inside) {
          cur.end = d.utc; cur.days++; if (d.blackout) cur.blackoutDays++;
          if (d.sep_deg < cur.minSep_deg) { cur.minSep_deg = d.sep_deg; cur.minAt = d.utc; cur.superior = d.superior; cur.iMin = i; }
        }
        if (!inside && cur) { out.push(cur); cur = null; }
      });
      if (cur) out.push(cur);
      return out.map(function (c) { var d = days[c.iMin]; return { start_utc: c.start, end_utc: c.end, days: c.days, blackout_days: c.blackoutDays, min_sep_deg: c.minSep_deg, min_at_utc: c.minAt, kind: c.superior ? 'superior' : 'inferior', min_scintillation_eps_deg: d.epsEff_deg }; });
    }
    function arrivalLink(tArr, craftAt, earthAt, rd, S, ids, days) {
      var rt = roundTrip(tArr, craftAt, earthAt); if (!rt) return null;
      var g = downleg(rt.back, craftAt, earthAt); if (!g) return null;
      var day = null; days.forEach(function (d) { if (d.tdb <= rt.back && rt.back < d.tdb + DAY) day = d; });
      var out = { tdb: tArr, received_tdb: rt.back, range_m: g.range_m, owlt_s: g.owlt_s, rtlt_s: rt.rtlt_s, sep_deg: g.sep_deg, dec_deg: g.dec_deg, rangeRate_m_s: g.rangeRate_m_s, day: day };
      if (day && day.station) {
        var lb = linkBudget(rd, g.range_m, day.station, day.passEl_deg, S.cd, g.sep_deg, S.margin_dB, S.scPointLoss_dB);
        if (!lb.refusal) out.dct = lb;
      }
      return out;
    }
    function totals(days, S) {
      var f = S.passesPerWeek / 7, sum = { cruise: 0, stay: 0 }, n = { cruise: 0, stay: 0 }, black = 0, noRate = 0, refused = 0, sat = 0, noView = 0;
      days.forEach(function (d) {
        n[d.phase]++;
        if (d.rate_bps) sum[d.phase] += d.rate_bps * d.passHours * HOUR * f;
        if (d.status === 'blackout') black++; else if (d.status === 'no_rate') noRate++; else if (d.status === 'refused') refused++; else if (d.status === 'no_view') noView++;
        if (d.saturates) sat++;
      });
      return { cruise_bits: sum.cruise, stay_bits: sum.stay, total_bits: sum.cruise + sum.stay, cruise_days: n.cruise, stay_days: n.stay, blackout_days: black, no_rate_days: noRate, refused_days: refused, no_view_days: noView, saturation_days: sat, passes_per_week: S.passesPerWeek, pass_hours: S.passHours };
    }
    function spanOf(days, test) { var a = days.filter(test); return a.length ? a[0].utc + ' to ' + a[a.length - 1].utc : ''; }
    function ownRefusals(R, S, rd) {
      var src = R.src, t = R.totals, days = R.days;
      (src.h40.refusals || []).forEach(function (r) { var q = clone(r); if (!q.from) q.from = '40-long-coast'; R.refusals.push(q); });
      R.refusals.push(refusal('insufficient_data', 'The chain has no spacecraft yet: this radio is ' + rd.name + '\'s (' + rd.article + ')' + (S.power_W !== +rd.presetPower_W.toPrecision(6) || S.diameter_m !== rd.presetDiameter_m ? ', with its power or dish changed' : '') + ', not this mission\'s.', 'The mission\'s own transponder, amplifier, antenna and coding (a telecom design control table).', { applies_to: 'spacecraft' }));
      R.refusals.push(refusal('insufficient_data', 'The command uplink is not computed: the sources give no HGA receive gain and receiver noise for these presets, so command rates and uplink margins are not stated.', 'The spacecraft receiver\'s noise temperature and the HGA receive gain (an uplink DCT).', { applies_to: 'uplink' }));
      if (S.band === 'Ka') R.refusals.push(refusal('insufficient_data', 'Ka band here is ' + rd.name + '\'s X-band dish scaled by frequency squared at the same aperture efficiency, with the DSN\'s nominal 32,050 MHz: none of these spacecraft sent telemetry on Ka, and a dish built for X may not hold its efficiency at Ka.', 'The spacecraft\'s Ka-band antenna gain and amplifier power.', { applies_to: 'ka_band' }));
      if (t.blackout_days) R.refusals.push(refusal('out_of_envelope', t.blackout_days + ' day(s) near solar conjunction (' + spanOf(days, function (d) { return d.status === 'blackout'; }) + ') have scintillation index m >= ' + D.scintillation.frameErrorAt_m + ' at ' + rd.band + ' band, where telemetry frame errors rise sharply (810-005 106): no rate is stated for them.', 'Plan no critical events then; ' + (rd.band === 'X' ? 'Ka band holds to about 1 deg' : 'tone-only signalling (DS1 used a subcarrier tone below 1 deg)') + '.', { applies_to: 'conjunction' }));
      if (t.refused_days) R.refusals.push(refusal('insufficient_data', t.refused_days + ' day(s) (' + spanOf(days, function (d) { return d.status === 'refused'; }) + ') have no link stated: ' + days.filter(function (d) { return d.status === 'refused'; })[0].refusal + ' outside the model.', S.antenna === '70m' ? 'A 34-m BWG station near the Sun.' : 'Other settings.', { applies_to: 'sun_noise' }));
      if (t.no_rate_days) R.refusals.push(refusal('out_of_envelope', t.no_rate_days + ' day(s) (' + spanOf(days, function (d) { return d.status === 'no_rate'; }) + ') close no rate in ' + rd.name + '\'s table with ' + S.margin_dB + ' dB of margin.', 'More power, a bigger dish, the 70-m antennas, or less margin.', { applies_to: 'link_margin' }));
      if (t.no_view_days) R.refusals.push(refusal('out_of_envelope', t.no_view_days + ' day(s) see the spacecraft from no complex above ' + S.elMin_deg + ' deg.', 'A lower elevation limit (6 deg receive-only).', { applies_to: 'view' }));
      if (t.saturation_days) R.refusals.push(refusal('out_of_envelope', t.saturation_days + ' day(s) (' + spanOf(days, function (d) { return d.saturates; }) + ') put more than ' + D.maxRx_dBm + ' dBm into the 34-m receiver, the recommended maximum (810-005 104 Table 7): the high-gain antenna is too loud so close to the Earth.', 'A low-gain antenna or the station\'s low-gain mode (-65 dBm) for those days.', { applies_to: 'saturation' }));
      if (!R.arrival || !R.arrival.dct) R.refusals.push(refusal('insufficient_data', 'No link is stated at the arrival (no pass that day, or the link is refused).', 'Other settings.', { applies_to: 'arrival_link' }));
    }

    /** The design control table for day i of a run (the pass that day, at its lowest elevation). */
    function dayLink(R, i) {
      var d = R.days[i]; if (!d || !d.station) return null;
      return linkBudget(R.radio, d.range_m, d.station, d.passEl_deg, R.S.cd, d.sep_deg, R.S.margin_dB, R.S.scPointLoss_dB);
    }

    // ------------------------------------------------------------------------------------------- the oracles
    /**
     * Every comparison with an independent source, computed by this kernel: JPL's published design control tables and
     * rate tables, Dawn's station monitor data, 810-005's worked examples, JPL Horizons' observer tables, and DS1's
     * conjunction dates. HZ is snapshots/horizons-geometry.js; R40 (optional) adds the chain's own Apophis.
     */
    function oracles(HZ, R40) {
      var out = {}, P = CR.presets, DC = CR.dct, OFF = K39.constants.tdbMinusUtc_s;
      function rdOf(key, over) { var S = defaults(key); for (var k in over || {}) S[k] = over[k]; return radio(S); }
      function hms(s) { var a = s.split(':').map(Number); return a[0] * 3600 + a[1] * 60 + a[2]; }
      // 1. published DCTs, reproduced with this model (design values; the DCTs' totals use mean values)
      var ju = DC.juno, lbJ = linkBudget(rdOf('juno'), ju.range_km * 1e3, 'DSS-26', ju.elevation_deg, ju.cd, 18.37, 0, ju.doff_dB);
      out.juno = { ptn0: [ju.lines.ptn0, lbJ.lines.ptn0_dBHz], snt: [ju.lines.snt_K, lbJ.lines.snt_K], tAmw: [ju.lines.tAmw_K, lbJ.lines.tAmw_K], tAtm: [ju.lines.tAtm_K, lbJ.lines.tAtm_K], gain: [ju.lines.dsnGain_dBi, lbJ.lines.dsnGain_dBi], spaceLoss: [ju.lines.spaceLoss_dB, lbJ.lines.spaceLoss_dB], eirp: [ju.lines.eirp_dBm, lbJ.lines.eirp_dBm] };
      var dw = DC.dawn, sepD = HZ ? HZ.dawn.dct[0][4] : 3.618, lbD = linkBudget(rdOf('dawn'), hms(dw.owlt) * C, 'DSS-34', dw.elevation_deg, dw.cd, sepD, 0, dw.doff_dB);
      out.dawn = { ptn0: [dw.lines.ptn0, lbD.lines.ptn0_dBHz], tSun: [dw.lines.tSun_K, lbD.lines.tSun_K], sep_deg: sepD, spaceLoss: [dw.lines.spaceLoss_dB, lbD.lines.spaceLoss_dB], station: 'DSS-34' };
      var di = DC.di, lbI = linkBudget(rdOf('di'), di.range_km * 1e3, 'DSS-14', di.elevation_deg, di.cd, 90, 0, di.doff_dB);
      out.di = { ptn0: [di.lines.ptn0, lbI.lines.ptn0_dBHz], snt: [di.lines.snt_K, lbI.lines.snt_K], gain: [di.lines.dsnGain_dBi, lbI.lines.dsnGain_dBi], eirp: [di.lines.eirp_dBm, lbI.lines.eirp_dBm], spaceLoss: [di.lines.spaceLoss_dB, lbI.lines.spaceLoss_dB] };
      // 2. published rate thresholds against the computed ones
      function thr(key, ranging, minBps) {
        var r = rdOf(key, { ranging: ranging }), rows = presetRates(P[key], ranging).map(function (q) { return { bps: q.bps, published: q.reqPtN0, model: thresholdPtN0(r, q).data }; });
        var hi = rows.filter(function (q) { return q.bps >= minBps; }), lo = rows.filter(function (q) { return q.bps < minBps; });
        var mx = function (a) { return a.reduce(function (m, q) { return Math.max(m, Math.abs(q.model - q.published)); }, 0); };
        return { rows: rows, minBps: minBps, maxGapHigh_dB: mx(hi), maxGapLow_dB: mx(lo), worstLow: lo.length ? lo[0] : null };
      }
      out.thresholds = { di: thr('di', false, 1000), juno: thr('juno', true, 99000), junoNoRanging: thr('juno', false, 99000) };
      // 3. Dawn's station monitor data (June 2009): carrier power, noise temperature, symbol SNR
      var M = CR.dawnMonitor, rdw = rdOf('dawn', { ranging: true });
      out.dawnMonitor = M.passes.map(function (p) {
        var lb = linkBudget(rdw, hms(p.owlt) * C, p.station, p.elevation_deg, 0.25, 39, 0, 0), L = lb.lines, sp = suppression(rdw, 72), n0m = db(KB * p.snt_K) + 30;
        return { col: p.col, station: p.station, carrier: [p.carrier_dBm, L.pr_dBm + sp.carrier_dB], snt: [p.snt_K, L.snt_K], ssnr: [p.ssnr_dB, L.pr_dBm - n0m + sp.data_dB - db(M.symbolRate_sps)], pcn0: [p.pcn0, L.pr_dBm + sp.carrier_dB - n0m] };
      });
      // 4. 810-005 106's worked example and thresholds
      var ex = D.corona.example, e = ex.sep_deg * DEG, b = ex.beta_deg * DEG, rE = [AU, 0, 0], EP = AU * Math.sin(b) / Math.sin(PI - b - e), rS = [AU - EP * Math.cos(e), EP * Math.sin(e), 0], st = stec(rE, rS);
      out.corona = { stec: [ex.stec_m2, st], delayS_us: [ex.delayS_us, coronaDelay_s(st, ex.fS_GHz * 1e9) * 1e6], delayX_us: [ex.delayX_us, coronaDelay_s(st, ex.fX_GHz * 1e9) * 1e6] };
      function cross03(band) { var lo = 0.3, hi = 6; for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (scintillation(band, m).m >= D.scintillation.frameErrorAt_m) lo = m; else hi = m; } return lo; }
      out.scintillation = { X: [2.3, cross03('X')], Ka: [1.0, cross03('Ka')] };
      if (!HZ) return out;
      // 5. geometry against Horizons: pure (Horizons vectors in, observer table out)
      function tOf(jd) { return (jd - 2451545) * DAY + OFF; }
      function path(recs) { return hermite(recs.map(function (r) { return tOf(r[0]); }), recs.map(function (r) { return [r[1] * 1e3, r[2] * 1e3, r[3] * 1e3, r[4] * 1e3, r[5] * 1e3, r[6] * 1e3]; })); }
      var A = HZ.apophis, au = HZ.au_km * 1e3, w = { range_m: 0, owlt_s: 0, sep_deg: 0, ra_deg: 0, dec_deg: 0, n: 0 };
      A.earth.forEach(function (e) {
        var ob = A.obs.filter(function (o) { return Math.abs(o[0] - e[0]) < 1e-5; })[0]; if (!ob) return;
        var pr = A.sc.filter(function (r) { return Math.abs(r[0] - e[0]) < 1e-6 || Math.abs(r[0] - (e[0] - 1 / 24)) < 1e-6; }).sort(function (x, y) { return x[0] - y[0]; });
        var E = { r: [e[1] * 1e3, e[2] * 1e3, e[3] * 1e3], v: [e[4] * 1e3, e[5] * 1e3, e[6] * 1e3] }, g = downleg(tOf(e[0]), path(pr), function () { return E; });
        if (!g) return;
        w.n++; w.range_m = Math.max(w.range_m, Math.abs(g.range_m - ob[3] * au)); w.owlt_s = Math.max(w.owlt_s, Math.abs(g.owlt_s - ob[5] * 60)); w.sep_deg = Math.max(w.sep_deg, Math.abs(g.sep_deg - ob[6]));
        w.ra_deg = Math.max(w.ra_deg, Math.abs((g.ra_deg - ob[1]) * Math.cos(ob[2] * DEG))); w.dec_deg = Math.max(w.dec_deg, Math.abs(g.dec_deg - ob[2]));
      });
      out.geometry = w;
      var S1 = path(HZ.ds1.sc), E1 = path(HZ.ds1.earth), wd = { range_m: 0, sep_deg: 0, n: 0 };
      HZ.ds1.obs.forEach(function (o) {
        if (!HZ.ds1.sc.some(function (r) { return Math.abs(r[0] - o[0]) < 1e-6; })) return;
        var g = downleg(tOf(o[0]), S1, E1); if (!g) return;
        wd.n++; wd.range_m = Math.max(wd.range_m, Math.abs(g.range_m - o[1] * au)); wd.sep_deg = Math.max(wd.sep_deg, Math.abs(g.sep_deg - o[4]));
      });
      out.ds1Geometry = wd;
      // DS1's conjunction dates: Horizons' S-O-T crossings of 5 and 3 deg against the article's dates
      function crossings(lim) { var a = null, b = null, o = HZ.ds1.obs; for (var i = 1; i < o.length; i++) { if (o[i - 1][4] >= lim && o[i][4] < lim) a = o[i - 1][0] + (o[i - 1][4] - lim) / (o[i - 1][4] - o[i][4]); if (o[i - 1][4] < lim && o[i][4] >= lim) b = o[i - 1][0] + (lim - o[i - 1][4]) / (o[i][4] - o[i - 1][4]); } return [a, b]; }
      function jdOf(s) { return Date.parse(s + 'T00:00:00Z') / 864e5 + 2440587.5; }
      var c5 = crossings(5), c3 = crossings(3), DS = CR.ds1Conjunction, minRow = HZ.ds1.obs.reduce(function (m, o) { return o[4] < m[4] ? o : m; });
      out.ds1Dates = { below5: { horizons: c5, article: DS.below5.map(jdOf) }, below3: { horizons: c3, article: DS.below3.map(jdOf) }, min: { jd: minRow[0], sep: minRow[4] },
        firstTelemetry: { article: DS.firstTelemetryAfter, horizonsSep: HZ.ds1.obs.filter(function (o) { return Math.abs(o[0] - jdOf(DS.firstTelemetryAfter.utc)) < 1e-6; })[0][4] } };
      // Juno's elevation at its DCT epoch, and Apophis from three stations, by idea 40's station model
      var J = HZ.juno, jAt = path(J.geo), zero = function () { return { r: [0, 0, 0], v: [0, 0, 0] }; }, tj = tOf(J.topoDSS26[0][0]), gj = downleg(tj, jAt, zero);
      out.junoElevation = { horizons: J.topoDSS26[0][2], dct: CR.dct.juno.elevation_deg, model: K40.elevation(station('DSS-26'), tj, gj.rhoGeo) / DEG };
      var aAt = path(HZ.apophisTopo.geo), we = { max: 0, sum: 0, n: 0 };
      Object.keys(HZ.apophisTopo.stations).forEach(function (id) {
        HZ.apophisTopo.stations[id].forEach(function (o) {
          if (!(o[2] > 0)) return;
          var t = tOf(o[0]), g = downleg(t, aAt, zero); if (!g) return;
          var dl = K40.elevation(station(id), t, g.rhoGeo) / DEG - o[2]; we.max = Math.max(we.max, Math.abs(dl)); we.sum += dl; we.n++;
        });
      });
      out.stationElevation = { max_deg: we.max, mean_deg: we.sum / we.n, n: we.n };
      // 6. the chain: idea 40's Apophis (Aster's elements, n-body) seen from idea 39's Earth, against Horizons
      if (R40) {
        var t0 = K39.utcMsToTdb((A.obs[0][0] - 2440587.5) * 864e5) - DAY, t1 = K39.utcMsToTdb((A.obs[A.obs.length - 1][0] - 2440587.5) * 864e5) + DAY;
        var x0 = K40.targetState(R40.body, t0, R40.fm, 'nbody');
        if (x0 && !x0.refusal) {
          var pa = pathFrom(x0.r.concat(x0.v), t0, t1, R40.fm), at = hermite(pa.T, pa.X), flyJd = 2462240.5, wc = { before: { range_m: 0, sep_deg: 0, dec_deg: 0, n: 0 }, after: { range_m: 0, sep_deg: 0, dec_deg: 0, n: 0 } };
          A.obs.forEach(function (o) {
            var g = downleg(K39.utcMsToTdb((o[0] - 2440587.5) * 864e5), at, K39.earthState); if (!g) return;
            var q = o[0] < flyJd - 2 ? wc.before : wc.after; q.n++;
            q.range_m = Math.max(q.range_m, Math.abs(g.range_m - o[3] * au)); q.sep_deg = Math.max(q.sep_deg, Math.abs(g.sep_deg - o[6])); q.dec_deg = Math.max(q.dec_deg, Math.abs(g.dec_deg - o[2]));
          });
          out.chainApophis = wc;
        }
      }
      return out;
    }

    // ------------------------------------------------------------------------------------------- handoff (version 1)
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
    function buildHandoff(R, produced) {
      var S = R.S, rd = R.radio, u = K39.utcOf, h = { handoff: 'long-way-round', version: 1, from: '41-signal', produced: produced || new Date().toISOString() };
      h.inputs = { long_coast_handoff: R.src.h40, settings: clone(S) };
      var O = {}, wk = R.days.filter(function (d, i) { return i % 7 === 0; });
      O.comms_timeline = qv({ step_days: 7, utc: wk.map(function (d) { return d.utc; }), phase: wk.map(function (d) { return d.phase; }), range_m: wk.map(function (d) { return r9(d.range_m); }),
        owlt_s: wk.map(function (d) { return r9(d.owlt_s); }), sep_deg: wk.map(function (d) { return r9(d.sep_deg); }), dec_deg: wk.map(function (d) { return r9(d.dec_deg); }),
        station: wk.map(function (d) { return d.station || null; }), pass_hours: wk.map(function (d) { return d.passHours; }), rate_bps: wk.map(function (d) { return d.rate_bps; }), status: wk.map(function (d) { return d.status; }) },
        'utc, m, s, deg, h, bit/s', 'derived', KERNEL + ' run(): weekly samples of the daily timeline (00:00 UTC, received at the Earth\'s centre), idea 40\'s cruise then idea 40\'s propagator on the asteroid');
      O.conjunctions = qv(R.conjunctions.map(function (c) { var q = clone(c); q.min_sep_deg = r9(q.min_sep_deg); q.min_scintillation_eps_deg = r9(q.min_scintillation_eps_deg); return q; }), 'utc, days, deg', 'derived', KERNEL + ' conjunctions(): days with Sun-Earth-probe angle < 5 deg (DS1 and MRO\'s planning limit) or scintillation m >= 0.3 (810-005 106)');
      if (R.arrival && R.arrival.dct) {
        var A = R.arrival, L = A.dct.lines, b = A.dct.best;
        O.arrival_link = qv({ tdb_s_past_j2000: A.tdb, utc: u(A.tdb), received_utc: u(A.received_tdb), range_m: r9(A.range_m), owlt_s: r9(A.owlt_s), rtlt_s: r9(A.rtlt_s), sep_deg: r9(A.sep_deg), dec_deg: r9(A.dec_deg),
          station: A.dct.station, elevation_deg: r9(A.dct.elevation_deg), ptn0_dBHz: r9(L.ptn0_dBHz), pr_dBm: r9(L.pr_dBm), snt_K: r9(L.snt_K), rate_bps: b ? b.bps : 0, margin_dB: b ? r9(b.margin_dB) : null,
          bits_per_pass: b ? r9(b.bps * A.day.passHours * HOUR) : 0, pass_hours: A.day.passHours },
          's, m, dB-Hz, dBm, K, bit/s, bit', 'derived', KERNEL + ' linkBudget() at the pass that hears the arrival, 810-005 104/101/105 DSN model, ' + rd.article + ' radio');
        O.link_design = qv(Object.keys(L).reduce(function (o, k) { o[k] = r9(L[k]); return o; }, {}), 'dBm, dB, dBi, K, dBm/Hz, dB-Hz', 'derived', KERNEL + ' linkBudget(): the arrival pass\'s design control table');
      }
      var T = R.totals;
      O.data_volume = qv({ cruise_bits: r9(T.cruise_bits), stay_bits: r9(T.stay_bits), total_bits: r9(T.total_bits), cruise_days: T.cruise_days, stay_days: T.stay_days, blackout_days: T.blackout_days, no_rate_days: T.no_rate_days, refused_days: T.refused_days, saturation_days: T.saturation_days, passes_per_week: T.passes_per_week, pass_hours: T.pass_hours },
        'bit, days', 'derived', KERNEL + ' totals(): each day\'s rate x its pass hours x passes a week / 7');
      O.telecom = qv({ craft: rd.key, name: rd.name, article: rd.article, band: rd.band, f_Hz: rd.f_Hz, power_W: rd.power_W, gain_dBi: r9(rd.gain_dBi), diameter_m: rd.diameter_m, code: rd.code, req_ebn0_dB: rd.reqEbN0_dB, ranging: !!rd.ranging, max_rate_bps: rd.maxRate_bps, antenna: S.antenna, stations: D.subnets[S.antenna], weather_cd: S.cd, elevation_min_deg: S.elMin_deg, margin_dB: S.margin_dB },
        'Hz, W, dBi, m, dB', 'assumed', CR.presets[rd.key].article + ': ' + CR.presets[rd.key].cite);
      h.outputs = O;
      h.refusals = R.refusals.map(clone);
      h.assumptions = [
        'Frame: heliocentric ICRF/J2000 axes (ideas 39 and 40); time TDB seconds past J2000, UTC = TDB - ' + K39.constants.tdbMinusUtc_s + ' s, UT1 = UTC; stations ITRF93 (810-005 301) turned by the Earth rotation angle only (idea 40).',
        'Light time: Newtonian down-leg, iterated, received at the Earth\'s centre (JPL Horizons\' definition); no Shapiro delay; the round trip is an up-leg then a down-leg.',
        'Each day: the complex with the highest culmination takes one pass of up to ' + S.passHours + ' h centred on it, above ' + S.elMin_deg + ' deg; its rate is the best that closes with ' + S.margin_dB + ' dB at the pass\'s lowest elevation; ' + S.passesPerWeek + ' passes a week.',
        'DSN: 810-005 104 Rev. Q / 101 Rev. I Appendix A gain and noise, weather CD ' + S.cd + '; Sun noise 105 Rev. E eqs. (10)-(11); scintillation 106 Rev. B eq. (7) on the ray\'s equivalent elongation, blackout at m >= 0.3.',
        'Radio: ' + rd.name + ' (' + rd.article + '); required Pt/No ' + (rd.published ? 'from its published rate table' : 'computed from its required Eb/No, losses and modulation index') + '; residual carrier needs a loop SNR of 10 dB.'
      ];
      return h;
    }
    var REL_TOL = 1e-6, SUM_TOL = 1e-4, EPOCH_TOL_S = 1e-3;
    function numDiff(a, b, path) {
      if (typeof a === 'number' || typeof b === 'number') {
        if (!(typeof a === 'number' && typeof b === 'number')) return path;
        if (a === b) return null;
        if (/tdb_s_past_j2000$/.test(path)) return Math.abs(a - b) <= EPOCH_TOL_S ? null : path;
        var tol = /_bits$/.test(path) ? SUM_TOL : REL_TOL;
        return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) ? null : path;
      }
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : path;
      if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return path;
      var ks = {}; Object.keys(a).forEach(function (k) { ks[k] = 1; }); Object.keys(b).forEach(function (k) { ks[k] = 1; });
      for (var k in ks) { var d = numDiff(a[k], b[k], path + '.' + k); if (d) return d; }
      return null;
    }
    function codes(L) { return (L || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join(','); }
    /** Read a 41 handoff back: idea 40's inside re-checked by idea 40's kernel, the link recomputed and compared. */
    function parseHandoff(h41) {
      var h = h41;
      if (typeof h41 === 'string') { try { h = JSON.parse(h41); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 40 or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round' || h.from !== '41-signal' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 handoff from idea 40 or 41.', 'A handoff from idea 40 (Long Coast) or from this page.') };
      var I = h.inputs || {};
      if (!I.long_coast_handoff || !I.settings) return { refusal: refusal('invalid_input', 'This 41-signal handoff carries no idea 40 handoff or no settings.', 'A handoff exported by this page.') };
      if (I.long_coast_handoff.from === '41-signal') return { refusal: refusal('invalid_input', 'A 41 handoff cannot carry another 41 handoff as its input.', 'A handoff exported by this page.') };
      var src = importLongCoast(I.long_coast_handoff);
      if (src.refusal) return src;
      var R = run(src, I.settings);
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced), keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) {
        var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i]);
        if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '41-signal', h41: h, h40: src.h40, R40: src.R40, settings: I.settings, R: R };
    }

    return {
      dsn: D, craft: CR, k40: K40, k39: K39, presets40: P40, C: C, AU: AU,
      downleg: downleg, roundTrip: roundTrip, station: station, azen: azen, dsnRx: dsnRx, sunNoise: sunNoise, scintillation: scintillation, stec: stec, coronaDelay_s: coronaDelay_s,
      radio: radio, suppression: suppression, thresholdPtN0: thresholdPtN0, linkBudget: linkBudget, presetRates: presetRates,
      defaults: defaults, validSettings: validSettings, stayPath: stayPath, pathFrom: pathFrom, importLongCoast: importLongCoast, fromPreset: fromPreset,
      passesOf: passesOf, hermite: hermite, run: run, dayLink: dayLink, oracles: oracles, buildHandoff: buildHandoff, parseHandoff: parseHandoff, numDiff: numDiff, db: db
    };
  }
  return { create: create, db: db, DEG: DEG, DAY: DAY };
});
