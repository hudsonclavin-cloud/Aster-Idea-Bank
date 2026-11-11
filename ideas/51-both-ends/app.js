// Both Ends page glue: reads the controls, calls the kernel, writes the page. No numbers live here.
(function () {
  'use strict';
  const DATA = window.BOTH_ENDS_DATA;
  const B = window.BothEnds.create(DATA);
  const $ = (id) => document.getElementById(id);
  const n = (x, d) => x.toFixed(d === undefined ? 3 : d);
  const kg = (x) => Math.round(x).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let store = null;
  try { store = window.localStorage; store.getItem('x'); } catch (e) { store = null; }
  const saved = (k, d) => { try { return (store && store.getItem('both-ends.' + k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { if (store) store.setItem('both-ends.' + k, v); } catch (e) { /* private mode */ } };

  // ---- controls
  const bodySel = $('body');
  bodySel.innerHTML = DATA.nhats.records.map((r) => `<option value="${esc(r.des)}">${esc(r.fullname)}</option>`).join('');
  bodySel.value = saved('des', '101955');
  if (!bodySel.value) bodySel.value = DATA.nhats.records[0].des;
  const tierKey0 = saved('tier', 'phase3');
  $('tiers').innerHTML = B.TIERS.map((t) => {
    const tt = B.tier(t.key);
    return `<label title="${esc(t.detail)}"><input type="radio" name="tier" value="${t.key}"${t.key === tierKey0 ? ' checked' : ''}><span>${n(tt.vTip, 1)}</span></label>`;
  }).join('');
  $('reading').value = saved('reading', 'entry-125');
  const tierKey = () => (document.querySelector('input[name=tier]:checked') || {}).value || 'phase3';

  // ---- drawing: the swing circle seen in the frame of the tether's centre of mass
  function diagram(m) {
    const cx = 170, cy = 150, R = 105;
    const pt = (deg, rad) => {
      const a = (deg * Math.PI) / 180;
      return [cx + (rad || R) * Math.sin(a), cy - (rad || R) * Math.cos(a)];
    };
    const mark = (deg, colour, label, side) => {
      const [x, y] = pt(deg * side);
      const [lx, ly] = pt(deg * side, R + 22);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${colour}" stroke-width="2.5"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${colour}"/>` +
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${colour}" font-size="12" font-weight="700" text-anchor="${side < 0 ? 'end' : 'start'}">${label}</text>`;
    };
    const o = m.outbound, i = m.inbound;
    // release shown before the top (left), catch after it (right); both at the top overlap, so nudge
    const od = Math.max(o.thetaDeg, 16), id = Math.max(i.thetaDeg, 16); // drawn apart so the labels do not collide; the text carries the true angle
    $('diagram').innerHTML =
      `<title>Where on the tether's swing the craft is released and caught</title>` +
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="4 4"/>` +
      `<line x1="${cx}" y1="${cy - R - 8}" x2="${cx}" y2="${cy + R + 8}" stroke="var(--line)" stroke-width="1"/>` +
      `<text x="${cx}" y="18" text-anchor="middle" font-size="11" fill="var(--muted)">top of swing · ${n(m.tier.rUp - B.constants.rE, 0)} km · fastest</text>` +
      `<text x="${cx}" y="292" text-anchor="middle" font-size="11" fill="var(--muted)">lower tip · ${n(m.tier.rLow - B.constants.rE, 0)} km · ${n(m.tier.vLow, 2)} km/s · Earth below</text>` +
      mark(od, 'var(--out)', o.mode === 'swing' ? `out ${n(o.thetaDeg, 1)}°` : 'out: top + burn', -1) +
      mark(id, 'var(--home)', i.mode === 'swing' ? `home ${n(i.thetaDeg, 1)}°` : 'home: brake + top', 1) +
      `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--ink)"/>` +
      `<text x="${cx + 8}" y="${cy + 16}" font-size="11" fill="var(--muted)">hub, ${n(m.tier.rCom - B.constants.rE, 0)} km</text>`;
  }

  function leg(title, rows) {
    return `<div class="leg"><h3>${title}</h3>${rows.map((r) => `<p><span class="who">${r[0]}</span>${r[1]}</p>`).join('')}</div>`;
  }

  function render() {
    const des = bodySel.value, tk = tierKey(), reading = $('reading').value;
    const raw = $('sample').value.trim();
    const sampleKg = raw === '' ? NaN : Number(raw);
    save('des', des); save('tier', tk); save('reading', reading);
    const m = B.mission(des, tk, { sampleKg, reading });
    $('refusal').hidden = m.ok;
    $('result').hidden = !m.ok;
    if (!m.ok) {
      $('refusal').innerHTML = `<b>Refused (${esc(m.code)}).</b> ${esc(m.missing)}<br><em>Would help: ${esc(m.wouldHelp)}</em>`;
      return;
    }
    const o = m.outbound, i = m.inbound, t = m.tier, T = m.tether, r = m.record;
    $('trip').textContent = `${r.fullname}: launch ${r.launch}, ${r.dur_out} days out, ${r.dur_at} at the asteroid, ${r.dur_ret} back (${r.dur_total} in all). NHATS record computed ${r.computed}.`;

    const outTxt = o.mode === 'swing' ? 'No burn' : `${n(o.trimKmps)} km/s`;
    const homeTxt = i.mode === 'swing' ? 'No burn' : `${n(i.trimKmps)} km/s`;
    $('headline').innerHTML =
      `<div class="stat out"><b>${outTxt}</b><span>owed by the craft after the throw. A rocket leaving 200 km LEO owes ${n(o.asterInjectionKmps)} km/s.</span></div>` +
      `<div class="stat home"><b>${homeTxt}</b><span>owed before the catch. Then it is set down at ${n(i.handDownKmps, 2)} km/s, not ${n(i.vEntry, 2)} km/s direct entry.</span></div>` +
      `<div class="stat"><b>${kg(T.caughtKg)} kg</b><span>caught, of ${kg(T.releasedKg)} kg thrown${T.sampleKg ? `, with ${kg(T.sampleKg)} kg of sample aboard` : ''}.</span></div>` +
      `<div class="stat"><b>${n(m.energy.returnedFraction * 100, 0)} %</b><span>of the orbital energy the tether lent comes back with the catch.</span></div>`;

    diagram(m);
    $('tierfacts').innerHTML = `<dl>
      <dt>Tier</dt><dd>${esc(t.detail)} <span class="tag">${esc(t.confidence)}</span></dd>
      <dt>Tether mass</dt><dd>${t.stated.massRatio}× the payload (30 % derate), sized for ${kg(B.constants.payloadClassKg)} kg</dd>
      <dt>Top of swing</dt><dd>${n(t.vRelease)} km/s, C3 ${n(t.c3Max, 2)} km²/s² <span class="tag">canon says ${t.stated.c3}</span></dd>
      <dt>Rotation</dt><dd>one turn every ${n(t.periodMin, 1)} min, ${n(t.tipG, 2)} g at the tip</dd>
      <dt>This trip needs</dt><dd>C3 ${n(o.c3Req)} out, ${n(i.c3)} home</dd>
    </dl>`;

    $('legs').innerHTML =
      leg('Out', [
        ['Aster, as shipped', `Launch vehicle injects from 200 km LEO: <b>${n(o.asterInjectionKmps)} km/s</b>. <span class="tag">[Certain] NHATS itself books ${n(o.nhatsInjectionKmps)} from 400 km</span>`],
        ['With the tether', o.mode === 'swing'
          ? `Let go <b>${n(o.thetaDeg, 1)}°</b> before the top of the swing, at ${n(o.altKm, 0)} km and ${n(o.vKmps)} km/s. The tip already has C3 ${n(o.c3Req)} there. <span class="tag">[Certain] energy only</span>`
          : `Let go at the top (C3 ${n(o.tipC3, 2)}), then burn <b>${n(o.trimKmps)} km/s</b> at ${n(o.altKm, 0)} km to reach C3 ${n(o.c3Req)}. <span class="tag">[Certain] energy only</span>`],
      ]) +
      leg('At the asteroid', [
        ['Both paths, the record\'s own burns', `Rendezvous <b>${n(m.asteroid.rendezvousKmps)}</b>, departure <b>${n(m.asteroid.departureKmps)}</b> km/s. <span class="tag">[Certain] NHATS</span>`],
        ['Aster\'s budget lines', `Stationkeeping ${n(m.asteroid.stationkeepingKmps)} km/s, ${m.asteroid.marginFraction * 100} % margin on burns, Isp ${m.asteroid.ispS} s. <span class="tag">[Likely] screening values</span>`],
      ]) +
      leg('Home', [
        ['Aster, as shipped', `Direct entry at <b>${n(i.vEntry)} km/s</b> (v∞ ${n(i.vInf)} km/s, read at ${m.reading.altKm} km). No burn.`],
        ['With the tether', (i.mode === 'swing'
          ? `Caught <b>${n(i.thetaDeg, 1)}°</b> past the top of the swing, at ${n(i.altKm, 0)} km and ${n(i.vKmps)} km/s, no burn.`
          : `Brake <b>${n(i.trimKmps)} km/s</b> at ${n(i.altKm, 0)} km, then caught at the top.`) +
          ` Half a turn later it is let go at ${n(i.handDownAltKm, 0)} km moving ${n(i.handDownKmps, 2)} km/s. <span class="tag">[Certain] energy only; the catch itself is refused below</span>`],
      ]);

    $('massnote').textContent = `Same asteroid burns on every row. The rocket rows are Aster's payload-at-C3 curves (${DATA.aster.vehicles_source}) and a direct entry. The tether row starts from the ${kg(B.constants.payloadClassKg)} kg the tether is sized for and pays its two trim burns from the craft's own propellant. The rows are not a like-for-like race: no launcher to the lower tip is known, so the tether row has no launch behind it.`;
    $('mass').innerHTML = `<tr><th>Path</th><th>Leaves Earth, kg</th><th>At asteroid, kg</th><th>Home, kg</th><th>Comes home at</th></tr>` +
      `<tr class="tether"><td>Tether, ${esc(t.label)}</td><td>${kg(T.releasedKg)}</td><td>${kg(T.atAsteroidKg)}</td><td>${kg(T.caughtKg)}</td><td>${n(i.handDownKmps, 2)} km/s</td></tr>` +
      m.rocket.map((v) => v.refused
        ? `<tr><td>${esc(v.name)} ${esc(v.config)}</td><td class="no" colspan="4">Refused: C3 ${n(o.c3Req, 1)} is past this vehicle's published curve, which ends at ${v.curveMaxC3}.</td></tr>`
        : `<tr><td>${esc(v.name)} ${esc(v.config)}</td><td>${kg(v.injectedKg)}</td><td>—</td><td>${kg(v.homeKg)}</td><td>${n(i.vEntry, 2)} km/s</td></tr>`).join('');

    const e = m.energy;
    $('energy').innerHTML = `<p class="note">Raising ${kg(T.releasedKg)} kg from the lower tip to the release point takes <b>${n(e.throwGJ, 0)} GJ</b> out of the tether's orbit (${n(e.throwMJkg, 2)} MJ/kg). Lowering the ${kg(T.caughtKg)} kg it catches puts <b>${n(e.catchGJ, 0)} GJ</b> back (${n(e.catchMJkg, 2)} MJ/kg). <b>${n(e.netGJ, 0)} GJ</b> is left for the reboost system. <span class="tag">[Certain] two-body energy; reboost power and time are not computed here</span></p>
      <div class="bar" role="img" aria-label="${n(e.returnedFraction * 100, 0)} percent of the energy returned"><i style="width:${Math.min(100, e.returnedFraction * 100).toFixed(1)}%"></i></div>`;

    $('refused').innerHTML = m.refused.map((x) => `<li><b>${esc(x.topic)}</b>${esc(x.missing)}<em>Would help: ${esc(x.wouldHelp)}</em></li>`).join('');
    census(tk, reading);
  }

  function census(sel, reading) {
    $('census').innerHTML = `<tr><th>Tier</th><th>Tether ÷ payload</th><th>Throws, no burn</th><th>Catches, no burn</th><th>Both</th><th>Median throw burn</th><th>Median catch burn</th><th>Median caught, kg</th><th>Median energy back</th></tr>` +
      B.TIERS.map((t) => {
        const c = B.census(t.key, reading), tt = B.tier(t.key);
        return `<tr class="${t.key === sel ? 'sel' : ''}"><td>${esc(t.label)}</td><td>${tt.stated.massRatio}×</td><td>${c.throwFree} of ${c.bodies}</td><td>${c.catchFree} of ${c.bodies}</td><td>${c.bothFree}</td><td>${n(c.throwTrim.median)} km/s</td><td>${n(c.catchTrim.median)} km/s</td><td>${kg(c.caughtKg.median)}</td><td>${n(c.returnedFraction.median * 100, 0)} %</td></tr>`;
      }).join('');
  }

  $('foot').innerHTML = `Idea-bank prototype. Two-body, impulsive, energy only. Tether numbers: Skyhook <code>params/rev_a.json</code> @ ${esc(String(DATA.skyhook.provenance.commit).slice(0, 7))}. Trips, constants and vehicle curves: Aster @ ${esc(DATA.aster.commit.slice(0, 7))} (${DATA.nhats.records.length} JPL NHATS records in <code>tests/fixtures/v2</code>). Not through Aster's math audit or Skyhook's Rule 1 and VM verification. The upper-tip catch was first worked in idea 01, Tip Match.`;

  for (const el of [bodySel, $('reading'), $('sample')]) el.addEventListener('input', render);
  $('tiers').addEventListener('change', render);
  render();
})();
