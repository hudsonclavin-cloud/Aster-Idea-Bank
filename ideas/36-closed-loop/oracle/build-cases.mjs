#!/usr/bin/env node
// Writes oracle/cases.json, the inputs the independent Python oracle (oracle/guidance_oracle.py) works from. Nothing in
// it is a result the oracle is meant to reproduce except where a key says so ("kernelSteering": the commands it replays).
//
//   flat    a synthetic burn over a flat Earth in uniform gravity (three J-2s, idea 34's record, on the S-IVB's ignition
//           mass from idea 34's AS-512 ledger) from a chosen state to a chosen altitude and horizontal speed with no
//           vertical speed: the oracle finds the minimum-time steering (linear tangent, from the optimality conditions)
//           and its burn time; closedloop.test.mjs flies this kernel's UPFG on the same burn and compares.
//   as512   the AS-512 upper stages from the moment guidance starts: the state there (from this kernel's flight, the
//           one thing taken from it), the vehicle's own data (idea 34's: flows, events, dry masses, coast), the target
//           (Table 4-4) and the thrust directions this kernel commanded, cycle by cycle. The oracle (a) re-flies those
//           commands with its own integrator and its own mass bookkeeping, and (b) finds the minimum-propellant
//           steering to the same target by direct optimisation, to measure what UPFG gives away.
// Run from the bank root: node ideas/36-closed-loop/oracle/build-cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, '..', 'load.cjs'));
const { A, C, DATA, pf } = L;

// ---- flat
const J2 = DATA.engines34['J-2'];
const ledger512 = L.S.evaluate(A.vehicleFromHandoff(DATA.as512).vehicle, A.vehicleFromHandoff(DATA.as512).engines, { timeline: false });
const flatBase = {
  g: pf.ISA_G0, engines: 3, thrustPerEngine_N: J2.thrust_vacuum_N, mdotPerEngine_kg_s: J2.mass_flow_kg_s, m0_kg: ledger512.stages[2].burns[0].mIgnition,
  y0_m: 150000, vx0_m_s: 6000, vy0_m_s: 100, vxT_m_s: 7000,
};
const flat = {
  note: 'Synthetic: three J-2s (idea 34 record) on the S-IVB first-burn ignition mass of idea 34\'s AS-512 ledger, flat Earth, uniform g0, no air. Chosen to exercise the law, not a vehicle. "gentle" climbs 5 km (its optimal thrust sweeps about 35 deg, as AS-512\'s guided upper stages sweep about 42 deg); "steep" climbs 20 km in the same time (a sweep of about 125 deg, outside what UPFG\'s small-angle bias terms can carry).',
  gentle: Object.assign({}, flatBase, { yT_m: 155000 }),
  steep: Object.assign({}, flatBase, { yT_m: 170000 }),
};

// ---- AS-512
const ctx = C.setup(DATA.as512);
const tgt = C.targetOrbit(ctx.target, ctx.plan.site.latitudeDeg);
const g = C.flyClosed(ctx.veh, ctx.engines, ctx.plan, { mode: 'upfg', startAfter: ctx.guidance.startAfter, cycle: ctx.guidance.cycle }, tgt, { samples: false, recordContexts: true });
if (!g.ok) throw new Error('AS-512 guided flight refused: ' + g.refusals[0].reason);
const tg = g.guidanceStart;
const state = g.atGuidance;
if (!state || Math.abs(state.t - tg) > 1e-9) throw new Error('no state at guidance start');
const veh = ctx.veh, sII = veh.stages[1], sIVB = veh.stages[2];
const sIIign = g.stageEnds[1].tIgnition;
const as512 = {
  note: 'AS-512 (idea 34 vehicle, idea 35 first stage with the F-1 at the flight-average flow and the kick fitted) from the start of guidance (Table 2-2 item 36).',
  mu_m3_s2: L.EARTH.mu_m3_s2, radius_m: L.EARTH.radius_m, atmosphereTop_m: C.constants.ATM_TOP,
  t0_s: tg, r0_m: state.r, v0_m_s: state.v, m0_kg: state.mass, sIIburnClock0_s: state.burnClock,
  sII: { ignition_s: sIIign, engines: sII.count, thrustPerEngine_N: ctx.engines[sII.engine].thrustVac, mdotPerEngine_kg_s: ctx.engines[sII.engine].mdot, propellant_kg: sII.burns[0].propellant,
    engineOut: sII.burns[0].engineOut, jettisons: sII.burns[0].jettisons, dry_kg: sII.dry, remaining_kg: sII.remaining, note: 'jettisons before t0 are already off m0' },
  coast_s: ctx.plan.stagingCoast[1],
  sIVB: { engines: sIVB.count, thrustPerEngine_N: ctx.engines[sIVB.engine].thrustVac, mdotPerEngine_kg_s: ctx.engines[sIVB.engine].mdot, shed_kg: sIVB.burns[0].shed, jettisons: sIVB.burns[0].jettisons,
    propellantAvailable_kg: sIVB.burns.reduce((a, b) => a + b.propellant, 0) },
  target: { rd_m: tgt.rd, vd_m_s: tgt.vd, gammaD_rad: tgt.gammaD, n: tgt.n, energy_m2_s2: tgt.energy },
  // the commanded inertial thrust directions [t, ux, uy, uz] from guidance start; each is held, as the kernel holds it,
  // by idea 35's 'linear' steering in the plane of r and u with the pitch turned down at the local horizontal's rate, until
  // the next command (or for one cycle after the last); the oracle rebuilds that from its own state
  cycle_s: ctx.guidance.cycle,
  kernelCommands: g.commands.filter((c) => c.t >= tg - 1e-9).map((c) => [c.t, c.u[0], c.u[1], c.u[2]]),
  kernelCutoff_s: g.t,
};
fs.writeFileSync(path.join(here, 'cases.json'), JSON.stringify({ generated: 'node ideas/36-closed-loop/oracle/build-cases.mjs', flat, as512 }) + '\n');
console.log('wrote oracle/cases.json: guidance start', tg.toFixed(3), 's; cutoff', g.t.toFixed(3), 's;', as512.kernelCommands.length, 'commands');
