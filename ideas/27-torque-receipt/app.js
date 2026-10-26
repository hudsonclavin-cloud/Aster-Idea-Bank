/* Torque Receipt — the page. Everything numeric comes from torque.js and the snapshots. */
(function () {
  'use strict';
  var TR = window.TorqueReceipt;
  var D = window.TorqueData || {};
  var $ = function (id) { return document.getElementById(id); };
  var ctx = TR.makeContext({ fasteners_metric: D.fasteners_metric, design_factors_nasa: D.design_factors_nasa, fasteners_un: D.fasteners_un, endcap: D.endcap, code: D.code, evaluation: D.evaluation });
  var PRESETS = TR.presets(ctx);
  var activePreset = null;
  var lastResult = null;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'cls') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function opt(sel, value, label) { var o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); return o; }
  function numOrNull(id) { var v = $(id).value.trim(); return v === '' ? null : v; }

  /* ---------------- selects ---------------- */
  function fillSizes() {
    var s = $('size');
    var gm = el('optgroup', { label: 'Metric coarse (fasteners_metric.json)' });
    var gu = el('optgroup', { label: 'Unified inch (fasteners_un.json)' });
    TR.sizes(ctx).forEach(function (z) {
      var o = document.createElement('option'); o.value = z.key; o.textContent = z.label;
      (z.system === 'metric' ? gm : gu).appendChild(o);
    });
    s.appendChild(gm); s.appendChild(gu);
  }
  function fillMaterials() {
    var m = $('material');
    var mats = ctx.code.FLIGHT_MATERIALS;
    Object.keys(mats).forEach(function (k) { if (mats[k].kind === 'metal') opt(m, k, mats[k].name); });
  }
  function refreshDependent(keep) {
    var size = TR.findSize(ctx, $('size').value);
    var g = $('grade'), c = $('condition'), n = $('nut');
    var gv = keep && keep.grade != null ? keep.grade : g.value;
    var cv = keep && keep.condition != null ? keep.condition : c.value;
    var nv = keep && keep.nut != null ? keep.nut : n.value;
    g.textContent = ''; c.textContent = ''; n.textContent = '';
    TR.gradesFor(ctx, size).forEach(function (x) { opt(g, x.key, x.label); });
    TR.conditionsFor(size).forEach(function (x) { opt(c, x.key, x.label); });
    if (size && size.system === 'un') { opt(n, 'hex', 'hex nut (table: recall)'); }
    else { opt(n, 'iso4032', 'ISO 4032 hex nut'); opt(n, 'nyloc', 'nylon-insert nut (table: recall)'); opt(n, 'jam', 'ISO 4035 jam nut (table: recall)'); }
    opt(n, 'declared', 'declare the height');
    setIf(g, gv); setIf(c, cv); setIf(n, nv);
  }
  function setIf(sel, v) { for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) { sel.value = v; return true; } return false; }

  /* ---------------- form <-> input ---------------- */
  function readInput() {
    var joint = document.querySelector('input[name="joint"]:checked').value;
    var inp = {
      size: $('size').value, grade: $('grade').value,
      declared: { proof_MPa: numOrNull('dProof'), yield_MPa: numOrNull('dYield'), uts_MPa: numOrNull('dUts'), source: $('dSource').value },
      torque_Nm: numOrNull('torque'), byFeel: $('byFeel').checked,
      condition: $('condition').value, K_pick: (document.querySelector('input[name="kpick"]:checked') || {}).value || 'mid',
      K: numOrNull('kVal'), K_source: $('kSource').value, lubricated: $('kLub').checked,
      Fext_N: numOrNull('fext'), Fext_source: $('fextSrc').value,
      joint: joint, screw_len_mm: numOrNull('len'), stack_mm: numOrNull('stack'),
    };
    if (joint === 'nut') {
      inp.nut = $('nut').value; inp.nut_h_mm = numOrNull('nutH'); inp.nut_h_source = $('nutSrc').value;
      inp.washer_head = $('wHead').checked; inp.washer_nut = $('wNut').checked;
    } else {
      inp.engagement_mm = numOrNull('engage'); inp.material = $('material').value; inp.washer_head = $('wHeadTap').checked;
    }
    return inp;
  }
  function setVal(id, v) { $(id).value = v == null ? '' : String(v); }
  function applyInput(inp) {
    $('size').value = inp.size;
    refreshDependent({ grade: inp.grade, condition: inp.condition, nut: inp.nut || '' });
    var d = inp.declared || {};
    setVal('dProof', d.proof_MPa); setVal('dYield', d.yield_MPa); setVal('dUts', d.uts_MPa); setVal('dSource', d.source);
    setVal('torque', inp.torque_Nm); $('byFeel').checked = !!inp.byFeel;
    var kp = document.querySelector('input[name="kpick"][value="' + (inp.K_pick || 'mid') + '"]'); if (kp) kp.checked = true;
    setVal('kVal', inp.K); setVal('kSource', inp.K_source); $('kLub').checked = !!inp.lubricated;
    setVal('fext', inp.Fext_N); setVal('fextSrc', inp.Fext_source);
    var j = document.querySelector('input[name="joint"][value="' + (inp.joint || 'nut') + '"]'); if (j) j.checked = true;
    setVal('len', inp.screw_len_mm); setVal('stack', inp.stack_mm);
    $('wHead').checked = !!inp.washer_head; $('wNut').checked = !!inp.washer_nut; $('wHeadTap').checked = !!inp.washer_head;
    setVal('nutH', inp.nut_h_mm); setVal('nutSrc', inp.nut_h_source);
    setVal('engage', inp.engagement_mm); if (inp.material) setIf($('material'), inp.material);
  }
  function syncVisibility() {
    var size = TR.findSize(ctx, $('size').value);
    $('declaredGrade').hidden = $('grade').value !== 'declared';
    var cond = $('condition').value;
    $('declaredK').hidden = cond !== 'declared';
    var tt = null;
    if (size && cond !== 'declared') {
      var kr = size.system === 'metric' ? ctx.metricK[cond] : ctx.unK[cond];
      tt = kr || null;
    }
    $('kPickRow').hidden = !(tt && tt.lo !== tt.hi);
    $('torque').disabled = $('byFeel').checked;
    var joint = document.querySelector('input[name="joint"]:checked').value;
    $('nutFields').hidden = joint !== 'nut';
    $('tapFields').hidden = joint !== 'tapped';
    $('declaredNut').hidden = !(joint === 'nut' && $('nut').value === 'declared');
    $('jointHint').textContent = joint === 'nut'
      ? 'Protrusion = length − (stack + washers + nut height), against two thread pitches.'
      : 'Length and stack are optional here; with both, the engagement is held to what the screw actually reaches.';
  }

  /* ---------------- icons and stamps ---------------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function icon(state) {
    var s = svg('svg', { viewBox: '0 0 20 20', class: 'icon', 'aria-hidden': 'true' });
    if (state === 'over') { s.appendChild(svg('path', { d: 'M6 1h8l5 5v8l-5 5H6l-5-5V6z', class: 'crit' })); s.appendChild(svg('rect', { x: 9, y: 4.5, width: 2, height: 7, class: 'glyph' })); s.appendChild(svg('rect', { x: 9, y: 13.5, width: 2, height: 2, class: 'glyph' })); }
    else if (state === 'warn') { s.appendChild(svg('path', { d: 'M10 1.5l9 16.5H1z', class: 'warn' })); s.appendChild(svg('rect', { x: 9, y: 7, width: 2, height: 6, class: 'glyph-dark' })); s.appendChild(svg('rect', { x: 9, y: 14.5, width: 2, height: 2, class: 'glyph-dark' })); }
    else if (state === 'refused') { s.appendChild(svg('circle', { cx: 10, cy: 10, r: 8, class: 'neutral' })); s.appendChild(svg('path', { d: 'M4.5 15.5l11-11', class: 'neutral' })); }
    else { s.appendChild(svg('circle', { cx: 10, cy: 10, r: 8, class: 'neutral' })); s.appendChild(svg('circle', { cx: 10, cy: 10, r: 2.5, class: 'neutral' })); }
    return s;
  }
  function stamps(sec) {
    var w = el('span', { cls: 'stamps' });
    if (sec.status === 'refused') { w.appendChild(el('span', { cls: 'stamp refused', text: 'refused' })); return w; }
    w.appendChild(el('span', { cls: 'stamp computed', text: 'computed' }));
    if (sec.word) {
      var st = el('span', { cls: 'stamp ' + (sec.state === 'over' ? 'over' : sec.state === 'warn' ? 'warn' : 'ok') });
      if (sec.state === 'over' || sec.state === 'warn') st.appendChild(icon(sec.state));
      st.appendChild(document.createTextNode(sec.word));
      w.appendChild(st);
    }
    if (sec.recallInput) w.appendChild(el('span', { cls: 'stamp recall', text: 'uses a recall field' }));
    return w;
  }
  function refusalBox(rf) {
    return el('div', { cls: 'refusal' }, [
      el('p', null, [el('code', { text: rf.code }), ' ', rf.reason]),
      el('p', { cls: 'help', text: 'What would help: ' + rf.what_would_help }),
    ]);
  }
  function item(name, sec, val, details, why) {
    var row = el('div', { cls: 'item-row' }, [el('span', { cls: 'item-name', text: name }), sec ? stamps(sec) : null]);
    var box = el('div', { cls: 'item' }, [row]);
    if (sec && sec.status === 'refused') { box.appendChild(refusalBox(sec.refusal)); return box; }
    if (val) box.appendChild(el('div', { cls: 'item-row' }, [el('span', { cls: 'item-val', text: val })]));
    (details || []).forEach(function (d) { if (d) box.appendChild(el('p', { cls: 'detail', text: d })); });
    (why || []).forEach(function (d) { if (d) box.appendChild(el('p', { cls: 'why', text: d })); });
    return box;
  }

  /* ---------------- chart ---------------- */
  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = [1, 2, 2.5, 5, 10].find(function (k) { return k * p >= raw; });
    return m * p;
  }
  function kN(F) { var v = F / 1000; return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' kN'; }
  function drawChart(r) {
    var host = $('chart');
    host.textContent = '';
    $('legend').textContent = '';
    if (!r || !r.ok) { host.appendChild(el('p', { cls: 'small', text: 'Nothing to draw: the fastener could not be resolved.' })); return; }
    var W = Math.max(280, Math.round(host.clientWidth || 600)), H = 142;
    var g = r.grade, As = r.size.As_mm2, S = r.sections;
    var Fp = g.proofLoad_N, Fy = g.yield_MPa * As, Fu = g.uts_MPa * As;
    var have = S.preload.status === 'computed';
    var svcOn = have && S.service && S.service.status === 'computed' && S.service.Fext_N > 0;
    var top = Math.max(Fu, have ? S.preload.F_max_N : 0, svcOn ? S.service.F_N : 0);
    var step = niceStep(top * 1.05, W < 420 ? 4 : 6);
    var xmax = Math.ceil(top * 1.05 / step) * step;
    var L = 10, R = 10, x = function (F) { return L + (W - L - R) * F / xmax; };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
      'aria-label': have ? ('Preload scatter ' + kN(S.preload.F_min_N) + ' to ' + kN(S.preload.F_max_N) + ' against proof ' + kN(Fp) + ', yield ' + kN(Fy) + ', UTS ' + kN(Fu) + (svcOn ? '; with the external load ' + kN(S.service.F_N) : '')) : 'No preload: proof ' + kN(Fp) + ', yield ' + kN(Fy) + ', UTS ' + kN(Fu) });
    // target band
    s.appendChild(svg('rect', { x: x(ctx.band.lo * Fp), y: 46, width: x(ctx.band.hi * Fp) - x(ctx.band.lo * Fp), height: 68, class: 'band' }));
    // reference lines with labels on their own rows
    [['proof', Fp, 12, 'ref proof'], ['yield', Fy, 25, 'ref'], ['UTS', Fu, 38, 'ref']].forEach(function (t) {
      var X = x(t[1]);
      s.appendChild(svg('line', { x1: X, x2: X, y1: t[2] + 4, y2: 118, class: t[3] }));
      var anchor = X < 60 ? 'start' : X > W - 60 ? 'end' : 'middle';
      var tx = svg('text', { x: anchor === 'start' ? X - 2 : anchor === 'end' ? X + 2 : X, y: t[2], 'text-anchor': anchor });
      tx.textContent = t[0] + ' ' + kN(t[1]);
      s.appendChild(tx);
    });
    // axis and ticks
    s.appendChild(svg('line', { x1: L, x2: W - R, y1: 118, y2: 118, class: 'axis' }));
    for (var v = 0; v <= xmax + 1e-9; v += step) {
      var X = x(v);
      s.appendChild(svg('line', { x1: X, x2: X, y1: 118, y2: 122, class: 'tick' }));
      var tt = svg('text', { x: X, y: 135, 'text-anchor': v === 0 ? 'start' : v >= xmax - 1e-9 ? 'end' : 'middle' });
      tt.textContent = (v / 1000).toFixed(step < 1000 ? (step < 100 ? 2 : 1) : 0);
      s.appendChild(tt);
    }
    var hits = [];
    if (have) {
      var p = S.preload;
      var x0 = x(p.F_min_N), x1 = x(p.F_max_N);
      s.appendChild(svg('rect', { x: x0, y: 58, width: Math.max(2, x1 - x0), height: 12, rx: 4, class: 'scatter' }));
      s.appendChild(svg('circle', { cx: x(p.F_nom_N), cy: 64, r: 5, class: 'nominal' }));
      hits.push({ x: x0 - 4, y: 50, w: Math.max(12, x1 - x0 + 8), h: 28, tip: 'Preload scatter ' + TR.fmtN(p.F_min_N) + ' – ' + TR.fmtN(p.F_max_N) + ' (±' + Math.round(r.tightening.u * 100) + ' %), nominal ' + TR.fmtN(p.F_nom_N) + ' = ' + (p.ratio_proof * 100).toFixed(1) + ' % of proof' });
      if (svcOn) {
        var xs = x(S.service.F_N);
        s.appendChild(svg('line', { x1: x1, x2: xs, y1: 92, y2: 92, class: 'svc-line' }));
        s.appendChild(svg('line', { x1: x1, x2: x1, y1: 70, y2: 92, class: 'svc-line', 'stroke-dasharray': '2 3' }));
        s.appendChild(svg('circle', { cx: xs, cy: 92, r: 5, class: 'svc' }));
        hits.push({ x: x1 - 4, y: 82, w: Math.max(12, xs - x1 + 10), h: 22, tip: 'Highest preload + external load ' + TR.fmtN(S.service.Fext_N) + ' = ' + TR.fmtN(S.service.F_N) + ', σ ' + TR.fmtMPa(S.service.sigma_MPa) + ' (upper bound, C = 1)' });
      }
    } else {
      var nt = svg('text', { x: W / 2, y: 80, 'text-anchor': 'middle', class: 'none' });
      nt.textContent = 'No preload to draw: ' + (S.preload.refusal.missing.indexOf('torque_Nm') >= 0 ? 'no torque' : 'refused');
      s.appendChild(nt);
    }
    hits.push({ x: x(ctx.band.lo * Fp), y: 100, w: Math.max(12, x(ctx.band.hi * Fp) - x(ctx.band.lo * Fp)), h: 14, tip: 'Target ' + ctx.band.lo + '–' + ctx.band.hi + ' × proof = ' + TR.fmtN(ctx.band.lo * Fp) + ' – ' + TR.fmtN(ctx.band.hi * Fp) + ' (fasteners_metric design rule)' });
    hits.forEach(function (h) {
      var hr = svg('rect', { x: h.x, y: h.y, width: h.w, height: h.h, class: 'hit', tabindex: '0', 'data-tip': h.tip, 'aria-label': h.tip });
      s.appendChild(hr);
    });
    host.appendChild(s);
    var lg = $('legend');
    var li = function (cls, text) { lg.appendChild(el('li', null, [el('span', { cls: 'key ' + cls, 'aria-hidden': 'true' }), text])); };
    if (have) li('scatter', 'preload scatter, dot at nominal');
    if (svcOn) li('svc', '+ external load (upper bound)');
    li('band', 'target ' + ctx.band.lo + '–' + ctx.band.hi + ' × proof');
    li('proof', 'proof, yield, UTS of the bolt');
  }
  function bindTips() {
    var tip = $('tip'), card = tip.parentNode;
    function show(t) {
      var tx = t.getAttribute('data-tip'); if (!tx) return;
      tip.textContent = tx; tip.hidden = false;
      var cr = card.getBoundingClientRect(), tr = t.getBoundingClientRect();
      var left = Math.min(Math.max(4, tr.left - cr.left), cr.width - tip.offsetWidth - 4);
      tip.style.left = left + 'px'; tip.style.top = (tr.bottom - cr.top + 6) + 'px';
    }
    function hide() { tip.hidden = true; }
    $('chart').addEventListener('pointerover', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-tip')) show(e.target); });
    $('chart').addEventListener('pointerout', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-tip')) hide(); });
    $('chart').addEventListener('focusin', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-tip')) show(e.target); });
    $('chart').addEventListener('focusout', hide);
  }

  /* ---------------- render ---------------- */
  function pct(x) { return (x * 100).toFixed(1) + ' %'; }
  function render() {
    syncVisibility();
    var inp = readInput();
    var r = TR.receipt(ctx, inp);
    lastResult = r;
    var hd = $('headline'); hd.textContent = ''; hd.className = 'headline';
    var rc = $('receipt'); rc.textContent = '';
    if (!r.ok) {
      hd.classList.add('refused');
      hd.appendChild(icon('refused'));
      hd.appendChild(el('div', null, [el('p', { cls: 'kicker', text: 'Refused · ' + r.refusal.code }), el('p', { text: r.refusal.reason })]));
      rc.appendChild(el('p', { cls: 'rc-head', text: 'Receipt' }));
      rc.appendChild(refusalBox(r.refusal));
      drawChart(r);
      $('sweep').hidden = true; $('today').hidden = true;
      return;
    }
    var h = r.headline;
    hd.classList.add(h.state);
    hd.appendChild(icon(h.state));
    hd.appendChild(el('div', null, [el('p', { cls: 'kicker', text: h.state === 'refused' ? 'Refused' : 'Computed · ' + (h.state === 'over' ? 'exceeds a limit' : h.state === 'warn' ? 'check' : 'within proof') }), el('p', { text: h.text })]));
    drawChart(r);

    var g = r.grade, z = r.size, t = r.tightening, S = r.sections;
    rc.appendChild(el('p', { cls: 'rc-head', text: 'Receipt' }));
    rc.appendChild(el('p', { cls: 'rc-title', text: z.key + ' · ' + g.label + ' · ' + t.condition.label }));
    rc.appendChild(item('Fastener', null, 'As ' + z.As_mm2 + ' mm² · d ' + z.d_mm + ' mm · p ' + z.p_mm + ' mm', null, [z.asSrc, z.dSrc]));
    rc.appendChild(item('Grade', null, 'proof ' + g.proof_MPa + ' · yield ' + g.yield_MPa + ' · UTS ' + g.uts_MPa + ' MPa',
      ['proof load ' + TR.fmtN(g.proofLoad_N) + ' = As × proof' + (g.proofLoadColumn ? ' (table column ' + g.proofLoadColumn.field + ': ' + TR.fmtN(g.proofLoadColumn.N) + ')' : '')],
      [g.source + ' [' + g.confidence + ']']));
    rc.appendChild(item('Nut factor', null, 'K ' + t.K + (t.Krange.lo !== t.Krange.hi ? ' (' + t.Kpick + ' of ' + t.Krange.lo + '–' + t.Krange.hi + ')' : ''), t.notes, [t.Ksrc + ' [' + t.Kconf + ']']));
    rc.appendChild(item('Preload scatter', null, '±' + Math.round(t.u * 100) + ' %', null,
      [t.uSrc + ': "' + t.uRow.quote + '"', 'Spaceflight criteria, used as the table uses them: a citable floor, not a requirement an amateur rocket must meet.']));
    var w = S.window;
    rc.appendChild(item('Torque window', null, TR.fmtNm(w.T_lo_Nm) + ' – ' + TR.fmtNm(w.T_hi_Nm),
      ['at K ' + t.K + ' this puts the nominal preload at ' + ctx.band.lo + '–' + ctx.band.hi + ' × proof (' + TR.fmtNm(w.T_mid_Nm) + ' at 0.70); at most ' + TR.fmtNm(w.T_cap_Nm) + ' keeps the top of the ±' + Math.round(t.u * 100) + ' % scatter at or below proof.'],
      [ctx.band.src + ': "' + ctx.band.quote + '"']));
    if (S.preload.status === 'computed') {
      var p = S.preload;
      rc.appendChild(item('Preload', p, 'F = T/(K·d) = ' + TR.fmtN(p.F_nom_N),
        ['T ' + TR.fmtNm(p.T_Nm) + (p.T_lbfin ? ' (' + p.T_lbfin.toFixed(1) + ' lbf·in)' : '') + ' → ' + pct(p.ratio_proof) + ' of proof; scatter ' + TR.fmtN(p.F_min_N) + ' – ' + TR.fmtN(p.F_max_N),
          p.Ksens ? 'across the table\'s K range: ' + TR.fmtN(p.Ksens.F_at_Klo) + ' at K ' + p.Ksens.K_lo + ', ' + TR.fmtN(p.Ksens.F_at_Khi) + ' at K ' + p.Ksens.K_hi : null],
        [p.formula]));
      var a = S.assembly;
      rc.appendChild(item('At assembly (top of the scatter)', a, 'σ = ' + TR.fmtMPa(a.sigma_MPa),
        ['SF ' + a.sf_proof.toFixed(2) + ' on proof · ' + a.sf_yield.toFixed(2) + ' on yield · ' + a.sf_uts.toFixed(2) + ' on UTS'], [a.formula + ' — proof, yield and UTS are printed separately because confusing them inflates a margin by 10–40 %.']));
      var sv = S.service;
      if (sv.status === 'computed') {
        rc.appendChild(item('In service (upper bound)', sv, 'σ = ' + TR.fmtMPa(sv.sigma_MPa),
          ['F_ext ' + TR.fmtN(sv.Fext_N) + ' per bolt; SF ' + sv.sf_proof.toFixed(2) + ' on proof · ' + sv.sf_yield.toFixed(2) + ' on yield · ' + sv.sf_uts.toFixed(2) + ' on UTS; the external load alone is ' + TR.fmtMPa(sv.sigma_ext_only_MPa)],
          ['load from: ' + sv.FextSrc, sv.formula]));
      } else rc.appendChild(item('In service', sv));
    } else {
      rc.appendChild(item('Preload', S.preload));
      rc.appendChild(item('At assembly / in service', S.assembly));
    }
    if (S.protrusion) {
      var q = S.protrusion;
      rc.appendChild(q.status === 'computed'
        ? item('Protrusion past the nut', q, q.protrusion_mm.toFixed(2) + ' mm vs 2p = ' + q.need_mm.toFixed(2) + ' mm',
            [q.formula + (q.shortBy_mm > 0 ? '; short by ' + q.shortBy_mm.toFixed(2) + ' mm' : '') + '; shortest screw ' + q.minLen_mm.toFixed(2) + ' mm'],
            ['nut: ' + q.nutLabel + ', ' + q.nut_h_mm + ' mm, ' + q.nutSrc, q.washers ? 'washer ' + q.washer_t_mm + ' mm, ' + q.washerSrc : null, q.rule])
        : item('Protrusion past the nut', q));
    }
    if (S.engagement) {
      var e = S.engagement;
      if (e.status === 'computed') {
        rc.appendChild(item('Thread in the tapped part', e, 'strip ' + TR.fmtN(e.tc.F_strip_N) + ' vs bolt ' + TR.fmtN(e.tc.F_bolt_N),
          ['Le ' + e.Le_mm + ' mm in ' + e.materialName + ' (σu ' + e.su_MPa + ' MPa); threadCheck wants ≥ ' + e.tc.Le_req_mm.toFixed(1) + ' mm to strip after the bolt and its ' + e.tc.rule_multiple + 'd rule ≥ ' + e.tc.Le_min_rule_mm.toFixed(1) + ' mm',
            e.worst ? 'strip capacity / worst bolt load (' + e.worst.what + ' ' + TR.fmtN(e.worst.F_N) + ') = ' + e.strip_over_worst.toFixed(2) : null,
            e.tableMin ? 'table minimum ' + e.tableMin.mm + ' mm: ' + e.tableMin.src : null].concat(e.notes),
          [e.formula]));
      } else rc.appendChild(item('Thread in the tapped part', e));
    }
    r.notes.forEach(function (n) { rc.appendChild(el('p', { cls: 'why', text: n })); });

    renderSweep(inp);
    renderToday();
  }

  function renderSweep(inp) {
    var box = $('sweep'); box.textContent = '';
    if (inp.byFeel || inp.torque_Nm == null || !(+inp.torque_Nm > 0)) { box.hidden = true; return; }
    var rows = TR.conditionSweep(ctx, inp);
    if (!rows.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('h2', { text: 'Same torque, every thread condition the table gives a K for' }));
    var tb = el('table');
    tb.appendChild(el('thead', null, [el('tr', null, [el('th', { text: 'Condition' }), el('th', { cls: 'num', text: 'K' }), el('th', { cls: 'num', text: '±' }), el('th', { cls: 'num', text: 'F nominal' }), el('th', { cls: 'num', text: 'of proof' }), el('th', { cls: 'num', text: 'σ at top' }), el('th', { text: '' })])]));
    var body = el('tbody');
    rows.forEach(function (s) {
      if (!s.ok) { body.appendChild(el('tr', null, [el('td', { text: s.label }), el('td', { colspan: '6', text: 'refused' })])); return; }
      var st = el('span', { cls: 'stamp ' + (s.state === 'over' ? 'over' : 'ok') }); st.textContent = s.word;
      body.appendChild(el('tr', { cls: s.key === inp.condition ? 'current' : '' }, [el('td', { text: s.label + (s.key === inp.condition ? ' (this receipt)' : '') }), el('td', { cls: 'num', text: String(s.K) }), el('td', { cls: 'num', text: Math.round(s.u * 100) + ' %' }),
        el('td', { cls: 'num', text: TR.fmtN(s.F_nom_N) }), el('td', { cls: 'num', text: pct(s.ratio) }), el('td', { cls: 'num', text: TR.fmtMPa(s.sigma_max_MPa) }), el('td', null, [st])]));
    });
    tb.appendChild(body);
    box.appendChild(el('div', { cls: 'table-wrap' }, [tb]));
    box.appendChild(el('p', { cls: 'small', text: 'Mid K of each range. The scatter column is the NASA-STD-5020B row for lubricated at assembly (±25 %) or not (±35 %).' }));
  }

  function renderToday() {
    var box = $('today'); box.textContent = '';
    if (!activePreset || !/^(endcap|endcap-dry|by-feel)$/.test(activePreset)) { box.hidden = true; return; }
    var t = TR.endcapToday(ctx), e = TR.readEndcap(ctx);
    box.hidden = false;
    box.appendChild(el('h2', { text: 'The same joint, as PartForge checks it today' }));
    box.appendChild(el('p', { text: 'tests/dryrun/endcap.scad:' + e.lines.bolt_shear + ' declares the pressure load on the cap, ' + e.bolt_shear.force_N + ' N over ' + e.bolt_shear.n + ' bolts, as bolt_shear. Run through PartForge\'s own boltShear() and GRADE_SY (cut verbatim from index.html), that row reports shear SF ' + t.r.sf_shear.toFixed(2) + ' and bearing SF ' + t.r.sf_bearing.toFixed(2) + ' against its sf_min ' + t.sf_min + ', so it ' + (t.passes ? 'passes' : 'fails') + '.' }));
    box.appendChild(el('p', { text: 'The load is axial: it pulls the bolts in tension. The fixture\'s own assembly note (line ' + e.lines.torque + ', "' + e.quote + '") puts the top of the preload scatter past proof before the tank is pressurised, which no shear check can see. PartForge\'s loads whitelist has no tension kind (index.html:4733), so there is nowhere to declare it.' }));
    box.appendChild(el('p', { cls: 'small', text: 'Line ' + e.lines.perBolt + ' of the fixture: "' + e.perBoltText + '"' }));
  }

  /* ---------------- wiring ---------------- */
  function setPreset(name) {
    var p = PRESETS[name]; if (!p) return;
    activePreset = name;
    applyInput(JSON.parse(JSON.stringify(p.input)));
    markPresets();
    render();
  }
  function markPresets() {
    Array.prototype.forEach.call(document.querySelectorAll('.presets button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-preset') === activePreset)); });
  }
  function init() {
    fillSizes(); fillMaterials();
    $('size').value = 'M8';
    refreshDependent();
    var form = $('form');
    form.addEventListener('input', function (e) {
      if (e.target.id === 'size') refreshDependent();
      activePreset = null; markPresets();
      render();
    });
    form.addEventListener('change', function (e) {
      if (e.target.id === 'size') refreshDependent();
      activePreset = null; markPresets();
      render();
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    Array.prototype.forEach.call(document.querySelectorAll('.presets button'), function (b) {
      b.addEventListener('click', function () { setPreset(b.getAttribute('data-preset')); });
    });
    bindTips();
    var q = /[?&]preset=([\w-]+)/.exec(location.search || '');
    setPreset(q && PRESETS[q[1]] ? q[1] : 'endcap');
    var prov = $('prov');
    prov.textContent = 'Data: PartForge at ' + String(ctx.code.commit).slice(0, 7) + ' — data/tables/fasteners_metric.json, design_factors_nasa.json and an excerpt of fasteners_un.json; tests/dryrun/endcap.scad; threadCheck, boltShear, FLIGHT_MATERIALS, matClass and GRADE_SY cut verbatim from index.html (lines ' + ctx.code.cuts.map(function (c) { return c.from + (c.to !== c.from ? '–' + c.to : ''); }).join(', ') + '); docs/roadmap-evaluation.md lines ' + D.evaluation.lines.map(function (l) { return l.line; }).join(', ') + '. Each file under snapshots/ has a provenance sidecar.';
    var rz = null;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (lastResult) drawChart(lastResult); }, 80); });
  }
  init();
})();
