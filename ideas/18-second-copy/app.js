/* Second Copy, the page. Runs second-copy.js on the same UMD snapshots the CLI reads with
   --snapshots, so the page and `node second-copy.mjs --snapshots` cannot disagree. Everything is
   built with textContent; no snapshot or pasted text is ever parsed as HTML. */
(function () {
  'use strict';
  var SC = window.SecondCopy, D = window.SecondCopyData || {};
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var need = ['tables', 'texts', 'history', 'templates'];
  var missing = need.filter(function (k) { return !D[k]; });
  if (!SC || missing.length || !D.texts.index || Object.keys(D.tables).length < 8) {
    $('meta').textContent = 'Refused: the snapshots did not load (' + (missing.join(', ') || 'tables or index') + '). Open index.html from its own folder so snapshots/ sits beside it.';
    return;
  }
  var T = D.tables, IDX = D.texts.index;
  var doc = { commit: IDX.commit, text: IDX.doctrine.text, lineBase: IDX.doctrine.lineBase }, gsy = { text: IDX.gradeSy.text, lineBase: IDX.gradeSy.lineBase };
  var templates = Object.keys(D.templates).sort().map(function (k) { var t = D.templates[k]; return { name: k, file: t.file, text: t.text }; });
  // a shipped template stored by reference is rebuilt from its tests/templates twin (the tests check the hashes)
  var shipped = SC.rebuildShipped(IDX.shipped, templates);
  var history = ['ad4d587', '3bffbe0'].map(function (c) { var h = D.history[c]; return { commit: h.commit, text: h.text, lineBase: h.lineBase }; });
  var result = SC.run(T, { commit: doc.commit, doctrine: doc, gradeSy: gsy, templates: templates, shipped: shipped, history: history });
  var headSources = result.sources.filter(function (s) { return !s.history; });

  $('commit').textContent = doc.commit;
  $('meta').textContent = 'PartForge at ' + doc.commit + ': the flightSystemPrompt() doctrine (index.html:' + doc.lineBase + '), GRADE_SY (index.html:' + gsy.lineBase + '), the seven templates in tests/templates/ and the copies index.html ships, against ' + Object.keys(T).length + ' reference tables.';

  // ---- totals
  var tot = SC.count([].concat.apply([], headSources.map(function (s) { return s.findings; })));
  SC.VERDICTS.forEach(function (v) {
    if (!tot[v]) return;
    var c = el('span', 'chip v-' + v, tot[v] + ' ' + v);
    c.setAttribute('role', 'listitem');
    c.dataset.verdict = v; c.dataset.count = tot[v];
    $('totals').appendChild(c);
  });

  // ---- one finding
  function card(f, showSource) {
    var c = el('article', 'card b-' + f.verdict);
    c.dataset.verdict = f.verdict;
    var h = el('div', 'head');
    h.appendChild(el('span', 'badge v-' + f.verdict, f.verdict));
    h.appendChild(el('span', 'key', f.key));
    h.appendChild(el('span', 'what', f.what));
    h.appendChild(el('span', 'where', f.file + ':' + f.line));
    c.appendChild(h);
    var dl = el('dl', 'vs');
    function row(k, v) { dl.appendChild(el('dt', null, k)); var dd = el('dd', null, v); dl.appendChild(dd); return dd; }
    if (f.verdict === 'COPY-DRIFT') {
      row('this file', f.literal).classList.add('mono');
      row('index.html ' + (f.table && f.table.column || ''), f.table ? f.table.display : '').classList.add('mono');
    } else {
      row('says', f.literal + (f.unit && !/[a-zµ]$/.test(f.literal) ? ' ' + f.unit : '')).dataset.role = 'literal';
      var t = f.table;
      var tableText = t ? t.display + (t.confidence && t.confidence !== 'code' && t.confidence !== 'count' ? '  [' + t.confidence + ']' : '') : '—';
      row('table', tableText).dataset.role = 'table';
      if (t && t.file) row('from', t.file + (t.row ? ' · ' + t.row : '') + (t.column ? ' · ' + t.column : ''));
    }
    c.appendChild(dl);
    if (f.span) c.appendChild(el('code', 'span', f.span));
    if (f.note) c.appendChild(el('p', 'note', f.note));
    if (f.looksLike) c.appendChild(el('p', 'note', 'Equals, at its printed precision: ' + f.looksLike.join('; ')));
    return c;
  }

  // ---- what fails today
  var failing = [].concat.apply([], headSources.map(function (s) { return s.findings.filter(function (f) { return SC.FAILING[f.verdict]; }); }));
  failing.forEach(function (f) { $('failing').appendChild(card(f)); });
  if (!failing.length) $('failing').appendChild(el('p', 'empty', 'Nothing disagrees.'));

  // ---- browse by source
  var groups = [
    { id: 'doctrine', label: 'Doctrine', sources: headSources.filter(function (s) { return s.id === 'doctrine'; }), note: 'flightSystemPrompt() in index.html, the same slice PartForge\'s tests/run.mjs reads.' },
    { id: 'grades', label: 'GRADE_SY', sources: headSources.filter(function (s) { return s.id === 'GRADE_SY'; }), note: 'The bolt-yield literal at index.html:' + (gsy.lineBase + gsy.text.split('\n').length - 1) + ' against fasteners_metric.json grades, and the comment above it against the literal.' },
    { id: 'templates', label: 'Templates', sources: headSources.filter(function (s) { return /^template:/.test(s.id); }), note: 'NOTE and MAKE lines, parameter comments and FLIGHT entries of the seven flight templates in tests/templates/.' },
    { id: 'copies', label: 'Copies', sources: headSources.filter(function (s) { return s.id === 'copies'; }), note: 'Each tests/templates/*.scad line by line against the TEMPLATES_FLIGHT copy index.html ships. PartForge\'s own sync test compares only the "loads" line.' },
    { id: 'history', label: 'History', sources: result.sources.filter(function (s) { return s.history; }), note: 'The doctrine\'s fastener, fit and O-ring bullets at ad4d587 (the day fasteners_un.json shipped beside them; that table is byte-identical to 0974a62) and at 3bffbe0 (before the tables), replayed against today\'s tables.' }
  ];
  var state = { tab: 'doctrine', filter: 'not' };
  try { var saved = localStorage.getItem('second-copy:view'); if (saved) { var p = JSON.parse(saved); if (p && p.tab) state = p; } } catch (e) { /* storage blocked: fine */ }
  function save() { try { localStorage.setItem('second-copy:view', JSON.stringify(state)); } catch (e) { /* ignore */ } }

  var tabs = $('tabs');
  groups.forEach(function (g) {
    var b = el('button', null, g.label + ' ');
    var n = [].concat.apply([], g.sources.map(function (s) { return s.findings; })).length;
    b.appendChild(el('span', 'where', '(' + n + ')'));
    b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'tab-' + g.id; b.dataset.tab = g.id;
    b.addEventListener('click', function () { state.tab = g.id; save(); render(); });
    tabs.appendChild(b);
  });
  var filters = [{ id: 'not', label: 'Not agreeing' }, { id: 'all', label: 'Everything' }, { id: 'agree', label: 'Agreeing only' }];
  filters.forEach(function (fl) {
    var b = el('button', null, fl.label);
    b.type = 'button'; b.dataset.filter = fl.id;
    b.addEventListener('click', function () { state.filter = fl.id; save(); render(); });
    $('filters').appendChild(b);
  });

  function render() {
    var g = groups.filter(function (x) { return x.id === state.tab; })[0] || groups[0];
    Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === g.id)); });
    Array.prototype.forEach.call($('filters').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)); });
    $('srcnote').textContent = g.note;
    var list = $('list');
    list.textContent = '';
    g.sources.forEach(function (s) {
      var shown = s.findings.filter(function (f) { return state.filter === 'all' || (state.filter === 'agree' ? f.verdict === 'AGREES' : f.verdict !== 'AGREES'); });
      var hdr = el('h3', 'srcnote');
      var parts = SC.VERDICTS.filter(function (v) { return s.counts[v]; }).map(function (v) { return s.counts[v] + ' ' + v; });
      hdr.textContent = s.label + ' — ' + (parts.join(', ') || 'nothing paired') + (s.numbers ? '; ' + s.unpaired.length + ' of ' + s.numbers + ' numbers unpaired (not judged)' : '');
      list.appendChild(hdr);
      if (!shown.length) list.appendChild(el('p', 'empty', state.filter === 'not' ? 'Every pairing here agrees.' : 'Nothing to show with this filter.'));
      shown.forEach(function (f) { list.appendChild(card(f)); });
    });
  }
  render();

  // ---- lint your own
  var bullets = SC.tableBullets(doc);
  $('sample').addEventListener('click', function () {
    $('kind').value = 'doctrine';
    $('paste').value = bullets.text.split('\n')[0].replace('M6 6.6,', 'M6 7.0,');
    lint();
  });
  $('sample2').addEventListener('click', function () {
    $('kind').value = 'doctrine';
    $('paste').value = D.history.ad4d587.text.split('\n')[0];
    lint();
  });
  $('lint').addEventListener('click', lint);
  function lint() {
    var out = $('tryout'), text = $('paste').value, kind = $('kind').value;
    out.textContent = '';
    if (!text.trim()) {
      var r = el('div', 'refusal');
      r.dataset.refusal = 'empty';
      r.textContent = 'Nothing to lint. Paste a doctrine passage, a .scad flight template or a GRADE_SY line, or load one of the two samples.';
      out.appendChild(r);
      return;
    }
    var inputs = { commit: doc.commit };
    if (kind === 'doctrine') inputs.doctrine = { text: text, lineBase: 1 };
    else if (kind === 'template') inputs.templates = [{ name: 'pasted', file: 'pasted', text: text }];
    else inputs.gradeSy = { text: text, lineBase: 1 };
    var res = SC.run(T, inputs);
    var s = res.sources[0];
    if (!s || !s.findings.length) {
      var r2 = el('div', 'refusal');
      r2.dataset.refusal = 'unpaired';
      r2.textContent = 'Nothing paired: none of the sentence shapes this tool knows appear in the text' + (s && s.numbers ? ' (' + s.numbers + ' numbers, all left unpaired and not judged)' : '') + '. Shapes it knows: "M6 6.6" after a clearance or tap-drill heading, "H7 = +21/0" after "at Ø18–30" in an ISO 286 μm sentence, Parker Chart 4-3 / Table 4-2 bands, "AS568-250, ID … in = … mm", GRADE_SY literals, and the template forms listed in second-copy.js.';
      out.appendChild(r2);
      return;
    }
    // a pasted text has no file or index.html line of its own: number its lines from 1
    s.findings.forEach(function (f) { f.file = 'pasted'; });
    var order = function (v) { return SC.VERDICTS.indexOf(v); };
    s.findings = s.findings.map(function (f, i) { return [f, i]; }).sort(function (a, b) { return order(a[0].verdict) - order(b[0].verdict) || a[1] - b[1]; }).map(function (x) { return x[0]; });
    var sum = el('p', 'srcnote', SC.VERDICTS.filter(function (v) { return s.counts[v]; }).map(function (v) { return s.counts[v] + ' ' + v; }).join(', ') + (s.numbers ? '; ' + s.unpaired.length + ' of ' + s.numbers + ' numbers unpaired' : ''));
    sum.dataset.role = 'summary';
    out.appendChild(sum);
    s.findings.forEach(function (f) { out.appendChild(card(f)); });
  }

  // ---- provenance
  $('prov').textContent = 'Tables: ' + Object.keys(SC.TABLE_FILES).map(function (k) { return SC.TABLE_FILES[k]; }).join(', ') +
    ', excerpted by second-copy.js at PartForge ' + doc.commit + ' into snapshots/table-*.js. Texts: index.html at ' + doc.commit + ' (doctrine, GRADE_SY, dbFit, the shipped templates) in snapshots/index-' + doc.commit + '.js; the doctrine bullets at ad4d587 and 3bffbe0 from git show in snapshots/history.js; tests/templates/*.scad in snapshots/tpl-*.scad.js. A .provenance.json sidecar beside each names the repository, commit, blob and sha256. The same files feed node second-copy.mjs --snapshots.';
  $('foot').textContent = result.sources.length + ' sources, ' + [].concat.apply([], result.sources.map(function (s) { return s.findings; })).length + ' pairings';
})();
