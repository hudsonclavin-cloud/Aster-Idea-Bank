/* derived by build-data.mjs: an excerpt of PartForge data/tables/fasteners_un.json at 0974a62: all 16 rows cut to key, series, major_in, major_mm, tpi, pitch_mm, tensile_stress_area_in2, tensile_stress_area_mm2, confidence, their field_confidence entries, related_hardware.nut and .flat_washer_type_a_narrow (with their own confidence), the matching column descriptions, and usage-notes paragraphs (4), (6) and (7) as exact substrings.
   See the .provenance.json sidecar beside this file. Do not edit: re-run build-data.mjs. */
(function (root, factory) {
  var d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d;
  else { root.TorqueData = root.TorqueData || {}; root.TorqueData["fasteners_un"] = d; }
})(typeof self !== 'undefined' ? self : this, function () {
  return {
 "table": "fasteners_un",
 "excerpt_of": "data/tables/fasteners_un.json",
 "columns": {
  "key": "thread designation, e.g. '1/4-20' (UNC) or '1/4-28' (UNF). Source: ASME B1.1-2003",
  "series": "UNC or UNF. Source: ASME B1.1-2003",
  "major_in": "in, basic major (nominal) diameter D. Source: ASME B1.1-2003 Table 1",
  "major_mm": "mm, major_in x 25.4, rounded half-up to 3 decimals",
  "tpi": "threads per inch n. Source: ASME B1.1-2003",
  "pitch_mm": "mm, 25.4 / tpi, rounded half-up to 4 decimals",
  "tensile_stress_area_in2": "in^2, As as tabulated in ASME B1.1-2003 Appendix B / FED-STD-H28 (3 significant figures; #4-40 tabulated 0.00604 vs formula 0.00603)",
  "tensile_stress_area_mm2": "mm^2, tensile_stress_area_in2 x 645.16, 2 decimals",
  "related_hardware": "object; SECONDARY data (hex cap screw, nut, washer, button-head and flat-head socket screws) each with its OWN confidence and source. NOT folded into the row confidence. All values are recall-grade: verify before cutting",
  "field_confidence": "object mapping every top-level numeric/drill field of the row to certain | likely | recall (n/a for null fields)",
  "confidence": "row confidence = the MINIMUM of field_confidence over the top-level fields (related_hardware excluded). certain | likely | recall"
 },
 "rows": [
  {
   "key": "#2-56",
   "series": "UNC",
   "major_in": 0.086,
   "major_mm": 2.184,
   "tpi": 56,
   "pitch_mm": 0.4536,
   "tensile_stress_area_in2": 0.0037,
   "tensile_stress_area_mm2": 2.39,
   "confidence": "recall",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.0625,
     "thickness_mm": 1.588,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.02,
     "thickness_mm": 0.508,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "#4-40",
   "series": "UNC",
   "major_in": 0.112,
   "major_mm": 2.845,
   "tpi": 40,
   "pitch_mm": 0.635,
   "tensile_stress_area_in2": 0.00604,
   "tensile_stress_area_mm2": 3.9,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "likely",
    "tensile_stress_area_mm2": "likely"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.09375,
     "thickness_mm": 2.381,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.032,
     "thickness_mm": 0.813,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "#6-32",
   "series": "UNC",
   "major_in": 0.138,
   "major_mm": 3.505,
   "tpi": 32,
   "pitch_mm": 0.7938,
   "tensile_stress_area_in2": 0.00909,
   "tensile_stress_area_mm2": 5.86,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.109375,
     "thickness_mm": 2.778,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.049,
     "thickness_mm": 1.245,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "#8-32",
   "series": "UNC",
   "major_in": 0.164,
   "major_mm": 4.166,
   "tpi": 32,
   "pitch_mm": 0.7938,
   "tensile_stress_area_in2": 0.014,
   "tensile_stress_area_mm2": 9.03,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.125,
     "thickness_mm": 3.175,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.049,
     "thickness_mm": 1.245,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "#10-24",
   "series": "UNC",
   "major_in": 0.19,
   "major_mm": 4.826,
   "tpi": 24,
   "pitch_mm": 1.0583,
   "tensile_stress_area_in2": 0.0175,
   "tensile_stress_area_mm2": 11.29,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.125,
     "thickness_mm": 3.175,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.049,
     "thickness_mm": 1.245,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "#10-32",
   "series": "UNF",
   "major_in": 0.19,
   "major_mm": 4.826,
   "tpi": 32,
   "pitch_mm": 0.7938,
   "tensile_stress_area_in2": 0.02,
   "tensile_stress_area_mm2": 12.9,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.125,
     "thickness_mm": 3.175,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.049,
     "thickness_mm": 1.245,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "#12-24",
   "series": "UNC",
   "major_in": 0.216,
   "major_mm": 5.486,
   "tpi": 24,
   "pitch_mm": 1.0583,
   "tensile_stress_area_in2": 0.0242,
   "tensile_stress_area_mm2": 15.61,
   "confidence": "recall",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "machine screw nut, ASME B18.6.3",
     "thickness_in": 0.15625,
     "thickness_mm": 3.969,
     "confidence": "recall",
     "source": "machine screw nut, ASME B18.6.3 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "1/4-20",
   "series": "UNC",
   "major_in": 0.25,
   "major_mm": 6.35,
   "tpi": 20,
   "pitch_mm": 1.27,
   "tensile_stress_area_in2": 0.0318,
   "tensile_stress_area_mm2": 20.52,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.21875,
     "thickness_mm": 5.556,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "1/4-28",
   "series": "UNF",
   "major_in": 0.25,
   "major_mm": 6.35,
   "tpi": 28,
   "pitch_mm": 0.9071,
   "tensile_stress_area_in2": 0.0364,
   "tensile_stress_area_mm2": 23.48,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.21875,
     "thickness_mm": 5.556,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "5/16-18",
   "series": "UNC",
   "major_in": 0.3125,
   "major_mm": 7.938,
   "tpi": 18,
   "pitch_mm": 1.4111,
   "tensile_stress_area_in2": 0.0524,
   "tensile_stress_area_mm2": 33.81,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.265625,
     "thickness_mm": 6.747,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "5/16-24",
   "series": "UNF",
   "major_in": 0.3125,
   "major_mm": 7.938,
   "tpi": 24,
   "pitch_mm": 1.0583,
   "tensile_stress_area_in2": 0.058,
   "tensile_stress_area_mm2": 37.42,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "likely",
    "tensile_stress_area_mm2": "likely"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.265625,
     "thickness_mm": 6.747,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "3/8-16",
   "series": "UNC",
   "major_in": 0.375,
   "major_mm": 9.525,
   "tpi": 16,
   "pitch_mm": 1.5875,
   "tensile_stress_area_in2": 0.0775,
   "tensile_stress_area_mm2": 50,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.328125,
     "thickness_mm": 8.334,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "3/8-24",
   "series": "UNF",
   "major_in": 0.375,
   "major_mm": 9.525,
   "tpi": 24,
   "pitch_mm": 1.0583,
   "tensile_stress_area_in2": 0.0878,
   "tensile_stress_area_mm2": 56.65,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.328125,
     "thickness_mm": 8.334,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "7/16-14",
   "series": "UNC",
   "major_in": 0.4375,
   "major_mm": 11.113,
   "tpi": 14,
   "pitch_mm": 1.8143,
   "tensile_stress_area_in2": 0.1063,
   "tensile_stress_area_mm2": 68.58,
   "confidence": "likely",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.375,
     "thickness_mm": 9.525,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.065,
     "thickness_mm": 1.651,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "1/2-13",
   "series": "UNC",
   "major_in": 0.5,
   "major_mm": 12.7,
   "tpi": 13,
   "pitch_mm": 1.9538,
   "tensile_stress_area_in2": 0.1419,
   "tensile_stress_area_mm2": 91.55,
   "confidence": "recall",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "certain",
    "tensile_stress_area_mm2": "certain"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.4375,
     "thickness_mm": 11.113,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.095,
     "thickness_mm": 2.413,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  },
  {
   "key": "1/2-20",
   "series": "UNF",
   "major_in": 0.5,
   "major_mm": 12.7,
   "tpi": 20,
   "pitch_mm": 1.27,
   "tensile_stress_area_in2": 0.1599,
   "tensile_stress_area_mm2": 103.16,
   "confidence": "recall",
   "field_confidence": {
    "major_in": "certain",
    "major_mm": "certain",
    "tpi": "certain",
    "pitch_mm": "certain",
    "tensile_stress_area_in2": "likely",
    "tensile_stress_area_mm2": "likely"
   },
   "related_hardware": {
    "nut": {
     "type": "finished hex nut, ASME B18.2.2",
     "thickness_in": 0.4375,
     "thickness_mm": 11.113,
     "confidence": "recall",
     "source": "finished hex nut, ASME B18.2.2 basic dimensions (recall)"
    },
    "flat_washer_type_a_narrow": {
     "thickness_in": 0.095,
     "thickness_mm": 2.413,
     "confidence": "recall",
     "source": "ASME B18.22.1 Type A plain washer, Narrow (N) series where N/W exist (recall; small sizes have no N/W split)"
    }
   }
  }
 ],
 "notes_paragraphs": {
  "4": "(4) STRENGTH. As = 0.7854 (D - 0.9743/n)^2. Minimum ultimate bolt load = As x UTS_min; recommended preload for a reusable joint is ~75% of proof load (J429 grades) or ~75% of 0.2% yield (A574/F837). Bolt SHEAR strength is commonly taken as 0.6 x UTS (likely; NASA RP-1228 / MIL-HDBK-5 practice) -- use it for rail buttons, fin brackets and thrust-loaded retainer screws in single shear.",
  "6": "(6) TORQUE. T = K x F x d (T in lbf-in, F preload lbf, d nominal in). K = 0.20 plain/black-oxide steel dry, 0.15-0.17 lubricated or waxed, 0.12-0.14 with moly, 0.25-0.35 stainless-on-stainless dry (galls: ALWAYS anti-seize stainless). Example 1/4-20 A574 at 75% yield: F = 0.75 x 153 ksi x 0.0318 = 3650 lbf, T = 0.20 x 3650 x 0.25 = 180 lbf-in (K values: likely). Small screws in aluminium are limited by thread stripping, not bolt yield: check (5) first.",
  "7": "(7) MATERIAL PROPERTIES (minimums; MPa = ksi x 6.894757). SAE J429 grade 5, 1/4-1 in: proof 85 ksi (586 MPa), yield 92 (634), UTS 120 (827), medium-carbon Q&T, 3 radial head marks [certain, SAE J429-2014]; 1-1/8 to 1-1/2 in: 74/81/105 ksi. SAE J429 grade 8, 1/4-1-1/2 in: proof 120 (827), yield 130 (896), UTS 150 (1034), alloy Q&T, 6 radial marks [certain, SAE J429-2014]. J429 grades start at 1/4 in; #2-#12 machine screws are NOT graded to J429. ASTM A574 alloy-steel SHCS (black oxide), up to and including 1/2 in: UTS 180 ksi (1241 MPa), 0.2% yield 153 (1055) [likely]; over 1/2 in: UTS 170 (1172), yield 144 (993) [recall; corrected from compiler's 153, which was a spot-check skeptic disagreement]; A574 also tabulates a proof-load stress of about 135-140 ksi [recall; the compiler's 'no proof load' statement was withdrawn]. Stainless SOCKET screws are ASTM F837 (not F593); F837 group 1 (18-8: 302/303/304) condition CW, 1/4-5/8 in: UTS ~100 ksi (689 MPa), yield ~65 ksi (448 MPa) [recall]; F593 CW group 1 has the same 100/65 ksi for 1/4-5/8 in hex bolts [likely]. Sizes BELOW 1/4 in and over 5/8 in are made to lower strength: vendors quote 70-90 ksi UTS for 18-8 machine screws and small SHCS [recall]; do not assume 100 ksi below 1/4 in. Austenitic stainless galls on stainless: anti-seize or a dissimilar nut for anything torqued repeatedly."
 }
};
});
