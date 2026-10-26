// Taper Is Not Mass: the page. Draws what model.js computes from the rev_a.json snapshot.
// Holds no tether numbers of its own: every value shown is read from window.REV_A or computed.
(function () {
  'use strict';
  var M = window.TaperModel;
  var canon = M.readCanon(window.REV_A);
  var SVGNS = 'http://www.w3.org/2000/svg';
  // The tip-speed axis and slider span (km/s). A presentation range, not a tether number.
  var V_MIN = 0.5;
  var V_MAX = 4;
  var CUSTOM = 'custom';
  var state = { matId: null, v: null, d: null, sf: null, cSigma: NaN, cRho: NaN, dragging: false, hoverV: null };
  var claimResults = canon.ok ? M.checkClaims(canon) : [];

  function $(id) { return document.getElementById(id); }
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
  function sv(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function code(t) { return el('code', { text: t }); }
  function fx(v, dp) { return isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—'; }
  function pct(f) { return Math.round(f * 1000) / 10 + ' %'; }
  function sup(e) {
    var map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(e).split('').map(function (ch) { return map[ch] || ch; }).join('');
  }
  function sci(v, dp) {
    if (!isFinite(v) || v === 0) return String(v);
    var e = Math.floor(Math.log10(Math.abs(v)));
    return (v / Math.pow(10, e)).toFixed(dp) + ' × 10' + sup(e);
  }
  function ratio(v) {
    var s = M.fmtRatio(v);
    var m = /^(.*) × 10\^(-?\d+)$/.exec(s);
    return m ? m[1] + ' × 10' + sup(m[2]) : s;
  }
  function tonnes(t) {
    if (!isFinite(t)) return '—';
    if (t < 10) return fx(t, 2);
    if (t < 1e7) return fx(t, 1);
    return sci(t, 2);
  }
  function rungName(r) {
    var n = { optimistic: 'Optimistic', baseline: 'Baseline', conservative: 'Conservative', cislunar: 'Cislunar', phase3: 'Phase 3' }[r];
    return n || r;
  }

  // ── Material and evaluation ────────────────────────────────────────────────────────
  function currentMaterial() {
    if (!canon.ok) return null;
    if (state.matId === CUSTOM) {
      return { id: CUSTOM, name: 'Custom fibre', canon: false, sigmaGPa: state.cSigma, rhoKgm3: state.cRho };
    }
    for (var i = 0; i < canon.materials.length; i++) if (canon.materials[i].id === state.matId) return canon.materials[i];
    return canon.materials[0];
  }
  function current() {
    var mat = currentMaterial();
    if (!mat) return { mat: null, ev: { ok: false, refusal: canon.refusal } };
    if (mat.refusal) return { mat: mat, ev: { ok: false, refusal: mat.refusal } };
    var ev = M.evaluate({ vTipKms: state.v, derate: state.d, SF: state.sf, sigmaGPa: mat.sigmaGPa, rhoKgm3: mat.rhoKgm3, payloadKg: canon.payloadKg });
    if (!ev.ok && mat.id === CUSTOM && ev.refusal.code === 'insufficient_data') {
      ev.refusal = { code: 'insufficient_data', reason: 'A custom fibre needs both a tensile strength above 0 GPa and a density above 0 kg/m³.', whatWouldHelp: 'Type both. A custom fibre is not in rev_a.json; its results are a Rule 1 deviation and are marked so.' };
    }
    return { mat: mat, ev: ev };
  }

  // ── Header, notice, controls ───────────────────────────────────────────────────────
  function renderCanonLine() {
    var line = $('canon-line');
    line.textContent = '';
    if (!canon.ok) {
      line.appendChild(document.createTextNode('No canon loaded.'));
      return;
    }
    var p = canon.provenance || {};
    var ladder = canon.ladder.filter(function (r) { return r.status === 'reproduces'; }).length;
    var rounded = canon.rounded.filter(function (r) { return r.status === 'matches as rounded'; }).length;
    line.appendChild(document.createTextNode('Constants: Skyhook '));
    line.appendChild(code('params/rev_a.json'));
    line.appendChild(document.createTextNode(' @ '));
    line.appendChild(el('b', { text: String(p.commit || 'unknown commit').slice(0, 7) }));
    line.appendChild(document.createTextNode(' (sha256 ' + String(p.sourceSha256 || '?').slice(0, 12) + '…), a snapshot. '));
    line.appendChild(el('span', { id: 'canon-count', text: ladder + ' of ' + canon.ladder.length + ' ladder values re-derived within 5 × 10⁻⁴; ' + rounded + ' of ' + canon.rounded.length + ' rounded values match.' }));
  }

  function renderNotice() {
    var n = $('notice');
    if (canon.ok && !canon.notes.length) { n.hidden = true; return; }
    n.hidden = false;
    n.textContent = '';
    if (!canon.ok) {
      n.appendChild(el('h2', { text: 'No canon file, no numbers' }));
      n.appendChild(el('p', { text: canon.refusal.reason }));
      n.appendChild(el('p', { text: 'What would help: ' + canon.refusal.whatWouldHelp }));
      n.appendChild(el('p', { text: 'The equations are below; nothing is evaluated without the file.' }));
    } else {
      n.appendChild(el('h2', { text: 'The canon file is incomplete' }));
      canon.notes.forEach(function (t) { n.appendChild(el('p', { text: t })); });
    }
  }

  function setupControls() {
    var sel = $('material');
    if (!canon.ok) {
      ['material', 'v', 'd', 'sf'].forEach(function (id) { $(id).disabled = true; });
      sel.appendChild(el('option', { text: 'no canon loaded' }));
      ['v-out', 'd-out', 'sf-out'].forEach(function (id) { $(id).textContent = '—'; });
      return;
    }
    canon.materials.forEach(function (m) {
      var t = m.name + (m.refusal ? ' (no density in canon)' : m.primary ? ' (primary fibre)' : '');
      sel.appendChild(el('option', { value: m.id, text: t }));
    });
    sel.appendChild(el('option', { value: CUSTOM, text: 'Custom fibre (not canon)' }));
    var ref = canon.tiers.filter(function (t) { return t.id === 'reference'; })[0];
    state.matId = canon.materials[0].id;
    state.v = ref ? ref.vTipKms : V_MIN;
    state.d = canon.derateFraction !== undefined ? canon.derateFraction : 0;
    state.sf = canon.SF !== undefined ? canon.SF : Number($('sf').min);
    syncInputs();
    sel.addEventListener('change', function () {
      state.matId = sel.value;
      $('custom').hidden = state.matId !== CUSTOM;
      render();
    });
    $('v').addEventListener('input', function () { state.v = Number($('v').value); render(); });
    $('d').addEventListener('input', function () { state.d = Number($('d').value) / 100; render(); });
    $('sf').addEventListener('input', function () { state.sf = Number($('sf').value); render(); });
    ['c-sigma', 'c-rho'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        state.cSigma = parseFloat($('c-sigma').value);
        state.cRho = parseFloat($('c-rho').value);
        render();
      });
    });
    buildSnaps();
  }

  function syncInputs() {
    $('material').value = state.matId;
    $('custom').hidden = state.matId !== CUSTOM;
    $('v').value = String(state.v);
    $('d').value = String(Math.round(state.d * 100));
    $('sf').value = String(state.sf);
  }

  var snaps = [];
  function buildSnaps() {
    var box = $('snaps');
    canon.ladder.filter(function (r) { return r.kind === 'ratio' && !r.duplicate && r.status !== 'refused'; }).forEach(function (r) {
      snaps.push({ id: 'rung:' + r.key, label: rungName(r.rung) + ' · ' + r.vTipKms.toFixed(1) + ' km/s · ' + pct(r.derate), v: r.vTipKms, d: r.derate, sf: r.SF });
    });
    claimResults.forEach(function (cr) {
      var cl = cr.claim;
      if (cl.id === 'ghost440') snaps.push({ id: 'claim:ghost440', label: '440× ghost · ' + cl.inputs.vTipKms.toFixed(1) + ' km/s · 0 %', v: cl.inputs.vTipKms, d: cl.inputs.derate, sf: canon.SF });
      if (cl.id === 'creep72') snaps.push({ id: 'claim:creep72', label: 'Item 10 · SF ' + cl.inputs.SF + ' · ' + pct(cl.inputs.derate), v: canon.vRef, d: cl.inputs.derate, sf: cl.inputs.SF });
    });
    snaps.forEach(function (s) {
      var b = el('button', { type: 'button', 'data-snap': s.id, 'aria-pressed': 'false', text: s.label });
      b.addEventListener('click', function () { applySnap(s); });
      box.appendChild(b);
    });
  }
  function applySnap(s) {
    state.matId = canon.materials[0].id;
    state.v = s.v;
    state.d = s.d;
    state.sf = s.sf;
    syncInputs();
    render();
  }
  function near(a, b) { return Math.abs(a - b) < 1e-9; }
  function updateSnaps() {
    var prim = canon.ok && state.matId === canon.materials[0].id;
    snaps.forEach(function (s) {
      var on = prim && near(state.v, s.v) && near(state.d, s.d) && near(state.sf, s.sf);
      var b = document.querySelector('[data-snap="' + s.id + '"]');
      if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ── Readout ────────────────────────────────────────────────────────────────────────
  function tile(k, v, s, keyColor) {
    var kk = el('div', { cls: 'k' });
    if (keyColor) kk.appendChild(el('span', { cls: 'key', style: 'border-color:' + keyColor }));
    kk.appendChild(document.createTextNode(k));
    return el('div', { cls: 'tile' }, [kk, el('div', { cls: 'v', text: v }), s ? el('div', { cls: 's', text: s }) : null]);
  }

  function renderReadout(cur) {
    var mat = cur.mat;
    var ev = cur.ev;
    $('v-out').textContent = canon.ok ? state.v.toFixed(2) + ' km/s' : '—';
    $('d-out').textContent = canon.ok ? Math.round(state.d * 100) + ' %' : '—';
    $('sf-out').textContent = canon.ok ? state.sf.toFixed(1) : '—';
    var note = $('mat-note');
    note.textContent = '';
    if (mat) {
      if (mat.id === CUSTOM) {
        note.appendChild(el('span', { cls: 'notcanon', text: 'not canon' }));
        note.appendChild(document.createTextNode(' Typed by you, not in rev_a.json (a Rule 1 deviation). Curves are dashed.' + (ev.ok ? ' V_c = ' + fx(ev.Vc, 4) + ' km/s.' : '')));
      } else if (mat.refusal) {
        note.appendChild(document.createTextNode('σ from '));
        note.appendChild(code(mat.sigmaKey));
        note.appendChild(document.createTextNode('; no density in the canon file, so nothing is computed for it (see the refusal below).'));
      } else {
        note.appendChild(document.createTextNode('σ = ' + mat.sigmaGPa + ' GPa ('));
        note.appendChild(code(mat.sigmaKey));
        note.appendChild(document.createTextNode('), ρ = ' + mat.rhoKgm3 + ' kg/m³ ('));
        note.appendChild(code(mat.rhoKey));
        note.appendChild(document.createTextNode(mat.rhoSource === 'note' ? ', read from the note "' + mat.rhoNote + '", not a keyed field)' : ')'));
        if (ev.ok) note.appendChild(document.createTextNode(' → V_c = ' + fx(ev.Vc, 4) + ' km/s by EQ-4.'));
      }
    }

    var tiles = $('tiles');
    tiles.textContent = '';
    var sent = $('sentence');
    sent.textContent = '';
    var rbox = $('refusal');
    if (!ev.ok) {
      ['x', 'Taper, EQ-5', 'Mass ratio, EQ-6', 'Mass ÷ taper', 'v_tip / V_c', 'Fibre mass'].forEach(function (k) { tiles.appendChild(tile(k, '—', null)); });
      sent.textContent = canon.ok ? 'Refused at these settings; no number is shown.' : 'Nothing is computed without params/rev_a.json.';
      rbox.hidden = !canon.ok;
      rbox.textContent = '';
      if (canon.ok) {
        rbox.appendChild(el('h3', { text: 'Refused: ' + ev.refusal.code.replace(/_/g, ' ') }));
        rbox.appendChild(el('p', { text: ev.refusal.reason }));
        rbox.appendChild(el('p', { text: 'What would help: ' + ev.refusal.whatWouldHelp }));
      }
      return;
    }
    rbox.hidden = true;
    var who = mat.id === CUSTOM ? 'a custom fibre (not canon)' : mat.name;
    sent.appendChild(document.createTextNode('At ' + state.v.toFixed(2) + ' km/s, ' + Math.round(state.d * 100) + ' % derate and SF ' + state.sf.toFixed(1) + ' for ' + who + ', the centre of the tether is '));
    sent.appendChild(el('b', { text: ratio(ev.taper) + '×' }));
    sent.appendChild(document.createTextNode(' as thick as its tip, and the tether weighs '));
    sent.appendChild(el('b', { text: ratio(ev.massRatio) + '×' }));
    sent.appendChild(document.createTextNode(' the payload: '));
    if (ev.gap >= 1) {
      sent.appendChild(el('b', { text: fx(ev.gap, 2) + ' times' }));
      sent.appendChild(document.createTextNode(' what reading the taper as a mass ratio would say.'));
    } else {
      sent.appendChild(el('b', { text: (ev.gap > 0 ? fx(1 / ev.gap, 2) : '∞') + ' times less' }));
      sent.appendChild(document.createTextNode(' than the taper. Below x = ' + fx(M.crossoverX(), 3) + ' the taper overstates the mass.'));
    }
    var g = canon.guardrail;
    tiles.appendChild(tile('x', fx(ev.x, 3), '(v/V_c)·√(SF/(1 − derate))'));
    tiles.appendChild(tile('Taper, EQ-5', ratio(ev.taper), 'peak ÷ tip area; ' + ratio(ev.taperNoDerate) + ' with no derate', 'var(--s-taper)'));
    tiles.appendChild(tile('Mass ratio, EQ-6', ratio(ev.massRatio) + '×', 'two-arm tether ÷ payload mass', 'var(--s-mass)'));
    tiles.appendChild(tile('Mass ÷ taper', fx(ev.gap, 2), '= 2√π·x·erf(x)'));
    tiles.appendChild(tile('v_tip / V_c', fx(ev.vOverVc, 3), g ? 'guardrail ' + g.ratio + ' (mass_ratio._ratio_note)' : 'no guardrail in canon'));
    tiles.appendChild(tile('Fibre mass', ev.fibreMassT !== undefined ? tonnes(ev.fibreMassT) + ' t' : '—', ev.fibreMassT !== undefined ? 'at ' + canon.payloadKg.toLocaleString('en-US') + ' kg payload (payload_mass_kg_for_tonnage)' : 'no payload in canon'));
  }

  // ── Chart 1: both curves over tip speed ─────────────────────────────────────────────
  var C = null; // geometry of the last drawn curves chart
  function plotWidth(box) {
    return Math.max(280, Math.round(box.clientWidth || 600));
  }
  function message(box, W, H, lines) {
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': lines.join(' ') });
    svg.appendChild(sv('rect', { x: 0.5, y: 0.5, width: W - 1, height: H - 1, fill: 'none', stroke: 'var(--grid)', rx: 8 }));
    lines.forEach(function (t, i) { svg.appendChild(sv('text', { x: W / 2, y: H / 2 - 8 + i * 18, 'text-anchor': 'middle', class: 'msg' }, t)); });
    box.appendChild(svg);
  }
  function yTickLabel(k) {
    if (k < 0) return String(Math.pow(10, k).toFixed(-k));
    if (k <= 3) return Math.pow(10, k).toLocaleString('en-US');
    return '10' + sup(k);
  }

  function drawCurves(cur) {
    var box = $('plot-curves');
    var focusId = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-mark');
    box.textContent = '';
    var W = plotWidth(box);
    var H = W < 520 ? 300 : 360;
    C = null;
    if (!canon.ok) { message(box, W, H, ['No canon file, no numbers.']); return; }
    if (!cur.ev.ok) { message(box, W, H, ['Refused: ' + cur.ev.refusal.code.replace(/_/g, ' ') + '.', 'Nothing is drawn for this fibre.']); return; }
    var mat = cur.mat;
    var dashed = mat.id === CUSTOM;
    var m = { l: 46, r: 14, t: 42, b: 38 };
    var pw = W - m.l - m.r;
    var ph = H - m.t - m.b;
    var Vc = cur.ev.Vc;
    var N = Math.max(160, Math.round(pw));
    var mass = [];
    var tap = [];
    var vals = [];
    for (var i = 0; i <= N; i++) {
      var v = V_MIN + (V_MAX - V_MIN) * i / N;
      var x = M.xParam(v, Vc, state.sf, state.d);
      var t = M.taperOfX(x);
      var mm = M.massRatioOfX(x, 2);
      mass.push([v, mm]);
      tap.push([v, t]);
      if (isFinite(mm) && mm > 0) vals.push(mm);
      if (isFinite(t) && t > 0) vals.push(t);
    }
    var marks = [];
    canon.ladder.forEach(function (r) {
      if (r.kind !== 'ratio' || r.duplicate || r.status === 'refused') return;
      marks.push({ id: 'rung:' + r.key, kind: 'rung', v: r.vTipKms, y: r.canonValue, status: r.status, d: r.derate, sf: r.SF, label: rungName(r.rung), row: r });
    });
    claimResults.forEach(function (cr) {
      if (cr.claim.id === 'ghost440') marks.push({ id: 'claim:ghost440', kind: 'ghost', curve: 'mass', v: cr.claim.inputs.vTipKms, y: cr.results[0].computed, d: cr.claim.inputs.derate, sf: canon.SF, label: '440×', cr: cr });
      if (cr.claim.id === 'audit360') marks.push({ id: 'claim:audit360', kind: 'ghost', curve: 'taper', v: cr.claim.inputs.vTipKms, y: cr.results[0].computed, d: canon.derateFraction, sf: canon.SF, label: '~360×', cr: cr });
    });
    marks.forEach(function (k) { if (k.v >= V_MIN && k.v <= V_MAX) vals.push(k.y); });
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    var dom = M.logDomain(lo, hi);
    var a = dom[0];
    var b = dom[1];
    function X(v) { return m.l + (v - V_MIN) / (V_MAX - V_MIN) * pw; }
    function Y(y) { return m.t + ph - (Math.log10(y) - a) / (b - a) * ph; }
    C = { W: W, H: H, m: m, pw: pw, ph: ph, X: X, Y: Y, Vc: Vc, markPts: [] };

    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Log-scale chart of the EQ-6 two-arm mass ratio and the EQ-5 taper against tip speed from ' + V_MIN + ' to ' + V_MAX + ' km/s at the current derate, safety factor and fibre, with the canon tiers pinned and the rev_a.json ladder marked.' });
    // grid and axes
    var step = Math.max(1, Math.ceil((b - a) / 7));
    for (var k = a; k <= b; k += step) {
      var yy = Y(Math.pow(10, k));
      svg.appendChild(sv('line', { x1: m.l, x2: m.l + pw, y1: yy, y2: yy, stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(sv('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }, yTickLabel(k)));
    }
    for (var vt = V_MIN; vt <= V_MAX + 1e-9; vt += 0.5) {
      svg.appendChild(sv('text', { x: X(vt), y: m.t + ph + 16, 'text-anchor': 'middle' }, vt.toFixed(1)));
    }
    svg.appendChild(sv('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, stroke: 'var(--axis)' }));
    svg.appendChild(sv('text', { x: m.l + pw, y: H - 4, 'text-anchor': 'end' }, 'tip speed, km/s'));
    svg.appendChild(sv('text', { x: 4, y: 12, 'text-anchor': 'start' }, '× (log)'));

    // guardrail band
    var g = canon.guardrail;
    if (g) {
      var vG = g.ratio * Vc;
      if (vG < V_MAX) {
        var x0 = X(Math.max(vG, V_MIN));
        svg.appendChild(sv('rect', { x: x0, y: m.t, width: m.l + pw - x0, height: ph, fill: 'var(--band)' }));
        var bw = m.l + pw - x0;
        var gl = 'v/V_c > ' + g.ratio;
        if (bw >= 74) svg.appendChild(sv('text', { x: x0 + 4, y: m.t + ph - 6, class: 'lbl', id: 'guard-label' }, gl));
        else svg.appendChild(sv('text', { x: 0, y: 0, transform: 'translate(' + (x0 + bw / 2 + 4) + ' ' + (m.t + ph - 6) + ') rotate(-90)', class: 'lbl', id: 'guard-label' }, gl));
      }
    }
    // tier pins, labels in two rows so they never collide
    var rows = [[], []];
    canon.tiers.forEach(function (t) {
      if (t.vTipKms < V_MIN || t.vTipKms > V_MAX) return;
      var xx = X(t.vTipKms);
      svg.appendChild(sv('line', { x1: xx, x2: xx, y1: m.t, y2: m.t + ph, stroke: 'var(--pin)', 'stroke-dasharray': '3 3', 'stroke-width': 1 }));
      var txt = t.short + ' ' + t.vTipKms.toFixed(1);
      var w = txt.length * 6.3;
      var x1 = Math.min(Math.max(xx - w / 2, 2), W - w - 2);
      var r = 0;
      while (r < 2 && rows[r].some(function (s) { return x1 < s[1] + 4 && x1 + w > s[0] - 4; })) r++;
      if (r > 1) r = 1;
      rows[r].push([x1, x1 + w]);
      svg.appendChild(sv('text', { x: x1 + w / 2, y: m.t - 22 + r * 14, 'text-anchor': 'middle', class: 'lbl' }, txt));
    });
    // curves
    function path(pts) {
      var dd = '';
      var pen = false;
      pts.forEach(function (p) {
        if (!(isFinite(p[1]) && p[1] > 0)) { pen = false; return; }
        dd += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1);
        pen = true;
      });
      return dd;
    }
    var dash = dashed ? { 'stroke-dasharray': '6 4' } : {};
    function curve(pts, color, id) {
      var attrs = { d: path(pts), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', id: id };
      for (var k2 in dash) attrs[k2] = dash[k2];
      svg.appendChild(sv('path', attrs));
    }
    curve(tap, 'var(--s-taper)', 'curve-taper');
    curve(mass, 'var(--s-mass)', 'curve-mass');
    // crossover
    var xs = M.crossoverX();
    var vStar = xs * Vc * Math.sqrt((1 - state.d) / state.sf);
    if (vStar >= V_MIN && vStar <= V_MAX) {
      var cx = X(vStar);
      var cy = Y(M.taperOfX(xs));
      svg.appendChild(sv('circle', { cx: cx, cy: cy, r: 4, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 2, id: 'crossover' }));
      var below = cy + 16 < m.t + ph - 2;
      svg.appendChild(sv('text', { x: cx + 6, y: below ? cy + 16 : cy - 8, class: 'lbl' }, 'equal at x = ' + xs.toFixed(3)));
    }
    // markers (fixed points of their own settings)
    marks.forEach(function (k) {
      if (k.v < V_MIN || k.v > V_MAX) return;
      var mx = X(k.v);
      var my = Y(k.y);
      C.markPts.push({ id: k.id, x: mx, y: my });
      var grp = sv('g', { class: 'mark', 'data-mark': k.id, tabindex: '0', role: 'button', focusable: 'true' });
      var desc;
      if (k.kind === 'rung') {
        desc = 'rev_a.json ' + k.row.key.split('.').pop() + ' = ' + k.row.canonValue + '; re-derived ' + fx(k.row.computed, 2) + ' (' + k.status + '). Activate to set the controls to it.';
        grp.appendChild(sv('circle', { cx: mx, cy: my, r: 7, fill: 'var(--surface)', stroke: 'none' }));
        grp.appendChild(sv('circle', { cx: mx, cy: my, r: 5, fill: 'var(--surface)', stroke: k.status === 'reproduces' ? 'var(--good)' : 'var(--crit)', 'stroke-width': 2 }));
      } else {
        desc = 'Historical ' + k.label + ' (' + k.cr.claim.file + ':' + k.cr.claim.line + '), ' + (k.curve === 'mass' ? 'EQ-6' : 'EQ-5') + ' = ' + fx(k.y, 2) + '. Activate to set the controls to it.';
        var s = 5;
        grp.appendChild(sv('path', { d: 'M' + mx + ' ' + (my - s) + 'L' + (mx + s) + ' ' + my + 'L' + mx + ' ' + (my + s) + 'L' + (mx - s) + ' ' + my + 'Z', fill: 'var(--ghost)', stroke: 'var(--surface)', 'stroke-width': 1.5 }));
        var up = k.curve === 'mass';
        svg.appendChild(sv('text', { x: mx + 8, y: up ? my - 6 : my + 14, class: 'lbl' }, k.label));
      }
      grp.appendChild(sv('circle', { cx: mx, cy: my, r: 12, fill: 'transparent', class: 'hit' }));
      grp.appendChild(sv('title', null, desc));
      grp.setAttribute('aria-label', desc);
      grp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applySnap({ v: k.v, d: k.d, sf: k.sf }); }
      });
      svg.appendChild(grp);
    });
    // cursor at the current tip speed
    if (state.v >= V_MIN && state.v <= V_MAX) {
      var cxv = X(state.v);
      svg.appendChild(sv('line', { x1: cxv, x2: cxv, y1: m.t, y2: m.t + ph, stroke: 'var(--ink-2)', 'stroke-width': 1, id: 'cursor' }));
      var ym = Y(cur.ev.massRatio);
      var yt = Y(cur.ev.taper);
      var right = cxv < m.l + pw - 78;
      var lm = ym;
      var lt = yt;
      if (Math.abs(lm - lt) < 14) { var mid = (lm + lt) / 2; lm = mid - 8; lt = mid + 8; }
      svg.appendChild(sv('circle', { cx: cxv, cy: yt, r: 4, fill: 'var(--s-taper)', stroke: 'var(--surface)', 'stroke-width': 2 }));
      svg.appendChild(sv('circle', { cx: cxv, cy: ym, r: 4, fill: 'var(--s-mass)', stroke: 'var(--surface)', 'stroke-width': 2 }));
      svg.appendChild(sv('text', { x: right ? cxv + 11 : cxv - 11, y: lm + 4, 'text-anchor': right ? 'start' : 'end', class: 'val', id: 'cur-mass' }, ratio(cur.ev.massRatio) + '×'));
      svg.appendChild(sv('text', { x: right ? cxv + 11 : cxv - 11, y: lt + 4, 'text-anchor': right ? 'start' : 'end', class: 'val', id: 'cur-taper' }, ratio(cur.ev.taper)));
    }
    box.appendChild(svg);
    if (focusId) {
      var f = box.querySelector('[data-mark="' + focusId + '"]');
      if (f) f.focus();
    }
    var noteBits = [];
    noteBits.push('Rings are the rev_a.json ladder (green: re-derived within 5 × 10⁻⁴), diamonds are figures from the program\'s history. Each sits at its own settings (' + canon.primary.name + ', SF ' + canon.SF + ', the derate in its name); a curve passes through one only when the controls match it. Tap or press Enter on one to set the controls.');
    if (g) noteBits.push('Shaded: v_tip/V_c above ' + g.ratio + ', the "mass-growth guardrail" in mass_ratio._ratio_note; for this fibre that starts at ' + fx(g.ratio * Vc, 2) + ' km/s.');
    $('curves-note').textContent = noteBits.join(' ');
  }

  function legend() {
    var ul = $('legend-curves');
    ul.textContent = '';
    if (!canon.ok) return;
    function item(svgKids, text) {
      var s = sv('svg', { width: 22, height: 12, 'aria-hidden': 'true' });
      svgKids.forEach(function (k) { s.appendChild(k); });
      ul.appendChild(el('li', null, [s, text]));
    }
    item([sv('line', { x1: 1, x2: 21, y1: 6, y2: 6, stroke: 'var(--s-mass)', 'stroke-width': 2 })], 'Mass ratio M/m, EQ-6');
    item([sv('line', { x1: 1, x2: 21, y1: 6, y2: 6, stroke: 'var(--s-taper)', 'stroke-width': 2 })], 'Taper, EQ-5');
    item([sv('circle', { cx: 11, cy: 6, r: 4, fill: 'var(--surface)', stroke: 'var(--good)', 'stroke-width': 2 })], 'rev_a.json rung');
    item([sv('path', { d: 'M11 1L16 6L11 11L6 6Z', fill: 'var(--ghost)' })], 'historical figure');
    item([sv('line', { x1: 11, x2: 11, y1: 0, y2: 12, stroke: 'var(--pin)', 'stroke-dasharray': '3 3' })], 'canon tier');
  }

  // pointer: drag across the plot to set the tip speed; hover (mouse) for a readout
  function vFromEvent(e) {
    var svg = $('plot-curves').querySelector('svg');
    if (!svg || !C) return null;
    var rect = svg.getBoundingClientRect();
    var px = (e.clientX - rect.left) * (C.W / rect.width);
    var v = V_MIN + (px - C.m.l) / C.pw * (V_MAX - V_MIN);
    v = Math.min(V_MAX, Math.max(V_MIN, v));
    return Math.round(v * 100) / 100;
  }
  function showTip(e, v) {
    var tipEl = $('tooltip');
    var cur = current();
    if (!cur.ev.ok || v == null) { tipEl.hidden = true; return; }
    var x = M.xParam(v, cur.ev.Vc, state.sf, state.d);
    var mm = M.massRatioOfX(x, 2);
    var tt = M.taperOfX(x);
    tipEl.textContent = '';
    tipEl.appendChild(el('div', { cls: 'row' }, [el('b', { text: v.toFixed(2) + ' km/s' }), ' x = ' + fx(x, 3)]));
    tipEl.appendChild(el('div', { cls: 'row' }, [el('span', { cls: 'key', style: 'border-color:var(--s-mass)' }), el('b', { text: ratio(mm) + '×' }), ' mass ratio']));
    tipEl.appendChild(el('div', { cls: 'row' }, [el('span', { cls: 'key', style: 'border-color:var(--s-taper)' }), el('b', { text: ratio(tt) }), ' taper']));
    tipEl.appendChild(el('div', { cls: 'row' }, ['mass ÷ taper ', el('b', { text: fx(mm / tt, 2) })]));
    tipEl.hidden = false;
    var fig = tipEl.parentNode.getBoundingClientRect();
    var left = e.clientX - fig.left + 12;
    var w = tipEl.offsetWidth;
    if (left + w > fig.width - 8) left = e.clientX - fig.left - w - 12;
    tipEl.style.left = Math.max(4, left) + 'px';
    tipEl.style.top = Math.max(4, e.clientY - fig.top - tipEl.offsetHeight - 10) + 'px';
  }
  function setupPointer() {
    var box = $('plot-curves');
    box.addEventListener('pointerdown', function (e) {
      if (!C) return;
      // Rings and diamonds sit close together at the reference tip speed on a phone, so a press picks the
      // nearest one within 14 px rather than whichever hit area happens to be on top.
      var hit = nearestMark(e);
      if (hit) {
        var s = markSettings(hit.id);
        if (s) { e.preventDefault(); applySnap(s); }
        return;
      }
      state.dragging = true;
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      var v = vFromEvent(e);
      if (v != null) { state.v = v; $('v').value = String(v); render(); showTip(e, v); }
    });
    box.addEventListener('pointermove', function (e) {
      if (!C) return;
      var v = vFromEvent(e);
      if (state.dragging) {
        if (v != null && v !== state.v) { state.v = v; $('v').value = String(v); render(); }
        showTip(e, v);
      } else if (e.pointerType === 'mouse') {
        showTip(e, v);
      }
    });
    function end() { state.dragging = false; $('tooltip').hidden = true; }
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('pointerleave', function () { if (!state.dragging) $('tooltip').hidden = true; });
  }
  function nearestMark(e) {
    var svg = $('plot-curves').querySelector('svg');
    if (!svg || !C) return null;
    var rect = svg.getBoundingClientRect();
    var k = C.W / rect.width;
    var px = (e.clientX - rect.left) * k;
    var py = (e.clientY - rect.top) * k;
    var best = null;
    var bestD = 14;
    C.markPts.forEach(function (p) {
      var d = Math.sqrt((p.x - px) * (p.x - px) + (p.y - py) * (p.y - py));
      if (d <= bestD) { bestD = d; best = p; }
    });
    return best;
  }
  function markSettings(id) {
    if (id.indexOf('rung:') === 0) {
      var key = id.slice(5);
      var r = canon.ladder.filter(function (x) { return x.key === key; })[0];
      return r ? { v: r.vTipKms, d: r.derate, sf: r.SF } : null;
    }
    if (id === 'claim:ghost440') {
      var c1 = M.CLAIMS.filter(function (c) { return c.id === 'ghost440'; })[0];
      return { v: c1.inputs.vTipKms, d: c1.inputs.derate, sf: canon.SF };
    }
    if (id === 'claim:audit360') {
      var c2 = M.CLAIMS.filter(function (c) { return c.id === 'audit360'; })[0];
      return { v: c2.inputs.vTipKms, d: canon.derateFraction, sf: canon.SF };
    }
    return null;
  }

  // ── Chart 2: the profile ───────────────────────────────────────────────────────────
  function niceStep(span, n) {
    var raw = span / n;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    // geometric midpoints between the 1-2-5 steps
    return (f < Math.SQRT2 ? 1 : f < Math.sqrt(10) ? 2 : f < Math.sqrt(50) ? 5 : 10) * p;
  }
  function compact(v) {
    if (v >= 1e5) return sci(v, 1);
    return v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 1 : 0 });
  }
  function drawProfile(cur) {
    var box = $('plot-profile');
    box.textContent = '';
    var W = plotWidth(box);
    var H = W < 520 ? 230 : 250;
    var f = $('factors');
    f.textContent = '';
    if (!canon.ok) { message(box, W, H, ['No canon file, no numbers.']); return; }
    if (!cur.ev.ok) { message(box, W, H, ['Refused; nothing is drawn.']); return; }
    var ev = cur.ev;
    var m = { l: 46, r: 14, t: 22, b: 34 };
    var pw = W - m.l - m.r;
    var ph = H - m.t - m.b;
    var top = ev.taper * 1.12;
    function X(u) { return m.l + (u + 1) / 2 * pw; }
    function Y(y) { return m.t + ph - y / top * ph; }
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Cross-section along the tether as a multiple of the tip area: peak ' + ratio(ev.taper) + ' at the centre, mean ' + ratio(ev.meanArea) + '.' });
    var st = niceStep(top, 4);
    for (var y = 0; y <= top + 1e-9; y += st) {
      svg.appendChild(sv('line', { x1: m.l, x2: m.l + pw, y1: Y(y), y2: Y(y), stroke: 'var(--grid)' }));
      svg.appendChild(sv('text', { x: m.l - 6, y: Y(y) + 4, 'text-anchor': 'end' }, compact(y)));
    }
    var N = 240;
    var d = 'M' + X(-1) + ' ' + Y(0);
    var line = '';
    for (var i = 0; i <= N; i++) {
      var u = -1 + 2 * i / N;
      var A = M.profile(ev.x, u);
      d += 'L' + X(u).toFixed(1) + ' ' + Y(A).toFixed(1);
      line += (i ? 'L' : 'M') + X(u).toFixed(1) + ' ' + Y(A).toFixed(1);
    }
    d += 'L' + X(1) + ' ' + Y(0) + 'Z';
    svg.appendChild(sv('path', { d: d, fill: 'var(--mass-fill)', stroke: 'none', id: 'profile-area' }));
    svg.appendChild(sv('path', { d: line, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
    svg.appendChild(sv('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, stroke: 'var(--axis)' }));
    // mean height
    var ym = Y(ev.meanArea);
    svg.appendChild(sv('line', { x1: X(-1), x2: X(1), y1: ym, y2: ym, stroke: 'var(--s-mass)', 'stroke-width': 2, 'stroke-dasharray': '5 4', id: 'profile-mean' }));
    var meanLbl = 'mean ' + ratio(ev.meanArea) + ' (' + fx(ev.meanOverPeak * 100, 1) + ' % of peak)';
    // peak
    var yp = Y(ev.taper);
    // When the mean is close to the peak (small x) the mean's label goes under its line.
    var meanBelow = ym - yp < 24;
    svg.appendChild(sv('text', { x: X(-1) + 4, y: meanBelow ? ym + 15 : ym - 6, class: 'val', id: 'mean-label' }, meanLbl));
    svg.appendChild(sv('circle', { cx: X(0), cy: yp, r: 4.5, fill: 'var(--s-taper)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    svg.appendChild(sv('text', { x: X(0) + 8, y: yp - 6, class: 'val', id: 'peak-label' }, 'peak = taper ' + ratio(ev.taper)));
    [[-1, 'tip'], [0, 'centre'], [1, 'tip']].forEach(function (p) {
      svg.appendChild(sv('text', { x: X(p[0]), y: m.t + ph + 16, 'text-anchor': p[0] < 0 ? 'start' : p[0] > 0 ? 'end' : 'middle' }, p[1]));
    });
    svg.appendChild(sv('text', { x: 4, y: 12 }, '× tip area'));
    box.appendChild(svg);

    f.appendChild(document.createTextNode('M/m = 2 arms × 2x² × mean height = 2 × '));
    f.appendChild(el('b', { text: fx(ev.tipSized, 3) }));
    f.appendChild(document.createTextNode(' × '));
    f.appendChild(el('b', { text: ratio(ev.meanArea) }));
    f.appendChild(document.createTextNode(' = '));
    f.appendChild(el('b', { text: ratio(ev.massRatio) }));
    f.appendChild(document.createTextNode('. Taper = peak height = '));
    f.appendChild(el('b', { text: ratio(ev.taper) }));
    f.appendChild(document.createTextNode('. So M/m ÷ taper = 2 × 2x² × (mean ÷ peak) = 2 × ' + fx(ev.tipSized, 3) + ' × ' + fx(ev.meanOverPeak, 3) + ' = '));
    f.appendChild(el('b', { text: fx(ev.gap, 2) }));
    f.appendChild(document.createTextNode('. 2x² is the mass of an arm that kept the tip\'s cross-section all the way in, per unit payload.'));
  }

  // ── Ledger and history (do not depend on the controls) ─────────────────────────────
  function renderLedger() {
    var tb = $('ledger').querySelector('tbody');
    tb.textContent = '';
    if (!canon.ok) {
      tb.appendChild(el('tr', null, [el('td', { colspan: '4', text: 'No canon file, no numbers.' })]));
      return;
    }
    var lastGroup = null;
    function group(parent) {
      if (parent === lastGroup) return;
      lastGroup = parent;
      tb.appendChild(el('tr', { cls: 'grp' }, [el('th', { colspan: '4', scope: 'colgroup' }, [code(parent)])]));
    }
    function statusCell(status, refusalText) {
      if (status === 'reproduces') return el('span', { cls: 'st ok', text: '✓ reproduces' });
      if (status === 'matches as rounded') return el('span', { cls: 'st ok', text: '✓ matches as rounded' });
      if (status === 'differs') return el('span', { cls: 'st bad', text: '✗ differs' });
      return el('span', { cls: 'st ref', text: '— refused: ' + refusalText });
    }
    canon.ladder.forEach(function (r) {
      var parts = r.key.split('.');
      var last = parts.pop();
      group(parts.join('.'));
      var keyCell = el('td', { cls: 'key' }, [code(last)]);
      if (r.status !== 'refused') {
        var desc = r.kind === 'ratio' ?
          'M/m at ' + r.vTipKms + ' km/s (' + r.vSource + '), ' + pct(r.derate) + ' derate (' + r.derateSource + '), SF ' + r.SF + ', ' + r.material :
          'tonnes = M/m at ' + r.vTipKms + ' km/s, ' + pct(r.derate) + ' × ' + canon.payloadKg.toLocaleString('en-US') + ' kg (payload_mass_kg_for_tonnage) ÷ 1000';
        keyCell.appendChild(el('span', { cls: 'in', text: desc }));
      }
      if (r.note) keyCell.appendChild(el('span', { cls: 'in', text: r.note }));
      tb.appendChild(el('tr', { 'data-key': r.key, 'data-status': r.status }, [
        keyCell,
        el('td', { cls: 'num', 'data-h': 'file', text: String(r.canonValue) }),
        el('td', { cls: 'num', 'data-h': 'recomputed' }, r.status === 'refused' ? ['—'] : [fx(r.computed, r.kind === 'ratio' ? 4 : 3), el('span', { cls: 'in', text: 'rel. ' + sci(r.relErr, 1) })]),
        el('td', { cls: 'stc' }, [statusCell(r.status, r.refusal && r.refusal.reason)])
      ]));
    });
    canon.rounded.forEach(function (r) {
      var parts = r.key.split('.');
      var last = parts.pop();
      group(parts.join('.'));
      tb.appendChild(el('tr', { 'data-key': r.key, 'data-status': r.status }, [
        el('td', { cls: 'key' }, [code(last), el('span', { cls: 'in', text: r.what + ', stated to ' + r.decimals + ' decimals' })]),
        el('td', { cls: 'num', 'data-h': 'file', text: String(r.canonValue) }),
        el('td', { cls: 'num', 'data-h': 'recomputed', text: fx(r.computed, 4) }),
        el('td', { cls: 'stc' }, [statusCell(r.status)])
      ]));
    });
  }

  var WHY = {
    audit360: function () { return 'The figure the 2 July audit called a per-arm mass ratio is the EQ-5 area taper at that tip speed. Item 2 of the same log is the correction.'; },
    audit440: function () { return 'Both come out exactly only if 440× is read as two arms × the EQ-5 taper: the audit tested 440× against the area ratio, not the mass ratio, which is why it found no parameter set for it.'; },
    ghost440: function () { return 'The old unsourced 440× is EQ-6, the right formula, at 0 % derate: the optimistic rung, misremembered as the conservative one. It is the grey diamond on the mass curve.'; },
    log20: roundedNote,
    gloss48: roundedNote,
    creep72: function (cr) {
      var q41 = cr.results[0];
      var q800 = cr.results[1];
      var others = q800.alternatives.filter(function (a) { return a.derate !== cr.claim.inputs.derate; });
      var anyHit = q800.alternatives.some(function (a) { return M.verdict(a.value, q800.q) !== 'no'; });
      return 'Like for like with ' + q41.q.text + ' (the ' + pct(cr.claim.inputs.derate) + ' rung), raising SF from ' + canon.SF + ' to ' + cr.claim.inputs.SF + ' gives ' + fx(q800.computed, 2) + '×, not ' + q800.q.text + '. ' +
        others.map(function (a) { return 'At the ' + pct(a.derate) + ' rung it gives ' + fx(a.value, 2) + '×.'; }).join(' ') +
        (anyHit ? '' : ' No ladder rung gives ' + q800.q.text + '.') +
        ' (' + q41.q.text + ' itself is the ' + pct(cr.claim.inputs.derate) + ' rung, ' + fx(q41.computed, 2) + '×, which rounds to ' + M.roundSig(q41.computed, M.sigFigs(q41.q.text)) + '.)';
    }
  };
  function roundedNote(cr) {
    var r = canon.rounded.filter(function (x) { return x.key === 'materials.V_c_kms'; })[0];
    if (!r || canon.primary.refusal) return '';
    var Vr = r.canonValue;
    var vals = [M.taperOfX(M.xParam(canon.vRef, Vr, canon.SF, 0))];
    if (cr.results.length > 1) vals.push(M.taperOfX(M.xParam(canon.vRef, Vr, canon.SF, canon.derateFraction)));
    var both = vals.length > 1;
    return 'Reproduces from σ and ρ (V_c = ' + fx(M.characteristicVelocityKms(canon.primary.sigmaGPa, canon.primary.rhoKgm3), 4) + ' km/s). With the rounded V_c = ' + Vr + ' km/s that the same line states, the expression gives ' +
      vals.map(function (v) { return fx(v, 2); }).join(' and ') + ', which round' + (both ? '' : 's') + ' to ' +
      vals.map(function (v, i) { return fx(v, cr.results[i].q.text.replace(/[^0-9.]/g, '').split('.')[1].length); }).join(' and ') + '.';
  }
  function renderHistory() {
    var ol = $('history');
    ol.textContent = '';
    if (!canon.ok) { ol.appendChild(el('li', { text: 'No canon file, no numbers.' })); return; }
    claimResults.forEach(function (cr) {
      var cl = cr.claim;
      var li = el('li', { 'data-claim': cl.id, 'data-status': cr.status });
      li.appendChild(el('blockquote', { text: cl.quote }));
      li.appendChild(el('div', { cls: 'cite' }, [code(cl.file + ':' + cl.line), ' (' + cl.item + ', Skyhook @ ' + String((canon.provenance || {}).commit || '').slice(0, 7) + ')']));
      var res = el('div', { cls: 'res' });
      if (cr.status === 'refused') res.appendChild(el('div', { text: 'Refused: the canon lacks the primary fibre or SF.' }));
      cr.results.forEach(function (r) {
        var lab = { exact: 'exact', close: 'close', no: 'does not reproduce' }[r.verdict];
        res.appendChild(el('div', null, [el('b', { text: r.q.text }), ' → ', el('b', { text: fx(r.computed, r.decimals || 2) }), ' (' + r.how + ') ', el('span', { cls: 'chip ' + r.verdict, text: lab })]));
      });
      li.appendChild(res);
      var w = WHY[cl.id] && cr.status !== 'refused' ? WHY[cl.id](cr) : '';
      if (w) li.appendChild(el('p', { cls: 'why', text: w }));
      ol.appendChild(li);
    });
  }

  // ── Render loop ────────────────────────────────────────────────────────────────────
  function render() {
    var cur = current();
    renderReadout(cur);
    drawCurves(cur);
    drawProfile(cur);
    if (canon.ok) updateSnaps();
  }

  renderCanonLine();
  renderNotice();
  setupControls();
  legend();
  renderLedger();
  renderHistory();
  setupPointer();
  render();
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { var cur = current(); drawCurves(cur); drawProfile(cur); }, 120);
  });
  // For ui-check.mjs: the state and canon the page is drawing from.
  window.__taper = { state: state, canon: canon, current: current };
})();
