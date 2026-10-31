/* Closed Loop page: wires the controls to the kernel (closedloop.js on idea 35's ascent.js) and draws. No network. */
(function () {
  'use strict';
  var PF = window.PartForgeISA, G0 = PF.ISA_G0;
  var S = window.Stack.create({ E: null, isa: PF.isa, g0: G0 });
  var DATA = window.MAXQ_DATA, T = window.AS512_TRAJECTORY, D = window.AS512_FLIGHT, EARTH = window.MaxQEarth, G512 = window.AS512_GUIDANCE;
  var A = window.MaxQ.create({ S: S, isa: PF.isa, g0: G0, isaTop: { R0: PF.ISA_R0, HMAX: PF.ISA_H_MAX }, earth: EARTH, aero: window.SATURN_V_AXIAL_FORCE, engines34: DATA.engines34, as512: D, trajectory: T });
  var CL = window.ClosedLoop, C = CL.create({ A: A, S: S, earth: EARTH, trajectory: T, guidance512: G512, parking: window.AsterParking });
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg', T0 = A.as512T0(), RE = C.constants.RE, ATM = C.constants.ATM_TOP;

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
  function sv(tag, attrs, text) { var e = document.createElementNS(SVGNS, tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function fmt(v, d) {
    if (!(typeof v === 'number' && isFinite(v))) return '-';
    var a = Math.abs(v);
    if (d == null) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
    if (a < 0.5 * Math.pow(10, -d)) v = 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function sgn(v, d) { var r = Math.pow(10, -(d == null ? 2 : d)) / 2; if (Math.abs(v) < r) v = 0; return (v >= 0 ? '+' : '−') + fmt(Math.abs(v), d); }
  function b64e(str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { var t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var bin = atob(t), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------------------ state
  var PRESETS = {
    as512: { label: 'Saturn V AS-512 (Apollo 17), as flown (ideas 34 and 35)', make: function () { return C.setup(DATA.as512); } },
    sample: { label: 'Idea 34\'s sample stack, flown as idea 35\'s sample', make: function () {
      // idea 35's sample flight (its build-sample.mjs): idea 34's sample, a 1-degree kick, a 4 m diameter, the linear
      // upper programme solved for a level burnout
      var c = C.setup(DATA.sample34); if (c.refusal) return c;
      c.plan.kickDeg = 1; c.plan.diameter = 4; c.plan.upper = { mode: 'linear', startDeg: 0, endDeg: 0 };
      var s = A.solveInsertion(c.veh, c.engines, c.plan); if (!s.refusal) c.plan.upper.startDeg = s.pitchDeg;
      c.h35 = null; c.target = C.defaultTarget(c.veh, c.plan); return c;
    } },
  };
  var state = { preset: 'as512', metric: 'alt', mcview: 'orbit', cursor: null, scaleMode: 'as512', sigmas: null, gen: 0 };
  var cur = { ctx: null, R: null, mc: null, mcRes: null, sens: null, handoff: null };

  function loadPreset(id) {
    var c = PRESETS[id].make();
    if (c.refusal) { $('vehSource').textContent = 'Refused: ' + c.refusal.reason; return; }
    state.preset = id; useCtx(c);
  }
  function useCtx(c) {
    cur.ctx = c; state.cursor = null; state.sigmas = null; cur.sens = null;
    fillVehicleSelect(); syncControls(); compute();
  }
  function fillVehicleSelect() {
    var s = $('vehicle'); s.innerHTML = '';
    Object.keys(PRESETS).forEach(function (k) { s.appendChild(el('option', { value: k, text: PRESETS[k].label })); });
    s.value = state.preset;
  }
  function isAS() { return C.isAS512(cur.ctx.veh); }
  function syncControls() {
    var c = cur.ctx, t = c.target;
    $('perNum').value = +(t.perigeeAlt / 1000).toFixed(3); $('apoNum').value = +(t.apogeeAlt / 1000).toFixed(3);
    $('incNum').value = +t.inclinationDeg.toFixed(4); $('incRange').value = t.inclinationDeg;
    var lat = Math.abs(c.plan.site.latitudeDeg); $('incRange').min = Math.floor(lat); $('incRange').max = Math.max(60, Math.ceil(lat) + 30);
    document.querySelectorAll('[data-branch]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.branch === t.branch)); });
    $('startNum').value = +c.guidance.startAfter.toFixed(3); $('cycleSel').value = String(c.guidance.cycle);
    $('kickNum').value = +c.plan.kickDeg.toFixed(4); $('kickRange').value = c.plan.kickDeg;
    $('tgtFlight').disabled = !isAS();
    $('kickNote').textContent = (c.plan.fitKick && isAS() ? 'The kick is idea 35\'s fit to Table 4-2\'s S-IC cutoff angle (20.429 deg). ' : '') + 'Move it to see the first stage end lofted or flat: guidance takes it from there, the open loop does not.';
    var v = c.veh;
    $('vehSource').textContent = isAS() ? 'Every mass and event from NASA\'s flight report via idea 34; first stage as idea 35 flies it (F-1 at the flight-average flow, kick fitted); guidance starts 42.9 s after S-IC cutoff, as the flight\'s IGM did (Table 2-2 item 36).'
      : (v.label || 'A vehicle') + ': masses assumed in idea 34; first stage as idea 35 flies it; the default target is Aster\'s parking orbit (delta-v.ts, 6,578.137 km radius).';
  }

  // ------------------------------------------------------------------ compute and render
  function compute() {
    state.gen++; cur.mc = null; cur.mcRes = null;
    cur.R = C.run(cur.ctx, { samples: true });
    renderTarget(); renderResults(); drawChart(); renderRecord(); renderSigmas(); renderMC(); renderTornado(); buildHandoff();
  }
  function tile(k, v, u, conf, sub, cls) {
    return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [el('div', { class: 'k', text: k }), el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: u }) : null]), sub ? el('div', { class: 'sub', html: sub }) : null, conf ? el('span', { class: 'c', text: conf }) : null]);
  }
  function refusalBox(r) { return el('div', { class: 'refusal' }, [el('b', { text: (r.applies_to ? r.applies_to + ': ' : '') + 'refused (' + r.code + ')' }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]); }
  function renderTarget() {
    var t = cur.R.target, p = $('tgtLine');
    if (t.refusal) { p.textContent = 'Target refused: ' + t.refusal.reason; return; }
    p.textContent = 'Insertion at perigee: ' + fmt(t.rd / 1000, 1) + ' km from Earth\'s centre at ' + fmt(t.vd, 1) + ' m/s, flight-path angle 0; the plane passes over the pad at liftoff heading ' + fmt(t.inertialAzimuthDeg, 2) + ' deg in space (' + fmt(t.groundAzimuthDeg, 2) + ' deg over the ground at that speed; idea 35 launches on ' + fmt(cur.ctx.plan.azimuthDeg, 3) + ' deg).';
  }
  function renderResults() {
    var R = cur.R, g = R.guided, rf = $('refusals'), tl = $('tiles'), tb = $('stageTable');
    rf.innerHTML = ''; tl.innerHTML = ''; tb.innerHTML = ''; $('warnings').textContent = '';
    (g.refusals || []).forEach(function (x) { rf.appendChild(refusalBox(x)); });
    var ol = R.openLoop, olIn = ol.ok && !(ol.refusals || []).some(function (x) { return x.applies_to === 'orbit'; });
    if (!g.ok) {
      tl.appendChild(tile('Guided', 'refused', '', null, 'See above.', 'refused'));
      tl.appendChild(tile('Open loop (idea 35)', olIn ? fmt(ol.orbit.perigeeAlt / 1000, 0) + ' × ' + fmt(ol.orbit.apogeeAlt / 1000, 0) : 'not in orbit', olIn ? 'km' : '', 'derived', ol.ok ? 'burnout ' + fmt(ol.final.altitude / 1000, 1) + ' km, ' + fmt(ol.final.speed, 0) + ' m/s' : 'refused'));
      return;
    }
    var o = g.orbit, e = g.errors, ge = g.guided;
    tl.appendChild(tile('Orbit reached', o.bound && g.inOrbit ? fmt(o.perigeeAlt / 1000, 2) + ' × ' + fmt(o.apogeeAlt / 1000, 2) : 'not in orbit', o.bound && g.inOrbit ? 'km' : '', 'derived', 'perigee × apogee at ' + fmt(o.inclinationDeg, 4) + ' deg; target ' + fmt(R.target.perigeeAlt / 1000, 1) + ' × ' + fmt(R.target.apogeeAlt / 1000, 1), 'hero'));
    tl.appendChild(tile('Off target at cutoff', fmt(e.radius, 3) + ' m', '', 'derived', 'speed ' + sgn(e.speed * 1000, 3) + ' mm/s, flight-path angle ' + sgn(e.fpaDeg, 5) + ' deg, plane ' + fmt(e.planeDeg, 6) + ' deg'));
    tl.appendChild(tile('Cutoff', fmt(g.t, 1), 's', 'derived', ge.label + ' after ' + fmt(ge.burnTime, 1) + ' s, ended by ' + (g.endedBy === 'guidance' ? 'guidance (energy reached)' : g.endedBy)));
    tl.appendChild(tile(ge.label + ' propellant', fmt(ge.propellantUsed / 1000, 2), 't', 'derived', 'burned; ' + fmt(ge.propellantLeft / 1000, 2) + ' t left for later burns' + (isAS() ? ' (the flight burned ' + fmt(ge.propellantOwn / 1000, 2) + ' t here)' : '')));
    tl.appendChild(tile('Open loop (idea 35)', olIn ? fmt(ol.orbit.perigeeAlt / 1000, 0) + ' × ' + fmt(ol.orbit.apogeeAlt / 1000, 0) : 'not in orbit', olIn ? 'km' : '', 'derived', ol.ok ? 'its linear programme: burnout ' + fmt(ol.final.altitude / 1000, 1) + ' km, ' + fmt(ol.final.speed, 0) + ' m/s, ' + fmt(R.target.vd - ol.final.speed, 0) + ' m/s short of the target speed' : 'refused', olIn ? '' : 'refused'));
    tl.appendChild(tile('Guidance', fmt(g.cycles.length, 0), 'cycles', 'derived', 'first time-to-go ' + fmt(g.cycles.length ? g.cycles[0].tgo : NaN, 1) + ' s; steering frozen ' + fmt(g.t - (g.terminalAt != null ? g.cycles[g.cycles.length - 1].t : g.t), 1) + ' s before cutoff'));
    tl.appendChild(tile('Lost to gravity', fmt(g.lossesRel.gravity, 0), 'm/s', 'derived', 'to cutoff; steering ' + fmt(g.lossesRel.steering, 0) + ', drag ' + fmt(g.lossesRel.drag, 1) + ' (idea 35\'s budget, against the ground speed)'));
    var head = ['Cutoff', 'Time', 'Altitude', 'Speed', 'Flight-path angle', 'Mass', 'Ended by'];
    tb.appendChild(el('caption', { class: 'small', text: 'At each cutoff of the guided flight: time from liftoff, height above the sphere, inertial speed, flight-path angle, mass, and what ended the burn.' }));
    tb.appendChild(el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))]));
    var body = el('tbody');
    g.stageEnds.forEach(function (x) {
      var s = x.state;
      body.appendChild(el('tr', {}, [el('td', { 'data-k': 'Cutoff', text: x.label + (cur.ctx.veh.stages[x.stage].burns.length > 1 ? ' burn ' + (x.burn + 1) : '') }), el('td', { 'data-k': 'Time', class: 'n', text: fmt(x.t, 2) + ' s' }),
        el('td', { 'data-k': 'Altitude', class: 'n', text: fmt(s.altitude / 1000, 2) + ' km' }), el('td', { 'data-k': 'Speed', class: 'n', text: fmt(s.speed, 1) + ' m/s' }),
        el('td', { 'data-k': 'Flight-path angle', class: 'n', text: fmt(s.fpaDeg, 3) + ' deg' }), el('td', { 'data-k': 'Mass', class: 'n', text: fmt(s.mass / 1000, 1) + ' t' }),
        el('td', { 'data-k': 'Ended by', text: x.stage === 0 ? 'depletion (open loop, idea 35)' : x.endedBy })]));
    });
    tb.appendChild(body);
    $('warnings').textContent = (g.warnings || []).map(function (x) { return x.applies_to + ': ' + x.reason; }).join(' ');
  }

  // ------------------------------------------------------------------ charts
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
    var px = x / vb.width * r.width, py = y / vb.height * r.height, w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(0, px + 12), wrap.width - w - 2) + 'px'; tip.style.top = Math.max(0, py - 40) + 'px';
  }
  function flightPts(kind) {
    if (!isAS()) return [];
    var X = T.cutoff, out = [];
    [['sicOeco', 'S-IC outboard cutoff'], ['siiCeco', 'S-II centre cutoff'], ['siiOeco', 'S-II cutoff'], ['sivb1Gcs', 'S-IVB first cutoff']].forEach(function (k) {
      var c = X[k[0]]; out.push([c.t - T0, kind === 'alt' ? c.altKm : c.v / 1000, k[1] + ' (Table 4-2)']);
    });
    return out;
  }
  var METRICS = {
    alt: { yl: 'Altitude (km)', g: function (s) { return s.h / 1000; }, o: function (s) { return s.h / 1000; }, flight: function () { return flightPts('alt'); }, ref: function () { var t = cur.R.target; return t.refusal ? null : t.perigeeAlt / 1000; },
      cap: 'Height above the sphere. Blue: guided; orange dashed: idea 35\'s open-loop programme on the same first stage; round points: Apollo 17\'s cutoffs (Table 4-2, geodetic); grey dashes: the target\'s perigee height.' },
    pitch: { yl: 'Thrust pitch (deg)', g: function (s) { return s.pitch; }, flight: function () { return []; },
      cap: 'The commanded thrust direction above the local horizontal while an engine burns (held from first-stage cutoff until guidance starts). Linear-tangent steering turns it down almost linearly; the steps are the guidance cycles.' },
    yaw: { yl: 'Thrust out of plane (deg)', g: function (s) { return s.yaw; }, flight: function () { return []; },
      cap: 'How far the thrust points out of the target plane: the yaw that moves the vehicle from idea 35\'s launch plane into the target\'s. Zero means in plane.' },
    v: { yl: 'Speed (km/s)', g: function (s) { return s.v / 1000; }, o: function (s) { return s.v / 1000; }, flight: function () { return flightPts('v'); }, ref: function () { var t = cur.R.target; return t.refusal ? null : t.vd / 1000; },
      cap: 'Inertial speed. Round points: the flight\'s space-fixed speeds at its cutoffs (Table 4-2); grey dashes: the target insertion speed.' },
    tgo: { yl: 'Time to go (s)', cycles: true, flight: function () { return []; },
      cap: 'Guidance\'s estimate of the time to cutoff at each cycle (points), against the time that was actually left (dashed). They meet when the prediction is right; the jumps are staging and the S-II centre engine cutoff, which the estimate knows about only from the nominal model.' },
  };
  function series() {
    var m = METRICS[state.metric], g = cur.R.guided, ol = cur.R.openLoop, out = [];
    if (m.cycles) {
      if (g.ok || g.cycles) { var cy = g.cycles || [], tc = g.t; out.push({ cls: 's1', pts: cy.map(function (c) { return [c.t, c.tgo, c]; }), dots: true }); if (g.ok) out.push({ cls: 's4 dash', pts: cy.map(function (c) { return [c.t, tc - c.t]; }) }); }
      return out;
    }
    if (g.samples && g.samples.length) out.push({ cls: 's1', pts: g.samples.filter(function (s) { return m.g(s) != null && isFinite(m.g(s)); }).map(function (s) { return [s.t, m.g(s), s]; }) });
    if (m.o && ol.samples && ol.samples.length) out.push({ cls: 's2 dash', pts: ol.samples.filter(function (s) { return s.t >= (g.stage1 ? g.stage1.t : 0) - 5; }).map(function (s) { return [s.t, m.o(s)]; }) });
    return out;
  }
  function drawChart() {
    var svg = $('chart'); svg.innerHTML = ''; $('tip').style.display = 'none'; $('legend').innerHTML = '';
    var m = METRICS[state.metric], sr = series(), fl = m.flight();
    var all = []; sr.forEach(function (s) { s.pts.forEach(function (p) { all.push(p); }); });
    if (all.length < 2) { $('cap').textContent = 'Nothing to draw: the guided flight is refused.'; svg._pts = null; return; }
    var g = geom(svg, 320, 300), xs = all.map(function (p) { return p[0]; }).concat(fl.map(function (p) { return p[0]; })), ys = all.map(function (p) { return p[1]; }).concat(fl.map(function (p) { return p[1]; }));
    var rv = m.ref ? m.ref() : null; if (rv != null) ys.push(rv);
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs), ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys), pad = (ymax - ymin) * 0.06 || 1;
    ymin -= pad; ymax += pad;
    var X = scale(xmin, xmax, g.l, g.W - g.r, function (v) { return fmt(v, 0); }), Y = scale(ymin, ymax, g.H - g.b, g.t, function (v) { return Math.abs(ymax - ymin) < 5 ? fmt(v, 1) : fmt(v, 0); });
    axes(svg, X, Y, 'Time from liftoff (s)', m.yl, ticks(xmin, xmax, g.W < 600 ? 4 : 7), ticks(ymin, ymax, 5));
    if (rv != null) svg.appendChild(sv('line', { class: 'refline', x1: X.r[0], x2: X.r[1], y1: Y.s(rv), y2: Y.s(rv) }));
    sr.forEach(function (s) {
      if (s.dots) { s.pts.forEach(function (p) { svg.appendChild(sv('circle', { class: 'dot1', cx: X.s(p[0]), cy: Y.s(p[1]), r: 2.5 })); }); return; }
      var d = ''; s.pts.forEach(function (p) { d += (d ? 'L' : 'M') + X.s(p[0]).toFixed(1) + ',' + Y.s(p[1]).toFixed(1); });
      svg.appendChild(sv('path', { class: 'line ' + s.cls, d: d }));
    });
    fl.forEach(function (p) { svg.appendChild(sv('circle', { class: 'flight', cx: X.s(p[0]), cy: Y.s(p[1]), r: 5 })).appendChild(sv('title', {}, p[2])); });
    var pts = sr[0] ? sr[0].pts : [];
    svg._X = X; svg._pts = pts;
    var c = state.cursor != null ? Math.min(state.cursor, pts.length - 1) : null;
    if (c != null && pts[c]) {
      var p = pts[c], cx = X.s(p[0]), cy = Y.s(p[1]), s = p[2] || {};
      svg.appendChild(sv('line', { class: 'cursor', x1: cx, x2: cx, y1: g.t, y2: g.H - g.b }));
      svg.appendChild(sv('circle', { class: 'dot1', cx: cx, cy: cy, r: 5 }));
      var html = fmt(p[0], 1) + ' s: ' + fmt(p[1], 2) + ' ' + m.yl.replace(/.*\((.*)\)/, '$1');
      if (s.h != null) html += '<br>' + fmt(s.h / 1000, 2) + ' km, ' + fmt(s.v, 0) + ' m/s<br>stage ' + (s.stage + 1) + (s.pitch != null ? ', pitch ' + fmt(s.pitch, 2) + ' deg' : '');
      if (s.vgo != null) html += '<br>velocity to gain ' + fmt(s.vgo, 0) + ' m/s';
      showTip($('tip'), svg, cx, cy, html);
    }
    var lg = $('legend');
    lg.appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color: var(--s1)' }), m.cycles ? 'guidance\'s time to go' : 'guided (UPFG)']));
    if (m.o) lg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--s2)' }), 'open loop (idea 35\'s programme)']));
    if (m.cycles) lg.appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--muted)' }), 'time actually left']));
    if (fl.length) lg.appendChild(el('li', {}, [el('span', { class: 'key flight' }), 'Apollo 17, as reconstructed']));
    $('cap').textContent = m.cap;
  }
  function pick(evt) { var svg = $('chart'); if (!svg._pts || !svg._pts.length) return; var p = svgPoint(svg, evt), x = svg._X.inv(p.x), best = 0; svg._pts.forEach(function (q, i) { if (Math.abs(q[0] - x) < Math.abs(svg._pts[best][0] - x)) best = i; }); state.cursor = best; drawChart(); }

  // ------------------------------------------------------------------ dispersions and Monte Carlo
  function baseTable() { return C.dispersionTable(cur.ctx.veh); }
  function scaleFactor() { return state.scaleMode === 'msfc' ? C.msfcScale(cur.ctx, baseTable()).scale : 1; }
  function effTable() {
    if (!state.sigmas) { var k = scaleFactor(); state.sigmas = baseTable().map(function (r) { return Object.assign({}, r, { sigma: r.sigma * k }); }); }
    return state.sigmas;
  }
  function renderSigmas() {
    var tb = $('sigTable'); tb.innerHTML = '';
    tb.appendChild(el('thead', {}, [el('tr', {}, ['Dispersion', 'One sigma (%)', 'Source of its size'].map(function (h) { return el('th', { text: h }); }))]));
    var body = el('tbody');
    effTable().forEach(function (r, i) {
      var id = 'sig' + i, inp = el('input', { id: id, type: 'number', min: '0', max: '20', step: '0.001', inputmode: 'decimal', value: String(+(100 * r.sigma).toFixed(4)), 'aria-label': r.label + ', one sigma, percent' });
      inp.addEventListener('change', function () {
        if (!this.isConnected || !state.sigmas) return; // a table being redrawn
        var x = this.value.trim() === '' ? NaN : +this.value, tbl = effTable();
        if (isFinite(x) && x >= 0) { tbl[i].sigma = x / 100; tbl[i].edited = true; staleMC(); } else this.value = String(+(100 * tbl[i].sigma).toFixed(4));
      });
      body.appendChild(el('tr', {}, [el('td', { 'data-k': 'Dispersion', text: r.label }), el('td', { 'data-k': 'One sigma (%)' }, [inp]), el('td', { 'data-k': 'Source' }, [el('span', { class: 'why', text: (r.edited ? 'Edited here. ' : '') + r.source + (state.scaleMode === 'msfc' && !r.edited ? '; scaled' : '') })])]));
    });
    tb.appendChild(body);
  }
  function staleMC() { state.gen++; cur.mc = null; cur.mcRes = null; cur.sens = null; renderMC(); renderTornado(); buildHandoff(); $('mcStatus').textContent = 'Settings changed: fly them again.'; }
  function runMC() {
    var R = cur.R; if (!R.guided.ok) { $('mcStatus').className = 'status bad'; $('mcStatus').textContent = 'The nominal guided flight is refused: nothing to disperse.'; return; }
    var n = +$('mcN').value, seed = Math.max(1, Math.floor(+$('mcSeed').value || 1)), gen = ++state.gen;
    var mc = C.monteCarlo(cur.ctx, R, { n: n, seed: seed, sigmaScale: 1, table: effTable() });
    cur.mc = mc; cur.mcRes = null; $('mcStatus').className = 'status'; $('mcRun').disabled = true;
    var t0 = Date.now();
    (function chunk() {
      if (gen !== state.gen) { $('mcRun').disabled = false; return; }
      var done = mc.step(4);
      $('mcBar').style.width = (100 * mc.samples.length / n).toFixed(1) + '%';
      $('mcStatus').textContent = 'Flying ' + mc.samples.length + ' of ' + n + '…';
      if (!done) { setTimeout(chunk, 0); return; }
      cur.mcRes = mc.result(); $('mcRun').disabled = false;
      $('mcStatus').className = 'status ok'; $('mcStatus').textContent = n + ' flights, each closed loop and open loop, in ' + fmt((Date.now() - t0) / 1000, 1) + ' s (seed ' + seed + ').';
      renderMC(); buildHandoff();
    })();
  }
  function renderMC() {
    var svg = $('mcChart'), res = cur.mcRes, mc = cur.mc; svg.innerHTML = ''; $('mcLegend').innerHTML = ''; $('mcSummary').innerHTML = ''; $('mcTable').innerHTML = ''; $('mcTip').style.display = 'none';
    if (!res) { $('mcBar').style.width = '0%'; $('mcCap').textContent = 'Press "Fly them" to draw the scatter.'; svg._pts = null; return; }
    var g = geom(svg, 320, 300), tgt = cur.R.target, ss = mc.samples;
    if (state.mcview === 'orbit') {
      var pts = []; ss.forEach(function (s, i) { ['guided', 'replay'].forEach(function (w) { var m = s[w]; if (m.ok && m.apogee != null) pts.push({ w: w, x: m.apogee / 1000, y: m.perigee / 1000, i: i, m: m }); }); });
      var xs = pts.map(function (p) { return p.x; }).concat([tgt.apogeeAlt / 1000]), ysAll = pts.map(function (p) { return p.y; }).concat([tgt.perigeeAlt / 1000]);
      var floor = Math.max(Math.min.apply(null, ysAll), -400);
      var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs), ymin = Math.min(floor, 0), ymax = Math.max.apply(null, ysAll), px = (xmax - xmin) * 0.05 || 5, py = (ymax - ymin) * 0.05 || 5;
      var X = scale(xmin - px, xmax + px, g.l, g.W - g.r, function (v) { return fmt(v, 0); }), Y = scale(ymin - py, ymax + py, g.H - g.b, g.t, function (v) { return fmt(v, 0); });
      svg.appendChild(sv('rect', { class: 'atm', x: X.r[0], y: Y.s(ATM / 1000), width: X.r[1] - X.r[0], height: Math.max(0, Y.r[0] - Y.s(ATM / 1000)) }));
      axes(svg, X, Y, 'Apogee height (km)', 'Perigee height (km)', ticks(X.d[0], X.d[1], g.W < 600 ? 4 : 7), ticks(Y.d[0], Y.d[1], 5));
      svg.appendChild(sv('line', { class: 'atmline', x1: X.r[0], x2: X.r[1], y1: Y.s(ATM / 1000), y2: Y.s(ATM / 1000) }));
      pts.forEach(function (p) {
        var y = Math.max(p.y, Y.d[0]), cx = X.s(p.x), cy = Y.s(y);
        if (p.y < Y.d[0]) svg.appendChild(sv('path', { class: 'pt-x', d: 'M' + (cx - 3) + ',' + (cy - 3) + 'L' + (cx + 3) + ',' + (cy + 3) + 'M' + (cx + 3) + ',' + (cy - 3) + 'L' + (cx - 3) + ',' + (cy + 3) }));
        else svg.appendChild(sv('circle', { class: p.w === 'guided' ? 'pt-g' : 'pt-o', cx: cx, cy: cy, r: p.w === 'guided' ? 3.5 : 3 }));
      });
      var tx = X.s(tgt.apogeeAlt / 1000), ty = Y.s(tgt.perigeeAlt / 1000);
      svg.appendChild(sv('path', { class: 'target', d: 'M' + (tx - 7) + ',' + ty + 'L' + (tx + 7) + ',' + ty + 'M' + tx + ',' + (ty - 7) + 'L' + tx + ',' + (ty + 7) }));
      svg._pts = pts; svg._X = X; svg._Y = Y;
      $('mcLegend').appendChild(el('li', {}, [el('span', { class: 'key pt', style: 'background: var(--s1)' }), 'closed loop (all on the cross)']));
      $('mcLegend').appendChild(el('li', {}, [el('span', { class: 'key pt', style: 'background: var(--s2)' }), 'open loop, replayed on the clock']));
      $('mcLegend').appendChild(el('li', {}, [el('span', { class: 'key', style: 'border-color: var(--crit)' }), 'perigee in the atmosphere: it comes back down']));
      $('mcCap').textContent = 'Each flight\'s orbit after cutoff. The closed loop puts every one on the target (the cross) within metres; the open loop scatters by tens to hundreds of kilometres, and those below the red line (' + fmt(ATM / 1000, 0) + ' km) are not in orbit. Crosses at the bottom edge have perigees further down than the axis shows.';
    } else {
      var vals = ss.filter(function (s) { return s.guided.ok; }).map(function (s) { return s.guided.propellantLeft / 1000; }), nom = res.reserve ? res.reserve.nominalLeft / 1000 : null;
      if (!vals.length) { $('mcCap').textContent = 'No guided flight to show.'; return; }
      var lo = Math.min.apply(null, vals.concat(nom != null ? [nom] : [])), hi = Math.max.apply(null, vals.concat(nom != null ? [nom] : [])), nb = Math.max(8, Math.min(30, Math.round(Math.sqrt(vals.length) * 2)));
      if (hi - lo < 1e-6) { hi = lo + 1; }
      var w = (hi - lo) / nb, bins = new Array(nb).fill(0); vals.forEach(function (v) { bins[Math.min(nb - 1, Math.floor((v - lo) / w))]++; });
      var X2 = scale(lo - w, hi + w, g.l, g.W - g.r, function (v) { return fmt(v, 1); }), Y2 = scale(0, Math.max.apply(null, bins) * 1.1, g.H - g.b, g.t, function (v) { return fmt(v, 0); });
      axes(svg, X2, Y2, 'Propellant left in the guided stage at cutoff (t)', 'Flights', ticks(X2.d[0], X2.d[1], g.W < 600 ? 4 : 7), ticks(0, Y2.d[1], 4));
      bins.forEach(function (b, i) { if (!b) return; var x0 = X2.s(lo + i * w), x1 = X2.s(lo + (i + 1) * w); svg.appendChild(sv('rect', { class: 'hist-g', x: x0 + 0.5, y: Y2.s(b), width: Math.max(1, x1 - x0 - 1), height: Y2.r[0] - Y2.s(b) })); });
      if (nom != null) svg.appendChild(sv('line', { class: 'refline', x1: X2.s(nom), x2: X2.s(nom), y1: g.t, y2: g.H - g.b }));
      if (res.reserve) { var m3 = (res.reserve.mean - res.reserve.threeSigma) / 1000; svg.appendChild(sv('line', { class: 'atmline', x1: X2.s(m3), x2: X2.s(m3), y1: g.t, y2: g.H - g.b })); }
      svg._pts = null;
      $('mcLegend').appendChild(el('li', {}, [el('span', { class: 'key pt', style: 'background: var(--s1)' }), 'closed-loop flights']));
      $('mcLegend').appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--ink-2)' }), 'the nominal flight']));
      $('mcLegend').appendChild(el('li', {}, [el('span', { class: 'key dash', style: 'border-color: var(--crit)' }), 'mean minus three sigma']));
      $('mcCap').textContent = 'What the dispersions cost the guided stage: guidance always reaches the target, and pays for it in propellant. The gap between the nominal line and the red one is the reserve these dispersions call for (three standard deviations, assuming they are normal).';
    }
    var G = res.guided, O = res.replay, n = res.n;
    var sm = $('mcSummary');
    sm.appendChild(tile('Closed loop on target', G.onTarget + ' / ' + n, '', 'derived', 'perigee scatter ' + fmt(G.perigee.sd, 2) + ' m (one sigma)'));
    sm.appendChild(tile('Open loop in orbit', O.inOrbit + ' / ' + n, '', 'derived', 'perigee scatter ' + fmt(O.perigee.sd / 1000, 1) + ' km; ' + (n - O.flown) + ' fell back before cutoff'));
    if (res.reserve) sm.appendChild(tile('Reserve these call for', fmt(res.reserve.threeSigma, 0), 'kg', 'derived', 'three sigma of the propellant left; the worst of ' + n + ' used ' + fmt(res.reserve.worstUse, 0) + ' kg more than nominal'));
    sm.appendChild(tile('First-stage burn time', '± ' + fmt(3 * G.stage1T.sd, 2), 's (3σ)', 'derived', 'MSFC\'s pre-flight band for AS-512: +' + G512.deviations.sic.oeco3SigmaS[0] + '/' + G512.deviations.sic.oeco3SigmaS[1] + ' s (section 5.1)'));
    var tb = $('mcTable');
    tb.appendChild(el('thead', {}, [el('tr', {}, ['Quantity', 'Closed loop', 'Open loop'].map(function (h, i) { return el('th', i ? { class: 'n', text: h } : { text: h }); }))]));
    var body = el('tbody'), row = function (q, a, b) { body.appendChild(el('tr', {}, [el('td', { 'data-k': 'Quantity', text: q }), el('td', { 'data-k': 'Closed loop', class: 'n', text: a }), el('td', { 'data-k': 'Open loop', class: 'n', text: b })])); };
    var ms = function (s, k, d, u) { return s.n ? fmt(s.mean / k, d) + ' ± ' + fmt(s.sd / k, d) + ' ' + u : '-'; };
    row('Flown to cutoff', G.flown + ' / ' + n, O.flown + ' / ' + n);
    row('In orbit (perigee above ' + fmt(ATM / 1000, 0) + ' km)', G.inOrbit + ' / ' + n, O.inOrbit + ' / ' + n);
    row('Perigee height', ms(G.perigee, 1000, 3, 'km'), ms(O.perigee, 1000, 1, 'km'));
    row('Apogee height', ms(G.apogee, 1000, 3, 'km'), ms(O.apogee, 1000, 1, 'km'));
    row('Inclination', ms(G.inclination, 1, 6, 'deg'), ms(O.inclination, 1, 4, 'deg'));
    row('Radius off target at cutoff', ms(G.radiusErr, 1, 3, 'm'), ms(O.radiusErr, 1000, 2, 'km'));
    row('Speed off target at cutoff', ms(G.speedErr, 1, 5, 'm/s'), ms(O.speedErr, 1, 1, 'm/s'));
    row('Cutoff time', ms(G.cutoffT, 1, 2, 's'), ms(O.cutoffT, 1, 2, 's') + ' (timer)');
    row('Propellant left in the guided stage', ms(G.propellantLeft, 1000, 2, 't'), '-');
    tb.appendChild(body);
  }
  function pickMC(evt) {
    var svg = $('mcChart'); if (!svg._pts || !svg._pts.length) return;
    var p = svgPoint(svg, evt), best = null, bd = Infinity;
    svg._pts.forEach(function (q) { var d = Math.hypot(svg._X.s(q.x) - p.x, svg._Y.s(Math.max(q.y, svg._Y.d[0])) - p.y); if (d < bd) { bd = d; best = q; } });
    if (!best) return;
    var m = best.m;
    showTip($('mcTip'), svg, svg._X.s(best.x), svg._Y.s(Math.max(best.y, svg._Y.d[0])), 'Flight ' + (best.i + 1) + ', ' + (best.w === 'guided' ? 'closed loop' : 'open loop') + '<br>' + fmt(m.perigee / 1000, 2) + ' × ' + fmt(m.apogee / 1000, 2) + ' km' + (m.inOrbit ? '' : ' (not in orbit)') + (m.propellantLeft != null ? '<br>' + fmt(m.propellantLeft, 0) + ' kg left' : ''));
  }

  // ------------------------------------------------------------------ tornado
  function runTornado() {
    if (!cur.R.guided.ok) { $('tornStatus').textContent = 'The nominal guided flight is refused.'; return; }
    $('tornStatus').className = 'status'; $('tornStatus').textContent = 'Flying…'; $('tornRun').disabled = true;
    var gen = state.gen;
    setTimeout(function () {
      if (gen !== state.gen) { $('tornRun').disabled = false; return; }
      var t0 = Date.now();
      cur.sens = C.sensitivities(cur.ctx, cur.R, { table: effTable(), sigmaScale: 1 });
      $('tornRun').disabled = false; $('tornStatus').className = 'status ok'; $('tornStatus').textContent = (2 * cur.sens.rows.length + 1) + ' flights in ' + fmt((Date.now() - t0) / 1000, 1) + ' s.';
      renderTornado();
    }, 30);
  }
  function renderTornado() {
    var box = $('tornado'); box.innerHTML = ''; $('tornCap').textContent = '';
    var s = cur.sens; if (!s) return;
    var rows = s.rows.filter(function (r) { return r.both[0] != null || r.both[1] != null; });
    rows.sort(function (a, b) { return Math.max(Math.abs(b.both[0] || 0), Math.abs(b.both[1] || 0)) - Math.max(Math.abs(a.both[0] || 0), Math.abs(a.both[1] || 0)); });
    var max = 1; rows.forEach(function (r) { max = Math.max(max, Math.abs(r.both[0] || 0), Math.abs(r.both[1] || 0)); });
    rows.forEach(function (r) {
      var bar = el('div', { class: 'tbar' }, [el('span', { class: 'mid' })]);
      [[r.both[0], 'lo'], [r.both[1], 'hi']].forEach(function (q) {
        if (q[0] == null) return; var w = 50 * Math.abs(q[0]) / max, l = q[0] < 0 ? 50 - w : 50;
        bar.appendChild(el('span', { class: q[1], style: 'left:' + l.toFixed(2) + '%;width:' + Math.max(0.3, w).toFixed(2) + '%' }));
      });
      box.appendChild(el('div', { class: 'trow' }, [el('span', { class: 'nm', text: r.label + ' (±' + fmt(100 * r.sigma, 3) + ' %)' }), bar, el('span', { class: 'val', text: sgn(r.both[0] || 0, 0) + ' / ' + sgn(r.both[1] || 0, 0) + ' kg' })]));
    });
    $('tornCap').textContent = 'Orange: at minus one sigma; blue: at plus one sigma; right of centre leaves more propellant. Root-sum-square of the half-differences (a linear covariance): ' + fmt(s.total.propellantLeft, 0) + ' kg. A row with both bars on the left costs propellant whichever way it goes: idea 35\'s open-loop first stage is a gravity turn, so a stronger or weaker first stage ends lofted or flat and the upper stages pay to recover.';
  }

  // ------------------------------------------------------------------ against Apollo 17
  function renderRecord() {
    var tb = $('tblRecord'), sm = $('recordSummary'); tb.innerHTML = ''; sm.innerHTML = '';
    if (!isAS()) { sm.appendChild(el('p', { class: 'small', text: 'Load "Saturn V AS-512 (Apollo 17)" to compare with a real flight.' })); return; }
    var rows = C.as512Rows(cur.ctx, cur.R);
    if (!rows.length) { sm.appendChild(el('p', { class: 'small', text: 'The guided flight is refused; nothing to compare.' })); return; }
    var get = function (g, l) { return rows.filter(function (x) { return x.group === g && x.label === l; })[0]; };
    var pb = get('S-IVB first cutoff', 'Propellant burned'), lf = get('Left for the departure burn', 'S-IVB propellant'), s2 = get('S-II cutoff', 'Space-fixed velocity'), ra = get('Cutoff accuracy', 'Radius against the target');
    sm.appendChild(tile('S-IVB propellant to orbit', sgn(100 * (pb.model / pb.flight - 1), 1) + ' %', '', 'derived vs measured', fmt(pb.model, 0) + ' kg against the flight\'s ' + fmt(pb.flight, 0)));
    sm.appendChild(tile('Left for the translunar burn', sgn(lf.gap, 0), 'kg', 'derived vs measured', fmt(lf.model, 0) + ' against ' + fmt(lf.flight, 0) + ' kg burned in the flight\'s TLI'));
    sm.appendChild(tile('Speed at S-II cutoff', sgn(s2.gap, 1), 'm/s', 'derived vs measured', fmt(s2.model, 1) + ' against ' + fmt(s2.flight, 1)));
    sm.appendChild(tile('Radius at cutoff vs target', fmt(ra.model, 3), 'm', 'derived', 'the flight\'s LVDC: ' + G512.insertionVsPrediction.radiusM + ' m and ' + G512.insertionVsPrediction.velocityMs + ' m/s from its own prediction'));
    tb.appendChild(el('thead', {}, [el('tr', {}, ['Event', 'Quantity', 'Model', 'Flight', 'Gap', 'Note'].map(function (h) { return el('th', { text: h }); }))]));
    var body = el('tbody');
    rows.forEach(function (x) {
      var d = Math.abs(x.model) < 100 ? 3 : 1;
      body.appendChild(el('tr', /^Targeted/.test(x.note) ? { class: 'hl' } : {}, [el('td', { 'data-k': 'Event', text: x.group }), el('td', { 'data-k': 'Quantity', text: x.label }),
        el('td', { 'data-k': 'Model', class: 'n', text: fmt(x.model, d) + ' ' + x.units }), el('td', { 'data-k': 'Flight', class: 'n', text: fmt(x.flight, Math.abs(x.flight) < 100 ? 3 : 1) + ' ' + x.units }),
        el('td', { 'data-k': 'Gap', class: 'n', text: x.gap == null ? '-' : sgn(x.gap, Math.abs(x.gap) < 10 ? 3 : 1) + ' ' + x.units }), x.note ? el('td', { 'data-k': 'Note' }, [el('span', { class: 'why', text: x.note })]) : el('td', { class: 'nonote' })]));
    });
    tb.appendChild(body);
  }

  // ------------------------------------------------------------------ handoff
  function buildHandoff() {
    try { cur.handoff = C.makeHandoff(cur.ctx, cur.R, cur.mcRes, {}); }
    catch (e) { cur.handoff = { error: String(e) }; }
    $('exportText').value = JSON.stringify(cur.handoff, null, 1);
    $('nextLink').href = '../37-window/index.html#h=' + b64e(JSON.stringify(cur.handoff));
  }
  function decode(text) {
    var s = String(text || '').trim(), m = s.match(/(?:^|[#&?])h=([A-Za-z0-9_-]+)/);
    try { if (m) s = b64d(m[1]); return JSON.parse(s); } catch (e) { return s; }
  }
  function doImport(text, how) {
    var st = $('importStatus'), obj = decode(text);
    var c = C.setup(obj);
    if (c.refusal) { st.className = 'status bad'; st.textContent = 'Refused (' + c.refusal.code + '): ' + c.refusal.reason + ' What would help: ' + c.refusal.what_would_help; return false; }
    PRESETS.imp = { label: 'Imported: ' + (c.veh.label || 'a vehicle') + ' (from ' + obj.from + ')', make: function () { return c; } };
    state.preset = 'imp'; useCtx(c);
    st.className = 'status ok';
    st.textContent = 'Imported ' + how + ': ' + (obj.from === '36-closed-loop' ? 'a guided ascent, re-flown and matched to its own numbers.' : obj.from === '35-max-q' ? 'idea 35\'s ascent (its vehicle re-checked, its flight re-flown); the target is this page\'s default for it.' : 'idea 34\'s vehicle, its ledger re-run and matched.');
    return true;
  }

  // ------------------------------------------------------------------ wiring
  function numIn(id, set) { $(id).addEventListener('change', function () { var x = this.value.trim() === '' ? NaN : +this.value; set(x); state.cursor = null; compute(); }); }
  $('vehicle').addEventListener('change', function () { loadPreset(this.value); });
  $('tgtFlight').addEventListener('click', function () { cur.ctx.target = C.defaultTarget(cur.ctx.veh, cur.ctx.plan); syncControls(); compute(); });
  $('tgtAster').addEventListener('click', function () {
    var h = window.AsterParking.leoParkingRadius_m - RE, t = cur.ctx.target;
    cur.ctx.target = Object.assign({}, t, { perigeeAlt: h, apogeeAlt: h, source: window.AsterParking.source }); syncControls(); compute();
  });
  numIn('perNum', function (x) { cur.ctx.target = Object.assign({}, cur.ctx.target, { perigeeAlt: x * 1000, source: 'user' }); });
  numIn('apoNum', function (x) { cur.ctx.target = Object.assign({}, cur.ctx.target, { apogeeAlt: x * 1000, source: 'user' }); });
  numIn('incNum', function (x) { cur.ctx.target = Object.assign({}, cur.ctx.target, { inclinationDeg: x, source: 'user' }); $('incRange').value = x; });
  $('incRange').addEventListener('input', function () { cur.ctx.target = Object.assign({}, cur.ctx.target, { inclinationDeg: +this.value, source: 'user' }); $('incNum').value = this.value; state.cursor = null; compute(); });
  document.querySelectorAll('[data-branch]').forEach(function (b) { b.addEventListener('click', function () { cur.ctx.target = Object.assign({}, cur.ctx.target, { branch: b.dataset.branch, source: 'user' }); syncControls(); compute(); }); });
  numIn('startNum', function (x) { cur.ctx.guidance = Object.assign({}, cur.ctx.guidance, { startAfter: x }); }); // the kernel refuses a negative or empty start
  $('cycleSel').addEventListener('change', function () { cur.ctx.guidance = Object.assign({}, cur.ctx.guidance, { cycle: +this.value }); compute(); });
  numIn('kickNum', function (x) { cur.ctx.plan.kickDeg = x; cur.ctx.plan.fitKick = false; cur.ctx.h35 = null; $('kickRange').value = x; });
  $('kickRange').addEventListener('input', function () { cur.ctx.plan.kickDeg = +this.value; cur.ctx.plan.fitKick = false; cur.ctx.h35 = null; $('kickNum').value = this.value; state.cursor = null; compute(); });
  document.querySelectorAll('[data-metric]').forEach(function (b) { b.addEventListener('click', function () { state.metric = b.dataset.metric; state.cursor = null; document.querySelectorAll('[data-metric]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawChart(); }); });
  document.querySelectorAll('[data-mcview]').forEach(function (b) { b.addEventListener('click', function () { state.mcview = b.dataset.mcview; document.querySelectorAll('[data-mcview]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); renderMC(); }); });
  $('mcRun').addEventListener('click', runMC);
  $('mcScale').addEventListener('change', function () { state.scaleMode = this.value; state.sigmas = null; renderSigmas(); staleMC(); });
  $('tornRun').addEventListener('click', runTornado);
  var ch = $('chart'), drag = false;
  ch.addEventListener('pointerdown', function (e) { drag = true; ch.setPointerCapture && ch.setPointerCapture(e.pointerId); pick(e); });
  ch.addEventListener('pointermove', function (e) { if (drag) pick(e); });
  ch.addEventListener('pointerup', function () { drag = false; });
  ch.addEventListener('keydown', function (e) {
    if (!ch._pts) return; var n = ch._pts.length, c = state.cursor == null ? 0 : state.cursor, step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') c = Math.min(n - 1, c + step); else if (e.key === 'ArrowLeft') c = Math.max(0, c - step); else return;
    e.preventDefault(); state.cursor = c; drawChart();
  });
  $('mcChart').addEventListener('pointerdown', pickMC);
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
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (cur.R) { drawChart(); renderMC(); } }, 120); });

  // ------------------------------------------------------------------ how far to trust it (from the AS-512 run)
  function trust(R) {
    var rows = C.as512Rows(R.ctx, R), get = function (g, l) { return rows.filter(function (x) { return x.group === g && x.label === l; })[0]; };
    var pb = get('S-IVB first cutoff', 'Propellant burned'), s2a = get('S-II cutoff', 'Altitude'), s2v = get('S-II cutoff', 'Space-fixed velocity');
    return [
      '[Certain] The guidance does what it says, inside its envelope: over a flat Earth it lands on the minimum-time linear-tangent burn two independent Python solvers find (to 0.01 s where the optimal thrust turns through 35 deg; 1 s late at 94 deg; beyond about 100 deg at a 2 s cycle it does not converge, and the page refuses rather than claim the target); flown on AS-512 (a 42 deg turn), an independent integrator re-flying its commands with its own bookkeeping lands within millimetres; and a direct optimiser finds only about a kilogram of S-IVB propellant (0.96 kg of 32,897) it could have saved (README, Tests).',
      '[Certain as numbers] Guided to the orbit Apollo 17 reached, the chain\'s Saturn V burns ' + fmt(pb.model, 0) + ' kg of S-IVB propellant where the flight burned ' + fmt(pb.flight, 0) + ' (' + sgn(100 * (pb.model / pb.flight - 1), 1) + ' %), and reaches S-II cutoff ' + fmt(Math.abs(s2a.gap), 1) + ' km lower and ' + fmt(Math.abs(s2v.gap), 0) + ' m/s slower than the flight. Idea 33\'s J-2 at mixture ratio 5.5 (the flight shifted to 4.8 in the S-II and ran the S-IVB at 5.0) and idea 35\'s gravity-turn first stage are the likely reasons [Likely].',
      '[Certain] Navigation is perfect here and the vehicle is exactly its own model on the nominal flight, so cutoff lands within centimetres of the target; the real one landed 30.8 m and 0.20 m/s from its prediction (section 9.3).',
      '[Speculative] The dispersion sizes: one flight\'s deviations from its prediction, used as one sigma, or scaled to one published three-sigma band. They are inputs to explore, not a Saturn V dispersion analysis.',
    ];
  }

  // ------------------------------------------------------------------ start
  var hash = location.hash || '';
  if (!(/[#&]h=/.test(hash) && doImport(hash, 'from the link'))) loadPreset('as512');
  (function () { var ctx = state.preset === 'as512' ? cur.ctx : C.setup(DATA.as512), R = state.preset === 'as512' ? cur.R : C.run(ctx, { samples: false }); R.ctx = ctx; trust(R).forEach(function (t) { $('trustList').appendChild(el('li', { text: t })); }); })();
  window.__closed = { A: A, C: C, state: state, cur: cur, PRESETS: PRESETS, b64e: b64e, runMC: runMC, runTornado: runTornado };
})();
