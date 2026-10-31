#!/usr/bin/env node
// Writes handoff.json, this module's sample handoff: idea 37's committed sample handoff (idea 34's sample stack, guided
// by idea 36 to Aster's parking orbit and taken by idea 37 to Aster's Apophis asymptote; read from
// ideas/37-window/handoff.json unchanged) burned with this page's defaults (tangential steering, one burn, the engine as
// handed, the payload as handed). That stage has 1,143 kg of propellant left for a departure that needs about 14 t, so
// the sample carries the departure_propellant and payload_capability refusals and the state the burn reaches when the
// tank runs dry; burnout.test.mjs checks the file is what the kernel computes. Run from the bank root:
// node ideas/38-burn-out/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
export const PRODUCED = '2026-10-31T12:00:00Z';
export function sample(h37) {
  const B = L.B, st = B.importWindow(h37);
  if (st.refusal) throw new Error(st.refusal.reason);
  const set = B.defaults(), src = { window: st }, R = B.compute(src, set);
  return { handoff: B.makeHandoff(src, set, R, { produced: PRODUCED }), st, R, set };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h37 = JSON.parse(fs.readFileSync(path.join(here, '..', '37-window', 'handoff.json'), 'utf8'));
  const { handoff, R } = sample(h37);
  fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(handoff) + '\n');
  console.log('wrote handoff.json:', Object.keys(handoff.outputs).length, 'outputs,', handoff.refusals.length, 'refusals,', fs.statSync(path.join(here, 'handoff.json')).size, 'bytes; needs', R.sol.mUsed.toFixed(0), 'kg, has', R.sc.mp.toFixed(0));
}
