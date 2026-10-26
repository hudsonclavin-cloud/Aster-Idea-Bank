// Taper Is Not Mass: the pure model. No DOM, no clock, no randomness, no tether numbers.
// Every tether constant (strengths, densities, safety factor, tier tip speeds, the mass-ratio
// ladder, the payload for tonnage, the mass-growth guardrail) is read at run time from Skyhook's
// params/rev_a.json (snapshot: snapshots/rev_a.json, wrapped as snapshots/rev_a.data.js).
// Loads as a classic script (window.TaperModel) and under Node with require().
//
// EQ-4  V_c = sqrt(2 sigma / rho)                                 [Certain]
// x     = (v_tip / V_c) * sqrt(SF / (1 - derate))                 [Certain] (EQ-6's argument)
// EQ-5  taper = exp(x^2): peak area / tip area of the constant-stress arm. With derate = 0 this
//       is physics/skyhook_physics.py taper_ratio(); with a derate it is the glossary's
//       "20.1 with 30% strength derate" convention.                 [Certain]
// EQ-6  M/m = arms * sqrt(pi) * x * exp(x^2) * erf(x)               [Certain]
// Hence M/m / taper = arms * sqrt(pi) * x * erf(x), a function of x alone.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaperModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SQRT_PI = Math.sqrt(Math.PI);
  // Badge tolerance: the relative tolerance Skyhook's own ladder test uses,
  // tests/test_rev_a_physics.py:180-185 (math.isclose(..., rel_tol=5e-4)) at 34935cb.
  var BADGE_REL_TOL = 5e-4;
  // A quoted "~" figure that misses at its own precision but lands within this fraction is
  // reported as "close"; beyond it, "does not reproduce". A presentation choice, not physics.
  var CLOSE_FRACTION = 0.05;

  // ── erf ────────────────────────────────────────────────────────────────────────────────
  // erf(x) = (2/sqrt(pi)) e^{-x^2} sum_{n>=0} 2^n x^{2n+1} / (1*3*...*(2n+1)).
  // Every term is positive, so there is no cancellation; agrees with CPython's math.erf to
  // ~1e-15 on [0, 6] (tested). Beyond 6, 1 - erf < 2.2e-17, below double resolution.
  function erf(x) {
    if (typeof x !== 'number' || x !== x) return NaN;
    if (x < 0) return -erf(-x);
    if (x === 0) return 0;
    if (x > 6) return 1;
    var x2 = x * x;
    var term = x;
    var sum = x;
    for (var n = 1; n < 400; n++) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
      if (term <= sum * 1e-17) break;
    }
    return Math.min(1, (2 / SQRT_PI) * Math.exp(-x2) * sum);
  }

  // Abramowitz & Stegun 7.1.26 (max abs error 1.5e-7): the approximation Skyhook's sims and
  // twin use (tools/twin/physics.js:33-40, skyhook_program_site.html:1137). Kept only so the
  // tests can show it is adequate at the page's tolerance; the model itself uses erf() above.
  function erfAS(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  // ── EQ-4, x, EQ-5, EQ-6 ────────────────────────────────────────────────────────────────
  function characteristicVelocityKms(sigmaGPa, rhoKgm3) {
    return Math.sqrt((2 * sigmaGPa * 1e9) / rhoKgm3) / 1e3;
  }
  function xParam(vTipKms, VcKms, SF, derate) {
    return (vTipKms / VcKms) * Math.sqrt(SF / (1 - derate));
  }
  function taperOfX(x) {
    return Math.exp(x * x);
  }
  function massRatioOfX(x, arms) {
    if (arms === undefined) arms = 2;
    return arms * SQRT_PI * x * Math.exp(x * x) * erf(x);
  }
  // M/m divided by taper: arms * sqrt(pi) * x * erf(x). Depends on x only.
  function gapOfX(x, arms) {
    if (arms === undefined) arms = 2;
    return arms * SQRT_PI * x * erf(x);
  }
  // Mean of A(u)/A_tip = exp(x^2 (1 - u^2)) over one arm, u = r/L in [0, 1].
  function meanAreaOfX(x) {
    if (x < 1e-8) return 1 + (2 * x * x) / 3;
    return Math.exp(x * x) * (SQRT_PI * erf(x)) / (2 * x);
  }
  // A(u)/A_tip for the constant-stress arm.
  function profile(x, u) {
    return Math.exp(x * x * (1 - u * u));
  }
  // The x where mass ratio equals taper (gap = 1), by bisection on [0.05, 2]; gap is increasing.
  function crossoverX(arms) {
    if (arms === undefined) arms = 2;
    var lo = 0.05;
    var hi = 2;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (gapOfX(mid, arms) < 1) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // The derate at which arms * EQ-5 equals a target, at fixed v, V_c, SF (inverse of EQ-5).
  function derateForTaperTarget(target, vTipKms, VcKms, SF, arms) {
    var a = (vTipKms / VcKms) * (vTipKms / VcKms) * SF;
    return 1 - a / Math.log(target / arms);
  }
  function sfForTaperTarget(target, vTipKms, VcKms, derate, arms) {
    var a = (vTipKms / VcKms) * (vTipKms / VcKms) / (1 - derate);
    return Math.log(target / arms) / a;
  }

  function refusal(code, reason, whatWouldHelp, extra) {
    var r = { ok: false, refusal: { code: code, reason: reason, whatWouldHelp: whatWouldHelp } };
    if (extra) for (var k in extra) r.refusal[k] = extra[k];
    return r;
  }
  function finitePositive(v) {
    return typeof v === 'number' && isFinite(v) && v > 0;
  }

  // One evaluation. inputs: { vTipKms, derate, SF, sigmaGPa, rhoKgm3, payloadKg (optional) }.
  // Returns every quantity the page shows, or a structured refusal; never a fallback number.
  function evaluate(inp) {
    if (!inp) return refusal('invalid_input', 'No inputs.', 'Choose a material and set tip speed, derate and safety factor.');
    if (!finitePositive(inp.sigmaGPa) || !finitePositive(inp.rhoKgm3)) {
      return refusal('insufficient_data', 'EQ-4 needs a positive tensile strength and density for the fibre.', 'Pick a fibre whose strength and density are both in rev_a.json, or type both for a custom fibre.');
    }
    if (!(typeof inp.vTipKms === 'number' && isFinite(inp.vTipKms) && inp.vTipKms >= 0)) {
      return refusal('invalid_input', 'Tip speed must be a number of km/s, zero or more.', 'Set the tip speed slider.');
    }
    if (!finitePositive(inp.SF)) return refusal('invalid_input', 'The safety factor must be positive.', 'Set the safety factor slider.');
    if (!(typeof inp.derate === 'number' && inp.derate >= 0 && inp.derate < 1)) {
      return refusal('out_of_envelope', 'EQ-6 is defined for a strength derate in [0, 1); at 100 % the fibre carries nothing.', 'Use a derate below 100 %.');
    }
    var Vc = characteristicVelocityKms(inp.sigmaGPa, inp.rhoKgm3);
    var x = xParam(inp.vTipKms, Vc, inp.SF, inp.derate);
    var taper = taperOfX(x);
    var mass = massRatioOfX(x, 2);
    if (!isFinite(taper) || !isFinite(mass)) {
      return refusal('out_of_envelope', 'x = ' + x.toPrecision(4) + ' puts exp(x²) beyond double precision (x² > 709): the tether cannot be built at these settings, and no number is shown for it.', 'Lower the tip speed or safety factor, or use a stronger or lighter fibre.', { x: x });
    }
    var out = {
      ok: true,
      Vc: Vc,
      vOverVc: inp.vTipKms / Vc,
      x: x,
      taper: taper,
      taperNoDerate: Math.exp((inp.vTipKms / Vc) * (inp.vTipKms / Vc) * inp.SF),
      massRatio: mass,
      gap: x > 0 ? mass / taper : 0,
      tipSized: 2 * x * x,
      meanArea: meanAreaOfX(x),
      meanOverPeak: meanAreaOfX(x) / taper
    };
    if (finitePositive(inp.payloadKg)) {
      out.payloadKg = inp.payloadKg;
      out.fibreMassT = (mass * inp.payloadKg) / 1000;
    }
    return out;
  }

  // ── Reading the canon ──────────────────────────────────────────────────────────────────
  function get(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function num(obj, path) {
    var v = get(obj, path);
    return typeof v === 'number' && isFinite(v) ? v : undefined;
  }
  function decimalsOf(v) {
    var s = String(v);
    var i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }
  function roundTo(v, dp) {
    var f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  var NO_CANON = {
    code: 'no_canon',
    reason: 'snapshots/rev_a.data.js did not load, so this page has no Rev A canon to compute from.',
    whatWouldHelp: 'Open index.html from its folder with snapshots/ beside it, or regenerate the file with build-data.mjs from snapshots/rev_a.json. The page carries no default tether numbers to fall back on (Rule 1).'
  };

  // Materials: the primary fibre, then every alternative_fibers "<name>_GPa" key. A density is
  // taken from a keyed "<name>_density_kgm3" if one exists, else from a matching "_<token>_note"
  // string ("density <N> kg/m3"), else the fibre is refused.
  function readMaterials(d) {
    var mats = [];
    var m = get(d, 'materials');
    var pName = get(d, 'materials.primary_fiber');
    var pSigma = num(d, 'materials.tensile_strength_GPa');
    var pRho = num(d, 'materials.density_kgm3');
    var primary = {
      id: 'primary',
      name: typeof pName === 'string' ? pName : 'primary fibre',
      canon: true,
      primary: true,
      sigmaGPa: pSigma,
      rhoKgm3: pRho,
      sigmaKey: 'materials.tensile_strength_GPa',
      rhoKey: 'materials.density_kgm3',
      rhoSource: 'key'
    };
    var missing = [];
    if (pSigma === undefined) missing.push('materials.tensile_strength_GPa');
    if (pRho === undefined) missing.push('materials.density_kgm3');
    if (missing.length) {
      primary.refusal = {
        code: 'insufficient_data',
        reason: 'rev_a.json is missing ' + missing.join(' and ') + ', which EQ-4 needs for the primary fibre.',
        whatWouldHelp: 'Restore the key in params/rev_a.json and re-snapshot it.',
        missing: missing
      };
    }
    mats.push(primary);
    var alt = m && m.alternative_fibers;
    if (alt && typeof alt === 'object') {
      var notes = {};
      Object.keys(alt).forEach(function (k) {
        var nm = /^_(.+)_note$/.exec(k);
        if (nm && typeof alt[k] === 'string') notes[nm[1].toLowerCase()] = { key: k, text: alt[k] };
      });
      Object.keys(alt).forEach(function (k) {
        var g = /^([^_].*)_GPa$/.exec(k);
        if (!g || typeof alt[k] !== 'number') return;
        var base = g[1];
        var mat = {
          id: 'alt:' + base,
          name: base.replace(/_/g, ' '),
          canon: true,
          primary: false,
          sigmaGPa: alt[k],
          sigmaKey: 'materials.alternative_fibers.' + k,
          rhoKgm3: undefined
        };
        if (typeof alt[base + '_density_kgm3'] === 'number') {
          mat.rhoKgm3 = alt[base + '_density_kgm3'];
          mat.rhoKey = 'materials.alternative_fibers.' + base + '_density_kgm3';
          mat.rhoSource = 'key';
        } else {
          var note = null;
          Object.keys(notes).forEach(function (tok) {
            if (base.toLowerCase().indexOf(tok) >= 0) note = notes[tok];
          });
          var dm = note && /density\s+(\d+(?:\.\d+)?)\s*kg\/m(?:3|³)/i.exec(note.text);
          if (dm) {
            mat.rhoKgm3 = Number(dm[1]);
            mat.rhoKey = 'materials.alternative_fibers.' + note.key;
            mat.rhoSource = 'note';
            mat.rhoNote = note.text;
          } else {
            mat.refusal = {
              code: 'insufficient_data',
              reason: 'rev_a.json gives ' + mat.name + ' a tensile strength (' + mat.sigmaGPa + ' GPa, ' + mat.sigmaKey + ') but no density, keyed or in its note' + (note ? ' ("' + note.text + '")' : '') + '. EQ-4 needs both, so this page computes nothing for it.',
              whatWouldHelp: 'A keyed density for this fibre in params/rev_a.json (for example "' + base + '_density_kgm3"). The founding document\'s material survey (docs/project_instructions.md §2.3) lists densities, but it is not the canon file. To explore anyway, choose "Custom fibre": its curves are drawn dashed and marked not canon.',
              missing: ['density']
            };
          }
        }
        mats.push(mat);
      });
    }
    return mats;
  }

  var TIER_DEFS = [
    { id: 'reference', label: 'Rev A reference', short: 'Ref', path: 'kinematics.v_tip_kms' },
    { id: 'cislunar', label: 'Cislunar, revenue-gated option', short: 'Cislunar', path: 'kinematics.cislunar_revenue_gated_option.v_tip_kms' },
    { id: 'phase3', label: 'Phase 3 growth option', short: 'Ph 3', path: 'kinematics.phase3_growth_option.v_tip_kms' }
  ];

  function readCanon(revA) {
    if (!revA || typeof revA !== 'object' || !revA.data || typeof revA.data !== 'object') {
      return { ok: false, refusal: NO_CANON };
    }
    var d = revA.data;
    var c = { ok: true, provenance: revA.provenance || null, notes: [] };
    c.materials = readMaterials(d);
    c.primary = c.materials[0];
    c.tiers = [];
    TIER_DEFS.forEach(function (t) {
      var v = num(d, t.path);
      if (v === undefined) c.notes.push('No tip speed at ' + t.path + '; the ' + t.label + ' pin is not drawn.');
      else c.tiers.push({ id: t.id, label: t.label, short: t.short, path: t.path, vTipKms: v });
    });
    var LB = 'mass_ratio.integrated_tether_to_payload_both_arms';
    var block = get(d, LB);
    c.ladderPath = LB;
    c.SF = num(d, LB + '.SF');
    c.SFKey = LB + '.SF';
    c.materialsSF = num(d, 'materials.safety_factor');
    c.vRef = num(d, LB + '.reference_v_tip_kms');
    c.payloadKg = num(d, LB + '.payload_mass_kg_for_tonnage');
    c.payloadKey = LB + '.payload_mass_kg_for_tonnage';
    c.derateFraction = num(d, 'materials.derate_fraction');
    var gNote = get(d, 'mass_ratio._ratio_note');
    var gm = typeof gNote === 'string' && /(\d+(?:\.\d+)?)x mass-growth guardrail/.exec(gNote);
    c.guardrail = gm ? { ratio: Number(gm[1]), key: 'mass_ratio._ratio_note', note: gNote } : null;
    if (!c.guardrail) c.notes.push('No "Nx mass-growth guardrail" in mass_ratio._ratio_note; the guardrail band is not drawn.');
    c.ladder = readLadder(d, block, c);
    c.rounded = readRounded(d, c);
    return c;
  }

  function tierSpeed(c, id) {
    for (var i = 0; i < c.tiers.length; i++) if (c.tiers[i].id === id) return c.tiers[i].vTipKms;
    return undefined;
  }

  // Every rung of the ladder, plus the duplicates under kinematics, with what it needs and
  // where each input came from. The 0 % and 15 % derates exist in the file only as key names.
  function readLadder(d, block, c) {
    var rows = [];
    if (!block || typeof block !== 'object') return rows;
    var re = /^([a-z0-9]+?)(?:_(\d+)p(\d+)kms)?_(\d+)pct_derate$/;
    Object.keys(block).forEach(function (k) {
      var m = re.exec(k);
      if (!m || typeof block[k] !== 'number') return;
      var v;
      var vSrc;
      if (m[2] !== undefined) {
        v = Number(m[2] + '.' + m[3]);
        vSrc = 'key name "' + m[2] + 'p' + m[3] + 'kms"';
        var tierId = m[1] === 'phase3' ? 'phase3' : m[1] === 'cislunar' ? 'cislunar' : null;
        var tv = tierId && tierSpeed(c, tierId);
        if (tv !== undefined && tv !== null && Math.abs(tv - v) > 1e-9) c.notes.push('Key ' + k + ' names ' + v + ' km/s but the tier says ' + tv + ' km/s.');
      } else {
        v = c.vRef;
        vSrc = 'reference_v_tip_kms';
      }
      var derate = Number(m[4]) / 100;
      var dSrc = 'key name "' + m[4] + 'pct"';
      if (c.derateFraction !== undefined && Math.abs(c.derateFraction - derate) < 1e-12) dSrc += ' = materials.derate_fraction';
      var base = { rung: m[1], vTipKms: v, vSource: vSrc, derate: derate, derateSource: dSrc, SF: c.SF, SFSource: 'SF' };
      rows.push(makeRow(c, LBkey(k), 'ratio', block[k], base));
      var mk = k.replace(/_derate$/, '_fiber_mass_t');
      if (typeof block[mk] === 'number') rows.push(makeRow(c, LBkey(mk), 'mass', block[mk], base));
    });
    // Duplicates carried under the kinematics tier options.
    [['cislunar', 'kinematics.cislunar_revenue_gated_option'], ['phase3', 'kinematics.phase3_growth_option']].forEach(function (pair) {
      var opt = get(d, pair[1]);
      if (!opt || typeof opt !== 'object') return;
      Object.keys(opt).forEach(function (k) {
        var mr = /^integrated_mass_ratio_(\d+)pct_derate_both_arms$/.exec(k);
        var mm = /^fiber_mass_t_at_(\d+)kg_payload$/.exec(k);
        if (!(mr || mm) || typeof opt[k] !== 'number') return;
        var v = num(opt, 'v_tip_kms');
        if (mr) {
          rows.push(makeRow(c, pair[1] + '.' + k, 'ratio', opt[k], { rung: pair[0], vTipKms: v, vSource: pair[1] + '.v_tip_kms', derate: Number(mr[1]) / 100, derateSource: 'key name "' + mr[1] + 'pct"', SF: c.SF, SFSource: 'SF', duplicate: true }));
        } else {
          var dr = c.derateFraction;
          var row = makeRow(c, pair[1] + '.' + k, 'mass', opt[k], { rung: pair[0], vTipKms: v, vSource: pair[1] + '.v_tip_kms', derate: dr, derateSource: 'materials.derate_fraction (the option is the 30 % case)', SF: c.SF, SFSource: 'SF', duplicate: true, payloadFromKey: Number(mm[1]) });
          rows.push(row);
        }
      });
    });
    return rows;
    function LBkey(k) {
      return c.ladderPath + '.' + k;
    }
  }

  function makeRow(c, key, kind, value, base) {
    var row = { key: key, kind: kind, canonValue: value };
    for (var b in base) row[b] = base[b];
    var mat = c.primary;
    row.material = mat.name;
    var missing = [];
    if (mat.refusal) missing = missing.concat(mat.refusal.missing || ['primary fibre']);
    if (row.vTipKms === undefined) missing.push('tip speed');
    if (row.SF === undefined) missing.push(c.SFKey);
    if (row.derate === undefined) missing.push('derate');
    if (kind === 'mass' && c.payloadKg === undefined) missing.push(c.payloadKey);
    if (missing.length) {
      row.status = 'refused';
      row.refusal = { code: 'insufficient_data', reason: 'Cannot recompute: rev_a.json lacks ' + missing.join(', ') + '.', whatWouldHelp: 'Restore the missing key(s) in params/rev_a.json.' };
      return row;
    }
    if (row.payloadFromKey !== undefined && row.payloadFromKey !== c.payloadKg) {
      row.note = 'Key name says ' + row.payloadFromKey + ' kg; payload_mass_kg_for_tonnage says ' + c.payloadKg + ' kg.';
    }
    var Vc = characteristicVelocityKms(mat.sigmaGPa, mat.rhoKgm3);
    var x = xParam(row.vTipKms, Vc, row.SF, row.derate);
    var ratio = massRatioOfX(x, 2);
    row.computed = kind === 'ratio' ? ratio : (ratio * c.payloadKg) / 1000;
    row.relErr = Math.abs(row.computed - value) / Math.abs(value);
    row.status = row.relErr <= BADGE_REL_TOL ? 'reproduces' : 'differs';
    return row;
  }

  // Values the file states at a stated precision: they reproduce when EQ-4 rounds to them.
  function readRounded(d, c) {
    var out = [];
    var mat = c.primary;
    if (mat.refusal) return out;
    var Vc = characteristicVelocityKms(mat.sigmaGPa, mat.rhoKgm3);
    function add(key, computed, what) {
      var v = num(d, key);
      if (v === undefined) return;
      var dp = decimalsOf(v);
      out.push({ key: key, canonValue: v, computed: computed, decimals: dp, what: what, status: roundTo(computed, dp) === v ? 'matches as rounded' : 'differs' });
    }
    add('materials.V_c_kms', Vc, 'EQ-4, sqrt(2σ/ρ), km/s');
    add('materials.specific_strength_MJkg', mat.sigmaGPa * 1e9 / mat.rhoKgm3 / 1e6, 'σ/ρ, MJ/kg');
    if (c.vRef !== undefined) add('mass_ratio.tip_speed_to_Vc_ratio', c.vRef / Vc, 'reference v_tip / V_c');
    return out;
  }

  // ── Quoted history, re-derived ─────────────────────────────────────────────────────────
  // Each quote is copied verbatim from the snapshot at the cited line (taper.test.mjs checks
  // that). Inputs a claim states in its own words (its tip speed, its SF, its "440×") are the
  // claim's; everything else (strength, density, the canon SF and derate) is read from the canon.
  // CLAIMS:begin (quoted text and the claims' own stated inputs; the only numbers typed here)
  var CLAIMS = [
    {
      id: 'audit360', file: 'docs/DECISION_LOG.md', line: 10, item: 'item 1',
      quote: 'EQ-5 at SF 2.5 with 30% derate gave ~360× per arm at the then-reference 3.5 km/s',
      quoted: [{ text: '~360', value: 360 }],
      inputs: { vTipKms: 3.5 }
    },
    {
      id: 'audit440', file: 'docs/DECISION_LOG.md', line: 10, item: 'item 1',
      quote: '440× would require a 23.64% derate (or SF 3.274 at zero derate)',
      quoted: [{ text: '23.64%', value: 23.64 }, { text: '3.274', value: 3.274 }],
      inputs: { vTipKms: 3.5, target: 440, derateForSF: 0 }
    },
    {
      id: 'ghost440', file: 'docs/DECISION_LOG.md', line: 12, item: 'item 1 addendum',
      quote: '`integrated_mass_ratio(3.5, Vc=2.7269, SF=2.5, derate=0.0)` = **440.3996× ≈ 440.40×**',
      quoted: [{ text: '440.3996', value: 440.3996 }],
      inputs: { vTipKms: 3.5, derate: 0 }
    },
    {
      id: 'log20', file: 'docs/DECISION_LOG.md', line: 20, item: 'item 2',
      quote: 'peak area taper is ~8.2 (no derate)',
      quoted: [{ text: '~8.2', value: 8.2 }],
      inputs: { derate: 0 }
    },
    {
      id: 'gloss48', file: 'docs/glossary.md', line: 48, item: '"Taper ratio"',
      quote: 'peak area taper ~= 8.2; with 30% strength derate it is ~=20.1',
      quoted: [{ text: '8.2', value: 8.2 }, { text: '20.1', value: 20.1 }],
      inputs: {}
    },
    {
      id: 'creep72', file: 'docs/DECISION_LOG.md', line: 72, item: 'item 10',
      quote: 'Reaching 20% sustained load would require SF ≈ 5, which cuts characteristic velocity by √2 and drives the 2.5 km/s reference mass ratio from ~41× to order ~800× under the Moravec form.',
      quoted: [{ text: '~41×', value: 41 }, { text: '~800×', value: 800 }],
      inputs: { SF: 5, derate: 0 }
    }
  ];
  // CLAIMS:end

  function sigFigs(text) {
    var digits = text.replace(/[^0-9.]/g, '');
    var noDot = digits.replace('.', '').replace(/^0+/, '');
    if (digits.indexOf('.') < 0) noDot = noDot.replace(/0+$/, '');
    return Math.max(1, noDot.length);
  }
  function roundSig(v, s) {
    if (v === 0) return 0;
    var e = Math.floor(Math.log10(Math.abs(v))) - s + 1;
    var f = Math.pow(10, e);
    return Math.round(v / f) * f;
  }
  // "exact": rounds to the quoted figure at its own precision; "close": within CLOSE_FRACTION;
  // otherwise "does not reproduce".
  function verdict(computed, q) {
    var s = sigFigs(q.text);
    var r = roundSig(computed, s);
    if (Math.abs(r - q.value) <= 1e-9 * Math.max(1, Math.abs(q.value))) return 'exact';
    if (Math.abs(computed - q.value) <= CLOSE_FRACTION * Math.abs(q.value)) return 'close';
    return 'no';
  }

  function checkClaims(c) {
    if (!c || !c.ok) return [];
    var mat = c.primary;
    if (mat.refusal || c.SF === undefined) {
      return CLAIMS.map(function (cl) { return { claim: cl, status: 'refused', results: [] }; });
    }
    var Vc = characteristicVelocityKms(mat.sigmaGPa, mat.rhoKgm3);
    var SF = c.SF;
    var dr = c.derateFraction;
    var vRef = c.vRef;
    return CLAIMS.map(function (cl) {
      var res = [];
      var i = cl.inputs;
      if (cl.id === 'audit360') {
        var t = taperOfX(xParam(i.vTipKms, Vc, SF, dr));
        res.push({ q: cl.quoted[0], computed: t, how: 'EQ-5 at ' + i.vTipKms + ' km/s, SF ' + SF + ', ' + pct(dr) + ' derate' });
      } else if (cl.id === 'audit440') {
        res.push({ q: cl.quoted[0], computed: 100 * derateForTaperTarget(i.target, i.vTipKms, Vc, SF, 2), how: 'derate at which 2 arms × EQ-5 = ' + i.target + ' (SF ' + SF + ')' });
        res.push({ q: cl.quoted[1], computed: sfForTaperTarget(i.target, i.vTipKms, Vc, i.derateForSF, 2), how: 'SF at which 2 arms × EQ-5 = ' + i.target + ' (' + pct(i.derateForSF) + ' derate)' });
      } else if (cl.id === 'ghost440') {
        res.push({ q: cl.quoted[0], computed: massRatioOfX(xParam(i.vTipKms, Vc, SF, i.derate), 2), how: 'EQ-6 at ' + i.vTipKms + ' km/s, SF ' + SF + ', 0 % derate', decimals: 4 });
      } else if (cl.id === 'log20') {
        res.push({ q: cl.quoted[0], computed: taperOfX(xParam(vRef, Vc, SF, 0)), how: 'EQ-5 at ' + vRef + ' km/s, SF ' + SF + ', no derate' });
      } else if (cl.id === 'gloss48') {
        res.push({ q: cl.quoted[0], computed: taperOfX(xParam(vRef, Vc, SF, 0)), how: 'EQ-5, no derate' });
        res.push({ q: cl.quoted[1], computed: taperOfX(xParam(vRef, Vc, SF, dr)), how: 'EQ-5 at ' + pct(dr) + ' derate' });
      } else if (cl.id === 'creep72') {
        res.push({ q: cl.quoted[0], computed: massRatioOfX(xParam(vRef, Vc, SF, i.derate), 2), how: 'EQ-6 at ' + vRef + ' km/s, SF ' + SF + ', ' + pct(i.derate) + ' derate' });
        // The reference rungs' derates (0 %, 15 %, 30 % at 34935cb), read from the ladder's key names.
        var seen = {};
        var alts = [];
        (c.ladder || []).forEach(function (r) {
          if (r.kind === 'ratio' && !r.duplicate && r.vSource === 'reference_v_tip_kms' && r.derate !== undefined && !seen[r.derate]) {
            seen[r.derate] = true;
            alts.push({ derate: r.derate, value: massRatioOfX(xParam(vRef, Vc, i.SF, r.derate), 2) });
          }
        });
        alts.sort(function (a, b) { return a.derate - b.derate; });
        res.push({ q: cl.quoted[1], computed: massRatioOfX(xParam(vRef, Vc, i.SF, i.derate), 2), how: 'EQ-6 at SF ' + i.SF + ', ' + pct(i.derate) + ' derate (like for like with ' + cl.quoted[0].text + ')', alternatives: alts });
      }
      res.forEach(function (r) { r.verdict = verdict(r.computed, r.q); });
      var worst = res.some(function (r) { return r.verdict === 'no'; }) ? 'no' : res.some(function (r) { return r.verdict === 'close'; }) ? 'close' : 'exact';
      return { claim: cl, status: worst, results: res };
    });
  }
  function pct(f) {
    return Math.round(f * 1000) / 10 + ' %';
  }

  // ── Small helpers the page uses ────────────────────────────────────────────────────────
  // Log-axis decades covering [lo, hi].
  function logDomain(lo, hi) {
    var a = Math.floor(Math.log10(lo));
    var b = Math.ceil(Math.log10(hi));
    if (b - a < 2) b = a + 2;
    return [a, b];
  }
  function fmtRatio(v) {
    if (!isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a < 1) return v.toPrecision(3);
    if (a < 1e6) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var e = Math.floor(Math.log10(a));
    var m = v / Math.pow(10, e);
    return m.toFixed(2) + ' × 10^' + e;
  }

  return {
    SQRT_PI: SQRT_PI,
    BADGE_REL_TOL: BADGE_REL_TOL,
    CLOSE_FRACTION: CLOSE_FRACTION,
    erf: erf,
    erfAS: erfAS,
    characteristicVelocityKms: characteristicVelocityKms,
    xParam: xParam,
    taperOfX: taperOfX,
    massRatioOfX: massRatioOfX,
    gapOfX: gapOfX,
    meanAreaOfX: meanAreaOfX,
    profile: profile,
    crossoverX: crossoverX,
    derateForTaperTarget: derateForTaperTarget,
    sfForTaperTarget: sfForTaperTarget,
    evaluate: evaluate,
    readCanon: readCanon,
    checkClaims: checkClaims,
    CLAIMS: CLAIMS,
    sigFigs: sigFigs,
    roundSig: roundSig,
    verdict: verdict,
    logDomain: logDomain,
    fmtRatio: fmtRatio,
    get: get
  };
});
