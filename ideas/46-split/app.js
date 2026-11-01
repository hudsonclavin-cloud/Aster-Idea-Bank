/* Split (idea 46): the page. Wires idea 31's and idea 32's kernels and this module's, runs the plant, draws it. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.Mixture, PF = window.PartForgeISA;
  var db = M.parseThermo(window.THERMO_EXCERPT);
  var B = window.Bell.create({ Mixture: M, db: db, charts: window.NOZZLE_CHARTS, rules: window.NOZZLE_RULES, isa: PF.isa, g0: PF.ISA_G0 });
  var K = window.Split.create({ Mixture: M, db: db, B: B, sources: window.SplitSources, materials: window.SplitMaterials, factor: window.SplitFactor, table: window.SP8120_TABLE1,
    presets: window.MixturePresets.PRESETS, densities: window.PROPELLANT_DENSITIES, g0: PF.ISA_G0 });
  var S0 = K.sources, G0 = PF.ISA_G0;

  function f(x, d) { if (x === null || x === undefined || !isFinite(x)) return '–'; var a = Math.abs(x); if (a !== 0 && (a < 1e-3 || a >= 1e7)) return x.toExponential(Math.max(1, (d || 3) - 1)); return String(+x.toPrecision(d || 3)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }
  function kg(x) { return !isFinite(x) ? '–' : Math.abs(x) >= 1 || x === 0 ? f(x, 4) + ' kg' : f(x * 1000, 3) + ' g'; }
  function pct(x) { return (x >= 0 ? '+' : '') + f(x * 100, 3) + ' %'; }

  var CASES = { chain: { label: 'the chain at Apophis (idea 45\'s committed handoff)', h: window.SplitDigSample }, bennu: { label: 'Bennu (idea 45\'s kernel on its OSIRIS-REx case)', h: window.SplitDigBennu } };
  var state = { caseKey: 'chain', imported: null, srcCache: {}, S: null, R: null, routes: null, timer: null, seq: 0 };

  function src() {
    if (state.caseKey === 'imported' && state.imported) return state.imported;
    if (!state.srcCache[state.caseKey]) {
      var p = K.parseHandoff(CASES[state.caseKey].h);
      state.srcCache[state.caseKey] = p.refusal ? p : p.src;
    }
    return state.srcCache[state.caseKey];
  }

  // ---------------------------------------------------------------- controls
  $('cellSel').innerHTML = Object.keys(K.CELL_PRESETS).map(function (k) { return '<option value="' + k + '">' + esc(K.CELL_PRESETS[k].label) + '</option>'; }).join('') + '<option value="custom">Set the voltage</option>';
  $('matSel').innerHTML = Object.keys(K.materials.metals).map(function (k) { var m = K.materials.metals[k]; return '<option value="' + k + '">' + esc(m.name) + ' (ultimate ' + m.su_MPa + ' MPa' + (m.verify ? ', PartForge: verify' : '') + ')</option>'; }).join('');
  // [number input, range input, settings key, display = value x scale, range transform]
  var NUM = [['vIn', 'vRange', 'V_custom', 1], ['etaIn', null, 'etaF', 1], ['tcIn', null, 'T_cell', 1], ['pIn', 'pRange', 'P1au', 1, 'log'], ['twbIn', 'twbRange', 'Twb', 1], ['fcIn', null, 'fCarnot90', 1],
    ['psIn', 'psRange', 'p_store_MPa', 1], ['thIn', 'thRange', 'T_heat', 1], ['spcIn', null, 'pc_steam', 1e-5], ['sepsIn', null, 'eps_steam', 1], ['ofIn', 'ofRange', 'of', 1], ['pcIn', null, 'pc', 1e-5], ['epsIn', null, 'eps', 1], ['dryIn', null, 'dry_kg', 1]];
  function syncControls() {
    var S = state.S;
    NUM.forEach(function (q) {
      var v = +(S[q[2]] * q[3]).toPrecision(6);
      $(q[0]).value = v;
      if (q[1]) $(q[1]).value = q[4] === 'log' ? Math.log10(v) : v;
    });
    $('cellSel').value = S.cell; $('matSel').value = S.material;
    $('vRow').classList.toggle('hide', S.cell !== 'custom');
    var route = S.route;
    $('fsCell').classList.toggle('hide', route === 'steam'); $('fsPower').classList.toggle('hide', route === 'steam');
    $('fsCryo').classList.toggle('hide', route !== 'cryo'); $('fsGas').classList.toggle('hide', route !== 'gas'); $('fsSteam').classList.toggle('hide', route !== 'steam');
    $('fsMat').classList.toggle('hide', route === 'cryo'); $('fsEngine').classList.toggle('hide', route === 'steam');
    $('ofRow').classList.toggle('hide', S.of_mode !== 'fixed');
    var pressed = function (sel, attr, val) { document.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset[attr] === val)); }); };
    pressed('[data-case]', 'case', state.caseKey); pressed('[data-route]', 'route', route); pressed('[data-zbo]', 'zbo', S.zbo ? 'on' : 'off'); pressed('[data-of]', 'of', S.of_mode);
    pressed('[data-arr]', 'arr', S.array);
  }
  function schedule(delay) { clearTimeout(state.timer); state.timer = setTimeout(run, delay === undefined ? 250 : delay); }
  NUM.forEach(function (q) {
    var a = $(q[0]), b = q[1] && $(q[1]);
    function set(v) { if (v === '' || !isFinite(+v)) return false; state.S[q[2]] = +v / q[3]; if (q[2] === 'P1au') state.S.array = 'custom'; if (q[2] === 'of') state.S.of_mode = 'fixed'; return true; }
    a.addEventListener('input', function () { if (set(a.value) && b) b.value = q[4] === 'log' ? Math.log10(+a.value) : a.value; schedule(500); });
    a.addEventListener('change', function () { set(a.value); syncControls(); schedule(30); });
    if (b) b.addEventListener('input', function () { var v = q[4] === 'log' ? +Math.pow(10, +b.value).toPrecision(3) : +b.value; a.value = v; set(v); schedule(150); });
  });
  $('cellSel').addEventListener('change', function () { state.S.cell = $('cellSel').value; syncControls(); schedule(10); });
  $('matSel').addEventListener('change', function () { state.S.material = $('matSel').value; schedule(10); });
  document.querySelectorAll('[data-route]').forEach(function (b) { b.addEventListener('click', function () { state.S.route = b.dataset.route; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-zbo]').forEach(function (b) { b.addEventListener('click', function () { state.S.zbo = b.dataset.zbo === 'on'; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-of]').forEach(function (b) { b.addEventListener('click', function () { state.S.of_mode = b.dataset.of; if (b.dataset.of === 'fixed' && state.R && state.R.prop && state.R.prop.mixture_ratio) state.S.of = +state.R.prop.mixture_ratio.toFixed(2); syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-arr]').forEach(function (b) { b.addEventListener('click', function () { state.S.array = b.dataset.arr; state.S.P1au = K.ARRAYS[b.dataset.arr].P1; syncControls(); schedule(10); }); });
  document.querySelectorAll('[data-case]').forEach(function (b) { b.addEventListener('click', function () { if (state.caseKey === b.dataset.case) return; state.caseKey = b.dataset.case; resetS(); syncControls(); schedule(10); }); });
  $('resetBtn').addEventListener('click', function () { var r = state.S.route; resetS(); state.S.route = r; syncControls(); schedule(10); });
  function resetS() { var s = src(); state.S = s.refusal ? (state.S || K.defaults(null)) : K.defaults(s); state.S.array = 'near'; }

  // ---------------------------------------------------------------- running
  function run() {
    var s = src();
    if (s.refusal) { state.R = { refusal: s.refusal }; state.routes = null; render(); state.seq++; return; }
    var t0 = Date.now();
    state.R = K.run(s, state.S);
    state.routes = {};
    ['cryo', 'gas', 'steam'].forEach(function (r) { state.routes[r] = r === state.S.route ? state.R : K.run(s, Object.assign({}, state.S, { route: r })); });
    var dt = Date.now() - t0;
    $('runNote').textContent = state.R.refusal ? '' : 'Ran the stay (' + s.days.length + ' days) three ways in ' + (dt < 1 ? 'under 1' : dt) + ' ms.';
    render();
    state.seq++;
  }

  // ---------------------------------------------------------------- rendering
  function tile(k, v, u, conf, sub, cls) { return '<div class="tile ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + (conf ? '<span class="c">' + conf + '</span>' : '') + '</div>'; }
  function refusalHtml(r) { return '<div class="refusal"><b>' + esc(r.code.replace(/_/g, ' ')) + (r.applies_to ? ' · ' + esc(r.applies_to) : '') + (r.from ? ' · from ' + esc(r.from) : '') + '</b>' + esc(r.reason) + '<div class="help">What would help: ' + esc(r.what_would_help) + '</div></div>'; }
  var CHARTS = ['stockChart', 'powerChart', 'ofChart', 'voltChart', 'tankChart', 'steamChart'];

  function render() {
    var R = state.R, s = src();
    $('srcLine').textContent = s.refusal ? '' : 'Water from ' + (state.caseKey === 'imported' ? 'an imported idea 45 handoff' : CASES[state.caseKey].label) + ': ' + s.site.body + ', ' + s.days.length + ' days from ' + s.days[0].utc0.slice(0, 10) + ' (UTC), ' + f(s.water.total_kg, 4) + ' kg of water in all' + (s.bound === 'upper' ? ' (an upper bound)' : '') + '; craft ' + f(s.site.mass_kg, 4) + ' kg.';
    if (!R || R.refusal) {
      $('tiles').innerHTML = ''; $('energy').innerHTML = ''; $('resLine').textContent = '';
      $('refusals').innerHTML = R && R.refusal ? refusalHtml(R.refusal) : '';
      $('carried').classList.add('hide');
      CHARTS.forEach(function (id) { blank($(id)); });
      ['stockCap', 'powerCap', 'ofCap', 'voltCap', 'tankCap', 'steamCap'].forEach(function (id) { $(id).textContent = ''; });
      $('routeTable').querySelector('tbody').innerHTML = '';
      renderChecks();
      return;
    }
    var st = R.settings, p = R.prop, L0 = R.L, conf = s.bound === 'upper' ? 'assumed · at most' : 'derived';
    var win = L0.rows.reduce(function (a, r) { return a + r.water_in; }, 0);
    $('resLine').innerHTML = esc(st.route === 'cryo' ? 'Split by ' + f(st.P1au / 1000, 3) + ' kW arrays (at 1 au), liquefied at 1 atm and kept in insulated spheres.' : st.route === 'gas' ? 'Split by ' + f(st.P1au / 1000, 3) + ' kW arrays (at 1 au), delivered by the cell itself at ' + f(st.p_store_MPa, 3) + ' MPa into metal spheres.' : 'Not split: the water is kept liquid and boiled in a steam thruster on the way home.');
    var t = '';
    t += tile('Return propellant', p.mass_kg > 0 ? f(p.mass_kg, 4) : '0', 'kg', conf, st.route === 'steam' ? 'water' : p.mass_kg > 0 ? f(p.fuel_kg, 3) + ' kg H₂ + ' + f(p.oxidizer_kg, 3) + ' kg O₂' : 'nothing left to burn', 'hero' + (p.mass_kg > 0 ? '' : ' bad'));
    t += tile('Specific impulse, vacuum', p.isp_s ? f(p.isp_s, 4) : '–', 's', st.route === 'steam' ? 'derived · ideal' : 'derived', st.route === 'steam' ? (R.steam && R.steam.frozenOnly ? 'frozen expansion (equilibrium has no answer here)' : 'shifting; frozen ' + f(p.isp_frozen_s, 4) + ' s') : 'ideal ' + f(p.isp_ideal_s, 4) + ' s × RL10A-3-3 ' + f(K.RL10.eta, 4) + '; frozen ' + f(p.isp_frozen_s, 4) + ' s');
    if (st.route !== 'steam') t += tile('Mixture ratio burned', p.mixture_ratio ? f(p.mixture_ratio, 3) : '–', 'O/F', 'derived', (st.of_mode === 'optimal' ? 'the most Δv' : st.of_mode === 'stoich' ? 'all the oxygen' : 'set here') + (p.Tc_K ? '; chamber ' + f(p.Tc_K, 4) + ' K' : '') + '; water carries ' + f(K.R_ST, 4));
    else t += tile('Heater', f(st.T_heat, 4), 'K', 'assumed', f(R.steam.heat / 1e6, 3) + ' MJ per kg of water; ' + f(R.steam.thrustPerW * 1000, 3) + ' mN per kW of heat');
    t += tile('Δv on the way home', f(R.dv, 4), 'm/s', 'derived · estimate', 'on ' + f(R.dryHome, 4) + ' kg dry (craft ' + f(st.dry_kg, 4) + ' kg + tanks and coolers); module 47 computes the return');
    if (st.route !== 'steam') {
      t += tile('Water split', f(L0.split, 4), 'kg', conf, 'of ' + f(win, 4) + ' kg mined; ' + (L0.buffer > 1e-9 ? f(L0.buffer, 4) + ' kg left as water' : 'none left') + '; power limited ' + L0.rows.filter(function (r) { return r.limit === 'power'; }).length + ' of ' + L0.rows.length + ' days', L0.buffer > 1e-9 ? 'warn' : '');
      t += tile('Cell', f(R.cell.V, 4), 'V', 'derived', 'reversible ' + f(R.cell.Erev, 4) + ' V, thermoneutral ' + f(R.cell.Etn, 4) + ' V; ' + f(R.cell.e_J_per_kg_water / 1e6, 4) + ' MJ per kg of water (' + f(R.cell.kWh_per_kg_h2, 3) + ' kWh/kg H₂)');
    }
    if (st.route === 'cryo') {
      t += tile('Boil-off over the stay', f(L0.boil.h2 + L0.boil.o2, 3), 'kg', 'derived · lower bound', f(L0.boil.h2, 3) + ' kg H₂ (' + f(L0.made.h2 > 0 ? L0.boil.h2 / L0.made.h2 * 100 : 0, 3) + ' % of it), ' + f(L0.boil.o2, 3) + ' kg O₂; leak ' + f((R.tanks.leak.h2 + R.tanks.leak.o2), 3) + ' W at ' + f(R.mli.q, 3) + ' W/m²', L0.boil.h2 > 0.2 * L0.made.h2 ? 'warn' : '');
      t += tile('20 K coolers', String(L0.coolMax), L0.coolMax === 1 ? 'unit' : 'units', 'measured · NASA/Creare', f(L0.coolMax * K.CC_UNIT_KG, 4) + ' kg carried home (no electronics); a 90 K stage at ' + f(R.sp90, 3) + ' W per W, mass not on file');
      t += tile('Tanks (volume)', f((R.tanks.VH + R.tanks.VO) * 1000, 4), 'L', 'derived', f(R.tanks.VH * 1000, 4) + ' L LH₂ at ' + f(K.PH2.sat.rho_l, 4) + ' kg/m³, ' + f(R.tanks.VO * 1000, 4) + ' L LOX; wall mass refused');
    }
    if (st.route === 'gas') t += tile('Tanks carried home', f(p.tanks.h2_kg + p.tanks.o2_kg, 4), 'kg', 'derived', f((p.tanks.h2_kg + p.tanks.o2_kg) / Math.max(p.mass_kg, 1e-12), 3) + ' kg per kg of propellant; hydrogen Z ' + f(R.tanks.ZH, 4) + ' at ' + f(st.p_store_MPa, 3) + ' MPa', 'warn');
    if (st.route === 'steam') t += tile('Water tank', f(p.tank.mass_kg, 4), 'kg', 'derived', f(p.tank.volume_m3 * 1000, 4) + ' L at ' + f(st.pc_steam / 1e5, 3) + ' bar (pressure-fed), ' + esc(p.tank.material));
    $('tiles').innerHTML = t;
    // where the energy goes
    if (st.route !== 'steam' && L0.split > 0) {
      var eEl = L0.split * R.cell.e_J_per_kg_water, eAll = L0.energy, parts = [['Electrolysis: products', L0.split * R.cell.el.dH / K.MW.h2o, css('--s1')], ['Electrolysis: heat', L0.split * R.cell.heat_J_per_kg_water, css('--s2')], ['Coolers', Math.max(0, eAll - eEl), css('--s3')]];
      $('energy').innerHTML = '<div class="small" style="margin-top:10px">Where the stay\'s ' + f(eAll / 3.6e6, 3) + ' kWh of array energy went (' + f(eAll / L0.split / 1e6, 3) + ' MJ per kg of water split):</div><div class="energybar">' +
        parts.map(function (q) { return '<i style="width:' + (q[1] / eAll * 100).toFixed(2) + '%;background:' + q[2] + '" title="' + esc(q[0]) + '"></i>'; }).join('') + '</div><ul class="legend">' +
        parts.map(function (q) { return '<li><span class="key dot" style="background:' + q[2] + '"></span>' + esc(q[0]) + ' ' + f(q[1] / eAll * 100, 3) + ' %</li>'; }).join('') + '</ul>';
    } else $('energy').innerHTML = '';
    $('refusals').innerHTML = R.own.map(refusalHtml).join('');
    $('carried').classList.toggle('hide', !s.carried.length);
    $('carriedSum').textContent = s.carried.length + ' refusals carried from ideas 40 to 45';
    $('carriedList').innerHTML = s.carried.map(refusalHtml).join('');
    renderRoutes();
    drawStock(); drawPower(); drawOF(); drawVolt(); drawTank(); drawSteam();
    renderChecks();
  }

  function renderRoutes() {
    var rows = ['cryo', 'gas', 'steam'].map(function (k) {
      var R = state.routes[k], name = { cryo: 'Split and liquefy', gas: 'Split and compress', steam: 'Keep the water (steam)' }[k];
      if (!R || R.refusal) return '<tr><td data-k="Route">' + name + '</td><td colspan="5">' + esc(R && R.refusal ? R.refusal.reason : 'not run') + '</td></tr>';
      var p = R.prop, lim;
      if (k === 'cryo') lim = (R.L.buffer > 1e-9 ? f(R.L.buffer, 3) + ' kg of water unsplit (power); ' : '') + f(R.L.boil.h2, 3) + ' kg H₂ boiled off; ' + R.L.coolMax + ' × 106 kg coolers';
      else if (k === 'gas') lim = (R.L.buffer > 1e-9 ? f(R.L.buffer, 3) + ' kg of water unsplit (power); ' : '') + f(p.tanks.h2_kg + p.tanks.o2_kg, 4) + ' kg of tanks';
      else lim = 'Isp ' + f(p.isp_s, 3) + ' s' + (R.steam && R.steam.frozenOnly ? ' (frozen)' : '') + '; heater ' + f(R.settings.T_heat, 4) + ' K needs ' + f(R.steam.heat / 1e6, 3) + ' MJ/kg';
      return '<tr class="' + (k === state.S.route ? 'on' : '') + '"><td data-k="Route"><b>' + name + '</b></td><td class="n" data-k="Propellant">' + kg(p.mass_kg) + '</td><td class="n" data-k="Isp">' + (p.isp_s ? f(p.isp_s, 4) + ' s' : '–') + '</td><td class="n" data-k="Dry home">' + kg(R.dryHome) + '</td><td class="n" data-k="Δv">' + f(R.dv, 4) + ' m/s</td><td data-k="Limits">' + esc(lim) + '</td></tr>';
    });
    $('routeTable').querySelector('tbody').innerHTML = rows.join('');
  }

  function renderChecks() {
    $('checkTable').querySelector('tbody').innerHTML = K.reality().map(function (r) {
      var good = r.gap !== null && Math.abs(r.gap) < 0.03;
      return '<tr><td data-k="Check">' + esc(r.check) + '<span class="why">' + esc(r.source) + '</span></td><td class="n" data-k="Reality">' + f(r.reality, 6) + ' ' + esc(r.units) + '</td><td class="n" data-k="This page">' + f(r.model, 6) + ' ' + esc(r.units) + '</td><td class="n ' + (good ? 'gap-ok' : 'gap-bad') + '" data-k="Gap">' + (r.gap === null ? '–' : pct(r.gap)) + '</td></tr>';
    }).join('');
  }

  // ---------------------------------------------------------------- charts
  function setup(cv, aspect) {
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = Math.round(Math.min(340, Math.max(210, w * (aspect || 0.62))));
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function blank(cv) { var c = setup(cv); c.ctx.clearRect(0, 0, c.w, c.h); }
  function frame(cv, o) {
    var c = setup(cv), ctx = c.ctx, pl = 52, pr = o.y2 ? 50 : 12, pt = 12, pb = 34, W = c.w - pl - pr, H = c.h - pt - pb;
    ctx.clearRect(0, 0, c.w, c.h);
    var tx = function (v) { var u = o.xlog ? (Math.log10(v) - Math.log10(o.x[0])) / (Math.log10(o.x[1]) - Math.log10(o.x[0])) : (v - o.x[0]) / (o.x[1] - o.x[0]); return pl + u * W; };
    var mk = function (r, log) { return function (v) { var u = log ? (Math.log10(v) - Math.log10(r[0])) / (Math.log10(r[1]) - Math.log10(r[0])) : (v - r[0]) / (r[1] - r[0]); return pt + (1 - u) * H; }; };
    var ty = mk(o.y, o.ylog), ty2 = o.y2 ? mk(o.y2, false) : null;
    function ticks(lo, hi, log) { var out = []; if (log) { for (var e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) { var v = Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } return out; } var step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); var n = (hi - lo) / step; if (n > 10) step *= 2; if (n > 20) step *= 2.5; for (var x = Math.ceil(lo / step) * step; x <= hi + 1e-9; x += step) out.push(+x.toPrecision(10)); return out; }
    function lab(v, log) { if (log) { var e = Math.round(Math.log10(v)); return e >= -2 && e <= 4 ? String(+v.toPrecision(3)) : '1e' + e; } return String(+v.toPrecision(4)); }
    ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--grid'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
    var xt = ticks(o.x[0], o.x[1], o.xlog), yt = ticks(o.y[0], o.y[1], o.ylog);
    var maxX = Math.max(3, Math.floor(W / 60)); while (xt.length > maxX) xt = xt.filter(function (_, i) { return i % 2 === 0; });
    while (yt.length > 7) yt = yt.filter(function (_, i) { return i % 2 === 0; });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.forEach(function (v) { var X = tx(v); ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.fillText(lab(v, o.xlog), X, pt + H + 4); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(function (v) { var Y = ty(v); ctx.beginPath(); ctx.moveTo(pl, Y); ctx.lineTo(pl + W, Y); ctx.stroke(); ctx.fillText(lab(v, o.ylog), pl - 4, Y); });
    if (ty2) { ctx.textAlign = 'left'; var y2t = ticks(o.y2[0], o.y2[1], false); while (y2t.length > 7) y2t = y2t.filter(function (_, i) { return i % 2 === 0; }); y2t.forEach(function (v) { ctx.fillText(lab(v, false), pl + W + 4, ty2(v)); }); }
    ctx.strokeStyle = css('--axis'); ctx.strokeRect(pl, pt, W, H);
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xl || '', pl + W / 2, c.h - 1);
    ctx.save(); ctx.translate(11, pt + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(o.yl || '', 0, 0); ctx.restore();
    if (o.y2l) { ctx.save(); ctx.translate(c.w - 9, pt + H / 2); ctx.rotate(Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(o.y2l, 0, 0); ctx.restore(); }
    function clip() { ctx.save(); ctx.beginPath(); ctx.rect(pl, pt, W, H); ctx.clip(); }
    function line(xs, ys, color, dash, width, tyf) { tyf = tyf || ty; clip(); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); var on = false; for (var i = 0; i < xs.length; i++) { var a = xs[i], b = ys[i]; if (a === null || b === null || !isFinite(a) || !isFinite(b) || (o.ylog && tyf === ty && b <= 0)) { on = false; continue; } var X = tx(a), Y = tyf(b); if (!on) { ctx.moveTo(X, Y); on = true; } else ctx.lineTo(X, Y); } ctx.stroke(); ctx.restore(); }
    return {
      ctx: ctx, tx: tx, ty: ty, ty2: ty2, pl: pl, pt: pt, W: W, H: H, c: c,
      line: line,
      dots: function (xs, ys, color, r, tyf) { tyf = tyf || ty; clip(); ctx.fillStyle = color; for (var i = 0; i < xs.length; i++) { if (!isFinite(xs[i]) || !isFinite(ys[i])) continue; ctx.beginPath(); ctx.arc(tx(xs[i]), tyf(ys[i]), r || 3, 0, 2 * Math.PI); ctx.fill(); } ctx.restore(); },
      vband: function (x0, x1, color) { clip(); ctx.fillStyle = color; ctx.fillRect(tx(x0), pt, tx(x1) - tx(x0), H); ctx.restore(); },
      vmark: function (v, color, text, dash, right) { var X = tx(v); if (X < pl - 0.5 || X > pl + W + 0.5) return; ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash || [4, 3]); ctx.beginPath(); ctx.moveTo(X, pt); ctx.lineTo(X, pt + H); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, X + (right ? -3 : 3), pt + 2); } ctx.restore(); },
      hmark: function (v, color, text, dash, tyf) { tyf = tyf || ty; var Y = tyf(v); if (Y < pt || Y > pt + H) return; ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash || [4, 3]); ctx.beginPath(); ctx.moveTo(pl, Y); ctx.lineTo(pl + W, Y); ctx.stroke(); ctx.setLineDash([]); if (text) { ctx.fillStyle = color; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(text, pl + 4, Y - 2); } ctx.restore(); },
      note: function (text) { ctx.save(); ctx.fillStyle = css('--ink-2'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, pl + W / 2, pt + H / 2); ctx.restore(); },
    };
  }
  function legend(id, items) { $(id).innerHTML = items.map(function (it) { return '<li><span class="key ' + (it[2] || '') + '" style="' + (it[2] === 'dot' || it[2] === 'band' ? 'background:' : 'border-color:') + it[1] + '"></span>' + esc(it[0]) + '</li>'; }).join(''); }
  function cum(a) { var s = 0; return a.map(function (v) { s += v; return s; }); }

  function drawStock() {
    var R = state.R, rows = R.L.rows, days = rows.map(function (r) { return r.day; });
    var wIn = cum(rows.map(function (r) { return r.water_in; })), split = cum(rows.map(function (r) { return r.split_kg; }));
    var stock = rows.map(function (r) { return r.h2_kg + r.o2_kg; }), boil = cum(rows.map(function (r) { return r.boil_h2 + r.boil_o2; }));
    var steam = R.settings.route === 'steam';
    var top = Math.max.apply(null, wIn) * 1.05 || 1;
    var c = frame($('stockChart'), { x: [0, days.length + 1], y: [0, top], xl: 'day of the stay', yl: 'kg' });
    rows.forEach(function (r) { if (r.limit === 'power') c.vband(r.day - 0.5, r.day + 0.5, css('--refused')); });
    c.line([0].concat(days), [0].concat(wIn), css('--ink-2'), [5, 4], 1.5);
    if (!steam) { c.line([0].concat(days), [0].concat(split), css('--s1')); c.line([0].concat(days), [0].concat(stock), css('--s3'), null, 2.5); }
    if (R.settings.route === 'cryo') c.line([0].concat(days), [0].concat(boil), css('--s2'));
    var items = [['water mined (idea 45)', css('--ink-2'), 'dash']];
    if (!steam) items.push(['water split', css('--s1')], ['H₂ + O₂ in the tanks', css('--s3')]);
    if (R.settings.route === 'cryo') items.push(['boiled off', css('--s2')]);
    if (rows.some(function (r) { return r.limit === 'power'; })) items.push(['days the arrays limited', css('--refused'), 'band']);
    legend('stockLegend', items);
    $('stockCap').textContent = steam ? 'Kept as water, all ' + f(wIn[wIn.length - 1], 4) + ' kg of it is propellant; nothing is split, so nothing boils.' :
      'By the end: ' + f(split[split.length - 1], 4) + ' kg of water split, ' + f(stock[stock.length - 1], 4) + ' kg of hydrogen and oxygen in the tanks' + (R.settings.route === 'cryo' ? ', ' + f(boil[boil.length - 1], 4) + ' kg boiled away' : '') + (R.L.vented > 1e-9 ? ', ' + f(R.L.vented, 4) + ' kg of oxygen vented (more than the burn uses)' : '') + '.';
  }
  function drawPower() {
    var R = state.R, rows = R.L.rows, days = rows.map(function (r) { return r.day; });
    if (R.settings.route === 'steam') { var c0 = frame($('powerChart'), { x: [0, days.length + 1], y: [0, 1], xl: 'day of the stay', yl: 'W' }); c0.note('The steam route uses no power at the asteroid.'); legend('powerLegend', []); $('powerCap').textContent = 'Power is needed on the way home instead: ' + f(R.steam.heat / 1e6, 3) + ' MJ per kg of water at the heater.'; return; }
    var P = rows.map(function (r) { return r.P_W; }), U = rows.map(function (r) { return r.used_W; });
    var c = frame($('powerChart'), { x: [0, days.length + 1], y: [0, Math.max.apply(null, P) * 1.08], xl: 'day of the stay', yl: 'W while the Sun is up' });
    c.line(days, P, css('--s1')); c.line(days, U, css('--s2'), null, 2.5);
    legend('powerLegend', [['arrays give (1/r², idea 45\'s distance)', css('--s1')], ['plant uses', css('--s2')]]);
    var mean = rows.reduce(function (a, r) { return a + r.lit_h; }, 0) / rows.length;
    $('powerCap').textContent = 'The Sun is up ' + f(mean, 3) + ' h a day on average at this site (idea 45). ' + (R.L.zboShort ? 'On ' + R.L.zboShort + ' days the arrays could not even run the coolers. ' : '') + (R.settings.route === 'cryo' ? 'A 20 K cooler draws 631 W before it lifts anything.' : '');
  }
  function drawOF() {
    var R = state.R, cv = $('ofChart');
    if (!R.trade) { var c0 = frame(cv, { x: [2, 8], y: [0, 1], xl: 'mixture ratio O/F', yl: 'Isp, s' }); c0.note('Steam has no mixture ratio.'); legend('ofLegend', []); $('ofCap').textContent = 'Switch to a splitting route to choose the mixture ratio.'; return; }
    var pts = R.trade.pts, xs = pts.map(function (q) { return q.r; });
    var isp = pts.map(function (q) { return q.isp ? q.isp / G0 : null; }), ideal = pts.map(function (q) { return q.ideal ? q.ideal / G0 : null; }), fro = pts.map(function (q) { return q.frozen ? q.frozen / G0 : null; });
    var dv = pts.map(function (q) { return q.r <= R.trade.rMax + 1e-9 && isFinite(q.dv) && q.dv > 0 ? q.dv : null; });
    var all = isp.concat(ideal, fro).filter(function (v) { return v; });
    var dvs = dv.filter(function (v) { return v; });
    var y2 = dvs.length ? [0, Math.max.apply(null, dvs) * 1.1] : [0, 1];
    var c = frame(cv, { x: [2, 8], y: [Math.floor(Math.min.apply(null, all) / 10) * 10 - 10, Math.ceil(Math.max.apply(null, all) / 10) * 10 + 5], xl: 'mixture ratio O/F (oxygen : hydrogen by mass)', yl: 'Isp, s', y2: y2, y2l: 'Δv, m/s' });
    if (R.trade.rMax < K.R_ST - 1e-6) c.vband(R.trade.rMax, K.R_ST, css('--refused'));
    c.line(xs, ideal, css('--s1'), [5, 4], 1.5); c.line(xs, fro, css('--s1'), [2, 3], 1.5); c.line(xs, isp, css('--s1'), null, 2.5);
    c.line(xs, dv, css('--s3'), null, 2.5, c.ty2);
    if (R.settings.route === 'cryo') c.dots([K.RL10.of], [K.RL10.published / G0], css('--s2'), 4);
    var rb = R.prop.mixture_ratio, same = rb && Math.abs(rb - K.R_ST) < 0.35;
    c.vmark(K.R_ST, css('--muted'), same ? null : 'water 7.94', [2, 3], true);
    if (rb) c.vmark(rb, css('--s2'), same ? 'burned ' + f(rb, 3) + ' = the water\'s' : 'burned ' + f(rb, 3), null, rb > 6);
    var items = [['delivered Isp (ideal × RL10 factor)', css('--s1')], ['ideal, shifting', css('--s1'), 'dash'], ['ideal, frozen', css('--s1'), 'dash'], ['Δv on the dry mass (right axis)', css('--s3')]];
    if (R.settings.route === 'cryo') items.push(['RL10A-3-3, 444 s at O/F 5 (SP-8120)', css('--s2'), 'dot']);
    if (R.trade.rMax < K.R_ST - 1e-6) items.push(['not enough oxygen left', css('--refused'), 'band']);
    legend('ofLegend', items);
    var at5 = R.trade.dv(5);
    $('ofCap').textContent = 'Isp peaks near O/F ' + f(xs[isp.indexOf(Math.max.apply(null, isp.filter(function (v) { return v; })))], 2) + ', but the oxygen is mass you already have: burning at 5 would give ' + f(at5.dv, 4) + ' m/s against ' + f(R.dv, 4) + ' m/s at ' + f(R.prop.mixture_ratio, 3) + '. Tap or drag to set a ratio; arrow keys work too.';
  }
  function drawVolt() {
    var R = state.R, Ts = [], Er = [], Et = [];
    for (var T = 280; T <= 360.001; T += 2) { var e = K.electrolysis(T); Ts.push(T); Er.push(e.Erev); Et.push(e.Etn); }
    var Vc = R.cell ? R.cell.V : (K.CELL_PRESETS[R.settings.cell] || { V: R.settings.V_custom }).V;
    var c = frame($('voltChart'), { x: [280, 360], y: [1.1, Math.max(2.0, Vc + 0.1)], xl: 'cell temperature, K', yl: 'V per cell' });
    c.line(Ts, Er, css('--s1')); c.line(Ts, Et, css('--s2'));
    var J = S0.janaf.rows, F = K.F;
    c.dots(J.map(function (r) { return r[0]; }), J.map(function (r) { return -r[4] * 1000 / (2 * F); }), css('--ink'), 3.5);
    c.dots(J.map(function (r) { return r[0]; }), J.map(function (r) { return -r[3] * 1000 / (2 * F); }), css('--ink'), 3.5);
    c.hmark(Vc, css('--s3'), 'this cell ' + f(Vc, 4) + ' V', [6, 3]);
    c.vmark(R.settings.T_cell, css('--muted'), null, [2, 3]);
    legend('voltLegend', [['reversible, ΔG/2F (idea 31\'s data)', css('--s1')], ['thermoneutral, ΔH/2F', css('--s2')], ['NIST-JANAF', css('--ink'), 'dot'], ['the cell', css('--s3'), 'dash']]);
    $('voltCap').textContent = R.cell ? 'Between the two lines the cell needs heat; above the thermoneutral line it sheds ' + f(R.cell.heat_J_per_kg_water / 1e6, 3) + ' MJ per kg of water as heat (' + f(R.cell.heat_J_per_kg_water / R.cell.e_J_per_kg_water * 100, 3) + ' % of its power).' : 'The steam route does not split water.';
  }
  function drawTank() {
    var R = state.R, mat = K.material(R.settings.material || '6061-T6'), ps = [], h = [], o = [];
    for (var p = 1; p <= 70; p += 1) { ps.push(p); h.push(K.tankMass(p * 1e6, 1, mat) / K.gasDensity('h2_293K', p * 1e6)); o.push(K.tankMass(p * 1e6, 1, mat) / K.gasDensity('o2_293K', p * 1e6)); }
    var c = frame($('tankChart'), { x: [1, 70], y: [0.1, 100], ylog: true, xl: 'storage pressure, MPa (gas at 293 K)', yl: 'kg of tank per kg of gas' });
    c.line(ps, h, css('--s1')); c.line(ps, o, css('--s2'));
    if (R.settings.route === 'gas') c.vmark(R.settings.p_store_MPa, css('--s3'), f(R.settings.p_store_MPa, 3) + ' MPa', [4, 3], R.settings.p_store_MPa > 50);
    legend('tankLegend', [['hydrogen', css('--s1')], ['oxygen', css('--s2')]]);
    $('tankCap').textContent = mat.name + ' spheres, bursting at 1.4 × pressure: an ideal gas would make every pressure cost the same tank per kilogram. Hydrogen grows heavier with pressure because it is less dense than ideal (NIST); at 20 MPa ' + f(h[19], 3) + ' kg of tank per kg of hydrogen, ' + f(o[19], 3) + ' per kg of oxygen.' + (mat.verify ? ' PartForge marks these strengths "verify".' : '');
  }
  function drawSteam() {
    var R = state.R, st = R.settings, Ts = [], sh = [], fr = [];
    for (var T = 600; T <= 3000; T += 100) {
      var e = K.engineSteam(Object.assign({}, st, { T_heat: T }));
      Ts.push(T); sh.push(e.shifting ? e.shifting / G0 : null); fr.push(e.frozen ? e.frozen / G0 : null);
    }
    var cr = state.routes.cryo && state.routes.cryo.prop && state.routes.cryo.prop.isp_s, ga = state.routes.gas && state.routes.gas.prop && state.routes.gas.prop.isp_s;
    var c = frame($('steamChart'), { x: [600, 3000], y: [0, 480], xl: 'steam heater temperature, K', yl: 'Isp, s' });
    c.line(Ts, fr, css('--s1'), [5, 4], 1.5); c.line(Ts, sh, css('--s1'), null, 2.5);
    if (cr) c.hmark(cr, css('--s3'), 'liquefied H₂/O₂ ' + f(cr, 3) + ' s', [6, 3]);
    if (ga) c.hmark(ga, css('--s2'), null, [2, 3]);
    var Ttop = K.stagnation(src().collector);
    if (Ttop) c.vmark(Ttop, css('--muted'), 'idea 45\'s mirror tops out', [2, 3], Ttop > 2200);
    c.vmark(st.T_heat, css('--s2'), null, [4, 3]);
    legend('steamLegend', [['steam, shifting', css('--s1')], ['steam, frozen', css('--s1'), 'dash'], ['H₂/O₂ routes', css('--s3'), 'dash']]);
    $('steamCap').textContent = 'At ' + f(st.pc_steam / 1e5, 3) + ' bar and area ratio ' + f(st.eps_steam, 3) + '. Gaps in the shifting line are where idea 31 or 32 has no equilibrium answer (condensing, or the solver failing). Idea 45\'s concentrator reaches ' + f(Ttop, 4) + ' K at most on the stay\'s first day.';
  }

  // the mixture-ratio chart is a control: tap, drag or arrow keys set a fixed ratio
  (function () {
    var cv = $('ofChart'), dragging = false;
    function setFrom(ev) {
      var R = state.R; if (!R || !R.trade) return;
      var rect = cv.getBoundingClientRect(), x = ev.clientX - rect.left, pl = 52, W = rect.width - 52 - 50;
      var r = 2 + (x - pl) / W * 6; r = Math.max(2, Math.min(K.R_ST, r));
      state.S.of_mode = 'fixed'; state.S.of = +r.toFixed(2); syncControls(); schedule(60);
    }
    cv.addEventListener('pointerdown', function (e) { dragging = true; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); setFrom(e); });
    cv.addEventListener('pointermove', function (e) { if (dragging) setFrom(e); });
    cv.addEventListener('pointerup', function () { dragging = false; });
    cv.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var cur = state.R && state.R.prop && state.R.prop.mixture_ratio || state.S.of;
      state.S.of_mode = 'fixed'; state.S.of = +Math.max(2, Math.min(K.R_ST, cur + (e.key === 'ArrowRight' ? 0.1 : -0.1))).toFixed(2); syncControls(); schedule(30);
    });
  })();

  // ---------------------------------------------------------------- handoff
  function exportText() { if (!state.R || state.R.refusal) { $('hoStatus').textContent = 'Nothing to export: the run was refused.'; $('hoStatus').className = 'status bad'; return null; } return JSON.stringify(K.buildHandoff(state.R, new Date().toISOString())); }
  function say(msg, ok) { $('hoStatus').textContent = msg; $('hoStatus').className = 'status ' + (ok ? 'ok' : 'bad'); }
  function copy(text, msg) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { say(msg, true); }, function () { $('importText').value = text; say('Clipboard unavailable: the text is in the box above.', true); }); else { $('importText').value = text; say('Clipboard unavailable: the text is in the box above.', true); } }
  function importAny(text) {
    var p = K.parseHandoff(text);
    if (p.refusal) { say('Refused: ' + p.refusal.reason, false); return false; }
    state.imported = p.src; state.caseKey = 'imported';
    state.S = p.from === '46-split' ? Object.assign(K.defaults(p.src), p.settings) : K.defaults(p.src);
    if (!state.S.array) state.S.array = 'custom';
    syncControls(); run();
    say(p.from === '46-split' ? 'Read this page\'s handoff back: its propellant and refusals match a re-run.' : 'Imported idea 45\'s handoff: ' + p.src.site.body + ', ' + f(p.src.water.total_kg, 4) + ' kg of water.', true);
    return true;
  }
  $('importBtn').addEventListener('click', function () { importAny($('importText').value); });
  $('importFile').addEventListener('change', function () { var fl = this.files && this.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { importAny(String(rd.result)); }; rd.readAsText(fl); });
  $('copyBtn').addEventListener('click', function () { var h = exportText(); if (h) copy(h, 'Handoff copied (' + f(h.length / 1024, 3) + ' KB).'); });
  $('dlBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'application/json' })); a.download = 'split-handoff.json'; document.body.appendChild(a); a.click(); a.remove(); say('Downloaded split-handoff.json.', true); });
  $('linkBtn').addEventListener('click', function () { var h = exportText(); if (!h) return; var url = location.href.split('#')[0] + '#h=' + K.b64urlEncode(h); copy(url, 'Link copied (' + f(url.length / 1024, 3) + ' KB; it carries the whole chain).'); });

  window.addEventListener('resize', function () { clearTimeout(state.rz); state.rz = setTimeout(function () { if (state.R && !state.R.refusal) render(); }, 150); });

  // ---------------------------------------------------------------- start
  resetS();
  syncControls();
  var hash = location.hash.match(/#h=([A-Za-z0-9_-]+)/), done = false;
  if (hash) done = importAny(hash[0]);
  if (!done) run();
  window.SplitPage = { K: K, state: state, run: run };
})();
