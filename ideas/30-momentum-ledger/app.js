/* app.js — draws the Momentum Ledger page from data.js (snapshots of Skyhook) and ledger.js (the kernel).
 * It holds no physical constant of its own: every number shown is read from LedgerData or computed by
 * MomentumLedger / TwinCheck here. */
(function () {
  'use strict';
  var D = window.LedgerData, K = window.MomentumLedger, TC = window.TwinCheck, TW = window.SkyhookTwin;
  var revA = D.revA;
  var V = function (key) { return D.values[key].text; };
  var cite = function (key) { var v = D.values[key]; return v.path + ':' + v.line; };
  var nums = function (key) { return V(key).split(',').map(function (x) { return Number(x.trim()); }); };

  var RE = parseFloat(V('skyhook_physics.r_earth_km'));
  var HUB0_KG = Number(V('tether_dynamics.hub_mass_kg'));
  var INT_LO = Number(V('project_instructions.interval_lo_d'));
  var INT_HI = Number(V('project_instructions.interval_hi_d'));
  var INT_MATURE = Number(V('project_instructions.interval_mature_d'));
  var MARGIN = Number(V('project_instructions.margin_pct')) / 100;
  var ETA_MP = [V('mp001.eta_lo_pct'), V('mp001.eta_mid_pct'), V('mp001.eta_hi_pct')].map(function (x) { return Number(x) / 100; });
  var ETA_RB = nums('reboost_bound.rb_eta');
  var DUTY_RB = nums('reboost_bound.rb_duty');
  var POW_RB = nums('reboost_bound.rb_powers_kw');
  var SPEC_POW = nums('reboost_bound.rb_specific_power_wkg');
  var WB = D.workbook.rows;
  var COLS = ['Conservative', 'Baseline', 'Optimistic'];
  var DAY = K.DAY_S;
  var MU = revA.orbital.mu_earth_m3s2;
  var DESIGN_KG = revA.mass_ratio.integrated_tether_to_payload_both_arms.payload_mass_kg_for_tonnage;
  var EXTRA_POW_KW = [1000, 2500, 5000, 10000, 25000, 50000]; // this page's own extension of the grid [FLAGGED]

  var state = {
    tier: 'reference', derate: '0.3', hubT: HUB0_KG / 1e3, payloadKg: DESIGN_KG, release: 'canon',
    logP: 6, eta: ETA_MP[1], duty: DUTY_RB[1], floorKm: 200
  };
  var twinResult = null, twinKey = null, twinBusy = false;

  // ------------------------------------------------------------------ formatting
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(x, d) {
    if (x === Infinity) return '∞';
    if (!isFinite(x)) return '—';
    return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
  }
  function sig(x, s) { // significant figures, no exponent below 1e6
    if (!isFinite(x)) return '—';
    var d = Math.max(0, s - 1 - Math.floor(Math.log10(Math.abs(x) || 1)));
    return n(x, d);
  }
  function sci(x, d) {
    var e = Math.floor(Math.log10(Math.abs(x)));
    var sup = String(e).replace(/[-0-9]/g, function (c) { return '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'.charAt('-0123456789'.indexOf(c)); });
    return n(x / Math.pow(10, e), d) + ' × 10' + sup;
  }
  function power(w) {
    if (w >= 1e6) return sig(w / 1e6, 3) + ' MW';
    return sig(w / 1e3, 3) + ' kW';
  }
  function pct(x) { return n(x * 100, x * 100 % 1 ? 1 : 0) + ' %'; }
  function tile(k, v, s, extra) {
    return '<div class="tile"' + (extra || '') + '><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  }
  function refusalHTML(r, title) {
    return '<div class="refusal" role="status"><div class="h">' + esc(title || 'Refused') + ' <span class="tag">' + esc(r.code) + '</span></div>' +
      '<dl><dt>Why</dt><dd>' + esc(r.reason) + '</dd><dt>What would help</dt><dd>' + esc(r.what_would_help) + '</dd></dl></div>';
  }
  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------------ model
  function sysFor(o) {
    return K.system(revA, Object.assign({ tier: state.tier, derate: state.derate, hubKg: state.hubT * 1e3, payloadKg: state.payloadKg, earthRadiusKm: RE, release: state.release }, o || {}));
  }
  function configKey() { return [state.tier, state.derate, state.hubT, state.payloadKg].join('|'); }

  // ------------------------------------------------------------------ controls
  function seg(el, name, items, value, onChange) {
    el.innerHTML = items.map(function (it) {
      return '<label><input type="radio" name="' + name + '" value="' + esc(it.value) + '"' + (it.value === value ? ' checked' : '') +
        (it.disabled ? ' disabled' : '') + '><span>' + it.label + '</span></label>';
    }).join('');
    el.querySelectorAll('input').forEach(function (inp) { inp.addEventListener('change', function () { onChange(inp.value); }); });
  }
  function drawControls() {
    seg($('tier'), 'tier', Object.keys(K.TIERS).map(function (k) {
      return { value: k, label: K.TIERS[k].label };
    }), state.tier, function (v) {
      state.tier = v;
      if (!K.TIERS[v].fibre[state.derate]) state.derate = '0.3';
      updateDerate(); drawHubPresets(); render();
    });
    seg($('derate'), 'derate', K.DERATES.map(function (d) {
      return { value: d, label: Math.round(Number(d) * 100) + ' %' + (d === '0.3' ? ' (conservative)' : d === '0' ? ' (optimistic)' : ' (baseline)') };
    }), state.derate, function (v) { state.derate = v; updateDerate(); drawHubPresets(); render(); });
    seg($('release'), 'release', [
      { value: 'canon', label: 'as the canon promises' },
      { value: 'loaded', label: 'at the canon spin rate' }
    ], state.release, function (v) { state.release = v; updateRelease(); render(); });
    updateDerate();
    updateRelease();
  }
  function updateDerate() {
    var tier = K.TIERS[state.tier];
    $('derate').querySelectorAll('input').forEach(function (inp) {
      inp.disabled = !tier.fibre[inp.value];
      inp.checked = inp.value === state.derate;
    });
    var missing = K.DERATES.filter(function (d) { return !tier.fibre[d]; });
    $('derate-hint').textContent = missing.length
      ? 'rev_a.json prints this tier\'s fibre mass only at 30 % derate; the others are refused rather than computed.'
      : 'Fibre mass from rev_a.json: ' + K.DERATES.map(function (d) { return Math.round(Number(d) * 100) + ' % → ' + n(K.get(revA, tier.fibre[d]), 1) + ' t'; }).join(', ') + '.';
  }
  function updateRelease() {
    $('release-hint').textContent = state.release === 'canon'
      ? 'The payload leaves at v_orb + v_tip from r + L, the state rev_a.json prints (the default).'
      : 'The loaded tether turns about the combined centre of mass, so at the canon spin rate the payload leaves a little lower and slower.';
  }

  function drawHubPresets() {
    var s = sysFor();
    var hubP = [{ t: HUB0_KG / 1e3, l: n(HUB0_KG / 1e3, 0) + ' t', src: 'tether_dynamics.py:77' },
      { t: Number(V('project_instructions.hub_lo_t')), l: V('project_instructions.hub_lo_t') + ' t', src: 'Phase 2 low, :193' },
      { t: Number(V('project_instructions.hub_hi_t')), l: V('project_instructions.hub_hi_t') + ' t', src: 'Phase 2 high, :193' }];
    if (!K.isRefusal(s)) {
      var col = state.derate === '0.3' ? 'Conservative' : state.derate === '0.15' ? 'Baseline' : 'Optimistic';
      var f = Number(WB['9'][col]);
      hubP.push({ t: Math.round((f - 1) * s.fibreKg / 1e3 * 10) / 10, l: n((f - 1) * s.fibreKg / 1e3, 1) + ' t', src: 'workbook row 9 (' + f + '×) read as mass' });
    }
    $('hub-presets').innerHTML = hubP.map(function (p) {
      return '<button type="button" class="chip" data-hub="' + p.t + '">' + p.l + ' <span class="src">' + esc(p.src) + '</span></button>';
    }).join('');
    $('hub-presets').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.hubT = Number(b.dataset.hub); syncInputs(); render(); });
    });
  }

  function drawPresets() {
    drawHubPresets();
    var pw = POW_RB.map(function (k) { return { w: k * 1e3, src: 'reboost_bound' }; });
    pw.push({ w: Number(V('project_instructions.ed_p_hi_mw')) * 1e6, src: '§4.6 top' });
    $('power-presets').innerHTML = pw.map(function (p) {
      return '<button type="button" class="chip" data-w="' + p.w + '">' + power(p.w) + ' <span class="src">' + p.src + '</span></button>';
    }).join('');
    $('power-presets').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.logP = Math.log10(Number(b.dataset.w)); syncInputs(); render(); });
    });
    var etaSrc = {};
    var addEta = function (e, src) { var k = Math.round(e * 1000) / 1000; (etaSrc[k] = etaSrc[k] || []).push(src); };
    ETA_MP.forEach(function (e) { addEta(e, 'MP-001'); });
    COLS.forEach(function (c) { addEta(Number(WB['6'][c]), 'workbook'); });
    ETA_RB.forEach(function (e) { addEta(e, 'in-space fork'); });
    var etas = Object.keys(etaSrc).map(Number).sort(function (a, b) { return a - b; }).map(function (e) {
      return { e: e, src: etaSrc[e].filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') };
    });
    $('eta-presets').innerHTML = etas.map(function (p) {
      return '<button type="button" class="chip" data-e="' + p.e + '">' + pct(p.e) + ' <span class="src">' + p.src + '</span></button>';
    }).join('');
    $('eta-presets').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.eta = Number(b.dataset.e); syncInputs(); render(); });
    });
    $('duty-presets').innerHTML = DUTY_RB.map(function (d) { return '<button type="button" class="chip" data-d="' + d + '">' + d + ' <span class="src">reboost_bound</span></button>'; }).join('') +
      '<button type="button" class="chip" data-d="1">1.0 <span class="src">ceiling, no losses</span></button>';
    $('duty-presets').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.duty = Number(b.dataset.d); syncInputs(); render(); });
    });
  }

  function syncInputs() {
    $('hub').value = state.hubT;
    $('hub-range').value = Math.min(3000, state.hubT);
    $('payload').value = state.payloadKg;
    $('power').value = state.logP;
    $('eta').value = state.eta;
    $('duty').value = state.duty;
    $('floor').value = state.floorKm;
  }

  function wireInputs() {
    $('hub').addEventListener('input', function () { var v = $('hub').valueAsNumber; state.hubT = isNaN(v) ? NaN : v; $('hub-range').value = Math.min(3000, v || 0); render(); });
    $('hub-range').addEventListener('input', function () { state.hubT = Number($('hub-range').value); $('hub').value = state.hubT; render(); });
    $('payload').addEventListener('input', function () { var v = $('payload').valueAsNumber; state.payloadKg = isNaN(v) ? NaN : v; render(); });
    $('power').addEventListener('input', function () { state.logP = Number($('power').value); render(); });
    $('eta').addEventListener('input', function () { state.eta = Number($('eta').value); render(); });
    $('duty').addEventListener('input', function () { state.duty = Number($('duty').value); render(); });
    $('floor').addEventListener('input', function () { state.floorKm = Number($('floor').value); render(); });
    $('twin-run').addEventListener('click', runTwin);
  }

  // ------------------------------------------------------------------ charts
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function lineChart(host, cfg) {
    // cfg: { w, h, x: {min,max,log,ticks,fmt,label}, y: {...}, series: [{cls, dotCls, pts:[[x,y]], name}], hlines: [{y, cls, label}], vline: {x}, tip(xv) -> html, points (bool) }
    host.innerHTML = '';
    var W = cfg.w, H = cfg.h, m = { l: 52, r: 14, t: 12, b: 40 };
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': cfg.aria });
    var tx = function (v) { var a = cfg.x.log ? Math.log10 : function (z) { return z; }; return m.l + (a(v) - a(cfg.x.min)) / (a(cfg.x.max) - a(cfg.x.min)) * (W - m.l - m.r); };
    var ty = function (v) { var a = cfg.y.log ? Math.log10 : function (z) { return z; }; return H - m.b - (a(v) - a(cfg.y.min)) / (a(cfg.y.max) - a(cfg.y.min)) * (H - m.t - m.b); };
    var clampY = function (v) { return Math.max(cfg.y.min, Math.min(cfg.y.max, v)); };
    cfg.y.ticks.forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: ty(v), y2: ty(v), class: 'gridl' }));
      svg.appendChild(svgEl('text', { x: m.l - 6, y: ty(v) + 4, 'text-anchor': 'end' }, cfg.y.fmt(v)));
    });
    cfg.x.ticks.forEach(function (v) {
      svg.appendChild(svgEl('text', { x: tx(v), y: H - m.b + 16, 'text-anchor': 'middle' }, cfg.x.fmt(v)));
    });
    svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axisl' }));
    svg.appendChild(svgEl('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', class: 'lab' }, cfg.x.label));
    svg.appendChild(svgEl('text', { x: 12, y: (H - m.b + m.t) / 2, 'text-anchor': 'middle', class: 'lab', transform: 'rotate(-90 12 ' + (H - m.b + m.t) / 2 + ')' }, cfg.y.label));
    (cfg.bands || []).forEach(function (b) {
      svg.appendChild(svgEl('rect', { x: m.l, width: W - m.l - m.r, y: ty(b.y1), height: Math.max(0, ty(b.y0) - ty(b.y1)), class: 'band' }));
    });
    (cfg.hlines || []).forEach(function (h) {
      if (h.y < cfg.y.min || h.y > cfg.y.max) return;
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: ty(h.y), y2: ty(h.y), class: h.cls }));
      svg.appendChild(svgEl('text', { x: W - m.r - 4, y: ty(h.y) - 5, 'text-anchor': 'end', class: 'lab' }, h.label));
    });
    if (cfg.vline) svg.appendChild(svgEl('line', { x1: tx(cfg.vline.x), x2: tx(cfg.vline.x), y1: m.t, y2: H - m.b, class: 'now' }));
    cfg.series.forEach(function (s) {
      if (!s.pts.length) return;
      var d = s.pts.map(function (p, i) { return (i ? 'L' : 'M') + tx(p[0]).toFixed(1) + ' ' + ty(clampY(p[1])).toFixed(1); }).join(' ');
      svg.appendChild(svgEl('path', { d: d, class: s.cls }));
      if (cfg.points) s.pts.forEach(function (p) { svg.appendChild(svgEl('circle', { cx: tx(p[0]), cy: ty(clampY(p[1])), r: 4.5, class: s.dotCls })); });
      if (s.mark) svg.appendChild(svgEl('circle', { cx: tx(s.mark[0]), cy: ty(clampY(s.mark[1])), r: 5, class: s.dotCls }));
    });
    var cross = svgEl('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' });
    svg.appendChild(cross);
    var hit = svgEl('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    svg.appendChild(hit);
    host.appendChild(svg);
    var tipEl = document.createElement('div');
    tipEl.className = 'tip'; tipEl.style.display = 'none';
    host.appendChild(tipEl);
    function move(ev) {
      var r = svg.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * W;
      if (px < m.l || px > W - m.r) { leave(); return; }
      var frac = (px - m.l) / (W - m.l - m.r);
      var xv = cfg.x.log ? Math.pow(10, Math.log10(cfg.x.min) + frac * (Math.log10(cfg.x.max) - Math.log10(cfg.x.min))) : cfg.x.min + frac * (cfg.x.max - cfg.x.min);
      var t = cfg.tip(xv);
      if (!t) { leave(); return; }
      cross.setAttribute('x1', tx(t.x)); cross.setAttribute('x2', tx(t.x)); cross.setAttribute('visibility', 'visible');
      tipEl.innerHTML = t.html; tipEl.style.display = 'block';
      var left = (tx(t.x) / W) * r.width + 12;
      if (left + tipEl.offsetWidth > r.width) left = Math.max(0, (tx(t.x) / W) * r.width - tipEl.offsetWidth - 12);
      tipEl.style.left = left + 'px'; tipEl.style.top = '8px';
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); tipEl.style.display = 'none'; }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  // ------------------------------------------------------------------ sections
  function renderCost(s, e, l) {
    var el = $('cost-body');
    if (K.isRefusal(s)) { el.innerHTML = refusalHTML(s, 'No throw to book'); return; }
    var kinetic = e.kinetic / 1e6, lift = e.potential / 1e6;
    var canon = K.energy(sysFor({ release: 'canon' })), loaded = K.energy(sysFor({ release: 'loaded' }));
    var h = '<div class="tiles">' +
      tile('Energy per kg thrown', n(e.perKg / 1e6, 2) + ' <small>MJ/kg</small>', '= ' + n(e.kWhPerKg, 2) + ' kWh/kg of orbital energy', ' id="t-perkg"') +
      tile('Energy per throw', n(e.perThrow / 1e9, 0) + ' <small>GJ</small>', sci(e.perThrow, 3) + ' J for ' + n(s.m, 0) + ' kg', ' id="t-perthrow"') +
      tile('Reboost Δv per throw', n(l.dvEquiv, 1) + ' <small>m/s</small>', 'energy-equivalent, on the whole tether system', ' id="t-dv"') +
      tile('Tether system mass', n(s.M / 1e3, 1) + ' <small>t</small>', n(s.hubKg / 1e3, 1) + ' t hub + ' + n(s.fibreKg / 1e3, 1) + ' t fibre = ' + n(s.M / s.m, 0) + '× the payload', ' id="t-mass"') +
      '</div>';
    if (state.release === 'canon') {
      h += '<p>Split: <b>' + n(kinetic, 2) + '</b> MJ/kg of speed (½[(v<sub>orb</sub>+v<sub>tip</sub>)² − (v<sub>orb</sub>−v<sub>tip</sub>)²] = 2·v<sub>orb</sub>·v<sub>tip</sub>) plus <b>' + n(lift, 2) + '</b> MJ/kg of lift from r − L to r + L (μ/(r−L) − μ/(r+L)). <span class="tag cert">[Certain]</span> given the canon catch and release states.</p>';
    } else {
      h += '<p>With the release at the canon spin rate the payload gains ' + n(e.perKg / 1e6, 2) + ' MJ/kg, ' + n((1 - e.perKg / canon.perKg) * 100, 2) + ' % less than the canon release state would give it.</p>';
    }
    h += '<h3>The repository states this quantity four ways</h3><div class="tw"><table id="energy-table"><thead><tr><th>Where</th><th>MJ/kg</th><th class="wrap">What it is</th></tr></thead><tbody>' +
      '<tr class="hl"><td>this page, canon states</td><td>' + n(canon.perKg / 1e6, 2) + '</td><td class="wrap">orbital-energy gain from the lower-tip to the upper-tip state; what the tether loses</td></tr>' +
      '<tr><td><code>finance/skyhook_finance.py:215</code></td><td>' + n(canon.kinetic / 1e6, 2) + '</td><td class="wrap">2·v<sub>orb</sub>·v<sub>tip</sub>, the "momentum view": the speed term only, no lift</td></tr>' +
      '<tr><td><code>' + cite('mp001.mp001_mj_per_kg') + '</code></td><td>' + V('mp001.mp001_mj_per_kg') + '</td><td class="wrap">stated (' + V('mp001.mp001_kwh_per_kg') + ' kWh/kg); no reading of the canon reproduces it</td></tr>' +
      '<tr><td><code>' + cite('project_instructions.founding_mj_per_kg') + '</code></td><td>~' + V('project_instructions.founding_mj_per_kg') + '</td><td class="wrap">stated, no derivation</td></tr>' +
      '</tbody></table></div>' +
      '<p class="small">Idea 14 (Whose Earth) already reconciles these four in full, including a 144-reading sweep for 44.8. This page books the orbital-energy figure and does not re-argue it.</p>';
    var sL = sysFor({ release: 'loaded' });
    h += '<div class="verdict mid" id="loaded-note"><span class="ic" aria-hidden="true">!</span><div><b>The canon release state assumes an infinitely heavy tether.</b> At the canon spin rate this ' + n(sL.M / 1e3, 1) + ' t system lets a ' + n(sL.m, 0) +
      ' kg payload go at C3 ' + n(loaded.c3 / 1e6, 2) + ' km²/s² (apogee ' + (isFinite(loaded.apogeeAltKm) ? n(loaded.apogeeAltKm, 0) + ' km' : 'escape') + '), not the canon\'s ' + n(canon.c3 / 1e6, 2) + ' km²/s² (' +
      (isFinite(canon.apogeeAltKm) ? n(canon.apogeeAltKm, 0) + ' km' : 'escape') + '): the loaded tether turns about a centre of mass ' + n(sL.m * sL.L / (sL.M + sL.m) / 1e3, 2) + ' km below its own. Skyhook\'s own tether model agrees (section 3). <span class="tag">[Likely]</span></div></div>';
    el.innerHTML = h;
  }

  function verdictFor(tDays) {
    var k = 1 + MARGIN;
    if (k * tDays <= INT_LO) return { cls: 'ok', ic: '✓', text: 'meets the ' + INT_LO + '-day rule (and the ' + INT_HI + '-day one)' };
    if (k * tDays <= INT_HI) return { cls: 'mid', ic: '~', text: 'meets the ' + INT_HI + '-day end of the rule, not the ' + INT_LO + '-day end' };
    return { cls: 'no', ic: '✗', text: 'meets neither end of the ' + INT_LO + '–' + INT_HI + '-day rule' };
  }

  function renderBack(s, e) {
    var P = Math.pow(10, state.logP);
    $('power-out').textContent = power(P);
    $('eta-out').textContent = pct(state.eta);
    $('duty-out').textContent = n(state.duty, 2);
    var el = $('back-body');
    if (K.isRefusal(s)) { el.innerHTML = refusalHTML(s, 'Nothing to restore'); $('chart-rec') && ($('chart-rec').innerHTML = ''); return; }
    var E = e.perThrow;
    var t = K.recoverySeconds(E, P, state.eta, state.duty);
    var h = '';
    if (K.isRefusal(t)) {
      h += refusalHTML(t);
    } else {
      var v = verdictFor(t / DAY);
      h += '<div class="verdict ' + v.cls + '" id="rec-verdict"><span class="ic" aria-hidden="true">' + v.ic + '</span><div><b>' + n(t / DAY, 1) + ' days</b> to put one throw back at ' + power(P) + ', ' + pct(state.eta) + ', duty ' + n(state.duty, 2) +
        '. With the ' + pct(MARGIN) + ' margin that is ' + n((1 + MARGIN) * t / DAY, 1) + ' days: it ' + v.text + '. <span class="small">(' + cite('project_instructions.interval_lo_d') + ')</span></div></div>';
    }
    h += '<figure><div class="chart" id="chart-rec"></div><div class="legend">' +
      ETA_MP.map(function (eta, i) { return '<span><i class="l' + (i + 1) + '"></i>' + pct(eta) + ' (MP-001)</span>'; }).join('') +
      '<span><i class="lr"></i>the rule with margin: ' + INT_LO + ' and ' + INT_HI + ' days ÷ ' + n(1 + MARGIN, 1) + '</span></div>' +
      '<figcaption>Days to restore one throw against installed power, at duty ' + n(state.duty, 2) + ', for MP-001 §3a\'s efficiency ladder. Below a dashed line the rule is met. The dotted line is the power you set.</figcaption></figure>';
    // required power table
    h += '<h3>Installed power the sizing rule needs (margin included)</h3><div class="tw"><table id="req-table"><thead><tr><th>Efficiency</th><th>Duty</th><th>' + INT_LO + '-day</th><th>' + INT_HI + '-day</th><th>' + INT_MATURE + '-day (maturity)</th></tr></thead><tbody>';
    ETA_MP.forEach(function (eta) {
      DUTY_RB.forEach(function (d) {
        h += '<tr' + (Math.abs(eta - state.eta) < 1e-9 && Math.abs(d - state.duty) < 1e-9 ? ' class="hl"' : '') + '><td>' + pct(eta) + '</td><td>' + d + '</td>' +
          [INT_LO, INT_HI, INT_MATURE].map(function (T) { return '<td>' + power(K.requiredPower(E, eta, d, T * DAY, MARGIN)) + '</td>'; }).join('') + '</tr>';
      });
    });
    h += '</tbody></table></div>';
    var p1 = Number(V('project_instructions.ed_p_hi_mw')) * 1e6;
    var frac = p1 * ETA_MP[1] * DUTY_RB[1] * DAY / E;
    h += '<p>The founding document says ' + V('project_instructions.ed_p_lo_kw') + ' kW–' + V('project_instructions.ed_p_hi_mw') + ' MW "yield meaningful daily momentum restoration" (<code>' + cite('project_instructions.ed_p_lo_kw') +
      '</code>) and puts the hub\'s arrays at "hundreds of kW in Phase 2" (<code>docs/project_instructions.md:118</code>), and it calls this geometry "our Phase 2 reference design" (<code>:42</code>). At ' + power(p1) + ', ' + pct(ETA_MP[1]) + ' and duty ' + DUTY_RB[1] +
      ' a day restores <b id="frac-day">' + n(frac * 100, 1) + ' %</b> of one ' + n(s.m, 0) + ' kg throw at this tier. <span class="tag">[Likely]</span></p>';
    // workbook cadence
    h += '<h3>At the financial model\'s own cadence</h3><p class="small">The workbook\'s Assumptions sheet sets a mature cadence (row 11) and a power-chain efficiency (row 6) per ladder column. The sizing rule at one interval per catch, margin included:</p>' +
      '<div class="tw"><table id="cad-table"><thead><tr><th>Column</th><th>Catches/day</th><th>Efficiency</th>' + DUTY_RB.map(function (d) { return '<th>Power at duty ' + d + '</th>'; }).join('') +
      SPEC_POW.map(function (sp) { return '<th>Arrays at ' + sp + ' W/kg, duty ' + DUTY_RB[1] + '</th>'; }).join('') + '</tr></thead><tbody>';
    COLS.forEach(function (c) {
      var per = Number(WB['11'][c]), eta = Number(WB['6'][c]);
      var pw = DUTY_RB.map(function (d) { return K.requiredPower(E, eta, d, DAY / per, MARGIN); });
      h += '<tr><td>' + c + '</td><td>' + per + '</td><td>' + pct(eta) + '</td>' + pw.map(function (p) { return '<td>' + power(p) + '</td>'; }).join('') +
        SPEC_POW.map(function (sp) { return '<td>' + n(pw[DUTY_RB.length - 1] / sp / 1e3, 0) + ' t</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table></div><p class="small">Array specific power is <code>' + cite('reboost_bound.rb_specific_power_wkg') + '</code>\'s flagged bracket (arrays only: no PMAD, thermal or tether-current hardware). The finance model books reboost only as electricity in $/kg (<code>finance/skyhook_finance.py:215-216</code>), never as installed power or array mass; set against the ' +
      n(HUB0_KG / 1e3, 0) + ' t hub placeholder, the conservative column\'s arrays alone weigh ' + n(K.requiredPower(E, Number(WB['6'].Conservative), DUTY_RB[1], DAY / Number(WB['11'].Conservative), MARGIN) / SPEC_POW[SPEC_POW.length - 1] / HUB0_KG, 1) + '× as much at ' + SPEC_POW[SPEC_POW.length - 1] + ' W/kg. <span class="tag">[Likely]</span></p>';
    // full grid
    var rows = K.grid(E, { etas: ETA_MP, duties: DUTY_RB, powersW: POW_RB.concat(EXTRA_POW_KW).map(function (k) { return k * 1e3; }), intervalsS: [INT_LO * DAY, INT_HI * DAY], margin: MARGIN });
    h += '<details><summary>The full grid, in reboost_bound.py\'s format (' + rows.length + ' rows)</summary><div class="tw"><table><thead><tr><th>eta</th><th>duty</th><th>installed power kW</th><th>t_rec days</th><th>supportability</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + n(r.eta, 2) + '</td><td>' + r.duty + '</td><td>' + n(r.P / 1e3, 0) + '</td><td>' + n(r.tRecDays, 1) + '</td><td>' + r.support + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="small">Powers above ' + POW_RB[POW_RB.length - 1] + ' kW are this page\'s extension of reboost_bound.py\'s ' + POW_RB.join(' / ') + ' kW, so the grid reaches the rule [FLAGGED]. "both" means 1.3 × t_rec fits ' + INT_LO + ' days.</p></details>';
    el.innerHTML = h;
    // chart
    var xs = [], i;
    for (i = 0; i <= 80; i++) xs.push(Math.pow(10, 4 + 4 * i / 80));
    var yMax = 2000, yMin = 0.1;
    lineChart($('chart-rec'), {
      w: 640, h: 300, aria: 'Recovery time in days against installed power for three efficiencies',
      x: { min: 1e4, max: 1e8, log: true, ticks: [1e4, 1e5, 1e6, 1e7, 1e8], fmt: function (v) { return power(v); }, label: 'installed power' },
      y: { min: yMin, max: yMax, log: true, ticks: [0.1, 1, 10, 100, 1000], fmt: function (v) { return sig(v, 1); }, label: 'days to restore one throw' },
      bands: [{ y0: yMin, y1: INT_HI / (1 + MARGIN) }],
      hlines: [{ y: INT_LO / (1 + MARGIN), cls: 'rule', label: INT_LO + ' d rule' }, { y: INT_HI / (1 + MARGIN), cls: 'rule', label: INT_HI + ' d rule' }],
      vline: { x: Math.pow(10, state.logP) },
      series: ETA_MP.map(function (eta, j) {
        return { cls: 'ser' + (j + 1), dotCls: 'dot' + (j + 1), pts: xs.map(function (x) { return [x, K.recoverySeconds(E, x, eta, state.duty) / DAY]; }),
          mark: [P, K.recoverySeconds(E, P, eta, state.duty) / DAY] };
      }),
      tip: function (xv) {
        return { x: xv, html: '<b>' + power(xv) + '</b>, duty ' + n(state.duty, 2) + '<br>' + ETA_MP.map(function (eta) { return pct(eta) + ': ' + sig(K.recoverySeconds(E, xv, eta, state.duty) / DAY, 3) + ' d'; }).join('<br>') };
      }
    });
  }

  function renderOrbit(s, l) {
    $('floor-out').textContent = state.floorKm;
    var el = $('orbit-body'), fl = $('floor-body');
    if (K.isRefusal(s)) {
      el.innerHTML = refusalHTML(s, 'No ledger'); fl.innerHTML = ''; $('chart-throws').innerHTML = ''; $('legend-throws').innerHTML = ''; $('cap-throws').textContent = '';
      $('models-body').innerHTML = ''; $('twin-run').disabled = true; return;
    }
    $('twin-run').disabled = twinBusy;
    if (K.isRefusal(l)) { el.innerHTML = refusalHTML(l, 'The tether has no orbit after this throw'); fl.innerHTML = ''; return; }
    el.innerHTML = '<div class="tiles">' +
      tile('Semi-major axis drop', n(l.da / 1e3, 1) + ' <small>km</small>', 'from ' + n(s.R / 1e3 - s.RE / 1e3, 0) + ' km circular; Δv to undo ≈ ' + n(l.dvEquiv, 1) + ' m/s', ' id="t-da"') +
      tile('At the throw point', '−' + n(l.apogeeDrop / 1e3, 1) + ' <small>km</small>', 'the centre of mass ends 2mL/(M+m) lower; this becomes the ' + l.throw.throwPointIs, ' id="t-throwpt"') +
      tile('Half an orbit later', '−' + n(l.perigeeDrop / 1e3, 1) + ' <small>km</small>', 'centre of mass at the new perigee, ' + n(l.halfOrbitS / 60, 0) + ' min after the throw', ' id="t-perigee"') +
      tile('Lower tip, lowest point', n(l.tipLowestAfter / 1e3, 1) + ' <small>km</small>', 'down from ' + n(l.tipAltBefore / 1e3, 0) + ' km; perigee − L, within a few km depending on spin phase', ' id="t-tip"') +
      '</div><p class="small">The orbit drop scales as 1/M: ballast at the hub "improves catch dynamics" (<code>docs/project_instructions.md:118</code>), and so does the heavier conservative tether. The lighter, less-derated tethers are the hardest to keep up. <span class="tag">[Likely]</span></p>';
    var floorM = state.floorKm * 1e3;
    var ca = K.catchesToFloor(s, floorM, 'apogee'), cp = K.catchesToFloor(s, floorM, 'perigee');
    var hub = K.minHubForFloor(revA, { tier: state.tier, derate: state.derate, payloadKg: state.payloadKg, earthRadiusKm: RE, release: state.release }, floorM);
    if (K.isRefusal(ca)) {
      fl.innerHTML = refusalHTML(ca, 'No count');
    } else {
      var word = function (c) { return c.count >= 500 ? '500 or more' : String(c.count); };
      fl.innerHTML = '<div class="verdict ' + (ca.count > 0 ? 'ok' : 'no') + '" id="floor-verdict"><span class="ic" aria-hidden="true">' + (ca.count > 0 ? '✓' : '✗') + '</span><div><b>' + word(ca) + '</b> throw' + (ca.count === 1 ? '' : 's') +
        ' with no reboost before the lower tip would pass below ' + state.floorKm + ' km if every catch is at apogee; <b>' + word(cp) + '</b> if every catch is at perigee.</div></div>' +
        '<p>Smallest hub that keeps one throw above ' + state.floorKm + ' km: <b id="min-hub">' + (K.isRefusal(hub) ? 'none' : n(hub / 1e3, 0) + ' t') + '</b>' +
        (K.isRefusal(hub) ? '' : ' (system ' + n((hub + s.fibreKg) / 1e3, 0) + ' t, ' + n((hub + s.fibreKg) / s.m, 0) + '× the payload)') + '.</p>';
    }
    // throws chart
    var seqA = K.throwSequence(s, 'apogee', 10), seqP = K.throwSequence(s, 'perigee', 10);
    var nMax = Math.max(4, Math.min(10, Math.max(seqA.length, seqP.length)));
    var top = Math.ceil((s.R - s.L - s.RE) / 1e3 / 50) * 50;
    lineChart($('chart-throws'), {
      w: 640, h: 260, aria: 'Lowest lower-tip altitude after each throw with no reboost', points: true,
      x: { min: 0, max: nMax, ticks: Array.from({ length: nMax + 1 }, function (_, i) { return i; }), fmt: function (v) { return String(v); }, label: 'throws with no reboost' },
      y: { min: 0, max: top, ticks: [0, 50, 100, 150, 200, 250, 300].filter(function (v) { return v <= top; }), fmt: function (v) { return v + ' km'; }, label: 'lower tip, lowest' },
      hlines: [{ y: state.floorKm, cls: 'floor', label: 'floor ' + state.floorKm + ' km' }],
      series: [
        { cls: 'ser1', dotCls: 'dot1', pts: seqA.map(function (p) { return [p.n, p.tipLowest / 1e3]; }) },
        { cls: 'ser2', dotCls: 'dot2', pts: seqP.map(function (p) { return [p.n, p.tipLowest / 1e3]; }) }
      ],
      tip: function (xv) {
        var i = Math.round(xv);
        var a = seqA[i], p = seqP[i];
        if (!a && !p) return null;
        return { x: i, html: '<b>after ' + i + ' throw' + (i === 1 ? '' : 's') + '</b><br>catch at apogee: ' + (a ? n(a.tipLowest / 1e3, 1) + ' km' : 'tip below ground') + '<br>catch at perigee: ' + (p ? n(p.tipLowest / 1e3, 1) + ' km' : 'tip below ground') };
      }
    });
    $('legend-throws').innerHTML = '<span><i class="l1"></i>every catch at apogee</span><span><i class="l2"></i>every catch at perigee</span><span><i class="lf"></i>your floor</span>';
    $('cap-throws').textContent = 'A line stops before the throw that would put the lower tip\'s lowest point below the ground; the model means nothing there, and drag would have ended it sooner.';
    renderModels(s, l);
  }

  function renderModels(s, l) {
    var lc = K.ledger(sysFor({ release: 'canon' })), ll = K.ledger(sysFor({ release: 'loaded' }));
    var ec = K.energy(sysFor({ release: 'canon' })), el2 = K.energy(sysFor({ release: 'loaded' }));
    var imp = lc.impulsive;
    var tw = twinResult && twinKey === configKey() ? twinResult : null;
    var stale = twinResult && !tw;
    var tcell = function (v) { return tw ? v(tw) : (stale ? '<span class="small">ran for another setup</span>' : '<span class="small">not run</span>'); };
    var h = '<div class="tw"><table id="models-table"><thead><tr><th></th><th>Ledger, canon release</th><th>Ledger, at canon spin</th><th>Proposal\'s impulsive model</th><th>Skyhook\'s tether model</th></tr></thead><tbody>' +
      '<tr><td>Semi-major axis drop</td><td>' + n(lc.da / 1e3, 2) + ' km</td><td>' + n(ll.da / 1e3, 2) + ' km</td><td>' + n(imp.da / 1e3, 2) + ' km</td><td id="tw-da">' + tcell(function (t) { return n(t.daAtRelease / 1e3, 2) + ' km at release; ' + n(t.da / 1e3, 2) + ' km mean over the orbit'; }) + '</td></tr>' +
      '<tr><td>Centre of mass, half an orbit later</td><td>−' + n(lc.perigeeDrop / 1e3, 1) + ' km</td><td>−' + n(ll.perigeeDrop / 1e3, 1) + ' km</td><td>−' + n(imp.perigeeDrop / 1e3, 1) + ' km</td><td>' + tcell(function (t) { return '−' + n(t.perigeeDrop / 1e3, 1) + ' km (lowest over the orbit)'; }) + '</td></tr>' +
      '<tr><td>Lower tip, lowest</td><td>' + n(lc.tipLowestAfter / 1e3, 1) + ' km</td><td>' + n(ll.tipLowestAfter / 1e3, 1) + ' km</td><td>' + n(imp.tipLowestAfter / 1e3, 1) + ' km</td><td id="tw-tip">' + tcell(function (t) { return n(t.lowestNodeAltM / 1e3, 1) + ' km (lowest node)'; }) + '</td></tr>' +
      '<tr><td>Payload release C3</td><td>' + n(ec.c3 / 1e6, 2) + '</td><td>' + n(el2.c3 / 1e6, 2) + '</td><td>not modelled</td><td id="tw-c3">' + tcell(function (t) { return n(t.payloadC3 / 1e6, 2); }) + '</td></tr>' +
      '<tr><td>Energy check</td><td colspan="3" class="wrap">the tether loses m·ΔE: ' + sci(ec.perThrow, 4) + ' J (canon)</td><td id="tw-energy">' + tcell(function (t) { return 'tether lost ' + n(t.tetherEnergyLossPerKgPayload / 1e6, 3) + ' MJ per payload kg; payload gained ' + n(t.payloadGainPerKg / 1e6, 3) + '; integrator drift ' + t.energyDriftRel.toExponential(0); }) + '</td></tr>' +
      '</tbody></table></div><p class="small">The impulsive model (two co-located impulses m·v<sub>tip</sub>/(M+m) + m·v<sub>tip</sub>/M, perigee drop 2Δa) leaves out the payload\'s lift through the gravity well, about 12 % of the energy, and the centre of mass\'s drop at the flip. The twin is <code>tools/twin/physics.js</code> verbatim (17 nodes, RK4, step 0.1 s), with the payload added to the lower-tip node at the canon catch state and removed at the top of the swing.</p>';
    $('models-body').innerHTML = h;
  }

  function runTwin() {
    var s = sysFor();
    if (K.isRefusal(s) || twinBusy) return;
    twinBusy = true;
    $('twin-run').disabled = true;
    var key = configKey();
    var run = TC.start(TW, revA, { vTipKms: s.vTip / 1e3, derate: Number(state.derate), hubKg: s.hubKg, payloadKg: s.m, dt: 0.1 });
    var t0 = Date.now();
    (function slice() {
      var r = run.advance(4000);
      if (r.done) {
        twinResult = r; twinKey = key; twinBusy = false;
        $('twin-progress').textContent = 'done: ' + n(r.steps, 0) + ' steps in ' + n((Date.now() - t0) / 1000, 1) + ' s';
        render();
        return;
      }
      $('twin-progress').textContent = (r.phase === 'swing' ? 'swinging the payload up… ' : 'flying one orbit… ') + n(r.steps, 0) + ' steps';
      setTimeout(slice, 0);
    })();
  }

  function renderChecks() {
    var h = '';
    // canon pins
    var tiers = Object.keys(K.TIERS);
    var rows = tiers.map(function (t) {
      var s = K.system(revA, { tier: t, derate: '0.3', hubKg: HUB0_KG, earthRadiusKm: RE });
      var e = K.energy(s);
      var k = t === 'reference' ? revA.kinematics : t === 'cislunar' ? revA.kinematics.cislunar_revenue_gated_option : revA.kinematics.phase3_growth_option;
      var apo = k.apogee_altitude_km;
      var c3ok = Math.round(e.c3 / 1e4) / 100 === k.c3_kms2;
      var apoOk = apo == null ? e.apogeeAltKm === Infinity : Math.round(e.apogeeAltKm) === apo;
      return '<tr><td>' + K.TIERS[t].label + '</td><td>' + n(e.c3 / 1e6, 3) + '</td><td>' + n(k.c3_kms2, 2) + '</td><td>' + (isFinite(e.apogeeAltKm) ? n(e.apogeeAltKm, 0) : 'escape') + '</td><td>' + (apo == null ? '—' : n(apo, 0)) + '</td><td class="' + (c3ok && apoOk ? 'yes' : 'no') + '">' + (c3ok && apoOk ? '✓ match' : '✗ differ') + '</td></tr>';
    });
    h += '<h3>The canon\'s own release numbers</h3><div class="tw"><table id="pins-table"><thead><tr><th>Tier</th><th>C3 here</th><th>C3 canon</th><th>Apogee here, km</th><th>Apogee canon</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<p class="small">On a ' + n(RE, 0) + ' km Earth (<code>' + cite('skyhook_physics.r_earth_km') + '</code>), which is the one these canon values sit on. <code>rev_a.json</code>\'s <code>com_radius_km</code> ' + revA.orbital.com_radius_km + ' implies ' + n(revA.orbital.com_radius_km - revA.orbital.com_altitude_km, 0) +
      ' km instead (found by idea 01); on that Earth one throw costs ' + n(K.energy(K.system(revA, { tier: 'reference', derate: '0.3', hubKg: HUB0_KG, earthRadiusKm: revA.orbital.com_radius_km - revA.orbital.com_altitude_km })).perKg / 1e6, 2) + ' MJ/kg.</p>';
    // MXER golden
    var sx = K.mxerSystem(D.mxer, RE, MU);
    var ex = K.energy(sx);
    var golden = Number(V('test_analysis_layer.golden_dE_j'));
    var rGeo = Number(V('reboost_bound.r_geo_km').replace(/_/g, ''));
    var rbE = K.reboostBoundEnergy(D.mxer, RE, MU, rGeo);
    var okG = Math.abs(ex.perThrow / golden - 1) < Number(V('test_analysis_layer.golden_rel'));
    h += '<h3>reboost_bound.py\'s golden, through this kernel</h3><p id="golden-line">The same energy function on the DRAFT in-space fork (<code>params/service_mxer_draft.json</code>: catch at its CoM perigee, ' + D.mxer.tether.L_half_km + ' km half-length, ' + D.mxer.tether.v_tip_kms + ' km/s tip) gives <b>' + sci(ex.perThrow, 6) + ' J</b>; reboost_bound.py\'s own route (circular catch orbit in, GEO-transfer ellipse out) gives ' + sci(rbE, 6) +
      ' J; the pinned golden (<code>' + cite('test_analysis_layer.golden_dE_j') + '</code>) is ' + sci(golden, 6) + ' J. <span class="' + (okG ? 'yes' : 'no') + '">' + (okG ? '✓ within its rel ' + V('test_analysis_layer.golden_rel') : '✗') + '</span></p>';
    // grid reproduction
    var payloadT = D.mxer.payload_class.reference_payload_t;
    var iv = function (tyr) { return 365.25 / (tyr / payloadT) * DAY; };
    var g = K.grid(ex.perThrow, { etas: ETA_RB, duties: DUTY_RB, powersW: POW_RB.map(function (k) { return k * 1e3; }), intervalsS: [iv(56), iv(24)], margin: 0 });
    var match = 0, lab = 0;
    D.reboostBoundFindings.grid.forEach(function (p) {
      var r = g.filter(function (x) { return x.eta === p.eta && x.duty === p.duty && x.P === p.power_kw * 1e3; })[0];
      if (r && r.tRecDays.toFixed(1) === p.t_rec_days.toFixed(1)) match++;
      if (r && r.support === ({ both: 'both', '24 only': n(iv(24) / DAY, 1) + ' d only', neither: 'neither' })[p.support]) lab++;
    });
    var pm = D.reboostBoundFindings.minPower56.filter(function (p) { return (K.requiredPower(ex.perThrow, p.eta, p.duty, iv(56), 0) / 1e3).toFixed(1) === p.power_kw.toFixed(1); }).length;
    h += '<p id="grid-line">Its published grid (<code>finance/REBOOST_BOUND_FINDINGS.md</code>): <b>' + match + ' of ' + D.reboostBoundFindings.grid.length + '</b> recovery times and ' + lab + ' of ' + D.reboostBoundFindings.grid.length + ' supportability labels reproduced to the printed decimal, and <b>' + pm + ' of ' + D.reboostBoundFindings.minPower56.length + '</b> minimum powers.</p>';
    var mx = K.mxerLedger(sx);
    h += '<h3>The in-space fork\'s own ledger <span class="tag spec">DRAFT config</span></h3><p id="mxer-ledger">The fork\'s tether is ' + n(sx.M / 1e3, 1) + ' t (' + D.mxer.capex_inputs.hub_mass_t + ' t hub, the draft\'s floor, plus ' + n(sx.fibreKg / 1e3, 1) + ' t fibre), only ' + n(sx.M / sx.m, 1) + '× its ' + n(sx.m / 1e3, 0) + ' t payload. One throw at its perigee lowers its semi-major axis by <b>' + n(mx.da / 1e3, 0) + ' km</b> and its apogee by <b>' + n(mx.apogeeDrop / 1e3, 0) +
      ' km</b> (from ' + n(D.mxer.tether_com_orbit.apogee_altitude_km, 0) + ' km altitude). reboost_bound.py books the energy this costs but not where the orbit goes; ED thrust near perigee would have to rebuild the apogee between catches. <span class="tag">[Likely]</span></p>';
    $('checks-body').innerHTML = h;
  }

  function renderRefused() {
    var h = refusalHTML(K.pricePerKg(revA), 'A price per kilogram');
    var c = K.system(revA, { tier: 'cislunar', derate: '0.15', hubKg: HUB0_KG, earthRadiusKm: RE });
    h += refusalHTML(c, 'The 2.8 and 3.5 km/s tiers at less than 30 % derate');
    h += '<div class="refusal"><div class="h">How the energy goes back in <span class="tag">out_of_envelope</span></div><dl><dt>Why</dt><dd>This is an energy bound. Plasma density, field geometry, current collection, eclipse, and whether the spin and the orbit can be restored together are folded into the efficiency and duty brackets, as reboost_bound.py\'s scope line says of its own bound.</dd><dt>What would help</dt><dd>the orbit-integrated ED reboost model the external review asked for (named as open in that scope line)</dd></dl></div>';
    $('refused-body').innerHTML = h;
  }

  function renderSources() {
    var c = D.skyhookCommitShort;
    $('commit').textContent = 'params/rev_a.json @ ' + c;
    var items = [
      ['Orbit, tether, tip speeds, fibre masses, design payload', 'params/rev_a.json (whole-file snapshot)'],
      ['Earth radius ' + n(RE, 0) + ' km', cite('skyhook_physics.r_earth_km')],
      ['Hub mass ' + n(HUB0_KG / 1e3, 0) + ' t [Speculative]', cite('tether_dynamics.hub_mass_kg') + ' (Phase 2 range ' + V('project_instructions.hub_lo_t') + '–' + V('project_instructions.hub_hi_t') + ' t, ' + cite('project_instructions.hub_lo_t') + ')'],
      ['Sizing rule ' + INT_LO + '–' + INT_HI + ' days, ' + INT_MATURE + ' at maturity, ' + pct(MARGIN) + ' margin', cite('project_instructions.interval_lo_d')],
      ['Efficiency ladder ' + ETA_MP.map(pct).join(' / '), cite('mp001.eta_lo_pct')],
      ['Duty ' + DUTY_RB.join(' / ') + ', powers ' + POW_RB.join(' / ') + ' kW, array W/kg ' + SPEC_POW.join(' / '), 'finance/reboost_bound.py:30-33'],
      ['Workbook cadence, efficiency, mass factor', 'tools/financial/skyhook_financial_model.xlsx, Assumptions rows 6, 9, 11 (read with zipfile)'],
      ['Golden ' + V('test_analysis_layer.golden_dE_j') + ' J', cite('test_analysis_layer.golden_dE_j')],
      ['In-space fork config', 'params/service_mxer_draft.json (excerpt)'],
      ['Tether model', 'tools/twin/physics.js (verbatim snapshot; a classic-script copy for the page)']
    ];
    var h = '<p>Skyhook commit <code>' + c + '</code>. Every file is a snapshot in this folder with a provenance sidecar (repository, path, commit, blob, sha256).</p><ul class="src">' +
      items.map(function (it) { return '<li>' + esc(it[0]) + ': <code>' + esc(it[1]) + '</code></li>'; }).join('') + '</ul>' +
      '<p>reboost_bound.py\'s scope line, which this page inherits:</p><blockquote>' + esc(D.reboostBoundFindings.scopeLine) + '</blockquote>' +
      '<details><summary>The cited lines, as read</summary><ul class="src">' +
      Object.keys(D.lines).map(function (k) {
        var b = D.lines[k];
        return Object.keys(b.lines).map(function (no) { return '<li><code>' + esc(b.path) + ':' + no + '</code> ' + esc(b.lines[no].trim().slice(0, 260)) + (b.lines[no].trim().length > 260 ? '…' : '') + '</li>'; }).join('');
      }).join('') + '</ul></details>';
    $('sources-body').innerHTML = h;
  }

  function render() {
    var s = sysFor();
    var e = K.energy(s);
    var l = K.ledger(s);
    renderCost(s, e, K.isRefusal(l) ? { dvEquiv: NaN } : l);
    renderBack(s, e);
    renderOrbit(s, l);
    var designHint = 'Every tier is sized for ' + n(DESIGN_KG, 0) + ' kg (rev_a.json payload_mass_kg_for_tonnage); a lighter payload uses the same tether.';
    $('payload-hint').textContent = designHint;
  }

  drawControls();
  drawPresets();
  syncInputs();
  wireInputs();
  renderChecks();
  renderRefused();
  renderSources();
  render();
})();
