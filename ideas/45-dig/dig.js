/* Dig: mining water from the asteroid the chain landed on. Idea 45 of the Aster Idea Bank, module 15 of "The Long Way Round".
 *
 * Idea 44 put the spacecraft on the surface and handed on where it stands (the site, its slope, the local acceleration),
 * what it weighs there and what holding it down costs. This module asks what a mining plant at that spot produces:
 *   - what the regolith gives up when heated: measured water release from real meteorite chips (Murchison, a CM2, by
 *     TGA-MS at three heating rates, in argon and in vacuum), or for an S-type the water measured in Itokawa's grains,
 *     chosen from the body's spectral class (JPL Small-Body Database);
 *   - what that costs in heat: Hess's law over Robie and Hemingway's (USGS) enthalpies, the water carried as serpentine
 *     (chrysotile) breaking down to forsterite, enstatite and steam, the rest of the rock heated as forsterite;
 *   - what the Sun delivers there: the body's distance from JPL Horizons, the site's day and night from idea 43's spin
 *     (Bennu's IAU rotation; Apophis tumbling from NAIF's CK), a concentrator whose cavity loses sigma T^4 / C;
 *   - what digging asks of the feet: counter-rotating bucket drums (NASA's IPEx/RASSOR) push sideways by their
 *     imbalance (the regolith's resistance from idea 44's fit to OSIRIS-REx's contact) and by bringing the dug regolith
 *     to the craft's speed; the feet need that much friction against the weight (judged only against a coefficient set);
 *   - and day by day over the stay, which of heat, oven and digging limits the water made.
 * The Bennu case (OSIRIS-REx at Nightingale) is the reality test for the sunlight: JPL Horizons' own Sun elevation at
 * the site is the oracle (tests); the water yields are compared with Bennu's hydrogen measured from orbit and with
 * another CM meteorite on the page.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, J, W, K, N, Pa). Time TDB seconds past J2000
 * (UTC = TDB - 69.184 s). Frames: the Sun direction in ICRF axes (Horizons), turned into the body frame of idea 43's
 * spin (IAU_BENNU, APOPHIS_CK); the site normal is idea 44's, in that body frame.
 *
 * What it reuses, unmodified (snapshots/): idea 43's kernel for the spin (lumpy.js attitudeAt, with its spin data and
 * idea 40's integrator), idea 44's two handoffs (the chain at Apophis; its own Bennu case), idea 40's solar luminosity,
 * idea 42's OSIRIS-REx figures, Aster's constants. Methods written here: the Hess-cycle energy, the cavity receiver,
 * the daily ledger, the drum force balance and friction, the import checks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, HOUR = 3600, DAY = 86400;
  var KERNEL = '45-dig/dig.js';
  var J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
  var T_REF = 298.15;   // K, the reference temperature of Robie and Hemingway's tables (and of every enthalpy of formation)

  function refusal(code, reason, help, extra) { var r = { code: code, reason: reason, what_would_help: help }; if (extra) for (var k in extra) r[k] = extra[k]; return r; }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var n = norm(a); return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0]; }
  function mv(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function r6(x) { return num(x) ? +x.toPrecision(6) : x; }
  function vr9(v) { return v.map(r9); }

  // ---------------------------------------------------------------------------------------------- thermochemistry
  /** Heat capacity, J/mol/K, of a Robie-Hemingway equation Cp = A1 + A2 T + A3 / T^2 + A4 / sqrt(T) + A5 T^2. */
  function cpRH(c, T) { return c[0] + c[1] * T + c[2] / (T * T) + c[3] / Math.sqrt(T) + c[4] * T * T; }
  /** Its integral from 298.15 K to T: H(T) - H(298.15), J/mol (the antiderivative written out). */
  function dhRH(c, T) {
    function F(t) { return c[0] * t + c[1] * t * t / 2 - c[2] / t + 2 * c[3] * Math.sqrt(t) + c[4] * t * t * t / 3; }
    return F(T) - F(T_REF);
  }

  function create(deps) {
    var L43 = deps.lumpy, SRC = deps.sources, EPH = deps.ephem, NAV = deps.nav, K = deps.constants, AP = deps.approach;
    var AU = K.au_m, TDB_UTC = K.tdbMinusUtc_s, SIGMA = SRC.sigma.W_m2_K4;
    var S1AU = NAV.sun.luminosity_W / (4 * PI * AU * AU);   // W/m^2 at 1 au: idea 40's luminosity over the sphere of 1 au
    var SP = SRC.thermo.species, CH = SP.chrysotile, FO = SP.forsterite, EN = SP.enstatite, ST = SP.steam;
    var XW = 2 * ST.M_g_mol / CH.M_g_mol;                    // mass fraction of water in chrysotile, Mg3Si2O5(OH)4 -> 2 H2O
    var H_PER_H2O = 2 * SRC.atomic.H / (2 * SRC.atomic.H + SRC.atomic.O);   // mass of hydrogen in water
    var RUNS = {}; SRC.murchison.runs.forEach(function (r) { RUNS[r.id] = r; });
    var cache = {};

    function utcOf(tdb) { return new Date(J2000_UNIX_MS + (tdb - TDB_UTC) * 1000).toISOString(); }
    function tdbOfUtc(iso) { return (Date.parse(iso) - J2000_UNIX_MS) / 1000 + TDB_UTC; }

    /** H(T) - H(298.15) of a species, J/mol, with how far T lies beyond its equation's range (K, 0 inside). */
    function dH(sp, T) { return dhRH(sp.cp, T); }
    function beyond(sp, T) { return Math.max(0, T - sp.T_K[1], sp.T_K[0] - T); }

    /**
     * The heat to take one kilogram of regolith from T0 to Tpk and drive off a mass fraction w of water, J/kg, by Hess's
     * law: reactants at T0 (serpentine-equivalent f = w / XW as chrysotile, the rest as forsterite), products at Tpk
     * (forsterite + enstatite + 2 H2O(g) per chrysotile, the rest still forsterite). The path is irrelevant (state
     * functions); it is split for the display as reaction at 298.15 K + heating the products - heating the reactants.
     * recovery: the fraction of the spent solids' sensible heat (Tpk back to T0) handed to the next batch.
     */
    function energy(w, T0, Tpk, recovery) {
      var f = w / XW;
      if (!(f >= 0 && f <= 1)) return { refusal: refusal('out_of_envelope', 'A water fraction of ' + (100 * w).toFixed(2) + ' wt% is more than serpentine can carry (' + (100 * XW).toFixed(1) + ' wt%).', 'A water fraction under ' + (100 * XW).toFixed(1) + ' wt%.', { applies_to: 'energy' }) };
      var nCh = f / (CH.M_g_mol / 1000), nFo0 = (1 - f) / (FO.M_g_mol / 1000);   // mol per kg of regolith
      var nFo = nCh + nFo0, nEn = nCh, nW = 2 * nCh;
      var rxn298 = 1000 * (FO.dHf_kJ_mol + EN.dHf_kJ_mol + 2 * ST.dHf_kJ_mol - CH.dHf_kJ_mol);   // J per mol chrysotile
      var heatReactants = nCh * dH(CH, T0) + nFo0 * dH(FO, T0);
      var solids = nFo * dH(FO, Tpk) + nEn * dH(EN, Tpk) - heatReactants;     // the solids' share, reactants subtracted
      var steam = nW * dH(ST, Tpk);
      var reaction = nCh * rxn298;
      var spentSensible = nFo * (dH(FO, Tpk) - dH(FO, T0)) + nEn * (dH(EN, Tpk) - dH(EN, T0));
      var recovered = (recovery || 0) * spentSensible;
      var total = solids + steam + reaction - recovered;
      return { w: w, f_serpentine: f, T0: T0, Tpk: Tpk, perKgRegolith_J: total, perKgWater_J: w > 0 ? total / w : null,
        parts_J_per_kg: { solids: solids, reaction: reaction, steam: steam, recovered: -recovered }, rxn298_J_per_mol: rxn298,
        perKgWaterReaction_J: rxn298 / (2 * ST.M_g_mol / 1000), extrapolated_K: Math.max(beyond(EN, Tpk), beyond(FO, Tpk), beyond(ST, Tpk), w > 0 ? beyond(CH, T0) : 0) };
    }

    // ---------------------------------------------------------------------------------------------- feedstock
    var SPEC_OF = { '99942': '99942', '101955': '101955' };
    function classOf(designation) { var s = SRC.sbdb[designation]; return s && s.spec_B ? s.spec_B : null; }
    /** Spectral class -> analog: the S complex (S, Sq, S(IV)...) to ordinary-chondrite-like (Itokawa's measured water);
     *  the C complex (B, C, Cb, Ch...) to CM-like (Murchison's measured release). Other classes are refused. */
    function analogOfClass(spec) {
      if (!spec) return null;
      if (/^S/.test(spec) || /^Q/.test(spec)) return 'ordinary';
      if (/^[BCF]/.test(spec)) return 'cm';
      return null;
    }
    function feedstock(S, designation) {
      var spec = classOf(designation), auto = analogOfClass(spec ? spec.value : null), analog = S.analog === 'auto' ? auto : S.analog;
      if (!analog) return { refusal: refusal('not_found', 'No spectral class maps to an analog here (' + (spec ? spec.value : 'none in the Small-Body Database') + ').', 'A spectral class in the S or C complex, or choose the analog by hand.', { applies_to: 'feedstock' }) };
      var hypothetical = S.analog !== 'auto' && auto && analog !== auto;
      if (analog === 'cm') {
        var run = RUNS[S.run];
        if (!run) return { refusal: refusal('invalid_input', 'No Murchison run ' + S.run + '.', 'One of ' + Object.keys(RUNS).join(', ') + '.', { applies_to: 'settings' }) };
        var at750 = SRC.murchison.runs.filter(function (r) { return r.peak_C === 750; }).map(function (r) { return r.h2o_wt / 100; });
        return { analog: 'cm', spec: spec, hypothetical: hypothetical, run: run, w: run.h2o_wt / 100, Tpk: run.peak_C + 273.15, rate_K_s: run.rate_C_min / 60,
          others: { co2: run.co2_wt / 100, so2: run.so2_wt / 100, organics: run.organics_wt / 100 }, range750: [Math.min.apply(null, at750), Math.max.apply(null, at750)],
          bound: 'measured', label: 'CM-like: Murchison chips, run ' + run.id + ' (' + run.peak_C + ' °C, ' + run.rate_C_min + ' °C/min, ' + run.gas + ')' };
      }
      if (analog === 'ordinary') {
        var it = SRC.itokawa.bulk_ppm;
        return { analog: 'ordinary', spec: spec, hypothetical: hypothetical, run: null, w: it[1] * 1e-6, wLow: it[0] * 1e-6, Tpk: S.peakS_C + 273.15, rate_K_s: S.rateS_C_min / 60,
          others: { co2: 0, so2: 0, organics: 0 }, bound: 'upper', label: 'S-type: Itokawa\'s bulk silicate water, ' + it[0] + '–' + it[1] + ' ppm (all of it, an upper bound)' };
      }
      return { refusal: refusal('invalid_input', 'analog must be auto, cm or ordinary.', 'One of those.', { applies_to: 'settings' }) };
    }

    // ---------------------------------------------------------------------------------------------- the Sun at the site
    function ephOf(key) { return EPH.bodies[key] || null; }
    /** Heliocentric position of the body (m, ICRF) at TDB t, linear between Horizons' 2-day rows; null outside. */
    function helio(key, t) {
      var E = ephOf(key); if (!E) return null;
      var jd = 2451545.0 + t / DAY, x = (jd - E.jd0_tdb) / E.step_d, i = Math.floor(x);
      if (i < 0 || i >= E.n - 1) { if (i === E.n - 1 && x === i) i = E.n - 2; else return null; }
      var f = x - i, a = E.xyz_au[i], b = E.xyz_au[i + 1];
      return [0, 1, 2].map(function (k) { return (a[k] + f * (b[k] - a[k])) * AU; });
    }
    function ephSpan(key) { var E = ephOf(key); return E ? [(E.jd0_tdb - 2451545.0) * DAY, (E.jd0_tdb + E.step_d * (E.n - 1) - 2451545.0) * DAY] : null; }
    /** The Sun's direction in the body frame (unit) and the distance (m) at t, from idea 43's spin; or a refusal. */
    function sunInBody(key, t) {
      var r = helio(key, t); if (!r) return { refusal: refusal('out_of_envelope', 'No Horizons row for ' + key + ' at ' + utcOf(t).slice(0, 10) + '.', 'A longer ephemeris (oracle/fetch-sources.sh).', { applies_to: 'ephemeris' }) };
      var a = L43.attitudeAt(key, t); if (a.refusal) return { refusal: a.refusal };
      var d = norm(r), s = [-r[0] / d, -r[1] / d, -r[2] / d], sb = mv(a.C, s), w = a.w;
      // its rate in the body frame: dC/dt = -[w x] C (idea 43's convention, C takes ICRF into the body), so ds/dt = -w x s
      return { s: sb, ds: [-(w[1] * sb[2] - w[2] * sb[1]), -(w[2] * sb[0] - w[0] * sb[2]), -(w[0] * sb[1] - w[1] * sb[0])], r_m: d, C: a.C };
    }
    /** The Sun's elevation above the plane whose normal is n (body frame), degrees, at t. */
    function sunElevation(key, t, n) { var q = sunInBody(key, t); if (q.refusal) return q; return { el_deg: Math.asin(Math.max(-1, Math.min(1, dot(unit(n), q.s)))) / DEG, r_m: q.r_m }; }

    /**
     * The site's sunlight over the stay, sampled every dtSub (5 min, at the middle of each step). Bennu turns in closed
     * form, so the kernel is called at every step's ends; Apophis is integrated by idea 43 from its nearest CK sample, so the kernel is called every 2 h and the
     * Sun's body-frame direction is interpolated in between by a cubic Hermite on the kernel's direction and its rate
     * (-w x s, from the kernel's spin vector), then normalised (the tests bound the error against the kernel itself).
     * Cached: plant settings change nothing here.
     */
    function hermite(A, B, f, h) {
      var f2 = f * f, f3 = f2 * f, h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
      return unit([0, 1, 2].map(function (i) { return h00 * A.s[i] + h10 * h * A.ds[i] + h01 * B.s[i] + h11 * h * B.ds[i]; }));
    }
    function sunlight(key, t0, days, n, horizonDeg) {
      var ck = [key, t0, days, n.join(','), horizonDeg].join('|');
      if (cache[ck]) return cache[ck];
      var dtSub = 300, kStep = key === 'apophis' ? 7200 : dtSub, sinH = Math.sin(horizonDeg * DEG), nu = unit(n);
      var T = days * DAY, nK = Math.ceil(T / kStep), samples = [], stopped = null;
      for (var k = 0; k <= nK; k++) {
        var q = sunInBody(key, t0 + k * kStep);
        if (q.refusal) { stopped = { k: k, refusal: q.refusal }; break; }
        samples.push(q);
      }
      var nDays = Math.floor((samples.length - 1) * kStep / DAY);
      var out = { key: key, t0: t0, dtSub: dtSub, kStep: kStep, horizon_deg: horizonDeg, days: [], stopped: stopped, requestedDays: days, el3_deg: [] };
      for (var d = 0; d < nDays; d++) {
        var lit = 0, ins = 0, rSum = 0, cnt = 0, rise = null;
        for (var j = 0; j < DAY / dtSub; j++) {
          var ts = d * DAY + (j + 0.5) * dtSub, kk = Math.floor(ts / kStep), f = (ts - kk * kStep) / kStep, A = samples[kk], B = samples[kk + 1];
          var sv = hermite(A, B, f, kStep);   // Bennu too: its samples are 5 min apart and the substep is their middle
          var rr = A.r_m + f * (B.r_m - A.r_m), up = dot(nu, sv);
          rSum += rr; cnt++;
          if (d < 3) out.el3_deg.push(Math.asin(Math.max(-1, Math.min(1, up))) / DEG);   // the first three days, for the page's chart
          if (up > sinH) { var S = S1AU * (AU / rr) * (AU / rr); lit += dtSub; ins += S * dtSub; }
        }
        out.days.push({ day: d + 1, tdb0: t0 + d * DAY, r_au: rSum / cnt / AU, lit_s: lit, insolation_J_m2: ins });
      }
      out.sampled = samples.length;
      return (cache[ck] = out);
    }

    // ---------------------------------------------------------------------------------------------- the concentrator
    /** Heat into the oven per square metre of aperture, W/m^2: what the mirror delivers less what the cavity radiates
     *  through its opening (aperture / C) at the oven temperature. Never negative (a cold oven is shut, not cooling). */
    function receiverFlux(S, Tpk, P) { return Math.max(0, P.eta_opt * S - P.eps * SIGMA * Math.pow(Tpk, 4) / P.conc); }
    function minConcentration(S, Tpk, P) { return P.eps * SIGMA * Math.pow(Tpk, 4) / (P.eta_opt * S); }

    // ---------------------------------------------------------------------------------------------- digging
    /**
     * Counter-rotating bucket drums (IPEx). IPEx measured the excavation force as horizontal, along the cut ("the force in
     * the X direction is the primary force of excavation"; the vertical force was the weight of the regolith captured,
     * at 1 g). Each pair digs in opposite directions, so its horizontal cutting forces cancel but for the imbalance
     * fraction of one drum's p w d (p: idea 44's resistance as the pressure on the cut face). The regolith the buckets
     * fling to their tip speed is caught inside the drums, so that momentum stays aboard (internal): what the craft feels
     * is only the dug regolith brought from rest to its own speed, mdot v, the same direction for every drum.
     * Sideways force H = pairs imbalance p w d + mdot v, mdot = 2 pairs rho w d v. A sideways force does not lift the
     * craft; the feet hold it by friction, with the slope's own along-ground weight: friction needed = (W_t + H) / W_n
     * (worst case, digging downhill). No friction coefficient is measured for this regolith, so the kernel only judges
     * the feet against a coefficient the user sets (mu, a what-if; null = not judged). Thrust (hold = 'thrust') takes
     * what the feet are not trusted with: all of H when mu is null, the excess over mu W_n when it is set.
     * site.thrustBudgetShort (set by run() when the stay's thrust would outlast idea 44's propellant) refuses thrust.
     */
    function dig(S, site) {
      var D = SRC.ipex.drums[S.drum]; if (!D) return { refusal: refusal('invalid_input', 'No drum ' + S.drum + '.', 'small, medium or large.', { applies_to: 'settings' }) };
      var p = site.resistance_Pa[S.resistance === 'low' ? 0 : 1], v = S.cut_m_s, rho = S.rho_kg_m3, mu = num(S.mu) ? S.mu : null;
      var cutPerDepth = S.pairs * S.imbalance * p * D.width_m;            // N per metre of depth: the cutting imbalance
      var momPerDepth = 2 * S.pairs * rho * D.width_m * v * v;           // N per metre of depth: mdot v
      var perDepth = cutPerDepth + momPerDepth;
      var Wn = site.weightNormal_N, Wt = site.alongSlope_N;
      var side = perDepth * S.depth_m, mdot = 2 * S.pairs * rho * D.width_m * S.depth_m * v;
      var dMax = mu === null ? null : Math.max(0, (mu * Wn - Wt) / perDepth);   // the deepest cut the feet hold at mu
      var slides = mu !== null && Wt + side > mu * Wn;
      var need = mu === null ? side : Math.max(0, Wt + side - mu * Wn), holdRate = site.holdKgPerNHour;
      var thrustWanted = S.hold === 'thrust';
      var thrustAvail = thrustWanted && num(holdRate) && num(site.propellantLeft_kg) && site.propellantLeft_kg > 0 && !site.thrustBudgetShort;
      var thrustOk = thrustAvail && need > 0;
      var depthUsed = slides && !thrustOk ? dMax : S.depth_m;
      var mdotUsed = 2 * S.pairs * rho * D.width_m * depthUsed * v, sideUsed = perDepth * depthUsed;
      var feet = thrustOk ? (mu === null ? Wt : Math.min(Wt + sideUsed, mu * Wn)) : Wt + sideUsed;   // what the feet hold along the ground
      return { drum: D, p_Pa: p, vTip_m_s: SRC.ipex.tipToCutSpeed * v, rho: rho, mu: mu, perDepth_N_m: perDepth, cutPerDepth_N_m: cutPerDepth, momPerDepth_N_m: momPerDepth,
        side_N: side, mdot_kg_s: mdot, weightNormal_N: Wn, alongSlope_N: Wt, slides: slides, depthMax_m: dMax,
        depthUsed_m: depthUsed, mdotUsed_kg_s: mdotUsed, sideUsed_N: sideUsed, holdThrust_N: thrustOk ? need : 0, holdKgPerHour: thrustOk ? need * holdRate : 0,
        friction_slope: Wn > 0 ? Wt / Wn : null, friction_needed: Wn > 0 ? (Wt + side) / Wn : null, friction_feet: Wn > 0 ? feet / Wn : null,
        thrustWanted: thrustWanted, thrustOk: thrustOk, depthCapped: depthUsed < S.depth_m, scoopFraction: S.depth_m / D.scoop_h_m };
    }

    // ---------------------------------------------------------------------------------------------- import (idea 44)
    function keyOf(body) { if (/^99942\b/.test(body)) return 'apophis'; if (/^101955\b/.test(body)) return 'bennu'; return null; }
    function designationOf(key) { return key === 'apophis' ? '99942' : '101955'; }
    function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-30); }
    /**
     * Idea 44's handoff, checked without re-flying its descent (that needs idea 43's whole shape kernel, 300 KB here, and
     * seconds): the envelope, the surface state's fields and units, its own arithmetic (weight = m a, normal part = weight
     * cos(slope), along-slope part = weight sin(slope)), and its attitude at the epoch against idea 43's spin to 1e-3.
     */
    function importTouch(h) {
      var bad = function (why) { return { refusal: refusal('invalid_input', 'This idea 44 handoff ' + why + '.', 'The unedited handoff idea 44 exported.', { applies_to: 'handoff' }) }; };
      var o = h.outputs || {}, ss = o.surface_state && o.surface_state.value, ct = o.contact && o.contact.value;
      if (!ss || !ct) return bad('has no surface_state or contact');
      if (!/m\/s\^2/.test(o.surface_state.units || '')) return bad('gives the surface state without its units');
      if (!num(ss.epoch_tdb_s) || !Array.isArray(ss.normal_body) || ss.normal_body.length !== 3 || !num(ss.accel_m_s2) || !num(ss.slope_deg) || !Array.isArray(ss.C_icrf_to_body)) return bad('is missing the epoch, site normal, acceleration, slope or attitude');
      if (Math.abs(norm(ss.normal_body) - 1) > 1e-6) return bad('has a site normal that is not a unit vector');
      var key = keyOf(ss.body || '');
      if (!key) return { refusal: refusal('not_found', 'No spin, ephemeris or spectral class here for ' + ss.body + '.', 'Bennu or Apophis (the two bodies idea 43 has shapes for).', { applies_to: 'body' }) };
      if (ss.spacecraft_mass_kg !== null) {
        if (!num(ss.weight_N) || rel(ss.weight_N, ss.spacecraft_mass_kg * ss.accel_m_s2) > 1e-6) return bad('says the spacecraft weighs ' + ss.weight_N + ' N, not its mass times the acceleration');
        if (rel(ss.hold_normal_N, ss.weight_N * Math.cos(ss.slope_deg * DEG)) > 1e-6 || rel(ss.along_slope_N, ss.weight_N * Math.sin(ss.slope_deg * DEG)) > 1e-6) return bad('splits the weight on the slope wrongly');
      }
      var a = L43.attitudeAt(key, ss.epoch_tdb_s); if (a.refusal) return { refusal: a.refusal };
      var dC = 0; for (var i = 0; i < 9; i++) dC = Math.max(dC, Math.abs(a.C[i] - ss.C_icrf_to_body[i]));
      if (dC > 1e-3) return bad('turns the body ' + dC.toExponential(1) + ' away from idea 43\'s spin at its own epoch');
      var res = ct.resistance_Pa; if (!Array.isArray(res) || res.length !== 2 || !(res[0] > 0 && res[1] >= res[0])) return bad('has no regolith resistance');
      var l43 = h.inputs && h.inputs.lumpy_handoff, rho43 = l43 && l43.outputs && l43.outputs.body && l43.outputs.body.value && l43.outputs.body.value.density_kg_m3;
      var sb = SRC.sbdb[designationOf(key)], rhoSb = sb.density_g_cm3 ? parseFloat(sb.density_g_cm3.value) * 1000 : null;
      var carried = (h.refusals || []).map(function (r) { var c = clone(r); if (!c.from) c.from = '44-touch-and-go'; return c; });
      var pr = o.propellant && o.propellant.value;
      return { kind: key, designation: designationOf(key), h44: h, carried: carried, surface: ss, attitudeDiff: dC,
        site: { body: ss.body, face: ss.site_face, epoch: ss.epoch_tdb_s, normal: ss.normal_body.slice(), aim: ss.aim_body_m, accel: ss.accel_m_s2, gravity: ss.gravity_m_s2, slope_deg: ss.slope_deg,
          mass_kg: ss.spacecraft_mass_kg, isp_s: ss.isp_s, holdKgPerNHour: ss.hold_propellant_kg_per_N_hour, propellantLeft_kg: ss.propellant_left_kg, propellantShort_kg: ss.propellant_short_kg,
          resistance_Pa: res.slice(), rho43: num(rho43) ? rho43 : null, rhoSbdb: rhoSb, rhoSbdbRef: sb.density_g_cm3 ? sb.density_g_cm3.ref : null, propellant: pr || null } };
    }

    // ---------------------------------------------------------------------------------------------- settings
    function defaults(src) {
      var st = src.site;
      return { analog: 'auto', run: 'D', peakS_C: 750, rateS_C_min: 10, T0_K: T_REF, recovery: 0,
        aperture_m2: AP.spacecraft.orex.solarArray_m2, eta_opt: 0.85, conc: 300, eps: 1, horizon_deg: 0, stay_days: 90,
        oven_kg: 25, drum: 'small', pairs: 1, depth_m: SRC.ipex.cutDepth_m, cut_m_s: SRC.ipex.cutSpeeds_m_s[0], imbalance: 0.1, resistance: 'high', hold: 'weight', mu: null,
        rho_kg_m3: st.rho43 || st.rhoSbdb, mass_kg: st.mass_kg !== null ? st.mass_kg : AP.spacecraft.orex.dry_kg };
    }
    function validSettings(S) {
      var e = [], r = function (k, lo, hi, txt) { if (!(num(S[k]) && S[k] >= lo && S[k] <= hi)) e.push(k + ' must be ' + lo + ' to ' + hi + (txt || '')); };
      if (['auto', 'cm', 'ordinary'].indexOf(S.analog) < 0) e.push('analog must be auto, cm or ordinary');
      if (!RUNS[S.run]) e.push('run must be one of ' + Object.keys(RUNS).join(', '));
      r('peakS_C', 200, 1000, ' C'); r('rateS_C_min', 1, 50, ' C/min'); r('T0_K', T_REF, 400, ' K (Robie and Hemingway start at 298.15 K)'); r('recovery', 0, 0.9);
      r('aperture_m2', 0.1, 2000, ' m^2'); r('eta_opt', 0.1, 1); r('conc', 1, 20000); r('eps', 0.05, 1); r('horizon_deg', 0, 45, ' deg'); r('stay_days', 1, 365, ' days');
      r('oven_kg', 0.01, 10000, ' kg'); r('pairs', 1, 8); r('depth_m', 0.0005, 0.1, ' m'); r('cut_m_s', 0.0005, 0.1, ' m/s'); r('imbalance', 0, 1); r('rho_kg_m3', 300, 4000, ' kg/m^3'); r('mass_kg', 1, 1e6, ' kg');
      if (num(S.pairs) && Math.round(S.pairs) !== S.pairs) e.push('pairs must be a whole number');
      if (['small', 'medium', 'large'].indexOf(S.drum) < 0) e.push('drum must be small, medium or large');
      if (['low', 'high'].indexOf(S.resistance) < 0) e.push('resistance must be low or high');
      if (['weight', 'thrust'].indexOf(S.hold) < 0) e.push('hold must be weight or thrust');
      if (S.mu !== null && S.mu !== undefined) r('mu', 0.01, 3, ' (or null: the feet are not judged)');
      return e;
    }

    // ---------------------------------------------------------------------------------------------- the run
    function run(src, settings) {
      var S = Object.assign(defaults(src), settings || {}), errs = validSettings(S);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      var st = src.site, own = [], assumptions = [];
      var fs = feedstock(S, src.designation); if (fs.refusal) return { refusal: fs.refusal, S: S };
      if (fs.Tpk <= S.T0_K + 1) return { refusal: refusal('invalid_input', 'The oven\'s peak (' + (fs.Tpk - 273.15).toFixed(0) + ' °C) is not above the regolith\'s start (' + (S.T0_K - 273.15).toFixed(0) + ' °C).', 'A hotter oven or a colder start.', { applies_to: 'settings' }), S: S };
      var en = energy(fs.w, S.T0_K, fs.Tpk, S.recovery); if (en.refusal) return { refusal: en.refusal, S: S };
      // the site's weight: idea 44's numbers when the mass is idea 44's, otherwise the same arithmetic on the mass set here
      var mass = S.mass_kg, weight = mass * st.accel, Wn = weight * Math.cos(st.slope_deg * DEG), Wt = weight * Math.sin(st.slope_deg * DEG);
      var siteD = { resistance_Pa: st.resistance_Pa, weightNormal_N: Wn, alongSlope_N: Wt, holdKgPerNHour: st.holdKgPerNHour, propellantLeft_kg: st.propellantLeft_kg === null && st.propellantShort_kg > 0 ? 0 : st.propellantLeft_kg, thrustBudgetShort: false };
      var dg = dig(S, siteD); if (dg.refusal) return { refusal: dg.refusal, S: S };
      // the stay: from the contact, as long as asked, the ephemeris and the spin allow
      var span = ephSpan(src.kind), daysAsked = S.stay_days, daysEph = Math.floor((span[1] - st.epoch) / DAY);
      if (!(st.epoch >= span[0] && daysEph >= 1)) return { refusal: refusal('out_of_envelope', 'The contact epoch ' + utcOf(st.epoch).slice(0, 10) + ' is outside this folder\'s Horizons table for ' + src.kind + ' (' + utcOf(span[0]).slice(0, 10) + ' to ' + utcOf(span[1]).slice(0, 10) + ').', 'A longer ephemeris (oracle/fetch-sources.sh, build-data.mjs).', { applies_to: 'ephemeris' }), S: S };
      var days = Math.min(daysAsked, daysEph);
      var sun = sunlight(src.kind, st.epoch, days, st.normal, S.horizon_deg);
      if (sun.days.length < 1) return { refusal: sun.stopped ? sun.stopped.refusal : refusal('out_of_envelope', 'No whole day of sunlight could be computed.', 'An earlier epoch.'), S: S };
      if (sun.days.length < daysAsked) {
        var why = sun.stopped ? sun.stopped.refusal.reason : 'this folder\'s Horizons table for ' + src.kind + ' ends ' + utcOf(span[1]).slice(0, 10) + '.';
        own.push(refusal('out_of_envelope', 'The stay is cut to ' + sun.days.length + ' of the ' + daysAsked + ' days asked: ' + why, sun.stopped ? (sun.stopped.refusal.what_would_help || 'An earlier epoch.') : 'A longer ephemeris.', { applies_to: 'stay' }));
      }
      // holding the cut by thrust: only while idea 44's propellant lasts the whole stay (the drums dig while the Sun is up)
      var litStay_s = sun.days.reduce(function (a, d) { return a + d.lit_s; }, 0), holdStay = null;
      if (dg.thrustOk) {
        holdStay = dg.holdKgPerHour * litStay_s / HOUR;
        if (holdStay > siteD.propellantLeft_kg) {
          own.push(refusal('out_of_envelope', 'Holding the cut by thrust takes ' + (1000 * dg.holdThrust_N).toFixed(1) + ' mN for the stay\'s ' + (litStay_s / HOUR).toFixed(0) + ' hours of digging: ' + holdStay.toPrecision(3) + ' kg of propellant at idea 44\'s ' + st.holdKgPerNHour.toPrecision(4) + ' kg per N-hour, and idea 44 hands on ' + siteD.propellantLeft_kg.toPrecision(3) + ' kg. Thrust is not used.', 'More propellant left after landing, a shorter stay, or a shallower, slower or better-balanced cut.', { applies_to: 'hold' }));
          siteD.thrustBudgetShort = true; dg = dig(S, siteD);
        }
      }
      // the daily ledger
      var P = { eta_opt: S.eta_opt, conc: S.conc, eps: S.eps }, tBatch = (fs.Tpk - S.T0_K) / fs.rate_K_s;
      var heatDay = null, timeline = sun.days.map(function (d) {
        var S_mean = d.lit_s > 0 ? d.insolation_J_m2 / d.lit_s : 0;
        var q = S.aperture_m2 * Math.max(0, S.eta_opt * d.insolation_J_m2 - S.eps * SIGMA * Math.pow(fs.Tpk, 4) / S.conc * d.lit_s);
        var mHeat = q / en.perKgRegolith_J, mOven = S.oven_kg * d.lit_s / tBatch, mDig = dg.mdotUsed_kg_s * d.lit_s;
        var m = Math.min(mHeat, mOven, mDig), lim = m === mHeat ? 'heat' : m === mOven ? 'oven' : 'dig';
        return { day: d.day, utc0: utcOf(d.tdb0), r_au: d.r_au, lit_h: d.lit_s / HOUR, S_mean_W_m2: S_mean, heat_J: q, regolith_kg: m, water_kg: m * fs.w, limit: lim,
          regolithHeat_kg: mHeat, regolithOven_kg: mOven, regolithDig_kg: mDig, otherGas_kg: m * (fs.others.co2 + fs.others.so2 + fs.others.organics) };
      });
      var W = timeline.map(function (d) { return d.water_kg; }), tot = W.reduce(function (a, b) { return a + b; }, 0);
      var lim = { heat: 0, oven: 0, dig: 0 }; timeline.forEach(function (d) { lim[d.limit]++; });
      var litTot = timeline.reduce(function (a, d) { return a + d.lit_h; }, 0);
      var S0 = S1AU * Math.pow(AU / sun.days[0].r_au / AU, 2);
      var rec = { eta_rec_epoch: S0 > 0 ? receiverFlux(S0, fs.Tpk, P) / (S.eta_opt * S0) : 0, minConc_epoch: minConcentration(S0, fs.Tpk, P), S1AU: S1AU, S_epoch: S0 };
      var holdDay = dg.holdKgPerHour * litTot / timeline.length;
      // refusals this module raises
      if (fs.analog === 'ordinary') own.push(refusal('insufficient_data', 'For an S-type the water is the ' + SRC.itokawa.bulk_ppm[0] + '–' + SRC.itokawa.bulk_ppm[1] + ' ppm Itokawa\'s returned grains carry in their pyroxene and olivine (Jin and Bose 2019), all of it counted: how much an oven at ' + (fs.Tpk - 273.15).toFixed(0) + ' °C releases from nominally anhydrous minerals is not measured in these sources, so every water number here is an upper bound.', 'A heating experiment on an ordinary chondrite (LL) or on Itokawa grains, with the water measured against temperature and time.', { applies_to: 'release' }));
      else own.push(refusal('insufficient_data', 'The water released is Murchison\'s (a CM2 meteorite, ' + SRC.murchison.runs.length + ' chips heated by Suttle et al. 2024), not this asteroid\'s: chips of the same meteorite gave ' + (100 * fs.range750[0]).toFixed(1) + '–' + (100 * fs.range750[1]).toFixed(1) + ' wt% by 750 °C. Bennu\'s returned sample is CI-like (Glavin et al. 2025); its release curve is not in this folder.', 'A heating experiment on the returned Bennu (or Ryugu) sample, or on the target\'s own regolith.', { applies_to: 'feedstock' }));
      if (fs.hypothetical) own.push(refusal('out_of_envelope', 'The analog is set by hand against the body\'s spectral class (' + fs.spec.value + ', ' + fs.spec.ref + '): this is a what-if, not this asteroid.', 'Leave the analog on auto.', { applies_to: 'analog' }));
      own.push(refusal('insufficient_data', 'Digging resistance is idea 44\'s fit to OSIRIS-REx\'s 10 cm/s contact at Bennu (' + st.resistance_Pa.map(function (x) { return x.toFixed(0); }).join('–') + ' Pa), used as the pressure on a drum\'s cut face; nothing has been excavated in milligravity, and the drums\' own forces were measured only in lunar simulant at 1 g (IPEx), where the vertical force was the weight of the regolith caught: whether a cut lifts a lander that weighs millinewtons is not measured, and not modelled here.', 'An excavation test in the target\'s regolith, or in a simulant on a reduced-gravity flight, with the vertical force measured.', { applies_to: 'excavation' }));
      own.push(refusal('insufficient_data', 'The horizon is the site plate\'s own plane: shadows from boulders and the rest of the body are not cast (idea 43\'s shapes have 25 m plates). Set a horizon mask to be conservative.', 'A terrain model at metre scale and a ray-traced horizon.', { applies_to: 'terrain' }));
      var whyNoThrust = !dg.thrustWanted || dg.thrustOk ? '' : !num(st.holdKgPerNHour) ? ' Thrusters cannot help: no specific impulse is handed on (idea 44).' : !(siteD.propellantLeft_kg > 0) ? ' Thrusters cannot help: the spacecraft has no propellant left (idea 44).' : siteD.thrustBudgetShort ? ' Thrusters cannot help for the whole stay (refusal hold).' : '';
      var fmm = function (x) { return (1000 * x).toFixed(1) + ' mN'; };
      if (!dg.thrustOk && dg.mu === null) own.push(refusal('insufficient_data', 'Digging ' + (1000 * S.depth_m).toFixed(1) + ' mm deep pushes the spacecraft ' + fmm(dg.side_N) + ' sideways (the drums\' cutting imbalance and the dug regolith brought to its speed); with the slope\'s own ' + fmm(Wt) + ' along the ground the feet need a friction coefficient of ' + dg.friction_needed.toFixed(2) + ' against ' + fmm(Wn) + ' of weight on the ground (' + dg.friction_slope.toFixed(2) + ' for the slope alone). No friction is measured for this regolith, so whether the feet slip is not judged.' + whyNoThrust, 'A friction coefficient for the feet on this regolith (set one here as a what-if), or propellant to cancel the sideways push with thrust.', { applies_to: 'traction' }));
      if (!dg.thrustOk && dg.slides) own.push(refusal('out_of_envelope', (dg.depthMax_m === 0 ? 'At the friction coefficient set here (' + dg.mu + ', a what-if) the spacecraft slides on this slope before it digs (the slope alone needs ' + dg.friction_slope.toFixed(2) + '): no digging.' : 'Digging ' + (1000 * S.depth_m).toFixed(1) + ' mm deep pushes ' + fmm(dg.side_N) + ' sideways; with the slope the feet need a friction coefficient of ' + dg.friction_needed.toFixed(2) + ', above the ' + dg.mu + ' set here (a what-if): the cut is held to ' + (1000 * dg.depthMax_m).toFixed(2) + ' mm.') + whyNoThrust, 'A shallower, slower or better-balanced cut, more mass on the ground, thrust with propellant, or anchors (refused in idea 44).', { applies_to: 'traction' }));
      if (rec.eta_rec_epoch <= 0) own.push(refusal('out_of_envelope', 'At concentration ' + S.conc + ' the oven\'s opening radiates more at ' + (fs.Tpk - 273.15).toFixed(0) + ' °C than the mirror brings: no heat goes in. It needs at least ' + rec.minConc_epoch.toFixed(0) + '.', 'A higher concentration or a cooler oven.', { applies_to: 'receiver' }));
      if (en.extrapolated_K > 0) assumptions.push('Robie and Hemingway\'s enstatite equation ends at 1000 K; the oven\'s ' + fs.Tpk.toFixed(0) + ' K is ' + en.extrapolated_K.toFixed(0) + ' K beyond it (extrapolated).');
      assumptions.unshift(
        'Frames and time: the Sun direction from JPL Horizons (ICRF axes, TDB), turned into idea 43\'s body frame (' + (src.kind === 'bennu' ? 'IAU_BENNU, bennu_v17.tpc' : 'APOPHIS_CK, NAIF CK samples with Euler\'s equations') + '); the site normal is idea 44\'s plate ' + st.face + '. UTC = TDB - ' + TDB_UTC + ' s.',
        'Sunlight: ' + S1AU.toFixed(1) + ' W/m^2 at 1 au (idea 40\'s solar luminosity over 4 pi au^2), scaled by (1 au / r)^2; a Sun-tracking concentrator works while the Sun is more than ' + S.horizon_deg + ' deg above the site plane; the oven is shut in the dark (no heat lost at night, none kept).',
        'Heat: Hess\'s law over Robie and Hemingway (1995): the water as chrysotile breaking down to forsterite + enstatite + steam, the rest of the rock as forsterite; the steam leaves at the oven temperature; ' + (S.recovery > 0 ? (100 * S.recovery).toFixed(0) + '% of the spent rock\'s heat preheats the next batch' : 'no heat recovered') + '; CO2, SO2 and organics leave too (their heats of reaction left out).',
        'Oven: batches of ' + S.oven_kg + ' kg heated at the run\'s rate (' + (fs.rate_K_s * 60).toFixed(0) + ' K/min), ' + (tBatch / 60).toFixed(0) + ' min each, only while lit; cavity emissivity ' + S.eps + ', concentration ' + S.conc + ', optical efficiency ' + S.eta_opt + ' (design choices, not data).',
        'Digging: ' + S.pairs + ' pair(s) of ' + dg.drum.name + 's, counter-rotating (imbalance ' + S.imbalance + ', assumed), ' + (1000 * dg.depthUsed_m).toFixed(2) + ' mm deep at ' + (1000 * S.cut_m_s).toFixed(0) + ' mm/s, only while lit; the sideways force is the cutting imbalance plus the dug regolith brought to the craft\'s speed (the buckets\' fling to their tip speed is caught inside the drums); feet friction ' + (dg.mu === null ? 'not judged (none measured)' : dg.mu + ' (a what-if)') + '; regolith ' + S.rho_kg_m3.toFixed(0) + ' kg/m^3 (' + (S.rho_kg_m3 === st.rho43 ? 'idea 43\'s bulk density' : S.rho_kg_m3 === st.rhoSbdb ? 'the body\'s bulk density, SBDB' : 'set here') + ').');
      return { src: src, S: S, feed: fs, energy: en, dig: dg, sun: sun, timeline: timeline, receiver: rec, tBatch_s: tBatch, mass_kg: mass, weight_N: weight, weightNormal_N: Wn, alongSlope_N: Wt,
        water: { mean: tot / timeline.length, min: Math.min.apply(null, W), max: Math.max.apply(null, W), total: tot, days: timeline.length, limits: lim }, holdKgPerDay: holdDay, holdStay_kg: dg.thrustOk ? holdStay : null,
        period_h: L43.attitudeAt(src.kind, st.epoch).period_h, plateTilt_deg: st.aim ? Math.acos(Math.max(-1, Math.min(1, dot(unit(st.normal), unit(st.aim))))) / DEG : null,
        carried: src.carried, own: own, assumptions: assumptions };
    }

    // ---------------------------------------------------------------------------------------------- reality
    /** What the model is compared with on the page: other measurements of the same kind of rock, and Bennu from orbit. */
    function reality(R) {
      var M = SRC.murchison, D = M.runs.filter(function (r) { return r.id === 'D'; })[0], wD = D.h2o_wt / 100, P = SRC.bennuOrbit;
      var toW = function (h) { return h / H_PER_H2O; };   // H wt% -> H2O-equivalent wt%
      var rows = [
        { what: 'CM water by 750 °C in vacuum (Murchison run D) against Winchcombe, another CM, by stepwise pyrolysis above 200 °C', model: 100 * wD, real: SRC.winchcombe.water_wt, sigma: SRC.winchcombe.sigma_wt, units: 'wt%', source: SRC.winchcombe.cite },
        { what: 'The same against Bennu from orbit at Nightingale\'s latitude (OVIRS, ~' + P.h_wt_highLat + ' wt% H above ' + P.highLat_deg + '°N, as water)', model: 100 * wD, real: toW(P.h_wt_highLat), units: 'wt%', source: P.cite },
        { what: 'The same against Bennu\'s surface average from orbit (' + P.h_wt_mean + ' wt% H as water)', model: 100 * wD, real: toW(P.h_wt_mean), units: 'wt%', source: P.cite },
        { what: 'Serpentine implied by run D\'s water (by mass) against Murchison\'s phyllosilicate (~' + M.phyllosilicate_vol_pct + ' vol%, Suttle et al.)', model: 100 * wD / XW, real: M.phyllosilicate_vol_pct, units: '%', source: M.cite },
        { what: 'Chips of one meteorite against each other: the 750 °C runs\' spread (low to high)', model: 100 * Math.min.apply(null, M.runs.filter(function (r) { return r.peak_C === 750; }).map(function (r) { return r.h2o_wt / 100; })), real: 100 * Math.max.apply(null, M.runs.filter(function (r) { return r.peak_C === 750; }).map(function (r) { return r.h2o_wt / 100; })), units: 'wt%', source: M.cite },
        { what: 'Heat to free bound water (chrysotile to forsterite + enstatite + steam, 298 K) against evaporating free liquid water (steam - liquid), both Robie and Hemingway', model: energy(0.1, T_REF, T_REF, 0).perKgWaterReaction_J / 1e6, real: (ST.dHf_kJ_mol - SRC.thermo.liquidWater.dHf_kJ_mol) / ST.M_g_mol, units: 'MJ/kg', source: SRC.thermo.cite }
      ];
      rows.forEach(function (r) { r.gap_pct = num(r.real) && r.real !== 0 ? 100 * (r.model - r.real) / r.real : null; });
      // the closed form for a principal-axis spinner: the fraction of a turn the Sun is above the plane, from the
      // plane's tilt to the spin axis and the Sun's declination in the body frame (Bennu only)
      if (R && R.src.kind === 'bennu') {
        var st = R.src.site, q = sunInBody('bennu', st.epoch), n = unit(st.normal), z = [0, 0, 1];
        var latN = Math.asin(dot(n, z)), dec = Math.asin(dot(q.s, z)), x = -Math.tan(latN) * Math.tan(dec);
        var frac = x <= -1 ? 1 : x >= 1 ? 0 : Math.acos(x) / PI;
        var rot = L43.attitudeAt('bennu', st.epoch), period = rot.period_h * HOUR;
        // the same fraction by sampling one turn at 20 s with the kernel (no interpolation)
        var up = 0, N = Math.round(period / 20);
        for (var i = 0; i < N; i++) { var e = sunElevation('bennu', st.epoch + (i + 0.5) * period / N, st.normal); if (e.el_deg > 0) up++; }
        rows.push({ what: 'Daylight at the site over one Bennu turn: sampled with idea 43\'s spin against the closed form arccos(-tan(lat) tan(dec)) / pi', model: 100 * up / N, real: 100 * frac, units: '% of a turn', source: 'spherical trigonometry (a principal-axis spin, the Sun fixed over one ' + rot.period_h.toFixed(2) + ' h turn of bennu_v17.tpc)' });
        rows[rows.length - 1].gap_pct = frac > 0 ? 100 * (up / N - frac) / frac : null;
      }
      return rows;
    }

    // ---------------------------------------------------------------------------------------------- the handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function latLon(v) { var n = unit(v); return [Math.asin(n[2]) / DEG, ((Math.atan2(n[1], n[0]) / DEG) + 360) % 360]; }
    function buildHandoff(R, produced) {
      var S = R.S, fs = R.feed, en = R.energy, dg = R.dig, st = R.src.site, tl = R.timeline, ll = latLon(st.aim || st.normal);
      var conf = fs.analog === 'cm' ? 'derived' : 'assumed';
      var inputs = { touch_handoff: R.src.h44, settings: clone(S) };
      var out = {
        site: qv({ body: st.body, key: R.src.kind, spectral_class: fs.spec ? fs.spec.value : null, spectral_class_ref: fs.spec ? fs.spec.ref : null, epoch_tdb_s: st.epoch, epoch_utc: utcOf(st.epoch), face: st.face,
          lat_lon_deg: vr9(ll), normal_body: vr9(st.normal), accel_m_s2: r9(st.accel), slope_deg: r9(st.slope_deg), mass_kg: r9(R.mass_kg), weight_N: r9(R.weight_N), weight_normal_N: r9(R.weightNormal_N), attitude_check: r9(R.src.attitudeDiff) },
          'm/s^2, deg, kg, N', 'derived', KERNEL + ' importTouch(): idea 44\'s surface state, checked against its own arithmetic and idea 43\'s spin'),
        feedstock: qv({ analog: fs.analog, label: fs.label, hypothetical: !!fs.hypothetical, run: fs.run ? fs.run.id : null, peak_K: r9(fs.Tpk), rate_K_s: r9(fs.rate_K_s), water_mass_fraction: r9(fs.w), bound: fs.bound,
          water_range_750C: fs.range750 ? vr9(fs.range750) : null, other_gases_mass_fraction: { co2: r9(fs.others.co2), so2: r9(fs.others.so2), organics: r9(fs.others.organics) }, serpentine_fraction: r9(en.f_serpentine) },
          'kg/kg, K, K/s', fs.analog === 'cm' ? 'measured' : 'assumed', fs.analog === 'cm' ? SRC.murchison.cite : SRC.itokawa.cite),
        energy: qv({ T0_K: r9(en.T0), Tpeak_K: r9(en.Tpk), per_kg_regolith_J: r9(en.perKgRegolith_J), per_kg_water_J: r9(en.perKgWater_J), parts_J_per_kg: { solids: r9(en.parts_J_per_kg.solids), reaction: r9(en.parts_J_per_kg.reaction), steam: r9(en.parts_J_per_kg.steam), recovered: r9(en.parts_J_per_kg.recovered) },
          reaction_J_per_kg_water: r9(en.perKgWaterReaction_J), extrapolated_K: r9(en.extrapolated_K), recovery: S.recovery }, 'J/kg, K', 'derived', KERNEL + ' energy(): Hess\'s law over Robie and Hemingway (1995)'),
        collector: qv({ aperture_m2: S.aperture_m2, eta_opt: S.eta_opt, concentration: S.conc, emissivity: S.eps, S_1au_W_m2: r9(R.receiver.S1AU), S_epoch_W_m2: r9(R.receiver.S_epoch), receiver_efficiency_epoch: r9(R.receiver.eta_rec_epoch), min_concentration_epoch: r9(R.receiver.minConc_epoch) },
          'm^2, W/m^2', 'derived', KERNEL + ' receiverFlux(): mirror less the cavity\'s eps sigma T^4 / C'),
        sunlight: qv({ days: tl.length, horizon_deg: S.horizon_deg, lit_fraction: r9(tl.reduce(function (a, d) { return a + d.lit_h; }, 0) / (24 * tl.length)), r_au_range: [r9(Math.min.apply(null, tl.map(function (d) { return d.r_au; }))), r9(Math.max.apply(null, tl.map(function (d) { return d.r_au; })))],
          sampling: { sub_s: R.sun.dtSub, kernel_s: R.sun.kStep } }, 'days, deg, au, s', 'derived', KERNEL + ' sunlight(): JPL Horizons distance and direction, idea 43\'s spin'),
        dig: qv({ drum: S.drum, pairs: S.pairs, width_m: r9(dg.drum.width_m), depth_set_m: S.depth_m, depth_used_m: r9(dg.depthUsed_m), depth_max_m: dg.depthMax_m === null ? null : r9(dg.depthMax_m), cut_m_s: S.cut_m_s, rho_kg_m3: r9(dg.rho), resistance_Pa: r9(dg.p_Pa),
          sideways_set_N: r9(dg.side_N), sideways_used_N: r9(dg.sideUsed_N), weight_normal_N: r9(dg.weightNormal_N), along_slope_N: r9(dg.alongSlope_N), friction_needed_slope: r9(dg.friction_slope), friction_needed: r9(dg.friction_needed), friction_coefficient: dg.mu, slides_as_set: dg.slides,
          rate_kg_s: r9(dg.mdotUsed_kg_s), hold: S.hold, hold_thrust_N: r9(dg.holdThrust_N), hold_propellant_kg_per_day: r9(R.holdKgPerDay), hold_propellant_stay_kg: R.holdStay_kg === null ? null : r9(R.holdStay_kg) },
          'm, m/s, kg/m^3, Pa, N, kg/s, kg/day, kg', 'assumed', KERNEL + ' dig(): IPEx drums (horizontal excavation force, counter-rotating), idea 44\'s regolith resistance, friction needed (not judged unless a coefficient is set)'),
        timeline: qv({ day: tl.map(function (d) { return d.day; }), utc0: tl.map(function (d) { return d.utc0; }), r_au: tl.map(function (d) { return r6(d.r_au); }), lit_h: tl.map(function (d) { return r6(d.lit_h); }),
          heat_J: tl.map(function (d) { return r6(d.heat_J); }), regolith_kg: tl.map(function (d) { return r6(d.regolith_kg); }), water_kg: tl.map(function (d) { return r6(d.water_kg); }), limit: tl.map(function (d) { return d.limit; }) },
          'days, au, h, J, kg', conf, KERNEL + ' run(): the daily ledger, min(heat, oven, digging)'),
        water_rate: qv({ mean_kg_per_day: r9(R.water.mean), min_kg_per_day: r9(R.water.min), max_kg_per_day: r9(R.water.max), total_kg: r9(R.water.total), days: R.water.days, first_day_utc: tl[0].utc0, bound: fs.bound,
          limits: R.water.limits, other_gases_kg_per_day: r9(tl.reduce(function (a, d) { return a + d.otherGas_kg; }, 0) / tl.length), regolith_kg_per_day: r9(tl.reduce(function (a, d) { return a + d.regolith_kg; }, 0) / tl.length) },
          'kg/day, kg', conf, KERNEL + ' run(): water produced per day over the stay (' + (fs.bound === 'upper' ? 'an upper bound' : 'from Murchison\'s measured release') + ')')
      };
      return { handoff: 'long-way-round', version: 1, from: '45-dig', produced: produced || new Date().toISOString(), inputs: inputs, outputs: out, refusals: R.carried.concat(R.own).map(clone), assumptions: R.assumptions.slice() };
    }

    function codes(rs) { return (rs || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join('|'); }
    function numDiff(a, b, path, tol) {
      if (typeof a === 'number' || typeof b === 'number') { if (!(num(a) && num(b))) return a === b ? null : path; return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) ? null : path; }
      if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return path; for (var i = 0; i < a.length; i++) { var d = numDiff(a[i], b[i], path + '[' + i + ']', tol); if (d) return d; } return null; }
      if (a && b && typeof a === 'object' && typeof b === 'object') { var ks = Object.keys(b); if (Object.keys(a).length !== ks.length) return path; for (var j = 0; j < ks.length; j++) { var e = numDiff(a[ks[j]], b[ks[j]], path + '.' + ks[j], tol); if (e) return e; } return null; }
      return a === b ? null : path;
    }
    /** Read a handoff: idea 44's (checked, see importTouch) or this page's own (everything recomputed and compared to 1e-6). */
    function parseHandoff(h) {
      var o = h;
      if (typeof h === 'string') { try { o = JSON.parse(h); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 44 or from this page.') }; } }
      if (!o || o.handoff !== 'long-way-round' || o.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 44 or from this page.') };
      if (o.from === '44-touch-and-go') { var s = importTouch(o); return s.refusal ? s : { from: '44-touch-and-go', src: s, settings: null }; }
      if (o.from !== '45-dig') return { refusal: refusal('invalid_input', 'That handoff is from ' + o.from + '; this module takes idea 44\'s or its own.', o.from === '43-lumpy' ? 'Open it in idea 44 (Touch and Go) first and bring its export.' : 'A handoff from idea 44 (Touch and Go) or from this page.') };
      var I = o.inputs || {};
      if (!I.touch_handoff || !I.settings) return { refusal: refusal('invalid_input', 'This 45 handoff carries no idea 44 handoff or no settings.', 'The unedited handoff this page exported.') };
      var src = importTouch(I.touch_handoff); if (src.refusal) return src;
      var R = run(src, I.settings); if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, o.produced);
      for (var k in again.outputs) {
        var dd = numDiff(o.outputs && o.outputs[k] && o.outputs[k].value, again.outputs[k].value, k, 1e-6);
        if (dd) return { refusal: refusal('invalid_input', 'The handoff says ' + dd + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      if (codes(o.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '45-dig', h45: o, src: src, settings: I.settings, R: R };
    }

    return {
      S1AU: S1AU, SIGMA: SIGMA, XW: XW, H_PER_H2O: H_PER_H2O, utcOf: utcOf, tdbOfUtc: tdbOfUtc, cpRH: cpRH, dhRH: dhRH, energy: energy, feedstock: feedstock, analogOfClass: analogOfClass, classOf: classOf,
      helio: helio, ephSpan: ephSpan, hermite: hermite, sunInBody: sunInBody, sunElevation: sunElevation, sunlight: sunlight, receiverFlux: receiverFlux, minConcentration: minConcentration, dig: dig,
      importTouch: importTouch, defaults: defaults, validSettings: validSettings, run: run, reality: reality, buildHandoff: buildHandoff, parseHandoff: parseHandoff, codes: codes, numDiff: numDiff, latLon: latLon,
      sources: SRC, runs: RUNS, clearCache: function () { cache = {}; }
    };
  }
  return { create: create, cpRH: cpRH, dhRH: dhRH };
});
