/*
 * The Long Way Round, module 50: the whole mission.
 *
 * Ideas 31 to 49 each hand on one JSON handoff. This kernel reads a chain of them (run whole by run-chain.mjs, bundled
 * in snapshots/missions.js, or pasted by a person) and makes the mission out of it: every link reduced to the numbers a
 * mission ledger needs (EXTRACT, with where each came from), the events in time order, the mass at each, the delta-v
 * budget and who pays it, the seams where one link starts from something other than what the previous one ended with,
 * every refusal the chain carried, and a verdict. It adds no physics of its own to the chain's: the what-if (closure)
 * re-runs the three mass budgets the chain already has (idea 42's tank sizing, idea 47's return ledger excerpted
 * verbatim, idea 49's main-parachute sizing) on a spacecraft mass you choose, with every other link's numbers held, and
 * reads Aster's launch-vehicle curves (NASA LSP elvperf) at the mission's C3.
 *
 * Units: SI throughout (m, s, kg, m/s, m^2/s^2); times are TDB seconds past J2000 beside UTC strings as each module gave
 * them (TDB - UTC = 69.184 s in this span, Aster's offset, as every module uses). Frames: as each module states (geocentric
 * J2000 near the Earth, heliocentric ICRF/J2000 in cruise); this module reads magnitudes, epochs and masses only.
 * Classic script (window.LongWayRound) and require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LongWayRound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400, G0 = 9.80665;   // idea 42's G0 (closing.js:28) and PartForge's ISA_G0, the same exact value
  var FROM = { 31: '31-mixture', 32: '32-bell', 33: '33-engine-deck', 34: '34-stack', 35: '35-max-q', 36: '36-closed-loop', 37: '37-window', 38: '38-burn-out',
    39: '39-lamberts-road', 40: '40-long-coast', 41: '41-signal', 42: '42-closing-in', 43: '43-lumpy', 44: '44-touch-and-go', 45: '45-dig', 46: '46-split',
    47: '47-way-home', 48: '48-catch', 49: '49-hot-return' };
  var TITLE = { 31: 'Mixture', 32: 'Bell', 33: 'Engine Deck', 34: 'Stack', 35: 'Max Q', 36: 'Closed Loop', 37: 'Window', 38: 'Burn Out', 39: 'Lambert\'s Road',
    40: 'Long Coast', 41: 'Signal', 42: 'Closing In', 43: 'Lumpy', 44: 'Touch and Go', 45: 'Dig', 46: 'Split', 47: 'Way Home', 48: 'Catch', 49: 'Hot Return' };
  var PHASE = function (n) { return n <= 38 ? 'launch' : n <= 41 ? 'cruise' : n <= 46 ? 'asteroid' : 'return'; };
  // the key under inputs where each module carries the previous module's handoff (whole, or pruned to a digest)
  var UPSTREAM = { 32: 'chamber_handoff', 33: 'nozzle_handoff', 35: 'vehicle_handoff', 36: 'ascent_handoff', 37: 'closed_loop_handoff', 38: 'window_handoff',
    39: 'burnout_handoff', 40: 'lamberts_road_handoff', 41: 'long_coast_handoff', 42: 'signal_handoff', 43: 'closing_handoff', 44: 'lumpy_handoff', 45: 'touch_handoff',
    46: 'dig_handoff', 47: 'split_handoff', 48: 'way_home_handoff', 49: 'catch_handoff' };

  // refusals a module answers instead of carrying on, as each says in its README (so not carrying them is not a loss):
  // 35 "except `losses`, answered here"; 36 "carries idea 35's (except `guidance`, answered here, and its open-loop `orbit` and
  // `trajectory`)"; 40 "except idea 39's `dynamics` and idea 38's `post_cutoff`, which this module lifts"
  var ANSWERED = { 35: ['34-stack:losses'], 36: ['35-max-q:guidance', '35-max-q:orbit', '35-max-q:trajectory'], 40: ['39-lamberts-road:dynamics', '38-burn-out:post_cutoff'] };
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function dig(o, p) {
    if (!p) return o;
    var parts = p.split('.');
    for (var i = 0; i < parts.length; i++) { if (o == null) return undefined; o = o[/^\d+$/.test(parts[i]) ? +parts[i] : parts[i]]; }
    return o;
  }
  function refusal(code, reason, help, extra) { var r = { code: code, reason: reason, what_would_help: help }; for (var k in extra || {}) r[k] = extra[k]; return r; }
  function fmt(x, sig) { if (!num(x)) return String(x); return Number(x.toPrecision(sig || 4)).toLocaleString('en-US', { maximumFractionDigits: 6 }); }

  // ================================================================== what the ledger reads from each link
  // [key, output name (or '@inputs'), path inside its value]. A key's units are its suffix (_kg, _m_s, _s, _utc, ...).
  var EXTRACT = {
    31: [['preset', '@inputs', 'preset'], ['of', '@inputs', 'mixture_ratio'], ['pc_Pa', '@inputs', 'chamber_pressure_Pa'], ['oxidizer', '@inputs', 'oxidizer.0.name'],
      ['fuel', '@inputs', 'fuel.0.name'], ['Tc_K', 'chamber_temperature', ''], ['cstar_m_s', 'cstar', ''], ['bulk_kg_m3', 'bulk_density', '']],
    32: [['eps', 'area_ratio', ''], ['isp_vac_m_s', 'specific_impulse_vacuum_shifting', ''], ['isp_amb_m_s', 'specific_impulse_ambient_shifting', ''],
      ['thrust_N', 'design_thrust', ''], ['exit_d_m', 'exit_diameter', '']],
    33: [['thrust_vac_N', 'thrust_vacuum', ''], ['thrust_sl_N', 'thrust_sea_level', ''], ['isp_vac_m_s', 'specific_impulse_vacuum', ''], ['isp_sl_m_s', 'specific_impulse_sea_level', ''],
      ['mdot_kg_s', 'mass_flow', ''], ['cycle', '@inputs', 'engine.cycle_reference']],
    34: [['vehicle', '@inputs', 'vehicle.label'], ['vehicle_id', '@inputs', 'vehicle.id'], ['liftoff_kg', 'liftoff_mass', ''], ['payload_kg', 'payload_mass', ''],
      ['tw', 'liftoff_thrust_to_weight', ''], ['dv_ideal_m_s', 'delta_v_ideal', '']],
    35: [['maxq_Pa', 'max_dynamic_pressure', ''], ['maxq_t_s', 'max_dynamic_pressure_time', ''], ['maxq_alt_m', 'max_dynamic_pressure_altitude', ''], ['mach1_t_s', 'mach_1_time', ''],
      ['burnout_alt_m', 'burnout_altitude', ''], ['burnout_kg', 'burnout_mass', ''], ['dv_flown_m_s', 'delta_v_ideal_flown', ''], ['loss_gravity_m_s', 'loss_gravity', ''],
      ['loss_drag_m_s', 'loss_drag', ''], ['loss_steering_m_s', 'loss_steering', '']],
    36: [['peri_alt_m', 'parking_orbit', 'perigee_altitude_m'], ['apo_alt_m', 'parking_orbit', 'apogee_altitude_m'], ['incl_deg', 'parking_orbit', 'inclination_deg'],
      ['ins_t_s', 'insertion_state', 't_s'], ['ins_kg', 'insertion_state', 'mass_kg'], ['prop_left_kg', 'propellant_left_in_guided_stage', ''], ['dv_flown_m_s', 'delta_v_ideal_flown', ''],
      ['loss_gravity_m_s', 'loss_gravity', ''], ['loss_steering_m_s', 'loss_steering', ''], ['loss_drag_m_s', 'loss_drag', ''], ['loss_back_pressure_m_s', 'loss_back_pressure', ''],
      ['mc_n', 'scatter', 'n']],
    37: [['launch_utc', 'launch', 'utc'], ['launch_tdb', 'launch', 'tdb_s_past_j2000'], ['az_deg', 'launch', 'azimuth_deg'], ['incl_deg', 'launch', 'inclination_deg'],
      ['win_open_utc', 'daily_windows', '0.open_utc'], ['win_close_utc', 'daily_windows', '0.close_utc'], ['ins_utc', 'insertion_state_j2000', 'utc'], ['ins_tdb', 'insertion_state_j2000', 'tdb_s_past_j2000'],
      ['ins_kg', 'insertion_state_j2000', 'mass_kg'], ['coast_s', 'coast', 'duration_s'], ['dep_utc', 'departure_point', 'utc'], ['dep_tdb', 'departure_point', 'tdb_s_past_j2000'],
      ['dv_imp_m_s', 'impulsive_departure', 'delta_v_m_s'], ['prop_kg', 'propellant_for_departure', ''], ['shortfall_m_s', 'departure_delta_v_capacity', 'shortfall_m_s'],
      ['c3_m2_s2', 'asymptote', 'c3_m2_s2'], ['dla_deg', 'asymptote', 'dla_deg'], ['band', 'aster_screening_band', 'class'], ['asym_date', 'asymptote', 'date_utc'], ['asym_source', '@inputs', 'asymptote.source']],
    38: [['engine', 'engine', 'label'], ['ve_m_s', 'engine', 'exhaust_velocity_m_s'], ['tw', 'engine', 'thrust_to_weight_ignition'], ['ign_utc', 'burns', '0.ignition_utc'],
      ['ign_tdb', 'burns', '0.ignition_tdb_s_past_j2000'], ['cut_utc', 'burns', '0.cutoff_utc'], ['cut_tdb', 'burns', '0.cutoff_tdb_s_past_j2000'], ['burn_s', 'burns', '0.duration_s'],
      ['burn_dv_m_s', 'burns', '0.delta_v_m_s'], ['mass_ign_kg', 'burns', '0.mass_ignition_kg'], ['loss_m_s', 'finite_burn_loss', 'loss_m_s'],
      ['prop_avail_kg', 'propellant', 'available_kg'], ['prop_need_kg', 'propellant', 'needed_kg'], ['prop_left_kg', 'propellant', 'remaining_kg'], ['prop_short_kg', 'propellant', 'short_kg'],
      ['cap_handed_kg', 'payload_capability', 'handed_kg'], ['cap_finite_kg', 'payload_capability', 'finite_burn_kg'], ['cap_imp_kg', 'payload_capability', 'impulsive_kg'],
      ['stage_inert_kg', 'payload_capability', 'stage_inert_kg'], ['hds_utc', 'hyperbolic_departure_state', 'utc'], ['hds_tdb', 'hyperbolic_departure_state', 'tdb_s_past_j2000'],
      ['hds_kg', 'hyperbolic_departure_state', 'mass_kg'], ['payload_setting_kg', '@inputs', 'settings.payloadKg']],
    39: [['des', 'target', 'designation'], ['name', 'target', 'name'], ['H', 'target', 'H'], ['radius_m', 'target', 'estimated_radius_m'], ['dep_utc', 'transfer', 'departure_utc'],
      ['dep_tdb', 'transfer', 'departure_tdb_s_past_j2000'], ['arr_utc', 'transfer', 'arrival_utc'], ['arr_tdb', 'transfer', 'arrival_tdb_s_past_j2000'], ['tof_s', 'transfer', 'time_of_flight_s'],
      ['revs', 'transfer', 'revolutions'], ['selected_by', 'transfer', 'selected_by'], ['vinf_dep_m_s', 'v_infinity_departure', 'magnitude_m_s'], ['c3_m2_s2', 'v_infinity_departure', 'c3_m2_s2'],
      ['dla_deg', 'v_infinity_departure', 'dla_deg'], ['band', 'v_infinity_departure', 'band'], ['vinf_arr_m_s', 'v_infinity_arrival', 'magnitude_m_s'],
      ['aster_injection_m_s', 'delta_v_stack', 'injection_m_s'], ['aster_total_return_m_s', 'delta_v_stack', 'total_return_m_s']],
    40: [['arr_utc', 'arrival_state', 'utc'], ['arr_tdb', 'arrival_state', 'tdb_s_past_j2000'], ['vinf_arr_m_s', 'arrival_state', 'v_infinity_arrival_magnitude_m_s'],
      ['dep_kind', 'departure', 'kind'], ['dep_utc', 'departure', 'utc'], ['dep_tdb', 'departure', 'tdb_s_past_j2000']],
    41: [['craft', 'telecom', 'name'], ['cruise_bits', 'data_volume', 'cruise_bits'], ['stay_bits', 'data_volume', 'stay_bits'], ['cruise_days', 'data_volume', 'cruise_days'],
      ['stay_days', 'data_volume', 'stay_days'], ['blackout_days', 'data_volume', 'blackout_days'], ['owlt_s', 'arrival_link', 'owlt_s'], ['rate_bps', 'arrival_link', 'rate_bps'], ['range_m', 'arrival_link', 'range_m']],
    42: [['so_utc', 'standoff_state', 'utc'], ['so_tdb', 'standoff_state', 'tdb_s_past_j2000'], ['so_range_m', 'standoff_state', 'sam.range_m'], ['body', 'body', 'name'],
      ['gm_m3_s2', 'body', 'GM_m3_s2'], ['radius_m', 'body', 'radius_m'], ['rotation_h', 'body', 'rotation_h'], ['appr_dv_m_s', 'approach', 'total_dv_m_s'],
      ['first_burn_utc', 'approach', 'first_burn_utc'], ['isp_s', 'mass', 'isp_s'], ['dry_kg', 'mass', 'dry_kg'], ['loaded_kg', 'mass', 'propellant_loaded_kg'], ['launch_kg', 'mass', 'launch_kg'],
      ['arrival_kg', 'mass', 'arrival_kg'], ['standoff_kg', 'mass', 'standoff_kg'], ['end_stay_kg', 'mass', 'end_of_stay_kg'], ['required_dv_m_s', 'mass', 'required_dv_m_s'],
      ['tcm_dv_m_s', 'mass', 'tcm_dv_m_s'], ['tanks', 'mass', 'tanks'], ['stay_dv_m_s', 'station_keeping', 'stay_dv_m_s'], ['craft', '@inputs', 'settings.craft']],
    43: [['shape', 'body', 'shape_model'], ['plates', 'body', 'plates'], ['spin_h', 'spin', 'period_h'], ['spin_kind', 'spin', 'kind'], ['g_mean_m_s2', 'surface', 'gravity_m_s2.mean'],
      ['slope_mean_deg', 'surface', 'slope_deg.mean'], ['site_lat_deg', 'site', 'lat_deg'], ['site_lon_deg', 'site', 'lon_deg'], ['site_slope_deg', 'site', 'slope_deg'], ['site_escape_m_s', 'site', 'escape_up_m_s']],
    44: [['contact_utc', 'descent', 'contact_utc'], ['contact_tdb', 'descent', 'contact_tdb_s'], ['ellipse_major_m', 'dispersion', 'contact_ellipse_3sigma_m.0'],
      ['p_inside', 'dispersion', 'p_inside_safe_radius'], ['v_in_m_s', 'contact', 'v_in_m_s'], ['backaway_dv_m_s', 'backaway', 'dv_m_s'], ['escapes', 'backaway', 'escapes'],
      ['prop_dv_m_s', 'propellant', 'dv_m_s'], ['prop_need_kg', 'propellant', 'needed_kg'], ['prop_avail_kg', 'propellant', 'available_kg'], ['sample_kg', 'sample', 'mass_kg'],
      ['analog_kg', 'sample', 'nightingale_analog_kg'], ['mass_kg', 'surface_state', 'spacecraft_mass_kg']],
    45: [['spectral', 'site', 'spectral_class'], ['analog', 'feedstock', 'label'], ['water_frac', 'feedstock', 'water_mass_fraction'], ['bound', 'water_rate', 'bound'],
      ['water_kg_day', 'water_rate', 'mean_kg_per_day'], ['water_kg', 'water_rate', 'total_kg'], ['days', 'water_rate', 'days'], ['regolith_kg_day', 'water_rate', 'regolith_kg_per_day'],
      ['first_utc', 'water_rate', 'first_day_utc'], ['mass_kg', 'site', 'mass_kg']],
    46: [['route', 'propellant', 'route'], ['prop_kg', 'propellant', 'mass_kg'], ['fuel_kg', 'propellant', 'fuel_kg'], ['ox_kg', 'propellant', 'oxidizer_kg'], ['of', 'propellant', 'mixture_ratio'],
      ['isp_s', 'propellant', 'isp_s'], ['ve_m_s', 'propellant', 've_m_s'], ['water_in_kg', 'totals', 'water_in_kg'], ['craft_kg', 'dry_mass', 'craft_kg'], ['coolers_kg', 'dry_mass', 'coolers_kg'],
      ['dry_total_kg', 'dry_mass', 'total_kg'], ['dv_est_m_s', 'delta_v_estimate', ''], ['stay_end_utc', 'site', 'stay_end_utc'], ['stay_start_utc', 'site', 'stay_start_utc']],
    47: [['ea_utc', 'earth_arrival', 'utc'], ['ea_tdb', 'earth_arrival', 'tdb_s_past_j2000'], ['vinf_m_s', 'earth_arrival', 'v_infinity_m_s'], ['entry_m_s', 'earth_arrival', 'entry_speed_m_s'],
      ['dep_utc', 'return_transfer', 'departure_utc'], ['dep_tdb', 'return_transfer', 'departure_tdb_s_past_j2000'], ['tof_s', 'return_transfer', 'time_of_flight_s'],
      ['wait_days', 'return_transfer', 'wait_days'], ['dv_raw_m_s', 'return_transfer', 'departure_dv_m_s'], ['dv_used_m_s', 'mass', 'dv_departure_used_m_s'],
      ['dv_brake_m_s', 'mass', 'dv_braking_used_m_s'], ['capacity_m_s', 'mass', 'capacity_m_s'], ['dry_kg', 'mass', 'dry_kg'], ['material_kg', 'mass', 'material_kg'],
      ['material_max_kg', 'mass', 'material_max_kg'], ['material_avail_kg', 'mass', 'material_available_kg'], ['limited_by', 'mass', 'limited_by'],
      ['prop_stay_end_kg', 'mass', 'propellant_stay_end_kg'], ['boil_wait_kg', 'mass', 'boiloff_wait_kg'], ['burned_dep_kg', 'mass', 'burned_departure_kg'],
      ['boil_cruise_kg', 'mass', 'boiloff_cruise_kg'], ['mass_dep_kg', 'mass', 'mass_departure_kg'], ['mass_arr_kg', 'mass', 'mass_arrival_kg'], ['hold', 'mass', 'hold'],
      ['boil_fuel_kg_day', 'mass', 'boiloff_rates_kg_per_day.fuel'], ['boil_ox_kg_day', 'mass', 'boiloff_rates_kg_per_day.oxidizer'], ['boil_applied', 'mass', 'boiloff_rates_kg_per_day.applied'],
      ['ve_m_s', 'propulsion', 've_m_s'], ['enc_utc', 'asteroid', 'encounters.0.utc'], ['enc_dist_m', 'asteroid', 'encounters.0.distance_m']],
    48: [['choice', 'capture', 'choice'], ['destination', 'capture', 'destination'], ['ei_utc', 'entry_interface', 'utc'], ['ei_tdb', 'entry_interface', 'tdb_s_past_j2000'],
      ['ei_speed_m_s', 'entry_interface', 'speed_inertial_m_s'], ['ei_fpa_deg', 'entry_interface', 'fpa_inertial_deg'], ['vehicle', 'vehicle', 'label'], ['veh_kg', 'vehicle', 'mass_kg'],
      ['area_m2', 'vehicle', 'area_m2'], ['peak_g', 'screening', 'peak_g'], ['passes', 'screening', 'passes'], ['entry_kg', 'mass', 'entry_kg'], ['heat_shield_kg', 'mass', 'heat_shield_kg'],
      ['retarget_dv_m_s', 'retarget', 'dv'], ['retarget_prop_kg', 'retarget', 'propellant_needed'], ['retarget_needed', 'retarget', 'needed'], ['prop_avail_kg', 'mass', 'propellant_available_kg']],
    49: [['land_utc', 'landing', 'utc'], ['land_tdb', 'landing', 'tdb_s_past_j2000'], ['lat_deg', 'landing', 'latitude_deg'], ['lon_deg', 'landing', 'longitude_deg'],
      ['ground_alt_m', 'landing', 'ground_alt_m'], ['td_m_s', 'landing', 'touchdown_speed_m_s'], ['entry_kg', 'mass', 'entry_kg'], ['ablated_kg', 'mass', 'ablated_kg'], ['landed_kg', 'mass', 'landed_kg'],
      ['material_kg', 'mass', 'material_kg'], ['peak_g', 'loads', 'peak_g_entry'], ['peak_q_W_m2', 'loads', 'peak_q_total_W_m2'], ['heat_load_J_m2', 'loads', 'heat_load_total_J_m2'],
      ['recession_m', 'heat_shield', 'recession_stag_m'], ['heritage_ok', 'heat_shield', 'heritage.ok'], ['heat_load_ratio', 'heat_shield', 'heritage.heat_load_ratio'],
      ['thickness_m', 'heat_shield', 'thickness_m'], ['main_cds_m2', 'parachutes', 'main_cds_m2'], ['main_equiv', 'parachutes', 'main_equiv_src_canopies'],
      ['main_d_m', 'parachutes', 'main_equiv_diameter_m'], ['touchdown_set_m_s', '@inputs', 'settings.touchdown_m_s']],
  };
  /** Reduce one handoff to the ledger's numbers: {n, from, produced, v: {key: value}, c: {key: confidence}, own: [refusals], carried}. */
  function extract(h) {
    var n = +String(h.from).slice(0, 2), spec = EXTRACT[n];
    if (!spec) return null;
    var v = {}, c = {};
    spec.forEach(function (s) {
      var x = s[1] === '@inputs' ? dig(h.inputs, s[2]) : dig(h.outputs && h.outputs[s[1]] && h.outputs[s[1]].value, s[2]);
      if (x !== undefined) v[s[0]] = x;
      if (s[1] !== '@inputs' && h.outputs && h.outputs[s[1]]) c[s[0]] = h.outputs[s[1]].confidence;
    });
    if (n === 34) { var st = dig(h.outputs, 'stages.value') || []; v.stages = st.map(function (s) { return [s.label, s.count, s.propellant_kg, s.mass_ignition_kg, s.delta_v_m_s]; }); }
    if (n === 40) { var tc = dig(h.outputs, 'tcm_budget.value.tcms') || []; v.tcms = tc.map(function (t) { return [t.name, t.utc, t.tdb_s_past_j2000, t.statistical_p99_m_s]; }); }
    if (n === 41) { var cj = dig(h.outputs, 'conjunctions.value') || []; v.conj = cj.map(function (q) { return [q.start_utc || q.utc || null, q.end_utc || null, q.days || null]; }); }
    if (n === 42) { var bu = dig(h.outputs, 'approach.value.burns') || []; v.burns = bu.map(function (b) { return [b.name, b.utc, b.tdb_s_past_j2000, b.dv_m_s, b.propellant_kg]; }); }
    if (n === 48) { var op = dig(h.outputs, 'capture.value.options') || []; v.options = op.map(function (o) { return [o.id, o.label, !!o.feasible, o.dv_m_s, o.propellant_needed_kg, o.peak_g, o.peak_q_W_m2, o.heat_load_J_m2]; }); }
    if (n === 49) { var tl = dig(h.outputs, 'timeline.value') || []; v.events = tl.map(function (e) { return [e.event, e.t_s]; }); }
    var own = (h.refusals || []).filter(function (r) { return !r.from || r.from === h.from; }).map(function (r) { var q = clone(r); delete q.from; return q; });
    return { n: n, from: h.from, produced: h.produced, v: v, c: c, own: own, carried: (h.refusals || []).length - own.length };
  }
  /** Which refusals each link carries on from the one before: {n, answered: [id], dropped: [id]} where something is missing. */
  function refusalFlow(handoffs) {
    var ns = Object.keys(handoffs).map(Number).sort(function (a, b) { return a - b; }), out = [];
    var id = function (r, h) { return (r.from || h.from) + ':' + (r.applies_to || r.code); };
    ns.forEach(function (n) {
      var h = handoffs[n], p = handoffs[n - 1]; if (!h || !p) return;
      var have = {}; (h.refusals || []).forEach(function (r) { if (r.from && r.from !== h.from) have[id(r, h)] = 1; });
      var prev = {}; (p.refusals || []).forEach(function (r) { prev[id(r, p)] = 1; });
      var miss = Object.keys(prev).filter(function (k) { return !have[k]; });
      if (!miss.length) return;
      var ans = ANSWERED[n] || [];
      out.push({ n: n, answered: miss.filter(function (k) { return ans.indexOf(k) >= 0; }), dropped: miss.filter(function (k) { return ans.indexOf(k) < 0; }) });
    });
    return out;
  }
  function sourceOf(n, key) {
    var s = (EXTRACT[n] || []).filter(function (q) { return q[0] === key; })[0];
    if (!s) return 'ideas/' + FROM[n] + ' handoff';
    return 'ideas/' + FROM[n] + ' handoff ' + (s[1] === '@inputs' ? 'inputs.' + s[2] : 'outputs.' + s[1] + (s[2] ? '.value.' + s[2] : '.value'));
  }

  // ================================================================== records: one mission's links, and many of them packed
  /** run: {choice, links: {n: handoff}, halt, loop, notes}; sha256(string) -> hex. */
  function recordOf(run, sha256) {
    var links = {}, hs = {};
    Object.keys(run.links).forEach(function (k) {
      var h = run.links[k]; if (!h) return;
      var e = extract(h); if (!e) return;
      var s = JSON.stringify(h);
      e.sha256 = sha256(s); e.bytes = s.length; links[e.n] = e; hs[e.n] = h;
    });
    return { choice: clone(run.choice), key: keyOf(run.choice), halt: run.halt ? { at: run.halt.at, refusal: clone(run.halt.refusal) } : null, loop: clone(run.loop || []), notes: clone(run.notes || []),
      links: links, flow: refusalFlow(hs) };
  }
  function keyOf(c) { return [c.rocket, c.rocket === 'as512' || c.rocket === 'as512-sc' ? '-' : c.propellant, c.asteroid].join('|'); }
  /** Numbers to 10 significant figures (every module rounds its handoff to 9 or 10 already): the bundle's size, not its meaning. */
  function r10(x) { return typeof x === 'number' && isFinite(x) && x !== 0 ? +x.toPrecision(10) : x; }
  function deep(o) { if (Array.isArray(o)) return o.map(deep); if (o && typeof o === 'object') { var q = {}; for (var k in o) q[k] = deep(o[k]); return q; } return r10(o); }
  var CONF = { measured: 'm', derived: 'd', assumed: 'a' }, CONF_BACK = { m: 'measured', d: 'derived', a: 'assumed' };
  /**
   * Many records into one object, links, refusals and notes shared: {version 2, links: [{n, from, produced, a: values in
   * EXTRACT order, x: the array extras, c: one letter of confidence per EXTRACT key, own: [refusal index]}],
   * refusals: [[code, applies_to, reason, what_would_help]], notes: [...], runs: [...]}.
   */
  function packRecords(records) {
    var L = [], Lidx = {}, R = [], Ridx = {}, N = [], Nidx = {};
    function ref(r) { var a = [r.code, r.applies_to == null ? null : r.applies_to, r.reason, r.what_would_help == null ? null : r.what_would_help], s = JSON.stringify(a); if (!(s in Ridx)) { Ridx[s] = R.length; R.push(a); } return Ridx[s]; }
    function note(t) { if (!(t in Nidx)) { Nidx[t] = N.length; N.push(t); } return Nidx[t]; }
    var runs = records.map(function (rec) {
      var ids = {}, meta = {};
      Object.keys(rec.links).forEach(function (k) {
        var e = rec.links[k], spec = EXTRACT[e.n], a = [], c = '', x = {};
        spec.forEach(function (q) { var v = e.v[q[0]]; a.push(v === undefined ? null : deep(v)); c += e.c[q[0]] ? CONF[e.c[q[0]]] || '?' : '-'; });
        ['stages', 'tcms', 'conj', 'burns', 'options', 'events'].forEach(function (k2) { if (e.v[k2]) x[k2] = deep(e.v[k2]); });
        var body = { n: e.n, from: e.from, produced: e.produced, a: a, x: x, c: c, own: e.own.map(ref) };
        var s = JSON.stringify(body); if (!(s in Lidx)) { Lidx[s] = L.length; L.push(body); }
        ids[k] = Lidx[s]; meta[k] = [rec.choice.rocket === 'committed' ? e.sha256 : e.sha256.slice(0, 16), e.bytes, e.carried];
      });
      return { key: rec.key, choice: rec.choice, halt: rec.halt, loop: deep(rec.loop), notes: (rec.notes || []).map(note), links: ids, meta: meta, flow: rec.flow || [] };
    });
    return { version: 2, links: L, refusals: R, notes: N, runs: runs };
  }
  function unpack(data, key) {
    var run = null; data.runs.forEach(function (r) { if (r.key === key) run = r; });
    if (!run) return null;
    var links = {};
    Object.keys(run.links).forEach(function (k) {
      var b = data.links[run.links[k]], m = run.meta[k], v = {}, c = {};
      EXTRACT[b.n].forEach(function (q, i) { if (b.a[i] !== null) v[q[0]] = b.a[i]; if (b.c[i] !== '-') c[q[0]] = CONF_BACK[b.c[i]] || b.c[i]; });
      for (var x in b.x) v[x] = b.x[x];
      links[k] = { n: b.n, from: b.from, produced: b.produced, v: v, c: c, own: b.own.map(function (i) { var r = data.refusals[i], o = { code: r[0] }; if (r[1] != null) o.applies_to = r[1]; o.reason = r[2]; if (r[3] != null) o.what_would_help = r[3]; return o; }),
        sha256: m[0], bytes: m[1], carried: m[2] };
    });
    return { choice: clone(run.choice), key: run.key, halt: clone(run.halt), loop: clone(run.loop), notes: run.notes.map(function (i) { return data.notes[i]; }), links: links, flow: clone(run.flow || []) };
  }

  // ================================================================== the mission
  function L(rec, n) { return rec.links[n] || null; }
  function V(rec, n, k) { var l = rec.links[n]; return l && l.v ? l.v[k] : undefined; }
  function departed(rec) { var l = L(rec, 38); return !!(l && num(l.v.hds_tdb)); }

  /** Events in time order: {t (TDB s), utc, label, from, mass_kg, note}. */
  function events(rec) {
    var E = [];
    function add(n, tKey, uKey, label, massKey, extra) {
      var l = L(rec, n); if (!l || !num(l.v[tKey])) return;
      E.push(Object.assign({ t: l.v[tKey], utc: l.v[uKey] || null, label: label, n: n, mass_kg: massKey && num(l.v[massKey]) ? l.v[massKey] : null, mass_from: massKey ? sourceOf(n, massKey) : null }, extra || {}));
    }
    var l34 = L(rec, 34), l37 = L(rec, 37);
    if (l37 && l34) E.push({ t: l37.v.launch_tdb, utc: l37.v.launch_utc, label: 'Liftoff', n: 37, mass_kg: l34.v.liftoff_kg, mass_from: sourceOf(34, 'liftoff_kg') });
    if (l37 && L(rec, 35) && num(L(rec, 35).v.maxq_t_s)) E.push({ t: l37.v.launch_tdb + L(rec, 35).v.maxq_t_s, utc: null, label: 'Max Q (' + fmt(L(rec, 35).v.maxq_Pa / 1000, 3) + ' kPa)', n: 35, mass_kg: null, note: 'on idea 35\'s ascent; idea 37 re-flies it on the window\'s azimuth' });
    add(37, 'ins_tdb', 'ins_utc', 'Parking orbit', 'ins_kg');
    add(38, 'ign_tdb', 'ign_utc', 'Departure burn ignition', 'mass_ign_kg');
    if (departed(rec)) add(38, 'hds_tdb', 'hds_utc', 'Departure burn cutoff: on the way', 'hds_kg');
    add(40, 'dep_tdb', 'dep_utc', departed(rec) ? 'Cruise begins (idea 40 from idea 38\'s state)' : 'Cruise begins (idea 40\'s patched conic; nothing departed)', null);
    var l40 = L(rec, 40);
    if (l40 && l40.v.tcms) l40.v.tcms.forEach(function (q) { E.push({ t: q[2], utc: q[1], label: q[0] + ' (99 %: ' + fmt(q[3], 3) + ' m/s)', n: 40, mass_kg: null, minor: true }); });
    var l42 = L(rec, 42);
    if (l42 && l42.v.burns) l42.v.burns.forEach(function (b, i) { E.push({ t: b[2], utc: b[1], label: b[0] + ' (' + fmt(b[3], 4) + ' m/s)', n: 42, mass_kg: null, minor: i > 0 }); });
    add(40, 'arr_tdb', 'arr_utc', 'Arrival (end of the cruise)', null);
    if (l42) E.push({ t: l42.v.so_tdb, utc: l42.v.so_utc, label: 'Holding at stand-off', n: 42, mass_kg: l42.v.standoff_kg, mass_from: sourceOf(42, 'standoff_kg') });
    add(44, 'contact_tdb', 'contact_utc', 'Touch and go', 'mass_kg');
    var l45 = L(rec, 45), l46 = L(rec, 46);
    if (l45 && l45.v.first_utc) E.push({ t: utcToTdb(l45.v.first_utc), utc: l45.v.first_utc, label: 'Mining begins (' + fmt(l45.v.days, 3) + ' days)', n: 45, mass_kg: null });
    if (l46 && l46.v.stay_end_utc) E.push({ t: utcToTdb(l46.v.stay_end_utc), utc: l46.v.stay_end_utc, label: 'Stay ends: ' + fmt(l46.v.prop_kg, 3) + ' kg of propellant made', n: 46, mass_kg: null });
    add(47, 'dep_tdb', 'dep_utc', 'Leaves the asteroid', 'mass_dep_kg');
    var l47 = L(rec, 47);
    if (l47 && l47.v.enc_utc) E.push({ t: utcToTdb(l47.v.enc_utc), utc: l47.v.enc_utc, label: 'The asteroid\'s own Earth pass (' + fmt(l47.v.enc_dist_m / 1000, 4) + ' km)', n: 47, mass_kg: null, minor: true });
    add(48, 'ei_tdb', 'ei_utc', 'Entry interface (125 km)', 'entry_kg');
    add(49, 'land_tdb', 'land_utc', 'Landing', 'landed_kg');
    E.sort(function (a, b) { return a.t - b.t; });
    return E;
  }
  // UTC string -> TDB s past J2000 with the chain's fixed TDB - UTC = 69.184 s (Aster's utc-to-tdb.ts value for this span)
  function utcToTdb(u) { var ms = Date.parse(u); return num(ms) ? (ms - Date.UTC(2000, 0, 1, 12, 0, 0)) / 1000 + 69.184 : null; }
  function tdbToUtc(t) { return new Date(Date.UTC(2000, 0, 1, 12, 0, 0) + (t - 69.184) * 1000).toISOString(); }

  /** The delta-v budget, burn by burn: {label, dv_m_s, payer, n, flown (false when the link says it did not happen), source}. */
  function deltaV(rec) {
    var B = [], l;
    function add(label, dv, payer, n, key, flown, note) { if (num(dv)) B.push({ label: label, dv_m_s: dv, payer: payer, n: n, source: sourceOf(n, key), flown: flown !== false, note: note || null }); }
    if ((l = L(rec, 36))) {
      var gain = l.v.dv_flown_m_s - l.v.loss_gravity_m_s - l.v.loss_steering_m_s - l.v.loss_drag_m_s - l.v.loss_back_pressure_m_s;
      add('Ascent: speed gained', gain, 'rocket', 36, 'dv_flown_m_s', true, 'idea 36\'s guided ascent to Aster\'s parking orbit, less its losses');
      add('Ascent: gravity loss', l.v.loss_gravity_m_s, 'rocket', 36, 'loss_gravity_m_s');
      add('Ascent: steering loss', l.v.loss_steering_m_s, 'rocket', 36, 'loss_steering_m_s');
      add('Ascent: drag and back pressure', l.v.loss_drag_m_s + l.v.loss_back_pressure_m_s, 'rocket', 36, 'loss_drag_m_s');
    }
    if ((l = L(rec, 38))) add('Earth departure (finite burn)', l.v.burn_dv_m_s, 'rocket', 38, 'burn_dv_m_s', departed(rec), departed(rec) ? null : 'needed, not flown: the stage runs dry ' + fmt(l.v.prop_short_kg, 4) + ' kg short');
    if ((l = L(rec, 42))) {
      add('Cruise corrections (99 %)', l.v.tcm_dv_m_s, 'spacecraft', 42, 'tcm_dv_m_s');
      add('Arrival braking', l.v.appr_dv_m_s, 'spacecraft', 42, 'appr_dv_m_s');
      add('Holding station', l.v.stay_dv_m_s, 'spacecraft', 42, 'stay_dv_m_s');
    }
    if ((l = L(rec, 44))) add('Touch and go', l.v.prop_dv_m_s, 'spacecraft', 44, 'prop_dv_m_s', !(l.v.prop_need_kg > l.v.prop_avail_kg), l.v.prop_need_kg > l.v.prop_avail_kg ? 'needs ' + fmt(l.v.prop_need_kg, 3) + ' kg, ' + fmt(l.v.prop_avail_kg, 3) + ' kg left' : null);
    if ((l = L(rec, 47))) { add('Leaving the asteroid', l.v.dv_used_m_s, 'return', 47, 'dv_used_m_s', true, 'with idea 47\'s margin and correction'); if (l.v.dv_brake_m_s > 0) add('Braking for entry', l.v.dv_brake_m_s, 'return', 47, 'dv_brake_m_s'); }
    if ((l = L(rec, 48))) { if (l.v.retarget_needed) add('Re-aim for entry', l.v.retarget_dv_m_s, 'return', 48, 'retarget_dv_m_s', !(l.v.retarget_prop_kg > (l.v.prop_avail_kg || 0)), l.v.retarget_prop_kg > (l.v.prop_avail_kg || 0) ? 'needs ' + fmt(l.v.retarget_prop_kg, 3) + ' kg, none left' : null); }
    return B;
  }

  /** Where a link starts from something other than what the previous link ended with. severity: breaks | gap | note. */
  function seams(rec) {
    var S = [], a, b;
    function add(id, sev, between, what, x, y, units, help) { S.push({ id: id, severity: sev, between: between, what: what, a: x, b: y, jump: num(x) && num(y) ? y - x : null, units: units, what_would_help: help }); }
    var l34 = L(rec, 34), l36 = L(rec, 36), l37 = L(rec, 37), l38 = L(rec, 38), l39 = L(rec, 39), l40 = L(rec, 40), l41 = L(rec, 41), l42 = L(rec, 42), l44 = L(rec, 44), l45 = L(rec, 45), l46 = L(rec, 46), l47 = L(rec, 47), l48 = L(rec, 48), l49 = L(rec, 49);
    if (l38 && l42) {
      var carried = num(l38.v.payload_setting_kg) ? l38.v.payload_setting_kg : l38.v.cap_handed_kg;
      if (num(carried) && Math.abs(carried - l42.v.launch_kg) > 0.5) add('payload', 'gap', [38, 42], 'The rocket departs with ' + fmt(carried, 5) + ' kg of payload; the spacecraft idea 42 sizes for this arrival weighs ' + fmt(l42.v.launch_kg, 5) + ' kg at launch.', carried, l42.v.launch_kg, 'kg', 'Pick a rocket that carries the spacecraft (the closed loop: chain-sc or as512-sc).');
    }
    if (l38 && l34 && num(l38.v.payload_setting_kg) && Math.abs(l38.v.payload_setting_kg - l34.v.payload_kg) > 0.5) add('payload_swap', 'note', [34, 38], 'Idea 38 departs with ' + fmt(l38.v.payload_setting_kg, 5) + ' kg in place of the ' + fmt(l34.v.payload_kg, 5) + ' kg the ascent carried (its payload setting): the ascent is not re-flown, so the propellant left in orbit is a lower bound.', l34.v.payload_kg, l38.v.payload_setting_kg, 'kg', 'Nothing for the verdict (a lighter ascent leaves more propellant); idea 35 with this payload would tighten the margin.');
    if (l38 && !departed(rec)) add('departure', 'breaks', [38, 39], 'The departure stage runs dry ' + fmt(l38.v.prop_short_kg, 5) + ' kg of propellant short of the burn (' + fmt(l38.v.prop_need_kg, 5) + ' kg needed, ' + fmt(l38.v.prop_avail_kg, 5) + ' kg left in orbit). Everything from idea 39 on flies a departure that did not happen.', l38.v.prop_avail_kg, l38.v.prop_need_kg, 'kg', 'A bigger upper stage, a lighter payload, or a rocket with the capability (the launcher chart).');
    if (l36 && l37 && Math.abs(l36.v.ins_kg - l37.v.ins_kg) > 1) add('ascent_refly', 'note', [36, 37], 'Idea 36 flies to a ' + fmt(l36.v.incl_deg, 3) + '° parking orbit; idea 37 re-flies the ascent on the window\'s ' + fmt(l37.v.az_deg, 3) + '° azimuth (' + fmt(l37.v.incl_deg, 3) + '°) and reaches orbit with a different mass.', l36.v.ins_kg, l37.v.ins_kg, 'kg', 'Nothing: idea 37 is the one that lines the orbit up with the asymptote; the mass it reaches is the one carried.');
    if (l40 && (l38 || l37)) {
      var tPlan = l38 && departed(rec) ? l38.v.hds_tdb : l37 ? l37.v.dep_tdb : null;
      if (num(tPlan) && num(l40.v.dep_tdb) && Math.abs(l40.v.dep_tdb - tPlan) > 60) add('departure_epoch', departed(rec) ? 'note' : 'gap', [departed(rec) ? 38 : 37, 40], 'The cruise starts ' + fmt((l40.v.dep_tdb - tPlan) / 3600, 3) + ' h after the departure point the window put the burn at (idea 40 departs on idea 39\'s patched conic at Aster\'s cell time).', tPlan, l40.v.dep_tdb, 's', 'A departure that idea 38 flies, so idea 40 starts from its state.');
    }
    if (l39 && l40 && num(l39.v.vinf_arr_m_s) && num(l40.v.vinf_arr_m_s)) add('arrival_vinf', 'note', [39, 40], 'The arrival speed flown through the planets differs from the conic\'s.', l39.v.vinf_arr_m_s, l40.v.vinf_arr_m_s, 'm/s', 'Nothing: idea 40\'s flown arrival is the one idea 42 brakes from.');
    if (l42 && l44 && l44.v.prop_need_kg > l44.v.prop_avail_kg) add('tag_propellant', 'breaks', [42, 44], 'Idea 42 sizes the tanks for the approach and station-keeping only; the touch-and-go needs ' + fmt(l44.v.prop_need_kg, 3) + ' kg and ' + fmt(l44.v.prop_avail_kg, 3) + ' kg is left.', l44.v.prop_avail_kg, l44.v.prop_need_kg, 'kg', 'Size the tanks for the touch-and-go too (the what-if\'s toggle).');
    if (l42 && l46 && num(l46.v.coolers_kg) && l46.v.coolers_kg > 0) add('plant_mass', 'gap', [42, 46], 'Idea 46 adds ' + fmt(l46.v.coolers_kg, 4) + ' kg of coolers to the dry mass at the asteroid that the spacecraft idea 42 launched did not carry (and the electrolyser and tanks are refused, not weighed).', l42.v.dry_kg, l46.v.dry_total_kg, 'kg', 'Launch the plant: the what-if adds its mass to the outbound dry mass.');
    if (l45 && l47 && num(l47.v.material_kg)) add('container', 'gap', [45, 48], 'The ' + fmt(l47.v.material_kg, 5) + ' kg of material rides home with no container, structure or heat-shield mass booked: idea 48 calls the whole ' + fmt(l48 ? l48.v.entry_kg : NaN, 5) + ' kg an Apollo-derived capsule and refuses the heat-shield mass.', null, null, 'kg', 'A return vehicle design (capsule structure, heat shield, parachutes) in the dry mass; idea 49 gives the parachute area it would need.');
    if (l47 && l48 && Math.abs(l47.v.mass_arr_kg - l48.v.entry_kg) > 1e-6 * l48.v.entry_kg) add('entry_mass', 'breaks', [47, 48], 'The mass idea 47 brings to the Earth is not the mass idea 48 enters with.', l47.v.mass_arr_kg, l48.v.entry_kg, 'kg', 'Re-export idea 48 from idea 47\'s handoff.');
    if (l41 && l47 && l42) {
      var stayD = (l47.v.dep_tdb - l42.v.so_tdb) / DAY, retD = (l47.v.ea_tdb - l47.v.dep_tdb) / DAY;
      add('comms', 'gap', [41, 47], 'Idea 41 plans the link for ' + fmt(l41.v.cruise_days, 4) + ' days of cruise and a ' + fmt(l41.v.stay_days, 3) + '-day stay; the stay flown is ' + fmt(stayD, 3) + ' days and the ' + fmt(retD, 3) + '-day way home has no link budget at all.', l41.v.stay_days, stayD, 'days', 'Idea 41 run on the return leg (it reads a cruise from idea 40; idea 47\'s return is not in that form).');
    }
    if (l49 && l49.v.thickness_m == null) add('heat_shield', 'gap', [48, 49], 'No flown heat shield covers this entry (heat load ' + fmt(l49.v.heat_load_ratio, 3) + ' times Stardust\'s design); the thickness, and so the shield\'s mass, is refused.', null, null, '', 'PICA\'s thermal properties (export-controlled) or arc-jet tests at this heat load.');
    // refusals that do not travel on: from the identities recordOf()/walk() compared link by link (answered ones are not losses)
    (rec.flow || []).forEach(function (f) {
      if (f.dropped.length) add('refusals_dropped', 'gap', [f.n - 1, f.n], 'Idea ' + f.n + ' does not carry ' + f.dropped.length + ' refusal' + (f.dropped.length > 1 ? 's' : '') + ' raised before it (' + f.dropped.slice(0, 4).join(', ') + (f.dropped.length > 4 ? ', ...' : '') + '), and no module answers ' + (f.dropped.length > 1 ? 'them' : 'it') + ': ' + (f.dropped.length > 1 ? 'they never reach' : 'it never reaches') + ' the end of the chain.', null, f.dropped.length, 'refusals', 'Build idea ' + f.n + '\'s handoff from idea ' + (f.n - 1) + '\'s, so every refusal travels.');
    });
    return S;
  }
  // refusal codes (applies_to) that stop the mission itself, not only a number's confidence
  var BLOCKING = { departure_propellant: 1, chain_departure: 1, payload_capability: 1, tankage: 1, parachute_sequence: 1, return: 1, landing: 1 };
  function refusalsOf(rec) {
    var out = [], seen = {}, ans = {};
    (rec.flow || []).forEach(function (f) { f.answered.forEach(function (id) { ans[id] = f.n; }); });
    Object.keys(rec.links).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      rec.links[n].own.forEach(function (r) {
        var k = n + '|' + r.code + '|' + (r.applies_to || '') + '|' + r.reason; if (seen[k]) return; seen[k] = 1;
        var by = ans[FROM[n] + ':' + (r.applies_to || r.code)];
        out.push(Object.assign({ from: FROM[n], n: n, phase: PHASE(n), blocking: !by && !!BLOCKING[r.applies_to], answered_by: by || null }, r));
      });
    });
    if (rec.halt) out.push(Object.assign({ from: FROM[rec.halt.at], n: rec.halt.at, phase: PHASE(rec.halt.at), blocking: true, halt: true }, rec.halt.refusal));
    return out;
  }

  function mission(rec) {
    var E = events(rec), D = deltaV(rec), S = seams(rec), R = refusalsOf(rec), l;
    // launch to landing (the asteroid's own Earth pass can come after the capsule is down: Apophis's does, by 4 minutes)
    var t0 = L(rec, 37) ? L(rec, 37).v.launch_tdb : E.length ? E[0].t : null, tEnd = L(rec, 49) ? L(rec, 49).v.land_tdb : E.length ? E[E.length - 1].t : null;
    var durations = {};
    if ((l = L(rec, 37)) && L(rec, 40)) durations.launch_to_cruise_s = L(rec, 40).v.dep_tdb - l.v.launch_tdb;
    if (L(rec, 40)) durations.cruise_s = L(rec, 40).v.arr_tdb - L(rec, 40).v.dep_tdb;
    if (L(rec, 42) && L(rec, 47)) durations.stay_s = L(rec, 47).v.dep_tdb - L(rec, 42).v.so_tdb;
    if (L(rec, 47)) durations.return_s = L(rec, 47).v.ea_tdb - L(rec, 47).v.dep_tdb;
    if (num(t0) && num(tEnd)) durations.total_s = tEnd - t0;
    var lands = !!L(rec, 49) && !rec.halt, breaks = S.filter(function (s) { return s.severity === 'breaks'; });
    var blockers = breaks.map(function (s) { return { id: s.id, between: s.between, what: s.what }; });
    if (rec.halt) blockers.unshift({ id: 'halt', between: [rec.halt.at], what: 'The chain stops at idea ' + rec.halt.at + ' (' + TITLE[rec.halt.at] + '): ' + rec.halt.refusal.reason });
    var closes = lands && blockers.length === 0;
    var summary = rec.halt ? 'Stops at idea ' + rec.halt.at + ' (' + TITLE[rec.halt.at] + ').'
      : closes ? 'Closes: every link runs on what the one before it handed on.'
      : 'Lands on paper, but does not close: ' + blockers.map(function (b) { return b.id.replace(/_/g, ' '); }).join(', ') + '.';
    var l47 = L(rec, 47), l49 = L(rec, 49), l42 = L(rec, 42), l34 = L(rec, 34);
    return { record: rec, choice: rec.choice, key: rec.key, events: E, deltaV: D, seams: S, refusals: R, durations: durations,
      verdict: { closes: closes, lands: lands, halted_at: rec.halt ? rec.halt.at : null, blockers: blockers, summary: summary },
      headline: { liftoff_kg: l34 ? l34.v.liftoff_kg : null, spacecraft_launch_kg: l42 ? l42.v.launch_kg : null, material_home_kg: l47 ? l47.v.material_kg : null,
        landed_kg: l49 ? l49.v.landed_kg : null, launch_utc: L(rec, 37) ? L(rec, 37).v.launch_utc : null, landing_utc: l49 ? l49.v.land_utc : null, target: L(rec, 39) ? L(rec, 39).v.name : null } };
  }

  // ================================================================== Aster's launch-vehicle curves (transcribed; Aster's golden pins checked)
  var BEYOND_CURVE = { kind: 'beyond-curve' }, NON_FINITE_C3 = { kind: 'non-finite-c3' };
  /** Aster src/v2/porkchop/launch-vehicles.ts payloadAtC3, line for line: exact at an anchor, linear between, BEYOND_CURVE outside. c3 in km^2/s^2. */
  function payloadAtC3(vehicle, c3) {
    if (!isFinite(c3)) return NON_FINITE_C3;
    var curve = vehicle.curve, first = curve[0], last = curve[curve.length - 1];
    if (!first || !last || c3 < first[0] || c3 > last[0]) return BEYOND_CURVE;
    for (var i = 0; i < curve.length; i++) if (c3 === curve[i][0]) return curve[i][1];
    for (var j = 0; j < curve.length - 1; j++) {
      var left = curve[j], right = curve[j + 1];
      if (left[0] < c3 && c3 < right[0]) { var t = (c3 - left[0]) / (right[0] - left[0]); return left[1] + t * (right[1] - left[1]); }
    }
    return BEYOND_CURVE;
  }
  /** Aster src/v2/porkchop/delta-v.ts injectionDvFromC3 (km, km/s): perigee speed on the hyperbola less circular speed. */
  function injectionDvFromC3(c3Km2PerS2, muKm3PerS2, parkingRadiusKm) {
    var circular = Math.sqrt(muKm3PerS2 / parkingRadiusKm), hyper = Math.sqrt(c3Km2PerS2 + (2 * muKm3PerS2) / parkingRadiusKm);
    return hyper - circular;
  }

  // ================================================================== what depends on data: the closure, the launchers, NHATS
  function create(deps) {
    deps = deps || {};
    var A = deps.aster, LED = deps.ledger47, ISA = deps.isa, NH = deps.nhats;

    function launchers(c3_m2_s2) {
      if (!A) return [];
      var c3 = c3_m2_s2 / 1e6;
      return A.elvperf.vehicles.map(function (v, i) {
        var p = payloadAtC3(v, c3);
        return { i: i, name: v.name + ' ' + v.config, site: v.site, payload_kg: typeof p === 'number' ? p : null, beyond: p === BEYOND_CURVE, c3_range: [v.curve[0][0], v.curve[v.curve.length - 1][0]],
          source: 'Aster ' + A.elvperf.file + ' (' + A.elvperf.source + ', as of ' + A.elvperf.as_of + '), line ' + v.line };
      });
    }

    /**
     * The what-if: the chain's own mass budgets re-run on a spacecraft you choose, every other link held.
     * opts: {dry_kg, plant (launch idea 46's coolers from Earth), tag (size the tanks for the touch-and-go too),
     *        launcher: 'flown' | index into Aster's curves, touchdown_m_s, material_kg ('max' or kg)}.
     */
    function closure(mis, opts) {
      var rec = mis.record, o = Object.assign({ dry_kg: null, plant: false, tag: false, launcher: 'flown', touchdown_m_s: null, material_kg: 'max' }, opts || {});
      var out = { refusals: [], assumptions: [] }, l38 = L(rec, 38), l39 = L(rec, 39), l42 = L(rec, 42), l44 = L(rec, 44), l46 = L(rec, 46), l47 = L(rec, 47), l48 = L(rec, 48), l49 = L(rec, 49);
      if (!l42) { out.refusals.push(refusal('insufficient_data', 'No idea 42 in this chain: there is no spacecraft to size.', 'A chain that reaches idea 42 (Closing In).', { applies_to: 'spacecraft' })); return out; }
      var dry = o.dry_kg == null ? l42.v.dry_kg : o.dry_kg;
      if (!(num(dry) && dry >= 10 && dry <= 50000)) { out.refusals.push(refusal('invalid_input', 'The spacecraft\'s dry mass must be 10 to 50,000 kg.', 'A dry mass in that range (idea 42\'s NEAR-class 487 kg by default).', { applies_to: 'dry_kg' })); return out; }
      var plant = o.plant && l46 && num(l46.v.coolers_kg) ? l46.v.coolers_kg : 0;
      // ---- outbound: idea 42's sizing, needDv = TCMs + approach burns + station-keeping, at its Isp; held: those delta-v
      var ve = l42.v.isp_s * G0, need = l42.v.required_dv_m_s, tagDv = l44 && num(l44.v.prop_dv_m_s) ? l44.v.prop_dv_m_s : 0;
      if (o.tag) need += tagDv;
      var dryOut = dry + plant, prop = dryOut * (Math.exp(need / ve) - 1), launch = dryOut + prop;
      var mArr = launch * Math.exp(-l42.v.tcm_dv_m_s / ve), mSo = mArr * Math.exp(-l42.v.appr_dv_m_s / ve), mStay = mSo * Math.exp(-l42.v.stay_dv_m_s / ve);
      // the touch-and-go as idea 44 sizes it: on the stand-off mass, from what the approach left (station-keeping comes after)
      var tagNeed = tagDv > 0 ? mSo * (1 - Math.exp(-tagDv / ve)) : 0, left = mSo - dryOut;
      out.outbound = { dry_kg: dry, plant_kg: plant, isp_s: l42.v.isp_s, need_dv_m_s: need, propellant_kg: prop, launch_kg: launch, arrival_kg: mArr, standoff_kg: mSo, end_of_stay_kg: mStay,
        tag_need_kg: tagNeed, tag_left_kg: left, tag_ok: left >= tagNeed - 1e-9 };
      if (!out.outbound.tag_ok) out.refusals.push(refusal('out_of_envelope', 'The touch-and-go needs ' + fmt(tagNeed, 3) + ' kg of propellant and ' + fmt(left, 3) + ' kg is left after the approach (idea 42 sizes the tanks without it).', 'Size the tanks for the touch-and-go too.', { applies_to: 'tag_propellant' }));
      // ---- the launch: what can send `launch` kg to this C3
      var c3 = l39 ? l39.v.c3_m2_s2 : null, cap = null, capFrom = null;
      if (o.launcher === 'flown') {
        if (!l38) out.refusals.push(refusal('insufficient_data', 'No idea 38 in this chain: nothing says what the rocket can send.', 'A chain with idea 38 (Burn Out).', { applies_to: 'launcher' }));
        else if (num(l38.v.cap_finite_kg)) { cap = l38.v.cap_finite_kg; capFrom = sourceOf(38, 'cap_finite_kg') + ' (a lower bound: idea 38 holds the ascent and lightens only the payload)'; }
        else out.refusals.push(refusal('out_of_envelope', 'This rocket cannot reach the C3 even with no payload: its departure stage runs dry ' + fmt(l38.v.prop_short_kg, 5) + ' kg short with the payload it carried, and idea 38 finds no payload that works.', 'A bigger rocket: pick one of Aster\'s launch-vehicle curves.', { applies_to: 'launcher' }));
      } else if (A && A.elvperf.vehicles[o.launcher]) {
        var V0 = A.elvperf.vehicles[o.launcher], p = num(c3) ? payloadAtC3(V0, c3 / 1e6) : NON_FINITE_C3;
        if (typeof p === 'number') { cap = p; capFrom = 'Aster ' + A.elvperf.file + ' payloadAtC3(' + V0.name + ' ' + V0.config + ', ' + fmt(c3 / 1e6, 4) + ' km²/s²), ' + A.elvperf.source + ' as of ' + A.elvperf.as_of; }
        else out.refusals.push(refusal('out_of_envelope', V0.name + ' ' + V0.config + '\'s published curve runs from C3 ' + V0.curve[0][0] + ' to ' + V0.curve[V0.curve.length - 1][0] + ' km²/s²; this mission needs ' + fmt(c3 / 1e6, 4) + ' km²/s², off the curve (Aster interpolates only between anchors).', 'Another vehicle, or a transfer with a C3 on its curve.', { applies_to: 'launcher' }));
        if (l39 && l39.v.band && l39.v.band !== 'GREEN') out.assumptions.push('Aster screens this asymptote ' + l39.v.band + ' from the Cape (DLA ' + fmt(l39.v.dla_deg, 4) + '°): the curve is for the vehicle\'s best plane, and Aster adds no dogleg delta-v.');
      } else out.refusals.push(refusal('invalid_input', 'Unknown launcher.', '"flown" or one of Aster\'s curves.', { applies_to: 'launcher' }));
      out.launch = { c3_m2_s2: c3, capability_kg: cap, capability_from: capFrom, margin_kg: num(cap) ? cap - launch : null, closes: num(cap) && cap >= launch };
      // ---- the way home: idea 47's ledger (verbatim) with the dry mass changed by the spacecraft's change; burns and windows held
      if (l46 && l47 && LED && num(l46.v.prop_kg)) {
        // the chain's convention: ideas 44 to 46 carry the stand-off mass (dry + what the approach left); idea 46 adds its coolers,
        // which are already in the dry mass when the plant is launched from the Earth
        var craft = out.outbound.standoff_kg, dryRet = craft + (plant ? 0 : l46.v.coolers_kg);
        var B = { fuel: l46.v.fuel_kg, ox: l46.v.ox_kg, of: l46.v.of, species: num(l46.v.of), ve: l46.v.ve_m_s, isp: l46.v.isp_s, dry: dryRet,
          rf: l47.v.boil_applied ? l47.v.boil_fuel_kg_day : 0, ro: l47.v.boil_applied ? l47.v.boil_ox_kg_day : 0, cap: l47.v.material_avail_kg };
        var waitS = l47.v.wait_days * DAY, tofS = l47.v.tof_s, burns = { dv1: l47.v.dv_used_m_s, dv2: l47.v.dv_brake_m_s };
        var mMax = LED.materialMax(B, waitS, tofS, burns), avail = num(B.cap) ? B.cap : Infinity;
        var want = o.material_kg === 'max' ? Math.min(mMax, avail) : Math.min(+o.material_kg, mMax, avail);
        if (!(mMax >= 0)) out.refusals.push(refusal('out_of_envelope', 'With a ' + fmt(dryRet, 5) + ' kg craft the ' + fmt(B.fuel + B.ox, 4) + ' kg of propellant made cannot even take it home empty on idea 47\'s window.', 'A lighter craft, or more propellant (idea 46: more arrays or a longer stay).', { applies_to: 'return' }));
        var Lg = mMax >= 0 ? LED.ledger(B, waitS, tofS, burns, Math.max(0, want)) : null;
        out.home = { dry_kg: dryRet, material_max_kg: mMax, material_kg: mMax >= 0 ? Math.max(0, want) : null, limited_by: mMax > avail ? 'material' : 'propellant',
          mass_departure_kg: Lg ? Lg.mass_departure_kg : null, mass_arrival_kg: Lg ? Lg.mass_arrival_kg : null, capacity_m_s: LED.capacity(B, waitS) };
        out.assumptions.push('The water made (idea 45) and so the propellant (idea 46) are held: the dig was limited by its oven, not by the spacecraft\'s weight, on the chain; a different mass could change that.');
      } else out.refusals.push(refusal('insufficient_data', 'No idea 46 and 47 in this chain (or no propellant made): there is no way home to size.', 'A chain that reaches idea 47 (Way Home).', { applies_to: 'return' }));
      // ---- entry and the main parachute: idea 49's ablation held, its main sized 2 m g0 / (rho(ground) v^2) at the ground
      if (out.home && num(out.home.mass_arrival_kg) && l49 && ISA) {
        var entry = out.home.mass_arrival_kg, landed = entry - l49.v.ablated_kg, vtd = o.touchdown_m_s == null ? l49.v.touchdown_set_m_s : o.touchdown_m_s;
        if (!(num(vtd) && vtd >= 1 && vtd <= 30)) out.refusals.push(refusal('invalid_input', 'The touchdown speed must be 1 to 30 m/s.', 'Idea 49\'s 4.5 m/s (OSIRIS-REx\'s).', { applies_to: 'touchdown' }));
        else {
          var rho = ISA.isa(l49.v.ground_alt_m || 0).rho_kg_m3, cds = 2 * landed * G0 / (rho * vtd * vtd), src1 = l49.v.main_cds_m2 / l49.v.main_equiv;
          out.entry = { entry_kg: entry, ablated_kg: l49.v.ablated_kg, landed_kg: landed, touchdown_m_s: vtd, main_cds_m2: cds, main_equiv: cds / src1, main_d_m: num(l49.v.main_d_m) ? l49.v.main_d_m * Math.sqrt(cds / l49.v.main_cds_m2) : null };
          out.assumptions.push('Idea 49\'s ablation (' + fmt(l49.v.ablated_kg, 4) + ' kg) is held: a heavier capsule flies a different entry.');
        }
      }
      if (l48 && l48.v.choice !== 'direct' && l48.v.choice !== 'skip') out.assumptions.push('Idea 48 chose ' + l48.v.choice + '; the entry mass here is idea 47\'s arrival mass.');
      out.closes = !!(out.launch.closes && out.outbound.tag_ok && out.home && out.home.material_kg != null && out.entry);
      return out;
    }

    /** NHATS's total, term by term, from a chain's legs: {c3_m2_s2, vinf_arr_neo_m_s, dv_dep_neo_m_s, vinf_ret_m_s}. */
    function roundTrip(legs) {
      if (!A || !NH) return null;
      var rp = A.earth_radius_m / 1000 + NH.parking_altitude_km, dep = injectionDvFromC3(legs.c3_m2_s2 / 1e6, A.earth_mu_km3_s2, rp) * 1000;
      var vmax = Math.sqrt(Math.max(0, 12000 * 12000 - 2 * A.earth_mu_km3_s2 * 1e9 / (A.earth_radius_m + 125000)));
      var brake = Math.max(0, legs.vinf_ret_m_s - vmax), entry = Math.sqrt(Math.pow(Math.min(legs.vinf_ret_m_s, vmax), 2) + 2 * A.earth_mu_km3_s2 * 1e9 / (A.earth_radius_m + 125000));
      return { dv_dep_park_m_s: dep, vrel_arr_neo_m_s: legs.vinf_arr_neo_m_s, vrel_dep_neo_m_s: legs.dv_dep_neo_m_s, vrel_arr_earth_m_s: brake, v_arr_earth_m_s: entry,
        dv_total_m_s: dep + legs.vinf_arr_neo_m_s + legs.dv_dep_neo_m_s + brake };
    }
    function nhatsRows() {
      if (!NH) return [];
      return NH.rows.map(function (r) { var o = {}; NH.columns.forEach(function (c, i) { o[c] = r[i]; }); return o; });
    }
    /** Fixture rows (the chain's legs on NHATS's cells) beside NHATS's own numbers. */
    function nhatsCompare(fixture) {
      var by = {}; nhatsRows().forEach(function (r) { by[r.tid] = r; });
      return (fixture && fixture.rows || []).map(function (f) {
        var n = by[f.tid]; if (!n || !f.legs) return null;
        var rt = roundTrip(f.legs);
        return { des: n.des, tid: n.tid, kind: n.kind, launch: n.launch, out_d: n.dur_out, stay_d: n.dur_at, ret_d: n.dur_ret, chain: rt, nhats: { dv_dep_park_m_s: n.dv_dep_park * 1000, vrel_arr_neo_m_s: n.vrel_arr_neo * 1000,
          vrel_dep_neo_m_s: n.vrel_dep_neo * 1000, vrel_arr_earth_m_s: n.vrel_arr_earth * 1000, v_arr_earth_m_s: n.v_arr_earth * 1000, dv_total_m_s: n.dv_total * 1000, c3_m2_s2: n.c3 * 1e6 },
          c3_chain_m2_s2: f.legs.c3_m2_s2, gap_total_m_s: rt.dv_total_m_s - n.dv_total * 1000, outside_39: f.outside_39 || null };
      }).filter(Boolean);
    }
    /** The comparison's summary: inside idea 39's envelope (no Earth encounter before arrival) and outside it. */
    function nhatsStats(rows) {
      function st(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length; return { n: m, median: m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2, max: s[m - 1] }; }
      var inn = rows.filter(function (r) { return !r.outside_39; }), out = rows.filter(function (r) { return r.outside_39; });
      var abs = function (k) { return function (r) { return Math.abs(r.chain[k] - r.nhats[k]); }; };
      return { inside: { total: st(inn.map(function (r) { return Math.abs(r.gap_total_m_s); })), rel: st(inn.map(function (r) { return Math.abs(r.gap_total_m_s) / r.nhats.dv_total_m_s; })),
          dep: st(inn.map(abs('dv_dep_park_m_s'))), arr: st(inn.map(abs('vrel_arr_neo_m_s'))), back: st(inn.map(abs('vrel_dep_neo_m_s'))), brake: st(inn.map(abs('vrel_arr_earth_m_s'))) },
        outside: { total: st(out.map(function (r) { return Math.abs(r.gap_total_m_s); })), bodies: out.map(function (r) { return r.des; }).filter(function (d, i, a) { return a.indexOf(d) === i; }) } };
    }
    return { launchers: launchers, closure: closure, roundTrip: roundTrip, nhatsRows: nhatsRows, nhatsCompare: nhatsCompare, nhatsStats: nhatsStats };
  }

  // ================================================================== reading handoffs a person brings
  function b64urlEncode(s) {
    var b = typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    var b = s.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    return typeof Buffer !== 'undefined' ? Buffer.from(b, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b)));
  }
  /**
   * Walk a handoff down its inputs: every link carried whole is read; a link pruned to a digest is looked up in `known`
   * ({sha256: link record}, the committed chain's), and its own upstream continues from `knownChain` (the committed
   * links by number) only when that is the committed chain. Returns {links: {n: extract}, missing: [n], pruned: [...]}.
   */
  function walk(h, sha256, known, knownChain) {
    var links = {}, missing = [], pruned = [], cur = h, guard = 0, hs = {};
    while (cur && guard++ < 30) {
      var n = +String(cur.from).slice(0, 2);
      if (!EXTRACT[n]) break;
      var e = extract(cur), s = JSON.stringify(cur); e.sha256 = sha256 ? sha256(s) : null; e.bytes = s.length; links[n] = e; hs[n] = cur;
      var key = UPSTREAM[n], up = key ? dig(cur.inputs, key) : null;
      if (n === 34) { var eng = cur.inputs && cur.inputs.engines; up = null; for (var k in eng || {}) if (eng[k] && eng[k].engine_handoff) up = eng[k].engine_handoff; }
      if (n === 31 || (!up && n !== 34)) break;
      if (!up) { if (n === 34) break; }
      if (up && up.pruned) {
        pruned.push({ n: n - 1, sha256: up.sha256, bytes: up.bytes });
        var hit = known && known[up.sha256];
        if (hit) { links[n - 1] = clone(hit); var m = n - 2; while (m >= 31 && knownChain && knownChain[m]) { links[m] = clone(knownChain[m]); m--; } }
        else missing.push(n - 1);
        break;
      }
      cur = up;
    }
    for (var q = 31; q <= 49; q++) if (!links[q] && Object.keys(links).length && q < Math.max.apply(null, Object.keys(links).map(Number)) && missing.indexOf(q) < 0 && q > Math.min.apply(null, Object.keys(links).map(Number))) missing.push(q);
    return { links: links, missing: missing.sort(function (a, b) { return a - b; }), pruned: pruned, flow: refusalFlow(hs) };
  }

  // ================================================================== this module's handoff
  function makeHandoff(mis0, extra) {
    extra = extra || {};
    // the record travels packed (numbers to 10 figures); the outputs are made from that same record, so a read-back
    // re-derives them exactly
    var packed = packRecords([mis0.record]), rec = unpack(packed, packed.runs[0].key), mis = mission(rec), cl = extra.closure || null;
    var q = function (value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; };
    var O = {
      verdict: q(mis.verdict, '', 'derived', 'mission.js mission(): halts, seams of severity "breaks", and whether idea 49 landed'),
      timeline: q(mis.events.map(function (e) { return { event: e.label, tdb_s_past_j2000: e.t, utc: e.utc || tdbToUtc(e.t), from: FROM[e.n] }; }), 's (TDB past J2000); UTC', 'derived', 'each module\'s epochs, sorted (mission.js events())'),
      mass_ledger: q(mis.events.filter(function (e) { return num(e.mass_kg); }).map(function (e) { return { event: e.label, mass_kg: e.mass_kg, from: e.mass_from }; }), 'kg', 'derived', 'each module\'s masses at its events'),
      delta_v_budget: q(mis.deltaV.map(function (d) { return { burn: d.label, dv_m_s: d.dv_m_s, payer: d.payer, flown: d.flown, from: d.source, note: d.note }; }), 'm/s', 'derived', 'each module\'s delta-v (mission.js deltaV())'),
      durations: q(mis.durations, 's', 'derived', 'differences of the timeline\'s TDB epochs'),
      seams: q(mis.seams, 'kg, s, m/s, days, refusals (per seam)', 'derived', 'mission.js seams(): where a link starts from something other than what the previous one ended with'),
      links: q(Object.keys(rec.links).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { var l = rec.links[n]; return { n: n, from: l.from, produced: l.produced, sha256: l.sha256, bytes: l.bytes, own_refusals: l.own.length, carried_refusals: l.carried }; }), '', 'measured', 'the handoffs read'),
    };
    if (cl) O.closure = q(cl, 'kg, m/s, m^2, m^2/s^2', 'derived', 'mission.js closure(): idea 42\'s sizing, idea 47\'s ledger (verbatim), idea 49\'s main parachute, on the dry mass and launcher chosen; everything else held');
    var refs = mis.refusals.map(function (r) { var x = clone(r); delete x.n; delete x.phase; delete x.blocking; delete x.halt; if (!x.answered_by) delete x.answered_by; else x.answered_by = FROM[x.answered_by]; return x; });
    if (!mis.verdict.closes) refs.push(refusal('out_of_envelope', 'The mission does not close: ' + mis.verdict.blockers.map(function (b) { return b.what; }).join(' '), 'The what-if on this page, or the modules the blockers name.', { applies_to: 'mission', from: '50-the-long-way-round' }));
    return { handoff: 'long-way-round', version: 1, from: '50-the-long-way-round', produced: extra.produced || new Date().toISOString(),
      inputs: { choice: clone(rec.choice), source: extra.source || 'bundled', what_if: extra.whatIf || null, record: packed },
      outputs: O, refusals: refs,
      assumptions: ['Every number is the module\'s that owns it, read from its handoff (the source of each is given); this module adds the order, the sums, the seams and the what-if.',
        'Times are TDB seconds past J2000 with TDB - UTC = 69.184 s (Aster\'s offset for this span), as every module uses.',
        'The what-if holds every link except the spacecraft mass it changes: windows, delta-v, water, propellant made and the entry are the chain\'s.'] };
  }
  /** Read a handoff back: this module's own (re-derived from its record and compared), or any of ideas 31 to 49 (walked). */
  function parseHandoff(input, ctx) {
    ctx = ctx || {};
    var h = input;
    if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A Long Way Round handoff (any of ideas 31 to 50).') }; } }
    if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff exported by any of ideas 31 to 50.') };
    if (h.version !== 1) return { refusal: refusal('invalid_input', 'Version ' + h.version + ' is not one this page reads (version 1).', 'A version 1 handoff.') };
    if (h.from === '50-the-long-way-round') {
      var pk = h.inputs && h.inputs.record, rec = pk && pk.version === 2 && pk.runs && pk.runs.length === 1 ? unpack(pk, pk.runs[0].key) : null;
      if (!rec || !rec.links) return { refusal: refusal('invalid_input', 'This handoff carries no mission record.', 'The unedited handoff this page exported.') };
      var mis = mission(rec), again = makeHandoff(mis, { produced: h.produced, source: h.inputs.source, whatIf: h.inputs.what_if, closure: h.outputs.closure ? h.outputs.closure.value : null });
      var keys = ['verdict', 'timeline', 'mass_ledger', 'delta_v_budget', 'durations', 'seams'];
      for (var i = 0; i < keys.length; i++) if (JSON.stringify(again.outputs[keys[i]]) !== JSON.stringify(h.outputs[keys[i]])) return { refusal: refusal('invalid_input', 'Its ' + keys[i] + ' is not what its own record gives: it was edited.', 'The unedited handoff this page exported.') };
      if (JSON.stringify(again.refusals.map(function (r) { return r.code + (r.applies_to || ''); })) !== JSON.stringify((h.refusals || []).map(function (r) { return r.code + (r.applies_to || ''); }))) return { refusal: refusal('invalid_input', 'Its refusals are not what its own record gives: one was dropped or added.', 'The unedited handoff this page exported.') };
      return { mission: mis, own: true, whatIf: h.inputs.what_if };
    }
    var n = +String(h.from).slice(0, 2);
    if (!EXTRACT[n]) return { refusal: refusal('invalid_input', 'A handoff from ' + h.from + ' is not one of the chain\'s (ideas 31 to 50).', 'A handoff exported by any of ideas 31 to 50.') };
    if (!h.outputs || !Array.isArray(h.refusals)) return { refusal: refusal('invalid_input', 'This handoff has no outputs or refusals.', 'The unedited handoff that module exported.') };
    var w = walk(h, ctx.sha256, ctx.known, ctx.knownChain);
    var rec2 = { choice: { rocket: 'imported', propellant: null, asteroid: null }, key: 'imported', halt: null, loop: [], notes: ['Imported: idea ' + n + '\'s handoff, walked down its inputs.'], links: w.links, flow: w.flow };
    return { mission: mission(rec2), walked: w };
  }

  // ================================================================== a text report (the CLI)
  function textReport(mis) {
    var lines = [], c = mis.choice;
    lines.push('THE LONG WAY ROUND: ' + (c.rocket || '') + (c.propellant ? ' / ' + c.propellant : '') + ' / ' + (mis.headline.target || c.asteroid || ''));
    lines.push('Verdict: ' + mis.verdict.summary);
    mis.verdict.blockers.forEach(function (b) { lines.push('  - ' + b.what); });
    lines.push('', 'Timeline and masses:');
    mis.events.filter(function (e) { return !e.minor; }).forEach(function (e) { lines.push('  ' + (e.utc || tdbToUtc(e.t)).slice(0, 19).replace('T', ' ') + '  ' + e.label + (num(e.mass_kg) ? '  ' + fmt(e.mass_kg, 6) + ' kg' : '') + '  [' + FROM[e.n] + ']'); });
    lines.push('', 'Delta-v budget:');
    var tot = 0; mis.deltaV.forEach(function (d) { tot += d.dv_m_s; lines.push('  ' + (d.label + ' ').padEnd(34, '.') + ' ' + fmt(d.dv_m_s, 5).padStart(8) + ' m/s  ' + d.payer + (d.flown ? '' : '  (not flown: ' + d.note + ')')); });
    lines.push('  ' + 'Total '.padEnd(34, '.') + ' ' + fmt(tot, 5).padStart(8) + ' m/s');
    lines.push('', 'Seams:'); mis.seams.forEach(function (s) { lines.push('  [' + s.severity + '] ' + s.between.join('->') + ' ' + s.what); });
    lines.push('', 'Refusals carried: ' + mis.refusals.length + ' (' + mis.refusals.filter(function (r) { return r.blocking; }).length + ' blocking)');
    return lines.join('\n');
  }

  return { FROM: FROM, TITLE: TITLE, EXTRACT: EXTRACT, ANSWERED: ANSWERED, refusalFlow: refusalFlow, UPSTREAM: UPSTREAM, BLOCKING: BLOCKING, G0: G0, extract: extract, sourceOf: sourceOf, recordOf: recordOf, keyOf: keyOf,
    packRecords: packRecords, unpack: unpack, events: events, deltaV: deltaV, seams: seams, refusalsOf: refusalsOf, mission: mission, utcToTdb: utcToTdb, tdbToUtc: tdbToUtc,
    payloadAtC3: payloadAtC3, injectionDvFromC3: injectionDvFromC3, BEYOND_CURVE: BEYOND_CURVE, create: create, walk: walk, makeHandoff: makeHandoff, parseHandoff: parseHandoff,
    textReport: textReport, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode, fmt: fmt };
});
