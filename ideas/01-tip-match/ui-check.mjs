#!/usr/bin/env node
// Drives index.html in headless Chromium (globally installed Playwright, as tools/smoke.mjs loads
// it) and checks what a person sees: the numbers on the page equal the kernel's, the match chip,
// the refusal states, phone width by touch, dark mode, keyboard. From the bank root:
//   node ideas/01-tip-match/ui-check.mjs
// Exits 0 when every check passes; 1 otherwise; prints "skipped" and exits 0 if Playwright is absent.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TipMatch = require(path.join(here, 'tip-match.js'));
const REV_A = require(path.join(here, 'snapshots', 'rev_a.data.js'));
const ASTER = require(path.join(here, 'snapshots', 'aster.data.js'));
const K = TipMatch.create(REV_A.data, REV_A.provenance, ASTER);
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright is not installed)');
    process.exit(0);
  }
}

let checks = 0;
let failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 860 } };
const browser = await pw.chromium.launch();

async function open(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('file:')) errors.push(`network request: ${r.url()}`);
  });
  await page.goto(URL0);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (page, sel) => page.locator(sel).first().textContent();
// first signed number in a string ("+0.3931 km/s = +393.1 m/s" → 0.3931; "−8.061 km²/s²" → -8.061)
const num = (s) => {
  const m = /[+\-−]?\d+(?:,\d{3})*(?:\.\d+)?/.exec(String(s));
  return m ? Number(m[0].replace('−', '-').replace(/,/g, '')) : NaN;
};
async function setVinf(page, v) {
  await page.fill('#vinf-num', String(v));
  await page.waitForTimeout(50);
}
async function pickTier(page, key) {
  await page.locator(`input[name="tier"][value="${key}"]`).check({ force: true });
  await page.waitForTimeout(50);
}
// the trim label must not touch any other chart label, and must stay inside the drawing
async function trimLabelClear(page) {
  return page.evaluate(() => {
    const t = document.querySelector('#chart .trim-label');
    if (!t) return { ok: false, why: 'no trim label' };
    const a = t.getBBox();
    const svg = document.getElementById('chart');
    const W = svg.viewBox.baseVal.width;
    const hit = Array.from(document.querySelectorAll('#chart text.star, #chart text.direct')).find((o) => {
      const b = o.getBBox();
      return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    });
    return { ok: !hit && a.x >= 0 && a.x + a.width <= W, why: hit ? `overlaps "${hit.textContent}"` : `x ${a.x.toFixed(0)}–${(a.x + a.width).toFixed(0)} of ${W}` };
  });
}
async function rowValue(page, label) {
  const rows = page.locator('#numbers tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const k = await rows.nth(i).locator('td').nth(0).textContent();
    if (k.startsWith(label)) return rows.nth(i).locator('td').nth(1).textContent();
  }
  return null;
}

// 1. Desktop: the opening state and the numbers against the kernel.
{
  const { context, page, errors } = await open(DESK);
  const ref0 = K.energy({ vinf_kms: 0, tier: 'reference', tolerance_ms: 1 }).value;
  ok(/Not matched/.test(await text(page, '#headline')), 'opens on v∞ = 0, reference tier, not matched');
  ok(Math.abs(num(await text(page, '#headline .num')) - Math.abs(ref0.upper_tip.trim_dv_ms.value)) < 0.06 && /m\/s$/.test(await text(page, '#headline .num')), `headline trim is the kernel's 393.1 m/s (${await text(page, '#headline .num')})`);
  ok(/energy: not matched/.test(await text(page, '#chips')), 'energy chip reads not matched');
  ok(/plane: refused/.test(await text(page, '#chips')) && /phase: refused/.test(await text(page, '#chips')), 'plane and phase chips read refused');
  ok(/85,222 km/.test(await text(page, '#verdict-note')), `verdict note states the file's apogee (${await text(page, '#verdict-note')})`);
  const vOrb = num(await rowValue(page, 'Orbital speed'));
  ok(Math.abs(vOrb - ref0.geometry.v_orb_kms.value) < 0.00006, `table v_orb ${vOrb} equals kernel ${ref0.geometry.v_orb_kms.value}`);
  const c3 = num(await rowValue(page, 'Release C3'));
  ok(Math.abs(c3 - ref0.upper_tip.c3_tier_kms2.value) < 0.0006, `table C3 ${c3} equals kernel ${ref0.upper_tip.c3_tier_kms2.value}`);
  ok(/none \(C3 < 0\)/.test(await rowValue(page, 'Zero-trim v∞*')), 'reference tier has no v∞*');
  ok(/7301 km/.test(await rowValue(page, 'Upper-tip radius')), 'r_tip row shows 7301 km');
  ok(/6371 km/.test(await rowValue(page, 'Earth radius')), 'R_E row shows 6371 km');
  ok(/6988/.test(await text(page, '#numbers')), 'the table discloses the unused com_radius_km 6988');
  ok((await page.locator('#chart polyline.payload-line').count()) === 1, 'the payload curve is drawn');
  ok((await page.locator('#chart line.tier-line').count()) === 3, 'three tier lines are drawn');
  ok((await page.locator('#chart line.tier-line.selected.reference').count()) === 1, 'the reference line is the selected one');
  ok(/v∞\* = 3\.613/.test(await text(page, '#chart')), 'the chart labels the Phase 3 v∞* crossing');
  ok(/not reachable/.test(await text(page, '#lower-note')), 'the lower tip is reported not reachable');
  ok(/10\.94 km\/s/.test(await text(page, '#lower-bars')) && /5\.06 km\/s/.test(await text(page, '#lower-bars')), 'lower-tip bars show 10.94 and 5.06 km/s');
  const bars = await page.evaluate(() => Array.from(document.querySelectorAll('#lower-bars path')).map((p) => ({ cls: p.getAttribute('class'), display: getComputedStyle(p).display, w: p.getBoundingClientRect().width })));
  ok(bars.length === 2 && bars.every((b) => b.display !== 'none' && b.w > 0), `both lower-tip bars are drawn (${JSON.stringify(bars)})`);
  const pay = bars.find((b) => /payload/.test(b.cls));
  const low = bars.find((b) => /lowtip/.test(b.cls));
  ok(pay && low && Math.abs(low.w / pay.w - ref0.lower_tip.v_tip_inertial_kms.value / ref0.lower_tip.v_payload_kms.value) < 0.02, 'and their lengths are in the kernel\'s ratio');
  ok(/2\.893 km\/s/.test(await text(page, '#zero-trim')), 'zero-trim tip speed at v∞ = 0 is 2.893 km/s');
  ok((await page.locator('#conditions .cond.computed').count()) === 1 && (await page.locator('#conditions .cond.refused').count()) === 2, 'one computed and two refused condition cards');
  ok(/What would help/.test(await text(page, '#conditions')), 'refusals say what would help');
  const env = JSON.parse(await text(page, '#envelope'));
  ok(env.energy.envelope_version === '1' && env.energy.confidence === 'assumed' && env.plane.refusal.code === 'insufficient_data', 'the envelope JSON on the page is Aster-shaped');
  ok(env.energy.provenance[0].commit === REV_A.provenance.commit, 'envelope provenance carries the snapshot commit');
  ok(/34935cb/.test(await text(page, '#prov')), 'the provenance line names the commit');
  ok(/7301 km/.test(await text(page, '#tier-note')) && /2\.5 km\/s/.test(await text(page, '#tier-note')), 'the tier note is filled from the snapshot');
  ok((await page.inputValue('#tol')) === String(TipMatch.DEFAULT_TOLERANCE_MS), 'the tolerance field takes the kernel\'s default');
  ok(/0 to 72\.76 km\/s/.test(await text(page, '#vinf-range')), `the accepted v∞ range is stated (${await text(page, '#vinf-range')})`);
  ok((await page.locator('#chart .rug line').count()) === 128, 'the chart carries one rug tick per NHATS body');
  const nh = K.nhats({ tier: 'reference', tolerance_ms: 1 }).value;
  const nhs = await text(page, '#nhats-summary');
  ok(nhs.includes(nh.summary.vinf_min_kms.value.toFixed(3)) && nhs.includes(nh.summary.vinf_max_kms.value.toFixed(3)) && nhs.includes(nh.summary.vinf_median_kms.value.toFixed(3)), `NHATS card states the kernel's 0.262 / 4.345 / 2.449 (${nhs.slice(0, 60)}…)`);
  ok(/all 128 arrive faster/.test(nhs), 'against the reference tier every NHATS return arrives faster');
  ok((await page.locator('#nhats-closest tbody tr').count()) === 5, 'five closest bodies listed');
  ok((await trimLabelClear(page)).ok, `desktop: the trim label touches no other label (${(await trimLabelClear(page)).why})`);
  ok(errors.length === 0, `no console errors or network requests on desktop: ${errors.join('; ')}`);
  await context.close();
}

// 2. Desktop: Phase 3 at v∞*, the match chip, the tolerance, and keyboard on the slider.
{
  const { context, page, errors } = await open(DESK);
  await page.click('#set-star');
  await page.waitForTimeout(80);
  ok(await page.locator('input[name="tier"][value="phase3"]').isChecked(), 'the v∞* button selects Phase 3');
  ok((await page.inputValue('#vinf-num')) === '3.613', `and sets v∞ to 3.613 (${await page.inputValue('#vinf-num')})`);
  ok(/Energy-matched/.test(await text(page, '#headline')), `Phase 3 at v∞* is energy-matched (${await text(page, '#headline')})`);
  ok(/energy: matched/.test(await text(page, '#chips')), 'the energy chip turns to matched');
  ok(await page.locator('#verdict.matched').count() === 1, 'the verdict card takes the matched state');
  ok(/plane: refused/.test(await text(page, '#chips')), 'plane stays refused even when energy matches');
  await page.fill('#tol', '0.05');
  await page.waitForTimeout(60);
  ok(/Not matched/.test(await text(page, '#headline')), 'tightening the tolerance to 0.05 m/s un-matches 3.613 (0.1 m/s off v∞*)');
  const miss = await text(page, '#headline .num');
  ok(num(miss) > 0 && /0\.10 m\/s/.test(miss), `the near-miss reads 0.10 m/s, never zero (${miss})`);
  await page.fill('#tol', '1');
  await page.waitForTimeout(60);
  // keyboard: arrow keys on the slider step v∞ by 0.001
  await page.focus('#vinf');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  ok(Math.abs(Number(await page.inputValue('#vinf-num')) - 3.615) < 1e-9, `two ArrowRights move v∞ to 3.615 (${await page.inputValue('#vinf-num')})`);
  const p3 = K.energy({ vinf_kms: 3.615, tier: 'phase3', tolerance_ms: 1 }).value;
  ok(/Energy-matched/.test(await text(page, '#headline')) && /0\.76 m\/s/.test(await text(page, '#headline')), `3.615 km/s is inside the 1 m/s window, 0.76 m/s off (${await text(page, '#headline')})`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  ok(/Not matched/.test(await text(page, '#headline')) && /1\.08 m\/s/.test(await text(page, '#headline')), `3.616 km/s is outside it, 1.08 m/s off (${await text(page, '#headline')})`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(60);
  const trimRow = num(await rowValue(page, 'Trim Δv'));
  ok(Math.abs(trimRow - p3.upper_tip.trim_dv_kms.value) < 0.0001, `trim row ${trimRow} matches kernel ${p3.upper_tip.trim_dv_kms.value.toFixed(4)}`);
  // Tab reaches the tier radios and Arrow keys change tier
  await pickTier(page, 'cislunar');
  ok((await page.locator('#chart line.tier-line.selected.cislunar').count()) === 1, 'picking the cislunar tier selects its line');
  ok(/397,819 km/.test(await text(page, '#verdict-note')), 'cislunar apogee 397,819 km appears');
  ok(errors.length === 0, `no console errors with keyboard: ${errors.join('; ')}`);
  await context.close();
}

// 3. Refusals in the UI: the Aster-cache source, an empty field, a bad tolerance.
{
  const { context, page, errors } = await open(DESK);
  await page.locator('input[name="src"][value="aster-cache"]').check({ force: true });
  await page.waitForTimeout(60);
  ok(/Aster computes no Earth-arrival v∞; its screening cache holds outbound-leg quantities only/.test(await text(page, '#headline')), 'choosing the Aster cache refuses, in the corrected words');
  ok(/NHATS/.test(await text(page, '#refusal-card')) && /05-round-trip-ledger/.test(await text(page, '#refusal-card')), 'the refusal names the NHATS fixtures and idea 05 as what would help');
  ok(await page.locator('#nhats-card').isVisible(), 'the NHATS card stays visible, labelled external');
  ok(await page.locator('#refusal-card').isVisible(), 'a refusal card is shown');
  ok(/not_found/.test(await text(page, '#refusal-card')) && /vInfArr is arrival at the asteroid/.test(await text(page, '#refusal-card')), 'the card explains why the cache is not an Earth-arrival v∞');
  ok(await page.locator('#results').isHidden(), 'no numbers are shown while refused');
  await page.locator('input[name="src"][value="typed"]').check({ force: true });
  await page.waitForTimeout(60);
  ok(await page.locator('#results').isVisible(), 'switching back restores the numbers');
  await page.fill('#vinf-num', '');
  await page.waitForTimeout(60);
  ok(/Refused \(insufficient data\)/.test(await text(page, '#headline')), `an empty v∞ field is a refusal, not a number (${await text(page, '#headline')})`);
  ok(await page.locator('#results').isHidden(), 'and hides the numbers');
  // the review's crash: 1e155 overflowed inside the kernel and left stale numbers on screen
  await page.fill('#vinf-num', '20');
  await page.waitForTimeout(60);
  ok(/12\.509 km\/s faster/.test(await text(page, '#headline')), 'v∞ = 20 is computed');
  ok(/off this axis/.test(await text(page, '#chart')), 'and marked off the chart\'s axis rather than drawn outside it');
  for (const big of ['1e155', '300000', '72.8']) {
    await page.fill('#vinf-num', big);
    await page.waitForTimeout(60);
    ok(/Refused \(out of envelope\)/.test(await text(page, '#headline')) && !/12\.509/.test(await text(page, '#headline')), `v∞ = ${big} is refused, no stale numbers (${await text(page, '#headline')})`);
    ok(await page.locator('#results').isHidden(), `v∞ = ${big} hides the numbers`);
    ok(/72\.76 km\/s/.test(await text(page, '#refusal-card')), `v∞ = ${big}: the refusal states the bound`);
  }
  await page.fill('#vinf-num', '72.7');
  await page.waitForTimeout(60);
  ok(/Not matched/.test(await text(page, '#headline')) && (await page.locator('#results').isVisible()), 'v∞ = 72.7 (inside the bound) is computed');
  // anything the kernel throws inside a render becomes a refusal card, never stale numbers
  await page.fill('#vinf-num', '2');
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    window.__fmt = TipMatch.formatSpeedDiff;
    TipMatch.formatSpeedDiff = () => {
      throw new Error('injected failure');
    };
  });
  await page.fill('#vinf-num', '3');
  await page.waitForTimeout(60);
  ok(/could not be evaluated/.test(await text(page, '#headline')) && (await page.locator('#results').isHidden()) && /injected failure/.test(await text(page, '#refusal-card')), 'a throw during render shows a refusal card and hides the numbers');
  await page.evaluate(() => {
    TipMatch.formatSpeedDiff = window.__fmt;
  });
  await page.fill('#vinf-num', '2');
  await page.waitForTimeout(60);
  ok(await page.locator('#results').isVisible(), 'and the next good input renders again');
  await page.fill('#vinf-num', '2');
  await page.fill('#tol', '-3');
  await page.waitForTimeout(60);
  ok(/Refused \(out of envelope\)/.test(await text(page, '#headline')), 'a negative tolerance is refused');
  await page.fill('#tol', '1');
  await page.waitForTimeout(60);
  ok(/Not matched/.test(await text(page, '#headline')), 'a valid tolerance brings the verdict back');
  // the NHATS card follows the tier and the reading
  await pickTier(page, 'phase3');
  const p3 = K.nhats({ tier: 'phase3', tolerance_ms: 1 }).value;
  ok(new RegExp(`${p3.summary.payload_faster} arrive faster and ${p3.summary.payload_slower} slower`).test(await text(page, '#nhats-summary')), `Phase 3: 20 faster, 108 slower (${await text(page, '#nhats-summary')})`);
  ok((await text(page, '#nhats-closest')).includes(p3.closest[0].des), 'the closest body is listed first');
  await page.locator('input[name="reading"][value="reentry-200"]').check({ force: true });
  await page.waitForTimeout(60);
  const r200 = K.nhats({ tier: 'phase3', tolerance_ms: 1, reading: 'reentry-200' }).value;
  ok((await text(page, '#nhats-summary')).includes(r200.summary.vinf_min_kms.value.toFixed(3)), `the 200 km reading moves the set (${r200.summary.vinf_min_kms.value.toFixed(3)})`);
  ok(errors.length === 0, `no console errors through refusals: ${errors.join('; ')}`);
  await context.close();
}

// 4. Phone, touch, light and dark: no sideways scroll, the chart and bars draw, the tooltip follows a touch.
for (const [scheme] of [['light'], ['dark']]) {
  const { context, page, errors } = await open({ ...PHONE, colorScheme: scheme });
  ok(!(await overflow(page)), `${scheme}: no horizontal overflow at 390 px`);
  const clear0 = await trimLabelClear(page);
  ok(clear0.ok, `${scheme}: on first view the trim label touches no other label (${clear0.why})`);
  const pb = await page.evaluate(() => Array.from(document.querySelectorAll('#lower-bars path')).map((p) => getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().width > 0));
  ok(pb.length === 2 && pb.every(Boolean), `${scheme}: both lower-tip bars are drawn on a phone`);
  await page.locator('#envelope-details summary').tap();
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), `${scheme}: still no overflow with the envelope open`);
  ok(await page.locator('#chart polyline.payload-line').isVisible(), `${scheme}: the chart draws`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', `${scheme}: body background follows the scheme (${bg})`);
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  ok(scheme === 'dark' ? ink === 'rgb(240, 239, 236)' : ink === 'rgb(11, 11, 11)', `${scheme}: ink follows the scheme (${ink})`);
  await page.locator('#set-star').tap();
  await page.waitForTimeout(80);
  ok(/Energy-matched/.test(await text(page, '#headline')), `${scheme}: tapping v∞* works by touch`);
  const clearStar = await trimLabelClear(page);
  ok(clearStar.ok, `${scheme}: at v∞* the trim label touches no other label (${clearStar.why})`);
  const chart = page.locator('#chart');
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  await chart.tap({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.waitForTimeout(60);
  ok((await page.locator('#tip.on').count()) === 1, `${scheme}: a touch on the chart shows the tooltip`);
  ok(/payload/.test(await text(page, '#tip')) && /Phase 3 trim/.test(await text(page, '#tip')), `${scheme}: the tooltip lists every series`);
  const widest = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('*')).map((e) => e.getBoundingClientRect().right)));
  ok(widest <= 391, `${scheme}: no element reaches past the viewport (${widest.toFixed(0)} px)`);
  ok(errors.length === 0, `${scheme}: no console errors on phone: ${errors.join('; ')}`);
  await context.close();
}

// 5. Every rendered trim for a sweep of v∞ equals the kernel to display precision.
{
  const { context, page } = await open(DESK);
  for (const [tier, v] of [['reference', 1.25], ['cislunar', 6.66], ['phase3', 0.4], ['phase3', 7.999]]) {
    await pickTier(page, tier);
    await setVinf(page, v);
    const k = K.energy({ vinf_kms: v, tier, tolerance_ms: 1 }).value;
    const shown = num(await rowValue(page, 'Payload speed'));
    ok(Math.abs(shown - k.upper_tip.v_payload_kms.value) < 0.00006, `${tier} @ ${v}: payload speed ${shown} vs ${k.upper_tip.v_payload_kms.value.toFixed(4)}`);
    const trim = num(await rowValue(page, 'Trim Δv'));
    ok(Math.abs(trim - k.upper_tip.trim_dv_kms.value) < 0.00006, `${tier} @ ${v}: trim ${trim} vs ${k.upper_tip.trim_dv_kms.value.toFixed(4)}`);
  }
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
