/*
 * twin-check.js — runs one catch-and-throw through Skyhook's own tether model (tools/twin/physics.js,
 * the validated JS port of physics/tether_dynamics.py: 17 lumped masses joined by elastic segments,
 * exact inverse-square gravity on every node, RK4) and measures what the ledger predicts.
 *
 * The experiment, all in the twin's own state and methods:
 *   1. Build the twin from rev_a.json (the tier's tip speed and derate swapped in where asked) with the
 *      chosen hub mass. At t = 0 the twin is radial, lower tip Earthward, moving at v_orb - v_tip: the
 *      canon catch state.
 *   2. Catch: add the payload mass to the lower-tip node (a matched-velocity catch; no impulse).
 *   3. Swing: step until that node passes the local vertical above the system's CoM.
 *   4. Throw: take the payload mass off the node. The payload leaves with the node's state.
 *   5. Fly the empty tether for one orbit; record the CoM's lowest and highest radius, the mean
 *      osculating semi-major axis, and the lowest radius any node reaches.
 * This file adds no physics: it calls TetherConfig, TetherSim, step(), com(), totalEnergy().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwinCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function osc(mu, x, y, vx, vy) {
    var r = Math.hypot(x, y);
    var eps = (vx * vx + vy * vy) / 2 - mu / r;
    return { r: r, eps: eps, a: -mu / (2 * eps) };
  }

  /**
   * Prepare a run. twin: { TetherConfig, TetherSim } (the ES module or the classic copy).
   * opts: { vTipKms, derate (number), hubKg, payloadKg, dt (s) }
   * Returns a stepper so a page can run it in slices: call advance(maxSteps) until it returns a result.
   */
  function start(twin, revA, opts) {
    var ra = clone(revA);
    if (opts.vTipKms != null) ra.kinematics.v_tip_kms = opts.vTipKms;
    if (opts.derate != null) ra.materials.derate_fraction = opts.derate;
    var sim = new twin.TetherSim(new twin.TetherConfig(ra, { hubMassKg: opts.hubKg }));
    var mu = sim.mu, dt = opts.dt || 0.1, m = opts.payloadKg;
    var Mtether = sim.m.reduce(function (a, b) { return a + b; }, 0);
    var R = sim.Rcom, L = sim.L, vt = sim.omega * L, vOrb = Math.sqrt(mu / R);
    var c0 = sim.com();
    var a0 = osc(mu, c0[0], c0[1], c0[2], c0[3]).a;
    var E0 = sim.totalEnergy();
    var catchEps = (vOrb - vt) * (vOrb - vt) / 2 - mu / (R - L);
    sim.m[0] += m; // the catch
    var phase = 'swing', t = 0, prevCross = null, out = {}, steps = 0, tEnd = 0;
    var rmin = Infinity, rmax = 0, aSum = 0, nA = 0, nodeMin = Infinity, Erel = 0;
    var nNodes = sim.m.length;

    function payloadRel() {
      var c = sim.com();
      var x = sim.state[0] - c[0], y = sim.state[1] - c[1];
      var rr = Math.hypot(c[0], c[1]);
      return { cross: (x * c[1] - y * c[0]) / rr, rad: (x * c[0] + y * c[1]) / rr };
    }

    function advance(maxSteps) {
      for (var k = 0; k < maxSteps; k++) {
        if (phase === 'swing') {
          sim.step(dt); t += dt; steps++;
          var q = payloadRel();
          if (q.rad > 0 && prevCross !== null && prevCross * q.cross <= 0) {
            var P = sim.state.slice(0, 4);
            var pe = osc(mu, P[0], P[1], P[2], P[3]);
            sim.m[0] -= m; // the throw
            var c1 = sim.com();
            Erel = sim.totalEnergy();
            out.tRelease = t;
            out.payloadGainPerKg = pe.eps - catchEps;
            out.payloadC3 = 2 * pe.eps;
            out.tetherEnergyLossPerKgPayload = (E0 - Erel) / m;
            out.aAtRelease = osc(mu, c1[0], c1[1], c1[2], c1[3]).a;
            tEnd = 1.02 * 2 * Math.PI * Math.sqrt(Math.pow(out.aAtRelease, 3) / mu);
            phase = 'fly'; t = 0;
          }
          prevCross = q.cross;
        } else if (phase === 'fly') {
          sim.step(dt); t += dt; steps++;
          var c = sim.com();
          var o = osc(mu, c[0], c[1], c[2], c[3]);
          if (o.r < rmin) rmin = o.r;
          if (o.r > rmax) rmax = o.r;
          aSum += o.a; nA++;
          for (var i = 0; i < nNodes; i++) {
            var rn = Math.hypot(sim.state[4 * i], sim.state[4 * i + 1]);
            if (rn < nodeMin) nodeMin = rn;
          }
          if (t >= tEnd) {
            var Eend = sim.totalEnergy();
            phase = 'done';
            return {
              done: true,
              M: Mtether,
              R: R, L: L, vOrb: vOrb, vTip: vt, a0: a0,
              tRelease: out.tRelease,
              payloadGainPerKg: out.payloadGainPerKg,
              payloadC3: out.payloadC3,
              tetherEnergyLossPerKgPayload: out.tetherEnergyLossPerKgPayload,
              da: a0 - aSum / nA,
              daAtRelease: a0 - out.aAtRelease,
              perigeeDrop: R - rmin,
              apogeeDrop: R - rmax,
              lowestNodeAltM: nodeMin - twin.R_EARTH_KM * 1e3,
              energyDriftRel: Math.abs((Eend - Erel) / Erel),
              steps: steps,
              dt: dt
            };
          }
        }
      }
      return { done: false, phase: phase, steps: steps };
    }
    return { advance: advance };
  }

  function run(twin, revA, opts) {
    var s = start(twin, revA, opts);
    for (;;) {
      var r = s.advance(1e6);
      if (r.done) return r;
    }
  }

  return { start: start, run: run };
});
