#!/usr/bin/env node
// ui-check.mjs — drives index.html in headless Chromium (the globally installed Playwright that
// tools/smoke.mjs uses) and checks what a reader would see: the numbers on the page equal the kernel's,
// the picker recomputes and refuses, the concordance filters, phone width in light and dark, keyboard and
// touch. From the bank root: node ideas/14-whose-earth/ui-check.mjs [--shots DIR]
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'model.js'));
const R = require(path.join(here, 'registry.js'));
const D = require(path.join(here, 'data.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1] || '.') : null;

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check skipped: Playwright is not installed');
    process.exit(0);
  }
}

// the kernel's own answers, for comparison with what the page prints
const saved = Object.fromEntries(D.rows.map((r) => [r.id, r]));
const rows = R.rows.map((r) => Object.assign({}, r, saved[r.id] || {}));
const K = M.analyze({ canon: D.inputs.canon, rows, sets: R.EARTH_SETS, workbook: D.inputs.workbook, grid: D.inputs.grid, expected: R.EXPECTED });
const S = K.earths.find((e) => e.id === 'skyhook');
const A = K.earths.find((e) => e.id === 'aster');

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
const DESK = { viewport: { width: 1280, height: 900 } };
const browser = await pw.chromium.launch();

async function open(opts, scheme) {
  const context = await browser.newContext(Object.assign({ colorScheme: scheme || 'light' }, opts));
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('file:')) requests.push(r.url()); });
  await page.goto(URL0);
  await page.waitForSelector('#tiles .tile');
  return { context, page, errors, requests };
}
const text = (page, sel) => page.locator(sel).first().innerText();
// clientWidth, not innerWidth: a mobile browser widens the layout viewport (and innerWidth) to fit overflowing content
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || window.innerWidth > document.documentElement.clientWidth + 1);
const wide = (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => {
  if (e.closest('.scroll') || e.closest('.tip')) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.right > document.documentElement.clientWidth + 1;
}).map((e) => e.tagName + '.' + e.className).slice(0, 5));

// 1. desktop, light: headline numbers equal the kernel's
{
  const { context, page, errors, requests } = await open(DESK);
  const tiles = await page.locator('#tiles .tile').allInnerTexts();
  ok(tiles.length === 6, `six tiles (${tiles.length})`);
  ok(tiles[0].includes(M.fmtRel((A.mu - S.mu) / S.mu)) && tiles[0].includes(M.fmt(A.mu, 4)), 'μ tile shows the relative difference and Aster μ');
  ok(tiles[1].includes(`${M.fmtSigned(A.R - S.R, 3)} km`), 'R tile shows the radius gap');
  const cis = K.iface.find((t) => t.tier === 'cislunar');
  ok(tiles[2].includes(`${M.fmtSigned(cis.apogee.B - cis.apogee.A, 0)} km`), 'cislunar apogee shift');
  const reb = K.reboostRows[0].byEarth.skyhook;
  ok(tiles[5].includes(M.fmt(reb.momentum, 2)) && tiles[5].includes(M.fmt(reb.orbital, 2)) && tiles[5].includes(String(K.target)), 'reboost tile: finance, orbital, MP-001');
  const src = await text(page, '#src');
  ok(src.includes(D.sources.aster.commit.slice(0, 7)) && src.includes(D.sources.skyhook.commit.slice(0, 7)), 'header names both commits');
  ok(src.includes(`${R.rows.length} cited lines`), 'header counts the rows');
  const radiiGroups = K.groups.R.filter((g) => g.family === 'R').length;
  ok((await page.locator('#radii-chart circle.ring').count()) === radiiGroups, `one dot per distinct radius (${radiiGroups})`);
  ok((await text(page, '#radii-h')).startsWith(`${radiiGroups} Earth radii`), 'radii heading counts the dots');
  // tooltip on hover lists sources
  await page.locator('#radii-chart circle.ring').first().hover();
  ok(await page.locator('#tip').isVisible(), 'hovering a dot shows its sources');
  // picker defaults to Aster's Earth
  ok((await page.locator('#presets button[aria-pressed="true"]').innerText()) === A.label, 'picker opens on Aster\'s Earth');
  const pickT = await text(page, '#pick-table');
  const tA = M.deriveCanon(D.inputs.canon, A);
  const c3 = tA.find((q) => q.path === 'kinematics.c3_kms2');
  ok(pickT.includes(M.fmt(c3.value, M.decimalsOf(c3.printed) + 1)), 'pick table shows the reference C3 on Aster\'s Earth, one decimal past the printed value');
  ok(await page.locator('#pick-refusal .refusal').isVisible(), 'lower-tip ground speed refused on Aster\'s Earth');
  ok((await text(page, '#pick-refusal')).includes('ASTER_ROADMAP'), 'refusal says what would help');
  // switch to Skyhook's Earth: refusal goes, 3 misses
  await page.locator('#presets button', { hasText: S.label }).click();
  ok((await page.locator('#pick-refusal .refusal').count()) === 0, 'no refusal on Skyhook\'s Earth');
  const nS = M.deriveCanon(D.inputs.canon, S).filter((q) => q.depends.length && q.reproduces !== null);
  ok((await text(page, '#pick-summary')).includes(`${nS.filter((q) => q.reproduces).length} of ${nS.length}`), 'summary counts reproductions on Skyhook\'s Earth');
  ok((await page.locator('#pick-table .mark.no').count()) === R.EXPECTED.skyhookNonReproducing.length, 'three ✗ on Skyhook\'s Earth');
  // choose a radius by hand: the chosen R changes the table
  const opts = await page.locator('#pick-r option').allInnerTexts();
  ok(opts.length === radiiGroups, 'radius options = distinct radii');
  await page.selectOption('#pick-r', { index: opts.findIndex((o) => o.includes('bodies.ts')) });
  ok((await page.locator('#presets button[aria-pressed="true"]').count()) === 0, 'a hand-picked Earth matches no preset');
  // K2
  const k2 = await text(page, '#k2-table');
  ok(k2.includes(M.fmtSigned(K.iface[0].c3.shift.mixed, 4)) && k2.includes(M.fmtSigned(K.iface[0].c3.shift.muOnly, 6)), 'K2 table shifts');
  ok((await page.locator('#k2-chart rect.bar').count()) === 4, 'four bars');
  const pins = await text(page, '#pins-table');
  ok(K.pins.every((p) => pins.includes(p.printed) && pins.includes(M.fmt(p.dvAster, 4))), 'Aster pins on the page');
  // reboost and grid
  const rb = await text(page, '#rb-table');
  ok(rb.includes(M.fmt(reb.groundRel, 2)), 'reboost table');
  const grid = await text(page, '#grid-table');
  ok(K.gridCheck.points.every((p) => grid.includes(M.fmt(p.published.reboost_electricity_per_kg, 4))), 'grid table shows every published line');
  ok((await page.locator('#grid-table .mark.ok').count()) === 9 && (await page.locator('#grid-table .mark.no').count()) === 9, '9 ✓ on Skyhook, 9 ✗ on Aster');
  // concordance: μ by default; Skyhook filter keeps the Aster value only where Skyhook states it
  ok((await page.locator('#conc-list .group').count()) === K.groups.mu.length, 'μ groups');
  await page.locator('#repo-chips button', { hasText: 'Skyhook' }).click();
  const conc = await text(page, '#conc-list');
  ok(conc.includes('skyhook_calculator.jsx:4') && !conc.includes('delta-v.ts'), 'Skyhook filter');
  await page.locator('#fam-chips button', { hasText: 'rotation' }).click();
  await page.locator('#repo-chips button', { hasText: 'Aster' }).click();
  ok(await page.locator('#conc-list .refusal').isVisible(), 'Aster rotation: a refusal, not a number');
  await page.locator('#fam-chips button', { hasText: 'reboost' }).click();
  await page.locator('#repo-chips button', { hasText: 'both' }).click();
  const en = await text(page, '#conc-list');
  ok(en.includes('mp001_market_pricing.md:37') && en.includes('skyhook_finance.py:215'), 'energy concordance');
  await page.locator('#conc-list details summary').first().click();
  ok(await page.locator('#conc-list details[open] pre').first().isVisible(), 'a site opens to its line');
  const gates = await page.locator('#gates li').allInnerTexts();
  ok(gates.length === K.gates.length && gates.every((g) => g.startsWith('pass')), 'all gates pass on the page');
  ok(errors.length === 0, `no console errors (${errors.join('; ')})`);
  ok(requests.length === 0, `no network requests (${requests.join(', ')})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png'), fullPage: true });
  await context.close();
}

// 2. keyboard
{
  const { context, page, errors } = await open(DESK);
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'pick-mu');
  }
  ok(reached, 'Tab reaches the μ picker');
  await page.focus('#radii-chart circle.ring');
  ok(await page.locator('#tip').isVisible(), 'focusing a dot shows its sources');
  await page.keyboard.press('Escape');
  ok(!(await page.locator('#tip').isVisible()), 'Escape hides it');
  ok(errors.length === 0, 'no console errors (keyboard)');
  await context.close();
}

// 3. phone, light and dark, by touch
for (const scheme of ['light', 'dark']) {
  const { context, page, errors } = await open(PHONE, scheme);
  ok(!(await overflow(page)), `${scheme} phone: no horizontal overflow`);
  ok((await wide(page)).length === 0, `${scheme} phone: nothing past the viewport (${(await wide(page)).join(', ')})`);
  const scrollers = await page.evaluate(() => [...document.querySelectorAll('.scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.firstElementChild && e.firstElementChild.id));
  ok(scrollers.length === 0, `${scheme} phone: every table fits without sideways scrolling (${scrollers.join(', ')})`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(18, 18, 17)' : bg === 'rgb(246, 245, 241)', `${scheme} background follows the scheme (${bg})`);
  for (const which of ['first', 'last']) {
    await page.locator('#radii-chart circle.ring')[which]().tap();
    ok(await page.locator('#tip').isVisible(), `${scheme} phone: tapping the ${which} dot shows its sources`);
    const tipBox = await page.locator('#tip').boundingBox();
    ok(tipBox && tipBox.x >= 0 && tipBox.x + tipBox.width <= 390 + 1, `${scheme} phone: the ${which} dot's tooltip stays inside the screen`);
    await page.locator('h1').tap();
  }
  await page.locator('h1').tap();
  await page.locator('#presets button').nth(2).tap();
  ok((await page.locator('#presets button[aria-pressed="true"]').innerText()) === K.earths[2].label, `${scheme} phone: preset by touch`);
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  await page.locator('#fam-chips button', { hasText: 'radius' }).tap();
  for (const d of await page.locator('#conc-list details').all()) await d.evaluate((e) => { e.open = true; });
  ok(!(await overflow(page)), `${scheme} phone: no overflow with every section open`);
  ok(errors.length === 0, `${scheme} phone: no console errors`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phone-${scheme}.png`), fullPage: true });
  await context.close();
}

// 4. a missing data.js is a refusal, not a blank page or a guess
{
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'whose-earth-'));
  for (const f of ['index.html', 'style.css', 'registry.js', 'model.js', 'app.js']) fs.copyFileSync(path.join(here, f), path.join(tmp, f));
  const context = await browser.newContext(DESK);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(pathToFileURL(path.join(tmp, 'index.html')).href);
  await page.waitForTimeout(200);
  ok((await page.locator('#src .refusal').count()) === 1, 'without data.js the page refuses and says what would help');
  ok((await page.locator('#tiles .tile').count()) === 0, 'and shows no numbers');
  ok(errors.filter((e) => !/ERR_FILE_NOT_FOUND|net::/.test(e)).length === 0, `no script errors besides the missing file (${errors.join('; ')})`);
  await context.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

await browser.close();
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
