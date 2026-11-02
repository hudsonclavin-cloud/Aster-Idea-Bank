// Twenty Percent Line: the page. Everything numeric comes from model.js applied to page-data.js
// (the Skyhook snapshots); this file only lays it out. No storage, no network.
(function () {
  'use strict';
  const M = window.TwentyPercentLine;
  const D = window.TPL_DATA;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  // ---- formatting -------------------------------------------------------------------------------
  const nf = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  function sci(x, d) {
    const e = Math.floor(Math.log10(x));
    const sup = String(e).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] || c).join('');
    return `${(x / 10 ** e).toFixed(d)} × 10${sup}`;
  }
  const fx = (r) => (r >= 1e6 ? `${sci(r, 2)}×` : `${nf(r, 2)}×`);
  const ft = (t) => (t >= 1e6 ? `${sci(t, 2)} t` : `${nf(t, 1)} t`);
  const fpct = (f, d) => {
    const s = (f * 100).toFixed(d == null ? 1 : d);
    return `${d == null ? s.replace(/\.0$/, '') : s} %`;
  };
  const fkm = (km) => `${nf(km, km >= 10 || km === 0 ? 0 : 1)} km`;
  const signed = (x, fmt) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x))}`;
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---- colour: OKLab interpolation for the diverging strip -------------------------------------
  function hexToLin(h) {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
  }
  function linToHex(rgb) {
    return `#${rgb.map((x) => {
      const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    }).join('')}`;
  }
  function toLab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromLab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  let pal = null;
  function readPalette() {
    pal = {
      lo: toLab(hexToLin(css('--div-lo'))),
      mid: toLab(hexToLin(css('--div-mid'))),
      hi: toLab(hexToLin(css('--div-hi'))),
      none: css('--s-none'),
      every: css('--s-every'),
      between: css('--s-between'),
      surface: css('--surface'),
    };
  }
  const RED_SPAN = 0.1; // the red arm saturates ten points of break above the cap (a display choice)
  function divColor(frac, cap) {
    let t;
    let pole;
    if (frac <= cap) { t = Math.min(1, (cap - frac) / cap); pole = pal.lo; } else { t = Math.min(1, (frac - cap) / RED_SPAN); pole = pal.hi; }
    const c = pal.mid.map((v, i) => v + (pole[i] - v) * t);
    return linToHex(fromLab(c));
  }

  // ---- state ------------------------------------------------------------------------------------
  const R = M.readInputs(D);
  const I = R.inputs;
  const state = { tierKey: null, pKm: 0, where: 'tip', mode: 'none', fs: null, cap: null, beta: 0, hmpe: 'sk99', custom: { sigmaGPa: '', rho: '' } };
  const MODE_NAME = { none: 'canon rule, no cap', every: 'cap on every load', between: 'cap between catches' };
  const LINE = (file, n) => `${file}:${n}`;
  const short = I && I.commit ? String(I.commit).slice(0, 7) : '?';

  function setRadio(group, attr, value) {
    for (const b of $(group).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === value));
  }
  function wireRadios(group, attr, onPick) {
    const btns = [...$(group).querySelectorAll('button')];
    btns.forEach((b, i) => {
      b.addEventListener('click', () => onPick(b.dataset[attr]));
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const nb = btns[(i + d + btns.length) % btns.length];
        nb.focus();
        onPick(nb.dataset[attr]);
      });
    });
  }

  // ---- refusal rendering --------------------------------------------------------------------------
  function showRefusal(box, r) {
    box.hidden = false;
    box.replaceChildren(el('p', { class: 'code' }, r.code), el('p', {}, r.reason), el('p', { class: 'hint' }, `What would help: ${r.what_would_help}`));
  }

  // ---- init -------------------------------------------------------------------------------------
  function init() {
    readPalette();
    if (!R.ok) {
      $('canon-line').textContent = 'No canon file, no numbers.';
      const n = $('notice');
      n.hidden = false;
      n.replaceChildren(el('strong', {}, 'No canon file, no numbers. '), el('span', {}, 'The page computes nothing it cannot trace.'));
      const ul = el('ul');
      for (const r of R.refusals) ul.append(el('li', {}, `${r.code}: ${r.reason} What would help: ${r.what_would_help}`));
      n.append(ul);
      for (const c of $('controls').querySelectorAll('button, input, select')) c.disabled = true;
      $('sentence').textContent = 'No canon file, no numbers.';
      showRefusal($('refusal'), R.refusals[0]);
      for (const id of ['strip-card', 'chart-card', 'where-card', 'item10-card']) $(id).hidden = true;
      renderLimits();
      renderSources();
      return;
    }
    const prov = D.revAProvenance || {};
    $('canon-line').textContent = `Canon: params/rev_a.json @ ${short}${prov.sourceSha256 ? ` (sha256 ${prov.sourceSha256.slice(0, 8)}…)` : ''}. Lines quoted from Skyhook docs @ ${String(D.linesCommit || '').slice(0, 7)}. HMPE density from docs/project_instructions.md:67, not canon.`;
    const partial = R.refusals;
    if (partial.length) {
      const n = $('notice');
      n.hidden = false;
      n.replaceChildren(el('strong', {}, 'Some inputs did not load; the parts that need them refuse.'));
      const ul = el('ul');
      for (const r of partial) ul.append(el('li', {}, `${r.code}: ${r.reason} What would help: ${r.what_would_help}`));
      n.append(ul);
    }

    // tiers
    const tiers = $('tiers');
    for (const t of I.tiers) {
      const b = el('button', { type: 'button', role: 'radio', 'data-tier': t.key, 'aria-checked': 'false' }, `${nf(t.vkms, 2)} km/s · ${t.label.split(' · ')[0]}`);
      b.title = `${t.label} (${t.src})`;
      tiers.append(b);
    }
    state.tierKey = I.tiers[0].key;
    wireRadios('tiers', 'tier', (k) => { state.tierKey = k; render(); });
    wireRadios('modes', 'mode', (m) => { state.mode = m; render(); });
    wireRadios('wheres', 'where', (w) => { state.where = w; render(); });

    // sliders: ranges from the canon
    const p = $('p');
    p.max = String(I.Lkm);
    p.value = '0';
    p.addEventListener('input', () => { state.pKm = Number(p.value); render(); });
    const fsS = $('fs');
    fsS.max = String(Math.round(100 / I.SF));
    state.fs = I.fs;
    fsS.value = String(Math.round(I.fs * 100));
    fsS.addEventListener('input', () => { state.fs = Number(fsS.value) / 100; render(); });
    const chips = $('fs-chips');
    const refV = I.tiers.find((t) => t.key === 'reference');
    const derates = [...new Set(I.ladder.filter((l) => refV && Math.abs(l.vkms - refV.vkms) < 1e-9).map((l) => l.derate))].sort((a, b) => b - a);
    for (const d of derates) {
      const f = (1 - d) / I.SF;
      const b = el('button', { type: 'button', class: 'chip' }, `${fpct(d, 0)} derate → ${fpct(f, 0)}`);
      b.title = `SF ${I.SF}, ${fpct(d, 0)} strength derate (rev_a.json ladder key): working load (1 − derate)/SF`;
      b.addEventListener('click', () => { state.fs = f; fsS.value = String(Math.round(f * 100)); render(); });
      chips.append(b);
    }
    const capS = $('cap');
    capS.max = String(Math.round(100 / I.SF));
    if (I.cap) { state.cap = I.cap; capS.value = String(Math.round(I.cap * 100)); } else { capS.value = capS.min; }
    capS.addEventListener('input', () => { state.cap = Number(capS.value) / 100; render(); });
    const capReset = $('cap-reset');
    if (I.cap) {
      capReset.textContent = `guidance value (${fpct(I.cap, 0)})`;
      capReset.addEventListener('click', () => { state.cap = I.cap; capS.value = String(Math.round(I.cap * 100)); render(); });
    } else {
      capReset.disabled = true;
      capReset.textContent = 'guidance value did not load';
    }
    const beta = $('beta');
    beta.addEventListener('input', () => { state.beta = Number(beta.value) / 100; render(); });
    const hm = $('hmpe');
    if (!I.sk99) hm.options[0].textContent = 'Dyneema SK99 (refused: no density)';
    hm.addEventListener('change', () => { state.hmpe = hm.value; $('custom').hidden = hm.value !== 'custom'; render(); });
    for (const [id, key] of [['c-sigma', 'sigmaGPa'], ['c-rho', 'rho']]) {
      $(id).addEventListener('input', () => { state.custom[key] = $(id).value; render(); });
    }
    wireChart();
    renderLimits();
    renderSources();
    renderItem10();
    render();
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => render(), 80); });
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { readPalette(); render(); });
  }

  // ---- main render ------------------------------------------------------------------------------
  let last = null;
  function render() {
    setRadio('tiers', 'tier', state.tierKey);
    setRadio('modes', 'mode', state.mode);
    setRadio('wheres', 'where', state.where);
    const tier = I.tiers.find((t) => t.key === state.tierKey);
    $('p-out').textContent = fkm(state.pKm);
    $('fs-out').textContent = fpct(state.fs, 0);
    $('cap-out').textContent = state.cap == null ? 'not set' : fpct(state.cap, 0);
    $('beta-out').textContent = `${fpct(state.beta, 0)} of the payload`;
    hints(tier);
    const res = M.compute(I, state);
    last = res;
    const box = $('refusal');
    if (res.refusal) {
      $('sentence').textContent = 'Refused: nothing is computed for these settings.';
      $('tiles').replaceChildren();
      showRefusal(box, res.refusal);
      $('strip').replaceChildren(el('p', { class: 'hint' }, 'No drawing: the readout above says why.'));
      $('strip-legend').replaceChildren();
      $('chart').replaceChildren(el('p', { class: 'hint' }, 'No curves: the readout above says why.'));
      $('chart-legend').replaceChildren();
      $('chart-table').replaceChildren();
      $('where-table').replaceChildren();
      $('where-note').textContent = '';
      return;
    }
    box.hidden = true;
    const allP = M.compute(I, { ...state, pKm: I.Lkm });
    const modes = {};
    for (const m of ['none', 'every', 'between']) {
      const r = M.compute(I, { ...state, mode: m });
      modes[m] = r.refusal ? null : r;
    }
    readout(res, allP, modes, tier);
    drawStrip(res);
    drawChart(res);
    whereTable();
  }

  function hints(tier) {
    const z = I.zylonTipKm;
    const modeHint = {
      none: `HMPE and PBO both at ${fpct(state.fs, 0)} of break while a payload rides, the canon's sizing rule (1 − derate)/SF${Math.abs(state.fs - I.fs) < 1e-9 ? ` = (1 − ${fpct(I.derate, 0)})/${I.SF}` : ''}. HMPE is not held to the cap.`,
      every: `HMPE held to ${state.cap == null ? 'the cap' : fpct(state.cap, 0)} under every load, payload aboard or not: DECISION_LOG item 10's reading${I.item10SF ? `, which it equates to SF ≈ ${I.item10SF.SF}` : ''}. PBO stays at ${fpct(state.fs, 0)}.`,
      between: `HMPE held to ${fpct(state.fs, 0)} while a payload rides and to ${state.cap == null ? 'the cap' : fpct(state.cap, 0)} between catches. This reading is this page's, not the program's: it assumes the creep guidance applies to the load the arm carries most of the time.`,
    };
    $('mode-hint').textContent = modeHint[state.mode];
    $('p-hint').textContent = z == null ? '' : `0 km is the construction baseline (docs/project_instructions.md:108): HMPE bulk, the outer ${fkm(z)} of the lower arm Zylon, the upper arm all HMPE. ${fkm(I.Lkm)} (the rev_a.json half-length) makes both arms all PBO.${state.where === 'hub' ? ` At the hub end the lower arm keeps its ${fkm(z)} Zylon tip.` : ''}`;
    $('cap-hint').textContent = I.cap
      ? `${fpct(I.cap, 0)} is the published multi-year guidance for SK78 HMPE as Skyhook records it (docs/DECISION_LOG.md:70, from MP-001 §3c; secondary-sourced, spot-check pending). Applying it to SK99 is an assumption. Drawn as a line; no lifetime is computed.`
      : 'The guidance line (docs/DECISION_LOG.md:70) did not load; a cap you set is yours, not the program\'s.';
    $('beta-hint').textContent = `${fpct(0, 0)} means bare tips between catches, as physics/tether_dynamics.py models the tether (payload_both_tips is False at :81; the payload is added at the catch, :357). rev_a.json has no tip-vehicle mass, so ${fpct(0, 0)} is a lower bound on the between-catch load, not an estimate.`;
    let hh = '';
    if (state.hmpe === 'custom') hh = 'Not canon: typed values only, nothing filled in. The cap and the sizing rule are applied to it unchanged.';
    else if (I.sk99) {
      const H = M.fibre(I.sk99);
      const P = M.fibre(I.pbo);
      hh = `σ ${I.sk99.sigmaGPa} GPa from rev_a.json; ρ ${nf(I.sk99.rho, 0)} kg/m³ from the founding document's material survey (docs/project_instructions.md:67), not canon: rev_a.json has no SK99 density.${I.sk99.mp001Rho ? ` MP-001:22 gives the same (${nf(I.sk99.mp001Rho, 0)} kg/m³, secondary spec sheets).` : ''} V_c = ${(H.Vc / 1000).toFixed(4)} km/s against ${I.pbo.name}'s ${(P.Vc / 1000).toFixed(4)} km/s.`;
    } else hh = 'Refused: rev_a.json has no SK99 density and the founding document\'s row did not load. Type a custom HMPE instead.';
    $('hmpe-hint').textContent = hh;
  }

  function readout(res, allP, modes, tier) {
    const t = res.tier;
    const pay = I.payloadKg;
    const capTxt = state.cap == null ? 'the cap' : `the ${fpct(state.cap, 0)} line`;
    const hm = res.aboard ? res.aboard.hmpeKm : null;
    const parts = [];
    const where = state.pKm === 0 ? 'The construction baseline' : `The baseline with ${fkm(state.pKm)} of PBO added to each arm at the ${state.where} end`;
    parts.push(`${where}, at ${nf(t.vkms, 2)} km/s and sized by the ${MODE_NAME[state.mode]}, weighs ${fx(res.ratio)} its payload${res.tonnes != null ? ` (${ft(res.tonnes)} at ${nf(pay, 0)} kg)` : ''}.`);
    if (res.aboard && res.between && hm > 0) {
      const a = res.aboard;
      const b = res.between;
      const mins = `about ${res.aboardMin.toFixed(1)} min per catch`;
      if (state.mode === 'every') {
        parts.push(`No HMPE metre is above ${capTxt}, with a payload aboard or between catches.`);
      } else if (state.mode === 'between') {
        parts.push(`While a payload rides (${mins}) ${a.aboveKm >= hm - 1e-6 ? 'all' : fkm(a.aboveKm) + ' of the'} ${fkm(hm)} of HMPE ${a.aboveKm >= hm - 1e-6 ? 'is' : 'are'} above ${capTxt}, up to ${fpct(a.peak)} of break; between catches none is.`);
      } else {
        parts.push(`While a payload rides (${mins}) ${fkm(a.aboveKm)} of its ${fkm(hm)} of HMPE is above ${capTxt}; between catches ${fkm(b.aboveKm)} is, up to ${fpct(b.peak)} of break at the hub end.`);
      }
    } else if (hm === 0) {
      parts.push('There is no HMPE left: this is the all-PBO tether.');
    }
    const cmp = ['none', 'every', 'between'].filter((m) => modes[m]).map((m) => `${MODE_NAME[m]} ${fx(modes[m].ratio)}`);
    if (cmp.length > 1) parts.push(`Same layout, three ways: ${cmp.join('; ')}.`);
    $('sentence').textContent = parts.join(' ');

    const tiles = [];
    const tile = (k, v, s, flag) => {
      const d = el('div', { class: 'tile' });
      d.append(el('div', { class: 'k' }, k), el('div', { class: 'v num' }, v));
      if (s) d.append(el('div', { class: 's' }, s));
      if (flag) d.querySelector('.k').append(' ', el('span', { class: 'flag' }, flag));
      tiles.push(d);
    };
    const nc = res.H.canon ? null : 'ρ not canon';
    tile('Tether ÷ payload, both arms', fx(res.ratio), MODE_NAME[state.mode], nc);
    tile(`Fibre at ${pay ? nf(pay, 0) : '?'} kg payload`, res.tonnes != null ? ft(res.tonnes) : 'no payload in canon',
      allP.refusal || res.tonnes == null ? null : `${signed(res.tonnes - allP.tonnes, ft)} against all-PBO`, nc);
    tile('All-PBO tether, same load', allP.refusal ? '—' : fx(allP.ratio), 'EQ-6 for the canon fibre');
    if (res.aboard) {
      tile('HMPE above the cap, payload aboard', `${nf(res.aboard.aboveKm, 0)} of ${fkm(res.aboard.hmpeKm)}`, `about ${res.aboardMin.toFixed(1)} min per catch (half a rotation)`);
      tile('HMPE above the cap, between catches', `${nf(res.between.aboveKm, 0)} of ${fkm(res.between.hmpeKm)}`, res.between.hmpeKm > 0 ? `highest HMPE load ${fpct(res.between.peak)} of break` : null);
    } else {
      tile('HMPE above the cap', 'no cap set', 'the guidance line did not load');
    }
    tile('HMPE share of the fibre mass', fpct(res.hmpeMassShare), `${fkm(res.aboard ? res.aboard.hmpeKm : 0)} of ${fkm(2 * I.Lkm)} of length`);
    $('tiles').replaceChildren(...tiles);
  }

  // ---- the strip --------------------------------------------------------------------------------
  function drawStrip(res) {
    const host = $('strip');
    const W = Math.max(280, host.clientWidth || 600);
    const Hs = 88;
    const cy = 30;
    const maxH = 26;
    const m = 6;
    const half = W / 2 - m;
    const cx = W / 2;
    const sRef = res.P.sigma;
    const fibOf = (mat) => (mat === 'P' ? res.P : res.H);
    let Amax = 0;
    for (const a of [res.upper, res.lower]) {
      for (const pc of a.pieces) for (const u of [pc.u0, pc.u1]) Amax = Math.max(Amax, M.areaAt(pc, u, fibOf(pc.mat), sRef, state.beta));
    }
    const hOf = (pc, u) => maxH * Math.sqrt(M.areaAt(pc, u, fibOf(pc.mat), sRef, state.beta) / Amax);
    const rows = [
      ['aboard', 'While a payload rides', `about ${res.aboardMin.toFixed(1)} min per catch`],
      ['between', 'Between catches', state.beta > 0 ? `tips carry ${fpct(state.beta, 0)} of a payload` : 'bare tips (a lower bound)'],
    ];
    const frag = [];
    rows.forEach(([st, title, sub], ri) => {
      frag.push(el('p', { class: 'row-label' }, `${title} · ${sub}`));
      const svg = sv('svg', { viewBox: `0 0 ${W} ${Hs}`, width: W, height: Hs, role: 'img' });
      const defs = sv('defs');
      const pat = sv('pattern', { id: `hatch-${ri}`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
      pat.append(sv('rect', { width: 5, height: 5, fill: css('--pbo-fill') }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: css('--hatch'), 'stroke-width': 1.2 }));
      defs.append(pat);
      svg.append(defs);
      const marks = [];
      for (const [arm, dir] of [[res.upper, -1], [res.lower, 1]]) {
        const X = (u) => cx + dir * u * half;
        for (const pc of arm.pieces) {
          const n = Math.max(3, Math.ceil(160 * (pc.u1 - pc.u0)));
          for (let j = 0; j < n; j++) {
            const ua = pc.u0 + ((pc.u1 - pc.u0) * j) / n;
            const ub = pc.u0 + ((pc.u1 - pc.u0) * (j + 1)) / n;
            const ha = hOf(pc, ua);
            const hb = hOf(pc, ub);
            const xa = X(ua);
            const xb = X(ub) + dir * 0.4; // overlap a hair so slices do not show seams
            const fill = pc.mat === 'P' ? `url(#hatch-${ri})` : (state.cap == null ? css('--div-mid') : divColor(M.fractionAt(pc, 0.5 * (ua + ub), st, state.beta), state.cap));
            svg.append(sv('polygon', { points: `${xa},${cy - ha} ${xb},${cy - hb} ${xb},${cy + hb} ${xa},${cy + ha}`, fill, stroke: pc.mat === 'P' ? 'none' : fill, 'stroke-width': 0.6 }));
          }
          if (state.cap != null) {
            const r = M.aboveCap(pc, st, state.cap, state.beta);
            if (r && r[1] < pc.u1 - 1e-9) marks.push(X(r[1]));
          }
        }
        // outline
        const top = [];
        const bot = [];
        for (const pc of arm.pieces) {
          for (const u of [pc.u0, pc.u1]) { top.push(`${X(u)},${cy - hOf(pc, u)}`); bot.push(`${X(u)},${cy + hOf(pc, u)}`); }
        }
        svg.append(sv('polyline', { points: top.join(' '), fill: 'none', stroke: css('--axis'), 'stroke-width': 1 }));
        svg.append(sv('polyline', { points: bot.join(' '), fill: 'none', stroke: css('--axis'), 'stroke-width': 1 }));
        // material boundaries
        for (let i = 1; i < arm.pieces.length; i++) {
          if (arm.pieces[i].mat !== arm.pieces[i - 1].mat) {
            const x = X(arm.pieces[i].u0);
            svg.append(sv('line', { x1: x, x2: x, y1: cy - maxH - 2, y2: cy + maxH + 2, stroke: css('--ink-2'), 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
          }
        }
      }
      for (const x of marks) {
        svg.append(sv('path', { d: `M${x},${cy + maxH + 3} l-4,7 h8 z`, fill: css('--ink') }));
      }
      const ly = Hs - 2;
      svg.append(sv('text', { x: m, y: ly, class: 'muted' }, 'upper tip'));
      svg.append(sv('text', { x: cx, y: ly, 'text-anchor': 'middle', class: 'muted' }, 'hub'));
      svg.append(sv('text', { x: W - m, y: ly, 'text-anchor': 'end', class: 'muted' }, 'lower tip'));
      const sumBits = [];
      const s = res[st];
      if (s && s.hmpeKm > 0) {
        sumBits.push(`HMPE above ${fpct(state.cap, 0)}: ${fkm(s.aboveKm)} of ${fkm(s.hmpeKm)}; highest HMPE load ${fpct(s.peak)} of break.`);
        if (marks.length) sumBits.push('▲ marks where HMPE drops under the cap.');
      } else if (s) sumBits.push('No HMPE in this layout.');
      svg.setAttribute('aria-label', `${title}: ${sumBits.join(' ')}`);
      frag.push(svg, el('p', { class: 'row-sum' }, sumBits.join(' ')));
    });
    host.replaceChildren(...frag);
    // legend
    const lg = $('strip-legend');
    if (state.cap == null) { lg.replaceChildren(el('span', {}, 'No cap set: HMPE drawn neutral.')); return; }
    const c = state.cap;
    const stops = [0, 0.25, 0.5, 0.75, 1].map((q) => `${divColor(q * c, c)} ${(q * 50).toFixed(0)}%`)
      .concat([0.25, 0.5, 0.75, 1].map((q) => `${divColor(c + q * RED_SPAN, c)} ${(50 + q * 50).toFixed(0)}%`));
    const grad = el('span', { class: 'grad' });
    grad.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    const ticks = el('span', { class: 'ticks' });
    ticks.append(el('span', {}, fpct(0, 0)), el('span', {}, fpct(c, 0)), el('span', {}, `≥ ${fpct(c + RED_SPAN, 0)}`));
    const g = el('span', {});
    g.append(el('span', {}, 'HMPE load, fraction of break '), el('br'), grad, el('br'), ticks);
    const h = el('span', {});
    h.append(el('span', { class: 'hatch' }), ' PBO (no creep cap in the repo)');
    const dsh = el('span', {}, '┆ material boundary');
    lg.replaceChildren(g, h, dsh);
  }

  // ---- the chart --------------------------------------------------------------------------------
  let geo = null;
  function drawChart(res) {
    const host = $('chart');
    const sw = M.sweep(I, state, 161);
    const W = Math.max(280, host.clientWidth || 600);
    const H = W < 520 ? 250 : 300;
    const mg = { l: 50, r: 12, t: 12, b: 34 };
    const all = [];
    for (const k of Object.keys(sw.curves)) for (const v of sw.curves[k]) if (v != null) all.push(v);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const nice = [1, 2, 5];
    const ticks = [];
    const e0 = Math.floor(Math.log10(lo)) - 1;
    const e1 = Math.ceil(Math.log10(hi)) + 1;
    for (let e = e0; e <= e1; e++) for (const n of nice) ticks.push(n * 10 ** e);
    lo = Math.max(...ticks.filter((t) => t <= lo * 0.97));
    hi = Math.min(...ticks.filter((t) => t >= hi * 1.03));
    let yt = ticks.filter((t) => t >= lo && t <= hi);
    if (yt.length < 3) {
      const extra = [1.5, 3, 4, 7].flatMap((n) => [...Array(e1 - e0 + 1).keys()].map((i) => n * 10 ** (e0 + i))).filter((t) => t > lo && t < hi);
      yt = yt.concat(extra).sort((a, b) => a - b);
    }
    const X = (p) => mg.l + ((W - mg.l - mg.r) * p) / I.Lkm;
    const Y = (v) => mg.t + (H - mg.t - mg.b) * (1 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
    geo = { X, Y, W, H, mg, sw };
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    for (const t of yt) {
      svg.append(sv('line', { x1: mg.l, x2: W - mg.r, y1: Y(t), y2: Y(t), stroke: css('--grid'), 'stroke-width': 1 }));
      svg.append(sv('text', { x: mg.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'num' }, `${nf(t, t < 10 ? 1 : 0)}×`));
    }
    const xt = [0, 0.25, 0.5, 0.75, 1].map((q) => q * I.Lkm);
    for (const p of xt) {
      svg.append(sv('line', { x1: X(p), x2: X(p), y1: H - mg.b, y2: H - mg.b + 4, stroke: css('--axis') }));
      svg.append(sv('text', { x: X(p), y: H - mg.b + 16, 'text-anchor': p === 0 ? 'start' : p === I.Lkm ? 'end' : 'middle', class: 'num' }, `${nf(p, 0)}`));
    }
    svg.append(sv('line', { x1: mg.l, x2: W - mg.r, y1: H - mg.b, y2: H - mg.b, stroke: css('--axis') }));
    svg.append(sv('text', { x: (mg.l + W - mg.r) / 2, y: H - 2, 'text-anchor': 'middle', class: 'muted' }, `PBO added per arm, km (0 = baseline; ${state.where} end)`));
    const labels = [];
    for (const k of ['none', 'every', 'between']) {
      const pts = [];
      sw.curves[k].forEach((v, i) => { if (v != null) pts.push(`${X(sw.xs[i]).toFixed(2)},${Y(v).toFixed(2)}`); });
      if (!pts.length) continue;
      svg.append(sv('polyline', { points: pts.join(' '), fill: 'none', stroke: pal[k], 'stroke-width': k === state.mode ? 3 : 2, 'stroke-linejoin': 'round' }));
      if (sw.curves[k][0] != null) labels.push({ k, y: Y(sw.curves[k][0]) });
    }
    // direct labels near the left end, kept apart
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const L of labels) svg.append(sv('text', { x: mg.l + 6, y: L.y - 5 }, MODE_NAME[L.k]));
    // current position
    const cxp = X(state.pKm);
    svg.append(sv('line', { x1: cxp, x2: cxp, y1: mg.t, y2: H - mg.b, stroke: css('--ink-2'), 'stroke-dasharray': '3 3' }));
    for (const k of ['none', 'every', 'between']) {
      const r = M.compute(I, { ...state, mode: k });
      if (r.refusal) continue;
      svg.append(sv('circle', { cx: cxp, cy: Y(r.ratio), r: k === state.mode ? 5 : 4, fill: pal[k], stroke: pal.surface, 'stroke-width': 2 }));
    }
    const hover = sv('g', { id: 'hover' });
    svg.append(hover);
    svg.setAttribute('aria-label', `Tether mass over payload against PBO added per arm, three sizing rules. At ${fkm(state.pKm)}: ${['none', 'every', 'between'].map((k) => { const r = M.compute(I, { ...state, mode: k }); return r.refusal ? `${MODE_NAME[k]} refused` : `${MODE_NAME[k]} ${fx(r.ratio)}`; }).join(', ')}.`);
    host.replaceChildren(svg);
    // legend
    const lg = $('chart-legend');
    lg.replaceChildren(...['none', 'every', 'between'].map((k) => {
      const li = el('li');
      const s = el('span', { class: `sw sw-${k}` });
      li.append(s, MODE_NAME[k]);
      return li;
    }));
    // table view
    const tb = $('chart-table');
    const head = el('tr');
    head.append(el('th', {}, 'PBO added per arm'), ...['none', 'every', 'between'].map((k) => el('th', {}, MODE_NAME[k])));
    const rows = [head];
    for (let i = 0; i < sw.xs.length; i += 10) {
      const tr = el('tr');
      tr.append(el('td', {}, fkm(sw.xs[i])), ...['none', 'every', 'between'].map((k) => el('td', {}, sw.curves[k][i] == null ? 'refused' : fx(sw.curves[k][i]))));
      rows.push(tr);
    }
    tb.replaceChildren(...rows);
  }

  function wireChart() {
    const host = $('chart');
    const tip = $('tooltip');
    let dragging = false;
    let raf = 0;
    const pAt = (e) => {
      if (!geo) return null;
      const rect = host.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * geo.W;
      const p = ((x - geo.mg.l) / (geo.W - geo.mg.l - geo.mg.r)) * I.Lkm;
      return Math.max(0, Math.min(I.Lkm, p));
    };
    const setP = (p) => {
      const v = Math.round(p);
      if (v === state.pKm) return;
      state.pKm = v;
      $('p').value = String(v);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    };
    const showTip = (e, p) => {
      const card = $('chart-card').getBoundingClientRect();
      const vals = ['none', 'every', 'between'].map((k) => {
        const r = M.compute(I, { ...state, pKm: p, mode: k });
        return `${MODE_NAME[k]}: ${r.refusal ? 'refused' : `${fx(r.ratio)}${r.tonnes != null ? ` (${ft(r.tonnes)})` : ''}`}`;
      });
      tip.replaceChildren(el('div', {}, `${fkm(p)} of PBO per arm, ${state.where} end`), ...vals.map((v) => el('div', {}, v)));
      tip.hidden = false;
      const w = tip.offsetWidth;
      let left = e.clientX - card.left + 12;
      if (left + w > card.width - 6) left = e.clientX - card.left - w - 12;
      tip.style.left = `${Math.max(6, left)}px`;
      tip.style.top = `${e.clientY - card.top + 14}px`;
      const hv = document.getElementById('hover');
      if (hv) {
        const x = geo.X(p);
        hv.replaceChildren(sv('line', { x1: x, x2: x, y1: geo.mg.t, y2: geo.H - geo.mg.b, stroke: css('--axis'), 'stroke-width': 1 }));
      }
    };
    host.addEventListener('pointerdown', (e) => {
      const p = pAt(e);
      if (p == null) return;
      dragging = true;
      if (host.setPointerCapture) { try { host.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } }
      setP(p);
    });
    host.addEventListener('pointermove', (e) => {
      const p = pAt(e);
      if (p == null) return;
      if (dragging) setP(p);
      showTip(e, Math.round(p));
    });
    const end = () => { dragging = false; };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('pointerleave', () => { tip.hidden = true; const hv = document.getElementById('hover'); if (hv) hv.replaceChildren(); });
  }

  // ---- which end ------------------------------------------------------------------------------------
  function whereTable() {
    const L = I.Lkm;
    const ps = [L / 16, L / 8, L / 4, L / 2, (3 * L) / 4].map((x) => Math.round(x));
    $('where-intro').textContent = `Each row adds the same length of PBO to each arm, either at the tip end (HMPE stays at the hub, the baseline's order) or at the hub end (a PBO core with HMPE outboard; the lower arm keeps its ${fkm(I.zylonTipKm)} Zylon tip). Tier, working load, cap and tip mass as set above. The lighter of each pair is in bold.`;
    const head1 = el('tr');
    head1.append(el('th', { rowspan: 2 }, 'PBO added per arm'), el('th', { colspan: 2 }, MODE_NAME.every), el('th', { colspan: 2 }, MODE_NAME.between));
    const head2 = el('tr');
    head2.append(el('th', {}, 'tip end'), el('th', {}, 'hub end'), el('th', {}, 'tip end'), el('th', {}, 'hub end'));
    const rows = [head1, head2];
    const verdict = { every: new Set(), between: new Set() };
    for (const p of ps) {
      const tr = el('tr');
      tr.append(el('td', {}, fkm(p)));
      for (const mode of ['every', 'between']) {
        const a = M.compute(I, { ...state, pKm: p, mode, where: 'tip' });
        const b = M.compute(I, { ...state, pKm: p, mode, where: 'hub' });
        if (a.refusal || b.refusal) { tr.append(el('td', { colspan: 2 }, 'refused')); continue; }
        const rel = Math.abs(a.ratio - b.ratio) / Math.min(a.ratio, b.ratio);
        const best = rel < 1e-6 ? null : a.ratio < b.ratio ? 'tip' : 'hub';
        if (best) verdict[mode].add(best); else verdict[mode].add('tie');
        for (const [w, r] of [['tip', a], ['hub', b]]) {
          const td = el('td', { class: best === w ? 'best' : '' }, fx(r.ratio));
          if (best === w) td.append(el('span', { class: 'mark' }, 'lighter'));
          tr.append(td);
        }
      }
      rows.push(tr);
    }
    $('where-table').replaceChildren(...rows);
    const say = (mode) => {
      const v = verdict[mode];
      if (v.size === 1 && !v.has('tie')) return `with ${MODE_NAME[mode]}, every row is lighter with the PBO at the ${[...v][0]} end`;
      return `with ${MODE_NAME[mode]} the lighter end changes from row to row`;
    };
    const none = ps.map((p) => [M.compute(I, { ...state, pKm: p, mode: 'none', where: 'tip' }), M.compute(I, { ...state, pKm: p, mode: 'none', where: 'hub' })]).filter(([a, b]) => !a.refusal && !b.refusal);
    const spread = none.length ? Math.max(...none.map(([a, b]) => Math.abs(a.ratio - b.ratio) / Math.min(a.ratio, b.ratio))) : null;
    $('where-note').textContent = `At these settings, ${say('every')}; ${say('between')}.${spread != null ? ` Under the canon rule the two ends differ by at most ${fpct(spread, 2)}, because the two fibres' characteristic velocities are within ${fpct(Math.abs(last.H.Vc / last.P.Vc - 1), 2)} of each other.` : ''} Why: a kilogram far out on the arm is carried by every metre inboard of it, so a kilometre of the costlier fibre costs more the further out it sits. With a cap on every load HMPE is the costlier fibre everywhere, so it belongs at the hub and the PBO at the tip. With a cap between catches HMPE costs extra only where the cap binds, near the hub, where the arm's own weight keeps the load high with no payload aboard; replacing that stretch is what pays.`;
  }

  // ---- item 10 -----------------------------------------------------------------------------------
  function renderItem10() {
    const it = M.item10(I);
    const card = $('item10-card');
    if (!it) { card.hidden = true; return; }
    const q = (D.lines['docs/DECISION_LOG.md'] || {})['72'];
    const bq = $('item10-quote');
    if (q) bq.replaceChildren(el('span', {}, q.replace(/\*\*/g, '')), el('cite', {}, `docs/DECISION_LOG.md:72 @ ${String(D.linesCommit).slice(0, 7)}`));
    else bq.textContent = 'The item 10 line did not load.';
    const kindTxt = { canon: 'canon rung', item10: 'item 10\'s SF', cap: 'cap at canon derate' };
    const head = el('tr');
    head.append(el('th', {}, 'Rule'), el('th', {}, 'f'), el('th', {}, `all ${I.pbo.name}`), el('th', {}, 'all SK99 (ρ not canon)'));
    const rows = [head];
    for (const r of it.rows) {
      const tr = el('tr');
      const rc = el('td');
      rc.append(el('span', { class: 'nw' }, `SF ${nf(r.SF, r.SF % 1 ? 1 : 0)}, ${fpct(r.derate, 0)} derate`), el('span', { class: 'mark' }, kindTxt[r.kind]));
      const pc = el('td', {}, fx(r.pbo));
      if (r.ladder != null) {
        const okv = Math.abs(r.pbo - r.ladder) / r.ladder <= 5e-4;
        const mk = el('span', { class: 'mark' });
        mk.append(el('span', { class: okv ? 'tick' : 'cross' }, okv ? '✓' : '✗'), okv ? ' rev_a.json' : ` rev_a.json: ${nf(r.ladder, 2)}×`);
        mk.title = `params/rev_a.json mass_ratio rung: ${nf(r.ladder, 2)}×`;
        pc.append(mk);
      }
      tr.append(rc, el('td', {}, fpct(r.f)), pc, el('td', {}, r.sk99 == null ? 'refused' : fx(r.sk99)));
      rows.push(tr);
    }
    $('item10-table').replaceChildren(...rows);
    const f = [];
    const row = (kind, d) => it.rows.find((r) => r.kind === kind && Math.abs(r.derate - d) < 1e-9);
    if (it.range) {
      f.push(`Item 10's “${Math.round(it.range.lo * 100)}–${Math.round(it.range.hi * 100)}% of rated break strength” (docs/DECISION_LOG.md:70) ${it.rangeReproduces ? 'reproduces' : 'does not reproduce'} from rev_a.json: 1/SF = ${fpct(1 / I.SF, 0)} with no derate, (1 − ${fpct(I.derate, 0)})/SF = ${fpct(I.fs, 0)} with the canon derate.`);
    }
    const capRow = it.rows.find((r) => r.kind === 'cap');
    const sf0 = row('item10', 0);
    const sf30 = row('item10', I.derate);
    if (capRow && sf0) {
      f.push(`EQ-6 depends on SF and derate only through f = (1 − derate)/SF. So “${fpct(I.cap, 0)} sustained load” is one tether whatever the split: ${fx(capRow.pbo)} all-${I.pbo.name}${capRow.sk99 ? `, ${fx(capRow.sk99)} all-SK99` : ''}. SF ${sf0.SF} is that tether only at ${fpct(0, 0)} derate; at the canon's ${fpct(I.derate, 0)} derate it is SF ${nf(capRow.SF, 1)}, and SF ${sf0.SF} would mean ${fpct(sf30.f)} of break (${fx(sf30.pbo)}).`);
    }
    if (it.quote && sf0) {
      const r0 = row('canon', 0);
      const dFor = 1 - it.fFor800 * (I.item10SF ? I.item10SF.SF : NaN);
      f.push(`“from ~${it.quote.from}× to order ~${it.quote.to}×”: ~${it.quote.from}× is the ${fpct(0, 0)} derate rung (${r0 ? fx(r0.pbo) : '?'}), and ${fpct(I.cap, 0)} of break gives ${fx(sf0.pbo)}, ${nf(sf0.pbo / (r0 ? r0.pbo : NaN), 1)} times as heavy, not ~${nf(it.quote.to / it.quote.from, 0)}. ~${it.quote.to}× needs f = ${fpct(it.fFor800, 2)} (SF ${sf0.SF} at a ${fpct(dFor)} derate), which no rung names. Idea 15 (Taper Is Not Mass) reported the ${fx(sf0.pbo)} first; this restates it in f.`);
    }
    if (it.sk99Between != null && capRow && capRow.sk99) {
      f.push(`If the cap binds only between catches (bare tips), an all-SK99 tether held to ${fpct(I.fs, 0)} with a payload aboard and ${fpct(I.cap, 0)} between catches is ${fx(it.sk99Between)}, against ${fx(capRow.sk99)} with the cap on every load. Whether creep allows that reading is not something this page can say: it needs a hold at the between-catch load with periodic excursions to the payload-aboard load. ST-002 as proposed hangs coupons at constant loads (docs/research/mp001_market_pricing.md:48), and the TP-001 creep series has no protocol in the checkout.`);
    }
    $('item10-findings').replaceChildren(...f.map((t) => el('li', {}, t)));
  }

  // ---- limits and sources --------------------------------------------------------------------------
  function renderLimits() {
    const items = [];
    const cap = I && I.cap ? fpct(I.cap, 0) : 'the guidance cap';
    items.push(`No creep model and no lifetime. ${cap} is secondary-sourced guidance (MP-001 §3c, “[Likely] … spot-check pending” in docs/DECISION_LOG.md:66), drawn as a line, never turned into years.`);
    items.push(`No DM20 curve. LR-001 §D reports DM20 creeping ${I && I.dm20Ratio ? `>${I.dm20Ratio}×` : 'much'} slower than SK78, but the repo gives no DM20 strength or density. A custom HMPE can be typed under “Tip mass between catches, and the HMPE fibre”; it is marked not canon.`);
    items.push(`Free-space centrifugal load only, the approximation EQ-6 makes: no gravity gradient (physics/tether_dynamics.py:353 puts its tension modulation at ${I && I.ggModPct ? `~${I.ggModPct} %` : 'a few per cent'}), no catch transient, no joints or splices. The spin rate is the same with and without the payload.`);
    items.push(`PBO carries no cap: the repo has no PBO creep guidance (MP-001 §3c calls it aramid-class${I && I.aramidCreep ? `, ${I.aramidCreep[0]}–${I.aramidCreep[1]}× lower creep than HMPE` : ''}). Zylon's UV and atomic-oxygen degradation (docs/project_instructions.md:112) is a jacket requirement, not part of this sizing.`);
    items.push('Does not price anything. rev_a.json\'s fiber_cost_per_kg is null, so whatever made HMPE the baseline bulk fibre (price, handling, availability) is outside this page: in mass, PBO always wins here once HMPE is capped.');
    $('limits').replaceChildren(...items.map((t) => el('li', {}, t)));
  }
  function renderSources() {
    const c = I && I.commit ? String(I.commit).slice(0, 7) : '?';
    const items = [
      `params/rev_a.json @ ${c} (snapshots/rev_a.json): ${I && I.pbo ? I.pbo.name : 'primary fibre'} σ and ρ, SK99 σ, SF, derate, half-length, tier tip speeds, rotation period, payload for tonnage, the mass-ratio ladder.`,
      'docs/project_instructions.md:67 (founding material survey): the SK99 density, not canon. :108: the construction baseline (HMPE bulk, Zylon outer lower arm). :10: release half a rotation after the catch.',
      'docs/DECISION_LOG.md:66–76 (item 10): the multi-year guidance cap, the steady-load range, the safety factor item 10 says the cap needs, its mass-ratio sentence, admissible outcomes (a)–(d).',
      'docs/research/mp001_market_pricing.md:22, :23, :46 (§3c); docs/research/lr001_splice_literature.md:45 (§D).',
      'physics/tether_dynamics.py:17–25 (the single-material profile this generalises), :81 and :357 (tips bare between catches), :353 (gravity gradient ~4 %).',
      'Snapshots and their provenance sidecars are in snapshots/; page-data.js wraps them (generated by build-data.mjs).',
    ];
    $('sources').replaceChildren(...items.map((t) => el('li', {}, t)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
