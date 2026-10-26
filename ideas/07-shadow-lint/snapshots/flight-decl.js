// Cut from PartForge index.html lines 4651–4761 and 4823–4825 by build-data.mjs; not edited.
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
function flightCounts(f){
  return f && !f.malformed ? { critical: f.critical.length, od: f.od.length, bores: f.bores.length, holes: f.holes.length, revolve: f.revolve.length, gauges: f.gauges.length, loads: f.loads.length } : null;
}
if (typeof module === 'object' && module.exports) module.exports = { parseFlight, provenanceSummary, flightCounts, TOL_SRC, FLIGHT_HAZARD, FLIGHT_AXIS, FLIGHT_CAP };
