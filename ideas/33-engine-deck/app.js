/* Engine Deck page: wires the controls to the kernel (engine.js on ideas 31 and 32's kernels) and draws. No network. */
(function () {
  'use strict';
  var M = window.Mixture, PF = window.PartForgeISA, P = window.MixturePresets, T1 = window.SP8120_TABLE1, TD = window.TurboData, EN = window.EngineDeck;
  var db = M.parseThermo(window.THERMO_EXCERPT);
  var B = window.Bell.create({ Mixture: M, db: db, charts: window.NOZZLE_CHARTS, rules: window.NOZZLE_RULES, isa: PF.isa, g0: PF.ISA_G0 });
  var E = EN.create({ Mixture: M, db: db, B: B, turbo: TD, table: T1.ROWS, presets: P.PRESETS, densities: window.PROPELLANT_DENSITIES, isa: PF.isa, g0: PF.ISA_G0 });
  var G0 = PF.ISA_G0, PSI = EN.PSI, LBF = EN.LBF, HP = EN.HP, LBM = EN.LBM;
  // The thermo.inp identity idea 31 stamps on its handoffs (engine.test.mjs checks it against idea 31's sample).
  var THERMO = { repo: 'https://github.com/nasa/cea', commit: '2f79a647e85737742fb08a127da00d1ea1d069da', path: 'data/thermo.inp', sha256: 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363' };
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
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
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
  function pct(x, d) { return (typeof x === 'number' && isFinite(x)) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d == null ? 1 : d) + ' %' : '-'; }
  function sig(v, n) { return (typeof v === 'number' && isFinite(v)) ? String(+v.toPrecision(n || 4)) : '-'; }

  var REF_OF = { 'F-1': 'F-1', 'H-1': 'H-1', 'J-2': 'J-2', 'LR89-NA-7': 'MA-5 booster', 'RL10A-3-3': 'RL10A-3-3A', 'YLR113-AJ-1': 'none' };
  var REF_LABEL = { 'F-1': 'Gas generator: F-1 (SP-8107)', 'H-1': 'Gas generator: H-1 (SP-8107)', 'MA-5 booster': 'Gas generator: Atlas MA-5 booster (SP-8107)', 'J-2': 'Gas generator: J-2, two turbines in series (SP-8107)',
    'SSME (EPL)': 'Staged combustion: SSME at emergency power, 1973 design (SP-8107)', 'RL10A-3-3A': 'Expander: RL10A-3-3A (NASA TM-107318)', 'none': 'None (not modelled)' };

  var state = { engine: 'F-1', etaC: null, etaF: null, mode: 'shifting', ref: 'F-1', rich: 'fuel', tin: null, tmin: 40, tmax: 110, thr: 100, alt: 0, vac: false, metric: 'isp', sizeKN: null };
  var cur = { base: null, cal: null, h32: null, spec: null, ctx: null, ref: null, dens: null, cyc: {}, handoff: null, parsed: null };

  // ------------------------------------------------------------------ engines
  function cleanContour(c) { return c.type === 'cone' ? { type: 'cone', alpha: c.alpha } : { type: 'bell', Lf: c.Lf }; }
  function buildH32(spec) {
    var sel = { preset: spec.preset, oxidizer: spec.prop.oxidizer, fuel: spec.prop.fuel, of: spec.of, pc: spec.pc };
    var ch = B.chamberHandoff(sel, window.PROPELLANT_DENSITIES, THERMO);
    var nz = { eps: spec.eps, contour: cleanContour(spec.contour), ambient: { kind: 'vacuum' }, design: 'shifting', freeze: 'chamber', thrust: null };
    var A = B.analyze(ch.rocket, nz);
    return B.makeHandoff(ch.handoff, nz, A, { assumptions: ['Built on the 33-engine-deck page for the ' + spec.id + ' preset (NASA SP-8120 Table I) with idea 32\'s analyze() and makeHandoff(), unmodified.'] });
  }
  function loadEngine(id, keep) {
    var s = E.engineSpec(id);
    if (s.refusal) return;
    cur.base = s.spec; cur.cal = s.spec.calibration; cur.parsed = null;
    state.engine = id;
    if (!keep) { state.etaC = s.spec.etaCstar; state.etaF = s.spec.etaCF; state.ref = REF_OF[id] || 'none'; state.mode = 'shifting'; state.tin = null; state.rich = 'fuel'; state.thr = 100; state.sizeKN = null; }
    cur.h32 = buildH32(s.spec);
  }
  function loadImported(parsed, eng) {
    eng = eng || {};
    var eff = eng.efficiencies || {};
    cur.parsed = parsed; cur.cal = null;
    cur.base = E.specFromNozzle(parsed, { At: eng.throat_area_m2, etaCstar: eff.cstar, etaCF: eff.thrust_coefficient });
    cur.h32 = parsed.nozzleHandoff;
    state.engine = 'imported';
    state.etaC = cur.base.etaCstar; state.etaF = cur.base.etaCF; state.mode = cur.base.mode;
    state.ref = eng.cycle_reference || 'none'; state.rich = eng.rich_side || 'fuel'; state.tin = null; state.thr = 100; state.sizeKN = null;
    if (eng.throttle) { state.tmin = Math.round(eng.throttle.min * 100); state.tmax = Math.round(eng.throttle.max * 100); }
  }
  function fillEngineSelect() {
    var s = $('engine'); s.innerHTML = '';
    E.ENGINES.forEach(function (e) {
      var r = T1.ROWS.filter(function (x) { return x.engine === e.table; })[0];
      s.appendChild(el('option', { value: e.id, text: e.id + ' (' + r.application + ')' }));
    });
    if (cur.parsed) s.appendChild(el('option', { value: 'imported', text: 'Imported from idea 32' }));
    s.value = state.engine;
  }
  function fillRefSelect() {
    var s = $('cycleRef'); s.innerHTML = '';
    ['F-1', 'H-1', 'MA-5 booster', 'J-2', 'SSME (EPL)', 'RL10A-3-3A', 'none'].forEach(function (id) { s.appendChild(el('option', { value: id, text: REF_LABEL[id] })); });
    s.value = state.ref;
  }

  // ------------------------------------------------------------------ compute
  function specNow() {
    var s = Object.assign({}, cur.base, { etaCstar: state.etaC, etaCF: state.etaF, mode: state.mode });
    if (!(s.At > 0) && state.sizeKN > 0) {
      var probe = E.point(E.context(Object.assign({}, s, { At: 1 })), s.pc, 0);
      if (!probe.refusal || probe.cfVac > 0) { s.At = state.sizeKN * 1e3 / (probe.cfVac * s.pc); s.sizedHere = true; }
    }
    return s;
  }
  function paNow() { return state.vac ? 0 : PF.isa(state.alt * 1000).P_Pa; }
  function cycleAt(p) {
    if (!cur.ref) return null;
    if (cur.ref.refusal) return cur.ref;
    if (!(p && p.mdot > 0)) return { refusal: { code: 'insufficient_data', reason: 'No mass flow here (no throat area, or the chamber is refused), so no pump or turbine power.', what_would_help: 'A throat area: a thrust in idea 32 or below, or an engine preset.' } };
    var key = p.pc.toPrecision(12);
    if (!cur.cyc[key]) {
      var d = cur.dens;
      cur.cyc[key] = E.cycle(cur.ref, { pc: p.pc, mdotOx: p.mdotOx, mdotFuel: p.mdotFuel, prop: cur.spec.prop, rhoOx: d.ox.value, rhoFuel: d.fuel.value }, { richSide: state.rich, TinOverride: state.tin });
    }
    return cur.cyc[key];
  }
  var SWEEP = []; for (var t = 10; t <= 120; t += 5) SWEEP.push(t / 100);
  var CYC_SWEEP = []; for (var t2 = 10; t2 <= 120; t2 += 10) CYC_SWEEP.push(t2 / 100);
  function compute() {
    cur.spec = specNow();
    cur.ctx = E.context(cur.spec);
    cur.ref = state.ref === 'none' ? null : E.cycleReference(state.ref);
    cur.dens = E.densities(cur.spec.prop);
    cur.cyc = {};
    cur.minFullSL = cur.ctx.ok ? E.minThrottleFull(cur.ctx, PF.isa(0).P_Pa, 0.1, 1.2) : null;
    cur.vacSweep = SWEEP.map(function (tau) { return E.point(cur.ctx, tau * cur.spec.pc, 0); });
    cur.cycSweep = CYC_SWEEP.map(function (tau) { var p = E.point(cur.ctx, tau * cur.spec.pc, 0); return { tau: tau, p: p, c: cycleAt(p) }; });
    renderEngine();
    renderOp();
    buildHandoff();
  }

  // ------------------------------------------------------------------ engine card
  function renderEngine() {
    var s = cur.spec, r = s.row;
    fillEngineSelect();
    $('engineSource').textContent = s.imported ? 'From idea 32\'s handoff: ' + (s.prop.label || 'propellant') + '. Chamber and nozzle recomputed with ideas 31 and 32\'s kernels and checked against the handoff.' :
      'NASA SP-8120 Table I: ' + r.engine + ', ' + r.application + '. Chamber, nozzle and throat are the table\'s; the turbomachinery is SP-8107\'s' + (s.turbo ? ' (' + s.turbo + ')' : ' (none listed)') + '.';
    var facts = [
      ['Propellant', (P.PRESETS.filter(function (x) { return x.id === s.preset; })[0] || { label: s.prop.label || 'custom' }).label],
      ['Mixture ratio', sig(s.of, 4)], ['Chamber pressure', fmt(s.pc / 1e5, 2) + ' bar (' + fmt(s.pc / PSI, 0) + ' psia)'],
      ['Area ratio', sig(s.eps, 4)], ['Contour', s.contour.type === 'cone' ? 'cone, ' + s.contour.alpha + '°' : 'bell, ' + fmt(s.contour.Lf * 100, 1) + ' % of a 15° cone' + (s.contour.note ? ' (' + s.contour.note + ')' : '')],
      ['Divergence efficiency', cur.ctx.lambda ? fmt(cur.ctx.lambda.value, 4) : 'refused'],
      ['Throat area', s.At > 0 ? fmt(s.At * 1e4, 1) + ' cm²' + (s.sizedHere ? ' (sized here)' : '') : 'none'],
    ];
    if (s.chambers > 1) facts.push(['Chambers', s.chambers + ' (each modelled)']);
    var ef = $('engineFacts'); ef.innerHTML = '';
    var tb = el('table', { 'aria-label': 'Engine facts' });
    facts.forEach(function (f) { tb.appendChild(el('tr', {}, [el('td', { text: f[0] }), el('td', { text: f[1] })])); });
    ef.appendChild(tb);
    if (s.imported && !(cur.base.At > 0)) {
      var row = el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('label', { for: 'sizeKN', html: 'Vacuum thrust to size for <small>(kN)</small>' }), el('input', { id: 'sizeKN', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: state.sizeKN || '' })])]);
      ef.appendChild(row);
      $('sizeKN').addEventListener('change', function () { var v = parseFloat(this.value); state.sizeKN = v > 0 ? v : null; compute(); });
    }
    $('etaC').value = sig(state.etaC, 5); $('etaF').value = sig(state.etaF, 5);
    var cal = cur.cal;
    $('etaCal').disabled = !cal;
    $('etaNote').innerHTML = cal ? 'Calibrated on SP-8120 Table I\'s ' + (cal.condition === 'sl' ? 'sea-level' : 'altitude') + ' thrust and Isp at ' + fmt(s.pc / PSI, 0) + ' psia and the printed throat area: c* ' + sig(cal.etaCstar, 4) + ', C<sub>F</sub> ' + sig(cal.etaCF, 4) + ' (Isp ' + sig(cal.etaCstar * cal.etaCF, 4) + ' of the shifting ideal).' + (cal.exceedsUnity ? ' <span class="chip-warn">above 1: a calibration factor, not an efficiency; the table\'s pressure, throat and Isp are not on one basis</span>' : '') :
      'Imported engines start ideal (1, 1). Idea 32 found real engines 2.1 to 9.0 % below the shifting ideal in Isp; type efficiencies to apply a loss.';
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)); });
    fillRefSelect();
    var refC = cur.ref && !cur.ref.refusal ? cur.ref.cycle : null;
    $('richCtl').hidden = refC !== 'staged-combustion';
    $('tinCtl').hidden = !(refC === 'staged-combustion' || refC === 'expander');
    document.querySelectorAll('[data-rich]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.rich === state.rich)); });
    $('tinNum').value = state.tin > 0 ? state.tin : '';
    $('cycleNote').textContent = !cur.ref ? 'No turbopump cycle: the deck is the thrust chamber alone.' + (s.id === 'YLR113-AJ-1' ? ' SP-8107 has no turbopump data for this sled engine.' : '') :
      cur.ref.refusal ? cur.ref.refusal.reason : 'Every pressure ratio, efficiency, temperature and flow share is ' + cur.ref.id + '\'s (' + cur.ref.source + '), held over the throttle range. ' +
      (refC === 'gas-generator' ? 'The pumps\' discharge pressures scale with chamber pressure by its ratios.' : refC === 'staged-combustion' ? 'The turbine pressure ratio is solved; the pump discharge rises with it.' : 'The hydrogen\'s turbine inlet temperature is the reference\'s (the jacket\'s heat pick-up is not modelled); the pressure ratio is solved.');
    $('tmin').value = state.tmin; $('tmax').value = state.tmax;
  }

  // ------------------------------------------------------------------ operating point
  function tile(k, v, u, conf, sub, cls) {
    var t = el('div', { class: 'tile' + (cls ? ' ' + cls : '') });
    t.appendChild(el('div', { class: 'k', text: k }));
    var vv = el('div', { class: 'v' }); vv.appendChild(document.createTextNode(v)); if (u) vv.appendChild(el('span', { class: 'u', text: u }));
    t.appendChild(vv);
    if (sub) t.appendChild(el('div', { class: 'sub', html: sub }));
    if (conf) t.appendChild(el('span', { class: 'c' + (conf === 'calibrated' ? ' cal' : ''), text: conf }));
    return t;
  }
  function refusalBox(r) {
    return el('div', { class: 'refusal' }, [el('b', { text: (r.applies_to ? r.applies_to.replace(/_/g, ' ') + ': ' : '') + r.code.replace(/_/g, ' ') }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]);
  }
  function renderOp() {
    var s = cur.spec, tau = state.thr / 100, pa = paNow();
    $('thrNum').value = state.thr; $('thrRange').value = state.thr;
    $('altNum').value = state.vac ? '' : state.alt; $('altRange').value = state.vac ? 86 : state.alt;
    $('vacBtn').setAttribute('aria-pressed', String(state.vac));
    var p = E.point(cur.ctx, tau * s.pc, pa), pv = E.point(cur.ctx, tau * s.pc, 0);
    var cyc = cycleAt(pv), el1 = E.engineLevel(p, cyc), elv = E.engineLevel(pv, cyc);
    cur.op = { p: p, pv: pv, cyc: cyc };
    var where = state.vac ? 'vacuum' : fmt(state.alt, 1) + ' km (' + fmt(pa / 1e3, 2) + ' kPa)';
    var V = $('verdict');
    if (p.refusal && p.refusal.applies_to !== 'thrust') { V.className = 'verdict separated'; V.textContent = 'Refused at this point: ' + p.refusal.reason; }
    else {
      V.className = 'verdict ' + p.status;
      var on = pv.sepOnset != null ? B.altitudeOfPressure(pv.sepOnset) : null;
      V.textContent = (p.status === 'vacuum' ? 'In vacuum the nozzle flows full.' : p.status === 'separated' ? 'At ' + where + ' the nozzle separates (SP-8120): thrust refused.' : p.status === 'marginal' ? 'At ' + where + ' the nozzle flows full but within SP-8120\'s 20 % of separating.' : 'At ' + where + ' the nozzle flows full.') +
        ' At ' + state.thr + ' % throttle it ' + (pv.sepOnset > PF.isa(0).P_Pa ? 'flows full at every altitude.' : on == null ? 'separates at any pressure the 1976 table holds.' : 'separates below ' + fmt(on / 1e3, 1) + ' km.');
    }
    var refs = [];
    cur.ctx.refusals.forEach(function (r) { refs.push(r); });
    if (p.refusal) refs.push(Object.assign({ applies_to: 'thrust' }, p.refusal));
    if (cyc && cyc.refusal) refs.push(Object.assign({ applies_to: 'cycle' }, cyc.refusal));
    var R = $('refusals'); R.innerHTML = ''; refs.forEach(function (r) { R.appendChild(refusalBox(r)); });
    var conf = cur.cal ? 'calibrated' : 'derived';
    var T = $('tiles'); T.innerHTML = '';
    var gg = cyc && !cyc.refusal && cyc.cycle === 'gas-generator';
    if (p.F != null) T.appendChild(tile('Thrust at ' + where, fmt(p.F / 1e3, 1), 'kN', conf, fmt(p.F / LBF, 0) + ' lbf' + (gg ? '; thrust chamber; the turbine exhaust adds 0 to ' + fmt(cyc.mdotGG * cyc.exhaustVelocityMax / 1e3, 1) + ' kN' : ''), 'hero'));
    else T.appendChild(tile('Thrust at ' + where, 'refused', '', null, p.refusal ? p.refusal.reason : '', 'hero refused'));
    if (p.isp != null) T.appendChild(tile('Specific impulse at ' + where, gg ? fmt(el1.ispLow / G0, 1) + '–' + fmt(el1.ispHigh / G0, 1) : fmt(p.isp / G0, 1), 's', conf,
      gg ? 'engine, exhaust dumped to fully expanded; thrust chamber ' + fmt(p.isp / G0, 1) + ' s' : (cyc && !cyc.refusal ? 'engine (closed cycle: every kilogram goes through the chamber)' : 'thrust chamber') + '; ' + fmt(p.isp, 0) + ' m/s', 'hero'));
    else T.appendChild(tile('Specific impulse at ' + where, 'refused', '', null, 'see above', 'hero refused'));
    if (pv.mdot > 0) T.appendChild(tile('Mass flow', fmt(el1.mdot, 1), 'kg/s', conf, 'chamber: oxidizer ' + fmt(pv.mdotOx, 1) + ', fuel ' + fmt(pv.mdotFuel, 1) + (gg ? '; gas generator ' + fmt(cyc.mdotGG, 2) + ' (' + fmt(100 * cyc.ggFraction, 2) + ' %)' : '') + ' kg/s'));
    T.appendChild(tile('Chamber pressure', fmt(tau * s.pc / 1e5, 2), 'bar', 'assumed', state.thr + ' % of nominal; ' + fmt(tau * s.pc / PSI, 0) + ' psia'));
    if (!p.refusal || p.refusal.applies_to === 'thrust') T.appendChild(tile('Nozzle exit', fmt(p.pe / 1e3, 2), 'kPa', 'derived', 'ambient ' + fmt(pa / 1e3, 2) + ' kPa; ' + (p.status || '') + '; separates once the ambient passes ' + fmt(pv.sepOnset / 1e3, 1) + ' kPa'));
    if (pv.Fvac != null && !pv.refusal) T.appendChild(tile('Vacuum', fmt(pv.Fvac / 1e3, 1), 'kN', conf, 'Isp ' + (gg ? fmt(elv.ispVacLow / G0, 1) + '–' + fmt(elv.ispVacHigh / G0, 1) : fmt(pv.ispVac / G0, 1)) + ' s'));
    else if (!pv.refusal) T.appendChild(tile('Vacuum Isp', fmt(pv.ispVac / G0, 1), 's', conf, 'no throat area, so no thrust'));
    if (!pv.refusal) T.appendChild(tile('Ideal (no losses)', fmt(pv.ispVacIdeal / G0, 1), 's', 'derived', 'vacuum Isp before divergence and the efficiencies; c* ' + fmt(pv.cstarIdeal, 0) + ' m/s'));
    var mf = cur.minFullSL;
    if (mf) T.appendChild(mf.refusal ? tile('Lowest throttle at sea level', 'none', '', 'derived', mf.refusal.reason, 'refused') : tile('Lowest throttle at sea level', mf.atFloor ? '≤ ' + fmt(mf.throttle * 100, 0) : fmt(mf.throttle * 100, 1), '%', 'derived', 'below it the nozzle separates at sea level (SP-8120)'));
    drawAlt(); drawThr(); renderCycle();
  }

  // ------------------------------------------------------------------ charts
  function drawWidth(svg) { var w = Math.round(svg.getBoundingClientRect().width); return w > 200 ? w : 800; }
  function geom(svg, Hdesk, Hphone) {
    var W = drawWidth(svg), H = W < 600 ? Hphone : Hdesk;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    return { W: W, H: H, m: { l: W < 600 ? 50 : 62, r: 14, t: 26, b: 38 } };
  }
  function axes(svg, W, H, m, x0, x1, y0, y1, xt, yt, xl, yl) {
    var X = function (x) { return m.l + (x - x0) / (x1 - x0) * (W - m.l - m.r); };
    svg.__inv = function (px) { return x0 + (px - m.l) / (W - m.l - m.r) * (x1 - x0); };
    var Y = function (y) { return H - m.b - (y - y0) / (y1 - y0) * (H - m.t - m.b); };
    xt.forEach(function (x) { svg.appendChild(sv('line', { class: 'grid', x1: X(x), x2: X(x), y1: m.t, y2: H - m.b })); svg.appendChild(sv('text', { x: X(x), y: H - m.b + 15, 'text-anchor': 'middle' }, String(x))); });
    yt.forEach(function (y) { svg.appendChild(sv('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: Y(y), y2: Y(y) })); svg.appendChild(sv('text', { x: m.l - 6, y: Y(y) + 4, 'text-anchor': 'end' }, String(+y.toPrecision(6)))); });
    svg.appendChild(sv('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
    svg.appendChild(sv('text', { class: 'lbl', x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, xl));
    svg.appendChild(sv('text', { class: 'lbl', x: 12, y: m.t - 8 }, yl));
    return { X: X, Y: Y };
  }
  function niceTicks(lo, hi, n) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n)));
    [1, 2, 2.5, 5, 10].some(function (m) { if (span / (step * m) <= n) { step *= m; return true; } return false; });
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, out = [];
    for (var v = a; v <= b + 1e-9 * step; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  function pathOf(pts, X, Y) {
    var d = '', pen = false;
    pts.forEach(function (q) { if (q[1] == null || !isFinite(q[1])) { pen = false; return; } d += (pen ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1) + ' '; pen = true; });
    return d;
  }
  function bands(svg, segs, X, m, H, cls) {
    segs.forEach(function (s) { svg.appendChild(sv('rect', { class: cls, x: X(s[0]), y: m.t, width: Math.max(1, X(s[1]) - X(s[0])), height: H - m.t - m.b })); });
  }
  function runs(xs, flag) {
    var out = [], start = null;
    xs.forEach(function (x, i) { if (flag[i] && start == null) start = i; if (!flag[i] && start != null) { out.push([xs[Math.max(0, start - 1)], x]); start = null; } });
    if (start != null) out.push([xs[Math.max(0, start - 1)], xs[xs.length - 1]]);
    return out;
  }
  function metricVal(p, cyc, which) {
    if (!p || p.refusal) return null;
    if (state.metric === 'thrust') return p.F != null ? p.F / 1e3 : null;
    if (which === 'lo' || which === 'hi') { var e = E.engineLevel(p, cyc); return e.ispLow != null ? (which === 'lo' ? e.ispLow : e.ispHigh) / G0 : null; }
    return p.isp / G0;
  }
  var ALTS = []; for (var a = 0; a <= 86; a += 1) ALTS.push(a);
  function drawAlt() {
    var svg = $('chartAlt'); svg.innerHTML = '';
    var G = geom(svg, 320, 260), W = G.W, H = G.H, m = G.m, s = cur.spec, tau = state.thr / 100;
    var cycNow = cur.op.cyc, gg = cycNow && !cycNow.refusal && cycNow.cycle === 'gas-generator' && state.metric === 'isp';
    var pts = ALTS.map(function (z) { return E.point(cur.ctx, tau * s.pc, PF.isa(z * 1000).P_Pa); });
    var nom = ALTS.map(function (z) { return E.point(cur.ctx, s.pc, PF.isa(z * 1000).P_Pa); });
    var cur1 = pts.map(function (p, i) { return [ALTS[i], metricVal(p, null)]; }), nom1 = nom.map(function (p, i) { return [ALTS[i], metricVal(p, null)]; });
    var lo = gg ? pts.map(function (p, i) { return [ALTS[i], metricVal(p, cycNow, 'lo')]; }) : null, hi = gg ? pts.map(function (p, i) { return [ALTS[i], metricVal(p, cycNow, 'hi')]; }) : null;
    var vals = cur1.concat(nom1).concat(lo || []).concat(hi || []).map(function (q) { return q[1]; }).filter(function (v) { return v != null && isFinite(v); });
    if (!vals.length) { svg.appendChild(sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lbl' }, 'Nothing to plot: every point is refused (see above).')); $('capAlt').textContent = ''; return; }
    var y0 = Math.min.apply(null, vals), y1 = Math.max.apply(null, vals), pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.05 || 1;
    var yt = niceTicks(y0 - pad, y1 + pad, 6), A = axes(svg, W, H, m, 0, 86, yt[0], yt[yt.length - 1], [0, 10, 20, 30, 40, 50, 60, 70, 80], yt, 'altitude (km, 1976 standard atmosphere)', state.metric === 'isp' ? 'specific impulse (s)' : 'thrust (kN)');
    bands(svg, runs(ALTS, pts.map(function (p) { return p.status === 'separated'; })), A.X, m, H, 'sepband');
    if (gg) {
      var poly = lo.filter(function (q) { return q[1] != null; }).concat(hi.filter(function (q) { return q[1] != null; }).reverse());
      if (poly.length > 2) svg.appendChild(sv('path', { class: 'bracket', d: 'M' + poly.map(function (q) { return A.X(q[0]).toFixed(1) + ' ' + A.Y(q[1]).toFixed(1); }).join(' L') + ' Z' }));
      svg.appendChild(sv('path', { class: 'line s2', d: pathOf(lo, A.X, A.Y) }));
    }
    if (Math.abs(tau - 1) > 1e-9) svg.appendChild(sv('path', { class: 'line s1 dash', d: pathOf(nom1, A.X, A.Y) }));
    svg.appendChild(sv('path', { class: 'line s1', d: pathOf(cur1, A.X, A.Y) }));
    var xz = state.vac ? 86 : state.alt;
    svg.appendChild(sv('line', { class: 'cursor', x1: A.X(xz), x2: A.X(xz), y1: m.t, y2: H - m.b }));
    var pnow = cur.op.p, vnow = metricVal(pnow, null);
    if (vnow != null && !state.vac) svg.appendChild(sv('circle', { class: 'dot1', cx: A.X(xz), cy: A.Y(vnow), r: 5 }));
    var lg = $('legendAlt'); lg.innerHTML = '';
    lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color:var(--s1)' }), 'thrust chamber, ' + state.thr + ' % throttle']));
    if (Math.abs(tau - 1) > 1e-9) lg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color:var(--s1)' }), '100 % throttle']));
    if (gg) lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color:var(--s2)' }), 'engine (gas-generator flow dumped with no thrust; the band runs to complete expansion)']));
    lg.appendChild(el('li', {}, [el('span', { class: 'swatch', style: 'background:var(--crit);opacity:.35' }), 'separated: refused']));
    $('capAlt').textContent = 'Tap or drag to set the altitude (arrow keys when focused). Mass flow does not change with altitude; thrust grows by the exit area times the pressure the atmosphere no longer exerts.';
  }
  function drawThr() {
    var svg = $('chartThr'); svg.innerHTML = '';
    var G = geom(svg, 320, 260), W = G.W, H = G.H, m = G.m, s = cur.spec, pa = paNow();
    var xs = SWEEP.map(function (t) { return t * 100; });
    var here = SWEEP.map(function (t) { return E.point(cur.ctx, t * s.pc, pa); });
    var a1 = here.map(function (p, i) { return [xs[i], metricVal(p, null)]; }), v1 = cur.vacSweep.map(function (p, i) { return [xs[i], metricVal(p, null)]; });
    var cycS = cur.cycSweep, ggS = state.metric === 'isp' && cycS.some(function (c) { return c.c && !c.c.refusal && c.c.cycle === 'gas-generator'; });
    var eng = ggS ? cycS.map(function (c) { var p = E.point(cur.ctx, c.tau * s.pc, pa); return [c.tau * 100, metricVal(p, c.c, 'lo')]; }) : null;
    var vals = a1.concat(v1).concat(eng || []).map(function (q) { return q[1]; }).filter(function (v) { return v != null && isFinite(v); });
    if (!vals.length) { svg.appendChild(sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lbl' }, 'Nothing to plot: every point is refused (see above).')); $('capThr').textContent = ''; return; }
    var y0 = Math.min.apply(null, vals), y1 = Math.max.apply(null, vals), pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.05 || 1;
    var yt = niceTicks(Math.max(0, y0 - pad), y1 + pad, 6), A = axes(svg, W, H, m, 10, 120, yt[0], yt[yt.length - 1], [20, 40, 60, 80, 100, 120], yt, 'throttle (% of nominal chamber pressure)', state.metric === 'isp' ? 'specific impulse (s)' : 'thrust (kN)');
    bands(svg, runs(xs, here.map(function (p) { return p.status === 'separated'; })), A.X, m, H, 'sepband');
    svg.appendChild(sv('rect', { class: 'refband', x: A.X(state.tmin), y: H - m.b - 6, width: Math.max(1, A.X(state.tmax) - A.X(state.tmin)), height: 6 }));
    svg.appendChild(sv('path', { class: 'line s1 dash', d: pathOf(v1, A.X, A.Y) }));
    if (eng) svg.appendChild(sv('path', { class: 'line s2', d: pathOf(eng, A.X, A.Y) }));
    svg.appendChild(sv('path', { class: 'line s1', d: pathOf(a1, A.X, A.Y) }));
    svg.appendChild(sv('line', { class: 'cursor', x1: A.X(state.thr), x2: A.X(state.thr), y1: m.t, y2: H - m.b }));
    var vnow = metricVal(cur.op.p, null);
    if (vnow != null) svg.appendChild(sv('circle', { class: 'dot1', cx: A.X(state.thr), cy: A.Y(vnow), r: 5 }));
    var where = state.vac ? 'vacuum' : fmt(state.alt, 1) + ' km';
    var lg = $('legendThr'); lg.innerHTML = '';
    lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color:var(--s1)' }), 'thrust chamber at ' + where]));
    lg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color:var(--s1)' }), 'in vacuum']));
    if (eng) lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color:var(--s2)' }), 'engine at ' + where + ' (gas-generator flow dumped)']));
    lg.appendChild(el('li', {}, [el('span', { class: 'swatch', style: 'background:var(--crit);opacity:.35' }), 'separated: refused']));
    lg.appendChild(el('li', {}, [el('span', { class: 'swatch', style: 'background:var(--refused)' }), 'throttle range in the handoff']));
    $('capThr').textContent = 'Tap or drag to set the throttle. Each point re-runs idea 31\'s chamber and idea 32\'s nozzle at that chamber pressure; the efficiencies are held. Throttling down at sea level lowers the exit pressure until the nozzle separates.';
  }
  function chartPick(svg, cb) {
    var drag = false;
    var at = function (ev) { var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; if (!svg.__inv || !r.width) return; cb(svg.__inv((ev.clientX - r.left) / r.width * vb.width)); };
    svg.addEventListener('pointerdown', function (ev) { drag = true; svg.setPointerCapture && svg.setPointerCapture(ev.pointerId); at(ev); });
    svg.addEventListener('pointermove', function (ev) { if (drag) at(ev); });
    svg.addEventListener('pointerup', function () { drag = false; });
    svg.addEventListener('pointercancel', function () { drag = false; });
  }

  // ------------------------------------------------------------------ cycle card
  function renderCycle() {
    var cyc = cur.op.cyc, V = $('cycleVerdict'), T = $('cycleTiles'), Bal = $('balance'), st = $('stageTable');
    T.innerHTML = ''; Bal.innerHTML = ''; st.innerHTML = '';
    if (!cur.ref) { V.className = 'verdict vacuum'; V.textContent = 'No cycle chosen: the deck is the thrust chamber alone. Pick a reference to run its power balance at this throttle.'; drawCyc(); return; }
    if (!cyc || cyc.refusal) { V.className = 'verdict separated'; V.textContent = 'Refused: ' + ((cyc && cyc.refusal) || cur.ref.refusal).reason; drawCyc(); return; }
    var pc = cur.op.pv.pc, refEng = { 'F-1': 'F-1', 'H-1': 'H-1', 'J-2': 'J-2', 'LR89-NA-7': 'MA-5 booster', 'RL10A-3-3': null }[state.engine];
    var own = refEng && refEng === cur.ref.id && state.thr === 100;
    V.className = 'verdict full';
    if (cyc.cycle === 'gas-generator') {
      V.textContent = 'The gas generator burns ' + fmt(cyc.mdotGG, 2) + ' kg/s (' + fmt(100 * cyc.ggFraction, 2) + ' % of the engine\'s flow) to drive the pumps at this throttle, and throws it away.';
      T.appendChild(tile('Gas-generator flow', fmt(cyc.mdotGG, 2), 'kg/s', 'derived', fmt(cyc.mdotGG / LBM, 1) + ' lb/s' + (own ? '; SP-8107 publishes ' + TD.SP8107_TURBINES.filter(function (r) { return r.engine === refEng; }).reduce(function (a, r) { return Math.max(a, r.w); }, 0) + ' lb/s' : '')));
      T.appendChild(tile('Turbine inlet', fmt(cyc.stages[0].Tin, 0), 'K', 'derived', fmt(EN.KtoF(cyc.stages[0].Tin), 0) + ' F; ' + (cyc.gas.kind === 'tabulated' ? 'SP-8110 gas (idea 31 refuses this mixture)' : 'idea 31 gas at O/F ' + sig(cyc.gas.of, 4))));
      T.appendChild(tile('Pump discharge', fmt(cyc.pumps.ox.pout / 1e5, 1) + ' / ' + fmt(cyc.pumps.fuel.pout / 1e5, 1), 'bar', 'derived', 'oxidizer / fuel; ' + fmt(cyc.pumps.ox.pout / pc, 3) + ' and ' + fmt(cyc.pumps.fuel.pout / pc, 3) + ' x chamber'));
      T.appendChild(tile('Turbine power', fmt(cyc.turbinePower / 1e6, 2), 'MW', 'derived', fmt(cyc.turbinePower / HP, 0) + ' hp'));
      T.appendChild(tile('Engine Isp cost', fmt(100 * cyc.ggFraction, 2), '%', 'derived', 'of the chamber\'s Isp, if the exhaust gives no thrust'));
    } else {
      V.textContent = (cyc.cycle === 'staged-combustion' ? 'Staged combustion' : 'Expander') + ' closes at a turbine pressure ratio of ' + fmt(cyc.pr, 3) + ': the ' + (cyc.cycle === 'expander' ? 'fuel pump' : (state.rich === 'fuel' ? 'fuel' : 'oxidizer') + ' pump') + ' must reach ' + fmt(cyc.pumpDischargeOverChamber, 2) + ' times the chamber pressure.';
      T.appendChild(tile('Turbine pressure ratio', fmt(cyc.pr, 3), '', 'derived', own ? '' : (cur.ref.id === 'SSME (EPL)' ? 'SP-8107 SSME: 1.56 fuel, 1.59 oxidizer turbine' : cur.ref.id === 'RL10A-3-3A' ? 'TM-107318: 1.402' : '')));
      T.appendChild(tile('Pump discharge (highest)', fmt((cyc.cycle === 'expander' ? cyc.pumps.fuel.pout : cyc.pumps.rich.pout) / 1e5, 1), 'bar', 'derived', fmt((cyc.cycle === 'expander' ? cyc.pumps.fuel.pout : cyc.pumps.rich.pout) / PSI, 0) + ' psia; chamber ' + fmt(pc / 1e5, 1) + ' bar'));
      if (cyc.preburnerPressure) T.appendChild(tile('Preburner pressure', fmt(cyc.preburnerPressure / 1e5, 1), 'bar', 'derived', 'preburner flow: ' + fmt(cyc.richToPreburners + cyc.leanToPreburners, 1) + ' kg/s'));
      if (cyc.turbineInletPressure) T.appendChild(tile('Turbine inlet', fmt(cyc.turbineInletPressure / 1e5, 1), 'bar', 'derived', fmt(cyc.Tin, 1) + ' K hydrogen'));
      T.appendChild(tile('Turbine power', fmt(cyc.turbinePower / 1e6, 2), 'MW', 'derived', fmt(cyc.turbinePower / HP, 0) + ' hp = pump power'));
    }
    var Pp = cyc.pumpPower, Pt = cyc.turbinePower, mx = Math.max(Pp, Pt);
    var pumps = cyc.cycle === 'staged-combustion' ? null : cyc.pumps;
    var b1 = el('div', { class: 'bar' });
    if (cyc.cycle === 'gas-generator') { b1.appendChild(el('span', { class: 'bo', style: 'width:' + (100 * pumps.ox.power / mx).toFixed(1) + '%' })); b1.appendChild(el('span', { class: 'bf', style: 'left:' + (100 * pumps.ox.power / mx).toFixed(1) + '%;width:' + (100 * pumps.fuel.power / mx).toFixed(1) + '%' })); b1.appendChild(el('em', { text: 'pumps ' + fmt(Pp / 1e6, 2) + ' MW (oxidizer ' + fmt(pumps.ox.power / 1e6, 2) + ', fuel ' + fmt(pumps.fuel.power / 1e6, 2) + ')' })); }
    else { b1.appendChild(el('span', { class: 'bf', style: 'width:' + (100 * Pp / mx).toFixed(1) + '%' })); b1.appendChild(el('em', { text: 'pumps ' + fmt(Pp / 1e6, 2) + ' MW' })); }
    var b2 = el('div', { class: 'bar' }, [el('span', { class: 'bt', style: 'width:' + (100 * Pt / mx).toFixed(1) + '%' }), el('em', { text: 'turbine' + (cyc.stages && cyc.stages.length > 1 ? 's' : '') + ' ' + fmt(Pt / 1e6, 2) + ' MW' })]);
    Bal.appendChild(b1); Bal.appendChild(b2);
    if (cyc.stages) {
      st.appendChild(el('thead', {}, [el('tr', {}, ['Turbine', 'Inlet T (K)', 'Pressure ratio', 'Isentropic drop (kJ/kg)', 'Efficiency', 'Flow (kg/s)', 'Power (MW)'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      cyc.stages.forEach(function (sg) {
        var flow = sg.flow != null ? sg.flow : cyc.mdotGG * sg.flowFrac, power = sg.power != null ? sg.power : flow * sg.dh;
        tb.appendChild(el('tr', {}, [el('td', { 'data-k': 'Turbine', text: sg.label }), el('td', { class: 'n', 'data-k': 'Inlet T', text: fmt(sg.Tin, 0) }), el('td', { class: 'n', 'data-k': 'Pressure ratio', text: fmt(sg.pr || cyc.pr, 3) }),
          el('td', { class: 'n', 'data-k': 'Isentropic drop', text: fmt(sg.dhIs / 1e3, 1) }), el('td', { class: 'n', 'data-k': 'Efficiency', text: fmt(sg.eta != null ? sg.eta : sg.dh / sg.dhIs, 3) }), el('td', { class: 'n', 'data-k': 'Flow', text: fmt(flow, 2) }), el('td', { class: 'n', 'data-k': 'Power', text: fmt(power / 1e6, 2) })]));
      });
      st.appendChild(tb);
    }
    drawCyc();
  }
  function drawCyc() {
    var svg = $('chartCyc'); svg.innerHTML = '';
    var G = geom(svg, 260, 220), W = G.W, H = G.H, m = G.m;
    var lg = $('legendCyc'); lg.innerHTML = '';
    if (!cur.ref || cur.ref.refusal) { svg.appendChild(sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lbl' }, 'No cycle chosen.')); $('capCyc').textContent = ''; return; }
    var kind = cur.ref.cycle, xs = cur.cycSweep.map(function (c) { return c.tau * 100; });
    var ys = cur.cycSweep.map(function (c) { if (!c.c || c.c.refusal) return null; return kind === 'gas-generator' ? 100 * c.c.ggFraction : c.c.pumpDischargeOverChamber; });
    var vals = ys.filter(function (v) { return v != null; });
    if (!vals.length) { svg.appendChild(sv('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lbl' }, 'The cycle is refused at every throttle setting (see the verdict above).')); $('capCyc').textContent = ''; return; }
    var y0 = Math.min.apply(null, vals), y1 = Math.max.apply(null, vals), pad = (y1 - y0) * 0.1 || y1 * 0.1;
    var yt = niceTicks(Math.max(0, y0 - pad), y1 + pad, 5);
    var A = axes(svg, W, H, m, 10, 120, yt[0], yt[yt.length - 1], [20, 40, 60, 80, 100, 120], yt, 'throttle (%)', kind === 'gas-generator' ? 'gas-generator flow (% of engine flow)' : 'highest pump discharge / chamber pressure');
    bands(svg, runs(xs, ys.map(function (v) { return v == null; })), A.X, m, H, 'sepband');
    svg.appendChild(sv('path', { class: 'line s3', d: pathOf(xs.map(function (x, i) { return [x, ys[i]]; }), A.X, A.Y) }));
    ys.forEach(function (v, i) { if (v != null) svg.appendChild(sv('circle', { class: 'dot2', cx: A.X(xs[i]), cy: A.Y(v), r: 3 })); });
    svg.appendChild(sv('line', { class: 'cursor', x1: A.X(state.thr), x2: A.X(state.thr), y1: m.t, y2: H - m.b }));
    lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color:var(--s3)' }), kind === 'gas-generator' ? 'gas-generator flow share' : 'pump discharge needed to close']));
    lg.appendChild(el('li', {}, [el('span', { class: 'swatch', style: 'background:var(--crit);opacity:.35' }), 'cycle refused (does not close, or no gas)']));
    $('capCyc').textContent = kind === 'gas-generator' ? 'Pump power grows about as the square of throttle (flow times pressure rise), the flow as its first power, so the gas generator\'s share shrinks as the engine throttles down.' : 'The closed cycle\'s turbine must make up its own pressure drop: the pump discharge needed rises faster than the chamber pressure, until the cycle cannot close.';
  }

  // ------------------------------------------------------------------ published record (computed once)
  function th(cols) { return el('thead', {}, [el('tr', {}, cols.map(function (c) { return el('th', { text: c }); }))]); }
  function td(k, v, n, cls) { return el('td', { 'data-k': k, class: (n ? 'n' : '') + (cls ? ' ' + cls : ''), text: v }); }
  function why(k, r) { var t = el('td', { 'data-k': k }); t.appendChild(document.createTextNode('refused')); t.appendChild(el('span', { class: 'why', text: r.reason })); return t; }
  function gapCls(g) { return Math.abs(g) > 0.1 ? 'gap-bad' : ''; }
  var REC = null;
  function computeRecord() {
    var R = {};
    R.pumps = TD.SP8107_PUMPS.map(function (r) { return { row: r, c: E.pumpCheck(r) }; });
    R.turbines = TD.SP8107_TURBINES.map(function (r) { return { row: r, c: E.turbineCheck(r) }; });
    R.gg = []; ['F-1', 'H-1', 'MA-5 booster', 'J-2'].forEach(function (e) { ['table', 'computed'].forEach(function (m) { R.gg.push(E.ggFlowCheck(e, m)); }); });
    R.sc = { table: E.scPressureRatioCheck('table'), computed: E.scPressureRatioCheck('computed') };
    R.exp = E.expanderCheck();
    var ref = E.cycleReference('RL10A-3-3A'), X = TD.RL10A33A, lh2 = E.presetProp('lox-lh2');
    R.expCycle = E.cycle(ref, { pc: ref.pc, mdotOx: X.ox[2][4] * LBM, mdotFuel: X.fuel[3][4] * LBM, prop: lh2, rhoOx: X.ox[1][5] * EN.LB_FT3, rhoFuel: X.fuel[1][5] * EN.LB_FT3 });
    R.amb = E.ambientLawCheck(); R.basis = E.ispBasisCheck(); R.thr = E.throttleCheck();
    return R;
  }
  function renderRecord() {
    var R = REC;
    var range = function (a) { a = a.filter(function (x) { return x != null && isFinite(x); }); return a.length ? pct(Math.min.apply(null, a)) + ' to ' + pct(Math.max.apply(null, a)) + ' (median ' + pct(EN.median(a)) + ', n ' + a.length + ')' : '-'; };
    var pumpG = R.pumps.map(function (x) { return x.c.powerGap; });
    var tTab = R.turbines.map(function (x) { var m = x.c.methods && x.c.methods.table; return m && !m.refusal ? m.gap : null; });
    var tCmp = R.turbines.map(function (x) { var m = x.c.methods && x.c.methods.computed; return m && !m.refusal ? m.gap : null; });
    var ggG = R.gg.filter(function (g) { return !g.refusal; }).map(function (g) { return g.gap; });
    var S = $('recordSummary'); S.innerHTML = '';
    S.appendChild(tile('Altitude to sea-level thrust (3 engines)', range(R.amb.map(function (o) { return o.gap; })), '', 'derived', 'F(sl) = F(alt) - p_sl A_e on SP-8120 Table I'));
    S.appendChild(tile('Throttled to 39 % (YLR113-AJ-1)', 'thrust ' + pct(R.thr.Fgap, 2) + ', Isp ' + pct(R.thr.ispGap, 2), '', 'derived', 'calibrated at 595 psia, predicted at 235 psia, sea level'));
    S.appendChild(tile('Pump power (SP-8107 Table II)', range(pumpG), '', 'derived', 'flow x head / efficiency'));
    S.appendChild(tile('Turbine power, SP-8110 gas', range(tTab), '', 'derived', 'flow x efficiency x isentropic drop'));
    S.appendChild(tile('Turbine power, idea 31 gas', range(tCmp), '', 'derived', 'O2/H2 turbines'));
    S.appendChild(tile('Gas-generator flow needed', range(ggG), '', 'derived', 'from the pumps\' power, against SP-8107\'s turbine flow'));
    if (R.expCycle && !R.expCycle.refusal) S.appendChild(tile('Expander (RL10A-3-3A) pressure ratio', fmt(R.expCycle.pr, 4) + ' vs ' + TD.RL10A33A.turbine.pr_ts, '', 'derived', 'pump discharge ' + fmt(R.expCycle.pumps.fuel.pout / PSI, 1) + ' vs ' + TD.RL10A33A.fuel[3][2] + ' psia'));
    var t;
    t = $('tblAmbient'); t.innerHTML = '';
    t.appendChild(el('caption', { class: 'small', text: 'Sea-level thrust from altitude thrust (SP-8120 Table I): F(sl) = F(alt) − 101 325 Pa × A_e, the deck\'s own ambient law, with the printed exit area.' }));
    t.appendChild(th(['Engine', 'F alt (lbf)', 'F sl published', 'F sl model', 'gap', 'Isp sl published (s)', 'model', 'gap']));
    R.amb.forEach(function (o) { t.appendChild(el('tr', {}, [td('Engine', o.engine), td('F alt', fmt(o.Falt / LBF, 0), 1), td('Published', fmt(o.FslPublished / LBF, 0), 1), td('Model', fmt(o.Fsl / LBF, 0), 1), td('Gap', pct(o.gap, 2), 1), td('Isp published', fmt(o.ispSlPublished, 0), 1), td('Model', fmt(o.ispSl, 1), 1), td('Gap', pct(o.ispGap, 2), 1)])); });
    t = $('tblBasis'); t.innerHTML = '';
    t.appendChild(el('caption', { class: 'small', text: 'Which mass flow does SP-8120\'s Isp divide by? Its thrust over SP-8107\'s pump flows (the engine), or over the pumps less the gas generator\'s turbine flow (the thrust chamber). It is not the same for every engine.' }));
    t.appendChild(th(['Engine', 'condition', 'Isp published (s)', 'engine', 'gap', 'thrust chamber', 'gap', 'closer to']));
    R.basis.forEach(function (o) { t.appendChild(el('tr', {}, [td('Engine', o.engine + (o.turbopump !== o.engine ? ' (' + o.turbopump + ')' : '')), td('Condition', o.condition), td('Published', fmt(o.ispPublished, 0), 1), td('Engine', fmt(o.ispEngine, 1), 1), td('Gap', pct(o.engineGap, 2), 1), td('Chamber', o.ispChamber ? fmt(o.ispChamber, 1) : '-', 1), td('Gap', o.chamberGap != null ? pct(o.chamberGap, 2) : '-', 1), td('Closer to', o.basis)])); });
    t = $('tblThrottle'); t.innerHTML = '';
    t.appendChild(el('caption', { class: 'small', text: 'Throttling: SP-8120 gives the YLR113-AJ-1 sled engine as ranges. Calibrated at the top (595 psia, 150 000 lbf, 240 s at sea level), the deck predicts the bottom (235 psia).' }));
    t.appendChild(th(['Engine', 'chamber (psia)', 'thrust published (lbf)', 'model', 'gap', 'Isp published (s)', 'model', 'gap']));
    if (!R.thr.refusal) t.appendChild(el('tr', {}, [td('Engine', R.thr.engine), td('Chamber', fmt(R.thr.pcLow / PSI, 0), 1), td('Published', fmt(R.thr.FPublished / LBF, 0), 1), td('Model', fmt(R.thr.F / LBF, 0), 1), td('Gap', pct(R.thr.Fgap, 2), 1), td('Isp published', fmt(R.thr.ispPublished / G0, 0), 1), td('Model', fmt(R.thr.isp / G0, 1), 1), td('Gap', pct(R.thr.ispGap, 2), 1)]));
    t = $('tblCycle'); t.innerHTML = '';
    t.appendChild(th(['Check', 'gas', 'model', 'published', 'gap']));
    var tb = el('tbody');
    R.gg.forEach(function (g) {
      var lab = g.engine + ': gas-generator turbine flow (lb/s)';
      if (g.refusal) { var tr = el('tr', {}, [td('Check', lab), td('Gas', g.method === 'table' ? 'SP-8110' : 'idea 31'), why('Model', g.refusal), td('Published', ''), td('Gap', '')]); tb.appendChild(tr); return; }
      tb.appendChild(el('tr', {}, [td('Check', lab), td('Gas', g.method === 'table' ? 'SP-8110' : 'idea 31'), td('Model', fmt(g.flow, 2), 1), td('Published', String(g.flowPublished), 1), td('Gap', pct(g.gap), 1, gapCls(g.gap))]));
      if (g.secondFlow != null) {
        tb.appendChild(el('tr', {}, [td('Check', 'J-2: oxidizer turbine flow, in series (lb/s)'), td('Gas', 'idea 31'), td('Model', fmt(g.secondFlow, 2), 1), td('Published', String(g.secondFlowPublished), 1), td('Gap', pct(g.secondGap), 1, gapCls(g.secondGap))]));
        tb.appendChild(el('tr', {}, [td('Check', 'J-2: oxidizer turbine inlet temperature (F), from the fuel turbine\'s exit'), td('Gas', 'idea 31'), td('Model', fmt(EN.KtoF(g.seriesInletT), 0), 1), td('Published', fmt(EN.KtoF(g.seriesInletTPublished), 0), 1), td('Gap', fmt(g.seriesInletT - g.seriesInletTPublished, 1) + ' K', 1)]));
      }
    });
    ['table', 'computed'].forEach(function (mth) { R.sc[mth].forEach(function (o) {
      var lab = 'SSME ' + o.turbine + ' turbine: pressure ratio to drive its pump';
      if (o.refusal) { tb.appendChild(el('tr', {}, [td('Check', lab), td('Gas', mth === 'table' ? 'SP-8110' : 'idea 31'), why('Model', o.refusal), td('Published', String(o.prPublished), 1), td('Gap', '')])); return; }
      tb.appendChild(el('tr', {}, [td('Check', lab), td('Gas', mth === 'table' ? 'SP-8110' : 'idea 31'), td('Model', fmt(o.pr, 3), 1), td('Published', String(o.prPublished), 1), td('Gap', pct(o.gap) + ' in (PR − 1)', 1, gapCls(o.gap))]));
    }); });
    var x = R.exp;
    if (!x.refusal) {
      tb.appendChild(el('tr', {}, [td('Check', 'RL10A-3-3A: turbine enthalpy drop, ideal hydrogen at the table\'s inlet (Btu/lb)'), td('Gas', 'idea 31 H2'), td('Model', fmt(x.dh, 2), 1), td('Published', String(x.dhPublished), 1), td('Gap', pct(x.dhGap), 1, gapCls(x.dhGap))]));
      tb.appendChild(el('tr', {}, [td('Check', 'RL10A-3-3A: pressure ratio for the published pump power'), td('Gas', 'idea 31 H2'), td('Model', fmt(x.pr, 4), 1), td('Published', String(x.prPublished), 1), td('Gap', pct(x.prGap) + ' in (PR − 1)', 1)]));
    }
    if (R.expCycle && !R.expCycle.refusal) {
      tb.appendChild(el('tr', {}, [td('Check', 'RL10A-3-3A: the expander balance at its own point, pressure ratio'), td('Gas', 'idea 31 H2'), td('Model', fmt(R.expCycle.pr, 4), 1), td('Published', String(TD.RL10A33A.turbine.pr_ts), 1), td('Gap', pct(R.expCycle.pr / TD.RL10A33A.turbine.pr_ts - 1, 2), 1)]));
      tb.appendChild(el('tr', {}, [td('Check', 'RL10A-3-3A: fuel pump discharge (psia)'), td('Gas', 'idea 31 H2'), td('Model', fmt(R.expCycle.pumps.fuel.pout / PSI, 1), 1), td('Published', String(TD.RL10A33A.fuel[3][2]), 1), td('Gap', pct(R.expCycle.pumps.fuel.pout / PSI / TD.RL10A33A.fuel[3][2] - 1, 2), 1)]));
    }
    t.appendChild(tb);
    t = $('tblTurbines'); t.innerHTML = '';
    t.appendChild(th(['Engine', 'gas', 'inlet (F)', 'PR', 'flow (lb/s)', 'eff.', 'published (hp)', 'SP-8110 gas', 'gap', 'idea 31 gas', 'gap']));
    tb = el('tbody');
    R.turbines.forEach(function (x) {
      var r = x.row, c = x.c, mt = c.methods || {}, a = mt.table, b = mt.computed;
      var cell = function (k, m) { if (!m) return td(k, '-'); if (m.refusal) return why(k, m.refusal); return td(k, fmt(m.power, 0), 1); };
      var gcell = function (m) { return td('Gap', m && !m.refusal ? pct(m.gap) : '', 1, m && !m.refusal ? gapCls(m.gap) : ''); };
      if (c.refusal) { tb.appendChild(el('tr', {}, [td('Engine', r.engine + (r.turbine ? ' ' + r.turbine : '')), td('Gas', r.fluid), td('Inlet', String(r.Tin), 1), td('PR', String(r.pr), 1), td('Flow', String(r.w), 1), td('Eff', '-', 1), td('Published', String(r.hp), 1), why('SP-8110 gas', c.refusal), td('Gap', ''), td('idea 31 gas', ''), td('Gap', '')])); return; }
      tb.appendChild(el('tr', {}, [td('Engine', r.engine + (r.turbine ? ' ' + r.turbine : '')), td('Gas', r.fluid), td('Inlet', String(r.Tin), 1), td('PR', String(r.pr), 1), td('Flow', String(r.w), 1), td('Eff', r.eff + ' %', 1), td('Published', fmt(r.hp, 0), 1), cell('SP-8110 gas', a), gcell(a), cell('idea 31 gas', b), gcell(b)]));
    });
    t.appendChild(tb);
    t = $('tblPumps'); t.innerHTML = '';
    t.appendChild(th(['Engine', 'fluid', 'flow (lb/s)', 'rise (psi)', 'head printed (ft)', 'from dp / rho', 'gap', 'eff.', 'published (hp)', 'model', 'gap']));
    tb = el('tbody');
    R.pumps.forEach(function (x) {
      var r = x.row, c = x.c;
      tb.appendChild(el('tr', {}, [td('Engine', r.engine), td('Fluid', r.fluid), td('Flow', String(r.w), 1), td('Rise', fmt(r.pd - r.pin, 1), 1), td('Head printed', fmt(r.head, 0), 1), td('From dp / rho', fmt(c.headFromPressure, 0), 1), td('Gap', pct(c.headGap), 1, gapCls(c.headGap)),
        td('Eff', r.eff != null ? r.eff + ' %' : '-', 1), td('Published', r.hp != null ? fmt(r.hp, 0) : '-', 1), c.refusal ? why('Model', c.refusal) : td('Model', fmt(c.power, 0), 1), td('Gap', c.powerGap != null ? pct(c.powerGap) : '', 1, c.powerGap != null ? gapCls(c.powerGap) : '')]));
    });
    t.appendChild(tb);
    var tl = $('trustList'); tl.innerHTML = '';
    [
      '<b>The chamber and nozzle</b> are ideas 31 and 32, which reproduce NASA CEA to parts per million and sit 2.1 to 9.0 % above real engines\' Isp; the calibration carries that gap for the presets. [Certain]',
      '<b>Altitude</b>: F(sl) = F(alt) − p<sub>sl</sub>A<sub>e</sub> reproduces SP-8120\'s sea-level thrust for the three engines that print both, ' + range(R.amb.map(function (o) { return o.gap; })) + '. [Certain]',
      '<b>Throttle</b>: one engine prints a throttled range (the YLR113-AJ-1 sled engine); calibrated at full thrust the deck predicts its 39 % point to ' + pct(R.thr.Fgap, 2) + ' in thrust and ' + pct(R.thr.ispGap, 2) + ' in Isp, taking the ranges\' ends to correspond. One engine is thin evidence. [Likely]',
      '<b>Pumps</b>: power = flow x head / efficiency reproduces SP-8107\'s pump powers ' + range(pumpG) + '; the page\'s incompressible head &Delta;p/&rho; overstates SP-8107\'s printed head for liquid hydrogen at high pressure (SSME +15.2 %, J-2 +4.0 %). [Certain]',
      '<b>Turbines</b> are the weak link: on SP-8110\'s tabulated gas the model gives ' + range(tTab) + ' of SP-8107\'s turbine powers, on idea 31\'s gas ' + range(tCmp) + '. So a gas generator\'s flow comes out ' + range(ggG) + ', and a staged-combustion cycle near its limit amplifies the shortfall (the SSME reference closes only at a pressure ratio far above the published 1.56). [Certain as numbers; Likely as to causes: generic gas properties, the 1973 tables\' own consistency, real-gas effects at 400 bar]',
    ].forEach(function (h) { tl.appendChild(el('li', { html: h })); });
  }

  // ------------------------------------------------------------------ handoff
  function buildHandoff() {
    var lo = state.tmin / 100, hi = state.tmax / 100, ts = [lo, lo + (1 - lo) / 3, lo + 2 * (1 - lo) / 3, 1, hi].filter(function (v, i, a) { return a.indexOf(v) === i && v > 0; }).sort(function (a, b) { return a - b; });
    var D = E.deck(cur.ctx, ts);
    var pNom = E.point(cur.ctx, cur.spec.pc, 0);
    var cyc = cycleAt(pNom);
    cur.handoff = E.makeHandoff(cur.h32, cur.spec, D, cyc, { throttle: { min: lo, max: hi, nominal: 1 }, reference: state.ref === 'none' ? null : state.ref, richSide: state.ref === 'SSME (EPL)' ? state.rich : null });
    var txt = JSON.stringify(cur.handoff, null, 1);
    $('exportText').value = txt;
    $('nextLink').href = '../34-stack/index.html#h=' + M.b64urlEncode(JSON.stringify(cur.handoff));
    var t = $('allTable'); t.innerHTML = '';
    t.appendChild(th(['Output', 'value', 'units', 'confidence', 'source']));
    var tb = el('tbody'), O = cur.handoff.outputs;
    Object.keys(O).forEach(function (k) {
      var o = O[k], v = typeof o.value === 'number' ? sig(o.value, 6) : (typeof o.value === 'string' ? o.value : k === 'deck' ? o.value.throttle.length + ' throttles x ' + o.value.altitude_m.length + ' altitudes' : JSON.stringify(o.value).slice(0, 60));
      tb.appendChild(el('tr', {}, [td('Output', k), td('Value', v, 1), td('Units', o.units), td('Confidence', o.confidence), td('Source', o.source)]));
    });
    cur.handoff.refusals.forEach(function (r) { tb.appendChild(el('tr', {}, [td('Output', r.applies_to || '(chamber)'), td('Value', 'refused'), td('Units', ''), td('Confidence', r.code), td('Source', r.reason)])); });
    t.appendChild(tb);
  }
  function doImport(text, how) {
    var S = $('importStatus');
    var p = E.parseHandoff(text);
    if (p.refusal) { S.className = 'status bad'; S.textContent = 'Refused (' + p.refusal.code + '): ' + p.refusal.reason + ' What would help: ' + p.refusal.what_would_help; return false; }
    var eng = p.engine;
    if (eng && eng.id && eng.id !== 'imported' && E.ENGINES.some(function (x) { return x.id === eng.id; })) {
      loadEngine(eng.id);
      if (eng.efficiencies) { state.etaC = eng.efficiencies.cstar; state.etaF = eng.efficiencies.thrust_coefficient; }
      state.ref = eng.cycle_reference || 'none'; if (eng.rich_side) state.rich = eng.rich_side;
      if (eng.throttle) { state.tmin = Math.round(eng.throttle.min * 100); state.tmax = Math.round(eng.throttle.max * 100); }
    } else loadImported(p, eng);
    compute();
    S.className = 'status ok';
    S.textContent = 'Imported ' + how + ': a ' + p.handoff.from + ' handoff' + (p.handoff.from === '32-bell' ? ' (chamber and nozzle recomputed with ideas 31 and 32\'s kernels; they match)' : '') + '.';
    return true;
  }

  // ------------------------------------------------------------------ wiring
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : NaN; }
  $('engine').addEventListener('change', function () { if (this.value === 'imported' && cur.parsed) { loadImported(cur.parsed); } else loadEngine(this.value); compute(); });
  $('etaC').addEventListener('change', function () { state.etaC = num('etaC'); compute(); });
  $('etaF').addEventListener('change', function () { state.etaF = num('etaF'); compute(); });
  $('etaCal').addEventListener('click', function () { if (cur.cal) { state.etaC = cur.cal.etaCstar; state.etaF = cur.cal.etaCF; compute(); } });
  $('etaIdeal').addEventListener('click', function () { state.etaC = 1; state.etaF = 1; compute(); });
  document.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { state.mode = b.dataset.mode; compute(); }); });
  $('cycleRef').addEventListener('change', function () { state.ref = this.value; state.tin = null; compute(); });
  document.querySelectorAll('[data-rich]').forEach(function (b) { b.addEventListener('click', function () { state.rich = b.dataset.rich; compute(); }); });
  $('tinNum').addEventListener('change', function () { var v = num('tinNum'); state.tin = v > 0 ? v : null; compute(); });
  $('tmin').addEventListener('change', function () { var v = num('tmin'); if (v >= 10 && v <= 100) state.tmin = v; buildHandoff(); drawThr(); this.value = state.tmin; });
  $('tmax').addEventListener('change', function () { var v = num('tmax'); if (v >= 100 && v <= 120) state.tmax = v; buildHandoff(); drawThr(); this.value = state.tmax; });
  var setThr = function (v) { if (!(v >= 10 && v <= 120)) return; state.thr = Math.round(v); renderOp(); };
  var setAlt = function (v) { if (!(v >= 0 && v <= 86)) return; state.vac = false; state.alt = Math.round(v * 10) / 10; renderOp(); };
  $('thrRange').addEventListener('input', function () { setThr(+this.value); });
  $('thrNum').addEventListener('change', function () { var v = num('thrNum'); if (v >= 10 && v <= 120) setThr(v); else this.value = state.thr; });
  $('altRange').addEventListener('input', function () { setAlt(+this.value); });
  $('altNum').addEventListener('change', function () { if (this.value.trim() === '') { state.vac = true; renderOp(); return; } var v = num('altNum'); if (v >= 0 && v <= 86) setAlt(v); else this.value = state.vac ? '' : state.alt; });
  $('vacBtn').addEventListener('click', function () { state.vac = !state.vac; renderOp(); });
  $('slBtn').addEventListener('click', function () { setAlt(0); });
  document.querySelectorAll('[data-metric]').forEach(function (b) { b.addEventListener('click', function () { state.metric = b.dataset.metric; document.querySelectorAll('[data-metric]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawAlt(); drawThr(); }); });
  chartPick($('chartAlt'), function (z) { setAlt(Math.max(0, Math.min(86, Math.round(z * 2) / 2))); });
  chartPick($('chartThr'), function (t) { setThr(Math.max(10, Math.min(120, Math.round(t)))); });
  var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { drawAlt(); drawThr(); drawCyc(); }, 120); });
  $('chartAlt').addEventListener('keydown', function (ev) { if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { setAlt(Math.min(86, (state.vac ? 86 : state.alt) + 1)); ev.preventDefault(); } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { setAlt(Math.max(0, (state.vac ? 86 : state.alt) - 1)); ev.preventDefault(); } });
  $('chartThr').addEventListener('keydown', function (ev) { if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { setThr(Math.min(120, state.thr + 1)); ev.preventDefault(); } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { setThr(Math.max(10, state.thr - 1)); ev.preventDefault(); } });
  $('copyBtn').addEventListener('click', function () {
    var S = $('exportStatus'), txt = $('exportText').value;
    var ok = function () { S.className = 'status ok'; S.textContent = 'Copied ' + txt.length + ' characters.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { $('exportText').select(); S.className = 'status'; S.textContent = 'Clipboard unavailable here: the text is selected, copy it by hand.'; });
    else { $('exportText').select(); S.className = 'status'; S.textContent = 'Clipboard unavailable here: the text is selected, copy it by hand.'; }
  });
  $('dlBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(cur.handoff, null, 1) + '\n'], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'handoff.json' });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    $('exportStatus').className = 'status ok'; $('exportStatus').textContent = 'Downloaded handoff.json.';
  });
  $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'from the text box'); });

  // ------------------------------------------------------------------ start
  REC = computeRecord();
  loadEngine('F-1');
  var hash = location.hash || '';
  if (/[#&]h=/.test(hash)) { if (!doImport(hash, 'from the link')) compute(); }
  else compute();
  renderRecord();
  window.__engineDeck = { E: E, B: B, M: M, state: state, cur: cur };
})();
