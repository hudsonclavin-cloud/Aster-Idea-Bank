// census.js — the Confidence Census kernel. Pure functions, no I/O: loads as a classic script in
// the page (window.Census) and through require() in Node (the CLI, build-data.mjs and the tests).
//
// It reads PartForge's reference tables (data/tables/*.json, one shape:
// {table, license_note, columns, rows:[{key, confidence, source, …}], notes, reconciliation})
// through a compact "lint view" (viewOf), counts what each table says about itself, and reports
// the gaps as findings {table, key, rule, severity, detail}. It also reconciles the two
// hand-written census statements the repo keeps — the confidence-policy column of data/README.md
// and the "Overall confidence" lines of docs/data/PROVENANCE.md — against the counted rows.
//
// Severities: "defect" = the repo states something its own data contradicts, or a row breaks the
// shape data/README.md promises; "review" = a judgment the maintainer has to make (the rule cannot
// tell a deliberate choice from a slip); "info" = a census fact or a ledger entry. Nothing here
// edits a table.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Census = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LABELS = ['certain', 'likely', 'recall'];
  var RANK = { certain: 3, likely: 2, recall: 1 };
  var SEVERITIES = ['defect', 'review', 'info'];
  // A screening threshold chosen by the proposal (queue/proposals/29-confidence-census.json), not a
  // number from any standard: a set's stored length more than 20 % from the median of its own
  // per-record lengths is worth a look.
  var LENGTH_TOLERANCE = 0.20;
  // Fields the views keep beyond key/confidence/source because a rule reads them.
  var EXTRA_FIELDS = ['vendor', 'len_mm', 'len_variants', 'current', 'current_upstream_main'];

  // id → severity, one-line title, and where the rule's expectation comes from.
  var RULES = {
    'no-rows': ['defect', 'table has no rows', 'data/README.md:22 — every table carries `rows`, and every row carries `key`, `confidence` and `source`'],
    'key-missing': ['defect', 'row has no key', 'data/README.md:22-23 — every row carries `key`'],
    'key-duplicate': ['defect', 'key used by more than one row', 'a key is the row\'s address; two rows cannot share one'],
    'confidence-invalid': ['defect', 'confidence outside certain / likely / recall', 'data/README.md:23 — `certain` / `likely` / `recall`'],
    'source-missing': ['defect', 'row has no source', 'data/README.md:22-23 — every row carries `source`'],
    'no-columns': ['defect', 'table has no columns block', 'data/README.md:22 — `columns` (what each field means and where it came from)'],
    'undocumented-field': ['defect', 'row field the columns block never describes', 'data/README.md:22 — `columns` (what each field means and where it came from)'],
    'no-license-note': ['defect', 'table has no license_note', 'data/README.md:21-22 — every table has the same shape, `license_note` included'],
    'policy-mismatch': ['defect', 'hand-written census contradicted by the rows', 'data/README.md:30-45 policy column; docs/data/PROVENANCE.md "Overall confidence" lines'],
    'label-vs-text': ['review', 'label certain/likely, source text says recall', 'docs/data/PROVENANCE.md:15 — likely may rest on "three independent recalls", so this is a review list'],
    'field-weaker-than-row': ['review', 'a field is labelled weaker than its row', 'docs/data/PROVENANCE.md:17 — row confidence is "always the weakest load-bearing field"'],
    'dateless': ['review', 'no date anywhere in the table\'s metadata', 'docs/roadmap-evaluation.md:286 — guard: "a data-date on every hint line"'],
    'inch-mm': ['review', 'inch and mm disagree beyond the declared rounding', 'the rounding each pair\'s columns text declares'],
    'length-vs-records': ['review', 'stored length far from the median of its own records', 'docs/roadmap-evaluation.md:246 (c) — the Loki 38/240 length outlier'],
    'supplement-no-key': ['review', 'supplement rows with no key', 'a finding about a row needs an address'],
    'policy-missing-table': ['review', 'table and policy statement do not line up', 'data/README.md:30-45 lists every table'],
    'disputed': ['info', 'disputed entries (the page lists every one)', 'data/README.md:23-24 — a `disputed` entry records what a reviewer contested and what was kept'],
    'unused-column': ['info', 'columns describes a field no row carries', 'documentation for nothing'],
    'inch-mm-undeclared': ['info', 'inch/mm pairs with no declared rounding (not checked)', 'no rounding stated, so no tolerance to test against'],
    'supplement-census': ['info', 'supplement confidence census', 'supplements are outside the rows contract'],
    'policy-prose': ['info', 'policy prose the parser cannot count (not reconciled)', 'reported, never guessed']
  };
  var RULE_ORDER = Object.keys(RULES);

  // ------------------------------------------------------------------ small helpers
  function own(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function isLabel(x) { return LABELS.indexOf(x) >= 0; }
  function nonEmpty(v) {
    if (v == null || v === '' || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }
  function leadLabel(v) {
    if (typeof v !== 'string') return null;
    var m = /^\s*(certain|likely|recall)\b/i.exec(v);
    return m ? m[1].toLowerCase() : null;
  }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function round(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }
  function clip(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  // Front coding: each string stored as "<n>|<rest>", n = characters shared with the previous one.
  function frontCode(list) {
    var prev = '';
    return list.map(function (x) {
      var n = 0;
      while (n < prev.length && n < x.length && prev[n] === x[n]) n++;
      prev = x;
      return (n ? n : '') + '|' + x.slice(n);
    });
  }
  function frontDecode(list) {
    var prev = '';
    return list.map(function (e) {
      var bar = e.indexOf('|');
      var n = bar > 0 ? Number(e.slice(0, bar)) : 0;
      prev = prev.slice(0, n) + e.slice(bar + 1);
      return prev;
    });
  }

  // ISO calendar dates (YYYY-MM-DD) anywhere in a value. Edition years ("ASME B94.11M-1993") are
  // not data dates and do not match.
  function findDates(value) {
    var s = typeof value === 'string' ? value : JSON.stringify(value);
    var re = /\b(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, m, out = [];
    if (s == null) return out;
    while ((m = re.exec(s))) if (out.indexOf(m[0]) < 0) out.push(m[0]);
    return out.sort();
  }

  // The rounding a columns description declares: "3 dp", "to 3 decimals", "rounded to 4 places".
  function declaredDecimals(text) {
    if (typeof text !== 'string') return null;
    var m = /\b(\d)\s*(?:dp|decimals?|decimal places|places)\b/i.exec(text);
    return m ? Number(m[1]) : null;
  }

  function unitPairs(fieldSet) {
    var pairs = [];
    fieldSet.forEach(function (f) {
      if (f === 'in' && fieldSet.has('mm')) pairs.push(['in', 'mm']);
      else if (/_in$/.test(f) && fieldSet.has(f.slice(0, -3) + '_mm')) pairs.push([f, f.slice(0, -3) + '_mm']);
    });
    return pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  }

  // ------------------------------------------------------------------ the lint view
  // viewOf(name, table, info) keeps exactly what the rules read, compactly: every row's key,
  // confidence and source (common prefix/suffix factored out), the index of the row's field-name
  // set, its disputed entries and field_confidence (deduplicated), and the few extra fields some
  // rule needs; plus each table's columns keys (with the text kept only for inch/mm pair fields),
  // the ISO dates found in each metadata block, and the supplement's keys and labels.
  function viewOf(name, t, info) {
    info = info || {};
    var rows = t && Array.isArray(t.rows) ? t.rows : [];
    var fieldUnion = new Set();
    rows.forEach(function (r) { Object.keys(r || {}).forEach(function (k) { fieldUnion.add(k); }); });
    var pairs = unitPairs(fieldUnion);
    var pairFields = new Set();
    pairs.forEach(function (p) { pairFields.add(p[0]); pairFields.add(p[1]); });

    var srcText = rows.map(function (r) { return r && typeof r.source === 'string' ? r.source : r && r.source != null ? JSON.stringify(r.source) : null; });

    var fieldSets = [], fsIndex = {}, disputes = [], dIndex = {}, fcs = [], fcIndex = {};
    function intern(list, index, v) { var k = JSON.stringify(v); if (!own(index, k)) { index[k] = list.length; list.push(v); } return index[k]; }

    var vrows = rows.map(function (r, i) {
      r = r || {};
      var keys = Object.keys(r);
      var o = { key: own(r, 'key') ? r.key : null, confidence: own(r, 'confidence') ? r.confidence : null, f: intern(fieldSets, fsIndex, keys) };
      var s = srcText[i];
      if (s === '') o.empty = 1;            // an empty source string (no `s`: no source at all)
      else if (s != null) o.s = s;
      if (nonEmpty(r.disputed)) {
        o.d = Array.isArray(r.disputed) ? r.disputed.map(function (e) { return intern(disputes, dIndex, e); }) : intern(disputes, dIndex, r.disputed);
      }
      if (nonEmpty(r.field_confidence)) o.fc = intern(fcs, fcIndex, r.field_confidence);
      var x = null;
      keys.forEach(function (k) {
        var keep = (/_confidence$/.test(k) && k !== 'field_confidence') || (pairFields.has(k) && typeof r[k] === 'number') ||
          (EXTRA_FIELDS.indexOf(k) >= 0 && (k.indexOf('len_') !== 0 || own(r, 'len_variants')));
        if (keep) { if (!x) x = {}; x[k] = r[k]; }
      });
      if (x) o.x = x;
      return o;
    });

    var columns = null;
    if (t && t.columns && typeof t.columns === 'object' && !Array.isArray(t.columns)) {
      columns = {};
      Object.keys(t.columns).forEach(function (k) { columns[k] = pairFields.has(k) && typeof t.columns[k] === 'string' ? t.columns[k] : ''; });
    }
    var metaDates = {};
    Object.keys(t || {}).forEach(function (k) { if (k === 'rows') return; var d = findDates(t[k]); if (d.length) metaDates[k] = d; });

    var supplement = null;
    if (t && Array.isArray(t.supplement)) {
      supplement = { shape: 'array', key: [], confidence: [], src: [] };
      t.supplement.forEach(function (r) {
        r = r || {};
        supplement.key.push(own(r, 'key') ? r.key : null);
        supplement.confidence.push(own(r, 'confidence') ? r.confidence : null);
        supplement.src.push(typeof r.source === 'string' && r.source !== '' ? 1 : 0);
      });
    } else if (t && t.supplement && typeof t.supplement === 'object') {
      supplement = { shape: 'object', keys: Object.keys(t.supplement) };
    }

    var top = {};
    if (t && own(t, 'disputed')) top.disputed = t.disputed;
    if (t && own(t, 'fits')) top.fits_count = Array.isArray(t.fits) ? t.fits.length : t.fits && typeof t.fits === 'object' ? Object.keys(t.fits).length : null;
    if (t && nonEmpty(t.field_confidence)) top.field_confidence = t.field_confidence;

    // Column-wise packing: one array per attribute instead of repeating field names on every row.
    var segSet = {};
    vrows.forEach(function (o) { if (o.s != null) o.s.split('; ').forEach(function (g) { segSet[g] = 1; }); });
    var segs = Object.keys(segSet).sort(), segIndex = {};
    segs.forEach(function (g, i) { segIndex[g] = i; });
    // confidence values are interned (c: index into `labels`); d and fc are sparse {rowIndex: value}.
    var labels = [], labelIndex = {};
    var packed = { n: vrows.length, key: [], c: [], s: [], f: [], d: {}, fc: {}, x: {} };
    var xFields = [];
    vrows.forEach(function (o) { if (o.x) Object.keys(o.x).forEach(function (k) { if (xFields.indexOf(k) < 0) xFields.push(k); }); });
    xFields.sort();
    xFields.forEach(function (k) { packed.x[k] = []; });
    vrows.forEach(function (o, i) {
      packed.key.push(o.key);
      packed.c.push(intern(labels, labelIndex, o.confidence));
      var parts = o.s == null ? null : o.s.split('; ').map(function (g) { return segIndex[g]; });
      packed.s.push(o.empty ? -1 : parts == null ? null : parts.length === 1 ? parts[0] : parts);
      packed.f.push(o.f);
      if (o.d != null) packed.d[i] = o.d;
      if (o.fc != null) packed.fc[i] = o.fc;
      xFields.forEach(function (k) { packed.x[k].push(o.x && own(o.x, k) ? o.x[k] : null); });
    });

    // (front coding is lossless only for strings; a table with a missing or non-string key keeps the raw column)
    if (packed.key.every(function (k) { return typeof k === 'string'; })) { packed.key = frontCode(packed.key); packed.key_coded = 1; }

    var view = {
      table: name,
      source: { path: info.path || null, commit: info.commit || null, sha256: info.sha256 || null },
      meta_keys: Object.keys(t || {}),
      license_note_chars: t && typeof t.license_note === 'string' ? t.license_note.trim().length : 0,
      meta_dates: metaDates,
      columns: columns,
      top: top,
      src: { joint: '; ', segments: frontCode(segs) },
      field_sets: fieldSets,
      disputes: disputes,
      field_confidences: fcs,
      labels: labels,
      rows: packed,
      supplement: supplement
    };
    // Only for a broken table (`rows` not an array), for the no-rows rule; well-formed views lack the key.
    if (t && own(t, 'rows') && !Array.isArray(t.rows)) view.rows_invalid = t.rows === null ? 'null' : typeof t.rows;
    return view;
  }

  // Unpack a view's rows into objects {key, confidence, s, f, d, fc, x} (cached per view).
  var unpacked = typeof WeakMap === 'function' ? new WeakMap() : null;
  function rowsOf(v) {
    if (unpacked && unpacked.has(v)) return unpacked.get(v);
    var P = v.rows, out = [];
    var xFields = Object.keys(P.x || {});
    var segs = frontDecode(v.src.segments);
    var keys = P.key_coded ? frontDecode(P.key) : P.key;
    for (var i = 0; i < P.n; i++) {
      var o = { key: keys[i], confidence: v.labels[P.c[i]], f: P.f[i] };
      var si = P.s[i];
      if (si === -1) o.empty = 1;
      else if (si != null) o.s = (Array.isArray(si) ? si : [si]).map(function (j) { return segs[j]; }).join(v.src.joint);
      if (own(P.d, i)) o.d = P.d[i];
      if (own(P.fc, i)) o.fc = P.fc[i];
      var fs = v.field_sets[o.f] || [];
      for (var j = 0; j < xFields.length; j++) if (fs.indexOf(xFields[j]) >= 0) { if (!o.x) o.x = {}; o.x[xFields[j]] = P.x[xFields[j]][i]; }
      out.push(o);
    }
    if (unpacked) unpacked.set(v, out);
    return out;
  }

  // Accessors that restore what viewOf factored out.
  function rowSource(v, r) { return r.empty ? '' : r.s == null ? null : r.s; }
  function rowFields(v, r) { return v.field_sets[r.f] || []; }
  function rowDisputed(v, r) {
    if (r.d == null) return [];
    return Array.isArray(r.d) ? r.d.map(function (i) { return v.disputes[i]; }) : [v.disputes[r.d]];
  }
  function rowFieldConfidence(v, r) { return r.fc == null ? null : v.field_confidences[r.fc]; }
  function rowX(r, k) { return r.x && own(r.x, k) ? r.x[k] : undefined; }
  // Which field(s) a disputed entry is about: its `field` property, or the keys of a field→text map.
  function disputedFields(e) {
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      if (typeof e.field === 'string') return [e.field];
      return Object.keys(e);
    }
    return [];
  }
  function disputedSummary(e) {
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      if (typeof e.field === 'string') {
        var val = own(e, 'value') ? e.value : own(e, 'skeptic_value') ? e.skeptic_value : own(e, 'kept') ? 'kept ' + JSON.stringify(e.kept) : own(e, 'compiled') ? e.compiled : '';
        return e.field + (val !== '' ? ': ' + (typeof val === 'string' ? val : JSON.stringify(val)) : '');
      }
      return Object.keys(e).map(function (k) { return k + ': ' + (typeof e[k] === 'string' ? e[k] : JSON.stringify(e[k])); }).join('; ');
    }
    return typeof e === 'string' ? e : JSON.stringify(e);
  }

  // ------------------------------------------------------------------ per-table census
  function censusTable(v) {
    var R = rowsOf(v);
    var c = { table: v.table, rows: R.length, certain: 0, likely: 0, recall: 0, other: 0, disputed_rows: 0, top_disputed: Array.isArray(v.top.disputed) ? v.top.disputed.length : 0 };
    R.forEach(function (r) {
      if (isLabel(r.confidence)) c[r.confidence]++; else c.other++;
      if (r.d != null) c.disputed_rows++;
    });
    var fields = new Set();
    R.forEach(function (r) { rowFields(v, r).forEach(function (f) { fields.add(f); }); });
    c.fields = fields.size;
    c.undocumented = v.columns ? Array.from(fields).filter(function (f) { return !own(v.columns, f); }).length : fields.size;
    c.dates = Object.keys(v.meta_dates).reduce(function (a, k) { v.meta_dates[k].forEach(function (d) { if (a.indexOf(d) < 0) a.push(d); }); return a; }, []).sort();
    c.license_note = v.license_note_chars > 0;
    if (v.supplement && v.supplement.shape === 'array') {
      var S = v.supplement;
      var s = { rows: S.key.length, certain: 0, likely: 0, recall: 0, other: 0, no_key: 0, no_source: 0 };
      for (var i = 0; i < S.key.length; i++) {
        if (isLabel(S.confidence[i])) s[S.confidence[i]]++; else s.other++;
        if (S.key[i] == null || S.key[i] === '') s.no_key++;
        if (!S.src[i]) s.no_source++;
      }
      c.supplement = s;
    } else c.supplement = v.supplement ? { shape: 'object', keys: v.supplement.keys.length } : null;
    return c;
  }

  // ------------------------------------------------------------------ per-table rules
  function finding(table, key, rule, detail, extra) {
    var f = { table: table, key: key == null ? null : key, rule: rule, severity: RULES[rule][0], detail: detail };
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }

  // Every disputed entry of a table, row by row, with the fields it names (the page's ledger).
  function ledger(v) {
    var rows = [], entries = 0, fieldCount = {};
    rowsOf(v).forEach(function (r) {
      var d = rowDisputed(v, r);
      if (!d.length) return;
      entries += d.length;
      var fields = [];
      d.forEach(function (e) { disputedFields(e).forEach(function (f) { if (fields.indexOf(f) < 0) fields.push(f); }); });
      fields.forEach(function (f) { fieldCount[f] = (fieldCount[f] || 0) + 1; });
      rows.push({ key: r.key, confidence: r.confidence, fields: fields, entries: d });
    });
    var tableLevel = Array.isArray(v.top.disputed) ? v.top.disputed.slice() : [];
    tableLevel.forEach(function (e) { disputedFields(e).forEach(function (f) { fieldCount[f] = (fieldCount[f] || 0) + 1; }); });
    var fields = Object.keys(fieldCount).map(function (k) { return [k, fieldCount[k]]; }).sort(function (a, b) { return b[1] - a[1] || cmp(a[0], b[0]); });
    return { table: v.table, rows: rows, entries: entries, table_level: tableLevel, fields: fields };
  }

  function lintTable(v) {
    var out = [];
    var T = v.table;
    var R = rowsOf(v);
    // -- table shape: a table with no rows would otherwise pass every row rule by having nothing to check
    if (v.meta_keys.indexOf('rows') < 0) out.push(finding(T, null, 'no-rows', 'the table has no `rows` key'));
    else if (v.rows_invalid) out.push(finding(T, null, 'no-rows', '`rows` is ' + (v.rows_invalid === 'object' ? 'an object' : v.rows_invalid) + ', not an array'));
    else if (!R.length) out.push(finding(T, null, 'no-rows', '`rows` is an empty array'));
    // -- row shape
    var seen = {};
    R.forEach(function (r, i) {
      if (r.key == null || r.key === '') out.push(finding(T, null, 'key-missing', 'row #' + i + ' has no key'));
      else { if (own(seen, r.key)) seen[r.key]++; else seen[r.key] = 1; }
      if (!isLabel(r.confidence)) out.push(finding(T, r.key, 'confidence-invalid', 'confidence is ' + JSON.stringify(r.confidence)));
      var s = rowSource(v, r);
      if (s == null || String(s).trim() === '') out.push(finding(T, r.key, 'source-missing', 'no source text'));
    });
    Object.keys(seen).sort().forEach(function (k) { if (seen[k] > 1) out.push(finding(T, k, 'key-duplicate', seen[k] + ' rows share this key')); });

    // -- documentation
    var fieldCount = {};
    R.forEach(function (r) { rowFields(v, r).forEach(function (f) { fieldCount[f] = (fieldCount[f] || 0) + 1; }); });
    if (!v.columns) out.push(finding(T, null, 'no-columns', 'the table has no columns object, so no field is documented'));
    else {
      Object.keys(fieldCount).sort().forEach(function (f) {
        if (!own(v.columns, f)) out.push(finding(T, null, 'undocumented-field', '`' + f + '` is carried by ' + fieldCount[f] + ' of ' + R.length + ' rows but not described in columns', { field: f, count: fieldCount[f] }));
      });
      var unused = Object.keys(v.columns).filter(function (k) { return !own(fieldCount, k); }).sort();
      if (unused.length) out.push(finding(T, null, 'unused-column', 'columns describes ' + unused.map(function (k) { return '`' + k + '`'; }).join(', ') + ' but no row carries ' + (unused.length > 1 ? 'them' : 'it'), { fields: unused }));
    }
    if (!v.license_note_chars) out.push(finding(T, null, 'no-license-note', 'no license_note text'));
    var dates = Object.keys(v.meta_dates);
    if (!dates.length) {
      var dated = Object.keys(fieldCount).filter(function (f) { return /^(updated|date|as_of|retrieved)$/.test(f); });
      out.push(finding(T, null, 'dateless', 'no YYYY-MM-DD in ' + v.meta_keys.filter(function (k) { return k !== 'rows'; }).join(', ') +
        (dated.length ? ' (rows carry `' + dated.join('`, `') + '`, a per-record upstream date, not when the table was compiled)' : '')));
    }

    // -- provenance: label vs source text
    R.forEach(function (r) {
      if (r.confidence !== 'certain' && r.confidence !== 'likely') return;
      var s = rowSource(v, r);
      if (!s) return;
      var re = /\b(recall(?:ed)?|from memory)\b/gi, m, quotes = [];
      while ((m = re.exec(s)) && quotes.length < 1) quotes.push(clip(s.slice(Math.max(0, m.index - 40), Math.min(s.length, m.index + m[0].length + 48)), 110));
      if (quotes.length) out.push(finding(T, r.key, 'label-vs-text', 'labelled `' + r.confidence + '`; source says “' + quotes.join('” … “') + '”'));
    });

    // -- field confidence weaker than the row label (aggregated per field and label pair)
    var weak = {};
    function noteWeak(r, field, label, via) {
      if (!isLabel(r.confidence) || !label || RANK[label] >= RANK[r.confidence]) return;
      var k = [field, r.confidence, label, via].join('\u0001');
      if (!weak[k]) weak[k] = { field: field, row: r.confidence, label: label, via: via, keys: [] };
      weak[k].keys.push(r.key);
    }
    var topFC = v.top.field_confidence;
    R.forEach(function (r) {
      var fc = rowFieldConfidence(v, r);
      if (fc && typeof fc === 'object') Object.keys(fc).forEach(function (f) { noteWeak(r, f, leadLabel(fc[f]), 'field_confidence'); });
      if (r.x) Object.keys(r.x).forEach(function (k) { if (/_confidence$/.test(k)) noteWeak(r, k.replace(/_confidence$/, ''), leadLabel(r.x[k]), k); });
      if (topFC && typeof topFC === 'object') LABELS.forEach(function (L) { (Array.isArray(topFC[L]) ? topFC[L] : []).forEach(function (f) { noteWeak(r, f, L, 'table field_confidence'); }); });
    });
    Object.keys(weak).sort().forEach(function (k) {
      var w = weak[k];
      out.push(finding(T, null, 'field-weaker-than-row', w.keys.length + ' row' + (w.keys.length > 1 ? 's' : '') + ' labelled `' + w.row + '` carry `' + w.field + '` as `' + w.label + '` (' + w.via + ')',
        { field: w.field, count: w.keys.length, examples: w.keys.slice(0, 3) }));
    });

    // -- inch / mm pairs against the rounding the columns text declares
    var fset = new Set(Object.keys(fieldCount));
    var undeclared = [];
    unitPairs(fset).forEach(function (p) {
      var nin = v.columns ? declaredDecimals(v.columns[p[0]]) : null;
      var nmm = v.columns ? declaredDecimals(v.columns[p[1]]) : null;
      var n = 0, bad = [], maxd = 0, worst = null;
      var budget = (nmm != null ? 0.5 * Math.pow(10, -nmm) : 0) + (nin != null ? 25.4 * 0.5 * Math.pow(10, -nin) : 0);
      R.forEach(function (r) {
        var a = rowX(r, p[0]), b = rowX(r, p[1]);
        if (typeof a !== 'number' || typeof b !== 'number') return;
        n++;
        var d = Math.abs(a * 25.4 - b);
        if (d > maxd) { maxd = d; worst = r.key; }
        if (budget > 0 && d > budget + 1e-9) bad.push(r.key);
      });
      if (!n) return;
      if (budget === 0) { undeclared.push(p[0] + '/' + p[1] + ' (' + n + ' rows, max ' + round(maxd, 4) + ' mm)'); return; }
      if (bad.length) {
        // Within one full unit of the declared last place (2 × the half-unit budget) the two values
        // differ the way a chain of roundings does; beyond that, one side was probably edited alone.
        var edited = maxd > 2 * budget + 1e-9;
        var f = finding(T, null, 'inch-mm', bad.length + ' of ' + n + ' rows: |' + p[0] + ' × 25.4 − ' + p[1] + '| exceeds ' + round(budget, 5) + ' mm (declared: ' +
          (nin != null ? p[0] + ' ' + nin + ' dp' : '') + (nin != null && nmm != null ? ', ' : '') + (nmm != null ? p[1] + ' ' + nmm + ' dp' : '') + '); worst ' + worst + ' at ' + round(maxd, 4) + ' mm' +
          (edited ? '' : ' — within one unit of the declared last place, a rounding-chain artefact'), { pair: p, count: bad.length, examples: bad.slice(0, 3) });
        if (!edited) f.severity = 'info';
        out.push(f);
      }
    });
    if (undeclared.length) out.push(finding(T, null, 'inch-mm-undeclared', undeclared.join('; '), { count: undeclared.length }));

    // -- stored length against the median of the set's own records
    R.forEach(function (r) {
      var L = rowX(r, 'len_mm'), V = rowX(r, 'len_variants');
      if (typeof L !== 'number' || !Array.isArray(V)) return;
      var nums = V.filter(function (x) { return typeof x === 'number' && isFinite(x); });
      if (!nums.length) return;
      var med = median(nums);
      if (!(med > 0) || Math.abs(L - med) / med <= LENGTH_TOLERANCE) return;
      var disp = rowDisputed(v, r).filter(function (e) { return disputedFields(e).some(function (f) { return /len/.test(f); }); });
      var detail = 'len_mm ' + L + ' vs records [' + nums.join(', ') + '], median ' + round(med, 2) + ' (' + (L > med ? '+' : '') + round(100 * (L - med) / med, 1) + ' %)';
      var f = finding(T, r.key, 'length-vs-records', detail + (disp.length ? '; already disputed — ' + clip(disputedSummary(disp[0]), 140) : '; not disputed'));
      if (disp.length) f.severity = 'info';
      out.push(f);
    });

    // -- the disputed ledger: one census line per table here; ledger(v) lists every entry for the page
    var L = ledger(v);
    if (L.rows.length || L.table_level.length) {
      var top = L.fields.slice(0, 3).map(function (x) { return x[0] + ' ×' + x[1]; }).join(', ');
      out.push(finding(T, null, 'disputed', L.rows.length + ' row' + (L.rows.length === 1 ? '' : 's') + ' carry ' + L.entries + ' disputed entr' + (L.entries === 1 ? 'y' : 'ies') +
        (L.table_level.length ? ' (+' + L.table_level.length + ' table-level)' : '') + (top ? '; most contested: ' + clip(top, 120) : ''), { count: L.rows.length }));
    }

    // -- supplements
    if (v.supplement && v.supplement.shape === 'array') {
      var c = censusTable(v).supplement;
      out.push(finding(T, null, 'supplement-census', c.rows + ' supplement rows: ' + c.certain + ' certain, ' + c.likely + ' likely, ' + c.recall + ' recall' + (c.other ? ', ' + c.other + ' unlabelled' : '') +
        (c.no_source ? '; ' + c.no_source + ' with no source' : '')));
      if (c.no_key) out.push(finding(T, null, 'supplement-no-key', c.no_key + ' of ' + c.rows + ' supplement rows have no `key`', { count: c.no_key }));
    }
    return out;
  }

  // ------------------------------------------------------------------ the policy statements
  // data/README.md's table (header "| table | what | rows | confidence policy |") and
  // docs/data/PROVENANCE.md's "## N. name — …" headings with their "**Overall confidence:**" lines.
  // Input: [{n: lineNumber, text}] for each document (the extract build-data.mjs keeps).
  // Output: {claims: [...], errors: [...]}. A line the parser cannot read becomes a 'prose' claim or
  // an error, never a guessed number.
  var LABEL_RE = 'certain|likely|recall';

  function parseReadmePolicy(lines) {
    var claims = [], errors = [];
    var start = -1;
    for (var i = 0; i < lines.length; i++) if (/^\|\s*table\s*\|\s*what\s*\|\s*rows\s*\|\s*confidence policy\s*\|\s*$/i.test(lines[i].text)) { start = i; break; }
    if (start < 0) { errors.push('data/README.md: the "| table | what | rows | confidence policy |" header was not found'); return { claims: claims, errors: errors, tables: [] }; }
    var tables = [];
    for (var j = start + 1; j < lines.length; j++) {
      var L = lines[j];
      if (!/^\|/.test(L.text)) break;
      if (/^\|\s*-/.test(L.text)) continue;
      var cells = L.text.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      var cite = 'data/README.md:' + L.n;
      if (cells.length !== 4) { errors.push(cite + ': expected 4 cells, found ' + cells.length); continue; }
      var table = cells[0].replace(/`/g, '').trim();
      tables.push(table);
      var base = { doc: 'data/README.md', line: L.n, cite: cite, table: table };
      function claim(o) { var c = {}; Object.keys(base).forEach(function (k) { c[k] = base[k]; }); Object.keys(o).forEach(function (k) { c[k] = o[k]; }); claims.push(c); }
      // rows cell
      var rc = cells[2], m;
      if ((m = /^(\d+)(?:\s*\((\d+)\s+current\))?(?:\s*\+\s*(\d+)\s+supplement)?$/.exec(rc))) {
        claim({ kind: 'rows', n: +m[1], text: rc });
        if (m[2]) claim({ kind: 'current', n: +m[2], text: m[2] + ' current' });
        if (m[3]) claim({ kind: 'supplement', n: +m[3], text: m[3] + ' supplement' });
      } else if ((m = /^(\d+)\s+steps\s*\+\s*(\d+)\s+fits$/.exec(rc))) {
        claim({ kind: 'rows', n: +m[1], text: m[1] + ' steps' });
        claim({ kind: 'fits', n: +m[2], text: m[2] + ' fits' });
      } else claim({ kind: 'prose', text: rc, why: 'rows cell not in a recognised form' });
      // policy cell
      var pc = cells[3];
      var used = [];   // [start, end) spans already turned into claims
      function mark(a, b) { used.push([a, b]); }
      function isUsed(i) { return used.some(function (u) { return i >= u[0] && i < u[1]; }); }
      var whole = new RegExp('^`(' + LABEL_RE + ')`').exec(pc);
      if (whole) { claim({ kind: 'all', label: whole[1], text: whole[0] }); mark(0, whole[0].length); }
      var re = new RegExp('(^|[;,(]\\s*)(\\d+)([^`\\d;]{0,60}?)`(' + LABEL_RE + ')`(?:\\s*\\/\\s*`(' + LABEL_RE + ')`)?', 'g');
      while ((m = re.exec(pc))) {
        var s0 = m.index + m[1].length;
        claim({ kind: 'count', n: +m[2], labels: m[5] ? [m[4], m[5]] : [m[4]], text: pc.slice(s0, m.index + m[0].length) });
        mark(s0, m.index + m[0].length);
      }
      var rd = /(^|[;,(]\s*)(\d+)\s+rows?\s+flagged\s+`disputed`/g;
      while ((m = rd.exec(pc))) { claim({ kind: 'disputed', n: +m[2], text: m[0].replace(/^[;,(]\s*/, '') }); mark(m.index, m.index + m[0].length); }
      var rw = /(^|[;,(]\s*)(\d+)\s+values?\b[^;]*?\bwithheld/g;
      while ((m = rw.exec(pc))) { claim({ kind: 'withheld', n: +m[2], text: m[0].replace(/^[;,(]\s*/, '') }); mark(m.index, m.index + m[0].length); }
      // remaining labels: a subject before them (vendor names, or prose)
      var rl = new RegExp('`(' + LABEL_RE + ')`', 'g');
      while ((m = rl.exec(pc))) {
        if (isUsed(m.index)) continue;
        var before = pc.slice(0, m.index);
        var cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf(','));
        var subject = before.slice(cut + 1).trim();
        var names = subject.replace(/^the\s+/i, '').replace(/\s+rows$/i, '').split(/\s*\/\s*|\s+and\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
        claim({ kind: 'subject', label: m[1], names: names, text: (subject + ' `' + m[1] + '`').trim() });
      }
      // a number that opens a clause and became no claim
      var rn = /(^|[;]\s*)(\d+)\s+([^;,]*)/g;
      while ((m = rn.exec(pc))) { var at = m.index + m[1].length; if (!isUsed(at)) claim({ kind: 'prose', text: (m[2] + ' ' + m[3]).trim(), why: 'a count with no countable field behind it' }); }
    }
    return { claims: claims, errors: errors, tables: tables };
  }

  function parseProvenanceOverall(lines) {
    var claims = [], errors = [], tables = [];
    var current = null;
    lines.forEach(function (L) {
      var h = /^##\s+\d+\.\s+([a-z0-9_]+)\b/.exec(L.text);
      if (h) { current = h[1]; tables.push(current); return; }
      var o = /^\*\*Overall confidence:\*\*\s*(.*)$/.exec(L.text);
      if (!o) return;
      var cite = 'docs/data/PROVENANCE.md:' + L.n;
      if (!current) { errors.push(cite + ': an Overall confidence line before any table heading'); return; }
      var body = o[1], m, n0 = claims.length;
      var base = { doc: 'docs/data/PROVENANCE.md', line: L.n, cite: cite, table: current };
      function claim(x) { var c = {}; Object.keys(base).forEach(function (k) { c[k] = base[k]; }); Object.keys(x).forEach(function (k) { c[k] = x[k]; }); claims.push(c); }
      var rc = new RegExp('\\b(' + LABEL_RE + ')\\b((?:\\s+[a-z]+){0,3})\\s*\\((all\\s+)?(\\d+)\\b([^)]*)\\)', 'g');
      while ((m = rc.exec(body))) {
        var plus = (m[5].match(/\+\s*`[^`]+`/g) || []).length;
        claim({ kind: m[3] ? 'all' : 'count', n: +m[4] + plus, labels: [m[1]], label: m[1], text: m[0] });
      }
      var rz = new RegExp('\\b(' + LABEL_RE + ')\\s+0\\b|\\bNo row (?:is )?(' + LABEL_RE + ')\\b', 'g');
      while ((m = rz.exec(body))) claim({ kind: 'count', n: 0, labels: [m[1] || m[2]], text: m[0] });
      var rk = new RegExp('\\b(' + LABEL_RE + ')\\s+for\\s+((?:`[^`]+`(?:,\\s*|\\s+and\\s+)?)+)', 'g');
      while ((m = rk.exec(body))) claim({ kind: 'keys', label: m[1], keys: (m[2].match(/`[^`]+`/g) || []).map(function (k) { return k.slice(1, -1); }), text: m[0].trim() });
      if (claims.length === n0) claim({ kind: 'prose', text: clip(body, 120), why: 'no countable statement found' });
    });
    return { claims: claims, errors: errors, tables: tables };
  }

  // Evaluate one claim against the counted rows: {status: match|mismatch|not-reconciled, counted, stated}.
  function evaluate(claim, v) {
    if (!v) return { status: 'not-reconciled', stated: claim.text, counted: 'no table named `' + claim.table + '` in data/tables' };
    var rows = rowsOf(v), n;
    function count(pred) { var k = 0; for (var j = 0; j < rows.length; j++) if (pred(rows[j])) k++; return k; }
    function res(stated, counted, ok, note) { var r = { status: ok ? 'match' : 'mismatch', stated: stated, counted: counted }; if (note) r.note = note; return r; }
    switch (claim.kind) {
      case 'rows': return res(claim.n, rows.length, claim.n === rows.length);
      case 'current': {
        if (!rows.some(function (r) { return rowX(r, 'current_upstream_main') !== undefined; })) return { status: 'not-reconciled', stated: claim.n, counted: 'rows carry no current_upstream_main' };
        n = count(function (r) { return rowX(r, 'current_upstream_main') > 0; });
        var stale = count(function (r) { return rowX(r, 'current') > 0; });
        return res(claim.n, n, n === claim.n, 'counted with current_upstream_main > 0 (the table\'s notes, item 7, say to use it); the stale `current` field gives ' + stale);
      }
      case 'supplement': {
        n = v.supplement && v.supplement.shape === 'array' ? v.supplement.key.length : null;
        return n == null ? { status: 'not-reconciled', stated: claim.n, counted: 'no supplement array' } : res(claim.n, n, n === claim.n);
      }
      case 'fits': return v.top.fits_count == null ? { status: 'not-reconciled', stated: claim.n, counted: 'no `fits` block' } : res(claim.n, v.top.fits_count, v.top.fits_count === claim.n);
      case 'count': {
        n = count(function (r) { return claim.labels.indexOf(r.confidence) >= 0; });
        return res(claim.n, n, n === claim.n, claim.labels.join('/'));
      }
      case 'all': {
        var bad = rows.filter(function (r) { return r.confidence !== claim.label; });
        var stated = claim.n != null ? claim.n : rows.length;
        var ok = !bad.length && (claim.n == null || claim.n === rows.length);
        return res('all ' + stated + ' `' + claim.label + '`', bad.length ? (rows.length - bad.length) + ' `' + claim.label + '`, ' + bad.length + ' not (' + bad.slice(0, 4).map(function (r) { return r.key + ' ' + r.confidence; }).join(', ') + (bad.length > 4 ? ', …' : '') + ')' : 'all ' + rows.length + ' `' + claim.label + '`', ok);
      }
      case 'keys': {
        var wrong = claim.keys.filter(function (k) { return !rows.some(function (r) { return r.key === k && r.confidence === claim.label; }); });
        return res(claim.keys.join(', ') + ' `' + claim.label + '`', wrong.length ? 'not `' + claim.label + '`: ' + wrong.join(', ') : 'all ' + claim.keys.length + ' `' + claim.label + '`', !wrong.length);
      }
      case 'disputed': n = count(function (r) { return r.d != null; }); return res(claim.n, n, n === claim.n, 'rows with a non-empty disputed field');
      case 'withheld': n = Array.isArray(v.top.disputed) ? v.top.disputed.length : null;
        return n == null ? { status: 'not-reconciled', stated: claim.n, counted: 'no table-level disputed list' } : res(claim.n, n, n === claim.n, 'table-level disputed entries');
      case 'subject': {
        var vendors = [];
        rows.forEach(function (r) { var x = rowX(r, 'vendor'); if (typeof x === 'string' && vendors.indexOf(x) < 0) vendors.push(x); });
        var isVendor = claim.names.length > 0 && vendors.length > 0 && claim.names.every(function (nm) { return vendors.some(function (x) { return x.indexOf(nm) === 0; }); });
        if (!isVendor) return { status: 'not-reconciled', stated: claim.text, counted: 'scoped to a field or a kind of row; this parser counts whole rows only (by label, vendor or key)' };
        var mine = rows.filter(function (r) { var x = rowX(r, 'vendor'); return claim.names.some(function (nm) { return typeof x === 'string' && x.indexOf(nm) === 0; }); });
        var off = mine.filter(function (r) { return r.confidence !== claim.label; });
        var offDisputed = off.filter(function (r) { return r.d != null; }).length;
        return res(mine.length + ' ' + claim.names.join('/') + ' rows `' + claim.label + '`',
          off.length ? (mine.length - off.length) + ' `' + claim.label + '`, ' + off.length + ' not (' + LABELS.filter(function (L) { return L !== claim.label; }).map(function (L) { var k = off.filter(function (r) { return r.confidence === L; }).length; return k ? k + ' ' + L : ''; }).filter(Boolean).join(', ') + '; ' + offDisputed + ' of them disputed)' : 'all ' + mine.length + ' `' + claim.label + '`', !off.length);
      }
      default: return { status: 'not-reconciled', stated: claim.text, counted: claim.why || 'prose' };
    }
  }

  function reconcile(policy, views) {
    var byName = {};
    views.forEach(function (v) { byName[v.table] = v; });
    var rec = [], findings = [];
    var readme = parseReadmePolicy(policy && policy.readme ? policy.readme.lines : []);
    var prov = parseProvenanceOverall(policy && policy.provenance ? policy.provenance.lines : []);
    readme.errors.concat(prov.errors).forEach(function (e) { findings.push(finding(null, null, 'policy-prose', 'could not reconcile: ' + e)); });
    readme.claims.concat(prov.claims).forEach(function (c) {
      var e = evaluate(c, byName[c.table]);
      var row = { table: c.table, cite: c.cite, kind: c.kind, text: c.text, status: e.status, stated: e.stated, counted: e.counted };
      if (e.note) row.note = e.note;
      rec.push(row);
      if (e.status === 'mismatch') findings.push(finding(c.table, null, 'policy-mismatch', c.cite + ' says “' + clip(c.text, 90) + '”; the rows have ' + e.counted + (e.note && c.kind !== 'count' ? ' (' + e.note + ')' : ''), { cite: c.cite }));
      else if (e.status === 'not-reconciled') findings.push(finding(c.table, null, 'policy-prose', c.cite + ': “' + clip(c.text, 90) + '” — ' + e.counted, { cite: c.cite }));
    });
    var names = views.map(function (v) { return v.table; });
    if (readme.tables.length) {
      names.forEach(function (t) { if (readme.tables.indexOf(t) < 0) findings.push(finding(t, null, 'policy-missing-table', 'data/tables/' + t + '.json has no row in the data/README.md policy table')); });
      readme.tables.forEach(function (t) { if (names.indexOf(t) < 0) findings.push(finding(t, null, 'policy-missing-table', 'data/README.md lists `' + t + '` but there is no data/tables/' + t + '.json')); });
    }
    return { reconciliation: rec, findings: findings, parsed: { readme_tables: readme.tables.length, provenance_tables: prov.tables.length, errors: readme.errors.concat(prov.errors) } };
  }

  // ------------------------------------------------------------------ the whole run
  function sortFindings(list) {
    var sev = { defect: 0, review: 1, info: 2 };
    return list.map(function (f, i) { return [f, i]; }).sort(function (a, b) {
      var x = a[0], y = b[0];
      return (sev[x.severity] - sev[y.severity]) || cmp(x.table || '', y.table || '') || (RULE_ORDER.indexOf(x.rule) - RULE_ORDER.indexOf(y.rule)) || (a[1] - b[1]);
    }).map(function (p) { return p[0]; });
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function run(views, policy) {
    views = views.slice().sort(function (a, b) { return cmp(a.table, b.table); });
    var findings = [];
    views.forEach(function (v) { findings = findings.concat(lintTable(v)); });
    var r = reconcile(policy, views);
    findings = sortFindings(findings.concat(r.findings));
    var bySeverity = { defect: 0, review: 0, info: 0 }, byRule = {};
    findings.forEach(function (f) { bySeverity[f.severity]++; byRule[f.rule] = (byRule[f.rule] || 0) + 1; });
    var commits = [];
    views.forEach(function (v) { if (v.source.commit && commits.indexOf(v.source.commit) < 0) commits.push(v.source.commit); });
    if (policy) ['readme', 'provenance'].forEach(function (k) { var c = policy[k] && policy[k].commit; if (c && commits.indexOf(c) < 0) commits.push(c); });
    var inputs = views.map(function (v) { return { path: v.source.path, sha256: v.source.sha256 }; });
    if (policy) ['readme', 'provenance'].forEach(function (k) { if (policy[k]) inputs.push({ path: policy[k].path, sha256: policy[k].sha256 }); });
    return {
      meta: { tool: 'confidence-census', ruleset: 2, commits: commits, length_tolerance: LENGTH_TOLERANCE, inputs: inputs },
      summary: { tables: views.length, findings: findings.length, by_severity: bySeverity, by_rule: byRule, exit: bySeverity.defect ? 1 : 0 },
      census: views.map(censusTable),
      reconciliation: r.reconciliation,
      findings: findings
    };
  }

  // Deterministic text: top-level blocks pretty, one census row / claim / finding per line.
  function serialize(res) {
    function lines(arr) { return arr.length ? '[\n' + arr.map(function (x) { return '  ' + JSON.stringify(x); }).join(',\n') + '\n ]' : '[]'; }
    return '{\n "meta": ' + JSON.stringify(res.meta) + ',\n "summary": ' + JSON.stringify(res.summary) +
      ',\n "census": ' + lines(res.census) + ',\n "reconciliation": ' + lines(res.reconciliation) + ',\n "findings": ' + lines(res.findings) + '\n}\n';
  }

  function toMarkdown(res) {
    var o = [];
    var s = res.summary;
    o.push('# Confidence Census — PartForge data/tables at ' + (res.meta.commits.map(function (c) { return String(c).slice(0, 7); }).join(', ') || 'unknown commit'));
    o.push('');
    o.push(s.tables + ' tables; ' + s.findings + ' findings: ' + s.by_severity.defect + ' defect, ' + s.by_severity.review + ' review, ' + s.by_severity.info + ' info. Exit ' + s.exit + '.');
    o.push('');
    o.push('| table | rows | certain | likely | recall | disputed rows | dated | supplement (c/l/r of n) |');
    o.push('|---|---:|---:|---:|---:|---:|---|---|');
    res.census.forEach(function (c) {
      var sup = c.supplement && c.supplement.rows != null ? c.supplement.certain + '/' + c.supplement.likely + '/' + c.supplement.recall + ' of ' + c.supplement.rows : c.supplement ? 'object' : '';
      o.push('| ' + c.table + ' | ' + c.rows + ' | ' + c.certain + ' | ' + c.likely + ' | ' + c.recall + ' | ' + c.disputed_rows + (c.top_disputed ? ' (+' + c.top_disputed + ' table-level)' : '') + ' | ' + (c.dates.length ? c.dates[c.dates.length - 1] : 'none') + ' | ' + sup + ' |');
    });
    o.push('');
    var rec = res.reconciliation;
    var cnt = { match: 0, mismatch: 0, 'not-reconciled': 0 };
    rec.forEach(function (r) { cnt[r.status]++; });
    o.push('Hand-written census statements: ' + rec.length + ' claims parsed — ' + cnt.match + ' match, ' + cnt.mismatch + ' contradicted, ' + cnt['not-reconciled'] + ' not reconcilable (prose).');
    o.push('');
    o.push('By rule: ' + Object.keys(s.by_rule).sort(function (a, b) { return RULE_ORDER.indexOf(a) - RULE_ORDER.indexOf(b); }).map(function (k) { return k + ' ' + s.by_rule[k]; }).join(', ') + '.');
    o.push('');
    var defects = res.findings.filter(function (f) { return f.severity === 'defect'; });
    o.push('## defect (' + defects.length + ')');
    o.push('');
    defects.forEach(function (f) { o.push('- **' + (f.table || '—') + '**' + (f.key != null ? ' `' + f.key + '`' : '') + ' [' + f.rule + '] ' + f.detail); });
    o.push('');
    // Review findings grouped by table and rule: per-row rules (label-vs-text) would otherwise run to ~100 lines.
    var review = res.findings.filter(function (f) { return f.severity === 'review'; });
    o.push('## review (' + review.length + ', grouped by table and rule)');
    o.push('');
    var groups = [], gi = {};
    review.forEach(function (f) { var k = (f.table || '') + '\u0001' + f.rule; if (!own(gi, k)) { gi[k] = groups.length; groups.push([]); } groups[gi[k]].push(f); });
    groups.forEach(function (g) {
      var f = g[0];
      if (g.length === 1) o.push('- **' + (f.table || '—') + '**' + (f.key != null ? ' `' + f.key + '`' : '') + ' [' + f.rule + '] ' + f.detail);
      else {
        var keyed = g.filter(function (x) { return x.key != null; });
        o.push('- **' + (f.table || '—') + '** [' + f.rule + '] ' + g.length + ' findings' + (keyed.length ? ' (' + keyed.slice(0, 3).map(function (x) { return '`' + x.key + '`'; }).join(', ') + (keyed.length > 3 ? ', …' : '') + ')' : '') + '; first: ' + clip(f.detail, 150));
      }
    });
    o.push('');
    o.push('Info findings (' + s.by_severity.info + ': disputed-entry counts, rounding-scale inch/mm notes, supplement census, prose the parser does not count) are in findings.json; the page lists every disputed entry.');
    return o.join('\n') + '\n';
  }

  return {
    LABELS: LABELS, RANK: RANK, SEVERITIES: SEVERITIES, RULES: RULES, RULE_ORDER: RULE_ORDER, LENGTH_TOLERANCE: LENGTH_TOLERANCE,
    findDates: findDates, declaredDecimals: declaredDecimals, leadLabel: leadLabel, median: median, unitPairs: unitPairs,
    viewOf: viewOf, rowsOf: rowsOf, rowSource: rowSource, rowFields: rowFields, rowDisputed: rowDisputed, disputedSummary: disputedSummary,
    censusTable: censusTable, lintTable: lintTable, ledger: ledger,
    parseReadmePolicy: parseReadmePolicy, parseProvenanceOverall: parseProvenanceOverall, evaluate: evaluate, reconcile: reconcile,
    run: run, serialize: serialize, toMarkdown: toMarkdown
  };
});
