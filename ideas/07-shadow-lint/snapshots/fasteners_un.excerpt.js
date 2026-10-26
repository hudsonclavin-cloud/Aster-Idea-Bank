/* derived by build-data.mjs — see the .provenance.json sidecar beside this file */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.ShadowData = root.ShadowData || {}; root.ShadowData["fasteners_un"] = d; }
})(typeof self !== 'undefined' ? self : this, function () {
  return {
 "table": "fasteners_un",
 "license_note": "Dimensional facts from published standards: ASME B1.1-2003 (Unified inch screw threads; basic profile, tensile stress area formula and tabulated values, also FED-STD-H28), ASME B18.2.8-1999 (clearance holes for bolts, screws and studs), ASME B18.3-2012 (socket cap screws: head dimensions, hex-key sizes, drill and counterbore table), ANSI/ASME B94.11M-1993 (number/letter/fractional twist-drill diameters), ASME B18.2.1 / B18.2.2 / B18.6.3 / B18.22.1 (hex cap screws, hex nuts, machine screw nuts, plain washers; related_hardware only), SAE J429 (mechanical properties of externally threaded fasteners), ASTM A574 (alloy-steel socket head cap screws), ASTM F837 / F593 (stainless steel socket screws / bolts). Tap drill selections (75% and ~50% thread) follow the conventional charts republished in Machinery's Handbook and by tap manufacturers; they are conventions, not normative requirements. Numbers were compiled from memory of those standards (network access to the standards bodies was blocked) and then cross-checked, at reconciliation, against the CSV data files of the open-source gumyr/cq_warehouse project (raw.githubusercontent.com, which was reachable): tap_hole_sizes.csv, clearance_hole_sizes.csv, socket_head_cap_parameters.csv, drill_sizes.csv. Where cq_warehouse and the reviewers' recall agreed against the compiler, the compiler's value was replaced. Every field carries a confidence label. Copyright in the standards documents belongs to the issuing bodies; the numeric values themselves are facts. cq_warehouse is Apache-2.0.",
 "columns": {
  "key": "thread designation, e.g. '1/4-20' (UNC) or '1/4-28' (UNF). Source: ASME B1.1-2003",
  "series": "UNC or UNF. Source: ASME B1.1-2003",
  "major_mm": "mm, major_in x 25.4, rounded half-up to 3 decimals",
  "pitch_mm": "mm, 25.4 / tpi, rounded half-up to 4 decimals",
  "tap_drill_75_mm": "mm, 3 decimals",
  "tap_drill_50_mm": "mm, 3 decimals",
  "clearance_close_mm": "mm, 3 decimals",
  "clearance_normal_mm": "mm, 3 decimals",
  "clearance_loose_mm": "mm, 3 decimals",
  "confidence": "row confidence = the MINIMUM of field_confidence over the top-level fields (related_hardware excluded). certain | likely | recall",
  "source": "per-column provenance string for the row (same for every row; per-column detail is also in this 'columns' block)"
 },
 "rows_source": "major/tpi/pitch/minor/pitch-dia: ASME B1.1-2003 basic profile; tap_drill_75: Machinery's Handbook 75%-thread chart (convention), cross-checked gumyr/cq_warehouse tap_hole_sizes.csv 'Soft'; tap_drill_50: gumyr/cq_warehouse tap_hole_sizes.csv 'Hard' (convention, ~50% thread); drill diameters: ANSI/ASME B94.11M-1993; clearance_*: ASME B18.2.8-1999 Table 1 (recall) cross-checked cq_warehouse clearance_hole_sizes.csv; shcs_*: ASME B18.3-2012 Table 1 (recall) cross-checked cq_warehouse socket_head_cap_parameters.csv; cbore_d: ASME B18.3-2012 drill-and-counterbore table (recall, three independent recalls agree); tensile_stress_area: ASME B1.1-2003 Appendix B formula, recomputed; int_thread_shear_area_per_in: ASME B1.1 Appendix B / FED-STD-H28 formula evaluated at BASIC dimensions",
 "rows": [
  {
   "key": "#2-56",
   "series": "UNC",
   "major_mm": 2.184,
   "pitch_mm": 0.4536,
   "tap_drill_75_mm": 1.778,
   "tap_drill_50_mm": 1.854,
   "clearance_close_mm": 2.381,
   "clearance_normal_mm": 2.578,
   "clearance_loose_mm": 2.946,
   "confidence": "recall",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "recall",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "#4-40",
   "series": "UNC",
   "major_mm": 2.845,
   "pitch_mm": 0.635,
   "tap_drill_75_mm": 2.261,
   "tap_drill_50_mm": 2.438,
   "clearance_close_mm": 3.048,
   "clearance_normal_mm": 3.264,
   "clearance_loose_mm": 3.658,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "#6-32",
   "series": "UNC",
   "major_mm": 3.505,
   "pitch_mm": 0.7938,
   "tap_drill_75_mm": 2.705,
   "tap_drill_50_mm": 2.946,
   "clearance_close_mm": 3.912,
   "clearance_normal_mm": 4.305,
   "clearance_loose_mm": 4.699,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "#8-32",
   "series": "UNC",
   "major_mm": 4.166,
   "pitch_mm": 0.7938,
   "tap_drill_75_mm": 3.454,
   "tap_drill_50_mm": 3.658,
   "clearance_close_mm": 4.572,
   "clearance_normal_mm": 4.978,
   "clearance_loose_mm": 5.41,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "#10-24",
   "series": "UNC",
   "major_mm": 4.826,
   "pitch_mm": 1.0583,
   "tap_drill_75_mm": 3.797,
   "tap_drill_50_mm": 4.089,
   "clearance_close_mm": 5.22,
   "clearance_normal_mm": 5.613,
   "clearance_loose_mm": 6.045,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "#10-32",
   "series": "UNF",
   "major_mm": 4.826,
   "pitch_mm": 0.7938,
   "tap_drill_75_mm": 4.039,
   "tap_drill_50_mm": 4.305,
   "clearance_close_mm": 5.22,
   "clearance_normal_mm": 5.613,
   "clearance_loose_mm": 6.045,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "#12-24",
   "series": "UNC",
   "major_mm": 5.486,
   "pitch_mm": 1.0583,
   "tap_drill_75_mm": 4.496,
   "tap_drill_50_mm": 4.801,
   "clearance_close_mm": 5.613,
   "clearance_normal_mm": 5.791,
   "clearance_loose_mm": 6.248,
   "confidence": "recall",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "recall",
    "clearance_normal_mm": "recall",
    "clearance_loose_mm": "recall"
   },
   "source": "major/tpi/pitch/minor/pitch-dia: ASME B1.1-2003 basic profile; tap_drill_75: Machinery's Handbook 75%-thread chart (convention), cross-checked gumyr/cq_warehouse tap_hole_sizes.csv 'Soft'; tap_drill_50: gumyr/cq_warehouse tap_hole_sizes.csv 'Hard' (convention, ~50% thread); drill diameters: ANSI/ASME B94.11M-1993; clearance_*: ASME B18.2.8-1999 Table 1 (recall) cross-checked cq_warehouse clearance_hole_sizes.csv; shcs_*: ASME B18.3-2012 Table 1 (recall) cross-checked cq_warehouse socket_head_cap_parameters.csv; cbore_d: ASME B18.3-2012 drill-and-counterbore table (recall, three independent recalls agree); tensile_stress_area: ASME B1.1-2003 Appendix B formula, recomputed; int_thread_shear_area_per_in: ASME B1.1 Appendix B / FED-STD-H28 formula evaluated at BASIC dimensions; ROW ADDED AT RECONCILIATION (commercial rocketry motor-retainer size); #12 is not in the ASME B18.3 socket head cap screw size list, so SHCS/counterbore fields are null"
  },
  {
   "key": "1/4-20",
   "series": "UNC",
   "major_mm": 6.35,
   "pitch_mm": 1.27,
   "tap_drill_75_mm": 5.105,
   "tap_drill_50_mm": 5.556,
   "clearance_close_mm": 6.747,
   "clearance_normal_mm": 7.144,
   "clearance_loose_mm": 7.541,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "1/4-28",
   "series": "UNF",
   "major_mm": 6.35,
   "pitch_mm": 0.9071,
   "tap_drill_75_mm": 5.41,
   "tap_drill_50_mm": 5.791,
   "clearance_close_mm": 6.747,
   "clearance_normal_mm": 7.144,
   "clearance_loose_mm": 7.541,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "5/16-18",
   "series": "UNC",
   "major_mm": 7.938,
   "pitch_mm": 1.4111,
   "tap_drill_75_mm": 6.528,
   "tap_drill_50_mm": 7.036,
   "clearance_close_mm": 8.334,
   "clearance_normal_mm": 8.731,
   "clearance_loose_mm": 9.128,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "5/16-24",
   "series": "UNF",
   "major_mm": 7.938,
   "pitch_mm": 1.0583,
   "tap_drill_75_mm": 6.909,
   "tap_drill_50_mm": 7.144,
   "clearance_close_mm": 8.334,
   "clearance_normal_mm": 8.731,
   "clearance_loose_mm": 9.128,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "3/8-16",
   "series": "UNC",
   "major_mm": 9.525,
   "pitch_mm": 1.5875,
   "tap_drill_75_mm": 7.938,
   "tap_drill_50_mm": 8.433,
   "clearance_close_mm": 9.922,
   "clearance_normal_mm": 10.319,
   "clearance_loose_mm": 10.716,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "3/8-24",
   "series": "UNF",
   "major_mm": 9.525,
   "pitch_mm": 1.0583,
   "tap_drill_75_mm": 8.433,
   "tap_drill_50_mm": 8.839,
   "clearance_close_mm": 9.922,
   "clearance_normal_mm": 10.319,
   "clearance_loose_mm": 10.716,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "7/16-14",
   "series": "UNC",
   "major_mm": 11.113,
   "pitch_mm": 1.8143,
   "tap_drill_75_mm": 9.347,
   "tap_drill_50_mm": 9.922,
   "clearance_close_mm": 11.509,
   "clearance_normal_mm": 11.906,
   "clearance_loose_mm": 12.303,
   "confidence": "likely",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "likely"
   }
  },
  {
   "key": "1/2-13",
   "series": "UNC",
   "major_mm": 12.7,
   "pitch_mm": 1.9538,
   "tap_drill_75_mm": 10.716,
   "tap_drill_50_mm": 11.509,
   "clearance_close_mm": 13.494,
   "clearance_normal_mm": 14.288,
   "clearance_loose_mm": 15.478,
   "confidence": "recall",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "recall"
   }
  },
  {
   "key": "1/2-20",
   "series": "UNF",
   "major_mm": 12.7,
   "pitch_mm": 1.27,
   "tap_drill_75_mm": 11.509,
   "tap_drill_50_mm": 11.906,
   "clearance_close_mm": 13.494,
   "clearance_normal_mm": 14.288,
   "clearance_loose_mm": 15.478,
   "confidence": "recall",
   "field_confidence": {
    "major_mm": "certain",
    "pitch_mm": "certain",
    "tap_drill_75_mm": "likely",
    "tap_drill_50_mm": "likely",
    "clearance_close_mm": "likely",
    "clearance_normal_mm": "likely",
    "clearance_loose_mm": "recall"
   }
  }
 ],
 "excerpt": "fields key, series, major_mm, pitch_mm, tap_drill_75_mm, tap_drill_50_mm, clearance_close_mm, clearance_normal_mm, clearance_loose_mm, confidence, source of every row; the common per-row source string is kept once as rows_source and only a row that differs keeps its own; by build-data.mjs"
};
});
