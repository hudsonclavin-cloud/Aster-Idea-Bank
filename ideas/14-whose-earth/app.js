// app.js — draws the page from data.js (the run build-data.mjs recorded), registry.js and model.js.
// Every number shown is computed here by model.js from those inputs; nothing numeric is written in this file.
(function () {
  'use strict';
  const D = window.WHOSE_EARTH_DATA;
  const R = window.WhoseEarthRegistry;
  const M = window.WhoseEarth;
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }
  // a file path as text with break opportunities after / and _ so narrow cells wrap at sensible places
  function pathNode(text) {
    const frag = document.createDocumentFragment();
    String(text).split(/(?<=[/_])/).forEach((part, i) => {
      if (i) frag.append(document.createElement('wbr'));
      frag.append(document.createTextNode(part));
    });
    return frag;
  }
  const f = M.fmt;
  const sgn = M.fmtSigned;
  const pct = (x, d) => `${sgn(100 * x, d)} %`;
  const short = (c) => (c || '').slice(0, 7);

  if (!D || !R || !M) {
    $('src').replaceChildren(el('div', { class: 'refusal' }, el('b', { text: 'Refused: ' }),
      'data.js, registry.js or model.js did not load, so there is nothing to show rather than a guess. What would help: run node ideas/14-whose-earth/build-data.mjs from the bank root.'));
    return;
  }

  // ---------------------------------------------------------------- inputs
  const savedById = Object.fromEntries(D.rows.map((r) => [r.id, r]));
  const rows = R.rows.map((r) => {
    const s = savedById[r.id];
    return Object.assign({}, r, s ? { status: s.status, foundLine: s.foundLine, text: s.text } : { status: 'not recorded', foundLine: null, text: null });
  });
  const usable = rows.map((r) => (r.status === 'ok' || r.status === 'moved' ? r : Object.assign({}, r, { text: null })));
  const byId = Object.fromEntries(usable.map((r) => [r.id, r]));
  const canon = D.inputs.canon;
  const A = M.analyze({ canon, rows: usable, sets: R.EARTH_SETS, workbook: D.inputs.workbook, grid: D.inputs.grid, expected: R.EXPECTED });
  const E = Object.fromEntries(A.earths.map((e) => [e.id, e]));
  const S = E.skyhook;
  const AS = E.aster;
  const where = (r) => `${r.path}:${r.foundLine || r.line}`;
  const REPO = { aster: 'Aster', skyhook: 'Skyhook' };

  // ---------------------------------------------------------------- header
  const st = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
  const scanned = D.scans ? `${D.scans.aster.filesScanned} Aster and ${D.scans.skyhook.filesScanned} Skyhook files scanned, ${D.scans.aster.unregistered.length + D.scans.skyhook.unregistered.length} occurrences not in the registry` : 'scan not recorded';
  $('src').textContent = `Read from Aster ${short(D.sources.aster.commit)} (${(D.sources.aster.commitDate || '').slice(0, 10)}) and Skyhook ${short(D.sources.skyhook.commit)} (${(D.sources.skyhook.commitDate || '').slice(0, 10)}): ${rows.length} cited lines, ${Object.entries(st).map(([k, n]) => `${n} ${k === 'ok' ? 'on their stated line' : k}`).join(', ')}; ${scanned}.`;

  // ---------------------------------------------------------------- tiles
  const ref = A.iface[0];
  const cis = A.iface.find((t) => t.tier === 'cislunar');
  const shifts = A.iface.map((t) => t.c3.shift.both);
  const reb = A.reboostRows[0].byEarth.skyhook;
  const cons = A.gridCheck.refused ? null : A.gridCheck.points.find((p) => p.tier === 'reference' && p.column === 'Conservative');
  const miss = (id) => A.canonTables[id].filter((q) => q.depends.length && q.reproduces === false).length;
  const g0Groups = A.groups.g0;
  const g0Other = g0Groups.find((g) => g.value !== S.g0);
  const tiles = [
    ["Earth's μ, Aster vs Skyhook", M.fmtRel((AS.mu - S.mu) / S.mu),
      `Aster ${f(AS.mu, 4)} vs Skyhook ${f(S.mu, 0)} km³/s². Alone it moves the tether's C3 by ${sgn(ref.c3.shift.muOnly, 6)} km²/s²: negligible.`],
    ["Earth's radius, Aster vs Skyhook", `${sgn(AS.R - S.R, 3)} km`,
      `Aster ${f(AS.R, 3)} (WGS84 a, implied by its parking orbit) vs Skyhook ${f(S.R, 0)} (mean). C3 ${sgn(Math.min(...shifts), 3)} to ${sgn(Math.max(...shifts), 3)} km²/s² with each side self-consistent; ${sgn(ref.c3.shift.mixed, 3)} if one side's speed meets the other's radius.`],
    ['Cislunar apogee', `${sgn(cis.apogee.B - cis.apogee.A, 0)} km`,
      `The cislunar tier's apogee on Aster's Earth (${pct((cis.apogee.B - cis.apogee.A) / cis.apogee.A, 2)}), ${sgn(cis.apogee.mixed - cis.apogee.A, 0)} km mixed: the most Earth-sensitive number in the canon.`],
    ['rev_a.json on one Earth', `${miss('skyhook')} · ${miss('aster')}`,
      `Earth-dependent canon values that miss their printed rounding on Skyhook's Earth · on Aster's. Its orbital block is on a ${f(E['canon-com'].R, 0)} km Earth, its kinematics on ${f(S.R, 0)} km.`],
    ['g0 and rotation', f(S.g0, 5),
      `m/s² in both programs' code${g0Other ? `; Skyhook's browser sims divide by ${f(g0Other.value, 2)} (${g0Other.rows.length} lines)` : ''}. Rotation: Skyhook hard-codes ${f(S.vRot, 3)} km/s in code (the canon has it only in a note), Aster states none; it enters no K2 quantity.`],
    ['Reboost per kg thrown', `${f(reb.momentum, 2)} · ${f(reb.orbital, 2)} · ${A.target}`,
      `MJ/kg: Skyhook's finance model · the orbital energy the tether loses · MP-001. No reading of the canon gives ${A.target}${cons ? `; on the conservative column the gap is ${sgn(cons.dollars.skyhook.orbital - cons.published.reboost_electricity_per_kg, 2)} $/kg` : ''}.`],
  ];
  $('tiles').replaceChildren(...tiles.map(([k, v, d]) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }), el('div', { class: 'd', text: d }))));

  // ---------------------------------------------------------------- tooltip
  const tip = $('tip');
  let pinned = null;
  function showTip(target, lines) {
    tip.replaceChildren(...lines.map((l, i) => el('div', i === 0 ? { style: 'font-weight:600' } : null, l)));
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - tip.offsetHeight - 8 > 4 ? r.top - tip.offsetHeight - 8 : r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function hideTip() {
    tip.hidden = true;
    pinned = null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (pinned && !pinned.contains(e.target)) hideTip();
  });
  window.addEventListener('scroll', () => { if (!tip.hidden) hideTip(); }, { passive: true });

  // ---------------------------------------------------------------- radii strip
  function drawRadii() {
    const groups = A.groups.R.filter((g) => g.family === 'R').slice().sort((a, b) => a.value - b.value);
    $('radii-h').textContent = `${groups.length} Earth radii in two programs`;
    const box = $('radii-chart');
    const W = Math.max(300, Math.round(box.clientWidth || 600));
    const lane = 44;
    const top = 8;
    const H = top + lane * groups.length + 28;
    const padL = 10;
    const padR = 18;
    const lo = Math.floor(groups[0].value) - 1;
    const hi = Math.ceil(groups[groups.length - 1].value) + 1;
    const x = (v) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (let t = lo; t <= hi; t += 1) {
      s.append(svg('line', { class: 'axis', x1: x(t), x2: x(t), y1: top, y2: H - 22 }));
      if ((t - lo) % (W < 500 ? 2 : 1) === 0) s.append(svg('text', { class: 'tick', x: x(t), y: H - 6, 'text-anchor': 'middle' }, f(t, 0)));
    }
    groups.forEach((g, i) => {
      const y = top + lane * i + 30;
      const repos = [...new Set(g.rows.map((r) => r.repo))];
      const who = repos.map((rp) => REPO[rp]).join(' + ');
      const main = ['module', 'canon', 'vendor', 'page', 'prose', 'research', 'test'].map((role) => g.rows.find((r) => r.role === role)).find(Boolean) || g.rows[0];
      const labelText = `${f(g.value, g.value % 1 ? String(g.value).split('.')[1].length : 0)} km · ${who} · ${main.path.split('/').pop()}${main.kind.startsWith('implied') ? ' (implied)' : ''}${g.rows.length > 1 ? ` +${g.rows.length - 1}` : ''}`;
      const anchorRight = x(g.value) > W * 0.6;
      s.append(svg('text', { class: 'lbl', x: anchorRight ? W - padR : padL, y: y - 12, 'text-anchor': anchorRight ? 'end' : 'start' }, labelText));
      s.append(svg('line', { class: 'axis', x1: padL, x2: W - padR, y1: y, y2: y }));
      const cls = repos.length === 1 ? `m-${repos[0]}` : 'm-skyhook';
      const dot = svg('circle', { class: `${cls} ring`, cx: x(g.value), cy: y, r: 6, tabindex: 0, role: 'button', 'aria-label': `${labelText}: ${g.rows.length} sources` });
      const lines = [`${f(g.value, 4)} km (${who})`, ...g.rows.slice(0, 8).map((r) => `${REPO[r.repo]} ${R.ROLES[r.role]}: ${where(r)}${r.kind.startsWith('implied') ? ' (implied)' : ''}`), g.rows.length > 8 ? `…and ${g.rows.length - 8} more in the concordance below` : null].filter(Boolean);
      const open = (e) => { pinned = dot; showTip(dot, lines); if (e) e.stopPropagation(); };
      dot.addEventListener('pointerenter', () => showTip(dot, lines));
      dot.addEventListener('pointerleave', () => { if (pinned !== dot) hideTip(); });
      dot.addEventListener('click', open);
      dot.addEventListener('focus', () => showTip(dot, lines));
      dot.addEventListener('blur', hideTip);
      dot.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
      // a larger invisible hit target
      const hit = svg('circle', { cx: x(g.value), cy: y, r: 16, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => showTip(dot, lines));
      hit.addEventListener('pointerleave', () => { if (pinned !== dot) hideTip(); });
      hit.addEventListener('click', open);
      s.append(hit, dot);
    });
    box.replaceChildren(s);
    const t = el('table', null, el('thead', null, el('tr', null, el('th', { class: 'num', text: 'R km' }), el('th', { text: 'relative to Skyhook' }), el('th', { text: 'stated at' }))),
      el('tbody', null, groups.map((g) => el('tr', null, el('td', { class: 'num', text: f(g.value, 4) }), el('td', { class: 'num', text: M.fmtRel(g.rel) }),
        el('td', { class: 'key' }, pathNode(g.rows.map((r) => `${REPO[r.repo]} ${where(r)}${r.kind.startsWith('implied') ? ' (implied)' : ''}`).join('; ')))))));
    $('radii-table').replaceChildren(t);
  }

  // ---------------------------------------------------------------- picker
  const roleRank = { canon: 0, module: 1, vendor: 2, page: 3, prose: 4, research: 5, test: 6 };
  function describe(g) {
    const r = g.rows.slice().sort((a, b) => roleRank[a.role] - roleRank[b.role])[0];
    return `${REPO[r.repo]} ${R.ROLES[r.role]}, ${r.path.split('/').pop()}:${r.foundLine || r.line}${r.kind.startsWith('implied') ? ' (implied)' : ''}${r.approx ? ' (~)' : ''}`;
  }
  const muOpts = A.groups.mu.filter((g) => g.family === 'mu');
  const rOpts = A.groups.R.filter((g) => g.family === 'R');
  const rotOpts = A.groups.rot.filter((g) => g.family === 'rot');
  function fill(sel, groups, unit, extra) {
    sel.replaceChildren(...groups.map((g, i) => el('option', { value: String(i), text: `${f(g.value, g.value % 1 ? Math.min(6, String(g.value).split('.')[1].length) : 0)} ${unit} · ${describe(g)}` })));
    if (extra) sel.append(el('option', { value: 'none', text: extra }));
  }
  fill($('pick-mu'), muOpts, 'km³/s²');
  fill($('pick-r'), rOpts, 'km');
  fill($('pick-rot'), rotOpts, 'km/s', 'none stated · Aster src/v2');
  const indexOfValue = (groups, v) => groups.findIndex((g) => Math.abs(g.value - v) < 1e-9);
  function setEarth(e) {
    $('pick-mu').value = String(indexOfValue(muOpts, e.mu));
    $('pick-r').value = String(indexOfValue(rOpts, e.R));
    $('pick-rot').value = e.vRot == null ? 'none' : String(indexOfValue(rotOpts, e.vRot));
    renderPick();
  }
  const presetButtons = A.earths.map((e) => el('button', { type: 'button', 'aria-pressed': 'false', text: e.label, onclick: () => setEarth(e) }));
  $('presets').replaceChildren(...presetButtons);

  function renderPick() {
    const mu = muOpts[Number($('pick-mu').value)].value;
    const Rk = rOpts[Number($('pick-r').value)].value;
    const rv = $('pick-rot').value;
    const custom = { id: 'custom', label: 'the chosen Earth', mu, R: Rk, g0: S.g0, vRot: rv === 'none' ? null : rotOpts[Number(rv)].value, sources: {} };
    A.earths.forEach((e, i) => presetButtons[i].setAttribute('aria-pressed', String(e.mu === custom.mu && Math.abs(e.R - custom.R) < 1e-9 && e.vRot === custom.vRot)));
    const t = M.deriveCanon(canon, custom).filter((q) => q.depends.length);
    const base = M.deriveCanon(canon, S).filter((q) => q.depends.length);
    const checked = t.filter((q) => q.reproduces !== null);
    const okN = checked.filter((q) => q.reproduces).length;
    const sh = M.c3Shift(canon, S, custom, canon.kinematics.v_tip_kms);
    const cisT = M.tiers(canon).find((x) => x.id === 'cislunar');
    const cisA = M.release(canon, custom, cisT.vTip).apogee;
    const cisS = M.release(canon, S, cisT.vTip).apogee;
    $('pick-summary').textContent = `On this Earth ${okN} of ${checked.length} checkable Earth-dependent values round to what rev_a.json prints. From Skyhook's Earth the reference C3 moves ${sgn(sh.both, 4)} km²/s² and the cislunar apogee ${sgn(cisA - cisS, 0)} km.`;
    const refused = t.filter((q) => q.refused && !q.depends.includes('target'));
    $('pick-refusal').replaceChildren(...(refused.length ? [el('div', { class: 'refusal' }, el('b', { text: 'Refused, not guessed: ' }),
      `${refused.map((q) => q.label).join('; ')}. ${refused[0].refused.reason.replace(/^./, (c) => c.toUpperCase())}. What would help: ${refused[0].refused.what_would_help}.`)] : []));
    const dp = (q) => M.decimalsOf(q.printed == null ? 0 : q.printed) + 1;
    const body = t.map((q, i) => {
      const b = base[i];
      const val = q.refused ? el('td', { class: 'num', text: 'refused' }) : el('td', { class: 'num' }, f(q.value, dp(q)), el('span', { class: `mark ${q.reproduces ? 'ok' : 'no'}`, text: q.reproduces ? '✓' : '✗', 'aria-label': q.reproduces ? 'rounds to the printed value' : 'does not round to the printed value' }));
      const d = q.refused || b.refused || q.value == null || b.value == null ? '' : sgn(q.value - b.value, dp(q));
      return el('tr', null, el('td', null, el('span', { text: q.label }), el('span', { class: 'keypath' }, pathNode(q.path))),
        el('td', { class: 'num', text: M.fmtPrinted(q.printed) }), val, el('td', { class: 'num', text: d }));
    });
    $('pick-table').replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'rev_a.json value' }), el('th', { class: 'num', text: 'printed' }), el('th', { class: 'num', text: 'this Earth' }), el('th', { class: 'num', text: 'Δ from Skyhook' }))), el('tbody', null, body));
  }
  ['pick-mu', 'pick-r', 'pick-rot'].forEach((id) => $(id).addEventListener('change', renderPick));

  // ---------------------------------------------------------------- K2
  function drawK2() {
    const bars = [['μ only', ref.c3.shift.muOnly, 6], ['radius only', ref.c3.shift.rOnly, 4], ['both (each side consistent)', ref.c3.shift.both, 4], ['mixed: one side\'s speed, other\'s radius', ref.c3.shift.mixed, 4]];
    const box = $('k2-chart');
    const W = Math.max(300, Math.round(box.clientWidth || 600));
    const rowH = 40;
    const H = rowH * bars.length + 26;
    const padL = 8;
    const padR = 70;
    const max = Math.max(...bars.map((b) => Math.abs(b[1])));
    const step = max > 0.1 ? 0.04 : 0.01;
    const hi = Math.ceil(max / step) * step;
    const x = (v) => padL + (Math.max(0, v) / hi) * (W - padL - padR);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (let t = 0; t <= hi + 1e-12; t += step) {
      s.append(svg('line', { class: 'axis', x1: x(t), x2: x(t), y1: 0, y2: H - 20 }));
      s.append(svg('text', { class: 'tick', x: x(t), y: H - 6, 'text-anchor': 'middle' }, f(t, 2)));
    }
    bars.forEach(([label, v, d], i) => {
      const y = i * rowH + 20;
      s.append(svg('text', { class: 'lbl', x: padL, y: y - 6 }, label));
      const w = Math.max(1.5, x(Math.abs(v)) - padL);
      s.append(svg('rect', { class: 'bar', x: padL, y, width: w, height: 12, rx: 2 }));
      s.append(svg('text', { class: 'lbl strong', x: padL + w + 6, y: y + 10 }, `${sgn(v, d)}`));
    });
    box.replaceChildren(s, el('p', { class: 'small', text: `Bar length is the size of the shift in km²/s², for the ${ref.label} tier; the sign is in the label.` }));
    box.setAttribute('aria-label', `C3 shift for the ${ref.label} tier from Skyhook's Earth to Aster's: ${bars.map((b) => `${b[0]} ${sgn(b[1], b[2])}`).join('; ')} km²/s²`);

    const T = A.iface;
    const k2rows = [
      ['C3 on Skyhook\'s Earth, km²/s²', (t) => f(t.c3.A, 4)],
      ['C3 on Aster\'s Earth', (t) => f(t.c3.B, 4)],
      ['Δ from μ only', (t) => sgn(t.c3.shift.muOnly, 6)],
      ['Δ from the radius only', (t) => sgn(t.c3.shift.rOnly, 4)],
      ['Δ mixed (speed of one, radius of the other)', (t) => sgn(t.c3.shift.mixed, 4)],
      ['apogee shift, km', (t) => (t.apogee.A == null ? 'escape' : sgn(t.apogee.B - t.apogee.A, 0))],
      ['v∞* = √C3, km/s (Skyhook → Aster)', (t) => (t.vInfStar.A == null ? ['none', 'C3 < 0'] : [f(t.vInfStar.A, 4), `→ ${f(t.vInfStar.B, 4)}`])],
      ['trim at v∞ = 0 (Tip Match), km/s', (t) => [f(t.trim0.A, 4), `→ ${f(t.trim0.B, 4)}`]],
      ['Aster injection to this C3, Δ m/s', (t) => sgn(1000 * (t.injection.BonB - t.injection.AonA), 2)],
    ];
    $('k2-table').replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'tip speed' }), T.map((t) => el('th', { class: 'num', text: `${f(t.vTip, 1)} km/s` })))),
      el('tbody', null, k2rows.map(([label, fn]) => el('tr', null, el('td', { text: label }), T.map((t) => {
        const v = fn(t);
        return Array.isArray(v) ? el('td', { class: 'num' }, v[0], el('br'), el('span', { class: 'small', text: v[1] })) : el('td', { class: 'num', text: v });
      })))));

    $('pins-table').replaceChildren(el('thead', null, el('tr', null, ['C3 km²/s², published at', 'published km/s', 'on Aster\'s Earth', 'on Skyhook\'s Earth'].map((h, i) => el('th', { class: i ? 'num' : null, text: h })))),
      el('tbody', null, A.pins.map((p) => el('tr', null,
        el('td', null, String(p.c3), el('br'), el('span', { class: 'small site' }, pathNode(p.where))),
        el('td', { class: 'num', text: p.printed }),
        el('td', { class: 'num' }, f(p.dvAster, 4), el('span', { class: `mark ${p.reproduces ? 'ok' : 'no'}`, text: p.reproduces ? '✓' : '✗' })),
        el('td', { class: 'num' }, f(p.dvSky, 4), el('span', { class: `mark ${p.reproducesOnSkyhook ? 'ok' : 'no'}`, text: p.reproducesOnSkyhook ? '✓' : '✗' }))))));
  }

  // ---------------------------------------------------------------- reboost
  function drawReboost() {
    const RB = A.reboostRows;
    const rbRows = [
      ['2·v_orb·v_tip (the finance model)', 'momentum'],
      ['orbital energy the tether loses', 'orbital'],
      ['n·ΔH (angular-momentum check)', 'angular'],
      ['orbital energy, ground-relative catch', 'groundRel'],
    ];
    $('rb-table').replaceChildren(el('thead', null, el('tr', null, el('th', { text: 'MJ/kg at tip speed' }), RB.map((t) => el('th', { class: 'num', text: `${f(t.vTip, 1)} km/s` })))),
      el('tbody', null, rbRows.map(([label, k]) => el('tr', null, el('td', { text: label }), RB.map((t) => el('td', { class: 'num', text: t.byEarth.skyhook[k] == null ? 'refused' : f(t.byEarth.skyhook[k], 2) }))))));
    const s0 = A.sweep[0];
    $('rb-text').textContent = `MJ/kg, computed on Skyhook's Earth. The finance model books 2·v_orb·v_tip (finance/skyhook_finance.py:215). The payload's orbital-energy gain, which is what the tether loses, adds μ(1/r_low − 1/r_tip) = ${f(reb.potential, 3)} MJ/kg (${pct(reb.potential / reb.momentum, 1)}); mean motion times the payload's angular-momentum gain agrees with it to ${f((100 * Math.abs(reb.angular - reb.orbital)) / reb.orbital, 2)}\u00a0%. The ground-relative column takes the catch speed in the wrong frame and is shown only because it is the nearest principled reading to MP-001.`;
    const dec = (v) => (v % 1 ? Math.min(2, String(v).split('.')[1].length) : 0);
    const statedRows = A.groups.energy.slice().sort((a, b) => (a.family === b.family ? b.value - a.value : a.family === 'energy' ? -1 : 1)).map((g) => el('tr', null,
      el('td', { class: 'num', text: g.family === 'elec' ? `${f(g.value, 0)} kWh/kg el.` : `${f(g.value, dec(g.value))} MJ/kg` }),
      el('td', { text: g.rows.map((r) => (r.approx ? `~${r.literal}` : r.literal) + (r.unit === 'kWhkg' ? ' kWh/kg' : r.unit === 'kWhkgE' ? ' kWh/kg' : ' MJ/kg')).filter((v, i, a) => a.indexOf(v) === i).join(', ') }),
      el('td', { class: 'key' }, pathNode(g.rows.map(where).join(', ')))));
    $('rb-stated').replaceChildren(el('thead', null, el('tr', null, el('th', { class: 'num', text: 'value' }), el('th', { text: 'as written' }), el('th', { text: 'where' }))), el('tbody', null, statedRows));
    $('rb-sweep').textContent = `A sweep of ${A.sweep.length} readings of the canon (radius, printed or computed speeds, catch frame, potential term) finds none that rounds to ${A.target}; the nearest is ${f(s0.value, 2)} (${s0.catchName}, ${s0.peName}). Where MP-001's figure comes from is not in the repository.`;
    if (A.gridCheck.refused) {
      $('grid-table').replaceChildren();
      $('grid-text').textContent = `Refused: ${A.gridCheck.refused.reason}. ${A.gridCheck.refused.what_would_help}.`;
      return;
    }
    const gh = ['tier · column', 'published $/kg', 'momentum view', 'on Aster\'s Earth', 'orbital view'];
    $('grid-table').replaceChildren(el('thead', null, el('tr', null, gh.map((h, i) => el('th', { class: i ? `num${i === 4 ? ' wide-only' : ''}` : null, text: h })))),
      el('tbody', null, A.gridCheck.points.map((p) => {
        const okS = M.reproduces(p.dollars.skyhook.momentum, p.published.reboost_electricity_per_kg);
        const okA = M.reproduces(p.dollars.aster.momentum, p.published.reboost_electricity_per_kg);
        return el('tr', null, el('td', null, p.tier, el('br'), el('span', { class: 'small', text: p.column })), el('td', { class: 'num', text: f(p.published.reboost_electricity_per_kg, 4) }),
          el('td', { class: 'num' }, f(p.dollars.skyhook.momentum, 4), el('span', { class: `mark ${okS ? 'ok' : 'no'}`, text: okS ? '✓' : '✗' })),
          el('td', { class: 'num' }, f(p.dollars.aster.momentum, 4), el('span', { class: `mark ${okA ? 'ok' : 'no'}`, text: okA ? '✓' : '✗' })),
          el('td', { class: 'num wide-only' }, f(p.dollars.skyhook.orbital, 4), el('br'), el('span', { class: 'small', text: sgn(p.dollars.skyhook.orbital - p.published.reboost_electricity_per_kg, 2) })));
      })));
    const nS = A.gridCheck.points.filter((p) => M.reproduces(p.dollars.skyhook.momentum, p.published.reboost_electricity_per_kg)).length;
    $('grid-text').textContent = `${nS} of ${A.gridCheck.points.length} published lines reproduce as 2·v_orb·v_tip on Skyhook's Earth and none on Aster's, so the grid prices the momentum view on the ${f(S.R, 0)} km Earth. Booking the orbital energy instead adds ${sgn(cons.dollars.skyhook.orbital - cons.published.reboost_electricity_per_kg, 2)} $/kg to the conservative column's ${f(cons.published.marginal_cost_per_kg, 2)} $/kg marginal cost.`;
  }

  // ---------------------------------------------------------------- concordance
  const FAMS = [['mu', 'μ', 'km³/s²'], ['R', 'radius', 'km'], ['g0', 'g0', 'm/s²'], ['rot', 'rotation', 'km/s'], ['energy', 'reboost energy', 'MJ/kg']];
  let fam = 'mu';
  let repo = 'both';
  const famButtons = FAMS.map(([id, label]) => el('button', { type: 'button', 'aria-pressed': String(id === fam), text: label, onclick: () => { fam = id; renderConc(); } }));
  const repoButtons = [['both', 'both repositories'], ['aster', 'Aster'], ['skyhook', 'Skyhook']].map(([id, label]) => el('button', { type: 'button', 'aria-pressed': String(id === repo), text: label, onclick: () => { repo = id; renderConc(); } }));
  $('fam-chips').replaceChildren(...famButtons);
  $('repo-chips').replaceChildren(...repoButtons);
  const kindNote = (r) => (r.kind === 'comment' ? 'comment' : r.kind.startsWith('implied') ? 'implied' : r.kind === 'equivalent' ? 'as metres per second of UT1 error' : r.approx ? 'approximate' : r.kind === 'formula' ? 'formula' : '');
  function renderConc() {
    famButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(FAMS[i][0] === fam)));
    repoButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent.toLowerCase().startsWith(repo === 'both' ? 'both' : REPO[repo].toLowerCase()))));
    const unit = FAMS.find((x) => x[0] === fam)[2];
    const groups = A.groups[fam].map((g) => Object.assign({}, g, { rows: g.rows.filter((r) => repo === 'both' || r.repo === repo) })).filter((g) => g.rows.length);
    const out = groups.map((g) => el('div', { class: 'group' },
      el('div', { class: 'gv' }, el('span', { class: 'val', text: g.family === 'elec' ? `${f(g.value, 0)} kWh/kg electrical` : `${f(g.value, g.value % 1 ? Math.min(6, String(g.value).split('.')[1].length) : 0)} ${unit}` }),
        g.rel == null ? null : el('span', { class: 'rel', text: `${M.fmtRel(g.rel)} relative` })),
      el('ul', null, g.rows.map((r) => el('li', null,
        el('details', { class: 'line' }, el('summary', null, el('span', { class: `dot ${r.repo}`, 'aria-hidden': 'true' }), el('span', { class: 'badge', text: `${REPO[r.repo]} ${R.ROLES[r.role]}` }), el('span', { class: 'site' }, pathNode(where(r))), kindNote(r) ? el('span', { class: 'small', text: ` · ${kindNote(r)}` }) : null, r.status !== 'ok' ? el('span', { class: 'no', text: ` · ${r.status}` }) : null),
          el('pre', { text: r.text == null ? '(line not recorded)' : r.text.trim() }), r.note ? el('div', { class: 'small', text: r.note }) : null))))));
    if (fam === 'rot' && repo !== 'skyhook') out.push(el('div', { class: 'refusal' }, el('b', { text: 'Aster: none stated. ' }), 'src/v2 has no Earth rotation rate, so nothing here computes a ground-relative speed on Aster\'s Earth. What would help: the rate Slice 21 plans (strategy/ASTER_ROADMAP_2026-08.md:283-285), or a K2 decision to import Skyhook\'s.'));
    if (fam === 'energy') {
      const siteItem = (r) => el('li', null, el('details', { class: 'line' },
        el('summary', null, el('span', { class: `dot ${r.repo}`, 'aria-hidden': 'true' }), el('span', { class: 'badge', text: `${REPO[r.repo]} ${R.ROLES[r.role]}` }), el('span', { class: 'site' }, pathNode(where(r))), el('span', { class: 'small', text: ` · ${r.kind}` })),
        el('pre', { text: r.text == null ? '(line not recorded)' : r.text.trim() }), el('div', { class: 'small', text: r.note })));
      const fin = rows.find((r) => r.id === 'sk-fin-energy');
      const claim = rows.find((r) => r.id === 'sk-manifest-claim-71');
      if (fin && (repo === 'both' || fin.repo === repo)) {
        out.unshift(el('div', { class: 'group' }, el('div', { class: 'gv' }, el('span', { class: 'val', text: `${f(reb.momentum, 2)} MJ/kg (computed)` }), el('span', { class: 'rel', text: 'the reference the others are compared with' })),
          el('ul', null, siteItem(fin))));
      }
      if (claim && (repo === 'both' || claim.repo === repo)) {
        out.push(el('div', { class: 'group' }, el('div', { class: 'gv' }, el('span', { class: 'val', text: 'A claim about the figure' }), el('span', { class: 'rel', text: 'no value of its own' })),
          el('ul', null, siteItem(claim))));
      }
    }
    $('conc-list').replaceChildren(...out);
    const sums = [];
    if (D.scans) for (const s of Object.values(D.scans)) for (const sum of Object.values(s.summaries || {})) {
      const vals = Object.entries(sum.byValue).filter(([k]) => k.startsWith(`${fam} `)).map(([k, n]) => `${k.slice(fam.length + 1)} ×${n}`);
      if (vals.length) sums.push(`Not listed above: ${sum.why} — ${sum.files.length} files state ${vals.join(', ')}.`);
    }
    $('conc-excluded').textContent = sums.join(' ');
  }

  // ---------------------------------------------------------------- gates and provenance
  $('gates').replaceChildren(...A.gates.map((g) => el('li', null, el('span', { class: `status-pill ${g.ok ? 'pass' : 'fail'}`, text: g.ok ? 'pass' : 'FAIL' }), el('code', { text: g.id }), ` ${g.detail}`)));
  const snaps = D.snapshots || [];
  $('prov').textContent = `Arithmetic inputs: ${snaps.length} snapshots under snapshots/ with provenance sidecars (${snaps.filter((x) => x.mode === 'copy').map((x) => x.path).join(', ')} whole; the rest line-preserving excerpts or derived JSON). Citations: line text recorded in data.js from the checkouts named above.`;

  // ---------------------------------------------------------------- go
  drawRadii();
  setEarth(AS);
  drawK2();
  drawReboost();
  renderConc();
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastW) < 20) return;
    lastW = window.innerWidth;
    drawRadii();
    drawK2();
  });
})();
