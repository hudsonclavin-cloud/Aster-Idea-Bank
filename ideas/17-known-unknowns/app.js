/*
 * Known Unknowns: the page. Draws everything from window.KU_STUDY (derived from the
 * Aster checkout by known-unknowns.mjs) through window.KnownUnknowns (model.js).
 * No number on this page is typed here: counts, constants, quotes and dates all
 * come from the study object or are computed from it. Text from data is set with
 * textContent, never innerHTML.
 */
(function () {
  'use strict';
  var K = window.KnownUnknowns;
  var S = window.KU_STUDY;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var PAGE_STEP = 20;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    setAttrs(n, attrs);
    append(n, kids);
    return n;
  }
  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    setAttrs(n, attrs);
    append(n, kids);
    return n;
  }
  function setAttrs(n, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (a) {
      var v = attrs[a];
      if (v === null || v === undefined || v === false) return;
      if (a === 'text') n.textContent = v;
      else if (a === 'class') n.setAttribute('class', v);
      else n.setAttribute(a, v === true ? '' : String(v));
    });
  }
  function append(n, kids) {
    if (kids === null || kids === undefined) return;
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  function clear(n) {
    while (n.firstChild) n.removeChild(n.firstChild);
    return n;
  }
  function $(id) {
    return document.getElementById(id);
  }
  function code(t) {
    return el('code', { text: t });
  }
  function src(o) {
    if (!o) return '';
    return o.path + (o.line ? ':' + o.line + (o.lineEnd && o.lineEnd !== o.line ? '–' + o.lineEnd : '') : '') + (o.key ? ' (' + o.key + ')' : '');
  }

  if (!K || !S) {
    var m = document.querySelector('main');
    clear(m);
    append(m, el('section', { class: 'card' }, [
      el('h1', { text: 'Known Unknowns' }),
      el('div', { class: 'refusal-card' }, [
        el('div', { class: 'q', text: 'The study data did not load.' }),
        el('p', { text: 'This page draws every number from snapshots/study.data.js and model.js. One of them is missing, so it shows nothing rather than a placeholder. Run node ideas/17-known-unknowns/known-unknowns.mjs --write from the bank root to rebuild it.' }),
      ]),
    ]));
    return;
  }

  var k = S.constants;
  var H = S.headline;
  var fi = K.fmtInt;
  var pct = K.fmtPct;
  var BAND = K.c3BandLabels(k);
  var BAND_SHORT = K.c3BandShortLabels(k);
  var LOW = H.status.low_departure_c3;
  var listRows = S.list.rows.map(K.rowFromArray);
  var asOf = S.aster.asOf;
  var tip = $('tip');
  // DEC-19-2: any surface that shows a minimum C3 states the grid it came from, next to the value.
  var GRID = S.lattice.columns + '×' + S.lattice.rows + ' cache grid';

  // ------------------------------------------------------------ tooltip
  function showTip(lines, x, y) {
    clear(tip);
    lines.forEach(function (l, i) {
      append(tip, i === 0 ? el('strong', { text: l }) : el('div', { text: l }));
    });
    tip.hidden = false;
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var vx = Math.min(Math.max(8, x + 12), window.innerWidth - w - 8);
    var vy = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.left = vx + 'px';
    tip.style.top = vy + 'px';
  }
  function hideTip() {
    tip.hidden = true;
  }
  // A tooltip opened by keyboard focus follows its mark when the page scrolls (focusing
  // scrolls it into view); one opened by the pointer just closes.
  var tipAnchor = null;
  function tipAtElement(node, lines) {
    var r = node.getBoundingClientRect();
    showTip(lines, r.left + r.width / 2, r.top);
    tipAnchor = { node: node, lines: lines };
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      hideTip();
      tipAnchor = null;
    }
  });
  window.addEventListener('scroll', function () {
    if (tipAnchor && document.activeElement === tipAnchor.node && !tip.hidden) {
      var r = tipAnchor.node.getBoundingClientRect();
      showTip(tipAnchor.lines, r.left + r.width / 2, r.top);
    } else {
      hideTip();
      tipAnchor = null;
    }
  }, { passive: true });

  // ------------------------------------------------------------ header
  var strat = S.stratified;
  var bandRhos = strat.bands.map(function (b) {
    return b.rhoU;
  }).filter(function (r) {
    return r !== null;
  });
  var rhoMin = Math.min.apply(null, bandRhos);
  var rhoMax = Math.max.apply(null, bandRhos);
  var uHighLabel = 'U ≥ ' + k.uHighlyUncertainMin;
  var uTightLabel = 'U ≤ ' + k.uTightMax;

  append($('lede'), [
    pct(H.uHighlyUncertain, H.bodies, 1) + ' of the ' + fi(H.bodies) + ' bodies in Aster’s catalog carry condition code ' + uHighLabel + ', the cutoff JPL publishes for “highly uncertain”, and the median data arc is ' + H.arcMedianDays + ' days. Yet ' + pct(LOW, H.bodies, 1) + ' pass the screening’s low-departure-C3 test. Across the catalog the badly known bodies look like the cheap ones: median minimum C3 ' + K.fmtSig(strat.all.uncertain.medianC3) + ' km²/s² at ' + uHighLabel + ' against ' + K.fmtSig(strat.all.tight.medianC3) + ' at ' + uTightLabel + ' (on the ' + GRID + '; Spearman ρ ' + K.fmtRho(strat.all.rhoU) + '). ',
    el('strong', { text: 'Inside every band of absolute magnitude H the sign flips' }),
    ' (ρ ' + K.fmtRho(rhoMin) + ' to ' + K.fmtRho(rhoMax) + '): it is size, not knowledge. Below: the cross-tabs, the reversal, a what-if filter, and the ' + fi(S.list.total) + ' low-C3, badly known bodies a recovery campaign would start from.',
  ]);

  var tiles = [
    [fi(H.bodies), 'bodies in the catalog'],
    [pct(H.uHighlyUncertain, H.bodies, 1), uHighLabel + ' (' + fi(H.uHighlyUncertain) + ')'],
    [H.arcMedianDays + ' d', 'median data arc (' + fi(H.bodies - H.arcReported) + ' not reported)'],
    [pct(LOW, H.bodies, 1), 'low departure C3 (' + fi(LOW) + ')'],
  ];
  append($('tiles'), tiles.map(function (t) {
    return el('div', { class: 'tile' }, [el('div', { class: 'v', text: t[0] }), el('div', { class: 'l', text: t[1] })]);
  }));

  // ------------------------------------------------------------ cross-tab
  var VIEW_NOTES = {
    U: 'Rows: the catalog’s condition code U, raw (MPC 0–9).',
    arc: 'Rows: data arc in days, in this study’s own bands.',
    obs: 'Rows: observations used in the orbit fit, in this study’s own bands. Every body reports one.',
    H: 'Rows: absolute magnitude H, in this study’s own bands; larger H is fainter and smaller.',
  };
  append($('ct-sub'), 'Every body in the catalog once. Columns are bands of the body’s minimum departure C3 (km²/s²) on the ' + GRID + ' (departures every ' + S.metadata.departureGridSpacingDays + ' days from ' + S.lattice.firstDeparture + ' to ' + S.lattice.lastDeparture + ', flights of ' + S.lattice.tofFloor + ' to ' + S.lattice.tofCeiling + ' days; Aster’s porkchop and compare grids differ and can give another minimum for the same body, DEC-19-2); the shade is the share of the row, and each cell gives that share and the count.');
  function heatClass(share) {
    if (share === 0) return 'z';
    if (share <= 0.05) return 'h0';
    if (share <= 0.15) return 'h1';
    if (share <= 0.35) return 'h2';
    if (share <= 0.6) return 'h3';
    return 'h4';
  }
  function drawCrossTab(view) {
    var ct = K.crossTab(S.hists, view);
    var t = clear($('ct-table'));
    var cap = el('caption', { class: 'note', text: VIEW_NOTES[view] });
    cap.style.textAlign = 'left';
    cap.style.captionSide = 'bottom';
    var head = el('tr', null, [el('th', { scope: 'col', class: 'rowh grid-note', text: 'min C3, ' + GRID })].concat(BAND_SHORT.map(function (b, i) {
      return el('th', { scope: 'col', title: BAND[i] + ' km\u00b2/s\u00b2', text: b });
    })));
    var body = ct.rows.map(function (r) {
      var tr = el('tr', { class: r.unknown ? 'unknown' : null }, [el('th', { scope: 'row', class: 'rowh' }, [r.label, el('span', { class: 'n', text: fi(r.total) })])]);
      r.cells.forEach(function (c, i) {
        var share = r.total ? c / r.total : 0;
        var tipText = r.label + ', minimum C3 ' + BAND[i] + ': ' + fi(c) + ' of ' + fi(r.total) + ' (' + pct(c, r.total, 1) + ')';
        append(tr, el('td', null, el('div', { class: 'cell ' + heatClass(share), title: tipText, 'aria-label': tipText }, [
          el('span', { class: 'p', text: r.total ? pct(c, r.total, 1) : '—' }),
          el('span', { class: 'c', text: fi(c) }),
        ])));
      });
      return tr;
    });
    var foot = el('tr', null, [el('th', { scope: 'row', class: 'rowh', text: 'all ' + fi(ct.grandTotal) })].concat(ct.colTotals.map(function (c) {
      return el('td', { text: fi(c) });
    })));
    append(t, [cap, el('thead', null, head), el('tbody', null, body), el('tfoot', null, foot)]);
    t.setAttribute('data-view', view);
    t.setAttribute('data-total', String(ct.grandTotal));
  }
  function wireSeg(groupId, attr, onPick) {
    var btns = Array.prototype.slice.call($(groupId).querySelectorAll('button'));
    function pick(b, focus) {
      btns.forEach(function (x) {
        x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        x.tabIndex = x === b ? 0 : -1;
      });
      if (focus) b.focus();
      onPick(b.getAttribute(attr));
    }
    btns.forEach(function (b, i) {
      b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
      b.addEventListener('click', function () {
        pick(b, false);
      });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        pick(btns[(i + d + btns.length) % btns.length], true);
      });
    });
  }
  wireSeg('ct-views', 'data-view', drawCrossTab);
  drawCrossTab('U');
  var cs = S.constantSources;
  append($('ct-note'), [
    'C3 band edges are Aster’s own: ' + k.nearZeroC3 + ' the near-zero flag (', code(src(cs.nearZeroC3)), '), ' + k.c3ColorMin + ' the porkchop colour floor (', code(src(cs.c3ColorMin)), '), ' + k.c3FirstContour + ' the first porkchop contour (', code(src(cs.c3FirstContour)), '), ' + k.feasibleC3Max + ' the screening threshold (', code('metadata.feasibleC3MaxKm2S2'), '). Values below ' + k.nearZeroC3 + ' are flagged, never removed: “' + S.quotes.dec191.text + '” (', code(src(S.quotes.dec191)), '). U is never turned into a distance: “' + S.quotes.dec182.text + '” (', code(src(S.quotes.dec182)), '). MPC, as Aster’s compare page quotes it: “' + S.quotes.mpcWarning.text + '”',
  ]);

  // ------------------------------------------------------------ why (dumbbell)
  append($('why-sub'), 'Across the catalog ρ(U, minimum C3) is ' + K.fmtRho(strat.all.rhoU) + ' and ρ(data arc, minimum C3) is ' + K.fmtRho(strat.all.rhoArc) + ': the worse-known bodies have the cheaper minimum C3. But absolute magnitude drives both. ρ(H, minimum C3) is ' + K.fmtRho(strat.all.rhoHc3) + ' and ρ(H, U) is ' + K.fmtRho(strat.all.rhoHU) + '. Split the catalog into six H bands (two magnitudes wide, open at both ends) and the median minimum C3 of the ' + uHighLabel + ' bodies is higher than that of the ' + uTightLabel + ' bodies in every band.');
  append($('why-legend'), [
    el('span', { class: 'k' }, [el('span', { class: 'dot', style: 'background:var(--series-1)' }), uTightLabel + ' (Aster’s “tightly determined”)']),
    el('span', { class: 'k' }, [el('span', { class: 'dot', style: 'background:var(--series-2)' }), uHighLabel + ' (JPL’s “highly uncertain”)']),
    el('span', { class: 'k' }, [el('span', { class: 'dot', style: 'background:var(--surface);box-shadow:inset 0 0 0 2px var(--text-2)' }), 'hollow: fewer than 30 bodies']),
  ]);
  var SMALL_N = 30;
  function drawWhy() {
    var box = $('why-chart');
    var W = Math.max(300, Math.min(900, box.clientWidth || 600));
    var narrow = W < 520;
    var labW = narrow ? 70 : 96;
    var padR = 14;
    var rowH = 34;
    var top = 42;
    var rows = [strat.all].concat(strat.bands);
    var Hh = top + rows.length * rowH + 22;
    var lo = Math.log10(k.nearZeroC3);
    var hi = Math.log10(30);
    rows.forEach(function (r) {
      [r.tight, r.uncertain].forEach(function (g) {
        if (g.medianC3 > 0) {
          lo = Math.min(lo, Math.floor(Math.log10(g.medianC3)));
          hi = Math.max(hi, Math.ceil(Math.log10(g.medianC3)));
        }
      });
    });
    var x0 = labW;
    var x1 = W - padR;
    function X(v) {
      return x0 + ((Math.log10(v) - lo) / (hi - lo)) * (x1 - x0);
    }
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + Hh, width: W, height: Hh, role: 'img', 'aria-label': 'Median minimum C3 by U group, overall and within each H band; log scale' });
    var ticks = [];
    for (var e = lo; e <= hi; e++) {
      ticks.push(Math.pow(10, e));
      if (e < hi && !narrow) ticks.push(3 * Math.pow(10, e));
    }
    ticks.forEach(function (t) {
      var x = X(t);
      append(svg, sv('line', { class: 'grid', x1: x, x2: x, y1: top - 6, y2: Hh - 20 }));
      append(svg, sv('text', { x: x, y: Hh - 6, 'text-anchor': 'middle', text: String(Number(t.toPrecision(2))) }));
    });
    append(svg, sv('text', { x: x1, y: 12, 'text-anchor': 'end', text: 'median minimum C3, km²/s² (log), ' + GRID }));
    append(svg, sv('text', { x: 0, y: 30, text: 'H band' }));
    rows.forEach(function (r, i) {
      var y = top + i * rowH + rowH / 2;
      append(svg, sv('text', { class: 'lab', x: 0, y: y + 4, text: r.label === 'all bodies' ? 'all' : r.label.replace('H ', '') }));
      if (i === 0) append(svg, sv('line', { class: 'axis', x1: 0, x2: x1, y1: y + rowH / 2, y2: y + rowH / 2 }));
      var a = r.tight;
      var b = r.uncertain;
      if (a.medianC3 && b.medianC3) append(svg, sv('line', { class: 'conn', x1: X(a.medianC3), x2: X(b.medianC3), y1: y, y2: y }));
      [[a, 's1', uTightLabel], [b, 's2', uHighLabel]].forEach(function (g) {
        var grp = g[0];
        if (!grp.medianC3) return;
        var cx = X(grp.medianC3);
        var small = grp.n < SMALL_N;
        append(svg, sv('circle', { class: (small ? 'hollow ' : 'ring ') + g[1], cx: cx, cy: y, r: 5 }));
        var lines = [K.fmtSig(grp.medianC3) + ' km²/s²', (r.label === 'all bodies' ? 'All bodies' : r.label) + ', ' + g[2] + ': median minimum C3', fi(grp.n) + ' bodies' + (small ? ' (too few to lean on)' : '')];
        var hit = sv('circle', { class: 'hit', cx: cx, cy: y, r: 13, tabindex: 0, role: 'img', 'aria-label': lines.join('; '), 'data-group': g[1], 'data-row': String(i) });
        hit.addEventListener('pointerenter', function (ev) {
          showTip(lines, ev.clientX, ev.clientY);
        });
        hit.addEventListener('pointermove', function (ev) {
          showTip(lines, ev.clientX, ev.clientY);
        });
        hit.addEventListener('pointerleave', hideTip);
        hit.addEventListener('focus', function () {
          tipAtElement(hit, lines);
        });
        hit.addEventListener('blur', hideTip);
        append(svg, hit);
      });
      if (i === 0 && a.medianC3 && b.medianC3) {
        var left = a.medianC3 < b.medianC3 ? [a, uTightLabel] : [b, uHighLabel];
        var right = left[0] === a ? [b, uHighLabel] : [a, uTightLabel];
        append(svg, sv('text', { x: X(left[0].medianC3) - 9, y: y - 9, 'text-anchor': 'end', text: left[1] }));
        append(svg, sv('text', { x: X(right[0].medianC3) + 9, y: y - 9, text: right[1] }));
      }
    });
    append(clear(box), svg);
  }
  (function whyTable() {
    var t = $('why-table');
    var mid = 'U ' + (k.uTightMax + 1) + '–' + (k.uHighlyUncertainMin - 1);
    append(t, el('thead', null, el('tr', null, ['', 'bodies', uTightLabel + ' n', 'median', mid + ' n', 'median', uHighLabel + ' n', 'median', 'ρ(U, C3)', 'ρ(arc, C3)'].map(function (h) {
      return el('th', { scope: 'col', text: h });
    }))));
    append(t, el('tbody', null, [strat.all].concat(strat.bands).map(function (r) {
      return el('tr', null, [r.label, fi(r.n), fi(r.tight.n), K.fmtSig(r.tight.medianC3), fi(r.moderate.n), K.fmtSig(r.moderate.medianC3), fi(r.uncertain.n), K.fmtSig(r.uncertain.medianC3), K.fmtRho(r.rhoU), K.fmtRho(r.rhoArc)].map(function (v, i) {
        return el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row', text: v } : { text: v });
      }));
    })));
  })();
  append($('why-note'), 'Medians are of each body’s minimum departure C3 over every body that has one, near-zero values included. H bands are this study’s own; ' + fi(strat.hUnknownWithC3) + ' bodies without H count in “all” only. ρ is Spearman’s rank correlation with tied ranks averaged. In the brightest band only ' + fi(strat.bands[0].uncertain.n) + ' bodies have ' + uHighLabel + ', so that pair is drawn hollow. This is an association in one catalog. That faint bodies are found near Earth and followed briefly is the likely reason; this page does not measure it.');

  // ------------------------------------------------------------ what-if
  var EDGES = K.OURS.arcEdgesDays;
  var uIn = $('u-in');
  var dIn = $('d-in');
  dIn.max = String(EDGES.length - 1);
  append($('wi-policy'), [
    'Counting only. Aster’s own rule for U (DEC-17-4, ', code(src(S.quotes.dec174)), '): “' + S.quotes.dec174.text + '” The catalog spec reserves the next name for Aster policy: “' + S.quotes.planningTier.text + '” So this is a what-if filter, not a tier and not a recommendation: it asks how many low-C3 bodies a hard gate on U and data arc would keep.',
  ]);
  var grid = K.survivorGrid(S.hists.byArc);
  function drawWhatIf() {
    var u = Number(uIn.value);
    var d = Number(dIn.value);
    $('u-out').textContent = String(u);
    $('d-out').textContent = d === 0 ? 'any (0 d)' : EDGES[d] + ' d';
    uIn.setAttribute('aria-valuetext', 'U at most ' + u);
    dIn.setAttribute('aria-valuetext', d === 0 ? 'any data arc' : 'data arc at least ' + EDGES[d] + ' days');
    var s = K.survivors(S.hists.byArc, u, d);
    var r = clear($('wi-result'));
    r.setAttribute('data-survive', String(s.survive));
    if (s.survive === 0) {
      append(r, el('div', { class: 'refusal' }, [el('div', { class: 'big', text: '0 pass' }), el('p', { text: 'No low-C3 body has U at most ' + u + ' and a data arc of at least ' + EDGES[d] + ' days in this catalog.' })]));
    } else {
      append(r, [
        el('div', { class: 'big', text: fi(s.survive) + ' of ' + fi(s.population) + ' pass (' + pct(s.survive, s.population, 1) + ')' }),
        el('div', { text: 'low-departure-C3 bodies with U at most ' + u + (d === 0 ? ' and any reported data arc' : ' and a data arc of at least ' + EDGES[d] + ' days') }),
      ]);
    }
    append(r, el('ul', null, [
      el('li', { text: 'dropped for U above ' + u + ': ' + fi(s.dropU) }),
      el('li', { text: 'dropped for an arc under ' + EDGES[d] + ' d: ' + fi(s.dropArc) }),
      el('li', { text: 'dropped for both: ' + fi(s.dropBoth) }),
      el('li', { text: 'U not reported: ' + fi(s.unknownU) + '; arc not reported: ' + fi(s.unknownArc) + ' (never shown to pass, never imputed)' }),
      el('li', { text: 'passing, by minimum C3: ' + s.surviveByBand.map(function (n, i) {
        return BAND[i] + ' ' + fi(n);
      }).join(' · ') }),
    ]));
    drawCurves(u, d);
  }
  function drawCurves(u, d) {
    var box = $('wi-chart');
    var W = Math.max(300, Math.min(900, box.clientWidth || 600));
    var narrow = W < 520;
    var Hh = narrow ? 220 : 260;
    var L = narrow ? 40 : 48;
    var R = narrow ? 44 : 60;
    var T = 14;
    var B = 34;
    var pop = K.survivors(S.hists.byArc, 9, 0).population;
    function X(i) {
      return L + (i / (EDGES.length - 1)) * (W - L - R);
    }
    function Y(v) {
      return T + (1 - v / pop) * (Hh - T - B);
    }
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + Hh, width: W, height: Hh, role: 'img', 'aria-label': 'Bodies that pass, against the minimum data arc, one line per U limit; the selected limit is highlighted' });
    var step = Math.pow(10, Math.floor(Math.log10(pop / 2)));
    for (var v = 0; v <= pop; v += step) {
      append(svg, sv('line', { class: 'grid', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }));
      append(svg, sv('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', text: v >= 1000 ? v / 1000 + 'K' : String(v) }));
    }
    var showLab = narrow ? [0, 2, 5, 9, 13, 15] : [0, 1, 2, 3, 5, 7, 9, 11, 13, 14, 15];
    EDGES.forEach(function (e, i) {
      if (showLab.indexOf(i) < 0) return;
      append(svg, sv('text', { x: X(i), y: Hh - B + 16, 'text-anchor': 'middle', text: i === 0 ? 'any' : String(e) }));
    });
    append(svg, sv('text', { x: W - R, y: Hh - 3, 'text-anchor': 'end', text: 'data arc at least (days)' }));
    function path(row) {
      return row.map(function (n, i) {
        return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(n).toFixed(1);
      }).join(' ');
    }
    for (var uu = 0; uu <= 9; uu++) if (uu !== u) append(svg, sv('path', { class: 'other', d: path(grid[uu]) }));
    var cross = sv('line', { class: 'cross', x1: X(d), x2: X(d), y1: T, y2: Hh - B, visibility: 'visible' });
    append(svg, cross);
    append(svg, sv('path', { class: 'sel', d: path(grid[u]) }));
    append(svg, sv('circle', { class: 'mark', cx: X(d), cy: Y(grid[u][d]), r: 5 }));
    var endY = Y(grid[u][EDGES.length - 1]);
    append(svg, sv('text', { class: 'lab', x: W - R + 6, y: endY + 4, text: 'U ≤ ' + u }));
    var bg = sv('rect', { class: 'plotbg', x: L, y: T, width: W - L - R, height: Hh - T - B });
    function idxAt(ev) {
      var rect = svg.getBoundingClientRect();
      var px = ((ev.clientX - rect.left) / rect.width) * W;
      return Math.max(0, Math.min(EDGES.length - 1, Math.round(((px - L) / (W - L - R)) * (EDGES.length - 1))));
    }
    bg.addEventListener('pointermove', function (ev) {
      var i = idxAt(ev);
      cross.setAttribute('x1', X(i));
      cross.setAttribute('x2', X(i));
      showTip([fi(grid[u][i]) + ' pass (' + pct(grid[u][i], pop, 1) + ')', 'U ≤ ' + u + ', data arc ' + (i === 0 ? 'any' : '≥ ' + EDGES[i] + ' d')], ev.clientX, ev.clientY);
    });
    bg.addEventListener('pointerleave', function () {
      cross.setAttribute('x1', X(d));
      cross.setAttribute('x2', X(d));
      hideTip();
    });
    bg.addEventListener('click', function (ev) {
      dIn.value = String(idxAt(ev));
      hideTip();
      drawWhatIf();
    });
    append(svg, bg);
    append(clear(box), svg);
  }
  uIn.addEventListener('input', drawWhatIf);
  dIn.addEventListener('input', drawWhatIf);
  append($('wi-note'), 'The population is every body whose screening status is low_departure_c3 (minimum C3 ≤ ' + k.feasibleC3Max + ' km²/s²), near-zero values included. Grey lines are the other U limits; tap the chart to move the arc limit. Arc bands are this study’s own. What “low departure C3” means, in Aster’s words: “' + S.quotes.lowC3Meaning.text + '” (' + src(S.quotes.lowC3Meaning) + ')');

  // ------------------------------------------------------------ the list
  var lat = S.lattice;
  var EDGE_WORDS = { floor: 'TOF floor ' + lat.tofFloor + ' d', ceiling: 'TOF ceiling ' + lat.tofCeiling + ' d', first: 'first departure', last: 'last departure' };
  var state = { sort: 'H', shown: PAGE_STEP, hideNZ: false };
  var Lf = S.list.flagTotals;
  append($('list-sub'), [
    fi(S.list.total) + ' bodies (' + pct(S.list.total, H.bodies, 1) + ' of the catalog) have a low minimum departure C3, ' + uHighLabel + ' and a data arc under ' + S.list.criterion.arcBelowDays + ' days or none reported. That is not a short list. It is sorted, not recommended: nothing here says a body can be seen (see the refusals below). The page carries the top ' + S.list.top + ' under each ranking; ',
    code('known-unknowns.mjs --sort H|c3 --top N'),
    ' re-selects from all ' + fi(S.list.total) + ' in the checkout. Across all of them: ' + fi(Lf.nearZero) + ' near-zero C3, ' + fi(Lf.past) + ' with the minimum-C3 window launching before ' + asOf + ', ' + fi(Lf.afterEncounter) + ' arriving after the encounter that makes them Slice 18 tier L1, ' + fi(Lf.edge) + ' on a lattice edge.',
  ]);
  function rankNote() {
    var n = clear($('list-rank-note'));
    if (state.sort === 'c3') {
      append(n, 'Ranked by minimum C3, the first ' + fi(S.list.firstNotNearZeroRankByC3 - 1) + ' rows are all near-zero-C3 flags (close-approach co-location, a flag to inspect, not a planning number). They stay in the ranking with their real values, as DEC-19-1 requires; the toggle hides the value in place, as Aster’s own pages do.');
    } else {
      append(n, 'Brightest (lowest H) first: the larger bodies, and the easier to recover, though this page computes no magnitude or visibility. H is shown raw; a diameter needs an assumed albedo, and Aster’s DEC-17-4 requires its uncertainty to be stated.');
    }
  }
  function badge(text, title, warn) {
    return el('span', { class: 'badge' + (warn ? ' warn' : ''), title: title, text: text });
  }
  function tierBadge(r) {
    if (!r.tier) return null;
    var t = r.tier === 'L0' ? 'L0: ' + r.subReason : r.tier;
    return badge(t, 'Slice 18 screening-fidelity tier ' + r.tier + ' (' + r.subReason + ')', r.tier === 'L0');
  }
  function drawList() {
    var order = S.list.rankings[state.sort];
    var shown = order.slice(0, state.shown).map(function (i) {
      return listRows[i];
    });
    var flags = shown.map(function (r) {
      return K.flagsFor(r, k, lat, asOf);
    });
    var hiddenCount = state.hideNZ ? flags.filter(function (f) {
      return f.nearZero;
    }).length : 0;
    var t = clear($('list-table'));
    var cols = [['rank', '#'], ['des', 'Designation'], ['cls', 'Class'], ['', 'H'], ['', 'U'], ['', 'Arc (d)'], ['', 'Obs'], ['', 'Launch'], ['', 'TOF (d)'], ['', 'Arrive'], ['', 'Min C3 (km²/s², ' + GRID + ')'], ['', 'v∞ arr (km/s)'], ['flags', 'Flags']];
    append(t, el('thead', null, el('tr', null, cols.map(function (c) {
      return el('th', { scope: 'col', class: c[0] || null, text: c[1] });
    }))));
    var tb = el('tbody');
    shown.forEach(function (r, i) {
      var f = flags[i];
      var hide = state.hideNZ && f.nearZero;
      var c3cell = hide ? el('span', { class: 'hidden-note', text: S.quotes.nearZeroHidden.template.replace('{count}', String(hiddenCount)) }) : K.fmtSig(r.c3);
      var fl = [];
      if (f.nearZero && !hide) fl.push(badge(S.quotes.nearZeroBadge.text, 'Minimum C3 below ' + k.nearZeroC3 + ' km²/s²: typically Earth and the body nearly co-located at a close approach. A flag to inspect the geometry, not a planning number.', true));
      if (f.afterEncounter) fl.push(badge('after ' + r.encDate + ' encounter', S.quotes.unsupported.template.replace('{date}', r.encDate), true));
      if (f.past) fl.push(badge('launch before ' + asOf, 'This minimum-C3 window launches before ' + asOf + ', the date of the Aster commit read. The cache keeps only the five lowest-C3 cells, so a later window is not in it.', true));
      f.edges.forEach(function (e) {
        fl.push(badge('edge: ' + EDGE_WORDS[e], 'The minimum sits on an edge of the ' + lat.columns + ' × ' + lat.rows + ' screening lattice; the true minimum may lie beyond it.'));
      });
      if (f.keplerUnsafe) fl.push(badge('not-kepler-safe', 'INV-014 tier from the catalog: not safe for two-body Keplerian propagation.'));
      if (f.coOrbital) fl.push(badge('co-orbital', 'The cache’s co-orbital flag: patched-conic numbers need extra caution.'));
      if (f.pha) fl.push(badge('PHA', 'Potentially hazardous asteroid, per the catalog.'));
      var tb2 = tierBadge(r);
      if (tb2) fl.push(tb2);
      var cells = [
        el('td', { class: 'rank', 'data-label': '#', text: String(i + 1) }),
        el('td', { class: 'des', 'data-label': 'Designation' }, [el('span', { class: 'rk', text: (i + 1) + '. ' }), el('b', { text: r.des }), r.name ? el('span', { class: 'nm', text: r.name }) : null]),
        el('td', { class: 'cls', 'data-label': 'Class', text: r.cls }),
        r.H === null ? el('td', { 'data-label': 'H', title: 'not reported', 'aria-label': 'H not reported', text: '—' }) : el('td', { 'data-label': 'H', text: String(r.H) }),
        el('td', { 'data-label': 'U', text: String(r.u) }),
        r.arc === null ? el('td', { 'data-label': 'Arc (d)', title: 'not reported', 'aria-label': 'data arc not reported', text: '—' }) : el('td', { 'data-label': 'Arc (d)', text: String(r.arc) }),
        el('td', { 'data-label': 'Obs', text: String(r.nObs) }),
        el('td', { class: 'date', 'data-label': 'Launch', text: r.launchDate }),
        el('td', { 'data-label': 'TOF (d)', text: String(r.tofDays) }),
        el('td', { class: 'date', 'data-label': 'Arrive', text: K.addDays(r.launchDate, r.tofDays) }),
        el('td', { 'data-label': 'Min C3 (km²/s², ' + GRID + ')', class: 'c3' }, c3cell),
        el('td', { 'data-label': 'v∞ arr (km/s)', text: K.fmtSig(r.vInfArr) }),
        el('td', { class: 'flags', 'data-label': 'Flags' }, fl.length ? fl : el('span', { class: 'hidden-note', text: 'none' })),
      ];
      append(tb, el('tr', { 'data-des': r.des }, cells));
    });
    append(t, tb);
    var more = $('list-more');
    var all = order.length;
    more.disabled = state.shown >= all;
    more.textContent = state.shown >= all ? 'All ' + all + ' carried rows shown' : 'Show ' + Math.min(PAGE_STEP, all - state.shown) + ' more';
    $('list-count').textContent = 'showing ' + Math.min(state.shown, all) + ' of the top ' + all + ' (of ' + fi(S.list.total) + ')';
    rankNote();
  }
  wireSeg('list-sort', 'data-sort', function (s) {
    state.sort = s;
    state.shown = PAGE_STEP;
    drawList();
  });
  $('hide-nz').addEventListener('change', function (e) {
    state.hideNZ = e.target.checked;
    drawList();
  });
  $('list-more').addEventListener('click', function () {
    state.shown += PAGE_STEP;
    drawList();
  });
  append($('list-note'), 'A dash means not reported. Each row is the body’s minimum-C3 cell from the screening cache: launch date, time of flight, arrival date (launch + TOF) and arrival v∞. Aster’s ΔV stack books the rendezvous burn as the arrival v∞ (' + src(S.quotes.rendezvousIsVInfArr) + '), so a low departure C3 beside a high arrival v∞ is a fast flyby geometry, not a cheap rendezvous. Flags: the near-zero badge and hidden notice use Aster’s exact strings (' + src(S.quotes.nearZeroBadge) + '); “after … encounter” applies Aster’s support boundary (arrival at or after the encounter, ' + src(S.quotes.unsupported) + ') with the departure epoch taken as UTC midnight plus ' + k.tdbMinusUtcSeconds + ' s; the closest arrival in the catalog is ' + Math.abs(S.encounter.minMarginSeconds).toFixed(0) + ' s from its encounter, and the offset decides ' + S.encounter.decidedByTdbOffset.length + ' flags.');

  // ------------------------------------------------------------ qualityRank audit
  var A = S.qualityAudit;
  var F = S.formulas;
  var w = A.worstLiteral;
  append($('audit-body'), [
    el('p', null, ['The catalog spec (', code(src(F.spec)), ') clamps each score:']),
    el('div', { class: 'formula', text: F.spec.lines.join('\n') }),
    el('p', { text: 'Recomputed for all ' + fi(A.n) + ' bodies, that formula matches the stored qualityRank to ' + A.maxAbsSpecMinusStored.toExponential(2) + ' (the stored value is rounded to six decimals); ' + A.overTolerance + ' bodies differ by more than 1e-6.' }),
    el('p', null, ['The fixture describes itself differently. Its own ', code('catalog.qualityRankFormula'), ' (written at ', code(src(F.builderString)), ') reads:']),
    el('div', { class: 'formula', text: F.fixtureString.text }),
    el('p', { text: 'That has one clamp01 where the spec has three. Read literally, it disagrees with the stored value for ' + fi(A.literalDisagrees) + ' bodies, by up to ' + A.maxAbsLiteralMinusStored.toFixed(4) + ' (' + w.designation + ': U ' + (w.u === null ? 'not reported' : w.u) + ', data arc ' + fi(w.arc) + ' d, stored ' + w.stored + ', literal ' + w.literal.toFixed(4) + '). The difference is every arc over 1000 days whose score is not already capped by the outer clamp. The implementation (' + src(F.implementation) + ') follows the spec; the string is what is wrong. Aster’s boundary loader only checks that it is a non-empty string.' }),
    el('p', { class: 'note', text: 'Try a body: U (0–9, or blank for not reported) and data arc in days (blank for not reported).' }),
  ]);
  function drawQr() {
    var us = $('qr-u').value.trim();
    var as = $('qr-arc').value.trim();
    var out = clear($('qr-out'));
    var u = us === '' ? null : Number(us);
    var arc = as === '' ? null : Number(as);
    var bad = [];
    if (u !== null && !(Number.isInteger(u) && u >= 0 && u <= 9)) bad.push('U must be a whole number from 0 to 9, or blank');
    if (arc !== null && !(Number.isInteger(arc) && arc >= 0)) bad.push('the data arc must be a whole number of days, 0 or more, or blank');
    if (bad.length) {
      out.setAttribute('data-state', 'refused');
      append(out, el('div', { class: 'refusal' }, [el('strong', { text: 'Not computed. ' }), bad.join('; ') + '. The catalog stores U as an integer MPC code and the arc in whole days.']));
      return;
    }
    var a = K.qualityRankSpec(u, arc);
    var b = K.qualityRankLiteral(u, arc);
    var same = Math.abs(a - b) <= 1e-12;
    out.setAttribute('data-state', same ? 'agree' : 'differ');
    append(out, [
      el('div', { class: 'big', text: 'spec ' + a.toFixed(6) + ' · string ' + b.toFixed(6) }),
      el('div', { text: same ? 'The two readings agree here.' : 'The two readings differ by ' + Math.abs(a - b).toFixed(6) + '; the stored values follow the spec.' }),
    ]);
  }
  $('qr-u').addEventListener('input', drawQr);
  $('qr-arc').addEventListener('input', drawQr);
  drawQr();

  // ------------------------------------------------------------ refusals
  var codes = S.quotes.refusalCodes.codes;
  function code0(c) {
    if (codes.indexOf(c) < 0) throw new Error('refusal code not in Aster’s enum: ' + c);
    return c;
  }
  var refusals = [
    {
      q: 'Which of these should a telescope observe, and when?',
      code: code0('insufficient_data'),
      reason: 'An observing plan needs each body’s apparent magnitude, sky position and solar elongation over time, and a facility’s limiting magnitude and sky coverage. Neither the catalog nor the screening cache holds any of them, and this study computes none.',
      help: 'Observer ephemerides for the listed bodies (JPL Horizons observer tables, for instance) and a facility capability model: the inputs the Survey lens names for itself, “' + S.quotes.surveyQuestion.text + '” (' + src(S.quotes.surveyQuestion) + ').',
    },
    {
      q: 'How far off, in kilometres, is a U 9 orbit?',
      code: code0('out_of_envelope'),
      reason: S.quotes.dec182.text + ' The catalog carries no state covariance.',
      help: 'A real state covariance plus perturbed propagation, which DEC-18-2 names and Aster does not have.',
    },
    {
      q: 'When is each body’s next window after today?',
      code: code0('insufficient_data'),
      reason: 'The screening cache keeps each body’s five lowest-C3 cells, not a timeline. For ' + fi(Lf.past) + ' listed bodies the minimum-C3 window launches before ' + asOf + ', and a later, costlier window is not stored.',
      help: 'A dated porkchop scan for each body over the remaining span (Aster’s porkchop_scan tool), or a cache that keeps the best cell per synodic opportunity.',
    },
    {
      q: 'Does a high U mean the screening C3 is wrong?',
      code: code0('out_of_envelope'),
      reason: 'Slice 18 answered a narrower question: “' + S.quotes.slice18Answer.text + '” Its structural caveat: “' + S.quotes.slice18Caveat.text + '” (' + src(S.quotes.slice18Caveat) + ').',
      help: 'Truth independent of JPL’s current solution, such as a body’s later, longer-arc orbit compared with the short-arc one it replaced. Aster has none.',
    },
  ];
  append($('ref-list'), refusals.map(function (r) {
    return el('div', { class: 'refusal-card', 'data-code': r.code }, [
      el('div', { class: 'q', text: r.q }),
      el('dl', null, [el('dt', { text: 'code' }), el('dd', null, code(r.code)), el('dt', { text: 'reason' }), el('dd', { text: r.reason }), el('dt', { text: 'what_would_help' }), el('dd', { text: r.help })]),
    ]);
  }));

  // ------------------------------------------------------------ provenance
  var pb = $('prov-body');
  append(pb, el('p', { text: 'Read from Aster at commit ' + S.aster.commit + ' (' + S.aster.commitDate + ') by known-unknowns.mjs, which joins the catalog to the screening cache by bodyId and to the Slice 18 tier artifact by designation, and exits 1 unless the cache records this catalog’s sha256 (' + (S.inputs.cacheBuiltFromThisCatalog ? 'it does' : 'it does NOT') + '). The “as of” date for past windows is that commit’s date, ' + asOf + '.' }));
  var inT = el('table', { class: 'prov' });
  append(inT, el('thead', null, el('tr', null, ['file', 'blob', 'sha256', 'bytes', 'last changed'].map(function (h) {
    return el('th', { scope: 'col', text: h });
  }))));
  append(inT, el('tbody', null, ['catalog', 'cache', 'tiers'].map(function (key) {
    var i = S.inputs[key];
    return el('tr', null, [el('td', null, code(i.path)), el('td', null, code(i.committedBlob.slice(0, 10))), el('td', null, code(i.sha256.slice(0, 16) + '…')), el('td', { text: fi(i.bytes) }), el('td', { text: i.pathLastChanged })]);
  })));
  append(pb, inT);
  var names = { nearZeroC3: 'near-zero C3 flag (km²/s²)', c3ColorMin: 'porkchop colour floor (km²/s²)', c3FirstContour: 'first porkchop contour (km²/s²)', feasibleC3Max: 'screening threshold (km²/s²)', uHighlyUncertainMin: 'JPL “highly uncertain” from U', uTightMax: 'Aster’s “tightly determined” up to U', tdbMinusUtcSeconds: 'TDB − UTC (s)' };
  append(pb, el('ul', { class: 'kv' }, Object.keys(names).map(function (n) {
    return el('li', null, [names[n] + ': ' + k[n] + ' — ', code(src(cs[n]))]);
  })));
  append(pb, el('p', { class: 'note', text: 'This study’s own choices, labelled wherever they appear: data-arc bins ' + K.OURS.arcEdgesDays.join(', ') + ' d; observation bins ' + K.OURS.nObsEdges.join(', ') + '; H band edges ' + K.OURS.hEdges.join(', ') + '; the list’s arc limit ' + K.OURS.listArcBelowDays + ' d. The two U boundaries come from Aster’s compare page; ' + uHighLabel + ' is JPL’s published cutoff, ' + uTightLabel + ' is Aster’s own banding.' }));
  append(pb, el('p', { class: 'note', text: 'The copies in snapshots/ (cache metadata, catalog header, spec, qualityRank implementation, three constant files and the envelope schema) each carry a provenance sidecar with repo, path, commit, blob and sha256; study.data.js is derived and its sidecar says how.' }));

  // ------------------------------------------------------------ draw and redraw
  drawWhy();
  drawWhatIf();
  drawList();
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    hideTip();
    drawWhy();
    drawCurves(Number(uIn.value), Number(dIn.value));
  });
})();
