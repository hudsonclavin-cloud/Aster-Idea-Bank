/* derived by build-data.mjs — see the .provenance.json sidecar beside this file */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.ShadowData = root.ShadowData || {}; root.ShadowData["fasteners_metric"] = d; }
})(typeof self !== 'undefined' ? self : this, function () {
  return {
 "table": "fasteners_metric",
 "license_note": "Dimensional values are facts fixed by published standards (ISO 261/262 pitches, ISO 724 basic profile, ISO 273 clearance holes, ISO 4762 socket head cap screws, ISO 10642 countersunk and ISO 7380-1 button head socket screws, ISO 4032 style 1 hex nuts, ISO 4035 thin nuts, DIN 985 / ISO 7040 nylon-insert nuts, ISO 7089 plain washers, ISO 898-1 property classes, ISO 3506-1 stainless classes, ASME B94.11M drill sizes, DIN 974-1 counterbores). The standards documents are copyright ISO/DIN/ASME; the numbers are not. PROVENANCE: the values were compiled from memory of those standards (standards bodies unreachable from this environment) and then independently re-derived from memory by three reviewers plus a partial check of the M2-M8 SHCS head and tap-drill columns against nophead/NopSCADlib vitamins/screws.scad. The values are standard-fixed; the compilation is from memory; therefore no row is labelled 'certain' - only fields that are fixed by formula (pitch, d3, D1, sharp across-corners, inch-to-mm conversions, fractional drills) carry 'certain' in field_confidence. Tap drills, engagement-length, counterbore-depth and torque rules are trade practice / design rules, not standard values, and say so in their column descriptions.",
 "columns": {
  "key": "unique row id (thread designation, coarse pitch)",
  "d_mm": "mm, nominal major (basic) diameter, ISO 261/262",
  "pitch_mm": "mm, coarse pitch, ISO 261/262",
  "tap_drill_mm": "mm, conventional tap drill, d - p rule (~77% thread on the Machinery's Handbook definition) rounded to a stock drill. TRADE PRACTICE, not an ISO value. For cut taps in aluminium, brass, mild/free-machining steel. NOT for form/roll taps and NOT for wire-thread inserts (see sti_insert_drill_mm)",
  "tap_drill_stainless_mm": "mm, larger tap drill d - 0.85p rounded to 0.1 mm (~62-68% thread) for stainless, titanium and thin sections to reduce tap breakage. TRADE PRACTICE. Strength above ~65% engagement is governed by engagement LENGTH, not percentage (see min_engagement_6061T6_8_8_mm)",
  "clearance_fine_mm": "mm, ISO 273 fine series clearance hole (H12): precisely located, jig-drilled patterns only",
  "clearance_medium_mm": "mm, ISO 273 medium series clearance hole (H13): the default for machined flight parts",
  "clearance_coarse_mm": "mm, ISO 273 coarse series clearance hole (H14): sheet / welded structures",
  "confidence": "certain | likely | recall - the ROW label covers the fields listed in core_fields; every field whose confidence differs from the row label, and every non-core field, has its own entry in field_confidence",
  "source": "row-level pointer; the authoritative field -> standard mapping is field_sources"
 },
 "rows_source": "per-field: see field_sources (ISO 261 / 724 / 273 / 4762 / 4032 / 4035 / 7089 / 898-1 / 10642 / 7380-1; DIN 985 / 974-1; ASME B94.11M; tap drills and engagement rules are trade practice, not standard values)",
 "rows": [
  {
   "key": "M2",
   "d_mm": 2,
   "pitch_mm": 0.4,
   "tap_drill_mm": 1.6,
   "tap_drill_stainless_mm": 1.65,
   "clearance_fine_mm": 2.2,
   "clearance_medium_mm": 2.4,
   "clearance_coarse_mm": 2.6,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M2.5",
   "d_mm": 2.5,
   "pitch_mm": 0.45,
   "tap_drill_mm": 2.05,
   "tap_drill_stainless_mm": 2.1,
   "clearance_fine_mm": 2.7,
   "clearance_medium_mm": 2.9,
   "clearance_coarse_mm": 3.1,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M3",
   "d_mm": 3,
   "pitch_mm": 0.5,
   "tap_drill_mm": 2.5,
   "tap_drill_stainless_mm": 2.6,
   "clearance_fine_mm": 3.2,
   "clearance_medium_mm": 3.4,
   "clearance_coarse_mm": 3.6,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M4",
   "d_mm": 4,
   "pitch_mm": 0.7,
   "tap_drill_mm": 3.3,
   "tap_drill_stainless_mm": 3.4,
   "clearance_fine_mm": 4.3,
   "clearance_medium_mm": 4.5,
   "clearance_coarse_mm": 4.8,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M5",
   "d_mm": 5,
   "pitch_mm": 0.8,
   "tap_drill_mm": 4.2,
   "tap_drill_stainless_mm": 4.3,
   "clearance_fine_mm": 5.3,
   "clearance_medium_mm": 5.5,
   "clearance_coarse_mm": 5.8,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M6",
   "d_mm": 6,
   "pitch_mm": 1,
   "tap_drill_mm": 5,
   "tap_drill_stainless_mm": 5.2,
   "clearance_fine_mm": 6.4,
   "clearance_medium_mm": 6.6,
   "clearance_coarse_mm": 7,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M8",
   "d_mm": 8,
   "pitch_mm": 1.25,
   "tap_drill_mm": 6.8,
   "tap_drill_stainless_mm": 6.9,
   "clearance_fine_mm": 8.4,
   "clearance_medium_mm": 9,
   "clearance_coarse_mm": 10,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M10",
   "d_mm": 10,
   "pitch_mm": 1.5,
   "tap_drill_mm": 8.5,
   "tap_drill_stainless_mm": 8.7,
   "clearance_fine_mm": 10.5,
   "clearance_medium_mm": 11,
   "clearance_coarse_mm": 12,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M12",
   "d_mm": 12,
   "pitch_mm": 1.75,
   "tap_drill_mm": 10.2,
   "tap_drill_stainless_mm": 10.5,
   "clearance_fine_mm": 13,
   "clearance_medium_mm": 13.5,
   "clearance_coarse_mm": 14.5,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M14",
   "d_mm": 14,
   "pitch_mm": 2,
   "tap_drill_mm": 12,
   "tap_drill_stainless_mm": 12.3,
   "clearance_fine_mm": 15,
   "clearance_medium_mm": 15.5,
   "clearance_coarse_mm": 16.5,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M16",
   "d_mm": 16,
   "pitch_mm": 2,
   "tap_drill_mm": 14,
   "tap_drill_stainless_mm": 14.3,
   "clearance_fine_mm": 17,
   "clearance_medium_mm": 17.5,
   "clearance_coarse_mm": 18.5,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  },
  {
   "key": "M20",
   "d_mm": 20,
   "pitch_mm": 2.5,
   "tap_drill_mm": 17.5,
   "tap_drill_stainless_mm": 17.9,
   "clearance_fine_mm": 21,
   "clearance_medium_mm": 22,
   "clearance_coarse_mm": 24,
   "confidence": "likely",
   "field_confidence": {
    "d_mm": "certain",
    "pitch_mm": "certain"
   }
  }
 ],
 "excerpt": "fields key, d_mm, pitch_mm, tap_drill_mm, tap_drill_stainless_mm, clearance_fine_mm, clearance_medium_mm, clearance_coarse_mm, confidence, source of every row; the common per-row source string is kept once as rows_source and only a row that differs keeps its own; by build-data.mjs"
};
});
