/*
 * homeward.js — the return leg Aster does not plan yet: a body-to-Earth porkchop kernel.
 * Pure: no DOM, no clock, no randomness, no network. Loads as a classic script
 * (window.Homeward, so index.html works from file://) and with require() for node:test.
 *
 * Every physical constant is passed in (data.js carries them, parsed by build-data.mjs from
 * Aster's own source files); nothing in this file types μ, an obliquity or a radius.
 *
 * Frames and units
 *   Positions km, velocities km/s, times TDB Julian dates (days) or seconds where named.
 *   Catalog elements are heliocentric J2000 ECLIPTIC (the catalog says so per body,
 *   elementsFrame FRAME_HELIO_J2000_ECLIPTIC); keplerState() rotates them through the J2000
 *   obliquity once, into the heliocentric ICRF frame of the Horizons Earth records. The tests
 *   establish that frame by measurement (INV-021), not by these comments.
 *
 * Lambert
 *   A universal-variable solver for zero-revolution transfers, written from the textbook form
 *   (Bate, Mueller & White 1971, ch. 5; the same z/Stumpff formulation as Curtis, Algorithm 5.2),
 *   solved by bisection on z, which is safe because flight time is monotonic in z on the
 *   admissible interval. It is NOT Aster's izzo.ts and is not a port of it or of poliastro.
 *   Direction follows Aster's convention (izzo.ts / lambertMultiRev called with lw=true):
 *   "prograde" means the transfer's angular momentum has a non-negative z component in the
 *   input frame (ICRF z here).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Homeward = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TWO_PI = 2 * Math.PI;

  // ---------- small vector helpers ----------
  const norm = (v) => Math.hypot(v[0], v[1], v[2]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  // ---------- calendar (proleptic Gregorian, no time zones) ----------
  /** 'YYYY-MM-DD' at 00:00 on the date's own scale → Julian date. */
  function isoToJd(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 2440587.5;
  }
  /** Julian date → 'YYYY-MM-DD' (the calendar day containing it, on the same scale). */
  function jdToIso(jd) {
    if (!Number.isFinite(jd)) return 'invalid date';
    const ms = Math.floor((jd - 2440587.5) * 86400000 + 0.5);
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  // ---------- refusals (Aster's evidence-envelope shape: code, reason, what_would_help) ----------
  function refusal(code, reason, whatWouldHelp) {
    return Object.freeze({ code, reason, what_would_help: whatWouldHelp });
  }
  const DELIVERED_MASS_REFUSAL = refusal(
    'out_of_envelope',
    'Launch-vehicle payload curves describe Earth departure from a parking orbit; none applies to a departure from the body, so no delivered mass can be read off this leg.',
    'A return-vehicle mass model (dry mass, propellant load, specific impulse), or an Earth-capture envelope that says what arrival v-infinity a catcher or heat shield accepts (Aster kernel K2).'
  );

  // ---------- Stumpff functions (series near zero to avoid cancellation) ----------
  function stumpffC(z) {
    if (z > 1e-3) return (1 - Math.cos(Math.sqrt(z))) / z;
    if (z < -1e-3) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
    return 1 / 2 - z / 24 + (z * z) / 720 - (z * z * z) / 40320;
  }
  function stumpffS(z) {
    if (z > 1e-3) {
      const s = Math.sqrt(z);
      return (s - Math.sin(s)) / (s * s * s);
    }
    if (z < -1e-3) {
      const s = Math.sqrt(-z);
      return (Math.sinh(s) - s) / (s * s * s);
    }
    return 1 / 6 - z / 120 + (z * z) / 5040 - (z * z * z) / 362880;
  }

  /**
   * Zero-revolution Lambert problem, universal variables.
   * @returns {{ok:true, v1:number[], v2:number[], z:number, iterations:number}|{ok:false, reason:string}}
   */
  function lambert(r1, r2, tofSeconds, mu, prograde) {
    const pro = prograde !== false;
    const finite = [...r1, ...r2, tofSeconds, mu].every(Number.isFinite);
    if (!finite || !(tofSeconds > 0) || !(mu > 0)) return { ok: false, reason: 'invalid_input' };
    const R1 = norm(r1);
    const R2 = norm(r2);
    const cx = r1[1] * r2[2] - r1[2] * r2[1];
    const cy = r1[2] * r2[0] - r1[0] * r2[2];
    const cz = r1[0] * r2[1] - r1[1] * r2[0];
    if (R1 === 0 || R2 === 0 || Math.hypot(cx, cy, cz) <= 1e-12 * R1 * R2) {
      return { ok: false, reason: 'invalid_geometry' };
    }
    const cosd = Math.max(-1, Math.min(1, (r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]) / (R1 * R2)));
    let dth = Math.acos(cosd);
    if (pro ? cz < 0 : cz >= 0) dth = TWO_PI - dth;
    const A = Math.sin(dth) * Math.sqrt((R1 * R2) / (1 - cosd));
    if (!Number.isFinite(A) || A === 0) return { ok: false, reason: 'invalid_geometry' };
    const sqrtMu = Math.sqrt(mu);
    const yOf = (z) => R1 + R2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
    // Flight time for a given z; NaN where y < 0 (no real orbit), which lies at small z.
    const tOf = (z) => {
      const y = yOf(z);
      if (!(y >= 0)) return NaN;
      const C = stumpffC(z);
      return (Math.pow(y / C, 1.5) * stumpffS(z) + A * Math.sqrt(y)) / sqrtMu;
    };
    // dT/dz (Bate, Mueller & White's derivative of the universal time equation), for Newton
    // steps only: the bracket below decides convergence, so this need not be exact near z = 0.
    const dTdz = (z) => {
      const y = yOf(z);
      const C = stumpffC(z);
      const S = stumpffS(z);
      if (Math.abs(z) < 1e-6) {
        return ((Math.SQRT2 / 40) * Math.pow(y, 1.5) + (A / 8) * (Math.sqrt(y) + A * Math.sqrt(1 / (2 * y)))) / sqrtMu;
      }
      return (
        Math.pow(y / C, 1.5) * ((1 / (2 * z)) * (C - (1.5 * S) / C) + (0.75 * S * S) / C) +
        (A / 8) * ((3 * S * Math.sqrt(y)) / C + A * Math.sqrt(C / y))
      ) / sqrtMu;
    };
    let hi = 4 * Math.PI * Math.PI; // T → ∞ as z → 4π² (one full revolution)
    let lo = -4 * Math.PI * Math.PI;
    // Hyperbolic side: move the lower bracket down until it is below the requested time.
    let grow = 0;
    while (tOf(lo) > tofSeconds && grow < 60) {
      lo *= 2;
      grow += 1;
    }
    if (tOf(lo) > tofSeconds) return { ok: false, reason: 'no_convergence' };
    // Bracketed Newton: T(lo) < tof (or no orbit) and T(hi) >= tof always hold; a Newton step
    // that leaves the bracket, or a non-finite one, is replaced by bisection.
    let z = lo < 0 && hi > 0 ? 0 : 0.5 * (lo + hi);
    let iterations = 0;
    for (; iterations < 200; iterations += 1) {
      const t = tOf(z);
      if (!(t >= tofSeconds)) lo = z; // NaN (y < 0) counts as "too fast"
      else hi = z;
      if (Number.isFinite(t) && Math.abs(t - tofSeconds) <= 1e-14 * tofSeconds) break;
      if (hi - lo <= 4e-16 * Math.max(1, Math.abs(z))) break;
      let next = Number.isFinite(t) ? z - (t - tofSeconds) / dTdz(z) : NaN;
      if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
      z = next;
    }
    const y = yOf(z);
    if (!(y > 0)) return { ok: false, reason: 'no_convergence' };
    const f = 1 - y / R1;
    const g = A * Math.sqrt(y / mu);
    const gdot = 1 - y / R2;
    if (!Number.isFinite(g) || g === 0) return { ok: false, reason: 'no_convergence' };
    const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g, (r2[2] - f * r1[2]) / g];
    const v2 = [(gdot * r2[0] - r1[0]) / g, (gdot * r2[1] - r1[1]) / g, (gdot * r2[2] - r1[2]) / g];
    if (![...v1, ...v2].every(Number.isFinite)) return { ok: false, reason: 'no_convergence' };
    return { ok: true, v1, v2, z, iterations };
  }

  // ---------- two-body propagation of catalog elements ----------
  function solveKepler(M, e) {
    let E = e < 0.8 ? M : M >= 0 ? Math.PI : -Math.PI;
    for (let i = 0; i < 60; i += 1) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) <= 1e-14) return E;
    }
    return NaN;
  }
  /**
   * Heliocentric state of a catalog body at `jd` (TDB), ICRF, from its J2000-ecliptic elements.
   * consts: { muSunKm3S2, obliquityRad, secondsPerDay }
   */
  function keplerState(el, jd, consts) {
    if (!(el && el.aKm > 0 && el.e >= 0 && el.e < 1)) return null;
    const n = Math.sqrt(consts.muSunKm3S2 / (el.aKm * el.aKm * el.aKm));
    let M = el.maRad + n * (jd - el.epochTdbJd) * consts.secondsPerDay;
    M = ((M % TWO_PI) + TWO_PI) % TWO_PI;
    if (M > Math.PI) M -= TWO_PI;
    const e = el.e;
    const E = solveKepler(M, e);
    if (!Number.isFinite(E)) return null;
    const cE = Math.cos(E);
    const sE = Math.sin(E);
    const den = 1 - e * cE;
    const sq = Math.sqrt(1 - e * e);
    const px = el.aKm * (cE - e);
    const py = el.aKm * sq * sE;
    const vx = (-el.aKm * n * sE) / den;
    const vy = (el.aKm * n * sq * cE) / den;
    const cO = Math.cos(el.omRad), sO = Math.sin(el.omRad);
    const ci = Math.cos(el.iRad), si = Math.sin(el.iRad);
    const cw = Math.cos(el.wRad), sw = Math.sin(el.wRad);
    const q11 = cO * cw - sO * sw * ci, q12 = -cO * sw - sO * cw * ci;
    const q21 = sO * cw + cO * sw * ci, q22 = -sO * sw + cO * cw * ci;
    const q31 = sw * si, q32 = cw * si;
    const ce = Math.cos(consts.obliquityRad), se = Math.sin(consts.obliquityRad);
    const toIcrf = (x, y) => {
      const X = q11 * x + q12 * y;
      const Y = q21 * x + q22 * y;
      const Z = q31 * x + q32 * y;
      return [X, Y * ce - Z * se, Y * se + Z * ce];
    };
    return { r: toIcrf(px, py), v: toIcrf(vx, vy) };
  }

  // ---------- Earth from sampled Horizons records, cubic Hermite ----------
  /** records: [[jdTdb, x, y, z, vx, vy, vz], …] ascending. Returns an ephemeris object. */
  function makeEphemeris(records, secondsPerDay) {
    const n = records.length;
    if (n < 2) throw new RangeError('need at least two records');
    for (let i = 1; i < n; i += 1) {
      if (!(records[i][0] > records[i - 1][0])) throw new RangeError('records must be strictly ascending');
    }
    const startJd = records[0][0];
    const endJd = records[n - 1][0];
    function stateAt(jd) {
      if (!(jd >= startJd && jd <= endJd)) return null;
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (records[m][0] <= jd) lo = m;
        else hi = m;
      }
      const a = records[lo];
      const b = records[hi];
      const h = (b[0] - a[0]) * secondsPerDay;
      const u = ((jd - a[0]) * secondsPerDay) / h;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
      const r = [0, 0, 0];
      const v = [0, 0, 0];
      for (let i = 0; i < 3; i += 1) {
        const p0 = a[1 + i], v0 = a[4 + i], p1 = b[1 + i], v1 = b[4 + i];
        r[i] = h00 * p0 + h10 * v0 * h + h01 * p1 + h11 * v1 * h;
        v[i] = (d00 * p0 + d10 * v0 * h + d01 * p1 + d11 * v1 * h) / h;
      }
      return { r, v };
    }
    return { startJd, endJd, stateAt, count: n };
  }

  // ---------- derived readouts ----------
  /** Declination of an asymptote, degrees: asin(vz/|v|) on the vector as given (Aster's DLA convention). */
  function declinationDeg(v, epsilonKmS) {
    const m = norm(v);
    const eps = epsilonKmS === undefined ? 1e-3 : epsilonKmS;
    if (!Number.isFinite(m) || m < eps) return null;
    return (Math.asin(Math.max(-1, Math.min(1, v[2] / m))) * 180) / Math.PI;
  }
  /** Speed at radius r on the arrival hyperbola: vis-viva, √(v∞² + 2μ/r). */
  function speedAtRadius(vInfKmS, muKm3S2, radiusKm) {
    if (!(vInfKmS >= 0) || !(muKm3S2 > 0) || !(radiusKm > 0)) return NaN;
    return Math.sqrt(vInfKmS * vInfKmS + (2 * muKm3S2) / radiusKm);
  }
  /**
   * Propulsive capture into a circular orbit of radius r from an arrival v∞: the hyperbolic
   * periapsis speed minus the circular speed. Algebraically Aster's injectionDvFromC3(v∞², μ, r)
   * (src/v2/porkchop/delta-v.ts:18-26) run backwards; the tests check that identity.
   */
  function captureDvKmS(vInfKmS, muKm3S2, radiusKm) {
    return speedAtRadius(vInfKmS, muKm3S2, radiusKm) - Math.sqrt(muKm3S2 / radiusKm);
  }

  // ---------- fidelity tier and the support boundary, return-leg form ----------
  const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  function cadDate(cd) {
    const m = /^(\d{4})-([A-Za-z]{3})-(\d{2})\b/.exec(String(cd || '').trim());
    if (!m || !MONTHS[m[2].toUpperCase()]) return null;
    return `${m[1]}-${MONTHS[m[2].toUpperCase()]}-${m[3]}`;
  }
  /**
   * For an L1 body, the earliest material encounter (Slice 18 DEC-18-7). For the RETURN leg the
   * body's state is used at departure, so a cell is unsupported when it departs at or after the
   * encounter. (Aster's outbound rule, support-boundary.ts:49-50, keys on arrival instead.)
   */
  function supportBoundary(tier) {
    if (!tier || tier.tier !== 'L1' || !tier.encounter || !Number.isFinite(tier.encounter.jd)) return null;
    return {
      encounterJd: tier.encounter.jd,
      label: cadDate(tier.encounter.cd) || String(tier.encounter.cd),
      body: tier.encounter.body,
    };
  }
  function departsAfterEncounter(depJd, boundary) {
    return !!boundary && depJd >= boundary.encounterJd;
  }
  /** A body-level refusal (L0: the object does not exist or cannot be propagated), else null. */
  function bodyRefusal(body) {
    if (!body) return refusal('not_found', 'No such body in this deposit’s six-body excerpt.', 'Add the body to build-data.mjs’s pick list and rebuild the snapshots.');
    if (!body.tier) return refusal('insufficient_data', 'The body has no record in the committed tier artifact, so its screening fidelity is unknown.', 'A record for it in docs/tier-sizing-per-body.json.');
    if (body.tier.tier === 'L0') return refusal('out_of_envelope', 'Fidelity tier L0: the object no longer exists or cannot be propagated by two-body Kepler, so a return leg from it means nothing.', 'Nothing: an L0 body has no departure to plan.');
    if (!(body.elements && body.elements.e < 1 && body.elements.aKm > 0)) return refusal('out_of_envelope', 'The orbit is not an ellipse, so two-body Kepler propagation refuses it.', 'An integrated ephemeris for the body.');
    return null;
  }

  // ---------- the lattice and its label (DEC-19-2, DEC-17-5: derived, never literal) ----------
  function linspace(a, b, n) {
    if (n <= 1) return [a];
    const step = (b - a) / (n - 1);
    return Array.from({ length: n }, (_, i) => a + step * i);
  }
  function formatStepDays(days) {
    if (!Number.isFinite(days)) return String(days);
    return Number.isInteger(days) ? String(days) : days.toFixed(1);
  }
  /** Same wording as Aster's formatJdC3GridLabel (src/v2/boundary/c3-grid.ts:42-75). */
  function latticeLabel(p) {
    const dep = (p.depEndJd - p.depStartJd) / (p.nDep - 1);
    const tof = (p.tofMaxDays - p.tofMinDays) / (p.nTof - 1);
    return `${p.nDep}×${p.nTof} grid · ${formatStepDays(dep)} d × ${formatStepDays(tof)} d steps`;
  }
  /**
   * Lattice derived from the Earth ephemeris span: departures from the span's first record to
   * (last record − shortest flight), so every column has at least one cell whose arrival falls
   * inside the span.
   */
  function defaultLattice(earth, shape) {
    return {
      depStartJd: earth.startJd,
      depEndJd: earth.endJd - shape.tofMinDays,
      tofMinDays: shape.tofMinDays,
      tofMaxDays: shape.tofMaxDays,
      nDep: shape.nDep,
      nTof: shape.nTof,
    };
  }

  // ---------- one return leg ----------
  const STATUS = Object.freeze({ OK: 1, NO_SOLUTION: 2, NO_EARTH: 3, NO_BODY: 4 });
  /**
   * Body → Earth, departing the body at depJd, arriving at Earth tofDays later.
   * consts: { muSunKm3S2, obliquityRad, secondsPerDay, muEarthKm3S2, entryRadiusKm, parkingRadiusKm }
   */
  function returnLeg(body, earth, depJd, tofDays, consts) {
    const arrJd = depJd + tofDays;
    const base = { depJd, tofDays, arrJd, deliveredMass: { refusal: DELIVERED_MASS_REFUSAL } };
    const e2 = earth.stateAt(arrJd);
    if (!e2) {
      return Object.assign(base, {
        status: STATUS.NO_EARTH,
        refusal: refusal('insufficient_data', `Earth arrival ${jdToIso(arrJd)} is outside the Earth ephemeris this page carries (${jdToIso(earth.startJd)} to ${jdToIso(earth.endJd)}).`, 'Earth ephemeris past the span (Aster kernel H0, horizon extension).'),
      });
    }
    const b1 = keplerState(body.elements, depJd, consts);
    if (!b1) {
      return Object.assign(base, { status: STATUS.NO_BODY, refusal: refusal('out_of_envelope', 'Two-body propagation failed for this body.', 'An integrated ephemeris for the body.') });
    }
    const sol = lambert(b1.r, e2.r, tofDays * consts.secondsPerDay, consts.muSunKm3S2, true);
    if (!sol.ok) return Object.assign(base, { status: STATUS.NO_SOLUTION, reason: sol.reason });
    const vInfDepVec = sub(sol.v1, b1.v);
    const vInfArrVec = sub(sol.v2, e2.v);
    const vInfArr = norm(vInfArrVec);
    return Object.assign(base, {
      status: STATUS.OK,
      vInfDep: norm(vInfDepVec),
      vInfArr,
      vInfDepVec,
      vInfArrVec,
      decArrDeg: declinationDeg(vInfArrVec),
      entrySpeed: speedAtRadius(vInfArr, consts.muEarthKm3S2, consts.entryRadiusKm),
      captureDv: captureDvKmS(vInfArr, consts.muEarthKm3S2, consts.parkingRadiusKm),
    });
  }
  /** Earth → body (the outbound leg), used only to cross-check the pipeline against NHATS's C3. */
  function outboundLeg(body, earth, launchJd, tofDays, consts) {
    const e1 = earth.stateAt(launchJd);
    if (!e1) return null;
    const b2 = keplerState(body.elements, launchJd + tofDays, consts);
    const sol = lambert(e1.r, b2.r, tofDays * consts.secondsPerDay, consts.muSunKm3S2, true);
    if (!sol.ok) return null;
    const vd = norm(sub(sol.v1, e1.v));
    return { c3: vd * vd, vInfDep: vd, vInfArr: norm(sub(sol.v2, b2.v)), decDepDeg: declinationDeg(sub(sol.v1, e1.v)) };
  }

  // ---------- the grid ----------
  /**
   * Computes every cell. Storage is column-major by departure: index = iDep * nTof + iTof.
   * Returns typed arrays plus summaries; cellAt() rebuilds one cell's full record.
   */
  function computeGrid(body, earth, lattice, consts) {
    const deps = linspace(lattice.depStartJd, lattice.depEndJd, lattice.nDep);
    const tofs = linspace(lattice.tofMinDays, lattice.tofMaxDays, lattice.nTof);
    const N = deps.length * tofs.length;
    const status = new Uint8Array(N);
    const vInfDep = new Float64Array(N).fill(NaN);
    const vInfArr = new Float64Array(N).fill(NaN);
    const decArr = new Float64Array(N).fill(NaN);
    const boundary = supportBoundary(body.tier);
    const counts = { cells: N, ok: 0, noSolution: 0, noEarth: 0, noBody: 0, unsupported: 0 };
    let bestDep = null;
    let bestArr = null;
    let bestDepAll = null;
    let bestArrAll = null;
    for (let i = 0; i < deps.length; i += 1) {
      const depJd = deps[i];
      const b1 = keplerState(body.elements, depJd, consts);
      const after = departsAfterEncounter(depJd, boundary);
      for (let j = 0; j < tofs.length; j += 1) {
        const k = i * tofs.length + j;
        const arrJd = depJd + tofs[j];
        const e2 = earth.stateAt(arrJd);
        if (!e2) {
          status[k] = STATUS.NO_EARTH;
          counts.noEarth += 1;
          continue;
        }
        if (!b1) {
          status[k] = STATUS.NO_BODY;
          counts.noBody += 1;
          continue;
        }
        const sol = lambert(b1.r, e2.r, tofs[j] * consts.secondsPerDay, consts.muSunKm3S2, true);
        if (!sol.ok) {
          status[k] = STATUS.NO_SOLUTION;
          counts.noSolution += 1;
          continue;
        }
        status[k] = STATUS.OK;
        counts.ok += 1;
        const vd = norm(sub(sol.v1, b1.v));
        const vaVec = sub(sol.v2, e2.v);
        const va = norm(vaVec);
        vInfDep[k] = vd;
        vInfArr[k] = va;
        const dec = declinationDeg(vaVec);
        decArr[k] = dec === null ? NaN : dec;
        if (after) counts.unsupported += 1;
        if (!bestDepAll || vd < vInfDep[bestDepAll.k]) bestDepAll = { k, i, j };
        if (!bestArrAll || va < vInfArr[bestArrAll.k]) bestArrAll = { k, i, j };
        if (!after) {
          if (!bestDep || vd < vInfDep[bestDep.k]) bestDep = { k, i, j };
          if (!bestArr || va < vInfArr[bestArr.k]) bestArr = { k, i, j };
        }
      }
    }
    return {
      lattice,
      label: latticeLabel(lattice),
      deps,
      tofs,
      status,
      vInfDep,
      vInfArr,
      decArr,
      counts,
      boundary,
      minima: { vInfDep: bestDep, vInfArr: bestArr, vInfDepAll: bestDepAll, vInfArrAll: bestArrAll },
    };
  }
  /**
   * Which edges of what was searched a sampled minimum sits on. A minimum on an edge is only the
   * lowest inside the lattice; the true one may lie past it.
   */
  function edgesOf(grid, m) {
    if (!m) return [];
    const nD = grid.deps.length;
    const nT = grid.tofs.length;
    const out = [];
    if (m.i === 0) out.push('first departure date');
    if (m.i === nD - 1) out.push('last departure date');
    if (m.j === 0) out.push('shortest flight time');
    if (m.j === nT - 1) out.push('longest flight time');
    if (m.j < nT - 1 && grid.status[m.i * nT + m.j + 1] === STATUS.NO_EARTH) out.push('longest flight inside the Earth ephemeris');
    const b = grid.boundary;
    if (b && grid.deps[m.i] < b.encounterJd && m.i < nD - 1 && grid.deps[m.i + 1] >= b.encounterJd) out.push('last departure before the L1 encounter');
    return out;
  }

  /** Full record for cell (i, j): recomputed through returnLeg() so the readout and the grid share one path. */
  function cellAt(grid, body, earth, i, j, consts) {
    const leg = returnLeg(body, earth, grid.deps[i], grid.tofs[j], consts);
    leg.i = i;
    leg.j = j;
    leg.supported = !departsAfterEncounter(grid.deps[i], grid.boundary);
    return leg;
  }

  // ---------- JPL NHATS min-ΔV round trip: the return leg inside it ----------
  /** NEO departure = launch + dur_out + dur_at; flight = dur_ret (days). Dates read as TDB midnight. */
  function nhatsReturnDates(traj) {
    const launchJd = isoToJd(traj.launch);
    const depJd = launchJd + Number(traj.dur_out) + Number(traj.dur_at);
    const tofDays = Number(traj.dur_ret);
    return { launchJd, depJd, tofDays, arrJd: depJd + tofDays };
  }

  // ---------- colour: Aster's log-viridis over a C3-like energy (src/v2/porkchop/colormap.ts) ----------
  function viridisRgb(energyKm2S2, scale) {
    if (!Number.isFinite(energyKm2S2)) return scale.noSolutionRgb.slice();
    const e = Math.max(energyKm2S2, scale.min);
    let t = (Math.log(e) - Math.log(scale.min)) / (Math.log(scale.max) - Math.log(scale.min));
    t = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const stops = scale.stops;
    for (let k = 1; k < stops.length; k += 1) {
      if (t > stops[k].t) continue;
      const a = stops[k - 1];
      const b = stops[k];
      const lt = (t - a.t) / (b.t - a.t);
      return [0, 1, 2].map((c) => Math.round(a.rgb[c] + (b.rgb[c] - a.rgb[c]) * lt));
    }
    return stops[stops.length - 1].rgb.slice();
  }

  return {
    TWO_PI,
    STATUS,
    DELIVERED_MASS_REFUSAL,
    isoToJd,
    jdToIso,
    refusal,
    stumpffC,
    stumpffS,
    lambert,
    solveKepler,
    keplerState,
    makeEphemeris,
    declinationDeg,
    speedAtRadius,
    captureDvKmS,
    cadDate,
    supportBoundary,
    departsAfterEncounter,
    bodyRefusal,
    linspace,
    formatStepDays,
    latticeLabel,
    defaultLattice,
    returnLeg,
    outboundLeg,
    computeGrid,
    edgesOf,
    cellAt,
    nhatsReturnDates,
    viridisRgb,
  };
});
