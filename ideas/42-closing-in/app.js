/* Closing In (idea 42): the page. Wires the controls to the kernel (closing.js), draws the charts, and imports and
 * exports the handoff. All physics is in the kernel; this file only formats and draws. */
(function () {
  'use strict';
  var K = ClosingIn.create({ lambert: LambertsRoad, coast: LongCoast, constants: LambertAster, nav: CoastNav, horizons: ClosingHorizons, bodies: ClosingBodies, sources: ClosingSources });
  var DAY = 86400, HOUR = 3600, AM_APEX = 1 / K.sources.aas24063.massToArea_kg_m2, AM_FIT = null;
  var $ = function (id) { return document.getElementById(id); };
  var state = { caseKey: 'chain', h41: ClosingSignalSample, S: K.defaults(), R: null, sel: null, timer: null };

  // ------------------------------------------------------------------------------------------------ formatting
  function f(x, sig) { if (x === null || x === undefined || !isFinite(x)) return '—'; var a = Math.abs(x); if (a !== 0 && (a >= 1e7 || a < 1e-3)) return x.toExponential((sig || 3) - 1).replace('e+', 'e'); return (+x.toPrecision(sig || 3)).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
  function km(m, sig) { return f(m / 1000, sig || 4); }
  function ang(x) { var v = Math.round(x * 10) / 10; return (v === 0 ? 0 : v).toFixed(1); }
  function day(tdb) { return K.utcOf(tdb).slice(0, 10); }
  function dt(tdb) { return K.utcOf(tdb).slice(0, 16).replace('T', ' '); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  // ------------------------------------------------------------------------------------------------ the run
  function source() { return state.caseKey === 'orex2018' ? K.orexCase() : K.importSignal(state.h41); }
  function run() {
    var src = source(), note = $('runNote');
    if (src.refusal) { state.R = { refusal: src.refusal }; render(); return; }
    var t0 = performance.now();
    state.R = K.run(src, state.S);
    note.textContent = 'Computed in ' + Math.round(performance.now() - t0) + ' ms.';
    render();
  }
  function later() { clearTimeout(state.timer); state.timer = setTimeout(run, 160); }

  // ------------------------------------------------------------------------------------------------ controls
  function syncControls() {
    var S = state.S, near = S.craft === 'near';
    segSet('case', state.caseKey); segSet('craft', S.craft); segSet('tanks', S.tanks); segSet('gm', S.gm === 'density' ? 'density' : 'measured'); segSet('gmcase', S.gmCase); segSet('tpl', S.template);
    $('dryIn').value = S.dry_kg; $('propIn').value = S.propellant_kg; $('thrIn').value = S.thrust_N; $('ispIn').value = near ? +K.nearIsp().toFixed(1) : (S.isp_s === null ? '' : S.isp_s);
    ['dryIn', 'propIn', 'thrIn', 'ispIn'].forEach(function (id) { $(id).disabled = near; });
    $('tcmSel').value = S.tcm; $('tcmSel').disabled = state.caseKey !== 'chain';
    $('amIn').value = +S.am_m2_kg.toFixed(6); $('amRange').value = S.am_m2_kg;
    $('densIn').value = S.density_kg_m3; $('densRange').value = S.density_kg_m3;
    $('densRow').style.display = S.gm === 'density' ? '' : 'none';
    var apo = state.caseKey === 'chain'; $('gmCaseRow').style.display = apo && S.gm !== 'density' ? '' : 'none';
    $('fbIn').value = Math.round(S.firstBurnRange_m / 1000); $('fbRange').value = Math.log10(S.firstBurnRange_m / 1000);
    $('fbIn').disabled = $('fbRange').disabled = state.caseKey === 'orex2018';
    $('ddIn').value = S.directDays; $('directRow').style.display = S.template === 'direct' ? '' : 'none';
    $('loopIn').value = S.groundLoopDays; $('lateIn').value = S.lateUpdateHours;
    $('soIn').value = +(S.standoff_m / 1000).toPrecision(4); $('soRange').value = Math.log10(S.standoff_m / 1000);
    $('latIn').value = S.standoffLat_deg; $('lonIn').value = S.standoffLon_deg; $('boxIn').value = S.box_m; $('stayIn').value = S.stayDays; $('scanChk').checked = S.scan;
  }
  function segSet(kind, val) { document.querySelectorAll('[data-' + kind + ']').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-' + kind) === val)); }); }
  function seg(kind, fn) { document.querySelectorAll('[data-' + kind + ']').forEach(function (b) { b.addEventListener('click', function () { fn(b.getAttribute('data-' + kind)); syncControls(); run(); }); }); }
  function numIn(id, key, scale, after) {
    $(id).addEventListener('change', function () { var v = parseFloat($(id).value); state.S[key] = isFinite(v) ? v * (scale || 1) : NaN; if (after) after(); syncControlsSoft(id); later(); });
  }
  function syncControlsSoft(except) { var keep = $(except).value; syncControls(); $(except).value = keep; }
  seg('case', function (v) { state.caseKey = v; state.sel = null; });
  seg('craft', function (v) { state.S.craft = v; if (v === 'custom' && state.S.isp_s === null) state.S.isp_s = +K.nearIsp().toFixed(1); });
  seg('tanks', function (v) { state.S.tanks = v; });
  seg('gm', function (v) { state.S.gm = v; });
  seg('gmcase', function (v) { state.S.gmCase = v; });
  seg('tpl', function (v) { state.S.template = v; });
  numIn('dryIn', 'dry_kg'); numIn('propIn', 'propellant_kg'); numIn('thrIn', 'thrust_N'); numIn('ispIn', 'isp_s');
  numIn('amIn', 'am_m2_kg'); numIn('densIn', 'density_kg_m3'); numIn('fbIn', 'firstBurnRange_m', 1000); numIn('ddIn', 'directDays');
  numIn('loopIn', 'groundLoopDays'); numIn('lateIn', 'lateUpdateHours'); numIn('soIn', 'standoff_m', 1000); numIn('latIn', 'standoffLat_deg'); numIn('lonIn', 'standoffLon_deg');
  numIn('boxIn', 'box_m'); numIn('stayIn', 'stayDays');
  $('tcmSel').addEventListener('change', function () { state.S.tcm = $('tcmSel').value; run(); });
  $('scanChk').addEventListener('change', function () { state.S.scan = $('scanChk').checked; run(); });
  function rangeIn(id, key, fn, inv) { $(id).addEventListener('input', function () { state.S[key] = fn(parseFloat($(id).value)); syncControlsSoft(id); later(); }); }
  rangeIn('amRange', 'am_m2_kg', function (x) { return x; });
  rangeIn('densRange', 'density_kg_m3', function (x) { return x; });
  rangeIn('fbRange', 'firstBurnRange_m', function (x) { return Math.round(Math.pow(10, x)) * 1000; });
  rangeIn('soRange', 'standoff_m', function (x) { return +(Math.pow(10, x) * 1000).toPrecision(3); });
  $('amApex').addEventListener('click', function () { state.S.am_m2_kg = AM_APEX; syncControls(); run(); });
  $('amFit').addEventListener('click', function () { if (AM_FIT === null) { var ft = K.fitOrbitA(240); AM_FIT = ft.failed ? AM_APEX : +ft.am_m2_kg.toPrecision(4); } state.S.am_m2_kg = AM_FIT; syncControls(); run(); });
  $('amZero').addEventListener('click', function () { state.S.am_m2_kg = 0; syncControls(); run(); });
  function soPreset(lat, lon) { state.S.standoffLat_deg = lat; state.S.standoffLon_deg = lon; syncControls(); run(); }
  var T1 = K.sources.aas19035.table1;
  $('soOrex').addEventListener('click', function () { state.S.standoff_m = K.sources.aas19035.arrivalRange_km * 1000; soPreset(T1[7][3], T1[7][4]); });
  $('soSun').addEventListener('click', function () { soPreset(0, 0); });
  $('soTerm').addEventListener('click', function () { soPreset(0, 90); });
  $('resetBtn').addEventListener('click', function () { state.S = K.defaults(); state.sel = null; syncControls(); run(); });

  // ------------------------------------------------------------------------------------------------ rendering
  function tile(k, v, u, conf, sub, cls) {
    return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + (conf ? '<span class="c">' + conf + '</span>' : '') + '</div>';
  }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code.replace(/_/g, ' ')) + (r.applies_to ? ': ' + esc(r.applies_to.replace(/_/g, ' ')) : '') + (r.from ? ' <small>(from ' + esc(r.from) + ')</small>' : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function render() {
    var R = state.R, src = R && R.src;
    $('srcLine').textContent = state.caseKey === 'orex2018' ? 'OSIRIS-REx relative to Bennu from JPL Horizons\' reconstruction on 1 Aug 2018 (3.07 million km, 701 m/s); the first burn on AAS 19-035\'s AAM-1 date, 1 Oct 2018.'
      : 'Idea 41\'s handoff: ' + (src && src.target ? src.target.name : 'Apophis') + ', arrival ' + (src && src.arrival ? dt(src.arrival.t) + ' UTC at ' + f(Math.hypot.apply(null, src.arrival.v), 4) + ' m/s' : '') + ' (idea 40\'s cruise, idea 39\'s transfer).';
    if (!R || R.refusal) {
      $('tiles').innerHTML = ''; $('resLine').textContent = 'Nothing is computed for these inputs:';
      $('refusals').innerHTML = R && R.refusal ? refusalHtml(R.refusal) : ''; $('carried').style.display = 'none';
      ['rvChart', 'rtChart', 'fChart', 'geoChart', 'dbChart'].forEach(function (id) { blank($(id)); });
      $('burnTable').tBodies[0].innerHTML = ''; $('ledgerTable').tBodies[0].innerHTML = ''; $('scanBox').innerHTML = '';
      ['rvCap', 'rtCap', 'fCap', 'geoCap', 'dbCap'].forEach(function (id) { $(id).textContent = ''; });
      return;
    }
    var B = R.burns, b0 = B[0], so = R.ap.standoff, body = R.body, M = R.mass, hv = R.hover, reg = R.regimes, det = R.detection;
    var gmConf = body.GM_confidence === 'measured' ? 'measured' : 'assumed';
    $('resLine').innerHTML = esc(body.name) + ': GM ' + f(body.GM_m3_s2, 4) + ' m³/s² (' + gmConf + '), ' + f(body.radius_m * 2, 3) + ' m across. Engine ' + f(state.S.thrust_N, 4) + ' N at ' + f(M.isp_s, 4) + ' s. Stand-off ' + km(so.r ? Math.hypot.apply(null, so.r) : 0, 3) + ' km at solar latitude ' + f(state.S.standoffLat_deg, 3) + '°, longitude ' + f(state.S.standoffLon_deg, 3) + '°.';
    var t = '';
    t += tile('First braking burn', f(b0.dv_m_s, 4), 'm/s', 'derived', 'at ' + km(b0.range_m, 4) + ' km, ' + (b0.engine === 'main' ? f(b0.duration_s / HOUR, 3) + ' h at ' + f(b0.thrust_N, 3) + ' N, covering ' + km(b0.distance_m, 3) + ' km' : 'small thrusters'), 'hero');
    t += tile('Approach, all burns', f(M.burns_dv_m_s, 5), 'm/s', 'derived', B.length + ' burns over ' + f((so.t - R.ap.t1) / DAY, 3) + ' days');
    t += tile('Propellant needed', f(M.required_propellant_kg, 4), 'kg', 'assumed', 'on ' + f(M.dry_kg, 4) + ' kg dry, ' + f(M.required_dv_m_s, 4) + ' m/s in all; ' + (state.S.craft === 'near' ? 'NEAR carried ' + M.asbuilt_kg + ' kg' : 'tanks ' + f(M.asbuilt_kg, 4) + ' kg'), M.required_propellant_kg > M.asbuilt_kg ? 'warn' : '');
    t += tile('At stand-off', day(so.t), '', 'derived', f((so.t - R.ap.t1) / DAY, 3) + ' days after the first burn; ' + f(M.standoff_kg, 4) + ' kg left', 'date');
    t += tile('Hill radius', km(reg.hill_radius_m, 3), 'km', gmConf, 'at ' + f(reg.sun_distance_m / K.AU, 3) + ' au from the Sun; stand-off at ' + f(100 * state.S.standoff_m / reg.hill_radius_m, 2) + '% of it');
    t += tile('Sunlight ÷ gravity at stand-off', f(hv.srp_m_s2 / hv.gravity_m_s2, 3), '×', 'derived', 'equal at ' + km(reg.gravity_equals_srp_m, 3) + ' km; tide ' + f(hv.tide_m_s2, 2) + ' m/s²');
    t += tile('Holding station', f(hv.dv_per_day_m_s * 1000, 3), 'mm/s a day', 'derived', 'a burn every ' + f(hv.cycle_s / HOUR, 3) + ' h in a ' + f(state.S.box_m, 4) + ' m box' + (R.deadband ? '; flown ' + R.deadband.days + ' days: ' + f(R.deadband.dv_per_day_m_s * 1000, 3) + ' mm/s a day' : ''));
    var lead = det && det.first ? det.leadToFirstBurn_s / DAY : null;
    t += det ? tile('First sight in the camera', det.first ? (det.leadIsLowerBound ? '≥ ' : '') + f(Math.abs(lead), 3) : 'not seen', det.first ? (lead >= 0 ? 'days before' : 'days after') : '', 'derived', det.first ? (det.leadIsLowerBound ? 'already bright where the computed arc begins, ' : '') + 'at ' + f(det.first.range_m / 1e9, 3) + ' million km, V ' + f(det.vLimit, 3) + ' (Bennu at OSIRIS-REx\'s first image)' : det.before, det.first && det.leadToFirstBurn_s >= state.S.groundLoopDays * DAY ? '' : 'bad')
      : tile('First sight in the camera', 'refused', '', '', 'no H and G', 'refused');
    t += src.link ? tile('Command round trip', f(src.link.rtlt_s / 60, 3), 'min', 'derived', 'at the arrival (idea 41)') : tile('Command round trip', '—', '', '', 'not in this case');
    t += tile('Knowledge before the camera', R.knowledge.spacecraft_m ? km(R.knowledge.spacecraft_m, 2) : '—', R.knowledge.spacecraft_m ? 'km' : '', R.knowledge.spacecraft_m ? 'derived' : '', R.knowledge.asteroid_m ? 'spacecraft (idea 40); the asteroid\'s own orbit ' + km(R.knowledge.asteroid_m, 2) + ' km (Horizons)' : 'not in this case');
    $('tiles').innerHTML = t;
    var own = R.refusals.filter(function (r) { return !r.from; });
    $('refusals').innerHTML = own.map(refusalHtml).join('');
    var carried = state.caseKey === 'chain' && state.h41 ? (state.h41.refusals || []) : [];
    $('carried').style.display = carried.length ? '' : 'none';
    $('carriedSum').textContent = carried.length + ' refusals carried from ideas 40 and 41';
    $('carriedList').innerHTML = carried.map(function (r) { var q = JSON.parse(JSON.stringify(r)); if (!q.from) q.from = '41-signal'; return refusalHtml(q); }).join('');
    burnTable(); ledger(); scanBox();
    drawAll();
  }
  function burnTable() {
    var R = state.R, rows = R.burns.map(function (b, i) {
      return '<tr data-i="' + i + '"' + (state.sel === i ? ' class="hl"' : '') + ' tabindex="0"><td data-k="Burn">' + esc(b.name) + '</td><td data-k="When">' + dt(b.t) + '</td><td class="n" data-k="Distance">' + km(b.range_m, 4) + ' km</td><td class="n" data-k="Sun lat / lon">' + ang(b.lat_deg) + '° / ' + ang(b.lon_deg) + '°</td><td class="n" data-k="Speed">' + f(b.speed_before_m_s, 4) + ' → ' + f(b.speed_after_m_s, 3) + ' m/s</td><td class="n" data-k="Δv">' + f(b.dv_m_s, 5) + ' m/s</td><td data-k="Engine">' + (b.engine === 'main' ? 'main, ' : 'small, ') + f(b.thrust_N, 3) + ' N</td><td class="n" data-k="Propellant">' + f(b.propellant_kg, 4) + ' kg</td><td class="n" data-k="Burn time">' + (b.duration_s > 120 ? f(b.duration_s / 60, 3) + ' min' : f(b.duration_s, 3) + ' s') + '</td></tr>';
    });
    var tb = $('burnTable').tBodies[0]; tb.innerHTML = rows.join('');
    Array.prototype.forEach.call(tb.rows, function (tr) {
      var pick = function () { var i = +tr.getAttribute('data-i'); state.sel = state.sel === i ? null : i; burnTable(); drawAll(); };
      tr.addEventListener('click', pick); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }
  function ledger() {
    $('ledgerTable').tBodies[0].innerHTML = state.R.mass.ledger.map(function (l) { return '<tr><td data-k="Step">' + esc(l.item) + '</td><td class="n" data-k="Δv">' + (l.dv_m_s ? f(l.dv_m_s, 5) + ' m/s' : '') + '</td><td class="n" data-k="Mass after">' + f(l.mass_kg, 5) + ' kg</td></tr>'; }).join('');
  }
  function scanBox() {
    var sc = state.R.scan;
    if (!sc) { $('scanBox').innerHTML = '<p class="small">Tick "Scan orbits" to fly circular orbits at fourteen radii for 30 days each.</p>'; return; }
    $('scanBox').innerHTML = '<h3>Circular orbits flown 30 days (terminator plane / noon-midnight plane)</h3><div class="scan">' + sc.map(function (r) {
      var c = function (q) { return q.fate === 'survived' ? 'lasts' : q.fate + ' ' + f(q.days, 2) + ' d'; };
      return '<div class="' + (r.terminator.fate === 'survived' ? 'ok' : 'gone') + '"><b>' + km(r.r_m, 3) + ' km</b><br>' + c(r.terminator) + ' / ' + c(r.noon_midnight) + '</div>';
    }).join('') + '</div>';
  }

  // ------------------------------------------------------------------------------------------------ charts
  function blank(cv) { var c = setup(cv); c.ctx.clearRect(0, 0, c.w, c.h); }
  function setup(cv) {
    var w = cv.clientWidth || 320, h = Math.max(200, Math.min(300, Math.round(w * 0.55))), r = window.devicePixelRatio || 1;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r); cv.style.height = h + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  /** A small plotter: log or linear axes, lines, points, vertical marks. o: {x:[a,b], y:[a,b], xlog, ylog, xrev, xlab, ylab} */
  function frame(cv, o) {
    var c = setup(cv), ctx = c.ctx, pl = 54, pr = 10, pt = 10, pb = 38, W = c.w - pl - pr, H = c.h - pt - pb;
    var tx = function (v) { var u = o.xlog ? (Math.log10(v) - Math.log10(o.x[0])) / (Math.log10(o.x[1]) - Math.log10(o.x[0])) : (v - o.x[0]) / (o.x[1] - o.x[0]); return pl + (o.xrev ? 1 - u : u) * W; };
    var ty = function (v) { var u = o.ylog ? (Math.log10(v) - Math.log10(o.y[0])) / (Math.log10(o.y[1]) - Math.log10(o.y[0])) : (v - o.y[0]) / (o.y[1] - o.y[0]); return pt + (1 - u) * H; };
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--ink-2'); ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    function ticks(lo, hi, log) { var out = []; if (log) { for (var e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) { var v = Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } } else { var step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); var n = (hi - lo) / step; if (n > 10) step *= 2; if (n > 20) step *= 2.5; for (var x = Math.ceil(lo / step) * step; x <= hi; x += step) out.push(+x.toPrecision(10)); } return out; }
    function lab(v, log) { if (log) { var e = Math.round(Math.log10(v)); return e >= -2 && e <= 4 ? String(+v.toPrecision(3)) : '1e' + e; } return String(+v.toPrecision(4)); }
    var xt = ticks(o.x[0], o.x[1], o.xlog), yt = ticks(o.y[0], o.y[1], o.ylog);
    if (xt.length > 7) xt = xt.filter(function (_, i) { return i % 2 === 0; });
    if (yt.length > 7) yt = yt.filter(function (_, i) { return i % 2 === 0; });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.forEach(function (v) { var x = tx(v); ctx.beginPath(); ctx.moveTo(x, pt); ctx.lineTo(x, pt + H); ctx.stroke(); ctx.fillText(lab(v, o.xlog), x, pt + H + 4); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(function (v) { var y = ty(v); ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + W, y); ctx.stroke(); ctx.fillText(lab(v, o.ylog), pl - 4, y); });
    ctx.strokeStyle = css('--axis'); ctx.strokeRect(pl, pt, W, H);
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xlab, pl + W / 2, c.h - 2);
    ctx.save(); ctx.translate(12, pt + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(o.ylab, 0, 0); ctx.restore();
    var clipIn = function () { ctx.save(); ctx.beginPath(); ctx.rect(pl, pt, W, H); ctx.clip(); };
    return {
      ctx: ctx, tx: tx, ty: ty, pl: pl, pt: pt, W: W, H: H,
      line: function (pts, color, opt) { opt = opt || {}; clipIn(); ctx.strokeStyle = color; ctx.lineWidth = opt.w || 2; ctx.setLineDash(opt.dash || []); ctx.beginPath(); var on = false;
        pts.forEach(function (p) { var ok = isFinite(p[0]) && isFinite(p[1]) && (!o.xlog || p[0] > 0) && (!o.ylog || p[1] > 0); if (!ok) { on = false; return; } var X = tx(p[0]), Y = ty(p[1]); if (on) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); on = true; }); ctx.stroke(); ctx.setLineDash([]); ctx.restore(); },
      dot: function (x, y, color, r) { if (!(isFinite(x) && isFinite(y)) || (o.xlog && x <= 0) || (o.ylog && y <= 0)) return; clipIn(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(tx(x), ty(y), r || 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); },
      vmark: function (x, color, text, dash, row) { if (!isFinite(x) || (o.xlog && x <= 0)) return; var X = tx(x); if (X < pl - 1 || X > pl + W + 1) return; ctx.strokeStyle = color; ctx.setLineDash(dash || [4, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.textAlign = X > pl + W - 60 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, X + (X > pl + W - 60 ? -3 : 3), pt + 2 + 14 * (row || 0)); } },
      hline: function (y, color, dash) { if (!isFinite(y) || (o.ylog && y <= 0)) return; var Y = ty(y); ctx.strokeStyle = color; ctx.setLineDash(dash || [4, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pl, Y); ctx.lineTo(pl + W, Y); ctx.stroke(); ctx.setLineDash([]); }
    };
  }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key' + (it.dash ? ' dash' : '') + (it.dot ? ' dot' : '') + '" style="' + (it.dot ? 'background:' : 'border-color:') + it.c + '"></span>' + esc(it.t) + '</li>'; }).join(''); }
  function planPoints() {
    var R = state.R, pts = [];
    R.ap.incoming.forEach(function (p) { pts.push({ t: p.t, r: Math.hypot(p.y[0], p.y[1], p.y[2]), v: Math.hypot(p.y[3], p.y[4], p.y[5]), y: p.y }); });
    R.ap.legs.forEach(function (L) { L.out.forEach(function (p) { pts.push({ t: p.t, r: Math.hypot(p.y[0], p.y[1], p.y[2]), v: Math.hypot(p.y[3], p.y[4], p.y[5]), y: p.y }); }); });
    return pts;
  }
  function relRows(rows) { return rows.map(function (q) { return [Math.hypot(q[0], q[1], q[2]) / 1000, Math.hypot(q[3], q[4], q[5])]; }); }
  function drawAll() {
    var R = state.R; if (!R || R.refusal) return;
    var s1 = css('--s1'), s2 = css('--s2'), s3 = css('--s3'), ink = css('--ink-2'), warn = css('--warn'), crit = css('--crit');
    var pts = planPoints(), B = R.burns, sel = state.sel;
    // 1. speed against distance
    var orex = relRows(K.horizons.orex.daily.rel), apex = relRows(K.horizons.apex.rel);
    var rmax = Math.max(pts[0].r / 1000, 4e6), rmin = Math.max(0.1, Math.min(state.S.standoff_m / 1000, 1) * 0.5);
    var g = frame($('rvChart'), { x: [rmin, rmax], y: [1e-3, 2e4], xlog: true, ylog: true, xrev: true, xlab: 'distance from the asteroid, km (closing to the right)', ylab: 'speed, m/s' });
    var guides = [[1, '1 day'], [7, '1 week'], [30, '1 month']];
    guides.forEach(function (q) { var T = q[0] * DAY; g.line([[rmin, rmin * 1000 / T], [rmax, rmax * 1000 / T]], css('--axis'), { w: 1, dash: [2, 3] }); });
    // each guide labelled where it crosses 30 m/s, on a chip so the data underneath stays readable
    var placed = [];
    guides.forEach(function (q) { var T = q[0] * DAY, c = g.ctx, txt = q[1]; c.font = '11px system-ui, sans-serif'; var w = c.measureText(txt).width, v = 30, X, Y, ok = false;
      for (var k = 0; k < 8 && !ok; k++, v /= 2.5) { var xr = v * T / 1000; X = g.tx(xr); Y = g.ty(v);
        ok = xr >= rmin && xr <= rmax && X - w / 2 >= g.pl && X + w / 2 <= g.pl + g.W && Y - 7 >= g.pt && Y + 7 <= g.pt + g.H && placed.every(function (b) { return X + w / 2 + 3 < b[0] || X - w / 2 - 3 > b[1] || Y + 8 < b[2] || Y - 8 > b[3]; }); }
      if (!ok) return; placed.push([X - w / 2, X + w / 2, Y - 7, Y + 7]);
      c.fillStyle = css('--surface'); c.fillRect(X - w / 2 - 2, Y - 7, w + 4, 14); c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, X, Y); });
    g.line(apex, s3, { dash: [6, 4], w: 1.5 });
    g.line(orex, s2, { w: 1.5 });
    g.line(pts.map(function (p) { return [p.r / 1000, p.v]; }), s1, { w: 2.5 });
    B.forEach(function (b, i) { g.line([[b.range_m / 1000, b.speed_before_m_s], [b.range_m / 1000, Math.max(b.speed_after_m_s, 1e-3)]], s1, { w: 1 }); g.dot(b.range_m / 1000, Math.max(b.speed_after_m_s, 1e-3), i === sel ? crit : s1, i === sel ? 5.5 : 3.5); });
    legend('rvLegend', [{ c: s1, t: 'this plan (' + (state.caseKey === 'chain' ? 'Apophis, the chain' : 'Bennu, from the flown 1 Aug state') + ')' }, { c: s2, t: 'OSIRIS-REx to Bennu as flown (Horizons, Aug-Dec 2018)' }, { c: s3, dash: true, t: 'JPL\'s OSIRIS-APEX plan at Apophis (Horizons predict, Apr-Jul 2029)' }, { c: css('--axis'), dash: true, t: 'distance ÷ speed = 1 day, 1 week, 1 month to go' }]);
    $('rvCap').textContent = 'Each vertical drop is a burn. OSIRIS-REx came in at 491 m/s and braked at 175,000 and 6,500 km; the chain arrives at ' + f(B[0].speed_before_m_s, 4) + ' m/s, so its first burn carries ' + f(100 * B[0].dv_m_s / R.mass.burns_dv_m_s, 3) + '% of the approach. JPL\'s APEX plan joins Apophis at under 50 m/s after Apophis\'s April 2029 pass of the Earth, which this page does not model.';
    // 2. distance against time
    var t1 = R.ap.t1, tEnd = R.ap.standoff.t, det = R.detection;
    var xs = pts.map(function (p) { return (p.t - t1) / DAY; });
    var g2 = frame($('rtChart'), { x: [Math.min(xs[0], det && det.first ? (det.first.t - t1) / DAY - 2 : 0), (tEnd - t1) / DAY + 2], y: [rmin, rmax], xlog: false, ylog: true, xlab: 'days from the first braking burn (' + day(t1) + ')', ylab: 'distance, km' });
    g2.line(pts.map(function (p) { return [(p.t - t1) / DAY, p.r / 1000]; }), s1, { w: 2.5 });
    if (state.caseKey === 'orex2018') { var D = K.horizons.orex.daily, tj = K.tdbOfJd(D.jd0); g2.line(D.rel.map(function (q, i) { return [(tj + i * DAY - t1) / DAY, Math.hypot(q[0], q[1], q[2]) / 1000]; }), s2, { w: 1.5, dash: [5, 3] }); }
    B.forEach(function (b, i) { g2.dot((b.t - t1) / DAY, b.range_m / 1000, i === sel ? crit : s1, i === sel ? 5.5 : 3.5); });
    if (det && det.first) g2.vmark((det.first.t - t1) / DAY, warn, 'first sight', [2, 2]);
    g2.vmark(-state.S.groundLoopDays, ink, 'design lead', [5, 4], 1);
    legend('rtLegend', [{ c: s1, t: 'this plan' }].concat(state.caseKey === 'orex2018' ? [{ c: s2, dash: true, t: 'OSIRIS-REx as flown (Horizons)' }] : []).concat([{ c: warn, dash: true, t: 'the asteroid first bright enough to see' }]));
    $('rtCap').textContent = (det && det.first ? 'The camera sees it ' + (det.leadIsLowerBound ? 'at least ' : '') + f(Math.abs(det.leadToFirstBurn_s) / DAY, 3) + ' days ' + (det.leadToFirstBurn_s >= 0 ? 'before' : 'after') + ' the first burn, ' + (det.leadToFirstBurn_s >= state.S.groundLoopDays * DAY ? 'more' : 'less') + ' than the ' + state.S.groundLoopDays + '-day design lead. ' : '') + (sel !== null ? B[sel].name + ': ' + dt(B[sel].t) + ', ' + km(B[sel].range_m, 4) + ' km.' : '');
    // 3. forces against distance
    var ctx = R.ap.ctx, so = R.ap.standoff, ts = so.t, u = so.r.map(function (x) { return x / Math.hypot(so.r[0], so.r[1], so.r[2]); });
    var dmin = R.body.radius_m * 0.8, dmax = Math.max(R.regimes.hill_radius_m * 4, state.S.standoff_m * 3), n = 80, grav = [], tide = [], sun = [];
    for (var i = 0; i <= n; i++) { var d = dmin * Math.pow(dmax / dmin, i / n), P = K.accel(ts, u.map(function (x) { return x * d; }), Object.assign({}, ctx, { parts: true, shadow: false })); grav.push([d / 1000, Math.hypot.apply(null, P.gravity)]); tide.push([d / 1000, Math.hypot.apply(null, P.tide)]); sun.push([d / 1000, Math.hypot.apply(null, P.srp)]); }
    var all = grav.concat(tide, sun).map(function (p) { return p[1]; }).filter(function (x) { return x > 0; });
    var g3 = frame($('fChart'), { x: [dmin / 1000, dmax / 1000], y: [Math.pow(10, Math.floor(Math.log10(Math.min.apply(null, all)))), Math.pow(10, Math.ceil(Math.log10(Math.max.apply(null, all))))], xlog: true, ylog: true, xlab: 'distance from its centre, km (toward the stand-off)', ylab: 'acceleration, m/s²' });
    g3.line(grav, s1); g3.line(sun, warn); g3.line(tide, s3, { dash: [6, 4] });
    g3.vmark(R.body.radius_m / 1000, ink, 'surface'); g3.vmark(R.regimes.hill_radius_m / 1000, ink, 'Hill', null, 1); g3.vmark(state.S.standoff_m / 1000, crit, 'stand-off', [2, 2]);
    if (state.S.am_m2_kg > 0) g3.vmark(R.regimes.gravity_equals_srp_m / 1000, warn, '', [1, 3]);
    legend('fLegend', [{ c: s1, t: 'the asteroid\'s gravity (GM ' + f(R.body.GM_m3_s2, 3) + ' m³/s²)' }, { c: warn, t: 'sunlight (' + f(state.S.am_m2_kg, 3) + ' m²/kg)' }, { c: s3, dash: true, t: 'the Sun\'s tide' }]);
    $('fCap').textContent = 'Gravity falls as 1/r², sunlight does not fall at all over these distances, and the tide grows with r. Beyond ' + km(R.regimes.gravity_equals_srp_m, 3) + ' km sunlight beats gravity; the Hill radius (' + km(R.regimes.hill_radius_m, 3) + ' km) is where the tide does on the Sun line (along this direction the tide is weaker). AAS 24-063\'s dark-side equilibrium (no shadow in its model) sits at ' + km(R.regimes.dark_equilibrium_m, 3) + ' km on the anti-Sun axis, which is inside the asteroid\'s shadow, where sunlight is cut off.';
    // 4. the corridor (log-polar, the Sun up)
    var cg = setup($('geoChart')), c4 = cg.ctx, cx = cg.w / 2, cy = cg.h / 2 + 6, Rpx = Math.min(cg.w, cg.h) / 2 - 18, lo = Math.log10(Math.max(0.05, rmin / 2)), hi = Math.log10(rmax);
    var rad = function (rkm) { return Rpx * Math.max(0, (Math.log10(Math.max(rkm, Math.pow(10, lo))) - lo) / (hi - lo)); };
    c4.font = '11px system-ui, sans-serif'; c4.strokeStyle = css('--grid'); c4.fillStyle = ink; c4.textAlign = 'left'; c4.textBaseline = 'middle';
    for (var e = Math.ceil(lo); e <= Math.floor(hi); e++) { var rr = rad(Math.pow(10, e)); c4.beginPath(); c4.arc(cx, cy, rr, 0, 2 * Math.PI); c4.stroke(); if (e % 2 === 0 || hi - lo < 6) c4.fillText((e >= 0 && e <= 3 ? String(Math.pow(10, e)) : '1e' + e) + ' km', cx + rr * 0.71 + 2, cy + rr * 0.71); }
    c4.fillStyle = warn; c4.textAlign = 'center'; c4.textBaseline = 'top'; c4.fillText('☉ Sun', cx, 2);
    var xy = function (p) { var A = R.ap.astAt(p.t), s = K.toSam(p.y.slice(0, 3), A), r = Math.hypot(s[0], s[1], s[2]) / 1000, lon = Math.atan2(s[1], s[0]), q = rad(r); return [cx + q * Math.sin(lon), cy - q * Math.cos(lon)]; };
    c4.strokeStyle = s1; c4.lineWidth = 2; c4.beginPath(); pts.forEach(function (p, k) { var q = xy(p); if (k) c4.lineTo(q[0], q[1]); else c4.moveTo(q[0], q[1]); }); c4.stroke();
    B.forEach(function (b, i) { var q = xy({ t: b.t, y: R.ap.burns[i].r }); c4.fillStyle = i === sel ? crit : s1; c4.beginPath(); c4.arc(q[0], q[1], i === sel ? 5.5 : 3.5, 0, 2 * Math.PI); c4.fill(); });
    c4.fillStyle = css('--ink'); c4.beginPath(); c4.arc(cx, cy, 3, 0, 2 * Math.PI); c4.fill();
    $('geoCap').textContent = 'Seen from the asteroid\'s orbit pole: direction in the SAM frame (the Sun up, longitude counter-clockwise from it), distance on a log scale. ' + (state.S.template === 'orex' ? 'The waypoints swing the spacecraft to zero phase (AAM-3) for OSIRIS-REx\'s science, then to the terminator.' : '');
    // 5. holding station
    var db = R.deadband;
    if (db) {
      var g5 = frame($('dbChart'), { x: [0, db.days], y: [0, Math.max(state.S.box_m * 0.75, db.max_offset_m * 1.1)], xlog: false, ylog: false, xlab: 'days at the stand-off', ylab: 'off the hold point, m' });
      g5.hline(state.S.box_m / 2, crit); g5.line(db.track, s1, { w: 1.5 });
      $('dbCap').textContent = 'A ' + f(state.S.box_m, 4) + ' m deadband flown ' + db.days + ' days: ' + db.burns + ' burns, ' + f(db.dv_m_s * 1000, 3) + ' mm/s, against ' + f(db.predicted_per_day_m_s * db.days * 1000, 3) + ' mm/s from the control acceleration (' + f(100 * (db.dv_per_day_m_s / db.predicted_per_day_m_s - 1), 2) + '%). The wall (red) is half the box; the spacecraft drifts out under sunlight and is turned back.';
    } else { blank($('dbChart')); $('dbCap').textContent = ''; }
  }

  // ------------------------------------------------------------------------------------------------ oracles (once)
  function oracles() {
    var rows = [], T3 = {}; K.sources.aas19035.table3.forEach(function (r) { T3[r[0]] = r; });
    var hg = K.hgCheck();
    hg.forEach(function (q) { rows.push(['Apparent magnitude, ' + q.label + ' (' + q.rows + ' epochs, phase ' + f(q.phase_deg[0], 2) + '-' + f(q.phase_deg[1], 3) + '°)', 'Horizons APmag', 'IAU H-G law', 'worst ' + f(q.worst_mag, 2) + ' mag', q.worst_mag < 0.001]); });
    ['AAM-1', 'AAM-2', 'AAM-3', 'AAM-3a', 'AAM-4', 'M0P'].forEach(function (ev) { var m = K.measuredDv(ev, 3, AM_APEX); rows.push([ev + ' measured from the flown trajectory (Horizons, 3 h either side)', f(T3[ev][3], 6) + ' m/s (Table 3, estimated)', f(m.dv_m_s, 6) + ' m/s', f(m.dv_m_s - T3[ev][3], 2) + ' m/s', Math.abs(m.dv_m_s - T3[ev][3]) < 0.002]); });
    [['AAM-1', 'AAM-2'], ['AAM-2', 'AAM-3'], ['AAM-3', 'AAM-3a'], ['AAM-3a', 'AAM-4'], ['AAM-4', 'M0P'], ['M0P', 'Arrival']].forEach(function (q) { var p = K.plannedDv(q[0], q[1], AM_APEX); var g = p.dv_m_s - T3[q[0]][2]; rows.push([q[0] + ' planned here from the flown state, aimed at ' + q[1] + '\'s Table 1 point', f(T3[q[0]][2], 6) + ' m/s (Table 3, designed)', f(p.dv_m_s, 6) + ' m/s', f(g, 2) + ' m/s (' + f(100 * g / T3[q[0]][2], 2) + '%)', Math.abs(g / T3[q[0]][2]) < 0.1]); });
    var Rb = K.run(K.orexCase(), K.defaults()), b = Rb.burns[0];
    rows.push(['Flown 61 days from 1 Aug 2018: where AAM-1 happens', '175,000 km, 20.5°, 55.3°, 491.3 m/s (Table 1)', km(b.range_m, 6) + ' km, ' + f(b.lat_deg, 3) + '°, ' + f(b.lon_deg, 3) + '°, ' + f(b.speed_before_m_s, 5) + ' m/s', f(b.range_m / 1000 - T1[0][2], 3) + ' km in range; ' + f(b.lat_deg - T1[0][3], 2) + '° and ' + f(b.lon_deg - T1[0][4], 2) + '° in angle (Table 1 rounds to 0.1°)', Math.abs(b.range_m / 1000 - T1[0][2]) < 175 && Math.abs(b.lat_deg - T1[0][3]) < 0.1 && Math.abs(b.lon_deg - T1[0][4]) < 0.1]);
    var b61 = K.ballistic(0, 61, AM_APEX, K.bodies['101955'].GM_m3_s2), b17 = K.ballistic(104, 121, AM_APEX, K.bodies['101955'].GM_m3_s2);
    rows.push(['Ballistic, 1 Aug to 1 Oct 2018 (3.07 million km to 175,000 km)', 'Horizons\' reconstruction', 'this model', km(b61.final_m, 3) + ' km apart', false, 'no planets\' tides, sunlight as a flat absorber']);
    rows.push(['Ballistic, 13 to 30 Nov 2018 (150 km to 38 km)', 'Horizons; the navigation team predicted two weeks to within 500 m (AAS 19-035 p. 15)', 'this model', km(b17.final_m, 3) + ' km apart', false, 'their ten-plate sunlight and thermal model, and the momentum dumps, against a flat absorber here']);
    var oa = K.fitOrbitA(240); AM_FIT = oa.failed ? null : +oa.am_m2_kg.toPrecision(4);
    if (!oa.failed) rows.push(['Bennu\'s GM fitted to OSIRIS-REx\'s first orbit (Orbital A, 10 days of Horizons states)', '4.8904 m³/s² (SBDB, Chesley et al. 2020)', f(oa.GM_m3_s2, 5) + ' m³/s², ' + f(oa.rms_m, 3) + ' m rms', f(100 * (oa.GM_m3_s2 / 4.8904 - 1), 2) + '%', Math.abs(oa.GM_m3_s2 / 4.8904 - 1) < 0.01]);
    var v = K.orexFirstImageV(); rows.push(['Bennu at OSIRIS-REx\'s first PolyCam image, 17 Aug 2018', 'V ' + v.horizonsV + ' (Horizons)', 'V ' + f(v.V, 5), f(v.V - v.horizonsV, 2) + ' mag', Math.abs(v.V - v.horizonsV) < 0.001]);
    $('checkTable').tBodies[0].innerHTML = rows.map(function (r) { return '<tr><td data-k="Check">' + esc(r[0]) + (r[5] ? '<span class="why">' + esc(r[5]) + '</span>' : '') + '</td><td data-k="Independent">' + esc(r[1]) + '</td><td data-k="This page">' + esc(r[2]) + '</td><td data-k="Gap" class="' + (r[4] ? 'gap-ok' : '') + '">' + esc(r[3]) + '</td></tr>'; }).join('');
  }

  // ------------------------------------------------------------------------------------------------ handoff
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function status(msg, ok) { var el = $('hoStatus'); el.textContent = msg; el.className = 'status ' + (ok ? 'ok' : 'bad'); }
  function exportText() { var R = state.R; if (!R || R.refusal) { status('Nothing to export: these inputs are refused.', false); return null; } return JSON.stringify(K.buildHandoff(R, new Date().toISOString())); }
  function importText(text) {
    var h; try { h = JSON.parse(text); } catch (e) { status('That is not JSON.', false); return false; }
    if (h && h.from === '41-signal') { var s = K.importSignal(h); if (s.refusal) { status(s.refusal.reason + ' ' + s.refusal.what_would_help, false); return false; } state.h41 = h; state.caseKey = 'chain'; state.sel = null; syncControls(); run(); status('Imported idea 41\'s handoff: ' + s.target.name + ', arrival ' + dt(s.arrival.t) + ' UTC.', true); return true; }
    var p = K.parseHandoff(h);
    if (p.refusal) { status(p.refusal.reason + ' ' + p.refusal.what_would_help, false); return false; }
    if (p.from === '42-closing-in') { state.h41 = p.h42.inputs.signal_handoff || state.h41; state.caseKey = p.h42.inputs.case === 'orex2018' ? 'orex2018' : 'chain'; state.S = JSON.parse(JSON.stringify(p.settings)); state.sel = null; syncControls(); run(); status('Imported this page\'s handoff, recomputed and matched.', true); return true; }
    status('Not imported.', false); return false;
  }
  function copy(text, msg) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { status(msg, true); }, function () { $('importText').value = text; status('Copy blocked by the browser: the text is in the box above.', false); }); else { $('importText').value = text; status('The text is in the box above.', true); } }
  $('importBtn').addEventListener('click', function () { importText($('importText').value); });
  $('importFile').addEventListener('change', function (e) { var fl = e.target.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { importText(String(rd.result)); }; rd.readAsText(fl); });
  $('copyBtn').addEventListener('click', function () { var h = exportText(); if (h) copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
  $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'closing-in-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded closing-in-handoff.json.', true); });
  $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + b64u(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });

  // ------------------------------------------------------------------------------------------------ start
  syncControls();
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/), done = false;
  if (hash) { try { done = importText(unb64u(hash[1])); } catch (e) { status('The link\'s handoff could not be read.', false); } }
  if (!done) run();
  setTimeout(oracles, 30);
  var rs = null; window.addEventListener('resize', function () { clearTimeout(rs); rs = setTimeout(drawAll, 120); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll);
  window.ClosingInPage = { K: K, state: state, run: run, importText: importText, exportText: exportText };
})();
