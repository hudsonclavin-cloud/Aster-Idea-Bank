// DERIVED by ideas/30-momentum-ledger/build_data.py from snapshots/twin-physics.mjs (Skyhook tools/twin/physics.js):
// the file verbatim except that the 6 top-level `export ` keywords are removed and it is wrapped as a classic
// script exposing window.SkyhookTwin, because ES modules do not load from file://. Do not edit by hand.
(function (root) {
/**
 * physics.js — JS port of physics/tether_dynamics.py (Python is the validated
 * reference; this file must reproduce it, not reinvent it).
 *
 * Pure functions/classes only. No `window`/`document` references — runnable
 * headless in Node (used by verify.mjs) as well as in the browser (used by
 * twin.js). All Skyhook design parameters (altitude, tether length, tip
 * speed, material properties, safety factor, derate, payload mass) are
 * passed in from the caller, which must load them from params/rev_a.json
 * (Rule 1) — see params-loader.js for the browser-side fetch, or
 * scripts/generate_golden.py / verify.mjs for how the Node side reads it.
 *
 * Two universal physical constants are hardcoded here exactly as they are in
 * physics/skyhook_physics.py (R_EARTH_KM, G_STD module constants there):
 * Earth's mean radius and standard gravity are not Skyhook design
 * parameters, so they are not expected to live in rev_a.json, and the
 * Python reference itself does not source them from there either.
 */

// [Certain] Earth mean radius, km — mirrors physics/skyhook_physics.py R_EARTH_KM.
const R_EARTH_KM = 6371.0;
// [Certain] Standard gravity, m/s^2 — mirrors physics/skyhook_physics.py G_STD.
const G_STD = 9.80665;

/** EQ-4: V_c = sqrt(2*sigma/rho), km/s. Direct port of
 * physics/skyhook_physics.py::characteristic_velocity_kms. */
function characteristicVelocityKms(tensileStrengthGPa, densityKgm3) {
  const sigmaPa = tensileStrengthGPa * 1e9;
  return Math.sqrt((2 * sigmaPa) / densityKgm3) / 1e3;
}

/**
 * erf(x) via the Abramowitz & Stegun 7.1.26 rational approximation
 * (max abs error 1.5e-7). JS has no native erf, unlike Python's math.erf
 * (exact, C library). This precision is far inside the 0.1% relative
 * tolerance the twin is verified against (see tools/twin/verify.mjs) —
 * flagged in the dispatch report as the one unavoidable language-level
 * deviation from the Python reference.
 */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/**
 * Config mirroring physics/tether_dynamics.py::TetherConfig.
 * `revA` is the parsed params/rev_a.json object (Rule 1: canonical source).
 * `overrides` covers the same non-rev_a.json simulation knobs the Python
 * dataclass hardcodes as its own defaults (hub mass, target strain, node
 * count) — these are simulation configuration, not program design
 * parameters, exactly as in the Python reference.
 */
class TetherConfig {
  constructor(revA, overrides = {}) {
    this.nNodes = overrides.nNodes ?? 17;
    this.comAltitudeKm = revA.orbital.com_altitude_km;
    this.halfLengthKm = revA.geometry.tether_half_length_km;
    this.vTipKms = revA.kinematics.v_tip_kms;
    this.sigmaGPa = revA.materials.tensile_strength_GPa;
    this.rhoKgm3 = revA.materials.density_kgm3;
    this.safetyFactor = revA.materials.safety_factor;
    this.derate = revA.materials.derate_fraction;
    this.designPayloadKg =
      revA.mass_ratio.integrated_tether_to_payload_both_arms
        .payload_mass_kg_for_tonnage;
    this.muEarth = revA.orbital.mu_earth_m3s2;
    // [Speculative] hub mass default — mirrors tether_dynamics.py TetherConfig
    // ("100-300 t hub; 200 t midpoint used until a hub mass budget exists").
    this.hubMassKg = overrides.hubMassKg ?? 200e3;
    // [Likely] elastic strain at design working stress; see tether_dynamics.py.
    this.targetStrain = overrides.targetStrain ?? 0.005;
    this.gravity = overrides.gravity ?? true;
    this.payloadBothTips = overrides.payloadBothTips ?? false;
  }
}

/**
 * Planar lumped-mass tether. State: flat array of per-node [x, y, vx, vy] in
 * meters / (m/s), Earth-centered inertial frame — same layout as the Python
 * reference's flat list state.
 */
class TetherSim {
  constructor(cfg) {
    this.cfg = cfg;
    const n = cfg.nNodes;
    if (n < 3 || n % 2 === 0) {
      throw new Error("nNodes must be odd and >= 3 (center node = hub)");
    }

    const L = cfg.halfLengthKm * 1e3;
    this.L = L;
    this.omega = (cfg.vTipKms * 1e3) / L; // rad/s [Certain]
    this.Rcom = (R_EARTH_KM + cfg.comAltitudeKm) * 1e3;
    this.mu = cfg.muEarth;

    const sigma = cfg.sigmaGPa * 1e9;
    this.sigmaW = (sigma * (1.0 - cfg.derate)) / cfg.safetyFactor;
    const Vc = characteristicVelocityKms(cfg.sigmaGPa, cfg.rhoKgm3) * 1e3;
    this.xRatio =
      ((cfg.vTipKms * 1e3) / Vc) *
      Math.sqrt(cfg.safetyFactor / (1.0 - cfg.derate));
    this.A_L = (cfg.designPayloadKg * this.omega ** 2 * L) / this.sigmaW;
    this.E_eff = this.sigmaW / cfg.targetStrain;

    // node arc-positions s_i in [-L, L], spacing h
    this.h = (2.0 * L) / (n - 1);
    this.s = Array.from({ length: n }, (_, i) => -L + i * this.h);
    this.center = Math.floor((n - 1) / 2);

    // exact lump masses from the continuum profile [Certain]
    this.m = this.s.map((si) =>
      this._armMassBetween(
        Math.max(Math.abs(si) - this.h / 2, 0.0),
        Math.min(Math.abs(si) + this.h / 2, L),
      ),
    );
    // center node straddles s=0: its window [0, h/2] exists on BOTH arms
    this.m[this.center] *= 2.0;
    this.m[this.center] += cfg.hubMassKg;
    if (cfg.payloadBothTips) {
      this.m[0] += cfg.designPayloadKg;
      this.m[n - 1] += cfg.designPayloadKg;
    }

    // segment stiffness EA at segment midpoints [Certain given E_eff]
    this.nSeg = n - 1;
    this.segMid = Array.from(
      { length: this.nSeg },
      (_, j) => 0.5 * (this.s[j] + this.s[j + 1]),
    );
    this.EA = this.segMid.map((sm) => this.E_eff * this._area(Math.abs(sm)));

    // pre-strain to the discrete free-space rigid-rotation tension [Certain]
    const tReq = this._discreteStaticTensions();
    this.L0 = Array.from(
      { length: this.nSeg },
      (_, j) => this.h / (1.0 + tReq[j] / this.EA[j]),
    );
    this.k = Array.from(
      { length: this.nSeg },
      (_, j) => this.EA[j] / this.L0[j],
    );

    // initial state: radial tether, rigid rotation + circular orbit
    const vOrb = Math.sqrt(this.mu / this.Rcom);
    this.state = [];
    for (let i = 0; i < n; i++) {
      const xi = this.Rcom + this.s[i]; // lower tip (s=-L) Earthward
      this.state.push(xi, 0.0, 0.0, vOrb + this.omega * this.s[i]);
    }

    this.t = 0.0;
    this._dampC = new Array(this.nSeg).fill(0.0);
  }

  // ── construction helpers ──────────────────────────────────────────────

  /** Continuum cross-section A(|s|), m^2. [Certain] */
  _area(sAbs) {
    const L = this.L;
    return (
      this.A_L * Math.exp(this.xRatio ** 2 * (1.0 - (sAbs / L) ** 2))
    );
  }

  /** Exact integral of rho*A(s) ds over [a,b] within one arm, kg. [Certain] */
  _armMassBetween(a, b) {
    if (b <= a) return 0.0;
    const x = this.xRatio;
    const L = this.L;
    const coeff =
      this.cfg.rhoKgm3 *
      this.A_L *
      Math.exp(x * x) *
      ((L * Math.sqrt(Math.PI)) / (2.0 * x));
    return coeff * (erf((x * b) / L) - erf((x * a) / L));
  }

  /** Free-space rigid-rotation tension per segment (cumulative outboard
   * centripetal load), N. [Certain] */
  _discreteStaticTensions() {
    const t = new Array(this.nSeg).fill(0.0);
    // lower arm: segments 0..center-1, outboard nodes 0..j
    let acc = 0.0;
    for (let j = 0; j < this.center; j++) {
      acc += this.m[j] * this.omega ** 2 * Math.abs(this.s[j]);
      t[j] = acc;
    }
    // upper arm: segments center..nSeg-1, outboard nodes j+1..n-1
    acc = 0.0;
    for (let j = this.nSeg - 1; j >= this.center; j--) {
      acc += this.m[j + 1] * this.omega ** 2 * Math.abs(this.s[j + 1]);
      t[j] = acc;
    }
    return t;
  }

  /** Continuum uniform-stress tension T(s) = sigma_w*A(s), N. [Certain] */
  analyticTension(sAbsM) {
    return this.sigmaW * this._area(sAbsM);
  }

  orbitPeriodS() {
    return 2.0 * Math.PI * Math.sqrt(this.Rcom ** 3 / this.mu);
  }

  // ── dynamics ─────────────────────────────────────────────────────────

  _deriv(st) {
    const n = this.cfg.nNodes;
    const mu = this.mu;
    const grav = this.cfg.gravity;
    const out = new Array(4 * n).fill(0.0);
    const ax = new Array(n).fill(0.0);
    const ay = new Array(n).fill(0.0);
    // gravity (per-node point mass)
    for (let i = 0; i < n; i++) {
      const b = 4 * i;
      const xi = st[b];
      const yi = st[b + 1];
      out[b] = st[b + 2];
      out[b + 1] = st[b + 3];
      if (grav) {
        const r2 = xi * xi + yi * yi;
        const gf = -mu / (r2 * Math.sqrt(r2));
        ax[i] = gf * xi;
        ay[i] = gf * yi;
      }
    }
    // segments (slack-capable, optional axial damping)
    for (let j = 0; j < this.nSeg; j++) {
      const a4 = 4 * j;
      const b4 = 4 * (j + 1);
      const dx = st[b4] - st[a4];
      const dy = st[b4 + 1] - st[a4 + 1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ext = dist - this.L0[j];
      if (ext <= 0.0) continue; // slack cable: no force, damped or not
      let tension = this.k[j] * ext;
      if (this._dampC[j] !== 0.0) {
        const dvx = st[b4 + 2] - st[a4 + 2];
        const dvy = st[b4 + 3] - st[a4 + 3];
        const rate = (dvx * dx + dvy * dy) / dist;
        tension += this._dampC[j] * rate;
        if (tension < 0.0) tension = 0.0; // a cable cannot push
      }
      const fx = (tension * dx) / dist;
      const fy = (tension * dy) / dist;
      ax[j] += fx / this.m[j];
      ay[j] += fy / this.m[j];
      ax[j + 1] -= fx / this.m[j + 1];
      ay[j + 1] -= fy / this.m[j + 1];
    }
    for (let i = 0; i < n; i++) {
      out[4 * i + 2] = ax[i];
      out[4 * i + 3] = ay[i];
    }
    return out;
  }

  _rk4Step(dt) {
    const s0 = this.state;
    const n = s0.length;
    const k1 = this._deriv(s0);
    const s1 = new Array(n);
    for (let i = 0; i < n; i++) s1[i] = s0[i] + 0.5 * dt * k1[i];
    const k2 = this._deriv(s1);
    const s2 = new Array(n);
    for (let i = 0; i < n; i++) s2[i] = s0[i] + 0.5 * dt * k2[i];
    const k3 = this._deriv(s2);
    const s3 = new Array(n);
    for (let i = 0; i < n; i++) s3[i] = s0[i] + dt * k3[i];
    const k4 = this._deriv(s3);
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      next[i] =
        s0[i] + (dt / 6.0) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    this.state = next;
    this.t += dt;
  }

  /** Advance the simulation by exactly one fixed physics step. Public
   * wrapper so callers (twin.js, verify.mjs) never touch `_rk4Step`
   * directly across module boundaries — same role as Python's `run`. */
  step(dt) {
    this._rk4Step(dt);
  }

  run(durationS, dt, dampingRatio = 0.0) {
    if (dampingRatio) {
      const mRef = this.m.reduce((a, b) => a + b, 0) / this.m.length;
      this._dampC = Array.from({ length: this.nSeg }, (_, j) =>
        2.0 * dampingRatio * Math.sqrt(this.k[j] * mRef),
      );
    } else {
      this._dampC = new Array(this.nSeg).fill(0.0);
    }
    const steps = Math.round(durationS / dt);
    for (let i = 0; i < steps; i++) this._rk4Step(dt);
  }

  // ── measurements ─────────────────────────────────────────────────────

  com() {
    const M = this.m.reduce((a, b) => a + b, 0);
    let cx = 0;
    let cy = 0;
    let cvx = 0;
    let cvy = 0;
    for (let i = 0; i < this.m.length; i++) {
      const b = 4 * i;
      const mi = this.m[i];
      cx += mi * this.state[b];
      cy += mi * this.state[b + 1];
      cvx += mi * this.state[b + 2];
      cvy += mi * this.state[b + 3];
    }
    return [cx / M, cy / M, cvx / M, cvy / M];
  }

  _tipRel(node = 0) {
    const [cx, cy, cvx, cvy] = this.com();
    const b = 4 * node;
    return [
      this.state[b] - cx,
      this.state[b + 1] - cy,
      this.state[b + 2] - cvx,
      this.state[b + 3] - cvy,
    ];
  }

  tipSpeedRelCom(node = 0) {
    const [, , vx, vy] = this._tipRel(node);
    return Math.hypot(vx, vy);
  }

  /** |v_rel|^2 / |r_rel| — the EQ-3c centripetal measure, m/s^2. */
  tipCentripetalAccel(node = 0) {
    const [rx, ry, vx, vy] = this._tipRel(node);
    return (vx * vx + vy * vy) / Math.hypot(rx, ry);
  }

  segmentTension(j) {
    const a4 = 4 * j;
    const b4 = 4 * (j + 1);
    const dx = this.state[b4] - this.state[a4];
    const dy = this.state[b4 + 1] - this.state[a4 + 1];
    const ext = Math.hypot(dx, dy) - this.L0[j];
    return ext > 0.0 ? this.k[j] * ext : 0.0;
  }

  totalEnergy() {
    let e = 0.0;
    for (let i = 0; i < this.m.length; i++) {
      const b = 4 * i;
      const mi = this.m[i];
      e += 0.5 * mi * (this.state[b + 2] ** 2 + this.state[b + 3] ** 2);
      if (this.cfg.gravity) {
        e -= (this.mu * mi) / Math.hypot(this.state[b], this.state[b + 1]);
      }
    }
    for (let j = 0; j < this.nSeg; j++) {
      const a4 = 4 * j;
      const b4 = 4 * (j + 1);
      const ext =
        Math.hypot(
          this.state[b4] - this.state[a4],
          this.state[b4 + 1] - this.state[a4 + 1],
        ) - this.L0[j];
      if (ext > 0.0) e += 0.5 * this.k[j] * ext * ext;
    }
    return e;
  }

  angularMomentum() {
    let h = 0.0;
    for (let i = 0; i < this.m.length; i++) {
      const b = 4 * i;
      const mi = this.m[i];
      h +=
        mi *
        (this.state[b] * this.state[b + 3] -
          this.state[b + 1] * this.state[b + 2]);
    }
    return h;
  }
}

root.SkyhookTwin = { R_EARTH_KM: R_EARTH_KM, G_STD: G_STD, characteristicVelocityKms: characteristicVelocityKms, erf: erf, TetherConfig: TetherConfig, TetherSim: TetherSim };
})(typeof self !== 'undefined' ? self : this);
