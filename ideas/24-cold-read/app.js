/* app.js — the Cold Read page. All the reading is coldread.js; the PartForge texts and their
   recorded gate results are the wrappers under snapshots/ (listed by corpus.js). No network. */
(function () {
  'use strict';
  var CR = window.ColdRead, APP = window.PartForgeRules;
  var LIST = window.ColdReadCorpusList.build(window.ColdReadCorpus || []);
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private window: nothing kept */ } },
  };
  var LINE_PX = 18;   // matches .gutter / #code line-height in style.css
  var RING = 'tests/templates/centering-ring.scad', SLED = 'tests/templates/av-sled.scad';
  var GROUPS = {
    dryrun: 'PartForge dry runs (tests/dryrun): the gate failed these, and recorded why',
    runs: 'Recorded model runs (docs/runs): files gemini-3.6-flash wrote and the gate passed',
    templates: 'Template test fixtures (tests/templates): no failures recorded',
    'shipped-flight': 'Flight templates the app ships (index.html TEMPLATES_FLIGHT)',
    'shipped-hobby': 'Hobby templates the app ships (index.html TEMPLATES)',
  };
  // The proposal's mutations, each applied to the PartForge text it names.
  var BREAKS = [
    { id: '', label: 'nothing (the text as PartForge has it)' },
    { id: 'rename', base: RING, label: 'centering ring: rename module ring() to rng()', from: 'module ring(){', to: 'module rng(){' },
    { id: 'n0', base: RING, label: 'centering ring: a bolt circle with n = 0', from: '"n":4,"bc_d_mm":126.00,"start_deg":45', to: '"n":0,"bc_d_mm":126.00,"start_deg":45' },
    { id: 'source', base: RING, label: 'centering ring: tol_src "source" with no tol_ref', from: '"nominal_mm":6.35,"tol_mm":0.25,"tol_src":"default"', to: '"nominal_mm":6.35,"tol_mm":0.25,"tol_src":"source"' },
    { id: 'fn', base: RING, label: 'centering ring: a global $fn = 200', from: '// --- end parameters ---\n', to: '// --- end parameters ---\n$fn = 200;\n' },
    { id: 'comma', base: RING, label: 'centering ring: a trailing comma in FLIGHT', from: '"inputs_src":"default"}],', to: '"inputs_src":"default"},],' },
    { id: 'specend', base: RING, label: 'centering ring: the SPEC-END line deleted', from: '// SPEC-END\n', to: '' },
    { id: 'comment', base: RING, label: 'centering ring: a comment that mentions text()', from: '// --- end parameters ---', to: '// --- end parameters --- (no text() here)' },
    { id: 'omit', base: SLED, label: 'av sled: main() leaves out bosses()', from: 'union(){ plate(); bosses(); }', to: 'union(){ plate(); }' },
    { id: 'star', base: SLED, label: 'av sled: bosses() under a * modifier', from: 'union(){ plate(); bosses(); }', to: 'union(){ plate(); *bosses(); }' },
  ];

  var state = { id: null, original: '', breakId: '', timer: 0, last: null };
  var code = $('code'), gutter = $('gutter');
  var entry = function (id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };

  // ------------------------------------------------------------ pickers
  function fillPickers() {
    var html = '', g = null;
    LIST.forEach(function (c) {
      if (c.group !== g) { if (g) html += '</optgroup>'; g = c.group; html += '<optgroup label="' + esc(GROUPS[g] || g) + '">'; }
      html += '<option value="' + esc(c.id) + '">' + esc(c.label.replace(/^index\.html /, '')) + '</option>';
    });
    html += '</optgroup><optgroup label="Your own"><option value="own">your own text (paste below)</option></optgroup>';
    $('pick').innerHTML = html;
    $('breakit').innerHTML = BREAKS.map(function (b) { return '<option value="' + b.id + '">' + esc(b.label) + '</option>'; }).join('');
  }

  function load(id, opts) {
    opts = opts || {};
    var c = entry(id);
    state.id = c ? id : 'own';
    state.original = c ? c.text : (store.get('coldread.own') || '');
    $('pick').value = state.id;
    if (!opts.keepBreak) { state.breakId = ''; $('breakit').value = ''; }
    code.value = state.original;
    code.scrollTop = 0; code.scrollLeft = 0;
    store.set('coldread.pick', state.id);
    run();
  }

  function applyBreak(bid) {
    var b = BREAKS.filter(function (x) { return x.id === bid; })[0];
    if (!b || !b.id) { state.breakId = ''; load(state.id === 'own' ? 'own' : state.id); return; }
    var base = entry(b.base);
    state.breakId = bid;
    load(b.base, { keepBreak: true });
    if (base.text.split(b.from).length !== 2) { renderRefusal('The mutation "' + b.label + '" expects to find ' + JSON.stringify(b.from) + ' exactly once in ' + b.base + ', and does not; nothing was changed.'); return; }
    code.value = base.text.replace(b.from, b.to);
    var at = base.text.indexOf(b.from);
    run();
    selectLine(code.value.slice(0, at).split('\n').length, false);
  }

  // ------------------------------------------------------------ lint and render
  function run() {
    var grade = $('grade').value || undefined;
    var t0 = performance.now();
    var r = CR.lint(code.value, { grade: grade });
    var ms = performance.now() - t0;
    state.last = r;
    if (state.id === 'own') store.set('coldread.own', code.value);
    render(r, ms);
  }
  function schedule() { clearTimeout(state.timer); state.timer = setTimeout(run, 150); }

  function render(r, ms) {
    var s = r.summary, edited = code.value !== state.original || !!state.breakId;
    var read = [r.grade + ' grade'];
    if (s.spec !== 'absent') read.push('SPEC ' + s.spec + (s.spec === 'parsed' ? ' (' + plural(s.specParts, 'part') + ')' : ''));
    if (s.flight !== 'absent') {
      var kept = 0; for (var k in s.flightCounts) kept += s.flightCounts[k].kept;
      read.push('FLIGHT ' + s.flight + (s.flight === 'parsed' ? ' (' + kept + ' entries kept, ' + s.named.dropped + ' dropped, ' + s.named.demoted + ' demoted, ' + (s.named.uncounted + s.named.capped) + ' never counted)' : ''));
    }
    read.push(plural(s.modules, 'module') + ', ' + s.drawn + ' drawn from the top level');
    read.push(plural(s.lines, 'line') + ' read in ' + ms.toFixed(1) + ' ms, nothing rendered');
    $('summary').innerHTML =
      '<span class="count e" id="n-err">' + plural(s.errors, 'error') + '</span>' +
      '<span class="count w" id="n-warn">' + plural(s.warnings, 'warning') + '</span>' +
      '<span class="count i" id="n-info">' + plural(s.infos, 'note') + '</span>' +
      '<span class="read" id="read">' + esc(read.join('; ')) + (edited ? ' (edited text)' : '') + '</span>';
    renderGate(r, edited);
    renderGutter(r);
    renderDiags(r);
    var clean = !s.errors && !s.warnings;
    $('footer').innerHTML = (clean ? 'No textual errors or warnings. That is not a pass: nothing here was rendered or measured.<br>' : '') + esc(r.footer);
    markCorpusRow();
  }

  function renderRefusal(msg) {
    $('diags').innerHTML = '<li class="empty" id="refusal">' + esc(msg) + '</li>';
  }

  // What PartForge's gate is recorded to have said about this text, beside what was found cold.
  function renderGate(r, edited) {
    var c = entry(state.id), el = $('gate');
    if (!c) { el.innerHTML = '<p class="other">Your own text: no gate result is recorded for it. A clean read here would still need the render and the CMM.</p>'; return; }
    if (edited) { el.innerHTML = '<p class="other">This text has been edited, so the gate result recorded for <span class="mono">' + esc(c.label) + '</span> no longer applies to it.</p>'; return; }
    var g = c.gate;
    if (!g) { el.innerHTML = '<p class="other">PartForge records no gate result for this text' + (c.group === 'shipped-flight' ? ' (it differs from its tests/templates copy, so that copy\'s result is not borrowed)' : '') + '.</p>'; return; }
    if (g.verdict) {
      el.innerHTML = '<p>The run log says: <span class="passed">' + esc(g.verdict) + '</span> <span class="where">(' + esc(g.source) + ')</span>. Read cold: ' + plural(r.summary.errors, 'error') + ', ' + plural(r.summary.warnings, 'warning') + '.</p>';
      return;
    }
    if (!g.fails.length) { el.innerHTML = '<p>The gate records <span class="passed">no failures</span> for this file <span class="where">(' + esc(g.source) + ')</span>. Read cold: ' + plural(r.summary.errors, 'error') + ', ' + plural(r.summary.warnings, 'warning') + '.</p>'; return; }
    var errs = r.diagnostics.filter(function (d) { return d.severity === 'error'; });
    var found = 0;
    var rows = g.fails.map(function (f) {
      var m = /"(.*?)"/.exec(f), name = m ? m[1] : f;
      var hit = errs.filter(function (d) { return d.message.indexOf('"' + name + '"') >= 0; })[0];
      if (hit) found++;
      return '<tr><td>' + esc(f) + '</td><td>' + (hit ? '<span class="found">named here, line ' + hit.line + '</span>' : '<span class="mesh">not named here; the gate found it on the rendered part</span>') + '</td></tr>';
    });
    el.innerHTML = '<p id="gate-line">The gate recorded ' + plural(g.fails.length, 'failure') + ' for this file after rendering it <span class="where">(' + esc(g.source) + ')</span>; read cold, <strong>' + found + ' of ' + g.fails.length + '</strong> ' + (found === 1 ? 'is' : 'are') + ' named before any render.</p><table><tbody>' + rows.join('') + '</tbody></table>';
  }

  function worstByLine(r) {
    var w = {}, rank = { error: 3, warning: 2, info: 1 };
    r.diagnostics.forEach(function (d) { if (d.line && (!w[d.line] || rank[d.severity] > rank[w[d.line]])) w[d.line] = d.severity; });
    return w;
  }
  function renderGutter(r) {
    var n = code.value.split('\n').length, w = worstByLine(r), cls = { error: 'e', warning: 'w', info: 'i' }, out = [];
    for (var i = 1; i <= n; i++) out.push('<span' + (w[i] ? ' class="' + cls[w[i]] + '"' : '') + ' data-l="' + i + '">' + i + '</span>');
    for (var j = 0; j < 4; j++) out.push('<span>&nbsp;</span>');   // room for the textarea's scrollbar
    gutter.innerHTML = out.join('');
    gutter.scrollTop = code.scrollTop;
  }

  function renderDiags(r) {
    var show = { error: $('f-error').checked, warning: $('f-warning').checked, info: $('f-info').checked };
    var shown = r.diagnostics.filter(function (d) { return show[d.severity]; });
    if (!r.diagnostics.length) { $('diags').innerHTML = '<li class="empty">Nothing to report in the text.</li>'; return; }
    if (!shown.length) { $('diags').innerHTML = '<li class="empty">All ' + r.diagnostics.length + ' are hidden by the filters above.</li>'; return; }
    $('diags').innerHTML = shown.map(function (d, i) {
      return '<li><button type="button" class="diag ' + d.severity + '" data-line="' + d.line + '" data-col="' + d.col + '" data-code="' + d.code + '">' +
        '<span class="head"><span class="sev">' + (d.severity === 'info' ? 'note' : d.severity) + '</span><span class="rule">' + d.code + '</span>' +
        '<span class="where">' + (d.line ? 'line ' + d.line + ', col ' + d.col : 'whole file') + '</span>' +
        '<span class="who" title="' + (d.source === 'app' ? 'decided by PartForge\'s own code, run verbatim' : 'Cold Read\'s own reading of the text') + '">' + (d.source === 'app' ? 'the app\'s rule' : 'Cold Read') + '</span></span>' +
        '<span class="msg">' + esc(d.message) + '</span>' + (d.quote ? '<span class="quote">' + esc(d.line + ' | ' + d.quote) + '</span>' : '') + '</button></li>';
    }).join('');
  }

  // ------------------------------------------------------------ jump to a line
  function selectLine(line, focus) {
    if (!line) return;
    var lines = code.value.split('\n'), start = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[line - 1] || '').length;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (focus && !coarse) code.focus({ preventScroll: true });
    try { code.setSelectionRange(start, end); } catch (e) { /* not focusable yet */ }
    code.scrollTop = Math.max(0, (line - 1) * LINE_PX - code.clientHeight / 3);
    code.scrollLeft = 0;
    gutter.scrollTop = code.scrollTop;
    var prev = gutter.querySelector('.cur'); if (prev) prev.classList.remove('cur');
    var cur = gutter.querySelector('[data-l="' + line + '"]'); if (cur) cur.classList.add('cur');
    state.curLine = line;
  }

  // ------------------------------------------------------------ the corpus table
  function renderCorpus() {
    var t0 = performance.now(), g = null, rows = [], totals = { e: 0, w: 0, i: 0 };
    LIST.forEach(function (c) {
      var r = CR.lint(c.text), s = r.summary;
      totals.e += s.errors; totals.w += s.warnings; totals.i += s.infos;
      if (c.group !== g) { g = c.group; rows.push('<tr class="group"><td colspan="6">' + esc(GROUPS[g] || g) + '</td></tr>'); }
      var codes = []; r.diagnostics.forEach(function (d) { if (d.severity !== 'info' && codes.indexOf(d.code) < 0) codes.push(d.code); });
      var gate = !c.gate ? '—' : c.gate.verdict ? esc(c.gate.verdict.split(/[(:]/)[0].trim()) : c.gate.fails.length ? plural(c.gate.fails.length, 'failure') : 'no failures';
      var lab = c.label.replace(/^index\.html /, ''), cut = lab.lastIndexOf('/') + 1;
      rows.push('<tr class="row" tabindex="0" data-id="' + esc(c.id) + '"><td class="file"><span class="dir">' + esc(lab.slice(0, cut)) + '</span>' + esc(lab.slice(cut)) + (c.sameAs ? ' <span class="where opt">(= ' + esc(c.sameAs) + ')</span>' : '') + '</td>' +
        '<td class="n' + (s.errors ? ' e' : '') + '">' + s.errors + '</td><td class="n' + (s.warnings ? ' w' : '') + '">' + s.warnings + '</td><td class="n">' + s.infos + '</td>' +
        '<td class="opt rule">' + esc(codes.join(', ') || '') + '</td><td>' + gate + '</td></tr>');
    });
    $('corpus').innerHTML = '<thead><tr><th>Text</th><th title="errors">err</th><th title="warnings">warn</th><th title="notes">note</th><th class="opt">rules raised</th><th>gate recorded</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    var withErr = LIST.filter(function (c) { return CR.lint(c.text).summary.errors; }).map(function (c) { return c.label.split('/').pop(); });
    $('corpus-intro').textContent = 'All ' + LIST.length + ' PartForge texts bundled here, read in ' + (performance.now() - t0).toFixed(0) + ' ms: ' + plural(totals.e, 'error') + ', ' + plural(totals.w, 'warning') + ', ' + plural(totals.i, 'note') + '. ' +
      (withErr.length ? 'Errors are in ' + withErr.join(', ') + '. ' : 'No text has an error. ') + 'Pick a row to read it above.';
  }
  function markCorpusRow() {
    var rows = document.querySelectorAll('#corpus tr.row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('sel', rows[i].getAttribute('data-id') === state.id && code.value === state.original);
  }

  // ------------------------------------------------------------ how it works and the rules
  function renderHow() {
    var S = APP.SOURCE, p = S.pieces, sha = S.commit ? S.commit.slice(0, 7) : '(unknown)';
    var range = function (k) { return p[k][0] + '–' + p[k][1]; };
    $('how').innerHTML = [
      '<p><strong>What PartForge does today.</strong> Its Generate loop renders the file first (<span class="mono">runCode</span>, index.html:7614) and only then runs the SPEC and FLIGHT checks (<span class="mono">specCheck</span>, index.html:7627). So a malformed FLIGHT block, a declared part with no module, or a critical dimension that contradicts the SPEC is reported after a full compile, although all of them are in the text. PartForge\'s own STATUS.md records 24 s for the retainer fixture\'s part batch alone and 121.7 s of gate time across its ten reference cases (docs/STATUS.md:268–271); a containment probe once took 445 s on a nose cone (index.html:3231).</p>',
      '<p><strong>Two kinds of rule.</strong> Where PartForge already decides something (whether a FLIGHT or SPEC entry is dropped or demoted, its flightLint, its hobby lint, its contradiction check, its by-construction shortcut), Cold Read runs the app\'s own function, copied verbatim from index.html at <span class="mono">' + esc(sha) + '</span>: the declaration block (lines ' + range('DECL') + '), parseSpec (' + range('parseSpec') + '), lint (' + range('lint') + '), mainPlainUnion (' + range('mainPlainUnion') + ') and topLevelIsOnlyMain (' + range('topLevelIsOnlyMain') + '). It decides each entry by running parseFlight on that entry alone, so the verdict is the app\'s; Cold Read adds only <em>where</em> (line and column, through a JSON reader that keeps positions) and <em>which field</em>. Those diagnostics are marked <span class="who">the app\'s rule</span>. Its own readings (module table, the call graph from the top level, * and % modifiers, the parameter block) are marked <span class="who">Cold Read</span>.</p>',
      '<p><strong>Kept honest by the app.</strong> If Cold Read\'s count of named dropped or demoted entries ever differs from the counters parseFlight returns, it says so with a PARITY error and reports the app\'s number. Its tests (coldread.test.mjs) check this on every bundled text and on a corrupted copy of every checked field of every FLIGHT entry, and compare its JSON error positions with the ones V8\'s own JSON.parse reports.</p>',
      '<p><strong>What it cannot see.</strong> Anything that needs the mesh: the retainer\'s lip filled into its pocket, the endcap\'s groove declared as a bore. A clean read is never a pass, and every report ends with the same line.</p>',
    ].join('');
    $('rules-summary').textContent = 'The ' + CR.RULES.length + ' rules: what each finds and what the app itself does about it';
    $('rules').innerHTML = '<thead><tr><th>Rule</th><th>Severity</th><th>Finds</th><th>The app</th><th>Where</th></tr></thead><tbody>' +
      CR.RULES.map(function (r) { return '<tr><td>' + r.code + '</td><td>' + esc(r.severity) + '</td><td>' + esc(r.what) + '</td><td>' + esc(r.app || '') + '</td><td class="where">' + esc(r.ref || '') + '</td></tr>'; }).join('') + '</tbody>';
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    $('pick').addEventListener('change', function () { load(this.value); });
    $('breakit').addEventListener('change', function () { applyBreak(this.value); });
    $('grade').addEventListener('change', run);
    code.addEventListener('input', schedule);
    code.addEventListener('scroll', function () { gutter.scrollTop = code.scrollTop; });
    ['f-error', 'f-warning', 'f-info'].forEach(function (id) { $(id).addEventListener('change', function () { if (state.last) renderDiags(state.last); }); });
    $('diags').addEventListener('click', function (ev) {
      var b = ev.target.closest('.diag'); if (!b) return;
      var line = +b.getAttribute('data-line');
      if (window.innerWidth <= 900) $('code').closest('.panel').scrollIntoView({ block: 'start' });
      selectLine(line, true);
    });
    $('reset').addEventListener('click', function () { if (state.breakId) applyBreak(state.breakId); else { code.value = state.original; run(); } });
    $('clear').addEventListener('click', function () { state.breakId = ''; $('breakit').value = ''; state.id = 'own'; $('pick').value = 'own'; state.original = ''; code.value = ''; run(); code.focus(); });
    var pickRow = function (tr) { load(tr.getAttribute('data-id')); $('h-file').scrollIntoView({ block: 'start' }); };
    $('corpus').addEventListener('click', function (ev) { var tr = ev.target.closest('tr.row'); if (tr) pickRow(tr); });
    $('corpus').addEventListener('keydown', function (ev) { var tr = ev.target.closest('tr.row'); if (tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); pickRow(tr); } });
  }

  fillPickers();
  renderHow();
  renderCorpus();
  wire();
  var first = store.get('coldread.pick');
  load(first && (first === 'own' || entry(first)) ? first : 'tests/dryrun/endcap.scad');
  window.ColdReadPage = { state: state, load: load, applyBreak: applyBreak, LIST: LIST, BREAKS: BREAKS };
})();
