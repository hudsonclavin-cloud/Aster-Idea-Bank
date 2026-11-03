#!/usr/bin/env node
// Drives the Momentum Ledger page in headless Chromium and checks what a person sees against the kernel:
// the energy, recovery and orbit tiles, the sizing-rule table, the program-site push, the throw count and
// minimum hub, Skyhook's own tether model run from the button, the four reconciliations in section 4, the
// refusals (overload, a blank hub, the uncanonical derates, $/kg), keyboard selection, a chart tooltip by
// touch, and no sideways scroll or console error at 390 px in dark mode and 1280 px in light mode.
// Uses the globally installed Playwright, as tools/smoke.mjs does.
//   node ideas/30-momentum-ledger/ui-check.mjs [--shots DIR]
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const K = require(path.join(here, 'ledger.js'));
const D = require(path.join(here, 'data.js'));
const TC = require(path.join(here, 'twin-check.js'));
const twin = await import(pathToFileURL(path.join(here, 'snapshots/twin-physics.mjs')).href);
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('SKIP ui-check: Playwright is not installed');
    process.exit(0);
  }
}

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
// the page's own number format: en-US grouping, a true minus sign
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');

const revA = D.revA;
const RE = parseFloat(D.values['skyhook_physics.r_earth_km'].text);
const HUB = Number(D.values['tether_dynamics.hub_mass_kg'].text);
const sys = (o = {}) => K.system(revA, Object.assign({ tier: 'reference', derate: '0.3', hubKg: HUB, earthRadiusKm: RE }, o));
const S0 = sys();
const E0 = K.energy(S0);
const L0 = K.ledger(S0);
const CIS = K.energy(sys({ tier: 'cislunar' }));
const LOADED = K.energy(sys({ release: 'loaded' }));
const TW = TC.run(twin, revA, { vTipKms: 2.5, derate: 0.3, hubKg: HUB, payloadKg: S0.m, dt: 0.1 });

const browser = await pw.chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' };
const DESK = { viewport: { width: 1280, height: 900 }, colorScheme: 'light' };

async function open(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('file:')) requests.push(r.url()); });
  await page.goto(URL0);
  await page.waitForTimeout(150);
  return { context, page, errors, requests };
}
const text = (page, sel) => page.locator(sel).first().innerText();
const tileV = (page, id) => text(page, `#${id} .v`);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const setRange = (page, sel, v) => page.evaluate(([s, val]) => {
  const el = document.querySelector(s);
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [sel, v]);

// 1. Desktop, light: the numbers, the twin, the reconciliations, keyboard
{
  const { context, page, errors, requests } = await open(DESK);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(249, 249, 247)', `light background on desktop (${bg})`);
  ok((await text(page, '#commit')).includes(D.skyhookCommitShort), 'eyebrow names the Skyhook commit the canon was read at');

  // section 1
  ok((await tileV(page, 't-perkg')).startsWith(fmt(E0.perKg / 1e6, 2)), `energy per kg ${fmt(E0.perKg / 1e6, 2)} MJ/kg`);
  ok(fmt(E0.perKg / 1e6, 2) === '43.03', 'and that is 43.03 MJ/kg, the orbital-energy figure idea 14 also derives');
  ok((await tileV(page, 't-perthrow')).startsWith(fmt(E0.perThrow / 1e9, 0)), `energy per throw ${fmt(E0.perThrow / 1e9, 0)} GJ`);
  ok((await tileV(page, 't-dv')).startsWith(fmt(L0.dvEquiv, 1)), `reboost dv ${fmt(L0.dvEquiv, 1)} m/s`);
  ok((await tileV(page, 't-mass')).startsWith(fmt(S0.M / 1e3, 1)), `system mass ${fmt(S0.M / 1e3, 1)} t`);
  const et = await text(page, '#energy-table');
  ok(et.includes(fmt(E0.kinetic / 1e6, 2)) && et.includes('skyhook_finance.py:215'), 'energy table shows the finance model\'s 37.78 at :215');
  ok(et.includes(D.values['mp001.mp001_mj_per_kg'].text) && et.includes(D.values['project_instructions.founding_mj_per_kg'].text), 'and MP-001\'s and the founding document\'s stated figures');
  const note = await text(page, '#loaded-note');
  ok(note.includes(fmt(LOADED.c3 / 1e6, 2)) && note.includes(fmt(E0.c3 / 1e6, 2)), `loaded-release note: C3 ${fmt(LOADED.c3 / 1e6, 2)} against the canon's ${fmt(E0.c3 / 1e6, 2)}`);

  // section 2 at the defaults: 1 MW, 26 %, duty 0.5
  const t1 = K.recoverySeconds(E0.perThrow, 1e6, 0.26, 0.5) / 86400;
  let rv = await text(page, '#rec-verdict');
  ok(rv.includes(`${fmt(t1, 1)} days`) && /meets neither/.test(rv), `1 MW, 26 %, duty 0.5: ${fmt(t1, 1)} days, meets neither end of the rule`);
  const req = await page.locator('#req-table tbody tr').allInnerTexts();
  const row = req.find((r) => /^26 %\s+0\.5/.test(r));
  ok(row && row.includes('4.98 MW') && row.includes('2.49 MW'), `sizing rule at 26 %, duty 0.5: 4.98 and 2.49 MW (${row})`);
  const cad = await page.locator('#cad-table tbody tr').first().innerText();
  ok(cad.includes('43.2 MW'), `workbook conservative cadence at duty 0.5: 43.2 MW (${cad})`);
  const am = await text(page, '#array-mass');
  ok(am.includes('487 t') && am.includes('432 t at 100 W/kg') && am.includes('863 t at 50 W/kg'), `hardware factor allows 487 t; conservative arrays 432 / 863 t (${am.slice(0, 80)}…)`);
  const sp = await text(page, '#site-push');
  const push = K.constantPush(S0, E0.perThrow, 2e-3);
  ok(sp.includes(`${fmt(push.powerW / 1e6, 1)} MW`) && sp.includes(`${fmt(push.restoreS / 3600, 1)} hours`), `program-site push: ${fmt(push.powerW / 1e6, 1)} MW, ${fmt(push.restoreS / 3600, 1)} hours`);
  // where the 30 % margin decides: 4.5 days bare is 5.85 with the margin, so only the 10-day end is met
  const pMid = E0.perThrow / (0.26 * 0.5 * 4.5 * 86400);
  await setRange(page, '#power', Math.log10(pMid));
  await page.waitForTimeout(80);
  rv = await text(page, '#rec-verdict');
  const tMid = K.recoverySeconds(E0.perThrow, Math.pow(10, Number(await page.locator('#power').inputValue())), 0.26, 0.5) / 86400; // the slider snaps to 0.01 in log10
  ok(tMid > 3.85 && 1.3 * tMid > 5 && rv.includes(`${fmt(tMid, 1)} days`) && rv.includes(`${fmt(1.3 * tMid, 1)} days`) && /meets the 10-day end of the rule, not the 5-day end/.test(rv),
    `${fmt(tMid, 1)} days bare, ${fmt(1.3 * tMid, 1)} with the margin: only the 10-day end (${rv.slice(0, 140)})`);
  // keyboard: the power slider to its top (100 MW) meets both ends of the rule
  await page.locator('#power').focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(80);
  rv = await text(page, '#rec-verdict');
  ok(/meets the 5-day rule/.test(rv) && (await text(page, '#power-out')) === '100 MW', `keyboard End on the power slider: 100 MW meets the 5-day rule (${rv.slice(0, 60)})`);
  // an efficiency chip
  await page.locator('#eta-presets button', { hasText: '40 %' }).click();
  await page.waitForTimeout(80);
  ok((await text(page, '#eta-out')) === '40 %', 'efficiency chip sets 40 %');

  // section 3
  ok((await tileV(page, 't-da')).startsWith(fmt(L0.da / 1e3, 1)), `semi-major axis drop ${fmt(L0.da / 1e3, 1)} km`);
  ok((await tileV(page, 't-throwpt')).startsWith('−' + fmt(L0.apogeeDrop / 1e3, 1)), `throw point −${fmt(L0.apogeeDrop / 1e3, 1)} km`);
  ok((await tileV(page, 't-perigee')).startsWith('−' + fmt(L0.perigeeDrop / 1e3, 1)), `half an orbit later −${fmt(L0.perigeeDrop / 1e3, 1)} km`);
  ok((await tileV(page, 't-tip')).startsWith(fmt(L0.tipLowestAfter / 1e3, 1)), `lower tip lowest ${fmt(L0.tipLowestAfter / 1e3, 1)} km`);
  let fv = await text(page, '#floor-verdict');
  ok(/^✗?\s*0 throws/.test(fv.replace(/\n/g, ' ')) || /\b0 throws\b/.test(fv), `floor 200 km: no throw keeps the tip above it (${fv.slice(0, 60)})`);
  ok((await text(page, '#min-hub')) === `${fmt(K.minHubForFloor(revA, { tier: 'reference', derate: '0.3', earthRadiusKm: RE }, 200e3) / 1e3, 0)} t`, 'minimum hub for a 200 km floor: 517 t');
  await setRange(page, '#floor', 150);
  await page.waitForTimeout(80);
  fv = await text(page, '#floor-verdict');
  ok(/\b1 throw\b/.test(fv) && /\b2\b if every catch is at perigee/.test(fv), `floor 150 km: 1 throw at apogee, 2 at perigee (${fv})`);
  ok((await page.locator('#chart-throws svg path').count()) >= 2, 'throws chart draws both phasings');

  // Skyhook's tether model from the button
  ok(/not run/.test(await text(page, '#tw-c3')), 'twin column says "not run" before the button');
  await page.locator('#twin-run').click();
  await page.waitForFunction(() => /done/.test(document.getElementById('twin-progress').textContent), null, { timeout: 120000 });
  ok((await text(page, '#tw-c3')) === fmt(TW.payloadC3 / 1e6, 2), `twin release C3 ${fmt(TW.payloadC3 / 1e6, 2)} on the page, as in Node`);
  ok(fmt(TW.payloadC3 / 1e6, 2) === '−8.74', 'and that is −8.74, not the canon −8.06');
  ok((await text(page, '#tw-da')).includes(fmt(TW.daAtRelease / 1e3, 2)), `twin da at release ${fmt(TW.daAtRelease / 1e3, 2)} km`);
  ok((await text(page, '#tw-tip')).includes(fmt(TW.lowestNodeAltM / 1e3, 1)), `twin lowest node ${fmt(TW.lowestNodeAltM / 1e3, 1)} km`);
  // a different hub makes the twin column stale, not wrong
  await page.locator('#hub').fill('300');
  await page.waitForTimeout(80);
  ok(/ran for another setup/.test(await text(page, '#tw-c3')), 'after a hub change the twin column says it ran for another setup');
  await page.locator('#hub').fill(String(HUB / 1e3));
  await page.waitForTimeout(80);
  ok((await text(page, '#tw-c3')) === fmt(TW.payloadC3 / 1e6, 2), 'and comes back when the setup does');

  // section 4: the four reconciliations
  const pins = await page.locator('#pins-table tbody tr').allInnerTexts();
  ok(pins.length === 3 && pins.every((r) => /✓ match/.test(r)), `canon C3 and apogee reproduced for all three tiers (${pins.length})`);
  ok(/✓ within its rel 0\.001/.test(await text(page, '#golden-line')), 'reboost_bound.py golden 1.056547e11 J reproduced within its rel');
  ok(/24 of 24\D+24 of 24[\s\S]*6 of 6/.test(await text(page, '#grid-line')), 'its published grid: 24 of 24 times, 24 of 24 labels, 6 of 6 minimum powers');
  ok(/2,184 km/.test(await text(page, '#mxer-ledger')), 'the DRAFT fork\'s apogee drops 2,184 km per throw');

  // section 5: refusals
  const refused = await page.locator('#refused-body .refusal').allInnerTexts();
  ok(refused.length === 3, `three standing refusals (${refused.length})`);
  ok(/insufficient_data/.test(refused[0]) && refused[0].includes('launch_price_anchor_dedicated_kgs') && !/\$\s?\d/.test(refused[0]), 'no $/kg: the canon economics keys are listed and no price is printed');
  ok(/insufficient_data/.test(refused[1]) && /15%/.test(refused[1]), 'cislunar at 15 % derate refused: no canon fibre mass');

  // keyboard: arrow from the reference to the cislunar tier
  await page.locator('#tier input').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  ok((await tileV(page, 't-perkg')).startsWith(fmt(CIS.perKg / 1e6, 2)), `keyboard ArrowRight to the cislunar tier: ${fmt(CIS.perKg / 1e6, 2)} MJ/kg`);
  const disabled = await page.locator('#derate input').evaluateAll((els) => els.map((e) => e.disabled));
  ok(JSON.stringify(disabled) === '[true,true,false]', `cislunar: 0 % and 15 % derate disabled (${disabled})`);
  ok(/only at 30 % derate/.test(await text(page, '#derate-hint')), 'derate hint says why');
  ok(!(await overflow(page)), 'no sideways scroll at 1280 px');
  await shot(page, 'desktop-light');
  ok(errors.length === 0, `no console errors on desktop: ${errors.join(' | ')}`);
  ok(requests.length === 0, `no network requests on desktop: ${requests.join(' ')}`);
  await context.close();
}

// 2. Phone, dark, by touch: refusals and the chart tooltip
{
  const { context, page, errors, requests } = await open(PHONE);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(13, 13, 13)', `dark background on phone (${bg})`);
  ok(!(await overflow(page)), 'no sideways scroll at 390 px on load');
  await shot(page, 'phone-dark-1-loaded');
  // release at the canon spin rate
  await page.locator('#release label').nth(1).tap();
  await page.waitForTimeout(80);
  ok((await tileV(page, 't-perkg')).startsWith(fmt(LOADED.perKg / 1e6, 2)), `loaded release: ${fmt(LOADED.perKg / 1e6, 2)} MJ/kg`);
  ok(/% less than the canon release/.test(await text(page, '#cost-body')), 'and says how much less than the canon state');
  await page.locator('#release label').nth(0).tap();
  // overload
  await page.locator('#payload').fill('6000');
  await page.waitForTimeout(80);
  let c = await text(page, '#cost-body');
  ok(/out_of_envelope/.test(c) && /5000 kg payload/.test(c), 'a 6,000 kg payload is refused: the canon sizes every tier for 5,000 kg');
  ok((await page.locator('#cost-body .tile').count()) === 0 && /out_of_envelope/.test(await text(page, '#back-body')) && /out_of_envelope/.test(await text(page, '#orbit-body')), 'and no tile, recovery time or ledger is printed under the refusal');
  ok(await page.locator('#twin-run').isDisabled(), 'the tether-model button is disabled while refused');
  await page.locator('#payload').fill('5000');
  // a blank hub
  await page.locator('#hub').fill('');
  await page.waitForTimeout(80);
  c = await text(page, '#cost-body');
  ok(/invalid_input/.test(c) && /hub mass/.test(c), 'a blank hub mass is refused, not read as zero');
  await page.locator('#hub').fill('200');
  await page.waitForTimeout(80);
  ok((await tileV(page, 't-perkg')).startsWith('43.03'), 'back to 43.03 MJ/kg');
  // Phase 3 escapes
  await page.locator('#tier label').nth(2).tap();
  await page.waitForTimeout(80);
  ok(/escape/.test(await text(page, '#loaded-note')), 'Phase 3: the canon release escapes');
  await page.locator('#tier label').nth(0).tap();
  await page.waitForTimeout(80);
  // tooltip by touch on the recovery chart
  await page.locator('#chart-rec svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart-rec svg').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.waitForTimeout(80);
  const tip = page.locator('#chart-rec .tip');
  ok(await tip.isVisible() && /26 %: [\d.,]+ d/.test(await tip.innerText()), 'tapping the recovery chart shows the days at each efficiency');
  ok(!(await overflow(page)), 'no sideways scroll at 390 px with the tooltip open');
  await page.locator('#sources details summary').tap();
  await page.waitForTimeout(80);
  ok(!(await overflow(page)), 'no sideways scroll at 390 px with the cited lines open');
  await shot(page, 'phone-dark-2-touched');
  ok(errors.length === 0, `no console errors on phone: ${errors.join(' | ')}`);
  ok(requests.length === 0, `no network requests on phone: ${requests.join(' ')}`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
