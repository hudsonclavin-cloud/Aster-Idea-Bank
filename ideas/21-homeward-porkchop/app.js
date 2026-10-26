/* app.js — draws the return-leg porkchop from homeward.js. Every number shown comes from the
 * kernel, from data.js (built from snapshots/), or from snapshots/earth-weekly.js. */
(function () {
  'use strict';
  const H = window.Homeward;
  const D = window.HomewardData;
  const E = window.HomewardEarth;
  const C = D.constants;
  const $ = (id) => document.getElementById(id);
  const earth = H.makeEphemeris(E.records, C.secondsPerDay);
  const lattice = H.defaultLattice(earth, D.lattice);
  const parkingAltKm = C.parkingRadiusKm - C.earthRadiusKm;
  const state = { body: null, metric: 'arr', grid: null, sel: null, nhats: null };
  const M = {
    arr: { key: 'vInfArr', min: 'vInfArr', minAll: 'vInfArrAll', name: 'Earth-arrival v∞', long: 'Earth-arrival v∞' },
    dep: { key: 'vInfDep', min: 'vInfDep', minAll: 'vInfDepAll', name: 'departure v∞ at the body', long: 'Departure v∞ at the body' },
  };

  // ---------- small helpers ----------
  const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
  const iso = (jd) => H.jdToIso(jd);
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function remember(k, v) {
    try { localStorage.setItem(`homeward.${k}`, v); } catch (e) { /* storage blocked: nothing to keep */ }
  }
  function recall(k) {
    try { return localStorage.getItem(`homeward.${k}`); } catch (e) { return null; }
  }
  function mps(kmS) {
    const v = kmS * 1000;
    return v >= 100 ? fmtInt(v) : v.toFixed(1);
  }
  function bodyLabel(b) {
    return `${b.name} · ${b.tier ? b.tier.tier : 'no tier'}`;
  }

  // ---------- tier sentence, return-leg wording ----------
  function tierSentence(b) {
    const t = b.tier;
    if (!t) return 'This body has no record in the committed tier artifact.';
    if (t.tier === 'L1' && t.encounter) {
      const date = H.cadDate(t.encounter.cd) || t.encounter.cd;
      let s = `Fidelity tier L1. Screening for this object is supported through ${date}: a close approach to ${t.encounter.body} on that date changes its orbit by an estimated ${mps(t.encounter.dvKmS)} m/s. For a return leg the body's state is needed when you leave it, so departures on or after that date are computed from an orbit the encounter invalidates.`;
      if (t.maxDriftEncounter) {
        s += ` The largest perturbation in the window is a close approach to ${t.maxDriftEncounter.body} on ${H.cadDate(t.maxDriftEncounter.cd)}, about ${mps(t.maxDriftEncounter.dvKmS)} m/s.`;
      }
      return s;
    }
    if (t.tier === 'L2' && t.subReason === 'measured-but-unbounded') {
      return 'Fidelity tier L2: Aster measured the two-body screening error for this object, but it exceeds the bound Aster can certify. No departure date is marked unsupported; none is certified either.';
    }
    return `Fidelity tier ${t.tier} (${t.subReason}).`;
  }

  // ---------- body list ----------
  function initBodies() {
    const sel = $('body');
    for (const b of D.bodies) {
      const o = el('option', { value: b.designation }, bodyLabel(b));
      sel.appendChild(o);
    }
    const saved = recall('body');
    sel.value = D.bodies.some((b) => b.designation === saved) ? saved : D.bodies[0].designation;
    sel.addEventListener('change', () => {
      remember('body', sel.value);
      selectBody(sel.value);
    });
  }

  function setMetric(m) {
    state.metric = m;
    remember('metric', m);
    $('mArr').setAttribute('aria-checked', String(m === 'arr'));
    $('mDep').setAttribute('aria-checked', String(m === 'dep'));
    renderAll();
  }

  function selectBody(des) {
    const b = D.bodies.find((x) => x.designation === des);
    const refused = H.bodyRefusal(b);
    state.body = b;
    if (refused) {
      state.grid = null;
      renderRefusedBody(refused);
      return;
    }
    state.grid = H.computeGrid(b, earth, lattice, C);
    const m = state.grid.minima[M[state.metric].min] || state.grid.minima[M[state.metric].minAll];
    state.sel = m ? { i: m.i, j: m.j } : { i: 0, j: 0 };
    state.nhats = nhatsFor(b);
    renderAll();
  }

  function nhatsFor(b) {
    if (!b.nhatsFile || !D.nhats[b.nhatsFile]) return null;
    const t = D.nhats[b.nhatsFile].min_dv_traj;
    const d = H.nhatsReturnDates(t);
    return { t, d, leg: H.returnLeg(b, earth, d.depJd, d.tofDays, C) };
  }

  // ---------- plot geometry ----------
  const PAD = { l: 46, r: 10, t: 10, b: 40 };
  function geom() {
    const cv = $('pc');
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const g = state.grid;
    const pw = Math.max(10, w - PAD.l - PAD.r);
    const ph = Math.max(10, h - PAD.t - PAD.b);
    const nD = g.deps.length;
    const nT = g.tofs.length;
    const depStep = (lattice.depEndJd - lattice.depStartJd) / (nD - 1);
    const tofStep = (lattice.tofMaxDays - lattice.tofMinDays) / (nT - 1);
    const cw = pw / nD;
    const ch = ph / nT;
    return {
      w, h, pw, ph, cw, ch, nD, nT,
      x: (jd) => PAD.l + ((jd - lattice.depStartJd) / depStep + 0.5) * cw,
      y: (tof) => PAD.t + ph - ((tof - lattice.tofMinDays) / tofStep + 0.5) * ch,
      cellAt: (px, py) => {
        const i = Math.floor((px - PAD.l) / cw);
        const j = nT - 1 - Math.floor((py - PAD.t) / ch);
        return i >= 0 && i < nD && j >= 0 && j < nT ? { i, j } : null;
      },
    };
  }

  function drawPlot() {
    const cv = $('pc');
    const g = state.grid;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css('--plot-bg');
    ctx.fillRect(0, 0, w, h);
    if (!g) return;
    const G = geom();
    const key = M[state.metric].key;
    // Cells into an nDep × nTof bitmap, then scaled up without smoothing.
    const off = document.createElement('canvas');
    off.width = G.nD;
    off.height = G.nT;
    const octx = off.getContext('2d');
    const img = octx.createImageData(G.nD, G.nT);
    const hatchBg = hexRgb(css('--hatch-bg'));
    for (let i = 0; i < G.nD; i += 1) {
      for (let j = 0; j < G.nT; j += 1) {
        const k = i * G.nT + j;
        const p = ((G.nT - 1 - j) * G.nD + i) * 4;
        let rgb;
        if (g.status[k] === H.STATUS.OK) {
          const v = g[key][k];
          rgb = H.viridisRgb(v * v, D.colormap);
        } else if (g.status[k] === H.STATUS.NO_EARTH) rgb = hatchBg;
        else rgb = D.colormap.noSolutionRgb;
        img.data[p] = rgb[0];
        img.data[p + 1] = rgb[1];
        img.data[p + 2] = rgb[2];
        img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, PAD.l, PAD.t, G.pw, G.ph);
    // Hatch over the refused cells (no Earth ephemeris at arrival).
    ctx.save();
    const clip = new Path2D();
    for (let i = 0; i < G.nD; i += 1) {
      for (let j = 0; j < G.nT; j += 1) {
        if (g.status[i * G.nT + j] === H.STATUS.NO_EARTH) {
          clip.rect(PAD.l + i * G.cw, PAD.t + (G.nT - 1 - j) * G.ch, G.cw + 0.5, G.ch + 0.5);
        }
      }
    }
    ctx.clip(clip);
    ctx.strokeStyle = css('--hatch-line');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = -G.ph; s < G.pw; s += 6) {
      ctx.moveTo(PAD.l + s, PAD.t + G.ph);
      ctx.lineTo(PAD.l + s + G.ph, PAD.t);
    }
    ctx.stroke();
    ctx.restore();
    // Wash and dashed line for departures on or after the L1 encounter.
    if (g.boundary && g.boundary.encounterJd <= lattice.depEndJd + 1e-9) {
      let first = g.deps.findIndex((d) => d >= g.boundary.encounterJd);
      if (first < 0) first = G.nD;
      ctx.fillStyle = css('--wash');
      ctx.fillRect(PAD.l + first * G.cw, PAD.t, G.pw - first * G.cw, G.ph);
      const bx = Math.max(PAD.l, Math.min(PAD.l + G.pw, G.x(g.boundary.encounterJd)));
      ctx.strokeStyle = css('--boundary');
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(bx, PAD.t);
      ctx.lineTo(bx, PAD.t + G.ph);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawAxes(ctx, G);
    // NHATS return leg, where it falls inside the lattice.
    const n = state.nhats;
    if (nhatsInLattice(n)) {
      const x = G.x(n.d.depJd);
      const y = G.y(n.d.tofDays);
      ctx.lineWidth = 4;
      ctx.strokeStyle = css('--mark-ring');
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = css('--mark');
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.stroke();
    }
    // Selected cell.
    if (state.sel) {
      const sx = PAD.l + state.sel.i * G.cw;
      const sy = PAD.t + (G.nT - 1 - state.sel.j) * G.ch;
      const pad = Math.max(2, (8 - Math.min(G.cw, G.ch)) / 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = css('--mark-ring');
      ctx.strokeRect(sx - pad - 1, sy - pad - 1, G.cw + 2 * pad + 2, G.ch + 2 * pad + 2);
      ctx.strokeStyle = css('--sel');
      ctx.strokeRect(sx - pad, sy - pad, G.cw + 2 * pad, G.ch + 2 * pad);
    }
  }

  function drawAxes(ctx, G) {
    ctx.fillStyle = css('--plot-axis');
    ctx.strokeStyle = css('--plot-axis');
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    // x: 1 January of each year inside the departure span.
    const y0 = Number(iso(lattice.depStartJd).slice(0, 4));
    const y1 = Number(iso(lattice.depEndJd).slice(0, 4));
    const every = G.pw < 420 ? 3 : G.pw < 700 ? 2 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let yr = y0; yr <= y1 + 1; yr += 1) {
      const jd = H.isoToJd(`${yr}-01-01`);
      if (jd < lattice.depStartJd || jd > lattice.depEndJd) continue;
      const x = G.x(jd);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t + G.ph);
      ctx.lineTo(x, PAD.t + G.ph + 4);
      ctx.stroke();
      if ((yr - y0) % every === 0) ctx.fillText(String(yr), x, PAD.t + G.ph + 6);
    }
    ctx.fillText('Leave the body (TDB date)', PAD.l + G.pw / 2, PAD.t + G.ph + 22);
    // y: flight time.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const step = G.ph < 220 ? 200 : 100;
    for (let tof = Math.ceil(lattice.tofMinDays / step) * step; tof <= lattice.tofMaxDays; tof += step) {
      const y = G.y(tof);
      ctx.beginPath();
      ctx.moveTo(PAD.l - 4, y);
      ctx.lineTo(PAD.l, y);
      ctx.stroke();
      ctx.fillText(String(tof), PAD.l - 6, y);
    }
    ctx.save();
    ctx.translate(11, PAD.t + G.ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Flight time to Earth (days)', 0, 0);
    ctx.restore();
  }

  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---------- legend ----------
  function drawRamp() {
    const cv = $('ramp');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const ctx = cv.getContext('2d');
    const cm = D.colormap;
    for (let x = 0; x < cv.width; x += 1) {
      const t = x / Math.max(1, cv.width - 1);
      const energy = Math.exp(Math.log(cm.min) + t * (Math.log(cm.max) - Math.log(cm.min)));
      const rgb = H.viridisRgb(energy, cm);
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(x, 0, 1, cv.height);
    }
    const ticks = $('rampTicks');
    ticks.textContent = '';
    const vMin = Math.sqrt(cm.min);
    const vMax = Math.sqrt(cm.max);
    for (const v of [1, 2, 5, 10, 20, vMax]) {
      if (v < vMin || v > vMax) continue;
      const t = (Math.log(v * v) - Math.log(cm.min)) / (Math.log(cm.max) - Math.log(cm.min));
      const s = el('span', null, v === vMax ? `≥${v.toFixed(1)}` : String(v));
      s.style.left = `${(t * 100).toFixed(2)}%`;
      if (t === 0) s.style.transform = 'none';
      if (t === 1) s.style.transform = 'translateX(-100%)';
      ticks.appendChild(s);
    }
    $('rampCap').textContent = `${M[state.metric].long}, km/s. Colour is Aster's porkchop scale (log-viridis over ${cm.min}–${cm.max} km²/s²) applied to v∞²; at or below ${vMin} km/s every cell is the darkest colour.`;
  }

  // ---------- readouts ----------
  function renderHeader() {
    const g = state.grid;
    $('tier').textContent = tierSentence(state.body);
    $('lattice').textContent = `${g.label} · zero-revolution transfers only`;
    $('plotTitle').textContent = `Return legs from ${state.body.name} to Earth, coloured by ${M[state.metric].name}`;
    $('keyEarth').textContent = `Earth arrival after ${iso(earth.endJd)}: no ephemeris, refused`;
    $('keyWash').textContent = g.boundary ? `Leaves on or after ${g.boundary.label} (L1 encounter)` : 'No L1 boundary for this body';
    $('jNhats').disabled = !nhatsInLattice(state.nhats);
    const list = $('minima');
    list.textContent = '';
    for (const mk of ['arr', 'dep']) {
      const m = g.minima[M[mk].min];
      const all = g.minima[M[mk].minAll];
      const li = el('li');
      if (m) {
        li.appendChild(document.createTextNode(`Lowest ${M[mk].name} among supported cells: `));
        li.appendChild(el('b', { class: 'num' }, `${f3(g[M[mk].key][m.k])} km/s`));
        li.appendChild(document.createTextNode(`, leaving ${iso(g.deps[m.i])} with ${g.tofs[m.j].toFixed(0)} d to Earth (${g.label}).`));
        const edges = H.edgesOf(g, m);
        if (edges.length) {
          li.appendChild(el('span', { class: 'edge' }, ` It sits on an edge of what was searched (${edges.join('; ')}), so the true minimum may lie beyond it.`));
        }
      } else {
        li.textContent = `No supported cell for ${M[mk].name}: every computed departure is on or after the L1 encounter.`;
      }
      if (all && (!m || all.k !== m.k)) {
        li.appendChild(document.createTextNode(` Lower past the L1 boundary: ${f3(g[M[mk].key][all.k])} km/s leaving ${iso(g.deps[all.i])}, computed from an orbit the encounter invalidates.`));
      }
      list.appendChild(li);
    }
    const c = g.counts;
    const li = el('li', null, `${fmtInt(c.ok)} of ${fmtInt(c.cells)} legs computed; ${fmtInt(c.noEarth)} refused because Earth arrival falls after ${iso(earth.endJd)}; ${fmtInt(c.unsupported)} computed legs leave on or after the L1 encounter.`);
    list.appendChild(li);
  }

  function row(dl, label, sub, value) {
    const dt = el('dt', null, label);
    if (sub) dt.appendChild(el('small', null, sub));
    dl.appendChild(dt);
    dl.appendChild(el('dd', null, value));
  }

  function nearestDrift(b, jd) {
    const t = D.drift.targets[b.designation];
    if (!t) return null;
    let best = null;
    for (const r of t.records) if (!best || Math.abs(r[0] - jd) < Math.abs(best[0] - jd)) best = r;
    const s = H.keplerState(b.elements, best[0], C);
    return {
      jd: best[0],
      dr: Math.hypot(s.r[0] - best[1], s.r[1] - best[2], s.r[2] - best[3]),
      dv: Math.hypot(s.v[0] - best[4], s.v[1] - best[5], s.v[2] - best[6]),
    };
  }

  function renderCell() {
    const g = state.grid;
    const b = state.body;
    const { i, j } = state.sel;
    const cell = H.cellAt(g, b, earth, i, j, C);
    const dl = $('readout');
    dl.textContent = '';
    const sup = $('support');
    row(dl, 'Leave the body', null, iso(cell.depJd));
    row(dl, 'Reach Earth', null, iso(cell.arrJd));
    row(dl, 'Flight time', null, `${cell.tofDays.toFixed(0)} d`);
    const box = $('refusal');
    box.textContent = '';
    if (cell.status === H.STATUS.OK) {
      sup.className = cell.supported ? 'support' : 'support bad';
      sup.textContent = cell.supported
        ? (g.boundary ? `Supported: leaves before the ${g.boundary.label} encounter.` : 'No L1 boundary applies to this body (see the tier note above).')
        : `Past the L1 boundary: leaves on or after the ${g.boundary.label} encounter, so the body's state comes from an orbit that encounter invalidates.`;
      row(dl, 'Departure v∞ at the body', 'the burn to leave, impulsive; the body’s own gravity is ignored', `${f3(cell.vInfDep)} km/s`);
      row(dl, 'Earth-arrival v∞', 'the quantity Aster’s K2 would hand to Skyhook', `${f3(cell.vInfArr)} km/s`);
      row(dl, 'Arrival declination', 'equatorial (ICRF), asin(vz/|v∞|), as Aster computes its DLA', cell.decArrDeg === null ? '—' : `${cell.decArrDeg.toFixed(2)}°`);
      const over = cell.entrySpeed > C.entryCapKmS;
      row(dl, `Entry speed at ${C.entryAltitudeKm} km`, `direct entry, vis-viva; NHATS caps it at ${C.entryCapKmS} km/s${over ? ' (this leg is over)' : ''}`, `${f3(cell.entrySpeed)} km/s`);
      row(dl, `Capture into a ${parkingAltKm.toFixed(0)} km circular orbit`, 'Aster’s injection formula run backwards', `${f3(cell.captureDv)} km/s`);
      const dr = nearestDrift(b, cell.depJd);
      if (dr) {
        row(dl, 'Body state vs JPL integrated truth', `two-body error at the nearest checkpoint, ${iso(dr.jd)}`, `${fmtInt(dr.dr)} km, ${(dr.dv * 1000).toFixed(1)} m/s`);
      }
    } else {
      sup.className = 'support bad';
      sup.textContent = 'This cell is refused; nothing is computed for it.';
      box.appendChild(refusalCard(cell.status === H.STATUS.NO_EARTH ? 'This leg: refused' : 'This leg: no solution', cell.refusal || H.refusal('insufficient_data', `The solver returned ${cell.reason}.`, 'A different flight time.')));
    }
    box.appendChild(refusalCard('Delivered mass: refused', cell.deliveredMass.refusal));
  }

  function refusalCard(title, r) {
    const d = el('div', { class: 'refusal-item' });
    d.appendChild(el('h3', null, title));
    const p1 = el('p');
    p1.appendChild(el('code', null, r.code));
    p1.appendChild(document.createTextNode(` ${r.reason}`));
    d.appendChild(p1);
    d.appendChild(el('p', null, `What would help: ${r.what_would_help}`));
    return d;
  }

  function renderRefusedBody(r) {
    $('tier').textContent = '';
    $('readout').textContent = '';
    $('support').textContent = '';
    const box = $('refusal');
    box.textContent = '';
    box.appendChild(refusalCard('This body: refused', r));
    drawPlot();
  }

  // ---------- NHATS table ----------
  function renderNhats() {
    $('nhNote').textContent = `JPL's NHATS lists a minimum-ΔV round trip for each of the five validation targets Aster keeps in its fixtures. The return leg inside it leaves the asteroid on launch + outbound days + stay days and flies for the return days. The page solves that leg with its own pipeline and sets its numbers beside NHATS's (rounded to 0.001 km/s and 0.001°). Entry speeds are at ${C.entryAltitudeKm} km.`;
    const tbl = $('nhTable');
    tbl.textContent = '';
    const head = el('tr');
    for (const [t, cls] of [['Body and status', ''], ['Return leg', ''], ['Departure v∞, page / NHATS', ''], ['Entry speed, page / NHATS', ''], ['Arrival declination, page / NHATS', 'hide-sm'], ['', '']]) {
      head.appendChild(el('th', cls ? { class: cls } : null, t));
    }
    const thead = el('thead');
    thead.appendChild(head);
    tbl.appendChild(thead);
    const tbody = el('tbody');
    for (const b of D.bodies) {
      const n = nhatsFor(b);
      if (!n) continue;
      const tr = el('tr');
      const bnd = H.supportBoundary(b.tier);
      let status;
      if (n.leg.status === H.STATUS.NO_EARTH) status = `refused: reaches Earth ${iso(n.d.arrJd)}, after the ephemeris`;
      else if (H.departsAfterEncounter(n.d.depJd, bnd)) status = `past the L1 boundary (${bnd.label})`;
      else status = 'supported';
      const name = el('td', null, b.name);
      name.appendChild(el('span', { class: 'st' }, status));
      tr.appendChild(name);
      tr.appendChild(el('td', null, `${iso(n.d.depJd)}, ${n.d.tofDays} d`));
      const ok = n.leg.status === H.STATUS.OK;
      tr.appendChild(el('td', { class: 'r' }, `${ok ? f3(n.leg.vInfDep) : '—'} / ${n.t.vrel_dep_neo}`));
      tr.appendChild(el('td', { class: 'r' }, `${ok ? f3(n.leg.entrySpeed) : '—'} / ${n.t.v_arr_earth}`));
      tr.appendChild(el('td', { class: 'r hide-sm' }, `${ok ? n.leg.decArrDeg.toFixed(3) : '—'} / ${n.t.dec_arr}`));
      const td = el('td');
      const inLattice = nhatsInLattice(n);
      const btn = el('button', { type: 'button', 'data-body': b.designation }, inLattice ? 'Show' : 'Show body');
      btn.addEventListener('click', () => {
        $('body').value = b.designation;
        remember('body', b.designation);
        selectBody(b.designation);
        if (inLattice) jumpNhats();
        $('pc').focus();
      });
      td.appendChild(btn);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
  }

  function renderHow() {
    const ul = $('how');
    ul.textContent = '';
    const b = state.body;
    const s = H.keplerState(b.elements, b.elements.epochTdbJd, C);
    const dr = Math.hypot(...s.r.map((x, i) => x - b.anchor.positionKm[i]));
    const items = [
      `Frame check for ${b.name}: its catalog elements (J2000 ecliptic), propagated to their own epoch ${iso(b.elements.epochTdbJd)} and turned through the J2000 obliquity, land ${(dr * 1e6).toFixed(1)} mm from the catalog's ICRF anchor state.`,
      `Earth: ${E.keptRecords} of the ${fmtInt(E.sourceRecords)} daily JPL Horizons records Aster commits (every 7th, plus the last), joined by cubic Hermite. Measured against the other ${fmtInt(E.heldOut.count)}: at most ${E.heldOut.maxPositionErrorKm.toFixed(0)} km in position and ${(E.heldOut.maxVelocityErrorKmS * 1000).toFixed(2)} m/s in velocity.`,
      'Lambert: this deposit’s own universal-variable solver, zero revolutions, prograde about the ICRF z axis (Aster calls izzo.ts the same way). It reproduces Aster’s own Lambert oracle vectors; the README lists them.',
      `The asteroid moves on a two-body Kepler orbit from its catalog elements; the L1 boundary is Slice 18's earliest material encounter, from Aster's tier artifact (${D.tierMeta.generatedAtUtc.slice(0, 10)}).`,
      `Aster's sample-return ΔV stack books this burn home as the outbound arrival v∞ (src/v2/porkchop/delta-v.ts:${C.symmetricReturnLine}); this page computes it.`,
    ];
    for (const t of items) ul.appendChild(el('li', null, t));
    $('foot').textContent = `Data: Aster ${D.aster.commit.slice(0, 7)} (${D.aster.commitDate.slice(0, 10)}), copied with provenance sidecars into snapshots/. Idea-bank prototype: not through Aster's math audit, oracle validation or founding-document process.`;
  }

  function renderAll() {
    if (!state.grid) return;
    renderHeader();
    drawPlot();
    drawRamp();
    renderCell();
    renderHow();
  }

  // ---------- interaction ----------
  function select(i, j) {
    const g = state.grid;
    state.sel = { i: Math.max(0, Math.min(g.deps.length - 1, i)), j: Math.max(0, Math.min(g.tofs.length - 1, j)) };
    drawPlot();
    renderCell();
  }
  function jumpMin(mk) {
    const g = state.grid;
    const m = g.minima[M[mk].min] || g.minima[M[mk].minAll];
    if (m) select(m.i, m.j);
  }
  function nhatsInLattice(n) {
    return !!n && n.leg.status === H.STATUS.OK &&
      n.d.depJd >= lattice.depStartJd && n.d.depJd <= lattice.depEndJd &&
      n.d.tofDays >= lattice.tofMinDays && n.d.tofDays <= lattice.tofMaxDays;
  }
  function jumpNhats() {
    const n = state.nhats;
    const g = state.grid;
    if (!g || !nhatsInLattice(n)) return;
    let bi = 0;
    let bj = 0;
    for (let i = 0; i < g.deps.length; i += 1) if (Math.abs(g.deps[i] - n.d.depJd) < Math.abs(g.deps[bi] - n.d.depJd)) bi = i;
    for (let j = 0; j < g.tofs.length; j += 1) if (Math.abs(g.tofs[j] - n.d.tofDays) < Math.abs(g.tofs[bj] - n.d.tofDays)) bj = j;
    select(bi, bj);
  }
  function tooltip(ev) {
    const tip = $('tip');
    if (!state.grid || ev.pointerType === 'touch') {
      tip.hidden = true;
      return;
    }
    const rect = $('pc').getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const c = geom().cellAt(px, py);
    if (!c) {
      tip.hidden = true;
      return;
    }
    const g = state.grid;
    const k = c.i * g.tofs.length + c.j;
    tip.textContent = '';
    const head = el('div', null, `${iso(g.deps[c.i])} · ${g.tofs[c.j].toFixed(0)} d`);
    tip.appendChild(head);
    if (g.status[k] === H.STATUS.OK) {
      const a = el('div');
      a.appendChild(el('b', null, `${f3(g.vInfArr[k])} km/s`));
      a.appendChild(document.createTextNode(' arrival v∞'));
      const d = el('div');
      d.appendChild(el('b', null, `${f3(g.vInfDep[k])} km/s`));
      d.appendChild(document.createTextNode(' departure v∞'));
      tip.appendChild(a);
      tip.appendChild(d);
      if (H.departsAfterEncounter(g.deps[c.i], g.boundary)) tip.appendChild(el('div', null, 'past the L1 boundary'));
    } else {
      tip.appendChild(el('div', null, 'refused: no Earth ephemeris'));
    }
    tip.hidden = false;
    const wrap = $('wrap').getBoundingClientRect();
    const tw = tip.offsetWidth;
    let left = px + 14;
    if (left + tw > wrap.width) left = Math.max(0, px - tw - 14);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, py - 10)}px`;
  }

  function initInteraction() {
    const cv = $('pc');
    cv.addEventListener('pointermove', tooltip);
    cv.addEventListener('pointerleave', () => { $('tip').hidden = true; });
    cv.addEventListener('click', (ev) => {
      if (!state.grid) return;
      const rect = cv.getBoundingClientRect();
      const c = geom().cellAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (c) select(c.i, c.j);
    });
    cv.addEventListener('keydown', (ev) => {
      if (!state.grid || !state.sel) return;
      const step = ev.shiftKey ? 5 : 1;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[ev.key]) {
        ev.preventDefault();
        select(state.sel.i + moves[ev.key][0], state.sel.j + moves[ev.key][1]);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        jumpMin(state.metric);
      }
    });
    $('mArr').addEventListener('click', () => setMetric('arr'));
    $('mDep').addEventListener('click', () => setMetric('dep'));
    $('jArr').addEventListener('click', () => jumpMin('arr'));
    $('jDep').addEventListener('click', () => jumpMin('dep'));
    $('jNhats').addEventListener('click', jumpNhats);
    let pending = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { drawPlot(); drawRamp(); });
    });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const redraw = () => { drawPlot(); drawRamp(); };
      if (mq.addEventListener) mq.addEventListener('change', redraw);
    }
  }

  // ---------- start ----------
  initBodies();
  initInteraction();
  const savedMetric = recall('metric');
  state.metric = savedMetric === 'dep' ? 'dep' : 'arr';
  $('mArr').setAttribute('aria-checked', String(state.metric === 'arr'));
  $('mDep').setAttribute('aria-checked', String(state.metric === 'dep'));
  renderNhats();
  selectBody($('body').value);
})();
