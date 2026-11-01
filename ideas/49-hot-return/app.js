/* Hot Return (idea 49): the page. All physics is in hotreturn.js and the snapshots (idea 48's kernel among them); this
 * file wires controls, draws, and moves handoffs. Classic script, no network. */
(function () {
  'use strict';
  var K = HotReturn.create({ Catch: Catch, catchDeps: { isa: PartForgeISA, earth: MaxQEarth, radii: CatchEarthRadii, de440: CoastDE440, erfa: WindowERFA, sources: CatchSources },
    sources: HotReturnSources, chain: HotReturnCatch });
  function $(id) { return document.getElementById(id); }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function f(v, d) {
    if (!num(v)) return '—';
    var a = Math.abs(v), s = d !== undefined ? v.toFixed(d) : (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2)), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+$)/g, ','); return p.join('.');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  var state = { S: K.defaults(), h48: null, R: null, timer: null, real: null, seq: 0, realDone: false };
  var SRC_NOTE = {
    chain: 'Idea 48\'s committed handoff: the chain\'s Apophis material, 9,565 kg in the Apollo-derived shape, a skip entry at -6.50° (two passes, an hour apart).',
    imported: 'Your imported idea 48 handoff.',
    stardust: 'Stardust, 15 January 2006: 45.8 kg at 12.9 km/s, PICA heat shield, drogue then main, UTTR (NASA reports via idea 48).',
    osirisrex: 'OSIRIS-REx, 24 September 2023: 49.8 kg at 12.38 km/s, Stardust\'s design; as flown the drogue never opened and the main came out at the pressure switch.',
    genesis: 'Genesis, 8 September 2004: 205.6 kg at 11.04 km/s, a carbon-carbon heat shield; its G-switch was installed upside down and no parachute opened.'
  };

  // ------------------------------------------------------------------ controls
  function pressed(sel, key, val) { document.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset[key] === String(val))); }); }
  function plan() { return state.R && !state.R.refusal ? state.R.descent.plan : null; }
  function sync() {
    var S = state.S, P = plan();
    pressed('[data-src]', 'src', S.source); pressed('[data-chute]', 'chute', S.chutes);
    $('srcImported').disabled = !state.h48;
    $('srcLine').textContent = SRC_NOTE[S.source] || '';
    $('radIn').checked = S.radiative !== false;
    $('rhoIn').value = S.shield_density; $('rhoRange').value = Math.max(200, Math.min(350, S.shield_density));
    $('tdIn').value = S.touchdown_m_s; $('tdRange').value = Math.max(2, Math.min(15, S.touchdown_m_s));
    $('gIn').value = S.trigger_g;
    $('drIn').value = S.drogue_timer_s === 'auto' ? '' : S.drogue_timer_s; $('drIn').placeholder = P ? f(P.drogue_timer_s) + ' auto' : 'auto';
    $('gndIn').value = S.ground_alt_m === 'auto' ? '' : S.ground_alt_m; $('gndIn').placeholder = P ? f(P.ground, 0) + ' auto' : 'auto';
    var hMain = S.main_baro_Pa === 'auto' ? (P ? K.altOfPressure(P.baro_Pa) : null) : K.altOfPressure(S.main_baro_Pa);
    $('mainIn').value = S.main_baro_Pa === 'auto' ? '' : +(hMain / 1000).toFixed(2); $('mainIn').placeholder = num(hMain) ? f(hMain / 1000, 2) + ' auto' : 'auto';
    if (num(hMain)) $('mainRange').value = Math.max(0.5, Math.min(12, hMain / 1000));
  }
  function setS(k, v) { state.S[k] = v; sync(); schedule(200); }
  document.querySelectorAll('[data-src]').forEach(function (b) { b.addEventListener('click', function () { if (b.disabled) return; var keep = state.S; state.S = K.defaults(); state.S.source = b.dataset.src; state.S.radiative = keep.radiative; sync(); schedule(10); }); });
  document.querySelectorAll('[data-chute]').forEach(function (b) { b.addEventListener('click', function () { setS('chutes', b.dataset.chute); }); });
  $('radIn').addEventListener('change', function () { setS('radiative', $('radIn').checked); });
  function pair(numId, rangeId, key, scale) {
    $(rangeId).addEventListener('input', function () { $(numId).value = $(rangeId).value; state.S[key] = +$(rangeId).value * (scale || 1); schedule(250); });
    $(numId).addEventListener('change', function () { var v = $(numId).value.trim(); state.S[key] = v === '' ? NaN : +v * (scale || 1); sync(); schedule(10); });
  }
  pair('rhoIn', 'rhoRange', 'shield_density'); pair('tdIn', 'tdRange', 'touchdown_m_s');
  function autoNum(id, key, conv) { $(id).addEventListener('change', function () { var v = $(id).value.trim(); state.S[key] = v === '' ? 'auto' : (conv ? conv(+v) : +v); sync(); schedule(10); }); }
  autoNum('drIn', 'drogue_timer_s'); autoNum('gndIn', 'ground_alt_m');
  autoNum('mainIn', 'main_baro_Pa', function (km) { return num(km) ? K.pressureAt(km * 1000) : NaN; });
  $('mainRange').addEventListener('input', function () { var km = +$('mainRange').value; $('mainIn').value = km; state.S.main_baro_Pa = K.pressureAt(km * 1000); schedule(250); });
  $('gIn').addEventListener('change', function () { var v = $('gIn').value.trim(); state.S.trigger_g = v === '' ? NaN : +v; schedule(10); });
  $('resetBtn').addEventListener('click', function () { var src = state.S.source; state.S = K.defaults(); state.S.source = src; sync(); schedule(10); });

  function schedule(ms) { clearTimeout(state.timer); $('busy').textContent = 'Flying…'; state.timer = setTimeout(compute, ms); }
  function compute() {
    var R;
    try { R = K.run(state.S, { h48: state.h48 }); } catch (e) { R = { refusal: { code: 'invalid_input', reason: 'The kernel stopped: ' + e.message, what_would_help: 'Different settings.' } }; }
    state.R = R; $('busy').textContent = ''; sync(); render(); state.seq++;
  }

  // ------------------------------------------------------------------ output
  function refHtml(r) { return '<div class="refusal"><b>' + esc(r.code) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · ' + esc(r.from) : '') + '</b><div>' + esc(r.reason) + '</div><div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function tile(k, v, u, c, sub, cls) { return '<div class="tile' + (cls ? ' ' + cls : '') + '" data-tile="' + esc(k) + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '<span class="c">' + esc(c) + '</span></div>'; }
  function render() {
    var R = state.R;
    if (!R || R.refusal) {
      $('tiles').innerHTML = tile('Refused', '—', '', R ? R.refusal.code : '', R ? esc(R.refusal.reason) : '', 'refused');
      $('refusals').innerHTML = R ? refHtml(R.refusal) : ''; $('heritage').innerHTML = ''; $('heritageNote').textContent = '';
      $('carriedList').innerHTML = ''; $('events').innerHTML = '';
      ['heatChart', 'downChart', 'shieldChart'].forEach(blank); $('heatCap').textContent = ''; $('shieldCap').textContent = '';
      return;
    }
    var H = R.heat, pk = H.peaks, SH = R.shield, ch = R.descent.chutes || {}, L = R.land, T = [];
    T.push(tile('Touchdown', f(L.speed, 2), 'm/s', ch.sized ? 'assumed' : 'derived', f(L.t / 60, 1) + ' min after entry' + (L.utc ? ' · ' + L.utc.slice(0, 19).replace('T', ' ') + ' UTC' : ''), L.speed > 15 ? 'bad' : 'hero'));
    T.push(tile('Lands', f(R.mass.landed_kg, R.mass.landed_kg < 100 ? 2 : 0), 'kg', 'derived', 'entry ' + f(R.mass.entry_kg, R.mass.entry_kg < 100 ? 2 : 0) + ' − shield burned ' + f(R.mass.ablated_kg, 2) + ' kg'));
    T.push(tile('Peak heating', f(pk.qt / 1e4), 'W/cm²', 'derived', 'convective ' + f(pk.qc_at_qt / 1e4) + ' + radiative ' + f(pk.qr_at_qt / 1e4) + ' at ' + f(pk.t_qt, 1) + ' s', pk.qt > K.sources.pica.limit.q_W_m2 ? 'bad' : ''));
    T.push(tile('Heat load', f(H.Q_total / 1e7, 1), 'kJ/cm²', 'derived', 'radiative ' + f(100 * H.Q_rad / H.Q_total, 0) + ' %' + (H.Q_rad > 0 ? ', ' + f(100 * H.Q_rad_extrapolated / H.Q_rad, 0) + ' % of it extrapolated' : '')));
    T.push(tile('Recession', f(SH.recession_stag_m * 1000, 2), 'mm', 'derived', 'stagnation point, PICA at ' + f(SH.density_kg_m3) + ' kg/m³' + (SH.material !== 'pica' ? ' (as if PICA)' : ''), SH.in_envelope ? '' : 'warn'));
    T.push(tile('Wall, at most', f(pk.Tw), 'K', 'derived', 'radiative equilibrium (an upper bound)'));
    T.push(SH.thickness_m !== null ? tile('Shield thickness', f(SH.thickness_m * 100, 2), 'cm', 'derived', 'Stardust\'s, by heritage · ' + f(SH.shield_mass_kg, 1) + ' kg of PICA') : tile('Shield thickness', 'refused', '', 'refused', 'at least the ' + f(SH.recession_stag_m * 1000, 1) + ' mm that burns', 'refused'));
    T.push(tile('Peak deceleration', f(Math.max.apply(null, R.descent.passes.map(function (p) { return p.peak_g; })), 1), 'g', 'derived', R.descent.passes.length > 1 ? R.descent.passes.length + ' passes' : 'one pass'));
    if (ch.main) T.push(tile('Main opens', f(ch.main.open_peak_g, 1), 'g', 'assumed', 'at ' + f(ch.main.h / 1000, 2) + ' km, ' + f(ch.main.V) + ' m/s (' + esc(ch.main_trigger) + ')', ch.main.open_peak_g > 20 ? 'warn' : ''));
    if (ch.drogue) T.push(tile('Drogue opens', f(ch.drogue.open_peak_g, 1), 'g', 'assumed', 'Mach ' + f(ch.drogue.M, 2) + ' at ' + f(ch.drogue.h / 1000, 1) + ' km'));
    if (ch.main_cds_m2) T.push(tile('Main drag area', f(ch.main_cds_m2), 'm²', ch.sized ? 'assumed' : 'derived', ch.sized ? f(ch.main_equiv_src_canopies, 0) + ' OSIRIS-REx mains, or one of ' + f(ch.main_equiv_diameter_m, 0) + ' m' : 'the SRC\'s 7.3 m main, from flight'));
    T.push(tile('Lands at', f(L.lat, 2) + '°, ' + f(L.lon, 2) + '°', '', 'derived', f(L.downrange_m / 1000, 0) + ' km from the entry point, ground ' + f(L.ground_alt_m, 0) + ' m', 'date'));
    $('tiles').innerHTML = T.join('');
    // heritage bars
    var hr = SH.heritage, bars = [['Peak heating', hr.peak_q_ratio, f(pk.qt / 1e4) + ' / 1,200 W/cm²'], ['Heat load', hr.heat_load_ratio, f(H.Q_total / 1e7, 1) + ' / 36.5 kJ/cm²'], ['Pressure', hr.pressure_ratio, f(pk.ps / K.P_ATM, 2) + ' / 0.5 atm']];
    var MAX = 2.5;
    $('heritage').innerHTML = bars.map(function (b) { var w = Math.min(1, b[1] / MAX) * 100; return '<div class="hbar" title="' + esc(b[2]) + '"><span>' + esc(b[0]) + '</span><span class="track"><span class="fill' + (b[1] > 1 ? ' over' : '') + '" style="width:' + w.toFixed(1) + '%"></span><span class="mark" style="left:' + (100 / MAX).toFixed(1) + '%"></span></span><span class="n">' + f(b[1], 2) + '×</span></div>'; }).join('');
    $('heritageNote').textContent = 'Each bar is this entry over Stardust\'s heat-shield design (the line at 1×). Inside all three, Stardust\'s 5.82 cm of PICA carries over' + (hr.ok ? ', as it does here.' : '; here it does not, so the thickness is refused.');
    $('refusals').innerHTML = R.refusals.map(refHtml).join('');
    $('carriedSum').textContent = 'Refusals carried from earlier modules (' + R.carried.length + ')';
    $('carriedList').innerHTML = R.carried.map(refHtml).join('') || '<p class="small">None.</p>';
    $('events').innerHTML = R.descent.events.map(function (e) { return '<li><span>' + esc(e.event) + '</span><span>' + f(e.t, 1) + ' s</span></li>'; }).join('');
    drawHeat(R); drawDown(R); drawShield(R);
  }

  // ------------------------------------------------------------------ charts
  function canvasFor(id, ratio) {
    var c = $(id), w = c.clientWidth || 600, h = Math.max(220, Math.min(380, Math.round(w * ratio))), dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { c: c, g: g, w: w, h: h };
  }
  function blank(id) { var o = canvasFor(id, 0.5); o.g.fillStyle = css('--muted'); o.g.font = '13px system-ui'; o.g.fillText('Refused: nothing to draw.', 12, 24); }
  function tk(v) { return Number.isInteger(v) ? f(v, 0) : f(v); }
  function niceTicks(a, b, n) { var s = Math.pow(10, Math.floor(Math.log10((b - a) / n))), m = (b - a) / n / s, st = (m < 2 ? 2 : m < 5 ? 5 : 10) * s, out = []; for (var v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toPrecision(10)); return out; }
  function axes(o, x0, x1, y0, y1, P, xl, yl, xfmt) {
    var g = o.g; g.strokeStyle = css('--axis'); g.fillStyle = css('--ink-2'); g.font = '11px system-ui'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(P.l, P.t); g.lineTo(P.l, o.h - P.b); g.lineTo(o.w - P.r, o.h - P.b); g.stroke();
    var X = function (x) { return P.l + (x - x0) / (x1 - x0) * (o.w - P.l - P.r); }, Y = function (y) { return o.h - P.b - (y - y0) / (y1 - y0) * (o.h - P.t - P.b); };
    g.textAlign = 'center';
    if (!xfmt) niceTicks(x0, x1, o.w < 500 ? 4 : 7).forEach(function (v) { var px = X(v); g.fillText(tk(v), px, o.h - P.b + 14); g.beginPath(); g.moveTo(px, o.h - P.b); g.lineTo(px, o.h - P.b + 4); g.stroke(); });
    g.fillText(xl, (P.l + o.w - P.r) / 2, o.h - 4);
    g.textAlign = 'right';
    niceTicks(y0, y1, 5).forEach(function (v) { var py = Y(v); g.fillStyle = css('--ink-2'); g.fillText(tk(v), P.l - 4, py + 4); g.strokeStyle = css('--grid'); g.beginPath(); g.moveTo(P.l + 1, py); g.lineTo(o.w - P.r, py); g.stroke(); });
    g.save(); g.translate(11, (P.t + o.h - P.b) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = css('--ink-2'); g.fillText(yl, 0, 0); g.restore();
    return { X: X, Y: Y };
  }
  function rightAxis(o, y0, y1, P, yl, col) {
    var g = o.g, Y = function (y) { return o.h - P.b - (y - y0) / (y1 - y0) * (o.h - P.t - P.b); };
    g.fillStyle = col; g.font = '11px system-ui'; g.textAlign = 'left';
    niceTicks(y0, y1, 5).forEach(function (v) { g.fillText(tk(v), o.w - P.r + 4, Y(v) + 4); });
    g.save(); g.translate(o.w - 6, (P.t + o.h - P.b) / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.fillText(yl, 0, 0); g.restore();
    return Y;
  }
  function line(g, pts, col, w, dash) { g.strokeStyle = col; g.lineWidth = w || 2; g.setLineDash(dash || []); g.beginPath(); var on = false; pts.forEach(function (p) { if (!p) { on = false; return; } if (on) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); on = true; } }); g.stroke(); g.setLineDash([]); }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key' + (it.dash ? ' dash' : '') + '" style="border-color:' + it.c + '"></span>' + esc(it.t) + '</li>'; }).join(''); }
  // time in the air: the coasts between passes are cut out (marked), and the rows end once the heating is over
  function airRows(R) {
    var rows = R.heat.rows, pk = R.heat.peaks.qt, out = [], cut = 0, prev = null, gaps = [], tEnd = R.descent.trigger_state ? R.descent.trigger_state.t + 20 : rows[rows.length - 1].t;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; if (r.t > tEnd && r.qt < 0.002 * pk) break;
      if (prev && r.t - prev.t > 5) { cut += r.t - prev.t - 1; gaps.push({ x: r.t - cut, coast: r.t - prev.t }); }
      out.push({ x: r.t - cut, r: r }); prev = r;
    }
    return { pts: out, gaps: gaps };
  }
  var hover = { heat: null, down: null };
  function drawHeat(R) {
    var o = canvasFor('heatChart', 0.5), A = airRows(R), P = { l: 46, r: 12, t: 12, b: 34 };
    var x1 = A.pts[A.pts.length - 1].x, ymax = Math.max(R.heat.peaks.qt / 1e4 * 1.08, 50);
    var lim = K.sources.pica.limit.q_W_m2 / 1e4; if (lim < ymax * 1.6) ymax = Math.max(ymax, lim * 1.05);
    var ax = axes(o, A.pts[0].x, x1, 0, ymax, P, 'seconds in the air (coasts between passes cut out)', 'W/cm²');
    var g = o.g;
    A.gaps.forEach(function (gp) { var px = ax.X(gp.x); g.strokeStyle = css('--muted'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, P.t); g.lineTo(px, o.h - P.b); g.stroke(); g.setLineDash([]); g.fillStyle = css('--muted'); g.textAlign = 'left'; g.fillText(f(gp.coast / 60, 0) + ' min coast', px + 4, P.t + 12); });
    if (lim <= ymax) { line(g, [[ax.X(A.pts[0].x), ax.Y(lim)], [ax.X(x1), ax.Y(lim)]], css('--crit'), 1, [6, 4]); g.fillStyle = css('--crit'); g.textAlign = 'right'; g.fillText('PICA limit', o.w - P.r - 2, ax.Y(lim) - 4); }
    line(g, A.pts.map(function (p) { return [ax.X(p.x), ax.Y(p.r.qc / 1e4)]; }), css('--s1'), 2);
    line(g, A.pts.map(function (p) { return [ax.X(p.x), ax.Y(p.r.qr / 1e4)]; }), css('--s2'), 2);
    line(g, A.pts.map(function (p) { return [ax.X(p.x), ax.Y(p.r.qt / 1e4)]; }), css('--ink'), 1.5, [5, 3]);
    if (hover.heat !== null) { var hp = A.pts[Math.max(0, Math.min(A.pts.length - 1, hover.heat))]; g.strokeStyle = css('--axis'); g.beginPath(); g.moveTo(ax.X(hp.x), P.t); g.lineTo(ax.X(hp.x), o.h - P.b); g.stroke(); }
    legend('heatLegend', [{ c: css('--s1'), t: 'convective (Sutton & Graves)' }, { c: css('--s2'), t: 'radiative (Suttles et al.)' }, { c: css('--ink'), t: 'total', dash: true }]);
    $('heatCap').textContent = 'Peak ' + f(R.heat.peaks.qt / 1e4) + ' W/cm² (' + f(R.heat.peaks.qr_at_qt / 1e4) + ' of it radiative) · heat load ' + f(R.heat.Q_conv / 1e7, 1) + ' convective + ' + f(R.heat.Q_rad / 1e7, 1) + ' radiative kJ/cm²' + (R.S.radiative ? '' : ' (radiation switched off)') + '.';
    state.heatAxis = { ax: ax, A: A, P: P, w: o.w };
  }
  function pickHeat(ev) {
    var s = state.heatAxis; if (!s) return; var rect = $('heatChart').getBoundingClientRect(), x = ev.clientX - rect.left;
    var best = 0, bd = 1e9; s.A.pts.forEach(function (p, i) { var d = Math.abs(s.ax.X(p.x) - x); if (d < bd) { bd = d; best = i; } });
    hover.heat = best; var r = s.A.pts[best].r;
    $('heatRead').textContent = f(r.t, 1) + ' s after entry · ' + f(r.h / 1000, 1) + ' km · ' + f(r.V / 1000, 2) + ' km/s · convective ' + f(r.qc / 1e4) + ', radiative ' + f(r.qr / 1e4) + (r.rin ? '' : ' (extrapolated)') + ' W/cm² · wall ≤ ' + f(r.Tw) + ' K';
    drawHeat(state.R);
  }
  ['pointermove', 'pointerdown'].forEach(function (t) { $('heatChart').addEventListener(t, pickHeat); });

  function drawDown(R) {
    var o = canvasFor('downChart', 0.5), rows = R.heat.rows, P = { l: 46, r: 50, t: 12, b: 34 };
    var t0 = R.descent.trigger_state ? Math.max(rows[0].t, R.descent.trigger_state.t - 120) : rows[0].t, pts = rows.filter(function (r) { return r.t >= t0; });
    var t1 = R.land.t, hmax = Math.max.apply(null, pts.map(function (r) { return r.h; })) / 1000 * 1.05, vmax = Math.max.apply(null, pts.map(function (r) { return r.V; })) * 1.05;
    var ax = axes(o, t0, t1, 0, hmax, P, 'seconds after entry', 'altitude, km'), g = o.g;
    var YV = rightAxis(o, 0, vmax, P, 'speed, m/s', css('--s2'));
    var SHORT = function (e) { return /G-switch/.test(e) ? 'G-switch' : /drogue/.test(e) ? 'drogue' : /main/.test(e) ? 'main' : /impact|ground/.test(e) ? 'impact' : 'touchdown'; };
    line(g, pts.map(function (r) { return [ax.X(r.t), ax.Y(Math.max(0, r.h) / 1000)]; }), css('--s1'), 2);
    line(g, pts.map(function (r) { return [ax.X(r.t), YV(r.V)]; }), css('--s2'), 1.5);
    R.descent.events.forEach(function (e, i) { var px = ax.X(e.t); g.strokeStyle = css('--muted'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, P.t); g.lineTo(px, o.h - P.b); g.stroke(); g.setLineDash([]); g.fillStyle = css('--ink-2'); g.textAlign = px > o.w * 0.7 ? 'right' : 'left'; g.fillText(SHORT(e.event), px + (px > o.w * 0.7 ? -4 : 4), P.t + 12 + 13 * (i % 4)); });
    if (hover.down) { g.strokeStyle = css('--axis'); g.beginPath(); g.moveTo(ax.X(hover.down.t), P.t); g.lineTo(ax.X(hover.down.t), o.h - P.b); g.stroke(); }
    legend('downLegend', [{ c: css('--s1'), t: 'altitude' }, { c: css('--s2'), t: 'speed relative to the air' }]);
    state.downAxis = { ax: ax, pts: pts };
  }
  function pickDown(ev) {
    var s = state.downAxis; if (!s) return; var rect = $('downChart').getBoundingClientRect(), x = ev.clientX - rect.left;
    var best = s.pts[0], bd = 1e9; s.pts.forEach(function (p) { var d = Math.abs(s.ax.X(p.t) - x); if (d < bd) { bd = d; best = p; } });
    hover.down = best;
    $('downRead').textContent = f(best.t, 1) + ' s · ' + f(best.h / 1000, 2) + ' km · ' + f(best.V, 1) + ' m/s' + (num(best.M) ? ' · Mach ' + f(best.M, 2) : '') + ' · ' + f(best.g, 2) + ' g · ' + (best.phase || '');
    drawDown(state.R);
  }
  ['pointermove', 'pointerdown'].forEach(function (t) { $('downChart').addEventListener(t, pickDown); });

  function drawShield(R) {
    var o = canvasFor('shieldChart', 0.45), A = airRows(R), P = { l: 46, r: 54, t: 12, b: 34 }, rho = R.shield.density_kg_m3;
    var acc = 0, prev = null, rec = A.pts.map(function (p) { if (prev && p.r.t - prev.t < 5) acc += 0.5 * (prev.mdot + p.r.mdot) * (p.r.t - prev.t) / rho * 1000; prev = p.r; return acc; });
    var ymax = Math.max(acc * 1.1, 0.5), Tmax = Math.max.apply(null, A.pts.map(function (p) { return p.r.Tw || 0; })) * 1.08;
    var ax = axes(o, A.pts[0].x, A.pts[A.pts.length - 1].x, 0, ymax, P, 'seconds in the air', 'recession, mm'), g = o.g;
    var YT = rightAxis(o, 0, Tmax, P, 'wall, K', css('--s2'));
    var Tox = K.sources.pica.oxidation_T_min_K; line(g, [[ax.X(A.pts[0].x), YT(Tox)], [ax.X(A.pts[A.pts.length - 1].x), YT(Tox)]], css('--muted'), 1, [4, 4]);
    g.fillStyle = css('--muted'); g.textAlign = 'left'; g.fillText('1600 K', P.l + 4, YT(Tox) - 4);
    line(g, A.pts.map(function (p, i) { return [ax.X(p.x), ax.Y(rec[i])]; }), css('--s1'), 2);
    line(g, A.pts.map(function (p) { return p.r.Tw ? [ax.X(p.x), YT(p.r.Tw)] : null; }), css('--s2'), 1.5);
    legend('shieldLegend', [{ c: css('--s1'), t: 'recession at the stagnation point' }, { c: css('--s2'), t: 'wall temperature (radiative equilibrium, an upper bound; char oxidation counted above the dashed 1600 K)' }]);
    $('shieldCap').textContent = f(R.shield.recession_stag_m * 1000, 2) + ' mm burns away at the stagnation point (' + f(R.shield.mass_loss_stag_kg_m2, 2) + ' kg/m²), ' + f(R.shield.ablated_kg, R.shield.ablated_kg < 10 ? 2 : 1) + ' kg over the shield (' + f(R.shield.wet_area_m2, 2) + ' m², Stardust\'s measured apex-to-edge profile; ' + f(R.shield.ablated_upper_kg, 1) + ' kg if all of it burned like the apex).';
  }

  // ------------------------------------------------------------------ reality table (computed once, after the first paint)
  function renderReality() {
    var RL = state.real || (state.real = K.reality()), rows = [], grp = null;
    RL.rows.forEach(function (r) {
      if (r.group !== grp) { grp = r.group; rows.push('<tr><th colspan="4">' + esc(grp) + '</th></tr>'); }
      var dp = r.units === 'kg/m³' ? 3 : (Math.abs(r.ref) < 10 ? 2 : Math.abs(r.ref) < 1000 ? 1 : 0);
      var fmtv = function (v, isRef) { return r.units === 'kg/m³' ? v.toExponential(2) : f(v, isRef && r.ref_dp !== undefined ? r.ref_dp : dp); };
      var gap = num(r.gap_pct) ? (r.gap_pct >= 0 ? '+' : '') + f(r.gap_pct, 1) + ' %' : (r.gap_abs >= 0 ? '+' : '') + f(r.gap_abs, 2) + (r.units ? ' ' + r.units.replace(' after entry', '') : '');
      rows.push('<tr data-id="' + esc(r.id) + '"><td data-k="Check">' + esc(r.label) + '<span class="sub">' + esc(r.refLabel) + '</span></td><td data-k="Measured" class="n">' + (r.bound === 'max' ? '&lt; ' : '') + fmtv(r.ref, true) + ' ' + esc(r.units) + '</td><td data-k="This page" class="n">' + fmtv(r.model) + ' ' + esc(r.units) + '</td><td data-k="Gap" class="n">' + gap + '</td></tr>');
    });
    $('realTable').querySelector('tbody').innerHTML = rows.join('');
    state.realDone = true;
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
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(h, null, 1)], { type: 'application/json' })); a.download = 'hot-return-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded hot-return-handoff.json.', true);
  });
  $('linkBtn').addEventListener('click', function () {
    var h = current(); if (!h) return status(why());
    var url = location.href.split('#')[0].replace(/49-hot-return\/index\.html$/, '50-long-way-round/index.html') + '#h=' + K.b64urlEncode(JSON.stringify(h)); $('importText').value = url;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { status('Link for module 50 copied (' + url.length + ' characters; module 50 is not built yet).', true); }, function () { status('The link is in the box above.', true); });
    else status('The link is in the box above.', true);
  });
  function load(text) {
    var p = K.parseHandoff(text);
    if (p.refusal) { status('Refused (' + p.refusal.code + '): ' + p.refusal.reason); return false; }
    if (p.from === '48-catch') {
      var isChain = JSON.stringify(p.h48) === JSON.stringify(K.chain);
      state.h48 = isChain ? null : p.h48; state.S = K.defaults(); state.S.source = isChain ? 'chain' : 'imported';
      status('Idea 48\'s handoff accepted' + (isChain ? ' (the chain)' : '') + ': its entry state flies again to the loads it screened.', true);
    } else { state.h48 = p.h48 && JSON.stringify(p.h48) !== JSON.stringify(K.chain) ? p.h48 : null; state.S = p.settings; status('This page\'s handoff read back: re-run from its inputs and it matches.', true); }
    sync(); schedule(10); return true;
  }
  $('importBtn').addEventListener('click', function () { var t = $('importText').value.trim(); var m = /#h=([A-Za-z0-9_-]+)/.exec(t); try { load(m ? K.b64urlDecode(m[1]) : t); } catch (e) { status('Refused: that link could not be decoded (' + e.message + ').'); } });
  $('importFile').addEventListener('change', function () { var fl = this.files && this.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { load(String(rd.result)); }; rd.readAsText(fl); });
  var m = /#h=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) { try { load(K.b64urlDecode(m[1])); } catch (e) { status('The link\'s handoff could not be read: ' + e.message); } }

  window.addEventListener('resize', function () { clearTimeout(state.rz); state.rz = setTimeout(function () { if (state.R && !state.R.refusal) { drawHeat(state.R); drawDown(state.R); drawShield(state.R); } }, 150); });
  window.HotReturnPage = { state: state, K: K };
  sync(); if (!m) schedule(0);
  setTimeout(function () { try { renderReality(); } catch (e) { $('realTable').querySelector('tbody').innerHTML = '<tr><td colspan="4">The reality check stopped: ' + esc(e.message) + '</td></tr>'; } }, 300);
})();
