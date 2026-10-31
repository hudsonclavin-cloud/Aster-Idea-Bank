#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 34's committed sample vehicle (snapshots/34-handoff.json:
// idea 33's sample engine, seven on a first stage, one J-2 on a second, assumed masses) flown from Cape Canaveral due
// east with a 1-degree kick at 10 s, a 4 m diameter, and the upper stage pitched linearly to 0 deg at burnout from a
// start angle solved here for a level burnout. Every choice is an assumption made to show the chain; ascent.test.mjs
// checks the file is what the kernel computes for it.
// Run from the bank root: node ideas/35-max-q/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const SAMPLE = { kickDeg: 1, diameter: 4, endDeg: 0, produced: '2026-10-31T12:00:00Z' };
export function sample(h34, opts = SAMPLE) {
  const A = L.A;
  const v = A.vehicleFromHandoff(h34);
  if (v.refusal) throw new Error(v.refusal.reason);
  const plan = Object.assign(A.defaultPlan(v.vehicle), { kickDeg: opts.kickDeg, diameter: opts.diameter, upper: { mode: 'linear', startDeg: 0, endDeg: opts.endDeg } });
  const s = A.solveInsertion(v.vehicle, v.engines, plan);
  if (s.refusal) throw new Error(s.refusal.reason);
  plan.upper.startDeg = s.pitchDeg;
  const r = A.fly(v.vehicle, v.engines, plan, { samples: false });
  return { handoff: A.makeHandoff(h34, v.vehicle, plan, r, { produced: opts.produced }), plan, result: r };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { handoff, result } = sample(L.H34);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes; burnout',
    (result.final.altitude / 1000).toFixed(1), 'km', result.final.speed.toFixed(1), 'm/s; orbit', (result.orbit.perigeeAlt / 1000).toFixed(0), 'x', (result.orbit.apogeeAlt / 1000).toFixed(0), 'km; max Q', (result.maxQ.q / 1000).toFixed(2), 'kPa');
}
