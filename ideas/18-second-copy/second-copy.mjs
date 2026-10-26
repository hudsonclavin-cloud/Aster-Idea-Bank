#!/usr/bin/env node
// Second Copy, the command line (Node built-ins only). Exit codes as PartForge's headless/cli.mjs:
// 0 nothing disagrees, 1 a DISAGREES or COPY-DRIFT, 2 refused, 3 usage.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SC = require(path.join(here, 'second-copy.js'));
const HISTORY = ['ad4d587', '3bffbe0'];
const SOURCES = ['doctrine', 'grades', 'templates', 'copies', 'history'];

const HELP = `Second Copy — numbers PartForge restates from its own tables, and whether the copies agree

usage: node second-copy.mjs [--repo DIR | --snapshots] [options]

input (one of):
  --repo DIR        a PartForge checkout as it is on disk (default /home/user/Partforge)
  --snapshots       this folder's snapshots/ (PartForge at the commit their sidecars name)
  --doctrine FILE   lint FILE as doctrine text instead; repeatable
  --template FILE   lint FILE as a flight template (.scad); repeatable
  --grade-sy FILE   lint FILE as a GRADE_SY literal (with or without its comment)

options:
  --only LIST       comma list of ${SOURCES.join(', ')} (default: the first four; history implies --history)
  --history         also replay the doctrine's fastener/fit/O-ring bullets at ${HISTORY.join(' and ')}
                    against today's tables
  --all             list every finding, AGREES included (default: AGREES are counted per family)
  --brief           one line per finding
  --unpaired        list the numbers no resolver claimed (they are not judged)
  --json            print an envelope in the shape of PartForge's headless CLI instead of text
  -h, --help        this text

verdicts: AGREES, DISAGREES (fails), UNBACKED, NON-CLASS, MAPPED, QUOTED, COPY-DRIFT (fails)
exit: 0 nothing disagrees; 1 a DISAGREES or COPY-DRIFT; 2 refused; 3 usage`;

function parse(argv) {
  const o = { repo: null, snapshots: false, doctrine: [], template: [], gradeSy: null, only: null, history: false, all: false, brief: false, unpaired: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--repo') o.repo = val();
    else if (a === '--snapshots') o.snapshots = true;
    else if (a === '--doctrine') o.doctrine.push(val());
    else if (a === '--template') o.template.push(val());
    else if (a === '--grade-sy') o.gradeSy = val();
    else if (a === '--only') { o.only = val().split(',').map((s) => s.trim()).filter(Boolean); const bad = o.only.filter((s) => !SOURCES.includes(s)); if (bad.length) throw new Error(`--only: unknown ${bad.join(', ')}`); }
    else if (a === '--history') o.history = true;
    else if (a === '--all') o.all = true;
    else if (a === '--brief') o.brief = true;
    else if (a === '--unpaired') o.unpaired = true;
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.repo && o.snapshots) throw new Error('--repo and --snapshots are exclusive');
  if (o.only && o.only.includes('history')) o.history = true;
  return o;
}

class Refusal extends Error { constructor(code, reason, help) { super(reason); this.code = code; this.help = help; } }

function loadSnapshots() {
  const dir = path.join(here, 'snapshots');
  const files = fs.readdirSync(dir);
  const T = {};
  for (const name of Object.keys(SC.TABLE_FILES)) {
    if (!files.includes(`table-${name}.js`)) throw new Refusal('not_found', `snapshots/table-${name}.js is missing`, 'run build-data.mjs');
    T[name] = require(path.join(dir, `table-${name}.js`));
  }
  const idxFile = files.find((f) => /^index-\w+\.js$/.test(f));
  if (!idxFile || !files.includes('history.js')) throw new Refusal('not_found', 'snapshots/index-<commit>.js or history.js is missing', 'run build-data.mjs');
  const idx = require(path.join(dir, idxFile));
  const templates = files.filter((f) => /^tpl-.*\.scad\.js$/.test(f)).sort().map((f) => {
    const t = require(path.join(dir, f));
    return { name: f.replace(/^tpl-/, '').replace(/\.scad\.js$/, ''), file: t.file, text: t.text };
  });
  const shipped = SC.rebuildShipped(idx.shipped, templates).map((s) => {
    if (s.text == null || crypto.createHash('sha256').update(s.text).digest('hex') !== s.sha256) throw new Refusal('invalid_input', `shipped "${s.name}" does not rebuild to its sha256`, 'run build-data.mjs');
    return s;
  });
  const hist = require(path.join(dir, 'history.js'));
  const history = HISTORY.map((c) => ({ commit: hist[c].commit, text: hist[c].text, lineBase: hist[c].lineBase }));
  return { T, commit: idx.commit, where: 'snapshots in ' + path.relative(process.cwd(), dir), doctrine: { text: idx.doctrine.text, lineBase: idx.doctrine.lineBase }, gradeSy: { text: idx.gradeSy.text, lineBase: idx.gradeSy.lineBase }, templates, shipped, history };
}

function loadRepo(dir, wantHistory) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Refusal('not_found', `no PartForge checkout at ${dir}`, 'pass --repo DIR, or --snapshots');
  const T = {};
  for (const [name, file] of Object.entries(SC.TABLE_FILES)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) throw new Refusal('not_found', `${file} is missing from ${dir}`, 'PartForge fae75b8 or later');
    T[name] = SC.EXCERPT[name](JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const doctrine = SC.sliceDoctrine(html);
  if (!doctrine) throw new Refusal('not_found', 'flightSystemPrompt() not found in index.html', 'update sliceDoctrine() to where it moved');
  const gradeSy = SC.sliceGradeSy(html);
  if (!gradeSy) throw new Refusal('not_found', 'const GRADE_SY not found in index.html', 'update sliceGradeSy() to where it moved');
  const shipped = SC.shippedTemplates(html);
  if (!Array.isArray(shipped)) throw new Refusal('invalid_input', shipped && shipped.error || 'TEMPLATES_FLIGHT.push( not found in index.html', 'update shippedTemplates()');
  const tdir = path.join(dir, 'tests', 'templates');
  const templates = fs.existsSync(tdir) ? fs.readdirSync(tdir).filter((f) => f.endsWith('.scad')).sort().map((f) => ({ name: f.replace(/\.scad$/, ''), file: `tests/templates/${f}`, text: fs.readFileSync(path.join(tdir, f), 'utf8') })) : [];
  let commit = 'working tree';
  const git = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    commit = git(['rev-parse', '--short=7', 'HEAD']);
    if (git(['status', '--porcelain', '--', 'index.html', 'data/tables', 'tests/templates'])) commit += ' + uncommitted edits';
  } catch { /* not a git checkout: say so in the header */ }
  const history = wantHistory ? HISTORY.map((c) => {
    let old;
    try { old = git(['show', `${c}:index.html`]); } catch { throw new Refusal('not_found', `git show ${c}:index.html failed in ${dir}`, 'a full clone with history, or --snapshots'); }
    const b = SC.tableBullets(SC.sliceDoctrine(old));
    return { commit: c, text: b.text, lineBase: b.lineBase };
  }) : [];
  return { T, commit, where: 'checkout ' + dir, doctrine, gradeSy, templates, shipped, history };
}

function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n\n${HELP}`); return 3; }
  if (o.help) { console.log(HELP); return 0; }
  let src;
  try {
    src = o.snapshots ? loadSnapshots() : loadRepo(path.resolve(o.repo || '/home/user/Partforge'), o.history);
    const only = new Set(o.only || SOURCES.filter((x) => x !== 'history'));
    const read = (f) => { if (!fs.existsSync(f)) throw new Refusal('not_found', `no such file: ${f}`, 'a readable path'); return fs.readFileSync(f, 'utf8'); };
    const extra = [['doctrine', o.doctrine], ['template', o.template], ['gradeSy', o.gradeSy ? [o.gradeSy] : []]].flatMap(([kind, fl]) => fl.map((f) => ({ kind, file: f, text: read(f) })));
    const inputs = { commit: src.commit, extra };
    if (!extra.length) {
      if (only.has('doctrine')) inputs.doctrine = src.doctrine;
      if (only.has('grades') || only.has('doctrine')) inputs.gradeSy = src.gradeSy;
      if (only.has('templates') || only.has('copies')) inputs.templates = src.templates;
      if (only.has('copies')) inputs.shipped = src.shipped;
      if (o.history) inputs.history = src.history;
    }
    const result = runInputs(src.T, inputs, only, extra.length > 0);
    result.where = src.where;
    if (o.json) process.stdout.write(JSON.stringify(envelopeOf(result, src), null, 1) + '\n');
    else process.stdout.write(SC.formatText(result, { all: o.all, brief: o.brief, unpaired: o.unpaired }).replace(/^(Second Copy[^\n]*)/, `$1 (${src.where})`));
    return result.failing ? 1 : 0;
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    if (o.json) process.stdout.write(JSON.stringify({ ok: false, tool: 'second-copy', value: null, refusal: { code: e.code, reason: e.message, what_would_help: e.help }, summary: `Refused (${e.code}): ${e.message}` }, null, 1) + '\n');
    else console.error(`Refused (${e.code}): ${e.message}. What would help: ${e.help}`);
    return 2;
  }
}

function runInputs(T, inputs, only, custom) {
  if (!custom) {
    const r = SC.run(T, inputs);
    r.sources = r.sources.filter((s) => (s.id === 'doctrine' && only.has('doctrine')) || (s.id === 'GRADE_SY' && only.has('grades')) ||
      (s.id.startsWith('template:') && only.has('templates')) || (s.id === 'copies' && only.has('copies')) || s.history);
    return recount(r);
  }
  const r = { commit: inputs.commit, sources: [] };
  for (const x of inputs.extra) {
    const one = { text: x.text, lineBase: 1 };
    const part = SC.run(T, x.kind === 'template' ? { templates: [{ name: path.basename(x.file), file: x.file, text: x.text }] } : { [x.kind]: one });
    part.sources.forEach((s) => {
      s.file = x.file; s.label = `${x.file} (as ${x.kind === 'gradeSy' ? 'GRADE_SY' : x.kind})`;
      s.findings.forEach((f) => { f.file = x.file; });
      r.sources.push(s);
    });
  }
  return recount(r);
}
function recount(r) {
  const all = r.sources.flatMap((s) => s.findings);
  r.totals = SC.count(all);
  r.failing = all.filter((f) => SC.FAILING[f.verdict]).length;
  return r;
}

function envelopeOf(result, src) {
  const t = result.totals;
  const sideDir = path.join(here, 'snapshots');
  const provenance = Object.entries(SC.TABLE_FILES).map(([name, file]) => {
    let commit = src.commit;
    try { if (src.where.startsWith('snapshots')) commit = JSON.parse(fs.readFileSync(path.join(sideDir, `table-${name}.js.provenance.json`), 'utf8')).commit; } catch { /* keep */ }
    return { kind: 'repo', repo: 'https://github.com/hudsonclavin-cloud/Partforge', path: file, commit };
  });
  return {
    ok: true, tool: 'second-copy',
    value: { commit: result.commit, read_from: result.where, totals: t, failing: result.failing,
      sources: result.sources.map((s) => ({ id: s.id, label: s.label, file: s.file, counts: s.counts, numbers: s.numbers, unpaired: s.unpaired.length, findings: s.findings })) },
    units: null, confidence: 'measured', provenance,
    assumptions: [
      'agrees = equal to the table value at the literal\'s printed precision (±½ unit in its last digit)',
      'UN, AS568 and Parker values compared from the inch columns × 25.4',
      'only the sentence shapes in second-copy.js are paired; other numbers are counted as unpaired, not judged',
      'UNBACKED: no table row carries it; not judged wrong, no value proposed'
    ],
    validity_envelope: 'PartForge index.html (flightSystemPrompt, GRADE_SY, TEMPLATES_FLIGHT), tests/templates/*.scad and data/tables at the commit shown',
    refusal: null,
    summary: `${t.DISAGREES} DISAGREES, ${t['COPY-DRIFT']} COPY-DRIFT, ${t.UNBACKED} UNBACKED, ${t['NON-CLASS']} NON-CLASS, ${t.MAPPED} MAPPED, ${t.QUOTED} QUOTED, ${t.AGREES} AGREES`
  };
}

process.exitCode = main();
