// Two Seconds at the Bottom — page logic. Every number shown comes from CatchWindow (catchwindow.js)
// fed the SKYHOOK_CANON snapshot wrapper (snapshots/canon.data.js). Nothing numeric is typed here
// except drawing margins, slider ranges and the founding document's requirement durations (3 and
// 10 s, docs/project_instructions.md:124), which are inputs the page declares, not canon.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const REQUIREMENT_WINDOWS_S = [3, 10]; // §4.3 "3–10 seconds"
  const NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, String(attrs[k]));
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const minus = (s) => s.replace(/^-/, '−');
  const f = (x, d) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : minus(Number(x).toFixed(d)));
  const pm = (x, d) => `±${f(x, d)}`;
  function fmtS(x) {
    // seconds with sensible precision
    if (!Number.isFinite(x)) return '—';
    if (x < 0.1) return f(x, 3);
    if (x < 10) return f(x, 2);
    return f(x, 1);
  }
  // a duration the person typed: no trailing zeros ("3 s", "3.5 s", "10 s")
  const fmtT = (x) => (Number.isFinite(x) ? minus(String(Number(x.toFixed(2)))) : '—');
  function fmtM(x) {
    if (!Number.isFinite(x)) return '—';
    if (x === 0) return '0 m';
    if (x >= 1000) return `${f(x / 1000, 2)} km`;
    if (x >= 100) return `${f(x, 0)} m`;
    if (x >= 1) return `${f(x, 1)} m`;
    return `${f(x * 100, 1)} cm`;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function td(text, cls, key) {
    const c = el('td', cls, text);
    if (key) c.dataset.k = key;
    return c;
  }
  // Charts draw into a viewBox as wide as the element renders, so text stays 11–12 px on a phone
  // instead of being scaled down with the drawing; render() runs again on resize.
  function chartWidth(svg) {
    const w = svg.clientWidth || (svg.parentNode && svg.parentNode.clientWidth) || 680;
    return Math.max(300, Math.round(w));
  }
  function setBox(svg, W, H) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }
  const estWidth = (text, px) => text.length * (px || 12) * 0.56;
  function tdSrc(value, src, cls) {
    const c = el('td', cls);
    c.appendChild(document.createTextNode(value));
    if (src) c.appendChild(el('span', 'src', src));
    return c;
  }

  // ---------------------------------------------------------------- canon
  const canon = typeof SKYHOOK_CANON !== 'undefined' ? SKYHOOK_CANON : null;
  const K = CatchWindow.create(canon);
  if (!K.ok) {
    showRefusal(K.refusal, 'The canon snapshot could not be read');
    $('results').hidden = true;
    $('verdict').hidden = true;
    document.querySelector('.controls').hidden = true;
    return;
  }
  const C = K.constants;
  const SHORT = String(C.sources.revA.commit || '').slice(0, 7);

  const state = { tier: 'reference', L: C.halfLengthKm, env: 10, vtol: 1, hold: 10 };

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
      inp.addEventListener('change', () => {
        state.tier = key;
        render();
      });
      lab.appendChild(inp);
      lab.appendChild(el('span', null, `${t.label} · ${f(t.vTipKms, 1)} km/s`));
      box.appendChild(lab);
    }
    $('tier-note').textContent = `Tip speeds read from the params/rev_a.json snapshot (${C.tierOrder.map((k) => C.tiers[k].sourceKey).join(', ')}).`;
  }
  // A typed value outside the number box's declared min/max is refused, not clamped and not passed on
  // to the closed forms; zero, negative and empty values go to the kernel, which refuses them itself.
  const rangeErrors = {};
  function bindPair(rangeId, numId, key, label, unit) {
    const r = $(rangeId);
    const n = $(numId);
    const set = (v) => {
      if (!Number.isFinite(v)) return;
      state[key] = v;
      const lo = Number(n.min);
      const hi = Number(n.max);
      rangeErrors[key] = v > 0 && (v < lo || v > hi) ? { label, unit, v, lo, hi } : null;
      r.value = String(Math.min(Number(r.max), Math.max(Number(r.min), v)));
      n.value = String(v);
      render();
    };
    r.addEventListener('input', () => set(Number(r.value)));
    n.addEventListener('input', () => set(Number(n.value)));
    return set;
  }
  function inputRefusal() {
    for (const key of ['L', 'env', 'vtol', 'hold']) {
      const e = rangeErrors[key];
      if (e) {
        return CatchWindow.refusal(
          'out_of_envelope',
          `${e.label} of ${e.v} ${e.unit} is outside this page's input range, ${e.lo} to ${e.hi} ${e.unit}. Beyond it the page would be extrapolating the closed forms, so it shows nothing rather than a number.`,
          `Type a value from ${e.lo} to ${e.hi} ${e.unit}, or use the slider.`
        );
      }
    }
    return null;
  }
  // half-length range: from 50 km to a little past the CoM altitude so the ground refusal is reachable
  const comAlt = C.rComKm - C.earthRadiusKm;
  $('L').max = String(comAlt + 90);
  $('L-num').max = String(comAlt + 90);
  const setL = bindPair('L', 'L-num', 'L', 'A half-length', 'km');
  bindPair('env', 'env-num', 'env', 'A capture envelope', 'm');
  bindPair('vtol', 'vtol-num', 'vtol', 'A velocity tolerance', 'm/s');
  const setHold = bindPair('hold', 'hold-num', 'hold', 'A held window', 's');
  $('L-canon').addEventListener('click', () => setL(C.halfLengthKm));
  for (const b of document.querySelectorAll('button[data-hold]')) b.addEventListener('click', () => setHold(Number(b.dataset.hold)));
  $('L-note').textContent = `The centre of mass stays at the canon altitude of ${f(C.comAltitudeKm, 0)} km (orbital.com_altitude_km); the tip altitude is that minus L. Below ${C.atmosphereClearKm} km the ballistic idealisation is flagged; at or below the ground the page refuses. Canon L = ${f(C.halfLengthKm, 0)} km (geometry.tether_half_length_km).`;

  // ---------------------------------------------------------------- refusal
  function showRefusal(ref, title) {
    const card = $('refusal-card');
    clear(card);
    card.hidden = false;
    card.appendChild(el('h2', null, title || 'Refused'));
    card.appendChild(el('p', 'code', `refusal.code: ${ref.code}`));
    card.appendChild(el('p', null, ref.reason));
    if (ref.what_would_help) {
      const p = el('p', 'small');
      p.appendChild(el('b', null, 'What would help: '));
      p.appendChild(document.createTextNode(ref.what_would_help));
      card.appendChild(p);
    }
  }
  function hideRefusal() {
    const card = $('refusal-card');
    card.hidden = true;
    clear(card);
  }

  // ---------------------------------------------------------------- verdict
  function renderVerdict(r, mod) {
    const k = r.kin;
    const p = r.passive;
    const h = r.held;
    const head = $('headline');
    clear(head);
    const parts = [
      ['A passive vehicle matched to the lower tip stays within ', pm(p.envelopeM, 0) + ' m', ' for ', `${fmtS(p.totalPos)} s`, ` (${pm(p.tPos, 2)} s) and within `, pm(p.velTolMps, 1) + ' m/s', ' for ', `${fmtS(p.totalVel)} s`, ` (${pm(p.tVel, 3)} s). The tip pulls away at `, `${f(k.aRel, 2)} m/s² = ${f(k.aRelG, 2)} g`, `. To hold station for ${fmtT(h.holdS)} s the vehicle must thrust at that acceleration throughout: `, `${f(h.deltaV, 0)} m/s`, ' of Δv.'],
    ];
    for (const seg of parts[0]) {
      const i = parts[0].indexOf(seg);
      if (i % 2 === 1) head.appendChild(el('strong', null, seg));
      else head.appendChild(document.createTextNode(seg));
    }
    const chips = $('chips');
    clear(chips);
    const chip = (v, kk, cls) => {
      const c = el('div', `chip ${cls || ''}`);
      c.appendChild(el('span', 'v', v));
      c.appendChild(el('span', 'k', kk));
      chips.appendChild(c);
    };
    chip(`${f(k.aRel, 2)} m/s²`, `relative acceleration, ${f(k.aRelG, 2)} g, v_tip at the vertical`, '');
    chip(`${fmtS(p.totalPos)} s`, `inside ${pm(p.envelopeM, 0)} m, passive`, 'pos');
    chip(`${fmtS(p.totalVel)} s`, `inside ${pm(p.velTolMps, 1)} m/s, passive`, 'vel');
    chip(`${f(h.deltaV, 0)} m/s`, `held for ${fmtT(h.holdS)} s at ${f(k.aRelG, 2)} g`, '');

    const st = $('statuses');
    clear(st);
    const status = (cls, ico, text) => {
      const s = el('span', `status ${cls}`);
      s.appendChild(el('span', 'ico', ico));
      s.appendChild(document.createTextNode(text));
      st.appendChild(s);
    };
    status('ok', '✓', `binding constraint: ${p.binding === 'velocity' ? 'the velocity tolerance' : 'the capture envelope'}`);
    if (!k.validity.atmosphereClear) status('warn', '!', `tip at ${f(k.tipAltitudeKm, 0)} km, below ${k.validity.atmosphereClearKm} km: a vehicle there is not ballistic (drag not modelled); numbers shown are the vacuum kinematics only`);
    else status('ok', '✓', `tip altitude ${f(k.tipAltitudeKm, 0)} km, above the ${k.validity.atmosphereClearKm} km scope line`);
    const reqMin = REQUIREMENT_WINDOWS_S[0];
    if (p.totalPos < reqMin) status('warn', '!', `the passive window is below the §4.3 lower bound of ${reqMin} s: holding ±${f(p.velTolMps, 1)} m/s through it is a station-keeping requirement, not a free property of the geometry`);
    else status('ok', '✓', `the passive envelope window meets the §4.3 lower bound of ${reqMin} s`);
    if (mod && mod.ok) {
      status('info', 'i', `open convention: these numbers read v_tip as the speed at the vertical; read as the rotation mean, a_rel is ${f(mod.mean.aRel, 2)} m/s² (+${f(100 * mod.aRelIncreaseFraction, 1)} %), see "Which speed is v_tip?"`);
    }
  }

  // ---------------------------------------------------------------- sketch (CoM frame)
  function renderSketch(r) {
    const k = r.kin;
    const p = r.passive;
    const svg = $('sketch');
    clear(svg);
    const W = chartWidth(svg);
    const H = 300;
    setBox(svg, W, H);
    const narrow = W < 520;
    const m = { l: 56, r: 16, t: 34, b: 40 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const tSpan = Math.max(r.held.holdS / 2 * 1.1, p.tPos * 2.5, 1);
    const vTip = k.vTipKms * 1e3;
    const L = k.halfLengthKm * 1e3;
    const xMaxM = vTip * tSpan; // horizontal distance along the swing, m
    const yTip = (t) => L * (1 - Math.cos(k.omega * t)); // tip rise above the bottom point, CoM frame
    const yVeh = (t) => -0.5 * k.gravityGradient * t * t; // vehicle sag in the CoM frame
    const yTop = yTip(tSpan) + p.envelopeM;
    const yBot = yVeh(tSpan) - Math.max(p.envelopeM, 0.14 * (yTop - yVeh(tSpan)));
    const X = (xm) => m.l + ((xm + xMaxM) / (2 * xMaxM)) * pw;
    const Y = (ym) => m.t + ((yTop - ym) / (yTop - yBot)) * ph;
    const exag = ((2 * xMaxM) / pw) / ((yTop - yBot) / ph);

    // held window span
    const hx0 = X(-vTip * r.held.holdS / 2);
    const hx1 = X(vTip * r.held.holdS / 2);
    svg.appendChild(svgEl('rect', { class: 'hold', x: Math.max(m.l, hx0), y: m.t, width: Math.max(0, Math.min(W - m.r, hx1) - Math.max(m.l, hx0)), height: ph }));
    // envelope band around the tip path
    const N = 121;
    let up = '';
    let down = '';
    for (let i = 0; i < N; i++) {
      const t = -tSpan + (2 * tSpan * i) / (N - 1);
      const x = X(vTip * t);
      up += `${i ? 'L' : 'M'}${x.toFixed(1)},${Y(yTip(t) + p.envelopeM).toFixed(1)}`;
    }
    for (let i = N - 1; i >= 0; i--) {
      const t = -tSpan + (2 * tSpan * i) / (N - 1);
      const x = X(vTip * t);
      down += `L${x.toFixed(1)},${Y(yTip(t) - p.envelopeM).toFixed(1)}`;
    }
    svg.appendChild(svgEl('path', { class: 'band-pos', d: `${up}${down}Z` }));
    // tip arc
    let arc = '';
    let veh = '';
    for (let i = 0; i < N; i++) {
      const t = -tSpan + (2 * tSpan * i) / (N - 1);
      const x = X(vTip * t);
      arc += `${i ? 'L' : 'M'}${x.toFixed(1)},${Y(yTip(t)).toFixed(1)}`;
      veh += `${i ? 'L' : 'M'}${x.toFixed(1)},${Y(yVeh(t)).toFixed(1)}`;
    }
    svg.appendChild(svgEl('path', { class: 'tip-arc', d: arc }));
    svg.appendChild(svgEl('path', { class: 'vehicle-path', d: veh }));
    // tether: from the top edge down to the tip at the bottom point
    svg.appendChild(svgEl('line', { class: 'tether', x1: X(0), y1: m.t - 24, x2: X(0), y2: Y(0) }));
    svg.appendChild(svgEl('text', { class: 'tick', x: X(0) + 6, y: m.t - 10 }, narrow ? `to the CoM, ${f(k.halfLengthKm, 0)} km up` : `to the centre of mass, ${f(k.halfLengthKm, 0)} km up`));
    svg.appendChild(svgEl('circle', { class: 'tipnode', cx: X(0), cy: Y(0), r: 5 }));
    svg.appendChild(svgEl('circle', { class: 'vehicle', cx: X(0), cy: Y(0), r: 4 }));
    // exit markers on the vehicle path at ±t_pos
    for (const s of [-1, 1]) {
      const t = s * p.tPos;
      if (Math.abs(t) <= tSpan) {
        const xx = X(vTip * t);
        svg.appendChild(svgEl('circle', { class: 'marker pos', cx: xx, cy: Y(yVeh(t)), r: 4.5 }));
        // the two labels fan outward from the match point so they never meet on a narrow chart
        svg.appendChild(svgEl('text', { class: 'lab halo', x: xx + (xx < X(0) ? -7 : 7), y: Y(yVeh(t)) + 17, 'text-anchor': xx < X(0) ? 'end' : 'start' }, `${s < 0 ? '−' : '+'}${f(p.tPos, 2)} s`));
      }
    }
    // direct labels
    svg.appendChild(svgEl('text', { class: 'lab strong', x: X(-xMaxM * 0.98), y: Y(yTip(tSpan)) - 8, 'text-anchor': 'start' }, 'tip path'));
    svg.appendChild(svgEl('text', { class: 'lab', x: X(xMaxM * 0.98), y: Y(yVeh(tSpan)) - 8, 'text-anchor': 'end' }, 'vehicle, ballistic'));
    // axes
    svg.appendChild(svgEl('line', { class: 'axis', x1: m.l, y1: m.t + ph, x2: m.l + pw, y2: m.t + ph }));
    for (const t of narrow ? [-tSpan, 0, tSpan] : [-tSpan, -tSpan / 2, 0, tSpan / 2, tSpan]) {
      const x = X(vTip * t);
      svg.appendChild(svgEl('line', { class: 'axis', x1: x, y1: m.t + ph, x2: x, y2: m.t + ph + 4 }));
      svg.appendChild(svgEl('text', { class: 'tick', x, y: m.t + ph + 16, 'text-anchor': 'middle' }, `${minus((vTip * t / 1000).toFixed(1))} km`));
    }
    // x is the distance along the tip's own motion, so time runs left to right as in the timeline below
    // (in the orbit's direction the lower tip moves backward)
    svg.appendChild(svgEl('text', { class: 'tick', x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, narrow ? `tip moves → (${minus((-tSpan).toFixed(1))} s to +${tSpan.toFixed(1)} s)` : `along the tip's motion, tip moves → (${minus((-tSpan).toFixed(1))} s at left, +${tSpan.toFixed(1)} s at right)`));
    // y ticks
    svg.appendChild(svgEl('line', { class: 'axis', x1: m.l, y1: m.t, x2: m.l, y2: m.t + ph }));
    for (const ym of [0, yTip(tSpan)]) {
      svg.appendChild(svgEl('text', { class: 'tick', x: m.l - 6, y: Y(ym) + 4, 'text-anchor': 'end' }, fmtM(ym)));
    }
    $('sketch-cap').textContent = `Centre-of-mass frame, vertical stretched ×${Math.round(exag)}; the tip moves left to right (backward along the orbit), so time runs left to right as in the timeline below. At the centre the vehicle and the tip share place and velocity. The tip's circular arc rises ${fmtM(yTip(tSpan))} above the bottom point in ${tSpan.toFixed(1)} s (centripetal ${f(k.aCentripetal, 2)} m/s²); the vehicle sags ${fmtM(-yVeh(tSpan))} (gravity gradient ${f(k.gravityGradient, 2)} m/s² over the ${f(k.halfLengthKm, 0)} km). Their difference is a_rel = ${f(k.aRel, 2)} m/s². The vehicle leaves the ${pm(p.envelopeM, 0)} m band ${pm(p.tPos, 2)} s from the match.`;
  }

  // ---------------------------------------------------------------- timeline (two panels)
  let tlCursor = null;
  function renderTimeline(r) {
    const k = r.kin;
    const p = r.passive;
    const svg = $('timeline');
    clear(svg);
    const W = chartWidth(svg);
    const H = 440;
    setBox(svg, W, H);
    const m = { l: 62, r: 16, t: 18, gap: 46, b: 40 };
    const pw = W - m.l - m.r;
    const ph = (H - m.t - m.gap - m.b) / 2;
    const tSpan = Math.max(r.held.holdS / 2 * 1.1, p.tPos * 2.5, 1);
    const tl = K.timeline({ aRel: k.aRel, tMaxS: tSpan, n: 161 });
    const sepMax = Math.max(0.5 * k.aRel * tSpan * tSpan, p.envelopeM * 1.5);
    const dvMax = Math.max(k.aRel * tSpan, p.velTolMps * 1.5);
    const X = (t) => m.l + ((t + tSpan) / (2 * tSpan)) * pw;
    const Y1 = (s) => m.t + (1 - s / sepMax) * ph;
    const y2top = m.t + ph + m.gap;
    const Y2 = (v) => y2top + (1 - v / dvMax) * ph;

    function panel(yTop, yFn, max, unit, bandCls, bandTop, series, cls, edges, edgeCls, title) {
      // hold span
      const hx0 = X(-r.held.holdS / 2);
      const hx1 = X(r.held.holdS / 2);
      svg.appendChild(svgEl('rect', { class: 'hold', x: Math.max(m.l, hx0), y: yTop, width: Math.max(0, Math.min(m.l + pw, hx1) - Math.max(m.l, hx0)), height: ph }));
      // band from 0 to the limit
      svg.appendChild(svgEl('rect', { class: bandCls, x: m.l, y: yFn(Math.min(bandTop, max)), width: pw, height: yTop + ph - yFn(Math.min(bandTop, max)) }));
      // grid + ticks
      const steps = niceTicks(0, max, 4);
      for (const v of steps) {
        if (v > max) continue;
        svg.appendChild(svgEl('line', { class: v === 0 ? 'axis' : 'grid', x1: m.l, y1: yFn(v), x2: m.l + pw, y2: yFn(v) }));
        svg.appendChild(svgEl('text', { class: 'tick', x: m.l - 6, y: yFn(v) + 4, 'text-anchor': 'end' }, `${compact(v)}`));
      }
      svg.appendChild(svgEl('text', { class: 'lab strong', x: m.l, y: yTop - 5 }, title));
      svg.appendChild(svgEl('text', { class: 'tick', x: m.l + pw, y: yTop - 5, 'text-anchor': 'end' }, unit));
      // series
      let d = '';
      for (let i = 0; i < tl.t.length; i++) d += `${i ? 'L' : 'M'}${X(tl.t[i]).toFixed(1)},${yFn(Math.min(series[i], max)).toFixed(1)}`;
      svg.appendChild(svgEl('path', { class: cls, d }));
      // edges: where the series crosses the band
      for (const s of [-1, 1]) {
        const t = s * edges.t;
        if (Math.abs(t) <= tSpan) {
          svg.appendChild(svgEl('line', { class: edgeCls, x1: X(t), y1: yFn(edges.v), x2: X(t), y2: yTop + ph }));
          svg.appendChild(svgEl('circle', { class: `marker ${edgeCls === 'edge-pos' ? 'pos' : 'vel'}`, cx: X(t), cy: yFn(edges.v), r: 4.5 }));
        }
      }
      if (edges.t <= tSpan) {
        const label = `${pm(edges.t, edges.t < 0.1 ? 3 : 2)} s inside ±${edges.label}`;
        // beside the right-hand marker when it fits, else left of the left-hand one, else centred above
        const est = estWidth(label);
        const yLab = Math.min(yFn(edges.v) + 4, yTop + ph - 6);
        let pos;
        if (X(edges.t) + 7 + est <= m.l + pw) pos = { x: X(edges.t) + 7, y: yLab, 'text-anchor': 'start' };
        else if (X(-edges.t) - 7 - est >= m.l) pos = { x: X(-edges.t) - 7, y: yLab, 'text-anchor': 'end' };
        else pos = { x: X(0), y: yFn(edges.v) - 9, 'text-anchor': 'middle' };
        svg.appendChild(svgEl('text', Object.assign({ class: 'lab halo' }, pos), label));
      } else {
        svg.appendChild(svgEl('text', { class: 'lab', x: m.l + 8, y: yFn(edges.v) - 6 }, `inside ±${edges.label} for ${pm(edges.t, 2)} s, beyond this span`));
      }
    }
    panel(m.t, Y1, sepMax, 'metres', 'band-pos', p.envelopeM, tl.sep, 'series-pos', { t: p.tPos, v: p.envelopeM, label: `${f(p.envelopeM, 0)} m` }, 'edge-pos', 'Separation, tip minus vehicle');
    panel(y2top, Y2, dvMax, 'm/s', 'band-vel', p.velTolMps, tl.dv, 'series-vel', { t: p.tVel, v: p.velTolMps, label: `${f(p.velTolMps, 1)} m/s` }, 'edge-vel', 'Relative speed');
    // shared time axis
    const ticks = niceTicks(-tSpan, tSpan, 6);
    for (const t of ticks) {
      if (Math.abs(t) > tSpan) continue;
      svg.appendChild(svgEl('line', { class: 'axis', x1: X(t), y1: y2top + ph, x2: X(t), y2: y2top + ph + 4 }));
      svg.appendChild(svgEl('text', { class: 'tick', x: X(t), y: y2top + ph + 16, 'text-anchor': 'middle' }, `${minus(String(Number(t.toFixed(2))))}`));
    }
    svg.appendChild(svgEl('text', { class: 'tick', x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, 'seconds from the match (held window shaded)'));
    // held label
    svg.appendChild(svgEl('text', { class: 'tick', x: X(0), y: m.t + 12, 'text-anchor': 'middle' }, `held ${fmtT(r.held.holdS)} s: ${f(r.held.deltaV, 0)} m/s at ${f(k.aRelG, 2)} g`));

    // hover layer: crosshair + one tooltip with both series
    const cross = svgEl('line', { class: 'crosshair', x1: 0, y1: m.t, x2: 0, y2: y2top + ph, visibility: 'hidden' });
    svg.appendChild(cross);
    const hit = svgEl('rect', { class: 'hit', x: m.l, y: m.t, width: pw, height: y2top + ph - m.t });
    svg.appendChild(hit);
    const tip = $('tl-tip');
    const show = (t) => {
      const tt = Math.max(-tSpan, Math.min(tSpan, t));
      tlCursor = tt;
      cross.setAttribute('x1', X(tt));
      cross.setAttribute('x2', X(tt));
      cross.setAttribute('visibility', 'visible');
      clear(tip);
      tip.appendChild(el('div', 'small muted', `t = ${minus(tt.toFixed(2))} s`));
      const row = (cls, kk, v) => {
        const d = el('div', `row ${cls}`);
        d.appendChild(el('span', 'k', kk));
        d.appendChild(el('b', null, v));
        tip.appendChild(d);
      };
      row('pos', 'separation', fmtM(0.5 * k.aRel * tt * tt));
      row('vel', 'relative speed', `${f(k.aRel * Math.abs(tt), 2)} m/s`);
      tip.setAttribute('aria-hidden', 'false');
      const box = svg.getBoundingClientRect();
      const px = ((X(tt) - 0) / W) * box.width;
      tip.style.left = `${Math.min(box.width - 170, Math.max(0, px + 12))}px`;
      tip.style.top = `${(m.t / H) * box.height + 8}px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.setAttribute('aria-hidden', 'true');
    };
    const fromEvent = (ev) => {
      const box = svg.getBoundingClientRect();
      const xv = ((ev.clientX - box.left) / box.width) * W;
      return -tSpan + ((xv - m.l) / pw) * 2 * tSpan;
    };
    hit.addEventListener('pointermove', (ev) => show(fromEvent(ev)));
    hit.addEventListener('pointerdown', (ev) => show(fromEvent(ev)));
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('keydown', (ev) => {
      const step = tSpan / 40;
      if (ev.key === 'ArrowRight') show((tlCursor === null ? 0 : tlCursor) + step);
      else if (ev.key === 'ArrowLeft') show((tlCursor === null ? 0 : tlCursor) - step);
      else if (ev.key === 'Home') show(0);
      else if (ev.key === 'Escape') hide();
      else return;
      ev.preventDefault();
    });
    svg.addEventListener('focus', () => show(tlCursor === null ? 0 : tlCursor));
    svg.addEventListener('blur', hide);
    $('tl-cap').textContent = `Separation = a_rel t²/2 and relative speed = a_rel t with a_rel = ${f(k.aRel, 2)} m/s². Inside ${pm(p.envelopeM, 0)} m for ${pm(p.tPos, 2)} s; inside ${pm(p.velTolMps, 1)} m/s for ${pm(p.tVel, 3)} s, so the ${p.binding} tolerance binds. ${p.bestPassive.withinClosedForm ? `The best any passive trajectory can do inside ${pm(p.envelopeM, 0)} m (enter at the top, turn at the bottom) is ${f(p.bestPassive.totalS, 2)} s, arriving at ${f(p.bestPassive.edgeSpeedMps, 1)} m/s.` : 'The grazing bound (enter at the top, turn at the bottom) would run past the closed forms’ range here and is not shown.'} Shrink the held window to zoom in.`;
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo;
    const raw = span / n;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const steps = [1, 2, 2.5, 5, 10];
    let step = pow;
    for (const s of steps) {
      if (raw <= s * pow) {
        step = s * pow;
        break;
      }
    }
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
    return out;
  }
  function compact(v) {
    if (Math.abs(v) >= 1000) return `${minus((v / 1000).toFixed(v % 1000 ? 1 : 0))}k`;
    return minus(String(Number(v.toFixed(3))));
  }

  // ---------------------------------------------------------------- requirement cards
  function renderRequirements(r) {
    const box = $('reqs');
    clear(box);
    $('req-arel').textContent = `a_rel = ${f(r.kin.aRel, 2)} m/s² (${f(r.kin.aRelG, 2)} g)`;
    // §5.2(d)'s "tens of meters wide" envelope against the lower bound of §4.3, on position alone
    const low = r.requirement[0];
    const note = $('req-env-note');
    if (low && low.passive.ok) {
      note.textContent = `On position alone a passive ${low.totalS} s fits inside ${pm(low.passive.envelopeM, 1)} m, which §5.2(d)'s "tens of meters wide" envelope would allow; but the vehicle would cross the envelope's edges at ${f(low.passive.edgeSpeedMps, 1)} m/s, about ${f(low.passive.edgeSpeedMps / r.passive.velTolMps, 0)} times the ${pm(r.passive.velTolMps, 1)} m/s tolerance that §4.3 asks to be sustained through the window.`;
    } else {
      note.textContent = '';
    }
    for (const q of r.requirement) {
      const card = el('div', 'req');
      card.appendChild(el('h3', null, `A ${q.totalS} s window`));
      if (!q.passive.ok || !q.held.ok) {
        const why = (q.passive.ok ? q.held : q.passive).refusal;
        card.appendChild(el('p', 'small code', `refusal.code: ${why.code}`));
        card.appendChild(el('p', 'small', why.reason));
        box.appendChild(card);
        continue;
      }
      const dl = el('dl');
      const row = (k, v) => {
        dl.appendChild(el('dt', null, k));
        dl.appendChild(el('dd', null, v));
      };
      row('passive: envelope needed', `${pm(q.passive.envelopeM, 0)} m`);
      row('passive: speed at its edge', `${f(q.passive.edgeSpeedMps, 1)} m/s`);
      row('held: thrust acceleration', `${f(q.held.accel, 2)} m/s² = ${f(q.held.accel / C.g0, 2)} g`);
      row('held: Δv', `${f(q.held.deltaV, 0)} m/s`);
      row('as a share of the EQ-3a catch speed', `${f(100 * q.held.fractionOfCatchSpeed, 1)} %`);
      row('reel: line excursion', `${fmtM(q.held.reelExcursionM)}`);
      row('reel: peak line speed', `${f(q.held.reelPeakSpeedMps, 0)} m/s`);
      card.appendChild(dl);
      box.appendChild(card);
    }
  }

  // ---------------------------------------------------------------- tier table
  function renderTiers(r) {
    const rows = K.tierTable({ halfLengthKm: state.L, envelopeM: state.env, velTolMps: state.vtol, holdS: state.hold });
    const tb = $('tiers-table').querySelector('tbody');
    clear(tb);
    for (const row of rows) {
      const tr = el('tr', row.key === state.tier ? 'canon-row' : '');
      const tierCell = td(row.short, 'tier', 'Tier');
      tierCell.title = row.label;
      tr.appendChild(tierCell);
      tr.appendChild(td(f(row.vTipKms, 1), 'num', 'v_tip km/s'));
      if (row.refusal) {
        const c = td(`refused: ${row.refusal.reason}`, '', 'refused');
        c.colSpan = 8;
        tr.appendChild(c);
        tb.appendChild(tr);
        continue;
      }
      // the file states tip_acceleration_g at its own half-length only; at any other L the kernel withholds it
      tr.appendChild(td(`${f(row.kin.aCentripetalG, 2)} (${row.stated.tipAccelG === null ? '—' : row.stated.tipAccelG})`, 'num', 'tip g (file at canon L)'));
      tr.appendChild(td(f(row.kin.aRel, 2), 'num', 'a_rel m/s²'));
      tr.appendChild(td(f(row.kin.aRelG, 2), 'num', 'a_rel g'));
      tr.appendChild(td(`${pm(row.passive.tPos, 2)} s`, 'num', '±t, envelope'));
      tr.appendChild(td(`${pm(row.passive.tVel, 3)} s`, 'num', '±t, velocity'));
      tr.appendChild(td(`${f(row.held.deltaV, 0)} m/s`, 'num', 'hold Δv'));
      tr.appendChild(td(`${f(row.kin.eq3a.speed / 1e3, 3)} (${row.stated.groundrelKms === null ? '—' : row.stated.groundrelKms})`, 'num', 'EQ-3a km/s (file)'));
      tr.appendChild(td(f(row.kin.earthFixed.speed / 1e3, 3), 'num', 'Earth-fixed km/s'));
      tb.appendChild(tr);
    }
    $('tiers-cap-L').textContent = state.L === C.halfLengthKm ? '' : ` The file states tip_acceleration_g only at its own half-length of ${f(C.halfLengthKm, 0)} km, so at this L the "(file)" tip-g column shows a dash.`;
  }

  // ---------------------------------------------------------------- window vs L
  let cvCursor = null;
  function renderCurve(r) {
    const svg = $('curve');
    clear(svg);
    const vTip = r.kin.vTipKms;
    const pts = K.windowVsLength({ vTipKms: vTip, envelopeM: state.env, velTolMps: state.vtol, lMinKm: 50, lMaxKm: comAlt - 1, n: 113 });
    const ceil = K.passiveCeiling({ vTipKms: vTip, envelopeM: state.env, velTolMps: state.vtol });
    const W = chartWidth(svg);
    const H = 320;
    setBox(svg, W, H);
    const narrow = W < 520;
    const m = { l: 56, r: 16, t: 26, b: 44 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const reqMin = REQUIREMENT_WINDOWS_S[0];
    const yMax = Math.max(reqMin * 1.1, ceil.ok ? ceil.totalPos * 1.08 : 0);
    const xMin = 50;
    const xMax = comAlt;
    const X = (L) => m.l + ((L - xMin) / (xMax - xMin)) * pw;
    const Y = (s) => m.t + (1 - s / yMax) * ph;
    for (const v of niceTicks(0, yMax, 5)) {
      if (v > yMax) continue;
      svg.appendChild(svgEl('line', { class: v === 0 ? 'axis' : 'grid', x1: m.l, y1: Y(v), x2: m.l + pw, y2: Y(v) }));
      svg.appendChild(svgEl('text', { class: 'tick', x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, compact(v)));
    }
    svg.appendChild(svgEl('text', { class: 'lab strong', x: m.l, y: m.t - 10 }, `Total passive window, s, at ${f(vTip, 1)} km/s`));
    for (const L of niceTicks(xMin, xMax, 6)) {
      if (L < xMin || L > xMax) continue;
      svg.appendChild(svgEl('line', { class: 'axis', x1: X(L), y1: m.t + ph, x2: X(L), y2: m.t + ph + 4 }));
      svg.appendChild(svgEl('text', { class: 'tick', x: X(L), y: m.t + ph + 16, 'text-anchor': 'middle' }, String(L)));
    }
    svg.appendChild(svgEl('text', { class: 'tick', x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, narrow ? `half-length L, km (ground at ${f(comAlt, 0)} km)` : `half-length L, km (tip reaches the ground at ${f(comAlt, 0)} km)`));
    // the requirement line
    svg.appendChild(svgEl('line', { class: 'edge-pos', x1: m.l, y1: Y(reqMin), x2: m.l + pw, y2: Y(reqMin) }));
    svg.appendChild(svgEl('text', { class: 'lab', x: m.l + 6, y: Y(reqMin) - 5 }, narrow ? `§4.3 lower bound: ${reqMin} s` : `§4.3 lower bound: ${reqMin} s (the ${REQUIREMENT_WINDOWS_S[1]} s upper bound is off this chart)`));
    // canon L marker
    svg.appendChild(svgEl('line', { class: 'grid', x1: X(C.halfLengthKm), y1: m.t, x2: X(C.halfLengthKm), y2: m.t + ph }));
    svg.appendChild(svgEl('text', { class: 'tick', x: X(C.halfLengthKm) + 4, y: m.t + ph * 0.6 }, `canon L = ${f(C.halfLengthKm, 0)} km`));
    // series
    let dp = '';
    let dv = '';
    pts.forEach((q, i) => {
      dp += `${i ? 'L' : 'M'}${X(q.LKm).toFixed(1)},${Y(Math.min(q.totalPos, yMax)).toFixed(1)}`;
      dv += `${i ? 'L' : 'M'}${X(q.LKm).toFixed(1)},${Y(Math.min(q.totalVel, yMax)).toFixed(1)}`;
    });
    svg.appendChild(svgEl('path', { class: 'series-pos', d: dp }));
    svg.appendChild(svgEl('path', { class: 'series-vel', d: dv }));
    const last = pts[pts.length - 1];
    if (last) {
      svg.appendChild(svgEl('text', { class: 'lab', x: X(last.LKm) - 4, y: Y(last.totalPos) - 8, 'text-anchor': 'end' }, `inside ${pm(state.env, 0)} m: ${f(last.totalPos, 2)} s at the ground`));
      svg.appendChild(svgEl('text', { class: 'lab', x: X(last.LKm) - 4, y: Y(last.totalVel) - 8, 'text-anchor': 'end' }, `inside ${pm(state.vtol, 1)} m/s: ${f(last.totalVel, 2)} s`));
    }
    // current L marker
    const cur = pts.reduce((best, q) => (Math.abs(q.LKm - state.L) < Math.abs(best.LKm - state.L) ? q : best), pts[0]);
    if (cur && state.L < comAlt) {
      svg.appendChild(svgEl('circle', { class: 'marker pos', cx: X(state.L), cy: Y(Math.min(r.passive.totalPos, yMax)), r: 4.5 }));
      svg.appendChild(svgEl('circle', { class: 'marker vel', cx: X(state.L), cy: Y(Math.min(r.passive.totalVel, yMax)), r: 4.5 }));
    }
    // hover
    const cross = svgEl('line', { class: 'crosshair', x1: 0, y1: m.t, x2: 0, y2: m.t + ph, visibility: 'hidden' });
    svg.appendChild(cross);
    const hit = svgEl('rect', { class: 'hit', x: m.l, y: m.t, width: pw, height: ph });
    svg.appendChild(hit);
    const tip = $('cv-tip');
    const show = (L) => {
      const q = pts.reduce((best, z) => (Math.abs(z.LKm - L) < Math.abs(best.LKm - L) ? z : best), pts[0]);
      if (!q) return;
      cvCursor = q.LKm;
      cross.setAttribute('x1', X(q.LKm));
      cross.setAttribute('x2', X(q.LKm));
      cross.setAttribute('visibility', 'visible');
      clear(tip);
      tip.appendChild(el('div', 'small muted', `L = ${f(q.LKm, 0)} km, tip at ${f(q.tipAltitudeKm, 0)} km, a_rel ${f(q.aRel, 2)} m/s²`));
      const row = (cls, kk, v) => {
        const d = el('div', `row ${cls}`);
        d.appendChild(el('span', 'k', kk));
        d.appendChild(el('b', null, v));
        tip.appendChild(d);
      };
      row('pos', `inside ${pm(state.env, 0)} m`, `${f(q.totalPos, 2)} s`);
      row('vel', `inside ${pm(state.vtol, 1)} m/s`, `${f(q.totalVel, 3)} s`);
      tip.setAttribute('aria-hidden', 'false');
      const box = svg.getBoundingClientRect();
      const px = (X(q.LKm) / W) * box.width;
      tip.style.left = `${Math.min(box.width - 190, Math.max(0, px + 12))}px`;
      tip.style.top = `${(m.t / H) * box.height + 8}px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.setAttribute('aria-hidden', 'true');
    };
    const fromEvent = (ev) => {
      const box = svg.getBoundingClientRect();
      const xv = ((ev.clientX - box.left) / box.width) * W;
      return xMin + ((xv - m.l) / pw) * (xMax - xMin);
    };
    hit.addEventListener('pointermove', (ev) => show(fromEvent(ev)));
    hit.addEventListener('pointerdown', (ev) => show(fromEvent(ev)));
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('keydown', (ev) => {
      const step = (xMax - xMin) / 56;
      if (ev.key === 'ArrowRight') show((cvCursor === null ? state.L : cvCursor) + step);
      else if (ev.key === 'ArrowLeft') show((cvCursor === null ? state.L : cvCursor) - step);
      else if (ev.key === 'Escape') hide();
      else return;
      ev.preventDefault();
    });
    svg.addEventListener('focus', () => show(cvCursor === null ? state.L : cvCursor));
    svg.addEventListener('blur', hide);
    $('cv-cap').textContent = ceil.ok
      ? `Longer tethers help, slowly: a_rel falls as v_tip²/L shrinks, so the window grows as √L. Even with the tip at sea level (L = ${f(ceil.atHalfLengthKm, 0)} km) the passive window inside ${pm(state.env, 0)} m is ${f(ceil.totalPos, 2)} s and inside ${pm(state.vtol, 1)} m/s ${f(ceil.totalVel, 2)} s. ${ceil.totalPos < reqMin ? `No half-length that keeps the tip above the ground reaches the ${reqMin} s lower bound passively at this tip speed.` : `The ${reqMin} s lower bound is reached passively only with the envelope and tolerance set as above.`}`
      : '';
  }

  // ---------------------------------------------------------------- numbers table
  function renderNumbers(r) {
    const k = r.kin;
    const p = r.passive;
    const h = r.held;
    const tb = $('numbers').querySelector('tbody');
    clear(tb);
    const src = C.sources;
    const revPath = `${src.revA.path} @ ${SHORT}`;
    const pyPath = `${src.physicsModule.path} @ ${SHORT}`;
    const rows = [
      ['μ, Earth', `${(C.mu / 1e9).toFixed(0)} km³/s²`, `${revPath}: orbital.mu_earth_m3s2`],
      ['CoM altitude', `${f(C.comAltitudeKm, 0)} km`, `${revPath}: orbital.com_altitude_km`],
      ['Earth radius used', `${f(C.earthRadiusKm, 0)} km`, `${pyPath}: R_EARTH_KM (line ${src.physicsModule.R_EARTH_KM.line}); the twin's golden.json and the file's r_tip = ${f(C.earthRadiusKm + C.comAltitudeKm + C.halfLengthKm, 0)} km notes use the same radius`],
      ['CoM radius used', `${f(k.rComKm, 0)} km`, `Earth radius + CoM altitude. The file's orbital.com_radius_km is ${f(C.comRadiusKmStated, 0)} km (idea 01's finding F1); with it a_rel is ${f(K.kinematics({ vTipKms: k.vTipKms, halfLengthKm: k.halfLengthKm, rComKm: C.comRadiusKmStated }).aRel, 3)} m/s²`],
      ['Half-length L', `${f(k.halfLengthKm, 0)} km`, state.L === C.halfLengthKm ? `${revPath}: geometry.tether_half_length_km` : `your input (canon: ${f(C.halfLengthKm, 0)} km)`],
      ['Tip radius, tip altitude', `${f(k.rTipKm, 0)} km, ${f(k.tipAltitudeKm, 0)} km`, 'CoM radius − L; the file states tip_altitude_lower_km for the canon L'],
      ['Tip speed v_tip', `${f(k.vTipKms, 3)} km/s`, `${revPath}: ${C.tiers[state.tier].sourceKey}`],
      ['Spin rate ω, period', `${k.omega.toExponential(3)} rad/s, ${f(k.periodMin, 2)} min`, `v_tip / L; 2πL / v_tip (file: ${C.rotationPeriodMinStated} min for the canon tier and L)`],
      ['v_orb at the CoM', `${f(k.vOrb / 1e3, 4)} km/s`, `EQ-2 √(μ/R) (file: ${C.vOrbKmsStated}, which is what ${f(C.comRadiusKmStated, 0)} km gives)`],
      ['Lower tip inertial speed at the bottom', `${f(k.vTipInertialBottom, 3)} m/s`, `v_orb − v_tip; the twin's golden.json t = 0 lower-tip state (${src.golden ? src.golden.path : 'golden.json'}) is ${C.golden ? f(C.golden.t0.lowerTip[3], 3) : '—'} m/s at r = ${C.golden ? f(C.golden.t0.lowerTip[0] / 1e3, 0) : '—'} km`],
      ['Centripetal acceleration v_tip²/L', `${f(k.aCentripetal, 3)} m/s² = ${f(k.aCentripetalG, 3)} g`, `EQ-3c (${state.L === C.halfLengthKm ? `file: tip_acceleration_g ${C.tiers[state.tier].stated.tipAccelG}` : `the file states tip_acceleration_g only at L = ${f(C.halfLengthKm, 0)} km`}); g₀ =${C.g0} from ${pyPath} G_STD (line ${src.physicsModule.G_STD.line})`],
      ['g at the hub, g at the tip', `${f(k.gHub, 4)}, ${f(k.gTip, 4)} m/s²`, 'μ/R², μ/(R−L)²'],
      ['Tip inertial acceleration at the bottom', `${f(k.aTipInertial, 3)} m/s² outward`, 'v_tip²/L − μ/R² (rigid rotor, CoM on a circular orbit)'],
      ['Relative acceleration a_rel', `${f(k.aRel, 3)} m/s² = ${f(k.aRelG, 3)} g`, 'v_tip²/L − μ/R² + μ/(R−L)²: tip minus a ballistic vehicle at the same point'],
      ['Passive window inside the envelope', `${pm(p.tPos, 3)} s = ${f(p.totalPos, 3)} s`, `√(2e / a_rel), e = ${pm(p.envelopeM, 1)} m (your input)`],
      ['Passive window inside the velocity tolerance', `${pm(p.tVel, 4)} s = ${f(p.totalVel, 4)} s`, `v_tol / a_rel, v_tol = ${pm(p.velTolMps, 2)} m/s (your input)`],
      ['Speed when leaving the envelope', `${f(p.speedAtEnvelopeEdge, 2)} m/s`, '√(2 a_rel e)'],
      ['Separation when the tolerance is spent', fmtM(p.separationAtVelTol), 'v_tol² / (2 a_rel)'],
      ['Held window', `${fmtT(h.holdS)} s: ${f(h.accel, 3)} m/s², ${f(h.deltaV, 1)} m/s`, 'thrust = a_rel for the whole window, Δv = a_rel T (your T)'],
      ['Exact two-body check at the envelope edge', exactLine(r), 'RK4 of the vehicle in μ/r² from the matched state against the rigid-rotor tip path (catchwindow.js exact)'],
    ];
    for (const [q, v, s] of rows) {
      const tr = el('tr');
      tr.appendChild(td(q));
      tr.appendChild(td(v, 'num'));
      tr.appendChild(tdSrc('', s));
      tb.appendChild(tr);
    }
  }
  function exactLine(r) {
    try {
      const ex = K.exact(r.kin);
      const tExit = ex.passiveExitTime(r.passive.envelopeM, 0.002);
      const hd = ex.holdDeltaV(r.held.holdS, 400);
      return `exit at ${f(tExit, 4)} s (closed form ${f(r.passive.tPos, 4)} s); hold Δv ${f(hd.deltaV, 2)} m/s (closed form ${f(r.held.deltaV, 2)} m/s)`;
    } catch (e) {
      return 'not computed';
    }
  }

  // ---------------------------------------------------------------- convention & modulation
  function renderConvention(r) {
    const k = r.kin;
    const box = $('convention-body');
    clear(box);
    const p1 = el('p', 'small');
    p1.appendChild(document.createTextNode(`EQ-3a in ${C.sources.physicsModule.path} (line ${C.sources.physicsModule.v_earth_rot_kms.line}) subtracts a literal ${f(C.earthRotKmsEq3a, 3)} km/s "at equator" from the tip's inertial ${f(k.vTipInertialBottom / 1e3, 3)} km/s: `));
    p1.appendChild(el('b', null, `${f(k.eq3a.speed / 1e3, 3)} km/s`));
    p1.appendChild(document.createTextNode(`, the file's v_lower_tip_groundrel_kms. That literal is the equatorial surface speed, ω_E × ${f(C.earthRef.equatorialRadiusKm, 3)} km = ${f(k.coRotationEquatorSurface, 1)} m/s, with ω_E from the ${C.earthRef.siderealRotationPeriodHours} h sidereal day (${C.earthRef.reference}, read ${C.earthRef.read}; full reference in the footer). So EQ-3a is launch-site bookkeeping: what a vehicle launched from the equator still has to add.`));
    box.appendChild(p1);
    const p2 = el('p', 'small');
    p2.appendChild(document.createTextNode(`Relative to the rotating Earth at the tip's own radius the frame moves ω_E × ${f(k.rTipKm, 0)} km = ${f(k.earthFixed.coRotation, 1)} m/s, so the tip's ground-relative velocity there, which is also its airspeed in a co-rotating atmosphere, is `));
    p2.appendChild(el('b', null, `${f(k.earthFixed.speed / 1e3, 3)} km/s`));
    p2.appendChild(document.createTextNode(`, ${f(k.eq3a.speed - k.earthFixed.speed, 0)} m/s below EQ-3a's figure. Neither is a ground-track speed: the point beneath the tip crosses the ground at ${f(k.subPoint.speed / 1e3, 3)} km/s (on the module's ${f(k.subPoint.radiusKm, 0)} km radius).`));
    box.appendChild(p2);
    box.appendChild(el('p', 'small', 'All three assume a prograde equatorial orbit, as EQ-3a does; rev_a.json states no inclination. The parameter sheet (§2.2) does not say whether its ground-relative speed is the bookkeeping figure or the velocity relative to the Earth at the tip; that is a verification-memo question for the maintainer, reported here, not resolved.'));
  }

  function renderModulation(r, m) {
    const box = $('modulation-body');
    clear(box);
    if (!m.ok) {
      box.appendChild(el('p', 'small code', `refusal.code: ${m.refusal.code}`));
      box.appendChild(el('p', 'small', m.refusal.reason));
      return;
    }
    const pct = (x, d) => f(100 * x, d === undefined ? 1 : d);
    const p1 = el('p', 'small');
    p1.appendChild(document.createTextNode(`The gravity gradient modulates the spin. For a rigid line body on a circular orbit, θ'' = −(3/2)Ω² sin 2θ with θ from the local vertical, so the tip is fastest at the vertical, which is the catch, and slowest at the horizontal. At ${f(m.vTipKms, 1)} km/s and L = ${f(m.halfLengthKm, 0)} km the tip speed swings ${pct(m.peakToTroughFraction, 2)} % peak to trough, one cycle every ${f(m.modulationPeriodS, 0)} s, and its rotation mean sits ${pct(m.meanBelowVerticalFraction, 2)} % below its value at the vertical.`));
    box.appendChild(p1);
    box.appendChild(el('p', 'small', 'So which speed is v_tip? The repository does not settle it. The twin is spun up with v_tip at the vertical; the dynamics module says the rotation mean is the quantity that matches v_tip (physics/tether_dynamics.py, run_measuring docstring); the glossary says the nominal spin should sit slightly above the target speed. The two readings give:'));
    const dl = el('dl', 'conv');
    const row = (k, v) => {
      dl.appendChild(el('dt', null, k));
      dl.appendChild(el('dd', null, v));
    };
    row('v_tip at the vertical (the twin’s start; this page’s numbers)', `a_rel ${f(m.vertical.aRel, 2)} m/s²`);
    row('v_tip as the rotation mean', `tip passes the vertical at ${f(m.mean.vAtVerticalMps, 0)} m/s; a_rel ${f(m.mean.aRel, 2)} m/s² (+${pct(m.aRelIncreaseFraction)} %)`);
    box.appendChild(dl);
    box.appendChild(el('p', 'small', `Read as the mean, every envelope window is ${pct(m.envelopeWindowShorteningFraction)} % shorter, every velocity window ${pct(m.velocityWindowShorteningFraction)} % shorter and every hold Δv ${pct(m.aRelIncreaseFraction)} % larger. A verification-memo question for the maintainer, reported here, not resolved.`));
    const g = m.golden;
    const p4 = el('p', 'small');
    if (g && g.applicable) {
      p4.appendChild(document.createTextNode(`Check against the twin: the lumped-mass golden run (${C.sources.golden.path} @ ${SHORT}, ${g.config.nNodes} nodes) starts from this configuration with v_tip at the vertical. Its ${f(g.durationS, 0)} s mean tip speed is `));
      p4.appendChild(el('b', null, `${f(g.meanTipSpeedMps, 2)} m/s`));
      p4.appendChild(document.createTextNode(`, a ${f(g.durationS, 0)} s mean (${f(g.rotationsCovered, 2)} of a rotation, ${f(g.modulationCyclesCovered, 2)} modulation cycles), not a rotation mean. The libration model over the same ${f(g.durationS, 0)} s gives ${f(g.model.meanSpeed, 2)} m/s (${f(100 * (g.model.meanSpeed / g.meanTipSpeedMps - 1), 3)} %).`));
    } else if (g) {
      p4.appendChild(document.createTextNode(`The twin's golden run covers only ${f(g.config.vTipKms, 1)} km/s at L = ${f(g.config.halfLengthKm, 0)} km. At this configuration these figures are the libration model's alone, unchecked against the twin.`));
    } else {
      p4.appendChild(document.createTextNode('No golden run in the snapshot to check the model against.'));
    }
    box.appendChild(p4);
    box.appendChild(el('p', 'small', 'Elasticity, damping and the catch transient itself are not in this page.'));
  }

  // ---------------------------------------------------------------- render
  function hideAll(ref, title) {
    showRefusal(ref, title);
    $('results').hidden = true;
    $('verdict').hidden = true;
  }
  function render() {
    const bad = inputRefusal();
    if (bad) {
      hideAll(bad.refusal, 'Input out of range');
      return;
    }
    const r = K.evaluate({ tier: state.tier, halfLengthKm: state.L, envelopeM: state.env, velTolMps: state.vtol, holdS: state.hold, requirementWindowsS: REQUIREMENT_WINDOWS_S });
    if (!r.ok) {
      hideAll(r.refusal, 'No window to compute');
      return;
    }
    const mod = K.modulation({ vTipKms: r.kin.vTipKms, halfLengthKm: r.kin.halfLengthKm });
    hideRefusal();
    $('results').hidden = false;
    $('verdict').hidden = false;
    renderVerdict(r, mod);
    renderSketch(r);
    renderTimeline(r);
    renderRequirements(r);
    renderTiers(r);
    renderCurve(r);
    renderNumbers(r);
    renderConvention(r);
    renderModulation(r, mod);
    $('prov').textContent = `Tether constants: Skyhook ${C.sources.revA.path} @ ${SHORT} (${C.sources.revA.commitDate ? String(C.sources.revA.commitDate).slice(0, 10) : ''}), sha256 ${String(C.sources.revA.sha256).slice(0, 12)}…, revision ${C.revision}; Earth radius and EQ-3a literal from ${C.sources.physicsModule.path} at the same commit; golden run from ${C.sources.golden ? C.sources.golden.path : '—'}. Earth rotation from ${C.earthRef.source}. Kernel catchwindow.js ${K.version}. An idea-bank prototype: not through Skyhook's Rule 1 canon process, verification memo or pytest suite.`;
  }

  buildTiers();
  setL(C.halfLengthKm);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    // the charts size their viewBox to the rendered width, so redraw after the layout settles
    $('tl-tip').setAttribute('aria-hidden', 'true');
    $('cv-tip').setAttribute('aria-hidden', 'true');
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });
})();
