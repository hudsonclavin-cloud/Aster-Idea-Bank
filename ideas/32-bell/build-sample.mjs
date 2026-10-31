#!/usr/bin/env node
// Writes handoff.json, the sample handoff of this module: idea 31's committed sample chamber (LOX/RP-1,
// O/F 2.6, 10 MPa, snapshots/31-handoff.json) imported, through an 80 % bell of area ratio 16 sized for
// 1 MN at sea level. bell.test.mjs checks the file is what the kernel computes for its inputs.
// Run from the bank root: node ideas/32-bell/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const SAMPLE_NOZZLE = { eps: 16, contour: { type: 'bell', Lf: 0.8 }, ambient: { kind: 'altitude', alt_m: 0 }, design: 'shifting', freeze: 'chamber', thrust: 1e6 };
export function sample(h31, nozzle, produced) {
  const p = L.B.parseHandoff(h31);
  if (p.refusal) throw new Error(p.refusal.reason);
  const r = L.B.chamberFromHandoff(p.chamberHandoff, p.inputs);
  const A = L.B.analyze(r, nozzle);
  return L.B.makeHandoff(p.chamberHandoff, nozzle, A, { produced });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h31 = JSON.parse(fs.readFileSync(path.join(here, 'snapshots/31-handoff.json'), 'utf8'));
  const h = sample(h31, SAMPLE_NOZZLE, '2026-10-31T12:00:00Z');
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(h) + '\n');
  console.log('wrote handoff.json:', Object.keys(h.outputs).length, 'outputs,', h.refusals.length, 'refusals');
}
