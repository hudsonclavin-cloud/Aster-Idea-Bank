// the data/README.md confidence-policy table at PartForge 0974a62, with line numbers — written by build-data.mjs.
(function (root, k, p) { if (typeof module === 'object' && module.exports) module.exports = p; else (root.CENSUS_POLICY = root.CENSUS_POLICY || {})[k] = p; })(typeof self !== 'undefined' ? self : this, "readme",
{
 "path": "data/README.md",
 "commit": "0974a62b309b8cf7acd33771b49e9357d4d191f4",
 "sha256": "736169cd6aae64d481fb8fc2f4bf2803353946aa79ece3778e982793a1681657",
 "lines": [
  {
   "n": 30,
   "text": "| table | what | rows | confidence policy |"
  },
  {
   "n": 31,
   "text": "|---|---|---|---|"
  },
  {
   "n": 32,
   "text": "| `airframes` | body tubes, couplers and centering rings by vendor and material: ID, OD, wall, part numbers, `part_role` (airframe / motor-mount tube / piston / switch band / coupler stiffener …), 10 tube families | 291 + 48 supplement | openrocket-database transcriptions; LOC and Giant Leap rows `recall`, Madcow/Blue Tube/PML/Estes `likely`; 11 known-bad rows kept and flagged |"
  },
  {
   "n": 33,
   "text": "| `motors` | reload hardware sets: case diameter, LOADED length per grain count, loaded and propellant mass; supplement of MMT tube IDs, centering-ring bores, and reviewer recall on case ODs and closure architecture | 124 (103 current) + 119 supplement | ThrustCurve data `likely`; every closure/case-OD statement `recall` — \"not fit to cut metal from until the club measures its own hardware\" |"
  },
  {
   "n": 34,
   "text": "| `materials_thermal` | Poisson's ratio and coefficient of thermal expansion for every material FLIGHT_MATERIALS offers, with a working service temperature. `dbFitThermal()` says how much a fit moves between two materials over a temperature change | 21 | 7 metals `likely`; the laminates and polymers `recall`, each row naming the direction its number describes |"
  },
  {
   "n": 35,
   "text": "| `fits` | ISO 286-1 limits and fits: 13 size steps to 500 mm, IT5–IT13, the shaft letters d, e, f, g, h, k, n, and seven named fits with what each is for. `dbFit()` turns a diameter and a fit into the two parts' limits and the clearance | 13 steps + 7 fits | `likely`: every value is reproduced by the standard's formula AND by an independently recalled published table; 5 values where the two disagreed are withheld |"
  },
  {
   "n": 36,
   "text": "| `motor_perf` | certified performance of every F-and-up motor: peak and average thrust, total impulse, burn time, propellant and loaded mass, class, hardware set, certifying body, availability. Peak thrust is the load case for a retainer, thrust ring, centring ring or aft bulkhead | 1037 | 875 certified peaks `likely`; 162 derived from the published curve or withheld, all `recall`; 7 rows flagged `disputed` |"
  },
  {
   "n": 37,
   "text": "| `orings_as568` | AS568 dash sizes −102…−475 with ID/W tolerances and the per-dash Parker ORD 5700 Table 4-2 gland diameters; face-seal chart 4-3 and radial table 4-2 bands in the supplement | 299 | 289 `likely` (three independent tables agree), 10 `recall` |"
  },
  {
   "n": 38,
   "text": "| `fasteners_metric` | M2–M20 coarse: pitch, minor diameters, tap and clearance drills (metric and US), SHCS/CSK/button heads, nuts, washers, stress areas, ISO 898-1 grades, thread-engagement and edge-distance rules | 12 | `likely` |"
  },
  {
   "n": 39,
   "text": "| `fasteners_un` | #2-56 … 1/2-20 UNC/UNF: the same fields in inch, 75 % and 50 % tap drills, close/normal/loose clearance, related rocketry hardware | 16 | `likely`; cross-checked against cq_warehouse CSVs |"
  },
  {
   "n": 40,
   "text": "| `npt` | 1/16 … 1 in NPT: every ASME B1.20.1 Table 1 dimension, tap drills (plain and reamed), engagement lengths, blind-port drill depths | 7 | Table 1 values `certain`, tap drills `likely` |"
  },
  {
   "n": 41,
   "text": "| `drills` | fractional, number, letter and metric twist-drill diameters as the standard prints them (ASME rounds ties half-to-even, so mm is stored, never recomputed) | 282 | 204 `certain`, 78 `likely`/`recall` |"
  },
  {
   "n": 42,
   "text": "| `stock` | 6061-T6 / 6082-T6 bar, plate, tube and pipe: nominal, mill tolerance band, the maximum FINISHED size and minimum finished bore the stock can yield, casing clearance, spec minimum properties, availability | 192 | tolerance numbers `recall` of ASTM B209/B210/B211/B221/B241 and EN 754/755/485 |"
  },
  {
   "n": 43,
   "text": "| `rails` | 1010 / 1515 / 2020 / 3030 / Unistrut rails, launch rods, rail buttons and lugs | 18 | extrusion sizes `certain`, slot geometry `likely`, vendor buttons `recall` |"
  },
  {
   "n": 44,
   "text": "| `design_factors_nasa` | factors of safety (NASA-STD-5001B Table 1: metallic prototype and protoflight, beryllium, proof, fatigue service life) and threaded-fastener rules (NASA-STD-5020B: joint-slip friction, preload uncertainty, no friction credit at ultimate, protrusion, engagement rationale), each row carrying the requirement sentence it was read from | 12 | `certain` — read from the published PDF text, which is NOT a claim the number suits your vehicle: every row is spaceflight criteria and says so |"
  },
  {
   "n": 45,
   "text": "| `avionics` | altimeter board envelopes and hole patterns (PerfectFlite, Missile Works, Featherweight, Eggtimer, Altus Metrum) and battery envelopes | 22 | outlines `likely`; NO hole pattern is verified — the sled template slots |"
  }
 ]
});
