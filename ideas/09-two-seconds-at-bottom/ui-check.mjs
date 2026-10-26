#!/usr/bin/env node
// Drives index.html in headless Chromium (the globally installed Playwright, loaded the way
// tools/smoke.mjs loads it) and checks what a person sees: the numbers on the page equal the
// kernel's, the refusal and warning states, phone width by touch, dark mode, keyboard, no network.
// From the bank root:  node ideas/09-two-seconds-at-bottom/ui-check.mjs
// Exits 0 when every check passes, 1 otherwise; prints "skipped" and exits 0 without Playwright.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CW = require(path.join(here, 'catchwindow.js'));
const CANON = require(path.join(here, 'snapshots', 'canon.data.js'));
const K = CW.create(CANON);
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

async function open(opts, init) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('file:')) errors.push(`network request: ${r.url()}`);
  });
  if (init) await page.addInitScript(init);
  await page.goto(URL0);
  await page.waitForTimeout(200);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (page, sel) => page.locator(sel).first().textContent();
const nums = (s) => (s.match(/[-−]?\d+(?:\.\d+)?/g) || []).map((x) => Number(x.replace('−', '-')));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
async function setNumber(page, id, value) {
  const el = page.locator(`#${id}`);
  await el.fill(String(value));
  await el.dispatchEvent('input');
  await page.waitForTimeout(80);
}

const REF = K.evaluate({ tier: 'reference', envelopeM: 10, velTolMps: 1, holdS: 10, requirementWindowsS: [3, 10] });

// 1. Desktop, light: the opening state equals the kernel.
{
  const { context, page, errors } = await open({ ...DESK, colorScheme: 'light' });
  ok((await page.locator('#tiers input[type=radio]').count()) === 3, 'three tiers built from the canon');
  ok(await page.locator('#tiers input[value=reference]').isChecked(), 'reference tier selected at start');
  ok((await page.inputValue('#L-num')) === String(K.constants.halfLengthKm), `half-length starts at the canon ${K.constants.halfLengthKm} km`);
  const head = await text(page, '#headline');
  ok(/for 1\.98 s/.test(head) && /±0\.99 s/.test(head), `headline carries the passive envelope window (${head.slice(0, 120)})`);
  ok(/for 0\.098 s/.test(head) && /±0\.049 s/.test(head), 'headline carries the passive velocity window');
  ok(new RegExp(`${REF.kin.aRel.toFixed(2)} m/s² = ${REF.kin.aRelG.toFixed(2)} g`).test(head), 'headline a_rel equals the kernel');
  ok(new RegExp(`${REF.held.deltaV.toFixed(0)} m/s`).test(head), 'headline hold dv equals the kernel');
  const chips = await page.locator('#chips .chip .v').allTextContents();
  ok(chips.length === 4 && chips[0].startsWith(REF.kin.aRel.toFixed(2)) && chips[1] === '1.98 s' && chips[2] === '0.098 s' && chips[3] === `${REF.held.deltaV.toFixed(0)} m/s`, `chips: ${chips.join(' | ')}`);
  const statuses = await page.locator('#statuses .status').allTextContents();
  ok(statuses.some((s) => /velocity tolerance/.test(s)), 'status names the binding constraint');
  ok(statuses.some((s) => /below the §4\.3 lower bound/.test(s)), 'status says the passive window misses the 3 s bound');
  ok(statuses.some((s) => /above the 150 km/.test(s)), 'status says the tip is above the scope line');
  ok(await page.locator('#refusal-card').isHidden(), 'no refusal at start');
  // charts drawn
  ok((await page.locator('#sketch path').count()) >= 3, 'sketch has band, arc and vehicle path');
  ok((await page.locator('#timeline path.series-pos').count()) === 1 && (await page.locator('#timeline path.series-vel').count()) === 1, 'timeline has both series');
  ok((await page.locator('#curve path.series-pos').count()) === 1 && (await page.locator('#curve path.series-vel').count()) === 1, 'curve has both series');
  const tlLabels = await page.locator('#timeline text.lab').allTextContents();
  ok(tlLabels.some((s) => /±0\.99 s inside ±10 m/.test(s)) && tlLabels.some((s) => /±0\.049 s inside ±1\.0 m\/s/.test(s)), `timeline edge labels: ${tlLabels.join(' | ')}`);
  // requirement cards
  const reqs = await page.locator('#reqs .req').allTextContents();
  ok(reqs.length === 2 && /A 3 s window/.test(reqs[0]) && /A 10 s window/.test(reqs[1]), 'two requirement cards');
  ok(/±23 m/.test(reqs[0]) && /30\.5 m\/s/.test(reqs[0]) && /61 m\/s/.test(reqs[0]), `3 s card: ${reqs[0]}`);
  ok(/±254 m/.test(reqs[1]) && /101\.7 m\/s/.test(reqs[1]) && /203 m\/s/.test(reqs[1]) && /4\.4 %/.test(reqs[1]), `10 s card: ${reqs[1]}`);
  // tier table
  const rows = await page.locator('#tiers-table tbody tr').allTextContents();
  ok(rows.length === 3, 'three tier rows');
  ok(/1\.99 \(1\.99\)/.test(rows[0]) && /4\.591 \(4\.59\)/.test(rows[0]), `reference row reconciles with the file: ${rows[0]}`);
  ok(/2\.50 \(2\.5\)/.test(rows[1]) && /\(—\)/.test(rows[1]), 'cislunar row shows the file states no ground-relative speed');
  ok(/3\.90 \(3\.9\)/.test(rows[2]) && /3\.591 \(3\.59\)/.test(rows[2]) && /391 m\/s/.test(rows[2]), `phase 3 row: ${rows[2]}`);
  // numbers table
  const numRows = await page.locator('#numbers tbody tr').allTextContents();
  ok(numRows.some((r) => /Relative acceleration a_rel/.test(r) && new RegExp(REF.kin.aRel.toFixed(3)).test(r)), 'numbers table a_rel');
  ok(numRows.some((r) => /Lower tip inertial speed/.test(r) && /5056\.311 m\/s/.test(r) && /golden\.json/.test(r)), 'numbers table pins the golden lower-tip state');
  ok(numRows.some((r) => /CoM radius used/.test(r) && /6981 km/.test(r) && /6988 km/.test(r)), 'numbers table discloses both Earth radii');
  ok(numRows.some((r) => /Exact two-body check/.test(r) && /exit at 0\.9917 s \(closed form 0\.9917 s\)/.test(r)), `exact check line: ${numRows.find((r) => /Exact/.test(r))}`);
  // convention and modulation
  const conv = await text(page, '#convention-body');
  ok(/4\.591 km\/s/.test(conv) && /4\.571 km\/s/.test(conv) && /465\.1 m\/s/.test(conv) && /485\.7 m\/s/.test(conv) && /21 m\/s less/.test(conv), `convention card: ${conv.slice(0, 200)}`);
  const mod = await text(page, '#modulation-body');
  ok(/2462\.6 m\/s/.test(mod) && /1\.5 % below/.test(mod) && /20\.93 m\/s²/.test(mod), `modulation card: ${mod.slice(0, 200)}`);
  ok(/34935cb/.test(await text(page, '#prov')) && /NASA NSSDC/.test(await text(page, '#prov')), 'footer carries the commit and the Earth-rotation source');
  // hover tooltip lists both series
  await page.locator('#timeline').scrollIntoViewIfNeeded();
  const box = await page.locator('#timeline').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await page.waitForTimeout(80);
  const tip = await text(page, '#tl-tip');
  ok((await page.locator('#tl-tip').getAttribute('aria-hidden')) === 'false' && /separation/.test(tip) && /relative speed/.test(tip), `timeline tooltip: ${tip}`);
  // keyboard on the chart
  await page.locator('#timeline').focus();
  await page.keyboard.press('Home');
  await page.waitForTimeout(30);
  ok(/t = 0\.00 s/.test(await text(page, '#tl-tip')), `Home puts the cursor on the match instant (${await text(page, '#tl-tip')})`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  ok(/t = 0\.1[0-9] s/.test(await text(page, '#tl-tip')), `arrow key moves the cursor one step (${await text(page, '#tl-tip')})`);
  await page.keyboard.press('Escape');
  ok((await page.locator('#tl-tip').getAttribute('aria-hidden')) === 'true', 'Escape hides the tooltip');
  ok(errors.length === 0, `desktop console/network clean: ${errors.join('; ')}`);
  await context.close();
}

// 2. Desktop: changing inputs changes the numbers the way the kernel says; refusal and warning.
{
  const { context, page, errors } = await open(DESK);
  // envelope 40 m: t_pos doubles (sqrt scaling)
  await setNumber(page, 'env-num', 40);
  let head = await text(page, '#headline');
  const e40 = K.evaluate({ tier: 'reference', envelopeM: 40, velTolMps: 1, holdS: 10 });
  ok(new RegExp(`for ${e40.passive.totalPos.toFixed(2)} s`).test(head), `envelope 40 m: ${e40.passive.totalPos.toFixed(2)} s on the page`);
  // hold 3 s via the mark button
  await page.locator('button[data-hold="3"]').click();
  await page.waitForTimeout(80);
  head = await text(page, '#headline');
  ok(/hold station for 3 s/.test(head) && /61 m\/s/.test(head), `3 s button: ${head.slice(-120)}`);
  ok((await page.inputValue('#hold')) === '3', 'slider follows the button');
  // keyboard on the hold slider: ArrowRight adds one step (0.5 s)
  await page.locator('#hold').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  ok((await page.inputValue('#hold-num')) === '3.5' && /hold station for 3\.5 s/.test(await text(page, '#headline')), 'ArrowRight on the slider moves the window to 3.5 s');
  // phase 3 tier
  await page.locator('#tiers input[value=phase3]').check();
  await page.waitForTimeout(80);
  const p3 = K.evaluate({ tier: 'phase3', envelopeM: 40, velTolMps: 1, holdS: 3.5 });
  head = await text(page, '#headline');
  ok(new RegExp(`${p3.kin.aRel.toFixed(2)} m/s² = ${p3.kin.aRelG.toFixed(2)} g`).test(head), `phase 3 a_rel ${p3.kin.aRel.toFixed(2)} on the page`);
  ok(/Phase 3/.test(await text(page, '#tiers-table tr.canon-row')), 'the tier table highlights the selected tier');
  // low tip: warning, not refusal
  await setNumber(page, 'L-num', 500);
  const st = await page.locator('#statuses .status').allTextContents();
  ok(st.some((s) => /tip at 110 km, below 150 km/.test(s)), `warning for a 110 km tip: ${st.join(' | ')}`);
  ok(await page.locator('#refusal-card').isHidden(), 'a low tip is a warning, not a refusal');
  // underground: refusal, numbers hidden
  await setNumber(page, 'L-num', 650);
  ok(await page.locator('#refusal-card').isVisible(), 'L = 650 km refuses');
  const ref = await text(page, '#refusal-card');
  ok(/out_of_envelope/.test(ref) && /below the ground/.test(ref) && /What would help/.test(ref), `refusal text: ${ref.slice(0, 160)}`);
  ok(await page.locator('#results').isHidden() && await page.locator('#verdict').isHidden(), 'no numbers shown with the refusal');
  // canon button restores
  await page.locator('#L-canon').click();
  await page.waitForTimeout(80);
  ok(await page.locator('#refusal-card').isHidden() && (await page.inputValue('#L-num')) === String(K.constants.halfLengthKm), 'canon button restores the half-length and clears the refusal');
  // non-number envelope: refusal
  await setNumber(page, 'env-num', 0);
  ok(await page.locator('#refusal-card').isVisible() && /envelope must be a positive number/.test(await text(page, '#refusal-card')), 'zero envelope refuses');
  await setNumber(page, 'env-num', 10);
  ok(await page.locator('#refusal-card').isHidden(), 'envelope back to 10 clears it');
  ok(errors.length === 0, `desktop interaction console clean: ${errors.join('; ')}`);
  await context.close();
}

// 3. Canon absent: a structured refusal, no numbers, no error.
{
  const { context, page, errors } = await open(DESK, () => {
    Object.defineProperty(window, 'SKYHOOK_CANON', { configurable: true, get: () => undefined, set: () => {} });
  });
  ok(await page.locator('#refusal-card').isVisible(), 'missing canon shows the refusal card');
  const t = await text(page, '#refusal-card');
  ok(/not_found/.test(t) && /canon snapshot/.test(t) && /build-data\.mjs/.test(t), `missing-canon refusal: ${t.slice(0, 160)}`);
  ok(await page.locator('#results').isHidden() && await page.locator('#verdict').isHidden(), 'no numbers without the canon');
  ok(errors.length === 0, `no console error without the canon: ${errors.join('; ')}`);
  await context.close();
}

// 4. Phone, dark, touch: no overflow, charts respond to a tap, controls work by touch.
{
  const { context, page, errors } = await open({ ...PHONE, colorScheme: 'dark' });
  ok(!(await overflow(page)), 'phone dark: no horizontal overflow at load');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(13, 13, 13)', `dark background applied (${bg})`);
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  ok(ink === 'rgb(240, 239, 236)', `dark ink applied (${ink})`);
  // every element stays inside the viewport
  const worst = await page.evaluate(() => {
    let w = 0;
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (r.width > 0) w = Math.max(w, r.right);
    }
    return w;
  });
  ok(worst <= 390 + 1, `widest element reaches ${worst}px (the tier table stacks into cards on a phone)`);
  ok((await page.evaluate(() => getComputedStyle(document.querySelector('#tiers-table tr')).display)) === 'block', 'tier rows are stacked blocks on a phone');
  // tap the 10 s button, then the chart
  await page.locator('button[data-hold="10"]').tap();
  await page.waitForTimeout(80);
  ok(/hold station for 10 s/.test(await text(page, '#headline')), 'touch tap on the 10 s button');
  await page.locator('#curve').scrollIntoViewIfNeeded();
  const box = await page.locator('#curve').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.waitForTimeout(80);
  const tip = await text(page, '#cv-tip');
  ok((await page.locator('#cv-tip').getAttribute('aria-hidden')) === 'false' && /inside ±10 m/.test(tip) && /inside ±1\.0 m\/s/.test(tip), `curve tooltip by touch: ${tip}`);
  await page.locator('#tiers input[value=cislunar]').tap();
  await page.waitForTimeout(80);
  const cis = K.evaluate({ tier: 'cislunar', envelopeM: 10, velTolMps: 1, holdS: 10 });
  ok(new RegExp(`${cis.kin.aRel.toFixed(2)} m/s²`).test(await text(page, '#headline')), 'cislunar by touch');
  ok(!(await overflow(page)), 'phone dark: still no overflow after interaction');
  // caption text is not cut: chart text sizes stay readable (>= 10 px on screen)
  const minFont = await page.evaluate(() => {
    let m = 99;
    for (const t of document.querySelectorAll('svg text')) {
      const r = t.getBoundingClientRect();
      if (r.height > 0) m = Math.min(m, r.height);
    }
    return m;
  });
  ok(minFont >= 10, `smallest chart glyph box on a 390 px phone is ${minFont.toFixed(1)} px tall (charts size their viewBox to the rendered width)`);
  const vb = await page.evaluate(() => {
    const s = document.getElementById('timeline');
    return [s.viewBox.baseVal.width, s.clientWidth];
  });
  ok(Math.abs(vb[0] - vb[1]) <= 1, `timeline viewBox width ${vb[0]} equals its rendered width ${vb[1]}`);
  ok(errors.length === 0, `phone console/network clean: ${errors.join('; ')}`);
  await context.close();
}

// 5. Phone, light: refusal state has no overflow either.
{
  const { context, page, errors } = await open({ ...PHONE, colorScheme: 'light' });
  await setNumber(page, 'L-num', 700);
  ok(await page.locator('#refusal-card').isVisible(), 'phone: refusal shows');
  ok(!(await overflow(page)), 'phone: refusal state has no overflow');
  ok(errors.length === 0, `phone light console clean: ${errors.join('; ')}`);
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
