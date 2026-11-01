/* Catch: arriving at the Earth. Idea 48 of the Aster Idea Bank, module 18 of "The Long Way Round".
 *
 * Idea 47 brought the asteroid's material home and handed on an Earth arrival: the v-infinity vector, the perigee it is
 * aimed at, the time, the mass and whatever propellant is left. This module compares the ways to stop: straight into
 * the atmosphere (direct entry), one pass through it into orbit (aerocapture, with a burn to raise the perigee), the
 * same pass without the burn (skip entry: the second pass lands), a rocket burn at perigee (propulsive capture), a
 * swing past the Moon (lunar gravity assist), and the Skyhook tether's upper tip (idea 01's kernel). It hands module 49
 * the chosen option and the state at the entry interface.
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, m/s, Pa, W/m^2). Time: TDB seconds past J2000 (UTC = TDB -
 * 69.184 s, as ideas 39 to 47). Frame: geocentric ICRF/J2000 axes; the atmosphere turns with the Earth about the ICRF z
 * axis at pck00010's rate (precession and nutation since J2000, about 0.4 deg by 2029, are ignored: stated).
 *
 * Reused unmodified (snapshots/): PartForge's 1976 atmosphere isa() and Aster's Earth (via ideas 02 and 35), DE440's
 * GMs (via ideas 40 and 47), ERFA's Earth rotation angle (via ideas 37 and 47), idea 01's Skyhook tip-match kernel with
 * Rev A's canon, idea 47's handoff. New here: the entry flight mechanics (a lifting point mass over a rotating round
 * Earth; idea 35's integrator is coupled to engines and staging and not exported), Sutton & Graves's stagnation-point
 * heating, the entry and aerocapture corridors, the arrival hyperbola re-aimed to an entry angle, the propulsive and
 * lunar-flyby captures, and the comparison.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, DAY = 86400;
  var KERNEL = '48-catch/catch.js';

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
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; }
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function rv(a) { return a.map(r9); }
  function interp(xs, ys, x) {   // xs increasing; held flat outside
    if (x <= xs[0]) return ys[0];
    var n = xs.length; if (x >= xs[n - 1]) return ys[n - 1];
    var i = 1; while (xs[i] < x) i++;
    var f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]);
  }
  function utcOf(tdb) { return new Date(Date.UTC(2000, 0, 1, 12) + (tdb - 69.184) * 1000).toISOString(); }
  function tdbOf(utc) { return (Date.parse(utc) - Date.UTC(2000, 0, 1, 12)) / 1000 + 69.184; }

  function create(deps) {
    deps = deps || {};
    var ISA = deps.isa, E = deps.earth, DE = deps.de440, ERFA = deps.erfa, S = deps.sources, TM = deps.TipMatch, REVA = deps.revA, ASTER = deps.aster, CHAIN = deps.chain, RAD = deps.radii;
    var missing = [];
    [['isa', ISA], ['earth', E], ['de440', DE], ['erfa', ERFA], ['sources', S], ['radii', RAD]].forEach(function (p) { if (!p[1]) missing.push(p[0]); });
    if (missing.length) throw new Error('Catch.create: missing ' + missing.join(', '));

    // ---------------------------------------------------------------- constants (every one from a snapshot)
    var MU = E.mu_m3_s2;                       // Aster delta-v.ts 398,600.4418 km^3/s^2 (via idea 35)
    var RE = E.radius_m;                       // pck00010 / DE440 6,378,136.6 m (via idea 35; also idea 47's)
    var OMEGA = E.omega_rad_s;                 // pck00010 BODY399_PM rate over 86,400 s (via idea 35)
    var G0 = ISA.ISA_G0;                       // 9.80665 (PartForge isa)
    var ATM_TOP = ISA.ISA_R0 * ISA.ISA_H_MAX / (ISA.ISA_R0 - ISA.ISA_H_MAX);   // 85,999.95 m geometric: the table's top
    var RA = RAD.a_m, RC = RAD.c_m;            // pck00010 BODY399_RADII: the air's altitude is measured from this spheroid
    if (Math.abs(RA - RE) > 1e-6) throw new Error('Catch.create: the equatorial radius and Aster\'s Earth radius differ');
    function surfR(sinLat) { var c2 = 1 - sinLat * sinLat; return RA * RC / Math.sqrt(RC * RC * c2 + RA * RA * sinLat * sinLat); }
    function altOf(r, X) {   // altitude for the air: above the spheroid along the radius (X.sphere: above the sphere; X.flat: along a fixed up)
      if (X && X.flat) return dot(r, X.up0) - RE;
      var rn = norm(r);
      return X && X.sphere ? rn - RE : rn - surfR(r[2] / rn);
    }
    var MU_MOON = DE.gm_m3_s2.moon, MU_EM = DE.gm_m3_s2.earthMoon;
    var MOON = S.moon;
    var K_SG = S.sutton_graves.K_air / (2 * Math.sqrt(S.sutton_graves.atm_Pa));   // q = K_SG sqrt(rho/Rn) V^3 (Newtonian p_s = rho V^2, h_s = V^2/2)
    var CHAIN_H = CHAIN ? CHAIN.handoff : null;
    var CHAIN_DIGEST = CHAIN ? CHAIN.digest : null;
    var ENTRY_ALT = CHAIN_H ? CHAIN_H.outputs.earth_arrival.value.entry_altitude_m : 125000;   // NHATS's 125 km, as idea 47 handed it on
    var ENTRY_LIMIT = CHAIN_H ? CHAIN_H.outputs.earth_arrival.value.entry_limit_m_s : 12000;  // NHATS's 12 km/s
    var MARGIN = CHAIN_H ? CHAIN_H.outputs.mass.value.margin : 0.1;                             // Aster's 10 % (delta-v.ts, via idea 47)
    var TM_K = null, TM_REFUSAL = null;
    if (TM && REVA) { try { TM_K = TM.create(REVA.data, REVA.provenance, ASTER || null); if (!TM_K.ok) { TM_REFUSAL = TM_K.refusal; TM_K = null; } } catch (e) { TM_REFUSAL = refusal('not_found', 'Idea 01\'s kernel failed to start: ' + e.message, 'The tip-match snapshot and Rev A canon.'); } }
    else TM_REFUSAL = refusal('not_found', 'Idea 01\'s tip-match kernel or Skyhook\'s Rev A canon is not loaded.', 'snapshots/tip-match.js and snapshots/rev_a.data.js.');

    // ---------------------------------------------------------------- vehicles (snapshots/entry-sources.js)
    var SD = S.stardust, GN = S.genesis, OX = S.osirisrex, AD = S.apollo_derived;
    var VEHICLES = {
      stardust: { id: 'stardust', label: 'Stardust capsule', shape: '60° sphere-cone, 0.81 m', mass_kg: SD.mass_kg, area_m2: SD.area_m2, diameter_m: SD.diameter_m, rn_m: SD.nose_radius_m,
        cd: { mach: SD.ca.mach.slice().reverse(), value: SD.ca.ca.slice().reverse() }, cl: 0,
        source: 'Mitcheltree et al. 1997 (NTRS 20040105538): diameter, frontal area, nose radius, LAURA C_A against Mach (Table 4); Desai et al. 2008: 45.8 kg', assumed: [] },
      osirisrex: { id: 'osirisrex', label: 'OSIRIS-REx capsule', shape: 'Stardust\'s outer mould line', mass_kg: OX.empty_mass_kg + OX.sample_mass_kg, area_m2: SD.area_m2, diameter_m: SD.diameter_m, rn_m: SD.nose_radius_m,
        cd: { mach: SD.ca.mach.slice().reverse(), value: SD.ca.ca.slice().reverse() }, cl: 0,
        source: 'OSIRIS-REx EDL papers (NTRS 20240000629, 20240014280): "the same 60 degree half-angle forebody as Stardust", "the same maximum diameter"; 49.64 kg empty plus the 121.6 g sample', assumed: [] },
      genesis: { id: 'genesis', label: 'Genesis capsule', shape: '60° sphere-cone, about 1.5 m', mass_kg: GN.mass_kg, area_m2: PI * GN.diameter_m * GN.diameter_m / 4, diameter_m: GN.diameter_m, rn_m: SD.nose_radius_m * GN.diameter_m / SD.diameter_m,
        cd: { mach: SD.ca.mach.slice().reverse(), value: SD.ca.ca.slice().reverse() }, cl: 0,
        source: 'Desai & Lyons (NTRS 20080020376): 205.6 kg, "approximately 1.5 m in diameter", a blunted 60 deg half-angle sphere-cone', assumed: ['C_A is Stardust\'s (the same 60 deg forebody, no Genesis table on file)', 'nose radius scaled from Stardust\'s by diameter', 'the diameter is "approximately 1.5 m"'] },
      apollo: { id: 'apollo', label: 'Apollo-derived capsule', shape: 'Apollo heat shield, 4.42 m, trimmed', mass_kg: AD.mass_kg, area_m2: AD.area_m2, diameter_m: AD.diameter_m, rn_m: AD.diameter_m / 2,
        cd: AD.cd, cl: AD.cl,
        source: 'TransHab/Ellipsled aerocapture study (NTRS 20000102372): 6500 kg, 4.42 m, 15.34 m^2, C_L 0.466, C_D 1.269 (constant, as the study flew it)', assumed: ['stagnation-point radius = half the diameter, the convention of the Apollo heating analysis (NASA TN D-6843: "radius, 6.417 feet (one-half the maximum diameter)"), before its spherical-segment adjustment, which is not on file'] }
    };
    var VEH_ORDER = ['apollo', 'stardust', 'osirisrex', 'genesis'];
    function vehicle(id, massKg) {
      var v = VEHICLES[id]; if (!v) return null;
      var o = clone(v); if (num(massKg)) o.mass_kg = massKg;
      return o;
    }
    function cdOf(veh, mach) { return typeof veh.cd === 'number' ? veh.cd : interp(veh.cd.mach, veh.cd.value, num(mach) ? mach : 1e9); }
    function betaOf(veh, mach) { return veh.mass_kg / (cdOf(veh, num(mach) ? mach : 30) * veh.area_m2); }

    // ---------------------------------------------------------------- atmosphere
    // US 1976 below its table's top (PartForge isa, verbatim); none above it (as idea 35). X = {rho0, H} replaces it with
    // an exponential atmosphere (the closed-form checks), X.gravity = false switches gravity off.
    function atm(h, X) {
      if (X && X.H) return { rho: X.rho0 * Math.exp(-h / X.H), a: X.a || 300 };
      if (!(h < ATM_TOP)) return { rho: 0, a: null };
      var s = ISA.isa(h);
      return { rho: s.rho_kg_m3, a: s.a_m_s, T: s.T_K, P: s.P_Pa };
    }
    function topOf(X) { return X && X.H ? X.top : ATM_TOP; }

    // ---------------------------------------------------------------- frames
    function omegaCross(r) { return [-OMEGA * r[1], OMEGA * r[0], 0]; }
    function vrelOf(r, v) { return sub(v, omegaCross(r)); }
    function localFrame(r) {
      var up = unit(r), east = unit([-r[1], r[0], 0]);
      if (norm(east) === 0) east = [0, 1, 0];
      return { up: up, east: east, north: cross(up, east) };
    }
    function angles(r, u) {   // flight-path angle and heading (clockwise from north) of velocity u at r
      var F = localFrame(r), n = norm(u);
      return { fpa: Math.asin(Math.max(-1, Math.min(1, dot(u, F.up) / n))) / DEG, heading: ((Math.atan2(dot(u, F.east), dot(u, F.north)) / DEG) + 360) % 360 };
    }
    function era(tdb) {   // ERFA era00 with UT1 ~ UTC (|UT1 - UTC| < 0.9 s)
      var jd = ERFA.DJ00 + (tdb - 69.184) / DAY, f = jd - Math.floor(jd);
      var th = 2 * PI * (f + ERFA.era.c0 + ERFA.era.c1 * (jd - ERFA.DJ00));
      th %= 2 * PI; return th < 0 ? th + 2 * PI : th;
    }
    function geodetic(r, tdb) {   // geocentric latitude, longitude east (Earth-fixed through ERA), altitude above the sphere
      var lon = Math.atan2(r[1], r[0]) - (num(tdb) ? era(tdb) : 0);
      lon = ((lon / DEG) % 360 + 540) % 360 - 180;
      return { lat: Math.asin(r[2] / norm(r)) / DEG, lon: lon, alt: norm(r) - RE, alt_spheroid: altOf(r) };
    }
    // A state from local quantities: speedFrame 'inertial' (speed and angles inertial), 'relative' (atmosphere-relative),
    // or 'relative-speed' (atmosphere-relative speed, inertial flight-path angle and heading: OSIRIS-REx's requirement).
    function stateFromLocal(p) {
      var rr = RE + p.alt, la = p.lat * DEG, lo = (p.lon || 0) * DEG;
      var r = [rr * Math.cos(la) * Math.cos(lo), rr * Math.cos(la) * Math.sin(lo), rr * Math.sin(la)];
      var F = localFrame(r), g = p.fpa * DEG, ps = p.heading * DEG;
      var d = add(scale(add(scale(F.east, Math.sin(ps)), scale(F.north, Math.cos(ps))), Math.cos(g)), scale(F.up, Math.sin(g)));
      var w = omegaCross(r), v;
      if (p.speedFrame === 'relative') v = add(scale(d, p.speed), w);
      else if (p.speedFrame === 'relative-speed') { var b = dot(d, w), vi = b + Math.sqrt(b * b - dot(w, w) + p.speed * p.speed); v = scale(d, vi); }
      else v = scale(d, p.speed);
      return { r: r, v: v };
    }

    // ---------------------------------------------------------------- two-body
    function elements(r, v) {
      var rn = norm(r), h = cross(r, v), hn = norm(h), en = dot(v, v) / 2 - MU / rn;
      var ev = sub(scale(cross(v, h), 1 / MU), scale(r, 1 / rn)), e = norm(ev), p = hn * hn / MU;
      var a = en < 0 ? -MU / (2 * en) : (en > 0 ? -MU / (2 * en) : Infinity);
      var o = { h: h, hn: hn, energy: en, ev: ev, e: e, p: p, a: a, rp: p / (1 + e), bound: en < 0, c3: 2 * en };
      o.ra = en < 0 ? a * (1 + e) : Infinity;
      return o;
    }
    function tPeri(el, nu) {   // time since periapsis at true anomaly nu
      var e = el.e;
      if (el.bound) {
        var E2 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
        return (E2 - e * Math.sin(E2)) / Math.sqrt(MU / (el.a * el.a * el.a));
      }
      var F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
      return (e * Math.sinh(F) - F) / Math.sqrt(MU / (-el.a * -el.a * -el.a));
    }
    // Coast on the conic to radius rT, inbound (wantIn) or outbound; the next crossing. null if never reached.
    function coastTo(r, v, rT, wantIn) {
      var el = elements(r, v);
      if (!(el.e > 1e-9)) return null;
      var P = scale(el.ev, 1 / el.e), Q = cross(unit(el.h), P), rn = norm(r);
      var nu0 = Math.atan2(dot(r, v) * el.hn / (MU * el.e * rn), (el.p / rn - 1) / el.e);
      var c = (el.p / rT - 1) / el.e;
      if (c > 1 || c < -1) return null;
      var nuT = (wantIn ? -1 : 1) * Math.acos(c);
      var dt = tPeri(el, nuT) - tPeri(el, nu0);
      if (el.bound) { var T = 2 * PI * Math.sqrt(el.a * el.a * el.a / MU); if (dt < -1e-6) dt += T; }
      else if (dt < -1e-6) return null;
      var rr = el.p / (1 + el.e * Math.cos(nuT)), k = Math.sqrt(MU / el.p);
      return { r: add(scale(P, rr * Math.cos(nuT)), scale(Q, rr * Math.sin(nuT))), v: add(scale(P, -k * Math.sin(nuT)), scale(Q, k * (el.e + Math.cos(nuT)))), dt: dt };
    }

    // ---------------------------------------------------------------- the entry flight (3-DOF point mass)
    // Gravity mu r/r^3; drag along -v_rel; lift perpendicular to v_rel, in the vertical plane at bank 0 (lift up), rotated
    // about v_rel by the bank angle (180 = lift down). v_rel = v - omega x r. Sensed deceleration = |aero|/g0.
    function deriv(r, v, veh, cb, sb, X, out) {
      var rn = norm(r), h = altOf(r, X), gk = X && X.gravity === false ? 0 : -MU / (rn * rn * rn);
      var a = [gk * r[0], gk * r[1], gk * r[2]];
      var A = atm(h, X), vr = vrelOf(r, v), V = norm(vr), aero = 0, M = A.a ? V / A.a : null, q = 0;
      if (A.rho > 0 && V > 0) {
        var qd = 0.5 * A.rho * V * V, cd = cdOf(veh, M), D = qd * cd * veh.area_m2 / veh.mass_kg, L = qd * (veh.cl || 0) * veh.area_m2 / veh.mass_kg;
        var u = scale(vr, 1 / V);
        a[0] -= D * u[0]; a[1] -= D * u[1]; a[2] -= D * u[2];
        if (L !== 0) {
          var up = X && X.flat ? X.up0 : scale(r, 1 / rn), l0 = sub(up, scale(u, dot(up, u))), ln = norm(l0);
          if (ln > 0) { l0 = scale(l0, 1 / ln); var s0 = cross(u, l0); var ld = add(scale(l0, cb), scale(s0, sb)); a[0] += L * ld[0]; a[1] += L * ld[1]; a[2] += L * ld[2]; }
        }
        aero = Math.sqrt(D * D + L * L);
        q = veh.rn_m > 0 ? K_SG * Math.sqrt(A.rho / veh.rn_m) * V * V * V : null;
      }
      if (out) { out.h = h; out.V = V; out.M = M; out.g = aero / G0; out.q = q; out.rho = A.rho; }
      return a;
    }
    function rk4(r, v, dt, veh, cb, sb, X) {
      var a1 = deriv(r, v, veh, cb, sb, X);
      var r2 = add(r, scale(v, dt / 2)), v2 = add(v, scale(a1, dt / 2)), a2 = deriv(r2, v2, veh, cb, sb, X);
      var r3 = add(r, scale(v2, dt / 2)), v3 = add(v, scale(a2, dt / 2)), a3 = deriv(r3, v3, veh, cb, sb, X);
      var r4 = add(r, scale(v3, dt)), v4 = add(v, scale(a3, dt)), a4 = deriv(r4, v4, veh, cb, sb, X);
      return {
        r: add(r, scale(add(add(v, scale(add(v2, v3), 2)), v4), dt / 6)),
        v: add(v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), dt / 6))
      };
    }
    function parabolaPeak(t0, y0, t1, y1, t2, y2) {   // vertex of the parabola through three equally spaced samples
      var d = y0 - 2 * y1 + y2; if (!(d < 0)) return { t: t1, y: y1 };
      var s = (y0 - y2) / (2 * d), h = t1 - t0;
      return { t: t1 + s * h, y: y1 - (y0 - y2) * s / 4 };
    }
    // Fly one atmospheric pass from x0 (above or inside the atmosphere). o: bankDeg, dt (s), atm X, vStop (stop below this
    // atmosphere-relative speed, m/s), tStop (stop at this time since x0, s), sampleEvery (s).
    function fly(x0, veh, o) {
      o = o || {};
      var X = o.atm || null, top = RE + topOf(X), bank = (num(o.bankDeg) ? o.bankDeg : 0) * DEG, cb = Math.cos(bank), sb = Math.sin(bank);
      var dt = o.dt || 0.1, vStop = num(o.vStop) ? o.vStop : 1500, tMax = o.tMax || 5000, every = o.sampleEvery || 1;
      var r = x0.r.slice(), v = x0.v.slice(), t = 0, res = { t_top: 0, samples: [], peak_g: 0, t_peak_g: null, h_peak_g: null, peak_q: 0, t_peak_q: null, heat_J_m2: 0, min_alt: Infinity, end: null };
      if (!(X && X.flat) && norm(r) > top + 1e-3) {
        var c = coastTo(r, v, top, true);
        if (!c) { var el = elements(r, v); res.end = 'flyby'; res.perigee_alt = el.rp - RE; res.orbit = el; return res; }
        r = c.r; v = c.v; t = c.dt; res.t_top = c.dt;
      }
      var info = {}, g0p = null, g1p = null, q0p = null, q1p = null, tl = -1e9, nextS = t;
      deriv(r, v, veh, cb, sb, X, info);
      var push = function () { res.samples.push({ t: t, h: info.h, V: info.V, g: info.g, q: info.q, M: info.M }); };
      push(); nextS = t + every;
      while (t < tMax) {
        var st = (num(o.tStop) && t + dt > o.tStop) ? o.tStop - t : dt;
        if (!(st > 1e-9)) { res.end = 'time'; break; }
        var n = rk4(r, v, st, veh, cb, sb, X); r = n.r; v = n.v; t += st;
        var prevQ = info.q, prevG = info.g; info = {}; deriv(r, v, veh, cb, sb, X, info);
        if (info.h < res.min_alt) res.min_alt = info.h;
        // peaks, refined by a parabola through the three samples around the maximum
        if (g0p && g1p && g1p.y >= g0p.y && g1p.y >= info.g && g1p.y > res.peak_g) { var P = parabolaPeak(g0p.t, g0p.y, g1p.t, g1p.y, t, info.g); res.peak_g = P.y; res.t_peak_g = P.t; res.h_peak_g = g1p.h; res.V_peak_g = g1p.V; }
        g0p = g1p; g1p = { t: t, y: info.g, h: info.h, V: info.V };
        if (num(info.q)) {
          if (q0p && q1p && q1p.y >= q0p.y && q1p.y >= info.q && q1p.y > res.peak_q) { var Pq = parabolaPeak(q0p.t, q0p.y, q1p.t, q1p.y, t, info.q); res.peak_q = Pq.y; res.t_peak_q = Pq.t; res.h_peak_q = q1p.h; }
          q0p = q1p; q1p = { t: t, y: info.q, h: info.h };
          if (num(prevQ)) res.heat_J_m2 += 0.5 * (prevQ + info.q) * st;
        }
        if (t >= nextS || st < dt) { push(); nextS += every; }
        if (info.h < 0) { res.end = 'ground'; break; }
        if (X && X.flat ? (info.h > X.top && dot(v, X.up0) > 0) : (norm(r) > top && dot(r, v) > 0)) { res.end = 'exit'; break; }
        if (info.V < vStop && info.rho > 0) { res.end = 'slow'; break; }
        if (num(o.tStop) && t >= o.tStop - 1e-9) { res.end = 'time'; break; }
      }
      if (!res.end) res.end = 'tmax';
      if (res.peak_g < (g1p ? g1p.y : 0)) { res.peak_g = g1p.y; res.t_peak_g = g1p.t; res.h_peak_g = g1p.h; }
      res.t = t; res.r = r; res.v = v; res.final = clone(info);
      if (res.end === 'exit' && !(X && X.flat)) {
        var ex = elements(r, v); res.exit = { bound: ex.bound, apo_alt: ex.bound ? ex.ra - RE : null, peri_alt: ex.rp - RE, c3: ex.c3, e: ex.e, a: ex.a };
      }
      return res;
    }
    // Several passes: after an exit on a bound orbit whose perigee is in the atmosphere, coast to the next entry and fly
    // again (skip entry / aerobraking), until the vehicle stays in (slow or ground) or leaves for good.
    function flyPasses(x0, veh, o, maxPasses) {
      var passes = [], x = x0, tAcc = 0;
      for (var i = 0; i < (maxPasses || 6); i++) {
        var f = fly(x, veh, o); f.t_start = tAcc; passes.push(f);
        if (f.end !== 'exit' || !f.exit.bound || f.exit.peri_alt >= topOf(o && o.atm)) break;
        var c = coastTo(f.r, f.v, RE + topOf(o && o.atm), true); if (!c) break;
        tAcc += f.t + c.dt; x = { r: c.r, v: c.v };
      }
      return passes;
    }

    // ---------------------------------------------------------------- the arrival hyperbola, re-aimed to an entry angle
    // Given v-infinity (vector, toward the Earth), the plane normal hHat and an entry flight-path angle gamma at radius rEI,
    // the hyperbola is fixed: h = rEI vEI cos(gamma), e^2 = 1 + vinf^2 h^2 / mu^2, and the incoming asymptote
    // S = (1/e) P + (sqrt(e^2-1)/e) Q in its perifocal frame, so P = (1/e) S - (sqrt(e^2-1)/e) (hHat x S).
    function hyperbolaEntry(vinfVec, hHat, gammaDeg, rEI) {
      var vinf = norm(vinfVec), S0 = scale(vinfVec, 1 / vinf);
      var Sp = unit(sub(S0, scale(hHat, dot(S0, hHat))));
      var vE = Math.sqrt(vinf * vinf + 2 * MU / rEI), g = gammaDeg * DEG, h = rEI * vE * Math.cos(g);
      var e = Math.sqrt(1 + vinf * vinf * h * h / (MU * MU)), p = h * h / MU, rp = p / (1 + e);
      var w = cross(hHat, Sp), P = sub(scale(Sp, 1 / e), scale(w, Math.sqrt(e * e - 1) / e)), Q = cross(hHat, P);
      var c = (p / rEI - 1) / e; if (c > 1) c = 1;
      var nu = -Math.acos(c), k = Math.sqrt(MU / p);
      var r = add(scale(P, rEI * Math.cos(nu)), scale(Q, rEI * Math.sin(nu))), v = add(scale(P, -k * Math.sin(nu)), scale(Q, k * (e + Math.cos(nu))));
      var el = { e: e, a: -MU / (vinf * vinf), bound: false };
      return { r: r, v: v, rp: rp, perigee_alt: rp - RE, B: h / vinf, e: e, toPerigee: -tPeri(el, nu), offPlane: Math.asin(Math.min(1, Math.abs(dot(S0, hHat)))) };
    }
    function bOfPerigee(vinf, rp) { return rp * Math.sqrt(1 + 2 * MU / (rp * vinf * vinf)); }

    // ---------------------------------------------------------------- arrivals
    // An arrival is either the hyperbola idea 47 hands on (or one scaled from it), or a flown capsule's entry interface.
    var FLIGHTS = {
      stardust: { id: 'stardust', label: 'Stardust (15 Jan 2006)', vehicle: 'stardust', speed: SD.v_inertial_m_s, speedFrame: 'inertial', fpa: SD.fpa_final_deg, alt: SD.r_ei_m - RE, lat: SD.lat_deg, lon: SD.lon_deg, heading: SD.heading_deg,
        assumed: ['The entry point\'s latitude is the landing target\'s and its heading the landing ellipse\'s azimuth (the papers give no entry latitude or heading)'] },
      genesis: { id: 'genesis', label: 'Genesis (8 Sep 2004)', vehicle: 'genesis', speed: GN.v_inertial_m_s, speedFrame: 'inertial', fpa: GN.fpa_final_deg, alt: SD.r_ei_m - RE, lat: GN.lat_deg, lon: GN.lon_deg, heading: GN.heading_deg,
        assumed: ['Entry radius 6503.14 km as Stardust and OSIRIS-REx (the Genesis paper gives none)', 'The entry point\'s latitude is the landing target\'s and its heading the landing ellipse\'s azimuth'] },
      osirisrex: { id: 'osirisrex', label: 'OSIRIS-REx (24 Sep 2023)', vehicle: 'osirisrex', speed: OX.v_relative_m_s, speedFrame: 'relative-speed', fpa: OX.fpa_deg, alt: OX.r_ei_m - RE, lat: SD.lat_deg, lon: SD.lon_deg, heading: 90,
        assumed: ['Heading due east ("a direct posigrade trajectory") at the Utah range\'s latitude: the papers on file give neither (a 60-120 deg sweep moves peak deceleration by the amount shown in the reality table)'] }
    };
    function arrivalFromFlight(id, fpaOverride) {
      var F = FLIGHTS[id];
      var x0 = stateFromLocal({ lat: F.lat, lon: F.lon, alt: F.alt, speed: F.speed, speedFrame: F.speedFrame, fpa: num(fpaOverride) ? fpaOverride : F.fpa, heading: F.heading });
      var el = elements(x0.r, x0.v);
      return { kind: 'local', id: id, label: F.label, flight: F, rEI: RE + F.alt, c3: el.c3, vinf: el.c3 >= 0 ? Math.sqrt(el.c3) : null, x0: x0, assumed: F.assumed.slice() };
    }

    // Idea 47's handoff, checked without re-running idea 47 (its kernel and ephemerides are 400 KB): the envelope, the units,
    // and that its numbers agree with each other to 1e-6 (v-infinity against its vector, the declination, the entry speed,
    // the perigee state's energy, the mass ledger, the exhaust speed).
    function bad(why) { return { refusal: refusal('invalid_input', why, 'A handoff exported by idea 47 (Way Home) or by this page.') }; }
    function rel(a, b) { return Math.abs(a - b) / Math.max(1e-30, Math.abs(b)); }
    function importWayHome(h0) {
      var h = h0;
      if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { return bad('That is not JSON.'); } }
      if (!h || h.handoff !== 'long-way-round') return bad('That is not a Long Way Round handoff.');
      if (h.from !== '47-way-home') return bad('This is a handoff from ' + h.from + '; this page takes idea 47\'s (Way Home) or its own.');
      if (h.version !== 1) return bad('Version ' + h.version + ' is not one this page reads.');
      var O = h.outputs || {};
      var need = { earth_arrival: 'm/s, m, deg, s', mass: 'kg, m/s', propulsion: 's, m/s' };
      for (var k in need) { if (!O[k] || !O[k].value) return bad('It carries no ' + k + '.'); if (O[k].units !== need[k]) return bad(k + ' is in "' + O[k].units + '", not "' + need[k] + '".'); if (!O[k].confidence || !O[k].source) return bad(k + ' has no confidence or source.'); }
      var A = O.earth_arrival.value, M = O.mass.value, P = O.propulsion.value;
      var vv = A.v_infinity_vector_m_s, ps = A.perigee_state_geocentric;
      if (!Array.isArray(vv) || vv.length !== 3 || !vv.every(num) || !ps || !Array.isArray(ps.r_m) || !Array.isArray(ps.v_m_s)) return bad('The arrival has no v-infinity vector or perigee state.');
      if (!num(A.v_infinity_m_s) || rel(norm(vv), A.v_infinity_m_s) > 1e-6) return bad('Its v-infinity ' + fmt(A.v_infinity_m_s, 9) + ' m/s is not the length of its vector (' + fmt(norm(vv), 9) + '): it was edited.');
      if (Math.abs(Math.asin(vv[2] / norm(vv)) / DEG - A.declination_deg) > 1e-5) return bad('Its declination is not its vector\'s: it was edited.');
      var vinfH = num(A.v_infinity_after_braking_m_s) ? A.v_infinity_after_braking_m_s : A.v_infinity_m_s;
      if (!num(A.entry_altitude_m) || rel(Math.sqrt(vinfH * vinfH + 2 * MU / (RE + A.entry_altitude_m)), A.entry_speed_m_s) > 1e-6) return bad('Its entry speed is not √(v∞² + 2μ/r) with Aster\'s μ and the DE440 radius: it was edited, or made with other constants.');
      var en = dot(ps.v_m_s, ps.v_m_s) / 2 - MU / norm(ps.r_m);
      if (rel(Math.sqrt(2 * en), A.v_infinity_m_s) > 1e-6) return bad('Its perigee state\'s energy does not give its v-infinity: it was edited.');
      if (Math.abs(norm(ps.r_m) - RE - A.perigee_altitude_m) > 1) return bad('Its perigee altitude is not its perigee state\'s.');
      var pa = M.propellant_arrival_kg || {}, pArr = (num(pa.fuel) ? pa.fuel : 0) + (num(pa.oxidizer) ? pa.oxidizer : 0);
      if (!num(M.mass_arrival_kg) || !num(M.dry_kg) || !num(M.material_kg) || rel(M.mass_arrival_kg, M.dry_kg + M.material_kg + pArr) > 1e-6) return bad('Its arrival mass is not dry + material + propellant: it was edited.');
      if (!num(P.isp_s) || !num(P.ve_m_s) || rel(P.isp_s * G0, P.ve_m_s) > 1e-6) return bad('Its exhaust speed is not Isp × g0.');
      var tp = A.tdb_s_past_j2000;
      if (!num(tp) || Math.abs(tdbOf(A.utc) - tp) > 0.01) return bad('Its arrival time in TDB and UTC disagree.');
      var hHat = unit(cross(ps.r_m, ps.v_m_s));
      var isChain = !!(CHAIN_H && JSON.stringify(h) === JSON.stringify(CHAIN_H));
      return {
        kind: 'hyperbola', id: isChain ? 'chain' : 'imported', label: isChain ? 'The chain (idea 47: Apophis\'s material)' : 'Imported from idea 47', h47: h, chain: isChain,
        vinfVec: scale(unit(vv), vinfH), vinf: vinfH, c3: vinfH * vinfH, hHat: hHat, tp: tp, perigeeAlt47: A.perigee_altitude_m, B47: bOfPerigee(vinfH, norm(ps.r_m)),
        decl: A.declination_deg, ra: A.right_ascension_deg, mass_kg: M.mass_arrival_kg, dry_kg: M.dry_kg, material_kg: M.material_kg, propellant_kg: pArr, ve_m_s: P.ve_m_s, isp_s: P.isp_s,
        rEI: RE + A.entry_altitude_m, entryLimit: A.entry_limit_m_s, carried: (h.refusals || []).map(function (r) { var c = clone(r); if (!c.from) c.from = '47-way-home'; return c; }),
        assumed: []
      };
    }
    // A stand-alone arrival: the chain's geometry (asymptote direction, plane, time) with your v-infinity, mass and propellant.
    function customArrival(cu, base) {
      var a = clone(base); a.kind = 'hyperbola'; a.id = 'custom'; a.label = 'Your arrival (the chain\'s direction and time)'; a.chain = false;
      a.vinfVec = scale(unit(base.vinfVec), cu.vinf_m_s); a.vinf = cu.vinf_m_s; a.c3 = cu.vinf_m_s * cu.vinf_m_s;
      a.mass_kg = cu.mass_kg; a.propellant_kg = cu.propellant_kg; a.isp_s = cu.isp_s; a.ve_m_s = cu.isp_s * G0; a.dry_kg = null; a.material_kg = null;
      a.B47 = null; a.perigeeAlt47 = null; a.carried = []; a.h47 = null;
      a.assumed = ['The asymptote direction, the arrival plane and the perigee time are the chain\'s (idea 47); only the speed, mass and propellant are yours'];
      return a;
    }

    // An entry builder: gamma (deg) -> the state at the entry interface, its time and the re-aim it needs.
    function builderOf(arr) {
      if (arr.kind === 'local') return function (g) { var F = arr.flight; var x = stateFromLocal({ lat: F.lat, lon: F.lon, alt: F.alt, speed: F.speed, speedFrame: F.speedFrame, fpa: g, heading: F.heading }); x.tdb = null; return x; };
      return function (g) {
        var H = hyperbolaEntry(arr.vinfVec, arr.hHat, g, arr.rEI);
        return { r: H.r, v: H.v, tdb: arr.tp - H.toPerigee, rp: H.rp, perigee_alt: H.perigee_alt, B: H.B, offPlane: H.offPlane };
      };
    }

    // ---------------------------------------------------------------- corridors
    function bisect(f, a, b, iters) {   // f(a) true, f(b) false; returns the boundary
      for (var i = 0; i < (iters || 40); i++) { var m = (a + b) / 2; if (f(m)) a = m; else b = m; }
      return (a + b) / 2;
    }
    var FLY = { dt: 0.1, vStop: 1500 };
    function flyAt(build, veh, g, bank, extra) { var o = { bankDeg: bank, dt: FLY.dt, vStop: FLY.vStop }; if (extra) for (var k in extra) o[k] = extra[k]; return fly(build(g), veh, o); }
    function captured(f) { return f.end === 'slow' || f.end === 'ground' || f.end === 'time' || f.end === 'tmax'; }
    // Direct entry, the classical corridor: the shallow (overshoot) edge is the shallowest angle that stays in with full lift
    // down; the steep (undershoot) edge the steepest within the deceleration and heat-rate limits with full lift up (a
    // guided vehicle flies between them by rolling). For a ballistic capsule the bank does nothing and both use it.
    // Angles in degrees, negative.
    function corridorDirect(build, veh, lim) {
      var shallow = -0.25, steep = -25, bDown = veh.cl > 0 ? 180 : 0, bUp = 0;
      if (!captured(flyAt(build, veh, steep, bDown))) return { refusal: refusal('out_of_envelope', 'Even at ' + steep + '° the vehicle does not stay in the atmosphere.', 'A heavier vehicle (higher ballistic coefficient) or less lift.') };
      var fS = flyAt(build, veh, shallow, bDown);
      var gOS = captured(fS) ? shallow : bisect(function (g) { return !captured(flyAt(build, veh, g, bDown)); }, shallow, steep, 26);
      var bank = bUp;
      var okAt = function (g) { var f = flyAt(build, veh, g, bank); return f.peak_g <= lim.g && (!num(lim.q) || !num(f.peak_q) || f.peak_q <= lim.q) && f.end !== 'ground'; };
      var gEdge = gOS - 1e-6, fE = flyAt(build, veh, gEdge, bank);
      if (!captured(fE)) fE = flyAt(build, veh, gEdge, bDown);
      var res = { shallow: gOS, shallow_flight: summary(fE) };
      if (!okAt(gEdge)) { res.steep = null; res.width = 0; res.limited_by = fE.end === 'ground' ? 'ground' : (fE.peak_g > lim.g ? 'deceleration' : 'heating'); return res; }
      var gUS = okAt(steep) ? steep : bisect(okAt, gEdge, steep, 26);
      var fU = flyAt(build, veh, gUS, bank);
      res.steep = gUS; res.width = gOS - gUS; res.steep_flight = summary(fU);
      res.limited_by = fU.end === 'ground' ? 'ground' : (Math.abs(fU.peak_g - lim.g) / lim.g < 1e-3 ? 'deceleration' : 'heating');
      return res;
    }
    function summary(f) {
      return { end: f.end, peak_g: f.peak_g, t_peak_g: num(f.t_peak_g) ? f.t_peak_g : null, h_peak_g: f.h_peak_g, peak_q_W_m2: f.peak_q, t_peak_q: f.t_peak_q, heat_J_m2: f.heat_J_m2, min_alt: f.min_alt, exit: f.exit || null };
    }
    // Aerocapture: the exit apoapsis against the entry angle at a fixed bank; the angle that gives the target apoapsis.
    function apoOf(f) { if (f.end === 'flyby') return Infinity; if (f.end !== 'exit') return -Infinity; return f.exit.bound ? f.exit.apo_alt : Infinity; }
    function aeroAngle(build, veh, bank, apoTarget) {
      var shallow = -0.25, steep = -25;
      if (!(apoOf(flyAt(build, veh, shallow, bank)) > apoTarget)) return null;   // even the shallowest stays below the target
      var g = bisect(function (x) { return apoOf(flyAt(build, veh, x, bank)) > apoTarget; }, shallow, steep, 30);
      var f = flyAt(build, veh, g, bank);
      if (f.end !== 'exit') { g -= 1e-6; f = flyAt(build, veh, g + 2e-6, bank); }
      return { gamma: g, flight: f };
    }
    function corridorAero(build, veh, apoTarget) {
      if (!(veh.cl > 0)) return { refusal: refusal('out_of_envelope', 'A ballistic capsule (no lift) has a single entry angle that leaves at the target apoapsis, so no corridor: any navigation error misses it.', 'A lifting vehicle (L/D > 0), such as the Apollo-derived capsule.', { applies_to: 'aerocapture' }) };
      var down = aeroAngle(build, veh, 180, apoTarget), up = aeroAngle(build, veh, 0, apoTarget), mid = aeroAngle(build, veh, 90, apoTarget);
      if (!down || !up || !mid) return { refusal: refusal('out_of_envelope', 'No entry angle leaves the atmosphere at the target apoapsis with ' + (!down ? 'lift down' : !up ? 'lift up' : 'lift horizontal') + '.', 'A lower target apoapsis, or a different vehicle.', { applies_to: 'aerocapture' }) };
      return { shallow: down.gamma, steep: up.gamma, width: down.gamma - up.gamma, mid: mid, down: down, up: up };
    }

    // ---------------------------------------------------------------- the other options
    function propellantFor(m, dv, ve) { return m * (1 - Math.exp(-dv / ve)); }
    function circular(r) { return Math.sqrt(MU / r); }
    // Propulsive capture at perigee into an orbit (perigee, apogee radii); works for any arrival energy.
    function propulsive(c3, rp, ra) {
      var vHyp = Math.sqrt(c3 + 2 * MU / rp), vOrb = Math.sqrt(2 * MU / rp - 2 * MU / (rp + ra));
      return { dv: vHyp - vOrb, v_arrival: vHyp, v_orbit: vOrb };
    }
    // Lunar gravity assist, patched conics, coplanar, the Moon on a circular orbit of radius a at sqrt(mu_EM/a). The
    // payload crosses the Moon's orbit at speed v = sqrt(vinf^2 + 2 mu/a) in any direction phi from the Moon's motion
    // (the hyperbola's aim decides it); the flyby turns the Moon-relative velocity w by up to
    // delta = 2 asin(1 / (1 + rp w^2 / mu_moon)). Best case: the turn that brings the geocentric velocity closest to
    // anti-parallel to the Moon's; phi searched. Returns the lowest post-flyby C3.
    function lunarBest(c3, a, rpMoon) {
      var vm = Math.sqrt(MU_EM / a), v2 = c3 + 2 * MU / a;
      if (!(v2 > 0)) return null;
      var v = Math.sqrt(v2), best = null;
      var at = function (phi) {
        var wx = v * Math.cos(phi) - vm, wy = v * Math.sin(phi), w = Math.hypot(wx, wy);
        var d = 2 * Math.asin(1 / (1 + rpMoon * w * w / MU_MOON)), th = Math.atan2(wy, wx), thA = Math.abs(th);
        var th2 = Math.min(PI, thA + d);
        var vp2 = vm * vm + w * w + 2 * vm * w * Math.cos(th2);
        return { phi: phi, w: w, delta: d, c3: vp2 - 2 * MU / a, v_after: Math.sqrt(vp2) };
      };
      for (var i = 0; i < 720; i++) { var r = at(i * PI / 360); if (!best || r.c3 < best.c3) best = r; }
      var lo = best.phi - PI / 360, hi = best.phi + PI / 360;
      for (var k = 0; k < 60; k++) { var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (at(m1).c3 < at(m2).c3) hi = m2; else lo = m1; }
      var b = at((lo + hi) / 2); if (b.c3 < best.c3) best = b;
      best.v_before = v; best.v_moon = vm; best.c3_before = c3;
      return best;
    }
    function lunarThreshold(a, rpMoon) {   // the largest arrival v-infinity one flyby can bring to C3 = 0
      var f = function (vi) { var b = lunarBest(vi * vi, a, rpMoon); return b && b.c3 <= 0; };
      if (!f(0)) return 0;
      var lo = 0, hi = 5000; while (f(hi)) hi *= 2;
      for (var i = 0; i < 50; i++) { var m = (lo + hi) / 2; if (f(m)) lo = m; else hi = m; }
      return lo;
    }

    // ---------------------------------------------------------------- settings
    function defaults() {
      return { arrival: 'chain', custom: null, vehicle: 'auto', vehicleMass: 'arrival', fpaDeg: null, bankDeg: 90, gLimit: SD.req_g, qLimit_W_cm2: SD.req_q_W_cm2,
        targetAlt_m: S.transhab.target_alt_m, lgaAlt_m: 0, moonDist: 'a', tolerance_m_s: TM ? TM.DEFAULT_TOLERANCE_MS : 1, tcmDays: OX.tcm11_days, margin: MARGIN, choice: 'auto' };
    }
    function customDefaults() {
      var c = CHAIN_H ? importWayHome(CHAIN_H) : null;
      return { vinf_m_s: c && !c.refusal ? c.vinf : 5000, mass_kg: c && !c.refusal ? c.mass_kg : 1000, propellant_kg: c && !c.refusal ? c.propellant_kg : 0, isp_s: c && !c.refusal ? c.isp_s : 300 };
    }
    var CHOICES = ['auto', 'direct', 'aerocapture', 'skip', 'propulsive', 'lunar', 'skyhook'];
    var ARRIVALS = ['chain', 'imported', 'custom', 'stardust', 'genesis', 'osirisrex'];
    function validSettings(Sin) {
      function bad2(w, h) { return { refusal: refusal('invalid_input', w, h) }; }
      var raw = Sin || {};   // a non-finite number would turn into null in the copy below, and null means "auto" for the angle
      for (var rk in raw) if (typeof raw[rk] === 'number' && !isFinite(raw[rk])) return bad2('"' + rk + '" is not a finite number.', 'A number, or leave the field empty where empty is allowed.');
      if (raw.custom) for (var ck in raw.custom) if (typeof raw.custom[ck] === 'number' && !isFinite(raw.custom[ck])) return bad2('Your "' + ck + '" is not a finite number.', 'A number.');
      var S0 = defaults(), Sx = clone(raw);
      for (var k in S0) if (Sx[k] === undefined) Sx[k] = S0[k];
      if (ARRIVALS.indexOf(Sx.arrival) < 0) return bad2('Unknown arrival "' + Sx.arrival + '".', 'One of ' + ARRIVALS.join(', ') + '.');
      if (CHOICES.indexOf(Sx.choice) < 0) return bad2('Unknown option "' + Sx.choice + '".', 'One of ' + CHOICES.join(', ') + '.');
      if (Sx.vehicle !== 'auto' && !VEHICLES[Sx.vehicle]) return bad2('Unknown vehicle "' + Sx.vehicle + '".', 'auto or one of ' + VEH_ORDER.join(', ') + '.');
      if (Sx.vehicleMass !== 'arrival' && Sx.vehicleMass !== 'preset' && !(num(Sx.vehicleMass) && Sx.vehicleMass > 0 && Sx.vehicleMass < 1e6)) return bad2('The entry mass must be "arrival", "preset" or a mass between 0 and 1,000 t.', 'A mass in kg.');
      if (Sx.fpaDeg !== null && !(num(Sx.fpaDeg) && Sx.fpaDeg < 0 && Sx.fpaDeg >= -30)) return bad2('The entry flight-path angle must be below 0° and no steeper than -30° (or empty for mid-corridor).', 'An angle such as -8.2° (Stardust\'s and OSIRIS-REx\'s).');
      if (!(num(Sx.bankDeg) && Sx.bankDeg >= 0 && Sx.bankDeg <= 180)) return bad2('The bank angle must be 0 to 180°.', '0 is lift up, 180 lift down.');
      if (!(num(Sx.gLimit) && Sx.gLimit >= 1 && Sx.gLimit <= 500)) return bad2('The deceleration limit must be 1 to 500 g.', 'Stardust and Genesis were held to 40 g; the TransHab crew study to 5 g.');
      if (!(num(Sx.qLimit_W_cm2) && Sx.qLimit_W_cm2 > 0 && Sx.qLimit_W_cm2 <= 1e5)) return bad2('The heat-rate limit must be above 0 W/cm².', 'Stardust\'s PICA was held to 1200 W/cm², Genesis to 510.');
      if (!(num(Sx.targetAlt_m) && Sx.targetAlt_m >= 150000 && Sx.targetAlt_m <= 1e9)) return bad2('The target orbit altitude must be 150 km or more.', 'The TransHab study\'s 407 km, or higher.');
      if (!(num(Sx.lgaAlt_m) && Sx.lgaAlt_m >= 0 && Sx.lgaAlt_m <= 1e8)) return bad2('The lunar flyby altitude must be 0 or more.', 'Altitude above the Moon\'s mean radius, m.');
      if (['a', 'perigee', 'apogee'].indexOf(Sx.moonDist) < 0) return bad2('The Moon\'s distance must be a, perigee or apogee.', 'a = NSSDCA\'s semimajor axis.');
      if (!(num(Sx.tolerance_m_s) && Sx.tolerance_m_s >= 0)) return bad2('The grapple tolerance must be 0 m/s or more.', 'Idea 01\'s default, 1 m/s.');
      if (!(num(Sx.tcmDays) && Sx.tcmDays > 0 && Sx.tcmDays <= 365)) return bad2('The correction must come 0 to 365 days before entry.', 'OSIRIS-REx\'s TCM-11 was 14 days out.');
      if (!(num(Sx.margin) && Sx.margin >= 0 && Sx.margin <= 2)) return bad2('The delta-v margin must be 0 to 200 %.', 'Aster\'s 10 %.');
      if (Sx.arrival === 'custom') {
        var c = Sx.custom || customDefaults();
        if (!(num(c.vinf_m_s) && c.vinf_m_s >= 0 && c.vinf_m_s <= 72000)) return bad2('Your v-infinity must be 0 to 72 km/s.', 'Asteroid returns arrive at a few km/s (the chain: 5.86).');
        if (!(num(c.mass_kg) && c.mass_kg > 0)) return bad2('Your arrival mass must be above 0.', 'A mass in kg.');
        if (!(num(c.propellant_kg) && c.propellant_kg >= 0 && c.propellant_kg < c.mass_kg)) return bad2('Your propellant must be 0 or more and less than the mass.', 'A mass in kg.');
        if (!(num(c.isp_s) && c.isp_s > 0 && c.isp_s <= 10000)) return bad2('Your Isp must be above 0 s.', 'Idea 46\'s 423 s, or your engine\'s.');
        Sx.custom = c;
      }
      return { S: Sx };
    }

    // ---------------------------------------------------------------- one run: every option, then the choice
    function run(Sin, input) {
      var v = validSettings(Sin); if (v.refusal) return { refusal: v.refusal };
      var Sx = v.S, arr, refusals = [], assumptions = [];
      if (Sx.arrival === 'stardust' || Sx.arrival === 'genesis' || Sx.arrival === 'osirisrex') arr = arrivalFromFlight(Sx.arrival);
      else {
        var h47 = input && input.h47 ? input.h47 : CHAIN_H;
        if (!h47) return { refusal: refusal('not_found', 'No idea 47 handoff is loaded.', 'Import one, or open the page with the bundled chain.') };
        var imp = importWayHome(h47); if (imp.refusal) return { refusal: imp.refusal };
        arr = Sx.arrival === 'custom' ? customArrival(Sx.custom, imp) : imp;
      }
      var vehId = Sx.vehicle === 'auto' ? (arr.kind === 'local' ? arr.flight.vehicle : 'apollo') : Sx.vehicle;
      var mass = Sx.vehicleMass === 'preset' ? VEHICLES[vehId].mass_kg : Sx.vehicleMass === 'arrival' ? (arr.kind === 'local' ? VEHICLES[arr.flight.vehicle].mass_kg : arr.mass_kg) : Sx.vehicleMass;
      var veh = vehicle(vehId, mass);
      var build = builderOf(arr), lim = { g: Sx.gLimit, q: Sx.qLimit_W_cm2 * 1e4 };
      var propAvail = arr.kind === 'local' ? 0 : arr.propellant_kg, ve = arr.kind === 'local' ? null : arr.ve_m_s;
      var opts = {};

      // 1. direct entry
      var cd = corridorDirect(build, veh, lim), d = { id: 'direct', label: 'Direct entry', destination: 'ground', refusals: [] };
      if (cd.refusal) { d.feasible = false; d.refusals.push(cd.refusal); }
      else {
        d.corridor = { shallow_deg: cd.shallow, steep_deg: cd.steep, width_deg: cd.width, limited_by: cd.limited_by };
        var gSel = num(Sx.fpaDeg) ? Sx.fpaDeg : (cd.width > 0 ? (cd.shallow + cd.steep) / 2 : cd.shallow - 0.5);
        d.gamma = gSel; d.gamma_source = num(Sx.fpaDeg) ? 'yours' : (cd.width > 0 ? 'mid-corridor' : 'just inside the shallow edge (no corridor)');
        var x = build(gSel), f = fly(x, veh, { bankDeg: Sx.bankDeg, dt: FLY.dt, vStop: FLY.vStop });
        d.flight = f; d.entry = x; d.loads = summary(f); d.dv = 0; d.propellant_needed = 0;
        d.feasible = cd.width > 0 && captured(f) && f.end !== 'ground' && f.peak_g <= lim.g && (!num(f.peak_q) || f.peak_q <= lim.q);
        if (!(cd.width > 0)) d.refusals.push(refusal('out_of_envelope', 'No direct-entry corridor: at the shallowest angle that stays in, the ' + (cd.limited_by === 'ground' ? 'vehicle reaches the ground before slowing' : cd.limited_by + ' limit is already exceeded') + ' (' + fmt(cd.shallow_flight.peak_g, 3) + ' g, ' + fmt(cd.shallow_flight.peak_q_W_m2 / 1e4, 3) + ' W/cm²).', 'Slow the arrival first (braking far out, idea 47), a vehicle with more lift or drag area, or a higher limit.', { applies_to: 'direct' }));
        else if (!d.feasible) d.refusals.push(refusal('out_of_envelope', 'At ' + fmt(gSel, 4) + '° the entry ' + (f.end === 'exit' ? 'skips out' : f.end === 'ground' ? 'reaches the ground' : 'exceeds a limit (' + fmt(f.peak_g, 3) + ' g, ' + fmt(f.peak_q / 1e4, 3) + ' W/cm²)') + '; the corridor is ' + fmt(cd.steep, 4) + '° to ' + fmt(cd.shallow, 4) + '°.', 'An angle inside the corridor.', { applies_to: 'direct' }));
        d.corridor_vs_nav = { width_deg: cd.width, delivery_3sigma_deg: SD.req_fpa_err_deg };
        if (cd.width > 0 && cd.width < 2 * SD.req_fpa_err_deg) d.refusals.push(refusal('out_of_envelope', 'The corridor (' + fmt(cd.width, 3) + '°) is narrower than ±' + SD.req_fpa_err_deg + '°, the delivery accuracy Stardust, Genesis and OSIRIS-REx were held to.', 'Better navigation than those missions\' requirement, or a wider corridor (lift, lower speed).', { applies_to: 'direct' }));
      }
      opts.direct = d;

      // 2. aerocapture (and 3. skip entry)
      var ca = corridorAero(build, veh, Sx.targetAlt_m), ac = { id: 'aerocapture', label: 'Aerocapture', destination: 'orbit', refusals: [] }, sk = { id: 'skip', label: 'Skip entry (no burn)', destination: 'ground', refusals: [] };
      if (ca.refusal) { ac.feasible = false; ac.refusals.push(ca.refusal); sk.feasible = false; sk.refusals.push(refusal(ca.refusal.code, ca.refusal.reason, ca.refusal.what_would_help, { applies_to: 'skip' })); }
      else {
        ac.corridor = { shallow_deg: ca.shallow, steep_deg: ca.steep, width_deg: ca.width, mid_deg: ca.mid.gamma, bank_mid_deg: 90 };
        var fm = ca.mid.flight, rpT = RE + Sx.targetAlt_m, ra = RE + fm.exit.apo_alt, rp0 = RE + fm.exit.peri_alt;
        var vA = Math.sqrt(MU * (2 / ra - 2 / (ra + rp0))), vA2 = Math.sqrt(MU * (2 / ra - 2 / (ra + rpT)));
        ac.gamma = ca.mid.gamma; ac.flight = fm; ac.entry = build(ca.mid.gamma); ac.loads = summary(fm);
        ac.dv = (vA2 - vA) * (1 + Sx.margin); ac.dv_raw = vA2 - vA;
        ac.edges = { lift_down: summary(ca.down.flight), lift_up: summary(ca.up.flight) };
        ac.orbit = { peri_alt_m: Sx.targetAlt_m, apo_alt_m: fm.exit.apo_alt, exit_peri_alt_m: fm.exit.peri_alt };
        var worstG = Math.max(fm.peak_g, ca.up.flight.peak_g), worstQ = Math.max(fm.peak_q || 0, ca.up.flight.peak_q || 0);
        if (ve) { ac.propellant_needed = propellantFor(veh.mass_kg, ac.dv, ve); }
        ac.feasible = ca.width > 0 && worstG <= lim.g && worstQ <= lim.q && (ve ? ac.propellant_needed <= propAvail : false);
        if (worstG > lim.g || worstQ > lim.q) ac.refusals.push(refusal('out_of_envelope', 'The steep (lift-up) edge of the corridor reaches ' + fmt(ca.up.flight.peak_g, 3) + ' g and ' + fmt(ca.up.flight.peak_q / 1e4, 3) + ' W/cm², over the limits.', 'A higher apoapsis target, or a slower arrival.', { applies_to: 'aerocapture' }));
        if (!ve) ac.refusals.push(refusal('insufficient_data', 'A flown capsule carries no engine: the perigee-raise burn (' + fmt(ac.dv, 3) + ' m/s) cannot be paid.', 'A propulsion system on the entry vehicle.', { applies_to: 'aerocapture' }));
        else if (ac.propellant_needed > propAvail) ac.refusals.push(refusal('out_of_envelope', 'Raising the perigee out of the atmosphere at apoapsis needs ' + fmt(ac.dv, 3) + ' m/s (with the ' + fmt(Sx.margin * 100, 3) + ' % margin): ' + fmt(ac.propellant_needed, 3) + ' kg of propellant at ' + fmt(ve, 4) + ' m/s; ' + fmt(propAvail, 3) + ' kg arrives.', 'Carry that propellant home (module 47 with a capture reserve), or skip entry instead (the next pass lands).', { applies_to: 'aerocapture' }));
        // skip entry: the same pass, no burn; the next perigee pass lands
        var passes = flyPasses(ac.entry, veh, { bankDeg: 90, dt: FLY.dt, vStop: FLY.vStop }, 6), last = passes[passes.length - 1];
        sk.gamma = ca.mid.gamma; sk.corridor = clone(ac.corridor); sk.passes = passes.map(summary); sk.passFlights = passes; sk.flight = passes[0]; sk.entry = ac.entry; sk.dv = 0; sk.propellant_needed = 0;
        sk.loads = { peak_g: Math.max.apply(null, passes.map(function (p) { return p.peak_g; })), peak_q_W_m2: Math.max.apply(null, passes.map(function (p) { return p.peak_q || 0; })), heat_J_m2: passes.reduce(function (s, p) { return s + p.heat_J_m2; }, 0), n_passes: passes.length, t_total_s: last.t_start + last.t };
        sk.second_entry_speed = passes.length > 1 ? passes[1].samples[0].V : null;
        sk.feasible = captured(last) && last.end !== 'ground' && sk.loads.peak_g <= lim.g && sk.loads.peak_q_W_m2 <= lim.q;
        if (!captured(last)) sk.refusals.push(refusal('out_of_envelope', 'After ' + passes.length + ' passes the vehicle still leaves the atmosphere.', 'A steeper entry or more passes.', { applies_to: 'skip' }));
        else if (!sk.feasible) sk.refusals.push(refusal('out_of_envelope', 'The passes reach ' + fmt(sk.loads.peak_g, 3) + ' g and ' + fmt(sk.loads.peak_q_W_m2 / 1e4, 3) + ' W/cm².', 'Higher limits or a slower arrival.', { applies_to: 'skip' }));
      }
      opts.aerocapture = ac; opts.skip = sk;

      // 4. propulsive capture at perigee into the target orbit (circular at the target altitude)
      var pr = { id: 'propulsive', label: 'Propulsive capture', destination: 'orbit', refusals: [] }, rT = RE + Sx.targetAlt_m, pc = propulsive(arr.c3, rT, rT);
      pr.dv = pc.dv * (1 + Sx.margin); pr.dv_raw = pc.dv; pr.orbit = { peri_alt_m: Sx.targetAlt_m, apo_alt_m: Sx.targetAlt_m };
      var pLoose = propulsive(arr.c3, rT, MOON.a_m); /* apogee at the Moon's mean distance (NSSDCA) */ pr.loose = { dv: pLoose.dv * (1 + Sx.margin), apo_alt_m: MOON.a_m - RE };
      if (ve) { pr.propellant_needed = propellantFor(veh.mass_kg, pr.dv, ve); pr.propellant_dry_only = arr.dry_kg ? arr.dry_kg * (Math.exp(pr.dv / ve) - 1) : null; pr.propellant_loose = propellantFor(veh.mass_kg, pr.loose.dv, ve); }
      pr.feasible = !!ve && pr.propellant_needed <= propAvail;
      if (!ve) pr.refusals.push(refusal('insufficient_data', 'A flown capsule carries no engine for a capture burn.', 'A propulsion system.', { applies_to: 'propulsive' }));
      else if (!pr.feasible) pr.refusals.push(refusal('out_of_envelope', 'Capture into a ' + fmt(Sx.targetAlt_m / 1000, 4) + ' km circular orbit needs ' + fmt(pr.dv, 4) + ' m/s at perigee: ' + fmt(pr.propellant_needed, 4) + ' kg of propellant' + (pr.propellant_dry_only ? ' (' + fmt(pr.propellant_dry_only, 4) + ' kg to capture the dry craft alone)' : '') + '; ' + fmt(propAvail, 3) + ' kg arrives. Even a loose orbit with apogee at the Moon\'s distance needs ' + fmt(pr.loose.dv, 4) + ' m/s, ' + fmt(pr.propellant_loose, 4) + ' kg.', 'Carry capture propellant home (module 47), or capture with the atmosphere.', { applies_to: 'propulsive' }));
      opts.propulsive = pr;

      // 5. lunar gravity assist
      var lu = { id: 'lunar', label: 'Lunar flyby', destination: 'orbit', refusals: [] };
      var aM = Sx.moonDist === 'perigee' ? MOON.perigee_m : Sx.moonDist === 'apogee' ? MOON.apogee_m : MOON.a_m, rpM = MOON.radius_m + Sx.lgaAlt_m;
      lu.threshold_vinf = lunarThreshold(aM, rpM); lu.moon_distance_m = aM; lu.flyby_radius_m = rpM;
      if (!(arr.c3 >= 0)) { lu.feasible = false; lu.refusals.push(refusal('out_of_envelope', 'The arrival is already bound to the Earth (C3 ' + fmt(arr.c3 / 1e6, 3) + ' km²/s²): there is no v-infinity for the Moon to remove.', 'Nothing: it is already captured.', { applies_to: 'lunar' })); }
      else {
        var lb = lunarBest(arr.c3, aM, rpM); lu.best = lb; lu.dv = 0; lu.propellant_needed = 0;
        lu.c3_after = lb ? lb.c3 : null; lu.vinf_after = lb && lb.c3 > 0 ? Math.sqrt(lb.c3) : 0;
        lu.energy_ok = !!lb && lb.c3 < 0;
        lu.feasible = false;   // energy is computed; the Moon's phase is not, so it is never offered as feasible here
        if (!lu.energy_ok) lu.refusals.push(refusal('out_of_envelope', 'At best one flyby takes v∞ from ' + fmt(arr.vinf / 1000, 4) + ' to ' + fmt(lu.vinf_after / 1000, 4) + ' km/s (C3 ' + fmt(arr.c3 / 1e6, 4) + ' → ' + fmt(lb.c3 / 1e6, 4) + ' km²/s²): a single flyby captures only arrivals below ' + fmt(lu.threshold_vinf / 1000, 4) + ' km/s.', 'A slower arrival, or a sequence of lunar and solar-perturbed flybys (NASA\'s ARRM designs used them for up to 2 km²/s² of C3).', { applies_to: 'lunar' }));
        lu.refusals.push(refusal('insufficient_data', 'The Moon\'s position at the arrival is not checked: the best flyby needs the Moon at a particular place on the incoming leg at the right hour, which moves the arrival time module 47 chose.', 'Module 47 re-targeted to an arrival time that meets the Moon (lunar ephemeris), then this flyby flown through both bodies.', { applies_to: 'lunar_phase' }));
      }
      opts.lunar = lu;

      // 6. Skyhook upper-tip catch (idea 01's kernel)
      var sh = { id: 'skyhook', label: 'Skyhook catch', destination: 'tether', refusals: [] };
      if (!TM_K) { sh.feasible = false; sh.refusals.push(TM_REFUSAL); }
      else if (!(arr.c3 >= 0)) { sh.feasible = false; sh.refusals.push(refusal('out_of_envelope', 'Idea 01\'s kernel takes v∞ ≥ 0; this arrival is bound (C3 ' + fmt(arr.c3 / 1e6, 3) + ' km²/s²).', 'A hyperbolic arrival, or an arrival-C3 input to idea 01 (its finding F4).', { applies_to: 'skyhook' })); }
      else {
        var tiers = TM_K.constants.tierOrder.map(function (k) { var env = TM_K.energy({ tier: k, vinf_kms: arr.vinf / 1000, tolerance_ms: Sx.tolerance_m_s, as_of: '2026-11-01' }); return { tier: k, env: env, trim_m_s: env.value ? env.value.upper_tip.trim_dv_ms.value : null, matched: env.value ? env.value.match.energy_matched : false }; });
        sh.tiers = tiers.map(function (t) { return { tier: t.tier, trim_m_s: t.trim_m_s, matched: t.matched, refusal: t.env.refusal || null }; });
        var ok = tiers.filter(function (t) { return num(t.trim_m_s); }).sort(function (a, b) { return Math.abs(a.trim_m_s) - Math.abs(b.trim_m_s); });
        var bestT = ok[0];
        sh.best_tier = bestT ? bestT.tier : null; sh.dv = bestT ? Math.abs(bestT.trim_m_s) * (bestT.matched ? 0 : 1) * (1 + Sx.margin) : null;
        var payloadMax = REVA.data.mass_ratio.integrated_tether_to_payload_both_arms.payload_mass_kg_for_tonnage;
        sh.payload_design_kg = payloadMax;
        if (ve && num(sh.dv)) sh.propellant_needed = propellantFor(veh.mass_kg, sh.dv, ve);
        var energyOK = bestT && (bestT.matched || (ve && sh.propellant_needed <= propAvail));
        if (bestT && !bestT.matched) sh.refusals.push(refusal('out_of_envelope', 'Energy: the payload passes the upper tip ' + fmt(Math.abs(bestT.trim_m_s), 4) + ' m/s ' + (bestT.trim_m_s > 0 ? 'faster' : 'slower') + ' than the ' + bestT.tier + ' tip (the closest tier; idea 01\'s kernel), outside the ' + Sx.tolerance_m_s + ' m/s grapple tolerance' + (ve ? '; trimming it at perigee needs ' + fmt(sh.propellant_needed, 4) + ' kg, ' + fmt(propAvail, 3) + ' kg arrives' : '') + '.', 'An arrival at v∞* (idea 01: 3.613 km/s for the Phase 3 tier), or the trim propellant.', { applies_to: 'skyhook_energy' }));
        var massOK = veh.mass_kg <= payloadMax;
        if (!massOK) sh.refusals.push(refusal('out_of_envelope', 'Mass: ' + fmt(veh.mass_kg, 4) + ' kg against the ' + payloadMax + ' kg payload Rev A sizes the tether for (params/rev_a.json mass_ratio.payload_mass_kg_for_tonnage).', 'Split the material into payloads of ' + payloadMax + ' kg or less, or a tether sized for it.', { applies_to: 'skyhook_mass' }));
        var dec = arr.kind === 'hyperbola' ? arr.decl : null;
        sh.min_inclination_deg = num(dec) ? Math.abs(dec) : null;
        sh.refusals.push(refusal('insufficient_data', 'Plane: ' + (num(dec) ? 'the arrival hyperbola contains its asymptote, so its plane is inclined at least ' + fmt(Math.abs(dec), 3) + '° (the asymptote\'s declination) to the equator; ' : 'this arrival carries no asymptote direction; ') + 'Rev A states no tether inclination (its lower-tip ground speed note assumes an equatorial orbit, which this arrival cannot share).', 'The tether\'s orbital inclination and node in rev_a.json, then the arrival aimed into that plane.', { applies_to: 'skyhook_plane' }));
        sh.refusals.push(TM_K.phase({}).refusal ? (function () { var r = clone(TM_K.phase({}).refusal); r.applies_to = 'skyhook_phase'; return r; })() : refusal('insufficient_data', 'Phase: no tether ephemeris.', 'A tether ephemeris.', { applies_to: 'skyhook_phase' }));
        sh.feasible = false;   // plane and phase cannot be shown; energy and mass are computed
        sh.energy_ok = !!energyOK; sh.mass_ok = massOK;
        // what the tether would hand on if it caught: released from the lower tip at the bottom of its swing
        if (bestT) {
          var c = TM_K.constants, tierE = TM_K.tierEnergy(bestT.tier), vLow = tierE.v_lower_tip_inertial_kms * 1000, rLow = c.r_low_km * 1000, rEItm = (c.earth_radius_km * 1000) + ENTRY_ALT;
          var vE2 = vLow * vLow + 2 * MU * (1 / rEItm - 1 / rLow), vEl = Math.sqrt(vE2), cg = rLow * vLow / (rEItm * vEl);
          sh.release = { tier: bestT.tier, v_lower_tip_m_s: vLow, r_lower_tip_m: rLow, entry_speed_inertial_m_s: vEl, entry_fpa_deg: -Math.acos(Math.min(1, cg)) / DEG, earth_radius_convention_m: c.earth_radius_km * 1000 };
        }
      }
      opts.skyhook = sh;

      // ---------------------------------------------------------------- the choice
      var order = ['direct', 'skip', 'aerocapture', 'propulsive', 'lunar', 'skyhook'], chosen = null, chosenBy;
      if (Sx.choice === 'auto') {
        var feas = order.filter(function (k) { return opts[k].feasible; }).sort(function (a, b) { var A = opts[a], B = opts[b]; var pa = A.propellant_needed || 0, pb = B.propellant_needed || 0; if (Math.abs(pa - pb) > 1e-9) return pa - pb; return (A.loads ? A.loads.peak_g : 0) - (B.loads ? B.loads.peak_g : 0); });
        chosen = feas[0] || null; chosenBy = chosen ? 'the feasible option needing the least propellant, then the lowest peak deceleration' : 'none feasible';
      } else { chosen = Sx.choice; chosenBy = 'yours'; }
      if (!chosen) refusals.push(refusal('out_of_envelope', 'No option is feasible for this arrival with these limits.', 'Raise a limit, change the vehicle, or slow the arrival in module 47.', { applies_to: 'capture' }));

      // retarget from idea 47's aim (hyperbolic arrivals): the perigee the entry angle needs, and the correction
      var C = chosen ? opts[chosen] : null, retarget = null;
      if (C && C.entry && arr.kind === 'hyperbola') {
        var H = build(C.gamma);
        retarget = { gamma_deg: C.gamma, perigee_alt_m: H.perigee_alt, B_m: H.B, B47_m: arr.B47, perigee_alt47_m: arr.perigeeAlt47, tcm_days: Sx.tcmDays, off_plane_rad: H.offPlane };
        if (num(arr.B47)) {
          retarget.dB_m = Math.abs(H.B - arr.B47); retarget.dv = retarget.dB_m / (Sx.tcmDays * DAY) * (1 + Sx.margin);
          retarget.propellant_needed = propellantFor(veh.mass_kg, retarget.dv, arr.ve_m_s);
          if (retarget.propellant_needed > propAvail) refusals.push(refusal('out_of_envelope', 'Idea 47 aims at a ' + fmt(arr.perigeeAlt47 / 1000, 4) + ' km perigee, a flyby: entering at ' + fmt(C.gamma, 4) + '° needs a perigee at ' + fmt(H.perigee_alt / 1000, 4) + ' km (B ' + fmt(retarget.dB_m / 1000, 4) + ' km nearer). A correction ' + Sx.tcmDays + ' days out costs about ' + fmt(retarget.dv * 1000, 3) + ' mm/s, ' + fmt(retarget.propellant_needed * 1000, 3) + ' g of propellant; ' + fmt(propAvail, 3) + ' kg arrives.', 'Set module 47\'s aim perigee to ' + fmt(H.perigee_alt / 1000, 4) + ' km, so the departure burn aims at the entry (no correction at the Earth).', { applies_to: 'retarget' }));
        }
      }
      var ei = null;
      if (C && C.entry) {
        var x0 = C.entry, rel0 = vrelOf(x0.r, x0.v), ai = angles(x0.r, x0.v), ar = angles(x0.r, rel0), tdb = num(x0.tdb) ? x0.tdb : null, ll = geodetic(x0.r, tdb);
        ei = { utc: tdb !== null ? utcOf(tdb) : null, tdb_s_past_j2000: tdb, altitude_m: norm(x0.r) - RE, r_m: rv(x0.r), v_m_s: rv(x0.v), speed_inertial_m_s: norm(x0.v), speed_relative_m_s: norm(rel0),
          fpa_inertial_deg: ai.fpa, fpa_relative_deg: ar.fpa, heading_inertial_deg: ai.heading, heading_relative_deg: ar.heading, latitude_deg: ll.lat, longitude_deg: tdb !== null ? ll.lon : null,
          frame: 'geocentric ICRF/J2000 axes; TDB; latitude geocentric; longitude through ERFA\'s Earth rotation angle (UT1 = UTC), precession and nutation ignored' };
      }
      if (chosen === 'skyhook' && C.release) ei = { tether_release: C.release, frame: 'two-body in idea 01\'s Earth (R_E ' + C.release.earth_radius_convention_m / 1000 + ' km)' };

      // carried and own refusals
      var own = [];
      own.push(refusal('insufficient_data', 'No heat shield, structure or container mass is counted: the entry mass is the arrival mass (' + fmt(veh.mass_kg, 5) + ' kg) inside the chosen shape.', 'Module 49 (Hot Return) sizes the heat shield from this heating; a container mass for the material.', { applies_to: 'tps_mass' }));
      own.push(refusal('insufficient_data', 'Heating is Sutton & Graves\'s convective stagnation-point rate only ("Radiative heating was neglected", NASA TR R-376). At lunar-return speeds radiation is not small: "radiative heating is approximately one-third of the total heating rate" for Apollo (NASA TN D-6843).', 'A radiative correlation or a shock-layer solution (module 49).', { applies_to: 'radiative_heating' }));
      own.push(refusal('insufficient_data', 'The atmosphere is the 1976 standard to 86 km and none above; no winds, no day-of density. OSIRIS-REx\'s team saw "atmospheric density being much lower than was Earth-GRAM was predicting" (OSIRIS-REx EDL performance, 2025).', 'A day-of atmosphere (GEOS forecast, GRAM dispersions) for the entry date.', { applies_to: 'atmosphere' }));
      if (veh.assumed.length) own.push(refusal('insufficient_data', 'The vehicle\'s numbers are partly assumed: ' + veh.assumed.join('; ') + '.', 'The vehicle\'s own aerodynamic database and heat-shield geometry.', { applies_to: 'vehicle' }));
      if (arr.kind === 'hyperbola' && opts.direct.flight) own.push(refusal('insufficient_data', 'Constant bank, no guidance: the corridors are the lift-up and lift-down bounds a guided vehicle flies between, wider than what a guidance law and its dispersions leave (the TransHab study flew bank reversals to hold its target).', 'An entry guidance law with dispersions (Monte Carlo over density, aerodynamics and the entry state).', { applies_to: 'guidance' }));
      var allRef = refusals.concat(own);
      if (C && C.refusals) allRef = allRef.concat(C.refusals.map(function (r) { var c = clone(r); return c; }));

      return { S: Sx, arrival: arr, vehicle: veh, options: opts, choice: chosen, chosenBy: chosenBy, entry: ei, retarget: retarget, limits: lim,
        refusals: allRef, carried: arr.carried || [], assumptions: assumptions.concat(arr.assumed || []) };
    }

    // ---------------------------------------------------------------- the handoff
    function optRow(o) {
      return { id: o.id, label: o.label, destination: o.destination, feasible: !!o.feasible, dv_m_s: num(o.dv) ? r9(o.dv) : null, propellant_needed_kg: num(o.propellant_needed) ? r9(o.propellant_needed) : null,
        gamma_deg: num(o.gamma) ? r9(o.gamma) : null, peak_g: o.loads && num(o.loads.peak_g) ? r9(o.loads.peak_g) : null, peak_q_W_m2: o.loads && num(o.loads.peak_q_W_m2) ? r9(o.loads.peak_q_W_m2) : null,
        heat_load_J_m2: o.loads && num(o.loads.heat_J_m2) ? r9(o.loads.heat_J_m2) : null, corridor_width_deg: o.corridor && num(o.corridor.width_deg) ? r9(o.corridor.width_deg) : null,
        refusal_codes: (o.refusals || []).map(function (r) { return r.code + '/' + (r.applies_to || ''); }) };
    }
    function buildHandoff(R, produced) {
      if (!R || R.refusal) return null;
      var A = R.arrival, C = R.choice ? R.options[R.choice] : null, veh = R.vehicle;
      var inputs = { settings: clone(R.S) };
      if (A.kind === 'hyperbola' && A.h47) inputs.way_home_handoff = A.chain ? clone(CHAIN_DIGEST) : clone(A.h47);
      else inputs.way_home_handoff = null;
      var mDel = C ? veh.mass_kg - (C.propellant_needed || 0) : null;
      var outputs = {
        capture: { value: { choice: R.choice, chosen_by: R.chosenBy, destination: C ? C.destination : null, options: ['direct', 'skip', 'aerocapture', 'propulsive', 'lunar', 'skyhook'].map(function (k) { return optRow(R.options[k]); }),
          answers: A.chain ? ['47-way-home:out_of_envelope/entry_speed'] : [] }, units: 'm/s, kg, deg, W/m^2, J/m^2', confidence: 'derived', source: KERNEL + ' run(): every option evaluated; corridors by bisection on the entry angle through the 3-DOF flight' },
        entry_interface: { value: R.entry ? clone(R.entry) : null, units: 'm, m/s, deg, s', confidence: 'derived', source: KERNEL + ' hyperbolaEntry()/stateFromLocal(): the state at the entry interface of the chosen option' },
        vehicle: { value: { id: veh.id, label: veh.label, mass_kg: r9(veh.mass_kg), area_m2: r9(veh.area_m2), diameter_m: r9(veh.diameter_m), nose_radius_m: r9(veh.rn_m), cd: clone(veh.cd), cl: veh.cl, bank_deg: C && (C.id === 'aerocapture' || C.id === 'skip') ? 90 : R.S.bankDeg,
          ballistic_coefficient_kg_m2: r9(betaOf(veh)), source: veh.source, assumed: veh.assumed.slice() }, units: 'kg, m^2, m', confidence: veh.assumed.length ? 'assumed' : 'measured', source: 'snapshots/entry-sources.js' },
        screening: { value: C && C.loads ? { peak_g: r9(C.loads.peak_g), t_peak_g_s: r9(C.loads.t_peak_g), peak_q_W_m2: r9(C.loads.peak_q_W_m2), heat_load_J_m2: r9(C.loads.heat_J_m2), corridor: C.corridor ? clone(C.corridor) : null,
          passes: C.passes ? C.passes.length : 1, atmosphere: 'US 1976 (PartForge isa) to 86 km, none above', heating: 'Sutton & Graves convective, stagnation point' } : null, units: 'g, s, W/m^2, J/m^2, deg', confidence: 'derived', source: KERNEL + ' fly()' },
        orbit: { value: C && C.orbit ? clone(C.orbit) : null, units: 'm', confidence: 'derived', source: KERNEL + ' (target orbit, after the capture)' },
        mass: { value: { entry_kg: r9(veh.mass_kg), propellant_available_kg: r9(A.propellant_kg || 0), propellant_used_kg: C && num(C.propellant_needed) ? r9(C.propellant_needed) : 0, delivered_kg: num(mDel) ? r9(mDel) : null, material_kg: num(A.material_kg) ? r9(A.material_kg) : null,
          heat_shield_kg: null }, units: 'kg', confidence: 'assumed', source: KERNEL + ' (no heat-shield or container mass: refused)' },
        retarget: { value: R.retarget ? JSON.parse(JSON.stringify(R.retarget, function (k, v) { return typeof v === 'number' ? r9(v) : v; })) : null, units: 'm, m/s, kg, days', confidence: 'derived', source: KERNEL + ' (B-plane distance over the time to go)' }
      };
      var refs = (R.carried || []).map(clone).concat(R.refusals.map(function (r) { var c = clone(r); c.from = '48-catch'; return c; }));
      return { handoff: 'long-way-round', version: 1, from: '48-catch', produced: produced || new Date().toISOString(), inputs: inputs, outputs: JSON.parse(JSON.stringify(outputs, function (k, v) { return typeof v === 'number' ? r9(v) : v; })), refusals: refs,
        assumptions: [
          'Time TDB inside (UTC = TDB - 69.184 s); geocentric ICRF/J2000 axes; the atmosphere rotates about the ICRF z axis at the pck00010 rate.',
          'Earth: a sphere of 6,378,136.6 m with Aster\'s GM 398,600.4418 km^3/s^2; point-mass gravity (no J2) during the minutes of a pass.',
          'Atmosphere: the 1976 US Standard (PartForge isa) to its table top at 86 km, no density above, no winds.',
          'Vehicle: a point mass with the chosen shape\'s C_D (or C_A against Mach) and C_L at constant bank; deceleration = |aerodynamic acceleration| / 9.80665.',
          'Heating: Sutton & Graves (NASA TR R-376) air coefficient K = 0.1113 with Newtonian stagnation pressure rho V^2 and stagnation enthalpy V^2/2 (cold wall): q = 1.748e-4 sqrt(rho/Rn) V^3, convective only.',
          'The arrival hyperbola keeps idea 47\'s v-infinity vector and plane and is re-aimed only in its perigee (B magnitude); the perigee time is idea 47\'s.',
          'Propellant: Tsiolkovsky with the arrival\'s exhaust speed and Aster\'s 10 % delta-v margin.'
        ].concat(R.assumptions || []) };
    }
    function numDiff(a, b, path, tol) {
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b)) ? null : path;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return JSON.stringify(a) === JSON.stringify(b) ? null : path;
      var ks = Object.keys(a).concat(Object.keys(b));
      for (var i = 0; i < ks.length; i++) { var k = ks[i]; if (k === 'utc' && typeof a[k] === 'string') { if (Math.abs(Date.parse(a[k]) - Date.parse(b[k])) > 10) return path + '.' + k; continue; } var d = numDiff(a[k], b[k], path + '.' + k, tol); if (d) return d; }
      return null;
    }
    function codes(L) { return (L || []).map(function (r) { return (r.from || '') + ':' + r.code + '/' + (r.applies_to || ''); }).sort().join(','); }
    /** Read a handoff: idea 47's (imported) or this page's (re-run from its inputs and compared). */
    function parseHandoff(input) {
      var h = input;
      if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { return bad('That is not JSON.'); } }
      if (!h || h.handoff !== 'long-way-round') return bad('That is not a Long Way Round handoff.');
      if (h.from === '47-way-home') { var a = importWayHome(h); return a.refusal ? a : { from: '47-way-home', h47: h, arrival: a }; }
      if (h.from !== '48-catch') return bad('This is a handoff from ' + h.from + '; this page takes idea 47\'s or its own.');
      if (h.version !== 1) return bad('Version ' + h.version + ' is not one this page reads.');
      var I = h.inputs || {}, Sx = I.settings, w = I.way_home_handoff, h47 = null;
      if (!Sx) return bad('This handoff carries no settings.');
      if (w && w.pruned) { if (!CHAIN_DIGEST || w.sha256 !== CHAIN_DIGEST.sha256) return { refusal: refusal('not_found', 'Its idea 47 handoff is carried as a digest that matches none bundled here (only the chain\'s sample is).', 'The handoff with idea 47\'s inside it whole.', { applies_to: 'way_home_handoff' }) }; h47 = CHAIN_H; }
      else if (w) h47 = w;
      var R = run(Sx, h47 ? { h47: h47 } : null);
      if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced);
      var keys = Object.keys(again.outputs).concat(Object.keys(h.outputs || {}));
      for (var i = 0; i < keys.length; i++) { var d = numDiff((h.outputs || {})[keys[i]], again.outputs[keys[i]], keys[i], 1e-6); if (d) return bad('The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.'); }
      if (codes(h.refusals) !== codes(again.refusals)) return bad('The handoff\'s refusals are not the ones its inputs give: it was edited.');
      return { from: '48-catch', h48: h, settings: Sx, h47: h47, R: R };
    }
    function b64urlEncode(s) { var b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function b64urlDecode(s) { var b = s.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8'); }

    // ---------------------------------------------------------------- reality: flown capsules and closed forms
    function flownPeak(id, extra) {
      var A = arrivalFromFlight(id, extra && extra.fpa), veh = vehicle(A.flight.vehicle);
      var o = { bankDeg: 0, dt: FLY.dt, vStop: 300, tMax: 2000 }; if (extra) for (var k in extra) if (k !== 'fpa') o[k] = extra[k];
      var f = fly(A.x0, veh, o);
      return { arrival: A, vehicle: veh, flight: f };
    }
    function reality() {
      var rows = [];
      var sd = flownPeak('stardust');
      rows.push({ id: 'stardust_g', label: 'Stardust, peak deceleration', ref: SD.peak_g_bet, refLabel: 'BET (radar-fitted)', model: sd.flight.peak_g, units: 'g', gap_pct: 100 * (sd.flight.peak_g / SD.peak_g_bet - 1) });
      // fly() counts time from its starting state, here the entry interface, so tStop is the time since entry
      var fT = fly(sd.arrival.x0, sd.vehicle, { bankDeg: 0, dt: FLY.dt, vStop: 0, tStop: SD.drogue_t_s, tMax: 400 });
      rows.push({ id: 'stardust_drogue', label: 'Stardust, altitude 137.9 s after entry', ref: SD.drogue_alt_m / 1000, refLabel: 'radar at drogue deploy', model: fT.final.h / 1000, units: 'km', gap_abs: fT.final.h / 1000 - SD.drogue_alt_m / 1000, mach: fT.final.M, mach_ref: SD.drogue_mach });
      var gn = flownPeak('genesis');
      rows.push({ id: 'genesis_g', label: 'Genesis, peak deceleration', ref: GN.peak_g_bet, refLabel: 'BET (radar-fitted)', model: gn.flight.peak_g, units: 'g', gap_pct: 100 * (gn.flight.peak_g / GN.peak_g_bet - 1) });
      var ox = flownPeak('osirisrex');
      rows.push({ id: 'orex_g', label: 'OSIRIS-REx, peak deceleration', ref: OX.pred_peak_g, refLabel: 'pre-flight prediction (POST2)', model: ox.flight.peak_g, units: 'g', gap_pct: 100 * (ox.flight.peak_g / OX.pred_peak_g - 1) });
      rows.push({ id: 'orex_q', label: 'OSIRIS-REx, peak heating (convective here)', ref: OX.pred_peak_q_W_cm2, refLabel: 'pre-flight prediction', model: ox.flight.peak_q / 1e4, units: 'W/cm²', gap_pct: 100 * (ox.flight.peak_q / 1e4 / OX.pred_peak_q_W_cm2 - 1) });
      rows.push({ id: 'orex_tq', label: 'OSIRIS-REx, time of peak heating after entry', ref: OX.peak_heating_obs_s, refLabel: 'infrared video', model: ox.flight.t_peak_q, units: 's', gap_abs: ox.flight.t_peak_q - OX.peak_heating_obs_s });
      // heading sensitivity for OSIRIS-REx (no heading on file)
      var hs = [30, 60, 90, 120, 150].map(function (hd) { var F = FLIGHTS.osirisrex, x = stateFromLocal({ lat: F.lat, lon: F.lon, alt: F.alt, speed: F.speed, speedFrame: F.speedFrame, fpa: F.fpa, heading: hd }); return fly(x, vehicle('osirisrex'), { dt: FLY.dt, vStop: 300 }).peak_g; });
      rows[3].heading_range = [Math.min.apply(null, hs), Math.max.apply(null, hs)];
      return { rows: rows, flights: { stardust: sd, genesis: gn, osirisrex: ox } };
    }
    // Allen & Eggers (NACA TR 1381): ballistic, straight line, no gravity, exponential atmosphere rho0 e^(-h/H):
    // V = VE exp(-rho H / (2 beta sin(gamma))), peak deceleration VE^2 sin(gamma) / (2 e H) at rho* = beta sin(gamma)/H.
    function allenEggers(VE, gammaDeg, H) { var s = Math.sin(-gammaDeg * DEG); return { peak: VE * VE * s / (2 * Math.E * H) }; }

    return {
      KERNEL: KERNEL, MU: MU, RE: RE, RC: RC, surfR: surfR, altOf: altOf, OMEGA: OMEGA, G0: G0, ATM_TOP: ATM_TOP, K_SG: K_SG, ENTRY_ALT: ENTRY_ALT, ENTRY_LIMIT: ENTRY_LIMIT, MARGIN: MARGIN, MOON: MOON, MU_MOON: MU_MOON, MU_EM: MU_EM,
      sources: S, chain: CHAIN_H, chainDigest: CHAIN_DIGEST, TM: TM_K, VEHICLES: VEHICLES, VEH_ORDER: VEH_ORDER, FLIGHTS: FLIGHTS, CHOICES: CHOICES, ARRIVALS: ARRIVALS, FLY: FLY,
      atm: atm, cdOf: cdOf, betaOf: betaOf, vehicle: vehicle, deriv: deriv, fly: fly, flyPasses: flyPasses, elements: elements, coastTo: coastTo, tPeri: tPeri,
      stateFromLocal: stateFromLocal, angles: angles, vrelOf: vrelOf, era: era, geodetic: geodetic, hyperbolaEntry: hyperbolaEntry, bOfPerigee: bOfPerigee,
      arrivalFromFlight: arrivalFromFlight, importWayHome: importWayHome, customArrival: customArrival, builderOf: builderOf,
      corridorDirect: corridorDirect, corridorAero: corridorAero, aeroAngle: aeroAngle, propulsive: propulsive, lunarBest: lunarBest, lunarThreshold: lunarThreshold, propellantFor: propellantFor,
      defaults: defaults, customDefaults: customDefaults, validSettings: validSettings, run: run, buildHandoff: buildHandoff, parseHandoff: parseHandoff, numDiff: numDiff,
      reality: reality, allenEggers: allenEggers, utcOf: utcOf, tdbOf: tdbOf, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode
    };
  }

  return { create: create, KERNEL: KERNEL };
});
