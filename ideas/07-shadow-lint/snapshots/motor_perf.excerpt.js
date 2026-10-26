/* derived by build-data.mjs — see the .provenance.json sidecar beside this file */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.ShadowData = root.ShadowData || {}; root.ShadowData["motor_perf"] = d; }
})(typeof self !== 'undefined' ? self : this, function () {
  return {
 "table": "motor_perf",
 "license_note": "Motor performance rows are transcribed from thrustcurve-db 4.0.1 (ISC licence; github.com/broofa/thrustcurve-db, Robert Kieffer), which packages the ThrustCurve.org motor data compiled by John Coker from manufacturer and certification-organisation submissions (NAR S&T, TRA, CAR). The numbers are the manufacturers' own certified figures as published by the certifying body; they are facts about commercial products, reproduced here with attribution under the ISC licence. No value was recalled or invented.",
 "columns": {
  "key": "unique row id = manufacturerAbbrev|designation",
  "name": "common name as a flier says it, e.g. \"M1670\"",
  "designation": "full manufacturer designation as printed on the certification, e.g. \"6026M1670-P\" — this is what you buy",
  "mfr": "manufacturer abbreviation",
  "d_mm": "motor diameter, mm (the nominal class, not a measured case OD)",
  "len_mm": "overall loaded length, mm, as submitted",
  "class": "impulse class letter",
  "type": "reload | single-use | hybrid",
  "case": "hardware set the reload fits (joins data/tables/motors.json on mfr|case)",
  "prop": "propellant name",
  "avg_thrust_N": "average thrust over the burn, N, certified",
  "max_thrust_N": "PEAK thrust, N — the number a retainer, thrust ring, centring ring or bulkhead is loaded by",
  "max_thrust_src": "\"certified\" (the certifying body published it) or \"sampled curve (estimate)\" (derived here as the maximum of the published thrust-curve samples because the record carries no certified peak)",
  "tot_impulse_Ns": "total impulse, N·s, certified",
  "burn_s": "burn time, s, certified",
  "prop_g": "propellant mass, g",
  "total_g": "loaded motor mass, g",
  "cert_org": "certifying organisation",
  "availability": "regular | OOP (out of production), as of the upstream snapshot",
  "curve_samples": "number of points in the published thrust curve (0 = no curve in this package)",
  "updated": "upstream record date",
  "confidence": "likely for a certified peak; recall where the peak had to be derived from the curve",
  "source": "the upstream record id and what was transcribed"
 },
 "rows": [
  {
   "key": "Loki|L2050LW",
   "name": "L2050",
   "designation": "L2050LW",
   "mfr": "Loki",
   "d_mm": 54,
   "len_mm": 1114,
   "class": "L",
   "type": "reload",
   "case": "54/4000",
   "prop": "Loki White",
   "avg_thrust_N": 2052,
   "max_thrust_N": 3331,
   "max_thrust_src": "certified",
   "tot_impulse_Ns": 4802,
   "burn_s": 2.34,
   "prop_g": 2388,
   "total_g": 4056,
   "cert_org": "Tripoli Rocketry Association, Inc.",
   "availability": "regular",
   "curve_samples": 30,
   "updated": "2019-04-17",
   "confidence": "likely",
   "source": "thrustcurve-db 4.0.1 (ISC; ThrustCurve.org data by John Coker, packaged by broofa/thrustcurve-db), record 5f4294d2000231000000043e"
  }
 ],
 "excerpt": "only the rows matched by the fixtures' loads.motor keys (Loki L2050); by build-data.mjs"
};
});
