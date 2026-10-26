/*
 * Known Unknowns: the pure kernel. No DOM, no clock, no file access.
 * Loads as a classic script (window.KnownUnknowns) and with require() under Node.
 *
 * Every Aster constant this module uses arrives in a `constants` object that
 * known-unknowns.mjs read out of the Aster checkout with its file and line
 * (near-zero C3 threshold, colour-scale floor, first porkchop contour, the
 * screening threshold, the U >= 7 / U <= 2 bands). Nothing Aster-owned is typed
 * here. The band edges in OURS are this study's own choices and are labelled
 * as ours wherever they are shown.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KnownUnknowns = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- our bands
  // [Ours] Data-arc bin starts in days. 30 is the list criterion; 1000 is where
  // the catalog's qualityRank arc score saturates (log10(1 + d) / log10(1001)).
  var ARC_EDGES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90, 180, 365, 1000, 3653];
  // [Ours] Coarse arc rows for the cross-tab: each start must be one of ARC_EDGES.
  var ARC_GROUP_STARTS = [0, 1, 7, 30, 365, 1000, 3653];
  // [Ours] Observations-used bin starts.
  var NOBS_EDGES = [0, 10, 20, 50, 100, 1000];
  // [Ours] Absolute-magnitude band edges: < 18, [18, 20), ..., >= 26.
  var H_EDGES = [18, 20, 22, 24, 26];
  // [Ours] The list's arc criterion: data arc shorter than this many days, or not reported.
  var LIST_ARC_BELOW_DAYS = 30;

  var OURS = {
    arcEdgesDays: ARC_EDGES,
    arcGroupStarts: ARC_GROUP_STARTS,
    nObsEdges: NOBS_EDGES,
    hEdges: H_EDGES,
    listArcBelowDays: LIST_ARC_BELOW_DAYS,
  };

  var N_U = 11; // U = 0..9, index 10 = not reported
  var U_NULL = 10;
  var N_C3 = 6; // see c3Band
  var C3_NONE = 5;
  var C3_HIGH = 4;
  var LOW_BANDS = [0, 1, 2, 3];

  function isNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
  }

  // ---------------------------------------------------------------- binning
  /*
   * C3 band of a body's minimum departure C3 (km^2/s^2), with Aster's edges:
   *   0  c3 <  nearZero              near-zero flag (strict <, as isNearZeroC3Degenerate)
   *   1  nearZero <= c3 < colorMin
   *   2  colorMin <= c3 < firstContour
   *   3  firstContour <= c3 <= feasibleMax   (<=, as the precompute's low_departure_c3 test)
   *   4  c3 > feasibleMax                    high_departure_c3
   *   5  no value                            no converged solve
   */
  function c3Band(c3, k) {
    if (!isNum(c3)) return C3_NONE;
    if (c3 < k.nearZeroC3) return 0;
    if (c3 < k.c3ColorMin) return 1;
    if (c3 < k.c3FirstContour) return 2;
    if (c3 <= k.feasibleC3Max) return 3;
    return C3_HIGH;
  }

  function c3BandLabels(k) {
    return [
      'below ' + k.nearZeroC3 + ' (near-zero flag)',
      k.nearZeroC3 + '–' + k.c3ColorMin,
      k.c3ColorMin + '–' + k.c3FirstContour,
      k.c3FirstContour + '–' + k.feasibleC3Max,
      'above ' + k.feasibleC3Max,
      'no solution',
    ];
  }

  function c3BandShortLabels(k) {
    return ['< ' + k.nearZeroC3 + ' flag', k.nearZeroC3 + '\u2013' + k.c3ColorMin, k.c3ColorMin + '\u2013' + k.c3FirstContour, k.c3FirstContour + '\u2013' + k.feasibleC3Max, '> ' + k.feasibleC3Max, 'none'];
  }

  function uIndex(u) {
    if (u === null || u === undefined) return U_NULL;
    if (!Number.isInteger(u) || u < 0 || u > 9) throw new Error('condition code out of range: ' + u);
    return u;
  }

  // Index of the bin whose start is the largest edge <= v; null -> edges.length.
  function binIndex(v, edges) {
    if (v === null || v === undefined) return edges.length;
    if (!isNum(v)) throw new Error('not a number: ' + v);
    if (v < edges[0]) throw new Error('below the first bin: ' + v);
    var k = 0;
    while (k + 1 < edges.length && v >= edges[k + 1]) k++;
    return k;
  }

  // H bands: < H_EDGES[0] -> 0, ..., >= last -> H_EDGES.length, null -> H_EDGES.length + 1.
  function hIndex(h) {
    if (h === null || h === undefined) return H_EDGES.length + 1;
    if (!isNum(h)) throw new Error('H not a number: ' + h);
    var k = 0;
    while (k < H_EDGES.length && h >= H_EDGES[k]) k++;
    return k;
  }

  function zeros3(a, b, c) {
    var out = [];
    for (var i = 0; i < a; i++) {
      var r = [];
      for (var j = 0; j < b; j++) {
        var s = [];
        for (var m = 0; m < c; m++) s.push(0);
        r.push(s);
      }
      out.push(r);
    }
    return out;
  }

  /*
   * rows: [{ u, arc, nObs, H, c3 }]. Returns three dense histograms, each
   * [c3Band][uIndex][third], whose [c3Band][uIndex] marginals are identical.
   */
  function buildHistograms(rows, k) {
    var byArc = zeros3(N_C3, N_U, ARC_EDGES.length + 1);
    var byObs = zeros3(N_C3, N_U, NOBS_EDGES.length + 1);
    var byH = zeros3(N_C3, N_U, H_EDGES.length + 2);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var b = c3Band(r.c3, k);
      var u = uIndex(r.u);
      byArc[b][u][binIndex(r.arc, ARC_EDGES)]++;
      byObs[b][u][binIndex(r.nObs, NOBS_EDGES)]++;
      byH[b][u][hIndex(r.H)]++;
    }
    return { byArc: byArc, byObs: byObs, byH: byH };
  }

  function sum3(h) {
    var s = 0;
    for (var i = 0; i < h.length; i++) for (var j = 0; j < h[i].length; j++) for (var m = 0; m < h[i][j].length; m++) s += h[i][j][m];
    return s;
  }

  // [c3Band][uIndex] marginal of any of the three histograms.
  function c3ByU(h) {
    var out = [];
    for (var b = 0; b < h.length; b++) {
      var row = [];
      for (var u = 0; u < h[b].length; u++) {
        var s = 0;
        for (var m = 0; m < h[b][u].length; m++) s += h[b][u][m];
        row.push(s);
      }
      out.push(row);
    }
    return out;
  }

  // Per-U totals (index 10 = not reported) and per-band totals.
  function uMarginal(h) {
    var m = c3ByU(h);
    var out = [];
    for (var u = 0; u < N_U; u++) {
      var s = 0;
      for (var b = 0; b < m.length; b++) s += m[b][u];
      out.push(s);
    }
    return out;
  }

  function c3Marginal(h) {
    return c3ByU(h).map(function (r) {
      return r.reduce(function (a, x) {
        return a + x;
      }, 0);
    });
  }

  // ---------------------------------------------------------------- cross-tabs
  function arcGroupOf(binIdx) {
    // which coarse group a fine arc bin belongs to (null bin -> ARC_GROUP_STARTS.length)
    if (binIdx === ARC_EDGES.length) return ARC_GROUP_STARTS.length;
    var start = ARC_EDGES[binIdx];
    var g = 0;
    while (g + 1 < ARC_GROUP_STARTS.length && start >= ARC_GROUP_STARTS[g + 1]) g++;
    return g;
  }

  // Integer-valued bins (days, counts): [lo, next) is written lo–(next − 1).
  function rangeLabel(starts, i, unit) {
    var lo = starts[i];
    if (i + 1 < starts.length) {
      var hi = starts[i + 1] - 1;
      return (hi === lo ? String(lo) : lo + '–' + hi) + unit;
    }
    return '≥ ' + lo + unit;
  }

  function uLabel(i) {
    return i === U_NULL ? 'not reported' : 'U ' + i;
  }

  /*
   * One cross-tab view: rows are a quality dimension, columns are the six C3 bands.
   * view: 'U' | 'arc' | 'obs' | 'H'. Rows whose total is 0 and that are "not
   * reported" rows are dropped (every body reports nObsUsed, for instance).
   */
  function crossTab(hists, view) {
    var rows = [];
    var b, u, m;
    if (view === 'U') {
      var cu = c3ByU(hists.byArc);
      for (u = 0; u < N_U; u++) {
        var cells = [];
        for (b = 0; b < N_C3; b++) cells.push(cu[b][u]);
        rows.push({ key: u === U_NULL ? 'null' : String(u), label: uLabel(u), cells: cells, unknown: u === U_NULL });
      }
    } else if (view === 'arc') {
      var nG = ARC_GROUP_STARTS.length + 1;
      var acc = [];
      for (var g = 0; g < nG; g++) acc.push([0, 0, 0, 0, 0, 0]);
      for (b = 0; b < N_C3; b++)
        for (u = 0; u < N_U; u++)
          for (m = 0; m <= ARC_EDGES.length; m++) acc[arcGroupOf(m)][b] += hists.byArc[b][u][m];
      for (g = 0; g < nG; g++) {
        var unk = g === ARC_GROUP_STARTS.length;
        rows.push({ key: unk ? 'null' : String(ARC_GROUP_STARTS[g]), label: unk ? 'not reported' : rangeLabel(ARC_GROUP_STARTS, g, ' d'), cells: acc[g], unknown: unk });
      }
    } else if (view === 'obs' || view === 'H') {
      var h = view === 'obs' ? hists.byObs : hists.byH;
      var n3 = h[0][0].length;
      for (m = 0; m < n3; m++) {
        var c = [];
        for (b = 0; b < N_C3; b++) {
          var s = 0;
          for (u = 0; u < N_U; u++) s += h[b][u][m];
          c.push(s);
        }
        var unknown = m === n3 - 1;
        var label;
        if (unknown) label = 'not reported';
        else if (view === 'obs') label = rangeLabel(NOBS_EDGES, m, '');
        else if (m === 0) label = 'H < ' + H_EDGES[0];
        else if (m === H_EDGES.length) label = 'H ≥ ' + H_EDGES[H_EDGES.length - 1];
        else label = 'H ' + H_EDGES[m - 1] + '–' + H_EDGES[m];
        rows.push({ key: unknown ? 'null' : String(m), label: label, cells: c, unknown: unknown });
      }
    } else {
      throw new Error('unknown view ' + view);
    }
    rows.forEach(function (r) {
      r.total = r.cells.reduce(function (a, x) {
        return a + x;
      }, 0);
    });
    rows = rows.filter(function (r) {
      return !(r.unknown && r.total === 0);
    });
    var colTotals = [0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) {
      for (var i = 0; i < 6; i++) colTotals[i] += r.cells[i];
    });
    var grand = colTotals.reduce(function (a, x) {
      return a + x;
    }, 0);
    return { view: view, rows: rows, colTotals: colTotals, grandTotal: grand };
  }

  // ---------------------------------------------------------------- what-if filter
  /*
   * The "what-if filter": among bodies whose screening says low departure C3
   * (bands 0-3, near-zero included, as DEC-19-1 forbids dropping them), how many
   * have U at most u AND a data arc of at least ARC_EDGES[dIdx] days? Unknown U
   * or unknown arc can never be shown to pass, so they are counted apart.
   * Every body lands in exactly one of survive / dropU / dropArc / dropBoth /
   * unknownU / unknownArc.
   */
  function survivors(byArc, u, dIdx) {
    if (!Number.isInteger(u) || u < 0 || u > 9) throw new Error('u must be 0..9');
    if (!Number.isInteger(dIdx) || dIdx < 0 || dIdx >= ARC_EDGES.length) throw new Error('arc index out of range');
    var out = { u: u, arcMinDays: ARC_EDGES[dIdx], population: 0, survive: 0, dropU: 0, dropArc: 0, dropBoth: 0, unknownU: 0, unknownArc: 0, surviveByBand: [0, 0, 0, 0] };
    for (var bi = 0; bi < LOW_BANDS.length; bi++) {
      var b = LOW_BANDS[bi];
      for (var ui = 0; ui < N_U; ui++) {
        for (var ai = 0; ai <= ARC_EDGES.length; ai++) {
          var n = byArc[b][ui][ai];
          if (!n) continue;
          out.population += n;
          if (ui === U_NULL) {
            out.unknownU += n;
            continue;
          }
          if (ai === ARC_EDGES.length) {
            out.unknownArc += n;
            continue;
          }
          var uOk = ui <= u;
          var aOk = ai >= dIdx;
          if (uOk && aOk) {
            out.survive += n;
            out.surviveByBand[bi] += n;
          } else if (!uOk && aOk) out.dropU += n;
          else if (uOk && !aOk) out.dropArc += n;
          else out.dropBoth += n;
        }
      }
    }
    return out;
  }

  function survivorGrid(byArc) {
    var g = [];
    for (var u = 0; u <= 9; u++) {
      var row = [];
      for (var d = 0; d < ARC_EDGES.length; d++) row.push(survivors(byArc, u, d).survive);
      g.push(row);
    }
    return g;
  }

  // How many bodies meet the list criterion, counted from the histogram alone.
  function listCountFromHist(byArc, k) {
    var below = ARC_EDGES.indexOf(LIST_ARC_BELOW_DAYS);
    if (below < 0) throw new Error('list arc criterion is not a bin edge');
    var n = 0;
    for (var bi = 0; bi < LOW_BANDS.length; bi++)
      for (var u = k.uHighlyUncertainMin; u <= 9; u++) {
        for (var ai = 0; ai < below; ai++) n += byArc[LOW_BANDS[bi]][u][ai];
        n += byArc[LOW_BANDS[bi]][u][ARC_EDGES.length];
      }
    return n;
  }

  // ---------------------------------------------------------------- the list
  function inList(r, k) {
    if (r.u === null || r.u === undefined || r.u < k.uHighlyUncertainMin) return false;
    if (r.arc !== null && r.arc !== undefined && !(r.arc < LIST_ARC_BELOW_DAYS)) return false;
    var b = c3Band(r.c3, k);
    return b <= 3;
  }

  // Sort keys. Ties break on designation so the order is total and reproducible.
  var SORTS = {
    H: function (a, b) {
      var ah = isNum(a.H) ? a.H : Infinity;
      var bh = isNum(b.H) ? b.H : Infinity;
      return ah - bh || cmpStr(a.des, b.des);
    },
    c3: function (a, b) {
      return a.c3 - b.c3 || cmpStr(a.des, b.des);
    },
  };

  function cmpStr(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // The list ships as arrays under a column header; this turns one back into an object.
  var LIST_COLUMNS = ['des', 'name', 'cls', 'H', 'u', 'arc', 'nObs', 'launchDate', 'tofDays', 'c3', 'vInfArr', 'tier', 'subReason', 'encJd', 'encDate', 'coOrbital', 'pha', 'keplerUnsafe'];

  function rowFromArray(arr) {
    if (!Array.isArray(arr) || arr.length !== LIST_COLUMNS.length) throw new Error('list row has the wrong shape');
    var o = {};
    for (var i = 0; i < LIST_COLUMNS.length; i++) o[LIST_COLUMNS[i]] = arr[i];
    return o;
  }

  function rowToArray(o) {
    return LIST_COLUMNS.map(function (c) {
      return o[c] === undefined ? null : o[c];
    });
  }

  // ---------------------------------------------------------------- dates
  function jdFromIsoDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new Error('not an ISO date: ' + s);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 2440587.5;
  }

  function isoFromJd(jd) {
    return new Date(Math.round((jd - 2440587.5) * 86400000)).toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    return isoFromJd(jdFromIsoDate(iso) + n);
  }

  // The departure lattice the screening cache was computed on, from its metadata.
  function lattice(meta) {
    var start = jdFromIsoDate(meta.screeningWindow.startUtc);
    var end = jdFromIsoDate(meta.screeningWindow.endUtc);
    var cols = Math.floor((end - start) / meta.departureGridSpacingDays) + 1;
    var rows = Math.floor((meta.tofMaxDays - meta.tofMinDays) / meta.tofGridSpacingDays) + 1;
    return {
      firstDeparture: meta.screeningWindow.startUtc,
      lastDeparture: isoFromJd(start + (cols - 1) * meta.departureGridSpacingDays),
      columns: cols,
      tofFloor: meta.tofMinDays,
      tofCeiling: meta.tofMinDays + (rows - 1) * meta.tofGridSpacingDays,
      rows: rows,
    };
  }

  // Which lattice edges a window sits on (empty array when interior).
  function edgesOf(launchDate, tofDays, lat) {
    var e = [];
    if (tofDays === lat.tofFloor) e.push('floor');
    if (tofDays === lat.tofCeiling) e.push('ceiling');
    if (launchDate === lat.firstDeparture) e.push('first');
    if (launchDate === lat.lastDeparture) e.push('last');
    return e;
  }

  /*
   * Aster's DEC-18-7 support boundary: an L1 body's cell is unsupported when its
   * arrival (departure + TOF, TDB Julian dates) is at or after the encounter epoch
   * (src/v2/porkchop/support-boundary.ts, isArrivalAfterEncounter). The cache
   * stores the departure as the UTC calendar date of a grid epoch that is UTC
   * midnight, so its TDB Julian date is that midnight plus TDB - UTC
   * (k.tdbMinusUtcSeconds, read from Aster's core). The offset matters: the
   * closest arrival in the catalog lies under a minute from its encounter.
   */
  function arrivalAfterEncounter(launchDate, tofDays, encounterJd, k) {
    if (!isNum(encounterJd)) return null;
    if (!k || !isNum(k.tdbMinusUtcSeconds)) throw new Error('TDB - UTC offset missing');
    return jdFromIsoDate(launchDate) + k.tdbMinusUtcSeconds / 86400 + tofDays >= encounterJd;
  }

  /*
   * Flags for one listed row. row: { des, c3, launchDate, tofDays, encJd,
   * coOrbital, pha, keplerUnsafe }. Returns plain booleans/strings; the page
   * turns them into labelled badges (never colour alone).
   */
  function flagsFor(row, k, lat, asOf) {
    return {
      nearZero: isNum(row.c3) && row.c3 < k.nearZeroC3,
      past: row.launchDate < asOf,
      edges: edgesOf(row.launchDate, row.tofDays, lat),
      afterEncounter: arrivalAfterEncounter(row.launchDate, row.tofDays, row.encJd, k) === true,
      coOrbital: !!row.coOrbital,
      pha: !!row.pha,
      keplerUnsafe: !!row.keplerUnsafe,
    };
  }

  // ---------------------------------------------------------------- qualityRank
  function clamp01(x) {
    return Math.min(1, Math.max(0, x));
  }

  // The formula as nea-catalog-slice9.spec.md states it (three clamps).
  function qualityRankSpec(u, arc) {
    var conditionScore = u === null || u === undefined ? 0 : clamp01(1 - u / 9);
    var dataArcScore = arc === null || arc === undefined ? 0 : clamp01(Math.log10(1 + arc) / Math.log10(1001));
    return clamp01(0.6 * conditionScore + 0.4 * dataArcScore);
  }

  // The fixture's own catalog.qualityRankFormula string, read literally (one clamp).
  function qualityRankLiteral(u, arc) {
    return clamp01(0.6 * (u === null || u === undefined ? 0 : 1 - u / 9) + 0.4 * (arc === null || arc === undefined ? 0 : Math.log10(1 + arc) / Math.log10(1001)));
  }

  // ---------------------------------------------------------------- statistics
  // Average ranks (1-based), ties share their mean rank.
  function ranks(xs) {
    var idx = xs.map(function (v, i) {
      return [v, i];
    });
    idx.sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1];
    });
    var r = new Array(xs.length);
    var i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      var avg = (i + j) / 2 + 1;
      for (var m = i; m <= j; m++) r[idx[m][1]] = avg;
      i = j + 1;
    }
    return r;
  }

  // Spearman's rho as the Pearson correlation of average ranks.
  function spearman(xs, ys) {
    if (xs.length !== ys.length) throw new Error('length mismatch');
    var n = xs.length;
    if (n < 3) return null;
    var rx = ranks(xs);
    var ry = ranks(ys);
    var mx = (n + 1) / 2;
    var sxy = 0;
    var sxx = 0;
    var syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = rx[i] - mx;
      var dy = ry[i] - mx;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  function median(xs) {
    if (!xs.length) return null;
    var a = xs.slice().sort(function (p, q) {
      return p - q;
    });
    var h = a.length >> 1;
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }

  // U groups as Aster's compare page bands them (main.ts describeOrbitQuality).
  function uGroup(u, k) {
    if (u === null || u === undefined) return null;
    if (u <= k.uTightMax) return 'tight';
    if (u >= k.uHighlyUncertainMin) return 'uncertain';
    return 'moderate';
  }

  /*
   * The confounder table: for all bodies with a minimum C3, and then within each
   * H band, the median minC3 per U group and Spearman's rho of minC3 against U
   * and against the data arc. rows: [{ u, arc, H, c3 }].
   */
  function stratify(rows, k) {
    function summarise(list, label) {
      var groups = { tight: [], moderate: [], uncertain: [] };
      var uX = [];
      var uY = [];
      var aX = [];
      var aY = [];
      list.forEach(function (r) {
        var g = uGroup(r.u, k);
        if (g) {
          groups[g].push(r.c3);
          uX.push(r.u);
          uY.push(r.c3);
        }
        if (r.arc !== null && r.arc !== undefined) {
          aX.push(r.arc);
          aY.push(r.c3);
        }
      });
      return {
        label: label,
        n: list.length,
        tight: { n: groups.tight.length, medianC3: median(groups.tight) },
        moderate: { n: groups.moderate.length, medianC3: median(groups.moderate) },
        uncertain: { n: groups.uncertain.length, medianC3: median(groups.uncertain) },
        rhoU: spearman(uX, uY),
        nRhoU: uX.length,
        rhoArc: spearman(aX, aY),
        nRhoArc: aX.length,
      };
    }
    var withC3 = rows.filter(function (r) {
      return isNum(r.c3);
    });
    var all = summarise(withC3, 'all bodies');
    var hx = withC3.filter(function (r) {
      return isNum(r.H);
    });
    var hy = hx.map(function (r) {
      return r.H;
    });
    all.rhoHc3 = spearman(hy, hx.map(function (r) {
      return r.c3;
    }));
    var hu = hx.filter(function (r) {
      return r.u !== null && r.u !== undefined;
    });
    all.rhoHU = spearman(hu.map(function (r) {
      return r.H;
    }), hu.map(function (r) {
      return r.u;
    }));
    var bands = [];
    for (var i = 0; i <= H_EDGES.length; i++) {
      var sub = hx.filter(function (r) {
        return hIndex(r.H) === i;
      });
      var label = i === 0 ? 'H < ' + H_EDGES[0] : i === H_EDGES.length ? 'H ≥ ' + H_EDGES[i - 1] : 'H ' + H_EDGES[i - 1] + '–' + H_EDGES[i];
      bands.push(summarise(sub, label));
    }
    return { all: all, bands: bands, hUnknownWithC3: withC3.length - hx.length };
  }

  // ---------------------------------------------------------------- formatting
  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtPct(part, whole, digits) {
    if (!whole) return '—';
    return ((100 * part) / whole).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  // C3 and v-infinity: three significant figures everywhere (exponent below 0.001).
  function fmtSig(x) {
    if (!isNum(x)) return '—';
    if (x !== 0 && Math.abs(x) < 0.001) return x.toExponential(2);
    var s = x.toPrecision(3);
    if (s.indexOf('e') >= 0) return String(Number(s));
    return s;
  }

  function fmtRho(r) {
    if (r === null || r === undefined) return '—';
    return (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2);
  }

  function arcLabel(dIdx) {
    var d = ARC_EDGES[dIdx];
    return d === 0 ? 'any' : d + ' d';
  }

  return {
    OURS: OURS,
    U_NULL: U_NULL,
    C3_NONE: C3_NONE,
    C3_HIGH: C3_HIGH,
    LOW_BANDS: LOW_BANDS,
    c3Band: c3Band,
    c3BandLabels: c3BandLabels,
    c3BandShortLabels: c3BandShortLabels,
    uIndex: uIndex,
    binIndex: binIndex,
    hIndex: hIndex,
    buildHistograms: buildHistograms,
    sum3: sum3,
    c3ByU: c3ByU,
    uMarginal: uMarginal,
    c3Marginal: c3Marginal,
    crossTab: crossTab,
    survivors: survivors,
    survivorGrid: survivorGrid,
    listCountFromHist: listCountFromHist,
    inList: inList,
    SORTS: SORTS,
    LIST_COLUMNS: LIST_COLUMNS,
    rowFromArray: rowFromArray,
    rowToArray: rowToArray,
    jdFromIsoDate: jdFromIsoDate,
    isoFromJd: isoFromJd,
    addDays: addDays,
    lattice: lattice,
    edgesOf: edgesOf,
    arrivalAfterEncounter: arrivalAfterEncounter,
    flagsFor: flagsFor,
    qualityRankSpec: qualityRankSpec,
    qualityRankLiteral: qualityRankLiteral,
    ranks: ranks,
    spearman: spearman,
    median: median,
    uGroup: uGroup,
    stratify: stratify,
    fmtInt: fmtInt,
    fmtPct: fmtPct,
    fmtSig: fmtSig,
    fmtRho: fmtRho,
    arcLabel: arcLabel,
  };
});
