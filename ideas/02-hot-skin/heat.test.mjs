// Tests for Hot Skin. Run from the bank root: node --test ideas/02-hot-skin/heat.test.mjs
// Node built-ins only. Pins: PartForge's own ISA test vectors (tests/flight-eng.test.mjs:131-161
// at 0974a62), the evaluation's worked temperatures (docs/roadmap-evaluation.md:300-302), closed
// forms, hand-worked ISA arithmetic independent of isa(), limit cases, the snapshot's integrity
// against the sidecars and (when the checkout is present) against the repository itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { derive, contentDiff } from './build-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(here, 'snapshots', 'partforge.js'));
const H = require(path.join(here, 'heat.js'));
const ctx = H.create(S);
const REPO = '/home/user/Partforge';
const repoPresent = fs.existsSync(path.join(REPO, 'index.html')) && fs.existsSync(path.join(REPO, '.git'));
// index.html exactly as it was at the commit the snapshot records, read from git (not the working
// tree), so a later PartForge commit cannot move the lines under the verbatim comparison.
function recordedIndexHtml() {
  if (!repoPresent) return { skip: 'PartForge checkout not present at /home/user/Partforge' };
  const r = spawnSync('git', ['-C', REPO, 'show', `${S.provenance.commit}:index.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { skip: `commit ${S.provenance.commit} is not in the checkout (${(r.stderr || '').trim()})` };
  return { html: r.stdout };
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sidecar = (name) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', `${name}.provenance.json`), 'utf8'));
const C = (K) => K - 273.15;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg || ''} expected ${b} rel ${tol}, got ${a}`);

// ---------------------------------------------------------------------------------------------
// 1. The snapshot is what it says it is.
// ---------------------------------------------------------------------------------------------
test('snapshot: materials_thermal.json and fin.scad match their sidecars byte for byte', () => {
  for (const name of ['materials_thermal.json', 'fin.scad']) {
    const bytes = fs.readFileSync(path.join(here, 'snapshots', name));
    const sc = sidecar(name);
    assert.equal(sha256(bytes), sc.sourceSha256, `${name} sha256`);
    assert.equal(sha256(bytes), sc.writtenSha256, `${name} written sha256`);
    assert.equal(bytes.length, sc.sourceBytes);
    assert.equal(sc.readMatchesCommitted, true, `${name} was read from a clean checkout`);
  }
});

test('snapshot: partforge.js embeds the folder copies exactly and records their provenance', () => {
  const thermal = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'materials_thermal.json'), 'utf8'));
  assert.deepEqual(S.materialsThermal, thermal);
  assert.equal(S.materialsThermal.rows.length, 21);
  for (const r of S.materialsThermal.rows) assert.ok(['likely', 'recall'].includes(r.confidence), `${r.key} confidence ${r.confidence}`);
  const scad = fs.readFileSync(path.join(here, 'snapshots', 'fin.scad'), 'utf8').split('\n');
  const a = scad.findIndex((l) => l === '// FLIGHT-BEGIN'), b = scad.findIndex((l) => l === '// FLIGHT-END');
  const flight = JSON.parse(scad.slice(a + 1, b).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  assert.deepEqual(S.finTemplate.loads, flight.loads);
  assert.equal(S.finTemplate.material, flight.material);
  assert.equal(S.finTemplate.material, '6061-T6');
  assert.deepEqual(S.finTemplate.loads[0], { check: 'flutter', name: 'fin at max Q', root_mm: 300, tip_mm: 100, span_mm: 140, thick_mm: 6.35, v_max_m_s: 700, alt_m: 3000, sf_min: 1.5, inputs_src: 'default' });
  const p = S.provenance;
  assert.equal(p.materials_thermal.sourceSha256, sidecar('materials_thermal.json').sourceSha256);
  assert.equal(p.fin_scad.sourceSha256, sidecar('fin.scad').sourceSha256);
  const own = sidecar('partforge.js');
  assert.equal(own.path, 'index.html');
  assert.equal(own.commit, p.commit);
  assert.equal(own.sourceSha256, p.index_html.sha256, 'index.html sha256 in the module equals the sidecar');
  assert.equal(sha256(fs.readFileSync(path.join(here, 'snapshots', 'partforge.js'))), own.writtenSha256, 'partforge.js is the file the sidecar describes');
  assert.equal(Object.keys(S.materialsMeta).length, 21);
  for (const r of S.materialsThermal.rows) assert.ok(S.materialsMeta[r.key], `FLIGHT_MATERIALS has ${r.key}`);
});

test('snapshot: the verbatim ISA block equals index.html at the recorded commit (skipped when absent)', (t) => {
  const rec = recordedIndexHtml();
  if (rec.skip) return t.skip(rec.skip);
  const html = rec.html;
  assert.equal(sha256(Buffer.from(html, 'utf8')), S.provenance.index_html.sha256, 'git show gives the file the module records');
  const mod = fs.readFileSync(path.join(here, 'snapshots', 'partforge.js'), 'utf8');
  const m = /\/\/ ---- BEGIN verbatim index\.html (\d+)-(\d+) @ [0-9a-f]+ ----\n([\s\S]*?)\/\/ ---- END verbatim ----/.exec(mod);
  assert.ok(m, 'BEGIN/END markers present');
  const [first, last] = [Number(m[1]), Number(m[2])];
  const repoLines = html.split('\n').slice(first - 1, last).join('\n') + '\n';
  assert.equal(m[3], repoLines, `module text equals index.html lines ${first}-${last}`);
  assert.ok(repoLines.includes('const ISA_GAMMA = 1.4;'));
  assert.ok(repoLines.includes('function isa(alt_m, opts) {'));
  // And the repository's own isa, evaluated from its own text, agrees with the snapshot's to the bit.
  const E = new Function(`${repoLines} return isa;`)();
  for (let z = -5000; z <= 90000; z += 1234) {
    const a = E(z), b = S.isa(z);
    assert.deepEqual(b, a, `isa(${z})`);
  }
});

test('snapshot: build-data.mjs --check says the derived module is fresh (skipped when absent)', (t) => {
  if (!repoPresent) return t.skip('PartForge checkout not present');
  const r = spawnSync('node', [path.join(here, 'build-data.mjs'), REPO, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^fresh:/);
});

test('snapshot: the drift gate ignores edits outside the carried blocks and catches edits inside them', (t) => {
  const rec = recordedIndexHtml();
  if (rec.skip) return t.skip(rec.skip);
  const mod = fs.readFileSync(path.join(here, 'snapshots', 'partforge.js'), 'utf8');
  const src = { repo: S.provenance.repo, commit: S.provenance.commit, commitDate: S.provenance.commitDate };
  const same = derive(rec.html, src);
  assert.equal(same.out, mod, 'deriving from the recorded index.html is byte-identical');
  assert.deepEqual(contentDiff(mod, same), []);
  // A docs-style edit that moves every line number: not stale.
  const moved = derive('<!-- a later docs commit -->\n' + rec.html, { ...src, commit: 'f'.repeat(40) });
  assert.equal(moved.isa.firstLine, same.isa.firstLine + 1);
  assert.deepEqual(contentDiff(mod, moved), [], 'line moves and a new commit are not drift');
  // Edits inside what the module carries: stale, and named.
  assert.deepEqual(contentDiff(mod, derive(rec.html.replace('const ISA_GAMMA = 1.4;', 'const ISA_GAMMA = 1.41;'), src)), ['the verbatim ISA block']);
  const nm = S.materialsMeta['6061-T6'].name;
  assert.ok(rec.html.includes(`"${nm}"`) || rec.html.includes(`'${nm}'`), 'the 6061 name is quoted in index.html');
  const renamed = rec.html.replace(new RegExp(`(["'])${nm}\\1`), '$1Aluminium 6061-T6$1');
  assert.deepEqual(contentDiff(mod, derive(renamed, src)), ['the FLIGHT_MATERIALS {name, kind} map']);
});

// ---------------------------------------------------------------------------------------------
// 2. The repository's isa() reproduces the vectors its own test suite publishes
//    (tests/flight-eng.test.mjs:131-161 at 0974a62, tolerances as written there).
// ---------------------------------------------------------------------------------------------
test('isa(): PartForge’s published vectors, same tolerances', () => {
  const gp = { geopotential: true };
  const sl = S.isa(0);
  near(sl.T_K, 288.15, 1e-12, 'sea level T');
  near(sl.P_Pa, 101325, 1e-12, 'sea level P');
  rel(sl.a_m_s, 340.29, 1e-4, 'sea level a');
  near(S.isa(11000, gp).T_K, 216.65, 1e-9, '11 km geopotential T');
  rel(S.isa(11000, gp).P_Pa, 22632, 1e-3, '11 km geopotential P');
  rel(S.isa(20000, gp).P_Pa, 5474.9, 2e-3, '20 km geopotential P');
  rel(S.isa(30000, gp).P_Pa, S.ISA_BASE_P[2] * Math.pow(216.65 / 226.65, 9.80665 / (287.05287 * 0.001)), 1e-12, '30 km analytic');
  rel(S.isa(50000, gp).P_Pa, S.ISA_BASE_P[4] * Math.exp(-9.80665 * 3000 / (287.05287 * 270.65)), 1e-12, '50 km analytic');
  rel(S.isa(11000).T_K, 216.774, 1e-4, '11 km geometric T');
  rel(S.isa(11000).P_Pa, 22699, 1e-3, '11 km geometric P');
  rel(S.isa(20000).P_Pa, 5529.3, 1e-3, '20 km geometric P');
  rel(S.isa(30000).P_Pa, 1197, 5e-3, '30 km geometric P');
  rel(S.isa(50000).P_Pa, 79.8, 1e-2, '50 km geometric P');
  near(S.isa(50000).T_K, 270.65, 1e-9, '50 km geometric T');
  rel(S.isa(86000).T_K, 186.946, 1e-4, '86 km T');
  rel(S.isa(86000).P_Pa, 0.3734, 2e-3, '86 km P');
  assert.equal(S.isa(120000).clamped, true);
  rel(S.isa(120000).P_Pa, S.isa(86000).P_Pa, 1e-12, 'clamped P');
  assert.equal(S.isa(10000).clamped, false);
  rel(S.isa(11000, gp).a_m_s, Math.sqrt(1.4 * 287.05287 * 216.65), 1e-12, 'speed of sound formula');
  assert.equal(S.isa(-6000).clamped, true, 'below -5 km clamps');
});

// ---------------------------------------------------------------------------------------------
// 3. Constants and closed forms.
// ---------------------------------------------------------------------------------------------
test('gas constants: cp = γR/(γ−1) from the ISA constants; r from Pr = 0.71', () => {
  assert.equal(ctx.gas.gamma, 1.4);
  assert.equal(ctx.gas.R, 287.05287);
  near(ctx.gas.cp, 1004.685045, 1e-6, 'cp');
  assert.equal(ctx.gas.Pr, 0.71);
  near(ctx.gas.r_lam, 0.8426149773, 1e-9, 'r_lam = sqrt(0.71)');
  near(ctx.gas.r_turb, 0.8921121404, 1e-9, 'r_turb = cbrt(0.71)');
  assert.ok(ctx.gas.r_lam < ctx.gas.r_turb && ctx.gas.r_turb < 1, 'laminar < turbulent < stagnation');
});

test('identity: T0 − T∞ equals V²/2cp to 1e-9 relative over 300 random conditions', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 300; i++) {
    const v = rnd() * 2000, alt = rnd() * 80000;
    const h = H.aerotherm(ctx, v, alt);
    if (v > 1) rel(h.dT0_K, h.dT0_kinetic_K, 1e-9, `v ${v} alt ${alt}`);
    assert.ok(h.Tr_lam_K <= h.Tr_turb_K + 1e-12 && h.Tr_turb_K <= h.T0_K + 1e-12, 'ordering');
  }
});

test('hand-worked: 700 m/s at 3000 m from the 1976 standard’s formulas, independent of isa()', () => {
  // Geopotential H = r0 z/(r0 + z); troposphere T = 288.15 − 0.0065 H; a = sqrt(γ R T).
  const r0 = 6356766, z = 3000;
  const Hgp = r0 * z / (r0 + z);
  const T = 288.15 - 0.0065 * Hgp;
  const a = Math.sqrt(1.4 * 287.05287 * T);
  const M = 700 / a;
  const T0 = T * (1 + 0.2 * M * M);
  near(Hgp, 2998.58485, 1e-4, 'geopotential');
  near(T, 268.65920, 1e-4, 'T∞');
  near(a, 328.5836, 1e-3, 'a');
  const h = H.aerotherm(ctx, 700, 3000);
  near(h.T_inf_K, T, 1e-9, 'model T∞');
  near(h.M, M, 1e-12, 'model M');
  near(h.T0_K, T0, 1e-9, 'model T0');
  near(C(h.T0_K), 239.37, 0.01, 'T0 in °C');
  near(h.T0_K - h.T_inf_K, 700 * 700 / (2 * 1004.685045), 1e-6, 'ΔT0 = V²/2cp');
});

test('limit cases: V = 0 gives T0 = T∞; M = 1 at sea level gives T0 = 1.2 T∞ = 72.63 °C', () => {
  const z = H.aerotherm(ctx, 0, 3000);
  assert.equal(z.M, 0);
  assert.equal(z.T0_K, z.T_inf_K);
  assert.equal(z.Tr_turb_K, z.T_inf_K);
  const a0 = S.isa(0).a_m_s;
  const s = H.aerotherm(ctx, a0, 0);
  near(s.M, 1, 1e-12, 'M = 1');
  near(s.T0_K, 288.15 * 1.2, 1e-9, 'T0 = 1.2 T∞');
  near(C(s.T0_K), 72.63, 0.005, '72.63 °C');
});

test('closed form: speedAtLimit round-trips through aerotherm; null when the air is already hotter than the limit or the crossing is past the ceiling', () => {
  for (const [smc, alt] of [[170, 3000], [90, 0], [800, 20000], [1200, 40000], [130, 11000]]) {
    const L = H.speedAtLimit(ctx, smc, alt);
    near(C(H.aerotherm(ctx, L.T0_m_s, alt).T0_K), smc, 1e-9, `T0 limit ${smc} @ ${alt}`);
    near(C(H.aerotherm(ctx, L.turb_m_s, alt).Tr_turb_K), smc, 1e-9, `turb limit ${smc} @ ${alt}`);
    near(C(H.aerotherm(ctx, L.lam_m_s, alt).Tr_lam_K), smc, 1e-9, `lam limit ${smc} @ ${alt}`);
    assert.ok(L.T0_m_s < L.turb_m_s && L.turb_m_s < L.lam_m_s, 'the stagnation bound is reached first');
  }
  const L = H.speedAtLimit(ctx, 170, 3000);
  near(L.T0_m_s, 592.13, 0.01, 'T0 reaches 170 °C at 3000 m');
  near(L.turb_m_s, 626.91, 0.01, 'turbulent recovery reaches 170 °C at 3000 m');
  const hot = H.speedAtLimit(ctx, -10, 0); // −10 °C limit, 15 °C air
  assert.equal(hot.T0_m_s, null);
  assert.equal(hot.turb_m_s, null);
  assert.equal(hot.air_hotter, true);
  // Graphite's 2,000 °C at 3 km: by hand the T0 crossing is √(2 × 1004.685045 × (2273.15 − 268.6592)) =
  // 2,007 m/s, past the 1,865.18 m/s at which T0 reaches the 2,000 K ceiling, so no crossing is named.
  const g = H.speedAtLimit(ctx, 2000, 3000);
  assert.ok(Math.sqrt(2 * 1004.685045 * (2273.15 - 268.6592)) > 2000, 'the raw crossing is past 2,000 m/s');
  assert.equal(g.T0_m_s, null);
  assert.equal(g.turb_m_s, null);
  assert.equal(g.lam_m_s, null);
  assert.equal(g.air_hotter, false, 'null because of the ceiling, not because the air is hot');
  near(g.ceiling_m_s, 1865.18, 0.01, 'ceiling speed carried');
  // Every crossing any material shows, at any condition the page computes, is under the ceiling speed.
  for (const row of S.materialsThermal.rows) {
    for (const [alt, dT] of [[0, 0], [3000, 0], [3000, 50], [25000, -90], [85999, 0]]) {
      const L = H.speedAtLimit(ctx, row.service_max_c, alt, dT);
      for (const k of ['T0_m_s', 'turb_m_s', 'lam_m_s']) {
        if (L[k] == null) continue;
        assert.ok(L[k] <= H.ceilingSpeed(ctx, alt, dT), `${row.key} ${k} at ${alt} m, ΔT ${dT}: ${L[k]} is under the ceiling speed`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 4. The evaluation's worked numbers (docs/roadmap-evaluation.md:300-302 and :559-568).
// ---------------------------------------------------------------------------------------------
test('evaluation: Mach 2 at 3 km reads ~210 °C; the same Mach at 25 km reads 125.6 °C, over 80 °C lower', () => {
  const ex = H.machExample(ctx, 2, [3000, 25000]);
  near(ex[0].T0_C, 210.44, 0.01, 'Mach 2 at 3000 m');
  near(ex[0].v_m_s, 657.17, 0.01, 'that is 657 m/s');
  near(ex[1].T0_C, 125.64, 0.01, 'Mach 2 at 25 km');
  assert.ok(ex[0].T0_C - ex[1].T0_C > 80, 'the unsafe-low read exceeds 80 °C');
  // The evaluation's "~128 °C at apogee" is Mach 2 near 26.3 km geometric by the same isa().
  near(H.machExample(ctx, 2, [26300])[0].T0_C, 127.96, 0.01, 'Mach 2 at 26.3 km');
});

test('fin template: 700 m/s at 3000 m in 6061-T6 (service_max_c 170, likely)', () => {
  const l = S.finTemplate.loads[0];
  const r = H.screen(ctx, { v_m_s: l.v_max_m_s, alt_m: l.alt_m, material: S.finTemplate.material, inputs_src: l.inputs_src });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'SCREEN');
  near(r.M, 2.130, 0.0005, 'Mach');
  near(r.T_inf_C, -4.49, 0.005, 'T∞');
  near(r.T0_C, 239.37, 0.005, 'T0');
  near(r.Tr_turb_C, 213.06, 0.005, 'T_r turbulent');
  near(r.Tr_lam_C, 200.99, 0.005, 'T_r laminar');
  assert.equal(r.material.service_max_c, 170);
  assert.equal(r.material.confidence, 'likely');
  assert.equal(r.material.name, 'Aluminum 6061-T6');
  assert.equal(r.material.kind, 'metal');
  near(r.margin_T0_C, 170 - 239.37, 0.005, 'margin vs T0');
  near(r.margin_turb_C, 170 - 213.06, 0.005, 'margin vs turbulent recovery');
  near(r.margin_lam_C, 170 - 200.99, 0.005, 'margin vs laminar recovery');
  assert.equal(r.band, 'over');
  assert.ok(r.flags.some((f) => f.code === 'provisional'), 'inputs_src default is flagged');
  assert.ok(r.flags.some((f) => f.code === 'bound'), 'the bound caveat is always present');
  const bound = r.flags.find((f) => f.code === 'bound').text;
  assert.match(bound, /air alone/, 'the bound is for aerodynamic heating only');
  assert.match(bound, /ISA standard day/, 'and names the atmosphere');
  assert.match(bound, /Sun soak/, 'and names what it leaves out');
  // V is airspeed: 10 m/s of headwind at 700 m/s is (710² − 700²)/(2 × 1004.685045) = 7.017 K, by hand.
  assert.match(bound, /airspeed, relative to the air/, 'and says the speed is airspeed');
  near(r.headwind10_K, (710 * 710 - 700 * 700) / (2 * 1004.685045), 1e-9, 'headwind sensitivity');
  near(r.headwind10_K, 7.017, 0.001, '7.0 K per 10 m/s at 700 m/s');
  assert.match(bound, /7\.0 K per 10 m\/s of headwind/);
  assert.ok(r.flags.some((f) => f.code === 'standard_day'), 'the standard-day caveat is present when no offset is given');
  assert.ok(r.flags.some((f) => f.code === 'likely'), 'row confidence printed');
  assert.ok(!r.flags.some((f) => f.code === 'hot'), 'T0 512 K is not flagged hot');
  near(r.limitSpeed.turb_m_s, 626.91, 0.01, 'the turbulent bound reaches 170 °C at 627 m/s');
  near(r.limitSpeed.T0_m_s, 592.13, 0.01, 'the stagnation bound reaches 170 °C at 592 m/s');
});

test('inputs_src: PartForge’s rule (index.html:4738-4740): user and cited source clear the flag; source without a reference is demoted', () => {
  const at = (extra) => H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', ...extra });
  const codes = (r) => r.flags.map((f) => f.code);
  // user: the engineer declared it.
  const u = at({ inputs_src: 'user' });
  assert.equal(u.inputs.inputs_src, 'user');
  assert.ok(!codes(u).includes('provisional') && !codes(u).includes('demoted'), 'a user-declared speed is not provisional');
  // source with a citation: kept, and the citation is carried (whitespace collapsed, cut to 140).
  const c = at({ inputs_src: 'source', inputs_ref: '  OpenRocket   sim,\nrun 3 ' });
  assert.equal(c.inputs.inputs_src, 'source');
  assert.equal(c.inputs.inputs_ref, 'OpenRocket sim, run 3');
  assert.ok(!codes(c).includes('provisional') && !codes(c).includes('demoted'));
  assert.equal(at({ inputs_src: 'source', inputs_ref: 'x'.repeat(300) }).inputs.inputs_ref.length, 140);
  // source with no citation, an empty one or a blank one: demoted to default, flagged both ways.
  for (const ref of [undefined, '', '   ', 42]) {
    const d = at({ inputs_src: 'source', inputs_ref: ref });
    assert.equal(d.inputs.inputs_src, 'default', `ref ${JSON.stringify(ref)}`);
    assert.equal(d.inputs.demoted, true);
    assert.ok(codes(d).includes('demoted') && codes(d).includes('provisional'));
  }
  // default, a missing word and any other word: default, provisional, not demoted.
  for (const src of ['default', undefined, 'guess', 'Source']) {
    const d = at({ inputs_src: src });
    assert.equal(d.inputs.inputs_src, 'default', `src ${src}`);
    assert.ok(codes(d).includes('provisional') && !codes(d).includes('demoted'));
  }
  // A citation given with any other source word is not carried.
  assert.equal(at({ inputs_src: 'user', inputs_ref: 'sim' }).inputs.inputs_ref, '');
});

// ---------------------------------------------------------------------------------------------
// 5. Refusals.
// ---------------------------------------------------------------------------------------------
test('refusal: a bare Mach number, with the two-altitude example', () => {
  for (const input of [{ mach: 2, alt_m: 3000, material: '6061-T6' }, { M: 2, alt_m: 3000, material: '6061-T6' }, { mach: '2', v_m_s: 700, alt_m: 3000, material: '6061-T6' }]) {
    const r = H.screen(ctx, input);
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'REFUSED');
    assert.equal(r.refusal.code, 'invalid_input');
    assert.match(r.refusal.reason, /V²\/2cp/);
    assert.match(r.refusal.what_would_help, /v_max_m_s/);
    assert.equal(r.refusal.example.length, 2);
    near(r.refusal.example[0].T0_C, 210.44, 0.01);
    near(r.refusal.example[1].T0_C, 125.64, 0.01);
    assert.equal(r.T0_C, undefined, 'no number escapes a refusal');
  }
  // A Mach number that is not a positive number still gets the worked example, at Mach 2, with the reason.
  for (const m of ['two', 0, -3]) {
    const r = H.screen(ctx, { mach: m, alt_m: 0, material: '6061-T6' });
    assert.equal(r.refusal.example_mach, 2, `mach ${m}`);
    assert.match(r.refusal.example_note, /not a positive number/);
    near(r.refusal.example[0].T0_C, 210.44, 0.01);
  }
  // The reason states the gap as a formula and the Mach 2 figure, not a vague "tens of degrees".
  assert.match(H.screen(ctx, { mach: 2 }).refusal.reason, /84\.8 °C at Mach 2 between 3000 m and 25000 m/);
  assert.doesNotMatch(H.screen(ctx, { mach: 10 }).refusal.reason, /tens of degrees/);
  // The reason's figure is the Mach 2 gap even when the example works the typed Mach: at Mach 5.67 the
  // example's own gap is (268.659 − 221.552) × (1 + 0.2 × 5.67²) = 350.0 °C, and that belongs only to the example.
  const typed = H.screen(ctx, { mach: 5.67 }).refusal;
  assert.equal(typed.example_mach, 5.67);
  const ownGap = typed.example[0].T0_C - typed.example[1].T0_C;
  near(ownGap, 350.0, 0.05, 'the Mach 5.67 example’s own gap');
  assert.match(typed.reason, /84\.8 °C at Mach 2 between 3000 m and 25000 m/);
  assert.ok(!typed.reason.includes(ownGap.toFixed(1)), 'the example’s own gap is not in the reason');
});

test('refusal: the Mach example never shows a temperature past the 2,000 K ceiling', () => {
  // The largest Mach the example can show is set by 3,000 m: ceiling speed 1,865.18 m/s over a = 328.58 m/s.
  near(H.machCeiling(ctx, H.MACH_EXAMPLE_ALTS), 1865.18 / 328.5836, 1e-4, 'Mach 5.68 at 3 km');
  const allT0 = (r) => JSON.stringify(r).match(/"T0_C":(-?[\d.e+]+)/g)?.map((x) => Number(x.split(':')[1])) || [];
  for (const dT of [0, 50, -90]) {
    for (const m of [5.67, 5.7, 6.5, 10, 700, 99999, 1e300]) {
      const r = H.screen(ctx, { mach: m, alt_m: 3000, material: '6061-T6', isa_offset_K: dT });
      assert.equal(r.ok, false);
      for (const x of r.refusal.example) {
        assert.equal(x.over_ceiling, false, `mach ${m} ΔT ${dT}: every row shown is under the ceiling`);
        assert.ok(x.T0_C + 273.15 <= 2000 + 1e-9, `mach ${m} ΔT ${dT}: example T0 ${x.T0_C} °C is under 2,000 K`);
      }
      for (const T of allT0(r)) assert.ok(T + 273.15 <= 2000 + 1e-9, `no T0 past the ceiling anywhere in the result (${T})`);
      const shown = m <= H.machCeiling(ctx, H.MACH_EXAMPLE_ALTS, dT);
      assert.equal(r.refusal.example_mach, shown ? m : 2, `mach ${m} ΔT ${dT}`);
      if (!shown) assert.match(r.refusal.example_note, /2000 K ceiling/);
    }
  }
  // The building block refuses on its own: a row past the ceiling carries no speed and no temperature.
  const raw = H.machExample(ctx, 10, [3000, 25000]);
  for (const x of raw) { assert.equal(x.over_ceiling, true); assert.equal(x.T0_C, null); assert.equal(x.v_m_s, null); }
  // Mach 6 is past the ceiling at 3 km (5.68) but not at 25 km (6.34): the row that fits still computes.
  const six = H.machExample(ctx, 6, [3000, 25000]);
  assert.equal(six[0].over_ceiling, true);
  assert.equal(six[1].over_ceiling, false);
  assert.ok(six[1].T0_C + 273.15 < 2000);
});

test('refusal: unknown or missing material lists the 21 keys', () => {
  for (const material of ['Unobtainium', undefined, null, '']) {
    const r = H.screen(ctx, { v_m_s: 300, alt_m: 0, material });
    assert.equal(r.ok, false);
    assert.equal(r.refusal.code, 'not_found');
    assert.equal(r.refusal.keys.length, 21);
    assert.match(r.refusal.what_would_help, /6061-T6/);
  }
});

test('refusal: a row without service_max_c (no shipped row lacks one today; synthetic row)', () => {
  const rows = S.materialsThermal.rows.map((r) => (r.key === 'Graphite' ? { ...r, service_max_c: null } : r));
  const ctx2 = H.create({ ...S, materialsThermal: { ...S.materialsThermal, rows } });
  const r = H.screen(ctx2, { v_m_s: 700, alt_m: 3000, material: 'Graphite' });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, 'insufficient_data');
  assert.match(r.refusal.reason, /no service_max_c/);
  const tbl = H.table(ctx2, 700, 3000);
  const g = tbl.rows.find((x) => x.key === 'Graphite');
  assert.equal(g.refusal.code, 'insufficient_data');
  assert.equal(g.margin_T0_C, undefined);
  assert.equal(tbl.rows.filter((x) => x.refusal).length, 1);
  // Every shipped row has a finite limit, so the shipped table never takes this branch.
  for (const row of S.materialsThermal.rows) assert.ok(Number.isFinite(row.service_max_c), row.key);
});

test('refusal: altitudes the ISA clamps are out of envelope, not numbers', () => {
  for (const alt of [86001, 90000, 120000, -5001, -6000]) {
    const r = H.screen(ctx, { v_m_s: 700, alt_m: alt, material: '6061-T6' });
    assert.equal(r.ok, false, `alt ${alt}`);
    assert.equal(r.refusal.code, 'out_of_envelope');
    assert.ok(Number.isFinite(r.refusal.clamped_to_m));
    const t = H.table(ctx, 700, alt);
    assert.equal(t.ok, false);
    assert.equal(t.rows.length, 0);
  }
  // ISA_H_MAX is 84,852 m geopotential, which is 85,999.95 m geometric: isa(86000) itself reports clamped.
  assert.equal(H.screen(ctx, { v_m_s: 700, alt_m: 85999, material: '6061-T6' }).ok, true, '85,999 m is inside');
  assert.equal(S.isa(86000).clamped, true, '86,000 m geometric is 5 cm above the table top');
  // The floor is −5,000 m geopotential, which is about −4,996 m geometric; −4,990 m is inside.
  assert.equal(H.screen(ctx, { v_m_s: 700, alt_m: -4990, material: '6061-T6' }).ok, true, '-4,990 m is inside');
});

test('refusal: a speed at which the perfect-gas T0 would pass the 2,000 K ceiling is out of envelope, not a number', () => {
  assert.equal(H.T0_MAX_K, 2000);
  // Closed form at sea level, by hand: V = sqrt(2 cp (2000 − 288.15)) = sqrt(2 × 1004.685045 × 1711.85).
  near(H.ceilingSpeed(ctx, 0), Math.sqrt(2 * 1004.685045 * 1711.85), 1e-6, 'sea-level ceiling speed');
  near(H.ceilingSpeed(ctx, 0), 1854.65, 0.01, 'about 1,855 m/s at sea level');
  near(H.ceilingSpeed(ctx, 3000), 1865.18, 0.01, 'about 1,865 m/s at 3,000 m');
  near(H.ceilingSpeed(ctx, 85999), 1908.69, 0.01, 'about 1,909 m/s at the top of the table');
  for (const alt of [0, 3000, 11000, 25000, 40000, 60000, 85999]) {
    const vc = H.ceilingSpeed(ctx, alt);
    near(H.aerotherm(ctx, vc, alt).T0_K, 2000, 1e-9, `T0 at the ceiling speed, ${alt} m`);
    const under = H.screen(ctx, { v_m_s: vc - 0.01, alt_m: alt, material: 'Graphite', inputs_src: 'user' });
    assert.equal(under.ok, true, `just under the ceiling at ${alt} m computes`);
    assert.ok(under.flags.some((f) => f.code === 'hot' && /2000 K ceiling/.test(f.text)), 'and carries the hot flag naming the ceiling');
    const over = H.screen(ctx, { v_m_s: vc + 0.01, alt_m: alt, material: 'Graphite', inputs_src: 'user' });
    assert.equal(over.ok, false, `just over the ceiling at ${alt} m refuses`);
    assert.equal(over.refusal.code, 'out_of_envelope');
  }
  // The inputs that froze the page before the ceiling existed: refused, with no temperature anywhere in the result.
  for (const v of [2000, 1e6, 1e7, 99999999, 1e300]) {
    const r = H.screen(ctx, { v_m_s: v, alt_m: 3000, material: '6061-T6' });
    assert.equal(r.ok, false, `v ${v}`);
    assert.equal(r.verdict, 'REFUSED');
    assert.equal(r.refusal.code, 'out_of_envelope');
    assert.match(r.refusal.reason, /2000 K/);
    assert.match(r.refusal.reason, /no temperature is printed/);
    assert.match(r.refusal.what_would_help, /Stay below 1865\.1 m\/s/);
    assert.match(r.refusal.what_would_help, /does not apply/);
    assert.equal(r.refusal.ceiling_K, 2000);
    near(r.refusal.ceiling_speed_m_s, 1865.18, 0.01);
    assert.equal(r.T0_C, undefined);
    assert.equal(r.T0_K, undefined);
    assert.ok(!/T0_[CK]|Tr_/.test(JSON.stringify(r)), 'no temperature key escapes');
    const t = H.table(ctx, v, 3000);
    assert.equal(t.ok, false);
    assert.equal(t.refusal.code, 'out_of_envelope');
    assert.equal(t.rows.length, 0);
  }
  // The printed "stay below" figure is rounded down, so it is itself a speed the page computes.
  for (const alt of [0, 3000, 25000]) {
    const r = H.screen(ctx, { v_m_s: 5000, alt_m: alt, material: '6061-T6' });
    const vs = Number(/Stay below ([\d.]+) m\/s/.exec(r.refusal.what_would_help)[1]);
    assert.ok(vs <= H.ceilingSpeed(ctx, alt) && H.ceilingSpeed(ctx, alt) - vs < 0.1, `stay-below at ${alt} m`);
    assert.equal(H.screen(ctx, { v_m_s: vs, alt_m: alt, material: '6061-T6' }).ok, true);
  }
  assert.match(H.screen(ctx, { v_m_s: 1900, alt_m: 0, material: '6061-T6' }).refusal.what_would_help, /^Stay below 1854\.6 m\/s/);
  // The envelope is checked before the material, so a bad material above the ceiling reports the ceiling.
  assert.equal(H.screen(ctx, { v_m_s: 5000, alt_m: 0, material: 'Unobtainium' }).refusal.code, 'out_of_envelope');
  // The page's slider stops at 1,500 m/s, which is under the ceiling at every altitude in the table.
  for (const alt of [-4990, 0, 3000, 20000, 40000, 85999]) assert.ok(H.aerotherm(ctx, 1500, alt).T0_K < 2000 - 500, `1500 m/s at ${alt} m is well under the ceiling`);
});

test('refusal: non-finite or negative speed and non-finite altitude', () => {
  for (const v of [-1, NaN, Infinity, 'fast', undefined, null, {}]) {
    const r = H.screen(ctx, { v_m_s: v, alt_m: 3000, material: '6061-T6' });
    assert.equal(r.ok, false, `v ${String(v)}`);
    assert.equal(r.refusal.code, 'invalid_input');
  }
  for (const alt of [NaN, 'high', undefined, Infinity]) {
    const r = H.screen(ctx, { v_m_s: 700, alt_m: alt, material: '6061-T6' });
    assert.equal(r.ok, false, `alt ${String(alt)}`);
    assert.equal(r.refusal.code, 'invalid_input');
  }
  assert.equal(H.screen(ctx, { v_m_s: '700', alt_m: '3000', material: '6061-T6' }).ok, true, 'numeric strings are accepted');
  assert.equal(H.screen(ctx, { v_m_s: 0, alt_m: 0, material: '6061-T6' }).ok, true, 'zero speed is a valid condition');
  const t = H.table(ctx, 'fast', 3000);
  assert.equal(t.ok, false);
  assert.equal(t.refusal.code, 'invalid_input');
});

// ---------------------------------------------------------------------------------------------
// 5b. The day: an ISA offset ΔT moves every bound by exactly ΔT at a fixed speed.
// ---------------------------------------------------------------------------------------------
test('ISA offset: T0, both recovery temperatures and every margin shift by exactly ΔT; Mach does not stay put', () => {
  const base = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', inputs_src: 'user' });
  for (const dT of [-90, -20, 11, 20, 35.5, 50]) {
    const r = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', inputs_src: 'user', isa_offset_K: dT });
    assert.equal(r.ok, true, `ΔT ${dT}`);
    near(r.T_inf_K - base.T_inf_K, dT, 1e-9, 'T∞');
    near(r.T0_K - base.T0_K, dT, 1e-9, 'T0');
    near(r.Tr_turb_K - base.Tr_turb_K, dT, 1e-9, 'Tr turbulent');
    near(r.Tr_lam_K - base.Tr_lam_K, dT, 1e-9, 'Tr laminar');
    near(r.margin_T0_C - base.margin_T0_C, -dT, 1e-9, 'margin vs T0');
    near(r.margin_turb_C - base.margin_turb_C, -dT, 1e-9, 'margin vs Tr turbulent');
    near(r.margin_lam_C - base.margin_lam_C, -dT, 1e-9, 'margin vs Tr laminar');
    near(r.a_m_s, Math.sqrt(1.4 * 287.05287 * (268.6592 + dT)), 1e-3, 'a from the offset T∞');
    near(r.T0_K - r.T_inf_K, 700 * 700 / (2 * 1004.685045), 1e-9, 'ΔT0 is still V²/2cp');
    assert.equal(r.T_isa_K, base.T_inf_K, 'isa() itself is untouched');
    if (dT > 0) assert.ok(r.M < base.M, 'warmer air, faster sound, lower Mach');
    near(C(H.aerotherm(ctx, r.limitSpeed.T0_m_s, 3000, dT).T0_K), 170, 1e-9, 'limit speed on the offset day');
    near(H.ceilingSpeed(ctx, 3000, dT), Math.sqrt(2 * 1004.685045 * (2000 - 268.6592 - dT)), 1e-3, 'ceiling speed on the offset day');
    assert.ok(r.flags.some((f) => f.code === 'offset') && !r.flags.some((f) => f.code === 'standard_day'));
    const t = H.table(ctx, 700, 3000, dT), t0 = H.table(ctx, 700, 3000);
    t.rows.forEach((row, i) => near(row.margin_turb_C - t0.rows[i].margin_turb_C, -dT, 1e-9, `${row.key} table margin`));
  }
  // The standard day says so, with the offset at which the margin vs T0 is gone.
  const peek = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: 'PEEK', inputs_src: 'user' });
  assert.equal(peek.band, 'near');
  near(peek.margin_T0_C, 10.63, 0.01);
  near(peek.offsetAtLimit.T0_K, peek.margin_T0_C, 1e-12);
  const sd = peek.flags.find((f) => f.code === 'standard_day');
  assert.ok(sd && /ISA\+10\.6 K/.test(sd.text), 'the standard-day flag names ISA+10.6 K for PEEK');
  // The reviewer’s hot-day arithmetic: ISA+11 turns PEEK from near to stagnation (−0.4), ISA+20 to −9.4.
  const p11 = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: 'PEEK', inputs_src: 'user', isa_offset_K: 11 });
  assert.equal(p11.band, 'stagnation');
  near(p11.margin_T0_C, -0.37, 0.01);
  near(H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: 'PEEK', inputs_src: 'user', isa_offset_K: 20 }).margin_T0_C, -9.37, 0.01);
  // At the offset the flag names, the margin vs T0 is zero.
  near(H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: 'PEEK', isa_offset_K: peek.offsetAtLimit.T0_K }).margin_T0_C, 0, 1e-9);
  // Numeric strings are read as numbers; '0' is the standard day.
  assert.equal(H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: 'PEEK', isa_offset_K: '0' }).dT_K, 0);
  assert.equal(H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: 'PEEK', isa_offset_K: '20' }).dT_K, 20);
});

test('the day where T0 meets the limit is named only inside the band the page accepts', () => {
  const sc = (extra) => H.screen(ctx, { inputs_src: 'user', ...extra });
  const text = (r) => r.flags.map((f) => f.text).join(' ');
  // 304 at the fin condition: ΔT + margin would be ISA+560.6 K, a day the page refuses as input.
  const s304 = sc({ v_m_s: 700, alt_m: 3000, material: '304' });
  near(s304.margin_T0_C, 560.63, 0.01, '304 margin vs T0');
  assert.equal(s304.offsetAtLimit.T0_K, null);
  assert.equal(s304.offsetAtLimit.status, 'under_every_day');
  assert.match(s304.offsetAtLimit.reason, /under it on every day from ISA−90\.0 K to ISA\+50\.0 K/);
  assert.ok(!/560\.6 K/.test(text(s304)), 'no ISA+560.6 K day in the flags');
  assert.match(s304.flags.find((f) => f.code === 'standard_day').text, /No day this page accepts brings T0 to the limit/);
  // 6061-T6 at 1,500 m/s and 3 km: ΔT + margin would be ISA−945.3 K, a free stream at −676.6 K.
  for (const dT of [0, 20]) {
    const r = sc({ v_m_s: 1500, alt_m: 3000, material: '6061-T6', isa_offset_K: dT });
    near(r.margin_T0_C, -945.3 - dT, 0.05, `6061-T6 margin at 1,500 m/s, ΔT ${dT}`);
    assert.ok(r.T_isa_K + dT + r.margin_T0_C < 0, 'the algebraic day would put T∞ below absolute zero');
    assert.equal(r.offsetAtLimit.T0_K, null);
    assert.equal(r.offsetAtLimit.status, 'over_every_day');
    assert.match(text(r), /the bound is over it on every day from ISA−90\.0 K to ISA\+50\.0 K/);
    assert.ok(!/945\.3|965\.3/.test(text(r)), 'no ISA−945 K day anywhere');
  }
  // PA12 at 1,000 m/s at sea level (ISA−362.7 K) and Delrin at rest (ISA+94.5 K): not days either.
  assert.equal(sc({ v_m_s: 1000, alt_m: 0, material: 'PA12-SLS' }).offsetAtLimit.status, 'over_every_day');
  assert.equal(sc({ v_m_s: 0, alt_m: 3000, material: 'Delrin-POM' }).offsetAtLimit.status, 'under_every_day');
  // Inside the band the day is named: 6061-T6 at the fin condition comes under the limit only below ISA−69.4 K.
  const fin = sc({ v_m_s: 700, alt_m: 3000, material: '6061-T6' });
  near(fin.offsetAtLimit.T0_K, -69.37, 0.01);
  assert.match(fin.flags.find((f) => f.code === 'standard_day').text, /only on a day colder than ISA−69\.4 K/);
  // Near the ceiling the hottest day the page computes is the one where T0 reaches 2,000 K: Graphite at
  // 1,865 m/s and 3 km has T0 1,999.66 K, so the band it can speak for ends at ISA+0.3 K.
  const gr = sc({ v_m_s: 1865, alt_m: 3000, material: 'Graphite' });
  assert.equal(gr.offsetAtLimit.T0_K, null);
  assert.equal(gr.offsetAtLimit.ceiling_limited, true);
  near(gr.offsetAtLimit.max_K, 2000 - gr.T0_K, 1e-9);
  assert.match(gr.offsetAtLimit.reason, /ISA\+0\.3 K \(on a warmer day T0 passes the 2000 K ceiling/);
  // A scan: 21 materials, six speeds, five altitudes, five days. Every day the model names is inside the
  // band, leaves T∞ above absolute zero and T0 under the ceiling, and brings the T0 margin to zero there;
  // every "none" is borne out at both ends of the band; no ISA offset printed in a flag lies outside it.
  let named = 0, none = 0;
  for (const row of S.materialsThermal.rows) {
    for (const v of [0, 300, 700, 1000, 1500, 1800]) {
      for (const alt of [-4990, 0, 3000, 25000, 85999]) {
        for (const dT of [-90, -20, 0, 20, 50]) {
          const r = sc({ v_m_s: v, alt_m: alt, material: row.key, isa_offset_K: dT });
          if (!r.ok) continue;
          const o = r.offsetAtLimit;
          for (const m of text(r).matchAll(/ISA([+−])(\d+\.\d) K/g)) {
            const x = (m[1] === '−' ? -1 : 1) * Number(m[2]);
            assert.ok(x >= H.ISA_DT_MIN_K && x <= H.ISA_DT_MAX_K, `${row.key} ${v} m/s ${alt} m ΔT ${dT}: printed ISA${m[1]}${m[2]} K is in the band`);
          }
          if (o.T0_K !== null) {
            named++;
            assert.ok(o.T0_K >= H.ISA_DT_MIN_K && o.T0_K <= H.ISA_DT_MAX_K, 'named day in the band');
            assert.ok(r.T_isa_K + o.T0_K > 0, 'named day leaves T∞ above 0 K');
            const at = sc({ v_m_s: v, alt_m: alt, material: row.key, isa_offset_K: o.T0_K });
            assert.equal(at.ok, true, 'the named day computes');
            near(at.margin_T0_C, 0, 1e-9, 'and the T0 margin is zero on it');
          } else {
            none++;
            const lo = sc({ v_m_s: v, alt_m: alt, material: row.key, isa_offset_K: o.min_K });
            const hi = sc({ v_m_s: v, alt_m: alt, material: row.key, isa_offset_K: Math.min(o.max_K, H.ISA_DT_MAX_K) });
            assert.equal(lo.ok && hi.ok, true, 'both ends of the band it speaks for compute');
            const sign = o.status === 'under_every_day' ? 1 : -1;
            assert.ok(sign * lo.margin_T0_C > 0 && sign * hi.margin_T0_C >= 0, `${row.key} ${v} m/s ${alt} m ΔT ${dT}: ${o.status} holds at both ends`);
          }
        }
      }
    }
  }
  assert.ok(named > 100 && none > 1000, `both branches are exercised (${named} named, ${none} none)`);
});

test('ISA offset: outside −90 to +50 K is out_of_envelope; unreadable is invalid_input; no temperature either way', () => {
  for (const dT of [-91, 50.01, 120, -300]) {
    const r = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', isa_offset_K: dT });
    assert.equal(r.ok, false, `ΔT ${dT}`);
    assert.equal(r.refusal.code, 'out_of_envelope');
    assert.match(r.refusal.what_would_help, /ISA\+20 K/);
    assert.ok(!/T0_[CK]|Tr_/.test(JSON.stringify(r)));
    assert.equal(H.table(ctx, 700, 3000, dT).rows.length, 0);
  }
  for (const dT of ['hot', NaN, Infinity, {}]) {
    const r = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', isa_offset_K: dT });
    assert.equal(r.refusal.code, 'invalid_input', `ΔT ${String(dT)}`);
  }
  // The band's edges compute.
  for (const dT of [H.ISA_DT_MIN_K, H.ISA_DT_MAX_K]) assert.equal(H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', isa_offset_K: dT }).ok, true);
  // A hot day lowers the ceiling speed: 1,865 m/s at 3 km computes on a standard day and is refused at ISA+50.
  assert.equal(H.screen(ctx, { v_m_s: 1865, alt_m: 3000, material: 'Graphite' }).ok, true);
  const hot = H.screen(ctx, { v_m_s: 1865, alt_m: 3000, material: 'Graphite', isa_offset_K: 50 });
  assert.equal(hot.refusal.code, 'out_of_envelope');
  assert.match(hot.refusal.reason, /ISA\+50\.0 K day/);
});

// ---------------------------------------------------------------------------------------------
// 6. The table and the bands.
// ---------------------------------------------------------------------------------------------
test('table at the fin condition: 21 rows in table order, 13 over / 0 stagnation / 1 near / 7 under, confidence carried', () => {
  const t = H.table(ctx, 700, 3000);
  assert.equal(t.ok, true);
  assert.equal(t.verdict, 'SCREEN');
  assert.equal(t.rows.length, 21);
  assert.deepEqual(t.rows.map((r) => r.key), S.materialsThermal.rows.map((r) => r.key));
  const count = (b) => t.rows.filter((r) => r.band === b).length;
  assert.equal(count('over'), 13);
  assert.equal(count('stagnation'), 0);
  assert.equal(count('near'), 1);
  assert.equal(count('under'), 7);
  assert.equal(t.rows.find((r) => r.band === 'near').key, 'PEEK');
  for (const r of t.rows) {
    const src = S.materialsThermal.rows.find((x) => x.key === r.key);
    assert.equal(r.confidence, src.confidence, `${r.key} keeps its confidence`);
    assert.equal(r.service_max_c, src.service_max_c);
    near(r.margin_turb_C, src.service_max_c - 213.06, 0.005, `${r.key} margin`);
    assert.equal(r.name, S.materialsMeta[r.key].name);
    assert.equal(r.kind, S.materialsMeta[r.key].kind);
  }
  assert.equal(t.rows.filter((r) => r.confidence === 'recall').length, 14);
  assert.equal(t.rows.filter((r) => r.confidence === 'likely').length, 7);
  near(t.condition.T0_C, 239.37, 0.005);
});

test('bands: every boundary, by construction', () => {
  // Pick speeds at 3000 m for 6061-T6 (170 °C) from the closed forms.
  const L = H.speedAtLimit(ctx, 170, 3000);
  const at = (v) => H.screen(ctx, { v_m_s: v, alt_m: 3000, material: '6061-T6', inputs_src: 'user' });
  assert.equal(at(L.turb_m_s + 0.01).band, 'over');
  assert.equal(at(L.turb_m_s - 0.01).band, 'stagnation');
  assert.equal(at(L.T0_m_s + 0.01).band, 'stagnation');
  assert.equal(at(L.T0_m_s - 0.01).band, 'near');
  const Lnear = H.speedAtLimit(ctx, 170 - H.NEAR_C, 3000); // T0 exactly 25 °C under the limit
  assert.equal(at(Lnear.T0_m_s + 0.01).band, 'near');
  assert.equal(at(Lnear.T0_m_s - 0.01).band, 'under');
  assert.equal(at(0).band, 'under');
  for (const b of ['over', 'stagnation', 'near', 'under']) assert.ok(H.BAND_TEXT[b].length > 10);
});

test('the verdict is SCREEN for every material at several conditions; never PASS anywhere in the model’s words', () => {
  // 1,800 m/s at 60 km is T0 1,860 K: under the 2,000 K ceiling, so every row still computes.
  for (const [v, alt] of [[0, 0], [300, 0], [700, 3000], [1200, 10000], [1800, 60000]]) {
    for (const row of S.materialsThermal.rows) {
      const r = H.screen(ctx, { v_m_s: v, alt_m: alt, material: row.key, inputs_src: 'user' });
      assert.equal(r.ok, true);
      assert.equal(r.verdict, 'SCREEN');
      assert.ok(!/\bPASS\b/.test(JSON.stringify(r).replace(/never PASS/g, '')), 'no PASS');
    }
  }
  const hot = H.screen(ctx, { v_m_s: 1300, alt_m: 0, material: 'Graphite', inputs_src: 'user' });
  assert.ok(hot.T0_K > 800 && hot.flags.some((f) => f.code === 'hot'), 'T0 above 800 K is flagged');
  // The 800 K threshold at its boundary, in kelvin: 1,010 m/s at sea level is T0 795.8 K, 1,020 m/s is 805.9 K.
  const below = H.screen(ctx, { v_m_s: 1010, alt_m: 0, material: 'Graphite', inputs_src: 'user' });
  const above = H.screen(ctx, { v_m_s: 1020, alt_m: 0, material: 'Graphite', inputs_src: 'user' });
  near(below.T0_K, 795.8, 0.05, '1010 m/s at sea level');
  near(above.T0_K, 805.9, 0.05, '1020 m/s at sea level');
  assert.ok(!below.flags.some((f) => f.code === 'hot'), 'T0 795.8 K is not flagged hot');
  assert.ok(above.flags.some((f) => f.code === 'hot'), 'T0 805.9 K is flagged hot');
  const recall = H.screen(ctx, { v_m_s: 300, alt_m: 0, material: 'G10-FR4', inputs_src: 'user' });
  assert.ok(recall.flags.some((f) => f.code === 'recall'), 'recall rows say so');
  assert.equal(recall.material.service_max_c, 130);
});

// ---------------------------------------------------------------------------------------------
// 7. The speed field's parser.
// ---------------------------------------------------------------------------------------------
test('parseSpeed: m/s accepted, Mach spellings recognised for refusal, other units reported not converted', () => {
  assert.deepEqual(H.parseSpeed('700'), { kind: 'speed', v_m_s: 700 });
  assert.deepEqual(H.parseSpeed(' 700 m/s '), { kind: 'speed', v_m_s: 700 });
  assert.deepEqual(H.parseSpeed('657.2m/s'), { kind: 'speed', v_m_s: 657.2 });
  assert.deepEqual(H.parseSpeed('-5'), { kind: 'speed', v_m_s: -5 });
  assert.deepEqual(H.parseSpeed('700.'), { kind: 'speed', v_m_s: 700 }, 'a trailing point is a number');
  assert.deepEqual(H.parseSpeed('.5'), { kind: 'speed', v_m_s: 0.5 }, 'a leading point is a number');
  assert.deepEqual(H.parseSpeed('.5 m/s'), { kind: 'speed', v_m_s: 0.5 });
  for (const s of ['Mach 2', 'mach2', 'M2', 'M 2', '2 Mach', '2.0 mach', 'Ma 2', '2 Ma', 'Mach 2.']) assert.deepEqual(H.parseSpeed(s), { kind: 'mach', mach: 2 }, s);
  // A trailing "m" is an unfinished m/s, never Mach 700.
  for (const s of ['700 m', '700m', '700 M']) assert.deepEqual(H.parseSpeed(s), { kind: 'unit', unit: 'm', value: 700, didYouMean: 'm/s' }, s);
  assert.deepEqual(H.parseSpeed('2M'), { kind: 'unit', unit: 'm', value: 2, didYouMean: 'm/s' });
  assert.equal(H.parseSpeed('.'), null, 'a bare point is not a number');
  assert.equal(H.parseSpeed('1e6'), null, 'no exponent notation');
  assert.deepEqual(H.parseSpeed('500 km/h'), { kind: 'unit', unit: 'km/h', value: 500 });
  assert.deepEqual(H.parseSpeed('300 kt'), { kind: 'unit', unit: 'kt', value: 300 });
  assert.equal(H.parseSpeed('fast'), null);
  assert.equal(H.parseSpeed(''), null);
  assert.equal(H.parseSpeed(null), null);
});

// ---------------------------------------------------------------------------------------------
// 8. The README and the page say the numbers the model computes.
// ---------------------------------------------------------------------------------------------
test('README and index.html carry the computed numbers and the bound caveat', () => {
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  const r = H.screen(ctx, { v_m_s: 700, alt_m: 3000, material: '6061-T6', inputs_src: 'default' });
  for (const n of [r.T0_C.toFixed(1), r.Tr_turb_C.toFixed(1), r.Tr_lam_C.toFixed(1), r.M.toFixed(2)]) assert.ok(readme.includes(n), `README says ${n}`);
  assert.ok(readme.includes('210.4'), 'README says 210.4');
  assert.ok(readme.includes('125.6'), 'README says 125.6');
  assert.ok(readme.includes('627'), 'README says 627 m/s');
  assert.ok(readme.includes('2,000 K') && readme.includes('1,854.6'), 'README names the ceiling and the sea-level stay-below speed the page prints');
  assert.ok(!/1,855 m\/s/.test(readme) && !/1,855 m\/s/.test(html), 'and never the rounded-up 1,855 m/s, which is past the ceiling');
  assert.ok(/ISA\+10\.6/.test(readme), 'README names the hot-day offset that erases PEEK’s margin');
  // The speed is airspeed, and the headwind figure the page's hint quotes is the model's at 700 m/s.
  assert.ok(/airspeed/i.test(readme) && /relative to the air/.test(html), 'README and page say the speed is airspeed');
  assert.ok(html.includes(`${r.headwind10_K.toFixed(1)} K per 10 m/s of headwind at 700 m/s`), 'the page’s headwind figure is the model’s');
  assert.ok(/2,000 K/.test(html), 'the page names the ceiling');
  assert.ok(/upper bound/i.test(html.split('<body')[1].slice(0, 4000)), 'the page says "upper bound" near the top');
  assert.ok(!/\bPASS\b/.test(html.replace(/never PASS|not PASS|never a PASS/g, '')), 'the page never offers PASS');
});
