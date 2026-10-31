/* Max Q: a rocket's ascent through the atmosphere. Idea 35 of the Aster Idea Bank, module 5 of "The Long Way Round".
 *
 * Takes idea 34's vehicle (its handoff: stages, burns, events, idea 33's engines) and flies it from the pad over a
 * rotating, spherical Earth through the 1976 standard atmosphere, with drag from the Apollo/Saturn V wind-tunnel axial
 * force coefficient, thrust that falls with ambient pressure, a vertical rise, a pitch kick and a gravity turn, an
 * optional throttle bucket, staging coasts and the vehicle's own jettisons and engine cutoffs; it books where the ideal
 * delta-v went (gravity, drag, steering, back pressure) and hands on the burnout state and the orbit it is in.
 *
 * A pure kernel: no DOM, no network. Idea 34's ledger (snapshots/stack.js, unmodified) supplies the masses and checks
 * the imported vehicle; the physics new here:
 *
 *   frame      Earth-centred inertial (ECI) fixed at liftoff: z along Earth's spin axis, x through the launch site's
 *              meridian at liftoff, no epoch (the node in J2000 is module 37's). Earth: a sphere of Aster's equatorial
 *              radius, point-mass gravity mu/r^2 with Aster's GM, rotating at pck00010's rate.
 *   motion     r'' = -mu r/|r|^3 + (F u - D vrel_hat)/m, m' = -mdot, vrel = v - omega x r. RK4, fixed steps that land
 *              exactly on every event (jettison, cutoff, throttle change, burnout, steering phase).
 *   thrust     F = n [k F_vac(tau) - p_a A_e] (idea 32's linear CF(p_a), as idea 33's sea-level thrust is built; k the
 *              flow scale, which moves the chamber, not the nozzle's exit area),
 *              refused where p_a exceeds the nozzle's separation onset (idea 33's criterion).
 *   drag       D = q S C_A(M), q = rho |vrel|^2 / 2, S = pi d^2 / 4, M = |vrel| / a: Walker's forebody C_Af (Saturn V,
 *              Mach 0.5 to 7.8, held flat outside), or his power-off total C_AT as a bound. Above 86 km (the top of
 *              idea 02's 1976 atmosphere) density and pressure are taken as zero.
 *   steering   vertical to t_p, then the thrust tilts toward the launch azimuth by delta over dt_k and holds until the
 *              Earth-relative velocity has turned as far, then follows it (zero angle of attack: the gravity turn).
 *              Upper stages: the same gravity turn, or a fixed pitch above the local horizontal.
 *   losses     d|v|/dt = F_vac/m - p_a A_e/m - (-g . v_hat) - D (vrel_hat . v_hat)/m - F (1 - u . v_hat)/m exactly,
 *              so ideal delta-v = gain in inertial speed + gravity + back-pressure + drag + steering, integrated
 *              alongside the state and checked.
 *
 * Units: SI throughout (m, s, kg, N, Pa, rad inside; degrees only at the edges).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaxQ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEG = Math.PI / 180;

  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) { return num(v) ? +v.toPrecision(d || 4) + '' : String(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // small vector helpers on [x, y, z]
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; }
  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    var i = 1; while (xs[i] < x) i++;
    var f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + f * (ys[i] - ys[i - 1]);
  }

  function create(deps) {
    var S = deps.S, isa = deps.isa, g0 = deps.g0, EARTH = deps.earth, AERO = deps.aero, ENG34 = deps.engines34 || {};
    // the top of idea 02's isa() table, geometric (it clamps above), and its sea-level pressure, from the snapshot
    var ATM_TOP = deps.isaTop.R0 * deps.isaTop.HMAX / (deps.isaTop.R0 - deps.isaTop.HMAX), P0 = isa(0).P_Pa, ATM_KM = fmt(ATM_TOP / 1000, 3);
    var D512 = deps.as512, T512 = deps.trajectory;
    var MU = deps.mu || EARTH.mu_m3_s2, RE = deps.radius || EARTH.radius_m, OMEGA = deps.omega != null ? deps.omega : EARTH.omega_rad_s;
    var FT = AERO.FT, D_SATURN = AERO.referenceDiameterFt * FT;
    var CAPE = EARTH.sites['cape-canaveral'];

    // ================================================================== aerodynamics
    /** Axial force coefficient at Mach M from Walker's Figure 28: curve 'forebody' (default) or 'total' (power off).
     * Held flat outside Mach 0.5 to 7.8; `outside` says when that happened. */
    function axialCoefficient(M, curve) {
      var c = curve === 'total' ? AERO.total : AERO.forebody;
      return { ca: interp(c.mach, c.ca, M), outside: M < c.mach[0] || M > c.mach[c.mach.length - 1] };
    }
    function atmosphere(h) {
      if (!(h < ATM_TOP)) return { P: 0, rho: 0, a: null, T: null, above: true };
      var s = isa(Math.max(h, 0));
      return { P: s.P_Pa, rho: s.rho_kg_m3, a: s.a_m_s, T: s.T_K, above: false };
    }

    // ================================================================== engines and vehicle from idea 34's handoff
    var NUMS = ['thrust_vacuum_N', 'mass_flow_kg_s', 'specific_impulse_vacuum_m_s', 'exit_area_m2', 'separation_onset_ambient_pressure_Pa'];
    function off(a, b, tol) { return !(num(a) && num(b) && Math.abs(a - b) <= (tol || 1e-8) * Math.max(Math.abs(b), 1e-300)); }
    /** An engine record (idea 34's shape, which idea 34's evaluate() reads) from an engine of idea 34's handoff, refused
     * unless its numbers hold together: Isp = F/mdot, F_SL = F_vac - p0 A_e, the deck's 100 % row = F_vac, and (preset)
     * idea 34's own record for that preset, or (imported) idea 33's handoff it carries. */
    function engineFromOut(id, o) {
      var bad = function (why) { return { refusal: refusal('invalid_input', 'Engine "' + id + '" in this vehicle handoff: ' + why + '.', 'The unedited handoff idea 34 exported.') }; };
      if (!o || typeof o !== 'object') return bad('missing');
      for (var i = 0; i < NUMS.length; i++) if (!(num(o[NUMS[i]]) && o[NUMS[i]] > 0)) return bad(NUMS[i] + ' is not a positive number');
      if (off(o.specific_impulse_vacuum_m_s, o.thrust_vacuum_N / o.mass_flow_kg_s)) return bad('specific_impulse_vacuum_m_s is not thrust_vacuum_N / mass_flow_kg_s');
      if (o.thrust_sea_level_N != null && off(o.thrust_sea_level_N, o.thrust_vacuum_N - P0 * o.exit_area_m2)) return bad('thrust_sea_level_N is not thrust_vacuum_N - ' + P0 + ' Pa x exit_area_m2');
      var dk = o.deck_vacuum;
      if (!dk || !Array.isArray(dk.throttle) || dk.throttle.length < 2 || dk.throttle.indexOf(1) < 0) return bad('no throttle deck with a 100 % row');
      if (off(dk.thrust_vac[dk.throttle.indexOf(1)], o.thrust_vacuum_N)) return bad('the deck\'s 100 % thrust is not thrust_vacuum_N');
      if (o.kind === 'preset') {
        var ref = ENG34[id];
        if (!ref) return { refusal: refusal('not_found', 'Engine preset "' + id + '" is not one of idea 34\'s.', 'An idea 34 preset (F-1, H-1, J-2, LR89-NA-7, RL10A-3-3) or an engine imported from idea 33.') };
        var keys = NUMS.concat(['thrust_sea_level_N', 'mixture_ratio']);
        for (var j = 0; j < keys.length; j++) if (ref[keys[j]] == null ? o[keys[j]] != null : off(o[keys[j]], ref[keys[j]], 1e-9)) return bad(keys[j] + ' = ' + fmt(o[keys[j]], 9) + ', but idea 34 computes ' + fmt(ref[keys[j]], 9) + ' for ' + id);
      } else {
        var h = o.engine_handoff, O = h && h.outputs, n = o.chambers || 1;
        if (!O || !O.thrust_vacuum || !O.mass_flow) return bad('an imported engine carries no idea 33 handoff with its outputs');
        if (off(O.thrust_vacuum.value * n, o.thrust_vacuum_N) || off(O.mass_flow.value * n, o.mass_flow_kg_s)) return bad('its thrust or flow is not what the idea 33 handoff it carries says');
      }
      return { record: { id: id, label: o.label || id, kind: o.kind, chambers: o.chambers || 1, thrustVac: o.thrust_vacuum_N, thrustVacUpper: o.thrust_vacuum_upper_N, thrustSL: o.thrust_sea_level_N,
        mdot: o.mass_flow_kg_s, ggFlow: o.gas_generator_flow_kg_s || 0, ispVac: o.specific_impulse_vacuum_m_s, ispVacUpper: o.specific_impulse_vacuum_upper_m_s, ispSL: o.specific_impulse_sea_level_m_s,
        mixtureRatio: o.mixture_ratio, rhoOx: o.oxidizer_density_kg_m3, rhoFuel: o.fuel_density_kg_m3, exitArea: o.exit_area_m2, sepOnsetPa: o.separation_onset_ambient_pressure_Pa,
        deckVac: dk, refusals: o.refusals || [], source: o.source } };
    }
    /**
     * Read idea 34's handoff (or this module's own, which carries idea 34's whole): the vehicle and its engines. Refused
     * unless idea 34's ledger, re-run here on the handoff's inputs, gives its outputs to 1e-8, and a vehicle that calls
     * itself AS-512 keeps that name only if it is the flight report's.
     */
    function vehicleFromHandoff(input) {
      var h = input;
      if (typeof input === 'string') { try { h = JSON.parse(input); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'The handoff idea 34 (Stack) exports.') }; } }
      if (!h || typeof h !== 'object' || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'The handoff idea 34 (Stack) exports.') };
      if (h.from === '35-max-q') { var own = parseHandoff(h); return own.refusal ? own : { vehicle: own.vehicle, engines: own.engines, handoff34: own.handoff34, plan: own.plan }; }
      if (/^3[123]-/.test(h.from || '')) return { refusal: refusal('insufficient_data', 'A ' + h.from + ' handoff is ' + (h.from === '33-engine-deck' ? 'an engine' : 'part of an engine') + ', not a vehicle: an ascent needs stages, propellant and dry masses.', 'Put it on a stack in idea 34 (Stack) and export that handoff.') };
      if (h.from !== '34-stack') return { refusal: refusal('invalid_input', 'A handoff from ' + (h.from || 'an unknown module') + ' is not a vehicle; this module reads idea 34\'s.', 'A handoff exported by 34-stack.') };
      var veh = h.inputs && h.inputs.vehicle, eng = (h.inputs && h.inputs.engines) || {};
      if (!veh || !Array.isArray(veh.stages) || !veh.stages.length) return { refusal: refusal('invalid_input', 'This 34-stack handoff carries no vehicle.', 'A handoff exported by idea 34.') };
      var engines = {};
      for (var k in eng) { var e = engineFromOut(k, eng[k]); if (e.refusal) return e; engines[k] = e.record; }
      veh = clone(veh);
      var r = S.evaluate(veh, engines, { timeline: false });
      if (!r.ok) return { refusal: Object.assign({}, r.refusals[0], { reason: 'Idea 34 refuses this vehicle: ' + r.refusals[0].reason }) };
      var O = h.outputs || {};
      var outs = [['liftoff_mass', r.liftoff.mass], ['payload_mass', r.payload], ['delta_v_ideal', r.dv], ['burn_time_total', r.burnTime]];
      for (var j = 0; j < outs.length; j++) {
        var got = O[outs[j][0]] && O[outs[j][0]].value;
        if (off(got, outs[j][1])) return { refusal: refusal('invalid_input', 'The vehicle handoff says ' + outs[j][0] + ' = ' + fmt(got, 9) + ', but idea 34\'s ledger gives ' + fmt(outs[j][1], 9) + ' from its inputs: it was edited, or made with other data.', 'The unedited handoff idea 34 exported.') };
      }
      if (veh.id === 'AS-512') {
        var ref = S.fromAS512(D512); if (veh.simplified) ref = S.simplify(ref);
        var strip = function (v) { return JSON.stringify({ p: v.payload && v.payload.mass, s: v.stages }); };
        if (strip(veh) !== strip(ref)) { veh.id = 'imported'; veh.note = 'Called itself AS-512 but its masses or events are not the flight report\'s: treated as assumed.'; }
      }
      return { vehicle: veh, engines: engines, handoff34: h, ledger: r };
    }

    // ================================================================== flight plan
    /** Burns flown in the ascent: in order, up to and including the first burn that is followed by a restart of the
     * same stage (the parking orbit); the rest are handed on (an Earth-departure burn is module 38's). */
    function ascentBurns(veh) {
      var list = [];
      for (var si = 0; si < veh.stages.length; si++) {
        var bs = veh.stages[si].burns;
        for (var bi = 0; bi < bs.length; bi++) { list.push({ si: si, bi: bi }); if (bi < bs.length - 1) return { flown: list, stopsAtRestart: true }; }
      }
      return { flown: list, stopsAtRestart: false };
    }
    /** The AS-512 staging coasts from idea 34's transcription: outboard cutoff to the next stage's mainstage. */
    function as512Coasts() {
      var ST = D512.stageTables;
      return [ST['S-II'].events['S-II mainstage'].t - D512.events.sicOeco, ST['S-IVB burn 1'].events['S-IVB mainstage'].t - ST['S-II'].events['S-II engine cutoff'].t];
    }
    function as512T0() { return D512.stageTables['S-IC'].events['holddown arm release'].t; }
    /** Default flight plan for a vehicle. AS-512: flight azimuth and pitch start from the report, coasts from idea 34's
     * events, 33 ft diameter; the kick angle and upper-stage pitch are solved, not stored (see solveKick, solveInsertion). */
    function defaultPlan(veh) {
      var n = veh.stages.length, as = veh.id === 'AS-512';
      var coasts = as ? as512Coasts() : [];
      return {
        site: { id: 'cape-canaveral', label: CAPE.name, latitudeDeg: CAPE.latitudeDeg, source: EARTH.sites_source },
        azimuthDeg: as ? T512.flightAzimuthDeg : 90,
        pitchStart: as ? T512.events.beginPitchRoll - as512T0() : 10,
        kickDeg: 2, kickDuration: 10,
        // upper stages, together: 'gravity' (zero angle of attack in the plane), 'hold' (startDeg above the horizon) or
        // 'linear' (startDeg at upper-stage ignition to endDeg at the last cutoff, linear in time)
        upper: { mode: as ? 'linear' : 'gravity', startDeg: 0, endDeg: 0 },
        stagingCoast: veh.stages.slice(1).map(function (s, i) { return as ? coasts[i] : 0; }),
        throttle: null,
        flowScale: veh.stages.map(function () { return 1; }),
        drag: 'forebody', dragScale: 1, diameter: D_SATURN,
        rotation: true, gravity: 'inverse-square',
        dt: { atmosphere: 0.2, vacuum: 1 },
      };
    }
    function validatePlan(veh, engines, plan) {
      var out = [], cor = null;
      var lat = plan.site && plan.site.latitudeDeg;
      if (!(num(lat) && lat > -89 && lat < 89)) out.push(refusal('invalid_input', 'The launch latitude must be a number of degrees between -89 and 89.', 'A launch site latitude.', { applies_to: 'site' }));
      if (!num(plan.azimuthDeg)) out.push(refusal('invalid_input', 'The launch azimuth must be a number of degrees.', 'An azimuth from north toward east.', { applies_to: 'azimuth' }));
      if (plan.site && plan.site.id && EARTH.sites[plan.site.id] && num(plan.azimuthDeg)) {
        cor = EARTH.sites[plan.site.id].azimuthCorridorDeg;
        var az = ((plan.azimuthDeg % 360) + 360) % 360;
        if (az < cor[0] || az > cor[1]) out.push(refusal('out_of_envelope', 'Azimuth ' + fmt(plan.azimuthDeg, 4) + ' deg is outside ' + EARTH.sites[plan.site.id].name + '\'s range-safety corridor (' + cor[0] + ' to ' + cor[1] + ' deg, Aster feasibility.ts).', 'An azimuth inside the corridor, or another site.', { applies_to: 'azimuth' }));
      }
      if (!(num(plan.pitchStart) && plan.pitchStart >= 0)) out.push(refusal('invalid_input', 'The pitch-over start must be zero or more seconds after liftoff.', 'A time.', { applies_to: 'pitch' }));
      if (!(num(plan.kickDeg) && plan.kickDeg >= 0 && plan.kickDeg < 60)) out.push(refusal('invalid_input', 'The kick angle must be 0 to 60 degrees.', 'An angle.', { applies_to: 'pitch' }));
      if (!(num(plan.kickDuration) && plan.kickDuration > 0)) out.push(refusal('invalid_input', 'The kick must take a positive number of seconds.', 'A duration.', { applies_to: 'pitch' }));
      if (!(num(plan.diameter) && plan.diameter > 0)) out.push(refusal('invalid_input', 'The reference diameter must be a positive length.', 'The vehicle\'s diameter.', { applies_to: 'drag' }));
      if (!(num(plan.dragScale) && plan.dragScale >= 0)) out.push(refusal('invalid_input', 'The drag scale must be zero or more.', 'A factor on the drag coefficient.', { applies_to: 'drag' }));
      (plan.stagingCoast || []).forEach(function (c, i) { if (!(num(c) && c >= 0)) out.push(refusal('invalid_input', 'Staging coast ' + (i + 1) + ' must be zero or more seconds.', 'A time.', { applies_to: 'staging' })); });
      (plan.flowScale || []).forEach(function (k, i) { if (!(num(k) && k > 0.5 && k < 1.5)) out.push(refusal('out_of_envelope', 'Stage ' + (i + 1) + '\'s thrust-and-flow scale ' + fmt(k, 4) + ' is outside 0.5 to 1.5: that is another engine, not a calibration.', 'A scale near 1.', { applies_to: 'stage ' + (i + 1) })); });
      var up = plan.upper || {};
      if (['gravity', 'hold', 'linear'].indexOf(up.mode) < 0) out.push(refusal('invalid_input', 'Upper-stage steering must be gravity, hold or linear.', 'One of the three.', { applies_to: 'upper' }));
      if (up.mode !== 'gravity') ['startDeg'].concat(up.mode === 'linear' ? ['endDeg'] : []).forEach(function (k) { if (!(num(up[k]) && up[k] > -45 && up[k] < 89)) out.push(refusal('invalid_input', 'The upper stages\' pitch above the horizon must be between -45 and 89 degrees.', 'An angle.', { applies_to: 'upper' })); });
      var th = plan.throttle;
      if (th) {
        if (!(num(th.start) && num(th.end) && th.end > th.start && th.start >= 0)) out.push(refusal('invalid_input', 'The throttle bucket needs a start and a later end, in seconds after liftoff.', 'Two times.', { applies_to: 'throttle' }));
        var dk = engines[veh.stages[0].engine] && engines[veh.stages[0].engine].deckVac;
        if (!num(th.level)) out.push(refusal('invalid_input', 'The throttle in the bucket must be a number (a fraction of rated thrust).', 'A throttle inside the deck idea 33 computed.', { applies_to: 'throttle' }));
        else if (!dk || th.level < dk.throttle[0] - 1e-12 || th.level > dk.throttle[dk.throttle.length - 1] + 1e-12) out.push(refusal('out_of_envelope', 'Throttle ' + fmt(100 * th.level, 3) + ' % is outside the first stage engine\'s deck (' + (dk ? fmt(100 * dk.throttle[0], 3) + ' to ' + fmt(100 * dk.throttle[dk.throttle.length - 1], 3) + ' %' : 'none') + ', idea 33).', 'A throttle inside the deck idea 33 computed.', { applies_to: 'throttle' }));
      }
      return out;
    }

    // ================================================================== the flight
    /** Initial state on the pad: at the sphere's surface at the launch latitude on the x-z meridian, moving with it. */
    function padState(latDeg, rotation) {
      var c = Math.cos(latDeg * DEG), s = Math.sin(latDeg * DEG);
      var r = [RE * c, 0, RE * s];
      var w = rotation ? OMEGA : 0;
      return { r: r, v: [-w * r[1], w * r[0], 0] };
    }
    function localFrame(r) {
      var up = unit(r), east = unit([-up[1], up[0], 0]);
      if (norm(east) === 0) east = [0, 1, 0];
      return { up: up, east: east, north: cross(up, east) };
    }
    /** Acceleration and loss rates at state y = [x,y,z,vx,vy,vz,m, I...] under segment context c. */
    function deriv(t, y, c, out) {
      var r = [y[0], y[1], y[2]], v = [y[3], y[4], y[5]], m = y[6];
      var rn = norm(r), up = scale(r, 1 / rn);
      var w = c.omega;
      var vrel = [v[0] + w * r[1], v[1] - w * r[0], v[2]];
      var vr = norm(vrel), h = rn - RE;
      var atm = atmosphere(h);
      var gmag = c.uniformG ? MU / (RE * RE) : MU / (rn * rn);
      var g = scale(up, -gmag);
      // thrust
      var Fv = c.engines > 0 ? c.Fvac : 0, Fp = c.engines > 0 ? atm.P * c.Ae : 0, F = Fv - Fp;
      var u = steer(t, r, v, vrel, up, c);
      // dynamic pressure and Mach number belong to the flight, drag or no drag (review: with drag off they were 0 and
      // null, and the page showed max Q 0.00 kPa and Mach 1 "never"); drag acts only when it is switched on
      var Dm = 0, M = null, q = 0, ca = 0, outside = false;
      if (atm.rho > 0 && vr > 0) {
        q = 0.5 * atm.rho * vr * vr; M = vr / atm.a;
        if (c.drag) {
          var cc = axialCoefficient(M, c.dragCurve); ca = cc.ca * c.dragScale; outside = cc.outside;
          Dm = q * c.Sref * ca / m;
        }
      }
      var vrh = vr > 0 ? scale(vrel, 1 / vr) : [0, 0, 0];
      var acc = add(add(g, scale(u, F / m)), scale(vrh, -Dm));
      var vn = norm(v), vh = vn > 1e-9 ? scale(v, 1 / vn) : u;
      out[0] = v[0]; out[1] = v[1]; out[2] = v[2];
      out[3] = acc[0]; out[4] = acc[1]; out[5] = acc[2];
      out[6] = -c.mdot;
      out[7] = Fv / m;                       // ideal (vacuum thrust)
      out[8] = Fp / m;                       // back pressure
      out[9] = Dm * dot(vrh, vh);            // drag
      out[10] = -dot(g, vh);                 // gravity
      out[11] = (F / m) * (1 - dot(u, vh));  // steering
      out[12] = outside ? Dm : 0;            // drag booked while the Mach number is outside Walker's data
      // the same budget against the Earth-relative speed: d|vrel|/dt = F_vac/m - p_a A_e/m - D/m + g . vrel_hat
      // - F (1 - u . vrel_hat)/m + vrel_hat . (-omega x (omega x r)); the Coriolis term is normal to vrel
      var rh = vr > 1e-9 ? vrh : u;
      out[13] = -dot(g, rh);                 // gravity, Earth-relative
      out[14] = (F / m) * (1 - dot(u, rh)); // steering, Earth-relative
      out[15] = w * w * (r[0] * rh[0] + r[1] * rh[1]); // centrifugal: -omega x (omega x r) = omega^2 (x, y, 0)
      out[16] = Dm;                          // drag, Earth-relative (drag is along -vrel)
      return { q: q, M: M, P: atm.P, rho: atm.rho, h: h, vrel: vr, F: F, D: Dm * m, ca: ca, u: u, aNG: norm(add(scale(u, F / m), scale(vrh, -Dm))) };
    }
    /** The launch plane: fixed in inertial space at liftoff, through Earth's centre and the pad, containing the
     * launch azimuth (as a guidance reference plane is). Returns its unit normal. */
    function launchPlane(r0, azRad) {
      var fr = localFrame(r0), d0 = add(scale(fr.north, Math.cos(azRad)), scale(fr.east, Math.sin(azRad)));
      return unit(cross(r0, d0));
    }
    /** In-plane vertical and downrange directions at r (r projected onto the launch plane). */
    function planeFrame(r, np) {
      var upP = unit(sub(r, scale(np, dot(r, np))));
      return { up: upP, down: cross(np, upP) };
    }
    /** Thrust direction. Every steered phase keeps the thrust in the launch plane (no yaw steering): 'kick' tilts
     * from vertical toward downrange, 'gravity' follows the Earth-relative velocity projected on the plane (zero angle
     * of attack in pitch), 'pitch' holds an angle above the in-plane horizontal. */
    function steer(t, r, v, vrel, up, c) {
      var mode = c.steer;
      if (c.engines === 0 || mode === 'vertical') return up; // no thrust: direction irrelevant
      var pf = planeFrame(r, c.np);
      if (mode === 'kick') {
        var th = c.kick * Math.min(1, Math.max(0, (t - c.tp) / c.tk));
        return add(scale(pf.up, Math.cos(th)), scale(pf.down, Math.sin(th)));
      }
      if (mode === 'pitch' || mode === 'linear') {
        var p = mode === 'pitch' ? c.pitch : c.pitch0 + (c.pitch1 - c.pitch0) * Math.min(1, Math.max(0, (t - c.tu0) / (c.tu1 - c.tu0)));
        return add(scale(pf.down, Math.cos(p)), scale(pf.up, Math.sin(p)));
      }
      var vp = sub(vrel, scale(c.np, dot(vrel, c.np))), vn = norm(vp);
      return vn > 1e-6 ? scale(vp, 1 / vn) : pf.up; // 'gravity'
    }
    var NY = 17;
    function rk4(t, y, h, c) {
      var k1 = new Array(NY), k2 = new Array(NY), k3 = new Array(NY), k4 = new Array(NY), yt = new Array(NY), i;
      deriv(t, y, c, k1);
      for (i = 0; i < NY; i++) yt[i] = y[i] + 0.5 * h * k1[i];
      deriv(t + 0.5 * h, yt, c, k2);
      for (i = 0; i < NY; i++) yt[i] = y[i] + 0.5 * h * k2[i];
      deriv(t + 0.5 * h, yt, c, k3);
      for (i = 0; i < NY; i++) yt[i] = y[i] + h * k3[i];
      deriv(t + h, yt, c, k4);
      var o = new Array(NY);
      for (i = 0; i < NY; i++) o[i] = y[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      return o;
    }
    /**
     * Integrate from (t, y) to t1 under context c with steps of at most dt, landing on t1. sample(t, y, info) after every
     * step; stop(t, y, info) may end the integration early (returns the time). Exposed for the closed-form tests.
     */
    function integrate(t, y, t1, c, dt, sample, stop) {
      var tmp = new Array(NY);
      while (t < t1 - 1e-12) {
        var h = Math.min(dt, t1 - t);
        var yn = rk4(t, y, h, c);
        if (stop) {
          var s = stop(t + h, yn);
          if (s) return { t: t + h, y: yn, stopped: s, tPrev: t, yPrev: y };
        }
        t += h; y = yn;
        if (sample) sample(t, y, deriv(t, y, c, tmp));
      }
      return { t: t, y: y };
    }

    /** Time from the first upper-stage ignition to the last flown cutoff: upper burns at their ledger times (idea
     * 34's, over the flow scale) and the staging coasts between them. Upper stages do not throttle, so it is fixed. */
    function upperDuration(veh, ledger, plan, flown) {
      var T = 0;
      flown.forEach(function (f) { if (f.si > 0 && (plan.upper.over !== 'first' || f.si === 1)) { T += ledger.stages[f.si].burns[f.bi].time / (plan.flowScale[f.si] || 1); if (f.bi === 0 && f.si > 1) T += plan.stagingCoast[f.si - 1] || 0; } });
      return T;
    }
    /**
     * Fly the ascent. veh/engines: from vehicleFromHandoff (idea 34's); plan: defaultPlan() edited. opts.burns: how many
     * burns to fly (default: the ascent, see ascentBurns); opts.samples: keep the time history (default true).
     */
    function fly(veh, engines, plan, opts) {
      opts = opts || {};
      var errs = validatePlan(veh, engines, plan);
      var ledger = S.evaluate(veh, engines, { timeline: false });
      if (!ledger.ok) errs = errs.concat(ledger.refusals);
      ledger.ok && ledger.refusals.forEach(function (x) { if (x.applies_to === 'liftoff') errs.push(x); });
      if (errs.length) return { ok: false, refusals: errs };
      var asc = ascentBurns(veh), flown = asc.flown;
      if (num(opts.burns)) flown = flown.slice(0, Math.max(1, opts.burns));
      var keep = opts.samples !== false;
      var refusals = [], warnings = [], samples = [], events = [], stageEnds = [];
      var pad = padState(plan.site.latitudeDeg, plan.rotation !== false);
      var y = [pad.r[0], pad.r[1], pad.r[2], pad.v[0], pad.v[1], pad.v[2], ledger.liftoff.mass, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var v0 = norm(pad.v), t = 0;
      var Sref = Math.PI * plan.diameter * plan.diameter / 4;
      var base = { omega: plan.rotation !== false ? OMEGA : 0, uniformG: plan.gravity === 'uniform', drag: plan.drag !== 'none' && plan.dragScale > 0, dragCurve: plan.drag, dragScale: plan.dragScale, Sref: Sref, az: plan.azimuthDeg * DEG };
      base.np = launchPlane(pad.r, base.az);
      var maxQ = { q: -1 }, mach1 = null, prevM = null, prevT = null, qHist = [];
      var latR = plan.site.latitudeDeg * DEG;
      var sep = null, crashed = null, kickDone = false, kickEndT = null, above = false, reentry = null, stiff = null, curDt = plan.dt.atmosphere;
      // after every step (burns and coasts): the ground, the atmosphere's top on the way down, and a drag so strong that
      // one explicit step cannot follow it (review: a 100 km diameter blew the integrator up and was reported as escape)
      // A step whose Earth-relative speed grew by more than thrust, gravity and the centrifugal term could give (drag only
      // slows it; Coriolis turns it) has left the physics, whatever its numbers say.
      var lastVrel = 0;
      function watch(tt, yy, info, stage) {
        if (info.h < -1 && !crashed) crashed = { t: tt, stage: stage };
        if (info.h >= ATM_TOP) above = true; else if (above && !reentry) reentry = { t: tt, stage: stage, v: info.vrel };
        var aD = info.D / yy[6], rn = Math.sqrt(yy[0] * yy[0] + yy[1] * yy[1] + yy[2] * yy[2]);
        var jump = info.vrel > lastVrel + (Math.abs(info.F) / yy[6] + MU / (rn * rn) + base.omega * base.omega * rn) * curDt * 1.5 + 1;
        lastVrel = info.vrel;
        if (!stiff && (!(isFinite(yy[0] + yy[1] + yy[2] + yy[3] + yy[4] + yy[5] + yy[6])) || jump || (aD > 0 && aD * curDt > Math.max(info.vrel, 1)))) stiff = { t: tt, stage: stage, dt: curDt };
      }
      function record(tt, yy, info, stage, burn, n, tau) {
        // events in the first stage: max Q (parabolic refinement later) and Mach 1 (linear in time)
        if (info.M != null && prevM != null && prevM < 1 && info.M >= 1 && !mach1) { var f = (1 - prevM) / (info.M - prevM); mach1 = { t: prevT + f * (tt - prevT), h: null }; }
        if (info.q > maxQ.q) maxQ = { q: info.q, t: tt, h: info.h, M: info.M, i: qHist.length };
        qHist.push([tt, info.q, info.h, info.M]);
        prevM = info.M; prevT = tt;
        if (keep) samples.push(sampleOf(tt, yy, info, stage, burn, n, tau));
      }
      function sampleOf(tt, yy, info, stage, burn, n, tau) {
        var r = [yy[0], yy[1], yy[2]], v = [yy[3], yy[4], yy[5]], fr = localFrame(r), vn = norm(v);
        var padNow = [RE * Math.cos(latR) * Math.cos(base.omega * tt), RE * Math.cos(latR) * Math.sin(base.omega * tt), RE * Math.sin(latR)];
        var ang = Math.acos(Math.max(-1, Math.min(1, dot(unit(r), unit(padNow)))));
        return { t: tt, h: info.h, v: vn, vrel: info.vrel, fpa: Math.asin(Math.max(-1, Math.min(1, dot(v, fr.up) / vn))) / DEG, q: info.q, M: info.M, m: yy[6],
          a: info.aNG, F: info.F, D: info.D, range: RE * ang, stage: stage, burn: burn, n: n, tau: tau,
          loss: { ideal: yy[7], pressure: yy[8], drag: yy[9], gravity: yy[10], steering: yy[11] }, lossRel: { drag: yy[16], gravity: yy[13], steering: yy[14], centrifugal: yy[15] } };
      }
      // separation check at a state: ambient pressure against the nozzle's onset (idea 33's criterion)
      function sepCheck(tt, yy, e, tau, si) {
        var h = norm([yy[0], yy[1], yy[2]]) - RE, P = atmosphere(h).P, onset = interp(e.deckVac.throttle, e.deckVac.separation_onset_pa, tau);
        if (P > onset && !sep) sep = { t: tt, h: h, P: P, onset: onset, stage: si };
        return P > onset;
      }
      var info0 = deriv(0, y, Object.assign({}, base, { engines: 0, mdot: 0, Fvac: 0, Ae: 0, steer: 'vertical' }), new Array(NY));
      record(0, y, info0, 0, 0, veh.stages[0].count, 1);
      var curStage = -1, carried = 0, tu0 = null, tu1 = null;
      for (var fi = 0; fi < flown.length && !sep && !crashed; fi++) {
        var si = flown[fi].si, bi = flown[fi].bi, s = veh.stages[si], b = s.burns[bi], e = engines[s.engine];
        if (si !== curStage) {
          if (curStage >= 0) {
            // separation of the spent stage, then the staging coast
            var sp = veh.stages[curStage];
            y[6] -= sp.dry + sp.remaining + carried; carried = 0;
            var cT = plan.stagingCoast[si - 1] || 0;
            if (cT > 0) {
              var cc = Object.assign({}, base, { engines: 0, mdot: 0, Fvac: 0, Ae: 0, steer: 'gravity' });
              curDt = plan.dt.atmosphere;
              var rr = integrate(t, y, t + cT, cc, plan.dt.atmosphere, function (tt, yy, inf) { record(tt, yy, inf, si, -1, 0, 0); watch(tt, yy, inf, si); });
              t = rr.t; y = rr.y;
              events.push({ kind: 'coast', stage: si, t0: t - cT, t1: t });
              if (crashed || stiff) break;
            }
          }
          curStage = si;
        }
        y[6] -= b.shed || 0;
        var tB0 = t, k = plan.flowScale[si] || 1, n = s.count, P = b.propellant, burned = 0;
        var thr = si === 0 && plan.throttle ? plan.throttle : null;
        // breakpoints within the burn (burn clock = t - tB0): events, throttle edges, steering phases
        var bps = [];
        (b.jettisons || []).forEach(function (j) { bps.push({ t: j.t, kind: 'jettison', mass: j.mass, label: j.label }); });
        (b.engineOut || []).forEach(function (o) { bps.push({ t: o.t, kind: 'engine-out', count: o.count, label: o.label }); });
        if (thr) { bps.push({ t: thr.start, kind: 'throttle' }); bps.push({ t: thr.end, kind: 'throttle' }); }
        if (si === 0) { bps.push({ t: plan.pitchStart, kind: 'steer' }); bps.push({ t: plan.pitchStart + plan.kickDuration, kind: 'steer' }); }
        bps.sort(function (a, c) { return a.t - c.t; });
        var applied = [];
        var applyBp = function (bp) {
          if (bp.kind === 'jettison') { y[6] -= bp.mass; events.push({ kind: 'jettison', stage: si, t: t, label: bp.label, mass: bp.mass }); }
          else if (bp.kind === 'engine-out') { n -= bp.count; events.push({ kind: 'engine-out', stage: si, t: t, label: bp.label, state: stateOf(t, y, base.omega) }); }
          else if (bp.kind === 'steer' && Math.abs(bp.t - plan.pitchStart) < 1e-9 && plan.kickDeg === 0) kickDone = true;
        };
        while (burned < P * (1 - 1e-12)) {
          var tc = t - tB0;
          // every event due now and not yet applied (two events at one instant: the S-II's interstage and escape tower)
          for (var q0 = 0; q0 < bps.length; q0++) if (applied.indexOf(q0) < 0 && bps[q0].t <= tc + 1e-9) { applyBp(bps[q0]); applied.push(q0); }
          var tau = thr && tc >= thr.start - 1e-9 && tc < thr.end - 1e-9 ? thr.level : 1;
          var dk = e.deckVac, chamber1 = dk.mass_flow_chamber[dk.throttle.indexOf(1)];
          var FvacN = interp(dk.throttle, dk.thrust_vac, tau) * k, mdotN = e.mdot * interp(dk.throttle, dk.mass_flow_chamber, tau) / chamber1 * k;
          var umode = plan.upper.mode, mode = si === 0 ? (tc < plan.pitchStart - 1e-9 ? 'vertical' : (kickDone ? 'gravity' : 'kick')) : (umode === 'hold' ? 'pitch' : umode);
          if (si > 0 && tu0 == null) { tu0 = t; tu1 = t + upperDuration(veh, ledger, plan, flown); }
          var c = Object.assign({}, base, { engines: n, Fvac: n * FvacN, mdot: n * mdotN, Ae: n * e.exitArea, steer: mode, tp: plan.pitchStart, tk: plan.kickDuration, kick: plan.kickDeg * DEG,
            pitch: (plan.upper.startDeg || 0) * DEG, pitch0: (plan.upper.startDeg || 0) * DEG, pitch1: (plan.upper.endDeg || 0) * DEG, tu0: tu0, tu1: tu1 });
          if (sepCheck(t, y, e, tau, si)) break;
          // the next breakpoint, or burnout
          var nb = null; for (var q = 0; q < bps.length; q++) if (applied.indexOf(q) < 0 && bps[q].t > tc + 1e-9) { nb = q; break; }
          var tOut = (P - burned) / (n * mdotN);
          var tEnd = tB0 + tc + tOut, isBp = false;
          if (nb != null && bps[nb].t < tc + tOut - 1e-9) { tEnd = tB0 + bps[nb].t; isBp = true; }
          var dtS = c.steer === 'kick' || c.steer === 'vertical' || norm([y[0], y[1], y[2]]) - RE < ATM_TOP ? plan.dt.atmosphere : plan.dt.vacuum;
          var tStart = t; curDt = dtS;
          var stopFn = null;
          if (mode === 'kick') {
            // the kick hands over to the gravity turn once its ramp is done and the Earth-relative velocity has turned as far
            var tRampEnd = tB0 + plan.pitchStart + plan.kickDuration;
            stopFn = function (tt, yy) {
              if (tt < tRampEnd - 1e-9) return false;
              var r = [yy[0], yy[1], yy[2]], pf = planeFrame(r, base.np), vrel = [yy[3] + base.omega * yy[1], yy[4] - base.omega * yy[0], yy[5]];
              var vp = sub(vrel, scale(base.np, dot(vrel, base.np)));
              return Math.atan2(dot(vp, pf.down), dot(vp, pf.up)) >= plan.kickDeg * DEG ? 'kick-done' : false;
            };
          }
          var res = integrate(t, y, tEnd, c, dtS, function (tt, yy, inf) {
            record(tt, yy, inf, si, bi, n, tau);
            watch(tt, yy, inf, si);
            sepCheck(tt, yy, e, tau, si); // in flight too: a stage that sinks into thicker air separates there
          }, stopFn);
          if (crashed || stiff || sep) break;
          if (res.stopped === 'kick-done') {
            // refine the hand-over time by bisection inside the last step (to 1e-6 s), then switch
            var lo = res.tPrev, hi = res.t, y0s = res.yPrev;
            for (var it = 0; it < 40 && hi - lo > 1e-6; it++) {
              var mid = (lo + hi) / 2, ym = rk4(res.tPrev, y0s, mid - res.tPrev, c);
              if (stopFn(mid, ym)) hi = mid; else lo = mid;
            }
            var yh = hi > res.tPrev ? rk4(res.tPrev, y0s, hi - res.tPrev, c) : y0s;
            burned += y[6] - yh[6]; t = hi; y = yh; kickDone = true; kickEndT = hi;
            record(t, y, deriv(t, y, c, new Array(NY)), si, bi, n, tau);
            continue;
          }
          burned += y[6] - res.y[6] - 0; t = res.t; y = res.y;
          if (isBp) {
            applyBp(bps[nb]); applied.push(nb);
          } else {
            burned = P; // burnout landed on exactly
          }
          void tStart;
        }
        // breakpoints never reached: jettisons ride to separation, cutoffs are ignored (idea 34's rule)
        bps.forEach(function (bp, q) {
          if (applied.indexOf(q) >= 0) return;
          if (bp.kind === 'jettison') { carried += bp.mass; warnings.push({ applies_to: 'stage ' + (si + 1), reason: (bp.label || 'A jettison') + ' at ' + fmt(bp.t, 4) + ' s comes after this burn ends (' + fmt(t - tB0, 4) + ' s): carried to separation.' }); }
          else if (bp.kind === 'engine-out') warnings.push({ applies_to: 'stage ' + (si + 1), reason: (bp.label || 'An engine cutoff') + ' at ' + fmt(bp.t, 4) + ' s comes after this burn ends and is ignored.' });
        });
        if (sep || crashed || stiff) break;
        stageEnds.push({ stage: si, burn: bi, label: s.label, tIgnition: tB0, t: t, burnTime: t - tB0, state: stateOf(t, y, base.omega), engines: n,
          losses: { ideal: y[7], pressure: y[8], drag: y[9], gravity: y[10], steering: y[11] }, lossesRel: { drag: y[16], gravity: y[13], steering: y[14], centrifugal: y[15] } });
        events.push({ kind: 'cutoff', stage: si, burn: bi, t: t, label: s.label + (s.burns.length > 1 ? ' burn ' + (bi + 1) : '') + ' cutoff' });
      }
      // whatever stopped the flight first is the refusal (a stack that sinks underground also sees sea-level pressure)
      var stops = [];
      if (sep) stops.push([sep.t, refusal('out_of_envelope', 'Stage ' + (sep.stage + 1) + '\'s ' + veh.stages[sep.stage].engine + ' nozzle separates at ' + fmt(sep.h / 1000, 3) + ' km (' + fmt(sep.t, 4) + ' s): ambient pressure ' + fmt(sep.P, 4) + ' Pa is above its separation onset ' + fmt(sep.onset, 4) + ' Pa (idea 33\'s criterion), so its thrust there is not modelled.', 'An engine with a smaller area ratio for that altitude, or light it higher (a longer lower stage).', { applies_to: 'stage ' + (sep.stage + 1) })]);
      if (crashed) stops.push([crashed.t, refusal('out_of_envelope', 'The vehicle comes back to the ground at ' + fmt(crashed.t, 4) + ' s (stage ' + (crashed.stage + 1) + '): the pitch-over is too hard, the thrust too low or a staging coast too long.', 'A smaller kick angle, a later pitch-over, more thrust, or a shorter coast.', { applies_to: 'trajectory' })]);
      if (stiff) stops.push([stiff.t, refusal('out_of_envelope', 'By ' + fmt(stiff.t, 4) + ' s the drag would take away more than the vehicle\'s whole Earth-relative speed in one ' + fmt(stiff.dt, 3) + ' s step, so the fixed-step integrator cannot follow it (its numbers there are not a flight): at this diameter and drag factor the vehicle is a parachute, not a rocket.', 'A reference diameter and drag factor near the vehicle\'s own.', { applies_to: 'drag' })]);
      if (stops.length) {
        stops.sort(function (p1, p2) { return p1[0] - p2[0]; });
        refusals.push(stops[0][1]);
        return { ok: false, refusals: refusals, samples: samples, partial: true };
      }
      // max Q refined by a parabola through the three samples around the peak
      if (maxQ.i > 0 && maxQ.i < qHist.length - 1) {
        var A = qHist[maxQ.i - 1], B = qHist[maxQ.i], C = qHist[maxQ.i + 1];
        var den = (A[0] - B[0]) * (A[0] - C[0]) * (B[0] - C[0]);
        if (den !== 0) {
          var a2 = (C[0] * (B[1] - A[1]) + B[0] * (A[1] - C[1]) + A[0] * (C[1] - B[1])) / den;
          var b2 = (C[0] * C[0] * (A[1] - B[1]) + B[0] * B[0] * (C[1] - A[1]) + A[0] * A[0] * (B[1] - C[1])) / den;
          var c2 = (B[0] * C[0] * (B[0] - C[0]) * A[1] + C[0] * A[0] * (C[0] - A[0]) * B[1] + A[0] * B[0] * (A[0] - B[0]) * C[1]) / den;
          if (a2 < 0) { var tq = -b2 / (2 * a2); if (tq > A[0] && tq < C[0]) { var fq = (tq - A[0]) / (C[0] - A[0]); maxQ = { q: a2 * tq * tq + b2 * tq + c2, t: tq, h: interp([A[0], B[0], C[0]], [A[2], B[2], C[2]], tq), M: interp([A[0], B[0], C[0]], [A[3], B[3], C[3]], tq) }; void fq; } }
        }
      }
      if (mach1) mach1.h = interp(qHist.map(function (x) { return x[0]; }), qHist.map(function (x) { return x[2]; }), mach1.t);
      var fin = stateOf(t, y, base.omega);
      var L = { ideal: y[7], pressure: y[8], drag: y[9], gravity: y[10], steering: y[11], dragOutsideData: y[12] };
      // Earth-relative budget: ideal - pressure - drag - gravity - steering + centrifugal = |vrel| at burnout (0 on the pad)
      var LR = { ideal: y[7], pressure: y[8], drag: y[16], gravity: y[13], steering: y[14], centrifugal: y[15] };
      var gain = fin.speed - v0;
      var closure = L.ideal - L.pressure - L.drag - L.gravity - L.steering - gain;
      var closureRel = LR.ideal - LR.pressure - LR.drag - LR.gravity - LR.steering + LR.centrifugal - fin.speedEarthFixed;
      var orbit = orbitOf([y[0], y[1], y[2]], [y[3], y[4], y[5]]);
      if (!orbit.bound) refusals.push(refusal('out_of_envelope', 'The burnout state is not bound to Earth (C3 = ' + fmt(orbit.c3 / 1e6, 4) + ' km^2/s^2): this ascent escapes.', 'Less propellant or more payload, or hand it to module 38 as a departure.', { applies_to: 'orbit' }));
      else if (orbit.perigeeAlt < ATM_TOP) refusals.push(refusal('out_of_envelope', 'Not in orbit: the burnout state\'s perigee is ' + fmt(orbit.perigeeAlt / 1000, 4) + ' km, inside the atmosphere (below ' + ATM_KM + ' km), so it comes back down.', 'Another upper-stage programme (the end angle trades height for speed), more upper-stage propellant or thrust, or closed-loop guidance (module 36).', { applies_to: 'orbit' }));
      if (reentry) refusals.push(refusal('out_of_envelope', 'The trajectory leaves the atmosphere and comes back into it (below ' + ATM_KM + ' km at ' + fmt(reentry.t, 4) + ' s, stage ' + (reentry.stage + 1) + ', ' + fmt(reentry.v / 1000, 3) + ' km/s Earth-relative): re-entry heating and loads are outside this model, and its drag curve is the launch vehicle\'s.', 'Steer the upper stages higher (a larger upper-stage pitch), or let module 36 guide them.', { applies_to: 'trajectory' }));
      var rest = [];
      if (!num(opts.burns)) veh.stages.forEach(function (s2, si2) { s2.burns.forEach(function (b2, bi2) { if (!flown.some(function (f) { return f.si === si2 && f.bi === bi2; })) rest.push({ stage: si2, burn: bi2, label: s2.label + ' burn ' + (bi2 + 1), propellant: b2.propellant }); }); });
      return { ok: true, refusals: refusals, warnings: warnings, samples: samples, events: events, stageEnds: stageEnds, t: t, final: fin, orbit: orbit,
        losses: L, lossesRel: LR, closureRel: closureRel, gainInertial: gain, v0: v0, closure: closure, maxQ: maxQ, mach1: mach1, kickEndT: kickEndT, liftoff: ledger.liftoff,
        flownBurns: flown, remainingBurns: rest, stopsAtRestart: asc.stopsAtRestart, rotationGain: v0, ledger: ledger, engines: engines };
    }
    function stateOf(t, y, omega) {
      if (omega == null) omega = OMEGA;
      var r = [y[0], y[1], y[2]], v = [y[3], y[4], y[5]], fr = localFrame(r), vn = norm(v);
      var vrel = [v[0] + omega * r[1], v[1] - omega * r[0], v[2]];
      return { t: t, r: r, v: v, mass: y[6], altitude: norm(r) - RE, speed: vn, fpaDeg: Math.asin(Math.max(-1, Math.min(1, dot(v, fr.up) / vn))) / DEG,
        headingDeg: ((Math.atan2(dot(v, fr.east), dot(v, fr.north)) / DEG) + 360) % 360, speedEarthFixed: norm(vrel),
        latitudeDeg: Math.asin(fr.up[2]) / DEG };
    }
    /** Two-body orbit of an ECI state: a, e, inclination, perigee and apogee heights above the sphere, period. */
    function orbitOf(r, v) {
      var rn = norm(r), vn = norm(v), h = cross(r, v), hn = norm(h);
      var En = vn * vn / 2 - MU / rn, ev = sub(scale(cross(v, h), 1 / MU), scale(r, 1 / rn)), e = norm(ev);
      var o = { energy: En, c3: 2 * En, e: e, inclinationDeg: Math.acos(h[2] / hn) / DEG, bound: En < 0, h: hn };
      if (En < 0) { o.a = -MU / (2 * En); o.perigeeAlt = o.a * (1 - e) - RE; o.apogeeAlt = o.a * (1 + e) - RE; o.period = 2 * Math.PI * Math.sqrt(o.a * o.a * o.a / MU); }
      else { o.a = null; o.perigeeAlt = hn * hn / MU / (1 + e) - RE; o.apogeeAlt = null; o.period = null; }
      return o;
    }

    // ================================================================== solvers
    /** Bracket a root of f on a grid (f may be null where the flight is refused), then bisect. */
    function bracketBisect(f, grid, tol, iters) {
      var prev = null, fprev = null, seen = [];
      for (var i = 0; i < grid.length; i++) {
        var fx = f(grid[i]); seen.push([grid[i], fx]);
        if (fx != null && fprev != null && fx * fprev <= 0) { var b = bisect(f, prev, grid[i], tol, iters); b.seen = seen; return b; }
        if (fx != null) { prev = grid[i]; fprev = fx; }
      }
      return { ok: false, seen: seen };
    }
    /** Root of f between lo and hi (f(lo), f(hi) of opposite signs) by the Illinois variant of regula falsi: stops
     * when |f| < ftol or the bracket is narrower than tol; returns the best point seen. */
    function bisect(f, lo, hi, tol, iters, ftol) {
      var a = lo, b = hi, fa = f(a), fb = f(b), side = 0;
      if (fa == null || fb == null || fa * fb > 0) return { lo: lo, hi: hi, flo: fa, fhi: fb, ok: false };
      var best = Math.abs(fa) < Math.abs(fb) ? [a, fa] : [b, fb];
      ftol = ftol || 1e-10;
      for (var i = 0; i < (iters || 80) && Math.abs(best[1]) > ftol && Math.abs(b - a) > tol; i++) {
        var x = (a * fb - b * fa) / (fb - fa), fx = f(x);
        if (fx == null) { x = (a + b) / 2; fx = f(x); if (fx == null) return { ok: false, lo: a, hi: b, flo: fa, fhi: fb }; }
        if (Math.abs(fx) < Math.abs(best[1])) best = [x, fx];
        if (fx * fb > 0) { b = x; fb = fx; if (side === -1) fa /= 2; side = -1; }
        else { a = x; fa = fx; if (side === 1) fb /= 2; side = 1; }
      }
      return { ok: true, x: best[0], f: best[1] };
    }
    /** The kick angle at which the first stage burns out with space-fixed flight-path angle `fpaDeg`. */
    function solveKick(veh, engines, plan, fpaDeg) {
      if (!num(fpaDeg) || fpaDeg <= 0 || fpaDeg >= 90) return { refusal: refusal('invalid_input', 'A target flight-path angle between 0 and 90 degrees.', 'An angle.') };
      var f = function (k) { var p = Object.assign({}, plan, { kickDeg: k }); var r = fly(veh, engines, p, { burns: 1, samples: false }); return r.ok || (r.stageEnds && r.stageEnds.length) ? r.stageEnds[0].state.fpaDeg - fpaDeg : null; };
      var b = bracketBisect(f, [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30], 1e-8, 60);
      if (!b.ok) {
        var got = b.seen.filter(function (x) { return x[1] != null; }).map(function (x) { return x[1] + fpaDeg; });
        return { refusal: refusal('out_of_envelope', 'No kick angle between 0.01 and 30 degrees burns the first stage out at ' + fmt(fpaDeg, 4) + ' deg' + (got.length ? ' (the kicks that fly give ' + fmt(Math.min.apply(null, got), 4) + ' to ' + fmt(Math.max.apply(null, got), 4) + ' deg)' : ' (none of them flies)') + '.', 'A target inside that range, or another pitch-over time.') };
      }
      return { kickDeg: b.x };
    }
    /** The pitch above the local horizontal, held by every upper stage, that makes the last ascent burn end level
     * (flight-path angle 0): the best an open-loop hold can do; module 36 replaces it with guidance. */
    function solveInsertion(veh, engines, plan) {
      if (veh.stages.length < 2) return { refusal: refusal('invalid_input', 'A one-stage vehicle has no upper stage to steer.', 'A stack with an upper stage.') };
      var f = function (p) {
        var pl = Object.assign({}, plan, { upper: Object.assign({}, plan.upper, { mode: plan.upper.mode === 'gravity' ? 'linear' : plan.upper.mode, startDeg: p }) });
        var r = fly(veh, engines, pl, { samples: false });
        return r.ok || (r.final) ? r.final.fpaDeg : null;
      };
      var b = bracketBisect(f, [-20, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60], 1e-8, 60);
      if (!b.ok) {
        var got = b.seen.filter(function (x) { return x[1] != null; }).map(function (x) { return x[1]; });
        return { refusal: refusal('out_of_envelope', 'No fixed upper-stage pitch between -20 and 60 degrees makes the last burn end level' + (got.length ? ' (it ends between ' + fmt(Math.min.apply(null, got), 4) + ' and ' + fmt(Math.max.apply(null, got), 4) + ' deg)' : '') + ': with this first-stage trajectory, this upper-stage programme cannot end level.', 'Another kick (solve it for a first-stage cutoff angle first), closed-loop guidance (module 36), or more upper-stage thrust.') };
      }
      return { pitchDeg: b.x };
    }

    // ================================================================== AS-512 against its flight report
    /** Rows {group, label, model, flight, units, gap, kind, note}: the model's AS-512 ascent (result r of fly() on the
     * AS-512 vehicle with plan p) against Tables 4-1, 4-2 and 4-4. Times are range time (model t + 0.24 s). */
    function as512Rows(r, p) {
      var t0 = as512T0(), rows = [], X = T512;
      var add = function (group, label, model, flight, units, note, kind) { rows.push({ group: group, label: label, model: model, flight: flight, units: units, gap: kind === 'ratio' ? model / flight - 1 : model - flight, kind: kind || 'diff', note: note || '' }); };
      var at = function (tr) { // model state at range time tr, from the samples (linear)
        var s = r.samples, tt = tr - t0;
        for (var i = 1; i < s.length; i++) if (s[i].t >= tt) { var f = (tt - s[i - 1].t) / (s[i].t - s[i - 1].t); var o = {}; ['h', 'v', 'vrel', 'fpa', 'range', 'q', 'M'].forEach(function (k) { o[k] = s[i - 1][k] == null ? null : s[i - 1][k] + f * (s[i][k] - s[i - 1][k]); }); return o; }
        return null;
      };
      if (r.mach1) { add('Mach 1', 'Time', r.mach1.t + t0, X.mach1.t, 's', 'Table 4-1. The flight\'s Mach number used measured weather, not the 1976 standard.'); add('Mach 1', 'Altitude', r.mach1.h / 1000, X.mach1.altitudeKm, 'km'); }
      add('Max Q', 'Time', r.maxQ.t + t0, X.maxQ.t, 's', 'Table 4-1.');
      add('Max Q', 'Dynamic pressure', r.maxQ.q / 1000, X.maxQ.qNcm2 * 10, 'kPa', 'Table 4-1: ' + X.maxQ.qNcm2 + ' N/cm^2. A ' + X.maxQAppendix.windMs + ' m/s wind from ' + X.maxQAppendix.windFromDeg + ' deg at max Q (Appendix A) is not modelled.', 'ratio');
      add('Max Q', 'Altitude', r.maxQ.h / 1000, X.maxQ.altitudeKm, 'km', 'Table 4-1 (' + X.maxQAppendix.altitudeKm + ' km in Appendix A).');
      var ce = at(X.cutoff.sicCeco.t), cg = 'S-IC centre cutoff (' + X.cutoff.sicCeco.t.toFixed(2) + ' s)';
      if (ce) {
        add(cg, 'Altitude', ce.h / 1000, X.cutoff.sicCeco.altKm, 'km', 'Table 4-2, at the same range time.');
        add(cg, 'Space-fixed velocity', ce.v, X.cutoff.sicCeco.v, 'm/s');
        add(cg, 'Flight-path angle', ce.fpa, X.cutoff.sicCeco.fpa, 'deg');
        add(cg, 'Surface range', ce.range / 1000, X.cutoff.sicCeco.rangeKm, 'km');
      }
      var e1 = r.stageEnds[0], s1 = e1.state;
      var k1 = (p.flowScale && p.flowScale[0]) || 1;
      add('S-IC outboard cutoff', 'Time', e1.t + t0, X.cutoff.sicOeco.t, 's', k1 !== 1 ? 'Thrust and flow scaled by ' + fmt(k1, 5) + ' (the flight-average F-1 flow, idea 34): the burn ends on the flight\'s cutoff by construction.' : 'Idea 33\'s F-1 flow; the flight averaged ' + fmt(100 * (as512FlowScale(engines34Of(r)) - 1), 3) + ' % more (idea 34).');
      add('S-IC outboard cutoff', 'Altitude', s1.altitude / 1000, X.cutoff.sicOeco.altKm, 'km');
      add('S-IC outboard cutoff', 'Space-fixed velocity', s1.speed, X.cutoff.sicOeco.v, 'm/s');
      add('S-IC outboard cutoff', 'Flight-path angle', s1.fpaDeg, X.cutoff.sicOeco.fpa, 'deg', p.fitKick ? 'Fitted: the kick angle is solved to match this.' : '');
      var sr = at(e1.t + t0); if (sr) add('S-IC outboard cutoff', 'Surface range', sr.range / 1000, X.cutoff.sicOeco.rangeKm, 'km');
      add('S-IC outboard cutoff', 'Earth-fixed velocity', s1.speedEarthFixed, X.maxEarthFixedVelocity.sic[1], 'm/s', 'Table 4-1 maximum Earth-fixed velocity (' + X.maxEarthFixedVelocity.sic[0].toFixed(2) + ' s).');
      if (r.stageEnds[1]) {
        var e2 = r.stageEnds[1], s2 = e2.state;
        add('S-II cutoff', 'Time', e2.t + t0, X.cutoff.siiOeco.t, 's');
        add('S-II cutoff', 'Altitude', s2.altitude / 1000, X.cutoff.siiOeco.altKm, 'km', 'Geodetic in the report; above the equatorial sphere here.');
        add('S-II cutoff', 'Space-fixed velocity', s2.speed, X.cutoff.siiOeco.v, 'm/s');
        add('S-II cutoff', 'Flight-path angle', s2.fpaDeg, X.cutoff.siiOeco.fpa, 'deg', 'The flight flew closed-loop guidance (IGM); the model holds one pitch.');
      }
      if (r.stageEnds[2]) {
        var e3 = r.stageEnds[2], s3 = e3.state, G = X.cutoff.sivb1Gcs;
        add('S-IVB first cutoff', 'Time', e3.t + t0, G.t, 's', 'Table 4-2 (guidance cutoff signal).');
        add('S-IVB first cutoff', 'Altitude', s3.altitude / 1000, G.altKm, 'km', 'Geodetic in the report.');
        add('S-IVB first cutoff', 'Space-fixed velocity', s3.speed, G.v, 'm/s');
        add('S-IVB first cutoff', 'Flight-path angle', s3.fpaDeg, G.fpa, 'deg', p.fitInsertion ? 'Solved for 0.' : '');
        add('Parking orbit', 'Inclination', r.orbit.inclinationDeg, X.insertion.inclination, 'deg', 'Table 4-4. Launch latitude ' + p.site.latitudeDeg + ' deg (Aster\'s for ' + p.site.label + '), not Pad 39A\'s own.');
        if (r.orbit.bound) { add('Parking orbit', 'Perigee height', r.orbit.perigeeAlt / 1000, X.insertion.perigeeKm, 'km', 'Table 4-4.'); add('Parking orbit', 'Apogee height', r.orbit.apogeeAlt / 1000, X.insertion.apogeeKm, 'km'); }
      }
      return rows;
    }
    /** The AS-512 calibration idea 34 measured: the flow per F-1 the flight averaged over the S-IC burn (Table 16-9's
     * mainstage propellant over the flown engine-seconds), over idea 33's. Returned as a scale for plan.flowScale[0]. */
    function engines34Of(r) { return r.engines; }
    function as512FlowScale(engines) {
      var F = engines['F-1'], ST = D512.stageTables, EV = D512.events, veh = S.fromAS512(D512);
      var tHd = ST['S-IC'].events['holddown arm release'].t, tCe = EV.sicCeco - tHd, tOe = EV.sicOeco - tHd;
      return veh.stages[0].burns[0].propellant / (5 * tCe + 4 * (tOe - tCe)) / F.mdot;
    }

    // ================================================================== handoff (series schema v1)
    var KERNEL = '35-max-q/ascent.js';
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function makeHandoff(h34, veh, plan, r, extra) {
      extra = extra || {};
      var out = { handoff: 'long-way-round', version: 1, from: '35-max-q', produced: extra.produced || new Date().toISOString(),
        inputs: { vehicle_handoff: h34, plan: clone(plan) }, outputs: {}, refusals: [],
        assumptions: [
          'Frame: Earth-centred inertial fixed at liftoff, z along the spin axis, x through the launch meridian at liftoff; no epoch, so the orbit\'s node in J2000 is not fixed here (module 37). Time: seconds from liftoff (holddown release).',
          'Earth: a sphere of radius ' + RE + ' m (Aster pck00010 a), point-mass gravity GM ' + MU + ' m^3/s^2 (Aster delta-v.ts), rotating at ' + OMEGA + ' rad/s (pck00010); no J2, no oblate surface.',
          'Atmosphere: the 1976 US Standard (idea 02\'s isa(), PartForge), no wind; above ' + fmt(ATM_TOP, 7) + ' m (the top of its table) density and pressure taken as zero.',
          'Drag: q S C_A(M), S from a ' + fmt(plan.diameter, 5) + ' m diameter, C_A the Apollo/Saturn V wind-tunnel ' + (plan.drag === 'total' ? 'total (power-off base included)' : 'forebody') + ' coefficient digitized from Walker, NASA TM X-53770, Figure 28, held flat outside Mach 0.5 to 7.8' + (veh.id === 'AS-512' ? '' : '; applied to this vehicle as a shape it may not have') + (plan.dragScale !== 1 ? ', scaled by ' + plan.dragScale : '') + '; no lift, no normal force at angle of attack.',
          'Thrust: n [F_vac(tau) - p_a A_e] from idea 33 via idea 34; at throttle tau the engine flow scales with idea 33\'s chamber flow (gas-generator flow proportional, assumed); no thrust build-up or tail-off impulse; no engine cant.',
          'Steering in a launch plane fixed in inertial space at liftoff (no yaw steering): vertical, a pitch kick held until the Earth-relative velocity turns as far, then zero angle of attack (gravity turn); upper stages ' + (plan.upper.mode === 'gravity' ? 'continue the gravity turn' : plan.upper.mode === 'hold' ? 'hold ' + fmt(plan.upper.startDeg, 4) + ' deg above the horizon' : 'pitch from ' + fmt(plan.upper.startDeg, 4) + ' to ' + fmt(plan.upper.endDeg, 4) + ' deg above the horizon, linear in time') + '. Open loop: no guidance (module 36).',
        ].concat(extra.assumptions || []) };
      var O = out.outputs, src = KERNEL + ' fly()';
      (h34.refusals || []).forEach(function (x) { if (x.applies_to !== 'losses') out.refusals.push(Object.assign({ from: x.from || '34-stack' }, x)); });
      if (!r.ok) { r.refusals.forEach(function (x) { out.refusals.push(x); }); return out; }
      var f = r.final, o = r.orbit;
      O.burnout_state = qv({ t_s: f.t, r_m: f.r, v_m_s: f.v, mass_kg: f.mass }, 's, m, m/s, kg', 'derived', src + ' (ECI at liftoff, see assumptions)');
      O.burnout_altitude = qv(f.altitude, 'm', 'derived', src + ' (above the sphere)');
      O.burnout_speed_inertial = qv(f.speed, 'm/s', 'derived', src);
      O.burnout_speed_earth_fixed = qv(f.speedEarthFixed, 'm/s', 'derived', src);
      O.burnout_flight_path_angle = qv(f.fpaDeg, 'deg', 'derived', src + ' (space-fixed)');
      O.burnout_heading = qv(f.headingDeg, 'deg', 'derived', src + ' (space-fixed, from north toward east)');
      O.burnout_latitude = qv(f.latitudeDeg, 'deg', 'derived', src + ' (geocentric)');
      O.burnout_mass = qv(f.mass, 'kg', 'derived', src + ' (idea 34\'s ledger, flown)');
      O.orbit = qv({ bound: o.bound, semi_major_axis_m: o.a, eccentricity: o.e, inclination_deg: o.inclinationDeg, perigee_altitude_m: o.perigeeAlt, apogee_altitude_m: o.apogeeAlt, period_s: o.period, c3_m2_s2: o.c3 }, 'm, deg, s', 'derived', KERNEL + ' orbitOf() (two-body, Aster GM)');
      O.max_dynamic_pressure = qv(r.maxQ.q, 'Pa', 'derived', src); O.max_dynamic_pressure_time = qv(r.maxQ.t, 's', 'derived', src); O.max_dynamic_pressure_altitude = qv(r.maxQ.h, 'm', 'derived', src);
      if (r.mach1) O.mach_1_time = qv(r.mach1.t, 's', 'derived', src);
      O.delta_v_ideal_flown = qv(r.losses.ideal, 'm/s', 'derived', src + ' (integral of F_vac/m: idea 34\'s ideal delta-v for the burns flown, at this plan\'s throttle)');
      var LR = r.lossesRel, LI = r.losses, rs = src + ' (against the Earth-relative speed: ideal - losses + centrifugal = Earth-relative burnout speed)';
      O.loss_gravity = qv(LR.gravity, 'm/s', 'derived', rs); O.loss_drag = qv(LR.drag, 'm/s', 'derived', rs);
      O.loss_steering = qv(LR.steering, 'm/s', 'derived', rs); O.loss_back_pressure = qv(LI.pressure, 'm/s', 'derived', src);
      O.centrifugal_gain = qv(LR.centrifugal, 'm/s', 'derived', rs);
      O.loss_budget_inertial = qv({ gravity: LI.gravity, drag: LI.drag, steering: LI.steering, back_pressure: LI.pressure, gain_in_inertial_speed: r.gainInertial }, 'm/s', 'derived', src + ' (the same flight against the inertial speed: ideal - losses = inertial speed gained since the pad)');
      O.earth_rotation_speed = qv(r.rotationGain, 'm/s', 'derived', src + ' (the pad\'s inertial speed)');
      O.stage_cutoffs = qv(r.stageEnds.map(function (e) { var s = e.state; return { stage: e.label, burn: e.burn + 1, t_s: e.t, burn_time_s: e.burnTime, altitude_m: s.altitude, speed_m_s: s.speed, flight_path_angle_deg: s.fpaDeg, mass_kg: s.mass }; }), 's, m, m/s, deg, kg', 'derived', src);
      O.remaining_burns = qv(r.remainingBurns, 'kg', 'derived', src + ' (burns not flown here: from a parking orbit, an Earth-departure burn is module 38\'s)');
      r.refusals.forEach(function (x) { out.refusals.push(x); });
      if (veh.id !== 'AS-512' && plan.drag !== 'none') out.refusals.push({ applies_to: 'drag', code: 'insufficient_data', reason: 'This vehicle\'s drag coefficient is the Saturn V\'s (the only wind-tunnel curve here), scaled by its diameter.', what_would_help: 'A wind-tunnel or CFD axial-force curve for this vehicle\'s shape.' });
      out.refusals.push({ applies_to: 'guidance', code: 'insufficient_data', reason: 'Open-loop steering: the orbit reached is what this pitch plan gives, not a target orbit.', what_would_help: 'Module 36 (Closed Loop) flies the same vehicle to a chosen orbit with guidance.' });
      return out;
    }
    /** Read this module's own handoff back: the 34 handoff inside is re-checked, the ascent re-flown with the plan, and
     * the headline outputs must agree to 1e-6 (they are integrated, so not to the last bit across engines). */
    function parseHandoff(input) {
      var h = input;
      if (typeof input === 'string') { try { h = JSON.parse(input); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 34 or idea 35.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 34 or idea 35.') };
      if (h.from !== '35-max-q') return vehicleFromHandoff(h);
      var inner = h.inputs && h.inputs.vehicle_handoff, plan = h.inputs && h.inputs.plan;
      if (!inner || !plan) return { refusal: refusal('invalid_input', 'This 35-max-q handoff carries no vehicle or plan.', 'A handoff exported by this page.') };
      var v = vehicleFromHandoff(inner);
      if (v.refusal) return v;
      var r = fly(v.vehicle, v.engines, plan, { samples: false }), O = h.outputs || {};
      if (r.ok && O.burnout_speed_inertial) {
        var chk = [['burnout_speed_inertial', r.final.speed], ['burnout_altitude', r.final.altitude], ['max_dynamic_pressure', r.maxQ.q]];
        for (var i = 0; i < chk.length; i++) if (!O[chk[i][0]] || off(O[chk[i][0]].value, chk[i][1], 1e-6)) return { refusal: refusal('invalid_input', 'The ascent handoff says ' + chk[i][0] + ' = ' + fmt(O[chk[i][0]] && O[chk[i][0]].value, 9) + ', but flying its own vehicle and plan gives ' + fmt(chk[i][1], 9) + ': it was edited.', 'The unedited handoff this page exported.') };
      }
      return { vehicle: v.vehicle, engines: v.engines, handoff34: inner, plan: plan, result: r };
    }

    return {
      axialCoefficient: axialCoefficient, atmosphere: atmosphere, engineFromOut: engineFromOut, vehicleFromHandoff: vehicleFromHandoff,
      ascentBurns: ascentBurns, launchPlane: launchPlane, planeFrame: planeFrame, defaultPlan: defaultPlan, validatePlan: validatePlan, padState: padState, localFrame: localFrame,
      deriv: deriv, integrate: integrate, fly: fly, stateOf: stateOf, orbitOf: orbitOf, solveKick: solveKick, solveInsertion: solveInsertion,
      as512Rows: as512Rows, as512FlowScale: as512FlowScale, as512Coasts: as512Coasts, as512T0: as512T0, makeHandoff: makeHandoff, parseHandoff: parseHandoff,
      constants: { MU: MU, RE: RE, OMEGA: OMEGA, ATM_TOP: ATM_TOP, P0: P0, D_SATURN: D_SATURN, NY: NY },
    };
  }

  return { create: create, DEG: DEG };
});
