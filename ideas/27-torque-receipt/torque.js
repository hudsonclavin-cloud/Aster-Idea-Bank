/* Torque Receipt — the pure kernel. No DOM, no clock, no randomness.
 *
 * What a tightening torque actually promises for one bolt, worked from PartForge's own tables:
 *   preload        F = T / (K d)               (fasteners_metric design_rules.preload_and_torque,
 *                                               or fasteners_un notes (6) for inch sizes)
 *   scatter        F (1 - u) .. F (1 + u)      (design_factors_nasa preload_uncertainty_*: u = 0.25
 *                                               lubricated at assembly, 0.35 otherwise)
 *   target         0.65-0.75 x proof load      (the same design rule)
 *   bolt stress    sigma = F / As              vs proof, yield and UTS (fasteners_metric grades,
 *                                               or fasteners_un notes (7) for SAE J429 grades 5 / 8)
 *   in service     (F_max + F_ext) / As        no joint-stiffness credit (C = 1): an upper bound
 *   protrusion     L - (stack + washers + nut) vs 2 p   (design_factors_nasa fastener_protrusion_min)
 *   strip          PartForge's own threadCheck(), cut verbatim from index.html
 * Every number a caller shows comes back with the table, field and confidence it came from.
 * Every verdict is COMPUTED: a torque-derived preload is not evidence (fasteners_metric: "do not
 * rely on torque alone for a pressure boundary"), so nothing here ever says PASS.
 *
 * Loads as a classic script (window.TorqueReceipt) and with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TorqueReceipt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Unit definitions, exact by definition (international yard and pound, 1959; standard gravity,
  // 3rd CGPM 1901). Used only to print an inch-pound torque beside the N·m one.
  var LBF_N = 0.45359237 * 9.80665;
  var IN_M = 0.0254;
  var NM_PER_LBFIN = LBF_N * IN_M;

  function must(m, what) {
    if (!m) throw new Error('Torque Receipt could not read ' + what + ' from the snapshot; the source text has changed. Re-run build-data.mjs and re-read the parser.');
    return m;
  }
  function num(s) { return parseFloat(s); }

  /* ------------------------------------------------------------------------------------------
   * Context: everything parsed once from the snapshots. Numbers are READ from the tables' own
   * text (fields, column descriptions, design-rule sentences, usage notes), never retyped here.
   * ---------------------------------------------------------------------------------------- */
  function makeContext(data) {
    var metric = data.fasteners_metric.json;
    var nasa = data.design_factors_nasa.json;
    var un = data.fasteners_un;
    var code = data.code;
    var ctx = { metric: metric, nasa: nasa, un: un, code: code, data: data };

    // fasteners_metric design rule, quoted.
    var rule = metric.design_rules.preload_and_torque;
    ctx.metricRule = rule;
    var mk = must(/K = ([\d.]+) plain dry, ([\d.]+)-([\d.]+) lubricated or zinc-plated, ~([\d.]+) with anti-seize/.exec(rule.rule), 'the nut factors in design_rules.preload_and_torque');
    var mb = must(/Target preload F = ([\d.]+)-([\d.]+) x proof load/.exec(rule.rule), 'the target band in design_rules.preload_and_torque');
    var ms = must(/Torque scatter is \+\/-(\d+)%/.exec(rule.rule), 'the torque scatter sentence in design_rules.preload_and_torque');
    ctx.band = { lo: num(mb[1]), hi: num(mb[2]), quote: mb[0], src: 'fasteners_metric.json design_rules.preload_and_torque [' + rule.confidence + ']' };
    ctx.ruleScatter = num(ms[1]) / 100;
    ctx.metricK = {
      dry: { lo: num(mk[1]), hi: num(mk[1]), quote: 'K = ' + mk[1] + ' plain dry' },
      plated: { lo: num(mk[2]), hi: num(mk[3]), quote: mk[2] + '-' + mk[3] + ' lubricated or zinc-plated' },
      lubricated: { lo: num(mk[2]), hi: num(mk[3]), quote: mk[2] + '-' + mk[3] + ' lubricated or zinc-plated' },
      antiseize: { lo: num(mk[4]), hi: num(mk[4]), quote: '~' + mk[4] + ' with anti-seize' },
    };
    // The torque guide column's own definition: "T = K F d with K = 0.20 and F = 0.7 x proof load".
    var mg = must(/T = K F d with K = ([\d.]+) and F = ([\d.]+) x proof load/.exec(metric.columns.torque_guide_8_8_dry_Nm), 'the torque_guide_8_8_dry_Nm column definition');
    ctx.guide = { K: num(mg[1]), frac: num(mg[2]), quote: mg[0] };

    // fasteners_un usage notes (6) and (7), quoted.
    var n6 = un.notes_paragraphs['6'], n7 = un.notes_paragraphs['7'];
    var uk = must(/K = ([\d.]+) plain\/black-oxide steel dry, ([\d.]+)-([\d.]+) lubricated or waxed, ([\d.]+)-([\d.]+) with moly, ([\d.]+)-([\d.]+) stainless-on-stainless dry/.exec(n6), 'the nut factors in fasteners_un notes (6)');
    ctx.unK = {
      dry: { lo: num(uk[1]), hi: num(uk[1]), quote: 'K = ' + uk[1] + ' plain/black-oxide steel dry' },
      lubricated: { lo: num(uk[2]), hi: num(uk[3]), quote: uk[2] + '-' + uk[3] + ' lubricated or waxed' },
      moly: { lo: num(uk[4]), hi: num(uk[5]), quote: uk[4] + '-' + uk[5] + ' with moly' },
    };
    ctx.stainlessDryK = { lo: num(uk[6]), hi: num(uk[7]), quote: uk[6] + '-' + uk[7] + ' stainless-on-stainless dry' };
    ctx.unKLabel = /\(K values: (\w+)\)/.test(n6) ? /\(K values: (\w+)\)/.exec(n6)[1] : 'unlabelled';
    var g5 = must(/SAE J429 grade 5, 1\/4-1 in: proof \d+ ksi \((\d+) MPa\), yield \d+ \((\d+)\), UTS \d+ \((\d+)\)[^\[]*\[(\w+), ([^\]]+)\]/.exec(n7), 'SAE J429 grade 5 in fasteners_un notes (7)');
    var g8 = must(/SAE J429 grade 8, 1\/4-1-1\/2 in: proof \d+ \((\d+)\), yield \d+ \((\d+)\), UTS \d+ \((\d+)\)[^\[]*\[(\w+), ([^\]]+)\]/.exec(n7), 'SAE J429 grade 8 in fasteners_un notes (7)');
    var gs = must(/J429 grades start at 1\/4 in; #2-#12 machine screws are NOT graded to J429/.exec(n7), 'the J429 size floor in fasteners_un notes (7)');
    ctx.unGrades = {
      'J429-5': { proof_MPa: num(g5[1]), yield_MPa: num(g5[2]), uts_MPa: num(g5[3]), confidence: g5[4], source: g5[5] + ' (fasteners_un.json notes (7), prose, not a column)', minD_in: 0.25, maxD_in: 1, label: 'SAE J429 grade 5' },
      'J429-8': { proof_MPa: num(g8[1]), yield_MPa: num(g8[2]), uts_MPa: num(g8[3]), confidence: g8[4], source: g8[5] + ' (fasteners_un.json notes (7), prose, not a column)', minD_in: 0.25, maxD_in: 1.5, label: 'SAE J429 grade 8' },
    };
    ctx.unGradeFloorQuote = gs[0];

    // design_factors_nasa rows.
    var row = function (k) { for (var i = 0; i < nasa.rows.length; i++) if (nasa.rows[i].key === k) return nasa.rows[i]; return null; };
    ctx.uLub = must(row('preload_uncertainty_lubricated'), 'preload_uncertainty_lubricated');
    ctx.uDry = must(row('preload_uncertainty_as_received'), 'preload_uncertainty_as_received');
    ctx.protrusionRow = must(row('fastener_protrusion_min'), 'fastener_protrusion_min');
    ctx.tmWithheld = (nasa.reconciliation.withheld || []).filter(function (s) { return /TM-106943/.test(s); })[0] || null;
    return ctx;
  }

  /* ------------------------------------------------------------------------------------------
   * Sizes, grades, conditions.
   * ---------------------------------------------------------------------------------------- */
  function sizes(ctx) {
    var out = [];
    ctx.metric.rows.forEach(function (r) { out.push({ key: r.key, system: 'metric', label: r.key + '×' + r.pitch_mm }); });
    ctx.un.rows.forEach(function (r) { out.push({ key: r.key, system: 'un', label: r.key + ' ' + r.series }); });
    return out;
  }

  function findSize(ctx, key) {
    var k = String(key || '').trim();
    for (var i = 0; i < ctx.metric.rows.length; i++) {
      var r = ctx.metric.rows[i];
      if (r.key.toLowerCase() === k.toLowerCase()) {
        return { system: 'metric', key: r.key, row: r, d_mm: r.d_mm, p_mm: r.pitch_mm, As_mm2: r.tensile_stress_area_mm2,
          asSrc: 'fasteners_metric.json ' + r.key + '.tensile_stress_area_mm2 [' + fieldConf(r, 'tensile_stress_area_mm2', ctx.metric) + ']',
          dSrc: 'fasteners_metric.json ' + r.key + '.d_mm, .pitch_mm [' + fieldConf(r, 'd_mm', ctx.metric) + ']' };
      }
    }
    for (var j = 0; j < ctx.un.rows.length; j++) {
      var u = ctx.un.rows[j];
      if (u.key.toLowerCase() === k.toLowerCase().replace(/^no\.?\s*/, '#')) {
        return { system: 'un', key: u.key, row: u, d_mm: u.major_mm, D_in: u.major_in, p_mm: u.pitch_mm, As_mm2: u.tensile_stress_area_mm2,
          asSrc: 'fasteners_un.json ' + u.key + '.tensile_stress_area_mm2 [' + (u.field_confidence.tensile_stress_area_mm2 || u.confidence) + ']',
          dSrc: 'fasteners_un.json ' + u.key + '.major_mm, .pitch_mm [' + (u.field_confidence.major_mm || u.confidence) + ']' };
      }
    }
    return null;
  }

  // A field's confidence in fasteners_metric: its own field_confidence entry, else the row label
  // for a core field, else "unlabelled" (the column contract says every non-core field has its own).
  function fieldConf(row, field, table) {
    if (row.field_confidence && row.field_confidence[field]) return row.field_confidence[field];
    if (table.core_fields && table.core_fields.indexOf(field) >= 0) return row.confidence;
    return 'unlabelled';
  }

  function gradesFor(ctx, size) {
    if (!size) return [];
    if (size.system === 'metric') {
      return Object.keys(ctx.metric.grades).filter(function (g) { return ctx.metric.grades[g] && typeof ctx.metric.grades[g] === 'object'; })
        .map(function (g) { return { key: g, label: 'ISO ' + (/^A/.test(g) ? '3506-1 ' : '898-1 ') + g }; })
        .concat([{ key: 'declared', label: 'declare proof / yield / UTS' }]);
    }
    return Object.keys(ctx.unGrades).map(function (g) { return { key: g, label: ctx.unGrades[g].label }; })
      .concat([{ key: 'declared', label: 'declare proof / yield / UTS' }]);
  }

  function conditionsFor(size) {
    if (size && size.system === 'un') {
      return [
        { key: 'dry', label: 'dry, as received', lubricated: false },
        { key: 'lubricated', label: 'lubricated or waxed at assembly', lubricated: true },
        { key: 'moly', label: 'moly at assembly', lubricated: true },
        { key: 'declared', label: 'declare K' },
      ];
    }
    return [
      { key: 'dry', label: 'plain, dry, as received', lubricated: false },
      { key: 'plated', label: 'zinc-plated, as received', lubricated: false },
      { key: 'lubricated', label: 'lubricated at assembly', lubricated: true },
      { key: 'antiseize', label: 'anti-seize at assembly', lubricated: true },
      { key: 'declared', label: 'declare K' },
    ];
  }

  function refusal(code, reason, help, missing) {
    return { code: code, reason: reason, what_would_help: help, missing: missing || [] };
  }

  function resolveGrade(ctx, size, input) {
    var g = String(input.grade || '').trim();
    if (!g) return { refusal: refusal('insufficient_data', 'No bolt grade was given. A grade decides proof, yield and UTS; assuming one overstates a weaker bolt.', 'Pick the grade stamped on the head, or declare proof, yield and UTS with their source.', ['grade']) };
    if (g === 'declared') {
      var d = input.declared || {};
      var p = +d.proof_MPa, y = +d.yield_MPa, u = +d.uts_MPa, s = String(d.source || '').trim();
      var miss = [];
      if (!(p > 0)) miss.push('proof_MPa'); if (!(y > 0)) miss.push('yield_MPa'); if (!(u > 0)) miss.push('uts_MPa'); if (!s) miss.push('source');
      if (miss.length) return { refusal: refusal('insufficient_data', 'A declared grade needs a positive proof, yield and UTS and the document they came from (' + miss.join(', ') + ' missing).', 'Give all three strengths in MPa and name the standard or certificate, e.g. "ASTM F837 CW, vendor cert 1234".', miss) };
      if (!(p <= y && y <= u)) return { refusal: refusal('out_of_envelope', 'Proof ' + p + ' ≤ yield ' + y + ' ≤ UTS ' + u + ' does not hold, so these are not one fastener\'s properties.', 'Check which number is which: proof is the lowest, UTS the highest.', ['proof_MPa', 'yield_MPa', 'uts_MPa']) };
      return { grade: { key: 'declared', label: 'declared', proof_MPa: p, yield_MPa: y, uts_MPa: u, confidence: 'user', source: 'declared by the user: ' + s,
        proofLoad_N: p * size.As_mm2, proofLoadSrc: 'computed: declared proof ' + p + ' MPa × As ' + size.As_mm2 + ' mm²' } };
    }
    if (size.system === 'metric') {
      var G = ctx.metric.grades[g];
      if (!G || typeof G !== 'object') {
        var known = Object.keys(ctx.metric.grades).filter(function (k) { return typeof ctx.metric.grades[k] === 'object'; });
        return { refusal: refusal('not_found', 'Grade "' + g + '" is not in fasteners_metric.json grades (' + known.join(', ') + ').', 'Use one of those, or declare proof, yield and UTS with their source.', ['grade']) };
      }
      var gr = { key: g, label: 'ISO ' + (/^A/.test(g) ? '3506-1 ' : '898-1 ') + g, proof_MPa: G.proof_MPa, yield_MPa: G.yield_MPa, uts_MPa: G.uts_MPa, confidence: G.confidence,
        source: 'fasteners_metric.json grades["' + g + '"] (' + G.source + ')', note: G.note || '' };
      if (g === '8.8' && size.d_mm > 16) {
        var m = /For d > 16 mm \(M20 here\) ISO 898-1 gives proof (\d+), yield (\d+), UTS (\d+)/.exec(G.note || '');
        if (!m) return { refusal: refusal('insufficient_data', 'Grade 8.8 above 16 mm needs the larger-size properties, and the table note that carries them could not be read.', 'Declare proof, yield and UTS for 8.8 above M16 with their source.', ['grade']) };
        gr.proof_MPa = num(m[1]); gr.yield_MPa = num(m[2]); gr.uts_MPa = num(m[3]);
        gr.source += ', d > 16 mm values from its note';
      }
      // Proof load on the stress basis, As x proof stress, so that F / F_proof = sigma / proof
      // everywhere on the receipt. The table's own proof_load column (3 sf) rides along as a
      // cross-check; torque_guide_8_8_dry_Nm was built from As x Sp too (see guideTable).
      gr.proofLoad_N = gr.proof_MPa * size.As_mm2;
      gr.proofLoadSrc = 'computed: proof ' + gr.proof_MPa + ' MPa × As ' + size.As_mm2 + ' mm²';
      var col = 'proof_load_' + g.replace(/[.\-]/g, '_') + '_N';
      if (size.row[col] != null) gr.proofLoadColumn = { N: size.row[col], field: col, src: 'fasteners_metric.json ' + size.key + '.' + col + ' [' + fieldConf(size.row, col, ctx.metric) + ']' };
      return { grade: gr };
    }
    var U = ctx.unGrades[g];
    if (!U) return { refusal: refusal('not_found', 'Grade "' + g + '" has no strengths in fasteners_un.json. The table has no proof column; its notes (7) give SAE J429 grades 5 and 8 only, and A574 and F837 proof values there are recall.', 'Use J429-5 or J429-8 (1/4 in and up), or declare proof, yield and UTS with their source.', ['grade']) };
    if (size.D_in < U.minD_in - 1e-9 || size.D_in > U.maxD_in + 1e-9) return { refusal: refusal('out_of_envelope', size.key + ' is outside ' + U.label + '\'s size range. fasteners_un notes (7): "' + ctx.unGradeFloorQuote + '".', 'Declare proof, yield and UTS for this screw from its certificate or standard.', ['grade']) };
    return { grade: { key: g, label: U.label, proof_MPa: U.proof_MPa, yield_MPa: U.yield_MPa, uts_MPa: U.uts_MPa, confidence: U.confidence, source: U.source,
      proofLoad_N: U.proof_MPa * size.As_mm2, proofLoadSrc: 'computed: proof ' + U.proof_MPa + ' MPa × As ' + size.As_mm2 + ' mm² (fasteners_un has no proof-load column)' } };
  }

  // Nut factor K and preload uncertainty u for a condition.
  function resolveTightening(ctx, size, grade, input) {
    var c = String(input.condition || '').trim();
    var conds = conditionsFor(size);
    var cond = conds.filter(function (x) { return x.key === c; })[0];
    if (!cond) return { refusal: refusal('not_found', 'Condition "' + c + '" is not one this tool reads a nut factor for (' + conds.map(function (x) { return x.key; }).join(', ') + ').', size.system === 'un' && c === 'plated' ? 'fasteners_un notes (6) give no zinc-plated K; declare K with its source.' : 'Pick one of those, or declare K with its source.', ['condition']) };
    var Kr, kSrc, kLabel;
    if (c === 'declared') {
      var K = +input.K, ks = String(input.K_source || '').trim();
      var miss = []; if (!(K > 0)) miss.push('K'); if (!ks) miss.push('K_source');
      if (miss.length) return { refusal: refusal('insufficient_data', 'A declared nut factor needs a positive K and where it came from (' + miss.join(', ') + ' missing).', 'Give K and its source (a torque-tension test of this batch is the only real one).', miss) };
      if (!(input.lubricated === true || input.lubricated === false)) return { refusal: refusal('insufficient_data', 'A declared K still needs to say whether the threads are lubricated at assembly: that picks the ±25 % or ±35 % scatter row.', 'Say lubricated or not.', ['lubricated']) };
      Kr = { lo: K, hi: K, quote: 'declared K = ' + K };
      kSrc = 'declared by the user: ' + ks; kLabel = 'user';
      cond = { key: 'declared', label: 'declared K', lubricated: !!input.lubricated };
    } else if (size.system === 'metric') {
      Kr = ctx.metricK[c]; kSrc = 'fasteners_metric.json design_rules.preload_and_torque: "' + Kr.quote + '"'; kLabel = ctx.metricRule.confidence;
    } else {
      Kr = ctx.unK[c]; kSrc = 'fasteners_un.json notes (6): "' + Kr.quote + '"'; kLabel = ctx.unKLabel;
    }
    var pick = String(input.K_pick || 'mid');
    if (!/^(low|mid|high)$/.test(pick)) pick = 'mid';
    var Kused = pick === 'low' ? Kr.lo : pick === 'high' ? Kr.hi : round((Kr.lo + Kr.hi) / 2, 10);
    var urow = cond.lubricated ? ctx.uLub : ctx.uDry;
    var notes = [];
    if (size.system === 'metric' && /^A/.test(grade.key) && c === 'dry') {
      notes.push('Stainless on stainless, dry: fasteners_un notes (6) give K ' + ctx.stainlessDryK.quote.replace(' stainless-on-stainless dry', '') + ' (stainless-on-stainless dry); fasteners_metric gives no stainless K, so the plain-steel ' + Kr.lo.toFixed(2) + ' is used. A higher real K means LESS preload than shown.');
    }
    return { tightening: { condition: cond, K: Kused, Krange: Kr, Kpick: Kr.lo === Kr.hi ? 'single' : pick, Ksrc: kSrc, Kconf: kLabel,
      u: urow.preload_uncertainty, uRow: urow, uSrc: 'design_factors_nasa.json ' + urow.key + ' (' + urow.clause + ') [' + urow.confidence + ']', notes: notes } };
  }

  /* ------------------------------------------------------------------------------------------
   * The receipt.
   * ---------------------------------------------------------------------------------------- */
  function classifyStress(sigma, g) {
    if (sigma > g.uts_MPa) return { state: 'over', word: 'past UTS' };
    if (sigma > g.yield_MPa) return { state: 'over', word: 'past yield' };
    if (sigma > g.proof_MPa) return { state: 'over', word: 'past proof' };
    return { state: 'ok', word: 'within proof' };
  }

  function stressBlock(F, size, g) {
    var s = F / size.As_mm2;
    var c = classifyStress(s, g);
    return { F_N: F, sigma_MPa: s, sf_proof: g.proof_MPa / s, sf_yield: g.yield_MPa / s, sf_uts: g.uts_MPa / s, state: c.state, word: c.word };
  }

  function receipt(ctx, input) {
    input = input || {};
    var size = findSize(ctx, input.size);
    if (!size) {
      return { ok: false, refusal: refusal('not_found', 'Size "' + String(input.size || '') + '" is not a row of fasteners_metric.json or fasteners_un.json.', 'Pick one of: ' + sizes(ctx).map(function (s) { return s.key; }).join(', ') + '.', ['size']) };
    }
    var gr = resolveGrade(ctx, size, input);
    if (gr.refusal) return { ok: false, size: size, refusal: gr.refusal };
    var g = gr.grade;
    var tt = resolveTightening(ctx, size, g, input);
    if (tt.refusal) return { ok: false, size: size, grade: g, refusal: tt.refusal };
    var t = tt.tightening;
    var d_m = size.d_mm / 1000;
    var out = { ok: true, size: size, grade: g, tightening: t, sections: {} };
    var S = out.sections;

    // Torque window: needs no torque, so it survives "tightened by feel".
    var Tfor = function (frac) { return t.K * frac * g.proofLoad_N * d_m; };
    S.window = {
      status: 'computed', state: 'info',
      T_lo_Nm: Tfor(ctx.band.lo), T_mid_Nm: Tfor((ctx.band.lo + ctx.band.hi) / 2), T_hi_Nm: Tfor(ctx.band.hi),
      T_cap_Nm: t.K * (g.proofLoad_N / (1 + t.u)) * d_m,
      formula: 'T = K · f · F_proof · d, f = ' + ctx.band.lo + '–' + ctx.band.hi + '; cap: T at which F·(1 + u) = F_proof',
    };

    // Preload.
    var T = input.torque_Nm;
    var hasT = !input.byFeel && T !== null && T !== undefined && String(T).trim() !== '' && isFinite(+T) && +T > 0;
    var tq = null;
    if (input.byFeel) {
      tq = refusal('insufficient_data', 'Tightened by feel: there is no torque, so there is no preload to compute. design_factors_nasa.json ' + ctx.uLub.key + ': "' + ctx.uLub.note + '"', 'Tighten with a calibrated torque wrench to a stated torque, then enter it. The torque window above says what to set.', ['torque_Nm']);
    } else if (!hasT) {
      tq = (T !== null && T !== undefined && String(T).trim() !== '' && !(+T > 0))
        ? refusal('out_of_envelope', 'Torque must be a positive number of N·m (got "' + T + '").', 'Enter the torque the assembly instruction or the wrench setting gives.', ['torque_Nm'])
        : refusal('insufficient_data', 'No tightening torque was given, so there is no preload to compute.', 'Enter the torque the assembly instruction or the wrench setting gives. The torque window above says what to set.', ['torque_Nm']);
    }
    if (tq) {
      S.preload = { status: 'refused', refusal: tq };
      S.assembly = { status: 'refused', refusal: tq };
      S.service = { status: 'refused', refusal: tq };
    } else {
      T = +T;
      var Fn = T / (t.K * d_m);
      var Fmin = Fn * (1 - t.u), Fmax = Fn * (1 + t.u);
      var ratio = Fn / g.proofLoad_N;
      var pState = Fn > g.proofLoad_N ? 'over' : (ratio > ctx.band.hi + 1e-12 || ratio < ctx.band.lo - 1e-12) ? 'warn' : 'ok';
      var pWord = Fn > g.proofLoad_N ? 'nominal above proof' : ratio > ctx.band.hi + 1e-12 ? 'above the ' + ctx.band.lo + '–' + ctx.band.hi + ' target' : ratio < ctx.band.lo - 1e-12 ? 'below the ' + ctx.band.lo + '–' + ctx.band.hi + ' target' : 'inside the ' + ctx.band.lo + '–' + ctx.band.hi + ' target';
      var Ksens = null;
      if (t.Krange.lo !== t.Krange.hi) Ksens = { K_lo: t.Krange.lo, F_at_Klo: T / (t.Krange.lo * d_m), K_hi: t.Krange.hi, F_at_Khi: T / (t.Krange.hi * d_m) };
      S.preload = { status: 'computed', state: pState, word: pWord, T_Nm: T, F_nom_N: Fn, F_min_N: Fmin, F_max_N: Fmax, ratio_proof: ratio, Ksens: Ksens,
        T_lbfin: size.system === 'un' ? T / NM_PER_LBFIN : null,
        formula: 'F = T / (K · d) = ' + T + ' / (' + round(t.K, 4) + ' × ' + size.d_mm / 1000 + ' m); band F·(1 ∓ ' + t.u + ')' };
      var asm = stressBlock(Fmax, size, g);
      asm.status = 'computed';
      asm.formula = 'σ = F_max / As';
      S.assembly = asm;
      var Fe = input.Fext_N;
      var hasFe = Fe !== null && Fe !== undefined && String(Fe).trim() !== '' && isFinite(+Fe);
      if (!hasFe) {
        S.service = { status: 'refused', refusal: refusal('insufficient_data', 'No external load per bolt was declared, so the in-service line is not computed. Enter 0 if the joint carries none.', 'Give the axial load each bolt carries (total ÷ bolt count) and where it came from.', ['Fext_N']) };
      } else if (+Fe < 0) {
        S.service = { status: 'refused', refusal: refusal('out_of_envelope', 'An external load per bolt below zero is not a tension load (got ' + Fe + ' N).', 'Enter the axial tension per bolt as a positive number, or 0.', ['Fext_N']) };
      } else {
        var svc = stressBlock(Fmax + (+Fe), size, g);
        svc.status = 'computed';
        svc.Fext_N = +Fe;
        svc.FextSrc = String(input.Fext_source || '').trim() || 'user, no source given';
        svc.sigma_ext_only_MPa = (+Fe) / size.As_mm2;
        svc.boundWord = svc.word;
        svc.word = 'upper bound ' + svc.word;
        svc.formula = 'σ = (F_max + F_ext) / As, no joint-stiffness credit (C = 1): an upper bound on the bolt load before the joint separates';
        S.service = svc;
      }
    }

    // Joint: nut (protrusion) or tapped (engagement and strip).
    var joint = String(input.joint || 'nut');
    if (joint === 'nut') S.protrusion = protrusion(ctx, size, input);
    else if (joint === 'tapped') S.engagement = engagement(ctx, size, g, input, S);
    else S.joint = { status: 'na', note: 'No joint geometry given.' };

    // Notes that ride on the receipt.
    out.notes = t.notes.slice();
    out.notes.push('fasteners_metric.json design_rules.preload_and_torque: "' + /do not rely on torque alone for a pressure boundary/.exec(ctx.metricRule.rule)[0] + '." Every line here is COMPUTED, never PASS.');
    out.headline = headline(out);
    return out;
  }

  function nutFor(ctx, size, input) {
    var type = String(input.nut || (size.system === 'un' ? 'hex' : 'iso4032'));
    if (type === 'declared') {
      var h = +input.nut_h_mm, s = String(input.nut_h_source || '').trim();
      if (!(h > 0) || !s) return { refusal: refusal('insufficient_data', 'A declared nut height needs a positive value and its source.', 'Measure the nut or quote its standard.', ['nut_h_mm', 'nut_h_source']) };
      return { h: h, src: 'declared: ' + s, conf: 'user', label: 'declared nut' };
    }
    if (size.system === 'metric') {
      var map = { iso4032: ['nut_h_mm', 'ISO 4032 hex nut, m max'], nyloc: ['locknut_h_mm', 'nylon-insert nut, height max'], jam: ['jam_nut_h_mm', 'ISO 4035 jam nut, m max'] };
      var m = map[type];
      if (!m) return { refusal: refusal('not_found', 'Nut type "' + type + '" is not one the metric table has (iso4032, nyloc, jam).', 'Pick one, or declare the height.', ['nut']) };
      var v = size.row[m[0]];
      if (v == null) return { refusal: refusal('insufficient_data', 'fasteners_metric.json has no ' + m[0] + ' for ' + size.key + ' (null).', 'Declare the nut height with its source.', ['nut_h_mm']) };
      return { h: v, src: 'fasteners_metric.json ' + size.key + '.' + m[0], conf: fieldConf(size.row, m[0], ctx.metric), label: m[1] };
    }
    if (type !== 'hex') return { refusal: refusal('not_found', 'Nut type "' + type + '" is not one the inch table has (hex).', 'Pick hex, or declare the height.', ['nut']) };
    var n = size.row.related_hardware && size.row.related_hardware.nut;
    if (!n || n.thickness_mm == null) return { refusal: refusal('insufficient_data', 'fasteners_un.json has no nut thickness for ' + size.key + '.', 'Declare the nut height with its source.', ['nut_h_mm']) };
    return { h: n.thickness_mm, src: 'fasteners_un.json ' + size.key + '.related_hardware.nut.thickness_mm (' + n.source + ')', conf: n.confidence, label: n.type };
  }

  function washerFor(ctx, size) {
    if (size.system === 'metric') return { t: size.row.washer_t_mm, src: 'fasteners_metric.json ' + size.key + '.washer_t_mm (ISO 7089)', conf: fieldConf(size.row, 'washer_t_mm', ctx.metric) };
    var w = size.row.related_hardware && size.row.related_hardware.flat_washer_type_a_narrow;
    if (!w || w.thickness_mm == null) return null;
    return { t: w.thickness_mm, src: 'fasteners_un.json ' + size.key + '.related_hardware.flat_washer_type_a_narrow.thickness_mm', conf: w.confidence };
  }

  function protrusion(ctx, size, input) {
    var L = input.screw_len_mm, st = input.stack_mm;
    var miss = [];
    if (!(+L > 0)) miss.push('screw_len_mm');
    if (!(+st > 0)) miss.push('stack_mm');
    if (miss.length) return { status: 'refused', refusal: refusal('insufficient_data', 'The protrusion check needs the screw length (under the head) and the clamped stack thickness (' + miss.join(', ') + ' missing).', 'Give both in mm. The stack is the parts between the washers, as drawn.', miss) };
    var nut = nutFor(ctx, size, input);
    if (nut.refusal) return { status: 'refused', refusal: nut.refusal };
    var nw = (input.washer_head ? 1 : 0) + (input.washer_nut ? 1 : 0);
    var w = nw ? washerFor(ctx, size) : null;
    if (nw && !w) return { status: 'refused', refusal: refusal('insufficient_data', 'No washer thickness in the table for ' + size.key + '.', 'Declare the washer thickness, or leave washers out.', ['washer']) };
    var wt = nw ? w.t : 0;
    var grip = +st + nw * wt;
    var prot = +L - grip - nut.h;
    var need = ctx.protrusionRow.protrusion_min_pitches * size.p_mm;
    var state = prot >= need - 1e-9 ? 'ok' : prot < 0 ? 'over' : 'warn';
    var word = prot >= need - 1e-9 ? 'at least ' + ctx.protrusionRow.protrusion_min_pitches + ' pitches past the nut' : prot < 0 ? 'the screw ends inside the nut' : 'short of ' + ctx.protrusionRow.protrusion_min_pitches + ' pitches';
    var recall = [nut.conf, w ? w.conf : null].filter(function (c) { return c === 'recall'; }).length > 0;
    return { status: 'computed', state: state, word: word, L_mm: +L, stack_mm: +st, washers: nw, washer_t_mm: wt, washerSrc: w ? w.src + ' [' + w.conf + ']' : null,
      nut_h_mm: nut.h, nutSrc: nut.src + ' [' + nut.conf + ']', nutLabel: nut.label, protrusion_mm: prot, need_mm: need, shortBy_mm: Math.max(0, need - prot),
      minLen_mm: grip + nut.h + need, recallInput: recall,
      rule: 'design_factors_nasa.json ' + ctx.protrusionRow.key + ' [' + ctx.protrusionRow.confidence + ']: "' + ctx.protrusionRow.quote + '"',
      formula: 'L − (stack + washers + nut) = ' + L + ' − (' + st + ' + ' + nw + ' × ' + wt + ' + ' + nut.h + ')' };
  }

  function engagement(ctx, size, g, input, S) {
    var Le = +input.engagement_mm;
    var matKey = String(input.material || '');
    var M = ctx.code.FLIGHT_MATERIALS[matKey];
    var miss = [];
    if (!(Le > 0)) miss.push('engagement_mm');
    if (!M) miss.push('material');
    if (miss.length) return { status: 'refused', refusal: refusal('insufficient_data', 'The strip check needs the thread engagement length and the tapped part\'s material from FLIGHT_MATERIALS (' + miss.join(', ') + ' missing).', 'Give the engaged thread length in mm and pick the tapped material.', miss) };
    if (M.kind !== 'metal') return { status: 'refused', refusal: refusal('out_of_envelope', M.name + ' is not a metal; threadCheck\'s shear model is for tapped metal.', 'Use a threaded insert and check the insert, or pick a metal.', ['material']) };
    var reach = null, notes = [];
    if (+input.screw_len_mm > 0 && +input.stack_mm > 0) {
      var nw = input.washer_head ? 1 : 0;
      var w = nw ? washerFor(ctx, size) : null;
      reach = +input.screw_len_mm - +input.stack_mm - (w ? w.t : 0);
      if (reach < Le - 1e-9) notes.push('The screw reaches only ' + round(reach, 2) + ' mm into the thread, less than the ' + Le + ' mm declared; the strip check uses ' + round(Math.max(reach, 0), 2) + ' mm.');
    }
    var LeUsed = reach !== null ? Math.max(0, Math.min(Le, reach)) : Le;
    if (!(LeUsed > 0)) return { status: 'refused', refusal: refusal('out_of_envelope', 'The screw does not reach the tapped thread (' + round(reach, 2) + ' mm).', 'Use a longer screw.', ['screw_len_mm']) };
    var label = size.system === 'metric' ? size.key : size.key;
    var tc = ctx.code.threadCheck({ size: label, engagement_mm: LeUsed, bolt_sigma_u_MPa: g.uts_MPa, internal_sigma_u_MPa: M.su, internal_material_class: ctx.code.matClass(M) });
    var res = { status: 'computed', Le_mm: LeUsed, Le_declared_mm: Le, reach_mm: reach, material: matKey, materialName: M.name, su_MPa: M.su, matClass: ctx.code.matClass(M), tc: tc, notes: notes,
      formula: 'PartForge threadCheck() (index.html, cut verbatim): F_strip = 0.5·σu,int · 0.5·π·d·Le vs F_bolt = At · UTS' };
    var worst = null;
    if (S.service && S.service.status === 'computed') worst = { F_N: S.service.F_N, what: 'F_max + F_ext' };
    else if (S.assembly && S.assembly.status === 'computed') worst = { F_N: S.assembly.F_N, what: 'F_max' };
    if (worst) { res.worst = worst; res.strip_over_worst = tc.F_strip_N / worst.F_N; }
    if (size.system === 'metric' && g.key === '8.8' && matKey === '6061-T6' && size.row.min_engagement_6061T6_8_8_mm != null) {
      res.tableMin = { mm: size.row.min_engagement_6061T6_8_8_mm, src: 'fasteners_metric.json ' + size.key + '.min_engagement_6061T6_8_8_mm [' + fieldConf(size.row, 'min_engagement_6061T6_8_8_mm', ctx.metric) + '] (add 1–2 pitches, per its column)' };
    }
    var bad = !(tc.ok_strip && tc.ok_rule) || (res.strip_over_worst != null && res.strip_over_worst < 1);
    res.state = bad ? 'warn' : 'ok';
    res.word = !tc.ok_strip ? 'strips before the bolt breaks' : !tc.ok_rule ? 'shorter than threadCheck\'s ' + tc.rule_multiple + 'd rule' : (res.strip_over_worst != null && res.strip_over_worst < 1) ? 'strip capacity below the worst-case bolt load' : 'bolt breaks before the thread strips';
    return res;
  }

  function headline(r) {
    var S = r.sections;
    if (S.preload.status !== 'computed') return { state: 'refused', text: 'No preload: ' + S.preload.refusal.reason.split('. ')[0] + '.' };
    var worst = [S.assembly, S.service, S.preload, S.protrusion, S.engagement].filter(function (s) { return s && s.status === 'computed'; });
    if (S.assembly.state === 'over') return { state: 'over', text: 'At the top of the scatter the bolt is ' + S.assembly.word + ' before any load is applied (σ ' + round(S.assembly.sigma_MPa, 1) + ' MPa, proof SF ' + S.assembly.sf_proof.toFixed(2) + ').' };
    if (S.service && S.service.status === 'computed' && S.service.state === 'over') return { state: 'over', text: 'The upper bound is ' + S.service.boundWord + ': the highest preload plus the full external load, with no joint-stiffness credit, gives σ ' + round(S.service.sigma_MPa, 1) + ' MPa. The bolt\'s real share of the load is smaller; settling it needs the joint diagram, which this tool does not build.' };
    var warn = worst.filter(function (s) { return s.state === 'warn' || s.state === 'over'; });
    if (warn.length) return { state: 'warn', text: 'No line exceeds proof, but: ' + warn.map(function (s) { return s.word; }).join('; ') + '.' };
    return { state: 'ok', text: 'No line exceeds proof and the nominal preload sits inside the target band. Computed, not passed.' };
  }

  /* ------------------------------------------------------------------------------------------
   * Reconciliations and the fixture.
   * ---------------------------------------------------------------------------------------- */
  // The table's own torque_guide_8_8_dry_Nm column, recomputed from its own definition.
  // The column says "T = K F d with K = 0.20 and F = 0.7 x proof load"; recomputing it from the
  // 3-sf proof_load_8_8_N column misses by one in the third figure for five sizes (M2.5, M6, M8,
  // M10, M12), while As x Sp (580 MPa, 600 above M16, both read through resolveGrade) reproduces all
  // twelve to 3 sf. So the guide was built from As x Sp, and so is this tool's proof load.
  function guideTable(ctx) {
    return ctx.metric.rows.map(function (r) {
      var size = findSize(ctx, r.key);
      var g = resolveGrade(ctx, size, { grade: '8.8' }).grade;
      var T = ctx.guide.K * ctx.guide.frac * g.proofLoad_N * r.d_mm / 1000;
      var Tcol = ctx.guide.K * ctx.guide.frac * r.proof_load_8_8_N * r.d_mm / 1000;
      var fracBack = r.torque_guide_8_8_dry_Nm / (ctx.guide.K * r.d_mm / 1000) / r.proof_load_8_8_N;
      return { key: r.key, guide_Nm: r.torque_guide_8_8_dry_Nm, recomputed_Nm: T, sf3: sig(T, 3), fromColumn_sf3: sig(Tcol, 3), frac_back: fracBack, proof_MPa: g.proof_MPa };
    });
  }

  // The same torque under every condition the size's table gives a nut factor for (mid K).
  function conditionSweep(ctx, input) {
    var size = findSize(ctx, input.size);
    if (!size) return [];
    return conditionsFor(size).filter(function (c) { return c.key !== 'declared'; }).map(function (c) {
      var r = receipt(ctx, Object.assign({}, input, { condition: c.key, K_pick: 'mid' }));
      if (!r.ok || r.sections.preload.status !== 'computed') return { key: c.key, label: c.label, ok: false };
      return { key: c.key, label: c.label, ok: true, K: r.tightening.K, u: r.tightening.u, F_nom_N: r.sections.preload.F_nom_N, F_max_N: r.sections.preload.F_max_N,
        ratio: r.sections.preload.ratio_proof, sigma_max_MPa: r.sections.assembly.sigma_MPa, state: r.sections.assembly.state, word: r.sections.assembly.word, current: c.key === input.condition };
    });
  }

  // Reads the dry-run end cap fixture: its torque note, its bolt_shear row and its thread row.
  function readEndcap(ctx, text) {
    text = text || (ctx.data.endcap && ctx.data.endcap.text);
    var lines = String(text).split('\n');
    var lineOf = function (re) { for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1; return null; };
    var tq = must(/Torque (M\d+) bolts to ([\d.]+) N·m \(grade ([\d.]+) (lubricated|dry)\)/.exec(text), 'the torque note in endcap.scad');
    var bsLine = lineOf(/"check":"bolt_shear"/), thLine = lineOf(/"check":"thread"/), holeLine = lineOf(/"name":"M8 bolt pattern clearance"/), tqLine = lineOf(/Torque M\d+ bolts to/), perLine = lineOf(/per bolt/);
    var obj = function (ln) { return JSON.parse(lines[ln - 1].replace(/^\/\/\s*/, '').replace(/,\s*$/, '')); };
    var bs = obj(bsLine), th = obj(thLine), hole = obj(holeLine);
    return {
      size: tq[1], torque_Nm: num(tq[2]), grade: tq[3], lubricated: tq[4] === 'lubricated', bolt_shear: bs, thread: th, hole: hole,
      Fext_N: bs.force_N / bs.n, stack_mm: hole.to_mm - hole.from_mm,
      lines: { torque: tqLine, bolt_shear: bsLine, thread: thLine, hole: holeLine, perBolt: perLine },
      quote: tq[0], perBoltText: perLine ? lines[perLine - 1].replace(/^\/\/\s*/, '') : null,
    };
  }

  function endcapInput(ctx) {
    var e = readEndcap(ctx);
    return {
      size: e.size, grade: e.grade, torque_Nm: e.torque_Nm, condition: e.lubricated ? 'lubricated' : 'dry', K_pick: 'mid',
      Fext_N: e.Fext_N, Fext_source: 'endcap.scad:' + e.lines.bolt_shear + ' bolt_shear force_N ' + e.bolt_shear.force_N + ' ÷ n ' + e.bolt_shear.n + ' (an axial pressure load declared as shear)',
      joint: 'tapped', engagement_mm: e.thread.engagement_mm, material: e.thread.internal_material, stack_mm: e.stack_mm,
    };
  }

  // The worked examples the page and the CLI share.
  function presets(ctx) {
    var endcap = endcapInput(ctx);
    var ex = function (o) { return Object.assign({}, endcap, o); };
    return {
      'endcap': { label: 'End cap as written', input: endcap },
      'endcap-dry': { label: 'Same torque, dry', input: ex({ condition: 'dry' }) },
      'by-feel': { label: 'Tightened by feel', input: ex({ byFeel: true, torque_Nm: null }) },
      'm6-through': { label: 'M6 through-bolt', input: { size: 'M6', grade: '8.8', torque_Nm: 9.79, condition: 'dry', K_pick: 'mid', Fext_N: 500, Fext_source: 'example load', joint: 'nut', nut: 'iso4032', screw_len_mm: 20, stack_mm: 10, washer_head: false, washer_nut: true } },
      'quarter-20': { label: '1/4-20 grade 5', input: { size: '1/4-20', grade: 'J429-5', torque_Nm: 10.7, condition: 'dry', K_pick: 'mid', Fext_N: 2500, Fext_source: 'example load', joint: 'nut', nut: 'hex', screw_len_mm: 25.4, stack_mm: 12.7, washer_head: false, washer_nut: true } },
    };
  }

  // What PartForge reports today for the fixture's bolt_shear row, through its own code.
  function endcapToday(ctx) {
    var e = readEndcap(ctx);
    var sy = ctx.code.GRADE_SY[String(e.bolt_shear.grade).toLowerCase()];
    var M = ctx.code.FLIGHT_MATERIALS['6061-T6'];
    var r = ctx.code.boltShear({ size: e.bolt_shear.size, n: e.bolt_shear.n, force_N: e.bolt_shear.force_N, sigma_y_bolt_MPa: sy, plate_t_mm: e.bolt_shear.plate_t_mm, plate_sigma_y_MPa: M.sy, threads_in_shear: true });
    var sf = Math.min(r.sf_shear, r.sf_bearing);
    return { sy: sy, r: r, sf: sf, sf_min: e.bolt_shear.sf_min, passes: sf >= e.bolt_shear.sf_min - 1e-9, line: e.lines.bolt_shear };
  }

  /* ------------------------------------------------------------------------------------------
   * Formatting helpers shared by the page and the CLI.
   * ---------------------------------------------------------------------------------------- */
  function round(x, n) { var f = Math.pow(10, n); return Math.round(x * f) / f; }
  function sig(x, n) { if (x === 0) return 0; var p = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(x)))); return Math.round(x * p) / p; }
  function fmtN(F) { return Math.round(F).toLocaleString('en-US') + ' N'; }
  function fmtkN(F) { return (F / 1000).toFixed(F >= 100000 ? 0 : F >= 10000 ? 1 : 2) + ' kN'; }
  function fmtMPa(s) { return s.toFixed(1) + ' MPa'; }
  function fmtNm(T) { return (T >= 100 ? T.toFixed(0) : T >= 10 ? T.toFixed(1) : T >= 1 ? T.toFixed(2) : T.toFixed(3)) + ' N·m'; }

  return {
    makeContext: makeContext, sizes: sizes, findSize: findSize, gradesFor: gradesFor, conditionsFor: conditionsFor,
    receipt: receipt, guideTable: guideTable, conditionSweep: conditionSweep, presets: presets, readEndcap: readEndcap, endcapInput: endcapInput, endcapToday: endcapToday,
    fieldConf: fieldConf, round: round, sig: sig, fmtN: fmtN, fmtkN: fmtkN, fmtMPa: fmtMPa, fmtNm: fmtNm, NM_PER_LBFIN: NM_PER_LBFIN,
  };
});
