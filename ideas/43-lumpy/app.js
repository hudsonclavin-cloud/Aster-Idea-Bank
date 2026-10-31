/* Lumpy (idea 43): the page. Wires the kernel (lumpy.js) to the controls, the shape viewer, the charts and the handoff. */
(function () {
  'use strict';
  var K = Lumpy.create({ shapes: LumpyShapes, attitude: LumpyAttitude, geophysics: LumpyGeophysics, orbitB: LumpyOrbitB, orbitBSunlight: LumpyOrbitBSunlight,
    coast: LumpyIntegrator, sources: ClosingSources, constants: LambertAster });
  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180, GEO = K.geophysics, BAR = GEO.barnouin2019, SCH = GEO.scheeres2020.zonals;
  var state = { caseKey: 'chain', h42: window.LumpyClosingSample, S: K.defaults(), R: null, yaw: -35 * DEG, pitch: 18 * DEG, qty: 'slope', scanSel: null, scanning: false, checks: null, busyTimer: null };

  function f(x, sig) { if (x === null || x === undefined || !isFinite(x)) return '—'; var a = Math.abs(x); if (a !== 0 && (a >= 1e7 || a < 1e-3)) return x.toExponential((sig || 3) - 1).replace('e+', 'e'); return (+x.toPrecision(sig || 3)).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function day(tdb) { return K.utcOf(tdb).slice(0, 16).replace('T', ' '); }
  function pct(x, d) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function norm(v) { return Math.hypot(v[0], v[1], v[2]); }

  // ------------------------------------------------------------------------------------------------ running
  function source() { return state.caseKey === 'bennu' ? K.bennuCase() : K.importClosing(state.h42); }
  function run() {
    var src = source();
    if (src.refusal) { state.R = { refusal: src.refusal }; render(); return; }
    var S = Object.assign({}, state.S, { scan: false, orbitB: false });
    var R = K.run(src, S);
    state.R = R; state.scanSel = null;
    if (!R.refusal && R.B.key !== 'bennu') R.S.orbitB = true;   // (Apophis has no Orbital B: the setting changes nothing)
    render();
    if (!R.refusal && R.B.key === 'bennu') setTimeout(function () { if (state.R === R && !R.orbitB) { K.attachOrbitB(R); render(); } }, 30);   // after the first paint
    if (!state.checks) setTimeout(buildChecks, 60);
  }
  function later() { clearTimeout(state.busyTimer); state.busyTimer = setTimeout(run, 160); }

  // ------------------------------------------------------------------------------------------------ controls
  function segSet(kind, val) { document.querySelectorAll('[data-' + kind + ']').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-' + kind) === val)); }); }
  function syncControls() {
    segSet('case', state.caseKey); segSet('gm', state.S.gm);
    var bennu = state.caseKey === 'bennu';
    document.querySelectorAll('[data-gm]').forEach(function (b) {
      var g = b.getAttribute('data-gm'), show = bennu ? (g === 'measured' || g === 'measured_sc' || g === 'density') : (g !== 'measured' && g !== 'measured_sc');
      b.hidden = !show;
    });
    $('densRow').hidden = state.S.gm !== 'density';
    $('densIn').value = state.S.density_kg_m3; $('densRange').value = state.S.density_kg_m3;
    $('qtySel').value = state.qty;
    $('daysIn').value = state.S.scanDays; $('daysRange').value = Math.min(10, state.S.scanDays); $('radIn').value = state.S.scanRadii;
    document.querySelectorAll('[data-inc]').forEach(function (c) { c.checked = state.S.scanIncl.indexOf(+c.getAttribute('data-inc')) >= 0; });
  }
  document.querySelectorAll('[data-case]').forEach(function (b) { b.addEventListener('click', function () {
    state.caseKey = b.getAttribute('data-case'); state.S.gm = state.caseKey === 'bennu' ? 'measured' : 'handoff'; state.S.site = null; syncControls(); run(); }); });
  document.querySelectorAll('[data-gm]').forEach(function (b) { b.addEventListener('click', function () { state.S.gm = b.getAttribute('data-gm'); syncControls(); run(); }); });
  $('densIn').addEventListener('change', function () { var v = parseFloat($('densIn').value); state.S.density_kg_m3 = isFinite(v) ? v : NaN; $('densRange').value = v; later(); });
  $('densRange').addEventListener('input', function () { state.S.density_kg_m3 = parseFloat($('densRange').value); $('densIn').value = state.S.density_kg_m3; later(); });
  $('qtySel').addEventListener('change', function () { state.qty = $('qtySel').value; drawShape(); });
  $('siteReset').addEventListener('click', function () { state.S.site = null; run(); });
  $('daysIn').addEventListener('change', function () { var v = parseFloat($('daysIn').value); state.S.scanDays = isFinite(v) ? v : NaN; $('daysRange').value = Math.min(10, v); });
  $('daysRange').addEventListener('input', function () { state.S.scanDays = parseFloat($('daysRange').value); $('daysIn').value = state.S.scanDays; });
  $('radIn').addEventListener('change', function () { state.S.scanRadii = parseInt($('radIn').value, 10); });
  document.querySelectorAll('[data-inc]').forEach(function (c) { c.addEventListener('change', function () {
    state.S.scanIncl = Array.prototype.filter.call(document.querySelectorAll('[data-inc]'), function (x) { return x.checked; }).map(function (x) { return +x.getAttribute('data-inc'); }); }); });
  $('resetBtn').addEventListener('click', function () { state.S = K.defaults(); if (state.caseKey === 'bennu') state.S.gm = 'measured'; state.yaw = -35 * DEG; state.pitch = 18 * DEG; syncControls(); run(); });
  $('scanBtn').addEventListener('click', scan);

  /** Fly the scan a step at a time so the page stays responsive. */
  function scan() {
    var R = state.R; if (!R || R.refusal || state.scanning) return;
    var errs = K.validSettings(Object.assign({}, R.S, { scanDays: state.S.scanDays, scanRadii: state.S.scanRadii, scanIncl: state.S.scanIncl }));
    if (errs.length) { $('runNote').textContent = 'Refused (invalid input): ' + errs.join('; ') + '.'; return; }
    var S = Object.assign({}, R.S, { scanDays: state.S.scanDays, scanRadii: state.S.scanRadii, scanIncl: state.S.scanIncl.slice() }), plan = K.scanPlan(R.B, S), rows = [], i = 0, cur = null;
    state.scanning = true; $('scanBtn').disabled = true; $('scanBar').style.width = '0%';
    (function step() {
      if (state.R !== R) { state.scanning = false; $('scanBtn').disabled = false; $('scanBar').style.width = '0%'; $('runNote').textContent = 'Scan stopped: the inputs changed.'; return; }
      var t0 = Date.now();
      while (Date.now() - t0 < 20) {   // ~20 ms of flying per slice, so taps and paints get through
        if (!cur) { if (i >= plan.plan.length) break; var q = plan.plan[i++]; cur = K.orbitStart(R.B, q.r, q.inc, S.scanDays); }
        cur.flight.advance(1);
        if (cur.flight.done) { rows.push(K.orbitFinish(cur)); cur = null; }
      }
      if (cur || i < plan.plan.length) {
        $('scanBar').style.width = (100 * (rows.length + (cur ? cur.flight.k / cur.flight.n : 0)) / plan.plan.length).toFixed(0) + '%'; $('runNote').textContent = 'Flying orbit ' + Math.min(plan.plan.length, rows.length + 1) + ' of ' + plan.plan.length + '…';
        setTimeout(step, 0); return;
      }
      K.attachScan(R, { rows: rows, radii: plan.radii, refusedRadii: plan.refusedRadii, days: S.scanDays, incl: S.scanIncl.slice() });
      state.scanning = false; $('scanBtn').disabled = false; $('runNote').textContent = rows.length + ' orbits flown for ' + f(S.scanDays, 3) + ' days each.';
      state.scanSel = 0; render();
    })();
  }

  // ------------------------------------------------------------------------------------------------ rendering
  function tile(k, v, u, conf, sub, cls) {
    return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + (conf ? '<span class="c">' + conf + '</span>' : '') + '</div>';
  }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code.replace(/_/g, ' ')) + (r.applies_to ? ': ' + esc(r.applies_to.replace(/_/g, ' ')) : '') + (r.from ? ' <small>(from ' + esc(r.from) + ')</small>' : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function render() {
    var R = state.R;
    syncControls();
    if (!R || R.refusal) {
      $('tiles').innerHTML = ''; $('siteBox').innerHTML = ''; $('scanGrid').innerHTML = '';
      $('refusals').innerHTML = R ? refusalHtml(R.refusal) : '';
      $('srcLine').textContent = ''; $('resLine').textContent = 'Nothing computed: the inputs are refused.';
      ['shapeView', 'histChart', 'profChart', 'eqChart', 'trackChart', 'obChart', 'cbar'].forEach(function (id) { blank($(id)); });
      ['histCap', 'profCap', 'eqCap', 'trackCap', 'obCap', 'cbMin', 'cbMax'].forEach(function (id) { $(id).textContent = ''; });
      return;
    }
    var B = R.B, P = R.P, s = R.surface.stats, st = R.site, src = R.src;
    $('srcLine').textContent = src.from === 'bennu2019' ? 'Bennu on 19 June 2019 00:00 TDB, the start of the OSIRIS-REx Orbital B arc (JPL Horizons); GM from Scheeres et al. 2020.'
      : 'Idea 42\'s handoff: ' + src.name + ', stand-off ' + day(src.epoch) + ' UTC at ' + f(norm(src.standoff.r) / 1000, 3) + ' km; GM ' + f(src.body.GM_m3_s2, 3) + ' m³/s² (' + src.body.GM_confidence + ').';
    $('resLine').textContent = P.meta.label + ': ' + P.nf.toLocaleString('en-US') + ' plates; ' + (B.att.kind === 'tumbling' ? 'tumbling' : 'spinning') + ' with an instantaneous period of ' + f(B.att.period_h, 4) + ' h at ' + day(B.epoch) + ' UTC.';
    var gmConf = B.GMconf === 'measured' ? 'measured' : 'assumed';
    var eq = R.equilibria;
    $('tiles').innerHTML = [
      tile('GM', f(B.GM, 4), 'm³/s²', gmConf, esc(B.GMsrc).slice(0, 90)),
      tile('Bulk density', f(B.rho, 4), 'kg/m³', gmConf, 'GM / (G × ' + f(P.volume / 1e9, 4) + ' km³)'),
      tile('Size', f(2 * B.Req, 4), 'm', 'measured', 'volume-equivalent diameter; Brillouin sphere ' + f(P.rMax, 4) + ' m'),
      tile('Surface gravity', f(s.gravity.min * 1e6, 3) + '–' + f(s.gravity.max * 1e6, 3), 'µm/s²', 'derived', 'mean ' + f(s.gravity.mean * 1e6, 3) + ' µm/s²; with the spin ' + f(s.accel.min * 1e6, 3) + '–' + f(s.accel.max * 1e6, 3)),
      tile('Mean slope', f(s.slope.mean, 3), '°', 'derived', 'median ' + f(s.slope.median, 3) + '°, steepest ' + f(s.slope.max, 3) + '°; ' + f(100 * s.steeper30, 2) + '% of the area over 30°'),
      tile('Escape straight up', f(s.vUp.min * 100, 3) + '–' + f(s.vUp.max * 100, 3), 'cm/s', 'derived', 'along the spin it can take ' + f(s.vMin.min * 100, 3) + ' cm/s'),
      tile('Point mass wrong by', f(pmTile(R) * 100, 3), '%', 'derived', 'at the Brillouin sphere along the long axis; ' + f(K.pmErrors(R)[3].relative_error * 100, 2) + '% at four times it'),
      tile('J2 (normalised)', f(R.sh.J[2], 4), '', 'derived', 'about the centre of mass, R0 = Brillouin radius ' + f(R.sh.R0, 4) + ' m'),
      eq.refusal ? tile('Equilibria', 'none', '', 'refused', 'a tumbler has no frame where its field stands still', 'refused') :
        tile('Equilibria', eq.points.length, '', 'derived', eq.points.filter(function (q) { return q.stability.kind === 'saddle'; }).length + ' saddles, ' + eq.points.filter(function (q) { return q.stability.kind === 'centre'; }).length + ' centres, ' + eq.points.filter(function (q) { return q.stability.stable; }).length + ' stable; ' + f(100 * R.roche, 3) + '% of the surface inside the Roche lobe'),
      R.orbitB ? tile('Orbital B: 2-h legs miss by', f(R.orbitB.poly.legDv_median_m_s * 1000, 3), 'mm/s', 'measured', 'the shape; a point mass ' + f(R.orbitB.pm.legDv_median_m_s * 1000, 3) + ' mm/s (median of ' + R.orbitB.poly.legs + ')', 'hero') :
        tile('Site gravity', f(st.gravity_mag_m_s2 * 1e6, 4), 'µm/s²', 'derived', 'a point mass at that radius: ' + f(B.GM / (st.radius_m * st.radius_m) * 1e6, 4) + ' µm/s²', 'hero')
    ].join('');
    var own = R.own, carried = R.carried;
    $('refusals').innerHTML = own.map(refusalHtml).join('');
    $('carriedSum').textContent = 'Refusals carried from earlier modules (' + carried.length + ')';
    $('carriedList').innerHTML = carried.length ? carried.map(refusalHtml).join('') : '<p class="small">None: this case starts here.</p>';
    $('carried').hidden = !carried.length;
    $('siteBox').innerHTML = '<b>Site ' + (state.S.site === null ? '(under the stand-off)' : '(chosen)') + ': plate ' + st.face + '</b>, latitude ' + f(st.lat_deg, 3) + '°, longitude ' + f(st.lon_deg, 4) + '°, ' + f(st.radius_m, 4) + ' m from the centre. ' +
      'Gravity <b>' + f(st.gravity_mag_m_s2 * 1e6, 4) + ' µm/s²</b> (a point mass: ' + f(B.GM / (st.radius_m * st.radius_m) * 1e6, 4) + '), slope <b>' + f(st.slope_deg, 3) + '°</b>, height ' + f(st.height_m, 3) + ' m, escape straight up <b>' + f(st.escape_up_m_s * 100, 4) + ' cm/s</b>, along the spin ' + f(st.escape_min_m_s * 100, 4) + ' cm/s. <span class="c">derived</span>';
    drawShape(); drawHist(); drawProfile(); drawEq(); drawTrack(); scanGrid(); drawOB(); checksTable();
  }
  function pmTile(R) { return K.pmErrors(R)[0].relative_error; }

  // ------------------------------------------------------------------------------------------------ canvas helpers
  function setup(cv, aspect, minH, maxH) {
    var w = cv.clientWidth || 320, h = Math.max(minH || 200, Math.min(maxH || 300, Math.round(w * (aspect || 0.55)))), r = window.devicePixelRatio || 1;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r); cv.style.height = h + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function blank(cv) { var c = setup(cv); c.ctx.clearRect(0, 0, c.w, c.h); }
  /** A small plotter: log or linear axes. o: {x:[a,b], y:[a,b], xlog, ylog, xlab, ylab} */
  function frame(cv, o) {
    var c = setup(cv), ctx = c.ctx, pl = 52, pr = 10, pt = 10, pb = 38, W = c.w - pl - pr, H = c.h - pt - pb;
    var tx = function (v) { var u = o.xlog ? (Math.log10(v) - Math.log10(o.x[0])) / (Math.log10(o.x[1]) - Math.log10(o.x[0])) : (v - o.x[0]) / (o.x[1] - o.x[0]); return pl + u * W; };
    var ty = function (v) { var u = o.ylog ? (Math.log10(v) - Math.log10(o.y[0])) / (Math.log10(o.y[1]) - Math.log10(o.y[0])) : (v - o.y[0]) / (o.y[1] - o.y[0]); return pt + (1 - u) * H; };
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--ink-2'); ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    function ticks(lo, hi, log) { var out = []; if (log) { for (var e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) { var v = Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } } else { var step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); var n = (hi - lo) / step; if (n > 10) step *= 2; if (n > 20) step *= 2.5; for (var x = Math.ceil(lo / step) * step; x <= hi + 1e-9; x += step) out.push(+x.toPrecision(10)); } return out; }
    function lab(v, log) { if (log) { var e = Math.round(Math.log10(v)); return e >= -2 && e <= 4 ? String(+v.toPrecision(3)) : '1e' + e; } return String(+v.toPrecision(4)); }
    var xt = ticks(o.x[0], o.x[1], o.xlog), yt = ticks(o.y[0], o.y[1], o.ylog);
    var maxX = Math.max(3, Math.floor(W / 60)); while (xt.length > maxX) xt = xt.filter(function (_, i) { return i % 2 === 0; });
    while (yt.length > 7) yt = yt.filter(function (_, i) { return i % 2 === 0; });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.forEach(function (v) { var X = tx(v); ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.fillText(lab(v, o.xlog), X, pt + H + 4); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(function (v) { var Y = ty(v); ctx.beginPath(); ctx.moveTo(pl, Y); ctx.lineTo(pl + W, Y); ctx.stroke(); ctx.fillText(lab(v, o.ylog), pl - 4, Y); });
    ctx.strokeStyle = css('--axis'); ctx.strokeRect(pl, pt, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xlab || '', pl + W / 2, c.h - 2);
    ctx.save(); ctx.translate(11, pt + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(o.ylab || '', 0, 0); ctx.restore();
    return { ctx: ctx, tx: tx, ty: ty, pl: pl, pt: pt, W: W, H: H, w: c.w, h: c.h,
      line: function (xs, ys, color, dash, width) { ctx.save(); ctx.beginPath(); ctx.rect(pl, pt, W, H); ctx.clip(); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); var on = false; for (var i = 0; i < xs.length; i++) { var a = xs[i], b = ys[i]; if (!isFinite(a) || !isFinite(b) || (o.ylog && b <= 0) || (o.xlog && a <= 0)) { on = false; continue; } var X = tx(a), Y = ty(b); if (!on) { ctx.moveTo(X, Y); on = true; } else ctx.lineTo(X, Y); } ctx.stroke(); ctx.restore(); },
      vmark: function (v, color, text, dash, row) { if (!(v >= o.x[0] && v <= o.x[1])) return; var X = tx(v); ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash || [4, 3]); ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = X > pl + W * 0.7 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, X + (X > pl + W * 0.7 ? -3 : 3), pt + 3 + 13 * (row || 0)); } ctx.restore(); },
      hmark: function (v, color, text) { if (!(v >= o.y[0] && v <= o.y[1])) return; var Y = ty(v); ctx.save(); ctx.strokeStyle = color; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(pl, Y); ctx.lineTo(pl + W, Y); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(text, pl + W - 3, Y - 2); } ctx.restore(); } };
  }
  /** A perceptual sequential palette (viridis-like stops), t in [0, 1]. */
  var STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  function pal(t) { t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1); var i = Math.min(STOPS.length - 2, Math.floor(t)), u = t - i, a = STOPS[i], b = STOPS[i + 1]; return [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])]; }

  // ------------------------------------------------------------------------------------------------ the shape viewer
  var QTY = { slope: { k: 'slope', u: '°', s: 1 }, accel: { k: 'accel', u: 'µm/s²', s: 1e6 }, gravity: { k: 'gravity', u: 'µm/s²', s: 1e6 }, height: { k: 'height', u: 'm', s: 1 }, vUp: { k: 'vUp', u: 'cm/s', s: 100 } };
  var view = null;
  function rotM() { var cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch); return [cy, -sy, 0, cp * sy, cp * cy, -sp, sp * sy, sp * cy, cp]; }
  function drawShape() {
    var R = state.R, cv = $('shapeView'); if (!R || R.refusal) return;
    var c = setup(cv, 0.8, 260, 440), ctx = c.ctx, P = R.P, M = rotM(), q = QTY[state.qty], vals = R.surface[q.k];
    var lo = Infinity, hi = -Infinity; for (var i = 0; i < vals.length; i++) { lo = Math.min(lo, vals[i]); hi = Math.max(hi, vals[i]); }
    var sc = 0.46 * Math.min(c.w, c.h) / P.rMax, cx = c.w / 2, cy = c.h / 2, n = P.nv, X = new Float64Array(n), Y = new Float64Array(n), D = new Float64Array(n);
    for (i = 0; i < n; i++) { var x = P.V[3 * i], y = P.V[3 * i + 1], z = P.V[3 * i + 2]; X[i] = cx + sc * (M[0] * x + M[1] * y + M[2] * z); D[i] = M[3] * x + M[4] * y + M[5] * z; Y[i] = cy - sc * (M[6] * x + M[7] * y + M[8] * z); }
    var order = [], L = [-0.45, -0.75, 0.5], ln = Math.hypot(L[0], L[1], L[2]);
    for (var fi = 0; fi < P.nf; fi++) { var ny = M[3] * P.FN[3 * fi] + M[4] * P.FN[3 * fi + 1] + M[5] * P.FN[3 * fi + 2]; if (ny < 0) order.push(fi); }
    var depth = function (fi) { return D[P.F[3 * fi]] + D[P.F[3 * fi + 1]] + D[P.F[3 * fi + 2]]; };
    order.sort(function (a, b) { return depth(b) - depth(a); });
    ctx.clearRect(0, 0, c.w, c.h);
    order.forEach(function (fi) {
      var a = P.F[3 * fi], b = P.F[3 * fi + 1], d = P.F[3 * fi + 2], nr = [P.FN[3 * fi], P.FN[3 * fi + 1], P.FN[3 * fi + 2]];
      var nv = [M[0] * nr[0] + M[1] * nr[1] + M[2] * nr[2], M[3] * nr[0] + M[4] * nr[1] + M[5] * nr[2], M[6] * nr[0] + M[7] * nr[1] + M[8] * nr[2]];
      var lit = 0.55 + 0.45 * Math.max(0, -(nv[0] * L[0] + nv[1] * L[1] + nv[2] * L[2]) / ln), col = pal(0.12 + 0.88 * (vals[fi] - lo) / (hi - lo || 1));
      ctx.fillStyle = 'rgb(' + Math.round(col[0] * lit) + ',' + Math.round(col[1] * lit) + ',' + Math.round(col[2] * lit) + ')';
      ctx.beginPath(); ctx.moveTo(X[a], Y[a]); ctx.lineTo(X[b], Y[b]); ctx.lineTo(X[d], Y[d]); ctx.closePath(); ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
    });
    // the spin axis (Bennu's pole; Apophis's angular momentum, which the body tumbles about)
    var ax = R.B.att.kind === 'tumbling' ? K.poleIcrf(R.B) : null, axb = ax ? [0, 1, 2].map(function (k) { return R.B.att.C[3 * k] * ax[0] + R.B.att.C[3 * k + 1] * ax[1] + R.B.att.C[3 * k + 2] * ax[2]; }) : [0, 0, 1];
    var ex = M[0] * axb[0] + M[1] * axb[1] + M[2] * axb[2], ez = M[6] * axb[0] + M[7] * axb[1] + M[8] * axb[2], Lx = 1.25 * P.rMax * sc;
    ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(cx - ex * Lx, cy + ez * Lx); ctx.lineTo(cx + ex * Lx, cy - ez * Lx); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--ink'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(R.B.att.kind === 'tumbling' ? 'L (spin momentum)' : 'spin pole', cx + ex * Lx + 4, cy - ez * Lx);
    // the site
    var f0 = R.site.face, sx = 0, sy = 0, sd = 0; [0, 1, 2].forEach(function (k) { var v = P.F[3 * f0 + k]; sx += X[v] / 3; sy += Y[v] / 3; });
    var sn = M[3] * P.FN[3 * f0] + M[4] * P.FN[3 * f0 + 1] + M[5] * P.FN[3 * f0 + 2];
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2 * Math.PI); ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#d03b3b'; ctx.setLineDash(sn < 0 ? [] : [2, 2]); ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'left'; ctx.fillText(sn < 0 ? 'site' : 'site (behind)', sx + 10, sy + 3);
    // 100 m scale bar
    var bar = 100 * sc; ctx.strokeStyle = css('--ink-2'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, c.h - 12); ctx.lineTo(10 + bar, c.h - 12); ctx.stroke(); ctx.fillText('100 m', 14 + bar, c.h - 8);
    view = { X: X, Y: Y, D: D, order: order, P: P };
    // colour bar
    var cb = setup($('cbar'), 0.02, 12, 12), g = cb.ctx; for (var k = 0; k < cb.w; k++) { var cc = pal(0.12 + 0.88 * k / cb.w); g.fillStyle = 'rgb(' + cc.map(Math.round).join(',') + ')'; g.fillRect(k, 0, 1, cb.h); }
    $('cbMin').textContent = f(lo * q.s, 3); $('cbMax').textContent = f(hi * q.s, 3) + ' ' + q.u;
  }
  function pickAt(px, py) {
    if (!view) return -1; var best = -1, bd = Infinity, P = view.P;
    for (var j = 0; j < view.order.length; j++) {
      var fi = view.order[j], a = P.F[3 * fi], b = P.F[3 * fi + 1], d = P.F[3 * fi + 2];
      var x0 = view.X[a], y0 = view.Y[a], x1 = view.X[b], y1 = view.Y[b], x2 = view.X[d], y2 = view.Y[d];
      var den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2); if (Math.abs(den) < 1e-12) continue;
      var l1 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den, l2 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den, l3 = 1 - l1 - l2;
      if (l1 >= 0 && l2 >= 0 && l3 >= 0) { var dep = view.D[a] + view.D[b] + view.D[d]; if (dep < bd) { bd = dep; best = fi; } }
    }
    return best;
  }
  (function viewer() {
    var cv = $('shapeView'), drag = null, raf = 0;
    function redraw() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; drawShape(); }); }
    cv.addEventListener('pointerdown', function (e) { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch, moved: 0 }; });
    cv.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy)); state.yaw = drag.yaw + dx * 0.012; state.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + dy * 0.012)); redraw(); });
    cv.addEventListener('pointerup', function (e) {
      if (!drag) return; var moved = drag.moved; drag = null;
      if (moved < 6) { var r = cv.getBoundingClientRect(), fi = pickAt(e.clientX - r.left, e.clientY - r.top); if (fi >= 0) { state.S.site = fi; run(); } }
    });
    cv.addEventListener('pointercancel', function () { drag = null; });
    cv.addEventListener('keydown', function (e) {
      var k = e.key, d = 10 * DEG;
      if (k === 'ArrowLeft') state.yaw -= d; else if (k === 'ArrowRight') state.yaw += d; else if (k === 'ArrowUp') state.pitch = Math.max(-1.5, state.pitch - d); else if (k === 'ArrowDown') state.pitch = Math.min(1.5, state.pitch + d);
      else if (k === 'Enter' || k === ' ') { var fi = pickAt(cv.clientWidth / 2, cv.clientHeight / 2); if (fi >= 0) { state.S.site = fi; run(); } e.preventDefault(); return; }
      else return;
      e.preventDefault(); drawShape();
    });
  })();

  // ------------------------------------------------------------------------------------------------ charts
  function drawHist() {
    var R = state.R, s = R.surface.stats, h = s.slopeHist5deg, ymax = Math.max.apply(null, h) * 1.15;
    var F = frame($('histChart'), { x: [0, 95], y: [0, Math.max(0.05, ymax) * 100], xlab: 'slope (degrees), 5° bins', ylab: '% of the surface' }), ctx = F.ctx;
    ctx.fillStyle = css('--s1');
    h.forEach(function (v, i) { var x0 = F.tx(5 * i), x1 = F.tx(5 * i + 5); ctx.fillRect(x0 + 1, F.ty(v * 100), x1 - x0 - 2, F.ty(0) - F.ty(v * 100)); });
    F.vmark(s.slope.mean, css('--ink'), 'mean ' + f(s.slope.mean, 3) + '°', []);
    if (R.B.key === 'bennu') F.vmark(BAR.slope_deg.weightedMean, css('--s2'), 'Barnouin 2019 (3 m): ' + BAR.slope_deg.weightedMean + '°', null, 1);
    $('histCap').textContent = 'Area-weighted slope against gravity and spin at ' + day(R.B.epoch) + ' UTC. ' + f(100 * s.steeper30, 2) + '% of the area is steeper than 30° and ' + f(100 * s.steeper40, 2) + '% steeper than 40°.' + (R.B.key === 'bennu' ? ' On 25 m plates slopes are smoother than at a lander\'s scale: Bennu\'s 12.6 m model averages 15.8°, its 3 m model 17 ± 2°.' : '');
  }
  function drawProfile() {
    var R = state.R, P = R.P, B = R.B, d = [P.FC[3 * R.site.face], P.FC[3 * R.site.face + 1], P.FC[3 * R.site.face + 2]], u = d.map(function (c) { return c / norm(d); });
    var r0 = norm(d) + 1, r1 = 6 * P.rMax, xs = [], lump = [], sun = [];
    for (var i = 0; i <= 48; i++) {
      var r = r0 * Math.pow(r1 / r0, i / 48), x = u.map(function (c) { return c * r; }), g = K.field(P, B.Grho, x).g, pm = u.map(function (c) { return -c * B.GM / (r * r); });
      xs.push(r); lump.push(100 * norm([g[0] - pm[0], g[1] - pm[1], g[2] - pm[2]]) / norm(pm));
      sun.push(B.srp_m_s2 ? 100 * B.srp_m_s2 / (B.GM / (r * r)) : NaN);
    }
    var ys = lump.concat(sun.filter(isFinite)), F = frame($('profChart'), { x: [r0, r1], xlog: true, y: [Math.max(1e-3, Math.min.apply(null, ys) * 0.7), Math.max(10, Math.max.apply(null, ys) * 1.4)], ylog: true, xlab: 'distance from the centre of mass (m), through the site', ylab: '% of gravity' });
    F.line(xs, lump, css('--s1')); F.line(xs, sun, css('--s2'), [6, 4]);
    F.vmark(P.rMax, css('--ink-2'), 'Brillouin sphere'); F.hmark(5, css('--muted'), '5%');
    $('profLegend').innerHTML = '<li><span class="key" style="border-color:' + css('--s1') + '"></span>the shape against a point mass</li>' + (B.srp_m_s2 ? '<li><span class="key dash" style="border-color:' + css('--s2') + '"></span>sunlight (idea 42)</li>' : '');
    $('profCap').textContent = 'Just above the site the lumps change gravity by ' + f(lump[0], 3) + '%; at 4 Brillouin radii by ' + f(lump[Math.round(48 * Math.log(4 * P.rMax / r0) / Math.log(r1 / r0))], 2) + '%.' + (B.srp_m_s2 ? ' Sunlight on idea 42\'s spacecraft passes 5% of gravity at ' + f(Math.sqrt(0.05 * B.GM / B.srp_m_s2), 4) + ' m: beyond it, orbits are idea 42\'s problem.' : ' No spacecraft is given here, so sunlight is not drawn.');
  }
  /** The body's outline where the plane z = 0 (body frame) cuts it: line segments. */
  function slice(P) {
    var seg = [];
    for (var fi = 0; fi < P.nf; fi++) {
      var p = [0, 1, 2].map(function (k) { var v = P.F[3 * fi + k]; return [P.V[3 * v], P.V[3 * v + 1], P.V[3 * v + 2]]; }), pts = [];
      for (var k = 0; k < 3; k++) { var a = p[k], b = p[(k + 1) % 3]; if ((a[2] > 0) !== (b[2] > 0)) { var t = a[2] / (a[2] - b[2]); pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); } }
      if (pts.length === 2) seg.push(pts);
    }
    return seg;
  }
  function planFrame(cv, R, ext) {
    var c = setup(cv, 0.8, 240, 360), ctx = c.ctx, s = Math.min(c.w, c.h) / (2.2 * ext), cx = c.w / 2, cy = c.h / 2;
    ctx.clearRect(0, 0, c.w, c.h); ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.5;
    slice(R.P).forEach(function (sg) { ctx.beginPath(); ctx.moveTo(cx + s * sg[0][0], cy - s * sg[0][1]); ctx.lineTo(cx + s * sg[1][0], cy - s * sg[1][1]); ctx.stroke(); });
    ctx.fillStyle = css('--ink-2'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
    var bar = Math.pow(10, Math.floor(Math.log10(ext))); ctx.strokeStyle = css('--ink-2'); ctx.beginPath(); ctx.moveTo(10, c.h - 12); ctx.lineTo(10 + bar * s, c.h - 12); ctx.stroke(); ctx.fillText(f(bar, 3) + ' m', 14 + bar * s, c.h - 8);
    return { ctx: ctx, s: s, cx: cx, cy: cy, w: c.w, h: c.h };
  }
  function drawEq() {
    var R = state.R, eq = R.equilibria, ext = eq.refusal ? 1.2 * R.P.rMax : 1.25 * Math.max(R.P.rMax, eq.synchronous_m), G = planFrame($('eqChart'), R, ext), ctx = G.ctx;
    if (eq.refusal) {
      ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'center'; ctx.fillText('No equilibria: ' + R.B.name.split(' ')[1] + ' tumbles.', G.w / 2, 16);
      $('eqLegend').innerHTML = ''; $('eqCap').textContent = 'The equatorial cross-section of the shape (body z = 0). A tumbling body has no frame where its field stands still, so it has no equilibrium points and no rotational Roche lobe (refused above).'; return;
    }
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(G.cx, G.cy, eq.synchronous_m * G.s, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    eq.points.forEach(function (q) {
      var X = G.cx + G.s * q.x[0], Y = G.cy - G.s * q.x[1]; ctx.fillStyle = q.stability.kind === 'saddle' ? css('--s2') : css('--s1'); ctx.beginPath();
      if (q.stability.kind === 'saddle') { ctx.moveTo(X, Y - 6); ctx.lineTo(X + 5.5, Y + 4); ctx.lineTo(X - 5.5, Y + 4); ctx.closePath(); } else ctx.arc(X, Y, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
    $('eqLegend').innerHTML = '<li><span class="key dot" style="background:' + css('--s2') + '"></span>saddle</li><li><span class="key dot" style="background:' + css('--s1') + '"></span>centre</li><li><span class="key dash" style="border-color:' + css('--muted') + '"></span>synchronous radius ' + f(eq.synchronous_m, 4) + ' m</li>';
    var fastest = Math.min.apply(null, eq.points.map(function (q) { return q.stability.efold_h || Infinity; }));
    $('eqCap').textContent = eq.points.length + ' equilibria ' + f(Math.min.apply(null, eq.points.map(function (q) { return q.r_m; })), 4) + ' to ' + f(Math.max.apply(null, eq.points.map(function (q) { return q.r_m; })), 4) + ' m from the centre, ' + eq.points.filter(function (q) { return q.stability.stable; }).length + ' stable; the fastest grows e-fold in ' + f(fastest, 3) + ' h. ' + f(100 * R.roche, 3) + '% of the surface lies below the lowest equilibrium\'s energy (inside the rotational Roche lobe). Seen from the spin pole, body frame.';
  }
  function drawTrack() {
    var R = state.R, sc = R.scan, row = sc && state.scanSel !== null ? sc.rows[state.scanSel] : null, ext = row ? Math.max(R.P.rMax, row.rmax_m || row.r_m) * 1.15 : 1.2 * R.P.rMax, G = planFrame($('trackChart'), R, ext), ctx = G.ctx;
    if (!row) { ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'center'; ctx.fillText('Fly the orbits, then choose one below.', G.w / 2, 16); $('trackCap').textContent = 'The equatorial cross-section of the shape, seen from the spin pole.'; return; }
    ctx.strokeStyle = row.outcome === 'impact' ? css('--crit') : row.outcome === 'escape' ? css('--warn') : css('--s3'); ctx.lineWidth = 1.2; ctx.beginPath();
    (row.track || []).forEach(function (p, i) { var X = G.cx + G.s * p[0], Y = G.cy - G.s * p[1]; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.stroke();
    $('trackCap').textContent = 'Start ' + f(row.r_m, 4) + ' m, inclination ' + row.inc_deg + '° to the spin: ' + (row.outcome === 'survive' ? 'still in orbit after ' + f(R.scan.days, 3) + ' days' : row.outcome + ' after ' + f(row.t_days, 3) + ' days') + ' (radius ' + f(row.rmin_m, 4) + ' to ' + f(row.rmax_m, 4) + ' m). Body frame, seen from the spin pole; a point mass would keep it circular.';
  }
  function scanGrid() {
    var R = state.R, sc = R.scan, el = $('scanGrid');
    if (!sc) { el.innerHTML = '<p class="small">Fly circular starts from just outside the Brillouin sphere (' + f(R.P.rMax, 4) + ' m) out to four times it, under the shape\'s gravity as the body turns. Under a point mass every one would last forever.</p>'; return; }
    var incl = sc.incl, radii = sc.radii.filter(function (r) { return sc.refusedRadii.indexOf(r) < 0; });
    el.style.gridTemplateColumns = 'minmax(56px, 0.8fr) repeat(' + incl.length + ', minmax(0, 1fr))';
    var html = '<div class="hdr">start</div>' + incl.map(function (i) { return '<div class="hdr">' + i + '°</div>'; }).join('');
    radii.forEach(function (r) {
      html += '<div class="hdr">' + f(r, 4) + ' m</div>';
      incl.forEach(function (inc) {
        var k = sc.rows.findIndex(function (q) { return q.r_m === r && q.inc_deg === inc; }), q = sc.rows[k];
        html += '<button type="button" class="o-' + q.outcome + '" data-k="' + k + '" aria-pressed="' + (state.scanSel === k) + '">' + (q.outcome === 'survive' ? 'lasts' : q.outcome + ' ' + f(q.t_days, 2) + ' d') + '</button>';
      });
    });
    el.innerHTML = html;
    el.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { state.scanSel = +b.getAttribute('data-k'); scanGrid(); drawTrack(); }); });
  }
  function drawOB() {
    var R = state.R, cv = $('obChart'), ob = R.orbitB;
    if (!ob) { var c = setup(cv), ctx = c.ctx; ctx.clearRect(0, 0, c.w, c.h); ctx.fillStyle = css('--ink-2'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Bennu only: choose "Bennu, OSIRIS-REx 2019" above.', c.w / 2, c.h / 2); $('obLegend').innerHTML = ''; $('obCap').textContent = 'No spacecraft has orbited Apophis yet (OSIRIS-APEX arrives in 2029), so there is nothing to test its field against.'; return; }
    var F = frame(cv, { x: [0, 40], y: [0, Math.max(ob.pm.arcMax_m, ob.poly.arcMax_m) * 1.15], xlab: 'hours from 2019-06-19 00:00 TDB', ylab: 'off the reconstruction (m)' });
    F.line(ob.pm.hours, ob.pm.arcError_m, css('--s2')); F.line(ob.poly.hours, ob.poly.arcError_m, css('--s1'));
    $('obLegend').innerHTML = '<li><span class="key" style="border-color:' + css('--s2') + '"></span>point mass</li><li><span class="key" style="border-color:' + css('--s1') + '"></span>the shape (uniform density)</li>';
    $('obCap').textContent = 'GM ' + f(R.B.GM, 7) + ' m³/s². Leg by leg (20 legs of 2 h from the reconstructed states) the shape misses the reconstructed velocity by a median ' + f(ob.poly.legDv_median_m_s * 1000, 3) + ' mm/s, a point mass by ' + f(ob.pm.legDv_median_m_s * 1000, 3) + ' mm/s. Over the 40 h arc: ' + f(ob.poly.arcEnd_m, 3) + ' m against ' + f(ob.pm.arcEnd_m, 3) + ' m. The arc depends on which published GM you take (try both "Measured" buttons); the legs barely do.';
  }

  // ------------------------------------------------------------------------------------------------ checks
  function buildChecks() {
    var a = K.run(K.importClosing(window.LumpyClosingSample), K.defaults()), b = K.run(K.bennuCase(), K.defaults()), bd = K.run(K.bennuCase(), Object.assign(K.defaults(), { centre: 'dsk', orbitB: false }));
    var bsc = K.bodyModel(K.bennuCase(), Object.assign(K.defaults(), { gm: 'measured_sc' })), obsc = { pm: K.orbitB(bsc, 'pm'), poly: K.orbitB(bsc, 'poly') };
    var J = b.shDsk.J, L = a.B.att.L_icrf, ra = (Math.atan2(L[1], L[0]) / DEG + 360) % 360, dec = Math.asin(L[2]) / DEG, ir = a.P.principal.values;
    var rows = [
      ['Bennu volume', 'Barnouin et al. 2019: ' + BAR.volume_km3 + ' ± ' + BAR.volume_1sigma_km3 + ' km³ (SPC v20)', f(b.P.volume / 1e9, 4) + ' km³ (25 m plates)', pct(b.P.volume / 1e9 / BAR.volume_km3 - 1), 'The full 12.6 m model gives 0.06124 km³ (−0.42%): the subsample shaves 0.3% more.'],
      ['Bennu density, GM / (G V)', 'Barnouin et al. 2019: ' + BAR.density_kg_m3 + ' ± ' + BAR.density_1sigma_kg_m3 + ' kg/m³', f(b.B.rho, 5) + ' kg/m³', pct(b.B.rho / BAR.density_kg_m3 - 1), 'GM 4.89045 (Scheeres et al. 2020, particle field) over this shape\'s volume: inside 1 sigma.'],
      ['Bennu centre of figure from the centre of mass', 'Barnouin et al. 2019: [1.38, −0.43, −0.12] ± [0.04, 0.07, 0.27] m', '[' + bd.P.comOffsetDsk.map(function (v) { return f(v, 3); }).join(', ') + '] m', f(bd.P.comOffsetDsk[0] - BAR.comCofOffset_m[0], 2) + ' m in x', 'A different shape model (ALT v021, not SPC v20).'],
      ['Bennu J2 (R0 = 290 m), uniform density', 'Scheeres et al. 2020: ' + SCH.J2.cd + ' (SPC v42 shape)', f(J[2], 5), pct(J[2] / SCH.J2.cd - 1), 'J3 ' + f(J[3], 4) + ' vs ' + SCH.J3.cd + ', J4 ' + f(J[4], 4) + ' vs ' + SCH.J4.cd + '.'],
      ['Bennu J2, reality', 'Scheeres et al. 2020, particle tracking: ' + SCH.J2.particle + ' ± ' + SCH.J2.particle_1sigma, f(J[2], 5) + ' (uniform)', pct(J[2] / SCH.J2.particle - 1), 'The real body has its mass further out than uniform density puts it (J3: ' + pct(J[3] / SCH.J3.particle - 1) + ', J4: ' + pct(J[4] / SCH.J4.particle - 1) + ').'],
      ['Bennu mean slope', 'Barnouin et al. 2019: ' + BAR.slope_deg.weightedMean + ' ± ' + BAR.slope_deg.weightedMean_1sigma + '° (3 m plates)', f(bd.surface.stats.slope.mean, 4) + '° (25 m plates)', f(bd.surface.stats.slope.mean - BAR.slope_deg.weightedMean, 2) + '°', 'Resolution: coarser plates smooth slopes away (the 12.6 m model gives 15.8°).'],
      ['Bennu acceleration with spin, largest', 'Barnouin et al. 2019: 0.000080 m/s²', f(bd.surface.stats.accel.max, 4) + ' m/s²', pct(bd.surface.stats.accel.max / 8.0e-5 - 1), 'Their area mean, 0.0000595, is not reproduced: this gives ' + f(bd.surface.stats.accel.mean, 3) + ' (definition unknown).'],
      ['OSIRIS-REx, Orbital B, 2-h legs (median miss)', 'JPL Horizons reconstruction; point mass ' + f(obsc.pm.legDv_median_m_s * 1000, 3) + ' mm/s', f(obsc.poly.legDv_median_m_s * 1000, 3) + ' mm/s (the shape)', '×' + f(obsc.pm.legDv_median_m_s / obsc.poly.legDv_median_m_s, 3) + ' better', 'Spacecraft-field GM 4.894557; with the particle-field GM ' + f(b.orbitB.poly.legDv_median_m_s * 1000, 3) + ' against ' + f(b.orbitB.pm.legDv_median_m_s * 1000, 3) + ' mm/s.'],
      ['Apophis size', 'SBDB and NAIF\'s PCK: 340 m mean diameter (Brozović et al. 2018)', f(2 * a.B.Req, 4) + ' m (volume-equivalent)', pct(2 * a.B.Req / 340 - 1), 'Idea 42 used 170 m and so a density of 1951 kg/m³; this shape gives ' + f(a.B.rho, 4) + '.'],
      ['Apophis inertia ratios', 'Pravec et al. 2014 (tumbling): 0.61, 0.965', f(ir[0] / ir[2], 3) + ', ' + f(ir[1] / ir[2], 3) + ' (uniform)', pct(ir[0] / ir[2] / 0.61 - 1), 'The radar shape filled evenly cannot tumble the way Apophis does.'],
      ['Apophis spin momentum direction', 'NAIF CK comment (Pravec 2014): RA 118.7906°, Dec −79.4087°', 'RA ' + f(ra, 7) + '°, Dec ' + f(dec, 6) + '°', f(Math.abs(ra - 118.790629) * 3600, 2) + '″', 'Euler\'s equations from the nearest CK sample, at the stand-off epoch.']
    ];
    state.checks = rows; checksTable();
  }
  function checksTable() {
    var tb = $('checkTable').tBodies[0]; if (!state.checks) { tb.innerHTML = '<tr><td colspan="4">Computing…</td></tr>'; return; }
    tb.innerHTML = state.checks.map(function (r) { return '<tr><td data-k="Check">' + esc(r[0]) + '<span class="why">' + esc(r[4]) + '</span></td><td data-k="Independent">' + esc(r[1]) + '</td><td class="n" data-k="This page">' + esc(r[2]) + '</td><td class="n" data-k="Gap">' + esc(r[3]) + '</td></tr>'; }).join('');
  }

  // ------------------------------------------------------------------------------------------------ handoff
  function status(msg, ok) { var el = $('hoStatus'); el.textContent = msg; el.className = 'status ' + (ok ? 'ok' : 'bad'); }
  function exportText() { var R = state.R; if (!R || R.refusal) { status('Nothing to export: the inputs are refused.', false); return null; } return JSON.stringify(K.buildHandoff(R, new Date().toISOString())); }
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function importText(text) {
    var h; try { h = JSON.parse(text); } catch (e) { status('Refused (invalid input): that is not JSON.', false); return false; }
    if (h && h.from === '42-closing-in') {
      var src = K.importClosing(h); if (src.refusal) { status('Refused (' + src.refusal.code + '): ' + src.refusal.reason, false); return false; }
      state.h42 = h; state.caseKey = 'chain'; state.S = K.defaults(); run(); status('Imported idea 42\'s handoff: ' + src.name + ', stand-off ' + day(src.epoch) + ' UTC.', true); return true;
    }
    var p = K.parseHandoff(h); if (p.refusal) { status('Refused (' + p.refusal.code + '): ' + p.refusal.reason + ' ' + p.refusal.what_would_help, false); return false; }
    if (p.h43.inputs.closing_handoff) state.h42 = p.h43.inputs.closing_handoff;
    state.caseKey = p.h43.inputs.case === 'bennu2019' ? 'bennu' : 'chain'; state.S = Object.assign(K.defaults(), p.settings, { scan: false });
    state.R = p.R; state.scanSel = p.R.scan ? 0 : null; render(); if (!state.checks) setTimeout(buildChecks, 30); status('Imported this page\'s handoff and recomputed it: it matches.', true); return true;
  }
  function copy(text, msg) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { status(msg, true); }, function () { $('importText').value = text; status('Copy is blocked here: the text is in the box above.', true); }); else { $('importText').value = text; status('The text is in the box above.', true); } }
  $('importBtn').addEventListener('click', function () { importText($('importText').value); });
  $('importFile').addEventListener('change', function () { var fl = $('importFile').files[0]; if (!fl) return; fl.text().then(function (t) { importText(t); }); });
  $('copyBtn').addEventListener('click', function () { var h = exportText(); if (h) copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
  $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'lumpy-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded lumpy-handoff.json.', true); });
  $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + b64u(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });

  window.addEventListener('resize', function () { if (state.R && !state.R.refusal) { drawShape(); drawHist(); drawProfile(); drawEq(); drawTrack(); drawOB(); } });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.R) render(); });

  syncControls();
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/), done = false;
  if (hash) { try { done = importText(unb64u(hash[1])); } catch (e) { status('Refused (invalid input): the link\'s handoff could not be read.', false); } }
  if (!done) run();
  window.LumpyPage = { K: K, state: state, run: run, scan: scan, importText: importText, exportText: exportText, pickAt: pickAt };
})();
