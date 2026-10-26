#!/usr/bin/env node
// Derives snapshots/canon.data.js: everything index.html reads about Skyhook, wrapped as a classic
// script (window.SPIN_WOBBLE_CANON / module.exports) because a page opened from file:// cannot
// fetch() a sibling JSON file. Nothing is retyped; everything is read from the copies under
// snapshots/ (never from the Skyhook checkout), each of which has its own provenance sidecar:
//
//   rev_a.json          parsed whole (Rule 1: the only source of tether numbers)
//   twin-physics.mjs    R_EARTH_KM, regexed with its line number (the radius the twin and golden
//                       run put under the 610 km altitude)
//   golden.json         meta, the run-long means and the checkpoint tip speeds (not the states)
//   glossary.md, tether_dynamics.py, VISUAL_QA.md
//                       the program's own sentences about the modulation, quoted verbatim with
//                       their line numbers, so the page can show what it is checking
//
//   node ideas/16-spin-wobble/build-data.mjs           writes snapshots/canon.data.js
//   node ideas/16-spin-wobble/build-data.mjs --check   exits 1 if the written file is stale
//
// Provenance for the derived file (written once, with the bank's tool):
//   node tools/snapshot.mjs /home/user/skyhook params/rev_a.json \
//     ideas/16-spin-wobble/snapshots/canon.data.js --sidecar-only --note "derived by build-data.mjs: ..."
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const snap = (f) => path.join(here, 'snapshots', f);
const readText = (f) => fs.readFileSync(snap(f), 'utf8');
const readJson = (f) => JSON.parse(readText(f));
const sidecar = (f) => {
  const p = readJson(`${f}.provenance.json`);
  return { file: `snapshots/${f}`, path: p.path, commit: p.commit, sourceSha256: p.sourceSha256 };
};

// `export const NAME = <number>;` exactly once, with its 1-based line.
export function jsConstant(source, name) {
  const re = new RegExp(`^export const ${name} = (-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?);`);
  const hits = [];
  source.split('\n').forEach((text, i) => {
    const m = re.exec(text);
    if (m) hits.push({ value: Number(m[1]), line: i + 1, text: text.trim() });
  });
  if (hits.length !== 1) throw new Error(`${name}: expected one export in twin-physics.mjs, found ${hits.length}`);
  return hits[0];
}

// Verbatim text from `from` (on the first line containing it) through `to` (on the first line at or
// after it containing it), joined with single spaces where the source wraps, with the 1-based
// line numbers it spans. Throws if either anchor is missing, so an edited source is noticed.
export function quote(source, from, to) {
  const lines = source.split('\n');
  const a = lines.findIndex((l) => l.includes(from));
  if (a < 0) throw new Error(`quote: "${from}" not found`);
  const b = lines.findIndex((l, i) => i >= a && l.includes(to) && (i > a || l.indexOf(to) >= l.indexOf(from)));
  if (b < 0) throw new Error(`quote: "${to}" not found after "${from}"`);
  const text = lines.slice(a, b + 1).map((l) => l.trim()).join(' ');
  const start = text.indexOf(from);
  const end = text.indexOf(to, start) + to.length;
  return { lineFrom: a + 1, lineTo: b + 1, text: text.slice(start, end) };
}

export function derive() {
  const revA = readJson('rev_a.json');
  const golden = readJson('golden.json');
  const glossary = readText('glossary.md');
  const td = readText('tether_dynamics.py');
  const qa = readText('VISUAL_QA.md');
  const twin = readText('twin-physics.mjs');
  const R = jsConstant(twin, 'R_EARTH_KM');

  const gProv = sidecar('golden.json');
  const claims = [
    { id: 'glossary', file: 'docs/glossary.md', commit: sidecar('glossary.md').commit,
      ...quote(glossary, 'Coupling between a rotating tether', 'slightly above the target release speed.') },
    { id: 'docstring', file: 'physics/tether_dynamics.py', commit: sidecar('tether_dynamics.py').commit,
      ...quote(td, '[Certain] In orbit, gravity-gradient torque', 'number of rotations cancels the periodic exchange.') },
    { id: 'catch', file: 'physics/tether_dynamics.py', commit: sidecar('tether_dynamics.py').commit,
      ...quote(td, 'Gravity-gradient modulation (~4%', 'inside the quoted uncertainty.') },
    { id: 'periapsis', file: 'tools/twin/VISUAL_QA.md', commit: sidecar('VISUAL_QA.md').commit,
      ...quote(qa, 'periapsis recurs roughly once per', 'depending on arming phase') },
  ];

  const checkpoints = {};
  for (const t of golden.meta.checkpoints_s) {
    const cp = golden.checkpoints[String(t)];
    checkpoints[String(t)] = { t: cp.t, tip_speed_rel_com: cp.tip_speed_rel_com, tip_centripetal_accel: cp.tip_centripetal_accel };
  }

  return {
    revA,
    provenance: {
      revA: sidecar('rev_a.json'),
      golden: gProv,
      twin: sidecar('twin-physics.mjs'),
      glossary: sidecar('glossary.md'),
      tetherDynamics: sidecar('tether_dynamics.py'),
      visualQa: sidecar('VISUAL_QA.md'),
    },
    rEarthKm: { value: R.value, line: R.line, text: R.text, path: 'tools/twin/physics.js', commit: sidecar('twin-physics.mjs').commit },
    golden: {
      path: gProv.path,
      commit: gProv.commit,
      meta: { dt: golden.meta.dt, duration_s: golden.meta.duration_s, checkpoints_s: golden.meta.checkpoints_s, config: golden.meta.config },
      mean_tip_speed_mps: golden.mean_tip_speed_mps,
      mean_tip_centripetal_accel_mps2: golden.mean_tip_centripetal_accel_mps2,
      checkpoints,
    },
    claims,
  };
}

export function render(d) {
  const body = JSON.stringify(d, null, 1).replace(/\n/g, '\n  ');
  return `// Generated by build-data.mjs from the files under snapshots/ and their provenance sidecars. Do not edit.
// Skyhook params/rev_a.json @ ${d.provenance.revA.commit} (sha256 ${d.provenance.revA.sourceSha256});
// tools/twin/physics.js, tools/twin/golden.json, docs/glossary.md, physics/tether_dynamics.py and
// tools/twin/VISUAL_QA.md at the same commit (hashes inside).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPIN_WOBBLE_CANON = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return ${body};
});
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node ideas/16-spin-wobble/build-data.mjs [--check]\nWrites snapshots/canon.data.js from the snapshots; --check exits 1 if it is stale.');
    process.exit(0);
  }
  const dest = snap('canon.data.js');
  const out = render(derive());
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    if (cur !== out) {
      console.error('canon.data.js is stale; re-run build-data.mjs');
      process.exit(1);
    }
    console.log('canon.data.js is current');
  } else {
    fs.writeFileSync(dest, out);
    console.log(`wrote ${path.relative(process.cwd(), dest)} (${out.length} bytes)`);
  }
}
