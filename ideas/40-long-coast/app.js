/* Long Coast page: wires coast.js (and through it idea 39's kernel) to the controls, the charts and the handoff. */
(function () {
  'use strict';
  var K = LongCoast.create({
    LambertsRoad: window.LambertsRoad, constants: window.LambertAster, earth: window.LambertEarth, refs: window.LambertRefs,
    catalog: window.CoastCatalog, asterBodies: window.CoastAsterBodies, outerPlanets: window.CoastOuterPlanets, de440: window.CoastDE440,
    nav: window.CoastNav, erfa: window.WindowERFA, truth: window.CoastTruth
  });
  var K39 = K.k39, DAY = 86400, PRESETS = window.CoastPresets.list, TRUTH = window.CoastTruth;
  var $ = function (id) { return document.getElementById(id); };
  var st = { src: null, srcLabel: '', S: K.defaults(), R: null, presetKey: '99942', paths: {}, timer: null };

  // ------------------------------------------------------------------ formatting
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function f(v, d) { if (!num(v)) return '–'; var a = Math.abs(v); if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(Math.max(0, (d || 3) - 1)); return (+v.toPrecision(d || 3)).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
  function km(m, d) { return f(m / 1e3, d); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function utc(t) { return K39.utcOf(t).slice(0, 16).replace('T', ' '); }
  function tile(k, v, u, conf, sub, cls) { return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="k">' + k + '</div><div class="v">' + v + (u ? '<span class="u">' + u + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '<span class="c">' + conf + '</span></div>'; }

  // ------------------------------------------------------------------ controls
  function fillPresets() {
    $('presetSel').innerHTML = PRESETS.map(function (p) { return '<option value="' + esc(p.key) + '">' + esc(p.label) + '</option>'; }).join('') + '<option value="imported" disabled>Imported handoff</option>';
  }
  function tcmRows() {
    var S = st.S, html = '';
    for (var i = 0; i < 5; i++) {
      var m = S.tcms[i] || null, d = K.defaults().tcms[i];
      html += '<div class="tcmrow"><input type="checkbox" data-i="' + i + '" class="tOn" aria-label="Use TCM-' + (i + 1) + '"' + (m ? ' checked' : '') + '>' +
        '<span class="nm">TCM-' + (i + 1) + '</span>' +
        '<select class="tFrom" data-i="' + i + '" aria-label="TCM-' + (i + 1) + ' counted from"><option value="departure">after departure</option><option value="arrival">before arrival</option></select>' +
        '<input type="number" class="tDays" data-i="' + i + '" min="0.5" max="2000" step="0.5" inputmode="decimal" aria-label="TCM-' + (i + 1) + ' days" value="' + (m ? m.days : d.days) + '"></div>';
    }
    $('tcmRows').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.tFrom'), function (el) { var i = +el.dataset.i, m = S.tcms[i] || K.defaults().tcms[i]; el.value = m.from; });
  }
  function readTcms() {
    var out = [];
    for (var i = 0; i < 5; i++) {
      var on = document.querySelector('.tOn[data-i="' + i + '"]').checked, from = document.querySelector('.tFrom[data-i="' + i + '"]').value, days = parseFloat(document.querySelector('.tDays[data-i="' + i + '"]').value);
      if (on) out.push({ name: 'TCM-' + (i + 1), from: from, days: days });
    }
    return out;
  }
  function syncControls() {
    var S = st.S, N = S.nav;
    pressSeg('[data-aim]', 'aim', S.aim); pressSeg('[data-tgt]', 'tgt', S.target);
    $('fMoon').checked = S.force.moon; $('fPlanets').checked = S.force.planets; $('fJ2').checked = S.force.earthJ2; $('fGR').checked = S.force.relativity;
    $('srpIn').value = S.force.srp_m2_kg; $('srpRange').value = S.force.srp_m2_kg;
    $('navSel').value = N.preset; $('ppwIn').value = N.passesPerWeek; $('ppwRange').value = Math.min(14, N.passesPerWeek); $('ddorIn').value = N.ddorPerWeek; $('ddorRange').value = N.ddorPerWeek;
    $('dopIn').value = +(N.doppler_m_s * 1e3).toPrecision(4); $('rngIn').value = N.range_m; $('dorIn').value = N.ddor_ns; $('cutIn').value = N.cutoffDays; $('contDepIn').value = N.contDepDays; $('contArrIn').value = N.contArrDays;
    $('stoSel').value = String(N.stochastic_m_s2); if (!$('stoSel').value) { var o = document.createElement('option'); o.value = String(N.stochastic_m_s2); o.textContent = N.stochastic_m_s2 + ' m/s²'; $('stoSel').appendChild(o); $('stoSel').value = String(N.stochastic_m_s2); }
    $('injSel').value = S.injection; $('exeSel').value = S.execution;
    $('presetSel').value = st.presetKey;
    tcmRows();
  }
  function pressSeg(sel, key, val) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (b) { b.setAttribute('aria-pressed', String(b.dataset[key] === val)); }); }
  function readControls() {
    var S = st.S, N = S.nav;
    S.force.moon = $('fMoon').checked; S.force.planets = $('fPlanets').checked; S.force.earthJ2 = $('fJ2').checked; S.force.relativity = $('fGR').checked;
    S.force.srp_m2_kg = parseFloat($('srpIn').value);
    N.passesPerWeek = parseFloat($('ppwIn').value); N.ddorPerWeek = parseFloat($('ddorIn').value);
    N.doppler_m_s = parseFloat($('dopIn').value) / 1e3; N.range_m = parseFloat($('rngIn').value); N.ddor_ns = parseFloat($('dorIn').value);
    N.cutoffDays = parseFloat($('cutIn').value); N.contDepDays = parseFloat($('contDepIn').value); N.contArrDays = parseFloat($('contArrIn').value);
    N.stochastic_m_s2 = parseFloat($('stoSel').value);
    S.injection = $('injSel').value; S.execution = $('exeSel').value;
    S.tcms = readTcms();
    S.departure = $('depSel').value || 'auto';
  }
  function bind() {
    $('presetSel').addEventListener('change', function () { var v = this.value; if (v === 'imported') return; loadPreset(v); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-aim]'), function (b) { b.addEventListener('click', function () { st.S.aim = b.dataset.aim; pressSeg('[data-aim]', 'aim', st.S.aim); schedule(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tgt]'), function (b) { b.addEventListener('click', function () { st.S.target = b.dataset.tgt; pressSeg('[data-tgt]', 'tgt', st.S.target); schedule(); }); });
    ['fMoon', 'fPlanets', 'fJ2', 'fGR', 'injSel', 'exeSel', 'stoSel', 'depSel'].forEach(function (id) { $(id).addEventListener('change', function () { readControls(); schedule(); }); });
    [['srpIn', 'srpRange'], ['ppwIn', 'ppwRange'], ['ddorIn', 'ddorRange']].forEach(function (p) {
      $(p[1]).addEventListener('input', function () { $(p[0]).value = this.value; readControls(); schedule(); });
      $(p[0]).addEventListener('change', function () { $(p[1]).value = this.value; readControls(); schedule(); });
    });
    ['dopIn', 'rngIn', 'dorIn', 'cutIn', 'contDepIn', 'contArrIn'].forEach(function (id) { $(id).addEventListener('change', function () { readControls(); schedule(); }); });
    $('tcmRows').addEventListener('change', function () { readControls(); schedule(); });
    $('navSel').addEventListener('change', function () { var keep = { cutoffDays: st.S.nav.cutoffDays }; st.S.nav = K.navPreset(this.value); st.S.nav.cutoffDays = keep.cutoffDays; syncControls(); schedule(); });
    $('resetBtn').addEventListener('click', function () { st.S = K.defaults(); loadPreset('99942'); });
    $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'pasted'); });
    $('importFile').addEventListener('change', function () { var file = this.files && this.files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { doImport(String(rd.result), file.name); }; rd.readAsText(file); });
    $('copyBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
    $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'long-coast-handoff.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0); hoStatus('Downloaded long-coast-handoff.json.', 'ok'); });
    $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + b64u(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });
    $('apexBtn').addEventListener('click', function () { var b = this; b.disabled = true; b.textContent = 'Fitting…'; setTimeout(function () { try { st.apex = fitApex(); } finally { b.disabled = false; b.textContent = 'Fit sunlight on OSIRIS-APEX again'; } renderChecks(); }, 30); });
    var resize; window.addEventListener('resize', function () { clearTimeout(resize); resize = setTimeout(drawCharts, 120); });
    if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', drawCharts); }
  }

  // ------------------------------------------------------------------ sources: presets and imports
  function loadPreset(key) {
    var p = PRESETS.filter(function (q) { return q.key === key; })[0] || PRESETS[0];
    var h39 = K.lambertsRoadFrom(p.settings);
    if (h39.refusal) { showRefusalOnly(h39.refusal); return; }
    var src = K.importLambertsRoad(h39);
    if (src.refusal) { showRefusalOnly(src.refusal); return; }
    st.src = src; st.presetKey = p.key; st.srcLabel = 'Preset: ' + p.label + ' (' + p.chosen + '), made here by idea 39\'s kernel.'; st.R = null; st.paths = {};
    st.S.departure = 'auto';
    syncControls(); schedule(0);
  }
  function doImport(text, name) {
    var P = K.importLambertsRoad(text);
    if (P.refusal) { hoStatus('Refused: ' + P.refusal.reason + ' ' + (P.refusal.what_would_help || ''), 'bad'); return false; }
    if (P.from === '40-long-coast') { st.src = { h39: P.h39, R39: P.R39, targetFromCatalog: P.targetFromCatalog }; st.S = JSON.parse(JSON.stringify(P.settings)); st.R = P.R; }
    else { st.src = P; st.R = null; }
    st.paths = {}; st.presetKey = 'imported';
    var n = (st.src.h39.refusals || []).length;
    st.srcLabel = 'Imported (' + esc(name) + '): idea ' + (P.from === '40-long-coast' ? '40\'s handoff, recomputed and matched; inside it idea 39\'s,' : '39\'s handoff,') + ' checked by idea 39\'s own kernel; target ' + esc(st.src.R39.body.name) + (st.src.targetFromCatalog ? ' (Aster\'s elements, matched)' : ' (elements as idea 39 handed them)') + '; ' + n + ' refusals carried in.';
    hoStatus('Imported.', 'ok');
    syncControls();
    if (P.from === '40-long-coast') { render(); return true; }
    schedule(0);
    return true;
  }
  function exportText() {
    if (!st.R || st.R.refusal || !st.R.arrival) { hoStatus('Nothing to export: ' + (st.R && st.R.refusal ? st.R.refusal.reason : (st.R && st.R.refusals && st.R.refusals.length ? st.R.refusals[st.R.refusals.length - 1].reason : 'no cruise computed')), 'bad'); return null; }
    return JSON.stringify(K.buildHandoff(st.R));
  }
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function copy(text, msg) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); hoStatus(msg, 'ok'); } catch (e) { hoStatus('Copy failed; use Download.', 'bad'); } ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { hoStatus(msg, 'ok'); }, fallback); else fallback();
  }
  function hoStatus(t, cls) { var el = $('hoStatus'); el.textContent = t; el.className = 'status ' + (cls || ''); }

  // ------------------------------------------------------------------ compute
  function schedule(ms) {
    clearTimeout(st.timer);
    $('runNote').textContent = 'Computing…'; document.querySelector('main').classList.add('busy');
    st.timer = setTimeout(computeNow, ms === undefined ? 180 : ms);
  }
  function computeNow() {
    if (!st.src) return;
    var t0 = Date.now(), R;
    try { R = K.run(st.src, st.S, st.R && !st.R.refusal ? st.R : null); }
    catch (e) { R = { refusal: { code: 'not_found', reason: 'The computation failed: ' + e.message, what_would_help: 'Other settings.' } }; }
    st.R = R; st.ms = Date.now() - t0;
    render();
  }
  function render() {
    document.querySelector('main').classList.remove('busy');
    var R = st.R, S = st.S;
    $('srcLine').innerHTML = st.srcLabel;
    // the departure list follows what this transfer offers
    var opts = R && R.departureOptions ? R.departureOptions : ['patched_conic'], names = { patched_conic: 'Idea 39\'s v∞ from Aster\'s parking orbit (patched conic)', planned_37: 'Idea 37\'s planned departure', flown_38: 'The departure idea 38 flew' };
    $('depSel').innerHTML = '<option value="auto">Automatic (what the chain flew, else idea 39\'s)</option>' + opts.map(function (k) { return '<option value="' + k + '">' + names[k] + '</option>'; }).join('');
    $('depSel').value = opts.indexOf(S.departure) >= 0 ? S.departure : 'auto';
    $('runNote').textContent = st.ms ? 'Computed in ' + f(st.ms / 1000, 2) + ' s.' : '';
    if (!R || R.refusal) { showRefusalOnly(R ? R.refusal : null); return; }
    if (!R.arrival || !R.budget || !R.nav) {   // refused part-way: show why, and nothing left from an earlier run
      showRefusalOnly(null); $('refusals').innerHTML = R.refusals.filter(function (r) { return !r.from; }).map(refusalHtml).join('');
      return;
    }
    renderTiles(); renderRefusals(); renderTcmTable(); drawCharts(); renderChecks();
  }
  function showRefusalOnly(r) {
    document.querySelector('main').classList.remove('busy');
    $('tiles').innerHTML = ''; $('resLine').textContent = '';
    $('refusals').innerHTML = r ? refusalHtml(r) : '';
    $('carriedList').innerHTML = ''; $('carriedSum').textContent = 'Refusals carried from earlier modules';
    $('tcmTable').querySelector('tbody').innerHTML = '';
    ['uncChart', 'tcmChart', 'orbitChart', 'bpChart'].forEach(function (id) { var c = $(id), ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); });
    ['uncLegend', 'tcmLegend', 'orbitLegend', 'bpLegend'].forEach(function (id) { $(id).innerHTML = ''; });
    ['uncCap', 'orbitCap', 'bpCap'].forEach(function (id) { $(id).textContent = ''; });
    renderChecks();
  }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · from ' + esc(r.from) : '') + '</b>' + esc(r.reason) + (r.what_would_help ? '<div class="help">What would help: ' + esc(r.what_would_help) + '</div>' : '') + '</div>'; }

  // ------------------------------------------------------------------ tiles, refusals, table
  function renderTiles() {
    var R = st.R, tr = R.transfer, h = '';
    $('resLine').innerHTML = esc(R.body.name) + ': leaves ' + esc(utc(R.departure.tdb)) + ' UTC, arrives ' + esc(utc(tr.arrTdb)) + ' UTC (' + f(tr.tofS / DAY, 4) + ' days, ' + (tr.M ? tr.M + ' revolution' : 'direct') + '). Departure: ' + esc(R.departure.label) + '.';
    if (!R.arrival) { $('tiles').innerHTML = ''; return; }
    if (R.reaim) h += tile('Re-aimed injection: v∞ moves', f(R.reaim.dvinf_m_s, 4), 'm/s', 'derived', 'periapsis speed ' + (R.reaim.periapsisSpeedChange_m_s >= 0 ? '+' : '') + f(R.reaim.periapsisSpeedChange_m_s, 3) + ' m/s; C3 ' + f(R.reaim.c3 / 1e6, 4) + ' km²/s² (39: ' + f(tr.sol.c3 / 1e6, 4) + '); DLA ' + f(R.reaim.dla, 4) + '°<span class="band ' + R.reaim.band + '">' + R.reaim.band + '</span>; RLA ' + f(R.reaim.rla, 4) + '°', 'hero');
    h += tile('TCM-1 if the departure is flown as given', R.tcm1AsGiven ? f(R.tcm1AsGiven.dv_m_s, 4) : 'refused', R.tcm1AsGiven ? 'm/s' : '', 'derived', R.tcm1AsGiven ? 'deterministic, at ' + esc(utc(R.tcm1AsGiven.tdb)) : 'the targeting from there does not converge', R.tcm1AsGiven ? '' : 'refused');
    h += tile('Flown as given, uncorrected, it misses by', f(R.uncorrected.missAtArrival_m / 1e9, 3), 'million km', 'derived', 'idea 39\'s patched conic through every force');
    h += tile('Kepler\'s asteroid is off by', km(R.target.shift_m, 3), 'km', 'derived', 'two-body vs n-body from Aster\'s elements, at arrival');
    h += tile('TCM budget, sum of 99th percentiles', f(R.budget.totalP99_m_s, 4), 'm/s', 'derived', 'mean ' + f(R.budget.totalMean_m_s, 3) + ' m/s; deterministic ' + f(R.budget.totalDeterministic_m_s, 4) + ' m/s; ' + R.budget.rows.length + ' TCMs', 'hero');
    var D = R.delivery;
    h += tile('Delivery, 3σ on the approach plane', km(D.dispersion.semiMajor3s_m, 3) + ' × ' + km(D.dispersion.semiMinor3s_m, 3), 'km', 'derived', 'along track ' + km(D.dispersion.along3s_m, 3) + ' km (' + f(D.dispersion.time3s_s, 3) + ' s of arrival time)');
    h += tile('Knowledge at arrival, 3σ', km(D.knowledge.semiMajor3s_m, 3) + ' × ' + km(D.knowledge.semiMinor3s_m, 3), 'km', 'derived', 'along track ' + km(D.knowledge.along3s_m, 3) + ' km');
    h += tile('Arrival v∞ (n-body)', f(Math.hypot.apply(null, R.arrival.vinf) / 1e3, 4), 'km/s', 'derived', 'idea 39: ' + f(tr.sol.vInfArr / 1e3, 4) + ' km/s');
    var c = R.nav.counts;
    h += tile('Tracking used', c.doppler + ' / ' + c.range + ' / ' + c.ddor, '', 'assumed', 'Doppler / range / Delta-DOR points (' + esc(st.S.nav.preset) + '); ' + c.ddorSkipped + ' Delta-DOR baselines without common sky');
    $('tiles').innerHTML = h;
  }
  function renderRefusals() {
    var own = st.R.refusals.filter(function (r) { return !r.from; }), car = st.R.refusals.filter(function (r) { return r.from; });
    $('refusals').innerHTML = own.map(refusalHtml).join('');
    $('carriedSum').textContent = car.length + ' refusals carried from earlier modules (idea 39\'s dynamics and idea 38\'s post-cutoff are lifted here)';
    $('carriedList').innerHTML = car.map(refusalHtml).join('');
  }
  function renderTcmTable() {
    var B = st.R.budget;
    $('tcmTable').querySelector('tbody').innerHTML = B.rows.map(function (r) {
      return '<tr><td data-k="TCM">' + esc(r.name) + '</td><td data-k="When">' + esc(utc(r.tdb)) + '</td><td class="n" data-k="Deterministic">' + f(r.deterministic_m_s, 4) + ' m/s</td><td class="n" data-k="Mean">' + f(r.mean_m_s, 3) + ' m/s</td><td class="n" data-k="99 %">' + f(r.p99_m_s, 3) + ' m/s</td><td class="n" data-k="Knowledge 1σ">' + km(r.knowledgePos_m, 3) + ' km</td></tr>';
    }).join('') + '<tr><td data-k="Total"><b>Total</b></td><td></td><td class="n" data-k="Deterministic">' + f(B.totalDeterministic_m_s, 4) + ' m/s</td><td class="n" data-k="Mean">' + f(B.totalMean_m_s, 3) + ' m/s</td><td class="n" data-k="99 %"><b>' + f(B.totalP99_m_s, 4) + ' m/s</b></td><td></td></tr>';
  }

  // ------------------------------------------------------------------ charts
  function canvasFor(id, aspect, minH) {
    var c = $(id), w = c.clientWidth || c.parentNode.clientWidth || 300, h = Math.max(minH || 200, Math.round(w * aspect)), dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key' + (it.cls ? ' ' + it.cls : '') + '" style="' + (it.cls === 'dot' || it.cls === 'band' ? 'background:' : 'border-color:') + it.c + '"></span>' + esc(it.t) + '</li>'; }).join(''); }
  function decade(e) { var v = Math.pow(10, e); return e >= 6 ? '1e' + e : (e >= 0 ? v.toLocaleString('en-US') : String(+v.toPrecision(1))); }
  function drawCharts() { if (!st.R || st.R.refusal || !st.R.nav || !st.R.budget) return; drawUnc(); drawTcm(); drawOrbit(); drawBp(); }
  function axisText(ctx, s, x, y, align, base) { ctx.fillStyle = css('--ink-2'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = align || 'left'; ctx.textBaseline = base || 'alphabetic'; ctx.fillText(s, x, y); }
  function drawUnc() {
    var R = st.R, H = R.nav.history, t0 = R.reference.T[0], tA = R.arrival.tdb, g = canvasFor('uncChart', 0.55, 270), ctx = g.ctx;
    var L = 46, Rm = 10, T = 20, B = 28, W = g.w - L - Rm, Hh = g.h - T - B;
    var series = [['knowledge_m', css('--s1'), 'Knowledge now (1σ, RSS)'], ['knowledgeAtArrival_m', css('--s3'), 'Knowledge mapped to the arrival'], ['dispersionAtArrival_m', css('--s2'), 'Dispersion mapped to the arrival']];
    var lo = Infinity, hi = -Infinity;
    H.forEach(function (p) { series.forEach(function (s) { var v = p[s[0]] / 1e3; if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    lo = Math.pow(10, Math.floor(Math.log10(Math.max(lo, 1e-3)))); hi = Math.pow(10, Math.ceil(Math.log10(hi)));
    var X = function (t) { return L + (t - t0) / (tA - t0) * W; }, Y = function (v) { return T + (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * Hh; };
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    var dec = Math.log10(hi) - Math.log10(lo), every = Hh / dec < 20 ? 2 : 1;
    for (var e = Math.log10(lo); e <= Math.log10(hi); e++) { var y = Y(Math.pow(10, e)); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); if ((e - Math.log10(lo)) % every === 0) axisText(ctx, decade(e), L - 4, y + 4, 'right'); }
    var span = (tA - t0) / DAY, step = span > 400 ? 100 : (span > 150 ? 50 : 20);
    for (var dd = 0; dd <= span; dd += step) { var x = X(t0 + dd * DAY); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + Hh); ctx.stroke(); axisText(ctx, String(dd), x, T + Hh + 14, 'center'); }
    axisText(ctx, 'days since departure', L + W, T + Hh + 26, 'right'); axisText(ctx, 'km', 4, 12);
    R.tcms.forEach(function (m) { var x = X(m.tdb); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + Hh); ctx.stroke(); ctx.setLineDash([]); });
    series.forEach(function (s) { ctx.strokeStyle = s[1]; ctx.lineWidth = 1.8; ctx.beginPath(); H.forEach(function (p, i) { var v = p[s[0]] / 1e3, x = X(p.tdb), y = Y(v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); });
    legend('uncLegend', series.map(function (s) { return { c: s[1], t: s[2] }; }).concat([{ c: css('--muted'), t: 'TCMs', cls: 'dash' }]));
    var last = H[H.length - 1];
    $('uncCap').textContent = 'Position, 1σ root-sum-square of three axes. At arrival the knowledge is ' + km(last.knowledge_m, 3) + ' km and the trajectory\'s spread ' + km(last.dispersion_m, 3) + ' km (1σ RSS). Each TCM cuts the dispersion to what was known when it was designed, plus its own execution error; tracking cuts the knowledge.';
  }
  function drawTcm() {
    var B = st.R.budget.rows, g = canvasFor('tcmChart', 0.42, 200), ctx = g.ctx, L = 46, Rm = 8, T = 20, Bm = 26, W = g.w - L - Rm, Hh = g.h - T - Bm;
    if (!B.length) { legend('tcmLegend', []); return; }
    var vals = []; B.forEach(function (r) { vals.push(r.p99_m_s, r.mean_m_s, r.deterministic_m_s); });
    var pos = vals.filter(function (v) { return v > 0; }), lo = Math.pow(10, Math.floor(Math.log10(Math.min.apply(null, pos.length ? pos : [1e-3])))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max.apply(null, pos.length ? pos : [1]))));
    if (hi <= lo) hi = lo * 10;
    var Y = function (v) { return T + (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * Hh; };
    ctx.strokeStyle = css('--grid');
    for (var e = Math.log10(lo); e <= Math.log10(hi); e++) { var y = Y(Math.pow(10, e)); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); axisText(ctx, decade(e), L - 4, y + 4, 'right'); }
    axisText(ctx, 'm/s', 4, 12);
    var gw = W / B.length, bw = Math.min(26, gw / 4);
    B.forEach(function (r, i) {
      var cx = L + gw * (i + 0.5);
      [[r.deterministic_m_s, css('--s3'), -1], [r.mean_m_s, css('--s1'), 0], [r.p99_m_s, css('--s2'), 1]].forEach(function (b) {
        if (!(b[0] > 0)) return; var x = cx + b[2] * (bw + 2) - bw / 2, y = Y(b[0]); ctx.fillStyle = b[1]; ctx.fillRect(x, y, bw, T + Hh - y);
      });
      axisText(ctx, r.name, cx, T + Hh + 14, 'center');
    });
    legend('tcmLegend', [{ c: css('--s3'), t: 'Deterministic', cls: 'band' }, { c: css('--s1'), t: 'Mean', cls: 'band' }, { c: css('--s2'), t: '99th percentile', cls: 'band' }]);
  }
  function pathsFor(R) {
    var key = JSON.stringify([st.src.h39.produced, R.transfer.depTdb, R.departure.key, st.S.force]);
    if (st.paths.key === key) return st.paths;
    var fm = K.forceModel(st.S.force), n = 120, t0 = R.departure.tdb, tA = R.arrival.tdb, earth = [], unc = [], tgt = [];
    var x = K.helio(R.departure), b = R.body, t0b = K39.jdTdbToTdb(b.elements.epochTdbJd), A = K39.bodyState(b, t0b), a = A.r.concat(A.v), ta = t0b;
    for (var i = 0; i <= n; i++) {
      var t = t0 + (tA - t0) * i / n, E = K39.earthState(t); earth.push(E.r);
      if (i) { var p = K.propagate(x, t0 + (tA - t0) * (i - 1) / n, t, fm); if (p.refusal) break; x = p.x; }
      unc.push(x.slice(0, 3));
      var q = K.propagate(a, ta, t, K.forceModel(Object.assign({}, st.S.force, { srp_m2_kg: 0 }))); if (!q.refusal) { a = q.x; ta = t; tgt.push(a.slice(0, 3)); }
    }
    st.paths = { key: key, earth: earth, unc: unc, tgt: tgt };
    return st.paths;
  }
  function drawOrbit() {
    var R = st.R, P = pathsFor(R), g = canvasFor('orbitChart', 0.8, 260), ctx = g.ctx, ecl = K39.toEcliptic;
    var ref = R.reference.X.filter(function (x, i) { return i % 12 === 0; }).map(function (x) { return x.slice(0, 3); });
    var all = [].concat(P.earth, P.tgt, ref), m = 0; all.forEach(function (p) { var e = ecl(p); m = Math.max(m, Math.abs(e[0]), Math.abs(e[1])); });
    var unc = P.unc.filter(function (p) { var e = ecl(p); return Math.abs(e[0]) < 1.6 * m && Math.abs(e[1]) < 1.6 * m; });
    var sc = Math.min(g.w, g.h) / 2 / (m * 1.08), cx = g.w / 2, cy = g.h / 2;
    var X = function (p) { var e = ecl(p); return [cx + e[0] * sc, cy - e[1] * sc]; };
    function line(pts, col, w, dash) { if (pts.length < 2) return; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); pts.forEach(function (p, i) { var q = X(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = css('--warn'); ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 2 * Math.PI); ctx.fill();
    line(P.earth, css('--s1'), 1.2); line(P.tgt, css('--muted'), 1.2); line(unc, css('--s2'), 1.4, [5, 4]); line(ref, css('--ink'), 2);
    R.tcms.forEach(function (mm) { var k = R.reference.T.indexOf(mm.tdb); if (k < 0) return; var q = X(R.reference.X[k]); ctx.fillStyle = css('--s3'); ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 2 * Math.PI); ctx.fill(); });
    var qa = X(R.arrival.r); ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(qa[0], qa[1], 5, 0, 2 * Math.PI); ctx.stroke();
    legend('orbitLegend', [{ c: css('--ink'), t: 'The cruise, flown and corrected' }, { c: css('--s2'), t: 'Idea 39\'s departure, uncorrected', cls: 'dash' }, { c: css('--s1'), t: 'Earth' }, { c: css('--muted'), t: R.body.name.split(' (')[0] }, { c: css('--s3'), t: 'TCMs', cls: 'dot' }]);
    $('orbitCap').textContent = 'Ecliptic J2000, Sun at the centre, ' + f(m / K.constants.au_m, 3) + ' au to the edge. The uncorrected path is drawn while it stays in view.';
  }
  function drawBp() {
    var D = st.R.delivery, g = canvasFor('bpChart', 0.6, 220), ctx = g.ctx, cx = g.w / 2, cy = g.h / 2;
    var m = Math.max(D.dispersion.semiMajor3s_m, D.knowledge.semiMajor3s_m, 1), sc = Math.min(g.w, g.h) / 2 / (m * 1.15);
    ctx.strokeStyle = css('--grid'); ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(g.w - 10, cy); ctx.moveTo(cx, 10); ctx.lineTo(cx, g.h - 10); ctx.stroke();
    axisText(ctx, 'T (ecliptic)', g.w - 10, cy - 6, 'right'); axisText(ctx, 'R', cx + 6, 18);
    function ell(E, col, dash) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash || []); ctx.beginPath(); for (var i = 0; i <= 96; i++) { var a = 2 * Math.PI * i / 96, th = E.thetaDeg * Math.PI / 180, x = E.semiMajor3s_m * Math.cos(a), y = E.semiMinor3s_m * Math.sin(a); var u = x * Math.cos(th) - y * Math.sin(th), v = x * Math.sin(th) + y * Math.cos(th); if (i) ctx.lineTo(cx + u * sc, cy - v * sc); else ctx.moveTo(cx + u * sc, cy - v * sc); } ctx.stroke(); ctx.setLineDash([]); }
    ell(D.dispersion, css('--s2')); ell(D.knowledge, css('--s1'), [5, 4]);
    ctx.fillStyle = css('--ink'); ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
    legend('bpLegend', [{ c: css('--s2'), t: 'Delivery dispersion, 3σ' }, { c: css('--s1'), t: 'Knowledge at arrival, 3σ', cls: 'dash' }]);
    $('bpCap').textContent = 'Plane across the arrival v∞ (S), T in the ecliptic, R completing it; ' + km(m * 2.3, 2) + ' km across. The point is where the spacecraft is aimed: the asteroid itself here, a stand-off is module 42\'s.';
  }

  // ------------------------------------------------------------------ oracle checks
  function stOf(row) { return { t: (row[0] - 2451545) * DAY, x: row.slice(1).map(function (v) { return v * 1000; }) }; }
  function d3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  var checksCache = null;
  function baseChecks() {
    if (checksCache) return checksCache;
    var fm = K.forceModel(), rows = [];
    Object.keys(TRUTH.bodies).forEach(function (des) {
      var B = TRUTH.bodies[des], a = stOf(B.states['2026-Jul-02']), b = stOf(B.states['2028-May-10']), p = K.propagate(a.x, a.t, b.t, fm), gap = d3(p.x, b.x);
      rows.push(['<b>' + esc(B.name) + '</b><span class="why">from Horizons\' state on 2026-07-02 to 2028-05-10 (678 days), this page\'s forces; JPL\'s solution ' + esc(B.solution || '') + (B.smallPerturbers ? ', with ' + esc(B.smallPerturbers) + ' asteroid perturbers' : '') + (B.nongrav && (B.nongrav.A1_au_d2 || B.nongrav.A2_au_d2) ? ' and Yarkovsky' : '') + '</span>', 'Horizons position', 'n-body here', km(gap, 3) + ' km', gap < 5e3]);
      var cat = K39.bodies.list.filter(function (q) { return q.designation === des; })[0];
      if (cat) { var nb = K.targetState(cat, b.t, fm, 'nbody'), tb = K.targetState(cat, b.t, fm, 'two_body'); rows.push(['<b>' + esc(B.name) + ' from Aster\'s elements</b><span class="why">Aster\'s catalog elements (epoch 2026-05-01) integrated here, against Horizons on 2028-05-10; two-body (idea 39) beside it</span>', 'Horizons position', 'n-body ' + km(d3(nb.r, b.x), 3) + ' km; two-body ' + km(d3(tb.r, b.x), 4) + ' km', km(d3(nb.r, b.x), 3) + ' km', d3(nb.r, b.x) < 1e4]); }
    });
    var A = TRUTH.apophis2029.daily, s0 = stOf(A['2029-03-01']), s1 = stOf(A['2029-05-01']), p2 = K.propagate(s0.x, s0.t, s1.t, fm), gap2 = d3(p2.x, s1.x);
    rows.push(['<b>Apophis through its 2029 encounter</b><span class="why">2029-03-01 to 2029-05-01, across the 13 April pass at 38,000 km</span>', 'Horizons position', 'n-body here', km(gap2, 3) + ' km', gap2 < 1e4]);
    var Mo = window.CoastAsterBodies.bodies.moon.fit.hourlyHorizons;
    rows.push(['<b>The Moon\'s Chebyshev fit</b><span class="why">fitted to Aster\'s daily records; worst against hourly Horizons in two 30-day windows (2026, 2035)</span>', 'Horizons hourly', 'Chebyshev', km(Math.max(Mo['2026'].maxPos_m, Mo['2035'].maxPos_m), 2) + ' km', true]);
    checksCache = rows;
    return rows;
  }
  function fitApex() {
    var A = TRUTH.osirisApex.arcs;
    function walk(rows, k) { var fm = K.forceModel({ srp_m2_kg: k, cr: 1 }), s = stOf(rows[0]), x = s.x, t = s.t, w = 0; for (var i = 1; i < rows.length; i++) { var b = stOf(rows[i]), p = K.propagate(x, t, b.t, fm); x = p.x; t = b.t; w = Math.max(w, d3(p.x, b.x)); } return w; }
    var lo = 0, hi = 0.05, gr = (Math.sqrt(5) - 1) / 2;
    for (var i = 0; i < 26; i++) { var m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo); if (walk(A.fit, m1) < walk(A.fit, m2)) hi = m2; else lo = m1; }
    var k = (lo + hi) / 2;
    return { k: k, noSun1: walk(A.fit, 0), fit1: walk(A.fit, k), noSun2: walk(A.check, 0), fit2: walk(A.check, k) };
  }
  function renderChecks() {
    var rows = baseChecks().slice();
    if (st.apex) {
      var a = st.apex;
      rows.push(['<b>OSIRIS-APEX, 2026-06-10 to 12-27</b><span class="why">JPL\'s predict (' + esc(TRUTH.osirisApex.trajectory) + '), worst over the arc; sunlight fitted here: Cr A/m = ' + f(a.k, 3) + ' m²/kg</span>', 'Horizons position', 'no sunlight ' + km(a.noSun1, 3) + ' km; fitted ' + km(a.fit1, 3) + ' km', km(a.fit1, 3) + ' km', a.fit1 < 1e6]);
      rows.push(['<b>OSIRIS-APEX, 2027-06-25 to 2028-05-10</b><span class="why">the same fitted number carried to another arc, unfitted</span>', 'Horizons position', 'no sunlight ' + km(a.noSun2, 3) + ' km; fitted ' + km(a.fit2, 3) + ' km', km(a.fit2, 3) + ' km', a.fit2 < 3e6]);
    }
    $('checkTable').querySelector('tbody').innerHTML = rows.map(function (r) { return '<tr><td data-k="Check">' + r[0] + '</td><td data-k="JPL">' + r[1] + '</td><td data-k="This page">' + r[2] + '</td><td class="n ' + (r[4] ? 'gap-ok' : 'gap-bad') + '" data-k="Gap">' + r[3] + '</td></tr>'; }).join('');
  }

  // ------------------------------------------------------------------ start
  fillPresets(); bind(); syncControls();
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/);
  if (hash) { var ok = false; try { ok = doImport(unb64u(hash[1]), 'link'); } catch (e) { hoStatus('The link\'s handoff could not be read.', 'bad'); } if (!ok) loadPreset('99942'); }
  else loadPreset('99942');
  window.LongCoastPage = { K: K, state: st, doImport: doImport, exportText: exportText, loadPreset: loadPreset, computeNow: computeNow };
})();
