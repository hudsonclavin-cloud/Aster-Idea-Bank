// Edge of the Grid — pure census logic for Aster's Lambert screening cache.
// Loads as a classic script (window.GridCensus) and via require() (module.exports); no dependencies.
//
// Everything here is arithmetic on the cache's own `metadata` and `bodies[].bestWindows` and on
// catalog attributes (orbitClass, H, pha, elements.aKm). No grid parameter, date or constant is
// typed into this file: the lattice is derived from metadata, the porkchop view's end date and the
// AU constant are passed in by the caller (build-data.mjs / edge-census.mjs extract them from the
// Aster checkout and record file and line). Where an input is missing the functions return a
// structured refusal ({ refusal: { code, reason, what_would_help } }) instead of a number.
//
// Labels: [Certain] arithmetic on recorded values; [Likely] an inference stated as such;
// [Speculative] a reading the cache cannot support, always shown with its refusal.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GridCensus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const REFUSAL_CODES = ['insufficient_data', 'out_of_envelope', 'not_found'];
  const SCHEMA = 'edge-census/1';

  // ---------------------------------------------------------------- refusals and small helpers
  function refuse(code, reason, whatWouldHelp, extra) {
    if (!REFUSAL_CODES.includes(code)) throw new Error(`unknown refusal code ${code}`);
    return Object.assign({ refusal: { code, reason, what_would_help: whatWouldHelp } }, extra || {});
  }
  const isRefusal = (x) => !!(x && typeof x === 'object' && x.refusal);
  const isInt = (x) => Number.isInteger(x);
  const isPosInt = (x) => Number.isInteger(x) && x > 0;

  // Strict ISO calendar date (YYYY-MM-DD) → milliseconds at UTC midnight, or NaN.
  function parseUtcDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
    const ms = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    if (!Number.isFinite(ms)) return NaN;
    return new Date(ms).toISOString().slice(0, 10) === s ? ms : NaN; // rejects 2026-02-30 and the like
  }
  const isoFromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
  // Whole days from a to b (both ISO dates); NaN when either is invalid.
  function daysBetween(aIso, bIso) {
    const a = parseUtcDate(aIso), b = parseUtcDate(bIso);
    return Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.round((b - a) / DAY_MS);
  }
  const addDays = (iso, n) => isoFromMs(parseUtcDate(iso) + n * DAY_MS);
  const yearOf = (iso) => Number(iso.slice(0, 4));

  function fmtInt(n) {
    if (!Number.isFinite(n)) return String(n);
    const s = String(Math.trunc(Math.abs(n)));
    const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + grouped;
  }
  function median(xs) {
    if (!xs.length) return null;
    const a = xs.slice().sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const share = (n, d) => (d ? n / d : null);

  // ---------------------------------------------------------------- the lattice
  // The precompute script walks departures from screeningWindow.startUtc in steps of
  // departureGridSpacingDays while t <= endUtc, and flight times from tofMinDays in steps of
  // tofGridSpacingDays while d <= tofMaxDays (tools/build/precompute-lambert-screen.mjs, the
  // `for (let t = startTdb; t <= endTdb; …)` and `for (let d = TOF_MIN_DAYS; d <= TOF_MAX_DAYS; …)`
  // loops). Both bounds are inclusive at day granularity, so:
  //   nCols = floor((end − start) / spacing) + 1,  nRows = floor((tofMax − tofMin) / tofSpacing) + 1.
  function lattice(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return refuse('insufficient_data', 'cache metadata is missing', 'a lambert-screen-cache.json with a `metadata` object (schemaVersion 1)');
    }
    const w = metadata.screeningWindow;
    const missing = [];
    if (!w || typeof w !== 'object') missing.push('screeningWindow');
    else {
      if (Number.isNaN(parseUtcDate(w.startUtc))) missing.push('screeningWindow.startUtc');
      if (Number.isNaN(parseUtcDate(w.endUtc))) missing.push('screeningWindow.endUtc');
    }
    for (const k of ['departureGridSpacingDays', 'tofGridSpacingDays', 'tofMinDays', 'tofMaxDays']) {
      if (!Number.isFinite(metadata[k])) missing.push(k);
    }
    if (missing.length) {
      return refuse('insufficient_data', `cache metadata lacks ${missing.join(', ')}`, 'metadata written by precompute-lambert-screen.mjs: screeningWindow {startUtc, endUtc}, departureGridSpacingDays, tofGridSpacingDays, tofMinDays, tofMaxDays');
    }
    const spacing = metadata.departureGridSpacingDays;
    const tofSpacing = metadata.tofGridSpacingDays;
    const tofMin = metadata.tofMinDays;
    const tofMax = metadata.tofMaxDays;
    if (!isPosInt(spacing) || !isPosInt(tofSpacing)) {
      return refuse('out_of_envelope', `grid spacings must be positive whole days (got ${spacing} and ${tofSpacing})`, 'integer day spacings, as the precompute script uses');
    }
    if (!isInt(tofMin) || !isInt(tofMax) || tofMin <= 0 || tofMax < tofMin) {
      return refuse('out_of_envelope', `flight-time bounds must be whole days with 0 < tofMinDays <= tofMaxDays (got ${tofMin}..${tofMax})`, 'tofMinDays and tofMaxDays as whole days');
    }
    const spanDays = daysBetween(w.startUtc, w.endUtc);
    if (spanDays < 0) {
      return refuse('out_of_envelope', `screeningWindow ends (${w.endUtc}) before it starts (${w.startUtc})`, 'a window whose endUtc is on or after startUtc');
    }
    const nCols = Math.floor(spanDays / spacing) + 1;
    const nRows = Math.floor((tofMax - tofMin) / tofSpacing) + 1;
    const lastDepartureUtc = addDays(w.startUtc, (nCols - 1) * spacing);
    const lastTofDays = tofMin + (nRows - 1) * tofSpacing;
    // Calendar years the columns fall in, with the number of columns in each.
    const years = [];
    for (let c = 0; c < nCols; c++) {
      const y = yearOf(addDays(w.startUtc, c * spacing));
      if (!years.length || years[years.length - 1].year !== y) years.push({ year: y, cols: 0, firstCol: c });
      years[years.length - 1].cols += 1;
    }
    return {
      startUtc: w.startUtc,
      endUtc: w.endUtc,
      departureSpacingDays: spacing,
      spanDays,
      nCols,
      firstDepartureUtc: w.startUtc,
      lastDepartureUtc,
      unusedTailDays: spanDays - (nCols - 1) * spacing,
      tofMinDays: tofMin,
      tofMaxDays: tofMax,
      tofSpacingDays: tofSpacing,
      nRows,
      lastTofDays,
      unusedTofTailDays: tofMax - lastTofDays,
      cellsPerBody: nCols * nRows,
      years,
    };
  }

  const colDate = (lat, col) => addDays(lat.startUtc, col * lat.departureSpacingDays);
  const rowTof = (lat, row) => lat.tofMinDays + row * lat.tofSpacingDays;
  function colYear(lat, col) {
    return yearOf(colDate(lat, col));
  }
  function yearIndex(lat, year) {
    return lat.years.findIndex((y) => y.year === year);
  }

  // A derived description of the grid: every figure in it comes from `lattice`.
  function describeGrid(lat) {
    if (isRefusal(lat)) return `No grid can be described: ${lat.refusal.reason}.`;
    return (
      `Departures from ${lat.firstDepartureUtc} to ${lat.lastDepartureUtc} every ${lat.departureSpacingDays} days ` +
      `(${fmtInt(lat.nCols)} columns; the metadata's window ends ${lat.endUtc}, ${lat.unusedTailDays} day${lat.unusedTailDays === 1 ? '' : 's'} after the last lattice point), ` +
      `flight times from ${fmtInt(lat.tofMinDays)} to ${fmtInt(lat.lastTofDays)} days every ${lat.tofSpacingDays} days ` +
      `(${lat.nRows} rows; the metadata's ceiling is ${fmtInt(lat.tofMaxDays)} days): ${fmtInt(lat.cellsPerBody)} cells per body.`
    );
  }

  // ---------------------------------------------------------------- cells, edges, basins
  // Where a stored window sits on the lattice. A window that is not on the lattice is reported as a
  // violation (named), never silently rounded onto it.
  function cellOf(window, lat) {
    const violations = [];
    const days = daysBetween(lat.startUtc, window && window.launchDate);
    let col = null, row = null;
    if (Number.isNaN(days)) violations.push(`launchDate ${window && window.launchDate} is not a calendar date`);
    else if (days % lat.departureSpacingDays !== 0) violations.push(`launchDate ${window.launchDate} is ${days} days after ${lat.startUtc}, not a multiple of ${lat.departureSpacingDays}`);
    else {
      col = days / lat.departureSpacingDays;
      if (col < 0 || col >= lat.nCols) violations.push(`launchDate ${window.launchDate} is outside the ${lat.nCols}-column lattice (column ${col})`);
    }
    const tof = window && window.tofDays;
    if (!Number.isFinite(tof)) violations.push(`tofDays ${tof} is not a number`);
    else if ((tof - lat.tofMinDays) % lat.tofSpacingDays !== 0) violations.push(`tofDays ${tof} is not ${lat.tofMinDays} + k·${lat.tofSpacingDays}`);
    else {
      row = (tof - lat.tofMinDays) / lat.tofSpacingDays;
      if (row < 0 || row >= lat.nRows) violations.push(`tofDays ${tof} is outside the ${lat.nRows}-row lattice (row ${row})`);
    }
    return { col, row, onLattice: violations.length === 0, violations };
  }

  const EDGE_KEYS = ['first', 'last', 'tofMin', 'tofMax'];
  function edgeFlags(cell, lat) {
    const f = {
      first: cell.col === 0,
      last: cell.col === lat.nCols - 1,
      tofMin: cell.row === 0,
      tofMax: cell.row === lat.nRows - 1,
    };
    f.count = EDGE_KEYS.filter((k) => f[k]).length;
    f.any = f.count > 0;
    return f;
  }

  // Index of the cheapest window by c3 (the cache stores them ascending, but this never relies on it).
  function argminC3(windows) {
    let best = -1;
    for (let i = 0; i < windows.length; i++) {
      if (Number.isFinite(windows[i].c3) && (best < 0 || windows[i].c3 < windows[best].c3)) best = i;
    }
    return best;
  }

  const DEFAULT_BASIN_RULE = { maxColGap: 2, maxRowGap: 1 };
  // Windows whose cells are within maxColGap columns and maxRowGap rows of each other are in the same
  // basin; basins are the connected components of that relation (union–find), so the count does not
  // depend on the order of the windows. Returns the basin label of each window (0 = the cheapest's).
  function basins(windows, lat, rule) {
    const r = rule || DEFAULT_BASIN_RULE;
    const cells = windows.map((w) => cellOf(w, lat));
    const n = cells.length;
    const parent = cells.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (let i = 0; i < n; i++) {
      if (!cells[i].onLattice) continue;
      for (let j = i + 1; j < n; j++) {
        if (!cells[j].onLattice) continue;
        if (Math.abs(cells[i].col - cells[j].col) <= r.maxColGap && Math.abs(cells[i].row - cells[j].row) <= r.maxRowGap) {
          parent[find(i)] = find(j);
        }
      }
    }
    const roots = cells.map((_, i) => find(i));
    const order = [];
    const min = argminC3(windows);
    if (min >= 0) order.push(roots[min]);
    // label basins in increasing order of their cheapest window's c3
    const byC3 = windows.map((w, i) => i).sort((a, b) => windows[a].c3 - windows[b].c3);
    for (const i of byC3) if (!order.includes(roots[i])) order.push(roots[i]);
    const labels = roots.map((root) => order.indexOf(root));
    return { count: order.length, labels, rule: { maxColGap: r.maxColGap, maxRowGap: r.maxRowGap } };
  }

  // For the cheapest window of a body: which edges it touches and what the other stored windows say
  // about the slope there. For a departure edge the evidence is the chain of stored windows along
  // the same flight-time row walking inward (columns 1, 2, … or nCols−2, nCols−3, …); for a
  // flight-time edge it is the chain along the same column walking inward (rows 1, 2, … or
  // nRows−2, …). The chain is "monotone" when c3 rises at every inward step.
  //   verdict 'likely_clipped'  — the inward neighbour is stored and every stored step rises:
  //                                the sampled surface is still falling as it leaves the grid, so
  //                                the surface's minimum is at or beyond the edge. [Likely]
  //   verdict 'undetermined'    — the neighbour is not among the five (the other windows lie in
  //                                other basins), so the cache records no slope at the edge; or
  //                                the chain is not monotone. [Speculative]
  function edgeEvidence(windows, lat) {
    const min = argminC3(windows);
    if (min < 0) return { hasMinimum: false, edges: [] };
    const cells = windows.map((w) => cellOf(w, lat));
    const m = cells[min];
    if (!m.onLattice) return { hasMinimum: true, minimumOnLattice: false, edges: [] };
    const flags = edgeFlags(m, lat);
    const byCell = new Map();
    cells.forEach((c, i) => {
      if (c.onLattice) byCell.set(`${c.col},${c.row}`, windows[i].c3);
    });
    const edges = [];
    for (const key of EDGE_KEYS) {
      if (!flags[key]) continue;
      const step = key === 'first' ? [1, 0] : key === 'last' ? [-1, 0] : key === 'tofMin' ? [0, 1] : [0, -1];
      const chain = [windows[min].c3];
      let c = m.col + step[0], r = m.row + step[1];
      while (byCell.has(`${c},${r}`)) {
        chain.push(byCell.get(`${c},${r}`));
        c += step[0];
        r += step[1];
      }
      const monotone = chain.every((v, i) => i === 0 || v > chain[i - 1]);
      const neighbourPresent = chain.length >= 2;
      edges.push({
        edge: key,
        cell: key === 'first' || key === 'last' ? `column ${m.col} (${colDate(lat, m.col)})` : `row ${m.row} (${rowTof(lat, m.row)} days)`,
        neighbourPresent,
        slopeC3PerCell: neighbourPresent ? chain[1] - chain[0] : null,
        chainLength: chain.length,
        monotone,
        verdict: neighbourPresent && monotone ? 'likely_clipped' : 'undetermined',
        label: neighbourPresent && monotone ? 'Likely' : 'Speculative',
      });
    }
    return { hasMinimum: true, minimumOnLattice: true, minIndex: min, cell: { col: m.col, row: m.row }, flags, edges };
  }

  // ---------------------------------------------------------------- catalog bands
  function hBand(H) {
    if (H === null || H === undefined || !Number.isFinite(H)) return 'H missing';
    if (H < 18) return 'H < 18';
    if (H < 22) return '18 ≤ H < 22';
    if (H < 25) return '22 ≤ H < 25';
    if (H < 28) return '25 ≤ H < 28';
    return 'H ≥ 28';
  }
  const H_BANDS = ['H < 18', '18 ≤ H < 22', '22 ≤ H < 25', '25 ≤ H < 28', 'H ≥ 28', 'H missing'];

  // Synodic period with Earth, years, from a semi-major axis: T = (a/AU)^1.5 years (Kepler's third
  // law in AU and years), S = 1 / |1/T − 1|. Infinite for a = 1 AU. [Certain] two-body kinematics.
  function synodicYears(aKm, auKm) {
    if (!Number.isFinite(aKm) || aKm <= 0) return refuse('insufficient_data', `semi-major axis ${aKm} km is not usable`, 'a positive semi-major axis in km');
    if (!Number.isFinite(auKm) || auKm <= 0) return refuse('insufficient_data', 'the AU in km was not supplied', 'AU_KM from tools/build/precompute-lambert-screen.mjs (the constant the cache itself was built with)');
    const T = Math.pow(aKm / auKm, 1.5);
    const inv = Math.abs(1 / T - 1);
    return inv === 0 ? Infinity : 1 / inv;
  }
  function synodicBand(S) {
    if (isRefusal(S)) return 'unknown';
    if (S < 2) return 'S < 2 yr';
    if (S < 5) return '2 ≤ S < 5 yr';
    if (S < 15) return '5 ≤ S < 15 yr';
    if (S < 50) return '15 ≤ S < 50 yr';
    return 'S ≥ 50 yr';
  }
  const SYNODIC_BANDS = ['S < 2 yr', '2 ≤ S < 5 yr', '5 ≤ S < 15 yr', '15 ≤ S < 50 yr', 'S ≥ 50 yr'];

  // ---------------------------------------------------------------- the census
  function newEdgeStats() {
    return { touched: 0, neighbourPresent: 0, undetermined: 0, chains: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, chains3plus: 0, monotone3plus: 0, nonMonotone3plus: 0, slopes: [] };
  }
  function newTableRow(key) {
    return { key, n: 0, any: 0, first: 0, last: 0, tofMin: 0, tofMax: 0 };
  }
  function finishRow(row) {
    row.share = share(row.any, row.n);
    return row;
  }

  // cache: parsed lambert-screen-cache.json. catalog: parsed nea-catalog-slice9.json or null.
  // options: { viewGrid: {depEndUtc, …} | null, auKm: number | null, sampleIds: [bodyId…], sampleWhy: {bodyId: text},
  //            basinRules: [{maxColGap,maxRowGap}…] (alternates to report), inputs: {…} (recorded as is) }
  function census(cache, catalog, options) {
    const opts = options || {};
    if (!cache || typeof cache !== 'object' || !Array.isArray(cache.bodies)) {
      return refuse('insufficient_data', 'the cache has no `bodies` array', 'a lambert-screen-cache.json (schemaVersion 1) as written by precompute-lambert-screen.mjs');
    }
    const lat = lattice(cache.metadata);
    if (isRefusal(lat)) return lat;
    if (!cache.bodies.length) return refuse('insufficient_data', 'the cache lists no bodies', 'a cache with at least one screened body');
    const asteroids = catalog && catalog.asteroids && typeof catalog.asteroids === 'object' ? catalog.asteroids : null;
    const auKm = Number.isFinite(opts.auKm) ? opts.auKm : null;
    const viewEnd = opts.viewGrid && !Number.isNaN(parseUtcDate(opts.viewGrid.depEndUtc)) ? opts.viewGrid.depEndUtc : null;

    // accumulators
    const perColMin = new Array(lat.nCols).fill(0);
    const perColAll = new Array(lat.nCols).fill(0);
    const perRowMin = new Array(lat.nRows).fill(0);
    const perRowAll = new Array(lat.nRows).fill(0);
    const heatMin = Array.from({ length: lat.nRows }, () => new Array(lat.years.length).fill(0));
    const heatAll = Array.from({ length: lat.nRows }, () => new Array(lat.years.length).fill(0));
    const yearMin = new Array(lat.years.length).fill(0);
    const yearAll = new Array(lat.years.length).fill(0);
    const edges = { first: newEdgeStats(), last: newEdgeStats(), tofMin: newEdgeStats(), tofMax: newEdgeStats() };
    let anyEdge = 0, multipleEdges = 0;
    const altGaps = [];
    let altWith = 0, altWithout = 0;
    const basinRules = [DEFAULT_BASIN_RULE].concat(opts.basinRules || []);
    const basinHist = basinRules.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }));
    const dates = new Set(), tofs = new Set();
    let windowsChecked = 0, violations = 0;
    const violationExamples = [];
    let firstSeen = null, lastSeen = null, minTofSeen = null, maxTofSeen = null;
    let minimumNotFirst = 0, summaryMismatch = 0, unsorted = 0, windowCountOther = 0;
    const byStatus = {};
    let withWindows = 0, coOrbital = 0;
    const withoutWindows = [];
    let tailAfter = 0, tailOn = 0, tailAnyAfter = 0;
    const tables = {
      byClass: new Map(), byH: new Map(), bySynodic: new Map(), byPha: new Map(), byCoOrbital: new Map(),
    };
    let catalogMisses = 0;
    const bump = (map, key, flags) => {
      if (!map.has(key)) map.set(key, newTableRow(key));
      const row = map.get(key);
      row.n += 1;
      if (flags.any) row.any += 1;
      for (const k of EDGE_KEYS) if (flags[k]) row[k] += 1;
    };

    for (const body of cache.bodies) {
      byStatus[body.status] = (byStatus[body.status] || 0) + 1;
      if (body.isCoOrbital) coOrbital += 1;
      const windows = Array.isArray(body.bestWindows) ? body.bestWindows : [];
      if (!windows.length) {
        const a = asteroids ? asteroids[body.bodyId] : null;
        withoutWindows.push({ bodyId: body.bodyId, designation: body.designation, status: body.status, orbitClass: a ? a.orbitClass || a.class || null : null, H: a ? (Number.isFinite(a.H) ? a.H : null) : null, hBand: a ? hBand(a.H) : null });
        continue;
      }
      withWindows += 1;
      if (windows.length !== 5) windowCountOther += 1;
      const cells = windows.map((w) => cellOf(w, lat));
      cells.forEach((c, i) => {
        windowsChecked += 1;
        const w = windows[i];
        dates.add(w.launchDate);
        tofs.add(w.tofDays);
        if (firstSeen === null || w.launchDate < firstSeen) firstSeen = w.launchDate;
        if (lastSeen === null || w.launchDate > lastSeen) lastSeen = w.launchDate;
        if (minTofSeen === null || w.tofDays < minTofSeen) minTofSeen = w.tofDays;
        if (maxTofSeen === null || w.tofDays > maxTofSeen) maxTofSeen = w.tofDays;
        if (!c.onLattice) {
          violations += 1;
          if (violationExamples.length < 10) violationExamples.push({ bodyId: body.bodyId, window: w, violations: c.violations });
          return;
        }
        perColAll[c.col] += 1;
        perRowAll[c.row] += 1;
        const yi = yearIndex(lat, colYear(lat, c.col));
        heatAll[c.row][yi] += 1;
        yearAll[yi] += 1;
      });
      if (viewEnd && windows.some((w) => w.launchDate > viewEnd)) tailAnyAfter += 1;
      for (let i = 1; i < windows.length; i++) if (windows[i].c3 < windows[i - 1].c3) { unsorted += 1; break; }
      const min = argminC3(windows);
      // the cache's own summary fields should name the cheapest stored window
      if (min !== 0) minimumNotFirst += 1;
      if (!(windows[min].launchDate === body.minC3Date && windows[min].tofDays === body.minC3TofDays && windows[min].c3 === body.minC3)) summaryMismatch += 1;
      const m = cells[min];
      if (!m.onLattice) continue;
      perColMin[m.col] += 1;
      perRowMin[m.row] += 1;
      const yi = yearIndex(lat, colYear(lat, m.col));
      heatMin[m.row][yi] += 1;
      yearMin[yi] += 1;
      if (viewEnd) {
        if (windows[min].launchDate > viewEnd) tailAfter += 1;
        else if (windows[min].launchDate === viewEnd) tailOn += 1;
      }
      const ev = edgeEvidence(windows, lat);
      const flags = ev.flags;
      if (flags.any) anyEdge += 1;
      if (flags.count > 1) multipleEdges += 1;
      for (const e of ev.edges) {
        const s = edges[e.edge];
        s.touched += 1;
        s.chains[Math.min(e.chainLength, 5)] += 1;
        if (e.neighbourPresent) {
          s.neighbourPresent += 1;
          s.slopes.push(e.slopeC3PerCell);
        }
        if (e.chainLength >= 3) {
          s.chains3plus += 1;
          if (e.monotone) s.monotone3plus += 1;
          else s.nonMonotone3plus += 1;
        }
        if (e.verdict === 'undetermined') s.undetermined += 1;
      }
      basinRules.forEach((rule, ri) => {
        const b = basins(windows, lat, rule);
        basinHist[ri][Math.min(b.count, 5)] += 1;
      });
      if (flags.any) {
        // an interior alternative: a stored window outside the minimum's basin that is itself on no edge
        const b = basins(windows, lat, DEFAULT_BASIN_RULE);
        let bestAlt = null;
        windows.forEach((w, i) => {
          if (b.labels[i] === b.labels[min]) return;
          if (!cells[i].onLattice || edgeFlags(cells[i], lat).any) return;
          if (bestAlt === null || w.c3 < bestAlt) bestAlt = w.c3;
        });
        if (bestAlt === null) altWithout += 1;
        else {
          altWith += 1;
          altGaps.push(bestAlt - windows[min].c3);
        }
      }
      // catalog join
      if (asteroids) {
        const a = asteroids[body.bodyId];
        if (!a) catalogMisses += 1;
        else {
          bump(tables.byClass, a.orbitClass || a.class || 'unknown', flags);
          bump(tables.byH, hBand(a.H), flags);
          bump(tables.byPha, a.pha ? 'PHA' : 'not PHA', flags);
          if (auKm !== null) bump(tables.bySynodic, synodicBand(synodicYears(a.elements && a.elements.aKm, auKm)), flags);
        }
      }
      bump(tables.byCoOrbital, body.isCoOrbital ? 'co-orbital (cache flag)' : 'not co-orbital', flags);
    }

    // interior baseline: columns outside the first and last calendar years
    const firstY = lat.years[0], lastY = lat.years[lat.years.length - 1];
    const interiorCols = perColMin.slice(firstY.cols, lat.nCols - lastY.cols);
    const interiorYears = yearMin.slice(1, -1);
    const interior = {
      excludedYears: [firstY.year, lastY.year],
      cols: interiorCols.length,
      medianPerCol: median(interiorCols),
      meanPerCol: mean(interiorCols),
      minPerCol: interiorCols.length ? Math.min.apply(null, interiorCols) : null,
      maxPerCol: interiorCols.length ? Math.max.apply(null, interiorCols) : null,
      medianPerYear: median(interiorYears),
      // how many times the interior per-column median the two edge columns and the two edge years carry
      firstColRatio: interiorCols.length ? perColMin[0] / median(interiorCols) : null,
      lastColRatio: interiorCols.length ? perColMin[lat.nCols - 1] / median(interiorCols) : null,
      firstYearRatio: interiorYears.length ? yearMin[0] / (median(interiorYears) * firstY.cols / median(lat.years.slice(1, -1).map((y) => y.cols))) : null,
      lastYearRatio: interiorYears.length ? yearMin[yearMin.length - 1] / (median(interiorYears) * lastY.cols / median(lat.years.slice(1, -1).map((y) => y.cols))) : null,
    };

    const edgeOut = {};
    for (const k of EDGE_KEYS) {
      const s = edges[k];
      edgeOut[k] = {
        cell: k === 'first' ? `column 0, ${lat.firstDepartureUtc}` : k === 'last' ? `column ${lat.nCols - 1}, ${lat.lastDepartureUtc}` : k === 'tofMin' ? `row 0, ${lat.tofMinDays} days` : `row ${lat.nRows - 1}, ${lat.lastTofDays} days`,
        touched: s.touched,
        shareOfBodies: share(s.touched, withWindows),
        likelyClipped: s.touched - s.undetermined,
        undetermined: s.undetermined,
        neighbourPresent: s.neighbourPresent,
        chains: s.chains,
        chains3plus: s.chains3plus,
        monotone3plus: s.monotone3plus,
        nonMonotone3plus: s.nonMonotone3plus,
        slopeC3PerCell: s.slopes.length ? { n: s.slopes.length, median: median(s.slopes), min: Math.min.apply(null, s.slopes), max: Math.max.apply(null, s.slopes), unit: 'km²/s² per lattice step inward' } : null,
      };
    }

    const tableOut = (map, order) => {
      const rows = [...map.values()].map(finishRow);
      if (order) rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      else rows.sort((a, b) => b.n - a.n);
      return rows;
    };

    const sampleIds = Array.isArray(opts.sampleIds) ? opts.sampleIds : [];
    const sampleWhy = opts.sampleWhy && typeof opts.sampleWhy === 'object' ? opts.sampleWhy : {};
    const sample = sampleIds.map((id) => {
      const why = typeof sampleWhy[id] === 'string' ? sampleWhy[id] : null;
      const body = cache.bodies.find((b) => b.bodyId === id);
      if (!body) return { bodyId: id, why, refusal: refuse('not_found', `no body ${id} in the cache`, 'a bodyId present in bodies[]').refusal };
      return Object.assign(sampleBody(body, lat, asteroids ? asteroids[id] : null, auKm), { why });
    });

    return {
      schema: SCHEMA,
      inputs: opts.inputs || null,
      lattice: lat,
      gridSentence: describeGrid(lat),
      verification: {
        windowsChecked,
        violations,
        violationExamples,
        distinctLaunchDates: dates.size,
        distinctTofDays: tofs.size,
        firstDepartureSeen: firstSeen,
        lastDepartureSeen: lastSeen,
        minTofSeen,
        maxTofSeen,
        everyColumnUsed: dates.size === lat.nCols,
        totalSolvesMetadata: cache.metadata.totalSolves,
        totalSolvesFromLattice: lat.cellsPerBody * withWindows,
        totalSolvesMatch: cache.metadata.totalSolves === lat.cellsPerBody * withWindows,
        catalogSizeMetadata: cache.metadata.catalogSize,
        bodiesListed: cache.bodies.length,
        cheapestIsFirstWindowViolations: minimumNotFirst,
        minC3SummaryMismatches: summaryMismatch,
        windowsNotAscendingViolations: unsorted,
        bodiesWithOtherThanFiveWindows: windowCountOther,
        catalogMisses,
      },
      bodies: { total: cache.bodies.length, withWindows, withoutWindows, byStatus, coOrbital },
      years: lat.years.map((y, i) => ({ year: y.year, cols: y.cols, minima: yearMin[i], allWindows: yearAll[i], minimaPerCol: yearMin[i] / y.cols })),
      perColumn: { minima: perColMin, allWindows: perColAll },
      perRow: { tofDays: perRowMin.map((_, r) => rowTof(lat, r)), minima: perRowMin, allWindows: perRowAll },
      heat: { years: lat.years.map((y) => y.year), tofDays: perRowMin.map((_, r) => rowTof(lat, r)), minima: heatMin, allWindows: heatAll },
      interior,
      edges: { byEdge: edgeOut, any: anyEdge, anyShare: share(anyEdge, withWindows), multiple: multipleEdges },
      interiorAlternative: { ofEdgeBodies: anyEdge, withAlternative: altWith, without: altWithout, gapC3: altGaps.length ? { median: median(altGaps), min: Math.min.apply(null, altGaps), max: Math.max.apply(null, altGaps), unit: 'km²/s² above the edge minimum' } : null },
      basins: basinRules.map((rule, i) => ({ rule, histogram: basinHist[i] })),
      viewTail: viewEnd
        ? { depEndUtc: viewEnd, source: opts.viewGrid, minimaAfter: tailAfter, minimaOn: tailOn, anyWindowAfter: tailAnyAfter, shareOfBodies: share(tailAfter, withWindows) }
        : refuse('insufficient_data', 'the porkchop view\'s last departure date was not supplied', 'GRID_PARAMS.depEndJD from src/v2/app/porkchop/main.ts, read from the checkout'),
      tables: {
        byClass: asteroids ? tableOut(tables.byClass) : refuse('insufficient_data', 'no catalog was supplied', 'tests/fixtures/v2/nea-catalog-slice9.json'),
        byH: asteroids ? tableOut(tables.byH, H_BANDS) : refuse('insufficient_data', 'no catalog was supplied', 'tests/fixtures/v2/nea-catalog-slice9.json'),
        bySynodic: asteroids && auKm !== null ? tableOut(tables.bySynodic, SYNODIC_BANDS) : refuse('insufficient_data', asteroids ? 'the AU in km was not supplied' : 'no catalog was supplied', 'AU_KM from precompute-lambert-screen.mjs and the catalog'),
        byPha: asteroids ? tableOut(tables.byPha, ['PHA', 'not PHA']) : refuse('insufficient_data', 'no catalog was supplied', 'tests/fixtures/v2/nea-catalog-slice9.json'),
        byCoOrbital: tableOut(tables.byCoOrbital, ['co-orbital (cache flag)', 'not co-orbital']),
      },
      sample,
    };
  }

  // Everything the page's inspector and the tests need about one body, recomputed from its windows.
  function sampleBody(body, lat, catalogEntry, auKm) {
    const windows = Array.isArray(body.bestWindows) ? body.bestWindows : [];
    const out = {
      bodyId: body.bodyId,
      designation: body.designation,
      name: catalogEntry ? catalogEntry.name : null,
      status: body.status,
      minC3: body.minC3,
      minC3Date: body.minC3Date,
      minC3TofDays: body.minC3TofDays,
      isCoOrbital: !!body.isCoOrbital,
      orbitClass: catalogEntry ? catalogEntry.orbitClass : null,
      H: catalogEntry ? catalogEntry.H : null,
      hBand: catalogEntry ? hBand(catalogEntry.H) : null,
      synodicYears: null,
      windows: [],
      basins: null,
      evidence: null,
    };
    if (catalogEntry && auKm) {
      const S = synodicYears(catalogEntry.elements && catalogEntry.elements.aKm, auKm);
      out.synodicYears = isRefusal(S) ? null : S;
    }
    if (!windows.length) {
      out.refusal = refuse('insufficient_data', `${body.bodyId} has no stored windows (status ${body.status})`, 'a body the precompute could propagate; this one is excluded from every count').refusal;
      return out;
    }
    const b = basins(windows, lat, DEFAULT_BASIN_RULE);
    out.basins = b.count;
    out.windows = windows.map((w, i) => {
      const c = cellOf(w, lat);
      return {
        launchDate: w.launchDate,
        tofDays: w.tofDays,
        c3: w.c3,
        col: c.col,
        row: c.row,
        onLattice: c.onLattice,
        edges: c.onLattice ? EDGE_KEYS.filter((k) => edgeFlags(c, lat)[k]) : [],
        basin: b.labels[i],
      };
    });
    out.evidence = edgeEvidence(windows, lat);
    return out;
  }

  // Short labels for the verdicts (shared by page and CLI so wording cannot drift).
  const EDGE_NAMES = { first: 'first departure date', last: 'last departure date', tofMin: 'flight-time floor', tofMax: 'flight-time ceiling' };

  return {
    SCHEMA,
    REFUSAL_CODES,
    EDGE_KEYS,
    EDGE_NAMES,
    H_BANDS,
    SYNODIC_BANDS,
    DEFAULT_BASIN_RULE,
    refuse,
    isRefusal,
    parseUtcDate,
    daysBetween,
    addDays,
    fmtInt,
    median,
    lattice,
    colDate,
    rowTof,
    colYear,
    describeGrid,
    cellOf,
    edgeFlags,
    argminC3,
    basins,
    edgeEvidence,
    hBand,
    synodicYears,
    synodicBand,
    census,
    sampleBody,
  };
});
