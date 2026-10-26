// app.js: draws Spin Wobble from wobble.js (the closed form), snapshots/canon.data.js (the Rev A
// canon, the twin's Earth radius, golden.json's numbers, the program's own sentences) and
// snapshots/twin-overlay.js (a recorded run of Skyhook's twin port). Every number on the page is
// computed here from those, or read from the recorded run; nothing about the tether is typed in.
(function () {
  'use strict';
  var W = window.SpinWobble;
  var CANON = window.SPIN_WOBBLE_CANON;
  var TWIN = window.SPIN_WOBBLE_TWIN;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DEG = Math.PI / 180;

  // ------------------------------------------------------------------ formatting
  function num(x, d) { return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtV(x) { return num(x, 1) + ' m/s'; }
  function fmtS(x) { return num(x, 1) + ' s'; }
  function pct(x, d) { return num(Math.abs(x) * 100, d === undefined ? 2 : d) + ' %'; }
  function spct(x, d) { return (x < 0 ? '−' : '+') + pct(x, d); }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function sv(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function showRefusal(r) {
    $('refusal').hidden = false;
    $('r-code').textContent = 'refusal: ' + r.code;
    $('r-reason').textContent = r.reason;
    $('r-help').textContent = r.what_would_help;
  }

  // ------------------------------------------------------------------ the canon
  var c = W.readCanon(CANON);
  if (!c.ok) {
    showRefusal(c.refusal);
    ['controls', 'results', 'claims-card', 'state-note', 'prov-table'].forEach(function (id) { $(id).hidden = true; });
    return;
  }
  var CANON_STATE = { tier: 'reference', LKm: c.LKm, theta0Deg: 0, radius: 'twin' };
  var state = Object.assign({}, CANON_STATE);
  var REF = W.fromCanon(c, CANON_STATE); // the canon case: the claims and the twin overlay use it
  function isCanon() {
    return state.tier === CANON_STATE.tier && state.LKm === CANON_STATE.LKm && state.theta0Deg === 0 && state.radius === 'twin';
  }

  // ------------------------------------------------------------------ the recorded twin run
  var twinOk = !!(TWIN && TWIN.samples && TWIN.samples.length && TWIN.source && TWIN.source.twin &&
    TWIN.source.twin.commit === CANON.provenance.twin.commit);
  var twinTurns = [];      // per turn in the orbiting frame: [[deg, v], ...]
  var twinResid = [];      // [[t, residual, vTwin, vClosed]]
  var twinTrough = null;
  if (twinOk) {
    var pts = [[0, 0, CANON.golden.checkpoints['0'].tip_speed_rel_com]].concat(TWIN.samples);
    var cur = null, turn = -1;
    for (var i = 0; i < pts.length; i++) {
      var th = pts[i][1], v = pts[i][2];
      var k = Math.floor(th / (2 * Math.PI));
      if (k !== turn) {
        if (cur && i > 0) { // close the previous turn at 360 deg and open the next at 0, interpolated
          var a = pts[i - 1], f = (2 * Math.PI * k - a[1]) / (th - a[1]);
          var vb = a[2] + f * (v - a[2]);
          cur.push([360, vb]);
          twinTurns.push(cur);
          cur = [[0, vb]];
        } else cur = [];
        turn = k;
      }
      cur.push([(th - 2 * Math.PI * k) / DEG, v]);
      if (i > 0) twinResid.push([pts[i][0], v - REF.tipSpeed(th), v, REF.tipSpeed(th)]);
      if (pts[i][0] < REF.halfPeriod && (twinTrough === null || v < twinTrough)) twinTrough = v;
    }
    if (cur && cur.length) twinTurns.push(cur);
  }
  function interpTurn(turnPts, deg) {
    for (var j = 1; j < turnPts.length; j++) {
      if (turnPts[j][0] >= deg && turnPts[j - 1][0] <= deg) {
        var f = (deg - turnPts[j - 1][0]) / ((turnPts[j][0] - turnPts[j - 1][0]) || 1);
        return turnPts[j - 1][1] + f * (turnPts[j][1] - turnPts[j - 1][1]);
      }
    }
    return null;
  }

  // The golden window, recomputed live: the closed form integrated over golden.json's own window
  // at its own step, averaged the way the golden run averages.
  var gm = CANON.golden.meta;
  var goldenWindow = W.integrate(REF, { dt: gm.dt, steps: Math.round(gm.duration_s / gm.dt) });

  // ------------------------------------------------------------------ charts
  var charts = {};
  function drawChart(id, spec) {
    var host = $(id), svg = host.querySelector('svg'), tip = host.querySelector('.tip');
    var Wd = Math.max(280, Math.round(host.clientWidth || 600));
    var Ht = Math.round(svg.getBoundingClientRect().height || 280);
    clear(svg);
    svg.setAttribute('viewBox', '0 0 ' + Wd + ' ' + Ht);
    var m = { l: 56, r: spec.right || 14, t: 26, b: 44 };
    var x0 = spec.x[0], x1 = spec.x[1], y0 = spec.y[0], y1 = spec.y[1];
    var sx = function (x) { return m.l + (x - x0) / (x1 - x0) * (Wd - m.l - m.r); };
    var sy = function (y) { return Ht - m.b - (y - y0) / (y1 - y0) * (Ht - m.t - m.b); };
    var g = sv('g');
    svg.appendChild(g);
    spec.yTicks.forEach(function (y) {
      g.appendChild(sv('line', { class: 'grid', x1: m.l, x2: Wd - m.r, y1: sy(y), y2: sy(y) }));
      g.appendChild(sv('text', { x: m.l - 6, y: sy(y) + 4, 'text-anchor': 'end' }, spec.yFmt(y)));
    });
    var step = Math.max(1, Math.ceil(spec.xTicks.length / Math.floor((Wd - m.l - m.r) / 44)));
    spec.xTicks.forEach(function (x, idx) {
      if (idx % step) return;
      g.appendChild(sv('text', { x: sx(x), y: Ht - m.b + 15, 'text-anchor': 'middle' }, spec.xFmt(x)));
    });
    g.appendChild(sv('line', { class: 'axis', x1: m.l, x2: Wd - m.r, y1: Ht - m.b, y2: Ht - m.b }));
    g.appendChild(sv('text', { x: Wd - m.r, y: Ht - 4, 'text-anchor': 'end', class: 'lbl' }, spec.xTitle));
    g.appendChild(sv('text', { x: 4, y: 12, 'text-anchor': 'start', class: 'lbl' }, spec.yTitle));
    var api = {
      sx: sx, sy: sy, W: Wd, H: Ht, m: m,
      path: function (points, cls) {
        if (!points.length) return;
        var d = points.map(function (p, j) { return (j ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
        g.appendChild(sv('path', { d: d, class: cls }));
      },
      hline: function (y, cls, label, anchor) {
        g.appendChild(sv('line', { class: cls, x1: m.l, x2: Wd - m.r, y1: sy(y), y2: sy(y) }));
        if (label) g.appendChild(sv('text', { x: anchor === 'start' ? m.l + 4 : Wd - m.r - 4, y: sy(y) - 4, 'text-anchor': anchor || 'end', class: 'lbl halo' }, label));
      },
      vline: function (x, cls, label, where) {
        g.appendChild(sv('line', { class: cls, x1: sx(x), x2: sx(x), y1: m.t, y2: Ht - m.b }));
        if (label) g.appendChild(sv('text', { x: sx(x), y: where === 'bottom' ? Ht - m.b - 5 : m.t + 10, 'text-anchor': 'middle', class: 'halo' }, label));
      },
      band: function (ya, yb) {
        g.appendChild(sv('rect', { class: 'band', x: m.l, width: Wd - m.l - m.r, y: sy(Math.max(ya, yb)), height: Math.abs(sy(ya) - sy(yb)) }));
      },
      dot: function (x, y, cls) { g.appendChild(sv('circle', { cx: sx(x), cy: sy(y), r: 4.5, class: cls })); },
      label: function (x, y, text, anchor) { g.appendChild(sv('text', { x: x, y: y, 'text-anchor': anchor || 'start', class: 'lbl halo' }, text)); },
    };
    spec.draw(api);
    var overlay = sv('g');
    svg.appendChild(overlay);
    var ch = charts[id] || (charts[id] = { idx: null });
    ch.spec = spec; ch.api = api; ch.overlay = overlay; ch.tip = tip; ch.svg = svg; ch.host = host;
    if (!ch.bound) bindHover(ch);
    if (ch.idx !== null && ch.active) showAt(ch, Math.min(ch.idx, spec.hoverXs.length - 1));
    else hideTip(ch);
  }

  function nearest(xs, x) {
    var lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid; else hi = mid; }
    return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
  }
  function hideTip(ch) { clear(ch.overlay); ch.tip.hidden = true; }
  function showAt(ch, i) {
    var spec = ch.spec, api = ch.api;
    ch.idx = i;
    clear(ch.overlay);
    var x = spec.hoverXs[i];
    ch.overlay.appendChild(sv('line', { class: 'cross', x1: api.sx(x), x2: api.sx(x), y1: api.m.t, y2: api.H - api.m.b }));
    var rows = spec.tooltip(i);
    rows.dots.forEach(function (d) {
      ch.overlay.appendChild(sv('circle', { cx: api.sx(x), cy: api.sy(d.y), r: 4.5, class: d.cls }));
    });
    clear(ch.tip);
    ch.tip.appendChild(el('div', { class: 'head' }, rows.head));
    rows.rows.forEach(function (r) {
      var row = el('div', { class: 'row' });
      var key = el('span', { class: 'key' + (r.dash ? ' dash' : '') });
      key.style.borderTopColor = r.color;
      row.appendChild(key);
      row.appendChild(el('span', { class: 'tv' }, r.value));
      row.appendChild(el('span', { class: 'tl' }, r.label));
      ch.tip.appendChild(row);
    });
    ch.tip.hidden = false;
    var px = api.sx(x) / api.W * ch.host.clientWidth;
    var tw = ch.tip.offsetWidth;
    var left = px + 12;
    if (left + tw > ch.host.clientWidth) left = Math.max(0, px - 12 - tw);
    ch.tip.style.left = left + 'px';
  }
  function bindHover(ch) {
    ch.bound = true;
    var svg = ch.svg;
    function fromEvent(e) {
      var r = svg.getBoundingClientRect();
      var xPx = (e.clientX - r.left) / r.width * ch.api.W;
      var x = ch.spec.x[0] + (xPx - ch.api.m.l) / (ch.api.W - ch.api.m.l - ch.api.m.r) * (ch.spec.x[1] - ch.spec.x[0]);
      return nearest(ch.spec.hoverXs, x);
    }
    svg.addEventListener('pointermove', function (e) { ch.active = true; showAt(ch, fromEvent(e)); });
    svg.addEventListener('pointerdown', function (e) { ch.active = true; showAt(ch, fromEvent(e)); });
    svg.addEventListener('pointerleave', function () { if (document.activeElement !== svg) { ch.active = false; hideTip(ch); } });
    svg.addEventListener('focus', function () { ch.active = true; showAt(ch, ch.idx === null ? ch.spec.focusIndex || 0 : ch.idx); });
    svg.addEventListener('blur', function () { ch.active = false; hideTip(ch); });
    svg.addEventListener('keydown', function (e) {
      var n = ch.spec.hoverXs.length, i = ch.idx === null ? 0 : ch.idx;
      var stepK = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowRight') i = Math.min(n - 1, i + stepK);
      else if (e.key === 'ArrowLeft') i = Math.max(0, i - stepK);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') { hideTip(ch); return; }
      else return;
      e.preventDefault();
      ch.active = true;
      showAt(ch, i);
    });
  }
  function ticks(a, b, target) {
    var span = b - a, raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var stepT = [1, 2, 2.5, 5, 10].map(function (s) { return s * mag; }).find(function (s) { return span / s <= target; }) || 10 * mag;
    var out = []; // covers [a, b]: the first tick at or below a, the last at or above b
    for (var t = Math.floor(a / stepT) * stepT; t < b + stepT - 1e-9 * span; t += stepT) out.push(+t.toFixed(10));
    return out;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function legend(id, items) {
    var box = $(id); clear(box);
    items.forEach(function (it) {
      var s = el('span');
      var key = el('span', { class: 'key' + (it.dash ? ' dash' : '') + (it.band ? ' band' : '') });
      if (!it.band) key.style.borderTopColor = it.color;
      s.appendChild(key);
      s.appendChild(document.createTextNode(it.label));
      box.appendChild(s);
    });
  }

  // ------------------------------------------------------------------ chart A: speed through a turn
  function chartA(m) {
    var showTwin = twinOk && isCanon();
    var closed = [];
    for (var d = 0; d <= 360; d++) closed.push([d, m.tipSpeed(d * DEG)]);
    var lo = m.vHorizontal, hi = m.vVertical;
    if (showTwin) twinTurns.forEach(function (t) { t.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }); });
    var pad = (hi - lo) * 0.12;
    var yT = ticks(lo - pad, hi + pad, 5);
    var c1 = css('--s1'), c2 = css('--s2'), cr = css('--ink-2');
    legend('ca-legend', [{ label: 'closed form (rigid tether)', color: c1 }].concat(showTwin ? [{ label: 'Skyhook twin, recorded ' + num(TWIN.durationS, 0) + ' s (just over two turns)', color: c2 }] : [])
      .concat([{ label: 'rotation mean', color: cr, dash: true }]));
    var xs = closed.map(function (p) { return p[0]; });
    drawChart('chart-a', {
      x: [0, 360], y: [yT[0], yT[yT.length - 1]], yTicks: yT, xTicks: [0, 45, 90, 135, 180, 225, 270, 315, 360],
      xFmt: function (x) { return x + '°'; }, yFmt: function (y) { return num(y, 0); },
      xTitle: 'tether angle from the local vertical', yTitle: 'tip speed, m/s',
      hoverXs: xs, focusIndex: 90,
      draw: function (g) {
        [90, 270].forEach(function (x) { g.vline(x, 'vmark', 'horizontal', 'top'); });
        [0, 180, 360].forEach(function (x) { g.vline(x, 'vmark', x === 180 ? 'vertical' : '', 'bottom'); });
        g.hline(m.vMean, 'ref', 'rotation mean', 'start');
        if (showTwin) twinTurns.forEach(function (t) { g.path(t, 's2'); });
        g.path(closed, 's1');
      },
      tooltip: function (i) {
        var deg = xs[i], v = closed[i][1];
        var rows = [{ value: fmtV(v), label: 'closed form', color: c1 }];
        var dots = [{ y: v, cls: 'dot1' }];
        if (showTwin) twinTurns.forEach(function (t, k) {
          var tv = interpTurn(t, deg);
          if (tv !== null) { rows.push({ value: fmtV(tv), label: 'twin, turn ' + (k + 1), color: c2 }); dots.push({ y: tv, cls: 'dot2' }); }
        });
        return { head: 'θ = ' + deg + '° · ' + (deg % 180 === 0 ? 'vertical' : deg % 180 === 90 ? 'horizontal' : 'from vertical'), rows: rows, dots: dots };
      },
    });
    $('ca-sub').textContent = 'Tip speed relative to the centre of mass as the tether turns once in the orbiting frame. Fastest at the vertical, where the catch and the release happen; slowest at the horizontal.';
    $('ca-note').textContent = showTwin
      ? 'The orange lines are Skyhook\'s own 17-node twin (tools/twin/physics.js), run from its golden start by study.mjs and recorded; the page does not run it. It bends, so it wanders a few m/s off the rigid curve; the next chart shows by how much.'
      : 'The recorded twin run exists only for the canon case (' + c.tiers[0].label + ' tier, half-length ' + num(c.LKm, 0) + ' km, spin set at the vertical, R_E + altitude). At these settings there is no twin run to compare, so none is drawn.';
  }

  // ------------------------------------------------------------------ chart B: twin minus closed form
  function chartB() {
    if (!twinOk) {
      $('cb-body').hidden = true;
      $('cb-sub').textContent = '';
      $('cb-note').textContent = 'Refused: snapshots/twin-overlay.js is missing or was not recorded from the same twin commit as the canon snapshot. What would help: node ideas/16-spin-wobble/study.mjs --write.';
      return;
    }
    var swing = REF.vVertical - REF.vHorizontal;
    var lim = Math.max(0.1 * swing, Math.abs(TWIN.maxResidual)) * 1.15;
    var yT = ticks(-lim, lim, 5);
    var c2 = css('--s2');
    legend('cb-legend', [{ label: 'twin minus closed form, same tether angle', color: c2 }, { label: '±10 % of the closed-form swing', band: true }]);
    var series = twinResid.map(function (r) { return [r[0], r[1]]; });
    var xs = series.map(function (p) { return p[0]; });
    drawChart('chart-b', {
      x: [0, TWIN.durationS], y: [yT[0], yT[yT.length - 1]], yTicks: yT, xTicks: ticks(0, TWIN.durationS, 8).filter(function (t) { return t <= TWIN.durationS; }),
      xFmt: function (x) { return num(x, 0); }, yFmt: function (y) { return num(y, Math.abs(y) < 10 && y % 1 ? 1 : 0); },
      xTitle: 'time from the golden start, s', yTitle: 'm/s',
      hoverXs: xs, focusIndex: Math.floor(xs.length / 2),
      draw: function (g) {
        g.band(-0.1 * swing, 0.1 * swing);
        g.hline(0, 'axis');
        for (var k = 1; k * REF.halfPeriod <= TWIN.durationS; k++) g.vline(k * REF.halfPeriod, 'vmark', 'V' + k, 'top');
        g.path(series, 's2');
      },
      tooltip: function (i) {
        var r = twinResid[i];
        return {
          head: 't = ' + num(r[0], 0) + ' s',
          rows: [{ value: (r[1] >= 0 ? '+' : '−') + num(Math.abs(r[1]), 2) + ' m/s', label: 'twin − closed form', color: c2 },
            { value: fmtV(r[2]), label: 'twin', color: c2 }, { value: fmtV(r[3]), label: 'closed form', color: css('--s1') }],
          dots: [{ y: r[1], cls: 'dot2' }],
        };
      },
    });
    $('cb-sub').textContent = 'Recorded for the canon case whatever the controls say. V1–V4 mark where the closed form puts the verticals.';
    var facts = $('cb-facts'); clear(facts);
    function fact(dt, dd) { var d = el('div'); d.appendChild(el('dt', null, dt)); d.appendChild(el('dd', null, dd)); facts.appendChild(d); }
    fact('Largest gap, twin vs closed form', num(Math.abs(TWIN.maxResidual), 2) + ' m/s = ' + pct(Math.abs(TWIN.maxResidual) / swing, 1) + ' of the ' + num(swing, 1) + ' m/s swing');
    fact('Golden run\'s ' + num(gm.duration_s, 0) + ' s mean tip speed', fmtV(CANON.golden.mean_tip_speed_mps) + ' twin · ' + fmtV(goldenWindow.meanV) + ' closed form (' + spct((CANON.golden.mean_tip_speed_mps - goldenWindow.meanV) / CANON.golden.mean_tip_speed_mps, 4) + ')');
    fact('Verticals, twin / closed form', TWIN.verticals.map(function (x) { return num(x.t, 1) + ' / ' + num(x.k * REF.halfPeriod, 1); }).join(' · ') + ' s');
    fact('Tip speed at the twin\'s verticals', TWIN.verticals.map(function (x) { return num(x.v, 1); }).join(' · ') + ' m/s (closed form ' + fmtV(REF.vVertical) + ')');
    fact('Lower-tip periapsis, twin / closed form', TWIN.periapsis.map(function (t, k) { return num(t, 1) + ' / ' + num(2 * (k + 1) * REF.halfPeriod, 1); }).join(' · ') + ' s (inertial period ' + fmtS(REF.inertialPeriod) + ')');
    fact('Twin\'s port gate against golden.json', (TWIN.gate.pass ? 'pass' : 'FAIL') + ', positions within ' + TWIN.gate.maxRelPosErr.toExponential(1) + ' (verify.mjs allows 1e-3)');
    fact('Rigid body, exact gravity, the twin\'s own masses', 'within ' + num(TWIN.rigidBody.maxDiff, 3) + ' m/s of the closed form');
    $('cb-note').textContent = 'A rigid body with the twin\'s 17 masses under exact point-mass gravity stays on the closed form; making the twin 50 times stiffer axially leaves the gap as it is. What is left is the twin\'s chain bending sideways (up to ' + num(TWIN.maxBendDeg, 2) + '°), which a rigid model cannot have. That reading is [Likely]: study.mjs --sweeps shows it, it is not proven.';
  }

  // ------------------------------------------------------------------ chart C: dip against half-length
  function chartC(m) {
    var tier = c.tiers.filter(function (t) { return t.id === state.tier; })[0];
    var base = { mu: c.mu, R: c.radii[state.radius].km * 1e3, v0: tier.vKms * 1e3, theta0: state.theta0Deg * DEG, rEarth: c.rEarthKm * 1e3 };
    var Ls = [];
    for (var L = 10; L < c.altKm; L += 5) Ls.push(L);
    var sw = W.sweepHalfLength(base, Ls.map(function (x) { return x * 1e3; })).filter(function (p) { return p.ok; });
    var c1 = css('--s1'), c3 = css('--s3'), cr = css('--ink-2');
    legend('cc-legend', [{ label: 'exact (closed form)', color: c1 }, { label: 'first order, 1.5n²/(ω(ω−n))', color: c3 }, { label: 'docstring form, 1.5n²/ω²', color: cr, dash: true }]);
    if (!sw.length) { $('cc-note').textContent = 'No half-length gives a rotating tether at these settings.'; return; }
    var hi = Math.max.apply(null, sw.map(function (p) { return p.exact; })) * 100;
    var yT = ticks(0, hi * 1.08, 5);
    var xs = sw.map(function (p) { return p.L / 1e3; });
    drawChart('chart-c', {
      x: [0, c.altKm], y: [0, yT[yT.length - 1]], yTicks: yT, xTicks: ticks(0, c.altKm, 7).filter(function (t) { return t <= c.altKm; }), right: 14,
      xFmt: function (x) { return num(x, 0); }, yFmt: function (y) { return num(y, y % 1 ? 1 : 0); },
      xTitle: 'half-length, km', yTitle: 'dip, % of the vertical speed',
      hoverXs: xs, focusIndex: nearest(xs, m.ok ? m.LKm : c.LKm),
      draw: function (g) {
        g.path(sw.map(function (p) { return [p.L / 1e3, p.program * 100]; }), 'claim');
        g.path(sw.map(function (p) { return [p.L / 1e3, p.firstOrder * 100]; }), 's3');
        g.path(sw.map(function (p) { return [p.L / 1e3, p.exact * 100]; }), 's1');
        if (m.ok) {
          g.vline(m.LKm, 'vmark', '');
          g.dot(m.LKm, m.dipFromVertical * 100, 'dot1');
          var px = g.sx(m.LKm), py = g.sy(m.dipFromVertical * 100);
          var right = px < g.W * 0.6;
          g.label(px + (right ? -10 : -10), py - 14, num(m.LKm, 0) + ' km: ' + pct(m.dipFromVertical), 'end');
        }
      },
      tooltip: function (i) {
        var p = sw[i];
        return {
          head: 'L = ' + num(p.L / 1e3, 0) + ' km',
          rows: [{ value: pct(p.exact), label: 'exact', color: c1 }, { value: pct(p.firstOrder), label: 'first order', color: c3 }, { value: pct(p.program), label: 'docstring form', color: cr, dash: true }],
          dots: [{ y: p.exact * 100, cls: 'dot1' }, { y: p.firstOrder * 100, cls: 'dot3' }, { y: p.program * 100, cls: 'dotc' }],
        };
      },
    });
    $('cc-sub').textContent = 'Peak-to-trough dip at fixed tip speed (' + tier.label + ', ' + num(tier.vKms, 1) + ' km/s), as the half-length changes. A longer tether spins more slowly for the same tip speed, so the orbit\'s gradient matters more.';
    var a = W.fromCanon(c, Object.assign({}, state, { LKm: c.LKm / 2 })), b = W.fromCanon(c, Object.assign({}, state, { LKm: c.LKm }));
    $('cc-note').textContent = a.ok && b.ok
      ? 'Doubling the half-length from ' + num(c.LKm / 2, 0) + ' to ' + num(c.LKm, 0) + ' km multiplies the dip by ' + num(b.dipFromVertical / a.dipFromVertical, 2) + ', not 4: the dip goes as L²/(1 − nL/v), not L².'
      : '';
  }

  // ------------------------------------------------------------------ tiles, table
  function tiles(m) {
    $('t-vert').textContent = fmtV(m.vVertical);
    $('t-vert-s').textContent = state.theta0Deg === 0 ? 'the set value, exactly: the spin was set here'
      : spct(m.verticalVsV0) + ' above the ' + fmtV(m.inputs.v0) + ' set at ' + state.theta0Deg + '°';
    $('t-horiz').textContent = fmtV(m.vHorizontal);
    $('t-horiz-s').textContent = '−' + pct(m.dipFromVertical) + ' from the vertical value';
    $('t-mean').textContent = fmtV(m.vMean);
    $('t-mean-s').textContent = spct(m.vMean / m.vVertical - 1) + ' from the vertical value' + (state.theta0Deg === 0 ? '' : ' (' + spct(m.meanVsV0) + ' from the set value)');
    $('t-half').textContent = fmtS(m.halfPeriod);
    $('t-half-s').textContent = 'without the gradient ' + fmtS(m.halfPeriodNoGradient) + '; the same tip is at the bottom every ' + fmtS(2 * m.halfPeriod) + ' (' + num(2 * m.halfPeriod / 60, 2) + ' min). The inertial rotation period is ' + num(m.inertialPeriod / 60, 2) + ' min.';
  }

  function tierTable() {
    var t = $('tier-table'); clear(t);
    var head = el('tr');
    ['Tier', 'Tip speed set', 'n/ω', 'Dip, exact', 'First order', 'Docstring form', 'Rotation mean', 'Vertical to vertical'].forEach(function (h) { head.appendChild(el('th', { scope: 'col' }, h)); });
    var thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    var body = el('tbody');
    c.tiers.forEach(function (tier) {
      var m = W.fromCanon(c, Object.assign({}, state, { tier: tier.id }));
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row', class: 'nowrap' }, tier.label));
      if (!m.ok) {
        var td = el('td', { colspan: '7' }, 'refused (' + m.refusal.code + '): ' + m.refusal.reason);
        tr.appendChild(td);
      } else {
        [num(tier.vKms, 1) + ' km/s', num(m.nu, 4), pct(m.dipFromVertical), pct(m.firstOrderDip), pct(m.programDip),
          fmtV(m.vMean) + ' (' + spct(m.vMean / m.vVertical - 1) + ')', fmtS(m.halfPeriod) + ' (' + fmtS(m.halfPeriodNoGradient) + ' without)']
          .forEach(function (v) { tr.appendChild(el('td', { class: 'num' }, v)); });
      }
      body.appendChild(tr);
    });
    t.appendChild(body);
    $('tt-note').textContent = 'Tip speeds from rev_a.json: ' + c.tiers.map(function (x) { return x.label + ' ' + x.key; }).join('; ') +
      '. Each is taken as the speed at the angle the spin is set (' + state.theta0Deg + '° here), at the half-length and radius chosen above.';
  }

  // ------------------------------------------------------------------ claims (always at the canon)
  function claims() {
    var box = $('claims'); clear(box);
    var R = REF, H = W.fromCanon(c, { tier: 'reference', theta0Deg: 90 });
    var q = {}; CANON.claims.forEach(function (x) { q[x.id] = x; });
    var upMean = R.vVertical / R.vMean - 1, downMean = 1 - R.vHorizontal / R.vMean;
    var twinDip = twinTrough === null ? null : 1 - twinTrough / CANON.golden.checkpoints['0'].tip_speed_rel_com;
    var verdicts = {
      glossary: [
        ['partly', 'imprecise', 'Peak to trough is ' + pct(R.dipFromVertical) + ' of the vertical value, so “~3 %” is the right size. But it is one-sided: 0 to −' + pct(R.dipFromVertical) + ' below the vertical value, or +' + pct(upMean) + ' / −' + pct(downMean) + ' about the rotation mean, not ±3 %.'],
        ['holds', 'holds', 'The rotation mean is ' + pct(-R.meanVsV0) + ' below the vertical value for a spin set at the vertical. Set at the horizontal instead, the mean comes out ' + pct(H.meanVsV0) + ' above the set value: the spin-up phase decides the sign.'],
        ['wrong', 'sign reversed', 'Release and catch happen at the vertical, where the tip is fastest. Set the spin at the vertical and the release speed is the set value, no offset needed. A nominal spin quoted as the rotation mean must sit ' + pct(-R.meanVsV0) + ' below the target release speed, and one set at the horizontal ' + pct(R.dipFromVertical) + ' below it: never above.'],
        ['holds', 'can be upgraded', 'Labelled “[Likely — observed]”. The closed form derives it, [Certain] for a rigid tether, and reproduces the twin\'s golden run (see below).'],
      ],
      docstring: [
        ['partly', 'understated', '1.5n²/ω² gives ' + pct(R.programDip) + '. The rigid closed form gives ' + pct(R.dipFromVertical) + ' (first order 1.5n²/(ω(ω−n)) = ' + pct(R.firstOrderDip) + ')' + (twinDip === null ? '.' : ', and the twin\'s own first trough is ' + pct(twinDip) + ' below its start.') + ' The first integral holds for the spin relative to the orbiting frame; the tip speed is measured in inertial space.'],
        ['wrong', 'wrong', 'The time average over a modulation period is ' + fmtV(R.vMean) + ', ' + pct(-R.meanVsV0) + ' below v_tip: the exchange is one-sided, so averaging does not cancel it. And the modulation repeats every ' + fmtS(R.halfPeriod) + ' (vertical to vertical), not every ' + fmtS(R.inertialPeriod) + ' rotation, so whole rotations are not whole periods.'],
      ],
      catch: [
        ['partly', 'overstated', 'Peak to trough is ' + pct(R.dipFromVertical) + ' at this geometry. It also disagrees with the “~3 %” the same file states at lines ' + q.docstring.lineFrom + '–' + q.docstring.lineTo + '.'],
      ],
      periapsis: [
        ['wrong', 'wrong period', 'The lower tip is back at periapsis every ' + fmtS(2 * R.halfPeriod) + ' (closed form)' + (twinOk && TWIN.periapsis.length > 1 ? '; the recorded twin run reaches it at ' + fmtS(TWIN.periapsis[0]) + ' and again ' + fmtS(TWIN.periapsis[1] - TWIN.periapsis[0]) + ' later' : '') + '. ' + fmtS(R.inertialPeriod) + ' is the rotation in inertial space; periapsis is a position relative to the Earth, and the frame turns with the orbit (' + fmtS(2 * R.halfPeriodNoGradient) + ' without the gradient). The note\'s own first catch time fits the closed form.'],
      ],
    };
    var order = ['glossary', 'docstring', 'catch', 'periapsis'];
    order.forEach(function (id) {
      var claim = q[id];
      if (!claim) return;
      var row = el('div', { class: 'claim-row' });
      var left = el('div', { class: 'claim-q' });
      left.appendChild(el('blockquote', null, claim.text));
      left.appendChild(el('span', { class: 'claim-src' }, claim.file + ':' + claim.lineFrom + (claim.lineTo !== claim.lineFrom ? '–' + claim.lineTo : '') + ' @ ' + claim.commit.slice(0, 7)));
      row.appendChild(left);
      var right = el('div');
      verdicts[id].forEach(function (vd) {
        var p = el('p', { class: 'claim-a' });
        var chip = el('span', { class: 'chip ' + vd[0] });
        chip.appendChild(el('span', { class: 'ic', 'aria-hidden': 'true' }, vd[0] === 'holds' ? '✓' : vd[0] === 'wrong' ? '✕' : '!'));
        chip.appendChild(document.createTextNode(vd[1]));
        p.appendChild(chip);
        p.appendChild(el('br'));
        p.appendChild(document.createTextNode(vd[2]));
        right.appendChild(p);
      });
      row.appendChild(right);
      box.appendChild(row);
    });
    // golden.json's own number, as a fifth row
    var row = el('div', { class: 'claim-row' });
    var left = el('div', { class: 'claim-q' });
    left.appendChild(el('blockquote', null, '"mean_tip_speed_mps": ' + CANON.golden.mean_tip_speed_mps));
    left.appendChild(el('span', { class: 'claim-src' }, CANON.golden.path + ' @ ' + CANON.golden.commit.slice(0, 7) + ' (the twin\'s golden run, ' + num(gm.duration_s, 0) + ' s from the vertical)'));
    row.appendChild(left);
    var rp = el('p', { class: 'claim-a' });
    var chip = el('span', { class: 'chip holds' });
    chip.appendChild(el('span', { class: 'ic', 'aria-hidden': 'true' }, '✓'));
    chip.appendChild(document.createTextNode('reproduced'));
    rp.appendChild(chip); rp.appendChild(el('br'));
    var dlt = CANON.golden.mean_tip_speed_mps - goldenWindow.meanV;
    rp.appendChild(document.createTextNode('The closed form, integrated over the same window at the same step (' + num(gm.dt * 1000, 2) + ' ms) and averaged the same way, gives ' + fmtV(goldenWindow.meanV) + ': ' + num(Math.abs(dlt), 2) + ' m/s (' + pct(dlt / CANON.golden.mean_tip_speed_mps, 4) + ') from the twin. The window is ' + num(gm.duration_s / R.halfPeriod, 2) + ' modulation periods, so its mean is not the rotation mean (' + fmtV(R.vMean) + ').'));
    var rr = el('div'); rr.appendChild(rp); row.appendChild(rr);
    box.appendChild(row);
    $('cl-sub').textContent = 'At the canon: ' + c.tiers[0].label + ' tier at ' + num(c.tiers[0].vKms, 1) + ' km/s, half-length ' + num(c.LKm, 0) + ' km, CoM radius ' + num(c.radii.twin.km, 0) + ' km (R_E + altitude, as the twin uses), spin set at the vertical. Quotes are verbatim from the snapshots.';
  }

  function provTable() {
    var t = $('prov-table'); clear(t);
    var head = el('tr');
    ['Snapshot', 'Skyhook source', 'sha256', 'What the page takes from it'].forEach(function (h) { head.appendChild(el('th', { scope: 'col' }, h)); });
    var th = el('thead'); th.appendChild(head); t.appendChild(th);
    var P = CANON.provenance;
    var rows = [
      [P.revA, 'μ, CoM altitude, com_radius_km, half-length, the three tier tip speeds, rotation_period_min'],
      [P.twin, 'R_EARTH_KM = ' + c.rEarthKm + ' (line ' + CANON.rEarthKm.line + '); run whole by study.mjs, never by the page'],
      [P.golden, 'the 600 s window, its step, its mean tip speed and checkpoint speeds'],
      [P.glossary, 'the claim at line ' + CANON.claims[0].lineFrom],
      [P.tetherDynamics, 'the docstring claims at lines ' + CANON.claims[1].lineFrom + '–' + CANON.claims[1].lineTo + ' and ' + CANON.claims[2].lineFrom],
      [P.visualQa, 'the periapsis claim at lines ' + CANON.claims[3].lineFrom + '–' + CANON.claims[3].lineTo],
    ];
    if (twinOk) rows.push([{ file: 'snapshots/twin-overlay.js', path: 'derived: study.mjs --write', commit: TWIN.source.twin.commit, sourceSha256: TWIN.source.twin.sourceSha256 }, 'the recorded twin run, port gate and rigid-body check']);
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r[0].file));
      tr.appendChild(el('td', null, r[0].path + ' @ ' + r[0].commit.slice(0, 7)));
      tr.appendChild(el('td', { class: 'num' }, r[0].sourceSha256.slice(0, 12) + '…'));
      tr.appendChild(el('td', null, r[1]));
      body.appendChild(tr);
    });
    t.appendChild(body);
  }

  // ------------------------------------------------------------------ controls
  function seg(id, items, key) {
    var box = $(id); clear(box);
    items.forEach(function (it) {
      var b = el('button', { type: 'button', 'aria-pressed': String(state[key] === it.id), 'data-id': it.id }, it.label);
      b.addEventListener('click', function () { state[key] = it.id; update(); });
      box.appendChild(b);
    });
  }
  function syncSeg(id, key) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === state[key])); });
  }
  seg('tiers', c.tiers.map(function (t) { return { id: t.id, label: t.label + ' ' + num(t.vKms, 1) + ' km/s' }; }), 'tier');
  seg('radii', [{ id: 'twin', label: num(c.radii.twin.km, 0) + ' km (R_E + altitude, twin)' }, { id: 'file', label: num(c.radii.file.km, 0) + ' km (com_radius_km)' }], 'radius');
  var len = $('len');
  len.min = '10'; len.max = String(Math.ceil((c.altKm + 40) / 10) * 10); len.value = String(c.LKm);
  len.addEventListener('input', function () { state.LKm = Number(len.value); update(); });
  var phase = $('phase');
  phase.addEventListener('input', function () { state.theta0Deg = Number(phase.value); update(); });
  $('reset').addEventListener('click', function () { state = Object.assign({}, CANON_STATE); len.value = String(c.LKm); phase.value = '0'; update(); });

  function stateNote() {
    var diffs = [];
    if (state.tier !== CANON_STATE.tier) diffs.push('tier');
    if (state.LKm !== c.LKm) diffs.push('half-length (canon ' + num(c.LKm, 0) + ' km)');
    if (state.theta0Deg !== 0) diffs.push('spin set at ' + state.theta0Deg + '° (canon: at the vertical)');
    if (state.radius !== 'twin') diffs.push('radius');
    $('state-note').textContent = diffs.length ? 'Changed from the canon: ' + diffs.join(', ') + '.' : 'The canon case: params/rev_a.json as it stands, spin set at the vertical, the twin\'s radius.';
  }

  function update() {
    syncSeg('tiers', 'tier'); syncSeg('radii', 'radius');
    $('len-out').textContent = num(state.LKm, 0) + ' km';
    $('phase-out').textContent = state.theta0Deg + '°';
    stateNote();
    var m = W.fromCanon(c, state);
    if (!m.ok) {
      showRefusal(m.refusal);
      ['results'].forEach(function (id) { $(id).hidden = true; });
      return;
    }
    $('refusal').hidden = true;
    $('results').hidden = false;
    tiles(m);
    chartA(m);
    chartB();
    chartC(m);
    tierTable();
  }

  claims();
  provTable();
  update();
  var raf = null;
  window.addEventListener('resize', function () {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { raf = null; if (!$('results').hidden) update(); });
  });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', update);
  }
})();
