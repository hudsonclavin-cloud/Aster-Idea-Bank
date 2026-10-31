/* Mixture page controller. All physics is in mixture.js; this file wires inputs, the chart and the handoff. */
(function () {
  'use strict';
  var M = window.Mixture, P = window.MixturePresets, D = window.PROPELLANT_DENSITIES, MEAS = window.MEASURED_CSTAR;
  var db = M.parseThermo(window.THERMO_EXCERPT);
  var THERMO = { repo: 'https://github.com/nasa/cea', commit: '2f79a647e85737742fb08a127da00d1ea1d069da', path: 'data/thermo.inp', sha256: 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363' };
  var FT = 0.3048;
  var $ = function (id) { return document.getElementById(id); };
  var LABEL = {}, DEFT = {};
  P.COMPONENTS.forEach(function (c) { LABEL[c.name] = c.label; DEFT[c.name] = c.T; });
  var NPTS = 41;

  var METRICS = [
    { id: 'cstar', label: 'c*', unit: 'm/s', d: 0, get: function (r) { return r.cstar; } },
    { id: 'Tc', label: 'Chamber T', unit: 'K', d: 0, get: function (r) { return r.chamber.T; } },
    { id: 'M', label: 'Molar mass', unit: 'g/mol', d: 2, get: function (r) { return r.chamber.M * 1000; } },
    { id: 'gs', label: 'γs', unit: '', d: 4, get: function (r) { return r.chamber.gamma_s; } },
    { id: 'rho', label: 'Bulk density', unit: 'kg/m³', d: 0, dens: true },
    { id: 'rhoc', label: 'Density × c*', unit: 'Mg/(m²·s)', d: 3, dens: true },
  ];

  var state = { presetId: null, oxidizer: [], fuel: [], of: 2, pc: P.PC_DEFAULT, metric: 'cstar', range: [1, 4] };
  var current = null, curves = null, dens = null, peak = null, stoich = NaN;
  var curveTimer = 0;

  // ------------------------------------------------------------------ helpers
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function clone(side) { return side.map(function (p) { return { name: p.name, w: p.w, T: p.T }; }); }
  function prop() { return { oxidizer: state.oxidizer, fuel: state.fuel }; }
  function sameSide(a, b) {
    if (a.length !== b.length) return false;
    return a.every(function (p, i) { return p.name === b[i].name && Math.abs(p.w - b[i].w) < 1e-9; });
  }
  function matchPreset() {
    for (var i = 0; i < P.PRESETS.length; i++) {
      var pr = P.PRESETS[i];
      if (sameSide(pr.oxidizer, state.oxidizer) && sameSide(pr.fuel, state.fuel)) return pr;
    }
    return null;
  }
  function presetById(id) { return P.PRESETS.filter(function (p) { return p.id === id; })[0] || null; }

  // ------------------------------------------------------------------ O/F and pressure scales
  function ofToSlider(of) { return Math.round((of - state.range[0]) / (state.range[1] - state.range[0]) * 1000); }
  function sliderToOf(v) { return state.range[0] + (state.range[1] - state.range[0]) * v / 1000; }
  var LPMIN = Math.log(P.PC_MIN), LPMAX = Math.log(P.PC_MAX);
  function pcToSlider(pc) { return Math.round((Math.log(pc) - LPMIN) / (LPMAX - LPMIN) * 1000); }
  function sliderToPc(v) { return Math.exp(LPMIN + (LPMAX - LPMIN) * v / 1000); }
  function roundPc(pc) { var b = pc / 1e5; return (b < 10 ? Math.round(b * 100) / 100 : b < 100 ? Math.round(b * 10) / 10 : Math.round(b)) * 1e5; }

  function customRange() {
    var st = M.stoichiometricOF(db, state.oxidizer, state.fuel);
    if (st > 0) return [Math.max(0.05, +(st * 0.25).toFixed(2)), +(st * 1.5).toFixed(2)];
    return [0.5, 10];
  }

  // ------------------------------------------------------------------ the blend editor
  function renderSide(side) {
    var box = $('side-' + side).querySelector('.rows');
    box.textContent = '';
    state[side].forEach(function (p, i) {
      var sel = el('select', { 'aria-label': side + ' component ' + (i + 1) });
      P.COMPONENTS.forEach(function (c) {
        var o = el('option', { value: c.name, text: c.label, title: c.name });
        if (c.name === p.name) o.selected = true;
        sel.appendChild(o);
      });
      if (!LABEL[p.name]) { var o2 = el('option', { value: p.name, text: p.name }); o2.selected = true; sel.appendChild(o2); }
      sel.addEventListener('change', function () { p.name = sel.value; p.T = DEFT[sel.value]; afterComposition(); });
      var num = el('input', { type: 'number', min: '0', max: '100', step: '0.1', inputmode: 'decimal', 'aria-label': 'Mass percent of ' + (LABEL[p.name] || p.name) + ' in the ' + side });
      num.value = +(p.w * 100).toFixed(4);
      num.addEventListener('input', function () { var v = parseFloat(num.value); p.w = isFinite(v) ? v / 100 : NaN; afterComposition(); });
      var rm = el('button', { type: 'button', 'aria-label': 'Remove ' + (LABEL[p.name] || p.name) + ' from the ' + side, text: '×' });
      rm.addEventListener('click', function () {
        state[side].splice(i, 1);
        if (state[side].length === 1) state[side][0].w = 1;
        renderSide(side); afterComposition();
      });
      box.appendChild(el('div', { class: 'comp-row' }, [sel, num, rm]));
    });
    sideSum(side);
  }
  function sideSum(side) {
    var s = state[side].reduce(function (a, p) { return a + (isFinite(p.w) ? p.w : NaN); }, 0);
    var tag = $('side-' + side).querySelector('.side-sum');
    var ok = Math.abs(s - 1) <= 1e-6;
    tag.textContent = state[side].length ? 'Total ' + (isFinite(s) ? fmt(s * 100, 1) : '?') + ' %' + (ok ? '' : ' (must be 100 %)') : 'No component';
    tag.className = 'side-sum' + (ok ? '' : ' bad');
  }
  function afterComposition() {
    sideSum('oxidizer'); sideSum('fuel');
    var pr = matchPreset();
    state.presetId = pr ? pr.id : 'custom';
    $('preset').value = state.presetId;
    state.range = pr ? pr.ofRange.slice() : customRange();
    presetNote();
    recomputeAll();
  }

  function presetNote() {
    var pr = presetById(state.presetId);
    var t = pr ? (pr.note || '') : 'Custom blend: the chart spans 0.25 to 1.5 times the stoichiometric O/F. Components with no density on file make the density refuse.';
    if (pr) t = (t ? t + ' ' : '') + 'Checked against NASA CEA over O/F ' + pr.ofRange[0] + '–' + pr.ofRange[1] + '.';
    $('presetNote').textContent = t;
  }

  // ------------------------------------------------------------------ computing
  function computeCurrent() {
    // A cold start every time (about a millisecond), so the page's numbers are exactly what the kernel gives
    // for these inputs from scratch, the same as a test or the next module recomputing them.
    current = M.rocket(db, prop(), state.of, state.pc);
    dens = { oxidizer: M.sideDensity(D, state.oxidizer, 'oxidizer'), fuel: M.sideDensity(D, state.fuel, 'fuel') };
    stoich = M.stoichiometricOF(db, state.oxidizer, state.fuel);
  }
  function bulkAt(of) {
    if (!dens || dens.oxidizer.refusal || dens.fuel.refusal) return NaN;
    return M.bulkDensity(dens.oxidizer.value, dens.fuel.value, of);
  }
  function metricValue(m, r, of) {
    if (m.id === 'rho') return bulkAt(of);
    if (!r || r.refusal) return NaN;
    if (m.id === 'rhoc') return bulkAt(of) * r.cstar / 1e6;
    return m.get(r);
  }
  function computeCurves() {
    var xs = [];
    for (var i = 0; i < NPTS; i++) xs.push(state.range[0] + (state.range[1] - state.range[0]) * i / (NPTS - 1));
    curves = { xs: xs };
    curves.main = M.sweep(db, prop(), state.pc, xs);
    curves.low = M.sweep(db, prop(), state.pc / 10, xs);
    peak = M.maxCstar(db, prop(), state.pc, state.range[0], state.range[1]);
    if (!isFinite(peak.cstar)) peak = null;
  }
  function recomputeAll() {
    computeCurrent();
    computeCurves();
    render();
  }
  function scheduleCurves() {
    computeCurrent();
    renderNumbers();
    if (curveTimer) return;
    curveTimer = requestAnimationFrame(function () { curveTimer = 0; computeCurves(); renderChart(); });
  }

  // ------------------------------------------------------------------ rendering: inputs
  function syncInputs() {
    var ofR = $('ofRange'), ofN = $('ofNum'), pcR = $('pcRange'), pcN = $('pcNum');
    ofR.value = Math.max(0, Math.min(1000, ofToSlider(state.of)));
    if (document.activeElement !== ofN) ofN.value = +state.of.toFixed(3);
    pcR.value = Math.max(0, Math.min(1000, pcToSlider(state.pc)));
    if (document.activeElement !== pcN) pcN.value = +(state.pc / 1e5).toFixed(3);
    var env = M.PC_ENVELOPE;
    $('pcNote').textContent = !isFinite(state.pc) ? 'Type a pressure in bar.' :
      String(+(state.pc / 1e6).toPrecision(4)) + ' MPa' + (state.pc >= env[0] && state.pc <= env[1] ? '' : ' — outside the ' + env[0] / 1e5 + '–' + env[1] / 1e5 + ' bar checked against NASA CEA, so refused');
  }

  function tile(k, v, u, c, opts) {
    opts = opts || {};
    var t = el('div', { class: 'tile' + (opts.hero ? ' hero' : '') + (opts.refused ? ' refused' : '') });
    t.appendChild(el('div', { class: 'k', text: k }));
    var vv = el('div', { class: 'v' }, [v]);
    if (u && !opts.refused) vv.appendChild(el('span', { class: 'u', text: u }));
    t.appendChild(vv);
    if (c) t.appendChild(el('span', { class: 'c', text: c, title: 'confidence class' }));
    if (opts.title) t.title = opts.title;
    return t;
  }

  function renderNumbers() {
    syncInputs();
    var box = $('refusals');
    box.textContent = '';
    var refs = [];
    if (current.refusal) refs.push(['The chamber state', current.refusal]);
    ['oxidizer', 'fuel'].forEach(function (s) { if (dens[s].refusal) refs.push(['The ' + s + ' density', dens[s].refusal]); });
    refs.forEach(function (r) {
      box.appendChild(el('div', { class: 'refusal' }, [el('b', { text: '⚠ ' + r[0] + ' is refused (' + r[1].code + ')' }), el('span', { text: r[1].reason }), el('div', { class: 'help', text: 'What would help: ' + r[1].what_would_help })]));
    });
    var tiles = $('tiles');
    tiles.textContent = '';
    var ok = !current.refusal;
    var ch = ok ? current.chamber : null, th = ok ? current.throat : null;
    var R = function (k, f, d, u) { return ok ? tile(k, fmt(f(), d), u, 'derived') : tile(k, 'refused', '', null, { refused: true }); };
    tiles.appendChild(ok ? tile('c* (characteristic velocity)', fmt(current.cstar, 1), 'm/s', 'derived', { hero: true }) : tile('c* (characteristic velocity)', 'refused', '', null, { refused: true, hero: true }));
    tiles.appendChild(R('Chamber temperature', function () { return ch.T; }, 1, 'K'));
    tiles.appendChild(R('Molar mass', function () { return ch.M * 1000; }, 3, 'g/mol'));
    tiles.appendChild(R('γs (equilibrium)', function () { return ch.gamma_s; }, 4, ''));
    tiles.appendChild(R('γ (frozen)', function () { return ch.gamma_fr; }, 4, ''));
    tiles.appendChild(R('cp (equilibrium)', function () { return ch.cp_eq / 1000; }, 3, 'kJ/(kg·K)'));
    tiles.appendChild(R('Throat pc/pt', function () { return current.pressureRatio; }, 4, ''));
    tiles.appendChild(R('Throat temperature', function () { return th.T; }, 1, 'K'));
    tiles.appendChild(R('Closed-form c* with γs', function () { return current.cstarClosedForm; }, 1, 'm/s'));
    var b = bulkAt(state.of);
    tiles.appendChild(isFinite(b) ? tile('Bulk propellant density', fmt(b, 1), 'kg/m³', dens.oxidizer.confidence === 'measured' && dens.fuel.confidence === 'measured' ? 'derived from measured' : 'derived') : tile('Bulk propellant density', 'refused', '', null, { refused: true }));
    ['oxidizer', 'fuel'].forEach(function (s) {
      var d = dens[s];
      tiles.appendChild(d.refusal ? tile(s[0].toUpperCase() + s.slice(1) + ' density', 'refused', '', null, { refused: true }) : tile(s[0].toUpperCase() + s.slice(1) + ' density', fmt(d.value, 1), 'kg/m³', d.confidence, { title: d.source + '; ' + d.mixing + (d.range ? '; range ' + d.range.join('–') : '') }));
    });
    tiles.appendChild(isFinite(stoich) ? tile('Stoichiometric O/F', fmt(stoich, 3), '', 'derived') : tile('Stoichiometric O/F', 'n/a', '', null, { refused: true }));
    tiles.appendChild(isFinite(stoich) && state.of > 0 && isFinite(state.of) ? tile('Equivalence ratio φ', fmt(stoich / state.of, 3), '', 'derived', { title: 'φ > 1 is fuel-rich' }) : tile('Equivalence ratio φ', 'n/a', '', null, { refused: true }));
    renderComposition();
    renderHandoff();
  }

  function renderComposition() {
    var box = $('comp');
    box.textContent = '';
    if (current.refusal) { box.appendChild(el('p', { class: 'small', text: 'No composition: the chamber state is refused.' })); return; }
    var x = current.chamber.x, keys = Object.keys(x).sort(function (a, b) { return x[b] - x[a]; });
    var other = 0, shown = 0;
    keys.forEach(function (k) {
      if (x[k] < 1e-4) { other += x[k]; return; }
      shown++;
      var bar = el('div', { class: 'bar' });
      bar.style.width = Math.max(0.3, x[k] * 100) + '%';
      box.appendChild(el('div', { class: 'nm', text: k }));
      box.appendChild(el('div', {}, [bar]));
      box.appendChild(el('div', { class: 'num', text: x[k] >= 0.001 ? x[k].toFixed(4) : x[k].toExponential(2) }));
    });
    box.appendChild(el('div', { class: 'nm small', text: (keys.length - shown) + ' others' }));
    box.appendChild(el('div'));
    box.appendChild(el('div', { class: 'num', text: other.toExponential(1) }));
    $('compCap').textContent = 'Mole fractions at ' + fmt(current.chamber.T, 0) + ' K and ' + fmt(state.pc / 1e5, 1) + ' bar; ' + (keys.length - shown) + ' of the ' + keys.length + ' species considered are under 0.0001 and summed.';
  }

  // ------------------------------------------------------------------ chart
  var CH = { W: 800, H: 320, l: 58, r: 18, t: 16, b: 42 };
  function niceTicks(lo, hi, n) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var t = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + step * 1e-9; v += step) t.push(+v.toPrecision(12));
    return { ticks: t, step: step };
  }
  function metric() { return METRICS.filter(function (m) { return m.id === state.metric; })[0]; }
  function measuredPoints() {
    if (state.presetId !== 'gox-rp1' || state.metric !== 'cstar' || !MEAS) return [];
    return MEAS.runs.map(function (r) { return { of: r.mixture_ratio, v: r.cstar_measured_ft_s * FT, pc: (r.pc_psig * P.PSI + 101325), test: r.test }; });
  }

  function renderChart() {
    var svg = $('chart'), wrap = svg.parentNode;
    var W = Math.max(300, Math.round(wrap.clientWidth || 800));
    var H = W < 520 ? 270 : 330;
    CH.W = W; CH.H = H; CH.l = W < 520 ? 50 : 60;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.textContent = '';
    var m = metric();
    var xs = curves.xs;
    var main = xs.map(function (x, i) { return metricValue(m, curves.main[i], x); });
    var low = m.dens && m.id === 'rho' ? null : xs.map(function (x, i) { return metricValue(m, curves.low[i], x); });
    var lowGone = !!low && !low.some(isFinite) && curves.main.some(function (r) { return !r.refusal; });
    if (lowGone) low = null;
    var meas = measuredPoints();
    var vals = main.concat(low || []).concat(meas.map(function (p) { return p.v; })).filter(isFinite);
    var cv = metricValue(m, current, state.of);
    if (isFinite(cv)) vals.push(cv);
    var ofOk = state.of > 0 && isFinite(state.of);
    var x0 = ofOk ? Math.min(state.range[0], state.of) : state.range[0], x1 = ofOk ? Math.max(state.range[1], state.of) : state.range[1];
    var X = function (v) { return CH.l + (v - x0) / (x1 - x0) * (W - CH.l - CH.r); };
    svg._X = X; svg._x0 = x0; svg._x1 = x1;
    var legend = $('legend');
    legend.textContent = '';
    if (!vals.length) {
      svg.appendChild(svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lbl' }, m.dens ? 'No curve: a density is refused (see above).' : 'No curve: every point is refused (see above).'));
      $('chartCap').textContent = 'Nothing to plot for these inputs; the refusal above says what is missing.';
      fillTable(m, main, low);
      return;
    }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 1e-9 * Math.max(1, Math.abs(hi))) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var Y = function (v) { return CH.t + (hi - v) / (hi - lo) * (H - CH.t - CH.b); };
    // grid and axes
    var yt = niceTicks(lo, hi, 5);
    yt.ticks.forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: CH.l, x2: W - CH.r, y1: Y(v), y2: Y(v), class: 'grid' }));
      svg.appendChild(svgEl('text', { x: CH.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmt(v, Math.max(0, Math.min(4, -Math.floor(Math.log10(yt.step)))))));
    });
    var xt = niceTicks(x0, x1, W < 520 ? 5 : 9);
    xt.ticks.forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: X(v), x2: X(v), y1: H - CH.b, y2: H - CH.b + 4, class: 'axis' }));
      svg.appendChild(svgEl('text', { x: X(v), y: H - CH.b + 17, 'text-anchor': 'middle' }, fmt(v, Math.max(0, -Math.floor(Math.log10(xt.step))))));
    });
    svg.appendChild(svgEl('line', { x1: CH.l, x2: W - CH.r, y1: H - CH.b, y2: H - CH.b, class: 'axis' }));
    svg.appendChild(svgEl('text', { x: (CH.l + W - CH.r) / 2, y: H - 6, 'text-anchor': 'middle', class: 'lbl' }, 'Mixture ratio O/F'));
    svg.appendChild(svgEl('text', { x: CH.l, y: 11, class: 'lbl' }, m.label + (m.unit ? ' (' + m.unit + ')' : '')));
    // refused bands
    var step = (xs[1] - xs[0]) / 2;
    curves.main.forEach(function (r, i) {
      if (r.refusal && !m.dens) svg.appendChild(svgEl('rect', { x: X(Math.max(x0, xs[i] - step)), y: CH.t, width: Math.max(1, X(Math.min(x1, xs[i] + step)) - X(Math.max(x0, xs[i] - step))), height: H - CH.t - CH.b, class: 'refband' }));
    });
    var firstRef = curves.main.filter(function (r) { return r.refusal; })[0];
    // stoichiometric line
    if (isFinite(stoich) && stoich >= x0 && stoich <= x1) {
      svg.appendChild(svgEl('line', { x1: X(stoich), x2: X(stoich), y1: CH.t, y2: H - CH.b, class: 'stoich' }));
      var nearRight = X(stoich) > W - CH.r - 90;
      svg.appendChild(svgEl('text', { x: X(stoich) + (nearRight ? -4 : 4), y: CH.t + 12, 'text-anchor': nearRight ? 'end' : 'start', class: 'lbl' }, 'stoichiometric'));
    }
    var path = function (arr, cls) {
      var d = '', pen = false;
      arr.forEach(function (v, i) {
        if (!isFinite(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      });
      if (d) svg.appendChild(svgEl('path', { d: d, class: cls }));
    };
    if (low) path(low, 'line s2 dash');
    path(main, 'line s1');
    // direct labels at the right end
    var endLabel = function (arr, txt, dy) {
      for (var i = arr.length - 1; i >= 0; i--) if (isFinite(arr[i])) {
        var t = svgEl('text', { x: X(xs[i]) - 4, y: Y(arr[i]) + dy, 'text-anchor': 'end', class: 'lbl' }, txt);
        svg.appendChild(t); return;
      }
    };
    var pcLbl = fmt(state.pc / 1e5, state.pc < 10e5 ? 2 : 0) + ' bar', pcLowLbl = fmt(state.pc / 1e6, state.pc < 100e5 ? 2 : 1) + ' bar';
    if (low) {
      var lastMain = main.filter(isFinite).slice(-1)[0], lastLow = low.filter(isFinite).slice(-1)[0];
      var mainAbove = lastMain >= lastLow;
      endLabel(main, pcLbl, mainAbove ? -8 : 16);
      endLabel(low, pcLowLbl, mainAbove ? 16 : -8);
    }
    // peak marker (drawn after the current point, below, so the ring stays visible around the dot)
    var peakTxt = '', peakRing = null;
    if (state.metric === 'cstar' && peak) {
      peakRing = svgEl('circle', { cx: X(peak.of), cy: Y(peak.cstar), r: 8, class: 'peak' });
      peakTxt = 'Hollow ring: c* peak at O/F ' + fmt(peak.of, 3) + ' (' + fmt(peak.cstar, 1) + ' m/s at ' + pcLbl + '). ';
    }
    if (state.metric === 'rhoc') {
      var bi = -1;
      main.forEach(function (v, i) { if (isFinite(v) && (bi < 0 || v > main[bi])) bi = i; });
      if (bi >= 0) { svg.appendChild(svgEl('circle', { cx: X(xs[bi]), cy: Y(main[bi]), r: 5, class: 'peak' })); peakTxt = 'Hollow ring: highest sampled density × c* at O/F ' + fmt(xs[bi], 2) + '. Denser propellant means smaller tanks; this is where that trade peaks. '; }
    }
    // measured points
    meas.forEach(function (p) {
      svg.appendChild(svgEl('circle', { cx: X(p.of), cy: Y(p.v), r: 4.5, class: 'dotm' }));
    });
    if (meas.length) {
      var mm = meas.reduce(function (a, p) { return p.v < a.v ? p : a; });
      svg.appendChild(svgEl('text', { x: X(mm.of), y: Y(mm.v) + 20, 'text-anchor': 'middle', class: 'lbl' }, 'measured'));
    }
    // current point
    if (ofOk) svg.appendChild(svgEl('line', { x1: X(state.of), x2: X(state.of), y1: CH.t, y2: H - CH.b, class: 'cursor' }));
    if (isFinite(cv)) svg.appendChild(svgEl('circle', { cx: X(state.of), cy: Y(cv), r: 5, class: 'dot1' }));
    if (peakRing) svg.appendChild(peakRing);
    svg._Y = Y; svg._main = main; svg._low = low;
    // legend (HTML, never colour alone: line style and words)
    var li = function (cls, txt) { var k = el('span', { class: 'key ' + cls }); return el('li', {}, [k, txt]); };
    var k1 = li('', 'at ' + pcLbl + ' (your chamber pressure)'); k1.firstChild.style.borderTopColor = 'var(--s1)'; legend.appendChild(k1);
    if (low) { var k2 = li('dash', 'at ' + pcLowLbl + ' (one tenth: more dissociation)'); k2.firstChild.style.borderTopColor = 'var(--s2)'; legend.appendChild(k2); }
    if (meas.length) { var k3 = li('dot', 'measured c*, NASA MSFC 1,000-lbf chamber, about ' + fmt(meas[0].pc / 1e5, 1) + ' bar (NASA/TP-2002-211729)'); k3.firstChild.style.background = 'var(--s3)'; legend.appendChild(k3); }
    $('chartCap').textContent = peakTxt + (firstRef ? 'Grey bands: refused (' + firstRef.refusal.reason.split(';')[0] + '). ' : '') +
      (lowGone ? 'No one-tenth-pressure curve: ' + pcLowLbl + ' is outside the pressures checked against NASA CEA. ' : '') + 'Tap or drag on the chart to set the mixture ratio; arrow keys move it when the chart has focus.';
    fillTable(m, main, low);
  }

  function fillTable(m, main, low) {
    var t = $('curveTable');
    t.textContent = '';
    var hd = el('tr', {}, [el('th', { text: 'O/F' }), el('th', { text: m.label + ' at ' + fmt(state.pc / 1e5, 1) + ' bar' })]);
    if (low) hd.appendChild(el('th', { text: 'at ' + fmt(state.pc / 1e6, 2) + ' bar' }));
    t.appendChild(hd);
    curves.xs.forEach(function (x, i) {
      var r = el('tr', {}, [el('td', { class: 'n', text: fmt(x, 3) }), el('td', { class: 'n', text: isFinite(main[i]) ? fmt(main[i], m.d) : 'refused' })]);
      if (low) r.appendChild(el('td', { class: 'n', text: isFinite(low[i]) ? fmt(low[i], m.d) : 'refused' }));
      t.appendChild(r);
    });
    measuredPoints().forEach(function (p) {
      t.appendChild(el('tr', {}, [el('td', { class: 'n', text: fmt(p.of, 2) }), el('td', { class: 'n', text: fmt(p.v, 0) + ' measured (test ' + p.test + ', ' + fmt(p.pc / 1e5, 2) + ' bar)' })]));
    });
  }

  // chart interaction: tap/drag sets O/F; hover shows a tooltip
  function chartOf(evt) {
    var svg = $('chart'), rect = svg.getBoundingClientRect();
    var px = (evt.clientX - rect.left) * (CH.W / rect.width);
    var of = svg._x0 + (px - CH.l) / (CH.W - CH.l - CH.r) * (svg._x1 - svg._x0);
    return Math.max(state.range[0], Math.min(state.range[1], of));
  }
  var dragging = false;
  function setOf(of) {
    if (!(of > 0) || !isFinite(of)) return;
    state.of = of;
    computeCurrent();
    renderNumbers();
    renderChart();
  }
  function showTip(evt) {
    var svg = $('chart'), tip = $('tip');
    if (!curves || !svg._main) return;
    var of = chartOf(evt), xs = curves.xs, i = 0;
    for (var k = 1; k < xs.length; k++) if (Math.abs(xs[k] - of) < Math.abs(xs[i] - of)) i = k;
    var m = metric();
    var lines = ['O/F ' + fmt(xs[i], 3), fmt(state.pc / 1e5, 1) + ' bar: ' + (isFinite(svg._main[i]) ? fmt(svg._main[i], m.d) + ' ' + m.unit : 'refused')];
    if (svg._low) lines.push(fmt(state.pc / 1e6, 2) + ' bar: ' + (isFinite(svg._low[i]) ? fmt(svg._low[i], m.d) + ' ' + m.unit : 'refused'));
    tip.textContent = '';
    lines.forEach(function (l, j) { if (j) tip.appendChild(el('br')); tip.appendChild(document.createTextNode(l)); });
    var wrap = svg.parentNode.getBoundingClientRect();
    var x = evt.clientX - wrap.left, y = evt.clientY - wrap.top;
    tip.style.display = 'block';
    var tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(wrap.width - tw, x + 12)) + 'px';
    tip.style.top = Math.max(0, y - 54) + 'px';
  }
  function wireChart() {
    var svg = $('chart');
    svg.addEventListener('pointerdown', function (e) {
      dragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      setOf(+chartOf(e).toFixed(3));
      e.preventDefault();
    });
    svg.addEventListener('pointermove', function (e) {
      if (dragging) setOf(+chartOf(e).toFixed(3));
      if (e.pointerType === 'mouse' || dragging) showTip(e);
    });
    var end = function () { dragging = false; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', function () { $('tip').style.display = 'none'; });
    svg.addEventListener('keydown', function (e) {
      var d = (state.range[1] - state.range[0]) / 100;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setOf(+Math.min(state.range[1], state.of + d).toFixed(3)); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setOf(+Math.max(state.range[0], state.of - d).toFixed(3)); e.preventDefault(); }
    });
  }

  // ------------------------------------------------------------------ handoff
  var lastHandoff = null;
  function buildHandoff() {
    var pr = presetById(state.presetId);
    var asm = [];
    var env = M.PC_ENVELOPE;
    var inEnv = pr && state.of >= pr.ofRange[0] && state.of <= pr.ofRange[1] && state.pc >= env[0] && state.pc <= env[1];
    asm.push(inEnv ? 'Inside the envelope checked against NASA CEA 3.3.4 for this propellant (O/F ' + pr.ofRange[0] + '-' + pr.ofRange[1] + ', ' + env[0] / 1e5 + '-' + env[1] / 1e5 + ' bar).'
      : 'Outside the envelope this propellant was checked against NASA CEA over (or a custom blend): the method applies, but this point was not compared.');
    ['oxidizer', 'fuel'].forEach(function (s) {
      var d = dens[s];
      if (d && !d.refusal) {
        var Td = [].concat(d.T);
        var Tr = state[s].map(function (p) { return p.T == null ? DEFT[p.name] : p.T; });
        if (Td.some(function (t, i) { return Tr[i] != null && Math.abs(t - Tr[i]) > 0.01; }) || (Td.length === 1 && Tr.some(function (t) { return Math.abs(t - Td[0]) > 0.01; }))) {
          asm.push('The ' + s + ' density is for ' + Td.join('/') + ' K while its enthalpy is for ' + Tr.join('/') + ' K.');
        }
      }
    });
    return M.makeHandoff({ preset: state.presetId, oxidizer: state.oxidizer, fuel: state.fuel, of: state.of, pc: state.pc }, current, dens,
      { stoichiometric_mixture_ratio: stoich, thermo: THERMO, assumptions: asm });
  }
  function renderHandoff() {
    lastHandoff = buildHandoff();
    var json = JSON.stringify(lastHandoff, null, 2);
    $('exportText').value = json;
    $('nextLink').href = '../32-bell/index.html#h=' + M.b64urlEncode(JSON.stringify(lastHandoff));
    var t = $('allTable');
    t.textContent = '';
    t.appendChild(el('tr', {}, [el('th', { text: 'Output' }), el('th', { text: 'Value' }), el('th', { text: 'Units' }), el('th', { text: 'Confidence' }), el('th', { text: 'Source' })]));
    Object.keys(lastHandoff.outputs).forEach(function (k) {
      var o = lastHandoff.outputs[k], v = o.value;
      var txt = typeof v === 'number' ? (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(5) : String(+v.toPrecision(7))) :
        Array.isArray(v) ? v.length + ' items' : typeof v === 'object' ? Object.keys(v).length + ' entries' : String(v);
      t.appendChild(el('tr', {}, [el('td', { text: k }), el('td', { class: 'n', text: txt }), el('td', { text: o.units }), el('td', { text: o.confidence }), el('td', { class: 'small', text: o.source })]));
    });
  }
  function setStatus(id, msg, cls) { var s = $(id); s.textContent = msg; s.className = 'status' + (cls ? ' ' + cls : ''); }
  function wireHandoff() {
    $('copyBtn').addEventListener('click', function () {
      var text = $('exportText').value;
      var fallback = function () {
        try { $('exportText').select(); var ok = document.execCommand && document.execCommand('copy'); setStatus('exportStatus', ok ? 'Copied.' : 'Select the text below and copy it.', ok ? 'ok' : ''); }
        catch (e) { setStatus('exportStatus', 'Select the text below and copy it.'); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setStatus('exportStatus', 'Copied.', 'ok'); }, fallback);
      else fallback();
    });
    $('dlBtn').addEventListener('click', function () {
      var blob = new Blob([$('exportText').value + '\n'], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: 'handoff.json' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setStatus('exportStatus', 'Downloaded handoff.json.', 'ok');
    });
    $('importBtn').addEventListener('click', function () { importText($('importText').value, 'importStatus'); });
  }
  function importText(text, statusId) {
    if (!text || !text.trim()) { setStatus(statusId, 'Nothing to import: paste a handoff first.', 'bad'); return false; }
    var h = M.parseHandoff(text);
    if (h.refusal) { setStatus(statusId, 'Not imported (' + h.refusal.code + '): ' + h.refusal.reason + ' ' + h.refusal.what_would_help, 'bad'); return false; }
    var inp = h.inputs;
    state.oxidizer = inp.oxidizer.map(function (p) { return { name: p.name, w: p.w, T: p.T == null ? DEFT[p.name] : p.T }; });
    state.fuel = inp.fuel.map(function (p) { return { name: p.name, w: p.w, T: p.T == null ? DEFT[p.name] : p.T }; });
    state.of = inp.of;
    state.pc = inp.pc;
    renderSide('oxidizer'); renderSide('fuel');
    var pr = matchPreset();
    state.presetId = pr ? pr.id : 'custom';
    $('preset').value = state.presetId;
    state.range = pr ? pr.ofRange.slice() : customRange();
    presetNote();
    recomputeAll();
    setStatus(statusId, 'Imported the inputs of a handoff from ' + (h.handoff.from || 'an unnamed module') + ' (' + (h.handoff.produced || 'no date') + ').', 'ok');
    return true;
  }

  // ------------------------------------------------------------------ wiring
  function applyPreset(id) {
    var pr = presetById(id);
    if (!pr) return;
    var prev = presetById(state.presetId);
    if (pr.pc) state.pc = pr.pc;
    else if (prev && prev.pc && state.pc === prev.pc) state.pc = P.PC_DEFAULT;
    state.presetId = id;
    $('preset').value = id;
    state.oxidizer = clone(pr.oxidizer);
    state.fuel = clone(pr.fuel);
    state.range = pr.ofRange.slice();
    var pk = M.maxCstar(db, prop(), state.pc, pr.ofRange[0], pr.ofRange[1]);
    state.of = isFinite(pk.cstar) ? +pk.of.toFixed(3) : (pr.ofRange[0] + pr.ofRange[1]) / 2;
    renderSide('oxidizer'); renderSide('fuel');
    presetNote();
    current = null;
    recomputeAll();
  }

  function render() { renderNumbers(); renderChart(); }

  function init() {
    var sel = $('preset');
    P.PRESETS.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.label })); });
    sel.appendChild(el('option', { value: 'custom', text: 'Custom blend (edit the components)' }));
    sel.addEventListener('change', function () { if (sel.value !== 'custom') applyPreset(sel.value); });
    var mb = $('metrics');
    METRICS.forEach(function (m) {
      var b = el('button', { type: 'button', 'aria-pressed': m.id === state.metric ? 'true' : 'false', text: m.label });
      b.addEventListener('click', function () {
        state.metric = m.id;
        Array.prototype.forEach.call(mb.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
        renderChart();
      });
      mb.appendChild(b);
    });
    document.querySelectorAll('button.add').forEach(function (b) {
      b.addEventListener('click', function () {
        var side = b.getAttribute('data-side');
        var used = state[side].map(function (p) { return p.name; });
        var c = P.COMPONENTS.filter(function (x) { return used.indexOf(x.name) < 0; })[0];
        if (!c) return;
        state[side].push({ name: c.name, w: 0, T: c.T });
        renderSide(side); afterComposition();
      });
    });
    $('ofRange').addEventListener('input', function () { setOf(+sliderToOf(+$('ofRange').value).toFixed(3)); });
    $('ofNum').addEventListener('change', function () {
      var v = parseFloat($('ofNum').value);
      if (!(v > 0)) { state.of = v; computeCurrent(); renderNumbers(); return; }
      state.of = v;
      if (v < state.range[0] || v > state.range[1]) { computeCurrent(); computeCurves(); render(); } else setOf(v);
    });
    $('pcRange').addEventListener('input', function () { state.pc = roundPc(sliderToPc(+$('pcRange').value)); scheduleCurves(); });
    $('pcNum').addEventListener('change', function () {
      var v = parseFloat($('pcNum').value);
      state.pc = v * 1e5;
      if (!(v > 0)) { computeCurrent(); renderNumbers(); return; }
      recomputeAll();
    });
    $('toMax').addEventListener('click', function () { if (peak) setOf(+peak.of.toFixed(3)); });
    $('toStoich').addEventListener('click', function () {
      if (!isFinite(stoich)) return;
      if (stoich > state.range[1]) state.range[1] = +(stoich * 1.1).toFixed(2);
      state.of = +stoich.toFixed(3); computeCurrent(); computeCurves(); render();
    });
    wireChart();
    wireHandoff();
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (curves) renderChart(); }, 100); });
    window.addEventListener('hashchange', function () { if (/#h=/.test(location.hash)) importText(location.hash, 'importStatus'); });
    applyPreset('lox-rp1');
    if (/#h=/.test(location.hash)) importText(location.hash, 'importStatus');
  }

  init();
})();
