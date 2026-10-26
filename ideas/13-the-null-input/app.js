// app.js — wires model.js and data.js to the page. Computes everything live; fetches nothing.
(function () {
  'use strict';
  const D = window.NullInputData;
  const M = window.NullInputModel;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const svgEl = (tag, attrs, text) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const model = new M.Model(D.rev_a);
  const ladder = M.loadLadder(D.ladder);
  const cons = ladder.Conservative;
  const base = ladder.Baseline;
  const commit = (D.provenance['ladder.json'] && D.provenance['ladder.json'].commit || '').slice(0, 7);
  const fc = D.rev_a.economics.fiber_cost_per_kg;

  // ── header ────────────────────────────────────────────────────────────────────────────────
  $('meta').innerHTML = '';
  $('meta').append('rev_a.json economics.fiber_cost_per_kg = ');
  $('meta').append(el('b', null, JSON.stringify(fc)));
  $('meta').append(` · "${D.rev_a.economics._fiber_cost_note || ''}" · snapshots @ ${commit} · ladder: workbook Assumptions rows 3–16 · V_c ${model.Vc_kms.toFixed(4)} km/s · v_orb ${model.v_orb_kms.toFixed(4)} km/s`);

  // ── gate ──────────────────────────────────────────────────────────────────────────────────
  const gate = M.runGate(model, ladder, D.published);
  {
    const tb = $('gate').querySelector('tbody');
    for (const c of gate.checks) {
      const tr = el('tr');
      tr.append(el('td', null, c.label));
      tr.append(el('td', { class: 'num' }, c.got === null ? 'never' : String(c.got)));
      tr.append(el('td', { class: 'num' }, String(c.want)));
      tr.append(el('td', { class: c.ok ? 'ok' : 'bad' }, c.ok ? 'ok' : 'BAD'));
      tb.append(tr);
    }
    const n = gate.checks.filter((c) => c.ok).length;
    $('gate-summary').textContent = `gate: ${n} of ${gate.checks.length} anchors reproduced` + (gate.ok ? '.' : ' — refusing to print any fiber line below.');
    $('gate-summary').className = gate.ok ? 'small ok' : 'small bad';
  }

  // ── structured refusal ────────────────────────────────────────────────────────────────────
  function showRefusal(code, what, help) {
    const box = $('refusal');
    box.innerHTML = '';
    box.append(el('div', { class: 'code' }, code));
    box.append(el('p', null, what));
    const h = el('p');
    h.append(el('b', null, 'What would help: '));
    h.append(help);
    box.append(h);
    $('card').hidden = true;
    $('card').innerHTML = '';
  }

  if (!gate.ok) {
    showRefusal('gate_failed', 'The chain did not reproduce the published figures at $0/kg; nothing on this page can be trusted until it does.',
      'compare the BAD rows in the gate table with docs/DECISION_LOG.md items 6–8 and params/rev_a.json; re-derive snapshots/ladder.json with build_data.py.');
    $('sec-sweep').hidden = true;
    return;
  }

  // ── sweep tables ──────────────────────────────────────────────────────────────────────────
  const prices = D.price_grid;
  const study = M.computeStudy(model, ladder, prices, 1.0, D.markers);
  {
    const tb = $('sweep').querySelector('tbody');
    for (const step of study.sweep) {
      step.rows.forEach((r, i) => {
        const tr = el('tr', i === 0 ? { class: 'group' } : null);
        tr.append(el('td', { class: 'mono' }, i === 0 ? M.priceStr(step.fiber_price_per_kg) : ''));
        const lab = el('td', null, M.rowLabel(r));
        if (r.partial_tier_model) lab.append(' ', el('span', { class: 'tag-partial' }, '(partial tier model)'));
        tr.append(lab);
        tr.append(el('td', { class: 'num' }, M.fixed(r.fiber_mass_t, 1)));
        tr.append(el('td', { class: 'num' }, M.thousands(r.fiber_purchase_M)));
        tr.append(el('td', { class: 'num' }, M.thousands(r.total_capex_M)));
        tr.append(el('td', { class: 'num' }, M.pbStr(r.payback_year)));
        tr.append(el('td', { class: 'num' }, M.thousands(r.npv_10pct_M)));
        tr.append(el('td', { class: 'num' }, M.thousands(r.breakeven_customer_price_y15)));
        tb.append(tr);
      });
    }
  }
  {
    const fields = Object.keys(M.INPUTS);
    const th = $('thresholds').querySelector('thead');
    const tr = el('tr');
    tr.append(el('th', { scope: 'col' }, 'fiber $/kg'));
    for (const f of fields) tr.append(el('th', { scope: 'col', class: 'num' }, `${M.SHORT[f]} ${M.INPUTS[f][1] === 'up' ? '≥' : '≤'}`));
    th.append(tr);
    const tb = $('thresholds').querySelector('tbody');
    for (const step of study.sweep) {
      const row = el('tr');
      row.append(el('td', { class: 'mono' }, M.priceStr(step.fiber_price_per_kg)));
      for (const f of fields) row.append(el('td', { class: 'num' }, M.thrStr(f, step.conservative_thresholds[f])));
      tb.append(row);
    }
    $('thresholds-note').textContent = 'conservative values: ' + fields.map((f) => `${M.SHORT[f]} ${M.thrStr(f, M.Model.getInput(cons, f))}`).join(', ')
      + `. "cannot" = no value within a 5× stretch, or none physical, closes the case. The launch threshold falls by multiplier ÷ hardware mass factor (${(1 / cons.hardware_mass_factor).toFixed(3)} $/kg per $/kg of fiber at ×1.00); a hardware factor below the optimistic 1.4× is implausible and below 1.0× unphysical, printed as the arithmetic says.`;
  }

  // ── charts (redrawn at the container's width so text stays readable on a phone) ─────────
  const markerPrices = [];
  for (const mk of D.markers.markers) for (const [key, p] of Object.entries(mk.prices_per_kg)) markerPrices.push({ p, label: `${mk.label} ${key}`, short: M.priceStr(p) });
  const PMIN = 10;
  const PMAX = 3000;
  const SERIES_COLOURS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];
  const chartWidth = (svg) => Math.max(320, Math.min(900, Math.floor(svg.parentElement.getBoundingClientRect().width) || 720));
  const clear = (svg) => { while (svg.lastChild && svg.lastChild.tagName !== 'title') svg.removeChild(svg.lastChild); };

  // Relaxation required per input vs fiber price: computed once, drawn at any width.
  const relaxFields = Object.keys(M.INPUTS).filter((f) => f !== 'fixed_ops_M');
  const relaxGrid = [0];
  for (let i = 0; i <= 48; i++) relaxGrid.push(PMIN * Math.pow(PMAX / PMIN, i / 48));
  const relaxSeries = relaxFields.map((f) => {
    const v0 = M.Model.getInput(cons, f);
    const pts = [];
    let cannotPast = null;
    for (const p of relaxGrid) {
      const thr = model.relaxationThreshold(cons, f, p, 1.0);
      if (thr === null) { cannotPast = p; break; }
      pts.push([p, Math.abs(thr - v0) / v0 * 100]);
    }
    return { field: f, pts, cannotPast };
  });

  function drawRelax() {
    const svg = $('chart-relax');
    clear(svg);
    const W = chartWidth(svg);
    const narrow = W < 560;
    const H = narrow ? 300 : 360;
    const L = 44; const R = 12; const T = 12; const B = 42;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x0 = L + (narrow ? 22 : 34); const x1 = W - R; const y0 = H - B; const y1 = T;
    const YMAX = 90; // percent; launch and hw factor reach "cannot" at 80 %, derate's last point is 77 %
    const xOf = (p) => (p === 0 ? L : x0 + (Math.log10(p) - Math.log10(PMIN)) / (Math.log10(PMAX) - Math.log10(PMIN)) * (x1 - x0));
    const yOf = (pct) => y0 - pct / YMAX * (y0 - y1);
    const g = svgEl('g', { class: 'grid' });
    for (const pct of [0, 20, 40, 60, 80]) {
      g.append(svgEl('line', { x1: L, x2: x1, y1: yOf(pct), y2: yOf(pct) }));
      svg.append(svgEl('text', { x: L - 5, y: yOf(pct) + 4, 'text-anchor': 'end', class: 'lbl' }, `${pct}%`));
    }
    svg.append(g);
    const ticks = narrow ? [30, 300, 3000] : [10, 30, 100, 300, 1000, 3000];
    for (const p of ticks) {
      svg.append(svgEl('line', { x1: xOf(p), x2: xOf(p), y1: y0, y2: y0 + 4, class: 'axis' }));
      svg.append(svgEl('text', { x: xOf(p), y: y0 + 16, 'text-anchor': p === PMAX ? 'end' : 'middle', class: 'lbl' }, `$${M.thousands(p)}`));
    }
    svg.append(svgEl('text', { x: L, y: y0 + 16, 'text-anchor': 'middle', class: 'lbl' }, '$0'));
    svg.append(svgEl('text', { x: (L + x0) / 2, y: y0 + 16, 'text-anchor': 'middle', class: 'lbl soft' }, '//'));
    svg.append(svgEl('text', { x: (x0 + x1) / 2, y: H - 6, 'text-anchor': 'middle', class: 'lbl soft' }, narrow ? 'fiber price, $/kg (log), ×1.00' : 'fiber purchase price, $/kg (log) · multiplier 1.00 · y: relaxation required, alone'));
    const ax = svgEl('g', { class: 'axis' });
    ax.append(svgEl('path', { d: `M${L},${y1}V${y0}H${x1}` }));
    svg.append(ax);
    for (const mk of markerPrices) svg.append(svgEl('line', { x1: xOf(mk.p), x2: xOf(mk.p), y1: y1, y2: y0, class: 'marker' }));
    relaxSeries.forEach((s, i) => {
      const d = s.pts.filter((q) => q[1] <= YMAX).map((q, k) => `${k ? 'L' : 'M'}${xOf(q[0]).toFixed(1)},${yOf(q[1]).toFixed(1)}`).join('');
      svg.append(svgEl('path', { d, class: `series s${i + 1}`, 'data-field': s.field }));
      if (s.cannotPast !== null) {
        const last = s.pts[s.pts.length - 1];
        svg.append(svgEl('text', { x: Math.min(xOf(last[0]) + 4, x1 - 40), y: yOf(last[1]) - 4, class: 'lbl soft' }, 'cannot →'));
      }
    });
    const legend = $('legend-relax');
    legend.innerHTML = '';
    relaxSeries.forEach((s, i) => {
      const li = el('li');
      li.append(el('span', { class: 'sw', style: `--c: var(${SERIES_COLOURS[i]})`, 'aria-hidden': 'true' }));
      li.append(M.INPUTS[s.field][0]);
      if (s.cannotPast !== null) li.append(' ', el('span', { class: 'note' }, `(cannot close past $${M.thousands(s.cannotPast)}/kg)`));
      legend.append(li);
    });
    const t0 = study.sweep[0].conservative_thresholds;
    const t300 = study.sweep.find((st) => st.fiber_price_per_kg === 300);
    $('chart-relax-caption').textContent = `At $0/kg the cheapest fixes are price (+${(Math.abs(t0.customer_price_per_kg / cons.customer_price_per_kg - 1) * 100).toFixed(1)}%) and cadence (+${(Math.abs(t0.catches_per_day / cons.catches_per_day - 1) * 100).toFixed(1)}%), as SENSITIVITY_FINDINGS says; construction launch must fall ${(Math.abs(t0.construction_launch_per_kg / cons.construction_launch_per_kg - 1) * 100).toFixed(0)}% to $${M.thousands(t0.construction_launch_per_kg)}`
      + (t300 ? `, and at $300/kg of fiber it must fall to $${M.thousands(t300.conservative_thresholds.construction_launch_per_kg)}.` : '.');
  }

  function drawSingles() {
    const svg = $('chart-singles');
    clear(svg);
    const W = chartWidth(svg);
    const narrow = W < 560;
    const singles = study.sweep[0].baseline_singles;
    const ROW = 46;
    const T = 8; const B = 40; const L = 12; const R = 12;
    const H = T + singles.length * ROW + B;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x0 = L + 30; const x1 = W - R; const y0 = T + singles.length * ROW;
    const CAP = 20000;
    const xOf = (p) => (p === 0 ? L : x0 + (Math.log10(Math.max(p, PMIN)) - Math.log10(PMIN)) / (Math.log10(CAP) - Math.log10(PMIN)) * (x1 - x0));
    for (const p of [10, 100, 1000, 10000]) {
      svg.append(svgEl('line', { x1: xOf(p), x2: xOf(p), y1: T, y2: y0, class: 'grid' }));
      svg.append(svgEl('text', { x: xOf(p), y: y0 + 16, 'text-anchor': p === 10000 && narrow ? 'end' : 'middle', class: 'lbl' }, `$${M.thousands(p)}`));
    }
    svg.append(svgEl('text', { x: L, y: y0 + 16, 'text-anchor': 'middle', class: 'lbl' }, '$0'));
    svg.append(svgEl('text', { x: (x0 + x1) / 2, y: H - 6, 'text-anchor': 'middle', class: 'lbl soft' }, narrow ? 'fiber price where the single stops closing, $/kg (log)' : 'fiber purchase price at which the single stops closing the case, $/kg (log)'));
    for (const mk of markerPrices) svg.append(svgEl('line', { x1: xOf(mk.p), x2: xOf(mk.p), y1: T, y2: y0, class: 'marker' }));
    singles.forEach((sg, i) => {
      const top = T + i * ROW;
      const y = top + 20; const h = 16;
      const stop = study.single_stop_prices[sg.field];
      const head = `${M.INPUTS[sg.field][0].split(' (')[0]} → ${M.thrStr(sg.field, sg.baseline_value)}`;
      svg.append(svgEl('text', { x: L, y: top + 13, class: 'lbl' }, head));
      if (stop === null || stop === undefined) {
        svg.append(svgEl('text', { x: L + 2, y: y + h - 3, class: 'lbl soft', 'data-bar': sg.field }, `does not close even at $0 (${M.pbStr(sg.payback_year)})`));
        return;
      }
      const end = stop === '> cap' ? CAP : stop;
      const xe = xOf(end);
      svg.append(svgEl('rect', { x: L, y, width: Math.max(2, xe - L), height: h, class: `bar${stop === '> cap' ? ' open' : ''}`, rx: 3, 'data-bar': sg.field }));
      const label = stop === '> cap' ? `still closes at $${M.thousands(CAP)}` : `$${M.thousands(stop)}/kg (${M.pbStr(sg.payback_year)} at $0)`;
      const fits = xe + 6 + label.length * 6.5 < x1;
      svg.append(svgEl('text', { x: fits ? xe + 6 : xe - 6, y: y + h - 3, 'text-anchor': fits ? 'start' : 'end', class: `lbl${fits ? '' : ' onbar'}` }, label));
    });
    const ax = svgEl('g', { class: 'axis' });
    ax.append(svgEl('path', { d: `M${L},${T}V${y0}H${x1}` }));
    svg.append(ax);
    const s = study.single_stop_prices;
    $('chart-singles-caption').textContent = `Program capex → $5,000M survives only to $${M.thousands(s.program_fleet_capex_M)}/kg and launch → $1,500 to $${M.thousands(s.construction_launch_per_kg)}/kg; derate → 15% to $${M.thousands(s.derate_fraction)}/kg; cadence → 2/day to $${M.thousands(s.catches_per_day)}/kg. Fixed ops and the hardware factor do not close the case at any fiber price.`;
  }
  function drawCharts() { drawRelax(); drawSingles(); }
  drawCharts();
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 120); });

  // ── markers list and chips ────────────────────────────────────────────────────────────────
  {
    const ul = $('marker-list');
    for (const mk of D.markers.markers) {
      const li = el('li');
      li.append(el('b', null, mk.label), ': ');
      li.append(Object.entries(mk.prices_per_kg).map(([k, v]) => `${k} ${M.priceStr(v)}/kg`).join(', '));
      li.append(` — ${mk.file}:${mk.line} @ ${mk.commit.slice(0, 7)}. `);
      li.append(el('span', { class: 'small' }, mk.status));
      ul.append(li);
    }
    const chips = $('chips');
    for (const mk of D.markers.markers) {
      for (const [key, v] of Object.entries(mk.prices_per_kg)) {
        const b = el('button', { type: 'button', class: 'chip', 'data-price': v, 'data-label': `${mk.label} (${key}) — not a quote` });
        b.append(`${mk.label.split(' ')[0]} ${key} `, el('b', null, `$${M.thousands(v)}`));
        b.addEventListener('click', () => {
          $('price').value = String(v);
          markerNote = `${mk.label} (${key}): ${mk.status}`;
          update();
        });
        chips.append(b);
      }
    }
  }

  // ── provenance ────────────────────────────────────────────────────────────────────────────
  {
    const ul = $('prov');
    for (const [name, p] of Object.entries(D.provenance)) {
      if (!p) continue;
      const li = el('li');
      li.append(el('b', null, name), ` ← ${p.path} @ ${(p.commit || '').slice(0, 7)} (${p.mode}; sha256 ${(p.sourceSha256 || '').slice(0, 12)}…)`);
      if (p.note) li.append(' — ', el('span', { class: 'small' }, p.note));
      ul.append(li);
    }
  }

  // ── the quote-day card ────────────────────────────────────────────────────────────────────
  let markerNote = null;
  function update() {
    const raw = $('price').value.trim();
    const mraw = $('mult').value.trim();
    const mult = Number(mraw);
    if (raw === '') {
      const r = M.refusal(D.rev_a);
      showRefusal(r.code, `${r.what}. The file's own note: "${r.note}".`, r.what_would_help);
      markerNote = null;
      return;
    }
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) {
      showRefusal('invalid_input', `"${raw}" is not a finite, non-negative $/kg.`, 'a vendor price in $/kg, for example 300.');
      return;
    }
    if (!Number.isFinite(mult) || mult <= 0) {
      showRefusal('invalid_input', `the multiplier "${mraw}" must be a positive number.`, '1.00 reads the quote as the finished-tether price; 1.3 would mean finished rope costs 30% more per kg than the quoted yarn.');
      return;
    }
    $('refusal').innerHTML = '';
    const source = markerNote ? `marker, not a quote — ${markerNote}` : (urlPrice !== null && String(urlPrice) === raw && !touched ? 'the page URL (not a quote)' : 'typed on this page (rev_a.json economics.fiber_cost_per_kg is still null)');
    const card = M.quoteCard(model, ladder, price, mult, source);
    const box = $('card');
    box.innerHTML = '';
    box.append(el('h3', null, `QUOTE-DAY CARD — fiber at ${M.priceStr(price)}/kg × ${mult.toFixed(2)} (finished-tether multiplier, unsourced) = ${M.priceStr(price * mult)}/kg of tether mass`));
    box.append(el('p', { class: `src${markerNote ? ' marker' : ''}`, id: 'card-source' }, `price source: ${source}`));
    for (const r of card.rows) {
      const b = r.before; const a = r.after;
      const line = el('p', { class: 'rowline' });
      line.append(el('b', null, `${M.rowLabel(a)}, ${M.fixed(a.fiber_mass_t, 1)} t fiber${a.partial_tier_model ? ' (partial tier model)' : ''}`));
      line.append(`adds ${M.money(r.added_capex_M)} capex (${M.money(b.total_capex_M)} -> ${M.money(a.total_capex_M)}, +${r.added_capex_pct.toFixed(1)}%) | payback ${M.pbStr(b.payback_year)} -> ${M.pbStr(a.payback_year)} | NPV@10% ${M.money(b.npv_10pct_M)} -> ${M.money(a.npv_10pct_M)} | Y15 breakeven price $${M.thousands(b.breakeven_customer_price_y15)} -> $${M.thousands(a.breakeven_customer_price_y15)}/kg`);
      box.append(line);
    }
    const tb = card.conservative_thresholds_before; const ta = card.conservative_thresholds_after;
    const thr = el('p', { class: 'rowline' });
    thr.append(el('b', null, 'Conservative single-input thresholds move'));
    thr.append(Object.keys(M.INPUTS).filter((f) => f !== 'fixed_ops_M').map((f) => `${M.SHORT[f]} ${M.INPUTS[f][1] === 'up' ? '>=' : '<='} ${M.thrStr(f, tb[f])} -> ${M.thrStr(f, ta[f])}`).join(' | '));
    box.append(thr);
    const sg = el('p', { class: 'rowline' });
    sg.append(el('b', null, 'Baseline-value singles at this price'));
    sg.append(card.baseline_singles_after.map((s) => `${M.SHORT[s.field]} -> ${M.thrStr(s.field, s.baseline_value)} ${s.closes ? 'closes' : 'does not close'} (${M.pbStr(s.payback_year)})`).join('; '));
    box.append(sg);
    const fill = el('p', { class: 'fill' });
    fill.append('To fill: ', el('code', null, `rev_a.json ${card.rev_a_key_to_fill} = ${price}`), ` and ${card.rev_a_note_key} with vendor, date, currency, yarn-or-finished-rope, MOQ; then finance/skyhook_finance.py needs this purchase line (it has none) and the workbook's Assumptions sheet a row for it.`);
    box.append(fill);
    box.append(el('p', { class: 'small' }, '* beyond the 15-year window, extrapolated; option-tier rows are the partial tier model: only tip speed is tier-specific.'));
    box.hidden = false;
  }

  let touched = false;
  let urlPrice = null;
  const q = new URLSearchParams(location.search);
  if (q.has('p') && q.get('p') !== '') { urlPrice = q.get('p'); $('price').value = urlPrice; }
  if (q.has('m') && q.get('m') !== '') $('mult').value = q.get('m');
  $('price').addEventListener('input', () => { touched = true; markerNote = null; update(); });
  $('mult').addEventListener('input', () => { touched = true; update(); });
  $('clear').addEventListener('click', () => { $('price').value = ''; $('mult').value = '1.00'; markerNote = null; touched = true; update(); $('price').focus(); });
  update();
})();
