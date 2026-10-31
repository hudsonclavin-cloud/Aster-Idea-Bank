#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 39's committed sample handoff (ideas/39-lamberts-road/
// handoff.json, read unchanged: Aster's Apophis cell, with the refusals of ideas 33 to 38 that travel with it) flown
// through this page's defaults. coast.test.mjs checks the file is what the kernel computes.
//   node ideas/40-long-coast/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K } = require(path.join(here, 'load.cjs'));
export const PRODUCED = '2026-10-31T12:00:00Z';
export function sample(h39) {
  const src = K.importLambertsRoad(h39);
  if (src.refusal) throw new Error(src.refusal.reason);
  const R = K.run(src, K.defaults());
  if (R.refusal) throw new Error(R.refusal.reason);
  return { handoff: K.buildHandoff(R, PRODUCED), R, src };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h39 = JSON.parse(fs.readFileSync(path.join(here, '..', '39-lamberts-road', 'handoff.json'), 'utf8'));
  const { handoff } = sample(h39);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes');
}
