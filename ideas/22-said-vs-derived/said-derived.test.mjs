// Tests for Said vs Derived. Run from the bank root:
//   node --test ideas/22-said-vs-derived/said-derived.test.mjs
// Node built-ins only. Two groups need things outside this folder and skip (saying why) without
// them: the TypeScript-oracle test (the globally installed `typescript` package) and the
// live-checkout tests (/home/user/asteroid-mining-planner at the commit example.txt names).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SD = require(path.join(HERE, 'said-derived.js'));
const CLI = path.join(HERE, 'said-vs-derived.mjs');
const SNAP = path.join(HERE, 'snapshots', 'aster');
const ALLOW = path.join(HERE, 'allowlist.proposed.json');
const ASTER = '/home/user/asteroid-mining-planner';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'said-vs-derived-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// The synthetic fixture tree (not Aster code): every case in one place, written to a temporary
// directory when the tests start, so the deposit carries no tree of tiny files.
const FIXTURE = {
  // the same three >= 4-figure literals in two files are one copied block; 86_400 has 3 figures
  'src/v2/app/cal-a.ts': [
    'export function jdToYearA(jd: number): number {',
    '  const day = 86_400;',
    '  const z = Math.floor((jd - 1867216.25) / 36524.25);',
    '  return z * 30.6001 + day;',
    '}',
  ],
  'src/v2/porkchop/cal-b.ts': [
    'export function jdToYearB(jd: number): number {',
    '  const day = 86_400;',
    '  const z = Math.floor((jd - 1867216.25) / 36524.25);',
    '  return z * 30.6001 + day;',
    '}',
  ],
  // two constants equal to 1 AU whose names share no word with each other or with the sentence
  'src/v2/render/cells.ts': ['export const CELL_SIZE_AU = 1;'],
  'src/v2/app/orbit.ts': ['export const HELIO_RADIUS_AU = 1;', "export const NOTE = 'Bodies whose semi-major axis is near 1 AU.';"],
  "mcp/src/tools/tool.ts": [
    "export const NOTE = 'Margin policy: deterministic 5% margin on maneuver lines.';",
    "export const WINDOW_END = '2040-01-01';",
  ],
  "src/v2/app/grid.ts": [
    "import { toJd, isoOf } from './time.js';",
    "",
    "export const GRID = {",
    "  depStartJD: toJd('2026-01-01'),",
    "  depEndJD: toJd('2040-01-01'),",
    "  tofMinDays: 182.5,",
    "  tofMaxDays: 1826.25,",
    "} as const;",
    "const SPAN_LABEL = `${isoOf(GRID.depStartJD)}–${isoOf(GRID.depEndJD)}`;",
    "",
    "export function gridSentence(): string {",
    "  return `Grid spans ${SPAN_LABEL} departures and ${GRID.tofMinDays}–${GRID.tofMaxDays} day flight times.`;",
    "}",
  ],
  "src/v2/app/overlay.ts": [
    "export function overlayGrid() {",
    "  return { depEndJD: '2040-01-01', note: 'Stationkeeping allocation 150 m/s per year.' };",
    "}",
  ],
  "src/v2/app/panel.test.ts": [
    "// test files are not scanned",
    "export const T = 'Grid spans 2026–2040 departures, C3 ≤ 25 km²/s².';",
  ],
  "src/v2/app/panel.ts": [
    "import data from './data-2026-2040.json';",
    "import { h } from 'preact';",
    "",
    "export function panel(busy: boolean) {",
    "  const offset = 69.184;",
    "  const end = '2040-01-01';",
    "  console.log('debug 2040-01-01, C3 ≤ 25 km²/s²');",
    "  if (busy) throw new Error('expected C3 ≤ 25 km²/s²');",
    "  const re = /'25 km²\\/s²'/;",
    "  return h('div', { style: 'color:rgba(255,255,255,0.14);max-width:731px;' }, [",
    "    'Grid spans 2026–2040 departures.',",
    "    `Low C3 means departure C3 ≤ 25 km²/s² somewhere in ${data.label}.`,",
    "    h('span', { style: { width: '90%' } }, '< 1 kg'),",
    "    `Albedo is assumed: the survey-average reflectivity 0.14.`,",
    "  ], offset, end, re);",
    "}",
  ],
  "src/v2/core/constants/thresholds.ts": [
    "// Synthetic fixture for said-vs-derived tests. Not Aster code.",
    "export const FEASIBLE_C3_MAX_KM2_S2 = 25;",
    "export const TDB_MINUS_UTC_SECONDS = 69.184;",
    "export const STATIONKEEPING_DV_KMPS = 0.150;",
    "export const DETERMINISTIC_MARGIN_FRACTION = 0.05;",
    "export const ASTEROID_DEFAULT_ALBEDO = 0.14;",
  ],
  "src/v2/porkchop/view.ts": [
    "export const SPACECRAFT_STATIONKEEPING_MPS = 150;",
    "",
    "const SHADER = `",
    "void main() {",
    "  gl_FragColor = vec4(0.14, 1.0, 25.0, 1.0);",
    "}`;",
    "",
    "export function shader() {",
    "  return SHADER;",
    "}",
  ],
  "src/v2/prototypes/proto.ts": [
    "// prototypes are not scanned",
    "export const P = 'Grid spans 2026–2040 departures.';",
  ],
  "tests/fixtures/v2/lambert-screen-cache.json": [
    "{\"metadata\":{\"feasibleC3MaxKm2S2\":25,\"screeningWindow\":{\"startUtc\":\"2026-01-01\",\"endUtc\":\"2040-12-31\"},\"tofMinDays\":182},\"bodies\":[]}",
  ],
  "v2/page/index.html": [
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta name=\"description\" content=\"Departures 2026–2040, C3 ≤ 25 km²/s².\" />",
    "    <title>Fixture page</title>",
    "    <style>body { width: 100%; }</style>",
    "  </head>",
    "  <body><script type=\"module\" src=\"./main.ts\"></script></body>",
    "</html>",
  ],
};
const TREE = path.join(TMP, 'tree');
for (const [rel, lines] of Object.entries(FIXTURE)) {
  fs.mkdirSync(path.dirname(path.join(TREE, rel)), { recursive: true });
  fs.writeFileSync(path.join(TREE, rel), `${lines.join('\n')}\n`);
}

function cli(args, opts = {}) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd: opts.cwd || HERE });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function jsonRun(root, extra = []) {
  const r = cli([root, '--format', 'json', ...extra]);
  return { code: r.code, report: JSON.parse(r.out) };
}
const key = (f) => `${f.class} ${f.path}:${f.line} ${f.literal}`;

// ------------------------------------------------------------------------------------------------
// The lexer
// ------------------------------------------------------------------------------------------------

test('lexer: nested templates, regex literals with quotes, division, comments, escapes', () => {
  const nested = SD.lex("const a = `a ${b ? `x ${c}` : 'y'} d`;");
  assert.deepEqual(
    nested.literals.map((l) => ({ kind: l.kind, parts: l.parts.map((p) => p.raw), exprs: l.exprs.map((e) => e.text) })),
    [
      { kind: 'template', parts: ['a ', ' d'], exprs: ["b ? `x ${c}` : 'y'"] },
      { kind: 'template', parts: ['x ', ''], exprs: ['c'] },
      { kind: 'string', parts: ['y'], exprs: [] },
    ],
  );
  const re = SD.lex('const r = /it\'s "q"/g; const s = \'ok\'; const x = a / b / c; const t = \'/not/\';');
  assert.deepEqual(re.literals.map((l) => l.parts[0].raw), ['ok', '/not/']);
  assert.deepEqual(re.errors, []);
  const comments = SD.lex("// '2040-01-01'\n/* \"25 km²/s²\" */ const s = 'y'; // `z`");
  assert.deepEqual(comments.literals.map((l) => l.parts[0].raw), ['y']);
  assert.equal(SD.cook('km\\u00B2/s\\u00B2 \\x41 \\u{1F600} it\\\'s').text, "km²/s² A 😀 it's");
  assert.match(SD.lex("const s = 'open\nconst t = 1;").errors.join(), /unterminated string at line 1/);
  assert.match(SD.lex('const s = `open ${a').errors.join(), /unterminated/);
  // a template literal type is a literal too
  assert.equal(SD.lex('export type Id = `asteroid-${string}`;').literals.length, 1);
});

test('lexer: the context of each literal (callee chain and object key)', () => {
  const src = [
    "import x from './a-2026-2040.json';",
    "console.warn('c', fmt('d'));",
    "throw new Error('e');",
    "h('div', { style: 'color:red', title: 't' }, 'text');",
  ].join('\n');
  const L = SD.lex(src);
  const ctx = Object.fromEntries(L.literals.map((l) => [l.parts[0].raw, l.ctx]));
  assert.deepEqual(ctx['./a-2026-2040.json'].prev.slice(-1), ['from']);
  assert.deepEqual(ctx.d.callees, ['console.warn', 'fmt']);
  assert.deepEqual(ctx.e.callees, ['new Error']);
  assert.equal(ctx['color:red'].key, 'style');
  assert.equal(ctx.t.key, 'title');
  assert.deepEqual(ctx.text.callees, ['h']);
  assert.equal(ctx.text.key, null);
});

// TypeScript's own parser is the oracle for where every string and template literal is and what
// it says once escapes are cooked. Run over the whole files in snapshots/aster always, and over
// every file the CLI scans when the Aster checkout is present.
function loadTypeScript() {
  try {
    return require('typescript');
  } catch {
    try {
      const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
      return createRequire(path.join(root, 'noop.js'))('typescript');
    } catch {
      return null;
    }
  }
}
function oracleDiff(ts, file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const want = new Map();
  const S = ts.SyntaxKind;
  (function walk(node) {
    if (node.kind === S.StringLiteral || node.kind === S.NoSubstitutionTemplateLiteral) want.set(node.getStart(sf), [node.text]);
    else if (node.kind === S.TemplateExpression || node.kind === S.TemplateLiteralType) {
      want.set(node.getStart(sf), [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]);
    }
    ts.forEachChild(node, walk);
  })(sf);
  const L = SD.lex(src);
  const bad = [...L.errors];
  for (const l of L.literals) {
    const w = want.get(l.start);
    const g = l.parts.map((p) => SD.cook(p.raw).text);
    if (!w) bad.push(`extra literal at line ${l.line}`);
    else if (JSON.stringify(w) !== JSON.stringify(g)) bad.push(`text differs at line ${l.line}`);
    want.delete(l.start);
  }
  for (const o of want.keys()) bad.push(`missed literal at offset ${o}`);
  return { bad, count: L.literals.length };
}
const TS = loadTypeScript();

test('lexer agrees with the TypeScript parser on every literal of the whole-file snapshots', { skip: TS ? false : 'typescript is not installed (npm root -g has no typescript)' }, () => {
  let n = 0;
  for (const rel of ['src/v2/app/catalog-list/honesty-disclosure.ts', 'src/v2/app/porkchop-smoke/main.ts', 'src/v2/core/units/utc-to-tdb.ts', 'src/v2/core/constants/asteroids.ts', 'src/v2/porkchop/delta-v.ts']) {
    const { bad, count } = oracleDiff(TS, rel, fs.readFileSync(path.join(SNAP, rel), 'utf8'));
    assert.deepEqual(bad, [], rel);
    n += count;
  }
  assert.ok(n > 40, `only ${n} literals compared`);
});

const LIVE = fs.existsSync(path.join(ASTER, 'src', 'v2'));
test('lexer agrees with the TypeScript parser on every file the CLI scans in the Aster checkout', { skip: !LIVE ? `no checkout at ${ASTER}` : TS ? false : 'typescript is not installed' }, () => {
  const files = execFileSync('git', ['ls-files', 'src/v2', 'mcp/src'], { cwd: ASTER, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$|\.d\.ts$/.test(f) && !/^src\/v2\/prototypes\//.test(f));
  let literals = 0;
  for (const f of files) {
    const { bad, count } = oracleDiff(TS, f, fs.readFileSync(path.join(ASTER, f), 'utf8'));
    assert.deepEqual(bad, [], f);
    literals += count;
  }
  assert.ok(files.length >= 100 && literals >= 4000, `${files.length} files, ${literals} literals`);
});

// Added in review: three places the first lexer read a slash or an escape differently from
// TypeScript (none occurs in Aster at 62ddb17, so the whole-checkout oracle could not see them).
test('lexer: a regex after a control head, division after a postfix ++, and the \\0 \\b \\f \\v escapes', () => {
  const cases = [
    ["if (a) /'/.test(b); const s = 'x';", ['x']],
    ["while (i--) /it's/.test(t); const s = 'w';", ['w']],
    ["x = a++ / 2; const s = '/';", ['/']],
    ["y = i-- / 2 / 3; const s = 'q';", ['q']],
    ["z = f(a)++ / 2; const s = 'r';", ['r']],
    ["const n = ++/x/.lastIndex; const s = 'p';", ['p']],
  ];
  for (const [src, want] of cases) {
    const L = SD.lex(src);
    assert.deepEqual(L.literals.map((l) => SD.cook(l.parts[0].raw).text), want, src);
    assert.deepEqual(L.errors, [], src);
    if (TS) assert.deepEqual(oracleDiff(TS, 'case.ts', src).bad, [], `TypeScript disagrees: ${src}`);
  }
  assert.equal(SD.cook('\\0 \\b\\f\\v').text, '\u0000 \b\f\v');
  if (TS) assert.deepEqual(oracleDiff(TS, 'esc.ts', "const e = '\\0\\b\\f\\v\\t';").bad, []);
});

// ------------------------------------------------------------------------------------------------
// Classifying literals and reading claims
// ------------------------------------------------------------------------------------------------

test('classifier: import, console, error, css, code, token and display', () => {
  const cls = (src) => {
    const L = SD.lex(src);
    return L.literals.map((l) => SD.classifyLiteral(l, SD.staticText(l).joined));
  };
  assert.deepEqual(cls("import d from './horizons-inner-solar-system-2026-2040.json';"), ['import']);
  assert.deepEqual(cls("const u = new URL('../../data/horizons-2026-2040.json', import.meta.url);"), ['token']);
  assert.deepEqual(cls("console.log('C3 ≤ 25 km²/s²');"), ['console']);
  assert.deepEqual(cls("throw new Error('expected 41906 bodies, 25 km²/s²');"), ['error']);
  assert.deepEqual(cls("h('div', { style: 'color:rgba(255,255,255,0.14);max-width:731px;' });"), ['token', 'css']);
  assert.deepEqual(cls("x({ width: '90%', top: '50%' });"), ['css', 'css']);
  assert.deepEqual(cls("const s = ['min-height:100vh', 'line-height:1.6'].join(';');"), ['css', 'css', 'token']);
  assert.deepEqual(cls('const g = `void main() { gl_FragColor = vec4(0.14, 1.0, 25.0, 1.0); }`;'), ['code']);
  assert.deepEqual(cls("const k = 'asteroid-433'; const d = '2040-01-01';"), ['token', 'token']);
  assert.deepEqual(cls("const span = '2026–2040';"), ['display']);
  assert.deepEqual(cls("h('p', null, 'Note: see the 2029 approach');"), ['token', 'display']);
  // a thrown string or template is developer text even without `new Error` (added in review)
  assert.deepEqual(cls("throw `no window in 2026–2040 for ${id}`;"), ['error']);
  assert.deepEqual(cls("if (bad) throw 'C3 above 25 km²/s²';"), ['error']);
});

// The word rule decides LITERAL-MATCHES-CONSTANT against LITERAL-WITH-UNITS; added in review
// because loosening its prefix test changed no test before.
test('name words: a five-letter prefix covering three quarters of the shorter word, and no looser', () => {
  assert.equal(SD.wordsAgree('feasible', 'feasibility'), true);
  assert.equal(SD.wordsAgree('coorbital', 'coorbitals'), true);
  assert.equal(SD.wordsAgree('depth', 'departure'), false);
  assert.equal(SD.wordsAgree('station', 'statistic'), false);
  assert.equal(SD.wordsAgree('albedo', 'albeit'), false);
  assert.deepEqual(SD.sharedWords('DETERMINISTIC_MARGIN_FRACTION', 'Margin policy: deterministic 5% margin'), ['deterministic', 'margin']);
  assert.deepEqual(SD.sharedWords('metadata.feasibleC3MaxKm2S2', 'the feasibility threshold'), ['feasible']);
  assert.deepEqual(SD.sharedWords('ALBEDO_C_COMPLEX', 'surface reflectivities (0.053–0.166)'), ['albedo']);
  assert.deepEqual(SD.sharedWords('SPATIAL_GRID_CELL_SIZE_AU', 'semi-major axis within 0.05 AU of 1 AU'), []);
});

test('claims: dates, spans, unit-bearing numbers, powers of ten, multipliers, and what is not a claim', () => {
  const c = SD.claimsIn('C3 = 21–29 and 10⁶ km, 2.5×10^3 m/s, 0.46 to 330 million km, 1840s-50s, 320 s, 5%, ~39 deg, 2026–2040, 2040-12-31, 0.14.');
  assert.deepEqual(
    c.map((x) => [x.kind, x.text, x.values || x.value, x.dim]),
    [
      ['qty', 'C3 = 21–29', [21, 29], 'c3'],
      ['qty', '10⁶ km', [1e6], 'length'],
      ['qty', '2.5×10^3 m/s', [2500], 'speed'],
      ['qty', '0.46 to 330 million km', [460000, 330000000], 'length'],
      ['qty', '320 s', [320], 'time'],
      ['qty', '5%', [5], 'fraction'],
      ['qty', '~39 deg', [39], 'angle'],
      ['span', '2026–2040', ['2026', '2040'], 'year'],
      ['date', '2040-12-31', '2040-12-31', 'date'],
      ['bare', '0.14', [0.14], 'ratio'],
    ],
  );
  // a decade is not seconds, a year alone is not a span; a bare decimal (Slice 19.5) is only a
  // candidate, reported solely when it equals a constant whose name shares a word with the text
  assert.deepEqual(SD.claimsIn('the 1840s-50s; Apophis in 2029; Slice 19.5; M=0').map((x) => [x.kind, x.text]), [['bare', '19.5']]);
  // a half span next to an interpolation
  assert.deepEqual(SD.claimsIn(`${SD.SENTINEL}–2040 departures`).map((x) => [x.kind, x.value]), [['span', ['2040']]]);
});

test('significant figures and names: the two rules the duplicate passes rest on', () => {
  assert.deepEqual(['69.184', '946_728_000', '0.150', '0.10', '86_400', '2451545.0', '1e9', '255', '0.0015'].map(SD.sigFigs), [5, 6, 3, 2, 3, 8, 1, 3, 2]);
  assert.deepEqual(
    ['metadata.feasibleC3MaxKm2S2', 'STATIONKEEPING_DV_KMPS', 'SPACECRAFT_STATIONKEEPING_MPS', 'AU_M', 'FOCUS_TRANSITION_DURATION_MS', 'J2000_TDB_JULIAN_DAY', 'coorbitalCriteria.aDeltaKm', 'ASTEROID_DEFAULT_ALBEDO', 'tofMinDays'].map((n) => SD.dimFromName(n).dim),
    ['c3', 'speed', 'speed', 'length', 'time', 'epoch', 'length', 'ratio', 'time'],
  );
});

// ------------------------------------------------------------------------------------------------
// Matching with units, against closed forms
// ------------------------------------------------------------------------------------------------

test('unit conversion: 0.05 AU is the cache metadata\'s aDeltaKm, 150 m/s is 0.150 km/s, 5% is 0.05', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(SNAP, 'docs/lambert-screen-cache.json'), 'utf8')).metadata;
  // IAU 2012 Resolution B2: 1 au = 149 597 870 700 m exactly, so 0.05 au = 7 479 893.535 km
  assert.equal(meta.coorbitalCriteria.aDeltaKm, 7479893.535);
  const canon = SD.harvestJson('cache', meta, 'metadata');
  const claim = SD.claimsIn('semi-major axis within 0.05 AU of 1 AU')[0];
  assert.deepEqual(SD.matchClaim(claim, canon).map((h) => h.name), ['metadata.coorbitalCriteria.aDeltaKm']);
  const near = SD.claimsIn('within 0.051 AU')[0];
  assert.deepEqual(SD.matchClaim(near, canon), []);
  const homes = SD.harvestTs('a.ts', 'export const STATIONKEEPING_DV_KMPS = 0.150;\nexport const DETERMINISTIC_MARGIN_FRACTION = 0.05;\n');
  assert.deepEqual(SD.matchClaim(SD.claimsIn('stationkeeping 150 m/s')[0], homes).map((h) => h.name), ['STATIONKEEPING_DV_KMPS']);
  assert.deepEqual(SD.matchClaim(SD.claimsIn('a 5% margin')[0], homes).map((h) => h.name), ['DETERMINISTIC_MARGIN_FRACTION']);
  assert.deepEqual(SD.matchClaim(SD.claimsIn('a 0.05% margin')[0], homes), []);
});

// Every display unit's scale, pinned against Aster's own constants in the snapshot tree (added in
// review: a wrong km or year factor was caught only by the live byte-for-byte run before).
test("units: each display unit equals Aster's own constant of that size (km, m, day, hour, s, year, m/s)", () => {
  const read = (rel) => fs.readFileSync(path.join(SNAP, rel), 'utf8');
  const canon = [
    ...SD.harvestTs('src/v2/core/constants/asteroids.ts', read('src/v2/core/constants/asteroids.ts')),
    ...SD.harvestTs('src/v2/porkchop/delta-v.ts', read('src/v2/porkchop/delta-v.ts')),
    ...SD.harvestTs('src/v2/app/porkchop/main.ts', read('src/v2/app/porkchop/main.ts')),
  ];
  const hits = (text) => SD.matchClaim(SD.claimsIn(text)[0], canon).map((h) => h.name).sort();
  // ASTEROID_KEPLERIAN_ERROR_BAR_M = 100_000_000 m (asteroids.ts:11) is 10^5 km
  assert.deepEqual(hits('at 10^5 km, none moved'), ['ASTEROID_KEPLERIAN_ERROR_BAR_M']);
  assert.deepEqual(hits('drift of 100,000,000 m'), ['ASTEROID_KEPLERIAN_ERROR_BAR_M']);
  // ASTEROID_PROPAGATION_CADENCE_SECONDS = 86_400 (asteroids.ts:10) is one day, 24 hours, 1440 min
  for (const t of ['every 1 day', 'every 24 hours', 'every 1440 min', 'every 86,400 s']) assert.deepEqual(hits(t), ['ASTEROID_PROPAGATION_CADENCE_SECONDS'], t);
  // LEO_PARKING_RADIUS_KM = 6_578.137 (delta-v.ts:4) in km and in m
  assert.deepEqual(hits('r = 6,578.137 km'), ['LEO_PARKING_RADIUS_KM']);
  assert.deepEqual(hits('r = 6578137 m'), ['LEO_PARKING_RADIUS_KM']);
  // a year is the Julian year: GRID_PARAMS.tofMaxDays = 1826.25 d is 5 of them, while the lower
  // bound 182.5 d is half of 365 d, not half a Julian year (182.625 d), so it must not match
  assert.deepEqual(hits('flights up to 5 years'), ['GRID_PARAMS.tofMaxDays']);
  assert.deepEqual(hits('flights of 0.5 years'), []);
  // STATIONKEEPING_DV_KMPS = 0.150 km/s (delta-v.ts:5) is 150 m/s; 0.15 km/s says the same
  assert.deepEqual(hits('stationkeeping 150 m/s'), ['STATIONKEEPING_DV_KMPS']);
  assert.deepEqual(hits('stationkeeping 0.15 km/s'), ['STATIONKEEPING_DV_KMPS']);
  assert.deepEqual(hits('stationkeeping 151 m/s'), []);
  // the unit table's own scales, as closed forms
  assert.equal(SD.unitInfo('km').toBase, 1000);
  assert.equal(SD.unitInfo('day').toBase, 24 * 3600);
  assert.equal(SD.unitInfo('rad').toBase, 180 / Math.PI);
});

test('harvest: depth-0 constants and first-level object fields, with their lines; locals are not homes', () => {
  const src = [
    'export const A_KM = 6_578.137;',
    "const START_UTC = '2026-01-01';",
    'export const GRID = {',
    "  depEndJD: toJd('2040-01-01'),",
    '  tofMinDays: 182.5,',
    '  nested: { deep: 3 },',
    '} as const;',
    'function f() { const local = 69.184; return local; }',
    'export const NOT_LITERAL = A_KM * 2;',
  ].join('\n');
  assert.deepEqual(
    SD.harvestTs('x.ts', src).map((h) => [h.name, h.text, h.line, h.dim, h.exported]),
    [
      ['A_KM', '6_578.137', 1, 'length', true],
      ['START_UTC', '2026-01-01', 2, 'date', false],
      ['GRID.depEndJD', '2040-01-01', 4, 'date', true],
      ['GRID.tofMinDays', '182.5', 5, 'time', true],
    ],
  );
  // and in Aster: the elvperf date is module-private, the margin is exported (launch-vehicles.ts)
  const lv = SD.harvestTs('src/v2/porkchop/launch-vehicles.ts', fs.readFileSync(path.join(SNAP, 'src/v2/porkchop/launch-vehicles.ts'), 'utf8'));
  assert.deepEqual(lv.filter((h) => ['ELVPERF_AS_OF', 'DETERMINISTIC_MARGIN_FRACTION'].includes(h.name)).map((h) => [h.name, h.line, h.exported]), [
    ['DETERMINISTIC_MARGIN_FRACTION', 59, true],
    ['ELVPERF_AS_OF', 66, false],
  ]);
});

// Added in review: a date typed in two files where one site is the only named home reports only
// the copies; with two homes every site is reported. Only the live run covered this before.
test('duplicate dates: one named home reports only the copies, two homes report every site', () => {
  const files = {
    'src/v2/a.ts': "export const WINDOW_END_UTC = '2040-01-01';\n",
    'src/v2/b.ts': "export function f() {\n  return toJd('2040-01-01');\n}\n",
  };
  const run = (fs2) => {
    const canon = Object.entries(fs2).flatMap(([p, s]) => SD.harvestTs(p, s));
    const scans = Object.entries(fs2).map(([p, s]) => SD.scanSource(p, s, new Set(canon.map((h) => h.name))));
    return SD.buildReport(scans, canon).findings.filter((f) => f.class === 'DUPLICATE-DATE').map((f) => `${f.path}:${f.line} ${f.homes.map((h) => h.name).join(',')}`);
  };
  assert.deepEqual(run(files), ['src/v2/b.ts:2 WINDOW_END_UTC']);
  assert.deepEqual(run({ ...files, 'src/v2/c.ts': "const GRID_END_UTC = '2040-01-01';\n" }), [
    'src/v2/a.ts:1 GRID_END_UTC',
    'src/v2/b.ts:2 WINDOW_END_UTC,GRID_END_UTC',
    'src/v2/c.ts:1 WINDOW_END_UTC',
  ]);
});

// Added in review: constants computed by arithmetic. They name a home for a retyped literal that
// no literal constant holds (the first run said "no named home" for 946_728_000, which the core
// computes as UNIX_TO_J2000_SECONDS), and never make a finding of their own.
test('computed constants: evaluated with their names resolved, never canon, never a finding', () => {
  const src = [
    'export const A_DAYS = 10957.5;',
    'export const B_SECONDS = A_DAYS * SECONDS_PER_DAY;',
    'const C = -(2 ** 3) / (4 - 2) + 1;',
    'const D = Math.PI / 3;',
    'export const E = Math.sqrt(2) * A_DAYS;',
    "const F = A_DAYS * 2 + 'x';",
    'const G = UNKNOWN_NAME * 2;',
    'const H = (B_SECONDS / 2) as const;',
    'function local() { const I = A_DAYS * 2; return I; }',
  ].join('\n');
  const found = SD.harvestComputed('x.ts', src);
  assert.deepEqual(found.map((c) => [c.name, c.expr, c.line, c.exported]), [
    ['B_SECONDS', 'A_DAYS * SECONDS_PER_DAY', 2, true],
    ['C', '-(2 ** 3) / (4 - 2) + 1', 3, false],
    ['D', 'Math.PI / 3', 4, false],
    ['G', 'UNKNOWN_NAME * 2', 7, false],
    ['H', '(B_SECONDS / 2)', 8, false],
  ]);
  const canon = [...SD.harvestTs('x.ts', src), ...SD.harvestTs('u.ts', 'export const SECONDS_PER_DAY = 86400;\n'), ...SD.harvestTs('v.ts', 'const SECONDS_PER_DAY = 86400;\n')];
  const vals = Object.fromEntries(SD.resolveComputed(found, canon).map((c) => [c.name, c.value]));
  assert.deepEqual(vals, { B_SECONDS: 946728000, C: -3, D: Math.PI / 3, H: 473364000 });
  // two homes of one name that disagree resolve nothing
  const split = SD.resolveComputed(found, [...canon, ...SD.harvestTs('w.ts', 'const SECONDS_PER_DAY = 86401;\n')]);
  assert.equal(split.find((c) => c.name === 'B_SECONDS'), undefined);
  // a name in the same file wins over another file's
  const local = SD.harvestComputed('y.ts', 'const SECONDS_PER_DAY = 1;\nconst K = 2 * SECONDS_PER_DAY;\n');
  assert.equal(SD.resolveComputed(local, [...canon, ...SD.harvestTs('y.ts', 'const SECONDS_PER_DAY = 1;\n')])[0].value, 2);

  // In Aster (snapshot tree): the core computes UNIX_TO_J2000_SECONDS = UNIX_TO_J2000_DAYS *
  // SECONDS_PER_DAY (utc-to-tdb.ts:31, SECONDS_PER_DAY from units.ts:2). The closed form is J2000
  // (2000-01-01 12:00) minus the Unix epoch, in seconds.
  const read = (rel) => fs.readFileSync(path.join(SNAP, rel), 'utf8');
  const core = ['src/v2/core/units.ts', 'src/v2/core/units/utc-to-tdb.ts'];
  const coreCanon = core.flatMap((p) => SD.harvestTs(p, read(p)));
  const coreComputed = SD.resolveComputed(core.flatMap((p) => SD.harvestComputed(p, read(p))), coreCanon);
  const unix = coreComputed.find((c) => c.name === 'UNIX_TO_J2000_SECONDS');
  assert.equal(unix.value, (Date.UTC(2000, 0, 1, 12) - Date.UTC(1970, 0, 1)) / 1000);
  assert.equal(unix.line, 31);
  assert.equal(unix.exported, false);
  // ARCSECONDS_TO_RADIANS and the J2000 obliquity, against their closed forms
  assert.equal(coreComputed.find((c) => c.name === 'ARCSECONDS_TO_RADIANS').value, Math.PI / (180 * 3600));
  assert.ok(Math.abs(coreComputed.find((c) => c.name === 'J2000_ECLIPTIC_OBLIQUITY_RAD').value - ((84381.448 / 3600) * Math.PI) / 180) < 1e-15);

  // never a finding: an exported computed value typed once elsewhere is not reported; typed in two
  // files it is RETYPED-CONSTANT and names the computed constant as its home
  const scan = (p, s) => SD.scanSource(p, s, new Set());
  const coreFiles = [['core.ts', 'export const A_DAYS = 10957.5;\nexport const B_SECONDS = A_DAYS * 86400;\n']];
  const cc = coreFiles.flatMap(([p, s]) => SD.harvestTs(p, s));
  const comp = SD.resolveComputed(coreFiles.flatMap(([p, s]) => SD.harvestComputed(p, s)), cc);
  const once = SD.buildReport([...coreFiles, ['app.ts', 'const t = 946_728_000;\n']].map(([p, s]) => scan(p, s)), cc, { computed: comp });
  assert.deepEqual(once.findings, []);
  const twice = SD.buildReport([...coreFiles, ['app.ts', 'const t = 946_728_000;\n'], ['mcp.ts', 'const u = 946728000;\n']].map(([p, s]) => scan(p, s)), cc, { computed: comp });
  assert.deepEqual(twice.findings.map((f) => `${f.class} ${f.path}:${f.line} ${f.homes.map((h) => `${h.name}=${h.value}@${h.at}${h.computed ? '*' : ''}`).join()}`), [
    'RETYPED-CONSTANT app.ts:1 B_SECONDS=A_DAYS * 86400 = 946728000@core.ts:2*',
    'RETYPED-CONSTANT mcp.ts:1 B_SECONDS=A_DAYS * 86400 = 946728000@core.ts:2*',
  ]);
  assert.match(twice.findings[0].context, /no literal home, but a constant computes it/);
  // and without the computed list the same run says no top-level constant holds it
  const bare = SD.buildReport([...coreFiles, ['app.ts', 'const t = 946_728_000;\n'], ['mcp.ts', 'const u = 946728000;\n']].map(([p, s]) => scan(p, s)), cc);
  assert.match(bare.findings[0].context, /no top-level constant holds it/);
});

// ------------------------------------------------------------------------------------------------
// The synthetic fixture tree: every case in one place, the exact findings list
// ------------------------------------------------------------------------------------------------

test('fixture tree: the exact findings, and nothing from comments, CSS, imports, console, errors, regexes, shaders, tests or prototypes', () => {
  const { code, report } = jsonRun(TREE);
  assert.equal(code, 1);
  assert.deepEqual(report.findings.map(key), [
    'LITERAL-MATCHES-CONSTANT mcp/src/tools/tool.ts:1 5%',
    'LITERAL-MATCHES-CONSTANT src/v2/app/overlay.ts:2 150 m/s',
    'LITERAL-MATCHES-CONSTANT src/v2/app/panel.ts:12 ≤ 25 km²/s²',
    'LITERAL-MATCHES-CONSTANT src/v2/app/panel.ts:14 0.14',
    'LITERAL-MATCHES-CONSTANT v2/page/index.html:4 ≤ 25 km²/s²',
    'LITERAL-DATE-SPAN src/v2/app/panel.ts:11 2026–2040',
    'LITERAL-DATE-SPAN v2/page/index.html:4 2026–2040',
    'RETYPED-CONSTANT src/v2/app/cal-a.ts:3 block of 3 literals',
    'RETYPED-CONSTANT src/v2/app/panel.ts:5 69.184',
    'RETYPED-CONSTANT src/v2/porkchop/cal-b.ts:3 block of 3 literals',
    "DUPLICATE-DATE mcp/src/tools/tool.ts:2 '2040-01-01'",
    "DUPLICATE-DATE src/v2/app/grid.ts:5 '2040-01-01'",
    "DUPLICATE-DATE src/v2/app/overlay.ts:2 '2040-01-01'",
    "DUPLICATE-DATE src/v2/app/panel.ts:6 '2040-01-01'",
    'TWO-HOMES src/v2/core/constants/thresholds.ts:2 FEASIBLE_C3_MAX_KM2_S2 = 25',
    'TWO-HOMES src/v2/core/constants/thresholds.ts:4 STATIONKEEPING_DV_KMPS = 0.150',
    'LITERAL-WITH-UNITS src/v2/app/orbit.ts:2 1 AU',
    'LITERAL-WITH-UNITS src/v2/app/panel.ts:13 < 1 kg',
  ]);
  const au = report.findings.find((f) => f.path === 'src/v2/app/orbit.ts');
  assert.deepEqual(au.alsoEqual.map((h) => h.name).sort(), ['CELL_SIZE_AU', 'HELIO_RADIUS_AU'], 'equal values with no shared word are shown, not matched');
  const c3 = report.findings.find((f) => f.path === 'src/v2/app/panel.ts' && f.line === 12);
  assert.deepEqual(c3.homes.map((h) => `${h.name}@${h.at}`), ['metadata.feasibleC3MaxKm2S2@tests/fixtures/v2/lambert-screen-cache.json:1', 'FEASIBLE_C3_MAX_KM2_S2@src/v2/core/constants/thresholds.ts:2']);
  // the derived sentence: every number arrives through ${}, one level of indirection named
  assert.deepEqual(report.derived.map((d) => `${d.path}:${d.line} ${d.reads}${d.via ? ` <- ${d.via.join(',')}` : ''}`), [
    'src/v2/app/grid.ts:12 SPAN_LABEL <- GRID.depStartJD,GRID.depEndJD',
    'src/v2/app/grid.ts:12 GRID.tofMinDays',
    'src/v2/app/grid.ts:12 GRID.tofMaxDays',
  ]);
  assert.deepEqual(report.dateGroups[0].sameYear, [{ name: 'metadata.screeningWindow.endUtc', value: '2040-12-31', at: 'tests/fixtures/v2/lambert-screen-cache.json:1' }]);
  assert.equal(report.meta.scanned.ts, 10);
  assert.equal(report.meta.scanned.html, 1);
  assert.equal(report.failing.length, 16);
  // at three significant figures 86_400 joins the copied block
  const three = jsonRun(TREE, ['--min-sig', '3']).report.findings.filter((f) => f.class === 'RETYPED-CONSTANT' && f.path.includes('/cal-'));
  assert.deepEqual(three.map((f) => `${f.path}:${f.line} ${f.literal}`), ['src/v2/app/cal-a.ts:2 block of 4 literals', 'src/v2/porkchop/cal-b.ts:2 block of 4 literals']);
  assert.match(three[0].context, /lines 2-4 \(86400, 1867216\.25, 36524\.25, 30\.6001\) repeat src\/v2\/porkchop\/cal-b\.ts:2-4/);
});

// ------------------------------------------------------------------------------------------------
// Allow-list and command line
// ------------------------------------------------------------------------------------------------

function tmpFile(name, obj) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('allow-list: a reason is required, one entry suppresses one finding, a line-free id covers the file, stale entries are named', () => {
  const one = tmpFile('a.json', { entries: [{ id: 'RETYPED-CONSTANT|src/v2/app/panel.ts:5|69.184', reason: 'synthetic: proving one entry suppresses one finding' }] });
  let r = jsonRun(TREE, ['--allowlist', one]);
  assert.equal(r.code, 1);
  assert.equal(r.report.failing.length, 15);
  assert.equal(r.report.findings.filter((f) => f.allowed).length, 1);

  const noReason = tmpFile('b.json', { entries: [{ id: 'RETYPED-CONSTANT|src/v2/app/panel.ts:5|69.184', reason: ' ' }] });
  r = jsonRun(TREE, ['--allowlist', noReason]);
  assert.equal(r.code, 2);
  assert.equal(r.report.failing.length, 16, 'an entry without a reason suppresses nothing');
  assert.match(r.report.allowlist.errors[0], /has no reason/);

  const lineFree = tmpFile('c.json', { entries: [{ id: "DUPLICATE-DATE|src/v2/app/panel.ts|'2040-01-01'", reason: 'synthetic: any line in the file' }, { id: 'TWO-HOMES|nowhere.ts:1|X = 1', reason: 'synthetic: matches nothing' }] });
  r = jsonRun(TREE, ['--allowlist', lineFree]);
  assert.equal(r.report.failing.length, 15);
  assert.deepEqual(r.report.allowlist.unused, ['TWO-HOMES|nowhere.ts:1|X = 1']);

  const all = tmpFile('d.json', { entries: jsonRun(TREE).report.failing.map((id) => ({ id, reason: 'synthetic: allow everything to reach exit 0' })) });
  r = cli([TREE, '--allowlist', all]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Result: 0 failing finding\(s\) after the allow-list; 2 informational\./);
  assert.equal(cli([TREE, '--allowlist', all, '--strict']).code, 1, '--strict fails on the informational class');
});

test('command line: help, refusals and exit codes', () => {
  const h = cli(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /Usage: node said-vs-derived\.mjs/);
  const notAster = cli([HERE]);
  assert.equal(notAster.code, 2);
  assert.match(notAster.err, /is not an Aster checkout \(no src\/v2\/\)\. Nothing was scanned\./);
  assert.equal(cli([TREE, '--format', 'xml']).code, 2);
  assert.equal(cli([TREE, '--bogus']).code, 2);
  assert.equal(cli([TREE, '--allowlist', path.join(HERE, 'no-such.json')]).code, 2);
  // without the cache the threshold has no home in the snapshot tree's words, and the run says so
  const nc = cli([SNAP, '--no-cache']);
  assert.match(nc.out, /Cache metadata: NOT READ, skipped \(--no-cache\)/);
  assert.match(nc.out, /- `src\/v2\/app\/catalog-list\/honesty-disclosure\.ts:59` `≤ 25 km²\/s²`\n  - …departure, time-of-flight\) window in \$\{…\} with departure C3 ≤ 25/);
  assert.doesNotMatch(nc.out, /honesty-disclosure\.ts:59` `≤ 25 km²\/s²` = /);
  const wrongCache = cli([SNAP, '--cache', 'src/v2/porkchop/delta-v.ts']);
  assert.match(wrongCache.out, /Cache metadata: NOT READ, no complete "metadata" object in the first \d+ bytes of src\/v2\/porkchop\/delta-v\.ts/);
});

// ------------------------------------------------------------------------------------------------
// Reconciliation: Aster's own files (snapshots/aster, always present)
// ------------------------------------------------------------------------------------------------

const snapRun = jsonRun(SNAP).report;
const at = (p, l) => snapRun.findings.filter((f) => f.path === p && f.line === l);

test('Aster: the catalog disclosure types the 25 km²/s² threshold the compare view reads from the cache metadata', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(SNAP, 'docs/lambert-screen-cache.json'), 'utf8')).metadata;
  assert.equal(meta.feasibleC3MaxKm2S2, 25);
  const [f] = at('src/v2/app/catalog-list/honesty-disclosure.ts', 59);
  assert.equal(f.class, 'LITERAL-MATCHES-CONSTANT');
  assert.equal(f.literal, '≤ 25 km²/s²');
  assert.deepEqual(f.homes.map((h) => [h.name, h.value]), [['metadata.feasibleC3MaxKm2S2', String(meta.feasibleC3MaxKm2S2)]]);
  // DEC-17-5(a)'s runtime read exists on compare, and the scanner sees it
  assert.deepEqual(snapRun.runtimeReads.map((r) => `${r.reads}@${r.path}:${r.line}`), ['metadata.feasibleC3MaxKm2S2@src/v2/app/compare/main.ts:956']);
  // and the co-orbital paragraph types the cache's aDeltaKm as 0.05 AU
  const [au] = at('src/v2/app/catalog-list/honesty-disclosure.ts', 68).filter((x) => x.class === 'LITERAL-MATCHES-CONSTANT');
  assert.equal(au.literal, '0.05 AU');
  assert.deepEqual(au.homes.map((h) => h.name), ['metadata.coorbitalCriteria.aDeltaKm']);
});

test('Aster: compare types the albedo range its own constants hold, two lines from a note that reads them', () => {
  const lits = (l) => at('src/v2/app/compare/main.ts', l).filter((f) => f.class === 'LITERAL-MATCHES-CONSTANT').map((f) => `${f.literal}=${f.homes[0].name}@${f.homes[0].at}`);
  assert.deepEqual(lits(270), ['0.053=ALBEDO_C_COMPLEX@src/v2/app/compare/main.ts:222', '0.166=ALBEDO_S_COMPLEX@src/v2/app/compare/main.ts:223']);
  assert.deepEqual(lits(842), ['0.053=ALBEDO_C_COMPLEX@src/v2/app/compare/main.ts:222', '0.14=ASTEROID_DEFAULT_ALBEDO@src/v2/core/constants/asteroids.ts:9', '0.166=ALBEDO_S_COMPLEX@src/v2/app/compare/main.ts:223']);
  const src = fs.readFileSync(path.join(SNAP, 'src/v2/app/compare/main.ts'), 'utf8').split('\n');
  assert.match(src[222 - 1], /export const ALBEDO_C_COMPLEX = 0\.053;/);
  assert.match(src[271 - 1], /\$\{COMPARE_DEFAULT_ALBEDO\}/);
});

test('Aster: the MCP types the 5% margin the porkchop page derives from DETERMINISTIC_MARGIN_FRACTION', () => {
  const mcp = snapRun.findings.filter((f) => f.class === 'LITERAL-MATCHES-CONSTANT' && f.path.startsWith('mcp/')).map((f) => `${f.path}:${f.line} ${f.literal} ${f.homes[0].name}=${f.homes[0].value}`);
  assert.deepEqual(mcp, [
    'mcp/src/tools/estimate-mission-cost.ts:247 5% DETERMINISTIC_MARGIN_FRACTION=0.05',
    'mcp/src/tools/estimate-mission-cost.ts:270 5% DETERMINISTIC_MARGIN_FRACTION=0.05',
    'mcp/src/tools/explain-cell.ts:264 5% DETERMINISTIC_MARGIN_FRACTION=0.05',
  ]);
  assert.ok(snapRun.derived.some((d) => d.path === 'src/v2/app/porkchop/main.ts' && d.line === 892 && d.reads === 'DETERMINISTIC_MARGIN_PERCENT' && d.via.join() === 'DETERMINISTIC_MARGIN_FRACTION'));
});

test("Aster: the porkchop 'Grid spans' sentence is derived (STATUS.md's Slice 19 item 1 is stale)", () => {
  assert.deepEqual(at('src/v2/app/porkchop/main.ts', 647), []);
  const reads = snapRun.derived.filter((d) => d.path === 'src/v2/app/porkchop/main.ts' && d.line === 647).map((d) => `${d.reads}${d.via ? ` <- ${d.via.join(',')}` : ''}`);
  assert.deepEqual(reads, ['PORKCHOP_DEPARTURE_SPAN_LABEL <- GRID_PARAMS.depStartJD,GRID_PARAMS.depEndJD', 'GRID_PARAMS.tofMinDays', 'GRID_PARAMS.tofMaxDays']);
  // the only literal date on that page is the elvperf query date
  assert.deepEqual(snapRun.findings.filter((f) => f.class === 'LITERAL-DATE-SPAN').map(key), [
    'LITERAL-DATE-SPAN mcp/src/tools/compute-shared.ts:367 2024-02-29',
    'LITERAL-DATE-SPAN src/v2/app/porkchop/main.ts:889 2026-07-02',
  ]);
});

test("Aster: '2040-01-01' is typed in exactly four files, and the cache's window ends 2040-12-31 (S17-F2)", () => {
  const g = snapRun.dateGroups.find((x) => x.value === '2040-01-01');
  assert.deepEqual(g.sites, ['src/v2/app/compare/main.ts:107', 'src/v2/app/porkchop-smoke/main.ts:66', 'src/v2/app/porkchop/main.ts:196', 'src/v2/app/ui-overlay/overlay.ts:161']);
  assert.deepEqual(g.sameYear.map((y) => `${y.name}=${y.value}`), ['metadata.screeningWindow.endUtc=2040-12-31']);
  assert.equal(snapRun.dateGroups.find((x) => x.value === '2026-01-01').files.length, 4);
});

test('Aster: TDB−UTC 69.184 s, owned by the core, is retyped at seven sites in five files', () => {
  const sites = snapRun.findings.filter((f) => f.class === 'RETYPED-CONSTANT' && f.literal === '69.184');
  assert.deepEqual(sites.map((f) => `${f.path}:${f.line}`), [
    'mcp/src/tools/compute-shared.ts:136',
    'mcp/src/tools/compute-shared.ts:144',
    'src/v2/app/compare/main.ts:96',
    'src/v2/app/porkchop-smoke/main.ts:33',
    'src/v2/app/porkchop/main.ts:167',
    'src/v2/app/porkchop/main.ts:189',
    'src/v2/app/ui-overlay/overlay.ts:153',
  ]);
  for (const f of sites) assert.deepEqual(f.homes.map((h) => `${h.name}@${h.at}`), ['TDB_MINUS_UTC_SECONDS@src/v2/core/units/utc-to-tdb.ts:28']);
  const core = fs.readFileSync(path.join(SNAP, 'src/v2/core/units/utc-to-tdb.ts'), 'utf8').split('\n');
  assert.equal(core[28 - 1], 'export const TDB_MINUS_UTC_SECONDS = 69.184;');
  // beside each, 946_728_000: no literal constant holds it, but the core computes it (review)
  const unix = snapRun.findings.filter((f) => f.class === 'RETYPED-CONSTANT' && f.literal === '946_728_000');
  assert.deepEqual(unix.map((f) => `${f.path}:${f.line}`), [
    'mcp/src/tools/compute-shared.ts:135',
    'mcp/src/tools/compute-shared.ts:143',
    'src/v2/app/compare/main.ts:95',
    'src/v2/app/porkchop-smoke/main.ts:32',
    'src/v2/app/porkchop/main.ts:167',
    'src/v2/app/porkchop/main.ts:188',
    'src/v2/app/ui-overlay/overlay.ts:152',
  ]);
  for (const f of unix) {
    assert.deepEqual(f.homes.map((h) => `${h.name}@${h.at}${h.computed ? ' computed' : ''}`), ['UNIX_TO_J2000_SECONDS@src/v2/core/units/utc-to-tdb.ts:31 computed']);
    assert.match(f.context, /typed in 5 files; no literal home, but a constant computes it/);
  }
  assert.equal(core[31 - 1], 'const UNIX_TO_J2000_SECONDS = UNIX_TO_J2000_DAYS * SECONDS_PER_DAY;');
});

// ------------------------------------------------------------------------------------------------
// Saved outputs and the live checkout
// ------------------------------------------------------------------------------------------------

function pageData() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, 'page-data.js'), 'utf8'), ctx);
  return ctx.window.SAID_DERIVED_RUN;
}
const example = fs.readFileSync(path.join(HERE, 'example.txt'), 'utf8');

test('saved outputs: page-data.js and example.txt are the same run', () => {
  const d = pageData();
  for (const c of SD.CLASS_ORDER) {
    const row = new RegExp(`^\\| ${c} \\| (\\d+) \\| (\\d+) \\|`, 'm').exec(example);
    assert.equal(Number(row[1]), d.counts[c], c);
    assert.equal(Number(row[2]), d.findings.filter((f) => f.class === c && f.allowed).length, c);
  }
  const result = /Result: (\d+) failing finding\(s\) after the allow-list; (\d+) informational\./.exec(example);
  assert.equal(Number(result[1]), d.failing.length);
  for (const f of d.findings) assert.ok(example.includes(`\`${f.path}:${f.line}\``), `${f.path}:${f.line} missing from example.txt`);
  assert.match(example, new RegExp(`^Checkout: ${ASTER} at ${d.meta.commit}$`, 'm'));
  assert.ok(d.canon.length === d.meta.canon.total);
});

const exampleCommit = /^Checkout: \S+ at ([0-9a-f]{7,})$/m.exec(example)?.[1];
const liveHead = LIVE ? spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ASTER, encoding: 'utf8' }).stdout.trim() : null;
test('live: a fresh run against the checkout reproduces example.txt byte for byte', { skip: !LIVE ? `no checkout at ${ASTER}` : liveHead !== exampleCommit ? `checkout is at ${liveHead}, example.txt was made at ${exampleCommit}` : false }, () => {
  const r = cli([ASTER, '--allowlist', ALLOW]);
  assert.equal(r.code, 1);
  assert.equal(r.out, example);
});

test('live: the proposal\'s cited lines are what the checkout says', { skip: !LIVE ? `no checkout at ${ASTER}` : false }, () => {
  const read = (p) => fs.readFileSync(path.join(ASTER, p), 'utf8').split('\n');
  assert.match(read('src/v2/app/catalog-list/honesty-disclosure.ts')[59 - 1], /departure C3 ≤ 25 km²\/s²/);
  assert.match(read('src/v2/app/compare/main.ts')[956 - 1], /absoluteKm2S2: screenCache\.metadata\.feasibleC3MaxKm2S2/);
  assert.match(read('src/v2/app/porkchop/main.ts')[203 - 1], /PORKCHOP_DEPARTURE_SPAN_LABEL = `\$\{jdTdbToUtcDateString\(GRID_PARAMS\.depStartJD\)\}/);
  // STATUS.md still calls the porkchop literal live; the fix is commit 446e3a7
  assert.match(read('STATUS.md')[418 - 1], /main\.ts:637` renders the hardcoded string "Grid spans 2026-2040 departures/);
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', '446e3a7', 'HEAD'], { cwd: ASTER }).status, 0);
  assert.match(read('SLICE_17_FOUNDING.md')[203 - 1], /Riders: \(a\) 25 km²\/s² feasibility threshold disclosed — runtime read of/);
  assert.match(read('src/v2/SLICE_19_5_FOUNDING.md')[176 - 1], /DEC-19\.5-8 — Date and span labels are derived/);
});
