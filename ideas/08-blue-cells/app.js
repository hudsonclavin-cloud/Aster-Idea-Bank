// app.js — renders the saved run (page-data.js, written by ladder_export.py --js) and lets a person
// run the same reader (bluecells.js) on a workbook of their own, in the browser. Computes no
// economics. Every number shown comes from page-data.js or from the dropped file.
(function () {
  'use strict';
  const D = window.BLUE_CELLS_DATA;
  const BC = window.BlueCells;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const COLS = Object.keys(D.ladder.columns);
  const ROWS_MAP = {
    source: D.ladder.rows_map_source.file,
    lines: D.ladder.rows_map_source.lines,
    rows: Object.fromEntries(Object.entries(D.ladder.rows).map(([k, r]) => [k, r.row])),
    scenarios: COLS,
    columns: D.ladder.columns,
    sheet: D.ladder.sheet,
  };
  const yellowOn = (sheetName) => new Set(((D.census.sheets[sheetName] || {}).yellow_fill_cells) || []);

  function renderMeta() {
    const w = D.workbook;
    const p = D.provenance || {};
    const commit = String(p.commit || '').slice(0, 7);
    $('#meta').innerHTML = `<b>${esc(w.file)}</b> · ${fmt(w.bytes)} bytes · ${w.members} zip members · sha256 <b>${esc(w.sha256)}</b> · md5 <b>${esc(w.md5)}</b>`
      + (commit ? ` · from <b>${esc(p.repo || '')}</b> ${esc(p.path || '')} @ <b>${esc(commit)}</b> (${esc(p.commitDate || '')}; the file last changed ${esc(p.pathLastChanged || '')})` : '');
  }

  function renderTiles() {
    const t = D.census.totals;
    const tiles = [
      { n: t.formula_cells, l: 'formula cells across all sheets', cls: '' },
      { n: t.formula_cells_with_cached_value, l: 'of them with a cached result stored in the file', cls: t.formula_cells_with_cached_value === 0 ? 'zero' : '' },
      { n: t.literal_numbers, l: 'literal numbers (inputs)', cls: '' },
      { n: t.blue_cells, l: 'cells in the blue input font', cls: 'blue' },
    ];
    $('#tiles').innerHTML = tiles.map((x) => `<div class="tile ${x.cls}" role="listitem"><div class="n">${fmt(x.n)}</div><div class="l">${esc(x.l)}</div></div>`).join('');
    $('#finding').textContent = D.finding;
    const w = D.workbook;
    const calc = w.calc_pr || {};
    const media = (w.media || []).map((m) => `${m.member} (${fmt(m.bytes)} bytes, md5 ${m.md5})`).join(', ');
    $('#written-by').innerHTML = `Written by <b>${esc(w.application || '?')}</b> (creator ${esc(w.creator || '?')}), created ${esc(w.created || '?')}, modified ${esc(w.modified || '?')}; `
      + `<code>calcPr fullCalcOnLoad="${esc(calc.fullCalcOnLoad ?? '?')}"</code> tells a spreadsheet program to recompute everything on open; `
      + `${w.shared_strings == null ? 'no shared-strings part (every string is inline)' : `${w.shared_strings} shared strings`}; `
      + `sheets: ${w.sheets.map(esc).join(', ')}. `
      + (media ? `The one embedded image, ${esc(media)}, is the only computed output inside the file: a picture of the cash-flow chart, not values (the README records which committed PNG it equals).` : 'No embedded media.')
      + (w.legend ? ` The README sheet's legend: <q>${esc(w.legend)}</q>` : '');
  }

  function renderLadder() {
    const L = D.ladder;
    const lines = L.rows_map_source.lines || {};
    const lr = lines._LADDER_ROWS ? `lines ${lines._LADDER_ROWS[0]}–${lines._LADDER_ROWS[1]}` : '';
    const rows = Object.values(L.rows);
    const first = rows[0], last = rows[rows.length - 1];
    $('#ladder-lead').innerHTML = `<code>${esc(L.sheet)}!${esc(L.columns[COLS[0]])}${first.row}:${esc(L.columns[COLS[COLS.length - 1]])}${last.row}</code>, ${rows.length} rows × ${COLS.length} columns, keyed by <code>_LADDER_ROWS</code> in <code>${esc(L.rows_map_source.file)}</code> (${esc(lr)}), the same map <code>load_ladder_from_workbook</code> uses with openpyxl. Before trusting a row number the reader checks that the label in column A says what the key means; a sheet whose rows have moved is refused.`;
    const yellow = yellowOn(L.sheet);
    const tbody = $('#ladder tbody');
    tbody.innerHTML = Object.entries(L.rows).map(([key, r]) => {
      const cells = COLS.map((c) => {
        const ref = r.cells[c];
        const cls = ['num', r.blue ? 'blue' : '', yellow.has(ref) ? 'yellow' : ''].filter(Boolean).join(' ');
        return `<td class="${cls}" data-cell="${esc(ref)}" title="${esc(ref)}">${esc(r.raw[c])}</td>`;
      }).join('');
      return `<tr data-key="${esc(key)}"><td class="key">${esc(key)}</td>${cells}<td>${esc(r.cells[COLS[0]])}:${esc(r.cells[COLS[COLS.length - 1]])}</td><td class="label">${esc(r.label)}</td></tr>`;
    }).join('');
    $('#notes').innerHTML = Object.entries(L.rows).map(([key, r]) => `<li><code>${esc(key)}</code>${r.note ? esc(r.note) : '<i>no note</i>'}</li>`).join('');
  }

  function renderDesign() {
    const tbody = $('#design tbody');
    const blocks = [D.design_point, D.constants];
    tbody.innerHTML = blocks.map((b) => {
      const entries = Object.entries(b.entries);
      if (!entries.length) return `<tr><td colspan="5">none found under <code>${esc(b.header)}</code></td></tr>`;
      const head = `<tr><th colspan="5" class="label">${esc(b.header)} (${esc(b.sheet)}!${esc(entries[0][1].cell)}:${esc(entries[entries.length - 1][1].cell)})</th></tr>`;
      return head + entries.map(([k, v]) => `<tr><td class="key">${esc(k)}</td><td class="num ${v.blue ? 'blue' : ''}">${esc(v.raw)}</td><td>${esc(v.cell)}</td><td class="label">${esc(v.label)}</td><td class="label">${esc(v.note || '')}</td></tr>`).join('');
    }).join('');
  }

  function renderCensus() {
    const cs = D.census.sheets;
    const t = D.census.totals;
    const row = (name, c, cls) => `<tr class="${cls || ''}"><td>${esc(name)}</td><td class="num">${c.cells}</td><td class="num">${c.formula_cells}</td><td class="num">${c.formula_cells_with_cached_value}</td><td class="num">${c.literal_numbers}</td><td class="num">${c.strings}</td><td class="num">${c.blue_cells}</td><td class="num">${c.green_cells}</td><td class="num">${Array.isArray(c.yellow_fill_cells) ? c.yellow_fill_cells.length : c.yellow_fill_cells}</td></tr>`;
    $('#census tbody').innerHTML = Object.entries(cs).map(([n, c]) => row(n, c)).join('') + row('TOTAL', t, 'total');
    const yellow = Object.entries(cs).flatMap(([n, c]) => c.yellow_fill_cells.map((r) => `${n}!${r}`));
    $('#census-notes').innerHTML = `"cached" counts formula cells whose <code>&lt;v&gt;</code> is non-empty: in this file every one of the ${fmt(t.formula_cells)} formula cells has an empty <code>&lt;v/&gt;</code>. `
      + `Yellow-filled cells (the sheet's "key assumption needing attention"): ${yellow.map((y) => `<code>${esc(y)}</code>`).join(', ') || 'none'}. `
      + `The ${t.green_cells} green cells are the Cash Flow sheet's <code>INDEX(...)</code> links into Design Calcs and Assumptions.`;
    $('#checks').innerHTML = D.checks.map((c) => `<li class="${c.ok ? '' : 'bad'}"><b>${esc(c.name)}</b>: ${esc(c.detail)}</li>`).join('');
  }

  // ── copy ────────────────────────────────────────────────────────────────────
  async function copyText(text, what) {
    const status = $('#copy-status');
    const fallback = $('#copy-fallback');
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard API');
      await navigator.clipboard.writeText(text);
      status.textContent = `Copied ${what} (${fmt(text.length)} characters).`;
      fallback.hidden = true;
    } catch (e) {
      fallback.textContent = text;
      fallback.hidden = false;
      fallback.focus();
      status.textContent = `The clipboard is not available here; ${what} is shown below, select and copy it.`;
    }
  }
  $('#copy-json').addEventListener('click', () => copyText(JSON.stringify(D, null, 1) + '\n', 'ladder.json'));
  $('#copy-report').addEventListener('click', () => copyText(BC.renderReport(D), 'the text report'));

  // ── check your own copy ─────────────────────────────────────────────────────
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  function compare(saved, own) {
    const out = { identical: saved.workbook.md5 === own.workbook.md5, ladder: [], census: [] };
    for (const [k, r] of Object.entries(saved.ladder.rows)) {
      const o = own.ladder.rows[k];
      for (const c of COLS) {
        if (!o || o.values[c] !== r.values[c]) out.ladder.push({ key: k, scn: c, cell: r.cells[c], saved: r.raw[c], own: o ? o.raw[c] : '(missing)' });
      }
    }
    const st = saved.census.totals, ot = own.census.totals;
    for (const k of ['formula_cells', 'formula_cells_with_cached_value', 'literal_numbers', 'blue_cells']) {
      if (st[k] !== ot[k]) out.census.push({ k, saved: st[k], own: ot[k] });
    }
    return out;
  }

  function verdict(cls, title, bodyHtml) {
    $('#own').innerHTML = `<div class="verdict ${cls}"><h3>${esc(title)}</h3>${bodyHtml}</div>`;
  }

  async function checkOwn(file) {
    const report = $('#own-report');
    report.hidden = true;
    if (!file) return;
    if (typeof DecompressionStream === 'undefined') {
      verdict('refuse', 'Cannot read the file in this browser',
        '<p>Missing: <code>DecompressionStream</code>, the built-in inflater this page uses to open zip members. What would help: a browser from 2023 or later (Chrome 103+, Firefox 113+, Safari 16.4+), or run the command-line reader: <code>python3 ideas/08-blue-cells/ladder_export.py your.xlsx</code>.</p>');
      return;
    }
    verdict('', 'Reading…', `<p>${esc(file.name)}, ${fmt(file.size)} bytes.</p>`);
    let own;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const wb = await BC.readWorkbook(bytes, inflateRaw, file.name);
      own = BC.analyze(wb, ROWS_MAP, null);
    } catch (e) {
      if (e instanceof BC.LadderError) {
        verdict('refuse', 'Refused: the workbook does not hold the ladder where the row map says', `<pre>${esc(e.message)}</pre><p>No ladder is returned for this file; the message above says what was found, what was expected and what would help.</p>`);
      } else {
        verdict('refuse', 'Cannot read this file as a workbook', `<pre>${esc(e.message || String(e))}</pre><p>What would help: an .xlsx (a zip with <code>xl/workbook.xml</code>), not a .xls, .csv or .ods.</p>`);
      }
      return;
    }
    const cmp = compare(D, own);
    const cached = own.census.totals.formula_cells_with_cached_value;
    const parts = [];
    parts.push(`<p>${esc(file.name)}: md5 <code>${esc(own.workbook.md5)}</code>${own.workbook.sha256 ? `, sha256 <code>${esc(own.workbook.sha256)}</code>` : ''}, written by ${esc(own.workbook.application || '?')}.</p>`);
    if (cmp.identical) {
      parts.push(`<p>Byte-identical to the snapshot taken from Skyhook @ <code>${esc(String((D.provenance || {}).commit || '').slice(0, 7))}</code>: same md5, so the same ${fmt(own.census.totals.formula_cells)} formulas and the same ${Object.keys(own.ladder.rows).length * COLS.length} ladder cells.</p>`);
    } else {
      if (cmp.ladder.length) {
        parts.push(`<p><b>${cmp.ladder.length}</b> ladder cell${cmp.ladder.length === 1 ? '' : 's'} differ from the snapshot:</p><ul>`
          + cmp.ladder.map((d) => `<li><code>${esc(d.key)}</code> ${esc(d.scn)} (${esc(d.cell)}): snapshot ${esc(d.saved)} → yours <b>${esc(d.own)}</b></li>`).join('') + '</ul>');
      } else {
        parts.push(`<p>All ${Object.keys(own.ladder.rows).length * COLS.length} ladder cells equal the snapshot's, although the file's bytes differ.</p>`);
      }
      if (cmp.census.length) {
        parts.push('<p>The census differs:</p><ul>' + cmp.census.map((d) => `<li>${esc(d.k.replace(/_/g, ' '))}: snapshot ${d.saved} → yours <b>${d.own}</b></li>`).join('') + '</ul>');
      }
      if (cached > 0) {
        parts.push(`<p>Your copy stores <b>${fmt(cached)}</b> cached result${cached === 1 ? '' : 's'}: it has been recalculated and saved by a spreadsheet program. The committed file stores none.</p>`);
      }
    }
    const failed = own.checks.filter((c) => !c.ok);
    if (failed.length) parts.push('<p>Checks that did not pass on your copy:</p><ul>' + failed.map((c) => `<li><b>${esc(c.name)}</b>: ${esc(c.detail)}</li>`).join('') + '</ul>');
    verdict(cmp.identical ? 'same' : 'diff', cmp.identical ? 'Same file as the snapshot' : 'Not the committed file', parts.join(''));
    report.textContent = BC.renderReport(own);
    report.hidden = false;
  }

  const drop = $('#drop');
  const input = $('#file');
  input.addEventListener('change', () => checkOwn(input.files && input.files[0]));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) checkOwn(f); });

  renderMeta();
  renderTiles();
  renderLadder();
  renderDesign();
  renderCensus();
})();
