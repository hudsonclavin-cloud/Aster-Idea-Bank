#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 35's committed sample handoff (idea 34's sample stack flown
// from Cape Canaveral due east, read from ideas/35-max-q/handoff.json unchanged) guided by UPFG to this module's default
// target for it (a circle at Aster's 6,578.137 km parking radius, 28.5 deg, the plane idea 35's azimuth gives), with a
// 100-sample Monte Carlo at AS-512-sized dispersions (seed 1). Every choice is an assumption made to show the chain;
// closedloop.test.mjs checks the file is what the kernel computes for it.
// Run from the bank root: node ideas/36-closed-loop/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const SAMPLE = { n: 100, seed: 1, sigmaScale: 1, produced: '2026-10-31T12:00:00Z' };
export function sample(h35, opts = SAMPLE) {
  const C = L.C;
  const ctx = C.setup(h35);
  if (ctx.refusal) throw new Error(ctx.refusal.reason);
  const R = C.run(ctx, { samples: false });
  if (!R.guided.ok) throw new Error(R.guided.refusals[0].reason);
  const mc = C.monteCarlo(ctx, R, { n: opts.n, seed: opts.seed, sigmaScale: opts.sigmaScale });
  mc.step(opts.n);
  const res = mc.result();
  return { handoff: C.makeHandoff(ctx, R, res, { produced: opts.produced }), ctx, run: R, mc: res };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h35 = JSON.parse(fs.readFileSync(path.join(here, '..', '35-max-q', 'handoff.json'), 'utf8'));
  const { handoff, run, mc } = sample(h35);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  const o = run.guided.orbit;
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes; orbit',
    (o.perigeeAlt / 1000).toFixed(3), 'x', (o.apogeeAlt / 1000).toFixed(3), 'km at', o.inclinationDeg.toFixed(4), 'deg; left', run.guided.guided.propellantLeft.toFixed(1), 'kg; MC on target', mc.guided.onTarget, '/', mc.n, ', replay in orbit', mc.replay.inOrbit);
}
