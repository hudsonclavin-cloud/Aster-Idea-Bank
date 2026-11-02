#!/usr/bin/env node
// Derives this idea's data from a Skyhook checkout and records where every byte came from.
//
//   node ideas/20-twenty-percent-line/build-data.mjs [/home/user/skyhook]
//
// Run from the bank root. It writes only inside ideas/20-twenty-percent-line/:
//   1. snapshots/rev_a.json and snapshots/skyhook_physics.py: whole-file copies made with the
//      bank's tools/snapshot.mjs (the canon, and the physics module the oracle test runs).
//   2. snapshots/lines/*.json: verbatim lines from five other Skyhook files, keyed by their line
//      number in the repository, so a quote on the page can be checked against file:line. Each
//      gets a --sidecar-only provenance record naming the source file, commit and sha256.
//   3. page-data.js: the snapshots above wrapped as one classic script (window.TPL_DATA in the
//      page, module.exports under Node), because a page opened from file:// cannot fetch() a
//      sibling JSON file. Nothing is retyped: every value is parsed from a snapshot and
//      re-serialised, and twenty.test.mjs checks page-data.js is deep-equal to the snapshots.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bank = path.resolve(here, '..', '..');
const repo = path.resolve(process.argv[2] || '/home/user/skyhook');
const snap = path.join(here, 'snapshots');
const tool = path.join(bank, 'tools', 'snapshot.mjs');
const EXPECT_COMMIT = '34935cb';

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if (!head.startsWith(EXPECT_COMMIT)) {
  console.error(`expected Skyhook at ${EXPECT_COMMIT}…, found ${head}; the line numbers below were read at ${EXPECT_COMMIT}`);
  process.exit(1);
}

function snapshot(rel, dest, extra) {
  execFileSync(process.execPath, [tool, repo, rel, dest, ...extra], { stdio: 'inherit' });
}

// 1. Whole-file copies.
snapshot('params/rev_a.json', path.join(snap, 'rev_a.json'), ['--note',
  'Whole file: the Rev A canon. Zylon PBO strength and density, SK99 strength, SF, the 30 % derate, '
  + 'half-length, the three tier tip speeds, the rotation period, the payload for tonnage and the '
  + 'mass-ratio ladder used for reconciliation are all read from here. Nothing retyped.']);
snapshot('physics/skyhook_physics.py', path.join(snap, 'skyhook_physics.py'), ['--note',
  'Whole file: Skyhook\'s own EQ-4/EQ-6 implementation, run by twenty.test.mjs as an oracle for the '
  + 'single-material limits (python3 -I -B, beside the rev_a.json snapshot).']);

// 2. Verbatim lines, keyed by line number in the repository.
const LINES = [
  ['docs/DECISION_LOG.md', 'decision_log.json', [66, 68, 70, 72, 74, 76],
    'item 10 (HMPE creep): heading, sources, the 28-40 % / <=20 % sentence (70), the SF 5 and ~41x-to-~800x '
    + 'consequence (72), admissible outcomes a-d (74), closing evidence (76)'],
  ['docs/project_instructions.md', 'project_instructions.json', [10, 67, 108, 112],
    'catch-to-release is half a rotation (10); the founding material survey row for Dyneema SK99 with its '
    + '970 kg/m3 density, which rev_a.json does not carry (67); the construction baseline with the ~20 km '
    + 'Zylon outer lower arm (108); Zylon UV/AO degradation (112)'],
  ['docs/research/mp001_market_pricing.md', 'mp001.json', [22, 23, 46],
    'HMPE specs 0.97 g/cm3 (22), the <=20 % creep guidance row (23), section 3c (46)'],
  ['docs/research/lr001_splice_literature.md', 'lr001.json', [45],
    'section D: DM20 creeps >50x slower than SK78; no strength or density is given'],
  ['physics/tether_dynamics.py', 'tether_dynamics.json', [17, 18, 19, 20, 21, 22, 23, 24, 25, 81, 120, 353, 357],
    'the single-material uniform-stress profile this idea generalises (17-25); tips carry no payload '
    + 'unless payload_both_tips (81, 120); the payload is added at the catch (357); gravity-gradient '
    + 'modulation ~4 % (353)'],
];
fs.mkdirSync(path.join(snap, 'lines'), { recursive: true });
for (const [rel, out, nums, why] of LINES) {
  const text = fs.readFileSync(path.join(repo, rel), 'utf8').split('\n');
  const lines = {};
  for (const n of nums) {
    if (n < 1 || n > text.length) throw new Error(`${rel}:${n} out of range`);
    lines[String(n)] = text[n - 1].replace(/\r$/, '');
  }
  const dest = path.join(snap, 'lines', out);
  fs.writeFileSync(dest, `${JSON.stringify({ source: rel, commit: head, lines }, null, 1)}\n`);
  snapshot(rel, dest, ['--sidecar-only', '--note',
    `derived by build-data.mjs: verbatim lines ${nums.join(', ')} of ${rel}, keyed by line number; ${why}`]);
}

// 3. The page's classic-script wrapper.
const read = (p) => JSON.parse(fs.readFileSync(path.join(snap, p), 'utf8'));
const bundle = {
  revA: read('rev_a.json'),
  revAProvenance: read('rev_a.json.provenance.json'),
  lines: Object.fromEntries(LINES.map(([rel, out]) => [rel, read(path.join('lines', out)).lines])),
  linesCommit: head,
};
const body = JSON.stringify(bundle, null, 1).replace(/\n/g, '\n  ');
const js = `// Generated by build-data.mjs from snapshots/ (Skyhook @ ${head.slice(0, 7)}). Do not edit.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TPL_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return ${body};
});
`;
fs.writeFileSync(path.join(here, 'page-data.js'), js);
console.log(`wrote page-data.js (${js.length} bytes)`);
