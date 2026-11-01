/* Touch and Go (idea 44): the page. Wires the kernel (touch.js, on idea 43's lumpy.js) to the controls, charts and handoff. */
(function () {
  'use strict';
  var lumpyDeps = { shapes: LumpyShapes, attitude: LumpyAttitude, geophysics: LumpyGeophysics, orbitB: LumpyOrbitB, orbitBSunlight: LumpyOrbitBSunlight, coast: LumpyIntegrator, sources: ClosingSources, constants: LambertAster };
  var K43 = Lumpy.create(lumpyDeps);
  var K = Touch.create({ lumpy: K43, lumpyDeps: lumpyDeps, recon: TouchRecon, sources: TouchSources, coast: LumpyIntegrator, constants: LambertAster, nist: ClosingSources.nist });
  var SRC = TouchSources, REC = TouchRecon;
  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180;
  var state = { caseKey: 'chain', h43: window.TouchLumpySample, S: null, R: null, srcs: {}, checks: null, timer: null, running: false };

  function f(x, d) { if (x === null || x === undefined || !isFinite(x)) return '–'; var a = Math.abs(x); if (a !== 0 && (a < 1e-3 || a >= 1e7)) return x.toExponential(Math.max(1, (d || 3) - 1)); return String(+x.toPrecision(d || 3)); }
  function fx(x, n) { return x === null || !isFinite(x) ? '–' : x.toFixed(n); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }
  function utc(iso) { return iso.slice(0, 10) + ' ' + iso.slice(11, 19); }
  function pct(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%'; }

  // ------------------------------------------------------------------------------------------------ cases and controls
  function src() {
    var k = state.caseKey + (state.caseKey === 'bennu' ? ':' + state.S.gm : '');
    if (state.srcs[k]) return state.srcs[k];
    var s = state.caseKey === 'bennu' ? K.bennuCase(state.S.gm) : K.importLumpy(state.h43);
    if (!s.refusal) state.srcs[k] = s;
    return s;
  }
  var NUM = [['depIn', 'depRange', 'depToCp_h', 1], ['hcpIn', 'hcpRange', 'h_cp', 1], ['cpmpIn', null, 'cpToMp_min', 1], ['mptgIn', null, 'mpToTag_min', 1], ['vtdIn', 'vtdRange', 'v_td', 100], ['armIn', null, 'arm_m', 1], ['babIn', null, 'bab_m_s', 100],
    ['ctsIn', null, 'contact_s', 1], ['escIn', null, 'errScale', 1], ['safeIn', null, 'safeRadius_m', 1], ['eIn', 'eRange', 'e', 1], ['rxIn', 'rxRange', 'reaction_N', 1], ['tiltIn', 'tiltRange', 'rockTilt_deg', 1]];
  function syncControls() {
    var S = state.S;
    NUM.forEach(function (q) { var v = +(S[q[2]] * q[3]).toPrecision(8); $(q[0]).value = v; if (q[1]) $(q[1]).value = v; });
    $('massIn').value = S.mass_kg === null ? '' : S.mass_kg;
    $('sunChk').checked = S.sun; $('gmChk').checked = S.gm === 'measured_sc'; $('gmLab').classList.toggle('hide', state.caseKey !== 'bennu');
    $('mobSel').value = S.mobility; $('parSel').value = S.particles;
    document.querySelectorAll('[data-case]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.case === state.caseKey)); });
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)); });
    document.querySelectorAll('[data-err]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.err === S.errors)); });
    document.querySelectorAll('[data-surf]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.surf === S.surface)); });
    $('eRow').classList.toggle('hide', !(S.mode === 'stay' && S.surface === 'rigid'));
    $('babRow').style.opacity = S.mode === 'tag' ? 1 : 0.5;
  }
  function schedule(delay) { clearTimeout(state.timer); state.timer = setTimeout(run, delay === undefined ? 350 : delay); }
  NUM.forEach(function (q) {
    var a = $(q[0]), b = q[1] ? $(q[1]) : null;
    function set(v) { if (v === '' || !isFinite(+v)) return; state.S[q[2]] = +v / q[3]; }
    a.addEventListener('input', function () { set(a.value); if (b) b.value = a.value; schedule(700); });
    a.addEventListener('change', function () { set(a.value); schedule(50); });
    if (b) { b.addEventListener('input', function () { a.value = b.value; set(b.value); schedule(450); }); }
  });
  $('massIn').addEventListener('change', function () { var v = $('massIn').value.trim(); state.S.mass_kg = v === '' ? null : +v; schedule(50); });
  $('sunChk').addEventListener('change', function () { state.S.sun = $('sunChk').checked; schedule(50); });
  $('gmChk').addEventListener('change', function () { state.S.gm = $('gmChk').checked ? 'measured_sc' : 'measured'; schedule(50); });
  $('mobSel').addEventListener('change', function () { state.S.mobility = $('mobSel').value; schedule(50); });
  $('parSel').addEventListener('change', function () { state.S.particles = $('parSel').value; schedule(50); });
  document.querySelectorAll('[data-case]').forEach(function (b) { b.addEventListener('click', function () { if (state.caseKey === b.dataset.case) return; state.caseKey = b.dataset.case; state.S = K.defaults(state.caseKey === 'bennu' ? 'bennu' : 'chain'); syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { state.S.mode = b.dataset.mode; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-err]').forEach(function (b) { b.addEventListener('click', function () { state.S.errors = b.dataset.err; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-surf]').forEach(function (b) { b.addEventListener('click', function () { state.S.surface = b.dataset.surf; syncControls(); schedule(10); }); });
  $('resetBtn').addEventListener('click', function () { state.S = K.defaults(state.caseKey === 'bennu' ? 'bennu' : 'chain'); syncControls(); schedule(10); });

  // ------------------------------------------------------------------------------------------------ run
  function busy(on, msg) { $('runNote').textContent = msg || ''; document.querySelectorAll('.col, section.wide').forEach(function (e) { e.classList.toggle('busy', on); }); $('bar').style.width = on ? '60%' : '0'; }
  function run() {
    if (state.running) { schedule(200); return; }
    state.running = true;
    busy(true, 'Flying the descent through the shape\'s gravity… (a few seconds the first time)');
    setTimeout(function () {
      try {
        var s = src();
        state.R = s.refusal ? { refusal: s.refusal } : K.run(s, state.S);
      } catch (e) { state.R = { refusal: { code: 'invalid_input', reason: 'The computation failed: ' + e.message, what_would_help: 'Other settings.' } }; }
      state.running = false; busy(false, ''); render();
      if (!state.checks) setTimeout(buildChecks, 60);
    }, 30);
  }

  // ------------------------------------------------------------------------------------------------ render
  function tile(k, v, u, conf, sub, cls) { return '<div class="tile ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + (conf ? '<span class="c">' + conf + '</span>' : '') + '</div>'; }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code.replace(/_/g, ' ')) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · from ' + esc(r.from) : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function render() {
    var R = state.R;
    if (!R || R.refusal) {
      $('tiles').innerHTML = ''; $('burnTable').tBodies[0].innerHTML = ''; $('resLine').textContent = '';
      $('refusals').innerHTML = refusalHtml(R ? R.refusal : { code: 'invalid_input', reason: 'Nothing computed.', what_would_help: 'Reset.' });
      ['descChart', 'ellChart', 'penChart', 'hopChart', 'holdChart', 'smpChart'].forEach(function (id) { blank($(id)); });
      $('srcLine').textContent = ''; return;
    }
    var s = R.src, p = R.plan, D = R.dispersion, S = R.S, st = s.site.s43;
    $('srcLine').textContent = s.kind === 'bennu' ? 'OSIRIS-REx at Bennu, from its reconstructed state before Orbit Departure (' + utc(K.utcOf(p.t0)) + ' UTC); the site is the published sampling spot, 55.9°N 41.8°E (plate ' + s.site.face + ').'
      : 'From idea 43: ' + s.B.name + ', the stand-off of ' + utc(K.utcOf(p.t0)) + ' UTC, ' + (Math.hypot.apply(null, s.x0) / 1000).toFixed(1) + ' km out; site plate ' + s.site.face + ' (slope ' + st.slope_deg.toFixed(1) + '°); spacecraft ' + s.craft.name.toUpperCase() + ' (' + s.craft.mass_kg.toFixed(1) + ' kg, Isp ' + s.craft.isp_s.toFixed(1) + ' s, from idea 42).';
    $('resLine').innerHTML = 'Contact <b>' + utc(K.utcOf(p.tc)) + ' UTC</b> after a ' + f((p.tc - p.tmp) / 60, 3) + '-min fall from a Matchpoint ' + f(p.mpHeight_m, 3) + ' m up. Gravity at the site ' + f(st.gravity_mag_m_s2 * 1e6, 3) + ' µm/s², slope ' + f(st.slope_deg, 3) + '°, escape straight up ' + f(st.escape_up_m_s * 100, 3) + ' cm/s (idea 43).';
    var T = [], tot = S.mode === 'tag' ? p.total_dv_m_s : p.total_dv_m_s - S.bab_m_s;
    T.push(tile('Total Δv' + (S.mode === 'tag' ? ' with back-away' : ''), fx(tot * 100, 1), 'cm/s', 'derived', p.burns.map(function (b) { return b.name + ' ' + fx(b.dv_m_s * 100, 1); }).join(', '), 'hero'));
    T.push(tile('Contact ellipse (3σ semi-axes)', fx(D.pos3_m[0], 2) + ' × ' + fx(D.pos3_m[1], 2), 'm', 'derived', 'P(inside ' + S.safeRadius_m + ' m) = ' + (D.pSafe * 100).toFixed(D.pSafe > 0.999 ? 2 : 1) + '%', D.pSafe < 0.99 ? 'warn' : 'ok'));
    T.push(tile('Contact speed spread (3σ)', fx(D.vert3_m_s * 1000, 1) + ' / ' + fx(D.horiz3_m_s * 1000, 1), 'mm/s', 'derived', 'vertical / horizontal; limit ' + SRC.delivery.vel_req_mm_s.v + ' mm/s', D.vert3_m_s * 1000 > SRC.delivery.vel_req_mm_s.v ? 'bad' : ''));
    if (R.propellant) T.push(tile('Propellant for this', fx(R.propellant.needed_kg * 1000, 0), 'g', 'derived', 'has ' + fx(R.propellant.available_kg * 1000, 0) + ' g at the stand-off (idea 42), Isp ' + R.propellant.isp_s.toFixed(0) + ' s', R.propellant.needed_kg > R.propellant.available_kg ? 'bad' : 'ok'));
    else T.push(tile('Propellant for this', 'refused', '', '', 'no Isp or mass for this spacecraft here', 'refused'));
    var cs = R.contact.cases, dmin = Math.min.apply(null, cs.map(function (c) { return c.d_tau; })), dmax = Math.max.apply(null, cs.map(function (c) { return c.d_tau; }));
    if (S.mode === 'tag') {
      T.push(tile('Sinks before backing away', fx(dmin * 100, 0) === fx(dmax * 100, 0) ? fx(dmin * 100, 0) : fx(dmin * 100, 0) + '–' + fx(dmax * 100, 0), 'cm', 'assumed', 'in ' + S.contact_s + ' s at ' + fx(R.contact.v_in_m_s * 100, 1) + ' cm/s, Bennu-like regolith (' + fx(R.contact.regolith.p_Pa[0], 0) + '–' + fx(R.contact.regolith.p_Pa[1], 0) + ' Pa)'));
      T.push(tile('Back-away', p.bab.escapes ? 'leaves' : 'falls back', '', 'derived', fx(p.bab.inertial_m_s * 100, 1) + ' cm/s against ' + fx(p.bab.escape_m_s * 100, 1) + ' cm/s escape', p.bab.escapes ? 'ok' : 'bad'));
    } else if (R.stay.surface === 'rigid') {
      var bo = R.stay.bounce;
      T.push(tile('Bounces', bo.escaped ? 'escapes' : String(bo.hops.length), bo.escaped ? '' : 'hops', 'assumed', bo.escaped ? 'the rebound beats the escape speed' : 'settles after ' + f(bo.settled_s / 60, 3) + ' min, ' + f(bo.rest_from_site_m, 3) + ' m from the aim', bo.escaped ? 'bad' : ''));
      T.push(tile('Escape threshold', fx(R.eStar, 2), '', 'derived', 'restitution above which the first rebound leaves (escape speed / contact speed)' + (R.eStar >= 1 ? '; above 1, no rebound can' : '')));
    } else {
      var smin = Math.min.apply(null, R.stay.sinks.map(function (q) { return q.stop_m; })), smax = Math.max.apply(null, R.stay.sinks.map(function (q) { return q.stop_m; }));
      T.push(tile('Sinks and stops', fx(smin * 100, 0) + '–' + fx(smax * 100, 0), 'cm', 'assumed', 'loose regolith absorbs the landing (Bennu analog); no bounce'));
    }
    if (R.hold) T.push(tile('Weight at the site', f(R.hold.weight_N * 1000, 3), 'mN', 'derived', 'a push over ' + f(R.hold.normal_N * 1000, 3) + ' mN lifts it; holding ' + f(S.reaction_N, 3) + ' N costs ' + (R.hold.propellant_kg_h === null ? '– (no Isp)' : f(R.hold.propellant_kg_h, 3) + ' kg/h'), R.hold.liftsOff ? 'warn' : ''));
    else T.push(tile('Weight at the site', 'refused', '', '', 'set the spacecraft mass', 'refused'));
    var sm = R.sample;
    if (sm.mass_kg !== null) T.push(tile('Sample (TAGSAM, predicted)', fx(sm.mass_kg * 1000, 0), 'g', 'assumed', fx(sm.returned_kg * 1000, 1) + ' g came home (NASA 2024); tilt efficiency ' + fx(sm.efficiency, 2)));
    else T.push(tile('Sample mass', 'refused', '', '', 'no particle map; if like Nightingale: ' + fx(sm.analog_kg * 1000, 0) + ' g (assumed analog)', 'refused'));
    T.push(tile('Matchpoint height', fx(p.mpHeight_m, 1), 'm', 'derived', 'an outcome of the targeting; OSIRIS-REx planned ' + SRC.profile.h_mp_m.v + '–' + SRC.profile.h_mp_m_2014.v + ' m'));
    $('tiles').innerHTML = T.join('');
    var flown = R.reality ? R.reality.flownBurns : null;
    $('burnTable').tBodies[0].innerHTML = p.burns.map(function (b, i) { return '<tr><td data-k="Burn">' + b.name + '</td><td data-k="When (UTC)">' + utc(K.utcOf(b.t)) + '</td><td class="n" data-k="Δv">' + fx(b.dv_m_s * 1000, 2) + ' mm/s</td><td class="n" data-k="Flown">' + (flown ? fx(flown[i].dv_m_s * 1000, 2) + ' mm/s (' + pct(b.dv_m_s / flown[i].dv_m_s - 1) + ')' : '–') + '</td></tr>'; }).join('') +
      (S.mode === 'tag' ? '<tr><td data-k="Burn">Back-away</td><td data-k="When (UTC)">' + utc(K.utcOf(p.tc + S.contact_s)) + '</td><td class="n" data-k="Δv">' + fx(S.bab_m_s * 1000, 0) + ' mm/s</td><td class="n" data-k="Flown">' + (s.kind === 'bennu' ? fx(SRC.profile.bab_m_s.v * 1000, 0) + ' mm/s (design)' : '–') + '</td></tr>' : '');
    $('refusals').innerHTML = R.own.map(refusalHtml).join('');
    $('carried').style.display = R.carried.length ? '' : 'none';
    $('carriedSum').textContent = R.carried.length + ' refusals carried from earlier modules';
    $('carriedList').innerHTML = R.carried.map(refusalHtml).join('');
    drawDescent(); drawEllipse(); drawPen(); drawHop(); drawHold(); drawSample(); checksTable();
  }

  // ------------------------------------------------------------------------------------------------ canvas helpers
  function setup(cv, aspect, minH, maxH) {
    var w = cv.clientWidth || 320, h = Math.max(minH || 200, Math.min(maxH || 300, Math.round(w * (aspect || 0.6)))), r = window.devicePixelRatio || 1;
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
    return { ctx: ctx, tx: tx, ty: ty, pl: pl, pt: pt, W: W, H: H, w: c.w, h: c.h,
      line: function (xs, ys, color, dash, width) { clip(); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); var on = false; for (var i = 0; i < xs.length; i++) { var a = xs[i], b = ys[i]; if (!isFinite(a) || !isFinite(b) || (o.ylog && b <= 0) || (o.xlog && a <= 0)) { on = false; continue; } var X = tx(a), Y = ty(b); if (!on) { ctx.moveTo(X, Y); on = true; } else ctx.lineTo(X, Y); } ctx.stroke(); ctx.restore(); },
      dots: function (xs, ys, color, r) { clip(); ctx.fillStyle = color; for (var i = 0; i < xs.length; i++) { if (!(xs[i] > 0 || !o.xlog) || !(ys[i] > 0 || !o.ylog)) continue; ctx.beginPath(); ctx.arc(tx(xs[i]), ty(ys[i]), r || 2.5, 0, 2 * Math.PI); ctx.fill(); } ctx.restore(); },
      vmark: function (v, color, text, row) { if (!(v >= o.x[0] && v <= o.x[1])) return; var X = tx(v); ctx.save(); ctx.strokeStyle = color; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = X > pl + W * 0.6 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, X + (X > pl + W * 0.6 ? -3 : 3), pt + 3 + 13 * (row || 0)); } ctx.restore(); },
      text: function (x, y, s, color, align) { ctx.save(); ctx.fillStyle = color; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(s, tx(x), ty(y) - 3); ctx.restore(); } };
  }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key ' + (it[2] || '') + '" style="' + (it[2] === 'dot' ? 'background:' : 'border-color:') + it[1] + '"></span>' + esc(it[0]) + '</li>'; }).join(''); }

  // ------------------------------------------------------------------------------------------------ charts
  function drawDescent() {
    var R = state.R, p = R.plan, xs = [], ys = [], pts = [];
    R.profile.forEach(function (leg) { leg.forEach(function (q) { pts.push(q); }); });
    pts.forEach(function (q) { xs.push(p.tc - q.t); ys.push(q.r); });
    var ymax = Math.max.apply(null, ys.filter(isFinite)), xmax = Math.max.apply(null, xs);
    var F = frame($('descChart'), { x: [10, Math.max(1e3, xmax * 1.2)], y: [1, Math.max(200, ymax * 1.3)], xlog: true, ylog: true, xlab: 'time to contact (s)', ylab: 'distance from the site (m)' });
    var items = [['planned descent', css('--s1')]];
    if (R.src.kind === 'bennu') {
      var rp = K.reconProfile(R.ctx), tc = REC.contact.t;
      F.dots(rp.map(function (q) { return tc - q.t; }), rp.map(function (q) { return q.r; }), css('--s2'), 2.5);
      items.push(['OSIRIS-REx, reconstructed (JPL Horizons)', css('--s2'), 'dot']);
    }
    F.line(xs, ys, css('--s1'));
    F.vmark(p.tc - p.tcp, css('--ink-2'), 'Checkpoint', 0); F.vmark(p.tc - p.tmp, css('--ink-2'), 'Matchpoint', 1);
    legend('descLegend', items);
    $('descCap').textContent = 'Departure ' + f((p.tcp - p.t0) / 3600, 3) + ' h before Checkpoint (' + R.S.h_cp + ' m up), Matchpoint ' + f(p.mpHeight_m, 3) + ' m up, contact with the reference point ' + R.S.arm_m + ' m (the arm) above the ground. Distances are from the aim point on idea 43\'s 25 m plates, in the body\'s turning frame.';
  }
  function drawEllipse() {
    var R = state.R, D = R.dispersion, S = R.S, a = D.pos3_m[0], b = D.pos3_m[1], L = Math.max(S.safeRadius_m, a) * 1.25;
    var cv = $('ellChart'), c = setup(cv, 0.8, 220, 340), ctx = c.ctx, cx = c.w / 2, cy = c.h / 2, sc = Math.min(c.w, c.h) / 2 / L;
    ctx.clearRect(0, 0, c.w, c.h); ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    var step = Math.pow(10, Math.floor(Math.log10(L))) / (L / Math.pow(10, Math.floor(Math.log10(L))) < 3 ? 2 : 1);
    for (var g = -Math.floor(L / step) * step; g <= L; g += step) { ctx.beginPath(); ctx.moveTo(cx + g * sc, 0); ctx.lineTo(cx + g * sc, c.h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy + g * sc); ctx.lineTo(c.w, cy + g * sc); ctx.stroke(); }
    ctx.fillStyle = css('--ink-2'); ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('grid ' + f(step, 2) + ' m', 4, c.h - 3);
    ctx.strokeStyle = css('--s1'); ctx.lineWidth = 2; ctx.fillStyle = css('--accent-bg'); ctx.beginPath(); ctx.ellipse(cx, cy, a * sc, b * sc, -D.angle_deg * DEG, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = css('--s3'); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(cx, cy, S.safeRadius_m * sc, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--ink'); ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
    var items = [['3σ contact ellipse', css('--s1')], ['safe radius ' + S.safeRadius_m + ' m', css('--s3'), 'dash']];
    if (R.src.kind === 'bennu') {
      var row = K.recRow(REC.contact.t), rv = K.relVel(R.ctx, REC.contact.t, row.slice(0, 3), row.slice(3)), n = R.src.site.normal, d = rv.xb.map(function (x, i) { return x - R.src.site.point[i]; });
      var h = d[0] * n[0] + d[1] * n[1] + d[2] * n[2], e1 = D.axes.e1, e2 = D.axes.e2, u = d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2], v = d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2];
      ctx.fillStyle = css('--s2'); ctx.beginPath(); ctx.arc(cx + u * sc, cy - v * sc, 4, 0, 2 * Math.PI); ctx.fill();
      items.push(['OSIRIS-REx at contact (above the ground ' + f(h, 3) + ' m; ' + f(Math.hypot(u, v), 3) + ' m from this aim point)', css('--s2'), 'dot']);
    }
    legend('ellLegend', items);
    $('ellCap').textContent = 'Top view of the site plane, aim point at the centre. Budget of the long axis (3σ): ' + Object.keys(D.budget_pos3_m).map(function (k) { return k + ' ' + f(D.budget_pos3_m[k], 2) + ' m'; }).join(', ') + '.';
  }
  function drawPen() {
    var R = state.R, C = R.contact, S = R.S, tmax = Math.max(12, S.contact_s * 1.6), dmax = 0, series = [];
    C.cases.forEach(function (q) { var xs = [], ys = []; for (var i = 0; i <= 120; i++) { var t = tmax * i / 120, tt = q.stops ? Math.min(t, q.stop_s) : t, d = C.v_in_m_s * tt - q.a_m_s2 * tt * tt / 2; xs.push(t); ys.push(d * 100); dmax = Math.max(dmax, d * 100); } series.push([xs, ys, q]); });
    var F = frame($('penChart'), { x: [0, tmax], y: [0, Math.max(60, dmax * 1.15)], xlab: 'time after contact (s)', ylab: 'depth of the head (cm)' });
    var cols = [css('--s1'), css('--s2'), css('--s3'), css('--ink-2')];
    series.forEach(function (sr, i) { F.line(sr[0], sr[1], cols[i % 4]); });
    F.vmark(S.contact_s, css('--ink-2'), S.mode === 'tag' ? 'back-away' : '', 0);
    var items = series.map(function (sr, i) { return [f(sr[2].p_Pa, 3) + ' Pa on ' + f(sr[2].m_kg, 4) + ' kg', cols[i % 4]]; });
    if (R.src.kind === 'bennu') { F.dots([SRC.contact.contact_s.v], [SRC.contact.penetration_m.v * 100], css('--crit'), 4); items.push(['NASA: ' + f(SRC.contact.penetration_m.v * 100, 3) + ' cm in ~' + SRC.contact.contact_s.v + ' s', css('--crit'), 'dot']); }
    legend('penLegend', items);
    $('penCap').textContent = 'A constant resistance fitted to OSIRIS-REx\'s contact (' + f(C.regolith.a_m_s2, 3) + ' m/s² at 10 cm/s), on the 32 cm head; ' + (R.src.kind === 'bennu' ? 'the mass at contact is unknown, so both ends of ' + SRC.spacecraft.dry_kg.v + '–' + SRC.spacecraft.wet_kg.v + ' kg.' : 'carried to ' + R.src.B.name + ' as an analog.');
  }
  function drawHop() {
    var R = state.R, S = R.S, p = R.plan;
    if (S.mode === 'tag') {
      var pr = K.profileOf(R.ctx, p.bab.after), xs = pr.map(function (q) { return (q.t - p.tc) / 60; }), ys = pr.map(function (q) { return q.h; });
      var F = frame($('hopChart'), { x: [0, 30], y: [0, Math.max(50, Math.max.apply(null, ys) * 1.1)], xlab: 'minutes after contact', ylab: 'height above the site (m)' });
      F.line(xs, ys, css('--s1')); legend('hopLegend', [['after a ' + f(S.bab_m_s * 100, 3) + ' cm/s back-away', css('--s1')]]);
      $('hopCap').textContent = p.bab.escapes ? 'It leaves: ' + f(p.bab.inertial_m_s * 100, 3) + ' cm/s is above the ' + f(p.bab.escape_m_s * 100, 3) + ' cm/s escape speed there (no rotation counted against it).' : 'It falls back: the back-away is under the escape speed.';
      return;
    }
    if (R.stay.surface !== 'rigid') { var c = setup($('hopChart')); c.ctx.clearRect(0, 0, c.w, c.h); c.ctx.fillStyle = css('--ink-2'); c.ctx.font = '13px system-ui, sans-serif'; c.ctx.textAlign = 'center'; c.ctx.fillText('No bounce: loose regolith absorbs the landing (Bennu analog).', c.w / 2, c.h / 2); legend('hopLegend', []); $('hopCap').textContent = 'Pick rigid rock to see hops.'; return; }
    var bo = R.stay.bounce, X = [], Y = [];
    bo.hops.forEach(function (h) { (h.path || []).forEach(function (q) { X.push(q[0] / 60); Y.push(Math.max(0, q[1])); }); X.push(NaN); Y.push(NaN); });
    var F2 = frame($('hopChart'), { x: [0, Math.max(5, (bo.settled_s || 60) / 60 * 1.1)], y: [0, Math.max(1, Math.max.apply(null, Y.filter(isFinite).concat([0])) * 1.2)], xlab: 'minutes after contact', ylab: 'height of the hop (m)' });
    F2.line(X, Y, css('--s1')); legend('hopLegend', [['restitution ' + S.e, css('--s1')]]);
    $('hopCap').textContent = bo.escaped ? 'The first rebound beats the escape speed: the lander leaves.' : bo.hops.length + ' hops over ' + f(bo.settled_s / 60, 3) + ' min; it settles ' + f(bo.rest_from_site_m, 3) + ' m from the aim point (on idea 43\'s 25 m plates, which miss the boulders that really decide a bounce).';
  }
  function drawHold() {
    var R = state.R, H = R.hold, S = R.S;
    if (!H || H.propellant_kg_h === null) { var c = setup($('holdChart')); c.ctx.clearRect(0, 0, c.w, c.h); c.ctx.fillStyle = css('--ink-2'); c.ctx.font = '13px system-ui, sans-serif'; c.ctx.textAlign = 'center'; c.ctx.fillText(H ? 'No Isp for this spacecraft here.' : 'Set the spacecraft mass to see holding down.', c.w / 2, c.h / 2); $('holdCap').textContent = H ? 'Weight ' + f(H.weight_N * 1000, 3) + ' mN.' : ''; return; }
    var Fmax = Math.max(1, S.reaction_N * 2), xs = [], ys = [], isp = R.src.craft.isp_s;
    for (var i = 0; i <= 100; i++) { var Fr = Fmax * i / 100; xs.push(Fr); ys.push(Math.max(0, Fr - H.normal_N) / (isp * K.G0) * 3600); }
    var F = frame($('holdChart'), { x: [0, Fmax], y: [0, Math.max(0.1, ys[100] * 1.1)], xlab: 'push from the work (N)', ylab: 'propellant to hold down (kg/h)' });
    F.line(xs, ys, css('--s1')); F.vmark(H.normal_N, css('--s3'), 'weight ' + f(H.normal_N * 1000, 2) + ' mN', 0); F.vmark(S.reaction_N, css('--s2'), 'set ' + f(S.reaction_N, 3) + ' N', 1);
    $('holdCap').textContent = 'At ' + f(R.src.site.s43.accel_mag_m_s2 * 1e6, 3) + ' µm/s² a ' + f(R.mass_kg, 4) + ' kg spacecraft weighs ' + f(H.weight_N * 1000, 3) + ' mN. Anything pushing harder lifts it unless thrusters push back, at Isp ' + f(isp, 4) + ' s. ' + (R.propellant ? 'It has ' + f(R.propellant.available_kg * 1000, 3) + ' g of propellant at the stand-off.' : '');
  }
  function drawSample() {
    var R = state.R, sm = R.sample, P = SRC.sample.predicted_g, Z = SRC.sample.zero_tilt_g;
    var bars = [['Low mobility, mapped', P.low_resolved, 's1'], ['Low mobility, sub-pixel', P.low_unresolved, 's1'], ['High mobility, mapped', P.high_resolved, 's1'], ['High mobility, sub-pixel', P.high_unresolved, 's1'], ['Zero tilt, low', Z.low, 's3'], ['Zero tilt, high', Z.high, 's3'], ['Returned (NASA)', SRC.sample.returned_g.v, 'crit'],
      [R.src.kind === 'bennu' ? 'This scenario' : 'Analog on ' + R.src.B.name.split(' (')[0].replace(/^\d+ /, ''), (sm.mass_kg !== null ? sm.mass_kg : sm.analog_kg) * 1000, 's2']];
    var c = setup($('smpChart'), 0.7, 240, 320), ctx = c.ctx, pl = Math.min(160, c.w * 0.42), W = c.w - pl - 48, rowH = (c.h - 30) / bars.length, mx = Math.max.apply(null, bars.map(function (b) { return b[1]; })) * 1.1;
    ctx.clearRect(0, 0, c.w, c.h); ctx.font = '11px system-ui, sans-serif';
    bars.forEach(function (b, i) {
      var y = 6 + i * rowH; ctx.fillStyle = css('--' + b[2]); ctx.fillRect(pl, y + 3, Math.max(1, b[1] / mx * W), rowH - 7);
      ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(b[0], pl - 6, y + rowH / 2);
      ctx.textAlign = 'left'; ctx.fillText(f(b[1], 3) + ' g', pl + Math.max(1, b[1] / mx * W) + 4, y + rowH / 2);
    });
    ctx.strokeStyle = css('--axis'); ctx.beginPath(); ctx.moveTo(pl, 4); ctx.lineTo(pl, c.h - 22); ctx.stroke();
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('collected mass (g); requirement 60 g', pl + W / 2, c.h - 2);
    $('smpCap').textContent = 'Walsh et al. 2022 estimated these after TAG for the spot TAGSAM touched, from the pre-TAG particle maps, with the head tilted by a rock (efficiency ' + SRC.sample.rock_tilt_eff.v + ', about ' + f(sm.impliedTilt_deg, 3) + '°); images showed it flush. ' + SRC.sample.returned_g.v + ' g came home. ' + (sm.mass_kg === null ? 'For ' + R.src.B.name + ' there is no particle map: the bar is the Nightingale scenario at its density (' + f(R.src.B.rho, 4) + ' kg/m³), an analog only.' : '');
  }

  // ------------------------------------------------------------------------------------------------ checks against reality
  function buildChecks() {
    var b = state.caseKey === 'bennu' && state.R && !state.R.refusal && state.S.gm === 'measured' && !state.R.S.mass_kg ? state.R : null;
    if (!b) { var s = state.srcs['bennu:measured'] || K.bennuCase('measured'); state.srcs['bennu:measured'] = s; b = K.run(s, K.defaults('bennu')); }
    if (b.refusal) return;
    var L = b.reality.legs, c = b.reality.contact, P = b.plan.burns, F = b.reality.flownBurns, D = b.dispersion, N = SRC.delivery.nightingale_2020;
    var rows = [
      ['The last fall, Matchpoint to contact (10.0 min)', 'JPL Horizons\' reconstruction of OSIRIS-REx', 'misses by ' + f(L[2].poly.dr_m, 3) + ' m, ' + f(L[2].poly.dv_m_s * 1000, 3) + ' mm/s (the shape)', 'point mass: ' + f(L[2].pm.dr_m, 3) + ' m, ' + f(L[2].pm.dv_m_s * 1000, 3) + ' mm/s', 'The model falls a little fast (' + f(L[2].poly.dv_radial_m_s * 1000, 3) + ' mm/s radial): its gravity near Nightingale is too strong, or the 25 m plates miss the crater.'],
      ['The 4-hour leg, departure to Checkpoint', 'the same', f(L[0].poly.dr_m, 3) + ' m (the shape)', 'point mass: ' + f(L[0].pm.dr_m, 3) + ' m', 'With idea 42\'s sunlight; on this leg sunlight and the shape\'s own pull are about the same size.'],
      ['Checkpoint to Matchpoint (9.5 min)', 'the same', f(L[1].poly.dr_m, 3) + ' m', 'point mass: ' + f(L[1].pm.dr_m, 3) + ' m', ''],
      ['Contact speed', 'NASA 2020: 10 cm/s; reconstruction ' + f(-c.vn_m_s * 100, 4) + ' cm/s', f(b.S.v_td * 100, 3) + ' cm/s (targeted)', pct(-c.vn_m_s / SRC.contact.v_contact_m_s.v - 1) + ' (reconstruction vs NASA)', 'Horizontal: ' + f(c.vh_m_s * 1000, 3) + ' mm/s in the reconstruction (limit 20).'],
      ['When Earth heard it', 'NASA: confirmation at 6:08 pm EDT (22:08 UTC)', utc(c.earthReceiveUtc) + ' UTC', 'same minute', 'The end of Horizons\' descent segment (' + utc(c.utc) + ' UTC at Bennu) plus ' + f(REC.lightTime_min_at_2150utc, 4) + ' min of light time.'],
      ['Departure burn', 'reconstruction: ' + f(F[0].dv_m_s * 1000, 4) + ' mm/s', f(P[0].dv_m_s * 1000, 4) + ' mm/s (planned)', pct(P[0].dv_m_s / F[0].dv_m_s - 1), 'Aimed at ' + b.S.h_cp + ' m above this page\'s site at the flown Checkpoint time.'],
      ['Checkpoint + Matchpoint', 'reconstruction: ' + f((F[1].dv_m_s + F[2].dv_m_s) * 1000, 4) + ' mm/s', f((P[1].dv_m_s + P[2].dv_m_s) * 1000, 4) + ' mm/s (planned)', pct((P[1].dv_m_s + P[2].dv_m_s) / (F[1].dv_m_s + F[2].dv_m_s) - 1), 'Split differently: planned ' + f(P[1].dv_m_s * 1000, 3) + ' + ' + f(P[2].dv_m_s * 1000, 3) + ', flown ' + f(F[1].dv_m_s * 1000, 3) + ' + ' + f(F[2].dv_m_s * 1000, 3) + ' mm/s.'],
      ['Matchpoint height', 'Berry et al. 2020: ' + SRC.profile.h_mp_m.v + ' m; May et al. 2014: ' + SRC.profile.h_mp_m_2014.v + ' m; flown ' + f(b.reality.heights.mp_m, 3) + ' m', f(b.plan.mpHeight_m, 3) + ' m (an outcome)', (b.plan.mpHeight_m > SRC.profile.h_mp_m.v && b.plan.mpHeight_m < SRC.profile.h_mp_m_2014.v ? 'inside ' : 'outside ') + SRC.profile.h_mp_m.v + '-' + SRC.profile.h_mp_m_2014.v + ' m', 'Checkpoint flown at ' + f(b.reality.heights.cp_m, 4) + ' m against the published 125 m.'],
      ['Contact ellipse (3σ)', 'Berry et al. 2020, Nightingale Monte Carlo: ' + N.pos_3s_m + ' m; 2021 late update: ' + SRC.delivery.late_max_m.v + ' m (maximum)', f(D.pos3_m[0], 3) + ' × ' + f(D.pos3_m[1], 3) + ' m (semi-axes)', pct(D.pos3_m[0] / N.pos_3s_m - 1) + ' / ' + pct(D.pos3_m[0] / SRC.delivery.late_max_m.v - 1), 'Only navigation knowledge and burn errors from Checkpoint on; they also modelled gravity, sunlight and spin errors.'],
      ['Contact speed spread (3σ)', 'Berry et al. 2020: horizontal ' + N.horiz_3s_mm_s + ', vertical ' + N.vert_3s_mm_s + ' mm/s', f(D.horiz3_m_s * 1000, 3) + ' / ' + f(D.vert3_m_s * 1000, 3) + ' mm/s', pct(D.horiz3_m_s * 1000 / N.horiz_3s_mm_s - 1) + ' / ' + pct(D.vert3_m_s * 1000 / N.vert_3s_mm_s - 1), 'Burn axes taken as the site normal and the burn\'s horizontal part; theirs are not published.'],
      ['Where it touched', 'Berry et al. 2021: within ' + SRC.delivery.flown_error_m.v + ' m of the target', f(c.heightAboveSite_m, 3) + ' m above this page\'s aim point at contact', 'arm ' + SRC.tagsam.arm_m.v + ' m: ' + f(c.heightAboveSite_m - SRC.tagsam.arm_m.v, 2) + ' m unexplained', 'Either the 25 m plates sit below the real ground there, or the trajectory\'s reference point is not an arm\'s length straight above the head (that offset is not published), or both.'],
      ['Sinking', 'NASA 2021: ' + f(SRC.contact.penetration_m.v * 100, 3) + ' cm in about ' + SRC.contact.contact_s.v + ' s, still moving', f(K.penetration(SRC.contact.v_contact_m_s.v, b.contact.regolith.mass_kg[0], b.contact.regolith.area_m2, b.contact.regolith.p_Pa[0], b.contact.regolith.gN, SRC.contact.contact_s.v).d_tau * 100, 3) + ' cm (fitted)', 'a fit, not a test', 'One constant deceleration reproduces it by construction; nothing independent checks it here.'],
      ['Sample', 'NASA 2024: ' + SRC.sample.returned_g.v + ' g came home', 'Walsh et al. 2022 at the spot touched, low mobility: ' + SRC.sample.zero_tilt_g.low + ' g (no tilt) or ' + SRC.sample.predicted_g.low_unresolved + ' g (mapped rock tilt)', pct(SRC.sample.zero_tilt_g.low / SRC.sample.returned_g.v - 1) + ' / ' + pct(SRC.sample.predicted_g.low_unresolved / SRC.sample.returned_g.v - 1), 'Both were made after TAG from the pre-TAG particle maps. The TAG images showed the head flush, so the authors favour no tilt (' + SRC.sample.zero_tilt_g.low + ' g, about twice what came home); the mapped tilt (' + SRC.sample.predicted_g.low_unresolved + ' g) is closer, which is not evidence it is right.']
    ];
    state.checks = rows; checksTable();
  }
  function checksTable() {
    var tb = $('checkTable').tBodies[0]; if (!state.checks) { tb.innerHTML = '<tr><td colspan="4">Computing the Bennu case…</td></tr>'; return; }
    tb.innerHTML = state.checks.map(function (r) { return '<tr><td data-k="Check">' + esc(r[0]) + (r[4] ? '<span class="why">' + esc(r[4]) + '</span>' : '') + '</td><td data-k="Reality">' + esc(r[1]) + '</td><td class="n" data-k="This page">' + esc(r[2]) + '</td><td class="n" data-k="Gap">' + esc(r[3]) + '</td></tr>'; }).join('');
  }

  // ------------------------------------------------------------------------------------------------ handoff
  function status(msg, ok) { var el = $('hoStatus'); el.textContent = msg; el.className = 'status ' + (ok ? 'ok' : 'bad'); }
  function exportText() { var R = state.R; if (!R || R.refusal) { status('Nothing to export: the inputs are refused.', false); return null; } return JSON.stringify(K.buildHandoff(R, new Date().toISOString())); }
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function importText(text) {
    var h; try { h = JSON.parse(text); } catch (e) { status('Refused (invalid input): that is not JSON.', false); return false; }
    if (h && h.from === '43-lumpy') {
      var s = K.importLumpy(h); if (s.refusal) { status('Refused (' + s.refusal.code + '): ' + s.refusal.reason + ' ' + s.refusal.what_would_help, false); return false; }
      state.h43 = h; state.srcs.chain = s; state.caseKey = 'chain'; state.S = K.defaults('chain'); syncControls(); run(); status('Imported idea 43\'s handoff: ' + s.B.name + ', site plate ' + s.site.face + '.', true); return true;
    }
    var p = K.parseHandoff(h); if (p.refusal) { status('Refused (' + p.refusal.code + '): ' + p.refusal.reason + ' ' + p.refusal.what_would_help, false); return false; }
    if (p.h44.inputs.lumpy_handoff) { state.h43 = p.h44.inputs.lumpy_handoff; state.srcs.chain = p.src; }
    state.caseKey = p.h44.inputs.case === 'bennuTAG' ? 'bennu' : 'chain'; state.S = Object.assign(K.defaults(state.caseKey), p.settings);
    state.R = p.R; syncControls(); render(); status('Imported this page\'s handoff and recomputed it: it matches.', true); return true;
  }
  function importSafe(t) { try { return importText(t); } catch (e) { status('Refused (invalid input): this handoff could not be read (' + e.message + ').', false); return false; } }
  function copy(text, msg) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { status(msg, true); }, function () { $('importText').value = text; status('Copy is blocked here: the text is in the box above.', true); }); else { $('importText').value = text; status('The text is in the box above.', true); } }
  function later(fn) { status('Working…', true); setTimeout(fn, 30); }
  $('importBtn').addEventListener('click', function () { later(function () { importSafe($('importText').value); }); });
  $('importFile').addEventListener('change', function () { var fl = $('importFile').files[0]; if (!fl) return; fl.text().then(function (t) { later(function () { importSafe(t); }); }); });
  $('copyBtn').addEventListener('click', function () { var h = exportText(); if (h) copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
  $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'touch-and-go-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); status('Downloaded touch-and-go-handoff.json.', true); });
  $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + b64u(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (state.R && !state.R.refusal) render(); }, 150); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.R) render(); });

  state.S = K.defaults('chain'); syncControls(); checksTable();
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/), done = false;
  if (hash) { try { done = importText(unb64u(hash[1])); } catch (e) { status('Refused (invalid input): the link\'s handoff could not be read.', false); } }
  if (!done) run();
  window.TouchPage = { K: K, state: state, run: run, importText: importText, exportText: exportText, render: render };
})();
