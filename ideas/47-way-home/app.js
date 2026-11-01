/* Way Home (idea 47): the page. All physics is in home.js and the snapshots; this file wires controls, draws, and
 * moves handoffs. Classic script, no network. */
(function () {
  'use strict';
  var K = WayHome.create({ LongCoast: LongCoast, LambertsRoad: LambertsRoad, constants: LambertAster, earth: LambertEarth, catalog: CoastCatalog, asterBodies: CoastAsterBodies,
    outerPlanets: CoastOuterPlanets, de440: CoastDE440, nav: CoastNav, erfa: WindowERFA, oracles: WayHomeOracles, outbound: WayHomeOutbound, chain: WayHomeSplit });
  var DAY = 86400, K39 = K.K39, LR = LambertsRoad;
  function $(id) { return document.getElementById(id); }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function f(v, d) {
    if (!num(v)) return '—';
    var a = Math.abs(v), s = d !== undefined ? v.toFixed(d) : (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2)), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+$)/g, ','); return p.join('.');
  }
  function day(t) { return K39.utcOf(t).slice(0, 10); }
  function hm(t) { return K39.utcOf(t).slice(0, 16).replace('T', ' '); }
  function when(t) { return '<span class="small-v">' + day(t) + '<br>' + K39.utcOf(t).slice(11, 16) + ' UTC</span>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  var state = { S: K.defaults(), split: null, R: null, colorBy: 'dv', checks: null, kSel: null, timer: null, seq: 0 };

  // ------------------------------------------------------------------ controls
  K39.bodies.list.forEach(function (b) { var o = document.createElement('option'); o.value = b.designation; o.textContent = b.name; $('bodySel').appendChild(o); });
  function pressed(sel, key, val) { document.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset[key] === String(val))); }); }
  function sync() {
    var S = state.S, cu = S.custom || K.customDefaults();
    pressed('[data-case]', 'case', S.case); pressed('[data-revs]', 'revs', S.revs); pressed('[data-obj]', 'obj', S.objective); pressed('[data-hold]', 'hold', S.hold);
    pressed('[data-arr]', 'arr', S.arrival); pressed('[data-col]', 'col', state.colorBy);
    $('fsCustom').classList.toggle('hide', S.case !== 'custom');
    $('bodySel').value = cu.body; $('stayIn').value = cu.stay_end_utc.slice(0, 10); $('propIn').value = num(cu.propellant_kg) ? +cu.propellant_kg.toPrecision(6) : ''; $('ispIn').value = num(cu.isp_s) ? +cu.isp_s.toPrecision(6) : ''; $('dryIn').value = num(cu.dry_kg) ? +cu.dry_kg.toPrecision(6) : ''; $('boilIn').value = cu.boiloff_kg_per_day;
    $('waitIn').value = S.waitMaxDays; $('waitRange').value = S.waitMaxDays; $('wait0In').value = S.waitMinDays; $('tofMinIn').value = S.tofMinDays; $('tofMaxIn').value = S.tofMaxDays;
    $('gridSel').value = S.nDep + 'x' + S.nTof; $('marginIn').value = +(S.margin * 100).toPrecision(6); $('marginRange').value = S.margin * 100;
    $('tcmIn').value = S.tcm === 'execution' ? '' : S.tcm; $('matIn').value = S.material === 'max' ? '' : S.material;
    $('limIn').value = S.entryLimit_m_s / 1000; $('altIn').value = S.entryAlt_m / 1000; $('aimIn').value = S.aimAlt_m / 1000; $('nbodyChk').checked = !!S.nbody;
  }
  function setS(k, v, keepSel) { state.S[k] = v; if (!keepSel) state.S.selection = null; schedule(250); }
  document.querySelectorAll('[data-case]').forEach(function (b) { b.addEventListener('click', function () { state.S.case = b.dataset.case; if (b.dataset.case === 'custom' && !state.S.custom) state.S.custom = K.customDefaults(); state.S.selection = null; sync(); schedule(10); }); });
  document.querySelectorAll('[data-revs]').forEach(function (b) { b.addEventListener('click', function () { setS('revs', +b.dataset.revs); sync(); }); });
  document.querySelectorAll('[data-obj]').forEach(function (b) { b.addEventListener('click', function () { setS('objective', b.dataset.obj); sync(); }); });
  document.querySelectorAll('[data-hold]').forEach(function (b) { b.addEventListener('click', function () { setS('hold', b.dataset.hold); sync(); }); });
  document.querySelectorAll('[data-arr]').forEach(function (b) { b.addEventListener('click', function () { setS('arrival', b.dataset.arr); sync(); }); });
  document.querySelectorAll('[data-col]').forEach(function (b) { b.addEventListener('click', function () { state.colorBy = b.dataset.col; sync(); drawPork(); }); });
  function numIn(id, fn) { $(id).addEventListener('change', function () { var v = $(id).value.trim(); fn(v === '' ? null : +v); }); }
  function custom(k, v) { var cu = state.S.custom || K.customDefaults(); cu[k] = v; state.S.custom = cu; state.S.selection = null; schedule(250); }
  $('bodySel').addEventListener('change', function () { custom('body', $('bodySel').value); });
  $('stayIn').addEventListener('change', function () { if ($('stayIn').value) custom('stay_end_utc', $('stayIn').value + 'T00:00:00Z'); });
  numIn('propIn', function (v) { custom('propellant_kg', v === null ? NaN : v); });
  numIn('ispIn', function (v) { custom('isp_s', v === null ? NaN : v); });
  numIn('dryIn', function (v) { custom('dry_kg', v === null ? NaN : v); });
  numIn('boilIn', function (v) { custom('boiloff_kg_per_day', v === null ? 0 : v); });
  numIn('waitIn', function (v) { setS('waitMaxDays', v === null ? NaN : v); sync(); });
  $('waitRange').addEventListener('input', function () { $('waitIn').value = $('waitRange').value; });
  $('waitRange').addEventListener('change', function () { setS('waitMaxDays', +$('waitRange').value); });
  numIn('wait0In', function (v) { setS('waitMinDays', v === null ? 0 : v); });
  numIn('tofMinIn', function (v) { setS('tofMinDays', v === null ? NaN : v); });
  numIn('tofMaxIn', function (v) { setS('tofMaxDays', v === null ? NaN : v); });
  $('gridSel').addEventListener('change', function () { var p = $('gridSel').value.split('x'); state.S.nDep = +p[0]; setS('nTof', +p[1]); });
  numIn('marginIn', function (v) { setS('margin', v === null ? NaN : v / 100); sync(); });
  $('marginRange').addEventListener('input', function () { $('marginIn').value = $('marginRange').value; });
  $('marginRange').addEventListener('change', function () { setS('margin', +$('marginRange').value / 100); });
  numIn('tcmIn', function (v) { setS('tcm', v === null ? 'execution' : v); });
  numIn('matIn', function (v) { setS('material', v === null ? 'max' : v, true); });
  // an emptied field is NaN, which the kernel refuses (null * 1000 would have been read as 0 km: review)
  numIn('limIn', function (v) { setS('entryLimit_m_s', v === null ? NaN : v * 1000); });
  numIn('altIn', function (v) { setS('entryAlt_m', v === null ? NaN : v * 1000); });
  numIn('aimIn', function (v) { setS('aimAlt_m', v === null ? NaN : v * 1000, true); });
  $('nbodyChk').addEventListener('change', function () { setS('nbody', $('nbodyChk').checked, true); });
  $('bestBtn').addEventListener('click', function () { state.S.selection = null; schedule(10); });
  $('resetBtn').addEventListener('click', function () { var c = state.S.case; state.S = K.defaults(); state.S.case = c; if (c === 'custom') state.S.custom = K.customDefaults(); state.colorBy = 'dv'; sync(); schedule(10); });

  function schedule(ms) {
    clearTimeout(state.timer);
    $('runNote').textContent = 'Computing: the asteroid flown through the planets, the porkchop, then the chosen return flown home…';
    document.body.classList.add('busy-run');
    state.timer = setTimeout(runNow, ms);
  }
  function runNow() {
    var t = Date.now();
    var R = K.run(state.S, state.S.case === 'custom' ? null : { split: state.split || K.chain });
    state.R = R; state.kSel = null;
    document.body.classList.remove('busy-run');
    $('runNote').textContent = R.refusal ? 'Refused (below).' : 'Computed in ' + ((Date.now() - t) / 1000).toFixed(1) + ' s: ' + R.grid.solved + ' returns solved, ' + (R.grid.excluded.plane + R.grid.excluded.unbound + R.grid.excluded.soi) + ' refused as selections.';
    render();
    state.seq++;
  }

  // ------------------------------------------------------------------ the result
  function chip(c) { return '<span class="c">' + esc(c) + '</span>'; }
  function tile(k, v, u, c, sub, cls) { return '<div class="tile ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + chip(c) + '</div>'; }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · from ' + esc(r.from) : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function srcLine(R) {
    var s = R.src || null;
    if (!s) return '';
    if (s.from === 'custom') return 'Stand-alone: ' + f(s.propellant_kg) + ' kg of propellant at ' + f(s.isp_s) + ' s on ' + f(s.dry_kg) + ' kg dry, at ' + esc(s.body.name) + ', from ' + esc(s.stayEndUtc.slice(0, 10)) + '.';
    return 'Idea 46\'s handoff: ' + (s.propellant_kg === null ? 'propellant refused' : f(s.propellant_kg, 2) + ' kg of ' + esc(s.fuelName || '') + (s.oxName ? '/' + esc(s.oxName) + ' at O/F ' + f(s.of, 2) : '') + ', Isp ' + f(s.isp_s, 1) + ' s') + ', ' + f(s.dry_kg) + ' kg dry, at ' + esc(s.body.name) + '; the stay ended ' + esc(s.stayEndUtc.slice(0, 16).replace('T', ' ')) + ' UTC.' + (s.material_available_kg !== null ? ' Idea 45 dug ' + f(s.material_available_kg) + ' kg of rock (less its water).' : '');
  }
  function render() {
    var R = state.R;
    $('srcLine').textContent = R && !R.refusal ? srcLine(R) : '';
    if (!R || R.refusal) {
      $('tiles').innerHTML = ''; $('ledger').innerHTML = ''; $('rideLine').textContent = ''; $('carried').classList.add('hide');
      $('refusals').innerHTML = R && R.refusal ? refusalHtml(R.refusal) : '';
      ['porkChart', 'dateChart', 'orbitChart'].forEach(function (id) { blank(id); });
      ['porkLegend', 'dateLegend', 'orbitLegend'].forEach(function (id) { $(id).innerHTML = ''; });
      $('porkCap').textContent = $('dateCap').textContent = $('orbitCap').textContent = 'Nothing to draw: the settings were refused.';
      return;
    }
    var sel = R.sel, fl = R.flight && R.flight.converged ? R.flight : null, M = R.mass, conf = R.src.from === 'custom' || R.src.refusals46.some(function (r) { return r.applies_to === 'water'; }) ? 'assumed' : 'derived';
    var t = '';
    if (sel) {
      var dvUsed = fl ? fl.dvMag : sel.q.dvMag, vinf = fl ? fl.flown.v_infinity_m_s : sel.q.vinfMag, arrT = fl ? fl.flown.perigee_tdb : sel.arrTdb;
      t += tile('Leave the asteroid', when(sel.depTdb), '', 'derived', f((sel.depTdb - R.src.stayEnd) / DAY, 1) + ' days after the stay', 'date');
      t += tile('Flight', f(sel.tofS / DAY, 1), 'days', 'derived', (sel.fam.M ? sel.fam.M + ' revolution, ' + sel.fam.branch : 'direct') + ', ' + f(sel.cell.theta * 180 / Math.PI, 0) + '° around the Sun');
      t += tile('Reach the Earth', when(arrT), '', 'derived', fl ? 'perigee ' + f(fl.flown.perigee_altitude_m / 1000, 1) + ' km (aimed at ' + f(R.S.aimAlt_m / 1000) + ')' : 'patched conic (Earth\'s centre)', 'date');
      t += tile('Δv at the asteroid', f(dvUsed, dvUsed < 100 ? 2 : 0), 'm/s', 'derived', fl ? 'flown through the planets; patched conic ' + f(sel.q.dvMag, sel.q.dvMag < 100 ? 2 : 0) : (R.flight && R.flight.refusal ? 'patched conic (the flight did not converge)' : 'patched conic'), 'hero');
      if (M) t += tile('Δv the propellant gives', f(M.capacity_m_s, M.capacity_m_s < 100 ? 1 : 0), 'm/s', conf, 'with nothing aboard, after ' + f(M.ledger.boiloff_wait_kg, 2) + ' kg boiled', M.material_max_kg < 0 ? 'bad' : '');
      if (M) t += tile('Material home', M.material_max_kg >= 0 ? f(M.material_kg) : 'cannot return', M.material_max_kg >= 0 ? 'kg' : '', conf, M.material_max_kg >= 0 ? (M.limited_by === 'material' ? 'all idea 45 dug' : 'what the propellant can push') + (M.material_available_kg !== null ? '; dug ' + f(M.material_available_kg) + ' kg' : '') : 'even empty the burn is too big', M.material_max_kg >= 0 ? 'hero' : 'bad');
      else t += tile('Material home', 'refused', '', 'refused', 'idea 46 refused the propellant', 'refused');
      t += tile('Arrival v∞', f(vinf / 1000, 3), 'km/s', 'derived', 'declination ' + f(fl ? fl.flown.dec_deg : sel.q.decDeg, 1) + '°' + (R.burns.dv2 > 0 ? '; braked to ' + f(R.burns.vinfAfter / 1000, 3) : ''));
      t += tile('Entry speed at ' + f(R.S.entryAlt_m / 1000) + ' km', f(R.entry.speed_m_s / 1000, 2), 'km/s', 'derived', 'NHATS limit ' + f(R.S.entryLimit_m_s / 1000, 1), R.entry.speed_m_s > R.S.entryLimit_m_s + 0.5 ? 'warn' : '');
      if (M) t += tile('Mass reaching the Earth', f(M.ledger.mass_arrival_kg), 'kg', conf, 'dry ' + f(R.src.dry_kg) + ' + material + ' + f(M.ledger.fuel_arrival_kg + M.ledger.ox_arrival_kg, 2) + ' kg propellant');
      if (R.twoBody) t += tile('Two-body would say', f(R.twoBody.dv_m_s, R.twoBody.dv_m_s < 100 ? 2 : 0), 'm/s', 'derived', 'Aster\'s elements as a fixed ellipse, ' + f(R.twoBody.offset_m / 1000) + ' km off');
    }
    $('tiles').innerHTML = t;
    $('rideLine').textContent = R.ride ? 'This return rides ' + R.body.name + '\'s own pass by the Earth on ' + hm(R.ride.tdb) + ' UTC (' + f(R.ride.distance_m / 1000) + ' km from the centre, v∞ ' + f(R.ride.v_infinity_m_s / 1000, 3) + ' km/s): the burn only moves that flyby into the atmosphere.' : '';
    $('ledger').innerHTML = M ? ledgerHtml(R) : '';
    var own = R.refusals.filter(function (r) { return !r.from; }), car = R.refusals.filter(function (r) { return r.from; });
    $('refusals').innerHTML = own.map(refusalHtml).join('');
    $('carried').classList.toggle('hide', !car.length);
    $('carriedSum').textContent = car.length + ' refusals carried from ideas ' + car.map(function (r) { return r.from.slice(0, 2); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
    $('carriedList').innerHTML = car.map(refusalHtml).join('');
    drawPork(); drawDates(); drawOrbit();
    if (!state.checks) setTimeout(checks, 30);
  }
  function ledgerHtml(R) {
    var L = R.mass.ledger, p0 = R.src.fuel_kg + R.src.ox_kg, parts = [[L.boiloff_wait_kg, '--warn', 'boiled while waiting'], [L.burned_departure_kg, '--s1', 'burned leaving'], [L.boiloff_cruise_kg, '--crit', 'boiled on the way'], [L.burned_braking_kg, '--s2', 'burned braking'], [L.fuel_arrival_kg + L.ox_arrival_kg, '--s3', 'left at the Earth']];
    var bar = parts.map(function (p) { return p[0] > 0 ? '<i style="width:' + (100 * p[0] / p0).toFixed(3) + '%;background:var(' + p[1] + ')" title="' + esc(p[2]) + '"></i>' : ''; }).join('');
    var kv = parts.map(function (p) { return '<span><i class="key dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(' + p[1] + ');margin-right:6px"></i>' + esc(p[2]) + '</span><span>' + f(p[0], 3) + ' kg</span>'; }).join('');
    return '<div class="ledger-h">Where the ' + f(p0, 2) + ' kg of propellant goes</div><div class="energybar" role="img" aria-label="Propellant: boiled while waiting, burned leaving, boiled on the way, burned braking, left">' + bar + '</div><div class="kv">' + kv +
      '<span>craft + material + propellant leaving</span><span>' + f(L.mass_departure_kg) + ' kg</span></div>';
  }

  // ------------------------------------------------------------------ charts
  function canvasFor(id, ratio) {
    var c = $(id), w = c.clientWidth || 600, h = Math.max(220, Math.min(460, Math.round(w * ratio))), dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { c: c, g: g, w: w, h: h };
  }
  function blank(id) { var o = canvasFor(id, 0.5); o.g.fillStyle = css('--muted'); o.g.font = '13px system-ui'; o.g.fillText('Refused: nothing to draw.', 12, 24); }
  function axes(o, x0, x1, y0, y1, P, xl, yl, logY) {
    var g = o.g; g.strokeStyle = css('--axis'); g.fillStyle = css('--ink-2'); g.font = '11px system-ui'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(P.l, P.t); g.lineTo(P.l, o.h - P.b); g.lineTo(o.w - P.r, o.h - P.b); g.stroke();
    var X = function (x) { return P.l + (x - x0) / (x1 - x0) * (o.w - P.l - P.r); }, Y = logY ? function (y) { return o.h - P.b - (Math.log10(y) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) * (o.h - P.t - P.b); } : function (y) { return o.h - P.b - (y - y0) / (y1 - y0) * (o.h - P.t - P.b); };
    g.textAlign = 'center';
    var span = (x1 - x0) / DAY, step = span > 1500 ? 365.25 : span > 500 ? 182.6 : span > 200 ? 91.3 : 30.4, n = Math.min(8, Math.floor(span / step) + 1);
    for (var i = 0; i <= n; i++) { var tx = x0 + i * step * DAY; if (tx > x1) break; var px = X(tx); if (o.w < 500 && i % 2) continue; g.fillText(day(tx).slice(0, 7), px, o.h - P.b + 14); g.beginPath(); g.moveTo(px, o.h - P.b); g.lineTo(px, o.h - P.b + 4); g.stroke(); }
    g.fillText(xl, (P.l + o.w - P.r) / 2, o.h - 4);
    g.textAlign = 'right';
    var ticks = logY ? [0.1, 1, 10, 100, 1000, 1e4].filter(function (v) { return v >= y0 && v <= y1; }) : niceTicks(y0, y1, 5);
    ticks.forEach(function (v) { var py = Y(v); g.fillText(f(v), P.l - 4, py + 4); g.strokeStyle = css('--grid'); g.beginPath(); g.moveTo(P.l + 1, py); g.lineTo(o.w - P.r, py); g.stroke(); });
    g.save(); g.translate(11, (P.t + o.h - P.b) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(yl, 0, 0); g.restore();
    return { X: X, Y: Y };
  }
  function niceTicks(a, b, n) { var s = Math.pow(10, Math.floor(Math.log10((b - a) / n))), m = (b - a) / n / s, st = (m < 2 ? 2 : m < 5 ? 5 : 10) * s, out = []; for (var v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(v); return out; }
  var RAMP = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];   // viridis anchors, as Aster's porkchop colours
  function ramp(u) { u = Math.max(0, Math.min(1, u)); var x = u * 4, i = Math.min(3, Math.floor(x)), q = x - i, a = RAMP[i], b = RAMP[i + 1]; return 'rgb(' + Math.round(a[0] + q * (b[0] - a[0])) + ',' + Math.round(a[1] + q * (b[1] - a[1])) + ',' + Math.round(a[2] + q * (b[2] - a[2])) + ')'; }
  var PORK = null;
  function drawPork() {
    var R = state.R; if (!R || R.refusal) return;
    var G = R.grid, o = canvasFor('porkChart', 0.55), g = o.g, P = { l: 46, r: 10, t: 8, b: 32 };
    var x0 = G.deps[0], x1 = G.deps[G.nDep - 1], y0 = G.tofs[0] / DAY, y1 = G.tofs[G.nTof - 1] / DAY;
    var A = axes(o, x0, x1, y0, y1, P, 'departure from the asteroid (UTC)', 'flight time (days)');
    var by = state.colorBy, arr = by === 'mat' ? G.mat : by === 'vinf' ? G.vinf : G.dv, lo = Infinity, hi = -Infinity, k;
    for (k = 0; k < arr.length; k++) if (num(arr[k]) && !G.excl[k] && (by !== 'mat' || arr[k] >= 0)) { lo = Math.min(lo, arr[k]); hi = Math.max(hi, arr[k]); }
    var logc = by === 'dv', L0 = logc ? Math.log10(Math.max(lo, 0.1)) : lo, L1 = logc ? Math.min(Math.log10(Math.max(hi, 0.2)), L0 + 3) : hi;
    var cw = (o.w - P.l - P.r) / (G.nDep - 1 || 1), ch = (o.h - P.t - P.b) / (G.nTof - 1 || 1);
    for (var i = 0; i < G.nDep; i++) for (var j = 0; j < G.nTof; j++) {
      k = j * G.nDep + i; var v = arr[k], px = A.X(G.deps[i]) - cw / 2, py = A.Y(G.tofs[j] / DAY) - ch / 2;
      if (G.excl[k]) { g.fillStyle = css('--refused'); g.fillRect(px, py, cw + 0.6, ch + 0.6); continue; }
      if (!num(v) || (by === 'mat' && v < 0)) { if (num(G.dv[k])) { g.fillStyle = css('--refused'); g.fillRect(px, py, cw + 0.6, ch + 0.6); } continue; }
      var u = logc ? (Math.log10(Math.max(v, 0.1)) - L0) / (L1 - L0) : (v - L0) / ((L1 - L0) || 1);
      g.fillStyle = ramp(by === 'mat' ? u : 1 - u); g.globalAlpha = (by !== 'mat' && R.mass && num(G.mat[k]) && G.mat[k] < 0) ? 0.5 : 1; g.fillRect(px, py, cw + 0.6, ch + 0.6); g.globalAlpha = 1;
    }
    g.save(); g.beginPath(); g.rect(P.l, P.t, o.w - P.l - P.r, o.h - P.t - P.b); g.clip();
    (R.encounters || []).forEach(function (en) {   // the ride line: arrivals at the asteroid's own Earth encounter
      g.strokeStyle = css('--ink'); g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath();
      g.moveTo(A.X(x0), A.Y((en.tdb - x0) / DAY)); g.lineTo(A.X(x1), A.Y((en.tdb - x1) / DAY)); g.stroke(); g.setLineDash([]);
    });
    if (R.sel) { var sx = A.X(R.sel.depTdb), sy = A.Y(R.sel.tofS / DAY); g.strokeStyle = css('--ink'); g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 7, 0, 2 * Math.PI); g.stroke(); g.strokeStyle = css('--surface'); g.lineWidth = 1; g.beginPath(); g.arc(sx, sy, 9, 0, 2 * Math.PI); g.stroke(); }
    g.restore();
    PORK = { A: A, G: G, P: P, w: o.w, h: o.h };
    var name = by === 'mat' ? 'material home (kg; more is yellower)' : by === 'vinf' ? 'arrival v∞ (m/s; slower is yellower)' : 'Δv at the asteroid (m/s, log; less is yellower)';
    $('porkLegend').innerHTML = '<li><span class="key band" style="background:linear-gradient(90deg,' + ramp(0) + ',' + ramp(0.5) + ',' + ramp(1) + ');height:10px;width:60px;display:inline-block;vertical-align:middle;margin-right:6px"></span>' + esc(name) + ': ' + f(by === 'mat' ? lo : (logc ? Math.pow(10, L0) : lo)) + ' to ' + f(by === 'mat' ? hi : (logc ? Math.pow(10, L1) : hi)) + '</li><li><span class="key band"></span>refused as a selection, or cannot get home</li>' + ((R.encounters || []).length ? '<li><span class="key dash" style="border-color:' + css('--ink') + '"></span>arriving at the asteroid\'s own Earth pass (riding it home)</li>' : '') + '<li><span class="key dot" style="border:2px solid ' + css('--ink') + ';background:none"></span>chosen</li>';
    $('porkCap').textContent = G.nDep + ' departures × ' + G.nTof + ' flight times, ' + G.solved + ' solved (' + (G.excluded.plane + G.excluded.unbound + G.excluded.soi) + ' refused: ' + G.excluded.plane + ' near 180°, ' + G.excluded.unbound + ' unbound, ' + G.excluded.soi + ' leaving inside the Earth\'s sphere of influence). ' + (R.mass ? 'Faded cells cannot get home with the propellant left on that date. ' : '') + 'Tap a cell to choose it; arrow keys move, Enter refines to the nearby best.';
  }
  function pickCell(i, j, refine) {
    var R = state.R, G = R.grid, k = j * G.nDep + i, fam = G.fam[k];
    if (fam < 0) { $('runNote').textContent = 'No return converges in that cell.'; return; }
    var F = { M: Math.floor(fam / 3), branch: ['single', 'left', 'right'][fam % 3] }, seed = { depTdb: G.deps[i], tofS: G.tofs[j], fam: F, source: 'chosen' };
    if (refine) { var q = K.refine(K.ephemeris(R.body), seed, R.S, K.budgetOf(R.src, R.S), R.src.stayEnd); if (num(q.value)) seed = { depTdb: q.depTdb, tofS: q.tofS, fam: F, source: 'refined' }; }
    state.S.selection = { depTdb: seed.depTdb, tofS: seed.tofS, M: F.M, branch: F.branch, source: seed.source };
    state.kSel = { i: i, j: j };
    schedule(10);
  }
  $('porkChart').addEventListener('click', function (e) {
    if (!PORK) return; var r = $('porkChart').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, G = PORK.G, P = PORK.P;
    var i = Math.round((x - P.l) / (PORK.w - P.l - P.r) * (G.nDep - 1)), j = Math.round((PORK.h - P.b - y) / (PORK.h - P.t - P.b) * (G.nTof - 1));
    if (i < 0 || j < 0 || i >= G.nDep || j >= G.nTof) return; pickCell(i, j, false);
  });
  $('porkChart').addEventListener('keydown', function (e) {
    if (!PORK) return; var G = PORK.G, s = state.kSel || nearestCell();
    var m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (m) { e.preventDefault(); pickCell(Math.max(0, Math.min(G.nDep - 1, s.i + m[0])), Math.max(0, Math.min(G.nTof - 1, s.j + m[1])), false); }
    else if (e.key === 'Enter') { e.preventDefault(); pickCell(s.i, s.j, true); }
  });
  function nearestCell() { var R = state.R, G = R.grid; if (!R.sel) return { i: 0, j: 0 }; return { i: Math.max(0, Math.min(G.nDep - 1, Math.round((R.sel.depTdb - G.deps[0]) / (G.deps[1] - G.deps[0])))), j: Math.max(0, Math.min(G.nTof - 1, Math.round((R.sel.tofS - G.tofs[0]) / (G.tofs[1] - G.tofs[0])))) }; }
  function drawDates() {
    var R = state.R, G = R.grid, o = canvasFor('dateChart', 0.62), g = o.g, P = { l: 46, r: 10, t: 8, b: 32 }, B = K.budgetOf(R.src, R.S);
    var need = G.deps.map(function (td, i) { var m = Infinity; for (var j = 0; j < G.nTof; j++) { var k = j * G.nDep + i; if (!G.excl[k] && num(G.dv[k])) { var b = K.burnsOf(G.dv[k], G.vinf[k], R.S); m = Math.min(m, b.dv1 + b.dv2); } } return m; });
    var cap = B ? G.deps.map(function (td) { return K.capacity(B, td - R.src.stayEnd); }) : null, chosenDv = R.sel && R.burns ? R.burns.dv1 + R.burns.dv2 : null;
    var vals = need.concat(cap || [], num(chosenDv) ? [chosenDv] : []).filter(function (v) { return num(v) && v > 0; });
    var y0 = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, Math.min.apply(null, vals))))), y1 = Math.pow(10, Math.ceil(Math.log10(Math.max.apply(null, vals) * 1.01)));
    var A = axes(o, G.deps[0], G.deps[G.nDep - 1], y0, y1, P, 'departure (UTC)', 'Δv (m/s, log)', true);
    function line(a, col, dash) { g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(dash || []); g.beginPath(); var on = false; a.forEach(function (v, i) { if (!(num(v) && v > 0)) { on = false; return; } var x = A.X(G.deps[i]), y = A.Y(Math.max(v, y0)); if (on) g.lineTo(x, y); else g.moveTo(x, y); on = true; }); g.stroke(); g.setLineDash([]); }
    line(need, css('--s1')); if (cap) line(cap, css('--s2'), [6, 4]);
    if (R.sel) { g.strokeStyle = css('--ink'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(A.X(R.sel.depTdb), P.t); g.lineTo(A.X(R.sel.depTdb), o.h - P.b); g.stroke(); g.setLineDash([]); }
    // the chosen return's own cost (with margin): the ride and the refined windows fall between the grid's flight times (review)
    if (num(chosenDv) && chosenDv > 0) { g.fillStyle = css('--ink'); g.strokeStyle = css('--surface'); g.lineWidth = 1.5; g.beginPath(); g.arc(A.X(R.sel.depTdb), A.Y(Math.max(chosenDv, y0)), 5, 0, 2 * Math.PI); g.fill(); g.stroke(); }
    $('dateLegend').innerHTML = '<li><span class="key" style="border-color:' + css('--s1') + '"></span>least Δv any flight time needs (with margin)</li>' + (cap ? '<li><span class="key dash" style="border-color:' + css('--s2') + '"></span>Δv the propellant gives, empty, after boil-off</li>' : '') + '<li><span class="key dotted" style="border-color:' + css('--ink') + '"></span>chosen departure</li>' + (num(chosenDv) ? '<li><span class="key dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + css('--ink') + ';margin-right:6px"></span>the chosen return\'s Δv (with margin)</li>' : '');
    var cross = null; if (cap) for (var i = 0; i < G.nDep; i++) if (cap[i] < need[i]) { cross = G.deps[i]; break; }
    var chosenTxt = num(chosenDv) ? ' The dot is the chosen return, ' + f(chosenDv, chosenDv < 100 ? 2 : 0) + ' m/s with margin' + (R.sel.source === 'ride' || R.sel.source === 'grid' ? ' (refined between the grid\'s flight times)' : '') + (cap ? (chosenDv <= K.capacity(B, R.sel.depTdb - R.src.stayEnd) ? ', inside what the propellant gives.' : ', more than the propellant gives.') : '.') : '';
    $('dateCap').textContent = (cap ? (cross ? 'On the grid\'s flight times, from ' + day(cross) + ' the cheapest return costs more than the propellant left can give.' : 'Every departure date in the window has a grid return the propellant can pay for.') + (R.S.hold === 'passive' && (R.src.boil.fuel > 0 || R.src.boil.ox > 0) ? ' Waiting costs propellant: idea 46\'s passive boil-off is ' + f(R.src.boil.fuel, 3) + ' kg/day of fuel.' : '') : 'No propellant to compare with (refused upstream).') + chosenTxt;
  }
  function drawOrbit() {
    var R = state.R, o = canvasFor('orbitChart', 0.62), g = o.g;
    if (!R.sel) { g.fillStyle = css('--muted'); g.font = '13px system-ui'; g.fillText('No return chosen.', 12, 24); return; }
    var eph = K.ephemeris(R.body), sel = R.sel, ecl = function (r) { var e = K39.toEcliptic(r); return [e[0], e[1]]; };
    var earth = [], ast = [], arc = [], t, AU = K.constants.au_m;
    for (t = sel.depTdb; t <= sel.depTdb + 366 * DAY; t += 6 * DAY) { var E = K39.earthState(t); if (E) earth.push(ecl(E.r)); }
    for (t = sel.depTdb; t <= sel.arrTdb; t += Math.max(2 * DAY, sel.tofS / 60)) { var S2 = eph.state(t); if (S2) ast.push(ecl(S2.r)); }
    for (var k = 0; k <= 80; k++) { var p = LR.propagate(sel.cell.asteroid.r, sel.q.v1, sel.tofS * k / 80, K.constants.gmSun_m3_s2); if (p) arc.push(ecl(p.r)); }
    var all = earth.concat(ast, arc), m = Math.max.apply(null, all.map(function (q) { return Math.max(Math.abs(q[0]), Math.abs(q[1])); })) * 1.08, s = Math.min(o.w, o.h) / 2 / m, cx = o.w / 2, cy = o.h / 2;
    function path(a, col, w, dash) { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); a.forEach(function (q, i) { var x = cx + q[0] * s, y = cy - q[1] * s; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]); }
    path(earth, css('--s1'), 1.5); path(ast, css('--muted'), 1.5, [4, 4]); path(arc, css('--s2'), 2.5);
    g.fillStyle = css('--warn'); g.beginPath(); g.arc(cx, cy, 5, 0, 2 * Math.PI); g.fill();
    var d0 = arc[0], d1 = arc[arc.length - 1];
    g.fillStyle = css('--ink'); g.beginPath(); g.arc(cx + d0[0] * s, cy - d0[1] * s, 4, 0, 2 * Math.PI); g.fill(); g.fillStyle = css('--s1'); g.beginPath(); g.arc(cx + d1[0] * s, cy - d1[1] * s, 5, 0, 2 * Math.PI); g.fill();
    g.fillStyle = css('--ink-2'); g.font = '11px system-ui'; g.fillText('1 au', cx + AU * s - 12, cy + 14); g.strokeStyle = css('--grid'); g.beginPath(); g.arc(cx, cy, AU * s, 0, 2 * Math.PI); g.stroke();
    $('orbitLegend').innerHTML = '<li><span class="key" style="border-color:' + css('--s2') + '"></span>the return (Kepler arc, patched conic)</li><li><span class="key dash" style="border-color:' + css('--muted') + '"></span>' + esc(R.body.name) + ' meanwhile (n-body)</li><li><span class="key" style="border-color:' + css('--s1') + '"></span>the Earth, one year</li>';
    $('orbitCap').textContent = 'Seen from the ecliptic pole, Sun at the centre (heliocentric J2000 ecliptic). Departure ' + day(sel.depTdb) + ' (black dot); the patched conic reaches the Earth\'s centre ' + hm(sel.arrTdb) + ' UTC (blue dot)' + (R.flight && R.flight.converged ? ', the flight through the planets its perigee ' + hm(R.flight.flown.perigee_tdb) + ' UTC.' : '.');
  }

  // ------------------------------------------------------------------ checks against reality
  function checks() {
    var X = K.reality(), st = X.nhatsStats, O = X.osirisRex, A = X.apophis, rows = [];
    function row(name, why, a, b, gap, cls) { rows.push('<tr><td data-k="Check">' + esc(name) + '<span class="why">' + esc(why) + '</span></td><td data-k="JPL / reality">' + a + '</td><td data-k="This page">' + b + '</td><td data-k="Gap" class="' + (cls || 'gap-ok') + '">' + gap + '</td></tr>'); }
    row('NHATS return legs: departure burn', st.dv.n + ' legs on ' + Object.keys(K.oracles.nhats_bodies).length + ' bodies, JPL patched conics with JPL ephemerides (NHATS prints whole m/s)', 'vrel_dep_neo', 'Lambert from idea 40\'s asteroid', 'median ' + f(st.dv.median, 2) + ' m/s, max ' + f(st.dv.max, 2));
    row('NHATS: arrival v∞', 'capped legs: NHATS\'s 12 km/s entry plus its Earth return dV', 'v_arr_earth at 125 km', 'v∞ at the Earth', 'median ' + f(st.vinf.median, 2) + ' m/s, max ' + f(st.vinf.max, 2));
    row('NHATS: return declination', 'of the arrival v∞, from the ICRF equator', 'dec_arr', 'asin(v∞z / v∞)', 'median ' + f(st.dec.median, 3) + '°, max ' + f(st.dec.max, 3) + '°');
    row('NHATS, the asteroid drawn two-body', 'the same legs with Aster\'s elements as a fixed ellipse (idea 39, Aster\'s porkchop)', 'vrel_dep_neo', 'two-body Lambert', 'median ' + f(st.twoBody.median) + ' m/s, max ' + f(st.twoBody.max), 'gap-bad');
    if (A.here) {
      row('Apophis\'s 2029 pass: time', 'JPL Small-Body Database close approach (orbit ' + K.oracles.apophis2029.orbit_id + ')', K.oracles.apophis2029.cd_tdb + ' TDB', K39.tdbDate(A.here.tdb).slice(0, 10) + ' ' + new Date((A.here.tdb + K.constants.unixToJ2000Days * DAY) * 1000).toISOString().slice(11, 19) + ' TDB', f(A.here.tdb - A.jpl.tdb, 3) + ' s');
      row('Apophis\'s 2029 pass: distance', 'from the Earth\'s centre', f(A.jpl.distance_m / 1000, 1) + ' km', f(A.here.distance_m / 1000, 1) + ' km', (A.here.distance_m >= A.jpl.distance_m ? '+' : '') + f((A.here.distance_m - A.jpl.distance_m) / 1000, 2) + ' km');
      row('Apophis\'s 2029 pass: v∞', 'two-body at closest approach, as JPL tabulates it', f(A.jpl.v_infinity_m_s, 3) + ' m/s', f(A.here.v_infinity_m_s, 3) + ' m/s', f(A.here.v_infinity_m_s - A.jpl.v_infinity_m_s, 4) + ' m/s');
    }
    row('OSIRIS-REx leaving Bennu', 'JPL Horizons\' reconstruction: the velocity change across its 2021-05-10 departure burn, against Lambert (' + O.M + ' rev, ' + O.branch + ') to the Earth at its flown perigee, ' + f(O.tof_days, 1) + ' days later', f(O.actual_dv_m_s, 1) + ' m/s', f(O.lambert_dv_m_s, 1) + ' m/s, ' + f(O.dv_angle_deg, 1) + '° off', (O.lambert_dv_m_s > O.actual_dv_m_s ? '+' : '') + f(100 * (O.lambert_dv_m_s / O.actual_dv_m_s - 1), 2) + ' %');
    row('OSIRIS-REx arriving', 'its geocentric hyperbola from the last hourly Horizons row still bound for the atmosphere (' + O.approach_row_tdb.slice(0, 17) + ' TDB), before the divert', f(O.actual_vinf_m_s, 1) + ' m/s, dec ' + f(O.actual_dec_deg, 2) + '°', f(O.lambert_vinf_m_s, 1) + ' m/s, dec ' + f(O.lambert_dec_deg, 2) + '°', f(100 * (O.lambert_vinf_m_s / O.actual_vinf_m_s - 1), 2) + ' %');
    var R = state.R;
    if (X.outbound && R && R.flight && R.flight.converged && R.src.body.designation === '99942') row('Aster\'s sample-return burn', 'delta-v.ts prices the return burn as the outbound arrival v∞ (the chain\'s, idea 39); NHATS\'s ' + st.symmetric.n + ' round trips put return / arrival at ' + f(X.nhatsStats.symMin, 2) + ' to ' + f(st.symmetric.max, 2) + ' (median ' + f(st.symmetric.median, 2) + ')', f(X.outbound.lamberts_road.v_infinity_arrival_m_s) + ' m/s', f(R.flight.dvMag, 2) + ' m/s', '×' + (R.flight.dvMag / X.outbound.lamberts_road.v_infinity_arrival_m_s).toPrecision(2), 'gap-bad');
    state.checks = true;
    $('checkTable').querySelector('tbody').innerHTML = rows.join('');
  }

  // ------------------------------------------------------------------ handoff
  function status(msg, ok) { var s = $('hoStatus'); s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'bad'); }
  function current() { var R = state.R; if (!R || R.refusal || !R.sel) return null; return K.buildHandoff(R); }
  function importText(text) {
    var p = K.parseHandoff(text);
    if (p.refusal) { status('Refused: ' + p.refusal.reason, false); return false; }
    if (p.from === '46-split') { state.split = p.split; state.S = K.defaults(); sync(); schedule(10); status('Imported idea 46\'s handoff (' + p.src.body.name + ', ' + (p.src.propellant_kg === null ? 'propellant refused' : f(p.src.propellant_kg, 2) + ' kg') + ').', true); return true; }
    state.split = p.split; state.S = JSON.parse(JSON.stringify(p.settings)); state.R = p.R; sync(); render(); state.seq++;
    $('runNote').textContent = 'Read back this page\'s handoff: every output reproduced from its inputs.'; status('Imported and verified this page\'s handoff.', true); return true;
  }
  $('importBtn').addEventListener('click', function () { importText($('importText').value); });
  $('importFile').addEventListener('change', function () { var file = $('importFile').files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { importText(String(rd.result)); }; rd.readAsText(file); });
  $('copyBtn').addEventListener('click', function () {
    var h = current(); if (!h) { status('Nothing to export: no return is chosen (see the refusals).', false); return; }
    var s = JSON.stringify(h); $('importText').value = s;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { status('Copied (' + s.length + ' characters).', true); }, function () { $('importText').select(); status('The clipboard is blocked here: the handoff is in the box above, selected.', true); });
    else { $('importText').select(); status('The handoff is in the box above, selected.', true); }
  });
  $('dlBtn').addEventListener('click', function () {
    var h = current(); if (!h) { status('Nothing to export: no return is chosen (see the refusals).', false); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(h, null, 1)], { type: 'application/json' })); a.download = 'way-home-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded way-home-handoff.json.', true);
  });
  $('linkBtn').addEventListener('click', function () {
    var h = current(); if (!h) { status('Nothing to export: no return is chosen (see the refusals).', false); return; }
    var url = location.href.split('#')[0] + '#h=' + K.b64urlEncode(JSON.stringify(h)); $('importText').value = url;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { status('Link copied (' + url.length + ' characters).', true); }, function () { status('The link is in the box above.', true); });
    else status('The link is in the box above.', true);
  });

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (state.R && !state.R.refusal) { drawPork(); drawDates(); drawOrbit(); } }, 150); });
  window.WayHomePage = { K: K, state: state, importText: importText, schedule: schedule, runNow: runNow, pickCell: pickCell };
  sync();
  var m = /#h=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) { var txt = null; try { txt = K.b64urlDecode(m[1]); } catch (e) { status('The link\'s handoff is not readable.', false); } if (!txt || !importText(txt)) schedule(10); }
  else schedule(10);
})();
