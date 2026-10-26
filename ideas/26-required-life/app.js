/* app.js: the Required Life page. All arithmetic is in model.js; all numbers come from data.js
 * (snapshots of Skyhook at the commit shown on the page). Nothing is fetched. */
(function () {
  'use strict';
  var M = window.RequiredLife;
  var D = window.RequiredLifeData;
  var F = M.fmt;
  var $ = function (id) { return document.getElementById(id); };

  var TIER_WORDS = {
    reference: 'reference (GTO / high-elliptical)',
    cislunar_revenue_gated_option: 'cislunar, revenue-gated',
    phase3_growth_option: 'Phase 3 growth (Mars-class)',
  };
  var SHARE_CHOICES = [
    { key: 'length', t: 'Founding doc, by length', d: 'outer ' + D.founding.zylon_outer_lower_arm_km + ' km of one ' + D.revA.geometry.tether_half_length_km + ' km arm is Zylon' },
    { key: 'mass', t: 'Founding doc, by mass', d: 'same boundary, weighted along the EQ-6 taper' },
    { key: 'all', t: 'All HMPE', d: 'upper bound: every kilogram is HMPE' },
    { key: 'custom', t: 'Your own share', d: 'any value from 0 to 1' },
  ];

  var S = {
    tier: 'reference',
    column: 'Conservative',
    share: null,
    shareCustom: 0.9,
    fiber: null,
    convention: 'rolling',
    dm20: false,
    life: D.sourced.sk78_life_yr,
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function clean(md) {
    // display only: drop Markdown emphasis and table pipes; the tests check the raw line
    var t = md.replace(/\*\*/g, '').replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/^\s*-\s+/, '');
    if (/^\s*\|/.test(t)) {
      // a Markdown table row: keep the non-empty cells
      t = t.split('|').map(function (c) { return c.trim(); }).filter(function (c) { return c && c !== '—'; }).join(' · ');
    }
    return t;
  }
  function zylonKm() { return D.founding.zylon_outer_lower_arm_km; }
  function econ() { return M.economics(D, S.column, S.tier); }
  function shareValue(E) {
    if (S.share === 'length') return M.hmpeShareByLength(E, zylonKm());
    if (S.share === 'mass') return M.hmpeShareByMass(E, zylonKm());
    if (S.share === 'all') return 1;
    if (S.share === 'custom') return S.shareCustom;
    return null;
  }
  function repl(E, life) {
    return { f: shareValue(E), life: life, fiberPerKg: S.fiber, convention: S.convention };
  }
  function pct(v) { return v === 1 ? '100%' : F.pct(v, v < 0.995 ? 1 : 2); }
  function loadPct(E) { return Math.round(E.loadFraction * 100) + '%'; }
  function tierLabel(t) { return t.vTip.toFixed(1) + ' km/s'; }

  /* ---------------------------------------------------------------- controls ---- */

  function radios(container, name, items, current, onPick) {
    container.innerHTML = '';
    items.forEach(function (it) {
      var lab = document.createElement('label');
      var inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = name;
      inp.value = it.value;
      inp.checked = it.value === current;
      inp.addEventListener('change', function () { if (inp.checked) onPick(it.value); });
      lab.appendChild(inp);
      var span = document.createElement('span');
      span.innerHTML = it.html;
      lab.appendChild(span);
      container.appendChild(lab);
    });
  }

  function buildControls() {
    var tiers = M.tiers(D.revA);
    radios($('tier'), 'tier', tiers.map(function (t) { return { value: t.key, html: esc(tierLabel(t)) }; }), S.tier, function (v) { S.tier = v; render(); });
    radios($('column'), 'column', M.COLUMNS.map(function (c) { return { value: c, html: esc(c) }; }), S.column, function (v) { S.column = v; render(); });
    radios($('convention'), 'convention', [
      { value: 'rolling', html: 'Rolling' },
      { value: 'lumpy', html: 'Lumpy' },
    ], S.convention, function (v) { S.convention = v; render(); });

    var share = $('share');
    share.innerHTML = '';
    SHARE_CHOICES.forEach(function (c) {
      var lab = document.createElement('label');
      var inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'share';
      inp.value = c.key;
      inp.addEventListener('change', function () { if (inp.checked) { S.share = c.key; render(); } });
      lab.appendChild(inp);
      var span = document.createElement('span');
      span.innerHTML = '<span class="t">' + esc(c.t) + ' <span class="v" data-share="' + c.key + '"></span></span><span class="d">' + esc(c.d) + '</span>';
      lab.appendChild(span);
      share.appendChild(lab);
    });

    $('q-baseline').textContent = D.revA.materials.construction_baseline;
    $('q-founding').textContent = D.founding.sentence.replace(/\.$/, '');
    var fills = {
      'load-range': D.sourced.rev_a_load_low_pct + '–' + D.sourced.rev_a_load_high_pct + '\u202f%',
      'fiber-note': D.revA.economics._fiber_cost_note,
      'dm20-quote': '>' + D.sourced.dm20_creep_factor + '× slower than SK78',
      'anchor-load': D.sourced.sk78_life_load_pct + '\u202f%',
      'anchor-life': D.sourced.sk78_life_yr + ' years',
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-fill]'), function (el) {
      el.textContent = fills[el.getAttribute('data-fill')];
    });

    var sc = $('share-custom');
    sc.value = String(S.shareCustom);
    sc.addEventListener('input', function () { S.shareCustom = Number(sc.value); render(); });

    var fiber = $('fiber');
    fiber.addEventListener('input', function () {
      var raw = fiber.value.trim();
      S.fiber = raw === '' ? null : Number(raw);
      render();
    });
    $('fiber-clear').addEventListener('click', function () { fiber.value = ''; S.fiber = null; render(); fiber.focus(); });

    $('dm20').addEventListener('change', function () { S.dm20 = $('dm20').checked; render(); });

    var lr = $('life-range');
    var li = $('life');
    lr.value = String(lifeToSlider(S.life));
    li.value = String(S.life);
    lr.addEventListener('input', function () {
      S.life = Number(sliderToLife(Number(lr.value)).toPrecision(3));
      li.value = String(S.life);
      render();
    });
    li.addEventListener('input', function () {
      var raw = li.value.trim();
      S.life = raw === '' ? NaN : Number(raw);
      if (S.life > 0) lr.value = String(lifeToSlider(S.life));
      render();
    });
    window.addEventListener('resize', debounce(function () { renderChart(lastCtx); }, 120));
  }

  var L_MIN = 0.5;
  var L_MAX = 500;
  function sliderToLife(v) { return L_MIN * Math.pow(L_MAX / L_MIN, v / 1000); }
  function lifeToSlider(L) {
    var v = (1000 * Math.log(L / L_MIN)) / Math.log(L_MAX / L_MIN);
    return Math.max(0, Math.min(1000, Math.round(v)));
  }
  function debounce(fn, ms) {
    var t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ---------------------------------------------------------------- render ---- */

  var lastCtx = null;

  function render() {
    var E = econ();
    var rp = repl(E, S.life);
    var req = M.requiredLives(E, rp);
    var fw = M.forward(E, rp);
    var perUnit = M.requiredLives(E, { f: 1, fiberPerKg: S.fiber, convention: S.convention });
    lastCtx = { E: E, rp: rp, req: req, fw: fw };
    renderNotes(E);
    renderVerdict(E, rp, req, perUnit);
    renderRequired(E, rp, req);
    renderChart(lastCtx);
    renderForward(E, rp, fw);
  }

  function renderNotes(E) {
    var tierNote = S.tier === 'reference'
      ? 'Rev A reference: ' + E.vTip.toFixed(1) + ' km/s tip, ' + E.massRatio.toFixed(2) + '× payload, ' + F.sig(E.fiberMass_t, 4) + ' t of fiber in this column.'
      : 'Partial tier model, as finance/skyhook_finance.py runs it: only the tip speed changes (' + E.massRatio.toFixed(2) + '× payload, ' + F.sig(E.fiberMass_t, 4) + ' t); every other workbook input stays at reference values. Not this tier\'s business case.';
    $('tier-note').textContent = tierNote;
    var colNote = (S.column === 'Conservative' ? 'Rule 4 base case. ' : 'Sensitivity column, not the financial base case (Rule 4). ') +
      Math.round(E.derate * 100) + '% derate, $' + E.launchPerKg.toLocaleString('en-US') + '/kg construction launch, ' + F.money(E.fixedOps_M) + ' fixed ops a year. HMPE runs at (1 − derate)/SF = ' + loadPct(E) + ' of rated break.';
    $('column-note').textContent = colNote;
    $('convention-note').textContent = S.convention === 'rolling'
      ? 'Rolling: 1/L of the HMPE is replaced in every operating year from Y' + E.opsStart + '. The cost of keeping the machine, booked as an operating line (“costed into ops”, item 10).'
      : 'Lumpy: all of it at once at the end of each life, the first at the end of year ' + (E.opsStart - 1) + ' + L. Payback then asks only that the first swap fall after the payback year; the cost still recurs after it.';
    Array.prototype.forEach.call(document.querySelectorAll('[data-share]'), function (el) {
      var k = el.getAttribute('data-share');
      var v = k === 'length' ? M.hmpeShareByLength(E, zylonKm()) : k === 'mass' ? M.hmpeShareByMass(E, zylonKm()) : k === 'all' ? 1 : null;
      el.textContent = v == null ? '' : '· ' + pct(v);
    });
    $('share-custom-row').hidden = S.share !== 'custom';
    $('share-custom-out').textContent = pct(S.shareCustom);
    var badge = $('fiber-badge');
    if (S.fiber == null) { badge.textContent = 'unpriced'; badge.className = 'badge refuse'; }
    else if (!(S.fiber >= 0)) { badge.textContent = 'invalid'; badge.className = 'badge refuse'; }
    else { badge.textContent = 'your bracket, not a quote'; badge.className = 'badge warn'; }
    $('life-title').textContent = S.life > 0 ? F.short(S.life) : '…';
  }

  function chips(E, rp) {
    var out = [];
    out.push('<span class="badge spec">HMPE share ' + pct(rp.f) + ' [Speculative]</span>');
    out.push(S.fiber == null
      ? '<span class="badge refuse">fiber unpriced: a floor</span>'
      : '<span class="badge warn">fiber $' + esc(S.fiber) + '/kg: your bracket</span>');
    out.push('<span class="badge ok">' + (S.convention === 'rolling' ? 'rolling' : 'lumpy') + ' convention</span>');
    if (S.column !== 'Conservative') out.push('<span class="badge warn">' + esc(S.column) + ': sensitivity, not base case</span>');
    if (S.tier !== 'reference') out.push('<span class="badge warn">partial tier model</span>');
    return '<div class="chips">' + out.join('') + '</div>';
  }

  function renderVerdict(E, rp, req, perUnit) {
    var box = $('verdict');
    var body = $('verdict-body');
    var where = S.column + ' case at ' + E.vTip.toFixed(1) + ' km/s';
    var anchor = 'The only anchored point is about ' + D.sourced.sk78_life_yr + ' years for SK78 at ' + D.sourced.sk78_life_load_pct + '% of break and ' + D.sourced.sk78_life_temp_c + ' °C (secondary guidance, MP-001 §1).';
    if (req.refused) {
      box.className = 'card verdict refused';
      var html = '<p class="big"><strong>No required life yet.</strong> ' + esc(req.reason) + '</p>';
      if (req.code === 'hmpe_share_unset' && !perUnit.refused && perUnit.payback.length) {
        var pu = perUnit.payback[0];
        html += '<p>Whatever share you choose, the answer scales with it exactly: the ' + esc(where) + ' keeps its Y' + pu.target +
          ' payback only if the HMPE lasts at least <b>' + F.years(pu.life) + ' × the share</b> (' +
          (S.fiber == null ? 'launch at $' + E.launchPerKg.toLocaleString('en-US') + '/kg only, fiber unpriced' : 'launch $' + E.launchPerKg.toLocaleString('en-US') + '/kg + fiber $' + esc(S.fiber) + '/kg') + ').</p>';
      }
      html += '<p><b>What would help:</b> ' + esc(req.whatWouldHelp) + '</p>';
      body.innerHTML = html;
      return;
    }
    if (req.paybackRefusal) {
      box.className = 'card verdict refused';
      body.innerHTML = '<p class="big"><strong>No life is long enough.</strong> ' + esc(req.paybackRefusal.reason) + '</p>' +
        '<p>' + esc(req.paybackRefusal.whatWouldHelp) + '</p>' +
        '<p>Replacement would still cost: it exceeds the ' + F.money(E.fixedOps_M) + ' fixed-ops line unless the HMPE lasts ' + F.years(req.ops) +
        (req.floor ? ', and it outruns the whole mature operating margin below ' + F.years(req.floor) : '') + '.</p>' + chips(E, rp);
      return;
    }
    box.className = 'card verdict';
    var p0 = req.payback[0];
    var p1 = req.payback[1];
    var html2 = '<p class="big">The ' + esc(where) + ' needs the HMPE to last at least <strong>' + F.years(p0.life) + '</strong> at ' + loadPct(E) +
      ' of rated break for payback to stay at Y' + p0.target + '.</p>';
    if (p1) html2 += '<p>To slip by no more than a year (Y' + p1.target + ') it needs at least ' + F.years(p1.life) + '. ';
    else html2 += '<p>';
    html2 += anchor + ' Rev A loads its HMPE harder than that. The gap between them is what ST-002 and TP-001 must measure.</p>';
    if (S.convention === 'lumpy') html2 += '<p>Under the lumpy convention this asks only that the first swap fall after Y' + p0.target + '; each swap still costs ' + F.money(req.perEvent_M) + ' when it comes. The rolling convention prices the machine kept running.</p>';
    html2 += chips(E, rp);
    body.innerHTML = html2;
  }

  function renderRequired(E, rp, req) {
    var tb = $('required').querySelector('tbody');
    var refs = $('required-refusals');
    var lead = $('required-lead');
    var st = $('st002');
    tb.innerHTML = '';
    refs.innerHTML = '';
    st.innerHTML = '';
    $('required').parentNode.hidden = !!req.refused;
    if (req.refused) {
      lead.textContent = req.code === 'hmpe_share_unset' ? 'Nothing is computed until an HMPE share is chosen.' : 'Nothing is computed until the inputs are usable.';
      var titles = { hmpe_share_unset: 'No HMPE share chosen', hmpe_share_out_of_range: 'HMPE share out of range', fiber_price_invalid: 'Fiber price not usable' };
      refs.innerHTML = refusalHTML(titles[req.code] || 'Refused', req.reason, req.whatWouldHelp);
      return;
    }
    lead.innerHTML = 'HMPE share ' + pct(rp.f) + ', so each full replacement is ' + F.sig(rp.f * E.fiberMass_t, 4) + ' t at $' +
      req.costPerKg.toLocaleString('en-US') + '/kg (construction launch' + (S.fiber == null ? ' only; fiber unpriced' : ' + your fiber bracket') + ') = <b>' + F.money(req.perEvent_M) + '</b>.';
    var rows = [];
    req.payback.forEach(function (p) {
      rows.push({
        label: p.slip === 0 ? 'Payback stays at Y' + p.target : 'Payback by Y' + p.target + ' (slips at most ' + p.slip + ' year' + (p.slip > 1 ? 's' : '') + ')',
        sub: p.slip === 0 ? 'the base case, without replacement, pays back in Y' + p.target + (p.target > E.window ? ' (beyond the ' + E.window + '-year window, steady-state extrapolation)' : '') : '',
        v: F.years(p.life),
        head: p.slip === 0,
      });
    });
    if (req.window) rows.push({ label: 'Payback inside the ' + E.window + '-year window', sub: '', v: F.years(req.window.life) });
    rows.push({
      label: 'Replacement no dearer than the fixed-ops line',
      sub: F.money(E.fixedOps_M) + ' a year (workbook row ' + D.ladder.rows.fixed_ops_M.row + '); ' + (S.convention === 'lumpy' ? 'average cost per year' : 'per event ÷ L'),
      v: F.years(req.ops),
    });
    if (req.floor != null) {
      rows.push({
        label: 'Pays back at all',
        sub: 'replacement below the mature operating margin, revenue ' + F.money(E.revenue_M) + ' − variable ' + F.money(E.varCost_M) + ' − fixed ' + F.money(E.fixedOps_M) + ' = ' + F.money(E.matureMargin_M) + ' a year' + (S.convention === 'lumpy' ? ' (average)' : ''),
        v: F.years(req.floor),
      });
    }
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.head) tr.className = 'head';
      tr.innerHTML = '<td>' + esc(r.label) + (r.sub ? '<span class="sub">' + esc(r.sub) + '</span>' : '') + '</td><td class="num">' + esc(r.v) + '</td>';
      tb.appendChild(tr);
    });
    if (req.paybackRefusal) refs.innerHTML += refusalHTML('No payback life', req.paybackRefusal.reason, req.paybackRefusal.whatWouldHelp);
    if (req.windowRefusal) refs.innerHTML += refusalHTML('No ' + E.window + '-year-window life', req.windowRefusal.reason, req.windowRefusal.whatWouldHelp);

    // [Speculative] the ST-002 reading
    if (req.payback.length && req.payback[0].life > 0) {
      var Ls = req.payback[0].life;
      var sk = M.creepRatioThreshold(D.sourced.sk78_life_yr, Ls);
      var html = '<p><b>Reading for ST-002</b> <span class="badge spec">[Speculative]</span> Suppose life scales as 1/creep rate at a given load (a fixed allowable stretch reached at a steady rate: an assumption, not a measurement). ';
      if (sk < 1) {
        html += 'SK78\'s ' + D.sourced.sk78_life_yr + ' years at ' + D.sourced.sk78_life_load_pct + '% is already short of ' + F.years(Ls) + ', and creep does not slow as load rises, so under that assumption SK78 cannot meet this requirement at ' + loadPct(E) + '.</p>';
      } else {
        html += 'SK78 at ' + D.sourced.sk78_life_load_pct + '% outlasts ' + F.years(Ls) + ' by ' + F.sig(sk, 3) + '×; it meets the requirement at ' + loadPct(E) + ' only if creep there is at most ' + F.sig(sk, 3) + '× faster than at ' + D.sourced.sk78_life_load_pct + '%.</p>';
      }
      if (S.dm20) {
        var dm = M.creepRatioThreshold(D.sourced.sk78_life_yr * D.sourced.dm20_creep_factor, Ls);
        html += '<p>A DM20-class grade, at more than ' + F.years(D.sourced.sk78_life_yr * D.sourced.dm20_creep_factor) + ' at ' + D.sourced.sk78_life_load_pct + '% on the same assumption, meets it if creep at ' + loadPct(E) + ' runs no more than <b>' + F.sig(dm, 3) + '×</b> faster than at ' + D.sourced.sk78_life_load_pct + '%. ST-002 hangs coupons at ' + D.sourced.st002_low_pct + '% and ' + D.sourced.st002_high_pct + '% of break (MP-001 line ' + D.quotes.mp001_st002.line + '); creep rises with load, so their ' + D.sourced.st002_high_pct + '%/' + D.sourced.st002_low_pct + '% creep-rate ratio bounds the ' + loadPct(E) + '/' + D.sourced.sk78_life_load_pct + '% one from above, and a measured ratio at or under ' + F.sig(dm, 3) + ' would be enough, if the throw line creeps like the flight grade.</p>';
      } else {
        html += '<p>Tick the DM20 box to see the ratio a slower-creeping grade would need.</p>';
      }
      st.innerHTML = html;
    }
  }

  function refusalHTML(title, reason, help) {
    return '<div class="refusal" role="note"><h3>' + esc(title) + '</h3><p>' + esc(reason) + '</p><p><b>What would help:</b> ' + esc(help) + '</p></div>';
  }

  /* ---------------------------------------------------------------- chart ---- */

  function svgEl(name, attrs, text) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function renderChart(ctx) {
    var box = $('chart-box');
    var legend = $('legend');
    var cap = $('chart-caption');
    if (!ctx) return;
    var E = ctx.E;
    var req = ctx.req;
    box.innerHTML = '';
    legend.innerHTML = '';
    cap.textContent = '';
    if (req.refused) {
      box.innerHTML = '<div class="msg">Choose an HMPE share to draw payback against life.</div>';
      return;
    }
    var base = req.basePayback;
    if (base == null) {
      box.innerHTML = '<div class="msg">The base case does not pay back within ' + E.maxYears + ' years at this tier and column; there is no curve to draw.</div>';
      return;
    }
    var W = Math.max(300, Math.round(box.clientWidth || 600));
    var phone = W < 520;
    var H = phone ? 270 : 320;
    var m = { l: phone ? 46 : 54, r: 14, t: phone ? 62 : 66, b: 42 };
    var pw = W - m.l - m.r;
    var ph = H - m.t - m.b;
    var xLo = Math.log10(0.1);
    var xHi = Math.log10(1000);
    var yHi = Math.min(E.maxYears, base + (phone ? 8 : 10));
    var yLo = base - 1;
    var rowsN = yHi - yLo + 1; // plus the "later" band
    var X = function (L) { return m.l + ((Math.log10(L) - xLo) / (xHi - xLo)) * pw; };
    var Y = function (yr) { return m.t + ((yHi + 1 - yr) / rowsN) * ph; }; // yHi+1 = "later or never" band
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-labelledby': 'chart-title chart-desc' });
    var fs = phone ? 11 : 12;
    svg.appendChild(svgEl('title', { id: 'chart-title' }, 'Payback year against HMPE life'));
    var desc = 'Payback holds at Y' + base + ' for lives of at least ' + F.years(req.payback[0].life) + '. Anchored SK78 datum at ' + D.sourced.sk78_life_yr + ' years.';
    svg.appendChild(svgEl('desc', { id: 'chart-desc' }, desc));

    // never region
    if (req.floor != null && req.floor > 0.1) {
      var xf = X(Math.min(req.floor, 1000));
      svg.appendChild(svgEl('rect', { x: m.l, y: m.t, width: Math.max(0, xf - m.l), height: ph, style: 'fill: var(--never)' }));
    }
    // grid: decades
    [0.1, 1, 10, 100, 1000].forEach(function (L) {
      var x = X(L);
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: m.t, y2: m.t + ph, class: 'gr', 'stroke-width': 1 }));
      var t = svgEl('text', { x: x, y: m.t + ph + 16, 'text-anchor': 'middle', 'font-size': fs }, L < 1 ? '0.1' : String(L));
      svg.appendChild(t);
    });
    svg.appendChild(svgEl('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': fs }, 'HMPE life, years (log scale)'));
    // y rows
    var step = ph / rowsN >= fs + 3 ? 1 : 2;
    for (var yr = yLo; yr <= yHi; yr++) {
      var y = Y(yr);
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, class: 'gr', 'stroke-width': 1 }));
      if ((yr - yLo) % step === 0 || yr === base) svg.appendChild(svgEl('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': fs }, 'Y' + yr));
    }
    var yLater = Y(yHi + 1);
    svg.appendChild(svgEl('text', { x: m.l - 6, y: yLater + 4, 'text-anchor': 'end', 'font-size': fs }, 'later'));
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: Y(base), y2: Y(base), style: 'stroke: var(--soft)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
    // axes
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l, y1: m.t - 4, y2: m.t + ph, class: 'ax', 'stroke-width': 1 }));
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, class: 'ax', 'stroke-width': 1 }));

    // the step curve, sampled
    var n = 500;
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var L = Math.pow(10, xLo + ((xHi - xLo) * i) / n);
      var pb = M.paybackYear(E, { f: ctx.rp.f, fiberPerKg: ctx.rp.fiberPerKg, convention: ctx.rp.convention, life: L });
      var yy = pb == null || pb > yHi ? yHi + 1 : pb;
      pts.push([X(L), Y(yy)]);
    }
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var j = 1; j < pts.length; j++) {
      if (pts[j][1] !== pts[j - 1][1]) d += ' L' + pts[j][0].toFixed(1) + ' ' + pts[j - 1][1].toFixed(1) + ' L' + pts[j][0].toFixed(1) + ' ' + pts[j][1].toFixed(1);
    }
    d += ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + pts[pts.length - 1][1].toFixed(1);
    svg.appendChild(svgEl('path', { d: d, fill: 'none', style: 'stroke: var(--accent)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));

    // markers, labels stacked in rows above the plot
    var marks = [];
    var Ls = req.payback[0].life;
    marks.push({ L: Ls, color: 'var(--accent)', dash: '', label: 'needs ≥ ' + F.sig(Ls, 3) + ' yr', w: 2 });
    M.ticks(D.sourced, S.dm20).forEach(function (t) {
      marks.push({
        L: t.life,
        color: t.key === 'sk78' ? 'var(--warn)' : 'var(--spec)',
        dash: '5 3',
        label: (t.key === 'sk78' ? 'SK78 ≈ ' : 'DM20 > ') + t.life + ' yr @' + t.load + '%',
        w: 2,
      });
    });
    if (S.life > 0) marks.push({ L: S.life, color: 'var(--ink)', dash: '1 3', label: 'testing ' + F.short(S.life) + ' yr', w: 1.5, test: true });
    // each marker gets its own label row above the plot; lines are drawn first and the labels
    // on top with a halo in the panel colour, so a line crossing a label never hides it
    var rowH = fs + 2.5;
    var labels = [];
    marks.forEach(function (mk, k) {
      if (!(mk.L >= 0.1 && mk.L <= 1000)) return;
      var x = X(mk.L);
      var rowY = 12 + k * rowH;
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: rowY + 3, y2: m.t + ph, style: 'stroke: ' + mk.color, 'stroke-width': mk.w, 'stroke-dasharray': mk.dash }));
      var anchor = x > m.l + pw * 0.62 ? 'end' : 'start';
      labels.push(svgEl('text', {
        x: anchor === 'end' ? x - 4 : x + 4, y: rowY, 'text-anchor': anchor, 'font-size': fs,
        style: 'fill: ' + mk.color + '; font-weight: 600; paint-order: stroke; stroke: var(--panel); stroke-width: 4px; stroke-linejoin: round',
      }, mk.label));
      if (mk.test) {
        var pbT = M.paybackYear(E, ctx.rp);
        var yT = pbT == null || pbT > yHi ? yHi + 1 : pbT;
        svg.appendChild(svgEl('circle', { cx: x, cy: Y(yT), r: 4.5, style: 'fill: var(--panel); stroke: var(--ink)', 'stroke-width': 2 }));
      }
    });
    labels.forEach(function (t) { svg.appendChild(t); });
    box.appendChild(svg);

    var items = [
      ['sw', 'var(--accent)', 'payback year with the line'],
      ['sw dash', 'var(--warn)', 'anchored SK78 datum (20% load, secondary)'],
    ];
    if (S.dm20) items.push(['sw dash', 'var(--spec)', 'DM20 tick, ×' + D.sourced.dm20_creep_factor + ' [Speculative]']);
    items.push(['sw box', 'var(--never)', 'never pays back']);
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="' + it[0] + '" style="' + (it[0] === 'sw box' ? 'background:' : 'border-color:') + it[1] + '"></span>' + esc(it[2]);
      legend.appendChild(li);
    });
    cap.textContent = 'Payback is the first year cumulative net cash flow turns positive, as finance/skyhook_finance.py defines it; years past ' + E.window +
      ' are its steady-state extrapolation, and "later" means after Y' + yHi + ' or not within ' + E.maxYears + ' years. ' +
      (req.floor != null ? 'Shaded: lives under ' + F.years(req.floor) + ', where replacement outruns the mature operating margin. ' : '') +
      'Both ticks are at ' + D.sourced.sk78_life_load_pct + '% of break; this tether runs its HMPE at ' + loadPct(E) + '.';
  }

  /* ---------------------------------------------------------------- forward view ---- */

  function renderForward(E, rp, fw) {
    var out = $('forward-out');
    if (fw.refused) {
      out.innerHTML = refusalHTML(fw.code === 'life_invalid' ? 'No life to test' : 'Nothing to test yet', fw.reason, fw.whatWouldHelp);
      return;
    }
    var cells = [
      ['Replacement, per year', F.money(fw.annual_M), F.money(fw.perEvent_M) + ' per swap ÷ ' + F.short(rp.life) + ' yr' + (S.convention === 'lumpy' ? ', on average' : '')],
      ['Against fixed ops', F.sig(fw.shareOfFixedOps, 3) + '×', 'of the ' + F.money(E.fixedOps_M) + ' a year line'],
      ['Share of mature revenue', F.pct(fw.shareOfRevenue, 1), 'of ' + F.money(E.revenue_M) + ' a year'],
      ['Payback', F.yearLabel(fw.payback, E.maxYears), 'Y' + fw.basePayback + ' without the line' ],
      ['NPV@' + Math.round(E.npvRate * 100) + '%, ' + E.window + ' years', F.money(fw.npv_M), F.money(fw.baseNpv_M) + ' without'],
      S.convention === 'lumpy'
        ? ['Swaps inside ' + E.window + ' years', String(fw.eventsInWindow), 'first at end of year ' + F.sig(E.opsStart - 1 + rp.life, 3)]
        : ['Cumulative at Y' + E.window, F.money(fw.cumWindow_M), F.money(M.cumulative_M(E, E.window, null)) + ' without'],
    ];
    if (fw.basePayback == null) cells[3][2] = 'not within ' + E.maxYears + ' years without it either';
    out.innerHTML = '<div class="kv">' + cells.map(function (c) {
      return '<div><span class="k">' + esc(c[0]) + '</span><span class="v">' + esc(c[1]) + '</span><span class="s">' + esc(c[2]) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------------- static sections ---- */

  function renderEvidence() {
    $('commit').textContent = D.commit.slice(0, 7);
    var Q = D.quotes;
    var items = [
      ['item10_load', 'DECISION_LOG item 10: the load'],
      ['item10_outcomes', 'DECISION_LOG item 10: admissible outcomes; (a) is the one this page costs'],
      ['item10_evidence', 'DECISION_LOG item 10: what would close it'],
      ['item10_downstream', 'DECISION_LOG item 10: downstream actions'],
      ['mp001_creep_row', 'MP-001 §1: the only anchored life (secondary guidance)'],
      ['mp001_3c', 'MP-001 §3c'],
      ['mp001_st002', 'MP-001: ST-002'],
      ['lr001_D', 'LR-001 §D: the DM20 factor'],
      ['item6_triple', 'DECISION_LOG item 6: what the base model reproduces'],
      ['item8_npv', 'DECISION_LOG item 8'],
    ];
    var html = items.map(function (it) {
      var q = Q[it[0]];
      return '<div class="quote"><div class="where">' + esc(q.path) + ':' + q.line + '</div><p><b>' + esc(it[1]) + '.</b> ' + esc(clean(q.text)) + '</p></div>';
    }).join('');
    html += '<div class="quote"><div class="where">' + esc('docs/project_instructions.md') + ':' + D.founding.line + '</div><p><b>Founding document, Part IV §4.1: the only text that bounds the HMPE share.</b> ' + esc(D.founding.sentence) + '</p></div>';
    html += '<div class="quote"><div class="where">params/rev_a.json · materials.construction_baseline, economics.fiber_cost_per_kg</div><p><b>Canon.</b> “' + esc(D.revA.materials.construction_baseline) + '”; fiber_cost_per_kg: ' + String(D.revA.economics.fiber_cost_per_kg) + ' (“' + esc(D.revA.economics._fiber_cost_note) + '”).</p></div>';
    $('evidence').innerHTML = html;

    var not = [
      '<b>[Certain] An idea-bank prototype, not a Skyhook artefact.</b> It has not been through Rule 1 canon review (the HMPE share it asks for is not in <code>params/rev_a.json</code>), a verification memo, or the pytest suite.',
      '<b>Not a creep model.</b> It never turns ' + D.sourced.rev_a_load_low_pct + '–' + D.sourced.rev_a_load_high_pct + '% load into a life: no Vlasblom–Bosman fit, no power law. Life is an input; the output is a requirement.',
      '<b>[Certain] Single-material mass.</b> The fiber mass is the canonical EQ-6 mass with Zylon σ and ρ for the whole tether, as <code>rev_a.json</code> and the finance model compute it. An HMPE-bulk hybrid has its own V<sub>c</sub>, so its real mass differs.',
      '<b>[Certain] A floor at the column\'s launch price.</b> Replacement costs launch (and fiber, if you price it) and nothing else: no swap hardware, installation, downtime or lost revenue. Each of those raises the required life. A cheaper launch at replacement time would lower it in proportion.',
      '<b>[Certain] A convention, labelled.</b> Rolling books 1/L of the HMPE each operating year; lumpy books it all at once. They agree on average cost and disagree sharply on payback timing.',
    ];
    $('not').innerHTML = not.map(function (s) { return '<li>' + s + '</li>'; }).join('');
  }

  buildControls();
  renderEvidence();
  render();
})();
