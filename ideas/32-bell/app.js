/* Bell page: wires the controls, the kernel (bell.js on idea 31's mixture.js) and the drawings. No network. */
(function () {
  'use strict';
  var M = window.Mixture, PF = window.PartForgeISA, P = window.MixturePresets, T1 = window.SP8120_TABLE1;
  var db = M.parseThermo(window.THERMO_EXCERPT);
  var B = window.Bell.create({ Mixture: M, db: db, charts: window.NOZZLE_CHARTS, rules: window.NOZZLE_RULES, isa: PF.isa, g0: PF.ISA_G0 });
  var G0 = PF.ISA_G0, PSI = window.Bell.PSI;
  // The thermo.inp identity idea 31 stamps on its handoffs (bell.test.mjs checks it against idea 31's sample).
  var THERMO = { repo: 'https://github.com/nasa/cea', commit: '2f79a647e85737742fb08a127da00d1ea1d069da', path: 'data/thermo.inp', sha256: 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363' };
  var EPS_MIN = window.Bell.EPS_ENVELOPE[0], EPS_MAX = window.Bell.EPS_ENVELOPE[1];
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function fmt(v, d) {
    if (!(typeof v === 'number' && isFinite(v))) return '-';
    var a = Math.abs(v);
    if (d == null) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function sig(v, n) { return (typeof v === 'number' && isFinite(v)) ? String(+v.toPrecision(n || 4)) : '-'; }
  function presetById(id) { for (var i = 0; i < P.PRESETS.length; i++) if (P.PRESETS[i].id === id) return P.PRESETS[i]; return null; }

  // ------------------------------------------------------------------ state
  var state = {
    presetId: 'lox-rp1', oxidizer: null, fuel: null, of: 2.27, pc: 1126 * PSI, ofRange: [1, 4],
    imported: null, // {h31, note} while the chamber is the imported one
    eps: 16, contour: 'bell', Lf: 0.8, alpha: 15, amb: 'altitude', alt: 0, pa: 101.325, thrust: null,
    freeze: 'chamber', design: 'shifting', chart: 'alt', engineKey: null,
  };
  var cur = { h31: null, r: null, A: null, handoff: null };

  function applyPreset(id) {
    var p = presetById(id);
    if (!p) return;
    state.presetId = id;
    state.oxidizer = p.oxidizer.map(function (x) { return { name: x.name, w: x.w, T: x.T }; });
    state.fuel = p.fuel.map(function (x) { return { name: x.name, w: x.w, T: x.T }; });
    state.ofRange = p.ofRange.slice();
  }

  // ------------------------------------------------------------------ controls
  function logPos(v, lo, hi) { return Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo)); }
  function logVal(pos, lo, hi) { return lo * Math.pow(hi / lo, pos / 1000); }
  function syncControls() {
    $('preset').value = state.imported && !presetMatches() ? 'imported' : state.presetId;
    $('ofNum').value = +state.of.toFixed(3);
    var r = state.ofRange;
    $('ofRange').value = Math.round(1000 * (Math.min(Math.max(state.of, r[0]), r[1]) - r[0]) / (r[1] - r[0]));
    $('pcNum').value = +(state.pc / 1e5).toPrecision(5);
    $('pcRange').value = logPos(Math.min(Math.max(state.pc / 1e5, 1), 300), 1, 300);
    $('epsNum').value = +state.eps.toPrecision(4);
    $('epsRange').value = logPos(Math.min(Math.max(state.eps, EPS_MIN), EPS_MAX), EPS_MIN, EPS_MAX);
    $('lfNum').value = +(state.Lf * 100).toFixed(1);
    $('lfRange').value = state.Lf * 100;
    $('alphaNum').value = state.alpha;
    $('alphaRange').value = Math.min(Math.max(state.alpha, 5), 30);
    $('altNum').value = state.alt;
    $('altRange').value = Math.min(Math.max(state.alt, 0), 86);
    $('paNum').value = state.pa;
    $('thrustNum').value = state.thrust == null ? '' : +state.thrust.toPrecision(6);
    setPressed('[data-contour]', 'contour', state.contour);
    setPressed('[data-amb]', 'amb', state.amb);
    setPressed('[data-freeze]', 'freeze', state.freeze);
    setPressed('[data-design]', 'design', state.design);
    setPressed('[data-chart]', 'chart', state.chart);
    $('lfCtl').hidden = state.contour !== 'bell';
    $('alphaCtl').hidden = state.contour !== 'cone';
    $('altCtl').hidden = state.amb !== 'altitude';
    $('paCtl').hidden = state.amb !== 'pressure';
  }
  function setPressed(sel, key, val) {
    document.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-' + key) === val)); });
  }
  function presetMatches() {
    var p = presetById(state.presetId);
    if (!p) return false;
    var same = function (a, b) { return a.length === b.length && a.every(function (x, i) { return x.name === b[i].name && Math.abs(x.w - b[i].w) < 1e-9; }); };
    return same(p.oxidizer, state.oxidizer) && same(p.fuel, state.fuel);
  }
  function chamberEdited() { state.imported = null; state.engineKey = null; }

  function bind() {
    var sel = $('preset');
    P.PRESETS.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.label })); });
    sel.appendChild(el('option', { value: 'imported', text: 'As imported (from a handoff)', disabled: 'disabled' }));
    sel.addEventListener('change', function () { applyPreset(sel.value); chamberEdited(); var p = presetById(sel.value); state.of = Math.min(Math.max(state.of, p.ofRange[0]), p.ofRange[1]); update(); });
    $('ofNum').addEventListener('change', function () { state.of = parseFloat(this.value); chamberEdited(); update(); });
    $('ofRange').addEventListener('input', function () { var r = state.ofRange; state.of = +(r[0] + (r[1] - r[0]) * this.value / 1000).toFixed(3); chamberEdited(); update(); });
    $('pcNum').addEventListener('change', function () { state.pc = parseFloat(this.value) * 1e5; chamberEdited(); update(); });
    $('pcRange').addEventListener('input', function () { state.pc = +logVal(+this.value, 1, 300).toPrecision(4) * 1e5; chamberEdited(); update(); });
    $('epsNum').addEventListener('change', function () { state.eps = parseFloat(this.value); state.engineKey = null; update(); });
    $('epsRange').addEventListener('input', function () { state.eps = +logVal(+this.value, EPS_MIN, EPS_MAX).toPrecision(4); state.engineKey = null; update(); });
    $('lfNum').addEventListener('change', function () { state.Lf = parseFloat(this.value) / 100; update(); });
    $('lfRange').addEventListener('input', function () { state.Lf = +this.value / 100; update(); });
    $('alphaNum').addEventListener('change', function () { state.alpha = parseFloat(this.value); update(); });
    $('alphaRange').addEventListener('input', function () { state.alpha = +this.value; update(); });
    $('altNum').addEventListener('change', function () { state.alt = parseFloat(this.value); update(); });
    $('altRange').addEventListener('input', function () { state.alt = +this.value; update(); });
    $('paNum').addEventListener('change', function () { state.pa = parseFloat(this.value); update(); });
    $('thrustNum').addEventListener('change', function () { var v = this.value.trim(); state.thrust = v === '' ? null : parseFloat(v); update(); });
    [['[data-contour]', 'contour'], ['[data-amb]', 'amb'], ['[data-freeze]', 'freeze'], ['[data-design]', 'design'], ['[data-chart]', 'chart']].forEach(function (d) {
      document.querySelectorAll(d[0]).forEach(function (b) { b.addEventListener('click', function () { state[d[1]] = b.getAttribute('data-' + d[1]); update(); }); });
    });
    $('toIdeal').addEventListener('click', function () { goIdeal(false); });
    $('toLimit').addEventListener('click', function () { goIdeal(true); });
    $('copyBtn').addEventListener('click', copyExport);
    $('dlBtn').addEventListener('click', download);
    $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'pasted'); });
    bindChart();
  }

  // ------------------------------------------------------------------ computing
  function ambientSpec() {
    if (state.amb === 'vacuum') return { kind: 'vacuum' };
    if (state.amb === 'pressure') return { kind: 'pressure', pa: state.pa * 1e3 };
    return { kind: 'altitude', alt_m: state.alt * 1000 };
  }
  function nozzleInputs() {
    return { eps: state.eps, contour: state.contour === 'cone' ? { type: 'cone', alpha: state.alpha } : { type: 'bell', Lf: state.Lf },
      ambient: ambientSpec(), design: state.design, freeze: state.freeze, thrust: state.thrust == null ? null : state.thrust * 1e3 };
  }
  function compute() {
    if (state.imported) {
      cur.h31 = state.imported.h31;
      cur.r = B.chamberFromHandoff(cur.h31, state.imported.inputs);
    } else {
      var c = B.chamberHandoff({ preset: presetMatches() ? state.presetId : 'custom', oxidizer: state.oxidizer, fuel: state.fuel, of: state.of, pc: state.pc }, window.PROPELLANT_DENSITIES, THERMO);
      cur.h31 = c.handoff; cur.r = c.rocket;
    }
    var ni = nozzleInputs(); // a non-positive or non-numeric thrust reaches the kernel, which refuses it
    cur.ni = ni;
    cur.A = B.analyze(cur.r, ni);
    cur.handoff = B.makeHandoff(cur.h31, ni, cur.A);
  }

  function update() {
    syncControls();
    compute();
    renderChamber();
    renderResults();
    renderContour();
    renderChart();
    renderHandoff();
    markEngine();
  }

  // ------------------------------------------------------------------ chamber summary
  function renderChamber() {
    var src = $('chamberSource');
    if (state.imported) src.textContent = 'Chamber from an imported idea 31 handoff (' + (state.imported.note || 'checked against idea 31\'s kernel') + '). Changing the chamber below switches to stand-alone.';
    else if (state.engineKey) src.textContent = 'Loaded from SP-8120 Table I: ' + state.engineKey + '. Every input below is the table\'s.';
    else src.textContent = '';
    var r = cur.r, n = $('chamberNote');
    if (!r || r.refusal) { n.textContent = 'Chamber refused: ' + (r && r.refusal ? r.refusal.reason : 'no chamber'); n.className = 'note bad'; return; }
    n.className = 'note';
    n.textContent = 'Idea 31\'s chamber: ' + fmt(r.chamber.T, 0) + ' K, c* ' + fmt(r.cstar, 1) + ' m/s (shifting), throat at ' + sig(r.throat.P / 1e5, 4) + ' bar. ';
    n.appendChild(el('a', { href: '../31-mixture/index.html', text: 'Open 31 Mixture' }));
  }

  // ------------------------------------------------------------------ results
  function chip(conf) { return el('span', { class: 'c', text: conf }); }
  function tile(k, valueNodes, conf, extra) {
    var t = el('div', { class: 'tile' + (extra && extra.cls ? ' ' + extra.cls : '') }, [el('div', { class: 'k', text: k })]);
    t.appendChild(el('div', { class: 'v' }, valueNodes));
    if (extra && extra.sub) t.appendChild(el('div', { class: 'sub', text: extra.sub }));
    if (conf) t.appendChild(chip(conf));
    return t;
  }
  function pairNodes(a, b) {
    return [el('span', { class: 'pair' }, [el('span', {}, [el('span', { class: 'swatch sw1' }), a]), el('span', {}, [el('span', { class: 'swatch sw2' }), b])])];
  }
  function ambientLabel(A) { return A.ambient ? (A.ambient.alt_m != null ? (A.ambient.alt_m === 0 ? 'sea level' : sig(A.ambient.alt_m / 1000, 4) + ' km') : A.ambient.pa === 0 ? 'vacuum' : sig(A.ambient.pa / 1e3, 4) + ' kPa') : '?'; }

  function renderResults() {
    var A = cur.A, tiles = $('tiles'), refs = $('refusals'), v = $('verdict');
    tiles.textContent = ''; refs.textContent = ''; v.textContent = ''; v.className = 'verdict';
    var shown = {};
    cur.handoff.refusals.forEach(function (rf) {
      var key = rf.code + rf.reason;
      if (shown[key]) return; shown[key] = 1;
      refs.appendChild(el('div', { class: 'refusal' }, [el('b', { text: (rf.applies_to ? rf.applies_to.replace(/_/g, ' ') + ': ' : '') + rf.code.replace(/_/g, ' ') }), el('span', { text: rf.reason }), el('div', { class: 'help', text: 'What would help: ' + rf.what_would_help })]));
    });
    var S = A.flows.shifting, F = A.flows.frozen;
    var hasS = S && S.exit, hasF = F && F.exit;
    if (!hasS && !hasF) return;
    var D = A.flows[A.design] && A.flows[A.design].exit ? A.flows[A.design] : (hasS ? S : F);
    // verdict
    var lab = ambientLabel(A);
    if (D.sep) {
      v.className = 'verdict ' + D.sep.status;
      var txt;
      if (D.sep.status === 'vacuum') txt = 'In vacuum nothing separates. ';
      else if (D.sep.status === 'full') txt = 'At ' + lab + ' (' + sig(A.ambient.pa / 1e3, 4) + ' kPa) the nozzle flows full: exit pressure ' + sig(D.exit.P / 1e3, 3) + ' kPa against separation at ' + sig(D.sep.pSep / 1e3, 3) + ' kPa (SP-8120). ';
      else if (D.sep.status === 'marginal') txt = 'Marginal at ' + lab + ': the exit pressure (' + sig(D.exit.P / 1e3, 3) + ' kPa) is within 20 % of separation (' + sig(D.sep.pSep / 1e3, 3) + ' kPa). SP-8120 says to reduce the area ratio or change the contour. ';
      else if (D.bracket && D.bracket.none) txt = 'Does not run at ' + lab + ': SP-8120 puts separation at ' + sig(D.sep.pSep / 1e3, 3) + ' kPa, at or above the throat pressure (' + sig(D.base.throat.P / 1e3, 3) + ' kPa), so the flow would break away at or before the throat and the nozzle would not run supersonic. ';
      else txt = 'Separates at ' + lab + ': the exit pressure (' + sig(D.exit.P / 1e3, 3) + ' kPa) is below the separation pressure (' + sig(D.sep.pSep / 1e3, 3) + ' kPa), so the wall flow breaks away inside the nozzle' + (D.sepCut ? ', near area ratio ' + sig(D.sepCut.eps, 3) : '') + '. Expect unsteady side loads. ';
      txt += 'With this ' + A.design + '-flow exit it turns marginal at an ambient of ' + where(D.sepMarginOnset) + ' and separates at ' + where(D.sepOnset) + '.';
      v.textContent = txt;
    }
    // Review fix: a refused ambient or divergence efficiency shows "refused", never the vacuum or ideal value under
    // an "at ?" or "after divergence loss" label; a separated nozzle shows the kernel's own bracket.
    var isp = function (Fl) {
      if (!Fl || !Fl.exit) return '-';
      if (!A.ambient || !Fl.vac) return 'refused';
      if (Fl.sep && Fl.sep.status === 'separated') return 'refused';
      return fmt(Fl.amb ? Fl.amb.isp / G0 : Fl.vac.Ivac / G0, 1);
    };
    var bracketS = function (br) {
      if (!br) return '';
      if (br.none) return '. Separated: no bracket (separation would sit at or before the throat)';
      return '. Separated: ' + (br.lower != null && br.upper != null ? 'between ' + fmt(br.lower / G0, 1) + ' and ' + fmt(br.upper / G0, 1) + ' s' : br.upper != null ? 'at most ' + fmt(br.upper / G0, 1) + ' s' : 'at least ' + fmt(br.lower / G0, 1) + ' s') + ' (shifting), not predicted';
    };
    var heroSub = !A.ambient ? 'the ambient is refused (see above)' : !A.lambda ? 'no divergence efficiency for this contour (see above); the ideal nozzle is in the next tile'
      : 'shifting / frozen; after divergence loss' + ((S && S.sep && S.sep.status === 'separated') ? bracketS(S.bracket) : '');
    var hero = tile('Specific impulse at ' + (A.ambient ? lab : 'the ambient') + ', s', pairNodes(isp(S), isp(F)), 'derived', { cls: 'hero', sub: heroSub });
    tiles.appendChild(hero);
    var ivac = function (Fl) { return Fl && Fl.vac ? fmt(Fl.vac.Ivac / G0, 1) : Fl && Fl.exit ? 'refused' : '-'; };
    var cfv = function (Fl) { return Fl && Fl.vac ? fmt(Fl.vac.cfVac, 4) : '-'; };
    tiles.appendChild(tile('Vacuum specific impulse, s', pairNodes(ivac(S), ivac(F)), 'derived', { sub: (A.lambda ? '' : 'after divergence loss refused; ') + 'ideal nozzle: ' + (hasS ? fmt(S.exit.Ivac / G0, 1) : '-') + ' / ' + (hasF ? fmt(F.exit.Ivac / G0, 1) : '-') + ' s' }));
    tiles.appendChild(tile('Thrust coefficient', pairNodes(hasS && S.amb && !(S.sep && S.sep.status === 'separated') ? fmt(S.amb.cf, 4) : '-', hasF && F.amb && !(F.sep && F.sep.status === 'separated') ? fmt(F.amb.cf, 4) : '-'), 'derived', { sub: 'at ' + (A.ambient ? lab : 'the ambient (refused)') + '; vacuum ' + cfv(S) + ' / ' + cfv(F) }));
    tiles.appendChild(tile('Exit pressure, kPa', pairNodes(hasS ? sig(S.exit.P / 1e3, 4) : '-', hasF ? sig(F.exit.P / 1e3, 4) : '-'), 'derived', { sub: A.ambient && A.ambient.pa > 0 ? 'ambient ' + sig(A.ambient.pa / 1e3, 4) + ' kPa' : 'vacuum' }));
    tiles.appendChild(tile('Exit temperature, K', pairNodes(hasS ? fmt(S.exit.T, 0) : '-', hasF ? fmt(F.exit.T, 0) : '-'), 'derived'));
    tiles.appendChild(tile('Exit Mach number', pairNodes(hasS ? fmt(S.exit.mach, 3) : '-', hasF ? fmt(F.exit.mach, 3) : '-'), 'derived', { sub: 'velocity ' + (hasS ? fmt(S.exit.u, 0) : '-') + ' / ' + (hasF ? fmt(F.exit.u, 0) : '-') + ' m/s' }));
    tiles.appendChild(tile('c*, m/s', pairNodes(hasS ? fmt(S.base.cstar, 1) : '-', hasF ? fmt(F.base.cstar, 1) : '-'), 'derived', { sub: A.frozenMode === 'frozen' ? 'frozen at the chamber: the throat is frozen too' : 'frozen after the throat: same c*' }));
    if (A.lambda) tiles.appendChild(tile('Divergence efficiency', [fmt(A.lambda.value, 4)], 'derived', { sub: A.lambda.source + (A.lambda.extrapolated ? '; ' + A.lambda.note : '') }));
    if (A.contour && A.contour.type === 'bell') {
      var an = A.contour.angles;
      tiles.appendChild(tile('Parabola wall angles', [fmt(an.thetaN, 1) + '° / ' + fmt(an.thetaE, 1) + '°'], 'derived', { sub: 'initial / exit, SP-8120 Fig 5(b)' + (an.dashed ? ' (dashed there: SP-8120\'s extrapolation)' : '') + (an.sp125 && an.sp125.thetaN != null ? '; SP-125 Fig 4-14 reads ' + fmt(an.sp125.thetaN, 1) + '° / ' + (an.sp125.thetaE != null ? fmt(an.sp125.thetaE, 1) + '°' : '-') : '') }));
    }
    var z = A.sizing;
    if (z) {
      tiles.appendChild(tile('Throat / exit diameter', [len(z.Dt) + ' / ' + len(z.De)], 'derived', { sub: 'for ' + sig(z.F / 1e3, 5) + ' kN at ' + ambientLabel({ ambient: z.ambient }) + ', C_F ' + fmt(z.cf, 4) }));
      tiles.appendChild(tile('Mass flow', [fmt(z.mdot, 2), el('span', { class: 'u', text: 'kg/s' })], 'derived', { sub: 'ideal c* (' + A.design + ')' }));
      if (A.contour) tiles.appendChild(tile('Nozzle length', [len(A.contour.length)], 'derived', { sub: 'throat to exit; wetted area ' + sig(A.contour.wettedArea, 3) + ' m²' }));
    }
    renderAllTable();
  }
  /** An ambient pressure, with the standard-day altitude where it occurs if that is inside the table. */
  function where(pa) {
    var z = B.altitudeOfPressure(pa);
    var p = sig(pa / 1e3, 3) + ' kPa';
    if (pa > 101325) return p + ' (more than sea-level pressure: never, on a standard day)';
    return z != null ? p + ' (' + sig(z / 1000, 3) + ' km on a standard day, and lower)' : p;
  }
  function len(m) { return m >= 1 ? fmt(m, 3) + ' m' : fmt(m * 1000, 1) + ' mm'; }
  function renderAllTable() {
    var t = $('allTable');
    t.textContent = '';
    t.appendChild(el('tr', {}, [el('th', { text: 'Output' }), el('th', { text: 'Value' }), el('th', { text: 'Units' }), el('th', { text: 'Confidence' }), el('th', { text: 'Source' })]));
    var O = cur.handoff.outputs;
    Object.keys(O).forEach(function (k) {
      var o = O[k], v = o.value;
      var vs = Array.isArray(v) ? v.length + ' points' : typeof v === 'number' ? sig(v, 6) : String(v);
      t.appendChild(el('tr', {}, [el('td', { text: k }), el('td', { class: 'n', text: vs }), el('td', { text: o.units }), el('td', { text: o.confidence }), el('td', { text: o.source })]));
    });
  }

  // ------------------------------------------------------------------ contour drawing
  function renderContour() {
    var svg = $('contour'), g = cur.A && cur.A.contour;
    svg.textContent = '';
    var cap = $('contourCap'), leg = $('contourLegend');
    leg.textContent = '';
    if (!g) { cap.textContent = 'No contour: ' + ((cur.A && cur.A.refusals.filter(function (r) { return r.applies_to === 'contour'; })[0]) || { reason: 'see the refusals above' }).reason; return; }
    var W = drawWidth(svg), H = W < 520 ? 220 : 300, pad = W < 520 ? 16 : 30;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var ref = B.coneContour(g.Rt, g.eps, 15, window.NOZZLE_RULES.bell.downstreamArc);
    var xmin = g.points[0][0], xmax = Math.max(g.length, ref.length) * 1.02, rmax = g.Re * 1.08;
    var sc = Math.min((W - 2 * pad) / (xmax - xmin), (H - 2 * pad) / (2 * rmax));
    var X = function (x) { return pad + (x - xmin) * sc; }, Y = function (r) { return H / 2 - r * sc; };
    svg.appendChild(sv('line', { class: 'cl', x1: pad / 2, x2: W - pad / 2, y1: H / 2, y2: H / 2 }));
    var up = g.points.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }), dn = g.points.map(function (p) { return X(p[0]) + ',' + Y(-p[1]); });
    var div = g.points.filter(function (p) { return p[0] >= 0; });
    var gas = div.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).concat(div.slice().reverse().map(function (p) { return X(p[0]) + ',' + Y(-p[1]); }));
    svg.appendChild(sv('polygon', { class: 'gas', points: gas.join(' ') }));
    var conePts = ref.points.filter(function (p) { return p[0] >= 0; });
    svg.appendChild(sv('polyline', { class: 'cone', points: conePts.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ') }));
    svg.appendChild(sv('polyline', { class: 'cone', points: conePts.map(function (p) { return X(p[0]) + ',' + Y(-p[1]); }).join(' ') }));
    var stub = g.points.filter(function (p) { return p[0] <= 0; });
    svg.appendChild(sv('polyline', { class: 'stub', points: stub.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ') }));
    svg.appendChild(sv('polyline', { class: 'stub', points: stub.map(function (p) { return X(p[0]) + ',' + Y(-p[1]); }).join(' ') }));
    svg.appendChild(sv('polyline', { class: 'wall', points: div.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ') }));
    svg.appendChild(sv('polyline', { class: 'wall', points: div.map(function (p) { return X(p[0]) + ',' + Y(-p[1]); }).join(' ') }));
    // throat and exit planes
    svg.appendChild(sv('line', { class: 'dim', x1: X(0), x2: X(0), y1: Y(g.Rt), y2: Y(-g.Rt) }));
    svg.appendChild(sv('line', { class: 'dim', x1: X(g.length), x2: X(g.length), y1: Y(g.Re), y2: Y(-g.Re) }));
    var u = g.scaled ? function (m) { return len(m); } : function (m) { return sig(m / g.Rt, 3) + ' Rt'; };
    svg.appendChild(sv('text', { class: 'lbl', x: X(0) + 4, y: H / 2 + 14 }, 'Dt ' + u(2 * g.Rt)));
    svg.appendChild(sv('text', { class: 'lbl', x: X(g.length) - 4, y: H / 2 + 14, 'text-anchor': 'end' }, 'De ' + u(2 * g.Re)));
    svg.appendChild(sv('text', { class: 'lbl', x: W / 2, y: H - 4, 'text-anchor': 'middle' }, 'L ' + u(g.length) + (W < 520 ? '' : g.type === 'bell' ? ' (' + sig(g.Lf * 100, 3) + ' % of the 15° cone, ' + u(g.length / g.Lf) + ')' : ' (' + sig(g.Lf * 100, 3) + ' % of a 15° cone)')));
    if (g.type === 'bell') {
      svg.appendChild(sv('circle', { class: 'mark', cx: X(g.N[0]), cy: Y(g.N[1]), r: 4 }));
      svg.appendChild(sv('circle', { class: 'mark', cx: X(g.E[0]), cy: Y(g.E[1]), r: 4 }));
      svg.appendChild(sv('text', { class: 'lbl', x: X(g.N[0]) - 4, y: Y(g.N[1]) - 8, 'text-anchor': 'end' }, 'N'));
      svg.appendChild(sv('text', { class: 'lbl', x: X(g.E[0]) - 6, y: Y(g.E[1]) - 8, 'text-anchor': 'end' }, 'E'));
    } else {
      svg.appendChild(sv('text', { class: 'lbl', x: (X(0) + X(g.length)) / 2, y: Y(g.Re) - 8, 'text-anchor': 'middle' }, g.alpha + '° half-angle'));
    }
    leg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color: var(--ink)' }), g.type === 'bell' ? 'Rao parabola (SP-125 construction, SP-8120 angles)' : 'cone']));
    leg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--muted)' }), '15° cone, same throat and area ratio']));
    leg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--muted)' }), 'upstream 1.5 Rt arc (the chamber is module 33\'s)']));
    cap.textContent = (g.type === 'bell' ? 'The parabola leaves the throat arc at N at ' + fmt(g.thetaN, 1) + '° and meets the lip at E at ' + fmt(g.thetaE, 1) + '°. ' : '') + (g.scaled ? 'Drawn to scale for the thrust asked.' : 'No thrust given, so lengths are per throat radius.') + ' Throat downstream arc ' + sig(g.downstreamArc / g.Rt, 3) + ' Rt' + (g.type === 'bell' ? ' (SP-125)' : ' (SP-8120: not under about 0.75 Rt for a cone)') + '; divergent wall area ' + (g.scaled ? sig(g.wettedArea, 3) + ' m²' : sig(g.wettedArea / (g.Rt * g.Rt), 3) + ' Rt²') + '.';
  }

  // ------------------------------------------------------------------ chart
  var chartGeom = null, dragging = false;
  function epsList() { var a = []; for (var i = 0; i <= 48; i++) a.push(EPS_MIN * Math.pow(EPS_MAX / EPS_MIN, i / 48)); return a; }
  function renderChart() {
    var svg = $('chart'), leg = $('legend'), cap = $('chartCap');
    svg.textContent = ''; leg.textContent = ''; chartGeom = null;
    var A = cur.A;
    var S = A.flows.shifting, F = A.flows.frozen;
    if (!(S && S.base) && !(F && F.base)) { cap.textContent = 'Nothing to draw: the chamber was refused.'; return; }
    // review fix: no divergence efficiency, no after-divergence curves (they used to be drawn with lambda = 1)
    if (!A.lambda) { cap.textContent = 'Nothing to draw: this contour has no divergence efficiency (see the refusal above), so there is no specific impulse after divergence loss to plot.'; return; }
    var W = drawWidth(svg), H = W < 520 ? 300 : 340, L = 52, R = 12, Tp = 14, Bt = 40;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var series = [], bands = [], xlog = state.chart === 'eps', xs, xlab, xval, marker;
    var lam = A.lambda ? A.lambda.value : 1;
    if (state.chart === 'alt') {
      xs = []; for (var z = 0; z <= 50; z += 1) xs.push(z);
      xlab = 'Altitude, km (1976 standard atmosphere)';
      [['shifting', S, 's1'], ['frozen', F, 's2']].forEach(function (f) {
        if (!f[1] || !f[1].exit) return;
        var rows = B.ambientSweep(f[1].base, f[1].exit, lam, xs.map(function (z) { return PF.isa(z * 1000).P_Pa; }));
        series.push({ name: f[0] + ', this nozzle', cls: f[2], pts: rows.map(function (r, i) { return [xs[i], r.isp / G0, r.status]; }) });
        if (f[0] === 'shifting') series.push({ name: 'ideal nozzle at each altitude (exit = ambient, no divergence loss), shifting', cls: 's3', dash: true, pts: rows.map(function (r, i) { return [xs[i], r.ispOptimum != null ? r.ispOptimum / G0 : null]; }) });
        if (f[0] === A.design) bands = rows.map(function (r, i) { return [xs[i], r.status]; });
      });
      xval = state.amb === 'altitude' ? state.alt : null;
      cap.textContent = 'This nozzle\'s specific impulse against altitude, after divergence loss. The green dashes are a nozzle re-sized at each altitude so its exit pressure equals the ambient; they stop where that would take an area ratio past ' + EPS_MAX + '. Red: SP-8120 says the ' + A.design + ' flow separates there (the full-flowing line is dashed: a lower bound, not a prediction); amber: within 20 % of separating. Tap or drag to set the altitude.';
    } else {
      xs = epsList();
      xlab = 'Area ratio (log scale), at ' + ambientLabel(A);
      var pa = A.ambient ? A.ambient.pa : 0;
      var lamFn = state.contour === 'cone' ? function () { return lam; } : function (e) { return B.lambdaBell(state.Lf, e).value; };
      [['shifting', S, 's1'], ['frozen', F, 's2']].forEach(function (f) {
        if (!f[1] || !f[1].base) return;
        var rows = B.areaSweep(f[1].base, pa, xs, lamFn);
        series.push({ name: f[0], cls: f[2], pts: rows.map(function (r) { return [r.eps, r.refusal ? null : r.isp / G0, r.status]; }) });
        if (f[0] === A.design) bands = rows.map(function (r) { return [r.eps, r.refusal ? 'refused' : r.status]; });
      });
      xval = state.eps;
      cap.textContent = 'Specific impulse against area ratio at this ambient, with this contour\'s divergence efficiency (a bell\'s from SP-125 Figure 4-12 at each area ratio). Red: the ' + A.design + ' flow separates (SP-8120); amber: marginal; grey: refused. Tap or drag to set the area ratio.';
    }
    var ys = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p[1] != null && isFinite(p[1])) ys.push(p[1]); }); });
    if (!ys.length) { cap.textContent = 'Nothing to draw here.'; return; }
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var step = niceStep((ymax - ymin) / 5 || 10);
    ymin = Math.floor(ymin / step) * step; ymax = Math.ceil(ymax / step) * step;
    if (ymax === ymin) ymax = ymin + step;
    var x0 = xs[0], x1 = xs[xs.length - 1];
    var X = function (x) { return L + (W - L - R) * (xlog ? Math.log(x / x0) / Math.log(x1 / x0) : (x - x0) / (x1 - x0)); };
    var Y = function (y) { return Tp + (H - Tp - Bt) * (1 - (y - ymin) / (ymax - ymin)); };
    chartGeom = { X: X, L: L, W: W, R: R, x0: x0, x1: x1, xlog: xlog };
    // separation bands
    for (var i = 0; i < bands.length; i++) {
      var st = bands[i][1];
      if (st !== 'separated' && st !== 'marginal' && st !== 'refused') continue;
      var a = i > 0 ? (X(bands[i - 1][0]) + X(bands[i][0])) / 2 : X(bands[i][0]);
      var b = i < bands.length - 1 ? (X(bands[i][0]) + X(bands[i + 1][0])) / 2 : X(bands[i][0]);
      svg.appendChild(sv('rect', { class: st === 'separated' ? 'sepband' : st === 'marginal' ? 'margband' : 'refband', x: a, y: Tp, width: Math.max(1, b - a), height: H - Tp - Bt }));
    }
    for (var yv = ymin; yv <= ymax + 1e-9; yv += step) {
      svg.appendChild(sv('line', { class: 'grid', x1: L, x2: W - R, y1: Y(yv), y2: Y(yv) }));
      svg.appendChild(sv('text', { x: L - 6, y: Y(yv) + 4, 'text-anchor': 'end' }, String(+yv.toFixed(1))));
    }
    var ticks = xlog ? (W < 520 ? [2, 10, 50, 400] : [1.5, 2, 5, 10, 20, 50, 100, 200, 400]) : [0, 10, 20, 30, 40, 50];
    ticks.forEach(function (t) {
      svg.appendChild(sv('line', { class: 'grid', x1: X(t), x2: X(t), y1: Tp, y2: H - Bt }));
      svg.appendChild(sv('text', { x: X(t), y: H - Bt + 16, 'text-anchor': 'middle' }, String(t)));
    });
    svg.appendChild(sv('line', { class: 'axis', x1: L, x2: W - R, y1: H - Bt, y2: H - Bt }));
    svg.appendChild(sv('line', { class: 'axis', x1: L, x2: L, y1: Tp, y2: H - Bt }));
    svg.appendChild(sv('text', { class: 'lbl', x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle' }, xlab));
    svg.appendChild(sv('text', { class: 'lbl', x: 12, y: (Tp + H - Bt) / 2, transform: 'rotate(-90 12 ' + (Tp + H - Bt) / 2 + ')', 'text-anchor': 'middle' }, 'Specific impulse, s'));
    series.forEach(function (s) {
      // solid where the flow is full (or the point has no status), dashed where it separates
      var seg = [], segs = [];
      s.pts.forEach(function (p) {
        if (p[1] == null || !isFinite(p[1])) { if (seg.length) segs.push(seg); seg = []; return; }
        var sep = p[2] === 'separated';
        if (seg.length && seg.sep !== sep) { segs.push(seg); var last = seg[seg.length - 1]; seg = [last]; }
        seg.sep = sep; seg.push(p);
      });
      if (seg.length) segs.push(seg);
      segs.forEach(function (sg) {
        svg.appendChild(sv('polyline', { class: 'line ' + s.cls + (s.dash || sg.sep ? ' dash' : ''), points: sg.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ') }));
      });
      leg.appendChild(el('li', {}, [el('span', { class: 'key' + (s.dash ? ' dash' : ''), style: 'border-color: var(--' + s.cls + ')' }), s.name]));
    });
    if (xval != null && xval >= x0 && xval <= x1) {
      svg.appendChild(sv('line', { class: 'cursor', x1: X(xval), x2: X(xval), y1: Tp, y2: H - Bt }));
      if (state.chart === 'eps') {
        [['shifting', 'dot1'], ['frozen', 'dot2']].forEach(function (f) {
          var Fl = A.flows[f[0]];
          if (Fl && Fl.amb) svg.appendChild(sv('circle', { class: f[1], cx: X(xval), cy: Y(Fl.amb.isp / G0), r: 5 }));
        });
      }
    }
    leg.appendChild(el('li', {}, [el('span', { class: 'key dot', style: 'background: var(--crit); opacity: 0.4' }), 'separates (SP-8120)']));
    leg.appendChild(el('li', {}, [el('span', { class: 'key dot', style: 'background: var(--warn); opacity: 0.5' }), 'marginal (within 20 %)']));
  }
  /** Draw in the element's own pixels so text keeps its size on a phone. */
  function drawWidth(svg) { var w = Math.round(svg.getBoundingClientRect().width); return w > 200 ? w : 800; }
  function niceStep(r) { var p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  function bindChart() {
    var svg = $('chart');
    function setFrom(evt) {
      if (!chartGeom) return;
      var rect = svg.getBoundingClientRect(), g = chartGeom;
      var px = (evt.clientX - rect.left) * g.W / rect.width;
      var f = Math.min(Math.max((px - g.L) / (g.W - g.L - g.R), 0), 1);
      var v = g.xlog ? g.x0 * Math.pow(g.x1 / g.x0, f) : g.x0 + f * (g.x1 - g.x0);
      if (state.chart === 'eps') { state.eps = +v.toPrecision(3); state.engineKey = null; }
      else { state.amb = 'altitude'; state.alt = Math.round(v * 2) / 2; }
      update();
    }
    svg.addEventListener('pointerdown', function (e) { dragging = true; try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } setFrom(e); });
    svg.addEventListener('pointermove', function (e) { if (dragging) setFrom(e); });
    var end = function () { dragging = false; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('keydown', function (e) {
      var up = e.key === 'ArrowRight' || e.key === 'ArrowUp', dn = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
      if (!up && !dn) return;
      e.preventDefault();
      if (state.chart === 'eps') { state.eps = +Math.min(EPS_MAX, Math.max(EPS_MIN, state.eps * (up ? 1.05 : 1 / 1.05))).toPrecision(3); state.engineKey = null; }
      else { state.amb = 'altitude'; state.alt = Math.min(86, Math.max(0, state.alt + (up ? 1 : -1))); }
      update();
    });
  }

  // ------------------------------------------------------------------ helpers: ideal area ratio for this ambient
  function goIdeal(limit) {
    var A = cur.A, note = $('btnNote');
    var D = A.flows[A.design];
    if (!D || !D.base) { note.textContent = 'No flow to work from.'; return; }
    var pa = A.ambient ? A.ambient.pa : 0;
    if (!(pa > 0)) { note.textContent = 'In vacuum every larger area ratio gives more impulse; there is no ideal one (the envelope ends at ' + EPS_MAX + ').'; return; }
    var target = pa;
    if (limit) {
      // the exit pressure at which this ambient is exactly SP-8120's 20 % margin above separation
      var S = window.NOZZLE_RULES.separation;
      target = pa * S.a * Math.pow(pa / D.base.pc, S.b) * (1 + S.margin.fraction);
    }
    var st = B.stationAtPressure(D.base, target);
    if (st.refusal) { note.textContent = st.refusal.reason; return; }
    if (st.eps < EPS_MIN || st.eps > EPS_MAX) { note.textContent = 'That area ratio (' + sig(st.eps, 4) + ') is outside the ' + EPS_MIN + ' to ' + EPS_MAX + ' this page was checked over.'; return; }
    state.eps = +st.eps.toPrecision(4); state.engineKey = null;
    note.textContent = limit ? 'Area ratio ' + sig(st.eps, 4) + ': the exit pressure is 20 % above where SP-8120 puts separation at this ambient (' + A.design + ' flow). Larger flows marginal, then separated.'
      : 'Area ratio ' + sig(st.eps, 4) + ': the ' + A.design + ' exit pressure equals the ambient, the ideal expansion for this ambient (before divergence loss).';
    update();
  }

  // ------------------------------------------------------------------ real engines
  var engineRows = [];
  function buildEngines() {
    var t = $('engines');
    t.appendChild(el('tr', {}, ['Engine', 'Propellant, O/F', 'pc, bar', 'Area ratio', 'Contour', 'At', 'Published, s', 'Shifting, s', 'Frozen, s', 'Flow', ''].map(function (h) { return el('th', { text: h }); })));
    T1.ROWS.forEach(function (row) {
      var c = B.engineCase(row, P.PRESETS);
      if (c.refusal) {
        t.appendChild(el('tr', {}, [el('td', { class: 'eng', text: row.engine }), el('td', { class: 'wrap', colspan: '10', text: 'Not modelled: ' + c.refusal.reason })]));
        return;
      }
      c.points.forEach(function (p) {
        var key = row.engine + ' (' + p.condition + ')';
        var gap = function (o) { return o && o.isp ? el('span', { text: fmt(o.isp / G0, 1) + ' (' + (o.gap > 0 ? '+' : '') + fmt(100 * o.gap, 1) + ' %)' }) : '-'; };
        var btn = el('button', { type: 'button', text: 'Load', 'aria-label': 'Load ' + key });
        btn.addEventListener('click', function () { loadEngine(row, c, p); });
        // data-label: the column name, shown before each cell when the table stacks on a phone (style.css)
        var tr = el('tr', { 'data-key': key }, [el('td', { class: 'eng', text: row.engine }), el('td', { 'data-label': 'propellant, O/F', text: c.prop + ', ' + row.mr }), el('td', { class: 'n', 'data-label': 'pc, bar', text: sig(c.pcChem / 1e5, 4) }),
          el('td', { class: 'n', 'data-label': 'area ratio', text: String(row.eps) }), el('td', { text: /conical/i.test(row.exit) ? 'cone ' + row.divergence + '°' : 'bell ' + (c.Lf != null ? fmt(c.Lf * 100, 0) + ' %' : '') }),
          el('td', { text: p.condition === 'sl' ? 'sea level' : p.condition === 'vac' ? 'vacuum' : 'altitude' }), el('td', { class: 'n', 'data-label': 'published, s', text: fmt(p.ispPublished / G0, 0) }),
          el('td', { class: 'n', 'data-label': 'shifting, s' }, [gap(p.shifting)]), el('td', { class: 'n', 'data-label': 'frozen, s' }, [gap(p.frozen)]),
          el('td', { 'data-label': 'flow', text: p.shifting.status === 'separated' ? 'separates' : p.shifting.status === 'vacuum' ? '-' : p.shifting.status }), el('td', { class: 'act' }, [btn])]);
        t.appendChild(tr);
        engineRows.push({ key: key, tr: tr });
      });
    });
    $('enginesNote').textContent = 'Model: idea 31\'s chamber at the table\'s mixture ratio and (injector) chamber pressure, this page\'s expansion to the table\'s area ratio, the bell\'s divergence efficiency from its length (SP-125 Figure 4-12; lengths outside 60-100 % use the nearest end), "alt" taken as vacuum. A negative gap means the engine delivered less than the ideal. Every published value is below the shifting ideal (by 2.1 to 9.0 %): that is the boundary layer, finite-rate chemistry, combustion efficiency and, for turbine-driven engines, the turbine flow, none of which is modelled here. "50:50" is read as Aerozine 50 (half hydrazine, half UDMH by mass), which the table does not spell out.';
  }
  function loadEngine(row, c, p, quiet) {
    applyPreset(row.prop);
    state.of = row.mr; state.pc = c.pcChem; state.eps = row.eps;
    if (/conical/i.test(row.exit)) { state.contour = 'cone'; state.alpha = parseFloat(row.divergence); }
    else { state.contour = 'bell'; state.Lf = Math.min(Math.max(c.Lf, 0.6), 1); }
    state.amb = p.condition === 'sl' ? 'altitude' : 'vacuum'; state.alt = 0;
    state.thrust = p.thrustPublished ? +(p.thrustPublished / 1e3).toPrecision(6) : null;
    state.imported = null; state.engineKey = row.engine + ' (' + p.condition + ')';
    update();
    if (!quiet) $('inputs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function markEngine() { engineRows.forEach(function (e) { e.tr.className = e.key === state.engineKey ? 'current' : ''; }); }

  // ------------------------------------------------------------------ handoff
  function renderHandoff() {
    var json = JSON.stringify(cur.handoff, null, 2);
    $('exportText').value = json;
    $('nextLink').href = '../33-engine-deck/index.html#h=' + M.b64urlEncode(JSON.stringify(cur.handoff));
  }
  function copyExport() {
    var s = $('exportStatus'), txt = $('exportText').value;
    var done = function (ok) { s.textContent = ok ? 'Copied ' + txt.length + ' characters.' : 'Copy failed: select the text below and copy it by hand.'; s.className = 'status ' + (ok ? 'ok' : 'bad'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { $('exportText').select(); done(document.execCommand && document.execCommand('copy')); });
    else { $('exportText').select(); done(document.execCommand && document.execCommand('copy')); }
  }
  function download() {
    var blob = new Blob([$('exportText').value], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'handoff.json' });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    $('exportStatus').textContent = 'Downloaded handoff.json.'; $('exportStatus').className = 'status ok';
  }
  function doImport(text, how) {
    var s = $('importStatus');
    var p = B.parseHandoff(text);
    if (p.refusal) { s.textContent = 'Not imported (' + p.refusal.code.replace(/_/g, ' ') + '): ' + p.refusal.reason + ' ' + p.refusal.what_would_help; s.className = 'status bad'; return false; }
    var r = B.chamberFromHandoff(p.chamberHandoff, p.inputs);
    state.oxidizer = p.inputs.oxidizer; state.fuel = p.inputs.fuel; state.of = p.inputs.of; state.pc = p.inputs.pc;
    var pr = presetById(p.inputs.preset);
    state.presetId = pr ? pr.id : state.presetId; state.ofRange = pr ? pr.ofRange.slice() : [Math.max(0.1, p.inputs.of / 2), p.inputs.of * 2];
    state.imported = { h31: p.chamberHandoff, inputs: p.inputs, note: r.refusal ? 'refused: see below' : 'checked: idea 31\'s kernel gives the same c* and chamber temperature' };
    state.engineKey = null;
    if (p.nozzle) {
      var n = p.nozzle;
      if (isFinite(n.area_ratio)) state.eps = n.area_ratio;
      if (n.contour && n.contour.type === 'cone') { state.contour = 'cone'; state.alpha = n.contour.alpha; } else if (n.contour) { state.contour = 'bell'; state.Lf = n.contour.Lf; }
      if (n.ambient) {
        state.amb = n.ambient.kind;
        if (n.ambient.kind === 'altitude') state.alt = n.ambient.alt_m / 1000;
        if (n.ambient.kind === 'pressure') state.pa = n.ambient.pa / 1e3;
      }
      state.design = n.design_flow === 'frozen' ? 'frozen' : 'shifting';
      state.freeze = n.freeze_point === 'throat' ? 'throat' : 'chamber';
      state.thrust = n.thrust_N == null ? null : n.thrust_N / 1e3;
    }
    update();
    s.textContent = 'Imported a ' + p.handoff.from + ' handoff (' + how + ')' + (r.refusal ? ', but its chamber is refused: ' + r.refusal.reason : ': its chamber matches idea 31\'s kernel.');
    s.className = 'status ' + (r.refusal ? 'bad' : 'ok');
    return true;
  }

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { renderContour(); renderChart(); }, 120); });

  // ------------------------------------------------------------------ start
  applyPreset('lox-rp1');
  bind();
  buildEngines();
  var hash = location.hash || '';
  var opened = false;
  if (/[#&]h=/.test(hash)) opened = doImport(hash, 'from the link');
  if (!opened) {
    // Open on the F-1 at sea level, from SP-8120 Table I: every opening input is the table's.
    var f1 = T1.ROWS.filter(function (r) { return r.engine === 'F-1'; })[0];
    var c = B.engineCase(f1, P.PRESETS);
    loadEngine(f1, c, c.points[0], true);
  }
})();
