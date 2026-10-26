#!/usr/bin/env node
// shadow-lint — for every number a FLIGHT loads row feeds its check, say whether the declared
// geometry can see it; given two attempts, say what moved while the geometry did not.
//
//   node ideas/07-shadow-lint/shadow-lint.mjs <part.scad>                  shadow table for one file
//   node ideas/07-shadow-lint/shadow-lint.mjs <attempt.scad> <retry.scad>  attempt diff
//   options: --json (an envelope in the shape of PartForge's headless CLI), --terse, --help
//
// Exit codes, as headless/cli.mjs: 0 lint printed and no findings · 1 findings (an input moved
// while the geometry stayed byte-identical, or a contract-floor loss) · 2 refused (no FLIGHT
// block, malformed JSON, no loads rows, unreadable file) · 3 usage error.
//
// Nothing is rewritten. Node built-ins only; the fastener and motor rows it uses are the excerpts
// under snapshots/ (PartForge data/tables/*, with their confidence fields).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Shadow = require(path.join(here, 'shadow.js'));
const snaps = path.join(here, 'snapshots');
const data = {
  metric: require(path.join(snaps, 'fasteners_metric.excerpt.js')),
  un: require(path.join(snaps, 'fasteners_un.excerpt.js')),
  motors: require(path.join(snaps, 'motor_perf.excerpt.js')),
};

function usage(code) {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1).map((l) => l.slice(3)).join('\n');
  (code ? process.stderr : process.stdout).write(text + '\n');
  process.exit(code);
}

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const json = flag('--json'), terse = flag('--terse');
if (flag('--help') || flag('-h')) usage(0);
if (argv.some((a) => a.startsWith('--')) || argv.length < 1 || argv.length > 2) usage(3);

function provenanceOf() {
  const side = (f) => { try { return JSON.parse(fs.readFileSync(path.join(snaps, f + '.provenance.json'), 'utf8')); } catch { return null; } };
  const refs = [];
  for (const f of ['fasteners_metric.excerpt.js', 'fasteners_un.excerpt.js', 'motor_perf.excerpt.js']) { const s = side(f); if (s) refs.push({ source: `${s.repo} ${s.path} @ ${String(s.commit).slice(0, 7)} (excerpt: ${s.note})` }); }
  return refs;
}

function finish(env, text, code) {
  if (json) process.stdout.write(JSON.stringify(env, null, 1) + '\n');
  else process.stdout.write(text + '\n');
  process.exit(code);
}

const files = [];
for (const a of argv) {
  try { files.push({ label: path.basename(a), text: fs.readFileSync(a, 'utf8') }); }
  catch (e) {
    const refusal = { code: 'invalid_input', reason: `cannot read ${a}: ${e.code || e.message}`, what_would_help: 'a path to a .scad file with a FLIGHT block' };
    finish(Shadow.envelope('shadow-lint', null, { refusal, summary: refusal.reason }), `refused (${refusal.code}): ${refusal.reason}\n  what would help: ${refusal.what_would_help}`, 2);
  }
}

if (files.length === 1) {
  const L = Shadow.lint(files[0].text, data, files[0].label);
  const text = Shadow.renderLint(L, { terse });
  if (L.refusal) finish(Shadow.envelope('shadow-lint', null, { refusal: L.refusal, summary: L.refusal.reason }), text, 2);
  const r = L.result;
  const summary = `${files[0].label}: ${r.totals.WITNESSED} witnessed, ${r.totals.DERIVABLE} derivable, ${r.totals.UNWITNESSED} unwitnessed, ${r.totals.POLICY} policy; invention surface ${r.inventionSurface.length}`;
  finish(Shadow.envelope('shadow-lint', { file: files[0].label, ...r }, { summary, provenance: provenanceOf() }), text, 0);
} else {
  const D = Shadow.diffAttempts(files[0].text, files[1].text, data, [files[0].label, files[1].label]);
  const text = Shadow.renderDiff(D);
  if (D.refusal) finish(Shadow.envelope('shadow-lint', null, { refusal: D.refusal, summary: D.refusal.reason }), text, 2);
  const value = { files: D.labels, geometry: D.geometry, moved: D.moved, declarations: D.declarations, floor: D.floor, findings: D.findings,
    before: { file: D.labels[0], ...D.A.result }, after: { file: D.labels[1], ...D.B.result } };
  const summary = D.findings.length ? `${D.findings.length} finding${D.findings.length === 1 ? '' : 's'}: ${D.findings.map((f) => f.code).join(', ')}` : 'no findings';
  finish(Shadow.envelope('shadow-lint', value, { summary, provenance: provenanceOf() }), text, D.findings.length ? 1 : 0);
}
