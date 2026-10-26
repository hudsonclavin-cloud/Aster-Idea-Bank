#!/usr/bin/env node
// Builds snapshots/aster/: a miniature Aster checkout (same paths, same line numbers) holding just
// the files and line ranges the reconciliation tests need, so they run without the 1 GB checkout.
//
//   node ideas/22-said-vs-derived/build-data.mjs [/home/user/asteroid-mining-planner]
//
// Whole files are copied by the bank's tools/snapshot.mjs (provenance sidecar beside each). Large
// files are excerpted here: the listed line ranges are copied verbatim and every other line is left
// empty, so a finding at snapshots/aster/<path>:<line> is the repository's own <path>:<line>; then
// snapshot.mjs --sidecar-only records the source file, commit and the ranges. The cache's leading
// metadata object is copied with --pick metadata. Every excerpt is checked: no string, template or
// comment may be cut open, and each literal in it must equal the literal at the same place in the
// full file.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SD = createRequire(import.meta.url)(path.join(here, 'said-derived.js'));
const bank = path.resolve(here, '..', '..');
const snapshotTool = path.join(bank, 'tools', 'snapshot.mjs');
const aster = path.resolve(process.argv[2] || '/home/user/asteroid-mining-planner');
const out = path.join(here, 'snapshots', 'aster');

const WHOLE = [
  'src/v2/app/catalog-list/honesty-disclosure.ts',
  'src/v2/app/porkchop-smoke/main.ts',
  'src/v2/core/units/utc-to-tdb.ts',
  'src/v2/core/constants/asteroids.ts',
  'src/v2/porkchop/delta-v.ts',
];

const EXCERPTS = {
  'src/v2/app/porkchop/main.ts': [[158, 204], [644, 648], [708, 711], [886, 893], [978, 983]],
  'src/v2/app/compare/main.ts': [[80, 115], [219, 227], [266, 273], [836, 843], [872, 876], [954, 958]],
  'src/v2/app/ui-overlay/overlay.ts': [[96, 102], [145, 166]],
  'src/v2/porkchop/launch-vehicles.ts': [[55, 67]],
  'mcp/src/tools/compute-shared.ts': [[129, 147], [360, 369]],
  'mcp/src/tools/estimate-mission-cost.ts': [[158, 162], [244, 249], [266, 272]],
  'mcp/src/tools/explain-cell.ts': [[132, 136], [260, 266]],
};

// Aster serves the same cache at docs/ (the CLI's second default path); one directory instead of three.
const CACHE = 'docs/lambert-screen-cache.json';

function snap(rel, dest, extra) {
  execFileSync('node', [snapshotTool, aster, rel, dest, ...extra], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function literalSet(src) {
  const L = SD.lex(src);
  return { L, set: new Set(L.literals.map((l) => `${l.line}\u0001${l.parts.map((p) => p.raw).join('\u0002')}`)) };
}

function main() {
  if (!fs.existsSync(path.join(aster, 'src', 'v2'))) {
    console.error(`not an Aster checkout: ${aster}`);
    process.exit(2);
  }
  fs.rmSync(out, { recursive: true, force: true });
  for (const rel of WHOLE) snap(rel, path.join(out, rel), ['--note', 'whole file; said-vs-derived reconciliation tree']);

  for (const [rel, ranges] of Object.entries(EXCERPTS)) {
    const full = fs.readFileSync(path.join(aster, rel), 'utf8');
    const lines = full.split('\n');
    const keep = new Set();
    for (const [a, b] of ranges) for (let k = a; k <= b; k++) keep.add(k);
    const text = lines.map((l, i) => (keep.has(i + 1) ? l : '')).join('\n');
    const ex = literalSet(text);
    const cut = ex.L.errors.filter((e) => /unterminated/.test(e));
    if (cut.length) throw new Error(`${rel}: excerpt cuts a literal or comment open: ${cut.join('; ')}`);
    const whole = literalSet(full);
    for (const k of ex.set) if (!whole.set.has(k)) throw new Error(`${rel}: excerpt literal not in the full file at the same line: ${k.slice(0, 80)}`);
    // the canon the excerpt yields must be exactly the full file's canon on the kept lines
    const sig = (h) => `${h.name}=${h.text}@${h.line}`;
    const want = SD.harvestTs(rel, full).filter((h) => keep.has(h.line)).map(sig).sort();
    const got = SD.harvestTs(rel, text).map(sig).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`${rel}: excerpt canon differs from the full file's on the kept lines:\n  want ${want.join(', ')}\n  got  ${got.join(', ')}`);
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    const note = `derived by build-data.mjs: lines ${ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')} verbatim, all other lines empty (line numbers preserved)`;
    snap(rel, dest, ['--sidecar-only', '--note', note]);
  }

  snap(CACHE, path.join(out, CACHE), ['--pick', 'metadata', '--note', 'the leading metadata object only (34 MB file); said-vs-derived reads canon from it']);
  const n = fs.readdirSync(out, { recursive: true }).filter((f) => !String(f).endsWith('.provenance.json') && fs.statSync(path.join(out, f)).isFile()).length;
  console.log(`wrote ${n} files under ${path.relative(bank, out)} from ${aster}`);
}

main();
