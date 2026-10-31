#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 33's committed sample engine (LOX/RP-1, 10 MPa, area
// ratio 16, sized for 1 MN at sea level, F-1 gas-generator cycle; snapshots/33-handoff.json) imported and re-computed,
// seven of them on a first stage with 400 t of propellant, one idea-33 J-2 on a second stage with 100 t, dry masses
// scaled from AS-512's S-IC and S-IVB inert fractions, 10 t of payload. Every mass here is an assumption chosen to
// show the chain; stack.test.mjs checks the file is what the kernel computes for them.
// Run from the bank root: node ideas/34-stack/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const SAMPLE = { count1: 7, propellant1: 400000, count2: 1, propellant2: 100000, payload: 10000, produced: '2026-10-31T12:00:00Z' };
export function sample(h33, opts = SAMPLE) {
  const S = L.S;
  const imp = S.engineFromHandoff(h33);
  if (imp.refusal) throw new Error(imp.refusal.reason);
  const engines = { [imp.record.id]: imp.record, 'J-2': S.engineFromPreset('J-2') };
  const f = S.inertFractions(L.AS512);
  const veh = S.customVehicle([
    { label: 'Stage 1', engine: imp.record.id, count: opts.count1, propellant: opts.propellant1, fraction: f[0] },
    { label: 'Stage 2', engine: 'J-2', count: opts.count2, propellant: opts.propellant2, fraction: f[2] },
  ], opts.payload, 'Idea 33\'s sample engine on two stages (assumed masses)');
  const r = S.evaluate(veh, engines);
  return { handoff: S.makeHandoff(veh, engines, r, { produced: opts.produced }), vehicle: veh, engines, result: r };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h33 = JSON.parse(fs.readFileSync(path.join(here, 'snapshots/33-handoff.json'), 'utf8'));
  const { handoff, result } = sample(h33);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes; dv', result.dv.toFixed(1), 'm/s, T/W', result.liftoff.tw.toFixed(3));
}
