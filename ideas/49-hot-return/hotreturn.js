/* Hot Return: the sample capsule's way down. Idea 49 of the Aster Idea Bank, module 19 of "The Long Way Round".
 *
 * Idea 48 chose how the asteroid's material stops at the Earth and handed on the state at the entry interface, the
 * vehicle and the convective heating it screened with. This module flies that entry all the way to the ground: every
 * atmospheric pass, the radiative heating the screen left out, the heat shield's surface recession and surface
 * temperature, whether a flown heat shield covers it, the parachute sequence (G-switch, timers, baroswitch, canopy
 * filling), the touchdown speed and place, and the mass that lands. It hands module 50 the landed mass, the peak loads
 * and the timeline.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, Pa, W/m^2, K). Time: seconds after the entry interface, and
 * TDB seconds past J2000 where the arrival carries an epoch (UTC = TDB - 69.184 s, as ideas 39 to 48). Frame: idea 48's
 * (geocentric ICRF/J2000 axes, air turning about the ICRF z axis, altitude above pck00010's spheroid).
 *
 * Reused unmodified (snapshots/): idea 48's kernel catch.js (fly(), flyPasses(), coastTo(), the vehicles, the flown
 * capsules' entry states, Sutton & Graves's convective heating, the 1976 atmosphere through PartForge's isa()) with its
 * own snapshots, and idea 48's committed handoff. New here: the radiative heating (Suttles, Sullivan & Margolis, NASA
 * TN D-7622), the PICA recession law (diffusion-limited, its one constant from Stardust's arc-jet tests), the radiative-
 * equilibrium wall temperature, the heritage check against Stardust's heat shield, the parachute sequence and canopy
 * sizing, the landing and the mass ledger, the comparison with three flown capsules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HotReturn = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180;
  var KERNEL = '49-hot-return/hotreturn.js';

  function refusal(code, reason, help, extra) {
    var r = { code: code, reason: reason, what_would_help: help };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) { return num(v) ? +v.toPrecision(d || 4) + '' : String(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function utcOf(tdb) { return new Date(Date.UTC(2000, 0, 1, 12) + (tdb - 69.184) * 1000).toISOString(); }
  function tdbOf(utc) { return (Date.parse(utc) - Date.UTC(2000, 0, 1, 12)) / 1000 + 69.184; }

  function create(deps) {
    deps = deps || {};
    var CatchMod = deps.Catch, CD = deps.catchDeps, S = deps.sources, CH = deps.chain;
    if (!CatchMod || !CD || !S) throw new Error('HotReturn.create: needs Catch, catchDeps and sources');
    var K = CatchMod.create(CD), ISA = CD.isa;
    var MU = K.MU, RE = K.RE, G0 = K.G0, OMEGA = K.OMEGA, ATM_TOP = K.ATM_TOP, GAMMA = ISA.ISA_GAMMA;
    var SD = S.stardust, GN = S.genesis, OX = S.osirisrex, PICA = S.pica, SUT = S.suttles, SIGMA = S.sigma_W_m2_K4;
    var CHAIN_H = CH ? CH.handoff : null, CHAIN_DIGEST = CH ? CH.digest : null;
    var DT = K.FLY.dt;                       // idea 48's 0.1 s step, kept for every flight here
    var DT_FILL = 0.01;                      // canopy filling is flown at a tenth of it (a test checks the step)

    // ---------------------------------------------------------------- the PICA recession law
    // Diffusion-limited oxidation of the char: the surface mass flux is proportional to the mass-transfer coefficient,
    // which for a cold-wall convective heat flux q into a stream of total enthalpy h0 is q/h0, so m_dot = B' q/h0 with B'
    // fixed by the oxygen at the edge (the same air in an arc jet and in flight). B' is taken from Stardust's own
    // qualification tests (Covington 2005): the measured average recession rates at 400 and 580 W/cm^2, 29.5 MJ/kg,
    // on 0.266 g/cm^3 PICA. Expressed per unit virgin density, so the recession is m_dot / rho_shield.
    var AJ = PICA.arcjet, RHO_SD = PICA.stardust_density_kg_m3;
    var B400 = RHO_SD * AJ.recession_400_m_s / (AJ.q400_W_m2 / AJ.h0_J_kg);
    var B580 = RHO_SD * AJ.recession_580_m_s / (AJ.q580_W_m2 / AJ.h0_J_kg);
    var BPRIME = (B400 + B580) / 2, BPRIME_SPREAD = Math.abs(B580 - B400) / 2;
    // The law holds while the char oxidises at the rate oxygen arrives: arc-jet comparisons put that regime at surface
    // temperatures of 1600-3100 K (Johnston et al.). Below 1600 K (radiative-equilibrium wall) no recession is counted.
    var T_OX = PICA.oxidation_T_min_K;
    var P_ATM = S.sutton_graves ? S.sutton_graves.atm_Pa : CD.sources.sutton_graves.atm_Pa;   // 101,325 Pa (Sutton & Graves's own conversion, via idea 48)
    function h0Of(V, a) { return V * V / 2 + (num(a) ? a * a / (GAMMA - 1) : 0); }   // total enthalpy: kinetic + c_p T (c_p T = a^2/(gamma-1))

    // ---------------------------------------------------------------- radiative heating (Suttles et al., TN D-7622)
    // q_R = exp(A1) rho^(A2 + A3 V) R^(A4 + A5 V + A6 V^2) V^(A7 + A8 V + A9 V^2), W/cm^2, with rho in g/cm^3, R in cm and
    // V in km/s: an equilibrium, radiatively coupled, inviscid stagnation-point calculation fitted over 11-16 km/s,
    // 53.75-68.4 km and 30-450 cm. Outside those ranges the fit is extrapolated and every sample says so.
    var A = [SUT.A1, SUT.A2, SUT.A3, SUT.A4, SUT.A5, SUT.A6, SUT.A7, SUT.A8, SUT.A9], RNG = SUT.range;
    function suttles(V, rho, Rn) {
      if (!(V > 0 && rho > 0 && Rn > 0)) return { q: 0, inside: true };
      var v = V / 1000, p = rho * 1e-3, R = Rn * 100;
      var ln = A[0] + (A[1] + A[2] * v) * Math.log(p) + (A[3] + A[4] * v + A[5] * v * v) * Math.log(R) + (A[6] + A[7] * v + A[8] * v * v) * Math.log(v);
      var inside = V >= RNG.v_min_m_s && V <= RNG.v_max_m_s && rho >= RNG.rho_min_kg_m3 && rho <= RNG.rho_max_kg_m3 && Rn >= RNG.rn_min_m && Rn <= RNG.rn_max_m;
      return { q: Math.exp(ln) * 1e4, inside: inside };
    }

    // ---------------------------------------------------------------- the wall: radiative equilibrium
    // eps(T) sigma T^4 = q_conv + q_rad, the cold-wall heating, with PICA's emissivity as FIAT models it (0.858 at 250 K to
    // 0.93 at 3500 K; linear between, held outside). An upper bound on the surface temperature: no conduction into the
    // shield, no blowing, no ablation energy.
    var EM = PICA.emissivity;
    function emissivity(T) { var f = (T - EM.t_lo_K) / (EM.t_hi_K - EM.t_lo_K); f = Math.max(0, Math.min(1, f)); return EM.e_lo + f * (EM.e_hi - EM.e_lo); }
    function wallT(q) {
      if (!(q > 0)) return null;
      var lo = 0, hi = 1e4;
      for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (emissivity(m) * SIGMA * m * m * m * m < q) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }

    // ---------------------------------------------------------------- shapes: the heat shield's wetted area
    // A sphere-cone (the 60 deg forebody of Stardust, Genesis and OSIRIS-REx): a spherical cap of radius Rn meeting a cone of
    // half-angle theta tangentially at r_t = Rn cos(theta), then the frustum to the base radius. Other shapes: the frontal
    // area (a flat-shield lower bound), stated.
    var CONE_DEG = 60;   // "the same 60 degree half-angle forebody as Stardust" (OSIRIS-REx EDL performance, via idea 48)
    function wetArea(veh) {
      var Rb = veh.diameter_m / 2, Rn = veh.rn_m;
      if (veh.sphere_cone) {
        var th = CONE_DEG * DEG, rt = Rn * Math.cos(th);
        var cap = 2 * PI * Rn * Rn * (1 - Math.sin(th));
        var L = (Rb - rt) / Math.sin(th);
        return { m2: cap + PI * (Rb + rt) * L, basis: '60 deg sphere-cone: spherical cap of the nose radius plus the cone frustum to the base' };
      }
      return { m2: veh.area_m2, basis: 'frontal area (the shield\'s curvature is not on file: a lower bound)' };
    }
    // Stardust's measured recession profile (X-ray CT): 6-6.5 mm at the apex, about 3 mm near the outside radii, near-
    // linear in between. Linear in radius over the projected disk, the area-weighted mean is 1 - (1 - edge/apex) 2/3 of
    // the apex value.
    var CT = SD.ct, APEX = (CT.recession_lo_m + CT.recession_hi_m) / 2;
    var PROFILE = 1 - (1 - CT.recession_edge_m / APEX) * 2 / 3;

    // ---------------------------------------------------------------- the atmosphere's pressure (baroswitches)
    function pressureAt(h) { if (!(h < ATM_TOP)) return 0; return ISA.isa(h).P_Pa; }
    function altOfPressure(P) {   // the altitude where the 1976 atmosphere has pressure P
      var lo = -2000, hi = ATM_TOP - 1;
      for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (pressureAt(m) > P) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }

    // ---------------------------------------------------------------- vehicles and capsules
    // Idea 48's shapes (sphere_cone marked here); the flown capsules' heat shields and parachutes.
    var CAPSULES = {
      stardust: { label: 'Stardust (15 Jan 2006)', vehicle: 'stardust', shield: 'pica', ground_alt_m: SD.ground_alt_m, ground_note: 'UTTR: Stardust\'s nominal main deploy at 3.1 km MSL was 1.8 km above ground',
        trigger_g: SD.trigger_g, drogue_timer_s: SD.drogue_timer_s, main_timer_s: SD.main_timer_s, main_timer_from: 'drogue', baro_Pa: SD.baro_Pa, flown: 'nominal', ei_utc: SD.ei_utc, own_canopies: true },
      osirisrex: { label: 'OSIRIS-REx (24 Sep 2023)', vehicle: 'osirisrex', shield: 'pica', ground_alt_m: OX.ground_alt_m, ground_note: 'touchdown at UTTR at a geodetic altitude of 1288 m',
        trigger_g: SD.trigger_g, drogue_timer_s: OX.drogue_timer_s, main_timer_s: OX.main_timer_s, main_timer_from: 'trigger', baro_Pa: pressureAt(OX.baro_alt_m), flown: 'no_drogue', ei_utc: OX.ei_utc, own_canopies: true },
      // Genesis's main was on a timer, 254.0 s after the drogue (review: it used to open at a pressure switch set to its
      // nominal 24,400 ft, which Genesis did not have); its own canopies are not on file, so with parachutes it is sized
      genesis: { label: 'Genesis (8 Sep 2004)', vehicle: 'genesis', shield: 'carbon-carbon', ground_alt_m: GN.ground_alt_m, ground_note: 'UTTR: Genesis\'s planned backup touchdown at 4,200 ft MSL',
        trigger_g: SD.trigger_g, drogue_timer_s: GN.drogue_timer_s, main_timer_s: GN.main_timer_s, main_timer_from: 'drogue', baro_Pa: null, flown: 'none', ei_utc: null, own_canopies: false }
    };
    var SOURCES = ['chain', 'imported', 'stardust', 'osirisrex', 'genesis'];
    var CHUTES = ['nominal', 'no_drogue', 'none'];
    function vehicleOf(id, massKg) { var v = K.vehicle(id, massKg); if (!v) return null; v.sphere_cone = id !== 'apollo'; return v; }

    // ---------------------------------------------------------------- flights: fly to an event, then stop there exactly
    // fly() (idea 48) runs to the ground; the event is found between two of its 0.1 s samples by linear interpolation and
    // the flight is flown again with tStop at that time, so the state handed on is fly()'s own.
    function flyAll(x, veh, o) { var oo = { bankDeg: 0, dt: DT, vStop: 0, tMax: 20000, sampleEvery: DT }; for (var k in o) oo[k] = o[k]; return K.fly(x, veh, oo); }
    function eventTime(samples, test, after) {
      for (var i = 1; i < samples.length; i++) {
        var a = samples[i - 1], b = samples[i];
        if (num(after) && b.t <= after) continue;
        var fa = test(a), fb = test(b);
        if (fa <= 0 && fb > 0) return a.t + (b.t - a.t) * (-fa) / (fb - fa);
      }
      return null;
    }
    // A pressure switch armed at the first of these samples fires when the pressure reaches its setting, at once if it is
    // already there (review: a setting already passed when the switch was armed used to wait for the timer instead).
    function baroTime(samples, P) {
      if (!num(P) || !samples.length) return null;
      if (pressureAt(samples[0].h) >= P) return samples[0].t;
      return eventTime(samples, function (s) { return pressureAt(s.h) - P; });
    }
    function flyUntil(x, veh, o, tStop) { var oo = { bankDeg: 0, dt: DT, vStop: 0, tMax: 20000, sampleEvery: DT, tStop: tStop }; for (var k in o) oo[k] = o[k]; return K.fly(x, veh, oo); }
    // A canopy filling over tFill: the drag area grows linearly from cds0 to cds1 (an assumption: the fill times are
    // OSIRIS-REx's, measured on video; the shape of the growth is not on file). Flown in DT_FILL (0.01 s) segments, each
    // one RK4 step at the segment's mid-point area; the peak includes the instant the canopy is full.
    function flyFill(x, mass, cds0, cds1, tFill, bank) {
      var seg = DT_FILL, n = Math.max(1, Math.round(tFill / seg)), out = { samples: [], peak_g: 0, t_peak_g: null }, t = 0, st = { r: x.r, v: x.v };
      for (var i = 0; i < n; i++) {
        var f = (i + 0.5) / n, veh = { mass_kg: mass, area_m2: 1, cd: cds0 + f * (cds1 - cds0), cl: 0, rn_m: 0 };
        var g = K.fly(st, veh, { bankDeg: bank || 0, dt: DT_FILL, vStop: 0, tStop: tFill / n, tMax: tFill, sampleEvery: DT_FILL });
        for (var j = 0; j < g.samples.length; j++) { var s = g.samples[j]; if (j === 0 && i > 0) continue; out.samples.push({ t: t + s.t, h: s.h, V: s.V, g: s.g, q: s.q, M: s.M }); if (s.g > out.peak_g) { out.peak_g = s.g; out.t_peak_g = t + s.t; } }
        t += g.t; st = { r: g.r, v: g.v }; out.end = g.end;
        if (g.end === 'ground') break;
      }
      // the instant the canopy is full (the drag area reaches cds1 at the end of the fill)
      var info = {}; K.deriv(st.r, st.v, { mass_kg: mass, area_m2: 1, cd: cds1, cl: 0, rn_m: 0 }, 1, 0, null, info);
      if (info.g > out.peak_g) { out.peak_g = info.g; out.t_peak_g = t; }
      out.t = t; out.r = st.r; out.v = st.v; return out;
    }

    // ---------------------------------------------------------------- settings
    function defaults() {
      return { source: 'chain', chutes: 'auto', radiative: true, shield_density: RHO_SD, touchdown_m_s: OX.touchdown_v_m_s, ground_alt_m: 'auto',
        trigger_g: SD.trigger_g, drogue_timer_s: 'auto', main_baro_Pa: 'auto', main_timer_s: 'auto' };
    }
    function validSettings(Sin) {
      function bad(w, h) { return { refusal: refusal('invalid_input', w, h) }; }
      var raw = Sin || {};
      for (var rk in raw) if (typeof raw[rk] === 'number' && !isFinite(raw[rk])) return bad('"' + rk + '" is not a finite number.', 'A number, or "auto" where it is allowed.');
      var D0 = defaults(), Sx = clone(raw);
      for (var k in D0) if (Sx[k] === undefined) Sx[k] = D0[k];
      if (SOURCES.indexOf(Sx.source) < 0) return bad('Unknown source "' + Sx.source + '".', 'One of ' + SOURCES.join(', ') + '.');
      if (Sx.chutes !== 'auto' && CHUTES.indexOf(Sx.chutes) < 0) return bad('Unknown parachute mode "' + Sx.chutes + '".', 'auto (as flown, or nominal for the chain) or one of ' + CHUTES.join(', ') + '.');
      if (typeof Sx.radiative !== 'boolean') return bad('"radiative" must be true or false.', 'true counts the radiative heating, false shows the convective-only picture idea 48 screened with.');
      if (!(num(Sx.shield_density) && Sx.shield_density >= 100 && Sx.shield_density <= 2000)) return bad('The heat-shield density must be 100 to 2,000 kg/m³.', 'Stardust\'s PICA was 266 kg/m³, MSL-grade PICA 274.');
      if (!(num(Sx.touchdown_m_s) && Sx.touchdown_m_s >= 1 && Sx.touchdown_m_s <= 30)) return bad('The touchdown speed must be 1 to 30 m/s.', 'OSIRIS-REx\'s 4.5 m/s.');
      // 0 m is the floor: idea 48's fly() stops at the spheroid (review: -500 m used to pass here and then always refuse)
      if (Sx.ground_alt_m !== 'auto' && !(num(Sx.ground_alt_m) && Sx.ground_alt_m >= 0 && Sx.ground_alt_m <= 6000)) return bad('The ground altitude must be 0 to 6,000 m (or auto): the flight (idea 48\'s fly()) stops at the spheroid, so ground below it is never reached.', 'UTTR is about 1.3 km; the sea is 0.');
      if (!(num(Sx.trigger_g) && Sx.trigger_g >= 0.5 && Sx.trigger_g <= 20)) return bad('The G-switch threshold must be 0.5 to 20 g.', 'Stardust\'s and OSIRIS-REx\'s 3 g.');
      if (Sx.drogue_timer_s !== 'auto' && !(num(Sx.drogue_timer_s) && Sx.drogue_timer_s >= 0 && Sx.drogue_timer_s <= 600)) return bad('The drogue timer must be 0 to 600 s (or auto).', 'Stardust\'s 15.04 s.');
      if (Sx.main_baro_Pa !== 'auto' && !(num(Sx.main_baro_Pa) && Sx.main_baro_Pa >= 1000 && Sx.main_baro_Pa <= 101000)) return bad('The main baroswitch pressure must be 1 to 101 kPa (or auto).', 'Stardust\'s 10.11 psi (69.7 kPa, about 3 km).');
      if (Sx.main_timer_s !== 'auto' && Sx.main_timer_s !== null && !(num(Sx.main_timer_s) && Sx.main_timer_s > 0 && Sx.main_timer_s <= 3600)) return bad('The main timer must be above 0 and at most 3,600 s, null (none) or auto.', 'Stardust\'s 350.6 s after the drogue.');
      return { S: Sx };
    }

    // ---------------------------------------------------------------- idea 48's handoff
    // Checked without re-running idea 48 (its kernel's option comparison takes a second and its chain data 100 KB more):
    // the envelope, the choice ends on the ground, the entry state's own numbers agree with each other, the vehicle is one
    // of idea 48's shapes, and, the strong check, flying that state with idea 48's own fly() at its bank reproduces the
    // peak deceleration, peak heating and heat load idea 48 screened, to 1e-6.
    function bad48(why) { return { refusal: refusal('invalid_input', why, 'A handoff exported by idea 48 (Catch) or by this page.') }; }
    function rel(a, b) { return Math.abs(a - b) / Math.max(1e-30, Math.abs(b)); }
    function importCatch(h) {
      if (!h || h.handoff !== 'long-way-round' || h.from !== '48-catch') return bad48('That is not idea 48\'s handoff.');
      if (h.version !== 1) return bad48('Version ' + h.version + ' is not one this page reads.');
      var O = h.outputs || {}, cap = O.capture && O.capture.value, ei = O.entry_interface && O.entry_interface.value, vv = O.vehicle && O.vehicle.value, sc = O.screening && O.screening.value, ms = O.mass && O.mass.value;
      if (!cap || !vv || !ms) return bad48('The handoff lacks capture, vehicle or mass.');
      if (!cap.choice) return { refusal: refusal('out_of_envelope', 'Idea 48 found no feasible way to stop this arrival, so there is no entry to fly.', 'A slower arrival or higher limits in idea 48.', { applies_to: 'capture' }) };
      if (cap.destination !== 'ground') return { refusal: refusal('out_of_envelope', 'Idea 48\'s choice (' + cap.choice + ') ends ' + (cap.destination === 'orbit' ? 'in orbit' : 'on the tether') + ', not with an entry to the ground: this page flies entries.', 'Choose direct entry or skip entry in idea 48, or carry on from orbit with a separate deorbit (not modelled here).', { applies_to: 'capture' }) };
      if (!ei || !Array.isArray(ei.r_m) || !Array.isArray(ei.v_m_s) || !sc) return bad48('The handoff carries no entry state or screening.');
      if (O.entry_interface.units !== 'm, m/s, deg, s' || O.vehicle.units !== 'kg, m^2, m') return bad48('Units are not the ones idea 48 writes.');
      var r = ei.r_m, v = ei.v_m_s, tol = 1e-6;
      if (rel(norm(v), ei.speed_inertial_m_s) > tol) return bad48('The entry speed does not match the velocity vector: edited.');
      if (rel(norm(K.vrelOf(r, v)), ei.speed_relative_m_s) > tol) return bad48('The air-relative speed does not match the state: edited.');
      if (Math.abs(norm(r) - RE - ei.altitude_m) > 1e-3 * Math.max(1, Math.abs(ei.altitude_m)) * 1e-3 + 1e-3) return bad48('The interface altitude does not match the position: edited.');
      if (Math.abs(K.angles(r, v).fpa - ei.fpa_inertial_deg) > 1e-6) return bad48('The flight-path angle does not match the state: edited.');
      var veh = vehicleOf(vv.id, vv.mass_kg);
      if (!veh) return bad48('Vehicle "' + vv.id + '" is not one of idea 48\'s.');
      if (rel(veh.area_m2, vv.area_m2) > tol || rel(veh.diameter_m, vv.diameter_m) > tol || rel(veh.rn_m, vv.nose_radius_m) > tol || JSON.stringify(veh.cd) !== JSON.stringify(vv.cd) || veh.cl !== vv.cl) return bad48('The vehicle\'s shape is not idea 48\'s ' + vv.id + ': edited.');
      if (rel(vv.mass_kg, ms.entry_kg) > tol) return bad48('The vehicle mass and the entry mass disagree: edited.');
      var x0 = { r: r.slice(), v: v.slice() };
      var P = K.flyPasses(x0, veh, { bankDeg: vv.bank_deg, dt: K.FLY.dt, vStop: K.FLY.vStop }, 6);
      var pg = Math.max.apply(null, P.map(function (p) { return p.peak_g; })), pq = Math.max.apply(null, P.map(function (p) { return p.peak_q || 0; })), hl = P.reduce(function (s, p) { return s + p.heat_J_m2; }, 0);
      if (rel(pg, sc.peak_g) > tol || rel(pq, sc.peak_q_W_m2) > tol || rel(hl, sc.heat_load_J_m2) > tol || P.length !== sc.passes) return bad48('Flying its entry state with idea 48\'s own kernel does not give the loads it screened (' + fmt(pg, 7) + ' g against ' + fmt(sc.peak_g, 7) + ', ' + P.length + ' passes against ' + sc.passes + '): edited, or made with other data.');
      var st48 = h.inputs && h.inputs.settings, flown = st48 && CAPSULES[st48.arrival] ? st48.arrival : null;
      return { kind: 'catch', icrf: true, h48: h, x0: x0, veh: veh, bank: vv.bank_deg, tdb: num(ei.tdb_s_past_j2000) ? ei.tdb_s_past_j2000 : null, choice: cap.choice, screening: sc, mass: ms, flown: flown,
        carried: (h.refusals || []).map(clone), assumed: (vv.assumed || []).slice() };
    }
    function capsuleArrival(id) {
      var C = CAPSULES[id], A = K.arrivalFromFlight(id), veh = vehicleOf(C.vehicle);
      return { kind: 'capsule', icrf: false, id: id, capsule: C, x0: A.x0, veh: veh, bank: 0, tdb: C.ei_utc ? tdbOf(C.ei_utc) : null, choice: 'direct', screening: null,
        mass: { entry_kg: veh.mass_kg, material_kg: null }, carried: [], assumed: A.assumed.concat(veh.assumed) };
    }

    // ---------------------------------------------------------------- the flight to the ground
    function plan(Sx, arr) {
      var C = arr.kind === 'capsule' ? arr.capsule : null;
      var mode = Sx.chutes === 'auto' ? (C ? C.flown : 'nominal') : Sx.chutes;
      var ground = Sx.ground_alt_m === 'auto' ? (C ? C.ground_alt_m : 0) : Sx.ground_alt_m;
      var drogueT = Sx.drogue_timer_s === 'auto' ? (C ? C.drogue_timer_s : SD.drogue_timer_s) : Sx.drogue_timer_s;
      var baro = Sx.main_baro_Pa === 'auto' ? (C ? C.baro_Pa : SD.baro_Pa) : Sx.main_baro_Pa;
      var mainT = Sx.main_timer_s === 'auto' ? (C ? C.main_timer_s : SD.main_timer_s) : Sx.main_timer_s;
      var from = C ? (C.main_timer_from || 'drogue') : 'drogue';
      return { mode: mode, ground: ground, ground_note: C ? C.ground_note : (Sx.ground_alt_m === 'auto' ? 'sea level: no landing site is chosen' : 'yours'), trigger_g: Sx.trigger_g, drogue_timer_s: drogueT, baro_Pa: baro, main_timer_s: mainT, main_timer_from: from };
    }
    // The SRC's canopies, from flight (no canopy drag coefficient is on file):
    //  drogue: the drag area (capsule + drogue) that takes Stardust from its drogue deployment at 31.03 km to its main
    //    deployment at 3.428 km in the 331.3 s radar saw;
    //  main: the drag area that lands OSIRIS-REx at the 4.5 m/s its EDL team predicted, at UTTR's 1,288 m.
    var SRC = null;
    function ablatedOnBody(arr, f) {   // the PICA mass lost on a body-only flight (the heating does not depend on the parachutes)
      var H = heating({ series: f.samples }, arr.veh, defaults());
      return H.mass_loss_stag * wetArea(arr.veh).m2 * PROFILE;
    }
    function srcCanopies() {
      if (SRC) return SRC;
      var A = capsuleArrival('stardust'), f = flyAll(A.x0, A.veh, {});
      var t31 = eventTime(f.samples, function (s) { return SD.drogue_alt_m - s.h; });
      var g = flyUntil(A.x0, A.veh, {}, t31), x31 = { r: g.r, v: g.v };
      var mass = A.veh.mass_kg - ablatedOnBody(A, f);
      function tTo(cds) { var d = flyAll(x31, { mass_kg: mass, area_m2: 1, cd: cds, cl: 0, rn_m: 0 }, {}); return eventTime(d.samples, function (s) { return SD.main_alt_m - s.h; }); }
      var lo = 0.05, hi = 5;   // m^2: a larger drag area falls more slowly
      if (!(tTo(lo) < SD.main_after_drogue_s && tTo(hi) > SD.main_after_drogue_s)) throw new Error('srcCanopies: the drogue fit does not bracket');
      for (var i = 0; i < 60; i++) { var m = Math.sqrt(lo * hi); if (tTo(m) > SD.main_after_drogue_s) hi = m; else lo = m; }
      var drogue = Math.sqrt(lo * hi);
      var ox = capsuleArrival('osirisrex'), fo = flyAll(ox.x0, ox.veh, {}), mOx = ox.veh.mass_kg - ablatedOnBody(ox, fo), rhoG = ISA.isa(OX.ground_alt_m).rho_kg_m3;
      var main = 2 * mOx * G0 / (rhoG * OX.touchdown_v_m_s * OX.touchdown_v_m_s);
      SRC = { drogue_cds_m2: drogue, drogue_mass_kg: mass, drogue_d_m: OX.drogue_d_m, drogue_cd_nominal: drogue / (PI * OX.drogue_d_m * OX.drogue_d_m / 4),
        main_cds_m2: main, main_mass_kg: mOx, main_d_m: OX.main_d_m, main_cd_nominal: main / (PI * OX.main_d_m * OX.main_d_m / 4),
        fill_drogue_s: OX.observed.drogue_inflated_s - OX.observed.drogue_mortar_s, fill_main_s: OX.observed.main_inflated_s - OX.observed.main_bag_strip_s,
        basis: 'drogue: Stardust 31.03 -> 3.428 km in 331.3 s (radar); main: OSIRIS-REx 4.5 m/s predicted touchdown at 1,288 m; fill times: OSIRIS-REx video (drogue mortar fire to full inflation, main bag strip to full inflation)' };
      return SRC;
    }
    // The capsule's own drag below Mach 0.85 when nothing holds it steady (no drogue): Genesis's reconstructed tumbling C_D.
    function tumblingVehicle(veh) {
      var v = clone(veh), cdHi = K.cdOf(veh, GN.tumble_mach + 1e-3);
      var tab = typeof veh.cd === 'number' ? { mach: [GN.tumble_mach], value: [veh.cd] } : clone(veh.cd);
      v.cd = { mach: [GN.tumble_mach - 1e-3, GN.tumble_mach].concat(tab.mach.filter(function (m) { return m > GN.tumble_mach; })), value: [GN.tumble_cd, cdHi].concat(tab.value.filter(function (_, i) { return tab.mach[i] > GN.tumble_mach; })) };
      return v;
    }

    function descend(arr, Sx) {
      var P = plan(Sx, arr), veh = arr.veh, ev = [];
      // 1. every pass, to the ground with no parachute (the triggers are found on this flight)
      var passes = K.flyPasses(arr.x0, veh, { bankDeg: arr.bank, dt: DT, vStop: 0, sampleEvery: DT, tMax: 20000 }, 6);
      var last = passes[passes.length - 1], tOff = last.t_start, xLast = arr.x0;
      if (passes.length > 1) { var prev = passes[passes.length - 2], c = K.coastTo(prev.r, prev.v, RE + ATM_TOP, true); xLast = { r: c.r, v: c.v }; }
      if (last.end === 'exit') return { refusal: refusal('out_of_envelope', 'After ' + passes.length + ' passes the vehicle still leaves the atmosphere.', 'A steeper entry (idea 48).', { applies_to: 'entry' }), passes: passes };
      var series = [];   // the whole flight, time from the entry interface
      function addSeries(samples, t0, phase) { for (var i = 0; i < samples.length; i++) { var s = samples[i]; if (series.length && t0 + s.t <= series[series.length - 1].t + 1e-9) continue; series.push({ t: t0 + s.t, h: s.h, V: s.V, g: s.g, q: s.q, M: s.M, phase: phase }); } }
      for (var i = 0; i < passes.length - 1; i++) addSeries(passes[i].samples, passes[i].t_start, 'pass ' + (i + 1));
      var lastSamples = last.samples, peakT = last.t_peak_g;
      var vehBody = P.mode === 'nominal' ? veh : (arr.kind === 'capsule' ? tumblingVehicle(veh) : veh);
      if (vehBody !== veh) { var fb = flyAll(xLast, vehBody, { bankDeg: arr.bank }); lastSamples = fb.samples; last = fb; }
      var lastPeakG = Math.max.apply(null, lastSamples.map(function (s) { return s.g || 0; }));
      // 2. the G-switch: deceleration falling back through the threshold after the last pass's peak
      var tTrig = eventTime(lastSamples, function (s) { return P.trigger_g - s.g; }, peakT);
      var out = { plan: P, passes: passes, events: ev, series: series, chutes: null };
      var landWith = function (samples, t0, x, vehNow, phase) {
        var tg = eventTime(samples, function (s) { return P.ground - s.h; });
        if (!num(tg)) return null;
        var f = flyUntil(x, vehNow, { bankDeg: phase === 'body' ? arr.bank : 0 }, tg);
        addSeries(f.samples, t0, phase);
        return { t: t0 + f.t, r: f.r, v: f.v, V: norm(K.vrelOf(f.r, f.v)), vz: dot(K.vrelOf(f.r, f.v), f.r) / norm(f.r) };
      };
      if (!num(tTrig)) {
        out.trigger = null;
        var land0 = landWith(lastSamples, tOff, xLast, vehBody, 'body');
        if (!land0) return { refusal: refusal('out_of_envelope', 'The flight never reaches the ground altitude.', 'A ground altitude below the flight.', { applies_to: 'landing' }) };
        out.land = land0; out.chutes = { mode: P.mode, note: 'the G-switch threshold is never crossed on the way down' };
        if (P.mode !== 'none') out.failure = { kind: 'no_trigger', peak_g: lastPeakG };
        ev.push({ event: 'touchdown (no parachute)', t: land0.t });
        return out;
      }
      ev.push({ event: 'G-switch: deceleration below ' + P.trigger_g + ' g', t: tOff + tTrig });
      // from the G-switch on the vehicle is lighter by the shield mass it has lost (the heating is over)
      var fT = flyUntil(xLast, vehBody, { bankDeg: arr.bank }, tTrig), xT = { r: fT.r, v: fT.v }, tT = tOff + fT.t;
      addSeries(fT.samples, tOff, 'body');
      out.trigger_state = { t: tT, r: fT.r, v: fT.v }; out.trigger = tT;
      var mass = veh.mass_kg - (arr.ablated_kg || 0), vehLight = clone(vehBody); vehLight.mass_kg = mass;
      var fLight = flyAll(xT, vehLight, { bankDeg: arr.bank });
      if (P.mode === 'none') {
        var land1 = landWith(fLight.samples, tT, xT, vehLight, 'body');
        if (!land1) return { refusal: refusal('out_of_envelope', 'The flight never reaches the ground altitude.', 'A ground altitude below the flight.', { applies_to: 'landing' }) };
        out.land = land1; out.chutes = { mode: 'none' };
        ev.push({ event: 'impact, no parachute', t: land1.t });
        return out;
      }
      var CAN = srcCanopies();
      // the canopies: the SRC's own for the flown capsules; for any other vehicle, sized (same ballistic coefficient under
      // the drogue as Stardust, the main for the touchdown speed asked at the ground)
      var isSRC = arr.kind === 'capsule' && arr.capsule.own_canopies;
      var rhoG = ISA.isa(Math.max(P.ground, -1000)).rho_kg_m3;
      var dCds = isSRC ? CAN.drogue_cds_m2 : CAN.drogue_cds_m2 * mass / CAN.drogue_mass_kg;
      var mCds = isSRC ? CAN.main_cds_m2 : 2 * mass * G0 / (rhoG * Sx.touchdown_m_s * Sx.touchdown_m_s);
      var chutes = { mode: P.mode, drogue_cds_m2: P.mode === 'nominal' ? dCds : null, main_cds_m2: mCds, sized: !isSRC,
        main_equiv_src_canopies: mCds / CAN.main_cds_m2, main_equiv_diameter_m: CAN.main_d_m * Math.sqrt(mCds / CAN.main_cds_m2),
        drogue_equiv_diameter_m: P.mode === 'nominal' ? CAN.drogue_d_m * Math.sqrt(dCds / CAN.drogue_cds_m2) : null };
      out.chutes = chutes;
      // 3. the body to the drogue timer (or, without a drogue, to the main's baroswitch or timer), times from the G-switch
      var tBody;
      if (P.mode === 'nominal') tBody = P.drogue_timer_s;
      else {
        var tb = baroTime(fLight.samples, P.baro_Pa);
        // a main timer started by the drogue's timer still starts then, with no drogue to fire (review: it used to run from
        // the G-switch, 15.04 s early for Stardust)
        var tt = num(P.main_timer_s) ? P.main_timer_s + (P.main_timer_from === 'drogue' ? P.drogue_timer_s : 0) : null;
        tBody = num(tb) && num(tt) ? Math.min(tb, tt) : (num(tb) ? tb : tt);
        chutes.main_trigger = num(tb) && (!num(tt) || tb <= tt) ? 'baroswitch' : 'timer';
      }
      var tgB = eventTime(fLight.samples, function (s) { return P.ground - s.h; });
      if (!num(tBody) || (num(tgB) && tgB <= tBody)) { var lb = landWith(fLight.samples, tT, xT, vehLight, 'body'); out.land = lb; out.failure = { kind: 'ground_first', what: P.mode === 'nominal' ? 'drogue' : 'main' }; ev.push({ event: 'ground before the parachute', t: lb.t }); return out; }
      var fBody = flyUntil(xT, vehLight, { bankDeg: arr.bank }, tBody);
      addSeries(fBody.samples, tT, 'body');
      var x = { r: fBody.r, v: fBody.v }, t = tT + fBody.t, cdsBody = K.cdOf(vehBody, fBody.final.M) * veh.area_m2;
      var st0 = fBody.final;
      if (P.mode === 'nominal') {
        chutes.drogue = { t: t, h: st0.h, V: st0.V, M: st0.M, q_Pa: 0.5 * K.atm(st0.h).rho * st0.V * st0.V };
        ev.push({ event: 'drogue deploys', t: t });
        var fd = flyFill(x, mass, cdsBody, dCds, CAN.fill_drogue_s, 0);
        addSeries(fd.samples, t, 'drogue filling'); chutes.drogue.open_peak_g = fd.peak_g; t += fd.t; x = { r: fd.r, v: fd.v };
        var vd = { mass_kg: mass, area_m2: 1, cd: dCds, cl: 0, rn_m: 0 };
        var fdAll = flyAll(x, vd, {});
        var tb2 = baroTime(fdAll.samples, P.baro_Pa);
        var tt2 = num(P.main_timer_s) ? (P.main_timer_from === 'trigger' ? (out.trigger + P.main_timer_s) - t : (chutes.drogue.t + P.main_timer_s) - t) : null;
        var tm = num(tb2) && num(tt2) ? Math.min(tb2, tt2) : (num(tb2) ? tb2 : tt2);
        chutes.main_trigger = num(tb2) && (!num(tt2) || tb2 <= tt2) ? 'baroswitch' : 'timer';
        var tgd = eventTime(fdAll.samples, function (s) { return P.ground - s.h; });
        if (!num(tm) || (num(tgd) && tgd < tm)) { var ld = landWith(fdAll.samples, t, x, vd, 'drogue'); out.land = ld; out.failure = { kind: 'no_main' }; ev.push({ event: 'touchdown under the drogue', t: ld.t }); return out; }
        var fd2 = flyUntil(x, vd, {}, tm); addSeries(fd2.samples, t, 'drogue'); t += fd2.t; x = { r: fd2.r, v: fd2.v }; st0 = fd2.final; cdsBody = dCds;
      }
      chutes.main = { t: t, h: st0.h, V: st0.V, M: st0.M, q_Pa: 0.5 * K.atm(st0.h).rho * st0.V * st0.V };
      ev.push({ event: 'main deploys (' + chutes.main_trigger + ')', t: t });
      var fm = flyFill(x, mass, cdsBody, mCds, CAN.fill_main_s, 0);
      addSeries(fm.samples, t, 'main filling'); chutes.main.open_peak_g = fm.peak_g; t += fm.t; x = { r: fm.r, v: fm.v };
      var vm = { mass_kg: mass, area_m2: 1, cd: mCds, cl: 0, rn_m: 0 };
      var fmAll = flyAll(x, vm, {});
      var lm = landWith(fmAll.samples, t, x, vm, 'main');
      if (!lm) return { refusal: refusal('out_of_envelope', 'The flight never reaches the ground altitude.', 'A ground altitude below the flight.', { applies_to: 'landing' }) };
      out.land = lm; ev.push({ event: 'touchdown', t: lm.t });
      return out;
    }

    // ---------------------------------------------------------------- heating along the flight, and the heat shield
    function heating(D, veh, Sx) {
      var S2 = D.series, n = S2.length, rows = [], Qc = 0, Qr = 0, Qrx = 0, mt = 0, pk = { qc: 0, qr: 0, qt: 0, Tw: 0, pd: 0, ps: 0, rate: 0 };
      for (var i = 0; i < n; i++) {
        var s = S2[i], at = K.atm(s.h), rho = at.rho || 0, qc = num(s.q) ? s.q : 0;
        var rad = Sx.radiative && rho > 0 ? suttles(s.V, rho, veh.rn_m) : { q: 0, inside: true };
        var qt = qc + rad.q, h0 = h0Of(s.V, at.a), Tw = qt > 0 ? wallT(qt) : null, mdot = qc > 0 && Tw >= T_OX ? BPRIME * qc / h0 : 0;
        var row = { t: s.t, h: s.h, V: s.V, g: s.g, M: s.M, rho: rho, qc: qc, qr: rad.q, rin: rad.inside, qt: qt, Tw: Tw, mdot: mdot, pd: 0.5 * rho * s.V * s.V, ps: rho * s.V * s.V, phase: s.phase };
        rows.push(row);
        if (i > 0) { var a = rows[i - 1], dt = row.t - a.t; if (dt > 0 && dt < 5) { Qc += 0.5 * (a.qc + row.qc) * dt; var dqr = 0.5 * (a.qr + row.qr) * dt; Qr += dqr; if (!(a.rin && row.rin)) Qrx += dqr; mt += 0.5 * (a.mdot + row.mdot) * dt; } }
        if (qc > pk.qc) { pk.qc = qc; pk.t_qc = s.t; } if (rad.q > pk.qr) { pk.qr = rad.q; pk.t_qr = s.t; } if (qt > pk.qt) { pk.qt = qt; pk.t_qt = s.t; pk.qr_at_qt = rad.q; pk.qc_at_qt = qc; }
        if (row.Tw > pk.Tw) { pk.Tw = row.Tw; pk.t_Tw = s.t; } if (row.pd > pk.pd) pk.pd = row.pd; if (row.ps > pk.ps) { pk.ps = row.ps; }
        if (mdot / Sx.shield_density > pk.rate) { pk.rate = mdot / Sx.shield_density; pk.t_rate = s.t; }
      }
      return { rows: rows, Q_conv: Qc, Q_rad: Qr, Q_rad_extrapolated: Qrx, Q_total: Qc + Qr, mass_loss_stag: mt, recession_stag: mt / Sx.shield_density, peaks: pk };
    }
    function shield(arr, H, Sx) {
      var veh = arr.veh, wa = wetArea(veh), material = arr.kind === 'capsule' ? arr.capsule.shield : 'pica', refs = [];
      var pk = H.peaks, inEnv = pk.qt <= PICA.limit.q_W_m2 && pk.ps <= PICA.limit.p_atm * P_ATM;
      var out = { material: material, density_kg_m3: Sx.shield_density, b_prime: BPRIME, b_prime_spread: BPRIME_SPREAD, wet_area_m2: wa.m2, wet_area_basis: wa.basis,
        mass_loss_stag_kg_m2: H.mass_loss_stag, recession_stag_m: H.recession_stag, peak_recession_rate_m_s: pk.rate, profile_factor: PROFILE,
        ablated_kg: H.mass_loss_stag * wa.m2 * PROFILE, ablated_upper_kg: H.mass_loss_stag * wa.m2, in_envelope: inEnv, peak_wall_T_K: pk.Tw };
      if (material !== 'pica') refs.push(refusal('insufficient_data', 'This heat shield was ' + material + ' ("Heatshield - Carbon-Carbon", Genesis SRC overview); the recession law here is PICA\'s, so its recession and mass are shown as if PICA.', 'Carbon-carbon\'s oxidation data, or a PICA shield.', { applies_to: 'shield_material' }));
      if (!inEnv) refs.push(refusal('out_of_envelope', 'Peak heating ' + fmt(pk.qt / 1e4, 4) + ' W/cm² and stagnation pressure ' + fmt(pk.ps / P_ATM, 3) + ' atm against PICA\'s established limits of ' + fmt(PICA.limit.q_W_m2 / 1e4, 4) + ' W/cm² and ' + PICA.limit.p_atm + ' atm; the recession law (calibrated at 400 and 580 W/cm²) under-predicts beyond them (the 1,800 W/cm² arc-jet test, reality table).', 'A shallower entry, a larger nose, or an ablator qualified for these conditions.', { applies_to: 'recession' }));
      // the thickness: Stardust's flown heat shield covers an entry no harsher than its design (peak heating, heat load,
      // pressure); OSIRIS-REx flew it "with build-to-print thicknesses". Beyond that the thickness needs PICA's in-depth
      // property model, which is export-controlled.
      var DS = SD.design, heritage = pk.qt <= DS.q_W_m2 && H.Q_total <= DS.heat_load_J_m2 && pk.ps <= DS.p_atm * P_ATM && material === 'pica';
      out.heritage = { ok: heritage, peak_q_ratio: pk.qt / DS.q_W_m2, heat_load_ratio: H.Q_total / DS.heat_load_J_m2, pressure_ratio: pk.ps / (DS.p_atm * P_ATM) };
      if (heritage) {
        out.thickness_m = DS.thickness_m; out.thickness_basis = 'Stardust\'s 5.82 cm PICA, designed for 1,200 W/cm², 0.5 atm and 36.5 kJ/cm² (bondline 116 °C calculated against 250 °C allowed): this entry is inside all three';
        out.shield_mass_kg = Sx.shield_density * DS.thickness_m * wa.m2;
        if (H.recession_stag > 0.5 * DS.thickness_m) refs.push(refusal('out_of_envelope', 'The recession uses more than half of Stardust\'s thickness.', 'A thicker shield (in-depth analysis).', { applies_to: 'tps_thickness' }));
      } else {
        out.thickness_m = null; out.thickness_min_m = H.recession_stag; out.shield_mass_kg = null; out.shield_mass_min_kg = out.ablated_upper_kg;
        var why = [];
        if (pk.qt > DS.q_W_m2) why.push('peak heating ' + fmt(pk.qt / 1e4, 4) + ' W/cm² over its 1,200');
        if (H.Q_total > DS.heat_load_J_m2) why.push('heat load ' + fmt(H.Q_total / 1e7, 3) + ' kJ/cm² over its 36.5');
        if (pk.ps > DS.p_atm * P_ATM) why.push('stagnation pressure ' + fmt(pk.ps / P_ATM, 3) + ' atm over its 0.5');
        if (material !== 'pica') why.push('a ' + material + ' shield');
        refs.push(refusal('insufficient_data', 'Thickness: this entry is outside Stardust\'s heat-shield design (' + why.join('; ') + '), so its 5.82 cm does not carry over, and sizing a new thickness needs PICA\'s in-depth thermal model: "Material properties of high-performance ablators are subject to export-control restrictions" (Milos & Chen). Only the recession (' + fmt(H.recession_stag * 1000, 3) + ' mm at the stagnation point) is a lower bound.', 'PICA\'s property model (PICAv3.3, available to qualified U.S. persons) and a material-response code (FIAT), or an entry inside Stardust\'s design.', { applies_to: 'tps_thickness' }));
      }
      refs.push(refusal('insufficient_data', 'Pyrolysis gas and the char layer are not modelled: the mass lost is the surface recession only (the phenolic\'s gases leave too), and the bondline temperature is not computed.', 'An in-depth material-response model (see the thickness refusal).', { applies_to: 'pyrolysis' }));
      out.refusals = refs;
      return out;
    }

    // ---------------------------------------------------------------- one run
    function run(Sin, input) {
      var v = validSettings(Sin); if (v.refusal) return { refusal: v.refusal };
      var Sx = v.S, arr;
      if (Sx.source === 'chain' || Sx.source === 'imported') {
        var h = Sx.source === 'chain' ? CHAIN_H : (input && input.h48);
        if (!h) return { refusal: refusal('not_found', Sx.source === 'chain' ? 'No chain handoff is bundled.' : 'No idea 48 handoff is loaded.', 'Import one (paste, or a #h= link), or open the page with the bundled chain.') };
        arr = importCatch(h); if (arr.refusal) return { refusal: arr.refusal };
        arr.chain = Sx.source === 'chain';
      } else arr = capsuleArrival(Sx.source);
      // the ablated mass is computed first on the body flight (heating does not depend on the parachutes), then the
      // descent is flown with the mass that is left
      var D0 = descend(arr, Sx); if (D0.refusal) return { refusal: D0.refusal };
      var H0 = heating(D0, arr.veh, Sx), SH0 = shield(arr, H0, Sx);
      arr.ablated_kg = SH0.ablated_kg;
      var D = descend(arr, Sx); if (D.refusal) return { refusal: D.refusal };
      var H = heating(D, arr.veh, Sx), SH = shield(arr, H, Sx);   // reported from the flight as flown (differs from SH0 by ~1e-7)
      var refs = [], assumptions = [];
      var land = D.land, tdbL = num(arr.tdb) ? arr.tdb + land.t : null;
      // where it lands, Earth-fixed: idea 48's arrivals carry ICRF states with an epoch (longitude through ERFA's Earth
      // rotation angle); its flown capsules were built Earth-fixed at the entry interface (longitude through the rotation
      // since then)
      var ll = K.geodetic(land.r, arr.icrf ? tdbL : null), rot = -OMEGA * land.t, cr = Math.cos(rot), sr = Math.sin(rot);
      var rFix = [cr * land.r[0] - sr * land.r[1], sr * land.r[0] + cr * land.r[1], land.r[2]];   // the landing point in the entry interface's Earth-fixed frame
      var lon = arr.icrf ? ll.lon : ((Math.atan2(rFix[1], rFix[0]) / DEG % 360) + 540) % 360 - 180;
      var r0 = arr.x0.r, cosA = dot(r0, rFix) / (norm(r0) * norm(rFix)), downrange = RE * Math.acos(Math.max(-1, Math.min(1, cosA)));
      // (review) the flown capsules' entry points are idea 48's stand-ins: it starts each one at its landing target's
      // latitude and longitude (the papers on file give no entry point), so the place this flight reaches is about 870 km
      // downrange of where the capsule really landed. Their latitude and longitude are refused, not shown; so is an
      // ICRF state with no epoch (no Earth rotation angle to place its longitude).
      var flownAs = arr.kind === 'capsule' ? arr.id : arr.flown, placed = !flownAs && !(arr.icrf && !num(tdbL));
      var latOut = placed ? ll.lat : null, lonOut = placed ? lon : null;
      var mass = arr.veh.mass_kg, landed = mass - SH.ablated_kg;
      // own refusals
      if (Sx.radiative && H.Q_rad > 0 && H.Q_rad_extrapolated > 0.5 * H.Q_rad) refs.push(refusal('out_of_envelope', 'Most of the radiative heat load (' + fmt(100 * H.Q_rad_extrapolated / H.Q_rad, 3) + ' %) comes from conditions outside the Suttles fit\'s range (11-16 km/s, 53.75-68.4 km, nose radius 0.30-4.50 m' + (arr.veh.rn_m < RNG.rn_min_m ? '; this nose is ' + fmt(arr.veh.rn_m, 3) + ' m' : '') + '): it is an extrapolation of an equilibrium fit.', 'A radiation calculation for this nose radius and trajectory (nonequilibrium matters for small capsules: Stardust\'s CFD put radiation under 10 % of the heating at its peak).', { applies_to: 'radiative_heating' }));
      if (!Sx.radiative) refs.push(refusal('insufficient_data', 'Radiative heating is switched off: the heating is idea 48\'s convective screen only.', 'Switch it on.', { applies_to: 'radiative_heating' }));
      refs.push(refusal('insufficient_data', 'No winds and no day-of atmosphere: the descent under the parachutes drifts with the wind (Stardust\'s 50 m/s northward wind moved its landing), and OSIRIS-REx\'s whole descent ran faster than every model (its own reconstruction included).', 'A forecast atmosphere and winds for the landing day (GEOS, as OSIRIS-REx\'s team recommends).', { applies_to: 'atmosphere' }));
      if (flownAs) refs.push(refusal('insufficient_data', 'Where it lands: idea 48 starts ' + CAPSULES[flownAs].label.replace(/ \(.*/, '') + '\'s entry at its landing target\'s latitude and longitude, heading along the landing ellipse, because the papers on file give no entry point; so this flight\'s touchdown, ' + fmt(downrange / 1000, 3) + ' km downrange of that point, is not where the capsule landed (at the Utah Test and Training Range). Its latitude and longitude are not given; the time down, the speeds and the distance flown are.', 'The capsule\'s reconstructed entry latitude, longitude and heading (its navigation state at the entry interface).', { applies_to: 'landing_site' }));
      else if (arr.kind === 'catch') refs.push(refusal('insufficient_data', 'No landing site is chosen: the touchdown point is wherever this entry state leads (' + (placed ? fmt(ll.lat, 4) + '°, ' + fmt(lon, 5) + '°' : 'latitude ' + fmt(ll.lat, 4) + '°; no epoch, so no longitude') + '), and the ground is taken at ' + fmt(D.plan.ground, 4) + ' m' + (Sx.ground_alt_m === 'auto' ? ' (sea level)' : '') + '. A recovery needs a range under the footprint.', 'Re-target idea 47\'s arrival (its time and aim) so the footprint falls on a recovery range such as UTTR, and set the ground altitude here.', { applies_to: 'landing_site' }));
      if (D.chutes && D.chutes.sized) refs.push(refusal('insufficient_data', (arr.kind === 'capsule' ? CAPSULES[arr.id].label.replace(/ \(.*/, '') + '\'s own drogue and main are not on file (it opened neither), so these ' : 'The parachutes are sized here, not designed: the ') + 'drag areas scale the SRC\'s canopies (same ballistic coefficient under the drogue as Stardust\'s, the main for ' + Sx.touchdown_m_s + ' m/s at the ground) at the SRC canopies\' drag coefficients; ' + fmt(D.chutes.main_equiv_src_canopies, 3) + ' OSIRIS-REx mains\' worth of drag area. Canopy loads, cluster interference, mass and packing are not modelled.', arr.kind === 'capsule' ? 'Its canopies\' drag areas.' : 'A parachute design for this mass (a cluster like Apollo\'s), with its own drag and opening-load data.', { applies_to: 'parachutes' }));
      // (review) a sequence that never opens a parachute used to land at 40-90 m/s with nothing said
      var FL = D.failure;
      if (FL) {
        var bAlt = num(D.plan.baro_Pa) ? altOfPressure(D.plan.baro_Pa) : null;
        var fwhy = FL.kind === 'no_trigger' ? 'The G-switch never fires: after the last pass\'s peak of ' + fmt(FL.peak_g, 3) + ' g the sensed deceleration never falls back through ' + fmt(D.plan.trigger_g, 3) + ' g' + (D.plan.trigger_g >= FL.peak_g ? ' (the threshold is above the peak)' : D.plan.trigger_g <= 1 ? ' (in a steady fall the sensed deceleration settles at 1 g, so a threshold at or below 1 g is never crossed)' : '') + ', so no parachute opens'
          : FL.kind === 'ground_first' ? 'The ground comes first: the ' + (FL.what === 'drogue' ? 'drogue timer (' + fmt(D.plan.drogue_timer_s, 4) + ' s after the G-switch)' : 'main\'s pressure switch' + (num(bAlt) ? ' (' + fmt(bAlt / 1000, 3) + ' km)' : '') + ' and timer') + ' would fire after the capsule reaches the ground, so no parachute opens'
          : 'The main never opens: its pressure switch' + (num(bAlt) ? ' (' + fmt(bAlt / 1000, 3) + ' km)' : '') + ' does not fire above the ground (' + fmt(D.plan.ground, 4) + ' m) and its timer runs out after the touchdown, so the capsule lands under the drogue';
        refs.push(refusal('out_of_envelope', fwhy + ', and it reaches the ground at ' + fmt(land.V, 3) + ' m/s.', FL.kind === 'no_trigger' ? 'A G-switch threshold above 1 g and below the peak deceleration (Stardust\'s and OSIRIS-REx\'s 3 g).' : FL.kind === 'ground_first' ? 'A shorter drogue timer, a higher main pressure-switch altitude, or a lower ground.' : 'A main pressure-switch altitude above the ground, or a shorter main timer.', { applies_to: 'parachute_sequence' }));
      }
      if (D.chutes && (D.chutes.drogue || D.chutes.main)) refs.push(refusal('insufficient_data', 'Opening loads assume the canopy\'s drag area grows linearly over OSIRIS-REx\'s measured filling times (' + fmt(srcCanopies().fill_drogue_s, 3) + ' s drogue, ' + fmt(srcCanopies().fill_main_s, 3) + ' s main); no canopy opening-load data are on file.', 'The canopy\'s drop-test opening-load factor.', { applies_to: 'opening_loads' }));
      refs = refs.concat(SH.refusals);
      assumptions.push('Every flight is idea 48\'s fly() (3-DOF point mass, 1976 atmosphere to 86 km above pck00010\'s spheroid, Aster\'s GM, the air turning with the Earth), at its 0.1 s step; canopy filling at 0.01 s.');
      assumptions.push('Convective heating: Sutton & Graves (idea 48). Radiative heating: Suttles, Sullivan & Margolis, NASA TN D-7622 (equilibrium, inviscid, radiatively coupled), extrapolated outside 11-16 km/s, 53.75-68.4 km and 0.30-4.50 m with the fraction reported.');
      assumptions.push('Recession: diffusion-limited char oxidation, m_dot = B\' q_conv/h0 with B\' = ' + fmt(BPRIME, 4) + ' (per unit virgin density) from Stardust\'s arc-jet averages at 400 and 580 W/cm²; recession = m_dot/rho_shield; radiation is taken to heat the wall, not to remove char.');
      assumptions.push('Wall temperature: radiative equilibrium with the cold-wall heating (an upper bound: no conduction, blowing or ablation energy), PICA\'s emissivity as FIAT models it.');
      assumptions.push('Mass lost: the stagnation-point mass loss times the shield\'s wetted area times ' + fmt(PROFILE, 4) + ' (Stardust\'s measured apex-to-edge recession, linear in radius); pyrolysis gas is not counted.');
      if (arr.kind === 'capsule') assumptions.push('Below Mach ' + GN.tumble_mach + ' without a drogue the capsule tumbles with Genesis\'s reconstructed C_D ' + GN.tumble_cd + '; above it, idea 48\'s C_A table (held at its Mach 7.15 value below).');
      return { S: Sx, arrival: arr, descent: D, heat: H, shield: SH, land: { t: land.t, utc: num(tdbL) ? utcOf(tdbL) : null, tdb: tdbL, lat: latOut, lon: lonOut, ground_alt_m: D.plan.ground, speed: land.V, vz: land.vz, downrange_m: downrange },
        mass: { entry_kg: mass, ablated_kg: SH.ablated_kg, ablated_upper_kg: SH.ablated_upper_kg, landed_kg: landed, material_kg: arr.mass.material_kg != null ? arr.mass.material_kg : null, shield_kg: SH.shield_mass_kg },
        refusals: refs, carried: arr.carried, assumptions: assumptions.concat(arr.assumed || []) };
    }

    // ---------------------------------------------------------------- the handoff
    function evRows(D) { return D.events.map(function (e) { return { event: e.event, t_s: r9(e.t) }; }); }
    function buildHandoff(R, produced) {
      if (!R || R.refusal) return null;
      var A = R.arrival, D = R.descent, H = R.heat, SH = R.shield, pk = H.peaks, ch = D.chutes || {};
      var inputs = { settings: clone(R.S), catch_handoff: A.kind === 'catch' ? (A.chain ? clone(CHAIN_DIGEST) : clone(A.h48)) : null };
      var outputs = {
        landing: { value: { utc: R.land.utc, tdb_s_past_j2000: R.land.tdb, t_from_entry_s: R.land.t, latitude_deg: R.land.lat, longitude_deg: R.land.lon, ground_alt_m: R.land.ground_alt_m,
          touchdown_speed_m_s: R.land.speed, vertical_speed_m_s: -R.land.vz, downrange_m: R.land.downrange_m, frame: 'geocentric latitude; longitude through ERFA\'s Earth rotation angle where the arrival has an epoch; latitude and longitude null (refused) for the flown capsules, whose entry points are idea 48\'s stand-ins, and for a state with no epoch; downrange from the entry point; speed relative to the air' }, units: 'm, m/s, deg, s', confidence: 'derived', source: KERNEL + ' descend(): idea 48\'s fly() through every pass, the parachute sequence and to the ground' },
        mass: { value: { entry_kg: R.mass.entry_kg, ablated_kg: R.mass.ablated_kg, ablated_upper_kg: R.mass.ablated_upper_kg, landed_kg: R.mass.landed_kg, material_kg: R.mass.material_kg, heat_shield_kg: R.mass.shield_kg, pyrolysis_gas_kg: null }, units: 'kg', confidence: 'derived', source: KERNEL + ' shield(): stagnation mass loss x wetted area x Stardust\'s measured recession profile; heat-shield mass only where Stardust\'s design covers the entry' },
        loads: { value: { peak_g_entry: Math.max.apply(null, D.passes.map(function (p) { return p.peak_g; })), peak_dynamic_pressure_Pa: pk.pd, peak_stagnation_pressure_Pa: pk.ps, peak_q_conv_W_m2: pk.qc, peak_q_rad_W_m2: pk.qr, peak_q_total_W_m2: pk.qt, t_peak_q_total_s: pk.t_qt,
          heat_load_conv_J_m2: H.Q_conv, heat_load_rad_J_m2: H.Q_rad, heat_load_rad_extrapolated_J_m2: H.Q_rad_extrapolated, heat_load_total_J_m2: H.Q_total, peak_wall_T_K: pk.Tw, drogue_open_peak_g: ch.drogue ? ch.drogue.open_peak_g : null, main_open_peak_g: ch.main ? ch.main.open_peak_g : null, touchdown_speed_m_s: R.land.speed }, units: 'g, Pa, W/m^2, J/m^2, K, s, m/s', confidence: 'derived', source: KERNEL + ' heating(): Sutton & Graves (idea 48) + Suttles et al. (TN D-7622) along the flight' },
        heat_shield: { value: { material: SH.material, density_kg_m3: SH.density_kg_m3, b_prime: SH.b_prime, recession_stag_m: SH.recession_stag_m, mass_loss_stag_kg_m2: SH.mass_loss_stag_kg_m2, peak_recession_rate_m_s: SH.peak_recession_rate_m_s, wet_area_m2: SH.wet_area_m2, in_pica_envelope: SH.in_envelope,
          heritage: SH.heritage, thickness_m: SH.thickness_m, thickness_min_m: SH.thickness_m === null ? SH.thickness_min_m : null, thickness_basis: SH.thickness_basis || null }, units: 'm, kg, kg/m^2, m/s, m^2', confidence: 'derived', source: KERNEL + ' shield(): recession law from Stardust\'s arc-jet tests, checked against its flown heat shield' },
        parachutes: { value: { mode: ch.mode || null, sized: !!ch.sized, drogue_cds_m2: ch.drogue_cds_m2 || null, main_cds_m2: ch.main_cds_m2 || null, main_equiv_src_canopies: ch.main_equiv_src_canopies || null, main_equiv_diameter_m: ch.main_equiv_diameter_m || null,
          drogue: ch.drogue ? { t_s: ch.drogue.t, alt_m: ch.drogue.h, speed_m_s: ch.drogue.V, mach: ch.drogue.M, q_Pa: ch.drogue.q_Pa, open_peak_g: ch.drogue.open_peak_g } : null,
          main: ch.main ? { t_s: ch.main.t, alt_m: ch.main.h, speed_m_s: ch.main.V, mach: ch.main.M, q_Pa: ch.main.q_Pa, open_peak_g: ch.main.open_peak_g, trigger: ch.main_trigger } : null }, units: 'm^2, s, m, m/s, Pa, g', confidence: ch.sized ? 'assumed' : 'derived', source: KERNEL + ' srcCanopies(): drag areas from Stardust\'s and OSIRIS-REx\'s descents' },
        timeline: { value: evRows(D), units: 's after the entry interface', confidence: 'derived', source: KERNEL + ' descend()' }
      };
      var refs = (R.carried || []).map(clone).concat(R.refusals.map(function (r) { var c = clone(r); c.from = '49-hot-return'; return c; }));
      return { handoff: 'long-way-round', version: 1, from: '49-hot-return', produced: produced || new Date().toISOString(), inputs: inputs,
        outputs: JSON.parse(JSON.stringify(outputs, function (k, v) { return typeof v === 'number' ? r9(v) : v; })), refusals: refs, assumptions: R.assumptions.slice() };
    }
    function numDiff(a, b, path, tol) {
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b)) ? null : path;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return JSON.stringify(a) === JSON.stringify(b) ? null : path;
      var ks = Object.keys(a).concat(Object.keys(b));
      for (var i = 0; i < ks.length; i++) { var k = ks[i]; if (k === 'utc' && typeof a[k] === 'string') { if (Math.abs(Date.parse(a[k]) - Date.parse(b[k])) > 10) return path + '.' + k; continue; } var d = numDiff(a[k], b[k], path + '.' + k, tol); if (d) return d; }
      return null;
    }
    function codes(L) { return (L || []).map(function (r) { return (r.from || '') + ':' + r.code + '/' + (r.applies_to || ''); }).sort().join(','); }
    /** Read a handoff: idea 48's (imported) or this page's (re-run from its inputs and compared). */
    function parseHandoff(input) {
      var h = input;
      if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { return bad48('That is not JSON.'); } }
      if (!h || h.handoff !== 'long-way-round') return bad48('That is not a Long Way Round handoff.');
      if (h.from === '48-catch') { var a = importCatch(h); return a.refusal ? a : { from: '48-catch', h48: h }; }
      if (h.from !== '49-hot-return') return bad48('This is a handoff from ' + h.from + '; this page takes idea 48\'s or its own.');
      if (h.version !== 1) return bad48('Version ' + h.version + ' is not one this page reads.');
      var I = h.inputs || {}, Sx = I.settings, w = I.catch_handoff, h48 = null;
      if (!Sx) return bad48('This handoff carries no settings.');
      if (w && w.pruned) { if (!CHAIN_DIGEST || w.sha256 !== CHAIN_DIGEST.sha256) return { refusal: refusal('not_found', 'Its idea 48 handoff is carried as a digest that matches none bundled here (only the chain\'s sample is).', 'The handoff with idea 48\'s inside it whole.', { applies_to: 'catch_handoff' }) }; h48 = CHAIN_H; }
      else if (w) h48 = w;
      if ((Sx.source === 'chain' || Sx.source === 'imported') && !h48) return bad48('This handoff names idea 48 as its source but carries no idea 48 handoff.');
      var Sr = clone(Sx); if (Sr.source === 'chain' && !(w && w.pruned)) Sr.source = 'imported';
      var R = run(Sr, { h48: h48 });
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced);
      var keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) { var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i], 1e-6); if (d) return bad48('The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.'); }
      if (codes(h.refusals) !== codes(again.refusals)) return bad48('The handoff\'s refusals are not the ones its inputs give: it was edited.');
      return { from: '49-hot-return', h49: h, settings: Sr, h48: h48, R: R };
    }
    function b64urlEncode(s) { var b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function b64urlDecode(s) { var b = s.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8'); }

    // ---------------------------------------------------------------- reality: what flew, what was measured
    function reality() {
      var rows = [], RN = {};
      function pct(m, r) { return 100 * (m / r - 1); }
      // Stardust, as flown (drogue and main)
      var sd = run({ source: 'stardust' }); RN.stardust = sd;
      var sdS = sd.heat.rows, at = function (R, t) { var rr = R.heat.rows; for (var i = 1; i < rr.length; i++) if (rr[i].t >= t) { var a = rr[i - 1], b = rr[i], f = (t - a.t) / (b.t - a.t); return { V: a.V + f * (b.V - a.V), rho: Math.exp(Math.log(a.rho) + f * (Math.log(b.rho) - Math.log(a.rho))), h: a.h + f * (b.h - a.h) }; } return null; };
      var s42 = at(sd, 42), s53 = at(sd, 53);
      rows.push({ id: 'sd_v42', group: 'Trajectory', label: 'Stardust: speed 42 s after entry', ref: SD.eft.t42_v_m_s / 1000, refLabel: 'the trajectory NASA\'s aerothermal analysis used', model: s42.V / 1000, units: 'km/s', gap_pct: pct(s42.V, SD.eft.t42_v_m_s) });
      rows.push({ id: 'sd_rho42', group: 'Trajectory', label: 'Stardust: air density 42 s after entry', ref: SD.eft.t42_rho, refLabel: 'same', model: s42.rho, units: 'kg/m³', gap_pct: pct(s42.rho, SD.eft.t42_rho) });
      rows.push({ id: 'sd_v53', group: 'Trajectory', label: 'Stardust: speed at 53 s, peak heating', ref: SD.eft.t53_v_m_s / 1000, refLabel: 'same', model: s53.V / 1000, units: 'km/s', gap_pct: pct(s53.V, SD.eft.t53_v_m_s) });
      rows.push({ id: 'sd_qtot', group: 'Heating', label: 'Stardust: peak total heating (stagnation)', ref: SD.postflight.peak_q_total_W_m2 / 1e4, refLabel: 'post-flight evaluation', model: sd.heat.peaks.qt / 1e4, units: 'W/cm²', gap_pct: pct(sd.heat.peaks.qt, SD.postflight.peak_q_total_W_m2) });
      rows.push({ id: 'sd_load', group: 'Heating', label: 'Stardust: heat load (stagnation)', ref: SD.postflight.heat_load_J_m2 / 1e7, refLabel: 'post-flight evaluation', model: sd.heat.Q_total / 1e7, units: 'kJ/cm²', gap_pct: pct(sd.heat.Q_total, SD.postflight.heat_load_J_m2) });
      rows.push({ id: 'sd_radfrac', group: 'Heating', label: 'Stardust: radiation\'s share at peak heating', ref: 100 * SD.rad_fraction_max, refLabel: 'under, per the CFD/FIAT analysis', model: 100 * sd.heat.peaks.qr_at_qt / sd.heat.peaks.qt, units: '%', gap_abs: 100 * sd.heat.peaks.qr_at_qt / sd.heat.peaks.qt - 100 * SD.rad_fraction_max, bound: 'max' });
      rows.push({ id: 'sd_Tw', group: 'Heating', label: 'Stardust: peak wall temperature', ref: SD.slit_t_max_K, refLabel: 'seen from the DC-8 (SLIT, local maximum)', model: sd.heat.peaks.Tw, units: 'K', gap_pct: pct(sd.heat.peaks.Tw, SD.slit_t_max_K) });
      rows.push({ id: 'sd_recession', group: 'Heat shield', label: 'Stardust: recession at the apex', ref: APEX * 1000, refLabel: 'X-ray CT of the recovered shield: 6-6.5 mm', model: sd.shield.recession_stag_m * 1000, units: 'mm', gap_pct: pct(sd.shield.recession_stag_m, APEX), range: [CT.recession_lo_m * 1000, CT.recession_hi_m * 1000] });
      // the same law with the heating scaled to the post-flight heat load: separates the law's error from the heating's
      var scaled = sd.shield.recession_stag_m * SD.postflight.heat_load_J_m2 / sd.heat.Q_total;
      rows.push({ id: 'sd_recession_scaled', group: 'Heat shield', label: 'Stardust: recession, heating scaled to the post-flight 28 kJ/cm²', ref: APEX * 1000, refLabel: 'X-ray CT: 6-6.5 mm', model: scaled * 1000, units: 'mm', gap_pct: pct(scaled, APEX) });
      // the recession law beyond its envelope: MSL-grade PICA at 1,800 W/cm^2
      var HF = PICA.highflux, mHF = (HF.mdot1_kg_m2_s + HF.mdot2_kg_m2_s + HF.mdot3_kg_m2_s) / 3, mModel = BPRIME * HF.q_W_m2 / HF.h0_J_kg;
      rows.push({ id: 'pica_highflux', group: 'Heat shield', label: 'PICA at 1,800 W/cm², 130 kPa (beyond its 1,500 W/cm² limit): mass loss', ref: mHF, refLabel: 'arc jet, three samples', model: mModel, units: 'kg/m²/s', gap_pct: pct(mModel, mHF), outside: true });
      // parachutes: Stardust's G-switch and drogue
      var ch = sd.descent.chutes;
      rows.push({ id: 'sd_drogue_t', group: 'Parachutes', label: 'Stardust: drogue deploys (3 g + 15.04 s)', ref: SD.drogue_t_s, refLabel: 'radar and video (4.8 s after the pre-entry prediction)', model: ch.drogue.t, units: 's after entry', gap_abs: ch.drogue.t - SD.drogue_t_s });
      rows.push({ id: 'sd_drogue_M', group: 'Parachutes', label: 'Stardust: Mach at drogue deploy', ref: SD.drogue_mach, refLabel: 'reconstruction (1.37 planned)', model: ch.drogue.M, units: '', gap_abs: ch.drogue.M - SD.drogue_mach });
      rows.push({ id: 'sd_main_h', group: 'Parachutes', label: 'Stardust: main deploys (baroswitch, 10.11 psi)', ref: SD.main_alt_m / 1000, refLabel: 'radar (±0.73 km switch accuracy)', model: ch.main.h / 1000, units: 'km', gap_abs: ch.main.h / 1000 - SD.main_alt_m / 1000 });
      // OSIRIS-REx as flown (no drogue): the free fall to the main, the time on the main, the whole descent
      var ox = run({ source: 'osirisrex' }); RN.osirisrex = ox;
      var oc = ox.descent.chutes, tMainObs = OX.observed.main_inflated_s, tTdObs = OX.observed.touchdown_s;
      var tMain = oc.main.t + srcCanopies().fill_main_s;
      rows.push({ id: 'ox_main_t', group: 'Parachutes', label: 'OSIRIS-REx (no drogue): main fully open', ref: tMainObs, refLabel: 'video; NASA\'s own reconstruction: ' + OX.recon_main_t_s + ' s', model: tMain, units: 's after entry', gap_abs: tMain - tMainObs, ref2: OX.recon_main_t_s });
      rows.push({ id: 'ox_main_dur', group: 'Parachutes', label: 'OSIRIS-REx: time on the main to touchdown', ref: tTdObs - tMainObs, refLabel: 'video; NASA\'s reconstruction: ' + fmt(OX.recon_touchdown_t_s - OX.recon_main_t_s, 4) + ' s', model: ox.land.t - tMain, units: 's', gap_pct: pct(ox.land.t - tMain, tTdObs - tMainObs), ref2: OX.recon_touchdown_t_s - OX.recon_main_t_s });
      rows.push({ id: 'ox_td', group: 'Parachutes', label: 'OSIRIS-REx: touchdown', ref: tTdObs, refLabel: 'video; NASA\'s reconstruction: ' + OX.recon_touchdown_t_s + ' s', model: ox.land.t, units: 's after entry', gap_abs: ox.land.t - tTdObs, ref2: OX.recon_touchdown_t_s });
      // (review) the main opening where the AAS 2024 reconstruction puts it: 2,699 m MSL over a 1,299 m site, worked out
      // from the observed time under the main with NASA's own canopy model (its pressure switch was expected to fire at
      // 2,650-2,862 m that day). Not an independent measurement: a check of this page's main canopy against NASA's.
      var oxr = run({ source: 'osirisrex', main_baro_Pa: pressureAt(OX.recon_main_alt_m), ground_alt_m: OX.recon_ground_alt_m }); RN.osirisrex_recon = oxr;
      var tMainR = oxr.descent.chutes.main.t + srcCanopies().fill_main_s;
      rows.push({ id: 'ox_main_dur_recon', group: 'Parachutes', label: 'OSIRIS-REx: time on the main, opening at the reconstructed 2,699 m', ref: tTdObs - tMainObs, refLabel: 'video; AAS 2024 finds that altitude (-59/+64 m, over a 1,299 m site) from this time with NASA\'s canopy model', model: oxr.land.t - tMainR, units: 's', gap_pct: pct(oxr.land.t - tMainR, tTdObs - tMainObs) });
      // Genesis: no parachute; the fall from the predicted drogue time to impact with its reconstructed tumbling C_D
      var gn = run({ source: 'genesis' }); RN.genesis = gn;
      var gT = gn.land.t - GN.drogue_pred_t_s, gH = at(gn, GN.drogue_pred_t_s);
      rows.push({ id: 'gn_h127', group: 'Parachutes', label: 'Genesis: altitude 126.7 s after entry', ref: GN.alt_at_drogue_pred_m / 1000, refLabel: 'UTTR radar', model: gH.h / 1000, units: 'km', gap_abs: gH.h / 1000 - GN.alt_at_drogue_pred_m / 1000 });
      rows.push({ id: 'gn_fall', group: 'Parachutes', label: 'Genesis (no parachute): fall from 126.7 s to impact', ref: GN.fall_s, refLabel: 'observed impact time', model: gT, units: 's', gap_pct: pct(gT, GN.fall_s) });
      var gTrig = gn.descent.trigger;
      rows.push({ id: 'gn_trigger', ref_dp: 0, group: 'Parachutes', label: 'Genesis: 3 g trigger point (nominal plan)', ref: GN.nominal.trigger_t_s, refLabel: 'pre-flight timeline (whole seconds)', model: gTrig, units: 's after entry', gap_abs: gTrig - GN.nominal.trigger_t_s });
      return { rows: rows, runs: RN };
    }
    // The radiative fit against its own paper (all 91 sphere cases of Table III(a)) and against an independent code
    // (Sutton & Hartung's 60 km table, inside the fit's range and, below 11 km/s and at 0.23 m, outside it)
    function radiativeChecks() {
      var t3 = SUT.table3.rows.map(function (r) { var q = suttles(r.v_m_s, r.rho_kg_m3, r.rn_m).q; return { case: r.case, v: r.v_m_s, rn: r.rn_m, model: q, fit: r.q_fit_W_m2, data: r.q_data_W_m2, error_pct: r.error_pct, gap_fit: q / r.q_fit_W_m2 - 1, gap_data: q / r.q_data_W_m2 - 1 }; });
      var sh = S.sutton_hartung.t60.rows.map(function (r) { var q = suttles(r.v_m_s, S.sutton_hartung.rho60_kg_m3, r.rn_m); return { v: r.v_m_s, rn: r.rn_m, model: q.q, ref: r.q_W_m2, inside: q.inside, gap: q.q / r.q_W_m2 - 1 }; });
      return { table3: t3, suttonHartung: sh };
    }
    // The cases the independent oracle (oracle/descent-oracle.py) flies, from this kernel's own states and constants.
    // Shared with the oracle on purpose: the state at the G-switch, the masses, drag areas, switch settings, the capsule's
    // C_A table, the constants, and the hypersonic flight's time, altitude and air-relative speed at 1 s (the heating is
    // recomputed from those by the oracle's own atmosphere and formulas). Not shared: the method.
    function oracleCases() {
      var CAN = srcCanopies(), out = { constants: { mu: MU, re: RE, rc: K.RC, omega: OMEGA, g0: G0, atm_top_m: ATM_TOP, k_sg: K.K_SG, sigma: SIGMA, suttles: A, b_prime: BPRIME, gamma: GAMMA, t_ox: T_OX,
        emissivity: [EM.t_lo_K, EM.e_lo, EM.t_hi_K, EM.e_hi], tumble_mach: GN.tumble_mach, tumble_cd: GN.tumble_cd, fill_drogue_s: CAN.fill_drogue_s, fill_main_s: CAN.fill_main_s }, cases: [] };
      [['stardust', { source: 'stardust' }], ['osirisrex', { source: 'osirisrex' }], ['genesis', { source: 'genesis' }], ['chain', defaults()]].forEach(function (p) {
        var R = run(p[1]), D = R.descent, ch = D.chutes, veh = R.arrival.veh, T = D.trigger_state;
        var body = D.plan.mode === 'nominal' || R.arrival.kind !== 'capsule' ? veh : tumblingVehicle(veh);
        var ser = [], last = -1e9;
        R.heat.rows.forEach(function (r) { if (r.qc > 1e3 && r.t >= last + 1 - 1e-9) { ser.push([r9(r.t), r9(r.h), r9(r.V)]); last = r.t; } else if (!(r.qc > 1e3)) last = -1e9; });
        out.cases.push({ id: p[0], mode: D.plan.mode, mass_kg: veh.mass_kg - R.shield.ablated_kg, area_m2: veh.area_m2, rn_m: veh.rn_m, cd: body.cd, ground_alt_m: D.plan.ground,
          trigger: { t: T.t, r: T.r.map(r9), v: T.v.map(r9) }, drogue_timer_s: D.plan.drogue_timer_s, baro_Pa: D.plan.baro_Pa, main_timer_s: D.plan.main_timer_s, main_timer_from: D.plan.main_timer_from,
          drogue_cds_m2: ch.drogue_cds_m2 || null, main_cds_m2: ch.main_cds_m2 || null, shield_density: R.S.shield_density,
          kernel: { drogue_t: ch.drogue ? ch.drogue.t : null, main_t: ch.main ? ch.main.t : null, land_t: R.land.t, land_speed: R.land.speed, drogue_open_g: ch.drogue ? ch.drogue.open_peak_g : null, main_open_g: ch.main ? ch.main.open_peak_g : null,
            Q_conv: R.heat.Q_conv, Q_rad: R.heat.Q_rad, recession_m: R.shield.recession_stag_m, peak_Tw: R.heat.peaks.Tw },
          series: ser });
      });
      out.src = { drogue_cds_m2: CAN.drogue_cds_m2, drogue_mass_kg: CAN.drogue_mass_kg, main_cds_m2: CAN.main_cds_m2, main_mass_kg: CAN.main_mass_kg };
      return JSON.parse(JSON.stringify(out, function (k, v) { return typeof v === 'number' ? r9(v) : v; }));
    }

    return {
      KERNEL: KERNEL, K: K, MU: MU, RE: RE, G0: G0, SIGMA: SIGMA, BPRIME: BPRIME, BPRIME_SPREAD: BPRIME_SPREAD, B400: B400, B580: B580, PROFILE: PROFILE, APEX: APEX, P_ATM: P_ATM,
      sources: S, chain: CHAIN_H, chainDigest: CHAIN_DIGEST, CAPSULES: CAPSULES, SOURCES: SOURCES, CHUTES: CHUTES,
      suttles: suttles, emissivity: emissivity, wallT: wallT, wetArea: wetArea, h0Of: h0Of, pressureAt: pressureAt, altOfPressure: altOfPressure, vehicleOf: vehicleOf, tumblingVehicle: tumblingVehicle,
      srcCanopies: srcCanopies, flyFill: flyFill, eventTime: eventTime, importCatch: importCatch, capsuleArrival: capsuleArrival, descend: descend, heating: heating, shield: shield,
      defaults: defaults, validSettings: validSettings, run: run, buildHandoff: buildHandoff, parseHandoff: parseHandoff, numDiff: numDiff,
      reality: reality, radiativeChecks: radiativeChecks, oracleCases: oracleCases, utcOf: utcOf, tdbOf: tdbOf, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode
    };
  }

  return { create: create, KERNEL: KERNEL };
});
