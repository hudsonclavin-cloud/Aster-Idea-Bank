/* derived by build-data.mjs: PartForge docs/data/PROVENANCE.md lines 23-40 (section 1, fasteners_metric) at 0974a62, exact text, one string per line */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.HoleStackData = root.HoleStackData || {}; root.HoleStackData.provenanceDoctrine = d; }
})(typeof self !== 'undefined' ? self : this, function () {
  return { path: "docs/data/PROVENANCE.md", firstLine: 23, doctrineLine: 37, lines: [
 "## 1. fasteners_metric — ISO metric coarse-thread fasteners, M2–M20",
 "",
 "**File** `tables/fasteners_metric.final.json` — 58,241 bytes, 12 rows, 51 numeric/text columns plus `grades`, `design_rules`, `field_sources`, `core_fields`.",
 "",
 "**Sources.** ISO 261:1998 / ISO 262:1998 (pitches); ISO 724:1993 (d3, D1); ISO 273:1979 (clearance holes, fine/medium/coarse); ISO 4762:2004 (SHCS dk plain and knurled, k, s, b); ISO 10642:2019 (countersunk, recall); ISO 7380-1:2011 (button head, recall); ISO 4032:2012 (hex nut s, e min, m max/min); ISO 4035:2012 / DIN 439 (thin nuts, recall); DIN 985 / ISO 7040:2012 (nyloc, recall); DIN 934 (AF differences at M10/M12/M14); DIN 974-1:2008 (counterbores, recall); ISO 7089:2000 (washers); ISO 898-1:2013 Table 3 / Annex A (As,nom, property classes); ISO 3506-1:2020 Table 4 (A2-50/70/80); ASME B94.11M-1993 (US drill equivalents); Machinery's Handbook / FED-STD-H28 (percent-of-thread and strip-shear formulas); VDI 2230 / ISO 16047 (torque order of magnitude); trade practice for tap drills (d − p, d − 0.85p); partial external confirmation of M2–M8 SHCS heads and tap drills against nophead/NopSCADlib `vitamins/screws.scad` (GPL-3 library; only numbers were compared, nothing copied).",
 "",
 "**Licence / attribution.** Standards-fixed dimensional facts; not copyrightable. The standards documents are copyright ISO, DIN and ASME and are not reproduced. Attribution text the app must carry:",
 "",
 "> Metric fastener dimensions per ISO 261/262, 724, 273, 4762, 10642, 7380-1, 4032, 4035, 7040, 7089, 898-1 and 3506-1, DIN 934/985/974-1, US drill equivalents per ASME B94.11M-1993. Values compiled from memory of those standards and reviewed, not transcribed from the documents; tap-drill, counterbore-depth, engagement and torque figures are trade practice and design rules, not standard values.",
 "",
 "**Overall confidence:** likely (all 12 rows). No row is certain; per-field \"certain\" only on pitch, d3, D1, sharp across-corners, inch-to-mm conversions and fractional drills.",
 "",
 "**Recall / disputed.** No row is recall. Disputed cells: `M6.nut_h_min_mm` (4.9 kept vs 4.7), `M8.nut_h_min_mm` (6.44 vs 6.14). Fields that are recall on every row where present: `cbore_d_mm` (12 rows), `jam_nut_h_mm` (12), `locknut_h_mm` (10), `csk_head_d_mm` / `csk_head_h_mm` / `csk_hex_key_mm` (10), `button_head_d_mm` / `button_head_h_mm` / `button_hex_key_mm` (8), `sti_insert_drill_mm` (10; null at M2/M2.5), `nut_h_min_mm` (7 rows: M2–M8). `grades.A2-70.disputed.size_range` (≤ M24 adopted; whether ISO 3506-1:2020 extends it is unverified). `torque_guide_8_8_dry_Nm` and `min_engagement_6061T6_8_8_mm` are design rules (K = 0.2, 70 % proof; 0.5·π·d·Le shear area), not standard values. Not supplied: DIN 974-1 counterbore depths, ISO 10511 thin nyloc heights, SHCS shank tolerance, M2/M2.5 insert drills, fine-pitch threads.",
 "",
 "**Doctrine.** Use this table for every metric hole the model draws: model a tapped hole at `minor_D1_mm`, drill it at `tap_drill_mm` (cut taps only — `sti_insert_drill_mm` for wire inserts, the tap maker's chart for form taps), clearance at `clearance_medium_mm` by default (fine for jig-drilled patterns, coarse for hand-drilled sheet), counterbore to `cbore_d_mm` (or knurled dk + 0.4 mm) and `cbore_depth_flush_mm`, hex pockets to `nut_ac_min_mm` across corners and `nut_h_mm` deep (`locknut_h_mm` if the joint is locked, which flight joints are), and check every tapped aluminium joint against `min_engagement_6061T6_8_8_mm` scaled per `design_rules.thread_engagement_length` — engagement length, not thread percentage, is what strips. The model must tell the user to measure when: the stock nut may be DIN 934 rather than ISO 4032 (M10/M12/M14 AF differ — check the bag before cutting a pocket); the head is knurled (use `shcs_head_d_knurled_mm`); the screw is countersunk or button (recall data — confirm from the vendor drawing); a stainless screw replaces a carbon-steel callout (A2-70 proof is 78 % of 8.8, 46 % of 12.9 — re-check preload); or the part is a pressure boundary, where every recall field must be confirmed against a vendor catalogue page (Bossard, Würth, McMaster ISO pages) before the first cut.",
 "",
 "---",
 ""
] };
});
