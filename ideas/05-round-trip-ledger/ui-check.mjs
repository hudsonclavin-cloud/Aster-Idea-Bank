#!/usr/bin/env node
// Drives index.html in headless Chromium (globally installed Playwright, as tools/smoke.mjs loads it)
// and checks what a person sees: the numbers on the page equal the kernel's, the toggles change the
// right rows, the refusals show, phone width by touch in light and dark, keyboard. From the bank root:
//   node ideas/05-round-trip-ledger/ui-check.mjs
// Exits 0 when every check passes; 1 otherwise; prints "skipped" and exits 0 if Playwright is absent.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ledger = require(path.join(here, 'ledger.js'));
const DATA = require(path.join(here, 'nhats-data.js'));
const K = Ledger.create(DATA);
const S = K.stats();
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
const DESK = { viewport: { width: 1280, height: 900 } };
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
  await page.waitForTimeout(200);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (page, sel) => page.locator(sel).first().textContent();
const num = (s) => {
  const m = /[+\-−]?\d+(?:,\d{3})*(?:\.\d+)?/.exec(String(s));
  return m ? Number(m[0].replace('−', '-').replace(/,/g, '')) : NaN;
};
const f3 = (x) => x.toFixed(3);
async function rowValue(page, key) {
  const r = page.locator(`tr[data-row="${key}"] td.v`);
  return (await r.count()) ? r.first().textContent() : null;
}
async function pick(page, name, value) {
  await page.locator(`input[name="${name}"][value="${value}"]`).check({ force: true });
  await page.waitForTimeout(60);
}

// 1. Desktop: the opening state against the kernel.
{
  const { context, page, errors } = await open(DESK);
  const prov = await text(page, '#prov');
  ok(/135 fixture files/.test(prov) && /130 /.test(prov) && /128 unique bodies/.test(prov) && new RegExp(K.aster.commit.slice(0, 7)).test(prov), `provenance line states 135 / 130 / 128 and the commit (${prov.slice(0, 120)}…)`);
  const tile = async (k) => text(page, `.tile[data-k="${k}"] .v`);
  ok(Math.abs(num(await tile('ratio-min')) - S.ratio.unique.min) < 0.0006, `min ratio tile ${await tile('ratio-min')} equals the kernel's ${f3(S.ratio.unique.min)}`);
  ok(Math.abs(num(await tile('ratio-median')) - S.ratio.unique.median) < 0.0006, `median tile ${await tile('ratio-median')}`);
  ok(Math.abs(num(await tile('ratio-max')) - S.ratio.unique.max) < 0.0006, `max tile ${await tile('ratio-max')}`);
  ok(new RegExp(`^${S.ratio.within10pct} of ${S.ratio.unique.n}`).test(await tile('within10')), `within-10% tile ${await tile('within10')}`);
  ok(new RegExp(`^${S.ratio.offByTwoOrMore} of`).test(await tile('off2x')), `off-by-2x tile ${await tile('off2x')}`);
  ok(/×0\.56 to ×2\.32/.test(await tile('mass')), `mass tile reads the measured factor range (${await tile('mass')})`);
  ok((await page.locator('#ratio-hist rect.hit').count()) === 13, 'the ratio histogram has 13 bins');
  ok((await page.locator('#ratio-hist path.bar').count()) >= 10, 'bars are drawn');
  ok(/Aster: 1/.test(await text(page, '#ratio-hist')), 'the symmetric marker is labelled');
  const rows = await page.locator('#ratio-table tbody tr').count();
  ok(rows === S.counts.uniqueBodies, `the table lists ${rows} bodies`);
  // body panel opens on Bennu, sample-return, symmetric
  const b = K.bodyLedger('101955');
  ok(Math.abs(num(await rowValue(page, 'injection')) - b.stack.injectionKmps) < 0.0006, `injection row ${await rowValue(page, 'injection')} equals the kernel`);
  ok(Math.abs(num(await rowValue(page, 'departure')) - b.stack.departureKmps) < 0.0006, `departure row is the symmetric ${f3(b.stack.departureKmps)}`);
  ok(Math.abs(num(await rowValue(page, 'total')) - b.stack.totalKmps) < 0.0006, `total row ${await rowValue(page, 'total')}`);
  ok(Math.abs(num(await rowValue(page, 'nhats-total')) - b.nhats.dv_total) < 0.0006, 'NHATS dv_total row');
  ok(/residual 0\.0 m\/s/.test(await text(page, '#nhats-delta')) || /residual -0\.0 m\/s/.test(await text(page, '#nhats-delta')), `NHATS residual is shown as 0.0 m/s (${(await text(page, '#nhats-delta')).slice(0, 80)})`);
  ok((await page.locator('#stack-bar .seg-fill').count()) === 5, 'the stacked bar has five segments');
  ok(/×0\.989/.test(await text(page, '#cons')), `Bennu's mass factor ×0.989 is shown (${(await text(page, '#cons')).slice(0, 60)})`);
  ok(/4\.172 km\/s/.test(await text(page, '#cons')), 'Bennu\'s implied Earth-arrival v∞ 4.172 km/s is shown');
  ok((await page.locator('#cons .badge.AMBER').count()) >= 1, 'Bennu\'s dec_dep is badged AMBER from the Cape');
  ok(/C3 0\.510/.test(await text(page, '#aster-today')) && /different objective/.test(await text(page, '#aster-today')), 'the cache line shows Bennu\'s minC3 and the different-objective label');
  ok(/insufficient_data/.test(await text(page, '#return-leg')) && /K1/.test(await text(page, '#return-leg')), 'the return leg is a structured refusal naming K1');
  ok(await page.locator('#refusal').isHidden(), 'no refusal card for a body that is in NHATS');
  ok(/0\.5 m\/s/.test(await text(page, '#inj')) && /6778\.137 km/.test(await text(page, '#inj')), 'the injection panel states the 0.5 m/s reproduction and the best-fit radius');
  ok(/GREEN \(\|δ\| ≤ 28\.5°\): 56/.test(await text(page, '#dec-legend')), `declination legend counts GREEN 56 (${await text(page, '#dec-legend')})`);
  ok(/0\.262 km\/s/.test(await text(page, '#arr-foot')) && /4\.345 km\/s/.test(await text(page, '#arr-foot')), 'Earth-arrival range 0.262 to 4.345 km/s is stated');
  ok(/62ddb17/.test(await text(page, '#foot')), 'the footer names the commit');
  ok(errors.length === 0, `no console errors or network requests on desktop: ${errors.join('; ')}`);
  await context.close();
}

// 2. Desktop: the toggles.
{
  const { context, page, errors } = await open(DESK);
  await pick(page, 'dep', 'nhats');
  const b = K.bodyLedger('101955', { departure: 'nhats' });
  ok(Math.abs(num(await rowValue(page, 'departure')) - b.stack.departureKmps) < 0.0006, `NHATS departure row ${await rowValue(page, 'departure')} = 1.533`);
  ok(Math.abs(num(await rowValue(page, 'total')) - b.stack.totalKmps) < 0.0006, 'total moves with the departure line');
  ok((await page.locator('#stack-bar .seg-fill.departure.swap').count()) === 1, 'the swapped segment is marked');
  ok(/NHATS vrel_dep_neo/.test(await text(page, 'tr[data-row="departure"]')), 'the departure row names its basis');
  await pick(page, 'mode', 'one-way');
  ok(/none in one-way mode/.test(await text(page, 'tr[data-row="departure"]')), 'one-way: the departure row says none');
  ok(await page.locator('input[name="dep"]').first().isDisabled(), 'one-way disables the departure toggle');
  ok(/unchanged/.test(await text(page, '#cons')), 'one-way: delivered mass unchanged');
  ok((await page.locator('#stack-bar .seg-fill').count()) === 4, 'one-way stacked bar has four segments');
  await pick(page, 'mode', 'sample-return');
  await page.selectOption('#body', '2008 EL68');
  await page.waitForTimeout(80);
  const el68 = K.bodyLedger('2008 EL68', { departure: 'nhats' });
  ok(Math.abs(num(await rowValue(page, 'departure')) - el68.stack.departureKmps) < 0.0006, `2008 EL68 with NHATS departure: ${await rowValue(page, 'departure')} = 0.207`);
  ok(/×1\.290/.test(await text(page, '#cons')), '2008 EL68 mass factor ×1.290');
  await page.selectOption('#body', '2003 YN107');
  await page.waitForTimeout(80);
  ok(await page.locator('#refusal').isVisible() && /not_found/.test(await text(page, '#refusal')) && /What would help/.test(await text(page, '#refusal')), 'a body not in NHATS shows a structured refusal');
  ok(await page.locator('#ledger').isHidden(), 'and hides the ledger');
  await page.selectOption('#body', '2000 SG344');
  await page.waitForTimeout(80);
  ok(await page.locator('#ledger').isVisible() && /validation-targets\/2000_SG344\.json and oq7-coorbital\/2000_SG344\.json/.test(await text(page, '#body-note')), '2000 SG344 lists both fixture sources');
  // arrival altitude toggle
  await pick(page, 'alt', 'tb');
  ok(/at 200 km/.test(await text(page, '#vinf-hist')) && /1\.211 km\/s/.test(await text(page, '#arr-foot')), 'the 200 km convention re-draws the histogram and states 1.211 km/s');
  await pick(page, 'alt', 'nhats');
  // declination toggles
  await pick(page, 'decwhich', 'arr');
  ok(/Earth-arrival declination/.test(await text(page, '#dec-hist')) && /GREEN \(\|δ\| ≤ 28\.5°\): 60/.test(await text(page, '#dec-legend')), 'dec_arr: GREEN 60');
  await pick(page, 'site', 'VANDENBERG_SFB');
  ok(/RED \(> 90°\): 0/.test(await text(page, '#dec-legend')), 'Vandenberg: no RED');
  await pick(page, 'decwhich', 'dep');
  ok(/GREEN \(\|δ\| ≤ 70°\): 115/.test(await text(page, '#dec-legend')), 'Vandenberg dec_dep: GREEN 115');
  ok((await page.locator('#dec-hist rect[class^="band-"]').count()) === 3, 'Vandenberg draws GREEN and two AMBER bands, no RED');
  // keyboard: Tab onto a histogram bar shows the tooltip
  await page.locator('#ratio-hist rect.hit').nth(6).focus();
  await page.waitForTimeout(60);
  ok(await page.locator('#tip').isVisible() && /bod/.test(await text(page, '#tip')), `focusing a bar shows its tooltip (${await text(page, '#tip')})`);
  const bins = K.histogram(S.rows.map((r) => r.ratio), K.geometricEdges(Math.pow(2, -2.5), 16, 13)).bins;
  ok(new RegExp(`^${bins[6].count} `).test(await text(page, '#tip')), `the tooltip count is the kernel's ${bins[6].count}`);
  ok(errors.length === 0, `no console errors on toggles: ${errors.join('; ')}`);
  await context.close();
}

// 3. Phone, light and dark, by touch.
for (const scheme of ['light', 'dark']) {
  const { context, page, errors } = await open({ ...PHONE, colorScheme: scheme });
  ok(!(await overflow(page)), `no horizontal overflow at 390 px (${scheme})`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', `body background follows the ${scheme} scheme (${bg})`);
  await page.locator('#ratio-table-details summary').tap();
  await page.waitForTimeout(80);
  ok(!(await overflow(page)), `no overflow with the table open (${scheme})`);
  const hit = page.locator('#ratio-hist rect.hit').nth(6);
  await hit.tap();
  await page.waitForTimeout(80);
  ok(await page.locator('#tip').isVisible(), `a tap on a bar shows the tooltip (${scheme})`);
  await page.locator('#deps label').nth(1).tap();
  await page.waitForTimeout(80);
  ok(/NHATS vrel_dep_neo/.test(await text(page, 'tr[data-row="departure"]')), `the departure toggle works by touch (${scheme})`);
  // every element stays inside the viewport except the full table, which scrolls sideways inside its own box
  const wide = await page.evaluate(() => [...document.querySelectorAll('.card, .tile, table, svg, select, .seg, dl, .bar')].filter((e) => !e.closest('.scroll') && e.getBoundingClientRect().right > window.innerWidth + 1).length);
  ok(wide === 0, `no element reaches past the viewport (${scheme}): ${wide}`);
  const scrollBox = await page.evaluate(() => {
    const s = document.querySelector('#ratio-table-details .scroll');
    return { right: s.getBoundingClientRect().right, inner: window.innerWidth, scrolls: s.scrollWidth > s.clientWidth + 1 };
  });
  ok(scrollBox.right <= scrollBox.inner + 1 && scrollBox.scrolls, `the table's box stays inside the viewport and scrolls within itself (${scheme})`);
  // the histograms are drawn at their real pixel width, so their 11 px labels are not scaled down
  const scale = await page.evaluate(() => [...document.querySelectorAll('.chart svg')].map((s) => s.getBoundingClientRect().width / s.viewBox.baseVal.width));
  ok(scale.length === 3 && scale.every((r) => r > 0.98 && r < 1.02), `SVGs render at 1:1 on a phone (${scheme}): ${scale.map((r) => r.toFixed(2)).join(', ')}`);
  const labelPx = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.chart svg text')].map((t) => t.getBoundingClientRect().height)));
  ok(labelPx >= 10, `rendered SVG label height ≥ 10 px on a phone (${scheme}): ${labelPx.toFixed(1)}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.chart svg')].flatMap((s) => [...s.querySelectorAll('text')].filter((t) => t.getBoundingClientRect().right > s.getBoundingClientRect().right + 1 || t.getBoundingClientRect().left < s.getBoundingClientRect().left - 1).map((t) => t.textContent)));
  ok(clipped.length === 0, `no SVG label is clipped at phone width (${scheme}): ${clipped.join(' | ')}`);
  ok(errors.length === 0, `no console errors on the phone (${scheme}): ${errors.join('; ')}`);
  await context.close();
}

// 4. A sweep: four bodies × both departure lines, page numbers equal the kernel to display precision.
{
  const { context, page, errors } = await open(DESK);
  for (const des of ['2025 WR7', '459872', '1999 AO10', '2011 WE']) {
    await page.selectOption('#body', des);
    for (const dep of ['symmetric', 'nhats']) {
      await pick(page, 'dep', dep);
      const b = K.bodyLedger(des, { departure: dep });
      ok(Math.abs(num(await rowValue(page, 'total')) - b.stack.totalKmps) < 0.0006, `${des} ${dep}: total ${await rowValue(page, 'total')} vs ${f3(b.stack.totalKmps)}`);
      ok(Math.abs(num(await rowValue(page, 'departure')) - b.stack.departureKmps) < 0.0006, `${des} ${dep}: departure row`);
    }
    const c = await text(page, '#cons');
    const b = K.bodyLedger(des);
    ok(new RegExp(`×${f3(b.massFactor).replace('.', '\\.')}`).test(c), `${des}: mass factor ${f3(b.massFactor)} shown`);
    ok(new RegExp(`${f3(b.arrival.atNhatsAltitude.value).replace('.', '\\.')} km/s`).test(c), `${des}: implied v∞ ${f3(b.arrival.atNhatsAltitude.value)} shown`);
  }
  ok(errors.length === 0, `no console errors in the sweep: ${errors.join('; ')}`);
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
