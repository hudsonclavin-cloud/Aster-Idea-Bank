/* derived by build-data.mjs from PartForge index.html at 0974a62b309b8cf7acd33771b49e9357d4d191f4.
 * Every block between the "---- index.html" markers is cut VERBATIM (unedited) from the lines named.
 * The only code that is not PartForge's: this comment, the factory wrapper, the braces around the
 * 6061-T6 entry, the FLIGHT_DB_DATA binding (PartForge embeds a 1 MB literal; here the caller binds
 * the fits snapshot), the DOCTRINE strings object and the returned API. Apache-2.0, PartForge's licence.
 *   lines 780-872: thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck
 *   lines 936-938: the 6061-T6 entry of FLIGHT_MATERIALS (inside a wrapper object)
 *   lines 1001-1035: FLIGHT_PROCESSES (process capability table)
 *   lines 4646-4859: DECL block: parseFlight, provenanceSummary, partTier, tierEvidence, flightCounts, flightLint, flightContradictions
 *   lines 4898-4899: DB_MEMO, dbMemo
 *   lines 4969-5012: dbF, DB_CONF, dbConf, dbTag, dbRows, dbRowsBuild, dbFit
 *   lines 5744: matClass (a local of the loads evaluator)
 *   lines 1493: doctrine line "Use standard sizes" (string)
 *   lines 1454: doctrine sentences "Carry the label into the NOTE … had been read." (string)
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PartForgeCode = api;
})(typeof self !== 'undefined' ? self : this, function () {
// ---- index.html 780-872: thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck
// ---------------------------------------------------------------------------
// Thread tables and parsing
// ---------------------------------------------------------------------------
// ISO 261 / ISO 724 coarse pitches (mm). [Certain]
const METRIC_COARSE_PITCH = {
  M2: 0.4, 'M2.5': 0.45, M3: 0.5, M4: 0.7, M5: 0.8, M6: 1.0, M8: 1.25,
  M10: 1.5, M12: 1.75, M14: 2.0, M16: 2.0, M20: 2.5,
};
// ASME B1.1 basic major diameters (in). Numbered sizes: D = 0.060 + 0.013·N. [Certain]
const UN_MAJOR_IN = {
  '#2': 0.086, '#4': 0.112, '#6': 0.138, '#8': 0.164, '#10': 0.190, '#12': 0.216,
  '1/4': 0.250, '5/16': 0.3125, '3/8': 0.375, '7/16': 0.4375, '1/2': 0.500,
};
const IN_TO_MM = 25.4;

// Accepts 'M6', 'M6x1', 'M6-1.0', '#10-32', '1/4-20', '5/16-18', '1/4"-20'.
// Returns { system:'metric'|'un', d_mm, p_mm, tpi? }.
function parseThreadSize(size) {
  const s = String(size).trim().replace(/["\s]/g, '');
  let m = /^M(\d+(?:\.\d+)?)(?:[x×\-](\d+(?:\.\d+)?))?$/i.exec(s);
  if (m) {
    const d = parseFloat(m[1]);
    const key = 'M' + m[1];
    const p = m[2] ? parseFloat(m[2]) : METRIC_COARSE_PITCH[key];
    if (!p) throw new Error('Unknown metric coarse pitch for ' + size + '; give it explicitly, e.g. M7x1');
    return { system: 'metric', d_mm: d, p_mm: p, label: key + 'x' + p };
  }
  m = /^(#\d+|\d+\/\d+|\d*\.\d+)-(\d+)$/.exec(s);
  if (m) {
    let D;
    if (m[1][0] === '#') D = UN_MAJOR_IN[m[1]];
    else if (m[1].includes('/')) { const [n, q] = m[1].split('/'); D = parseFloat(n) / parseFloat(q); }
    else D = parseFloat(m[1]);
    if (!D) throw new Error('Unknown UN size ' + size);
    const tpi = parseInt(m[2], 10);
    return { system: 'un', d_mm: D * IN_TO_MM, p_mm: IN_TO_MM / tpi, tpi, D_in: D, label: m[1] + '-' + tpi };
  }
  throw new Error('Cannot parse thread size "' + size + '"');
}

// Tensile stress area.
//   ISO 898-1 §9.1.6.1:  As = (π/4)·((d2+d3)/2)² ≡ 0.7854·(d − 0.9382·p)²  [mm²]  [Certain]
//   ASME B1.1 App. B:    At = 0.7854·(D − 0.9743/n)²                        [in²]  [Certain]
function tensileStressArea_mm2(t) {
  if (t.system === 'metric') return 0.7854 * (t.d_mm - 0.9382 * t.p_mm) ** 2;
  const At_in2 = 0.7854 * (t.D_in - 0.9743 / t.tpi) ** 2;
  return At_in2 * IN_TO_MM * IN_TO_MM;
}

// Rule-of-thumb minimum engagement (multiples of nominal diameter) by the
// tapped material. Common shop guidance (e.g. Engineers Edge, Boston Gear /
// screw-supplier design notes); values vary by source. [Likely]
const ENGAGEMENT_RULE = { steel: 1.0, stainless: 1.0, titanium: 1.0, aluminum: 2.0, aluminium: 2.0, brass: 1.5, plastic: 2.5 };

// ---------------------------------------------------------------------------
// threadCheck — bolt tensile capacity vs internal-thread stripping
// ---------------------------------------------------------------------------
// Internal thread shear area:
//   Machinery's Handbook / FED-STD-H28 / ASME B1.1:
//     As_n = π·n·Le·Ds_min·[1/(2n) + 0.57735·(Ds_min − En_max)]
//   With BASIC dimensions (Ds = D, En = D − 0.649519·p for 60° threads) this is
//   exactly 0.875·π·D·Le (reported as As_strip_MH_mm2). Tolerance-class minima
//   (2A/2B, 6g/6H) typically reduce it to ≈0.7–0.8·π·D·Le.
//   We USE the widely quoted conservative simplification
//     As_internal = 0.5·π·D·Le                                          [Likely]
//   and shear strength τu ≈ 0.5·σu of the tapped material (0.6·σu is the usual
//   figure for steels; 0.5 is deliberately conservative).                [Likely]
//   F_strip = τu·As_internal;  Le_req = F_bolt / (0.5·σu_int·0.5·π·D).
function threadCheck({ size, engagement_mm, bolt_sigma_u_MPa, internal_sigma_u_MPa, internal_material_class }) {
  const t = parseThreadSize(size);
  const d = t.d_mm, p = t.p_mm, Le = engagement_mm;
  const At = tensileStressArea_mm2(t);
  const F_bolt = At * bolt_sigma_u_MPa;
  const As_strip = 0.5 * Math.PI * d * Le;                     // conservative
  const As_strip_MH = Math.PI * d * Le * (0.5 + 0.57735 * 0.649519); // = 0.875·π·D·Le, basic dims
  const tau_u = 0.5 * internal_sigma_u_MPa;
  const F_strip = tau_u * As_strip;
  const Le_req = F_bolt / (tau_u * 0.5 * Math.PI * d);
  const cls = String(internal_material_class || 'steel').toLowerCase();
  const rule = ENGAGEMENT_RULE[cls] != null ? ENGAGEMENT_RULE[cls] : 1.0;
  return {
    size: t.label, system: t.system,
    d_mm: d, p_mm: p, At_mm2: At,
    F_bolt_N: F_bolt,
    As_strip_mm2: As_strip, As_strip_MH_mm2: As_strip_MH,
    F_strip_N: F_strip,
    Le_req_mm: Le_req,
    Le_over_d: Le / d,
    Le_min_rule_mm: rule * d, rule_multiple: rule,
    ok_strip: F_strip >= F_bolt,
    ok_rule: Le >= rule * d,
  };
}
// ---- index.html 936-938: the 6061-T6 entry of FLIGHT_MATERIALS (inside a wrapper object)
const FLIGHT_MATERIALS = {
  '6061-T6': { name: 'Aluminum 6061-T6', den: 2.70, sy: 276, su: 310, E: 68.9, G: 26.0, kind: 'metal',
    note: 'General-purpose airframe/coupler/bulkhead alloy. Weldable; loses temper near welds.',
    src: 'ASM Aerospace Specification Metals / MatWeb "Aluminum 6061-T6; 6061-T651"', verify: true },
};
// ---- index.html 1001-1035: FLIGHT_PROCESSES (process capability table)
// ---------------------------------------------------------------------------
// Process capability table — typical shop numbers (Protolabs / Xometry /
// Hubs design guides). tol_general = typical ± without a callout;
// tol_precision = achievable with a callout / post-machining. min_* in mm.
// min_internal_corner_r_mm = 0 where not applicable. All verify:true.
// ---------------------------------------------------------------------------
const FLIGHT_PROCESSES = {
  cnc_mill: { name: 'CNC milling (3/5-axis)', tol_general_mm: 0.13, tol_precision_mm: 0.025, min_wall_mm: 0.8, min_hole_mm: 1.0, min_internal_corner_r_mm: 0.8,
    notes: 'Protolabs standard ±0.13 mm (±0.005 in); ±0.025 mm with callout. Walls: 0.8 mm metal / 1.5 mm plastic recommended. Internal vertical corners take the end-mill radius; use r ≥ ⅓ pocket depth. Holes: standard drill sizes, depth ≤ 4–6×D.',
    src: 'Protolabs CNC milling design guidelines; Hubs CNC machining design guide', verify: true },
  cnc_lathe: { name: 'CNC turning', tol_general_mm: 0.13, tol_precision_mm: 0.013, min_wall_mm: 0.5, min_hole_mm: 0.5, min_internal_corner_r_mm: 0.4,
    notes: 'Diameters hold tighter than milled features; ±0.013 mm (±0.0005 in) achievable on ground/turned diameters with callout. Internal corners take insert nose radius (0.4 mm typical). Thin tube walls chatter below ~0.5 mm.',
    src: 'Protolabs CNC turning design guidelines; Xometry manufacturing standards', verify: true },
  waterjet: { name: 'Abrasive waterjet cutting', tol_general_mm: 0.25, tol_precision_mm: 0.1, min_wall_mm: 1.5, min_hole_mm: 1.5, min_internal_corner_r_mm: 0.5,
    notes: 'Kerf ~0.8–1.2 mm; inside corners inherit half-kerf radius. Taper 1–2° on thick stock unless taper-compensated. Holes < material thickness degrade. No HAZ; good for composites and thick plate.',
    src: 'Xometry laser & waterjet sheet-cutting mini design guide; Xometry manufacturing standards', verify: true },
  laser_sheet: { name: 'Laser sheet cutting', tol_general_mm: 0.13, tol_precision_mm: 0.05, min_wall_mm: 1.0, min_hole_mm: 0.5, min_internal_corner_r_mm: 0.15,
    notes: 'Kerf ~0.1–0.3 mm. Holes ≥ material thickness recommended (min ~0.5 mm in thin sheet). Small HAZ; edge taper grows with thickness. Sheet-cut tolerance ±0.13 mm (±0.005 in) auto-quotable.',
    src: 'Xometry laser & waterjet sheet-cutting mini design guide; Protolabs sheet metal design guidelines', verify: true },
  sheet_metal: { name: 'Sheet metal (cut + bend)', tol_general_mm: 0.5, tol_precision_mm: 0.25, min_wall_mm: 0.5, min_hole_mm: 1.0, min_internal_corner_r_mm: 0,
    notes: 'Flat features ±0.13–0.3 mm; bend-to-feature ±0.5 mm and ±1° per bend typical. Inside bend radius ≥ 1×t; holes ≥ 2×t + r from bends; min hole ≈ t. Relief cuts at bend ends.',
    src: 'Protolabs sheet metal design guidelines; Xometry sheet metal design guide', verify: true },
  sls: { name: 'SLS nylon (PA12)', tol_general_mm: 0.3, tol_precision_mm: 0.2, min_wall_mm: 0.8, min_hole_mm: 1.5, min_internal_corner_r_mm: 0,
    notes: '±0.3% with a ±0.3 mm floor is the usual quote. Walls 0.7–1.0 mm min (1.5 mm structural). Escape holes ≥ 3.5 mm for hollow parts. Shrinkage/warp on large flat areas.',
    src: 'Protolabs SLS design guidelines; Hubs SLS design guide', verify: true },
  dmls: { name: 'DMLS / LPBF metal', tol_general_mm: 0.2, tol_precision_mm: 0.05, min_wall_mm: 0.5, min_hole_mm: 1.0, min_internal_corner_r_mm: 0,
    notes: '±0.1 mm + ±0.1% typical as-built; ±0.05 mm on post-machined datums. Walls ≥ 0.4–0.5 mm; self-supporting holes ≤ ~8 mm; overhangs > 45° need supports; residual stress → stress-relieve before removing from plate.',
    src: 'Xometry DMLS design guide; Protolabs DMLS design guidelines', verify: true },
  fdm_eng: { name: 'Industrial FDM (ULTEM / PC / CF-nylon)', tol_general_mm: 0.2, tol_precision_mm: 0.13, min_wall_mm: 1.0, min_hole_mm: 2.0, min_internal_corner_r_mm: 0,
    notes: 'Stratasys spec: ±0.127 mm or ±0.0015 mm/mm, whichever is greater; desktop machines ~±0.2–0.5 mm. Walls ≥ 2 extrusion widths (≈1 mm). Holes print undersize; ream. Z-direction strength ~50–70% of XY.',
    src: 'Stratasys Fortus/F-series specifications; Hubs FDM design guide; Xometry FDM design guide', verify: true },
  composite_layup: { name: 'Composite layup (wet / prepreg)', tol_general_mm: 0.5, tol_precision_mm: 0.25, min_wall_mm: 0.5, min_hole_mm: 3.0, min_internal_corner_r_mm: 3.0,
    notes: 'Mold-side surfaces hold ±0.25–0.5 mm; bag-side thickness varies ±10–15% (per-ply ~0.2–0.25 mm). Trim/holes machined after cure; hole edge distance ≥ 3×D. Inside radii ≥ 3 mm so plies conform. Fibre layup and cure schedule dominate strength.',
    src: 'General composite design practice (e.g. Hexcel/Toray prepreg design guides); shop experience — no single tolerance standard', verify: true },
};
// ---- index.html 4646-4859: DECL block: parseFlight, provenanceSummary, partTier, tierEvidence, flightCounts, flightLint, flightContradictions
/* DECL-BEGIN */
/* ---------------- flight grade: the declaration layer ----------------
   Parsing the FLIGHT block, the provenance of every tolerance, and the tier that decides
   which document the part gets. No geometry and no DOM here, so tests/flight-decl.test.mjs
   runs this exact code in Node. */
const FLIGHT_AXIS = /^(x|y|z)$/;
const FLIGHT_CAP = 24;   // entries per category — bounds the measurement time
/* Where a tolerance came from. The distinction exists because a team's published number and
   a number this tool proposed are not the same kind of thing, and a sheet that prints them
   identically invites the second to be built to as if it were the first.
     source  — from a cited document: a standard, a datasheet, a team report, a drawing
     user    — the person asked for it, or accepted it
     default — the tool proposed it: a starting point, not a flight number
   Absent means default, because that is the safe reading of silence. */
const TOL_SRC = /^(source|user|default)$/;
const FLIGHT_HAZARD = /^(none|pressure|hot_gas|energetic|bonded|welded)$/;
/* Every free-text field in a FLIGHT declaration ends up as a cell in a markdown table or a
   line in a bulleted list on the manufacturing sheet / ICD, which the app writes as plain
   string concatenation with no per-site escaping. A literal newline in a declared name or a
   mfg note turns "- line one" into two markdown lines, and the second can open with "## " and
   read as a heading in the document a shop is meant to trust; a literal "|" shifts every
   later column in that table row out from under its header. Collapse newlines to spaces and
   escape pipes ONCE, here, so every downstream consumer inherits a plain, single-line,
   table-safe string — the fix belongs at the one place all of this text is parsed, not at
   each of the dozen places it is later printed. */
function mdSafe(s){ return String(s).replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').replace(/\|/g, '\\|').replace(/[ \t]+/g, ' ').trim(); }
function parseFlight(code){
  const m = code.match(/\/\/\s*FLIGHT-BEGIN\s*\n([\s\S]*?)\/\/\s*FLIGHT-END/);
  if(!m) return null;
  const json = m[1].split('\n').map(l => l.replace(/^\s*\/\/ ?/, '')).join('\n');
  let f;
  try { f = JSON.parse(json); } catch(e){ return { malformed:true }; }
  if(!f || typeof f !== 'object' || Array.isArray(f)) return { malformed:true };
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d);
  const str = (v, d = '') => typeof v === 'string' ? mdSafe(v) : d;
  const pair = v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number' && isFinite(x)) ? v.map(Number) : null;
  const arr = k => (Array.isArray(f[k]) ? f[k] : []).filter(e => e && typeof e === 'object').slice(0, FLIGHT_CAP);
  const out = { material: str(f.material), process: str(f.process), tolerance_class: str(f.tolerance_class, 'ISO 2768-m') || 'ISO 2768-m',
    tess_tol_mm: num(f.tess_tol_mm, 0), hazard: FLIGHT_HAZARD.test(str(f.hazard)) ? str(f.hazard) : 'none', tier_declared: /^[ABC]$/.test(str(f.tier).toUpperCase()) ? str(f.tier).toUpperCase() : null,
    critical: [], od: [], bores: [], holes: [], revolve: [], gauges: [], loads: [], mfg: null, dropped: 0, demoted: 0 };
  // A "source" claim without a reference is not a source claim; it falls back to default and says so.
  const prov = e => {
    const src = TOL_SRC.test(str(e.tol_src)) ? str(e.tol_src) : 'default';
    const ref = str(e.tol_ref).slice(0, 140);
    if(src === 'source' && !ref){ out.demoted++; return { tol_src: 'default', tol_ref: '' }; }
    return { tol_src: src, tol_ref: src === 'source' ? ref : '' };
  };
  for(const c of arr('critical')){
    if(!FLIGHT_AXIS.test(str(c.axis)) || !(num(c.nominal_mm, 0) > 0) || !(num(c.tol_mm, 0) > 0)){ out.dropped++; continue; }
    out.critical.push({ name: str(c.name, 'dimension').slice(0, 60), module: (str(c.module, 'main') || 'main').replace(/\(\)$/, ''), axis: str(c.axis),
      nominal_mm: num(c.nominal_mm), tol_mm: num(c.tol_mm), round: !!c.round, ...prov(c) });
  }
  const round = (e, dflt) => {
    if(!FLIGHT_AXIS.test(str(e.axis)) || !(num(e.d_mm, 0) > 0) || !(num(e.tol_mm, 0) > 0)) return null;
    const from = num(e.from_mm, NaN), to = num(e.to_mm, NaN);
    if(!isFinite(from) || !isFinite(to) || from === to) return null;
    return { name: str(e.name, dflt).slice(0, 60), d_mm: num(e.d_mm), tol_mm: num(e.tol_mm), pos_tol_mm: num(e.pos_tol_mm, num(e.tol_mm)),
      at_mm: pair(e.at_mm) || [0, 0], axis: str(e.axis), from_mm: from, to_mm: to, ...prov(e) };
  };
  for(const e of arr('od')){ const r = round(e, 'OD'); if(r) out.od.push(r); else out.dropped++; }
  for(const e of arr('bores')){ const r = round(e, 'bore'); if(r) out.bores.push(r); else out.dropped++; }
  for(const e of arr('holes')){
    const base = round(e, 'holes');
    const pattern = /^(circle|list|single)$/.test(str(e.pattern)) ? str(e.pattern) : (Array.isArray(e.at_mm) ? (pair(e.at_mm) ? 'single' : 'list') : null);
    if(!base || !pattern){ out.dropped++; continue; }
    const h = { ...base, pattern };
    if(pattern === 'circle'){
      h.n = Math.round(num(e.n, 0)); h.bc_d_mm = num(e.bc_d_mm, 0); h.start_deg = num(e.start_deg, 0); h.centre_mm = pair(e.centre_mm) || [0, 0];
      if(!(h.n >= 1 && h.n <= 64) || !(h.bc_d_mm > 0)){ out.dropped++; continue; }
    } else {
      const list = pattern === 'single' ? [pair(e.at_mm)] : (Array.isArray(e.at_mm) ? e.at_mm.map(pair) : []);
      h.at_mm = list.filter(Boolean).slice(0, 64);
      if(!h.at_mm.length){ out.dropped++; continue; }
    }
    out.holes.push(h);
  }
  const TYPES = /^(conical|tangent_ogive|vonkarman|lvhaack|haack|parabolic|power|elliptical)$/;
  for(const r of arr('revolve')){
    if(!TYPES.test(str(r.type)) || !(num(r.L_mm, 0) > 0) || !(num(r.R_mm, 0) > 0) || !isFinite(num(r.tip_at_mm, NaN))){ out.dropped++; continue; }
    out.revolve.push({ name: str(r.name, 'profile').slice(0, 60), type: str(r.type), L_mm: num(r.L_mm), R_mm: num(r.R_mm), C: num(r.C, 0), K: num(r.K, 0.75), n: num(r.n, 0.5),
      axis: FLIGHT_AXIS.test(str(r.axis)) ? str(r.axis) : 'z', tip_at_mm: num(r.tip_at_mm), direction: num(r.direction, -1) >= 0 ? 1 : -1, at_mm: pair(r.at_mm) || [0, 0], tol_mm: num(r.tol_mm, 0.1), ...prov(r) });
  }
  for(const g of arr('gauges')){
    if(!/^[A-Za-z_]\w*$/.test(str(g.module))){ out.dropped++; continue; }
    out.gauges.push({ name: str(g.name, str(g.module)).slice(0, 60), module: str(g.module), expect: /^(interfere|blocked|contact|touch)$/.test(str(g.expect)) ? "interfere" : "clear", why: str(g.why).slice(0, 80) });
  }
  for(const l of arr('loads')){
    if(!/^(hoop|flutter|thread|bolt_shear)$/.test(str(l.check))){ out.dropped++; continue; }
    const o = { check: str(l.check), name: str(l.name, str(l.check)).slice(0, 60) };
    for(const [k, v] of Object.entries(l)) if(k !== 'check' && k !== 'name' && /^[a-z_]+$/i.test(k)) o[k] = typeof v === 'number' ? v : str(String(v)).slice(0, 40);
    // Where the LOADS came from — a thrust the team measured and a thrust the tool guessed
    // produce the same arithmetic and mean entirely different things.
    o.inputs_src = TOL_SRC.test(str(l.inputs_src)) ? str(l.inputs_src) : 'default';
    o.inputs_ref = o.inputs_src === 'source' ? str(l.inputs_ref).slice(0, 140) : '';
    if(o.inputs_src === 'source' && !o.inputs_ref){ o.inputs_src = 'default'; out.demoted++; }
    out.loads.push(o);
  }
  if(f.mfg && typeof f.mfg === 'object'){
    const mf = f.mfg, list = v => (Array.isArray(v) ? v : []).map(x => mdSafe(String(x)).slice(0, 160)).slice(0, 12);
    out.mfg = { stock: str(mf.stock), finish: str(mf.finish), heat_treat: str(mf.heat_treat), deburr: str(mf.deburr), inspect: list(mf.inspect), notes: list(mf.notes) };
  }
  out.declared = out.critical.length + out.od.length + out.bores.length + out.holes.length + out.revolve.length + out.gauges.length;
  out.provenance = provenanceSummary(out);
  return out;
}
/* Counts by provenance across every dimension and load. `dims` counts only the entries that
   carry a tolerance; gauges are pass/fail features and have none. */
function provenanceSummary(f){
  const dims = [...f.critical, ...f.od, ...f.bores, ...f.holes, ...f.revolve];
  const tally = (list, key) => list.reduce((a, e) => { a[e[key] || 'default']++; return a; }, { source: 0, user: 0, default: 0 });
  const d = tally(dims, 'tol_src'), l = tally(f.loads, 'inputs_src');
  return { dims: d, loads: l, n_dims: dims.length, n_loads: f.loads.length,
           defaults: d.default + l.default, cited: d.source + l.source,
           refs: [...new Set(dims.filter(e => e.tol_src === 'source').map(e => e.tol_ref)
             .concat(f.loads.filter(e => e.inputs_src === 'source').map(e => e.inputs_ref)))].filter(Boolean) };
}
/* ---------------- what kind of part is this, and therefore what document ----------------
   Tier A is a passive single body a shop can make and a person can inspect with hand tools:
     it gets a manufacturing sheet.
   Tier B is an interface on something this tool cannot represent — a laminate, a weld, a
     pressure boundary, a hot-gas path. The geometry may be right and the qualification is
     not in the file, so it gets an interface control drawing instead of a release document.
   Tier C is energetic hardware. Geometry is never a sign-off for it at all.
   A declared tier may only escalate: a part that says "A" while declaring a hoop check is
   still B, because the safe direction is the one that asks for more evidence. */
function partTier(f, materials, processes){
  if(!f || f.malformed) return { tier: 'A', why: [], hazard: 'none' };
  const why = [];
  const mat = (materials || {})[f.material] || null;
  const proc = (processes || {})[f.process] || null;
  let tier = 'A';
  const up = (t, reason) => { if(t > tier) tier = t; why.push(reason); };
  if(f.hazard === 'energetic') up('C', 'declared energetic: pyrotechnic, initiator or propellant hardware');
  if(f.hazard === 'pressure') up('B', 'declared a pressure boundary');
  if(f.hazard === 'hot_gas') up('B', 'declared a hot-gas path');
  if(f.hazard === 'bonded') up('B', 'declared a bonded joint');
  if(f.hazard === 'welded') up('B', 'declared a welded joint');
  if(mat && mat.kind === 'composite') up('B', `${f.material} is a laminate: strength depends on the layup, not the geometry`);
  if(f.process === 'composite_layup') up('B', 'made by composite layup');
  if(f.loads.some(l => l.check === 'hoop')) up('B', 'a hoop-stress check means an internal pressure boundary');
  if(f.tier_declared && f.tier_declared > tier){ tier = f.tier_declared; why.push(`declared tier ${f.tier_declared}`); }
  else if(f.tier_declared && f.tier_declared < tier) why.push(`declared tier ${f.tier_declared}, raised to ${tier} by the rules above`);
  return { tier, why, hazard: f.hazard, doc: tier === 'A' ? 'manufacturing sheet' : 'interface control drawing',
           mat_kind: mat ? mat.kind : null, proc: proc ? proc.name : null };
}
/* The evidence a tier-B or tier-C part needs before anyone can call it done. Geometry supplies
   none of it, which is the point of saying so on the drawing. */
function tierEvidence(t){
  const common = ['Independent design review by someone who did not draw the part',
                  'As-built inspection of every interface dimension, recorded against this drawing',
                  'Material certificate or batch record for the actual stock used'];
  const byHazard = {
    pressure: ['Proof test to the programme factor over MEOP, on the article or a sister article, with the record attached',
               'Burst test or a validated analysis to the burst factor',
               'Wall-thickness measurement on the finished part, not the model',
               'Weld procedure, welder qualification and NDE where the boundary is welded'],
    hot_gas: ['Hot-fire or equivalent thermal test with erosion measured before and after',
              'Ablative or insulator material, thickness and bond process qualified separately',
              'Post-test inspection of every sealing face'],
    bonded: ['Bond process specification: surface preparation, adhesive, cure, bond-line thickness',
             'Coupon or lap-shear data for the actual process',
             'NDE of the bond area'],
    welded: ['Weld procedure specification and welder qualification', 'NDE of every structural weld',
             'Post-weld heat treatment where the alloy needs it'],
    energetic: ['This part class cannot be signed off from geometry under any circumstances',
                'Handling, storage, transport and arming procedures reviewed and approved',
                'Functional testing of the assembled device, by people qualified to do it',
                'Range and regulatory approval for the energetic materials involved'],
  };
  const composite = ['Laminate schedule: fibre, resin, ply count, orientations, fibre volume fraction',
                     'Cure cycle and its verification', 'Coupon data for the actual layup and cure',
                     'NDE criteria and results for the finished part'];
  const out = [...common];
  if(byHazard[t.hazard]) out.push(...byHazard[t.hazard]);
  if(t.mat_kind === 'composite' || t.proc === 'Composite layup (wet / prepreg)') out.push(...composite);
  return [...new Set(out)];
}
function flightCounts(f){
  return f && !f.malformed ? { critical: f.critical.length, od: f.od.length, bores: f.bores.length, holes: f.holes.length, revolve: f.revolve.length, gauges: f.gauges.length, loads: f.loads.length } : null;
}
/* Code discipline the doctrine demands. Failures in flight grade, warnings in hobby. */
function flightLint(src){
  const out = [];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');   // "bolt circle (4.331 in)" in a NOTE is not a primitive
  if(!/^\s*tess_tol\s*=\s*[\d.]+\s*;/m.test(code)) out.push('no tess_tol parameter — the first parameter must be tess_tol = <curve tolerance>; // …');
  if(!/function\s+fn_tol\s*\(/.test(code)) out.push('the fn_tol() helper is missing — include it verbatim after the parameters');
  const globalFn = code.match(/^\s*\$(fn|fa|fs)\s*=\s*[\d.]+\s*;/m);
  if(globalFn) out.push(`a global ${globalFn[0].trim()} — every round primitive must pass its own $fn=fn_tol(<diameter>) instead`);
  const bare = [...code.matchAll(/\b(cylinder|circle|sphere|rotate_extrude)\s*\(([^;{]*)/g)].filter(m => !/\$fn\s*=/.test(m[2]));
  if(bare.length) out.push(`${bare.length} round primitive${bare.length > 1 ? 's' : ''} without $fn=fn_tol(…): ${[...new Set(bare.map(m => m[1]))].join(', ')}`);
  if(/\b(sin|cos|tan)\s*\(\s*[A-Za-z_]\w*\s*\*\s*PI\s*\/\s*180/.test(code)) out.push('sin/cos/tan of a radian value — OpenSCAD trig takes DEGREES');
  return out;
}
/* A critical dimension is a module's full extent along an axis. The dry run's end cap
   declared "o-ring groove width: shoulder() along z = 4.750" while its own SPEC gave the
   shoulder a size of 101.5 × 101.5 × 20, and "lightening pocket depth: body() along z =
   8.000" against a body of 127 × 127 × 25.4 — a feature INSIDE the module, measured by
   the mechanism for the module itself. Both are visible in the text, before a render, and
   both were spent on 20-minute CGAL retries. A nominal that matches none of the part's
   three declared extents (axis order is forgiven — the SPEC check forgives it too) is a
   contradiction between the two blocks, and the fix is the mechanism, not the number. */
function flightContradictions(spec, f){
  const out = [];
  if(!spec || !Array.isArray(spec.parts) || !f || f.malformed) return out;
  const sizes = new Map(spec.parts.filter(p => p && p.name && Array.isArray(p.size_mm) && p.size_mm.length === 3 && p.size_mm.every(v => typeof v === 'number' && v > 0)).map(p => [p.name, p.size_mm]));
  for(const c of f.critical || []){
    const sz = sizes.get(c.module);
    if(!sz) continue;
    const near = sz.some(v => Math.abs(c.nominal_mm - v) <= Math.max(2, 0.05 * v));
    if(!near) out.push({ name: c.name, module: c.module, axis: c.axis, nominal_mm: c.nominal_mm, spec_mm: sz });
  }
  return out;
}
/* DECL-END */
var FLIGHT_DB_DATA = {};   // wrapper: bound by bindDb() below
// ---- index.html 4898-4899: DB_MEMO, dbMemo
const DB_MEMO = new Map();
const dbMemo = (k, build) => { if(!DB_MEMO.has(k)) DB_MEMO.set(k, build()); return DB_MEMO.get(k); };
// ---- index.html 4969-5012: dbF, DB_CONF, dbConf, dbTag, dbRows, dbRowsBuild, dbFit
const dbF = v => (typeof v === 'number' ? (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '') : v);
const DB_CONF = { c: 'certain', l: 'likely', r: 'recall' };
const dbConf = c => DB_CONF[c] || c || 'recall';
// "[likely]" / "[recall, disputed]" — every hint line carries the row's label so the model cites it, never upgrades it
const dbTag = (r, extra) => `[${r.confidence || 'recall'}${r.disputed ? ', disputed' : ''}${extra ? ', ' + extra : ''}]`;
/* Rows of a table as objects. The formulaic tables are embedded compact and expanded here —
   O-rings as [dash, id_in, id_tol_in, cs_in, cs_tol_in, conf, parker_t42_in?], drills as
   [name, kind, in_text, mm_text, conf] (mm as the standard prints it: ASME rounds ties
   half-to-even, so it is embedded, never recomputed). The others are the objects the compile
   workflow wrote, with the fields embed.mjs hoisted (shared source/confidence) put back. */
function dbRows(k){
  const t = FLIGHT_DB_DATA[k]; if(!t || !Array.isArray(t.rows)) return null;
  return dbMemo('rows:' + k, () => dbRowsBuild(k, t));
}
function dbRowsBuild(k, t){
  if(t.compact === 'orings') return t.rows.map(([dash, id_in, id_tol_in, cs_in, cs_tol_in, c, t42]) => {
    const T = ['A_bore', 'B1_piston_groove', 'A1_rod_groove', 'B_rod', 'C_plug', 'D_throat'];
    const tin = t42 ? Object.fromEntries(T.map((k, i) => [k, t42[i]])) : null;
    return { key: dash, dash, series: dash.slice(1, 2) + 'xx', id_in, id_mm: +(id_in * 25.4).toFixed(3), id_tol_in, id_tol_mm: +(id_tol_in * 25.4).toFixed(2), cs_in, cs_mm: +(cs_in * 25.4).toFixed(3), cs_mm_std: +(cs_in * 25.4).toFixed(2), cs_tol_in, cs_tol_mm: +(cs_tol_in * 25.4).toFixed(2), od_in: +(id_in + 2 * cs_in).toFixed(3), od_mm: +((id_in + 2 * cs_in) * 25.4).toFixed(3), parker_t42_in: tin, parker_t42_mm: tin ? Object.fromEntries(T.map((k, i) => [k, +(t42[i] * 25.4).toFixed(2)])) : null, confidence: dbConf(c), source: t.source || '' };
  });
  if(t.compact === 'motor_perf') return dbMotorPerfRows().map(r => ({ key: r.mfr + '|' + r.designation, ...r, disputed: r.disputed.length ? r.disputed : undefined, max_thrust_src: r.max_certified ? 'certified' : (r.max_thrust_known ? 'sampled curve (estimate)' : null), availability: r.current ? 'regular' : 'OOP', source: t.source || '' }));
  if(t.compact === 'drills') return t.rows.map(([name, kind, in_text, mm_text, c]) => ({ key: kind + ':' + name, name, kind, in: +in_text, in_text, mm: +mm_text, mm_text, confidence: dbConf(c) }));
  // a copy either way: the result is memoised and handed to callers that sort and splice it
  return t.rows.map(r => t.shared ? { ...t.shared, ...r } : { ...r });
}
/* ISO 286 limits for a size and a fit. Returns the hole and shaft limits in mm and the clearance
   range (negative = interference), or null when the size is off the table or the letter is not one
   the table carries. Everything is derived from data/tables/fits.json, never from memory. */
function dbFit(mm, holeLetter, holeGrade, shaftLetter, shaftGrade){
  const rows = dbRows('fits') || [];
  const r = rows.find(x => mm > x.from_mm && mm <= x.to_mm);
  if(!r || mm <= 0) return null;
  const ITh = r.it_um[holeGrade], ITs = r.it_um[shaftGrade];
  // ISO 286 defines k's deviation as +0.6·∛D for grades 4 to 7 only; at any other grade it is zero.
  const es = shaftLetter === 'h' ? 0
    : (shaftLetter === 'k' && !(shaftGrade >= 4 && shaftGrade <= 7)) ? 0
    : r.shaft_es_um[shaftLetter];
  if(ITh == null || ITs == null || es == null || holeLetter !== 'H') return null;
  const transition = shaftLetter === 'k' || shaftLetter === 'n';   // ei is the deviation for these
  const hole = [mm, mm + ITh / 1000];
  const shaft = transition ? [mm + es / 1000, mm + (es + ITs) / 1000] : [mm + (es - ITs) / 1000, mm + es / 1000];
  return { step: `${r.from_mm}-${r.to_mm} mm`, hole, shaft, it_hole_um: ITh, it_shaft_um: ITs, dev_um: es,
    clearance: [hole[0] - shaft[1], hole[1] - shaft[0]], transition, confidence: r.confidence };
}
function partforgeLoadsLocals() {
// ---- index.html 5744: matClass (a local of the loads evaluator)
  const matClass = m => m.kind === 'metal' ? (/steel|stainless|inconel|4130|17-4/i.test(m.name) ? 'steel' : /titanium|ti-6/i.test(m.name) ? 'steel' : /brass|copper/i.test(m.name) ? 'brass' : 'aluminum') : 'plastic';
  return matClass;
}
// ---- the two doctrine passages, as strings (line numbers in the header)
const DOCTRINE = { standardSizes: "- Use standard sizes. Clearance holes (ISO 273 medium): M2 2.4, M2.5 2.9, M3 3.4, M4 4.5, M5 5.5, M6 6.6, M8 9.0, M10 11.0, M12 13.5; fine series (verify against the standard): M3 3.2, M4 4.3, M5 5.3, M6 6.4, M8 8.4. Tap drills (metric coarse): M2 1.6, M2.5 2.05, M3 2.5, M4 3.3, M5 4.2, M6 5.0, M8 6.8, M10 8.5, M12 10.2. For UNIFIED INCH sizes, do NOT use a remembered clearance or tap drill: the REFERENCE DATA carries the ASME B18.2.8 close/normal/loose holes and the 75 % and 50 % tap drills per thread, by designation, with the drill name. Ask for the thread in the request and use the line you are given; if none was given, say in a NOTE that the hole size is assumed. (These numbers used to be typed into this doctrine and were one fit class out: the doctrine said 6.76 mm was the NORMAL hole for 1/4 in, where ASME B18.2.8 makes 6.75 mm the CLOSE hole and 7.14 mm the normal one.). Model tapped holes at the tap drill and put the thread callout in a NOTE and in mfg. Never model threads as geometry.", standardSizesLine: 1493, provenanceRule: "Carry the label into the NOTE, and let it decide tol_src: a [certain] or [likely] line is tol_src \"source\" with tol_ref naming the vendor, part number or standard. A [recall] line is NOT a citation — it is somebody's memory of a catalogue — so give that dimension tol_src \"user\" or \"default\", say in a NOTE that it is unverified and must be measured, and never write tol_ref as though a document had been read.", provenanceRuleLine: 1454 };
const CUTS = [{"what":"thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck","a":780,"b":872},{"what":"the 6061-T6 entry of FLIGHT_MATERIALS (inside a wrapper object)","a":936,"b":938},{"what":"FLIGHT_PROCESSES (process capability table)","a":1001,"b":1035},{"what":"DECL block: parseFlight, provenanceSummary, partTier, tierEvidence, flightCounts, flightLint, flightContradictions","a":4646,"b":4859},{"what":"DB_MEMO, dbMemo","a":4898,"b":4899},{"what":"dbF, DB_CONF, dbConf, dbTag, dbRows, dbRowsBuild, dbFit","a":4969,"b":5012},{"what":"matClass (a local of the loads evaluator)","a":5744,"b":5744},{"what":"doctrine line \"Use standard sizes\" (string)","a":1493,"b":1493},{"what":"doctrine sentences \"Carry the label into the NOTE … had been read.\" (string)","a":1454,"b":1454}];
return { commit: "0974a62b309b8cf7acd33771b49e9357d4d191f4", CUTS, DOCTRINE, METRIC_COARSE_PITCH, ENGAGEMENT_RULE, parseThreadSize, tensileStressArea_mm2, threadCheck, FLIGHT_MATERIALS, FLIGHT_PROCESSES,
  parseFlight, provenanceSummary, partTier, flightCounts, flightLint, TOL_SRC, FLIGHT_CAP, dbF, dbConf, dbTag, dbFit, dbRows,
  matClass: partforgeLoadsLocals(),
  bindDb: function (d) { FLIGHT_DB_DATA = d || {}; DB_MEMO.clear(); } };
});
