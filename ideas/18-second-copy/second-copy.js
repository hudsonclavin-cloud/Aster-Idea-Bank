/* Second Copy — pairs the numbers PartForge's flight doctrine, GRADE_SY and flight templates restate
   from its reference tables with the table key beside them, and says whether the copies agree.
   Pure (no DOM, fs or clock); a classic script (window.SecondCopy) and a require() module.

   Verdicts: AGREES (equal at the literal's printed precision, or a design value inside the band it
   cites); DISAGREES (a row and column exist and differ; fails a run); UNBACKED (key recognised, no
   row carries it; never called wrong, no value proposed); NON-CLASS (a thread's clearance hole, no
   class named, matching none; its stated reason quoted); MAPPED (no row; read as one by a stated
   assumption); QUOTED (inside a sentence reporting a past error; not judged); COPY-DRIFT (a template
   line that differs from the copy index.html ships; fails a run).
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SecondCopy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IN = 25.4;          // mm per inch, exact by definition
  var IN2 = 645.16;       // mm² per in², exact
  var EPS = 1e-9;
  var VERDICTS = ['DISAGREES', 'COPY-DRIFT', 'NON-CLASS', 'UNBACKED', 'MAPPED', 'QUOTED', 'AGREES'];
  var FAILING = { DISAGREES: true, 'COPY-DRIFT': true };

  // ------------------------------------------------------------------ numbers and precision
  function parseNum(text) {
    var raw = String(text).trim();
    var t = raw.replace(/^[−-]/, '-').replace(/^\+/, '');
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(t)) return null;
    var parts = t.split('.');
    return { text: raw, value: parseFloat(t), decimals: parts.length > 1 ? parts[1].length : 0 };
  }
  function halfUnit(decimals) { return 0.5 * Math.pow(10, -decimals); }
  /* The declared tolerance: a printed literal agrees with a table value when it is that value
     correctly rounded to the literal's own precision. Fixed before any comparison was run. */
  function agrees(lit, tableValue) {
    return tableValue != null && isFinite(tableValue) && Math.abs(lit.value - tableValue) <= halfUnit(lit.decimals) + EPS;
  }
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return String(v);
    var s = v.toFixed(d == null ? 3 : d);
    return d == null ? s.replace(/\.?0+$/, '') : s;
  }

  function signed(v) { return v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0'; }
  function pick(o, keys) {
    var r = {};
    keys.forEach(function (k) { if (o && o[k] !== undefined) r[k] = o[k]; });
    return r;
  }

  // ------------------------------------------------------------------ table excerpts
  /* One function per table, used by build-data.mjs (snapshots) and by the CLI in --repo mode (live
     JSON), so the two paths read the same shapes. */
  var METRIC_FIELDS = ['key', 'd_mm', 'tap_drill_mm', 'clearance_fine_mm', 'clearance_medium_mm', 'clearance_coarse_mm', 'tensile_stress_area_mm2', 'confidence'];
  // inch columns only: they are the authority (the table's mm columns are in × 25.4 rounded to 3 places)
  var UN_FIELDS = ['key', 'major_in', 'tap_drill_75', 'tap_drill_75_in', 'tap_drill_50', 'tap_drill_50_in',
    'clearance_close', 'clearance_close_in', 'clearance_close_nom_in', 'clearance_normal', 'clearance_normal_in', 'clearance_normal_nom_in',
    'clearance_loose', 'clearance_loose_in', 'clearance_loose_nom_in', 'tensile_stress_area_in2', 'confidence'];
  var EXCERPT = {
    fasteners_metric: function (d) {
      return {
        table: d.table, license_note: d.license_note,
        field_sources: pick(d.field_sources, METRIC_FIELDS),
        rows_source: d.rows[0] && d.rows[0].source,
        rows: d.rows.map(function (r) {
          var o = pick(r, METRIC_FIELDS);
          var fc = pick(r.field_confidence || {}, METRIC_FIELDS);
          if (Object.keys(fc).length) o.field_confidence = fc;
          if (r.source !== d.rows[0].source) o.source = r.source;
          return o;
        }),
        grades: d.grades
      };
    },
    fasteners_un: function (d) {
      return {
        table: d.table, license_note: d.license_note,
        rows_source: d.rows[0] && d.rows[0].source,
        rows: d.rows.map(function (r) {
          var o = pick(r, UN_FIELDS);
          // field confidences of the inch values compared, only where they differ from the row's own
          var fc = {};
          UN_FIELDS.forEach(function (k) { var v = (r.field_confidence || {})[k]; if (/_in2?$/.test(k) && v && v !== r.confidence) fc[k] = v; });
          if (Object.keys(fc).length) o.field_confidence = fc;
          if (r.source !== d.rows[0].source) o.source = r.source;
          return o;
        })
      };
    },
    fits: function (d) {
      var o = JSON.parse(JSON.stringify(d));
      delete o.columns;
      (o.fits || []).forEach(function (f) { delete f.use; });
      var src = o.rows[0] && o.rows[0].source;
      if (o.rows.every(function (r) { return r.source === src; })) { o.rows_source = src; o.rows.forEach(function (r) { delete r.source; }); }
      return o;
    },
    orings_as568: function (d) {
      var g = d.supplement.gland_parker_ord5700;
      // the gland rows keep every band and its confidence; per-row source strings are kept once per chart, notes dropped
      var slim = function (rows) {
        return rows.map(function (r) {
          var o = {};
          Object.keys(r).forEach(function (k) {
            if (k === 'source' || k === 'tolerances_in' || /^max_eccentricity/.test(k)) return;
            var v = r[k];
            o[k] = v && typeof v === 'object' && !Array.isArray(v) ? pick(v, ['in', 'mm', 'pct', 'confidence']) : v;
          });
          return o;
        });
      };
      return {
        table: d.table, license_note: d.license_note,
        how_to_read: g.how_to_read,
        face_seal_chart_4_3_source: g.face_seal_chart_4_3[0].source,
        face_seal_chart_4_3: slim(g.face_seal_chart_4_3),
        radial_static_table_4_2_source: g.radial_static_table_4_2[0].source,
        radial_static_table_4_2: slim(g.radial_static_table_4_2),
        project_issues: d.supplement.project_issues,
        rows_columns: '[dash, id_in, cs_in, confidence]; mm = in × 25.4',
        rows: d.rows.map(function (r) { return [r.dash, r.id_in, r.cs_in, r.confidence]; })
      };
    },
    design_factors_nasa: function (d) {
      return {
        table: d.table, license_note: d.license_note,
        rows: d.rows.filter(function (r) { return r.ultimate_design_factor != null || r.yield_design_factor != null || r.proof_test_factor != null; })
          .map(function (r) { return pick(r, ['key', 'applies_to', 'verification_approach', 'ultimate_design_factor', 'yield_design_factor', 'qualification_test_factor', 'proof_test_factor', 'clause', 'confidence']); })
      };
    },
    motor_perf: function (d) {
      return {
        table: d.table, license_note: d.license_note, rows_count: d.rows.length,
        filter: 'rows with max_thrust_N >= 5000 (the large motors a "the table says N kN" sentence can name)',
        rows_columns: '[name, designation, mfr, d_mm, max_thrust_N, max_thrust_src, availability, confidence]',
        rows: d.rows.filter(function (r) { return r.max_thrust_N >= 5000; })
          .map(function (r) { return [r.name, r.designation, r.mfr, r.d_mm, r.max_thrust_N, r.max_thrust_src, r.availability, r.confidence]; })
      };
    },
    motors: function (d) {
      var by = {};
      d.rows.forEach(function (r) {
        var k = String(r.d_mm);
        if (!by[k]) by[k] = { d_mm: r.d_mm, cases: 0, example: r.mfr + ' ' + r.case, confidence: r.confidence };
        by[k].cases++;
      });
      return { table: d.table, license_note: d.license_note, diameters: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.d_mm - b.d_mm; }) };
    },
    airframes: function (d) {
      return {
        table: d.table, license_note: d.license_note,
        filter: 'BodyTube rows with od_mm < 110 (motor-mount-tube sizes) or 150 < id_mm < 155 (the 6 in family)',
        rows_columns: '[vendor, id_mm, od_mm, first part number, confidence]',
        rows: d.rows.filter(function (r) { return r.kind === 'BodyTube' && (r.od_mm < 110 || (r.id_mm > 150 && r.id_mm < 155)); })
          .map(function (r) { return [r.vendor, r.id_mm, r.od_mm, (r.pns || [])[0] || '', r.confidence]; })
      };
    }
  };
  var TABLE_FILES = {
    fasteners_metric: 'data/tables/fasteners_metric.json', fasteners_un: 'data/tables/fasteners_un.json',
    fits: 'data/tables/fits.json', orings_as568: 'data/tables/orings_as568.json',
    design_factors_nasa: 'data/tables/design_factors_nasa.json', motor_perf: 'data/tables/motor_perf.json', motors: 'data/tables/motors.json',
    airframes: 'data/tables/airframes.json'
  };

  // ------------------------------------------------------------------ masking identifiers
  /* Names with digits in them (standards, materials, thread and fit keys), blanked before bands and the
     unpaired inventory are scanned; offsets survive. Heuristic: only the inventory depends on it. */
  var IDENT_RES = [
    /\bAS568[A-Z]?(?:-\d+)?/g, /\bORD\s*5700\b/g, /\b(?:[Dd]esign\s+)?(?:[Cc]hart|[Tt]able|Figure)\s+\d+(?:-\d+)?\b/g,
    /\bISO\s+\d+(?:-\d+)?(?::\d{4})?(?:-[a-z])?/g, /\bASME\s+B\d+(?:\.\d+)*M?(?:-\d{4})?/g, /\bNASA-STD-\d+[A-Z]?/g,
    /\bSAE\s+J\d+/g, /\bTN\s+\d+/g, /\bT?FSR\s+\d+/g, /\bDIN\s+\d+(?:-\d+)?/g, /\bB30\.\d+/g,
    /\b\d{4}-T\d+\b/g, /\b17-4\s?PH\b/g, /\bH\d{3,4}\b/g, /\bTi-6Al-4V\b/g, /\b(?:G10|G12|FR4|PA12|PA\s?2200)\b/g,
    /\b[Aa][24]-\d0\b/g, /\b18-8\b/g, /\bInconel\s+\d+/g, /\b(?:1010|1515)\b/g, /\bSK\d+\b/g,
    /(?<![\w.])M\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?(?![\w.]*\d)/g, /#\d+(?:-\d+)?/g, /\b\d+\/\d+-\d+\b/g, /\b\d+\/\d+\s*in\b/g,
    /\b\d+\/\d+(?=\s*(?:NPT|in all-thread))/g, /\b\d+-\d+(?=\s+(?:nylon|NPT))/g, /\b[A-Z]\d{1,2}\/[a-z]\d{1,2}\b/g,
    /(?<![\w.])[HhgkpnfdeKN]\d{1,2}(?![\w.])/g, /\b\d+-axis\b/g, /\b[23]D\b/g, /\b\d+(?:\.\d+)?-in\b/g, /-\d{3}\b(?=\.\.)/g, /\.\.-\d{3}\b/g
  ];
  function mask(text) {
    var chars = text.split('');
    IDENT_RES.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text))) {
        for (var i = m.index; i < m.index + m[0].length; i++) if (chars[i] !== '\n') chars[i] = ' ';
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    return chars.join('');
  }

  // ------------------------------------------------------------------ table lookups
  function unRowsFor(T, key) {
    var rows = T.fasteners_un.rows;
    var exact = rows.filter(function (r) { return r.key === key; });
    if (exact.length) return exact;
    return rows.filter(function (r) { return r.key.indexOf(key + '-') === 0; });
  }
  /* A thread designation as written ("M6", "#8-32", "8-32", "1/4-20", "1/4 in", "#10", "1/4"). */
  function parseThread(T, raw) {
    var s = String(raw).trim().replace(/\s+/g, ' ');
    var m;
    if ((m = /^M(\d+(?:\.\d+)?)(?:x\d+(?:\.\d+)?)?$/.exec(s))) {
      var key = 'M' + m[1];
      var row = T.fasteners_metric.rows.filter(function (r) { return r.key === key; })[0];
      return row ? { sys: 'metric', key: key, rows: [row], text: raw } : null;
    }
    var unKey = null, family = false;
    if ((m = /^#?(\d+)-(\d+)$/.exec(s)) && +m[1] <= 12) unKey = '#' + m[1] + '-' + m[2];
    else if ((m = /^(\d+\/\d+)-(\d+)$/.exec(s))) unKey = m[1] + '-' + m[2];
    else if ((m = /^#(\d+)$/.exec(s))) { unKey = '#' + m[1]; family = true; }
    else if ((m = /^(\d+\/\d+)(?: in)?$/.exec(s))) { unKey = m[1]; family = true; }
    if (!unKey) return null;
    var rows = unRowsFor(T, unKey);
    if (!rows.length || (!family && rows[0].key !== unKey)) return null;
    return { sys: 'un', key: unKey, family: family, rows: rows, text: raw };
  }

  function rowConfidence(row, field) {
    var fc = row.field_confidence && row.field_confidence[field];
    return fc && fc !== row.confidence ? row.confidence + ' row, ' + field + ' ' + fc : row.confidence;
  }

  /* Candidate table values for (thread, column): UN from the inch columns × 25.4 (the mm columns are
     rounded copies); a clearance agrees with the named drill or B18.2.8's printed nominal. */
  function threadCandidates(th, col, unit) {
    var out = [];
    th.rows.forEach(function (r) {
      if (th.sys === 'metric') {
        var f = { fine: 'clearance_fine_mm', medium: 'clearance_medium_mm', coarse: 'clearance_coarse_mm', tap: 'tap_drill_mm', major: 'd_mm', stress: 'tensile_stress_area_mm2' }[col];
        if (f && r[f] != null && unit !== 'in') out.push({ value: r[f], display: fmt(r[f]), row: r.key, column: f, confidence: rowConfidence(r, f), file: 'fasteners_metric.json' });
        return;
      }
      var add = function (vIn, column, label, conf) {
        if (vIn == null) return;
        var v = col === 'stress' ? (unit === 'in2' ? vIn : vIn * IN2) : (unit === 'in' ? vIn : vIn * IN);
        out.push({ value: v, display: fmt(v, unit === 'in' ? 4 : 3) + (label ? ' (' + label + ')' : ''), row: r.key, column: column, confidence: rowConfidence(r, column), file: 'fasteners_un.json' });
      };
      if (col === 'close' || col === 'normal' || col === 'loose') {
        add(r['clearance_' + col + '_in'], 'clearance_' + col + '_in', r['clearance_' + col] + ' drill');
        add(r['clearance_' + col + '_nom_in'], 'clearance_' + col + '_nom_in', 'B18.2.8 nominal');
      } else if (col === 'tap') {
        add(r.tap_drill_75_in, 'tap_drill_75_in', r.tap_drill_75 + ', 75 %');
        add(r.tap_drill_50_in, 'tap_drill_50_in', r.tap_drill_50 + ', 50 %');
      } else if (col === 'major') add(r.major_in, 'major_in', 'basic major');
      else if (col === 'stress') add(r.tensile_stress_area_in2, 'tensile_stress_area_in2', 'As');
    });
    return out;
  }
  var CLASSES = { metric: ['fine', 'medium', 'coarse'], un: ['close', 'normal', 'loose'] };
  var COL_LABEL = { fine: 'clearance, ISO 273 fine', medium: 'clearance, ISO 273 medium', coarse: 'clearance, ISO 273 coarse',
    close: 'clearance, B18.2.8 close', normal: 'clearance, B18.2.8 normal', loose: 'clearance, B18.2.8 loose',
    tap: 'tap drill', major: 'major diameter', stress: 'tensile stress area', any: 'clearance, class not named', insert: 'heat-set insert hole' };

  /* Which table value of the same system does this literal equal, at its precision? (a diagnosis
     for a disagreement: the evaluation's "#10 normal 5.11 is the 1/4-20 tap drill") */
  function looksLike(T, sys, lit, unit) {
    var hits = [];
    if (sys === 'metric') {
      T.fasteners_metric.rows.forEach(function (r) {
        ['clearance_fine_mm', 'clearance_medium_mm', 'clearance_coarse_mm', 'tap_drill_mm', 'd_mm'].forEach(function (f) {
          if (unit !== 'in' && agrees(lit, r[f])) hits.push(r.key + ' ' + f.replace(/_mm$/, '') + ' ' + fmt(r[f]));
        });
      });
    } else {
      T.fasteners_un.rows.forEach(function (r) {
        [['clearance_close_in', 'close (' + r.clearance_close + ')'], ['clearance_close_nom_in', 'close nominal'], ['clearance_normal_in', 'normal (' + r.clearance_normal + ')'],
          ['clearance_normal_nom_in', 'normal nominal'], ['clearance_loose_in', 'loose (' + r.clearance_loose + ')'], ['clearance_loose_nom_in', 'loose nominal'],
          ['tap_drill_75_in', '75 % tap drill (' + r.tap_drill_75 + ')'], ['tap_drill_50_in', '50 % tap drill (' + r.tap_drill_50 + ')'], ['major_in', 'major']].forEach(function (p) {
          if (r[p[0]] == null) return;
          var v = unit === 'in' ? r[p[0]] : r[p[0]] * IN;
          if (agrees(lit, v)) hits.push(r.key + ' ' + p[1] + ' ' + fmt(v, 3));
        });
      });
    }
    // one family shares clearances (1/4-20 and 1/4-28): keep the first of identical descriptions
    var seen = {};
    return hits.filter(function (h) { var k = h.replace(/^\S+/, ''); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 3);
  }

  // ------------------------------------------------------------------ findings
  function Finding(ctx, o) {
    var f = {
      source: ctx.source, file: ctx.file, line: ctx.lineAt(o.at != null ? o.at : 0),
      family: o.family, key: o.key, what: o.what, literal: o.literal, unit: o.unit || '',
      verdict: o.verdict, table: o.table || null, span: (o.span || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      note: o.note || '', looksLike: o.looksLike && o.looksLike.length ? o.looksLike : undefined
    };
    if (!f.looksLike) delete f.looksLike;
    ctx.findings.push(f);
    if (o.claim) o.claim.forEach(function (c) { ctx.claims.push(c); });
    return f;
  }
  function makeCtx(source, file, text, lineBase) {
    var nl = [];
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) nl.push(i);
    return {
      source: source, file: file, text: text, findings: [], claims: [],
      lineAt: function (off) {
        var lo = 0, hi = nl.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (nl[mid] < off) lo = mid + 1; else hi = mid; }
        return (lineBase || 1) + lo;
      }
    };
  }
  function claim(start, len) { return [start, start + len]; }

  /* Judge a fastener literal against one column (or every class when the class is not named). */
  function judgeThread(T, ctx, o) {
    var th = o.thread, lit = o.lit, unit = o.unit || 'mm';
    var base = { family: th.sys === 'metric' ? 'fasteners_metric' : 'fasteners_un', key: th.key, literal: lit.text, unit: unit, at: o.at, span: o.span, claim: o.claim };
    if (o.col === 'insert') {
      return Finding(ctx, Object.assign(base, { what: COL_LABEL.insert, verdict: 'UNBACKED', note: 'no PartForge table carries heat-set insert hole sizes (fasteners_metric has an STI/helical-insert drill, a different part); insert hole sizes are the insert maker\'s' }));
    }
    if (o.col === 'any') {
      var classes = CLASSES[th.sys], best = null;
      classes.forEach(function (c) {
        threadCandidates(th, c, unit).forEach(function (cand) { if (!best && agrees(lit, cand.value)) best = { c: c, cand: cand }; });
      });
      if (best) return Finding(ctx, Object.assign(base, { what: COL_LABEL[best.c] + ' (class read from the value)', verdict: 'AGREES', table: best.cand }));
      var listed = classes.map(function (c) {
        var cs = threadCandidates(th, c, unit);
        return c + ' ' + (cs.length ? cs.filter(function (x, i, a) { return a.findIndex(function (y) { return y.display === x.display; }) === i; }).map(function (x) { return x.display.replace(/ \(.*\)$/, ''); }).join('/') : '—');
      }).join(', ');
      return Finding(ctx, Object.assign(base, {
        what: COL_LABEL.any, verdict: 'NON-CLASS',
        table: { display: listed, file: base.family + '.json', row: th.rows.map(function (r) { return r.key; }).join(', '), column: 'clearance classes', confidence: th.rows[0].confidence },
        note: o.reason ? 'stated reason: ' + o.reason : 'no reason stated on this line'
      }));
    }
    var cands = threadCandidates(th, o.col, unit);
    if (!cands.length) return Finding(ctx, Object.assign(base, { what: COL_LABEL[o.col] || o.col, verdict: 'UNBACKED', note: 'the table carries no ' + (COL_LABEL[o.col] || o.col) + ' for ' + th.key }));
    var hit = cands.filter(function (c) { return agrees(lit, c.value); })[0];
    if (hit) return Finding(ctx, Object.assign(base, { what: COL_LABEL[o.col] || o.col, verdict: 'AGREES', table: hit }));
    var shown = cands.filter(function (x, i, a) { return a.findIndex(function (y) { return y.display === x.display; }) === i; });
    return Finding(ctx, Object.assign(base, {
      what: COL_LABEL[o.col] || o.col, verdict: 'DISAGREES',
      table: { value: shown[0].value, display: shown.map(function (c) { return c.display; }).join(' / '), file: shown[0].file, row: shown[0].row, column: shown[0].column, confidence: shown[0].confidence },
      looksLike: looksLike(T, th.sys, lit, unit)
    }));
  }

  // ------------------------------------------------------------------ sentence helpers
  function sentenceBounds(text, pos) {
    var start = 0, i;
    for (i = pos - 1; i >= 0; i--) {
      if (text[i] === '\n') { start = i + 1; break; }
      if (text[i] === ' ' && text[i - 1] === '.' && !/\d/.test(text[i - 2] || '') && !/e\.g|i\.e/.test(text.slice(i - 4, i))) { start = i + 1; break; }
    }
    var end = text.length;
    for (i = pos; i < text.length; i++) {
      if (text[i] === '\n') { end = i; break; }
      if (text[i] === '.' && (text[i + 1] === ' ' || text[i + 1] === '\n' || i + 1 === text.length) && !/\d/.test(text[i - 1] || '')) { end = i + 1; break; }
    }
    return [start, end];
  }

  // ------------------------------------------------------------------ doctrine resolvers
  var NUM = '(\\d+\\.\\d+|\\d+)';

  /* "M2 2.4, M2.5 2.9 …" and "#4 3.26 / 2.95 …", "#4-40 2.26 (#43)": a key immediately followed by
     its number; the column comes from the last context phrase earlier in the same sentence. */
  var CTX_RE = /(tap drills?(?:\s*\([^)]*\))?)|(UN clearance\s*\(([^)]*)\))|(\bfine series\b|ISO 273 fine)|(ISO 273 medium)|(ISO 273 coarse|\bcoarse series\b)|(\bclearance holes?\b)/gi;
  function listContext(text, sStart, pos) {
    CTX_RE.lastIndex = sStart;
    var m, last = null;
    while ((m = CTX_RE.exec(text)) && m.index < pos) last = m;
    if (!last) return null;
    if (last[1]) return { cols: ['tap'], phrase: last[0] };
    if (last[2]) {
      var order = (last[3].match(/\b(close|normal|loose)\b/gi) || []).map(function (s) { return s.toLowerCase(); });
      return { cols: order.length ? order : ['any'], phrase: last[0] };
    }
    if (last[4]) return { cols: ['fine'], phrase: last[0] };
    if (last[5]) return { cols: ['medium'], phrase: last[0] };
    if (last[6]) return { cols: ['coarse'], phrase: last[0] };
    return { cols: ['any'], phrase: last[0] };
  }
  function resolveKeyLists(T, ctx) {
    var text = ctx.text;
    var re = new RegExp('(?<![\\w#/.])(M\\d+(?:\\.\\d+)?|#\\d+(?:-\\d+)?|\\d+/\\d+(?:-\\d+)?)\\s+' + NUM + '(?:\\s*/\\s*' + NUM + ')?(?:\\s*\\((#\\d+|[A-Z]|\\d+/\\d+)\\))?(?=[,;.)\\s]|$)', 'g');
    var m;
    while ((m = re.exec(text))) {
      var th = parseThread(T, m[1]);
      if (!th) continue;
      var sb = sentenceBounds(text, m.index);
      var c = listContext(text, sb[0], m.index);
      if (!c) continue;                       // a key and a number with no column named: left unpaired
      var nums = [m[2], m[3]].filter(Boolean);
      var numStart = m.index + m[0].indexOf(m[2], m[1].length);
      var off = numStart;
      nums.forEach(function (n, i) {
        var at = text.indexOf(n, off);
        off = at + n.length;
        var col = c.cols[Math.min(i, c.cols.length - 1)];
        judgeThread(T, ctx, { thread: th, lit: parseNum(n), col: col, at: at, span: m[0] + '   [' + c.phrase + ']', claim: [claim(m.index, m[1].length), claim(at, n.length)] });
      });
      if (m[4]) {                              // a drill name in parentheses: compare with the named tap drill
        var nameAt = m.index + m[0].lastIndexOf(m[4]);
        var want = th.rows.map(function (r) { return r.tap_drill_75; });
        var ok = c.cols[0] === 'tap' && want.indexOf(m[4]) >= 0;
        Finding(ctx, { family: 'fasteners_un', key: th.key, what: 'tap drill name', literal: m[4], verdict: c.cols[0] !== 'tap' ? 'UNBACKED' : ok ? 'AGREES' : 'DISAGREES', at: nameAt, span: m[0],
          table: { display: want.join(' / '), file: 'fasteners_un.json', row: th.key, column: 'tap_drill_75', confidence: th.rows[0].confidence }, claim: [claim(nameAt, m[4].length)] });
      }
    }
  }

  /* "6.75 mm the CLOSE hole", "7.14 mm the normal one", "6.76 mm was the NORMAL hole for 1/4 in". */
  function resolveClassSentences(T, ctx) {
    var text = ctx.text;
    var re = new RegExp(NUM + '\\s*mm\\s+(?:was\\s+)?the\\s+(close|normal|loose)\\s+(?:hole|one)(?:\\s+for\\s+(\\d+/\\d+(?:\\s*in)?|#\\d+(?:-\\d+)?|M\\d+))?', 'gi');
    var m;
    while ((m = re.exec(text))) {
      var sb = sentenceBounds(text, m.index);
      var keyText = m[3];
      if (!keyText) {                          // the nearest thread key in the same sentence
        var sent = text.slice(sb[0], sb[1]);
        var km = sent.match(/\d+\/\d+\s*in\b|#\d+-\d+|\d+\/\d+-\d+/);
        keyText = km && km[0];
      }
      var th = keyText && parseThread(T, keyText.replace(/\s*in$/, ''));
      if (!th) continue;
      // a quotation of a past error: from a "said"/"used to" marker to the next comma or "where"
      var before = text.slice(sb[0], m.index);
      var quoted = /\b(said|used to)\b[^,]*$/.test(before);
      var lit = parseNum(m[1]);
      if (quoted) {
        Finding(ctx, { family: 'fasteners_un', key: th.key, what: COL_LABEL[m[2].toLowerCase()], literal: m[1], unit: 'mm', verdict: 'QUOTED', at: m.index, span: m[0],
          note: 'reports a past error ("' + before.match(/\b(said|used to)\b[^,]*$/)[0].trim().slice(0, 50) + '…"); listed, not judged', claim: [claim(m.index, m[1].length)] });
        continue;
      }
      judgeThread(T, ctx, { thread: th, lit: lit, col: m[2].toLowerCase(), at: m.index, span: m[0], claim: [claim(m.index, m[1].length)] });
    }
  }

  /* ISO 286 zones: "at Ø18–30 H7 = +21/0, g6 = −7/−20 …" in a sentence that says μm. */
  function fitStepByRange(T, a, b) {
    return T.fits.rows.filter(function (r) { return r.from_mm === a && r.to_mm === b; })[0] || null;
  }
  function fitStepFor(T, mm) {             // dbFit's own rule: mm > from_mm && mm <= to_mm
    return T.fits.rows.filter(function (r) { return mm > r.from_mm && mm <= r.to_mm; })[0] || null;
  }
  /* The zone in µm about the nominal, exactly as dbFit() builds it: H holes run 0..+IT; h shafts
     0..−IT; d e f g shafts es−IT..es; k and n shafts ei..ei+IT, with k's deviation zero outside
     grades 4–7. Any other letter is not in the table. */
  function zoneUm(row, letter, grade) {
    var it = row.it_um[grade];
    var isHole = letter === letter.toUpperCase();
    if (it == null) return { unbacked: 'IT' + grade + ' is not carried for ' + row.from_mm + '–' + row.to_mm + ' mm' + (isWithheld(row, grade) ? ' (withheld as disputed)' : '') };
    if (isHole) {
      if (letter !== 'H') return { unbacked: 'hole letter ' + letter + ' is not in fits.json (it is hole-basis: H only)', it: it, isHole: true };
      return { lo: 0, hi: it, it: it, isHole: true, dev: 0 };
    }
    var es;
    if (letter === 'h') es = 0;
    else if (letter === 'k' && !(grade >= 4 && grade <= 7)) es = 0;
    else es = row.shaft_es_um[letter];
    if (es == null) return { unbacked: 'shaft letter ' + letter + ' is not in fits.json (it carries ' + Object.keys(row.shaft_es_um).join(' ') + ')', it: it, isHole: false };
    var transition = letter === 'k' || letter === 'n';
    return transition ? { lo: es, hi: es + it, it: it, dev: es, isHole: false } : { lo: es - it, hi: es, it: it, dev: es, isHole: false };
  }
  function isWithheld(row, grade) { return /^1-3$/.test(row.from_mm + '-' + row.to_mm) && grade >= 9 && grade <= 12; }

  function resolveFitZones(T, ctx) {
    var text = ctx.text;
    var reHdr = /ISO 286[^\n]*?[μµ]m/g, h;
    while ((h = reHdr.exec(text))) {
      var sb = sentenceBounds(text, h.index);
      var sent = text.slice(sb[0], sb[1]);
      var stepRe = /Ø\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/g, steps = [], s;
      while ((s = stepRe.exec(sent))) steps.push({ at: s.index, a: +s[1], b: +s[2], text: s[0] });
      var zRe = /(?<![\w])([A-Za-z])(\d{1,2})\s*=\s*([+−-]?\d+)\s*\/\s*([+−-]?\d+)/g, z;
      while ((z = zRe.exec(sent))) {
        var st = steps.filter(function (x) { return x.at < z.index; }).pop();
        if (!st) continue;
        var abs = sb[0] + z.index;
        var upper = parseNum(z[3]), lower = parseNum(z[4]);
        var key = z[1] + z[2] + ' at Ø' + st.a + '–' + st.b;
        var lit = z[3].replace('-', '−') + '/' + z[4].replace('-', '−');
        var cl = [claim(abs, z[0].length), claim(sb[0] + st.at, st.text.length)];
        var row = fitStepByRange(T, st.a, st.b);
        if (!row) { Finding(ctx, { family: 'fits', key: key, what: 'ISO 286 zone, µm', literal: lit, unit: 'µm', verdict: 'UNBACKED', at: abs, span: z[0], note: 'Ø' + st.a + '–' + st.b + ' is not a size step of fits.json', claim: cl }); continue; }
        var zone = zoneUm(row, z[1], +z[2]);
        var tbl = { file: 'fits.json', row: row.key, column: zone.isHole ? 'it_um' : 'shaft_es_um.' + z[1] + ' + it_um', confidence: row.confidence };
        if (zone.unbacked) {
          var widthNote = '';
          if (zone.it != null) {
            var w = Math.abs(upper.value - lower.value);
            widthNote = '; its width ' + w + ' µm ' + (w === zone.it ? 'equals' : 'does NOT equal') + ' the table\'s IT' + z[2] + ' = ' + zone.it + ' µm, but its deviation ' + (z[4].replace('-', '−')) + ' µm has no row';
          }
          Finding(ctx, { family: 'fits', key: key, what: 'ISO 286 zone, µm', literal: lit, unit: 'µm', verdict: 'UNBACKED', at: abs, span: z[0],
            table: Object.assign(tbl, { display: 'letters carried: ' + Object.keys(row.shaft_es_um).join(' ') + ' (and H)' }), note: zone.unbacked + widthNote, claim: cl });
          continue;
        }
        var okU = agrees(upper, zone.hi), okL = agrees(lower, zone.lo);
        Finding(ctx, { family: 'fits', key: key, what: 'ISO 286 zone, µm (upper/lower)', literal: lit, unit: 'µm', verdict: okU && okL ? 'AGREES' : 'DISAGREES', at: abs, span: z[0],
          table: Object.assign(tbl, { value: [zone.hi, zone.lo], display: signed(zone.hi) + '/' + signed(zone.lo) }), claim: cl });
      }
    }
  }

  /* Parker ORD 5700 glands in the doctrine: "depth by cross-section 1.78 mm → 1.27–1.37, …";
     then "liquids a–b / c–d / …", "vacuum and gases …", and for the radial sentence "gland depth …"
     and "groove width …". The k-th band of a slash list belongs to the k-th cross-section of the
     depth list (the doctrine's own order); that positional reading is the one assumption here. */
  var GLAND_FIELDS = {
    face: { depth: 'gland_depth_L', liquids: 'groove_width_G_liquids', gases: 'groove_width_G_vacuum_gases', radius: 'groove_radius_R' },
    radial: { depth: 'gland_depth_F_table_4_2', width: 'groove_width_G_no_backup', radius: 'groove_radius_R' }
  };
  function glandRows(T, chart) { return chart === 'face' ? T.orings_as568.face_seal_chart_4_3 : T.orings_as568.radial_static_table_4_2; }
  function glandRowForCs(T, chart, cs) {    // cs: parsed literal in mm or inch
    return glandRows(T, chart).filter(function (r) { return cs.unit === 'in' ? agrees(cs, parseFloat(r.cs_in)) : agrees(cs, r.cs_mm); })[0] || null;
  }
  function judgeBand(T, ctx, o) {
    var row = o.row, f = row && row[o.field];
    var base = { family: 'orings_as568', key: o.keyText, what: o.what, literal: o.lo.text + '–' + o.hi.text, unit: o.unit, at: o.at, span: o.span, claim: o.claim };
    if (!row) return Finding(ctx, Object.assign(base, { verdict: 'UNBACKED', note: 'no ' + (o.chart === 'face' ? 'Chart 4-3' : 'Table 4-2') + ' row for cross-section ' + o.keyText }));
    if (!f) return Finding(ctx, Object.assign(base, { verdict: 'UNBACKED', note: 'Chart/Table row carries no ' + o.field }));
    var tIn = f.in, tMm = [f.in[0] * IN, f.in[1] * IN];
    var t = o.unit === 'in' ? tIn : tMm;
    var ok = agrees(o.lo, t[0]) && agrees(o.hi, t[1]);
    var conf = f.confidence || row.confidence;
    var display = o.unit === 'in' ? fmt(tIn[0], 3) + '–' + fmt(tIn[1], 3) + ' in' : fmt(tIn[0], 3) + '–' + fmt(tIn[1], 3) + ' in = ' + fmt(tMm[0], 4) + '–' + fmt(tMm[1], 4) + ' mm';
    var tbl = { value: t, display: display, file: 'orings_as568.json', row: (o.chart === 'face' ? 'face_seal_chart_4_3' : 'radial_static_table_4_2') + '[W ' + row.cs_in + ']', column: o.field, confidence: conf };
    var fnd = Finding(ctx, Object.assign(base, { verdict: ok ? 'AGREES' : 'DISAGREES', table: tbl, note: o.note }));
    if (!ok) {
      // which other band of the same cross-section does it equal? (a mis-filed column)
      var others = [];
      ['face', 'radial'].forEach(function (ch) {
        var r2 = glandRows(T, ch).filter(function (x) { return x.cs_in === row.cs_in; })[0];
        if (!r2) return;
        Object.keys(r2).forEach(function (k) {
          var b = r2[k];
          if (!b || !b.in || !Array.isArray(b.in)) return;
          var bt = o.unit === 'in' ? b.in : [b.in[0] * IN, b.in[1] * IN];
          if (agrees(o.lo, bt[0]) && agrees(o.hi, bt[1])) others.push((ch === 'face' ? 'Chart 4-3 ' : 'Table 4-2 ') + k);
          else if (agrees(o.lo, bt[0]) || agrees(o.hi, bt[1])) others.push('one end of ' + (ch === 'face' ? 'Chart 4-3 ' : 'Table 4-2 ') + k);
        });
      });
      if (others.length) fnd.looksLike = others.slice(0, 3);
    }
    return fnd;
  }
  function resolveDoctrineGlands(T, ctx) {
    var text = ctx.text;
    var bullet = /O-rings?:[^\n]*/g, b;
    while ((b = bullet.exec(text))) {
      var line = b[0], base = b.index;
      // cross-sections and face depths
      var depthRe = /(\d\.\d\d)(?:\s*mm)?\s*→\s*(\d+\.\d+)\s*[–-]\s*(\d+\.\d+)/g, d, cs = [];
      while ((d = depthRe.exec(line))) {
        var csLit = parseNum(d[1]); csLit.unit = 'mm';
        cs.push({ lit: csLit, text: d[1] });
        var at = base + d.index;
        var chart = chartAt(line, d.index);
        judgeBand(T, ctx, { row: glandRowForCs(T, chart, csLit), chart: chart, field: GLAND_FIELDS[chart].depth, keyText: 'W ' + d[1] + ' mm', what: (chart === 'face' ? 'Chart 4-3 face-seal' : 'Table 4-2 radial') + ' gland depth', lo: parseNum(d[2]), hi: parseNum(d[3]), unit: 'mm', at: at, span: d[0],
          claim: [claim(at, d[0].length)] });
      }
      if (!cs.length) continue;
      var listRe = /(liquids|vacuum and gases|gland depth|groove width)\s+((?:\d+\.\d+\s*[–-]\s*\d+\.\d+(?:\s*\/\s*)?)+)/gi, L;
      while ((L = listRe.exec(line))) {
        var label = L[1].toLowerCase(), chart2 = chartAt(line, L.index);
        var field = label === 'liquids' ? 'liquids' : label === 'vacuum and gases' ? 'gases' : label === 'gland depth' ? 'depth' : 'width';
        var fieldName = GLAND_FIELDS[chart2][field];
        var bands = L[2].split('/').map(function (s) { return s.trim(); }).filter(Boolean);
        var cursor = L.index + L[0].indexOf(L[2]);
        bands.forEach(function (band, k) {
          var bm = /(\d+\.\d+)\s*[–-]\s*(\d+\.\d+)/.exec(band);
          var at = base + line.indexOf(band, cursor - 0);
          cursor = line.indexOf(band, cursor) + band.length;
          var key = cs[k];
          var note = 'positional: band ' + (k + 1) + ' of ' + bands.length + ' read against cross-section ' + (k + 1) + ' of the depth list (' + cs.map(function (c) { return c.text; }).join(', ') + ' mm)';
          if (chart2 === 'radial' && field === 'width' && !/no back-?up/i.test(line)) note += '; the sentence names no back-up count, read as none';
          if (!key) { Finding(ctx, { family: 'orings_as568', key: '?', what: label, literal: bm[1] + '–' + bm[2], unit: 'mm', verdict: 'UNBACKED', at: at, span: band, note: 'more bands than cross-sections: ' + note, claim: [claim(at, band.length)] }); return; }
          judgeBand(T, ctx, { row: glandRowForCs(T, chart2, key.lit), chart: chart2, field: fieldName, keyText: 'W ' + key.text + ' mm', what: (chart2 === 'face' ? 'Chart 4-3 face-seal ' : 'Table 4-2 radial ') + (field === 'liquids' ? 'groove width, liquids' : field === 'gases' ? 'groove width, vacuum and gases' : field === 'depth' ? 'gland depth' : 'groove width, no back-up'),
            lo: parseNum(bm[1]), hi: parseNum(bm[2]), unit: 'mm', at: at, span: L[1] + ' … ' + band, note: note, claim: [claim(at, band.length)] });
        });
      }
    }
  }
  function chartAt(line, pos) {               // the last chart named before pos: Chart 4-3 / FACE → face, Table 4-2 / RADIAL → radial
    var re = /(chart 4-3|face[- ]seal|\bFACE\b)|(table 4-2|\bRADIAL\b|radial)/gi, m, last = 'face';
    while ((m = re.exec(line)) && m.index < pos) last = m[1] ? 'face' : 'radial';
    return last;
  }

  /* NASA-STD-5001B factors: "ultimate 1.4 with yield 1.25 under the protoflight approach",
     "ultimate 1.4 with yield 1.0 under prototype", "Its 1.05 proof factor is for propellant tanks". */
  function resolveNasa(T, ctx) {
    var text = ctx.text, rows = T.design_factors_nasa.rows;
    var re = new RegExp('ultimate\\s+' + NUM + '\\s+with\\s+yield\\s+' + NUM + '\\s+under\\s+(?:the\\s+)?(protoflight|prototype)', 'gi'), m;
    while ((m = re.exec(text))) {
      var r = rows.filter(function (x) { return x.verification_approach === m[3].toLowerCase() && /metallic/.test(x.applies_to); })[0];
      [[m[1], 'ultimate_design_factor'], [m[2], 'yield_design_factor']].forEach(function (p) {
        var at = text.indexOf(p[0], p[1] === 'ultimate_design_factor' ? m.index : m.index + m[0].indexOf('yield'));
        var lit = parseNum(p[0]);
        var v = r && r[p[1]];
        Finding(ctx, { family: 'design_factors_nasa', key: 'metallic, ' + m[3].toLowerCase(), what: p[1].replace(/_/g, ' '), literal: p[0], verdict: !r ? 'UNBACKED' : agrees(lit, v) ? 'AGREES' : 'DISAGREES', at: at, span: m[0],
          table: r ? { value: v, display: String(v), file: 'design_factors_nasa.json', row: r.key, column: p[1], confidence: r.confidence } : null, claim: [claim(at, p[0].length)] });
      });
    }
    var re2 = new RegExp(NUM + '\\s+proof factor is for propellant tanks', 'gi');
    while ((m = re2.exec(text))) {
      var r2 = rows.filter(function (x) { return x.proof_test_factor != null && /propellant tanks/.test(x.applies_to); })[0];
      var lit2 = parseNum(m[1]);
      Finding(ctx, { family: 'design_factors_nasa', key: 'propellant tanks and SRM cases', what: 'proof test factor', literal: m[1], verdict: !r2 ? 'UNBACKED' : agrees(lit2, r2.proof_test_factor) ? 'AGREES' : 'DISAGREES', at: m.index, span: m[0],
        table: r2 ? { value: r2.proof_test_factor, display: String(r2.proof_test_factor), file: 'design_factors_nasa.json', row: r2.key, column: 'proof_test_factor', confidence: r2.confidence } : null, claim: [claim(m.index, m[1].length)] });
    }
  }

  /* "the CERTIFIED PERFORMANCE of 1037 motors" — a row count of motor_perf.json typed as a number. */
  function resolveCounts(T, ctx) {
    var re = /CERTIFIED PERFORMANCE of (\d+) motors/gi, m;
    while ((m = re.exec(ctx.text))) {
      var at = m.index + m[0].indexOf(m[1]), n = T.motor_perf.rows_count;
      Finding(ctx, { family: 'motor_perf', key: 'row count', what: 'number of motors with certified performance', literal: m[1], verdict: +m[1] === n ? 'AGREES' : 'DISAGREES', at: at, span: m[0],
        table: { value: n, display: String(n) + ' rows', file: 'motor_perf.json', row: '(all)', column: 'rows.length', confidence: 'count' }, claim: [claim(at, m[1].length)] });
    }
  }

  var WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  /* "four vendors' 6 in airframes share ID 152.4 mm": count the vendors of airframes.json whose body
     tube ID equals that value at its printed precision. */
  function resolveVendorsShare(T, ctx) {
    var re = new RegExp("(\\w+) vendors' (\\d+) in airframes share ID " + NUM + ' mm', 'g'), m;
    while ((m = re.exec(ctx.text))) {
      var n = WORDS[m[1].toLowerCase()] || +m[1];
      var id = parseNum(m[3]);
      var rows = T.airframes.rows.filter(function (r) { return agrees(id, r[1]); });
      var vendors = rows.map(function (r) { return r[0]; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var other = T.airframes.rows.filter(function (r) { return r[1] > 150 && r[1] < 155 && vendors.indexOf(r[0]) < 0; })
        .map(function (r) { return r[0] + ' ' + r[3] + ' ID ' + fmt(r[1]) + ' [' + r[4] + ']'; });
      var at = m.index;
      Finding(ctx, { family: 'airframes', key: m[2] + ' in body tubes', what: 'number of vendors sharing ID ' + m[3] + ' mm', literal: m[1] + ' (' + n + ')', at: at, span: m[0],
        verdict: vendors.length === n ? 'AGREES' : 'DISAGREES',
        table: { value: vendors.length, display: vendors.length + ' vendors at ID ' + m[3] + ': ' + vendors.join(', ') + (other.length ? '; not at ' + m[3] + ': ' + other.join('; ') : ''), file: 'airframes.json', row: 'BodyTube', column: 'id_mm', confidence: 'count' },
        claim: [claim(at, m[1].length), claim(at + m[0].indexOf(m[2] + ' in'), m[2].length), claim(at + m[0].lastIndexOf(m[3]), m[3].length)] });
    }
  }
  /* "if the user said 20 kN and the table says 11.6 kN": which certified peak in motor_perf is it? */
  function resolveTableSaysKn(T, ctx) {
    var re = new RegExp('the table says ' + NUM + ' kN', 'g'), m;
    while ((m = re.exec(ctx.text))) {
      var lit = parseNum(m[1]), at = m.index + m[0].indexOf(m[1]);
      var hits = T.motor_perf.rows.filter(function (r) { return agrees(lit, r[4] / 1000); });
      var describe = function (r) { return r[2] + ' ' + r[0] + ' (' + r[3] + ' mm) ' + r[4] + ' N ' + r[5] + ', ' + r[6]; };
      Finding(ctx, { family: 'motor_perf', key: 'peak thrust example', what: 'a certified peak the table carries', literal: m[1], unit: 'kN', at: at, span: m[0],
        verdict: hits.length ? 'AGREES' : 'UNBACKED',
        table: hits.length ? { value: hits[0][4] / 1000, display: hits.map(describe).join('; '), file: 'motor_perf.json', row: hits[0][1], column: 'max_thrust_N', confidence: hits[0][7] } : null,
        note: hits.length ? '' : (lit.value < 5 ? 'below this excerpt\'s 5 kN floor' : 'no motor_perf row ≥ 5 kN has that peak') + '; the sentence is an illustration, so it is never called a disagreement',
        claim: [claim(at, m[1].length)] });
    }
  }
  /* "commercial cases are 29, 38, 54, 75, 98 mm (and 6 in / 152 mm research cases)" against the
     motor diameters motors.json carries. */
  function resolveCaseList(T, ctx) {
    var re = /commercial cases are ((?:\d+,\s*)+\d+) mm(?:\s*\(and \d+ in \/ (\d+) mm research cases\))?/g, m;
    while ((m = re.exec(ctx.text))) {
      var list = m[1].split(/,\s*/).concat(m[2] ? [m[2]] : []), off = m.index;
      list.forEach(function (d) {
        var at = ctx.text.indexOf(d, off); off = at + d.length;
        var row = T.motors.diameters.filter(function (x) { return x.d_mm === +d; })[0];
        Finding(ctx, { family: 'motors', key: d + ' mm', what: 'a motor case diameter', literal: d, unit: 'mm', at: at, span: m[0].slice(0, 90),
          verdict: row ? 'AGREES' : 'UNBACKED',
          table: row ? { value: row.d_mm, display: row.cases + ' hardware set' + (row.cases > 1 ? 's' : '') + ', e.g. ' + row.example, file: 'motors.json', row: row.example, column: 'd_mm', confidence: row.confidence } : { display: 'diameters carried: ' + T.motors.diameters.map(function (x) { return x.d_mm; }).join(', '), file: 'motors.json' },
          claim: [claim(at, d.length)] });
      });
    }
  }
  /* "grade" is REQUIRED — "8.8"|"10.9"|"12.9", SAE "2"|"5"|"8", stainless "A2-70"|"A4-80": every grade
     the doctrine tells the model it may declare must be a key GRADE_SY accepts, or the check refuses. */
  function resolveGradeNames(T, ctx, gradeKeys) {
    var m = /"grade" is REQUIRED — ([^\n]*?) — or give/.exec(ctx.text);
    if (!m || !gradeKeys) return;
    var re = /"([^"]+)"/g, g, base = m.index + m[0].indexOf(m[1]);
    while ((g = re.exec(m[1]))) {
      var name = g[1], at = base + g.index + 1;
      var ok = gradeKeys.indexOf(name.toLowerCase()) >= 0;
      Finding(ctx, { family: 'GRADE_SY (names)', key: name, what: 'a grade the doctrine says the model may declare', literal: '"' + name + '"', at: at, span: m[0].slice(0, 100),
        verdict: ok ? 'AGREES' : 'DISAGREES', table: { display: ok ? 'GRADE_SY has \'' + name.toLowerCase() + '\'' : 'GRADE_SY has no such key; the check would refuse it', file: 'index.html', row: 'GRADE_SY', column: 'keys', confidence: 'code' },
        claim: [claim(at, name.length)] });
    }
  }

  /* "98 mm MMT ≈ 101.6 OD × 98.5 ID, 75 mm ≈ 78.7 × 75.4, 54 mm ≈ 57.2 × 54.4" against the body tubes
     of airframes.json. A pair agrees when one row has both diameters at the printed precision. */
  function resolveMmt(T, ctx) {
    var text = ctx.text;
    var head = /(\d+) mm MMT ≈ /g, h;
    while ((h = head.exec(text))) {
      var sb = sentenceBounds(text, h.index);
      var seg = text.slice(h.index, sb[1]);
      var re = new RegExp('(\\d+) mm(?: MMT)? ≈ ' + NUM + '(?: OD)? × ' + NUM + '(?: ID)?', 'g'), m;
      while ((m = re.exec(seg))) {
        var at = h.index + m.index;
        var od = parseNum(m[2]), id = parseNum(m[3]);
        var rows = T.airframes.rows;
        var both = rows.filter(function (r) { return agrees(od, r[2]) && agrees(id, r[1]); });
        var near = rows.slice().sort(function (a, b) { return (Math.abs(a[1] - id.value) + Math.abs(a[2] - od.value)) - (Math.abs(b[1] - id.value) + Math.abs(b[2] - od.value)); }).slice(0, 2);
        var describe = function (r) { return r[0] + ' ' + r[3] + ' ' + fmt(r[2]) + ' OD × ' + fmt(r[1]) + ' ID [' + r[4] + ']'; };
        Finding(ctx, { family: 'airframes', key: m[1] + ' mm MMT', what: 'typical motor-mount tube OD × ID', literal: m[2] + ' × ' + m[3], unit: 'mm', at: at, span: m[0],
          verdict: both.length ? 'AGREES' : 'UNBACKED',
          table: { display: both.length ? both.map(describe).join('; ') : 'no body tube in the table has both; nearest: ' + near.map(describe).join('; '), file: 'airframes.json', row: (both.length ? both[0] : near[0])[3], column: 'od_mm × id_mm', confidence: (both.length ? both[0] : near[0])[4] },
          note: 'the doctrine marks these "≈ … NOTE them as assumptions to be measured"', claim: [claim(at + m[0].indexOf(m[2]), m[2].length), claim(at + m[0].lastIndexOf(m[3]), m[3].length), claim(at, m[1].length)] });
      }
    }
  }

  /* FLIGHT example blocks (doctrine) and FLIGHT blocks (templates): entries whose tol_ref names an
     ISO 286 fit are checked as zones; entries whose name carries a thread key as holes. */
  function flightEntries(text) {
    var a = text.indexOf('FLIGHT-BEGIN'), b = text.indexOf('FLIGHT-END', a);
    if (a < 0 || b < 0) return [];
    var block = text.slice(a, b), out = [];
    var re = /\{[^{}]*\}/g, m;
    while ((m = re.exec(block))) {
      var raw = m[0];
      if (!/"(?:d_mm|nominal_mm)"/.test(raw)) continue;
      var obj;
      try { obj = JSON.parse(raw.replace(/\n\s*(?:\/\/)?/g, ' ')); } catch (e) { continue; }
      var dm = /"d_mm"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(raw), tm = /"tol_mm"\s*:\s*(\d+(?:\.\d+)?)/.exec(raw);
      var cat = block.slice(0, m.index).match(/"(critical|od|bores|holes|revolve|gauges|loads)"\s*:\s*\[/g);
      out.push({ obj: obj, raw: raw, at: a + m.index, d: dm && parseNum(dm[1]), dAt: dm && a + m.index + dm.index + dm[0].indexOf(dm[1]), tol: tm && parseNum(tm[1]), cat: cat ? cat[cat.length - 1].match(/"(\w+)"/)[1] : '' });
    }
    return out;
  }
  function judgeFitDeclared(T, ctx, o) {
    // o: { letter, grade, nominal (parsed), declared: {d, tol}, at, span, where }
    var mm = o.nominal.value, row = fitStepFor(T, mm);
    var key = o.letter + o.grade + ' at Ø' + o.nominal.text;
    var base = { family: 'fits', key: key, what: 'declared tolerance vs the fit it names', at: o.at, span: o.span, claim: o.claim, unit: 'mm' };
    if (!row) return Finding(ctx, Object.assign(base, { literal: o.declared ? o.declared.d.text + ' ±' + o.declared.tol.text : o.nominal.text, verdict: 'UNBACKED', note: 'Ø' + mm + ' is outside fits.json\'s size steps' }));
    var z = zoneUm(row, o.letter, +o.grade);
    var tbl = { file: 'fits.json', row: row.key, column: (z.isHole ? 'H' : o.letter) + o.grade, confidence: row.confidence };
    if (z.unbacked) return Finding(ctx, Object.assign(base, { literal: o.declared ? o.declared.d.text + ' ±' + o.declared.tol.text : o.nominal.text, verdict: 'UNBACKED', table: tbl, note: z.unbacked }));
    var lo = mm + z.lo / 1000, hi = mm + z.hi / 1000;
    tbl.value = [lo, hi]; tbl.display = fmt(lo, 3) + '–' + fmt(hi, 3) + ' (' + signed(z.hi) + '/' + signed(z.lo) + ' µm, ' + row.from_mm + '–' + row.to_mm + ' mm step)';
    if (!o.declared) return null;
    var dec = Math.min(o.declared.d.decimals, o.declared.tol.decimals);
    var dlo = { value: o.declared.d.value - o.declared.tol.value, decimals: dec }, dhi = { value: o.declared.d.value + o.declared.tol.value, decimals: dec };
    var ok = agrees(dlo, lo) && agrees(dhi, hi);
    return Finding(ctx, Object.assign(base, { literal: o.declared.d.text + ' ±' + o.declared.tol.text + ' (' + fmt(dlo.value, dec) + '–' + fmt(dhi.value, dec) + ')', verdict: ok ? 'AGREES' : 'DISAGREES', table: tbl,
      note: (o.where || '') + (ok ? '' : '; the doctrine says "Name the fit in a NOTE; put its numbers in tol_mm"') }));
  }
  function resolveFlightFits(T, ctx) {
    flightEntries(ctx.text).forEach(function (e) {
      var ref = e.obj.tol_ref && /ISO 286\s+([A-Z])(\d+)(?:\/([a-z])(\d+))?/.exec(e.obj.tol_ref);
      if (!ref || !e.d || !e.tol) return;
      var shaft = e.cat === 'od';
      var letter = shaft ? ref[3] : ref[1], grade = shaft ? ref[4] : ref[2];
      if (!letter) return;
      judgeFitDeclared(T, ctx, { letter: letter, grade: grade, nominal: e.d, declared: { d: e.d, tol: e.tol }, at: e.dAt, span: '"' + e.obj.name + '" d_mm ' + e.d.text + ' tol_mm ' + e.tol.text + ', tol_ref "' + e.obj.tol_ref + '"',
        where: 'FLIGHT ' + e.cat + ' entry cites ' + ref[0] + ' (the ' + (shaft ? 'shaft' : 'hole') + ' half)', claim: [claim(e.dAt, e.d.text.length)] });
    });
  }

  // ------------------------------------------------------------------ template resolvers
  var KEY_SRC = '(M\\d+(?:\\.\\d+)?|#\\d+-\\d+|\\d+-\\d+|\\d+/\\d+-\\d+|\\d+/\\d+(?:\\s*in)?)';
  function findThreadKeys(T, s) {
    var re = new RegExp('(?<![\\w#/.-])' + KEY_SRC + '(?![\\w/])', 'g'), m, out = [];
    while ((m = re.exec(s))) {
      var th = parseThread(T, m[1].replace(/\s*in$/, ''));
      if (th) out.push({ at: m.index, text: m[1], th: th });
    }
    return out;
  }
  function classIn(s, sys) {
    var m = sys === 'metric' ? /\b(fine|medium|coarse)\b/i.exec(s) : /\b(close|normal|loose)\b/i.exec(s);
    return m ? m[1].toLowerCase() : null;
  }
  /* A hole's stated reason: the parenthesis right after the number or after "clearance", or the
     text after "clearance:". */
  function reasonAt(s, idx) {
    var m = /^\s*(\([^()]*\))/.exec(s.slice(idx));
    return m ? m[1] : null;
  }
  function reasonAfterClearance(s) {
    var m = /clearance\s*(\([^()]*\))/.exec(s) || /clearance\s*:\s*([^;]+)$/.exec(s);
    return m ? m[1].trim() : null;
  }

  /* Fastener literals in NOTE / MAKE prose. The shapes recognised, each with its example:
       P1  "4 x 6.60 holes = 1/4 in all-thread clearance (6.35 + 0.25)"   NUM holes = KEY …
           "2 x 7.00 holes for a 1/4-20 U-bolt"                         NUM holes for a KEY …
       P2  "4.50 mm (M4 clearance, ISO 273 medium"                      NUM mm (KEY clearance …
       P3  "tap drill #29 = 3.45 mm"                                     tap drill NAME = NUM unit
       P4  "2-56 major 2.18"                                              KEY major NUM
       P5  "20.5 mm2 stress area" (thread key earlier in the sentence)    NUM mm2 stress area
       P6  "Ø4.00 × 5 deep blind holes for M3 heat-set inserts"           Ø NUM … holes for KEY heat-set insert
       P7  "M4 clearance holes 4.50", "M6 class 8.8 bolts, clearance 6.40", "clearance holes 6.60 (1/4 in …",
           "clearance hole 2.20 (2-56 major …"                            KEY … clearance … NUM / clearance NUM (KEY
     Anything else stays unpaired and shows in the inventory. */
  function resolveProseFasteners(T, ctx, lineStart, s) {
    var used = {};
    function take(start, len) { for (var i = start; i < start + len; i++) if (used[i]) return false; for (i = start; i < start + len; i++) used[i] = 1; return true; }
    function sentenceOf(pos) { var a = s.lastIndexOf(';', pos), b = s.indexOf(';', pos); return s.slice(a + 1, b < 0 ? s.length : b); }
    function nearestKey(pos) {
      var keys = findThreadKeys(T, s);
      var a = s.lastIndexOf(';', pos), b = s.indexOf(';', pos); b = b < 0 ? s.length : b;
      keys = keys.filter(function (k) { return k.at > a && k.at < b; });
      keys.sort(function (x, y) { return Math.abs(x.at - pos) - Math.abs(y.at - pos); });
      return keys[0] || null;
    }
    var m, re;
    // a bolt grade's yield restated in prose: "a zinc-plated grade-2 steel one (sy 393 MPa)"
    re = /\bgrade[- ](\d|\d+\.\d)\b[^;()]*\((?:sy|σy)\s+(\d+)\s*MPa\)/g;
    while ((m = re.exec(s))) {
      var gAt = m.index + m[0].lastIndexOf(m[2]);
      var gk = Object.keys(T.fasteners_metric.grades).filter(function (k) { return k === m[1]; })[0];
      var gv = gk && T.fasteners_metric.grades[gk];
      Finding(ctx, { family: 'fasteners_metric.grades', key: 'grade ' + m[1], what: 'bolt yield, MPa', literal: m[2], unit: 'MPa', at: lineStart + gAt, span: m[0], verdict: gv ? (agrees(parseNum(m[2]), gv.yield_MPa) ? 'AGREES' : 'DISAGREES') : 'UNBACKED',
        table: gv ? { value: gv.yield_MPa, display: gv.yield_MPa + ' MPa', file: 'fasteners_metric.json', row: 'grades.' + gk, column: 'yield_MPa', confidence: gv.confidence } : null,
        note: gv ? '' : 'SAE J429 grade ' + m[1] + ': no PartForge table carries SAE J429 strengths (the same 393 is GRADE_SY\'s, unbacked there too)', claim: [claim(lineStart + gAt, m[2].length)] });
    }
    // P1
    re = new RegExp(NUM + '\\s*(?:mm\\s*)?holes?\\s*(=|for an?)\\s*' + KEY_SRC + '([^;]*)', 'g');
    while ((m = re.exec(s))) {
      var th = parseThread(T, m[3].replace(/\s*in$/, ''));
      if (!th || !take(m.index, m[1].length)) continue;
      var rest = m[4], col = /tap/.test(rest) ? 'tap' : (classIn(rest, th.sys) || 'any');
      judgeThread(T, ctx, { thread: th, lit: parseNum(m[1]), col: col, at: lineStart + m.index, span: m[0].slice(0, 90), reason: reasonAt(s, m.index + m[1].length) || reasonAfterClearance(rest), claim: [claim(lineStart + m.index, m[1].length)] });
    }
    // P2
    re = new RegExp(NUM + '\\s*mm\\s*\\(' + KEY_SRC + '\\s+clearance,?\\s*([^);]*)', 'g');
    while ((m = re.exec(s))) {
      th = parseThread(T, m[2].replace(/\s*in$/, ''));
      if (!th || !take(m.index, m[1].length)) continue;
      judgeThread(T, ctx, { thread: th, lit: parseNum(m[1]), col: classIn(m[3], th.sys) || 'any', at: lineStart + m.index, span: m[0], claim: [claim(lineStart + m.index, m[1].length)] });
    }
    // P3
    re = /tap drill\s+(#\d+|[A-Z]|\d+\/\d+)\s*=\s*(\d*\.\d+|\d+)\s*(mm|in)\b/g;
    while ((m = re.exec(s))) {
      var k = nearestKey(m.index);
      var numAt = m.index + m[0].indexOf(m[2], m[1].length + 9);
      if (!k || !take(numAt, m[2].length)) continue;
      judgeThread(T, ctx, { thread: k.th, lit: parseNum(m[2]), col: 'tap', unit: m[3], at: lineStart + numAt, span: k.text + ' … ' + m[0], claim: [claim(lineStart + numAt, m[2].length)] });
      var names = k.th.rows.map(function (r) { return r.tap_drill_75; }).concat(k.th.rows.map(function (r) { return r.tap_drill_50; }));
      var nameAt = lineStart + m.index + m[0].indexOf(m[1]);
      Finding(ctx, { family: k.th.sys === 'metric' ? 'fasteners_metric' : 'fasteners_un', key: k.th.key, what: 'tap drill name', literal: m[1], verdict: k.th.sys !== 'un' ? 'UNBACKED' : names.indexOf(m[1]) >= 0 ? 'AGREES' : 'DISAGREES', at: nameAt, span: m[0],
        table: k.th.sys === 'un' ? { display: k.th.rows.map(function (r) { return r.tap_drill_75 + ' (75 %) / ' + r.tap_drill_50 + ' (50 %)'; }).join('; '), file: 'fasteners_un.json', row: k.th.key, column: 'tap_drill_75', confidence: k.th.rows[0].confidence } : null,
        claim: [claim(nameAt, m[1].length)] });
    }
    // P4
    re = new RegExp(KEY_SRC + '\\s+major\\s+' + NUM, 'g');
    while ((m = re.exec(s))) {
      th = parseThread(T, m[1].replace(/\s*in$/, ''));
      var at4 = m.index + m[0].lastIndexOf(m[2]);
      if (!th || !take(at4, m[2].length)) continue;
      judgeThread(T, ctx, { thread: th, lit: parseNum(m[2]), col: 'major', at: lineStart + at4, span: m[0], claim: [claim(lineStart + at4, m[2].length)] });
    }
    // P5
    re = new RegExp(NUM + '\\s*mm2\\s+stress area', 'g');
    while ((m = re.exec(s))) {
      k = nearestKey(m.index);
      if (!k || !take(m.index, m[1].length)) continue;
      judgeThread(T, ctx, { thread: k.th, lit: parseNum(m[1]), col: 'stress', unit: 'mm2', at: lineStart + m.index, span: k.text + ' … ' + m[0], claim: [claim(lineStart + m.index, m[1].length)] });
    }
    // P6
    re = new RegExp('Ø' + NUM + '(?:(?!Ø)[^;])*?holes?\\s+for\\s+' + KEY_SRC + '\\s+heat-set insert', 'g');
    while ((m = re.exec(s))) {
      th = parseThread(T, m[2]);
      if (!th || !take(m.index + 1, m[1].length)) continue;
      judgeThread(T, ctx, { thread: th, lit: parseNum(m[1]), col: 'insert', at: lineStart + m.index + 1, span: m[0], claim: [claim(lineStart + m.index + 1, m[1].length)] });
    }
    // P7
    var p7 = [
      new RegExp(KEY_SRC + '\\s+clearance\\s+holes?\\s+' + NUM, 'g'),
      new RegExp(KEY_SRC + '[^;]{0,40}?,\\s*clearance\\s+' + NUM, 'g'),
      new RegExp('clearance\\s+holes?\\s+' + NUM + '\\s*\\(' + KEY_SRC, 'g')
    ];
    p7.forEach(function (rx, i) {
      while ((m = rx.exec(s))) {
        var keyText = i < 2 ? m[1] : m[2], numText = i < 2 ? m[2] : m[1];
        var numAt = i < 2 ? m.index + m[0].lastIndexOf(numText) : m.index + m[0].indexOf(numText);
        var th7 = parseThread(T, keyText.replace(/\s*in$/, ''));
        if (!th7 || !take(numAt, numText.length)) continue;
        var tail = s.slice(numAt + numText.length).split(';')[0];
        var cls = classIn(tail.slice(0, 60), th7.sys);
        judgeThread(T, ctx, { thread: th7, lit: parseNum(numText), col: cls || 'any', at: lineStart + numAt, span: s.slice(m.index, numAt + numText.length) + tail.slice(0, 40), reason: reasonAt(s, numAt + numText.length), claim: [claim(lineStart + numAt, numText.length)] });
      }
    });
  }

  /* O-ring rows and glands in template prose and parameter comments. */
  function resolveProseOrings(T, ctx, lineStart, s, param) {
    var m;
    // AS568 dash rows: "AS568-250, ID 4.984 in = 126.59 mm, W 0.103 in = 2.62 mm", "AS568-250 = 4.984 in"
    var dm = /AS568-(\d{3})/.exec(s);
    if (dm) {
      var dash = '-' + dm[1];
      var row = T.orings_as568.rows.filter(function (r) { return r[0] === dash; })[0];
      var checks = [];
      var re = /\b(ID|W)\s+(\d*\.\d+)\s*in\s*=\s*(\d+\.\d+)\s*mm/g;
      while ((m = re.exec(s))) {
        checks.push({ field: m[1], lit: m[2], unit: 'in', at: m.index + m[0].indexOf(m[2]) });
        checks.push({ field: m[1], lit: m[3], unit: 'mm', at: m.index + m[0].lastIndexOf(m[3]) });
      }
      var r2 = /AS568-\d{3}\s*=\s*(\d*\.\d+)\s*in/.exec(s);
      if (r2 && param && /\bID\b/.test(s)) {
        checks.push({ field: 'ID', lit: r2[1], unit: 'in', at: r2.index + r2[0].indexOf(r2[1]) });
        checks.push({ field: 'ID', lit: param.value.text, unit: 'mm', at: param.valueAt - lineStart, isParam: true });
      }
      checks.forEach(function (c) {
        var lit = parseNum(c.lit);
        var col = c.field === 'ID' ? 1 : 2;
        var base = { family: 'orings_as568', key: 'AS568' + dash, what: (c.field === 'ID' ? 'inside diameter' : 'cross-section W') + (c.isParam ? ' (parameter value)' : ''), literal: c.lit, unit: c.unit, at: lineStart + c.at, span: c.isParam ? param.line.trim() : s.trim().slice(0, 120), claim: [claim(lineStart + c.at, c.lit.length)] };
        if (!row) return Finding(ctx, Object.assign(base, { verdict: 'UNBACKED', note: dash + ' is not a row of orings_as568.json' }));
        var tIn = row[col], t = c.unit === 'in' ? tIn : tIn * IN;
        var ok = agrees(lit, t);
        var f = Finding(ctx, Object.assign(base, { verdict: ok ? 'AGREES' : 'DISAGREES', table: { value: t, display: fmt(tIn, 3) + ' in' + (c.unit === 'mm' ? ' = ' + fmt(tIn * IN, 4) + ' mm' : ''), file: 'orings_as568.json', row: dash, column: col === 1 ? 'id_in' : 'cs_in', confidence: row[3] } }));
        if (!ok && col === 2) {
          // which series has this cross-section, and its dash nearest this ID?
          var same = T.orings_as568.rows.filter(function (r) { return c.unit === 'in' ? agrees(lit, r[2]) : agrees(lit, r[2] * IN); });
          if (same.length) {
            same.sort(function (a, b) { return Math.abs(a[1] - row[1]) - Math.abs(b[1] - row[1]); });
            f.looksLike = ['W ' + fmt(same[0][2], 3) + ' in is the cross-section of AS568 ' + same[0][0].slice(0, 2) + 'xx; the dash of that cross-section nearest ID ' + fmt(row[1], 3) + ' in is ' + same[0][0] + ' (ID ' + fmt(same[0][1], 3) + ' in) [' + same[0][3] + ']'];
          }
        }
      });
    }
    // "AS568 W .103 in" with no dash (parameter comment): is it an AS568 cross-section?
    var wm = !dm && /AS568\s+W\s*(\d*\.\d+)\s*in/.exec(s);
    if (wm && param) {
      var csIn = parseNum(wm[1]);
      var series = T.orings_as568.rows.filter(function (r) { return agrees(csIn, r[2]); });
      var v = param.value;
      var tv = series.length ? series[0][2] * IN : null;
      Finding(ctx, { family: 'orings_as568', key: 'AS568 W ' + wm[1] + ' in', what: 'cross-section (parameter value)', literal: v.text, unit: 'mm', at: param.valueAt, span: param.line.trim(), verdict: !series.length ? 'UNBACKED' : agrees(v, tv) ? 'AGREES' : 'DISAGREES',
        table: series.length ? { value: tv, display: fmt(series[0][2], 3) + ' in = ' + fmt(tv, 4) + ' mm (' + series.length + ' dashes)', file: 'orings_as568.json', row: series[0][0].slice(0, 2) + 'xx', column: 'cs_in', confidence: series[0][3] } : null,
        claim: [claim(param.valueAt, v.text.length), claim(lineStart + wm.index, wm[0].length)] });
    }
    // a tolerance attributed to Parker that the gland rows do not carry
    var tol = /Parker\s*\+\/-\s*(\.\d+|\d+\.\d+)\s*(in|mm)?\s*on\s+([a-z ]+)/i.exec(s);
    if (tol) {
      var tAt = lineStart + tol.index + tol[0].indexOf(tol[1]);
      Finding(ctx, { family: 'orings_as568', key: 'Parker gland', what: 'tolerance attributed to Parker (' + tol[3].trim() + ')', literal: '±' + tol[1], unit: tol[2] || '', at: tAt, span: tol[0], verdict: 'UNBACKED',
        note: 'the Chart 4-3 rows carry depth, width and radius bands, no ± tolerance; Table 4-2 gives G +.005/−0 for radial glands only', claim: [claim(tAt, tol[1].length)] });
    }
    // Parker glands: "Chart 4-3 face seal for W .103: depth .074-.080 in, width .120-.125 in for vacuum/gases (.140-.146 for liquids)"
    if (!/Chart 4-3|Table 4-2/i.test(s)) return;
    var chart = /Table 4-2/i.test(s) && !/Chart 4-3/i.test(s) ? 'radial' : 'face';
    var csm = /W\s*(0?\.\d{3})\b/.exec(s);
    if (!csm) return;
    var cs = parseNum(csm[1]); cs.unit = 'in';
    var grow = glandRowForCs(T, chart, cs);
    var masked = mask(s);
    var bandRe = /(?<![\w.])(\.\d+|\d+\.\d+)\s*[-–]\s*(\.\d+|\d+\.\d+)(\s*(?:in|mm)\b)?/g, b, firstCue = null;
    var cueRe = /\b(depth|deep|width|wide)\b|\bR\b|radius|corners/;
    var fc = cueRe.exec(s); if (fc) firstCue = fc[0];
    while ((b = bandRe.exec(masked))) {
      var lo = parseNum(b[1]), hi = parseNum(b[2]);
      // unit: as written; else a leading "." is the inch convention of these files; else mm
      var unit = b[3] ? b[3].trim() : (/^\./.test(b[1]) ? 'in' : 'mm');
      var back = s.slice(Math.max(0, b.index - 32), b.index), fwd = s.slice(b.index + b[0].length, b.index + b[0].length + 24);
      var cueM = back.match(/(depth|deep|width|wide|\bR\b|radius|corners)(?!.*(depth|deep|width|wide|\bR\b|radius|corners))/);
      var cue = cueM ? cueM[1] : firstCue;
      if (/squeeze/.test(back.slice(-12)) || /%/.test(fwd.slice(0, 3))) continue;
      var field = null, what = null;
      if (/depth|deep/.test(cue || '')) { field = GLAND_FIELDS[chart].depth; what = 'gland depth'; }
      else if (/R|radius|corners/.test(cue || '')) { field = 'groove_radius_R'; what = 'groove corner radius'; }
      else if (/width|wide/.test(cue || '')) {
        var svc = /^[^;(]*?\bfor\s+(liquids|vacuum\/gases|vacuum and gases|gases)/.exec(fwd) || /(liquids|vacuum\/gases|vacuum and gases|gases)[^;]*$/.exec(back);
        if (!svc) continue;
        var liq = /liquid/.test(svc[1]);
        field = chart === 'face' ? (liq ? GLAND_FIELDS.face.liquids : GLAND_FIELDS.face.gases) : GLAND_FIELDS.radial.width;
        what = 'groove width, ' + (liq ? 'liquids' : 'vacuum and gases');
      }
      if (!field) continue;
      var bAt = lineStart + b.index;
      judgeBand(T, ctx, { row: grow, chart: chart, field: field, keyText: 'W ' + csm[1] + ' in', what: (chart === 'face' ? 'Chart 4-3 face-seal ' : 'Table 4-2 radial ') + what, lo: lo, hi: hi, unit: unit, at: bAt, span: s.slice(Math.max(0, b.index - 24), b.index + b[0].length + 18), claim: [claim(bAt, b[0].length)] });
      // a design value inside the band it cites (parameter lines)
      if (param && grow && grow[field]) {
        var band = grow[field].in.map(function (x) { return x * IN; });
        var pv = param.value;
        var inside = pv.value >= band[0] - halfUnit(pv.decimals) - EPS && pv.value <= band[1] + halfUnit(pv.decimals) + EPS;
        Finding(ctx, { family: 'orings_as568', key: 'W ' + csm[1] + ' in', what: what + ' (parameter value inside the cited band)', literal: pv.text, unit: 'mm', at: param.valueAt, span: param.line.trim().slice(0, 110), verdict: inside ? 'AGREES' : 'DISAGREES',
          table: { value: band, display: fmt(band[0], 4) + '–' + fmt(band[1], 4) + ' mm', file: 'orings_as568.json', row: 'face_seal_chart_4_3[W ' + grow.cs_in + ']', column: field, confidence: grow.confidence }, claim: [claim(param.valueAt, pv.text.length)] });
      }
    }
  }

  /* Named fits in prose: "ream 20.00 H7", "Ø20.00 H7", or a parameter comment "reamed H7" on a
     parameter whose value is the nominal; compared with the FLIGHT entry declaring that diameter. */
  function resolveProseFits(T, ctx, lineStart, s, param, entries) {
    var re = /(?:Ø\s*)?(\d+\.\d+)\s+([Ha-z])(\d{1,2})\b(?!\/)/g, m, hits = [];
    while ((m = re.exec(s))) hits.push({ nom: parseNum(m[1]), letter: m[2], grade: m[3], at: lineStart + m.index + m[0].indexOf(m[1]), span: m[0] });
    if (param) {
      var pm = /\b(?:reamed|ream)\s+([Ha-z])(\d{1,2})\b/.exec(s);
      if (pm) hits.push({ nom: param.value, letter: pm[1], grade: pm[2], at: param.valueAt, span: param.line.trim().slice(0, 100) });
    }
    hits.forEach(function (h) {
      var hole = h.letter === h.letter.toUpperCase();
      // the FLIGHT entry for that feature: same kind (bore/hole for H, od for a shaft letter), diameter
      // within 0.5 mm of the named nominal (a correct declaration of an asymmetric zone sits at its
      // middle, e.g. 20.0105 ±0.0105 for H7 at Ø20), the nearest one
      var e = entries.filter(function (x) { return x.d && x.tol && Math.abs(x.d.value - h.nom.value) <= 0.5 && (hole ? x.cat === 'bores' || x.cat === 'holes' : x.cat === 'od'); })
        .sort(function (x, y) { return Math.abs(x.d.value - h.nom.value) - Math.abs(y.d.value - h.nom.value); })[0];
      if (!e) return;
      judgeFitDeclared(T, ctx, { letter: h.letter, grade: h.grade, nominal: h.nom, declared: { d: e.d, tol: e.tol }, at: h.at, span: h.span + '   vs FLIGHT "' + e.obj.name + '" d_mm ' + e.d.text + ' tol_mm ' + e.tol.text,
        where: 'the line names ' + h.letter + h.grade + '; the FLIGHT ' + e.cat + ' entry declares ±' + e.tol.text, claim: [claim(h.at, h.nom.text.length)] });
    });
  }

  /* FLIGHT holes and bores whose name carries a thread key: "M4 retention bolts" 4.50,
     "terminal block #8-32 tap drill" 3.45, "U-bolt 1/4-20" 7.00, "M3 heat-set boss holes" 4.00. */
  function resolveFlightHoles(T, ctx, entries) {
    entries.forEach(function (e) {
      if ((e.cat !== 'holes' && e.cat !== 'bores') || !e.d || !e.obj.name) return;
      var keys = findThreadKeys(T, e.obj.name);
      if (!keys.length) return;
      var th = keys[0].th, nm = e.obj.name;
      var col = /heat-set|insert/i.test(nm) ? 'insert' : /tap/i.test(nm) ? 'tap' : (classIn(nm, th.sys) || 'any');
      judgeThread(T, ctx, { thread: th, lit: e.d, col: col, at: e.dAt, span: '"' + nm + '" d_mm ' + e.d.text, reason: null, claim: [claim(e.dAt, e.d.text.length)] });
    });
  }

  function scanTemplate(T, name, file, text) {
    var ctx = makeCtx('template:' + name, file, text, 1);
    var entries = flightEntries(text);
    resolveFlightHoles(T, ctx, entries);
    resolveFlightFits(T, ctx, entries);
    var lines = text.split('\n'), off = 0;
    var lastNoteParamFor = {};
    lines.forEach(function (line) {
      var start = off;
      off += line.length + 1;
      var note = /^\/\/\s*(NOTE|MAKE):\s?(.*)$/.exec(line);
      var prm = /^\s*([a-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*\/\/\s*(.*)$/.exec(line);
      if (note) {
        var s = line, ls = start;
        resolveProseFasteners(T, ctx, ls, s);
        resolveProseOrings(T, ctx, ls, s, null);
        resolveProseFits(T, ctx, ls, s, null, entries);
      } else if (prm) {
        var cAt = line.indexOf('//');
        var cs = start + cAt, comment = line.slice(cAt);
        var param = { name: prm[1], value: parseNum(prm[2]), valueAt: start + line.indexOf(prm[2], line.indexOf('=')), line: line };
        resolveParamFastener(T, ctx, cs, comment, param);
        resolveProseOrings(T, ctx, cs, comment, param);
        resolveProseFits(T, ctx, cs, comment, param, entries);
      }
    });
    return ctx;
  }

  /* Parameter lines: "bolt_d = 6.40; // M6 clearance, ISO 273 fine", "tb_drill = 3.45; // #8-32 tap drill, #29 = 0.1360 in". */
  function resolveParamFastener(T, ctx, cStart, comment, param) {
    var keys = findThreadKeys(T, comment);
    if (!keys.length) return;
    var th = keys[0].th, col = null;
    if (/heat-set insert/i.test(comment)) col = 'insert';
    else if (/tap drill/i.test(comment)) col = 'tap';
    else if (/clearance/i.test(comment)) col = classIn(comment, th.sys) || 'any';
    if (!col) return;
    var reason = null;
    if (col === 'any') {
      reason = reasonAfterClearance(comment);
    }
    judgeThread(T, ctx, { thread: th, lit: param.value, col: col, at: param.valueAt, span: param.line.trim().slice(0, 110), reason: reason, claim: [claim(param.valueAt, param.value.text.length), claim(cStart + keys[0].at, keys[0].text.length)] });
    // "#29 = 0.1360 in" inside the comment: the drill name and its inch size
    var dm = /(#\d+|\b[A-Z]\b)\s*=\s*(\d*\.\d+)\s*in/.exec(comment) || /\((#\d+)\)/.exec(comment);
    if (dm && col === 'tap' && th.sys === 'un') {
      var nameAt = cStart + dm.index + dm[0].indexOf(dm[1]);
      var names = th.rows.map(function (r) { return r.tap_drill_75; });
      Finding(ctx, { family: 'fasteners_un', key: th.key, what: 'tap drill name', literal: dm[1], verdict: names.indexOf(dm[1]) >= 0 ? 'AGREES' : 'DISAGREES', at: nameAt, span: comment.trim(),
        table: { display: names.join(' / '), file: 'fasteners_un.json', row: th.key, column: 'tap_drill_75', confidence: th.rows[0].confidence }, claim: [claim(nameAt, dm[1].length)] });
      if (dm[2]) {
        var inAt = cStart + dm.index + dm[0].lastIndexOf(dm[2]);
        judgeThread(T, ctx, { thread: th, lit: parseNum(dm[2]), col: 'tap', unit: 'in', at: inAt, span: comment.trim(), claim: [claim(inAt, dm[2].length)] });
      }
    }
  }

  // ------------------------------------------------------------------ GRADE_SY
  /* The literal { '8.8':640, … } against fasteners_metric.grades yield_MPa. SAE J429 grades and
     "18-8" have no table; a4-80 has no row but the code reads it as class 80 (A2-80's numbers). */
  var GRADE_ASSUMED = { 'a4-80': { to: 'A2-80', why: 'the table carries A2 classes only; ISO 3506-1 gives A4 the same class-80 properties as A2 [Likely, not verified against the standard here]' } };
  function gradeSyKeys(text) {
    var lm = /const GRADE_SY\s*=\s*\{([^}]*)\}/.exec(text), out = [], m, re = /'([^']+)'\s*:/g;
    if (!lm) return null;
    while ((m = re.exec(lm[1]))) out.push(m[1].toLowerCase());
    return out;
  }
  function scanGradeSy(T, text, lineBase, file) {
    var ctx = makeCtx('GRADE_SY', file || 'index.html', text, lineBase);
    var lm = /const GRADE_SY\s*=\s*\{([^}]*)\}/.exec(text);
    if (!lm) return ctx;
    var body = lm[1], bodyAt = lm.index + lm[0].indexOf(body);
    var grades = T.fasteners_metric.grades, gkeys = Object.keys(grades).filter(function (k) { return grades[k] && grades[k].yield_MPa != null; });
    var re = /'([^']+)'\s*:\s*(\d+(?:\.\d+)?)/g, m, entries = {};
    while ((m = re.exec(body))) {
      var key = m[1], lit = parseNum(m[2]), at = bodyAt + m.index + m[0].lastIndexOf(m[2]);
      entries[key] = +m[2];
      var tk = gkeys.filter(function (g) { return g.toLowerCase() === key.toLowerCase(); })[0];
      var base = { family: 'fasteners_metric.grades', key: key, what: 'bolt yield, MPa', literal: m[2], unit: 'MPa', at: at, span: m[0], claim: [claim(at, m[2].length), claim(bodyAt + m.index, m[1].length + 2)] };
      if (tk) {
        var g = grades[tk];
        Finding(ctx, Object.assign(base, { verdict: agrees(lit, g.yield_MPa) ? 'AGREES' : 'DISAGREES', table: { value: g.yield_MPa, display: g.yield_MPa + ' MPa', file: 'fasteners_metric.json', row: 'grades.' + tk, column: 'yield_MPa', confidence: g.confidence },
          note: g.note && /d > 16|d <= 16/.test(g.note) ? 'the table\'s note gives a different yield above M16 ("' + g.note.slice(0, 70) + '…"); GRADE_SY applies one value to every size' : '' }));
      } else if (GRADE_ASSUMED[key.toLowerCase()]) {
        var a = GRADE_ASSUMED[key.toLowerCase()], ga = grades[a.to];
        Finding(ctx, Object.assign(base, { verdict: 'MAPPED', table: { value: ga.yield_MPa, display: ga.yield_MPa + ' MPa (' + a.to + ')', file: 'fasteners_metric.json', row: 'grades.' + a.to, column: 'yield_MPa', confidence: ga.confidence },
          note: (agrees(lit, ga.yield_MPa) ? 'equals ' : 'differs from ') + a.to + ' by assumption: ' + a.why }));
      } else if (/^(grade )?[258]$/.test(key)) {
        Finding(ctx, Object.assign(base, { verdict: 'UNBACKED', note: 'SAE J429 grade ' + key.replace('grade ', '') + ': no PartForge table carries SAE J429 strengths (fasteners_un has no grades); not corrected here' }));
      } else {
        Finding(ctx, Object.assign(base, { verdict: 'UNBACKED', note: key === '18-8' ? '"18-8" is an alloy family, not a property class; no table row (the code comment equates it to A2-70)' : 'no grades row' }));
      }
    }
    // the comment above the literal is a second copy of it: "8.8 → 640", "grade 2 → 393", "A2-70 / 18-8 stainless ≈ 450"
    var cm = /\/\*[\s\S]*?Bolt grade[\s\S]*?\*\//.exec(text);
    if (cm) {
      var cre = /((?:grade\s+)?[\dA-Za-z.\-]+(?:\s*\/\s*[\dA-Za-z.\-]+)?)(?:\s+stainless)?\s*(?:→|≈)\s*(\d+)/g, c;
      while ((c = cre.exec(cm[0]))) {
        var names = c[1].split('/').map(function (x) { return x.trim().toLowerCase(); });
        var cAt = cm.index + c.index + c[0].lastIndexOf(c[2]);
        names.forEach(function (nmk) {
          var lk = nmk.replace(/^grade\s+/, '');
          var lv = entries[nmk] != null ? entries[nmk] : entries[lk];
          if (lv == null) return;
          Finding(ctx, { family: 'GRADE_SY (comment vs literal)', key: nmk, what: 'comment restates the literal', literal: c[2], unit: 'MPa', at: cAt, span: c[0], verdict: +c[2] === lv ? 'AGREES' : 'DISAGREES',
            table: { value: lv, display: lv + ' MPa (GRADE_SY literal)', file: 'index.html', row: 'GRADE_SY', column: nmk, confidence: 'code' }, claim: [claim(cAt, c[2].length)] });
        });
      }
    }
    return ctx;
  }

  // ------------------------------------------------------------------ copies
  /* A template file in tests/templates/ against the copy index.html ships (TEMPLATES_FLIGHT),
     line by line (LCS), so a NOTE edited in one copy is seen. */
  function lcsPairs(a, b) {
    var n = a.length, mlen = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Int32Array(mlen + 1)); }
    for (i = n - 1; i >= 0; i--) for (j = mlen - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    var ra = [], rb = [];
    while (i < n && j < mlen) {
      if (a[i] === b[j]) { if (ra.length || rb.length) { out.push({ a: ra, b: rb }); ra = []; rb = []; } i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ra.push(i++);
      else rb.push(j++);
    }
    while (i < n) ra.push(i++);
    while (j < mlen) rb.push(j++);
    if (ra.length || rb.length) out.push({ a: ra, b: rb });
    return out;
  }
  function compareCopies(templates, shipped) {
    var ctx = makeCtx('copies', 'tests/templates', '', 1);
    templates.forEach(function (t) {
      var first = t.text.split('\n')[0];
      var s = shipped.filter(function (x) { return x.text.split('\n')[0] === first; })[0];
      if (!s) {
        ctx.findings.push({ source: 'copies', file: t.file, line: 1, family: 'copies', key: t.name, what: 'shipped copy', literal: first.slice(0, 60), unit: '', verdict: 'COPY-DRIFT', table: { display: 'no TEMPLATES_FLIGHT entry starts with this line', file: 'index.html' }, span: first.slice(0, 100), note: '' });
        return;
      }
      var A = t.text.replace(/\n$/, '').split('\n'), B = s.text.replace(/\n$/, '').split('\n');
      lcsPairs(A, B).forEach(function (h) {
        var n = Math.max(h.a.length, h.b.length);
        for (var k = 0; k < n; k++) {
          var ia = h.a[k], ib = h.b[k];
          ctx.findings.push({ source: 'copies', file: t.file, line: ia != null ? ia + 1 : (h.a[0] != null ? h.a[0] + 1 : 0), family: 'copies', key: t.name, what: 'template line vs the copy index.html ships',
            literal: ia != null ? A[ia] : '(line absent)', unit: '', verdict: 'COPY-DRIFT',
            table: { display: ib != null ? B[ib] : '(line absent)', file: 'index.html', row: 'TEMPLATES_FLIGHT "' + s.name + '"', column: 'line ' + (ib != null ? s.line + ib : '—'), confidence: 'code' },
            span: '', note: 'tests/flight-decl.test.mjs compares only each file\'s "loads" line with index.html' });
        }
      });
    });
    return ctx;
  }

  // ------------------------------------------------------------------ doctrine
  function scanDoctrine(T, text, lineBase, source, file, gradeKeys) {
    var ctx = makeCtx(source || 'doctrine', file || 'index.html', text, lineBase);
    resolveKeyLists(T, ctx);
    resolveVendorsShare(T, ctx);
    resolveTableSaysKn(T, ctx);
    resolveCaseList(T, ctx);
    resolveGradeNames(T, ctx, gradeKeys);
    resolveClassSentences(T, ctx);
    resolveFitZones(T, ctx);
    resolveDoctrineGlands(T, ctx);
    resolveNasa(T, ctx);
    resolveCounts(T, ctx);
    resolveMmt(T, ctx);
    resolveFlightFits(T, ctx);
    return ctx;
  }

  // ------------------------------------------------------------------ the unpaired inventory
  function inventory(ctx) {
    var masked = mask(ctx.text), out = [];
    var re = /(?<![\w.#\/])(\d+(?:\.\d+)?|\.\d+)(?![\w\/])/g, m;
    while ((m = re.exec(masked))) {
      var a = m.index, b = a + m[0].length;
      var claimed = ctx.claims.some(function (c) { return c[0] < b && a < c[1]; });
      if (claimed) continue;
      var ctxt = ctx.text.slice(Math.max(0, a - 28), Math.min(ctx.text.length, b + 20)).replace(/\s+/g, ' ');
      out.push({ line: ctx.lineAt(a), number: m[0], context: ctxt });
    }
    return out;
  }

  // ------------------------------------------------------------------ slicing index.html
  function lineOf(text, off) { var n = 1; for (var i = 0; i < off; i++) if (text.charCodeAt(i) === 10) n++; return n; }
  /* The same slice tests/run.mjs takes: from after "return `" in flightSystemPrompt() to the first "`;". */
  function sliceDoctrine(html) {
    var a = html.indexOf('function flightSystemPrompt(){');
    if (a < 0) return null;
    var open = html.indexOf('return `', a) + 8, close = html.indexOf('`;', open);
    if (open < 8 || close < 0) return null;
    return { text: html.slice(open, close), lineBase: lineOf(html, open), start: open, end: close };
  }
  /* GRADE_SY with the comment block above it ("/* Bolt grade → yield …"). */
  function sliceGradeSy(html) {
    var g = html.indexOf('const GRADE_SY');
    if (g < 0) return null;
    var c = html.lastIndexOf('/*', g);
    var start = c >= 0 && html.slice(c, g).indexOf('*/') >= 0 && g - c < 3000 ? c : html.lastIndexOf('\n', g) + 1;
    var end = html.indexOf('\n', g);
    return { text: html.slice(start, end < 0 ? html.length : end), lineBase: lineOf(html, start), start: start, end: end };
  }
  /* TEMPLATES_FLIGHT code strings as the app ships them, unescaped; an unescaped ${ (an interpolation
     this cannot reproduce) is refused. */
  function shippedTemplates(html) {
    var p = html.indexOf('TEMPLATES_FLIGHT.push(');
    if (p < 0) return null;
    var end = html.indexOf('\n);', p);
    var out = [], i = p, m;
    var re = /\{ name:"((?:[^"\\]|\\.)*)"[^\n]*?code:`/g;
    re.lastIndex = p;
    while ((m = re.exec(html)) && (end < 0 || m.index < end)) {
      var s = re.lastIndex, j = s, raw = '';
      while (j < html.length) {
        var ch = html[j];
        if (ch === '\\') { var nx = html[j + 1]; raw += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === 'r' ? '\r' : nx; j += 2; continue; }
        if (ch === '`') break;
        if (ch === '$' && html[j + 1] === '{') return { error: 'unescaped ${ inside a flight template at index.html:' + lineOf(html, j) };
        raw += ch; j++;
      }
      out.push({ name: JSON.parse('"' + m[1] + '"'), line: lineOf(html, s), text: raw });
      re.lastIndex = j + 1;
    }
    return out;
  }

  /* Shipped templates as build-data.mjs stores them (sameAs, sameAs + replaced lines, or full text);
     callers that can hash check each against its sha256. */
  function rebuildShipped(stored, templates) {
    return stored.map(function (s) {
      if (s.text != null) return { name: s.name, line: s.line, sha256: s.sha256, text: s.text };
      var t = templates.filter(function (x) { return x.file === s.sameAs; })[0];
      if (!t) return { name: s.name, line: s.line, sha256: s.sha256, text: null };
      var lines = t.text.split('\n');
      Object.keys(s.replace || {}).forEach(function (k) { lines[+k] = s.replace[k]; });
      return { name: s.name, line: s.line, sha256: s.sha256, text: lines.join('\n') };
    });
  }

  /* The doctrine's three table-number bullets ("- Use standard sizes", "- Fits (ISO 286", "- O-rings"),
     which is what the historical replays keep. */
  function tableBullets(doc) {
    var lines = doc.text.split('\n');
    var i = -1;
    for (var k = 0; k < lines.length; k++) if (/^- Use standard sizes\./.test(lines[k])) { i = k; break; }
    if (i < 0) return null;
    var end = i + 1;
    while (end < lines.length && /^- (Fits \(ISO 286|O-rings)/.test(lines[end])) end++;
    return { text: lines.slice(i, end).join('\n'), lineBase: doc.lineBase + i };
  }

  // ------------------------------------------------------------------ run and report
  function count(findings) {
    var c = {};
    VERDICTS.forEach(function (v) { c[v] = 0; });
    findings.forEach(function (f) { c[f.verdict] = (c[f.verdict] || 0) + 1; });
    return c;
  }
  function finish(ctx, label, extra) {
    ctx.findings.sort(function (x, y) { return x.line - y.line || 0; });
    var inv = ctx.text ? inventory(ctx) : [];
    var numbers = ctx.text ? (mask(ctx.text).match(/(?<![\w.#\/])(\d+(?:\.\d+)?|\.\d+)(?![\w\/])/g) || []).length : 0;
    return Object.assign({ id: ctx.source, label: label, file: ctx.file, findings: ctx.findings, counts: count(ctx.findings), numbers: numbers, unpaired: inv }, extra || {});
  }
  /* inputs: { commit, doctrine: {text, lineBase}, gradeSy: {text, lineBase}, templates: [{name, file, text}],
               shipped: [{name, line, text}], history: [{commit, text, lineBase}] } */
  function run(T, inputs) {
    var sources = [];
    var gradeKeys = inputs.gradeSy ? gradeSyKeys(inputs.gradeSy.text) : null;
    if (inputs.doctrine) sources.push(finish(scanDoctrine(T, inputs.doctrine.text, inputs.doctrine.lineBase, 'doctrine', 'index.html', gradeKeys), 'flightSystemPrompt() doctrine', { commit: inputs.commit }));
    if (inputs.gradeSy) sources.push(finish(scanGradeSy(T, inputs.gradeSy.text, inputs.gradeSy.lineBase, 'index.html'), 'GRADE_SY literal and its comment', { commit: inputs.commit }));
    (inputs.templates || []).forEach(function (t) { sources.push(finish(scanTemplate(T, t.name, t.file, t.text), t.file, { commit: inputs.commit })); });
    if (inputs.templates && inputs.shipped) { var cc = compareCopies(inputs.templates, inputs.shipped); sources.push({ id: 'copies', label: 'tests/templates/*.scad vs TEMPLATES_FLIGHT in index.html', file: 'tests/templates', findings: cc.findings, counts: count(cc.findings), numbers: 0, unpaired: [], commit: inputs.commit }); }
    (inputs.history || []).forEach(function (h) {
      sources.push(finish(scanDoctrine(T, h.text, h.lineBase, 'doctrine@' + h.commit, 'index.html'), 'doctrine at ' + h.commit + ' (history)', { commit: h.commit, history: true }));
    });
    var all = [];
    sources.forEach(function (s) { all = all.concat(s.findings); });
    var totals = count(all);
    return { commit: inputs.commit, sources: sources, totals: totals, failing: all.filter(function (f) { return FAILING[f.verdict]; }).length };
  }

  function pad(s, n) { s = String(s); return s.length >= n ? s + ' ' : s + new Array(n - s.length + 1).join(' '); }
  function formatFinding(f) {
    var where = f.file + ':' + f.line;
    var t = f.table ? f.table.display + (f.table.confidence && f.table.confidence !== 'code' && f.table.confidence !== 'count' ? '  [' + f.table.confidence + ']' : '') : '';
    var lines = [pad(f.verdict, 11) + pad(where, 22) + pad(f.key, 16) + f.what];
    if (f.verdict === 'COPY-DRIFT') {
      lines.push('           this file: ' + f.literal.slice(0, 150));
      lines.push('           shipped  : ' + (f.table ? f.table.display.slice(0, 150) : '') + (f.table && f.table.column ? '   (index.html ' + f.table.column + ')' : ''));
    } else {
      lines.push('           literal ' + f.literal + (f.unit && !/[a-zµ]$/.test(f.literal) ? ' ' + f.unit : '') + '   table ' + (t || '—') + (f.table && f.table.file ? '   ← ' + f.table.file + (f.table.row ? ' ' + f.table.row : '') + (f.table.column ? ' ' + f.table.column : '') : ''));
      if (f.span) lines.push('           "' + f.span + '"');
    }
    if (f.note) lines.push('           ' + f.note);
    if (f.looksLike) lines.push('           equals, at its printed precision: ' + f.looksLike.join('; '));
    return lines.join('\n');
  }
  function formatText(result, opts) {
    opts = opts || {};
    var out = [];
    out.push('Second Copy — numbers PartForge restates from its own tables' + (result.commit ? ', at ' + result.commit : ''));
    out.push('agrees = equal at the literal\'s printed precision (±½ unit in its last digit); inch columns as in × 25.4');
    out.push('');
    result.sources.forEach(function (s) {
      var c = s.counts;
      var parts = VERDICTS.filter(function (v) { return c[v]; }).map(function (v) { return c[v] + ' ' + v; });
      out.push('== ' + s.label + (s.commit && s.history ? '' : '') + ' — ' + (s.findings.length ? parts.join(', ') : 'nothing paired') + (s.numbers ? '; ' + s.unpaired.length + ' of ' + s.numbers + ' numbers unpaired' : ''));
      var show = s.findings.filter(function (f) { return opts.all || f.verdict !== 'AGREES'; });
      show.forEach(function (f) {
        if (!opts.brief) return out.push(formatFinding(f));
        out.push(pad(f.verdict, 11) + pad(f.file + ':' + f.line, 17) + pad(f.key, 15) + pad(f.what.replace(/^(Chart 4-3 |Table 4-2 )/, '').slice(0, 40), 41) + f.literal +
          (f.table && f.table.display ? ' vs ' + f.table.display.replace(/\s*\(.*$/, '').slice(0, 40) : '') + (f.looksLike ? '  (= ' + f.looksLike[0] + ')' : ''));
      });
      if (!opts.all && c.AGREES) {
        var byFam = {};
        s.findings.filter(function (f) { return f.verdict === 'AGREES'; }).forEach(function (f) { byFam[f.family] = (byFam[f.family] || 0) + 1; });
        out.push('AGREES     ' + Object.keys(byFam).map(function (k) { return byFam[k] + ' × ' + k; }).join(', ') + '   (--all lists them)');
      }
      if (opts.unpaired && s.unpaired.length) {
        out.push('UNPAIRED   numbers no resolver claimed (not judged):');
        s.unpaired.forEach(function (u) { out.push('           ' + pad(s.file + ':' + u.line, 22) + pad(u.number, 9) + '…' + u.context + '…'); });
      }
      out.push('');
    });
    var t = result.totals;
    out.push('TOTAL      ' + VERDICTS.filter(function (v) { return t[v]; }).map(function (v) { return t[v] + ' ' + v; }).join(', ') + '; ' + (result.failing ? 'exit 1 (' + result.failing + ' DISAGREES or COPY-DRIFT)' : 'exit 0'));
    return out.join('\n') + '\n';
  }

  return {
    VERSION: '1', VERDICTS: VERDICTS, FAILING: FAILING, EXCERPT: EXCERPT, TABLE_FILES: TABLE_FILES,
    parseNum: parseNum, agrees: agrees, halfUnit: halfUnit, mask: mask,
    parseThread: parseThread, threadCandidates: threadCandidates, looksLike: looksLike,
    fitStepFor: fitStepFor, fitStepByRange: fitStepByRange, zoneUm: zoneUm,
    scanDoctrine: scanDoctrine, scanGradeSy: scanGradeSy, scanTemplate: scanTemplate, compareCopies: compareCopies,
    flightEntries: flightEntries, inventory: inventory, run: run,
    sliceDoctrine: sliceDoctrine, sliceGradeSy: sliceGradeSy, tableBullets: tableBullets, rebuildShipped: rebuildShipped, shippedTemplates: shippedTemplates, lineOf: lineOf, formatText: formatText, formatFinding: formatFinding, count: count
  };
});
