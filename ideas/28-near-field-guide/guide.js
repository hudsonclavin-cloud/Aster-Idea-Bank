// Near Field Guide: the pure kernel. No DOM, no clock, no I/O. Loads as a classic script
// (window.NearFieldGuide) and through require(), so the page, the derivation (build-data.mjs) and the
// tests all bin, sum and derive with the same code.
//
// What lives here:
//   - the bin specifications of every panel (SPECS) and the bar layout each produces (bars());
//   - binIndex(), which places one value in one bar, nulls and out-of-range values in their own bars;
//   - the per-body derivations: a, q, Q in AU, inclination in degrees, the Tisserand parameter with
//     respect to Jupiter, the stored-class check, the eccentricity band, radius from H, designation kind;
//   - the orbital helpers they need (vis-viva, orbit pole, elements from a state vector);
//   - sparse histogram storage and the sum over "atoms" (class x inv014Tier x Slice 18 tier cells)
//     that every selection on the page is built from.
// Constants (AU, GM, obliquity, albedo, thresholds) are never typed here: they arrive in a context
// object that build-data.mjs reads from Aster's own source lines (snapshotted under snapshots/).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NearFieldGuide = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Decimal edges: lo + k*step rounded to 10 places, so an edge equals the double a source literal
  // parses to (0.1, 4.95, 3), and "value >= edge" means what Aster's own "<" thresholds mean.
  const dec = (x) => Number(x.toFixed(10));
  function linEdges(lo, hi, step) {
    const n = Math.round((hi - lo) / step);
    const out = [];
    for (let k = 0; k <= n; k++) out.push(dec(lo + k * step));
    return out;
  }

  // One spec per histogram panel. scale 'log10' bins log10(value) on equal widths but compares the
  // value against 10^edge in the linear domain, so a whole number of days lands deterministically.
  // overEdges split the overflow into more than one bar; specials name the bars outside the axis.
  const SPECS = [
    { key: 'a', label: 'Semi-major axis a', unit: 'AU', scale: 'linear', lo: 0, hi: 6, step: 0.05, overEdges: [10, 50], specials: ['neg'], fmt: 2 },
    { key: 'e', label: 'Eccentricity e', unit: '', scale: 'linear', lo: 0, hi: 1, step: 0.02, overEdges: [], specials: [], fmt: 2 },
    { key: 'i', label: 'Inclination i (to the ecliptic)', unit: '°', scale: 'linear', lo: 0, hi: 180, step: 2, noOver: true, specials: [], fmt: 0 },
    { key: 'q', label: 'Perihelion q = a(1 − e)', unit: 'AU', scale: 'linear', lo: 0, hi: 1.5, step: 0.02, overEdges: [3], specials: [], fmt: 2 },
    { key: 'Q', label: 'Aphelion Q = a(1 + e)', unit: 'AU', scale: 'linear', lo: 0, hi: 10, step: 0.05, overEdges: [50], specials: ['undef'], fmt: 2 },
    { key: 'H', label: 'Absolute magnitude H', unit: 'mag', scale: 'linear', lo: 9, hi: 35, step: 0.5, noOver: true, specials: ['null'], fmt: 1 },
    { key: 'r', label: 'estimatedRadiusM (from H at the assumed albedo)', unit: 'm', scale: 'log10', lo: -1, hi: 4.5, step: 0.1, noOver: true, specials: ['null'], fmt: 2 },
    { key: 'U', label: 'Condition code U (MPC ordinal)', unit: '', scale: 'linear', lo: 0, hi: 10, step: 1, noOver: true, specials: ['null'], fmt: 0, integer: true },
    { key: 'arc', label: 'Data arc', unit: 'days', scale: 'log10', lo: 0, hi: 5, step: 0.25, noOver: true, specials: ['zero', 'null'], fmt: 0 },
    { key: 'nObs', label: 'Observations used', unit: '', scale: 'log10', lo: 0.5, hi: 4.25, step: 0.125, noOver: true, specials: [], fmt: 0 },
    { key: 'sigmaA', label: 'sigmaA (1-σ uncertainty in a)', unit: 'AU', scale: 'log10', lo: -11, hi: 3, step: 0.25, noOver: true, specials: ['null'], fmt: 2 },
    { key: 'TJ', label: 'Tisserand parameter T_J', unit: '', scale: 'linear', lo: -1.5, hi: 12, step: 0.1, noOver: true, specials: [], fmt: 1 },
  ];

  // Categorical panels: fixed category order; an unknown category is an error, not a new bar.
  const CATS = [
    { key: 'cls', label: 'orbitClass', cats: ['AMO', 'APO', 'ATE', 'IEO', 'ETC', 'HTC', 'JFC'] },
    { key: 'tier', label: 'inv014Tier', cats: ['visualization-tier', 'planning-tier', 'not-kepler-safe'] },
    { key: 'fid', label: 'Slice 18 screening-fidelity tier', cats: ['L0', 'L1', 'L2'] },
    { key: 'band', label: 'eccentricityBand', cats: ['A', 'B', 'C', 'D'] },
    { key: 'anchor', label: 'anchorSource', cats: ['horizons-reanchor', 'sbdb', 'stale-unanchored'] },
    { key: 'pha', label: 'pha', cats: [true, false] },
    { key: 'des', label: 'Designation kind', cats: ['named', 'numbered', 'provisional', 'comet'] },
  ];

  // The a-e density grid: a in [0, 6) AU by 0.1, e in [0, 1) by 0.02. Anything else is off-grid.
  const GRID = { aLo: 0, aHi: 6, aStep: 0.1, eLo: 0, eHi: 1, eStep: 0.02 };
  GRID.cols = Math.round((GRID.aHi - GRID.aLo) / GRID.aStep);
  GRID.rows = Math.round((GRID.eHi - GRID.eLo) / GRID.eStep);
  GRID.aEdges = linEdges(GRID.aLo, GRID.aHi, GRID.aStep);
  GRID.eEdges = linEdges(GRID.eLo, GRID.eHi, GRID.eStep);

  const SPECIAL_LABEL = {
    neg: 'a < 0 (hyperbolic)',
    undef: 'undefined (e ≥ 1)',
    null: 'not reported (null)',
    zero: '0 days',
  };

  // Everything a stored bin count depends on. bins.data.js records it; the page refuses data that
  // was binned under a different signature.
  function specSignature() {
    const s = SPECS.map((p) => [p.key, p.scale, p.lo, p.hi, p.step, p.overEdges || [], !!p.noOver, p.specials].join('|'));
    const c = CATS.map((p) => [p.key].concat(p.cats).join('|'));
    const g = [GRID.aLo, GRID.aHi, GRID.aStep, GRID.eLo, GRID.eHi, GRID.eStep].join('|');
    return s.concat(c, [g]).join(';');
  }

  const specCache = new Map();
  function prepared(spec) {
    let p = specCache.get(spec.key);
    if (p) return p;
    const edges = linEdges(spec.lo, spec.hi, spec.step);
    const lin = spec.scale === 'log10' ? edges.map((x) => Math.pow(10, x)) : edges;
    const overs = spec.noOver ? [] : [spec.hi].concat(spec.overEdges || []);
    const overLin = spec.scale === 'log10' ? overs.map((x) => Math.pow(10, x)) : overs;
    const list = [];
    for (let k = 0; k < edges.length - 1; k++) list.push({ kind: 'bin', lo: edges[k], hi: edges[k + 1] });
    for (let k = 0; k < overs.length; k++) list.push({ kind: 'over', lo: overs[k], hi: k + 1 < overs.length ? overs[k + 1] : Infinity });
    for (const s of spec.specials) list.push({ kind: s, lo: null, hi: null });
    p = { edges, lin, overs, overLin, list };
    specCache.set(spec.key, p);
    return p;
  }

  function fmtEdge(spec, x) {
    if (spec.scale === 'log10') {
      const v = Math.pow(10, x);
      if (v >= 1000 || v < 0.01) return v.toExponential(1).replace('e+', 'e');
      return String(Number(v.toPrecision(3)));
    }
    return x.toFixed(spec.fmt);
  }

  // The bars of one panel, in display order: regular bins, overflow bars, then the special bars.
  function bars(spec) {
    return prepared(spec).list.map((b, idx) => {
      let label;
      if (b.kind === 'bin') label = spec.integer ? String(b.lo) : `${fmtEdge(spec, b.lo)}–${fmtEdge(spec, b.hi)}`;
      else if (b.kind === 'over') label = b.hi === Infinity ? `≥ ${fmtEdge(spec, b.lo)}` : `${fmtEdge(spec, b.lo)}–${fmtEdge(spec, b.hi)}`;
      else label = SPECIAL_LABEL[b.kind];
      return { idx, kind: b.kind, lo: b.lo, hi: b.hi, label };
    });
  }

  // Largest k with arr[k] <= v (arr ascending), or -1.
  function floorIndex(arr, v) {
    let lo = 0;
    let hi = arr.length - 1;
    if (!(v >= arr[0])) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Which bar a value goes to. A value is either a number, null (not reported), or one of the
  // tokens 'neg' / 'undef' that derive() hands over for a hyperbolic orbit. Throws on a value the
  // spec has no bar for, so a re-derivation over a changed catalog fails loudly instead of dropping it.
  function binIndex(spec, v) {
    const p = prepared(spec);
    const nBins = p.edges.length - 1;
    const special = (kind) => {
      const k = spec.specials.indexOf(kind);
      if (k < 0) throw new Error(`${spec.key}: no "${kind}" bar for value ${v}`);
      return nBins + p.overs.length + k;
    };
    if (v === null || v === undefined) return special('null');
    if (v === 'neg' || v === 'undef') return special(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${spec.key}: not a finite number: ${v}`);
    if (spec.scale === 'log10' && v === 0) return special('zero');
    if (spec.scale === 'log10' && v < 0) throw new Error(`${spec.key}: negative value on a log axis: ${v}`);
    const k = floorIndex(p.lin, v);
    if (k < 0) throw new Error(`${spec.key}: ${v} is below the axis (${spec.lo})`);
    if (k < nBins) return k;
    if (!p.overs.length) throw new Error(`${spec.key}: ${v} is above the axis (${spec.hi})`);
    return nBins + floorIndex(p.overLin, v);
  }

  function catIndex(cat, v) {
    const k = cat.cats.indexOf(v);
    if (k < 0) throw new Error(`${cat.key}: unknown category ${JSON.stringify(v)}`);
    return k;
  }

  function gridIndex(aAu, e) {
    if (typeof aAu !== 'number' || typeof e !== 'number') return -1;
    const c = floorIndex(GRID.aEdges, aAu);
    const r = floorIndex(GRID.eEdges, e);
    if (c < 0 || c >= GRID.cols || r < 0 || r >= GRID.rows) return -1;
    return r * GRID.cols + c;
  }

  // ---- orbital helpers (units: km, km/s, km^3/s^2, rad) ----
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const norm = (u) => Math.sqrt(dot(u, u));

  // Equatorial (ICRF) to ecliptic J2000: a rotation by +obliquity about x.
  function icrfToEcliptic(u, obliquityRad) {
    const c = Math.cos(obliquityRad);
    const s = Math.sin(obliquityRad);
    return [u[0], c * u[1] + s * u[2], -s * u[1] + c * u[2]];
  }

  // Vis-viva: 1/a = 2/r - v^2/mu.
  function visVivaA(r, v, mu) {
    return 1 / (2 / norm(r) - dot(v, v) / mu);
  }

  // a, e, i, node of a heliocentric state, in the ecliptic frame.
  function elementsFromState(r, v, mu, obliquityRad) {
    const re = icrfToEcliptic(r, obliquityRad);
    const ve = icrfToEcliptic(v, obliquityRad);
    const h = cross(re, ve);
    const hn = norm(h);
    const evec = cross(ve, h).map((x, k) => x / mu - re[k] / norm(re));
    return {
      a: visVivaA(re, ve, mu),
      e: norm(evec),
      i: Math.acos(h[2] / hn),
      node: Math.atan2(h[0], -h[1]),
      pole: h.map((x) => x / hn),
    };
  }

  // Unit normal of an orbit given ecliptic i and node.
  function poleFromAngles(iRad, nodeRad) {
    return [Math.sin(iRad) * Math.sin(nodeRad), -Math.sin(iRad) * Math.cos(nodeRad), Math.cos(iRad)];
  }

  // T_J = a_J/a + 2 cos(i) sqrt((a/a_J)(1 - e^2)), with i the inclination to Jupiter's orbit plane.
  // Defined for a hyperbolic orbit too (a < 0 and 1 - e^2 < 0 keep the root real).
  function tisserand(aAu, e, cosI, aJAu) {
    return aJAu / aAu + 2 * cosI * Math.sqrt((aAu / aJAu) * (1 - e * e));
  }

  // Aster's own class rule (src/physics/catalog/normalizers.ts:103-106 at 62ddb17), thresholds passed in.
  function classFromElements(aAu, q, Q, rule) {
    if (Q < rule.ieoQ) return 'IEO';
    if (aAu < rule.ateA) return 'ATE';
    if (q < rule.apoQ) return 'APO';
    return 'AMO';
  }

  // Aster's eccentricityBandForBody (src/v2/core/constants/asteroids.ts:91-105), thresholds passed in.
  function eccentricityBand(e, t) {
    if (e < t[0]) return 'A';
    if (e < t[1]) return 'B';
    if (e < t[2]) return 'C';
    return 'D';
  }

  // Aster's deriveAsteroidRadiusMFromAbsoluteMagnitude, with its two literals passed in.
  function radiusFromH(H, albedo, k) {
    return (k.diamKm / Math.sqrt(albedo)) * Math.pow(10, -H / 5) * k.kmToRadiusM;
  }

  // Designation kind from the record's name: comet designations (1P/Halley, C/2015 D1 ...), numbered
  // with a name (433 Eros), numbered without one (4596 (1981 QB)), or provisional ((1979 XB)).
  function designationKind(name) {
    if (/^(\d+[PDI](-[A-Z0-9]+)?\/|[PCDXIA]\/)/.test(name)) return 'comet';
    if (/^\d+ \(/.test(name)) return 'numbered';
    if (/^\d+ [^(]/.test(name)) return 'named';
    if (/^\(/.test(name)) return 'provisional';
    throw new Error(`unrecognised name format: ${name}`);
  }

  // Every per-body value the panels bin. ctx: { auKm, aJAu, jupiterPole, rule, bands, fidelity }.
  function derive(b, ctx) {
    const el = b.elements;
    const aAu = el.aKm / ctx.auKm;
    const e = el.e;
    const hyper = !(e < 1) || !(aAu > 0);
    const q = aAu * (1 - e);
    const cosIJ = dot(poleFromAngles(el.iRad, el.omRad), ctx.jupiterPole);
    return {
      designation: b.designation,
      a: hyper ? 'neg' : aAu,
      aAu,
      e,
      i: (el.iRad * 180) / Math.PI,
      q,
      Q: hyper ? 'undef' : aAu * (1 + e),
      H: b.H,
      r: b.estimatedRadiusM,
      U: b.conditionCode,
      arc: b.dataArcDays,
      nObs: b.nObsUsed,
      sigmaA: b.sigmaA,
      TJ: tisserand(aAu, e, cosIJ, ctx.aJAu),
      cls: b.orbitClass,
      tier: b.inv014Tier,
      fid: ctx.fidelity ? ctx.fidelity(b) : null,
      band: b.eccentricityBand,
      anchor: b.anchorSource,
      pha: b.pha,
      des: designationKind(b.name),
      classFromElements: hyper ? null : classFromElements(aAu, q, aAu * (1 + e), ctx.rule),
      bandFromE: eccentricityBand(e, ctx.bands),
    };
  }

  // ---- sparse storage and atoms ----
  function toSparse(dense) {
    const out = [];
    for (let k = 0; k < dense.length; k++) if (dense[k]) out.push(k, dense[k]);
    return out;
  }
  function addSparse(dense, sparse) {
    for (let k = 0; k < sparse.length; k += 2) dense[sparse[k]] += sparse[k + 1];
    return dense;
  }
  const zeros = (n) => new Array(n).fill(0);
  const sum = (arr) => arr.reduce((s, x) => s + x, 0);

  // Null census of one record: every key path (nested objects walked, arrays are leaves) -> is null.
  function nullPaths(obj, prefix, out) {
    for (const k of Object.keys(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const v = obj[k];
      out.push([p, v === null]);
      if (v && typeof v === 'object' && !Array.isArray(v)) nullPaths(v, p, out);
    }
    return out;
  }

  // An empty accumulator for one atom.
  function newAtom(key) {
    const h = {};
    for (const s of SPECS) h[s.key] = zeros(prepared(s).list.length);
    for (const c of CATS) h[c.key] = zeros(c.cats.length);
    return Object.assign({ n: 0, h, nulls: {}, present: {}, grid: zeros(GRID.cols * GRID.rows) }, key);
  }

  function addBody(atom, d, record) {
    atom.n++;
    for (const s of SPECS) atom.h[s.key][binIndex(s, d[s.key])]++;
    for (const c of CATS) atom.h[c.key][catIndex(c, d[c.key])]++;
    const g = gridIndex(d.aAu, d.e);
    if (g >= 0 && !(d.a === 'neg')) atom.grid[g]++;
    for (const [p, isNull] of nullPaths(record, '', [])) {
      atom.present[p] = (atom.present[p] || 0) + 1;
      if (isNull) atom.nulls[p] = (atom.nulls[p] || 0) + 1;
    }
  }

  function packAtom(atom) {
    const h = {};
    for (const k of Object.keys(atom.h)) h[k] = toSparse(atom.h[k]);
    return { cls: atom.cls, tier: atom.tier, fid: atom.fid, n: atom.n, h, nulls: atom.nulls, present: atom.present, grid: toSparse(atom.grid) };
  }

  // A selection is { cls, tier, fid }: each null (any), one value, or an array of values (a group,
  // such as the anomaly tail ETC + HTC + JFC). An atom is in it when it matches on all three.
  function matches(atom, sel) {
    for (const dim of ['cls', 'tier', 'fid']) {
      const want = sel[dim];
      if (want === null || want === undefined) continue;
      if (Array.isArray(want) ? !want.includes(atom[dim]) : atom[dim] !== want) return false;
    }
    return true;
  }

  // Sum the packed atoms of a selection into dense histograms, null counts and the a-e grid.
  function summarize(atoms, sel) {
    const out = { n: 0, atoms: 0, h: {}, nulls: {}, present: {}, grid: zeros(GRID.cols * GRID.rows) };
    for (const s of SPECS) out.h[s.key] = zeros(prepared(s).list.length);
    for (const c of CATS) out.h[c.key] = zeros(c.cats.length);
    for (const a of atoms) {
      if (!matches(a, sel || {})) continue;
      out.n += a.n;
      out.atoms++;
      for (const k of Object.keys(out.h)) addSparse(out.h[k], a.h[k] || []);
      addSparse(out.grid, a.grid);
      for (const [p, c] of Object.entries(a.nulls)) out.nulls[p] = (out.nulls[p] || 0) + c;
      for (const [p, c] of Object.entries(a.present)) out.present[p] = (out.present[p] || 0) + c;
    }
    return out;
  }

  // Count of a histogram over the bars whose [lo, hi) lies at or above a value (bins and overflows).
  function countAtOrAbove(spec, dense, x) {
    const list = prepared(spec).list;
    let n = 0;
    list.forEach((b, k) => {
      if ((b.kind === 'bin' || b.kind === 'over') && b.lo >= x) n += dense[k];
      else if ((b.kind === 'bin' || b.kind === 'over') && b.lo < x && b.hi > x && dense[k]) throw new Error(`${spec.key}: ${x} is not a bar edge`);
    });
    return n;
  }
  function countBelow(spec, dense, x) {
    const list = prepared(spec).list;
    let n = 0;
    list.forEach((b, k) => {
      if ((b.kind === 'bin' || b.kind === 'over') && b.hi <= x) n += dense[k];
      else if ((b.kind === 'bin' || b.kind === 'over') && b.lo < x && b.hi > x && dense[k]) throw new Error(`${spec.key}: ${x} is not a bar edge`);
    });
    return n;
  }

  // Nearest-rank median position of a histogram: the bar that holds the middle body of the numeric bars.
  function medianBar(spec, dense) {
    const list = prepared(spec).list;
    const idx = list.map((b, k) => k).filter((k) => list[k].kind === 'bin' || list[k].kind === 'over');
    const total = idx.reduce((s, k) => s + dense[k], 0);
    if (!total) return null;
    let run = 0;
    for (const k of idx) {
      run += dense[k];
      if (run * 2 >= total) return k;
    }
    return null;
  }

  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n, d) {
    if (!d) return '—';
    const p = (100 * n) / d;
    if (p > 0 && p < 0.1) return '<0.1%';
    return `${p.toFixed(p >= 10 || p === 0 ? 1 : 2)}%`;
  }

  return {
    SPECS,
    CATS,
    GRID,
    SPECIAL_LABEL,
    linEdges,
    specSignature,
    bars,
    binIndex,
    catIndex,
    gridIndex,
    icrfToEcliptic,
    visVivaA,
    elementsFromState,
    poleFromAngles,
    tisserand,
    classFromElements,
    eccentricityBand,
    radiusFromH,
    designationKind,
    derive,
    toSparse,
    addSparse,
    nullPaths,
    newAtom,
    addBody,
    packAtom,
    matches,
    summarize,
    countAtOrAbove,
    countBelow,
    medianBar,
    sum,
    fmtInt,
    fmtPct,
  };
});
