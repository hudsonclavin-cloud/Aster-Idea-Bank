// Twenty Percent Line: a two-material (HMPE + PBO) rotovator arm under the uniform-working-stress
// taper, sized three ways, with the load each metre carries while a payload rides and between
// catches. Pure: no DOM, no clock, no randomness. Loads as a classic script (window.TwentyPercentLine)
// and with require(). Holds no tether number of its own: every one is read from the snapshot data
// passed to readInputs() (params/rev_a.json and verbatim Skyhook doc lines), or typed by the user.
//
// Units and the nondimensional form used throughout [Certain, derived in README "How it works"]:
//   u = s/L along one arm (hub u = 0, tip u = 1)
//   t = T / T_L, tension over the tip tension with the payload aboard, T_L = m v^2 / L
//   masses are multiples of the payload m
//   for a fibre of strength sigma and density rho, V_c = sqrt(2 sigma / rho) (EQ-4), k = (v/V_c)^2
//   a section held at working fraction f of break (A = T / (f sigma)) has X^2 = k / f and
//     t(u) = t(u1) exp[X^2 (u1^2 - u^2)],  mass = sqrt(pi) X t(u1) e^{X^2 u1^2} [erf(X u1) - erf(X u0)]
//   which for one section from hub to tip is EQ-6 per arm, sqrt(pi) x e^{x^2} erf(x).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwentyPercentLine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SQRT_PI = Math.sqrt(Math.PI);
  const EPS = 1e-12;

  // ---- error function -------------------------------------------------------------------------
  // erf by the all-positive series (Abramowitz & Stegun 7.1.6) below 2.25; above, erfc from the
  // continued fraction (A&S 7.1.14), evaluated backwards, so erf(b) - erf(a) keeps its relative
  // precision when both are close to 1. Checked against CPython's math.erf/erfc in the tests.
  function erfSeries(z) {
    let term = z;
    let sum = z;
    for (let n = 1; n < 400; n++) {
      term *= (2 * z * z) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return (2 / SQRT_PI) * Math.exp(-z * z) * sum;
  }
  // erfcx(z) = exp(z^2) erfc(z), z >= 0.
  function erfcx(z) {
    if (!(z >= 0)) throw new RangeError('erfcx needs z >= 0');
    if (z < 2.25) return Math.exp(z * z) * (1 - erfSeries(z));
    let f = z;
    for (let n = 160; n >= 1; n--) f = z + (n / 2) / f;
    return 1 / (SQRT_PI * f);
  }
  function erf(z) {
    if (z < 0) return -erf(-z);
    if (z < 2.25) return erfSeries(z);
    if (z > 27) return 1;
    return 1 - Math.exp(-z * z) * erfcx(z);
  }
  // e^{b^2} [erf(b) - erf(a)] for 0 <= a <= b, without cancellation.
  function gauss(a, b) {
    if (a >= 2.25) return Math.exp(b * b - a * a) * erfcx(a) - erfcx(b);
    return Math.exp(b * b) * (erf(b) - erf(a));
  }

  // EQ-6 for one material, two arms: 2 sqrt(pi) x e^{x^2} erf(x).
  function eq6(x) {
    return 2 * SQRT_PI * x * Math.exp(x * x) * erf(x);
  }
  function vc(sigmaPa, rho) {
    return Math.sqrt((2 * sigmaPa) / rho);
  }

  // ---- reading the snapshots --------------------------------------------------------------------
  function refusal(code, reason, help) {
    return { code, reason, what_would_help: help };
  }
  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  function get(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // Patterns for the numbers this page takes from Skyhook prose. Each is anchored to wording at
  // the cited line; if the wording changes, the number is refused rather than guessed.
  const PATTERNS = {
    sk99Row: /^\|\s*Dyneema SK99[^|]*\|\s*~?\s*([0-9.]+)\s*GPa\s*\|\s*([0-9][0-9,]*)\s*kg\/m³\s*\|/,
    zylonTip: /outer ~?\s*([0-9]+)\s*km of the lower arm in heat-resistant Zylon/,
    halfTurn: /half a rotation later/,
    capGuidance: /at or below ~?\s*([0-9]+)\s*% of break for multi-year life/,
    loadRange: /carry a steady centrifugal load of\s*([0-9]+)\s*[–-]\s*([0-9]+)\s*% of rated break strength \(([0-9]+)% raw; ([0-9]+)% if the ([0-9]+)% strength derate is applied in sizing\)/,
    sfForCap: /Reaching ([0-9]+)% sustained load would require SF ≈ ([0-9.]+)/,
    fromTo: /from ~([0-9]+)× to order ~([0-9]+)×/,
    hmpeDensityMp: /HMPE \(SK78\/SK99\) specs: ([0-9.]+) g\/cm³/,
    dm20: /DM20 grade creeps >([0-9]+)× slower than SK78/,
    bareTips: /payload_both_tips: bool = False/,
    ggMod: /Gravity-gradient modulation \(~([0-9]+)% at this/,
    aramid: /\(aramid-class creep, ([0-9]+)[–-]([0-9]+)× lower\)/,
    catchAdds: /self\.m\[0\] \+= payload_kg/,
  };

  // Returns { ok, inputs, refusals, notes }. ok is false only when nothing at all can be computed.
  function readInputs(data) {
    const refusals = [];
    const notes = [];
    if (!data || typeof data !== 'object' || !data.revA || typeof data.revA !== 'object') {
      return {
        ok: false,
        inputs: null,
        notes,
        refusals: [refusal('no_canon', 'The Rev A canon (params/rev_a.json) did not load, so there is no fibre, speed, length or safety factor to compute with.',
          'Open the page from its folder so page-data.js loads, or regenerate it with build-data.mjs from a Skyhook checkout.')],
      };
    }
    const r = data.revA;
    const lines = data.lines || {};
    const line = (file, n) => (lines[file] && typeof lines[file][String(n)] === 'string' ? lines[file][String(n)] : null);
    const inputs = { commit: (data.revAProvenance && data.revAProvenance.commit) || null, src: {} };

    // PBO: the canon's primary fibre.
    const sP = num(get(r, 'materials.tensile_strength_GPa'));
    const rP = num(get(r, 'materials.density_kgm3'));
    if (sP && rP && sP > 0 && rP > 0) {
      inputs.pbo = { name: String(get(r, 'materials.primary_fiber') || 'primary fibre'), sigmaGPa: sP, rho: rP, canon: true,
        src: 'params/rev_a.json materials.tensile_strength_GPa, materials.density_kgm3' };
    } else {
      refusals.push(refusal('insufficient_data', 'rev_a.json has no usable primary-fibre strength and density (materials.tensile_strength_GPa, materials.density_kgm3).',
        'Restore both keys in params/rev_a.json; the page will not substitute a typed value for the canon fibre.'));
    }

    // HMPE: strength from the canon, density from the founding document (not canon).
    const sH = num(get(r, 'materials.alternative_fibers.Dyneema_SK99_GPa'));
    const row = line('docs/project_instructions.md', 67);
    const m = row && PATTERNS.sk99Row.exec(row);
    const rowSigma = m ? Number(m[1]) : null;
    const rowRho = m ? Number(m[2].replace(/,/g, '')) : null;
    if (sH && sH > 0 && rowRho && rowRho > 0) {
      inputs.sk99 = { name: 'Dyneema SK99', sigmaGPa: sH, rho: rowRho, canon: false,
        src: 'σ: params/rev_a.json materials.alternative_fibers.Dyneema_SK99_GPa; ρ: docs/project_instructions.md:67 (founding material survey, not canon)',
        rowSigmaAgrees: rowSigma === sH };
      const mp = line('docs/research/mp001_market_pricing.md', 22);
      const mm = mp && PATTERNS.hmpeDensityMp.exec(mp);
      inputs.sk99.mp001Rho = mm ? Math.round(Number(mm[1]) * 1000) : null;
      notes.push('rev_a.json gives Dyneema SK99 a strength but no density; the density is the founding document\'s (docs/project_instructions.md:67), marked not canon wherever it is used.');
    } else {
      refusals.push(refusal('insufficient_data',
        !sH ? 'rev_a.json has no Dyneema SK99 strength (materials.alternative_fibers.Dyneema_SK99_GPa).'
          : 'No SK99 density: rev_a.json has none, and the founding document\'s material survey row (docs/project_instructions.md:67) did not load or no longer reads as expected.',
        'Add a keyed SK99 density to params/rev_a.json (the cleanest fix), or restore the snapshot of project_instructions.md:67; or type a strength and density as a custom HMPE, which the page marks not canon.'));
    }

    // Sizing rule from the canon: working fraction of rated break = (1 - derate) / SF.
    const SF = num(get(r, 'materials.safety_factor'));
    const derate = num(get(r, 'materials.derate_fraction'));
    if (SF && SF > 0 && derate !== null && derate >= 0 && derate < 1) {
      inputs.SF = SF;
      inputs.derate = derate;
      inputs.fs = (1 - derate) / SF;
    } else {
      refusals.push(refusal('insufficient_data', 'rev_a.json has no usable safety factor or derate (materials.safety_factor, materials.derate_fraction).',
        'Restore both keys; the working fraction (1 − derate)/SF is computed from them, never assumed.'));
    }

    // Geometry and kinematics.
    const Lkm = num(get(r, 'geometry.tether_half_length_km'));
    if (Lkm && Lkm > 0) inputs.Lkm = Lkm;
    else refusals.push(refusal('insufficient_data', 'rev_a.json has no tether half-length (geometry.tether_half_length_km).', 'Restore the key.'));
    const tiers = [];
    const tierDefs = [
      ['reference', 'kinematics.v_tip_kms', 'Reference · GTO / high-elliptical'],
      ['cislunar', 'kinematics.cislunar_revenue_gated_option.v_tip_kms', 'Cislunar · revenue-gated'],
      ['phase3', 'kinematics.phase3_growth_option.v_tip_kms', 'Phase 3 · Mars-class growth'],
    ];
    for (const [key, p, label] of tierDefs) {
      const v = num(get(r, p));
      if (v && v > 0) tiers.push({ key, vkms: v, label, src: `params/rev_a.json ${p}` });
      else notes.push(`rev_a.json has no ${p}; that tier is not offered.`);
    }
    inputs.tiers = tiers;
    if (!tiers.length) refusals.push(refusal('insufficient_data', 'rev_a.json has no tier tip speed.', 'Restore kinematics.v_tip_kms.'));
    inputs.rotationPeriodMin = num(get(r, 'geometry.rotation_period_min'));
    inputs.payloadKg = num(get(r, 'mass_ratio.integrated_tether_to_payload_both_arms.payload_mass_kg_for_tonnage'));
    if (!inputs.payloadKg) notes.push('rev_a.json has no payload_mass_kg_for_tonnage; tonnes are not shown.');
    inputs.halfTurnCited = PATTERNS.halfTurn.test(line('docs/project_instructions.md', 10) || '');

    // The ladder, for reconciliation: keys <rung>[_<a>p<b>kms]_<n>pct_derate with their values.
    const block = get(r, 'mass_ratio.integrated_tether_to_payload_both_arms') || {};
    const ladder = [];
    for (const [k, v] of Object.entries(block)) {
      const mm = /^([a-z0-9]+?)(?:_([0-9]+)p([0-9]+)kms)?_([0-9]+)pct_derate$/.exec(k);
      if (!mm || num(v) === null) continue;
      const vk = mm[2] ? Number(`${mm[2]}.${mm[3]}`) : num(block.reference_v_tip_kms);
      ladder.push({ key: k, value: v, vkms: vk, derate: Number(mm[4]) / 100, SF: num(block.SF) });
    }
    inputs.ladder = ladder;

    // Construction baseline: the Zylon outer length of the lower arm (founding document).
    const b = line('docs/project_instructions.md', 108);
    const z = b && PATTERNS.zylonTip.exec(b);
    if (z) inputs.zylonTipKm = Number(z[1]);
    else refusals.push(refusal('insufficient_data', 'The construction baseline\'s Zylon outer length (docs/project_instructions.md:108) did not load or no longer reads "outer ~N km of the lower arm in heat-resistant Zylon".',
      'Restore the snapshot of that line, or record the hybrid layout in params/rev_a.json, where it belongs.'));

    // DECISION_LOG item 10: the guidance cap and the sentence this page recomputes.
    const l70 = line('docs/DECISION_LOG.md', 70);
    const cap = l70 && PATTERNS.capGuidance.exec(l70);
    if (cap) inputs.cap = Number(cap[1]) / 100;
    else refusals.push(refusal('insufficient_data', 'The ≤20 % sustained-load guidance (docs/DECISION_LOG.md:70, from MP-001 §3c) did not load or no longer reads as expected.',
      'Restore the snapshot of that line; the cap can still be set by hand with the slider.'));
    const lr = l70 && PATTERNS.loadRange.exec(l70);
    if (lr) inputs.item10Range = { lo: Number(lr[1]) / 100, hi: Number(lr[2]) / 100, raw: Number(lr[3]) / 100, derated: Number(lr[4]) / 100, derate: Number(lr[5]) / 100 };
    const l72 = line('docs/DECISION_LOG.md', 72);
    const sfm = l72 && PATTERNS.sfForCap.exec(l72);
    const ft = l72 && PATTERNS.fromTo.exec(l72);
    if (sfm) inputs.item10SF = { capPct: Number(sfm[1]), SF: Number(sfm[2]) };
    if (ft) inputs.item10Quote = { from: Number(ft[1]), to: Number(ft[2]) };
    const lr45 = line('docs/research/lr001_splice_literature.md', 45);
    const dm = lr45 && PATTERNS.dm20.exec(lr45);
    inputs.dm20Ratio = dm ? Number(dm[1]) : null;
    const gg = PATTERNS.ggMod.exec(line('physics/tether_dynamics.py', 353) || '');
    inputs.ggModPct = gg ? Number(gg[1]) : null;
    const ar = PATTERNS.aramid.exec(line('docs/research/mp001_market_pricing.md', 46) || '');
    inputs.aramidCreep = ar ? [Number(ar[1]), Number(ar[2])] : null;
    inputs.bareTipsCited = PATTERNS.bareTips.test(line('physics/tether_dynamics.py', 81) || '')
      && PATTERNS.catchAdds.test(line('physics/tether_dynamics.py', 357) || '');

    const ok = !!(inputs.pbo && inputs.fs && inputs.Lkm && inputs.tiers.length);
    return { ok, inputs, refusals, notes };
  }

  // A fibre object for the kernel: V_c and the strength in Pa.
  function fibre(f) {
    return { name: f.name, sigma: f.sigmaGPa * 1e9, rho: f.rho, Vc: vc(f.sigmaGPa * 1e9, f.rho), canon: !!f.canon };
  }
  function customFibre(sigmaGPa, rho) {
    const s = Number(sigmaGPa);
    const d = Number(rho);
    if (!(Number.isFinite(s) && s > 0) || !(Number.isFinite(d) && d > 0)) {
      return { refusal: refusal('invalid_input', 'A custom HMPE needs both a tensile strength (GPa) and a density (kg/m³), each a positive number.',
        'Type both values from a datasheet you can cite; nothing is filled in for you.') };
    }
    return { fibre: { name: 'Custom HMPE (user-entered, not canon)', sigmaGPa: s, rho: d, canon: false } };
  }

  // ---- layouts ------------------------------------------------------------------------------
  // p km of PBO added per arm to the construction baseline (lower arm: HMPE bulk with a z km Zylon
  // tip; upper arm: all HMPE), either at the tip end (HMPE stays at the hub, the baseline's order)
  // or at the hub end (PBO core at the hub, HMPE outboard, the lower arm keeps its Zylon tip).
  // Sections run hub to tip in u = s/L.
  function layout(Lkm, zKm, pKm, where) {
    const L = Lkm;
    const p = Math.max(0, Math.min(L, pKm));
    const z = Math.max(0, Math.min(L, zKm));
    const out = { lower: [], upper: [] };
    const push = (arm, mat, a, b) => { if (b - a > 1e-9) arm.push({ mat, u0: a / L, u1: b / L }); };
    if (where === 'hub') {
      const pl = Math.min(p, L - z);
      push(out.lower, 'P', 0, pl);
      push(out.lower, 'H', pl, L - z);
      push(out.lower, 'P', L - z, L);
      push(out.upper, 'P', 0, p);
      push(out.upper, 'H', p, L);
    } else {
      const hl = Math.max(0, L - z - p);
      push(out.lower, 'H', 0, hl);
      push(out.lower, 'P', hl, L);
      push(out.upper, 'H', 0, L - p);
      push(out.upper, 'P', L - p, L);
    }
    // merge neighbours of the same material (p = 0 at the hub end gives an empty PBO core)
    for (const k of ['lower', 'upper']) {
      const merged = [];
      for (const s of out[k]) {
        const last = merged[merged.length - 1];
        if (last && last.mat === s.mat) last.u1 = s.u1;
        else merged.push({ ...s });
      }
      out[k] = merged;
    }
    return out;
  }

  // ---- the kernel ---------------------------------------------------------------------------
  // One arm. sections: [{ mat: 'P'|'H', u0, u1 }] hub to tip, contiguous, covering [0, 1].
  // opts: { vms, P, H (fibres from fibre()), fs, cap, mode: 'none'|'every'|'between', beta }
  //   mode 'none'    HMPE held at fs, like PBO (the canon's SF 2.5 rule)
  //   mode 'every'   HMPE held at min(fs, cap) with the payload aboard (item 10's reading)
  //   mode 'between' HMPE held at fs with the payload aboard AND at cap between catches, when the
  //                  tip carries beta x the payload's mass (the tether is the same in both states)
  // Returns { mass, tHub, pieces } with pieces hub-to-tip, each { mat, regime, u0, u1, X2, t1 (at
  // u1), tOff1 (regime 'b'), f, mass }. Regime 'a': uniform stress f on the payload-aboard
  // tension. Regime 'b': uniform stress cap on the between-catch tension, t_off = t - (1 - beta).
  function arm(sections, opts) {
    const { vms, P, H, fs, cap, mode, beta } = opts;
    let t = 1;
    let mass = 0;
    const pieces = [];
    const add = (piece) => { pieces.push(piece); mass += piece.mass; };
    const uniform = (mat, fib, f, u0, u1) => {
      const X2 = (vms / fib.Vc) ** 2 / f;
      const X = Math.sqrt(X2);
      const m = SQRT_PI * X * t * gauss(X * u0, X * u1);
      add({ mat, regime: 'a', u0, u1, X2, t1: t, f, mass: m });
      t *= Math.exp(X2 * (u1 * u1 - u0 * u0));
    };
    for (let i = sections.length - 1; i >= 0; i--) {
      const { mat, u0, u1 } = sections[i];
      const fib = mat === 'P' ? P : H;
      if (mat === 'P' || mode === 'none') { uniform(mat, fib, fs, u0, u1); continue; }
      if (mode === 'every') { uniform(mat, fib, Math.min(fs, cap), u0, u1); continue; }
      // mode 'between'
      if (cap >= fs) { uniform(mat, fib, fs, u0, u1); continue; }
      const tStar = (1 - beta) / (1 - cap / fs);
      let uTop = u1;
      if (t < tStar) {
        const X2 = (vms / fib.Vc) ** 2 / fs;
        const uSw2 = u1 * u1 - Math.log(tStar / t) / X2;
        if (uSw2 <= u0 * u0) { uniform(mat, fib, fs, u0, u1); continue; }
        const uSw = Math.sqrt(uSw2);
        uniform(mat, fib, fs, uSw, u1);
        t = tStar; // exact at the switch, where both rules give the same area
        uTop = uSw;
      }
      const Y2 = (vms / fib.Vc) ** 2 / cap;
      const Y = Math.sqrt(Y2);
      const tOff = t - (1 - beta);
      const m = SQRT_PI * Y * tOff * gauss(Y * u0, Y * uTop);
      add({ mat, regime: 'b', u0, u1: uTop, X2: Y2, t1: t, tOff1: tOff, f: cap, mass: m });
      t = tOff * Math.exp(Y2 * (uTop * uTop - u0 * u0)) + (1 - beta);
    }
    pieces.reverse();
    return { mass, tHub: t, pieces };
  }

  // Payload-aboard tension (in T_L) at u inside a piece.
  function tAt(piece, u, beta) {
    if (piece.regime === 'a') return piece.t1 * Math.exp(piece.X2 * (piece.u1 * piece.u1 - u * u));
    return piece.tOff1 * Math.exp(piece.X2 * (piece.u1 * piece.u1 - u * u)) + (1 - beta);
  }
  // Load as a fraction of rated break at u, with the payload aboard ('aboard') or between catches.
  function fractionAt(piece, u, state, beta) {
    const t = tAt(piece, u, beta);
    const tOff = t - (1 - beta);
    if (piece.regime === 'a') return state === 'aboard' ? piece.f : piece.f * (tOff / t);
    return state === 'aboard' ? piece.f * (t / tOff) : piece.f;
  }
  // Cross-section at u in units of T_L / sigma_ref (only ratios are drawn).
  function areaAt(piece, u, fib, sigmaRef, beta) {
    const t = tAt(piece, u, beta);
    const tension = piece.regime === 'a' ? t : t - (1 - beta);
    return (tension * sigmaRef) / (piece.f * fib.sigma);
  }

  // The part of an HMPE piece whose load is above the cap in a given state, as [u0, u1] or null.
  function aboveCap(piece, state, cap, beta) {
    if (piece.mat !== 'H') return null;
    const tol = 1e-9;
    if (state === 'aboard') {
      if (piece.regime === 'a') return piece.f > cap + tol ? [piece.u0, piece.u1] : null;
      return beta < 1 - tol ? [piece.u0, piece.u1] : null;
    }
    if (piece.regime === 'b') return null; // held exactly at the cap
    if (piece.f <= cap + tol) return null;
    // f (1 - (1-beta)/t) > cap  <=>  t > tc; t rises toward the hub
    const tc = (1 - beta) / (1 - cap / piece.f);
    const tTop = piece.t1;
    if (tTop > tc) return [piece.u0, piece.u1];
    const uc2 = piece.u1 * piece.u1 - Math.log(tc / tTop) / piece.X2;
    if (uc2 <= piece.u0 * piece.u0) return null;
    return [piece.u0, Math.sqrt(uc2)];
  }

  // ---- the whole tether -----------------------------------------------------------------------
  // cfg: { tierKey, pKm, where, fs, cap, mode, beta, hmpe: 'sk99'|'custom', custom: {sigmaGPa, rho} }
  function compute(inputs, cfg) {
    const refusals = [];
    if (!inputs || !inputs.pbo || !inputs.Lkm || !inputs.tiers || !inputs.tiers.length) {
      return { refusal: refusal('no_canon', 'The canon did not provide a fibre, a length and a tip speed.', 'Restore params/rev_a.json.') };
    }
    const tier = inputs.tiers.find((x) => x.key === cfg.tierKey) || inputs.tiers[0];
    let hm;
    if (cfg.hmpe === 'custom') {
      const c = customFibre(cfg.custom && cfg.custom.sigmaGPa, cfg.custom && cfg.custom.rho);
      if (c.refusal) return { refusal: c.refusal };
      hm = c.fibre;
    } else {
      if (!inputs.sk99) {
        return { refusal: refusal('insufficient_data', 'No HMPE density: rev_a.json gives Dyneema SK99 a strength but no density, and the founding document\'s row did not load.',
          'Add a keyed SK99 density to params/rev_a.json, or choose "Custom HMPE" and type a strength and density you can cite (marked not canon).') };
      }
      hm = inputs.sk99;
    }
    if (inputs.zylonTipKm == null) {
      return { refusal: refusal('insufficient_data', 'The construction baseline layout (Zylon outer length of the lower arm, docs/project_instructions.md:108) is missing.',
        'Restore the snapshot of that line.') };
    }
    const fs = Number(cfg.fs);
    const cap = cfg.cap == null || cfg.cap === '' ? null : Number(cfg.cap);
    const hasCap = cap !== null && cap > 0 && cap <= 1;
    const beta = Number(cfg.beta || 0);
    const pKm = Number(cfg.pKm);
    if (!(fs > 0 && fs <= 1)) refusals.push(refusal('invalid_input', 'The working fraction must be above 0 and at most 1 of break.', 'Set a fraction between 0.10 and 0.40.'));
    if (cfg.mode !== 'none' && !hasCap) {
      refusals.push(cap === null
        ? refusal('insufficient_data', 'No creep cap: the guidance line (docs/DECISION_LOG.md:70) did not load and none has been set.', 'Set a cap with the slider; it is then yours, not the program\'s.')
        : refusal('invalid_input', 'The creep cap must be above 0 and at most 1 of break.', 'Set a cap between 0.10 and 0.40.'));
    }
    if (!(beta >= 0 && beta <= 1)) refusals.push(refusal('invalid_input', 'The tip mass between catches must be between 0 and 1 payload.', 'Set it between 0 % and 100 %.'));
    if (!(pKm >= 0 && pKm <= inputs.Lkm)) refusals.push(refusal('invalid_input', `The PBO added per arm must be between 0 and ${inputs.Lkm} km.`, 'Move the slider back into range.'));
    if (!['none', 'every', 'between'].includes(cfg.mode)) refusals.push(refusal('invalid_input', 'Unknown sizing rule.', 'Choose one of the three rules.'));
    if (!['tip', 'hub'].includes(cfg.where)) refusals.push(refusal('invalid_input', 'Unknown layout.', 'Choose tip end or hub end.'));
    if (refusals.length) return { refusal: refusals[0] };

    const P = fibre(inputs.pbo);
    const H = fibre(hm);
    const vms = tier.vkms * 1000;
    const lay = layout(inputs.Lkm, inputs.zylonTipKm, pKm, cfg.where);
    const opts = { vms, P, H, fs, cap, mode: cfg.mode, beta };
    const lower = arm(lay.lower, opts);
    const upper = arm(lay.upper, opts);
    const ratio = lower.mass + upper.mass;
    if (!Number.isFinite(ratio) || !Number.isFinite(lower.tHub) || !Number.isFinite(upper.tHub) || ratio > 1e12) {
      return { refusal: refusal('out_of_envelope', 'The taper overflows at these settings: the tether would be more than 10¹² times the payload.',
        'Lower the tip speed, or raise the working fraction or the cap.') };
    }
    const stats = (state) => {
      if (!hasCap) return null;
      let above = 0;
      let hmpe = 0;
      let peak = 0;
      for (const a of [lower, upper]) {
        for (const pc of a.pieces) {
          if (pc.mat !== 'H') continue;
          hmpe += pc.u1 - pc.u0;
          const r = aboveCap(pc, state, cap, beta);
          if (r) above += r[1] - r[0];
          peak = Math.max(peak, fractionAt(pc, pc.u0, state, beta), fractionAt(pc, pc.u1, state, beta));
        }
      }
      return { aboveKm: above * inputs.Lkm, hmpeKm: hmpe * inputs.Lkm, peak };
    };
    const hmpeMass = [lower, upper].reduce((s, a) => s + a.pieces.filter((x) => x.mat === 'H').reduce((q, x) => q + x.mass, 0), 0);
    return {
      tier, P, H, layout: lay, lower, upper, ratio,
      tonnes: inputs.payloadKg ? (ratio * inputs.payloadKg) / 1000 : null,
      hmpeMassShare: ratio > 0 ? hmpeMass / ratio : 0,
      aboard: stats('aboard'),
      between: stats('between'),
      aboardMin: (Math.PI * inputs.Lkm) / tier.vkms / 60, // half a rotation, minutes
      cfg: { ...cfg, fs, cap, beta, pKm },
    };
  }

  // Two-arm mass ratio for a whole tether of one fibre (EQ-6), at working fraction f.
  function singleMaterial(fib, vkms, f) {
    const F = fibre(fib);
    return eq6(((vkms * 1000) / F.Vc) / Math.sqrt(f));
  }

  // The working fraction that gives a target two-arm ratio for one fibre (bisection on f).
  function fractionFor(fib, vkms, target) {
    let lo = 1e-3;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (singleMaterial(fib, vkms, mid) > target) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // DECISION_LOG item 10, recomputed. Every row's f is (1 - derate)/SF; x depends on nothing else.
  function item10(inputs) {
    if (!inputs || !inputs.pbo || !inputs.SF || !inputs.tiers || !inputs.tiers.length) return null;
    const ref = inputs.tiers.find((x) => x.key === 'reference') || inputs.tiers[0];
    const derates = [...new Set(inputs.ladder.filter((l) => Math.abs(l.vkms - ref.vkms) < 1e-9).map((l) => l.derate))].sort((a, b) => a - b);
    const rows = [];
    const sf5 = inputs.item10SF ? inputs.item10SF.SF : null;
    for (const d of derates) rows.push({ SF: inputs.SF, derate: d, f: (1 - d) / inputs.SF, kind: 'canon' });
    if (sf5) for (const d of derates) rows.push({ SF: sf5, derate: d, f: (1 - d) / sf5, kind: 'item10' });
    if (inputs.cap) rows.push({ SF: (1 - inputs.derate) / inputs.cap, derate: inputs.derate, f: inputs.cap, kind: 'cap' });
    for (const row of rows) {
      row.pbo = singleMaterial(inputs.pbo, ref.vkms, row.f);
      row.sk99 = inputs.sk99 ? singleMaterial(inputs.sk99, ref.vkms, row.f) : null;
      const lad = inputs.ladder.find((l) => Math.abs(l.vkms - ref.vkms) < 1e-9 && Math.abs(l.derate - row.derate) < 1e-9 && Math.abs(l.SF - row.SF) < 1e-9);
      row.ladder = lad ? lad.value : null;
    }
    const out = { vkms: ref.vkms, rows, fs: inputs.fs };
    if (inputs.item10Quote) {
      out.quote = inputs.item10Quote;
      out.fFor800 = fractionFor(inputs.pbo, ref.vkms, inputs.item10Quote.to);
    }
    if (inputs.item10Range) {
      out.range = inputs.item10Range;
      out.rangeReproduces = Math.abs(inputs.item10Range.raw - 1 / inputs.SF) < 1e-9
        && Math.abs(inputs.item10Range.derated - (1 - inputs.item10Range.derate) / inputs.SF) < 1e-9;
    }
    if (inputs.sk99 && inputs.cap && inputs.zylonTipKm != null) {
      // All-HMPE arms under the between-catch rule, for the panel's last line.
      const H = fibre(inputs.sk99);
      const P = fibre(inputs.pbo);
      const one = arm([{ mat: 'H', u0: 0, u1: 1 }], { vms: ref.vkms * 1000, P, H, fs: inputs.fs, cap: inputs.cap, mode: 'between', beta: 0 });
      out.sk99Between = 2 * one.mass;
    }
    return out;
  }

  // Mass ratio across the PBO-added slider, for the three rules (the chart's curves).
  function sweep(inputs, cfg, n) {
    const N = n || 161;
    const xs = [];
    const curves = { none: [], every: [], between: [] };
    for (let i = 0; i < N; i++) {
      const p = (inputs.Lkm * i) / (N - 1);
      xs.push(p);
      for (const mode of Object.keys(curves)) {
        const r = compute(inputs, { ...cfg, pKm: p, mode });
        curves[mode].push(r.refusal ? null : r.ratio);
      }
    }
    return { xs, curves };
  }

  return {
    erf, erfcx, gauss, eq6, vc, readInputs, layout, arm, tAt, fractionAt, areaAt, aboveCap,
    compute, singleMaterial, fractionFor, item10, sweep, customFibre, fibre, PATTERNS,
  };
});
