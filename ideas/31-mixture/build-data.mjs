#!/usr/bin/env node
// Derives snapshots/thermo-excerpt.js from NASA Glenn's thermo.inp (McBride, Zehe & Gordon,
// NASA/TP-2002-211556, as distributed in https://github.com/nasa/cea at 2f79a64, data/thermo.inp).
//
//   node ideas/31-mixture/build-data.mjs <path-to-thermo.inp>
//
// The excerpt is VERBATIM: whole records copied line for line, nothing retyped or reformatted. It holds
//   - the gas products in oracle/species-survey.json "selected" (every C/H/O/N gas species that NASA CEA
//     puts above 1e-7 mole fraction anywhere in the survey grid; see oracle/cea_oracle.py),
//   - three condensed products, C(gr), H2O(L) and H2O(cr), which the kernel never puts in the mixture but
//     tests for stability so it can refuse when the real equilibrium would hold a solid or a liquid,
//   - the reactant records the page offers.
// The file's sha256 is checked first, so a different thermo.inp cannot silently produce a different excerpt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_SHA256 = 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363';
const SOURCE = {
  repo: 'https://github.com/nasa/cea',
  path: 'data/thermo.inp',
  commit: '2f79a647e85737742fb08a127da00d1ea1d069da',
  url: 'https://raw.githubusercontent.com/nasa/cea/2f79a647e85737742fb08a127da00d1ea1d069da/data/thermo.inp',
};
const CONDENSED = ['C(gr)', 'H2O(L)', 'H2O(cr)'];
const REACTANTS = ['O2(L)', 'H2(L)', 'CH4(L)', 'RP-1', 'N2O4(L)', 'CH6N2(L)', 'C2H8N2(L),UDMH', 'N2H4(L)',
  'C2H5OH(L)', 'H2O2(L)'];

function records(lines, start, endMarker) {
  const out = [];
  let j = start;
  while (j < lines.length && !lines[j].startsWith(endMarker)) {
    if (lines[j].startsWith('!') || !lines[j].trim()) { j++; continue; }
    const n = parseInt(lines[j + 1].slice(0, 2), 10);
    if (!Number.isInteger(n)) throw new Error(`bad interval count at line ${j + 2}`);
    const len = n > 0 ? 2 + 3 * n : 3;
    out.push({ name: lines[j].slice(0, 15).trim(), line: j + 1, text: lines.slice(j, j + len) });
    j += len;
  }
  return { out, end: j };
}

function main() {
  const src = process.argv[2];
  if (!src || src === '--help') {
    console.log('usage: node build-data.mjs <path-to-thermo.inp>  (nasa/cea 2f79a64 data/thermo.inp)');
    process.exit(src ? 0 : 2);
  }
  const buf = fs.readFileSync(src);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) {
    console.error(`thermo.inp sha256 ${sha} is not the pinned ${SOURCE_SHA256}`);
    process.exit(1);
  }
  const lines = buf.toString('utf8').split(/\r?\n/);
  const t = lines.findIndex((l) => l.trim() === 'thermo');
  const prod = records(lines, t + 2, 'END PRODUCTS');
  const reac = records(lines, prod.end + 1, 'END REACTANTS');
  const survey = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'species-survey.json'), 'utf8'));
  const wantProducts = [...survey.selected, ...CONDENSED];
  const pick = (list, names, where) => names.map((nm) => {
    const hits = list.filter((r) => r.name === nm);
    if (hits.length !== 1) throw new Error(`${nm}: ${hits.length} records in ${where}`);
    return hits[0];
  });
  const P = pick(prod.out, wantProducts, 'products');
  const R = pick(reac.out, REACTANTS, 'reactants');
  const body = [
    'thermo', lines[t + 1],
    ...P.flatMap((r) => r.text), 'END PRODUCTS',
    ...R.flatMap((r) => r.text), 'END REACTANTS',
  ];
  const excerpt = body.join('\n');
  const excerptSha = crypto.createHash('sha256').update(excerpt).digest('hex');
  const js = [
    '/* Verbatim excerpt of NASA Glenn thermo.inp (McBride, Zehe & Gordon, NASA/TP-2002-211556) as distributed',
    ` * in ${SOURCE.repo} at ${SOURCE.commit.slice(0, 7)}, ${SOURCE.path} (Apache-2.0). Written by build-data.mjs; do not edit.`,
    ` * ${P.length} product records, ${R.length} reactant records; source thermo.inp line of each record:`,
    ` * ${[...P, ...R].map((r) => `${r.name}@${r.line}`).join(' ')}`,
    ` * sha256 of the joined excerpt text: ${excerptSha} */`,
    '(function (root) {',
    '  var THERMO_EXCERPT = [',
    ...body.map((l) => `    ${JSON.stringify(l)},`),
    "  ].join('\\n');",
    "  if (typeof module === 'object' && module.exports) module.exports = THERMO_EXCERPT;",
    '  else root.THERMO_EXCERPT = THERMO_EXCERPT;',
    "})(typeof self !== 'undefined' ? self : this);",
    '',
  ].join('\n');
  const out = path.join(here, 'snapshots', 'thermo-excerpt.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, js);
  const now = new Date().toISOString();
  fs.writeFileSync(`${out}.provenance.json`, `${JSON.stringify({
    repo: SOURCE.repo,
    path: SOURCE.path,
    commit: SOURCE.commit,
    url: SOURCE.url,
    retrieved: now.slice(0, 10),
    sourceSha256: SOURCE_SHA256,
    excerptSha256: excerptSha,
    license: 'Apache-2.0 (nasa/cea LICENSE.txt); the data are NASA Glenn thermodynamic data, NASA/TP-2002-211556, a US-government work',
    note: `derived by build-data.mjs: verbatim records for the ${survey.selected.length} gas products in oracle/species-survey.json "selected" (CEA mole fraction >= ${survey.threshold} anywhere in the survey grid), the condensed ${CONDENSED.join(', ')} (stability test only) and the reactants ${REACTANTS.join(', ')}`,
    copiedAt: now,
  }, null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${P.length} products, ${R.length} reactants, ${excerpt.length} chars`);
}
main();
