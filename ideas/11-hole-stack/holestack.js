/* Hole Stack — the kernel. Pure: no DOM, no clock, no randomness. Loads as a classic script
 * (window.HoleStack) and through require() for the Node tests and the CLI.
 *
 * Give it a metric size, a head style, a washer flag, an ISO 273 clearance series, a plate thickness
 * and what holds the far end, and it works the whole hole stack out of PartForge's own tables:
 *   - every number comes from data/tables/fasteners_metric.json or fits.json (snapshots), or from a
 *     rule the table states in its own column text (parsed at run time, never retyped here), or from
 *     PartForge's process-capability table (the "tool default" tolerance);
 *   - every number carries the table's own confidence for that FIELD (field_confidence, else the row
 *     label for a core field, else "unlabelled"), and FLIGHT provenance is derived from it
 *     mechanically: tol_src "source" only when every field behind the dimension AND its tolerance is
 *     certain/likely with a named standard; anything else is "default" and never carries tol_ref;
 *   - what the data cannot answer is refused by name (code, reason, what would help).
 * Outputs: the numbers, an OpenSCAD cutter module, FLIGHT rows, and an SVG section (strings).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HoleStack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HEADS = ['socket', 'countersunk', 'button', 'none'];
  var FARS = ['through', 'nut', 'nyloc', 'tapped'];
  var SERIES = ['fine', 'medium', 'coarse'];
  var DEFAULTS = { size: 'M6', head: 'socket', washer: false, series: 'medium', plate_t: 12, far: 'through',
    part_t: 16, tap_end: 'through', drill: 'standard', model_at: 'd1', process: 'cnc_mill', tess: 0.01 };
  var COS30 = Math.cos(Math.PI / 6); // a regular hexagon: across flats = across corners × cos 30°

  /* ---------- small helpers ---------- */
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function fmt(x) { // shortest exact-to-3-dp text: 6.6, 6.71, 10.62, 4.917
    if (x == null || !isFinite(x)) return '—';
    return String(r3(x));
  }
  function f3(x) { return x == null || !isFinite(x) ? '—' : r3(x).toFixed(3); }
  function idOf(key) { return key.toLowerCase().replace(/\./g, '_'); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------- data ---------- */
  // fm, fits: the parsed JSON of the two tables. pf: PartForge's own code (snapshots/partforge-code.js),
  // optional: when given, its FLIGHT_PROCESSES supply the default tolerance, its threadCheck is run on
  // the tapped joint, and its dbFit is bound to the same fits rows.
  function makeData(fm, fits, pf) {
    var rows = {};
    fm.rows.forEach(function (r) { rows[r.key] = r; });
    if (pf && pf.bindDb) pf.bindDb({ fits: { rows: fits.rows } });
    var procs = pf && pf.FLIGHT_PROCESSES ? pf.FLIGHT_PROCESSES : null;
    return { fm: fm, fits: fits, pf: pf || null, rows: rows, keys: fm.rows.map(function (r) { return r.key; }), processes: procs, rules: tableRules(fm) };
  }

  // Rules the table states in its own words. Each is parsed out of the column text so that a change in
  // the table changes the tool, and nothing here is a number typed from memory.
  function tableRules(fm) {
    var c = fm.columns || {};
    function grab(text, re) { var m = re.exec(String(text || '')); return m ? m : null; }
    var cb = grab(c.cbore_d_mm, /shcs_head_d_knurled_mm \+ (\d+(?:\.\d+)?)/);
    var cbd = grab(c.cbore_depth_flush_mm, /shcs_head_h_mm \(k max\) \+ (\d+(?:\.\d+)?)/);
    var csk = grab(c.csk_head_d_mm, /at (\d+) deg/);
    var eng = grab(c.min_engagement_6061T6_8_8_mm, /Add (\d+)-(\d+) pitches/);
    var grade = {};
    SERIES.forEach(function (s) { var m = grab(c['clearance_' + s + '_mm'], /\(H(\d+)\)/); grade[s] = m ? +m[1] : null; });
    return {
      cboreAllowance: cb ? +cb[1] : null,            // "Any value >= shcs_head_d_knurled_mm + 0.4 works"
      cboreDepthAllowance: cbd ? +cbd[1] : null,     // "= shcs_head_h_mm (k max) + 0.5"
      cskAngle: csk ? +csk[1] : null,                 // "countersink to this diameter at 90 deg"
      engPitches: eng ? [+eng[1], +eng[2]] : null,    // "Add 1-2 pitches for chamfer and incomplete threads"
      washerSeat: /spot-face diameter minimum/.test(String(c.washer_od_mm || '')),
      cornerRelief: /round cutter needs corner relief/.test(String(c.nut_ac_sharp_mm || '')),
      grade: grade                                    // "(H12)" / "(H13)" / "(H14)" in the clearance column texts
    };
  }

  // The table's confidence for one FIELD of one row: field_confidence first, then the row label for a
  // core field, else "unlabelled" (the table's notes (9) promise an entry for every supplementary
  // field; nine supplementary fields have none on any row).
  function fieldConf(data, row, field) {
    if (row.field_confidence && has(row.field_confidence, field)) return row.field_confidence[field];
    if ((data.fm.core_fields || []).indexOf(field) >= 0) return row.confidence;
    return 'unlabelled';
  }
  // What kind of authority field_sources names for a field.
  function fieldBasis(data, field) {
    var s = String((data.fm.field_sources || {})[field] || '');
    var kind = /recall/i.test(s) ? 'recall'
      : /^computed/i.test(s) ? 'computed'
      : /design rule|trade practice/i.test(s) ? 'rule'
      : /^(ISO|DIN|ASME)\b/.test(s) ? 'standard' : 'other';
    return { kind: kind, source: s };
  }
  // May this field stand behind tol_src "source"? Only a certain/likely field whose source is a named
  // standard. Recall, unlabelled, design rules, trade practice and computed columns never may.
  function citable(data, row, field) {
    var c = fieldConf(data, row, field);
    return (c === 'certain' || c === 'likely') && fieldBasis(data, field).kind === 'standard';
  }
  function F(data, row, field) {
    var b = fieldBasis(data, field);
    return { field: field, value: row[field], conf: fieldConf(data, row, field), basis: b.kind, source: b.source, citable: citable(data, row, field) };
  }

  /* ---------- ISO 286 band from fits.json ---------- */
  // H band for a hole of nominal d: [d, d + IT], from the size step with from < d <= to (dbFit's rule).
  function itBand(data, d, grade) {
    var rows = data.fits.rows || [];
    var step = null;
    for (var i = 0; i < rows.length; i++) if (d > rows[i].from_mm && d <= rows[i].to_mm) { step = rows[i]; break; }
    if (!step) return { refusal: { code: 'out_of_envelope', reason: 'Ø' + fmt(d) + ' mm is outside every size step of fits.json (' + rows[0].from_mm + '–' + rows[rows.length - 1].to_mm + ' mm).', help: 'A size step that covers it.' } };
    var it = step.it_um ? step.it_um[String(grade)] : undefined;
    if (it == null) {
      var stepName = step.from_mm + '-' + step.to_mm;
      var disp = (data.fits.disputed || []).filter(function (x) { return x.step === stepName && x.field === 'IT' + grade; })[0];
      var have = Object.keys(step.it_um || {}).map(Number).sort(function (a, b) { return a - b; });
      return { step: step, refusal: { code: 'insufficient_data',
        reason: disp ? 'fits.json withholds IT' + grade + ' for the ' + stepName + ' mm step: "' + disp.value + '" (' + disp.note + ').'
          : 'fits.json tabulates IT' + have[0] + '–IT' + have[have.length - 1] + ' for the ' + stepName + ' mm step; IT' + grade + ' is not in the table.',
        help: disp ? 'The value from ISO 286-1 itself, or a derivation that agrees with the published table, added to fits.json.'
          : 'IT' + grade + ' added to fits.json (tools/db/derive-fits.mjs) with the same two-derivation cross-check, or a series whose grade the table carries.' } };
    }
    return { step: step, stepName: step.from_mm + '-' + step.to_mm, it_um: it, lo: d, hi: d + it / 1000, centre: d + it / 2000, half: it / 2000, conf: step.confidence };
  }

  /* ---------- input ---------- */
  function parseSize(text, data) {
    var s = String(text == null ? '' : text).trim().replace(/\s+/g, '');
    var m = /^M(\d+(?:\.\d+)?)(?:[x×\-](\d+(?:\.\d+)?))?$/i.exec(s);
    var list = data.keys.join(', ');
    if (!m) return { refusal: { feature: 'size', code: 'invalid_input', reason: '"' + text + '" is not a metric thread size.', help: 'One of the table\'s rows: ' + list + '.' } };
    var key = 'M' + String(+m[1]);
    var row = data.rows[key];
    if (!row) return { refusal: { feature: 'size', code: 'not_found', reason: key + ' is not a row of fasteners_metric.json.', help: 'The table holds ' + data.keys.length + ' coarse-pitch sizes: ' + list + '.' } };
    if (m[2] != null && Math.abs(+m[2] - row.pitch_mm) > 1e-9) return { refusal: { feature: 'size', code: 'not_found', reason: key + '×' + m[2] + ' is a fine pitch; fasteners_metric.json holds the coarse pitch only (' + key + '×' + row.pitch_mm + ').', help: 'Fine-pitch minor diameters, tap drills and stress areas from the standard (the table\'s notes (1) say they differ).' } };
    return { key: key, row: row };
  }

  function normalise(input, data) {
    var x = {};
    Object.keys(DEFAULTS).forEach(function (k) { x[k] = input && input[k] != null && input[k] !== '' ? input[k] : DEFAULTS[k]; });
    x.washer = x.washer === true || x.washer === 'true' || x.washer === '1' || x.washer === 1;
    x.plate_t = +x.plate_t; x.part_t = +x.part_t; x.tess = +x.tess;
    var bad = [];
    if (HEADS.indexOf(x.head) < 0) bad.push('head must be one of ' + HEADS.join(', '));
    if (FARS.indexOf(x.far) < 0) bad.push('far end must be one of ' + FARS.join(', '));
    if (SERIES.indexOf(x.series) < 0) bad.push('series must be one of ' + SERIES.join(', '));
    if (['through', 'blind'].indexOf(x.tap_end) < 0) bad.push('tapped end must be through or blind');
    if (['standard', 'stainless'].indexOf(x.drill) < 0) bad.push('drill must be standard or stainless');
    if (['d1', 'drill'].indexOf(x.model_at) < 0) bad.push('model_at must be d1 or drill');
    if (!(x.plate_t > 0 && x.plate_t <= 500)) bad.push('plate thickness must be a number of millimetres above 0 and up to 500');
    if (x.far === 'tapped' && !(x.part_t > 0 && x.part_t <= 500)) bad.push('tapped part thickness must be above 0 and up to 500 mm');
    if (!(x.tess >= 0.001 && x.tess <= 0.1)) bad.push('tess_tol must be between 0.001 and 0.1 mm');
    if (data.processes && !has(data.processes, x.process)) bad.push('process must be one of ' + Object.keys(data.processes).join(', '));
    return { x: x, bad: bad };
  }

  /* ---------- the stack ---------- */
  function build(input, data) {
    var n = normalise(input || {}, data);
    var x = n.x;
    var res = { ok: false, input: x, refusals: [], checks: [], features: [], flight: { clamp: null, tapped: null }, scad: '', geometry: null };
    if (n.bad.length) {
      res.refusals.push({ feature: 'input', code: 'invalid_input', reason: n.bad.join('; ') + '.', help: 'Inputs inside those ranges.' });
      return res;
    }
    var sz = parseSize(x.size, data);
    if (sz.refusal) { res.refusals.push(sz.refusal); return res; }
    var key = sz.key, row = sz.row, id = idOf(key), R = data.rules;
    res.key = key; res.row = row; res.id = id; res.pitch = row.pitch_mm;
    var proc = data.processes ? data.processes[x.process] : null;
    var tolDef = proc ? proc.tol_general_mm : null;
    res.process = proc ? { key: x.process, name: proc.name, tol_general_mm: proc.tol_general_mm, min_internal_corner_r_mm: proc.min_internal_corner_r_mm, src: proc.src } : null;
    function refuse(feature, code, reason, help) { res.refusals.push({ feature: feature, code: code, reason: reason, help: help }); }
    function check(level, text) { res.checks.push({ level: level, text: text }); }
    if (tolDef == null) refuse('tolerances', 'insufficient_data', 'No process capability table was loaded, so no default tolerance exists for the counterbore, nut pocket or tapped hole.', 'PartForge\'s FLIGHT_PROCESSES (snapshots/partforge-code.js).');

    var t = x.plate_t;
    var geo = { clamp: { t: t, top: null, bottom: null, hole: null, head: null, washer: null, nut: null }, tapped: null };

    /* 1. clearance hole (always: it is the hole the screw passes) */
    var g = R.grade[x.series];
    var fc = F(data, row, 'clearance_' + x.series + '_mm');
    var dc = fc.value;
    var band = g ? itBand(data, dc, g) : { refusal: { code: 'insufficient_data', reason: 'the clearance column text names no H grade', help: 'the grade in columns.clearance_' + x.series + '_mm' } };
    var clear = { id: 'clearance', part: 'clamp', label: 'Clearance hole, ISO 273 ' + x.series + ' (H' + g + ')', nominal: dc, fields: [fc], grade: g };
    if (band.refusal) {
      refuse('clearance band', band.refusal.code, 'The H' + g + ' band of the ' + key + ' ' + x.series + ' clearance hole (Ø' + fmt(dc) + '): ' + band.refusal.reason, band.refusal.help);
      clear.model = dc; clear.band = null; clear.provenance = 'refused';
    } else {
      clear.band = band; clear.model = band.centre; clear.provenance = (fc.citable && (band.conf === 'likely' || band.conf === 'certain')) ? 'source' : 'default';
    }
    res.features.push(clear);

    /* 2. head recess */
    var topDepth = 0, head = null;
    if (x.head === 'socket') {
      var fk = F(data, row, 'shcs_head_d_knurled_mm'), fkh = F(data, row, 'shcs_head_h_mm');
      var fcb = F(data, row, 'cbore_d_mm'), fdep = F(data, row, 'cbore_depth_flush_mm');
      var fwo = F(data, row, 'washer_od_mm'), fwt = F(data, row, 'washer_t_mm');
      if (R.cboreAllowance == null || tolDef == null) {
        refuse('counterbore', 'insufficient_data', 'The table\'s counterbore rule ("Any value >= shcs_head_d_knurled_mm + …") could not be read from columns.cbore_d_mm, or no default tolerance is loaded.', 'The rule text in the table; the process table.');
      } else {
        var minHead = fk.value + R.cboreAllowance;
        var min = minHead, byWasher = false, why = 'knurled dk ' + fmt(fk.value) + ' + ' + fmt(R.cboreAllowance);
        if (x.washer) {
          if (fwo.value > minHead) { min = fwo.value; byWasher = true; why = 'washer d2 ' + fmt(fwo.value) + ' (the table: "use as spot-face diameter minimum"), larger than knurled dk + ' + fmt(R.cboreAllowance) + ' = ' + fmt(minHead); }
          check('warn', 'The washer goes down into the counterbore. The table sizes a washer seat at d2 = ' + fmt(fwo.value) + ' mm (washer_od_mm, nominal = max) and gives no wall clearance for a washer that drops into a bore, so the band starts at d2 max: a washer at its largest touches the wall. Decide a clearance before release.');
          if (fcb.value < fwo.value) check('warn', 'The table\'s counterbore tool size cbore_d_mm ' + fmt(fcb.value) + ' [recall] is smaller than the washer OD ' + fmt(fwo.value) + ': the doctrine\'s "counterbore to cbore_d_mm … add washer_t_mm" makes a counterbore the washer cannot enter.');
          else if (fcb.value === fwo.value) check('warn', 'The table\'s counterbore tool size cbore_d_mm ' + fmt(fcb.value) + ' [recall] equals the washer OD ' + fmt(fwo.value) + ': line-to-line.');
        }
        var depth = fdep.value + (x.washer ? fwt.value : 0);
        var cb = { id: 'counterbore', part: 'clamp', label: 'Counterbore for an ISO 4762 socket head' + (x.washer ? ' + ISO 7089 washer' : ''),
          fields: [fk, fdep].concat(x.washer ? [fwo, fwt] : []), recallShown: fcb, why: why,
          band: { lo: min, hi: min + 2 * tolDef, centre: min + tolDef, half: tolDef }, model: min + tolDef, depth: depth, provenance: 'default', byWasher: byWasher,
          rule: 'shcs_head_d_knurled_mm + ' + fmt(R.cboreAllowance) + ' (columns.cbore_d_mm)', headD: fk.value, headH: fkh.value };
        if (depth >= t) { refuse('counterbore', 'out_of_envelope', 'The flush-head counterbore is ' + fmt(depth) + ' mm deep' + (x.washer ? ' (cbore_depth_flush_mm ' + fmt(fdep.value) + ' + washer_t_mm ' + fmt(fwt.value) + ')' : ' (cbore_depth_flush_mm)') + ', not less than the ' + fmt(t) + ' mm plate.', 'A plate thicker than ' + fmt(depth) + ' mm, a smaller size, or a head that does not sit flush.'); cb.provenance = 'refused'; }
        else { topDepth = depth; geo.clamp.top = { kind: 'cbore', d: cb.model, depth: depth }; }
        res.features.push(cb);
        head = { kind: 'socket', d: fk.value, h: fkh.value, conf: fk.conf };
        if (x.washer) geo.clamp.washer = { d: fwo.value, t: fwt.value, at: t - depth };
      }
    } else if (x.head === 'countersunk') {
      var fd = F(data, row, 'csk_head_d_mm'), fh = F(data, row, 'csk_head_h_mm');
      if (x.washer) refuse('washer', 'invalid_input', 'A plain ISO 7089 washer cannot seat under a 90° countersunk head: the head bears on the cone, not on a flat face.', 'No washer, or a socket or button head.');
      if (fd.value == null || fh.value == null) {
        refuse('countersink', 'not_found', 'csk_head_d_mm is null for ' + key + ': "' + String((data.fm.columns || {}).csk_head_d_mm).split('. ').slice(-1)[0] + '"', 'A countersunk size the table carries (M3 and up), or the head diameter from the screw maker\'s drawing.');
      } else if (R.cskAngle == null) {
        refuse('countersink', 'insufficient_data', 'The countersink angle could not be read from columns.csk_head_d_mm.', 'The angle in the table\'s column text.');
      } else if (!x.washer) {
        var half = R.cskAngle / 2 * Math.PI / 180;
        var cd = (fd.value - clear.model) / 2 / Math.tan(half);
        var csk = { id: 'countersink', part: 'clamp', label: 'Countersink ' + R.cskAngle + '° for an ISO 10642 head', fields: [fd, fh], model: fd.value, depth: cd, angle: R.cskAngle, provenance: 'recall', headD: fd.value, headH: fh.value };
        if (cd >= t) { refuse('countersink', 'out_of_envelope', 'The countersink cone reaches ' + fmt(cd) + ' mm below the face, not less than the ' + fmt(t) + ' mm plate.', 'A thicker plate or a smaller size.'); csk.provenance = 'refused'; }
        else { topDepth = cd; geo.clamp.top = { kind: 'csk', d: fd.value, dc: clear.model, depth: cd }; }
        res.features.push(csk);
        head = { kind: 'csk', d: fd.value, h: fh.value, conf: fd.conf };
      }
    } else if (x.head === 'button') {
      var fbd = F(data, row, 'button_head_d_mm'), fbh = F(data, row, 'button_head_h_mm');
      if (fbd.value == null || fbh.value == null) refuse('button head', 'not_found', 'button_head_d_mm is null for ' + key + ': "' + String((data.fm.columns || {}).button_head_d_mm).split('. ').slice(-1)[0] + '"', 'A button-head size the table carries, or the head from the screw maker\'s drawing.');
      else {
        res.features.push({ id: 'button', part: 'clamp', label: 'ISO 7380-1 button head, proud of the face: nothing to cut', fields: [fbd, fbh], provenance: 'recall', headD: fbd.value, headH: fbh.value, model: null });
        head = { kind: 'button', d: fbd.value, h: fbh.value, conf: fbd.conf };
      }
      if (x.washer) { var w1 = F(data, row, 'washer_od_mm'), w2 = F(data, row, 'washer_t_mm'); geo.clamp.washer = { d: w1.value, t: w2.value, at: t }; check('info', 'Washer on the face: the seat must be flat over at least d2 = ' + fmt(w1.value) + ' mm (washer_od_mm, the table\'s spot-face minimum) [' + w1.conf + '].'); }
    } else if (x.washer) {
      var w3 = F(data, row, 'washer_od_mm'), w4 = F(data, row, 'washer_t_mm'); geo.clamp.washer = { d: w3.value, t: w4.value, at: t };
      check('info', 'Washer on the face: the seat must be flat over at least d2 = ' + fmt(w3.value) + ' mm (washer_od_mm, the table\'s spot-face minimum) [' + w3.conf + '].');
    }
    geo.clamp.head = head;

    /* 3. far end */
    var botDepth = 0;
    if (x.far === 'nut' || x.far === 'nyloc') {
      var fa = F(data, row, 'nut_af_mm'), fs = F(data, row, 'nut_ac_sharp_mm'), fm = F(data, row, 'nut_ac_min_mm');
      var fhh = F(data, row, x.far === 'nyloc' ? 'locknut_h_mm' : 'nut_h_mm'), fdin = F(data, row, 'din934_nut_af_mm');
      if (fhh.value == null) refuse('nut pocket', 'not_found', 'locknut_h_mm is null for ' + key + ' ("null = not supplied"): the table has no nylon-insert nut height at this size.', 'The nyloc maker\'s drawing (DIN 985 / ISO 7040 h max), or a plain ISO 4032 nut.');
      else if (tolDef == null) { /* refused above */ }
      else {
        var paf = fa.value + tolDef, pac = paf / COS30;
        var r = proc ? proc.min_internal_corner_r_mm : null;
        var acCorner = r != null ? pac - 2 * r * (1 / COS30 - 1) : null;
        var nut = { id: 'nut', part: 'clamp', label: (x.far === 'nyloc' ? 'Nylon-insert nut pocket (DIN 985 / ISO 7040 height)' : 'ISO 4032 hex nut pocket') + ', from the bottom face',
          fields: [fa, fs, fm, fhh], band: { lo: fa.value, hi: fa.value + 2 * tolDef, centre: paf, half: tolDef }, model: paf, ac: pac, depth: fhh.value,
          provenance: fhh.conf === 'recall' ? 'recall' : 'default', af: fa.value, acSharp: fs.value, acMin: fm.value, cornerR: r, acCorner: acCorner };
        if (topDepth + fhh.value >= t) { refuse('nut pocket', 'out_of_envelope', 'Head recess ' + fmt(topDepth) + ' mm + pocket ' + fmt(fhh.value) + ' mm leave no plate between them in ' + fmt(t) + ' mm.', 'A plate thicker than ' + fmt(topDepth + fhh.value) + ' mm.'); nut.provenance = 'refused'; }
        else { botDepth = fhh.value; geo.clamp.bottom = { kind: 'hex', af: paf, ac: pac, depth: fhh.value }; geo.clamp.nut = { af: fa.value, h: fhh.value }; }
        res.features.push(nut);
        // what the PROVENANCE.md doctrine's "hex pockets to nut_ac_min_mm across corners" would cut
        nut.doctrineAF = fm.value * COS30;
        check('warn', 'PROVENANCE.md §1 says "hex pockets to nut_ac_min_mm across corners". A true hexagon ' + f3(fm.value) + ' mm across corners is ' + f3(fm.value * COS30) + ' mm across flats, ' + f3(fa.value - fm.value * COS30) + ' mm smaller than the nut\'s ' + fmt(fa.value) + ' mm (nut_af_mm, s max): the nut would not enter. Any hex pocket that takes the nut is at least nut_ac_sharp_mm ' + f3(fs.value) + ' across corners; this one is ' + f3(pac) + '.');
        if (r != null) {
          if (acCorner < fs.value) check('warn', 'Milled with ' + x.process + '\'s minimum internal corner radius ' + fmt(r) + ' mm (FLIGHT_PROCESSES), the pocket\'s rounded corners span ' + f3(acCorner) + ' mm: ' + (acCorner >= fm.value ? 'enough for a nut at e min ' + f3(fm.value) + ' but not for the sharp ' + f3(fs.value) : 'less than even e min ' + f3(fm.value)) + '. The table: "a pocket milled with a round cutter needs corner relief to at least this diameter". Add corner relief or use a smaller cutter.');
          else check('info', 'Milled with ' + x.process + '\'s minimum internal corner radius ' + fmt(r) + ' mm, the rounded corners still span ' + f3(acCorner) + ' mm ≥ the sharp ' + f3(fs.value) + '.');
        }
        if (x.far === 'nyloc') { var lt = /DIN 985 M10 is [^.]*\./.exec(String((data.fm.columns || {}).locknut_h_mm || '')); if (lt) check('warn', 'The table on nylon-insert nuts (columns.locknut_h_mm): "' + lt[0] + '" This pocket is sized to the ISO 4032 across-flats; a DIN 985 nut can be larger.'); }
        if (fdin.value != null && fdin.value > paf) check('warn', 'Many vendors still ship DIN 934 nuts: din934_nut_af_mm is ' + fmt(fdin.value) + ' mm at ' + key + ' [' + fdin.conf + '], larger than this ' + f3(paf) + ' mm pocket. Check the bag before cutting (the table says so too).');
      }
    }

    /* the clearance hole's run through the clamped plate */
    var zTop = t - topDepth, zBot = botDepth;
    if (zTop - zBot <= 1e-9 && !res.refusals.some(function (q) { return q.code === 'out_of_envelope'; })) refuse('clearance hole', 'out_of_envelope', 'No plate is left for the clearance hole between the recess and the pocket.', 'A thicker plate.');
    clear.from = zTop; clear.to = zBot;
    geo.clamp.hole = { d: clear.model, from: zTop, to: zBot };

    /* 4. tapped part */
    if (x.far === 'tapped') {
      var fD1 = F(data, row, 'minor_D1_mm'), fdr = F(data, row, x.drill === 'stainless' ? 'tap_drill_stainless_mm' : 'tap_drill_mm');
      var fpct = F(data, row, x.drill === 'stainless' ? 'tap_drill_stainless_pct_thread' : 'tap_drill_pct_thread');
      var fLe = F(data, row, 'min_engagement_6061T6_8_8_mm');
      var p = row.pitch_mm, Le = fLe.value, pw = R.engPitches;
      var need = pw ? [Le + pw[0] * p, Le + pw[1] * p] : [Le, Le];
      var minD = x.model_at === 'd1' ? fD1.value : fdr.value;
      var tp = { id: 'tapped', part: 'tapped', label: key + '×' + fmt(p) + ' tapped hole in the mating part, modelled at ' + (x.model_at === 'd1' ? 'the internal minor diameter D1' : 'the tap drill'),
        fields: [fD1, fdr, fpct, fLe], model: tolDef != null ? minD + tolDef : minD, band: tolDef != null ? { lo: minD, hi: minD + 2 * tolDef, centre: minD + tolDef, half: tolDef } : null,
        provenance: 'default', D1: fD1.value, drill: fdr.value, pct: fpct.value, Le: Le, need: need, pitch: p, end: x.tap_end, partT: x.part_t };
      var depthT = x.tap_end === 'blind' ? need[1] : x.part_t;
      if (x.tap_end === 'blind' && need[1] >= x.part_t) { refuse('tapped hole', 'out_of_envelope', 'A blind hole with the table\'s full engagement (' + fmt(Le) + ' mm + ' + (pw ? pw[1] : 0) + ' pitches = ' + fmt(need[1]) + ' mm) does not fit in a ' + fmt(x.part_t) + ' mm part.', 'A part thicker than ' + fmt(need[1]) + ' mm, or a through hole.'); tp.provenance = 'refused'; }
      tp.depth = depthT;
      var verdict = depthT >= need[1] - 1e-9 ? 'meets' : depthT >= need[0] - 1e-9 ? 'meets with ' + (pw ? pw[0] : 0) + ' pitch' : 'short';
      tp.verdict = verdict;
      if (verdict === 'short') check('warn', 'The tapped length ' + fmt(depthT) + ' mm is short of the table\'s ' + fmt(Le) + ' mm minimum engagement for class 8.8 in 6061-T6 plus ' + (pw ? pw[0] + '–' + pw[1] : '') + ' pitches (' + fmt(need[0]) + '–' + fmt(need[1]) + ' mm): the aluminium thread strips before the bolt breaks.');
      // PartForge's own "thread" load check, run verbatim, at the table's minimum engagement
      if (data.pf && data.pf.threadCheck) {
        var mat = data.pf.FLIGHT_MATERIALS && data.pf.FLIGHT_MATERIALS['6061-T6'];
        if (mat) {
          var tc = data.pf.threadCheck({ size: key, engagement_mm: Le, bolt_sigma_u_MPa: 800, internal_sigma_u_MPa: mat.su, internal_material_class: data.pf.matClass ? data.pf.matClass(mat) : 'aluminum' });
          var appMin = Math.max(tc.Le_req_mm, tc.Le_min_rule_mm);
          tp.appCheck = { Le: Le, ok: !!(tc.ok_strip && tc.ok_rule), ok_strip: tc.ok_strip, ok_rule: tc.ok_rule, Le_req_mm: tc.Le_req_mm, rule_mm: tc.Le_min_rule_mm, rule_multiple: tc.rule_multiple, appMin: appMin, su: mat.su };
          var tcLen = data.pf.threadCheck({ size: key, engagement_mm: depthT, bolt_sigma_u_MPa: 800, internal_sigma_u_MPa: mat.su, internal_material_class: data.pf.matClass ? data.pf.matClass(mat) : 'aluminum' });
          tp.appCheckAtLength = { Le: depthT, ok: !!(tcLen.ok_strip && tcLen.ok_rule) };
          if (!tp.appCheck.ok) check('warn', 'PartForge\'s own "thread" load check (index.html threadCheck: shear 0.5·UTS over 0.5·π·d·Le, plus the ' + fmt(tc.rule_multiple) + '·d rule for aluminium) FAILS at the table\'s ' + fmt(Le) + ' mm: it needs ' + f3(tc.Le_req_mm) + ' mm to stop the strip and ' + fmt(tc.Le_min_rule_mm) + ' mm for the rule. The table (0.6·UTS) and the app (0.5·UTS, 2·d) disagree; this stack\'s ' + fmt(depthT) + ' mm ' + (tp.appCheckAtLength.ok ? 'passes' : 'fails') + ' the app\'s check.');
        }
      }
      if (x.model_at === 'd1' && tp.band && (fdr.value < tp.band.lo - 1e-9 || fdr.value > tp.band.hi + 1e-9)) check('warn', 'The ' + (x.drill === 'stainless' ? 'stainless' : 'standard') + ' tap drill ' + fmt(fdr.value) + ' mm lies outside this default band ' + f3(tp.band.lo) + '–' + f3(tp.band.hi) + ': the finished minor diameter would be declared out of tolerance. Model at the tap drill, or widen the band.');
      check('info', 'Two PartForge instructions disagree on where to model a tapped hole: the table (columns.minor_D1_mm "model tapped holes at D1"), PROVENANCE.md §1 and the app\'s dbHints line say D1 = ' + fmt(fD1.value) + '; the flight doctrine\'s "Use standard sizes" line says "Model tapped holes at the tap drill" = ' + fmt(fdr.value) + '. This page models at ' + (x.model_at === 'd1' ? 'D1' : 'the tap drill') + '.');
      res.features.push(tp);
      geo.tapped = { t: x.part_t, d: tp.model, depth: depthT, through: x.tap_end === 'through', blind: x.tap_end === 'blind' };
    }

    res.geometry = geo;
    res.ok = res.refusals.length === 0;
    res.flight = flightRows(res, data);
    res.scad = scad(res, data);
    return res;
  }

  /* ---------- FLIGHT rows ---------- */
  function flightRows(res, data) {
    var x = res.input, key = res.key, id = res.id, out = { clamp: { holes: [], bores: [], gauges: [] }, tapped: null, basis: [] };
    res.features.forEach(function (f) {
      if (f.provenance === 'refused') return;
      if (f.id === 'clearance' && f.band && f.from > f.to) {
        var tolRef = 'ISO 273:1979 ' + x.series + ' ' + key + ' ' + fmt(f.nominal) + ', H' + f.grade + '; ISO 286 IT' + f.grade + ' ' + f.band.stepName + ' mm = ' + f.band.it_um + ' um (fits.json)';
        var row = { name: key + ' clearance ' + fmt(f.nominal) + ' H' + f.grade + ' (' + f3(f.band.lo) + '-' + f3(f.band.hi) + ')', d_mm: r3(f.band.centre), tol_mm: r3(f.band.half),
          pattern: 'single', at_mm: [0, 0], axis: 'z', from_mm: r3(f.from), to_mm: r3(f.to), tol_src: f.provenance };
        if (f.provenance === 'source') row.tol_ref = tolRef;
        out.clamp.holes.push(row);
        out.basis.push({ part: 'clamp', kind: 'holes', name: row.name, tol_src: row.tol_src, fields: f.fields.map(function (q) { return q.field; }), fits: 'fits.json ' + f.band.stepName + ' IT' + f.grade });
      }
      if (f.id === 'counterbore') {
        var b = { name: key + ' SHCS counterbore (min ' + fmt(f.band.lo) + ')', d_mm: r3(f.band.centre), tol_mm: r3(f.band.half), at_mm: [0, 0], axis: 'z', from_mm: r3(x.plate_t), to_mm: r3(x.plate_t - f.depth), tol_src: 'default' };
        out.clamp.bores.push(b);
        out.basis.push({ part: 'clamp', kind: 'bores', name: b.name, tol_src: 'default', fields: f.fields.map(function (q) { return q.field; }) });
      }
      if (f.id === 'countersink') {
        var cg = { name: key + ' countersunk head GO [recall]', module: 'gauge_' + id + '_csk_go', expect: 'clear', why: 'ISO 10642 ' + key + ' head dk ' + fmt(f.headD) + ' k ' + fmt(f.headH) + ' [recall] seats flush' };
        out.clamp.gauges.push(cg);
        out.basis.push({ part: 'clamp', kind: 'gauges', name: cg.name, tol_src: null, fields: f.fields.map(function (q) { return q.field; }) });
      }
      if (f.id === 'nut') {
        var ng = { name: key + (x.far === 'nyloc' ? ' nyloc' : ' ISO 4032 nut') + ' GO', module: 'gauge_' + id + '_nut_go', expect: 'clear',
          why: (x.far === 'nyloc' ? 'nyloc' : 'ISO 4032') + ' ' + key + ' at s max ' + fmt(f.af) + ', h ' + fmt(f.depth) + ' [' + f.fields[3].conf + '] enters' };
        out.clamp.gauges.push(ng);
        out.basis.push({ part: 'clamp', kind: 'gauges', name: ng.name, tol_src: null, fields: f.fields.map(function (q) { return q.field; }) });
      }
      if (f.id === 'tapped' && f.band) {
        out.tapped = out.tapped || { holes: [], bores: [], gauges: [] };
        var h = { name: key + 'x' + fmt(f.pitch) + ' tapped, at ' + (x.model_at === 'd1' ? 'D1' : 'tap drill') + ' ' + fmt(f.band.lo) + ' (min)', d_mm: r3(f.band.centre), tol_mm: r3(f.band.half),
          pattern: 'single', at_mm: [0, 0], axis: 'z', from_mm: r3(x.part_t), to_mm: r3(f.end === 'blind' ? x.part_t - f.depth : 0), tol_src: 'default' };
        out.tapped.holes.push(h);
        out.basis.push({ part: 'tapped', kind: 'holes', name: h.name, tol_src: 'default', fields: f.fields.map(function (q) { return q.field; }) });
      }
    });
    return out;
  }
  // The rows wrapped as a FLIGHT block PartForge's parseFlight() reads: process and tess_tol_mm from the
  // inputs, nothing else invented (no material, no critical, no mfg: the part's own block has those).
  function flightBlock(res, part) {
    var rows = res.flight && res.flight[part];
    if (!rows || !(rows.holes.length + rows.bores.length + rows.gauges.length)) return '';
    var o = { process: res.input.process, tess_tol_mm: res.input.tess };
    ['holes', 'bores', 'gauges'].forEach(function (k) { if (rows[k].length) o[k] = rows[k]; });
    var lines = ['{"process":' + JSON.stringify(o.process) + ',"tess_tol_mm":' + o.tess_tol_mm + ','];
    var ks = ['holes', 'bores', 'gauges'].filter(function (k) { return o[k]; });
    ks.forEach(function (k, i) {
      lines.push(' ' + JSON.stringify(k) + ':[');
      o[k].forEach(function (r, j) { lines.push('   ' + JSON.stringify(r) + (j < o[k].length - 1 ? ',' : '')); });
      lines.push(' ]' + (i < ks.length - 1 ? ',' : ''));
    });
    lines[lines.length - 1] += '}';
    return '// FLIGHT-BEGIN\n' + lines.map(function (l) { return '// ' + l; }).join('\n') + '\n// FLIGHT-END';
  }

  /* ---------- OpenSCAD ---------- */
  function scad(res, data) {
    if (!res.key) return '';
    var x = res.input, key = res.key, id = res.id, L = [], P = [], body = [], gauges = [];
    var fe = {}; res.features.forEach(function (f) { fe[f.id] = f; });
    function c(f) { return f.field + ' ' + fmt(f.value) + ' [' + f.conf + ']'; }
    var std = function (f) { var s = f.source; return s ? ' (' + s.replace(/\s*\(recall\)\s*$/, '') + ')' : ''; };
    L.push('// HOLE STACK: ' + key + '×' + fmt(res.pitch) + ' · ' + { socket: 'ISO 4762 socket head cap screw', countersunk: 'ISO 10642 countersunk screw', button: 'ISO 7380-1 button head screw', none: 'no head feature' }[x.head] +
      ' · ISO 273 ' + x.series + ' clearance' + (x.washer ? ' · ISO 7089 washer' : '') + ' · far end: ' + { through: 'through (nut outside)', nut: 'ISO 4032 nut pocket', nyloc: 'nylon-insert nut pocket', tapped: 'tapped mating part' }[x.far]);
    L.push('// Generated by Hole Stack (Aster Idea Bank, idea 11) from PartForge data/tables/fasteners_metric.json row "' + key + '" and data/tables/fits.json.');
    L.push('// [ ] labels are the table\'s own field confidence (certain | likely | recall | unlabelled = a field the table gives none for). A [recall] number is not a citation.');
    L.push('// Use: difference(){ your_plate(); hole_stack_' + id + '_clamp(); } with the plate\'s bottom face on z = 0 and the screw on the z axis; translate() to place it.');
    L.push('// Round features are modelled at the centre of their band; the FLIGHT rows beside this file carry the limits.');
    P.push('tess_tol = ' + x.tess + '; // max chordal deviation of curved surfaces (mm)');
    P.push('cut_ext = 1; // cutter overrun past each face so no coplanar faces remain (mm) [modelling allowance, not a dimension]');
    P.push(id + '_plate_t = ' + fmt(x.plate_t) + '; // clamped plate thickness (mm) [user]');
    var cl = fe.clearance;
    if (cl.band) P.push(id + '_clear_d = ' + fmt(cl.model) + '; // clearance hole, H' + cl.grade + ' band centre: ' + c(cl.fields[0]) + std(cl.fields[0]) + ' + IT' + cl.grade + '/2 = ' + fmt(cl.band.half) + ' (fits.json ' + cl.band.stepName + ' mm, IT' + cl.grade + ' ' + cl.band.it_um + ' um) [' + cl.band.conf + ']; limits ' + f3(cl.band.lo) + '..' + f3(cl.band.hi));
    else P.push(id + '_clear_d = ' + fmt(cl.model) + '; // clearance hole at the table value: ' + c(cl.fields[0]) + std(cl.fields[0]) + '; H' + cl.grade + ' band REFUSED (see the refusal)');
    var tol = res.process ? res.process.tol_general_mm : null, procNote = res.process ? 'FLIGHT_PROCESSES.' + res.process.key + '.tol_general_mm ' + fmt(tol) + ' [tool default]' : '';
    var cb = fe.counterbore;
    if (cb && cb.provenance !== 'refused') {
      P.push(id + '_cbore_d = ' + fmt(cb.model) + '; // counterbore, band centre: ' + (!cb.byWasher ? c(cb.fields[0]) + std(cb.fields[0]) + ' + ' + fmt(data.rules.cboreAllowance) + ' (table rule, columns.cbore_d_mm)' : c(cb.fields[2]) + std(cb.fields[2]) + ' (table: "use as spot-face diameter minimum")') + ' + ' + procNote + '; limits ' + f3(cb.band.lo) + '..' + f3(cb.band.hi));
      P.push(id + '_cbore_depth = ' + fmt(cb.depth) + '; // flush-head depth: ' + c(cb.fields[1]) + ' (design rule, k max + ' + fmt(data.rules.cboreDepthAllowance) + ')' + (x.washer ? ' + ' + c(cb.fields[3]) + std(cb.fields[3]) : ''));
      P.push('// not used: ' + c(cb.recallShown) + ', the DIN 974-1 style counterbore tool size');
      body.push('    translate([0, 0, ' + id + '_plate_t - ' + id + '_cbore_depth]) cylinder(d = ' + id + '_cbore_d, h = ' + id + '_cbore_depth + cut_ext, $fn = fn_tol(' + id + '_cbore_d));');
    }
    var cs = fe.countersink;
    if (cs && cs.provenance !== 'refused') {
      P.push(id + '_csk_d = ' + fmt(cs.headD) + '; // countersink diameter at the face, ' + cs.angle + ' deg: ' + c(cs.fields[0]) + std(cs.fields[0]));
      P.push(id + '_csk_k = ' + fmt(cs.headH) + '; // head height for the GO gauge: ' + c(cs.fields[1]) + std(cs.fields[1]));
      P.push(id + '_csk_depth = (' + id + '_csk_d - ' + id + '_clear_d) / 2; // cone depth to the clearance hole at ' + cs.angle + ' deg included');
      body.push('    translate([0, 0, ' + id + '_plate_t - ' + id + '_csk_depth]) cylinder(h = ' + id + '_csk_depth + cut_ext, d1 = ' + id + '_clear_d, d2 = ' + id + '_csk_d + 2*cut_ext, $fn = fn_tol(' + id + '_csk_d + 2*cut_ext));');
      gauges.push('// GO gauge: the largest ' + key + ' countersunk head the table describes, seated flush. FLIGHT gauges: expect "clear".');
      gauges.push('module gauge_' + id + '_csk_go(){ translate([0, 0, ' + id + '_plate_t - ' + id + '_csk_k]) cylinder(h = ' + id + '_csk_k, d1 = ' + id + '_csk_d - 2*' + id + '_csk_k, d2 = ' + id + '_csk_d, $fn = fn_tol(' + id + '_csk_d)); }');
    }
    body.push('    translate([0, 0, -cut_ext]) cylinder(d = ' + id + '_clear_d, h = ' + id + '_plate_t + 2*cut_ext, $fn = fn_tol(' + id + '_clear_d));');
    var nu = fe.nut;
    var hexHelper = false;
    if (nu && nu.provenance !== 'refused') {
      hexHelper = true;
      P.push(id + '_nut_af = ' + fmt(nu.model) + '; // pocket across flats, band centre: ' + c(nu.fields[0]) + std(nu.fields[0]) + ' + ' + procNote + '; across corners ' + f3(nu.ac) + ' >= ' + c(nu.fields[1]));
      P.push(id + '_nut_af_max = ' + fmt(nu.af) + '; // the nut itself for the GO gauge: ' + c(nu.fields[0]));
      P.push(id + '_nut_h = ' + fmt(nu.depth) + '; // pocket depth: ' + c(nu.fields[3]) + std(nu.fields[3]));
      body.push('    translate([0, 0, -cut_ext]) ' + id + '_hex(' + id + '_nut_af, ' + id + '_nut_h + cut_ext);');
      gauges.push('// GO gauge: the nut at its largest across flats (s max) and height, in its pocket. FLIGHT gauges: expect "clear".');
      gauges.push('module gauge_' + id + '_nut_go(){ ' + id + '_hex(' + id + '_nut_af_max, ' + id + '_nut_h); }');
    }
    var tp = fe.tapped;
    var tappedBody = [];
    if (tp && tp.provenance !== 'refused' && tp.band) {
      P.push(id + '_part_t = ' + fmt(x.part_t) + '; // tapped (mating) part thickness (mm) [user]');
      var base = x.model_at === 'd1' ? c(tp.fields[0]) + std(tp.fields[0]) : c(tp.fields[1]) + ' (' + tp.fields[1].source + ')';
      P.push(id + '_tap_d = ' + fmt(tp.model) + '; // tapped hole, band centre: ' + base + ' + ' + procNote + '; limits ' + f3(tp.band.lo) + '..' + f3(tp.band.hi) + '. Drill ' + c(tp.fields[1]) + '; threads are not modelled');
      if (tp.end === 'blind') P.push(id + '_tap_depth = ' + fmt(tp.depth) + '; // thread depth: ' + c(tp.fields[3]) + ' (8.8 in 6061-T6) + ' + data.rules.engPitches[1] + ' pitches of ' + fmt(tp.pitch) + ' (table: "Add ' + data.rules.engPitches[0] + '-' + data.rules.engPitches[1] + ' pitches"); drill deeper by the tap lead (not in the table)');
      if (tp.end === 'blind') tappedBody.push('  translate([0, 0, ' + id + '_part_t - ' + id + '_tap_depth]) cylinder(d = ' + id + '_tap_d, h = ' + id + '_tap_depth + cut_ext, $fn = fn_tol(' + id + '_tap_d));');
      else tappedBody.push('  translate([0, 0, -cut_ext]) cylinder(d = ' + id + '_tap_d, h = ' + id + '_part_t + 2*cut_ext, $fn = fn_tol(' + id + '_tap_d));');
    }
    var out = L.concat(P).concat(['// --- end parameters ---', 'function fn_tol(d, tol=tess_tol) = max(24, ceil(180 / acos(1 - min(0.5, 2*tol/d))));', '']);
    if (hexHelper) out.push('// A regular hexagon given across flats, extruded along z from z = 0.', 'module ' + id + '_hex(af, h){ linear_extrude(h) polygon([for (i = [0:5]) (af / 2 / cos(30)) * [cos(60*i), sin(60*i)]]); }', '');
    out.push('// Clamped plate: every cut the ' + key + ' screw needs, as one solid to subtract.');
    out.push('module hole_stack_' + id + '_clamp(){', '  union(){'); out = out.concat(body); out.push('  }', '}');
    if (tappedBody.length) { out.push('', '// Mating part: the tapped hole, as a solid to subtract (its bottom face on z = 0).', 'module hole_stack_' + id + '_tapped(){'); out = out.concat(tappedBody); out.push('}'); }
    if (gauges.length) { out.push(''); out = out.concat(gauges); }
    return out.join('\n') + '\n';
  }

  /* ---------- SVG section ---------- */
  // A section through the axis (through the nut's flats). Material hatched; cuts in the page colour;
  // the screw head, washer and nut dashed; callouts coloured by provenance.
  function svg(res) {
    if (!res.geometry) return '';
    var g = res.geometry, cl = g.clamp, tp = g.tapped;
    var W = 360, padT = 16, padB = 18, colX = 214;
    var widest = Math.max(cl.hole.d, cl.top ? cl.top.d : 0, cl.bottom ? cl.bottom.ac : 0, cl.head ? cl.head.d : 0, cl.washer ? cl.washer.d : 0, tp ? tp.d : 0);
    var partW = widest * 2.2;
    var proud = (cl.head && cl.head.kind === 'button' ? cl.head.h : 0) + (cl.washer && cl.washer.at >= cl.t - 1e-9 ? cl.washer.t : 0);
    var totalH = cl.t + (tp ? tp.t : 0) + proud;
    var s = Math.min((colX - 24) / partW, 260 / totalH);
    var H = Math.round(padT + totalH * s + padB + 10);
    var cx = 12 + partW * s / 2;
    var y0 = padT + proud * s + cl.t * s; // y of the clamped plate's bottom face (z = 0)
    function Y(z) { return y0 - z * s; }
    function X(rr) { return cx + rr * s; }
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Section through the ' + res.key + ' hole stack">');
    o.push('<defs><pattern id="hs-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="hs-mat"/><line x1="0" y1="0" x2="0" y2="5" class="hs-hatchline"/></pattern></defs>');
    function rect(x1, y1, x2, y2, cls) { o.push('<rect x="' + r3(Math.min(x1, x2)) + '" y="' + r3(Math.min(y1, y2)) + '" width="' + r3(Math.abs(x2 - x1)) + '" height="' + r3(Math.abs(y2 - y1)) + '" class="' + cls + '"/>'); }
    function poly(pts, cls) { o.push('<polygon points="' + pts.map(function (p) { return r3(p[0]) + ',' + r3(p[1]); }).join(' ') + '" class="' + cls + '"/>'); }
    var half = partW / 2;
    // The cut wall as [z, r] points from the top face to the bottom face; the material on each side of
    // the axis is the plate rectangle up to that wall.
    function sidePolys(prof, T, Yf) {
      [1, -1].forEach(function (sg) {
        var pts = [[X(sg * half), Yf(T)]];
        prof.forEach(function (q) { pts.push([X(sg * q[1]), Yf(q[0])]); });
        pts.push([X(sg * half), Yf(0)]);
        poly(pts, 'hs-plate');
      });
    }
    var prof = [];
    if (cl.top && cl.top.kind === 'cbore') prof.push([cl.t, cl.top.d / 2], [cl.t - cl.top.depth, cl.top.d / 2], [cl.t - cl.top.depth, cl.hole.d / 2]);
    else if (cl.top && cl.top.kind === 'csk') prof.push([cl.t, cl.top.d / 2], [cl.t - cl.top.depth, cl.top.dc / 2]);
    else prof.push([cl.t, cl.hole.d / 2]);
    if (cl.bottom) prof.push([cl.bottom.depth, cl.hole.d / 2], [cl.bottom.depth, cl.bottom.af / 2], [0, cl.bottom.af / 2]);
    else prof.push([0, cl.hole.d / 2]);
    sidePolys(prof, cl.t, Y);
    if (cl.bottom) o.push('<line x1="' + r3(X(-cl.bottom.ac / 2)) + '" y1="' + r3(Y(cl.bottom.depth)) + '" x2="' + r3(X(cl.bottom.ac / 2)) + '" y2="' + r3(Y(cl.bottom.depth)) + '" class="hs-ac"/>');
    // tapped part below
    if (tp) {
      var yT = function (z) { return Y(0) + (tp.t - z) * s; };
      if (tp.through) sidePolys([[tp.t, tp.d / 2], [0, tp.d / 2]], tp.t, yT);
      else poly([[X(-half), yT(tp.t)], [X(-tp.d / 2), yT(tp.t)], [X(-tp.d / 2), yT(tp.t - tp.depth)], [X(tp.d / 2), yT(tp.t - tp.depth)], [X(tp.d / 2), yT(tp.t)], [X(half), yT(tp.t)], [X(half), yT(0)], [X(-half), yT(0)]], 'hs-plate');
    }
    // fasteners (dashed): the largest head, washer and nut the table describes
    if (cl.head) {
      if (cl.head.kind === 'socket') { var hb = cl.top ? cl.t - cl.top.depth + (cl.washer ? cl.washer.t : 0) : cl.t + (cl.washer ? cl.washer.t : 0); rect(X(-cl.head.d / 2), Y(hb), X(cl.head.d / 2), Y(hb + cl.head.h), 'hs-ghost'); }
      if (cl.head.kind === 'csk') poly([[X(-cl.head.d / 2), Y(cl.t)], [X(cl.head.d / 2), Y(cl.t)], [X(cl.head.d / 2 - cl.head.h), Y(cl.t - cl.head.h)], [X(-cl.head.d / 2 + cl.head.h), Y(cl.t - cl.head.h)]], 'hs-ghost');
      if (cl.head.kind === 'button') { var bb = cl.t + (cl.washer ? cl.washer.t : 0); rect(X(-cl.head.d / 2), Y(bb), X(cl.head.d / 2), Y(bb + cl.head.h), 'hs-ghost'); }
    }
    if (cl.washer) rect(X(-cl.washer.d / 2), Y(cl.washer.at), X(cl.washer.d / 2), Y(cl.washer.at + cl.washer.t), 'hs-ghost');
    if (cl.nut) rect(X(-cl.nut.af / 2), Y(cl.nut.h), X(cl.nut.af / 2), Y(0), 'hs-ghost');
    o.push('<line x1="' + r3(cx) + '" y1="' + (padT - 8) + '" x2="' + r3(cx) + '" y2="' + r3(Y(0) + (tp ? tp.t * s : 0) + 8) + '" class="hs-axis"/>');
    // callouts
    var labels = [];
    var byId = {}; res.features.forEach(function (f) { byId[f.id] = f; });
    function cls(p) { return p === 'source' ? 'hs-src' : p === 'default' ? 'hs-def' : p === 'recall' ? 'hs-rec' : 'hs-ref'; }
    if (cl.top && cl.top.kind === 'cbore') labels.push({ y: Y(cl.t - cl.top.depth / 2), x: X(cl.top.d / 2), t1: 'Ø' + f3(byId.counterbore.band.centre) + ' ±' + fmt(byId.counterbore.band.half), t2: 'counterbore ' + fmt(cl.top.depth) + ' deep', p: 'default' });
    if (cl.top && cl.top.kind === 'csk') labels.push({ y: Y(cl.t - cl.top.depth / 2), x: X((cl.top.d + cl.top.dc) / 4), t1: 'Ø' + fmt(cl.top.d) + ' × ' + byId.countersink.angle + '°', t2: 'countersink [recall]', p: 'recall' });
    var cf = byId.clearance;
    labels.push({ y: Y((cl.hole.from + cl.hole.to) / 2), x: X(cl.hole.d / 2), t1: cf.band ? 'Ø' + f3(cf.band.centre) + ' ±' + fmt(cf.band.half) : 'Ø' + fmt(cf.nominal) + ' band refused', t2: 'clearance H' + cf.grade + (cf.band ? ' ' + f3(cf.band.lo) + '–' + f3(cf.band.hi) : ''), p: cf.band ? cf.provenance : 'refused' });
    if (cl.bottom) labels.push({ y: Y(cl.bottom.depth / 2), x: X(cl.bottom.af / 2), t1: 'hex ' + f3(cl.bottom.af) + ' AF, ' + f3(cl.bottom.ac) + ' AC', t2: 'nut pocket ' + fmt(cl.bottom.depth) + ' deep', p: byId.nut.provenance });
    if (tp) labels.push({ y: Y(0) + (tp.through ? tp.t / 2 : tp.depth / 2) * s, x: X(tp.d / 2), t1: 'Ø' + f3(byId.tapped.band.centre) + ' ±' + fmt(byId.tapped.band.half), t2: (res.input.model_at === 'd1' ? 'tapped at D1 ' : 'tapped at drill ') + (tp.through ? 'through' : fmt(tp.depth) + ' deep'), p: 'default' });
    if (cl.head && cl.head.kind === 'button') labels.push({ y: Y(cl.t + proud / 2), x: X(cl.head.d / 2), t1: 'button head ' + fmt(cl.head.d) + ' × ' + fmt(cl.head.h), t2: 'proud, nothing cut [recall]', p: 'recall' });
    labels.sort(function (a, b) { return a.y - b.y; });
    var last = -1e9;
    labels.forEach(function (lb) {
      var ty = Math.max(lb.y, last + 26); last = ty;
      o.push('<polyline points="' + r3(lb.x) + ',' + r3(lb.y) + ' ' + (colX - 6) + ',' + r3(ty) + '" class="hs-lead ' + cls(lb.p) + '"/>');
      o.push('<circle cx="' + r3(lb.x) + '" cy="' + r3(lb.y) + '" r="1.6" class="hs-dot ' + cls(lb.p) + '"/>');
      o.push('<text x="' + colX + '" y="' + r3(ty - 1) + '" class="hs-t1 ' + cls(lb.p) + '">' + esc(lb.t1) + '</text>');
      o.push('<text x="' + colX + '" y="' + r3(ty + 11) + '" class="hs-t2">' + esc(lb.t2) + '</text>');
    });
    var Hfinal = Math.max(H, Math.round(last + 20));
    o[0] = o[0].replace('viewBox="0 0 ' + W + ' ' + H + '"', 'viewBox="0 0 ' + W + ' ' + Hfinal + '"');
    o.push('<text x="12" y="' + (Hfinal - 4) + '" class="hs-t2">' + esc('section through the axis; dashed: the largest head, washer, nut') + '</text>');
    o.push('</svg>');
    return o.join('');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- the stack as text (CLI, example.txt) ---------- */
  function text(res) {
    var L = [], x = res.input;
    if (!res.key) {
      L.push('REFUSED');
      res.refusals.forEach(function (q) { L.push('  ' + q.feature + ' [' + q.code + ']: ' + q.reason, '    what would help: ' + q.help); });
      return L.join('\n') + '\n';
    }
    L.push('Hole stack ' + res.key + '×' + fmt(res.pitch) + ' · head ' + x.head + (x.washer ? ' + washer' : '') + ' · ISO 273 ' + x.series + ' · plate ' + fmt(x.plate_t) + ' mm · far end ' + x.far + (x.far === 'tapped' ? ' (' + x.tap_end + ', part ' + fmt(x.part_t) + ' mm, ' + x.drill + ' drill, modelled at ' + (x.model_at === 'd1' ? 'D1' : 'the tap drill') + ')' : '') + ' · process ' + x.process);
    L.push('');
    res.features.forEach(function (f) {
      var head = '  ' + f.label;
      if (f.id === 'nut') head += ': ' + f3(f.band.centre) + ' ±' + fmt(f.band.half) + ' across flats (limits ' + f3(f.band.lo) + '–' + f3(f.band.hi) + '), ' + f3(f.ac) + ' across corners';
      else if (f.band) head += ': Ø' + f3(f.band.centre) + ' ±' + fmt(f.band.half) + ' (limits ' + f3(f.band.lo) + '–' + f3(f.band.hi) + ')';
      else if (f.id === 'clearance') head += ': Ø' + fmt(f.nominal) + ', band refused';
      else if (f.id === 'countersink') head += ': Ø' + fmt(f.model) + ' at the face, ' + f.angle + '° included, ' + f3(f.depth) + ' deep to the hole';
      if (f.depth != null && f.id !== 'countersink' && f.id !== 'tapped') head += ', ' + fmt(f.depth) + ' deep';
      if (f.id === 'tapped') head += ', ' + (f.end === 'blind' ? fmt(f.depth) + ' deep' : 'through ' + fmt(f.partT));
      head += '  → ' + (f.provenance === 'refused' ? 'REFUSED' : f.id === 'nut' || f.id === 'countersink' ? 'FLIGHT gauge, GO, expect clear' : f.provenance === 'source' ? 'FLIGHT tol_src source' : f.provenance === 'default' ? 'FLIGHT tol_src default' : f.provenance === 'recall' ? (f.id === 'button' ? 'nothing cut (recall)' : 'gauge only (recall data)') : 'REFUSED');
      L.push(head);
      f.fields.forEach(function (q) { L.push('      ' + q.field + ' = ' + (q.value == null ? 'null' : fmt(q.value)) + '  [' + q.conf + ']  ' + q.source); });
      if (f.band && f.band.it_um) L.push('      fits.json ' + f.band.stepName + ' mm IT' + f.grade + ' = ' + f.band.it_um + ' um  [' + f.band.conf + ']');
      if (f.recallShown) L.push('      shown, not used: ' + f.recallShown.field + ' = ' + fmt(f.recallShown.value) + '  [' + f.recallShown.conf + ']');
      if (f.appCheck) L.push('      PartForge threadCheck at the table\'s Le ' + fmt(f.appCheck.Le) + ' mm: ' + (f.appCheck.ok ? 'PASS' : 'FAIL') + ' (strip needs ' + f3(f.appCheck.Le_req_mm) + ', rule ' + fmt(f.appCheck.rule_mm) + '); at this stack\'s ' + fmt(f.appCheckAtLength.Le) + ' mm: ' + (f.appCheckAtLength.ok ? 'PASS' : 'FAIL'));
    });
    if (res.refusals.length) {
      L.push('', 'Refused:');
      res.refusals.forEach(function (q) { L.push('  ' + q.feature + ' [' + q.code + ']: ' + q.reason, '    what would help: ' + q.help); });
    }
    if (res.checks.length) {
      L.push('', 'Checks:');
      res.checks.forEach(function (q) { L.push('  ' + (q.level === 'warn' ? '! ' : '- ') + q.text); });
    }
    return L.join('\n') + '\n';
  }

  return { HEADS: HEADS, FARS: FARS, SERIES: SERIES, DEFAULTS: DEFAULTS, makeData: makeData, tableRules: tableRules, fieldConf: fieldConf, fieldBasis: fieldBasis, citable: citable,
    itBand: itBand, parseSize: parseSize, build: build, flightBlock: flightBlock, scad: scad, svg: svg, text: text, fmt: fmt, f3: f3, idOf: idOf };
});
