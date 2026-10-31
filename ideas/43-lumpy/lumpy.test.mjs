// Tests for idea 43 (Lumpy). node --test ideas/43-lumpy/lumpy.test.mjs
// Every number pinned here comes from outside the kernel: an independent polyhedron-gravity implementation and a
// closed-form prism (oracle/oracle.json), NASA/NAIF's SPICE (pxform, q2m, the Apophis CK's own samples), JPL Horizons'
// OSIRIS-REx reconstruction, the published tables of Scheeres et al. 2020 and Barnouin et al. 2019, closed forms worked
// here, or idea 42's own kernel and parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { K, Lumpy, sample42 } = require('./load.cjs');
const O = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle', 'oracle.json'), 'utf8'));
const DEG = Math.PI / 180, DAY = 86400;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const rclose = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b} (rel tol ${tol})`);
const norm = (v) => Math.hypot(...v), sub = (a, b) => a.map((x, i) => x - b[i]), dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const GEO = K.geophysics.scheeres2020.zonals, BAR = K.geophysics.barnouin2019;

const src42 = K.importClosing(sample42());
const chain = K.run(src42, K.defaults());
const bennu = K.run(K.bennuCase(), K.defaults());

test('snapshots: sha256 matches each sidecar; the borrowed files are ideas 40 and 42 committed files (idea 40\'s integrator excerpted verbatim)', () => {
  const dir = path.join(HERE, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
    assert.equal(sha, side.writtenSha256, f + ' was changed after its sidecar was written');
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], f + ' sidecar lacks ' + k);
  }
  const same = (a, b) => assert.ok(fs.readFileSync(path.join(dir, a)).equals(fs.readFileSync(path.join(HERE, '..', b))), a + ' is ' + b);
  // the integrator is idea 40's coast.js, excerpted: every line between the markers is a line of coast.js, in order
  const ex = fs.readFileSync(path.join(dir, 'integrator.js'), 'utf8'), coast = fs.readFileSync(path.join(HERE, '..', '40-long-coast', 'coast.js'), 'utf8').split('\n');
  for (const m of ex.matchAll(/\/\/ ---- coast\.js lines (\d+)-(\d+)\n([\s\S]*?)(?=\n  \/\/ ----|\n  return \{ dopri)/g)) assert.equal(m[3], coast.slice(+m[1] - 1, +m[2]).join('\n'), 'coast.js lines ' + m[1] + '-' + m[2] + ' verbatim');
  assert.equal([...ex.matchAll(/\/\/ ---- coast\.js lines/g)].length, 2, 'two excerpts');
  same('approach-sources.js', '42-closing-in/snapshots/approach-sources.js');
  same('aster-constants.js', '42-closing-in/snapshots/aster-constants.js');
  assert.deepEqual(sample42(), JSON.parse(fs.readFileSync(path.join(HERE, '..', '42-closing-in', 'handoff.json'), 'utf8')), 'the wrapped 42 sample is idea 42\'s committed handoff');
});

test('shapes: closed, outward, the published counts; mass properties against the oracle and Barnouin et al. 2019', () => {
  const A = K.shape('apophis', 'dsk'), B = K.shape('bennu', 'dsk');
  assert.equal(A.nv, 2000); assert.equal(A.nf, 3996); assert.equal(A.euler, 2);
  assert.equal(B.nv, 1538); assert.equal(B.nf, 3072); assert.equal(B.euler, 2);
  for (const [P, o] of [[A, O.field.apophis], [B, O.field.bennu]]) {
    rclose(P.volume, o.volume_m3, 1e-12, P.key + ' volume'); rclose(P.area, o.area_m2, 1e-12, P.key + ' area');
    for (let k = 0; k < 3; k++) close(P.comOffsetDsk[k], o.centroid_m[k], 1e-9, P.key + ' centroid ' + k);
  }
  // Bennu (Barnouin et al. 2019 Table 1, SPC v20): volume 0.0615 +- 0.0001 km^3, area 0.782 km^2, density 1190 +- 13
  const q32 = O.bennu.q32;
  rclose(q32.volume_m3 / 1e9, 0.06124243, 1e-6, 'the 12,288-plate DSK volume'); close(B.volume / 1e9, 0.0610377, 1e-7, 'the 3,072-plate subsample volume');
  close((q32.volume_m3 / 1e9 - BAR.volume_km3) / BAR.volume_km3, -0.00419, 0.0001, 'DSK volume vs Barnouin (-0.42%)');
  close(bennu.B.rho, 1200.45, 0.01, 'uniform density from the particle GM'); assert.ok(Math.abs(bennu.B.rho - BAR.density_kg_m3) < BAR.density_1sigma_kg_m3, 'inside Barnouin\'s 1190 +- 13');
  // Barnouin's COM-COF offset [1.38, -0.43, -0.12] +- [0.04, 0.07, 0.27] m: the uniform centroid of this model sits 0.16 m short in x
  BAR.comCofOffset_m.forEach((v, k) => close(B.comOffsetDsk[k], v, 0.35, 'COM-COF ' + k));
  close(B.comOffsetDsk[0] - BAR.comCofOffset_m[0], -0.156, 0.001, 'x offset gap');
  // Apophis: volume-equivalent diameter 335.8 m against SBDB's (and the PCK's) 340 m; uniform inertia ratios against Pravec's
  close(2 * chain.B.Req, 335.797, 0.001, 'Apophis D_eq');
  const ir = [A.principal.values[0] / A.principal.values[2], A.principal.values[1] / A.principal.values[2]];
  close(ir[0], 0.73044, 1e-5, 'I1/I3 uniform'); close(ir[1], 0.94743, 1e-5, 'I2/I3 uniform');
  assert.deepEqual(K.IR, [0.61, 0.965, 1], 'Pravec 2014 ratios from the CK comment');
  // a broken mesh is refused, not computed
  const bad = Lumpy.prepare({ V: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), F: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2]), nv: 4, nf: 3 });
  assert.equal(bad.refusal.code, 'invalid_input');
  const flipped = Lumpy.prepare({ V: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), F: Uint32Array.from([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]), nv: 4, nf: 4 });
  assert.equal(flipped.refusal.code, 'invalid_input', 'an inside-out tetrahedron');
});

test('the field against an independent implementation (polyhedral-gravity, Tsoulis\'s line integrals): 80 points per body', () => {
  let worst = 0;
  for (const key of ['apophis', 'bennu']) {
    const P = K.shape(key, 'dsk'), o = O.field[key];
    o.points.forEach((x, i) => {
      const f = K.field(P, 1, x, true), gs = norm(o.g[i]);
      worst = Math.max(worst, Math.abs(f.U - o.U[i]) / o.U[i], norm(sub(f.g, o.g[i])) / gs);
      rclose(f.U, o.U[i], 1e-10, key + ' U at ' + i);
      assert.ok(norm(sub(f.g, o.g[i])) <= 1e-9 * gs + 1e-12, key + ' g at ' + i);
      // the Hessian jumps across the surface (the Laplacian is -4 pi G rho inside and 0 outside), so it is compared off it;
      // far out the oracle's tensor loses digits (it warns of 'a significant difference of magnitudes'), hence 5e-6 beyond
      // three Brillouin radii (1e-7 nearer)
      // and a finite-difference check of this kernel's own Hessian below
      const Hs = norm(o.H[i]);   // points 48 and on are plate centroids, on the surface
      const far = norm(x) > 3 * o.rmax_m;
      if (i < 48) [0, 1, 2, 4, 5, 8].forEach((m, j) => close(f.H[m], o.H[i][j], (far ? 5e-6 : 1e-7) * Hs + 1e-13, key + ' H at ' + i));
      if (i >= 6 && i < 30 && i % 6 === 0) {   // central differences of the gravity, 5 cm steps, from 1.5 Brillouin radii out
        const h = 0.05, fd = [0, 1, 2].map((j) => { const xp = x.slice(), xm = x.slice(); xp[j] += h; xm[j] -= h; const gp = K.field(P, 1, xp).g, gm = K.field(P, 1, xm).g; return gp.map((v, k) => (v - gm[k]) / (2 * h)); });
        [0, 1, 2].forEach((a) => [0, 1, 2].forEach((b) => close(f.H[3 * a + b], fd[b][a], 1e-7 * Hs, key + ' H by differences at ' + i)));
      }
    });
  }
  assert.ok(worst < 3e-10, 'worst relative difference ' + worst);   // measured 2.24e-10 (a gravity component near a vertex)
});

test('closed forms: a uniform box against harmonica\'s prism (Nagy et al. 2000); Poisson inside, Laplace outside; the far field is GM/r^2', () => {
  const b = O.prism.box_wesnbt_m, V = [];
  for (const z of [b[4], b[5]]) for (const y of [b[2], b[3]]) for (const x of [b[0], b[1]]) V.push(x, y, z);
  const id = (i, j, k) => k * 4 + j * 2 + i, quads = [[id(0, 0, 0), id(0, 1, 0), id(1, 1, 0), id(1, 0, 0)], [id(0, 0, 1), id(1, 0, 1), id(1, 1, 1), id(0, 1, 1)], [id(0, 0, 0), id(1, 0, 0), id(1, 0, 1), id(0, 0, 1)], [id(0, 1, 0), id(0, 1, 1), id(1, 1, 1), id(1, 1, 0)], [id(0, 0, 0), id(0, 0, 1), id(0, 1, 1), id(0, 1, 0)], [id(1, 0, 0), id(1, 1, 0), id(1, 1, 1), id(1, 0, 1)]];
  const F = []; for (const q of quads) F.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  const P = Lumpy.prepare({ V: Float64Array.from(V), F: Uint32Array.from(F), nv: 8, nf: 12 }, { centre: 'dsk' });
  const Grho = K.G_NEWTON * O.prism.density, h = O.prism.harmonica;
  O.prism.points.forEach((x, i) => {
    const f = K.field(P, Grho, x);
    rclose(f.U, h.potential[i], 1e-12, 'prism potential ' + i);
    const g = [h.g_e[i] * 1e-5, h.g_n[i] * 1e-5, -h.g_z[i] * 1e-5];   // harmonica: mGal, g_z positive down
    assert.ok(norm(sub(f.g, g)) < 1e-12 * norm(g) + 1e-20, 'prism g ' + i);
  });
  // Laplacian = trace of the Hessian = -4 pi G rho inside, 0 outside
  const Pb = K.shape('bennu'), Grb = bennu.B.Grho;
  const fin = K.field(Pb, Grb, [10, -20, 5], true), fout = K.field(Pb, Grb, [600, 100, -50], true);
  close(fin.H[0] + fin.H[4] + fin.H[8], -4 * Math.PI * Grb, 1e-12 * 4 * Math.PI * Grb, 'Poisson'); close(fout.H[0] + fout.H[4] + fout.H[8], 0, 1e-9 * Math.abs(fout.H[0]), 'Laplace');
  close(fin.solidAngle, 4 * Math.PI, 1e-10, 'solid angle inside'); close(fout.solidAngle, 0, 1e-10, 'outside');
  // far away the field is a point mass, the error falling as (R/r)^2
  const e = [4, 16].map((k) => { const x = [k * Pb.rMax * 0.6, k * Pb.rMax * 0.5, k * Pb.rMax * 0.62], f = K.field(Pb, Grb, x), r = norm(x); return norm(sub(f.g, x.map((c) => -bennu.B.GM * c / r ** 3))) / norm(f.g); });
  assert.ok(e[1] < e[0] / 12 && e[1] > e[0] / 20 && e[1] < 3e-4, 'point-mass limit falls as (R/r)^2: ' + e);
});

test('spherical harmonics: the simplex rule is exact to degree 5 (and not 6); coefficients against the oracle\'s quadrature and the inertia closed form', () => {
  // integral of x^a y^b z^c over the unit tetrahedron = a! b! c! / (a + b + c + 3)!
  const unit = Lumpy.prepare({ V: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), F: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]), nv: 4, nf: 4 }, { centre: 'dsk' });
  const f = (n) => { let p = 1; for (let i = 2; i <= n; i++) p *= i; return p; };
  for (const [a, b, c] of [[0, 0, 0], [2, 1, 0], [1, 1, 1], [5, 0, 0], [2, 2, 1], [3, 0, 2]]) {
    const v = K.integrate(unit, (x) => [x[0] ** a * x[1] ** b * x[2] ** c], 1)[0];
    rclose(v, f(a) * f(b) * f(c) / f(a + b + c + 3), 1e-12, 'monomial ' + [a, b, c]);
  }
  const v6 = K.integrate(unit, (x) => [x[0] ** 6], 1)[0];
  assert.ok(Math.abs(v6 - f(6) / f(9)) > 1e-6 * f(6) / f(9), 'degree 6 is not exact (the rule\'s limit)');
  // Bennu q16 about the DSK origin, R0 = 290 m: against the potential sampled on a sphere by the independent code
  const P = K.shape('bennu', 'dsk'), sh = K.harmonics(P, 4, 290, [0, 0, 0]), q = O.bennu.harmonics_dsk_origin_R0_290.q16;
  for (let n = 1; n <= 4; n++) for (let m = 0; m <= n; m++) { close(sh.C[n][m], q.C[n + ',' + m], 2e-7, 'C' + n + m); close(sh.S[n][m], q.S[n + ',' + m], 2e-7, 'S' + n + m); }
  // C20 from the inertia tensor (about the centre of mass): C20 = (Ixx + Iyy - 2 Izz) / (2 M R^2) / sqrt(5)
  const Pc = K.shape('bennu'), shc = K.harmonics(Pc, 2, 290, [0, 0, 0]), I = Pc.inertia;
  close(shc.C[2][0], (I[0] + I[4] - 2 * I[8]) / (2 * Pc.volume * 290 * 290) / Math.sqrt(5), 1e-14, 'C20 = inertia closed form');
  close(shc.C[2][2], (I[4] - I[0]) / (4 * Pc.volume * 290 * 290) / Math.sqrt(5 / 12), 1e-14, 'C22 = inertia closed form');
  // the expansion reproduces the polyhedron outside the Brillouin sphere
  const sh4 = K.harmonics(Pc, 4, Pc.rMax), x2 = [1.6 * Pc.rMax, 0.9 * Pc.rMax, 0.7 * Pc.rMax], x4 = x2.map((c) => 2 * c);
  const e2 = Math.abs(K.harmonicU(sh4, 1, x2) - K.field(Pc, 1 / Pc.volume, x2).U) / K.field(Pc, 1 / Pc.volume, x2).U;
  const e4 = Math.abs(K.harmonicU(sh4, 1, x4) - K.field(Pc, 1 / Pc.volume, x4).U) / K.field(Pc, 1 / Pc.volume, x4).U;
  assert.ok(e2 < 2e-4 && e4 < 1e-5 && e4 < e2, 'truncation ' + e2 + ' ' + e4);
});

test('Bennu\'s field against what was published and measured (Scheeres et al. 2020, Table 1, R0 = 290 m)', () => {
  const J = bennu.shDsk.J, J32 = O.bennu.harmonics_dsk_origin_R0_290.q32.J;
  // constant density: this subsample, the full 12,288-plate DSK, and Scheeres's own (SPC v42 shape)
  close(J[2], 0.0184879, 2e-7, 'J2 q16'); close(J32[2], 0.0185653, 2e-7, 'J2 q32 (oracle)');
  close(J32[2] / GEO.J2.cd - 1, -0.0103, 0.0002, 'J2: ALT v021 vs SPC v42, both uniform (-1.0%)');
  close(J32[3] / GEO.J3.cd - 1, 0.0104, 0.0005, 'J3 (+1.0%)'); close(J32[4] / GEO.J4.cd - 1, -0.0242, 0.0005, 'J4 (-2.4%)');
  close(J[2] / J32[2] - 1, -0.0042, 0.0002, 'what the q16 subsample costs in J2');
  // reality: the particle-tracking field against uniform density
  close(GEO.J2.particle / J32[2], 1.0375, 0.0005, 'measured J2 is 3.7% above this uniform model'); close(GEO.J2.ratio, 1.027, 0, 'Scheeres\'s own ratio to their uniform model');
  close(GEO.J3.particle / J32[3], 1.1463, 0.001, 'J3'); close(GEO.J4.particle / J32[4], 1.0340, 0.001, 'J4');
  // the subsample changes gravity by at most 0.3% just outside the body (oracle: the full DSK against the shipped one)
  assert.ok(O.bennu.subsample_g_relative['r_1.05x290'][1] < 0.003 && O.bennu.subsample_g_relative['r_2x290'][1] < 0.0003);
});

test('spin: Bennu against SPICE pxform; Apophis\'s torque-free rotation against the CK\'s own samples; refusals outside the span', () => {
  for (const p of O.attitude.bennu_pxform) { const a = K.bennuAttitude(p.tdb); a.C.forEach((c, i) => close(c, p.C[i], 2e-10, 'Bennu C ' + i + ' at ' + p.tdb)); }
  Lumpy.q2m(O.attitude.apophis_q2m.q).forEach((c, i) => close(c, O.attitude.apophis_q2m.C[i], 5e-14, 'q2m ' + i));
  for (const s of O.attitude.apophis_ck) {
    const a = K.apophisAttitude(s.tdb), R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a.C[3 * i] * s.C[3 * j] + a.C[3 * i + 1] * s.C[3 * j + 1] + a.C[3 * i + 2] * s.C[3 * j + 2]));
    const ang = Math.acos(Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)) / DEG * 3600;
    s.pxform.forEach((c, i) => close(c, s.C[i], 1e-12, 'ckgpav at a tick = pxform'));
    assert.ok(ang < 1.0, 'Apophis attitude after ' + ((s.tdb - K.attitudeData.apophis.knots[s.from_knot][0]) / DAY).toFixed(1) + ' d: ' + ang + ' arcsec');
    assert.ok(norm(sub(a.w, s.w_body)) < 5e-6 * norm(s.w_body), 'Apophis spin vector');
  }
  // the angular momentum direction the CK comment lists (Pravec 2014): RA 118.790629, Dec -79.408659
  const L = chain.B.att.L_icrf; close((Math.atan2(L[1], L[0]) / DEG + 360) % 360, 118.790629, 0.002, 'L RA'); close(Math.asin(L[2]) / DEG, -79.408659, 0.002, 'L Dec');
  // |w| at the stand-off: 29.96 h instantaneous period; L/I3 = 0.20419588 rad/h (CK comment)
  const w = chain.B.att.w; close(norm([0.61 * w[0], 0.965 * w[1], w[2]]) * 3600, 0.20419588, 3e-5, 'L/I3');
  assert.equal(K.apophisAttitude(K.attitudeData.apophis.egaTdb + DAY).refusal.code, 'out_of_envelope', 'after the 2029 encounter');
  assert.equal(K.apophisAttitude(K.attitudeData.apophis.knots[0][0] - 30 * DAY).refusal.code, 'out_of_envelope', 'before the samples');
});

test('the surface: Bennu against the oracle\'s 12,288-plate run and Barnouin et al. 2019 (uniform density, 3 m model); a sphere\'s slopes are flat', () => {
  const Rd = K.run(K.bennuCase(), { centre: 'dsk', orbitB: false }), s = Rd.surface.stats, o16 = O.bennu.surface.q16, o32 = O.bennu.surface.q32;
  for (const k of ['gravity', 'accel', 'slope']) for (const q of ['mean', 'median', 'min', 'max']) rclose(s[k][q], o16[k][q], 1e-6, k + ' ' + q + ' vs the oracle');
  // resolution: slopes steepen as plates shrink: 25 m 14.17 deg, 12.6 m 15.80, Barnouin's 3 m 17 +- 2
  close(s.slope.mean, 14.17, 0.01, 'q16 mean slope'); close(o32.slope.mean, 15.80, 0.01, 'q32 mean slope');
  assert.ok(s.slope.mean < o32.slope.mean && o32.slope.mean < BAR.slope_deg.weightedMean, 'slopes steepen with resolution');
  close(o32.slope.median, 14.94, 0.01, 'q32 median slope vs Barnouin 16.3');
  // acceleration with the spin: the maximum (at the poles) agrees, the area mean does not
  close(s.accel.max, 8.064e-5, 1e-8, 'max'); close(s.accel.max / BAR.gravity_m_s2.range_as_printed[1] - 1, 0.008, 0.001, 'max vs 0.000080 (+0.8%)');
  close(o32.accel.mean / BAR.gravity_m_s2.weightedMean - 1, -0.071, 0.001, 'mean vs 0.0000595 (-7.1%, not reproduced)');
  // a tessellated sphere (icosahedron subdivided 3 times), not spinning: gravity GM/r^2 within 1%, slopes under 2 deg
  const ico = icosphere(3, 100), P = Lumpy.prepare(ico), Grho = 1;
  let worstG = 0, worstS = 0;
  for (let f = 0; f < P.nf; f += 7) {
    const x = [P.FC[3 * f], P.FC[3 * f + 1], P.FC[3 * f + 2]], n = [P.FN[3 * f], P.FN[3 * f + 1], P.FN[3 * f + 2]], g = K.field(P, Grho, x).g, r = norm(x);
    worstG = Math.max(worstG, Math.abs(norm(g) / (P.volume / r ** 2) - 1)); worstS = Math.max(worstS, Math.acos(-dot(n, g) / norm(g)) / DEG);
  }
  assert.ok(worstG < 0.01 && worstS < 2, 'sphere ' + worstG + ' ' + worstS);
});

test('equilibria: Bennu\'s eight against the independent field and numpy\'s eigenvalues; a tumbler has none', () => {
  const pts = bennu.equilibria.points, oe = O.equilibria.points;
  assert.equal(pts.length, 8); assert.equal(oe.length, 8);
  pts.forEach((q, i) => {
    assert.ok(norm(sub(q.x, oe[i].x)) < 0.01, 'position ' + i);
    const growth = q.stability.efold_h ? 1 / (q.stability.efold_h * 3600) : 0;
    rclose(growth, oe[i].max_re, 1e-5, 'largest growth rate ' + i);
    assert.equal(q.stability.kind, oe[i].eig_im.filter((v, j) => Math.abs(v) < 1e-12 && oe[i].eig_re[j] > 1e-9).length ? 'saddle' : 'centre', 'type ' + i);
  });
  assert.equal(pts.filter((q) => q.stability.kind === 'saddle').length, 4);
  assert.ok(pts.every((q) => !q.stability.stable), 'no stable centre at this density and spin (Scheeres 2020: one stable in their uniform model)');
  close(bennu.equilibria.synchronous_m, Math.cbrt(bennu.B.GM / bennu.B.att.w[2] ** 2), 1e-9, 'synchronous radius (GM / w^2)^(1/3)'); close(bennu.equilibria.synchronous_m, 309.44, 0.01, 'its value');
  bennu.equilibria.points.forEach((q, i) => assert.ok(q.residual_m_s2 < 1e-15 && q.r_m > 313 && q.r_m < 323, 'point ' + i + ' balances, just outside the equator'));
  close(bennu.roche, 0.4705, 0.0005, 'area inside the rotational Roche lobe');
  // the point-mass circular orbit as an equilibrium: l^2 = 0, -w^2, -w^2
  const w = 1e-3, rs = 1000, mu = w * w * rs ** 3, H = [2 * mu / rs ** 3 + w * w, 0, 0, 0, -mu / rs ** 3 + w * w, 0, 0, 0, -mu / rs ** 3];
  const st = K.eqStability(H, w), roots = st.roots.map((r) => r[0] / (w * w)).sort((a, b) => a - b);
  close(roots[0], -1, 1e-6, 'l^2 = -w^2'); close(roots[1], -1, 1e-6, 'l^2 = -w^2'); close(roots[2], 0, 1e-6, 'l^2 = 0');
  assert.equal(chain.equilibria.refusal.code, 'out_of_envelope', 'Apophis tumbles');
});

test('orbits: the Jacobi integral holds about spinning Bennu; a small scan shows what the lumps do; sunlight past 5% is idea 42\'s', () => {
  const B = bennu.B, x0 = [350, 0, 0].map((v, i) => v), C = B.att.C, xi = [0, 1, 2].map((i) => C[i] * x0[0] + C[3 + i] * x0[1] + C[6 + i] * x0[2]);
  const vi = [0, 1, 2].map((i) => C[3 + i] * Math.sqrt(B.GM / 350));
  const f = K.fly(B, 'poly', B.epoch, xi, vi, 6 * 3600, { samples: 6 });
  const wz = B.att.w[2];
  const jacobi = (o) => { const Ct = K.bennuAttitude(o.t).C, xb = [0, 1, 2].map((i) => Ct[3 * i] * o.x[0] + Ct[3 * i + 1] * o.x[1] + Ct[3 * i + 2] * o.x[2]), vb = [0, 1, 2].map((i) => Ct[3 * i] * o.v[0] + Ct[3 * i + 1] * o.v[1] + Ct[3 * i + 2] * o.v[2]);
    const vr = [vb[0] + wz * xb[1], vb[1] - wz * xb[0], vb[2]]; return 0.5 * dot(vr, vr) - 0.5 * wz * wz * (xb[0] ** 2 + xb[1] ** 2) - K.field(B.P, B.Grho, xb).U; };
  const J0 = jacobi(f.out[0]); f.out.forEach((o) => close(jacobi(o), J0, 3e-7 * Math.abs(J0), 'Jacobi integral'));
  const S = Object.assign(K.defaults(), { scanRadii: 3, scanDays: 1, scanIncl: [0, 180] }), sc = K.orbitScan(B, S);
  const out = sc.rows.map((r) => r.outcome[0] + Math.round(r.r_m) + '/' + r.inc_deg).join(' ');
  assert.equal(out, 'i302/0 i302/180 s589/0 s589/180 s1149/0 s1149/180', 'scan outcomes');
  assert.ok(sc.rows[0].t_days < 0.2, 'the prograde orbit just outside the equator hits within hours: ' + sc.rows[0].t_days);
  // Apophis from the chain: 42's sunlight (7.8e-8 m/s^2) is 5% of gravity at 1,314 m, beyond 4 Brillouin radii, so no radius is refused
  const pa = K.scanPlan(chain.B, Object.assign(K.defaults(), { scanRadii: 8 }));
  assert.equal(pa.refusedRadii.length, 0); close(pa.radii[7], 4 * chain.P.rMax, 1e-6, 'outer radius');
  const far = Object.assign({}, chain.B, { srp_m_s2: 1e-6 }), pf = K.scanPlan(far, Object.assign(K.defaults(), { scanRadii: 8 }));
  assert.ok(pf.refusedRadii.length > 0 && pf.refusedRadii.every((r) => 1e-6 > 0.05 * chain.B.GM / r ** 2), 'strong sunlight refuses the outer radii');
});

test('reality: OSIRIS-REx in Orbital B (JPL Horizons), 20 two-hour legs and a 40-hour arc; the lumps are most of what a point mass misses', () => {
  const K42 = require('../42-closing-in/load.cjs').K, ORB = K.orbitBData;
  const viaK42 = (t0) => { const ctx = K42.bennuCtx(ORB.bennuHelio[0], t0, 1 / 81.119, 0); return (t, x) => K42.accel(t, x, ctx); };
  // the page's table of 42's sunlight reproduces 42's kernel itself
  const ctx0 = K42.bennuCtx(ORB.bennuHelio[0], K.tdbOfJd(ORB.jd[0]), 1 / 81.119, 0);
  ORB.rel.forEach((r, i) => { const t = K.tdbOfJd(ORB.jd[i]), a = K42.accel(t, r.slice(0, 3), ctx0); assert.ok(norm(sub(K.sunlightTable(t), a)) < 1e-11 * norm(a), 'table row ' + i); });
  const r = {};
  for (const gm of ['measured', 'measured_sc']) {
    const B = K.bodyModel(K.bennuCase(), Object.assign(K.defaults(), { gm }));
    for (const m of ['pm', 'poly']) { r[gm + m] = K.orbitB(B, m); r[gm + m + 'none'] = K.orbitB(B, m, { sunlight: 'none' }); }
    const exact = K.orbitB(B, 'poly', { sunlight: viaK42 });
    close(exact.legDv_median_m_s, r[gm + 'poly'].legDv_median_m_s, 1e-7, 'table vs 42\'s kernel'); close(exact.arcEnd_m, r[gm + 'poly'].arcEnd_m, 0.05, 'arc');
  }
  const mm = (o) => o.legDv_median_m_s * 1000;
  close(mm(r.measured_scpoly), 0.0223, 0.0002, 'polyhedron, spacecraft-field GM: 2-h legs miss by 0.022 mm/s');
  close(mm(r.measured_scpm), 0.2521, 0.0005, 'point mass: 0.252 mm/s');
  close(mm(r.measuredpoly), 0.0427, 0.0002, 'polyhedron, particle-field GM'); close(mm(r.measuredpm), 0.2655, 0.0005, 'point mass, particle GM');
  close(mm(r.measured_scpolynone), 0.2480, 0.0005, 'polyhedron without sunlight: sunlight is the other half');
  close(r.measured_scpoly.arcEnd_m, 5.34, 0.05, '40-h arc, polyhedron'); close(r.measured_scpm.arcEnd_m, 33.77, 0.05, 'point mass');
  close(r.measuredpoly.arcEnd_m, 13.70, 0.05, 'particle GM, polyhedron'); close(r.measuredpm.arcEnd_m, 14.70, 0.05, 'point mass');
  // the reconstruction has an impulse in the 40-42 h leg: excluded, and visible
  const B = K.bodyModel(K.bennuCase(), Object.assign(K.defaults(), { gm: 'measured_sc' })), ti = K.tdbOfJd(ORB.jd[20]);
  const leg = K.fly(B, 'poly', ti, ORB.rel[20].slice(0, 3), ORB.rel[20].slice(3), 7200, { extra: (t) => K.sunlightTable(t) }), o = leg.out[1];
  assert.ok(norm(sub(o.v, ORB.rel[21].slice(3))) > 5 * r.measured_scpoly.legDv_max_m_s, 'the 40-42 h leg is an event: ' + norm(sub(o.v, ORB.rel[21].slice(3))));
});

test('the chain: idea 42\'s committed handoff passes 42\'s own parser and this import; the defaults, pinned', () => {
  const K42 = require('../42-closing-in/load.cjs').K;
  const p42 = K42.parseHandoff(sample42()); assert.ok(!p42.refusal, '42\'s own parser: ' + JSON.stringify(p42.refusal));
  assert.equal(src42.designation, '99942'); close(src42.epoch, 900182062.682, 0.001, 'stand-off epoch');
  const B = chain.B, s = chain.surface.stats;
  close(B.rho, 2025.344, 0.001, 'density GM / (G V)'); close(B.GM, 2.68, 0, 'GM as handed on'); close(B.att.period_h, 29.955, 0.001, 'instantaneous spin period');
  close(s.gravity.min, 8.1637e-5, 1e-9, 'gravity min'); close(s.gravity.max, 9.5781e-5, 1e-9, 'gravity max'); close(s.slope.mean, 14.723, 0.001, 'mean slope'); close(s.slope.max, 45.365, 0.001, 'max slope');
  close(s.steeper30, 0.04838, 0.00001, 'area steeper than 30 deg');
  const st = chain.site; assert.equal(st.face, 346); close(st.lat_deg, 46.645, 0.001, 'site lat'); close(st.lon_deg, -126.669, 0.001, 'site lon'); close(st.slope_deg, 7.126, 0.001, 'site slope');
  close(st.escape_up_m_s, 0.18554, 1e-5, 'escape straight up'); close(st.gravity_mag_m_s2, 9.5254e-5, 1e-9, 'site gravity');
  // the stand-off direction really crosses that plate
  assert.equal(K.rayFace(chain.P, chain.B.att.C.slice(0, 3).map((_, i) => dot(chain.B.att.C.slice(3 * i, 3 * i + 3), src42.standoff.r))), 346);
  assert.equal(K.codes(chain.own), K.codes([{ code: 'insufficient_data', applies_to: 'density' }, { code: 'insufficient_data', applies_to: 'inertia' }, { code: 'out_of_envelope', applies_to: 'equilibria' }, { code: 'insufficient_data', applies_to: 'resolution' }]));
  assert.equal(chain.carried.length, 10); assert.ok(chain.carried.some((r) => r.from === '42-closing-in' && r.applies_to === 'gravity_field'));
  // along Apophis's long axis a point mass is 6.8% off at the Brillouin sphere, 3.2% at twice it and 1.0% at four times
  const pe = K.pmErrors(chain); close(pe[0].relative_error, 0.06788, 0.00001, 'pm error at 1x'); close(pe[2].relative_error, 0.03249, 0.00001, 'at 2x'); close(pe[3].relative_error, 0.01026, 0.00001, 'at 4x');
});

test('refusals the inputs raise, and edited handoffs', () => {
  const run = (S, s = src42) => K.run(s, S);
  assert.equal(run({ gm: 'bogus' }).refusal.code, 'invalid_input');
  assert.equal(run({ gm: 'density', density_kg_m3: 100 }).refusal.code, 'invalid_input');
  assert.equal(run({ site: 99999 }).refusal.code, 'invalid_input');
  assert.equal(run({ gm: 'measured' }).refusal.applies_to, 'body_mass', 'Apophis has no measured mass');
  const lo = run({ gm: 'low' }), hi = run({ gm: 'high' });
  close(lo.B.GM, 1.36, 0, 'low'); close(hi.B.GM, 4.37, 0, 'high'); rclose(hi.surface.stats.gravity.max / lo.surface.stats.gravity.max, 4.37 / 1.36, 1e-9, 'gravity scales with GM');
  const dn = run({ gm: 'density', density_kg_m3: 2000 }); close(dn.B.GM, K.G_NEWTON * 2000 * dn.P.volume, 1e-15, 'GM from density');
  const late = Object.assign({}, src42, { epoch: K.attitudeData.apophis.egaTdb + 10 * DAY }); assert.equal(K.run(late, {}).refusal.applies_to, 'spin');
  const ryugu = Object.assign({}, src42, { designation: '162173', name: '162173 Ryugu' }); assert.equal(K.run(ryugu, {}).refusal.code, 'not_found');
  const edit = (f) => { const h = JSON.parse(JSON.stringify(sample42())); f(h); return K.importClosing(h); };
  assert.equal(edit((h) => { h.outputs.body.value.GM_m3_s2 = 3; }).refusal.code, 'invalid_input', 'GM edited');
  assert.equal(edit((h) => { h.outputs.body.value.radius_m = 200; }).refusal.code, 'invalid_input', 'radius edited');
  assert.match(edit((h) => { h.outputs.body.value.surface_gravity_m_s2 *= 1.01; }).refusal.reason, /surface gravity is not GM\/R\^2/, 'only the surface gravity edited');
  assert.match(edit((h) => { h.outputs.environment.value.gravity_at_standoff_m_s2 *= 1.01; }).refusal.reason, /gravity at the stand-off/, 'only the stand-off gravity edited');
  assert.equal(edit((h) => { h.outputs.standoff_state.value.r_m[0] += 500; }).refusal.code, 'invalid_input', 'stand-off moved');
  assert.equal(edit((h) => { h.refusals = h.refusals.filter((r) => r.applies_to !== 'gravity_field'); }).refusal.code, 'invalid_input', 'refusal dropped');
  assert.match(K.importClosing(JSON.parse(fs.readFileSync(path.join(HERE, '..', '41-signal', 'handoff.json'), 'utf8'))).refusal.what_would_help, /idea 42/);
  assert.equal(K.importClosing('{not json').refusal.code, 'invalid_input');
});

test('the handoff: the sample is what its inputs give; a round trip passes; edits are refused', () => {
  const h = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  assert.equal(h.from, '43-lumpy'); assert.deepEqual(h.inputs.closing_handoff, sample42());
  for (const [k, v] of Object.entries(h.outputs)) { assert.ok(v.units && v.confidence && v.source, k + ' lacks units/confidence/source'); }
  const p = K.parseHandoff(h); assert.ok(!p.refusal, JSON.stringify(p.refusal));
  const again = K.buildHandoff(chain, h.produced); assert.equal(JSON.stringify(again), JSON.stringify(h), 'the sample is this run');
  const t1 = JSON.parse(JSON.stringify(h)); t1.outputs.site.value.slope_deg += 1; assert.equal(K.parseHandoff(t1).refusal.code, 'invalid_input');
  const t2 = JSON.parse(JSON.stringify(h)); t2.outputs.body.value.density_kg_m3 *= 1.001; assert.equal(K.parseHandoff(t2).refusal.code, 'invalid_input');
  const t3 = JSON.parse(JSON.stringify(h)); t3.refusals.pop(); assert.equal(K.parseHandoff(t3).refusal.code, 'invalid_input');
  const hb = K.buildHandoff(bennu, '2026-10-31T12:00:00Z'), pb = K.parseHandoff(JSON.parse(JSON.stringify(hb)));
  assert.ok(!pb.refusal, 'Bennu round trip ' + JSON.stringify(pb.refusal)); assert.equal(hb.outputs.equilibria.value.points.length, 8);
  close(hb.outputs.orbit_b.value.polyhedron.leg_dv_median_m_s * 1000, 0.0427, 0.0002, 'handed on');
});

/** An icosphere of radius R subdivided n times (a test body with a known answer). */
function icosphere(n, R) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => v.map((c) => c / norm(v)));
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < n; k++) {
    const mid = {}, F2 = [];
    const m = (a, b) => { const key = Math.min(a, b) + ',' + Math.max(a, b); if (mid[key] === undefined) { const p = V[a].map((c, i) => c + V[b][i]); V.push(p.map((c) => c / norm(p))); mid[key] = V.length - 1; } return mid[key]; };
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = F2;
  }
  return { V: Float64Array.from(V.flat().map((c) => c * R)), F: Uint32Array.from(F.flat()), nv: V.length, nf: F.length };
}
