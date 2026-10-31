/* Stack page: wires the controls to the kernel (stack.js on idea 33's engine.js) and draws. No network. */
(function () {
  'use strict';
  var M = window.Mixture, PF = window.PartForgeISA;
  var db = M.parseThermo(window.THERMO_EXCERPT);
  var B = window.Bell.create({ Mixture: M, db: db, charts: window.NOZZLE_CHARTS, rules: window.NOZZLE_RULES, isa: PF.isa, g0: PF.ISA_G0 });
  var E = window.EngineDeck.create({ Mixture: M, db: db, B: B, turbo: window.TurboData, table: window.SP8120_TABLE1.ROWS, presets: window.MixturePresets.PRESETS, densities: window.PROPELLANT_DENSITIES, isa: PF.isa, g0: PF.ISA_G0 });
  var S = window.Stack.create({ E: E, isa: PF.isa, g0: PF.ISA_G0 });
  var D = window.AS512_FLIGHT, G0 = PF.ISA_G0;
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
  function t1(kg) { return fmt(kg / 1000, kg >= 1e6 ? 0 : 1); }

  // ------------------------------------------------------------------ engines and vehicles
  var engines = {};
  function eng(id) {
    if (!engines[id] && S.PRESET_ENGINES.indexOf(id) >= 0) engines[id] = S.engineFromPreset(id);
    return engines[id];
  }
  var FRAC = S.inertFractions(D);
  var AS = { veh: S.fromAS512(D) };
  AS.engines = { 'F-1': eng('F-1'), 'J-2': eng('J-2') };
  AS.result = S.evaluate(AS.veh, AS.engines);
  AS.check = S.flightCheck(D, AS.engines);
  // AS-512's own ideal delta-v to its parking orbit (S-IC, S-II, S-IVB first burn) and to translunar injection
  AS.dvOrbit = AS.result.stages[0].dv + AS.result.stages[1].dv + AS.result.stages[2].burns[0].dv;
  AS.dvTli = AS.result.dv;
  var imported = null, importedVeh = null;

  function vehicleOptions() {
    var o = [{ id: 'as512', label: 'Saturn V AS-512 (Apollo 17), as flown' }, { id: 'fj', label: 'Two stages: F-1s and a J-2 (assumed masses)' }];
    if (imported) o.push({ id: 'imp', label: 'Your idea 33 engine on two stages (assumed masses)' });
    if (importedVeh) o.push({ id: 'impveh', label: 'Imported vehicle: ' + (importedVeh.label || 'from a handoff') });
    return o;
  }
  function makeVehicle(id) {
    if (id === 'as512') return S.fromAS512(D);
    if (id === 'imp' && imported) return S.customVehicle([{ label: 'Stage 1', engine: imported.id, count: 7, propellant: 400000, fraction: FRAC[0] }, { label: 'Stage 2', engine: 'J-2', count: 1, propellant: 100000, fraction: FRAC[2] }], 10000, 'Your idea 33 engine on two stages (assumed masses)');
    if (id === 'impveh' && importedVeh) return JSON.parse(JSON.stringify(importedVeh));
    return S.customVehicle([{ label: 'Stage 1', engine: 'F-1', count: 5, propellant: 2000000, fraction: FRAC[0] }, { label: 'Stage 2', engine: 'J-2', count: 1, propellant: 120000, fraction: FRAC[2] }], 20000, 'Two stages: F-1s and a J-2 (assumed masses)');
  }
  var state = { vehId: 'as512', events: 'flown', fly: 'v', target: 'orbit', targetTyped: 9000, veh: null, cursor: null };
  var cur = { use: null, engs: null, r: null, sweep: null, solve: null, handoff: null };

  function engineChoices() {
    var o = S.PRESET_ENGINES.map(function (id) { var e = eng(id); return { id: id, label: e.label }; });
    if (imported) o.push({ id: imported.id, label: imported.label });
    return o;
  }

  // ------------------------------------------------------------------ the stage editor
  function setPropellant(s, P) {
    var others = s.burns.slice(0, -1).reduce(function (a, b) { return a + b.propellant; }, 0);
    s.burns[s.burns.length - 1].propellant = P - others;
  }
  function eventsList(s) {
    var items = [];
    s.burns.forEach(function (b, i) {
      var pre = s.burns.length > 1 ? 'Burn ' + (i + 1) + ': ' : '';
      if (s.burns.length > 1) items.push(pre + t1(b.propellant) + ' t burned');
      if (b.shed) items.push(pre + fmt(b.shed, 0) + ' kg lost without thrust at the start (build-up, frost, purges)');
      (b.jettisons || []).forEach(function (j) { items.push(pre + (j.label || 'jettison') + ', ' + fmt(j.mass, 0) + ' kg at ' + fmt(j.t, 1) + ' s'); });
      (b.engineOut || []).forEach(function (o) { items.push(pre + (o.label || 'engine cutoff') + ' (' + o.count + ') at ' + fmt(o.t, 1) + ' s'); });
      if (b.coast) items.push(pre + fmt(b.coast, 0) + ' kg lost before the next burn (venting)');
    });
    return items;
  }
  function renderStages() {
    var box = $('stages'); box.innerHTML = '';
    var v = state.veh, n = v.stages.length;
    // top stage first, as a stack reads
    for (var i = n - 1; i >= 0; i--) box.appendChild(stageCard(v.stages[i], i, n));
    $('addStage').disabled = n >= 5;
  }
  function numInput(id, val, step, label, min) {
    return el('input', { id: id, type: 'number', min: min == null ? '0' : min, step: step, value: val, inputmode: 'decimal', 'aria-label': label });
  }
  function stageCard(s, i, n) {
    var c = el('div', { class: 'stagecard' + (i === n - 1 ? ' top' : ''), id: 'stage' + i });
    var rm = n > 1 ? el('button', { type: 'button', class: 'rm', text: 'Remove', 'aria-label': 'Remove stage ' + (i + 1) }) : null;
    if (rm) rm.addEventListener('click', function () { state.veh.stages.splice(i, 1); state.veh.id = 'custom'; renderStages(); compute(); });
    c.appendChild(el('h3', {}, [el('span', { text: 'Stage ' + (i + 1) + ': ' + (s.label || '') }), rm]));
    var sel = el('select', { id: 'eng' + i, 'aria-label': 'Engine for stage ' + (i + 1) });
    engineChoices().forEach(function (o) { sel.appendChild(el('option', { value: o.id, text: o.label })); });
    sel.value = s.engine;
    sel.addEventListener('change', function () { s.engine = this.value; state.veh.id = 'custom'; compute(); });
    var cnt = numInput('cnt' + i, s.count, '1', 'Number of engines on stage ' + (i + 1), '1');
    var setCount = function (k) { if (Number.isInteger(k) && k >= 1 && k <= 30) { s.count = k; cnt.value = k; state.veh.id = 'custom'; compute(); } else cnt.value = s.count; };
    cnt.addEventListener('change', function () { setCount(+this.value); });
    var minus = el('button', { type: 'button', text: '−', 'aria-label': 'One engine fewer on stage ' + (i + 1) }), plus = el('button', { type: 'button', text: '+', 'aria-label': 'One engine more on stage ' + (i + 1) });
    minus.addEventListener('click', function () { setCount(s.count - 1); });
    plus.addEventListener('click', function () { setCount(s.count + 1); });
    c.appendChild(el('div', { class: 'row2' }, [el('div', {}, [el('label', { for: 'eng' + i, text: 'Engine' }), sel]), el('div', {}, [el('span', { class: 'lab', text: 'Engines' }), el('span', { class: 'stepper' }, [minus, cnt, plus])])]));
    // propellant
    var P = S.stagePropellant(s), pmax = Math.max(10, Math.ceil(P / 1000 * 2.5));
    var pn = numInput('prop' + i, (P / 1000).toFixed(1), '0.1', 'Propellant on stage ' + (i + 1) + ', tonnes');
    var pr = el('input', { id: 'propR' + i, type: 'range', min: '1', max: String(pmax), step: '0.5', value: String(P / 1000), 'aria-label': 'Propellant slider for stage ' + (i + 1) + ', tonnes' });
    var setP = function (t, from) { if (!(t > 0)) return; setPropellant(s, t * 1000); state.veh.id = 'custom'; if (from !== 'n') pn.value = (+t).toFixed(1); if (from !== 'r') pr.value = t; compute(); };
    pn.addEventListener('change', function () { setP(+this.value, 'n'); });
    pr.addEventListener('input', function () { setP(+this.value, 'r'); });
    c.appendChild(el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('label', { for: 'prop' + i, html: 'Propellant burned <small>(t' + (s.burns.length > 1 ? '; the last burn takes what the first leaves' : '') + ')</small>' }), pn]), pr]));
    // dry and remaining
    var dn = numInput('dry' + i, (s.dry / 1000).toFixed(2), '0.01', 'Dry mass of stage ' + (i + 1) + ', tonnes');
    dn.addEventListener('change', function () { var t = +this.value; s.dry = t * 1000; state.veh.id = 'custom'; compute(); });
    var rn = numInput('rem' + i, (s.remaining / 1000).toFixed(2), '0.01', 'Unburned mass left in stage ' + (i + 1) + ', tonnes');
    rn.addEventListener('change', function () { var t = +this.value; s.remaining = t * 1000; state.veh.id = 'custom'; compute(); });
    c.appendChild(el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('label', { for: 'dry' + i, html: 'Dry mass <small>(t, engines included)</small>' }), dn])]));
    c.appendChild(el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('label', { for: 'rem' + i, html: 'Left unburned <small>(t, residuals, gases)</small>' }), rn])]));
    var fs = el('select', { id: 'frac' + i, 'aria-label': 'Real stage to scale the dry mass from' });
    FRAC.forEach(function (f, k) { fs.appendChild(el('option', { value: String(k), text: f.label + ' (' + fmt(100 * f.value, 2) + ' % inert)' })); });
    var fb = el('button', { type: 'button', text: 'Scale dry mass', 'aria-label': 'Scale stage ' + (i + 1) + ' dry mass from the chosen stage' });
    fb.addEventListener('click', function () {
      var f = FRAC[+fs.value], Pt = S.stagePropellant(s);
      s.dry = S.dryForFraction(Pt, f.value); s.remaining = 0; s.note = 'Dry mass scaled from ' + f.label + '\'s inert fraction (' + fmt(100 * f.value, 2) + ' %), assumed.';
      dn.value = (s.dry / 1000).toFixed(2); rn.value = '0.00'; state.veh.id = 'custom'; compute(); info.textContent = s.note;
    });
    c.appendChild(el('div', { class: 'fx' }, [fs, fb]));
    var info = el('p', { class: 'note', id: 'stageNote' + i, text: s.note || '' });
    c.appendChild(info);
    var ev = eventsList(s);
    if (ev.length) c.appendChild(el('details', { class: 'evd' }, [el('summary', { text: 'Scheduled in flight (' + ev.length + ')' }), el('ul', { class: 'events', 'aria-label': 'Scheduled events on stage ' + (i + 1) }, ev.map(function (t) { return el('li', { text: t }); }))]));
    return c;
  }

  // ------------------------------------------------------------------ compute
  function vehicleInUse() { return state.events === 'simple' ? S.simplify(state.veh) : state.veh; }
  function enginesFor(v) { var o = {}; v.stages.forEach(function (s) { var e = eng(s.engine) || engines[s.engine]; if (e) o[s.engine] = e; }); return o; }
  function targetDv() {
    if (state.target === 'orbit') return AS.dvOrbit;
    if (state.target === 'tli') return AS.dvTli;
    if (state.target === 'typed') return state.targetTyped;
    return null;
  }
  function compute() {
    cur.use = vehicleInUse(); cur.engs = enginesFor(cur.use);
    cur.r = S.evaluate(cur.use, cur.engs);
    var pl = cur.use.payload.mass, tg = targetDv();
    cur.solve = cur.r.ok && tg ? S.solvePayload(cur.use, cur.engs, tg) : null;
    var xmax = Math.max(20000, 2 * pl, cur.solve && cur.solve.payload ? cur.solve.payload * 1.4 : 0);
    cur.sweep = cur.r.ok ? S.sweepPayload(cur.use, cur.engs, xmax, 41) : null;
    cur.xmax = xmax;
    renderSource(); renderResults(); drawFly(); drawPay(); buildHandoff();
  }

  // ------------------------------------------------------------------ results
  function renderSource() {
    var v = state.veh;
    $('vehSource').textContent = v.id === 'AS-512' ? 'Every mass from NASA\'s AS-512 flight evaluation report (MPR-SAT-FE-73-1, Tables 16-1 to 16-9): the stack as it stood at holddown release on 7 December 1972. Engines: idea 33\'s F-1 and J-2.' :
      v.id === 'imported' ? 'Imported from a 34-stack handoff; engines re-computed with idea 33\'s kernel.' :
      'Edited or built here: these masses are assumptions (typed, or scaled from an AS-512 stage\'s inert fraction); engines are idea 33\'s. Choose the vehicle again to restore it.';
    $('eventsNote').textContent = state.events === 'simple' ? 'One burn per stage with every engine to depletion; jettisoned items ride to separation; losses between burns taken at the start. Same total mass.' :
      (state.veh.stages.some(function (s) { return s.burns.some(function (b) { return (b.jettisons || []).length || (b.engineOut || []).length || b.shed || b.coast; }); }) ? 'Engine cutoffs, jettisons and losses as listed under each stage.' : 'This stack schedules none.');
    document.querySelectorAll('[data-events]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.events === state.events)); });
  }
  function tile(k, v, u, conf, sub, cls) {
    return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [el('div', { class: 'k', text: k }), el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: u }) : null]), sub ? el('div', { class: 'sub', html: sub }) : null, conf ? el('span', { class: 'c', text: conf }) : null]);
  }
  function refusalBox(r) { return el('div', { class: 'refusal' }, [el('b', { text: (r.applies_to ? r.applies_to + ': ' : '') + 'refused (' + r.code + ')' }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]); }
  function renderResults() {
    var r = cur.r, rf = $('refusals'), tl = $('tiles'), tb = $('stageTable');
    rf.innerHTML = ''; tl.innerHTML = ''; tb.innerHTML = ''; $('warnings').textContent = '';
    (r.refusals || []).forEach(function (x) { rf.appendChild(refusalBox(x)); });
    if (!r.ok) { tl.appendChild(tile('Stack', 'refused', '', null, 'Fix the inputs named above.', 'refused')); return; }
    var conf = state.veh.id === 'AS-512' ? 'measured' : 'assumed';
    tl.appendChild(tile('Liftoff mass', t1(r.liftoff.mass), 't', conf));
    tl.appendChild(r.liftoff.tw != null ? tile('Thrust / weight at liftoff', fmt(r.liftoff.tw, 3), '', 'derived', fmt(r.liftoff.thrust / 1e6, 2) + ' MN at sea level') : tile('Thrust / weight at liftoff', 'refused', '', 'derived', 'no sea-level thrust', 'refused'));
    tl.appendChild(tile('Ideal delta-v, all burns', fmt(r.dv / 1000, 3), 'km/s', 'derived', 'first stage at sea-level Isp ' + fmt(r.dvSL / 1000, 3) + '; gas-generator exhaust expanded ' + fmt(r.dvUpper / 1000, 3), 'hero'));
    tl.appendChild(tile('Burning time', fmt(r.burnTime, 0), 's', 'derived'));
    tl.appendChild(tile('Payload fraction', fmt(100 * r.payloadFraction, 2), '%', 'derived', t1(r.payload) + ' t of ' + t1(r.liftoff.mass) + ' t'));
    var head = ['Stage', 'Engines', 'Ideal delta-v', 'Burn time', 'T/W at ignition', 'At cutoff', 'Mass ratio', 'Oxidizer', 'Fuel', 'Inert'];
    var cap = el('caption', { class: 'small', text: 'Per stage, bottom first. Thrust-to-weight at ignition uses vacuum thrust (sea level for the first stage); "at cutoff" is the acceleration in g just before the last cutoff. Propellant split by the engine-level mixture ratio, volumes at idea 31\'s densities.' });
    tb.appendChild(cap);
    var th = el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))]);
    tb.appendChild(th);
    var body = el('tbody');
    r.stages.forEach(function (s, i) {
      var e = cur.engs[s.engine], b0 = s.burns[0], bl = s.burns[s.burns.length - 1];
      var twIgn = i === 0 && r.liftoff.tw != null ? r.liftoff.tw : b0.twIgnitionVac;
      var dvTxt = fmt(s.dv, 0) + ' m/s' + (s.burns.length > 1 ? ' (' + s.burns.map(function (b) { return fmt(b.dv, 0); }).join(' + ') + ')' : '') + (i === 0 && e.ispSL != null ? '; ' + fmt(s.dvSL, 0) + ' at sea-level Isp' : '');
      body.appendChild(el('tr', {}, [
        el('td', { 'data-k': 'Stage', text: (i + 1) + ' ' + (s.label || '') }),
        el('td', { 'data-k': 'Engines', text: s.count + ' × ' + s.engine.replace(/^imported:/, 'imported ') }),
        el('td', { 'data-k': 'Ideal delta-v', class: 'n', text: dvTxt }),
        el('td', { 'data-k': 'Burn time', class: 'n', text: fmt(s.burnTime, 1) + ' s' }),
        el('td', { 'data-k': 'T/W at ignition', class: 'n', text: fmt(twIgn, 2) }),
        el('td', { 'data-k': 'At cutoff', class: 'n', text: fmt(bl.accelCutoffVac / G0, 2) + ' g' }),
        el('td', { 'data-k': 'Mass ratio', class: 'n', text: fmt(s.massRatio, 3) }),
        el('td', { 'data-k': 'Oxidizer', class: 'n', text: t1(s.oxidizer) + ' t, ' + (s.volumeOx != null ? fmt(s.volumeOx, 0) + ' m³' : 'no density') }),
        el('td', { 'data-k': 'Fuel', class: 'n', text: t1(s.fuel) + ' t, ' + (s.volumeFuel != null ? fmt(s.volumeFuel, 0) + ' m³' : 'no density') }),
        el('td', { 'data-k': 'Inert', class: 'n', text: fmt(100 * s.inertFraction, 1) + ' %' }),
      ]));
    });
    tb.appendChild(body);
    var w = (r.warnings || []).map(function (x) { return x.applies_to + ': ' + x.reason; });
    $('warnings').textContent = w.join(' ');
  }

  // ------------------------------------------------------------------ chart helpers
  function axes(svg, X, Y, xl, yl, xt, yt) {
    var g = sv('g');
    xt.forEach(function (v) { var x = X.s(v); g.appendChild(sv('line', { class: 'grid', x1: x, x2: x, y1: Y.r[1], y2: Y.r[0] })); g.appendChild(sv('text', { x: x, y: Y.r[0] + 16, 'text-anchor': 'middle' }, X.f(v))); });
    yt.forEach(function (v) { var y = Y.s(v); g.appendChild(sv('line', { class: 'grid', x1: X.r[0], x2: X.r[1], y1: y, y2: y })); g.appendChild(sv('text', { x: X.r[0] - 6, y: y + 4, 'text-anchor': 'end' }, Y.f(v))); });
    g.appendChild(sv('line', { class: 'axis', x1: X.r[0], x2: X.r[1], y1: Y.r[0], y2: Y.r[0] }));
    g.appendChild(sv('text', { class: 'lbl', x: (X.r[0] + X.r[1]) / 2, y: Y.r[0] + 34, 'text-anchor': 'middle' }, xl));
    g.appendChild(sv('text', { class: 'lbl', x: 13, y: (Y.r[0] + Y.r[1]) / 2, transform: 'rotate(-90 13 ' + (Y.r[0] + Y.r[1]) / 2 + ')', 'text-anchor': 'middle' }, yl));
    svg.appendChild(g);
  }
  function geom(svg, Hdesk, Hphone) {
    var w = Math.round(svg.getBoundingClientRect().width), W = w > 200 ? w : 800, H = W < 600 ? Hphone : Hdesk;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    return { W: W, H: H, l: W < 600 ? 50 : 62, r: 14, t: 14, b: 40 };
  }
  function scale(d0, d1, r0, r1, f) { var s = function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); }; return { s: s, inv: function (p) { return d0 + (p - r0) / (r1 - r0) * (d1 - d0); }, r: [r0, r1], d: [d0, d1], f: f }; }
  function ticks(lo, hi, n) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = []; for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  function svgPoint(svg, evt) { var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; return { x: (evt.clientX - r.left) / r.width * vb.width, y: (evt.clientY - r.top) / r.height * vb.height }; }
  function showTip(tip, svg, x, y, html) {
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, wrap = svg.parentNode.getBoundingClientRect();
    tip.innerHTML = html; tip.style.display = 'block';
    var px = x / vb.width * r.width, py = y / vb.height * r.height;
    var w = tip.offsetWidth; var left = Math.min(Math.max(0, px + 12), wrap.width - w - 2);
    tip.style.left = left + 'px'; tip.style.top = Math.max(0, py - 40) + 'px';
  }

  // ------------------------------------------------------------------ the burns chart
  var FLY = { v: { label: 'Ideal velocity gained (km/s)', f: function (p) { return p.v / 1000; } }, a: { label: 'Acceleration, vacuum thrust (g)', f: function (p) { return p.a / G0; } }, m: { label: 'Vehicle mass (t)', f: function (p) { return p.m / 1000; } } };
  function flightPoints() {
    // AS-512's measured points on the same clock (cumulative mainstage burning time), shown when the AS-512 stack is unedited
    if (state.veh.id !== 'AS-512' || state.events !== 'flown') return [];
    var ST = D.stageTables, A = D.acceleration, sq = function (lab) { return D.sequence.filter(function (x) { return x[0] === lab; })[0][1]; };
    var t1c = D.events.sicOeco - ST['S-IC'].events['holddown arm release'].t;
    var t2c = ST['S-II'].events['S-II engine cutoff'].t - ST['S-II'].events['S-II mainstage'].t;
    var t2ceco = D.events.siiCeco - ST['S-II'].events['S-II mainstage'].t;
    var t3c = ST['S-IVB burn 1'].events['S-IVB engine cutoff'].t - ST['S-IVB burn 1'].events['S-IVB mainstage'].t;
    var t4c = ST['S-IVB burn 2'].events['S-IVB engine cutoff'].t - ST['S-IVB burn 2'].events['S-IVB mainstage'].t;
    var pts = [
      { t: t1c, a: A.sic[1], m: sq('1ST FLT STG AT OECO'), what: 'S-IC outboard cutoff' },
      { t: t1c + t2ceco, a: A.sii[1], m: null, what: 'S-II centre cutoff' },
      { t: t1c + t2c, a: null, m: sq('2ND FLT STG AT COS'), what: 'S-II cutoff' },
      { t: t1c + t2c + t3c, a: A.sivb1[1], m: sq('3RD FLT STG 1ST COS'), what: 'S-IVB first cutoff' },
      { t: t1c + t2c + t3c + t4c, a: A.sivb2[1], m: sq('3RD FLT STG 2ND COS'), what: 'S-IVB second cutoff' },
    ];
    return pts;
  }
  function drawFly() {
    var svg = $('chartFly'); svg.innerHTML = '';
    document.querySelectorAll('[data-fly]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.fly === state.fly)); });
    var r = cur.r, leg = $('legendFly'); leg.innerHTML = '';
    if (!r.ok || !r.timeline.length) { var G0g = geom(svg, 320, 280); svg.appendChild(sv('text', { x: G0g.W / 2, y: G0g.H / 2, 'text-anchor': 'middle' }, 'Refused: see above.')); $('capFly').textContent = ''; svg._X = null; return; }
    var T = r.timeline, F = FLY[state.fly], fp = flightPoints();
    var tmax = Math.max(T[T.length - 1].t, fp.length ? fp[fp.length - 1].t : 0) * 1.02;
    var ys = T.map(F.f).concat(fp.map(function (p) { return state.fly === 'a' ? (p.a != null ? p.a / G0 : null) : state.fly === 'm' ? (p.m != null ? p.m / 1000 : null) : null; }).filter(function (x) { return x != null; }));
    var ymax = Math.max.apply(null, ys) * 1.08;
    var G = geom(svg, 320, 280), nx = G.W < 600 ? 4 : 8;
    var X = scale(0, tmax, G.l, G.W - G.r, function (v) { return fmt(v, 0); }), Y = scale(0, ymax, G.H - G.b, G.t, function (v) { return fmt(v, ymax < 10 ? 1 : 0); });
    axes(svg, X, Y, 'Burning time, s (coasts left out)', F.label, ticks(0, tmax, nx), ticks(0, ymax, 5));
    r.stages.forEach(function (s, i) {
      var b0 = s.burns[0], bl = s.burns[s.burns.length - 1];
      svg.appendChild(sv('rect', { class: 'stageband sb' + i, x: X.s(b0.startT), y: G.t, width: Math.max(0, X.s(bl.startT + bl.time) - X.s(b0.startT)), height: G.H - G.b - G.t }));
      svg.appendChild(sv('text', { x: X.s(b0.startT) + 4, y: G.t + 14 }, s.label || 'Stage ' + (i + 1)));
    });
    // one polyline per burn
    var byBurn = {};
    T.forEach(function (p) { var k = p.stage + ':' + p.burn; (byBurn[k] = byBurn[k] || []).push(p); });
    Object.keys(byBurn).forEach(function (k) {
      var pts = byBurn[k], si = +k.split(':')[0];
      var d = pts.map(function (p, j) { return (j ? 'L' : 'M') + X.s(p.t).toFixed(1) + ' ' + Y.s(F.f(p)).toFixed(1); }).join(' ');
      svg.appendChild(sv('path', { class: 'line s' + (si % 3 + 1), d: d }));
    });
    fp.forEach(function (p) {
      var y = state.fly === 'a' ? (p.a != null ? p.a / G0 : null) : state.fly === 'm' ? (p.m != null ? p.m / 1000 : null) : null;
      if (y != null) svg.appendChild(sv('circle', { class: 'flight', cx: X.s(p.t), cy: Y.s(y), r: 5 }, null));
    });
    var c = state.cursor == null ? T.length - 1 : Math.min(state.cursor, T.length - 1);
    var p = T[c];
    svg.appendChild(sv('line', { class: 'cursor', x1: X.s(p.t), x2: X.s(p.t), y1: G.t, y2: G.H - G.b }));
    svg.appendChild(sv('circle', { class: 'dot1', cx: X.s(p.t), cy: Y.s(F.f(p)), r: 5 }));
    svg._X = X; svg._Y = Y;
    leg.appendChild(el('li', { html: '<span class="key" style="border-color:var(--s1)"></span>this model, by stage' }));
    if (fp.length && state.fly !== 'v') leg.appendChild(el('li', { html: '<span class="key dot" style="background:var(--s2)"></span>AS-512 as flown (' + (state.fly === 'a' ? 'Table 4-1 maximum acceleration' : 'Table 16-9 mass') + ')' }));
    var st = r.stages[p.stage];
    $('capFly').textContent = 'At ' + fmt(p.t, 1) + ' s of burning (' + (st.label || 'stage ' + (p.stage + 1)) + (st.burns.length > 1 ? ', burn ' + (p.burn + 1) : '') + '): ideal velocity gained ' + fmt(p.v, 0) + ' m/s, acceleration ' + fmt(p.a / G0, 2) + ' g in vacuum, mass ' + t1(p.m) + ' t. ' +
      (state.fly === 'v' ? 'This is the rocket equation\'s velocity, before gravity and drag take their share (module 35).' : state.fly === 'a' ? 'The saw-tooth is the stack: acceleration climbs as propellant burns off, then drops at each cutoff and separation.' : '');
  }
  function flyPick(evt) {
    var svg = $('chartFly'); if (!svg._X || !cur.r.ok) return;
    var pt = svgPoint(svg, evt), t = svg._X.inv(pt.x), T = cur.r.timeline, best = 0;
    for (var i = 1; i < T.length; i++) if (Math.abs(T[i].t - t) < Math.abs(T[best].t - t)) best = i;
    state.cursor = best; drawFly();
    var p = T[best];
    showTip($('tipFly'), svg, svg._X.s(p.t), svg._Y.s(FLY[state.fly].f(p)), fmt(p.t, 1) + ' s<br>' + fmt(p.v, 0) + ' m/s ideal<br>' + fmt(p.a / G0, 2) + ' g, ' + t1(p.m) + ' t');
  }

  // ------------------------------------------------------------------ the payload chart
  function drawPay() {
    var svg = $('chartPay'); svg.innerHTML = '';
    var leg = $('legendPay'); leg.innerHTML = '';
    var sol = $('solve'), tg = targetDv();
    if (!cur.r.ok || !cur.sweep) { sol.className = 'verdict bad'; sol.textContent = 'The stack is refused; nothing to trade.'; svg._X = null; return; }
    var pts = cur.sweep.filter(function (p) { return p.dv != null; });
    var ymax = Math.max(pts[0].dv, tg || 0) * 1.08, ymin = Math.min(pts[pts.length - 1].dv, tg || Infinity) * 0.9;
    ymin = Math.max(0, ymin);
    var G = geom(svg, 300, 260), nx = G.W < 600 ? 4 : 8;
    var X = scale(0, cur.xmax / 1000, G.l, G.W - G.r, function (v) { return fmt(v, 0); }), Y = scale(ymin / 1000, ymax / 1000, G.H - G.b, G.t, function (v) { return fmt(v, 1); });
    axes(svg, X, Y, 'Payload, t', 'Total ideal delta-v (km/s)', ticks(0, cur.xmax / 1000, nx), ticks(ymin / 1000, ymax / 1000, 5));
    // where liftoff thrust-to-weight falls to 1 or below
    var bad = pts.filter(function (p) { return p.tw != null && p.tw <= 1; });
    if (bad.length) svg.appendChild(sv('rect', { class: 'refband', x: X.s(bad[0].payload / 1000), y: G.t, width: X.s(cur.xmax / 1000) - X.s(bad[0].payload / 1000), height: G.H - G.b - G.t }));
    svg.appendChild(sv('path', { class: 'line s1', d: pts.map(function (p, j) { return (j ? 'L' : 'M') + X.s(p.payload / 1000).toFixed(1) + ' ' + Y.s(p.dv / 1000).toFixed(1); }).join(' ') }));
    if (tg) svg.appendChild(sv('line', { class: 'target', x1: G.l, x2: G.W - G.r, y1: Y.s(tg / 1000), y2: Y.s(tg / 1000) }));
    if (cur.solve && cur.solve.payload != null && cur.solve.payload <= cur.xmax) svg.appendChild(sv('circle', { class: 'dot2', cx: X.s(cur.solve.payload / 1000), cy: Y.s(tg / 1000), r: 5 }));
    var pl = cur.use.payload.mass;
    svg.appendChild(sv('circle', { class: 'handle', cx: X.s(pl / 1000), cy: Y.s(cur.r.dv / 1000), r: 8 }));
    svg._X = X; svg._Y = Y;
    leg.appendChild(el('li', { html: '<span class="key" style="border-color:var(--s1)"></span>this stack (vacuum engine-level Isp)' }));
    if (tg) leg.appendChild(el('li', { html: '<span class="key dash" style="border-color:var(--s2)"></span>target' }));
    if (bad.length) leg.appendChild(el('li', { html: '<span class="swatch" style="background:var(--refused)"></span>does not lift off (thrust/weight ≤ 1)' }));
    if (!tg) { sol.className = 'verdict'; sol.textContent = 'Choose a target to see the most payload this stack can give it.'; }
    else if (cur.solve.refusal) { sol.className = 'verdict bad'; sol.textContent = 'Refused (' + cur.solve.refusal.code + '): ' + cur.solve.refusal.reason + ' What would help: ' + cur.solve.refusal.what_would_help; }
    else {
      var tw = S.evaluate(S.withPayload(cur.use, cur.solve.payload), cur.engs, { timeline: false }).liftoff.tw;
      sol.className = 'verdict ok';
      sol.textContent = 'At most ' + t1(cur.solve.payload) + ' t of payload for ' + fmt(tg, 0) + ' m/s of ideal delta-v (all propellant burned), with liftoff thrust/weight ' + fmt(tw, 2) + (tw <= 1 ? ': it would not leave the pad.' : '.') + ' [derived; ' + (state.target === 'typed' ? 'your target, assumed' : 'a screening reference: losses depend on the trajectory, module 35') + ']';
    }
    $('capPay').textContent = 'Drag the blue handle, tap the chart or use the arrow keys to change the payload (now ' + t1(pl) + ' t, ' + fmt(cur.r.dv, 0) + ' m/s). ' +
      (state.target === 'orbit' ? 'The target is the ideal delta-v this model gives Apollo 17\'s own stack from liftoff to its 170.5 km circular parking orbit (S-IC, S-II, S-IVB first burn, ' + fmt(AS.dvOrbit, 0) + ' m/s): what that orbit cost a Saturn V, losses included.' :
        state.target === 'tli' ? 'The target is the ideal delta-v this model gives Apollo 17\'s whole flight to translunar injection (' + fmt(AS.dvTli, 0) + ' m/s; C3 −1.77 km²/s², Table 4-2).' : '');
  }
  function setPayload(kg) { if (!(kg >= 0)) return; state.veh.payload.mass = kg; if (state.veh.id === 'AS-512') state.veh.id = 'custom'; $('plNum').value = (kg / 1000).toFixed(1); $('plRange').value = kg / 1000; compute(); }
  function payPick(evt) { var svg = $('chartPay'); if (!svg._X) return; var p = svgPoint(svg, evt); setPayload(Math.max(0, Math.round(svg._X.inv(p.x) * 10) / 10 * 1000)); }

  // ------------------------------------------------------------------ against Apollo 17
  function renderRecord() {
    var rows = AS.check.rows, sum = $('recordSummary'); sum.innerHTML = '';
    var g = {}; rows.forEach(function (x) { g[x.label] = x; });
    sum.appendChild(tile('F-1 at sea level (Table 5-2)', pct(g['F-1 sea-level thrust'].gap, 2), 'thrust', 'derived', 'flow ' + pct(g['F-1 mass flow'].gap, 2) + ', Isp ' + pct(g['F-1 sea-level Isp'].gap, 2)));
    sum.appendChild(tile('Liftoff mass, the ledger', fmt(g['Liftoff (holddown release)'].model - g['Liftoff (holddown release)'].flight, 0), 'kg', 'derived', 'of ' + t1(g['Liftoff (holddown release)'].flight) + ' t: rounding in the report\'s rows'));
    sum.appendChild(tile('S-IC burn time', pct(g['S-IC, holddown release to outboard cutoff'].gap, 1), '', 'derived', 'and ' + pct(g['S-IC at outboard cutoff (4 engines, 66.5 km)'].gap, 1) + ' in acceleration at cutoff: the F-1 ran harder in flight'));
    sum.appendChild(tile('S-IVB J-2 thrust', pct(g['J-2 vacuum thrust, S-IVB'].gap, 1), '', 'derived', 'the flight ran mixture ratio 5.0; idea 33\'s J-2 is the 5.5 point'));
    sum.appendChild(tile('Loss the ascent must pay, S-II', fmt(g['S-II burn: ideal delta-v vs space-fixed gain'].gap, 0), 'm/s', 'derived', 'ideal delta-v less the velocity the flight gained'));
    var t = $('tblRecord'); t.innerHTML = '';
    t.appendChild(el('caption', { class: 'small', text: 'Model: this page\'s kernel on the AS-512 ledger with idea 33\'s engines. Flight: the report\'s reconstruction (table cited per row in the README).' }));
    t.appendChild(el('thead', {}, [el('tr', {}, ['Check', 'Model', 'Flight', 'Gap', 'Why'].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody'), last = null;
    rows.forEach(function (x) {
      if (x.group !== last) { tb.appendChild(el('tr', { class: 'hl' }, [el('td', { colspan: '5', text: x.group })])); last = x.group; }
      var u = x.units, dig = u === 'kg' ? 0 : u === 'N' ? 0 : u === 's' ? 2 : u === 'm/s' ? 1 : u === 'kg/s' ? 2 : 3;
      tb.appendChild(el('tr', {}, [el('td', { 'data-k': 'Check', text: x.label }), el('td', { 'data-k': 'Model', class: 'n', text: fmt(x.model, dig) + ' ' + u }), el('td', { 'data-k': 'Flight', class: 'n', text: fmt(x.flight, dig) + ' ' + u }),
        el('td', { 'data-k': 'Gap', class: 'n', text: x.kind === 'diff' ? (x.gap >= 0 ? '+' : '') + fmt(x.gap, u === 'kg' ? 0 : 1) + ' ' + u : pct(x.gap, 2) }), x.note ? el('td', { 'data-k': 'Why' }, [el('span', { class: 'why', text: x.note })]) : el('td')]));
    });
    t.appendChild(tb);
    var tl = $('trustList'); tl.innerHTML = '';
    [
      '<b>The ledger is exact</b>: AS-512\'s stack built from the report\'s masses lifts off at ' + t1(g['Liftoff (holddown release)'].model) + ' t against the report\'s ' + t1(g['Liftoff (holddown release)'].flight) + ' t and arrives at every cutoff within 30 kg. [Certain]',
      '<b>The F-1 is right</b> at the engine level: idea 33\'s F-1 gives sea-level thrust ' + pct(g['F-1 sea-level thrust'].gap, 2) + ', flow ' + pct(g['F-1 mass flow'].gap, 2) + ' and Isp ' + pct(g['F-1 sea-level Isp'].gap, 2) + ' against the five flight engines. In flight its thrust and flow rose about 2.4 % by cutoff, which the model (fixed chamber pressure) does not follow. [Certain as numbers]',
      '<b>The J-2 is right only where it was calibrated</b>: on the S-II (mixture ratio 5.5) thrust ' + pct(g['J-2 vacuum thrust, S-II high-EMR phase'].gap, 2) + '; on the S-IVB, which ran at 5.0, ' + pct(g['J-2 vacuum thrust, S-IVB'].gap, 1) + ' in thrust and ' + pct(g['J-2 mass flow, S-IVB'].gap, 1) + ' in flow, so its burns come out ' + pct(g['S-IVB second burn, mainstage to cutoff'].gap, 0) + ' short. [Certain as numbers]',
      '<b>Ideal is not flown</b>: the S-II\'s ideal delta-v exceeds the velocity the flight gained by ' + fmt(g['S-II burn: ideal delta-v vs space-fixed gain'].gap, 0) + ' m/s, the loss to gravity while climbing; at the flight\'s own Isp the S-IVB\'s near-horizontal first burn agrees with the velocity gained within ' + fmt(Math.abs(g['S-IVB first burn at the flight\'s Isp'].gap), 0) + ' m/s. [Likely]',
    ].forEach(function (h) { tl.appendChild(el('li', { html: h })); });
  }

  // ------------------------------------------------------------------ handoff
  function buildHandoff() {
    cur.handoff = S.makeHandoff(cur.use, cur.engs, cur.r, {});
    $('exportText').value = JSON.stringify(cur.handoff, null, 1);
    $('nextLink').href = '../35-max-q/index.html#h=' + M.b64urlEncode(JSON.stringify(cur.handoff));
    var t = $('engTable'); t.innerHTML = '';
    t.appendChild(el('thead', {}, [el('tr', {}, ['Engine', 'Vacuum thrust', 'Sea-level thrust', 'Flow', 'Isp vacuum', 'Mixture ratio', 'Source'].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    Object.keys(cur.engs).forEach(function (k) {
      var e = cur.engs[k];
      tb.appendChild(el('tr', {}, [el('td', { 'data-k': 'Engine', text: e.label + (e.chambers > 1 ? ' (' + e.chambers + ' chambers)' : '') }), el('td', { 'data-k': 'Vacuum thrust', class: 'n', text: fmt(e.thrustVac / 1e3, 1) + ' kN' }),
        el('td', { 'data-k': 'Sea-level thrust', class: 'n', text: e.thrustSL != null ? fmt(e.thrustSL / 1e3, 1) + ' kN' : 'refused (separates)' }), el('td', { 'data-k': 'Flow', class: 'n', text: fmt(e.mdot, 2) + ' kg/s' }),
        el('td', { 'data-k': 'Isp vacuum', class: 'n', text: fmt(e.ispVac / G0, 1) + ' s' + (e.ispVacUpper ? ' to ' + fmt(e.ispVacUpper / G0, 1) : '') }), el('td', { 'data-k': 'Mixture ratio', class: 'n', text: fmt(e.mixtureRatio, 3) }),
        el('td', { 'data-k': 'Source' }, [el('span', { class: 'why', text: e.source })])]));
    });
    t.appendChild(tb);
  }
  function decode(text) {
    var s = String(text || '').trim(), m = s.match(/(?:^|[#&?])h=([A-Za-z0-9_-]+)/);
    try { if (m) s = M.b64urlDecode(m[1]); return JSON.parse(s); } catch (e) { return s; }
  }
  function doImport(text, how) {
    var st = $('importStatus'), obj = decode(text);
    var p = S.parseHandoff(obj);
    if (p.refusal) { st.className = 'status bad'; st.textContent = 'Refused (' + p.refusal.code + '): ' + p.refusal.reason + ' What would help: ' + p.refusal.what_would_help; return false; }
    if (p.engine || p.record) {
      imported = p.engine || p.record; engines[imported.id] = imported;
      loadVehicle('imp');
      st.className = 'status ok';
      st.textContent = 'Imported ' + how + ': idea 33\'s engine (' + imported.label + '), re-computed with idea 33\'s kernel; its numbers match the handoff. Put on a two-stage stack with assumed masses; change anything.';
    } else {
      for (var k in p.engines) { engines[k] = p.engines[k]; if (p.engines[k].kind === 'imported') imported = p.engines[k]; }
      importedVeh = p.vehicle; importedVeh.id = importedVeh.id === 'AS-512' ? 'AS-512' : 'imported';
      loadVehicle('impveh');
      st.className = 'status ok';
      st.textContent = 'Imported ' + how + ': a 34-stack vehicle (' + (p.vehicle.label || 'unnamed') + '), its engines re-computed with idea 33\'s kernel.';
    }
    return true;
  }

  // ------------------------------------------------------------------ wiring
  function fillVehicleSelect() { var s = $('vehicle'); s.innerHTML = ''; vehicleOptions().forEach(function (o) { s.appendChild(el('option', { value: o.id, text: o.label })); }); s.value = state.vehId; }
  function fillTargetSelect() {
    var s = $('target'); s.innerHTML = '';
    [['none', 'No target'], ['orbit', 'Apollo 17\'s ideal delta-v to parking orbit (' + fmt(AS.dvOrbit, 0) + ' m/s)'], ['tli', 'Apollo 17\'s ideal delta-v to translunar injection (' + fmt(AS.dvTli, 0) + ' m/s)'], ['typed', 'A delta-v you type (m/s)']]
      .forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1] })); });
    s.value = state.target; $('targetNum').hidden = state.target !== 'typed'; $('targetNum').value = state.targetTyped;
  }
  function loadVehicle(id) {
    state.vehId = id; state.veh = makeVehicle(id); state.cursor = null;
    fillVehicleSelect(); renderStages();
    var pl = state.veh.payload.mass / 1000;
    $('plRange').max = String(Math.max(200, Math.ceil(pl * 3)));
    $('plNum').value = pl.toFixed(1); $('plRange').value = pl;
    compute();
  }
  $('vehicle').addEventListener('change', function () { loadVehicle(this.value); });
  document.querySelectorAll('[data-events]').forEach(function (b) { b.addEventListener('click', function () { state.events = b.dataset.events; state.cursor = null; compute(); }); });
  $('addStage').addEventListener('click', function () {
    var v = state.veh; if (v.stages.length >= 5) return;
    var top = v.stages[v.stages.length - 1], P = Math.max(1000, S.stagePropellant(top) / 4);
    v.stages.push({ label: 'Stage ' + (v.stages.length + 1), engine: 'RL10A-3-3', count: 2, dry: S.dryForFraction(P, FRAC[2].value), remaining: 0, note: 'Added: dry mass scaled from ' + FRAC[2].label + '\'s inert fraction, assumed.', burns: [{ propellant: P, shed: 0, coast: 0, jettisons: [], engineOut: [] }] });
    v.id = 'custom'; renderStages(); compute();
  });
  $('plNum').addEventListener('change', function () { var t = +this.value; if (t >= 0) setPayload(t * 1000); else this.value = (state.veh.payload.mass / 1000).toFixed(1); });
  $('plRange').addEventListener('input', function () { setPayload(+this.value * 1000); });
  document.querySelectorAll('[data-fly]').forEach(function (b) { b.addEventListener('click', function () { state.fly = b.dataset.fly; drawFly(); }); });
  $('target').addEventListener('change', function () { state.target = this.value; $('targetNum').hidden = state.target !== 'typed'; compute(); });
  $('targetNum').addEventListener('change', function () { var v = +this.value; if (v > 0) { state.targetTyped = v; compute(); } });
  var fly = $('chartFly'), dragF = false;
  fly.addEventListener('pointerdown', function (e) { dragF = true; fly.setPointerCapture && fly.setPointerCapture(e.pointerId); flyPick(e); });
  fly.addEventListener('pointermove', function (e) { if (dragF) flyPick(e); });
  fly.addEventListener('pointerup', function () { dragF = false; });
  fly.addEventListener('pointerleave', function () { if (!dragF) $('tipFly').style.display = 'none'; });
  fly.addEventListener('keydown', function (e) {
    if (!cur.r.ok) return; var n = cur.r.timeline.length, c = state.cursor == null ? n - 1 : state.cursor;
    if (e.key === 'ArrowRight') c = Math.min(n - 1, c + 1); else if (e.key === 'ArrowLeft') c = Math.max(0, c - 1); else return;
    e.preventDefault(); state.cursor = c; drawFly();
  });
  var pay = $('chartPay'), dragP = false;
  pay.addEventListener('pointerdown', function (e) { dragP = true; pay.setPointerCapture && pay.setPointerCapture(e.pointerId); payPick(e); });
  pay.addEventListener('pointermove', function (e) {
    if (dragP) { payPick(e); return; }
    if (!pay._X || !cur.sweep) return;
    var p = svgPoint(pay, e), x = pay._X.inv(p.x) * 1000, best = cur.sweep[0];
    cur.sweep.forEach(function (q) { if (Math.abs(q.payload - x) < Math.abs(best.payload - x)) best = q; });
    if (best.dv != null) showTip($('tipPay'), pay, pay._X.s(best.payload / 1000), pay._Y.s(best.dv / 1000), t1(best.payload) + ' t payload<br>' + fmt(best.dv, 0) + ' m/s');
  });
  pay.addEventListener('pointerup', function () { dragP = false; });
  pay.addEventListener('pointerleave', function () { $('tipPay').style.display = 'none'; });
  pay.addEventListener('keydown', function (e) {
    var step = (e.shiftKey ? 10 : 1) * 1000, pl = state.veh.payload.mass;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') pl += step; else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') pl = Math.max(0, pl - step); else return;
    e.preventDefault(); setPayload(pl);
  });
  $('copyBtn').addEventListener('click', function () {
    var st = $('exportStatus');
    try { navigator.clipboard.writeText($('exportText').value).then(function () { st.className = 'status ok'; st.textContent = 'Copied.'; }, function () { st.className = 'status bad'; st.textContent = 'The browser would not copy; select the text below instead.'; }); }
    catch (e) { st.className = 'status bad'; st.textContent = 'The browser would not copy; select the text below instead.'; }
  });
  $('dlBtn').addEventListener('click', function () {
    var a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(cur.handoff, null, 1)], { type: 'application/json' })), download: 'handoff.json' });
    document.body.appendChild(a); a.click(); a.remove();
    $('exportStatus').className = 'status ok'; $('exportStatus').textContent = 'Downloaded handoff.json.';
  });
  $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'from the text box'); });

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (cur.r) { drawFly(); drawPay(); } }, 120); });

  // ------------------------------------------------------------------ start
  fillTargetSelect();
  renderRecord();
  var hash = location.hash || '';
  if (!(/[#&]h=/.test(hash) && doImport(hash, 'from the link'))) loadVehicle('as512');
  window.__stack = { S: S, E: E, state: state, cur: cur, AS: AS, engines: engines };
})();
