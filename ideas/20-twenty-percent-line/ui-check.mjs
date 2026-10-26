#!/usr/bin/env node
// Drives the page in headless Chromium and checks what a reader would see: the numbers against
// model.js and against rev_a.json's own ladder, the three sizing rules, the layout switch, the
// chart drag, keyboard use, the custom-fibre refusal, phone width in dark mode, and the page with
// its data withheld or tampered (served over a local HTTP server). From the bank root:
//   node ideas/20-twenty-percent-line/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" without it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'model.js'));
const D = require(path.join(here, 'page-data.js'));
const REV = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'rev_a.json'), 'utf8'));
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

const I = M.readInputs(D).inputs;
const base = { tierKey: 'reference', pKm: 0, where: 'tip', fs: I.fs, cap: I.cap, mode: 'none', beta: 0, hmpe: 'sk99' };
const calc = (over) => M.compute(I, { ...base, ...over });
const fx = (r) => `${r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
const ladder = REV.mass_ratio.integrated_tether_to_payload_both_arms;
const fxl = (v) => `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;

let checks = 0;
let failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`FAIL ${msg}`); }
}

// A small static server for the withheld / tampered runs.
const variants = {
  nodata: null,
  no67: (() => { const d = JSON.parse(JSON.stringify(D)); delete d.lines['docs/project_instructions.md']['67']; return d; })(),
  nocap: (() => { const d = JSON.parse(JSON.stringify(D)); delete d.lines['docs/DECISION_LOG.md']['70']; return d; })(),
  sigma: (() => { const d = JSON.parse(JSON.stringify(D)); d.revA.materials.tensile_strength_GPa = 5.7; return d; })(),
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const m = /^\/v\/([a-z0-9]+)\/(.*)$/.exec(req.url.split('?')[0]);
  if (!m) { res.writeHead(404); res.end(); return; }
  const [, v, file] = m;
  if (file === 'page-data.js' && v in variants) {
    if (variants[v] === null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`window.TPL_DATA = ${JSON.stringify(variants[v])};`);
    return;
  }
  const p = path.join(here, path.normalize(file || 'index.html'));
  if (!p.startsWith(here) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await pw.chromium.launch();
const DESK = { viewport: { width: 1280, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' };
async function open(opts, url) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url || pathToFileURL(path.join(here, 'index.html')).href);
  await page.waitForTimeout(200);
  return { context, page, errors };
}
const tile = (page, i) => page.locator('#tiles .tile .v').nth(i).textContent();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const setRange = (page, id, v) => page.evaluate(([i, val]) => { const e = document.getElementById(i); e.value = String(val); e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);

// 1. Desktop, light, file://
{
  const { context, page, errors } = await open(DESK);
  const b0 = calc({});
  ok((await tile(page, 0)) === fx(b0.ratio), `baseline ratio ${await tile(page, 0)} vs ${fx(b0.ratio)}`);
  ok((await tile(page, 0)) === '122.56×', 'baseline ratio is the README\'s 122.56×');
  ok((await tile(page, 1)).trim() === `${b0.tonnes.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`, 'baseline tonnes');
  ok((await tile(page, 2)) === fxl(ladder.conservative_30pct_derate), 'all-PBO tile is rev_a.json conservative rung');
  const sentence = await page.locator('#sentence').textContent();
  for (const m of ['none', 'every', 'between']) ok(sentence.includes(fx(calc({ mode: m }).ratio)), `sentence has ${m}`);
  ok(sentence.includes(`${Math.round(b0.between.aboveKm)} km`), 'sentence has the between-catch length');
  ok((await page.locator('#canon-line').textContent()).includes('34935cb'), 'canon line names the commit');
  ok((await page.locator('#canon-line').textContent()).includes('not canon'), 'canon line flags the density');
  ok((await page.locator('#tiles .flag').count()) >= 1, 'not-canon flag on the HMPE-dependent tiles');
  // modes
  await page.locator('#modes button[data-mode="every"]').click();
  ok((await tile(page, 0)) === fx(calc({ mode: 'every' }).ratio), 'every');
  ok((await tile(page, 0)) === '454.78×', 'every is 454.78×');
  ok((await page.locator('#strip svg').nth(1).locator('path').count()) === 0, 'every: no cap crossings between catches');
  await page.locator('#modes button[data-mode="between"]').click();
  ok((await tile(page, 0)) === '212.11×', 'between is 212.11×');
  ok((await page.locator('#modes button[data-mode="between"]').getAttribute('aria-checked')) === 'true', 'aria-checked follows');
  // keyboard on the radio group
  await page.locator('#modes button[data-mode="between"]').focus();
  await page.keyboard.press('ArrowLeft');
  ok((await tile(page, 0)) === '454.78×', 'ArrowLeft moves to every');
  ok(await page.evaluate(() => document.activeElement.dataset.mode === 'every'), 'focus follows the radio');
  // beta = 100 % under between equals every
  await page.locator('#modes button[data-mode="between"]').click();
  await page.locator('#more summary').click();
  await setRange(page, 'beta', 100);
  ok((await tile(page, 0)) === '454.78×', 'between with a full tip equals every');
  await setRange(page, 'beta', 0);
  // the slider to the end: all PBO, the canon rung
  await page.locator('#p').focus();
  await page.keyboard.press('End');
  ok((await tile(page, 0)) === fxl(ladder.conservative_30pct_derate), 'p = L is the canon 121.83×');
  ok((await page.locator('#p-out').textContent()) === `${I.Lkm} km`, 'p output');
  // hub end, 100 km, between
  await page.locator('#wheres button[data-where="hub"]').click();
  await setRange(page, 'p', 100);
  ok((await tile(page, 0)) === fx(calc({ mode: 'between', where: 'hub', pKm: 100 }).ratio), 'between hub 100');
  ok((await tile(page, 0)) === '170.46×', 'between hub 100 is 170.46×');
  // which-end note
  const note = await page.locator('#where-note').textContent();
  ok(note.includes('cap on every load, every row is lighter with the PBO at the tip end'), 'note: every -> tip end');
  ok(note.includes('cap between catches, every row is lighter with the PBO at the hub end'), 'note: between -> hub end');
  ok((await page.locator('#where-table td.best').count()) === 10, 'ten bold cells');
  // phase 3 tier at all PBO: the canon's 3,085.95
  await page.locator('#tiers button[data-tier="phase3"]').click();
  await setRange(page, 'p', I.Lkm);
  ok((await tile(page, 0)) === fxl(ladder.phase3_3p5kms_30pct_derate), 'phase 3 all PBO is the canon rung');
  await page.locator('#tiers button[data-tier="cislunar"]').click();
  ok((await tile(page, 0)) === fxl(ladder.cislunar_2p8kms_30pct_derate), 'cislunar all PBO is the canon rung');
  await page.locator('#tiers button[data-tier="reference"]').click();
  // derate chips
  await page.locator('#fs-chips .chip').nth(2).click();
  ok((await tile(page, 0)) === fxl(ladder.optimistic_0pct_derate), '0 % derate chip, all PBO = 40.32×');
  await page.locator('#fs-chips .chip').nth(0).click();
  // item 10
  const t10 = await page.locator('#item10-table').textContent();
  for (const v of ['484.06×', '1,104.53×', '3,515.24×', '488.14×']) ok(t10.includes(v), `item 10 table has ${v}`);
  ok((await page.locator('#item10-table .tick').count()) === 3, 'three canon rungs tick');
  const f10 = await page.locator('#item10-findings').textContent();
  ok(f10.includes('18.07 %') && f10.includes('212.21×') && f10.includes('reproduces'), 'item 10 findings');
  ok((await page.locator('#item10-quote').textContent()).includes('~800×'), 'item 10 quote verbatim');
  // chart: drag sets p
  await setRange(page, 'p', 0);
  await page.locator('#wheres button[data-where="tip"]').click();
  ok((await page.locator('#chart polyline').count()) === 3, 'three curves');
  await page.locator('#chart svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const pv = Number(await page.locator('#p').inputValue());
  ok(pv > I.Lkm * 0.5 && pv < I.Lkm, `drag set p to ${pv}`);
  ok(!(await page.locator('#tooltip').isHidden()), 'tooltip shows on hover');
  ok((await tile(page, 0)) === fx(calc({ mode: 'between', pKm: pv }).ratio), 'drag value matches the model');
  // strip: two rows, crossings under the canon rule between catches
  await page.locator('#modes button[data-mode="none"]').click();
  await setRange(page, 'p', 0);
  ok((await page.locator('#strip svg').count()) === 2, 'two strip rows');
  ok((await page.locator('#strip svg').nth(0).locator('polygon').count()) > 200, 'strip drawn');
  ok((await page.locator('#strip svg').nth(1).locator('path').count()) === 2, 'two cap crossings between catches (one per arm)');
  ok((await page.locator('#strip svg').nth(0).locator('path').count()) === 0, 'no crossings with a payload aboard');
  // custom fibre refusal, then values
  await page.locator('#hmpe').selectOption('custom');
  ok(!(await page.locator('#refusal').isHidden()), 'custom without values refuses');
  ok((await page.locator('#refusal').textContent()).includes('invalid_input'), 'refusal code');
  ok((await page.locator('#tiles .tile').count()) === 0, 'no tiles while refused');
  ok(!/\d×/.test(await page.locator('#sentence').textContent()), 'no number in the refused sentence');
  await page.locator('#c-sigma').fill(String(REV.materials.alternative_fibers.Dyneema_SK99_GPa));
  ok(!(await page.locator('#refusal').isHidden()), 'one value is not enough');
  await page.locator('#c-rho').fill(String(I.sk99.rho));
  ok((await tile(page, 0)) === '122.56×', 'custom with the SK99 numbers equals the baseline');
  ok(errors.length === 0, `desktop console errors: ${errors.join(' | ')}`);
  await context.close();
}

// 2. Phone, dark, touch
{
  const { context, page, errors } = await open(PHONE);
  ok(!(await overflow(page)), 'phone: no sideways scroll');
  for (const id of ['item10-table', 'where-table']) {
    const fits = await page.evaluate((i) => { const e = document.getElementById(i).parentElement; return e.scrollWidth <= e.clientWidth + 1; }, id);
    ok(fits, `phone: ${id} fits without its own scroll`);
  }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
  ok(lum < 60, `phone: dark page plane (${bg})`);
  await page.locator('#more summary').tap();
  await page.locator('#hmpe').selectOption('custom');
  ok(!(await overflow(page)), 'phone: no sideways scroll with the custom refusal');
  await page.locator('#hmpe').selectOption('sk99');
  await page.locator('#tiers button[data-tier="phase3"]').tap();
  ok(!(await overflow(page)), 'phone: no sideways scroll at phase 3');
  await page.locator('#tiers button[data-tier="reference"]').tap();
  await page.locator('#chart svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart svg').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.waitForTimeout(80);
  const pv = Number(await page.locator('#p').inputValue());
  ok(pv > 0, `phone: a tap on the chart sets p (${pv})`);
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  ok(!(await overflow(page)), 'phone: no sideways scroll with every section open');
  ok(errors.length === 0, `phone console errors: ${errors.join(' | ')}`);
  await context.close();
}

// 3. Data withheld or tampered, over HTTP
{
  const { context, page, errors } = await open(DESK, `http://127.0.0.1:${port}/v/nodata/index.html`);
  ok((await page.locator('#notice').textContent()).includes('No canon file, no numbers'), 'withheld: notice');
  ok(await page.locator('#p').isDisabled(), 'withheld: controls disabled');
  ok(await page.locator('#modes button').first().isDisabled(), 'withheld: buttons disabled');
  ok(!/\d/.test(await page.locator('#tiles').textContent()), 'withheld: no digits in tiles');
  ok(!/\d×/.test(await page.locator('main').textContent()), 'withheld: no ratio anywhere on the page');
  ok(await page.locator('#strip-card').isHidden(), 'withheld: no strip');
  ok(await page.locator('#chart-card').isHidden(), 'withheld: no chart');
  ok(errors.filter((e) => !/404|Failed to load/.test(e)).length === 0, `withheld: only the 404 (${errors.join(' | ')})`);
  await context.close();
}
{
  const { context, page, errors } = await open(DESK, `http://127.0.0.1:${port}/v/no67/index.html`);
  ok((await page.locator('#refusal').textContent()).includes('insufficient_data'), 'no SK99 density: refusal');
  ok((await page.locator('#hmpe-hint').textContent()).startsWith('Refused'), 'no SK99 density: fibre hint refuses');
  ok((await page.locator('#item10-table').textContent()).includes('refused'), 'no SK99 density: item 10 SK99 column refused');
  ok((await page.locator('#item10-table').textContent()).includes('484.06×'), 'no SK99 density: PBO column still computes');
  await page.locator('#more summary').click();
  await page.locator('#hmpe').selectOption('custom');
  await page.locator('#c-sigma').fill('3.6');
  await page.locator('#c-rho').fill('970');
  ok((await tile(page, 0)) === '122.56×', 'no SK99 density: typed values compute');
  ok(errors.length === 0, `no67 console errors: ${errors.join(' | ')}`);
  await context.close();
}
{
  const { context, page, errors } = await open(DESK, `http://127.0.0.1:${port}/v/nocap/index.html`);
  ok((await page.locator('#notice').textContent()).includes('DECISION_LOG.md:70'), 'no cap: notice names the line');
  ok((await page.locator('#cap-out').textContent()) === 'not set', 'no cap: slider says not set');
  ok((await tile(page, 0)) === '122.56×', 'no cap: canon rule still computes');
  ok((await page.locator('#tiles').textContent()).includes('no cap set'), 'no cap: no above-cap figure');
  await page.locator('#modes button[data-mode="every"]').click();
  ok((await page.locator('#refusal').textContent()).includes('insufficient_data'), 'no cap: capped rule refuses');
  await setRange(page, 'cap', 20);
  ok((await tile(page, 0)) === '454.78×', 'no cap: a cap the user sets computes');
  ok(errors.length === 0, `nocap console errors: ${errors.join(' | ')}`);
  await context.close();
}
{
  const { context, page } = await open(DESK, `http://127.0.0.1:${port}/v/sigma/index.html`);
  const t = await page.locator('#item10-table').textContent();
  ok((await page.locator('#item10-table .cross').count()) === 3 && !t.includes('✓'), 'tampered σ: all three canon rungs cross');
  await context.close();
}

await browser.close();
server.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
