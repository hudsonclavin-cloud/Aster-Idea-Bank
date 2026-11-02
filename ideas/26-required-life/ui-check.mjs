#!/usr/bin/env node
// Drives the Required Life page in headless Chromium and checks what a person sees: the refusal
// before an HMPE share is chosen, the numbers after (against model.js), the DM20 tick leaving the
// tested life alone, the unpriced badge, the lumpy convention, the Phase 3 refusal, a bad life,
// keyboard selection, and no sideways scroll or console error at 390 px in dark mode and at
// desktop width in light mode. Uses the globally installed Playwright, as tools/smoke.mjs does.
//   node ideas/26-required-life/ui-check.mjs [--shots DIR]
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'model.js'));
const D = require(path.join(here, 'data.js'));
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

const browser = await pw.chromium.launch();
let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
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
  await page.waitForTimeout(100);
  return { context, page, errors, requests };
}
const text = (page, sel) => page.locator(sel).innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

const E = M.economics(D, 'Conservative', 'reference');
const fMass = M.hmpeShareByMass(E, D.founding.zylon_outer_lower_arm_km);
const rMass = M.requiredLives(E, { f: fMass, fiberPerKg: null, convention: 'rolling' });
const perUnit = M.requiredLives(E, { f: 1, fiberPerKg: null, convention: 'rolling' });

// 1. Phone, dark, by touch
{
  const { context, page, errors, requests } = await open(PHONE);
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(dark === 'rgb(19, 24, 27)', `dark background on phone (${dark})`);
  let v = await text(page, '#verdict');
  ok(/No required life yet/.test(v), 'opens on a refusal: no HMPE share chosen');
  ok(v.includes(`${M.fmt.years(perUnit.payback[0].life)} × the share`), `refusal states the per-share scaling (${M.fmt.years(perUnit.payback[0].life)})`);
  ok(!/\d+(\.\d+)? years at \d+% of rated break/.test(v), 'no required life is printed before a share is chosen');
  ok(await page.locator('#required').isHidden(), 'required-life table hidden while refused');
  ok(/Choose an HMPE share/.test(await text(page, '#chart-box')), 'chart refuses to draw');
  ok(/Nothing to test yet/.test(await text(page, '#forward-out')), 'forward view refuses');
  ok(!(await overflow(page)), 'no sideways scroll at 390 px (refused state)');
  const fills = await page.locator('[data-fill]').allTextContents();
  ok(fills.length === 5 && fills.every((t) => t && t !== '…'), `every sourced figure in the static text is filled from data.js (${fills.join(' | ')})`);
  ok((await text(page, '.tag')).includes('28–40'), 'header states the 28–40% range from MP-001 §3c');
  await shot(page, 'phone-dark-1-refused');

  await page.locator('#share label').nth(1).tap();
  await page.waitForTimeout(80);
  v = await text(page, '#verdict');
  const want = M.fmt.years(rMass.payback[0].life);
  ok(v.includes(`at least ${want}`), `verdict prints the required life for the mass share (${want})`);
  ok(v.includes(`Y${rMass.payback[0].target}`) && v.includes(`Y${rMass.payback[1].target}`), 'verdict names Y17 and Y18');
  ok(/about 8 years for SK78 at 20% of break and 20 °C/.test(v), 'verdict states the anchored datum with its load and temperature');
  ok(/ST-002 and TP-001 must measure/.test(v), 'verdict ends on what must be measured');
  ok(/fiber unpriced: a floor/.test(v), 'unpriced chip on the verdict');
  const rows = await page.locator('#required tbody tr').allInnerTexts();
  ok(rows.length === 6, `six criteria rows (${rows.length})`);
  ok(rows[0].includes(M.fmt.years(rMass.payback[0].life)) && rows[1].includes(M.fmt.years(rMass.payback[1].life)), 'payback rows match model.js');
  ok(rows[4].includes(M.fmt.years(rMass.ops)) && rows[5].includes(M.fmt.years(rMass.floor)), 'fixed-ops and floor rows match model.js');
  ok(/No 15-year-window life/.test(await text(page, '#required-refusals')), 'window criterion refused for the conservative case');
  const svgTexts = await page.locator('#chart-box svg text').allTextContents();
  ok(svgTexts.some((t) => t === 'SK78 ≈ 8 yr @20%'), 'anchored SK78 tick drawn');
  ok(svgTexts.some((t) => t.startsWith('needs ≥ ')), 'required-life marker drawn');
  ok(!svgTexts.some((t) => t.startsWith('DM20')), 'no DM20 tick before the toggle');
  const fw = M.forward(E, { f: fMass, life: 8, fiberPerKg: null, convention: 'rolling' });
  const fwText = await text(page, '#forward-out');
  ok(fwText.includes(M.fmt.money(fw.annual_M)), `forward view prints ${M.fmt.money(fw.annual_M)} a year`);
  ok(fwText.includes(`Y${fw.payback}`), `forward view payback Y${fw.payback}`);
  ok(fwText.includes(M.fmt.money(fw.npv_M)), 'forward view NPV matches model.js');
  ok(!(await overflow(page)), 'no sideways scroll at 390 px (computed state)');
  await shot(page, 'phone-dark-2-mass');

  // DM20 moves only the tick
  const lifeBefore = await page.locator('#life').inputValue();
  const rangeBefore = await page.locator('#life-range').inputValue();
  await page.locator('#dm20').tap();
  await page.waitForTimeout(80);
  ok((await page.locator('#life').inputValue()) === lifeBefore && (await page.locator('#life-range').inputValue()) === rangeBefore, 'DM20 toggle leaves the tested life unchanged');
  const svg2 = await page.locator('#chart-box svg text').allTextContents();
  ok(svg2.some((t) => t === 'DM20 > 400 yr @20%'), 'DM20 tick drawn at 8 x 50 = 400 yr');
  ok(svg2.some((t) => t === 'SK78 ≈ 8 yr @20%'), 'SK78 tick still at 8 yr');
  const st = await text(page, '#st002');
  const thr = M.fmt.sig(M.creepRatioThreshold(400, rMass.payback[0].life), 3);
  ok(st.includes(`${thr}×`), `ST-002 reading gives the ratio ${thr}`);
  ok(/cannot meet this requirement/.test(st), 'ST-002 reading says SK78 cannot meet it under the assumption');
  ok(fwText === (await text(page, '#forward-out')), 'forward view unchanged by the DM20 toggle');
  await shot(page, 'phone-dark-3-dm20');

  // fiber bracket
  await page.locator('#fiber').fill('300');
  await page.waitForTimeout(80);
  ok((await text(page, '#fiber-badge')) === 'your bracket, not a quote', 'typed fiber price is labelled a bracket');
  const r300 = M.requiredLives(E, { f: fMass, fiberPerKg: 300, convention: 'rolling' });
  ok((await text(page, '#verdict')).includes(M.fmt.years(r300.payback[0].life)), `fiber $300/kg raises the required life to ${M.fmt.years(r300.payback[0].life)}`);
  await page.locator('#fiber').fill('-5');
  await page.waitForTimeout(80);
  ok(/Fiber price not usable/.test(await text(page, '#required-refusals')) && (await text(page, '#fiber-badge')) === 'invalid', 'a negative fiber price is refused, not computed');
  ok(!/at least \d/.test(await text(page, '#verdict')), 'no required life printed for a negative fiber price');
  await page.locator('#fiber-clear').tap();
  await page.waitForTimeout(80);
  ok((await text(page, '#fiber-badge')) === 'unpriced', 'Clear restores the unpriced badge');

  // lumpy
  await page.locator('#convention label').nth(1).tap();
  await page.waitForTimeout(150);
  const rl = M.requiredLives(E, { f: fMass, fiberPerKg: null, convention: 'lumpy' });
  const lrows = await page.locator('#required tbody tr').allInnerTexts();
  ok(lrows[0].includes(M.fmt.years(rl.payback[0].life)), `lumpy: Y17 holds from ${M.fmt.years(rl.payback[0].life)}`);
  ok(/Swaps inside 15 years/.test(await text(page, '#forward-out')), 'lumpy forward view counts swaps');
  await page.locator('#convention label').nth(0).tap();

  // a bad life
  await page.locator('#life').fill('0');
  await page.waitForTimeout(80);
  ok(/No life to test/.test(await text(page, '#forward-out')), 'a zero life is refused');
  await page.locator('#life').fill('30');
  await page.waitForTimeout(80);
  ok((await text(page, '#forward-out')).includes('Y17'), 'a 30-year life keeps Y17');

  // Phase 3 tier refuses
  await page.locator('#tier label').nth(2).tap();
  await page.waitForTimeout(150);
  ok(/No life is long enough/.test(await text(page, '#verdict')), 'Phase 3 conservative: no life is long enough');
  ok(/does not pay back within 40 years/.test(await text(page, '#chart-box')), 'Phase 3: chart refuses');
  ok(!(await overflow(page)), 'no sideways scroll at 390 px (Phase 3)');
  await shot(page, 'phone-dark-4-phase3');

  ok(errors.length === 0, `no console errors on phone: ${errors.join(' | ')}`);
  ok(requests.length === 0, `no network requests: ${requests.join(' ')}`);
  await context.close();
}

// 2. Desktop, light, keyboard
{
  const { context, page, errors } = await open(DESK);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(244, 242, 236)', `light background on desktop (${bg})`);
  await page.locator('#share input').nth(2).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  const rAll = M.requiredLives(E, { f: 1, fiberPerKg: null, convention: 'rolling' });
  ok((await text(page, '#verdict')).includes(`at least ${M.fmt.years(rAll.payback[0].life)}`), `keyboard: All HMPE gives ${M.fmt.years(rAll.payback[0].life)}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  ok(await page.locator('#share-custom-row').isVisible(), 'arrow key moves to "Your own share" and shows its slider');
  await page.locator('#column input').nth(1).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  ok(/Baseline: sensitivity, not base case/.test(await text(page, '#verdict')), 'non-conservative column is labelled a sensitivity');
  ok(/HMPE runs at \(1 − derate\)\/SF = 34% of rated break/.test(await text(page, '#column-note')), 'baseline column runs HMPE at 34%');
  ok(!(await overflow(page)), 'no sideways scroll at 1280 px');
  await page.locator('#column input').nth(0).focus();
  await page.keyboard.press('Space');
  await page.locator('#share input').nth(1).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  await shot(page, 'desktop-light-mass');
  ok(errors.length === 0, `no console errors on desktop: ${errors.join(' | ')}`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
