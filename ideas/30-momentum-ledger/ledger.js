/*
 * ledger.js — the Momentum Ledger kernel. Pure: no DOM, no clock, no randomness, no constants of its own.
 * Every physical number comes in through the arguments (the page and the tests pass the snapshot of
 * Skyhook's params/rev_a.json and the values build_data.py parsed from cited source lines).
 *
 * Units inside: SI (m, m/s, kg, J, W, s). Inputs from rev_a.json are converted at the boundary.
 *
 * What it computes, for one catch-and-throw of a payload by a rotating tether whose centre of mass (CoM)
 * moves at vCom on radius R, with half-length L and tip speed vTip relative to the CoM:
 *   - energy: the payload's specific orbital energy gain from the canon catch state (R - L, vCom - vTip)
 *     to the canon release state (R + L, vCom + vTip). With nothing dissipated, the tether system loses
 *     exactly this; it is what reboost has to put back.                                      [Certain]
 *   - recovery: time to put it back at installed power P, efficiency eta and duty d: E / (P eta d), the
 *     same arithmetic as finance/reboost_bound.py:146-147; and the power the founding document's sizing
 *     rule (docs/project_instructions.md:145) asks for.                                       [Certain arithmetic]
 *   - ledger: what the throw does to the tether's own orbit, by conservation. The tether system (hub +
 *     fibre, mass M) loses m * dE in orbital energy (its spin assumed to end where it started), and its
 *     CoM ends 2mL/(M+m) lower at the throw point (the rigid flip of the loaded tether about the
 *     combined CoM). From those two facts: the new semi-major axis, the throw point as an apside, and the
 *     opposite apside half an orbit later, where the lower tip comes lowest.                  [Likely]
 *   - the proposal's impulsive model (two co-located impulses, m vTip/(M+m) + m vTip/M), kept only to
 *     show what it misses.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MomentumLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_S = 86400; // seconds per day: a unit definition, not a parameter

  function refusal(code, reason, whatWouldHelp) {
    return { refused: true, code: code, reason: reason, what_would_help: whatWouldHelp };
  }
  function isRefusal(x) {
    return !!(x && x.refused === true);
  }
  function finitePositive(x) {
    return typeof x === 'number' && isFinite(x) && x > 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Reading the canon. Tier keys and the fibre-mass key for each (tier, derate) pair the canon prints.
  // Nothing here is a number: these are paths into rev_a.json.
  var TIERS = {
    reference: {
      label: '2.5 km/s reference',
      role: 'GTO / high-elliptical; the near-term build',
      vTipPath: 'kinematics.v_tip_kms',
      fibre: {
        '0': 'mass_ratio.integrated_tether_to_payload_both_arms.optimistic_0pct_fiber_mass_t',
        '0.15': 'mass_ratio.integrated_tether_to_payload_both_arms.baseline_15pct_fiber_mass_t',
        '0.3': 'mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_fiber_mass_t'
      }
    },
    cislunar: {
      label: '2.8 km/s cislunar option',
      role: 'TLI / lunar-apogee class; revenue-gated',
      vTipPath: 'kinematics.cislunar_revenue_gated_option.v_tip_kms',
      fibre: { '0.3': 'mass_ratio.integrated_tether_to_payload_both_arms.cislunar_2p8kms_30pct_fiber_mass_t' }
    },
    phase3: {
      label: '3.5 km/s Phase 3 option',
      role: 'Mars-class escape; not near-term',
      vTipPath: 'kinematics.phase3_growth_option.v_tip_kms',
      fibre: { '0.3': 'mass_ratio.integrated_tether_to_payload_both_arms.phase3_3p5kms_30pct_fiber_mass_t' }
    }
  };
  var DERATES = ['0', '0.15', '0.3'];

  function get(obj, dotted) {
    return dotted.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  /**
   * Assemble one tether system from the canon.
   * opts: { tier, derate ('0'|'0.15'|'0.3'), hubKg, payloadKg (default: the canon design payload),
   *         earthRadiusKm (the caller passes physics/skyhook_physics.py:40's value),
   *         release ('canon', the default: the payload leaves in the state rev_a.json promises; or 'loaded':
   *         where the loaded tether at the canon spin rate actually lets go, see tipStates) }
   */
  function system(revA, opts) {
    opts = opts || {};
    var tier = TIERS[opts.tier || 'reference'];
    if (!tier) return refusal('invalid_input', 'unknown tier "' + opts.tier + '"', 'one of ' + Object.keys(TIERS).join(', '));
    var derate = String(opts.derate == null ? '0.3' : opts.derate);
    var fibrePath = tier.fibre[derate];
    if (!fibrePath) {
      return refusal('insufficient_data',
        'params/rev_a.json prints no fibre mass for the ' + tier.label + ' at ' + Math.round(Number(derate) * 100) + '% derate (it prints the ' +
        tier.label + ' only at ' + Object.keys(tier.fibre).map(function (d) { return Math.round(Number(d) * 100) + '%'; }).join(', ') + ')',
        'a canon fibre-mass key for this tier and derate in params/rev_a.json (EQ-6 would give one, but this page shows only what the canon prints)');
    }
    var fibreT = get(revA, fibrePath);
    var vTipKms = get(revA, tier.vTipPath);
    var muRaw = get(revA, 'orbital.mu_earth_m3s2');
    var altKm = get(revA, 'orbital.com_altitude_km');
    var LKm = get(revA, 'geometry.tether_half_length_km');
    var designKg = get(revA, 'mass_ratio.integrated_tether_to_payload_both_arms.payload_mass_kg_for_tonnage');
    if (![fibreT, vTipKms, muRaw, altKm, LKm, designKg].every(finitePositive)) {
      return refusal('insufficient_data', 'a canon value this ledger needs is missing from params/rev_a.json', 'restore the key named in ledger.js TIERS');
    }
    var RE = opts.earthRadiusKm;
    if (!finitePositive(RE)) return refusal('insufficient_data', 'no Earth radius given', 'pass physics/skyhook_physics.py:40 R_EARTH_KM');
    var hubKg = opts.hubKg;
    if (typeof hubKg !== 'number' || !isFinite(hubKg) || hubKg < 0) {
      return refusal('invalid_input', 'hub mass must be a number of kilograms, zero or more', 'a hub mass budget; tether_dynamics.py uses a [Speculative] 200 t');
    }
    var m = opts.payloadKg == null ? designKg : opts.payloadKg;
    if (!finitePositive(m)) return refusal('invalid_input', 'payload mass must be more than zero', 'a payload mass in kilograms');
    if (m > designKg) {
      return refusal('out_of_envelope',
        'the canon sizes every tier for a ' + designKg + ' kg payload at SF ' + get(revA, 'materials.safety_factor') + '; ' + m + ' kg would overload it',
        'a tether sized for this payload (fibre mass scales with the design payload)');
    }
    var release = opts.release == null ? 'canon' : opts.release;
    if (release !== 'canon' && release !== 'loaded') return refusal('invalid_input', 'release must be "canon" or "loaded"', 'choose the release model');
    var mu = muRaw;
    var R = (RE + altKm) * 1e3;
    var L = LKm * 1e3;
    if (!(L < R - RE * 1e3)) return refusal('out_of_envelope', 'the lower tip would be below the surface', 'a shorter tether or a higher orbit');
    return {
      tier: opts.tier || 'reference',
      tierLabel: tier.label,
      derate: derate,
      mu: mu,
      RE: RE * 1e3,
      R: R,
      L: L,
      vCom: Math.sqrt(mu / R), // EQ-2, physics/skyhook_physics.py v_orbital_kms
      vTip: vTipKms * 1e3,
      m: m,
      designPayloadKg: designKg,
      fibreKg: fibreT * 1e3,
      hubKg: hubKg,
      M: fibreT * 1e3 + hubKg,
      fibrePath: fibrePath,
      vTipPath: tier.vTipPath,
      release: release
    };
  }

  function specificEnergy(mu, r, v) {
    return v * v / 2 - mu / r;
  }

  /**
   * Tip states for a CoM at radius r moving horizontally at v. The catch is the canon state. The release is
   * the canon state when f = 1 (what rev_a.json promises: v + vTip at r + L). With f = (M - m)/(M + m) it is
   * where a rigid tether of mass M still spinning at the canon rate actually lets go: the loaded tether turns
   * about the combined CoM, which sits mL/(M + m) below its own, so the payload leaves L f above the old CoM
   * moving vTip f faster than it.
   */
  function tipStates(mu, r, v, L, vTip, f) {
    if (f == null) f = 1;
    return {
      catch: { r: r - L, v: v - vTip, eps: specificEnergy(mu, r - L, v - vTip) },
      release: { r: r + L * f, v: v + vTip * f, eps: specificEnergy(mu, r + L * f, v + vTip * f) }
    };
  }
  function releaseFactor(sys) {
    return sys.release === 'loaded' ? (sys.M - sys.m) / (sys.M + sys.m) : 1;
  }

  /** Energy one throw takes out of the tether system, per kg and for the payload. */
  function energy(sys) {
    if (isRefusal(sys)) return sys;
    var mu = sys.mu, R = sys.R, L = sys.L, v = sys.vCom, vt = sys.vTip;
    var f = releaseFactor(sys);
    var s = tipStates(mu, R, v, L, vt, f);
    var perKg = s.release.eps - s.catch.eps;
    var kinetic = 2 * v * vt; // = ((v+vt)^2 - (v-vt)^2)/2 exactly: finance/skyhook_finance.py:215's "momentum view"
    var potential = mu / (R - L) - mu / (R + L);
    var c3 = 2 * s.release.eps;
    var apogeeAltKm = Infinity;
    if (s.release.eps < 0) {
      var a = -mu / (2 * s.release.eps);
      apogeeAltKm = (2 * a - s.release.r) / 1e3 - sys.RE / 1e3; // release is the perigee: speed above circular there
    }
    return {
      states: s,
      perKg: perKg,
      kinetic: kinetic,
      potential: potential,
      perThrow: perKg * sys.m,
      kWhPerKg: perKg / 3.6e6,
      c3: c3,
      apogeeAltKm: apogeeAltKm,
      angularMomentumPerKg: s.release.r * s.release.v - s.catch.r * s.catch.v,
      releaseFactor: f
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Putting it back.
  function checkPED(P, eta, duty) {
    if (!finitePositive(P)) return refusal('invalid_input', 'installed power must be more than zero', 'an installed power in watts');
    if (!finitePositive(eta) || eta > 1) return refusal('invalid_input', 'efficiency must be in (0, 1]', 'an electrical-to-orbital-energy efficiency');
    if (!finitePositive(duty) || duty > 1) return refusal('invalid_input', 'duty must be in (0, 1]', 'the usable-thrust fraction of each orbit');
    return null;
  }

  /** Seconds to restore energy E at installed power P (W), efficiency eta, duty d: reboost_bound.py:146-147. */
  function recoverySeconds(E, P, eta, duty) {
    var bad = checkPED(P, eta, duty);
    if (bad) return bad;
    return E / (P * eta * duty);
  }

  /** Installed power that restores E within intervalS with a fractional margin (0.3 for 30 %). */
  function requiredPower(E, eta, duty, intervalS, margin) {
    var bad = checkPED(1, eta, duty);
    if (bad) return bad;
    if (!finitePositive(intervalS)) return refusal('invalid_input', 'interval must be more than zero', 'an inter-catch interval');
    return (1 + (margin || 0)) * E / (eta * duty * intervalS);
  }

  /**
   * reboost_bound.py's grid shape for this tier: every (eta, duty, P), with a support label against two
   * intervals o.intervalsS = [shorter, longer] at margin o.margin: 'both' when (1 + margin) t_rec fits the
   * shorter, '<longer> d only' when it fits only the longer, else 'neither' (reboost_bound.py:150-157).
   */
  function grid(E, o) {
    var rows = [];
    var lo = o.intervalsS[0], hi = o.intervalsS[1], k = 1 + (o.margin || 0);
    o.etas.forEach(function (eta) {
      o.duties.forEach(function (duty) {
        o.powersW.forEach(function (P) {
          var t = recoverySeconds(E, P, eta, duty);
          var support = k * t <= lo ? 'both' : k * t <= hi ? +(hi / DAY_S).toFixed(1) + ' d only' : 'neither';
          rows.push({ eta: eta, duty: duty, P: P, tRecS: t, tRecDays: t / DAY_S, support: support });
        });
      });
    });
    return rows;
  }

  // ---------------------------------------------------------------------------------------------
  // The ledger: what a throw does to the tether's own orbit.

  /**
   * One catch-and-throw with the CoM at an apside of its orbit (radius r, horizontal speed v).
   * Returns the tether's orbit afterwards, or a refusal if it no longer has one.
   */
  function throwAt(sys, r, v) {
    var mu = sys.mu, L = sys.L, vt = sys.vTip, m = sys.m, M = sys.M;
    if (!finitePositive(M)) return refusal('invalid_input', 'tether system mass must be more than zero', 'hub and fibre masses');
    var s = tipStates(mu, r, v, L, vt, releaseFactor(sys));
    var dEp = s.release.eps - s.catch.eps;                       // J/kg the payload gains
    var dHp = s.release.r * s.release.v - s.catch.r * s.catch.v; // m^2/s the payload gains about Earth's centre
    var eps0 = specificEnergy(mu, r, v);
    var dEps = (m / M) * dEp;                                    // J per kg of tether lost
    var eps1 = eps0 - dEps;
    var dr = 2 * m * L / (M + m);                                // CoM drop from the loaded flip
    var r1 = r - dr;
    var v1sq = 2 * (eps1 + mu / r1);
    if (!(eps1 < 0) || !(v1sq > 0)) {
      return refusal('out_of_envelope', 'after this throw the tether has no bound orbit through the throw point',
        'a heavier tether system (hub) or a lighter payload');
    }
    var v1 = Math.sqrt(v1sq);
    var a1 = -mu / (2 * eps1);
    var other = 2 * a1 - r1;
    var rp = Math.min(r1, other), ra = Math.max(r1, other);
    var h1 = r1 * v1, hCons = r * v - (m / M) * dHp;
    return {
      r0: r, v0: v, a0: -mu / (2 * eps0),
      r1: r1, v1: v1, a1: a1, rp: rp, ra: ra, e: (ra - rp) / (ra + rp),
      throwPointIs: r1 >= other ? 'apogee' : 'perigee',
      dEpPerKg: dEp, dHpPerKg: dHp, dEpsTether: dEps, dr: dr,
      dvEquiv: dEps / v,                                         // first-order tangential dv that would put dEps back
      hResidual: (h1 - hCons) / hCons                            // angular-momentum bookkeeping, a consistency check
    };
  }

  /** One throw from the canon circular orbit. */
  function ledger(sys) {
    if (isRefusal(sys)) return sys;
    var t = throwAt(sys, sys.R, sys.vCom);
    if (isRefusal(t)) return t;
    var tipAlt0 = sys.R - sys.L - sys.RE;
    return {
      throw: t,
      M: sys.M,
      massRatio: sys.M / sys.m,
      da: sys.R - t.a1,
      perigeeDrop: sys.R - t.rp,
      apogeeDrop: sys.R - t.ra,
      dvEquiv: t.dvEquiv,
      tipAltBefore: tipAlt0,
      tipLowestAfter: t.rp - sys.L - sys.RE,
      halfOrbitS: Math.PI * Math.sqrt(Math.pow(t.a1, 3) / sys.mu),
      impulsive: impulsive(sys)
    };
  }

  /** The proposal's model: two tangential impulses at one point, perigee drop = 2 da. Kept for comparison. */
  function impulsive(sys) {
    var m = sys.m, M = sys.M, vt = sys.vTip;
    var dv = m * vt / (M + m) + m * vt / M;
    var da = 2 * sys.R * dv / sys.vCom;
    return { dv: dv, da: da, perigeeDrop: 2 * da, tipLowestAfter: sys.R - 2 * da - sys.L - sys.RE };
  }

  /**
   * Throws with no reboost in between, each at the chosen apside ('apogee' or 'perigee'), until the
   * next one would take the lower tip below floorAltM at the following perigee. From a circular start
   * the first throw is the same either way.
   */
  function catchesToFloor(sys, floorAltM, phasing, maxN) {
    if (isRefusal(sys)) return sys;
    maxN = maxN || 500;
    if (phasing !== 'apogee' && phasing !== 'perigee') return refusal('invalid_input', 'phasing must be "apogee" or "perigee"', 'choose where in the orbit each catch happens');
    if (typeof floorAltM !== 'number' || !isFinite(floorAltM)) return refusal('invalid_input', 'no floor given', 'a lower-tip altitude floor in metres');
    var tip0 = sys.R - sys.L - sys.RE;
    if (floorAltM >= tip0) {
      return refusal('out_of_envelope',
        'every throw lowers the tether, so a floor at or above the design tip altitude (' + (tip0 / 1e3).toFixed(0) + ' km) allows none',
        'a floor below the design lower-tip altitude');
    }
    var a = sys.R, rp = sys.R, ra = sys.R, n = 0, trail = [], stop = 'maxN', next = null;
    while (n < maxN) {
      var r = phasing === 'perigee' ? rp : ra;
      var v = Math.sqrt(sys.mu * (2 / r - 1 / a));
      var t = throwAt(sys, r, v);
      if (isRefusal(t)) { stop = 'orbit'; next = t; break; }
      var tip = t.rp - sys.L - sys.RE;
      if (tip < floorAltM) { stop = 'floor'; next = { tipLowest: tip, a: t.a1, rp: t.rp, ra: t.ra }; break; }
      n++;
      a = t.a1; rp = t.rp; ra = t.ra;
      trail.push({ n: n, a: a, rp: rp, ra: ra, tipLowest: tip });
    }
    return { count: n, stop: stop, trail: trail, next: next };
  }

  /**
   * The lowest lower-tip altitude after each of n throws with no reboost, each at the chosen apside.
   * Entry 0 is the canon circular orbit. Stops before a throw that would leave the tether without an orbit
   * or take the lower tip's lowest point below the surface (the model means nothing there).
   */
  function throwSequence(sys, phasing, n) {
    if (isRefusal(sys)) return sys;
    var a = sys.R, rp = sys.R, ra = sys.R;
    var out = [{ n: 0, a: a, rp: rp, ra: ra, tipLowest: sys.R - sys.L - sys.RE }];
    for (var i = 1; i <= n; i++) {
      var r = phasing === 'perigee' ? rp : ra;
      var t = throwAt(sys, r, Math.sqrt(sys.mu * (2 / r - 1 / a)));
      if (isRefusal(t) || t.rp - sys.L - sys.RE < 0) break;
      a = t.a1; rp = t.rp; ra = t.ra;
      out.push({ n: i, a: a, rp: rp, ra: ra, tipLowest: rp - sys.L - sys.RE });
    }
    return out;
  }

  /** Smallest hub mass (kg) for which one throw from the canon orbit keeps the lower tip at or above floorAltM. */
  function minHubForFloor(revA, opts, floorAltM) {
    var base = system(revA, Object.assign({}, opts, { hubKg: 0 }));
    if (isRefusal(base)) return base;
    var tip0 = base.R - base.L - base.RE;
    if (!(floorAltM < tip0)) {
      return refusal('out_of_envelope', 'no hub is heavy enough: every throw lowers the tip below its design altitude (' + (tip0 / 1e3).toFixed(0) + ' km)',
        'a floor below the design lower-tip altitude');
    }
    function tipAfter(hubKg) {
      var s = system(revA, Object.assign({}, opts, { hubKg: hubKg }));
      var l = ledger(s);
      return isRefusal(l) ? -Infinity : l.tipLowestAfter;
    }
    if (tipAfter(0) >= floorAltM) return 0;
    var lo = 0, hi = 1e6;
    while (tipAfter(hi) < floorAltM) { lo = hi; hi *= 2; if (hi > 1e13) return refusal('out_of_envelope', 'no finite hub reaches this floor', 'a lower floor'); }
    for (var i = 0; i < 200 && hi - lo > 1; i++) {
      var mid = (lo + hi) / 2;
      if (tipAfter(mid) >= floorAltM) hi = mid; else lo = mid;
    }
    return hi;
  }

  // ---------------------------------------------------------------------------------------------
  // Cross-checks against finance/reboost_bound.py and its DRAFT in-space fork config.

  /**
   * The same energy kernel applied to params/service_mxer_draft.json: CoM at its perigee
   * (R_E + perigee altitude, moving at the draft's v_perigee), half-length and tip speed from the draft.
   */
  function mxerSystem(draft, earthRadiusKm, mu) {
    var o = draft.tether_com_orbit, t = draft.tether;
    var R = (earthRadiusKm + o.perigee_altitude_km) * 1e3;
    var vCom = o.v_perigee_kms * 1e3;
    var fibreKg = draft.payload_class.fiber_mass_t_at_30pct_derate * 1e3;
    var hubKg = draft.capex_inputs.hub_mass_t * 1e3;
    return {
      tier: 'mxer-draft', tierLabel: 'in-space fork (DRAFT)', mu: mu, RE: earthRadiusKm * 1e3, R: R, L: t.L_half_km * 1e3,
      vCom: vCom, vTip: t.v_tip_kms * 1e3, m: draft.payload_class.reference_payload_t * 1e3,
      fibreKg: fibreKg, hubKg: hubKg, M: fibreKg + hubKg, release: 'canon',
      a: o.semi_major_axis_km * 1e3
    };
  }

  /** reboost_bound.py:111-125's own route: circular catch orbit in, GEO-transfer ellipse out. */
  function reboostBoundEnergy(draft, earthRadiusKm, mu, rGeoKm) {
    var rP = earthRadiusKm + draft.tether_com_orbit.perigee_altitude_km;
    var rCatch = rP - draft.tether.L_half_km, rRelease = rP + draft.tether.L_half_km;
    var aTransfer = 0.5 * (rRelease + rGeoKm);
    var eIn = -mu / (2 * rCatch * 1e3), eOut = -mu / (2 * aTransfer * 1e3);
    return draft.payload_class.reference_payload_t * 1e3 * (eOut - eIn);
  }

  /** The draft tether's own ledger: one throw at its CoM perigee (where the draft catches). */
  function mxerLedger(sysX) {
    var mu = sysX.mu, r = sysX.R;
    var v = Math.sqrt(mu * (2 / r - 1 / sysX.a));
    var t = throwAt(sysX, r, v);
    if (isRefusal(t)) return t;
    var ra0 = 2 * sysX.a - r;
    return { vAtPerigee: v, throw: t, da: sysX.a - t.a1, apogeeDrop: ra0 - t.ra, perigeeDrop: r - t.rp, massRatio: sysX.M / sysX.m };
  }

  /** Price per kg is refused: the canon has no electricity price. */
  function pricePerKg(revA) {
    var econ = (revA && revA.economics) || {};
    var keys = Object.keys(econ).filter(function (k) { return k.charAt(0) !== '_'; });
    var hasPrice = keys.some(function (k) { return /kwh|electric/i.test(k); });
    if (hasPrice) return refusal('out_of_envelope', 'an electricity price exists in the canon but this page has not been taught to read it', 'extend ledger.js');
    return refusal('insufficient_data',
      'params/rev_a.json has no electricity price: its economics block holds only ' + keys.join(', '),
      'an electricity $/kWh key with a confidence label in params/rev_a.json (the workbook Assumptions row 7 and MP-001 section 1 carry candidates, neither canon)');
  }

  return {
    DAY_S: DAY_S,
    TIERS: TIERS,
    DERATES: DERATES,
    refusal: refusal,
    isRefusal: isRefusal,
    get: get,
    system: system,
    specificEnergy: specificEnergy,
    tipStates: tipStates,
    releaseFactor: releaseFactor,
    energy: energy,
    recoverySeconds: recoverySeconds,
    requiredPower: requiredPower,
    grid: grid,
    throwAt: throwAt,
    ledger: ledger,
    impulsive: impulsive,
    catchesToFloor: catchesToFloor,
    throwSequence: throwSequence,
    minHubForFloor: minHubForFloor,
    mxerSystem: mxerSystem,
    mxerLedger: mxerLedger,
    reboostBoundEnergy: reboostBoundEnergy,
    pricePerKg: pricePerKg
  };
});
