/* The Long Way Round, module 50: the page. Reads snapshots/missions.js (every mission run-chain.mjs flew), builds each
 * with mission.js, and draws it. Classic script; no network. */
(function () {
  'use strict';
  var LW = window.LongWayRound, D = window.LWR_MISSIONS, A = window.LWR_ASTER, NH = window.LWR_NHATS, NC = window.LWR_NHATS_CHAIN;
  var K = LW.create({ aster: A, ledger47: window.LWR_HOME_LEDGER, isa: window.PartForgeISA, nhats: NH });
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var fmt = LW.fmt;
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k === 'cls') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function svg(tag, attrs, text) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function kg(x) { return num(x) ? (x >= 1e4 ? fmt(x / 1000, 4) + ' t' : fmt(x, x < 10 ? 3 : 5) + ' kg') : '—'; }
  function ms(x) { return num(x) ? fmt(x, x < 1 ? 3 : 5) + ' m/s' : '—'; }
  function days(s) { return num(s) ? fmt(s / 86400, 4) + ' d' : '—'; }
  function utc(u) { return u ? String(u).slice(0, 16).replace('T', ' ') + ' UTC' : '—'; }
  function chip(c) { return el('span', { cls: 'chip ' + (c || ''), text: c || '' }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  // ------------------------------------------------------------------ choices
  var ROCKETS = [
    { id: 'chain', label: 'Idea 34\'s stack, 10 t payload', note: 'Idea 34\'s sample stack: seven of the engine ideas 31 to 33 build from the propellant you pick, on 400 t; one J-2 on 100 t; 10 t of payload (assumed masses, scaled from AS-512\'s inert fractions).' },
    { id: 'chain-sc', label: 'Idea 34\'s stack, carrying the spacecraft', note: 'The same stack with its payload closed on the spacecraft: the launch mass idea 42 sizes for the arrival this departure gives, iterated until the two agree; and the way home aimed at the entry idea 48 flies (idea 47 re-flown at the perigee idea 48 asks for).' },
    { id: 'as512', label: 'Saturn V AS-512, as flown', note: function () { var r = byKey['as512|-|99942'] && LW.unpack(D, 'as512|-|99942'); return 'Apollo 17\'s Saturn V from its flight report (ideas 34 to 36), carrying its ' + (r ? kg(r.links[34].v.payload_kg) + ' ' : '') + 'Apollo stack (idea 34\'s payload): the propellant picker does not apply (its F-1 and J-2 are idea 33\'s presets).'; } },
    { id: 'as512-sc', label: 'Saturn V AS-512, carrying the spacecraft', note: 'AS-512 flown as Apollo 17 to the parking orbit, then departing with the spacecraft instead of the Apollo stack (idea 38\'s own payload setting; the ascent is not re-flown, so this is a lower bound), closed on idea 42\'s launch mass; the way home aimed at the entry idea 48 flies.' },
    { id: 'committed', label: 'The chain as committed (19 samples)', note: 'The 19 handoff.json files as they sit in the bank, read one by one: the chain each module was built and reviewed on. Apophis, LOX/RP-1 only.' },
  ];
  var PROPS = { 'lox-rp1': 'LOX / RP-1 (the chain\'s)', 'lox-lh2': 'LOX / LH2', 'lox-ch4': 'LOX / methane', 'nto-mmh': 'N2O4 / MMH', 'nto-udmh': 'N2O4 / UDMH', 'nto-a50': 'N2O4 / Aerozine 50', 'nto-n2h4': 'N2O4 / hydrazine', 'lox-eth75': 'LOX / 75 % ethanol', 'htp-rp1': '98 % H2O2 / RP-1' };
  var ASTS = { '99942': 'Apophis', '101955': 'Bennu', '162173': 'Ryugu', '65803': 'Didymos', '433': 'Eros', '2000 SG344': '2000 SG344' };
  var AST_ORDER = ['99942', '101955', '162173', '65803', '433', '2000 SG344'];   // integer-like keys would sort numerically
  var byKey = {}; D.runs.forEach(function (r) { byKey[r.key] = r; });
  function keyFor(rocket, prop, ast) { return rocket === 'committed' ? 'committed|lox-rp1|99942' : LW.keyOf({ rocket: rocket, propellant: prop, asteroid: ast }); }
  var MIS_CACHE = {};
  function missionFor(key) { if (!MIS_CACHE[key]) { var rec = LW.unpack(D, key); MIS_CACHE[key] = rec ? LW.mission(rec) : null; } return MIS_CACHE[key]; }

  var state = { rocket: 'chain', prop: 'lox-rp1', ast: '99942', imported: null, importedNote: null,
    what: { dry: null, plant: false, tag: false, launcher: 'flown', td: null } };
  function current() { return state.imported || missionFor(keyFor(state.rocket, state.prop, state.ast)); }

  function initPickers() {
    ROCKETS.forEach(function (r) { $('rocket').appendChild(el('option', { value: r.id, text: r.label })); });
    Object.keys(PROPS).forEach(function (p) { $('propellant').appendChild(el('option', { value: p, text: PROPS[p] })); });
    AST_ORDER.forEach(function (a) { $('asteroid').appendChild(el('option', { value: a, text: ASTS[a] + (a === '2000 SG344' ? '' : ' (' + a + ')') })); });
    $('launcher').appendChild(el('option', { value: 'flown', text: 'The rocket flown above (idea 38)' }));
    A.elvperf.vehicles.forEach(function (v, i) { $('launcher').appendChild(el('option', { value: String(i), text: v.name + ' ' + v.config + ' (NASA LSP)' })); });
    $('rocket').addEventListener('change', function () { state.rocket = this.value; state.imported = null; if (state.rocket === 'committed') { state.prop = 'lox-rp1'; state.ast = '99942'; } resetWhat(); render(); });
    $('propellant').addEventListener('change', function () { state.prop = this.value; state.imported = null; resetWhat(); render(); });
    $('asteroid').addEventListener('change', function () { state.ast = this.value; state.imported = null; resetWhat(); render(); });
  }
  function syncPickers() {
    $('rocket').value = state.imported ? state.rocket : state.rocket;
    var as = state.rocket === 'as512' || state.rocket === 'as512-sc', com = state.rocket === 'committed';
    $('propellant').value = state.prop; $('propellant').disabled = as || com || !!state.imported;
    $('asteroid').value = state.ast; $('asteroid').disabled = com || !!state.imported;
    $('propHint').textContent = as ? '(AS-512 carries its own)' : com ? '(the chain\'s)' : '';
    var r = ROCKETS.filter(function (x) { return x.id === state.rocket; })[0];
    $('rocketNote').textContent = state.imported ? state.importedNote : r ? (typeof r.note === 'function' ? r.note() : r.note) : '';
  }

  // ------------------------------------------------------------------ verdict and tiles
  function renderVerdict(mis) {
    var v = $('verdict'); v.textContent = '';
    if (!mis) {
      v.className = 'verdict halts';
      v.appendChild(el('h2', { text: 'Not flown' }));
      v.appendChild(el('p', { text: 'This combination is not among the missions run-chain.mjs flew for this page (refused rather than guessed).' }));
      v.appendChild(el('p', { cls: 'small', html: 'What would help: fly it, <code>node ideas/50-the-long-way-round/run-chain.mjs --rocket ' + state.rocket + (state.rocket.indexOf('as512') === 0 ? '' : ' --propellant ' + state.prop) + ' --asteroid "' + state.ast + '"</code> (about 20 s), and import the handoff it writes with <code>--handoff mission.json</code>.' }));
      return;
    }
    var V = mis.verdict;
    v.className = 'verdict ' + (V.closes ? 'closes' : V.halted_at || !V.lands ? 'halts' : 'open');
    v.appendChild(el('h2', { text: V.closes ? 'The mission closes.' : V.halted_at ? 'The chain stops at idea ' + V.halted_at + ' (' + LW.TITLE[V.halted_at] + ').' : V.lands ? 'It lands on paper, but the mission does not close.' : 'The chain read here does not reach the ground.' }));
    var ul = el('ul'); V.blockers.forEach(function (b) { ul.appendChild(el('li', { text: (b.between.length > 1 ? b.between.join(' → ') + ': ' : '') + b.what })); });
    if (V.blockers.length) v.appendChild(ul);
    var rec = mis.record, extra = [];
    if (rec.loop && rec.loop.length) extra.push('Payload closed on the spacecraft in ' + rec.loop.length + ' pass' + (rec.loop.length > 1 ? 'es' : '') + ': ' + rec.loop.map(function (q) { return kg(q.payload_kg) + ' → ' + kg(q.launch_kg); }).join(', then ') + '.');
    if (rec.aim && rec.aim.length) extra.push('Way home aimed at the entry in ' + rec.aim.length + ' pass' + (rec.aim.length > 1 ? 'es' : '') + ': ' + rec.aim.map(function (q) { return 'aim ' + fmt(q.aim_alt_m / 1000, 4) + ' km, flown perigee ' + fmt(q.perigee_alt_m / 1000, 4) + ' km' + (q.retarget_needed ? ', idea 48 still asks for a re-aim' : ', no re-aim needed'); }).join('; then ') + '.');
    (rec.notes || []).forEach(function (n) { extra.push(n); });
    if (extra.length) v.appendChild(el('p', { cls: 'small', text: extra.join(' ') }));
  }
  function L(mis, n) { return mis && mis.record.links[n] || null; }
  function tile(k, v, conf, s, refused) {
    var t = el('div', { cls: 'tile' });
    t.appendChild(el('div', { cls: 'k' }, [k, conf ? chip(conf) : null]));
    t.appendChild(el('div', { cls: 'v' + (refused ? ' refused' : ''), text: v }));
    if (s) t.appendChild(el('div', { cls: 's', text: s }));
    return t;
  }
  function refusedTile(k, why) { return tile(k, 'refused', 'refused', why, true); }
  function renderTiles(mis) {
    var T = $('tiles'); T.textContent = '';
    if (!mis) return;
    var stop = mis.verdict.halted_at ? 'the chain stops at idea ' + mis.verdict.halted_at : 'not in this chain';
    var l34 = L(mis, 34), l38 = L(mis, 38), l42 = L(mis, 42), l45 = L(mis, 45), l47 = L(mis, 47), l49 = L(mis, 49);
    T.appendChild(l34 ? tile('Liftoff mass', kg(l34.v.liftoff_kg), l34.c.liftoff_kg, LW.sourceOf(34, 'liftoff_kg')) : refusedTile('Liftoff mass', stop));
    T.appendChild(l42 ? tile('Spacecraft at launch', kg(l42.v.launch_kg), l42.c.launch_kg, 'idea 42: ' + kg(l42.v.dry_kg) + ' dry + ' + kg(l42.v.loaded_kg) + ' propellant at ' + fmt(l42.v.isp_s, 4) + ' s') : refusedTile('Spacecraft at launch', stop));
    if (l38) {
      var dep = num(l38.v.hds_tdb);
      T.appendChild(tile('Earth departure', dep ? kg(l38.v.prop_left_kg) + ' to spare' : kg(l38.v.prop_short_kg) + ' short', l38.c.prop_short_kg, 'idea 38: needs ' + kg(l38.v.prop_need_kg) + ' of propellant, ' + kg(l38.v.prop_avail_kg) + ' in orbit'));
    } else T.appendChild(refusedTile('Earth departure', stop));
    T.appendChild(num(mis.durations.total_s) && l49 ? tile('Launch to landing', fmt(mis.durations.total_s / 86400 / 365.25, 3) + ' years', 'derived', utc(mis.headline.launch_utc).slice(0, 10) + ' to ' + utc(l49.v.land_utc).slice(0, 10)) : refusedTile('Launch to landing', stop));
    T.appendChild(l45 ? tile('Water mined', kg(l45.v.water_kg), l45.c.water_kg, 'idea 45, ' + fmt(l45.v.days, 3) + ' days; ' + (l45.v.bound === 'upper' ? 'an upper bound' : l45.v.bound || '') + ' (' + (l45.v.spectral || '') + ')') : refusedTile('Water mined', stop));
    T.appendChild(l47 ? tile('Material home', kg(l47.v.material_kg), l47.c.material_kg, 'idea 47: limited by ' + l47.v.limited_by + ', ' + ms(l47.v.dv_used_m_s) + ' to leave') : refusedTile('Material home', stop));
    T.appendChild(l49 ? tile('Landed', kg(l49.v.landed_kg), l49.c.landed_kg, 'idea 49 at ' + fmt(l49.v.td_m_s, 3) + ' m/s under ' + fmt(l49.v.main_cds_m2, 4) + ' m² of main parachute') : refusedTile('Landed', stop));
    var tot = mis.deltaV.reduce(function (a, d) { return a + d.dv_m_s; }, 0), blocking = mis.refusals.filter(function (r) { return r.blocking; }).length;
    var answered = mis.refusals.filter(function (r) { return r.answered_by; }).length;
    T.appendChild(tile('Refusals carried', String(mis.refusals.length), 'derived', blocking + ' blocking' + (answered ? ', ' + answered + ' answered downstream' : '') + '; delta-v total ' + ms(tot)));
  }

  // ------------------------------------------------------------------ charts
  var TIP = null;
  function showTip(evt, text) { TIP.hidden = false; TIP.textContent = text; var x = evt.clientX + 12, y = evt.clientY + 12; if (x + 300 > window.innerWidth) x = Math.max(4, window.innerWidth - 304); TIP.style.left = x + 'px'; TIP.style.top = y + 'px'; }
  function hideTip() { TIP.hidden = true; }
  function width(id) { var w = $(id).clientWidth; return Math.max(280, Math.min(1080, w || 600)); }
  function massRows(mis, cl) {
    var R = [], l34 = L(mis, 34), l37 = L(mis, 37), l38 = L(mis, 38), l42 = L(mis, 42), l47 = L(mis, 47), l48 = L(mis, 48), l49 = L(mis, 49);
    function add(label, m, who, src, w, short) { if (num(m)) R.push({ label: label, short: short, m: m, who: who, src: src, w: num(w) && Math.abs(w - m) > 1e-6 * m ? w : null }); }
    if (l34) add('Liftoff', l34.v.liftoff_kg, 'rocket', LW.sourceOf(34, 'liftoff_kg'), null, 'Liftoff');
    if (l37) add('Parking orbit', l37.v.ins_kg, 'rocket', LW.sourceOf(37, 'ins_kg'), null, 'Orbit');
    if (l38) add(num(l38.v.hds_tdb) ? 'After the departure burn' : 'Stage runs dry, not departed', num(l38.v.hds_tdb) ? l38.v.hds_kg : l38.v.mass_ign_kg - l38.v.prop_avail_kg, 'rocket', LW.sourceOf(38, num(l38.v.hds_tdb) ? 'hds_kg' : 'prop_avail_kg'), null, num(l38.v.hds_tdb) ? 'Departed' : 'Stage dry');
    if (l42) {
      add('Spacecraft at launch', l42.v.launch_kg, 'spacecraft', LW.sourceOf(42, 'launch_kg'), cl && cl.outbound && cl.outbound.launch_kg, 'Craft');
      add('Arrival', l42.v.arrival_kg, 'spacecraft', LW.sourceOf(42, 'arrival_kg'), cl && cl.outbound && cl.outbound.arrival_kg, 'Arrival');
      add('Stand-off', l42.v.standoff_kg, 'spacecraft', LW.sourceOf(42, 'standoff_kg'), cl && cl.outbound && cl.outbound.standoff_kg, 'Stand-off');
    }
    if (l47) add('Leaves the asteroid', l47.v.mass_dep_kg, 'return', LW.sourceOf(47, 'mass_dep_kg'), cl && cl.home && cl.home.mass_departure_kg, 'Leaves');
    if (l48) add('Entry interface', l48.v.entry_kg, 'capsule', LW.sourceOf(48, 'entry_kg'), cl && cl.entry && cl.entry.entry_kg, 'Entry');
    if (l49) add('Landed', l49.v.landed_kg, 'capsule', LW.sourceOf(49, 'landed_kg'), cl && cl.entry && cl.entry.landed_kg, 'Landed');
    return R;
  }
  var COLOR = { rocket: '--rocket', spacecraft: '--craft', return: '--home', capsule: '--capsule' };
  function renderMass(mis, cl) {
    var box = $('massChart'); box.textContent = ''; $('massRead').textContent = '';
    var R = mis ? massRows(mis, cl) : [];
    if (!R.length) { box.appendChild(el('p', { cls: 'note', text: 'No masses: the chain has no links to read here.' })); return; }
    var W = width('massChart'), narrow = W < 560, H = narrow ? 270 : 280, ml = 52, mr = narrow ? 14 : 24, mt = 12, mb = narrow ? 64 : 92;
    var all = []; R.forEach(function (r) { all.push(r.m); if (r.w) all.push(r.w); });
    var lo = Math.floor(Math.log10(Math.min.apply(null, all))), hi = Math.ceil(Math.log10(Math.max.apply(null, all)));
    if (hi === lo) hi++;
    var X = function (i) { return ml + (R.length === 1 ? (W - ml - mr) / 2 : i * (W - ml - mr) / (R.length - 1)); };
    var Y = function (m) { return mt + (hi - Math.log10(m)) / (hi - lo) * (H - mt - mb); };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    for (var e = lo; e <= hi; e++) {
      s.appendChild(svg('line', { x1: ml, x2: W - mr, y1: Y(Math.pow(10, e)), y2: Y(Math.pow(10, e)), class: 'gridl' }));
      s.appendChild(svg('text', { x: ml - 6, y: Y(Math.pow(10, e)) + 4, 'text-anchor': 'end' }, e >= 3 ? fmt(Math.pow(10, e - 3), 3) + ' t' : fmt(Math.pow(10, e), 3) + ' kg'));
    }
    var path = '';
    R.forEach(function (r, i) { path += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(r.m).toFixed(1); });
    s.appendChild(svg('path', { d: path, fill: 'none', stroke: css('--muted'), 'stroke-width': 1.2 }));
    var wp = '', any = false;
    R.forEach(function (r, i) { var m = r.w || r.m; if (r.w) any = true; wp += (wp ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(m).toFixed(1); });
    if (any) s.appendChild(svg('path', { d: wp, fill: 'none', stroke: css('--accent'), 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    R.forEach(function (r, i) {
      var c = svg('circle', { cx: X(i), cy: Y(r.m), r: 6, fill: css(COLOR[r.who]), tabindex: 0, 'aria-label': r.label + ' ' + kg(r.m) });
      var txt = r.label + ': ' + kg(r.m) + (r.w ? ' (what-if ' + kg(r.w) + ')' : '') + '. ' + r.src;
      c.addEventListener('pointerenter', function (ev) { showTip(ev, txt); });
      c.addEventListener('pointerleave', hideTip);
      c.addEventListener('click', function () { $('massRead').textContent = txt; });
      c.addEventListener('focus', function () { $('massRead').textContent = txt; });
      s.appendChild(c);
      if (r.w) s.appendChild(svg('circle', { cx: X(i), cy: Y(r.w), r: 4, fill: 'none', stroke: css('--accent'), 'stroke-width': 2 }));
      var t = svg('text', { x: X(i), y: H - mb + 14, 'text-anchor': 'end', transform: 'rotate(' + (narrow ? -55 : -30) + ' ' + X(i) + ' ' + (H - mb + 14) + ')' }, narrow ? r.short : r.label);
      s.appendChild(t);
    });
    box.appendChild(s);
    $('massRead').textContent = 'Liftoff to landing: ' + kg(R[0].m) + ' to ' + kg(R[R.length - 1].m) + '. Tap a point for its source.';
  }
  var PAYER = { rocket: 'the rocket', spacecraft: 'the spacecraft', return: 'the return craft' };
  function renderDv(mis) {
    var box = $('dvChart'); box.textContent = ''; $('dvRead').textContent = '';
    var B = mis ? mis.deltaV : [];
    if (!B.length) { box.appendChild(el('p', { cls: 'note', text: 'No burns: the chain has no links to read here.' })); return; }
    var W = width('dvChart'), narrow = W < 560, row = narrow ? 42 : 30, top = narrow ? 62 : 46, H = top + B.length * row + 26, lab = narrow ? 0 : Math.min(230, W * 0.42), x0 = narrow ? 8 : lab + 8, x1 = W - 70;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    var defs = svg('defs'), pat = svg('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(svg('rect', { width: 6, height: 6, fill: 'none' })); pat.appendChild(svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: css('--bad'), 'stroke-width': 3 }));
    defs.appendChild(pat); s.appendChild(defs);
    // the waterfall: the total as one bar, split by payer
    var tot = B.reduce(function (a, d) { return a + d.dv_m_s; }, 0), by = { rocket: 0, spacecraft: 0, return: 0 }, xx = 0;
    B.forEach(function (d) { by[d.payer] += d.dv_m_s; });
    ['rocket', 'spacecraft', 'return'].forEach(function (p) {
      var w = by[p] / tot * (W - 16);
      if (w > 0) s.appendChild(svg('rect', { x: 8 + xx, y: 8, width: Math.max(1, w), height: 16, fill: css(COLOR[p]) }));
      xx += w;
    });
    if (narrow) { s.appendChild(svg('text', { x: 8, y: 40 }, 'Total ' + fmt(tot, 5) + ' m/s')); s.appendChild(svg('text', { x: 8, y: 56 }, 'rocket ' + fmt(by.rocket, 5) + ', craft ' + fmt(by.spacecraft, 5) + ', return ' + fmt(by.return, 3))); }
    else s.appendChild(svg('text', { x: 8, y: 40 }, 'Total ' + fmt(tot, 5) + ' m/s: rocket ' + fmt(by.rocket, 5) + ', spacecraft ' + fmt(by.spacecraft, 5) + ', return ' + fmt(by.return, 3)));
    // each burn on a log axis, 0.01 to 10,000 m/s
    var lx = function (v) { var a = Math.log10(Math.max(0.01, v)); return x0 + (a + 2) / 6 * (x1 - x0); };
    [0.01, 1, 100, 10000].forEach(function (v) { s.appendChild(svg('line', { x1: lx(v), x2: lx(v), y1: top, y2: H - 22, class: 'gridl' })); s.appendChild(svg('text', { x: lx(v), y: H - 8, 'text-anchor': 'middle' }, fmt(v, 2))); });
    B.forEach(function (d, i) {
      var y = top + i * row;
      var by0 = narrow ? y + 18 : y + 6;
      if (narrow) s.appendChild(svg('text', { x: 8, y: y + 13 }, d.label));
      else s.appendChild(svg('text', { x: lab, y: y + 18, 'text-anchor': 'end' }, d.label));
      var r = svg('rect', { x: x0, y: by0, width: Math.max(2, lx(d.dv_m_s) - x0), height: 16, fill: d.flown ? css(COLOR[d.payer]) : 'url(#hatch)', stroke: d.flown ? 'none' : css('--bad'), tabindex: 0 });
      var txt = d.label + ': ' + ms(d.dv_m_s) + ', paid by ' + PAYER[d.payer] + (d.flown ? '' : ' (not flown: ' + d.note + ')') + '. ' + d.source;
      r.addEventListener('pointerenter', function (ev) { showTip(ev, txt); }); r.addEventListener('pointerleave', hideTip);
      r.addEventListener('click', function () { $('dvRead').textContent = txt; }); r.addEventListener('focus', function () { $('dvRead').textContent = txt; });
      s.appendChild(r);
      s.appendChild(svg('text', { x: Math.min(lx(d.dv_m_s) + 4, x1 + 4), y: by0 + 12 }, fmt(d.dv_m_s, d.dv_m_s < 10 ? 3 : 5)));
    });
    box.appendChild(s);
    var nf = B.filter(function (d) { return !d.flown; });
    $('dvRead').textContent = nf.length ? nf.length + ' burn' + (nf.length > 1 ? 's' : '') + ' needed but not flown: ' + nf.map(function (d) { return d.label; }).join(', ') + '.' : 'Every burn in the budget has its propellant.';
  }
  function renderTimeline(mis) {
    var box = $('timeChart'); box.textContent = ''; var ol = $('events'); ol.textContent = '';
    var E = mis ? mis.events : [];
    if (!E.length) { box.appendChild(el('p', { cls: 'note', text: 'No events: the chain has no dated links here.' })); return; }
    var t0 = E[0].t, t1 = E[E.length - 1].t, span = Math.max(t1 - t0, 86400);
    var W = width('timeChart'), H = 150, ml = 10, mr = 10;
    var X = function (t) { return ml + (t - t0) / span * (W - ml - mr); };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    var l40 = L(mis, 40), l42 = L(mis, 42), l45 = L(mis, 45), l46 = L(mis, 46), l47 = L(mis, 47), l41 = L(mis, 41);
    function band(a, b, y, color, label) { if (!num(a) || !num(b)) return; var x = X(a), w = Math.max(2, X(b) - x); s.appendChild(svg('rect', { x: x, y: y, width: w, height: 18, fill: color, opacity: 0.85, rx: 3 })); if (w > 60) s.appendChild(svg('text', { x: x + 4, y: y + 13, fill: '#fff', style: 'fill:#fff' }, label)); }
    if (l40) band(l40.v.dep_tdb, l40.v.arr_tdb, 20, css('--craft'), 'Cruise');
    if (l42 && l47) band(l42.v.so_tdb, l47.v.dep_tdb, 20, css('--capsule'), 'Stay');
    if (l45 && l46) band(LW.utcToTdb(l45.v.first_utc), LW.utcToTdb(l46.v.stay_end_utc), 42, css('--warn'), 'Mining');
    if (l47) band(l47.v.dep_tdb, l47.v.ea_tdb, 20, css('--home'), 'Way home');
    if (l41 && l40) { band(l40.v.dep_tdb, l40.v.dep_tdb + (l41.v.cruise_days + l41.v.stay_days) * 86400, 64, css('--muted'), 'Link planned (idea 41)'); }
    s.appendChild(svg('line', { x1: ml, x2: W - mr, y1: 96, y2: 96, class: 'axis' }));
    var y0 = new Date(LW.tdbToUtc(t0)).getUTCFullYear(), y1 = new Date(LW.tdbToUtc(t1)).getUTCFullYear();
    for (var y = y0 + 1; y <= y1; y++) { var t = LW.utcToTdb(y + '-01-01T00:00:00Z'); s.appendChild(svg('line', { x1: X(t), x2: X(t), y1: 92, y2: 100, class: 'axis' })); s.appendChild(svg('text', { x: X(t), y: 114, 'text-anchor': 'middle' }, String(y))); }
    E.forEach(function (e) {
      var c = svg('circle', { cx: X(e.t), cy: 96, r: e.minor ? 3 : 5, fill: css(e.n <= 38 ? '--rocket' : e.n <= 46 ? '--craft' : '--home'), tabindex: 0 });
      var txt = utc(e.utc || LW.tdbToUtc(e.t)) + ': ' + e.label + (num(e.mass_kg) ? ', ' + kg(e.mass_kg) : '') + ' [idea ' + e.n + ']';
      c.addEventListener('pointerenter', function (ev) { showTip(ev, txt); }); c.addEventListener('pointerleave', hideTip);
      s.appendChild(c);
    });
    s.appendChild(svg('text', { x: ml, y: 138 }, 'Launch ' + utc(E[0].utc || LW.tdbToUtc(t0)).slice(0, 10) + ' · ' + fmt(span / 86400, 4) + ' days to the last event'));
    box.appendChild(s);
    E.forEach(function (e) {
      ol.appendChild(el('li', { cls: e.minor ? 'minor' : '' }, [el('span', { cls: 't', text: utc(e.utc || LW.tdbToUtc(e.t)) }), el('span', { text: e.label + (num(e.mass_kg) ? ' · ' + kg(e.mass_kg) : '') + ' · idea ' + e.n })]));
    });
  }

  // ------------------------------------------------------------------ the what-if
  function resetWhat() { state.what = { dry: null, plant: false, tag: false, launcher: 'flown', td: null }; }
  function syncWhat(mis) {
    var l42 = L(mis, 42), l49 = L(mis, 49), w = state.what;
    var dry = w.dry == null ? (l42 ? l42.v.dry_kg : 487) : w.dry, td = w.td == null ? (l49 ? l49.v.touchdown_set_m_s : 4.5) : w.td;
    $('dry').value = Math.min(5000, Math.max(100, dry)); $('dryNum').value = dry; $('dryOut').textContent = kg(dry);
    $('td').value = td; $('tdOut').textContent = fmt(td, 3) + ' m/s';
    $('plant').checked = w.plant; $('tag').checked = w.tag; $('launcher').value = String(w.launcher);
    var l46 = L(mis, 46);
    $('plantLabel').textContent = 'Launch the propellant plant\'s coolers from the Earth' + (l46 && num(l46.v.coolers_kg) ? ' (idea 46\'s ' + kg(l46.v.coolers_kg) + ')' : ' (no idea 46 in this chain)');
    ['dry', 'dryNum', 'td', 'plant', 'tag', 'launcher', 'resetWhat'].forEach(function (id) { $(id).disabled = !l42; });
  }
  function closureNow(mis) {
    if (!mis || !L(mis, 42)) return null;
    var w = state.what;
    return K.closure(mis, LW.whatIfOpts(w));
  }
  function renderWhat(mis, cl) {
    var T = $('whatTiles'); T.textContent = ''; var R = $('whatRefusals'); R.textContent = '';
    if (!cl) { T.appendChild(refusedTile('The what-if', 'This chain has no spacecraft (idea 42) to size.')); return; }
    var o = cl.outbound, l = cl.launch;
    if (o) {
      T.appendChild(tile('Spacecraft at launch', kg(o.launch_kg), 'derived', kg(o.dry_kg) + (o.plant_kg ? ' + ' + kg(o.plant_kg) + ' plant' : '') + ' dry, ' + kg(o.propellant_kg) + ' propellant for ' + ms(o.need_dv_m_s)));
      T.appendChild(num(l.capability_kg) ? tile('Launcher can send', kg(l.capability_kg), $('launcher').value === 'flown' ? 'derived' : 'measured', 'to C3 ' + fmt(l.c3_m2_s2 / 1e6, 4) + ' km²/s²') : refusedTile('Launcher can send', 'no capability at this C3 (below)'));
      T.appendChild(num(l.margin_kg) ? tile('Launch margin', (l.margin_kg >= 0 ? '+' : '') + kg(l.margin_kg), 'derived', l.closes ? 'the launcher carries it' : 'too heavy for this launcher') : refusedTile('Launch margin', 'no capability'));
      T.appendChild(tile('Touch and go', o.tag_ok ? 'paid' : 'short ' + kg(o.tag_need_kg - o.tag_left_kg), 'derived', 'needs ' + kg(o.tag_need_kg) + ', ' + kg(o.tag_left_kg) + ' left after the approach'));
    }
    if (cl.home) {
      T.appendChild(cl.home.material_kg != null ? tile('Material home', kg(cl.home.material_kg), 'derived', 'on a ' + kg(cl.home.dry_kg) + ' return craft; limited by ' + cl.home.limited_by) : refusedTile('Material home', 'cannot get home'));
    }
    if (cl.entry) {
      T.appendChild(tile('Entry mass', kg(cl.entry.entry_kg), 'derived', 'idea 47\'s ledger, verbatim'));
      T.appendChild(tile('Landed', kg(cl.entry.landed_kg), 'derived', 'less idea 49\'s ' + kg(cl.entry.ablated_kg) + ' of ablation (held)'));
      T.appendChild(tile('Main parachute', fmt(cl.entry.main_cds_m2, 4) + ' m²', 'derived', fmt(cl.entry.main_equiv, 4) + ' OSIRIS-REx mains, or one ' + fmt(cl.entry.main_d_m, 3) + ' m canopy, at ' + fmt(cl.entry.touchdown_m_s, 3) + ' m/s'));
    }
    var verdict = el('p', { cls: 'note', html: cl.closes ? '<b>With these choices every budget closes</b> (the seams this what-if does not touch still stand).' : '<b>Not closed yet:</b> ' + cl.refusals.map(function (r) { return r.reason; }).join(' ') });
    R.appendChild(verdict);
    cl.refusals.forEach(function (r) { R.appendChild(el('div', { cls: 'ref blocking' }, [el('div', { cls: 'h', text: r.code + (r.applies_to ? ' · ' + r.applies_to : '') }), el('div', { cls: 'w', text: r.reason }), el('div', { cls: 'help', text: 'What would help: ' + r.what_would_help })])); });
    if (cl.assumptions.length) R.appendChild(el('ul', { cls: 'small' }, cl.assumptions.map(function (a) { return el('li', { text: a }); })));
  }
  function renderLaunchers(mis, cl) {
    var box = $('lvChart'); box.textContent = ''; $('lvRead').textContent = '';
    var l39 = L(mis, 39);
    if (!l39 || !num(l39.v.c3_m2_s2)) { box.appendChild(el('p', { cls: 'note', text: 'No C3: this chain has no transfer (idea 39), so no launcher can be read against it.' })); return; }
    var c3 = l39.v.c3_m2_s2 / 1e6, V = A.elvperf.vehicles, need = cl && cl.outbound ? cl.outbound.launch_kg : null;
    var cap = L(mis, 38) && num(L(mis, 38).v.cap_finite_kg) ? L(mis, 38).v.cap_finite_kg : null;
    var W = width('lvChart'), H = 280, ml = 54, mr = 12, mt = 12, mb = 36, xmax = 60;
    var ymax = 16000; [need, cap].forEach(function (v) { if (num(v) && v * 1.1 > ymax) ymax = v * 1.1; });
    ymax = Math.ceil(ymax / 2000) * 2000;
    var X = function (c) { return ml + c / xmax * (W - ml - mr); }, Y = function (p) { return mt + (1 - p / ymax) * (H - mt - mb); };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    for (var p = 0; p <= ymax; p += ymax > 20000 ? 10000 : 4000) { s.appendChild(svg('line', { x1: ml, x2: W - mr, y1: Y(p), y2: Y(p), class: 'gridl' })); s.appendChild(svg('text', { x: ml - 6, y: Y(p) + 4, 'text-anchor': 'end' }, fmt(p / 1000, 3) + ' t')); }
    for (var c = 0; c <= xmax; c += 20) { s.appendChild(svg('text', { x: X(c), y: H - 16, 'text-anchor': 'middle' }, String(c))); }
    s.appendChild(svg('text', { x: W - mr, y: H - 2, 'text-anchor': 'end' }, 'C3, km²/s²'));
    var pal = ['--rocket', '--craft', '--home', '--capsule', '--warn', '--accent', '--bad', '--muted'];
    var hits = [];
    V.forEach(function (v, i) {
      var d = ''; v.curve.forEach(function (a, j) { d += (j ? 'L' : 'M') + X(a[0]).toFixed(1) + ',' + Y(a[1]).toFixed(1); });
      var path = svg('path', { d: d, fill: 'none', stroke: css(pal[i % pal.length]), 'stroke-width': String($('launcher').value) === String(i) ? 3.5 : 1.6 });
      var at = LW.payloadAtC3(v, c3), txt = v.name + ' ' + v.config + ': ' + (typeof at === 'number' ? kg(at) + ' at C3 ' + fmt(c3, 3) : 'off its curve at C3 ' + fmt(c3, 3)) + ' (NASA LSP elvperf via Aster)';
      path.addEventListener('pointerenter', function (ev) { showTip(ev, txt); }); path.addEventListener('pointerleave', hideTip);
      s.appendChild(path);
      if (typeof at === 'number') hits.push({ name: v.name + ' ' + v.config, kg: at });
    });
    s.appendChild(svg('line', { x1: X(c3), x2: X(c3), y1: mt, y2: H - mb, stroke: css('--ink'), 'stroke-dasharray': '3 3' }));
    s.appendChild(svg('text', { x: X(c3) + 4, y: mt + 12 }, 'this mission, C3 ' + fmt(c3, 3)));
    if (num(need)) { s.appendChild(svg('line', { x1: ml, x2: W - mr, y1: Y(need), y2: Y(need), stroke: css('--accent'), 'stroke-width': 2 })); s.appendChild(svg('text', { x: W - mr, y: Y(need) - 4, 'text-anchor': 'end' }, 'spacecraft ' + kg(need))); }
    if (num(cap)) { s.appendChild(svg('circle', { cx: X(c3), cy: Y(cap), r: 6, fill: css('--rocket') })); s.appendChild(svg('text', { x: X(c3) + 8, y: Y(cap) + 4 }, 'flown rocket ' + kg(cap))); }
    box.appendChild(s);
    var leg = el('ul', { cls: 'legend' });
    V.forEach(function (v, i) {
      var at = LW.payloadAtC3(v, c3);
      leg.appendChild(el('li', {}, [el('span', { cls: 'sw', style: 'background:' + css(pal[i % pal.length]) }), v.name + ' ' + v.config + ': ' + (typeof at === 'number' ? kg(at) : 'off its curve') + (typeof at === 'number' && num(need) ? (at >= need ? ' (carries it)' : ' (too small)') : '')]));
    });
    box.appendChild(leg);
    var ok = num(need) ? hits.filter(function (h) { return h.kg >= need; }) : [];
    $('lvRead').textContent = 'At C3 ' + fmt(c3, 4) + ' km²/s²: ' + hits.length + ' of ' + V.length + ' curves reach it' + (num(need) ? ', ' + ok.length + ' carry the ' + kg(need) + ' spacecraft' + (ok.length ? ' (' + ok.map(function (h) { return h.name + ' ' + kg(h.kg); }).join(', ') + ')' : '') : '') + '; the rocket flown here ' + (num(cap) ? 'sends ' + kg(cap) + ' (idea 38, a lower bound).' : 'cannot reach it.');
  }

  // ------------------------------------------------------------------ seams, refusals, matrix, NHATS, links
  function renderSeams(mis) {
    var t = $('seams'); t.textContent = '';
    if (!mis) return;
    t.appendChild(el('tr', {}, [el('th', { text: 'Severity' }), el('th', { text: 'Between' }), el('th', { text: 'What' }), el('th', { cls: 'num', text: 'From' }), el('th', { cls: 'num', text: 'To' }), el('th', { text: 'What would help' })]));
    var order = { breaks: 0, gap: 1, note: 2 };
    mis.seams.slice().sort(function (a, b) { return order[a.severity] - order[b.severity]; }).forEach(function (s) {
      var f = function (x) { return num(x) ? (s.units === 's' ? LW.tdbToUtc(x).slice(0, 16).replace('T', ' ') : fmt(x, 6) + ' ' + s.units) : ''; };
      t.appendChild(el('tr', {}, [el('td', {}, [el('span', { cls: 'sev ' + s.severity, text: s.severity })]), el('td', { text: s.between.join(' → '), 'data-label': 'Between' }), el('td', { text: s.what }), el('td', { cls: 'num', text: f(s.a), 'data-label': 'From' }), el('td', { cls: 'num', text: f(s.b), 'data-label': 'To' }), el('td', { text: s.what_would_help, 'data-label': 'What would help' })]));
    });
    if (!mis.seams.length) t.appendChild(el('tr', {}, [el('td', { colspan: 6, text: 'No seams in the links present.' })]));
  }
  function renderRefusals(mis) {
    var box = $('refusals'); box.textContent = '';
    if (!mis) { $('refCount').textContent = ''; return; }
    var only = $('blockingOnly').checked, ph = $('phase').value;
    var R = mis.refusals.filter(function (r) { return (!only || r.blocking) && (!ph || r.phase === ph); });
    $('refCount').textContent = R.length + ' of ' + mis.refusals.length + ' refusals shown (' + mis.refusals.filter(function (r) { return r.blocking; }).length + ' blocking). Each is the module\'s own, with what would answer it.';
    R.forEach(function (r) {
      box.appendChild(el('div', { cls: 'ref' + (r.blocking ? ' blocking' : '') }, [
        el('div', { cls: 'h', text: 'idea ' + r.n + ' (' + LW.TITLE[r.n] + ') · ' + r.code + (r.applies_to ? ' · ' + r.applies_to : '') + (r.blocking ? ' · blocking' : '') + (r.answered_by ? ' · answered by idea ' + r.answered_by : '') + (r.halt ? ' · the chain stops here' : '') }),
        el('div', { cls: 'w', text: r.reason }), el('div', { cls: 'help', text: 'What would help: ' + (r.what_would_help || '—') })]));
    });
  }
  function renderMatrix() {
    var t = $('matrix'); t.textContent = '';
    var cols = AST_ORDER, head = el('tr', {}, [el('th', { text: 'Rocket / propellant' })].concat(cols.map(function (a) { return el('th', { text: ASTS[a] }); })));
    t.appendChild(head);
    var rows = [];
    ['chain', 'chain-sc'].forEach(function (r) { Object.keys(PROPS).forEach(function (p) { rows.push([r, p]); }); });
    rows.push(['as512', null], ['as512-sc', null], ['committed', 'lox-rp1']);
    rows.forEach(function (rp) {
      var r = rp[0], p = rp[1], lab = ROCKETS.filter(function (x) { return x.id === r; })[0].label + (p && r !== 'committed' ? ' · ' + PROPS[p] : '');
      var tr = el('tr', {}, [el('td', { text: lab, style: 'text-align:left;white-space:normal;min-width:12em' })]);
      cols.forEach(function (a) {
        var key = keyFor(r, p, a), run = byKey[key], td = el('td');
        if (r === 'committed' && a !== '99942') { td.textContent = ''; tr.appendChild(td); return; }
        if (!run) { td.appendChild(el('span', { cls: 'small', text: 'not flown' })); tr.appendChild(td); return; }
        var m = missionFor(key), v = m.verdict, cls = v.closes ? 'closes' : v.halted_at ? 'halts' : 'open';
        var b = el('button', { type: 'button', cls: cls + (!state.imported && key === keyFor(state.rocket, state.prop, state.ast) ? ' cur' : ''), text: v.closes ? 'closes' : v.halted_at ? 'stops at ' + v.halted_at : 'lands, open', 'aria-label': lab + ', ' + ASTS[a] + ': ' + v.summary });
        b.addEventListener('click', function () { state.rocket = r; if (p) state.prop = p; state.ast = a; state.imported = null; resetWhat(); render(); $('pick').scrollIntoView({ behavior: 'smooth' }); });
        td.appendChild(b); tr.appendChild(td);
      });
      t.appendChild(tr);
    });
  }
  var NROWS = null, NSTATS = null;
  function renderNhats() {
    if (!NROWS) { NROWS = K.nhatsCompare(NC); NSTATS = K.nhatsStats(NROWS); }
    var S = NSTATS.inside;
    $('nhatsLead').textContent = 'JPL\'s NHATS publishes round trips with every term of their delta-v (the Earth departure from a 400 km circular orbit, arrival, departure from the asteroid, braking for entry). Flown through the chain on NHATS\'s own dates (idea 39 out, idea 47 back) and summed as NHATS sums them, ' + S.total.n + ' round trips inside idea 39\'s envelope match NHATS\'s total delta-v to a median ' + fmt(S.total.median, 3) + ' m/s (' + fmt(S.rel.median * 100, 2) + ' %), worst ' + fmt(S.total.max, 3) + ' m/s (' + fmt(S.rel.max * 100, 2) + ' %). The ' + NSTATS.outside.total.n + ' that arrive after an Earth encounter (Apophis after its 2029 pass, 2000 SG344, Ryugu after 2033) are outside idea 39\'s two-body envelope, which refuses such cells, and are off by a median ' + fmt(NSTATS.outside.total.median / 1000, 3) + ' km/s.';
    var t = $('nhats'); t.textContent = '';
    t.appendChild(el('tr', {}, ['Body', 'Launch', 'Out / stay / back (d)', 'Chain total', 'NHATS total', 'Gap', 'Departure Δv chain / NHATS', 'Arrival chain / NHATS', 'Envelope'].map(function (h, i) { return el('th', { cls: i >= 3 && i <= 5 ? 'num' : '', text: h }); })));
    var all = $('nhatsAll').checked;
    NROWS.filter(function (r) { return all || !r.outside_39; }).forEach(function (r) {
      t.appendChild(el('tr', {}, [el('td', { text: r.des }), el('td', { text: r.launch }), el('td', { text: r.out_d + ' / ' + r.stay_d + ' / ' + r.ret_d }),
        el('td', { cls: 'num', text: fmt(r.chain.dv_total_m_s / 1000, 5) + ' km/s' }), el('td', { cls: 'num', text: fmt(r.nhats.dv_total_m_s / 1000, 5) + ' km/s' }),
        el('td', { cls: 'num', text: (r.gap_total_m_s >= 0 ? '+' : '') + fmt(r.gap_total_m_s, 3) + ' m/s' }),
        el('td', { text: fmt(r.chain.dv_dep_park_m_s / 1000, 4) + ' / ' + fmt(r.nhats.dv_dep_park_m_s / 1000, 4) }), el('td', { text: fmt(r.chain.vrel_arr_neo_m_s / 1000, 4) + ' / ' + fmt(r.nhats.vrel_arr_neo_m_s / 1000, 4) }),
        el('td', { text: r.outside_39 ? 'outside: Earth encounter ' + r.outside_39.encounter_utc.slice(0, 10) : 'inside' })]));
    });
  }
  function renderLinks(mis) {
    var t = $('links'); t.textContent = '';
    if (!mis) { $('linkNote').textContent = ''; return; }
    var com = !state.imported && state.rocket === 'committed';
    $('linkNote').textContent = (state.imported ? 'The links found in the handoff you imported.' : com ? 'The 19 committed handoffs; each module\'s page opens on its own sample.' : 'The handoffs this run made (digest shown: the first 16 hex of the sha256 of each one\'s JSON). The runner writes them whole with --handoff; each module\'s page re-checks its own.') + ' Refusals: the link\'s own, and how many it carried from upstream.';
    t.appendChild(el('tr', {}, [el('th', { text: 'Idea' }), el('th', { text: 'Produced' }), el('th', { text: 'sha256' }), el('th', { cls: 'num', text: 'Bytes' }), el('th', { cls: 'num', text: 'Own' }), el('th', { cls: 'num', text: 'Carried' })]));
    for (var n = 31; n <= 49; n++) {
      var l = mis.record.links[n], name = n + ' ' + LW.TITLE[n];
      var a = el('a', { href: '../' + LW.FROM[n] + '/index.html', text: name });
      if (!l) { t.appendChild(el('tr', {}, [el('td', {}, [a]), el('td', { colspan: 5, cls: 'small', text: mis.verdict.halted_at && n >= mis.verdict.halted_at ? 'not reached: the chain stops at idea ' + mis.verdict.halted_at : 'not on this path' })])); continue; }
      t.appendChild(el('tr', {}, [el('td', {}, [a]), el('td', { text: String(l.produced || '').slice(0, 16) }), el('td', {}, [el('code', { text: String(l.sha256 || '').slice(0, 16) })]), el('td', { cls: 'num', text: fmt(l.bytes, 6) }), el('td', { cls: 'num', text: String(l.own.length) }), el('td', { cls: 'num', text: String(l.carried) })]));
    }
  }

  // ------------------------------------------------------------------ import / export
  // review: a digest is resolved against every mission in the bundle (the committed chain keeps full sha256 digests, the
  // flown missions their first 16 hex), each with its own upstream, so a handoff exported on any flown mission walks whole
  var known = null, knownChain = null;
  function committedIndex() {
    if (known) return;
    known = {}; knownChain = {};
    D.runs.forEach(function (r) {
      var rec = LW.unpack(D, r.key);
      Object.keys(rec.links).forEach(function (n) { var k = rec.links[n].sha256; if (k && !known[k]) known[k] = { link: rec.links[n], chain: rec.links, key: r.key }; });
      if (r.key === 'committed|lox-rp1|99942') Object.keys(rec.links).forEach(function (n) { knownChain[n] = rec.links[n]; });
    });
  }
  function exportObj() {
    var mis = current(); if (!mis) return null;
    var cl = closureNow(mis);
    var w = Object.assign({}, state.what); if (w.dry != null && !num(w.dry)) w.dry = 'invalid';   // JSON would turn NaN into null, the chain's own
    return LW.makeHandoff(mis, { produced: new Date().toISOString(), source: state.imported ? 'imported' : 'bundled', whatIf: w, closure: cl });
  }
  function doImport(text, where) {
    committedIndex();
    var p = LW.parseHandoff(text, { sha256: sha256, known: known, knownChain: knownChain, K: K });
    if (p.refusal) { $('ioMsg').textContent = 'Refused (' + where + '): ' + p.refusal.reason + ' What would help: ' + p.refusal.what_would_help; return false; }
    if (p.own) {
      var c = p.mission.choice, key = p.mission.key;
      if (byKey[key]) { state.rocket = c.rocket; if (c.propellant) state.prop = c.propellant; if (c.asteroid) state.ast = c.asteroid; state.imported = null; }
      else { state.imported = p.mission; state.importedNote = 'Imported: idea 50\'s handoff for a mission this page did not fly itself.'; }
      if (p.whatIf) state.what = p.whatIf;
      $('ioMsg').textContent = 'Imported idea 50\'s handoff (' + where + '): it reads back exactly from its own record.';
    } else {
      state.imported = p.mission; state.rocket = 'committed';
      var w = p.walked, found = Object.keys(w.links).map(Number).sort(function (a, b) { return a - b; });
      var hitOf = function (q) { return known[q.sha256] || known[String(q.sha256).slice(0, 16)]; };
      state.importedNote = 'Imported (' + where + '): idea ' + found[found.length - 1] + '\'s handoff and the links it carries, ' + found[0] + ' to ' + found[found.length - 1] + (w.pruned.length ? '; ' + w.pruned.map(function (q) { var hit = hitOf(q); return 'idea ' + q.n + ' carried as a digest ' + (hit ? '(resolved: ' + (hit.key === 'committed|lox-rp1|99942' ? 'the committed sample' : 'the flown mission ' + hit.key) + ')' : '(not one this page knows: missing)'); }).join('; ') : '') + (w.missing.length ? '; missing: ' + w.missing.join(', ') : '') + '.';
      $('ioMsg').textContent = state.importedNote;
    }
    render();
    return true;
  }
  // SHA-256 (FIPS 180-4) for digests of imported links; sync, small, for strings
  function sha256(str) {
    var K2 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var bytes = unescape(encodeURIComponent(str)), n = bytes.length, words = [], i;
    for (i = 0; i < n; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
    var total = ((n + 8) >> 6) * 16 + 16; while (words.length < total) words.push(0);
    words[total - 1] = (n * 8) >>> 0; words[total - 2] = Math.floor(n / 0x20000000);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
    var rr = function (x, k) { return (x >>> k) | (x << (32 - k)); };
    for (var b = 0; b < total; b += 16) {
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        if (i < 16) w[i] = words[b + i] | 0;
        else { var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K2[i] + w[i]) | 0, S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  window.LWRsha256 = sha256;
  function initIO() {
    $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'pasted'); });
    $('importFile').addEventListener('change', function () { var f = this.files && this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { doImport(String(r.result), f.name); }; r.readAsText(f); });
    $('exportCopy').addEventListener('click', function () {
      var h = exportObj(); if (!h) { $('ioMsg').textContent = 'Nothing to export: this combination was not flown.'; return; }
      var s = JSON.stringify(h, null, 1); $('importText').value = s;
      if (navigator.clipboard) navigator.clipboard.writeText(s).then(function () { $('ioMsg').textContent = 'Copied idea 50\'s handoff (' + s.length + ' characters).'; }, function () { $('ioMsg').textContent = 'The handoff is in the box above (the clipboard refused).'; });
      else $('ioMsg').textContent = 'The handoff is in the box above.';
    });
    $('exportDownload').addEventListener('click', function () {
      var h = exportObj(); if (!h) { $('ioMsg').textContent = 'Nothing to export: this combination was not flown.'; return; }
      var a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(h, null, 1)], { type: 'application/json' })), download: 'long-way-round-mission.json' });
      document.body.appendChild(a); a.click(); a.remove(); $('ioMsg').textContent = 'Downloaded idea 50\'s handoff.';
    });
    $('exportLink').addEventListener('click', function (e) {
      var h = exportObj(); if (!h) { e.preventDefault(); $('ioMsg').textContent = 'Nothing to link: this combination was not flown.'; return; }
      this.href = '#h=' + LW.b64urlEncode(JSON.stringify(h));
    });
  }

  // ------------------------------------------------------------------ wiring
  function initWhat() {
    var set = function (k, v) { state.what[k] = v; renderLive(); };
    $('dry').addEventListener('input', function () { set('dry', +this.value); });
    $('dryNum').addEventListener('change', function () { var v = this.value === '' ? NaN : +this.value; set('dry', v); });
    $('td').addEventListener('input', function () { set('td', +this.value); });
    $('plant').addEventListener('change', function () { set('plant', this.checked); });
    $('tag').addEventListener('change', function () { set('tag', this.checked); });
    $('launcher').addEventListener('change', function () { set('launcher', this.value === 'flown' ? 'flown' : +this.value); });
    $('resetWhat').addEventListener('click', function () { resetWhat(); renderLive(); });
    $('blockingOnly').addEventListener('change', function () { renderRefusals(current()); });
    $('phase').addEventListener('change', function () { renderRefusals(current()); });
    $('nhatsAll').addEventListener('change', renderNhats);
  }
  function renderLive() {
    var mis = current(), cl = closureNow(mis);
    syncWhat(mis); renderWhat(mis, cl); renderLaunchers(mis, cl); renderMass(mis, cl);
  }
  function render() {
    var mis = current();
    syncPickers(); renderVerdict(mis); renderTiles(mis); renderDv(mis); renderTimeline(mis);
    renderLive(); renderSeams(mis); renderRefusals(mis); renderMatrix(); renderLinks(mis);
  }
  function fromHash() {
    var h = location.hash || '';
    var m = /[#&]h=([^&]+)/.exec(h);
    if (m) { try { return doImport(LW.b64urlDecode(m[1]), 'the link'); } catch (e) { $('ioMsg').textContent = 'Refused (the link): its #h= part is not base64url JSON.'; } }
    return false;
  }
  TIP = $('tip');
  initPickers(); initWhat(); initIO();
  if (!fromHash()) render();
  renderNhats();
  window.addEventListener('hashchange', function () { if (/[#&]h=/.test(location.hash)) fromHash(); });
  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { var mis = current(); renderDv(mis); renderTimeline(mis); renderLive(); }, 120); });
  window.LWRpage = { state: state, current: current, closureNow: closureNow, render: render, doImport: doImport, exportObj: exportObj, K: K, nhats: function () { return { rows: NROWS, stats: NSTATS }; } };
})();
