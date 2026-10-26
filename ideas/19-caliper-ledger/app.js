/* Caliper Ledger: the page. Everything it computes comes from ledger.js (window.CaliperLedger), which reads
   the declaration with PartForge's own parser (window.PartForgeDecl). Text from a file is only ever set as
   text, never as HTML. */
(function () {
  'use strict';
  var C = window.CaliperLedger, PF = window.PartForgeDecl;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'caliper-ledger.v1';
  var ORDER = ['bulkhead', 'coupler', 'centering-ring', 'motor-retainer', 'nosecone', 'fin', 'av-sled'];
  var PASTE = '__paste';

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  };
  function readJSON(k) { var s = store.get(k); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }

  var S = { key: 'bulkhead', decl: null, shelf: [], entries: {}, meta: {}, modelled: null, modelledFrom: null, cards: [] };

  /* ---------------------------------------------------------------- small DOM helpers */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'cls') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function today() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function uid() { return 'i' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function str(v, n) { return v == null ? '' : String(v).slice(0, n || 120); }

  /* ---------------------------------------------------------------- persistence */
  function ledgerKey() { return KEY + '.ledger.' + S.decl.declSha256; }
  function saveLedger() {
    if (!S.decl) return;
    store.set(ledgerKey(), JSON.stringify({ entries: S.entries, meta: S.meta, modelled: S.modelled, modelledFrom: S.modelledFrom }));
  }
  function saveShelf() { store.set(KEY + '.shelf', JSON.stringify(S.shelf)); }
  function cleanDraft(e) {
    if (!e || typeof e !== 'object') return null;
    return { method: str(e.method, 20), instrument: str(e.instrument, 80), readings: (Array.isArray(e.readings) ? e.readings : []).slice(0, 100).map(function (x) { return str(x, 60); }),
      unit: e.unit === 'in' ? 'in' : 'mm', go: str(e.go, 60), go_result: str(e.go_result, 8), nogo: str(e.nogo, 60), nogo_result: str(e.nogo_result, 8),
      gauge_id: str(e.gauge_id), how: str(e.how), observed: str(e.observed, 20) };
  }
  function loadShelf() {
    var s = readJSON(KEY + '.shelf');
    S.shelf = Array.isArray(s) ? s.map(C.cleanInstrument).filter(Boolean) : [];
  }

  /* ---------------------------------------------------------------- the declaration */
  function fillTemplates() {
    var sel = $('tpl');
    ORDER.forEach(function (k) {
      var t = PF.templates[k];
      sel.appendChild(el('option', { value: k, text: k + '.scad · ' + C.partName(t.text) }));
    });
    sel.appendChild(el('option', { value: PASTE, text: 'Paste or open your own .scad…' }));
  }

  function chooseTemplate(key) {
    if (key !== PASTE && !PF.templates[key]) key = 'bulkhead';
    S.key = key; $('tpl').value = key;
    store.set(KEY + '.last', key);
    if (key === PASTE) {
      $('pasteBox').hidden = false;
      var saved = store.get(KEY + '.pasted') || '';
      if (!$('paste').value) $('paste').value = saved;
      if (saved) loadDecl(saved, { kind: 'pasted' });
      else showRefusal({ code: 'insufficient_data', reason: 'No file yet.', what_would_help: 'Paste the whole .scad of the part you machined, or open it, then press "Use this file".' });
      return;
    }
    $('pasteBox').hidden = true;
    var t = PF.templates[key];
    loadDecl(t.text, { kind: 'template', file: t.file, commit: PF.provenance.commit });
  }

  function showRefusal(r) {
    S.decl = null;
    var box = $('declRefusal');
    clear(box);
    box.appendChild(el('p', null, [el('strong', { text: 'Nothing to inspect against. ' }), r.reason]));
    box.appendChild(el('p', { text: 'What would help: ' + r.what_would_help }));
    box.appendChild(el('p', { cls: 'code', text: 'refusal: ' + r.code }));
    box.hidden = false;
    $('declOut').hidden = true;
    clear($('features')); S.cards = [];
    clear($('notAssessed'));
    $('dateHint').textContent = ''; $('reportOut').textContent = ''; $('outMsg').textContent = '';
    setDisabled(true);
    renderStatus();
  }
  function setDisabled(on) {
    ['dlJson', 'dlMd', 'copyMd', 'importReport', 'clearReport', 'startOver', 'nextTodo', 'operator', 'idate', 'remarks', 'filter', 'reportFile', 'resumeFile', 'reportText'].forEach(function (id) { $(id).disabled = on; });
  }

  function loadDecl(text, source) {
    var d = C.loadDeclaration(text, source);
    if (!d.ok) { showRefusal(d.refusal); return; }
    S.decl = d;
    $('declRefusal').hidden = true;
    setDisabled(false);
    var saved = readJSON(ledgerKey()) || {};
    S.entries = {};
    var ids = {};
    d.features.forEach(function (f) { ids[f.id] = true; });
    Object.keys(saved.entries || {}).forEach(function (k) { if (ids[k]) { var e = cleanDraft(saved.entries[k]); if (e) S.entries[k] = e; } });
    S.meta = { operator: str((saved.meta || {}).operator, 80), date: str((saved.meta || {}).date, 10), remarks: str((saved.meta || {}).remarks, 200) };
    var fresh = !S.meta.date;
    if (fresh) S.meta.date = today();
    $('dateHint').textContent = fresh ? 'The date is set to today on this device; change it if the readings were taken on another day.' : '';
    S.modelled = saved.modelled && typeof saved.modelled === 'object' ? saved.modelled : null;
    S.modelledFrom = saved.modelledFrom || null;
    $('operator').value = S.meta.operator; $('idate').value = S.meta.date; $('remarks').value = S.meta.remarks;
    $('reportOut').textContent = S.modelled && S.modelledFrom ? 'As modelled: from a ' + S.modelledFrom.shape + ' for this part (' + S.modelledFrom.rows + ' rows), kept from earlier.' : '';
    $('outMsg').textContent = '';
    renderDecl();
    buildCards();
    updateAll();
  }

  function renderDecl() {
    var d = S.decl, f = d.flight, c = d.counts;
    $('declOut').hidden = false;
    $('partName').textContent = d.part;
    var facts = $('declFacts');
    clear(facts);
    var nHoles = d.features.filter(function (x) { return x.kind === 'holes'; }).length;
    var declares = [];
    if (c.critical) declares.push(c.critical + ' critical');
    if (c.od) declares.push(c.od + ' OD');
    if (c.bores) declares.push(c.bores + ' bore' + (c.bores > 1 ? 's' : ''));
    if (c.holes) declares.push(c.holes + ' hole pattern' + (c.holes > 1 ? 's' : '') + ' (' + nHoles + ' holes)');
    if (c.revolve) declares.push(c.revolve + ' profile' + (c.revolve > 1 ? 's' : ''));
    if (c.gauges) declares.push(c.gauges + ' gauge' + (c.gauges > 1 ? 's' : ''));
    var pv = d.provenance;
    var rows = [
      ['Source', d.source.kind === 'template' ? d.source.file + ' at PartForge ' + String(d.source.commit).slice(0, 7) + ' (snapshot in this folder)' : 'a file you pasted or opened'],
      ['FLIGHT sha256', d.declSha256],
      ['Declares', declares.join(', ') + (c.loads ? '; ' + c.loads + ' load row' + (c.loads > 1 ? 's' : '') + ' (not inspected)' : '')],
      ['Ledger rows', d.features.length + ' (one per hole)'],
      ['Tolerances', pv.cited + ' cited · ' + pv.user + ' set by the engineer · ' + pv.tool_default + ' proposed by the tool'],
      ['Material, process', (f.material || '—') + ', ' + (f.process || '—')]
    ];
    if (d.dropped || d.demoted) rows.push(['Parser notes', (d.dropped ? d.dropped + ' entr' + (d.dropped > 1 ? 'ies' : 'y') + ' dropped by parseFlight as invalid (not in this ledger)' : '') + (d.dropped && d.demoted ? '; ' : '') + (d.demoted ? d.demoted + ' "source" tolerance' + (d.demoted > 1 ? 's' : '') + ' with no reference demoted to tool default' : '')]);
    $('declLine').textContent = d.features.length + ' features to inspect · FLIGHT sha256 ' + d.declSha256.slice(0, 12) + '… · ' + pv.tool_default + ' of ' + (pv.cited + pv.user + pv.tool_default) + ' tolerances are tool defaults' + (d.source.kind === 'template' ? ' · ' + d.source.file.replace('tests/templates/', '') + ' at PartForge ' + String(d.source.commit).slice(0, 7) : ' · pasted file');
    rows.forEach(function (r) {
      facts.appendChild(el('dt', { text: r[0] }));
      facts.appendChild(el('dd', { cls: r[0] === 'FLIGHT sha256' ? 'hash' : null, text: r[1] }));
    });
    $('blockText').textContent = d.blockText;
    var plan = $('plan');
    clear(plan);
    d.inspect.forEach(function (x) { plan.appendChild(el('li', { text: x })); });
    $('planBox').hidden = !d.inspect.length;
    var na = $('notAssessed');
    clear(na);
    na.appendChild(el('strong', { text: 'Not assessed by this ledger' }));
    na.appendChild(el('ul', { cls: 'plain' }, d.notAssessed.map(function (x) { return el('li', { text: x }); })));
  }

  /* ---------------------------------------------------------------- instruments */
  function useCount(id) { return Object.keys(S.entries).filter(function (k) { var e = S.entries[k]; return e && e.method === 'readings' && e.instrument === id; }).length; }

  function renderShelf() {
    var ul = $('shelf');
    clear(ul);
    $('shelfEmpty').hidden = S.shelf.length > 0;
    S.shelf.forEach(function (ins, i) {
      var n = 'ins' + i;
      var check = el('span', { cls: 'chk' });
      function onField(field) {
        return function (ev) { ins[field] = ev.target.value; saveShelf(); refreshCheck(); refreshInstrumentOptions(); updateAll(); };
      }
      function refreshCheck() {
        var v = C.validateInstrument(ins);
        check.textContent = v.ok ? 'Ready: the 10:1 check uses its ' + v.figure_is + '.' : 'Needs: ' + v.why.join('; ') + '.';
      }
      var typeSel = el('select', { id: n + 't', onchange: onField('type') }, C.INSTRUMENT_TYPES.map(function (t) { return el('option', { value: t[0], text: t[1] }); }));
      typeSel.value = ins.type;
      var unitSel = el('select', { id: n + 'u', onchange: onField('unit') }, [el('option', { value: 'mm', text: 'mm' }), el('option', { value: 'in', text: 'in' })]);
      unitSel.value = ins.unit;
      var used = useCount(ins.id);
      var li = el('li', { cls: 'inst' }, [
        el('div', { cls: 'field' }, [el('label', { for: n + 't', text: 'Kind' }), typeSel]),
        el('div', { cls: 'field' }, [el('label', { for: n + 'u', text: 'Reads in' }), unitSel]),
        el('div', { cls: 'field' }, [el('label', { for: n + 'r', text: 'Resolution' }), el('input', { id: n + 'r', value: ins.resolution, inputmode: 'decimal', autocomplete: 'off', placeholder: 'e.g. 0.01', oninput: onField('resolution') })]),
        el('div', { cls: 'field' }, [el('label', { for: n + 'a', text: 'Stated accuracy ± (optional)' }), el('input', { id: n + 'a', value: ins.accuracy, inputmode: 'decimal', autocomplete: 'off', placeholder: 'from its spec sheet', oninput: onField('accuracy') })]),
        el('div', { cls: 'field wide' }, [el('label', { for: n + 'l', text: 'Name or ID (optional)' }), el('input', { id: n + 'l', value: ins.label, autocomplete: 'off', placeholder: 'e.g. Mitutoyo, shop #3', oninput: onField('label') })]),
        el('div', { cls: 'use' }, [check, el('button', { type: 'button', cls: 'btn small quiet', text: 'Remove', 'aria-label': 'Remove instrument ' + (i + 1), onclick: function () {
          var u = useCount(ins.id);
          if (u && !window.confirm('This instrument is named by ' + u + ' feature' + (u > 1 ? 's' : '') + '. Remove it? Those features go back to NOT MEASURED until you choose another.')) return;
          S.shelf.splice(i, 1); saveShelf(); renderShelf(); refreshInstrumentOptions(); updateAll();
        } })])
      ]);
      if (used) li.setAttribute('data-used', used);
      ul.appendChild(li);
      refreshCheck();
    });
  }
  function addInstrument(focus) {
    var ins = { id: uid(), type: 'caliper', label: '', unit: 'mm', resolution: '', accuracy: '' };
    S.shelf.push(ins); saveShelf(); renderShelf(); refreshInstrumentOptions(); updateAll();
    if (focus) { var r = $('ins' + (S.shelf.length - 1) + 't'); if (r) { r.scrollIntoView({ block: 'center' }); r.focus(); } }
    return ins;
  }
  function refreshInstrumentOptions() {
    S.cards.forEach(function (c) {
      if (!c.instSel) return;
      var cur = (S.entries[c.f.id] || {}).instrument || '';
      clear(c.instSel);
      c.instSel.appendChild(el('option', { value: '', text: S.shelf.length ? 'choose an instrument…' : 'add one in step 2 first' }));
      S.shelf.forEach(function (ins) { c.instSel.appendChild(el('option', { value: ins.id, text: C.instrumentLabel(ins) })); });
      if (cur && !S.shelf.some(function (x) { return x.id === cur; })) c.instSel.appendChild(el('option', { value: cur, text: '(removed instrument)' }));
      c.instSel.value = cur;
      c.addInstBtn.hidden = S.shelf.length > 0;
    });
  }

  /* ---------------------------------------------------------------- feature cards */
  function chipClass(st) { return st === 'IN' ? 'in' : st === 'OUT' ? 'out' : st === 'UNDECIDED' ? 'und' : 'none'; }
  function bandText(f) {
    if (f.type === 'gauge') return 'must ' + (f.expect === 'interfere' ? 'be blocked' : 'clear');
    if (f.type === 'profile') return 'profile ±' + f.tol_mm + ' mm';
    if (f.refused) return 'cannot compare exactly';
    return (f.diameter ? 'Ø ' : '') + C.fmtExact(f.lower_pm, 3) + ' … ' + C.fmtExact(f.upper_pm, 3) + ' mm  (' + C.fmtExact(f.nominal_pm, 3) + ' ±' + C.fmtExact(f.tol_pm, 2) + ')';
  }
  function entryOf(f) {
    var e = S.entries[f.id];
    if (!e) {
      e = cleanDraft({ method: f.type === 'gauge' ? 'gauge' : f.type === 'profile' ? 'profile' : 'readings' });
      S.entries[f.id] = e;
    }
    return e;
  }
  function touched(f) { return !!S.entries[f.id]; }

  function seg(label, options, current, onpick) {
    var wrap = el('div', { cls: 'seg', role: 'group', 'aria-label': label });
    options.forEach(function (o) {
      wrap.appendChild(el('button', { type: 'button', 'aria-pressed': String(current === o[0]), 'data-v': o[0], text: o[1], onclick: function () {
        Array.prototype.forEach.call(wrap.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === o[0])); });
        onpick(o[0]);
      } }));
    });
    return wrap;
  }

  function buildCards() {
    var ol = $('features');
    clear(ol);
    S.cards = S.decl.features.map(function (f, i) { return buildCard(f, i, ol); });
    refreshInstrumentOptions();
  }

  function buildCard(f, i, ol) {
    var c = { f: f, i: i };
    var e = S.entries[f.id];
    c.chip = el('span', { cls: 'chip none', text: 'NOT MEASURED' });
    var summary = el('summary', null, [el('span', { cls: 'fname', text: f.label }), c.chip, el('span', { cls: 'fband', text: bandText(f) })]);
    var body = el('div', { cls: 'body' });
    var tags = el('div', { cls: 'tags' });
    if (f.tol_label) tags.appendChild(el('span', { cls: 'tag' + (f.tol_src === 'default' ? ' def' : ''), text: 'tolerance: ' + f.tol_label }));
    if (f.pos_tol_mm != null) tags.appendChild(el('span', { cls: 'tag', text: 'position ±' + f.pos_tol_mm + ': not assessed here' }));
    if (f.hole) tags.appendChild(el('span', { cls: 'tag', text: 'hole ' + (f.hole.index + 1) + ' of ' + f.hole.of }));
    body.appendChild(tags);
    if (f.type === 'variable' && !f.refused) body.appendChild(el('p', { cls: 'hint', text: 'In inches, rounded inward: ' + C.fmtInch(f.lower_pm, 'up') + ' … ' + C.fmtInch(f.upper_pm, 'down') + ' in.' }));
    if (f.type === 'gauge') body.appendChild(el('p', { cls: 'hint', text: 'The declaration requires gauge ' + f.module + '() to ' + (f.expect === 'interfere' ? 'be blocked by material' : 'clear') + (f.why ? ': ' + f.why : '') + '. Record what the physical gauge or check did.' }));
    c.modelled = el('p', { cls: 'modelled' });
    body.appendChild(c.modelled);
    if (f.hints.length) body.appendChild(el('ul', { cls: 'flags' }, f.hints.map(function (h) { return el('li', { cls: 'hint', text: h }); })));

    var idp = 'f' + i;
    if (f.type === 'variable') {
      var method = e ? e.method : 'readings';
      c.mReadings = el('div', { hidden: method !== 'readings' });
      c.mGng = el('div', { hidden: method !== 'gonogo' });
      body.appendChild(seg('How it was measured', [['readings', 'Readings'], ['gonogo', 'GO / NO-GO gauges']], method, function (v) {
        var en = entryOf(f); en.method = v; c.mReadings.hidden = v !== 'readings'; c.mGng.hidden = v !== 'gonogo'; changed(c);
      }));
      // readings
      c.instSel = el('select', { id: idp + 'i', onchange: function (ev) { entryOf(f).instrument = ev.target.value; changed(c); } });
      c.addInstBtn = el('button', { type: 'button', cls: 'btn small', text: 'Add an instrument', onclick: function () { var ins = addInstrument(false); entryOf(f).instrument = ins.id; refreshInstrumentOptions(); changed(c); var r = $('ins' + (S.shelf.length - 1) + 'r'); if (r) { r.scrollIntoView({ block: 'center' }); r.focus(); } } });
      c.mReadings.appendChild(el('div', { cls: 'field' }, [el('label', { for: idp + 'i', text: 'Instrument' }), c.instSel]));
      c.mReadings.appendChild(c.addInstBtn);
      c.readBox = el('div', { cls: 'readings', role: 'group', 'aria-label': 'Readings' });
      c.mReadings.appendChild(el('p', { cls: 'hint', text: 'One size per box, in the instrument\'s unit, where the plan says to take them (for an OD, at two places 90° apart). Blank boxes are ignored.' }));
      c.mReadings.appendChild(c.readBox);
      c.mReadings.appendChild(el('button', { type: 'button', cls: 'btn small', text: 'Add a reading', onclick: function () { addReadingInput(c, true); } }));
      var rs = e && e.readings && e.readings.length ? e.readings : [''];
      rs.forEach(function (v) { addReadingInput(c, false, v); });
      // GO / NO-GO
      var en0 = e || {};
      var inside = f.sense === 'internal';
      var unitSel = el('select', { id: idp + 'gu', onchange: function (ev) { entryOf(f).unit = ev.target.value; changed(c); } }, [el('option', { value: 'mm', text: 'mm' }), el('option', { value: 'in', text: 'in' })]);
      unitSel.value = en0.unit === 'in' ? 'in' : 'mm';
      c.mGng.appendChild(el('p', { cls: 'hint', text: inside ? 'Pins or plugs: one that goes in proves the hole is at least its size; one that stops proves it is at most its size.' : 'Rings or snap gauges: one that passes over proves the size is at most its size; one that stops proves it is at least its size.' }));
      c.mGng.appendChild(el('div', { cls: 'field' }, [el('label', { for: idp + 'gu', text: 'Gauge sizes in' }), unitSel]));
      var gng = el('div', { cls: 'gng' });
      [['go', 'GO'], ['nogo', 'NO-GO']].forEach(function (m) {
        var sizeIn = el('input', { id: idp + m[0], value: en0[m[0]] || '', inputmode: 'decimal', autocomplete: 'off', placeholder: m[0] === 'go' ? (inside ? 'lower limit' : 'upper limit') : (inside ? 'upper limit' : 'lower limit'), oninput: function (ev) { entryOf(f)[m[0]] = ev.target.value; changed(c); } });
        gng.appendChild(el('div', { cls: 'member' }, [
          el('label', { for: idp + m[0], text: m[1] + ' size' }), sizeIn,
          seg(m[1] + ' result', [['pass', inside ? 'went in' : 'went over'], ['stop', 'stopped']], en0[m[0] + '_result'] || '', function (v) { entryOf(f)[m[0] + '_result'] = v; changed(c); })
        ]));
      });
      c.mGng.appendChild(gng);
      c.mGng.appendChild(el('div', { cls: 'field' }, [el('label', { for: idp + 'gid', text: 'Gauge set or ID (optional)' }), el('input', { id: idp + 'gid', value: en0.gauge_id || '', autocomplete: 'off', oninput: function (ev) { entryOf(f).gauge_id = ev.target.value; changed(c); } })]));
      body.appendChild(c.mReadings);
      body.appendChild(c.mGng);
    } else {
      var en1 = e || {};
      var choices = f.type === 'gauge' ? [['clear', 'Clear: it passed, no contact'], ['blocked', 'Blocked: it stopped on material']] : [['conforms', 'Conforms'], ['deviates', 'Deviates']];
      body.appendChild(el('div', { cls: 'field' }, [el('label', { for: idp + 'how', text: f.type === 'gauge' ? 'What was used (the physical gauge or check)' : 'How it was checked (template, scan)' }),
        el('input', { id: idp + 'how', value: en1.how || '', autocomplete: 'off', oninput: function (ev) { entryOf(f).how = ev.target.value; changed(c); } })]));
      body.appendChild(el('div', { cls: 'methods' }, [seg('Result', choices, en1.observed || '', function (v) { entryOf(f).observed = v; changed(c); })]));
    }
    c.computed = el('div', { cls: 'computed', 'aria-live': 'polite' });
    body.appendChild(c.computed);
    body.appendChild(el('div', { cls: 'actions' }, [el('button', { type: 'button', cls: 'btn small', text: 'Done · next to measure', onclick: function () { c.details.open = false; nextTodo(i); } })]));
    c.details = el('details', { id: 'fd' + i }, [summary, body]);
    c.li = el('li', { cls: 'feat', 'data-id': f.id }, [c.details]);
    ol.appendChild(c.li);
    return c;
  }

  function addReadingInput(c, focus, value) {
    var k = c.readBox.children.length;
    var inp = el('input', { id: 'f' + c.i + 'r' + k, value: value || '', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', 'aria-label': 'Reading ' + (k + 1), placeholder: 'reading ' + (k + 1) });
    inp.addEventListener('input', function () {
      var e = entryOf(c.f);
      e.method = 'readings';
      var vals = Array.prototype.map.call(c.readBox.children, function (x) { return x.value; });
      e.readings = vals;
      changed(c);
    });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      var idx = Array.prototype.indexOf.call(c.readBox.children, inp);
      if (idx === c.readBox.children.length - 1) { if (inp.value.trim()) addReadingInput(c, true); }
      else c.readBox.children[idx + 1].focus();
    });
    c.readBox.appendChild(inp);
    if (focus) inp.focus();
    return inp;
  }

  function changed(c) { saveLedger(); updateCard(c); renderStatus(); refreshPreview(); }

  function stat(label, value) { return el('div', null, [el('b', { text: label }), el('span', { text: value })]); }

  function updateCard(c) {
    var f = c.f;
    var ev = C.evaluate(f, S.entries[f.id], S.shelf);
    c.ev = ev;
    c.chip.className = 'chip ' + chipClass(ev.status);
    c.chip.textContent = ev.status;
    var m = S.modelled && S.modelled[f.id];
    c.modelled.textContent = 'As modelled (the mesh, not this part): ' + (m ? C.modelledText(f, m) : '— import PartForge\'s report in step 4 to fill this column');
    var box = c.computed;
    clear(box);
    if (ev.status === 'NOT MEASURED') {
      if (touched(f) && ev.problems.length && !(ev.problems.length === 1 && /^No (readings|gauge results|entry) yet/.test(ev.problems[0])))
        box.appendChild(el('ul', { cls: 'problems' }, ev.problems.map(function (p) { return el('li', { text: p }); })));
      else box.appendChild(el('p', { cls: 'hint', text: 'Not measured yet. No verdict until there is an entry with its instrument.' }));
    } else {
      box.appendChild(el('p', { cls: 'why', text: ev.why }));
      var s = ev.stats;
      if (s && s.readings) {
        box.appendChild(el('div', { cls: 'stats' }, [
          stat('readings', String(s.n)), stat('mean', s.mean_mm + ' mm'), stat('range', s.range_mm + ' mm'),
          stat('smallest … largest', s.min_mm + ' … ' + s.max_mm), stat('mean − nominal', s.dev_mean_mm + ' mm'), stat('worst margin', s.worst_margin_mm + ' mm')
        ]));
      }
      if (ev.flags.length) box.appendChild(el('ul', { cls: 'flags' }, ev.flags.map(function (x) { return el('li', { 'data-code': x.code, text: x.text }); })));
    }
    applyFilter(c);
  }

  function applyFilter(c) {
    var v = $('filter').value, st = c.ev ? c.ev.status : 'NOT MEASURED';
    c.li.hidden = v === 'todo' ? st !== 'NOT MEASURED' : v === 'problems' ? !(st === 'OUT' || st === 'UNDECIDED') : false;
  }

  function nextTodo(after) {
    var n = S.cards.length;
    for (var k = 1; k <= n; k++) {
      var c = S.cards[((after == null ? -1 : after) + k) % n];
      if (c.ev && c.ev.status === 'NOT MEASURED') {
        c.li.hidden = false;
        c.details.open = true;
        c.li.scrollIntoView({ block: 'start' });
        var first = c.details.querySelector('.body input:not([type=file]), .body select, .body button');
        if (first) first.focus();
        return true;
      }
    }
    $('outMsg').textContent = '';
    return false;
  }

  function renderStatus() {
    var box = $('status');
    if (!S.decl) { box.className = 'status none'; $('sword').textContent = '—'; $('sline').textContent = 'No declaration.'; clear($('sbar')); return; }
    var evals = S.cards.map(function (c) { return c.ev || C.evaluate(c.f, S.entries[c.f.id], S.shelf); });
    var st = C.partStatus(S.decl, evals, S.meta);
    box.className = 'status ' + (st.verdict === 'ALL IN' ? 'in' : st.verdict === 'NONCONFORMING' ? 'out' : st.verdict === 'UNDECIDED' ? 'und' : 'none');
    $('sword').textContent = st.verdict;
    $('sline').textContent = st.line + ' ' + st.counts.IN + ' IN · ' + st.counts.OUT + ' OUT · ' + st.counts.UNDECIDED + ' undecided · ' + st.counts['NOT MEASURED'] + ' not measured.';
    var bar = $('sbar');
    clear(bar);
    [['IN', 'b-in'], ['OUT', 'b-out'], ['UNDECIDED', 'b-und']].forEach(function (p) {
      if (st.counts[p[0]]) bar.appendChild(el('span', { cls: p[1], style: 'width:' + (100 * st.counts[p[0]] / st.total) + '%' }));
    });
  }

  function updateAll() { S.cards.forEach(updateCard); renderStatus(); refreshPreview(); }

  /* ---------------------------------------------------------------- the record */
  function state() { return { shelf: S.shelf, entries: S.entries, meta: S.meta, modelled: S.modelled, modelledFrom: S.modelledFrom }; }
  function slug() {
    return (S.decl.part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part') + '-' + S.decl.declSha256.slice(0, 8);
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }
  function refreshPreview() { if ($('mdDetails').open && S.decl) $('mdPreview').textContent = C.toMarkdown(S.decl, state()); }

  function readFile(input, cb) {
    var file = input.files && input.files[0];
    if (!file) return;
    var r = new FileReader();
    r.onload = function () { cb(String(r.result || '')); input.value = ''; };
    r.onerror = function () { cb(null); input.value = ''; };
    r.readAsText(file);
  }

  function showReportResult(r) {
    var out = $('reportOut');
    clear(out);
    if (!r.ok) {
      out.appendChild(el('div', { cls: 'refusal', role: 'alert' }, [
        el('p', null, [el('strong', { text: 'Not imported. ' }), r.refusal.reason]),
        el('p', { text: 'What would help: ' + r.refusal.what_would_help }),
        el('p', { cls: 'code', text: 'refusal: ' + r.refusal.code })]));
      return;
    }
    S.modelled = r.modelled; S.modelledFrom = r.from;
    saveLedger(); updateAll();
    out.textContent = 'Imported a ' + r.from.shape + ' for this part: ' + r.from.rows + ' rows matched the declaration one for one' + (r.from.model_fails != null ? '; the model failed ' + r.from.model_fails + ' of its own checks' : '') + '. No reading was filled.';
  }

  /* ---------------------------------------------------------------- wiring */
  function storageWorks() {
    try { var k = KEY + '.probe'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; } catch (e) { return false; }
  }
  function init() {
    if (!storageWorks()) $('storageNote').textContent = 'This browser is not letting the page keep anything: readings will be gone after a reload. Download the record before you close the page.';
    fillTemplates();
    loadShelf();
    renderShelf();
    $('tpl').addEventListener('change', function (ev) { chooseTemplate(ev.target.value); });
    $('usePaste').addEventListener('click', function () {
      var t = $('paste').value;
      store.set(KEY + '.pasted', t);
      loadDecl(t, { kind: 'pasted' });
    });
    $('scadFile').addEventListener('change', function (ev) {
      readFile(ev.target, function (t) { if (t == null) return; $('paste').value = t; store.set(KEY + '.pasted', t); loadDecl(t, { kind: 'pasted' }); });
    });
    $('addInst').addEventListener('click', function () { addInstrument(true); });
    $('operator').addEventListener('input', function (ev) { S.meta.operator = ev.target.value; saveLedger(); renderStatus(); refreshPreview(); });
    $('idate').addEventListener('input', function (ev) { S.meta.date = ev.target.value; $('dateHint').textContent = ''; saveLedger(); renderStatus(); refreshPreview(); });
    $('remarks').addEventListener('input', function (ev) { S.meta.remarks = ev.target.value; saveLedger(); refreshPreview(); });
    $('filter').addEventListener('change', function () { S.cards.forEach(applyFilter); });
    $('nextTodo').addEventListener('click', function () {
      var open = -1;
      S.cards.forEach(function (c) { if (c.details.open) open = c.i; });
      if (!nextTodo(open)) $('outMsg').textContent = 'Every feature has an entry.';
    });
    $('importReport').addEventListener('click', function () {
      var t = $('reportText').value.trim();
      if (!t) { showReportResult({ ok: false, refusal: { code: 'insufficient_data', reason: 'Nothing to import.', what_would_help: 'Open the report file above or paste its JSON.' } }); return; }
      showReportResult(C.importReport(t, S.decl));
    });
    $('reportFile').addEventListener('change', function (ev) { readFile(ev.target, function (t) { if (t != null) showReportResult(C.importReport(t, S.decl)); }); });
    $('clearReport').addEventListener('click', function () { S.modelled = null; S.modelledFrom = null; saveLedger(); updateAll(); $('reportOut').textContent = 'The model column is empty.'; });
    $('dlJson').addEventListener('click', function () {
      download(slug() + '-asbuilt.json', JSON.stringify(C.exportLedger(S.decl, state()), null, 1) + '\n', 'application/json');
      $('outMsg').textContent = 'Saved ' + slug() + '-asbuilt.json.';
    });
    $('dlMd').addEventListener('click', function () {
      download(slug() + '-asbuilt.md', C.toMarkdown(S.decl, state()), 'text/markdown');
      $('outMsg').textContent = 'Saved ' + slug() + '-asbuilt.md.';
    });
    $('copyMd').addEventListener('click', function () {
      var md = C.toMarkdown(S.decl, state());
      var done = function () { $('outMsg').textContent = 'Markdown copied.'; };
      var fallback = function () {
        $('mdDetails').open = true; $('mdPreview').textContent = md;
        var range = document.createRange(); range.selectNodeContents($('mdPreview'));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        $('outMsg').textContent = 'This browser did not allow copying from the page: the Markdown is selected in the preview below.';
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(done, fallback);
        else fallback();
      } catch (e) { fallback(); }
    });
    $('mdDetails').addEventListener('toggle', refreshPreview);
    $('resumeFile').addEventListener('change', function (ev) {
      readFile(ev.target, function (t) {
        if (t == null) return;
        var r = C.importLedger(t, S.decl);
        if (!r.ok) { $('outMsg').textContent = 'Not resumed: ' + r.refusal.reason + ' ' + r.refusal.what_would_help; return; }
        r.state.shelf.forEach(function (ins) {
          var k = S.shelf.findIndex(function (x) { return x.id === ins.id; });
          if (k >= 0) S.shelf[k] = ins; else S.shelf.push(ins);
        });
        S.entries = {}; Object.keys(r.state.entries).forEach(function (k) { S.entries[k] = cleanDraft(r.state.entries[k]); });
        S.meta = r.state.meta; S.modelled = r.state.modelled; S.modelledFrom = r.state.modelledFrom;
        $('operator').value = S.meta.operator; $('idate').value = S.meta.date; $('remarks').value = S.meta.remarks; $('dateHint').textContent = '';
        saveShelf(); saveLedger(); renderShelf(); buildCards(); updateAll();
        $('outMsg').textContent = 'Resumed the record: ' + Object.keys(S.entries).length + ' entries.';
      });
    });
    $('startOver').addEventListener('click', function () {
      if (!S.decl) return;
      if (!window.confirm('Clear every reading, the operator and the model column for this part? Instruments stay.')) return;
      store.del(ledgerKey());
      loadDecl(S.decl.source.kind === 'template' ? PF.templates[S.key].text : $('paste').value, S.decl.source);
      $('outMsg').textContent = 'Started over.';
    });
    var last = store.get(KEY + '.last');
    chooseTemplate(last && (last === PASTE || PF.templates[last]) ? last : 'bulkhead');
  }

  if (!C || !PF) {
    document.body.insertBefore(el('p', { cls: 'refusal', text: 'The ledger\'s scripts did not load (snapshots/partforge.js and ledger.js must sit beside this page).' }), document.body.firstChild);
    return;
  }
  init();
})();
