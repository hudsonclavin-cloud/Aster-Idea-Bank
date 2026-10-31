#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 38's committed sample handoff (ideas/38-burn-out/handoff.json,
// read unchanged: idea 34's sample stack taken by ideas 36 and 37 to Aster's Apophis asymptote, which idea 38 finds
// 12.8 t of propellant short of departing) imported with this page's defaults. The transfer is Aster's own cell (the one
// idea 37's asymptote came from), recomputed here; idea 38's refusals travel with it, plus this module's
// chain_departure refusal, because nothing departed. lambert.test.mjs checks the file is what the kernel computes.
//   node ideas/39-lamberts-road/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K } = require(path.join(here, 'load.cjs'));
export const PRODUCED = '2026-10-31T12:00:00Z';
export function sample(h38) {
  const chain = K.importBurnOut(h38);
  if (chain.refusal) throw new Error(chain.refusal.reason);
  const R = K.run(K.defaults(), { chain });
  return { handoff: K.buildHandoff(R, PRODUCED), R, chain };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h38 = JSON.parse(fs.readFileSync(path.join(here, '..', '38-burn-out', 'handoff.json'), 'utf8'));
  const { handoff } = sample(h38);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes');
}
