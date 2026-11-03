// app.js — renders the Confidence Census page. Everything shown is computed here, in the browser,
// by census.js from the committed snapshots (snapshots/views/*.js, snapshots/*-policy/overall.js);
// nothing is fetched. If the snapshots did not load, the page says so and shows no numbers.
(function () {
  'use strict';
  var C = window.Census;
  var VIEWS = window.CENSUS_VIEWS || {};
  var POLICY = window.CENSUS_POLICY || {};
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'cls') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  // Render `text` with `backticked` spans as <code>.
  function rich(text) {
    var span = el('span');
    String(text).split(/(`[^`]*`)/).forEach(function (part) {
      if (/^`[^`]*`$/.test(part)) span.appendChild(el('code', { text: part.slice(1, -1) }));
      else if (part) span.appendChild(document.createTextNode(part));
    });
    return span;
  }

  var views = Object.keys(VIEWS).sort().map(function (k) { return VIEWS[k]; });
  // The <script> tags under snapshots/views/ are the manifest: a partial load is refused like an empty
  // one, since a census of fewer tables would undercount and call the missing ones absent from PartForge.
  var expected = Array.prototype.map.call(document.querySelectorAll('script[src^="snapshots/views/"]'), function (s) {
    var m = /([^\/]+)\.js$/.exec(s.getAttribute('src'));
    return m ? m[1] : null;
  }).filter(Boolean);
  var missing = expected.filter(function (t) { return !VIEWS[t]; });
  if (!C || !views.length || missing.length || !POLICY.readme || !POLICY.provenance) {
    $('stamp').textContent = '';
    $('summary').appendChild(el('div', { cls: 'refuse', role: 'alert' }, [
      el('strong', { text: 'No census: the snapshots did not load. ' }),
      'This page computes everything from census.js and the files under snapshots/ beside it; ' + (!C ? 'census.js is missing. ' : '') +
      (!views.length ? 'no table views were found. ' : missing.length ? missing.length + ' of ' + expected.length + ' table views did not load (' + missing.join(', ') +
        '), and a census of the rest would report wrong totals and call those tables absent from PartForge. ' : '') +
      (!POLICY.readme || !POLICY.provenance ? 'a policy extract is missing. ' : '') +
      'Rebuild them with node build-data.mjs from a PartForge checkout.'
    ]));
    return;
  }

  var res = C.run(views, POLICY);
  window.CENSUS_RESULT = res;   // for ui-check.mjs

  // ---------------------------------------------------------------- header
  var commits = res.meta.commits.map(function (c) { return String(c).slice(0, 7); });
  $('stamp').textContent = 'Computed in this page from snapshots of PartForge at ' + (commits.join(', ') || 'an unknown commit') +
    ' (' + views.length + ' tables, ' + res.census.reduce(function (a, c) { return a + c.rows; }, 0).toLocaleString('en-US') + ' rows). Not a live scan: a newer PartForge needs node build-data.mjs.';
  var S = res.summary.by_severity;
  var sum = $('summary');
  [['defect', S.defect], ['review', S.review], ['info', S.info]].forEach(function (p) {
    sum.appendChild(el('div', { cls: 'chip sev-' + p[0], 'data-sev': p[0] }, [el('b', { text: String(p[1]) }), ' ' + p[0]]));
  });
  var rc = { match: 0, mismatch: 0, 'not-reconciled': 0 };
  res.reconciliation.forEach(function (r) { rc[r.status]++; });
  sum.appendChild(el('p', { cls: 'sumline', id: 'sumline' }, [
    'The CLI would exit ' + res.summary.exit + '. Of ' + res.reconciliation.length + ' hand-written census statements, ' + rc.match + ' match the rows, ',
    el('b', { text: rc.mismatch + ' are contradicted' }), ', ' + rc['not-reconciled'] + ' are prose the parser does not count.'
  ]));

  // ---------------------------------------------------------------- census table
  (function () {
    var t = $('census');
    t.appendChild(el('thead', null, [el('tr', null, ['table', 'rows', 'certain · likely · recall', 'disputed', 'dated', 'supplement'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]));
    var tb = el('tbody');
    res.census.forEach(function (c) {
      var bar = el('div', { cls: 'bar', role: 'img', 'aria-label': c.certain + ' certain, ' + c.likely + ' likely, ' + c.recall + ' recall' });
      ['certain', 'likely', 'recall'].forEach(function (L) { if (c[L]) { var seg = el('span', { cls: 'c-' + L, title: c[L] + ' ' + L }); seg.style.width = (100 * c[L] / c.rows) + '%'; bar.appendChild(seg); } });
      var nums = el('div', { cls: 'nums', text: c.certain + ' · ' + c.likely + ' · ' + c.recall + (c.other ? ' · ' + c.other + ' other' : '') });
      var sup = c.supplement && c.supplement.rows != null ? c.supplement.certain + ' · ' + c.supplement.likely + ' · ' + c.supplement.recall + ' of ' + c.supplement.rows : c.supplement ? 'object' : '—';
      tb.appendChild(el('tr', { 'data-table': c.table }, [
        el('th', { scope: 'row', text: c.table }),
        el('td', { cls: 'num', text: String(c.rows) }),
        el('td', { cls: 'barcell' }, [bar, nums]),
        el('td', { cls: 'num', text: c.disputed_rows + (c.top_disputed ? ' +' + c.top_disputed : '') }),
        el('td', { cls: c.dates.length ? '' : 'none', text: c.dates.length ? c.dates[c.dates.length - 1] : 'none' }),
        el('td', { text: sup })
      ]));
    });
    t.appendChild(tb);
  })();

  // ---------------------------------------------------------------- reconciliation
  var recMode = 'problems';
  function renderClaims() {
    var ol = $('claims');
    ol.textContent = '';
    res.reconciliation.forEach(function (r) {
      if (recMode === 'problems' && r.status === 'match') return;
      var badge = r.status === 'match' ? 'matches' : r.status === 'mismatch' ? 'contradicted' : 'prose';
      ol.appendChild(el('li', { cls: 'claim st-' + r.status, 'data-status': r.status, 'data-cite': r.cite }, [
        el('div', { cls: 'chead' }, [el('span', { cls: 'badge', text: badge }), el('span', { cls: 'tname', text: r.table }), el('span', { cls: 'cite', text: r.cite })]),
        el('p', { cls: 'said' }, ['Says: ', rich(r.text)]),
        el('p', { cls: 'found' }, [r.status === 'not-reconciled' ? 'Not counted: ' : 'Rows: ', rich(typeof r.counted === 'number' ? r.counted + (r.note && r.kind === 'count' ? ' ' + r.note : '') : r.counted)]),
        r.note && r.kind !== 'count' ? el('p', { cls: 'note', text: r.note }) : null
      ]));
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-rec]'), function (b) {
    b.addEventListener('click', function () {
      recMode = b.getAttribute('data-rec');
      Array.prototype.forEach.call(document.querySelectorAll('[data-rec]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      renderClaims();
    });
  });
  renderClaims();

  // ---------------------------------------------------------------- findings
  var sevOn = { defect: true, review: true, info: false };
  ['defect', 'review', 'info'].forEach(function (s) { $('n-' + s).textContent = String(S[s]); });
  var tables = res.census.map(function (c) { return c.table; });
  tables.forEach(function (t) { $('f-table').appendChild(el('option', { value: t, text: t })); });
  C.RULE_ORDER.filter(function (r) { return res.summary.by_rule[r]; }).forEach(function (r) {
    $('f-rule').appendChild(el('option', { value: r, text: r + ' (' + res.summary.by_rule[r] + ')' }));
  });
  function renderFindings() {
    var ft = $('f-table').value, fr = $('f-rule').value, q = $('f-text').value.trim().toLowerCase();
    var ul = $('findings');
    ul.textContent = '';
    var shown = res.findings.filter(function (f) {
      if (!sevOn[f.severity]) return false;
      if (ft && f.table !== ft) return false;
      if (fr && f.rule !== fr) return false;
      if (q && [f.table, f.key, f.rule, f.detail].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    shown.slice(0, 400).forEach(function (f) {
      var rule = C.RULES[f.rule];
      ul.appendChild(el('li', { cls: 'finding sev-' + f.severity, 'data-rule': f.rule, 'data-table': f.table || '', 'data-key': f.key == null ? '' : String(f.key) }, [
        el('div', { cls: 'fhead' }, [
          el('span', { cls: 'badge', text: f.severity }),
          el('span', { cls: 'tname', text: f.table || '—' }),
          f.key != null ? el('code', { cls: 'key', text: String(f.key) }) : null,
          el('span', { cls: 'rule', text: f.rule })
        ]),
        el('p', { cls: 'detail' }, [rich(f.detail)]),
        el('p', { cls: 'basis' }, [rich(rule[1] + ' — ' + rule[2])])
      ]));
    });
    $('f-count').textContent = shown.length ? 'Showing ' + Math.min(shown.length, 400) + ' of ' + shown.length + ' matching findings (' + res.findings.length + ' in all).' :
      'No finding matches these filters (' + res.findings.length + ' in all).';
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-sev]'), function (b) {
    if (b.tagName !== 'BUTTON') return;
    b.addEventListener('click', function () {
      var s = b.getAttribute('data-sev');
      sevOn[s] = !sevOn[s];
      b.setAttribute('aria-pressed', String(sevOn[s]));
      renderFindings();
    });
  });
  ['f-table', 'f-rule'].forEach(function (id) { $(id).addEventListener('change', renderFindings); });
  $('f-text').addEventListener('input', renderFindings);
  renderFindings();

  // ---------------------------------------------------------------- ledger
  var ledgers = {};
  views.forEach(function (v) { ledgers[v.table] = C.ledger(v); });
  var withDisputes = tables.filter(function (t) { return ledgers[t].rows.length || ledgers[t].table_level.length; });
  withDisputes.forEach(function (t) {
    var L = ledgers[t];
    $('l-table').appendChild(el('option', { value: t, text: t + ' (' + (L.rows.length + L.table_level.length) + ')' }));
  });
  function entryLines(e) {
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      return Object.keys(e).map(function (k) { var v = e[k]; return el('div', { cls: 'kv' }, [el('span', { cls: 'k', text: k }), ' ', el('span', { cls: 'v', text: typeof v === 'string' ? v : JSON.stringify(v) })]); });
    }
    return [el('div', { cls: 'kv', text: typeof e === 'string' ? e : JSON.stringify(e) })];
  }
  function renderLedger() {
    var t = $('l-table').value, L = ledgers[t], ul = $('ledger');
    ul.textContent = '';
    if (!L) { $('l-count').textContent = 'No table selected.'; return; }
    L.rows.forEach(function (r) {
      var det = el('details', { cls: 'lrow' }, [
        el('summary', null, [el('code', { cls: 'key', text: String(r.key) }), ' ', el('span', { cls: 'lab l-' + r.confidence, text: r.confidence }), ' ', el('span', { cls: 'fields', text: r.fields.join(', ') || '(no field named)' })])
      ]);
      r.entries.forEach(function (e) { det.appendChild(el('div', { cls: 'entry' }, entryLines(e))); });
      ul.appendChild(el('li', null, [det]));
    });
    L.table_level.forEach(function (e, i) {
      var det = el('details', { cls: 'lrow' }, [el('summary', null, [el('code', { cls: 'key', text: 'table-level #' + (i + 1) }), ' ', el('span', { cls: 'fields', text: C.disputedSummary(e).slice(0, 80) })])]);
      det.appendChild(el('div', { cls: 'entry' }, entryLines(e)));
      ul.appendChild(el('li', null, [det]));
    });
    $('l-count').textContent = L.rows.length + ' row' + (L.rows.length === 1 ? '' : 's') + ' with ' + L.entries + ' entr' + (L.entries === 1 ? 'y' : 'ies') + (L.table_level.length ? ', plus ' + L.table_level.length + ' table-level' : '') +
      '.' + (L.fields.length ? ' Most contested: ' + L.fields.slice(0, 3).map(function (x) { return x[0] + ' (' + x[1] + ')'; }).join(', ') + '.' : '');
  }
  $('l-table').addEventListener('change', renderLedger);
  renderLedger();

  // ---------------------------------------------------------------- provenance
  $('prov').textContent = 'Inputs: ' + res.meta.inputs.map(function (i) { return i.path + ' (sha256 ' + String(i.sha256).slice(0, 10) + '…)'; }).join('; ') + '.';
})();
