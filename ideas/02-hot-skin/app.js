/* app.js: draws Hot Skin from heat.js (HotSkin) and the PartForge snapshot. No network, no storage. */
(function () {
  'use strict';
  var S = window.PartForgeSnapshot, H = window.HotSkin;
  var ctx = H.create(S);
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    speed: $('speed'), speedRange: $('speedRange'), alt: $('alt'), altRange: $('altRange'), dt: $('dt'), dtNow: $('dtNow'),
    material: $('material'), src: $('src'), ref: $('ref'), refField: $('refField'), finBtn: $('finBtn'), finNote: $('finNote'),
    refusal: $('refusal'), refCode: $('refCode'), refReason: $('refReason'), refHelp: $('refHelp'), refExample: $('refExample'), refExampleRows: $('refExampleRows'),
    refExampleCap: $('refExampleCap'), refExampleNote: $('refExampleNote'),
    verdict: $('verdict'), vband: $('vband'), vtext: $('vtext'), figs: $('figs'), vnote: $('vnote'), flags: $('flags'), arith: $('arith'),
    chart: $('chart'), chartRead: $('chartRead'), tableCond: $('tableCond'), matRows: $('matRows'), prov: $('prov'),
  };
  var fin = S.finTemplate && S.finTemplate.loads && S.finTemplate.loads[0];
  var FIN = fin ? { v: fin.v_max_m_s, alt: fin.alt_m, material: S.finTemplate.material, src: fin.inputs_src || 'default' } : { v: 700, alt: 3000, material: '6061-T6', src: 'default' };

  // ---- formatting ---------------------------------------------------------------------------
  var MINUS = '−';
  function f(x, d) { if (x == null || !isFinite(x)) return '—'; var s = Math.abs(x).toFixed(d); return (x < 0 && Number(s) !== 0 ? MINUS : '') + s; }
  function signed(x, d) { if (x == null || !isFinite(x)) return '—'; var s = Math.abs(x).toFixed(d); return (x < 0 ? MINUS : '+') + s; }
  function thousands(x) { return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function text(node, s) { node.textContent = s; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function mk(tag, cls, s) { var n = document.createElement(tag); if (cls) n.className = cls; if (s != null) n.textContent = s; return n; }

  // ---- state ---------------------------------------------------------------------------------
  // dt is the ISA offset in kelvin, kept as typed text so an unreadable value reaches the model and is refused.
  var state = { speedText: String(FIN.v), alt: FIN.alt, dt: '0', material: FIN.material, src: FIN.src, ref: '' };
  // The query is read once. An empty parameter counts as absent; anything else is passed through as
  // given, so an unknown material or an unreadable altitude is refused on screen by the model rather
  // than silently replaced by the fin template's value.
  (function fromQuery() {
    try {
      var q = new URLSearchParams(window.location.search);
      var given = function (k) { return q.has(k) && q.get(k).trim() !== ''; };
      if (given('mach')) state.speedText = 'Mach ' + q.get('mach').trim();
      else if (given('v')) state.speedText = q.get('v').trim();
      if (given('alt')) state.alt = isFinite(Number(q.get('alt'))) ? Number(q.get('alt')) : q.get('alt').trim();
      if (given('dt')) state.dt = q.get('dt').trim();
      if (given('m')) state.material = q.get('m').trim();
      if (given('src')) state.src = /^(source|user|default)$/.test(q.get('src').trim()) ? q.get('src').trim() : 'default';
      if (given('ref')) state.ref = q.get('ref');
    } catch (e) { /* no query */ }
  })();

  // ---- material select -----------------------------------------------------------------------
  (function fillMaterials() {
    var groups = {};
    ctx.rows.forEach(function (r) {
      var m = H.materialInfo(ctx, r.key);
      (groups[m.kind] = groups[m.kind] || []).push(m);
    });
    ['metal', 'composite', 'polymer', 'other'].concat(Object.keys(groups).filter(function (k) { return ['metal', 'composite', 'polymer', 'other'].indexOf(k) < 0; })).forEach(function (kind) {
      if (!groups[kind]) return;
      var og = document.createElement('optgroup');
      og.label = kind;
      groups[kind].forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.key;
        o.textContent = m.name + ' — ' + (isFinite(m.service_max_c) ? m.service_max_c + ' °C' : 'no limit') + ' (' + m.confidence + ')';
        og.appendChild(o);
      });
      el.material.appendChild(og);
    });
  })();

  function syncInputs() {
    el.speed.value = state.speedText;
    var p = H.parseSpeed(state.speedText);
    if (p && p.kind === 'speed' && isFinite(p.v_m_s)) el.speedRange.value = String(Math.max(0, Math.min(1500, p.v_m_s)));
    el.alt.value = String(state.alt);
    if (isFinite(Number(state.alt))) el.altRange.value = String(Math.max(0, Math.min(40000, Number(state.alt))));
    if (el.dt !== document.activeElement) el.dt.value = state.dt;
    el.material.value = ctx.byKey[state.material] ? state.material : '';
    el.src.value = state.src;
    el.refField.hidden = state.src !== 'source';
    if (el.ref !== document.activeElement) el.ref.value = state.ref;
    var alt = Number(state.alt), dt = Number(state.dt);
    // The day's own temperature is printed only for an offset the model accepts, so a typed −300 never
    // shows a day below absolute zero.
    var dtInBand = String(state.dt).trim() !== '' && isFinite(dt) && dt >= H.ISA_DT_MIN_K && dt <= H.ISA_DT_MAX_K;
    if (isFinite(alt) && !ctx.isa(alt).clamped && (dtInBand || String(state.dt).trim() === '')) {
      var Tstd = ctx.isa(alt).T_K - H.KELVIN;
      text(el.dtNow, 'At ' + thousands(alt) + ' m the standard day is ' + f(Tstd, 1) + ' °C' + (dtInBand && dt !== 0 ? '; this day is ' + f(Tstd + dt, 1) + ' °C' : '') + '. A 35 °C day at sea level is ISA+20.');
    } else text(el.dtNow, 'A 35 °C day at sea level is ISA+20.');
    if (fin) text(el.finNote, 'tests/templates/fin.scad declares ' + fin.check + ' "' + fin.name + '": v_max_m_s ' + fin.v_max_m_s + ', alt_m ' + fin.alt_m + ', inputs_src ' + (fin.inputs_src || 'default') + '.');
  }

  // ---- refusal / verdict -----------------------------------------------------------------------
  function showRefusal(ref) {
    el.verdict.hidden = true;
    el.refusal.hidden = false;
    text(el.refCode, ref.code);
    text(el.refReason, ref.reason);
    text(el.refHelp, ref.what_would_help);
    clear(el.refExampleRows);
    // The model only hands back example rows it stands behind (none past the 2,000 K ceiling); a row
    // without a temperature is never drawn as a number.
    var rows = (ref.example || []).filter(function (x) { return !x.over_ceiling && x.T0_C != null && isFinite(x.T0_C); });
    if (rows.length === 2) {
      el.refExample.hidden = false;
      text(el.refExampleCap, 'Mach ' + ref.example_mach + ' at two altitudes, this page’s own isa()' + (Number(state.dt) ? ' on an ISA' + signed(Number(state.dt), 1) + ' K day' : '') + ':');
      el.refExampleNote.hidden = !ref.example_note;
      text(el.refExampleNote, ref.example_note || '');
      rows.forEach(function (x) {
        var tr = document.createElement('tr');
        tr.appendChild(mk('td', null, thousands(x.alt_m) + ' m'));
        tr.appendChild(mk('td', null, f(x.T_inf_C, 1) + ' °C'));
        tr.appendChild(mk('td', null, f(x.v_m_s, 0) + ' m/s'));
        tr.appendChild(mk('td', null, f(x.T0_C, 1) + ' °C'));
        el.refExampleRows.appendChild(tr);
      });
      var d = rows[0].T0_C - rows[1].T0_C;
      var tr2 = document.createElement('tr');
      var td = mk('td', null, 'Same Mach, ' + f(Math.abs(d), 1) + ' °C apart: a bare Mach number can read that much low.');
      td.colSpan = 4;
      tr2.appendChild(td);
      el.refExampleRows.appendChild(tr2);
    } else el.refExample.hidden = true;
  }

  function fig(k, v, n, cls) {
    var d = mk('div', 'fig' + (cls ? ' ' + cls : ''));
    d.appendChild(mk('span', 'k', k));
    d.appendChild(mk('span', 'v', v));
    if (n) d.appendChild(mk('span', 'n', n));
    return d;
  }

  function showVerdict(r) {
    el.refusal.hidden = true;
    el.verdict.hidden = false;
    el.verdict.className = 'card verdict ' + r.band;
    text(el.vband, '· ' + ({ over: 'bound exceeds the limit', stagnation: 'recovery under, stagnation over', near: 'bound within ' + H.NEAR_C + ' °C of the limit', under: 'bound under the limit' })[r.band]);
    text(el.vtext, r.bandText + '. ' + r.material.name + ': service_max_c ' + r.material.service_max_c + ' °C (' + r.material.confidence + ').');
    clear(el.figs);
    var m = r.material;
    el.figs.appendChild(fig('T∞, free stream', f(r.T_inf_C, 1) + ' °C', (r.dT_K ? 'ISA' + signed(r.dT_K, 1) + ' K' : 'ISA standard day') + ' at ' + thousands(r.inputs.alt_m) + ' m, a = ' + f(r.a_m_s, 1) + ' m/s'));
    el.figs.appendChild(fig('Mach, derived', f(r.M, 2), r.inputs.v_m_s + ' m/s ÷ ' + f(r.a_m_s, 1) + ' m/s'));
    el.figs.appendChild(fig('T0, stagnation', f(r.T0_C, 1) + ' °C', 'leading edge, nose tip; r = 1', r.margin_T0_C < 0 ? 'over' : (r.band === 'near' ? 'near' : '')));
    el.figs.appendChild(fig('Tr, turbulent recovery', f(r.Tr_turb_C, 1) + ' °C', 'flat skin, r = Pr⅓ = ' + f(r.gas.r_turb, 4), r.margin_turb_C < 0 ? 'over' : ''));
    el.figs.appendChild(fig('Tr, laminar recovery', f(r.Tr_lam_C, 1) + ' °C', 'r = Pr½ = ' + f(r.gas.r_lam, 4), r.margin_lam_C < 0 ? 'over' : ''));
    el.figs.appendChild(fig('service_max_c', m.service_max_c + ' °C', m.name + ' · confidence ' + m.confidence));
    el.figs.appendChild(fig('margin vs T0', signed(r.margin_T0_C, 1) + ' °C', 'limit − stagnation bound', r.margin_T0_C < 0 ? 'over' : (r.band === 'near' ? 'near' : '')));
    el.figs.appendChild(fig('margin vs Tr turbulent', signed(r.margin_turb_C, 1) + ' °C', 'limit − turbulent recovery bound', r.margin_turb_C < 0 ? 'over' : ''));
    var L = r.limitSpeed;
    // Each crossing is named only when the model names it: none for air already hotter than the limit,
    // none past the 2,000 K ceiling speed (Graphite's 2,000 °C), where the page prints nothing.
    var Lv = L.air_hotter ? 'already above' : L.T0_m_s == null ? 'none under the ceiling' : f(L.T0_m_s, 0) + ' / ' + (L.turb_m_s == null ? 'past the ceiling' : f(L.turb_m_s, 0) + ' m/s');
    var Ln = L.air_hotter ? 'the air itself is hotter than the limit' : L.T0_m_s == null ? 'T0 reaches the ' + thousands(H.T0_MAX_K) + ' K ceiling before the limit at this altitude' : 'T0 / Tr turbulent, at this altitude';
    el.figs.appendChild(fig('speed where the bound meets the limit', Lv, Ln));
    // The day is named only inside the band the page accepts; otherwise the model's reason says which side.
    var D = r.offsetAtLimit;
    var Dv = D.T0_K != null ? 'ISA' + signed(D.T0_K, 1) + ' K' : 'none in the band';
    var Dn = D.T0_K != null ? 'at this speed; every bound moves one for one with the day'
      : (D.status === 'over_every_day' ? 'over the limit' : 'under the limit') + ' on every day from ISA' + signed(D.min_K, 0) + ' to ISA' + signed(D.max_K, D.ceiling_limited ? 1 : 0) + ' K at this speed' + (D.ceiling_limited ? ' (warmer: past the ceiling)' : '');
    el.figs.appendChild(fig('day where T0 meets the limit', Dv, Dn));
    text(el.vnote, m.note ? 'The table’s note on ' + m.key + ' (materials_thermal.json; most notes describe expansion, not the limit): ' + m.note : 'materials_thermal.json has no note on ' + m.key + '.');
    clear(el.flags);
    r.flags.forEach(function (fl) { el.flags.appendChild(mk('li', fl.code, fl.text)); });
    clear(el.arith);
    var g = r.gas;
    var lines = [
      'isa(' + r.inputs.alt_m + ') → T = ' + f(r.T_isa_K, 3) + ' K, geopotential ' + f(r.atm.H_geopotential_m, 1) + ' m. PartForge index.html lines ' + (S.provenance.index_html.isaLines || []).join('–') + ', run unmodified.',
      (r.dT_K ? 'Day offset: T∞ = ' + f(r.T_isa_K, 3) + ' ' + (r.dT_K < 0 ? '−' : '+') + ' ' + f(Math.abs(r.dT_K), 1) + ' = ' + f(r.T_inf_K, 3) + ' K (PartForge’s isa() has no offset; it is added here). ' : 'Standard day: T∞ = ' + f(r.T_inf_K, 3) + ' K. ') + 'a = √(γ R T∞) = ' + f(r.a_m_s, 3) + ' m/s.',
      'M = V / a = ' + r.inputs.v_m_s + ' / ' + f(r.a_m_s, 3) + ' = ' + f(r.M, 4) + '.',
      'T0 = T∞ (1 + (γ−1)/2 · M²) = ' + f(r.T0_K, 2) + ' K = ' + f(r.T0_C, 2) + ' °C, with γ = ISA_GAMMA = ' + g.gamma + '.',
      'Cross-check: cp = γR/(γ−1) = ' + f(g.cp, 3) + ' J/(kg·K) from ISA_R = ' + g.R + '; V²/2cp = ' + f(r.dT0_kinetic_K, 3) + ' K; T0 − T∞ = ' + f(r.dT0_K, 3) + ' K.',
      'Tr = T∞ (1 + r (γ−1)/2 · M²): r = Pr¹ᐟ³ = ' + f(g.r_turb, 4) + ' (turbulent) → ' + f(r.Tr_turb_K, 2) + ' K; r = Pr¹ᐟ² = ' + f(g.r_lam, 4) + ' (laminar) → ' + f(r.Tr_lam_K, 2) + ' K; Pr = ' + g.Pr + ' [Likely, air near 300 K], the only constant in the equations not read from the repository.',
      'margin = service_max_c − T: ' + m.service_max_c + ' − ' + f(r.T0_C, 1) + ' = ' + signed(r.margin_T0_C, 1) + ' (T0); ' + m.service_max_c + ' − ' + f(r.Tr_turb_C, 1) + ' = ' + signed(r.margin_turb_C, 1) + ' (turbulent); ' + m.service_max_c + ' − ' + f(r.Tr_lam_C, 1) + ' = ' + signed(r.margin_lam_C, 1) + ' (laminar) °C.',
      L.air_hotter ? 'The free-stream air is already above the limit, so no speed brings the bound under it.'
        : L.T0_m_s == null ? 'Bound meets the limit at V = √(2 cp (T_limit − T∞)/r) only past the speed at which T0 reaches the ' + thousands(H.T0_MAX_K) + ' K ceiling at this altitude, so no crossing is named.'
        : 'Bound meets the limit at V = √(2 cp (T_limit − T∞)/r): ' + [[L.T0_m_s, 'T0'], [L.turb_m_s, 'turbulent'], [L.lam_m_s, 'laminar']].map(function (p) { return (p[0] == null ? 'past the ' + thousands(H.T0_MAX_K) + ' K ceiling speed, so not named' : f(p[0], 1) + ' m/s') + ' (' + p[1] + ')'; }).join(', ') + '.',
      D.T0_K != null ? 'Day where T0 meets the limit at this speed: ΔT + (service_max_c − T0) = ' + f(r.dT_K, 1) + ' + (' + signed(r.margin_T0_C, 1) + ') = ISA' + signed(D.T0_K, 1) + ' K, inside the ' + signed(H.ISA_DT_MIN_K, 0) + ' to ' + signed(H.ISA_DT_MAX_K, 0) + ' K band.'
        : 'Day where T0 meets the limit: ΔT + (service_max_c − T0) falls outside the days this page accepts, so it is not a day and no figure is printed. ' + D.reason,
      'V is airspeed: a ground speed into a headwind w reads low by ((V + w)² − V²)/2cp, ' + f(r.headwind10_K, 2) + ' K for w = 10 m/s at ' + r.inputs.v_m_s + ' m/s.',
    ];
    lines.forEach(function (s) { el.arith.appendChild(mk('p', null, s)); });
  }

  // ---- table -----------------------------------------------------------------------------------
  function drawTable(v, alt, dt) {
    clear(el.matRows);
    var t = (v == null) ? null : H.table(ctx, v, alt, dt);
    if (!t || !t.ok) {
      text(el.tableCond, t && t.refusal ? 'No table: ' + t.refusal.reason : 'No table: the condition could not be evaluated.');
      return;
    }
    var c = t.condition;
    text(el.tableCond, thousands(c.v_m_s) + ' m/s at ' + thousands(c.alt_m) + ' m, ' + (c.isa_offset_K ? 'ISA' + signed(c.isa_offset_K, 1) + ' K' : 'standard day') + ' (Mach ' + f(c.M, 2) + '): T∞ ' + f(c.T_inf_C, 1) + ' °C, T0 ' + f(c.T0_C, 1) + ' °C, Tr turbulent ' + f(c.Tr_turb_C, 1) + ' °C, Tr laminar ' + f(c.Tr_lam_C, 1) + ' °C. Limits from materials_thermal.json with each row’s confidence.');
    t.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.className = r.refusal ? 'refused' : r.band;
      tr.setAttribute('data-key', r.key);
      var name = mk('td', 'name');
      var b = mk('b', null, r.name);
      name.appendChild(b);
      name.appendChild(mk('span', 'k', r.key + ' · ' + r.kind));
      if (r.note) {
        var det = mk('details');
        det.appendChild(mk('summary', null, 'note'));
        det.appendChild(mk('p', null, r.note));
        name.appendChild(det);
      }
      tr.appendChild(name);
      if (r.refusal) {
        var td = mk('td', 'conf', 'no service_max_c: refused (' + r.refusal.code + ')');
        td.colSpan = 4;
        tr.appendChild(td);
      } else {
        var lim = mk('td', 'num');
        lim.appendChild(document.createTextNode(r.service_max_c + ' °C '));
        lim.appendChild(mk('span', 'conf', r.confidence));
        tr.appendChild(lim);
        tr.appendChild(mk('td', 'num turb', signed(r.margin_turb_C, 1)));
        tr.appendChild(mk('td', 'num t0', signed(r.margin_T0_C, 1)));
        var bt = mk('td');
        // The tag word in full, or shortened in the phone layout (CSS shows one of the two).
        var tg = mk('span', 'tag ' + r.band);
        tg.appendChild(mk('span', 'long', r.band));
        tg.appendChild(mk('span', 'short', r.band === 'stagnation' ? 'stag.' : r.band));
        bt.appendChild(tg);
        tr.appendChild(bt);
      }
      el.matRows.appendChild(tr);
    });
  }

  // ---- chart -----------------------------------------------------------------------------------
  var chart = { v: null, alt: null, dt: 0, why: '', limit: null, hover: null, label: '' };
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  // Smallest of 1, 2, 2.5, 5 × 10^k that is at least `raw`, so a grid drawn with it has at most
  // about (range / raw) + 1 lines whatever the range is: the chart's work never grows with the input.
  function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function drawChart() {
    var cv = el.chart, dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, Hh = cv.clientHeight;
    if (!W || !Hh) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    var alt = chart.alt;
    if (alt == null) { g.fillStyle = cssVar('--muted'); g.font = '14px ' + cssVar('--sans'); g.fillText('No chart: ' + (chart.why || 'the condition could not be evaluated.'), 12, 24); return; }
    var dT = chart.dt;
    var narrow = W < 480;
    var pad = { l: narrow ? 44 : 56, r: narrow ? 12 : 92, t: 14, b: 36 };
    var pw = W - pad.l - pad.r, ph = Hh - pad.t - pad.b;
    // Range: at least 1000 m/s, and a quarter beyond the current speed, rounded up to 250, but never
    // past the speed where T0 reaches the perfect-gas ceiling at this altitude (1,855–1,909 m/s), so the
    // axis is bounded whatever was typed and every point drawn is one the model stands behind.
    var vCeil = H.ceilingSpeed(ctx, alt, dT);
    var vmax = Math.min(Math.ceil(Math.max(1000, chart.v != null ? chart.v * 1.25 : 0) / 250) * 250, vCeil);
    var capped = vmax === vCeil;
    var top = H.aerotherm(ctx, vmax, alt, dT);
    var Tinf = top.T_inf_K - H.KELVIN;
    var ymin = Math.min(Tinf - 20, chart.limit != null ? chart.limit - 40 : Infinity);
    var ymax = Math.max(top.T0_K - H.KELVIN, chart.limit != null ? chart.limit + 40 : -Infinity) * 1.04;
    var X = function (v) { return pad.l + pw * v / vmax; };
    var Y = function (T) { return pad.t + ph * (1 - (T - ymin) / (ymax - ymin)); };
    // grid: a nice step giving about six intervals on each axis, so the loops below are O(1)
    g.strokeStyle = cssVar('--line'); g.lineWidth = 1; g.fillStyle = cssVar('--muted'); g.font = '11px ' + cssVar('--sans');
    var ystep = niceStep((ymax - ymin) / 6);
    for (var T = Math.ceil(ymin / ystep) * ystep; T <= ymax; T += ystep) { g.beginPath(); g.moveTo(pad.l, Y(T)); g.lineTo(W - pad.r, Y(T)); g.stroke(); g.textAlign = 'right'; g.fillText(T + '°', pad.l - 6, Y(T) + 4); }
    var xstep = niceStep(vmax / (narrow ? 3 : 5));
    for (var v = 0; v <= vmax; v += xstep) { g.beginPath(); g.moveTo(X(v), pad.t); g.lineTo(X(v), Hh - pad.b); g.stroke(); g.textAlign = 'center'; g.fillText(v + (v === 0 ? ' m/s' : ''), X(v), Hh - pad.b + 16); }
    g.textAlign = 'center'; g.fillText('speed, m/s, at ' + thousands(alt) + ' m' + (dT ? ', ISA' + signed(dT, 0) + ' K' : ''), pad.l + pw / 2, Hh - 6);
    if (capped) {
      // The axis stops at the ceiling; say so at the right edge, clear of the current-speed dot that sits there.
      g.save(); g.setLineDash([2, 3]); g.strokeStyle = cssVar('--muted'); g.beginPath(); g.moveTo(X(vmax), pad.t); g.lineTo(X(vmax), Hh - pad.b); g.stroke(); g.restore();
      var clab = thousands(H.T0_MAX_K) + ' K ceiling at ' + thousands(vmax) + ' m/s';
      g.font = '11px ' + cssVar('--sans');
      var cw = g.measureText(clab).width, cx = X(vmax) - 12 - cw, cy = pad.t + 12;
      g.fillStyle = cssVar('--card'); g.globalAlpha = 0.85; g.fillRect(cx - 3, cy - 11, cw + 6, 14); g.globalAlpha = 1;
      g.fillStyle = cssVar('--muted'); g.textAlign = 'left'; g.fillText(clab, cx, cy);
    }
    // limit line
    if (chart.limit != null) {
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = cssVar('--lim'); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(pad.l, Y(chart.limit)); g.lineTo(W - pad.r, Y(chart.limit)); g.stroke(); g.restore();
      // The label sits on whichever side the current-speed marker is not.
      var lab = narrow ? chart.shortLabel : chart.label;
      var markerLeft = chart.v != null && X(chart.v) < pad.l + pw / 2;
      g.font = '11px ' + cssVar('--sans');
      var tw = g.measureText(lab).width, lx = markerLeft ? W - pad.r - 4 - tw : pad.l + 6, ly = Y(chart.limit) - 5;
      g.fillStyle = cssVar('--card'); g.globalAlpha = 0.85; g.fillRect(lx - 3, ly - 11, tw + 6, 14); g.globalAlpha = 1;
      g.fillStyle = cssVar('--ink'); g.textAlign = 'left';
      g.fillText(lab, lx, ly);
    }
    // curves
    var series = [
      { k: 'T0_K', c: cssVar('--s1'), label: 'T0' },
      { k: 'Tr_turb_K', c: cssVar('--s2'), label: 'Tr turb' },
      { k: 'Tr_lam_K', c: cssVar('--s3'), label: 'Tr lam' },
    ];
    var N = 80;
    series.forEach(function (s) {
      g.beginPath(); g.strokeStyle = s.c; g.lineWidth = 2;
      for (var i = 0; i <= N; i++) { var vv = vmax * i / N; var y = Y(H.aerotherm(ctx, vv, alt, dT)[s.k] - H.KELVIN); if (i === 0) g.moveTo(X(vv), y); else g.lineTo(X(vv), y); }
      g.stroke();
      if (!narrow) { g.fillStyle = s.c; g.textAlign = 'left'; g.font = '11px ' + cssVar('--sans'); g.fillText(s.label, W - pad.r + 6, Y(top[s.k] - H.KELVIN) + 4); }
    });
    // current speed
    if (chart.v != null) {
      var cur = H.aerotherm(ctx, chart.v, alt, dT);
      g.strokeStyle = cssVar('--muted'); g.lineWidth = 1; g.beginPath(); g.moveTo(X(chart.v), pad.t); g.lineTo(X(chart.v), Hh - pad.b); g.stroke();
      series.forEach(function (s) { g.beginPath(); g.fillStyle = s.c; g.arc(X(chart.v), Y(cur[s.k] - H.KELVIN), 5, 0, Math.PI * 2); g.fill(); g.lineWidth = 2; g.strokeStyle = cssVar('--card'); g.stroke(); });
    }
    // hover crosshair
    if (chart.hover != null) {
      var hv = Math.max(0, Math.min(vmax, chart.hover));
      var hr = H.aerotherm(ctx, hv, alt, dT);
      g.save(); g.setLineDash([2, 3]); g.strokeStyle = cssVar('--ink'); g.lineWidth = 1; g.beginPath(); g.moveTo(X(hv), pad.t); g.lineTo(X(hv), Hh - pad.b); g.stroke(); g.restore();
      series.forEach(function (s) { g.beginPath(); g.fillStyle = cssVar('--card'); g.arc(X(hv), Y(hr[s.k] - H.KELVIN), 4, 0, Math.PI * 2); g.fill(); g.lineWidth = 2; g.strokeStyle = s.c; g.stroke(); });
      text(el.chartRead, 'at ' + f(hv, 0) + ' m/s (Mach ' + f(hr.M, 2) + '): T0 ' + f(hr.T0_K - H.KELVIN, 1) + ' °C · Tr turbulent ' + f(hr.Tr_turb_K - H.KELVIN, 1) + ' · Tr laminar ' + f(hr.Tr_lam_K - H.KELVIN, 1) + (chart.limit != null ? ' · limit ' + chart.limit : ''));
    }
    chart.X = X; chart.vmax = vmax; chart.pad = pad; chart.pw = pw;
  }
  function hoverAt(clientX) {
    if (!chart.X || chart.alt == null) return;
    var rect = el.chart.getBoundingClientRect();
    var x = clientX - rect.left;
    chart.hover = chart.vmax * (x - chart.pad.l) / chart.pw;
    drawChart();
  }
  el.chart.addEventListener('pointermove', function (e) { hoverAt(e.clientX); });
  el.chart.addEventListener('pointerdown', function (e) { hoverAt(e.clientX); });
  el.chart.addEventListener('pointerleave', function () { chart.hover = null; text(el.chartRead, 'Hover or touch the chart to read it.'); drawChart(); });
  window.addEventListener('resize', drawChart);
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawChart); } catch (e) { /* older browsers */ } }

  // ---- provenance footer ---------------------------------------------------------------------------
  (function prov() {
    var p = S.provenance || {};
    var short = (p.commit || '').slice(0, 7);
    var items = [
      'isa() and ISA_GAMMA / ISA_R: PartForge index.html lines ' + (p.index_html && p.index_html.isaLines ? p.index_html.isaLines.join('–') : '?') + ' at ' + short + ', copied verbatim by build-data.mjs into snapshots/partforge.js (sha256 of index.html ' + ((p.index_html && p.index_html.sha256) || '').slice(0, 12) + '…).',
      'service_max_c and confidence per material: data/tables/materials_thermal.json at ' + short + ' (sha256 ' + ((p.materials_thermal && p.materials_thermal.sourceSha256) || '').slice(0, 12) + '…), ' + ctx.rows.length + ' rows, ' + ctx.rows.filter(function (r) { return r.confidence === 'recall'; }).length + ' of them recall. The table’s own note: "service_max_c is judgement, not a rating."',
      'Material names and kinds: FLIGHT_MATERIALS, index.html lines ' + (p.index_html && p.index_html.flightMaterialsLines ? p.index_html.flightMaterialsLines.join('–') : '?') + '.',
      'The worked condition: tests/templates/fin.scad at ' + short + ' (sha256 ' + ((p.fin_scad && p.fin_scad.sourceSha256) || '').slice(0, 12) + '…), FLIGHT loads entry "' + (fin ? fin.name : '') + '", inputs_src ' + (fin ? fin.inputs_src : '') + '.',
      'Pr = 0.71 for air near 300 K [Likely], giving r = Pr½ = ' + f(ctx.gas.r_lam, 4) + ' (laminar) and Pr⅓ = ' + f(ctx.gas.r_turb, 4) + ' (turbulent): the flat-plate recovery factors (Eckert; Schlichting, Boundary-Layer Theory), known from textbooks.',
    ];
    clear(el.prov);
    items.forEach(function (s) { el.prov.appendChild(mk('li', null, s)); });
  })();

  // ---- render ------------------------------------------------------------------------------------
  function render() {
    syncInputs();
    var p = H.parseSpeed(state.speedText);
    var alt = typeof state.alt === 'number' ? state.alt : (String(state.alt).trim() !== '' && isFinite(Number(state.alt)) ? Number(state.alt) : state.alt);
    var dtIn = String(state.dt).trim() === '' ? 0 : state.dt;
    var common = { alt_m: alt, material: state.material, inputs_src: state.src, inputs_ref: state.ref, isa_offset_K: dtIn };
    var v = null;
    var result;
    var withCommon = function (extra) { var o = {}; Object.keys(common).forEach(function (k) { o[k] = common[k]; }); Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return o; };
    if (!p) result = { ok: false, refusal: { code: 'invalid_input', reason: 'The speed field needs a number in m/s (got ' + JSON.stringify(state.speedText) + ').', what_would_help: 'Type the speed in metres per second, for example 700.' } };
    else if (p.kind === 'mach') result = H.screen(ctx, withCommon({ mach: p.mach }));
    else if (p.kind === 'unit' && p.didYouMean) result = { ok: false, refusal: { code: 'invalid_input', reason: '"' + p.unit + '" is not a speed unit: did you mean m/s? It is not read as Mach either; Mach is written "Mach 2" or "M2", and is refused anyway.', what_would_help: 'Type the speed in metres per second, for example ' + p.value + ' or ' + p.value + ' m/s.' } };
    else if (p.kind === 'unit') result = { ok: false, refusal: { code: 'invalid_input', reason: 'Speed in ' + p.unit + ' is not converted here: the template field is v_max_m_s, in metres per second.', what_would_help: 'Convert to m/s yourself and type that number, so the conversion is yours and visible.' } };
    else { v = p.v_m_s; result = H.screen(ctx, withCommon({ v_m_s: v })); }
    if (result.ok) showVerdict(result); else showRefusal(result.refusal);
    var altNum = typeof alt === 'number' && isFinite(alt);
    var atmOk = altNum && !ctx.isa(alt).clamped;
    var dtNum = Number(dtIn);
    var dtOk = String(dtIn).trim() !== '' && isFinite(dtNum) && dtNum >= H.ISA_DT_MIN_K && dtNum <= H.ISA_DT_MAX_K;
    drawTable(result.ok || (v != null && v >= 0 && atmOk && dtOk) ? v : null, alt, dtIn);
    var mat = H.materialInfo(ctx, state.material);
    // The marker is drawn only for a speed the model accepts: inside the ISA table and under the ceiling.
    chart.dt = dtOk ? dtNum : 0;
    chart.v = (v != null && v >= 0 && atmOk && dtOk && v <= H.ceilingSpeed(ctx, alt, chart.dt)) ? v : null;
    chart.alt = atmOk && dtOk ? alt : null;
    chart.why = !altNum ? 'the altitude is not a number.' : !atmOk ? 'the altitude is outside the ISA table.' : !dtOk ? 'the day offset is outside the ' + H.ISA_DT_MIN_K + ' to +' + H.ISA_DT_MAX_K + ' K band.' : '';
    chart.limit = isFinite(mat.service_max_c) ? mat.service_max_c : null;
    chart.label = 'service_max_c ' + mat.service_max_c + ' °C · ' + mat.name + ' (' + mat.confidence + ')';
    chart.shortLabel = 'limit ' + mat.service_max_c + ' °C (' + mat.confidence + ')';
    drawChart();
  }

  // ---- events ------------------------------------------------------------------------------------
  el.speed.addEventListener('input', function () { state.speedText = el.speed.value; render(); });
  el.speedRange.addEventListener('input', function () { state.speedText = el.speedRange.value; render(); });
  el.alt.addEventListener('input', function () { if (el.alt.value.trim() === '') return; state.alt = Number(el.alt.value); render(); });
  el.dt.addEventListener('input', function () { state.dt = el.dt.value; render(); });
  el.ref.addEventListener('input', function () { state.ref = el.ref.value; render(); });
  el.altRange.addEventListener('input', function () { state.alt = Number(el.altRange.value); render(); });
  el.material.addEventListener('change', function () { state.material = el.material.value; render(); });
  el.src.addEventListener('change', function () { state.src = el.src.value; render(); });
  el.finBtn.addEventListener('click', function () { state.speedText = String(FIN.v); state.alt = FIN.alt; state.dt = '0'; state.material = FIN.material; state.src = FIN.src; state.ref = ''; el.dt.value = '0'; el.ref.value = ''; render(); });

  render();
})();
