/* stack.js — Stack Ledger's kernel: a one-dimensional tolerance stack over PartForge's own fit, stock and
   thermal-expansion tables. Pure: no DOM, no clock, no network. Loads as a classic script
   (window.StackLedger) and with require(). Idea Bank style.

   A stack is a signed chain of contributors to one gap G = Σ s_i · x_i (s_i = ±1). Every contributor
   resolves to absolute limits [low_i, high_i] around a nominal n_i, from one of six places:
     declared  a dimension typed in with plus/minus limits and PartForge's tol_src (source | user | default)
     fit       an ISO 286 fit (H hole over a lettered shaft) at a size: the clearance band, via dbFit()
     iso       one ISO 286 feature (an H hole or a lettered shaft) at a size, via dbFit()
     stock     an as-supplied surface of a stock.json row (bar OD, plate thickness, tube OD or ID)
     coating   a build-up per surface on one or two mating surfaces (closes a clearance)
     thermal   (α_hole − α_shaft)·D·ΔT over a declared ΔT range, via dbFitThermal(), both ends
   Worst case gates:  G_min = Σ min(s·low, s·high),  G_max = Σ max(s·low, s·high). It gates as a screening row:
   FAIL when the worst case leaves the requirement, CLEARS when it stays inside, never PASS, because nothing here
   measures the gap (docs/roadmap-evaluation.md:666 at PartForge 0974a62).
   RSS is information only: half = √Σ((high−low)/2)² over the manufacturing contributors (not thermal, which is
   deterministic), centred on Σ s·mid, never on the nominal sum; printed with N and "no statistical basis
   below N=4". A contributor the tables cannot source is REFUSED with a code, a reason and what would help,
   and a stack with any refusal prints no gap at all.

   Confidence words: PartForge's tables say certain / likely / recall; a declaration says source / user /
   default (its TOL_SRC). Both are printed as the data carries them; a recall row is never presented as cited. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StackLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0';
  var KINDS = ['declared', 'fit', 'iso', 'stock', 'coating', 'thermal'];
  var MFG_KINDS = ['declared', 'fit', 'iso', 'stock', 'coating'];      // enter the RSS line
  var RSS_MIN_N = 4;                                                    // below this the RSS has no statistical basis
  var TOL_SRC = /^(source|user|default)$/;                              // PartForge parseFlight's TOL_SRC (index.html:4660)
  var FIT_LETTERS = 'defghkn';                                          // fits.json LIMITS (2): the closed-form letters
  var INTERFERENCE_LETTERS = 'prstu';                                   // fits.json LIMITS (2): need the delta rule, absent
  // Rows of materials_thermal.json whose cte_um_m_K is not a number to gate a fit on, by the table's own words:
  // LIMITS (1) says that for "the laminates and polymers ... a single number is a placeholder", and the row
  // notes name a direction for the laminates, the printed polymers and graphite. The group says which words apply.
  // What is left are the eleven metals PartForge's own tests/flight-db.test.mjs:143 calls metals; a test checks it.
  var PLACEHOLDER_CTE = {
    'G10-FR4': 'laminate', 'CF-laminate': 'laminate', 'Fiberglass-laminate': 'laminate', 'Phenolic': 'laminate',
    'Ultem-9085': 'print', 'CF-Nylon': 'print', 'PEEK': 'polymer', 'PA12-SLS': 'polymer', 'Delrin-POM': 'polymer',
    'Graphite': 'grain',
  };
  var PLACEHOLDER_CTE_KEYS = Object.keys(PLACEHOLDER_CTE);
  // The composite and phenolic tubes, for which PartForge's doctrine (index.html:1454) says "do not use a fit class
  // at all" and fits.json LIMITS (5) says "THESE ARE FOR MACHINED METAL".
  var COMPOSITE_TUBE_KEYS = ['G10-FR4', 'CF-laminate', 'Fiberglass-laminate', 'Phenolic'];
  var LIMITS_1 = 'the laminates and polymers vary so much with layup, weave, resin, fill and print direction that a single number is a placeholder';
  var REF_TEMP_C = 20;                                                  // ISO 286 reference temperature for the limits

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }
  function str(x) { return typeof x === 'string' ? x.trim() : ''; }
  function refusal(code, reason, help) { return { code: code, reason: reason, what_would_help: help }; }
  function fail(code, reason, help) { return { ok: false, refusal: refusal(code, reason, help) }; }

  // ---- formatting (ASCII, so the same text prints in a terminal and on the page) ------------------
  function f3(x) { if (!isNum(x)) return '-'; var s = Math.abs(x).toFixed(3); return (x < 0 && Number(s) !== 0 ? '-' : '') + s; }
  function sgn(x) { if (!isNum(x)) return '-'; var s = Math.abs(x).toFixed(3); return (x < 0 && Number(s) !== 0 ? '-' : '+') + s; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  // ---- context ---------------------------------------------------------------------------------------
  /* S is the snapshot module (snapshots/partforge.js): dbFit, dbMaterialThermal, dbFitThermal, dbRows,
     withMaterials, fits, materialsThermal, provenance, verbatim. meta says which tables are in use. */
  function create(S, meta) {
    if (!S || typeof S.dbFit !== 'function' || typeof S.dbFitThermal !== 'function') throw new Error('StackLedger.create needs the PartForge snapshot module');
    return { S: S, meta: meta || { tables: 'snapshots', commit: S.provenance && S.provenance.commit } };
  }

  function fitsTable(ctx) {
    var t = ctx.S.tables ? ctx.S.tables().fits : ctx.S.fits;
    return t || ctx.S.fits;
  }
  function fitRowFor(ctx, size) {
    var rows = ctx.S.dbRows('fits') || [];
    for (var i = 0; i < rows.length; i++) if (size > rows[i].from_mm && size <= rows[i].to_mm) return rows[i];
    return null;
  }

  // ---- resolvers --------------------------------------------------------------------------------------
  function provDeclared(c, flags) {
    var src = TOL_SRC.test(str(c.tol_src)) ? str(c.tol_src) : 'default';
    var ref = str(c.tol_ref).slice(0, 200);
    if (src === 'source' && !ref) {              // parseFlight does the same: a source claim without a reference is a default
      flags.push('tol_src "source" without a tol_ref is demoted to default, as PartForge parseFlight() does');
      src = 'default';
    }
    if (src === 'default') flags.push('tol_src default: a tool default, not evidence');
    return { tol_src: src, tol_ref: src === 'source' ? ref : (ref || '') };
  }

  function resolveDeclared(ctx, c, name) {
    if (!isNum(c.nominal_mm)) return fail('invalid_input', name + ': nominal_mm must be a finite number (mm).', 'give the drawing nominal in millimetres.');
    var plus = c.plus_mm, minus = c.minus_mm;
    if (plus == null && minus == null && isNum(c.tol_mm)) { plus = c.tol_mm; minus = c.tol_mm; }
    if (!isNum(plus) || !isNum(minus) || plus < 0 || minus < 0) {
      return fail('no_tolerance', name + ' declares a nominal of ' + f3(c.nominal_mm) + ' mm and no tolerance; a nominal is not a limit, and a stack over it would print a number nobody measured.',
        'declare plus_mm and minus_mm (or tol_mm for a symmetric band) with tol_src user and a tol_ref saying how the limits were established; for a composite or phenolic tube, measure the actual part at three clockings and design to the measurement (fits.json notes, LIMITS (5)).');
    }
    if (plus === 0 && minus === 0) return fail('no_tolerance', name + ': a tolerance of +0/-0 is a nominal pretending to be a limit.', 'declare the real plus_mm / minus_mm; if the dimension is truly basic (theoretically exact), it does not belong in the chain.');
    var flags = [];
    var p = provDeclared(c, flags);
    return { ok: true, low: c.nominal_mm - minus, high: c.nominal_mm + plus, nominal: c.nominal_mm, confidence: p.tol_src,
      provenance: { kind: 'declared', tol_src: p.tol_src, tol_ref: p.tol_ref, text: 'declared, tol_src ' + p.tol_src + (p.tol_ref ? ': "' + p.tol_ref + '"' : '') },
      detail: { plus_mm: plus, minus_mm: minus }, flags: flags };
  }

  /* Why dbFit() returned null, in the table's own words (mirrors the diagnosis dbHints() prints at index.html:5480). */
  function diagnoseFit(ctx, size, holeLetter, holeGrade, shaftLetter, shaftGrade, name) {
    if (!isNum(size) || !(size > 0)) return fail('invalid_input', name + ': size_mm must be a positive number (mm).', 'give the nominal size of the fit in millimetres.');
    var row = fitRowFor(ctx, size);
    if (!row) {
      if (size > 500) return fail('off_table', name + ': fits.json stops at 500 mm (LIMITS (1): "Size steps stop at 500 mm; nothing here applies above it"); Ø' + f3(size) + ' is off the table.', 'get the limits from ISO 286-1 directly and declare them as a declared contributor with tol_src source and the standard as tol_ref.');
      return fail('off_table', name + ': the size steps in fits.json begin above 1 mm (the first step is 1-3 mm, exclusive at 1); Ø' + f3(size) + ' is off the table.', 'declare the limits with tol_src source and say where they came from.');
    }
    if (holeLetter !== 'H') return fail('hole_letter', name + ': dbFit() carries H holes only (fits.json: "A hole letter is the mirror: H is EI = 0"); hole letter ' + JSON.stringify(holeLetter) + ' is not in the table.', 'use an H hole, or declare the hole limits as a declared contributor with their source.');
    if (shaftLetter === 'js') return fail('letter_not_in_table', name + ': js is not a row in fits.json; LIMITS (4): "js is symmetric, +/-IT/2, and needs no table".', 'declare the shaft as a declared contributor with plus_mm = minus_mm = IT' + shaftGrade + '/2 = ' + (row.it_um[shaftGrade] != null ? (row.it_um[shaftGrade] / 2000).toFixed(4) + ' mm' : '(grade not in table)') + ' and tol_src source "fits.json LIMITS (4)".');
    if (INTERFERENCE_LETTERS.indexOf(shaftLetter) >= 0) return fail('letter_not_in_table', name + ': the interference letters p, r, s, t and u are deliberately absent from fits.json (LIMITS (2): they "need the standard\'s delta rule and are NOT in this table - a press fit taken from a half-remembered table is how a coupler cracks").', 'get ' + shaftLetter + shaftGrade + ' from ISO 286 or a vendor chart, say where it came from, and declare the shaft limits with tol_src source.');
    if (FIT_LETTERS.indexOf(shaftLetter) < 0) return fail('letter_not_in_table', name + ': shaft letter ' + JSON.stringify(shaftLetter) + ' is not in fits.json; only d, e, f, g, h, k and n have a closed-form deviation there.', 'declare the shaft limits from the standard with tol_src source.');
    var step = row.from_mm + '-' + row.to_mm;
    var disputed = (fitsTable(ctx).disputed || []);
    var grades = [[holeGrade, 'hole'], [shaftGrade, 'shaft']];
    for (var i = 0; i < grades.length; i++) {
      var g = grades[i][0];
      if (row.it_um[g] == null) {
        var d = disputed.filter(function (x) { return x.step === step && x.field === 'IT' + g; })[0];
        if (d) return fail('withheld', name + ': IT' + g + ' at the ' + step + ' mm step is withheld in fits.json (' + d.value + '; "' + d.note + '").', 'get IT' + g + ' for this step from ISO 286-1 and declare the limits with tol_src source, or use a grade the table carries (' + Object.keys(row.it_um).map(function (k) { return 'IT' + k; }).join(', ') + ').');
        return fail('grade_not_in_table', name + ': IT' + g + ' is not carried at the ' + step + ' mm step; fits.json has ' + Object.keys(row.it_um).map(function (k) { return 'IT' + k; }).join(', ') + ' there.', 'use a grade the table carries, or declare the limits from the standard with tol_src source.');
      }
    }
    if (shaftLetter !== 'h' && !(shaftLetter === 'k' && !(shaftGrade >= 4 && shaftGrade <= 7)) && row.shaft_es_um[shaftLetter] == null) {
      var dn = disputed.filter(function (x) { return x.step === step && x.field === 'shaft ' + shaftLetter; })[0];
      if (dn) return fail('withheld', name + ': the ' + shaftLetter + ' deviation at the ' + step + ' mm step is withheld in fits.json (' + dn.value + '; "' + dn.note + '").', 'get it from ISO 286-1 and declare the shaft limits with tol_src source.');
      return fail('letter_not_in_table', name + ': fits.json has no ' + shaftLetter + ' deviation at the ' + step + ' mm step.', 'declare the shaft limits from the standard with tol_src source.');
    }
    return fail('off_table', name + ': dbFit() returned nothing for Ø' + f3(size) + ' ' + holeLetter + holeGrade + '/' + shaftLetter + shaftGrade + '.', 'check the letters and grades against fits.json.');
  }

  function parseLetterGrade(v, what, name) {
    if (!Array.isArray(v) || v.length !== 2) return fail('invalid_input', name + ': ' + what + ' must be [letter, grade], e.g. ["H", 7].', 'write the fit as hole ["H", 7] over shaft ["g", 6].');
    var letter = str(v[0]), grade = Number(v[1]);
    if (!letter || !isInt(grade) || grade < 0) return fail('invalid_input', name + ': ' + what + ' needs a letter and an integer grade.', 'e.g. ["g", 6].');
    return { ok: true, letter: letter, grade: grade };
  }

  function fitFlags(res, shaftLetter, shaftGrade) {
    var flags = ['ISO 286 limits are for machined metal (fits.json LIMITS (5)); a composite or phenolic tube is measured, not toleranced to an IT grade'];
    if (res.transition) flags.push('transition fit (' + shaftLetter + '): the band crosses zero, a negative gap is interference');
    if (shaftLetter === 'k' && !(shaftGrade >= 4 && shaftGrade <= 7)) flags.push("k's deviation is zero at grade " + shaftGrade + ' (ISO 286 defines it for grades 4 to 7 only; dbFit() enforces this)');
    return flags;
  }

  function resolveFit(ctx, c, name) {
    var h = parseLetterGrade(c.hole, 'hole', name); if (!h.ok) return h;
    var s = parseLetterGrade(c.shaft, 'shaft', name); if (!s.ok) return s;
    if (!isNum(c.size_mm) || !(c.size_mm > 0)) return fail('invalid_input', name + ': size_mm must be a positive number (mm).', 'give the nominal size of the fit.');
    var r = ctx.S.dbFit(c.size_mm, h.letter, h.grade, s.letter, s.grade);
    if (!r) return diagnoseFit(ctx, c.size_mm, h.letter, h.grade, s.letter, s.grade, name);
    var label = h.letter + h.grade + '/' + s.letter + s.grade;
    return { ok: true, low: r.clearance[0], high: r.clearance[1], nominal: 0, confidence: r.confidence,
      provenance: { kind: 'fit', table: 'fits.json', step: r.step, text: 'fits.json row ' + r.step + ' via dbFit() [' + r.confidence + ']: ' + label + ' at Ø' + f3(c.size_mm) + ', hole ' + f3(r.hole[0]) + '/' + f3(r.hole[1]) + ' (IT' + h.grade + ' = ' + r.it_hole_um + ' um), shaft ' + f3(r.shaft[0]) + '/' + f3(r.shaft[1]) + ' (' + s.letter + s.grade + ', deviation ' + r.dev_um + ' um)' },
      detail: { label: label, size_mm: c.size_mm, hole: r.hole, shaft: r.shaft, it_hole_um: r.it_hole_um, it_shaft_um: r.it_shaft_um, dev_um: r.dev_um, transition: r.transition, step: r.step },
      flags: fitFlags(r, s.letter, s.grade) };
  }

  function resolveIso(ctx, c, name) {
    var feature = str(c.feature);
    if (feature !== 'hole' && feature !== 'shaft') return fail('invalid_input', name + ': feature must be "hole" or "shaft".', 'say which half of a fit this single ISO 286 feature is.');
    var letter = str(c.letter), grade = Number(c.grade);
    if (!letter || !isInt(grade) || grade < 0) return fail('invalid_input', name + ': letter and an integer grade are required, e.g. letter "H", grade 7.', 'write the feature as letter + grade.');
    if (!isNum(c.size_mm) || !(c.size_mm > 0)) return fail('invalid_input', name + ': size_mm must be a positive number (mm).', 'give the nominal size.');
    var r, hl, hg, sl, sg;
    if (feature === 'hole') { hl = letter; hg = grade; sl = 'h'; sg = grade; }
    else { hl = 'H'; hg = grade; sl = letter; sg = grade; }
    r = ctx.S.dbFit(c.size_mm, hl, hg, sl, sg);
    if (!r) return diagnoseFit(ctx, c.size_mm, hl, hg, sl, sg, name);
    var lim = feature === 'hole' ? r.hole : r.shaft;
    var it = feature === 'hole' ? r.it_hole_um : r.it_shaft_um;
    var label = letter + grade;
    var flags = fitFlags(r, feature === 'shaft' ? letter : 'h', grade).filter(function (f) { return feature === 'shaft' || !/transition|deviation is zero/.test(f); });
    return { ok: true, low: lim[0], high: lim[1], nominal: c.size_mm, confidence: r.confidence,
      provenance: { kind: 'iso', table: 'fits.json', step: r.step, text: 'fits.json row ' + r.step + ' via dbFit() [' + r.confidence + ']: ' + feature + ' ' + label + ' at Ø' + f3(c.size_mm) + ' = ' + f3(lim[0]) + '/' + f3(lim[1]) + ' (IT' + grade + ' = ' + it + ' um' + (feature === 'shaft' ? ', deviation ' + r.dev_um + ' um' : '') + ')' },
      detail: { label: label, feature: feature, size_mm: c.size_mm, limits: lim, it_um: it, dev_um: feature === 'shaft' ? r.dev_um : 0, step: r.step },
      flags: flags };
  }

  function resolveStock(ctx, c, name) {
    var rows = ctx.S.dbRows('stock') || [];
    var key = str(c.key);
    var row = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].key === key) { row = rows[i]; break; }
    if (!row) return fail('unknown_stock_row', name + ': no stock.json row ' + JSON.stringify(key) + ' in the ' + rows.length + ' rows available here.', 'use one of: ' + rows.map(function (r) { return r.key; }).join(', ') + (rows.length < 100 ? ' (this folder carries an excerpt; run the CLI with --repo for all 192 rows)' : '') + '.');
    var surface = str(c.surface);
    var flags = [];
    var low, high, nominal, what;
    if (row.kind === 'bar' && surface === 'od') { low = row.dim_min_mm; high = row.dim_max_mm; nominal = row.dim_mm; what = 'bar diameter'; }
    else if (row.kind === 'plate' && surface === 'thickness') { low = row.dim_min_mm; high = row.dim_max_mm; nominal = row.dim_mm; what = 'plate thickness'; }
    else if ((row.kind === 'tube' || row.kind === 'pipe') && surface === 'od') { low = row.dim_min_mm; high = row.dim_max_mm; nominal = row.dim_mm; what = 'tube OD (mean diameter)'; }
    else if ((row.kind === 'tube' || row.kind === 'pipe') && surface === 'id') {
      low = row.id_min_mm; high = row.id_max_mm; what = 'tube ID (mean diameter, derived from OD and wall limits)';
      nominal = row.id_nominal_mm;
      // The app's embedded projection (tools/db/embed.mjs:83) has no id_nominal_mm; the nominal ID is then OD - 2 x wall,
      // both of which it does carry. On the full table the two agree on every tube and pipe row (a test checks all of them).
      if (!isNum(nominal) && isNum(row.dim_mm) && isNum(row.wall_mm)) {
        nominal = row.dim_mm - 2 * row.wall_mm;
        flags.push('this copy of the table has no id_nominal_mm: nominal ID taken as dim_mm - 2 x wall_mm = ' + f3(nominal));
      }
    }
    else return fail('stock_surface', name + ': a ' + row.kind + ' row has no surface ' + JSON.stringify(surface) + '. Bars have "od", plates "thickness", tubes and pipes "od" or "id".', 'name the as-supplied surface that is actually in the gap; a machined surface is a declared contributor with its own tolerance, not a stock one.');
    if (!isNum(low) || !isNum(high) || !isNum(nominal)) return fail('invalid_input', name + ': row ' + key + ' has no limits for ' + surface + '.', 'check the row.');
    var claim = str(c.tol_src);
    var hasTolConf = row.tolerance_confidence != null;
    var tolConf = row.tolerance_confidence || row.confidence || 'recall';
    if (claim === 'source') {
      if (tolConf === 'recall' || row.confidence === 'recall') return fail('recall_as_source', name + ': stock.json row ' + key + ' carries tolerance_confidence "' + (hasTolConf ? row.tolerance_confidence : 'absent') + '" (row confidence "' + row.confidence + '"); a recall row cannot be presented as a cited source.', 'cite the mill certificate or the supplier\'s quoted tolerance for the delivered stock as a declared contributor with tol_src source and a tol_ref, or leave tol_src off and let the row\'s recall confidence print.');
      if (!str(c.tol_ref)) { flags.push('tol_src "source" without a tol_ref is demoted: the row\'s own confidence prints'); claim = ''; }
    } else if (claim && claim !== 'user' && claim !== 'default') claim = '';
    if (!hasTolConf) flags.push('this copy of the table has no tolerance_confidence (the app\'s embedded projection drops it): the row confidence "' + row.confidence + '" prints');
    if (row.kind === 'tube' || row.kind === 'pipe') {
      if (isNum(row.ovality_individual_dia_tol_mm)) flags.push('mean-diameter band: any individual diameter may deviate up to +/-' + f3(row.ovality_individual_dia_tol_mm) + ' mm from nominal (ovality_individual_dia_tol_mm); measure the delivered tube at three clockings');
      else flags.push('mean-diameter band; this copy of the table has no ovality_individual_dia_tol_mm, so how far an individual diameter may stray is in data/tables/stock.json only; measure the delivered tube at three clockings');
    }
    flags.push('stock.json notes (1): "Nothing in this table is a finished dimension: every diameter, face and bore that matters gets machined" - this contributor stands for a surface used as supplied');
    if (tolConf === 'recall' || row.confidence === 'recall') flags.push('recall row: not cited (tolerance_confidence ' + (hasTolConf ? row.tolerance_confidence : 'absent') + ', row confidence ' + row.confidence + ')');
    if (Array.isArray(row.disputed) && row.disputed.length) flags.push('disputed tolerance: compiled ' + row.disputed[0].compiled + ' vs alternative ' + row.disputed[0].alternative + '; the wider band is stored');
    else if (row.disputed) flags.push('disputed tolerance: this copy of the table keeps only the flag; the competing values are in data/tables/stock.json');
    return { ok: true, low: low, high: high, nominal: nominal, confidence: tolConf,
      provenance: { kind: 'stock', table: 'stock.json', key: key, tol_src: claim || 'table', text: 'stock.json row ' + key + ' (' + row.material + ', ' + row.form + ', ' + row.tolerance_basis + ') [tolerance ' + tolConf + ', row ' + row.confidence + ']: ' + what + ' ' + f3(low) + '/' + f3(high) + (claim ? ', tol_src ' + claim + (str(c.tol_ref) ? ': "' + str(c.tol_ref).slice(0, 200) + '"' : '') : '') },
      detail: { key: key, kind: row.kind, form: row.form, material: row.material, surface: surface, tol_plus_mm: row.tol_plus_mm, tol_minus_mm: row.tol_minus_mm, tolerance_basis: row.tolerance_basis, tolerance_note: row.tolerance_note },
      flags: flags };
  }

  function resolveCoating(ctx, c, name) {
    var v = c.per_side_mm, lo, hi;
    if (isNum(v)) { lo = v; hi = v; }
    else if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])) { lo = Math.min(v[0], v[1]); hi = Math.max(v[0], v[1]); }
    else return fail('coating_undeclared', name + ': a coating with no declared build-up is not a dimension, and a coating that is named in prose (mfg.finish) but not sized changes a fit by an amount nobody has written down.',
      'declare per_side_mm as a value or a [min, max] range with a src; fits.json notes (6) gives Type II anodise as "roughly 0.005 to 0.025 mm per surface" (prose in the table notes, not a row, no confidence field: cite it as that) and says to mask the fit or size for the coating.');
    if (!(hi > 0) || lo < 0) return fail('coating_undeclared', name + ': per_side_mm must be positive (a coating that adds nothing is "bare", and then it is not a contributor).', 'declare the real build-up per surface, or delete the contributor and write "bare" in mfg.finish.');
    var surfaces = c.surfaces == null ? 2 : c.surfaces;
    if (surfaces !== 1 && surfaces !== 2) return fail('invalid_input', name + ': surfaces must be 1 (one face) or 2 (a diametral build-up on both sides of a bore or shaft).', 'for a diametral gap use 2.');
    var src = str(c.src);
    var flags = [];
    if (!src) flags.push('no src for the build-up: treated as a tool default, not evidence');
    if (hi !== lo) flags.push('a range, not a measurement: the stack takes the whole band');
    return { ok: true, low: surfaces * lo, high: surfaces * hi, nominal: 0, confidence: src ? 'user' : 'default',
      provenance: { kind: 'coating', tol_src: src ? 'user' : 'default', text: 'coating build-up ' + f3(lo) + (hi !== lo ? ' to ' + f3(hi) : '') + ' mm per surface x ' + surfaces + ' surface' + (surfaces > 1 ? 's' : '') + (src ? ', src: "' + src.slice(0, 200) + '"' : ', no src') },
      detail: { per_side_mm: [lo, hi], surfaces: surfaces, src: src },
      flags: flags };
  }

  function thermalSide(ctx, key, side, override, name) {
    var row = ctx.S.dbMaterialThermal(key);
    if (override && typeof override === 'object') {
      if (!isNum(override.cte_um_m_K)) return fail('invalid_input', name + ': hoop_cte.' + side + '.cte_um_m_K must be a number (um/m/K).', 'copy the hoop (circumferential) CTE from the tube\'s data sheet.');
      if (!str(override.src)) return fail('invalid_input', name + ': hoop_cte.' + side + ' needs a src naming where the hoop CTE came from.', 'the data sheet, the mill certificate or the laminate schedule it was computed from.');
      return { ok: true, key: 'user:' + key + ':' + side, row: { key: 'user:' + key + ':' + side, cte_um_m_K: override.cte_um_m_K, confidence: 'user', note: 'user-supplied hoop CTE for ' + key + ': ' + str(override.src) }, overridden: true, baseKey: key };
    }
    if (!row) {
      var keys = (ctx.S.dbRows('materials_thermal') || []).map(function (r) { return r.key; });
      return fail('unknown_material', name + ': ' + JSON.stringify(key) + ' is not a materials_thermal.json key.', 'use one of: ' + keys.join(', ') + '.');
    }
    var group = PLACEHOLDER_CTE[key];
    if (group) {
      var why = group === 'laminate' ? 'for a laminate it is the in-plane or along-fibre value (columns: "For laminates this is the in-plane or along-fibre value"), while a diameter grows by the hoop value; and LIMITS (1): "' + LIMITS_1 + '"'
        : group === 'print' ? 'a printed part\'s value differs with print direction, and which direction a diameter grows in depends on how the part was printed; and LIMITS (1): "' + LIMITS_1 + '"'
        : group === 'grain' ? 'its value depends on grain direction and grade'
        : 'LIMITS (1): "' + LIMITS_1 + '"';
      return fail('cte_placeholder', name + ': materials_thermal.json gives ' + key + ' cte_um_m_K = ' + row.cte_um_m_K + ' [' + row.confidence + '], which the table itself does not offer as a number to gate a fit on: ' + why + '.' + (row.note ? ' Row note: "' + row.note + '".' : ' The row has no note.'),
        'supply hoop_cte.' + side + ' = { cte_um_m_K, src }: the expansion in the direction the diameter grows, from the data sheet, the mill certificate or the club\'s own measurement (materials_thermal.json LIMITS (4)); the shipped dbFitThermal() then runs on that value and the contributor prints as user-supplied.');
    }
    return { ok: true, key: key, row: row, overridden: false, baseKey: key };
  }

  function resolveThermal(ctx, c, name) {
    if (!isNum(c.D_mm) || !(c.D_mm > 0)) return fail('invalid_input', name + ': D_mm (the joint diameter) must be a positive number.', 'give the nominal diameter of the fit the thermal term acts on.');
    var dT = c.dT_K;
    var ends;
    if (isNum(dT)) ends = [dT, dT];
    else if (Array.isArray(dT) && dT.length === 2 && isNum(dT[0]) && isNum(dT[1])) ends = [Math.min(dT[0], dT[1]), Math.max(dT[0], dT[1])];
    else return fail('invalid_input', name + ': dT_K must be a number or a [low, high] range in kelvin relative to the ' + REF_TEMP_C + ' C reference at which ISO 286 limits apply.', 'e.g. [-60, 20] for a 40 C pad and a -40 C altitude.');
    var ov = c.hoop_cte && typeof c.hoop_cte === 'object' ? c.hoop_cte : {};
    var hole = thermalSide(ctx, str(c.hole_mat), 'hole', ov.hole, name); if (!hole.ok) return hole;
    var shaft = thermalSide(ctx, str(c.shaft_mat), 'shaft', ov.shaft, name); if (!shaft.ok) return shaft;
    var extra = [];
    if (hole.overridden) extra.push(hole.row);
    if (shaft.overridden) extra.push(shaft.row);
    var S = ctx.S;
    var at = function (t) { return S.withMaterials(extra, function () { return S.dbFitThermal(c.D_mm, hole.key, shaft.key, t); }); };
    var a = at(ends[0]), b = at(ends[1]);
    if (!a || !b) return fail('unknown_material', name + ': dbFitThermal() returned nothing.', 'check the material keys.');
    var dA = a.d_mm + 0, dB = b.d_mm + 0;        // + 0 turns the -0 a like-for-like pair yields into 0
    var low = Math.min(dA, dB), high = Math.max(dA, dB);
    // The weaker side decides: a recall table row on one side stays recall even when the other side is a user value.
    var recallRows = [hole, shaft].filter(function (s) { return !s.overridden && s.row.confidence === 'recall'; }).map(function (s) { return s.row.key; });
    var conf = recallRows.length ? 'recall' : (hole.overridden || shaft.overridden) ? 'user' : a.confidence;
    var flags = [];
    var coeff = (hole.row.cte_um_m_K - shaft.row.cte_um_m_K);
    if (hole.baseKey === shaft.baseKey && !hole.overridden && !shaft.overridden) flags.push('same material both sides: temperature-neutral, the term is exactly zero (dbFitThermal)');
    if (hole.overridden) flags.push('hole hoop CTE supplied by the user (' + hole.row.cte_um_m_K + ' um/m/K): ' + str(ov.hole.src));
    if (shaft.overridden) flags.push('shaft hoop CTE supplied by the user (' + shaft.row.cte_um_m_K + ' um/m/K): ' + str(ov.shaft.src));
    if (recallRows.length) flags.push('recall row(s): ' + recallRows.join(', ') + ' - not cited');
    if (ends[0] > 0 || ends[1] < 0) flags.push('the range excludes dT = 0, so the ' + REF_TEMP_C + ' C assembly state is not in the envelope; include 0 if the joint is assembled at room temperature');
    flags.push('deterministic, not a tolerance: enters the worst case at both ends of the range and is kept out of the RSS');
    var rowWord = function (s) { return s.baseKey + (s.overridden ? ' (overridden by the user hoop CTE)' : ' [' + s.row.confidence + ']'); };
    var text = 'dbFitThermal(' + f3(c.D_mm) + ', ' + hole.key + ', ' + shaft.key + ', dT) = (alpha_hole ' + hole.row.cte_um_m_K + ' - alpha_shaft ' + shaft.row.cte_um_m_K + ') um/m/K x D x dT [' + conf + ']: ' + sgn(dA) + ' at ' + sgn(ends[0]).replace('.000', '') + ' K, ' + sgn(dB) + ' at ' + sgn(ends[1]).replace('.000', '') + ' K; materials_thermal.json rows ' + rowWord(hole) + ', ' + rowWord(shaft);
    return { ok: true, low: low, high: high, nominal: 0, confidence: conf,
      provenance: { kind: 'thermal', table: 'materials_thermal.json', text: text },
      detail: { D_mm: c.D_mm, dT_K: ends, hole_mat: hole.baseKey, shaft_mat: shaft.baseKey, cte_hole: hole.row.cte_um_m_K, cte_shaft: shaft.row.cte_um_m_K, coeff_um_per_K: coeff, at_low: dA, at_high: dB, hole_overridden: hole.overridden, shaft_overridden: shaft.overridden },
      flags: flags };
  }

  function resolve(ctx, c, index) {
    var name = (c && str(c.name)) || ('contributor ' + (index + 1));
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { index: index, name: name, kind: '?', refused: refusal('invalid_input', 'contributor ' + (index + 1) + ' is not an object.', 'each contributor is an object with a kind.') };
    var kind = str(c.kind);
    if (KINDS.indexOf(kind) < 0) return { index: index, name: name, kind: kind || '?', refused: refusal('unknown_kind', name + ': kind ' + JSON.stringify(kind) + ' is not one of ' + KINDS.join(', ') + '.', 'choose a kind the kernel can source.') };
    var dir;
    if (kind === 'fit' || kind === 'thermal') dir = c.dir == null ? 1 : c.dir;
    else if (kind === 'coating') dir = c.dir == null ? -1 : c.dir;
    else dir = c.dir;
    if (dir !== 1 && dir !== -1) return { index: index, name: name, kind: kind, refused: refusal('invalid_input', name + ': dir must be 1 (adds to the gap) or -1 (takes from it)' + (kind === 'declared' || kind === 'iso' || kind === 'stock' ? '; it is required for a ' + kind + ' contributor because the sign is the whole point of a chain' : '') + '.', 'a bore or a thickness that opens the gap is +1; a shaft, a plug or a build-up that closes it is -1.') };
    var r;
    switch (kind) {
      case 'declared': r = resolveDeclared(ctx, c, name); break;
      case 'fit': r = resolveFit(ctx, c, name); break;
      case 'iso': r = resolveIso(ctx, c, name); break;
      case 'stock': r = resolveStock(ctx, c, name); break;
      case 'coating': r = resolveCoating(ctx, c, name); break;
      case 'thermal': r = resolveThermal(ctx, c, name); break;
    }
    if (!r.ok) return { index: index, name: name, kind: kind, dir: dir, refused: r.refusal };
    if (!isNum(r.low) || !isNum(r.high) || !isNum(r.nominal)) return { index: index, name: name, kind: kind, dir: dir, refused: refusal('invalid_input', name + ': its limits are not finite numbers (the arithmetic overflowed); nothing can be summed from them.', 'check the units: every length is in millimetres and every temperature change in kelvin.') };
    var a = dir * r.low, b = dir * r.high;
    var sLow = Math.min(a, b), sHigh = Math.max(a, b);
    return { index: index, name: name, kind: kind, dir: dir, nominal: r.nominal, low: r.low, high: r.high,
      signed: { low: sLow, high: sHigh, mid: (sLow + sHigh) / 2, nominal: dir * r.nominal, half: (sHigh - sLow) / 2 },
      confidence: r.confidence, provenance: r.provenance, detail: r.detail, flags: r.flags, refused: null, inRss: MFG_KINDS.indexOf(kind) >= 0 };
  }

  /* fits.json LIMITS (5) and PartForge's doctrine (index.html:1454): no fit class on anything mating with a composite or
     phenolic tube. A stack is one gap, so a thermal contributor that names such a tube as the hole (or the shaft) makes
     every fit in the chain, and every ISO hole (or shaft) feature, a fit class on that tube. Refused whether or not the
     thermal contributor itself resolved (a hoop CTE lifts the thermal refusal, not this one). */
  function compositeFitRefusals(cs, contributors) {
    var holeKey = null, shaftKey = null;
    cs.forEach(function (c) {
      if (!c || typeof c !== 'object' || str(c.kind) !== 'thermal') return;
      if (COMPOSITE_TUBE_KEYS.indexOf(str(c.hole_mat)) >= 0) holeKey = holeKey || str(c.hole_mat);
      if (COMPOSITE_TUBE_KEYS.indexOf(str(c.shaft_mat)) >= 0) shaftKey = shaftKey || str(c.shaft_mat);
    });
    if (!holeKey && !shaftKey) return;
    contributors.forEach(function (c, i) {
      if (c.refused) return;
      var on = null;
      if (c.kind === 'fit') on = holeKey ? ['hole', holeKey] : ['shaft', shaftKey];
      else if (c.kind === 'iso' && c.detail && c.detail.feature === 'hole' && holeKey) on = ['hole', holeKey];
      else if (c.kind === 'iso' && c.detail && c.detail.feature === 'shaft' && shaftKey) on = ['shaft', shaftKey];
      if (!on) return;
      contributors[i] = { index: c.index, name: c.name, kind: c.kind, dir: c.dir, refused: refusal('fit_on_composite',
        c.name + ': this stack\'s thermal contributor names ' + on[1] + ' as the ' + on[0] + ', and an ISO 286 grade is not a limit for that part. fits.json LIMITS (5): "THESE ARE FOR MACHINED METAL. A composite or phenolic tube is not round, not constant, and not to an IT grade"; PartForge\'s doctrine (index.html:1454): "for anything mating with a composite or phenolic tube, do not use a fit class at all".',
        'measure the ' + on[1] + ' part at three clockings and declare it as a declared contributor with tol_src user and the measurement as tol_ref; the metal half can stay an iso feature (' + (on[0] === 'hole' ? 'e.g. a g6 shaft' : 'e.g. an H7 hole') + ') or a declared dimension.') };
    });
  }

  function refuseStack(out, code, reason, help) {
    out.refusals.push({ index: -1, name: 'stack', code: code, reason: reason, what_would_help: help });
  }

  function refusedReasons(out) {
    var nC = out.refusals.filter(function (r) { return r.index >= 0; }).length;
    var parts = [];
    if (nC) parts.push(nC + ' contributor' + (nC > 1 ? 's' : '') + ' could not be sourced');
    out.refusals.filter(function (r) { return r.index < 0; }).forEach(function (r) { parts.push((r.name === 'require' ? 'the requirement' : 'the stack') + ' is refused (' + r.code + ')'); });
    return parts.join('; ') + (nC ? '; no gap is printed because a partial sum would be a placeholder number' : '; no gap is printed');
  }

  // ---- the stack ----------------------------------------------------------------------------------------
  function stackUp(ctx, stack) {
    var out = { version: VERSION, gap_name: '', units: 'mm', contributors: [], refusals: [], evaluable: false, worst: null, rss: null, thermal: null, require: null, verdict: 'REFUSED', verdict_reasons: [], flags: [], meta: ctx.meta,
      measurable_on_mesh: 'none: every contributor is declared or looked up, and the mating half is by definition not in any one file' };
    if (!stack || typeof stack !== 'object' || Array.isArray(stack)) { refuseStack(out, 'invalid_input', 'the stack is not an object.', 'a JSON object with gap_name, contributors and require.'); out.verdict_reasons.push(refusedReasons(out)); return out; }
    out.gap_name = str(stack.gap_name) || 'unnamed gap';
    if (stack.units != null && str(stack.units) !== 'mm') refuseStack(out, 'invalid_input', 'units must be mm (the tables are in mm).', 'convert before declaring.');
    var cs = Array.isArray(stack.contributors) ? stack.contributors : [];
    if (!cs.length) refuseStack(out, 'no_contributors', 'a stack with no contributors has no gap to compute.', 'add at least one contributor; two make a gap.');
    for (var i = 0; i < cs.length; i++) out.contributors.push(resolve(ctx, cs[i], i));
    compositeFitRefusals(cs, out.contributors);
    out.contributors.forEach(function (r, j) {
      if (r.refused) out.refusals.push({ index: j, name: r.name, kind: r.kind, code: r.refused.code, reason: r.refused.reason, what_would_help: r.refused.what_would_help });
    });
    // requirement
    var req = stack.require && typeof stack.require === 'object' ? stack.require : {};
    var rmin = req.min_mm == null ? null : req.min_mm, rmax = req.max_mm == null ? null : req.max_mm;
    if ((rmin != null && !isNum(rmin)) || (rmax != null && !isNum(rmax))) out.refusals.push({ index: -1, name: 'require', code: 'invalid_input', reason: 'require.min_mm / require.max_mm must be finite numbers when given.', what_would_help: 'e.g. {"min_mm": 0.02, "max_mm": 0.30}.' });
    else if (rmin != null && rmax != null && rmin > rmax) out.refusals.push({ index: -1, name: 'require', code: 'invalid_input', reason: 'require.min_mm is above require.max_mm.', what_would_help: 'swap them.' });
    out.require = { min_mm: isNum(rmin) ? rmin : null, max_mm: isNum(rmax) ? rmax : null };

    if (!out.refusals.length) {
      var gmin = 0, gmax = 0, gnom = 0, n = 0, sumSq = 0, centre = 0, mfgMin = 0, mfgMax = 0, tLow = 0, tHigh = 0, hasThermal = false;
      for (var k = 0; k < out.contributors.length; k++) {
        var c = out.contributors[k];
        gmin += c.signed.low; gmax += c.signed.high; gnom += c.signed.nominal;
        if (c.inRss) { n++; sumSq += c.signed.half * c.signed.half; centre += c.signed.mid; mfgMin += c.signed.low; mfgMax += c.signed.high; }
        if (c.kind === 'thermal') { hasThermal = true; tLow += c.signed.low; tHigh += c.signed.high; }
      }
      var half = Math.sqrt(sumSq);
      // Sums of finite numbers can still overflow; a verdict on Infinity or NaN would be a number nobody can trace.
      if (![gmin, gmax, gnom, gmax - gmin, centre, half, mfgMin, mfgMax, mfgMax - mfgMin, tLow, tHigh].every(isNum)) {
        refuseStack(out, 'invalid_input', 'the sums are not finite numbers (the arithmetic overflowed double precision); no limit, RSS or verdict can be printed.', 'check the units: every length is in millimetres and every temperature change in kelvin.');
      } else {
        out.evaluable = true;
        out.worst = { min: gmin, max: gmax, nominal: gnom, width: gmax - gmin };
        if (hasThermal) out.thermal = { low: tLow, high: tHigh, note: 'deterministic shift over the declared temperature range: in the worst case, not in the RSS' };
        if (n > 0) {
          var mfgWidth = mfgMax - mfgMin;
          out.rss = { n: n, centre: centre, half: half, low: centre - half, high: centre + half, offset_from_nominal: centre - gnom, mfg_worst: { min: mfgMin, max: mfgMax }, mfg_worst_width: mfgWidth, width_ratio: mfgWidth > 0 ? (2 * half) / mfgWidth : 1, basis_ok: n >= RSS_MIN_N, min_n: RSS_MIN_N,
            // The band to set beside the worst case: the RSS of the manufacturing contributors plus the deterministic thermal
            // envelope at its two ends, exactly as the worst case adds it. Without thermal it is the RSS band itself.
            envelope: { low: centre - half + tLow, high: centre + half + tHigh },
            note: 'information only; worst case gates. Centred on the sum of the mid-limit means, not on the nominal. Assumes independent, centred, normal processes; ' + (n < RSS_MIN_N ? 'no statistical basis below N=' + RSS_MIN_N : 'N=' + n) + '.' };
        }
      }
    }
    if (!out.evaluable) {
      out.verdict = 'REFUSED';
      out.verdict_reasons = [refusedReasons(out)];
      out.flags = globalFlags(out);
      return out;
    }
    if (out.require.min_mm == null && out.require.max_mm == null) {
      out.verdict = 'NO_REQUIREMENT';
      out.verdict_reasons.push('no require.min_mm or require.max_mm declared: the limits are printed, nothing is gated');
    } else {
      var reasons = [];
      if (out.require.min_mm != null && gmin < out.require.min_mm) reasons.push('minimum gap ' + f3(gmin) + ' is ' + f3(out.require.min_mm - gmin) + ' below the required minimum ' + f3(out.require.min_mm));
      if (out.require.max_mm != null && gmax > out.require.max_mm) reasons.push('maximum gap ' + f3(gmax) + ' is ' + f3(gmax - out.require.max_mm) + ' above the required maximum ' + f3(out.require.max_mm));
      if (reasons.length) { out.verdict = 'FAIL'; out.verdict_reasons = reasons; }
      else {
        // Never PASS: roadmap-evaluation.md:666 asks for a screening-only stack row, because nothing can measure the gap
        // (the mating half is not in the file); :752 keeps PASS for a joint whose two halves are both measured and cited.
        out.verdict = 'CLEARS';
        out.verdict_reasons = ['worst-case gap ' + f3(gmin) + ' to ' + f3(gmax) + ' lies inside the requirement',
          'screening only, not a pass: every contributor is declared or looked up and nothing here measures the gap'];
        var dflt = out.contributors.filter(function (x) { return x.confidence === 'default'; });
        var rec = out.contributors.filter(function (x) { return x.confidence === 'recall'; });
        if (dflt.length) out.verdict_reasons.push('it rests on ' + dflt.length + ' tool default' + (dflt.length > 1 ? 's' : '') + ' (' + dflt.map(function (x) { return x.name; }).join('; ') + ')');
        if (rec.length) out.verdict_reasons.push('it rests on ' + rec.length + ' recall row' + (rec.length > 1 ? 's' : '') + ' (' + rec.map(function (x) { return x.name; }).join('; ') + ')');
      }
      out.margins = { to_min: out.require.min_mm == null ? null : gmin - out.require.min_mm, to_max: out.require.max_mm == null ? null : out.require.max_mm - gmax };
    }
    out.flags = globalFlags(out);
    return out;
  }

  function globalFlags(out) {
    var flags = [];
    var ok = out.contributors.filter(function (c) { return !c.refused; });
    var recall = ok.filter(function (c) { return c.confidence === 'recall'; });
    if (recall.length) flags.push(recall.length + ' contributor' + (recall.length > 1 ? 's rest' : ' rests') + ' on recall rows (' + recall.map(function (c) { return c.name; }).join('; ') + '): not cited, printed as the table carries them');
    var dflt = ok.filter(function (c) { return c.confidence === 'default'; });
    if (dflt.length) flags.push(dflt.length + ' contributor' + (dflt.length > 1 ? 's are' : ' is') + ' a tool default (' + dflt.map(function (c) { return c.name; }).join('; ') + '): arithmetic, not evidence');
    if (out.rss && !out.rss.basis_ok) flags.push('RSS over N=' + out.rss.n + ' has no statistical basis (needs N>=' + RSS_MIN_N + ' independent, centred processes); it is printed as information and never gates');
    // Like for like: the RSS band against the worst case of the SAME manufacturing contributors, so the deterministic
    // thermal shift (in the worst case, kept out of the RSS) is not mistaken for statistical narrowing.
    if (out.rss && out.rss.low - out.rss.mfg_worst.min >= 5e-4) flags.push('the RSS band starts ' + f3(out.rss.low - out.rss.mfg_worst.min) + ' above the worst-case minimum of the same ' + out.rss.n + ' contributors: that is the false comfort RSS offers when a student biases every cut to the safe side');
    if (out.refusals.length) flags.push('the stack is REFUSED; the resolved contributors are listed for diagnosis only');
    return flags;
  }

  // ---- text -----------------------------------------------------------------------------------------------
  function ledgerText(res) {
    var L = [];
    var m = res.meta || {};
    L.push('STACK LEDGER  ' + res.gap_name);
    L.push('units mm . 1-D chain G = sum(dir x contributor) . worst case gates . RSS is information only');
    L.push('tables: fits.json, materials_thermal.json, stock.json from PartForge @ ' + ((m.commit || '').slice(0, 7) || '?') + ' (' + (m.tables || 'snapshots') + ')' + (m.verbatim ? ' . dbFit()/dbFitThermal() verbatim from index.html:' + m.verbatim : ''));
    L.push('');
    L.push('CONTRIBUTORS (' + res.contributors.length + ')');
    res.contributors.forEach(function (c, i) {
      var head = ' #' + (i + 1) + '  ' + (c.dir === 1 ? '+' : c.dir === -1 ? '-' : '?') + '  ' + (c.kind + '        ').slice(0, 8) + '  ' + c.name;
      L.push(head);
      if (c.refused) { L.push('       REFUSED ' + c.refused.code + ': ' + c.refused.reason); L.push('       what would help: ' + c.refused.what_would_help); return; }
      L.push('       limits ' + f3(c.low) + ' .. ' + f3(c.high) + ' (nominal ' + f3(c.nominal) + ')   signed ' + sgn(c.signed.low) + ' .. ' + sgn(c.signed.high) + '   mid ' + sgn(c.signed.mid) + '   half-band ' + f3(c.signed.half) + '   [' + c.confidence + ']');
      L.push('       from: ' + c.provenance.text);
      c.flags.forEach(function (f) { L.push('       note: ' + f); });
    });
    L.push('');
    if (!res.evaluable) {
      L.push('VERDICT      REFUSED - ' + res.verdict_reasons.join('; '));
      res.refusals.filter(function (r) { return r.index < 0; }).forEach(function (r) { L.push('       ' + r.code + ': ' + r.reason + ' What would help: ' + r.what_would_help); });
    } else {
      L.push('WORST CASE   min ' + f3(res.worst.min) + '   max ' + f3(res.worst.max) + '   (nominal sum ' + f3(res.worst.nominal) + '; width ' + f3(res.worst.width) + ')');
      L.push('REQUIREMENT  min ' + (res.require.min_mm == null ? '-' : f3(res.require.min_mm)) + '   max ' + (res.require.max_mm == null ? '-' : f3(res.require.max_mm)));
      L.push('VERDICT      ' + (res.verdict === 'NO_REQUIREMENT' ? 'NOT GATED' : res.verdict === 'CLEARS' ? 'CLEARS (screening)' : res.verdict) + ' - ' + res.verdict_reasons.join('; '));
      if (res.rss) {
        var r = res.rss;
        L.push('RSS          information only . N=' + r.n + ' manufacturing contributor' + (r.n > 1 ? 's' : '') + (r.basis_ok ? '' : ' . no statistical basis below N=' + r.min_n));
        L.push('             centre ' + f3(r.centre) + ' (sum of mid-limit means; ' + (Math.abs(r.offset_from_nominal) < 5e-7 ? 'equal to' : sgn(r.offset_from_nominal) + ' from') + ' the nominal sum) +/- ' + f3(r.half) + '  ->  ' + f3(r.low) + ' .. ' + f3(r.high) + '   (' + pct(1 - r.width_ratio) + ' narrower than the worst-case band of the same contributors, ' + f3(r.mfg_worst.min) + ' .. ' + f3(r.mfg_worst.max) + ')');
        if (res.thermal) L.push('             plus the thermal shift at both ends, to set beside the worst case: ' + f3(r.envelope.low) + ' .. ' + f3(r.envelope.high));
      } else L.push('RSS          none: no manufacturing contributors');
      L.push('THERMAL      ' + (res.thermal ? sgn(res.thermal.low) + ' .. ' + sgn(res.thermal.high) + ' over the declared dT range (' + res.thermal.note + ')' : 'none declared'));
    }
    if (res.flags.length) { L.push('NOTES'); res.flags.forEach(function (f) { L.push(' - ' + f); }); }
    L.push('Measurable on a mesh: ' + res.measurable_on_mesh + '.');
    return L.join('\n');
  }

  function parseStack(text) {
    try {
      var v = JSON.parse(text);
      return { stack: v, error: null };
    } catch (e) {
      return { stack: null, error: 'not JSON: ' + e.message };
    }
  }

  return { VERSION: VERSION, KINDS: KINDS, MFG_KINDS: MFG_KINDS, RSS_MIN_N: RSS_MIN_N, PLACEHOLDER_CTE: PLACEHOLDER_CTE, PLACEHOLDER_CTE_KEYS: PLACEHOLDER_CTE_KEYS, COMPOSITE_TUBE_KEYS: COMPOSITE_TUBE_KEYS, LIMITS_1: LIMITS_1, FIT_LETTERS: FIT_LETTERS, INTERFERENCE_LETTERS: INTERFERENCE_LETTERS, REF_TEMP_C: REF_TEMP_C,
    create: create, resolve: resolve, stackUp: stackUp, ledgerText: ledgerText, parseStack: parseStack, f3: f3, sgn: sgn };
});
