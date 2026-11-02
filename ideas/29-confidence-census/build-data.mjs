#!/usr/bin/env node
// build-data.mjs — writes this idea's snapshots from a PartForge checkout (default /home/user/Partforge):
//   snapshots/views/<table>.js       census.js viewOf() of data/tables/<table>.json
//   snapshots/readme-policy.js       the data/README.md confidence-policy table, with line numbers
//   snapshots/provenance-overall.js  the docs/data/PROVENANCE.md headings + "Overall confidence" lines
// and a provenance sidecar beside each (tools/snapshot.mjs --sidecar-only). Then it runs the census
// on the checkout and writes findings.json and example.txt. Reads the checkout only.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadCheckout, viewModule, policyModule, README_PATH, PROVENANCE_PATH } from './checkout.mjs';

const require = createRequire(import.meta.url);
const Census = require('./census.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const bank = path.resolve(here, '..', '..');
const repo = path.resolve(process.argv[2] || '/home/user/Partforge');

const VIEW_NOTE = 'derived by build-data.mjs: census.js viewOf() of this table, wrapped as a UMD script. Kept: every row\'s key (front-coded), confidence, ' +
  'source text (a sorted, front-coded dictionary of its "; "-separated segments; lossless), its field-name set, disputed entries and field_confidence ' +
  '(deduplicated), numeric inch/mm pair values, *_confidence fields and vendor / len_mm / len_variants / current / current_upstream_main; the columns keys ' +
  '(description text kept only for inch/mm pair fields); the ISO dates found in each metadata block; the supplement\'s keys, labels and source presence; ' +
  'license_note length; table-level disputed, fits count and field_confidence. Values are not edited.';

function sidecar(rel, dest, note) {
  execFileSync(process.execPath, [path.join(bank, 'tools', 'snapshot.mjs'), repo, rel, dest, '--sidecar-only', '--note', note], { stdio: ['ignore', 'ignore', 'inherit'] });
}

const { views, policy } = loadCheckout(repo);
const vdir = path.join(here, 'snapshots', 'views');
fs.rmSync(path.join(here, 'snapshots'), { recursive: true, force: true });
fs.mkdirSync(vdir, { recursive: true });
for (const v of views) {
  const dest = path.join(vdir, `${v.table}.js`);
  fs.writeFileSync(dest, viewModule(v));
  sidecar(v.source.path, dest, VIEW_NOTE);
}
const pr = path.join(here, 'snapshots', 'readme-policy.js');
fs.writeFileSync(pr, policyModule('readme', policy.readme));
sidecar(README_PATH, pr, `derived by build-data.mjs: lines ${policy.readme.lines[0]?.n}-${policy.readme.lines.at(-1)?.n} of data/README.md (the confidence-policy table) verbatim with their line numbers, wrapped as a UMD script`);
const pp = path.join(here, 'snapshots', 'provenance-overall.js');
fs.writeFileSync(pp, policyModule('provenance', policy.provenance));
sidecar(PROVENANCE_PATH, pp, `derived by build-data.mjs: the ${policy.provenance.lines.length} lines of docs/data/PROVENANCE.md that are "## N. table" headings or "**Overall confidence:**" lines, verbatim with their line numbers, wrapped as a UMD script`);

const res = Census.run(views, policy);
fs.writeFileSync(path.join(here, 'findings.json'), Census.serialize(res));
fs.writeFileSync(path.join(here, 'example.txt'), `$ node ideas/29-confidence-census/census.mjs /home/user/Partforge\n` + Census.toMarkdown(res) + `(exit ${res.summary.exit})\n`);
console.log(`wrote ${views.length} views, 2 policy extracts, findings.json (${res.summary.findings} findings: ${JSON.stringify(res.summary.by_severity)}), example.txt`);
