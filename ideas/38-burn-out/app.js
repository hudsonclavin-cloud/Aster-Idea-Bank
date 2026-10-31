/* Burn Out page: wires the controls to the kernel (burnout.js over idea 37's window.js) and draws. No network. */
(function () {
  'use strict';
  var EARTH = window.MaxQEarth, AP = window.APOLLO17_WINDOW, WIN = window.WINDOW_AS512_APOPHIS;
  // idea 37's kernel needs idea 36's only to re-fly ascents; the functions used here read its constants, which idea 36
  // takes from the same Aster file (earth.js)
  var W = window.LaunchWindow.create({ C: { constants: { MU: EARTH.mu_m3_s2, RE: EARTH.radius_m } }, erfa: window.WindowERFA, naif: window.WindowNAIF, aster: window.WindowAster, apollo17: AP, apophis: null, earth: EARTH, trajectory: null });
  var e34 = WIN.inputs.closed_loop_handoff.inputs.ascent_handoff.inputs.vehicle_handoff.inputs.engines['J-2'];
  var chainJ2 = { F: e34.thrust_vacuum_N, mdot: e34.mass_flow_kg_s, label: 'J-2 as idea 33\'s deck gives it (the chain\'s)', source: 'idea 33\'s J-2 deck in idea 34\'s AS-512 vehicle' };
  var B = window.BurnOut.create({ W: W, apollo17: AP, as512: window.AS512_FLIGHT, tli: window.AS512_TLI_BURN, aster: window.WindowAster, earth: EARTH, chainJ2: chainJ2 });
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg', DEG = Math.PI / 180, G0 = B.G0, RE = B.constants.RE;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs, text) { var e = document.createElementNS(SVGNS, tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) {
    if (!num(v)) return '-';
    var a = Math.abs(v);
    if (d == null) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
    if (a < 0.5 * Math.pow(10, -d)) v = 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function sgn(v, d) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d); }
  function clock(ms) { return new Date(Math.round(ms)).toISOString().slice(11, 19) + ' UTC'; }
  function mmss(s) { var a = Math.abs(s), m = Math.floor(a / 60), r = a - 60 * m; return (s < 0 ? '−' : '') + m + ' min ' + fmt(r, 1) + ' s'; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = Math.sqrt(dot(a, a)); return [a[0] / n, a[1] / n, a[2] / n]; }
  function b64e(str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { var t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var bin = atob(t), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function tile(k, v, u, conf, sub, cls) {
    return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [el('div', { class: 'k', text: k }), el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: u }) : null]), sub ? el('div', { class: 'sub', text: sub }) : null, conf ? el('span', { class: 'c', text: conf }) : null]);
  }
  function refusalBox(r) { return el('div', { class: 'refusal' }, [el('b', { text: (r.from ? r.from + ', ' : '') + (r.applies_to ? r.applies_to + ': ' : '') + 'refused (' + r.code + ')' }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]); }
  function showStatus(kind, text) { var s = $('status'); s.className = 'status ' + (kind || ''); s.textContent = text; }

  // ------------------------------------------------------------------ state
  var CHAIN = B.importWindow(WIN);
  var custom0 = function () {
    var dp = WIN.outputs.departure_point.value, P = WIN.outputs.parking_orbit_j2000.value;
    return { altitudeKm: Math.round(dp.altitude_m / 100) / 10, inclinationDeg: Math.round(P.inclination_deg * 10) / 10, c3: WIN.outputs.asymptote.value.c3_m2_s2,
      inertKg: Math.round(CHAIN.inert), propellantKg: Math.round(CHAIN.mp), payloadKg: CHAIN.payload, thrustN: CHAIN.eng.F, veMS: CHAIN.eng.F / CHAIN.eng.mdot, j2: true };
  };
  var state = { preset: 'chain', src: { window: CHAIN }, set: B.defaults(), R: null, apEngine: 'flown', custom: custom0(), label: null, apCache: {} };

  function setPreset(p, src, label) {
    state.preset = p; state.src = src; state.label = label || null;
    document.body.className = 'p-' + p;
    $('preChain').setAttribute('aria-pressed', p === 'chain'); $('preApollo').setAttribute('aria-pressed', p === 'apollo'); $('preCustom').setAttribute('aria-pressed', p === 'custom');
  }
  /** Write a control's value unless the person is typing in it (a recompute must not overwrite a half-typed number). */
  function put(id, v) { var e = $(id); if (document.activeElement !== e) e.value = v; }
  function syncControls() {
    var set = state.set;
    document.querySelectorAll('[data-steer]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.steer === set.steering); });
    document.querySelectorAll('[data-n]').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.n === set.burns); b.disabled = state.preset === 'apollo' && +b.dataset.n > 1; });
    if (state.src.window) {
      var pay = set.payloadKg != null ? set.payloadKg : state.src.window.payload;
      put('payIn', Math.round(pay)); $('payRange').max = Math.max(80000, Math.ceil(state.src.window.payload * 1.5 / 1000) * 1000); $('payRange').value = pay;
      $('payNote').textContent = 'Handed on by idea 34 (through 37): ' + fmt(state.src.window.payload, 0) + ' kg. The stage itself is ' + fmt(state.src.window.inert, 0) + ' kg inert with ' + fmt(state.src.window.mp, 0) + ' kg of propellant; the ascent is not re-flown for another payload.';
    }
    if (state.preset === 'custom') {
      var c = state.custom;
      put('cAlt', c.altitudeKm); put('cInc', c.inclinationDeg); put('cC3', +(c.c3 / 1e6).toFixed(4)); put('cPay', c.payloadKg); put('cInert', c.inertKg); put('cProp', c.propellantKg);
      put('cThrust', +(c.thrustN / 1000).toFixed(2)); put('cIsp', +(c.veMS / G0).toFixed(2)); $('cJ2').checked = c.j2 !== false;
    }
    $('apEngine').value = state.apEngine;
  }

  // ------------------------------------------------------------------ compute
  var timer = null;
  /** body[data-busy] is set from the moment an input changes until the burn and its sweep are drawn (ui-check waits on it). */
  function busy(on) { if (on) document.body.setAttribute('data-busy', '1'); else document.body.removeAttribute('data-busy'); }
  function schedule(ms) { busy(true); clearTimeout(timer); timer = setTimeout(compute, ms == null ? 80 : ms); }
  function compute() {
    busy(true);
    var set = state.set;
    if (state.preset === 'apollo') { set.burns = 1; if (state.apEngine === 'flown') delete set.engine; else set.engine = state.apEngine; set.thrustScale = 1; }
    else delete set.engine;
    var R;
    try { R = B.compute(state.src, set, { sweep: false, sampleEvery: 2 }); } catch (e) { R = { refusal: { code: 'invalid_input', reason: 'The kernel failed on these inputs: ' + e.message, what_would_help: 'Other inputs.' }, refusals: [] }; }
    state.R = R;
    render();
    setTimeout(function () {
      if (state.R !== R) return;
      if (R.sc && !R.refusal) { try { R.sweep = B.sweep(R.sc, { h: 2 }); } catch (e) { R.sweep = []; } drawTW(); refreshHandoff(); }
      busy(false);
    }, 0);
    renderApollo();
  }

  // ------------------------------------------------------------------ render
  function render() {
    var R = state.R, sc = R.sc, sol = R.sol, tiles = $('tiles'), refs = $('refusals'), v = $('verdict');
    tiles.textContent = ''; refs.textContent = ''; $('burnList').textContent = '';
    syncControls();
    srcLine(R);
    twControl(R);
    if (R.refusal) {
      v.className = 'verdict red'; v.textContent = 'No burn on these inputs.';
      refs.appendChild(refusalBox(R.refusal));
      drawTW(); drawPlane(); drawSteer(); refreshHandoff();
      return;
    }
    (R.refusals || []).forEach(function (r) { refs.appendChild(refusalBox(r)); });
    var mine = (R.refusals || []).some(function (r) { return r.applies_to === 'departure_propellant'; });
    var f = sol.final, c3far = sc.efn(f.r, f.v) * 2;
    if (sc.kind === 'apollo17') {
      var a = R.apollo, bt = a.rows[0];
      v.className = 'verdict green';
      v.textContent = 'Replayed: the burn reaches Table 4-2\'s C3 after ' + fmt(bt.model, 2) + ' s against the ' + fmt(bt.flight, 2) + ' s Apollo 17 burned (' + sgn(bt.gap, 2) + ' s); it needs ' + fmt(sol.dvFinite, 1) + ' m/s where the flight spent ' + fmt(a.flownDv, 1) + ' (finite-burn loss ' + fmt(sol.loss, 1) + ' m/s against the flight\'s ' + fmt(a.flightLoss, 1) + ').';
    } else if (mine) {
      v.className = 'verdict red';
      v.textContent = 'Refused: this departure needs ' + fmt(sol.mUsed, 0) + ' kg of propellant and the stage has ' + fmt(sc.mp, 0) + ' kg. ' + (R.cap && num(R.cap.finite) ? 'With the propellant it has, the stage can send at most ' + fmt(R.cap.finite, 0) + ' kg to this C3 (finite burn; ' + fmt(R.cap.impulsive, 0) + ' kg if the burn were impulsive), against the ' + fmt(sc.payload, 0) + ' kg on it.' : 'No payload, however light, gets there on this propellant.');
    } else if (!(sc.c3 > 0)) {
      // a bound target (C3 at or below zero, typed in): nothing departs, so no v-infinity (added by the independent review)
      var cb = B.conic(f.r, f.v);
      v.className = 'verdict green';
      v.textContent = 'Reaches C3 ' + fmt(c3far / 1e6, 4) + ' km²/s²: a bound orbit' + (cb.ra ? ' with apogee ' + fmt((cb.ra - RE) / 1000, 0) + ' km' : '') + ', not a departure (no asymptote, no v-infinity to hand on). ' + fmt(sol.loss, 2) + ' m/s (' + fmt(sol.loss / sol.dvImp * 100, 2) + ' %) over the impulsive delta-v, ' + fmt(sc.mp - sol.mUsed, 0) + ' kg of propellant to spare.';
    } else {
      v.className = 'verdict green';
      v.textContent = 'Departs: v-infinity ' + fmt(Math.sqrt(Math.max(0, c3far)), 1) + ' m/s' + (sc.kind === 'window' ? ' along idea 37\'s asymptote' : '') + ', ' + fmt(sol.loss, 2) + ' m/s (' + fmt(sol.loss / sol.dvImp * 100, 2) + ' %) over the impulsive delta-v, ' + fmt(sc.mp - sol.mUsed, 0) + ' kg of propellant to spare.';
    }
    var conf = 'derived';
    tiles.appendChild(tile('Delta-v spent (finite burn)', fmt(sol.dvFinite, 1), 'm/s', conf, 've ln(m0/mf), ' + sol.burns.length + ' burn' + (sol.burns.length > 1 ? 's' : ''), 'hero'));
    tiles.appendChild(tile('Impulsive delta-v', fmt(sol.dvImp, 1), 'm/s', conf, sc.kind === 'window' ? 'at idea 37\'s departure point, J2 counted (idea 37: ' + fmt(sc.dvImp37, 1) + ' two-body)' : 'vis-viva from the orbit at ignition'));
    tiles.appendChild(tile('Finite-burn (gravity) loss', fmt(sol.loss, 2), 'm/s', conf, fmt(sol.loss / sol.dvImp * 100, 3) + ' % of the impulsive; ' + fmt(sol.mUsed - sol.mpImp, 0) + ' kg of propellant', 'hero'));
    tiles.appendChild(tile('Propellant needed', fmt(sol.mUsed, 0), 'kg', conf, (sc.kind === 'apollo17' ? 'the flight burned ' : 'the stage has ') + fmt(sc.mp, 0) + ' kg', sol.short > 0 && sc.kind !== 'apollo17' ? 'short' : ''));
    var b0 = sol.burns[0];
    tiles.appendChild(tile('Burn time', fmt(sol.burns.reduce(function (s, b) { return s + b.dur; }, 0), 1), 's', conf, sol.burns.length > 1 ? 'over ' + sol.burns.length + ' burns, last cutoff ' + fmt((f.t - b0.tIg) / 3600, 2) + ' h after the first ignition' : 'ignition to cutoff'));
    if (sc.kind === 'window') {
      var ms = state.src.window.launchMs + (state.src.window.dp.tdb + b0.tIg - state.src.window.T.tdb) * 1000;
      tiles.appendChild(tile('Ignition', mmss(b0.tIg), '', conf, 'before idea 37\'s impulsive point (' + clock(ms) + ')'));
    } else if (sc.kind === 'apollo17') tiles.appendChild(tile('Ignition', '11,556.6', 's', 'measured', 'range time, as flown (Table 2-2 item 88)'));
    // the arc of one burn (the last, with perigee burns: first ignition to last cutoff spans hours of phasing orbits)
    var arc = Math.acos(Math.max(-1, Math.min(1, dot(unit(f.start.r), unit(f.r))))) / DEG;
    tiles.appendChild(tile('Burn arc', fmt(arc, 1), 'deg', conf, sol.burns.length > 1 ? 'round the Earth during the last burn' : 'round the Earth from ignition to cutoff'));
    tiles.appendChild(tile('Thrust-to-weight', fmt(sc.tw0, 3), '', sc.k === 1 ? conf : 'assumed', sc.eng.segs ? 'the burn\'s mean thrust (' + fmt(sc.eng.meanF / 1000, 0) + ' kN) on the ignition mass (' + fmt(sc.m0, 0) + ' kg)' : 'at ignition (' + fmt(B.segsOf(sc.eng, sc.k).slice(-1)[0].F / 1000, 0) + ' kN on ' + fmt(sc.m0, 0) + ' kg)'));
    tiles.appendChild(tile('Altitude at cutoff', fmt((Math.sqrt(dot(f.r, f.r)) - RE) / 1000, 1), 'km', conf, 'above Aster\'s equatorial radius'));
    if (sc.kind !== 'apollo17' && sol.short <= 0) tiles.appendChild(tile(sc.c3 > 0 ? 'C3 at infinity' : 'C3 reached (bound)', fmt(c3far / 1e6, 4), 'km²/s²', conf, sc.efn === B.energyJ2 ? 'two-body at cutoff reads ' + fmt(2 * B.energy(f.r, f.v) / 1e6, 4) : 'two-body'));
    if (sc.kind === 'window') tiles.appendChild(tile('Yaw to hold the asymptote', fmt((sol.yaw || 0) / DEG, 3), 'deg', conf, sol.burns.length > 1 && sol.inPlane ? 'J2 turned the plane ' + fmt(sol.inPlane.betaDeg, 3) + ' deg over the phasing' : 'J2 turns the plane during and after the burn'));
    if (sol.inPlane) tiles.appendChild(tile('Loss if the launch were aimed for the phasing', fmt(sol.inPlane.loss, 2), 'm/s', conf, 'no yaw; the yawed figure above is from idea 37\'s plane'));
    if (R.cap) {
      if (num(R.cap.finite)) tiles.appendChild(tile('Payload the stage can send', fmt(R.cap.finite, 0), 'kg', conf, 'finite burn; ' + fmt(R.cap.impulsive, 0) + ' kg impulsive (rocket equation); ' + fmt(sc.payload, 0) + ' kg on it', 'hero'));
      else tiles.appendChild(tile('Payload the stage can send', 'none', '', conf, R.cap.none ? 'its propellant cannot reach this C3 even empty' : 'impulsively ' + fmt(R.cap.impulsive, 0) + ' kg, but the finite-burn loss at this thrust uses it all', 'refused'));
    }
    if (sol.depleted) tiles.appendChild(tile('Where the tank runs dry', 'C3 ' + fmt(sol.depleted.c3 / 1e6, 2), 'km²/s²', conf, sol.depleted.apogeeAlt ? 'an orbit with apogee ' + fmt(sol.depleted.apogeeAlt / 1000, 0) + ' km' : ''));
    if (sol.burns.length > 1) sol.burns.forEach(function (b, i) { $('burnList').appendChild(el('li', { text: 'Burn ' + (i + 1) + ': ' + fmt(b.dur, 1) + ' s, ' + fmt(b.mUsed, 0) + ' kg, ' + fmt(B.dvOf(sc, b), 1) + ' m/s' + (i > 0 ? ', ' + fmt((b.tIg - sol.burns[i - 1].t) / 3600, 2) + ' h after the one before' : '') })); });
    drawTW(); drawPlane(); drawSteer(); refreshHandoff();
  }
  function srcLine(R) {
    var t;
    if (state.preset === 'apollo') t = 'Apollo 17\'s S-IVB second burn from MPR-SAT-FE-73-1: ' + fmt(B.apollo17Engine().mIg, 0) + ' kg at ignition; engine ' + ({ flown: 'as flown (start, EMR 4.5, EMR 5.0)', mean: 'at the burn\'s mean thrust', chain: 'the chain\'s J-2 deck' })[state.apEngine] + '; cutoff at C3 ' + fmt(window.AS512_FLIGHT.c3AtSivb2Gcs.actual[0] / 1e6, 4) + ' km²/s² (two-body, as the report defines it).';
    else if (state.preset === 'custom') t = 'Your own departure: a circular parking orbit, a stage and an engine you type. Asymptote free (the burn starts at the ascending node).';
    else { var st = state.src.window, a = st.asym; t = (state.label || 'Idea 37\'s page default: the Saturn V AS-512 (idea 36) departing for Apophis on 2 July 2026') + '. Departure point ' + st.h37.outputs.departure_point.value.utc.slice(0, 19).replace('T', ' ') + ' UTC at ' + fmt(st.h37.outputs.departure_point.value.altitude_m / 1000, 1) + ' km; C3 ' + fmt(a.c3_m2_s2 / 1e6, 4) + ' km²/s², RLA ' + fmt(a.rla_deg, 2) + '°, DLA ' + fmt(a.dla_deg, 2) + '°; engine ' + st.eng.label + ' (' + fmt(st.eng.F / 1000, 0) + ' kN, ' + fmt(st.eng.F / st.eng.mdot, 1) + ' m/s).'; }
    $('srcLine').textContent = t;
  }
  function twBase() {
    var sc = state.R && state.R.sc;
    if (sc && !sc.eng.segs) return sc.tw0 / sc.k;
    return null;
  }
  function twControl(R) {
    var base = twBase(), sc = R.sc, dis = state.preset === 'apollo';
    ['twIn', 'twRange', 'twReset'].forEach(function (id) { $(id).disabled = dis || !base; });
    if (sc) {
      var tw = sc.tw0;
      put('twIn', +tw.toFixed(3)); $('twRange').value = Math.log10(Math.max(0.1, Math.min(3, tw)));
      $('twOut').textContent = dis ? 'as flown (' + fmt(tw, 3) + ')' : 'scale ×' + fmt(sc.k, 3) + ' on ' + fmt(B.segsOf(sc.eng, 1).slice(-1)[0].F / 1000, 0) + ' kN';
    }
  }
  function setTW(tw) {
    var base = twBase();
    if (!base || !num(tw)) return;
    tw = Math.max(0.1, Math.min(3, tw));
    state.set.thrustScale = Math.max(0.05, Math.min(10, tw / base));
    schedule(60);
  }

  // ------------------------------------------------------------------ charts
  var TWX = { w: 640 };
  function axes(svg, X, Y, xt, yt, xl, yl, fx, fy) {
    var g = sv('g');
    xt.forEach(function (t) { var x = X(t); g.appendChild(sv('line', { class: 'grid', x1: x, x2: x, y1: Y.top, y2: Y.bot })); g.appendChild(sv('text', { x: x, y: Y.bot + 16, 'text-anchor': 'middle' }, fx(t))); });
    yt.forEach(function (t) { var y = Y(t); g.appendChild(sv('line', { class: 'grid', x1: X.left, x2: X.right, y1: y, y2: y })); g.appendChild(sv('text', { x: X.left - 6, y: y + 4, 'text-anchor': 'end' }, fy(t))); });
    g.appendChild(sv('line', { class: 'axis', x1: X.left, x2: X.right, y1: Y.bot, y2: Y.bot }));
    g.appendChild(sv('line', { class: 'axis', x1: X.left, x2: X.left, y1: Y.top, y2: Y.bot }));
    g.appendChild(sv('text', { class: 'lbl', x: (X.left + X.right) / 2, y: Y.bot + 34, 'text-anchor': 'middle' }, xl));
    g.appendChild(sv('text', { class: 'lbl', x: 14, y: (Y.top + Y.bot) / 2, transform: 'rotate(-90 14 ' + (Y.top + Y.bot) / 2 + ')', 'text-anchor': 'middle' }, yl));
    svg.appendChild(g);
  }
  /** Size a chart's viewBox to its rendered width (at least 300) so its text stays 11 px on a phone. */
  function size(svg, H) { var w = Math.max(300, Math.round(svg.getBoundingClientRect().width || 640)); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + H); return w; }
  function scale(d0, d1, p0, p1) { var f = function (v) { return p0 + (v - d0) / (d1 - d0) * (p1 - p0); }; return f; }
  function drawTW() {
    var svg = $('twChart'); svg.textContent = '';
    var R = state.R, sw = R && R.sweep, sc = R && R.sc, w = size(svg, 300);
    var X = scale(Math.log10(0.12), Math.log10(3.4), 58, w - 14); TWX.w = w;
    var pts = (sw || []).filter(function (p) { return num(p.loss) && p.loss > 0.01; }), lo = 0.01, hi = 1000;
    if (pts.length) { lo = Math.pow(10, Math.floor(Math.log10(Math.min.apply(null, pts.map(function (p) { return p.loss; }))))); hi = Math.pow(10, Math.ceil(Math.log10(Math.max.apply(null, pts.map(function (p) { return p.loss; }))))); }
    var Y = scale(Math.log10(lo), Math.log10(hi), 255, 18); Y.top = 18; Y.bot = 255;
    var yt = []; for (var e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) yt.push(Math.pow(10, e));
    var XL = function (v) { return X(Math.log10(v)); }, YL = function (v) { return Y(Math.log10(v)); };
    XL.left = 58; XL.right = w - 14; YL.top = 18; YL.bot = 255;
    axes(svg, XL, YL, w < 420 ? [0.15, 0.3, 1, 3] : [0.15, 0.3, 0.6, 1, 2, 3], yt, 'thrust-to-weight at ignition', 'loss (m/s)', function (t) { return String(t); }, function (t) { return t >= 1 ? String(t) : String(+t.toPrecision(1)); });
    if (!sw) { svg.appendChild(sv('text', { class: 'lbl', x: w / 2, y: 140, 'text-anchor': 'middle' }, R && R.refusal ? 'no burn on these inputs' : 'computing…')); $('twCap').textContent = ''; return; }
    [[1, 's2'], [2, 's1'], [3, 's3']].forEach(function (nc) {
      var d = pts.filter(function (p) { return p.n === nc[0]; }).map(function (p) { return X(Math.log10(p.tw)).toFixed(1) + ',' + Y(Math.log10(p.loss)).toFixed(1); });
      if (d.length > 1) svg.appendChild(sv('path', { class: 'line ' + nc[1], d: 'M' + d.join('L') }));
    });
    if (R.sol && sc) {
      var L = R.sol.inPlane ? R.sol.inPlane.loss : R.sol.loss;
      if (L > 0.01 && sc.tw0 >= 0.12 && sc.tw0 <= 3.4) svg.appendChild(sv('circle', { class: 'mk', cx: X(Math.log10(sc.tw0)), cy: Y(Math.log10(Math.max(lo, L))), r: 6 }));
    }
    var one = pts.filter(function (p) { return p.n === 1; }), at = function (w) { var p = one.filter(function (q) { return q.tw === w; })[0]; return p ? fmt(p.loss, 1) : '-'; };
    $('twCap').textContent = 'Along-velocity steering, thrust and flow scaled together (exhaust velocity fixed), ' + (sc && sc.kind === 'apollo17' ? 'on the burn\'s mean engine' : 'on this stage') + ': one burn loses ' + at(0.3) + ' m/s at T/W 0.3 and ' + at(1.2) + ' at 1.2, falling as 1/(T/W)² at high thrust. Perigee-burn curves assume the launch plane aimed for the phasing. Tap or use the arrow keys to set the thrust.';
  }
  function planePoint(e1, e2, c, s, r) { return [c[0] + dot(r, e1) * s, c[1] - dot(r, e2) * s]; }
  function drawPlane() {
    var svg = $('planeChart'); svg.textContent = '';
    var R = state.R, sc = R && R.sc, sol = R && R.sol, w = size(svg, 360);
    if (!sol) { svg.appendChild(sv('text', { class: 'lbl', x: w / 2, y: 180, 'text-anchor': 'middle' }, 'no burn on these inputs')); $('planeCap').textContent = ''; return; }
    var f = sol.final, b0 = sol.burns[0], h = unit(cross(b0.start.r, b0.start.v)), e1, e2;
    if (sc.kind === 'window') { var S = sc.S, Sp = unit([S[0] - dot(S, h) * h[0], S[1] - dot(S, h) * h[1], S[2] - dot(S, h) * h[2]]); e1 = Sp; }
    else e1 = unit(b0.start.r);
    e2 = cross(h, e1);
    var c = [w * 0.42, 180], s = Math.min(166 / (1.6 * RE), (c[0] - 10) / (1.5 * RE)), P = function (r) { return planePoint(e1, e2, c, s, r); };
    var clip = function (r) { return Math.sqrt(dot(r, r)) < 3.6 * RE; };
    var path = function (rs, cls) { var d = rs.filter(clip).map(function (r) { var p = P(r); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }); if (d.length > 1) svg.appendChild(sv('path', { class: cls, d: 'M' + d.join('L') })); };
    svg.appendChild(sv('circle', { class: 'earth', cx: c[0], cy: c[1], r: RE * s }));
    var r0 = Math.sqrt(dot(b0.start.r, b0.start.r));
    svg.appendChild(sv('circle', { class: 'orbit', cx: c[0], cy: c[1], r: r0 * s }));
    // coast before ignition
    var pre = [], t0 = sc.kind === 'window' ? Math.max(-sc.coast, b0.tIg - 1800) : b0.tIg - 1200;
    for (var t = t0; t <= b0.tIg; t += 30) { var st = sc.stateAt(t); if (st) pre.push(st.r); }
    path(pre, 'coast');
    // phasing coasts between perigee burns
    (sol.coasts || []).forEach(function (co) { var rs = []; for (var tt = co.t0; tt <= co.t1; tt += Math.max(30, (co.t1 - co.t0) / 400)) rs.push(co.at(tt).r); path(rs, 'coast thin'); });
    // after cutoff, two hours of coast
    var y = f.r.concat(f.v), post = [f.r];
    for (var i = 0; i < 240 && Math.sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2]) < 3.6 * RE; i++) { y = W.rk4(y, 30, sc.j2); post.push(y.slice(0, 3)); }
    path(post, 'hyp');
    sol.burns.forEach(function (b) { path((b.samples || []).map(function (q) { return q.r; }).concat([b.r]), 'burn'); });
    if (sc.kind === 'window') {
      var xe = w - 10;
      svg.appendChild(sv('line', { class: 'arrow dash', x1: c[0], y1: c[1], x2: xe - 8, y2: c[1] }));
      svg.appendChild(sv('path', { class: 'arrowhead', d: 'M' + xe + ',' + c[1] + 'l-12,-5l0,10z' }));
      svg.appendChild(sv('text', { class: 'lbl', x: xe, y: c[1] - 10, 'text-anchor': 'end' }, 'asymptote'));
      var dp = P(sc.ref.r); svg.appendChild(sv('circle', { class: 'mk', cx: dp[0], cy: dp[1], r: 5 }));
    }
    var pi = P(b0.start.r), pc = P(f.r);
    svg.appendChild(sv('text', { class: 'lbl', x: pi[0] + (pi[0] < c[0] ? -8 : 8), y: pi[1] + 4, 'text-anchor': pi[0] < c[0] ? 'end' : 'start' }, 'ignition'));
    svg.appendChild(sv('text', { class: 'lbl', x: pc[0] + (pc[0] < c[0] ? -8 : 8), y: pc[1] + (pc[1] < c[1] ? -6 : 14), 'text-anchor': pc[0] < c[0] ? 'end' : 'start' }, 'cutoff'));
    var arc = Math.acos(Math.max(-1, Math.min(1, dot(unit(b0.start.r), unit(f.r))))) / DEG;
    $('planeCap').textContent = 'In the plane of the orbit, Earth and altitudes to scale (the parking orbit is the dotted circle just above the surface), ' + (sc.kind === 'window' ? 'the asymptote to the right; the vehicle goes anticlockwise. The burn starts ' + fmt(-b0.tIg, 1) + ' s before idea 37\'s impulsive point (dot) and sweeps ' + fmt(arc, 1) + '° round the Earth.' : 'ignition on the right; the vehicle goes anticlockwise, sweeping ' + fmt(arc, 1) + '° round the Earth while it burns.') + (sol.burns.length > 1 ? ' The phasing orbits run off the picture.' : '') + (sol.short > 0 && sc.kind !== 'apollo17' && sol.depleted ? ' The stage is short of propellant: this is the burn the departure needs; the tank would run dry ' + fmt(f.t - sol.depleted.t, 1) + ' s before this cutoff.' : '');
  }
  function drawSteer() {
    var svg = $('steerChart'); svg.textContent = '';
    var R = state.R, sol = R && R.sol, w = size(svg, 260);
    if (!sol) { $('steerCap').textContent = ''; return; }
    var b = sol.burns[sol.burns.length - 1], S = (b.samples || []).concat([{ t: b.t, r: b.r, v: b.v, u: b.uEnd }]);
    var th = S.map(function (q) { return [q.t - b.tIg, Math.asin(dot(unit(q.r), q.u)) / DEG]; }), ga = S.map(function (q) { return [q.t - b.tIg, Math.asin(dot(unit(q.r), unit(q.v))) / DEG]; });
    var all = th.concat(ga).map(function (p) { return p[1]; }), lo = Math.floor(Math.min.apply(null, all.concat([0])) / 5) * 5, hi = Math.ceil(Math.max.apply(null, all.concat([5])) / 5) * 5;
    var X = scale(0, b.dur, 52, w - 12), Y = scale(lo, hi, 220, 16); X.left = 52; X.right = w - 12; Y.top = 16; Y.bot = 220;
    var xt = [], step = b.dur > 1200 ? 400 : b.dur > 600 ? 200 : b.dur > 240 ? (w < 420 ? 120 : 60) : (w < 420 ? 60 : 30); for (var t = 0; t <= b.dur; t += step) xt.push(t);
    var yt = [], ys = (hi - lo) > 40 ? 10 : 5; for (var v = lo; v <= hi; v += ys) yt.push(v);
    axes(svg, X, Y, xt, yt, 'seconds from ignition' + (sol.burns.length > 1 ? ' (last burn)' : ''), 'degrees', function (t) { return String(t); }, function (t) { return String(t); });
    var line = function (pts, cls) { svg.appendChild(sv('path', { class: 'line ' + cls, d: 'M' + pts.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('L') })); };
    line(th, 's2'); line(ga, 's1');
    var f = sol.final;
    $('steerCap').textContent = 'The ' + ({ tangential: 'along-velocity law keeps the thrust on the velocity, so the two lines lie together', optimal: 'optimised law turns the thrust ' + (sol.params ? fmt(sol.params.aDeg, 2) + '° from the velocity at mid-burn, changing by ' + fmt(sol.params.bDeg, 2) + '° over the burn' : ''), fixed: 'fixed attitude holds one direction in space, so its pitch above the local horizontal falls as the vehicle goes round' })[state.set.steering] + '. The vehicle climbs to ' + fmt((Math.sqrt(dot(f.r, f.r)) - RE) / 1000, 0) + ' km by cutoff.';
  }

  // ------------------------------------------------------------------ Apollo 17 table (always, with the chosen steering)
  function renderApollo() {
    var steer = state.set.burns > 1 ? 'tangential' : state.set.steering, key = steer;
    var A = state.apCache[key];
    if (!A) { var R = B.compute({ apollo17: true }, Object.assign(B.defaults(), { steering: steer, sweep: false, capability: false }), { samples: false }); A = state.apCache[key] = R.apollo ? R : null; }
    var tb = $('apTable').querySelector('tbody'); tb.textContent = '';
    if (!A) return;
    var a = A.apollo, d = function (u) { return u === 'km' ? 2 : u === 'kg' ? 0 : u === 's' ? 2 : u === 'm/s' ? 1 : u === 'deg' ? 3 : u === 'km^2/s^2' ? 4 : u === 'm/s^2' ? 2 : 4; };
    var rows = [{ label: 'Finite-burn loss over the impulsive delta-v', unit: 'm/s', model: A.sol.loss, flight: a.flightLoss, gap: A.sol.loss - a.flightLoss, source: 'flight: delta-v expended less the impulsive need from the coasted orbit at ignition (' + fmt(a.dvImp, 1) + ' m/s)' }].concat(a.rows);
    rows.forEach(function (r) {
      tb.appendChild(el('tr', {}, [el('td', { 'data-k': 'Quantity', text: r.label + (r.unit ? ' (' + r.unit.replace(/\^2/g, '²') + ')' : '') }), el('td', { class: 'n', 'data-k': 'Model', text: fmt(r.model, d(r.unit)) }), el('td', { class: 'n', 'data-k': 'Apollo 17', text: fmt(r.flight, d(r.unit)) }), el('td', { class: 'n', 'data-k': 'Gap', text: sgn(r.gap, d(r.unit)) }), el('td', { 'data-k': 'Source', text: r.source })]));
    });
    $('apIntro').textContent = 'The S-IVB\'s second burn, replayed: Table 4-4\'s parking orbit coasted with J2 to the flown ignition (11,556.6 s), the engine as the flight report reconstructs it (the measured start impulse, then the EMR 4.5 and 5.0 phases fitted to the measured total impulse and mass), cutoff at Table 4-2\'s C3. Steering: ' + ({ tangential: 'along velocity', optimal: 'optimised', fixed: 'fixed attitude' })[steer] + ' (the flight\'s own was the Saturn IGM, which also yawed: the inclination and node rows). The J2 coast alone moves the descending node ' + fmt(a.nodeAtIgnitionDeg - a.nodeAtInsertionDeg, 3) + '° from insertion to ignition.';
  }

  // ------------------------------------------------------------------ handoff
  var lastHandoff = null;
  function currentHandoff() {
    var R = state.R;
    if (R && R.sc && !R.refusal && !R.sweep) { try { R.sweep = B.sweep(R.sc, { h: 2 }); } catch (e) { R.sweep = []; } }
    var set = Object.assign({}, state.set);
    lastHandoff = B.makeHandoff(state.src, set, R || { refusals: [] }, { produced: new Date().toISOString() });
    return lastHandoff;
  }
  function refreshHandoff() {
    var R = state.R;
    if (R && !R.refusal && R.sc && !R.sweep) { $('hoPreview').textContent = '(computing)'; return; }
    var h = currentHandoff(), show = JSON.parse(JSON.stringify(h));
    if (show.inputs.window_handoff) show.inputs.window_handoff = '(idea 37\'s handoff, whole: ' + JSON.stringify(h.inputs.window_handoff).length + ' characters)';
    $('hoPreview').textContent = JSON.stringify(show, null, 1).slice(0, 6000);
  }
  function doImport(text, where) {
    var st = B.importWindow(text);
    if (st.refusal) { showStatus('bad', 'Refused ' + where + ': ' + st.refusal.reason); return false; }
    state.apCache = {};
    if (st.from === '38-burn-out') {
      var src = st.src, set = Object.assign(B.defaults(), st.set);
      state.set = set;
      if (src.window) setPreset('import', src, 'Imported this page\'s handoff (idea 37\'s inside)');
      else if (src.apollo17) { state.apEngine = set.engine || 'flown'; setPreset('apollo', src); }
      else { state.custom = src.custom; setPreset('custom', src); }
      showStatus('ok', 'Imported this page\'s handoff ' + where + ' and recomputed it: it matches.');
    } else {
      state.set = B.defaults();
      setPreset('import', { window: st }, 'Imported idea 37\'s handoff (' + (st.h37.inputs && st.h37.inputs.asymptote && st.h37.inputs.asymptote.source ? 'asymptote: ' + String(st.h37.inputs.asymptote.source).slice(0, 80) : 'from idea 37') + ')');
      showStatus('ok', 'Imported idea 37\'s handoff ' + where + ': its coast re-flown lands on its departure point (' + st.check.coastMiss_m.toExponential(1) + ' m).');
    }
    compute();
    return true;
  }

  // ------------------------------------------------------------------ events
  $('preChain').addEventListener('click', function () { state.set = Object.assign(B.defaults(), { steering: state.set.steering }); setPreset('chain', { window: CHAIN }); compute(); });
  $('preApollo').addEventListener('click', function () { state.set = Object.assign(B.defaults(), { steering: state.set.steering }); setPreset('apollo', { apollo17: true }); compute(); });
  $('preCustom').addEventListener('click', function () { state.set = Object.assign(B.defaults(), { steering: state.set.steering }); setPreset('custom', { custom: state.custom }); compute(); });
  $('apEngine').addEventListener('change', function () { state.apEngine = this.value; compute(); });
  var payT = null;
  $('payRange').addEventListener('input', function () { busy(true); $('payIn').value = this.value; state.set.payloadKg = +this.value; clearTimeout(payT); payT = setTimeout(function () { schedule(0); }, 120); });
  $('payIn').addEventListener('change', function () { var v = this.value.trim() === '' ? NaN : +this.value; state.set.payloadKg = v; schedule(0); });
  var customIds = { cAlt: ['altitudeKm', 1], cInc: ['inclinationDeg', 1], cC3: ['c3', 1e6], cPay: ['payloadKg', 1], cInert: ['inertKg', 1], cProp: ['propellantKg', 1], cThrust: ['thrustN', 1000], cIsp: ['veMS', G0] };
  Object.keys(customIds).forEach(function (id) { $(id).addEventListener('change', function () { var v = this.value.trim() === '' ? NaN : +this.value; state.custom[customIds[id][0]] = v * customIds[id][1]; state.src = { custom: state.custom }; schedule(0); }); });
  $('cJ2').addEventListener('change', function () { state.custom.j2 = this.checked; state.src = { custom: state.custom }; schedule(0); });
  $('twRange').addEventListener('input', function () { var tw = Math.pow(10, +this.value); $('twIn').value = +tw.toFixed(3); setTW(tw); });
  $('twIn').addEventListener('change', function () { setTW(+this.value); });
  $('twReset').addEventListener('click', function () { state.set.thrustScale = 1; schedule(0); });
  document.querySelectorAll('[data-steer]').forEach(function (b) { b.addEventListener('click', function () { state.set.steering = b.dataset.steer; if (b.dataset.steer !== 'tangential') state.set.burns = 1; schedule(0); }); });
  document.querySelectorAll('[data-n]').forEach(function (b) { b.addEventListener('click', function () { if (b.disabled) return; state.set.burns = +b.dataset.n; if (state.set.burns > 1) state.set.steering = 'tangential'; schedule(0); }); });
  var tw = $('twChart');
  var twFromEvent = function (ev) { var r = tw.getBoundingClientRect(), wv = TWX.w || 640, x = (ev.clientX - r.left) / r.width * wv; return Math.pow(10, Math.log10(0.12) + (x - 58) / (wv - 72) * (Math.log10(3.4) - Math.log10(0.12))); };
  tw.addEventListener('pointerdown', function (ev) { if (state.preset === 'apollo') return; setTW(twFromEvent(ev)); });
  tw.addEventListener('keydown', function (ev) { var sc = state.R && state.R.sc; if (!sc || state.preset === 'apollo') return; if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { setTW(sc.tw0 * 1.05); ev.preventDefault(); } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { setTW(sc.tw0 / 1.05); ev.preventDefault(); } });
  $('importBtn').addEventListener('click', function () { var t = $('importText').value.trim(); if (!t) { showStatus('bad', 'Paste a handoff first.'); return; } doImport(t, 'from the text box'); });
  $('copyBtn').addEventListener('click', function () { var s = JSON.stringify(currentHandoff()); if (navigator.clipboard) navigator.clipboard.writeText(s).then(function () { showStatus('ok', 'Copied (' + s.length + ' characters).'); }, function () { $('importText').value = s; showStatus('', 'The clipboard is not available here; the handoff is in the text box.'); }); else { $('importText').value = s; showStatus('', 'The handoff is in the text box.'); } });
  $('dlBtn').addEventListener('click', function () { var s = JSON.stringify(currentHandoff(), null, 1), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'application/json' })); a.download = 'burn-out-handoff.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0); showStatus('ok', 'Downloaded burn-out-handoff.json.'); });
  $('linkBtn').addEventListener('click', function () { var u = location.href.split('#')[0] + '#h=' + b64e(JSON.stringify(currentHandoff())); if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { showStatus('ok', 'Link copied (' + u.length + ' characters).'); }, function () { showStatus('', 'Link: ' + u.slice(0, 120) + '…'); }); else showStatus('', 'Link: ' + u.slice(0, 120) + '…'); });

  var rsz = null;
  window.addEventListener('resize', function () { clearTimeout(rsz); rsz = setTimeout(function () { if (state.R) { drawTW(); drawPlane(); drawSteer(); } }, 120); });

  // ------------------------------------------------------------------ start
  var hash = location.hash || '';
  var m = /[#&]h=([^&]+)/.exec(hash), ok = false;
  if (m) { try { ok = doImport(b64d(m[1]), 'from the link'); } catch (e) { showStatus('bad', 'The link\'s handoff could not be read: ' + e.message); } }
  if (!ok) { setPreset('chain', { window: CHAIN }); compute(); }
})();
