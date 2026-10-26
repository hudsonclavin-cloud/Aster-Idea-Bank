#!/usr/bin/env node
// study.mjs: runs Skyhook's own lumped-mass twin (snapshots/twin-physics.mjs, a byte-identical copy
// of tools/twin/physics.js at 34935cb, the validated port of physics/tether_dynamics.py) and holds
// the closed form in wobble.js against it. Node built-ins only; the page never runs this.
//
//   node ideas/16-spin-wobble/study.mjs            print the study (exit 1 if a gate fails)
//   node ideas/16-spin-wobble/study.mjs --write    also rewrite snapshots/twin-overlay.js, the
//                                                  recorded run the page overlays
//   node ideas/16-spin-wobble/study.mjs --sweeps   also rerun the twin stiffer and finer to show
//                                                  what the residual is not (adds ~5 s)
//   node ideas/16-spin-wobble/study.mjs --help
//
// What it does, in order:
//  1. The port gate: the snapshot twin for golden.json's own 600 s at its own dt must land on the
//     golden checkpoints within the tolerances tools/twin/verify.mjs uses (0.1 % per coordinate,
//     1 m floor near zero, mean tip speed within 1 %; verify.mjs:32-35). It also reports how close
//     it actually is, which is far closer.
//  2. The golden reconciliation: the closed form's own time integration over the same 600 s window
//     at the same dt, averaged the same way (sample after each step, divide by steps), against
//     golden.json's mean_tip_speed_mps and mean_tip_centripetal_accel_mps2 and the checkpoint tip
//     speeds.
//  3. The overlay: the twin over two full turns in the orbiting frame (four verticals), its tip speed
//     against the closed form at the same tether angle (the tip-to-tip chord's angle from the local
//     vertical through the centre of mass), the vertical crossing times and the lower tip's
//     periapsis times against the closed form's half-period.
//  4. A rigid line body with the twin's own 17 lump masses under exact point-mass gravity, with the
//     orbit free to respond, against the closed form: what rigidity alone predicts.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const W = require(path.join(here, 'wobble.js'));
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f), 'utf8'));

// tools/twin/verify.mjs:32-35, at 34935cb. Cited, not snapshotted: the gate's three tolerances.
export const VERIFY_TOLERANCES = { posRel: 0.001, posAbsFloorM: 1.0, meanTipSpeedRel: 0.01 };

export async function loadTwin() {
  return import(pathToFileURL(path.join(here, 'snapshots', 'twin-physics.mjs')).href);
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// One twin run from the golden start, recording what the study needs. `overrides` go to
// TetherConfig (the same simulation knobs the Python dataclass exposes).
export function runTwin(T, revA, { overrides = {}, dt, duration, sampleEvery = 0, closed = null, onCheckpoint = null, checkpoints = [] }) {
  const sim = new T.TetherSim(new T.TetherConfig(revA, overrides));
  const N = sim.m.length;
  const steps = Math.round(duration / dt);
  const cpSteps = new Map(checkpoints.map((t) => [Math.round(t / dt), t]));
  let unwrapped = 0, turns = 0;
  let sumV = 0, sumA = 0;
  const samples = [], verticals = [], periapsis = [];
  let maxResid = 0, sumResid = 0, maxBend = 0;
  let prevR = Math.hypot(sim.state[0], sim.state[1]), prevDelta = null;
  let prevV = sim.tipSpeedRelCom(), prevT = sim.t, prevChord = 0;
  if (cpSteps.has(0) && onCheckpoint) onCheckpoint(0, sim);
  for (let i = 1; i <= steps; i++) {
    sim.step(dt);
    const [cx, cy] = sim.com();
    const local = Math.atan2(cy, cx);
    const lx = sim.state[0], ly = sim.state[1];
    const ux = sim.state[4 * (N - 1)], uy = sim.state[4 * (N - 1) + 1];
    // the tether's angle: the lower-tip-to-upper-tip chord, from the local vertical through the CoM
    const chord = wrap(Math.atan2(uy - ly, ux - lx) - local);
    const before = unwrapped;
    unwrapped += wrap(chord - prevChord);
    prevChord = chord;
    const v = sim.tipSpeedRelCom();
    sumV += v;
    sumA += sim.tipCentripetalAccel();
    // the chain's bend: the angle between the two tips as seen from the CoM, less pi
    const bend = wrap(Math.atan2(uy - cy, ux - cx) - Math.atan2(cy - ly, cx - lx));
    if (Math.abs(bend) > maxBend) maxBend = Math.abs(bend);
    if (closed) {
      const r = v - closed.tipSpeed(unwrapped);
      if (Math.abs(r) > Math.abs(maxResid)) maxResid = r;
      sumResid += r;
    }
    const k = Math.floor(unwrapped / Math.PI);
    if (k > turns) { // the chord passed a vertical: interpolate time and speed linearly in the angle
      const frac = (k * Math.PI - before) / (unwrapped - before);
      verticals.push({ k, t: prevT + frac * (sim.t - prevT), v: prevV + frac * (v - prevV) });
      turns = k;
    }
    // lower-tip periapsis, detected the way tools/twin/twin.js:307-318 detects it
    const r0 = Math.hypot(lx, ly);
    const delta = r0 - prevR;
    if (prevDelta !== null && prevDelta < 0 && delta >= 0) periapsis.push(prevT);
    prevDelta = delta;
    prevR = r0;
    if (sampleEvery && i % sampleEvery === 0) samples.push([sim.t, unwrapped, v]);
    if (cpSteps.has(i) && onCheckpoint) onCheckpoint(cpSteps.get(i), sim);
    prevV = v;
    prevT = sim.t;
  }
  return { sim, steps, meanV: sumV / steps, meanA: sumA / steps, samples, verticals, periapsis, maxResid, meanResid: closed ? sumResid / steps : null, maxBend };
}

export async function runStudy({ sweeps = false } = {}) {
  const T = await loadTwin();
  const revA = readJson('rev_a.json');
  const golden = readJson('golden.json');
  const canon = require(path.join(here, 'snapshots', 'canon.data.js'));
  const c = W.readCanon(canon);
  if (!c.ok) throw new Error(c.refusal.reason);
  const out = { commit: canon.provenance.twin.commit };

  // 1. the port gate
  const dtG = golden.meta.dt, durG = golden.meta.duration_s;
  let maxRel = 0, maxAbs = 0, worst = null, posOk = true;
  const gate = runTwin(T, revA, {
    dt: dtG, duration: durG, checkpoints: golden.meta.checkpoints_s,
    onCheckpoint: (t, sim) => {
      const g = golden.checkpoints[String(t)].state;
      for (let i = 0; i < g.length; i++) {
        if (i % 4 > 1) continue; // positions only, as verify.mjs compares x and y
        const err = Math.abs(sim.state[i] - g[i]);
        if (Math.abs(g[i]) < VERIFY_TOLERANCES.posAbsFloorM) {
          if (err >= VERIFY_TOLERANCES.posAbsFloorM) posOk = false;
          maxAbs = Math.max(maxAbs, err);
        } else {
          const rel = err / Math.abs(g[i]);
          if (rel >= VERIFY_TOLERANCES.posRel) posOk = false;
          if (rel > maxRel) { maxRel = rel; worst = { t, index: i }; }
        }
      }
    },
  });
  const meanRelErr = Math.abs(gate.meanV - golden.mean_tip_speed_mps) / golden.mean_tip_speed_mps;
  out.gate = {
    pass: posOk && meanRelErr < VERIFY_TOLERANCES.meanTipSpeedRel,
    maxRelPosErr: maxRel, maxAbsPosErrNearZero: maxAbs, worst,
    meanTipSpeed: gate.meanV, goldenMeanTipSpeed: golden.mean_tip_speed_mps, meanRelErr,
    meanCentripetal: gate.meanA, goldenMeanCentripetal: golden.mean_tip_centripetal_accel_mps2,
  };

  // 2. the golden reconciliation (twin radius convention, radial spin-up: the golden start)
  const m = W.fromCanon(c, { tier: 'reference', radius: 'twin', theta0Deg: 0 });
  const stepsG = Math.round(durG / dtG);
  const rig = W.integrate(m, { dt: dtG, steps: stepsG, sampleEvery: 1 });
  const cps = golden.meta.checkpoints_s.filter((t) => t > 0).map((t) => {
    const s = rig.samples[Math.round(t / dtG) - 1];
    const tw = golden.checkpoints[String(t)].tip_speed_rel_com;
    return { t, twin: tw, closed: s[2], diff: tw - s[2] };
  });
  out.golden = {
    closedMean: rig.meanV, goldenMean: golden.mean_tip_speed_mps, diff: golden.mean_tip_speed_mps - rig.meanV,
    rel: (golden.mean_tip_speed_mps - rig.meanV) / golden.mean_tip_speed_mps,
    closedCentripetal: rig.meanV2 / m.inputs.L, goldenCentripetal: golden.mean_tip_centripetal_accel_mps2,
    checkpoints: cps,
    windowS: durG, dt: dtG,
  };

  // 3. the overlay: two full turns in the orbiting frame (four verticals), sampled every 5 s
  const duration = Math.ceil((4 * m.halfPeriod + 5) / 10) * 10;
  const every = Math.round(5 / dtG);
  const ov = runTwin(T, revA, { dt: dtG, duration, sampleEvery: every, closed: m });
  const verticals = ov.verticals.map((x) => ({ ...x, closedT: x.k * m.halfPeriod }));
  out.overlay = {
    dt: dtG, durationS: duration, sampleEverySteps: every,
    samples: ov.samples,
    maxResidual: ov.maxResid, meanResidual: ov.meanResid,
    peakToTrough: m.vVertical - m.vHorizontal,
    residualFraction: Math.abs(ov.maxResid) / (m.vVertical - m.vHorizontal),
    maxBendDeg: ov.maxBend * 180 / Math.PI,
    verticals,
    periapsis: ov.periapsis.map((t, i) => ({ t, closedT: 2 * (i + 1) * m.halfPeriod })),
    halfPeriod: m.halfPeriod, halfPeriodNoGradient: m.halfPeriodNoGradient, inertialPeriod: m.inertialPeriod,
  };

  // 4. rigid line body with the twin's own lumps, exact gravity, orbit free
  const sim0 = new T.TetherSim(new T.TetherConfig(revA));
  const rb = W.rigidLineBody({ mu: sim0.mu, R: sim0.Rcom, masses: sim0.m, s: sim0.s, w0: sim0.omega, dt: dtG, steps: Math.round(duration / dtG), sampleEvery: 1 });
  let rbMax = 0;
  for (const [, th, v] of rb.samples) rbMax = Math.max(rbMax, Math.abs(v - m.tipSpeed(th)));
  let rbSum = 0;
  for (let i = 0; i < stepsG; i++) rbSum += rb.samples[i][2];
  out.rigidBody = { maxDiff: rbMax, mean600: rbSum / stepsG, IoverML2: rb.I / (rb.M * sim0.L * sim0.L), IoverMR2: rb.I / (rb.M * sim0.Rcom * sim0.Rcom) };

  if (sweeps) {
    const stiff = runTwin(T, revA, { overrides: { targetStrain: 1e-4 }, dt: 0.02, duration, closed: m });
    const fine = runTwin(T, revA, { overrides: { nNodes: 33 }, dt: dtG / 2, duration, closed: m });
    out.sweeps = {
      stiff: { targetStrain: 1e-4, dt: 0.02, maxResidual: stiff.maxResid, maxBendDeg: stiff.maxBend * 180 / Math.PI },
      fine: { nNodes: 33, dt: dtG / 2, maxResidual: fine.maxResid, maxBendDeg: fine.maxBend * 180 / Math.PI },
    };
  }
  out.model = m;
  return out;
}

const round = (x, d) => Number(x.toFixed(d));

export function overlayFile(study, canon) {
  const o = study.overlay;
  const data = {
    source: {
      twin: canon.provenance.twin,
      golden: canon.provenance.golden,
      generatedBy: 'study.mjs --write',
      what: 'tip speed of node 0 relative to the centre of mass, from the golden start, every ' + o.sampleEverySteps + ' steps',
    },
    dt: o.dt, durationS: o.durationS, sampleEverySteps: o.sampleEverySteps,
    samples: o.samples.map(([t, th, v]) => [round(t, 6), round(th, 7), round(v, 4)]),
    verticals: o.verticals.map((x) => ({ k: x.k, t: round(x.t, 4), v: round(x.v, 4) })),
    periapsis: o.periapsis.map((x) => round(x.t, 4)),
    maxResidual: round(o.maxResidual, 4), meanResidual: round(o.meanResidual, 4), maxBendDeg: round(o.maxBendDeg, 4),
    gate: {
      pass: study.gate.pass,
      maxRelPosErr: Number(study.gate.maxRelPosErr.toPrecision(3)),
      meanTipSpeed: round(study.gate.meanTipSpeed, 6),
      meanRelErr: Number(study.gate.meanRelErr.toPrecision(3)),
    },
    rigidBody: { maxDiff: round(study.rigidBody.maxDiff, 4), mean600: round(study.rigidBody.mean600, 4) },
  };
  const body = JSON.stringify(data).replace(/\],\[/g, '],\n  [');
  return `// Generated by study.mjs --write from snapshots/twin-physics.mjs (tools/twin/physics.js @ ${canon.provenance.twin.commit}). Do not edit.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPIN_WOBBLE_TWIN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return ${body};
});
`;
}

function report(s) {
  const m = s.model, g = s.gate, o = s.overlay, gd = s.golden;
  const f = (x, d = 2) => x.toFixed(d);
  const L = [];
  L.push(`Spin Wobble study: the closed form against Skyhook's twin (tools/twin/physics.js @ ${s.commit.slice(0, 7)})`);
  L.push('');
  L.push(`Closed form, Rev A reference (v_tip 2500 m/s at the vertical, L ${f(m.inputs.L / 1e3, 0)} km, R ${f(m.inputs.R / 1e3, 0)} km = R_E + altitude):`);
  L.push(`  n = ${m.n.toExponential(6)} rad/s, omega = ${m.w0.toExponential(6)} rad/s, n/omega = ${f(m.nu, 5)}, n^2/omega^2 = ${f(m.nu * m.nu * 100, 3)} %`);
  L.push(`  tip speed: vertical ${f(m.vVertical)} m/s, horizontal ${f(m.vHorizontal)} m/s, dip ${f(m.dipFromVertical * 100, 3)} % (first order ${f(m.firstOrderDip * 100, 3)} %; the docstring's 1.5 n^2/omega^2 gives ${f(m.programDip * 100, 3)} %)`);
  L.push(`  rotation mean (AGM) ${f(m.vMean)} m/s = ${f(m.meanVsV0 * 100, 3)} % against the vertical value`);
  L.push(`  vertical to vertical ${f(m.halfPeriod, 2)} s (no gradient ${f(m.halfPeriodNoGradient, 2)} s); a tip returns to the bottom every ${f(2 * m.halfPeriod, 2)} s; inertial period 2 pi L / v = ${f(m.inertialPeriod, 2)} s`);
  L.push('');
  L.push(`1. Port gate (verify.mjs tolerances 0.1 % / 1 m / 1 %): ${g.pass ? 'PASS' : 'FAIL'}`);
  L.push(`  max relative position error ${g.maxRelPosErr.toExponential(2)}; near-zero coordinates within ${g.maxAbsPosErrNearZero.toExponential(2)} m`);
  L.push(`  mean tip speed ${f(g.meanTipSpeed, 6)} vs golden ${f(g.goldenMeanTipSpeed, 6)} m/s (relative ${g.meanRelErr.toExponential(2)})`);
  L.push('');
  L.push(`2. Golden reconciliation, the closed form integrated over golden's ${gd.windowS} s window at its dt:`);
  L.push(`  mean tip speed: closed form ${f(gd.closedMean, 3)}, golden ${f(gd.goldenMean, 3)} m/s, golden minus closed ${f(gd.diff, 3)} m/s (${(gd.rel * 100).toFixed(4)} %)`);
  L.push(`  mean centripetal: closed form v^2/L ${f(gd.closedCentripetal, 5)}, golden ${f(gd.goldenCentripetal, 5)} m/s^2`);
  for (const cp of gd.checkpoints) L.push(`  t = ${cp.t} s: twin ${f(cp.twin, 3)}, closed form ${f(cp.closed, 3)}, difference ${f(cp.diff, 3)} m/s`);
  L.push('');
  L.push(`3. Overlay, ${o.durationS} s (just over two turns in the orbiting frame), sampled every ${o.sampleEverySteps} steps:`);
  L.push(`  largest |twin - closed form| at the same chord angle ${f(Math.abs(o.maxResidual), 3)} m/s = ${f(o.residualFraction * 100, 2)} % of the ${f(o.peakToTrough, 2)} m/s swing; mean residual ${f(o.meanResidual, 3)} m/s`);
  L.push(`  the chain bends by up to ${f(o.maxBendDeg, 3)} deg (lower tip to upper tip, seen from the CoM)`);
  for (const x of o.verticals) L.push(`  vertical ${x.k}: twin t = ${f(x.t, 2)} s, closed form ${f(x.closedT, 2)} s; twin tip speed there ${f(x.v, 3)} m/s`);
  for (const p of o.periapsis) L.push(`  lower-tip periapsis (twin.js's detector): twin t = ${f(p.t, 2)} s, closed form ${f(p.closedT, 2)} s`);
  L.push('');
  L.push(`4. Rigid line body, the twin's own lump masses, exact point-mass gravity, orbit free (I/(M L^2) ${f(s.rigidBody.IoverML2, 4)}):`);
  L.push(`  largest |rigid body - closed form| over ${o.durationS} s: ${s.rigidBody.maxDiff.toFixed(4)} m/s; its ${gd.windowS} s mean ${f(s.rigidBody.mean600, 3)} m/s`);
  if (s.sweeps) {
    L.push('');
    L.push('Sweeps (what the residual is not):');
    L.push(`  axial stiffness x50 (target strain 1e-4, dt 0.02 s): largest residual ${f(Math.abs(s.sweeps.stiff.maxResidual), 3)} m/s, bend ${f(s.sweeps.stiff.maxBendDeg, 3)} deg`);
    L.push(`  33 nodes instead of 17 (dt halved): largest residual ${f(Math.abs(s.sweeps.fine.maxResidual), 3)} m/s, bend ${f(s.sweeps.fine.maxBendDeg, 3)} deg`);
  }
  return L.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 27).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  }
  const unknown = args.filter((a) => !['--write', '--sweeps'].includes(a));
  if (unknown.length) {
    console.error(`unknown option ${unknown.join(' ')}; see --help`);
    process.exit(2);
  }
  const s = await runStudy({ sweeps: args.includes('--sweeps') });
  console.log(report(s));
  if (args.includes('--write')) {
    const canon = require(path.join(here, 'snapshots', 'canon.data.js'));
    const dest = path.join(here, 'snapshots', 'twin-overlay.js');
    fs.writeFileSync(dest, overlayFile(s, canon));
    console.log(`\nwrote ${path.relative(process.cwd(), dest)}`);
  }
  const ok = s.gate.pass && Math.abs(s.golden.rel) < 1e-4 && s.overlay.residualFraction < 0.1 && s.rigidBody.maxDiff < 0.5;
  if (!ok) {
    console.error('\nFAIL: a gate did not hold (port gate, golden within 1e-4, overlay within 10 % of the swing, rigid body within 0.5 m/s)');
    process.exit(1);
  }
}
