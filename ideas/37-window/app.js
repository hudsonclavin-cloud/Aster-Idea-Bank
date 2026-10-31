/* Window page: wires the controls to the kernel (window.js over idea 36's closedloop.js) and draws. No network. */
(function () {
  'use strict';
  var PF = window.PartForgeISA, G0 = PF.ISA_G0;
  var S = window.Stack.create({ E: null, isa: PF.isa, g0: G0 });
  var DATA = window.MAXQ_DATA, T512 = window.AS512_TRAJECTORY, EARTH = window.MaxQEarth, AP = window.APOLLO17_WINDOW;
  var A = window.MaxQ.create({ S: S, isa: PF.isa, g0: G0, isaTop: { R0: PF.ISA_R0, HMAX: PF.ISA_H_MAX }, earth: EARTH, aero: window.SATURN_V_AXIAL_FORCE, engines34: DATA.engines34, as512: window.AS512_FLIGHT, trajectory: T512 });
  var C = window.ClosedLoop.create({ A: A, S: S, earth: EARTH, trajectory: T512, guidance512: window.AS512_GUIDANCE, parking: window.AsterParking });
  var W = window.LaunchWindow.create({ C: C, erfa: window.WindowERFA, naif: window.WindowNAIF, aster: window.WindowAster, apollo17: AP, apophis: window.AsterApophis, earth: EARTH, trajectory: T512 });
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg', DEG = Math.PI / 180;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
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
  function sgn(v, d) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d); }
  function hms(ms) { return new Date(Math.round(ms)).toISOString().slice(11, 19); }
  function dur(s) { var h = Math.floor(s / 3600), m = Math.round((s - 3600 * h) / 60); if (m === 60) { h++; m = 0; } return h + ' h ' + m + ' min'; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function b64e(str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { var t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var bin = atob(t), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function tile(k, v, u, conf, sub, cls) {
    return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [el('div', { class: 'k', text: k }), el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: u }) : null]), sub ? el('div', { class: 'sub', text: sub }) : null, conf ? el('span', { class: 'c', text: conf }) : null]);
  }
  function refusalBox(r) { return el('div', { class: 'refusal' }, [el('b', { text: (r.applies_to ? r.applies_to + ': ' : '') + 'refused (' + r.code + ')' }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]); }

  // ------------------------------------------------------------------ vehicles (idea 36's handoffs, made here)
  var PRODUCED = '2026-10-31T12:00:00Z';
  function h36From(ctx) { var R = C.run(ctx, { samples: false }); return C.makeHandoff(ctx, R, null, { produced: PRODUCED }); }
  var VEH = {
    as512: { label: 'Saturn V AS-512 to Apollo 17\'s parking orbit (idea 36\'s page)', make: function () { return h36From(C.setup(DATA.as512)); } },
    sample: { label: 'Idea 34\'s sample stack to Aster\'s parking orbit (idea 36\'s sample flight)', make: function () {
      var c = C.setup(DATA.sample34); if (c.refusal) return c;
      c.plan.kickDeg = 1; c.plan.diameter = 4; c.plan.upper = { mode: 'linear', startDeg: 0, endDeg: 0 };
      var s = A.solveInsertion(c.veh, c.engines, c.plan); if (!s.refusal) c.plan.upper.startDeg = s.pitchDeg;
      c.h35 = null; c.target = C.defaultTarget(c.veh, c.plan); return h36From(c);
    } },
  };
  var state = { veh: 'as512', preset: 'apophis', st: null, spec: null, set: null, R: null, handoff: null, apollo: null };

  function useVehicle(key) {
    state.veh = key;
    var h = VEH[key].make();
    if (h.refusal) { showStatus('bad', 'Refused: ' + h.refusal.reason); return; }
    var st = W.importClosedLoop(h);
    if (st.refusal) { showStatus('bad', 'Refused: ' + st.refusal.reason); return; }
    state.st = st;
    var d = W.defaults(st.siteId);
    state.set = Object.assign(d, state.set ? { corridor: state.set.corridor, coast: state.set.coast, j2: state.set.j2, lonDeg: state.set.lonDeg, lonSource: state.set.lonSource } : {});
  }
  function syncVehicles() {
    var s = $('vehicle'); s.textContent = '';
    Object.keys(VEH).forEach(function (k) { s.appendChild(el('option', { value: k, text: VEH[k].label })); });
    s.value = state.veh;
  }
  function presetApophis() { state.preset = 'apophis'; state.spec = W.apophisSpec(); state.set.j2 = true; delete state.set.launchUtc; }
  function presetApollo() { var p = W.apollo17Preset(); state.preset = 'apollo'; state.spec = p.spec; Object.assign(state.set, p.settings, { coast: Object.assign({}, state.set.coast) }); }

  // ------------------------------------------------------------------ compute and render
  function compute() {
    state.R = W.compute(state.st, state.spec, state.set);
    syncControls(); render();
  }
  /** Move the launch inside the current windows without re-scanning the day. */
  function relaunch() {
    var R = state.R; if (!R || !R.windows || !R.windows.length) return;
    var w = R.windows[Math.min(R.windows.length - 1, state.set.opportunity | 0)], ms = Math.round(w.openMs + (w.closeMs - w.openMs) * state.set.fraction);
    var sf = W.solveFlown(R.env, ms, state.st.ctx, state.st.prof);
    R.refusal = sf.refusal || null; R.launch = sf.solve || null; R.flight = sf.flight || null;
    R.departure = sf.refusal ? null : W.departureOf(sf.solve, R.env);
    // the delta-v the propellant buys, and its refusal, belong to the moment (as the kernel's compute() does)
    R.capacity = sf.refusal ? null : W.capacityOf(state.st.ctx, sf.flight);
    R.refusals = (R.refusals || []).filter(function (x) { return x.applies_to !== 'departure_propellant'; });
    var cr = W.capacityRefusal(R.capacity, R.departure); if (cr) R.refusals.push(cr);
    $('fracRange').value = state.set.fraction;
    render();
  }
  function render() { renderSource(); renderVerdict(); renderTiles(); drawAz(); drawPerf(); drawSky(); buildHandoff(); }
  function renderSource() {
    var st = state.st, o = st.h36.outputs, po = o.parking_orbit.value, pr = o.propellant_left_in_guided_stage.value;
    $('vehSource').textContent = 'Parking orbit ' + fmt(po.perigee_altitude_m / 1000, 1) + ' × ' + fmt(po.apogee_altitude_m / 1000, 1) + ' km, flown into a plane leaving the pad on ' + fmt(st.azFlownDeg, 3) + '° (inclination ' + fmt(po.inclination_deg, 3) + '°) from latitude ' + fmt(st.latDeg, 2) + '°; ' + fmt(pr, 0) + ' kg left in the guided stage. Insertion ' + fmt(st.prof.t, 1) + ' s after liftoff, ' + fmt(st.prof.theta1 / DEG, 2) + '° down range.';
    var a = state.R && state.R.asym;
    $('asySource').textContent = a ? (a.mode === 'target' ? 'Target vector (C3 ≤ 0): ' : 'Asymptote: ') + 'v∞ ' + fmt(a.vinf / 1000, 3) + ' km/s, RLA ' + fmt(a.rlaDeg, 2) + '°, DLA ' + fmt(a.dlaDeg, 2) + '° (J2000). ' + a.source : '';
    $('siteNote').textContent = 'Latitude ' + fmt(st.latDeg, 2) + '° is the one idea 35 flew from (Aster\'s Cape Canaveral, on a sphere). Longitude: ' + (state.set.lonSource || 'typed') + '.';
  }
  function renderVerdict() {
    var R = state.R, v = $('verdict'), ab = R.aster, a = R.asym;
    v.className = 'verdict' + (ab ? ' ' + ab.cls.toLowerCase() : '');
    if (!a) { v.textContent = ''; return; }
    var day = R.windows && R.windows.length ? R.windows.length + ' window' + (R.windows.length > 1 ? 's' : '') + ' on ' + a.dateUtc + ': ' + R.windows.map(function (w) { return hms(w.openMs) + '–' + hms(w.closeMs) + ' UTC (' + dur(w.duration) + ')'; }).join(', ')
      : R.refusal && R.refusal.applies_to !== 'window' ? 'not computed (' + R.refusal.applies_to + ' refused, below)' : 'no launch window on ' + a.dateUtc;
    var lim = Math.abs(a.dlaDeg) > state.st.latDeg ? ' The declination is beyond the latitude, so only azimuths within ' + fmt(Math.asin(Math.min(1, Math.cos(a.dlaDeg * DEG) / Math.cos(state.st.latDeg * DEG))) / DEG, 1) + '° of north or of south are reachable (eq. 14).' : '';
    v.textContent = (ab ? 'Aster\'s screen: ' + ab.cls + ' (|DLA| ' + fmt(Math.abs(a.dlaDeg), 2) + '° against ' + ab.iMinDeg + '° and ' + ab.ceilingDeg + '°). ' : '') + 'This day: ' + day + '.' + lim;
  }
  function renderTiles() {
    var R = state.R, t = $('tiles'), rf = $('refusals'), seg = $('oppSeg');
    t.textContent = ''; rf.textContent = ''; seg.textContent = '';
    if (R.refusal) rf.appendChild(refusalBox(R.refusal));
    (R.refusals || []).forEach(function (x) { rf.appendChild(refusalBox(x)); });
    (R.windows || []).forEach(function (w, i) {
      var b = el('button', { type: 'button', 'aria-pressed': String((state.set.opportunity | 0) === i && !state.set.launchUtc), text: 'Window ' + (i + 1) + ' ' + hms(w.openMs).slice(0, 5) + '–' + hms(w.closeMs).slice(0, 5) });
      b.addEventListener('click', function () { state.set.opportunity = i; delete state.set.launchUtc; relaunch(); });
      seg.appendChild(b);
    });
    var s = R.launch;
    $('fracOut').textContent = s && s.T ? hms(s.ms) + ' UTC' : '';
    if (!s || R.refusal) return;
    var f = R.flight, d = R.departure, w0 = R.windows[Math.min(R.windows.length - 1, state.set.opportunity | 0)], nj = R.windowsNoJ2 && R.windowsNoJ2[Math.min(R.windowsNoJ2.length - 1, state.set.opportunity | 0)];
    var due = state.st.h36.outputs.propellant_left_in_guided_stage.value;
    t.appendChild(tile('Launch', hms(s.ms), 'UTC', 'derived', s.T.utc.slice(0, 10) + ', TDB ' + fmt(s.T.tdb, 1) + ' s past J2000', 'hero'));
    t.appendChild(tile('Azimuth', fmt(s.azDeg, 3), '°', 'derived', 'corridor ' + state.set.corridor[0] + '–' + state.set.corridor[1] + '°'));
    t.appendChild(tile('Inclination', fmt(s.inclinationDeg, 3), '°', 'derived', 'mean equator of date'));
    var el2 = W.elementsOf(W.mtxv(s.T.P, s.ins.r), W.mtxv(s.T.P, s.ins.v));
    t.appendChild(tile('Ascending node', fmt(el2.raanDeg, 3), '°', 'derived', 'J2000, at insertion'));
    t.appendChild(tile('Coast', fmt(s.ev.t / 60, 1), 'min', 'derived', (s.ev.revs ? s.ev.revs + ' extra revolution(s); ' : '') + 'limit ' + fmt(state.set.coast.max / 3600, 2) + ' h'));
    t.appendChild(tile('J2 aim', sgn(s.psiDeg, 3), '°', 'derived', nj && w0 ? 'moves the window ' + sgn((w0.openMs - nj.openMs) / 1000, 1) + ' s' : 'J2 off'));
    if (d) {
      t.appendChild(tile('Departure', hms(s.ms + (s.prof.t + s.ev.t) * 1000), 'UTC', 'derived', 'altitude ' + fmt((d.rn - W.constants.RE) / 1000, 1) + ' km'));
      t.appendChild(tile('Impulsive Δv', fmt(d.dv, 0), 'm/s', 'derived', 'v∞ ' + fmt(R.asym.vinf, 0) + ' m/s; ν∞ ' + fmt(d.nuInfDeg, 2) + '°'));
    }
    if (f) t.appendChild(tile('Propellant left', fmt(f.propellant, 0), 'kg', 'derived', sgn(f.propellant - due, 0) + ' kg against the ' + fmt(state.st.azFlownDeg, 2) + '° flight'));
    var cap = R.capacity;
    if (cap) t.appendChild(tile('Δv it buys', fmt(cap.dv, 0), 'm/s', 'derived', 'ideal, ' + cap.engine + ' at ' + fmt(cap.ve, 0) + ' m/s' + (d ? '; ' + (cap.dv >= d.dv ? 'covers' : 'short of') + ' the ' + fmt(d.dv, 0) + ' m/s' : ''), d && cap.dv < d.dv ? 'short' : null));
  }

  // ------------------------------------------------------------------ charts
  function frame(svg, x0, x1, y0, y1, W0, H0, m) {
    svg.textContent = '';
    var sx = function (x) { return m.l + (x - x0) / (x1 - x0) * (W0 - m.l - m.r); }, sy = function (y) { return H0 - m.b - (y - y0) / (y1 - y0) * (H0 - m.t - m.b); };
    return { sx: sx, sy: sy, ix: function (px) { return x0 + (px - m.l) / (W0 - m.l - m.r) * (x1 - x0); } };
  }
  function ticks(a, b, n) { var step = Math.pow(10, Math.floor(Math.log10((b - a) / n))), out = []; [1, 2, 2.5, 5, 10].some(function (k) { if ((b - a) / (step * k) <= n) { step *= k; return true; } return false; }); for (var v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6)); return out; }
  function axes(svg, f, xt, yt, xl, yl, W0, H0, m) {
    yt.forEach(function (y) { svg.appendChild(sv('line', { class: 'grid', x1: m.l, x2: W0 - m.r, y1: f.sy(y), y2: f.sy(y) })); svg.appendChild(sv('text', { x: m.l - 6, y: f.sy(y) + 4, 'text-anchor': 'end' }, fmt(y, y % 1 ? 1 : 0))); });
    xt.forEach(function (x) { svg.appendChild(sv('line', { class: 'axis', x1: f.sx(x), x2: f.sx(x), y1: H0 - m.b, y2: H0 - m.b + 4 })); svg.appendChild(sv('text', { x: f.sx(x), y: H0 - m.b + 16, 'text-anchor': 'middle' }, String(x))); });
    svg.appendChild(sv('line', { class: 'axis', x1: m.l, x2: W0 - m.r, y1: H0 - m.b, y2: H0 - m.b }));
    svg.appendChild(sv('text', { class: 'lbl', x: (m.l + W0 - m.r) / 2, y: H0 - 4, 'text-anchor': 'middle' }, xl));
    svg.appendChild(sv('text', { class: 'lbl', x: 12, y: (m.t + H0 - m.b) / 2, transform: 'rotate(-90 12 ' + (m.t + H0 - m.b) / 2 + ')', 'text-anchor': 'middle' }, yl));
  }
  function dayHours() { var R = state.R, d0 = R.asym.dayMs, end = 24; (R.windows || []).forEach(function (w) { end = Math.max(end, (w.closeMs - d0) / 3600e3); }); return { d0: d0, x0: 0, x1: Math.ceil(end) }; }
  var AZM = { l: 46, r: 12, t: 10, b: 34 };
  /** Draw at the chart's own pixel width, so its text stays 11 px on a phone. */
  function size(svg, H0) { var w = Math.max(300, Math.round(svg.getBoundingClientRect().width || 640)); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + H0); return w; }
  function eastward(a, cor) { return cor[1] <= 180 && a > 180 ? a - 180 : a; }
  function drawAz() {
    var R = state.R, svg = $('azChart'), H0 = 300, W0 = size(svg, H0);
    svg.textContent = '';
    if (!R.scan || !R.scan.length) return;
    var D = dayHours(), cor = state.set.corridor, pts = R.scan.filter(function (p) { var h = (p.ms - D.d0) / 3600e3; return h >= D.x0 && h <= D.x1; });
    // the eastward direction along each plane (0 to 180 deg) when the corridor lies there, as JPL 82-43's Fig. 12
    var ys = pts.map(function (p) { return eastward(p.azDeg, cor); }).concat(cor), y0 = cor[1] <= 180 ? 0 : Math.max(0, Math.floor((Math.min.apply(null, ys) - 5) / 10) * 10), y1 = cor[1] <= 180 ? 180 : Math.min(360, Math.ceil((Math.max.apply(null, ys) + 5) / 10) * 10);
    var f = frame(svg, D.x0, D.x1, y0, y1, W0, H0, AZM);
    if (cor[1] < y1) svg.appendChild(sv('rect', { class: 'band', x: AZM.l, y: f.sy(y1), width: W0 - AZM.l - AZM.r, height: f.sy(cor[1]) - f.sy(y1) }));
    if (cor[0] > y0) svg.appendChild(sv('rect', { class: 'band', x: AZM.l, y: f.sy(cor[0]), width: W0 - AZM.l - AZM.r, height: f.sy(y0) - f.sy(cor[0]) }));
    (R.windows || []).forEach(function (w) { var a = Math.max(D.x0, (w.openMs - D.d0) / 3600e3), b = Math.min(D.x1, (w.closeMs - D.d0) / 3600e3); svg.appendChild(sv('rect', { class: 'win', x: f.sx(a), y: AZM.t, width: Math.max(1, f.sx(b) - f.sx(a)), height: H0 - AZM.t - AZM.b })); });
    axes(svg, f, ticks(D.x0, D.x1, W0 < 500 ? 5 : 8), ticks(y0, y1, 6), 'hours UTC, ' + R.asym.dateUtc, 'azimuth (°)', W0, H0, AZM);
    var d = '', prev = null;
    pts.forEach(function (p) { var a = eastward(p.azDeg, cor), x = f.sx((p.ms - D.d0) / 3600e3), y = f.sy(a); d += (prev == null || Math.abs(a - prev) > 60 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); prev = a; });
    svg.appendChild(sv('path', { class: 'line s1', d: d }));
    var s = R.launch;
    if (s && s.T) svg.appendChild(sv('circle', { class: 'ptx', cx: f.sx((s.ms - D.d0) / 3600e3), cy: f.sy(s.azDeg), r: 6 }));
    svg._f = f; svg._D = D;
    $('azCap').textContent = 'Every ' + (R.windows && R.windows.length ? '2 minutes by the handbook\'s closed form (J2 by eq. 25); the window edges by the numerical solve.' : '2 minutes; no stretch of the day lies inside the corridor.') + ' Tap inside a window, or focus the chart and use the arrow keys, to move the launch.';
  }
  function drawPerf() {
    var R = state.R, svg = $('perfChart'), H0 = 240, W0 = size(svg, H0), m = { l: 56, r: 12, t: 10, b: 34 };
    svg.textContent = '';
    var due = state.st.h36.outputs.propellant_left_in_guided_stage.value, ps = (R.perf || []).filter(function (p) { return p.propellant != null; });
    if (!ps.length) { $('perfCap').textContent = 'No window, so nothing to fly.'; return; }
    var D = dayHours(), vals = ps.map(function (p) { return p.propellant; }).concat([due]), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = Math.max(1, (hi - lo) * 0.08);
    var f = frame(svg, D.x0, D.x1, lo - pad, hi + pad, W0, H0, m);
    (R.windows || []).forEach(function (w) { var a = (w.openMs - D.d0) / 3600e3, b = (w.closeMs - D.d0) / 3600e3; svg.appendChild(sv('rect', { class: 'win', x: f.sx(a), y: m.t, width: Math.max(1, f.sx(b) - f.sx(a)), height: H0 - m.t - m.b })); });
    axes(svg, f, ticks(D.x0, D.x1, W0 < 500 ? 5 : 8), ticks(lo - pad, hi + pad, 5), 'hours UTC', 'kg', W0, H0, m);
    svg.appendChild(sv('line', { class: 'ref', x1: m.l, x2: W0 - m.r, y1: f.sy(due), y2: f.sy(due) }));
    [0, 1, 2, 3].forEach(function (wi) {
      var q = ps.filter(function (p) { return p.window === wi; }); if (!q.length) return;
      svg.appendChild(sv('path', { class: 'line s1', d: q.map(function (p, i) { return (i ? 'L' : 'M') + f.sx((p.ms - D.d0) / 3600e3).toFixed(1) + ' ' + f.sy(p.propellant).toFixed(1); }).join('') }));
      q.forEach(function (p) { svg.appendChild(sv('circle', { class: 'pt', cx: f.sx((p.ms - D.d0) / 3600e3), cy: f.sy(p.propellant), r: 3.5 })); });
    });
    if (R.flight && R.launch) svg.appendChild(sv('circle', { class: 'ptx', cx: f.sx((R.launch.ms - D.d0) / 3600e3), cy: f.sy(R.flight.propellant), r: 6 }));
    var best = ps.reduce(function (a, b) { return b.propellant > a.propellant ? b : a; }), worst = ps.reduce(function (a, b) { return b.propellant < a.propellant ? b : a; });
    $('perfCap').textContent = 'Idea 36\'s guided ascent flown again on each moment\'s azimuth: ' + fmt(worst.propellant, 0) + ' kg left at ' + fmt(worst.azDeg, 1) + '° to ' + fmt(best.propellant, 0) + ' kg at ' + fmt(best.azDeg, 1) + '°, against ' + fmt(due, 0) + ' kg as idea 36 flew it (' + fmt(state.st.azFlownDeg, 2) + '°). The first stage keeps idea 35\'s pitch plan and flies the plane\'s azimuth, as the Saturn V did; yawed a few degrees toward the north it keeps 1 to 1.7 t more inside the window (README).';
  }
  function drawSky() {
    var R = state.R, svg = $('skyChart'), H0 = 300, W0 = size(svg, H0), m = { l: 40, r: 12, t: 10, b: 34 }, s = R.launch;
    svg.textContent = '';
    var f = frame(svg, 0, 360, -90, 90, W0, H0, m);
    axes(svg, f, W0 < 500 ? [0, 90, 180, 270, 360] : [0, 60, 120, 180, 240, 300, 360], [-90, -60, -30, 0, 30, 60, 90], 'right ascension of date (°)', 'declination (°)', W0, H0, m);
    if (!s || !s.T) return;
    var rd = function (v) { var r = Math.hypot(v[0], v[1], v[2]); return [((Math.atan2(v[1], v[0]) / DEG) + 360) % 360, Math.asin(v[2] / r) / DEG]; };
    var h = s.h, inc = Math.acos(h[2]), node = Math.atan2(h[0], -h[1]), d = '';
    for (var a = 0; a <= 360; a += 3) d += (a ? 'L' : 'M') + f.sx(a).toFixed(1) + ' ' + f.sy(Math.atan(Math.tan(inc) * Math.sin(a * DEG - node)) / DEG).toFixed(1);
    svg.appendChild(sv('path', { class: 'line s1', d: d }));
    svg.appendChild(sv('line', { class: 'ref', x1: f.sx(0), x2: f.sx(360), y1: f.sy(state.st.latDeg), y2: f.sy(state.st.latDeg) }));
    var pad = rd(s.u), asy = rd(s.S);
    svg.appendChild(sv('circle', { class: 'pt', cx: f.sx(pad[0]), cy: f.sy(pad[1]), r: 6 }));
    svg.appendChild(sv('circle', { class: 'ptx', cx: f.sx(asy[0]), cy: f.sy(asy[1]), r: 6 }));
    if (R.departure) { var dp = rd(R.departure.r); svg.appendChild(sv('circle', { class: 'ptg', cx: f.sx(dp[0]), cy: f.sy(dp[1]), r: 5 })); }
  }

  // ------------------------------------------------------------------ Apollo 17 table (once)
  function apolloTable() {
    var a = W.apollo17(), c = W.as512Coast(), tb = $('apTable').querySelector('tbody'), ctx = C.setup(DATA.as512);
    var f1 = W.flyAt(ctx, AP.azimuthScheduledDeg), f2 = W.flyAt(ctx, AP.azimuthFlownDeg);
    var row = function (q, mine, theirs, gap, src) { tb.appendChild(el('tr', {}, [el('td', { 'data-k': 'Quantity', text: q }), el('td', { 'data-k': 'This page', class: 'n', text: mine }), el('td', { 'data-k': 'Apollo 17', class: 'n', text: theirs }), el('td', { 'data-k': 'Gap', class: 'n', text: gap }), el('td', { 'data-k': 'Source', text: src })])); };
    row('Window opens (azimuth 72°)', hms(a.predictedOpenMs) + ' UT', '02:53 UT', sgn(a.openGap_s, 0) + ' s', 'Press kit; the report\'s azimuth at 02:53:00 was 72.141°, so 72.000° comes earlier');
    row('Window closes (azimuth 100°)', hms(a.predictedCloseMs) + ' UT', '06:31 UT', sgn(a.closeGap_s, 0) + ' s', 'Press kit 1:31 am EST; fixed direction fitted to 72.141° at 02:53:00 and 91.504° at 05:33:00 (report 9.3.1)');
    row('Inclination at 91.504°', fmt(a.inclinationAtFlownDeg, 3) + '°', fmt(a.inclinationTable44Deg, 3) + '°', sgn(a.inclinationGapDeg, 3) + '°', 'Eq. 15 from latitude 28.5°; report Table 4-4');
    row('Node motion, insertion to TLI', sgn(c.predictedChangeDeg, 3) + '°', sgn(c.flightChangeDeg, 3) + '°', sgn(c.predictedChangeDeg - c.flightChangeDeg, 3) + '°', 'J2 coast from Table 4-4 to Table 4-5\'s time; the flight\'s includes its TLI burn (eq. 25: ' + sgn(c.eq25ChangeDeg, 3) + '°)');
    if (!f1.refusal && !f2.refusal) row('Propellant left for TLI, 72.141° against 91.504°', fmt(f1.propellant, 0) + ' / ' + fmt(f2.propellant, 0) + ' kg', '-', sgn(f2.propellant - f1.propellant, 0) + ' kg', 'Idea 36 re-flown at each azimuth (first stage on the plane\'s azimuth, as the Saturn flew): what the 2 h 40 min hold gave the S-IVB');
    var tli = !f2.refusal && W.tliCheck(ctx, f2);
    if (tli) row('TLI Δv the S-IVB carried (ideal, J-2 at ' + fmt(tli.chain.ve, 0) + ' m/s)', fmt(tli.chain.dv, 0) + ' m/s', fmt(tli.flownDv, 0) + ' m/s', sgn(tli.chain.dv - tli.flownDv, 0) + ' m/s', 'Report Table 16-7: ' + fmt(tli.flownM0, 0) + ' to ' + fmt(tli.flownMf, 0) + ' kg; the impulsive need for Table 4-5\'s C3 is ' + fmt(tli.needDv, 0) + ' m/s, so this yardstick reads the real burn ' + fmt(100 * (1 - tli.flownDv / tli.needDv), 1) + ' % short');
  }

  // ------------------------------------------------------------------ handoff
  function buildHandoff() {
    try { state.handoff = W.makeHandoff(state.st, state.spec, cleanSet(), state.R, { produced: new Date().toISOString() }); }
    catch (e) { state.handoff = { error: String(e) }; }
    $('hoPreview').textContent = JSON.stringify({ from: state.handoff.from, outputs: state.handoff.outputs, refusals: state.handoff.refusals }, null, 1).slice(0, 6000);
    $('nextLink').href = '../38-burn-out/index.html#h=' + b64e(JSON.stringify(state.handoff));
  }
  function cleanSet() { var s = clone(state.set); return s; }
  function showStatus(cls, text) { var st = $('status'); st.className = 'status ' + cls; st.textContent = text; }
  function decode(text) { var s = String(text || '').trim(), m = s.match(/(?:^|[#&?])h=([A-Za-z0-9_-]+)/); try { if (m) s = b64d(m[1]); return JSON.parse(s); } catch (e) { return s; } }
  function doImport(text, how) {
    var obj = decode(text), st = W.importClosedLoop(obj);
    if (st.refusal) { showStatus('bad', 'Refused (' + st.refusal.code + '): ' + st.refusal.reason + ' What would help: ' + st.refusal.what_would_help); return false; }
    var h36 = st.h36;
    VEH.imp = { label: 'Imported (from ' + obj.from + ')', make: function () { return h36; } };
    state.veh = 'imp'; state.st = st;
    if (st.from === '37-window') { state.spec = st.spec; state.set = clone(st.set); state.preset = 'imported'; }
    else { state.set = W.defaults(st.siteId); if (!state.spec) presetApophis(); }
    syncVehicles(); compute();
    showStatus('ok', 'Imported ' + how + ': ' + (obj.from === '37-window' ? 'this page\'s handoff, re-checked: idea 36\'s inside re-flown, every output recomputed and matched.' : 'idea 36\'s guided ascent, re-flown and matched to its own numbers.'));
    return true;
  }

  // ------------------------------------------------------------------ controls
  function syncControls() {
    var sp = state.spec, a = state.R && state.R.asym;
    $('dateIn').value = sp.dateUtc || '';
    if (a) { $('c3In').value = +(a.c3 / 1e6).toFixed(4); $('rlaIn').value = +a.rlaDeg.toFixed(3); $('dlaIn').value = +a.dlaDeg.toFixed(3); $('dlaRange').value = a.dlaDeg; $('dlaOut').textContent = fmt(a.dlaDeg, 2) + '°'; }
    $('preApophis').setAttribute('aria-pressed', String(state.preset === 'apophis')); $('preApollo').setAttribute('aria-pressed', String(state.preset === 'apollo'));
    var c = state.set.corridor, aster = EARTH.sites[state.st.siteId];
    document.querySelectorAll('[data-cor]').forEach(function (b) { var lim = b.dataset.cor === 'aster' ? aster && aster.azimuthCorridorDeg : AP.window.azimuthLimitsDeg; b.setAttribute('aria-pressed', String(!!lim && lim[0] === c[0] && lim[1] === c[1])); });
    $('corMin').value = c[0]; $('corMax').value = c[1];
    $('coastMax').value = +(state.set.coast.max / 3600).toFixed(3);
    $('lonIn').value = state.set.lonDeg == null ? '' : +state.set.lonDeg.toFixed(5);
    $('j2In').checked = state.set.j2 !== false;
    var R = state.R, w = R && R.windows && R.windows[Math.min(R.windows.length - 1, state.set.opportunity | 0)];
    if (R && R.launch && R.launch.ms && w) $('fracRange').value = Math.max(0, Math.min(1, (R.launch.ms - w.openMs) / (w.closeMs - w.openMs)));
  }
  function typedSpec() {
    var c3 = +$('c3In').value, rla = +$('rlaIn').value, dla = +$('dlaIn').value;
    state.preset = 'typed';
    state.spec = { c3_m2_s2: $('c3In').value.trim() === '' ? NaN : c3 * 1e6, rlaDeg: $('rlaIn').value.trim() === '' ? NaN : rla, dlaDeg: $('dlaIn').value.trim() === '' ? NaN : dla, dateUtc: $('dateIn').value.trim(), source: 'typed on this page' };
    delete state.set.launchUtc;
  }
  ['dateIn', 'c3In', 'rlaIn', 'dlaIn'].forEach(function (id) { $(id).addEventListener('change', function () { typedSpec(); compute(); }); });
  var dlaT = null;
  $('dlaRange').addEventListener('input', function () { $('dlaIn').value = this.value; $('dlaOut').textContent = fmt(+this.value, 1) + '°'; clearTimeout(dlaT); dlaT = setTimeout(function () { typedSpec(); compute(); }, 120); });
  $('preApophis').addEventListener('click', function () { presetApophis(); state.set.corridor = EARTH.sites[state.st.siteId].azimuthCorridorDeg.slice(); compute(); });
  $('preApollo').addEventListener('click', function () { presetApollo(); compute(); });
  document.querySelectorAll('[data-cor]').forEach(function (b) { b.addEventListener('click', function () { var aster = EARTH.sites[state.st.siteId]; state.set.corridor = (b.dataset.cor === 'aster' ? aster.azimuthCorridorDeg : AP.window.azimuthLimitsDeg).slice(); delete state.set.launchUtc; compute(); }); });
  var num = function (id, f) { $(id).addEventListener('change', function () { var v = this.value.trim() === '' ? NaN : +this.value; f(v); delete state.set.launchUtc; compute(); }); };
  num('corMin', function (v) { state.set.corridor = [v, state.set.corridor[1]]; });
  num('corMax', function (v) { state.set.corridor = [state.set.corridor[0], v]; });
  num('coastMax', function (v) { state.set.coast = Object.assign({}, state.set.coast, { max: v * 3600 }); });
  num('lonIn', function (v) { state.set.lonDeg = isFinite(v) ? v : null; state.set.lonSource = 'typed on this page'; });
  $('j2In').addEventListener('change', function () { state.set.j2 = this.checked; compute(); });
  $('vehicle').addEventListener('change', function () { var keep = state.spec; useVehicle(this.value); state.spec = keep; compute(); });
  var raf = null;
  $('fracRange').addEventListener('input', function () { state.set.fraction = +this.value; delete state.set.launchUtc; if (raf) return; raf = requestAnimationFrame(function () { raf = null; relaunch(); }); });
  var az = $('azChart');
  function pickAz(e) {
    var f = az._f, D = az._D, R = state.R; if (!f || !R.windows) return;
    var r = az.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * az.viewBox.baseVal.width, ms = D.d0 + f.ix(px) * 3600e3;
    R.windows.forEach(function (w, i) { if (ms >= w.openMs && ms <= w.closeMs) { state.set.opportunity = i; state.set.fraction = (ms - w.openMs) / (w.closeMs - w.openMs); delete state.set.launchUtc; syncControls(); relaunch(); } });
    var tip = $('azTip'), cor = state.set.corridor; tip.style.display = 'block'; tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left + 8)) + 'px'; tip.style.top = '8px';
    var near = R.scan.reduce(function (a, b) { return Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a; });
    tip.textContent = hms(near.ms) + ' UTC: ' + fmt(eastward(near.azDeg, cor), 2) + '° (i ' + fmt(near.inclinationDeg, 2) + '°)' + (near.inCorridor ? '' : ', outside the corridor');
  }
  az.addEventListener('pointerdown', pickAz);
  az.addEventListener('pointerleave', function () { $('azTip').style.display = 'none'; });
  az.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowRight') state.set.fraction = Math.min(1, (state.set.fraction || 0) + step); else if (e.key === 'ArrowLeft') state.set.fraction = Math.max(0, (state.set.fraction || 0) - step); else return;
    e.preventDefault(); delete state.set.launchUtc; syncControls(); relaunch();
  });
  $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'from the text box'); });
  $('copyBtn').addEventListener('click', function () {
    try { navigator.clipboard.writeText(JSON.stringify(state.handoff, null, 1)).then(function () { showStatus('ok', 'Copied.'); }, function () { showStatus('bad', 'The browser would not copy; use Download instead.'); }); }
    catch (e) { showStatus('bad', 'The browser would not copy; use Download instead.'); }
  });
  $('dlBtn').addEventListener('click', function () {
    var a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(state.handoff, null, 1)], { type: 'application/json' })), download: 'handoff.json' });
    document.body.appendChild(a); a.click(); a.remove(); showStatus('ok', 'Downloaded handoff.json.');
  });

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (state.R) { drawAz(); drawPerf(); drawSky(); } }, 120); });

  // ------------------------------------------------------------------ start
  syncVehicles();
  var hash = location.hash || '';
  if (!(/[#&]h=/.test(hash) && doImport(hash, 'from the link'))) { useVehicle('as512'); presetApophis(); compute(); }
  apolloTable();
  window.__window = { W: W, state: state };
})();
