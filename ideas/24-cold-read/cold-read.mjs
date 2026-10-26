#!/usr/bin/env node
// cold-read.mjs — lint PartForge .scad files cold, before any render. Node built-ins only.
// The rules are coldread.js; the app's own functions come from snapshots/app-rules.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CR = require('./coldread.js');

const HELP = `Cold Read — name every SPEC/FLIGHT problem in a PartForge .scad file, with its line,
before anything is rendered. It never says a part passes: geometry is not checked.

Usage:
  node ideas/24-cold-read/cold-read.mjs [options] <file.scad ...>    ('-' reads stdin)
  node ideas/24-cold-read/cold-read.mjs --corpus [--json]
  node ideas/24-cold-read/cold-read.mjs --rules

Options:
  --grade flight|hobby  lint as this grade (default: flight when the file has a FLIGHT-BEGIN line)
  --json                print the result objects as JSON
  --no-info             hide notes (info-level diagnostics)
  --corpus              lint the 27 PartForge texts bundled under snapshots/ (10 test fixtures,
                        10 hobby and 7 flight templates the app ships) and print one line each
  --rules               print the rule catalogue: code, severity, what the app itself does
  -h, --help            this text

Exit status: 0 no errors; 1 at least one error; 2 usage error or unreadable file.`;

function usage(msg) { if (msg) console.error(`cold-read: ${msg}`); console.error(HELP); process.exit(2); }

const argv = process.argv.slice(2);
const opts = { grade: null, json: false, info: true, corpus: false, rules: false, files: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a === '--grade') { opts.grade = argv[++i]; if (!['flight', 'hobby'].includes(opts.grade)) usage('--grade takes flight or hobby'); }
  else if (a === '--json') opts.json = true;
  else if (a === '--no-info') opts.info = false;
  else if (a === '--corpus') opts.corpus = true;
  else if (a === '--rules') opts.rules = true;
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else opts.files.push(a);
}

if (opts.rules) {
  for (const r of CR.RULES) console.log(`${r.code.padEnd(17)} ${r.severity.padEnd(32)} ${r.what}${r.app ? ` — app: ${r.app}` : ''}${r.ref ? ` (${r.ref})` : ''}`);
  process.exit(0);
}

// The bundled corpus: the wrapped fixtures, the shipped templates and the gate's recorded failures.
function corpus() {
  const dir = path.join(here, 'snapshots', 'fixtures');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    const e = require(path.join(dir, f));
    out.push({ label: e.path, text: e.text, id: e.id });
  }
  const T = require('./snapshots/app-templates.js');
  T.hobby.forEach((t, i) => out.push({ label: `index.html TEMPLATES[${i}] ${t.name}`, text: t.code }));
  T.flight.forEach((t, i) => out.push({ label: `index.html TEMPLATES_FLIGHT[${i}] ${t.name}`, text: t.code || out.find((o) => o.label === t.sameAs).text, sameAs: t.sameAs }));
  return out;
}

if (opts.corpus) {
  const cases = require('./snapshots/dryrun-cases.js').cases;
  const rows = corpus().map((c) => {
    const r = CR.lint(c.text, { grade: opts.grade || undefined });
    const kase = cases.find((k) => c.label === `tests/dryrun/${k.file}`);
    return { file: c.label, sameAs: c.sameAs || null, ...r.summary, gateFails: kase ? kase.expect.fails : null,
      codes: [...new Set(r.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.code))] };
  });
  if (opts.json) { console.log(JSON.stringify(rows, null, 1)); process.exit(rows.some((r) => r.errors) ? 1 : 0); }
  for (const r of rows)
    console.log(`${String(r.errors).padStart(2)} err ${String(r.warnings).padStart(2)} warn ${String(r.infos).padStart(2)} note  ${r.file}${r.sameAs ? ` (= ${r.sameAs})` : ''}${r.codes.length ? '  [' + r.codes.join(', ') + ']' : ''}${r.gateFails ? `  gate recorded ${r.gateFails.length} fail${r.gateFails.length === 1 ? '' : 's'}` : ''}`);
  const tot = (k) => rows.reduce((a, r) => a + r[k], 0);
  console.log(`${rows.length} files: ${tot('errors')} errors, ${tot('warnings')} warnings, ${tot('infos')} notes`);
  console.log(CR.FOOTER);
  process.exit(rows.some((r) => r.errors) ? 1 : 0);
}

if (!opts.files.length) usage('no file given');
let worst = 0;
const results = [];
for (const f of opts.files) {
  let text;
  try { text = f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8'); }
  catch (e) { console.error(`cold-read: cannot read ${f}: ${e.code || e.message}`); process.exit(2); }
  const r = CR.lint(text, { grade: opts.grade || undefined });
  results.push({ file: f, ...r });
  if (r.summary.errors) worst = 1;
  if (!opts.json) { console.log(CR.format(r, { file: f, showInfo: opts.info })); if (opts.files.length > 1) console.log(''); }
}
if (opts.json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1));
process.exit(worst);
