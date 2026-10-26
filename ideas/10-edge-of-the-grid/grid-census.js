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
  const ratio = (n, d) => (d > 0 && Number.isFinite(n) ? n / d : null); // null, not NaN or Infinity, when the baseline is empty

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
  // A basin rule is a box (cells within maxColGap columns and maxRowGap rows) or, with arrival: true,
  // a box sheared along lines of constant arrival date: two cells are close when their arrival dates
  // (departure + flight time) differ by at most maxColGap departure steps and their rows by at most
  // maxRowGap. On this lattice one flight-time row is tofSpacing/departureSpacing departure columns
  // (30/7 ≈ 4.3), so a valley that runs along a constant arrival date steps about four columns per
  // row and a plain (2, 1) box splits it.
  function sameBasin(a, b, lat, r) {
    const dc = b.col - a.col, dr = b.row - a.row;
    if (Math.abs(dr) > r.maxRowGap) return false;
    if (r.arrival) return Math.abs(dc * lat.departureSpacingDays + dr * lat.tofSpacingDays) <= r.maxColGap * lat.departureSpacingDays;
    return Math.abs(dc) <= r.maxColGap;
  }
  function ruleOf(r) {
    const out = { maxColGap: r.maxColGap, maxRowGap: r.maxRowGap };
    if (r.arrival) out.arrival = true;
    return out;
  }
  // Basins are the connected components of the rule's relation (union–find), so the count does not
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
        if (sameBasin(cells[i], cells[j], lat, r)) parent[find(i)] = find(j);
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
    return { count: order.length, labels, rule: ruleOf(r) };
  }

  // The quadratic through three equally spaced values c0, c1, c2 at x = 0, 1, 2 (x counted in lattice
  // steps inward from the edge cell): f(x) = c0 + (c1 − c0 − k/2)·x + (k/2)·x², k = c2 − 2c1 + c0.
  // With k > 0 its vertex is at x* = 1/2 − (c1 − c0)/k; x* < 0 is beyond the edge, 0 ≤ x* < 1/2 is
  // inside the lattice within half a step of it (when c1 > c0 the vertex cannot be further in).
  // With k ≤ 0 the local model has no minimum on the inward side (straight or concave): it keeps
  // falling past the edge. [Likely] only under the stated local-quadratic model.
  function quadraticVertex(c0, c1, c2) {
    if (![c0, c1, c2].every(Number.isFinite)) return null;
    const k = c2 - 2 * c1 + c0;
    if (!(k > 0)) return { curvature: k, xSteps: null, position: 'none' };
    const x = 0.5 - (c1 - c0) / k;
    return { curvature: k, xSteps: x, position: x < 0 ? 'beyond' : 'inside' };
  }

  // For the cheapest window of a body: which edges it touches and what the other stored windows say
  // about the surface there. The precompute keeps each body's topN cheapest cells of the WHOLE lattice
  // (tools/build/precompute-lambert-screen.mjs, maybeInsertBestWindow), so the cheapest stored window
  // is the lattice minimum and every other solved cell costs at least as much: the sampled surface
  // falls toward an edge minimum by construction, and that alone says nothing about clipping.
  // What the windows add is how steeply it rises inward, one step along the same row (departure
  // edges) or column (flight-time edges):
  //   rise 'recorded' — the inward neighbour is among the stored windows: its C3 minus the minimum.
  //   rise 'bound'    — it is not, and the list is full (topN windows), so the neighbour cost at least
  //                     as much as the most expensive stored window: rise ≥ c3[max] − c3[min]. This
  //                     holds for every neighbour whose Lambert solve converged; the cache does not
  //                     record the cells where one failed, hence [Likely] rather than [Certain].
  //   rise 'none'     — neither (the list is short or topN was not supplied).
  // Which of the first two applies depends on how steep the rise is (a shallow rise lets the
  // neighbour into the five), so the split is not a ranking of evidence.
  // For a chain of three or more stored cells running inward, quadraticVertex() of the first three.
  function edgeEvidence(windows, lat, topN) {
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
    let maxC3 = -Infinity;
    for (const w of windows) if (Number.isFinite(w.c3) && w.c3 > maxC3) maxC3 = w.c3;
    const listFull = isPosInt(topN) && windows.length === topN;
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
      let rise;
      if (neighbourPresent) rise = { kind: 'recorded', value: chain[1] - chain[0] };
      else if (listFull) rise = { kind: 'bound', atLeast: maxC3 - windows[min].c3 };
      else rise = { kind: 'none', reason: isPosInt(topN) ? `the body stores ${windows.length} windows, not the full ${topN}` : 'the precompute\'s window-list length was not supplied' };
      edges.push({
        edge: key,
        cell: key === 'first' || key === 'last' ? `column ${m.col} (${colDate(lat, m.col)})` : `row ${m.row} (${rowTof(lat, m.row)} days)`,
        neighbourPresent,
        rise,
        chain,
        chainLength: chain.length,
        monotone,
        vertex: chain.length >= 3 ? quadraticVertex(chain[0], chain[1], chain[2]) : null,
      });
    }
    return { hasMinimum: true, minimumOnLattice: true, minIndex: min, cell: { col: m.col, row: m.row }, flags, listFull, edges };
  }

  // The constant-arrival-date offsets one flight-time row away: tofSpacing/departureSpacing columns
  // (30/7 ≈ 4.3 here), widened to whole columns floor − 1 … ceil + 1 (3 … 6 here).
  function arrivalOffsets(lat) {
    const rho = lat.tofSpacingDays / lat.departureSpacingDays;
    return { columnsPerRow: rho, lo: Math.max(1, Math.floor(rho) - 1), hi: Math.ceil(rho) + 1 };
  }

  // A probe below the flight-time floor that follows the constant-arrival-date line: the rowsBelow
  // flight times under the floor, at the minimum's departure date and the next ceil(rowsBelow·rho)
  // dates (a flight one row shorter arrives on the same date when it departs rho columns later).
  function floorProbe(lat, nBodies, rowsBelow) {
    const k = isPosInt(rowsBelow) ? rowsBelow : 2;
    const tofs = [];
    for (let i = 1; i <= k; i++) tofs.push(lat.tofMinDays - i * lat.tofSpacingDays);
    if (tofs[tofs.length - 1] <= 0) return refuse('out_of_envelope', `${k} rows below the floor is a flight time of ${tofs[tofs.length - 1]} days`, 'fewer rows below the floor');
    const colsAhead = Math.ceil(k * arrivalOffsets(lat).columnsPerRow);
    const perBody = k * (colsAhead + 1);
    return { tofs, colsAhead, departures: colsAhead + 1, perBody, bodies: nBodies, total: perBody * nBodies };
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
    return { touched: 0, neighbourPresent: 0, riseNone: 0, chains: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, chains3plus: 0, monotone3plus: 0, nonMonotone3plus: 0, recorded: [], bounds: [], vertex: { beyond: 0, inside: 0, none: 0 }, arrival: [], anyInwardRow: 0 };
  }
  const stats = (xs, unit) => (xs.length ? { n: xs.length, median: median(xs), min: Math.min.apply(null, xs), max: Math.max.apply(null, xs), unit } : null);
  function newTableRow(key) {
    return { key, n: 0, any: 0, first: 0, last: 0, tofMin: 0, tofMax: 0 };
  }
  function finishRow(row) {
    row.share = share(row.any, row.n);
    return row;
  }

  // cache: parsed lambert-screen-cache.json. catalog: parsed nea-catalog-slice9.json or null.
  // options: { viewGrid: {depEndUtc, …} | null, auKm: number | null, topN: number | null (how many
  //            windows the precompute keeps per body), sampleIds: [bodyId…], sampleWhy: {bodyId: text},
  //            basinRules: [{maxColGap,maxRowGap[,arrival]}…] (alternates to report), inputs: {…} (recorded as is) }
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
    const topN = isPosInt(opts.topN) ? opts.topN : null;
    const viewEnd = opts.viewGrid && !Number.isNaN(parseUtcDate(opts.viewGrid.depEndUtc)) ? opts.viewGrid.depEndUtc : null;
    const arrOff = arrivalOffsets(lat);

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
    let anyEdge = 0, multipleEdges = 0, listFull = 0;
    const basinRules = [DEFAULT_BASIN_RULE].concat(opts.basinRules || []);
    const basinHist = basinRules.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }));
    const alt = basinRules.map(() => ({ withAlternative: 0, without: 0, gaps: [] }));
    const dates = new Set(), tofs = new Set();
    let windowsChecked = 0, violations = 0;
    const violationExamples = [];
    let firstSeen = null, lastSeen = null, minTofSeen = null, maxTofSeen = null;
    let minimumNotFirst = 0, summaryMismatch = 0, unsorted = 0;
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
        const el = a && a.elements && typeof a.elements === 'object' ? a.elements : null;
        const num = (x) => (Number.isFinite(x) ? x : null);
        withoutWindows.push({
          bodyId: body.bodyId, designation: body.designation, status: body.status,
          orbitClass: a ? a.orbitClass || a.class || null : null, H: a ? (Number.isFinite(a.H) ? a.H : null) : null, hBand: a ? hBand(a.H) : null,
          // the catalog's elements as recorded (null where the catalog has none), so a reader can see why
          elements: el ? { aKm: num(el.aKm), e: num(el.e), maRad: num(el.maRad) } : null,
        });
        continue;
      }
      withWindows += 1;
      if (topN !== null && windows.length === topN) listFull += 1;
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
      const ev = edgeEvidence(windows, lat, topN);
      const flags = ev.flags;
      if (flags.any) anyEdge += 1;
      if (flags.count > 1) multipleEdges += 1;
      for (const e of ev.edges) {
        const s = edges[e.edge];
        s.touched += 1;
        s.chains[Math.min(e.chainLength, 5)] += 1;
        if (e.neighbourPresent) s.neighbourPresent += 1;
        if (e.rise.kind === 'recorded') s.recorded.push(e.rise.value);
        else if (e.rise.kind === 'bound') s.bounds.push(e.rise.atLeast);
        else s.riseNone += 1;
        if (e.chainLength >= 3) {
          s.chains3plus += 1;
          if (e.monotone) s.monotone3plus += 1;
          else s.nonMonotone3plus += 1;
          if (e.vertex) s.vertex[e.vertex.position] += 1;
        }
        if (e.edge === 'tofMin' || e.edge === 'tofMax') {
          // one row inward, along the constant-arrival-date line: earlier departures above the floor,
          // later departures below the ceiling
          const inRow = e.edge === 'tofMin' ? m.row + 1 : m.row - 1;
          const sign = e.edge === 'tofMin' ? -1 : 1;
          let best = null, anyRow = false;
          cells.forEach((c, i) => {
            if (i === min || !c.onLattice || c.row !== inRow) return;
            anyRow = true;
            const off = (c.col - m.col) * sign;
            if (off >= arrOff.lo && off <= arrOff.hi && (best === null || windows[i].c3 < best)) best = windows[i].c3;
          });
          if (anyRow) s.anyInwardRow += 1;
          if (best !== null) s.arrival.push(best - windows[min].c3);
        }
      }
      basinRules.forEach((rule, ri) => {
        const b = basins(windows, lat, rule);
        basinHist[ri][Math.min(b.count, 5)] += 1;
        if (flags.any) {
          // another stored window outside the minimum's basin (under this rule) that is itself on no edge
          let bestAlt = null;
          windows.forEach((w, i) => {
            if (b.labels[i] === b.labels[min]) return;
            if (!cells[i].onLattice || edgeFlags(cells[i], lat).any) return;
            if (bestAlt === null || w.c3 < bestAlt) bestAlt = w.c3;
          });
          if (bestAlt === null) alt[ri].without += 1;
          else {
            alt[ri].withAlternative += 1;
            alt[ri].gaps.push(bestAlt - windows[min].c3);
          }
        }
      });
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

    // interior baseline: columns outside the first and last calendar years (refused when the lattice
    // spans fewer than three calendar years, so that no interior year exists)
    const firstY = lat.years[0], lastY = lat.years[lat.years.length - 1];
    let interior;
    if (lat.years.length < 3) {
      interior = refuse('insufficient_data', `the lattice spans ${lat.years.length} calendar year${lat.years.length === 1 ? '' : 's'}, so no interior year exists to compare the edges with`, 'a screening window covering at least three calendar years');
    } else {
      const interiorCols = perColMin.slice(firstY.cols, lat.nCols - lastY.cols);
      const interiorYears = yearMin.slice(1, -1);
      const medCols = median(lat.years.slice(1, -1).map((y) => y.cols));
      interior = {
        excludedYears: [firstY.year, lastY.year],
        cols: interiorCols.length,
        medianPerCol: median(interiorCols),
        meanPerCol: mean(interiorCols),
        minPerCol: Math.min.apply(null, interiorCols),
        maxPerCol: Math.max.apply(null, interiorCols),
        medianPerYear: median(interiorYears),
        // how many times the interior per-column median the two edge columns and the two edge years carry
        firstColRatio: ratio(perColMin[0], median(interiorCols)),
        lastColRatio: ratio(perColMin[lat.nCols - 1], median(interiorCols)),
        firstYearRatio: ratio(yearMin[0], (median(interiorYears) * firstY.cols) / medCols),
        lastYearRatio: ratio(yearMin[yearMin.length - 1], (median(interiorYears) * lastY.cols) / medCols),
      };
    }

    // Each edge against the lines just inside it. The edges differ in length (a departure edge is one
    // column of nRows cells, a flight-time edge one row of nCols cells), so raw counts do not compare;
    // minima per edge cell and the counts on the next three lines inward do.
    const lineCounts = (k) => {
      const out = [];
      for (let d = 0; d < 4; d++) {
        if (k === 'first') out.push(d < lat.nCols ? perColMin[d] : null);
        else if (k === 'last') out.push(lat.nCols - 1 - d >= 0 ? perColMin[lat.nCols - 1 - d] : null);
        else if (k === 'tofMin') out.push(d < lat.nRows ? perRowMin[d] : null);
        else out.push(lat.nRows - 1 - d >= 0 ? perRowMin[lat.nRows - 1 - d] : null);
      }
      return out;
    };
    const edgeOut = {};
    for (const k of EDGE_KEYS) {
      const s = edges[k];
      const cellsOnEdge = k === 'first' || k === 'last' ? lat.nRows : lat.nCols;
      const lines = lineCounts(k);
      edgeOut[k] = {
        cell: k === 'first' ? `column 0, ${lat.firstDepartureUtc}` : k === 'last' ? `column ${lat.nCols - 1}, ${lat.lastDepartureUtc}` : k === 'tofMin' ? `row 0, ${lat.tofMinDays} days` : `row ${lat.nRows - 1}, ${lat.lastTofDays} days`,
        touched: s.touched,
        shareOfBodies: share(s.touched, withWindows),
        cellsOnEdge,
        minimaPerEdgeCell: s.touched / cellsOnEdge,
        // minima on the edge line and on the next three lines inward (same orientation)
        inwardLines: lines,
        // > 1: more minima on the edge than on the next line in (a pile-up); < 1: fewer
        edgeOverNextLine: lines[1] ? lines[0] / lines[1] : null,
        neighbourPresent: s.neighbourPresent,
        riseRecorded: stats(s.recorded, 'km²/s² from the edge minimum to the stored inward neighbour'),
        riseBound: stats(s.bounds, 'km²/s²; the inward neighbour is not among the stored windows, so its rise is at least the spread of the stored windows'),
        riseNone: s.riseNone,
        chains: s.chains,
        chains3plus: s.chains3plus,
        monotone3plus: s.monotone3plus,
        nonMonotone3plus: s.nonMonotone3plus,
        vertex: s.vertex,
        arrivalLine: k === 'tofMin' || k === 'tofMax'
          ? { columnsPerRow: arrOff.columnsPerRow, offsets: [arrOff.lo, arrOff.hi], direction: k === 'tofMin' ? 'earlier departures one row up' : 'later departures one row down', anyInwardRow: s.anyInwardRow, withWindow: s.arrival.length, rise: stats(s.arrival, 'km²/s² from the edge minimum to the cheapest stored window on that line') }
          : null,
      };
    }
    const allRec = [], allBound = [];
    for (const k of EDGE_KEYS) {
      allRec.push(...edges[k].recorded);
      allBound.push(...edges[k].bounds);
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
      return Object.assign(sampleBody(body, lat, asteroids ? asteroids[id] : null, auKm, topN), { why });
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
        windowsKeptPerBody: topN,
        bodiesWithFullList: topN === null ? null : listFull,
        catalogMisses,
      },
      bodies: { total: cache.bodies.length, withWindows, withoutWindows, byStatus, coOrbital },
      years: lat.years.map((y, i) => ({ year: y.year, cols: y.cols, minima: yearMin[i], allWindows: yearAll[i], minimaPerCol: yearMin[i] / y.cols })),
      perColumn: { minima: perColMin, allWindows: perColAll },
      perRow: { tofDays: perRowMin.map((_, r) => rowTof(lat, r)), minima: perRowMin, allWindows: perRowAll },
      heat: { years: lat.years.map((y) => y.year), tofDays: perRowMin.map((_, r) => rowTof(lat, r)), minima: heatMin, allWindows: heatAll },
      interior,
      edges: {
        byEdge: edgeOut, any: anyEdge, anyShare: share(anyEdge, withWindows), multiple: multipleEdges,
        riseRecorded: stats(allRec, 'km²/s²'), riseBound: stats(allBound, 'km²/s² (lower bounds)'),
        vertex: EDGE_KEYS.reduce((o, k) => ({ beyond: o.beyond + edges[k].vertex.beyond, inside: o.inside + edges[k].vertex.inside, none: o.none + edges[k].vertex.none }), { beyond: 0, inside: 0, none: 0 }),
        chains3plus: EDGE_KEYS.reduce((n, k) => n + edges[k].chains3plus, 0),
      },
      interiorAlternative: {
        ofEdgeBodies: anyEdge,
        byRule: basinRules.map((rule, i) => ({ rule: ruleOf(rule), withAlternative: alt[i].withAlternative, without: alt[i].without, gapC3: stats(alt[i].gaps, 'km²/s² above the edge minimum') })),
      },
      basins: basinRules.map((rule, i) => ({ rule: ruleOf(rule), histogram: basinHist[i] })),
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
  function sampleBody(body, lat, catalogEntry, auKm, topN) {
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
      const el = catalogEntry && catalogEntry.elements;
      const hyperbolic = el && ((Number.isFinite(el.e) && el.e >= 1) || (Number.isFinite(el.aKm) && el.aKm <= 0));
      out.refusal = hyperbolic
        ? refuse('insufficient_data', `${body.bodyId} has no stored windows (status ${body.status}): the catalog gives e ${el.e.toFixed(4)} and a ${el.aKm.toExponential(4)} km, an open (hyperbolic) orbit, and the elliptic Kepler propagator the screen uses requires a > 0 and e < 1`, 'a hyperbolic or universal-variable propagator, or an explicit "not screened: hyperbolic orbit" state wherever the catalog shows a status; this body is excluded from every count').refusal
        : refuse('insufficient_data', `${body.bodyId} has no stored windows (status ${body.status})`, 'a body the precompute could propagate; this one is excluded from every count').refusal;
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
    out.evidence = edgeEvidence(windows, lat, topN);
    return out;
  }

  // Short labels (shared by page and CLI so wording cannot drift).
  const EDGE_NAMES = { first: 'first departure date', last: 'last departure date', tofMin: 'flight-time floor', tofMax: 'flight-time ceiling' };
  function describeRule(r, lat) {
    if (r.arrival) return `arrival dates within ${r.maxColGap} departure steps${lat ? ` (${r.maxColGap * lat.departureSpacingDays} days)` : ''} and ${r.maxRowGap} row${r.maxRowGap === 1 ? '' : 's'}`;
    return `within ${r.maxColGap} column${r.maxColGap === 1 ? '' : 's'} and ${r.maxRowGap} row${r.maxRowGap === 1 ? '' : 's'}`;
  }
  // One line about a single edge's rise, for the page's inspector and the CLI's sample list.
  function describeRise(e) {
    if (!e.rise) return '';
    const v = e.vertex;
    const vText = v ? (v.position === 'none' ? '; the three-cell quadratic has no minimum on the inward side' : `; three-cell quadratic vertex ${Math.abs(v.xSteps).toFixed(2)} step ${v.position === 'beyond' ? 'beyond the edge' : 'inside the lattice'}`) : '';
    if (e.rise.kind === 'recorded') return `inward rise +${e.rise.value.toFixed(3)} km²/s² (neighbour stored; chain of ${e.chainLength}${e.chainLength >= 3 ? (e.monotone ? ', rising at every step' : ', not rising at every step') : ''}${vText})`;
    if (e.rise.kind === 'bound') return `inward neighbour not among the stored windows: rise ≥ ${e.rise.atLeast.toFixed(3)} km²/s²`;
    return `no rise recorded or bounded (${e.rise.reason})`;
  }

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
    sameBasin,
    quadraticVertex,
    edgeEvidence,
    arrivalOffsets,
    floorProbe,
    describeRule,
    describeRise,
    hBand,
    synodicYears,
    synodicBand,
    census,
    sampleBody,
  };
});
