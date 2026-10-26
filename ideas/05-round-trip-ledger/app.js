// Round-Trip Ledger page logic. Every number shown comes from Ledger (ledger.js) fed the nhats-data.js
// aggregate of the snapshots, or from its CITED and ANALYSIS tables. Nothing numeric is typed here
// except histogram bin edges (powers of two around 1, and round-number steps for v∞ and declination)
// and layout, which are drawing choices.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const K = Ledger.create(LEDGER_DATA);
  const C = K.constants;
  const S = K.stats();
  const SHORT = String(K.aster.commit || '').slice(0, 7);
  const state = { des: '101955', mode: 'sample-return', dep: 'symmetric', alt: 'nhats', decwhich: 'dep', site: 'CAPE_CANAVERAL' };

  // --- formatting
  const f = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
  const kms = (x, d = 3) => `${f(x, d)} km/s`;
  const ms = (x) => {
    const v = x * 1000;
    return `${f(Math.abs(v) < 0.05 ? 0 : v, 1)} m/s`; // no "−0.0"
  };
  const deg = (x) => `${f(x, 1)}°`;
  const ms3 = (x) => `${f(x * 1000, 3)} m/s`;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function kv(dl, pairs) {
    clear(dl);
    for (const [k, v, cls] of pairs) {
      dl.appendChild(el('dt', null, k));
      const dd = el('dd');
      if (v instanceof Node) dd.appendChild(v);
      else dd.textContent = v;
      if (cls) dd.className = cls;
      dl.appendChild(dd);
    }
  }
  function badge(band) {
    const b = el('span', `badge ${band}`, band);
    b.setAttribute('aria-label', `band ${band}`);
    return b;
  }
  function textWithBadge(text, band) {
    const span = el('span', null, text);
    if (band) span.appendChild(badge(band));
    return span;
  }
  function refusalNode(target, title, r) {
    clear(target);
    target.appendChild(el('strong', null, title));
    target.appendChild(el('div', 'code', `refusal: ${r.code}`));
    target.appendChild(el('div', null, r.reason));
    const help = el('div');
    help.appendChild(el('strong', null, 'What would help: '));
    help.appendChild(document.createTextNode(r.what_would_help));
    target.appendChild(help);
  }

  // --- header
  const LW = S.launch;
  const GR = LW.porkchopGrid;
  $('prov').textContent = `${S.counts.fixtureFiles} fixture files in Aster ${K.fixtureDirs.join(' and ')} at commit ${SHORT} (${K.aster.commitDate.slice(0, 10)}): ${S.counts.records} ${K.signature.source} v${K.signature.version} min_dv_traj records (object records computed ${S.computed.earliest} to ${S.computed.latest}), ${S.counts.notFound} "not found", ${S.counts.duplicates} designations in both directories, ${S.counts.uniqueBodies} unique bodies. NHATS launch dates ${LW.earliestYear}-${LW.latestYear}: ${LW.beforeWindow} before, ${LW.inWindow} inside and ${LW.afterWindow} after Aster's screening-cache window ${LW.screeningWindow.startUtc} to ${LW.screeningWindow.endUtc}; ${GR.inGrid} inside the porkchop grid's departures ${GR.startUtc} to ${GR.endUtc}.`;

  // --- tooltips shared by the histograms
  const tip = $('tip');
  function attachTooltips(container, bins, describe) {
    const hits = container.querySelectorAll('rect.hit');
    const show = (rect) => {
      const i = Number(rect.getAttribute('data-i'));
      const b = bins[i];
      clear(tip);
      tip.appendChild(el('strong', null, `${b.count} ${b.count === 1 ? 'body' : 'bodies'}`));
      tip.appendChild(el('div', null, describe(b)));
      const names = b.items.slice(0, 8).map((idx) => S.rows[idx].des);
      if (b.items.length > 8) names.push(`+${b.items.length - 8} more`);
      if (names.length) tip.appendChild(el('div', null, names.join(', ')));
      tip.hidden = false;
      const host = container.closest('.chart');
      const hr = host.getBoundingClientRect();
      const rr = rect.getBoundingClientRect();
      // the tooltip lives in the first chart's wrapper; move it into this chart
      if (tip.parentNode !== host) host.appendChild(tip);
      let left = rr.left - hr.left + rr.width / 2 - tip.offsetWidth / 2;
      left = Math.max(0, Math.min(left, hr.width - tip.offsetWidth));
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, rr.top - hr.top - tip.offsetHeight - 6)}px`;
    };
    const hide = () => {
      tip.hidden = true;
    };
    hits.forEach((h) => {
      h.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'touch') show(h);
      });
      // a tap shows the tooltip and keeps it until the next tap elsewhere (touch has no hover)
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        show(h);
      });
      h.addEventListener('focus', () => show(h));
      h.addEventListener('blur', hide);
      h.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'touch') hide();
      });
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('rect.hit')) tip.hidden = true;
  });
  // Histograms are drawn at their real pixel width (measured from the mount), so axis labels stay
  // 11 px on a phone instead of being scaled down with a fixed viewBox; redrawn when the width changes.
  const drawn = new Map();
  function drawHistogram(mount, values, edges, opts, describe) {
    const h = K.histogram(values, edges);
    const width = Math.max(300, Math.round(mount.clientWidth || 640));
    const narrow = width < 480;
    const height = narrow ? Math.round(opts.height * 0.95) : opts.height;
    const labelEvery = narrow ? opts.labelEveryNarrow || 2 : opts.labelEvery || 1;
    const xLabel = narrow ? opts.xLabelNarrow || opts.xLabel : opts.xLabel;
    const title = narrow ? opts.titleNarrow || opts.title : opts.title;
    mount.innerHTML = K.svgHistogram({ bins: h.bins, ...opts, width, height, labelEvery, xLabel, title });
    attachTooltips(mount, h.bins, describe);
    drawn.set(mount, { values, edges, opts, describe, width });
    return h;
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const [mount, d] of drawn) {
        if (Math.abs((mount.clientWidth || 640) - d.width) > 16) drawHistogram(mount, d.values, d.edges, d.opts, d.describe);
      }
    }, 120);
  });
  const RATIO_EDGES = K.geometricEdges(Math.pow(2, -2.5), 16, 13);

  // --- section 1: the ratio
  function renderRatio() {
    const R = S.ratio;
    const tiles = $('tiles');
    clear(tiles);
    const tile = (k, v, d, key) => {
      const t = el('div', 'tile');
      t.setAttribute('data-k', key);
      t.appendChild(el('div', 'k', k));
      t.appendChild(el('div', 'v', v));
      t.appendChild(el('div', 'd', d));
      tiles.appendChild(t);
    };
    tile('Smallest ratio', f(R.unique.min, 3), `${R.unique.minBody}: departure ${f(S.rows.find((r) => r.des === R.unique.minBody).vrelDep, 3)} vs arrival ${f(S.rows.find((r) => r.des === R.unique.minBody).vrelArr, 3)} km/s`, 'ratio-min');
    tile('Median ratio', f(R.unique.median, 3), `${R.unique.n} unique bodies; ${f(R.allRecords.median, 3)} over ${R.allRecords.n} records counting the duplicates twice`, 'ratio-median');
    tile('Largest ratio', f(R.unique.max, 3), `${R.unique.maxBody}: departure ${f(S.rows.find((r) => r.des === R.unique.maxBody).vrelDep, 3)} vs arrival ${f(S.rows.find((r) => r.des === R.unique.maxBody).vrelArr, 3)} km/s`, 'ratio-max');
    const AN = K.analysis;
    tile(`Within ±${AN.RATIO_WITHIN[0] * 100}% of 1`, `${R.within10pct} of ${R.unique.n}`, `${R.within25pct} within ±${AN.RATIO_WITHIN[1] * 100}%; ${R.below1} below 1, ${R.above1} above (sign test p = ${f(R.signTestP, 3)})`, 'within10');
    tile(`Off by ${AN.RATIO_FACTOR}× or more`, `${R.offByTwoOrMore} of ${R.unique.n}`, `departure − arrival runs ${f(S.departureMinusArrivalKmps.min, 3)} to ${f(S.departureMinusArrivalKmps.max, 3)} km/s`, 'off2x');
    const A = K.analysis;
    tile(`Delivered mass at Isp ${C.SCREENING_ISP_S} s, on NHATS's trajectories`, `×${f(S.massFactor.min, 2)} to ×${f(S.massFactor.max, 2)}`, `with NHATS's departure instead of the symmetric one (${(C.DETERMINISTIC_MARGIN_FRACTION * 100).toFixed(0)}% margin included); ${S.massFactor.below0p9} bodies below ×${A.MASS_BAND[0]}, ${S.massFactor.above1p1} above ×${A.MASS_BAND[1]}; not measured at an Aster cell`, 'mass');
    drawHistogram($('ratio-hist'), S.rows.map((r) => r.ratio), RATIO_EDGES, { scale: 'log', width: 640, height: 240, title: `NHATS departure v∞ ÷ arrival v∞ at the asteroid, ${R.unique.n} bodies`, titleNarrow: `departure ÷ arrival v∞, ${R.unique.n} bodies`, xLabel: 'vrel_dep_neo / vrel_arr_neo (geometric bins; Aster assumes 1)', xLabelNarrow: 'departure ÷ arrival v∞ (geometric bins)', marker: { x: 1, label: 'Aster: 1' } }, (b) => `ratio ${f(b.lo, 3)} to ${f(b.hi, 3)}`);
    const Ct = S.constraints;
    const bennu = S.rows.find((r) => r.des === '101955');
    const VD = S.cache.vInfArrMinusNhatsKmps;
    $('constraints').textContent = `These are NHATS's trajectories, shaped by its human-mission constraints (Aster research note perplexity-jpl-trajectory-browser-nhats.md:31,40-42,46): at most ${Ct.maxDurationDays} days in total (the records run ${Ct.durTotal.min} to ${Ct.durTotal.max}; ${Ct.atDurationCap} bodies use all ${Ct.maxDurationDays}), at least ${Ct.minStayDays} days at the asteroid (${Ct.atMinStay} of ${R.unique.n} stay exactly ${Ct.minStayDays}), departure from a ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km parking orbit, entry at most ${K.cited.NHATS_ENTRY_SPEED_CAP_KMPS.value} km/s at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km, launch ${Ct.launchWindow}. The spread is measured on them, not on the cells Aster prices: for the same bodies the cache's cheapest-C3 window arrives at the asteroid with a higher v∞ than NHATS's trajectory for ${S.cache.vInfArrAboveNhats} of ${S.cache.rows} (median +${f(VD.median, 2)} km/s; Bennu ${f(bennu.cacheVInfArr, 3)} against ${f(bennu.vrelArr, 3)} km/s), so the ratio and the mass factor at an Aster cell are not measured here.`;
    $('ratio-note').textContent = `Geometric bins so ×2 and ÷2 are the same distance from 1. Hover or tap a bar, or Tab to it, for the bodies in it. NHATS records carry three decimals; a ratio like ${R.unique.maxBody}'s (${f(S.rows.find((r) => r.des === R.unique.maxBody).vrelDep, 3)} / ${f(S.rows.find((r) => r.des === R.unique.maxBody).vrelArr, 3)}) is sensitive to that rounding in its last digit.`;
    const tb = $('ratio-table').querySelector('tbody');
    clear(tb);
    for (const r of [...S.rows].sort((a, b) => a.ratio - b.ratio)) {
      const tr = el('tr');
      tr.appendChild(el('td', null, r.des));
      for (const v of [f(r.c3, 3), f(r.vrelArr, 3), f(r.vrelDep, 3), f(r.ratio, 3), f(r.massFactor, 3), f(r.vinf125, 3), f(r.decDep, 1)]) tr.appendChild(el('td', 'v', v));
      tr.appendChild(el('td', null, r.launch));
      tb.appendChild(tr);
    }
  }

  // --- section 2: one body
  function buildBodySelect() {
    const sel = $('body');
    for (const b of K.bodies) {
      const o = document.createElement('option');
      o.value = b.des;
      o.textContent = `${K.displayName(b.des, b.fullname)} (ratio ${f(b.t.vrel_dep_neo / b.t.vrel_arr_neo, 2)})`;
      sel.appendChild(o);
    }
    const grp = document.createElement('optgroup');
    grp.label = 'Not in NHATS (fixture holds the API error)';
    for (const n of K.notFound) {
      const o = document.createElement('option');
      o.value = n.des;
      o.textContent = n.des;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
    sel.value = state.des;
    sel.addEventListener('change', () => {
      state.des = sel.value;
      renderBody();
    });
  }
  function wireSeg(id, name, onChange) {
    const box = $(id);
    box.addEventListener('change', (e) => {
      if (e.target.name !== name) return;
      box.querySelectorAll('label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
      onChange(e.target.value);
    });
  }
  function stackRow(key, label, kmpsValue, cls) {
    const tr = el('tr', cls);
    tr.setAttribute('data-row', key);
    const td = el('td');
    if (['injection', 'rendezvous', 'departure', 'stationkeeping', 'margin'].includes(key)) td.appendChild(el('span', `sw ${key}`));
    td.appendChild(document.createTextNode(label));
    tr.appendChild(td);
    tr.appendChild(el('td', 'v', kmpsValue));
    return tr;
  }
  function renderBody() {
    const b = K.bodyLedger(state.des, { mode: state.mode, departure: state.dep });
    const depSeg = $('deps');
    const oneWay = state.mode === 'one-way';
    depSeg.querySelectorAll('label').forEach((l) => {
      l.classList.toggle('off', oneWay);
      l.querySelector('input').disabled = oneWay;
    });
    if (b.refusal) {
      $('ledger').hidden = true;
      $('refusal').hidden = false;
      refusalNode($('refusal'), `No ledger for ${state.des}`, b.refusal);
      $('body-note').textContent = '';
      return;
    }
    $('refusal').hidden = true;
    $('ledger').hidden = false;
    const t = b.traj;
    $('body-note').textContent = `${b.name}: NHATS object record computed ${b.computed}; its min-ΔV round trip launches ${t.launch}, ${t.dur_out} d out, ${t.dur_at} d at the asteroid, ${t.dur_ret} d back (${t.dur_total} d). Sources: ${b.sources.map((s) => `${s.dir}/${s.file}`).join(' and ')}.`;
    // Aster-style stack
    const s = b.stack;
    const rows = $('stack-rows');
    clear(rows);
    rows.appendChild(stackRow('injection', `Injection from C3 ${f(t.c3, 3)} km²/s² at ${K.cited.LEO_ALTITUDE_KM.value} km LEO (r = ${f(C.LEO_PARKING_RADIUS_KM, 3)} km)`, kms(s.injectionKmps)));
    rows.appendChild(stackRow('rendezvous', `Rendezvous = arrival v∞ (vrel_arr_neo)`, kms(s.rendezvousKmps)));
    if (!oneWay) rows.appendChild(stackRow('departure', s.departureBasis === 'nhats' ? 'Departure = NHATS vrel_dep_neo' : 'Departure = arrival v∞ (symmetric-return assumption)', kms(s.departureKmps)));
    else rows.appendChild(stackRow('departure', 'Departure: none in one-way mode', '—'));
    rows.appendChild(stackRow('stationkeeping', 'Stationkeeping allocation', kms(s.stationkeepingKmps)));
    rows.appendChild(stackRow('subtotal', 'Subtotal', kms(s.subtotalKmps), 'sub'));
    rows.appendChild(stackRow('margin', `Margin, ${(C.DV_MARGIN_FRACTION * 100).toFixed(0)}% of the full stack`, kms(s.marginKmps)));
    rows.appendChild(stackRow('total', 'Total', kms(s.totalKmps), 'total'));
    const bar = $('stack-bar');
    clear(bar);
    const parts = [['injection', s.injectionKmps], ['rendezvous', s.rendezvousKmps], ['departure', s.departureKmps], ['stationkeeping', s.stationkeepingKmps], ['margin', s.marginKmps]];
    for (const [k, v] of parts) {
      if (v <= 0) continue;
      const seg = el('div', `seg-fill ${k}${k === 'departure' && s.departureBasis === 'nhats' ? ' swap' : ''}`);
      seg.style.flexGrow = String(v);
      bar.appendChild(seg);
    }
    const sym = b.stackSymmetric;
    const nh = b.stackNhats;
    $('stack-delta').textContent = oneWay
      ? `One-way: no departure burn, so the symmetric-return assumption is not in play. NHATS still records a departure of ${kms(t.vrel_dep_neo)} for the round trip.`
      : `Symmetric total ${kms(sym.totalKmps)}; with NHATS's departure ${kms(nh.totalKmps)} (${nh.totalKmps >= sym.totalKmps ? '+' : '−'}${ms(Math.abs(nh.totalKmps - sym.totalKmps))}, margin included). Ratio departure ÷ arrival ${f(b.ratio, 3)}.`;
    // NHATS record
    const nr = $('nhats-rows');
    clear(nr);
    const n = b.nhats;
    nr.appendChild(stackRow('nhats-dep-park', `dv_dep_park: departure from a ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km parking orbit`, kms(n.dv_dep_park)));
    nr.appendChild(stackRow('nhats-arr', 'vrel_arr_neo: arrival at the asteroid', kms(n.vrel_arr_neo)));
    nr.appendChild(stackRow('nhats-dep', 'vrel_dep_neo: departure from the asteroid', kms(n.vrel_dep_neo)));
    nr.appendChild(stackRow('nhats-arr-earth', 'vrel_arr_earth: Earth arrival burn', kms(n.vrel_arr_earth)));
    nr.appendChild(stackRow('nhats-total', 'dv_total', kms(n.dv_total), 'total'));
    $('nhats-delta').textContent = `Sum of the four lines ${kms(n.sumKmps)} (residual ${ms(n.residualKmps)}: NHATS totals its own lines to the metre per second). No stationkeeping, no margin, direct atmospheric entry. Aster's injection formula at NHATS's ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km radius gives ${kms(b.injection.atNhatsRadiusKmps)} (Δ ${ms(b.injection.deltaNhatsKmps)} against dv_dep_park); at Aster's own ${K.cited.LEO_ALTITUDE_KM.value} km it is ${kms(b.injection.atAsterRadiusKmps)}, ${ms(b.injection.deltaAsterKmps)} more.`;
    // consequences
    const a125 = b.arrival.atNhatsAltitude;
    const a200 = b.arrival.atTrajectoryBrowserAltitude;
    const cons = [];
    if (!oneWay) cons.push([`Delivered mass (cost card, Isp ${C.SCREENING_ISP_S} s, ${(C.DETERMINISTIC_MARGIN_FRACTION * 100).toFixed(0)}% deterministic margin)`, `×${f(b.massFactor, 3)} with NHATS's departure: spacecraft Δv ${f(b.costCardSymmetric.dvSpacecraftMps, 0)} → ${f(b.costCardNhats.dvSpacecraftMps, 0)} m/s, mass fraction ${f(b.costCardSymmetric.massFraction, 3)} → ${f(b.costCardNhats.massFraction, 3)}`]);
    else cons.push(['Delivered mass', 'unchanged: one-way mode has no departure line']);
    cons.push([`Earth-arrival v∞ from v_arr_earth ${kms(b.arrival.vArrEarthKmps)} at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km [Likely]`, a125.refusal ? `refused (${a125.refusal.code}): ${a125.refusal.reason}` : `${kms(a125.value)} (${f(a125.roundingLowKmps, 3)} to ${f(a125.roundingHighKmps, 3)} from the record's rounding); at ${K.cited.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value} km it would read ${a200.refusal ? 'refused' : kms(a200.value)}. This is the K1/K2 interface quantity.`]);
    cons.push(['Departure declination dec_dep, Aster bands [Likely frame]', textWithBadge(`${deg(b.declination.depDeg)} from ${C.sites.CAPE_CANAVERAL.name}`, b.declination.depBandCape)]);
    cons.push(['', textWithBadge(`from ${C.sites.VANDENBERG_SFB.name}`, b.declination.depBandVandenberg)]);
    cons.push(['Earth-arrival declination dec_arr', textWithBadge(`${deg(b.declination.arrDeg)}; against the Cape bands`, b.declination.arrBandCape)]);
    kv($('cons'), cons);
    // Aster today
    const today = [];
    if (b.cache.refusal) today.push(['Screening cache', `refused (${b.cache.refusal.code}): ${b.cache.refusal.reason}`]);
    else today.push([`Screening cache, cheapest outbound window (${S.cache.screeningWindow.startUtc} to ${S.cache.screeningWindow.endUtc})`, `C3 ${f(b.cache.minC3, 3)} km²/s² departing ${b.cache.minC3Date}, TOF ${b.cache.minC3TofDays} d, arrival v∞ ${kms(b.cache.minC3VInfArr)} (NHATS's trajectory: ${kms(t.vrel_arr_neo)}); status ${b.cache.status}${b.cache.isCoOrbital ? '; co-orbital' : ''}. A different trajectory, so the ratio above is NHATS's, not this cell's. ${b.cache.objective}.`]);
    kv($('aster-today'), today);
    refusalNode($('return-leg'), 'Return leg', b.returnLeg.refusal);
  }

  // --- section 3: Earth arrival
  function buildAlts() {
    const box = $('alts');
    const opts = [['nhats', `${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km (NHATS API)`], ['tb', `${K.cited.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value} km (Trajectory Browser)`]];
    for (const [v, label] of opts) {
      const l = el('label', v === state.alt ? 'on' : '');
      const i = document.createElement('input');
      i.type = 'radio';
      i.name = 'alt';
      i.value = v;
      i.checked = v === state.alt;
      l.appendChild(i);
      l.appendChild(el('span', null, label));
      box.appendChild(l);
    }
    wireSeg('alts', 'alt', (v) => {
      state.alt = v;
      renderArrival();
    });
  }
  function renderArrival() {
    const A = S.arrival;
    const nh = state.alt === 'nhats';
    const alt = nh ? K.cited.NHATS_ENTRY_ALTITUDE_KM.value : K.cited.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value;
    const vals = S.rows.map((r) => (nh ? r.vinf125 : r.vinf200));
    const finite = vals.filter(Number.isFinite);
    $('arr-note').textContent = `NHATS reports the Earth atmospheric entry speed v_arr_earth (${kms(A.vArrEarth.min)} to ${kms(A.vArrEarth.max)}; the API caps it at ${A.entryCapKmps} km/s). Reading it as the speed at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km (the research note's constraint altitude) and inverting vis-viva gives the hyperbolic excess speed a return leg arrives with: the quantity Aster's K1 would compute and K2 would hand to Skyhook. Every record is above the escape speed at that altitude (${kms(A.escapeAt125Kmps, 3)}), so none is refused.`;
    drawHistogram($('vinf-hist'), vals, K.linearEdges(0, 4.75, 19), { scale: 'linear', width: 640, height: 220, title: `Implied Earth-arrival v∞ at ${alt} km, ${finite.length} bodies`, titleNarrow: `Earth-arrival v∞ at ${alt} km, ${finite.length} bodies`, xLabel: 'v∞ at Earth, km/s (0.25 km/s bins)', xLabelNarrow: 'v∞ at Earth, km/s', labelEvery: 2, labelEveryNarrow: 4 }, (b) => `v∞ ${f(b.lo, 2)} to ${f(b.hi, 2)} km/s at ${alt} km`);
    $('arr-foot').textContent = nh
      ? `At ${alt} km: ${kms(A.vinf125.min)} (${A.vinf125.minBody}) to ${kms(A.vinf125.max)} (${A.vinf125.maxBody}), median ${kms(A.vinf125.median)}. The low end is fragile: ±${S.rounding.halfUnitKmps} km/s of rounding on v_arr_earth moves ${A.vinf125.minBody} between ${f(A.vinf125.minRoundingLow, 3)} and ${f(A.vinf125.minRoundingHigh, 3)} km/s, because the record sits only ${ms(A.vArrEarth.min - A.escapeAt125Kmps)} above escape speed.`
      : `At ${alt} km (the altitude the Trajectory Browser FAQ quotes, shown to make the convention visible): ${kms(A.vinf200.min)} to ${kms(A.vinf200.max)}. The ${K.cited.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value - K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km difference in the assumed altitude moves the floor by about ${kms(A.vinf200.min - A.vinf125.min, 2)}. Which altitude the API means is not settled on this page; a two-body check at one body's NHATS dates (README, Honest assessment) sides with ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km.`;
  }

  // --- section 4: declinations
  function buildSites() {
    const box = $('sites');
    for (const key of ['CAPE_CANAVERAL', 'VANDENBERG_SFB']) {
      const site = C.sites[key];
      const l = el('label', key === state.site ? 'on' : '');
      const i = document.createElement('input');
      i.type = 'radio';
      i.name = 'site';
      i.value = key;
      i.checked = key === state.site;
      l.appendChild(i);
      l.appendChild(el('span', null, site.name));
      box.appendChild(l);
    }
    wireSeg('sites', 'site', (v) => {
      state.site = v;
      renderDec();
    });
    wireSeg('decwhich', 'decwhich', (v) => {
      state.decwhich = v;
      renderDec();
    });
  }
  function renderDec() {
    const site = C.sites[state.site];
    const dep = state.decwhich === 'dep';
    const vals = S.rows.map((r) => (dep ? r.decDep : r.decArr));
    const counts = { GREEN: 0, AMBER: 0, RED: 0 };
    for (const v of vals) counts[K.dlaBand(v, site)]++;
    const bands = [
      { lo: -site.iMinDeg, hi: site.iMinDeg, cls: 'GREEN', label: 'GREEN' },
      { lo: site.iMinDeg, hi: site.dlaCeilingDeg, cls: 'AMBER', label: 'AMBER' },
      { lo: -site.dlaCeilingDeg, hi: -site.iMinDeg, cls: 'AMBER', label: 'AMBER' },
    ];
    if (site.dlaCeilingDeg < 90) bands.push({ lo: site.dlaCeilingDeg, hi: 90, cls: 'RED', label: 'RED' }, { lo: -90, hi: -site.dlaCeilingDeg, cls: 'RED', label: 'RED' });
    $('dec-note').textContent = dep
      ? `NHATS dec_dep is the declination of the departure asymptote for each min-ΔV trajectory. Aster classifies a cell by |DLA| against a launch site's corridor (feasibility.ts: GREEN up to the site's minimum inclination, AMBER up to its declination ceiling, RED beyond). The frame of NHATS's declination is not stated anywhere in the Aster checkout; Aster's own DLA is equatorial (ICRF, INV-021), so the comparison holds only if NHATS's is too [Likely: not settled on this page; a two-body check at one body's NHATS dates, in the README, sides with equatorial].`
      : `NHATS dec_arr is the declination of the Earth-arrival asymptote: a return-leg quantity Aster has no model or band for yet (K1). It is shown against the same departure bands only to give it a scale; a landing-site constraint would be a different model.`;
    drawHistogram($('dec-hist'), vals, K.linearEdges(-90, 90, 18), { scale: 'linear', width: 640, height: 220, title: `${dep ? 'Departure' : 'Earth-arrival'} declination, ${vals.length} bodies, ${site.name} bands`, titleNarrow: `${dep ? 'Departure' : 'Earth-arrival'} declination, ${site.name}`, xLabel: 'declination, degrees (10° bins)', xLabelNarrow: 'declination, degrees', bands, labelEvery: 3, labelEveryNarrow: 3 }, (b) => `${deg(b.lo)} to ${deg(b.hi)}`);
    const leg = $('dec-legend');
    clear(leg);
    for (const band of ['GREEN', 'AMBER', 'RED']) {
      const span = el('span');
      span.appendChild(el('span', `chip ${band}`));
      const limit = band === 'GREEN' ? `|δ| ≤ ${site.iMinDeg}°` : band === 'AMBER' ? `≤ ${site.dlaCeilingDeg}°` : `> ${site.dlaCeilingDeg}°`;
      span.appendChild(document.createTextNode(`${band} (${limit}): ${counts[band]}`));
      leg.appendChild(span);
    }
    $('dec-foot').textContent = `From ${site.name}: GREEN ${counts.GREEN}, AMBER ${counts.AMBER}, RED ${counts.RED} of ${vals.length}. ${site.dlaCeilingDeg >= 90 ? 'This corridor reaches polar inclination, so no declination is RED.' : 'RED here means a dogleg at screening fidelity.'} Declinations run ${deg(Math.min(...vals))} to ${deg(Math.max(...vals))}.`;
  }

  // --- section 5: injection
  function renderInjection() {
    const I = S.injection;
    kv($('inj'), [
      [`Aster injectionDvFromC3 at NHATS's radius (${f(C.NHATS_PARKING_RADIUS_KM, 3)} km = R_E ${f(C.EARTH_RADIUS_KM, 3)} + ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km) vs dv_dep_park, ${S.counts.records} records`, `max |Δ| ${ms3(I.maxAbsDeltaAtNhatsRadiusKmps)}. The records carry ${S.rounding.decimals} decimals: ±${ms(S.rounding.halfUnitKmps)} on dv_dep_park plus c3's rounding carried through gives at most ${ms3(I.roundingBoundKmps)}, and every record is within its own bound: ${I.allWithinRounding ? 'yes' : 'no'}`],
      [`Best-fitting parking radius, ${I.fitRangeKm.step} km grid`, `${f(I.bestFitRadius.radiusKm, 3)} km (max |Δ| ${ms3(I.bestFitRadius.maxAbsDeltaKmps)}): the data pin NHATS's ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km parking orbit`],
      [`At Aster's own ${K.cited.LEO_ALTITUDE_KM.value} km radius (${f(C.LEO_PARKING_RADIUS_KM, 3)} km)`, `Aster − NHATS = ${ms(I.deltaAtAsterRadiusKmps.min)} to ${ms(I.deltaAtAsterRadiusKmps.max)}, ${f(I.asterRadiusTimesWorse, 0)}× the worst |Δ| at ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km: a convention difference the two disclosures already state, not an error`],
      ['NHATS internal consistency', `dv_total − (dv_dep_park + vrel_arr_neo + vrel_dep_neo + vrel_arr_earth): max |residual| ${ms(S.nhatsLedger.maxAbsResidualKmps)} (five rounded numbers allow ${ms(S.nhatsLedger.residualBoundKmps)}); |√c3 − v_dep_earth| max ${ms(S.nhatsLedger.maxAbsVDepEarthResidualKmps)}; vrel_arr_earth is 0 in every record`],
    ]);
    $('inj-foot').textContent = `So the injection model is right and the two catalogues differ only in parking altitude. The departure line is the one assumption Aster cannot check against itself; the section above measures it. μ = ${C.EARTH_MU_KM3_PER_S2} km³/s² from delta-v.ts.`;
  }

  // --- footer
  function renderFooter() {
    const foot = $('foot');
    clear(foot);
    foot.appendChild(el('p', null, `Fidelity: an idea-bank prototype. Not through Aster's multi-agent math audit, oracle validation, founding-document DEC process or protected-core review. NHATS field semantics are the API's; the ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km entry altitude and the equatorial declination frame are [Likely], not settled on this page; everything else is arithmetic on snapshotted values [Certain], measured on NHATS's own trajectories, not on Aster's cells.`));
    const ul = el('ul');
    const li = (t) => ul.appendChild(el('li', null, t));
    li(`Aster ${K.aster.repo} @ ${K.aster.commit}; constants from ${Object.values(C.sources).map((s) => `${s.path} (blob ${s.blob.slice(0, 7)})`).join(', ')}; porkchop grid from ${K.porkchopGrid.source.path}:${K.porkchopGrid.source.lines.join('-')} (blob ${K.porkchopGrid.source.blob.slice(0, 7)}).`);
    li(`NHATS fixtures: ${K.fixtureDirs.join(', ')}; cache excerpt from ${K.cacheSource.path} (blob ${K.cacheSource.blob.slice(0, 7)}, solver ${String(K.cacheMetadata.provenance.solverCommit).slice(0, 7)}).`);
    for (const c of Object.values(K.cited)) li(`${c.value} [${c.label}]: ${c.cite}.`);
    li(`Analysis choices: ratio within ±${K.analysis.RATIO_WITHIN.map((x) => `${x * 100}%`).join(' and ±')} of 1, off by ${K.analysis.RATIO_FACTOR}×; mass bands ×${K.analysis.MASS_BAND.join(' and ×')}; parking-radius scan R_E + ${K.analysis.FIT_ALTITUDE_KM[0]} to R_E + ${K.analysis.FIT_ALTITUDE_KM[1]} km in ${K.analysis.FIT_ALTITUDE_KM[2]} km steps.`);
    li(`Not in NHATS: ${K.notFound.map((n) => n.des).join(', ')} (the fixtures hold the API's "${K.notFound[0].error}").`);
    foot.appendChild(ul);
  }

  // --- boot
  renderRatio();
  buildBodySelect();
  wireSeg('modes', 'mode', (v) => {
    state.mode = v;
    renderBody();
  });
  wireSeg('deps', 'dep', (v) => {
    state.dep = v;
    renderBody();
  });
  renderBody();
  buildAlts();
  renderArrival();
  buildSites();
  renderDec();
  renderInjection();
  renderFooter();
})();
