#!/usr/bin/env node
// Drives Torque Receipt in headless Chromium: phone width by touch in dark mode, desktop width by
// mouse and keyboard in light mode. Asserts the numbers on the page against the kernel run in Node
// on the same snapshots, the refusal states, the presets, no console errors and no horizontal
// overflow. Run from the bank root: node ideas/27-torque-receipt/ui-check.mjs [--shots]
// (--shots writes full-page screenshots to the OS temp folder and prints their paths).
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" without it.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('ui-check: skipped (Playwright is not installed)'); process.exit(0); }
}
const TR = require('./torque.js');
const ctx = TR.makeContext(require('./node-data.cjs')(here));
const endcap = TR.receipt(ctx, TR.endcapInput(ctx));
const today = TR.endcapToday(ctx);

const outDir = process.argv.includes('--shots') ? path.join(os.tmpdir(), 'torque-receipt-ui') : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };

async function open(opts, scheme, query = '') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
  await page.goto(URL0 + query);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const txt = (page, sel) => page.locator(sel).innerText();
async function shot(page, name) { if (outDir) { const f = path.join(outDir, name + '.png'); await page.screenshot({ path: f, fullPage: true }); console.log(`shot: ${f}`); } }

// 1. Phone, dark, touch: the end cap as written.
{
  const { context, page, errors } = await open(PHONE, 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(13, 13, 13)', `dark scheme applied (body ${bg})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px on load');
  ok((await page.locator('button[data-preset="endcap"]').getAttribute('aria-pressed')) === 'true', 'opens on the end cap preset');
  const hd = await txt(page, '#headline');
  ok(hd.includes('past yield before any load is applied') && hd.includes('711.5 MPa') && hd.includes('proof SF 0.82'), `headline (${hd})`);
  const rc = await txt(page, '#receipt');
  const want = [
    TR.fmtN(endcap.sections.preload.F_nom_N), '98.1 % of proof', TR.fmtN(endcap.sections.preload.F_min_N), TR.fmtN(endcap.sections.preload.F_max_N),
    'σ = 711.5 MPa', 'SF 0.82 on proof', '0.90 on yield', '1.12 on UTS', 'σ = 877.6 MPa', 'K 0.15 (mid of 0.14–0.16)', '±25 %',
    '16.6 N·m – 19.1 N·m', '17.8 N·m at 0.70', 'at most 20.4 N·m', 'proof load 21,228 N', 'proof_load_8_8_N: 21,200 N',
    'strip 31,165 N vs bolt 29,287 N', '= 0.97', 'endcap.scad:49 bolt_shear force_N 48641', 'preload_uncertainty_lubricated',
    'do not rely on torque alone for a pressure boundary',
  ];
  for (const w of want) ok(rc.includes(w), `receipt shows ${w}`);
  ok(!/\bPASS\b/.test(rc.replace(/never PASS/g, '')), 'the receipt never says PASS');
  const stampsOver = await page.locator('#receipt .stamp.over').count();
  ok(stampsOver === 2, `two OVER stamps (assembly, service): ${stampsOver}`);
  const sw = await txt(page, '#sweep');
  ok(/plain, dry, as received[\s\S]*73\.6 %[\s\S]*within proof/.test(sw), 'sweep: the same torque dry sits at 73.6 % of proof, within proof');
  ok(/anti-seize[\s\S]*past UTS/.test(sw), 'sweep: anti-seize goes past UTS');
  const td = await txt(page, '#today');
  ok(td.includes('shear SF ' + today.r.sf_shear.toFixed(2)) && td.includes('passes') && td.includes('index.html:4733'), `today card (${td.slice(0, 120)})`);
  const svg = await page.locator('#chart svg').getAttribute('aria-label');
  ok(/^Preload scatter 15\.6 kN to 26\.0 kN against proof 21\.2 kN, yield 23\.4 kN, UTS 29\.3 kN; with the external load 32\.1 kN$/.test(svg), `chart label (${svg})`);
  ok((await page.locator('#chart .scatter').count()) === 1 && (await page.locator('#chart .svc').count()) === 1, 'chart draws the scatter bar and the service point');
  // Tap a mark: its tooltip appears.
  await page.locator('#chart .hit').first().tap();
  await page.waitForTimeout(60);
  await shot(page, 'phone-dark-endcap');
  // "Tightened by feel" by touch.
  await page.locator('button[data-preset="by-feel"]').tap();
  await page.waitForTimeout(100);
  const hd2 = await txt(page, '#headline');
  ok((await page.locator('#headline.refused').count()) === 1 && /Tightened by feel/.test(hd2), `by-feel headline (${hd2})`);
  const rc2 = await txt(page, '#receipt');
  ok(rc2.includes('no defensible preload at all') && rc2.includes('insufficient_data') && rc2.includes('What would help'), 'by-feel refusal names the code, the row note and what would help');
  ok(rc2.includes('16.6 N·m – 19.1 N·m'), 'by-feel still shows the torque window');
  ok(!rc2.includes('σ = 711.5'), 'by-feel shows no stress number');
  ok(await page.locator('#torque').isDisabled(), 'torque input disabled while tightened by feel');
  ok((await page.locator('#chart .scatter').count()) === 0, 'no scatter bar drawn without a torque');
  ok(await page.locator('#sweep').isHidden(), 'no sweep without a torque');
  // Untick by feel, type a torque by touch: the receipt comes back.
  await page.locator('#byFeel').tap();
  await page.locator('#torque').fill('17.8');
  await page.waitForTimeout(80);
  const hd3 = await txt(page, '#headline');
  ok(/within proof|check/i.test(hd3) || /No line exceeds proof/.test(hd3) || /upper bound/.test(hd3), `torque 17.8 headline (${hd3})`);
  const rc3 = await txt(page, '#receipt');
  ok(rc3.includes('70.0 % of proof') || rc3.includes('69.9 % of proof') || rc3.includes('70.1 % of proof'), '17.8 N·m lands at about 70 % of proof');
  ok(!(await overflow(page)), 'no overflow after edits');
  await shot(page, 'phone-dark-edited');
  ok(errors.length === 0, `no console errors (phone): ${errors.join(' | ')}`);
  await context.close();
}

// 2. Desktop, light, keyboard: M6 through-bolt, protrusion, refusals, an inch size.
{
  const { context, page, errors } = await open(DESK, 'light', '?preset=m6-through');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(249, 249, 247)', `light scheme applied (body ${bg})`);
  ok((await page.locator('button[data-preset="m6-through"]').getAttribute('aria-pressed')) === 'true', '?preset=m6-through preloads');
  let rc = await txt(page, '#receipt');
  ok(rc.includes('3.20 mm vs 2p = 2.00 mm') && rc.includes('shortest screw 18.80 mm'), 'M6 protrusion 3.20 vs 2.00');
  ok(/No line exceeds proof/.test(await txt(page, '#headline')), 'M6 headline: nothing exceeds proof');
  ok(await page.locator('#today').isHidden(), 'the end-cap comparison is only on the end-cap presets');
  // Shorten the screw with the keyboard.
  await page.locator('#len').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('16');
  await page.waitForTimeout(80);
  rc = await txt(page, '#receipt');
  ok(rc.includes('-0.80 mm vs 2p') && rc.includes('the screw ends inside the nut'), '16 mm screw ends inside the nut');
  ok((await page.locator('button[data-preset="m6-through"]').getAttribute('aria-pressed')) === 'false', 'editing clears the preset mark');
  // Nylon-insert nut is a recall field.
  await page.locator('#len').fill('22');
  await page.selectOption('#nut', 'nyloc');
  await page.waitForTimeout(60);
  rc = await txt(page, '#receipt');
  ok(rc.includes('uses a recall field'), 'nyloc protrusion is flagged as a recall input');
  // Unknown grade route: declared without a source refuses.
  await page.selectOption('#grade', 'declared');
  await page.locator('#dProof').fill('600'); await page.locator('#dYield').fill('660'); await page.locator('#dUts').fill('830');
  await page.waitForTimeout(60);
  ok((await page.locator('#headline.refused').count()) === 1 && (await txt(page, '#receipt')).includes('source missing'), 'declared grade without a source is refused');
  await page.locator('#dSource').fill('vendor cert 42');
  await page.waitForTimeout(60);
  ok((await page.locator('#headline.refused').count()) === 0 && (await txt(page, '#receipt')).includes('declared by the user: vendor cert 42'), 'with a source it computes');
  // Inch: #8-32 with J429-5 refuses with the table's own sentence.
  await page.selectOption('#size', '#8-32');
  await page.selectOption('#grade', 'J429-5');
  await page.waitForTimeout(60);
  const hd = await txt(page, '#headline');
  ok(hd.includes('NOT graded to J429'), `#8-32 grade 5 refused (${hd})`);
  // 1/4-20 preset: lbf·in readout and recall nut.
  await page.locator('button[data-preset="quarter-20"]').click();
  await page.waitForTimeout(80);
  rc = await txt(page, '#receipt');
  ok(rc.includes('lbf·in') && rc.includes('SAE J429 grade 5') && rc.includes('uses a recall field'), '1/4-20 grade 5 receipt');
  ok((await txt(page, '#headline')).includes('upper bound'), '1/4-20 headline names the upper bound');
  // Keyboard reaches the preset buttons and the chart marks.
  await page.locator('button[data-preset="endcap"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  ok((await txt(page, '#headline')).includes('711.5 MPa'), 'Enter on a preset button applies it');
  await page.locator('#chart .hit').first().focus();
  await page.waitForTimeout(40);
  ok(await page.locator('#tip').isVisible(), 'focusing a chart mark shows its tooltip');
  ok((await txt(page, '#tip')).includes('Preload scatter 15,625 N – 26,042 N'), 'tooltip text');
  ok(!(await overflow(page)), 'no overflow at 1280 px');
  await shot(page, 'desk-light-endcap');
  ok(errors.length === 0, `no console errors (desktop): ${errors.join(' | ')}`);
  await context.close();
}

// 3. The other schemes at each width, every preset: no overflow, no errors.
for (const [opts, scheme, name] of [[PHONE, 'light', 'phone-light'], [DESK, 'dark', 'desk-dark']]) {
  const { context, page, errors } = await open(opts, scheme);
  for (const p of ['endcap', 'endcap-dry', 'm6-through', 'by-feel', 'quarter-20']) {
    await page.locator(`button[data-preset="${p}"]`).click();
    await page.waitForTimeout(60);
    ok(!(await overflow(page)), `${name} ${p}: no horizontal overflow`);
  }
  await page.locator('input[name="joint"][value="tapped"] + span').click();
  await page.waitForTimeout(60);
  ok(!(await overflow(page)), `${name}: tapped fields, no overflow`);
  await shot(page, name);
  ok(errors.length === 0, `no console errors (${name}): ${errors.join(' | ')}`);
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
