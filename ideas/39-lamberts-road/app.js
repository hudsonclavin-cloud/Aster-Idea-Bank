/* Lambert's Road (idea 39): the page. All physics is in lambert.js; this file draws and wires controls. */
(function () {
  'use strict';
  var K = LambertsRoad.create({ constants: LambertAster, earth: LambertEarth, bodies: LambertBodies, refs: LambertRefs });
  var DRIFT = typeof LambertDrift !== 'undefined' ? LambertDrift : null, JPL = typeof LambertJPL !== 'undefined' ? LambertJPL : null;
  var DAY = 86400, AU = LambertAster.au_m, DEG = Math.PI / 180;

  // ------------------------------------------------------------------ small DOM helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c == null) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function f(v, d) { if (v == null || !isFinite(v)) return '—'; return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function g(v, s) { if (v == null || !isFinite(v)) return '—'; return Number(Number(v).toPrecision(s || 4)).toLocaleString('en-US', { maximumFractionDigits: 12 }); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
  function b64e(str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { var t = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var bin = atob(t), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function tile(k, v, u, conf, sub, cls) {
    return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [el('div', { class: 'k', text: k }), el('div', { class: 'v' }, [v, u ? el('span', { class: 'u', text: u }) : null]), sub ? (typeof sub === 'string' ? el('div', { class: 'sub', text: sub }) : sub) : null, conf ? el('span', { class: 'c', text: conf }) : null]);
  }
  function refusalBox(r) { return el('div', { class: 'refusal' }, [el('b', { text: (r.from ? r.from + ', ' : '') + (r.applies_to ? r.applies_to + ': ' : '') + 'refused (' + r.code + ')' }), el('span', { text: r.reason }), el('div', { class: 'help', text: 'What would help: ' + r.what_would_help })]); }
  function showStatus(kind, text) { var s = $('status'); s.className = 'status ' + (kind || ''); s.textContent = text; }
  function utcShort(t) { return K.utcOf(t).slice(0, 16).replace('T', ' '); }

  // ------------------------------------------------------------------ state
  var state = { S: K.defaults(), chain: null, R: null, cache: null, hover: null, label: null };
  var OBJ = { c3: { name: 'C3', unit: 'km²/s²', scale: 1e-6, log: true, cap: 100 }, dv_oneway: { name: 'ΔV one-way', unit: 'km/s', scale: 1e-3, cap: 20 }, dv_return: { name: 'ΔV sample return', unit: 'km/s', scale: 1e-3, cap: 30 }, vinf_arr: { name: 'arrival v∞', unit: 'km/s', scale: 1e-3, cap: 15 } };

  function compute() {
    var R = K.run(state.S, state.chain ? { chain: state.chain } : null, { gridCache: state.cache });
    if (!R.refusal && R.grid && R.gridKey) state.cache = { key: R.gridKey, grid: R.grid };
    state.R = R;
    return R;
  }

  // ------------------------------------------------------------------ controls
  var BODIES = LambertBodies.list.slice();
  function bodyLabel(b) { return b.name.indexOf(b.designation) === 0 || b.name.indexOf('(' + b.designation + ')') >= 0 ? b.name : b.designation + ' ' + b.name; }
  function fillTargets(filter) {
    var sel = $('tgtSel'), q = (filter || '').toLowerCase(), cur = state.S.target;
    clear(sel);
    var groups = { named: el('optgroup', { label: 'Mission targets and named bodies' }), 'low-c3': el('optgroup', { label: 'Lowest C3 in Aster\'s screening (condition code ≤ 5)' }) };
    BODIES.forEach(function (b) {
      var lab = bodyLabel(b);
      if (q && lab.toLowerCase().indexOf(q) < 0 && b.designation.toLowerCase().indexOf(q) < 0 && b.designation !== cur) return;
      var o = el('option', { value: b.designation, text: lab + ' · ' + b.orbitClass });
      if (b.designation === cur) o.selected = true;
      groups[b.why].appendChild(o);
    });
    if (groups.named.children.length) sel.appendChild(groups.named);
    if (groups['low-c3'].children.length) sel.appendChild(groups['low-c3']);
  }
  function syncControls() {
    var S = state.S, put = function (id, v) { var e = $(id); if (document.activeElement !== e) e.value = v; };
    put('depA', S.depStartUtc); put('depZ', S.depEndUtc); put('tofA', S.tofMinDays); put('tofZ', S.tofMaxDays);
    $('siteSel').value = S.site; $('resSel').value = S.nDep + 'x' + S.nTof;
    if (!$('resSel').value) $('resSel').value = '120x90';
    document.querySelectorAll('[data-revs]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-revs') === S.revs.join(',')); });
    document.querySelectorAll('[data-obj]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-obj') === S.objective); });
    document.querySelectorAll('[data-tgt]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tgt') === S.target); });
    if ($('tgtSel').value !== S.target) fillTargets($('tgtSearch').value);
    var b = K.findBody(S.target);
    if (b) {
      var c = b.cache && b.cache.best;
      $('tgtInfo').textContent = bodyLabel(b) + ': ' + b.orbitClass + (b.pha ? ', PHA' : '') + ', H ' + b.H + ', ~' + g(2 * b.estimatedRadiusM, 2) + ' m across (from H at Aster\'s assumed albedo), a ' + f(b.elements.aKm * 1000 / AU, 3) + ' au, e ' + f(b.elements.e, 3) + ', i ' + f(b.elements.iRad / DEG, 2) + '°, condition code ' + b.conditionCode + ', elements at ' + K.tdbDateOfJd(b.elements.epochTdbJd) + '.' + (c ? ' Aster\'s screening (direct only, 7-day grid): best C3 ' + g(c.c3, 3) + ' km²/s² leaving ' + c.launchDate + ' for ' + c.tofDays + ' d' + (K.targetRefusals(b, K.parseUtc(c.launchDate), K.parseUtc(c.launchDate) + c.tofDays * DAY).some(function (r) { return r.applies_to === 'target_ephemeris' || r.applies_to === 'arrival_geometry'; }) ? ', a window this page refuses (it arrives past an Earth encounter or inside Earth\'s sphere of influence).' : '.') : '');
    }
    var hasCell = (LambertRefs.cells || []).some(function (rc) { return rc.designation === S.target; });
    $('asterBtn').disabled = !hasCell;
  }
  function settingsChanged() { state.S.selection = null; render(); }

  // ------------------------------------------------------------------ colour ramp (viridis stops, reversed: low = bright)
  var RAMP = [[253, 231, 37], [94, 201, 98], [33, 145, 140], [59, 82, 139], [68, 1, 84]];
  function rampColor(u) {
    u = Math.max(0, Math.min(1, u)) * (RAMP.length - 1);
    var i = Math.min(RAMP.length - 2, Math.floor(u)), t = u - i, a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function valueScale(G, obj) {
    var o = OBJ[obj], vals = [];
    for (var k = 0; k < G.val.length; k++) if (isFinite(G.val[k]) && !G.unreliable[k]) vals.push(G.val[k] * o.scale);
    if (!vals.length) for (k = 0; k < G.val.length; k++) if (isFinite(G.val[k])) vals.push(G.val[k] * o.scale);
    vals.sort(function (a, b) { return a - b; });
    // the stretch: from the lowest reliable value to the median, capped (C3 100 km^2/s^2, delta-v 20/30 km/s, v-inf 15 km/s)
    var lo = vals.length ? vals[0] : 0, hi = vals.length ? Math.min(o.cap, vals[Math.floor(vals.length * 0.5)]) : 1;
    if (o.log) { lo = Math.max(lo, 0.01); hi = Math.max(hi, lo * 10); return { lo: lo, hi: hi, u: function (v) { return Math.log(Math.max(v, lo)) / Math.LN10 - Math.log(lo) / Math.LN10; }, span: Math.log(hi / lo) / Math.LN10, log: true }; }
    if (hi <= lo) hi = lo + 1;
    return { lo: lo, hi: hi, u: function (v) { return v - lo; }, span: hi - lo, log: false };
  }
  function contourLevels(sc, obj) {
    var o = OBJ[obj], out = [];
    if (o.log) [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300].forEach(function (L) { if (L > sc.lo && L < sc.hi * 3) out.push(L); });
    else { var step = sc.hi - sc.lo > 6 ? 2 : sc.hi - sc.lo > 2.5 ? 1 : 0.5; for (var L = Math.ceil(sc.lo / step) * step; L <= sc.hi * 1.5; L += step) out.push(L); }
    return out;
  }
  function patternOf(ctx, color, dir) {
    var c = document.createElement('canvas'); c.width = c.height = 7;
    var x = c.getContext('2d'); x.strokeStyle = color; x.lineWidth = 1.2; x.beginPath();
    if (dir > 0) { x.moveTo(0, 7); x.lineTo(7, 0); } else { x.moveTo(0, 0); x.lineTo(7, 7); }
    x.stroke();
    return ctx.createPattern(c, 'repeat');
  }

  // ------------------------------------------------------------------ porkchop
  var PK = { m: null };
  function sizeCanvas(cv, aspect, minH, maxH) {
    var w = cv.parentNode.clientWidth || 600, h = Math.min(maxH || 1e9, Math.max(minH, Math.round(w * aspect))), dpr = window.devicePixelRatio || 1;
    cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function dateTicks(t0, t1) {
    var span = (t1 - t0) / DAY, out = [], d0 = new Date(K.tdbToUtcMs(t0)), y = d0.getUTCFullYear(), m = d0.getUTCMonth();
    var step = span > 1500 ? 12 : span > 700 ? 6 : span > 300 ? 3 : 1;
    for (var k = 0; k < 400; k++) {
      var d = Date.UTC(y, m + k, 1), t = K.utcMsToTdb(d), mm = new Date(d).getUTCMonth();
      if (t > t1) break;
      if (t >= t0 && mm % step === 0) out.push({ t: t, label: step >= 12 || mm === 0 ? String(new Date(d).getUTCFullYear()) : new Date(d).toISOString().slice(0, 7) });
    }
    return out;
  }
  function niceStep(span, n) { var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), q = raw / p; return (q < 1.5 ? 1 : q < 3 ? 2 : q < 7 ? 5 : 10) * p; }
  function drawPork() {
    var R = state.R, G = R.grid, cv = $('pork'), z = sizeCanvas(cv, 0.62, 250), ctx = z.ctx, W = z.w, H = z.h;
    var m = { l: 46, r: 8, t: 8, b: 30 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    PK.m = { m: m, pw: pw, ph: ph, W: W, H: H };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = css('--refused'); ctx.fillRect(m.l, m.t, pw, ph);
    if (!G) return;
    var obj = state.S.objective, sc = valueScale(G, obj), o = OBJ[obj], nD = G.nDep, nT = G.nTof;
    var cw = pw / nD, chh = ph / nT;
    // cells
    var img = ctx.createImageData(nD, nT);
    for (var j = 0; j < nT; j++) for (var i = 0; i < nD; i++) {
      var k = j * nD + i, p = ((nT - 1 - j) * nD + i) * 4, v = G.val[k];
      if (!isFinite(v)) { img.data[p + 3] = 0; continue; }
      var c = rampColor(sc.u(v * o.scale) / sc.span);
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
    var off = document.createElement('canvas'); off.width = nD; off.height = nT; off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, m.l, m.t, pw, ph);
    // overlays: RED DLA (dark hatch), unreliable (red cross-hatch)
    var red = patternOf(ctx, 'rgba(0,0,0,0.55)', 1), bad = patternOf(ctx, css('--crit'), -1);
    for (j = 0; j < nT; j++) for (i = 0; i < nD; i++) {
      k = j * nD + i;
      var x = m.l + i * cw, y = m.t + (nT - 1 - j) * chh;
      if (G.unreliable[k]) { ctx.fillStyle = bad; ctx.fillRect(x, y, cw + 0.5, chh + 0.5); }
      else if (isFinite(G.dla[k]) && K.band(G.dla[k], state.S.site) === 'RED') { ctx.fillStyle = red; ctx.fillRect(x, y, cw + 0.5, chh + 0.5); }
    }
    // contours (marching squares on the scaled value)
    var X = function (i) { return m.l + (i + 0.5) * cw; }, Y = function (j) { return m.t + (nT - 1 - j + 0.5) * chh; };
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
    var labels = [];
    contourLevels(sc, obj).forEach(function (L) {
      ctx.beginPath(); var any = null;
      for (var jj = 0; jj < nT - 1; jj++) for (var ii = 0; ii < nD - 1; ii++) {
        var q = [G.val[jj * nD + ii], G.val[jj * nD + ii + 1], G.val[(jj + 1) * nD + ii + 1], G.val[(jj + 1) * nD + ii]].map(function (v) { return v * o.scale; });
        if (!q.every(isFinite)) continue;
        var pts = [], E = [[0, 1, ii, jj, ii + 1, jj], [1, 2, ii + 1, jj, ii + 1, jj + 1], [2, 3, ii + 1, jj + 1, ii, jj + 1], [3, 0, ii, jj + 1, ii, jj]];
        E.forEach(function (e) { var a = q[e[0]] - L, b = q[e[1]] - L; if ((a < 0) !== (b < 0)) { var t = a / (a - b); pts.push([X(e[2] + (e[4] - e[2]) * t), Y(e[3] + (e[5] - e[3]) * t)]); } });
        if (pts.length >= 2) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); if (!any) any = pts[0]; }
        if (pts.length === 4) { ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); }
      }
      ctx.stroke();
      if (any) labels.push([any, L]);
    });
    // axes
    var t0 = G.deps[0], t1 = G.deps[nD - 1], y0 = G.tofs[0] / DAY, y1 = G.tofs[nT - 1] / DAY;
    var xOf = function (t) { return m.l + (t - t0) / (t1 - t0) * (pw - cw) + cw / 2; }, yOf = function (d) { return m.t + ph - chh / 2 - (d - y0) / (y1 - y0) * (ph - chh); };
    PK.xOf = xOf; PK.yOf = yOf; PK.t0 = t0; PK.t1 = t1; PK.y0 = y0; PK.y1 = y1; PK.cw = cw; PK.chh = chh;
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--axis');
    ctx.beginPath(); ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, m.t + ph); ctx.lineTo(m.l + pw, m.t + ph); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var ticks = dateTicks(t0, t1), lastX = -1e9;
    ticks.forEach(function (tk) { var x = xOf(tk.t); ctx.beginPath(); ctx.moveTo(x, m.t + ph); ctx.lineTo(x, m.t + ph + 4); ctx.stroke(); var w = ctx.measureText(tk.label).width; if (x - w / 2 > lastX + 6 && x + w / 2 < W) { ctx.fillText(tk.label, x, m.t + ph + 6); lastX = x + w / 2; } });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var st = niceStep(y1 - y0, Math.max(3, Math.floor(ph / 40)));
    for (var d = Math.ceil(y0 / st) * st; d <= y1; d += st) { var yy = yOf(d); ctx.beginPath(); ctx.moveTo(m.l - 4, yy); ctx.lineTo(m.l, yy); ctx.stroke(); ctx.fillText(String(d), m.l - 6, yy); }
    ctx.save(); ctx.translate(11, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('flight time (days)', 0, 0); ctx.restore();
    // contour labels
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    var placed = [];
    labels.forEach(function (lb) { var s = g(lb[1], 2), tw = ctx.measureText(s).width, lx = Math.max(m.l + 2, Math.min(m.l + pw - tw - 3, lb[0][0] + 2)), ly = Math.max(m.t + 13, Math.min(m.t + ph - 2, lb[0][1] - 1));
      if (placed.some(function (p) { return Math.abs(p[0] - lx) < 26 && Math.abs(p[1] - ly) < 13; })) return; placed.push([lx, ly]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(s, lx, ly); ctx.fillStyle = '#fff'; ctx.fillText(s, lx, ly); });
    ctx.lineWidth = 1;
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    // encounter lines: arrival = encounter epoch
    G.encounters.forEach(function (e) {
      ctx.strokeStyle = css('--crit'); ctx.setLineDash([6, 3]); ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(xOf(t0), yOf((e.t - t0) / DAY)); ctx.lineTo(xOf(t1), yOf((e.t - t1) / DAY)); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    });
    // the chain's departure epoch
    if (R.chain && R.chain.departure && R.chain.departure.tdb >= t0 && R.chain.departure.tdb <= t1) { ctx.strokeStyle = css('--s1'); ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xOf(R.chain.departure.tdb), m.t); ctx.lineTo(xOf(R.chain.departure.tdb), m.t + ph); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
    // markers
    if (G.min) { var mx = xOf(G.min.depTdb), my = yOf(G.min.tofS / DAY); ctx.fillStyle = css('--s3'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(mx, my - 7); ctx.lineTo(mx + 6, my + 5); ctx.lineTo(mx - 6, my + 5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    (LambertRefs.cells || []).forEach(function (rc) {
      if (rc.designation !== state.S.target) return;
      var ax = xOf(rc.depTdb), ay = yOf(rc.tofDays);
      if (ax < m.l || ax > m.l + pw || ay < m.t || ay > m.t + ph) return;
      ctx.fillStyle = css('--s2'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ax, ay - 6); ctx.lineTo(ax + 6, ay); ctx.lineTo(ax, ay + 6); ctx.lineTo(ax - 6, ay); ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    if (R.selection) { var sx = xOf(R.selection.depTdb), sy = yOf(R.selection.tofS / DAY); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 2 * Math.PI); ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.restore(); ctx.lineWidth = 1;
    // ramp under the chart
    var rc = $('ramp'), rz = sizeCanvas(rc, 0, 34), rx = rz.ctx;
    rx.clearRect(0, 0, rz.w, 34);
    var rw = rz.w - m.l - m.r;
    for (var s = 0; s < rw; s++) { var cc = rampColor(s / rw); rx.fillStyle = 'rgb(' + cc.map(Math.round).join(',') + ')'; rx.fillRect(m.l + s, 2, 1.5, 12); }
    rx.fillStyle = css('--muted'); rx.font = '11px system-ui, sans-serif'; rx.textBaseline = 'top';
    rx.textAlign = 'left'; rx.fillText(g(sc.lo, 3) + ' ' + o.unit, m.l, 17);
    rx.textAlign = 'right'; rx.fillText('≥ ' + g(sc.hi, 3) + (sc.log ? ' (log scale)' : ''), m.l + rw, 17);
    rx.textAlign = 'center'; rx.fillText(o.name, m.l + rw / 2, 17);
  }
  function cellAt(ev) {
    var R = state.R, G = R && R.grid; if (!G || !PK.m) return null;
    var rect = $('pork').getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top, m = PK.m.m;
    var i = Math.floor((x - m.l) / PK.cw), j = G.nTof - 1 - Math.floor((y - m.t) / PK.chh);
    if (i < 0 || j < 0 || i >= G.nDep || j >= G.nTof) return null;
    return { i: i, j: j, x: x, y: y };
  }
  function cellText(i, j) {
    var G = state.R.grid, k = j * G.nDep + i, fam = K.famOf(G.fam[k]), o = OBJ[state.S.objective];
    var s = K.dateOf(G.deps[i]) + ' + ' + Math.round(G.tofs[j] / DAY) + ' d';
    if (!fam) return s + ': no transfer in these families';
    s += ': ' + o.name + ' ' + g(G.val[k] * o.scale, 3) + ' ' + o.unit + (state.S.objective === 'c3' ? '' : ' · C3 ' + g(G.c3[k] / 1e6, 3)) + ' · v∞ arr ' + g(G.vinfArr[k] / 1000, 3) + ' km/s · DLA ' + (isFinite(G.dla[k]) ? f(G.dla[k], 1) + '°' : '—') + ' · ' + (fam.M ? fam.M + ' rev ' + fam.branch : 'direct');
    if (G.unreliable[k]) s += ' · REFUSED: arrives past an Earth encounter';
    return s;
  }
  function selectCell(i, j) {
    var G = state.R.grid, k = j * G.nDep + i, fam = K.famOf(G.fam[k]);
    if (!fam) { showStatus('bad', 'No transfer at ' + K.dateOf(G.deps[i]) + ' + ' + Math.round(G.tofs[j] / DAY) + ' d in these families.'); return; }
    state.S.selection = { depTdb: G.deps[i], tofS: G.tofs[j], M: fam.M, branch: fam.branch, source: 'clicked', i: i, j: j };
    render(true);
  }

  // ------------------------------------------------------------------ orbit view (ecliptic top view)
  function drawOrbit() {
    var R = state.R, cv = $('orbit'), z = sizeCanvas(cv, 0.7, 260, 560), ctx = z.ctx, W = z.w, H = z.h;
    ctx.clearRect(0, 0, W, H);
    var tr = R.transfer, b = R.body; if (!tr || !b) return;
    var ecl = function (r) { var e = K.toEcliptic(r); return [e[0] / AU, e[1] / AU]; };
    var earthPts = [], t0 = tr.depTdb, span = K.earthSpan;
    for (var k = 0; k <= 120; k++) { var t = Math.min(span.end, Math.max(span.start, t0 + k / 120 * 365.25 * DAY)); var E = K.earthState(t); if (E) earthPts.push(ecl(E.r)); }
    var a = b.elements.aKm * 1000, P = 2 * Math.PI * Math.sqrt(a * a * a / LambertAster.gmSun_m3_s2), astPts = [];
    for (k = 0; k <= 200; k++) { var s = K.bodyState(b, t0 + k / 200 * P); if (s) astPts.push(ecl(s.r)); }
    var arc = tr.arc.filter(Boolean).map(ecl);
    var flownPts = [];
    if (R.flown) { var Ef = R.flown.earth, v0 = [Ef.v[0] + R.flown.vinfFlown[0], Ef.v[1] + R.flown.vinfFlown[1], Ef.v[2] + R.flown.vinfFlown[2]]; for (k = 0; k <= 120; k++) { var p = LambertsRoad.propagate(Ef.r, v0, (tr.arrTdb - R.flown.departTdb) * k / 120, LambertAster.gmSun_m3_s2); if (p) flownPts.push(ecl(p.r)); } }
    var rmax = 1.15;
    [earthPts, astPts, arc].forEach(function (L) { L.forEach(function (q) { rmax = Math.max(rmax, Math.hypot(q[0], q[1]) * 1.06); }); });
    rmax = Math.min(rmax, 6);
    var cx = W / 2, cy = H / 2, sc = (Math.min(W, H) / 2 - 14) / rmax;
    var X = function (q) { return cx + q[0] * sc; }, Y = function (q) { return cy - q[1] * sc; };
    ctx.strokeStyle = css('--grid'); ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (var ring = 1; ring <= Math.floor(rmax); ring++) { ctx.beginPath(); ctx.arc(cx, cy, ring * sc, 0, 2 * Math.PI); ctx.stroke(); ctx.fillText(ring + ' au', cx + ring * sc * 0.71 + 2, cy - ring * sc * 0.71); }
    function line(L, color, width, dash) { if (L.length < 2) return; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(X(L[0]), Y(L[0])); for (var i = 1; i < L.length; i++) ctx.lineTo(X(L[i]), Y(L[i])); ctx.stroke(); ctx.setLineDash([]); }
    line(earthPts, css('--s1'), 1.5); line(astPts, css('--s2'), 1.5, [5, 3]); line(arc, css('--ink'), 2.5);
    if (flownPts.length) line(flownPts, css('--s3'), 1.5, [2, 3]);
    function dot(q, color, rr, hollow) { ctx.beginPath(); ctx.arc(X(q), Y(q), rr, 0, 2 * Math.PI); if (hollow) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); } else { ctx.fillStyle = color; ctx.fill(); } }
    ctx.fillStyle = css('--warn'); ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 2 * Math.PI); ctx.fill();
    dot(ecl(tr.cell.earth.r), css('--s1'), 5);
    var Ea = K.earthState(tr.arrTdb); if (Ea) dot(ecl(Ea.r), css('--s1'), 5, true);
    dot(ecl(tr.cell.target.r), css('--s2'), 5);
    var leg = clear($('orbitLegend'));
    [['Earth\'s orbit (Horizons)', 's1', ''], [b.designation + ' (Aster\'s elements, two-body)', 's2', 'dash'], ['the transfer (' + (tr.M ? tr.M + ' revolution' + (tr.M > 1 ? 's' : '') + ', ' + tr.branch : 'direct') + ')', 'ink', '']].concat(flownPts.length ? [['idea 38\'s departure, flown uncorrected', 's3', 'dash']] : []).forEach(function (q) {
      leg.appendChild(el('li', {}, [el('span', { class: 'key ' + q[2], style: 'border-color: var(--' + q[1] + ')' }), q[0]]));
    });
    leg.appendChild(el('li', {}, [el('span', { class: 'key dot', style: 'background: var(--s1)' }), 'Earth at departure (hollow: at arrival)']));
    leg.appendChild(el('li', {}, [el('span', { class: 'key dot', style: 'background: var(--s2)' }), 'the asteroid at arrival']));
    $('orbitCap').textContent = 'Seen from the north ecliptic pole (J2000), the vernal equinox to the right. Transfer orbit a ' + f(tr.elements.a / AU, 3) + ' au, e ' + f(tr.elements.e, 3) + ', i ' + f(tr.elements.i / DEG, 2) + '° to the ecliptic; it sweeps ' + f(tr.transferAngleDeg, 1) + '° in ' + f(tr.tofS / DAY, 1) + ' days.';
  }

  // ------------------------------------------------------------------ the chosen window
  function renderSelection() {
    var R = state.R, tr = R.transfer, T = clear($('selTiles'));
    if (!tr) { $('selLine').textContent = 'No transfer selected.'; return; }
    var q = tr.sol, sl = R.selection;
    $('selLine').textContent = (sl.source === 'aster_cell' ? 'Aster\'s cell, the one ideas 37 and 38 flew' : sl.source === 'grid_minimum' ? 'The grid\'s best (reliable) cell' : sl.source === 'refined' ? 'Refined to the local minimum' : 'Your cell') + ': ' + bodyLabel(R.body) + '.';
    T.appendChild(tile('Departure (UTC)', utcShort(tr.depTdb), '', 'derived', 'TDB ' + f(tr.depTdb, 0) + ' s past J2000', 'hero date'));
    T.appendChild(tile('Arrival (UTC)', utcShort(tr.arrTdb), '', 'derived', 'TDB ' + f(tr.arrTdb, 0) + ' s past J2000', 'hero date'));
    T.appendChild(tile('Time of flight', f(tr.tofS / DAY, 2), 'days', 'derived', tr.M ? tr.M + ' revolution' + (tr.M > 1 ? 's' : '') + ', ' + tr.branch + ' branch' : 'direct (no full revolution)'));
    T.appendChild(tile('C3 at departure', g(q.c3 / 1e6, 4), 'km²/s²', 'derived', 'v∞ ' + f(q.vInfDep / 1000, 4) + ' km/s', 'hero'));
    var bandEl = el('span', {}, [f(q.dlaDeg, 2) + '°', q.band ? el('span', { class: 'band ' + q.band, text: q.band }) : null]);
    T.appendChild(tile('DLA (declination)', bandEl, '', 'derived', 'RLA ' + f(q.rlaDeg, 2) + '°; band for ' + LambertAster.sites[state.S.site].name));
    T.appendChild(tile('Arrival v∞', f(q.vInfArr / 1000, 4), 'km/s', 'derived', 'the rendezvous burn, impulsive'));
    T.appendChild(tile('Injection ΔV', f(q.dv.injection_m_s / 1000, 4), 'km/s', 'derived', 'vis-viva from Aster\'s 6,578 km orbit'));
    T.appendChild(tile('Aster\'s ΔV stack', f(q.dv.total_oneway_m_s / 1000, 3), 'km/s', 'derived', 'one way; sample return ' + f(q.dv.total_return_m_s / 1000, 3) + ' km/s (with 10 % margin)'));
    T.appendChild(tile('Transfer orbit', f(tr.elements.a / AU, 4), 'au', 'derived', 'e ' + f(tr.elements.e, 4) + ', i ' + f(tr.elements.i / DEG, 3) + '°, q ' + f(tr.elements.q / AU, 3) + ', Q ' + f(tr.elements.Q / AU, 3) + ' au'));
    T.appendChild(tile('Earth distance at arrival', tr.earthDistanceArrival_m == null ? '—' : f(tr.earthDistanceArrival_m / AU, 3), 'au', 'derived', tr.elongationArrivalDeg == null ? null : 'solar elongation ' + f(tr.elongationArrivalDeg, 1) + '°'));
    if (R.asterCell && R.asterCell.sol) T.appendChild(tile('Against Aster\'s cell', f(R.asterCell.dv_m_s * 1000, 3), 'mm/s', 'measured', 'v∞ difference from Aster\'s vector, ' + R.asterCell.ref.depDate));
    var own = R.refusals.filter(function (r) { return !r.from; }), carried = R.refusals.filter(function (r) { return r.from; });
    var box = clear($('refusals')); own.forEach(function (r) { box.appendChild(refusalBox(r)); });
    var cl = clear($('carriedList')); carried.forEach(function (r) { cl.appendChild(refusalBox(r)); });
    $('carried').style.display = carried.length ? '' : 'none';
    $('carriedSum').textContent = carried.length + ' refusal' + (carried.length === 1 ? '' : 's') + ' carried from ideas ' + Array.from(new Set(carried.map(function (r) { return r.from.slice(0, 2); }))).sort().join(', ');
  }

  // ------------------------------------------------------------------ the chain card
  function renderChain() {
    var R = state.R, body = clear($('chainBody')), T = clear($('chainTiles'));
    if (!R.chain) { body.appendChild(el('p', { text: 'No handoff imported: this page stands alone, opening on Aster\'s cell for Apophis, the transfer ideas 37 and 38 set out to fly. Paste or load idea 38\'s handoff below to carry its departure on (idea 38\'s own sample cannot depart; a closing one, such as idea 38 at 25 t of payload, can).' })); return; }
    var ch = R.chain;
    body.appendChild(el('p', { text: 'Imported idea 38\'s handoff' + (state.label ? ' (' + state.label + ')' : '') + '. ' + (ch.cellRef ? 'Its asymptote is Aster\'s cell (' + ch.cellRef.source + '), recognised by its vector.' : 'Its asymptote is not one of Aster\'s cells this page recognises.') }));
    if (!ch.departure) {
      body.appendChild(el('p', { text: 'Idea 38 hands on no hyperbolic departure state: its stage cannot make this departure (refusals below, from ideas 37 and 38). The transfer shown is the one the chain set out to fly.' }));
      return;
    }
    var F = R.flown;
    T.appendChild(tile('Idea 38 departs (UTC)', utcShort(ch.departure.tdb), '', 'derived', 'C3 ' + g(ch.departure.c3 / 1e6, 4) + ' km²/s²', 'date'));
    if (R.selection) T.appendChild(tile('Before the transfer\'s epoch by', f((R.selection.depTdb - ch.departure.tdb) / 3600, 2), 'h', 'derived', 'Aster\'s asymptote is for ' + utcShort(R.selection.depTdb)));
    if (!F) return;
    T.appendChild(tile('Uncorrected, at arrival', f(F.missAtArrival_m / 1000, 0), 'km from the asteroid', 'derived', 'two-body coast from Earth\'s centre', 'short'));
    T.appendChild(tile('Closest approach', f(F.closest.distance_m / 1000, 0), 'km', 'derived', utcShort(F.closest.tdb) + ', at ' + f(F.closest.relSpeed_m_s / 1000, 2) + ' km/s'));
    if (F.reaim) {
      T.appendChild(tile('Correction to re-aim', f(F.reaim.correction_m_s, 3), 'm/s', 'derived', 'at departure; module 40\'s first TCM', 'hero'));
      T.appendChild(tile('C3 needed from that epoch', g(F.reaim.c3Needed / 1e6, 5), 'km²/s²', 'derived', 'against ' + g(ch.departure.c3 / 1e6, 5) + ' flown'));
    }
  }

  // ------------------------------------------------------------------ checks against oracles (all live)
  function renderChecks() {
    var R = state.R, b = R.body, tb = $('checkTable').querySelector('tbody'); clear(tb);
    function row(name, why, theirs, ours, gap, bad) {
      tb.appendChild(el('tr', {}, [el('td', { 'data-k': 'Check' }, [name, why ? el('span', { class: 'why', text: why }) : null]), el('td', { 'data-k': 'Theirs', class: 'n', text: theirs }), el('td', { 'data-k': 'This page', class: 'n', text: ours }), el('td', { 'data-k': 'Gap', class: 'n ' + (bad ? 'gap-bad' : 'gap-ok'), text: gap })]));
    }
    var n = 0;
    if (R.asterCell && R.asterCell.sol) {
      var rc = R.asterCell.ref, vA = K.cell(b, rc.depTdb, rc.tofDays * DAY, { revs: [rc.M], earth: K.hermiteEphemeris(LambertRefs.earthRecords) }).sols.filter(function (s) { return s.converged && s.branch === rc.branch; })[0];
      var vv = function (v) { return '[' + v.map(function (x) { return f(x / 1000, 6); }).join(', ') + '] km/s'; };
      row('Aster\'s DLA-oracle cell', rc.depDate + ' 14:00 UTC + ' + f(rc.tofDays, 3) + ' d, M = 1 ' + rc.branch + ' (dla-oracle-m1-vectors.json; poliastro-matched)', vv(rc.vinfDep_m_s), vv(R.asterCell.sol.vinfDep), f(R.asterCell.dv_m_s * 1000, 3) + ' mm/s');
      var d2 = Math.hypot(vA.vinfDep[0] - rc.vinfDep_m_s[0], vA.vinfDep[1] - rc.vinfDep_m_s[1], vA.vinfDep[2] - rc.vinfDep_m_s[2]);
      row('… with Aster\'s own Earth', 'the same cell with Aster\'s cubic Hermite between its two daily Horizons records', vv(rc.vinfDep_m_s), vv(vA.vinfDep), g(d2 * 1e6, 2) + ' µm/s');
      n += 2;
    }
    var w = b.cache && b.cache.best;
    if (w) {
      var c = K.cell(b, K.parseUtc(w.launchDate), w.tofDays * DAY, { revs: [0] }), q = c.sols && c.sols[0];
      if (q && q.converged) { row('Aster\'s screening cache', 'best direct window: ' + w.launchDate + ' + ' + w.tofDays + ' d (lambert-screen-cache.json)', 'C3 ' + g(w.c3, 6) + ' · v∞ arr ' + g(w.vInfArr, 6), 'C3 ' + g(q.c3 / 1e6, 6) + ' · v∞ arr ' + g(q.vInfArr / 1000, 6), f(Math.abs(q.vInfDep - w.vInfDep * 1000) * 1000, 3) + ' mm/s in v∞'); n++; }
      var tArr = K.parseUtc(w.launchDate) + w.tofDays * DAY, rf = K.targetRefusals(b, K.parseUtc(w.launchDate), tArr).filter(function (r) { return r.applies_to === 'target_ephemeris' || r.applies_to === 'arrival_geometry'; });
      if (rf.length) { row('… is that window real?', 'its arrival, ' + K.dateOf(tArr) + ', is past an Earth encounter or inside Earth\'s sphere of influence', 'shown as best', 'refused', rf[0].reason.slice(0, 90) + '…', true); n++; }
    }
    var key = b.designation === '99942' ? 'apophis' : b.designation === '101955' ? 'bennu' : null;
    if (JPL && key) {
      var J = JPL[key], tA = state.R.P.depStart, tZ = state.R.P.depEnd, rows = J.selectedMissions.filter(function (m) { var t = (m[0] + 2400000.5 - 2451545) * DAY; return t >= tA && t <= tZ; });
      if (!rows.length) rows = J.selectedMissions.slice(0, 3);
      rows.slice(0, 6).forEach(function (m) {
        var t = (m[0] + 2400000.5 - 2451545) * DAY, tof = m[9] * DAY, cc = K.cell(b, t, tof, { revs: [0, 1, 2, 3] });
        if (!cc.ok) { row('JPL mission design, ' + K.dateOf(t), m[9] + ' d', 'v∞ ' + m[2] + ' km/s', 'refused', cc.refusal ? cc.refusal.reason.slice(0, 60) : '—', true); return; }
        var s = cc.sols[cc.best], ref = K.targetRefusals(b, t, t + tof).filter(function (r) { return r.applies_to === 'target_ephemeris' || r.applies_to === 'arrival_geometry'; });
        var gap = Math.abs(s.vInfDep / 1000 - m[2]) * 1000;
        row('JPL mission design: ' + K.dateOf(t) + ' + ' + m[9] + ' d', 'JPL\'s selected ballistic window (mdesign.api, orbit ' + J.object.md_orbit_id + ')' + (ref.length ? '; refused here: arrives past the 2029 encounter' : ''), 'v∞ ' + m[2] + ' / ' + m[3] + ' km/s', 'v∞ ' + f(s.vInfDep / 1000, 4) + ' / ' + f(s.vInfArr / 1000, 4) + ' km/s', f(gap, 1) + ' m/s' + (ref.length ? ' (refused)' : ''), ref.length > 0 || gap > 100);
        n++;
      });
    }
    if (DRIFT && R.transfer) {
      var T = DRIFT.bodies.filter(function (q) { return q.designation === b.designation; })[0];
      if (T) {
        var best = null; T.records.forEach(function (r) { var t = (r[0] - 2451545) * DAY; if (!best || Math.abs(t - R.transfer.arrTdb) < Math.abs(best.t - R.transfer.arrTdb)) best = { t: t, r: r }; });
        var s2 = K.bodyState(b, best.t), dd = Math.hypot(s2.r[0] / 1000 - best.r[1], s2.r[1] / 1000 - best.r[2], s2.r[2] / 1000 - best.r[3]);
        row('JPL\'s integrated orbit (Horizons)', 'the asteroid at ' + K.dateOf(best.t) + ', the JPL record nearest the arrival (Aster\'s Slice 18 drift-truth fixture)', 'n-body', 'two-body from Aster\'s elements', f(dd, 0) + ' km', dd > 1e6);
        n++;
      }
    }
    var Hh = typeof LambertHorizons9h !== 'undefined' ? LambertHorizons9h : null;
    if (Hh) {
      var herm = K.hermiteEphemeris(Hh.asterDaily), cp = 0, cv = 0, hp = 0, hv = 0;
      Hh.records.forEach(function (r) {
        var t = (r[0] - 2451545) * DAY, a = K.earthState(t), h = herm(t);
        cp = Math.max(cp, Math.hypot(a.r[0] / 1000 - r[1], a.r[1] / 1000 - r[2], a.r[2] / 1000 - r[3])); cv = Math.max(cv, Math.hypot(a.v[0] / 1000 - r[4], a.v[1] / 1000 - r[5], a.v[2] / 1000 - r[6]));
        hp = Math.max(hp, Math.hypot(h.r[0] / 1000 - r[1], h.r[1] / 1000 - r[2], h.r[2] / 1000 - r[3])); hv = Math.max(hv, Math.hypot(h.v[0] / 1000 - r[4], h.v[1] / 1000 - r[5], h.v[2] / 1000 - r[6]));
      });
      row('Earth between Aster\'s daily records', 'JPL Horizons every 9 h, 15 June to 15 July 2026 (fetched): worst position and velocity error', 'Aster\'s Hermite: ' + f(hp, 3) + ' km, ' + f(hv * 1e6, 2) + ' mm/s', 'Chebyshev: ' + f(cp, 3) + ' km, ' + f(cv * 1e6, 2) + ' mm/s', LambertEarth.fit.numbers.toLocaleString('en-US') + ' numbers vs ' + LambertEarth.fit.hermiteNumbers.toLocaleString('en-US'));
      n++;
    }
    $('checkCap').textContent = n + ' live comparisons for ' + bodyLabel(b) + '. Gaps in green are what the model leaves; red rows are where it would mislead, and this page refuses them.';
  }

  // ------------------------------------------------------------------ render
  var pending = false;
  function render(selOnly) {
    syncControls();
    var R = compute();
    if (R.refusal) { clear($('refusals')).appendChild(refusalBox(R.refusal)); $('gridNote').textContent = ''; return; }
    var G = R.grid, o = OBJ[state.S.objective];
    $('gridNote').textContent = G ? G.solved + ' of ' + (G.nDep * G.nTof) + ' cells solved' + (G.flagged ? ', ' + G.flagged + ' hatched in red (arrival past an Earth encounter or inside Earth\'s sphere of influence: refused)' : '') + (G.red ? ', ' + G.red + ' beyond the site\'s DLA ceiling (dark hatch)' : '') + '.' + (G.min ? ' Best ' + o.name + ': ' + g(G.min.value * o.scale, 4) + ' ' + o.unit + ' leaving ' + K.dateOf(G.min.depTdb) + ' for ' + Math.round(G.min.tofS / DAY) + ' d.' : '') + (G.rawMin && G.min && G.rawMin.value < G.min.value ? ' The raw minimum (' + g(G.rawMin.value * o.scale, 3) + ' ' + o.unit + ', ' + K.dateOf(G.rawMin.depTdb) + ' + ' + Math.round(G.rawMin.tofS / DAY) + ' d) is refused.' : '') : '';
    var leg = clear($('porkLegend'));
    [['tri', 'the grid\'s best reliable cell'], ['mark', 'the chosen window'], ['diam', 'Aster\'s cell (ideas 37 and 38)'], ['cross', 'refused: past an Earth encounter'], ['hatch', 'DLA beyond the site\'s ceiling']].concat(R.chain && R.chain.departure ? [['vline', 'idea 38\'s departure']] : []).forEach(function (q) { leg.appendChild(el('li', {}, [el('span', { class: 'key ' + q[0] }), q[1]])); });
    $('porkCap').textContent = 'Departure date (UTC) across, flight time up; colour: ' + o.name + ' of the ' + (state.S.revs.length > 1 ? 'family the colour prefers among ' + state.S.revs.map(function (m) { return m ? m + ' rev' : 'direct'; }).join(', ') : state.S.revs[0] ? state.S.revs[0] + '-revolution transfers' : 'direct transfers') + '. White lines are contours' + (G && G.encounters.length ? '; the red dashed line marks arrivals at the Earth encounter of ' + G.encounters.map(function (e) { return K.dateOf(e.t) + ' (' + g(e.distance_m / 1000, 3) + ' km, two-body)'; }).join(', ') : '') + '. Tap a cell to choose it; with the chart focused, arrow keys move and Enter refines.';
    drawPork(); renderSelection(); drawOrbit(); renderChain(); renderChecks();
    var src = $('srcLine');
    src.textContent = R.chain ? 'Carrying idea 38\'s handoff' + (R.chain.departure ? ': departed ' + utcShort(R.chain.departure.tdb) + ' UTC.' : ' (no departure: refused upstream).') : '';
  }
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; render(); }); }

  // ------------------------------------------------------------------ events
  $('tgtSearch').addEventListener('input', function () { fillTargets(this.value); });
  $('tgtSel').addEventListener('change', function () { state.S.target = this.value; settingsChanged(); });
  document.querySelectorAll('[data-tgt]').forEach(function (b) { b.addEventListener('click', function () { state.S.target = b.getAttribute('data-tgt'); $('tgtSearch').value = ''; fillTargets(''); settingsChanged(); }); });
  [['depA', 'depStartUtc'], ['depZ', 'depEndUtc']].forEach(function (p) { $(p[0]).addEventListener('change', function () { if (this.value) { state.S[p[1]] = this.value; settingsChanged(); } }); });
  [['tofA', 'tofMinDays'], ['tofZ', 'tofMaxDays']].forEach(function (p) { $(p[0]).addEventListener('change', function () { var v = Number(this.value); if (isFinite(v) && this.value !== '') { state.S[p[1]] = v; settingsChanged(); } }); });
  document.querySelectorAll('[data-revs]').forEach(function (b) { b.addEventListener('click', function () { state.S.revs = b.getAttribute('data-revs').split(',').map(Number); settingsChanged(); }); });
  document.querySelectorAll('[data-obj]').forEach(function (b) { b.addEventListener('click', function () { state.S.objective = b.getAttribute('data-obj'); state.cache = null; render(); }); });
  $('siteSel').addEventListener('change', function () { state.S.site = this.value; state.cache = null; render(); });
  $('resSel').addEventListener('change', function () { var p = this.value.split('x').map(Number); state.S.nDep = p[0]; state.S.nTof = p[1]; render(); });
  $('minBtn').addEventListener('click', function () { var G = state.R && state.R.grid; if (!G || !G.min) return; var fm = K.famOf(G.min.fam); state.S.selection = { depTdb: G.min.depTdb, tofS: G.min.tofS, M: fm.M, branch: fm.branch, source: 'grid_minimum' }; render(true); });
  function refineNow() {
    var R = state.R, sl = R && R.selection; if (!sl) return;
    var G = R.grid, bounds = { depStart: G.deps[0], depEnd: G.deps[G.nDep - 1], tofMin: G.tofs[0], tofMax: G.tofs[G.nTof - 1] };
    var m = K.refine(R.body, sl, state.S.objective, bounds);
    if (m.refusal) { showStatus('bad', m.refusal.reason); return; }
    state.S.selection = { depTdb: m.depTdb, tofS: m.tofS, M: m.M, branch: m.branch, source: 'refined' };
    showStatus('ok', 'Refined: ' + OBJ[state.S.objective].name + ' ' + g(m.value * OBJ[state.S.objective].scale, 5) + ' ' + OBJ[state.S.objective].unit + (m.onEdge ? ' (on the edge of the grid: the minimum may lie outside it)' : '') + '.');
    render(true);
  }
  $('refineBtn').addEventListener('click', refineNow);
  $('asterBtn').addEventListener('click', function () { var rc = (LambertRefs.cells || []).filter(function (c) { return c.designation === state.S.target; })[0]; if (!rc) return; if (state.S.revs.indexOf(rc.M) < 0) state.S.revs = [0, 1]; state.S.selection = { depTdb: rc.depTdb, tofS: rc.tofDays * DAY, M: rc.M, branch: rc.branch, source: 'aster_cell' }; render(true); });
  $('resetBtn').addEventListener('click', function () { state.S = K.defaults(); state.cache = null; $('tgtSearch').value = ''; fillTargets(''); render(); });
  var pork = $('pork');
  pork.addEventListener('pointermove', function (ev) { var c = cellAt(ev), tip = $('porkTip'); if (!c) { tip.style.display = 'none'; return; } tip.textContent = cellText(c.i, c.j); tip.style.display = 'block'; var wrapW = $('porkWrap').clientWidth, tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(wrapW - tw, c.x + 10)) + 'px'; tip.style.top = Math.max(0, c.y - 34) + 'px'; });
  pork.addEventListener('pointerleave', function () { $('porkTip').style.display = 'none'; });
  pork.addEventListener('click', function (ev) { var c = cellAt(ev); if (c) selectCell(c.i, c.j); });
  pork.addEventListener('keydown', function (ev) {
    var G = state.R && state.R.grid, sl = state.S.selection || state.R.selection; if (!G) return;
    var i = sl && sl.i != null ? sl.i : Math.round((state.R.selection.depTdb - G.deps[0]) / (G.deps[1] - G.deps[0])), j = sl && sl.j != null ? sl.j : Math.round((state.R.selection.tofS - G.tofs[0]) / (G.tofs[1] - G.tofs[0]));
    var mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
    if (mv) { ev.preventDefault(); selectCell(Math.max(0, Math.min(G.nDep - 1, i + mv[0])), Math.max(0, Math.min(G.nTof - 1, j + mv[1]))); var t = $('porkTip'); t.textContent = cellText(state.S.selection.i, state.S.selection.j); t.style.display = 'block'; t.style.left = '8px'; t.style.top = '8px'; }
    else if (ev.key === 'Enter') { ev.preventDefault(); refineNow(); }
  });
  window.addEventListener('resize', function () { if (state.R && !state.R.refusal) { drawPork(); drawOrbit(); } });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.R && !state.R.refusal) { drawPork(); drawOrbit(); } });

  // ------------------------------------------------------------------ handoff
  function currentHandoff() { return K.buildHandoff(state.R); }
  function doImport(text, label) {
    var h; try { h = JSON.parse(text); } catch (e) { showStatus('bad', 'Not imported: that is not JSON.'); return false; }
    if (h && h.from === '39-lamberts-road') {
      var p = K.parseHandoff(h);
      if (p.refusal) { showStatus('bad', 'Not imported: ' + p.refusal.reason + ' What would help: ' + p.refusal.what_would_help); return false; }
      state.chain = p.chain; state.S = JSON.parse(JSON.stringify(p.settings)); state.cache = null; state.label = label;
      showStatus('ok', 'Imported this page\'s handoff ' + label + ': recomputed and identical.'); render(); return true;
    }
    var ch = K.importBurnOut(h);
    if (ch.refusal) { showStatus('bad', 'Not imported: ' + ch.refusal.reason + ' What would help: ' + ch.refusal.what_would_help); return false; }
    state.chain = ch; state.label = label; state.S.selection = null;
    if (ch.cellRef) { state.S.target = ch.cellRef.designation; var d = K.dateOf(ch.cellRef.depTdb); if (K.parseUtc(d) < K.parseUtc(state.S.depStartUtc) || K.parseUtc(d) > K.parseUtc(state.S.depEndUtc)) { state.S.depStartUtc = K.defaults().depStartUtc; state.S.depEndUtc = K.defaults().depEndUtc; } if (state.S.revs.indexOf(ch.cellRef.M) < 0) state.S.revs = [0, 1]; }
    state.cache = null;
    showStatus('ok', 'Imported idea 38\'s handoff ' + label + (ch.departure ? ': it departs ' + utcShort(ch.departure.tdb) + ' UTC.' : ': it does not depart (its refusals travel on).'));
    render(); return true;
  }
  $('importBtn').addEventListener('click', function () { doImport($('importText').value, 'from the text box'); });
  $('importFile').addEventListener('change', function () { var fl = this.files && this.files[0]; if (!fl) return; var rd = new FileReader(); rd.onload = function () { doImport(String(rd.result), 'from ' + fl.name); }; rd.readAsText(fl); });
  $('clearChainBtn').addEventListener('click', function () { state.chain = null; state.label = null; state.S.selection = null; showStatus('', 'The chain is dropped: this page stands alone.'); render(); });
  $('copyBtn').addEventListener('click', function () { var s = JSON.stringify(currentHandoff()); if (navigator.clipboard) navigator.clipboard.writeText(s).then(function () { showStatus('ok', 'Copied (' + s.length + ' characters).'); }, function () { $('importText').value = s; showStatus('', 'The clipboard is not available here; the handoff is in the text box.'); }); else { $('importText').value = s; showStatus('', 'The handoff is in the text box.'); } });
  $('dlBtn').addEventListener('click', function () { var s = JSON.stringify(currentHandoff(), null, 1), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'application/json' })); a.download = 'lamberts-road-handoff.json'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0); showStatus('ok', 'Downloaded lamberts-road-handoff.json.'); });
  $('linkBtn').addEventListener('click', function () { var u = location.href.split('#')[0] + '#h=' + b64e(JSON.stringify(currentHandoff())); if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { showStatus('ok', 'Link copied (' + u.length + ' characters).'); }, function () { showStatus('', 'Link: ' + u.slice(0, 120) + '…'); }); else showStatus('', 'Link: ' + u.slice(0, 120) + '…'); });

  // ------------------------------------------------------------------ start
  fillTargets('');
  var m = /#h=([A-Za-z0-9_-]+)/.exec(location.hash || ''), ok = false;
  if (m) { try { ok = doImport(b64d(m[1]), 'from the link'); } catch (e) { showStatus('bad', 'The link\'s handoff could not be read: ' + e.message); } }
  if (!ok) render();
  window.LambertsRoadPage = { state: state, K: K, render: render, doImport: doImport, currentHandoff: currentHandoff };
})();
