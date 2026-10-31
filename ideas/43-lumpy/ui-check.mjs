#!/usr/bin/env node
// Drives the Lumpy page in headless Chromium as a person would (desktop by mouse and keys, phone by touch, light and dark)
// and compares its numbers with the kernel's. Run from the bank root: node ideas/43-lumpy/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, sample42 } = require(path.join(here, 'load.cjs'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SAMPLE = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H42 = JSON.stringify(sample42()), H41 = fs.readFileSync(path.join(here, '..', '41-signal', 'handoff.json'), 'utf8');

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#checkTable tbody tr').length > 5, null, { timeout: 60000 });
  return { context, page, errors };
}
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '' }])));
const refusals = (page) => page.$$eval('#refusals .refusal b', (bs) => bs.map((b) => b.textContent));
const drawn = (page, id) => page.$eval('#' + id, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
const pixels = (page, id) => page.$eval('#' + id, (c) => c.toDataURL());

// ---------------------------------------------------------------- the kernel's own answers, for comparison
const src42 = K.importClosing(sample42()), RA = K.run(src42, K.defaults()), RB = K.run(K.bennuCase(), K.defaults());

{
  const { context, page, errors } = await open(DESK);
  let t = await tiles(page);
  ok(Math.abs(num(t['GM'].v) - 2.68) < 1e-9 && t['GM'].c === 'assumed', 'GM tile: ' + t['GM'].v + ' ' + t['GM'].c);
  ok(Math.abs(num(t['Bulk density'].v) - RA.B.rho) < 0.6, 'density tile ' + t['Bulk density'].v);
  ok(Math.abs(num(t['Size'].v) - 2 * RA.B.Req) < 0.06 && t['Size'].c === 'measured', 'size tile ' + t['Size'].v);
  ok(Math.abs(num(t['Mean slope'].v) - RA.surface.stats.slope.mean) < 0.06 && t['Mean slope'].c === 'derived', 'mean slope ' + t['Mean slope'].v);
  ok(Math.abs(num(t['Point mass wrong by'].v) - 100 * K.pmErrors(RA)[0].relative_error) < 0.006, 'point mass tile');
  ok(t['Equilibria'].v === 'none' && t['Equilibria'].c === 'refused', 'Apophis equilibria refused');
  const site = await page.textContent('#siteBox');
  ok(site.includes('plate ' + RA.site.face) && site.includes('under the stand-off'), 'site box: ' + site.slice(0, 60));
  ok(site.includes((RA.site.escape_up_m_s * 100).toPrecision(4)), 'site escape speed');
  let rf = await refusals(page);
  ok(rf.length === 4 && ['density', 'inertia', 'equilibria', 'resolution'].every((a) => rf.some((x) => x.includes(a))), 'own refusals: ' + rf.join(' | '));
  ok((await page.textContent('#carriedSum')).includes('(10)'), 'ten carried refusals');
  const rows = await page.$$eval('#checkTable tbody tr', (trs) => trs.map((tr) => tr.textContent));
  ok(rows.length === 11 && !rows.some((r) => /NaN|undefined/.test(r)), 'eleven check rows, no NaN');
  ok(rows.some((r) => r.includes('Apophis inertia ratios') && r.includes('+19.7%')), 'inertia row');
  ok(rows.some((r) => r.includes('Orbital B') && r.includes('×11.3')), 'Orbital B row');
  ok(rows.some((r) => r.includes('RA 118.7906')), 'spin momentum row');
  for (const id of ['shapeView', 'histChart', 'profChart', 'eqChart', 'trackChart']) ok(await drawn(page, id) > 1000, id + ' drawn');

  // the shape turns by keys and by dragging; a tap picks a plate
  const before = await pixels(page, 'shapeView');
  await page.focus('#shapeView'); await page.keyboard.press('ArrowLeft');
  ok((await pixels(page, 'shapeView')) !== before, 'arrow key turns the shape');
  const box = await page.$eval('#shapeView', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const b2 = await pixels(page, 'shapeView');
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2); await page.mouse.down(); await page.mouse.move(box.x + box.w / 2 + 80, box.y + box.h / 2 + 20, { steps: 5 }); await page.mouse.up();
  ok((await pixels(page, 'shapeView')) !== b2, 'dragging turns the shape');
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2); await page.waitForTimeout(400);
  const site2 = await page.textContent('#siteBox');
  ok(site2.includes('(chosen)') && !site2.includes('plate ' + RA.site.face + ','), 'a tap picks another plate: ' + site2.slice(0, 50));
  const chosen = await page.evaluate(() => LumpyPage.state.S.site);
  const RC = K.run(src42, Object.assign(K.defaults(), { site: chosen }));
  ok(site2.includes(RC.site.slope_deg.toPrecision(3)), 'the chosen plate\'s slope is the kernel\'s');
  await page.click('#siteReset'); await page.waitForTimeout(300);
  ok((await page.textContent('#siteBox')).includes('under the stand-off'), 'site reset');
  // the colour quantity
  await page.selectOption('#qtySel', 'vUp'); ok((await page.textContent('#cbMax')).includes('cm/s'), 'colour by escape speed');

  // mass from a density, and an invalid one
  await page.click('[data-gm="density"]'); await page.waitForTimeout(200);
  ok(await page.isVisible('#densIn'), 'density input shown');
  await page.fill('#densIn', '1000'); await page.press('#densIn', 'Tab'); await page.waitForTimeout(800);
  t = await tiles(page);
  ok(Math.abs(num(t['GM'].v) - K.G_NEWTON * 1000 * RA.P.volume) < 0.002, 'GM from 1000 kg/m^3: ' + t['GM'].v);
  await page.fill('#densIn', '100'); await page.press('#densIn', 'Tab'); await page.waitForTimeout(800);
  rf = await refusals(page);
  ok(rf.length === 1 && /invalid input/.test(rf[0]) && (await page.$$('.tile')).length === 0, 'density 100 refused with no tiles');
  await page.click('[data-gm="handoff"]'); await page.waitForTimeout(800);

  // the orbit scan, small: 2 radii x 1 inclination, a quarter day
  await page.fill('#daysIn', '0.25'); await page.press('#daysIn', 'Tab'); await page.fill('#radIn', '2'); await page.press('#radIn', 'Tab');
  for (const inc of ['90', '180']) await page.uncheck('[data-inc="' + inc + '"]');
  await page.click('#scanBtn');
  await page.waitForFunction(() => document.querySelectorAll('#scanGrid button').length === 2, null, { timeout: 60000 });
  const cells = await page.$$eval('#scanGrid button', (bs) => bs.map((b) => b.textContent));
  const sc = K.orbitScan(RA.B, Object.assign(K.defaults(), { scanDays: 0.25, scanRadii: 2, scanIncl: [0] }));
  ok(cells.every((c, i) => c.startsWith(sc.rows[i].outcome === 'survive' ? 'lasts' : sc.rows[i].outcome)), 'scan outcomes are the kernel\'s: ' + cells.join(', '));
  await page.click('#scanGrid button >> nth=1'); ok((await page.textContent('#trackCap')).includes('inclination 0°'), 'a tapped orbit is drawn');
  ok(await drawn(page, 'trackChart') > 1000, 'track drawn');

  // export with the scan, read back by the kernel
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const back = K.parseHandoff(exported);
  ok(!back.refusal && exported.outputs.orbits.value.rows.length === 2, 'the download parses in the kernel: ' + JSON.stringify(back.refusal || ''));

  // Bennu
  await page.click('[data-case="bennu"]'); await page.waitForTimeout(1500);
  t = await tiles(page);
  ok(num(t['Equilibria'].v) === 8, 'Bennu: 8 equilibria');
  ok(Math.abs(num(t['Orbital B: 2-h legs miss by'].v) - RB.orbitB.poly.legDv_median_m_s * 1000) < 0.0006 && t['Orbital B: 2-h legs miss by'].c === 'measured', 'Orbital B tile ' + t['Orbital B: 2-h legs miss by'].v);
  ok(await drawn(page, 'obChart') > 1000 && await drawn(page, 'eqChart') > 1000, 'Bennu charts drawn');
  rf = await refusals(page); ok(rf.length === 2, 'Bennu: density and resolution only: ' + rf.join(' | '));
  await page.click('[data-gm="measured_sc"]'); await page.waitForTimeout(1500);
  ok((await page.textContent('#obCap')).includes('4.894557'), 'spacecraft-field GM');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const eb = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  ok(!K.parseHandoff(eb).refusal && eb.inputs.case === 'bennu2019', 'Bennu download parses');

  // imports
  const imp = async (text) => { await page.fill('#importText', text); await page.click('#importBtn'); await page.waitForTimeout(1200); return page.textContent('#hoStatus'); };
  ok(/Imported idea 42/.test(await imp(H42)), 'imports idea 42\'s handoff');
  ok(/Imported this page/.test(await imp(SAMPLE)), 'imports this page\'s sample');
  ok(/Refused/.test(await imp('{not json')), 'garbage refused');
  ok(/idea 42/.test(await imp(H41)), 'idea 41\'s handoff points to idea 42');
  const ed = JSON.parse(SAMPLE); ed.outputs.site.value.slope_deg += 2;
  ok(/Refused/.test(await imp(JSON.stringify(ed))), 'an edited handoff is refused');
  ok(errors.length === 0, 'desktop console errors: ' + errors.join(' | '));
  await context.close();
}

// #h= links: idea 42's handoff and this page's
for (const [label, text, want] of [['42', H42, 'Imported idea 42'], ['43', SAMPLE, 'Imported this page']]) {
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(text));
  ok((await page.textContent('#hoStatus')).includes(want), '#h= with ' + label + '\'s handoff opens');
  ok(errors.length === 0, '#h= ' + label + ' errors: ' + errors.join(' | '));
  await context.close();
}

// phone, dark and light: no overflow, no tiny text, charts drawn, a tap picks a plate
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), scheme + ': no horizontal overflow');
  const tiny = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && e.textContent.trim() && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.tagName + ':' + e.textContent.slice(0, 20)));
  ok(tiny.length === 0, scheme + ': text under 11 px: ' + tiny.join(', '));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  for (const id of ['shapeView', 'histChart', 'profChart']) ok(await drawn(page, id) > 1000, scheme + ' ' + id + ' drawn');
  const box = await page.$eval('#shapeView', (c) => { c.scrollIntoView(); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(box.x, box.y); await page.waitForTimeout(500);
  ok((await page.textContent('#siteBox')).includes('(chosen)'), scheme + ': a tap picks a plate');
  ok(!(await page.textContent('body')).includes('NaN'), scheme + ': no NaN');
  ok(errors.length === 0, scheme + ' phone errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(failures ? `ui-check: ${failures} of ${checks} checks failed` : `ui-check: all ${checks} checks pass`);
process.exit(failures ? 1 : 0);
