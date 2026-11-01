/* Catch (idea 48): the page. All physics is in catch.js and the snapshots; this file wires controls, draws, and moves
 * handoffs. Classic script, no network. */
(function () {
  'use strict';
  var K = Catch.create({ isa: PartForgeISA, earth: MaxQEarth, radii: CatchEarthRadii, de440: CoastDE440, erfa: WindowERFA, sources: CatchSources,
    TipMatch: TipMatch, revA: REV_A, aster: ASTER_DATA, chain: CatchWayHome });
  var DEG = Math.PI / 180;
  function $(id) { return document.getElementById(id); }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function f(v, d) {
    if (!num(v)) return '—';
    var a = Math.abs(v), s = d !== undefined ? v.toFixed(d) : (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2)), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+$)/g, ','); return p.join('.');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  var state = { S: K.defaults(), h47: null, R: null, seq: 0, timer: null, sweep: null, sweepKey: null, checks: false };
  var LABELS = { direct: 'Direct entry', skip: 'Skip entry (no burn)', aerocapture: 'Aerocapture', propulsive: 'Capture burn', lunar: 'Lunar flyby', skyhook: 'Skyhook catch' };

  // ------------------------------------------------------------------ controls
  K.VEH_ORDER.forEach(function (id) { var o = document.createElement('option'); o.value = id; o.textContent = K.VEHICLES[id].label + ' (' + K.VEHICLES[id].shape + ')'; $('vehSel').appendChild(o); });
  function pressed(sel, key, val) { document.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset[key] === String(val))); }); }
  function sync() {
    var S = state.S, cu = S.custom || K.customDefaults();
    pressed('[data-arr]', 'arr', S.arrival === 'imported' ? 'chain' : S.arrival); pressed('[data-mass]', 'mass', S.vehicleMass === 'preset' ? 'preset' : 'arrival');
    pressed('[data-moon]', 'moon', S.moonDist); pressed('[data-choice]', 'choice', S.choice);
    $('fsCustom').classList.toggle('hide', S.arrival !== 'custom');
    $('vinfIn').value = num(cu.vinf_m_s) ? +(cu.vinf_m_s / 1000).toPrecision(6) : ''; $('vinfRange').value = num(cu.vinf_m_s) ? Math.min(8, cu.vinf_m_s / 1000) : 0;
    $('massIn').value = num(cu.mass_kg) ? +cu.mass_kg.toPrecision(7) : ''; $('propIn').value = num(cu.propellant_kg) ? +cu.propellant_kg.toPrecision(6) : ''; $('ispIn').value = num(cu.isp_s) ? +cu.isp_s.toPrecision(6) : '';
    $('vehSel').value = S.vehicle; $('fpaIn').value = num(S.fpaDeg) ? +S.fpaDeg.toFixed(3) : ''; $('fpaRange').value = num(S.fpaDeg) ? S.fpaDeg : (state.R && state.R.options && num(state.R.options.direct.gamma) ? state.R.options.direct.gamma : -8);
    $('bankIn').value = S.bankDeg; $('bankRange').value = S.bankDeg; $('gIn').value = S.gLimit; $('qIn').value = S.qLimit_W_cm2; $('orbIn').value = S.targetAlt_m / 1000;
    $('lgaIn').value = S.lgaAlt_m / 1000; $('tolIn').value = S.tolerance_m_s; $('marginIn').value = +(S.margin * 100).toPrecision(6);
  }
  function setS(k, v) { state.S[k] = v; sync(); schedule(250); }
  document.querySelectorAll('[data-arr]').forEach(function (b) { b.addEventListener('click', function () { var a = b.dataset.arr; state.S.arrival = a === 'chain' && state.h47 && !K.importWayHome(state.h47).chain ? 'imported' : a; if (a === 'custom' && !state.S.custom) state.S.custom = K.customDefaults(); state.S.fpaDeg = null; sync(); schedule(10); }); });
  document.querySelectorAll('[data-mass]').forEach(function (b) { b.addEventListener('click', function () { setS('vehicleMass', b.dataset.mass); }); });
  document.querySelectorAll('[data-moon]').forEach(function (b) { b.addEventListener('click', function () { setS('moonDist', b.dataset.moon); }); });
  document.querySelectorAll('[data-choice]').forEach(function (b) { b.addEventListener('click', function () { setS('choice', b.dataset.choice); }); });
  function numIn(id, fn) { $(id).addEventListener('change', function () { var v = $(id).value.trim(); fn(v === '' ? null : +v); }); }
  function custom(k, v) { var cu = state.S.custom || K.customDefaults(); cu[k] = v; state.S.custom = cu; sync(); schedule(250); }
  // an emptied field is NaN where empty is not allowed: the kernel refuses it (it is never read as zero)
  numIn('vinfIn', function (v) { custom('vinf_m_s', v === null ? NaN : v * 1000); });
  $('vinfRange').addEventListener('input', function () { $('vinfIn').value = $('vinfRange').value; });
  $('vinfRange').addEventListener('change', function () { custom('vinf_m_s', +$('vinfRange').value * 1000); });
  numIn('massIn', function (v) { custom('mass_kg', v === null ? NaN : v); });
  numIn('propIn', function (v) { custom('propellant_kg', v === null ? NaN : v); });
  numIn('ispIn', function (v) { custom('isp_s', v === null ? NaN : v); });
  $('vehSel').addEventListener('change', function () { setS('vehicle', $('vehSel').value); });
  numIn('fpaIn', function (v) { setS('fpaDeg', v); });
  $('fpaRange').addEventListener('input', function () { $('fpaIn').value = $('fpaRange').value; });
  $('fpaRange').addEventListener('change', function () { setS('fpaDeg', +$('fpaRange').value); });
  numIn('bankIn', function (v) { setS('bankDeg', v === null ? NaN : v); });
  $('bankRange').addEventListener('input', function () { $('bankIn').value = $('bankRange').value; });
  $('bankRange').addEventListener('change', function () { setS('bankDeg', +$('bankRange').value); });
  numIn('gIn', function (v) { setS('gLimit', v === null ? NaN : v); });
  numIn('qIn', function (v) { setS('qLimit_W_cm2', v === null ? NaN : v); });
  numIn('orbIn', function (v) { setS('targetAlt_m', v === null ? NaN : v * 1000); });
  numIn('lgaIn', function (v) { setS('lgaAlt_m', v === null ? NaN : v * 1000); });
  numIn('tolIn', function (v) { setS('tolerance_m_s', v === null ? NaN : v); });
  numIn('marginIn', function (v) { setS('margin', v === null ? NaN : v / 100); });
  $('resetBtn').addEventListener('click', function () { var a = state.S.arrival; state.S = K.defaults(); state.S.arrival = a; if (a === 'custom') state.S.custom = K.customDefaults(); sync(); schedule(10); });

  function schedule(ms) {
    clearTimeout(state.timer);
    $('runNote').textContent = 'Computing: every option, flown through the air for the corridors…';
    state.timer = setTimeout(runNow, ms);
  }

  // ------------------------------------------------------------------ one run
  function runNow() {
    var R;
    try { R = K.run(state.S, state.h47 ? { h47: state.h47 } : null); }
    catch (e) { R = { refusal: { code: 'invalid_input', reason: 'The kernel failed: ' + e.message, what_would_help: 'Reset.' } }; }
    state.R = R;
    if (R.refusal) {
      $('runNote').textContent = 'Refused.';
      $('optTable').querySelector('tbody').innerHTML = '<tr><td colspan="6">' + refHtml(R.refusal) + '</td></tr>';
      $('tiles').innerHTML = ''; $('choiceLine').textContent = ''; $('refusals').innerHTML = refHtml(R.refusal); $('optNote').textContent = '';
      ['gChart', 'apoChart', 'passChart', 'loadChart', 'vinfChart'].forEach(blank);
      state.seq++; return;
    }
    sync();
    var A = R.arrival;
    $('srcLine').innerHTML = esc(A.label) + ': ' + (num(A.vinf) ? 'v∞ <b>' + f(A.vinf / 1000, 3) + ' km/s</b>' : 'bound to the Earth (C3 ' + f(A.c3 / 1e6, 2) + ' km²/s²)') +
      ', ' + f(R.vehicle.mass_kg) + ' kg in the air' + (A.kind === 'hyperbola' ? ', ' + f(A.propellant_kg, 2) + ' kg of propellant left, asymptote declination ' + f(A.decl, 1) + '°' : ', no engine') + '.';
    renderOptions(R); renderHanded(R);
    if (!state.checks) renderChecks();
    drawVinf(R); drawPass(R);
    $('runNote').textContent = 'Done. Choice: ' + (R.choice ? LABELS[R.choice] : 'none feasible') + '.';
    state.seq++;
    setTimeout(function () { sweep(R); drawCorridor(R); }, 0);
  }
  function refHtml(r) { return '<div class="refusal"><b>' + esc(r.code) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · from ' + esc(r.from) : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function verdict(o) {
    if (o.feasible) return '<span class="chip ok">✓ feasible</span>';
    if (o.energy_ok || (o.id === 'skyhook' && o.energy_ok)) return '<span class="chip part">◐ energy only</span>';
    return '<span class="chip no">✕ refused</span>';
  }
  function renderOptions(R) {
    var rows = [], keys = ['direct', 'skip', 'aerocapture', 'propulsive', 'lunar', 'skyhook'];
    keys.forEach(function (k) {
      var o = R.options[k], L = o.loads || {}, need = num(o.propellant_needed) ? f(o.propellant_needed) + ' kg' : '—';
      var peak = num(L.peak_g) ? f(L.peak_g, 1) + ' g · ' + f(L.peak_q_W_m2 / 1e4) + ' W/cm²' : (k === 'lunar' && num(o.vinf_after) ? 'v∞ after ' + f(o.vinf_after / 1000, 2) + ' km/s' : k === 'skyhook' && o.tiers ? 'trim ' + f(Math.abs(o.tiers.slice().sort(function (a, b) { return Math.abs(a.trim_m_s) - Math.abs(b.trim_m_s); })[0].trim_m_s)) + ' m/s' : '—');
      var corr = o.corridor && num(o.corridor.width_deg) ? f(o.corridor.width_deg, 2) + '°' + (num(o.corridor.steep_deg) ? '<span class="sub">' + f(o.corridor.steep_deg, 2) + '° to ' + f(o.corridor.shallow_deg, 2) + '°</span>' : '') : (k === 'lunar' ? 'captures v∞ < ' + f(o.threshold_vinf / 1000, 2) + ' km/s' : k === 'skip' && num(o.gamma) ? 'aerocapture\'s mid-angle' : '—');
      rows.push('<tr class="opt' + (R.choice === k ? ' hl' : '') + '" tabindex="0" data-opt="' + k + '"><td data-k="Option"><b>' + esc(LABELS[k]) + '</b><span class="sub">to ' + esc(o.destination) + (R.choice === k ? ' · handed on' : '') + '</span></td><td data-k="Verdict">' + verdict(o) + '</td><td data-k="Δv" class="n">' + (num(o.dv) ? f(o.dv) + ' m/s' : '—') + '</td><td data-k="Propellant" class="n">' + need + (num(o.propellant_needed) ? '<span class="sub">' + f(R.arrival.propellant_kg || 0, 1) + ' kg aboard</span>' : '') + '</td><td data-k="Peak" class="n">' + peak + '</td><td data-k="Corridor" class="n">' + corr + '</td></tr>');
      if (o.refusals && o.refusals.length) rows.push('<tr class="optref hide" data-for="' + k + '"><td colspan="6">' + o.refusals.map(refHtml).join('') + '</td></tr>');
    });
    var tb = $('optTable').querySelector('tbody'); tb.innerHTML = rows.join('');
    tb.querySelectorAll('tr.opt').forEach(function (tr) {
      var tog = function () { var x = tb.querySelector('tr.optref[data-for="' + tr.dataset.opt + '"]'); if (x) x.classList.toggle('hide'); };
      tr.addEventListener('click', tog); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } });
    });
    $('optNote').textContent = 'Tap a row for its refusals. Peak = deceleration and stagnation-point convective heating. Corridor = the range of entry angles (deg at 125 km) that work. ' + (R.chosenBy ? 'Choice: ' + R.chosenBy + '.' : '');
  }
  function tile(k, v, u, c, sub, cls) { return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '<span class="c">' + esc(c) + '</span></div>'; }
  function renderHanded(R) {
    var C = R.choice ? R.options[R.choice] : null, E = R.entry, T = [];
    $('choiceLine').innerHTML = C ? '<b>' + esc(LABELS[R.choice]) + '</b> (' + esc(R.chosenBy) + ') with the ' + esc(R.vehicle.label) + ', ballistic coefficient ' + f(K.betaOf(R.vehicle)) + ' kg/m².' : 'Nothing is handed on: no option is feasible.';
    if (E && num(E.speed_inertial_m_s)) {
      T.push(tile('Entry speed', f(E.speed_inertial_m_s / 1000, 3), 'km/s', 'derived', 'relative to the air ' + f(E.speed_relative_m_s / 1000, 3) + ' km/s', E.speed_inertial_m_s > K.ENTRY_LIMIT ? 'warn' : ''));
      T.push(tile('Entry angle', f(E.fpa_inertial_deg, 2), '°', 'derived', 'relative ' + f(E.fpa_relative_deg, 2) + '°, heading ' + f(E.heading_inertial_deg, 0) + '°', 'hero'));
      if (num(E.latitude_deg)) T.push(tile('Where', f(E.latitude_deg, 1) + '°' + (num(E.longitude_deg) ? ', ' + f(E.longitude_deg, 1) + '°' : ''), '', 'derived', E.utc ? 'lat, lon · ' + E.utc.slice(0, 19).replace('T', ' ') + ' UTC' : 'latitude (the landing site\'s; no time on file)'));
    }
    if (C && C.loads) {
      T.push(tile('Peak deceleration', f(C.loads.peak_g, 1), 'g', 'derived', 'limit ' + f(R.S.gLimit) + ' g', C.loads.peak_g > R.S.gLimit ? 'bad' : ''));
      T.push(tile('Peak heating', f(C.loads.peak_q_W_m2 / 1e4), 'W/cm²', 'derived', 'convective only · limit ' + f(R.S.qLimit_W_cm2), C.loads.peak_q_W_m2 > R.limits.q ? 'bad' : ''));
      T.push(tile('Heat load', f(C.loads.heat_J_m2 / 1e7, 1), 'kJ/cm²', 'derived', C.loads.n_passes ? C.loads.n_passes + ' passes, ' + f(C.loads.t_total_s / 60) + ' min' : 'one pass'));
    }
    if (R.retarget) T.push(tile('Aim perigee', f(R.retarget.perigee_alt_m / 1000, 1), 'km', 'derived', 'idea 47 aims at ' + (num(R.retarget.perigee_alt47_m) ? f(R.retarget.perigee_alt47_m / 1000, 1) + ' km' : '—')));
    if (C && C.orbit) T.push(tile('Orbit', f(C.orbit.peri_alt_m / 1000) + ' × ' + f(C.orbit.apo_alt_m / 1000), 'km', 'derived', 'after the capture'));
    if (R.choice === 'skyhook' && C.release) T.push(tile('Released at', f(C.release.entry_speed_inertial_m_s / 1000, 2), 'km/s', 'derived', 'from the lower tip, ' + f(C.release.entry_fpa_deg, 1) + '° at 125 km'));
    T.push(tile('Mass in the air', f(R.vehicle.mass_kg), 'kg', 'assumed', 'no heat shield counted'));
    $('tiles').innerHTML = T.join('');
    $('refusals').innerHTML = R.refusals.map(refHtml).join('');
    $('carriedSum').textContent = 'Refusals carried from earlier modules (' + R.carried.length + ')';
    $('carriedList').innerHTML = R.carried.map(refHtml).join('') || '<p class="small">None.</p>';
  }

  // ------------------------------------------------------------------ charts
  function canvasFor(id, ratio) {
    var c = $(id), w = c.clientWidth || 600, h = Math.max(220, Math.min(420, Math.round(w * ratio))), dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { c: c, g: g, w: w, h: h };
  }
  function blank(id) { var o = canvasFor(id, 0.5); o.g.fillStyle = css('--muted'); o.g.font = '13px system-ui'; o.g.fillText('Refused: nothing to draw.', 12, 24); }
  function niceTicks(a, b, n) { var s = Math.pow(10, Math.floor(Math.log10((b - a) / n))), m = (b - a) / n / s, st = (m < 2 ? 2 : m < 5 ? 5 : 10) * s, out = []; for (var v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toPrecision(10)); return out; }
  function axes(o, x0, x1, y0, y1, P, xl, yl, logY) {
    var g = o.g; g.strokeStyle = css('--axis'); g.fillStyle = css('--ink-2'); g.font = '11px system-ui'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(P.l, P.t); g.lineTo(P.l, o.h - P.b); g.lineTo(o.w - P.r, o.h - P.b); g.stroke();
    var X = function (x) { return P.l + (x - x0) / (x1 - x0) * (o.w - P.l - P.r); };
    var Y = logY ? function (y) { return o.h - P.b - (Math.log10(Math.max(y, y0)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) * (o.h - P.t - P.b); } : function (y) { return o.h - P.b - (y - y0) / (y1 - y0) * (o.h - P.t - P.b); };
    g.textAlign = 'center';
    niceTicks(Math.min(x0, x1), Math.max(x0, x1), o.w < 500 ? 4 : 7).forEach(function (v) { var px = X(v); g.fillText(f(v), px, o.h - P.b + 14); g.beginPath(); g.moveTo(px, o.h - P.b); g.lineTo(px, o.h - P.b + 4); g.stroke(); });
    g.fillText(xl, (P.l + o.w - P.r) / 2, o.h - 4);
    g.textAlign = 'right';
    var ticks = logY ? [1, 10, 100, 1000, 1e4, 1e5, 1e6].filter(function (v) { return v >= y0 && v <= y1; }) : niceTicks(y0, y1, 5);
    ticks.forEach(function (v) { var py = Y(v); g.fillStyle = css('--ink-2'); g.fillText(f(v), P.l - 4, py + 4); g.strokeStyle = css('--grid'); g.beginPath(); g.moveTo(P.l + 1, py); g.lineTo(o.w - P.r, py); g.stroke(); });
    g.save(); g.translate(11, (P.t + o.h - P.b) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = css('--ink-2'); g.fillText(yl, 0, 0); g.restore();
    return { X: X, Y: Y };
  }
  function line(g, pts, col, w, dash) { g.strokeStyle = col; g.lineWidth = w || 2; g.setLineDash(dash || []); g.beginPath(); var on = false; pts.forEach(function (p) { if (!p) { on = false; return; } if (on) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); on = true; } }); g.stroke(); g.setLineDash([]); }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key' + (it.dash ? ' dash' : '') + (it.band ? ' band' : '') + '" style="' + (it.band ? 'background:' + it.c : 'border-color:' + it.c) + '"></span>' + esc(it.t) + '</li>'; }).join(''); }

  var G0 = -2, G1 = -16, GSTEP = 0.25, BANKS = [0, 90, 180];
  function sweep(R) {
    var key = JSON.stringify([R.arrival.id, R.arrival.vinf, R.vehicle.id, R.vehicle.mass_kg, R.S.custom]);
    if (state.sweepKey === key && state.sweep) return;
    var b = K.builderOf(R.arrival), out = {};
    BANKS.forEach(function (bk) { out[bk] = []; for (var g = G0; g >= G1 - 1e-9; g -= GSTEP) { var fl = K.fly(b(g), R.vehicle, { bankDeg: bk, dt: 0.2, vStop: 1500 }); out[bk].push({ g: g, peak: fl.peak_g, end: fl.end, apo: fl.exit && fl.exit.bound ? fl.exit.apo_alt : null }); } });
    state.sweep = out; state.sweepKey = key;
  }
  var COL = function () { return { 0: css('--s1'), 90: css('--s3'), 180: css('--s2') }; };
  function drawCorridor(R) {
    if (!state.sweep || state.R !== R) return;
    var o = canvasFor('gChart', 0.6), P = { l: 46, r: 12, t: 12, b: 34 }, ax = axes(o, G0, G1, 1, 1000, P, 'entry angle at 125 km (deg)', 'peak deceleration (g)', true), g = o.g, C = COL();
    var d = R.options.direct, ac = R.options.aerocapture;
    // the two corridors as strips (they overlap in angle): direct entry along the floor, aerocapture along the top
    function strip(a, b, col, y, label) { if (!num(a) || !num(b)) return; g.fillStyle = col; g.fillRect(ax.X(a), y, ax.X(b) - ax.X(a), 9); g.fillStyle = css('--ink-2'); g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(label, Math.min(ax.X(b) + 4, o.w - P.r - 60), y + 8); }
    if (d.corridor && d.corridor.width_deg > 0) strip(d.corridor.shallow_deg, d.corridor.steep_deg, css('--s3'), o.h - P.b - 11, 'direct');
    if (ac.corridor) strip(ac.corridor.shallow_deg, ac.corridor.steep_deg, css('--s1'), P.t + 2, 'aerocapture');
    BANKS.forEach(function (bk) { line(g, state.sweep[bk].map(function (p) { return p.peak > 0.5 ? [ax.X(p.g), ax.Y(Math.min(999, p.peak))] : null; }), C[bk], 2); });
    g.strokeStyle = css('--crit'); g.setLineDash([5, 4]); g.beginPath(); g.moveTo(P.l, ax.Y(R.S.gLimit)); g.lineTo(o.w - P.r, ax.Y(R.S.gLimit)); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--crit'); g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText(f(R.S.gLimit) + ' g limit', P.l + 4, ax.Y(R.S.gLimit) - 4);
    var C2 = R.choice ? R.options[R.choice] : d, gs = num(C2.gamma) ? C2.gamma : d.gamma;
    if (num(gs)) { g.strokeStyle = css('--ink'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax.X(gs), P.t); g.lineTo(ax.X(gs), o.h - P.b); g.stroke(); g.fillStyle = css('--ink'); g.textAlign = gs < (G0 + G1) / 2 ? 'right' : 'left'; g.fillText(f(gs, 2) + '°', ax.X(gs) + (gs < (G0 + G1) / 2 ? -4 : 4), P.t + 26); }
    legend('gLegend', [{ c: C[0], t: 'lift up (bank 0)' }, { c: C[90], t: 'lift sideways (90)' }, { c: C[180], t: 'lift down (180)' }, { c: css('--s3'), t: 'direct-entry corridor (strip along the floor)', band: true }, { c: css('--s1'), t: 'aerocapture corridor (strip along the top)', band: true }]);
    $('gCap').textContent = (d.corridor && d.corridor.width_deg > 0 ? 'Direct entry works from ' + f(d.corridor.steep_deg, 2) + '° to ' + f(d.corridor.shallow_deg, 2) + '° (' + f(d.corridor.width_deg, 2) + '° wide, against ±0.08° delivery). ' : 'No direct-entry corridor at these limits. ') + (ac.corridor ? 'Aerocapture to ' + f(R.S.targetAlt_m / 1000) + ' km: ' + f(ac.corridor.steep_deg, 2) + '° to ' + f(ac.corridor.shallow_deg, 2) + '°. ' : '') + 'Tap to choose an angle; ←/→ move it on the focused chart. Curves at 0.2 s steps.';
    // where it leaves: apoapsis after the pass
    var P2 = { l: 70, r: 12, t: 12, b: 34 }, o2 = canvasFor('apoChart', 0.6), ax2 = axes(o2, G0, G1, 100, 1e6, P2, 'entry angle at 125 km (deg)', 'apoapsis (km)', true), g2 = o2.g;
    BANKS.forEach(function (bk) { line(g2, state.sweep[bk].map(function (p) { return num(p.apo) && p.apo > 100e3 ? [ax2.X(p.g), ax2.Y(Math.min(1e6, p.apo / 1000))] : null; }), C[bk], 2);
      var off = { 0: -4, 90: 0, 180: 4 }[bk];
      state.sweep[bk].forEach(function (p) { var y = (p.end === 'exit' && !num(p.apo)) || p.end === 'flyby' ? P2.t + 4 + off : (p.end !== 'exit' ? o2.h - P2.b - 6 + off : null); if (y !== null) { g2.fillStyle = C[bk]; g2.fillRect(ax2.X(p.g) - 1.5, y - 1.5, 3, 3); } }); });
    g2.strokeStyle = css('--ink-2'); g2.setLineDash([5, 4]); g2.beginPath(); g2.moveTo(P2.l, ax2.Y(R.S.targetAlt_m / 1000)); g2.lineTo(o2.w - P2.r, ax2.Y(R.S.targetAlt_m / 1000)); g2.stroke(); g2.setLineDash([]);
    g2.fillStyle = css('--ink-2'); g2.textAlign = 'left'; g2.font = '11px system-ui'; g2.fillText('target ' + f(R.S.targetAlt_m / 1000) + ' km', P2.l + 4, ax2.Y(R.S.targetAlt_m / 1000) - 4);
    legend('apoLegend', [{ c: C[0], t: 'lift up' }, { c: C[90], t: 'sideways' }, { c: C[180], t: 'lift down' }]);
    $('apoCap').textContent = 'Dots along the top: missed the air or skipped back out, still unbound. Dots along the floor: stayed in (a direct entry). Between, the pass leaves on an orbit whose apoapsis the curve gives; aerocapture aims at the target line. The band where lift down leaves bound is narrow: a little steeper and it stays in.';
  }
  function drawPass(R) {
    var C = R.choice ? R.options[R.choice] : null, flights = [];
    if (C && C.id === 'skip' && C.passFlights) flights = C.passFlights; else if (C && C.flight && C.flight.samples) flights = [C.flight];
    if (!flights.length) { ['passChart', 'loadChart'].forEach(function (id) { var o = canvasFor(id, 0.5); o.g.fillStyle = css('--muted'); o.g.font = '13px system-ui'; o.g.fillText(C ? 'No pass through the air for this option.' : 'Nothing chosen.', 12, 24); }); $('passCap').textContent = ''; $('passLegend').innerHTML = ''; $('loadLegend').innerHTML = ''; return; }
    // time in the air: each pass from its own top crossing, passes laid end to end with a 20 s gap marked by the coast
    var S = [], acc = 0, gaps = [];
    flights.forEach(function (fl, i) {
      var t0 = fl.t_top;
      if (i) { var prev = flights[i - 1]; gaps.push({ at: acc + 10, coast_min: (fl.t_start + fl.t_top - (prev.t_start + prev.t)) / 60 }); acc += 20; }
      fl.samples.forEach(function (s) { S.push({ t: acc + s.t - t0, h: s.h / 1000, V: s.V / 1000, g: s.g, q: (s.q || 0) / 1e4, pass: i }); });
      acc = S[S.length - 1].t;
    });
    var tl = flights.length > 1 ? 's in the air below 86 km (passes end to end)' : 's in the air below 86 km';
    var t1 = S[S.length - 1].t, o = canvasFor('passChart', 0.55), P = { l: 46, r: 46, t: 12, b: 34 };
    var ax = axes(o, 0, t1, 0, Math.max(90, Math.max.apply(null, S.map(function (s) { return s.h; }))), P, tl, 'altitude (km)'), g = o.g;
    var vmax = Math.max.apply(null, S.map(function (s) { return s.V; })) * 1.05, Yv = function (v) { return o.h - P.b - v / vmax * (o.h - P.t - P.b); };
    var split = function (k, Yf) { var out = []; S.forEach(function (s, i) { if (i && s.pass !== S[i - 1].pass) out.push(null); out.push([ax.X(s.t), Yf(s[k])]); }); return out; };
    line(g, split('h', ax.Y), css('--s1'), 2); line(g, split('V', Yv), css('--s2'), 2, [6, 3]);
    var gapMark = function (gg, A, hh) { gaps.forEach(function (q) { var x = A.X(q.at); gg.strokeStyle = css('--muted'); gg.setLineDash([2, 3]); gg.beginPath(); gg.moveTo(x, P.t); gg.lineTo(x, hh - P.b); gg.stroke(); gg.setLineDash([]); gg.fillStyle = css('--ink-2'); gg.font = '10px system-ui'; gg.textAlign = 'center'; gg.fillText(f(q.coast_min) + ' min coast', x, P.t + 10); }); };
    gapMark(g, ax, o.h);
    g.fillStyle = css('--ink-2'); g.textAlign = 'left'; g.font = '11px system-ui'; niceTicks(0, vmax, 4).forEach(function (v) { g.fillText(f(v), o.w - P.r + 4, Yv(v) + 4); });
    legend('passLegend', [{ c: css('--s1'), t: 'altitude above the flattened Earth (km, left)' }, { c: css('--s2'), t: 'speed relative to the air (km/s, right)', dash: true }]);
    var o2 = canvasFor('loadChart', 0.55), gmax = Math.max(1, Math.max.apply(null, S.map(function (s) { return s.g; }))) * 1.1, qmax = Math.max(1, Math.max.apply(null, S.map(function (s) { return s.q; }))) * 1.1;
    var ax2 = axes(o2, 0, t1, 0, gmax, P, tl, 'deceleration (g)'), g2 = o2.g, Yq = function (q) { return o2.h - P.b - q / qmax * (o2.h - P.t - P.b); };
    line(g2, split('g', ax2.Y), css('--s3'), 2); line(g2, split('q', Yq), css('--crit'), 2, [6, 3]); gapMark(g2, ax2, o2.h);
    g2.fillStyle = css('--ink-2'); g2.textAlign = 'left'; g2.font = '11px system-ui'; niceTicks(0, qmax, 4).forEach(function (v) { g2.fillText(f(v), o2.w - P.r + 4, Yq(v) + 4); });
    legend('loadLegend', [{ c: css('--s3'), t: 'deceleration (g, left)' }, { c: css('--crit'), t: 'stagnation-point heating (W/cm², right)', dash: true }]);
    $('passCap').textContent = LABELS[R.choice] + ' at ' + f(C.gamma, 2) + '°' + (C.id === 'skip' ? ': ' + flights.length + ' passes, the second entering at ' + f(C.second_entry_speed / 1000, 2) + ' km/s' : '') + '. Stops below 1.5 km/s relative (the parachutes are module 49\'s).';
  }
  function drawVinf(R) {
    var o = canvasFor('vinfChart', 0.42), P = { l: 52, r: 12, t: 12, b: 34 }, V1 = 8, ax = axes(o, 0, V1, 0, 6000, P, 'arrival v∞ (km/s)', 'Δv to stop (m/s)'), g = o.g;
    var rT = K.RE + R.S.targetAlt_m, aM = R.S.moonDist === 'perigee' ? K.MOON.perigee_m : R.S.moonDist === 'apogee' ? K.MOON.apogee_m : K.MOON.a_m, thr = R.options.lunar.threshold_vinf;
    g.fillStyle = 'rgba(27,175,122,0.14)'; g.fillRect(ax.X(0), P.t, ax.X(thr / 1000) - ax.X(0), o.h - P.t - P.b);
    var vLim = Math.sqrt(K.ENTRY_LIMIT * K.ENTRY_LIMIT - 2 * K.MU / (K.RE + K.ENTRY_ALT)) / 1000;
    g.strokeStyle = css('--warn'); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(ax.X(vLim), P.t); g.lineTo(ax.X(vLim), o.h - P.b); g.stroke(); g.setLineDash([]);
    var pts = function (fn) { var a = []; for (var v = 0; v <= V1 + 1e-9; v += 0.05) { var y = fn(v * 1000); a.push(num(y) && y <= 6000 && y >= 0 ? [ax.X(v), ax.Y(y)] : null); } return a; };
    line(g, pts(function (v) { return K.propulsive(v * v, rT, rT).dv; }), css('--s2'), 2);
    line(g, pts(function (v) { return K.propulsive(v * v, rT, aM).dv; }), css('--s2'), 2, [6, 3]);
    var TC = { reference: css('--s1'), cislunar: css('--muted'), phase3: css('--s3') };
    if (K.TM) ['reference', 'cislunar', 'phase3'].forEach(function (t) { var e = K.TM.tierEnergy(t); line(g, pts(function (v) { return Math.abs(K.TM.speedAtRadius(v / 1000, K.TM.constants.r_tip_km) - e.v_tip_inertial_kms) * 1000; }), TC[t], 1.5); });
    var vc = R.arrival.vinf;
    if (num(vc) && vc / 1000 <= V1) { g.strokeStyle = css('--ink'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax.X(vc / 1000), P.t); g.lineTo(ax.X(vc / 1000), o.h - P.b); g.stroke(); g.fillStyle = css('--ink'); g.font = '11px system-ui'; g.textAlign = 'right'; g.fillText('this arrival ' + f(vc / 1000, 2), ax.X(vc / 1000) - 4, P.t + 12); }
    g.fillStyle = css('--ink-2'); g.textAlign = 'left'; g.fillText('12 km/s entry', ax.X(vLim) + 4, o.h - P.b - 8);
    legend('vinfLegend', [{ c: css('--s2'), t: 'capture burn into ' + f(R.S.targetAlt_m / 1000) + ' km circular' }, { c: css('--s2'), t: 'into a loose orbit to the Moon\'s distance', dash: true }, { c: TC.reference, t: 'Skyhook trim, 2.5 km/s tip' }, { c: TC.cislunar, t: '2.8 km/s tip' }, { c: TC.phase3, t: '3.5 km/s tip' }, { c: 'rgba(27,175,122,0.35)', t: 'one lunar flyby captures (patched conics)', band: true }, { c: css('--warn'), t: 'faster than this enters above 12 km/s', dash: true }]);
    $('vinfCap').textContent = 'Δv at perigee, before the ' + f(R.S.margin * 100) + ' % margin. The Skyhook tips meet a payload at rest only where their line touches zero (3.5 km/s tip: v∞* = ' + (K.TM ? f(K.TM.tierEnergy('phase3').vinf_star_kms, 3) : '—') + ' km/s, idea 01). Tap the chart to try that v∞ as your arrival.';
  }
  function chartTap(id, fn) {
    var c = $(id);
    var at = function (ev) { var r = c.getBoundingClientRect(), p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX - r.left, y: p.clientY - r.top, w: r.width }; };
    c.addEventListener('click', function (ev) { fn(at(ev)); });
  }
  chartTap('gChart', function (p) { var P = { l: 46, r: 12 }, g = G0 + (p.x - P.l) / (p.w - P.l - P.r) * (G1 - G0); if (g <= -0.1 && g >= -30) setS('fpaDeg', Math.round(g * 20) / 20); });
  $('gChart').addEventListener('keydown', function (e) {
    var cur = num(state.S.fpaDeg) ? state.S.fpaDeg : (state.R && state.R.options ? state.R.options.direct.gamma : -8);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); var g = Math.round((cur + (e.key === 'ArrowLeft' ? 0.05 : -0.05)) * 20) / 20; setS('fpaDeg', Math.max(-30, Math.min(-0.1, g))); }
  });
  chartTap('vinfChart', function (p) { var P = { l: 52, r: 12 }, v = (p.x - P.l) / (p.w - P.l - P.r) * 8; if (v >= 0 && v <= 8) { var cu = state.S.custom || K.customDefaults(); cu.vinf_m_s = Math.round(v * 100) * 10; state.S.custom = cu; state.S.arrival = 'custom'; state.S.fpaDeg = null; sync(); schedule(10); } });

  // ------------------------------------------------------------------ checks against reality
  function renderChecks() {
    var X = K.reality(), rows = [];
    X.rows.forEach(function (r) {
      var gap = num(r.gap_pct) ? (r.gap_pct >= 0 ? '+' : '') + f(r.gap_pct, 2) + ' %' : (r.gap_abs >= 0 ? '+' : '') + f(r.gap_abs, 3) + ' ' + r.units;
      var why = r.refLabel + (r.heading_range ? '; heading not on file: posigrade headings 30° to 150° give ' + f(r.heading_range[0], 1) + ' to ' + f(r.heading_range[1], 1) + ' g' : '') + (num(r.mach) ? '; Mach here ' + f(r.mach, 2) + ', radar ' + f(r.mach_ref, 2) + ' (one hypersonic drag table held below Mach 7)' : '');
      rows.push('<tr><td data-k="Check">' + esc(r.label) + '<span class="why">' + esc(why) + '</span></td><td data-k="NASA" class="n">' + esc(String(r.ref)) + ' ' + esc(r.units) + '</td><td data-k="This page" class="n">' + f(r.model, r.units === 'km' ? 3 : 2) + ' ' + esc(r.units) + '</td><td data-k="Gap" class="n gap-ok">' + gap + '</td></tr>');
    });
    $('checkTable').querySelector('tbody').innerHTML = rows.join('');
    state.checks = true;
  }

  // ------------------------------------------------------------------ handoff
  function status(t, good) { var s = $('hoStatus'); s.textContent = t; s.className = 'status ' + (good ? 'ok' : 'bad'); }
  function current() { return state.R && !state.R.refusal ? K.buildHandoff(state.R) : null; }
  function why() { return state.R && state.R.refusal ? 'Nothing to export: ' + state.R.refusal.reason : 'Nothing to export yet.'; }
  $('copyBtn').addEventListener('click', function () {
    var h = current(); if (!h) return status(why());
    var s = JSON.stringify(h, null, 1); $('importText').value = s;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { status('Copied (' + s.length + ' characters).', true); }, function () { $('importText').select(); status('The clipboard is blocked here: the handoff is in the box above, selected.', true); });
    else { $('importText').select(); status('The handoff is in the box above.', true); }
  });
  $('dlBtn').addEventListener('click', function () {
    var h = current(); if (!h) return status(why());
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(h, null, 1)], { type: 'application/json' })); a.download = 'catch-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded catch-handoff.json.', true);
  });
  $('linkBtn').addEventListener('click', function () {
    var h = current(); if (!h) return status(why());
    var url = location.href.split('#')[0] + '#h=' + K.b64urlEncode(JSON.stringify(h)); $('importText').value = url;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { status('Link copied (' + url.length + ' characters).', true); }, function () { status('The link is in the box above.', true); });
    else status('The link is in the box above.', true);
  });
  function load(text) {
    var p = K.parseHandoff(text);
    if (p.refusal) { status('Refused (' + p.refusal.code + '): ' + p.refusal.reason); return false; }
    if (p.from === '47-way-home') { state.h47 = p.h47; state.S = K.defaults(); state.S.arrival = p.arrival.chain ? 'chain' : 'imported'; status('Idea 47\'s handoff accepted' + (p.arrival.chain ? ' (the chain)' : '') + ': its arrival is loaded.', true); }
    else { state.h47 = p.h47 && !(K.chain && JSON.stringify(p.h47) === JSON.stringify(K.chain)) ? p.h47 : null; state.S = p.settings; status('This page\'s handoff read back: re-run from its inputs and it matches.', true); }
    state.sweepKey = null; sync(); schedule(10); return true;
  }
  $('importBtn').addEventListener('click', function () { var t = $('importText').value.trim(); var m = /#h=([A-Za-z0-9_-]+)/.exec(t); load(m ? K.b64urlDecode(m[1]) : t); });
  $('importFile').addEventListener('change', function () { var fl = this.files && this.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { load(String(rd.result)); }; rd.readAsText(fl); });
  var m = /#h=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) { try { load(K.b64urlDecode(m[1])); } catch (e) { status('The link\'s handoff could not be read: ' + e.message); } }

  window.addEventListener('resize', function () { clearTimeout(state.rz); state.rz = setTimeout(function () { if (state.R && !state.R.refusal) { drawCorridor(state.R); drawPass(state.R); drawVinf(state.R); } }, 150); });
  window.CatchPage = { state: state, K: K };
  sync(); if (!m) schedule(0);
})();
