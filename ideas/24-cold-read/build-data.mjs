#!/usr/bin/env node
// build-data.mjs — derives Cold Read's two generated files from a PartForge checkout.
//
//   node ideas/24-cold-read/build-data.mjs [/path/to/Partforge]      (default /home/user/Partforge)
//
// 1. snapshots/app-rules.js — the app's own declaration rules, copied VERBATIM out of
//    PartForge's index.html and wrapped so they load as a classic script (window.PartForgeRules)
//    and with require(): the DECL-BEGIN..DECL-END block (parseFlight, flightLint,
//    flightContradictions, the vocabularies and FLIGHT_CAP), parseSpec(), the hobby lint(),
//    parseManifest(), mainPlainUnion(), topLevelIsOnlyMain(), the PARAM_RE literal and the
//    statement the gate uses to list defined modules. A handful of regex literals that live
//    inside parseFlight/parseSpec (the revolve TYPES, the load checks, the block regexes) are
//    lifted out as literals so messages can name the vocabulary without retyping it. Every
//    piece records the index.html lines it came from. If a pattern below stops matching,
//    this script fails instead of guessing.
// 2. snapshots/app-templates.js — the 10 hobby and 7 flight templates the app ships
//    (TEMPLATES and TEMPLATES_FLIGHT in index.html), evaluated from their array literals. A
//    shipped flight template whose text is byte-identical to a tests/templates fixture is
//    stored as a reference to that fixture plus its sha256 (no second copy); one that differs
//    is stored in full.
// 3. snapshots/fixtures/*.scad.js and snapshots/*-cases.js — each PartForge test fixture
//    (tests/dryrun/*.scad, tests/templates/*.scad, tests/dryrun/cases.json,
//    tests/flight-templates-cases.json) wrapped VERBATIM as a JS string with its sha256, so
//    index.html can load it from file:// with a <script> tag and the tests can require() it.
//    One wrapper per source file, so each gets its own sidecar naming exactly that file.
//
// Provenance sidecars are written separately with tools/snapshot.mjs (see README).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] || '/home/user/Partforge');
const indexPath = path.join(repo, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const lines = html.split('\n');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
let commit = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

function fail(msg) { console.error(`build-data: ${msg}`); process.exit(1); }
const lineOf = (offset) => html.slice(0, offset).split('\n').length;

// A top-level function in index.html: from `function NAME(` at column 0 to the next line that is exactly `}`.
function fnBlock(name) {
  const start = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (start < 0) fail(`function ${name}() not found at column 0`);
  let end = start;
  while (end < lines.length && lines[end] !== '}') end++;
  if (end >= lines.length) fail(`no closing brace for ${name}()`);
  return { name, from: start + 1, to: end + 1, text: lines.slice(start, end + 1).join('\n') };
}
function markerBlock(tag) {
  const a = html.indexOf(`/* ${tag}-BEGIN */`), b = html.indexOf(`/* ${tag}-END */`);
  if (a < 0 || b < a) fail(`${tag}-BEGIN/END markers not found`);
  const end = b + `/* ${tag}-END */`.length;
  return { name: tag, from: lineOf(a), to: lineOf(end), text: html.slice(a, end) };
}
function oneLine(prefix) {
  const i = lines.findIndex((l) => l.startsWith(prefix));
  if (i < 0) fail(`no line starting ${JSON.stringify(prefix)}`);
  return { from: i + 1, to: i + 1, text: lines[i] };
}
// A regex literal inside a verbatim block, located by the code around it. Returns the literal text.
function literal(block, re, what) {
  const m = re.exec(block.text);
  if (!m) fail(`could not find ${what} inside ${block.name}`);
  const line = block.from + block.text.slice(0, m.index).split('\n').length - 1;
  return { text: m[1], line };
}

const DECL = markerBlock('DECL');
const parseSpec = fnBlock('parseSpec');
const lint = fnBlock('lint');
const parseManifest = fnBlock('parseManifest');
const mainPlainUnion = fnBlock('mainPlainUnion');
const topLevelIsOnlyMain = fnBlock('topLevelIsOnlyMain');
const PARAM_RE = oneLine('const PARAM_RE = ');
const parseFlightBlock = { name: 'parseFlight', from: DECL.from, text: DECL.text };

// The gate's list of defined modules: the same statement appears in specProbeExprs, specCheckInner
// and (as definedMods) flightCheck. Copy the specCheckInner one and count the others.
const DEFINED_STMT = '  const defined = new Set([...code.matchAll(/^\\s*module\\s+([A-Za-z_]\\w*)\\s*\\(/gm)].map(m => m[1]));';
const definedLines = lines.map((l, i) => (l === DEFINED_STMT ? i + 1 : 0)).filter(Boolean);
if (!definedLines.length) fail('the gate\'s defined-modules statement was not found verbatim');
const definedModsLine = lines.findIndex((l) => l.includes('const definedMods = new Set([...code.matchAll(/^\\s*module\\s+([A-Za-z_]\\w*)\\s*\\(/gm)]')) + 1;

const VOCAB = {
  FLIGHT_BLOCK_RE: literal(parseFlightBlock, /code\.match\((\/\\\/\\\/\\s\*FLIGHT-BEGIN.*?FLIGHT-END\/)\)/, 'the FLIGHT block regex'),
  SPEC_BLOCK_RE: literal(parseSpec, /code\.match\((\/\\\/\\\/\\s\*SPEC-BEGIN.*?SPEC-END\/)\)/, 'the SPEC block regex'),
  LINE_PREFIX_RE: literal(parseFlightBlock, /l\.replace\((\/\^\\s\*\\\/\\\/ \?\/), ''\)/, 'the comment-prefix regex'),
  REVOLVE_TYPES: literal(parseFlightBlock, /const TYPES = (\/.*?\/);/, 'the revolve TYPES regex'),
  LOAD_CHECKS: literal(parseFlightBlock, /!(\/\^\(hoop.*?\/)\.test\(str\(l\.check\)\)/, 'the loads check regex'),
  GAUGE_MODULE: literal(parseFlightBlock, /!(\/\^\[A-Za-z_\]\\w\*\$\/)\.test\(str\(g\.module\)\)/, 'the gauge module regex'),
  GAUGE_INTERFERE: literal(parseFlightBlock, /(\/\^\(interfere.*?\/)\.test\(str\(g\.expect\)\)/, 'the gauge expect regex'),
  HOLE_PATTERN: literal(parseFlightBlock, /(\/\^\(circle\|list\|single\)\$\/)\.test\(str\(e\.pattern\)\)/, 'the hole pattern regex'),
  TIER: literal(parseFlightBlock, /(\/\^\[ABC\]\$\/)\.test\(str\(f\.tier\)/, 'the tier regex'),
  SPEC_REL: literal(parseSpec, /const REL = (\/.*?\/);/, 'the layout relation regex'),
  SPEC_AXIS: literal(parseSpec, /const AX = (\/.*?\/);/, 'the profile axis regex'),
  // flightLint's own patterns (to locate what it reports) and the hobby lint's
  FLINT_GLOBAL_FN: literal(parseFlightBlock, /const globalFn = code\.match\((\/.*?\/m)\);/, 'flightLint global $fn regex'),
  FLINT_BARE: literal(parseFlightBlock, /const bare = \[\.\.\.code\.matchAll\((\/.*?\/g)\)\]/, 'flightLint bare-primitive regex'),
  FLINT_BARE_FN: literal(parseFlightBlock, /\.filter\(m => !(\/.*?\/)\.test\(m\[2\]\)\)/, 'flightLint $fn-argument regex'),
  FLINT_TRIG: literal(parseFlightBlock, /if\((\/\\b\(sin\|cos\|tan\).*?\/)\.test\(code\)\)/, 'flightLint trig regex'),
  HLINT_MINKOWSKI: literal(lint, /if\((\/minkowski.*?\/)\.test\(code\)\)/, 'lint minkowski regex'),
  HLINT_FN: literal(lint, /const fn = code\.match\((\/.*?\/)\);/, 'lint $fn regex'),
  HLINT_TEXT: literal(lint, /if\((\/text.*?\/)\.test\(code\)\)/, 'lint text regex'),
  HLINT_IMPORT: literal(lint, /if\((\/import.*?\/)\.test\(code\)\)/, 'lint import regex'),
};
const holeN = /h\.n >= (\d+) && h\.n <= (\d+)/.exec(DECL.text);
if (!holeN) fail('hole count range not found');
const specCaps = {
  rules: /s\.rules = [\s\S]*?\.slice\(0, (\d+)\);/.exec(parseSpec.text),
  proportions: /s\.proportions = props\.filter\(r => typeof r === 'string'\)\.map\(String\)\.slice\(0, (\d+)\);/.exec(parseSpec.text),
  layout: /s\.layout = [\s\S]*?\.slice\(0, (\d+)\);/.exec(parseSpec.text),
  profile: /s\.profile = [\s\S]*?\.slice\(0, (\d+)\);/.exec(parseSpec.text),
};
for (const [k, m] of Object.entries(specCaps)) if (!m) fail(`parseSpec cap for ${k} not found`);

const SOURCE = {
  repo: 'https://github.com/hudsonclavin-cloud/Partforge',
  file: 'index.html',
  commit,
  sha256: sha256(html),
  pieces: Object.fromEntries([DECL, parseSpec, lint, parseManifest, mainPlainUnion, topLevelIsOnlyMain]
    .map((b) => [b.name, [b.from, b.to]])
    .concat([['PARAM_RE', [PARAM_RE.from, PARAM_RE.to]], ['defined', definedLines], ['definedMods', [definedModsLine]]])
    .concat(Object.entries(VOCAB).map(([k, v]) => [k, [v.line]]))),
};

const banner = (b) => `// ---- index.html:${b.from}-${b.to} (verbatim) ----`;
const out = `/* GENERATED by build-data.mjs from PartForge index.html — do not edit by hand.
   Repo ${SOURCE.repo}, commit ${commit || '(unknown)'}, index.html sha256 ${SOURCE.sha256}.
   Everything between the "verbatim" banners is copied byte for byte from index.html; the
   wrapper, the VOCAB object (regex literals lifted from inside parseFlight/parseSpec, each with
   its line) and appDefinedModules() (the gate's own statement, wrapped in a function) are the
   only additions. Provenance: snapshots/app-rules.js.provenance.json. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartForgeRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
${banner(DECL)}
${DECL.text}
${banner(parseSpec)}
${parseSpec.text}
${banner(lint)}
${lint.text}
${banner(parseManifest)}
${parseManifest.text}
${banner(mainPlainUnion)}
${mainPlainUnion.text}
${banner(topLevelIsOnlyMain)}
${topLevelIsOnlyMain.text}
${banner(PARAM_RE)}
${PARAM_RE.text}
// ---- index.html:${definedLines.join(', ')} (the same statement at each line; wrapped) ----
function appDefinedModules(code){
${DEFINED_STMT}
  return defined;
}
// ---- regex literals lifted from inside the verbatim functions above ----
const VOCAB = {
${Object.entries(VOCAB).map(([k, v]) => `  ${k}: ${v.text},   // index.html:${v.line}`).join('\n')}
  HOLE_N_MIN: ${holeN[1]}, HOLE_N_MAX: ${holeN[2]},   // index.html:${DECL.from + DECL.text.slice(0, holeN.index).split('\n').length - 1}
  SPEC_CAPS: { rules: ${specCaps.rules[1]}, proportions: ${specCaps.proportions[1]}, layout: ${specCaps.layout[1]}, profile: ${specCaps.profile[1]} },   // parseSpec .slice(0, N)
};
const SOURCE = ${JSON.stringify(SOURCE)};
return { parseFlight, provenanceSummary, flightCounts, flightLint, flightContradictions, partTier, mdSafe,
  FLIGHT_AXIS, FLIGHT_CAP, TOL_SRC, FLIGHT_HAZARD, parseSpec, lint, parseManifest, mainPlainUnion,
  topLevelIsOnlyMain, PARAM_RE, appDefinedModules, VOCAB, SOURCE };
});
`;
fs.writeFileSync(path.join(here, 'snapshots', 'app-rules.js'), out);
console.log(`wrote snapshots/app-rules.js (${Buffer.byteLength(out)} bytes; DECL ${DECL.from}-${DECL.to}, parseSpec ${parseSpec.from}-${parseSpec.to}, lint ${lint.from}-${lint.to})`);

// ---- wrapped fixtures: one classic script per source file ----
// Each registers itself on window.ColdReadCorpus (browser) or is the module's export (Node).
function wrap(entry) {
  return `/* GENERATED by build-data.mjs — ${entry.path} from PartForge @ ${(commit || '').slice(0, 7)}, wrapped verbatim; sha256 of the text is recorded below and checked by the tests against the provenance sidecar. */
(function (root, factory) {
  var entry = factory();
  if (typeof module === 'object' && module.exports) module.exports = entry;
  else (root.ColdReadCorpus = root.ColdReadCorpus || []).push(entry);
})(typeof self !== 'undefined' ? self : this, function () {
return ${JSON.stringify(entry)};
});
`;
}
fs.mkdirSync(path.join(here, 'snapshots', 'fixtures'), { recursive: true });
const fixtureTexts = {};
const written = [];
const fixtureList = [
  ...['endcap', 'retainer', 'retainer-fixed'].map((n) => ({ id: `dryrun/${n}.scad`, group: 'dryrun', path: `tests/dryrun/${n}.scad` })),
  ...fs.readdirSync(path.join(repo, 'tests', 'templates')).filter((f) => f.endsWith('.scad')).sort()
    .map((f) => ({ id: `templates/${f}`, group: 'templates', path: `tests/templates/${f}` })),
];
for (const fx of fixtureList) {
  const text = fs.readFileSync(path.join(repo, fx.path), 'utf8');
  fixtureTexts[fx.path] = text;
  const entry = { kind: 'scad', ...fx, commit, sha256: sha256(text), text };
  const out = path.join('snapshots', 'fixtures', `${fx.id.replace('/', '--')}.js`);
  fs.writeFileSync(path.join(here, out), wrap(entry));
  written.push([out, fx.path]);
}
for (const [id, p] of [['dryrun-cases', 'tests/dryrun/cases.json'], ['template-cases', 'tests/flight-templates-cases.json']]) {
  const text = fs.readFileSync(path.join(repo, p), 'utf8');
  const entry = { kind: 'cases', id, path: p, commit, sha256: sha256(text), text, cases: JSON.parse(text) };
  const out = path.join('snapshots', `${id}.js`);
  fs.writeFileSync(path.join(here, out), wrap(entry));
  written.push([out, p]);
}

// ---- the shipped templates ----
const tStart = lines.findIndex((l) => l.startsWith('const TEMPLATES = ['));
const fStart = lines.findIndex((l) => l.startsWith('TEMPLATES_FLIGHT.push('));
if (tStart < 0 || fStart < 0) fail('template arrays not found');
let tEnd = tStart; while (lines[tEnd] !== '];') tEnd++;
let fEnd = fStart; while (lines[fEnd] !== ');') fEnd++;
const hobby = new Function(`return ${lines.slice(tStart, tEnd + 1).join('\n').replace(/^const TEMPLATES = /, '').replace(/;$/, '')}`)();
const flight = new Function(`const T = []; T.push${lines.slice(fStart, fEnd + 1).join('\n').replace(/^TEMPLATES_FLIGHT\.push/, '')}; return T;`)();
const byText = new Map(Object.entries(fixtureTexts).map(([p, t]) => [t, p]));
const templates = {
  kind: 'templates', id: 'app-templates', path: 'index.html', commit,
  lines: { hobby: [tStart + 1, tEnd + 1], flight: [fStart + 1, fEnd + 1] },
  hobby: hobby.map((t) => ({ name: t.name, sha256: sha256(t.code), code: t.code })),
  flight: flight.map((t) => (byText.has(t.code)
    ? { name: t.name, sha256: sha256(t.code), sameAs: byText.get(t.code) }
    : { name: t.name, sha256: sha256(t.code), code: t.code })),
};
fs.writeFileSync(path.join(here, 'snapshots', 'app-templates.js'), wrap(templates));
written.push([path.join('snapshots', 'app-templates.js'), 'index.html']);
console.log(`wrote snapshots/app-templates.js (${hobby.length} hobby, ${flight.length} flight; ${templates.flight.filter((t) => t.sameAs).length} flight identical to a tests/templates fixture)`);
console.log(`wrote ${written.length - 1} fixture wrappers. Record provenance with:`);
for (const [out, src] of written)
  console.log(`  node tools/snapshot.mjs ${repo} ${src} ideas/24-cold-read/${out} --sidecar-only --note "derived by build-data.mjs: ${src === 'index.html' ? 'TEMPLATES and TEMPLATES_FLIGHT evaluated from their array literals; flight templates identical to a tests/templates fixture stored as a sha256 reference' : 'the file text wrapped verbatim as a JS string'}"`);
