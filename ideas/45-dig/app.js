/* Dig (idea 45): the page. Wires the kernel (dig.js, on idea 43's spin kernel) to the controls, charts and handoff. */
(function () {
  'use strict';
  var lumpyDeps = { shapes: {}, attitude: LumpyAttitude, geophysics: {}, orbitB: {}, coast: LumpyIntegrator, sources: ClosingSources, constants: LambertAster };
  var K43 = Lumpy.create(lumpyDeps);
  var K = Dig.create({ lumpy: K43, sources: DigSources, ephem: DigSunEphem, nav: CoastNav, constants: LambertAster, approach: ClosingSources });
  var SRC = DigSources;
  var $ = function (id) { return document.getElementById(id); };
  var state = { caseKey: 'chain', h44: { chain: window.DigTouchSample, bennu: window.DigTouchBennu }, srcs: {}, S: null, R: null, timer: null, running: false, seq: 0 };

  function f(x, d) { if (x === null || x === undefined || !isFinite(x)) return '–'; var a = Math.abs(x); if (a !== 0 && (a < 1e-3 || a >= 1e7)) return x.toExponential(Math.max(1, (d || 3) - 1)); return String(+x.toPrecision(d || 3)); }
  function fx(x, n) { return x === null || x === undefined || !isFinite(x) ? '–' : x.toFixed(n); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }
  function utc(iso) { return iso.slice(0, 10) + ' ' + iso.slice(11, 16); }
  function kg(x) { return x >= 1 ? f(x, 3) + ' kg' : f(x * 1000, 3) + ' g'; }

  // ------------------------------------------------------------------------------------------------ cases and controls
  function src() {
    if (state.srcs[state.caseKey]) return state.srcs[state.caseKey];
    var p = K.parseHandoff(state.h44[state.caseKey]);
    var s = p.refusal ? p : p.src;
    if (!s.refusal) state.srcs[state.caseKey] = s;
    return s;
  }
  $('runSel').innerHTML = SRC.murchison.runs.map(function (r) { return '<option value="' + r.id + '">' + r.id + ': ' + r.peak_C + ' °C, ' + r.rate_C_min + ' °C/min, ' + (r.gas === 'vacuum' ? 'vacuum' : 'argon') + ' (' + r.h2o_wt.toFixed(2) + ' wt% water)</option>'; }).join('');
  // [number input, range, setting, display factor]
  var NUM = [['pkIn', null, 'peakS_C', 1], ['rtIn', null, 'rateS_C_min', 1], ['t0In', null, 'T0_K', 1], ['recIn', null, 'recovery', 100], ['apIn', 'apRange', 'aperture_m2', 1], ['cIn', 'cRange', 'conc', 1],
    ['etaIn', null, 'eta_opt', 1], ['epsIn', null, 'eps', 1], ['horIn', null, 'horizon_deg', 1], ['stayIn', null, 'stay_days', 1], ['ovIn', 'ovRange', 'oven_kg', 1], ['pairsIn', null, 'pairs', 1],
    ['depIn', 'depRange', 'depth_m', 1000], ['cutIn', null, 'cut_m_s', 1000], ['imbIn', null, 'imbalance', 1], ['rhoIn', null, 'rho_kg_m3', 1], ['massIn', null, 'mass_kg', 1]];
  function syncControls() {
    var S = state.S;
    NUM.forEach(function (q) { var v = +(S[q[2]] * q[3]).toPrecision(6); $(q[0]).value = v; if (q[1]) $(q[1]).value = v; });
    $('anaSel').value = S.analog; $('runSel').value = S.run; $('drumSel').value = S.drum;
    var R = state.R, analog = S.analog === 'auto' ? (R && !R.refusal ? R.feed.analog : K.analogOfClass((K.classOf(state.caseKey === 'bennu' ? '101955' : '99942') || {}).value)) : S.analog;
    $('runRow').classList.toggle('hide', analog !== 'cm'); $('sRow').classList.toggle('hide', analog !== 'ordinary');
    document.querySelectorAll('[data-case]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.case === state.caseKey)); });
    document.querySelectorAll('[data-res]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.res === S.resistance)); });
    document.querySelectorAll('[data-hold]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.hold === S.hold)); });
  }
  function schedule(delay) { clearTimeout(state.timer); state.timer = setTimeout(run, delay === undefined ? 300 : delay); }
  NUM.forEach(function (q) {
    var a = $(q[0]), b = q[1] ? $(q[1]) : null;
    function set(v) { if (v === '' || !isFinite(+v)) return; state.S[q[2]] = +v / q[3]; }
    a.addEventListener('input', function () { set(a.value); if (b) b.value = a.value; schedule(600); });
    a.addEventListener('change', function () { set(a.value); schedule(40); });
    if (b) b.addEventListener('input', function () { a.value = b.value; set(b.value); schedule(250); });
  });
  $('anaSel').addEventListener('change', function () { state.S.analog = $('anaSel').value; syncControls(); schedule(20); });
  $('runSel').addEventListener('change', function () { state.S.run = $('runSel').value; schedule(20); });
  $('drumSel').addEventListener('change', function () { state.S.drum = $('drumSel').value; schedule(20); });
  document.querySelectorAll('[data-ap]').forEach(function (b) { b.addEventListener('click', function () { state.S.aperture_m2 = b.dataset.ap === 'orex' ? ClosingSources.spacecraft.orex.solarArray_m2 : +b.dataset.ap; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-res]').forEach(function (b) { b.addEventListener('click', function () { state.S.resistance = b.dataset.res; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-hold]').forEach(function (b) { b.addEventListener('click', function () { state.S.hold = b.dataset.hold; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-case]').forEach(function (b) { b.addEventListener('click', function () { if (state.caseKey === b.dataset.case) return; state.caseKey = b.dataset.case; resetS(); syncControls(); schedule(10); }); });
  $('resetBtn').addEventListener('click', function () { resetS(); syncControls(); schedule(10); });
  function resetS() { var s = src(); state.S = s.refusal ? state.S : K.defaults(s); }

  // ------------------------------------------------------------------------------------------------ run
  function busy(on, msg) { $('runNote').textContent = msg || ''; document.querySelectorAll('.col, section.wide').forEach(function (e) { if (e.id !== 'how') e.classList.toggle('busy', on); }); $('bar').style.width = on ? '60%' : '0'; }
  function run() {
    if (state.running) { schedule(150); return; }
    state.running = true;
    busy(true, state.caseKey === 'chain' ? 'Turning Apophis day by day with idea 43\'s spin… (a few seconds when the stay or the horizon changes)' : 'Turning Bennu day by day…');
    setTimeout(function () {
      try {
        var s = src();
        state.R = s.refusal ? { refusal: s.refusal } : K.run(s, state.S);
      } catch (e) { state.R = { refusal: { code: 'invalid_input', reason: 'The computation failed: ' + e.message, what_would_help: 'Other settings.' } }; }
      state.running = false; state.seq++; busy(false, ''); syncControls(); render();
    }, 30);
  }

  // ------------------------------------------------------------------------------------------------ render
  function tile(k, v, u, conf, sub, cls) { return '<div class="tile ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + (conf ? '<span class="c">' + conf + '</span>' : '') + '</div>'; }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code.replace(/_/g, ' ')) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · from ' + esc(r.from) : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  var CHARTS = ['dayChart', 'sunChart', 'yieldChart', 'energyChart', 'recChart', 'pushChart'];
  function render() {
    var R = state.R;
    if (!R || R.refusal) {
      $('tiles').innerHTML = ''; $('resLine').textContent = '';
      $('refusals').innerHTML = refusalHtml(R ? R.refusal : { code: 'invalid_input', reason: 'Nothing computed.', what_would_help: 'Reset.' });
      CHARTS.forEach(function (id) { blank($(id)); });
      ['dayCap', 'sunCap', 'yieldCap', 'energyCap', 'recCap', 'pushCap'].forEach(function (id) { $(id).textContent = ''; });
      $('checkTable').tBodies[0].innerHTML = ''; return;
    }
    var s = R.src, st = s.site, S = R.S, fs = R.feed, en = R.energy, dg = R.dig, W = R.water, tl = R.timeline, ll = K.latLon(st.aim || st.normal);
    $('srcLine').textContent = (s.kind === 'bennu' ? 'From idea 44\'s Bennu case: OSIRIS-REx\'s sampling site Nightingale' : 'From idea 44: the chain\'s spacecraft on ' + st.body) + ', plate ' + st.face + ' (' + fx(ll[0], 1) + '°, ' + fx(ll[1], 1) + '°E), slope ' + fx(st.slope_deg, 1) + '°, contact ' + utc(K.utcOf(st.epoch)) + ' UTC. Spectral class ' + (fs.spec ? fs.spec.value + ' (' + fs.spec.ref + ')' : '–') + '.';
    $('resLine').innerHTML = 'A ' + f(S.aperture_m2, 3) + ' m² mirror at ' + fx(tl[0].r_au, 3) + ' au, ' + tl.length + ' days from ' + tl[0].utc0.slice(0, 10) + '. ' + esc(fs.label) + '.';
    var T = [], upper = fs.bound === 'upper', conf = upper ? 'assumed' : 'derived';
    T.push(tile('Water per day' + (upper ? ' (at most)' : ''), (upper ? '≤ ' : '') + (W.mean >= 1 ? f(W.mean, 3) : f(W.mean * 1000, 3)), W.mean >= 1 ? 'kg' : 'g', conf, 'days range ' + kg(W.min) + ' to ' + kg(W.max) + '; ' + kg(W.total) + ' over the stay', 'hero'));
    T.push(tile('Heat per kg of water', f(en.perKgWater_J / 1e6, 3), 'MJ', 'derived', 'per kg of rock: ' + f(en.perKgRegolith_J / 1e6, 3) + ' MJ (rock ' + f(en.parts_J_per_kg.solids / 1e6, 2) + ', breaking serpentine ' + f(en.parts_J_per_kg.reaction / 1e6, 2) + ', steam ' + f(en.parts_J_per_kg.steam / 1e6, 2) + (S.recovery > 0 ? ', recovered ' + f(en.parts_J_per_kg.recovered / 1e6, 2) : '') + ')'));
    var regDay = tl.reduce(function (a, d) { return a + d.regolith_kg; }, 0) / tl.length;
    T.push(tile('Regolith baked per day', f(regDay, 3), 'kg', 'derived', 'limited by heat ' + W.limits.heat + ', oven ' + W.limits.oven + ', digging ' + W.limits.dig + ' of ' + tl.length + ' days'));
    var lit = tl.reduce(function (a, d) { return a + d.lit_h; }, 0) / (24 * tl.length), rmin = Math.min.apply(null, tl.map(function (d) { return d.r_au; })), rmax = Math.max.apply(null, tl.map(function (d) { return d.r_au; }));
    T.push(tile('Sun above the site', fx(lit * 100, 0), '% of the time', 'derived', fx(rmin, 3) + '–' + fx(rmax, 3) + ' au from the Sun; ' + fx(K.S1AU / rmax / rmax, 0) + '–' + fx(K.S1AU / rmin / rmin, 0) + ' W/m²'));
    T.push(tile('Sunlight kept in the oven', fx(R.receiver.eta_rec_epoch * 100, 0), '%', 'derived', 'of what the mirror delivers at ' + fx(fs.Tpk - 273.15, 0) + ' °C; it needs a concentration of at least ' + f(R.receiver.minConc_epoch, 3), R.receiver.eta_rec_epoch <= 0 ? 'bad' : ''));
    T.push(tile('Digging pushes', f(dg.pushUsed_N * 1000, 3), 'mN', 'assumed', 'against ' + f(dg.weightNormal_N * 1000, 3) + ' mN of weight on the ground; deepest cut that stays: ' + f(dg.depthMax_m * 1000, 3) + ' mm' + (dg.depthCapped ? ' (the cut is held there)' : ''), dg.liftsOff && !dg.thrustOk ? 'warn' : 'ok'));
    T.push(tile('Holding down by thrust', dg.thrustOk ? f(R.holdKgPerDay, 3) : (S.hold === 'thrust' ? 'refused' : 'not used'), dg.thrustOk ? 'kg/day' : '', dg.thrustOk ? 'derived' : '', dg.thrustOk ? f(dg.holdThrust_N * 1000, 3) + ' mN while digging, at idea 44\'s ' + f(st.holdKgPerNHour, 3) + ' kg per N-hour' : (S.hold === 'thrust' ? (st.holdKgPerNHour ? 'no propellant left (idea 44)' : 'no specific impulse handed on') : 'the weight holds it'), S.hold === 'thrust' && !dg.thrustOk ? 'refused' : ''));
    var og = tl.reduce(function (a, d) { return a + d.otherGas_kg; }, 0) / tl.length;
    T.push(tile('Other gases with it', fs.analog === 'cm' ? f(og, 3) : '–', fs.analog === 'cm' ? 'kg/day' : '', fs.analog === 'cm' ? 'measured' : '', fs.analog === 'cm' ? 'CO₂ ' + fx(fs.others.co2 * 100, 2) + ', SO₂ ' + fx(fs.others.so2 * 100, 2) + ', organics ' + fx(fs.others.organics * 100, 2) + ' wt% of the rock (run ' + fs.run.id + ')' : 'none counted for an S-type'));
    T.push(tile('Water in the rock', fs.w >= 0.001 ? fx(fs.w * 100, 2) : fx(fs.w * 1e6, 0), fs.w >= 0.001 ? 'wt%' : 'ppm', fs.analog === 'cm' ? 'measured' : 'assumed', fs.analog === 'cm' ? 'Murchison chips: ' + fx(fs.range750[0] * 100, 1) + '–' + fx(fs.range750[1] * 100, 1) + ' wt% by 750 °C' : 'Itokawa: ' + SRC.itokawa.bulk_ppm.join('–') + ' ppm, all of it counted'));
    $('tiles').innerHTML = T.join('');
    $('refusals').innerHTML = R.own.map(refusalHtml).join('');
    $('carried').style.display = R.carried.length ? '' : 'none';
    $('carriedSum').textContent = R.carried.length + ' refusals carried from earlier modules';
    $('carriedList').innerHTML = R.carried.map(refusalHtml).join('');
    drawDays(); drawSun(); drawYield(); drawEnergy(); drawRec(); drawPush(); checksTable();
  }

  // ------------------------------------------------------------------------------------------------ canvas helpers
  function setup(cv, aspect) {
    var w = cv.clientWidth || 320, h = Math.max(200, Math.min(300, Math.round(w * (aspect || 0.6)))), r = window.devicePixelRatio || 1;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r); cv.style.height = h + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function blank(cv) { var c = setup(cv); c.ctx.clearRect(0, 0, c.w, c.h); }
  function frame(cv, o) {
    var c = setup(cv, o.aspect), ctx = c.ctx, pl = 52, pr = 10, pt = 10, pb = 38, W = c.w - pl - pr, H = c.h - pt - pb;
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
    function clip() { ctx.save(); ctx.beginPath(); ctx.rect(pl, pt, W, H); ctx.clip(); }
    return { ctx: ctx, tx: tx, ty: ty, pl: pl, pt: pt, W: W, H: H,
      line: function (xs, ys, color, dash, width) { clip(); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); var on = false; for (var i = 0; i < xs.length; i++) { var a = xs[i], b = ys[i]; if (!isFinite(a) || !isFinite(b) || (o.ylog && b <= 0) || (o.xlog && a <= 0)) { on = false; continue; } var X = tx(a), Y = ty(b); if (!on) { ctx.moveTo(X, Y); on = true; } else ctx.lineTo(X, Y); } ctx.stroke(); ctx.restore(); },
      dots: function (xs, ys, color, r) { clip(); ctx.fillStyle = color; for (var i = 0; i < xs.length; i++) { if (!isFinite(xs[i]) || !isFinite(ys[i]) || (o.ylog && ys[i] <= 0)) continue; ctx.beginPath(); ctx.arc(tx(xs[i]), ty(ys[i]), r || 3, 0, 2 * Math.PI); ctx.fill(); } ctx.restore(); },
      band: function (y0, y1, color) { clip(); ctx.fillStyle = color; var a = ty(y1), b = ty(y0); ctx.fillRect(pl, a, W, b - a); ctx.restore(); },
      hmark: function (v, color, text, dash) { if (!(o.ylog ? v > 0 : true)) return; var Y = ty(v); if (Y < pt || Y > pt + H) return; ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash || [4, 3]); ctx.beginPath(); ctx.moveTo(pl, Y); ctx.lineTo(pl + W, Y); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(text, pl + 4, Y - 2); } ctx.restore(); },
      vmark: function (v, color, text, row) { if (!(v >= o.x[0] && v <= o.x[1])) return; var X = tx(v); ctx.save(); ctx.strokeStyle = color; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = X > pl + W * 0.6 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, X + (X > pl + W * 0.6 ? -3 : 3), pt + 3 + 13 * (row || 0)); } ctx.restore(); },
      label: function (x, y, s, color, align, k) { if (!isFinite(x) || !isFinite(y)) return; var yy = k && k !== 1 ? (o.ylog ? y * k : y + (k - 1) * (o.y[1] - o.y[0])) : y; ctx.save(); ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = align || 'left'; ctx.textBaseline = k && k < 1 ? 'top' : 'bottom'; ctx.fillText(s, tx(x) + (align === 'right' ? -5 : 5), k && k < 1 ? ty(y) + 4 : ty(y) - 3); ctx.restore(); } };
  }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key ' + (it[2] || '') + '" style="' + (it[2] === 'dot' ? 'background:' : 'border-color:') + it[1] + '"></span>' + esc(it[0]) + '</li>'; }).join(''); }

  // ------------------------------------------------------------------------------------------------ charts
  function drawDays() {
    var R = state.R, tl = R.timeline, w = R.feed.w, days = tl.map(function (d) { return d.day; });
    var made = tl.map(function (d) { return d.water_kg; }), heat = tl.map(function (d) { return d.regolithHeat_kg * w; }), oven = tl.map(function (d) { return d.regolithOven_kg * w; }), dig = tl.map(function (d) { return d.regolithDig_kg * w; });
    var second = tl.map(function (d, i) { return [heat[i], oven[i], dig[i]].sort(function (a, b) { return a - b; })[1]; });
    var ymax = 1.15 * Math.max(Math.max.apply(null, second), Math.max.apply(null, made) * 1.2, 1e-9), sc = ymax >= 1 ? 1 : 1000;
    var F = frame($('dayChart'), { x: [0, Math.max(2, days.length)], y: [0, ymax * sc], xlab: 'day of the stay', ylab: 'water per day (' + (sc === 1 ? 'kg' : 'g') + ')' });
    var m = function (a) { return a.map(function (x) { return x * sc; }); };
    F.line(days, m(heat), css('--s2'), [6, 4], 1.5); F.line(days, m(oven), css('--s3'), [2, 3], 1.5); F.line(days, m(dig), css('--ink-2'), [8, 3, 2, 3], 1.5);
    F.line(days, m(made), css('--s1'), null, 2.5);
    legend('dayLegend', [['water made', css('--s1')], ['what the day\'s heat allows', css('--s2'), 'dash'], ['what the oven can cycle', css('--s3'), 'dash'], ['what the drums can dig', css('--ink-2'), 'dash']]);
    $('dayCap').textContent = 'Each day the least of the three (a capacity far above the others runs off the top). ' + (R.src.kind === 'apophis' ? 'Apophis tumbles: its days at this site run from ' + fx(Math.min.apply(null, tl.map(function (d) { return d.lit_h; })), 1) + ' to ' + fx(Math.max.apply(null, tl.map(function (d) { return d.lit_h; })), 1) + ' hours of sunlight, and the distance from the Sun changes with the season.' : 'Bennu turns every 4.3 h; the sunlight changes with its distance from the Sun (' + fx(tl[0].r_au, 2) + ' to ' + fx(tl[tl.length - 1].r_au, 2) + ' au over the stay) and the season at the site.') + (R.feed.bound === 'upper' ? ' An upper bound: all of Itokawa\'s water counted.' : '');
  }
  function drawSun() {
    var R = state.R, el = R.sun.el3_deg, dt = R.sun.dtSub / 3600, xs = el.map(function (_, i) { return (i + 0.5) * dt; });
    var F = frame($('sunChart'), { x: [0, Math.max(1, xs.length * dt)], y: [-90, 90], xlab: 'hours after contact', ylab: 'Sun above the ground (deg)' });
    F.hmark(R.S.horizon_deg, css('--ink-2'), R.S.horizon_deg ? 'horizon mask' : 'horizon');
    F.line(xs, el, css('--s2'));
    legend('sunLegend', [['the Sun\'s elevation at the site (idea 43\'s spin, Horizons)', css('--s2')]]);
    $('sunCap').textContent = R.src.kind === 'apophis' ? 'Apophis tumbles (periods of about 30 and 264 h, Pravec et al. 2014, via idea 43): no two days at the site are alike.' : 'Bennu at Nightingale (55.9°N): sunrise every 4.3 h; the tests hold this curve to JPL Horizons\' own within 0.03°.';
  }
  function drawYield() {
    var R = state.R, runs = SRC.murchison.runs, P = SRC.bennuOrbit, toW = function (h) { return h / K.H_PER_H2O; };   // wt% of H -> wt% of water
    var F = frame($('yieldChart'), { x: [150, 1050], y: [0.01, 30], ylog: true, xlab: 'oven peak (°C)', ylab: 'water released (wt%)' });
    F.band(toW(P.h_wt_range[0]), toW(P.h_wt_range[1]), css('--refused'));
    F.hmark(SRC.winchcombe.water_wt, css('--s3'), 'Winchcombe (CM), all water above 200 °C');
    F.band(SRC.itokawa.bulk_ppm[0] / 1e4, SRC.itokawa.bulk_ppm[1] / 1e4, css('--refused'));
    runs.forEach(function (r) { var col = r.gas === 'vacuum' ? css('--s1') : css('--s2'), sel = r.id === R.S.run && R.feed.analog === 'cm'; F.dots([r.peak_C], [r.h2o_wt], col, sel ? 6 : 3.5); if (sel || r.peak_C < 600) F.label(r.peak_C, r.h2o_wt, r.id + ': ' + r.rate_C_min + ' °C/min, ' + (r.gas === 'vacuum' ? 'vacuum' : 'argon'), col, r.peak_C > 600 ? 'right' : 'left', sel && r.peak_C > 600 ? 0.55 : 1); });
    F.label(1040, toW(P.h_wt_range[0]), 'Bennu from orbit', css('--ink-2'), 'right', 0.62);
    F.label(170, SRC.itokawa.bulk_ppm[1] / 1e4, 'Itokawa, all of its water', css('--ink-2'));
    if (R.feed.analog === 'ordinary') F.dots([R.feed.Tpk - 273.15], [R.feed.w * 100], css('--ink'), 5);
    legend('yieldLegend', [['Murchison in vacuum', css('--s1'), 'dot'], ['Murchison in argon', css('--s2'), 'dot'], ['Bennu from orbit / Itokawa (bands)', css('--refused'), 'band']]);
    $('yieldCap').textContent = 'Murchison chips (Suttle et al. 2024): water given off above 200 °C on the first heating. By 750 °C: ' + runs.filter(function (r) { return r.peak_C === 750; }).map(function (r) { return r.id + ' ' + r.h2o_wt.toFixed(1) + '% (' + r.rate_C_min + ' °C/min, ' + (r.gas === 'vacuum' ? 'vacuum' : 'argon') + ')'; }).join(', ') + '. Slower heating and vacuum drive off more; chips differ. Bennu from orbit: its 2.7 µm band read as hydrogen (Praet et al. 2021), shown as water. The big dot is the case shown.';
  }
  function drawEnergy() {
    var R = state.R, S = R.S, Tpk = R.feed.Tpk, ws = [], es = [];
    for (var i = 0; i <= 60; i++) { var w = Math.pow(10, -4.3 + i * (Math.log10(0.125) + 4.3) / 60), e = K.energy(w, S.T0_K, Tpk, S.recovery); ws.push(w * 100); es.push(e.perKgWater_J / 1e6); }
    var F = frame($('energyChart'), { x: [0.005, 13], y: [1, 1e4], xlog: true, ylog: true, xlab: 'water in the rock (wt%)', ylab: 'heat per kg of water (MJ)' });
    F.line(ws, es, css('--s1'));
    var free = (SRC.thermo.species.steam.dHf_kJ_mol - SRC.thermo.liquidWater.dHf_kJ_mol) / SRC.thermo.species.steam.M_g_mol;
    F.hmark(free, css('--ink-2'), 'evaporating free water (' + fx(free, 2) + ' MJ/kg)');
    var mk = [[SRC.itokawa.bulk_ppm[1] / 1e4, 'Itokawa', 'left', 1], [SRC.bennuOrbit.h_wt_mean / K.H_PER_H2O, 'Bennu (orbit)', 'right', 1], [SRC.murchison.runs[0].h2o_wt, 'Murchison ' + SRC.murchison.runs[0].id, 'right', 0.5]];
    mk.forEach(function (q) { var e = K.energy(q[0] / 100, S.T0_K, Tpk, S.recovery).perKgWater_J / 1e6; F.dots([q[0]], [e], css('--s2'), 3.5); F.label(q[0], e, q[1], css('--s2'), q[2], q[3]); });
    F.dots([R.feed.w * 100], [R.energy.perKgWater_J / 1e6], css('--ink'), 5.5);
    legend('energyLegend', [['heat per kg of water at ' + fx(Tpk - 273.15, 0) + ' °C', css('--s1')], ['analogs', css('--s2'), 'dot'], ['this case', css('--ink'), 'dot']]);
    $('energyCap').textContent = 'Robie and Hemingway (USGS): breaking serpentine costs ' + fx(R.energy.perKgWaterReaction_J / 1e6, 2) + ' MJ per kg of water; below a few per cent of water, heating the rock costs far more than freeing the water.';
  }
  function drawRec() {
    var R = state.R, S = R.S, Tpk = R.feed.Tpk, Sx = R.receiver.S_epoch, cs = [], ys = [];
    for (var i = 0; i <= 80; i++) { var c = Math.pow(10, 1 + i * 3 / 80); cs.push(c); ys.push(100 * K.receiverFlux(Sx, Tpk, { eta_opt: S.eta_opt, conc: c, eps: S.eps }) / (S.eta_opt * Sx)); }
    var F = frame($('recChart'), { x: [10, 10000], y: [0, 100], xlog: true, xlab: 'concentration (mirror area / oven opening)', ylab: 'sunlight kept in the oven (%)' });
    F.line(cs, ys, css('--s1'));
    F.vmark(S.conc, css('--ink-2'), 'this mirror', 0); F.vmark(R.receiver.minConc_epoch, css('--s2'), 'break-even', 1);
    $('recCap').textContent = 'At ' + fx(Tpk - 273.15, 0) + ' °C and ' + fx(R.timeline[0].r_au, 2) + ' au (' + fx(Sx, 0) + ' W/m²), the oven\'s opening radiates σT⁴ = ' + f(K.SIGMA * Math.pow(Tpk, 4) / 1000, 3) + ' kW/m². Below a concentration of ' + f(R.receiver.minConc_epoch, 3) + ' nothing is left to heat the rock.';
  }
  function drawPush() {
    var R = state.R, dg = R.dig, S = R.S, xmax = Math.max(dg.depthMax_m * 2, S.depth_m * 1.5) * 1000, xs = [], hi = [], lo = [];
    var lowDig = K.dig(Object.assign({}, S, { resistance: 'low' }), { resistance_Pa: R.src.site.resistance_Pa, weightNormal_N: dg.weightNormal_N, alongSlope_N: 0, holdKgPerNHour: null, propellantLeft_kg: null });
    var highDig = K.dig(Object.assign({}, S, { resistance: 'high' }), { resistance_Pa: R.src.site.resistance_Pa, weightNormal_N: dg.weightNormal_N, alongSlope_N: 0, holdKgPerNHour: null, propellantLeft_kg: null });
    for (var i = 0; i <= 40; i++) { var d = xmax * i / 40; xs.push(d); hi.push(highDig.perDepth_N_m * d); lo.push(lowDig.perDepth_N_m * d); }   // N/m x mm = mN
    var ymax = Math.max(dg.weightNormal_N * 1000 * 1.6, highDig.perDepth_N_m * xmax);
    var F = frame($('pushChart'), { x: [0, xmax], y: [0, ymax], xlab: 'cut depth (mm)', ylab: 'push on the spacecraft (mN)' });
    F.line(xs, hi, css('--s2')); F.line(xs, lo, css('--s1'), [6, 4]);
    F.hmark(dg.weightNormal_N * 1000, css('--crit'), 'weight on the ground: lifts off above', [2, 0]);
    F.vmark(S.depth_m * 1000, css('--ink-2'), 'set', 1); if (dg.depthCapped) F.vmark(dg.depthUsed_m * 1000, css('--s3'), 'held to', 2);
    legend('pushLegend', [['high resistance (' + fx(R.src.site.resistance_Pa[1], 0) + ' Pa)', css('--s2')], ['low (' + fx(R.src.site.resistance_Pa[0], 0) + ' Pa)', css('--s1'), 'dash']]);
    $('pushCap').textContent = S.pairs + ' pair(s) of ' + dg.drum.name + 's, imbalance ' + S.imbalance + ', cut at ' + fx(S.cut_m_s * 1000, 1) + ' mm/s: ' + f(dg.mdotUsed_kg_s * 3600, 3) + ' kg of regolith an hour. Friction the feet need on the ' + fx(R.src.site.slope_deg, 0) + '° slope while digging: ' + fx(dg.friction_needed, 2) + ' (not known for this regolith).';
  }
  function checksTable() {
    var R = state.R, rows = K.reality(R);
    $('checkTable').tBodies[0].innerHTML = rows.map(function (r) {
      var gap = r.gap_pct === null || r.gap_pct === undefined ? '–' : (r.gap_pct >= 0 ? '+' : '−') + Math.abs(r.gap_pct).toFixed(1) + '%';
      var real = r.real === null ? '–' : f(r.real, 4) + (r.sigma ? ' ± ' + r.sigma : '') + ' ' + r.units;
      return '<tr><td data-k="Check">' + esc(r.what) + '<span class="why">' + esc(r.source) + '</span></td><td class="n" data-k="Reality">' + esc(real) + '</td><td class="n" data-k="This page">' + esc(f(r.model, 4) + ' ' + r.units) + '</td><td class="n" data-k="Gap">' + gap + '</td></tr>';
    }).join('');
  }

  // ------------------------------------------------------------------------------------------------ handoff
  function status(msg, ok) { var el = $('hoStatus'); el.textContent = msg; el.className = 'status ' + (ok ? 'ok' : 'bad'); }
  function exportText() { var R = state.R; if (!R || R.refusal) { status('Nothing to export: the inputs are refused.', false); return null; } return JSON.stringify(K.buildHandoff(R, new Date().toISOString())); }
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function importText(text) {
    var h; try { h = JSON.parse(text); } catch (e) { status('Refused (invalid input): that is not JSON.', false); return false; }
    var p = K.parseHandoff(h); if (p.refusal) { status('Refused (' + p.refusal.code + '): ' + p.refusal.reason + ' ' + p.refusal.what_would_help, false); return false; }
    var key = p.src.kind === 'bennu' ? 'bennu' : 'chain';
    state.caseKey = key; state.h44[key] = p.src.h44; state.srcs[key] = p.src;
    if (p.from === '44-touch-and-go') { state.S = K.defaults(p.src); syncControls(); run(); status('Imported idea 44\'s handoff: ' + p.src.site.body + ', plate ' + p.src.site.face + '; ' + p.src.carried.length + ' refusals carried.', true); return true; }
    state.S = Object.assign(K.defaults(p.src), p.settings); state.R = p.R; state.seq++; syncControls(); render(); status('Imported this page\'s handoff and recomputed it: it matches.', true); return true;
  }
  function importSafe(t) { try { return importText(t); } catch (e) { status('Refused (invalid input): this handoff could not be read (' + e.message + ').', false); return false; } }
  function copy(text, msg) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { status(msg, true); }, function () { $('importText').value = text; status('Copy is blocked here: the text is in the box above.', true); }); else { $('importText').value = text; status('The text is in the box above.', true); } }
  function later(fn) { status('Working…', true); setTimeout(fn, 30); }
  $('importBtn').addEventListener('click', function () { later(function () { importSafe($('importText').value); }); });
  $('importFile').addEventListener('change', function () { var fl = $('importFile').files[0]; if (!fl) return; fl.text().then(function (t) { later(function () { importSafe(t); }); }); });
  $('copyBtn').addEventListener('click', function () { var h = exportText(); if (h) copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
  $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'dig-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded dig-handoff.json.', true); });
  $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + b64u(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (state.R && !state.R.refusal) render(); }, 150); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.R) render(); });

  resetS(); syncControls();
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/), done = false;
  if (hash) { try { done = importText(unb64u(hash[1])); } catch (e) { status('Refused (invalid input): the link\'s handoff could not be read.', false); } }
  if (!done) run();
  window.DigPage = { K: K, state: state, run: run, importText: importText, exportText: exportText, render: render };
})();
