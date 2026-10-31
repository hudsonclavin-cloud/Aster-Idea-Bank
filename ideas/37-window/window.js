/* Window: from the launch pad to the departure asymptote. Idea 37 of the Aster Idea Bank, module 7 of "The Long Way Round".
 *
 * Takes idea 36's parking orbit (its handoff: the guided ascent, flown in an Earth-centred inertial frame fixed at
 * liftoff, with no epoch) and a departure asymptote (C3, right ascension and declination in ICRF/J2000, Aster's frame)
 * and answers the question the earlier modules could not: on a given day, when can the rocket leave the pad so that its
 * parking orbit, after the coast, contains the direction it must depart along? It finds the day's launch windows (the
 * stretches of time when the plane through the pad and the asymptote has a launch azimuth inside the range's corridor),
 * the azimuth, inclination and node at each moment, the coast in the parking orbit to the departure point, how far the
 * Earth's oblateness (J2) turns the orbit's plane over that coast and how much earlier or later that makes the launch,
 * and the state at the departure point in J2000 with its epoch, for module 38's burn.
 *
 * A pure kernel: no DOM, no network. What it reuses, unmodified: idea 36's kernel (snapshots/closedloop.js) reads and
 * re-checks the imported handoff and re-flies the guided ascent at each launch azimuth (so the propellant left for the
 * departure burn is the vehicle's, azimuth by azimuth). What is new here:
 *
 *   time      UTC -> TT from NAIF's leap-second table (TAI - UTC, TT - TAI = 32.184 s); TDB = TT (the periodic part,
 *             under 2 ms, ignored as Aster does); UT1 = UTC (|UT1 - UTC| < 0.9 s, not modelled: a stated assumption).
 *   earth     IAU 2006 Earth rotation: the Earth rotation angle and Greenwich mean sidereal time, and the bias-precession
 *             matrix from ICRF/J2000 to the mean equator and equinox of date (Fukushima-Williams angles), coefficients
 *             parsed from ERFA's C source (snapshots/erfa-iau2006.js). Nutation is not modelled; its size is measured
 *             against the full IAU 2006/2000A model (pyerfa) in the tests.
 *   geometry  JPL Publication 82-43 section III.C (snapshots/jpl-82-43-launch-geometry.txt): the parking orbit's plane must
 *             contain the pad at liftoff and the asymptote (eq. 9, in vector form here, and checked against eq. 9 itself);
 *             inclination (15), node (16), range angle (17, 18), the asymptote's true anomaly (21), the coast arc (22),
 *             and the split-azimuth limit (14).
 *   coast     the parking orbit propagated from insertion by RK4 under point-mass gravity (Aster's GM) plus J2 (WGS-84,
 *             quoted in NAIF's geophysical.ker), in the mean-of-date frame whose z is the spin axis, until the departure
 *             point: where the asymptote is the hyperbola's true anomaly ahead (an impulsive burn at the hyperbola's
 *             perigee; module 38 makes it a finite burn). The launch time and azimuth are solved so that the plane AT
 *             THE DEPARTURE POINT contains the asymptote (the handbook's biased launch, eq. 27, done numerically).
 *   window    the day scanned with the handbook's closed form (J2 by eq. 25), the edges refined with the numerical solve.
 *   capacity  (added by the independent review) the delta-v the propellant left can buy, by the ideal rocket equation on
 *             the guided stage's own engine; when it is below the impulsive departure's, the departure is refused for
 *             that launch (refusal departure_propellant). Apollo 17's real translunar burn (report Table 16-7) is the
 *             yardstick's check.
 *
 * Frames: MOD (mean equator and equinox of date, built from IAU 2006 precession) for the geometry and the coast; J2000
 * (ICRF axes, as Aster's) for everything handed on. Idea 36's frame is MOD rotated by the pad's right ascension at
 * liftoff (its x axis is the launch meridian at liftoff, its z the spin axis). Time: UTC for clocks, TDB seconds past
 * J2000 for the chain. SI units inside (m, s, kg, rad); degrees only at the edges.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaunchWindow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEG = Math.PI / 180, TWO_PI = 2 * Math.PI, AS2R = Math.PI / 648000;

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
  /** Turn vector v by angle a (rad) about z (an active rotation: positive turns x toward y). */
  function rotZ(v, a) { var c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; }
  function mxv(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
  function mtxv(M, v) { return [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]]; }
  function mxm(A, B) { var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]; return C; }
  /** ERFA's frame rotations (eraRz, eraRx): the matrix that re-expresses a vector in axes turned by a. */
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, s], [0, -s, c]]; }
  function wrap2pi(a) { a %= TWO_PI; return a < 0 ? a + TWO_PI : a; }
  function wrapPi(a) { a = wrap2pi(a); return a > Math.PI ? a - TWO_PI : a; }
  function horner(c, t) { var s = 0; for (var i = c.length - 1; i >= 0; i--) s = s * t + c[i]; return s; }
  function angleBetween(a, b) { return Math.atan2(norm(cross(a, b)), dot(a, b)); }
  function iso(ms) { return new Date(Math.round(ms)).toISOString().replace('.000Z', 'Z'); }

  function create(deps) {
    var C = deps.C, A = C.A, ERFA = deps.erfa, NAIF = deps.naif, AST = deps.aster, AP = deps.apollo17, APO = deps.apophis, EARTH = deps.earth;
    var T512 = deps.trajectory;
    var MU = C.constants.MU, RE = C.constants.RE;
    var J2 = NAIF.wgs84.J2, RJ2 = NAIF.wgs84.radius_km * 1000;
    var RPOLE = AST.radii_km[2] * 1000, REQ = AST.radii_km[0] * 1000;
    var UNIX_TO_J2000_S = AST.unixToJ2000Days * ERFA.DAYSEC; // Aster's 10957.5 days: J2000 (JD 2451545.0) less the Unix epoch
    var KERNEL = '37-window/window.js';

    // ================================================================== time
    /** A UTC instant from 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DDTHH:MM:SS(.s)' with or without Z: Unix ms, or null. */
    function parseUtc(s) {
      if (typeof s !== 'string') return null;
      var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?Z?$/.exec(s.trim());
      if (!m) return null;
      var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0) + (m[6] ? +m[6] * 1000 : 0);
      var d = new Date(ms);
      if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || (m[4] && +m[4] > 23) || (m[5] && +m[5] > 59) || (m[6] && +m[6] >= 60)) return null;
      return ms;
    }
    var LEAPS = NAIF.taiMinusUtc.map(function (x) { return [x[0], Date.UTC(+x[1].slice(0, 4), +x[1].slice(5, 7) - 1, +x[1].slice(8, 10))]; });
    /** TAI - UTC at a UTC instant (s), from NAIF's table; null before 1972-01-01, where the table starts. */
    function taiMinusUtc(ms) {
      if (!(ms >= LEAPS[0][1])) return null;
      var v = LEAPS[0][0];
      for (var i = 1; i < LEAPS.length; i++) if (ms >= LEAPS[i][1]) v = LEAPS[i][0];
      return v;
    }
    /** Every time scale Window uses at a UTC instant: {ms, utc, du (UT1 days past J2000, UT1 = UTC), tt (TT Julian
     * centuries past J2000), ttMinusUtc, tdb (TDB s past J2000, TDB = TT)} or {refusal}. */
    function timeOf(ms) {
      if (!num(ms)) return { refusal: refusal('invalid_input', 'That is not a UTC time.', 'A date and time such as 2026-07-02T14:30:00Z.', { applies_to: 'time' }) };
      var dat = taiMinusUtc(ms);
      if (dat == null) return { refusal: refusal('out_of_envelope', 'NAIF\'s leap-second table starts at 1972-01-01; before it UTC had fractional steps and TT cannot be had from it.', 'A date from 1972 on.', { applies_to: 'time' }) };
      var dtt = dat + NAIF.ttMinusTai_s, s = ms / 1000 - UNIX_TO_J2000_S;
      return { ms: ms, utc: iso(ms), du: s / ERFA.DAYSEC, tt: (s + dtt) / ERFA.DAYSEC / ERFA.DJC, ttMinusUtc: dtt, tdb: s + dtt };
    }

    // ================================================================== Earth orientation (IAU 2006, ERFA's coefficients)
    /** Earth rotation angle at UT1 (du: days past J2000), rad (ERFA era00). */
    function era(du) { var f = du - Math.floor(du); return wrap2pi(TWO_PI * (f + ERFA.era.c0 + ERFA.era.c1 * du)); }
    /** Greenwich mean sidereal time, rad (ERFA gmst06: ERA plus a polynomial in TT centuries). */
    function gmst(du, tt) { return wrap2pi(era(du) + horner(ERFA.gmst06_arcsec, tt) * AS2R); }
    /** Bias-precession matrix, ICRF/J2000 -> mean equator and equinox of date (ERFA pmat06 = fw2m of pfw06's angles). */
    function precession(tt) {
      var g = horner(ERFA.pfw06_arcsec.gamb, tt) * AS2R, p = horner(ERFA.pfw06_arcsec.phib, tt) * AS2R, s = horner(ERFA.pfw06_arcsec.psib, tt) * AS2R, e = horner(ERFA.obl06_arcsec, tt) * AS2R;
      return mxm(Rx(-e), mxm(Rz(-s), mxm(Rx(p), Rz(g))));
    }
    /** Earth's orientation at a UTC instant: the time scales, GMST and the precession matrix. */
    function orient(ms) {
      var T = timeOf(ms);
      if (T.refusal) return T;
      T.gmst = gmst(T.du, T.tt); T.P = precession(T.tt);
      return T;
    }
    /** The IAU (WGCCRE) Earth model in Aster's pck00010: the RA of the Greenwich meridian (deg) and the pole, for
     * comparison only (Window does not use it). W measured from the node of Earth's equator on the ICRF equator. */
    function pckGreenwichRa(T) {
      var d = T.tdb / ERFA.DAYSEC, c = T.tdb / ERFA.DAYSEC / ERFA.DJC;
      var ra0 = AST.poleRa[0] + AST.poleRa[1] * c, dec0 = AST.poleDec[0] + AST.poleDec[1] * c, W = AST.pm[0] + AST.pm[1] * d;
      return { ra: ((ra0 + 90 + W) % 360 + 360) % 360, poleRa: ra0, poleDec: dec0 };
    }

    // ================================================================== the launch site
    /**
     * Pad 39A placed from the flight report (the report gives no pad coordinates): Table 4-3's S-IC/S-II separation
     * point (28.580 N, -79.637 E) lies 94.7 km down range along the 91.504 deg flight azimuth and 0.3 km cross range.
     * Walking back along that great circle on a sphere of Aster's radius gives the pad; the 0.3 km cross range (side not
     * stated) and the sphere bound the result to about 0.003 deg. [Likely] Table 4-3's latitudes are geodetic, so the
     * walked-back latitude is too; the geometry (JPL 82-43's phi_L) needs the geocentric one, returned beside it from
     * Aster's pck00010 ellipsoid (tan phi_c = (1 - e^2) tan phi, a point on the surface). (Independent review.)
     */
    function padFromReport() {
      var s = AP.sicSiiSeparation, d = s.surfaceRangeKm * 1000 / RE, A0 = AP.azimuthFlownDeg * DEG;
      var p1 = s.geodeticLatDeg * DEG, l1 = s.longitudeEastDeg * DEG;
      function dest(p0, l0) {
        var p = Math.asin(Math.sin(p0) * Math.cos(d) + Math.cos(p0) * Math.sin(d) * Math.cos(A0));
        var l = l0 + Math.atan2(Math.sin(A0) * Math.sin(d) * Math.cos(p0), Math.cos(d) - Math.sin(p0) * Math.sin(p));
        return [p, l];
      }
      var x = [p1, l1 - d * Math.sin(A0) / Math.cos(p1)];
      for (var it = 0; it < 30; it++) {
        var f = dest(x[0], x[1]), r = [f[0] - p1, f[1] - l1];
        if (Math.abs(r[0]) + Math.abs(r[1]) < 1e-15) break;
        var e = 1e-7, fa = dest(x[0] + e, x[1]), fb = dest(x[0], x[1] + e);
        var J = [[(fa[0] - f[0]) / e, (fb[0] - f[0]) / e], [(fa[1] - f[1]) / e, (fb[1] - f[1]) / e]], det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        x = [x[0] - (J[1][1] * r[0] - J[0][1] * r[1]) / det, x[1] - (-J[1][0] * r[0] + J[0][0] * r[1]) / det];
      }
      var cr = AP.sicSiiSeparation.crossRangeKm * 1000 / RE / DEG, e2 = 1 - (RPOLE / REQ) * (RPOLE / REQ);
      return { latDeg: x[0] / DEG, geocentricLatDeg: Math.atan((1 - e2) * Math.tan(x[0])) / DEG, lonDeg: x[1] / DEG, crossRangeDeg: cr,
        source: 'Pad 39A placed from MPR-SAT-FE-73-1 Table 4-3 (S-IC/S-II separation 94.7 km down range on the 91.504 deg flight azimuth, at 28.580 N, -79.637 E), walked back on a sphere of Aster\'s radius' };
    }
    var PAD39A = padFromReport();

    // ================================================================== the asymptote
    /**
     * The departure asymptote from {c3_m2_s2, rlaDeg, dlaDeg} or {vinf_m_s: [x, y, z]} (ICRF/J2000), with the UTC date it
     * belongs to. C3 > 0: a hyperbola, with a departure point. C3 <= 0: no asymptote; the direction is kept as a target
     * vector for the plane only (as Apollo's translunar targeting used one), and the departure point is refused.
     */
    function asymptote(spec) {
      spec = spec || {};
      var bad = function (why) { return { refusal: refusal('invalid_input', why, 'C3 in m^2/s^2 with a right ascension and declination in degrees (ICRF/J2000), or a v-infinity vector in m/s, and the UTC date it is for.', { applies_to: 'asymptote' }) }; };
      var S, c3, rla, dla;
      if (Array.isArray(spec.vinf_m_s)) {
        var v = spec.vinf_m_s;
        if (!(v.length === 3 && v.every(num))) return bad('The v-infinity vector needs three numbers.');
        var vn = norm(v);
        if (!(vn > 0)) return bad('A zero v-infinity has no direction.');
        S = scale(v, 1 / vn); c3 = vn * vn;
        rla = (Math.atan2(S[1], S[0]) / DEG + 360) % 360; dla = Math.asin(Math.max(-1, Math.min(1, S[2]))) / DEG;
      } else {
        c3 = spec.c3_m2_s2; rla = spec.rlaDeg; dla = spec.dlaDeg;
        if (!(num(c3) && num(rla) && num(dla))) return bad('C3, right ascension and declination must be numbers.');
        if (!(dla >= -90 && dla <= 90)) return bad('A declination is between -90 and 90 degrees.');
        rla = ((rla % 360) + 360) % 360;
        S = [Math.cos(dla * DEG) * Math.cos(rla * DEG), Math.cos(dla * DEG) * Math.sin(rla * DEG), Math.sin(dla * DEG)];
      }
      var day = parseUtc(spec.dateUtc);
      if (day == null) return bad('The asymptote needs the UTC date it is for (the transfer\'s departure date).');
      // an input guard against unit slips (a C3 typed in m^2/s^2 where km^2/s^2 was meant), not a physical limit: whether
      // the vehicle can reach a C3 is the departure_propellant check below
      if (Math.abs(c3) > 1e9) return { refusal: refusal('out_of_envelope', 'C3 of ' + fmt(c3 / 1e6, 4) + ' km^2/s^2 is outside this page\'s input envelope (|C3| up to 1,000 km^2/s^2, a guard against unit slips).', 'A C3 from a real transfer (module 39 or Aster\'s porkchop), in km^2/s^2.', { applies_to: 'asymptote' }) };
      return { S: S, c3: c3, vinf: c3 > 0 ? Math.sqrt(c3) : 0, rlaDeg: rla, dlaDeg: dla, mode: c3 > 0 ? 'hyperbolic' : 'target', dayMs: day - (day % 86400000 + 86400000) % 86400000, dateUtc: spec.dateUtc, source: spec.source || 'user', spec: clone(spec) };
    }
    /** Aster's own asymptote preset: the one cell in its fixtures with v-infinity components (Apophis, M=1). */
    function apophisSpec() {
      var c = APO.summary.maxAngularSeparationCell;
      return { vinf_m_s: c.oursVInfDep.map(function (x) { return x * 1000; }), dateUtc: c.depDate, source: 'Aster tools/slice12-research/data/dla-oracle-m1-vectors.json (62ddb17): ' + c.body + ' Apophis, departure ' + c.depDate + ', TOF ' + fmt(c.tofDays, 6) + ' d, M=1 ' + c.ourBranch + ' branch, poliastro-matched to ' + fmt(c.angSepDeg, 2) + ' deg' };
    }

    // ================================================================== plane geometry (JPL 82-43 section III.C)
    function padUnit(T, lonDeg, latDeg) { var a = T.gmst + lonDeg * DEG, p = latDeg * DEG; return [Math.cos(p) * Math.cos(a), Math.cos(p) * Math.sin(a), Math.sin(p)]; }
    function enu(u) { var e = unit([-u[1], u[0], 0]); return { east: e, north: cross(u, e) }; }
    /** The azimuth (rad, from north toward east) of the plane through the pad (unit u) and direction s, travelled from
     * the pad toward s the short way; the same plane travelled the other way is this plus pi. Null if s is vertical. */
    function azimuthToward(u, s) {
      var h = cross(u, s);
      if (norm(h) < 1e-12) return null;
      var d = cross(unit(h), u), f = enu(u);
      return wrap2pi(Math.atan2(dot(d, f.east), dot(d, f.north)));
    }
    /** Eq. (9) of JPL 82-43 with its quadrant rule for an eastward launch: the azimuth (deg) from the site latitude, the
     * asymptote declination and alpha_inf - alpha_L (deg). Kept for the test that it equals the vector form. */
    function handbookAzimuth(phiDeg, dlaDeg, dAlphaDeg) {
      var p = phiDeg * DEG, d = dlaDeg * DEG, a = dAlphaDeg * DEG;
      var cot = (Math.cos(p) * Math.tan(d) - Math.sin(p) * Math.cos(a)) / Math.sin(a);
      return Math.atan2(1, cot) / DEG; // arccot into (0, 180): the handbook's "cotan negative: add 180" rule, safe at cot = -0

    }
    /** Normal and launch direction of the plane leaving the pad u on azimuth az (rad). */
    function planeOf(u, az) { var f = enu(u), d = add(scale(f.north, Math.cos(az)), scale(f.east, Math.sin(az))); return { h: unit(cross(u, d)), d: d }; }
    function inCorridor(azDeg, cor) { var a = ((azDeg % 360) + 360) % 360; return a >= cor[0] - 1e-7 && a <= cor[1] + 1e-7; }
    /** How far an azimuth is outside the corridor (deg, 0 inside). */
    function corridorMiss(azDeg, cor) { var a = ((azDeg % 360) + 360) % 360; if (inCorridor(a, cor)) return 0; var m = function (x, y) { var q = Math.abs(x - y) % 360; return Math.min(q, 360 - q); }; return Math.min(m(a, cor[0]), m(a, cor[1])); }
    /** Of the two directions along the plane through u and s, the one inside the corridor (or nearer it). */
    function chooseAzimuth(u, s, cor) {
      var a0 = azimuthToward(u, s);
      if (a0 == null) return null;
      var c = [a0, wrap2pi(a0 + Math.PI)].map(function (a) { return { az: a, deg: a / DEG, miss: corridorMiss(a / DEG, cor) }; });
      return c[0].miss <= c[1].miss ? c[0] : c[1];
    }
    function nodeOf(h) { return wrap2pi(Math.atan2(h[0], -h[1])); }
    function inclinationOf(h) { return Math.acos(Math.max(-1, Math.min(1, h[2] / norm(h)))); }
    /** Angle (rad, 0 to 2 pi) from direction r forward along the motion (normal h) to s's projection on the plane. */
    function angleAhead(r, s, h) { return wrap2pi(Math.atan2(dot(cross(unit(r), s), h), dot(unit(r), s))); }
    /** Eq. (21): the asymptote's true anomaly on a hyperbola of this C3 with perigee radius rp. */
    function nuInf(c3, rp) { return Math.acos(-1 / (1 + c3 * rp / MU)); }
    /** Eq. (25): nodal regression per revolution of a circular orbit, deg (negative westward, as eq. 25's "westward"). */
    function regressionPerRev(ro, incDeg, re, j2) { return -540 * (re * re) * j2 * Math.cos(incDeg * DEG) / (ro * ro); }

    // ================================================================== the ascent, placed in a plane
    /** In-plane description of idea 36's insertion (its frame: x through the launch meridian at liftoff, z the spin
     * axis, pad at latitude latDeg on Aster's sphere): ascent arc theta1 from the pad, radius, radial and transverse
     * speeds, time from liftoff, mass. */
    function profileOf(ins, latDeg) {
      var p = latDeg * DEG, r0 = [Math.cos(p), 0, Math.sin(p)], r = ins.r_m || ins.r, v = ins.v_m_s || ins.v;
      var n = unit(cross(r, v)), rh = unit(r), u0 = unit(sub(r0, scale(n, dot(r0, n))));
      var d = cross(n, r0), f = enu(r0); // the plane's azimuth over the pad (the plane guidance flew to, not the plan's azimuth)
      return { t: ins.t_s != null ? ins.t_s : ins.t, theta1: wrap2pi(Math.atan2(dot(cross(u0, rh), n), dot(u0, rh))), rmag: norm(r), vr: dot(v, rh), vt: dot(v, cross(n, rh)), mass: ins.mass_kg != null ? ins.mass_kg : ins.mass, padOffPlaneDeg: Math.asin(dot(r0, n)) / DEG,
        planeAzimuthDeg: wrap2pi(Math.atan2(dot(d, f.east), dot(d, f.north))) / DEG, n: n };
    }
    /** The insertion state for a plane with normal h through the pad u (MOD): the profile turned into that plane. */
    function placeAscent(prof, u, h) {
      var u0 = unit(sub(u, scale(h, dot(u, h)))), w = cross(h, u0);
      var rh = add(scale(u0, Math.cos(prof.theta1)), scale(w, Math.sin(prof.theta1))), th = cross(h, rh);
      return { r: scale(rh, prof.rmag), v: add(scale(rh, prof.vr), scale(th, prof.vt)) };
    }

    // ================================================================== the coast: point mass + J2, RK4
    /** Gravity acceleration (m/s^2) at r (MOD, z the spin axis): Aster's GM, plus J2 about z if j2. */
    function accel(r, j2) {
      var x = r[0], y = r[1], z = r[2], r2 = x * x + y * y + z * z, rn = Math.sqrt(r2), k0 = -MU / (r2 * rn);
      var a = [k0 * x, k0 * y, k0 * z];
      if (j2) {
        var k = -1.5 * J2 * MU * RJ2 * RJ2 / (r2 * r2 * rn), q = 5 * z * z / r2;
        a[0] += k * x * (1 - q); a[1] += k * y * (1 - q); a[2] += k * z * (3 - q);
      }
      return a;
    }
    function rk4(y, h, j2) {
      var f = function (s) { var a = accel(s, j2); return [s[3], s[4], s[5], a[0], a[1], a[2]]; };
      var k1 = f(y), y2 = [], y3 = [], y4 = [], i;
      for (i = 0; i < 6; i++) y2[i] = y[i] + h / 2 * k1[i];
      var k2 = f(y2); for (i = 0; i < 6; i++) y3[i] = y[i] + h / 2 * k2[i];
      var k3 = f(y3); for (i = 0; i < 6; i++) y4[i] = y[i] + h * k3[i];
      var k4 = f(y4), out = [];
      for (i = 0; i < 6; i++) out[i] = y[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      return out;
    }
    /** Propagate (r, v) for T seconds in steps of at most dt. */
    function propagate(r, v, T, opts) {
      opts = opts || {};
      var dt = opts.dt || 10, n = Math.max(1, Math.ceil(T / dt)), h = T / n, y = r.concat(v);
      for (var i = 0; i < n; i++) y = rk4(y, h, opts.j2 !== false);
      return { r: y.slice(0, 3), v: y.slice(3) };
    }
    /**
     * Coast from insertion to the departure point: the first time, at least tMin after insertion, that the asymptote s
     * lies nu_inf(r) ahead of the vehicle along its motion (an impulsive burn at the hyperbola's perigee would leave
     * along s). Returns {t (s after insertion), r, v, revs (whole extra revolutions skipped for tMin), late} or, if
     * none before tMax, {late: true, t: tMax}. For a target vector (no hyperbola) the coast is fixed: tFixed.
     */
    function coastToDeparture(r0, v0, s, c3, lim, opts) {
      opts = opts || {};
      var dt = opts.dt || 10, j2 = opts.j2 !== false, y = r0.concat(v0), t = 0;
      if (!(c3 > 0)) { var pf = propagate(r0, v0, lim.fixed, { dt: dt, j2: j2 }); return { t: lim.fixed, r: pf.r, v: pf.v, fixed: true }; }
      var g = function (yy) { var rr = yy.slice(0, 3), hh = unit(cross(rr, yy.slice(3))); return wrap2pi(angleAhead(rr, s, hh) - nuInf(c3, norm(rr))); };
      var gPrev = g(y), skipped = 0, nMax = Math.ceil(lim.max / dt) + 2;
      for (var i = 0; i < nMax; i++) {
        var h = Math.min(dt, lim.max - t);
        if (h <= 1e-9) break;
        var yn = rk4(y, h, j2), gn = g(yn);
        if (gn > gPrev + Math.PI) { // the angle to go wrapped through zero inside this step: bisect for the crossing
          var lo = 0, hi = h, ylo = y;
          for (var k = 0; k < 60 && hi - lo > 1e-6; k++) {
            var mid = (lo + hi) / 2, ym = rk4(y, mid, j2), gm = g(ym);
            if (gm > Math.PI) hi = mid; else { lo = mid; ylo = ym; }
          }
          var tc = t + (lo + hi) / 2, yc = rk4(y, (lo + hi) / 2, j2);
          void ylo;
          if (tc >= lim.min) return { t: tc, r: yc.slice(0, 3), v: yc.slice(3), revs: skipped };
          skipped++;
        }
        y = yn; gPrev = gn; t += h;
      }
      return { late: true, t: lim.max, r: y.slice(0, 3), v: y.slice(3), revs: skipped };
    }

    // ================================================================== the launch at one instant
    /**
     * Solve the launch at UTC instant ms: the azimuth inside the corridor whose plane, after the coast, contains the
     * asymptote. env: {asym (from asymptote()), lonDeg, latDeg, corridor [min, max] deg, coast {min, max, fixed} s,
     * j2 (bool), dt (s)}; prof: an ascent profile (profileOf). With J2 the liftoff plane is aimed at the asymptote turned
     * about the pole by psi, and psi is found (secant) so that the plane at the departure point contains it.
     */
    function solveAt(env, ms, prof) {
      var T = orient(ms);
      if (T.refusal) return T;
      var S = mxv(T.P, env.asym.S), u = padUnit(T, env.lonDeg, env.latDeg), lim = env.coast;
      if (Math.abs(dot(u, S)) > 1 - 1e-12) return { refusal: refusal('out_of_envelope', 'The asymptote is straight overhead or underfoot: every plane through the pad contains it.', 'Another instant.', { applies_to: 'geometry' }) };
      function attempt(psi) {
        var Sp = rotZ(S, psi), ch = chooseAzimuth(u, Sp, env.corridor), pl = planeOf(u, ch.az);
        var ins = placeAscent(prof, u, pl.h), ev = coastToDeparture(ins.r, ins.v, S, env.asym.c3, lim, { dt: env.dt, j2: env.j2 });
        var hb = unit(cross(ev.r, ev.v));
        return { psi: psi, ch: ch, pl: pl, ins: ins, ev: ev, hb: hb, beta: Math.asin(Math.max(-1, Math.min(1, dot(hb, S)))), node0: nodeOf(pl.h), nodeB: nodeOf(hb) };
      }
      var a = attempt(0), it = 0;
      if (env.j2 && !a.ev.late) {
        var b = attempt(-wrapPi(a.nodeB - a.node0));
        while (Math.abs(b.beta) > 1e-11 && it < 12 && !b.ev.late) {
          if (b.beta === a.beta) break;
          var next = b.psi - b.beta * (b.psi - a.psi) / (b.beta - a.beta);
          a = b; b = attempt(next); it++;
        }
        a = b;
      }
      var inc = inclinationOf(a.pl.h);
      return { T: T, ms: ms, u: u, S: S, azDeg: a.ch.deg, az: a.ch.az, inCorridor: a.ch.miss === 0, corridorMissDeg: a.ch.miss, h: a.pl.h, inclinationDeg: inc / DEG, nodeDeg: a.node0 / DEG,
        rangeAngleDeg: angleAhead(u, S, a.pl.h) / DEG, psiDeg: a.psi / DEG, ins: a.ins, ev: a.ev, hb: a.hb, betaDeg: a.beta / DEG, iterations: it,
        coastOk: !a.ev.late && a.ev.t >= lim.min - 1e-6 && a.ev.t <= lim.max, prof: prof };
    }
    /** The handbook's closed form at instant ms: azimuth with the J2 bias of eq. (25)/(27) over a coast estimated from
     * the range angle (eq. 22 with theta_2 = nu_I = 0) at the parking orbit's mean motion; no propagation. */
    function fastAt(env, ms, prof) {
      var T = orient(ms);
      if (T.refusal) return T;
      var S = mxv(T.P, env.asym.S), u = padUnit(T, env.lonDeg, env.latDeg), lim = env.coast;
      var ch0 = chooseAzimuth(u, S, env.corridor);
      if (!ch0) return null;
      var pl0 = planeOf(u, ch0.az), theta = angleAhead(u, S, pl0.h), a = prof.rmag, n = Math.sqrt(MU / (a * a * a)), coast;
      if (env.asym.c3 > 0) {
        var arc = wrap2pi(theta - prof.theta1 - nuInf(env.asym.c3, a)), extra = 0;
        while (arc / n < lim.min - 1e-9) { arc += TWO_PI; extra++; }
        coast = arc / n;
      } else coast = lim.fixed;
      var inc0 = inclinationOf(pl0.h) / DEG, dOmega = env.j2 ? regressionPerRev(a, inc0, RJ2, J2) * (coast * n / TWO_PI) * DEG : 0;
      var ch = chooseAzimuth(u, rotZ(S, -dOmega), env.corridor), pl = planeOf(u, ch.az);
      return { ms: ms, azDeg: ch.deg, az0Deg: ch0.deg, inCorridor: ch.miss === 0, corridorMissDeg: ch.miss, coast: coast, coastOk: coast <= lim.max && coast >= lim.min - 1e-6,
        inclinationDeg: inclinationOf(pl.h) / DEG, nodeDeg: nodeOf(pl.h) / DEG, rangeAngleDeg: theta / DEG, dOmegaDeg: dOmega / DEG };
    }

    // ================================================================== the day's windows
    /**
     * The launch windows that open on the asymptote's UTC date: stretches when the coplanar azimuth is inside the
     * corridor and the coast is inside its limits. Scanned every opts.step s (default 120) with fastAt from 1 h before
     * the day to 48 h after its start (so a window opening late in the day is followed to its close), each edge refined
     * to 0.05 s by bisection on solveAt (numerical, with J2). A day with every moment inside is one 24 h window.
     */
    function dailyWindows(env, prof, opts) {
      opts = opts || {};
      var day = env.asym.dayMs, step = opts.step || 120, t0 = day - 3600e3, t1 = day + 48 * 3600e3, samples = [];
      for (var t = t0; t <= t1; t += step * 1000) { var f = fastAt(env, t, prof); if (f && !f.refusal) samples.push(f); }
      var ok = function (s) { return s && !s.refusal && s.inCorridor && s.coastOk; };
      // at an edge the vehicle flies the corridor's limiting azimuth: opts.edgeProfile(az) gives the ascent flown there
      var edgeProf = function (ms) { if (!opts.edgeProfile) return prof; var f = fastAt(env, ms, prof), c = env.corridor; return opts.edgeProfile(Math.abs(f.azDeg - c[0]) <= Math.abs(f.azDeg - c[1]) ? c[0] : c[1]) || prof; };
      var exact = function (ms, pr) { var s = solveAt(env, ms, pr || prof); return { ok: ok(s), s: s }; };
      // bisect on the numerical solve between a sample inside and the one outside it; the closed form and the
      // numerical solve differ by about 0.01 deg, so a marginal inside sample is replaced by the next one in (dir)
      var edge = function (iIn, iOut, dir) {
        var pr = edgeProf(samples[iOut].ms), k = 0;
        while (k < 6 && samples[iIn] && !exact(samples[iIn].ms, pr).ok) { iIn += dir; k++; }
        if (!samples[iIn] || k >= 6) return null;
        var a = samples[iIn].ms, b = samples[iOut].ms;
        for (k = 0; k < 60 && Math.abs(b - a) > 50; k++) { var m = (a + b) / 2; if (exact(m, pr).ok) a = m; else b = m; }
        return { ms: a, prof: pr };
      };
      var wins = [];
      for (var i = 1; i < samples.length; i++) {
        var p = ok(samples[i - 1]), q = ok(samples[i]);
        if (!p && q) wins.push({ openBracket: [i, i - 1] });
        if (p && !q && wins.length && wins[wins.length - 1].closeBracket == null) wins[wins.length - 1].closeBracket = [i - 1, i];
      }
      var out = [];
      if (samples.length && samples.every(ok)) { // never closes: the whole day is a window
        var s0 = solveAt(env, day, prof), s1 = solveAt(env, day + 86400e3, prof);
        out.push({ openMs: day, closeMs: day + 86400e3, open: iso(day), close: iso(day + 86400e3), duration: 86400, azOpenDeg: s0.azDeg, azCloseDeg: s1.azDeg, coastOpen: s0.ev.t, coastClose: s1.ev.t, boundBy: ['open all day', 'open all day'] });
        return { windows: out, samples: samples, step: step };
      }
      wins.forEach(function (w) {
        if (!w.closeBracket) return;
        var eo = edge(w.openBracket[0], w.openBracket[1], 1), ec = edge(w.closeBracket[0], w.closeBracket[1], -1);
        if (!eo || !ec || ec.ms <= eo.ms) return;
        var o = eo.ms, c = ec.ms;
        if (o < day || o >= day + 86400e3) return;
        var so = solveAt(env, o, eo.prof), sc = solveAt(env, c, ec.prof);
        out.push({ openMs: o, closeMs: c, open: iso(o), close: iso(c), duration: (c - o) / 1000, azOpenDeg: so.azDeg, azCloseDeg: sc.azDeg, coastOpen: so.ev.t, coastClose: sc.ev.t,
          boundBy: [edgeCause(so, env), edgeCause(sc, env)] });
      });
      return { windows: out, samples: samples, step: step };
    }
    function edgeCause(s, env) {
      var a = s.azDeg, c = env.corridor;
      if (Math.abs(a - c[0]) < 0.01 || Math.abs(a - c[1]) < 0.01) return 'azimuth ' + fmt(Math.abs(a - c[0]) < 0.01 ? c[0] : c[1], 4) + ' deg';
      return 'coast limit';
    }

    // ================================================================== the vehicle, re-flown at an azimuth (idea 36)
    /** Idea 36's guided ascent flown at launch azimuth azDeg (its first stage on that azimuth, guidance aimed at the
     * plane of that azimuth over the pad, the imported perigee and apogee): {ok, profile, propellant, flight} or {refusal}. */
    function flyAt(ctx, azDeg) {
      var lat = ctx.plan.site.latitudeDeg, plan = clone(ctx.plan);
      plan.azimuthDeg = azDeg;
      var inc = Math.acos(Math.max(-1, Math.min(1, Math.cos(lat * DEG) * Math.sin(azDeg * DEG)))) / DEG;
      var target = { perigeeAlt: ctx.target.perigeeAlt, apogeeAlt: ctx.target.apogeeAlt, inclinationDeg: inc, branch: Math.cos(azDeg * DEG) >= 0 ? 'north' : 'south', source: 'Window: the plane of launch azimuth ' + fmt(azDeg, 7) + ' deg' };
      var tgt = C.targetOrbit(target, lat);
      if (tgt.refusal) return { refusal: tgt.refusal };
      var bad = A.validatePlan(ctx.veh, ctx.engines, plan);
      if (bad.length) return { refusal: bad[0] };
      var r1 = A.fly(ctx.veh, ctx.engines, plan, { burns: 1, samples: false });
      if (!r1.ok && r1.refusals) return { refusal: r1.refusals[0] };
      var g = C.flyClosed(ctx.veh, ctx.engines, plan, { mode: 'upfg', startAfter: ctx.guidance.startAfter, cycle: ctx.guidance.cycle }, tgt, { samples: false, stage1: r1 });
      if (!g.ok) return { refusal: (g.refusals && g.refusals[0]) || refusal('out_of_envelope', 'The guided ascent at ' + fmt(azDeg, 5) + ' deg does not reach orbit.', 'Another azimuth.') };
      if (!g.inOrbit) return { refusal: refusal('out_of_envelope', 'Guided at azimuth ' + fmt(azDeg, 5) + ' deg the vehicle does not reach orbit.', 'An azimuth nearer due east, or a vehicle with more performance.', { applies_to: 'performance' }) };
      var f = g.final;
      return { ok: true, azDeg: azDeg, inclinationDeg: inc, target: target, flight: g, ins: { t_s: f.t, r_m: f.r, v_m_s: f.v, mass_kg: f.mass }, profile: profileOf({ t_s: f.t, r_m: f.r, v_m_s: f.v, mass_kg: f.mass }, lat),
        propellant: g.guided.propellantLeft, endedBy: g.endedBy };
    }
    /** solveAt with the vehicle re-flown at the solved azimuth until the azimuth stops moving (the ascent arc and
     * insertion time change with azimuth, and with them the coast and the J2 bias). */
    function solveFlown(env, ms, ctx, prof0) {
      var s = solveAt(env, ms, prof0);
      if (s.refusal) return s;
      var outside = function (x) { return { solve: x, refusal: refusal('out_of_envelope', 'At ' + iso(ms) + ' the plane through the pad and the asymptote leaves on azimuth ' + fmt(x.azDeg, 6) + ' deg, outside the corridor (' + env.corridor[0] + ' to ' + env.corridor[1] + ' deg): not inside a launch window.', 'A launch time inside one of the day\'s windows, or a wider corridor (a dogleg is not modelled).', { applies_to: 'launch_time' }) }; };
      var clampAz = function (a) { var c = env.corridor; return Math.min(c[1], Math.max(c[0], a)); };
      var fl = null;
      for (var k = 0; k < 8; k++) {
        if (s.corridorMissDeg > 0.5) return outside(s); // far outside: no flight will bring it in
        var az = clampAz(s.azDeg);
        fl = flyAt(ctx, az);
        if (fl.refusal) return { solve: s, refusal: fl.refusal };
        var s2 = solveAt(env, ms, fl.profile), d = Math.abs(s2.azDeg - az);
        s = s2;
        if (d < 1e-9) break;
      }
      if (!s.inCorridor) return outside(s);
      if (Math.abs(fl.azDeg - s.azDeg) > 1e-9) { fl = flyAt(ctx, s.azDeg); if (fl.refusal) return { solve: s, refusal: fl.refusal }; s = solveAt(env, ms, fl.profile); }
      return { solve: s, flight: fl };
    }
    /** Propellant left for the departure across each window: the ascent re-flown at n azimuths per window. */
    function performance(env, ctx, prof, windows, n) {
      var out = [];
      windows.forEach(function (w, wi) {
        for (var k = 0; k < n; k++) {
          var pad = Math.min(30e3, (w.closeMs - w.openMs) / 100), ms = w.openMs + pad + (w.closeMs - w.openMs - 2 * pad) * k / (n - 1), s = solveAt(env, ms, prof), fl = flyAt(ctx, s.azDeg);
          out.push({ window: wi, ms: ms, utc: iso(ms), azDeg: s.azDeg, inclinationDeg: s.inclinationDeg, propellant: fl.refusal ? null : fl.propellant, refused: fl.refusal ? fl.refusal.reason : null });
        }
      });
      return out;
    }

    // ================================================================== the departure point (impulsive reference)
    function departureOf(s, env) {
      if (!(env.asym.c3 > 0)) return null;
      var r = s.ev.r, v = s.ev.v, rn = norm(r), hb = s.hb, dir = unit(cross(hb, r));
      var vp = Math.sqrt(env.asym.c3 + 2 * MU / rn), vpv = scale(dir, vp), dv = sub(vpv, v);
      return { r: r, v: v, rn: rn, vp: vp, dv: norm(dv), dvVec: dv, nuInfDeg: nuInf(env.asym.c3, rn) / DEG, eH: 1 + env.asym.c3 * rn / MU, gammaDeg: Math.asin(dot(unit(r), unit(v))) / DEG };
    }

    /**
     * The delta-v the propellant left can buy (added by the independent review): the ideal rocket equation on the guided
     * stage's own numbers, dv = ve ln(m0 / (m0 - mp)), with m0 the mass at insertion (idea 36 re-flown), mp the propellant
     * left, and ve that stage's engine vacuum exhaust velocity from idea 33's deck as idea 36 flies it (thrust / total mass
     * flow). No gravity or steering loss: an upper bound on what the departure burn can give, so a capacity below the
     * impulsive need (itself a lower bound) means the departure cannot be flown from this launch. {ve, m0, mf, mp, dv,
     * stage, engine} or null.
     */
    function capacityOf(ctx, fl) {
      if (!fl || !fl.flight || !fl.flight.guided || !fl.ins) return null;
      var g = fl.flight.guided, stg = ctx.veh.stages[g.stage], eng = stg && ctx.engines[stg.engine];
      if (!eng || !num(eng.ispVac)) return null;
      var m0 = fl.ins.mass_kg, mp = fl.propellant, mf = m0 - mp;
      if (!(num(m0) && num(mp) && mf > 0)) return null;
      return { ve: eng.ispVac, m0: m0, mf: mf, mp: mp, dv: eng.ispVac * Math.log(m0 / mf), stage: stg.label, engine: eng.id };
    }
    /** The refusal when that capacity is below the impulsive departure's delta-v (null when it covers it). */
    function capacityRefusal(cap, dep) {
      if (!cap || !dep || cap.dv >= dep.dv) return null;
      var short = dep.dv - cap.dv, marginal = short < 0.02 * dep.dv;
      return refusal('out_of_envelope', 'The ' + fmt(cap.mp, 5) + ' kg left in the ' + cap.stage + ' buy at most ' + fmt(cap.dv, 4) + ' m/s (ideal rocket equation, ' + cap.engine + ' vacuum exhaust velocity ' + fmt(cap.ve, 4) + ' m/s, no gravity loss) against the ' + fmt(dep.dv, 4) + ' m/s an impulsive burn needs for this C3: ' + (marginal ? 'marginal, short by ' + fmt(short, 3) + ' m/s, within the error of this yardstick (it reads Apollo 17\'s own translunar burn at least 0.9 % short of what that burn did; README).' : 'this vehicle cannot make this departure from this launch (short by ' + fmt(short, 3) + ' m/s before any finite-burn loss).'), 'More upper-stage propellant or a lighter payload (module 34), a lower C3 (module 39), or a launch azimuth nearer due east.', { applies_to: 'departure_propellant', capacity_m_s: cap.dv, need_m_s: dep.dv });
    }

    // ================================================================== Apollo 17: the checks on a real window
    /** The fixed direction (in the mean frame of date) whose plane through the pad gives azimuth az1 at ms1 and az2 at
     * ms2 (eastward branch), by Newton from a coarse search. */
    function fitDirection(lonDeg, latDeg, ms1, az1, ms2, az2) {
      var T1 = orient(ms1), T2 = orient(ms2), u1 = padUnit(T1, lonDeg, latDeg), u2 = padUnit(T2, lonDeg, latDeg);
      var dir = function (ra, de) { return [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)]; };
      var east = function (u, s) { var a = azimuthToward(u, s); if (a == null) return NaN; return Math.sin(a) >= 0 ? a : wrap2pi(a + Math.PI); };
      var res = function (x) { var s = dir(x[0], x[1]); return [wrapPi(east(u1, s) - az1 * DEG), wrapPi(east(u2, s) - az2 * DEG)]; };
      var best = null;
      for (var ra = 0; ra < 360; ra += 4) for (var de = -80; de <= 80; de += 4) {
        var r = res([ra * DEG, de * DEG]), q = r[0] * r[0] + r[1] * r[1];
        if (isFinite(q) && (!best || q < best.q)) best = { q: q, x: [ra * DEG, de * DEG] };
      }
      var x = best.x;
      for (var it = 0; it < 50; it++) {
        var f = res(x); if (Math.abs(f[0]) + Math.abs(f[1]) < 1e-14) break;
        var e = 1e-8, fa = res([x[0] + e, x[1]]), fb = res([x[0], x[1] + e]);
        var J = [[(fa[0] - f[0]) / e, (fb[0] - f[0]) / e], [(fa[1] - f[1]) / e, (fb[1] - f[1]) / e]], det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        x = [x[0] - (J[1][1] * f[0] - J[0][1] * f[1]) / det, x[1] - (-J[1][0] * f[0] + J[0][0] * f[1]) / det];
      }
      var s = dir(x[0], x[1]);
      return { S: s, raDeg: (x[0] / DEG % 360 + 360) % 360, decDeg: x[1] / DEG, residualDeg: res(x).map(function (q) { return q / DEG; }), eastAt: function (ms) { var T = orient(ms); return east(padUnit(T, lonDeg, latDeg), s) / DEG; } };
    }
    /**
     * Apollo 17 (AS-512), 6/7 December 1972. The report gives the flight azimuth at the scheduled liftoff (72.141 deg,
     * 02:53:00 UT, the hold at T-30 s plus 30 s) and at the actual one (91.504 deg, 05:33:00 UT). A target direction fixed
     * in space fitted to those two predicts when the azimuth reaches the press kit's 100 deg limit; the press kit closes
     * the window at 06:31 UT. Also eq. (15)'s inclination at 91.504 deg against Table 4-4.
     */
    function apollo17(latDeg, lonDeg) {
      var lat = latDeg != null ? latDeg : EARTH.sites['cape-canaveral'].latitudeDeg, lon = lonDeg != null ? lonDeg : PAD39A.lonDeg;
      var t1 = parseUtc(AP.holdUtc) + AP.holdAtTminus_s * 1000, t2 = parseUtc(AP.liftoffUtc), lim = AP.window.azimuthLimitsDeg;
      var fit = fitDirection(lon, lat, t1, AP.azimuthScheduledDeg, t2, AP.azimuthFlownDeg);
      var f = function (ms) { return fit.eastAt(ms) - lim[1]; }, a = t2, b = t2 + 6 * 3600e3;
      for (var k = 0; k < 60; k++) { var m = (a + b) / 2; if (f(m) < 0) a = m; else b = m; }
      var close = (a + b) / 2, open = function () { var lo = t1 - 3600e3, hi = t1; for (var j = 0; j < 60; j++) { var mm = (lo + hi) / 2; if (fit.eastAt(mm) < lim[0]) lo = mm; else hi = mm; } return (lo + hi) / 2; }();
      var pressClose = parseUtc(AP.window.closeUtc), pressOpen = parseUtc(AP.window.openUtc);
      var incFlown = Math.acos(Math.cos(lat * DEG) * Math.sin(AP.azimuthFlownDeg * DEG)) / DEG;
      return { latDeg: lat, lonDeg: lon, fit: { raDeg: fit.raDeg, decDeg: fit.decDeg, residualDeg: fit.residualDeg }, scheduledMs: t1, liftoffMs: t2,
        predictedCloseMs: close, predictedClose: iso(close), pressKitClose: AP.window.closeUtc, closeGap_s: (close - pressClose) / 1000,
        predictedOpenMs: open, predictedOpen: iso(open), pressKitOpen: AP.window.openUtc, openGap_s: (open - pressOpen) / 1000,
        inclinationAtFlownDeg: incFlown, inclinationTable44Deg: AP.insertion.inclinationDeg, inclinationGapDeg: incFlown - AP.insertion.inclinationDeg, azimuthAt: fit.eastAt };
    }
    /**
     * Apollo 17's own translunar burn as the yardstick for capacityOf() (added by the independent review): the chain's
     * vehicle re-flown on an azimuth (fl, from flyAt on the AS-512) against the S-IVB's real burn, Table 16-7's ACT total
     * vehicle mass at ignition and at cutoff, at the same exhaust velocity, and the impulsive delta-v Table 4-5's C3 needs
     * from the chain's insertion radius. {chain, flownDv, needDv} or null.
     */
    function tliCheck(ctx, fl) {
      var cap = capacityOf(ctx, fl), B = AP.tliBurn;
      if (!cap || !B) return null;
      var r = norm(fl.ins.r_m), need = Math.sqrt(AP.tli.c3_m2s2 + 2 * MU / r) - Math.sqrt(MU / r);
      return { chain: cap, flownDv: cap.ve * Math.log(B.massIgnitionKg / B.massCutoffKg), flownM0: B.massIgnitionKg, flownMf: B.massCutoffKg, needDv: need, radius: r };
    }
    /** Apollo 17 as a preset: the fitted target direction (turned from the mean frame of 1972-12-07 to J2000), Table 4-5's
     * C3 (negative: a target vector, not an asymptote), the press kit's 72 to 100 deg corridor, J2 off (the fit already
     * holds whatever bias the flight's targeting applied) and the actual liftoff. */
    function apollo17Preset() {
      var a = apollo17(), T = orient(a.liftoffMs), d = [Math.cos(a.fit.decDeg * DEG) * Math.cos(a.fit.raDeg * DEG), Math.cos(a.fit.decDeg * DEG) * Math.sin(a.fit.raDeg * DEG), Math.sin(a.fit.decDeg * DEG)], S = mtxv(T.P, d);
      return { spec: { c3_m2_s2: AP.tli.c3_m2s2, rlaDeg: (Math.atan2(S[1], S[0]) / DEG + 360) % 360, dlaDeg: Math.asin(S[2]) / DEG, dateUtc: '1972-12-07', source: 'Apollo 17: the fixed direction whose plane through the pad gives MPR-SAT-FE-73-1\'s 72.141 deg at 02:53:00 UT and 91.504 deg at 05:33:00 UT (section 9.3.1); C3 from Table 4-5' },
        settings: { corridor: AP.window.azimuthLimitsDeg.slice(), j2: false, launchUtc: AP.liftoffUtc }, check: a };
    }
    /** AS-512's parking orbit from Table 4-4 (geodetic latitude and altitude on Aster's pck00010 ellipsoid, inclination,
     * descending node from the launch meridian, speed and flight-path angle), coasted with and without J2 to the time of
     * Table 4-5: the node's motion predicted against the flight's (which includes the translunar burn). */
    function as512Coast(opts) {
      opts = opts || {};
      var I = AP.insertion, e2 = 1 - (RPOLE / REQ) * (RPOLE / REQ), p = I.geodeticLatDeg * DEG, h = I.altitudeKm * 1000;
      var Nr = REQ / Math.sqrt(1 - e2 * Math.sin(p) * Math.sin(p)), rho = (Nr + h) * Math.cos(p), z = (Nr * (1 - e2) + h) * Math.sin(p);
      var rn = Math.hypot(rho, z), phiC = Math.atan2(z, rho), inc = I.inclinationDeg * DEG, Om = (I.descendingNodeDeg + 180) * DEG;
      var su = Math.sin(phiC) / Math.sin(inc), uArg = Math.PI - Math.asin(Math.max(-1, Math.min(1, su))); // descending: heading 105 deg
      var nodeV = [Math.cos(Om), Math.sin(Om), 0], hN = [Math.sin(inc) * Math.sin(Om), -Math.sin(inc) * Math.cos(Om), Math.cos(inc)], w = cross(hN, nodeV);
      var rh = add(scale(nodeV, Math.cos(uArg)), scale(w, Math.sin(uArg))), th = cross(hN, rh), g = I.fpaDeg * DEG;
      var r0 = scale(rh, rn), v0 = add(scale(rh, I.velocityMs * Math.sin(g)), scale(th, I.velocityMs * Math.cos(g)));
      var T = (opts.toRangeTime || AP.tli.rangeTime) - I.rangeTime;
      var withJ2 = propagate(r0, v0, T, { dt: opts.dt || 10, j2: true }), noJ2 = propagate(r0, v0, T, { dt: opts.dt || 10, j2: false });
      var dn = function (st) { return (nodeOf(unit(cross(st.r, st.v))) / DEG - 180 + 360) % 360; };
      var aPark = 1 / (2 / rn - I.velocityMs * I.velocityMs / MU), revs = T / (TWO_PI * Math.sqrt(aPark * aPark * aPark / MU));
      return { coast_s: T, r0: r0, v0: v0, geocentricLatDeg: phiC / DEG, dnStartDeg: I.descendingNodeDeg, dnJ2Deg: dn(withJ2), dnNoJ2Deg: dn(noJ2), dnFlightDeg: AP.tli.descendingNodeDeg,
        predictedChangeDeg: wrapPi((dn(withJ2) - I.descendingNodeDeg) * DEG) / DEG, flightChangeDeg: AP.tli.descendingNodeDeg - I.descendingNodeDeg,
        eq25ChangeDeg: regressionPerRev(aPark, I.inclinationDeg, RJ2, J2) * revs, revolutions: revs, inclinationJ2Deg: inclinationOf(cross(withJ2.r, withJ2.v)) / DEG };
    }

    // ================================================================== Aster's screening band, for comparison
    /** Aster's classifyFeasibility (feasibility.ts, AMD-12-1) on this site's corridor: GREEN |DLA| <= iMin, AMBER up to
     * the ceiling (max over the corridor's inclinations of min(i, 180 - i)), RED beyond. */
    function asterBand(dlaDeg, siteId) {
      var s = EARTH.sites[siteId];
      if (!s) return null;
      var ceil = s.iMaxDeg >= 90 ? 90 : s.iMaxDeg, a = Math.abs(dlaDeg);
      return { cls: a <= s.iMinDeg ? 'GREEN' : a <= ceil ? 'AMBER' : 'RED', iMinDeg: s.iMinDeg, ceilingDeg: ceil, site: s.name };
    }

    // ================================================================== putting it together
    var COAST_FLOWN_S = AP.secondEcoRangeTime - AP.insertion.rangeTime; // AS-512: insertion to the end of its TLI burn
    /** Defaults for a set-up: the corridor of the imported site (Aster's), the coast from 0 to AS-512's insertion-to-TLI
     * cutoff (demonstrated, not a limit), Pad 39A's longitude for Aster's Cape Canaveral site, J2 on, 10 s steps. */
    function defaults(siteId) {
      var s = EARTH.sites[siteId];
      return { corridor: s ? s.azimuthCorridorDeg.slice() : null, coast: { min: 0, max: COAST_FLOWN_S, fixed: AP.timeBase6RangeTime - AP.insertion.rangeTime },
        lonDeg: siteId === 'cape-canaveral' ? PAD39A.lonDeg : null, lonSource: siteId === 'cape-canaveral' ? PAD39A.source : null, j2: true, dt: 10, opportunity: 0, fraction: 0 };
    }
    /**
     * Read idea 36's handoff (re-checked by idea 36's own parseHandoff, which re-flies it) and build the set-up:
     * {ctx (idea 36's), h36, prof (the imported flight's ascent profile), latDeg, siteId} or {refusal}.
     */
    function importClosedLoop(h36) {
      var h = h36;
      if (typeof h36 === 'string') { try { h = JSON.parse(h36); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 36 (Closed Loop) or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round') return { refusal: refusal('invalid_input', 'That is not a Long Way Round handoff.', 'A handoff from idea 36 (Closed Loop) or from this page.') };
      if (h.from === '37-window') return parseHandoff(h);
      if (h.from !== '36-closed-loop') return { refusal: refusal('invalid_input', 'This is a handoff from ' + h.from + '; Window takes idea 36\'s (the parking orbit a guided ascent reached).', 'Fly it through idea 36 (Closed Loop) first.') };
      var ctx = C.parseHandoff(h);
      if (ctx.refusal) return ctx;
      var g = ctx.result && ctx.result.guided;
      if (!g || !g.ok) return { refusal: refusal('insufficient_data', 'Idea 36\'s handoff carries no guided flight to orbit (its own refusal: ' + ((g && g.refusals && g.refusals[0] && g.refusals[0].reason) || 'none given') + ').', 'A handoff whose guided ascent reached its target.', { applies_to: 'parking_orbit' }) };
      var ins = h.outputs.insertion_state.value, lat = ctx.plan.site.latitudeDeg;
      var prof = profileOf(ins, lat);
      return { ctx: ctx, h36: h, prof: prof, latDeg: lat, siteId: ctx.plan.site.id, azPlanDeg: ctx.plan.azimuthDeg, azFlownDeg: prof.planeAzimuthDeg };
    }
    function validate(st, set) {
      var c = set.corridor, k = set.coast;
      if (!(Array.isArray(c) && c.length === 2 && c.every(num) && c[0] >= 0 && c[1] <= 360 && c[0] < c[1])) return refusal('invalid_input', 'The azimuth corridor needs a lower and a higher limit, 0 to 360 degrees.', 'Two azimuths, such as Aster\'s 35 to 120 for Cape Canaveral.', { applies_to: 'corridor' });
      if (!(k && num(k.min) && num(k.max) && k.min >= 0 && k.max > k.min && k.max <= 2 * 86400)) return refusal('invalid_input', 'The coast limits need a minimum of zero or more and a larger maximum, under two days.', 'Coast limits in seconds.', { applies_to: 'coast' });
      if (!num(set.lonDeg)) return refusal('insufficient_data', 'No longitude is known for this launch site (' + st.siteId + '): the chain gives its latitude only, and the time of day of a window depends on the longitude.', 'Type the pad\'s east longitude.', { applies_to: 'site' });
      if (!(set.lonDeg >= -180 && set.lonDeg <= 360)) return refusal('invalid_input', 'A longitude is between -180 and 360 degrees.', 'The pad\'s east longitude.', { applies_to: 'site' });
      if (!(num(set.dt) && set.dt >= 1 && set.dt <= 60)) return refusal('invalid_input', 'The coast step must be 1 to 60 s.', 'A step in seconds.', { applies_to: 'coast' });
      return null;
    }
    /**
     * Everything for one set-up: st (importClosedLoop's), asym spec, settings {corridor, coast, lonDeg, lonSource, j2, dt,
     * opportunity, fraction, launchUtc (optional: overrides opportunity/fraction)}. Returns {asym, env, windows, launch,
     * flight, departure, perf, aster, refusals} (each part may be a refusal).
     */
    function compute(st, spec, set, opts) {
      opts = opts || {};
      var out = { refusals: [] }, asym = asymptote(spec);
      if (asym.refusal) { out.refusal = asym.refusal; return out; }
      var bad = validate(st, set);
      if (bad) { out.refusal = bad; return out; }
      out.asym = asym;
      var env = { asym: asym, lonDeg: set.lonDeg, latDeg: st.latDeg, corridor: set.corridor, coast: { min: set.coast.min, max: set.coast.max, fixed: set.coast.fixed != null ? set.coast.fixed : set.coast.max }, j2: set.j2 !== false, dt: set.dt || 10 };
      out.env = env;
      out.aster = asterBand(asym.dlaDeg, st.siteId);
      var T = timeOf(asym.dayMs);
      if (T.refusal) { out.refusal = T.refusal; return out; }
      var cache = {}, edgeProfile = function (az) { if (!(az in cache)) { var f = flyAt(st.ctx, az); cache[az] = f.refusal ? null : f.profile; } return cache[az]; };
      var dw = dailyWindows(env, st.prof, { step: opts.step, edgeProfile: edgeProfile });
      out.scan = dw.samples; out.windows = dw.windows;
      if (env.j2 && opts.noJ2 !== false) out.windowsNoJ2 = dailyWindows(Object.assign({}, env, { j2: false }), st.prof, { step: opts.step, edgeProfile: edgeProfile }).windows;
      if (!dw.windows.length) {
        var lim = Math.asin(Math.min(1, Math.cos(asym.dlaDeg * DEG) / Math.cos(st.latDeg * DEG))) / DEG;
        out.refusal = refusal('out_of_envelope', 'No launch window on ' + asym.dateUtc + ': at no time that day does the plane through the pad and the asymptote (declination ' + fmt(asym.dlaDeg, 4) + ' deg) leave on an azimuth inside ' + set.corridor[0] + ' to ' + set.corridor[1] + ' deg with a coast under ' + fmt(set.coast.max / 3600, 3) + ' h' +
          (Math.abs(asym.dlaDeg) > st.latDeg ? ' (the declination is beyond the site latitude, so only azimuths within ' + fmt(lim, 4) + ' deg of north or of south are reachable and those within ' + fmt(90 - lim, 4) + ' deg of east are not: JPL 82-43 eq. 14)' : '') + '.', 'A wider corridor, a longer coast limit, another day\'s asymptote, or a dogleg (not modelled here).', { applies_to: 'window' });
        return out;
      }
      var ms;
      if (set.launchUtc) {
        ms = parseUtc(set.launchUtc);
        if (ms == null) { out.refusal = refusal('invalid_input', 'The launch time is not a UTC time.', 'A time such as 2026-07-02T14:30:00Z.', { applies_to: 'launch_time' }); return out; }
      } else {
        var w = dw.windows[Math.min(dw.windows.length - 1, Math.max(0, set.opportunity | 0))], fr = num(set.fraction) ? Math.max(0, Math.min(1, set.fraction)) : 0;
        ms = Math.round(w.openMs + (w.closeMs - w.openMs) * fr);
      }
      var sf = solveFlown(env, ms, st.ctx, st.prof);
      if (sf.refusal) { out.refusal = sf.refusal; out.launch = sf.solve || null; return out; }
      var s = sf.solve;
      if (!s.coastOk) { out.refusal = refusal('out_of_envelope', 'Launching at ' + iso(ms) + ' the departure point comes ' + fmt(s.ev.t / 3600, 4) + ' h after insertion, outside the coast limits (' + fmt(set.coast.min / 3600, 3) + ' to ' + fmt(set.coast.max / 3600, 3) + ' h).', 'A launch time inside a window, or other coast limits.', { applies_to: 'coast' }); out.launch = s; return out; }
      out.launch = s; out.flight = sf.flight;
      out.departure = departureOf(s, env);
      out.capacity = capacityOf(st.ctx, sf.flight);
      var cr = capacityRefusal(out.capacity, out.departure);
      if (cr) out.refusals.push(cr);
      if (opts.perf !== false) out.perf = performance(env, st.ctx, sf.flight.profile, dw.windows, opts.perfN || 7);
      if (asym.mode === 'target') out.refusals.push(refusal('out_of_envelope', 'C3 is ' + fmt(asym.c3 / 1e6, 4) + ' km^2/s^2: an ellipse has no departure asymptote, so the direction is used as a target vector for the plane only, coasting a fixed ' + fmt(env.coast.fixed, 6) + ' s; no departure point or impulsive burn is computed.', 'A hyperbolic departure (C3 > 0), or a lunar-transfer targeting model (not built).', { applies_to: 'departure' }));
      return out;
    }

    // ================================================================== the handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function toJ2000(T, v) { return mtxv(T.P, v); }
    function elementsOf(r, v) {
      var h = cross(r, v), hn = norm(h), rn = norm(r), vn = norm(v), En = vn * vn / 2 - MU / rn, ev = sub(scale(cross(v, h), 1 / MU), scale(r, 1 / rn)), e = norm(ev);
      var nvec = [-h[1], h[0], 0];
      return { a: -MU / (2 * En), e: e, inclinationDeg: Math.acos(h[2] / hn) / DEG, raanDeg: wrap2pi(Math.atan2(nvec[1], nvec[0])) / DEG, argLatDeg: wrap2pi(Math.atan2(dot(cross(unit(nvec), r), unit(h)), dot(unit(nvec), r))) / DEG };
    }
    var KEEP36 = function (x) { return true; };
    /**
     * The handoff to module 38 (version 1, from: "37-window"). inputs: idea 36's handoff whole, the asymptote spec and the
     * settings. outputs (SI): launch, daily_windows, insertion_state_j2000, parking_orbit_j2000, coast, departure_point,
     * asymptote, impulsive_departure, propellant_for_departure, performance_across_window, aster_screening_band.
     */
    function makeHandoff(st, spec, set, R, extra) {
      extra = extra || {};
      var produced = extra.produced || new Date().toISOString();
      var h = { handoff: 'long-way-round', version: 1, from: '37-window', produced: produced,
        inputs: { closed_loop_handoff: st.h36, asymptote: clone(spec), settings: clone(set) }, outputs: {}, refusals: [], assumptions: [
          'Frames: geometry and the coast in the mean equator and equinox of date (IAU 2006 bias-precession, ERFA\'s coefficients); everything handed on in J2000 (ICRF axes, Aster\'s frame). Idea 36\'s frame (x through the launch meridian at liftoff) is that frame turned by the pad\'s right ascension at liftoff.',
          'Time: UTC from the clock, TT = UTC + (TAI - UTC from NAIF naif0012.tls) + 32.184 s; TDB = TT (periodic terms under 2 ms ignored, as Aster does); UT1 = UTC (|UT1 - UTC| < 0.9 s, not modelled). Nutation is not modelled (Earth\'s pole and sidereal time are the mean ones).',
          'Launch site: latitude ' + fmt(st.latDeg, 6) + ' deg on Aster\'s sphere (the latitude idea 35 flew from), east longitude ' + fmt(set.lonDeg, 7) + ' deg (' + (set.lonSource || 'user') + ').',
          'The parking orbit\'s plane passes through the pad at liftoff (no dogleg) and, after the coast, contains the asymptote. Coast: point-mass gravity (Aster\'s GM) plus J2 (WGS-84, NAIF geophysical.ker), RK4 at ' + fmt(set.dt || 10, 3) + ' s; no drag, no J3 or higher, no Sun or Moon, no venting.',
          'The departure point is where an impulsive burn at the hyperbola\'s perigee leaves along the asymptote (JPL 82-43 eq. 21-22 with theta_2 = nu_I = 0); module 38 replaces it with a finite burn.',
          'The asymptote is held fixed for the day (JPL 82-43: "may be considered constant for a given day of launch").',
        ] };
      var O = h.outputs;
      (st.h36.refusals || []).forEach(function (x) { if (KEEP36(x)) h.refusals.push(Object.assign({ from: x.from || '36-closed-loop' }, x)); });
      var a = R.asym;
      if (a) O.asymptote = qv({ c3_m2_s2: a.c3, vinf_m_s: a.vinf, rla_deg: a.rlaDeg, dla_deg: a.dlaDeg, s_hat_j2000: a.S, date_utc: a.dateUtc, mode: a.mode }, 'm^2/s^2, m/s, deg', spec.vinf_m_s ? 'derived' : 'assumed', a.source);
      if (R.aster) O.aster_screening_band = qv({ class: R.aster.cls, site: R.aster.site, i_min_deg: R.aster.iMinDeg, dla_ceiling_deg: R.aster.ceilingDeg }, 'deg', 'derived', 'Aster src/v2/core/lambert/feasibility.ts classifyFeasibility (band model, AMD-12-1), on idea 35\'s site');
      if (R.windows) O.daily_windows = qv(R.windows.map(function (w) { return { open_utc: w.open, close_utc: w.close, duration_s: w.duration, azimuth_open_deg: w.azOpenDeg, azimuth_close_deg: w.azCloseDeg, coast_open_s: w.coastOpen, coast_close_s: w.coastClose, bound_by: w.boundBy }; }), 's, deg', 'derived', KERNEL + ' dailyWindows() (edges by the numerical solve, J2 ' + (set.j2 === false ? 'off' : 'on') + ')');
      if (R.refusal) { h.refusals.push(R.refusal); }
      var s = R.launch;
      if (s && !R.refusal) {
        var T = s.T, f = R.flight, ins = s.ins, tIns = s.prof.t, insMs = s.ms + tIns * 1000, Ti = orient(insMs), dep = R.departure;
        var depMs = insMs + s.ev.t * 1000, Td = orient(depMs);
        O.launch = qv({ utc: T.utc, tdb_s_past_j2000: T.tdb, azimuth_deg: s.azDeg, inclination_deg: s.inclinationDeg, ascending_node_j2000_deg: elementsOf(toJ2000(T, ins.r), toJ2000(T, ins.v)).raanDeg, pad_right_ascension_deg: wrap2pi(T.gmst + set.lonDeg * DEG) / DEG, gmst_deg: T.gmst / DEG, j2_aim_offset_deg: s.psiDeg }, 's, deg', 'derived', KERNEL + ' solveAt() with idea 36 re-flown at this azimuth');
        O.insertion_state_j2000 = qv({ utc: Ti.utc, tdb_s_past_j2000: Ti.tdb, t_from_liftoff_s: tIns, r_m: toJ2000(T, ins.r), v_m_s: toJ2000(T, ins.v), mass_kg: f.ins.mass_kg }, 's, m, m/s, kg', 'derived', KERNEL + ' (idea 36\'s insertion re-flown at the azimuth, turned to the launch instant\'s right ascension, precessed to J2000)');
        var el = elementsOf(toJ2000(T, ins.r), toJ2000(T, ins.v));
        O.parking_orbit_j2000 = qv({ semi_major_axis_m: el.a, eccentricity: el.e, inclination_deg: el.inclinationDeg, ascending_node_deg: el.raanDeg, argument_of_latitude_deg: el.argLatDeg, epoch_utc: Ti.utc }, 'm, deg', 'derived', KERNEL + ' (osculating at insertion, J2000 equator)');
        var n0 = nodeOf(unit(cross(ins.r, ins.v))), nb = nodeOf(s.hb);
        O.coast = qv({ duration_s: s.ev.t, revolutions_skipped: s.ev.revs || 0, node_change_deg: wrapPi(nb - n0) / DEG, plane_residual_deg: s.betaDeg, launch_aim_offset_deg: s.psiDeg }, 's, deg', 'derived', KERNEL + ' coastToDeparture() (RK4, point mass + J2)');
        if (dep) {
          O.departure_point = qv({ utc: Td.utc, tdb_s_past_j2000: Td.tdb, r_m: toJ2000(T, dep.r), v_m_s: toJ2000(T, dep.v), altitude_m: dep.rn - RE, flight_path_angle_deg: dep.gammaDeg, mass_kg: f.ins.mass_kg }, 's, m, m/s, kg', 'derived', KERNEL + ' (end of the coast; mass as inserted, no venting)');
          O.impulsive_departure = qv({ v_perigee_m_s: dep.vp, delta_v_m_s: dep.dv, delta_v_j2000_m_s: toJ2000(T, dep.dvVec), nu_inf_deg: dep.nuInfDeg, hyperbola_eccentricity: dep.eH }, 'm/s, deg', 'derived', KERNEL + ' departureOf() (JPL 82-43 eq. 21, 24; impulsive, module 38 makes it finite)');
        }
        O.propellant_for_departure = qv(f.propellant, 'kg', 'derived', '36-closed-loop/closedloop.js flyClosed() re-flown at azimuth ' + fmt(s.azDeg, 7) + ' deg (what the guided stage has left)');
        var cap = R.capacity;
        if (cap) O.departure_delta_v_capacity = qv({ ideal_delta_v_m_s: cap.dv, exhaust_velocity_m_s: cap.ve, mass_at_insertion_kg: cap.m0, mass_after_burn_kg: cap.mf, impulsive_need_m_s: dep ? dep.dv : null, shortfall_m_s: dep ? Math.max(0, dep.dv - cap.dv) : null }, 'm/s, kg', 'derived', KERNEL + ' capacityOf(): ideal rocket equation on the guided stage (' + cap.stage + ', ' + cap.engine + ' vacuum exhaust velocity from idea 33\'s deck); an upper bound, no gravity loss');
        if (R.perf) O.performance_across_window = qv(R.perf.map(function (p) { return { utc: p.utc, window: p.window, azimuth_deg: p.azDeg, inclination_deg: p.inclinationDeg, propellant_kg: p.propellant, refused: p.refused }; }), 'deg, kg', 'derived', '36-closed-loop/closedloop.js re-flown at each azimuth');
      }
      (R.refusals || []).forEach(function (x) { h.refusals.push(x); });
      h.refusals.push(refusal('insufficient_data', 'Nutation and UT1 - UTC are not modelled: the pole and sidereal time are IAU 2006 mean values (measured against the full IAU 2006/2000A model: README), and UT1 is taken as UTC.', 'IERS Earth orientation parameters (UT1 - UTC, polar motion) for the date, and a nutation series.', { applies_to: 'earth_orientation' }));
      h.refusals.push(refusal('insufficient_data', 'No dogleg: the parking orbit\'s plane passes through the pad at liftoff. Outside the corridor a dogleg or a plane change at departure would cost performance this page does not compute.', 'A yaw-steering ascent model (idea 36 can fly one if its target plane is moved off the pad).', { applies_to: 'dogleg' }));
      return h;
    }
    function firstDiff(a, b, where) {
      if (typeof a === 'number' || typeof b === 'number') return num(a) && num(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) ? null : where;
      if (Array.isArray(b)) { if (!Array.isArray(a) || a.length !== b.length) return where; for (var i = 0; i < b.length; i++) { var d = firstDiff(a[i], b[i], where + '[' + i + ']'); if (d) return d; } return null; }
      if (b && typeof b === 'object') { if (!a || typeof a !== 'object' || Array.isArray(a)) return where; var ks = Object.keys(b).concat(Object.keys(a).filter(function (k) { return !(k in b); })); for (var j = 0; j < ks.length; j++) { var d2 = firstDiff(a[ks[j]], b[ks[j]], where + '.' + ks[j]); if (d2) return d2; } return null; }
      return a === b ? null : where;
    }
    /** Read this module's handoff back: idea 36's inside re-checked by idea 36, everything re-computed from the inputs
     * and compared (numbers to 1e-6 relative), the refusal codes compared. Returns importClosedLoop's set-up plus
     * {spec, set, result} or {refusal}. */
    function parseHandoff(h) {
      var I = h.inputs || {};
      if (!I.closed_loop_handoff || !I.asymptote || !I.settings) return { refusal: refusal('invalid_input', 'This 37-window handoff carries no idea 36 handoff, asymptote or settings.', 'A handoff exported by this page.') };
      var st = importClosedLoop(I.closed_loop_handoff);
      if (st.refusal) return st;
      var R = compute(st, I.asymptote, I.settings), again = JSON.parse(JSON.stringify(makeHandoff(st, I.asymptote, I.settings, R, { produced: h.produced })));
      var d = firstDiff(h.outputs || {}, again.outputs, 'outputs');
      if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      var codes = function (l) { return (l || []).map(function (x) { return (x.applies_to || '') + ':' + x.code; }).sort().join(', '); };
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals (' + (codes(h.refusals) || 'none') + ') are not the ones its inputs give (' + codes(again.refusals) + '): it was edited.', 'The unedited handoff this page exported.') };
      st.spec = I.asymptote; st.set = I.settings; st.result = R; st.from = '37-window';
      return st;
    }

    return { parseUtc: parseUtc, timeOf: timeOf, taiMinusUtc: taiMinusUtc, era: era, gmst: gmst, precession: precession, orient: orient, pckGreenwichRa: pckGreenwichRa,
      padFromReport: padFromReport, PAD39A: PAD39A, asymptote: asymptote, apophisSpec: apophisSpec, padUnit: padUnit, azimuthToward: azimuthToward, handbookAzimuth: handbookAzimuth,
      planeOf: planeOf, chooseAzimuth: chooseAzimuth, inCorridor: inCorridor, nodeOf: nodeOf, inclinationOf: inclinationOf, angleAhead: angleAhead, nuInf: nuInf, regressionPerRev: regressionPerRev,
      profileOf: profileOf, placeAscent: placeAscent, accel: accel, rk4: rk4, propagate: propagate, coastToDeparture: coastToDeparture, solveAt: solveAt, fastAt: fastAt,
      dailyWindows: dailyWindows, flyAt: flyAt, solveFlown: solveFlown, performance: performance, departureOf: departureOf, capacityOf: capacityOf, capacityRefusal: capacityRefusal, tliCheck: tliCheck, fitDirection: fitDirection, apollo17: apollo17, apollo17Preset: apollo17Preset, as512Coast: as512Coast,
      asterBand: asterBand, defaults: defaults, importClosedLoop: importClosedLoop, compute: compute, makeHandoff: makeHandoff, parseHandoff: parseHandoff, elementsOf: elementsOf,
      COAST_FLOWN_S: COAST_FLOWN_S, constants: { MU: MU, RE: RE, J2: J2, RJ2: RJ2 }, C: C, A: A, rotZ: rotZ, mxv: mxv, mtxv: mtxv };
  }

  return { create: create, DEG: DEG };
});
