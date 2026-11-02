// the docs/data/PROVENANCE.md table headings and "Overall confidence" lines at PartForge 0974a62, with line numbers — written by build-data.mjs.
(function (root, k, p) { if (typeof module === 'object' && module.exports) module.exports = p; else (root.CENSUS_POLICY = root.CENSUS_POLICY || {})[k] = p; })(typeof self !== 'undefined' ? self : this, "provenance",
{
 "path": "docs/data/PROVENANCE.md",
 "commit": "0974a62b309b8cf7acd33771b49e9357d4d191f4",
 "sha256": "c0ead4684134190c8a15e593fe9edcb61e13e1f5ec2d5f7eba7b6231a912fd62",
 "lines": [
  {
   "n": 23,
   "text": "## 1. fasteners_metric — ISO metric coarse-thread fasteners, M2–M20"
  },
  {
   "n": 33,
   "text": "**Overall confidence:** likely (all 12 rows). No row is certain; per-field \"certain\" only on pitch, d3, D1, sharp across-corners, inch-to-mm conversions and fractional drills."
  },
  {
   "n": 41,
   "text": "## 2. fasteners_un — Unified inch fasteners, #2-56 to 1/2-20"
  },
  {
   "n": 51,
   "text": "**Overall confidence:** likely (12 rows), recall (4 rows). No row certain: tap drills are conventions and clearance/SHCS values were checked against one open dataset, not the printed standard."
  },
  {
   "n": 59,
   "text": "## 3. orings_as568 — SAE AS568 dash sizes with Parker ORD 5700 gland data"
  },
  {
   "n": 69,
   "text": "**Overall confidence:** likely (289 rows), recall (10 rows), certain 0. Gland supplement: Chart 4-3 face-seal and Table 4-2 radial values likely; Chart 4-1 depth/squeeze, Figure 3-2 extrusion, finish/chamfer and media guidance recall."
  },
  {
   "n": 77,
   "text": "## 4. npt — ASME B1.20.1 tapered pipe threads, 1/16 to 1 in"
  },
  {
   "n": 87,
   "text": "**Overall confidence:** likely (all 7 rows). Certain fields: OD, tpi, pitch, taper, thread angle, h, H, L3, V (threads). Likely: L1, L2, L4, L5, V, E0–E2, K0, tap drills, gauge check. Recall: every rule-of-thumb column."
  },
  {
   "n": 95,
   "text": "## 5. drills — twist-drill diameter lookup (number, letter, fractional, metric)"
  },
  {
   "n": 105,
   "text": "**Overall confidence:** certain (204 rows), likely (74), recall (4). Every diameter is exact by definition; the likely/recall labels concern whether the size is a catalogue-stocked standard size (#80–#60 kept \"likely\" as honest; fractional 1-1/64…1-1/4 likely on series membership)."
  },
  {
   "n": 113,
   "text": "## 6. stock — 6061/6082 aluminium bar, plate, tube and pipe"
  },
  {
   "n": 123,
   "text": "**Overall confidence:** recall (148 rows), likely (44 rows), certain 0. Geometry and derived numbers (dim_min/max, max_finish, id_min/max, clears_casing, mass) are exact arithmetic on recalled tolerances."
  },
  {
   "n": 131,
   "text": "## 7. rails — launch rails, rods, rail buttons and lugs"
  },
  {
   "n": 141,
   "text": "**Overall confidence:** certain (4 rod rows), likely (5 vendor buttons + `lug_rod_025`), recall (8: all five rail rows and three lug rows)."
  },
  {
   "n": 149,
   "text": "## 8. avionics — altimeter boards and batteries (av-sled defaults)"
  },
  {
   "n": 159,
   "text": "**Overall confidence:** recall at row level (19 rows) because no hole pattern is verified; likely for `bat_9v_pp3_alkaline`, `bat_9v_lithium_u9vl`, `bat_cr123a`. Per field: Altus Metrum outlines, coupler sizes and voltages, EasyMega/EasyTimer outlines, and the 9 V / 9 V lithium / CR123A envelopes are likely."
  },
  {
   "n": 167,
   "text": "## 9. motors — reload hardware sets (length / mass lookup) with MMT supplement"
  },
  {
   "n": 177,
   "text": "**Overall confidence:** likely (95 rows), recall (29 rows) as a length/mass/impulse lookup; the supplement's MMT/ring dimensions likely; all closure, case-OD, thread and Aeropack geometry recall. Not fit to cut retention geometry from."
  },
  {
   "n": 185,
   "text": "## 10. airframes — body tubes, couplers and centering rings by vendor"
  },
  {
   "n": 195,
   "text": "**Overall confidence:** likely (130 rows: Madcow G12/plywood/G10, Blue Tube tubes and couplers, PML phenolic, Estes BT), recall (161 rows: all LOC, all Giant Leap, all LOC/Blue Tube/Giant Leap centering rings, Madcow carbon, Madcow kraft couplers, PML glassed phenolic, disputed rows), certain 0. The data contains zero-clearance coupler/tube pairs, which proves it is nominal."
  }
 ]
});
