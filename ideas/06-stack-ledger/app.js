/* app.js: draws Stack Ledger from stack.js (StackLedger), examples.js (StackExamples) and the PartForge
   snapshot module. No network, no storage. */
(function () {
  'use strict';
  var S = window.PartForgeSnapshot, L = window.StackLedger, E = window.StackExamples;
  var ctx = L.create(S, { tables: 'snapshots', commit: S.provenance.commit, verbatim: S.verbatim.firstLine + '-' + S.verbatim.lastLine });
  var examples = E.build(S);
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    preset: $('preset'), presetWhy: $('presetWhy'), reload: $('reload'), json: $('stackJson'), parseError: $('parseError'), compute: $('compute'),
    ledger: $('ledger'), vword: $('vword'), vgap: $('vgap'), vreason: $('vreason'), figs: $('figs'), lineWrap: $('lineWrap'), svg: $('numberLine'), rssLine: $('rssLine'), thermalLine: $('thermalLine'),
    refusals: $('refusals'), refList: $('refList'), crows: $('crows'), flags: $('flags'), mesh: $('mesh'), ledgerText: $('ledgerText'), prov: $('prov'),
  };
  var MINUS = '−';
  function f3(x) { if (x == null || !isFinite(x)) return '—'; var s = Math.abs(x).toFixed(3); return (x < 0 && Number(s) !== 0 ? MINUS : '') + s; }
  function sgn(x) { if (x == null || !isFinite(x)) return '—'; var s = Math.abs(x).toFixed(3); return (x < 0 && Number(s) !== 0 ? MINUS : '+') + s; }
  function text(node, s) { node.textContent = s; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function mk(tag, cls, s) { var n = document.createElement(tag); if (cls) n.className = cls; if (s != null) n.textContent = s; return n; }
  function svgEl(tag, attrs) { var n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }

  var current = null;   // last result, for resize redraws

  // ---- presets ---------------------------------------------------------------------------------
  examples.forEach(function (ex) {
    var o = document.createElement('option');
    o.value = ex.id;
    o.textContent = ex.title;
    el.preset.appendChild(o);
  });
  function loadPreset(id) {
    var ex = E.byId(examples, id) || examples[0];
    el.preset.value = ex.id;
    text(el.presetWhy, ex.why);
    el.json.value = JSON.stringify(ex.stack, null, 2);
    compute();
  }
  el.preset.addEventListener('change', function () { loadPreset(el.preset.value); });
  el.reload.addEventListener('click', function () { loadPreset(el.preset.value); });
  el.compute.addEventListener('click', compute);
  var timer = null;
  el.json.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(compute, 180); });

  // ---- compute ----------------------------------------------------------------------------------
  function compute() {
    var p = L.parseStack(el.json.value);
    if (p.error) {
      el.parseError.hidden = false;
      text(el.parseError, p.error);
      return;                       // keep the last ledger on screen while the JSON is being edited
    }
    el.parseError.hidden = true;
    var res = L.stackUp(ctx, p.stack);
    current = res;
    render(res);
  }

  // ---- render -----------------------------------------------------------------------------------
  var VERDICT = {
    PASS: { word: 'PASS', cls: 'pass' },
    FAIL: { word: 'FAIL', cls: 'fail' },
    REFUSED: { word: 'REFUSED', cls: 'refused' },
    NO_REQUIREMENT: { word: 'NOT GATED', cls: 'none' },
  };
  function fig(k, v, n, cls) {
    var d = mk('div', 'fig' + (cls ? ' ' + cls : ''));
    d.appendChild(mk('span', 'k', k));
    d.appendChild(mk('span', 'v', v));
    if (n) d.appendChild(mk('span', 'n', n));
    return d;
  }

  function render(res) {
    var v = VERDICT[res.verdict] || VERDICT.REFUSED;
    el.ledger.className = 'card verdict ' + v.cls;
    text(el.vword, v.word);
    text(el.vgap, '· ' + res.gap_name);
    text(el.vreason, res.verdict_reasons.join('; ') + '.');
    clear(el.figs);
    if (res.evaluable) {
      var w = res.worst, rq = res.require;
      el.figs.appendChild(fig('worst-case minimum', f3(w.min) + ' mm', rq.min_mm != null ? 'required ≥ ' + f3(rq.min_mm) + (res.margins ? ' · margin ' + sgn(res.margins.to_min) : '') : 'no minimum required', rq.min_mm != null ? (w.min < rq.min_mm ? 'bad' : 'good') : ''));
      el.figs.appendChild(fig('worst-case maximum', f3(w.max) + ' mm', rq.max_mm != null ? 'required ≤ ' + f3(rq.max_mm) + (res.margins ? ' · margin ' + sgn(res.margins.to_max) : '') : 'no maximum required', rq.max_mm != null ? (w.max > rq.max_mm ? 'bad' : 'good') : ''));
      el.figs.appendChild(fig('nominal sum', f3(w.nominal) + ' mm', 'Σ dir × nominal; worst-case width ' + f3(w.width)));
      el.figs.appendChild(fig('contributors', String(res.contributors.length), res.rss ? res.rss.n + ' in the RSS' + (res.thermal ? ', thermal kept out' : '') : 'none in the RSS'));
      el.lineWrap.hidden = false;
      drawLine(res);
      if (res.rss) {
        var r = res.rss;
        clear(el.rssLine);
        el.rssLine.appendChild(mk('b', null, 'RSS, information only'));
        el.rssLine.appendChild(document.createTextNode(' · N = ' + r.n + ' manufacturing contributor' + (r.n > 1 ? 's' : '') + (r.basis_ok ? '' : ' · no statistical basis below N=' + r.min_n) + '. Centre ' + f3(r.centre) + ' mm, the sum of the mid-limit means (' + (Math.abs(r.offset_from_nominal) < 5e-7 ? 'equal to' : sgn(r.offset_from_nominal) + ' from') + ' the nominal sum), ± ' + f3(r.half) + ' → ' + f3(r.low) + ' to ' + f3(r.high) + ' mm, ' + Math.round((1 - r.width_ratio) * 100) + '% narrower than the worst-case band of the same contributors. It assumes independent, centred, normal processes and never gates.'));
      } else text(el.rssLine, 'RSS: no manufacturing contributors.');
      if (res.thermal) {
        clear(el.thermalLine);
        el.thermalLine.appendChild(mk('b', null, 'Thermal'));
        el.thermalLine.appendChild(document.createTextNode(' · ' + sgn(res.thermal.low) + ' to ' + sgn(res.thermal.high) + ' mm over the declared ΔT range, (α_hole − α_shaft)·D·ΔT through dbFitThermal(): deterministic, in the worst case at both ends, not in the RSS.'));
      } else text(el.thermalLine, 'Thermal: none declared.');
    } else {
      el.figs.appendChild(fig('gap', '—', res.refusals.length + ' contributor' + (res.refusals.length > 1 ? 's' : '') + ' refused: no partial sum is printed'));
      el.lineWrap.hidden = true;
      text(el.rssLine, 'RSS: not computed for a refused stack.');
      text(el.thermalLine, '');
    }
    // refusals
    clear(el.refList);
    el.refusals.hidden = !res.refusals.length;
    res.refusals.forEach(function (r) {
      var li = mk('li');
      li.appendChild(mk('span', 'code', r.code));
      li.appendChild(document.createTextNode(' · ' + (r.index >= 0 ? '#' + (r.index + 1) + ' ' : '') + r.reason));
      li.appendChild(mk('p', 'help', 'What would help: ' + r.what_would_help));
      el.refList.appendChild(li);
    });
    // table
    clear(el.crows);
    res.contributors.forEach(function (c, i) {
      var tr = mk('tr', c.refused ? 'refused' : '');
      tr.setAttribute('data-kind', c.kind);
      tr.appendChild(mk('td', null, String(i + 1)));
      tr.appendChild(mk('td', 'dir', c.dir === 1 ? '+' : c.dir === -1 ? MINUS : '?'));
      var nameTd = mk('td');
      nameTd.appendChild(mk('span', 'name', c.name));
      nameTd.appendChild(document.createTextNode(' '));
      nameTd.appendChild(mk('span', 'conf', c.kind));
      if (!c.refused) nameTd.appendChild(mk('span', 'conf ' + c.confidence, c.confidence));
      tr.appendChild(nameTd);
      if (c.refused) {
        var td = mk('td');
        td.colSpan = 4;
        td.appendChild(mk('span', 'code', 'REFUSED ' + c.refused.code));
        td.appendChild(document.createTextNode(' · ' + c.refused.reason));
        tr.appendChild(td);
      } else {
        tr.appendChild(mk('td', 'num', f3(c.low)));
        tr.appendChild(mk('td', 'num', f3(c.high)));
        tr.appendChild(mk('td', 'num', sgn(c.signed.low) + ' .. ' + sgn(c.signed.high)));
        var from = mk('td');
        from.appendChild(mk('div', 'from', c.provenance.text));
        c.flags.forEach(function (f) { from.appendChild(mk('span', 'flag', '• ' + f)); });
        tr.appendChild(from);
      }
      el.crows.appendChild(tr);
    });
    // notes
    clear(el.flags);
    res.flags.forEach(function (f) { el.flags.appendChild(mk('li', null, f)); });
    if (!res.flags.length) el.flags.appendChild(mk('li', null, 'no notes: every contributor is cited or user-declared and the RSS has its N'));
    text(el.mesh, 'Measurable on a mesh: ' + res.measurable_on_mesh + '.');
    text(el.ledgerText, L.ledgerText(res));
  }

  // ---- the number line (inline SVG) ------------------------------------------------------------
  function drawLine(res) {
    var svg = el.svg;
    clear(svg);
    var W = Math.max(280, el.lineWrap.clientWidth || 600), narrow = W < 560, H = narrow ? 156 : 140;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    var w = res.worst, rq = res.require, r = res.rss;
    var vals = [w.min, w.max, w.nominal, 0];
    if (r) vals.push(r.low, r.high);
    if (rq.min_mm != null) vals.push(rq.min_mm);
    if (rq.max_mm != null) vals.push(rq.max_mm);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 1e-9) { lo -= 0.05; hi += 0.05; }
    var pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    var X0 = 12, X1 = W - 12;
    var x = function (v) { return X0 + (v - lo) / (hi - lo) * (X1 - X0); };
    // Three label rows below the axis, so a requirement bound that coincides with the nominal never overprints it:
    // worst-case limits above the band, the nominal under the axis, the requirement bounds under that, the key last.
    var yAxis = 76, yWorst = 54, yRss = 38, yNomLbl = 94, yReqLbl = 110;
    // requirement window
    if (rq.min_mm != null || rq.max_mm != null) {
      var a = rq.min_mm != null ? x(rq.min_mm) : X0, b = rq.max_mm != null ? x(rq.max_mm) : X1;
      svg.appendChild(svgEl('rect', { class: 'req', x: Math.min(a, b), y: 28, width: Math.max(1, Math.abs(b - a)), height: 56, rx: 3 }));
      if (rq.min_mm != null) svg.appendChild(svgEl('text', { class: 'lbl mono', x: a, y: yReqLbl, 'text-anchor': a < X0 + 40 ? 'start' : 'middle' })).textContent = '≥ ' + f3(rq.min_mm);
      if (rq.max_mm != null) svg.appendChild(svgEl('text', { class: 'lbl mono', x: b, y: yReqLbl, 'text-anchor': b > X1 - 40 ? 'end' : 'middle' })).textContent = '≤ ' + f3(rq.max_mm);
    }
    // axis and zero
    svg.appendChild(svgEl('line', { class: 'axis', x1: X0, y1: yAxis, x2: X1, y2: yAxis }));
    if (0 >= lo && 0 <= hi) {
      svg.appendChild(svgEl('line', { class: 'zero', x1: x(0), y1: 22, x2: x(0), y2: 90 }));
      svg.appendChild(svgEl('text', { class: 'lbl', x: x(0), y: 16, 'text-anchor': 'middle' })).textContent = '0';
    }
    // worst-case band
    svg.appendChild(svgEl('line', { class: 'worst', x1: x(w.min), y1: yWorst, x2: Math.max(x(w.max), x(w.min) + 1), y2: yWorst }));
    svg.appendChild(svgEl('text', { class: 'lbl mono', x: x(w.min), y: yWorst - 10, 'text-anchor': x(w.min) < X0 + 40 ? 'start' : 'end' })).textContent = f3(w.min);
    svg.appendChild(svgEl('text', { class: 'lbl mono', x: x(w.max), y: yWorst - 10, 'text-anchor': x(w.max) > X1 - 40 ? 'end' : 'start' })).textContent = f3(w.max);
    // rss band
    if (r) svg.appendChild(svgEl('line', { class: 'rssb', x1: x(r.low), y1: yRss, x2: Math.max(x(r.high), x(r.low) + 1), y2: yRss }));
    // nominal
    var xn = x(w.nominal);
    svg.appendChild(svgEl('line', { class: 'nom', x1: xn, y1: yAxis - 8, x2: xn, y2: yAxis + 8 }));
    svg.appendChild(svgEl('text', { class: 'lbl', x: xn, y: yNomLbl, 'text-anchor': xn < X0 + 50 ? 'start' : xn > X1 - 50 ? 'end' : 'middle' })).textContent = 'nominal ' + f3(w.nominal);
    // key, on one line when there is room and two when there is not
    var parts = ['thick: worst case (gates)', 'dashed: RSS (information)'];
    if (rq.min_mm != null || rq.max_mm != null) parts.push('shaded: requirement');
    parts.push('mm');
    if (narrow) {
      svg.appendChild(svgEl('text', { class: 'key', x: X0, y: H - 22 })).textContent = parts.slice(0, 2).join(' · ');
      svg.appendChild(svgEl('text', { class: 'key', x: X0, y: H - 6 })).textContent = parts.slice(2).join(' · ');
    } else svg.appendChild(svgEl('text', { class: 'key', x: X0, y: H - 6 })).textContent = parts.join(' · ');
  }
  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (current && current.evaluable) drawLine(current); }, 120); });

  // ---- provenance footer -----------------------------------------------------------------------
  (function prov() {
    var p = S.provenance;
    var short = (p.commit || '').slice(0, 7);
    var items = [
      'PartForge ' + p.repo + ' at ' + short + ' (' + (p.commitDate || '').slice(0, 10) + '); all tables read from this folder’s snapshots with provenance sidecars.',
      'dbFit(), dbMaterialThermal(), dbFitThermal(): index.html lines ' + p.index_html.verbatimLines[0] + '–' + p.index_html.verbatimLines[1] + ' at ' + short + ', verbatim (sha256 ' + S.verbatim.sha256.slice(0, 12) + '…), reading the tables through a dbRows() shim.',
      'fits.json, whole (' + p.fits.sourceBytes + ' bytes, sha256 ' + p.fits.sourceSha256.slice(0, 12) + '…): ISO 286 IT grades and deviations derived from the standard’s formulas; five 1–3 mm values withheld and refused here.',
      'materials_thermal.json, whole (' + p.materials_thermal.sourceBytes + ' bytes, sha256 ' + p.materials_thermal.sourceSha256.slice(0, 12) + '…): cte_um_m_K for 21 materials, likely for the metals, recall for the rest; laminate rows refused for a bore until a hoop CTE is supplied.',
      'stock.json, ' + p.stock.rowsKept.length + ' of ' + p.stock.rowsTotal + ' rows verbatim (' + p.stock.rowsKept.join(', ') + '); tolerance_confidence printed, recall never presented as cited.',
      'tests/templates/bulkhead.scad and coupler.scad: the worked examples read their FLIGHT blocks and NOTE lines (sha256 ' + p.bulkhead_scad.sourceSha256.slice(0, 12) + '…, ' + p.coupler_scad.sourceSha256.slice(0, 12) + '…).',
    ];
    clear(el.prov);
    items.forEach(function (s) { el.prov.appendChild(mk('li', null, s)); });
  })();

  // ---- first render (last, so every function above is defined) ----------------------------------
  (function fromQuery() {
    var id = null;
    try { id = new URLSearchParams(window.location.search).get('example'); } catch (e) { /* no query */ }
    loadPreset(E.byId(examples, id) ? id : 'bulkhead-declared');
  })();
})();
