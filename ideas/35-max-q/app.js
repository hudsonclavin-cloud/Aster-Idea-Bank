/* Max Q page: wires the controls to the kernel (ascent.js on idea 34's stack.js) and draws. No network. */
(function () {
  'use strict';
  var PF = window.PartForgeISA, G0 = PF.ISA_G0;
  var S = window.Stack.create({ E: null, isa: PF.isa, g0: G0 });
  var DATA = window.MAXQ_DATA, T = window.AS512_TRAJECTORY, D = window.AS512_FLIGHT, EARTH = window.MaxQEarth;
  var A = window.MaxQ.create({ S: S, isa: PF.isa, g0: G0, isaTop: { R0: PF.ISA_R0, HMAX: PF.ISA_H_MAX }, earth: EARTH, aero: window.SATURN_V_AXIAL_FORCE, engines34: DATA.engines34, as512: D, trajectory: T });
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var T0 = A.as512T0();

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
  function sgn(v, d) { var r = Math.pow(10, -(d == null ? 2 : d)) / 2; if (Math.abs(v) < r) v = 0; return (v >= 0 ? '+' : '') + fmt(v, d); }
  function b64e(str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { var t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var bin = atob(t), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

  // ------------------------------------------------------------------ state
  var VEH = { as512: { label: 'Saturn V AS-512 (Apollo 17), as flown (idea 34)', h: DATA.as512 }, sample: { label: 'Idea 34\'s sample stack (assumed masses)', h: DATA.sample34 } };
  var state = { vehId: 'as512', cal: 'flight', metric: 'q', budget: 'rel', cursor: null, kickFit: null, levelFit: null };
  var cur = { v: null, plan: null, r: null, h34: null };

  function loadVehicle(id, keepPlan) {
    var src = VEH[id];
    var v = A.vehicleFromHandoff(src.h);
    if (v.refusal) { $('vehSource').textContent = 'Refused: ' + v.refusal.reason; return; }
    state.vehId = id; cur.v = v; cur.h34 = v.handoff34 || src.h; state.cursor = null;
    cur.plan = keepPlan || A.defaultPlan(v.vehicle);
    var as = v.vehicle.id === 'AS-512';
    if (!keepPlan) {
      if (as && state.cal === 'flight') cur.plan.flowScale[0] = A.as512FlowScale(v.engines);
      state.kickFit = null; state.levelFit = null;
      $('fpaTarget').value = as ? T.cutoff.sicOeco.fpa : 25;
      if (as) { solveKick(true); solveLevel(true); }
      else if (v.vehicle.stages.length > 1) { cur.plan.kickDeg = 1; cur.plan.upper = { mode: 'linear', startDeg: 0, endDeg: 0 }; solveLevel(true); }
    }
    fillVehicleSelect(); syncControls(); compute();
  }
  function fillVehicleSelect() {
    var s = $('vehicle'); s.innerHTML = '';
    Object.keys(VEH).forEach(function (k) { s.appendChild(el('option', { value: k, text: VEH[k].label })); });
    s.value = state.vehId;
  }
  function syncControls() {
    var p = cur.plan, v = cur.v.vehicle, as = v.id === 'AS-512';
    $('calCtl').hidden = !as;
    document.querySelectorAll('[data-cal]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.cal === state.cal)); });
    $('calNote').textContent = as ? (state.cal === 'flight' ? 'Thrust and flow × ' + fmt(p.flowScale[0], 5) + ': the flow per F-1 the flight averaged over the S-IC burn (idea 34\'s measurement from the report\'s propellant and engine-seconds), Isp unchanged.' : 'Idea 33\'s F-1 as the chain computes it (SP-8120\'s rating, calibrated): it burns the flown propellant 3.9 s longer than the flight did.') : '';
    var s = $('site'); s.innerHTML = '';
    Object.keys(EARTH.sites).forEach(function (k) { var x = EARTH.sites[k]; s.appendChild(el('option', { value: k, text: x.name + ' (' + x.latitudeDeg + ' deg N, azimuths ' + x.azimuthCorridorDeg[0] + ' to ' + x.azimuthCorridorDeg[1] + ')' })); });
    s.value = p.site.id;
    var cor = EARTH.sites[p.site.id].azimuthCorridorDeg;
    $('azRange').min = cor[0]; $('azRange').max = cor[1]; $('azRange').value = p.azimuthDeg; $('azNum').value = +p.azimuthDeg.toFixed(3);
    $('rotation').checked = p.rotation !== false;
    $('tpNum').value = +p.pitchStart.toFixed(3); $('tkNum').value = p.kickDuration;
    $('kickNum').value = +p.kickDeg.toFixed(4); $('kickRange').value = p.kickDeg;
    document.querySelectorAll('[data-upper]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.upper === p.upper.mode)); });
    var hasUpper = v.stages.length > 1;
    document.querySelectorAll('[data-upper]').forEach(function (b) { b.disabled = !hasUpper; });
    $('upperAngles').hidden = !hasUpper || p.upper.mode === 'gravity'; $('upEndCtl').hidden = p.upper.mode !== 'linear';
    $('upStart').value = +(p.upper.startDeg || 0).toFixed(3); $('upEnd').value = p.upper.endDeg || 0;
    $('solveLevel').disabled = !hasUpper || p.upper.mode === 'gravity';
    $('bucketOn').checked = !!p.throttle; $('bucketCtl').hidden = !p.throttle;
    var dk = cur.v.engines[v.stages[0].engine].deckVac;
    $('bLevel').min = Math.round(100 * dk.throttle[0]); $('bLevel').max = Math.round(100 * dk.throttle[dk.throttle.length - 1]);
    $('bLevelNum').min = $('bLevel').min; $('bLevelNum').max = $('bLevel').max;
    if (p.throttle) { $('bStart').value = p.throttle.start; $('bEnd').value = p.throttle.end; $('bLevel').value = Math.round(100 * p.throttle.level); $('bLevelNum').value = +(100 * p.throttle.level).toFixed(2); }
    document.querySelectorAll('[data-drag]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.drag === p.drag)); });
    $('diaNum').value = +p.diameter.toFixed(4); $('dragScale').value = p.dragScale;
    var co = $('coasts'); co.innerHTML = '';
    v.stages.slice(1).forEach(function (st, i) {
      var id = 'coast' + i, inp = el('input', { id: id, type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: String(+p.stagingCoast[i].toFixed(3)) });
      inp.addEventListener('change', function () { var x = this.value.trim() === '' ? NaN : +this.value; p.stagingCoast[i] = x; compute(); });
      co.appendChild(el('div', { class: 'ctl' }, [el('div', { class: 'ctl-head' }, [el('label', { for: id, html: 'Coast before ' + st.label + ' <small>(s)</small>' }), inp])]));
    });
    $('kickNote').textContent = state.kickFit || '';
    $('upperNote').textContent = state.levelFit || '';
    var src = as ? 'Every mass and event from NASA\'s flight report via idea 34; pitch-over at 12.9 s range time (Table 2-2); flight azimuth 91.504 deg (section 4.1); staging coasts from the report\'s event times; 33 ft reference diameter (Walker).' : (v.label || 'A vehicle') + ': masses assumed in idea 34; the drag curve is the Saturn V\'s, scaled by your diameter.';
    $('vehSource').textContent = src;
  }

  // ------------------------------------------------------------------ solvers
  function solveKick(quiet) {
    var tgt = +$('fpaTarget').value, as = cur.v.vehicle.id === 'AS-512';
    var s = A.solveKick(cur.v.vehicle, cur.v.engines, cur.plan, tgt);
    if (s.refusal) { state.kickFit = 'Refused: ' + s.refusal.reason + ' ' + s.refusal.what_would_help; if (!quiet) { syncControls(); compute(); } return; }
    cur.plan.kickDeg = s.kickDeg; cur.plan.fitKick = as && Math.abs(tgt - T.cutoff.sicOeco.fpa) < 1e-9;
    state.kickFit = 'Solved: a ' + fmt(s.kickDeg, 4) + ' deg kick ends the first stage at ' + fmt(tgt, 3) + ' deg' + (cur.plan.fitKick ? ' (Table 4-2\'s outboard cutoff: the one number fitted to the flight)' : '') + '.';
    if (!quiet) { syncControls(); compute(); }
  }
  function solveLevel(quiet) {
    if (cur.plan.upper.mode === 'gravity') cur.plan.upper = { mode: 'linear', startDeg: 0, endDeg: 0 };
    var s = A.solveInsertion(cur.v.vehicle, cur.v.engines, cur.plan);
    if (s.refusal) { state.levelFit = 'Refused: ' + s.refusal.reason + ' ' + s.refusal.what_would_help; cur.plan.fitInsertion = false; }
    else { cur.plan.upper.startDeg = s.pitchDeg; cur.plan.fitInsertion = true; state.levelFit = 'Solved: starting at ' + fmt(s.pitchDeg, 3) + ' deg' + (cur.plan.upper.mode === 'linear' ? ' and pitching down to ' + fmt(cur.plan.upper.endDeg, 2) + ' deg' : '') + ' ends the last burn level (flight-path angle 0).'; }
    if (!quiet) { syncControls(); compute(); }
  }

  /** After a switch that changes the flight (bucket, drag, rotation, site, flow), keep what was solved solved. */
  function refit() { if (cur.plan.fitKick) solveKick(true); if (cur.plan.fitInsertion) solveLevel(true); }

  // ------------------------------------------------------------------ compute and render
  function compute() {
    cur.r = A.fly(cur.v.vehicle, cur.v.engines, cur.plan);
    renderResults(); drawChart(); renderBudget(); renderRecord(); buildHandoff();
  }
  function tile(k, v, u, conf, sub, cls) {
    return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [el('div', { class: 'k', text: k }), el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: u }) : null]), sub ? el('div', { class: 'sub', html: sub }) : null, conf ? el('span', { class: 'c', text: conf }) : null]);
  }
  function refusalBox(r) { return el('div', { class: 'refusal' }, [el('b', { text: (r.applies_to ? r.applies_to + ': ' : '') + 'refused (' + r.code + ')' }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]); }
  function renderResults() {
    var r = cur.r, rf = $('refusals'), tl = $('tiles'), tb = $('stageTable');
    rf.innerHTML = ''; tl.innerHTML = ''; tb.innerHTML = ''; $('warnings').textContent = '';
    (r.refusals || []).forEach(function (x) { rf.appendChild(refusalBox(x)); });
    if (!r.ok) { tl.appendChild(tile('Ascent', 'refused', '', null, 'Fix the inputs named above.', 'refused')); return; }
    var f = r.final, o = r.orbit;
    tl.appendChild(tile('Max Q', fmt(r.maxQ.q / 1000, 2), 'kPa', 'derived', 'at ' + fmt(r.maxQ.t, 1) + ' s, ' + fmt(r.maxQ.h / 1000, 2) + ' km, Mach ' + fmt(r.maxQ.M, 2), 'hero'));
    tl.appendChild(r.mach1 ? tile('Mach 1', fmt(r.mach1.t, 1), 's', 'derived', 'at ' + fmt(r.mach1.h / 1000, 2) + ' km') : tile('Mach 1', 'never', '', 'derived'));
    tl.appendChild(tile('Burnout altitude', fmt(f.altitude / 1000, 1), 'km', 'derived', 'at ' + fmt(f.t, 1) + ' s, flight-path angle ' + fmt(f.fpaDeg, 2) + ' deg'));
    tl.appendChild(tile('Burnout speed', fmt(f.speed / 1000, 3), 'km/s', 'derived', 'inertial; ' + fmt(f.speedEarthFixed / 1000, 3) + ' km/s relative to the ground'));
    if (o.bound && o.perigeeAlt > A.constants.ATM_TOP) tl.appendChild(tile('Orbit', fmt(o.perigeeAlt / 1000, 0) + ' × ' + fmt(o.apogeeAlt / 1000, 0), 'km', 'derived', 'perigee × apogee, inclination ' + fmt(o.inclinationDeg, 2) + ' deg'));
    else tl.appendChild(tile('Orbit', 'not in orbit', '', 'derived', o.bound ? 'perigee ' + fmt(o.perigeeAlt / 1000, 0) + ' km: it falls back' : 'escapes', 'refused'));
    tl.appendChild(tile('Earth\'s spin gives', fmt(r.v0, 1), 'm/s', 'derived', 'the pad\'s own speed, ω R cos(' + fmt(cur.plan.site.latitudeDeg, 1) + '°)'));
    var LR = r.lossesRel;
    tl.appendChild(tile('Lost to gravity', fmt(LR.gravity, 0), 'm/s', 'derived', 'drag ' + fmt(LR.drag, 1) + ', steering ' + fmt(LR.steering, 1) + ', back pressure ' + fmt(r.losses.pressure, 1)));
    var head = ['Cutoff', 'Time', 'Altitude', 'Speed', 'Flight-path angle', 'Mass', 'Gravity', 'Drag', 'Steering'];
    tb.appendChild(el('caption', { class: 'small', text: 'At each cutoff: time from liftoff, height above the sphere, inertial speed (and relative to the ground), space-fixed flight-path angle, vehicle mass, and the losses (against Earth-relative speed) during that stage\'s flight.' }));
    tb.appendChild(el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))]));
    var body = el('tbody'), prev = { gravity: 0, drag: 0, steering: 0 };
    r.stageEnds.forEach(function (e) {
      var s = e.state, L = e.lossesRel;
      body.appendChild(el('tr', {}, [
        el('td', { 'data-k': 'Cutoff', text: e.label + (cur.v.vehicle.stages[e.stage].burns.length > 1 ? ' burn ' + (e.burn + 1) : '') }),
        el('td', { 'data-k': 'Time', class: 'n', text: fmt(e.t, 2) + ' s' }),
        el('td', { 'data-k': 'Altitude', class: 'n', text: fmt(s.altitude / 1000, 2) + ' km' }),
        el('td', { 'data-k': 'Speed', class: 'n', text: fmt(s.speed, 1) + ' m/s (' + fmt(s.speedEarthFixed, 1) + ')' }),
        el('td', { 'data-k': 'Flight-path angle', class: 'n', text: fmt(s.fpaDeg, 3) + ' deg' }),
        el('td', { 'data-k': 'Mass', class: 'n', text: fmt(s.mass / 1000, 1) + ' t' }),
        el('td', { 'data-k': 'Gravity', class: 'n', text: fmt(L.gravity - prev.gravity, 1) + ' m/s' }),
        el('td', { 'data-k': 'Drag', class: 'n', text: fmt(L.drag - prev.drag, 1) + ' m/s' }),
        el('td', { 'data-k': 'Steering', class: 'n', text: fmt(L.steering - prev.steering, 1) + ' m/s' }),
      ]));
      prev = L;
    });
    tb.appendChild(body);
    var w = (r.warnings || []).map(function (x) { return x.applies_to + ': ' + x.reason; });
    if (r.remainingBurns.length) w.push('Not flown here: ' + r.remainingBurns.map(function (x) { return x.label; }).join(', ') + ' (a restart from the parking orbit; Earth departure is module 38\'s).');
    if (r.losses.dragOutsideData > 0.05) w.push(fmt(r.losses.dragOutsideData, 1) + ' m/s of the drag was booked below Mach 0.5 or above 7.8, where Walker\'s data stop and the coefficient is held flat.');
    $('warnings').textContent = w.join(' ');
  }

  // ------------------------------------------------------------------ chart
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
  // what each chart shows: x and y of a sample, the samples in view, and the flight report's points (model clock)
  function firstStageEnd() { var r = cur.r; return r.stageEnds && r.stageEnds.length ? r.stageEnds[0].t : r.samples[r.samples.length - 1].t; }
  var METRICS = {
    q: { xl: 'Time from liftoff (s)', yl: 'Dynamic pressure (kPa)', x: function (s) { return s.t; }, y: function (s) { return s.q / 1000; }, until: function () { return firstStageEnd() + 15; },
      flight: function () { return [[T.maxQ.t - T0, T.maxQ.qNcm2 * 10, 'Max Q, Table 4-1']]; }, cap: 'Dynamic pressure ½ρv² on the Earth-relative velocity, first stage. The black point is the flight\'s maximum (3.36 N/cm² at 82.5 s range time, Table 4-1).' },
    alt: { xl: 'Downrange (km)', yl: 'Altitude (km)', x: function (s) { return s.range / 1000; }, y: function (s) { return s.h / 1000; },
      flight: function () { var C = T.cutoff; return [[C.sicCeco.rangeKm, C.sicCeco.altKm, 'S-IC centre cutoff'], [C.sicOeco.rangeKm, C.sicOeco.altKm, 'S-IC outboard cutoff'], [C.siiCeco.rangeKm, C.siiCeco.altKm, 'S-II centre cutoff'], [C.siiOeco.rangeKm, C.siiOeco.altKm, 'S-II cutoff']]; },
      cap: 'Height above the sphere against the great-circle distance from the pad (which turns with the Earth). Black points: the flight\'s cutoffs (Table 4-2; geodetic heights).' },
    v: { xl: 'Time from liftoff (s)', yl: 'Speed (km/s)', x: function (s) { return s.t; }, y: function (s) { return s.v / 1000; }, y2: function (s) { return s.vrel / 1000; },
      flight: function () { var C = T.cutoff; return [[C.sicCeco.t - T0, C.sicCeco.v / 1000, 'S-IC centre cutoff'], [C.sicOeco.t - T0, C.sicOeco.v / 1000, 'S-IC outboard cutoff'], [C.siiCeco.t - T0, C.siiCeco.v / 1000, 'S-II centre cutoff'], [C.siiOeco.t - T0, C.siiOeco.v / 1000, 'S-II cutoff'], [C.sivb1Gcs.t - T0, C.sivb1Gcs.v / 1000, 'S-IVB first cutoff']]; },
      cap: 'Inertial (space-fixed) speed, and dashed, speed relative to the rotating ground. Black points: the flight\'s space-fixed speeds at its cutoffs (Table 4-2).' },
    a: { xl: 'Time from liftoff (s)', yl: 'Acceleration (g)', x: function (s) { return s.t; }, y: function (s) { return s.a / G0; },
      flight: function () { var X = D.acceleration; return [[X.sic[0] - T0, X.sic[3], 'S-IC peak'], [X.sii[0] - T0, X.sii[3], 'S-II before centre cutoff'], [X.sivb1[0] - T0, X.sivb1[3], 'S-IVB first cutoff']]; },
      cap: 'What an accelerometer reads: thrust and drag over mass, in g. Black points: the flight\'s peaks (Table 4-1).' },
    mach: { xl: 'Time from liftoff (s)', yl: 'Mach number', x: function (s) { return s.t; }, y: function (s) { return s.M; }, until: function () { return firstStageEnd() + 15; },
      flight: function () { return [[T.mach1.t - T0, 1, 'Mach 1, Table 4-1']]; }, cap: 'Earth-relative speed over the 1976 standard\'s speed of sound (no Mach number above 86 km, where the table ends). Black point: the flight\'s Mach 1 (67.5 s range time).' },
  };
  function view() {
    var m = METRICS[state.metric], r = cur.r, lim = m.until ? m.until() : Infinity;
    return r.samples.filter(function (s) { return s.t <= lim && m.y(s) != null && isFinite(m.y(s)); });
  }
  function drawChart() {
    var svg = $('chart'), r = cur.r; svg.innerHTML = ''; $('tip').style.display = 'none'; $('legend').innerHTML = '';
    var m = METRICS[state.metric];
    if (!r.samples || r.samples.length < 2) { $('cap').textContent = 'Nothing to draw: the ascent is refused.'; return; }
    var pts = view(), g = geom(svg, 320, 300), as = cur.v.vehicle.id === 'AS-512';
    var fl = as ? m.flight() : [];
    var xs = pts.map(m.x), ys = pts.map(m.y).concat(m.y2 ? pts.map(m.y2) : []).concat(fl.map(function (p) { return p[1]; }));
    var xmax = Math.max.apply(null, xs.concat(fl.map(function (p) { return p[0]; }))), xmin = Math.min.apply(null, xs);
    var ymax = Math.max.apply(null, ys) * 1.06, ymin = Math.min(0, Math.min.apply(null, ys));
    if (!(ymax > ymin)) ymax = ymin + 1;
    var X = scale(xmin, xmax, g.l, g.W - g.r, function (v) { return fmt(v, 0); }), Y = scale(ymin, ymax, g.H - g.b, g.t, function (v) { return Math.abs(ymax - ymin) < 5 ? fmt(v, 1) : fmt(v, 0); });
    svg._X = X; svg._Y = Y; svg._pts = pts;
    // the bucket and the stages, as bands
    if (cur.plan.throttle && m.xl.indexOf('Time') === 0) svg.appendChild(sv('rect', { class: 'bucket', x: X.s(cur.plan.throttle.start), y: g.t, width: Math.max(0, X.s(Math.min(cur.plan.throttle.end, xmax)) - X.s(cur.plan.throttle.start)), height: g.H - g.b - g.t }));
    axes(svg, X, Y, m.xl, m.yl, ticks(xmin, xmax, g.W < 600 ? 4 : 7), ticks(ymin, ymax, 5));
    var path = function (f, cls) { var d = ''; pts.forEach(function (p, i) { var yv = f(p); if (yv == null || !isFinite(yv)) return; d += (d ? 'L' : 'M') + X.s(m.x(p)).toFixed(1) + ',' + Y.s(yv).toFixed(1); }); svg.appendChild(sv('path', { class: 'line ' + cls, d: d })); };
    path(m.y, 's1');
    if (m.y2) path(m.y2, 's2 dash');
    fl.forEach(function (p) { svg.appendChild(sv('circle', { class: 'flight', cx: X.s(p[0]), cy: Y.s(p[1]), r: 5 }, null)).appendChild(sv('title', {}, p[2])); });
    var c = state.cursor != null ? Math.min(state.cursor, pts.length - 1) : null;
    if (c != null) {
      var p = pts[c], cx = X.s(m.x(p)), cy = Y.s(m.y(p));
      svg.appendChild(sv('line', { class: 'cursor', x1: cx, x2: cx, y1: g.t, y2: g.H - g.b }));
      svg.appendChild(sv('circle', { class: 'dot1', cx: cx, cy: cy, r: 5 }));
      showTip($('tip'), svg, cx, cy, fmt(p.t, 1) + ' s, ' + fmt(p.h / 1000, 2) + ' km<br>q ' + fmt(p.q / 1000, 2) + ' kPa' + (p.M != null ? ', Mach ' + fmt(p.M, 2) : '') + '<br>' + fmt(p.v, 0) + ' m/s (' + fmt(p.vrel, 0) + ' ground)<br>' + fmt(p.a / G0, 2) + ' g, stage ' + (p.stage + 1));
    }
    var lg = $('legend');
    lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color: var(--s1)' }), METRICS[state.metric].yl.replace(/ \(.*/, '') + (m.y2 ? ', inertial' : '')]));
    if (m.y2) lg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--s2)' }), 'relative to the ground']));
    if (fl.length) lg.appendChild(el('li', {}, [el('span', { class: 'key flight' }), 'Apollo 17, as reconstructed']));
    if (cur.plan.throttle && m.xl.indexOf('Time') === 0) lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color: var(--warn)' }), 'throttle bucket']));
    $('cap').textContent = m.cap + (as ? '' : ' (Flight points are shown for AS-512 only.)');
  }
  function pick(evt) { var svg = $('chart'); if (!svg._X) return; var p = svgPoint(svg, evt), x = svg._X.inv(p.x), m = METRICS[state.metric], best = 0; svg._pts.forEach(function (q, i) { if (Math.abs(m.x(q) - x) < Math.abs(m.x(svg._pts[best]) - x)) best = i; }); state.cursor = best; drawChart(); }

  // ------------------------------------------------------------------ the budget
  function renderBudget() {
    var r = cur.r, w = $('wf'); w.innerHTML = ''; $('wfCap').textContent = '';
    if (!r.ok) return;
    var rows, ideal = r.losses.ideal, rel = state.budget === 'rel';
    if (rel) {
      var L = r.lossesRel;
      rows = [['Ideal delta-v (idea 34)', ideal, 'pos'], ['Gravity', -L.gravity, 'neg'], ['Drag', -L.drag, 'neg'], ['Steering', -L.steering, 'neg'], ['Back pressure', -r.losses.pressure, 'neg'], ['Centrifugal', L.centrifugal, 'pos'], ['Speed over the ground at burnout', r.final.speedEarthFixed, 'tot'], ['Plus the spinning Earth', r.final.speed - r.final.speedEarthFixed, 'pos'], ['Inertial speed at burnout', r.final.speed, 'tot']];
      $('wfCap').textContent = 'Measured against the speed over the ground: ideal − gravity − drag − steering − back pressure + centrifugal = ' + fmt(r.final.speedEarthFixed, 1) + ' m/s (closes to ' + fmt(Math.abs(r.closureRel) * 1000, 2) + ' mm/s). The spinning Earth then adds the difference between the two speeds at burnout, not ω R cos(latitude): the vectors add, at an angle.';
    } else {
      var I = r.losses;
      rows = [['The pad\'s own speed', r.v0, 'pos'], ['Ideal delta-v (idea 34)', ideal, 'pos'], ['Gravity', -I.gravity, 'neg'], ['Drag', -I.drag, 'neg'], ['Steering', -I.steering, 'neg'], ['Back pressure', -I.pressure, 'neg'], ['Inertial speed at burnout', r.final.speed, 'tot']];
      $('wfCap').textContent = 'Measured against the inertial speed: pad speed + ideal − losses = ' + fmt(r.final.speed, 1) + ' m/s (closes to ' + fmt(Math.abs(r.closure) * 1e6, 2) + ' µm/s). Early on the ground carries the rocket east at ' + fmt(r.v0, 0) + ' m/s while it climbs straight up, so climbing reads here as "steering" and much less as "gravity": same flight, same total, another split.';
    }
    var max = 0, run = 0; rows.forEach(function (x) { if (x[2] === 'tot') run = x[1]; else run += x[1]; max = Math.max(max, run, x[2] === 'tot' ? x[1] : 0); });
    run = 0;
    rows.forEach(function (x) {
      var a, b;
      if (x[2] === 'tot') { a = 0; b = x[1]; run = x[1]; }
      else { a = run; run += x[1]; b = run; }
      var lo = Math.min(a, b), hi = Math.max(a, b), bar = el('div', { class: 'wfbar' });
      bar.appendChild(el('span', { class: x[2], style: 'left:' + (100 * lo / max).toFixed(2) + '%;width:' + Math.max(0.4, 100 * (hi - lo) / max).toFixed(2) + '%' }));
      var txt = (x[2] === 'tot' ? '' : x[1] >= 0 ? '+' : '−') + fmt(Math.abs(x[1]), Math.abs(x[1]) < 100 ? 1 : 0) + ' m/s';
      w.appendChild(el('div', { class: 'wfrow' }, [el('span', { class: 'nm', text: x[0] }), bar, el('span', { class: 'val', text: txt })]));
    });
  }

  // ------------------------------------------------------------------ against Apollo 17
  function renderRecord() {
    var tb = $('tblRecord'), sm = $('recordSummary'); tb.innerHTML = ''; sm.innerHTML = '';
    var r = cur.r;
    if (cur.v.vehicle.id !== 'AS-512') { sm.appendChild(el('p', { class: 'small', text: 'Load "Saturn V AS-512 (Apollo 17), as flown" to compare this page with a real flight.' })); return; }
    if (!r.ok || !r.stageEnds || !r.stageEnds.length) { sm.appendChild(el('p', { class: 'small', text: 'The ascent is refused; nothing to compare.' })); return; }
    var rows = A.as512Rows(r, cur.plan), get = function (g, l) { return rows.filter(function (x) { return x.group.indexOf(g) === 0 && x.label === l; })[0]; };
    var gp = function (x) { return x ? (x.kind === 'ratio' ? sgn(100 * x.gap, 1) + ' %' : sgn(x.gap, Math.abs(x.gap) < 10 ? 2 : 1) + ' ' + x.units) : '-'; };
    var mq = get('Max Q', 'Dynamic pressure'), ce = get('S-IC centre', 'Space-fixed velocity'), oe = get('S-IC outboard', 'Altitude'), iv = get('S-IVB first cutoff', 'Space-fixed velocity');
    sm.appendChild(tile('Max Q against the flight', gp(mq), '', 'measured gap', fmt(mq.model, 2) + ' kPa against ' + fmt(mq.flight, 2)));
    sm.appendChild(tile('Speed at centre cutoff (139.30 s)', gp(ce), '', 'measured gap', fmt(ce.model, 1) + ' against ' + fmt(ce.flight, 1) + ' m/s'));
    sm.appendChild(tile('First-stage cutoff height', gp(oe), '', 'measured gap', fmt(oe.model, 2) + ' against ' + fmt(oe.flight, 2) + ' km'));
    if (iv) sm.appendChild(tile('Speed at S-IVB cutoff', gp(iv), '', 'measured gap', 'open loop against the flight\'s guidance'));
    tb.appendChild(el('thead', {}, [el('tr', {}, ['Event', 'Quantity', 'Model', 'Flight', 'Gap', 'Note'].map(function (h) { return el('th', { text: h }); }))]));
    var body = el('tbody');
    rows.forEach(function (x) {
      body.appendChild(el('tr', x.note.indexOf('Fitted') === 0 || x.note.indexOf('Solved') === 0 ? { class: 'hl' } : {}, [
        el('td', { 'data-k': 'Event', text: x.group }), el('td', { 'data-k': 'Quantity', text: x.label }),
        el('td', { 'data-k': 'Model', class: 'n', text: fmt(x.model, Math.abs(x.model) < 100 ? 3 : 1) + ' ' + x.units }),
        el('td', { 'data-k': 'Flight', class: 'n', text: fmt(x.flight, Math.abs(x.flight) < 100 ? 3 : 1) + ' ' + x.units }),
        el('td', { 'data-k': 'Gap', class: 'n', text: gp(x) }), el('td', { 'data-k': 'Note' }, [el('span', { class: 'why', text: x.note })])]));
    });
    tb.appendChild(body);
  }

  // ------------------------------------------------------------------ handoff
  function buildHandoff() {
    cur.handoff = A.makeHandoff(cur.h34, cur.v.vehicle, cur.plan, cur.r, {});
    $('exportText').value = JSON.stringify(cur.handoff, null, 1);
    $('nextLink').href = '../36-closed-loop/index.html#h=' + b64e(JSON.stringify(cur.handoff));
  }
  function decode(text) {
    var s = String(text || '').trim(), m = s.match(/(?:^|[#&?])h=([A-Za-z0-9_-]+)/);
    try { if (m) s = b64d(m[1]); return JSON.parse(s); } catch (e) { return s; }
  }
  function doImport(text, how) {
    var st = $('importStatus'), obj = decode(text);
    var p = A.parseHandoff(obj);
    if (p.refusal) { st.className = 'status bad'; st.textContent = 'Refused (' + p.refusal.code + '): ' + p.refusal.reason + ' What would help: ' + p.refusal.what_would_help; return false; }
    var h34 = p.handoff34 || obj;
    VEH.imp = { label: 'Imported: ' + (p.vehicle.label || 'a 34-stack vehicle') + (p.vehicle.id === 'AS-512' ? ' (the flight report\'s)' : ''), h: h34 };
    if (p.plan) { state.cal = 'model'; loadVehicle('imp', JSON.parse(JSON.stringify(p.plan))); }
    else loadVehicle('imp');
    st.className = 'status ok';
    st.textContent = 'Imported ' + how + ': ' + (obj.from === '35-max-q' ? 'an ascent (its vehicle re-checked with idea 34\'s ledger, its flight re-flown with its plan).' : 'idea 34\'s vehicle, its ledger re-run and matched to the handoff to 1e-8.');
    return true;
  }

  // ------------------------------------------------------------------ wiring
  function numIn(id, set) { $(id).addEventListener('change', function () { var x = this.value.trim() === '' ? NaN : +this.value; set(x); state.cursor = null; compute(); }); }
  $('vehicle').addEventListener('change', function () { loadVehicle(this.value); });
  document.querySelectorAll('[data-cal]').forEach(function (b) { b.addEventListener('click', function () { state.cal = b.dataset.cal; cur.plan.flowScale[0] = state.cal === 'flight' ? A.as512FlowScale(cur.v.engines) : 1; refit(); syncControls(); compute(); }); });
  $('site').addEventListener('change', function () {
    var x = EARTH.sites[this.value], c = x.azimuthCorridorDeg, inC = function (a) { return a >= c[0] && a <= c[1]; };
    cur.plan.site = { id: this.value, label: x.name, latitudeDeg: x.latitudeDeg, source: EARTH.sites_source };
    if (!inC(cur.plan.azimuthDeg)) cur.plan.azimuthDeg = inC(90) ? 90 : inC(180) ? 180 : (c[0] + c[1]) / 2; // due east, else due south
    refit(); syncControls(); compute();
  });
  numIn('azNum', function (x) { cur.plan.azimuthDeg = x; $('azRange').value = x; });
  $('azRange').addEventListener('input', function () { cur.plan.azimuthDeg = +this.value; $('azNum').value = this.value; compute(); });
  $('rotation').addEventListener('change', function () { cur.plan.rotation = this.checked; refit(); syncControls(); compute(); });
  numIn('tpNum', function (x) { cur.plan.pitchStart = x; });
  numIn('tkNum', function (x) { cur.plan.kickDuration = x; });
  numIn('kickNum', function (x) { cur.plan.kickDeg = x; cur.plan.fitKick = false; state.kickFit = null; $('kickNote').textContent = ''; $('kickRange').value = x; });
  $('kickRange').addEventListener('input', function () { cur.plan.kickDeg = +this.value; cur.plan.fitKick = false; state.kickFit = null; $('kickNote').textContent = ''; $('kickNum').value = this.value; state.cursor = null; compute(); });
  $('solveKick').addEventListener('click', function () { solveKick(false); });
  document.querySelectorAll('[data-upper]').forEach(function (b) { b.addEventListener('click', function () { cur.plan.upper = Object.assign({}, cur.plan.upper, { mode: b.dataset.upper }); cur.plan.fitInsertion = false; state.levelFit = null; syncControls(); compute(); }); });
  numIn('upStart', function (x) { cur.plan.upper.startDeg = x; cur.plan.fitInsertion = false; state.levelFit = null; $('upperNote').textContent = ''; });
  numIn('upEnd', function (x) { cur.plan.upper.endDeg = x; cur.plan.fitInsertion = false; state.levelFit = null; $('upperNote').textContent = ''; });
  $('solveLevel').addEventListener('click', function () { solveLevel(false); });
  $('bucketOn').addEventListener('change', function () {
    if (this.checked) { var q = cur.r && cur.r.ok ? cur.r.maxQ.t : 70; cur.plan.throttle = { start: Math.max(0, Math.round(q - 20)), end: Math.round(q + 20), level: 0.8 }; }
    else cur.plan.throttle = null;
    refit(); syncControls(); compute();
  });
  numIn('bStart', function (x) { cur.plan.throttle.start = x; });
  numIn('bEnd', function (x) { cur.plan.throttle.end = x; });
  numIn('bLevelNum', function (x) { cur.plan.throttle.level = x / 100; $('bLevel').value = x; });
  $('bLevel').addEventListener('input', function () { cur.plan.throttle.level = +this.value / 100; $('bLevelNum').value = this.value; compute(); });
  document.querySelectorAll('[data-drag]').forEach(function (b) { b.addEventListener('click', function () { cur.plan.drag = b.dataset.drag; refit(); syncControls(); compute(); }); });
  numIn('diaNum', function (x) { cur.plan.diameter = x; });
  numIn('dragScale', function (x) { cur.plan.dragScale = x; });
  document.querySelectorAll('[data-metric]').forEach(function (b) { b.addEventListener('click', function () { state.metric = b.dataset.metric; state.cursor = null; document.querySelectorAll('[data-metric]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawChart(); }); });
  document.querySelectorAll('[data-budget]').forEach(function (b) { b.addEventListener('click', function () { state.budget = b.dataset.budget; document.querySelectorAll('[data-budget]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); renderBudget(); }); });
  var ch = $('chart'), drag = false;
  ch.addEventListener('pointerdown', function (e) { drag = true; ch.setPointerCapture && ch.setPointerCapture(e.pointerId); pick(e); });
  ch.addEventListener('pointermove', function (e) { if (drag) pick(e); });
  ch.addEventListener('pointerup', function () { drag = false; });
  ch.addEventListener('keydown', function (e) {
    if (!ch._pts) return; var n = ch._pts.length, c = state.cursor == null ? 0 : state.cursor, step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') c = Math.min(n - 1, c + step); else if (e.key === 'ArrowLeft') c = Math.max(0, c - step); else return;
    e.preventDefault(); state.cursor = c; drawChart();
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
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (cur.r) drawChart(); }, 120); });

  // ------------------------------------------------------------------ how far to trust it (numbers from a reference run)
  function trust() {
    var v = A.vehicleFromHandoff(DATA.as512), p = A.defaultPlan(v.vehicle);
    p.flowScale[0] = A.as512FlowScale(v.engines);
    p.kickDeg = A.solveKick(v.vehicle, v.engines, p, T.cutoff.sicOeco.fpa).kickDeg; p.fitKick = true;
    var s = A.solveInsertion(v.vehicle, v.engines, p); if (s.pitchDeg != null) { p.upper.startDeg = s.pitchDeg; p.fitInsertion = true; }
    var r = A.fly(v.vehicle, v.engines, p), rows = A.as512Rows(r, p), get = function (g, l) { return rows.filter(function (x) { return x.group.indexOf(g) === 0 && x.label === l; })[0]; };
    var ce = get('S-IC centre', 'Space-fixed velocity'), ca = get('S-IC centre', 'Altitude'), mq = get('Max Q', 'Dynamic pressure'), mt = get('Max Q', 'Time'), mh = get('Max Q', 'Altitude'), iv = get('S-IVB first cutoff', 'Space-fixed velocity');
    var ST = D.stageTables, b1 = v.ledger.stages[2].burns[0].time, f1 = ST['S-IVB burn 1'].events['S-IVB engine cutoff'].t - ST['S-IVB burn 1'].events['S-IVB mainstage'].t;
    return [
      '[Certain] The integrator and the bookkeeping: every burn matches idea 34\'s rocket equation, a vertical burn and a gravity turn match their closed forms, a coast keeps its energy, and an independent Python flight (scipy, a rotating frame, another implementation of the 1976 atmosphere) agrees to under a metre and a few millimetres per second (README, Tests).',
      '[Certain as numbers] Against Apollo 17, with the flight-average F-1 flow and the kick fitted to one number (the first stage\'s cutoff angle): at centre cutoff the speed is ' + sgn(ce.gap, 1) + ' m/s and the height ' + sgn(ca.gap, 2) + ' km off the flight; max Q comes ' + fmt(Math.abs(mt.gap), 1) + ' s ' + (mt.gap < 0 ? 'early' : 'late') + ', ' + fmt(Math.abs(mh.gap), 1) + ' km ' + (mh.gap < 0 ? 'low' : 'high') + ' and ' + sgn(100 * mq.gap, 1) + ' % in pressure.',
      '[Likely] Most of the max-Q gap is the steering law: the real S-IC flew a tilt programme (Table 2-2: pitch from 12.9 s to tilt arrest at 160.1 s), not a gravity turn, through a measured atmosphere and a ' + fmt(T.maxQAppendix.windMs, 1) + ' m/s wind at max Q (Appendix A); this page has the standard atmosphere and no wind.',
      '[Likely] The upper stages fly open loop and end ' + fmt(Math.abs(iv.gap), 0) + ' m/s short of the flight\'s speed at S-IVB cutoff and short of orbit: the flight flew iterative guidance (module 36). Part of it is the chain: idea 33\'s J-2 runs at mixture ratio 5.5 where the S-IVB flew about 5.0, so its first burn lasts ' + fmt(b1, 1) + ' s against the flight\'s ' + fmt(f1, 1) + ' s.',
      '[Speculative] The drag of any vehicle that is not a Saturn V: the only measured curve here is the Saturn V\'s, scaled by your diameter.',
    ];
  }
  trust().forEach(function (t) { $('trustList').appendChild(el('li', { text: t })); });

  // ------------------------------------------------------------------ start
  var hash = location.hash || '';
  if (!(/[#&]h=/.test(hash) && doImport(hash, 'from the link'))) loadVehicle('as512');
  window.__maxq = { A: A, S: S, state: state, cur: cur, VEH: VEH, b64e: b64e };
})();
