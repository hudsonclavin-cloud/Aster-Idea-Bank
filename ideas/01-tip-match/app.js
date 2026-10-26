// Tip Match page logic. All numbers come from TipMatch (tip-match.js) fed the rev_a.json snapshot
// (snapshots/rev_a.data.js) and the Aster data module (snapshots/aster.data.js). Nothing numeric
// is typed here except axis ranges and layout sizes for the drawings.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const kernel = TipMatch.create(REV_A.data, REV_A.provenance, typeof ASTER_DATA === 'undefined' ? null : ASTER_DATA);
  const C = kernel.constants;
  const SHORT = String(REV_A.provenance.commit || '').slice(0, 7);
  const ASTER_SHORT = typeof ASTER_DATA === 'undefined' ? '' : String((ASTER_DATA.provenance || {}).commit || '').slice(0, 7);

  const state = { vinf: 0, tier: 'reference', tol: TipMatch.DEFAULT_TOLERANCE_MS, source: 'typed', reading: 'entry-125' };

  // ---------------------------------------------------------------- formatting
  const f = (x, d) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
  const kms = (q, d = 3) => (q ? `${f(q.value, d)} km/s` : '—');
  function setText(el, text) {
    el.textContent = text;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- controls
  function buildTiers() {
    const box = $('tiers');
    for (const key of C.tierOrder) {
      const t = C.tiers[key];
      const lab = el('label');
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'tier';
      inp.value = key;
      inp.checked = key === state.tier;
      const span = el('span');
      const k = el('span', `key ${key}`);
      k.setAttribute('aria-hidden', 'true');
      span.appendChild(k);
      span.appendChild(document.createTextNode(` ${t.label} · ${f(t.v_tip_kms, 1)} km/s`));
      lab.appendChild(inp);
      lab.appendChild(span);
      lab.title = t.detail;
      box.appendChild(lab);
    }
    box.addEventListener('change', (e) => {
      if (e.target.name === 'tier') {
        state.tier = e.target.value;
        render();
      }
    });
  }

  function clampVinf(x) {
    if (!Number.isFinite(x)) return NaN;
    return Math.min(PLOT.vmax, Math.max(PLOT.vmin, x));
  }
  $('vinf').addEventListener('input', (e) => {
    state.vinf = clampVinf(Number(e.target.value));
    $('vinf-num').value = String(state.vinf);
    render();
  });
  $('vinf-num').addEventListener('input', (e) => {
    const raw = e.target.value.trim();
    const v = raw === '' ? NaN : Number(raw);
    state.vinf = Number.isFinite(v) ? v : raw === '' ? '' : raw; // let the kernel refuse an empty or bad field
    if (Number.isFinite(v)) $('vinf').value = String(clampVinf(v));
    render();
  });
  $('tol').value = String(TipMatch.DEFAULT_TOLERANCE_MS);
  $('tol').addEventListener('input', (e) => {
    const raw = e.target.value.trim();
    state.tol = raw === '' ? NaN : Number(raw);
    render();
  });
  document.querySelectorAll('input[name="src"]').forEach((r) =>
    r.addEventListener('change', (e) => {
      state.source = e.target.value;
      render();
    })
  );
  document.querySelectorAll('input[name="reading"]').forEach((r) =>
    r.addEventListener('change', (e) => {
      state.reading = e.target.value;
      render();
    })
  );
  $('set-parabolic').addEventListener('click', () => setVinf(0));
  $('set-star').addEventListener('click', () => {
    const e = kernel.tierEnergy('phase3');
    if (e && e.vinf_star_kms !== null) {
      const r = document.querySelector('input[name="tier"][value="phase3"]');
      if (r) {
        r.checked = true;
        state.tier = 'phase3';
      }
      setVinf(Math.round(e.vinf_star_kms * 1000) / 1000);
    }
  });
  function setVinf(v) {
    state.vinf = v;
    $('vinf').value = String(v);
    $('vinf-num').value = String(v);
    render();
  }

  // ---------------------------------------------------------------- render
  // Every render is guarded: if anything throws, the page shows a refusal-style card and hides
  // the numbers, so a stale result never sits under a new input.
  function render() {
    try {
      renderInner();
    } catch (err) {
      showError(err);
    }
  }

  function renderInner() {
    const asOf = TipMatch.isoDate();
    const results = $('results');
    const verdict = $('verdict');
    verdict.classList.remove('matched', 'unmatched');
    const nh = kernel.nhats({ tier: state.tier, tolerance_ms: state.tol, reading: state.reading, as_of: asOf });
    renderNhats(nh);

    if (state.source !== 'typed') {
      results.classList.add('hidden');
      const env = kernel.vinfSource(state.source, { as_of: asOf });
      showRefusal(env, 'There is no such input');
      setText($('headline'), 'Refused: Aster computes no Earth-arrival v∞; its screening cache holds outbound-leg quantities only.');
      renderChips(null);
      setText($('verdict-note'), 'Switch back to "Typed above" to explore the energy condition with a v∞ you supply. The JPL NHATS arrival speeds below are external data, shown separately and labelled as such.');
      return;
    }

    const env = kernel.energy({ vinf_kms: state.vinf, tier: state.tier, tolerance_ms: state.tol, as_of: asOf });
    if (!env.value) {
      results.classList.add('hidden');
      showRefusal(env, 'Refused');
      setText($('headline'), `Refused (${env.refusal.code.replace(/_/g, ' ')}).`);
      renderChips(null);
      setText($('verdict-note'), env.refusal.reason);
      return;
    }
    $('refusal-card').hidden = true;
    results.classList.remove('hidden');
    const v = env.value;
    const u = v.upper_tip;
    verdict.classList.add(v.match.energy_matched ? 'matched' : 'unmatched');

    // headline: the trim in m/s with enough digits that a near-miss never reads as zero
    const h = $('headline');
    h.textContent = '';
    if (v.match.energy_matched) {
      h.appendChild(document.createTextNode(`Energy-matched: at v∞ = ${f(v.input.vinf_kms.value, 3)} km/s the ${v.tier.label} tip and the payload differ by `));
      h.appendChild(el('span', 'num', TipMatch.formatSpeedDiff(u.trim_dv_ms.value)));
      h.appendChild(document.createTextNode(`, inside your ${f(v.match.tolerance_ms.value, 1)} m/s tolerance. Plane and phase are not evaluated.`));
    } else {
      h.appendChild(document.createTextNode(`Not matched: the payload passes the ${v.tier.label} tip `));
      h.appendChild(el('span', 'num', TipMatch.formatSpeedDiff(u.trim_dv_ms.value)));
      h.appendChild(document.createTextNode(` ${u.payload_faster_than_tip ? 'faster' : 'slower'} than the tip moves. ${u.payload_faster_than_tip ? 'A retrograde' : 'A prograde'} trim of that size would be needed.`));
    }
    renderChips(v);
    const star = u.vinf_star_kms;
    setText(
      $('verdict-note'),
      star
        ? `This tier's release C3 is ${f(u.c3_tier_kms2.value, 2)} km²/s², so it meets exactly one v∞ with zero trim: v∞* = √C3 = ${f(star.value, 3)} km/s.`
        : `This tier's release C3 is ${f(u.c3_tier_kms2.value, 2)} km²/s² (bound: apogee ${Math.round(u.apogee_altitude_km.value).toLocaleString('en-US')} km). Every hyperbolic arrival is faster than the tip; even a parabolic one (v∞ = 0) is ${f(u.parabolic_speed_at_tip_kms.value - u.v_tip_inertial_kms.value, 3)} km/s too fast. A payload falling back on this tier's own release orbit (C3 < 0, outside this input) would meet it with zero trim.`
    );

    renderChart(v, nh.value);
    renderNumbers(v, env);
    renderLower(v);
    renderZeroTrim(v);
    renderConditions(v);
    $('envelope').textContent = JSON.stringify({ energy: env, plane: kernel.plane({ as_of: asOf }), phase: kernel.phase({ as_of: asOf }) }, null, 2);
    setText($('prov'), `Tether constants: Skyhook params/rev_a.json @ ${SHORT} (${REV_A.provenance.commitDate ? REV_A.provenance.commitDate.slice(0, 10) : ''}), sha256 ${String(REV_A.provenance.sourceSha256).slice(0, 12)}…, revision ${C.revision}. Upper v∞ bound and NHATS records: Aster @ ${ASTER_SHORT}. Kernel tip-match.js ${TipMatch.KERNEL_VERSION}. Envelope confidence "${env.confidence}": the weakest of its sources, because the tip speed and altitude are design choices and v∞ is typed.`);
  }

  function showRefusal(env, title) {
    const card = $('refusal-card');
    card.hidden = false;
    card.textContent = '';
    card.className = 'card cond refused';
    card.appendChild(el('div', 'status', `${title} · ${env.refusal.code}`));
    card.appendChild(el('p', '', env.refusal.reason));
    const w = el('p', 'what');
    w.appendChild(el('b', '', 'What would help: '));
    w.appendChild(document.createTextNode(env.refusal.what_would_help));
    card.appendChild(w);
    $('results').classList.add('hidden');
  }

  function showError(err) {
    $('results').classList.add('hidden');
    $('verdict').classList.remove('matched', 'unmatched');
    const card = $('refusal-card');
    card.hidden = false;
    card.textContent = '';
    card.className = 'card cond refused';
    card.appendChild(el('div', 'status', 'Not evaluated · the kernel threw'));
    card.appendChild(el('p', '', String((err && err.message) || err)));
    const w = el('p', 'what');
    w.appendChild(el('b', '', 'What would help: '));
    w.appendChild(document.createTextNode('A finite v∞ between 0 and the stated upper bound, a known tier and a non-negative tolerance. No numbers are shown for this input.'));
    card.appendChild(w);
    setText($('headline'), 'Refused: this input could not be evaluated.');
    renderChips(null);
    setText($('verdict-note'), '');
  }

  function renderChips(v) {
    const box = $('chips');
    box.textContent = '';
    const chip = (cls, icon, text) => {
      const c = el('span', `chip ${cls}`);
      c.appendChild(el('span', 'dot'));
      c.appendChild(el('span', 'ic', icon));
      c.appendChild(document.createTextNode(text));
      box.appendChild(c);
    };
    if (!v) {
      chip('refused', '!', 'energy: refused');
      chip('refused', '!', 'plane: refused');
      chip('refused', '!', 'phase: refused');
      return;
    }
    chip(v.match.energy_matched ? 'good' : 'bad', v.match.energy_matched ? '✓' : '✕', v.match.energy_matched ? 'energy: matched' : 'energy: not matched');
    chip('refused', '!', 'plane: refused (no v∞ vector)');
    chip('refused', '!', 'phase: refused (no tether ephemeris)');
  }

  // ---------------------------------------------------------------- chart
  // The viewBox is sized to the real pixel width so labels stay 11–12 px on a phone (an SVG
  // scaled from 680 to 358 px would halve them). Axis ranges are drawing choices, not physics.
  const PLOT = { x0: 56, x1: 600, y0: 24, y1: 320, w: 680, h: 380, vmin: 0, vmax: 8, smin: 9.5, smax: 13.5 };
  function sizeChart(svg) {
    const px = Math.round(svg.parentElement.getBoundingClientRect().width) || 680;
    const w = Math.max(300, Math.min(900, px));
    const narrow = w < 560;
    PLOT.w = w;
    PLOT.h = narrow ? 300 : 380;
    PLOT.x0 = narrow ? 44 : 56;
    PLOT.x1 = w - (narrow ? 58 : 80);
    PLOT.y0 = 24;
    PLOT.y1 = PLOT.h - 60;
    svg.setAttribute('viewBox', `0 0 ${PLOT.w} ${PLOT.h}`);
    return narrow;
  }
  const sx = (v) => PLOT.x0 + ((v - PLOT.vmin) / (PLOT.vmax - PLOT.vmin)) * (PLOT.x1 - PLOT.x0);
  const sy = (s) => PLOT.y1 - ((s - PLOT.smin) / (PLOT.smax - PLOT.smin)) * (PLOT.y1 - PLOT.y0);
  const NS = 'http://www.w3.org/2000/svg';
  let chartDocListener = false;
  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function box(node) {
    try {
      const b = node.getBBox();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch (e) {
      return null;
    }
  }
  function overlaps(a, b, pad) {
    if (!a || !b) return false;
    return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  }

  function renderChart(v, nhatsValue) {
    const svg = $('chart');
    const narrow = sizeChart(svg);
    Array.from(svg.childNodes).forEach((n) => {
      const keep = n.nodeType === 1 && (n.tagName === 'title' || n.tagName === 'desc');
      if (!keep) svg.removeChild(n);
    });
    const g = svgEl('g', {});
    svg.appendChild(g);
    // grid + axes
    for (let s = Math.ceil(PLOT.smin); s <= Math.floor(PLOT.smax); s += 1) {
      g.appendChild(svgEl('line', { class: 'grid', x1: PLOT.x0, x2: PLOT.x1, y1: sy(s), y2: sy(s) }));
      g.appendChild(svgEl('text', { x: PLOT.x0 - 8, y: sy(s) + 4, 'text-anchor': 'end', class: 'mono' }, `${s}`));
    }
    g.appendChild(svgEl('line', { class: 'axis', x1: PLOT.x0, x2: PLOT.x1, y1: PLOT.y1, y2: PLOT.y1 }));
    for (let x = PLOT.vmin; x <= PLOT.vmax; x += narrow ? 2 : 1) {
      g.appendChild(svgEl('line', { class: 'axis', x1: sx(x), x2: sx(x), y1: PLOT.y1, y2: PLOT.y1 + 5 }));
      g.appendChild(svgEl('text', { x: sx(x), y: PLOT.y1 + 18, 'text-anchor': 'middle' }, `${x}`));
    }
    g.appendChild(svgEl('text', { x: (PLOT.x0 + PLOT.x1) / 2, y: PLOT.h - 16, 'text-anchor': 'middle', class: 'axis-label' }, 'Earth-arrival v∞, km/s'));
    g.appendChild(svgEl('text', { x: 14, y: (PLOT.y0 + PLOT.y1) / 2, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 14 ${(PLOT.y0 + PLOT.y1) / 2})` }, `speed at ${f(C.r_tip_km, 0)} km, km/s`));

    // NHATS rug: one tick per JPL record's v∞ along the foot of the plot
    if (nhatsValue) {
      const rug = svgEl('g', { class: 'rug' });
      for (const r of nhatsValue.records) {
        if (r.vinf_kms.value > PLOT.vmax) continue;
        const x = sx(r.vinf_kms.value);
        rug.appendChild(svgEl('line', { x1: x, x2: x, y1: PLOT.y1 - 9, y2: PLOT.y1 - 1 }));
      }
      g.appendChild(rug);
    }

    // tier lines with direct labels at the right end
    const tiers = C.tierOrder.map((k) => kernel.tierEnergy(k));
    for (const t of tiers) {
      const y = sy(t.v_tip_inertial_kms);
      g.appendChild(svgEl('line', { class: `tier-line ${t.key}${t.key === v.tier.key ? ' selected' : ''}`, x1: PLOT.x0, x2: PLOT.x1, y1: y, y2: y }));
      g.appendChild(svgEl('text', { x: PLOT.x1 + 6, y: y + 4, class: 'direct' }, `${f(t.v_tip_kms, 1)} tip`));
    }
    // payload curve
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const vv = PLOT.vmin + ((PLOT.vmax - PLOT.vmin) * i) / 160;
      pts.push(`${sx(vv).toFixed(1)},${sy(kernel.speedAtRadius(vv, C.r_tip_km)).toFixed(1)}`);
    }
    g.appendChild(svgEl('polyline', { class: 'payload-line', points: pts.join(' ') }));
    // direct label for the curve: on a phone, left of the steep part, clear of the v∞* region
    const lv = narrow ? 6 : 5.1;
    g.appendChild(svgEl('text', { x: narrow ? sx(lv) - 8 : sx(lv), y: sy(kernel.speedAtRadius(lv, C.r_tip_km)) - (narrow ? 4 : 10), class: 'direct', 'text-anchor': narrow ? 'end' : 'start' }, narrow ? 'payload' : 'payload at r_tip'));

    // v∞* of any tier with C3 > 0
    for (const t of tiers) {
      if (t.vinf_star_kms !== null) {
        const x = sx(t.vinf_star_kms);
        const y = sy(t.v_tip_inertial_kms);
        g.appendChild(svgEl('circle', { class: `marker ${t.key}`, cx: x, cy: y, r: 5 }));
        g.appendChild(svgEl('text', { x: x + 8, y: y + 16, class: 'star' }, `v∞* = ${f(t.vinf_star_kms, 3)}`));
      }
    }

    // current v∞: cursor, payload marker, selected tier marker, trim bracket
    const vin = v.input.vinf_kms.value;
    if (vin > PLOT.vmax) {
      g.appendChild(svgEl('text', { x: PLOT.x1 - 4, y: PLOT.y0 + 12, class: 'trim-label', 'text-anchor': 'end' }, `v∞ = ${f(vin, 3)} is off this axis →`));
    } else {
      const x = sx(vin);
      const yp = sy(v.upper_tip.v_payload_kms.value);
      const yt = sy(v.upper_tip.v_tip_inertial_kms.value);
      g.appendChild(svgEl('line', { class: 'cursor', x1: x, x2: x, y1: PLOT.y0, y2: PLOT.y1 }));
      g.appendChild(svgEl('line', { class: 'trim', x1: x, x2: x, y1: yp, y2: yt }));
      g.appendChild(svgEl('circle', { class: `marker ${v.tier.key}`, cx: x, cy: yt, r: 5 }));
      g.appendChild(svgEl('circle', { class: 'marker payload', cx: x, cy: yp, r: 5 }));
      const flip = vin > (narrow ? 4.2 : 5.5);
      const label = svgEl('text', { class: 'trim-label' }, `trim Δv ${TipMatch.signedSpeedDiff(v.upper_tip.trim_dv_ms.value)}`);
      g.appendChild(label);
      // Keep the trim label clear of every other chart label (v∞*, the payload and tier names):
      // above the upper marker on the preferred side, then below the lower marker, then the
      // other side; the first placement that touches nothing wins.
      const others = Array.from(g.querySelectorAll('text.star, text.direct'));
      const above = Math.max(PLOT.y0 + 10, Math.min(yp, yt) - 10);
      const below = Math.min(PLOT.y1 - 12, Math.max(yp, yt) + 18);
      const place = (y, left) => {
        label.setAttribute('y', String(y));
        label.setAttribute('x', String(left ? x - 8 : x + 8));
        label.setAttribute('text-anchor', left ? 'end' : 'start');
      };
      const tries = [];
      for (const dy of [0, 16]) for (const left of [flip, !flip]) tries.push([Math.max(PLOT.y0 + 10, above - dy), left], [Math.min(PLOT.y1 - 12, below + dy), left]);
      const clear = tries.find(([y, left]) => {
        place(y, left);
        const b = box(label);
        return b && b.x >= PLOT.x0 + 2 && b.x + b.w <= PLOT.w - 2 && !others.some((o) => overlaps(b, box(o), 3));
      });
      place(...(clear || tries[0]));
    }

    // legend
    const legend = $('legend');
    legend.textContent = '';
    const item = (cls, text) => {
      const s = el('span');
      s.appendChild(el('span', `key ${cls}`));
      s.appendChild(document.createTextNode(` ${text}`));
      legend.appendChild(s);
    };
    item('payload', 'payload speed at the upper-tip radius, √(v∞² + 2μ/r)');
    for (const t of tiers) item(t.key, `${C.tiers[t.key].label} tip, v_orb + ${f(t.v_tip_kms, 1)} = ${f(t.v_tip_inertial_kms, 3)} km/s`);
    if (nhatsValue) item('rug', `ticks: ${nhatsValue.summary.count} JPL NHATS returns' v∞ (v_arr_earth read at ${f(nhatsValue.reading.entry_altitude_km.value, 0)} km), external data`);

    // hover / touch crosshair: one tooltip, every series (a tap shows it too; a second tap elsewhere moves it)
    const onPointer = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * PLOT.w;
      if (px < PLOT.x0 || px > PLOT.x1) return hideTip();
      const vv = PLOT.vmin + ((px - PLOT.x0) / (PLOT.x1 - PLOT.x0)) * (PLOT.vmax - PLOT.vmin);
      showTip(ev.clientX - r.left, ev.clientY - r.top, vv, tiers, r.width);
    };
    svg.onpointermove = onPointer;
    svg.onpointerdown = onPointer;
    // a finger lifting fires pointerleave; keep a tapped tooltip until the next tap elsewhere
    svg.onpointerleave = (ev) => {
      if (ev.pointerType !== 'touch') hideTip();
    };
    if (!chartDocListener) {
      chartDocListener = true;
      document.addEventListener('pointerdown', (ev) => {
        if (!$('chart').contains(ev.target)) hideTip();
      });
      let timer = null;
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(render, 120);
      });
    }
  }
  function showTip(x, y, vv, tiers, width) {
    const tip = $('tip');
    tip.textContent = '';
    tip.appendChild(el('div', 'hd', `v∞ = ${f(vv, 2)} km/s`));
    const vp = kernel.speedAtRadius(vv, C.r_tip_km);
    const row = (cls, k, val) => {
      const r = el('div', 'r');
      const kk = el('span', 'k');
      kk.appendChild(el('span', `key ${cls}`));
      kk.appendChild(document.createTextNode(` ${k}`));
      r.appendChild(kk);
      r.appendChild(el('span', 'v', val));
      tip.appendChild(r);
    };
    row('payload', 'payload', `${f(vp, 3)}`);
    for (const t of tiers) row(t.key, `${C.tiers[t.key].label} trim`, `${vp - t.v_tip_inertial_kms >= 0 ? '+' : '−'}${f(Math.abs(vp - t.v_tip_inertial_kms), 3)}`);
    tip.classList.add('on');
    tip.setAttribute('aria-hidden', 'false');
    const left = x + 14 + 190 > width ? x - 14 - 190 : x + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, y - 10)}px`;
  }
  function hideTip() {
    const tip = $('tip');
    tip.classList.remove('on');
    tip.setAttribute('aria-hidden', 'true');
  }

  // ---------------------------------------------------------------- numbers table
  function renderNumbers(v, env) {
    const tb = $('numbers').querySelector('tbody');
    tb.textContent = '';
    const u = v.upper_tip;
    const g = v.geometry;
    const rows = [
      ['Earth radius R_E', `${f(g.earth_radius_km.value, 0)} km`, `rev_a.json kinematics._c3_note "r_tip=${f(C.r_tip_km, 0)} km" minus ${f(C.com_altitude_km, 0)} minus ${f(C.half_length_km, 0)}; equals physics/skyhook_physics.py:40 R_EARTH_KM. Not orbital.com_radius_km (${f(C.com_radius_km_as_stated, 0)} → ${f(C.com_radius_km_as_stated - C.com_altitude_km, 0)} km), which does not reproduce the file's C3.`],
      ['Centre-of-mass radius r_com', `${f(g.r_com_km.value, 0)} km`, `R_E + orbital.com_altitude_km (${f(C.com_altitude_km, 0)})`],
      ['Upper-tip radius r_tip', `${f(g.r_tip_km.value, 0)} km`, `r_com + geometry.tether_half_length_km (${f(C.half_length_km, 0)})`],
      ['Orbital speed v_orb', kms(g.v_orb_kms, 4), 'EQ-2 √(μ/r_com), μ = orbital.mu_earth_m3s2'],
      [`Tip inertial speed, ${v.tier.label}`, kms(u.v_tip_inertial_kms, 4), `v_orb + ${v.tier.v_tip_path} (${f(v.tier.v_tip_kms.value, 1)}); top of the swing, prograde`],
      ['Parabolic speed at r_tip', kms(u.parabolic_speed_at_tip_kms, 4), `√(2μ/r_tip): the slowest any arrival from beyond Earth can pass ${f(C.r_tip_km, 0)} km`],
      ['Payload speed at r_tip', kms(u.v_payload_kms, 4), `vis-viva √(v∞² + 2μ/r_tip) at v∞ = ${f(v.input.vinf_kms.value, 3)} (typed)`],
      ['Trim Δv (payload − tip)', `${u.trim_dv_kms.value >= 0 ? '+' : '−'}${f(Math.abs(u.trim_dv_kms.value), 4)} km/s = ${TipMatch.signedSpeedDiff(u.trim_dv_ms.value)}`, 'difference of the two rows above; positive = payload faster (retrograde trim)'],
      [`Release C3, ${v.tier.label}`, `${f(u.c3_tier_kms2.value, 3)} km²/s²`, `v_tip_inertial² − 2μ/r_tip (Skyhook EQ-7, apogee_from_release); rev_a.json states ${C.tiers[v.tier.key].stated.c3_kms2}`],
      [u.release_bound ? 'Release apogee altitude' : 'Release apogee', u.release_bound ? `${Math.round(u.apogee_altitude_km.value).toLocaleString('en-US')} km` : 'none (hyperbolic)', u.release_bound ? `2a − r_tip − R_E with a = −μ/C3; rev_a.json states ${C.tiers[v.tier.key].stated.apogee_altitude_km}` : 'C3 > 0'],
      ['Zero-trim v∞* for this tier', u.vinf_star_kms ? kms(u.vinf_star_kms, 4) : 'none (C3 < 0)', '√C3 when C3 > 0: the single arrival speed the tip can meet at rest'],
      ['Match flag', v.match.energy_matched ? 'energy-matched' : 'not matched', `|trim| ≤ ${f(v.match.tolerance_ms.value, 1)} m/s (your tolerance; default from ${TipMatch.TOLERANCE_SOURCE})`],
      ['Accepted v∞', `0 to ${kms(v.input.vinf_domain_max_kms, 2)}`, 'a Sun-bound arrival: solar escape speed plus Earth\'s speed, head-on, at Earth\'s perihelion (GM_sun, AU, Earth a and e from Aster src/physics/constants/index.ts)'],
      ['Envelope confidence', env.confidence, 'weakest of: μ, GM_sun measured; design parameters assumed; v∞ and tolerance assumed (typed); arithmetic derived'],
    ];
    for (const [k, val, trace] of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', '', k));
      tr.appendChild(el('td', 'v', val));
      tr.appendChild(el('td', 't', trace));
      tb.appendChild(tr);
    }
  }

  // ---------------------------------------------------------------- lower tip bars
  function renderLower(v) {
    const svg = $('lower-bars');
    svg.textContent = '';
    const L = v.lower_tip;
    const max = Math.max(PLOT.smax, L.v_payload_kms.value);
    const x0 = 120;
    const x1 = 340;
    const w = (s) => ((x1 - x0) * s) / max;
    const bar = (y, cls, label, val) => {
      svg.appendChild(svgEl('text', { x: x0 - 8, y: y + 15, 'text-anchor': 'end' }, label));
      const ww = Math.max(4, w(val));
      // 4px rounded data-end, square at the baseline
      const d = `M${x0},${y} h${ww - 4} a4,4 0 0 1 4,4 v14 a4,4 0 0 1 -4,4 h${-(ww - 4)} z`;
      svg.appendChild(svgEl('path', { class: `bar ${cls}`, d }));
      svg.appendChild(svgEl('text', { x: x0 + ww + 6, y: y + 15, class: 'val' }, `${f(val, 2)} km/s`));
    };
    svg.appendChild(svgEl('line', { x1: x0, x2: x0, y1: 12, y2: 98, stroke: 'var(--axis)' }));
    const lowAlt = v.geometry.r_low_km.value - v.geometry.earth_radius_km.value;
    bar(20, 'payload', `payload, ${f(lowAlt, 0)} km`, L.v_payload_kms.value);
    bar(60, 'lowtip', 'lower tip', L.v_tip_inertial_kms.value);
    setText(
      $('lower-note'),
      `At the lower-tip radius (${f(v.geometry.r_low_km.value, 0)} km, ${f(lowAlt, 0)} km up) any arrival from beyond Earth passes at ≥ ${f(kernel.speedAtRadius(0, C.r_low_km), 2)} km/s, while the lower tip moves at v_orb − v_tip = ${f(L.v_tip_inertial_kms.value, 3)} km/s the same way. Gap ${f(L.gap_kms.value, 2)} km/s: ${L.verdict}. Inbound payloads are an upper-tip question.`
    );
  }

  // ---------------------------------------------------------------- zero-trim tip speed
  function renderZeroTrim(v) {
    const z = v.zero_trim;
    const p = $('zero-trim');
    p.textContent = '';
    p.appendChild(document.createTextNode(`A tether at ${f(C.com_altitude_km, 0)} km with ${f(C.half_length_km, 0)} km arms would need a tip speed of `));
    p.appendChild(el('b', 'mono', `${f(z.tip_speed_needed_kms.value, 3)} km/s`));
    p.appendChild(document.createTextNode(` to meet v∞ = ${f(v.input.vinf_kms.value, 3)} km/s with zero trim: ${f(z.over_vc.value, 2)} × the characteristic velocity of Zylon PBO (V_c = ${f(z.v_c_kms.value, 2)} km/s, √(2σ/ρ) from rev_a.json materials).`));
    const ref = C.tiers[C.tierOrder[0]];
    const top = C.tiers[C.tierOrder[C.tierOrder.length - 1]];
    const parts = [];
    if (z.guardrail_over_vc) parts.push(`rev_a.json's mass-growth guardrail is ${z.guardrail_over_vc.value}× V_c (mass_ratio._ratio_note); this is ${z.beyond_guardrail ? 'beyond' : 'inside'} it.`);
    else parts.push('rev_a.json states no guardrail in the expected note; only the ratio is shown.');
    if (ref.stated.mass_ratio_30pct_derate !== null && top.stated.mass_ratio_30pct_derate !== null) {
      const derate = C.derate_fraction_as_stated === null ? '' : `, ${Math.round(C.derate_fraction_as_stated * 100)} % derate`;
      parts.push(`The file's integrated two-arm tether-to-payload mass ratio (EQ-6, x = (V_t/V_c)·√(SF/(1 − derate))${derate}) is ${ref.stated.mass_ratio_30pct_derate}× at ${f(ref.v_tip_kms, 1)} km/s and ${top.stated.mass_ratio_30pct_derate}× at ${f(top.v_tip_kms, 1)} km/s.`);
    }
    if (C.mars_escape_tip_speed_kms_as_stated !== null) parts.push(`Its top tier, ${f(top.v_tip_kms, 1)} km/s, is the file's Mars-escape threshold (market_thresholds.mars_escape_tip_speed_kms = ${C.mars_escape_tip_speed_kms_as_stated}).`);
    parts.push(`At v∞ = 0 the needed speed is the ${f(kernel.zeroTrimTipSpeed(0), 2)} km/s at which the file says escape (C3 = 0) is reached.`);
    setText($('zero-trim-note'), parts.join(' '));
  }

  // ---------------------------------------------------------------- conditions
  function renderConditions(v) {
    const box = $('conditions');
    box.textContent = '';
    for (const c of v.conditions) {
      const card = el('section', `card cond ${c.status}`);
      card.appendChild(el('div', 'status', `${c.condition} · ${c.status}`));
      if (c.status === 'computed') {
        card.appendChild(el('h3', '', 'Energy: can the speeds agree?'));
        card.appendChild(el('p', 'small', v.match.verdict + '.'));
        card.appendChild(el('p', 'small muted', 'Computed above from rev_a.json and your v∞. The speed difference is exact for the stated v∞; it is the whole velocity mismatch only if the payload\'s perigee is at the upper-tip radius and the catch is at the top of the swing, so it is a lower bound.'));
      } else {
        card.appendChild(el('h3', '', c.condition === 'plane' ? 'Plane: do the orbits share a plane?' : 'Phase: is the tip there at that instant?'));
        card.appendChild(el('p', 'small', c.refusal.reason));
        const w = el('p', 'small what');
        w.appendChild(el('b', '', 'What would help: '));
        w.appendChild(document.createTextNode(c.refusal.what_would_help));
        card.appendChild(w);
      }
      box.appendChild(card);
    }
  }

  // ---------------------------------------------------------------- NHATS records (external data)
  function renderNhats(env) {
    const sum = $('nhats-summary');
    const note = $('nhats-note');
    const tb = $('nhats-closest').querySelector('tbody');
    tb.textContent = '';
    if (!env.value) {
      $('nhats-closest').classList.add('hidden');
      sum.textContent = '';
      sum.appendChild(el('b', '', `Refused (${env.refusal.code}): `));
      sum.appendChild(document.createTextNode(env.refusal.reason));
      setText(note, `What would help: ${env.refusal.what_would_help}`);
      return;
    }
    $('nhats-closest').classList.remove('hidden');
    const v = env.value;
    const s = v.summary;
    const star = v.tier.vinf_star_kms;
    const r0 = v.closest[0];
    const head = `Aster computes no Earth-arrival v∞, but its test fixtures hold ${v.source.bodies} JPL NHATS minimum-Δv round trips (${v.source.files_read} files, ${v.source.skipped_files} API error records skipped). Reading each record's Earth-entry speed v_arr_earth at ${f(v.reading.entry_altitude_km.value, 0)} km (${v.reading.label}) gives v∞ = ${f(s.vinf_min_kms.value, 3)} to ${f(s.vinf_max_kms.value, 3)} km/s, median ${f(s.vinf_median_kms.value, 3)}.`;
    const vsTier = star
      ? ` Against the ${v.tier.label} tip (v∞* = ${f(star.value, 3)} km/s), ${s.payload_faster} arrive faster and ${s.payload_slower} slower; ${s.energy_matched} within your ${f(s.tolerance_ms.value, 1)} m/s. The closest, ${r0.des}, misses by ${TipMatch.signedSpeedDiff(r0.trim_dv_ms.value)} (± ${f(r0.trim_rounding_ms.value, 2)} m/s from the record's rounding).`
      : ` Against the ${v.tier.label} tip (C3 < 0, no v∞*), all ${s.payload_faster} arrive faster; the slowest, ${r0.des}, still needs ${TipMatch.signedSpeedDiff(r0.trim_dv_ms.value)} of trim.`;
    setText(sum, head + vsTier);
    for (const r of v.closest) {
      const tr = el('tr');
      const name = r.fullname && r.fullname !== `(${r.des})` ? r.fullname : r.des;
      tr.appendChild(el('td', '', name));
      // the in-cell labels stand in for the header row, which the phone layout hides
      const cell = (k, text) => {
        const td = el('td', 'v');
        td.appendChild(el('span', 'cell-k', `${k} `));
        td.appendChild(document.createTextNode(text));
        return td;
      };
      tr.appendChild(cell('v_arr_earth', `${f(r.v_arr_earth_kms.value, 3)} km/s`));
      tr.appendChild(cell('v∞', `${f(r.vinf_kms.value, 4)} km/s`));
      tr.appendChild(cell('trim', `${TipMatch.signedSpeedDiff(r.trim_dv_ms.value)} ± ${f(r.trim_rounding_ms.value, 2)} m/s`));
      tb.appendChild(tr);
    }
    setText(
      note,
      `External data, not Aster's: JPL's own Lambert computations, one minimum-Δv trajectory per body, so a different return date gives a different v∞. The altitude at which v_arr_earth is quoted is not in the record (${v.reading.cite} @ ${ASTER_SHORT}; sibling deposit ideas/05-round-trip-ledger documents the ambiguity), and switching the reading above moves every v∞ by more than any tolerance. dec_arr, the asymptote's declination, is in the records too, but no right ascension and no stated frame, so the plane condition stays refused. Each record is rounded to 0.001 km/s.`
    );
  }

  // ---------------------------------------------------------------- static text that carries constants
  function fillConstants() {
    const tiers = C.tierOrder.map((k) => C.tiers[k]);
    setText(
      $('tier-note'),
      `Tip speeds from params/rev_a.json: the ${f(tiers[0].v_tip_kms, 1)} km/s reference, the ${f(tiers[1].v_tip_kms, 1)} km/s revenue-gated cislunar option, the ${f(tiers[2].v_tip_kms, 1)} km/s Phase 3 growth option. The tether's centre of mass is at ${f(C.com_altitude_km, 0)} km with ${f(C.half_length_km, 0)} km arms, so the upper tip is ${f(C.r_tip_km, 0)} km from Earth's centre.`
    );
    const h = $('chart-h');
    h.textContent = '';
    h.appendChild(document.createTextNode(`Speed at the upper-tip radius, ${f(C.r_tip_km, 0)} km `));
    h.appendChild(el('span', 'muted small', 'payload versus tip, km/s'));
    if (kernel.aster) {
      setText($('vinf-range'), `Accepted: 0 to ${f(kernel.aster.helio.vinf_max_kms, 2)} km/s, the fastest a body bound to the Sun can meet Earth; the slider spans the asteroid-return range.`);
      for (const inp of document.querySelectorAll('input[name="reading"]')) {
        const cited = (typeof ASTER_DATA !== 'undefined' && ASTER_DATA.cited) || {};
        const key = inp.value === 'entry-125' ? 'nhats_entry_altitude_km' : 'browser_reentry_altitude_km';
        const span = inp.nextElementSibling;
        if (cited[key] && span) span.textContent = `${span.textContent} (${cited[key].value} km)`;
      }
    }
  }

  // ---------------------------------------------------------------- go
  buildTiers();
  if (kernel.ok) fillConstants();
  if (!kernel.ok) {
    showRefusal({ refusal: kernel.refusal }, 'The canon snapshot is unusable');
    setText($('headline'), 'Refused: the rev_a.json snapshot lacks a key the kernel needs.');
    renderChips(null);
  } else {
    render();
  }
})();
