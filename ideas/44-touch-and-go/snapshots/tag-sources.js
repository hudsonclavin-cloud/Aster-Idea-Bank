/* Published OSIRIS-REx Touch-and-Go figures this module uses, transcribed from the documents oracle/fetch-sources.sh
 * downloads. Each figure carries the sentence or table row it comes from (`q`) and the document (`doc`); build-data.mjs
 * checks every quote is really in that document (whitespace normalised) and records the documents' sha256 in the sidecar.
 * Classic script (window.TouchSources) and require(). Units as stated per field. Hand-transcribed; do not compute here. */
(function (root) {
  var D = {
    docs: {
      berry2021: 'K. E. Berry et al., "Contact with Bennu! Flight Performance Versus Prediction of OSIRIS-REx TAG Sample Collection" (NASA GSFC / KinetX; NTRS 20210025295)',
      berry2020: 'K. Berry et al., "Revisiting OSIRIS-REx Touch-And-Go (TAG) Performance Given the Realities of Asteroid Bennu", AAS 20-088 (NTRS 20200000774)',
      may2014: 'A. May et al., "OSIRIS-REx Touch-and-Go (TAG) Mission Design for Asteroid Sample Collection", IAC-14-A3.4.8 (NTRS 20140017837)',
      walsh2022: 'K. J. Walsh et al., "Assessing the Sampleability of Bennu\'s Surface for the OSIRIS-REx Asteroid Sample Return Mission", Space Sci. Rev. 218:20 (2022), open access (NTRS 20220006342)',
      posttag: '"OSIRIS-REx Post-TAG Observation Trajectory Design and Navigation Performance" (NTRS 20220000264)',
      nasa20201021: 'NASA, "OSIRIS-REx TAGs Surface of Asteroid Bennu", 21 Oct 2020',
      nasa20210415: 'NASA, "NASA\'s OSIRIS-REx Leaves its Mark on Asteroid Bennu", 15 Apr 2021',
      nasa20220707: 'NASA, "Surprise - Again! Asteroid Bennu Reveals its Surface is Like a Plastic Ball Pit", 7 Jul 2022',
      nasa20240215: 'NASA Science, "NASA Announces OSIRIS-REx Bulk Sample Mass", 15 Feb 2024',
      horizons: 'JPL Horizons, OSIRIS-REx (-64) object header and ORX_merged trajectory (retrieved 2026-10-31)'
    },
    profile: {
      departure_radius_m: { v: 1000, doc: 'berry2020', q: 'roughly 1 km from Bennu\'s center' },
      dep_to_cp_h: { v: 4, doc: 'berry2020', q: 'Approximately 4 hours later, the spacecraft arrives at Checkpoint with an altitude of 125 m above the TAG site' },
      h_cp_m: { v: 125, doc: 'berry2020', q: 'Approximately 4 hours later, the spacecraft arrives at Checkpoint with an altitude of 125 m above the TAG site' },
      cp_to_mp_min: { v: 10, doc: 'berry2020', q: 'followed by the Matchpoint burn 10 minutes later' },
      h_mp_m: { v: 50, doc: 'berry2020', q: 'Matchpoint occurs at 50 m above the TAG site' },
      h_mp_m_2014: { v: 55, doc: 'may2014', q: 'reaches the Matchpoint at an altitude of 55 m' },
      mp_to_tag_min_2014: { v: 10, doc: 'may2014', q: 'TAG occurs approximately 10 minutes after the Matchpoint maneuver' },
      v_td_m_s: { v: 0.10, doc: 'berry2020', q: 'with a vertical velocity of –10 cm/s' },
      v_td_max_m_s: { v: 0.12, doc: 'may2014', q: 'The maximum vertical velocity has been designed to 12 cm/s' },
      v_err_req_3s_m_s: { v: 0.02, doc: 'may2014', q: 'TAG contact velocity error < 2cm/s' },
      bab_m_s: { v: 0.40, doc: 'posttag', q: '40 cm/s back-away burn (BAB)' },
      bab_after_contact_s: { v: 5, doc: 'posttag', q: 'perform the BAB approx- imately 5 seconds after detecting surface contact' },
      bab_escape_m_s: { v: 0.5, doc: 'may2014', q: '>0.5 m/s burn ensures escape' },
      contact_range_s: { v: [2, 20], doc: 'may2014', q: 'the contact event duration can be as short as 2 seconds or as long as 20 seconds' },
      waveoff_alt_m: { v: 5, doc: 'berry2021', q: 'resulting in an early back-away burn at 5 m altitude' },
      safe_radius_m: { v: 8, doc: 'berry2021', q: 'the largest hazard-free sites were no larger than 8 meters in radius' },
      tip_over_deg: { v: 25, doc: 'berry2021', q: 'the spacecraft could tip -over by up to 25 degrees' },
      contact_design_s: { v: 5, doc: 'berry2021', q: 'designed to maintain contact with the surface for at least 5 seconds based on a 10 cm/s vertical velocity' }
    },
    // Maneuver execution errors, Berry 2021 Table 2 (identical rows in Berry 2020 Table 2 for Checkpoint and Matchpoint).
    // magnitude: RSS(a mm/s, b % of the component's dv); transverse: c mm/s + d % of it. Sigma level not printed (taken as 3 sigma, as Tables 1 and 3 are).
    execution: {
      doc: 'berry2021',
      late: { ODM: [0.4, 0.0, 0.0, 1.3], CPX: [1.3, 4.4, 0.0, 3.0], CPY: [1.3, 4.4, 1.0, 3.5], CPZ: [1.3, 4.4, 0.5, 1.4], MPX: [1.3, 4.4, 1.0, 3.0], MPY: [1.3, 4.4, 1.3, 5.5], MPZ: [1.3, 4.4, 0.0, 1.2] },
      prelaunch: { ODM: [0.3, 1.5, 0.3, 2.5], CPX: [1.5, 5.0, 1.5, 10], CPY: [1.5, 5.0, 1.5, 10], CPZ: [1.5, 5.0, 1.5, 2.5], MPX: [1.5, 5.0, 1.5, 10], MPY: [1.5, 5.0, 1.5, 10], MPZ: [1.5, 5.0, 1.5, 2.5] },
      // the table's rows as printed: pre-launch magnitude, pre-launch transverse, then the late-update pair (build-data.mjs re-forms each row from the arrays above and checks it)
      rows: { ODM: 'Orbit Departure', CPX: 'Checkpoint X', CPY: 'Checkpoint Y', CPZ: 'Checkpoint Z', MPX: 'Matchpoint X', MPY: 'Matchpoint Y', MPZ: 'Matchpoint Z' },
      q: ['Orbit Departure RSS(0.3mm/s, 1.5%ΔV) 0.3mm/s+2.5%ΔV RSS(0.4mm/s, 0.0%ΔV) 0.0mm/s+1.3%ΔV', 'Checkpoint X RSS(1.5mm/s, 5.0%ΔV) 1.5mm/s+10%ΔV RSS(1.3mm/s, 4.4%ΔV) 0.0mm/s+3.0%ΔV',
        'Checkpoint Y RSS(1.5mm/s, 5.0%ΔV) 1.5mm/s+10%ΔV RSS(1.3mm/s, 4.4%ΔV) 1.0mm/s+3.5%ΔV', 'Checkpoint Z RSS(1.5mm/s, 5.0%ΔV) 1.5mm/s+2.5%ΔV RSS(1.3mm/s, 4.4%ΔV) 0.5mm/s+1.4%ΔV',
        'Matchpoint X RSS(1.5mm/s, 5.0%ΔV) 1.5mm/s+10%ΔV RSS(1.3mm/s, 4.4%ΔV) 1.0mm/s+3.0%ΔV', 'Matchpoint Y RSS(1.5mm/s, 5.0%ΔV) 1.5mm/s+10%ΔV RSS(1.3mm/s, 4.4%ΔV) 1.3mm/s+5.5%ΔV',
        'Matchpoint Z RSS(1.5mm/s, 5.0%ΔV) 1.5mm/s+2.5%ΔV RSS(1.3mm/s, 4.4%ΔV) 0.0mm/s+1.2%ΔV']
    },
    // NFT (onboard) state uncertainty at Checkpoint, 3 sigma per axis, Berry 2021 Table 3.
    nft: { doc: 'berry2021', late: { pos_m: 1.0, vel_mm_s: 1.0 }, prelaunch: { pos_m: 3.0, vel_mm_s: 3.0 }, q: 'Late Update              1.0               1.0                 1.0         1.0              1.0             1.0' },
    // Published TAG delivery: Monte Carlo predictions and the flight result.
    delivery: {
      nightingale_2020: { pos_3s_m: 8.12, horiz_3s_mm_s: 6.64, vert_3s_mm_s: 6.95, doc: 'berry2020', q: 'Nightingale                8.12                         6.64                         6.95' },
      prelaunch_2020: { pos_3s_m: [17, 20], horiz_3s_mm_s: [12, 15], vert_3s_mm_s: [9.4, 15], doc: 'berry2020', q: 'Pre-Launch               17 - 20                       12 - 15                     9.4 - 15' },
      prelim_max_m: { v: 6.8, doc: 'berry2021', q: 'the maximum TAG position error was 6.8 m with a probability of wave-off of 5.8%' },
      late_max_m: { v: 6.5, doc: 'berry2021', q: 'The final maximum TAG position error estimate was 6.5 m with a probability of wave-off of 5.4%' },
      flown_error_m: { v: 0.98, doc: 'berry2021', q: 'Ground Reconstruction                     0.98                    0.150                    0.146' },
      vel_req_mm_s: { v: 20, doc: 'berry2020', q: 'the 20 mm/s maximum horizontal and vertical velocity requirements' }
    },
    contact: {
      v_contact_m_s: { v: 0.10, doc: 'nasa20201021', q: 'traveling at 0.2 mph (10 cm/sec) when it contacted sample site Nightingale and then backed away at 0.9 mph (40 cm/sec)' },
      v_backaway_m_s: { v: 0.40, doc: 'nasa20201021', q: 'traveling at 0.2 mph (10 cm/sec) when it contacted sample site Nightingale and then backed away at 0.9 mph (40 cm/sec)' },
      contact_s: { v: 6, doc: 'nasa20201021', q: 'touched Bennu’s surface for approximately 6 seconds, after which the spacecraft performed a back-away burn' },
      gas_after_s: { v: 1, doc: 'walsh2022', q: 'which occurs 1 s after the TAGSAM head makes contact with the surface' },
      collect_first_s: { v: 3, doc: 'nasa20201021', q: 'the majority of sample collection occurred within the first 3 seconds' },
      penetration_m: { v: 0.488, doc: 'nasa20210415', q: 'sampling head sunk 1.6 feet (48.8 centimeters) into the asteroid’s surface' },
      still_plunging: { v: true, doc: 'nasa20220707', q: 'By the time we fired our thrusters to leave the surface we were still plunging into the asteroid' },
      crater_m: { v: 8, doc: 'nasa20220707', q: 'left a large crater that was 26 feet (8 meters) wide' },
      confirm_utc: { v: '2020-10-20T22:08Z', doc: 'nasa20201021', q: 'The team on Earth received confirmation at 6:08 p.m. EDT that successful touchdown occurred' }
    },
    tagsam: {
      tall_m: { v: 0.07, doc: 'walsh2022', q: 'cylindrical container that is ∼ 7 cm tall, 32 cm in base plate diameter, and 21 cm in opening diameter' },
      base_d_m: { v: 0.32, doc: 'walsh2022', q: 'cylindrical container that is ∼ 7 cm tall, 32 cm in base plate diameter, and 21 cm in opening diameter' },
      opening_d_m: { v: 0.21, doc: 'walsh2022', q: 'cylindrical container that is ∼ 7 cm tall, 32 cm in base plate diameter, and 21 cm in opening diameter' },
      wrist_deg: { v: 15, doc: 'walsh2022', q: 'a wrist joint that allows 15◦ of rotation in any direction' },
      arm_m: { v: 3.4, doc: 'horizons', q: 'TAGSAM Length      : 11 ft (3.4 m)' },
      tilt_half_deg: { v: 3.7, doc: 'walsh2022', q: 'The exponential function reaches 50% collection at 3.7◦ tilt' },
      tilt_free_deg: { v: 14, doc: 'walsh2022', q: '14◦ is the number used in the calculation as the maximum tilt that could be accommodated' },
      requirement_g: { v: 60, doc: 'walsh2022', q: '≥ 80% probability of acquiring ≥ 60 g of bulk sample per sampling attempt' }
    },
    spacecraft: {
      dry_kg: { v: 880, doc: 'horizons', q: 'Dry mass (unfueled): 1,940 lbs (880 kg)' },
      wet_kg: { v: 2110, doc: 'horizons', q: 'Wet mass (fueled)  : 4,650 lbs (2,110 kg)' },
      mass_per_area_kg_m2_note: 'area per mass for sunlight: OSIRIS-APEX 81.119 kg/m^2 (AAS 24-063, via idea 42\'s approach-sources.js)'
    },
    // Sampleability (Walsh et al. 2022) at the spot TAGSAM actually contacted, and what came home.
    sample: {
      site_lat_deg: { v: 55.9, doc: 'walsh2022', q: 'actual sampling location at latitude = 55.9◦ , longitude = 41.8◦' },
      site_lon_deg: { v: 41.8, doc: 'walsh2022', q: 'actual sampling location at latitude = 55.9◦ , longitude = 41.8◦' },
      bulk_density_kg_m3: { v: 1190, doc: 'walsh2022', q: 'a bulk density of 1190 kg m−3' },
      rock_tilt_eff: { v: 0.434, doc: 'walsh2022', q: 'The rock tilt efficiency at this location was 0.434' },
      dmin_resolved_m: { v: 0.00765, doc: 'walsh2022', q: 'a minimum particle size of 7.65 mm and PSFD slope of −2.09' },
      dmin_unresolved_m: { v: 0.0038, doc: 'walsh2022', q: 'A minimum particle size of 0.38 cm was used for both Nightingale and Osprey' },
      psfd_slope: { v: -2.09, doc: 'walsh2022', q: 'a minimum particle size of 7.65 mm and PSFD slope of −2.09' },
      predicted_g: { low_resolved: 32.37, low_unresolved: 112.30, high_resolved: 150.48, high_unresolved: 249.89, doc: 'walsh2022',
        q: ['the prediction using only resolved particles is 32.37 g, and the prediction considering unre-', 'For high-mobility scoring, the predictions are 150.48 grams and', '249.89 g, respectively'] },
      zero_tilt_g: { low: 258, high: 575, doc: 'walsh2022', q: 'the low-mobility prediction becomes 258 g and the high-mobility prediction becomes 575 g' },
      returned_g: { v: 121.6, doc: 'nasa20240215', q: 'delivered 4.29 ounces (121.6 grams) of material from asteroid Bennu' }
    },
    reconstruction: {
      segment_descent: 'orx_200827_201020_201020_od294-N_tag_v1',
      segment_predict: 'orx_200827_201103_201019_od292-N-T1D-L-T1R1_v1',
      segment_after: 'orx_201020_210601_201109_od295-R_v1',
      doc: 'horizons', q: 'orx_200827_201020_201020_od294-N_tag_v1'
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.TouchSources = D;
})(typeof self !== 'undefined' ? self : this);
