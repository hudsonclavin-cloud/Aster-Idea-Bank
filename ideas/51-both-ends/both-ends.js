// Both Ends: one Aster round trip flown with a Skyhook tether at both ends of it.
//
// Aster plans the trip (Earth-departure C3, the burns at the asteroid, the Earth-arrival speed);
// Skyhook's tether throws the payload out from its upper tip and catches it there on the way home.
// This kernel joins the two: for a required C3 it finds where on the tether's rotation the release
// has that energy (or the burn still owed if even the top of the swing is short), does the same
// for the catch, carries the spacecraft mass through Aster's own rocket-equation budget, and books
// the energy the tether lends and gets back.
//
// Pure logic, no DOM; classic script (window.BothEnds) or require(). Every number comes from the
// data module handed to create() (snapshots/data.js, built by build-data.mjs); nothing is retyped.
// Two-body, Earth-centred, impulsive, rigid tether whose centre of mass stays on a circular orbit,
// energy condition only. Plane, phase, the lower-tip launcher, the catch itself and price are
// structured refusals. Idea-bank prototype: none of Aster's or Skyhook's gates has seen it.
//
// [Certain] first principles under the stated model; [Likely] minor modelling assumptions;
// [Speculative] estimate.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BothEnds = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIERS = [
    { key: 'reference', label: 'Reference 2.5', detail: 'Rev A reference, GTO / high-elliptical class', path: 'kinematics', ratioPath: 'mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_derate', confidence: '[Certain] canon' },
    { key: 'cislunar', label: 'Cislunar 2.8', detail: 'revenue-gated option, needs a named anchor customer', path: 'kinematics.cislunar_revenue_gated_option', ratioPath: 'kinematics.cislunar_revenue_gated_option.integrated_mass_ratio_30pct_derate_both_arms', confidence: '[Likely] per canon' },
    { key: 'phase3', label: 'Phase 3 3.5', detail: 'Mars-class growth option, not the near-term reference', path: 'kinematics.phase3_growth_option', ratioPath: 'kinematics.phase3_growth_option.integrated_mass_ratio_30pct_derate_both_arms', confidence: '[Likely] per canon' },
  ];
  const READINGS = {
    'entry-125': { citedKey: 'nhats_entry_altitude_km', label: 'NHATS entry altitude' },
    'reentry-200': { citedKey: 'browser_reentry_altitude_km', label: 'Trajectory Browser reentry altitude' },
  };

  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const get = (o, dotted) => dotted.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const refusal = (code, missing, wouldHelp) => ({ ok: false, kind: 'refusal', code, missing, wouldHelp });

  function create(data) {
    if (!data || !data.skyhook || !data.aster || !data.nhats) throw new Error('BothEnds.create: data module missing skyhook / aster / nhats');
    const revA = data.skyhook.rev_a;
    const A = data.aster;
    const need = (v, name) => {
      if (!fin(v)) throw new Error(`BothEnds.create: ${name} is not a finite number in the data module`);
      return v;
    };
    // Skyhook side, in km and km/s. mu from the canon, radius from the physics module.
    const muS = need(revA.orbital.mu_earth_m3s2, 'orbital.mu_earth_m3s2') / 1e9;
    const rE = need(data.skyhook.r_earth_km, 'skyhook r_earth_km');
    const rCom = rE + need(revA.orbital.com_altitude_km, 'orbital.com_altitude_km');
    const L = need(revA.geometry.tether_half_length_km, 'geometry.tether_half_length_km');
    const vOrb = Math.sqrt(muS / rCom);
    const payloadClassKg = need(revA.mass_ratio.integrated_tether_to_payload_both_arms.payload_mass_kg_for_tonnage, 'payload_mass_kg_for_tonnage');
    // Aster side.
    const muA = need(A.earth_mu_km3s2, 'aster earth_mu_km3s2');
    const rPark = need(A.leo_parking_radius_km, 'aster leo_parking_radius_km');
    const rEA = rPark - need(A.cited.leo_parking_altitude_km.value, 'cited LEO altitude');
    const ve = (need(A.g0_mps2, 'g0') * need(A.screening_isp_s, 'Isp')) / 1000; // km/s
    const f = need(A.deterministic_margin_fraction, 'margin fraction');
    const skKmps = need(A.stationkeeping_mps, 'stationkeeping') / 1000;

    // ---------------------------------------------------------------- tether
    function tier(key) {
      const t = TIERS.find((x) => x.key === key);
      if (!t) return null;
      const block = get(revA, t.path);
      const vTip = block && block.v_tip_kms;
      if (!fin(vTip)) return null;
      const top = stateAt(vTip, 0);
      const bottom = stateAt(vTip, 180);
      return {
        key: t.key, label: t.label, detail: t.detail, confidence: t.confidence,
        vTip, vOrb, rCom, rUp: rCom + L, rLow: rCom - L, L,
        vRelease: top.v, c3Max: top.c3, c3Min: bottom.c3, vLow: bottom.v,
        periodMin: (2 * Math.PI * L) / vTip / 60,
        tipG: (vTip * vTip * 1000) / L / A.g0_mps2,
        stated: { c3: block.c3_kms2, vRelease: block.v_upper_release_kms, tipG: block.tip_acceleration_g, massRatio: get(revA, t.ratioPath), vLowGroundRel: block.v_lower_tip_groundrel_kms },
      };
    }
    // Tip state at angle theta from the local vertical (0 = straight up, 180 = straight down),
    // tether rotating in the orbit plane in the prograde sense so the top of the swing is fastest.
    //   position  R r^ + L (cos th r^ + sin th t^)      velocity  vOrb t^ + vTip (-sin th r^ + cos th t^)
    function stateAt(vTip, thetaDeg) {
      const c = Math.cos((thetaDeg * Math.PI) / 180);
      const r = Math.sqrt(rCom * rCom + L * L + 2 * rCom * L * c);
      const v = Math.sqrt(vOrb * vOrb + vTip * vTip + 2 * vOrb * vTip * c);
      return { thetaDeg, r, v, c3: v * v - (2 * muS) / r, altKm: r - rE };
    }
    // The swing angle whose tip state has orbital energy c3 (monotonic in theta on 0..180).
    function phaseForC3(t, c3) {
      if (!fin(c3) || c3 > t.c3Max || c3 < t.c3Min) return null;
      let lo = 0, hi = 180;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (stateAt(t.vTip, mid).c3 > c3) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    // One end of the trip: the tether hands over (or takes) a payload whose Earth orbit has energy
    // c3. Inside the swing's range the tip itself has that energy at some angle: no burn. Above
    // it, the payload burns at the top of the swing, where both velocities are tangential.
    function end(t, c3) {
      if (c3 <= t.c3Max) {
        const theta = phaseForC3(t, c3);
        const s = stateAt(t.vTip, theta);
        return { mode: 'swing', thetaDeg: theta, tipC3: c3, trimKmps: 0, rKm: s.r, altKm: s.altKm, vKmps: s.v };
      }
      const vNeed = Math.sqrt(c3 + (2 * muS) / t.rUp);
      return { mode: 'top-plus-burn', thetaDeg: 0, tipC3: t.c3Max, trimKmps: vNeed - t.vRelease, rKm: t.rUp, altKm: t.rUp - rE, vKmps: t.vRelease };
    }

    // ---------------------------------------------------------------- Aster
    const injectionDvFromC3 = (c3, mu = muA, r = rPark) => Math.sqrt(c3 + (2 * mu) / r) - Math.sqrt(mu / r);
    function payloadAtC3(vehicle, c3) {
      if (!fin(c3)) return { kind: 'non-finite-c3' };
      const cv = vehicle.curve;
      if (c3 < cv[0].c3 || c3 > cv[cv.length - 1].c3) return { kind: 'beyond-curve' };
      for (let i = 0; i < cv.length - 1; i++) {
        if (c3 === cv[i].c3) return cv[i].payloadKg;
        if (cv[i].c3 < c3 && c3 < cv[i + 1].c3) return cv[i].payloadKg + ((c3 - cv[i].c3) / (cv[i + 1].c3 - cv[i].c3)) * (cv[i + 1].payloadKg - cv[i].payloadKg);
      }
      return cv[cv.length - 1].payloadKg;
    }
    function vInfFromEntry(vEntry, readingKey) {
      const rd = READINGS[readingKey];
      if (!rd) return null;
      const r = rEA + A.cited[rd.citedKey].value;
      const c3 = vEntry * vEntry - (2 * muA) / r;
      return { c3, vInf: c3 >= 0 ? Math.sqrt(c3) : NaN, rKm: r, altKm: A.cited[rd.citedKey].value, cite: A.cited[rd.citedKey].cite };
    }
    const burn = (m, dv) => m * Math.exp(-dv / ve);

    // ---------------------------------------------------------------- the merged mission
    function record(des) {
      return data.nhats.records.find((r) => r.des === des) || null;
    }
    function mission(des, tierKey, opts) {
      const o = Object.assign({ reading: 'entry-125', sampleKg: 0 }, opts || {});
      const rec = typeof des === 'string' ? record(des) : des;
      if (!rec) return refusal('not_found', `no NHATS record for "${des}" in Aster's fixtures`, `one of the ${data.nhats.records.length} designations in snapshots/data.js`);
      const t = tier(tierKey);
      if (!t) return refusal('not_found', `no tether tier "${tierKey}" in rev_a.json`, TIERS.map((x) => x.key).join(' | '));
      if (!READINGS[o.reading]) return refusal('not_found', `no entry-altitude reading "${o.reading}"`, Object.keys(READINGS).join(' | '));
      if (!fin(o.sampleKg) || o.sampleKg < 0) return refusal('insufficient_data', 'sample mass must be a finite number of kilograms, zero or more', 'a mass in kg; 0 books a round trip that brings nothing back');
      const n = {};
      for (const k of ['c3', 'dv_dep_park', 'vrel_arr_neo', 'vrel_dep_neo', 'v_arr_earth', 'dec_dep', 'dec_arr']) {
        n[k] = Number(rec[k]);
        if (rec[k] === null || rec[k] === undefined || rec[k] === '' || !fin(n[k])) return refusal('insufficient_data', `NHATS record ${rec.des} has no usable ${k}`, 'a record with every min_dv_traj field');
      }
      if (n.c3 < 0) return refusal('out_of_envelope', `departure C3 ${n.c3} km²/s² is not an escape`, 'a heliocentric transfer (C3 ≥ 0)');
      const arr = vInfFromEntry(n.v_arr_earth, o.reading);
      if (!(arr.c3 >= 0)) return refusal('out_of_envelope', `entry speed ${n.v_arr_earth} km/s at ${arr.altKm} km is below escape speed there`, 'a hyperbolic arrival');

      const out = end(t, n.c3);
      const back = end(t, arr.c3);
      const sampleKg = o.sampleKg;
      // Spacecraft budget, Aster's lines (launch-vehicles.ts) with the record's own two asteroid burns.
      const pre = n.vrel_arr_neo * (1 + f) + skKmps;
      const post = n.vrel_dep_neo * (1 + f);
      const fly = (m0) => burn(burn(m0, pre) + sampleKg, post);

      // Path 1, Aster as shipped: a launch vehicle injects to C3, the craft enters directly.
      const rocket = A.vehicles.map((v) => {
        const p = payloadAtC3(v, n.c3);
        if (typeof p !== 'number') return { name: v.name, config: v.config, refused: p.kind, curveMaxC3: v.curve[v.curve.length - 1].c3 };
        return { name: v.name, config: v.config, injectedKg: p, homeKg: fly(p), homeFraction: (fly(p) - sampleKg * Math.exp(-post / ve)) / p };
      });
      // Path 2: the tether's payload class leaves the upper tip, burns any trim, flies Aster's
      // budget, brakes any trim, and is caught.
      const m0 = payloadClassKg;
      const m1 = burn(m0, out.trimKmps * (1 + f));
      const m2 = burn(m1, pre);
      const m3 = m2 + sampleKg;
      const m4 = burn(m3, post);
      const m5 = burn(m4, back.trimKmps * (1 + f));
      const overClass = m5 > payloadClassKg;

      // Energy the tether lends and gets back, per kg and in total. A payload climbs from the
      // lower tip to the release point (throw) or is lowered from the catch point to the lower
      // tip and let go (catch); MJ/kg = km²/s².
      const eThrow = (out.tipC3 - t.c3Min) / 2;
      const eCatch = (back.tipC3 - t.c3Min) / 2;
      const eFullSwing = (t.c3Max - t.c3Min) / 2;

      const baseInj = injectionDvFromC3(n.c3);
      return {
        ok: true,
        record: rec,
        tier: t,
        reading: { key: o.reading, altKm: arr.altKm, cite: arr.cite },
        outbound: Object.assign({ c3Req: n.c3, asterInjectionKmps: baseInj, nhatsInjectionKmps: n.dv_dep_park, nhatsInjectionModelKmps: injectionDvFromC3(n.c3, muA, rEA + A.cited.nhats_parking_altitude_km.value), decDeg: n.dec_dep }, out),
        inbound: Object.assign({ vEntry: n.v_arr_earth, vInf: arr.vInf, c3: arr.c3, decDeg: n.dec_arr, handDownKmps: t.vLow, handDownAltKm: t.rLow - rE, handDownGroundRelStated: t.stated.vLowGroundRel }, back),
        asteroid: { rendezvousKmps: n.vrel_arr_neo, departureKmps: n.vrel_dep_neo, stationkeepingKmps: skKmps, marginFraction: f, ispS: A.screening_isp_s },
        rocket,
        tether: {
          releasedKg: m0, afterThrowTrimKg: m1, atAsteroidKg: m2, sampleKg, leavingKg: m3, atEarthKg: m4, caughtKg: m5,
          overClass,
          propellantKg: m0 - m5 + sampleKg,
          homeFraction: (m5 - sampleKg * Math.exp(-(post + back.trimKmps * (1 + f)) / ve)) / m0,
        },
        energy: {
          throwMJkg: eThrow, catchMJkg: eCatch, fullSwingMJkg: eFullSwing,
          throwGJ: (eThrow * m0) / 1000, catchGJ: (eCatch * m5) / 1000, netGJ: (eThrow * m0 - eCatch * m5) / 1000,
          returnedFraction: (eCatch * m5) / (eThrow * m0),
        },
        refused: standingRefusals(t, n, overClass, m5),
      };
    }

    // What this kernel cannot answer for any mission, with what would let it.
    function standingRefusals(t, n, overClass, caughtKg) {
      const list = [
        { topic: 'Plane', code: 'insufficient_data', missing: `rev_a.json has no orbit inclination for the tether, so the departure asymptote's declination (${n.dec_dep.toFixed(1)}°) and the arrival's (${n.dec_arr.toFixed(1)}°) cannot be tested against its orbit plane. A tether throws and catches only in its own plane; an asymptote is reachable from it only if |declination| ≤ inclination.`, wouldHelp: 'an inclination (and node history) in params/rev_a.json' },
        { topic: 'Phase and date', code: 'insufficient_data', missing: 'the tip must be at the right swing angle, at the right point of the orbit, on the NHATS launch and return dates. Nothing here says the tether is there then, or how long the wait is.', wouldHelp: 'a tether ephemeris: epoch, node, argument of latitude, spin phase' },
        { topic: 'Getting to the lower tip', code: 'insufficient_data', missing: `the outbound payload must first be delivered to the lower tip at ${(t.rLow - rE).toFixed(0)} km moving ${t.vLow.toFixed(2)} km/s (inertial). Neither repository carries a launcher payload curve to that state, so the tether path has no launch mass, vehicle or price to set beside Aster's vehicles.`, wouldHelp: 'a suborbital payload-to-lower-tip curve for a named vehicle' },
        { topic: 'The catch itself', code: 'insufficient_data', missing: `an inbound payload on a hyperbola meets the tip with matched velocity for an instant, with no second pass. Skyhook's ~1 m/s, 3 to 10 s capture requirement is written for an ascending payload; nothing in either repository shows an interplanetary arrival can be navigated to it. Tip acceleration there is ${t.tipG.toFixed(2)} g.`, wouldHelp: 'a terminal-guidance error budget for a hyperbolic arrival' },
        { topic: 'Price', code: 'insufficient_data', missing: 'no cost is computed. Skyhook\'s finance model prices throws for a GTO-class market, not catches or asteroid payloads.', wouldHelp: 'a priced catch service in finance/decision_grid.json' },
      ];
      if (overClass) list.unshift({ topic: 'Payload class', code: 'out_of_envelope', missing: `the returning craft weighs ${caughtKg.toFixed(0)} kg at the catch, more than the ${payloadClassKg} kg the tether mass ratio is sized for.`, wouldHelp: 'a smaller sample, or a tether resized for the heavier catch' });
      return list;
    }

    function census(tierKey, readingKey) {
      const rows = data.nhats.records.map((r) => mission(r, tierKey, { reading: readingKey || 'entry-125' })).filter((m) => m.ok);
      const med = (a) => {
        const s = a.slice().sort((x, y) => x - y);
        return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
      };
      const col = (fn) => rows.map(fn);
      return {
        tier: tierKey, bodies: rows.length,
        throwFree: rows.filter((m) => m.outbound.trimKmps === 0).length,
        catchFree: rows.filter((m) => m.inbound.trimKmps === 0).length,
        bothFree: rows.filter((m) => m.outbound.trimKmps === 0 && m.inbound.trimKmps === 0).length,
        throwTrim: { min: Math.min(...col((m) => m.outbound.trimKmps)), median: med(col((m) => m.outbound.trimKmps)), max: Math.max(...col((m) => m.outbound.trimKmps)) },
        catchTrim: { min: Math.min(...col((m) => m.inbound.trimKmps)), median: med(col((m) => m.inbound.trimKmps)), max: Math.max(...col((m) => m.inbound.trimKmps)) },
        asterInjection: { min: Math.min(...col((m) => m.outbound.asterInjectionKmps)), median: med(col((m) => m.outbound.asterInjectionKmps)), max: Math.max(...col((m) => m.outbound.asterInjectionKmps)) },
        caughtKg: { min: Math.min(...col((m) => m.tether.caughtKg)), median: med(col((m) => m.tether.caughtKg)), max: Math.max(...col((m) => m.tether.caughtKg)) },
        returnedFraction: { min: Math.min(...col((m) => m.energy.returnedFraction)), median: med(col((m) => m.energy.returnedFraction)), max: Math.max(...col((m) => m.energy.returnedFraction)) },
        rows,
      };
    }

    return {
      TIERS, READINGS, tier, stateAt, phaseForC3, end, injectionDvFromC3, payloadAtC3, vInfFromEntry, record, mission, census,
      constants: { muS, rE, rCom, L, vOrb, payloadClassKg, muA, rPark, rEA, ve, marginFraction: f, skKmps },
    };
  }

  return { create, TIERS, READINGS };
});
