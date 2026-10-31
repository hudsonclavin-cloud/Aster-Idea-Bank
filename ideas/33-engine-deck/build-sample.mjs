#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 32's committed sample nozzle (LOX/RP-1, O/F 2.6, 10 MPa,
// area ratio 16, 80 % bell sized for 1 MN at sea level; snapshots/32-handoff.json) imported unchanged, run as an ideal
// thrust chamber (efficiencies 1, 1) with the F-1's gas-generator cycle, throttle 40 to 110 %. engine.test.mjs checks
// the file is what the kernel computes for its inputs. Run from the bank root: node ideas/33-engine-deck/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const SAMPLE = { reference: 'F-1', throttle: [0.4, 1.1], produced: '2026-10-31T12:00:00Z' };
export function throttles(lo, hi) { return [lo, lo + (1 - lo) / 3, lo + 2 * (1 - lo) / 3, 1, hi].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b); }
export function sample(h32, opts = SAMPLE) {
  const E = L.E;
  const p = E.parseHandoff(h32);
  if (p.refusal) throw new Error(p.refusal.reason);
  const spec = E.specFromNozzle(p);
  const ctx = E.context(spec);
  const D = E.deck(ctx, throttles(opts.throttle[0], opts.throttle[1]));
  const v = E.point(ctx, spec.pc, 0), d = E.densities(spec.prop);
  const cyc = E.cycle(E.cycleReference(opts.reference), { pc: v.pc, mdotOx: v.mdotOx, mdotFuel: v.mdotFuel, prop: spec.prop, rhoOx: d.ox.value, rhoFuel: d.fuel.value });
  return E.makeHandoff(p.nozzleHandoff, spec, D, cyc, { produced: opts.produced, throttle: { min: opts.throttle[0], max: opts.throttle[1], nominal: 1 }, reference: opts.reference });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h32 = JSON.parse(fs.readFileSync(path.join(here, 'snapshots/32-handoff.json'), 'utf8'));
  const h = sample(h32);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(h) + '\n');
  console.log('wrote handoff.json:', Object.keys(h.outputs).length, 'outputs,', h.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes');
}
