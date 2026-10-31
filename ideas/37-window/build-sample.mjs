#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 36's committed sample handoff (idea 34's sample stack guided to
// Aster's 6,578.137 km parking radius at 28.5 deg, read from ideas/36-closed-loop/handoff.json unchanged) taken to the
// departure asymptote of Aster's own Apophis cell (the one cell in Aster's fixtures with v-infinity components: departure
// 2026-07-02, C3 0.511 km^2/s^2, DLA 43.57 deg), from Pad 39A's longitude placed from the AS-512 report, Aster's Cape
// corridor 35 to 120 deg, coasts up to AS-512's own insertion-to-TLI-cutoff 11,195 s, launching at the first window's
// opening. Every choice is an assumption made to show the chain; window.test.mjs checks the file is what the kernel
// computes for it. Run from the bank root: node ideas/37-window/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const PRODUCED = '2026-10-31T12:00:00Z';
export function sample(h36) {
  const W = L.W;
  const st = W.importClosedLoop(h36);
  if (st.refusal) throw new Error(st.refusal.reason);
  const set = W.defaults(st.siteId), spec = W.apophisSpec();
  const R = W.compute(st, spec, set);
  return { handoff: W.makeHandoff(st, spec, set, R, { produced: PRODUCED }), st, R, set, spec };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h36 = JSON.parse(fs.readFileSync(path.join(here, '..', '36-closed-loop', 'handoff.json'), 'utf8'));
  const { handoff, R } = sample(h36);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  const w = R.windows[0];
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes; window', w.open, 'to', w.close, '; launch az', R.launch.azDeg.toFixed(4), 'deg; propellant', R.flight.propellant.toFixed(1), 'kg');
}
