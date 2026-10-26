// DERIVED by build_data.py from this folder's snapshots of Skyhook 34935cb. Do not edit by hand.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LedgerData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
 "skyhookCommit": "34935cb1f67a8422a9fd49481e080faade2c0d92",
 "skyhookCommitShort": "34935cb",
 "revA": {
  "_meta": {
   "revision": "Rev A",
   "last_verified": "2026-07-02",
   "verification_memo": "VM-001",
   "rule": "Rule 1 — all analysis must cite this revision. Any deviation must be explicit."
  },
  "orbital": {
   "com_altitude_km": 610,
   "com_radius_km": 6988,
   "mu_earth_m3s2": 398600000000000.0,
   "v_orb_kms": 7.55,
   "_v_orb_note": "sqrt(mu/R_orbit); Certain"
  },
  "geometry": {
   "tether_half_length_km": 320,
   "tip_altitude_lower_km": 290,
   "_tip_alt_note": "CoM alt minus half-length; atmosphere-grazing variants lower; Likely",
   "rotation_period_min": 13.4,
   "_rotation_period_note": "Derived: 2*pi*L / v_tip = 13.40 min at 2.5 km/s GTO/high-elliptical reference; Certain"
  },
  "kinematics": {
   "v_tip_kms": 2.5,
   "v_lower_tip_groundrel_kms": 4.59,
   "_lower_tip_note": "v_orb - v_tip - equatorial rotation = 7.55 - 2.5 - 0.465 ~= 4.59 km/s; Likely",
   "v_upper_release_kms": 10.06,
   "_upper_release_note": "v_orb_com + v_tip at release; evaluated for energy at upper-tip radius r=R_E+610+320=7301 km. The 2.5 km/s reference reaches GTO/high-elliptical class, not cislunar/TLI. [Certain]",
   "tip_acceleration_g": 1.99,
   "_tip_accel_note": "v_tip^2 / L = (2500)^2 / 320000 = 19.53 m/s^2 = 1.99 g; Certain",
   "c3_kms2": -8.06,
   "_c3_note": "C3 = v_rel^2 - 2*mu/r_tip with v_rel=v_orb_com+v_tip and r_tip=7301 km. At 2.5 km/s, C3 ~= -8.06 km^2/s^2 and apogee altitude ~=85,200 km, i.e. GTO/high-elliptical class but not cislunar/TLI. [Certain]",
   "phase3_growth_option": {
    "confidence": "[Likely]",
    "v_tip_kms": 3.5,
    "v_lower_tip_groundrel_kms": 3.59,
    "v_upper_release_kms": 11.05,
    "tip_acceleration_g": 3.9,
    "c3_kms2": 13.05,
    "integrated_mass_ratio_30pct_derate_both_arms": 3085.95,
    "fiber_mass_t_at_5000kg_payload": 15429.8,
    "note": "Phase 3 growth option only, NOT the near-term Rev A reference: Mars-class escape remains possible at 3.5 km/s, but the integrated mass ratio is ~3086x and the case is launch-cost-dominated per financial analysis 2026-07-02. Escape (C3=0) is reached at ~2.9 km/s; full Mars-class C3 is the 3.5 km/s Phase 3 option."
   },
   "apogee_altitude_km": 85222,
   "_apogee_note": "Derived from eps=v_rel^2/2 - mu/r_tip at the upper-tip radius; 2.5 km/s gives ~85,200 km apogee, while the 2.8 km/s cislunar option reaches lunar-apogee class. [Certain]",
   "cislunar_revenue_gated_option": {
    "confidence": "[Likely]",
    "v_tip_kms": 2.8,
    "v_upper_release_kms": 10.36,
    "c3_kms2": -1.94,
    "apogee_altitude_km": 397819,
    "tip_acceleration_g": 2.5,
    "integrated_mass_ratio_30pct_derate_both_arms": 295.27,
    "fiber_mass_t_at_5000kg_payload": 1476.3,
    "construction_launch_break_even_for_500_per_kg_customer_price": 686,
    "customer_price_break_even_at_800_per_kg_construction_launch_Y15": 517,
    "note": "Revenue-gated option only, NOT the base-case reference: conservative economics at $500/kg customer price require construction launch below ~$686/kg for Y15 payback. At $800/kg construction launch, the breakeven customer price is ~$517/kg for Y15 payback. Requires a named cislunar anchor customer to validate open action #3."
   }
  },
  "materials": {
   "primary_fiber": "Zylon PBO",
   "tensile_strength_GPa": 5.8,
   "density_kgm3": 1560,
   "specific_strength_MJkg": 3.72,
   "V_c_kms": 2.73,
   "_Vc_note": "sqrt(2*sigma/rho); Certain",
   "safety_factor": 2.5,
   "derate_fraction": 0.3,
   "_derate_note": "30% strength reduction for seams/joints/degradation is the conservative Rev A planning case; 0% and 15% are documented as optimistic/baseline sensitivity cases. [Likely]",
   "construction_baseline": "Spectra/UHMWPE core + Zylon outer arm (Hoytether architecture)",
   "alternative_fibers": {
    "Dyneema_SK99_GPa": 3.6,
    "_sk99_note": "Corrected from 3.9 GPa per VM-001",
    "T1100G_carbon_GPa": 7.0,
    "_t1100g_note": "Verified per VM-001; density 1790 kg/m3"
   }
  },
  "mass_ratio": {
   "integrated_tether_to_payload_both_arms": {
    "confidence": "[Certain] for equation; [Likely] for derate ladder",
    "equation": "2 * sqrt(pi) * x * exp(x^2) * erf(x); x=(V_t/V_c_material)*sqrt(SF/(1-sigma_derate))",
    "source": "Moravec/Forward taper-optimized integrated tether mass formula; not EQ-5 peak area taper",
    "payload_mass_kg_for_tonnage": 5000,
    "SF": 2.5,
    "reference_v_tip_kms": 2.5,
    "optimistic_0pct_derate": 40.32,
    "optimistic_0pct_fiber_mass_t": 201.6,
    "baseline_15pct_derate": 64.3,
    "baseline_15pct_fiber_mass_t": 321.5,
    "conservative_30pct_derate": 121.83,
    "conservative_30pct_fiber_mass_t": 609.1,
    "phase3_3p5kms_30pct_derate": 3085.95,
    "phase3_3p5kms_30pct_fiber_mass_t": 15429.8,
    "note": "[Certain] The old EQ-5 peak taper entry has been removed because peak area ratio is not integrated tether mass. At the 2.5 km/s GTO/high-elliptical reference, integrated two-arm mass ratio spans 40.32x at 0% derate, 64.30x at 15% derate, and 121.83x at 30% derate. The 2.8 km/s cislunar revenue-gated option is 295.27x at 30% derate; the 3.5 km/s Mars-class growth option reaches ~3085.95x at 30% derate.",
    "cislunar_2p8kms_30pct_derate": 295.27,
    "cislunar_2p8kms_30pct_fiber_mass_t": 1476.3
   },
   "tip_speed_to_Vc_ratio": 0.92,
   "_ratio_note": "2.5 / 2.73 = 0.92; below the 1.3x mass-growth guardrail. [Certain]"
  },
  "reboost": {
   "method": "Electrodynamic (ED) primary + electric propulsion backup",
   "flight_heritage": "TSS-1R: >3500V, >1A (1996); TEPCE (2019)",
   "_TSS1R_note": "Corrected from earlier 480mA figure per VM-001"
  },
  "market_thresholds": {
   "GTO_tip_speed_kms": 2.1,
   "cislunar_TLI_tip_speed_kms": 2.8,
   "escape_C3_0_tip_speed_kms": 2.9,
   "mars_class_C3_8_to_13_tip_speed_kms": [
    3.3,
    3.5
   ],
   "mars_escape_tip_speed_kms": 3.5,
   "_note": "Destination thresholds are physics thresholds evaluated at the upper-tip radius r=R_E+610+320=7301 km using eps=v_rel^2/2 - mu/r. GTO/GEO-apogee ~=2.1 km/s; lunar-apogee/TLI ~=2.8 km/s; C3=0 escape ~=2.9 km/s; Mars-class C3~8-13 ~=3.3-3.5 km/s. Do not move these thresholds to match the chosen reference. [Certain]"
  },
  "economics": {
   "launch_price_anchor_dedicated_kgs": 3245,
   "_launch_price_note": "Falcon 9 dedicated; Feb 2026 price increase; Anchored — verify quarterly",
   "launch_price_rideshare_kgs": 7000,
   "spacex_internal_marginal_kgs": 629,
   "_marginal_note": "Floor that matters for LEO revenue threat scenario; Speculative estimate",
   "phase0_capex_M": 18,
   "fiber_cost_per_kg": null,
   "_fiber_cost_note": "WEAKEST INPUT — no vendor quote; obtain from Toyobo/Avient/Toray"
  },
  "heritage": {
   "SEDS_1_2_km": 20,
   "TSS1R_km": 19.7,
   "YES2_km": 31.7,
   "_YES2_note": "Longest artificial structure in space; actual payload delivery via tether swing",
   "TEPCE_year": 2019,
   "HASTOL_mass_ratio_at_SF3": 10,
   "_HASTOL_note": "Boeing/Tethers Unlimited; corrected attribution per VM-001"
  }
 },
 "mxer": {
  "status": "DRAFT — non-canonical; do not cite as design",
  "confidence": "[Speculative] draft fork analysis; Rev A remains canonical",
  "catch_origin": {
   "type": "circular LEO",
   "catch_altitude_km": 450,
   "confidence": "[Likely] geometry solve; ops/capture envelope not modeled"
  },
  "tether_com_orbit": {
   "perigee_altitude_km": 600,
   "apogee_altitude_km": 7418.213,
   "semi_major_axis_km": 10380.107,
   "period_min": 175.413,
   "v_perigee_kms": 8.715453,
   "confidence": "[Likely] two-body vis-viva solve"
  },
  "tether": {
   "L_half_km": 150,
   "v_tip_kms": 1.071031,
   "tip_acceleration_g": 0.7798,
   "safety_factor": 2.5,
   "derate_fraction_reference": 0.3,
   "mass_ratio_30pct_derate": 3.223544
  },
  "payload_class": {
   "reference_payload_t": 5,
   "fiber_mass_t_at_30pct_derate": 16.118
  },
  "capex_inputs": {
   "hub_mass_t": 30,
   "hub_mass_note": "[FLAGGED] 200 t x fiber_mass/609 t, floored at 30 t"
  }
 },
 "reboostBoundFindings": {
  "path": "finance/REBOOST_BOUND_FINDINGS.md",
  "grid": [
   {
    "eta": 0.3,
    "duty": 0.3,
    "power_kw": 50.0,
    "t_rec_days": 271.7,
    "support": "neither"
   },
   {
    "eta": 0.3,
    "duty": 0.3,
    "power_kw": 100.0,
    "t_rec_days": 135.9,
    "support": "neither"
   },
   {
    "eta": 0.3,
    "duty": 0.3,
    "power_kw": 250.0,
    "t_rec_days": 54.3,
    "support": "24 only"
   },
   {
    "eta": 0.3,
    "duty": 0.3,
    "power_kw": 500.0,
    "t_rec_days": 27.2,
    "support": "both"
   },
   {
    "eta": 0.3,
    "duty": 0.5,
    "power_kw": 50.0,
    "t_rec_days": 163.0,
    "support": "neither"
   },
   {
    "eta": 0.3,
    "duty": 0.5,
    "power_kw": 100.0,
    "t_rec_days": 81.5,
    "support": "neither"
   },
   {
    "eta": 0.3,
    "duty": 0.5,
    "power_kw": 250.0,
    "t_rec_days": 32.6,
    "support": "both"
   },
   {
    "eta": 0.3,
    "duty": 0.5,
    "power_kw": 500.0,
    "t_rec_days": 16.3,
    "support": "both"
   },
   {
    "eta": 0.5,
    "duty": 0.3,
    "power_kw": 50.0,
    "t_rec_days": 163.0,
    "support": "neither"
   },
   {
    "eta": 0.5,
    "duty": 0.3,
    "power_kw": 100.0,
    "t_rec_days": 81.5,
    "support": "neither"
   },
   {
    "eta": 0.5,
    "duty": 0.3,
    "power_kw": 250.0,
    "t_rec_days": 32.6,
    "support": "both"
   },
   {
    "eta": 0.5,
    "duty": 0.3,
    "power_kw": 500.0,
    "t_rec_days": 16.3,
    "support": "both"
   },
   {
    "eta": 0.5,
    "duty": 0.5,
    "power_kw": 50.0,
    "t_rec_days": 97.8,
    "support": "neither"
   },
   {
    "eta": 0.5,
    "duty": 0.5,
    "power_kw": 100.0,
    "t_rec_days": 48.9,
    "support": "24 only"
   },
   {
    "eta": 0.5,
    "duty": 0.5,
    "power_kw": 250.0,
    "t_rec_days": 19.6,
    "support": "both"
   },
   {
    "eta": 0.5,
    "duty": 0.5,
    "power_kw": 500.0,
    "t_rec_days": 9.8,
    "support": "both"
   },
   {
    "eta": 0.7,
    "duty": 0.3,
    "power_kw": 50.0,
    "t_rec_days": 116.5,
    "support": "neither"
   },
   {
    "eta": 0.7,
    "duty": 0.3,
    "power_kw": 100.0,
    "t_rec_days": 58.2,
    "support": "24 only"
   },
   {
    "eta": 0.7,
    "duty": 0.3,
    "power_kw": 250.0,
    "t_rec_days": 23.3,
    "support": "both"
   },
   {
    "eta": 0.7,
    "duty": 0.3,
    "power_kw": 500.0,
    "t_rec_days": 11.6,
    "support": "both"
   },
   {
    "eta": 0.7,
    "duty": 0.5,
    "power_kw": 50.0,
    "t_rec_days": 69.9,
    "support": "24 only"
   },
   {
    "eta": 0.7,
    "duty": 0.5,
    "power_kw": 100.0,
    "t_rec_days": 34.9,
    "support": "24 only"
   },
   {
    "eta": 0.7,
    "duty": 0.5,
    "power_kw": 250.0,
    "t_rec_days": 14.0,
    "support": "both"
   },
   {
    "eta": 0.7,
    "duty": 0.5,
    "power_kw": 500.0,
    "t_rec_days": 7.0,
    "support": "both"
   }
  ],
  "minPower56": [
   {
    "eta": 0.3,
    "duty": 0.3,
    "power_kw": 416.6
   },
   {
    "eta": 0.3,
    "duty": 0.5,
    "power_kw": 250.0
   },
   {
    "eta": 0.5,
    "duty": 0.3,
    "power_kw": 250.0
   },
   {
    "eta": 0.5,
    "duty": 0.5,
    "power_kw": 150.0
   },
   {
    "eta": 0.7,
    "duty": 0.3,
    "power_kw": 178.6
   },
   {
    "eta": 0.7,
    "duty": 0.5,
    "power_kw": 107.1
   }
  ],
  "dE_throw_j": 105654700000.0,
  "scopeLine": "this is an ENERGY bound, not a Lorentz-force thrust model. Plasma density, field geometry, current collection, arcing, and eclipse are folded into the efficiency and duty brackets [FLAGGED]. Angular-momentum restoration is assumed co-managed with energy restoration via thrust-profile shaping [FLAGGED - standard MXER assumption]. The full orbit-integrated ed_reboost.py remains the open workstream named by the external review; this bound neither replaces nor prejudges it."
 },
 "workbook": {
  "path": "tools/financial/skyhook_financial_model.xlsx",
  "sheet": "Assumptions",
  "rows": {
   "2": {
    "label": "Parameter",
    "Conservative": "Conservative",
    "Baseline": "Baseline",
    "Optimistic": "Optimistic",
    "note": "Source / note"
   },
   "6": {
    "label": "Power chain efficiency (ED reboost)",
    "Conservative": 0.15,
    "Baseline": 0.2,
    "Optimistic": 0.3,
    "note": "array->PMAD->thrust, MXER studies"
   },
   "7": {
    "label": "Electricity cost ($/kWh, amortized array)",
    "Conservative": 0.08,
    "Baseline": 0.06,
    "Optimistic": 0.04,
    "note": "labeled assumption"
   },
   "9": {
    "label": "Hardware mass factor (x tether launch cost)",
    "Conservative": 1.8,
    "Baseline": 1.6,
    "Optimistic": 1.4,
    "note": "hub/arrays/tips, Part 7.2"
   },
   "11": {
    "label": "Mature cadence (catches/day)",
    "Conservative": 1.0,
    "Baseline": 2.0,
    "Optimistic": 3.0,
    "note": "Part 7.3"
   },
   "12": {
    "label": "Payload per catch (kg)",
    "Conservative": 5000.0,
    "Baseline": 5000.0,
    "Optimistic": 5000.0,
    "note": "Phase 3 reference"
   }
  }
 },
 "lines": {
  "skyhook_physics": {
   "path": "physics/skyhook_physics.py",
   "lines": {
    "40": "R_EARTH_KM = 6371.0                             # mean radius      [Certain]"
   }
  },
  "tether_dynamics": {
   "path": "physics/tether_dynamics.py",
   "lines": {
    "75": "    # [Speculative] hub mass: project_instructions Part VI Phase 2 quotes a",
    "76": "    # 100-300 t hub; 200 t midpoint used until a hub mass budget exists.",
    "77": "    hub_mass_kg: float = 200e3"
   }
  },
  "project_instructions": {
   "path": "docs/project_instructions.md",
   "lines": {
    "42": "Worked baseline example (our Phase 2 reference design):",
    "44": "- Tether half-length L = 320 km, so lower tip dips to ~290 km altitude at bottom of swing... wait — for an atmosphere-grazing design we want the tip much lower. For our **HASTOL-class reference design** (modeled on the Boeing/Tethers Unlimited Hypersonic Airplane Space Tether Orbital Launch study), the lower tip reaches down to roughly **80–150 km altitude**, where a hypersonic aircraft or reusable suborbital rocket can meet it.",
    "118": "The center-of-mass node hosts: solar arrays (hundreds of kW in Phase 2, multi-MW in Phase 3), batteries/flywheels for eclipse and surge power, the electrodynamic reboost power electronics, command and data handling, the winch systems that adjust tether length and trim the center of mass, attitude/rotation control thrusters for spin-up and emergency damping, propellant storage for the electric propulsion system, and (Phase 3+) crew-tended servicing facilities. The hub also serves as the ballast: its mass dominates the system, and locating massive, low-value mass here (spent stages, water, slag from early construction) is encouraged because **ballast mass improves catch dynamics** — a heavier skyhook loses a smaller fraction of its velocity per catch, simplifying everything.",
    "143": "- **Electrodynamic (ED) reboost** is the skyhook's superpower: run current through conductive tether segments (aluminum or copper-clad lines woven into the structure), and the Earth's magnetic field exerts a Lorentz force — thrust with **zero propellant**, paid for entirely in solar electricity. Drive current one way to raise the orbit, reverse it to lower; modulate with rotation phase to also manage spin rate. Power levels of 100 kW–1 MW yield meaningful daily momentum restoration in LEO where the field is strong and plasma is dense.",
    "145": "- Sizing requirement: the reboost system must restore the momentum of one full design-payload boost within the planned inter-catch interval (initially 5–10 days, shrinking to < 1 day at maturity) with 30% margin.",
    "193": "- 200–400 km class Hoytether, hub mass of order 100–300 t (assembled over many launches; falling commercial launch prices are our friend during construction — we are launch's customer before we are its competitor), tip speed initially **1.5–2.0 km/s**, deliberately modest to keep taper ratios small and tether mass affordable.",
    "218": "Marginal cost per boosted kilogram = (electricity for reboost + grapple/ops wear + insurance increment + ops labor) ÷ kg. Electricity dominates and is absurdly cheap: restoring ~30 MJ/kg of orbital energy via solar-powered ED reboost at even 20% chain efficiency costs **on the order of a few dollars of amortized solar-array time per kilogram**. The marginal cost of a skyhook boost is essentially *rounding error*; the entire price the customer pays above a few tens of dollars/kg is margin available to amortize capital. Compare: chemical launch marginal cost is bounded below by propellant and expended/refurbished hardware at tens to hundreds of $/kg even for the best reusable rockets, before capital recovery."
   }
  },
  "mp001": {
   "path": "docs/research/mp001_market_pricing.md",
   "lines": {
    "37": "**3a · Reboost coefficient grounded [Anchored].** Rev A imparts 44.8 MJ/kg = 12.4 kWh/kg of mechanical energy to the payload. Our 48 kWh/kg electrical placeholder therefore implies **~26% wall-to-momentum ED-reboost efficiency** — a derivable, defensible middle. Ladder at 15% / 26% / 40% efficiency → 83 / 48 / 31 kWh/kg → **$7.60 / $4.40 / $2.85 per kg** at 9.17¢/kWh. Reboost stays a rounding error; the coefficient is no longer a magic number."
   }
  },
  "skyhook_finance": {
   "path": "finance/skyhook_finance.py",
   "lines": {
    "211": "    Reboost energy 2*v_orb*v_tip MJ/kg (workbook EQ-5 momentum view);",
    "215": "    reboost_MJ_per_kg = 2.0 * v_orb * s.tip_speed_kms",
    "216": "    elec = reboost_MJ_per_kg / s.power_chain_efficiency / 3.6 * s.electricity_per_kwh"
   }
  },
  "test_analysis_layer": {
   "path": "tests/test_analysis_layer.py",
   "lines": {
    "77": "    assert bound.dE_throw_j == pytest.approx(1.056547e11, rel=0.001)",
    "78": "    assert reboost_bound.min_power_for_56_kw(bound, ref, 0.5, 0.5) == pytest.approx(150.0, rel=0.01)",
    "79": "    assert reboost_bound.min_power_for_56_kw(bound, ref, 0.3, 0.3) == pytest.approx(416.6, rel=0.01)"
   }
  },
  "glossary": {
   "path": "docs/glossary.md",
   "lines": {
    "35": "**Momentum bank / Momentum ledger**",
    "36": "The accounting framework for the skyhook's orbital energy. Every catch-and-throw of an upbound payload is a \"withdrawal\" (tether orbit drops). Every catch of a downbound payload (returning capsules, lunar exports, deorbiting satellites) is a \"deposit\" (orbit rises). ED reboost is the interest-rate mechanism. Balanced two-way traffic allows near-indefinite operation with minimal electric energy expenditure."
   }
  },
  "reboost_bound": {
   "path": "finance/reboost_bound.py",
   "lines": {
    "28": "R_GEO_KM = 42_164.0  # [FLAGGED] GEO radius convention inherited from in-space fork solver.",
    "29": "ENERGY_CROSSCHECK_J = 1.06e11",
    "30": "INSTALLED_POWER_KW = (50.0, 100.0, 250.0, 500.0)",
    "31": "ETA_CHAIN = (0.3, 0.5, 0.7)",
    "32": "DUTY_FACTORS = (0.3, 0.5)",
    "33": "SPECIFIC_POWER_WKG = (50.0, 100.0)",
    "36": "    \"this is an ENERGY bound, not a Lorentz-force thrust model. Plasma density, \"",
    "118": "    e_in_jkg = -MU_EARTH / (2.0 * r_catch_km * 1000.0)",
    "119": "    e_out_jkg = -MU_EARTH / (2.0 * a_transfer_km * 1000.0)",
    "120": "    dE_throw_j = ref.payload_t * 1000.0 * (e_out_jkg - e_in_jkg)",
    "147": "    return dE_throw_j / (power_kw * 1000.0 * eta * duty) / 86400.0"
   }
  },
  "program_site": {
   "path": "tools/sims/skyhook_program_site.html",
   "lines": {
    "847": "      if(boost){ var sp=Math.hypot(st.vx[i],st.vy[i]); ax+=2e-6*st.vx[i]/sp; ay+=2e-6*st.vy[i]/sp; }"
   }
  }
 },
 "values": {
  "skyhook_physics.r_earth_km": {
   "text": "6371.0",
   "path": "physics/skyhook_physics.py",
   "line": 40
  },
  "tether_dynamics.hub_lo_t": {
   "text": "100",
   "path": "physics/tether_dynamics.py",
   "line": 76
  },
  "tether_dynamics.hub_hi_t": {
   "text": "300",
   "path": "physics/tether_dynamics.py",
   "line": 76
  },
  "tether_dynamics.hub_mid_t": {
   "text": "200",
   "path": "physics/tether_dynamics.py",
   "line": 76
  },
  "tether_dynamics.hub_mass_kg": {
   "text": "200e3",
   "path": "physics/tether_dynamics.py",
   "line": 77
  },
  "project_instructions.hastol_lo_km": {
   "text": "80",
   "path": "docs/project_instructions.md",
   "line": 44
  },
  "project_instructions.hastol_hi_km": {
   "text": "150",
   "path": "docs/project_instructions.md",
   "line": 44
  },
  "project_instructions.ed_p_lo_kw": {
   "text": "100",
   "path": "docs/project_instructions.md",
   "line": 143
  },
  "project_instructions.ed_p_hi_mw": {
   "text": "1",
   "path": "docs/project_instructions.md",
   "line": 143
  },
  "project_instructions.interval_lo_d": {
   "text": "5",
   "path": "docs/project_instructions.md",
   "line": 145
  },
  "project_instructions.interval_hi_d": {
   "text": "10",
   "path": "docs/project_instructions.md",
   "line": 145
  },
  "project_instructions.interval_mature_d": {
   "text": "1",
   "path": "docs/project_instructions.md",
   "line": 145
  },
  "project_instructions.margin_pct": {
   "text": "30",
   "path": "docs/project_instructions.md",
   "line": 145
  },
  "project_instructions.hub_lo_t": {
   "text": "100",
   "path": "docs/project_instructions.md",
   "line": 193
  },
  "project_instructions.hub_hi_t": {
   "text": "300",
   "path": "docs/project_instructions.md",
   "line": 193
  },
  "project_instructions.founding_mj_per_kg": {
   "text": "30",
   "path": "docs/project_instructions.md",
   "line": 218
  },
  "mp001.mp001_mj_per_kg": {
   "text": "44.8",
   "path": "docs/research/mp001_market_pricing.md",
   "line": 37
  },
  "mp001.mp001_kwh_per_kg": {
   "text": "12.4",
   "path": "docs/research/mp001_market_pricing.md",
   "line": 37
  },
  "mp001.mp001_eta_mid_pct": {
   "text": "26",
   "path": "docs/research/mp001_market_pricing.md",
   "line": 37
  },
  "mp001.eta_lo_pct": {
   "text": "15",
   "path": "docs/research/mp001_market_pricing.md",
   "line": 37
  },
  "mp001.eta_mid_pct": {
   "text": "26",
   "path": "docs/research/mp001_market_pricing.md",
   "line": 37
  },
  "mp001.eta_hi_pct": {
   "text": "40",
   "path": "docs/research/mp001_market_pricing.md",
   "line": 37
  },
  "test_analysis_layer.golden_dE_j": {
   "text": "1.056547e11",
   "path": "tests/test_analysis_layer.py",
   "line": 77
  },
  "test_analysis_layer.golden_rel": {
   "text": "0.001",
   "path": "tests/test_analysis_layer.py",
   "line": 77
  },
  "test_analysis_layer.golden_pmin_55_kw": {
   "text": "150.0",
   "path": "tests/test_analysis_layer.py",
   "line": 78
  },
  "test_analysis_layer.golden_pmin_33_kw": {
   "text": "416.6",
   "path": "tests/test_analysis_layer.py",
   "line": 79
  },
  "reboost_bound.r_geo_km": {
   "text": "42_164.0",
   "path": "finance/reboost_bound.py",
   "line": 28
  },
  "reboost_bound.rb_powers_kw": {
   "text": "50.0, 100.0, 250.0, 500.0",
   "path": "finance/reboost_bound.py",
   "line": 30
  },
  "reboost_bound.rb_eta": {
   "text": "0.3, 0.5, 0.7",
   "path": "finance/reboost_bound.py",
   "line": 31
  },
  "reboost_bound.rb_duty": {
   "text": "0.3, 0.5",
   "path": "finance/reboost_bound.py",
   "line": 32
  },
  "reboost_bound.rb_specific_power_wkg": {
   "text": "50.0, 100.0",
   "path": "finance/reboost_bound.py",
   "line": 33
  },
  "program_site.site_boost_accel_kms2": {
   "text": "2e-6",
   "path": "tools/sims/skyhook_program_site.html",
   "line": 847
  }
 }
};
});
