#!/usr/bin/env node
// ui-check.mjs: drives index.html in headless Chromium (the globally installed Playwright, loaded
// the way tools/smoke.mjs and Idea Bank's 74-whose-turn/ui-check.mjs load it) and checks what a
// person would see: the numbers on the page against the kernel, the canon-only twin overlay, the
// refusals (half-length past the ground, canon snapshot missing, twin run missing), keyboard and
// touch reading of the charts, phone width and dark mode. Run from the bank root:
//   node ideas/16-spin-wobble/ui-check.mjs
// Prints "skipped" and exits 0 when Playwright is not installed; exits 1 on any failed check.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const W = require(path.join(here, 'wobble.js'));
const CANON = require(path.join(here, 'snapshots', 'canon.data.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright not installed)');
    process.exit(0);
  }
}

const C = W.readCanon(CANON);
const num = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtV = (x) => num(x, 1) + ' m/s';
const fmtS = (x) => num(x, 1) + ' s';
const pct = (x) => num(Math.abs(x) * 100, 2) + ' %';

let checks = 0, failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`FAIL ${msg}`); }
}
const browser = await pw.chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };

async function open(opts, { block = [] } = {}) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  for (const b of block) await page.route(`**/${b}`, (r) => r.abort());
  await page.goto(URL0);
  await page.waitForTimeout(200);
  return { context, page, errors };
}
const text = (page, sel) => page.locator(sel).first().textContent();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
async function setRange(page, id, value) {
  await page.evaluate(([i, v]) => { const e = document.getElementById(i); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, value]);
}
async function tilesMatch(page, m, label) {
  ok((await text(page, '#t-vert')) === fmtV(m.vVertical), `${label}: vertical tile ${await text(page, '#t-vert')} vs ${fmtV(m.vVertical)}`);
  ok((await text(page, '#t-horiz')) === fmtV(m.vHorizontal), `${label}: horizontal tile`);
  ok((await text(page, '#t-mean')) === fmtV(m.vMean), `${label}: mean tile`);
  ok((await text(page, '#t-half')) === fmtS(m.halfPeriod), `${label}: half-period tile`);
  ok((await text(page, '#t-horiz-s')).includes(pct(m.dipFromVertical)), `${label}: dip in the horizontal tile`);
}

// 1. Desktop, light: the canon numbers, the twin overlay, the claims, keyboard reading of a chart.
{
  const { context, page, errors } = await open({ ...DESK, colorScheme: 'light' });
  const ref = W.fromCanon(C, { tier: 'reference' });
  await tilesMatch(page, ref, 'canon');
  ok((await text(page, '#t-half-s')).includes(fmtS(2 * ref.halfPeriod)), 'bottom-to-bottom time in the tile');
  ok((await page.locator('#chart-a path.s2').count()) >= 2, 'the recorded twin turns are drawn at the canon');
  ok((await page.locator('#chart-a path.s1').count()) === 1, 'closed form drawn');
  ok((await page.locator('#chart-b path.s2').count()) === 1, 'residual drawn');
  ok((await page.locator('#claims .claim-row').count()) === 5, 'five claim rows');
  ok((await page.locator('#claims .chip.wrong').count()) === 3, 'three claims marked wrong');
  const claimsText = await text(page, '#claims');
  ok(claimsText.includes(pct(ref.programDip)) && claimsText.includes(pct(ref.dipFromVertical)), 'docstring check quotes both dips');
  ok(claimsText.includes(fmtS(2 * ref.halfPeriod)) && claimsText.includes(fmtS(ref.inertialPeriod)), 'periapsis check quotes both periods');
  const gm = CANON.golden.meta;
  const gw = W.integrate(ref, { dt: gm.dt, steps: Math.round(gm.duration_s / gm.dt) });
  ok(claimsText.includes(fmtV(gw.meanV)), 'golden-window mean is the kernel\'s');
  ok((await text(page, '#cb-facts')).includes(fmtV(CANON.golden.mean_tip_speed_mps)), 'golden mean shown as recorded');
  for (const q of CANON.claims) ok(claimsText.includes(q.text), `claim ${q.id} quoted verbatim`);
  const rows = await page.locator('#tier-table tbody tr').count();
  ok(rows === 3, 'three tier rows');
  const tierText = await text(page, '#tier-table');
  for (const t of ['reference', 'cislunar', 'phase3']) ok(tierText.includes(pct(W.fromCanon(C, { tier: t }).dipFromVertical)), `tier ${t} dip in the table`);
  // keyboard: focus chart A, step with the arrows, escape
  await page.focus('#chart-a svg');
  ok(await page.locator('#chart-a .tip').isVisible(), 'focus shows the readout');
  const h1 = await text(page, '#chart-a .tip .head');
  await page.keyboard.press('ArrowRight');
  const h2 = await text(page, '#chart-a .tip .head');
  ok(h1 !== h2 && /91°/.test(h2), `arrow moves the readout (${h1} -> ${h2})`);
  ok((await text(page, '#chart-a .tip')).includes(fmtV(ref.tipSpeed(91 * Math.PI / 180))), 'readout value is the kernel\'s');
  ok((await page.locator('#chart-a .tip .row').count()) === 3, 'readout at 91° lists the closed form and both twin turns');
  await page.keyboard.press('Escape');
  ok(!(await page.locator('#chart-a .tip').isVisible()), 'escape hides the readout');
  // tab order reaches the controls
  await page.focus('#tiers button');
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.closest('#tiers') !== null), 'tab moves through the tier buttons');
  ok(errors.length === 0, `desktop console errors: ${errors.join(' | ')}`);
  ok(!(await overflow(page)), 'desktop: no horizontal overflow');
  await context.close();
}

// 2. Moving away from the canon, then refusing, then back.
{
  const { context, page, errors } = await open({ ...DESK, colorScheme: 'dark' });
  await setRange(page, 'len', 400);
  await tilesMatch(page, W.fromCanon(C, { LKm: 400 }), 'L 400 km');
  ok((await page.locator('#chart-a path.s2').count()) === 0, 'no twin overlay away from the canon');
  ok((await text(page, '#ca-note')).includes('only for the canon case'), 'says why the overlay is absent');
  ok((await text(page, '#state-note')).includes('half-length'), 'state note names the change');
  await setRange(page, 'phase', 90);
  const h = W.fromCanon(C, { LKm: 400, theta0Deg: 90 });
  await tilesMatch(page, h, 'L 400, horizontal');
  ok((await text(page, '#t-vert-s')).includes('above'), 'horizontal spin-up: the vertical speed is above the set value');
  await page.click('#tiers button[data-id="phase3"]');
  await tilesMatch(page, W.fromCanon(C, { tier: 'phase3', LKm: 400, theta0Deg: 90 }), 'phase 3');
  await page.click('#radii button[data-id="file"]');
  await tilesMatch(page, W.fromCanon(C, { tier: 'phase3', LKm: 400, theta0Deg: 90, radius: 'file' }), 'file radius');
  await setRange(page, 'len', C.altKm + 10);
  ok(await page.locator('#refusal').isVisible(), 'refusal shown past the ground');
  ok((await text(page, '#r-code')).includes('out_of_envelope'), 'refusal code');
  ok((await text(page, '#r-reason')).includes('below the ground'), 'refusal reason');
  ok((await text(page, '#r-help')).length > 10, 'refusal says what would help');
  ok(!(await page.locator('#results').isVisible()), 'no numbers while refused');
  ok(await page.locator('#claims-card').isVisible(), 'the canon claims stay');
  await page.click('#reset');
  ok(!(await page.locator('#refusal').isVisible()), 'reset clears the refusal');
  await tilesMatch(page, W.fromCanon(C, { tier: 'reference' }), 'after reset');
  ok((await page.locator('#chart-a path.s2').count()) >= 2, 'overlay back at the canon');
  ok((await page.locator('#tiers button[aria-pressed="true"]').getAttribute('data-id')) === 'reference', 'reset restores the tier');
  ok(errors.length === 0, `console errors: ${errors.join(' | ')}`);
  await context.close();
}

// 3. Phone, dark, by touch: no overflow, a tap reads the chart, a tap on a slider moves it.
{
  const { context, page, errors } = await open({ ...PHONE, colorScheme: 'dark' });
  ok(!(await overflow(page)), 'phone: no horizontal overflow');
  await page.locator('#chart-a svg').scrollIntoViewIfNeeded();
  const b2 = await page.locator('#chart-a svg').boundingBox();
  await page.touchscreen.tap(b2.x + b2.width * 0.5, b2.y + b2.height * 0.5);
  ok(await page.locator('#chart-a .tip').isVisible(), 'tap shows the readout');
  await page.locator('#len').scrollIntoViewIfNeeded();
  const r = await page.locator('#len').boundingBox();
  await page.touchscreen.tap(r.x + r.width * 0.9, r.y + r.height / 2);
  const v = Number(await page.locator('#len').inputValue());
  ok(v !== C.LKm, `tapping the slider moves it (${v})`);
  ok((await text(page, '#len-out')) === num(v, 0) + ' km', 'slider output follows');
  const contrast = await page.evaluate(() => {
    const lum = (s) => { const m = s.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const fg = getComputedStyle(document.querySelector('.t-v')).color;
    const bg = getComputedStyle(document.querySelector('.tile')).backgroundColor;
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  ok(contrast > 7, `dark tile text contrast ${contrast.toFixed(1)}`);
  ok(!(await overflow(page)), 'phone: still no overflow after interaction');
  ok(errors.length === 0, `phone console errors: ${errors.join(' | ')}`);
  await context.close();
}

// 4. Refusals when a snapshot is missing.
{
  const { context, page, errors } = await open({ ...PHONE, colorScheme: 'light' }, { block: ['canon.data.js'] });
  ok(await page.locator('#refusal').isVisible(), 'no canon: refusal');
  ok((await text(page, '#r-code')).includes('not_found'), 'no canon: code');
  ok((await text(page, '#r-help')).includes('canon.data.js'), 'no canon: what would help');
  ok(!(await page.locator('#results').isVisible()) && !(await page.locator('#controls').isVisible()), 'no canon: no numbers, no controls');
  const body = await page.locator('main').innerText();
  ok(!/\d,\d{3}\.\d m\/s/.test(body), 'no canon: no speed anywhere on the page');
  ok(errors.length === 0, `no-canon console errors: ${errors.join(' | ')}`);
  await context.close();
}
{
  const { context, page, errors } = await open({ ...DESK, colorScheme: 'light' }, { block: ['twin-overlay.js'] });
  ok((await text(page, '#cb-note')).startsWith('Refused'), 'no twin run: chart B refuses');
  ok(!(await page.locator('#cb-body').isVisible()), 'no twin run: no residual chart');
  ok((await page.locator('#chart-a path.s2').count()) === 0, 'no twin run: no overlay');
  await tilesMatch(page, W.fromCanon(C, { tier: 'reference' }), 'no twin run, closed form still shown');
  ok(errors.length === 0, `no-twin console errors: ${errors.join(' | ')}`);
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
