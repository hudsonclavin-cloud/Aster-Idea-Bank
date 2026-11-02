// Near Field Guide: the page. Reads window.NearFieldGuide (guide.js, the kernel) and
// window.NearFieldGuideData (snapshots/bins.data.js, derived by build-data.mjs) and draws every
// panel from the shipped bins. Nothing here is a number of its own: counts come from the bins,
// constants and passages from the data file (each with its source path and line), and the only
// per-body values are the 11 landmark records, derived in the browser with the same kernel.
(function () {
  'use strict';
  const G = window.NearFieldGuide;
  const D = window.NearFieldGuideData;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- refusals
  // Shaped like an Aster MCP evidence envelope's refusal (mcp/src/tools/envelope-schema.ts:51).
  function refusalHtml(code, title, missing, help, quote, role) {
    return `<div class="refusal" role="${role || 'alert'}"><p class="code">refusal · ${esc(code)}</p><p><strong>${esc(title)}</strong></p>` +
      `<p><span class="cite">what is missing:</span> ${missing}</p><p><span class="cite">what would help:</span> ${help}</p>${quote || ''}</div>`;
  }
  function refuseAll(code, title, missing, help) {
    $('lede').textContent = 'The guide refuses to draw.';
    $('refusal-root').innerHTML = refusalHtml(code, title, missing, help);
    $('guide').hidden = true;
  }
  if (!G) return refuseAll('insufficient_data', 'The kernel did not load', '<code>guide.js</code> is not on the page.', 'Open the page from its folder so <code>guide.js</code> sits beside <code>index.html</code>.');
  if (!D) return refuseAll('insufficient_data', 'The bins did not load', '<code>snapshots/bins.data.js</code> is not on the page, so there is nothing to count.', 'Rebuild it from an Aster checkout: <code>node ideas/28-near-field-guide/build-data.mjs --write</code>.');
  if (D.specSignature !== G.specSignature()) return refuseAll('out_of_envelope', 'The bins were made under different bin edges', 'The data file records the bin specification it was binned under, and it is not the one <code>guide.js</code> now uses; drawing would put counts under the wrong edges.', 'Re-derive the bins with the current kernel: <code>node ideas/28-near-field-guide/build-data.mjs --write</code>.');

  const C = D.constants;
  // Quoted lines are shown as written, with Markdown's own marks (list dashes, table pipes, ** and
  // backticks) rendered rather than printed, and an ellipsis where a quoted line breaks mid-sentence.
  function mdLine(t) {
    let x = t.replace(/^[-•\u200b\s]+/, '').replace(/^\|\s*/, '').replace(/\s*\|$/, '').replace(/\s+\|\s+/g, ' · ');
    x = esc(x).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    return x;
  }
  const quote = (q) => {
    const lines = q.text.split('\n');
    const body = lines.map((l, k) => {
      const t = mdLine(l);
      const cut = k === lines.length - 1 && !/[.!?:;)\]"”`]$/.test(l.trim()) && !/^\|/.test(l.trim()) ? ' …' : '';
      return lines.length > 1 && k > 0 ? `<br>• ${t}${cut}` : `${t}${cut}`;
    }).join('');
    const where = q.lastLine && q.lastLine !== q.line ? `${q.line}–${q.lastLine}` : q.line;
    return `<blockquote class="quote">${body}</blockquote><p class="cite">${esc(q.path)}:${where} at ${esc(D.source.commit.slice(0, 7))}</p>`;
  };
  const cite = (o) => `<span class="cite">${esc(o.path)}:${o.line}</span>`;
  const fmt = G.fmtInt;
  const pct = G.fmtPct;
  const num = (x, d) => (x === null || x === undefined ? 'null' : typeof x === 'number' ? (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(3) : x.toFixed(d === undefined ? 3 : d)) : String(x));

  // ---------------------------------------------------------------- state
  const TAIL = C.tailClasses.value;
  const CLASS_CHIPS = [{ label: 'All', v: null }].concat(['ATE', 'APO', 'AMO', 'IEO'].map((c) => ({ label: c, v: c })), [{ label: `Comet tail (${TAIL.join(' + ')})`, v: TAIL }]);
  const TIER_CHIPS = [{ label: 'All', v: null }].concat(G.CATS[1].cats.map((c) => ({ label: c, v: c })));
  const FID_CHIPS = [{ label: 'All', v: null }].concat(G.CATS[2].cats.map((c) => ({ label: c, v: c })));
  const state = { cls: null, tier: null, fid: null, lm: '', log: false, tj: 'TJ' };

  function readHash() {
    try {
      const h = new URLSearchParams(location.hash.slice(1));
      const pick = (chips, v) => {
        const hit = chips.find((c) => (c.v === null ? 'all' : Array.isArray(c.v) ? 'tail' : c.v) === v);
        return hit ? hit.v : null;
      };
      if (h.has('cls')) state.cls = pick(CLASS_CHIPS, h.get('cls'));
      if (h.has('tier')) state.tier = pick(TIER_CHIPS, h.get('tier'));
      if (h.has('fid')) state.fid = pick(FID_CHIPS, h.get('fid'));
      if (h.has('lm') && D.landmarks.some((l) => l.record.designation === h.get('lm'))) state.lm = h.get('lm');
      state.log = h.get('log') === '1';
      state.tj = h.get('tj') === 'ecl' ? 'TJe' : 'TJ';
    } catch (e) {
      /* a malformed hash leaves the defaults */
    }
  }
  function writeHash() {
    const key = (v) => (v === null ? null : Array.isArray(v) ? 'tail' : v);
    const h = new URLSearchParams();
    if (state.cls !== null) h.set('cls', key(state.cls));
    if (state.tier !== null) h.set('tier', state.tier);
    if (state.fid !== null) h.set('fid', state.fid);
    if (state.lm) h.set('lm', state.lm);
    if (state.log) h.set('log', '1');
    if (state.tj === 'TJe') h.set('tj', 'ecl');
    const s = h.toString();
    try {
      history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
    } catch (e) {
      /* file:// in some browsers refuses replaceState; the page works without it */
    }
  }
  const sel = () => ({ cls: state.cls, tier: state.tier, fid: state.fid });

  // ---------------------------------------------------------------- landmarks, derived here with the kernel
  const CTX = { auKm: C.auKm.value, aJAu: D.jupiter.aAu, jupiterPole: D.jupiter.pole, rule: C.classRule.value, bands: C.bands.value };
  const LM = D.landmarks.map((l) => {
    const d = G.derive(l.record, Object.assign({}, CTX, { fidelity: () => l.derived.fid }));
    return { des: l.record.designation, name: l.record.name, record: l.record, shipped: l.derived, d };
  });
  const landmark = () => LM.find((l) => l.des === state.lm) || null;

  // ---------------------------------------------------------------- reference lines (each from a source)
  const jfc = /\((\d+) < Tj < (\d+)\)/.exec(D.sbdbClasses.classes.JFc.description);
  const tjRefs = jfc ? [{ x: Number(jfc[1]), label: jfc[1] }, { x: Number(jfc[2]), label: jfc[2] }] : [];
  const REFS = {
    a: [{ x: C.classRule.value.ateA, label: `a ${C.classRule.value.ateA}` }],
    e: C.bands.value.map((t, k) => ({ x: t, label: 'BCD'[k] })),
    q: [{ x: C.classRule.value.apoQ, label: `${C.classRule.value.apoQ}` }, { x: C.neoQ.value, label: `${C.neoQ.value}` }],
    Q: [{ x: C.classRule.value.ieoQ, label: `${C.classRule.value.ieoQ}` }, { x: C.jupiterCrossingQ.value, label: `${C.jupiterCrossingQ.value}` }],
    TJ: tjRefs,
    TJe: tjRefs,
  };
  const REF_NOTES = {
    a: () => `Line: a = ${C.classRule.value.ateA} AU, Aster's ATE/APO split (${cite(C.classRule.lines[1])}).`,
    e: () => `Lines: Aster's eccentricity-band edges ${C.bands.value.join(', ')} (${cite(C.bands.lines[0])}–${C.bands.lines[2].line}); each edge opens its bar, as Aster's strict "&lt;" means.`,
    q: () => `Lines: q = ${C.classRule.value.apoQ} AU, Aster's APO/AMO split (${cite(C.classRule.lines[2])}); q = ${C.neoQ.value} AU, the NEO perihelion bound as Aster's literature note quotes it (${cite(C.neoQ)}).`,
    Q: () => `Lines: Q = ${C.classRule.value.ieoQ} AU, Aster's IEO bound (${cite(C.classRule.lines[0])}); Q = ${C.jupiterCrossingQ.value} AU, Slice 18's Jupiter-crossing threshold (${cite(C.jupiterCrossingQ)}).`,
    TJ: () => `Lines: T_J = 2 and 3, the Jupiter-family band in JPL's class table ("${esc(D.sbdbClasses.classes.JFc.description)}", ${esc(D.sbdbClasses.path)}:${D.sbdbClasses.classes.JFc.line}). A dynamical heuristic, not an Aster classification.`,
  };
  REF_NOTES.TJe = REF_NOTES.TJ;
  const UNIT = (s) => (!s.unit ? '' : s.unit === '°' ? s.unit : ` ${s.unit}`);

  // ---------------------------------------------------------------- tooltip
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, x + 12));
    const top = y - h - 12 < 6 ? y + 16 : y - h - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => {
    tip.hidden = true;
  };
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------------------------------------------------------------- chips
  function chipRow(rootId, chips, dim) {
    const root = $(rootId);
    root.innerHTML = '';
    chips.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.dim = dim;
      b.dataset.key = c.v === null ? 'all' : Array.isArray(c.v) ? 'tail' : c.v;
      b.innerHTML = `${esc(c.label)}<span class="n"></span>`;
      b.addEventListener('click', () => {
        state[dim] = c.v;
        render();
      });
      root.appendChild(b);
    });
  }
  function updateChips() {
    for (const [rootId, chips, dim] of [['f-cls', CLASS_CHIPS, 'cls'], ['f-tier', TIER_CHIPS, 'tier'], ['f-fid', FID_CHIPS, 'fid']]) {
      const buttons = $(rootId).querySelectorAll('.chip');
      chips.forEach((c, k) => {
        const s = sel();
        s[dim] = c.v;
        const n = G.summarize(D.atoms, s).n;
        const on = JSON.stringify(state[dim]) === JSON.stringify(c.v);
        buttons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
        buttons[k].querySelector('.n').textContent = fmt(n);
        buttons[k].setAttribute('aria-label', `${c.label}: ${fmt(n)} bodies with the other filters as set`);
      });
    }
  }

  // ---------------------------------------------------------------- histogram panels
  function median(spec, dense) {
    const k = G.medianBar(spec, dense);
    return k === null ? null : G.bars(spec)[k];
  }
  function landmarkValue(spec, l) {
    if (!l) return null;
    return l.d[spec.key];
  }

  function histogramPanel(spec, S, opts) {
    const fig = document.createElement('figure');
    fig.className = 'panel';
    fig.dataset.key = spec.key;
    const bars = G.bars(spec);
    const dense = S.h[spec.key];
    const nullIdx = bars.findIndex((b) => b.kind === 'null');
    const nNull = nullIdx >= 0 ? dense[nullIdx] : 0;
    const med = median(spec, dense);
    // Nothing on the axis for this selection (the comet tail's H, for one): refuse, do not draw an
    // empty chart.
    const refused = S.n > 0 && G.numericCount(spec, dense) === 0;
    const title = spec.key === 'TJ' || spec.key === 'TJe' ? 'Tisserand parameter T_J' : spec.label;
    fig.innerHTML = `<figcaption><span class="p-title">${esc(title)}${spec.unit ? ` <span class="cite">(${esc(spec.unit)})</span>` : ''}</span>` +
      `<span class="p-meta">n ${fmt(S.n)}${nullIdx >= 0 ? ` · not reported ${fmt(nNull)}` : ''}${med ? ` · median in ${esc(med.label)}${UNIT(spec)}` : ''}</span></figcaption>`;
    if (opts && opts.toggle) fig.appendChild(opts.toggle);
    const holder = document.createElement('div');
    fig.appendChild(holder);
    const beyond = document.createElement('div');
    beyond.className = 'beyond';
    const extra = bars.filter((b) => b.kind !== 'bin');
    if (refused) {
      fig.dataset.refused = 'insufficient_data';
      const where = extra.filter((b) => dense[b.idx]).map((b) => `${fmt(dense[b.idx])} ${esc(b.label)}`).join(', ');
      const help = spec.key === 'H'
        ? `A source that reports H for these bodies; the catalog has none for them (its header counts ${fmt(D.header.catalog.missingAbsoluteMagnitudeCount)} bodies without H in all). Or widen the selection.`
        : spec.key === 'r'
          ? 'H for these bodies: the catalog derives the radius from H and, by its own rule, stores none without it. Or widen the selection.'
          : 'A source that reports this field for these bodies, or a wider selection (tap All on a row).';
      holder.innerHTML = refusalHtml('insufficient_data', `No body in this selection has a value on this axis`, `all ${fmt(S.n)} bodies are outside it: ${where}. There is no distribution to draw, so no chart is drawn.`, esc(help), spec.key === 'r' ? quote(D.quotes.radiusNull) : '', 'note');
    }
    if (extra.length) {
      beyond.innerHTML = `<p class="beyond-title">Beyond the axis</p>` + extra.map((b) => {
        const c = dense[b.idx];
        const w = S.n ? (100 * c) / S.n : 0;
        return `<div class="hrow" data-bar="${b.idx}"><span class="hl">${esc(b.label)}${b.kind === 'over' ? UNIT(spec) : ''}</span><span class="track"><span class="fill${b.kind === 'null' ? ' null' : ''}" style="width:${w.toFixed(2)}%"></span></span><span class="hv">${fmt(c)}<span class="pct">${pct(c, S.n)}</span></span></div>`;
      }).join('');
      fig.appendChild(beyond);
    }
    const l = landmark();
    if (l) {
      const v = landmarkValue(spec, l);
      const p = document.createElement('p');
      p.className = 'p-landmark';
      let where;
      if (v === null || v === undefined) where = 'not reported (null)';
      else if (typeof v === 'string') where = G.SPECIAL_LABEL[v];
      else {
        const b = bars[G.binIndex(spec, v)];
        where = `${spec.scale === 'log10' ? num(v, 2) : v.toFixed(Math.max(2, spec.fmt + 1))}${UNIT(spec)}, in ${b.label}${b.kind === 'over' ? UNIT(spec) : ''}`;
      }
      p.innerHTML = `<span class="swatch" aria-hidden="true"></span>${esc(l.name)}: ${esc(where)}`;
      fig.appendChild(p);
    }
    const note = document.createElement('p');
    note.className = 'p-note';
    note.setAttribute('aria-live', 'polite');
    const refNote = REF_NOTES[spec.key] ? REF_NOTES[spec.key]() : '';
    note.dataset.base = refNote;
    note.innerHTML = refNote || (refused ? '' : 'Hover, tap or focus the chart and use the arrow keys to read a bar.');
    if (note.innerHTML) fig.appendChild(note);
    if (opts && opts.extraNote) {
      const x = document.createElement('p');
      x.className = 'p-note';
      x.innerHTML = opts.extraNote;
      fig.appendChild(x);
    }
    fig._draw = refused ? () => {} : () => drawHistogram(holder, spec, S, note);
    return fig;
  }

  // Round tick values inside [lo, hi]: decades on a log axis, a 1-2-5 step on a linear one.
  function axisTicks(spec, most) {
    const out = [];
    if (spec.scale === 'log10') {
      const span = spec.hi - spec.lo;
      const step = Math.max(1, Math.ceil(span / most));
      for (let v = Math.ceil(spec.lo); v <= spec.hi + 1e-9; v += step) out.push(v);
      return out;
    }
    const span = spec.hi - spec.lo;
    const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 30, 45, 50, 60, 90];
    const step = steps.find((st) => span / st <= most) || span;
    for (let v = Math.ceil(spec.lo / step - 1e-9) * step; v <= spec.hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
    return out;
  }

  function drawHistogram(holder, spec, S, note) {
    const bars = G.bars(spec);
    const bins = bars.filter((b) => b.kind === 'bin');
    const dense = S.h[spec.key];
    const W = Math.max(240, Math.floor(holder.clientWidth || 300));
    const H = 150;
    const m = { l: 40, r: 8, t: 10, b: 24 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const counts = bins.map((b) => dense[b.idx]);
    const tr = (c) => (state.log ? Math.log10(1 + c) : c);
    const max = Math.max(1, ...counts.map(tr));
    const bw = pw / bins.length;
    const xOf = (edge) => m.l + ((edge - spec.lo) / (spec.hi - spec.lo)) * pw;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${spec.label}: histogram of ${fmt(S.n)} bodies; use the arrow keys to read each bar`);
    let html = '';
    // y gridlines: counts 0, half and max (linear) or 0, 10, 100, ... (log of 1 + count)
    const maxCount = Math.max(0, ...counts);
    const yCounts = [...new Set(state.log ? [0, 10, 100, 1000, 10000].filter((c) => c <= maxCount) : [0, Math.round(maxCount / 2), maxCount])];
    if (yCounts.length === 1 && maxCount > 0) yCounts.push(maxCount);
    for (const c of yCounts) {
      const y = m.t + ph - (tr(c) / max) * ph;
      html += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${m.l - 4}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmt(c)}</text>`;
    }
    html += `<rect class="cursor" x="0" y="${m.t}" width="0" height="${ph}" visibility="hidden"/>`;
    bins.forEach((b, k) => {
      const c = counts[k];
      if (!c) return;
      const h = Math.max(1, (tr(c) / max) * ph);
      html += `<rect class="bar" x="${(m.l + k * bw + 0.15).toFixed(2)}" y="${(m.t + ph - h).toFixed(2)}" width="${Math.max(0.6, bw - 0.3).toFixed(2)}" height="${h.toFixed(2)}"/>`;
    });
    html += `<line class="axis" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
    // x ticks: integer specs label each bar at its centre; others at round values of the axis
    if (spec.integer) {
      bins.forEach((b, k) => {
        html += `<text x="${(m.l + (k + 0.5) * bw).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(String(b.lo))}</text>`;
      });
    } else {
      for (const v of axisTicks(spec, W < 360 ? 4 : 6)) {
        const x = xOf(v);
        html += `<line class="axis" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 3}"/><text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(G.fmtEdge(spec, v))}</text>`;
      }
    }
    for (const r of REFS[spec.key] || []) {
      if (r.x <= spec.lo || r.x >= spec.hi) continue;
      const x = xOf(r.x);
      html += `<line class="ref" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t}" y2="${m.t + ph}" stroke-dasharray="3 3"/><text class="ref-text" x="${(x + 3).toFixed(1)}" y="${m.t + 9}">${esc(r.label)}</text>`;
    }
    const l = landmark();
    if (l) {
      const v = landmarkValue(spec, l);
      if (typeof v === 'number' && (v !== 0 || spec.scale !== 'log10')) {
        const xv = spec.scale === 'log10' ? Math.log10(v) : v;
        if (xv >= spec.lo && xv < spec.hi) {
          const x = xOf(xv);
          html += `<line class="lm" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t + 4}" y2="${m.t + ph}"/><circle class="lm-dot" cx="${x.toFixed(1)}" cy="${m.t + 4}" r="4"/>`;
        }
      }
    }
    html += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph + m.b}"/>`;
    svg.innerHTML = html;
    holder.innerHTML = '';
    holder.appendChild(svg);
    const cursor = svg.querySelector('.cursor');
    let cur = -1;
    const read = (k, ev) => {
      cur = Math.max(0, Math.min(bins.length - 1, k));
      const b = bins[cur];
      const c = counts[cur];
      cursor.setAttribute('x', (m.l + cur * bw).toFixed(2));
      cursor.setAttribute('width', Math.max(1, bw).toFixed(2));
      cursor.setAttribute('visibility', 'visible');
      const text = `${b.label}${UNIT(spec)}: ${fmt(c)} bodies (${pct(c, S.n)} of ${fmt(S.n)})`;
      note.textContent = text;
      if (ev) showTip(esc(text), ev.clientX, ev.clientY);
    };
    const kFromEvent = (ev) => {
      const rect = svg.getBoundingClientRect();
      return Math.floor((ev.clientX - rect.left - m.l) / bw);
    };
    svg.addEventListener('pointermove', (ev) => read(kFromEvent(ev), ev));
    svg.addEventListener('pointerdown', (ev) => read(kFromEvent(ev), ev));
    svg.addEventListener('pointerleave', () => {
      hideTip();
    });
    svg.addEventListener('keydown', (ev) => {
      const map = { ArrowLeft: -1, ArrowRight: 1 };
      if (ev.key in map) read(cur < 0 ? 0 : cur + map[ev.key]);
      else if (ev.key === 'Home') read(0);
      else if (ev.key === 'End') read(bins.length - 1);
      else return;
      ev.preventDefault();
    });
    svg.addEventListener('blur', () => {
      cursor.setAttribute('visibility', 'hidden');
      note.innerHTML = note.dataset.base || '';
    });
  }

  // ---------------------------------------------------------------- categorical panels
  const CAT_NOTES = {
    cls: () => {
      const cc = D.oracle.aster.classCross;
      const jf = D.sbdbClasses.classes;
      return `Aster upper-cases SBDB's class code on ingestion (${cite(D.quotes.classUpper)}–${D.quotes.classUpper.line + 1}). SBDB keeps JFc ("${esc(jf.JFc.description)}") apart from JFC ("${esc(jf.JFC.description)}"), and ETc ("${esc(jf.ETc.description)}") has no upper-case twin. Today SBDB gives the catalog's 166 JFC as JFc ${fmt(cc['JFC -> JFc'] || 0)} + JFC ${fmt(cc['JFC -> JFC'] || 0)}, and its ETC as ETc ${fmt(cc['ETC -> ETc'] || 0)} (${esc(D.oracle.path)}).`;
    },
    tier: () => `planning-tier: "${esc(D.quotes.planningReserved.text.replace(/^- /, ''))}"; "${esc(D.quotes.planningZero.text.replace(/^- /, ''))}" (${cite(D.quotes.planningZero)}).`,
    fid: () => `Slice 18's own rule for quoting L1: ${mdLine(D.quotes.s18L1Cite.text.replace(/^.*The full statement is /, ''))} (${cite(D.quotes.s18L1Cite)}). L1 here is joined per body from <code>docs/tier-sizing-per-body.json</code>.`,
    band: () => `Stored bands checked against e for every body: ${fmt(D.checks.bandMismatches)} mismatches.`,
    anchor: () => `Element epochs: ${fmt(D.epochs.common.n)} bodies at ${esc(D.epochs.common.date)} TDB; ${fmt(D.epochs.others.n)} at ${fmt(D.epochs.others.distinct)} other epochs from ${esc(D.epochs.others.minDate)} to ${esc(D.epochs.others.maxDate)}.`,
    des: () => 'From the record\'s name: numbered with a name (433 Eros), numbered without one, provisional only, or a comet designation.',
  };
  function catPanel(cat, S) {
    const fig = document.createElement('figure');
    fig.className = 'panel';
    fig.dataset.key = cat.key;
    const dense = S.h[cat.key];
    const rows = cat.cats.map((c, k) => {
      const n = dense[k];
      const w = S.n ? (100 * n) / S.n : 0;
      const label = cat.key === 'pha' ? (c ? 'PHA' : 'not PHA') : String(c);
      return `<div class="hrow"><span class="hl">${esc(label)}</span><span class="track"><span class="fill" style="width:${w.toFixed(2)}%"></span></span><span class="hv">${fmt(n)}<span class="pct">${pct(n, S.n)}</span></span></div>`;
    }).join('');
    const l = landmark();
    let lm = '';
    if (l) {
      const v = l.d[cat.key];
      lm = `<p class="p-landmark"><span class="swatch" aria-hidden="true"></span>${esc(l.name)}: ${esc(cat.key === 'pha' ? (v ? 'PHA' : 'not PHA') : String(v))}</p>`;
    }
    fig.innerHTML = `<figcaption><span class="p-title">${esc(cat.label)}</span><span class="p-meta">n ${fmt(S.n)}</span></figcaption>${rows}${lm}${CAT_NOTES[cat.key] ? `<p class="p-note">${CAT_NOTES[cat.key]()}</p>` : ''}`;
    return fig;
  }

  // ---------------------------------------------------------------- the a-e grid
  const HEAT_EDGES = [1, 3, 10, 30, 100, 300, 1000];
  function heatColors() {
    const cs = getComputedStyle(document.documentElement);
    return [0, 1, 2, 3, 4, 5, 6].map((k) => cs.getPropertyValue(`--heat-${k}`).trim());
  }
  function heatIndex(c) {
    let k = -1;
    for (let j = 0; j < HEAT_EDGES.length; j++) if (c >= HEAT_EDGES[j]) k = j;
    return k;
  }
  let gridCursor = -1;
  function drawGrid(S) {
    const canvas = $('grid-canvas');
    const wrap = canvas.parentElement;
    const W = Math.max(260, Math.floor(wrap.clientWidth || 300));
    const H = Math.round(Math.min(420, Math.max(220, W * 0.5)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = { l: 34, r: 8, t: 8, b: 26 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const g = G.GRID;
    const cw = pw / g.cols;
    const chh = ph / g.rows;
    const colors = heatColors();
    const cs = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = cs.getPropertyValue('--surface-2').trim();
    ctx.fillRect(m.l, m.t, pw, ph);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const n = S.grid[r * g.cols + c];
        const k = heatIndex(n);
        if (k < 0) continue;
        ctx.fillStyle = colors[k];
        ctx.fillRect(m.l + c * cw, m.t + ph - (r + 1) * chh, Math.ceil(cw), Math.ceil(chh));
      }
    }
    const X = (a) => m.l + ((a - g.aLo) / (g.aHi - g.aLo)) * pw;
    const Y = (e) => m.t + ph - ((e - g.eLo) / (g.eHi - g.eLo)) * ph;
    ctx.strokeStyle = cs.getPropertyValue('--rule').trim();
    ctx.fillStyle = cs.getPropertyValue('--text-2').trim();
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.lineWidth = 1;
    // class boundaries as curves: q = a(1 - e), Q = a(1 + e)
    const curve = (fn, label, dash) => {
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      let last = null;
      for (let a = g.aLo + 0.005; a < g.aHi; a += 0.01) {
        const e = fn(a);
        if (!(e >= 0 && e < 1)) {
          started = false;
          continue;
        }
        if (!started) ctx.moveTo(X(a), Y(e));
        else ctx.lineTo(X(a), Y(e));
        started = true;
        last = [a, e];
      }
      ctx.stroke();
      ctx.setLineDash([]);
      return last;
    };
    const rule = C.classRule.value;
    curve((a) => 1 - rule.apoQ / a, '', [4, 3]);
    curve((a) => 1 - C.neoQ.value / a, '', [1, 3]);
    curve((a) => rule.ieoQ / a - 1, '', [4, 3]);
    curve((a) => C.jupiterCrossingQ.value / a - 1, '', [6, 2]);
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(X(rule.ateA), Y(0));
    ctx.lineTo(X(rule.ateA), Y(1));
    ctx.stroke();
    ctx.setLineDash([]);
    // labels for the curves, placed where each sits clearly inside the plot
    const lab = (txt, a, e) => {
      if (e > 0.02 && e < 0.98) ctx.fillText(txt, X(a) + 3, Y(e) - 3);
    };
    lab(`q ${rule.apoQ}`, 3.6, 1 - rule.apoQ / 3.6);
    lab(`q ${C.neoQ.value}`, 4.6, 1 - C.neoQ.value / 4.6);
    lab(`Q ${rule.ieoQ}`, 0.58, rule.ieoQ / 0.58 - 1);
    lab(`Q ${C.jupiterCrossingQ.value}`, 4.2, C.jupiterCrossingQ.value / 4.2 - 1);
    lab(`a ${rule.ateA}`, rule.ateA, 0.95);
    // axes
    ctx.strokeStyle = cs.getPropertyValue('--line-2').trim();
    ctx.beginPath();
    ctx.moveTo(m.l, m.t + ph);
    ctx.lineTo(m.l + pw, m.t + ph);
    ctx.moveTo(m.l, m.t);
    ctx.lineTo(m.l, m.t + ph);
    ctx.stroke();
    ctx.fillStyle = cs.getPropertyValue('--muted').trim();
    ctx.textAlign = 'center';
    for (let a = 0; a <= 6; a++) ctx.fillText(String(a), X(a), H - 12);
    ctx.fillText('a (AU)', m.l + pw / 2, H - 1);
    ctx.textAlign = 'right';
    for (let e = 0; e <= 1.0001; e += 0.2) ctx.fillText(e.toFixed(1), m.l - 4, Y(e) + 3.5);
    ctx.save();
    ctx.translate(9, m.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('e', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    // landmark
    const l = landmark();
    if (l && typeof l.d.a === 'number' && l.d.e < 1 && l.d.aAu >= g.aLo && l.d.aAu < g.aHi) {
      ctx.fillStyle = cs.getPropertyValue('--landmark').trim();
      ctx.strokeStyle = cs.getPropertyValue('--surface').trim();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(l.d.aAu), Y(l.d.e), 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    if (gridCursor >= 0) {
      const r = Math.floor(gridCursor / g.cols);
      const c = gridCursor % g.cols;
      ctx.strokeStyle = cs.getPropertyValue('--focus').trim();
      ctx.lineWidth = 2;
      ctx.strokeRect(m.l + c * cw, m.t + ph - (r + 1) * chh, cw, chh);
    }
    canvas._geom = { m, pw, ph, cw, chh, S };
  }
  function gridRead(idx, ev) {
    const canvas = $('grid-canvas');
    const geo = canvas._geom;
    const g = G.GRID;
    if (!geo || idx < 0 || idx >= g.cols * g.rows) return;
    gridCursor = idx;
    const r = Math.floor(idx / g.cols);
    const c = idx % g.cols;
    const n = geo.S.grid[idx];
    const text = `a ${g.aEdges[c].toFixed(1)}–${g.aEdges[c + 1].toFixed(1)} AU, e ${g.eEdges[r].toFixed(2)}–${g.eEdges[r + 1].toFixed(2)}: ${fmt(n)} bodies`;
    $('grid-note').textContent = text;
    if (ev) showTip(esc(text), ev.clientX, ev.clientY);
    drawGrid(geo.S);
  }
  function wireGrid() {
    const canvas = $('grid-canvas');
    const g = G.GRID;
    const idxFrom = (ev) => {
      const geo = canvas._geom;
      const rect = canvas.getBoundingClientRect();
      const c = Math.floor((ev.clientX - rect.left - geo.m.l) / geo.cw);
      const r = Math.floor((geo.m.t + geo.ph - (ev.clientY - rect.top)) / geo.chh);
      if (c < 0 || c >= g.cols || r < 0 || r >= g.rows) return -1;
      return r * g.cols + c;
    };
    canvas.addEventListener('pointermove', (ev) => {
      const k = idxFrom(ev);
      if (k >= 0) gridRead(k, ev);
      else hideTip();
    });
    canvas.addEventListener('pointerdown', (ev) => {
      const k = idxFrom(ev);
      if (k >= 0) gridRead(k, ev);
    });
    canvas.addEventListener('pointerleave', hideTip);
    canvas.addEventListener('keydown', (ev) => {
      const start = gridCursor < 0 ? 10 * g.cols + 14 : gridCursor;
      const r = Math.floor(start / g.cols);
      const c = start % g.cols;
      const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }[ev.key];
      if (!mv) return;
      ev.preventDefault();
      const nr = Math.max(0, Math.min(g.rows - 1, r + mv[0]));
      const nc = Math.max(0, Math.min(g.cols - 1, c + mv[1]));
      gridRead(nr * g.cols + nc);
    });
  }
  function gridLegend() {
    const colors = heatColors();
    $('grid-legend').innerHTML = '<span>bodies per cell:</span>' + HEAT_EDGES.map((e, k) => `<span><span class="sw" style="background:${colors[k]}"></span>${k + 1 < HEAT_EDGES.length ? `${fmt(e)}–${fmt(HEAT_EDGES[k + 1] - 1)}` : `≥ ${fmt(e)}`}</span>`).join('') + '<span>empty cells left blank</span>';
  }

  // ---------------------------------------------------------------- sections that do not depend on the selection
  function tableHtml(head, rows, numCols) {
    const nc = new Set(numCols || []);
    return `<div class="table-wrap"><table><thead><tr>${head.map((h, k) => `<th${nc.has(k) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${nc.has(k) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderStatic() {
    const S = G.summarize(D.atoms, {});
    const hdr = D.header.catalog;
    $('lede').innerHTML = `Every distribution Aster's committed NEA catalog fixture can show about itself: all <strong>${fmt(S.n)}</strong> records binned, with their nulls, the fields the catalog does not carry, and the places where its labels and its elements disagree. Tap a class, a tier or a Slice 18 tier and every panel re-counts from its own bins.`;
    $('identity').innerHTML = `This describes one file, not the near-Earth population: <code>${esc(D.source.inputs[0].path)}</code> at Aster <code>${esc(D.source.commit.slice(0, 7))}</code> (${esc(D.source.commitDate.slice(0, 10))}), selected from ${esc(D.header.selectionSource)}; elements of ${fmt(D.epochs.common.n)} bodies at ${esc(D.epochs.common.date)} TDB. The header's own totals (${fmt(hdr.totalBodies)} bodies, its class and tier distributions) are reconciled with the bins before they ship.`;

    // missing fields
    const nulls = Object.fromEntries(D.census.keyPaths.map((k) => [k.path, k]));
    // fields asked for by the same passages share one card
    const groups = [];
    for (const w of D.wanted) {
      const key = w.askedBy.join('|');
      const g = groups.find((x) => x.key === key);
      if (g) g.items.push(w);
      else groups.push({ key, items: [w] });
    }
    const wantedCards = groups.map((g) => {
      const names = g.items.map((w) => w.field);
      const asked = g.items[0].askedBy.map((k) => quote(D.quotes[k])).join('');
      const res = g.items.map((w) => `<code>/${esc(w.re)}/i</code>`).join(' or ');
      return `<div class="card" data-missing="${esc(names.join(', '))}"><h3>No ${esc(names.join(' and no '))} field</h3><p>None of the ${fmt(D.census.keyPaths.length)} key paths in the ${fmt(hdr.totalBodies)} records matches ${res}. Aster's own documents ask for ${names.length > 1 ? 'them' : 'it'}:</p>${asked}<p class="cite">A kernel that needs ${names.length > 1 ? 'them' : 'it'} must fetch ${names.length > 1 ? 'them' : 'it'}; nothing on this page imputes ${names.length > 1 ? 'them' : 'it'}.</p></div>`;
    });
    $('missing-intro').innerHTML = `Read from a census of every key path of every record (${fmt(D.census.keyPaths.length)} paths, all present in every record, ${fmt(D.census.keyPaths.filter((k) => k.nulls).length)} with nulls), not written by hand. The table below re-counts the nulls for the current selection.`;
    $('missing-cards').innerHTML = [
      `<div class="card" data-missing="G"><h3>G is null for all ${fmt(nulls.G.nulls)}</h3><p>The slope parameter is carried as a key and never filled.</p>${quote(D.quotes.gNull)}</div>`,
      `<div class="card" data-missing="albedo-assumed"><h3>Size is a formula of H, not a measurement</h3><p><code>estimatedRadiusM</code> is Aster's <code>${esc(C.radiusFormula.diameterLine.text)}</code> × ${fmt(C.radiusFormula.kmToRadiusM)} at the default albedo ${C.albedo.value} (${cite(C.albedo)}). Recomputed here for ${fmt(D.checks.radiusChecked)} records, it matches to a relative ${D.checks.radiusMaxRelErr.toExponential(1)}; the ${fmt(nulls.estimatedRadiusM.nulls)} with H null have no radius.</p>${quote(D.quotes.radiusNull)}</div>`,
    ].concat(wantedCards).join('');

    // disagreements
    const cc = D.classCheck;
    const recs = D.sbdbRecords.map((r) => {
      const rows = [
        ['orbit epoch', esc(r.sbdb.epochDate), esc(r.aster.epochDate)],
        ['observed', `${esc(r.sbdb.firstObs)} to ${esc(r.sbdb.lastObs)}`, `data arc ${esc(num(r.aster.dataArcDays, 0))} d`],
        ['SBDB: orbit not valid after', esc(r.sbdb.notValidAfter), '—'],
        ['Earth MOID', `${r.sbdb.moidAu} AU = ${fmt(r.sbdb.moidKm)} km`, '—'],
        ['q (AU)', String(r.sbdb.q), r.aster.q.toFixed(3)],
        ['a (AU), e', `${r.sbdb.a}, ${r.sbdb.e}`, `${r.aster.aAu.toFixed(3)}, ${r.aster.e.toFixed(3)}`],
        ['class', `${esc(r.sbdb.orbitClass)}`, `stored ${esc(r.aster.orbitClass)}; elements say ${esc(r.aster.classFromElements)}`],
        ['T_J (ecliptic)', String(r.sbdb.tJup), r.aster.TJe.toFixed(3)],
        ['Slice 18 tier', '—', `${esc(r.aster.fid)} (${esc(r.aster.tierReason)}, ${esc(r.aster.tierClassification)})`],
      ];
      return `<div class="card" data-sbdb="${esc(r.des)}"><h3>${esc(r.des)}: re-anchored past the end of its own orbit</h3>${tableHtml(['', 'JPL SBDB record', 'Aster catalog'], rows)}<p>SBDB's Earth MOID (${fmt(r.sbdb.moidKm)} km) is ${r.moidBelowEarthRadius ? 'smaller' : 'not smaller'} than Aster's Earth radius (${C.earthRadiusKm.value} km, ${cite(C.earthRadiusKm)}), and SBDB marks the orbit invalid after ${esc(r.sbdb.notValidAfter)}. The catalog carries the body at ${esc(r.aster.epochDate)} on a re-anchored orbit with q ${r.aster.q.toFixed(2)} AU.</p><p class="cite">${esc(r.file)} (SBDB API, retrieved 2026-11-02). Why the re-anchor produced this orbit is not shown here [Speculative: propagated through the encounter; Aster's re-anchor was not run].</p></div>`;
    }).join('');
    const disRows = cc.disagreements.map((r) => [esc(r.des), esc(r.stored), esc(r.fromElements), r.a.toFixed(3), r.q.toFixed(3), r.Q.toFixed(3), r.margin.toFixed(3), esc(r.fid)]);
    const tj = D.tjLow;
    const o = D.oracle;
    const conv = o.conventions.map((c) => [esc(c.name), `${fmt(c.reproduced)} of ${fmt(c.of)}`, c.maxAbsDiff.toFixed(4)]);
    const anch = Object.entries(o.aster.byAnchor).map(([k, g]) => [esc(k), fmt(g.n), g.ecliptic.median.toFixed(4), g.ecliptic.p99.toFixed(3), fmt(g.ecliptic.over001), g.jupiterPlane.median.toFixed(4)]);
    $('disagree-intro').innerHTML = `The catalog stores labels next to the elements they were derived from. Re-deriving them here with Aster's own rules shows where the two have come apart. The class rule is Aster's (${cite(C.classRule.lines[0])}–${C.classRule.lines[2].line}), with the same thresholds as JPL's class table (${esc(D.sbdbClasses.path)}:${D.sbdbClasses.classes.IEO.line}–${D.sbdbClasses.classes.AMO.line}).`;
    $('disagree').innerHTML =
      `<div class="cards">${recs}</div>` +
      `<h3>Stored orbitClass against Aster's class rule on the stored elements</h3><p>${fmt(cc.disagreements.length)} bodies disagree, all ${Object.entries(cc.byAnchor).map(([k, v]) => `${fmt(v)} ${esc(k)}`).join(', ')}; ${fmt(cc.disagreements.filter((x) => x.margin < 0.1).length)} of them sit within 0.1 AU of a class threshold. Aster's own diagnostic of the re-anchor listed the derived fields it did not recompute:</p>${quote(D.quotes.reanchorNotList)}<p>The fix, <code>recomputeDerivedFields</code> (${cite(D.quotes.recomputeFn)}), called from <code>applyReanchor</code> (${cite(D.quotes.applyReanchor)}), recomputes those three. orbitClass is in neither list, so a re-anchored body keeps the class SBDB gave its old elements.</p>` +
      `<details class="census"><summary>All ${fmt(cc.disagreements.length)}, furthest from a threshold first</summary><div class="list-scroll">${tableHtml(['body', 'stored', 'elements say', 'a', 'q', 'Q', 'AU from threshold', 'S18'], disRows, [3, 4, 5, 6])}</div></details>` +
      `<h3>NEA-class bodies with q ≥ ${C.neoQ.value} AU</h3><p>${fmt(cc.qAtLeast13.length)} bodies in an NEA class sit at or past the NEO perihelion bound on their stored elements: ${cc.qAtLeast13.map((x) => `${esc(x.des)} (${x.q.toFixed(4)})`).join(', ')}.</p>` +
      `<h3>The Tisserand parameter against JPL's own</h3><p>JPL's SBDB publishes T_J (<code>t_jup</code>) for every NEO. From SBDB's own a, e, i (${fmt(o.source.rows)} rows, retrieved ${esc(o.source.retrieved)}), the two conventions this page can draw reproduce it as follows (to ±${o.rounding}, SBDB's printed rounding), at this page's a_J = ${D.jupiter.aAu.toFixed(5)} AU:</p>${tableHtml(['inclination measured from', 'rows reproduced', 'max |diff|'], conv, [1, 2])}<p>So SBDB uses the ecliptic inclination; every row reproduces exactly at a_J ${o.eclipticAJInterval.lo}–${o.eclipticAJInterval.hi} AU, ${(D.jupiter.aAu - o.eclipticAJInterval.lo).toExponential(1)} AU below the vis-viva a_J here. Against the catalog's own elements (at 2026-05-01, while SBDB's sit at their own epochs), by anchor source:</p>${tableHtml(['anchorSource', 'bodies', 'median |diff| (ecliptic)', 'p99', 'over 0.01', 'median |diff| (Jupiter plane)'], anch, [1, 2, 3, 4, 5])}<p class="cite">${esc(o.path)}; ${fmt(o.aster.unmatched)} catalog designations are not in today's SBDB NEO list under the same designation (renumbered or no longer NEOs; not followed up).</p>` +
      `<h3>NEA-class bodies with a comet-like T_J (&lt; 2)</h3><p>${fmt(tj.filter((t) => t.TJ < 2).length)} bodies in an NEA class have T_J &lt; 2 measured from Jupiter's plane, ${fmt(tj.filter((t) => t.TJe < 2).length)} measured from the ecliptic.</p><details class="census"><summary>The list</summary>${tableHtml(['body', 'class', 'T_J (Jupiter plane)', 'T_J (ecliptic)', 'a', 'e', 'i°', 'S18'], tj.map((t) => [esc(t.des), esc(t.cls), t.TJ.toFixed(2), t.TJe.toFixed(2), t.a.toFixed(2), t.e.toFixed(3), t.i.toFixed(1), esc(t.fid)]), [2, 3, 4, 5, 6])}</details>`;

    // pre-research report
    const P = D.prereport;
    const uRows = P.u.rows.map((r) => {
      const ours = P.ours.u[r.key];
      return [esc(r.key), fmt(r.count), fmt(ours), `${ours - r.count >= 0 ? '+' : ''}${fmt(ours - r.count)}`];
    });
    const arcRows = P.arc.rows.map((r) => {
      const ours = r.key === 'missing' ? P.ours.arcMissing : P.ours.arcLeftClosed.find((x) => x.key === r.key).count;
      const right = r.key === 'missing' ? P.ours.arcMissing : P.ours.arcRightClosed.find((x) => x.key === r.key).count;
      return [esc(r.key), fmt(r.count), fmt(ours), `${ours - r.count >= 0 ? '+' : ''}${fmt(ours - r.count)}`, `${right - r.count >= 0 ? '+' : ''}${fmt(right - r.count)}`];
    });
    $('prereport-intro').innerHTML = `Slice 9's pre-research report prints condition-code and data-arc tables as text from an earlier SBDB pull. Recounted on the committed fixture (${fmt(hdr.totalBodies)} bodies) with the report's own buckets:`;
    $('prereport').innerHTML = quote(D.quotes.prereportCount) +
      `<div class="cards two"><div class="card"><h3>Condition code U</h3>${tableHtml(['U', `report :${P.u.headingLine}`, 'fixture', 'diff'], uRows, [1, 2, 3])}</div>` +
      `<div class="card"><h3>Data arc</h3>${tableHtml(['bucket', `report :${P.arc.headingLine}`, 'fixture [lo, hi)', 'diff', 'diff if (lo, hi]'], arcRows, [1, 2, 3, 4])}<p class="p-note">The report does not say which end of a bucket is closed. Read as [lo, hi) the fixture differs only by additions; read as (lo, hi] it would have lost bodies from 7–30 d, which a later pull of a growing list should not.</p></div></div>` +
      `<p>The fixture has every body the report counted and ${fmt(hdr.totalBodies - Number(/`([\d,]+)`/.exec(D.quotes.prereportCount.text)[1].replace(/,/g, '')))} more; quote the fixture's numbers, not the report's.</p>`;

    // landmarks
    $('landmarks-intro').innerHTML = `Eleven records copied verbatim (<code>snapshots/landmarks.json</code>): the six bodies Aster's boundary test spot-checks, the oldest element epoch (3D/Biela), and four this guide flags. Pick one to mark it on every panel.`;
    $('landmark-cards').innerHTML = LM.map((l) => {
      const d = l.d;
      const r = l.record;
      const kv = [
        ['class', `${esc(r.orbitClass)}${C.neaClasses.value.includes(r.orbitClass) && d.classFromElements && d.classFromElements !== r.orbitClass ? ` (elements say ${esc(d.classFromElements)})` : ''}`],
        ['tiers', `${esc(r.inv014Tier)} · Slice 18 ${esc(l.shipped.fid)} (${esc(l.shipped.tierReason)})`],
        ['a, e, i', `${typeof d.a === 'number' ? d.aAu.toFixed(3) : `${d.aAu.toFixed(3)} (hyperbolic)`} AU, ${d.e.toFixed(4)}, ${d.i.toFixed(2)}°`],
        ['q, Q', `${d.q.toFixed(3)}, ${typeof d.Q === 'number' ? `${d.Q.toFixed(3)} AU` : 'undefined'}`],
        ['T_J', `${d.TJ.toFixed(3)} (Jupiter plane), ${d.TJe.toFixed(3)} (ecliptic)`],
        ['H, radius', `${num(r.H, 2)}, ${r.estimatedRadiusM === null ? 'null' : `${r.estimatedRadiusM < 100 ? Number(r.estimatedRadiusM.toPrecision(3)) : fmt(r.estimatedRadiusM)} m at albedo ${C.albedo.value}`}`],
        ['U, arc, obs', `${num(r.conditionCode, 0)}, ${r.dataArcDays === null ? 'null' : `${fmt(r.dataArcDays)} d`}, ${num(r.nObsUsed, 0)}`],
        ['anchor, epoch', `${esc(r.anchorSource)}, JD ${r.elements.epochTdbJd}`],
      ];
      return `<div class="card" data-landmark="${esc(l.des)}"><h3>${esc(l.name)}</h3><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><button type="button" class="seg lm-pick" data-des="${esc(l.des)}" aria-pressed="false">Mark on the panels</button></div>`;
    }).join('');
    $('landmark-cards').querySelectorAll('.lm-pick').forEach((b) => {
      b.addEventListener('click', () => {
        state.lm = state.lm === b.dataset.des ? '' : b.dataset.des;
        render();
        if (state.lm) document.getElementById('h-orbits').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    const select = $('landmark');
    LM.forEach((l) => {
      const opt = document.createElement('option');
      opt.value = l.des;
      opt.textContent = l.name;
      select.appendChild(opt);
    });

    // provenance
    const j = D.jupiter;
    const hz = j.horizons;
    const consts = [
      ['AU', `${C.auKm.value} km`, cite(C.auKm), 'Aster\'s core has no AU constant; the Slice 18 tool whose tiers are reconciled here carries this one'],
      ['GM_sun', `${C.gmSunKm3s2.value} km³/s²`, cite(C.gmSunKm3s2), 'GM_SUN_M3_S2 / 1e9'],
      ['GM_Jupiter', `${C.gmJupiterKm3s2.value} km³/s²`, cite(C.gmJupiterKm3s2), 'for the Sun–Jupiter two-body μ'],
      ['obliquity', `${C.obliquityRad.arcsec}″`, cite(C.obliquityRad), 'ICRF to ecliptic'],
      ['albedo', String(C.albedo.value), cite(C.albedo), 'radius from H'],
      ['band edges', C.bands.value.join(', '), cite(C.bands.lines[0]), 'eccentricityBand'],
      ['class rule', `Q < ${C.classRule.value.ieoQ}, a < ${C.classRule.value.ateA}, q < ${C.classRule.value.apoQ}`, cite(C.classRule.lines[0]), 'IEO / ATE / APO / AMO'],
      ['Jupiter-crossing Q', `${C.jupiterCrossingQ.value} AU`, cite(C.jupiterCrossingQ), 'Slice 18'],
      ['NEO q bound', `${C.neoQ.value} AU`, cite(C.neoQ), 'a literature note, not an Aster constant'],
      ['Earth radius', `${C.earthRadiusKm.value} km`, cite(C.earthRadiusKm), 'radiusM / 1000'],
    ].map((r) => [r[0], r[1], r[2], esc(r[3])]);
    const inputs = D.source.inputs.map((i) => [`<code>${esc(i.path)}</code>`, fmt(i.bytes), `<code>${esc(i.sha256.slice(0, 16))}…</code>`, i.committedBlob === i.readBlob ? 'committed blob' : '<strong>working copy differs</strong>']);
    $('provenance').innerHTML =
      `<p>Aster <code>${esc(D.source.commit)}</code> (${esc(D.source.commitDate)}). Inputs read by <code>build-data.mjs</code>, each with its sha256; a re-run of <code>build-data.mjs --check</code> reproduces <code>snapshots/bins.data.js</code> byte for byte.</p>${tableHtml(['file', 'bytes', 'sha256', 'read'], inputs, [1])}` +
      `<h3>Constants, each read from its source line</h3>${tableHtml(['constant', 'value', 'source', 'use'], consts)}` +
      `<h3>Jupiter for T_J</h3><p>a_J = ${j.aAu.toFixed(5)} AU by vis-viva from Jupiter's heliocentric state at ${esc(j.date)} TDB in <code>tests/fixtures/v2/horizons-jupiter-system-90d.json</code>, with μ = GM_sun + GM_Jupiter (GM_sun alone gives ${j.aAuSunOnly.toFixed(4)}; over the 90-day file a_J runs ${j.aAuRange90d.map((x) => x.toFixed(4)).join('–')}). Jupiter's orbit is inclined ${j.inclEclDeg.toFixed(3)}° to the ecliptic, which is why the two T_J conventions differ by up to ${D.checks.tjEclipticMaxShift.toFixed(3)} (${fmt(D.checks.tjEclipticCross3)} bodies change side of T_J = 3). Checked against Horizons' own osculating elements for the same instant (<code>${esc(hz.path)}</code>): with Horizons' GM the routine here gives a ${hz.oursWithHorizonsGm.aAu.toFixed(7)} AU, e ${hz.oursWithHorizonsGm.e.toFixed(8)}, i ${hz.oursWithHorizonsGm.iDeg.toFixed(6)}°, Horizons prints ${hz.published.aAu.toFixed(7)}, ${hz.published.e.toFixed(8)}, ${hz.published.iDeg.toFixed(6)}°.</p>` +
      `<h3>What this is</h3><p>An Aster Idea Bank prototype. Refusals here use Aster's MCP refusal codes:</p>${quote(D.quotes.refusalCodes)}<p>Condition code is shown only as the raw ordinal, as Slice 18 rules:</p>${quote(D.quotes.dec182)}`;
  }

  // ---------------------------------------------------------------- the selection-dependent sections
  const GROUPS = [
    ['panels-orbits', ['a', 'e', 'i', 'q', 'Q', 'TJ']],
    ['panels-size', ['H', 'r']],
    ['panels-quality', ['U', 'arc', 'nObs', 'sigmaA']],
  ];
  const DATA_SECTIONS = ['sec-missing', 'h-orbits', 'h-size', 'h-quality', 'h-labels'];
  let drawn = [];

  function tjToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'tool';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Inclination measured from');
    wrap.innerHTML = `<span class="tool-label">i measured from</span><span class="seg-pair"><button type="button" class="seg" data-tj="TJ" aria-pressed="${state.tj === 'TJ'}">Jupiter's plane</button><button type="button" class="seg" data-tj="TJe" aria-pressed="${state.tj === 'TJe'}">ecliptic (SBDB)</button></span>`;
    wrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.tj = b.dataset.tj;
      render();
    }));
    return wrap;
  }

  function selectionText(S) {
    const parts = [];
    if (state.cls !== null) parts.push(Array.isArray(state.cls) ? `orbitClass in {${state.cls.join(', ')}}` : `orbitClass ${state.cls}`);
    if (state.tier !== null) parts.push(`inv014Tier ${state.tier}`);
    if (state.fid !== null) parts.push(`Slice 18 tier ${state.fid}`);
    return `<strong>${fmt(S.n)}</strong> of ${fmt(D.header.catalog.totalBodies)} bodies${parts.length ? ` with ${parts.join(', ')}` : ' (the whole fixture)'}.`;
  }

  function render() {
    writeHash();
    updateChips();
    $('scale-lin').setAttribute('aria-pressed', String(!state.log));
    $('scale-log').setAttribute('aria-pressed', String(state.log));
    $('landmark').value = state.lm;
    document.querySelectorAll('.lm-pick').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.des === state.lm)));
    const S = G.summarize(D.atoms, sel());
    $('selection').innerHTML = selectionText(S);
    const empty = S.n === 0;
    for (const id of DATA_SECTIONS) {
      const el = $(id).closest('section');
      el.hidden = empty;
    }
    if (empty) {
      const q = state.tier === 'planning-tier' ? quote(D.quotes.planningReserved) + quote(D.quotes.planningZero) : '';
      $('empty-root').innerHTML = refusalHtml('insufficient_data', 'No body in the committed fixture matches this selection', `the bins hold 0 bodies for ${esc(selectionText(S).replace(/<[^>]+>/g, '').replace(/^0 of [\d,]+ bodies with /, '').replace(/\.$/, ''))}; there is no distribution to draw, so no panel is drawn.`, 'Widen a filter (tap All on one row). The chip counts show how many bodies each choice would hold.', q);
      for (const id of ['panels-orbits', 'panels-size', 'panels-quality', 'panels-labels', 'census-table']) $(id).innerHTML = '';
      drawn = [];
      return;
    }
    $('empty-root').innerHTML = '';

    // missing: census table for the selection
    const census = D.census.keyPaths.map((k) => {
      const n = S.nulls[k.path] || 0;
      return { path: k.path, present: S.present[k.path] || 0, nulls: n };
    });
    $('census-summary').textContent = `Every key path, with its nulls in this selection (${fmt(S.n)} bodies)`;
    $('census-table').innerHTML = `<thead><tr><th>key path</th><th class="num">present</th><th class="num">null</th><th class="num">null share</th></tr></thead><tbody>${census.map((r) => `<tr class="${r.nulls ? 'has-null' : ''}"><td><code>${esc(r.path)}</code></td><td class="num">${fmt(r.present)}</td><td class="num">${fmt(r.nulls)}</td><td class="num">${pct(r.nulls, r.present)}</td></tr>`).join('')}</tbody>`;

    drawn = [];
    for (const [rootId, keys] of GROUPS) {
      const root = $(rootId);
      root.innerHTML = '';
      for (const key of keys) {
        const k = key === 'TJ' ? state.tj : key;
        const spec = G.SPECS.find((s) => s.key === k);
        const fig = histogramPanel(spec, S, key === 'TJ' ? { toggle: tjToggle(), extraNote: `Measured from Jupiter's plane, ${fmt(D.checks.tjEclipticCross3)} bodies sit on the other side of T_J = 3 than measured from the ecliptic. JPL's SBDB uses the ecliptic (see "Where the labels and the elements disagree").` } : key === 'U' ? { extraNote: `The raw MPC ordinal, never converted to kilometres (DEC-18-2, ${cite(D.quotes.dec182)}).` } : key === 'r' ? { extraNote: `Under the assumed albedo ${C.albedo.value}; not a measured size.` } : null);
        root.appendChild(fig);
        drawn.push(fig);
      }
    }
    const lab = $('panels-labels');
    lab.innerHTML = '';
    for (const cat of G.CATS) lab.appendChild(catPanel(cat, S));

    // grid
    const onGrid = G.sum(S.grid);
    $('grid-meta').textContent = `${fmt(onGrid)} of ${fmt(S.n)} bodies on the grid (a 0–6 AU by 0.1, e 0–1 by 0.02); ${fmt(S.n - onGrid)} off it (a ≥ 6 AU or hyperbolic)`;
    $('grid-note').innerHTML = `Dashed: q = ${C.classRule.value.apoQ} and Q = ${C.classRule.value.ieoQ} AU and a = ${C.classRule.value.ateA} AU (Aster's class rule); dotted: q = ${C.neoQ.value} AU; long dash: Q = ${C.jupiterCrossingQ.value} AU (Slice 18's Jupiter-crossing line). Hover, tap or focus and use the arrow keys to read a cell.`;
    // No selection the chips can make leaves the grid empty today; refuse rather than draw an empty
    // plane if a re-derived catalog ever does.
    $('grid-canvas').hidden = onGrid === 0;
    $('grid-legend').hidden = onGrid === 0;
    if (onGrid === 0) $('grid-note').innerHTML = refusalHtml('insufficient_data', 'No body in this selection lies on the grid', `all ${fmt(S.n)} have a ≥ 6 AU or a hyperbolic orbit (see the semi-major axis panel's bars beyond the axis).`, 'Widen the selection (tap All on a row).', '', 'note');
    gridCursor = -1;
    $('orbits-intro').innerHTML = `Semi-major axis from <code>elements.aKm</code> with the AU from ${cite(C.auKm)}; q and Q from a and e; inclination is to the ecliptic as stored. Hyperbolic orbits and undefined aphelia get their own bars.`;
    draw();
  }

  function draw() {
    for (const fig of drawn) fig._draw();
    const S = G.summarize(D.atoms, sel());
    if (S.n && G.sum(S.grid)) drawGrid(S);
  }

  // ---------------------------------------------------------------- boot
  readHash();
  chipRow('f-cls', CLASS_CHIPS, 'cls');
  chipRow('f-tier', TIER_CHIPS, 'tier');
  chipRow('f-fid', FID_CHIPS, 'fid');
  renderStatic();
  gridLegend();
  wireGrid();
  $('landmark').addEventListener('change', (ev) => {
    state.lm = ev.target.value;
    render();
  });
  $('scale-lin').addEventListener('click', () => {
    state.log = false;
    render();
  });
  $('scale-log').addEventListener('click', () => {
    state.log = true;
    render();
  });
  $('guide').hidden = false;
  render();
  let lastW = window.innerWidth;
  let t = null;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(draw, 120);
  });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const redo = () => {
      gridLegend();
      draw();
    };
    if (mq.addEventListener) mq.addEventListener('change', redo);
  }
})();
