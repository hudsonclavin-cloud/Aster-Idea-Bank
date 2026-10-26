// Edge of the Grid — page logic. Reads window.EDGE_CENSUS (snapshots/edge-census.data.js) and the
// pure module window.GridCensus; draws inline SVG; every figure on the page comes from the census
// or is derived from the lattice. No year, date or count is typed here (a test greps for it).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const G = window.GridCensus;
  const DATA = window.EDGE_CENSUS;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') throw new Error('no innerHTML');
        else n.setAttribute(k, v);
      }
    }
    for (const k of kids) if (k !== null && k !== undefined) n.append(k);
    return n;
  }
  function sv(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const tag = (kind, text) => el('span', { class: `tag ${kind}`, text });

  // ---------------------------------------------------------------- refuse when the data is absent
  if (!G || !DATA || !DATA.census || !DATA.metadata) {
    const box = $('noData');
    box.hidden = false;
    $('noDataCode').textContent = 'insufficient_data';
    $('noDataReason').textContent = 'The census data (snapshots/edge-census.data.js) or the census module (grid-census.js) did not load, so there is nothing to show and nothing is invented.';
    $('noDataHelp').textContent = 'From the bank root: node ideas/10-edge-of-the-grid/edge-census.mjs --json ideas/10-edge-of-the-grid/snapshots/edge-census.json, then node ideas/10-edge-of-the-grid/build-data.mjs, with the Aster checkout present.';
    $('lede').textContent = 'No census loaded.';
    return;
  }
  const C = DATA.census;
  const L = C.lattice;
  const M = DATA.metadata;
  const E = C.edges.byEdge;
  const f = G.fmtInt;
  const pct = (x, d) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(d === undefined ? 1 : d)}%`);
  const fix = (x, d) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(d));
  const colDate = (c) => G.colDate(L, c);
  const rowTof = (r) => G.rowTof(L, r);
  const firstYear = L.years[0];
  const lastYear = L.years[L.years.length - 1];
  const isNarrow = () => window.innerWidth < 560;
  const nice = (x) => {
    const cands = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    let best = 1;
    for (const c of cands) if (c <= x) best = c;
    return best;
  };
  const niceCeil = (x) => {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p;
    return 10 * p;
  };

  // ---------------------------------------------------------------- lede, grid sentence, tiles
  $('lede').textContent =
    `Of the ${f(C.bodies.withWindows)} bodies with stored windows (${f(C.bodies.total)} screened, ${C.bodies.withoutWindows.length} without), ` +
    `${f(C.edges.any)} (${pct(C.edges.anyShare)}) have their cheapest window on an edge of the grid: ` +
    `${f(E.tofMin.touched)} at the ${L.tofMinDays}-day flight-time floor, ${f(E.first.touched)} on the first departure date (${L.firstDepartureUtc}), ` +
    `${f(E.last.touched)} on the last (${L.lastDepartureUtc}) and ${f(E.tofMax.touched)} at the ${f(L.lastTofDays)}-day ceiling. ` +
    (G.isRefusal(C.viewTail)
      ? ''
      : `A further fact about the same cache: ${f(C.viewTail.minimaAfter)} bodies (${pct(C.viewTail.shareOfBodies)}) have a cached minimum departing after ${C.viewTail.depEndUtc}, the porkchop view's last departure, so the view cannot show it.`);
  $('gridSentence').textContent = `The grid, derived from the cache's metadata and nothing else: ${C.gridSentence}`;

  function tile(label, value, note, hero) {
    return el('div', { class: `tile${hero ? ' hero' : ''}` }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note }));
  }
  const tiles = $('tiles');
  tiles.append(
    tile('Cheapest window on any edge', f(C.edges.any), `${pct(C.edges.anyShare)} of ${f(C.bodies.withWindows)} bodies; ${C.edges.multiple} touch two edges`, true),
    tile('At the flight-time floor', f(E.tofMin.touched), `${L.tofMinDays}-day flights, the shortest solved; ${pct(E.tofMin.shareOfBodies)}`),
    tile('On the first departure date', f(E.first.touched), `${L.firstDepartureUtc}; ${f(E.first.likelyClipped)} likely clipped`),
    tile('On the last departure date', f(E.last.touched), `${L.lastDepartureUtc}; ${f(E.last.likelyClipped)} likely clipped`),
    tile('At the flight-time ceiling', f(E.tofMax.touched), `${f(L.lastTofDays)}-day flights, the longest solved`),
    G.isRefusal(C.viewTail)
      ? tile('After the porkchop view\'s end', 'refused', C.viewTail.refusal.reason)
      : tile('After the porkchop view\'s end', f(C.viewTail.minimaAfter), `cached minima departing after ${C.viewTail.depEndUtc}; ${pct(C.viewTail.shareOfBodies)}`),
  );

  // ---------------------------------------------------------------- tooltip helper
  function showTip(tipEl, chartEl, x, y, lines) {
    tipEl.hidden = false;
    tipEl.replaceChildren();
    lines.forEach((t, i) => {
      const d = el('div');
      if (i === 0) d.append(el('strong', { text: t }));
      else d.textContent = t;
      tipEl.append(d);
    });
    const card = tipEl.parentElement;
    const cardRect = card.getBoundingClientRect();
    const chartRect = chartEl.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    let left = chartRect.left - cardRect.left + x + 12;
    if (left + w > cardRect.width - 8) left = Math.max(8, chartRect.left - cardRect.left + x - w - 12);
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${chartRect.top - cardRect.top + y - 10}px`;
  }
  const hideTip = (tipEl) => { tipEl.hidden = true; };

  // ---------------------------------------------------------------- heatmap: year × flight time
  const heatState = { mode: 'minima', cursor: null };
  const seqClass = (v, thresholds) => {
    if (v <= 0) return 'hc0';
    let k = 0;
    for (let i = 0; i < thresholds.length; i++) if (v >= thresholds[i]) k = i + 1;
    return `hc${k}`;
  };
  function heatThresholds(max) {
    const t = [1, nice(max / 50), nice(max / 10), nice(max / 4), nice(max / 2)]; // five classes: the validated ramp has five steps
    const out = [];
    for (const x of t) if (!out.length || x > out[out.length - 1]) out.push(x);
    return out;
  }
  function drawHeat() {
    const host = $('heat');
    const grid = heatState.mode === 'minima' ? C.heat.minima : C.heat.allWindows;
    const yearTotals = C.years.map((y) => (heatState.mode === 'minima' ? y.minima : y.allWindows));
    const rowTotals = heatState.mode === 'minima' ? C.perRow.minima : C.perRow.allWindows;
    const unit = heatState.mode === 'minima' ? 'cheapest windows' : 'stored windows';
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    const th = heatThresholds(max);
    const W = Math.max(300, host.clientWidth || 600);
    const narrow = W < 560;
    const left = 46, right = narrow ? 86 : 104, top = 72, bottom = 22;
    const nY = L.years.length, nR = L.nRows;
    const cellW = (W - left - right) / nY;
    const cellH = narrow ? 8 : 9;
    const H = top + nR * cellH + bottom;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    const xOf = (yi) => left + yi * cellW;
    const yOf = (r) => top + (nR - 1 - r) * cellH; // flight time increases upward
    // cells
    const cells = sv('g');
    for (let r = 0; r < nR; r++) {
      for (let yi = 0; yi < nY; yi++) {
        const v = grid[r][yi];
        cells.append(sv('rect', { x: xOf(yi) + 1, y: yOf(r) + 0.5, width: Math.max(1, cellW - 2), height: cellH - 1, class: `cell ${seqClass(v, th)}`, rx: 1 }));
      }
    }
    svg.append(cells);
    // edge rows: a 2px orange tick at the left of the floor and ceiling rows, labelled
    for (const [r, label] of [[0, 'floor'], [nR - 1, 'ceiling']]) {
      svg.append(sv('rect', { x: left - 4, y: yOf(r), width: 3, height: cellH, class: 'edge-mark' }));
    }
    // row labels every fifth row and the last
    for (let r = 0; r < nR; r++) {
      if (r % 5 === 0 || r === nR - 1) {
        svg.append(sv('text', { x: left - 8, y: yOf(r) + cellH / 2 + 3.5, 'text-anchor': 'end', 'font-size': 10 }, f(rowTof(r))));
      }
    }
    svg.append(sv('text', { x: 4, y: top - 4, 'font-size': 10, class: 'muted-text' }, 'flight time, days'));
    // year labels (every year when they fit, otherwise every other) with an orange underline for the edge years
    for (let yi = 0; yi < nY; yi++) {
      const show = cellW >= 30 || yi % 2 === 0;
      if (show) svg.append(sv('text', { x: xOf(yi) + cellW / 2, y: H - 7, 'text-anchor': 'middle', 'font-size': 10 }, String(L.years[yi].year)));
      if (yi === 0 || yi === nY - 1) svg.append(sv('rect', { x: xOf(yi) + 1, y: top + nR * cellH + 1, width: Math.max(1, cellW - 2), height: 2, class: 'edge-mark' }));
    }
    // top marginal: totals per year (thin columns, 4px rounded data end, square at the baseline)
    const mTop = 40;
    const yMax = Math.max(...yearTotals);
    const barW = Math.min(cellW - 2, 24);
    const base = top - 12;
    yearTotals.forEach((v, yi) => {
      const h = yMax ? (v / yMax) * mTop : 0;
      const x = xOf(yi) + (cellW - barW) / 2;
      const p = `M${x},${base} V${base - h + 4} Q${x},${base - h} ${x + 4},${base - h} H${x + barW - 4} Q${x + barW},${base - h} ${x + barW},${base - h + 4} V${base} Z`;
      svg.append(sv('path', { d: h > 4 ? p : `M${x},${base} h${barW} v${-h} h${-barW} Z`, class: 's1-fill' }));
    });
    const iMax = yearTotals.indexOf(yMax);
    for (const yi of new Set([0, iMax, nY - 1])) {
      svg.append(sv('text', { x: xOf(yi) + cellW / 2, y: base - (yearTotals[yi] / yMax) * mTop - 3, 'text-anchor': 'middle', 'font-size': 10 }, f(yearTotals[yi])));
    }
    svg.append(sv('line', { x1: left, x2: left + nY * cellW, y1: base + 0.5, y2: base + 0.5, class: 'axis' }));
    // right marginal: totals per row (thin bars)
    const rMax = Math.max(...rowTotals);
    const mRight = narrow ? 36 : 50;
    const rx0 = left + nY * cellW + 8;
    rowTotals.forEach((v, r) => {
      const w = rMax ? (v / rMax) * mRight : 0;
      const y = yOf(r) + 1;
      const h = cellH - 2;
      const p = `M${rx0},${y} H${rx0 + w - 2} Q${rx0 + w},${y} ${rx0 + w},${y + 2} V${y + h - 2} Q${rx0 + w},${y + h} ${rx0 + w - 2},${y + h} H${rx0} Z`;
      svg.append(sv('path', { d: w > 3 ? p : `M${rx0},${y} h${w} v${h} h${-w} Z`, class: 's1-fill' }));
    });
    const rIdxMax = rowTotals.indexOf(rMax);
    for (const r of new Set([0, rIdxMax, nR - 1])) {
      svg.append(sv('text', { x: rx0 + (rowTotals[r] / rMax) * mRight + 3, y: yOf(r) + cellH / 2 + 3.5, 'font-size': 10 }, f(rowTotals[r])));
    }
    svg.append(sv('line', { x1: rx0 - 0.5, x2: rx0 - 0.5, y1: top, y2: top + nR * cellH, class: 'axis' }));
    // cursor
    const cursor = sv('rect', { class: 'cursor', width: Math.max(1, cellW), height: cellH, rx: 1 });
    cursor.setAttribute('visibility', 'hidden');
    svg.append(cursor);
    const overlay = sv('rect', { x: left, y: top, width: nY * cellW, height: nR * cellH, fill: 'transparent' });
    svg.append(overlay);
    host.replaceChildren(svg);
    host.setAttribute('aria-label', `Heatmap of ${unit} by departure year and flight time; the largest cell holds ${f(max)}. Arrow keys move a cursor; the table view below lists every cell.`);

    const tip = $('heatTip');
    function place(yi, r, fromKeyboard) {
      heatState.cursor = { yi, r };
      cursor.setAttribute('x', xOf(yi));
      cursor.setAttribute('y', yOf(r));
      cursor.setAttribute('visibility', 'visible');
      const v = grid[r][yi];
      const y = L.years[yi];
      showTip(tip, host, xOf(yi) + cellW, yOf(r), [
        `${f(v)} ${unit}`,
        `${y.year} · ${f(rowTof(r))}-day flights`,
        `${y.cols} departure dates in ${y.year}; ${f(yearTotals[yi])} in the year, ${f(rowTotals[r])} at this flight time`,
      ]);
      if (fromKeyboard) tip.style.top = `${parseFloat(tip.style.top) + 14}px`;
    }
    const cellAt = (ev) => {
      const rect = svg.getBoundingClientRect();
      const sx = W / rect.width;
      const x = (ev.clientX - rect.left) * sx, yy = (ev.clientY - rect.top) * sx;
      const yi = Math.floor((x - left) / cellW);
      const r = nR - 1 - Math.floor((yy - top) / cellH);
      return yi >= 0 && yi < nY && r >= 0 && r < nR ? { yi, r } : null;
    };
    overlay.addEventListener('pointermove', (ev) => {
      const c = cellAt(ev);
      if (c) place(c.yi, c.r);
    });
    overlay.addEventListener('pointerdown', (ev) => {
      const c = cellAt(ev);
      if (c) place(c.yi, c.r);
    });
    overlay.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideTip(tip); });
    host.onkeydown = (ev) => {
      const cur = heatState.cursor || { yi: iMax, r: rIdxMax };
      let { yi, r } = cur;
      if (ev.key === 'ArrowLeft') yi = Math.max(0, yi - 1);
      else if (ev.key === 'ArrowRight') yi = Math.min(nY - 1, yi + 1);
      else if (ev.key === 'ArrowUp') r = Math.min(nR - 1, r + 1);
      else if (ev.key === 'ArrowDown') r = Math.max(0, r - 1);
      else if (ev.key === 'Home') r = 0;
      else if (ev.key === 'End') r = nR - 1;
      else if (ev.key === 'Escape') { hideTip(tip); cursor.setAttribute('visibility', 'hidden'); return; }
      else return;
      ev.preventDefault();
      place(yi, r, true);
    };
    host.onfocus = () => { if (!heatState.cursor) place(iMax, rIdxMax, true); else place(heatState.cursor.yi, heatState.cursor.r, true); };
    host.onblur = () => hideTip(tip);
    // legend
    const legend = $('heatLegend');
    legend.replaceChildren();
    const bins = [['0', 'hc0']];
    for (let i = 0; i < th.length; i++) {
      const lo = th[i], hi = i + 1 < th.length ? th[i + 1] - 1 : null;
      bins.push([hi === null ? `${f(lo)} or more` : lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`, `hc${i + 1}`]);
    }
    for (const [label, cls] of bins) legend.append(el('span', null, el('span', { class: `sw ${cls}` }), label));
    legend.append(el('span', null, el('span', { class: 'sw edge-sw' }), 'edge of the lattice'));
    legend.append(el('span', { class: 'muted', text: `${unit} per cell; marginal bars are the year and flight-time totals` }));
    // table view
    const table = $('heatTable');
    table.replaceChildren();
    const thead = el('thead');
    const hr = el('tr', null, el('th', { text: 'flight time (days)' }));
    for (const y of L.years) hr.append(el('th', { class: 'num', text: String(y.year) }));
    hr.append(el('th', { class: 'num', text: 'all years' }));
    thead.append(hr);
    table.append(thead);
    const tbody = el('tbody');
    for (let r = nR - 1; r >= 0; r--) {
      const tr = el('tr', { class: r === 0 || r === nR - 1 ? 'edge-row' : null }, el('td', { class: 'num', text: f(rowTof(r)) }));
      for (let yi = 0; yi < nY; yi++) tr.append(el('td', { class: 'num', text: f(grid[r][yi]) }));
      tr.append(el('td', { class: 'num', text: f(rowTotals[r]) }));
      tbody.append(tr);
    }
    const totals = el('tr', null, el('td', { text: 'all flight times' }));
    for (let yi = 0; yi < nY; yi++) totals.append(el('td', { class: 'num', text: f(yearTotals[yi]) }));
    totals.append(el('td', { class: 'num', text: f(yearTotals.reduce((s, x) => s + x, 0)) }));
    tbody.append(totals);
    table.append(tbody);
  }
  $('heatHint').textContent =
    `Each cell is a departure year by one flight-time row of the lattice (${L.tofSpacingDays}-day steps). The two edge years hold ${firstYear.cols} and ${lastYear.cols} departure dates; the others ${Math.min(...L.years.slice(1, -1).map((y) => y.cols))}–${Math.max(...L.years.slice(1, -1).map((y) => y.cols))}. ` +
    `Orange ticks mark the floor and ceiling rows and the two edge years. This is where single-revolution screening minima land on the sampled lattice; it is not a chart of the best launch years.`;
  for (const r of document.querySelectorAll('input[name="heatMode"]')) {
    r.addEventListener('change', () => {
      heatState.mode = r.value;
      heatState.cursor = null;
      drawHeat();
    });
  }

  // ---------------------------------------------------------------- per-column chart
  const colsState = { cursor: null };
  function drawCols() {
    const host = $('cols');
    const PC = C.perColumn.minima;
    const W = Math.max(300, host.clientWidth || 600);
    const narrow = W < 560;
    const H = narrow ? 210 : 250;
    const left = 40, right = 14, top = 20, bottom = 28;
    const n = PC.length;
    const max = Math.max(...PC);
    const yMax = niceCeil(max);
    const xOf = (c) => left + (c / (n - 1)) * (W - left - right);
    const yOf = (v) => top + (1 - v / yMax) * (H - top - bottom);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    // gridlines (solid hairlines) and y ticks
    const step = nice(yMax / 4);
    for (let v = 0; v <= yMax; v += step) {
      svg.append(sv('line', { x1: left, x2: W - right, y1: yOf(v), y2: yOf(v), class: v === 0 ? 'axis' : 'grid' }));
      svg.append(sv('text', { x: left - 6, y: yOf(v) + 3.5, 'text-anchor': 'end', 'font-size': 10 }, f(v)));
    }
    // year ticks and labels
    L.years.forEach((y, i) => {
      svg.append(sv('line', { x1: xOf(y.firstCol), x2: xOf(y.firstCol), y1: yOf(0), y2: yOf(0) + 4, class: 'axis' }));
      if (!narrow || i % 2 === 0) svg.append(sv('text', { x: xOf(y.firstCol + y.cols / 2), y: H - 8, 'text-anchor': 'middle', 'font-size': 10 }, String(y.year)));
    });
    // area wash and line
    let dLine = '', dArea = `M${xOf(0)},${yOf(0)}`;
    PC.forEach((v, c) => {
      dLine += `${c ? 'L' : 'M'}${xOf(c).toFixed(2)},${yOf(v).toFixed(2)}`;
      dArea += `L${xOf(c).toFixed(2)},${yOf(v).toFixed(2)}`;
    });
    dArea += `L${xOf(n - 1)},${yOf(0)}Z`;
    svg.append(sv('path', { d: dArea, class: 's1-area' }));
    // interior median reference line, labelled
    const med = C.interior.medianPerCol;
    svg.append(sv('line', { x1: left, x2: W - right, y1: yOf(med), y2: yOf(med), class: 'ref' }));
    svg.append(sv('text', { x: W - right - 4, y: yOf(med) - 5, 'text-anchor': 'end', 'font-size': 10, class: 'halo' }, `interior median ${f(med)} per date`));
    svg.append(sv('path', { d: dLine, class: 's1-line' }));
    // edge markers with direct labels
    for (const [c, anchor, dx] of [[0, 'start', 8], [n - 1, 'end', -8]]) {
      svg.append(sv('circle', { cx: xOf(c), cy: yOf(PC[c]), r: 5.5, class: 'edge-dot' }));
      svg.append(sv('text', { x: xOf(c) + dx, y: yOf(PC[c]) + 3.5, 'text-anchor': anchor, 'font-size': 11, 'font-weight': 600, class: 'halo' }, `${f(PC[c])} on ${colDate(c)}`));
    }
    // crosshair
    const cross = sv('line', { class: 'cross', y1: top, y2: yOf(0) });
    cross.setAttribute('visibility', 'hidden');
    const dot = sv('circle', { r: 4.5, class: 's1-dot' });
    dot.setAttribute('visibility', 'hidden');
    svg.append(cross, dot);
    const overlay = sv('rect', { x: left, y: top, width: W - left - right, height: H - top - bottom, fill: 'transparent' });
    svg.append(overlay);
    host.replaceChildren(svg);
    host.setAttribute('aria-label', `Line chart of cheapest windows per departure date over ${f(n)} dates; first date ${f(PC[0])}, last date ${f(PC[n - 1])}, interior median ${f(med)}. Arrow keys move the crosshair.`);
    const tip = $('colsTip');
    function place(c, kbd) {
      colsState.cursor = c;
      cross.setAttribute('x1', xOf(c));
      cross.setAttribute('x2', xOf(c));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', xOf(c));
      dot.setAttribute('cy', yOf(PC[c]));
      dot.setAttribute('visibility', 'visible');
      const lines = [`${f(PC[c])} cheapest windows`, `${colDate(c)} · departure date ${c + 1} of ${n}`, `${f(C.perColumn.allWindows[c])} stored windows of any rank; interior median ${f(med)}`];
      if (c === 0) lines.push(`first departure date of the grid`);
      if (c === n - 1) lines.push(`last departure date of the grid`);
      showTip(tip, host, xOf(c), yOf(PC[c]) + (kbd ? 10 : 0), lines);
    }
    overlay.addEventListener('pointermove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) * W) / rect.width;
      const c = Math.round(((x - left) / (W - left - right)) * (n - 1));
      place(Math.max(0, Math.min(n - 1, c)));
    });
    overlay.addEventListener('pointerdown', (ev) => overlay.dispatchEvent(new PointerEvent('pointermove', ev)));
    overlay.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideTip(tip); });
    host.onkeydown = (ev) => {
      let c = colsState.cursor === null ? 0 : colsState.cursor;
      const big = ev.shiftKey ? 10 : 1;
      if (ev.key === 'ArrowLeft') c -= big;
      else if (ev.key === 'ArrowRight') c += big;
      else if (ev.key === 'Home') c = 0;
      else if (ev.key === 'End') c = n - 1;
      else if (ev.key === 'Escape') { hideTip(tip); return; }
      else return;
      ev.preventDefault();
      place(Math.max(0, Math.min(n - 1, c)), true);
    };
    host.onfocus = () => place(colsState.cursor === null ? 0 : colsState.cursor, true);
    host.onblur = () => hideTip(tip);
    const legend = $('colsLegend');
    legend.replaceChildren(
      el('span', null, el('span', { class: 'ln' }), 'cheapest windows per departure date'),
      el('span', null, el('span', { class: 'mk' }), 'the two edge dates'),
      el('span', { class: 'muted', text: `${f(C.interior.firstColRatio.toFixed(1))}× and ${C.interior.lastColRatio.toFixed(1)}× the interior median at the edges` }),
    );
    // table view: first and last ten
    const table = $('colsTable');
    table.replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'departure date' }), el('th', { class: 'num', text: 'column' }), el('th', { class: 'num', text: 'cheapest windows' }), el('th', { class: 'num', text: 'stored windows' }), el('th', { class: 'num', text: '× interior median' }))));
    const tb = el('tbody');
    const idx = [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => n - 10 + i)];
    idx.forEach((c, i) => {
      if (i === 10) tb.append(el('tr', null, el('td', { text: '…', colspan: 5 })));
      tb.append(el('tr', { class: c === 0 || c === n - 1 ? 'edge-row' : null }, el('td', { class: 'key', text: colDate(c) }), el('td', { class: 'num', text: String(c) }), el('td', { class: 'num', text: f(PC[c]) }), el('td', { class: 'num', text: f(C.perColumn.allWindows[c]) }), el('td', { class: 'num', text: (PC[c] / med).toFixed(2) })));
    });
    table.append(tb);
  }
  $('colsHint').textContent =
    `One point per departure date of the lattice (${L.departureSpacingDays}-day spacing): how many bodies have their cheapest stored window there. ` +
    `The interior median is taken over the dates outside ${firstYear.year} and ${lastYear.year}; the first date carries ${C.interior.firstColRatio.toFixed(1)}× it and the last ${C.interior.lastColRatio.toFixed(1)}×. ` +
    `The opening pile-up is wider than one date: ${firstYear.year} carries ${C.interior.firstYearRatio.toFixed(2)}× a median interior year per date, ${lastYear.year} ${C.interior.lastYearRatio.toFixed(2)}×.`;

  // ---------------------------------------------------------------- edge table
  function edgeTable() {
    const t = $('edgeTable');
    t.replaceChildren();
    const slope = (e) => (e.slopeC3PerCell ? `${e.slopeC3PerCell.median.toFixed(3)} km²/s² (n ${e.slopeC3PerCell.n})` : 'none recorded');
    const likelyAll = G.EDGE_KEYS.reduce((n, k) => n + E[k].likelyClipped, 0);
    const undetAll = G.EDGE_KEYS.reduce((n, k) => n + E[k].undetermined, 0);
    if (isNarrow()) {
      // one block per edge: label / value rows, nothing hidden, nothing scrolling sideways
      for (const k of G.EDGE_KEYS) {
        const e = E[k];
        const tb = el('tbody', { class: 'kv' });
        tb.append(el('tr', null, el('th', { colspan: 2 }, `${G.EDGE_NAMES[k]} `, el('span', { class: 'muted', text: `(${e.cell})` }))));
        tb.append(el('tr', null, el('td', { text: 'cheapest windows there' }), el('td', { class: 'num', text: `${f(e.touched)} (${pct(e.shareOfBodies)})` })));
        tb.append(el('tr', null, el('td', null, 'likely clipped ', tag('likely', 'Likely')), el('td', { class: 'num', text: f(e.likelyClipped) })));
        tb.append(el('tr', null, el('td', null, 'undetermined ', tag('spec', 'Speculative')), el('td', { class: 'num', text: f(e.undetermined) })));
        tb.append(el('tr', null, el('td', { text: 'chains ≥ 3 (monotone)' }), el('td', { class: 'num', text: `${e.chains3plus} (${e.monotone3plus})` })));
        tb.append(el('tr', null, el('td', { text: 'median inward slope' }), el('td', { class: 'num', text: slope(e) })));
        t.append(tb);
      }
      const tb = el('tbody', { class: 'kv edge-row' });
      tb.append(el('tr', null, el('th', { colspan: 2, text: `any edge (${C.edges.multiple} bodies touch two)` })));
      tb.append(el('tr', null, el('td', { text: 'cheapest windows there' }), el('td', { class: 'num', text: `${f(C.edges.any)} (${pct(C.edges.anyShare)})` })));
      tb.append(el('tr', null, el('td', { text: 'likely clipped / undetermined' }), el('td', { class: 'num', text: `${f(likelyAll)} / ${f(undetAll)}` })));
      t.append(tb);
    } else {
      t.append(el('thead', null, el('tr', null,
        el('th', { text: 'edge' }), el('th', { text: 'cell' }), el('th', { class: 'num', text: 'cheapest windows there' }), el('th', { class: 'num', text: 'share' }),
        el('th', { class: 'num', text: 'likely clipped' }), el('th', { class: 'num', text: 'undetermined' }),
        el('th', { class: 'num', text: 'chains ≥ 3 (monotone)' }), el('th', { class: 'num', text: 'median inward slope' }))));
      const tb = el('tbody');
      for (const k of G.EDGE_KEYS) {
        const e = E[k];
        tb.append(el('tr', null,
          el('td', { class: 'key', text: G.EDGE_NAMES[k] }), el('td', { class: 'key', text: e.cell }), el('td', { class: 'num', text: f(e.touched) }), el('td', { class: 'num', text: pct(e.shareOfBodies) }),
          el('td', { class: 'num', text: f(e.likelyClipped) }), el('td', { class: 'num', text: f(e.undetermined) }),
          el('td', { class: 'num', text: `${e.chains3plus} (${e.monotone3plus})` }),
          el('td', { class: 'num', text: slope(e) })));
      }
      tb.append(el('tr', { class: 'edge-row' }, el('td', { class: 'key', text: 'any edge' }), el('td', { class: 'key', text: `${C.edges.multiple} bodies touch two` }), el('td', { class: 'num', text: f(C.edges.any) }), el('td', { class: 'num', text: pct(C.edges.anyShare) }),
        el('td', { class: 'num', text: f(likelyAll) }), el('td', { class: 'num', text: f(undetAll) }), el('td', { text: '' }), el('td', { text: '' })));
      t.append(tb);
    }
    $('edgesHint').textContent = `A body is on an edge when its cheapest stored window is in the first or last departure column or the lowest or highest flight-time row of the ${f(L.nCols)} × ${L.nRows} lattice. The flight-time floor binds: it holds ${(E.tofMin.touched / Math.max(1, E.first.touched + E.last.touched + E.tofMax.touched)).toFixed(1)}× as many minima as the other three edges together.`;
    const v = $('verdictHint');
    v.replaceChildren(
      tag('likely', 'Likely'), ` clipped: the next cell inward along the same row or column is among the body's five stored windows and costs more (every stored chain of three or more rises inward: ${G.EDGE_KEYS.map((k) => `${E[k].monotone3plus} of ${E[k].chains3plus}`).join(', ')}), so the sampled surface is still falling as it leaves the grid and its minimum is at or beyond the edge. The slope quoted is that one step, not an extrapolation. `,
      tag('spec', 'Speculative'), ` undetermined: the other four windows lie in other basins and the cache records no slope at that edge; the true minimum may or may not be off-grid. At the floor this is almost every body (${f(E.tofMin.undetermined)} of ${f(E.tofMin.touched)}): the ${L.tofMinDays + L.tofSpacingDays}-day neighbour is among the five for ${E.tofMin.neighbourPresent}.`,
    );
    const A = C.interiorAlternative;
    $('altHint').textContent = `Interior alternative: ${f(A.withAlternative)} of the ${f(A.ofEdgeBodies)} edge bodies also store a window in a different basin that is on no edge, costing a median ${A.gapC3.median.toFixed(3)} km²/s² more than the edge minimum (${A.gapC3.min.toFixed(4)} to ${A.gapC3.max.toFixed(2)}); ${f(A.without)} store none, so for them the grid offers no interior fallback among the five.`;
  }

  // ---------------------------------------------------------------- the porkchop view's tail
  function tail() {
    const host = $('tailTiles');
    if (G.isRefusal(C.viewTail)) {
      host.append(tile('Refused', C.viewTail.refusal.code, C.viewTail.refusal.reason));
      $('tailHint').textContent = `What would help: ${C.viewTail.refusal.what_would_help}`;
      return;
    }
    const T = C.viewTail;
    host.append(
      tile('Cached minima departing after the view\'s end', f(T.minimaAfter), `${pct(T.shareOfBodies)} of bodies; ${T.minimaOn} exactly on it`, true),
      tile('Bodies with any of their five windows there', f(T.anyWindowAfter), `${pct(T.anyWindowAfter / C.bodies.withWindows)} of bodies`),
      tile('The view\'s last departure', T.depEndUtc, `GRID_PARAMS.depEndJD, ${T.source.source} line ${T.source.lines.depEndJD}`),
      tile('The cache\'s last departure', L.lastDepartureUtc, `screeningWindow.endUtc ${L.endUtc} on a ${L.departureSpacingDays}-day lattice`),
    );
    $('tailHint').textContent =
      `The porkchop page solves its own ${T.source.nDep} × ${T.source.nTof} grid from ${T.source.depStartUtc} to ${T.source.depEndUtc}, while the catalog's status colours and min C3 come from this cache, whose lattice runs to ${L.lastDepartureUtc}. ` +
      `Slice 17's F2 finding named the mismatch and measured its incidence as 0 in a five-body sample; over the whole cache, ${f(T.minimaAfter)} bodies have their catalog minimum in the tail the view never shows, and ${f(T.anyWindowAfter)} have at least one stored window there. ` +
      `The page's span label is now derived from GRID_PARAMS (line ${T.source.spanLabelDerivedAtLine} of the same file), so the two surfaces disagree honestly rather than by a literal.`;
  }

  // ---------------------------------------------------------------- who sits on the edge
  const WHO = [
    ['byClass', 'orbit class (catalog orbitClass)'],
    ['byH', 'absolute magnitude H (catalog)'],
    ['bySynodic', 'synodic period with Earth (from catalog a)'],
    ['byPha', 'PHA flag (catalog)'],
    ['byCoOrbital', 'co-orbital flag (cache)'],
  ];
  function who() {
    const sel = $('tablePick');
    for (const [k, label] of WHO) sel.append(el('option', { value: k, text: label }));
    const draw = () => {
      const key = sel.value;
      const rows = C.tables[key];
      const t = $('whoTable');
      t.replaceChildren();
      if (G.isRefusal(rows)) {
        t.append(el('tbody', null, el('tr', null, el('td', { text: `refused (${rows.refusal.code}): ${rows.refusal.reason}. What would help: ${rows.refusal.what_would_help}` }))));
        $('whoHint').textContent = '';
        return;
      }
      t.append(el('thead', null, el('tr', null, el('th', { text: 'group' }), el('th', { class: 'num', text: 'bodies' }), el('th', { class: 'num', text: 'on an edge' }), el('th', { text: 'rate' }), el('th', { class: 'num', text: 'floor' }), el('th', { class: 'num', text: 'first' }), el('th', { class: 'num', text: 'last' }), el('th', { class: 'num', text: 'ceiling' }))));
      const maxRate = Math.max(...rows.map((r) => r.share || 0));
      const narrow = isNarrow();
      if (narrow) t.replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'group' }), el('th', { class: 'num', text: 'bodies' }), el('th', { class: 'num', text: 'on an edge' }), el('th', { text: 'rate' }))));
      const tb = el('tbody');
      for (const r of rows) {
        const meter = el('span', { class: 'meter', 'aria-hidden': 'true' }, el('span', { style: `width:${maxRate ? (100 * (r.share || 0)) / maxRate : 0}%` }));
        const tr = el('tr', null, el('td', { class: 'key', text: r.key }), el('td', { class: 'num', text: f(r.n) }), el('td', { class: 'num', text: f(r.any) }), el('td', null, meter, pct(r.share)));
        if (narrow) {
          tb.append(tr);
          tb.append(el('tr', { class: 'sub' }, el('td', { colspan: 4, class: 'small muted', text: `floor ${f(r.tofMin)} · first ${f(r.first)} · last ${f(r.last)} · ceiling ${f(r.tofMax)}` })));
        } else {
          tr.append(el('td', { class: 'num', text: f(r.tofMin) }), el('td', { class: 'num', text: f(r.first) }), el('td', { class: 'num', text: f(r.last) }), el('td', { class: 'num', text: f(r.tofMax) }));
          tb.append(tr);
        }
      }
      t.append(tb);
      const notes = {
        byClass: `Classes as the catalog records them; the classDistribution it publishes is reproduced row by row once the ${C.bodies.withoutWindows.length} body without windows is added back (tested). The small classes say something: the Halley-type comets sit at the flight-time ceiling and the interior-Earth objects at the floor.`,
        byH: `Fainter bodies are rarely on the floor: the floor share falls monotonically with H across the five bands. ${C.inputs.catalog ? f(C.inputs.catalog.missingAbsoluteMagnitudeCount) : '?'} bodies carry no H in the catalog and keep their own row. The cause is not measured here; a reading is in the README, labelled.`,
        bySynodic: `Synodic period from the catalog's semi-major axis by Kepler's third law in AU and years, with the AU taken from ${C.inputs.auKm ? `${C.inputs.auKm.source} line ${C.inputs.auKm.line}` : 'nowhere (refused)'}. The edge rate is nearly flat across bands, so the pile-up is not explained by slowly drifting near-co-orbital bodies alone.`,
        byPha: `Potentially hazardous asteroids are rarely on an edge: their close approaches put cheap interior windows on the lattice.`,
        byCoOrbital: `The cache's own co-orbital flag (e, i and a within the metadata's coorbitalCriteria) marks ${f(C.bodies.coOrbital)} bodies; their edge rate is below the rest.`,
      };
      $('whoHint').textContent = notes[key] || '';
    };
    sel.addEventListener('change', draw);
    draw();
    whoDraw = draw;
  }
  let whoDraw = null;

  // ---------------------------------------------------------------- basins
  function drawBasins() {
    const host = $('basins');
    const hist = C.basins[0].histogram;
    const keys = ['1', '2', '3', '4', '5'];
    const vals = keys.map((k) => hist[k]);
    const W = Math.max(300, host.clientWidth || 600);
    const H = 170, left = 44, right = 12, top = 22, bottom = 26;
    const yMax = niceCeil(Math.max(...vals));
    const band = (W - left - right) / keys.length;
    const barW = Math.min(24, band - 8);
    const yOf = (v) => top + (1 - v / yMax) * (H - top - bottom);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    const step = nice(yMax / 4);
    for (let v = 0; v <= yMax; v += step) {
      svg.append(sv('line', { x1: left, x2: W - right, y1: yOf(v), y2: yOf(v), class: v === 0 ? 'axis' : 'grid' }));
      svg.append(sv('text', { x: left - 6, y: yOf(v) + 3.5, 'text-anchor': 'end', 'font-size': 10 }, f(v)));
    }
    vals.forEach((v, i) => {
      const x = left + i * band + (band - barW) / 2;
      const h = yOf(0) - yOf(v);
      const p = `M${x},${yOf(0)} V${yOf(v) + 4} Q${x},${yOf(v)} ${x + 4},${yOf(v)} H${x + barW - 4} Q${x + barW},${yOf(v)} ${x + barW},${yOf(v) + 4} V${yOf(0)} Z`;
      svg.append(sv('path', { d: h > 4 ? p : `M${x},${yOf(0)} h${barW} v${-h} h${-barW} Z`, class: 's1-fill' }));
      svg.append(sv('text', { x: x + barW / 2, y: yOf(v) - 5, 'text-anchor': 'middle', 'font-size': 10 }, f(v)));
      svg.append(sv('text', { x: x + barW / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 10 }, `${keys[i]} basin${keys[i] === '1' ? '' : 's'}`));
    });
    host.replaceChildren(svg);
    host.setAttribute('aria-label', `Bodies by how many basins their five windows span: ${keys.map((k) => `${k}: ${f(hist[k])}`).join(', ')}.`);
    const t = $('basinsTable');
    const ruleText = (b) => `${b.rule.maxColGap} col · ${b.rule.maxRowGap} row`;
    if (isNarrow()) {
      // transposed on narrow screens: one row per basin count, one column per rule
      t.replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'basins' }), ...C.basins.map((b) => el('th', { class: 'num wrap', text: `within ${ruleText(b)}` })))));
      const tb = el('tbody');
      for (const k of keys) tb.append(el('tr', null, el('td', { class: 'num', text: k }), ...C.basins.map((b) => el('td', { class: 'num', text: f(b.histogram[k]) }))));
      t.append(tb);
    } else {
      t.replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'same basin within' }), ...keys.map((k) => el('th', { class: 'num', text: `${k} basin${k === '1' ? '' : 's'}` })))));
      const tb = el('tbody');
      for (const b of C.basins) tb.append(el('tr', null, el('td', { class: 'key', text: ruleText(b) }), ...keys.map((k) => el('td', { class: 'num', text: f(b.histogram[k]) }))));
      t.append(tb);
    }
    $('basinsHint').textContent = `Two stored windows are in the same basin when their cells are within ${C.basins[0].rule.maxColGap} departure columns (${C.basins[0].rule.maxColGap * L.departureSpacingDays} days) and ${C.basins[0].rule.maxRowGap} flight-time row (${C.basins[0].rule.maxRowGap * L.tofSpacingDays} days) of each other; basins are the connected groups. Under this rule most bodies spread their five windows over three or more basins, i.e. the top five are not usually the five neighbours of the minimum. The table shows how the count moves under looser rules.`;
  }

  // ---------------------------------------------------------------- inspector
  const inspectState = { id: null };
  function inspector() {
    const sel = $('bodyPick');
    for (const s of C.sample) sel.append(el('option', { value: s.bodyId, text: `${s.name || s.designation || s.bodyId} — ${s.why || ''}` }));
    sel.addEventListener('change', () => { inspectState.id = sel.value; drawInspect(); });
    inspectState.id = sel.value;
    drawInspect();
  }
  function drawInspect() {
    const s = C.sample.find((x) => x.bodyId === inspectState.id) || C.sample[0];
    const head = $('inspectHead');
    const ref = $('inspectRefusal');
    const mini = $('mini');
    const table = $('inspectTable');
    head.replaceChildren();
    if (s.refusal) {
      ref.hidden = false;
      ref.replaceChildren(el('div', { class: 'r' }, el('div', { class: 'code', text: `refusal · ${s.refusal.code}` }), el('p', { text: s.refusal.reason }), el('p', null, el('strong', { text: 'What would help: ' }), s.refusal.what_would_help)));
      head.append(el('span', { class: 'name', text: s.name || s.bodyId }), el('span', { class: 'muted', text: `${s.orbitClass || 'class unknown'} · H ${s.H === null ? 'missing' : s.H} · status ${s.status}` }));
      mini.replaceChildren();
      mini.hidden = true;
      table.replaceChildren();
      $('inspectHint').textContent = 'This body is excluded from every count on the page; it is listed here so the exclusion is visible.';
      return;
    }
    ref.hidden = true;
    mini.hidden = false;
    const ev = s.evidence;
    head.append(
      el('span', { class: 'name', text: s.name || s.bodyId }),
      el('span', { class: 'muted', text: `${s.orbitClass || '?'} · H ${s.H === null ? 'missing' : s.H}${s.synodicYears ? ` · synodic ${s.synodicYears > 1000 ? 'very long' : `${s.synodicYears.toFixed(2)} yr`}` : ''} · ${s.status}` }),
      el('span', { text: `min C3 ${fix(s.minC3, 4)} km²/s² at column ${ev.cell.col} (${s.minC3Date}), row ${ev.cell.row} (${f(s.minC3TofDays)} days)` }),
      el('span', { text: `${s.basins} basin${s.basins === 1 ? '' : 's'}` }),
    );
    if (!ev.edges.length) head.append(tag('certain', 'interior minimum'));
    for (const e of ev.edges) {
      head.append(el('span', null, `${G.EDGE_NAMES[e.edge]}: `, tag(e.verdict === 'likely_clipped' ? 'likely' : 'spec', e.verdict === 'likely_clipped' ? 'Likely clipped' : 'Undetermined'), e.neighbourPresent ? ` inward +${e.slopeC3PerCell.toFixed(3)} km²/s², chain ${e.chainLength}${e.monotone ? ', monotone' : ', not monotone'}` : ' no inward neighbour stored'));
    }
    // mini grid: the whole lattice for context (adjacent columns are a pixel apart here), then a zoom
    // around the minimum where every lattice cell is a square and the stored windows can be read off
    const W = Math.max(300, mini.clientWidth || 600);
    const narrow = W < 560;
    const fullH = narrow ? 120 : 140;
    const left = narrow ? 72 : 84, right = 16, top = 14, gap = 44;
    const zoomCols = narrow ? 9 : 13, zoomRows = 5;
    const cellPx = Math.min(narrow ? 30 : 40, (W - left - right) / zoomCols);
    const zTop = top + fullH + gap;
    const zH = zoomRows * cellPx;
    const H = zTop + zH + 30;
    const xOf = (c) => left + (c / (L.nCols - 1)) * (W - left - right);
    const yOf = (r) => top + (1 - r / (L.nRows - 1)) * fullH;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    svg.append(sv('rect', { x: left, y: top, width: W - left - right, height: fullH, class: 'lattice' }));
    for (const [x1, x2, y1, y2] of [[left, left, top, top + fullH], [W - right, W - right, top, top + fullH], [left, W - right, top + fullH, top + fullH], [left, W - right, top, top]]) {
      svg.append(sv('line', { x1, x2, y1, y2, class: 'edge-line' }));
    }
    svg.append(sv('text', { x: left - 8, y: top + fullH + 3, 'text-anchor': 'end', 'font-size': 10 }, `${f(L.tofMinDays)} floor`));
    svg.append(sv('text', { x: left - 8, y: top + 3, 'text-anchor': 'end', 'font-size': 10 }, `${f(L.lastTofDays)} ceiling`));
    const midRow = Math.floor((L.nRows - 1) / 2);
    svg.append(sv('line', { x1: left, x2: W - right, y1: yOf(midRow), y2: yOf(midRow), class: 'grid' }));
    svg.append(sv('text', { x: left - 8, y: yOf(midRow) + 3, 'text-anchor': 'end', 'font-size': 10 }, f(rowTof(midRow))));
    L.years.forEach((y, i) => {
      svg.append(sv('line', { x1: xOf(y.firstCol), x2: xOf(y.firstCol), y1: top + fullH, y2: top + fullH + 4, class: 'axis' }));
      if (!narrow || i % 2 === 0) svg.append(sv('text', { x: xOf(y.firstCol + y.cols / 2), y: top + fullH + 15, 'text-anchor': 'middle', 'font-size': 10 }, String(y.year)));
    });
    svg.append(sv('text', { x: left, y: top - 4, 'font-size': 10, class: 'muted-text' }, 'the whole lattice; orange is its edge; one label per basin'));
    const hits = [];
    const labelled = new Set();
    s.windows.forEach((w, i) => {
      const isMin = i === ev.minIndex;
      const g = sv('g', { class: 'win' });
      g.append(sv('circle', { cx: xOf(w.col), cy: yOf(w.row), r: isMin ? 6.5 : 4.5, class: isMin ? 'edge-dot' : 's1-dot' }));
      if (!labelled.has(w.basin)) {
        labelled.add(w.basin);
        const onRight = xOf(w.col) < W - right - 60;
        g.append(sv('text', { x: xOf(w.col) + (onRight ? 9 : -9), y: yOf(w.row) + (w.basin % 2 ? 12 : -6), 'font-size': 10, 'text-anchor': onRight ? 'start' : 'end', class: 'halo' }, `basin ${w.basin}`));
      }
      svg.append(g);
      hits.push({ x: xOf(w.col), y: yOf(w.row), i });
    });
    // zoom panel around the minimum
    const c0 = Math.max(0, Math.min(L.nCols - zoomCols, ev.cell.col - Math.floor(zoomCols / 2)));
    const r0 = Math.max(0, Math.min(L.nRows - zoomRows, ev.cell.row - Math.floor(zoomRows / 2)));
    const zx = (c) => left + (c - c0) * cellPx;
    const zy = (r) => zTop + (r0 + zoomRows - 1 - r) * cellPx;
    svg.append(sv('text', { x: left, y: zTop - 20, 'font-size': 10, class: 'muted-text' }, `zoom: ${zoomCols} departure dates × ${zoomRows} flight times around the minimum (columns ${c0}–${c0 + zoomCols - 1}, rows ${r0}–${r0 + zoomRows - 1})`));
    for (let c = c0; c < c0 + zoomCols; c++) {
      for (let r = r0; r < r0 + zoomRows; r++) {
        const onEdge = c === 0 || c === L.nCols - 1 || r === 0 || r === L.nRows - 1;
        svg.append(sv('rect', { x: zx(c) + 1, y: zy(r) + 1, width: cellPx - 2, height: cellPx - 2, class: onEdge ? 'zcell zedge' : 'zcell', rx: 2 }));
      }
    }
    for (let c = c0; c < c0 + zoomCols; c++) {
      if ((c - c0) % (narrow ? 2 : 1) === 0) svg.append(sv('text', { x: zx(c) + cellPx / 2, y: zTop + zH + 12, 'text-anchor': 'middle', 'font-size': 9 }, colDate(c).slice(5)));
    }
    svg.append(sv('text', { x: left, y: zTop + zH + 24, 'font-size': 9, class: 'muted-text' }, `departure dates of ${colDate(c0).slice(0, 4)}${colDate(c0).slice(0, 4) === colDate(c0 + zoomCols - 1).slice(0, 4) ? '' : `–${colDate(c0 + zoomCols - 1).slice(0, 4)}`} (month-day); orange cells are the lattice's edge`));
    for (let r = r0; r < r0 + zoomRows; r++) svg.append(sv('text', { x: left - 8, y: zy(r) + cellPx / 2 + 3, 'text-anchor': 'end', 'font-size': 10 }, `${f(rowTof(r))} d`));
    s.windows.forEach((w, i) => {
      if (w.col < c0 || w.col >= c0 + zoomCols || w.row < r0 || w.row >= r0 + zoomRows) return;
      const isMin = i === ev.minIndex;
      const g = sv('g', { class: 'zwin' });
      g.append(sv('circle', { cx: zx(w.col) + cellPx / 2, cy: zy(w.row) + cellPx / 2, r: isMin ? 7 : 5, class: isMin ? 'edge-dot' : 's1-dot' }));
      g.append(sv('text', { x: zx(w.col) + cellPx / 2, y: zy(w.row) + (((w.col - c0) % 2) ? cellPx - 3 : 10), 'text-anchor': 'middle', 'font-size': 9, class: 'halo' }, fix(w.c3, narrow ? 2 : 3)));
      svg.append(g);
      hits.push({ x: zx(w.col) + cellPx / 2, y: zy(w.row) + cellPx / 2, i });
    });
    const outside = s.windows.filter((w) => w.col < c0 || w.col >= c0 + zoomCols || w.row < r0 || w.row >= r0 + zoomRows).length;
    if (outside) svg.append(sv('text', { x: left, y: zTop - 8, 'font-size': 10, class: 'muted-text' }, `${outside} of 5 windows lie outside the zoom`));
    mini.replaceChildren(svg);
    mini.setAttribute('aria-label', `${s.name || s.bodyId}: five stored windows on the lattice and a zoom around the minimum at column ${ev.cell.col}, row ${ev.cell.row}; ${s.basins} basins.`);
    const tip = $('miniTip');
    const hit = (ev2) => {
      const rect = svg.getBoundingClientRect();
      const x = ((ev2.clientX - rect.left) * W) / rect.width, y = ((ev2.clientY - rect.top) * W) / rect.width;
      let best = null, bd = 1e9;
      for (const h of hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bd) { bd = d; best = h; }
      }
      return bd <= 24 ? best : null;
    };
    svg.addEventListener('pointermove', (ev2) => {
      const h = hit(ev2);
      if (!h) return hideTip(tip);
      const w = s.windows[h.i];
      showTip(tip, mini, h.x, h.y, [`C3 ${fix(w.c3, 4)} km²/s²`, `${w.launchDate} · ${f(w.tofDays)}-day flight`, `column ${w.col}, row ${w.row} · basin ${w.basin}${w.edges.length ? ` · edge: ${w.edges.map((k) => G.EDGE_NAMES[k]).join(', ')}` : ''}`]);
    });
    svg.addEventListener('pointerdown', (ev2) => svg.dispatchEvent(new PointerEvent('pointermove', ev2)));
    svg.addEventListener('pointerleave', (ev2) => { if (ev2.pointerType === 'mouse') hideTip(tip); });
    // table
    const narrowT = isNarrow();
    table.replaceChildren(el('thead', null, narrowT
      ? el('tr', null, el('th', { text: 'departure' }), el('th', { class: 'num', text: 'flight d' }), el('th', { class: 'num', text: 'C3' }), el('th', { class: 'num', text: 'col / row' }))
      : el('tr', null, el('th', { text: 'departure' }), el('th', { class: 'num', text: 'flight, days' }), el('th', { class: 'num', text: 'C3 km²/s²' }), el('th', { class: 'num', text: 'column' }), el('th', { class: 'num', text: 'row' }), el('th', { class: 'num', text: 'basin' }), el('th', { text: 'edge' }))));
    const tb = el('tbody');
    s.windows.forEach((w, i) => {
      const edgeText = w.edges.map((k) => G.EDGE_NAMES[k]).join(', ');
      if (narrowT) {
        const dep = el('td', { class: 'wrap', text: w.launchDate + (i === ev.minIndex ? ' (min)' : '') });
        dep.append(el('span', { class: 'small muted', text: `basin ${w.basin}${edgeText ? ` · ${edgeText}` : ''}`, style: 'display:block' }));
        tb.append(el('tr', { class: w.edges.length ? 'edge-row' : null }, dep, el('td', { class: 'num', text: f(w.tofDays) }), el('td', { class: 'num', text: fix(w.c3, 4) }), el('td', { class: 'num', text: `${w.col} / ${w.row}` })));
      } else {
        tb.append(el('tr', { class: w.edges.length ? 'edge-row' : null }, el('td', { class: 'key', text: w.launchDate + (i === ev.minIndex ? ' (min)' : '') }), el('td', { class: 'num', text: f(w.tofDays) }), el('td', { class: 'num', text: fix(w.c3, 4) }), el('td', { class: 'num', text: String(w.col) }), el('td', { class: 'num', text: String(w.row) }), el('td', { class: 'num', text: String(w.basin) }), el('td', { text: edgeText || '—' })));
      }
    });
    table.append(tb);
    $('inspectHint').textContent = `Column = days from ${L.startUtc} ÷ ${L.departureSpacingDays}; row = (flight days − ${L.tofMinDays}) ÷ ${L.tofSpacingDays}. Edges are column 0, column ${L.nCols - 1}, row 0 and row ${L.nRows - 1}. The five windows are the cache's bestWindows, ascending by C3; nothing else about the body is used.`;
  }

  // ---------------------------------------------------------------- what this cannot say
  function cannot() {
    const host = $('cannot');
    const card = (code, title, reason, help) => el('div', { class: 'r' }, el('div', { class: 'code', text: `refusal · ${code} · ${title}` }), el('p', { text: reason }), el('p', null, el('strong', { text: 'What would help: ' }), help));
    const floorN = E.tofMin.touched;
    host.append(
      card('insufficient_data', 'the slope at the flight-time floor',
        `${f(floorN)} bodies have their cheapest stored window at ${L.tofMinDays} days, the shortest flight the grid solves. The ${L.tofMinDays + L.tofSpacingDays}-day neighbour is among the five stored windows for ${E.tofMin.neighbourPresent} of them, so for ${f(E.tofMin.undetermined)} the cache holds no slope there, and whether their minima lie below ${L.tofMinDays} days cannot be read from it.`,
        `one Lambert solve per such body at a shorter flight time (for instance ${L.tofMinDays - L.tofSpacingDays} days): about ${f(floorN)} solves against the ${f(M.totalSolves)} the cache took.`),
      card('out_of_envelope', 'how far beyond an edge the true minimum lies',
        `The lattice has no cell beyond its bounds. For the ${f(E.first.likelyClipped + E.last.likelyClipped)} departure-edge bodies marked likely clipped, the quoted slope is the rise over one ${L.departureSpacingDays}-day step inward, not an extrapolation; the page never estimates an off-grid C3.`,
        `a widened lattice for the ${f(E.first.touched + E.last.touched)} bodies whose minimum sits on a departure edge: one extra year each side is ${Math.round(365 / L.departureSpacingDays)} columns × ${L.nRows} rows × ${f(E.first.touched + E.last.touched)} bodies, about ${f(Math.round(365 / L.departureSpacingDays) * L.nRows * (E.first.touched + E.last.touched))} solves; the whole-catalog horizon question is the H0 seat's.`),
      card('out_of_envelope', 'whether an edge minimum is the body\'s true best window',
        `Every count here is over sampled cells of a single-revolution patched-conic screen on a ${L.departureSpacingDays} × ${L.tofSpacingDays}-day lattice. The cache's own disclosure applies: each stored C3 is the lowest sampled point; the true minimum is at or below it, also for interior bodies.`,
        'the porkchop page\'s finer live grid for any one body, or a sub-lattice refinement around each stored minimum.'),
      card('insufficient_data', `absolute magnitude for ${C.inputs.catalog ? f(C.inputs.catalog.missingAbsoluteMagnitudeCount) : 'some'} bodies`,
        'The catalog carries no H for them, so they cannot be placed in a size band; they keep their own row in the H table rather than being dropped or guessed.',
        'H values from the MPC or JPL SBDB for those designations.'),
      card('insufficient_data', `${C.bodies.withoutWindows.map((b) => b.bodyId).join(', ')}`,
        `${C.bodies.withoutWindows.map((b) => `${b.bodyId} has status ${b.status} and no stored windows`).join('; ')}. It is excluded from every count and shown in the inspector as a refusal.`,
        'a propagation that converges for it, or an explicit "not screened" state wherever the catalog shows a status.'),
    );
  }

  // ---------------------------------------------------------------- provenance
  function provenance() {
    const p = $('prov');
    const sc = DATA.censusProvenance, sm = DATA.metadataProvenance;
    const dl = el('dl');
    const add = (k, v) => dl.append(el('dt', { text: k }), el('dd', { text: v }));
    add('cache', `${sc.path} @ ${String(sc.commit).slice(0, 12)} (committed ${sc.commitDate}; file last changed ${sc.pathLastChanged}); sha256 ${sc.sourceSha256}; ${f(sc.sourceBytes)} bytes; read bytes ${sc.readMatchesCommitted ? 'equal' : 'DIFFER FROM'} the committed blob`);
    add('cache metadata', `generatedAt ${M.generatedAt}; solverCommit ${M.provenance.solverCommit}; totalSolves ${f(M.totalSolves)}; wall time ${Math.round(M.wallTimeSeconds)} s; feasibleC3MaxKm2S2 ${M.feasibleC3MaxKm2S2}`);
    if (C.inputs.catalog) add('catalog', `${C.inputs.catalog.path}; sha256 ${C.inputs.catalog.sha256} (${C.inputs.catalog.sha256 === M.provenance.catalogFixtureSha256 ? 'equals' : 'differs from'} the cache's catalogFixtureSha256); ${f(C.inputs.catalog.totalBodies)} bodies; selection ${C.inputs.catalog.selectionSource}`);
    if (C.inputs.viewGrid) add('porkchop view grid', `${C.inputs.viewGrid.source}: depStartJD line ${C.inputs.viewGrid.lines.depStartJD}, depEndJD line ${C.inputs.viewGrid.lines.depEndJD}, nDep ${C.inputs.viewGrid.nDep}, nTof ${C.inputs.viewGrid.nTof}, flight times ${C.inputs.viewGrid.tofMinDays}–${C.inputs.viewGrid.tofMaxDays} days; span label derived at line ${C.inputs.viewGrid.spanLabelDerivedAtLine}`);
    if (C.inputs.auKm) add('AU', `${C.inputs.auKm.value} km, ${C.inputs.auKm.source} line ${C.inputs.auKm.line}`);
    add('derived', `snapshots/edge-census.json by edge-census.mjs (sidecar ${sm.copiedAt.slice(0, 10)}); wrapped by build-data.mjs as snapshots/edge-census.data.js; the lattice is derived from the metadata excerpt snapshots/metadata.json (sha256 ${sm.writtenSha256.slice(0, 16)}…)`);
    p.append(el('div', null, el('strong', { text: 'Provenance. ' }), 'An idea-bank prototype: a census of a committed cache, not a result that has passed Aster\'s audit, oracle validation or DEC process. Every figure above is in snapshots/edge-census.json; the tests recompute them from the checkout when it is present.'), dl);
  }

  // ---------------------------------------------------------------- go
  edgeTable();
  tail();
  who();
  inspector();
  cannot();
  provenance();
  function drawAll() {
    drawHeat();
    drawCols();
    drawBasins();
    drawInspect();
    edgeTable();
    if (whoDraw) whoDraw();
  }
  drawAll();
  let raf = 0;
  const redraw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawAll);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(document.querySelector('main'));
  else window.addEventListener('resize', redraw);
})();
