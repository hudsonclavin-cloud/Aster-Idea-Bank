// Writes oracle/cases.json: initial states for the ANH3BP oracle (anh3bp_oracle.py), from this module's own setup, so
// the oracle and the kernel start from the same numbers. node ideas/42-closing-in/oracle/build-cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { K, sample41 } = require('../load.cjs');
const DAY = 86400, cases = [];
const src = K.importSignal(sample41()), R = K.run(src, K.defaults());
const ts = R.ap.standoff.t, A = R.ap.astAt(ts), F = K.samAxes(A), am = 1 / 81.119, mu = 2.68;
const add = (a, b) => a.map((x, i) => x + b[i]), sc = (a, s) => a.map((x) => x * s), cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function push(name, t0, ast, rho, v, mu, am, days) { cases.push({ name, t0, t1: t0 + days * DAY, ast_r: ast.r, ast_v: ast.v, rho0: rho, v0: v, mu, am, cr: 1 }); }
// 1. a terminator orbit at 3 km around Apophis (normal toward the Sun), 10 days
{ const r = sc(F.y, 3000), v = add(sc(F.z, Math.sqrt(mu / 3000)), cr(F.omega, r)); push('apophis-terminator-3km', ts, A, r, v, mu, am, 10); }
// 2. released at rest (in the SAM frame) at the chain's 18.6 km stand-off, 5 days
{ const r = R.ap.standoff.r; push('apophis-standoff-drift', ts, A, r, cr(F.omega, r), mu, am, 5); }
// 3. closing from 1000 km sunward at 1 m/s, 10 days
{ const r = sc(F.x, 1e6); push('apophis-closing-1000km', ts, A, r, add(sc(F.x, -1), cr(F.omega, r)), mu, am, 10); }
// 4. OSIRIS-REx's first orbit about Bennu (Horizons, 2019-01-01) with SBDB's GM, 3 days
{ const O = K.horizons.orex.orbitA, t0 = K.tdbOfJd(O.jd0); push('bennu-orbit-a', t0, { r: O.bennuHelio0.slice(0, 3), v: O.bennuHelio0.slice(3) }, O.rel[0].slice(0, 3), O.rel[0].slice(3), K.bodies['101955'].GM_m3_s2, 0.0127, 3); }
fs.writeFileSync(path.join(HERE, 'cases.json'), JSON.stringify({ muSun: K.MU_SUN, srpK: K.P1AU * K.AU * K.AU, note: 'srpK = P(1 au) au^2 (N), so the SRP acceleration is srpK cr (A/m) / d^2; the oracle\'s G1', cases }, null, 1) + '\n');
console.log('wrote', cases.length, 'cases');
