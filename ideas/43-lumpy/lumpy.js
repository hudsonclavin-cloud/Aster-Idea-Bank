/* Lumpy: the asteroid's own gravity. Idea 43 of the Aster Idea Bank, module 13 of "The Long Way Round".
 *
 * Idea 42 parked the spacecraft at a stand-off and refused one thing it could not do (`gravity_field`): its asteroid was a
 * point mass. This module replaces the point with the body's real shape. It reads a published shape model (Apophis's
 * radar model, Bennu's laser-altimetry model; NAIF DSKs), fills it with uniform density, and computes the exact gravity
 * of that polyhedron anywhere, inside or out (Werner and Scheeres 1997). From the field it gives what a lander and an
 * orbiter need: the surface gravity and the slope a boulder feels (with the spin's centrifugal pull), the escape speed
 * from each spot, the spherical-harmonic coefficients, the points where gravity and spin balance (equilibria) and the
 * rotational Roche lobe, and which close orbits the lumps make crash or escape. It also says where uniform density is
 * known to be wrong: Bennu's measured field (Scheeres et al. 2020) and Apophis's measured tumbling (Pravec et al. 2014).
 *
 * A pure kernel: no DOM, no network. SI inside (m, s, kg, rad). Time: TDB seconds past J2000 (UTC = TDB - 69.184 s,
 * Aster's convention via idea 39). Frames: body-fixed (the DSK's own: APOPHIS_CK, IAU_BENNU) for the field and the
 * surface; ICRF/J2000 axes centred on the asteroid's centre of mass for orbits, as idea 42 hands the stand-off on.
 *
 * Methods and where they come from:
 *   Polyhedron gravity  R. A. Werner and D. J. Scheeres (1997), "Exterior gravitation of a polyhedron derived and compared
 *                       with harmonic and mascon gravitation representations of asteroid 4769 Castalia", Celest. Mech.
 *                       Dyn. Astron. 65, 313-344: U = G rho/2 [sum_e r_e.E_e.r_e L_e - sum_f r_f.F_f.r_f w_f], its
 *                       gradient and Hessian, and the Laplacian -G rho sum_f w_f (w_f the face's signed solid angle, so
 *                       sum_f w_f = 4 pi inside and 0 outside: the inside test). Known here from the paper's equations as
 *                       widely restated; checked against an independent implementation (oracle/oracle.py: the
 *                       polyhedral-gravity package of Schuhmacher et al. 2024, Tsoulis's line-integral formulation).
 *   Mass properties     signed tetrahedra from the origin (volume, centroid, second moments: the closed form for a
 *                       tetrahedron), principal axes by cyclic Jacobi rotations.
 *   Harmonics           exterior Stokes coefficients from volume integrals of the solid harmonics r^n P_nm e^(i m lon),
 *                       done exactly (degree <= 5) by the Grundmann-Moeller (1978) simplex rule on every tetrahedron;
 *                       fully normalised, no Condon-Shortley phase (the geodesy convention Scheeres et al. use).
 *   Spin                Bennu: the IAU-style pole and prime meridian of NAIF's bennu_v17.tpc. Apophis: torque-free
 *                       rigid-body rotation (Euler's equations) with Pravec et al. (2014)'s inertia ratios, restarted from
 *                       the nearest sample of NAIF's Apophis CK (snapshots/attitude.js).
 *   Equilibria          Newton on grad U + w^2 (x, y, 0) = 0 in the body frame; stability from the linearised rotating-
 *                       frame motion, det(l^2 I + 2 l [w x] - H) = 0, a cubic in l^2 (Scheeres et al. 1996's method).
 *   Integrator          idea 40's Dormand-Prince 5(4) (snapshots/coast.js, unmodified).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lumpy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180, DAY = 86400, HOUR = 3600;
  var KERNEL = '43-lumpy/lumpy.js';
  var J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

  function refusal(code, reason, help, extra) { var r = { code: code, reason: reason, what_would_help: help }; if (extra) for (var k in extra) r[k] = extra[k]; return r; }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; }
  function r9(x) { return num(x) ? +x.toPrecision(9) : x; }
  function vr9(v) { return v.map(r9); }
  /** 3x3 row-major helpers */
  function mv(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function mtv(M, v) { return [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]]; }
  function mm(A, B) { var C = new Array(9); for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; }
  /** SPICE frame rotation [angle]_axis (ROTATE): the matrix that takes vectors into a frame turned by `a` about `axis`. */
  function rot(a, axis) {
    var c = Math.cos(a), s = Math.sin(a);
    if (axis === 1) return [1, 0, 0, 0, c, s, 0, -s, c];
    if (axis === 2) return [c, 0, -s, 0, 1, 0, s, 0, c];
    return [c, s, 0, -s, c, 0, 0, 0, 1];
  }
  /** SPICE q2m: q = (cos(a/2), sin(a/2) axis) to the C-matrix taking J2000 vectors into the body frame. */
  function q2m(q) {
    var q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3];
    return [1 - 2 * (q2 * q2 + q3 * q3), 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2),
      2 * (q1 * q2 + q0 * q3), 1 - 2 * (q1 * q1 + q3 * q3), 2 * (q2 * q3 - q0 * q1),
      2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), 1 - 2 * (q1 * q1 + q2 * q2)];
  }
  /** Symmetric 3x3 eigen-decomposition by cyclic Jacobi rotations: values ascending, vectors as columns (row-major V). */
  function eigSym3(A) {
    var a = A.slice(), V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (var sweep = 0; sweep < 50; sweep++) {
      var off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
      if (off < 1e-30 * (a[0] * a[0] + a[4] * a[4] + a[8] * a[8])) break;
      for (var p = 0; p < 2; p++) for (var q = p + 1; q < 3; q++) {
        var apq = a[3 * p + q]; if (apq === 0) continue;
        var th = (a[3 * q + q] - a[3 * p + p]) / (2 * apq), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (var k = 0; k < 3; k++) { var akp = a[3 * k + p], akq = a[3 * k + q]; a[3 * k + p] = c * akp - s * akq; a[3 * k + q] = s * akp + c * akq; }
        for (k = 0; k < 3; k++) { var apk = a[3 * p + k], aqk = a[3 * q + k]; a[3 * p + k] = c * apk - s * aqk; a[3 * q + k] = s * apk + c * aqk; }
        for (k = 0; k < 3; k++) { var vkp = V[3 * k + p], vkq = V[3 * k + q]; V[3 * k + p] = c * vkp - s * vkq; V[3 * k + q] = s * vkp + c * vkq; }
      }
    }
    var idx = [0, 1, 2].sort(function (i, j) { return a[4 * i] - a[4 * j]; });
    return { values: idx.map(function (i) { return a[4 * i]; }), vectors: [V[idx[0]], V[idx[1]], V[idx[2]], V[3 + idx[0]], V[3 + idx[1]], V[3 + idx[2]], V[6 + idx[0]], V[6 + idx[1]], V[6 + idx[2]]] };
  }
  function bytesOfB64(s) {
    if (typeof atob === 'function') { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    var B = Buffer.from(s, 'base64'); return new Uint8Array(B.buffer, B.byteOffset, B.length);
  }
  function factorial(n) { var f = 1; for (var i = 2; i <= n; i++) f *= i; return f; }
  /** Weighted median of values v with weights w. */
  function wmedian(v, w) {
    var idx = []; for (var i = 0; i < v.length; i++) idx.push(i);
    idx.sort(function (a, b) { return v[a] - v[b]; });
    var tot = 0; for (i = 0; i < w.length; i++) tot += w[i];
    var acc = 0; for (i = 0; i < idx.length; i++) { acc += w[idx[i]]; if (acc >= tot / 2) return v[idx[i]]; }
    return v[idx[idx.length - 1]];
  }

  // ==================================================================================================================
  // The polyhedron
  /** Decode a shapes.js entry: int32 mm vertices, uint16 plates. */
  function decodeShape(S) {
    var vb = bytesOfB64(S.vertices_b64), fb = bytesOfB64(S.faces_b64), dv = new DataView(vb.buffer, vb.byteOffset, vb.length), df = new DataView(fb.buffer, fb.byteOffset, fb.length);
    var nv = vb.length / 12, nf = fb.length / 6, V = new Float64Array(3 * nv), F = new Uint32Array(3 * nf);
    for (var i = 0; i < 3 * nv; i++) V[i] = dv.getInt32(4 * i, true) / 1000;
    for (i = 0; i < 3 * nf; i++) F[i] = df.getUint16(2 * i, true);
    return { V: V, F: F, nv: nv, nf: nf };
  }
  /** Volume, centroid and second moments of a closed, outward-wound triangle mesh (unit density), from tetrahedra on the origin. */
  function massProps(V, F, nf) {
    var vol = 0, cx = 0, cy = 0, cz = 0, P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var f = 0; f < nf; f++) {
      var i = 3 * F[3 * f], j = 3 * F[3 * f + 1], k = 3 * F[3 * f + 2];
      var a = [V[i], V[i + 1], V[i + 2]], b = [V[j], V[j + 1], V[j + 2]], c = [V[k], V[k + 1], V[k + 2]];
      var d = dot(a, cross(b, c));
      vol += d / 6; cx += d * (a[0] + b[0] + c[0]) / 24; cy += d * (a[1] + b[1] + c[1]) / 24; cz += d * (a[2] + b[2] + c[2]) / 24;
      for (var p = 0; p < 3; p++) for (var q = p; q < 3; q++) {
        var s = 2 * (a[p] * a[q] + b[p] * b[q] + c[p] * c[q]) + a[p] * b[q] + a[q] * b[p] + a[p] * c[q] + a[q] * c[p] + b[p] * c[q] + b[q] * c[p];
        P[3 * p + q] += d * s / 120;
      }
    }
    P[3] = P[1]; P[6] = P[2]; P[7] = P[5];
    var c0 = [cx / vol, cy / vol, cz / vol];
    var S2 = P.map(function (x, n) { return x - vol * c0[Math.floor(n / 3)] * c0[n % 3]; });   // second moments about the centroid
    var tr = S2[0] + S2[4] + S2[8], I = S2.map(function (x, n) { return (n % 4 === 0 ? tr : 0) - x; });
    return { volume: vol, centroid: c0, secondMoments: S2, inertia: I };
  }
  /**
   * Prepare a shape for gravity: check it is closed and wound outward, move the origin to the uniform-density centre of
   * mass (opts.centre === 'dsk' keeps the DSK's), and build the face and edge dyads of Werner and Scheeres (1997).
   */
  function prepare(mesh, opts) {
    opts = opts || {};
    var nv = mesh.nv, nf = mesh.nf, F = mesh.F, V0 = mesh.V;
    var mp0 = massProps(V0, F, nf);
    if (!(mp0.volume > 0)) return { refusal: refusal('invalid_input', 'The shape encloses no volume or is wound inside out.', 'A closed, outward-wound shape model.') };
    var shift = opts.centre === 'dsk' ? [0, 0, 0] : mp0.centroid, V = new Float64Array(3 * nv);
    for (var i = 0; i < nv; i++) for (var k = 0; k < 3; k++) V[3 * i + k] = V0[3 * i + k] - shift[k];
    var FN = new Float64Array(3 * nf), FC = new Float64Array(3 * nf), FA = new Float64Array(nf), edges = {}, list = [], dir = {};
    for (var f = 0; f < nf; f++) {
      var a = F[3 * f], b = F[3 * f + 1], c = F[3 * f + 2];
      var A = [V[3 * a], V[3 * a + 1], V[3 * a + 2]], B = [V[3 * b], V[3 * b + 1], V[3 * b + 2]], C = [V[3 * c], V[3 * c + 1], V[3 * c + 2]];
      var nn = cross(sub(B, A), sub(C, A)), area = norm(nn) / 2, n = unit(nn);
      FN[3 * f] = n[0]; FN[3 * f + 1] = n[1]; FN[3 * f + 2] = n[2]; FA[f] = area;
      for (k = 0; k < 3; k++) FC[3 * f + k] = (A[k] + B[k] + C[k]) / 3;
      var pairs = [[a, b], [b, c], [c, a]];
      for (var e = 0; e < 3; e++) {
        var p = pairs[e][0], q = pairs[e][1], dk = p + ',' + q;
        if (dir[dk]) return { refusal: refusal('invalid_input', 'The shape is not a closed, consistently wound surface: edge ' + dk + ' appears twice in the same direction.', 'A closed, outward-wound shape model.') };
        dir[dk] = 1;
        var P0 = [V[3 * p], V[3 * p + 1], V[3 * p + 2]], P1 = [V[3 * q], V[3 * q + 1], V[3 * q + 2]], m = unit(cross(sub(P1, P0), n));   // edge normal, in the face's plane, outward
        var key = p < q ? p + ',' + q : q + ',' + p, E = edges[key];
        if (!E) { E = edges[key] = { a: Math.min(p, q), b: Math.max(p, q), M: [0, 0, 0, 0, 0, 0], n: 0 }; list.push(E); }
        E.M[0] += n[0] * m[0]; E.M[1] += 0.5 * (n[0] * m[1] + n[1] * m[0]); E.M[2] += 0.5 * (n[0] * m[2] + n[2] * m[0]);
        E.M[3] += n[1] * m[1]; E.M[4] += 0.5 * (n[1] * m[2] + n[2] * m[1]); E.M[5] += n[2] * m[2]; E.n++;
      }
    }
    for (var di in dir) { var pq = di.split(','); if (!dir[pq[1] + ',' + pq[0]]) return { refusal: refusal('invalid_input', 'The shape is open: edge ' + di + ' has no partner.', 'A closed, outward-wound shape model.') }; }
    var ne = list.length, EA = new Int32Array(ne), EB = new Int32Array(ne), EM = new Float64Array(6 * ne), EL = new Float64Array(ne);
    for (i = 0; i < ne; i++) {
      var Ei = list[i]; EA[i] = Ei.a; EB[i] = Ei.b; for (k = 0; k < 6; k++) EM[6 * i + k] = Ei.M[k];
      EL[i] = Math.hypot(V[3 * Ei.b] - V[3 * Ei.a], V[3 * Ei.b + 1] - V[3 * Ei.a + 1], V[3 * Ei.b + 2] - V[3 * Ei.a + 2]);
    }
    var mp = massProps(V, F, nf), rMax = 0, rIn = Infinity;
    for (i = 0; i < nv; i++) rMax = Math.max(rMax, Math.hypot(V[3 * i], V[3 * i + 1], V[3 * i + 2]));
    for (f = 0; f < nf; f++) rIn = Math.min(rIn, Math.abs(FN[3 * f] * FC[3 * f] + FN[3 * f + 1] * FC[3 * f + 1] + FN[3 * f + 2] * FC[3 * f + 2]));
    var area = 0; for (f = 0; f < nf; f++) area += FA[f];
    var eg = eigSym3(mp.inertia);
    return { V: V, F: F, nv: nv, nf: nf, ne: ne, EA: EA, EB: EB, EM: EM, EL: EL, FN: FN, FC: FC, FA: FA, shift: shift, area: area,
      volume: mp.volume, centroid: mp.centroid, inertia: mp.inertia, principal: eg, comOffsetDsk: mp0.centroid, rMax: rMax, rIn: rIn,
      R: new Float64Array(3 * nv), RN: new Float64Array(nv), euler: nv - ne + nf };
  }
  /**
   * The field of the polyhedron at x (m, body frame, the prepared origin) for G rho = 1: out[0] = U, out[1..3] = grad U,
   * out[4] = sum of solid angles (4 pi inside, 0 outside), and with H (a 6-array) the Hessian xx, xy, xz, yy, yz, zz.
   * Multiply U, grad U and H by G rho. U is positive (U = GM/r far away) and grad U points at the body.
   */
  function fieldRaw(P, x, y, z, out, H) {
    var V = P.V, F = P.F, FN = P.FN, nv = P.nv, nf = P.nf, ne = P.ne, EA = P.EA, EB = P.EB, EM = P.EM, EL = P.EL, R = P.R, RN = P.RN, i;
    for (i = 0; i < nv; i++) { var rx = V[3 * i] - x, ry = V[3 * i + 1] - y, rz = V[3 * i + 2] - z; R[3 * i] = rx; R[3 * i + 1] = ry; R[3 * i + 2] = rz; RN[i] = Math.sqrt(rx * rx + ry * ry + rz * rz); }
    var U = 0, gx = 0, gy = 0, gz = 0, ws = 0, h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0;
    for (var e = 0; e < ne; e++) {
      var a = EA[e], b = EB[e], s = RN[a] + RN[b], L = Math.log((s + EL[e]) / (s - EL[e]));
      var ax = R[3 * a], ay = R[3 * a + 1], az = R[3 * a + 2], m = 6 * e;
      var ex = EM[m] * ax + EM[m + 1] * ay + EM[m + 2] * az, ey = EM[m + 1] * ax + EM[m + 3] * ay + EM[m + 4] * az, ez = EM[m + 2] * ax + EM[m + 4] * ay + EM[m + 5] * az;
      U += (ax * ex + ay * ey + az * ez) * L; gx -= ex * L; gy -= ey * L; gz -= ez * L;
      if (H) { h0 += EM[m] * L; h1 += EM[m + 1] * L; h2 += EM[m + 2] * L; h3 += EM[m + 3] * L; h4 += EM[m + 4] * L; h5 += EM[m + 5] * L; }
    }
    for (var f = 0; f < nf; f++) {
      var i0 = 3 * F[3 * f], j0 = 3 * F[3 * f + 1], k0 = 3 * F[3 * f + 2];
      var px = R[i0], py = R[i0 + 1], pz = R[i0 + 2], qx = R[j0], qy = R[j0 + 1], qz = R[j0 + 2], tx = R[k0], ty = R[k0 + 1], tz = R[k0 + 2];
      var lp = RN[i0 / 3], lq = RN[j0 / 3], lt = RN[k0 / 3];
      var numr = px * (qy * tz - qz * ty) + py * (qz * tx - qx * tz) + pz * (qx * ty - qy * tx);
      var den = lp * lq * lt + lp * (qx * tx + qy * ty + qz * tz) + lq * (tx * px + ty * py + tz * pz) + lt * (px * qx + py * qy + pz * qz);
      var w = 2 * Math.atan2(numr, den); ws += w;
      var nx = FN[3 * f], ny = FN[3 * f + 1], nz = FN[3 * f + 2], d = nx * px + ny * py + nz * pz;
      U -= d * d * w; gx += nx * d * w; gy += ny * d * w; gz += nz * d * w;
      if (H) { h0 -= nx * nx * w; h1 -= nx * ny * w; h2 -= nx * nz * w; h3 -= ny * ny * w; h4 -= ny * nz * w; h5 -= nz * nz * w; }
    }
    out[0] = 0.5 * U; out[1] = gx; out[2] = gy; out[3] = gz; out[4] = ws;
    if (H) { H[0] = h0; H[1] = h1; H[2] = h2; H[3] = h3; H[4] = h4; H[5] = h5; }
    return out;
  }
  /** The field for a density (kg/m^3): {U m^2/s^2, g m/s^2, lap 1/s^2, inside, H 3x3 row-major if asked}. */
  function field(P, Grho, x, wantH) {
    var o = new Float64Array(5), H = wantH ? new Float64Array(6) : null;
    fieldRaw(P, x[0], x[1], x[2], o, H);
    var r = { U: Grho * o[0], g: [Grho * o[1], Grho * o[2], Grho * o[3]], lap: -Grho * o[4], solidAngle: o[4], inside: o[4] > 2 * PI };
    if (H) r.H = [H[0], H[1], H[2], H[1], H[3], H[4], H[2], H[4], H[5]].map(function (h) { return Grho * h; });
    return r;
  }
  /** Is x (body frame) inside the body? Quick by radius, exact by the solid-angle sum. */
  function inside(P, x) {
    var r = norm(x); if (r < P.rIn) return true; if (r > P.rMax) return false;
    var o = new Float64Array(5); fieldRaw(P, x[0], x[1], x[2], o, null); return o[4] > 2 * PI;
  }

  // ==================================================================================================================
  // Spherical harmonics, exact by the Grundmann-Moeller simplex rule (degree 2s+1 = 5)
  var GM_RULE = (function () {
    var s = 2, d = 2 * s + 1, n = 3, pts = [];
    for (var i = 0; i <= s; i++) {
      var w = Math.pow(-1, i) * Math.pow(2, -2 * s) * Math.pow(d + n - 2 * i, d) / (factorial(i) * factorial(d + n - i)), den = d + n - 2 * i, m = s - i;
      for (var b0 = 0; b0 <= m; b0++) for (var b1 = 0; b1 <= m - b0; b1++) for (var b2 = 0; b2 <= m - b0 - b1; b2++) {
        var b3 = m - b0 - b1 - b2;
        pts.push({ w: w, l: [(2 * b0 + 1) / den, (2 * b1 + 1) / den, (2 * b2 + 1) / den, (2 * b3 + 1) / den] });
      }
    }
    return pts;
  })();
  /** Integrate f(x) over a closed polyhedron (exact for polynomials up to degree 5): sum over signed tetrahedra on the origin. */
  function integrate(P, fn, nOut) {
    var acc = new Float64Array(nOut), V = P.V, F = P.F;
    for (var f = 0; f < P.nf; f++) {
      var i = 3 * F[3 * f], j = 3 * F[3 * f + 1], k = 3 * F[3 * f + 2];
      var a = [V[i], V[i + 1], V[i + 2]], b = [V[j], V[j + 1], V[j + 2]], c = [V[k], V[k + 1], V[k + 2]], det = dot(a, cross(b, c));
      for (var q = 0; q < GM_RULE.length; q++) {
        var L = GM_RULE[q].l, x = [L[1] * a[0] + L[2] * b[0] + L[3] * c[0], L[1] * a[1] + L[2] * b[1] + L[3] * c[1], L[1] * a[2] + L[2] * b[2] + L[3] * c[2]];
        var v = fn(x), w = GM_RULE[q].w * det;
        for (var o = 0; o < nOut; o++) acc[o] += w * v[o];
      }
    }
    return acc;
  }
  /** Solid harmonics Q_n^m = r^n P_nm(z/r) e^(i m lon) (no Condon-Shortley phase): returns {re[n][m], im[n][m]}. */
  function solid(x, nmax) {
    var re = [], im = [], r2 = dot(x, x);
    for (var n = 0; n <= nmax; n++) { re.push(new Array(n + 1).fill(0)); im.push(new Array(n + 1).fill(0)); }
    re[0][0] = 1;
    for (var m = 1; m <= nmax; m++) { var f = 2 * m - 1; re[m][m] = f * (x[0] * re[m - 1][m - 1] - x[1] * im[m - 1][m - 1]); im[m][m] = f * (x[0] * im[m - 1][m - 1] + x[1] * re[m - 1][m - 1]); }
    for (m = 0; m < nmax; m++) { re[m + 1][m] = (2 * m + 1) * x[2] * re[m][m]; im[m + 1][m] = (2 * m + 1) * x[2] * im[m][m]; }
    for (m = 0; m <= nmax; m++) for (n = m + 2; n <= nmax; n++) {
      re[n][m] = ((2 * n - 1) * x[2] * re[n - 1][m] - (n + m - 1) * r2 * re[n - 2][m]) / (n - m);
      im[n][m] = ((2 * n - 1) * x[2] * im[n - 1][m] - (n + m - 1) * r2 * im[n - 2][m]) / (n - m);
    }
    return { re: re, im: im };
  }
  function nmFactor(n, m) { return Math.sqrt((m === 0 ? 1 : 2) * (2 * n + 1) * factorial(n - m) / factorial(n + m)); }
  /**
   * Fully normalised Stokes coefficients of the uniform polyhedron to degree nmax (<= 5) about `origin` (body frame, m;
   * default the prepared origin = centre of mass), normalising radius R0. J_n = -C_n0.
   */
  function harmonics(P, nmax, R0, origin) {
    origin = origin || [0, 0, 0];
    var count = 0, map = [];
    for (var n = 0; n <= nmax; n++) for (var m = 0; m <= n; m++) { map.push([n, m]); count++; }
    var acc = integrate(P, function (x) {
      var Q = solid(sub(x, origin), nmax), v = new Array(2 * count);
      for (var k = 0; k < count; k++) { v[2 * k] = Q.re[map[k][0]][map[k][1]]; v[2 * k + 1] = Q.im[map[k][0]][map[k][1]]; }
      return v;
    }, 2 * count);
    var vol = acc[0], C = [], S = [];
    for (n = 0; n <= nmax; n++) { C.push(new Array(n + 1).fill(0)); S.push(new Array(n + 1).fill(0)); }
    for (var k = 0; k < count; k++) {
      n = map[k][0]; var mm_ = map[k][1], f = (mm_ === 0 ? 1 : 2) * factorial(n - mm_) / factorial(n + mm_) / (vol * Math.pow(R0, n)), N = nmFactor(n, mm_);
      C[n][mm_] = f * acc[2 * k] / N; S[n][mm_] = f * acc[2 * k + 1] / N;
    }
    var J = []; for (n = 0; n <= nmax; n++) J.push(-C[n][0]);
    return { R0: R0, nmax: nmax, origin: origin.slice(), C: C, S: S, J: J, volumeCheck: vol };
  }
  /** Potential of a harmonic expansion (GM m^3/s^2) at x (m, the expansion's frame). Valid outside the Brillouin sphere. */
  function harmonicU(sh, GM, x) {
    var y = sub(x, sh.origin), r2 = dot(y, y), r = Math.sqrt(r2), Q = solid(y, sh.nmax), U = 0;
    for (var n = 0; n <= sh.nmax; n++) {
      var t = 0; for (var m = 0; m <= n; m++) t += nmFactor(n, m) * (sh.C[n][m] * Q.re[n][m] + sh.S[n][m] * Q.im[n][m]);
      U += Math.pow(sh.R0, n) * t / Math.pow(r, 2 * n + 1);
    }
    return GM * U;
  }

  // ==================================================================================================================
  function create(deps) {
    var SH = deps.shapes, ATT = deps.attitude, GEO = deps.geophysics, ORB = deps.orbitB, LC = deps.coast, K = deps.constants;
    var G_NEWTON = deps.sources.nist.G_m3_kg_s2, MU_SUN = K.gmSun_m3_s2, TDB_UTC = K.tdbMinusUtc_s, AU = K.au_m;
    var SHAPE_OF = { '99942': 'apophis', '101955': 'bennu' };
    var cache = {};

    function utcOf(tdb) { return new Date(J2000_UNIX_MS + (tdb - TDB_UTC) * 1000).toISOString(); }
    function tdbOfUtc(iso) { return (Date.parse(iso) - J2000_UNIX_MS) / 1000 + TDB_UTC; }
    function tdbOfJd(jd) { return (jd - 2451545.0) * DAY; }

    /** The prepared polyhedron of a shape (cached). centre: 'mass' (default) or 'dsk'. */
    function shape(key, centre) {
      var ck = key + ':' + (centre || 'mass');
      if (cache[ck]) return cache[ck];
      if (!SH[key]) return { refusal: refusal('not_found', 'No shape model for ' + key + ' in this folder.', 'A closed shape model (a DSK or OBJ from PDS or NAIF).') };
      var P = prepare(decodeShape(SH[key]), { centre: centre });
      if (!P.refusal) { P.key = key; P.cacheKey = ck; P.centre = centre || 'mass'; P.meta = SH[key]; }
      return (cache[ck] = P);
    }

    // ---------------------------------------------------------------------------------------------------- spin
    /** Bennu's body frame at t: C (ICRF -> IAU_BENNU) and the spin vector in body axes (rad/s). */
    function bennuAttitude(t) {
      var B = ATT.bennu, d = t / DAY, W = (B.pm_deg[0] + B.pm_deg[1] * d + B.pm_deg[2] * d * d) * DEG, Wdot = (B.pm_deg[1] + 2 * B.pm_deg[2] * d) * DEG / DAY;
      var C = mm(rot(W, 3), mm(rot(PI / 2 - B.pole_dec_deg * DEG, 1), rot(PI / 2 + B.pole_ra_deg * DEG, 3)));
      return { C: C, w: [0, 0, Wdot], wdot: [0, 0, 2 * B.pm_deg[2] * DEG / (DAY * DAY)], kind: 'principal', period_h: 2 * PI / Wdot / HOUR };
    }
    var IR = ATT.apophis.inertiaRatios;
    function eulerDeriv(t, y) {
      var w0 = y[9], w1 = y[10], w2 = y[11];
      // dC/dt = -[w x] C (C takes ICRF into the body), I dw/dt = (I w) x w
      var d = new Array(12);
      for (var j = 0; j < 3; j++) {
        var c0 = y[j], c1 = y[3 + j], c2 = y[6 + j];
        d[j] = -(w1 * c2 - w2 * c1); d[3 + j] = -(w2 * c0 - w0 * c2); d[6 + j] = -(w0 * c1 - w1 * c0);
      }
      d[9] = (IR[1] - IR[2]) * w1 * w2 / IR[0]; d[10] = (IR[2] - IR[0]) * w2 * w0 / IR[1]; d[11] = (IR[0] - IR[1]) * w0 * w1 / IR[2];
      return d;
    }
    function eulerWdot(w) { return [(IR[1] - IR[2]) * w[1] * w[2] / IR[0], (IR[2] - IR[0]) * w[2] * w[0] / IR[1], (IR[0] - IR[1]) * w[0] * w[1] / IR[2]]; }
    var ATT_TOL = { rtol: 1e-12, atol: [1e-13, 1e-13, 1e-13, 1e-13, 1e-13, 1e-13, 1e-13, 1e-13, 1e-13, 1e-18, 1e-18, 1e-18], nErr: 12, maxSteps: 400000 };
    /** Apophis's body frame at t: the nearest CK sample flown to t by Euler's equations. */
    function apophisAttitude(t) {
      var A = ATT.apophis, kn = A.knots;
      if (!(t < A.egaTdb)) return { refusal: refusal('out_of_envelope', 'Apophis passes the Earth on ' + A.egaUtc.slice(0, 10) + ' and its spin after that is not known (NAIF carries only predictions); this epoch (' + utcOf(t).slice(0, 10) + ') is after it.', 'Apophis\'s spin measured after the encounter (OSIRIS-APEX).', { applies_to: 'spin' }) };
      if (t < kn[0][0] - 10 * DAY) return { refusal: refusal('out_of_envelope', 'Apophis\'s spin is sampled here from ' + utcOf(kn[0][0]).slice(0, 10) + '; this epoch (' + utcOf(t).slice(0, 10) + ') is before it.', 'More CK samples (snapshots/attitude.js, build_data.py).', { applies_to: 'spin' }) };
      var k = 0; for (var i = 1; i < kn.length; i++) if (Math.abs(kn[i][0] - t) < Math.abs(kn[k][0] - t)) k = i;
      var C0 = q2m(kn[k].slice(1, 5)), w0 = kn[k].slice(5, 8), y = C0.concat(w0);
      if (t !== kn[k][0]) { var res = LC.dopri(eulerDeriv, kn[k][0], y, t, ATT_TOL); if (res.failed) return { refusal: refusal('out_of_envelope', 'Spin integration failed: ' + res.failed, 'Another epoch.') }; y = res.y; }
      var C = y.slice(0, 9), w = y.slice(9, 12), wn = norm(w);
      var L = unit(mtv(C, [IR[0] * w[0], IR[1] * w[1], IR[2] * w[2]]));
      return { C: C, w: w, wdot: eulerWdot(w), kind: 'tumbling', period_h: 2 * PI / wn / HOUR, knot: k, knotTdb: kn[k][0], L_icrf: L };
    }
    function attitudeAt(key, t) { return key === 'bennu' ? bennuAttitude(t) : key === 'apophis' ? apophisAttitude(t) : { refusal: refusal('not_found', 'No spin model for ' + key + '.', 'A spin state (pole and period, or a tumbling solution).') }; }

    // ---------------------------------------------------------------------------------------------------- the body
    /**
     * The body model the rest works on. src: from importClosing() or a preset. S: settings.
     * GM by S.gm: 'handoff' (idea 42's), 'low' / 'high' (its range), 'measured' (Bennu: Scheeres et al. 2020's particle
     * field), 'density' (S.density_kg_m3 times the shape's volume). The density is GM / (G V).
     */
    function bodyModel(src, S) {
      var key = SHAPE_OF[src.designation];
      if (!key) return { refusal: refusal('not_found', 'No shape model for ' + src.name + ' in this folder: only Apophis (radar, Brozovic et al. 2018) and Bennu (OSIRIS-REx laser altimetry) are here.', 'A closed shape model for ' + src.name + ' (PDS Small Bodies Node or NAIF DSK); for Ryugu, JAXA\'s Hayabusa2 models; for Didymos, DART\'s.', { applies_to: 'shape' }) };
      var P = shape(key, S.centre); if (P.refusal) return { refusal: P.refusal };
      var GM, GMsrc, GMconf, rangeGM = src.body.GM_range_m3_s2 || null;
      if (S.gm === 'handoff') { GM = src.body.GM_m3_s2; GMsrc = src.body.GM_source; GMconf = src.body.GM_confidence; }
      else if (S.gm === 'low' || S.gm === 'high') {
        if (!rangeGM) return { refusal: refusal('insufficient_data', 'The handoff gives no GM range for ' + src.name + '.', 'A GM range, or GM as handed on.', { applies_to: 'settings' }) };
        GM = S.gm === 'low' ? rangeGM[0] : rangeGM[1]; GMsrc = src.body.GM_source + ' (' + S.gm + ' end of the range)'; GMconf = 'assumed';
      } else if (S.gm === 'measured' || S.gm === 'measured_sc') {
        if (key !== 'bennu') return { refusal: refusal('insufficient_data', src.name + '\'s mass has not been measured.', 'A radio-science mass from a spacecraft at the body (OSIRIS-APEX will measure Apophis\'s).', { applies_to: 'body_mass' }) };
        var Z = GEO.scheeres2020.zonals['GM (m3/s2)'];
        if (S.gm === 'measured') { GM = Z.particle; GMsrc = 'Scheeres et al. 2020, Table 1, particle field: ' + Z.particle + ' ± ' + Z.particle_1sigma + ' m^3/s^2'; }
        else { GM = Z.spacecraft; GMsrc = 'Scheeres et al. 2020, Table 1, spacecraft (radio tracking) field: ' + Z.spacecraft + ' ± ' + Z.spacecraft_1sigma + ' m^3/s^2'; }
        GMconf = 'measured';
      } else if (S.gm === 'density') { GM = G_NEWTON * S.density_kg_m3 * P.volume; GMsrc = 'G x ' + S.density_kg_m3 + ' kg/m^3 x the shape\'s volume'; GMconf = 'assumed'; }
      else return { refusal: refusal('invalid_input', 'Unknown GM mode ' + S.gm + '.', 'handoff, low, high, measured or density.', { applies_to: 'settings' }) };
      if (!(GM > 0)) return { refusal: refusal('insufficient_data', 'No GM for ' + src.name + '.', 'A GM or a density.', { applies_to: 'body_mass' }) };
      var rho = GM / (G_NEWTON * P.volume), att = attitudeAt(key, src.epoch);
      if (att.refusal) return { refusal: att.refusal };
      var d = src.sunDistance_m, hill = num(src.body.hill_radius_m) ? src.body.hill_radius_m * Math.pow(GM / src.body.GM_m3_s2, 1 / 3) : d * Math.pow(GM / (3 * MU_SUN), 1 / 3);
      return { key: key, P: P, name: src.name, designation: src.designation, GM: GM, GMsrc: GMsrc, GMconf: GMconf, rho: rho, Grho: G_NEWTON * rho, att: att, epoch: src.epoch,
        hill_m: hill, sunDistance_m: d, srp_m_s2: src.env ? src.env.srp_accel_m_s2 : null, Req: Math.cbrt(3 * P.volume / (4 * PI)) };
    }

    // ---------------------------------------------------------------------------------------------------- surface
    var rawCache = {};
    /** U and grad U at every plate's centroid for G rho = 1 (one polyhedron evaluation per plate; cached per shape). */
    function rawSurface(P) {
      if (rawCache[P.cacheKey]) return rawCache[P.cacheKey];
      var n = P.nf, U = new Float64Array(n), g = new Float64Array(3 * n), o = new Float64Array(5);
      for (var f = 0; f < n; f++) { fieldRaw(P, P.FC[3 * f], P.FC[3 * f + 1], P.FC[3 * f + 2], o, null); U[f] = o[0]; g[3 * f] = o[1]; g[3 * f + 1] = o[2]; g[3 * f + 2] = o[3]; }
      return (rawCache[P.cacheKey] = { U: U, g: g });
    }
    /**
     * Every plate's environment for a body model: gravity alone, the acceleration a grain at rest feels (gravity, the spin's
     * centrifugal pull and, for a tumbler, the Euler term), the slope against it, the geopotential, a height, and the
     * speeds that escape. Statistics are weighted by plate area.
     */
    function surface(B) {
      var P = B.P, raw = rawSurface(P), n = P.nf, w = B.att.w, wd = B.att.wdot || [0, 0, 0];
      var gmag = new Float64Array(n), amag = new Float64Array(n), slope = new Float64Array(n), phi = new Float64Array(n), vUp = new Float64Array(n), vMin = new Float64Array(n), vEsc = new Float64Array(n), U = new Float64Array(n), rad = new Float64Array(n);
      var area = P.FA;
      for (var f = 0; f < n; f++) {
        var r = [P.FC[3 * f], P.FC[3 * f + 1], P.FC[3 * f + 2]], nrm = [P.FN[3 * f], P.FN[3 * f + 1], P.FN[3 * f + 2]];
        var g = [B.Grho * raw.g[3 * f], B.Grho * raw.g[3 * f + 1], B.Grho * raw.g[3 * f + 2]], wr = cross(w, r);
        var a = sub(sub(g, cross(w, wr)), cross(wd, r)), an = norm(a);
        U[f] = B.Grho * raw.U[f]; gmag[f] = norm(g); amag[f] = an; rad[f] = norm(r);
        slope[f] = Math.acos(Math.max(-1, Math.min(1, -dot(nrm, a) / an))) / DEG;
        phi[f] = -U[f] - 0.5 * dot(wr, wr);
        var u = dot(nrm, wr), vv = dot(wr, wr), disc = u * u - vv + 2 * U[f];
        vEsc[f] = Math.sqrt(2 * U[f]); vUp[f] = disc >= 0 ? -u + Math.sqrt(disc) : 0; vMin[f] = Math.max(0, vEsc[f] - Math.sqrt(vv));
      }
      var tot = 0, phiBar = 0; for (f = 0; f < n; f++) { tot += area[f]; phiBar += area[f] * phi[f]; } phiBar /= tot;
      var height = new Float64Array(n); for (f = 0; f < n; f++) height[f] = (phi[f] - phiBar) / amag[f];
      function stats(v) {
        var s = 0, mn = Infinity, mx = -Infinity; for (var i = 0; i < n; i++) { s += area[i] * v[i]; mn = Math.min(mn, v[i]); mx = Math.max(mx, v[i]); }
        return { mean: s / tot, median: wmedian(v, area), min: mn, max: mx };
      }
      var hist = new Array(19).fill(0), steep30 = 0, steep40 = 0, over90 = 0;
      for (f = 0; f < n; f++) { hist[Math.min(18, Math.floor(slope[f] / 5))] += area[f] / tot; if (slope[f] > 30) steep30 += area[f]; if (slope[f] > 40) steep40 += area[f]; if (slope[f] > 90) over90 += area[f]; }
      return { gravity: gmag, accel: amag, slope: slope, phi: phi, height: height, U: U, vUp: vUp, vMin: vMin, vEsc: vEsc, radius: rad,
        stats: { gravity: stats(gmag), accel: stats(amag), slope: stats(slope), height: stats(height), vUp: stats(vUp), vMin: stats(vMin), vEsc: stats(vEsc), area_m2: tot,
          steeper30: steep30 / tot, steeper40: steep40 / tot, over90: over90 / tot, slopeHist5deg: hist } };
    }

    // ---------------------------------------------------------------------------------------------------- equilibria
    /** Roots of z^3 + a z^2 + b z + c (complex), by Durand-Kerner. Returns [[re, im], ...]. */
    function cubicRoots(a, b, c) {
      var sc = Math.max(1, Math.abs(a), Math.sqrt(Math.abs(b)), Math.cbrt(Math.abs(c)));
      var A = a / sc, Bc = b / (sc * sc), Cc = c / (sc * sc * sc), z = [[0.4, 0.9], [-0.65, 0.72], [0.9, -0.3]];
      function f(re, im) { // z^3 + A z^2 + B z + C
        var r2 = re * re - im * im, i2 = 2 * re * im, r3 = r2 * re - i2 * im, i3 = r2 * im + i2 * re;
        return [r3 + A * r2 + Bc * re + Cc, i3 + A * i2 + Bc * im];
      }
      for (var it = 0; it < 500; it++) {
        var moved = 0;
        for (var i = 0; i < 3; i++) {
          var num_ = f(z[i][0], z[i][1]), dr = 1, di = 0;
          for (var j = 0; j < 3; j++) if (j !== i) { var xr = z[i][0] - z[j][0], xi = z[i][1] - z[j][1], nr = dr * xr - di * xi, ni = dr * xi + di * xr; dr = nr; di = ni; }
          var dd = dr * dr + di * di, qr = (num_[0] * dr + num_[1] * di) / dd, qi = (num_[1] * dr - num_[0] * di) / dd;
          z[i] = [z[i][0] - qr, z[i][1] - qi]; moved = Math.max(moved, Math.hypot(qr, qi));
        }
        if (moved < 1e-15) break;
      }
      return z.map(function (p) { return [p[0] * sc, p[1] * sc]; });
    }
    /** Linear stability of a rotating-frame equilibrium: Heff = Hessian of U + w^2 (x^2 + y^2)/2, spin w along body z. */
    function eqStability(Heff, w) {
      function P6(l) { // det(l^2 I + 2 l [W x] - Heff), [W x] = [[0,-w,0],[w,0,0],[0,0,0]]
        var M = [l * l - Heff[0], -2 * l * w - Heff[1], -Heff[2], 2 * l * w - Heff[3], l * l - Heff[4], -Heff[5], -Heff[6], -Heff[7], l * l - Heff[8]];
        return M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
      }
      var s = w * w, y = [0, 1, 2, 3].map(function (k) { return P6(Math.sqrt(k * s)); });
      // cubic Q(L) = L^3 + c2 L^2 + c1 L + c0 through (k s, y_k): divided differences
      var c0 = y[0], d1 = (y[1] - y[0]) / s, d2 = (y[2] - 2 * y[1] + y[0]) / (2 * s * s), d3 = (y[3] - 3 * y[2] + 3 * y[1] - y[0]) / (6 * s * s * s);
      // Newton form: y0 + d1 L + d2 L (L - s) + d3 L (L - s)(L - 2s)
      var a3 = d3, a2 = d2 - 3 * s * d3, a1 = d1 - s * d2 + 2 * s * s * d3;
      var roots = cubicRoots(a2 / a3, a1 / a3, c0 / a3), real = 0, imag = 0, cplx = 0, growth = 0, periods = [];
      roots.forEach(function (L) {
        var tol = 1e-7 * (Math.abs(L[0]) + Math.abs(L[1]) + s);
        if (Math.abs(L[1]) <= tol) {
          if (L[0] > 0) { real++; growth = Math.max(growth, Math.sqrt(L[0])); }
          else { imag++; periods.push(2 * PI / Math.sqrt(-L[0])); }
        } else {
          cplx++;
          var m = Math.hypot(L[0], L[1]), sr = Math.sqrt((m + L[0]) / 2), si = Math.sqrt((m - L[0]) / 2);
          growth = Math.max(growth, sr); periods.push(2 * PI / si);
        }
      });
      cplx = cplx / 2;   // complex roots come in conjugate pairs: one quartet of eigenvalues per pair
      var type = real === 0 && cplx === 0 ? 'stable centre (3 oscillatory pairs)' : cplx > 0 ? (imag ? 'unstable centre (a complex quartet and an oscillatory pair)' : 'unstable (complex)') : real === 1 ? 'saddle (1 real pair, 2 oscillatory)' : real + ' real pairs';
      return { roots: roots, realPairs: real, oscillatoryPairs: imag, complexQuartets: cplx, stable: real === 0 && cplx === 0, efold_h: growth > 0 ? 1 / growth / HOUR : null, periods_h: periods.map(function (p) { return p / HOUR; }), type: type, kind: real > 0 ? 'saddle' : 'centre' };
    }
    /** Equilibria of a principal-axis rotator in its body frame (spin along z), by Newton from a ring of starts. */
    function equilibria(B) {
      if (B.att.kind !== 'principal') return { refusal: refusal('out_of_envelope', B.name + ' tumbles (Pravec et al. 2014): no frame turns with it at a constant rate, so its field never stands still in one and it has no equilibrium points or rotational Roche lobe.', 'Nothing: they do not exist for a tumbler. Hovering costs Delta-v everywhere (idea 42\'s station-keeping).', { applies_to: 'equilibria' }) };
      var P = B.P, w = norm(B.att.w), w2 = w * w, rs = Math.cbrt(B.GM / w2), found = [];
      function F(x) { var fl = field(P, B.Grho, x, true); return { f: [fl.g[0] + w2 * x[0], fl.g[1] + w2 * x[1], fl.g[2]], J: [fl.H[0] + w2, fl.H[1], fl.H[2], fl.H[3], fl.H[4] + w2, fl.H[5], fl.H[6], fl.H[7], fl.H[8]], fl: fl }; }
      for (var s = 0; s < 24; s++) {
        var th = 2 * PI * s / 24, x = [rs * Math.cos(th), rs * Math.sin(th), 0], ok = false;
        for (var it = 0; it < 40; it++) {
          var e = F(x), J = e.J, inv = LC.inv3(J); if (!inv) break;
          var dx = mv(inv, e.f); x = sub(x, dx);
          if (norm(x) > 4 * rs || norm(x) < 0.5 * P.rIn) break;
          if (norm(dx) < 1e-9) { ok = true; break; }
        }
        if (!ok || inside(P, x)) continue;
        if (found.some(function (q) { return norm(sub(q.x, x)) < 1; })) continue;
        var fe = F(x), Heff = fe.J, st = eqStability(Heff, w), energy = -fe.fl.U - 0.5 * w2 * (x[0] * x[0] + x[1] * x[1]);
        found.push({ x: x, r_m: norm(x), lon_deg: Math.atan2(x[1], x[0]) / DEG, z_m: x[2], residual_m_s2: norm(fe.f), energy_J_kg: energy, stability: st });
      }
      found.sort(function (a, b) { return a.lon_deg - b.lon_deg; });
      if (!found.length) return { refusal: refusal('out_of_envelope', 'No equilibrium found near the synchronous radius ' + rs.toFixed(0) + ' m.', 'Another starting ring.', { applies_to: 'equilibria' }) };
      var eMin = Math.min.apply(null, found.map(function (q) { return q.energy_J_kg; }));
      return { points: found, synchronous_m: rs, rocheEnergy_J_kg: eMin };
    }
    /** Share of the surface (by area) energetically trapped: geopotential below the lowest equilibrium's (the rotational Roche lobe). */
    function rocheFraction(B, surf, eq) {
      if (!eq || eq.refusal) return null;
      var a = 0, tot = 0; for (var f = 0; f < B.P.nf; f++) { tot += B.P.FA[f]; if (surf.phi[f] < eq.rocheEnergy_J_kg) a += B.P.FA[f]; }
      return a / tot;
    }

    // ---------------------------------------------------------------------------------------------------- orbits
    var ORBIT_TOL = { rtol: 1e-10, atol: [1e-4, 1e-4, 1e-4, 1e-8, 1e-8, 1e-8], nErr: 6, maxSteps: 2e6 };
    /**
     * Fly a spacecraft (ICRF axes about the centre of mass) under the body's gravity for `seconds`. model: 'poly' (the
     * shape, turning with the body) or 'pm' (GM only). extra(t, x) adds an acceleration (the tests add idea 42's sunlight
     * and solar tide). For a tumbler the spin is integrated alongside (Euler's equations from the epoch's attitude).
     * opts.stop(t, x, v) ends early; opts.samples evenly spaced outputs.
     */
    function fly(B, model, t0, x0, v0, seconds, opts) {
      var F = flight(B, model, t0, x0, v0, seconds, opts); F.advance(Infinity);
      if (F.failed) return { failed: F.failed, out: F.out };
      return F.stopped ? { stopped: true, out: F.out, t: F.t } : { out: F.out, t: F.t };
    }
    /** The same flight, resumable: advance(k) flies k more output samples (the page flies a scan in slices). */
    function flight(B, model, t0, x0, v0, seconds, opts) {
      opts = opts || {};
      var P = B.P, tumbler = B.att.kind === 'tumbling', o = new Float64Array(5), Grho = B.Grho;
      var y = x0.concat(v0); if (tumbler) y = y.concat(B.att.C, B.att.w);
      function deriv(t, s) {
        var x = [s[0], s[1], s[2]], a;
        if (model === 'pm') { var r = norm(x); a = scale(x, -B.GM / (r * r * r)); }
        else {
          var C = tumbler ? s.slice(6, 15) : bennuAttitude(t).C, xb = mv(C, x);
          fieldRaw(P, xb[0], xb[1], xb[2], o, null); a = mtv(C, [Grho * o[1], Grho * o[2], Grho * o[3]]);
        }
        if (opts.extra) a = add(a, opts.extra(t, x));
        var d = [s[3], s[4], s[5], a[0], a[1], a[2]];
        if (tumbler) { var e = eulerDeriv(t, s.slice(6, 18)); for (var k = 0; k < 12; k++) d.push(e[k]); }
        return d;
      }
      var tol = tumbler ? { rtol: ORBIT_TOL.rtol, atol: ORBIT_TOL.atol.concat(ATT_TOL.atol), nErr: 18, maxSteps: ORBIT_TOL.maxSteps } : ORBIT_TOL;
      if (opts.rtol) tol = Object.assign({}, tol, { rtol: opts.rtol });
      var n = opts.samples || 1, F = { out: [{ t: t0, x: x0.slice(), v: v0.slice() }], t: t0, k: 1, n: n, done: false, failed: null, stopped: false };
      F.advance = function (count) {
        var c = 0;
        while (!F.done && c < count) {
          var tk = t0 + seconds * F.k / n, res = LC.dopri(deriv, F.t, y, tk, tol);
          if (res.failed) { F.failed = res.failed; F.done = true; break; }
          y = res.y; F.t = tk; F.out.push({ t: F.t, x: y.slice(0, 3), v: y.slice(3, 6), C: tumbler ? y.slice(6, 15) : null });
          F.k++; c++;
          if (opts.stop && opts.stop(F.t, y.slice(0, 3), y.slice(3, 6), tumbler ? y.slice(6, 15) : null)) { F.stopped = true; F.done = true; break; }
          if (F.k > n) F.done = true;
        }
        return F;
      };
      return F;
    }
    function bodyC(B, t, Cflown) { return Cflown || (B.att.kind === 'tumbling' ? null : bennuAttitude(t).C); }
    /** Pole (spin axis or angular momentum) in ICRF at the epoch. */
    function poleIcrf(B) { return B.att.kind === 'tumbling' ? B.att.L_icrf : unit(mtv(B.att.C, [0, 0, 1])); }
    /** One circular start at radius r and inclination i (deg) to the spin, flown `days` (gravity alone): impact, escape or survive. */
    function orbitOne(B, r, incDeg, days, opts) { var st = orbitStart(B, r, incDeg, days, opts); st.flight.advance(Infinity); return orbitFinish(st); }
    /** The same, resumable: orbitStart() sets it up, st.flight.advance(k) flies k of its ~24-per-orbit samples, orbitFinish() reads the outcome. */
    function orbitStart(B, r, incDeg, days, opts) {
      opts = opts || {};
      var p = poleIcrf(B), z = [0, 0, 1], node = unit(Math.abs(dot(p, z)) > 0.99 ? cross(p, [1, 0, 0]) : cross(p, z)), tdir = cross(p, node);
      var vdir = add(scale(tdir, Math.cos(incDeg * DEG)), scale(p, Math.sin(incDeg * DEG))), x0 = scale(node, r), v0 = scale(vdir, Math.sqrt(B.GM / r));
      var T = 2 * PI * Math.sqrt(r * r * r / B.GM), n = Math.max(8, Math.ceil(days * DAY / (T / 24)));
      var st = { r: r, inc: incDeg, days: days, T: T, rmin: r, rmax: r, outcome: 'survive', tEnd: days * DAY, track: [] };
      var escR = Math.min(B.hill_m, Math.max(4 * B.P.rMax, 3 * r));
      st.flight = flight(B, 'poly', B.epoch, x0, v0, days * DAY, { samples: n, rtol: opts.rtol || 1e-9, stop: function (t, x, v, Cf) {
        var rr = norm(x); st.rmin = Math.min(st.rmin, rr); st.rmax = Math.max(st.rmax, rr);
        var C = bodyC(B, t, Cf); if (st.track.length < 400) st.track.push(mv(C, x));
        if (rr < B.P.rMax && inside(B.P, mv(C, x))) { st.outcome = 'impact'; st.tEnd = t - B.epoch; return true; }
        if (rr > escR && 0.5 * dot(v, v) - B.GM / rr > 0) { st.outcome = 'escape'; st.tEnd = t - B.epoch; return true; }
        return false;
      } });
      return st;
    }
    function orbitFinish(st) {
      if (st.flight.failed) return { r_m: st.r, inc_deg: st.inc, outcome: 'failed', reason: st.flight.failed };
      return { r_m: st.r, inc_deg: st.inc, outcome: st.outcome, t_days: st.tEnd / DAY, rmin_m: st.rmin, rmax_m: st.rmax, track: st.track, period_h: st.T / HOUR };
    }
    /** The scan's grid and its refusals: radii from just outside the Brillouin sphere to four times it (or the Hill radius). */
    function scanPlan(B, S) {
      var rIn = 1.05 * B.P.rMax, rOut = Math.min(4 * B.P.rMax, 0.5 * B.hill_m), radii = [], refused = [], plan = [];
      for (var i = 0; i < S.scanRadii; i++) radii.push(rIn * Math.pow(rOut / rIn, i / (S.scanRadii - 1)));
      radii.forEach(function (r) {
        var grav = B.GM / (r * r);
        if (num(B.srp_m_s2) && B.srp_m_s2 > 0.05 * grav) { refused.push(r); return; }
        S.scanIncl.forEach(function (inc) { plan.push({ r: r, inc: inc }); });
      });
      return { plan: plan, radii: radii, refusedRadii: refused };
    }
    function orbitScan(B, S, onEach) {
      var sp = scanPlan(B, S), rows = [];
      sp.plan.forEach(function (q, i) { var o = orbitOne(B, q.r, q.inc, S.scanDays); rows.push(o); if (onEach) onEach(i, sp.plan.length, o); });
      return { rows: rows, radii: sp.radii, refusedRadii: sp.refusedRadii, days: S.scanDays, incl: S.scanIncl.slice() };
    }

    // ---------------------------------------------------------------------------------------------------- the site
    /** The plate the ray from the centre along d (body frame) leaves the body through (outermost hit). */
    function rayFace(P, d) {
      d = unit(d); var best = -1, bt = -Infinity, V = P.V, F = P.F;
      for (var f = 0; f < P.nf; f++) {
        var i = 3 * F[3 * f], j = 3 * F[3 * f + 1], k = 3 * F[3 * f + 2];
        var a = [V[i], V[i + 1], V[i + 2]], e1 = sub([V[j], V[j + 1], V[j + 2]], a), e2 = sub([V[k], V[k + 1], V[k + 2]], a);
        var pv = cross(d, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
        var tv = scale(a, -1), u = dot(tv, pv) / det; if (u < -1e-12 || u > 1 + 1e-12) continue;
        var qv = cross(tv, e1), v = dot(d, qv) / det; if (v < -1e-12 || u + v > 1 + 1e-12) continue;
        var t = dot(e2, qv) / det; if (t > bt) { bt = t; best = f; }
      }
      return best;
    }
    function site(B, surf, f) {
      var P = B.P, r = [P.FC[3 * f], P.FC[3 * f + 1], P.FC[3 * f + 2]], rd = add(r, P.shift), nrm = [P.FN[3 * f], P.FN[3 * f + 1], P.FN[3 * f + 2]];
      var raw = rawSurface(P), g = [B.Grho * raw.g[3 * f], B.Grho * raw.g[3 * f + 1], B.Grho * raw.g[3 * f + 2]];
      return { face: f, body_fixed_m: rd, centre_of_mass_m: r, lat_deg: Math.asin(rd[2] / norm(rd)) / DEG, lon_deg: Math.atan2(rd[1], rd[0]) / DEG, radius_m: norm(rd), normal: nrm,
        gravity_m_s2: g, gravity_mag_m_s2: surf.gravity[f], accel_mag_m_s2: surf.accel[f], slope_deg: surf.slope[f], height_m: surf.height[f], U_m2_s2: surf.U[f],
        escape_up_m_s: surf.vUp[f], escape_min_m_s: surf.vMin[f], escape_inertial_m_s: surf.vEsc[f], area_m2: P.FA[f] };
    }

    // ---------------------------------------------------------------------------------------------------- reality: Orbital B
    var OB_ROWS = 21;   // 2019-06-19 00:00 to 06-20 16:00 TDB: the reconstruction has an impulse in the 40-42 h leg (0.18 mm/s), so the test stops before it
    /** Idea 42's sunlight and solar tide, tabulated along the reconstruction (snapshots/orbit-b-sunlight.js), interpolated in time. */
    function sunlightTable(t) {
      var T = deps.orbitBSunlight; if (!T) return [0, 0, 0];
      var k = Math.max(0, Math.min(T.t.length - 2, Math.floor((t - T.t[0]) / (T.t[1] - T.t[0])))), f = (t - T.t[k]) / (T.t[k + 1] - T.t[k]);
      return [0, 1, 2].map(function (j) { return T.a[k][j] + f * (T.a[k + 1][j] - T.a[k][j]); });
    }
    /**
     * OSIRIS-REx in Orbital B (JPL Horizons' reconstruction), flown under a point mass or the polyhedron:
     * (1) leg by leg, each 2-h leg from the reconstructed state, the miss in velocity and position at its end (the field's
     * error at the acceleration level); (2) the whole 40-h arc from one state. opts.sunlight: 'table' (idea 42's model,
     * tabulated), 'none', or a function (t0) -> extra(t, x) (the tests pass idea 42's kernel itself).
     */
    function orbitB(B, model, opts) {
      opts = opts || {};
      var mk = opts.sunlight === 'none' ? null : typeof opts.sunlight === 'function' ? opts.sunlight : function () { return function (t) { return sunlightTable(t); }; };
      var t0 = tdbOfJd(ORB.jd[0]), extra = mk ? mk(t0) : null, dv = [], dr = [];
      for (var i = 0; i < OB_ROWS - 1; i++) {
        var ti = tdbOfJd(ORB.jd[i]), f = fly(B, model, ti, ORB.rel[i].slice(0, 3), ORB.rel[i].slice(3, 6), tdbOfJd(ORB.jd[i + 1]) - ti, { extra: extra });
        if (f.failed) return { failed: f.failed };
        var o = f.out[f.out.length - 1]; dr.push(norm(sub(o.x, ORB.rel[i + 1].slice(0, 3)))); dv.push(norm(sub(o.v, ORB.rel[i + 1].slice(3, 6))));
      }
      var arc = fly(B, model, t0, ORB.rel[0].slice(0, 3), ORB.rel[0].slice(3, 6), tdbOfJd(ORB.jd[OB_ROWS - 1]) - t0, { samples: OB_ROWS - 1, extra: extra });
      if (arc.failed) return { failed: arc.failed };
      var err = arc.out.map(function (q, i) { return norm(sub(q.x, ORB.rel[i].slice(0, 3))); });
      var med = function (a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
      return { model: model, GM: B.GM, sunlight: mk ? (typeof opts.sunlight === 'function' ? 'function' : 'table') : 'none', legs: dv.length,
        legDv_median_m_s: med(dv), legDv_max_m_s: Math.max.apply(null, dv), legDr_median_m: med(dr), arcError_m: err, arcEnd_m: err[err.length - 1], arcMax_m: Math.max.apply(null, err),
        hours: ORB.jd.slice(0, OB_ROWS).map(function (j) { return (j - ORB.jd[0]) * 24; }), out: arc.out };
    }

    // ---------------------------------------------------------------------------------------------------- inputs
    /** Idea 42's handoff, checked for consistency (not re-flown). */
    function importClosing(h42) {
      var h = h42;
      if (typeof h42 === 'string') { try { h = JSON.parse(h42); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 42 or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 42 (Closing In) or from this page.') };
      if (h.from !== '42-closing-in') return { refusal: refusal('invalid_input', 'That handoff is from ' + h.from + '; this module takes idea 42\'s.', h.from === '41-signal' ? 'Open it in idea 42 (Closing In) first and bring its export.' : 'A handoff from idea 42 (Closing In) or from this page.') };
      var O = h.outputs || {}, ss = O.standoff_state && O.standoff_state.value, bd = O.body && O.body.value, env = O.environment && O.environment.value;
      if (!ss || !bd || !env) return { refusal: refusal('invalid_input', 'This 42 handoff lacks its stand-off, body or environment.', 'The unedited handoff idea 42 exported.') };
      var vec = function (v) { return Array.isArray(v) && v.length === 3 && v.every(num); };
      if (!num(ss.tdb_s_past_j2000) || !vec(ss.r_m) || !vec(ss.v_m_s) || !ss.asteroid_heliocentric || !vec(ss.asteroid_heliocentric.r_m) || !num(bd.GM_m3_s2) || !num(bd.radius_m) || !num(bd.sun_distance_m))
        return { refusal: refusal('invalid_input', 'The stand-off state or the body is incomplete.', 'The unedited handoff idea 42 exported.') };
      var p = [], rel = function (a, b) { return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300); };
      var R = bd.radius_m, GM = bd.GM_m3_s2;
      if (rel(bd.surface_gravity_m_s2, GM / (R * R)) > 1e-6) p.push('surface gravity is not GM/R^2');
      if (rel(bd.escape_speed_m_s, Math.sqrt(2 * GM / R)) > 1e-6) p.push('escape speed is not sqrt(2GM/R)');
      if (rel(bd.bulk_density_kg_m3, GM / (G_NEWTON * 4 / 3 * PI * R * R * R)) > 1e-6) p.push('the density is not GM/(G 4/3 pi R^3)');
      if (rel(bd.hill_radius_m, bd.sun_distance_m * Math.cbrt(GM / (3 * MU_SUN))) > 1e-6) p.push('the Hill radius is not d (GM/3GM_sun)^(1/3)');
      if (rel(norm(ss.asteroid_heliocentric.r_m), bd.sun_distance_m) > 1e-6) p.push('the Sun distance is not the asteroid\'s heliocentric range');
      if (rel(norm(ss.r_m), ss.sam.range_m) > 1e-6) p.push('the stand-off range does not match its vector');
      if (rel(env.gravity_at_standoff_m_s2, GM / dot(ss.r_m, ss.r_m)) > 1e-6) p.push('gravity at the stand-off is not GM/r^2');
      if (Math.abs(tdbOfUtc(ss.utc) - ss.tdb_s_past_j2000) > 0.002) p.push('UTC and TDB disagree');
      if (Array.isArray(bd.GM_range_m3_s2) && !(bd.GM_range_m3_s2[0] <= GM && GM <= bd.GM_range_m3_s2[1])) p.push('GM lies outside its own range');
      if (!(h.refusals || []).some(function (r) { return r.applies_to === 'gravity_field' && !r.from; })) p.push('idea 42\'s own gravity_field refusal is missing');
      if (p.length) return { refusal: refusal('invalid_input', 'The handoff is not self-consistent: ' + p.join('; ') + '. It was edited, or is not idea 42\'s.', 'The unedited handoff idea 42 exported.') };
      return { from: '42-closing-in', h42: h, designation: bd.designation, name: bd.name, epoch: ss.tdb_s_past_j2000, standoff: { r: ss.r_m.slice(), v: ss.v_m_s.slice() },
        sunDistance_m: bd.sun_distance_m, body: bd, env: env, carried: (h.refusals || []).map(function (r) { var c = clone(r); if (!c.from) c.from = '42-closing-in'; return c; }) };
    }
    /** The stand-alone Bennu case: OSIRIS-REx's Orbital B, 2019-06-19 00:00 TDB, Bennu's measured GM. */
    function bennuCase() {
      var t0 = tdbOfJd(ORB.jd[0]), d = norm(ORB.bennuHelio[0].slice(0, 3)), GM = GEO.scheeres2020.zonals['GM (m3/s2)'].particle;
      return { from: 'bennu2019', h42: null, designation: '101955', name: '101955 Bennu', epoch: t0, standoff: { r: ORB.rel[0].slice(0, 3), v: ORB.rel[0].slice(3, 6) }, sunDistance_m: d,
        body: { designation: '101955', name: '101955 Bennu', GM_m3_s2: GM, GM_range_m3_s2: null, GM_confidence: 'measured', GM_source: 'Scheeres et al. 2020, Table 1, particle field' }, env: null, carried: [] };
    }

    function defaults() { return { gm: 'handoff', density_kg_m3: 2000, centre: 'mass', scan: false, scanDays: 3, scanRadii: 8, scanIncl: [0, 90, 180], site: null, orbitB: true }; }
    function validSettings(S) {
      var e = [];
      if (['handoff', 'low', 'high', 'measured', 'measured_sc', 'density'].indexOf(S.gm) < 0) e.push('gm must be handoff, low, high, measured, measured_sc or density');
      if (S.gm === 'density' && !(num(S.density_kg_m3) && S.density_kg_m3 >= 500 && S.density_kg_m3 <= 8000)) e.push('density must be 500 to 8000 kg/m^3');
      if (!(num(S.scanDays) && S.scanDays >= 0.25 && S.scanDays <= 30)) e.push('scanDays must be 0.25 to 30');
      if (!(Number.isInteger(S.scanRadii) && S.scanRadii >= 2 && S.scanRadii <= 16)) e.push('scanRadii must be 2 to 16');
      if (!Array.isArray(S.scanIncl) || !S.scanIncl.length || !S.scanIncl.every(function (i) { return num(i) && i >= 0 && i <= 180; })) e.push('scanIncl must be angles 0 to 180 deg');
      if (S.site !== null && S.site !== undefined && !(Number.isInteger(S.site) && S.site >= 0)) e.push('site must be a plate index or null');
      if (typeof S.orbitB !== 'boolean') e.push('orbitB must be true or false');
      if (S.centre !== 'mass' && S.centre !== 'dsk') e.push('centre must be mass or dsk');
      return e;
    }

    // ---------------------------------------------------------------------------------------------------- run
    function run(src, settings) {
      var S = Object.assign(defaults(), settings || {}), errs = validSettings(S);
      if (errs.length) return { refusal: refusal('invalid_input', 'Settings: ' + errs.join('; ') + '.', 'Values inside the stated ranges.', { applies_to: 'settings' }), S: S };
      if (src.from === 'bennu2019' && (S.gm === 'handoff')) S.gm = 'measured';
      var B = bodyModel(src, S); if (B.refusal) return { refusal: B.refusal, S: S };
      var P = B.P, surf = surface(B), eq = equilibria(B), roche = rocheFraction(B, surf, eq);
      if (S.site !== null && S.site >= P.nf) return { refusal: refusal('invalid_input', 'Plate ' + S.site + ' does not exist (the shape has ' + P.nf + ').', 'A plate index below ' + P.nf + '.', { applies_to: 'settings' }), S: S };
      var standDir = mv(B.att.C, src.standoff.r), subFace = rayFace(P, sub(standDir, [0, 0, 0])), siteFace = S.site !== null ? S.site : subFace;
      var st = site(B, surf, siteFace);
      var shC = harmonics(P, 4, P.rMax, [0, 0, 0]);
      var R0ref = B.key === 'bennu' ? GEO.scheeres2020.normalizingRadius_m : P.rMax, shD = harmonics(P, 4, R0ref, scale(P.shift, -1));
      var ob = B.key === 'bennu' && S.orbitB ? { pm: orbitB(B, 'pm'), poly: orbitB(B, 'poly') } : null;
      var scan = S.scan ? orbitScan(B, S) : null;
      // refusals: carried from idea 42, then this module's own
      var own = [];
      own.push(refusal('insufficient_data', 'Uniform density: the field is the shape filled evenly. At Bennu the measured field (Scheeres et al. 2020, Table 1) has J2 ' + pctOf(GEO.scheeres2020.zonals.J2.ratio) + ' and J3 ' + pctOf(GEO.scheeres2020.zonals.J3.ratio) + ' larger than its constant-density shape gives, surface gravity differs by up to ±3% and slopes by ±1°, and the constant-density stable equilibrium is unstable in the measured field.', 'A measured gravity field: radio tracking from orbit (OSIRIS-REx at Bennu; OSIRIS-APEX at Apophis from 2029).', { applies_to: 'density' }));
      if (B.key === 'apophis') {
        var ir = [P.principal.values[0] / P.principal.values[2], P.principal.values[1] / P.principal.values[2]];
        own.push(refusal('insufficient_data', 'Apophis\'s tumbling needs inertia ratios ' + IR[0] + ' and ' + IR[1] + ' (Pravec et al. 2014); the radar shape filled evenly gives ' + ir[0].toFixed(3) + ' and ' + ir[1].toFixed(3) + '. Uniform density cannot be the whole truth (or the shape is off), so the field beyond GM carries that doubt.', 'A shape from OSIRIS-APEX imaging and a measured field.', { applies_to: 'inertia' }));
      }
      if (eq.refusal) own.push(eq.refusal);
      own.push(refusal('insufficient_data', 'The shape\'s plates are ' + P.meta.resolution_m + ' m across: slopes and gravity under a lander\'s footprint (metres) are not resolved, and slopes here are smoother than at that scale (Bennu\'s 3 m model averages 17°).', B.key === 'apophis' ? 'OSIRIS-APEX\'s imaging shape model (2029).' : 'OSIRIS-REx\'s higher-resolution Bennu models (to 5 cm at the sample sites, NAIF DSKs).', { applies_to: 'resolution' }));
      if (scan) own = own.concat(scanRefusals(B, scan));
      var assumptions = [
        'Frames: body-fixed ' + P.meta.frame.split(':')[0] + ' for the field and the surface, ' + (P.centre === 'dsk' ? 'origin the DSK\'s (the uniform-density centre of mass is ' + norm(P.comOffsetDsk).toFixed(2) + ' m from it)' : 'origin moved ' + norm(P.shift).toFixed(2) + ' m to the uniform-density centre of mass') + '; orbits in ICRF axes about the centre of mass. Time TDB s past J2000, UTC = TDB - ' + TDB_UTC + ' s.',
        'Gravity: the constant-density polyhedron of ' + P.meta.model + ' (' + P.nf + ' plates), G = ' + G_NEWTON + ' (NIST), density ' + B.rho.toFixed(1) + ' kg/m^3 = GM / (G V).',
        'Spin: ' + (B.key === 'bennu' ? 'bennu_v17.tpc pole and prime meridian (principal-axis rotation).' : 'torque-free rotation with Pravec et al. (2014)\'s inertia ratios from NAIF\'s CK sample nearest the epoch.'),
        'Surface: each plate\'s centroid; acceleration = gravity minus the spin\'s centrifugal and Euler terms; slope = angle between the inward normal and that acceleration; height = (geopotential - its area mean) / local acceleration; escape speeds from energy in a non-rotating field (sqrt(2U)), straight up and along the spin.',
        'Orbits: the scan flies gravity alone (no sunlight, no tide), circular starts at sqrt(GM/r) on the node of the spin equator; Orbital B adds idea 42\'s sunlight and solar tide, tabulated along the reconstruction (area per mass 1/81.119 m^2/kg, OSIRIS-APEX).'
      ];
      return { src: src, S: S, B: B, P: P, surface: surf, equilibria: eq, roche: roche, site: st, subFace: subFace, sh: shC, shDsk: shD, orbitB: ob, scan: scan, own: own, carried: src.carried, assumptions: assumptions };
    }
    function scanRefusals(B, scan) {
      var out = [];
      if (scan.refusedRadii.length) out.push(refusal('out_of_envelope', scan.refusedRadii.length + ' scan radii (from ' + Math.min.apply(null, scan.refusedRadii).toFixed(0) + ' m) have sunlight above 5% of gravity: orbits there are idea 42\'s (it flies sunlight and the solar tide).', 'Fly them in idea 42\'s orbit scan.', { applies_to: 'scan' }));
      if (!num(B.srp_m_s2)) out.push(refusal('insufficient_data', 'Orbits are flown under gravity alone: no spacecraft area per mass is given, so sunlight is left out.', 'A handoff from idea 42 (its environment carries sunlight).', { applies_to: 'scan' }));
      return out;
    }
    /** Attach results computed piecewise (the page flies the scan and Orbital B a step at a time) exactly as run() would. */
    function attachScan(R, scan) { R.scan = scan; R.S.scan = true; R.S.scanDays = scan.days; R.S.scanIncl = scan.incl.slice(); R.S.scanRadii = scan.radii.length; R.own = R.own.filter(function (r) { return r.applies_to !== 'scan'; }).concat(scanRefusals(R.B, scan)); return R; }
    function attachOrbitB(R) { R.S.orbitB = true; R.orbitB = R.B.key === 'bennu' ? { pm: orbitB(R.B, 'pm'), poly: orbitB(R.B, 'poly') } : null; return R; }
    function pctOf(ratio) { return ((ratio - 1) * 100).toFixed(1) + '%'; }

    // ---------------------------------------------------------------------------------------------------- handoff
    function qv(value, units, confidence, source) { return { value: value, units: units, confidence: confidence, source: source }; }
    function statOut(s) { return { mean: r9(s.mean), median: r9(s.median), min: r9(s.min), max: r9(s.max) }; }
    function buildHandoff(R, produced) {
      var B = R.B, P = R.P, s = R.surface.stats, eq = R.equilibria;
      var inputs = { closing_handoff: R.src.h42, case: R.src.from === 'bennu2019' ? 'bennu2019' : null, settings: clone(R.S) };
      var att = B.att, out = {
        body: qv({ designation: B.designation, name: B.name, shape_model: P.meta.model, shape_reference: P.meta.reference, shape_dsk: P.meta.dsk, shape_dsk_sha256: P.meta.dskSha256, plates: P.nf, vertices: P.nv,
          frame: P.meta.frame, volume_m3: r9(P.volume), equivalent_radius_m: r9(B.Req), area_m2: r9(P.area), brillouin_radius_m: r9(P.rMax), uniform_com_in_dsk_frame_m: vr9(P.comOffsetDsk),
          GM_m3_s2: r9(B.GM), GM_source: B.GMsrc, GM_confidence: B.GMconf, density_kg_m3: r9(B.rho), G_m3_kg_s2: G_NEWTON,
          inertia_ratios_uniform: [r9(P.principal.values[0] / P.principal.values[2]), r9(P.principal.values[1] / P.principal.values[2]), 1],
          inertia_ratios_dynamical: B.key === 'apophis' ? IR.slice() : null, hill_radius_m: r9(B.hill_m) }, 'm, m^3, m^2, m^3/s^2, kg/m^3', B.GMconf === 'measured' ? 'measured' : 'assumed', P.meta.dsk + ' (NAIF), ' + B.GMsrc),
        spin: qv({ kind: att.kind, epoch_tdb_s: R.src.epoch, epoch_utc: utcOf(R.src.epoch), C_icrf_to_body: vr9(att.C), omega_body_rad_s: vr9(att.w), period_h: r9(att.period_h),
          pole_or_angular_momentum_icrf: vr9(poleIcrf(B)), model: B.key === 'bennu' ? ATT.bennu.model + ' (' + ATT.bennu.pck + ')' : ATT.apophis.model + ' (' + ATT.apophis.ck + ')' }, 'rad/s, h', 'derived', KERNEL + ' bennuAttitude() / apophisAttitude()'),
        field: qv({ model: 'constant-density polyhedron (Werner and Scheeres 1997), ' + KERNEL + ' fieldRaw(); the shape decodes from this module\'s snapshots/shapes.js', origin: P.centre === 'dsk' ? 'the DSK origin' : 'the uniform-density centre of mass (DSK origin + uniform_com_in_dsk_frame_m)',
          harmonics: { R0_m: r9(R.sh.R0), nmax: 4, C: R.sh.C.map(vr9), S: R.sh.S.map(vr9), J: vr9(R.sh.J), valid_outside_m: r9(P.rMax), normalisation: 'full (geodesy), no Condon-Shortley phase' },
          point_mass_error_at: pmErrors(R) }, 'm, m^2/s^2', 'derived', KERNEL + ' harmonics() (Grundmann-Moeller, exact to degree 5)'),
        surface: qv({ epoch_tdb_s: R.src.epoch, gravity_m_s2: statOut(s.gravity), accel_m_s2: statOut(s.accel), slope_deg: statOut(s.slope), height_m: statOut(s.height), escape_up_m_s: statOut(s.vUp), escape_min_m_s: statOut(s.vMin),
          area_fraction_steeper_30deg: r9(s.steeper30), area_fraction_steeper_40deg: r9(s.steeper40), area_fraction_over_90deg: r9(s.over90), slope_hist_5deg: s.slopeHist5deg.map(r9), roche_lobe_area_fraction: R.roche === null ? null : r9(R.roche) },
          'm/s^2, deg, m, m/s', 'derived', KERNEL + ' surface(): every plate centroid, weighted by area'),
        equilibria: eq.refusal ? qv(null, 'm', 'derived', 'refused: ' + eq.refusal.applies_to) : qv({ synchronous_radius_m: r9(eq.synchronous_m), roche_energy_J_kg: r9(eq.rocheEnergy_J_kg), points: eq.points.map(function (q) {
          return { body_m: vr9(q.x), r_m: r9(q.r_m), lon_deg: r9(q.lon_deg), energy_J_kg: r9(q.energy_J_kg), type: q.stability.type, stable: q.stability.stable, efold_h: r9(q.stability.efold_h), periods_h: q.stability.periods_h.map(r9) }; }) },
          'm, J/kg, h', 'derived', KERNEL + ' equilibria(): Newton in the body frame; stability from the linearised rotating-frame motion'),
        site: qv(siteOut(R.site, R), 'm, m/s^2, deg, m/s', 'derived', KERNEL + ' site(): ' + (R.S.site !== null ? 'the plate chosen' : 'the plate under idea 42\'s stand-off at its epoch')),
        orbits: qv(R.scan ? { days: R.scan.days, inclinations_deg: R.scan.incl, radii_m: R.scan.radii.map(r9), refused_radii_m: R.scan.refusedRadii.map(r9), rows: R.scan.rows.map(function (o) { return { r_m: r9(o.r_m), inc_deg: o.inc_deg, outcome: o.outcome, t_days: r9(o.t_days), rmin_m: r9(o.rmin_m), rmax_m: r9(o.rmax_m) }; }) } : null,
          'm, deg, days', 'derived', R.scan ? KERNEL + ' orbitScan(): circular starts flown under the polyhedron (gravity alone)' : 'not run (settings.scan false)'),
        orbit_b: qv(R.orbitB ? { GM_m3_s2: r9(R.B.GM), legs: R.orbitB.poly.legs, sunlight: 'idea 42 accel() tabulated (snapshots/orbit-b-sunlight.js)',
          point_mass: obOut(R.orbitB.pm), polyhedron: obOut(R.orbitB.poly) } : null,
          'm, m/s', 'measured', R.orbitB ? 'JPL Horizons OSIRIS-REx reconstruction (snapshots/orbit-b.js), 2019-06-19 00:00 to 06-20 16:00 TDB' : (R.B.key === 'bennu' ? 'not run (settings.orbitB false)' : 'Bennu only'))
      };
      return { handoff: 'long-way-round', version: 1, from: '43-lumpy', produced: produced || new Date().toISOString(), inputs: inputs, outputs: out,
        refusals: R.carried.concat(R.own).map(clone), assumptions: R.assumptions.slice() };
    }
    function obOut(o) { return { leg_dv_median_m_s: r9(o.legDv_median_m_s), leg_dv_max_m_s: r9(o.legDv_max_m_s), leg_dr_median_m: r9(o.legDr_median_m), arc_end_m: r9(o.arcEnd_m), arc_max_m: r9(o.arcMax_m) }; }
    function siteOut(st, R) {
      return { face: st.face, body_fixed_m: vr9(st.body_fixed_m), lat_deg: r9(st.lat_deg), lon_deg: r9(st.lon_deg), radius_m: r9(st.radius_m), normal_body: vr9(st.normal),
        gravity_body_m_s2: vr9(st.gravity_m_s2), gravity_m_s2: r9(st.gravity_mag_m_s2), accel_m_s2: r9(st.accel_mag_m_s2), slope_deg: r9(st.slope_deg), height_m: r9(st.height_m),
        escape_up_m_s: r9(st.escape_up_m_s), escape_min_m_s: r9(st.escape_min_m_s), escape_inertial_m_s: r9(st.escape_inertial_m_s), plate_area_m2: r9(st.area_m2),
        point_mass_gravity_m_s2: r9(R.B.GM / (st.radius_m * st.radius_m)), epoch_tdb_s: R.src.epoch };
    }
    /** How wrong a point mass is (|g_pm - g| / |g|) at 1.0, 1.5, 2 and 4 Brillouin radii along the body's long axis. */
    function pmErrors(R) {
      var P = R.P, ax = [P.principal.vectors[0], P.principal.vectors[3], P.principal.vectors[6]];
      return [1.0, 1.5, 2, 4].map(function (k) {
        var x = scale(ax, k * P.rMax), f = field(P, R.B.Grho, x), r = norm(x), pm = scale(x, -R.B.GM / (r * r * r));
        return { r_over_brillouin: k, r_m: r9(k * P.rMax), relative_error: r9(norm(sub(pm, f.g)) / norm(f.g)) };
      });
    }
    function codes(rs) { return (rs || []).map(function (r) { return (r.from ? r.from + ':' : '') + r.code + '/' + (r.applies_to || ''); }).sort().join('|'); }
    function numDiff(a, b, path, tol) {
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)) ? null : path + ' (' + a + ' vs ' + b + ')';
      if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return path + ' length'; for (var i = 0; i < a.length; i++) { var d = numDiff(a[i], b[i], path + '[' + i + ']', tol); if (d) return d; } return null; }
      if (a && b && typeof a === 'object' && typeof b === 'object') { var ks = Object.keys(b); if (Object.keys(a).length !== ks.length) return path + ' keys'; for (var k = 0; k < ks.length; k++) { var e = numDiff(a[ks[k]], b[ks[k]], path + '.' + ks[k], tol); if (e) return e; } return null; }
      return a === b ? null : path;
    }
    /** Read this page's own handoff back: idea 42's inside is checked, everything recomputed and compared to 1e-6. */
    function parseHandoff(h43) {
      var h = h43;
      if (typeof h43 === 'string') { try { h = JSON.parse(h43); } catch (e) { return { refusal: refusal('invalid_input', 'That is not JSON.', 'A handoff from idea 42 or from this page.') }; } }
      if (!h || h.handoff !== 'long-way-round' || h.version !== 1) return { refusal: refusal('invalid_input', 'That is not a version 1 Long Way Round handoff.', 'A handoff from idea 42 or from this page.') };
      if (h.from === '42-closing-in') return importClosing(h);
      if (h.from !== '43-lumpy') return { refusal: refusal('invalid_input', 'That handoff is from ' + h.from + '; this module takes idea 42\'s or its own.', 'A handoff from idea 42 (Closing In) or from this page.') };
      var I = h.inputs || {}, src;
      if (I.closing_handoff) { src = importClosing(I.closing_handoff); if (src.refusal) return src; }
      else if (I.case === 'bennu2019') src = bennuCase();
      else return { refusal: refusal('invalid_input', 'This 43 handoff carries neither idea 42\'s handoff nor a known case.', 'The unedited handoff this page exported.') };
      if (!I.settings) return { refusal: refusal('invalid_input', 'This 43 handoff has no settings.', 'The unedited handoff this page exported.') };
      var R = run(src, I.settings); if (R.refusal) return { refusal: R.refusal };
      var again = buildHandoff(R, h.produced);
      for (var k in again.outputs) {
        var d = numDiff(h.outputs && h.outputs[k] && h.outputs[k].value, again.outputs[k].value, k, 1e-6);
        if (d) return { refusal: refusal('invalid_input', 'The handoff says ' + d + ' is not what its own inputs give: it was edited, or made with other data.', 'The unedited handoff this page exported.') };
      }
      if (codes(h.refusals) !== codes(again.refusals)) return { refusal: refusal('invalid_input', 'The handoff\'s refusals are not the ones its inputs give: it was edited.', 'The unedited handoff this page exported.') };
      return { from: '43-lumpy', h43: h, src: src, settings: I.settings, R: R };
    }

    return {
      G_NEWTON: G_NEWTON, IR: IR, shapes: SH, attitudeData: ATT, geophysics: GEO, orbitBData: ORB, utcOf: utcOf, tdbOfUtc: tdbOfUtc, tdbOfJd: tdbOfJd,
      shape: shape, field: field, inside: inside, harmonics: harmonics, harmonicU: harmonicU, integrate: integrate, bennuAttitude: bennuAttitude, apophisAttitude: apophisAttitude, attitudeAt: attitudeAt,
      eulerDeriv: eulerDeriv, bodyModel: bodyModel, rawSurface: rawSurface, surface: surface, equilibria: equilibria, eqStability: eqStability, cubicRoots: cubicRoots, rocheFraction: rocheFraction,
      fly: fly, flight: flight, orbitStart: orbitStart, orbitFinish: orbitFinish, sunlightTable: sunlightTable, attachScan: attachScan, attachOrbitB: attachOrbitB, scanRefusals: scanRefusals, OB_ROWS: OB_ROWS, orbitOne: orbitOne, scanPlan: scanPlan, orbitScan: orbitScan, rayFace: rayFace, site: site, orbitB: orbitB, poleIcrf: poleIcrf,
      importClosing: importClosing, bennuCase: bennuCase, defaults: defaults, validSettings: validSettings, run: run, buildHandoff: buildHandoff, parseHandoff: parseHandoff, codes: codes, numDiff: numDiff, pmErrors: pmErrors
    };
  }

  return { create: create, decodeShape: decodeShape, prepare: prepare, massProps: massProps, fieldRaw: fieldRaw, solid: solid, eigSym3: eigSym3, q2m: q2m, rot: rot, GM_RULE: GM_RULE, DEG: DEG, DAY: DAY };
});
