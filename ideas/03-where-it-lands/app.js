// Where It Lands -- page layer. Everything numeric comes from model.js (the pure reader) applied
// to the three snapshot modules; this file only draws. No network, no build step, classic script.
(function () {
  'use strict';
  const M = window.WhereItLands;
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // The dataviz sequential blue ramp (steps 100..700; dark mode stops at 600). Palette, not data.
  const RAMP_LIGHT = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
  const RAMP_DARK = RAMP_LIGHT.slice(0, 11);
  const SERIES_VARS = ['--s1', '--s2', '--s3']; // ladder columns, fixed order, never re-assigned on filter
  const X_TICKS = [300, 500, 1000, 2000, 5000, 10000, 15000];
  const Y_TICKS = [100, 200, 500, 1000, 2000, 3500];
  const ISO_COSTS = [500, 1000, 2000, 3000, 5000, 10000, 15000];

  const state = {
    grid: null, idx: null, revA: window.REV_A, ladder: window.LADDER,
    tier: M.REFERENCE_TIER, column: null, launch: NaN, leg: NaN, legIsDefault: false, source: 'snapshot', fileName: '',
    snapshotRevAMd5: window.DECISION_GRID && window.DECISION_GRID.rev_a_md5,
  };

  // -- small DOM helpers
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid);
    return n;
  }
  function svgEl(tag, attrs, text) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  // parts: strings, or ['b', text] for emphasised values. Never innerHTML.
  function setRich(node, parts) {
    node.textContent = '';
    for (const p of parts) node.append(Array.isArray(p) ? el(p[0], { text: p[1] }) : document.createTextNode(p));
  }
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const compact = (v) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`);
  const launchAxis = () => state.grid.axes[M.LAUNCH];
  const legAxis = () => state.grid.axes[M.LEG];
  const columnColor = (col) => cssVar(SERIES_VARS[Math.max(0, state.idx.columns.indexOf(col)) % SERIES_VARS.length]);

  // -- provenance strip
  function renderProvenance() {
    const g = state.grid;
    const p = $('prov');
    p.textContent = '';
    const item = (...parts) => { const s = el('span'); setRich(s, parts); p.append(s); };
    item('grid schema ', ['b', g.schema_version]);
    item('built ', ['b', String(g.generated_at).slice(0, 10)], ' at Skyhook ', ['b', String(g.git_commit).slice(0, 7)]);
    item('from rev_a.json md5 ', ['b', String(g.rev_a_md5).slice(0, 8)]);
    item('workbook md5 ', ['b', String(g.workbook_md5).slice(0, 8)]);
    if (state.source === 'snapshot') {
      const src = g.__source || {};
      item('snapshot taken at Skyhook ', ['b', String(src.commit || '').slice(0, 7)], src.pathLastChanged ? ` (${String(src.pathLastChanged).slice(8, 18)})` : '');
    } else {
      item('loaded from file ', ['b', state.fileName]);
      if (g.rev_a_md5 !== state.snapshotRevAMd5) {
        const w = el('span', { class: 'bad', text: 'built from a different rev_a.json than the snapshot excerpt; tier tip speeds and anchors shown here may be stale' });
        p.append(w);
      }
    }
    item(['b', String(g.points.length)], ' points, ', ['b', String(state.idx.launchAxis.length)], ' launch nodes');
  }

  // -- controls
  function buildControls() {
    const tiers = $('tiers');
    tiers.textContent = '';
    for (const t of state.idx.tiers) {
      const info = M.tierInfo(state.revA, t);
      const b = el('button', { type: 'button', 'data-tier': t, 'aria-pressed': String(t === state.tier) });
      if (M.isRefused(info)) {
        b.append(document.createTextNode(t), el('small', { text: 'no tip speed in the rev_a.json excerpt: refused' }));
      } else {
        b.append(document.createTextNode(`${info.name} · ${info.v_tip_kms} km/s`), el('small', { text: `${t} · ${info.standing}` }));
        b.title = `tip speed and standing from ${info.standingSource}`;
      }
      b.addEventListener('click', () => { state.tier = t; syncPressed(tiers, 'data-tier', t); renderStatic(); render(); });
      tiers.append(b);
    }
    const cols = $('columns');
    cols.textContent = '';
    for (const c of state.idx.columns) {
      const info = M.columnInfo(state.ladder, c);
      const b = el('button', { type: 'button', 'data-column': c, 'aria-pressed': String(c === state.column) });
      b.append(document.createTextNode(M.isRefused(info) ? c : info.label), el('small', { text: M.isRefused(info) ? 'no retention row in the ladder excerpt: refused' : info.summary }));
      b.addEventListener('click', () => { state.column = c; syncPressed(cols, 'data-column', c); renderStatic(); render(); });
      cols.append(b);
    }
    // launch anchors
    const chips = $('launch-markers');
    chips.textContent = '';
    for (const m of M.markers(state.grid, state.revA, state.ladder)) {
      const b = el('button', { type: 'button', class: m.onAxis ? '' : 'off', 'data-marker': m.id, title: `${m.source}${m.note ? ' — ' + m.note : ''}` });
      b.append(document.createTextNode(`${m.label} `), el('b', { text: M.money(m.value, 0) }));
      if (!m.onAxis) b.append(document.createTextNode(' · off axis'));
      b.addEventListener('click', () => { setLaunch(m.value); });
      chips.append(b);
    }
  }
  function syncPressed(container, attr, value) {
    for (const b of container.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
  }
  function syncChips() {
    for (const b of $('launch-markers').querySelectorAll('button')) {
      const v = Number(b.querySelector('b').textContent.replace(/[$,]/g, ''));
      b.setAttribute('aria-pressed', String(Math.abs(v - state.launch) < 0.005));
    }
  }

  // sliders: a 0..1000 position on the log axis <-> a dollar value; the number box is exact
  const fracToValue = (axis, pos) => Math.round(M.axisValue(axis, pos / 1000) * 100) / 100;
  const valueToPos = (axis, v) => Math.round(Math.min(1, Math.max(0, M.axisFrac(axis, Math.min(axis.max, Math.max(axis.min, v))))) * 1000);
  function setLaunch(v, from) {
    state.launch = v;
    if (from !== 'range' && Number.isFinite(v)) $('launch-range').value = valueToPos(launchAxis(), v);
    if (from !== 'num') $('launch-num').value = Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
    render();
  }
  function setLeg(v, from, isDefault) {
    state.leg = v;
    state.legIsDefault = !!isDefault;
    if (from !== 'range' && Number.isFinite(v)) $('leg-range').value = valueToPos(legAxis(), v);
    if (from !== 'num') $('leg-num').value = Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
    render();
  }
  function wireSliders() {
    $('launch-range').addEventListener('input', (e) => setLaunch(fracToValue(launchAxis(), Number(e.target.value)), 'range'));
    $('leg-range').addEventListener('input', (e) => setLeg(fracToValue(legAxis(), Number(e.target.value)), 'range'));
    const onNum = (id, setter) => {
      const handler = (e) => { const v = e.target.value.trim() === '' ? NaN : Number(e.target.value); setter(v, 'num'); };
      $(id).addEventListener('input', handler);
      $(id).addEventListener('change', handler);
    };
    onNum('launch-num', setLaunch);
    onNum('leg-num', setLeg);
    // A range input jumps on touchdown; if the gesture becomes a scroll (pointercancel), undo it.
    const guard = (id, get, set) => {
      let saved = null;
      $(id).addEventListener('pointerdown', (e) => { saved = e.pointerType === 'touch' ? { v: get(), isDefault: state.legIsDefault } : null; });
      $(id).addEventListener('pointercancel', () => { if (saved) { const s = saved; saved = null; set(s.v, undefined, s.isDefault); } });
      $(id).addEventListener('pointerup', () => { saved = null; });
    };
    guard('launch-range', () => state.launch, setLaunch);
    guard('leg-range', () => state.leg, setLeg);
  }

  // -- the reading
  function deriveText(node, r, fieldLabel) {
    if (r.kind === 'node') {
      setRich(node, ['Exactly the grid node at ', ['b', M.money(r.launch, 2)], '/kg; nothing interpolated.']);
      return;
    }
    const pct = (r.max_rel_error * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    setRich(node, [
      'Log-linear between the ', ['b', M.money(r.lo[M.LAUNCH], 2)], ' node (', ['b', M.money(r.lo[r.field], 4)], ') and the ', ['b', M.money(r.hi[M.LAUNCH], 2)], ' node (', ['b', M.money(r.hi[r.field], 4)], '): w = ln(L/L₀)/ln(L₁/L₀) = ', ['b', r.w.toFixed(4)],
      `. Declared worst-case interpolation error for ${fieldLabel}: `, ['b', `${pct}%`], ' (interpolation_fidelity).',
    ]);
  }
  function showRefusal(r) {
    const box = $('refusal');
    box.textContent = '';
    box.append(el('b', { text: 'Refused: ' + r.reason }));
    if (r.what_would_help) box.append(el('p', { text: 'What would help: ' + r.what_would_help }));
    box.hidden = false;
    $('panes').hidden = true;
    $('stepped').hidden = true;
  }
  // The partial-tier caveat, inside the reading above every number, refused or not.
  function renderPartialFlag() {
    const text = M.partialTierFor(state.grid, state.tier);
    const flag = $('partial-flag');
    if (!text) { flag.hidden = true; return; }
    const sum = M.partialTierSummary(text);
    $('partial-first').textContent = sum.first;
    $('partial-last').textContent = sum.last;
    $('partial-last').hidden = !sum.last;
    $('partial-tier-text').textContent = text;
    flag.hidden = false;
  }
  function legNoteText() {
    return state.legIsDefault ? `Default ${M.money(state.leg, 2)} = the log midpoint of the grid's leg display axis, not an estimate; set your own leg quote.` : '';
  }
  function render() {
    const sel = { tier: state.tier, column: state.column, launch: state.launch, leg: state.leg };
    const rd = M.reading(state.grid, state.revA, state.ladder, sel);
    syncChips();
    renderPartialFlag();
    const lnote = $('launch-note');
    const legNote = $('leg-note');
    if (M.isRefused(rd)) {
      showRefusal(rd);
      lnote.textContent = rd.code === 'outside_axis' || rd.code === 'no_input' ? rd.reason : '';
      lnote.className = 'note bad';
      legNote.textContent = legNoteText();
      legNote.className = 'note';
      drawPlane(null);
      drawCharts(null);
      return;
    }
    $('refusal').hidden = true;
    $('panes').hidden = false;
    $('stepped').hidden = false;
    lnote.className = 'note';
    lnote.textContent = rd.stepped.exact ? `On the ${M.money(rd.stepped.launch, 2)} grid node.` : `Between grid nodes; the nearest is ${M.money(rd.stepped.launch, 2)}.`;
    // delivered cost (straight-line, mature capacity)
    $('delivered').textContent = M.money(rd.delivered.value, 2);
    $('tag-delivered').textContent = rd.delivered.kind === 'node' ? 'exact node' : 'interpolated';
    $('tag-delivered').className = 'tag' + (rd.delivered.kind === 'node' ? ' node' : '');
    deriveText($('delivered-derive'), rd.delivered, 'delivered_total_per_kg');
    $('leg-shown').textContent = Number.isFinite(state.leg) ? M.money(state.leg, 2) : '—';
    if (M.isRefused(rd.plusLeg)) {
      $('plusleg').textContent = rd.plusLeg.code === 'no_input' ? 'no leg entered' : 'refused';
      $('plusleg-derive').textContent = rd.plusLeg.reason + '. ' + (rd.plusLeg.what_would_help ? 'What would help: ' + rd.plusLeg.what_would_help : '');
      legNote.textContent = rd.plusLeg.reason;
      legNote.className = 'note bad';
    } else {
      $('plusleg').textContent = M.money(rd.plusLeg.value, 2);
      setRich($('plusleg-derive'), [['b', rd.plusLeg.expression], ' (composition_rules). leg_cost_per_kg is ', rd.plusLeg.source]);
      legNote.textContent = legNoteText();
      legNote.className = 'note';
    }
    // Y15 breakeven price (ramped, discounted)
    $('breakeven').textContent = M.money(rd.breakeven.value, 2);
    $('tag-breakeven').textContent = rd.breakeven.kind === 'node' ? 'exact node' : 'interpolated';
    $('tag-breakeven').className = 'tag' + (rd.breakeven.kind === 'node' ? ' node' : '');
    deriveText($('breakeven-derive'), rd.breakeven, 'breakeven_price_per_kg');
    if (rd.customerPrice) {
      setRich($('customer-price'), ['A price, so it may sit beside the workbook\'s customer-price assumption for this column: ', ['b', M.money(rd.customerPrice.value, 0)], `/kg (Assumptions row ${rd.customerPrice.row}${rd.customerPrice.note ? ', "' + rd.customerPrice.note + '"' : ''}).`]);
    } else {
      $('customer-price').textContent = 'The workbook ladder excerpt has no customer-price row for this column.';
    }
    $('comparability-text').textContent = rd.caveats.comparability;
    // stepped
    const st = rd.stepped;
    setRich($('stepped-where'), st.exact
      ? ['You are on the ', ['b', M.money(st.launch, 2)], ' node, so these are that node\'s values.']
      : ['Nearest node: ', ['b', M.money(st.launch, 2)], ' (you are at ', ['b', M.money(state.launch, 2)], '; nearest in log distance, an exact midpoint goes to the lower node). NPV and capex are that node\'s, not blended; payback is the bracket when the two nodes around you disagree.']);
    const pb = $('payback');
    pb.textContent = '';
    pb.append(document.createTextNode(st.payback.text));
    if (st.payback.bracketed) pb.append(el('small', { text: st.payback.detail }));
    if (st.payback.text.includes('not reached')) pb.append(el('small', { text: st.payback.note }));
    $('npv').textContent = M.moneyM(st.npv_10pct_M);
    renderTether($('massratio'), st.tether.ratio, (v) => `${M.fmt(v, 2)}×`, 'Integrated two-arm; launch-invariant within a tier and column');
    renderTether($('fibre'), st.tether.fibre, (v) => `${M.fmt(v, 1)} t`, 'At the 5,000 kg payload');
    $('capex').textContent = M.moneyM(st.total_capex_M);
    $('syscapex').textContent = M.moneyM(st.system_capex_M);
    renderNodeTable(st.node, rd.caveats, st.tether);
    drawPlane(rd);
    drawCharts(rd);
  }
  // A tether figure only as the params/rev_a.json value (Rule 1), else the refusal.
  function renderTether(node, t, show, sub) {
    node.textContent = '';
    node.classList.toggle('withheld', M.isRefused(t));
    if (M.isRefused(t)) {
      node.append(document.createTextNode('not shown'), el('small', { text: t.reason + '.' }));
      return;
    }
    node.append(document.createTextNode(show(t.value)), el('small', { text: `params/rev_a.json ${t.key}; the grid's ${M.fmt(t.grid, 4)} agrees to the canon's printed precision. ${sub}.` }));
  }
  function renderNodeTable(node, caveats, tether) {
    const tb = $('node-table').querySelector('tbody');
    tb.textContent = '';
    for (const [k, v] of Object.entries(node)) {
      const tr = el('tr');
      const key = el('td', { class: 'key', text: k });
      if (k === 'ops_wear_insurance_per_kg') key.append(el('sup', { text: '†' }));
      if (k === 'amortized_capex_per_kg') key.append(el('sup', { text: '‡' }));
      if ((k === 'mass_ratio_x' || k === 'fiber_mass_t') && tether.status !== 'canon') key.append(el('sup', { text: '§' }));
      const val = el('td', { class: typeof v === 'number' ? 'num' : '', text: v === null ? 'null' : typeof v === 'number' ? M.fmt(v, Number.isInteger(v) ? 0 : 4) : String(v) });
      tr.append(key, val);
      tb.append(tr);
    }
    const canonNote = tether.status === 'canon' ? '' : ' § finance-model output with no matching params/rev_a.json rung for this tier and derate: not Rule 1 canon, shown here only because this table is the grid record verbatim.';
    $('node-foot').textContent = `† ${caveats.insurance.split('.')[0]}. The full insurance_status text is under Caveats. ‡ capex spread straight-line over ${caveats.amortYears} years of mature upmass (amort_years_convention), undiscounted, no revenue ramp.${canonNote}`;
  }

  // -- static caveats
  function renderCaveats() {
    const g = state.grid;
    $('insurance-text').textContent = g.insurance_status;
    const ul = $('lanes-list');
    ul.textContent = '';
    for (const a of M.laneMultipliers(g)) {
      const li = el('li');
      li.append(el('b', { text: `${a.name} = ${a.valueText}` }), document.createTextNode(` — ${a.note} Not applied anywhere on this page.`));
      ul.append(li);
    }
    const ol = $('notes-list');
    ol.textContent = '';
    for (const n of g.notes) ol.append(el('li', { text: n }));
  }

  // -- the plane (canvas)
  const plane = { canvas: null, ctx: null, geom: null, heat: null, heatKey: '' };
  function planeGeometry() {
    const c = plane.canvas;
    const cssW = Math.max(280, Math.floor(c.parentElement.clientWidth || 320));
    const cssH = Math.round(Math.min(440, Math.max(260, cssW * 0.62)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    c.style.height = `${cssH}px`;
    const ml = 50, mr = 14, mt = 12, mb = 34;
    const g = { cssW, cssH, dpr, ml, mr, mt, mb, pw: cssW - ml - mr, ph: cssH - mt - mb };
    g.x = (leg) => g.ml + M.axisFrac(legAxis(), leg) * g.pw;
    g.y = (L) => g.mt + (1 - M.axisFrac(launchAxis(), L)) * g.ph;
    g.legAt = (x) => M.axisValue(legAxis(), Math.min(1, Math.max(0, (x - g.ml) / g.pw)));
    g.launchAt = (y) => M.axisValue(launchAxis(), Math.min(1, Math.max(0, 1 - (y - g.mt) / g.ph)));
    plane.geom = g;
    return g;
  }
  function rampLUT() {
    const ramp = isDark() ? RAMP_DARK : RAMP_LIGHT;
    const rgb = ramp.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (rgb.length - 1);
      const k = Math.min(rgb.length - 2, Math.floor(t));
      const f = t - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(rgb[k][c] + f * (rgb[k + 1][c] - rgb[k][c]));
    }
    return lut;
  }
  // The heatmap depends only on the series (tier, column) and the geometry; drawn once, cached.
  function renderHeatmap(series, g) {
    const key = `${state.tier}|${state.column}|${g.cssW}|${g.cssH}|${isDark()}|${state.source}${state.fileName}`;
    if (plane.heatKey === key && plane.heat) return plane.heat;
    const W = Math.round(g.pw * g.dpr);
    const H = Math.round(g.ph * g.dpr);
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    const img = octx.createImageData(W, H);
    const lut = rampLUT();
    const range = M.composedRange(state.grid);
    const lnMin = Math.log(range.min);
    const span = Math.log(range.max) - lnMin;
    const legs = new Float64Array(W);
    for (let c = 0; c < W; c++) legs[c] = g.legAt(g.ml + (c + 0.5) / g.dpr);
    for (let r = 0; r < H; r++) {
      const L = g.launchAt(g.mt + (r + 0.5) / g.dpr);
      const d = M.interpolate(state.grid, series, 'delivered_total_per_kg', L);
      const dv = M.isRefused(d) ? NaN : d.value;
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        if (!Number.isFinite(dv)) { img.data[i + 3] = 0; continue; }
        const v = legs[c] + dv;
        const t = Math.min(1, Math.max(0, (Math.log(v) - lnMin) / span));
        const k = Math.round(t * 255) * 3;
        img.data[i] = lut[k]; img.data[i + 1] = lut[k + 1]; img.data[i + 2] = lut[k + 2]; img.data[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    plane.heat = off;
    plane.heatKey = key;
    return off;
  }
  function haloText(ctx, text, x, y, align, color) {
    ctx.textAlign = align || 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = cssVar('--card');
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || cssVar('--ink');
    ctx.fillText(text, x, y);
  }
  function drawPlane(rd) {
    const c = plane.canvas;
    const g = planeGeometry();
    const ctx = plane.ctx;
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, g.cssW, g.cssH);
    ctx.fillStyle = cssVar('--card');
    ctx.fillRect(0, 0, g.cssW, g.cssH);
    const series = state.idx.get(state.tier, state.column);
    if (!series) return;
    ctx.drawImage(renderHeatmap(series, g), g.ml, g.mt, g.pw, g.ph);
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    // axes and ticks
    ctx.strokeStyle = cssVar('--axis');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.ml, g.mt); ctx.lineTo(g.ml, g.mt + g.ph); ctx.lineTo(g.ml + g.pw, g.mt + g.ph);
    ctx.stroke();
    ctx.fillStyle = cssVar('--faint');
    const narrow = g.pw < 500;
    for (const v of X_TICKS) {
      if (v < legAxis().min || v > legAxis().max) continue;
      if (narrow && (v === 500 || v === 10000)) continue;
      const x = g.x(v);
      ctx.beginPath(); ctx.moveTo(x, g.mt + g.ph); ctx.lineTo(x, g.mt + g.ph + 4); ctx.stroke();
      ctx.textAlign = v === legAxis().max ? 'right' : v === legAxis().min ? 'left' : 'center';
      ctx.fillText(compact(v), x, g.mt + g.ph + 12);
    }
    for (const v of Y_TICKS) {
      if (v < launchAxis().min || v > launchAxis().max) continue;
      const y = g.y(v);
      ctx.beginPath(); ctx.moveTo(g.ml - 4, y); ctx.lineTo(g.ml, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(compact(v), g.ml - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.fillText('rocket leg $/kg →', g.ml + g.pw / 2, g.cssH - 8);
    ctx.save();
    ctx.translate(11, g.mt + g.ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('construction launch $/kg →', 0, 0);
    ctx.restore();
    // iso-cost lines of delivered + leg, sampled along the launch axis (near-vertical)
    ctx.strokeStyle = cssVar('--ink');
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (const C of (narrow ? ISO_COSTS.filter((v) => v !== 3000 && v !== 10000 && v !== 15000) : ISO_COSTS)) {
      let last = null;
      let drawing = false;
      ctx.beginPath();
      for (let y = g.mt; y <= g.mt + g.ph; y += 2) {
        const d = M.interpolate(state.grid, series, 'delivered_total_per_kg', g.launchAt(y));
        const leg = M.isRefused(d) ? NaN : C - d.value;
        if (!M.onAxis(legAxis(), leg)) { drawing = false; continue; }
        const x = g.x(leg);
        if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
        last = [x, y];
      }
      ctx.stroke();
      if (last) {
        // label at the lower end of the line, clear of the anchor labels on the right and the top
        const nearRight = last[0] > g.ml + g.pw - 36;
        ctx.globalAlpha = 1;
        haloText(ctx, compact(C), nearRight ? last[0] - 4 : last[0] + 4, Math.min(g.mt + g.ph - 8, last[1] + 8), nearRight ? 'right' : 'left', cssVar('--ink'));
        ctx.globalAlpha = 0.55;
      }
    }
    ctx.globalAlpha = 1;
    // launch anchors as hairlines
    ctx.strokeStyle = cssVar('--faint');
    for (const m of M.markers(state.grid, state.revA, state.ladder)) {
      if (!m.onAxis) continue;
      const y = g.y(m.value);
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(g.ml, y); ctx.lineTo(g.ml + g.pw, y); ctx.stroke();
      const col = m.label.replace('Workbook ', '');
      const short = m.id === 'f9' ? 'Falcon 9' : m.id === 'marginal' ? 'marginal' : narrow ? `wb ${col.slice(0, 4)}.` : `workbook ${col}`;
      haloText(ctx, `${short} ${M.money(m.value, 0)}`, g.ml + g.pw - 4, y - 7, 'right', cssVar('--muted'));
    }
    // crosshair
    if (rd && !M.isRefused(rd) && M.onAxis(legAxis(), state.leg)) {
      const x = g.x(state.leg);
      const y = g.y(state.launch);
      ctx.strokeStyle = cssVar('--ink');
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, g.mt); ctx.lineTo(x, g.mt + g.ph); ctx.moveTo(g.ml, y); ctx.lineTo(g.ml + g.pw, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = cssVar('--card'); ctx.fill();
      ctx.lineWidth = 2; ctx.stroke();
      if (!M.isRefused(rd.plusLeg)) {
        const label = `${M.money(rd.plusLeg.value, 0)}/kg delivered + leg`;
        const right = x > g.ml + g.pw * (narrow ? 0.45 : 0.6);
        const below = y < g.mt + 22;
        haloText(ctx, label, right ? x - 9 : x + 9, below ? y + 14 : y - 10, right ? 'right' : 'left', cssVar('--ink'));
      }
    }
    // legend
    const range = M.composedRange(state.grid);
    const lg = $('plane-legend');
    lg.textContent = '';
    const ramp = el('span');
    ramp.append(document.createTextNode(M.money(range.min, 0)), el('span', { class: 'ramp' }), document.createTextNode(`${M.money(range.max, 0)}/kg delivered + leg, log colour scale fixed across all tiers`));
    lg.append(ramp, el('span', {}, el('span', { class: 'sw', style: `background:${cssVar('--ink')};opacity:.55` }), document.createTextNode('iso-cost lines')), el('span', {}, el('span', { class: 'sw', style: `background:${cssVar('--faint')}` }), document.createTextNode('launch anchors (rev_a.json, workbook)')), el('span', {}, el('span', { class: 'sw', style: `background:${cssVar('--ink')}` }), document.createTextNode('crosshair = your two numbers')));
  }
  const HANDLE_R = 28; // px: how close to the crosshair a touch must start to drag it
  const TAP_SLOP = 10; // px: a touch that moves further than this is not a tap
  function wireCanvas() {
    const c = plane.canvas;
    let drag = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const nearHandle = (p) => {
      const g = plane.geom;
      if (!g || !M.onAxis(legAxis(), state.leg) || !M.onAxis(launchAxis(), state.launch)) return false;
      return Math.hypot(p.x - g.x(state.leg), p.y - g.y(state.launch)) <= HANDLE_R;
    };
    const place = (p) => {
      const g = plane.geom;
      const leg = Math.round(g.legAt(p.x) * 100) / 100;
      const L = Math.round(g.launchAt(p.y) * 100) / 100;
      state.leg = leg; state.launch = L; state.legIsDefault = false;
      $('leg-range').value = valueToPos(legAxis(), leg); $('leg-num').value = String(leg);
      $('launch-range').value = valueToPos(launchAxis(), L); $('launch-num').value = String(L);
      render();
    };
    // A touch that starts on the handle owns the gesture: cancel the page scroll for it alone.
    c.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const r = c.getBoundingClientRect();
      if (nearHandle({ x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top })) e.preventDefault();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      if (e.pointerType === 'touch' && !nearHandle(p)) { drag = { id: e.pointerId, handle: false, start: p }; return; }
      drag = { id: e.pointerId, handle: true, start: p, touch: e.pointerType === 'touch' };
      c.setPointerCapture(e.pointerId);
      if (e.pointerType !== 'touch') place(p);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => { if (drag && drag.handle && drag.id === e.pointerId) place(pos(e)); });
    c.addEventListener('pointerup', (e) => {
      // a touch that did not move is a tap and places; a scroll ends in pointercancel instead
      if (drag && (!drag.handle || drag.touch) && drag.id === e.pointerId) {
        const p = pos(e);
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) <= TAP_SLOP) place(p);
      }
      drag = null;
    });
    c.addEventListener('pointercancel', () => { drag = null; });
    c.addEventListener('keydown', (e) => {
      const stepL = (axis, v, d) => Math.round(M.axisValue(axis, Math.min(1, Math.max(0, M.axisFrac(axis, Math.min(axis.max, Math.max(axis.min, v))) + d))) * 100) / 100;
      if (e.key === 'ArrowLeft') setLeg(stepL(legAxis(), state.leg, -0.01));
      else if (e.key === 'ArrowRight') setLeg(stepL(legAxis(), state.leg, 0.01));
      else if (e.key === 'ArrowUp') setLaunch(stepL(launchAxis(), state.launch, 0.01));
      else if (e.key === 'ArrowDown') setLaunch(stepL(launchAxis(), state.launch, -0.01));
      else return;
      e.preventDefault();
    });
  }

  // -- the two SVG charts
  function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function chartFrame(svg, H, yMax, yFmt, yTicks) {
    const W = Math.max(280, Math.floor(svg.parentElement.clientWidth || 320));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.textContent = '';
    const ml = 46, mr = 12, mt = 10, mb = 26;
    const f = { W, H, ml, mr, mt, mb, pw: W - ml - mr, ph: H - mt - mb, yMax };
    f.x = (L) => ml + M.axisFrac(launchAxis(), L) * f.pw;
    f.y = (v) => mt + (1 - v / yMax) * f.ph;
    f.launchAt = (x) => M.axisValue(launchAxis(), Math.min(1, Math.max(0, (x - ml) / f.pw)));
    for (const v of yTicks || [0, 1, 2, 3, 4].map((i) => (yMax * i) / 4)) {
      svg.append(svgEl('line', { x1: ml, x2: ml + f.pw, y1: f.y(v), y2: f.y(v), class: 'grid' }));
      svg.append(svgEl('text', { x: ml - 6, y: f.y(v) + 4, 'text-anchor': 'end' }, yFmt(v)));
    }
    svg.append(svgEl('line', { x1: ml, x2: ml + f.pw, y1: mt + f.ph, y2: mt + f.ph, class: 'axis' }));
    for (const v of Y_TICKS) {
      if (v < launchAxis().min || v > launchAxis().max) continue;
      const x = f.x(v);
      svg.append(svgEl('line', { x1: x, x2: x, y1: mt + f.ph, y2: mt + f.ph + 4, class: 'axis' }));
      svg.append(svgEl('text', { x, y: mt + f.ph + 16, 'text-anchor': v === launchAxis().max ? 'end' : v === launchAxis().min ? 'start' : 'middle' }, compact(v)));
    }
    return f;
  }
  function drawCharts(rd) {
    const tierSeries = state.idx.columns.map((c) => [c, state.idx.get(state.tier, c)]).filter(([, s]) => s);
    // breakeven: straight segments between nodes on the log axis ARE the declared interpolation
    const bsvg = $('breakeven-chart');
    const maxB = Math.max(...tierSeries.map(([, s]) => Math.max(...s.map((p) => p.breakeven_price_per_kg))));
    const fb = chartFrame(bsvg, 240, niceCeil(maxB), (v) => `$${M.fmt(v, 0)}`);
    const cp = M.ladderValue(state.ladder, 'customer_price_per_kg', state.column);
    if (cp && cp.value <= fb.yMax) {
      bsvg.append(svgEl('line', { x1: fb.ml, x2: fb.ml + fb.pw, y1: fb.y(cp.value), y2: fb.y(cp.value), class: 'ref' }));
      bsvg.append(svgEl('text', { x: fb.ml + 4, y: fb.y(cp.value) - 4, class: 'halo' }, `workbook customer price ${M.money(cp.value, 0)}/kg (row ${cp.row})`));
    }
    for (const [col, s] of tierSeries) {
      const d = s.map((p, i) => `${i ? 'L' : 'M'}${fb.x(p[M.LAUNCH]).toFixed(1)} ${fb.y(p.breakeven_price_per_kg).toFixed(1)}`).join(' ');
      bsvg.append(svgEl('path', { d, class: `series ${col === state.column ? 'on' : 'off'}`, stroke: columnColor(col) }));
    }
    if (rd && !M.isRefused(rd)) {
      const x = fb.x(state.launch);
      bsvg.append(svgEl('line', { x1: x, x2: x, y1: fb.mt, y2: fb.mt + fb.ph, class: 'cur' }));
      const y = fb.y(rd.breakeven.value);
      bsvg.append(svgEl('circle', { cx: x, cy: y, r: 5, fill: columnColor(state.column), stroke: cssVar('--card'), 'stroke-width': 2 }));
      const right = x > fb.ml + fb.pw * 0.65;
      bsvg.append(svgEl('text', { x: right ? x - 9 : x + 9, y: y - 8, 'text-anchor': right ? 'end' : 'start', class: 'ink halo' }, `${M.money(rd.breakeven.value, 0)}/kg at ${M.money(state.launch, 0)} launch`));
    }
    // legend, fixed order and colour per column
    const lg = $('chart-legend');
    lg.textContent = '';
    for (const [col] of tierSeries) {
      const info = M.columnInfo(state.ladder, col);
      lg.append(el('span', {}, el('span', { class: 'sw', style: `background:${columnColor(col)}` }), document.createTextNode(M.isRefused(info) ? col : info.label)));
    }
    lg.append(el('span', {}, el('span', { class: 'sw', style: `background:${cssVar('--ink')}` }), document.createTextNode('your launch price')));
    // payback: stepped at the log midpoints between nodes; null drawn in the "not reached" band
    const psvg = $('payback-chart');
    const nul = M.paybackText(state.grid, null);
    const windowYears = Number((/within (\d+) years/.exec(nul.note || '') || [])[1]) || 40;
    const fp = chartFrame(psvg, 190, windowYears * 1.15, (v) => `Y${Math.round(v)}`, [0, 1, 2, 3, 4].map((i) => (windowYears * i) / 4));
    const yNone = fp.y(windowYears * 1.08);
    psvg.append(svgEl('text', { x: fp.ml + 4, y: yNone - 5, class: 'halo' }, nul.text));
    psvg.append(svgEl('line', { x1: fp.ml, x2: fp.ml + fp.pw, y1: fp.y(windowYears), y2: fp.y(windowYears), class: 'ref' }));
    for (const [col, s] of tierSeries) {
      let d = '';
      let dNull = '';
      for (let i = 0; i < s.length; i++) {
        const x0 = i === 0 ? fp.x(launchAxis().min) : fp.x(Math.sqrt(s[i - 1][M.LAUNCH] * s[i][M.LAUNCH]));
        const x1 = i === s.length - 1 ? fp.x(launchAxis().max) : fp.x(Math.sqrt(s[i][M.LAUNCH] * s[i + 1][M.LAUNCH]));
        if (s[i].payback_year === null) { dNull += `M${x0.toFixed(1)} ${yNone.toFixed(1)} L${x1.toFixed(1)} ${yNone.toFixed(1)} `; continue; }
        const y = fp.y(s[i].payback_year).toFixed(1);
        d += (d && s[i - 1] && s[i - 1].payback_year !== null ? `L${x0.toFixed(1)} ${y} ` : `M${x0.toFixed(1)} ${y} `) + `L${x1.toFixed(1)} ${y} `;
      }
      psvg.append(svgEl('path', { d, class: `series ${col === state.column ? 'on' : 'off'}`, stroke: columnColor(col) }));
      if (dNull) psvg.append(svgEl('path', { d: dNull, class: `series ${col === state.column ? 'on' : 'off'}`, stroke: columnColor(col), 'stroke-dasharray': '2 4' }));
    }
    if (rd && !M.isRefused(rd)) {
      const x = fp.x(state.launch);
      psvg.append(svgEl('line', { x1: x, x2: x, y1: fp.mt, y2: fp.mt + fp.ph, class: 'cur' }));
      const pbv = rd.stepped.payback.value;
      const y = pbv === null ? yNone : fp.y(pbv);
      psvg.append(svgEl('circle', { cx: x, cy: y, r: 5, fill: columnColor(state.column), stroke: cssVar('--card'), 'stroke-width': 2 }));
      const right = x > fp.ml + fp.pw * 0.65;
      const pt = rd.stepped.payback;
      const where = pt.bracketed ? `between the ${M.money(pt.lo.launch, 0)} and ${M.money(pt.hi.launch, 0)} nodes` : `at the ${M.money(rd.stepped.launch, 0)} node`;
      psvg.append(svgEl('text', { x: right ? x - 9 : x + 9, y: y - 8, 'text-anchor': right ? 'end' : 'start', class: 'ink halo' }, `${pt.text} ${where}`));
    }
  }
  function wireChartHover() {
    const svg = $('breakeven-chart');
    const tip = $('chart-tip');
    const at = (e) => {
      const r = svg.getBoundingClientRect();
      const W = Number(svg.getAttribute('width')) || r.width;
      const x = ((e.clientX - r.left) / r.width) * W;
      const ml = 46, mr = 12;
      return M.axisValue(launchAxis(), Math.min(1, Math.max(0, (x - ml) / (W - ml - mr))));
    };
    svg.addEventListener('pointermove', (e) => {
      const L = Math.round(at(e) * 100) / 100;
      const parts = [['b', `${M.money(L, 0)}/kg launch`], ' · breakeven: '];
      for (const c of state.idx.columns) {
        const s = state.idx.get(state.tier, c);
        if (!s) continue;
        const v = M.interpolate(state.grid, s, 'breakeven_price_per_kg', L);
        parts.push(`${c} `, ['b', M.isRefused(v) ? '—' : M.money(v.value, 0)], ' ');
      }
      setRich(tip, parts);
      tip.hidden = false;
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      tip.style.left = `${Math.min(px + 12, r.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${e.clientY - r.top - 36}px`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.addEventListener('pointercancel', () => { tip.hidden = true; });
    // 'click', not 'pointerdown': a tap is a click, a scroll that starts here is not.
    svg.addEventListener('click', (e) => { setLaunch(Math.round(at(e) * 100) / 100); });
  }

  // -- a newer grid from a file
  function wireFile() {
    $('grid-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const msg = $('load-msg');
      if (!file) return;
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch (err) {
        msg.className = 'note bad';
        msg.textContent = `Refused: ${file.name} is not valid JSON (${err.message}). The snapshot stays.`;
        return;
      }
      const v = M.validateGrid(parsed);
      if (!v.ok) {
        msg.className = 'note bad';
        msg.textContent = `Refused ${file.name}: ${v.reasons.join('; ')}. The snapshot stays.`;
        return;
      }
      state.grid = parsed;
      state.idx = M.indexGrid(parsed);
      state.source = 'file';
      state.fileName = file.name;
      if (!state.idx.tiers.includes(state.tier)) state.tier = M.REFERENCE_TIER;
      if (!state.idx.columns.includes(state.column)) state.column = state.idx.columns[0];
      plane.heatKey = '';
      msg.className = 'note';
      msg.textContent = `Reading ${file.name}: schema ${parsed.schema_version}, ${parsed.points.length} points, built at ${String(parsed.git_commit).slice(0, 7)} (${String(parsed.generated_at).slice(0, 10)}).`;
      buildControls();
      renderAll();
    });
  }

  // A column is the whole workbook ladder column: say so under the control, and list its rows.
  function renderLevers() {
    const box = $('column-levers');
    box.textContent = '';
    const lv = M.columnLevers(state.ladder, state.column);
    if (M.isRefused(lv)) { box.textContent = lv.reason; return; }
    box.append(el('span', { text: `"${state.column}" is the workbook's whole ${state.column} column, not only its derate: ${lv.nDiffer} of the ${lv.nRows} ${lv.sheet} rows differ between the columns, so a payback or NPV difference between columns is not a difference in derate alone.` }));
    const det = el('details');
    det.append(el('summary', { text: `This column's ${lv.nRows} rows (${lv.sheet} ${lv.range})` }));
    const ul = el('ul');
    for (const r of lv.rows) {
      const li = el('li', { class: r.differs ? '' : 'same' });
      li.append(document.createTextNode(`row ${r.row} · ${r.parameter}: `), el('b', { text: String(r.value) }));
      if (!r.differs) li.append(document.createTextNode(' (same in every column)'));
      if (r.row === state.ladder.keys.construction_launch_per_kg) li.append(document.createTextNode(' (replaced on this page by the launch you choose)'));
      ul.append(li);
    }
    det.append(ul);
    box.append(det);
  }

  // -- boot
  function renderStatic() {
    renderProvenance();
    renderCaveats();
    renderLevers();
  }
  function renderAll() {
    renderStatic();
    if (!Number.isFinite(state.launch)) {
      const anchor = state.revA && state.revA.economics && state.revA.economics.launch_price_anchor_dedicated_kgs;
      setLaunch(M.onAxis(launchAxis(), anchor) ? anchor : launchAxis().min);
    } else setLaunch(state.launch);
    if (!Number.isFinite(state.leg)) setLeg(Math.round(M.axisValue(legAxis(), 0.5) * 100) / 100, undefined, true); else setLeg(state.leg, undefined, state.legIsDefault);
  }
  function fatal(reasons) {
    const box = $('refusal');
    box.textContent = '';
    box.append(el('b', { text: 'This page refuses to render: the bundled decision grid failed validation.' }));
    const ul = el('ul');
    for (const r of reasons) ul.append(el('li', { text: r }));
    box.append(ul);
    box.hidden = false;
    $('panes').hidden = true;
    $('stepped').hidden = true;
  }
  function init() {
    const g = window.DECISION_GRID;
    const v = M.validateGrid(g);
    if (!v.ok) { fatal(v.reasons); return; }
    state.grid = g;
    state.idx = M.indexGrid(g);
    state.column = state.idx.columns[0];
    plane.canvas = $('plane');
    plane.ctx = plane.canvas.getContext('2d');
    buildControls();
    wireSliders();
    wireCanvas();
    wireChartHover();
    wireFile();
    renderAll();
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => render(), 120); });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { plane.heatKey = ''; render(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }
  init();
})();
