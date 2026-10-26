// node --test ideas/19-caliper-ledger/ledger.test.mjs   (Node built-ins only; a second or two)
//
// What is pinned to something outside this folder's own code:
//   - the FLIGHT-block sha256 of every template, computed by coreutils (`sed -n '/FLIGHT-BEGIN/,/FLIGHT-END/p'
//     <file> | sha256sum`) and recorded here as literals;
//   - SHA-256 itself, against the FIPS 180-2 example vectors and node:crypto;
//   - the declaration counts, read by PartForge's own parseFlight()/flightCounts() (verbatim in
//     snapshots/partforge.js), against the proposal's numbers and the hole counts the templates' own MAKE
//     lines state ("drill/ream the 10 holes", "8 holes", "mill 8 × 6.40");
//   - the GO/NO-GO pin sizes the templates' own inspection plans name, against their declared limits;
//   - the shape of a headless report, produced by PartForge's own measurementRows() (verbatim) from an
//     INVENTED flightRows object built the way flightCheck() builds it (index.html:5621-5747);
//   - hand-worked arithmetic (bolt-circle positions, inch conversions, the float trap at 6.60 + 0.10).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require('./ledger.js');
const PF = C.PartForge;
const T = (name) => PF.templates[name].text;
const SRC = (name) => ({ kind: 'template', file: `tests/templates/${name}.scad`, commit: PF.provenance.commit });
const load = (name) => C.loadDeclaration(T(name), SRC(name));
const nodeSha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const feat = (d, id) => d.features.find((f) => f.id === id);
const MIC = { id: 'mic', type: 'micrometer', label: 'test', unit: 'mm', resolution: '0.001', accuracy: '' };
const CAL = { id: 'cal', type: 'caliper', label: 'test', unit: 'mm', resolution: '0.01', accuracy: '' };
const META = { operator: 'A. Machinist', date: '2026-10-26' };

// ---------------------------------------------------------------- provenance of the snapshot

test('every template string in snapshots/partforge.js is the snapshot its sidecar describes', () => {
  for (const name of Object.keys(PF.templates)) {
    const side = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', `${name}.scad.provenance.json`), 'utf8'));
    const file = fs.readFileSync(path.join(here, 'snapshots', `${name}.scad`), 'utf8');
    assert.equal(nodeSha(file), side.sourceSha256, `${name}.scad matches its sidecar`);
    assert.equal(T(name), file, `${name} embedded verbatim`);
    assert.equal(side.commit, PF.provenance.commit);
  }
  assert.equal(Object.keys(PF.templates).length, 7);
  assert.match(PF.provenance.commit, /^0974a62/);
});

test('the verbatim PartForge blocks are still what the checkout has (skipped without a checkout)', (t) => {
  if (!fs.existsSync('/home/user/Partforge/index.html')) return t.skip('no PartForge checkout here');
  const head = spawnSync('git', ['-C', '/home/user/Partforge', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  if (head !== PF.provenance.commit) return t.skip(`checkout is at ${head.slice(0, 7)}, snapshot at ${PF.provenance.commit.slice(0, 7)}`);
  const r = spawnSync(process.execPath, [path.join(here, 'build-data.mjs'), '/home/user/Partforge', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const html = fs.readFileSync('/home/user/Partforge/index.html', 'utf8');
  // the ICD header the Markdown export copies, character for character (icdSheet(), index.html:6768)
  assert.ok(html.includes("'| Interface | Nominal (mm) | Nominal (in) | Tol (mm) | Tolerance from | As modelled | Verified on the article |'"));
  // the FLIGHT block of every test template is also, verbatim, the block the app ships in TEMPLATES_FLIGHT, so a
  // ledger bound here binds to the declaration a person opens in the app
  for (const name of Object.keys(PF.templates)) assert.ok(html.includes(C.flightBlockText(T(name))), `${name}: FLIGHT block present verbatim in index.html`);
});

// ---------------------------------------------------------------- sha256 and the declaration hash

test('sha256: FIPS 180-2 example vectors and node:crypto on 400 random strings', () => {
  assert.equal(C.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(C.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(C.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const alphabet = 'abcXYZ019 \n|/ø±°µ–—€😀';
  for (let i = 0; i < 400; i++) {
    const n = i < 130 ? i : Math.floor(rnd() * 300);           // every length across the 55/56/64-byte padding edges
    let s = '';
    for (let k = 0; k < n; k++) s += [...alphabet][Math.floor(rnd() * [...alphabet].length)];
    assert.equal(C.sha256Hex(s), nodeSha(s), `length ${n}`);
  }
});

// coreutils: sed -n '/FLIGHT-BEGIN/,/FLIGHT-END/p' snapshots/<name>.scad | sha256sum
const SED_SHA = {
  bulkhead: 'ea41c20b0c1ba26896d381bf52a75bfbba24250f4c0876d6acc9c65f06ac24d8',
  coupler: 'b37baa8301f8b814c65e17393e9c5ef7c627f66ce2d7baffc4a3740635d95181',
  'centering-ring': '03e1dd72ad51f6efb1a26cedbee0b38db69dca0ae2ee0869d9d24aaaeb684fed',
  'motor-retainer': '2bb3dfd25a65d4d8d39b4fc89408a6865178b614ff7e6fc4ea0c5b47fa0a775f',
  nosecone: '64a85dd3ba7e83bee3f79a4df930989a0d48eb41c8e714817e5aebea83e66e26',
  fin: '9c049d1ca9a39fb2160870484c7dadd9eef5a188cb78a00072bec18eb176e637',
  'av-sled': '4f6a16c85ff1f1c39da006c6410db67840720803ed8b5c20580e62200a0e01c0',
};
test('the declaration hash of every template equals sed | sha256sum of its FLIGHT lines', () => {
  for (const [name, sha] of Object.entries(SED_SHA)) assert.equal(load(name).declSha256, sha, name);
});

test('the declaration hash ignores edits outside the block and CRLF, and moves on a one-digit edit inside it', () => {
  const src = T('bulkhead');
  const base = C.loadDeclaration(src).declSha256;
  const outside = src.replace('// NOTE: Stop ring in the coupler', '// NOTE: (edited) Stop ring in the coupler') + '\nmodule extra(){ cube(1); }\n';
  assert.notEqual(C.sha256Hex(outside), C.sha256Hex(src));
  assert.equal(C.loadDeclaration(outside).declSha256, base, 'edits outside FLIGHT');
  assert.equal(C.loadDeclaration(src.replace(/\n/g, '\r\n')).declSha256, base, 'CRLF checkout');
  const digit = src.replace('"nominal_mm":146.20,"tol_mm":0.05,"round":true,"tol_src":"default"},\n//              {"name":"bulkhead OD (y)"',
    '"nominal_mm":146.21,"tol_mm":0.05,"round":true,"tol_src":"default"},\n//              {"name":"bulkhead OD (y)"');
  assert.notEqual(digit, src);
  assert.notEqual(C.loadDeclaration(digit).declSha256, base, 'one digit inside FLIGHT');
  assert.notEqual(C.loadDeclaration(src).fileSha256, C.loadDeclaration(outside).fileSha256, 'the file hash does see outside edits');
});

// ---------------------------------------------------------------- the declaration, read by PartForge's parser

test('bulkhead counts through PartForge\'s own parser are the proposal\'s: 5 critical, 2 bores, 4 hole entries, 4 gauges, 2 loads', () => {
  const d = load('bulkhead');
  assert.deepEqual(d.counts, { critical: 5, od: 0, bores: 2, holes: 4, revolve: 0, gauges: 4, loads: 2 });
  assert.equal(d.features.length, 5 + 2 + 10 + 4);
  assert.equal(d.part, 'Av-bay ejection bulkhead with face-seal O-ring, 6 in coupler');
  assert.deepEqual(d.provenance, { cited: 0, user: 1, tool_default: 10, refs: [] });
});

test('one row per hole: the hole counts the templates\' own MAKE lines state', () => {
  const holes = (name) => load(name).features.filter((f) => f.kind === 'holes').length;
  const make = (name) => /^\/\/ MAKE:(.*)$/m.exec(T(name))[1];
  assert.match(make('bulkhead'), /drill\/ream the 10 holes/);
  assert.equal(holes('bulkhead'), 10);
  assert.match(make('centering-ring'), /OD, bore, 8 holes/);
  assert.equal(holes('centering-ring'), 8);
  assert.match(make('motor-retainer'), /mill 8 × 6\.40 on the 132 bolt circle/);
  assert.equal(holes('motor-retainer'), 8);
  const total = Object.keys(PF.templates).map((n) => [n, load(n).features.length]);
  assert.deepEqual(Object.fromEntries(total), { bulkhead: 21, coupler: 7, 'centering-ring': 12, 'motor-retainer': 12, nosecone: 6, fin: 11, 'av-sled': 21 });
});

test('hole centres: 4 on a Ø110 circle from 45° are at (±55·cos45°, ±55·sin45°); axis y runs v the other way', () => {
  const d = load('bulkhead');
  const rods = d.features.filter((f) => f.name === 'all-thread rods 1/4 in').map((f) => f.hole.at);
  const c = 55 * Math.SQRT1_2;
  [[c, c], [-c, c], [-c, -c], [c, -c]].forEach((p, i) => { assert.ok(Math.abs(rods[i][0] - p[0]) < 1e-9 && Math.abs(rods[i][1] - p[1]) < 1e-9, `rod ${i + 1}`); });
  assert.match(d.features.find((f) => f.name === 'all-thread rods 1/4 in').label, /#1 of 4 at \(38\.891, 38\.891\) z/);
  // index.html:3791-3793: cmmFrame('y') has sv = -1, so a hole at +90° lands at negative v.
  const y = C.holePositions({ pattern: 'circle', n: 1, bc_d_mm: 20, start_deg: 90, centre_mm: [0, 0], axis: 'y' })[0];
  assert.ok(Math.abs(y[0]) < 1e-12 && Math.abs(y[1] + 10) < 1e-12);
  const z = C.holePositions({ pattern: 'circle', n: 1, bc_d_mm: 20, start_deg: 90, centre_mm: [0, 0], axis: 'z' })[0];
  assert.ok(Math.abs(z[1] - 10) < 1e-12);
});

test('a file it cannot inspect against is refused with what would help, never a placeholder', () => {
  const none = C.loadDeclaration('// PART: x\ncube(1);');
  assert.equal(none.ok, false); assert.equal(none.refusal.code, 'insufficient_data'); assert.match(none.refusal.what_would_help, /flight grade/);
  const bad = C.loadDeclaration('// FLIGHT-BEGIN\n// {"material":"6061-T6",}\n// FLIGHT-END\n');
  assert.equal(bad.refusal.code, 'invalid_input');
  const empty = C.loadDeclaration('// FLIGHT-BEGIN\n// {"material":"6061-T6","critical":[{"name":"no tol","module":"main","axis":"z","nominal_mm":10}]}\n// FLIGHT-END\n');
  assert.equal(empty.refusal.code, 'insufficient_data'); assert.match(empty.refusal.reason, /1 were dropped/);
  assert.equal(C.loadDeclaration('').ok, false);
});

// ---------------------------------------------------------------- readings: exact limits, worst reading

const one = (d, id, entry, shelf = [MIC, CAL]) => C.evaluate(feat(d, id), entry, shelf);
const R = (inst, ...readings) => ({ method: 'readings', instrument: inst, readings });

test('the limit is inside: a 6.70 reading on the 6.60 ±0.10 rod hole is IN, though 6.6 + 0.1 < 6.7 in floating point', () => {
  assert.ok(6.6 + 0.1 < 6.7, 'the float trap this guards against');
  const d = load('bulkhead'), id = 'holes|all-thread rods 1/4 in|0|0';
  assert.equal(one(d, id, R('mic', '6.700')).status, 'IN');
  assert.equal(one(d, id, R('mic', '6.500')).status, 'IN');
  assert.equal(one(d, id, R('mic', '6.701')).status, 'OUT');
  assert.equal(one(d, id, R('mic', '6.499')).status, 'OUT');
  assert.equal(one(d, id, R('mic', '6.701')).stats.worst_margin_mm, '-0.001');
});

test('every reading must be in, not the mean: an oval OD read 146.14 and 146.26 has a perfect mean and is OUT', () => {
  const d = load('bulkhead');
  const e = one(d, 'critical|bulkhead OD|0', R('mic', '146.14', '146.26'));
  assert.equal(e.status, 'OUT');
  assert.equal(e.stats.mean_mm, '146.2000');
  assert.equal(e.stats.dev_mean_mm, '0.0000');
  assert.equal(e.stats.range_mm, '0.120');
  assert.equal(e.stats.worst_margin_mm, '-0.010');
  const ok = one(d, 'critical|bulkhead OD|0', R('mic', '146.181', '146.224', '146.203'));
  assert.equal(ok.status, 'IN');
  assert.equal(ok.stats.mean_mm, '146.2027');                       // 438.608 / 3 = 146.20266…
  assert.equal(ok.stats.worst_margin_mm, '0.026');                    // 146.25 − 146.224
});

test('inch readings convert at exactly 25.4 mm: 5.7539 in is 146.14906 mm (OUT by 0.00094), 5.7540 in is IN', () => {
  const d = load('bulkhead');
  const INCH = { id: 'in', type: 'micrometer', label: '', unit: 'in', resolution: '0.0001', accuracy: '' };
  const out = C.evaluate(feat(d, 'critical|bulkhead OD|0'), R('in', '5.7539'), [INCH]);
  assert.equal(out.status, 'OUT');
  assert.equal(out.stats.worst_margin_mm, '-0.00094');
  const inn = C.evaluate(feat(d, 'critical|bulkhead OD|0'), R('in', '5.7540'), [INCH]);
  assert.equal(inn.status, 'IN');
  assert.equal(inn.stats.min_mm, '146.1516');
  assert.equal(C.typedToPm('1', 'in').pm, 25400000000n);
});

test('limits printed in inches are rounded inward, so an inch reading can never pass the printed limit and fail the band', () => {
  const d = load('bulkhead'), f = feat(d, 'critical|bulkhead OD|0');
  assert.equal(C.fmtInch(f.lower_pm, 'up'), '5.75394');     // 146.15 / 25.4 = 5.7539370…
  assert.equal(C.fmtInch(f.upper_pm, 'down'), '5.75787');   // 146.25 / 25.4 = 5.7578740…
  const t = feat(d, 'critical|plate thickness|0');          // 12.70 ±0.05: here inward and nearest differ
  assert.equal(C.fmtInch(t.lower_pm, 'up'), '0.49804');      // 12.65 / 25.4 = 0.4980314…, nearest would be 0.49803
  assert.equal(C.fmtInch(t.upper_pm, 'down'), '0.50196');    // 12.75 / 25.4 = 0.5019685…, nearest would be 0.50197
  assert.equal(C.fmtInch(t.upper_pm, 'near'), '0.50197');
  const INCH = { id: 'in', type: 'micrometer', label: '', unit: 'in', resolution: '0.00001', accuracy: '' };
  for (const [s, want] of [['5.75394', 'IN'], ['5.75787', 'IN'], ['5.75393', 'OUT'], ['5.75788', 'OUT']]) {
    assert.equal(C.evaluate(f, R('in', s), [INCH]).status, want, s);
  }
});

test('what is typed is checked before any verdict: bad numbers, commas, blanks, no instrument, no resolution', () => {
  const d = load('bulkhead'), id = 'critical|plate thickness|0';
  const bad = one(d, id, R('mic', '12.7x'));
  assert.equal(bad.status, 'NOT MEASURED'); assert.match(bad.problems[0], /not a number/);
  assert.equal(one(d, id, R('mic', '12,700')).status, 'IN', 'a comma is a decimal point (phone keypads)');
  assert.equal(one(d, id, R('mic', '', '12.70', ' ')).stats.n, 1, 'blank inputs are not readings');
  assert.equal(one(d, id, R('nope', '12.70')).status, 'NOT MEASURED');
  assert.equal(one(d, id, R('mic', '12.70'), [{ ...MIC, resolution: '' }]).status, 'NOT MEASURED');
  assert.equal(one(d, id, R('mic', '12.70'), [{ ...MIC, resolution: '0' }]).status, 'NOT MEASURED');
  assert.equal(one(d, id, R('mic', '-12.70')).status, 'NOT MEASURED');
  assert.equal(one(d, id, R('mic', '12.7000001')).status, 'NOT MEASURED', 'more than 6 decimals');
  assert.equal(one(d, id, R('mic')).status, 'NOT MEASURED');
  assert.equal(one(d, id, null).status, 'NOT MEASURED');
  assert.equal(one(d, id, R('mic', '0'.repeat(40) + '12.70')).status, 'NOT MEASURED', 'over 40 characters');
  // more than 50 readings is refused, never cut short: the 51st here is OUT
  const many = Array.from({ length: 50 }, () => '12.70').concat(['13.00']);
  const e51 = one(d, id, R('mic', ...many));
  assert.equal(e51.status, 'NOT MEASURED'); assert.match(e51.problems[0], /51 readings/);
  const rec = C.exportLedger(d, { shelf: [MIC], entries: { [id]: R('mic', ...many) }, meta: META });
  const back = C.importLedger(rec, d);
  assert.equal(C.evaluate(feat(d, id), back.state.entries[id], back.state.shelf).status, 'NOT MEASURED', 'and stays refused through a record');
  assert.equal(one(d, id, { method: 'gauge', how: 'x', observed: 'clear' }).status, 'NOT MEASURED', 'a gauge observation is not a size');
});

// ---------------------------------------------------------------- the 10:1 rule of thumb and the other flags

test('discrimination: 0.01 mm against ±0.05 is exactly a tenth (not flagged); 0.02, a ±0.02 accuracy, and 0.0005 in are flagged', () => {
  const d = load('bulkhead'), id = 'critical|bulkhead OD|0';
  const flags = (ins) => C.evaluate(feat(d, id), R(ins.id, ins.unit === 'in' ? '5.7559' : '146.20'), [ins]).flags.map((x) => x.code);
  assert.ok(!flags({ ...CAL }).includes('discrimination'));
  assert.ok(flags({ ...CAL, resolution: '0.02' }).includes('discrimination'));
  assert.ok(flags({ ...CAL, accuracy: '0.02' }).includes('discrimination'), 'the larger of resolution and stated accuracy');
  assert.ok(flags({ ...CAL, accuracy: '0.01' }).length === 0);
  assert.ok(flags({ id: 'i', type: 'caliper', unit: 'in', resolution: '0.0005' }).includes('discrimination'), '0.0127 mm > 0.010');
  assert.ok(!flags({ id: 'i', type: 'micrometer', unit: 'in', resolution: '0.0001' }).includes('discrimination'), '0.00254 mm');
  assert.ok(!flags({ ...MIC }).includes('discrimination'));
});

test('near-limit and off-step flags', () => {
  const d = load('bulkhead'), id = 'critical|bulkhead OD|0';
  const e = C.evaluate(feat(d, id), R('cal', '146.24'), [CAL]);
  assert.equal(e.status, 'IN');
  assert.ok(e.flags.some((x) => x.code === 'near_limit'), '0.01 from the limit with a 0.01 instrument');
  assert.ok(!C.evaluate(feat(d, id), R('cal', '146.23'), [CAL]).flags.some((x) => x.code === 'near_limit'));
  const off = C.evaluate(feat(d, id), R('cal', '146.213'), [CAL]);
  assert.ok(off.flags.some((x) => x.code === 'off_step' && /146\.213/.test(x.text)));
});

// ---------------------------------------------------------------- GO/NO-GO, against the templates' own plans

const G = (go, go_result, nogo, nogo_result, unit = 'mm') => ({ method: 'gonogo', unit, go, go_result, nogo, nogo_result });

test('GO/NO-GO pins: in, out, contradictory, and one member alone', () => {
  const d = load('bulkhead'), id = 'holes|all-thread rods 1/4 in|0|0';
  assert.equal(one(d, id, G('6.50', 'pass', '6.70', 'stop')).status, 'IN');
  assert.equal(one(d, id, G('6.50', 'stop', '6.70', 'stop')).status, 'OUT');
  assert.equal(one(d, id, G('6.50', 'pass', '6.70', 'pass')).status, 'OUT');
  assert.equal(one(d, id, G('6.50', 'stop', '6.70', 'pass')).status, 'NOT MEASURED');
  const half = one(d, id, G('6.50', 'pass', '', ''));
  assert.equal(half.status, 'UNDECIDED'); assert.match(half.why, /at most the upper limit 6\.700/);
  assert.equal(one(d, id, G('6.50', '', '', '')).status, 'NOT MEASURED');
});

test('ring gauges on an outside size work the other way: passing over proves "at most"', () => {
  const d = load('coupler'), id = 'od|coupler OD|0';                // 149.30 ±0.05
  assert.equal(one(d, id, G('149.35', 'pass', '149.25', 'stop')).status, 'IN');
  assert.equal(one(d, id, G('149.35', 'stop', '149.25', 'stop')).status, 'OUT');
  assert.equal(one(d, id, G('149.25', 'pass', '', '')).status, 'OUT', 'passes over the lower limit: undersize');
});

test('the GO/NO-GO pairs in the templates\' own inspection plans, against their declared limits: five bound the band, the fin\'s does not', () => {
  // [template, inspection-plan text the pair is read from, feature it inspects]
  const plan = [
    ['bulkhead', 'rod holes 6.50 GO / 6.70 NO-GO pins', 'holes|all-thread rods 1/4 in|0|0', 'IN'],
    ['coupler', 'pin holes with 2.10 GO / 2.30 NO-GO pins', 'holes|shear pin, aft, 0°|0|0', 'IN'],
    ['centering-ring', 'bore with 101.65 GO / 101.75 NO-GO plug or bore gauge', 'bores|MMT bore|0', 'IN'],
    ['centering-ring', 'M4 holes with 4.40 GO / 4.60 NO-GO pins', 'holes|M4 retention bolts|0|0', 'IN'],
    ['motor-retainer', 'bore with 98.55 GO / 98.65 NO-GO plug', 'bores|case bore|0', 'IN'],
    ['fin', 'tab holes with 4.38 GO / 4.60 NO-GO pins', 'holes|tab epoxy-key holes|0|0', 'UNDECIDED'],
  ];
  for (const [name, text, id, want] of plan) {
    const d = load(name);
    const line = d.inspect.find((l) => l.includes(text));
    assert.ok(line, `${name}: the plan says "${text}"`);
    const m = /(\d+\.\d+) GO \/ (\d+\.\d+) NO-GO/.exec(text);
    const e = C.evaluate(feat(d, id), G(m[1], 'pass', m[2], 'stop'), []);
    assert.equal(e.status, want, `${name}: ${text}`);
    if (want === 'UNDECIDED') assert.match(e.why, /0\.020 mm below the lower limit 4\.400/);
  }
});

// ---------------------------------------------------------------- the FLIGHT gauges, profiles

test('a declared gauge is IN when the physical check does what the declaration requires, and needs a method', () => {
  const d = load('bulkhead');
  const nogo = feat(d, 'gauges|groove ID wall NO-GO|0'), go = feat(d, 'gauges|groove GO ring|0');
  assert.equal(nogo.expect, 'interfere');
  assert.equal(C.evaluate(nogo, { method: 'gauge', how: 'NO-GO ring 126.52', observed: 'blocked' }).status, 'IN');
  assert.equal(C.evaluate(nogo, { method: 'gauge', how: 'NO-GO ring 126.52', observed: 'clear' }).status, 'OUT');
  assert.equal(C.evaluate(go, { method: 'gauge', how: 'GO ring', observed: 'clear' }).status, 'IN');
  assert.equal(C.evaluate(go, { method: 'gauge', how: '  ', observed: 'clear' }).status, 'NOT MEASURED');
  const fin = load('fin');
  assert.equal(C.evaluate(feat(fin, 'gauges|LE flat present|0'), { method: 'gauge', how: 'feeler on straightedge', observed: 'blocked' }).status, 'IN', '"interfere": the flat exists');
  const prof = C.loadDeclaration('// PART: p\n// FLIGHT-BEGIN\n// {"revolve":[{"name":"ogive","type":"vonkarman","L_mm":400,"R_mm":76,"tip_at_mm":400,"tol_mm":0.3}]}\n// FLIGHT-END\n');
  assert.equal(prof.features[0].type, 'profile');
  assert.equal(C.evaluate(prof.features[0], { method: 'profile', how: 'cut template, 5 stations', observed: 'conforms' }).status, 'IN');
});

// ---------------------------------------------------------------- the part

function allIn(d) {
  const entries = {};
  for (const f of d.features) {
    if (f.type === 'gauge') entries[f.id] = { method: 'gauge', how: 'gauge', observed: f.expect === 'interfere' ? 'blocked' : 'clear' };
    else entries[f.id] = { method: 'readings', instrument: 'mic', readings: [C.fmtExact(f.nominal_pm, 3)] };
  }
  return entries;
}

test('the part is INCOMPLETE until every feature has an entry and the operator and date are recorded', () => {
  const d = load('bulkhead');
  const st = (entries, meta = META) => C.partStatus(d, C.evaluateAll(d, { shelf: [MIC], entries }), meta);
  const fresh = st({}, {});
  assert.equal(fresh.verdict, 'INCOMPLETE'); assert.equal(fresh.counts['NOT MEASURED'], 21); assert.deepEqual(fresh.missing, ['operator', 'inspection date']);
  const full = allIn(d);
  assert.equal(st(full).verdict, 'ALL IN');
  const missingOne = { ...full }; delete missingOne['holes|terminal block #8-32 tap drill|0|1'];
  assert.equal(st(missingOne).verdict, 'INCOMPLETE');
  assert.equal(st(full, { ...META, operator: ' ' }).verdict, 'INCOMPLETE');
  assert.equal(st(full, { ...META, date: '2026-02-30' }).verdict, 'INCOMPLETE');
  const oneOut = { 'critical|bulkhead OD|0': R('mic', '146.30') };
  const o = st(oneOut);
  assert.equal(o.verdict, 'NONCONFORMING', 'one OUT decides it even with 20 not measured'); assert.match(o.line, /1 of 21 features OUT; 20 not measured/);
  const und = { ...full, 'holes|all-thread rods 1/4 in|0|0': G('6.50', 'pass', '', '') };
  assert.equal(st(und).verdict, 'UNDECIDED');
  assert.ok(st(full).caveats.some((c) => /10 of 11 tolerances were proposed by the tool/.test(c)));
});

// ---------------------------------------------------------------- "as modelled": PartForge's report shapes

/* An INVENTED flightRows object, built the way flightCheck() builds it (index.html:5621-5747): declared entry
   + { measured, ok } for critical, + { r, ok } for od/bores/holes (holes carry r.holes[]), gauges with
   { ok, note }. The numbers are made up; only the shape is PartForge's. */
function inventedFlightRows(d, bump = 0.001) {
  const f = d.flight;
  return {
    lint: [], tier: { tier: 'A' }, provenance: f.provenance, envelope: null, tess: null,
    critical: f.critical.map((c) => ({ ...c, measured: c.nominal_mm + bump, ok: true, note: '' })),
    od: f.od.map((e) => ({ ...e, r: { ok: true, d_mean: e.d_mm - bump, centre_offset_mm: 0 }, ok: true })),
    bores: f.bores.map((e) => ({ ...e, r: { ok: true, present: true, d_mean: e.d_mm + bump, centre_offset_mm: 0.002 }, ok: true })),
    holes: f.holes.map((e) => ({ ...e, r: { ok: true, holes: C.holePositions(e).map((p, i) => ({ present: true, d_mean: e.d_mm + i * bump, centre_offset_mm: 0.001 })) }, ok: true })),
    revolve: [], gauges: f.gauges.map((g) => ({ ...g, ok: true, note: 'clear as required' })),
    loads: f.loads.map((l) => ({ ...l, sf: 3, ok: true })),
  };
}
const envelopeOf = (d, rows) => ({ ok: true, tool: 'check', value: { verdict: 'pass', fails: [], part: d.part, flight: { measurements: PF.measurementRows(rows) } } });

test('a report is imported 1:1 by kind and name, in both PartForge shapes, and never touches the readings', () => {
  const d = load('bulkhead');
  const rows = inventedFlightRows(d);
  const state = { shelf: [MIC], entries: { 'critical|plate thickness|0': R('mic', '12.70') }, meta: META };
  const before = JSON.stringify(state);
  const a = C.importReport(JSON.stringify(envelopeOf(d, rows)), d);
  assert.equal(a.ok, true, a.refusal && a.refusal.reason);
  assert.equal(a.from.shape, 'cli.mjs check envelope');
  assert.equal(Object.keys(a.modelled).length, 21);
  assert.equal(a.modelled['holes|all-thread rods 1/4 in|0|2'].measured_mm, 6.602);
  assert.equal(a.modelled['critical|bulkhead OD|0'].measured_mm, 146.201);
  const b = C.importReport({ app: 'PartForge', grade: 'flight', part: d.part, measurements: rows, fails: [] }, d);
  assert.equal(b.from.shape, 'browser measurement report');
  assert.deepEqual(b.modelled, a.modelled, 'browser flightRows go through measurementRows() to the same thing');
  assert.equal(JSON.stringify(state), before, 'the entries are untouched');
  const rec = C.exportLedger(d, { ...state, modelled: a.modelled, modelledFrom: a.from });
  for (const r of rec.rows) {
    if (r.id === 'critical|plate thickness|0') continue;
    assert.equal(r.entry, null, `${r.id}: no reading appears from the model column`);
    assert.equal(r.verdict, 'NOT MEASURED');
  }
  assert.equal(C.modelledText(feat(d, 'critical|bulkhead OD|0'), a.modelled['critical|bulkhead OD|0']), '146.201');
});

test('a report for another part or another revision is refused, with what would help', () => {
  const d = load('bulkhead');
  const rows = inventedFlightRows(d);
  const other = C.importReport({ ...envelopeOf(d, rows), value: { ...envelopeOf(d, rows).value, part: 'Coupler' } }, d);
  assert.equal(other.refusal.code, 'wrong_part');
  const moved = inventedFlightRows(d); moved.critical[0] = { ...moved.critical[0], nominal_mm: 146.3 };
  const r1 = C.importReport(envelopeOf(d, moved), d);
  assert.equal(r1.refusal.code, 'wrong_revision'); assert.match(r1.refusal.reason, /nominal 146\.3 in the report, 146\.2/);
  const extra = inventedFlightRows(d); extra.bores.push({ ...extra.bores[0], name: 'charge pocket C' });
  assert.equal(C.importReport(envelopeOf(d, extra), d).refusal.code, 'wrong_revision');
  const fewer = inventedFlightRows(d); fewer.holes.pop();
  assert.match(C.importReport(envelopeOf(d, fewer), d).refusal.reason, /no row for holes "terminal block #8-32 tap drill"/);
  const tol = inventedFlightRows(d); tol.holes[0] = { ...tol.holes[0], tol_mm: 0.05 };
  assert.equal(C.importReport(envelopeOf(d, tol), d).refusal.code, 'wrong_revision');
  assert.equal(C.importReport(PF.measurementRows(rows), d).refusal.code, 'wrong_part', 'a bare row list names no part');
  assert.equal(C.importReport('{not json', d).refusal.code, 'invalid_input');
  assert.equal(C.importReport({ ok: true, tool: 'check', value: { part: d.part, flight: null } }, d).refusal.code, 'insufficient_data');
  assert.equal(C.importReport({ ok: false, tool: 'check', value: null, refusal: { code: 'timeout', reason: 'slow' } }, d).refusal.code, 'insufficient_data');
});

// ---------------------------------------------------------------- the record

test('the as-built record round-trips exactly and refuses a different FLIGHT block', () => {
  const d = load('bulkhead');
  const entries = allIn(d);
  entries['critical|bulkhead OD|0'] = R('mic', '146.14', '146.26');
  entries['holes|all-thread rods 1/4 in|0|1'] = G('6.50', 'pass', '6.70', 'stop');
  const state = { shelf: [MIC, { ...CAL, accuracy: '0.02' }], entries, meta: { ...META, remarks: 'first article' } };
  const rec = C.exportLedger(d, state);
  assert.equal(rec.declaration_sha256, SED_SHA.bulkhead);
  assert.equal(rec.status.verdict, 'NONCONFORMING');
  const back = C.importLedger(JSON.stringify(rec), d);
  assert.equal(back.ok, true);
  assert.deepEqual(C.exportLedger(d, back.state), rec);
  const edited = C.loadDeclaration(T('bulkhead').replace('"nominal_mm":12.70', '"nominal_mm":12.71'));
  const refused = C.importLedger(rec, edited);
  assert.equal(refused.refusal.code, 'wrong_revision');
  assert.equal(C.importLedger({ format: 'something-else' }, d).refusal.code, 'invalid_input');
});

test('Markdown keeps the ICD\'s column order, fills the last column, and escapes what people type', () => {
  const d = load('bulkhead');
  const entries = { 'critical|bulkhead OD|0': R('cal', '146.21', '146.22') };
  const md = C.toMarkdown(d, { shelf: [CAL], entries, meta: { operator: 'Ana | Ben', date: '2026-10-26' } });
  const lines = md.split('\n');
  const h = lines.indexOf('| Interface | Nominal (mm) | Nominal (in) | Tol (mm) | Tolerance from | As modelled | Verified on the article |');
  assert.ok(h > 0);
  const body = lines.slice(h + 2, h + 2 + 21);
  assert.equal(body.length, 21);
  assert.ok(body.every((l) => l.startsWith('| ') && l.split(' | ').length === 7));
  assert.match(body[0], /^\| bulkhead OD \(plate, x\) \| 146\.200 \| 5\.7559 \| ±0\.05 \| \*\*tool default\*\* \| — \| IN · 146\.210–146\.220 mm \(n=2, Caliper test \(0\.01 mm\)\) \|$/);
  assert.match(body[1], /\| not measured \|$/);
  assert.match(md, /Inspected by \*\*Ana \\\| Ben\*\* on 2026-10-26/);
  assert.match(md, /Status: \*\*INCOMPLETE\*\*/);
  assert.match(md, /`ea41c20b0c1ba26896d381bf52a75bfbba24250f4c0876d6acc9c65f06ac24d8`/);
  assert.match(md, /Position \(pos_tol_mm\) of 12 bore\/hole rows/);
});
