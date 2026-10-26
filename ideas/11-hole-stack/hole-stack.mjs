#!/usr/bin/env node
// Hole Stack on the command line: the same kernel as the page (holestack.js), on the snapshots in
// snapshots/ or, with --repo, on the tables of a live PartForge checkout.
//
//   node ideas/11-hole-stack/hole-stack.mjs M6 [options]
//
// Exit 0: every requested feature was built. 2: something was refused (the refusal is printed).
// 3: usage error.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const H = require(path.join(here, 'holestack.js'));
const pf = require(path.join(here, 'snapshots', 'partforge-code.js'));

const HELP = `Usage: node ideas/11-hole-stack/hole-stack.mjs <size> [options]

  <size>              M2 M2.5 M3 M4 M5 M6 M8 M10 M12 M14 M16 M20 (coarse pitch; M6x1 is accepted)
  --head H            socket | countersunk | button | none          (default socket)
  --washer            an ISO 7089 washer under the head
  --series S          fine | medium | coarse (ISO 273)              (default medium)
  --plate MM          clamped plate thickness                       (default 12)
  --far F             through | nut | nyloc | tapped                (default through)
  --part MM           tapped part thickness (with --far tapped)     (default 16)
  --blind             blind tapped hole (default through)
  --stainless         the stainless tap drill (d - 0.85p)
  --model-at W        d1 | drill: where the tapped hole is modelled (default d1)
  --process P         a PartForge FLIGHT_PROCESSES key for default tolerances (default cnc_mill)
  --tess MM           tess_tol for the OpenSCAD and FLIGHT block  (default 0.01)
  --scad              print the OpenSCAD cutter module
  --flight            print the FLIGHT block(s)
  --verify            run PartForge's own parseFlight() and flightLint() (verbatim copies) on the output
  --svg FILE          write the section drawing
  --json              print the result as JSON
  --repo DIR          read fasteners_metric.json and fits.json from a PartForge checkout instead of the snapshots
  --help              this text

Exit codes: 0 built, 2 refused, 3 usage.`;

function fail(msg) { console.error(`hole-stack: ${msg}\n\n${HELP}`); process.exit(3); }
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); process.exit(0); }
const input = {};
const flags = { scad: false, flight: false, verify: false, json: false, svg: null, repo: null };
const VAL = { '--head': 'head', '--series': 'series', '--plate': 'plate_t', '--far': 'far', '--part': 'part_t', '--model-at': 'model_at', '--process': 'process', '--tess': 'tess' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VAL[a]) { if (argv[i + 1] == null) fail(`${a} needs a value`); input[VAL[a]] = argv[++i]; }
  else if (a === '--washer') input.washer = true;
  else if (a === '--blind') input.tap_end = 'blind';
  else if (a === '--stainless') input.drill = 'stainless';
  else if (a === '--scad') flags.scad = true;
  else if (a === '--flight') flags.flight = true;
  else if (a === '--verify') flags.verify = true;
  else if (a === '--json') flags.json = true;
  else if (a === '--svg') { if (argv[i + 1] == null) fail('--svg needs a file'); flags.svg = argv[++i]; }
  else if (a === '--repo') { if (argv[i + 1] == null) fail('--repo needs a directory'); flags.repo = argv[++i]; }
  else if (a.startsWith('--')) fail(`unknown option ${a}`);
  else if (input.size == null) input.size = a;
  else fail(`unexpected argument ${a}`);
}
if (input.size == null) fail('give a size, e.g. M6');

let fm, fits;
if (flags.repo) {
  const t = (f) => JSON.parse(fs.readFileSync(path.join(flags.repo, 'data', 'tables', f), 'utf8'));
  try { fm = t('fasteners_metric.json'); fits = t('fits.json'); } catch (e) { fail(`cannot read the tables under ${flags.repo}: ${e.message}`); }
} else {
  fm = require(path.join(here, 'snapshots', 'fasteners_metric.js')).json;
  fits = require(path.join(here, 'snapshots', 'fits.js')).json;
}
const data = H.makeData(fm, fits, pf);
const res = H.build(input, data);

if (flags.json) {
  const { row, ...rest } = res;
  console.log(JSON.stringify({ ...rest, flightBlocks: { clamp: H.flightBlock(res, 'clamp'), tapped: H.flightBlock(res, 'tapped') } }, null, 1));
} else {
  process.stdout.write(H.text(res));
  if (flags.scad && res.scad) process.stdout.write('\n' + res.scad);
  if (flags.flight) for (const part of ['clamp', 'tapped']) { const b = H.flightBlock(res, part); if (b) console.log(`\n// FLIGHT rows for the ${part === 'clamp' ? 'clamped plate' : 'tapped mating part'}:\n${b}`); }
  if (flags.verify && res.key) {
    console.log('\nPartForge\'s own checks (verbatim from index.html at ' + pf.commit.slice(0, 7) + '):');
    const lint = pf.flightLint(res.scad);
    console.log(`  flightLint(OpenSCAD): ${lint.length ? lint.join('; ') : 'clean'}`);
    for (const part of ['clamp', 'tapped']) {
      const b = H.flightBlock(res, part); if (!b) continue;
      const f = pf.parseFlight(b);
      console.log(`  parseFlight(${part}): holes ${f.holes.length}, bores ${f.bores.length}, gauges ${f.gauges.length}; dropped ${f.dropped}, demoted ${f.demoted}; tol_src source ${f.provenance.dims.source}, default ${f.provenance.dims.default}`);
    }
  }
}
if (flags.svg && res.geometry) fs.writeFileSync(flags.svg, H.svg(res));
process.exit(res.refusals.length ? 2 : 0);
