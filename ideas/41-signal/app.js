/* Signal page: wires signal.js (and through it ideas 40's and 39's kernels) to the controls, the charts and the handoff. */
(function () {
  'use strict';
  var K40 = LongCoast.create({
    LambertsRoad: window.LambertsRoad, constants: window.LambertAster, earth: window.LambertEarth, refs: window.LambertRefs,
    catalog: window.CoastCatalog, asterBodies: window.CoastAsterBodies, outerPlanets: window.CoastOuterPlanets, de440: window.CoastDE440,
    nav: window.CoastNav, erfa: window.WindowERFA
  });
  var K = Signal.create({ K40: K40, dsn: window.SignalDSN, craft: window.SignalCraft, presets40: window.CoastPresets });
  var K39 = K.k39, DAY = 86400, HZ = window.SignalHorizons, AU = K.AU, C = K.C, PRESETS = window.CoastPresets.list, CRAFT = K.craft.presets;
  var $ = function (id) { return document.getElementById(id); };
  var st = { src: null, srcLabel: '', presetKey: '99942', S: null, R: null, day: 0, timer: null, oracles: null, oraclesFor: null };

  // ------------------------------------------------------------------ formatting
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function f(v, d) { if (!num(v)) return '–'; var a = Math.abs(v); if (a !== 0 && (a >= 1e7 || a < 1e-3)) return v.toExponential(Math.max(0, (d || 3) - 1)); return (+v.toPrecision(d || 3)).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
  function fx(v, n) { if (!num(v)) return '–'; var t = v.toFixed(n); return /^-0\.?0*$/.test(t) ? t.slice(1) : t; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function rate(b) { if (!num(b)) return '–'; if (b === 0) return '0'; return b >= 1e6 ? f(b / 1e6, 3) + ' Mbps' : b >= 1e3 ? f(b / 1e3, 4) + ' kbps' : f(b, 3) + ' bps'; }
  function bits(b) { return b >= 8e12 ? f(b / 8e12, 3) + ' TB' : b >= 8e9 ? f(b / 8e9, 3) + ' GB' : f(b / 8e6, 3) + ' MB'; }
  function mins(s) { return f(s / 60, 4); }
  function tile(k, v, u, conf, sub, cls) { return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="k">' + k + '</div><div class="v">' + v + (u ? '<span class="u">' + u + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '<span class="c">' + conf + '</span></div>'; }

  // ------------------------------------------------------------------ controls
  $('presetSel').innerHTML = PRESETS.map(function (p) { return '<option value="' + esc(p.key) + '">' + esc(p.label) + '</option>'; }).join('') + '<option value="imported" disabled>Imported handoff</option>';
  $('craftSel').innerHTML = Object.keys(CRAFT).map(function (k) { return '<option value="' + k + '">' + esc(CRAFT[k].name) + '</option>'; }).join('');
  var PMIN = 0.5, PMAX = 200;
  function powToU(p) { return Math.log(p / PMIN) / Math.log(PMAX / PMIN); }
  function uToPow(u) { return +(PMIN * Math.pow(PMAX / PMIN, u)).toPrecision(3); }
  function press(sel, key, val) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (b) { b.setAttribute('aria-pressed', String(b.dataset[key] === val)); }); }
  function sync() {
    var S = st.S;
    $('presetSel').value = st.presetKey; $('stayIn').value = S.stayDays; $('stayRange').value = Math.min(900, S.stayDays);
    $('craftSel').value = S.craft; $('powIn').value = S.power_W; $('powRange').value = Math.max(0, Math.min(1, powToU(S.power_W)));
    $('diaIn').value = S.diameter_m; $('diaRange').value = S.diameter_m; $('rngChk').checked = S.ranging; $('ptgIn').value = S.scPointLoss_dB;
    press('[data-band]', 'band', S.band); press('[data-rate]', 'rate', S.rateMode); press('[data-ant]', 'ant', S.antenna);
    $('cdSel').value = String(S.cd); $('marIn').value = S.margin_dB; $('elIn').value = S.elMin_deg; $('ppwIn').value = S.passesPerWeek; $('phIn').value = S.passHours;
  }
  function numOf(id) { var v = parseFloat($(id).value); return num(v) ? v : NaN; }
  function read() {
    var S = st.S;
    S.stayDays = Math.round(numOf('stayIn')); S.power_W = numOf('powIn'); S.diameter_m = numOf('diaIn'); S.ranging = $('rngChk').checked; S.scPointLoss_dB = numOf('ptgIn');
    S.cd = parseFloat($('cdSel').value); S.margin_dB = numOf('marIn'); S.elMin_deg = numOf('elIn'); S.passesPerWeek = numOf('ppwIn'); S.passHours = numOf('phIn');
  }
  function later(ms) { clearTimeout(st.timer); st.timer = setTimeout(compute, ms === undefined ? 150 : ms); }
  ['stayIn', 'powIn', 'diaIn', 'ptgIn', 'marIn', 'elIn', 'ppwIn', 'phIn'].forEach(function (id) { $(id).addEventListener('input', function () { read(); later(250); }); });
  ['rngChk', 'cdSel'].forEach(function (id) { $(id).addEventListener('change', function () { read(); later(0); }); });
  $('stayRange').addEventListener('input', function () { $('stayIn').value = this.value; read(); later(); });
  $('powRange').addEventListener('input', function () { $('powIn').value = uToPow(+this.value); read(); later(); });
  $('diaRange').addEventListener('input', function () { $('diaIn').value = (+this.value).toFixed(2); read(); later(); });
  $('craftSel').addEventListener('change', function () { var keep = st.S; st.S = K.defaults(this.value, navOf()); ['stayDays', 'band', 'antenna', 'cd', 'elMin_deg', 'margin_dB', 'passHours', 'passesPerWeek', 'rateMode'].forEach(function (k) { st.S[k] = keep[k]; }); sync(); later(0); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-band]'), function (b) { b.addEventListener('click', function () { st.S.band = b.dataset.band; if (st.S.band === 'Ka') st.S.antenna = '34m'; sync(); later(0); }); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-rate]'), function (b) { b.addEventListener('click', function () { st.S.rateMode = b.dataset.rate; sync(); later(0); }); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ant]'), function (b) { b.addEventListener('click', function () { st.S.antenna = b.dataset.ant; if (st.S.antenna === '70m') st.S.band = 'X'; sync(); later(0); }); });
  $('presetSel').addEventListener('change', function () { loadPreset(this.value); });
  $('resetBtn').addEventListener('click', function () { st.S = K.defaults('dawn', navOf()); sync(); later(0); });
  $('dayRange').addEventListener('input', function () { st.day = +this.value; renderDay(); drawCharts(); });
  function navOf() { return st.src && st.src.R40 ? st.src.R40.S.nav : null; }

  // ------------------------------------------------------------------ the run
  function busy(on, msg) { document.querySelector('main').classList.toggle('busy', on); $('runNote').textContent = msg || ''; }
  function loadPreset(key) {
    busy(true, 'Idea 39 is picking the transfer and idea 40 is flying it…');
    setTimeout(function () {
      var s = K.fromPreset(key);
      if (s.refusal) { busy(false, 'Refused: ' + s.refusal.reason); return; }
      st.src = s; st.presetKey = key; st.srcLabel = 'Preset: ' + PRESETS.filter(function (p) { return p.key === key; })[0].label + ' (idea 40\'s defaults).';
      if (!st.S) st.S = K.defaults('dawn', navOf());
      sync(); compute();
    }, 20);
  }
  function compute() {
    if (!st.src) return;
    busy(true, 'Listening…');
    var t0 = Date.now(), R = K.run(st.src, st.S);
    st.R = R;
    var A = R.arrival;
    if (!R.refusal) st.day = A && A.day ? R.days.indexOf(A.day) : 0;
    render();
    busy(false, R.refusal ? '' : R.days.length + ' days in ' + (Date.now() - t0) + ' ms.');
    if (!R.refusal && st.oraclesFor !== st.src) setTimeout(renderOracles, 30);
  }

  // ------------------------------------------------------------------ results
  function render() {
    var R = st.R;
    $('srcLine').textContent = st.srcLabel;
    if (R.refusal) {
      $('tiles').innerHTML = ''; $('resLine').textContent = '';
      $('refusals').innerHTML = refusalHtml(R.refusal); $('carriedList').innerHTML = ''; $('carriedSum').textContent = 'Refusals carried from earlier modules';
      ['dctTable', 'rateTable', 'conjTable'].forEach(function (id) { $(id).querySelector('tbody').innerHTML = ''; });
      drawCharts(); return;
    }
    var A = R.arrival, T = R.totals, rd = R.radio, L = A && A.dct ? A.dct.lines : null, b = A && A.dct ? A.dct.best : null, wk = T.passes_per_week * T.pass_hours * 3600;
    $('resLine').innerHTML = esc(rd.name) + ' radio, ' + rd.band + ' band, ' + f(rd.power_W, 3) + ' W into a ' + f(rd.diameter_m, 3) + ' m dish (' + f(rd.gain_dBi, 4) + ' dBi), ' + esc(rd.code) + '; ' + (R.S.antenna === '34m' ? '34-m BWG' : '70-m') + ' antennas, weather CD ' + R.S.cd + ', ' + R.S.passesPerWeek + ' passes of ' + R.S.passHours + ' h a week.';
    var h = '';
    if (A) {
      h += tile('Distance at arrival', f(A.range_m / AU, 4), 'au', 'derived', f(A.range_m / 1e9, 4) + ' million km', 'hero');
      h += tile('One-way light time', mins(A.owlt_s), 'min', 'derived', 'news of arrival reaches Earth ' + K39.utcOf(A.received_tdb).slice(11, 16) + ' UTC');
      h += tile('Command round trip', mins(A.rtlt_s), 'min', 'derived', 'up-leg then down-leg');
      h += tile('Sun-Earth-probe angle', f(A.sep_deg, 3), '°', 'derived');
    }
    if (L) {
      h += tile('Pt/No at arrival', f(L.ptn0_dBHz, 4), 'dB-Hz', 'derived', A.dct.station + ' at ' + f(A.dct.elevation_deg, 3) + '° elevation');
      h += tile('Data rate at arrival', b ? rate(b.bps) : 'none', '', 'derived', b ? f(b.margin_dB, 3) + ' dB margin' + (b.decoderCapped ? ', decoder limit' : '') : 'no rate closes', b ? 'hero' : 'bad');
      h += tile('Data per pass', b ? bits(b.bps * A.day.passHours * 3600) : '–', '', 'derived', f(A.day.passHours, 3) + ' h pass');
      h += tile('Data a week at arrival', b ? bits(b.bps * wk) : '–', '', 'derived', T.passes_per_week + ' × ' + T.pass_hours + ' h');
    } else h += tile('Link at arrival', 'refused', '', 'refused', 'see below', 'refused');
    h += tile('Cruise data', bits(T.cruise_bits), '', 'derived', T.cruise_days + ' days');
    h += tile('Stay data', bits(T.stay_bits), '', 'derived', T.stay_days + ' days at the asteroid');
    h += tile('Blacked-out days', String(T.blackout_days), '', 'derived', 'scintillation m ≥ 0.3 at ' + rd.band, T.blackout_days ? 'bad' : '');
    h += tile('Receiver overload days', String(T.saturation_days), '', 'derived', '> ' + String(K.maxRxOf(R.S.antenna === '70m' ? 70 : 34)).replace('-', '−') + ' dBm into a ' + (R.S.antenna === '70m' ? '70-m' : '34-m'), T.saturation_days ? 'bad' : '');
    $('tiles').innerHTML = h;
    var own = R.refusals.filter(function (r) { return !r.from; }), carried = R.refusals.filter(function (r) { return r.from; });
    $('refusals').innerHTML = own.map(refusalHtml).join('');
    $('carriedSum').textContent = carried.length + ' refusals carried from earlier modules';
    $('carriedList').innerHTML = carried.map(refusalHtml).join('');
    $('dayRange').max = R.days.length - 1; $('dayRange').value = st.day;
    renderDay(); renderConj(); drawCharts();
  }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc((r.from ? r.from + ': ' : '') + r.code + (r.applies_to ? ' (' + r.applies_to + ')' : '')) + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  function row(k, v, u, from, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td data-k="Line">' + k + '</td><td class="n" data-k="Value">' + v + '</td><td data-k="Unit">' + u + '</td><td data-k="From">' + from + '</td></tr>'; }
  function renderDay() {
    var R = st.R, d = R.days[st.day], tb = $('dctTable').querySelector('tbody'), rt = $('rateTable').querySelector('tbody');
    if (!d) { tb.innerHTML = ''; rt.innerHTML = ''; return; }
    $('dayLabel').textContent = d.utc + ' · ' + d.phase + (d.station ? ' · ' + d.station + ' ' + f(d.passHours, 3) + ' h' : '') + ' · ' + d.status;
    var lb = K.dayLink(R, st.day);
    if (!lb || lb.refusal) { tb.innerHTML = row('No link', lb && lb.refusal ? esc(lb.refusal.reason) : 'no complex sees it above the limit', '', ''); rt.innerHTML = ''; return; }
    var L = lb.lines, rd = R.radio, b = lb.best || lb.rows[lb.rows.length - 1], sp = K.suppression(rd, b.modDeg), P = CRAFT[rd.key];
    var h = row('Transmitter power', fx(L.Pt_dBm, 2), 'dBm', f(rd.power_W, 3) + ' W') + row('Circuit loss', fx(L.circuit_dB, 2), 'dB', P.article) + row('Antenna gain', fx(L.scGain_dBi, 2), 'dBi', f(rd.diameter_m, 3) + ' m, ' + f(rd.f_Hz / 1e6, 7) + ' MHz') + row('Pointing loss', fx(L.scPoint_dB, 2), 'dB', 'set') + row('EIRP', fx(L.eirp_dBm, 2), 'dBm', 'sum', 'hl');
    h += row('Range', Math.round(d.range_m / 1e3).toLocaleString('en-US'), 'km', 'idea 40 + light time') + row('Space loss', fx(L.spaceLoss_dB, 2), 'dB', '20 log(4πdf/c)') + row('Atmosphere', fx(L.atm_dB, 3), 'dB', 'Azen / sin(el), CD ' + R.S.cd);
    h += row('DSN antenna gain', fx(L.dsnGain_dBi, 2), 'dBi', lb.station + ' at ' + f(lb.elevation_deg, 3) + '°') + row('DSN pointing', fx(L.dsnPoint_dB, 2), 'dB', '810-005 104') + row('Polarization', fx(L.pol_dB, 2), 'dB', P.article) + row('Received power', fx(L.pr_dBm, 2), 'dBm', lb.saturates ? 'above ' + String(lb.maxRx_dBm).replace('-', '−') + ' dBm: overloads' : 'sum', 'hl');
    h += row('Antenna-microwave noise', fx(L.tAmw_K, 2), 'K', 'T1 + T2 e^(−a el)') + row('Atmosphere noise', fx(L.tAtm_K, 2), 'K', 'Tp (1 − 1/L)') + row('Cosmic background', fx(L.tCmb_K, 2), 'K', '2.725 / L') + row('The Sun', fx(L.tSun_K, 2), 'K', 'SEP ' + f(d.sep_deg, 3) + '°') + row('System noise temperature', fx(L.snt_K, 2), 'K', 'sum') + row('Noise density', fx(L.n0_dBmHz, 2), 'dBm/Hz', 'k T');
    h += row('Received Pt/No', fx(L.ptn0_dBHz, 2), 'dB-Hz', '', 'hl');
    h += row('Carrier suppression', fx(sp.carrier_dB, 2), 'dB', 'cos²(' + b.modDeg + '°)' + (rd.ranging ? ', ranging' : '')) + row('Carrier loop SNR', fx(b.cnr_dB, 2), 'dB', 'needs 10 in ' + b.loopHz + ' Hz') + row('Data suppression', fx(sp.data_dB, 2), 'dB', 'sin²(' + b.modDeg + '°)' + (rd.ranging ? ', ranging' : ''));
    h += row('Received Pd/No', fx(b.pdn0_dBHz, 2), 'dB-Hz', '') + row('Data rate', rate(b.bps), '', lb.best ? 'best that closes' : 'none closes: the top rate shown') + row('Eb/No', fx(b.ebn0_dB, 2), 'dB', 'Pd/No − rate') + row('Losses + required Eb/No', fx(rd.losses_dB, 2) + ' + ' + fx(rd.reqEbN0_dB, 2), 'dB', esc(rd.code)) + row('Margin', fx(b.margin_dB, 2), 'dB', 'needs ' + R.S.margin_dB, 'hl');
    tb.innerHTML = h;
    rt.innerHTML = lb.rows.slice().reverse().map(function (q) {
      return '<tr' + (lb.best && q.bps === lb.best.bps ? ' class="hl"' : '') + '><td class="n" data-k="Rate">' + rate(q.bps) + '</td><td class="n" data-k="Mod index">' + q.modDeg + '°</td><td class="n" data-k="Needs Pt/No">' + fx(q.reqPtN0_dBHz, 2) + '<span class="sub">' + q.reqSource + '</span></td><td class="n" data-k="Margin">' + fx(q.margin_dB, 2) + '</td><td class="n" data-k="Carrier loop">' + fx(q.cnr_dB, 1) + ' dB</td><td data-k="Closes">' + (q.margin_dB >= R.S.margin_dB ? 'yes' : 'no') + '</td></tr>';
    }).join('');
  }
  function renderConj() {
    var R = st.R, tb = $('conjTable').querySelector('tbody');
    $('conjDelayHead').textContent = 'Corona delay at ' + R.radio.band;
    if (!R.conjunctions.length) { tb.innerHTML = '<tr><td colspan="7">The spacecraft never comes within 5° of the Sun as seen from the Earth' + (R.S.stayDays ? ' (cruise and stay)' : '') + '.</td></tr>'; return; }
    tb.innerHTML = R.conjunctions.map(function (c) {
      var d = R.days.filter(function (q) { return q.utc === c.min_at_utc; })[0], g = d ? K.downleg(d.tdb, R.craftAt, K39.earthState) : null, del = g ? K.coronaDelay_s(K.stec(g.earth.r, g.craft.r), R.radio.f_Hz) * C : null;
      return '<tr><td data-k="From">' + c.start_utc + '</td><td data-k="To">' + c.end_utc + '</td><td class="n" data-k="Days">' + c.days + '</td><td class="n" data-k="Blacked out">' + c.blackout_days + '</td><td data-k="Closest">' + f(c.min_sep_deg, 3) + '° on ' + c.min_at_utc + '</td><td data-k="Kind">' + c.kind + '</td><td class="n" data-k="Corona delay">' + (num(del) ? f(del, 3) + ' m one way' : '–') + '</td></tr>';
    }).join('');
  }
  function renderOracles() {
    if (!st.src) return;
    var O = K.oracles(HZ, st.src.R40), rows = [], T = O.thresholds, M = O.dawnMonitor;
    st.oracles = O; st.oraclesFor = st.src;
    function r(k, ind, mod, gap, ok) { rows.push('<tr><td data-k="Check">' + k + '</td><td class="n" data-k="Independent">' + ind + '</td><td class="n" data-k="This page">' + mod + '</td><td class="n ' + (ok ? 'gap-ok' : '') + '" data-k="Gap">' + gap + '</td></tr>'); }
    function dB(p) { return fx(p[1] - p[0], 2) + ' dB'; }
    r('Juno DCT, DSS-26, 2012-07-05: Pt/No<span class="why">JPL\'s telecom forecaster against this model: same range, elevation and weather</span>', fx(O.juno.ptn0[0], 2), fx(O.juno.ptn0[1], 2), dB(O.juno.ptn0), true);
    r('Juno DCT: system noise temperature<span class="why">antenna-microwave 16.33 K reproduced; the atmosphere gives 3.31 K here against 3.68</span>', fx(O.juno.snt[0], 2) + ' K', fx(O.juno.snt[1], 2) + ' K', fx(O.juno.snt[1] - O.juno.snt[0], 2) + ' K');
    r('Dawn DCT, Canberra 34 m, 2014-12-16: Pt/No<span class="why">with DSS-34 (the article does not name the antenna)</span>', fx(O.dawn.ptn0[0], 2), fx(O.dawn.ptn0[1], 2), dB(O.dawn.ptn0), true);
    r('Dawn DCT: the Sun\'s noise at SEP ' + f(O.dawn.sep_deg, 3) + '° (Horizons)<span class="why">810-005 105 eq. (10), the 1996 solar-minimum envelope</span>', fx(O.dawn.tSun[0], 2) + ' K', fx(O.dawn.tSun[1], 2) + ' K', fx(O.dawn.tSun[1] - O.dawn.tSun[0], 2) + ' K');
    r('Deep Impact DCT, DSS-14 70 m, 2005-07-04: Pt/No<span class="why">the DCT reads "X/S:X/S", LNA-1: DSS-14 in its S/X configuration (101 Tables A-1, A-3), whose noise matches the DCT\'s to ' + fx(O.di.snt[1] - O.di.snt[0], 2) + ' K; the X-only configuration would give ' + fx(O.di.xOnly.ptn0[1] - O.di.xOnly.ptn0[0], 2) + ' dB</span>', fx(O.di.ptn0[0], 2), fx(O.di.ptn0[1], 2), dB(O.di.ptn0), true);
    r('Deep Impact rate table (27 rates): required Pt/No<span class="why">1 kbps to 400 kbps; at 10 bps the model is ' + fx(T.di.maxGapLow_dB, 2) + ' dB optimistic (subcarrier and sync losses)</span>', 'Table 3-1', 'computed', '≤ ' + fx(T.di.maxGapHigh_dB, 3) + ' dB', true);
    r('Dawn DCT line 21: required Pt/No at 123.8 kbps<span class="why">Dawn\'s one published threshold; the page uses it (ranging on) and computes Dawn\'s other six</span>', fx(T.dawnTop.published, 2), fx(T.dawnTop.model, 2), fx(T.dawnTop.model - T.dawnTop.published, 2) + ' dB');
    r('Juno rate table, ranging on (17 rates)<span class="why">≥ 99.7 kbps; at 100 bps ' + fx(T.juno.maxGapLow_dB, 2) + ' dB optimistic; ranging off ' + fx(T.junoNoRanging.maxGapHigh_dB, 2) + ' dB: the page uses the published thresholds</span>', 'Table 3-2', 'computed', '≤ ' + fx(T.juno.maxGapHigh_dB, 3) + ' dB', true);
    var dc = M.map(function (m) { return m.carrier[0] - m.carrier[1]; }), ds = M.map(function (m) { return m.ssnr[0] - m.ssnr[1]; }), mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    r('Dawn\'s station data, June 2009, 5 passes: carrier power<span class="why">measured at DSS-24, 25 and 26 against this model at the logged range and elevation: reality is louder</span>', 'measured', 'model', '+' + fx(Math.min.apply(null, dc), 2) + ' to +' + fx(Math.max.apply(null, dc), 2) + ' dB (mean ' + fx(mean(dc), 2) + ')');
    r('Dawn\'s station data: telemetry symbol SNR', 'measured', 'model', fx(Math.min.apply(null, ds), 2) + ' to +' + fx(Math.max.apply(null, ds), 2) + ' dB (mean ' + fx(mean(ds), 2) + ')');
    r('810-005 106 worked example: slant electrons, SEP 1.5°, β 150°', '≈ 3e20 /m²', f(O.corona.stec[1], 3), f((O.corona.stec[1] / O.corona.stec[0] - 1) * 100, 2) + ' %', true);
    r('106: group delay at S and X band', '7.5, 0.6 µs', fx(O.corona.delayS_us[1], 2) + ', ' + fx(O.corona.delayX_us[1], 2) + ' µs', '', true);
    r('106: telemetry fails (m = 0.3), X and Ka<span class="why">the text: "near 2.3°" and "~1°"</span>', '2.3°, 1°', fx(O.scintillation.X[1], 2) + '°, ' + fx(O.scintillation.Ka[1], 2) + '°', '', true);
    if (O.geometry) {
      var g = O.geometry;
      r('Horizons: Apophis, ' + g.n + ' epochs, from Horizons\' own vectors<span class="why">range and light time differ by the Sun\'s own motion during the light time (this frame is heliocentric)</span>', 'observer table', 'this geometry', '≤ ' + f(g.range_m / 1e3, 2) + ' km, ' + f(g.sep_deg, 2) + '° SEP, ' + f(g.dec_deg * 3600, 2) + '″ Dec', true);
      r('Horizons: Juno from DSS-26 at its DCT epoch<span class="why">the DCT says 59.65°; idea 40\'s station model (no precession, geocentric vertical)</span>', fx(O.junoElevation.horizons, 3) + '°', fx(O.junoElevation.model, 3) + '°', '+' + fx(O.junoElevation.model - O.junoElevation.horizons, 3) + '°');
      r('Horizons: Apophis from DSS-26, 36, 56 (' + O.stationElevation.n + ' hours)', 'elevation', 'model', 'mean ' + fx(O.stationElevation.mean_deg, 2) + '°, worst ' + fx(O.stationElevation.max_deg, 2) + '°');
      if (O.chainApophis) r('The chain\'s Apophis (idea 40) seen from idea 39\'s Earth<span class="why">before the 2029 encounter / after it (the flyby multiplies the error)</span>', 'Horizons', 'this page', f(O.chainApophis.before.range_m / 1e3, 2) + ' km / ' + f(O.chainApophis.after.range_m / 1e3, 3) + ' km');
      var D5 = O.ds1Dates;
      r('DS1\'s 2000 conjunction: SEP below 5°<span class="why">DESCANSO article 2: 20 Oct to 3 Dec</span>', 'article', 'Horizons', '+' + fx(D5.below5.horizons[0] - D5.below5.article[0], 1) + ' d, ' + fx(D5.below5.horizons[1] - D5.below5.article[1], 1) + ' d');
      r('DS1: telemetry received 20 Nov 2000 at "1.1°"<span class="why">Horizons puts DS1 at 1.90° that day; the model blacks out X band below 2.19°. DS1 ran 40 bps below 3° with both X and Ka on; the article does not say which band carried it</span>', '1.1°', fx(D5.firstTelemetry.horizonsSep, 2) + '°', 'model likely conservative');
    }
    $('checkTable').querySelector('tbody').innerHTML = rows.join('');
  }

  // ------------------------------------------------------------------ charts
  function canvasFor(id, aspect, minH) {
    var c = $(id), w = Math.max(240, c.clientWidth || c.parentNode.clientWidth || 300), h = Math.max(minH, Math.round(w * aspect)), dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { c: c, ctx: ctx, w: w, h: h };
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function timeChart(id, o) {
    var R = st.R, days = R.days, g = canvasFor(id, o.aspect || 0.42, o.minH || 190), ctx = g.ctx, Lm = 46, Rm = o.y2 ? 54 : 10, Tm = 10, Bm = 22, W = g.w - Lm - Rm, H = g.h - Tm - Bm, n = days.length;
    var ink2 = css('--ink-2'), grid = css('--grid'), axis = css('--axis');
    ctx.font = '11px system-ui, sans-serif';
    var vals = []; o.series.forEach(function (s) { days.forEach(function (d) { var v = s.y(d); if (num(v) && (!o.log || v > 0)) vals.push(v); }); });
    var y0 = o.yMin !== undefined ? o.yMin : Math.min.apply(null, vals), y1 = o.yMax !== undefined ? o.yMax : Math.max.apply(null, vals);
    if (!vals.length) { y0 = o.log ? 1 : 0; y1 = o.log ? 10 : 1; }
    if (o.log) { y0 = Math.pow(10, Math.floor(Math.log10(Math.max(y0, o.logFloor || 1e-9)))); y1 = o.yMax !== undefined ? o.yMax : Math.pow(10, Math.ceil(Math.log10(y1 * 1.0001))); } else if (y1 === y0) { y1 = y0 + 1; }
    else if (o.pad) { var p = (y1 - y0) * 0.08; y0 -= p; y1 += p; }
    var X = function (i) { return Lm + (n > 1 ? i / (n - 1) : 0) * W; }, Y = function (v) { var u = o.log ? (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) : (v - y0) / (y1 - y0); return Tm + H - Math.max(-0.05, Math.min(1.05, u)) * H; };
    g.c._x = function (px) { return Math.round((px - Lm) / W * (n - 1)); };
    // shaded days (blackout) and the stay
    (o.shade || []).forEach(function (sh) {   // contiguous runs as one rectangle each, so translucent colours do not stack
      ctx.fillStyle = sh.color; var a = -1;
      for (var i = 0; i <= n; i++) { var on = i < n && sh.when(days[i]); if (on && a < 0) a = i; if (!on && a >= 0) { var x0 = Math.max(Lm, X(a) - W / n / 2), x1 = Math.min(Lm + W, X(i - 1) + W / n / 2); ctx.fillRect(x0, Tm, Math.max(1, x1 - x0), H); a = -1; } }
    });
    // y grid
    ctx.strokeStyle = grid; ctx.fillStyle = ink2; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ticks = [];
    if (o.log) { for (var e = Math.round(Math.log10(y0)); e <= Math.round(Math.log10(y1)); e++) ticks.push(Math.pow(10, e)); }
    else { var step = Math.pow(10, Math.floor(Math.log10((y1 - y0) / 4))), m = (y1 - y0) / step; step *= m > 20 ? 5 : m > 8 ? 2 : 1; for (var tv = Math.ceil(y0 / step) * step; tv <= y1 + 1e-9; tv += step) ticks.push(+tv.toPrecision(10)); }
    ticks.forEach(function (tv) { var y = Y(tv); ctx.beginPath(); ctx.moveTo(Lm, y); ctx.lineTo(Lm + W, y); ctx.stroke(); ctx.fillText(o.fmtY ? o.fmtY(tv) : f(tv, 3), Lm - 4, y); if (o.y2) { ctx.textAlign = 'left'; ctx.fillText(o.y2(tv), Lm + W + 4, y); ctx.textAlign = 'right'; } });
    // x ticks: month starts, thinned to about six
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var marks = []; days.forEach(function (d, i) { if (d.utc.slice(8) === '01') marks.push(i); });
    var every = Math.max(1, Math.ceil(marks.length / Math.max(3, Math.floor(W / 70))));
    marks.forEach(function (i, k) { if (k % every) return; var d = days[i].utc, x = X(i); ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, Tm); ctx.lineTo(x, Tm + H); ctx.stroke(); ctx.fillText(MON[+d.slice(5, 7) - 1] + ' ' + d.slice(2, 4), x, Tm + H + 4); });
    ctx.strokeStyle = axis; ctx.strokeRect(Lm, Tm, W, H);
    // threshold lines
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    var lastY = -1e9;   // labels closer than 12 px to the last one drawn are left off (the lines stay)
    (o.hlines || []).slice().sort(function (a, b) { return b.y - a.y; }).forEach(function (hl) { if (!(hl.y >= y0 && hl.y <= y1)) return; var y = Y(hl.y); ctx.strokeStyle = hl.color; ctx.setLineDash(hl.dash || [5, 4]); ctx.beginPath(); ctx.moveTo(Lm, y); ctx.lineTo(Lm + W, y); ctx.stroke(); ctx.setLineDash([]); if (hl.label && y - lastY >= 12) { ctx.fillStyle = hl.color; ctx.fillText(hl.label, Lm + 4, y - 1); lastY = y; } });
    // series
    o.series.forEach(function (s) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.beginPath(); var pen = false;
      days.forEach(function (d, i) { var v = s.y(d); if (!num(v) || (o.log && v <= 0)) { pen = false; return; } var x = X(i), y = Y(v); if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; });
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    });
    // the arrival and the chosen day
    var ia = R.arrival && R.arrival.day ? days.indexOf(R.arrival.day) : -1;
    if (ia >= 0) { ctx.strokeStyle = css('--ink'); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(ia), Tm); ctx.lineTo(X(ia), Tm + H); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = css('--ink'); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('arrival', X(ia) + 3, Tm + 2); }
    ctx.strokeStyle = css('--s2'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(st.day), Tm); ctx.lineTo(X(st.day), Tm + H); ctx.stroke(); ctx.lineWidth = 1;
  }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key' + (it.cls ? ' ' + it.cls : '') + '" style="' + (it.cls === 'band' ? 'background:' : 'border-color:') + it.color + '"></span>' + it.label + '</li>'; }).join(''); }
  function drawCharts() {
    var R = st.R;
    if (!R || R.refusal) { ['rangeChart', 'sunChart', 'linkChart', 'rateChart', 'viewChart'].forEach(function (id) { canvasFor(id, 0.3, 120); }); return; }
    var s1 = css('--s1'), s2 = css('--s2'), s3 = css('--s3'), crit = css('--crit'), warn = css('--warn'), ref = css('--refused'), ink2 = css('--ink-2');
    var black = { color: 'rgba(208, 59, 59, 0.22)', when: function (d) { return d.status === 'blackout' || d.status === 'refused'; } }, stay = { color: ref, when: function (d) { return d.phase === 'stay'; } };
    timeChart('rangeChart', { series: [{ y: function (d) { return d.range_m / AU; }, color: s1 }], yMin: 0, fmtY: function (v) { return f(v, 2); }, y2: function (v) { return f(v * AU / C / 60, 2) + ' min'; }, shade: [stay] });
    legend('rangeLegend', [{ color: s1, label: 'distance, au (left) = one-way light time (right)' }, { color: ref, cls: 'band', label: 'the stay at the asteroid' }]);
    var thr = 0, lo = 0.3, hi = 6; for (var i = 0; i < 50; i++) { var m = (lo + hi) / 2; if (K.scintillation(R.radio.band, m).m >= 0.3) lo = m; else hi = m; } thr = lo;
    timeChart('sunChart', { log: true, logFloor: 0.01, yMax: 180, series: [{ y: function (d) { return d.sep_deg; }, color: s3 }], fmtY: function (v) { return f(v, 2) + '°'; }, shade: [stay, black],
      hlines: [{ y: 5, color: warn, label: '5°: DS1 and MRO plan for degradation' }, { y: thr, color: crit, label: f(thr, 3) + '°: m = 0.3 at ' + R.radio.band }, { y: 0.35, color: ink2, label: '0.35°: Sun noise has no expression' }] });
    legend('sunLegend', [{ color: s3, label: 'Sun-Earth-probe angle' }, { color: 'rgba(208, 59, 59, 0.5)', cls: 'band', label: 'blacked out or refused' }]);
    var rows = R.radio.rates.map(function (q) { return { bps: q.bps, need: q.reqPtN0 !== null ? q.reqPtN0 : K.thresholdPtN0(R.radio, q).data }; });
    var pts = R.days.map(function (d) { return d.ptn0_dBHz; }).filter(num), pmin = Math.min.apply(null, pts), pmax = Math.max.apply(null, pts);
    var hl = rows.filter(function (q, i) { return i === rows.length - 1 || (q.need + R.S.margin_dB > pmin - 12 && q.need + R.S.margin_dB < pmax + 3); }).slice(-4).map(function (q) { return { y: q.need + R.S.margin_dB, color: ink2, dash: [3, 4], label: rate(q.bps) }; });
    timeChart('linkChart', { series: [{ y: function (d) { return d.ptn0_dBHz; }, color: s1 }], yMin: Math.min(pmin, hl.length ? hl[0].y : pmin) - 3, yMax: pmax + 2, fmtY: function (v) { return f(v, 3); }, shade: [stay, black], hlines: hl });
    legend('linkLegend', [{ color: s1, label: 'Pt/No at the pass\'s lowest elevation, dB-Hz' }, { color: ink2, cls: 'dash', label: 'a rate\'s required Pt/No + ' + R.S.margin_dB + ' dB margin' }]);
    timeChart('rateChart', { log: true, logFloor: 1, aspect: 0.3, minH: 150, series: [{ y: function (d) { return d.rate_bps; }, color: s2 }], fmtY: function (v) { return rate(v).replace(' ', ''); }, shade: [stay, black] });
    var cols = [s1, s2, s3];
    timeChart('viewChart', { yMin: 0, yMax: 24, aspect: 0.32, minH: 160, series: [0, 1, 2].map(function (k) { return { y: function (d) { return d.complexes[k] ? d.complexes[k].hours : null; }, color: cols[k], width: 1.5 }; }), fmtY: function (v) { return f(v, 2) + ' h'; } });
    legend('viewLegend', R.days[0].complexes.map(function (c, k) { return { color: cols[k], label: c.id + ' ' + c.complex }; }));
    var A = R.arrival, conj = R.conjunctions;
    $('rangeCap').textContent = A ? 'At arrival ' + f(A.range_m / AU, 4) + ' au: a signal takes ' + mins(A.owlt_s) + ' min one way, a command and its answer ' + mins(A.rtlt_s) + ' min. Farthest: ' + f(Math.max.apply(null, R.days.map(function (d) { return d.range_m; })) / AU, 3) + ' au.' : '';
    $('sunCap').textContent = conj.length ? conj.length + ' conjunction(s); the closest ' + f(conj[0].min_sep_deg, 3) + '° on ' + conj[0].min_at_utc + ' (' + conj[0].kind + '), ' + R.totals.blackout_days + ' days blacked out at ' + R.radio.band + '.' : 'The spacecraft never comes within 5° of the Sun: no conjunction.';
    $('linkCap').textContent = 'Each day\'s best pass at its lowest elevation (' + R.S.elMin_deg + '° or the end of a ' + R.S.passHours + ' h pass). ' + (R.S.rateMode === 'continuous' ? 'Any rate up to the decoder limit (' + rate(R.radio.decoderMax_bps) + ').' : 'Rates from ' + R.radio.name + '\'s table, top ' + rate(R.radio.maxRate_bps) + '.');
  }
  ['rangeChart', 'sunChart', 'linkChart', 'rateChart', 'viewChart'].forEach(function (id) {
    $(id).addEventListener('pointerdown', function (e) { if (!st.R || st.R.refusal || !this._x) return; var r = this.getBoundingClientRect(), i = this._x(e.clientX - r.left); st.day = Math.max(0, Math.min(st.R.days.length - 1, i)); $('dayRange').value = st.day; renderDay(); drawCharts(); });
  });
  var rz = null; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(drawCharts, 120); });

  // ------------------------------------------------------------------ handoff
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function hoStatus(msg, cls) { var el = $('hoStatus'); el.textContent = msg; el.className = 'status' + (cls ? ' ' + cls : ''); }
  function exportText() { if (!st.R || st.R.refusal) { hoStatus('Nothing to export: the settings are refused.', 'bad'); return null; } return JSON.stringify(K.buildHandoff(st.R, new Date().toISOString())); }
  function copy(text, msg) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { hoStatus(msg, 'ok'); }, function () { $('importText').value = text; hoStatus('Copy blocked: the text is in the box above.', 'bad'); }); else { $('importText').value = text; hoStatus('The text is in the box above.', 'ok'); } }
  function doImport(text, how) {
    var P = K.importLongCoast(text);
    if (P.refusal) { hoStatus('Refused: ' + P.refusal.reason + ' ' + (P.refusal.what_would_help || ''), 'bad'); return false; }
    st.src = { h40: P.h40, R40: P.R40 };
    st.S = P.settings ? JSON.parse(JSON.stringify(P.settings)) : K.defaults(st.S ? st.S.craft : 'dawn', P.R40.S.nav);
    st.presetKey = 'imported'; st.srcLabel = 'Imported (' + how + '): idea ' + (P.from === '41-signal' ? '41\'s handoff, re-checked: its idea 40 cruise re-flown and every number recomputed' : '40\'s handoff, re-checked by idea 40\'s kernel') + ' (' + P.R40.body.designation + ', arrival ' + K39.utcOf(P.R40.arrival.tdb).slice(0, 10) + ').';
    sync(); compute(); hoStatus('Imported: ' + (P.h40.refusals || []).length + ' refusals came with idea 40\'s handoff.', 'ok'); return true;
  }
  $('importBtn').addEventListener('click', function () { var t = $('importText').value.trim(); if (!t) { hoStatus('Paste a handoff first.', 'bad'); return; } busy(true, 'Re-flying the cruise…'); setTimeout(function () { doImport(t, 'pasted'); busy(false, $('runNote').textContent); }, 20); });
  $('importFile').addEventListener('change', function () { var fl = this.files && this.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { doImport(String(rd.result), 'file'); }; rd.readAsText(fl); });
  $('copyBtn').addEventListener('click', function () { var h = exportText(); if (h) copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
  $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'signal-handoff.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); hoStatus('Downloaded signal-handoff.json.', 'ok'); });
  $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + b64u(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });

  // ------------------------------------------------------------------ start
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/);
  st.S = K.defaults('dawn', null); sync();
  if (hash) { busy(true, 'Reading the link…'); setTimeout(function () { var ok = false; try { ok = doImport(unb64u(hash[1]), 'link'); } catch (e) { hoStatus('The link\'s handoff could not be read.', 'bad'); } busy(false, $('runNote').textContent); if (!ok) loadPreset('99942'); }, 20); }
  else loadPreset('99942');
  window.SignalPage = { st: st, K: K };
})();
