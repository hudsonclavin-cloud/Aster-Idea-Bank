#!/usr/bin/env node
// Drives the Split page in headless Chromium as a person would (desktop by mouse, phone by touch, light and dark) and
// compares its numbers with the kernel's. Run from the bank root: node ideas/46-split/ui-check.mjs (about 30 s)
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, sample45, bennu45 } = require(path.join(here, 'load.cjs'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/[^0-9.eE+-]/g, ' ').trim().split(/\s+/)[0]);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SAMPLE = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H45 = JSON.stringify(sample45()), HB = JSON.stringify(bennu45());
const H44 = fs.readFileSync(path.join(here, '..', '44-touch-and-go', 'handoff.json'), 'utf8');

const seq = (page) => page.evaluate(() => window.SplitPage.state.seq);
async function waitRun(page, before) { await page.waitForFunction((b) => window.SplitPage.state.seq > b, before, { timeout: 60000 }); }
async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.SplitPage && window.SplitPage.state.seq > 0, null, { timeout: 60000 });
  return { context, page, errors };
}
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '', s: (t.querySelector('.sub') || {}).textContent || '', cls: t.className }])));
const refusals = (page) => page.$$eval('#refusals .refusal b', (bs) => bs.map((b) => b.textContent));
const drawn = (page, id) => page.$eval('#' + id, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
async function click(page, sel) { const b = await seq(page); await page.click(sel); await waitRun(page, b); }
async function setNum(page, id, v) { const b = await seq(page); await page.fill('#' + id, String(v)); await page.press('#' + id, 'Tab'); await waitRun(page, b); }
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const srcC = K.parseHandoff(sample45()).src, srcB = K.parseHandoff(bennu45()).src;
const RC = K.run(srcC, {}), RG = K.run(srcC, { route: 'gas' }), RS = K.run(srcC, { route: 'steam' });

// ---------------------------------------------------------------------------------------------------- the chain, desktop
{
  const { context, page, errors } = await open(DESK);
  let T = await tiles(page);
  ok(close(num(T['Return propellant'].v), RC.prop.mass_kg, 0.0006), 'propellant tile ' + T['Return propellant'].v + ' vs ' + RC.prop.mass_kg);
  ok(/assumed/.test(T['Return propellant'].c) && /at most/.test(T['Return propellant'].c), 'the chain\'s propellant is an upper bound, labelled assumed');
  ok(close(num(T['Specific impulse, vacuum'].v), RC.prop.isp_s, 0.06), 'Isp tile ' + T['Specific impulse, vacuum'].v);
  ok(close(num(T['Mixture ratio burned'].v), K.R_ST, 0.006), 'burns the water\'s own O/F on the chain');
  ok(close(num(T['Δv on the way home'].v), RC.dv, 0.06), 'delta-v tile ' + T['Δv on the way home'].v + ' vs ' + RC.dv);
  ok(close(num(T['Boil-off over the stay'].v), RC.L.boil.h2 + RC.L.boil.o2, 0.006), 'boil-off tile');
  ok(num(T['20 K coolers'].v) === RC.L.coolMax, 'cooler count');
  ok(/1\.9/.test(T['Cell'].v), 'the DOE 2022 cell');
  const own = await refusals(page);
  ok(own.length === RC.own.length, 'own refusals shown ' + own.length + ' vs ' + RC.own.length);
  ok(own.some((t) => /water/.test(t)) && own.some((t) => /cooler90/.test(t)) && own.some((t) => /mli/.test(t)), 'the upper-bound, cooler and insulation refusals are shown');
  ok(/23 refusals carried/.test(await page.textContent('#carriedSum')), 'carried refusals counted');
  for (const id of ['stockChart', 'powerChart', 'ofChart', 'voltChart', 'tankChart', 'steamChart']) ok((await drawn(page, id)) > 2000, id + ' drawn');
  const rows = await page.$$eval('#checkTable tbody tr', (trs) => trs.map((tr) => tr.textContent));
  ok(rows.length === K.reality().length, 'reality rows ' + rows.length);
  ok(rows.every((r) => !/NaN|undefined|Infinity/.test(r)), 'no NaN in the reality table');
  ok(rows.some((r) => /NEAR/.test(r) && /-7\.02 %/.test(r)), 'NEAR\'s 1/r^2 gap -7.02 %');
  ok(rows.some((r) => /ISS OGA/.test(r) && /\+1\.7 %/.test(r)), 'the OGA Faraday gap');
  const routes = await page.$$eval('#routeTable tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)));
  ok(routes.length === 3, 'three routes compared');
  ok(close(num(routes[1][1]), RG.prop.mass_kg, RG.prop.mass_kg * 6e-4) && close(num(routes[1][2]), RG.prop.isp_s, 0.06), 'gas route row equals the kernel ' + routes[1].join(' | '));
  ok(close(num(routes[2][2]), RS.prop.isp_s, 0.06), 'steam route row equals the kernel ' + routes[2].join(' | '));
  ok(close(num(routes[1][4]), RG.dv, 0.06) && close(num(routes[0][4]), RC.dv, 0.06), 'route delta-v');
  // routes
  await click(page, '[data-route="gas"]');
  T = await tiles(page);
  ok(close(num(T['Specific impulse, vacuum'].v), RG.prop.isp_s, 0.06), 'gas route Isp ' + T['Specific impulse, vacuum'].v);
  ok(T['Tanks carried home'] && close(num(T['Tanks carried home'].v), RG.prop.tanks.h2_kg + RG.prop.tanks.o2_kg, 0.06), 'gas tanks tile');
  ok((await refusals(page)).some((t) => /pressure/.test(t)), 'gas route says the cell does the compressing and crossover is not modelled');
  await setNum(page, 'psIn', 50);
  const RG50 = K.run(srcC, { route: 'gas', p_store_MPa: 50 });
  T = await tiles(page);
  ok(close(num(T['Tanks carried home'].v), RG50.prop.tanks.h2_kg + RG50.prop.tanks.o2_kg, 0.06), '50 MPa tanks as the kernel');
  await click(page, '[data-route="steam"]');
  T = await tiles(page);
  ok(close(num(T['Specific impulse, vacuum'].v), RS.prop.isp_s, 0.06), 'steam Isp ' + T['Specific impulse, vacuum'].v);
  ok(/frozen/.test(T['Specific impulse, vacuum'].s), 'steam at area ratio 10 is frozen, and says so');
  ok((await refusals(page)).filter((t) => /steam/.test(t)).length >= 2, 'steam refusals shown');
  await setNum(page, 'thIn', 2000);
  ok((await page.textContent('#refusals')).includes('reaches at most'), 'a 2000 K heater is beyond idea 45\'s mirror');
  await click(page, '[data-route="cryo"]');
  // zero boil-off off loses more
  await click(page, '[data-zbo="off"]');
  const RN = K.run(srcC, { zbo: false, T_heat: 2000, p_store_MPa: 50 });
  T = await tiles(page);
  ok(close(num(T['Boil-off over the stay'].v), RN.L.boil.h2 + RN.L.boil.o2, 0.006), 'passive boil-off ' + T['Boil-off over the stay'].v);
  await click(page, '[data-zbo="on"]');
  // the mixture-ratio chart is a control
  const box = await page.$eval('#ofChart', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  let b0 = await seq(page);
  await page.mouse.click(box.x + 52 + (5 - 2) / 6 * (box.w - 102), box.y + box.h / 2);
  await waitRun(page, b0);
  T = await tiles(page);
  ok(close(num(T['Mixture ratio burned'].v), 5, 0.15), 'a click at O/F 5 sets it: ' + T['Mixture ratio burned'].v);
  const R5 = K.run(srcC, { of_mode: 'fixed', of: await page.evaluate(() => window.SplitPage.state.S.of) });
  ok(close(num(T['Specific impulse, vacuum'].v), R5.prop.isp_s, 0.06), 'Isp at the clicked ratio ' + T['Specific impulse, vacuum'].v);
  ok(num(T['Δv on the way home'].v) < RC.dv, 'burning at 5 buys less delta-v than the water\'s ratio on the chain');
  ok(!/is carried, not measured/.test(await page.textContent('#refusals')), 'no carried-calibration refusal at the RL10\'s own O/F 5');
  b0 = await seq(page);
  await page.focus('#ofChart'); await page.keyboard.press('ArrowRight');
  await waitRun(page, b0);
  ok(close(await page.evaluate(() => window.SplitPage.state.S.of), R5.settings.of + 0.1, 0.011), 'arrow key steps the ratio');
  // the left edge of the chart, O/F 2: idea 31 cannot expand it, so the propellant is refused, not shown as 0 kg
  b0 = await seq(page);
  await page.mouse.click(box.x + 52 + 1, box.y + box.h / 2);
  await waitRun(page, b0);
  T = await tiles(page);
  ok(T['Return propellant'].v.trim().startsWith('–') && /refused/.test(T['Return propellant'].c), 'O/F 2: propellant refused, not zero: ' + T['Return propellant'].v);
  ok(!/O\/F null|NaN|undefined/.test(await page.textContent('main')), 'O/F 2: no "null", NaN or undefined on the page');
  await click(page, '[data-of="optimal"]');
  // refusals the inputs raise
  await setNum(page, 'tcIn', 250);
  ok(/out of envelope/.test(await page.textContent('#refusals')) && (await page.$$('.tile')).length === 0, 'a 250 K cell is refused, no tiles');
  await setNum(page, 'tcIn', 333.15);
  await page.selectOption('#cellSel', 'custom');
  await page.waitForTimeout(50);
  await setNum(page, 'vIn', 1.15);
  ok(/reversible voltage/.test(await page.textContent('#refusals')), 'a cell below the reversible voltage is refused');
  await page.selectOption('#cellSel', 'status2022');
  await page.waitForTimeout(400);
  // the download parses in the kernel and reads back
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const got = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const back = K.parseHandoff(got);
  ok(!back.refusal && back.from === '46-split', 'the download reads back in the kernel ' + (back.refusal ? back.refusal.reason : ''));
  ok(got.outputs.propellant && got.outputs.propellant.units && got.outputs.propellant.confidence, 'propellant carries units and confidence');
  // imports
  await page.fill('#importText', 'not a handoff'); await page.click('#importBtn');
  ok(/Refused/.test(await page.textContent('#hoStatus')), 'garbage refused');
  await page.fill('#importText', H44); await page.click('#importBtn');
  ok(/Open it in idea 45/.test(await page.textContent('#hoStatus')), 'idea 44\'s handoff pointed to idea 45');
  const ed = JSON.parse(H45); ed.outputs.water_rate.value.total_kg *= 2;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn');
  ok(/do not add up/.test(await page.textContent('#hoStatus')), 'an edited idea 45 handoff refused');
  b0 = await seq(page);
  await page.fill('#importText', SAMPLE); await page.click('#importBtn');
  await waitRun(page, b0);
  ok(/match a re-run/.test(await page.textContent('#hoStatus')), 'this page\'s sample imports and matches');
  T = await tiles(page);
  ok(close(num(T['Return propellant'].v), JSON.parse(SAMPLE).outputs.propellant.value.mass_kg, 0.0006), 'the sample\'s propellant shown');
  ok(errors.length === 0, 'desktop console errors: ' + errors.join(' | '));
  await page.screenshot({ path: '/tmp/split-desktop-full.png', fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------------------------------------------- Bennu by link
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(HB));
  ok(/Bennu/.test(await page.textContent('#srcLine')), 'a #h= link with idea 45\'s Bennu handoff opens Bennu');
  let T = await tiles(page);
  const RB = K.run(srcB, {});
  ok(close(num(T['Return propellant'].v), RB.prop.mass_kg, 0.006) && RB.prop.mass_kg > 20, 'NEAR\'s arrays at Bennu: ' + T['Return propellant'].v + ' vs ' + RB.prop.mass_kg + ' (tanks sized for what they hold)');
  ok((await refusals(page)).some((t) => /power/.test(t)) && (await refusals(page)).some((t) => /cleanup/.test(t)), 'water left unsplit (power), and the CO2/SO2 cleanup refusal');
  // arrays too small to idle a 20 K cooler there: nothing liquefied, said so
  await setNum(page, 'pIn', 900);
  T = await tiles(page);
  ok(num(T['Return propellant'].v) === 0 && /bad/.test(T['Return propellant'].cls), '900 W arrays at Bennu make no liquid propellant');
  ok((await refusals(page)).some((t) => /cooler20/.test(t)), 'the idle-cooler refusal shows');
  await click(page, '[data-arr="near"]');
  await click(page, '[data-arr="psyche"]');
  const RP = K.run(srcB, { array: 'psyche', P1au: 21000 });
  T = await tiles(page);
  ok(close(num(T['Return propellant'].v), RP.prop.mass_kg, 0.06), 'Psyche\'s arrays: ' + T['Return propellant'].v + ' vs ' + RP.prop.mass_kg);
  ok(/derived/.test(T['Return propellant'].c) && !/at most/.test(T['Return propellant'].c), 'Bennu\'s CM water is measured, so the propellant is derived');
  const rows = await page.$$eval('#routeTable tbody tr', (trs) => trs.map((tr) => tr.textContent));
  ok(rows.length === 3 && rows.every((r) => !/NaN/.test(r)), 'Bennu routes compared');
  ok(errors.length === 0, 'Bennu console errors: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
  ok(sw <= 390, scheme + ': no horizontal overflow (' + sw + ')');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const small = await page.evaluate(() => { let n = 0; document.querySelectorAll('body *').forEach((e) => { if (e.children.length === 0 && e.textContent.trim() && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 11) n++; }); return n; });
  ok(small === 0, scheme + ': no text under 11 px (' + small + ')');
  for (const id of ['stockChart', 'ofChart', 'voltChart']) ok((await drawn(page, id)) > 1500, scheme + ' ' + id + ' drawn');
  const b0 = await seq(page);
  await page.tap('[data-route="gas"]');
  await waitRun(page, b0);
  ok(await page.evaluate(() => window.SplitPage.state.S.route === 'gas'), scheme + ': a tap switches the route');
  ok(!/NaN|undefined/.test(await page.textContent('main')), scheme + ': no NaN on the page');
  const sw2 = await page.evaluate(() => document.scrollingElement.scrollWidth);
  ok(sw2 <= 390, scheme + ': still no overflow after the tap (' + sw2 + ')');
  if (scheme === 'dark') await page.screenshot({ path: '/tmp/split-phone-dark-full.png', fullPage: true });
  ok(errors.length === 0, scheme + ' phone console errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log((failures ? 'FAILED ' + failures + ' of ' : 'ui-check: all ') + checks + ' checks' + (failures ? '' : ' pass'));
process.exit(failures ? 1 : 0);
