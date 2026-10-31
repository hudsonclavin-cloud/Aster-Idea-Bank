#!/usr/bin/env node
// Writes oracle/cases.json: the inputs the Python oracle (burn_oracle.py) flies independently, taken from this module's
// own scenarios so both sides fly exactly the same numbers. Run from the bank root: node ideas/38-burn-out/oracle/build-cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, '..', 'load.cjs'));
const B = L.B, D = Math.PI / 180;
const st = B.importWindow(L.WIN);
const sc = B.windowScenario(st, B.defaults());
const ap = B.apollo17Scenario(B.defaults());
const sIg = ap.stateAt(ap.tIgFixed);
// planar circular cases: the chain's AS-512 departure (radius of idea 37's departure point, its C3, mass, J-2) and
// Apollo 17's (radius at the flown ignition, Table 4-2's C3, Table 16-7's ignition mass, the burn's mean thrust), each at
// its own thrust-to-weight and at lower ones (thrust and flow scaled, ve fixed)
const r0a = Math.hypot(...st.dp.r), r0b = Math.hypot(...sIg.r), E = B.apollo17Engine();
const planar = [];
for (const k of [1, 0.4, 0.2]) planar.push({ id: 'as512-apophis-k' + k, r0: r0a, c3: st.c3, m0: sc.m0, F: st.eng.F * k, mdot: st.eng.mdot * k });
for (const k of [1, 0.3]) planar.push({ id: 'apollo17-mean-k' + k, r0: r0b, c3: ap.c3, m0: E.mIg, F: E.meanF * k, mdot: E.meanMdot * k });
// 3-D with J2: the chain's solved tangential burn (with its yaw), from its ignition state in idea 37's frame
const sol = B.solve(sc, B.defaults());
const b = sol.burns[0], s0 = sc.stateAt(b.tIg);
// the cutoff is on the energy conserved under point mass + J2, the thrust yawed out of plane by the solved constant angle
const j2case = { id: 'as512-apophis-j2-tangential', r: s0.r, v: s0.v, m0: sc.m0, F: st.eng.F, mdot: st.eng.mdot, E: sc.E, yaw: sol.yaw, mu: B.constants.MU, J2: L.NAIF.wgs84.J2, RJ2: L.NAIF.wgs84.radius_km * 1000, farRadius: B.FAR };
// perigee burns, planar, no J2: the chain's numbers at a quarter of the thrust, N = 2 and 3, the same splitting rule
const multi = [2, 3].map((N) => ({ id: 'as512-apophis-k0.25-N' + N, N, r0: r0a, c3: st.c3, m0: sc.m0, F: st.eng.F * 0.25, mdot: st.eng.mdot * 0.25 }));
const out = { note: 'Inputs for oracle/burn_oracle.py, written by oracle/build-cases.mjs from the kernel\'s own scenarios', mu: B.constants.MU, planar, j2case, multi };
fs.writeFileSync(path.join(here, 'cases.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote cases.json:', planar.length, 'planar,', 1, 'J2,', multi.length, 'perigee-burn cases');
