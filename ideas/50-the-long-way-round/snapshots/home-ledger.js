/* Idea 47's return mass ledger, excerpted verbatim from ideas/47-way-home/home.js (lines 185-218: burnable, burn, tcmOf, burnsOf,
 * ledger, materialMax, capacity) by ideas/50-the-long-way-round/build-data.mjs --reuse; do not edit. tcmOf and burnsOf are carried but not called
 * (they need idea 47's Lucy execution model); the what-if calls ledger(), materialMax() and capacity() with idea 47's own burns.
 * Classic script (window.LWR_HOME_LEDGER) and require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LWR_HOME_LEDGER = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400, EXEC = null, vinfMax = null;
  function num(x) { return typeof x === 'number' && isFinite(x); }
  // ---- home.js lines 185-218
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
  return { ledger: ledger, materialMax: materialMax, capacity: capacity, burnable: burnable };
});
