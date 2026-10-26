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
 *                strength, a bolt grade or material named in text, a shank in the shear plane; or a
 *                length whose candidates all miss)
 *   POLICY       sf_min on a check that reads it: a declared acceptance threshold
 * Beside them: the gaps (a key the evaluator refuses without, assumes, or mishandles) and the keys
 * the check never reads.
 *
 * "Witnessed" means a DECLARED dimension matches. The mesh CMM in PartForge measures the declared
 * dimension; nothing here measures a mesh. The witness names the row the app would measure.
 *
 * Given two files (an attempt and its retry) it also strips every comment, compares the geometry
 * text, judges which way each changed loads key moved (easier, harder, or no effect on the check),
 * and flags a move that makes a check easier while the geometry did not change, plus any loss
 * against PartForge's contract floor (flightCounts, index.html:4823).
 *
 * Nothing is rewritten; the tool reports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShadowLint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------------------------------
  // 1. The parser. Follows PartForge index.html parseFlight() (4672–4750 at 0974a62) field for
  //    field in every category it returns (critical, od, bores, holes, revolve, gauges, loads) and in
  //    the dropped/demoted counts, so that what this tool classifies is what the app's evaluator reads.
  //    It leaves out `mfg` and the provenance summary, which no check reads. The agreement is tested
  //    against the extracted original in shadow.test.mjs.
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
      out.revolve.push({ name: str(r.name, 'profile').slice(0, 60), type: str(r.type), L_mm: num(r.L_mm), R_mm: num(r.R_mm), C: num(r.C, 0), K: num(r.K, 0.75), n: num(r.n, 0.5),
        axis: FLIGHT_AXIS.test(str(r.axis)) ? str(r.axis) : 'z', tip_at_mm: num(r.tip_at_mm), direction: num(r.direction, -1) >= 0 ? 1 : -1, at_mm: pair(r.at_mm) || [0, 0], tol_mm: num(r.tol_mm, 0.1), ...prov(r) });
    }
    for (const g of arr('gauges')) {
      if (!/^[A-Za-z_]\w*$/.test(str(g.module))) { out.dropped++; continue; }
      out.gauges.push({ name: str(g.name, str(g.module)).slice(0, 60), module: str(g.module), expect: /^(interfere|blocked|contact|touch)$/.test(str(g.expect)) ? 'interfere' : 'clear', why: str(g.why).slice(0, 80) });
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
  // How PartForge's evaluator reads each loads key, per check (index.html at 0974a62; `at` cites
  // the line that reads it).
  //   kind    what the number or name means to the check
  //   read    v → the number the evaluator computes with, or null when it does not use v as given
  //           (absent, not a number, or outside the range it accepts). A numeric string is read as
  //           +v, exactly as the evaluator's `+l.key` does.
  //   absent  what the evaluator does when read() gives null: 'refuse' (the row is not evaluated),
  //           'assume' (it computes with `dflt`; `assumed` says what), 'bug' (plate_t_mm, Finding
  //           F7), 'grade' (bolt_sigma_y_MPa falls back to the grade), 'part' (the part's material)
  //   easier  the direction of change that makes the check easier to pass ('up' | 'down'); absent
  //           where the check does not move one way with the input (the flutter planform)
  const pos = (v) => (+v > 0 ? +v : null);
  const MAT = { kind: 'material', absent: 'part', at: ':5749', what: 'names the material whose strength the check uses (FLIGHT_MATERIALS[...] at index.html:5749; an unknown name falls back to the part material); a material named in text: nothing in the geometry can see it' };
  const SPEC = {
    hoop: {
      P_MPa: { kind: 'pressure', read: pos, absent: 'refuse', easier: 'down', at: ':5756' },
      ri_mm: { kind: 'radius', read: pos, absent: 'refuse', easier: 'down', at: ':5756' },
      t_mm: { kind: 'thickness', read: pos, absent: 'refuse', easier: 'up', at: ':5756' },
      sf_min: { kind: 'policy', read: pos, absent: 'assume', dflt: 2.0, assumed: 'holds the row to the doctrine default SF 2.0', easier: 'down', at: ':5759' },
      material: MAT,
    },
    flutter: {
      root_mm: { kind: 'planform', read: pos, absent: 'refuse', at: ':5762' },
      tip_mm: { kind: 'planform', read: (v) => (+v >= 0 ? +v : null), absent: 'refuse', at: ':5762' },
      span_mm: { kind: 'planform', read: pos, absent: 'refuse', at: ':5762' },
      thick_mm: { kind: 'thickness', read: pos, absent: 'refuse', easier: 'up', at: ':5762' },
      sweep_mm: { kind: 'planform', read: pos, absent: 'assume', dflt: null, assumed: 'assumes ε 0.25, the symmetric-fin value (`sweep_mm` undefined in flutterVelocity)', at: ':5764, :751' },
      v_max_m_s: { kind: 'speed', read: pos, absent: 'refuse', easier: 'down', at: ':5766, :5769' },
      alt_m: { kind: 'altitude', read: (v) => (+v ? +v : null), absent: 'assume', dflt: 0, assumed: 'assumes sea level (`+l.alt_m || 0`)', easier: 'up', at: ':5764' },
      sf_min: { kind: 'policy', read: pos, absent: 'assume', dflt: 1.5, assumed: 'holds the row to the doctrine default SF 1.5', easier: 'down', at: ':5767' },
      material: MAT,
    },
    thread: {
      size: { kind: 'thread', absent: 'refuse', at: ':5773, parseThreadSize :797' },
      engagement_mm: { kind: 'engagement', read: pos, absent: 'refuse', easier: 'up', at: ':5771' },
      bolt_sigma_u_MPa: { kind: 'strength', read: pos, absent: 'assume', dflt: 800, assumed: 'assumes a bolt UTS of 800 MPa', easier: 'down', at: ':5773' },
      internal_material: { kind: 'material', absent: 'part', at: ':5772', what: 'names the tapped material whose strength the strip check uses (FLIGHT_MATERIALS[...] at index.html:5772, else the row\'s material); a material named in text: nothing in the geometry can see it' },
      material: MAT,
      sf_min: { kind: 'unread', at: ':5775', what: 'PartForge\'s thread check ignores it: it sets sf_min 1.0 and passes on strip ≥ bolt and the engagement rule (index.html:5775–5776), whatever is declared' },
    },
    bolt_shear: {
      size: { kind: 'thread', absent: 'refuse', at: ':5810, parseThreadSize :797' },
      n: { kind: 'count', read: (v) => (+v ? Math.max(1, Math.round(+v)) : null), absent: 'assume', dflt: 1, assumed: 'silently assumes 1 bolt (`Math.max(1, Math.round(+l.n || 1))`)', easier: 'up', at: ':5810' },
      force_N: { kind: 'force', read: pos, absent: 'refuse', easier: 'down', at: ':5781' },
      plate_t_mm: { kind: 'thickness', read: pos, absent: 'bug', easier: 'up', at: ':5810' },
      grade: { kind: 'grade', at: ':5804–5808' },
      bolt_sigma_y_MPa: { kind: 'strength', read: pos, absent: 'grade', easier: 'up', at: ':5805' },
      shear_plane: { kind: 'shear plane', at: ':5809' },
      motor: { kind: 'motor', at: ':5786–5793' },
      threads_in_shear: { kind: 'unread', at: ':5809', what: 'parseFlight turns it into a string (:4735), so `l.threads_in_shear === false` (:5809) can never hold (Finding F1); only shear_plane works' },
      sf_min: { kind: 'policy', read: pos, absent: 'assume', dflt: 2.0, assumed: 'holds the row to the doctrine default SF 2.0', easier: 'down', at: ':5812' },
      material: MAT,
    },
  };
  // KEYS (kind per key) and REQUIRED (the keys without which the evaluator refuses the row) are derived
  // from SPEC so they cannot disagree with it. The evaluator's own retry hint (:5826) also asks for n,
  // plate_t_mm, alt_m and internal_material, which it in fact defaults, mishandles (F7) or falls back on.
  const KEYS = Object.fromEntries(Object.entries(SPEC).map(([c, ks]) => [c, Object.fromEntries(Object.entries(ks).map(([k, s]) => [k, s.kind]))]));
  const REQUIRED = Object.fromEntries(Object.entries(SPEC).map(([c, ks]) => [c, Object.keys(ks).filter((k) => ks[k].absent === 'refuse')]));
  const DOCTRINE_DEFAULT_SF = { hoop: 2.0, flutter: 1.5, bolt_shear: 2.0, thread: null }; // index.html:5759, 5767, 5812; thread fixes 1.0 and ignores sf_min (5775)
  const NO_SHADOW = {
    pressure: 'a pressure: nothing in the geometry can see it',
    force: 'a load: nothing in the geometry can see it',
    speed: 'a flight speed: nothing in the geometry can see it',
    altitude: 'an altitude: nothing in the geometry can see it',
    strength: 'a material strength: nothing in the geometry can see it',
  };
  const BY_NAME = { material: true, grade: true, 'shear plane': true };
  const SHANK = /shank|plain/i;   // index.html:5809

  // The bolt yield the evaluator uses for a bolt_shear row: bolt_sigma_y_MPa when positive, else
  // GRADE_SY[grade] (index.html:5804–5805). grades = the GRADE_SY excerpt, or null.
  function boltYield(l, grades) {
    const y = +l.bolt_sigma_y_MPa;
    if (y > 0) return { sy: y, via: 'bolt_sigma_y_MPa' };
    if (!grades) return null;
    const key = String(l.grade || '').toLowerCase().trim();
    return Object.prototype.hasOwnProperty.call(grades, key) && grades[key] > 0 ? { sy: grades[key], via: 'grade ' + l.grade } : null;
  }

  function candidates(f) {
    const ext = f.critical.map((c) => ({ kind: 'critical', name: c.name, where: c.module + '/' + c.axis, value: c.nominal_mm, tol: c.tol_mm, tol_src: c.tol_src }));
    const spans = [];
    for (const kind of ['od', 'bores', 'holes']) for (const r of f[kind]) spans.push({ kind: 'span', of: kind, name: r.name, value: Math.abs(r.from_mm - r.to_mm), tol: r.tol_mm, from: r.from_mm, to: r.to_mm, d_mm: r.d_mm });
    const lo = (r) => Math.min(r.from_mm, r.to_mm), hi = (r) => Math.max(r.from_mm, r.to_mm);
    const coaxial = (o, b) => o.axis === b.axis && o.at_mm[0] === b.at_mm[0] && o.at_mm[1] === b.at_mm[1];
    // A bore whose axial span lies strictly inside a coaxial, larger OD's span opens at neither end of
    // that section: the signature of an external groove declared as a bore. PartForge's CMM rejects
    // exactly that on the endcap dry run ("the groove is declared as a bore down the axis", "declare it
    // as an od": tests/dryrun/cases.json). Walls and radii built on such a bore carry a caveat.
    const enclosing = (b) => f.od.find((o) => coaxial(o, b) && o.d_mm > b.d_mm && lo(b) > lo(o) + 1e-9 && hi(b) < hi(o) - 1e-9) || null;
    const zs = (r) => 'z ' + fmt(lo(r)) + '–' + fmt(hi(r));
    const grooveNote = (b, o, what) => 'caveat: bore "' + b.name + '" (' + zs(b).replace('z ', b.axis + ' ') + ') lies strictly inside od "' + o.name + '" (' + zs(o).replace('z ', o.axis + ' ') + '), the signature of an external groove declared as a bore; if it is one, ' + what;
    const walls = [];
    // A wall exists only where an OD and a bore are coaxial AND share a stretch of the axis.
    for (const o of f.od) for (const b of f.bores) {
      if (!coaxial(o, b) || !(o.d_mm > b.d_mm)) continue;
      if (Math.min(hi(o), hi(b)) - Math.max(lo(o), lo(b)) <= 1e-9) continue;
      const g = enclosing(b);
      walls.push({ kind: 'wall', name: o.name + ' − ' + b.name, value: (o.d_mm - b.d_mm) / 2, tol: (o.tol_mm + b.tol_mm) / 2, od: o.d_mm, bore: b.d_mm,
        caveat: g ? grooveNote(b, g, 'this number is the groove depth, and the "wall" is the material the groove removes') : '' });
    }
    const radii = f.bores.map((b) => { const g = enclosing(b); return { kind: 'radius', name: b.name, value: b.d_mm / 2, tol: b.tol_mm / 2, d_mm: b.d_mm,
      caveat: g ? grooveNote(b, g, 'this is the groove-root radius, not the inside of a pressurised wall') : '' }; });
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
  const caveats = (list) => [...new Set(list.map((c) => c.caveat).filter(Boolean))].join('; ');

  function nearestOf(value, list) {
    let best = null;
    for (const c of list) { const d = Math.abs(value - c.value); if (!best || d < best.delta) best = { cand: c, delta: d }; }
    return best;
  }

  // Classify one numeric input (as the evaluator reads it) or one thread size. Returns { class, witness: [text], note }.
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
      if (key === 'force_N' && row.check === 'bolt_shear' && row.motor != null && String(row.motor).trim()) {
        const hit = (motors || []).find((m) => motorMatches(m, row.motor));
        if (hit) note += '; the evaluator holds it to the certified peak of ' + hit.mfr + ' ' + hit.name + ' (' + hit.max_thrust_N + ' N, ' + hit.max_thrust_src + ', motor_perf ' + hit.confidence + ') — a data witness, not a geometric one' +
          (within(value, hit.max_thrust_N, 0.5) ? '; the declared value equals that peak'
            : value > hit.max_thrust_N ? '; the declared value is above that peak (a floor, never a ceiling)'
              : '; the declared value is below that peak, so the evaluator refuses the row (index.html:5792)');
        else note += '; motor "' + row.motor + '" is not in this excerpt of motor_perf.json (the app would look it up)';
      }
      return U(note);
    }

    if (kind === 'thickness') {
      const hits = [], weak = [];
      for (const c of C.ext) if (within(value, c.value, c.tol)) hits.push(c);
      for (const c of C.walls) if (within(value, c.value, c.tol)) weak.push(c);
      for (const c of C.spans) if (within(value, c.value, c.tol)) weak.push(c);
      if (hits.length) return W(hits.concat(weak).map(describe), caveats(weak));
      if (weak.length) return D(weak.map(describe), caveats(weak));
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
      if (hits.length) return D(hits.map(describe), caveats(hits));
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
      const ordered = C.counts.slice().sort((a, b) => (b.value === +row.n) - (a.value === +row.n));
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

  // What the evaluator does with an absent or unusable key (spec.absent), as text.
  function gapText(key, spec, raw, present) {
    const lead = present ? 'declared ' + JSON.stringify(raw) + ', which the evaluator does not read as ' + (key === 'tip_mm' ? 'a number ≥ 0' : key === 'alt_m' || key === 'n' ? 'a non-zero number' : 'a positive number') + '; ' : '';
    if (spec.absent === 'refuse') return { effect: 'refused', text: lead + 'the evaluator refuses this row without it (index.html' + spec.at + ')' };
    if (spec.absent === 'assume') return { effect: 'assumed', text: lead + 'the evaluator ' + spec.assumed + ' (index.html' + spec.at + ')' };
    if (spec.absent === 'bug') return { effect: 'fails', text: lead + 'the evaluator passes plate_t_mm null to boltShear, which computes bearing F/(d·null) = ∞ and bearing SF 0, so the row fails with SF 0 (index.html:5810 with :887–897; the `sf_bearing != null` test at :5812 shows null was meant to skip the bearing check: Finding F7)' };
    return null;
  }

  // The whole classification of one file's declaration. data = { metric, un, motors, grades }.
  function classify(f, data) {
    const fast = fastenerIndex(data);
    const motors = (data && data.motors && data.motors.rows) || [];
    const grades = (data && data.grades && data.grades.GRADE_SY) || null;
    const C = candidates(f);
    const rows = [];
    const totals = { WITNESSED: 0, DERIVABLE: 0, UNWITNESSED: 0, POLICY: 0 };
    const surface = [];
    for (const l of f.loads) {
      const spec = SPEC[l.check] || {};
      const inputs = [], other = {}, unread = [], missing = [];
      for (const [k, v] of Object.entries(l)) {
        if (k === 'check' || k === 'name' || k === 'inputs_src' || k === 'inputs_ref') continue;
        const s = spec[k];
        if (!s) {
          if (typeof v === 'number') unread.push({ key: k, value: v, note: 'no PartForge ' + l.check + ' check reads this key' });
          else other[k] = v;
          continue;
        }
        if (s.kind === 'unread') { unread.push({ key: k, value: v, note: s.what }); continue; }
        if (s.kind === 'motor') { other[k] = v; continue; }
        if (s.kind === 'shear plane') {
          if (SHANK.test(String(v))) inputs.push({ key: k, kind: s.kind, value: v, class: 'UNWITNESSED', witness: [], note: 'puts the bolt shank in the shear plane, so the check uses the gross area πd²/4 instead of the tensile stress area (index.html:5809, boltShear :885); the bolt is not modelled, so nothing declared can see where its threads end' });
          else unread.push({ key: k, value: v, note: 'not "shank" or "plain", so the check keeps the threads in the shear plane (index.html:5809)' });
          continue;
        }
        if (s.kind === 'grade') {
          const y = +l.bolt_sigma_y_MPa > 0;
          if (y) { unread.push({ key: k, value: v, note: 'bolt_sigma_y_MPa is declared, and the evaluator uses it instead of the grade (index.html:5805)' }); continue; }
          const sy = boltYield(l, grades);
          if (grades && !sy) { missing.push({ key: k, declared: v, effect: 'refused', text: 'declared ' + JSON.stringify(v) + ', which is not in the evaluator\'s GRADE_SY; it refuses this row (index.html:5804–5808)' }); continue; }
          inputs.push({ key: k, kind: s.kind, value: v, class: 'UNWITNESSED', witness: [], note: (sy ? 'grade ' + v + ' → bolt σy ' + sy.sy + ' MPa in the evaluator\'s GRADE_SY (index.html:5804)' : 'GRADE_SY not loaded') + '; a bolt grade is a purchasing specification: nothing in the geometry can see it' });
          continue;
        }
        if (s.kind === 'material') { inputs.push({ key: k, kind: s.kind, value: v, class: 'UNWITNESSED', witness: [], note: s.what }); continue; }
        if (s.kind === 'thread') {
          if (typeof v !== 'string' || !v.trim()) { const g = gapText(k, s, v, true); missing.push({ key: k, declared: v, effect: g.effect, text: 'declared ' + JSON.stringify(v) + ', which is not a thread size; the evaluator refuses this row (index.html' + s.at + ')' }); continue; }
          inputs.push({ key: k, kind: s.kind, value: v, ...classifyInput(k, s.kind, v, l, C, fast, motors) });
          continue;
        }
        // a number the evaluator reads with +l.key
        const eff = s.read(v);
        if (eff === null) { const g = gapText(k, s, v, true); if (g) missing.push({ key: k, declared: v, effect: g.effect, text: g.text }); continue; }
        const r = classifyInput(k, s.kind, eff, l, C, fast, motors);
        const how = typeof v === 'string' ? 'declared as the string ' + JSON.stringify(v) + '; the evaluator reads +value = ' + fmt(eff) : eff !== v ? 'declared ' + fmt(v) + '; the evaluator reads it as ' + fmt(eff) : '';
        if (how) r.note = r.note ? r.note + '; ' + how : how;
        inputs.push({ key: k, kind: s.kind, value: eff, ...(eff !== v ? { declared: v } : {}), ...r });
      }
      // Keys the row does not declare at all: what the evaluator does instead (index.html:5754–5813).
      for (const [k, s] of Object.entries(spec)) {
        if (k in l) continue;
        if (s.kind === 'grade') { if (!(+l.bolt_sigma_y_MPa > 0)) missing.push({ key: k, effect: 'refused', text: 'the evaluator refuses a bolt_shear row with neither a known grade nor bolt_sigma_y_MPa (index.html:5804–5808)' }); continue; }
        if (s.kind === 'thread') { missing.push({ key: k, effect: 'refused', text: 'the evaluator refuses this row without it (index.html' + s.at + ')' }); continue; }
        if (!s.read) continue;
        const g = gapText(k, s, undefined, false);
        if (g) missing.push({ key: k, effect: g.effect, text: g.text });
      }
      for (const i of inputs) totals[i.class]++;
      for (const i of inputs) if (i.class === 'UNWITNESSED') surface.push(l.name + '.' + i.key);
      rows.push({ check: l.check, name: l.name, inputs_src: l.inputs_src, inputs_ref: l.inputs_ref, inputs, other, unread, missing });
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
  // 5. Two attempts: geometry text, loads inputs (with the direction of each change), contract floor.
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
  const SRC_RANK = { default: 0, user: 1, source: 2 };
  const WITNESSING = (c) => c === 'WITNESSED' || c === 'DERIVABLE';
  const GEOMETRIC = { thickness: 1, radius: 1, planform: 1, engagement: 1, count: 1, thread: 1 };
  const EASIER_WORDS = {
    force: ['a load lowered', 'a load raised'], pressure: ['a pressure lowered', 'a pressure raised'], speed: ['a flight speed lowered', 'a flight speed raised'],
    altitude: ['the altitude raised (thinner air, a higher computed flutter speed)', 'the altitude lowered'], policy: ['the acceptance threshold lowered', 'the acceptance threshold raised'],
    strength: ['a strength raised', 'a strength lowered'], count: ['more bolts', 'fewer bolts'], thickness: ['a thicker section', 'a thinner section'],
    radius: ['a smaller radius', 'a larger radius'], engagement: ['a longer engagement', 'a shorter engagement'],
  };

  // Which way one changed loads key went, judged by how the evaluator reads it (SPEC):
  //   suspicious  the change makes the check easier to pass (a load, pressure or speed lowered; the
  //               altitude raised; the threshold lowered; a strength or grade raised; more bolts, a
  //               thicker section ...), or a witnessed input lost its witness, or a key the check reads
  //               was removed, or the change cannot be ordered (a material renamed; the flutter planform)
  //   expected    the change makes the check harder, or adds a key whose absence the evaluator refused,
  //               or gives an input a witness it lacked, or adds provenance (which never decides pass or
  //               fail, index.html:5818)
  //   no_effect   the evaluator reads the same number, or does not read the key at all
  function judgeMove(mv, ra, rb, A, B, data) {
    const S = (v, why) => ({ verdict: v, why });
    if (mv.key === '(row)') return mv.to === 'removed' ? S('suspicious', 'a check row was removed') : S('expected', 'a check row was added');
    const k = mv.key, check = mv.check;
    if (k === 'inputs_src' || k === 'inputs_ref') {
      const promoted = (SRC_RANK[rb.inputs_src] || 0) > (SRC_RANK[ra.inputs_src] || 0);
      const refAdded = !!rb.inputs_ref && rb.inputs_ref !== ra.inputs_ref;
      return promoted || refAdded ? S('expected', 'provenance added; it never decides pass or fail (index.html:5818), only PASS against COMPUTED (:5820), and the reference is not verified here')
        : S('no_effect', 'provenance changed; it never decides pass or fail (index.html:5818)');
    }
    const s = (SPEC[check] || {})[k];
    if (!s || s.kind === 'unread') return S('no_effect', 'the ' + check + ' check does not read ' + k + (s && s.what ? ': ' + s.what : ''));
    const grades = (data && data.grades && data.grades.GRADE_SY) || null;
    const motors = (data && data.motors && data.motors.rows) || [];
    const clsA = mv.before, clsB = mv.after;
    if (s.kind === 'grade' || (check === 'bolt_shear' && k === 'bolt_sigma_y_MPa')) {
      if (s.kind === 'grade' && !grades) return S('suspicious', 'a bolt grade changed and GRADE_SY is not loaded to order it');
      const ya = boltYield(ra, grades), yb = boltYield(rb, grades);
      if (!ya && yb) return S('expected', 'the evaluator refused the row without a known grade or bolt_sigma_y_MPa (index.html:5806–5808); it now uses σy ' + yb.sy + ' MPa (' + yb.via + ')');
      if (ya && !yb) return S('suspicious', 'the row no longer names a known grade or bolt_sigma_y_MPa, so the evaluator refuses it (index.html:5806–5808)');
      if (!ya && !yb) return S('no_effect', 'the evaluator refuses the row either way (index.html:5806–5808)');
      if (Math.abs(yb.sy - ya.sy) <= 1e-9) return S('no_effect', 'the bolt yield the check uses is unchanged (σy ' + ya.sy + ' MPa via ' + yb.via + ')');
      return yb.sy > ya.sy ? S('suspicious', 'a stronger bolt (σy ' + ya.sy + ' → ' + yb.sy + ' MPa, ' + ya.via + ' → ' + yb.via + '): the check got easier and nothing in the geometry changed')
        : S('expected', 'a weaker bolt (σy ' + ya.sy + ' → ' + yb.sy + ' MPa): the check got harder');
    }
    if (s.kind === 'material') return S('suspicious', mv.to === '(absent)' ? 'the named material was removed, so the check falls back to the part material; this tool cannot order materials' : 'the material the check uses changed by name; this tool has no excerpt of FLIGHT_MATERIALS to order it');
    if (s.kind === 'shear plane') {
      const a = SHANK.test(String(ra[k] || '')), b = SHANK.test(String(rb[k] || ''));
      if (!a && b) return S('suspicious', 'the shank is now in the shear plane (gross area instead of the tensile stress area, index.html:5809): the check got easier, and the file does not model where the threads end');
      if (a && !b) return S('expected', 'the threads are back in the shear plane (tensile stress area): the check got harder');
      return S('no_effect', 'the shear plane the check uses is unchanged');
    }
    if (s.kind === 'motor') {
      const has = (r) => r[k] != null && String(r[k]).trim() !== '';
      if (!has(ra) && has(rb)) return S('expected', 'naming the motor holds force_N to its certified peak (index.html:5786–5793): a floor, never a ceiling');
      if (has(ra) && !has(rb)) return S('suspicious', 'the motor that held force_N to a certified floor is no longer named');
      const pa = motors.find((m) => motorMatches(m, ra[k])), pb = motors.find((m) => motorMatches(m, rb[k]));
      return pa && pb && pb.max_thrust_N >= pa.max_thrust_N ? S('expected', 'the new motor\'s certified peak is not lower (' + pa.max_thrust_N + ' → ' + pb.max_thrust_N + ' N)')
        : S('suspicious', 'the motor changed and this excerpt cannot show that its floor is not lower');
    }
    if (s.kind === 'thread') {
      const okA = typeof ra[k] === 'string' && ra[k].trim() !== '', okB = typeof rb[k] === 'string' && rb[k].trim() !== '';
      if (!okA && okB) return S('expected', 'the evaluator refused the row without a thread size (index.html' + s.at + ')');
      if (okA && !okB) return S('suspicious', 'the thread size was removed; the evaluator now refuses the row');
      if (WITNESSING(clsA) && clsB === 'UNWITNESSED') return S('suspicious', 'a witnessed input lost its witness');
      if (clsA === 'UNWITNESSED' && WITNESSING(clsB)) return S('expected', 'the size now matches a declared hole');
      const fast = fastenerIndex(data);
      const fa = fast[sizeKey(ra[k])], fb = fast[sizeKey(rb[k])];
      if (!fa || !fb) return S('suspicious', 'the thread size changed and the fastener excerpt cannot order it');
      if (fa.major_mm === fb.major_mm) return S('no_effect', 'the same major diameter (' + fmt(fa.major_mm) + ' mm)');
      const bigger = fb.major_mm > fa.major_mm;
      // bolt shear: a larger bolt carries more; thread strip: strip/bolt strength goes as Le/d, so a larger thread is harder
      const easier = check === 'bolt_shear' ? bigger : !bigger;
      return easier ? S('suspicious', (bigger ? 'a larger' : 'a smaller') + ' thread (' + fa.key + ' → ' + fb.key + '): the check got easier and no hole in the geometry changed')
        : S('expected', (bigger ? 'a larger' : 'a smaller') + ' thread (' + fa.key + ' → ' + fb.key + '): the check got harder');
    }
    // a number the evaluator reads with +l.key
    const ea = s.read(ra[k]), eb = s.read(rb[k]);
    const refusing = s.absent === 'refuse' || s.absent === 'bug';
    if (refusing && ea === null && eb !== null) return S('expected', s.absent === 'bug' ? 'without it the row failed with bearing SF 0 (Finding F7)' : 'the evaluator refused the row without it (index.html' + s.at + ')');
    if (refusing && ea !== null && eb === null) return S('suspicious', 'an input the check needs was removed or made unusable');
    if (refusing && ea === null && eb === null) return S('no_effect', 'the evaluator cannot use it either way');
    if (GEOMETRIC[s.kind]) {
      if (WITNESSING(clsA) && clsB === 'UNWITNESSED') return S('suspicious', 'a witnessed input lost its witness');
      if (clsA === 'UNWITNESSED' && WITNESSING(clsB)) return S('expected', 'the input now equals a declared dimension');
    }
    const va = ea === null ? s.dflt : ea, vb = eb === null ? s.dflt : eb;
    if (va == null || vb == null) return S('suspicious', 'the ' + s.kind + ' input moved between declared and assumed, and the check does not move one way with it');
    if (Math.abs(va - vb) <= 1e-9) return S('no_effect', 'the evaluator reads the same number (' + fmt(va) + ')');
    if (!s.easier) return S('suspicious', 'the flutter planform does not move the check one way; a planform input moved that the declared geometry cannot show');
    const lenient = s.easier === 'up' ? vb > va : vb < va;
    const words = EASIER_WORDS[s.kind] || ['moved the easy way', 'moved the hard way'];
    // the thread check is harder on a stronger bolt (strip must exceed the bolt): its UTS reads the other way round
    const w = s.kind === 'strength' && s.easier === 'down' ? ['a weaker bolt declared', 'a stronger bolt declared'] : words;
    if (lenient) return S('suspicious', w[0] + (ea === null || eb === null ? ' (against the evaluator\'s assumed ' + fmt(s.dflt) + ')' : '') + ': the check got easier and nothing in the geometry changed');
    let why = w[1] + ': the check got harder';
    if (k === 'force_N' && rb.motor != null && String(rb.motor).trim()) {
      const hit = motors.find((m) => motorMatches(m, rb.motor));
      if (hit && within(vb, hit.max_thrust_N, 0.5)) why = 'raised to the certified peak of ' + hit.mfr + ' ' + hit.name + ' (' + hit.max_thrust_N + ' N), the floor the evaluator demands (index.html:5792): the check got harder';
    }
    return S('expected', why);
  }

  function diffAttempts(aText, bText, data, labels) {
    const la = (labels && labels[0]) || 'A', lb = (labels && labels[1]) || 'B';
    const A = lint(aText, data, la), B = lint(bText, data, lb);
    if (A.refusal) return { refusal: { ...A.refusal, reason: la + ': ' + A.refusal.reason } };
    if (B.refusal) return { refusal: { ...B.refusal, reason: lb + ': ' + B.refusal.reason } };
    const ga = geometryText(aText), gb = geometryText(bText);
    const geometry = { identical: ga === gb, ...lineDiff(ga, gb), identicalFiles: aText === bText };
    const findings = [], moved = [], declarations = [];
    const classOf = (L, name, check, key) => { const r = L.result.rows.find((x) => x.name === name && x.check === check); const i = r && r.inputs.find((x) => x.key === key); return i ? i.class : null; };
    // loads rows matched by (check, name)
    const seen = new Set();
    for (const ra of A.flight.loads) {
      const rb = B.flight.loads.find((x) => x.check === ra.check && x.name === ra.name && !seen.has(x));
      if (!rb) { const mv = { row: ra.name, check: ra.check, key: '(row)', from: 'declared', to: 'removed', before: null, after: null }; moved.push({ ...mv, ...judgeMove(mv, ra, null, A, B, data) }); continue; }
      seen.add(rb);
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (k === 'check' || k === 'name') continue;
        if (same(ra[k], rb[k])) continue;
        const mv = { row: ra.name, check: ra.check, key: k, from: ra[k] === undefined ? '(absent)' : ra[k], to: rb[k] === undefined ? '(absent)' : rb[k],
          before: classOf(A, ra.name, ra.check, k), after: classOf(B, rb.name, rb.check, k) };
        moved.push({ ...mv, ...judgeMove(mv, ra, rb, A, B, data) });
      }
    }
    for (const rb of B.flight.loads) if (!seen.has(rb)) { const mv = { row: rb.name, check: rb.check, key: '(row)', from: 'absent', to: 'added', before: null, after: null }; moved.push({ ...mv, ...judgeMove(mv, null, rb, A, B, data) }); }
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
    // Only a suspicious move with byte-identical geometry is a finding. With the geometry changed, a moved
    // input is an ordinary part of a retry: it is listed with its direction, not flagged.
    if (geometry.identical) {
      for (const mv of moved) {
        if (mv.verdict !== 'suspicious') continue;
        findings.push({ code: 'input_moved_geometry_unchanged', text: mv.check + ' "' + mv.row + '": ' + mv.key + ' ' + fmt(mv.from) + ' → ' + fmt(mv.to) + ' while the geometry is byte-identical — ' + mv.why + (mv.before || mv.after ? ' (' + (mv.before || '—') + ' → ' + (mv.after || '—') + ')' : '') });
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
  const GAP_LABEL = { refused: '(missing)', assumed: '(absent)', fails: '(missing)' };
  function gapCount(r) {
    const n = { refused: 0, assumed: 0, fails: 0 };
    for (const row of r.rows) for (const m of row.missing) n[m.effect]++;
    return n;
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
      for (const m of row.missing) out.push('    ' + pad(m.key, 18) + pad(m.declared === undefined ? GAP_LABEL[m.effect] : fmt(m.declared), 11) + pad(m.effect === 'assumed' ? 'ASSUMED' : m.effect === 'fails' ? 'FAILS' : 'REFUSED', 13) + wrap(m.text, 74, ' '.repeat(46)));
      for (const u of row.unread) out.push('    ' + pad(u.key, 18) + pad(fmt(u.value), 11) + pad('not read', 13) + wrap(u.note, 74, ' '.repeat(46)));
      const others = Object.entries(row.other).filter(([k]) => k !== 'inputs_src' && k !== 'inputs_ref' && k !== 'note');
      if (others.length) out.push('    other keys: ' + others.map(([k, v]) => k + '=' + JSON.stringify(v)).join(', '));
    }
    const n = Object.values(r.totals).reduce((a, b) => a + b, 0);
    const g = gapCount(r);
    out.push('');
    out.push('  ' + n + ' inputs: ' + r.totals.WITNESSED + ' witnessed, ' + r.totals.DERIVABLE + ' derivable, ' + r.totals.UNWITNESSED + ' unwitnessed, ' + r.totals.POLICY + ' policy threshold' + (r.totals.POLICY === 1 ? '' : 's'));
    out.push('  invention surface: ' + r.inventionSurface.length + ' input' + (r.inventionSurface.length === 1 ? '' : 's') + ' no declared geometry can see' + (r.inventionSurface.length ? ' — ' + r.inventionSurface.join(', ') : ''));
    if (g.refused + g.assumed + g.fails) out.push('  gaps: ' + [g.refused ? g.refused + ' the evaluator refuses' : '', g.fails ? g.fails + ' that fail the row (F7)' : '', g.assumed ? g.assumed + ' the evaluator assumes' : ''].filter(Boolean).join(', '));
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
    for (const m of Dp.moved) out.push('    ' + wrap(m.check + ' "' + m.row + '" ' + m.key + ': ' + fmt(m.from) + ' → ' + fmt(m.to) + (m.before || m.after ? '  [' + (m.before || '—') + ' → ' + (m.after || '—') + ']' : '') + '  ' + m.verdict + ': ' + m.why, 100, ' '.repeat(6)));
    out.push('  declarations: ' + (Dp.declarations.length ? Dp.declarations.length + ' change' + (Dp.declarations.length === 1 ? '' : 's') + ' (information: the CMM re-measures these against the mesh)' : 'unchanged'));
    for (const d of Dp.declarations.slice(0, 40)) out.push('    ' + d.kind + ' "' + d.name + '" ' + d.key + ': ' + fmt(d.from) + ' → ' + fmt(d.to));
    if (Dp.declarations.length > 40) out.push('    … ' + (Dp.declarations.length - 40) + ' more');
    out.push('');
    if (Dp.findings.length) { out.push('  FINDINGS (' + Dp.findings.length + '):'); for (const f of Dp.findings) out.push('    ' + f.code + ': ' + wrap(f.text, 100, ' '.repeat(6))); }
    else out.push('  no findings: ' + noFindingsText(Dp));
    return out.join('\n');
  }
  function noFindingsText(Dp) {
    const g = Dp.geometry;
    if (!Dp.moved.length) return g.identical ? 'nothing moved' : 'the geometry changed, the inputs did not, and the floor held';
    if (!g.identical) return 'the geometry changed, so moved inputs are listed with their direction, not flagged; the floor held';
    return 'every input that moved went the way a correction goes or does not reach the check; nothing made a check easier';
  }

  // A machine-readable envelope in the shape PartForge's headless CLI uses (headless/partforge.mjs:41).
  // confidence 'derived': the classification is computed from the declaration text (PartForge's own
  // vocabulary is measured | derived | cited, headless/mcp.mjs:36); nothing here measures anything.
  function envelope(tool, value, extra) {
    const e = { ok: !(extra && extra.refusal), tool, value: extra && extra.refusal ? null : value, units: 'mm, N, MPa, m/s, m', confidence: 'derived',
      provenance: [{ source: 'the FLIGHT declaration text of the file(s) named; parsed as PartForge index.html parseFlight() does' }],
      assumptions: ['"witnessed" means a declared dimension of compatible unit matches within its declared tolerance; no mesh is measured here',
        'thread sizes are matched to hole diameters through an excerpt of PartForge data/tables/fasteners_metric.json and fasteners_un.json, whose rows keep their confidence field',
        'how each loads key is read (which keys the evaluator refuses without, assumes, or ignores; which direction makes a check easier) follows index.html at 0974a62, cited per key in shadow.js SPEC'],
      validity_envelope: 'classifies what the declaration can see; it cannot know whether an unwitnessed number is right, only that nothing checks it', summary: (extra && extra.summary) || '' };
    if (extra && extra.provenance) e.provenance.push(...extra.provenance);
    if (extra && extra.refusal) e.refusal = extra.refusal;
    return e;
  }

  return { parseFlight, flightCounts, mdSafe, sizeKey, fastenerIndex, clearanceFor, tapFor, candidates, classify, lint, geometryText, lineDiff, judgeMove, diffAttempts, renderLint, renderDiff, noFindingsText, envelope, motorMatches, boltYield, SPEC, KEYS, REQUIRED, DOCTRINE_DEFAULT_SF, FLIGHT_CAP };
});
