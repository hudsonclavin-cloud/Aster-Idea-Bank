/* Shadow Lint — the pure logic. Loads as a classic script (window.ShadowLint) and via require().
 *
 * Given the text of a PartForge .scad file with a FLIGHT block, it answers one question for every
 * input of every loads row: can the declared geometry see this number?
 *
 *   WITNESSED    the value equals a declared dimension of compatible unit within that dimension's
 *                tolerance (a critical extent; a hole count; a hole diameter that is a clearance or
 *                tap drill for the declared thread size)
 *   DERIVABLE    the value is an arithmetic combination of declared dimensions (a bore over two; a
 *                wall (od − bore)/2; a feature's from−to span)
 *   UNWITNESSED  nothing declared can see it (a force, a pressure, a speed, an altitude, a yield
 *                strength; or a length whose candidates all miss)
 *   POLICY       sf_min: a declared acceptance threshold, not a physical quantity
 *
 * "Witnessed" means a DECLARED dimension matches. The mesh CMM in PartForge measures the declared
 * dimension; nothing here measures a mesh. The witness names the row the app would measure.
 *
 * Given two files (an attempt and its retry) it also strips every comment, compares the geometry
 * text, and flags every loads input that moved while the geometry did not, plus any loss against
 * PartForge's contract floor (flightCounts, index.html:4823).
 *
 * Nothing is rewritten; the tool reports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShadowLint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------------------------------
  // 1. The parser. Follows PartForge index.html parseFlight() (4672–4751 at 0974a62) field for
  //    field so that what this tool classifies is what the app's evaluator reads. The agreement is
  //    tested against the extracted original in shadow.test.mjs.
  // ------------------------------------------------------------------------------------------
  const TOL_SRC = /^(source|user|default)$/;
  const FLIGHT_HAZARD = /^(none|pressure|hot_gas|energetic|bonded|welded)$/;
  const FLIGHT_AXIS = /^(x|y|z)$/;
  const FLIGHT_CAP = 24;
  const CHECKS = /^(hoop|flutter|thread|bolt_shear)$/;
  const REVOLVE_TYPES = /^(conical|tangent_ogive|vonkarman|lvhaack|haack|parabolic|power|elliptical)$/;

  function mdSafe(s) {
    return String(s).replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').replace(/\|/g, '\\|').replace(/[ \t]+/g, ' ').trim();
  }

  function parseFlight(code) {
    const m = String(code).match(/\/\/\s*FLIGHT-BEGIN\s*\n([\s\S]*?)\/\/\s*FLIGHT-END/);
    if (!m) return null;
    const json = m[1].split('\n').map((l) => l.replace(/^\s*\/\/ ?/, '')).join('\n');
    let f;
    try { f = JSON.parse(json); } catch (e) { return { malformed: true }; }
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { malformed: true };
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d);
    const str = (v, d = '') => typeof v === 'string' ? mdSafe(v) : d;
    const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && isFinite(x)) ? v.map(Number) : null;
    const arr = (k) => (Array.isArray(f[k]) ? f[k] : []).filter((e) => e && typeof e === 'object').slice(0, FLIGHT_CAP);
    const out = {
      material: str(f.material), process: str(f.process), tolerance_class: str(f.tolerance_class, 'ISO 2768-m') || 'ISO 2768-m',
      tess_tol_mm: num(f.tess_tol_mm, 0), hazard: FLIGHT_HAZARD.test(str(f.hazard)) ? str(f.hazard) : 'none',
      tier_declared: /^[ABC]$/.test(str(f.tier).toUpperCase()) ? str(f.tier).toUpperCase() : null,
      critical: [], od: [], bores: [], holes: [], revolve: [], gauges: [], loads: [], dropped: 0, demoted: 0,
    };
    const prov = (e) => {
      const src = TOL_SRC.test(str(e.tol_src)) ? str(e.tol_src) : 'default';
      const ref = str(e.tol_ref).slice(0, 140);
      if (src === 'source' && !ref) { out.demoted++; return { tol_src: 'default', tol_ref: '' }; }
      return { tol_src: src, tol_ref: src === 'source' ? ref : '' };
    };
    for (const c of arr('critical')) {
      if (!FLIGHT_AXIS.test(str(c.axis)) || !(num(c.nominal_mm, 0) > 0) || !(num(c.tol_mm, 0) > 0)) { out.dropped++; continue; }
      out.critical.push({ name: str(c.name, 'dimension').slice(0, 60), module: (str(c.module, 'main') || 'main').replace(/\(\)$/, ''), axis: str(c.axis),
        nominal_mm: num(c.nominal_mm), tol_mm: num(c.tol_mm), round: !!c.round, ...prov(c) });
    }
    const round = (e, dflt) => {
      if (!FLIGHT_AXIS.test(str(e.axis)) || !(num(e.d_mm, 0) > 0) || !(num(e.tol_mm, 0) > 0)) return null;
      const from = num(e.from_mm, NaN), to = num(e.to_mm, NaN);
      if (!isFinite(from) || !isFinite(to) || from === to) return null;
      return { name: str(e.name, dflt).slice(0, 60), d_mm: num(e.d_mm), tol_mm: num(e.tol_mm), pos_tol_mm: num(e.pos_tol_mm, num(e.tol_mm)),
        at_mm: pair(e.at_mm) || [0, 0], axis: str(e.axis), from_mm: from, to_mm: to, ...prov(e) };
    };
    for (const e of arr('od')) { const r = round(e, 'OD'); if (r) out.od.push(r); else out.dropped++; }
    for (const e of arr('bores')) { const r = round(e, 'bore'); if (r) out.bores.push(r); else out.dropped++; }
    for (const e of arr('holes')) {
      const base = round(e, 'holes');
      const pattern = /^(circle|list|single)$/.test(str(e.pattern)) ? str(e.pattern) : (Array.isArray(e.at_mm) ? (pair(e.at_mm) ? 'single' : 'list') : null);
      if (!base || !pattern) { out.dropped++; continue; }
      const h = { ...base, pattern };
      if (pattern === 'circle') {
        h.n = Math.round(num(e.n, 0)); h.bc_d_mm = num(e.bc_d_mm, 0); h.start_deg = num(e.start_deg, 0); h.centre_mm = pair(e.centre_mm) || [0, 0];
        if (!(h.n >= 1 && h.n <= 64) || !(h.bc_d_mm > 0)) { out.dropped++; continue; }
      } else {
        const list = pattern === 'single' ? [pair(e.at_mm)] : (Array.isArray(e.at_mm) ? e.at_mm.map(pair) : []);
        h.at_mm = list.filter(Boolean).slice(0, 64);
        if (!h.at_mm.length) { out.dropped++; continue; }
      }
      out.holes.push(h);
    }
    for (const r of arr('revolve')) {
      if (!REVOLVE_TYPES.test(str(r.type)) || !(num(r.L_mm, 0) > 0) || !(num(r.R_mm, 0) > 0) || !isFinite(num(r.tip_at_mm, NaN))) { out.dropped++; continue; }
      out.revolve.push({ name: str(r.name, 'profile').slice(0, 60), type: str(r.type), L_mm: num(r.L_mm), R_mm: num(r.R_mm), tol_mm: num(r.tol_mm, 0.1) });
    }
    for (const g of arr('gauges')) {
      if (!/^[A-Za-z_]\w*$/.test(str(g.module))) { out.dropped++; continue; }
      out.gauges.push({ name: str(g.name, str(g.module)).slice(0, 60), module: str(g.module) });
    }
    for (const l of arr('loads')) {
      if (!CHECKS.test(str(l.check))) { out.dropped++; continue; }
      const o = { check: str(l.check), name: str(l.name, str(l.check)).slice(0, 60) };
      for (const [k, v] of Object.entries(l)) if (k !== 'check' && k !== 'name' && /^[a-z_]+$/i.test(k)) o[k] = typeof v === 'number' ? v : str(String(v)).slice(0, 40);
      o.inputs_src = TOL_SRC.test(str(l.inputs_src)) ? str(l.inputs_src) : 'default';
      o.inputs_ref = o.inputs_src === 'source' ? str(l.inputs_ref).slice(0, 140) : '';
      if (o.inputs_src === 'source' && !o.inputs_ref) { o.inputs_src = 'default'; out.demoted++; }
      out.loads.push(o);
    }
    return out;
  }

  // PartForge's contract floor counts (index.html:4823 flightCounts).
  function flightCounts(f) {
    return f && !f.malformed
      ? { critical: f.critical.length, od: f.od.length, bores: f.bores.length, holes: f.holes.length, revolve: f.revolve.length, gauges: f.gauges.length, loads: f.loads.length }
      : null;
  }

  // ------------------------------------------------------------------------------------------
  // 2. Fastener rows (an excerpt of PartForge data/tables/fasteners_metric.json and
  //    fasteners_un.json, loaded by the caller) → one shape: major diameter, tap drills, clearances.
  // ------------------------------------------------------------------------------------------
  function sizeKey(s) {
    const t = String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    let m = t.match(/^M(\d+(?:\.\d+)?)/);
    if (m) return 'M' + m[1];
    m = t.match(/^#?(\d{1,2})-(\d+)$/);
    if (m) return '#' + m[1] + '-' + m[2];
    m = t.match(/^(\d+\/\d+)-(\d+)$/);
    if (m) return m[1] + '-' + m[2];
    return null;
  }

  function fastenerIndex(data) {
    const idx = {};
    const metric = (data && data.metric && data.metric.rows) || [];
    const un = (data && data.un && data.un.rows) || [];
    for (const r of metric) {
      idx[r.key] = { key: r.key, table: 'fasteners_metric', major_mm: r.d_mm, confidence: r.confidence,
        taps: [['tap drill', r.tap_drill_mm], ['stainless tap drill', r.tap_drill_stainless_mm]].filter((x) => x[1] > 0),
        clearances: [['fine', r.clearance_fine_mm], ['medium', r.clearance_medium_mm], ['coarse', r.clearance_coarse_mm]].filter((x) => x[1] > 0) };
    }
    for (const r of un) {
      idx[r.key] = { key: r.key, table: 'fasteners_un', major_mm: r.major_mm, confidence: r.confidence,
        taps: [['75% tap drill', r.tap_drill_75_mm], ['50% tap drill', r.tap_drill_50_mm]].filter((x) => x[1] > 0),
        clearances: [['close', r.clearance_close_mm], ['normal', r.clearance_normal_mm], ['loose', r.clearance_loose_mm]].filter((x) => x[1] > 0) };
    }
    return idx;
  }

  const fmt = (v, dp) => (typeof v === 'number' && isFinite(v)) ? (dp == null ? String(+v.toFixed(4)) : v.toFixed(dp)) : String(v);
  const within = (value, cand, tol) => Math.abs(value - cand) <= tol + 1e-9;

  // A hole whose diameter sits between the thread's major diameter and its loosest clearance is a
  // clearance hole for that thread; one at a tap-drill diameter is a tapped hole for it.
  function clearanceFor(fast, d, tol) {
    if (!fast || !fast.clearances.length) return null;
    const loosest = Math.max(...fast.clearances.map((c) => c[1]));
    if (d < fast.major_mm - tol - 1e-9 || d > loosest + tol + 1e-9) return null;
    const exact = fast.clearances.find((c) => within(d, c[1], tol));
    const src = ' (' + fast.table + ' ' + fast.confidence + ')';
    return { kind: 'clearance', label: exact ? 'the ' + exact[0] + ' clearance ' + fmt(exact[1]) + ' for ' + fast.key + src
      : 'a clearance for ' + fast.key + ' (between major ' + fmt(fast.major_mm) + ' and ' + fast.clearances.map((c) => c[0] + ' ' + fmt(c[1])).join(' / ') + ')' + src };
  }
  function tapFor(fast, d, tol) {
    if (!fast) return null;
    const hit = fast.taps.find((t) => within(d, t[1], tol));
    return hit ? { kind: 'tap', label: 'the ' + hit[0] + ' ' + fmt(hit[1]) + ' for ' + fast.key + ' (' + fast.table + ' ' + fast.confidence + ')' } : null;
  }

  // ------------------------------------------------------------------------------------------
  // 3. The classifier.
  // ------------------------------------------------------------------------------------------
  // What each numeric key of each check means to PartForge's evaluator (index.html:5754–5813).
  const KEYS = {
    hoop: { P_MPa: 'pressure', ri_mm: 'radius', t_mm: 'thickness', sf_min: 'policy' },
    flutter: { root_mm: 'planform', tip_mm: 'planform', span_mm: 'planform', thick_mm: 'thickness', sweep_mm: 'planform', v_max_m_s: 'speed', alt_m: 'altitude', sf_min: 'policy' },
    thread: { size: 'thread', engagement_mm: 'engagement', bolt_sigma_u_MPa: 'strength', sf_min: 'policy' },
    bolt_shear: { size: 'thread', n: 'count', force_N: 'force', plate_t_mm: 'thickness', bolt_sigma_y_MPa: 'strength', sf_min: 'policy' },
  };
  // The inputs the evaluator demands when a row cannot be evaluated (index.html:5826), in its order.
  const REQUIRED = {
    hoop: ['P_MPa', 'ri_mm', 't_mm'], flutter: ['root_mm', 'tip_mm', 'span_mm', 'thick_mm', 'v_max_m_s', 'alt_m'],
    thread: ['size', 'engagement_mm'], bolt_shear: ['size', 'n', 'force_N', 'plate_t_mm'],
  };
  const NO_SHADOW = {
    pressure: 'a pressure: nothing in the geometry can see it',
    force: 'a load: nothing in the geometry can see it',
    speed: 'a flight speed: nothing in the geometry can see it',
    altitude: 'an altitude: nothing in the geometry can see it',
    strength: 'a material strength: nothing in the geometry can see it',
  };
  const DOCTRINE_DEFAULT_SF = { hoop: 2.0, flutter: 1.5, bolt_shear: 2.0, thread: null }; // index.html:5759, 5767, 5812; thread sets ok itself (5776)

  function candidates(f) {
    const ext = f.critical.map((c) => ({ kind: 'critical', name: c.name, where: c.module + '/' + c.axis, value: c.nominal_mm, tol: c.tol_mm, tol_src: c.tol_src }));
    const spans = [];
    for (const kind of ['od', 'bores', 'holes']) for (const r of f[kind]) spans.push({ kind: 'span', of: kind, name: r.name, value: Math.abs(r.from_mm - r.to_mm), tol: r.tol_mm, from: r.from_mm, to: r.to_mm, d_mm: r.d_mm });
    const walls = [];
    // A wall exists only where an OD and a bore are coaxial AND share a stretch of the axis.
    const lo = (r) => Math.min(r.from_mm, r.to_mm), hi = (r) => Math.max(r.from_mm, r.to_mm);
    for (const o of f.od) for (const b of f.bores) {
      if (o.axis !== b.axis || o.at_mm[0] !== b.at_mm[0] || o.at_mm[1] !== b.at_mm[1] || !(o.d_mm > b.d_mm)) continue;
      if (Math.min(hi(o), hi(b)) - Math.max(lo(o), lo(b)) <= 1e-9) continue;
      walls.push({ kind: 'wall', name: o.name + ' − ' + b.name, value: (o.d_mm - b.d_mm) / 2, tol: (o.tol_mm + b.tol_mm) / 2, od: o.d_mm, bore: b.d_mm });
    }
    const radii = f.bores.map((b) => ({ kind: 'radius', name: b.name, value: b.d_mm / 2, tol: b.tol_mm / 2, d_mm: b.d_mm }));
    const counts = f.holes.map((h) => ({ kind: 'count', name: h.name, value: h.pattern === 'circle' ? h.n : h.pattern === 'single' ? 1 : h.at_mm.length, pattern: h.pattern, d_mm: h.d_mm, tol: h.tol_mm, from: h.from_mm, to: h.to_mm }));
    return { ext, spans, walls, radii, counts };
  }

  function describe(c) {
    switch (c.kind) {
      case 'critical': return 'critical "' + c.name + '" ' + c.where + ' ' + fmt(c.value, 2) + ' ±' + fmt(c.tol) + ' (' + c.tol_src + ')';
      case 'span': return c.of + ' "' + c.name + '" spans ' + fmt(c.from) + '→' + fmt(c.to) + ' = ' + fmt(c.value, 2);
      case 'wall': return 'wall (' + fmt(c.od) + ' − ' + fmt(c.bore) + ')/2 = ' + fmt(c.value, 2) + ' from od "' + c.name.split(' − ')[0] + '" and bore "' + c.name.split(' − ')[1] + '"';
      case 'radius': return 'bore "' + c.name + '" Ø' + fmt(c.d_mm) + '/2 = ' + fmt(c.value, 2);
      case 'count': return 'holes "' + c.name + '" ' + c.pattern + ' × ' + c.value + ', Ø' + fmt(c.d_mm);
      default: return JSON.stringify(c);
    }
  }

  function nearestOf(value, list) {
    let best = null;
    for (const c of list) { const d = Math.abs(value - c.value); if (!best || d < best.delta) best = { cand: c, delta: d }; }
    return best;
  }

  // Classify one numeric or thread-size input. Returns { class, witness: [text], note }.
  function classifyInput(key, kind, value, row, C, fast, motors) {
    const W = (w, note) => ({ class: 'WITNESSED', witness: w, note: note || '' });
    const D = (w, note) => ({ class: 'DERIVABLE', witness: w, note: note || '' });
    const U = (note, nearest) => ({ class: 'UNWITNESSED', witness: [], note: note || '', nearest: nearest || null });
    const fastRow = fast[sizeKey(row.size)] || null;
    const sizeNote = fastRow ? '' : (row.size ? 'thread size "' + row.size + '" is not in the fastener excerpt; ' : 'no thread size declared; ');

    if (kind === 'policy') {
      const d = DOCTRINE_DEFAULT_SF[row.check];
      return { class: 'POLICY', witness: [], note: 'declared acceptance threshold' + (d != null ? ' (the doctrine default for ' + row.check + ' is ' + d.toFixed(1) + ')' : '') };
    }
    if (NO_SHADOW[kind]) {
      let note = NO_SHADOW[kind];
      if (key === 'force_N' && row.motor) {
        const hit = (motors || []).find((m) => motorMatches(m, row.motor));
        if (hit) note += '; the evaluator holds it to the certified peak of ' + hit.mfr + ' ' + hit.name + ' (' + hit.max_thrust_N + ' N, ' + hit.max_thrust_src + ', motor_perf ' + hit.confidence + ') — a data witness, not a geometric one' + (within(value, hit.max_thrust_N, 0.5) ? '; the declared value equals that peak' : '; the declared value differs from that peak');
        else note += '; motor "' + row.motor + '" is not in this excerpt of motor_perf.json (the app would look it up)';
      }
      return U(note);
    }
    if (typeof value !== 'number' && kind !== 'thread') return U('not a number: "' + value + '"');

    if (kind === 'thickness') {
      const hits = [], weak = [];
      for (const c of C.ext) if (within(value, c.value, c.tol)) hits.push(c);
      for (const c of C.walls) if (within(value, c.value, c.tol)) weak.push(c);
      for (const c of C.spans) if (within(value, c.value, c.tol)) weak.push(c);
      if (hits.length) return W(hits.concat(weak).map(describe));
      if (weak.length) return D(weak.map(describe));
      const near = nearestOf(value, C.ext.concat(C.walls, C.spans));
      return U(near ? 'no declared extent, wall or span within tolerance; nearest ' + describe(near.cand) + ' (Δ ' + fmt(near.delta, 2) + ')' : 'no declared extent, wall or span to compare with', near);
    }
    if (kind === 'planform') {
      const hits = C.ext.filter((c) => within(value, c.value, c.tol));
      if (hits.length) return W(hits.map(describe));
      const near = nearestOf(value, C.ext);
      return U(near ? 'no critical extent within tolerance; nearest ' + describe(near.cand) + ' (Δ ' + fmt(near.delta, 2) + ')' : 'no critical extents declared', near);
    }
    if (kind === 'radius') {
      const hits = C.radii.filter((c) => within(value, c.value, c.tol));
      if (hits.length) return D(hits.map(describe));
      const near = nearestOf(value, C.radii);
      return U(near ? 'no bore whose radius matches; nearest ' + describe(near.cand) + ' (Δ ' + fmt(near.delta, 2) + ')' : 'no bores declared', near);
    }
    if (kind === 'engagement') {
      const tapped = [], other = [];
      for (const c of C.spans) {
        if (c.of === 'od' || !within(value, c.value, c.tol)) continue;
        (tapFor(fastRow, c.d_mm, c.tol) ? tapped : other).push(c);
      }
      if (tapped.length) return D(tapped.map((c) => describe(c) + ', Ø' + fmt(c.d_mm) + ' is ' + tapFor(fastRow, c.d_mm, c.tol).label));
      if (other.length) return D(other.map(describe), sizeNote + 'the matching span is not at a tap-drill diameter for the declared size, so it may be a clearance hole; the tapped part may be the mating part');
      const near = nearestOf(value, C.spans.filter((c) => c.of !== 'od'));
      return U(sizeNote + (near ? 'no hole or bore span matches; nearest ' + describe(near.cand) + ' (Δ ' + fmt(near.delta, 2) + ')' : 'no holes or bores declared') + ' — a thread engagement is usually in the mating part', near);
    }
    if (kind === 'count') {
      const sameCount = C.counts.filter((c) => c.value === value);
      const compatible = C.counts.filter((c) => clearanceFor(fastRow, c.d_mm, c.tol));
      const both = sameCount.filter((c) => compatible.includes(c));
      if (both.length) return W(both.map((c) => describe(c) + ' — ' + clearanceFor(fastRow, c.d_mm, c.tol).label));
      if (sameCount.length && !fastRow) return W(sameCount.map(describe), sizeNote + 'count matched only; diameter not checked');
      if (sameCount.length) return U('count matches ' + sameCount.map(describe).join('; ') + ' but no row with that count is a clearance size for ' + fastRow.key + (compatible.length ? '; the clearance-size rows have ' + compatible.map((c) => c.value).join(', ') : ''));
      if (compatible.length) return U('no hole row has ' + value + ' entries; the clearance-size rows for ' + fastRow.key + ' have ' + compatible.map((c) => describe(c)).join('; '));
      return U(sizeNote + (C.counts.length ? 'no hole row has ' + value + ' entries (' + C.counts.map((c) => c.value).join(', ') + ' declared)' : 'no holes declared'));
    }
    if (kind === 'thread') {
      if (!fastRow) return U(sizeNote + 'cannot match hole diameters to it');
      const hits = [];
      // the hole row whose count matches the declared n is the one the check is about; list it first
      const ordered = C.counts.slice().sort((a, b) => (b.value === row.n) - (a.value === row.n));
      for (const c of ordered) {
        const hit = row.check === 'thread' ? tapFor(fastRow, c.d_mm, c.tol) : clearanceFor(fastRow, c.d_mm, c.tol);
        if (hit) hits.push(describe(c) + ' — ' + hit.label);
      }
      if (!hits.length && row.check === 'thread') for (const b of f_bores(C)) { const hit = tapFor(fastRow, b.d_mm, b.tol); if (hit) hits.push(describe(b) + ' — ' + hit.label); }
      if (hits.length) return W(hits);
      return U(row.check === 'thread' ? 'no hole or bore at a tap-drill diameter for ' + fastRow.key + ' — the tapped part is probably the mating part' : 'no hole at a clearance diameter for ' + fastRow.key + (C.counts.length ? ' (declared Ø ' + C.counts.map((c) => fmt(c.d_mm)).join(', ') + ')' : ''));
    }
    return U('no rule for this key; nothing checks it');
  }
  function f_bores(C) { return C.radii.map((r) => ({ kind: 'bore', name: r.name, d_mm: r.d_mm, tol: r.tol * 2, value: r.d_mm })); }

  function motorMatches(m, q) {
    const s = String(q || '').toLowerCase();
    const norm = (x) => String(x || '').toLowerCase().replace(/[\s-]/g, '');
    if (norm(s).includes(norm(m.designation)) && String(m.designation).length >= 5) return true;
    return new RegExp('(^|[^a-z0-9])' + String(m.name).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(s);
  }

  // The whole classification of one file's declaration.
  function classify(f, data) {
    const fast = fastenerIndex(data);
    const motors = (data && data.motors && data.motors.rows) || [];
    const C = candidates(f);
    const rows = [];
    const totals = { WITNESSED: 0, DERIVABLE: 0, UNWITNESSED: 0, POLICY: 0 };
    const surface = [];
    for (const l of f.loads) {
      const keys = KEYS[l.check] || {};
      const inputs = [];
      const other = {};
      for (const [k, v] of Object.entries(l)) {
        if (k === 'check' || k === 'name' || k === 'inputs_src' || k === 'inputs_ref') continue;
        if (keys[k]) {
          const kind = keys[k];
          if (kind === 'thread' ? typeof v !== 'string' : typeof v !== 'number') { other[k] = v; continue; }
          const r = classifyInput(k, kind, v, l, C, fast, motors);
          inputs.push({ key: k, kind, value: v, ...r });
        } else if (typeof v === 'number') {
          inputs.push({ key: k, kind: 'unknown', value: v, class: 'UNWITNESSED', witness: [], note: 'no rule for this key in this tool; PartForge\'s ' + l.check + ' check does not read it' });
        } else other[k] = v;
      }
      // The evaluator refuses a row that lacks a required input (index.html:5756, 5762, 5771, 5781);
      // a missing input is listed so the table shows the hole where a number should be.
      const missing = (REQUIRED[l.check] || []).filter((k) => !(k in l));
      for (const i of inputs) totals[i.class]++;
      for (const i of inputs) if (i.class === 'UNWITNESSED') surface.push(l.name + '.' + i.key);
      rows.push({ check: l.check, name: l.name, inputs_src: l.inputs_src, inputs_ref: l.inputs_ref, inputs, other, missing });
    }
    return { rows, totals, inventionSurface: surface, counts: flightCounts(f),
      declared: { critical: f.critical.length, od: f.od.length, bores: f.bores.length, holes: f.holes.length, revolve: f.revolve.length, gauges: f.gauges.length },
      material: f.material, process: f.process, dropped: f.dropped, demoted: f.demoted };
  }

  // ------------------------------------------------------------------------------------------
  // 4. One file end to end: parse, refuse when there is nothing honest to say, else classify.
  // ------------------------------------------------------------------------------------------
  function refusal(code, reason, help) { return { refusal: { code, reason, what_would_help: help } }; }

  function lint(text, data, label) {
    const f = parseFlight(text);
    if (f === null) return refusal('not_found', 'no FLIGHT-BEGIN/FLIGHT-END block in ' + (label || 'the file'), 'a flight-grade file carries its declaration as a commented JSON block; see PartForge `headless/cli.mjs doctrine flight`');
    if (f.malformed) return refusal('invalid_input', 'the FLIGHT block is not valid JSON' + (label ? ' in ' + label : ''), 'PartForge\'s parser also rejects it ({malformed:true}); fix the JSON before anything downstream reads it');
    if (!f.loads.length) return refusal('insufficient_data', 'the declaration has no loads rows' + (f.dropped ? ' (' + f.dropped + ' malformed entries dropped)' : '') + (label ? ' in ' + label : ''), 'there is nothing to lint: a loads row (hoop, flutter, thread or bolt_shear) is what carries the numbers this tool classifies');
    return { label: label || '', flight: f, result: classify(f, data) };
  }

  // ------------------------------------------------------------------------------------------
  // 5. Two attempts: geometry text, loads inputs, contract floor.
  // ------------------------------------------------------------------------------------------
  // Code outside comment blocks, whitespace-normalised. Comments carry SPEC, FLIGHT, KIND and NOTE
  // text, none of which the OpenSCAD engine compiles; the model rewrites them on every retry.
  function geometryText(src) {
    const noBlock = String(src).replace(/\/\*[\s\S]*?\*\//g, '');
    const noLine = noBlock.replace(/\/\/[^\n]*/g, '');
    return noLine.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
  }
  function lineDiff(a, b) {
    const A = a ? a.split('\n') : [], B = b ? b.split('\n') : [];
    const n = A.length, m = B.length;
    if (n * m > 4e6) return { added: null, removed: null, note: 'files too long for the line diff' };
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const common = dp[0][0];
    return { added: m - common, removed: n - common, common };
  }
  const same = (x, y) => (typeof x === 'number' && typeof y === 'number') ? Math.abs(x - y) <= 1e-9 : x === y;

  function diffAttempts(aText, bText, data, labels) {
    const la = (labels && labels[0]) || 'A', lb = (labels && labels[1]) || 'B';
    const A = lint(aText, data, la), B = lint(bText, data, lb);
    if (A.refusal) return { refusal: { ...A.refusal, reason: la + ': ' + A.refusal.reason } };
    if (B.refusal) return { refusal: { ...B.refusal, reason: lb + ': ' + B.refusal.reason } };
    const ga = geometryText(aText), gb = geometryText(bText);
    const geometry = { identical: ga === gb, ...lineDiff(ga, gb), identicalFiles: aText === bText };
    const findings = [], moved = [], declarations = [];
    const classOf = (L, name, check, key) => { const r = L.result.rows.find((x) => x.name === name && x.check === check); const i = r && r.inputs.find((x) => x.key === key); return i ? i.class : (r ? 'other' : null); };
    // loads rows matched by (check, name)
    const seen = new Set();
    for (const ra of A.flight.loads) {
      const rb = B.flight.loads.find((x) => x.check === ra.check && x.name === ra.name && !seen.has(x));
      if (!rb) { moved.push({ row: ra.name, check: ra.check, key: '(row)', from: 'declared', to: 'removed', before: null, after: null }); continue; }
      seen.add(rb);
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (k === 'check' || k === 'name') continue;
        if (same(ra[k], rb[k])) continue;
        const before = classOf(A, ra.name, ra.check, k), after = classOf(B, rb.name, rb.check, k);
        moved.push({ row: ra.name, check: ra.check, key: k, from: ra[k] === undefined ? '(absent)' : ra[k], to: rb[k] === undefined ? '(absent)' : rb[k], before, after });
      }
    }
    for (const rb of B.flight.loads) if (!seen.has(rb)) moved.push({ row: rb.name, check: rb.check, key: '(row)', from: 'absent', to: 'added', before: null, after: null });
    // declarations (information, not a finding: the CMM re-measures these against the mesh)
    for (const kind of ['critical', 'od', 'bores', 'holes']) {
      for (const ea of A.flight[kind]) {
        const eb = B.flight[kind].find((x) => x.name === ea.name);
        if (!eb) { declarations.push({ kind, name: ea.name, key: '(entry)', from: 'declared', to: 'removed' }); continue; }
        for (const k of ['nominal_mm', 'd_mm', 'tol_mm', 'from_mm', 'to_mm', 'n', 'bc_d_mm', 'axis', 'module']) if (k in ea && !same(ea[k], eb[k])) declarations.push({ kind, name: ea.name, key: k, from: ea[k], to: eb[k] });
        if (ea.pattern !== 'circle' && eb.pattern !== 'circle' && Array.isArray(ea.at_mm) && Array.isArray(eb.at_mm) && ea.pattern && JSON.stringify(ea.at_mm) !== JSON.stringify(eb.at_mm)) declarations.push({ kind, name: ea.name, key: 'at_mm', from: ea.at_mm.length + ' positions', to: eb.at_mm.length + ' positions' });
      }
      for (const eb of B.flight[kind]) if (!A.flight[kind].find((x) => x.name === eb.name)) declarations.push({ kind, name: eb.name, key: '(entry)', from: 'absent', to: 'added' });
    }
    // the contract floor, as the app applies it (index.html:5840–5843)
    const was = flightCounts(A.flight), now = flightCounts(B.flight);
    const lost = Object.keys(was).filter((k) => now[k] < was[k]).map((k) => ({ category: k, from: was[k], to: now[k] }));
    for (const l of lost) findings.push({ code: 'floor_loss', text: 'declares fewer ' + l.category + ' entries than the previous version: ' + l.from + ' → ' + l.to + ' (PartForge\'s contract floor fails this retry)' });
    if (geometry.identical) {
      for (const mv of moved) {
        const cls = mv.before || mv.after;   // describe the input as it was when it moved
        const kind = mv.key === '(row)' ? 'row' : cls === 'WITNESSED' || cls === 'DERIVABLE' ? 'a witnessed input' : cls === 'POLICY' ? 'the acceptance threshold' : cls === 'UNWITNESSED' ? 'an unwitnessed input' : 'a declared key';
        const lostWitness = (mv.before === 'WITNESSED' || mv.before === 'DERIVABLE') && mv.after === 'UNWITNESSED' ? '; it lost its witness' : '';
        findings.push({ code: 'input_moved_geometry_unchanged', text: mv.check + ' "' + mv.row + '": ' + mv.key + ' ' + fmt(mv.from) + ' → ' + fmt(mv.to) + ' while the geometry is byte-identical — ' + kind + ' changed and no mesh will notice' + lostWitness + (mv.before && mv.after ? ' (' + mv.before + ' → ' + mv.after + ')' : '') });
      }
    }
    return { labels: [la, lb], A, B, geometry, moved, declarations, floor: { was, now, lost }, findings };
  }

  // ------------------------------------------------------------------------------------------
  // 6. Text rendering (what the CLI prints and example.txt saves).
  // ------------------------------------------------------------------------------------------
  function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
  function wrap(text, width, indent) {
    const words = String(text).split(' ');
    const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > width && cur) { lines.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w; }
    if (cur) lines.push(cur);
    return lines.map((l, i) => (i ? indent : '') + l).join('\n');
  }

  function renderLint(L, opts) {
    const o = opts || {};
    const out = [];
    if (L.refusal) { out.push('refused (' + L.refusal.code + '): ' + L.refusal.reason); out.push('  what would help: ' + L.refusal.what_would_help); return out.join('\n'); }
    const r = L.result, d = r.declared;
    out.push('shadow lint — ' + (L.label || 'FLIGHT declaration') + ' (' + (r.material || 'no material') + ', ' + (r.process || 'no process') + '; declared ' + d.critical + ' critical, ' + d.od + ' od, ' + d.bores + ' bores, ' + d.holes + ' holes, ' + d.revolve + ' revolve, ' + d.gauges + ' gauges, ' + r.rows.length + ' loads' + (r.dropped ? '; ' + r.dropped + ' malformed entries dropped' : '') + ')');
    for (const row of r.rows) {
      out.push('');
      out.push('  ' + row.check + ' "' + row.name + '"  inputs_src ' + row.inputs_src + (row.inputs_ref ? ' (' + row.inputs_ref + ')' : ''));
      out.push('    ' + pad('input', 18) + pad('value', 11) + pad('class', 13) + 'witness');
      for (const i of row.inputs) {
        const w = i.witness.length ? i.witness.join('; also ') : i.note;
        const extra = i.witness.length && i.note ? ' — ' + i.note : '';
        out.push('    ' + pad(i.key, 18) + pad(fmt(i.value), 11) + pad(i.class, 13) + wrap(w + extra, 74, ' '.repeat(46)));
      }
      for (const k of row.missing) out.push('    ' + pad(k, 18) + pad('(missing)', 11) + pad('—', 13) + 'the evaluator refuses this row without it');
      const others = Object.entries(row.other).filter(([k]) => k !== 'inputs_src' && k !== 'inputs_ref');
      if (others.length) out.push('    other keys: ' + others.map(([k, v]) => k + '=' + JSON.stringify(v)).join(', '));
    }
    const n = Object.values(r.totals).reduce((a, b) => a + b, 0);
    out.push('');
    out.push('  ' + n + ' inputs: ' + r.totals.WITNESSED + ' witnessed, ' + r.totals.DERIVABLE + ' derivable, ' + r.totals.UNWITNESSED + ' unwitnessed, ' + r.totals.POLICY + ' policy threshold' + (r.totals.POLICY === 1 ? '' : 's'));
    out.push('  invention surface: ' + r.inventionSurface.length + ' input' + (r.inventionSurface.length === 1 ? '' : 's') + ' no declared geometry can see' + (r.inventionSurface.length ? ' — ' + r.inventionSurface.join(', ') : ''));
    if (!o.terse) out.push('  (witnessed = a DECLARED dimension matches; the mesh CMM measures that declaration, this tool does not)');
    return out.join('\n');
  }

  function renderDiff(Dp) {
    const out = [];
    if (Dp.refusal) { out.push('refused (' + Dp.refusal.code + '): ' + Dp.refusal.reason); out.push('  what would help: ' + Dp.refusal.what_would_help); return out.join('\n'); }
    const g = Dp.geometry;
    out.push('attempt diff — ' + Dp.labels[0] + ' → ' + Dp.labels[1]);
    out.push('  geometry (code outside comments, whitespace-normalised): ' + (g.identicalFiles ? 'the two files are byte-identical' : g.identical ? 'IDENTICAL — only comments changed' : 'changed: ' + g.removed + ' line' + (g.removed === 1 ? '' : 's') + ' removed, ' + g.added + ' added'));
    out.push('  contract floor (flightCounts): ' + Object.keys(Dp.floor.was).map((k) => k + ' ' + Dp.floor.was[k] + (Dp.floor.now[k] === Dp.floor.was[k] ? '' : '→' + Dp.floor.now[k])).join(', ') + (Dp.floor.lost.length ? '  — LOST: ' + Dp.floor.lost.map((l) => l.category).join(', ') : '  — held'));
    out.push('  loads inputs: ' + (Dp.moved.length ? Dp.moved.length + ' change' + (Dp.moved.length === 1 ? '' : 's') : 'unchanged'));
    for (const m of Dp.moved) out.push('    ' + m.check + ' "' + m.row + '" ' + m.key + ': ' + fmt(m.from) + ' → ' + fmt(m.to) + (m.before || m.after ? '  [' + (m.before || '—') + ' → ' + (m.after || '—') + ']' : ''));
    out.push('  declarations: ' + (Dp.declarations.length ? Dp.declarations.length + ' change' + (Dp.declarations.length === 1 ? '' : 's') + ' (information: the CMM re-measures these against the mesh)' : 'unchanged'));
    for (const d of Dp.declarations.slice(0, 40)) out.push('    ' + d.kind + ' "' + d.name + '" ' + d.key + ': ' + fmt(d.from) + ' → ' + fmt(d.to));
    if (Dp.declarations.length > 40) out.push('    … ' + (Dp.declarations.length - 40) + ' more');
    out.push('');
    if (Dp.findings.length) { out.push('  FINDINGS (' + Dp.findings.length + '):'); for (const f of Dp.findings) out.push('    ' + f.code + ': ' + wrap(f.text, 100, ' '.repeat(6))); }
    else out.push('  no findings: ' + (g.identical ? 'nothing moved' : 'the geometry changed, the inputs did not, and the floor held'));
    return out.join('\n');
  }

  // A machine-readable envelope in the shape PartForge's headless CLI uses (headless/partforge.mjs:41).
  function envelope(tool, value, extra) {
    const e = { ok: !(extra && extra.refusal), tool, value: extra && extra.refusal ? null : value, units: 'mm, N, MPa, m/s, m', confidence: 'measured',
      provenance: [{ source: 'the FLIGHT declaration text of the file(s) named; parsed as PartForge index.html parseFlight() does' }],
      assumptions: ['"witnessed" means a declared dimension of compatible unit matches within its declared tolerance; no mesh is measured here',
        'thread sizes are matched to hole diameters through an excerpt of PartForge data/tables/fasteners_metric.json and fasteners_un.json, whose rows keep their confidence field'],
      validity_envelope: 'classifies what the declaration can see; it cannot know whether an unwitnessed number is right, only that nothing checks it', summary: (extra && extra.summary) || '' };
    if (extra && extra.provenance) e.provenance.push(...extra.provenance);
    if (extra && extra.refusal) e.refusal = extra.refusal;
    return e;
  }

  return { parseFlight, flightCounts, mdSafe, sizeKey, fastenerIndex, clearanceFor, tapFor, candidates, classify, lint, geometryText, lineDiff, diffAttempts, renderLint, renderDiff, envelope, motorMatches, KEYS, REQUIRED, DOCTRINE_DEFAULT_SF, FLIGHT_CAP };
});
