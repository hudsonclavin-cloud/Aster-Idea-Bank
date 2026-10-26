#!/usr/bin/env node
// Drives Hole Stack in headless Chromium: phone width by touch in dark mode, desktop width by mouse and
// keyboard in light mode, plus the other scheme at each width. Asserts the numbers on the page, the
// refusal states, the live parseFlight/flightLint line, the download, no console errors and no
// horizontal overflow. Run from the bank root: node ideas/11-hole-stack/ui-check.mjs [--shots]
// (--shots writes full-page screenshots to the OS temp folder and prints their paths).
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" without it.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = createRequire(import.meta.url)('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('ui-check: skipped (Playwright is not installed)'); process.exit(0); }
}
const outDir = process.argv.includes('--shots') ? path.join(os.tmpdir(), 'hole-stack-ui') : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };

async function open(opts, scheme, query = '') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
  await page.goto(URL0 + query);
  await page.waitForTimeout(120);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const txt = (page, sel) => page.locator(sel).innerText();
async function shot(page, name) { if (outDir) { const f = path.join(outDir, name + '.png'); await page.screenshot({ path: f, fullPage: true }); console.log(`shot: ${f}`); } }
async function tapLabel(page, name, value) { await page.locator(`input[name="${name}"][value="${value}"] + span`).tap(); await page.waitForTimeout(80); }

// 1. Phone, dark, touch
{
  const { context, page, errors } = await open(PHONE, 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(20, 22, 27)', `dark scheme applied (body ${bg})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px on load');
  ok((await txt(page, '#vword')) === 'M6×1', 'opens on M6×1');
  const vs = await txt(page, '#vsub');
  ok(/2 features · 1 cited row · 1 default row · 0 gauges · 0 refused/.test(vs), `verdict counts (${vs})`);
  const svg = await page.locator('#figure svg').innerHTML();
  for (const t of ['Ø6.710 ±0.11', 'clearance H13 6.600–6.820', 'Ø10.750 ±0.13', 'counterbore 6.5 deep']) ok(svg.includes(t), `drawing shows ${t}`);
  const st = await txt(page, '#stack');
  for (const t of ['Ø6.710 ±0.11 (6.600–6.820)', 'clearance_medium_mm = 6.6', 'IT13 = 220 µm', '6.600–6.820 (agrees)', 'Shown, not used: cbore_d_mm = 11', 'recall', 'cbore_depth_flush_mm = 6.5', 'unlabelled', 'Minimum 10.620 = knurled dk 10.22 + 0.4']) ok(st.includes(t), `stack shows ${t}`);
  const fl = await txt(page, '#flight');
  ok(fl.includes('"d_mm":6.71,"tol_mm":0.11') && fl.includes('"tol_src":"source","tol_ref":"ISO 273:1979 medium M6 6.6, H13; ISO 286 IT13 6-10 mm = 220 um (fits.json)"'), 'FLIGHT clearance row, cited');
  ok(fl.includes('"name":"M6 SHCS counterbore (min 10.62)","d_mm":10.75,"tol_mm":0.13') && /counterbore[^\n]*"tol_src":"default"\}/.test(fl), 'FLIGHT counterbore row, default, no tol_ref');
  ok(!/cbore_d_mm|"11"|:11[,}]/.test(fl), 'the recall tool size is not in the FLIGHT rows');
  const ver = await txt(page, '#verify');
  ok(/clamped plate: 1 hole, 1 bore, 0 gauges; dropped 0, demoted 0; cited 1, default 1/.test(ver) && /flightLint clean/.test(ver), `live parseFlight/flightLint line (${ver})`);
  ok(/\$fn = fn_tol\(m6_clear_d\)/.test(await txt(page, '#scad')), 'OpenSCAD carries fn_tol');
  await shot(page, 'phone-dark-default');

  // nut pocket
  await tapLabel(page, 'far', 'nut');
  ok(/hex 10\.130 AF, 11\.697 AC/.test(await page.locator('#figure svg').innerHTML()), 'nut pocket drawn and labelled');
  let ck = await txt(page, '#checks');
  ok(/nut_ac_min_mm across corners/.test(ck) && /9\.570 mm across flats/.test(ck), 'the doctrine nut-pocket note');
  ok(/rounded corners span 11\.450 mm/.test(ck), 'milled-corner note with the cnc_mill radius');
  ok(/1 gauge/.test(await txt(page, '#vsub')), 'the nut GO gauge is counted');
  ok(/"module":"gauge_m6_nut_go","expect":"clear"/.test(await txt(page, '#flight')), 'gauge row');
  await shot(page, 'phone-dark-nut');

  // washer
  await page.locator('#washer').tap(); await page.waitForTimeout(80);
  let s2 = await txt(page, '#stack');
  ok(/Ø12\.130 ±0\.13\s+\(12\.000–12\.260\), 8\.1 deep/.test(s2), 'washer widens the counterbore to the washer OD and deepens it to 8.1');
  ok(/cannot enter/.test(await txt(page, '#checks')), 'washer-vs-tool note');
  await page.locator('#washer').tap(); await page.waitForTimeout(80);

  // coarse: refused band
  await tapLabel(page, 'far', 'through');
  await tapLabel(page, 'series', 'coarse');
  ok(!(await page.locator('#refusals').isHidden()), 'refusal card shown for coarse');
  ok(/IT14 is not in the table/.test(await txt(page, '#refList')), 'coarse refusal names IT14');
  ok(!/"holes"/.test(await txt(page, '#flight')), 'no clearance row without a band');
  ok(/band refused/.test(await page.locator('#figure svg').innerHTML()), 'drawing marks the refused band');
  await tapLabel(page, 'series', 'medium');

  // countersunk at M2: refused by name
  await page.selectOption('#size', 'M2'); await page.waitForTimeout(80);
  await tapLabel(page, 'head', 'countersunk');
  ok(/csk_head_d_mm is null for M2/.test(await txt(page, '#refList')), 'M2 countersink refused naming the null field');
  await page.selectOption('#size', 'M3'); await page.waitForTimeout(80);
  ok(/Ø6\.72 × 90°/.test(await page.locator('#figure svg').innerHTML()), 'M3 countersink 6.72 at 90 deg');
  ok(await page.locator('#refusals').isHidden(), 'no refusals at M3');

  // tapped part
  await page.selectOption('#size', 'M6'); await tapLabel(page, 'head', 'socket');
  await tapLabel(page, 'far', 'tapped');
  ok(!(await page.locator('#tapped-opts').isHidden()), 'tapped options appear');
  const st3 = await txt(page, '#stack');
  ok(/minor_D1_mm = 4\.917/.test(st3) && /tap_drill_mm = 5/.test(st3), 'D1 and drill');
  ok(/at the table's 9\.5 mm: FAIL/.test(st3) && /strip needs 11\.020 mm, the 2·d rule 12 mm/.test(st3), 'PartForge threadCheck fails the table engagement');
  ok(/tapped mating part/.test(await txt(page, '#flight')) && /tapped part: 1 hole/.test(await txt(page, '#verify')), 'tapped part rows parsed');
  await page.fill('#part_t', '10'); await page.waitForTimeout(150);
  ok(/this hole: short/.test(await txt(page, '#stack')), '10 mm is short of the table engagement + pitches');
  await shot(page, 'phone-dark-tapped');
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px after interaction');
  await page.locator('#copyFlight').tap(); await page.waitForTimeout(100);
  ok(errors.length === 0, `no console errors on phone (${errors.join(' | ')})`);
  await context.close();
}

// 2. Phone, light, an unknown size from the URL
{
  const { context, page, errors } = await open(PHONE, 'light', '?size=M7');
  ok((await txt(page, '#vword')) === 'Refused', 'M7 refused');
  ok(/M7 is not a row of fasteners_metric\.json/.test(await txt(page, '#refList')) && /M2, M2\.5, M3, M4, M5, M6, M8, M10, M12, M14, M16, M20/.test(await txt(page, '#refList')), 'refusal lists the 12 rows');
  ok(/No section to draw/.test(await txt(page, '#figure')), 'no drawing for a refused size');
  ok(!(await overflow(page)), 'no overflow on the refusal page');
  await shot(page, 'phone-light-M7');
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  await context.close();
}

// 3. Desktop, light, mouse and keyboard
{
  const { context, page, errors } = await open(DESK, 'light', '?size=M10&far=nyloc&plate=30');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(242, 241, 237)', `light scheme (${bg})`);
  ok((await txt(page, '#vword')) === 'M10×1.5', 'URL preloads M10');
  ok(/DIN 985 M10 is 17 AF/.test(await txt(page, '#checks')) && /din934_nut_af_mm is 17 mm/.test(await txt(page, '#checks')), 'DIN nut notes at M10');
  await shot(page, 'desktop-light-M10-nyloc');
  // keyboard: focus the head group and arrow to countersunk
  await page.locator('input[name="head"][value="socket"]').focus();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
  ok(await page.locator('input[name="head"][value="countersunk"]').isChecked(), 'arrow key moves the head choice');
  ok(/Countersink 90°/.test(await txt(page, '#stack')), 'countersink built from the keyboard');
  await page.selectOption('#size', 'M3'); await page.waitForTimeout(80);
  await page.locator('input[name="far"][value="through"] + span').click(); await page.waitForTimeout(80);
  const dl = page.waitForEvent('download');
  await page.locator('#dlScad').click();
  const d = await dl;
  ok(d.suggestedFilename() === 'hole_stack_m3.scad', `download name ${d.suggestedFilename()}`);
  const p = await d.path();
  ok(p && fs.readFileSync(p, 'utf8') === (await page.locator('#scad').textContent()), 'downloaded .scad equals the shown text');
  ok(!(await overflow(page)), 'no overflow at 1280');
  ok(errors.length === 0, `no console errors on desktop (${errors.join(' | ')})`);
  await context.close();
}

// 4. Desktop, dark
{
  const { context, page, errors } = await open(DESK, 'dark', '?far=nut&plate=16&washer=1');
  ok(!(await overflow(page)), 'no overflow at 1280 dark');
  ok(/8\.1 deep/.test(await txt(page, '#stack')), 'washer from the URL');
  await shot(page, 'desktop-dark-nut-washer');
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
