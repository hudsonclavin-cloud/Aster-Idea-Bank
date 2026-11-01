#!/usr/bin/env node
// Drives the Hot Return page in headless Chromium (desktop by mouse and keys, phone by touch, light and dark) and compares
// its numbers with the kernel's. From the bank root: node ideas/49-hot-return/ui-check.mjs (about a minute).
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const K = L.K;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/,/g, '').replace(/[^0-9.eE+-]/g, ' ').trim().split(/\s+/)[0]);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SAMPLE = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H48 = JSON.stringify(L.chain()), H47 = fs.readFileSync(path.join(here, '..', '47-way-home', 'handoff.json'), 'utf8');
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const seq = (page) => page.evaluate(() => window.HotReturnPage.state.seq);
async function waitRun(page, before) { await page.waitForFunction((b) => window.HotReturnPage.state.seq > b, before, { timeout: 90000 }); }
async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.HotReturnPage && window.HotReturnPage.state.seq > 0 && window.HotReturnPage.state.realDone, null, { timeout: 90000 });
  return { context, page, errors };
}
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '', s: (t.querySelector('.sub') || {}).textContent || '', cls: t.className }])));
const drawn = (page, id) => page.$eval('#' + id, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
async function act(page, fn) { const b = await seq(page); await fn(); await waitRun(page, b); }
async function setNum(page, id, v) { await act(page, async () => { await page.fill('#' + id, String(v)); await page.press('#' + id, 'Tab'); }); }

const RC = K.run(K.defaults());
const RL = K.reality();

// ------------------------------------------------------------------------------------------- the chain, desktop
{
  const { context, page, errors } = await open(DESK);
  let T = await tiles(page);
  ok(close(num(T['Touchdown'].v), RC.land.speed, 0.005), 'touchdown tile ' + T['Touchdown'].v + ' vs ' + RC.land.speed);
  ok(close(num(T['Lands'].v), RC.mass.landed_kg, 1e-4), 'landed mass tile ' + T['Lands'].v);
  ok(close(num(T['Peak heating'].v), RC.heat.peaks.qt / 1e4, 0.001), 'peak heating tile');
  ok(close(num(T['Heat load'].v), RC.heat.Q_total / 1e7, 0.002), 'heat load tile');
  ok(close(num(T['Recession'].v), RC.shield.recession_stag_m * 1000, 0.002), 'recession tile');
  ok(/refused/.test(T['Shield thickness'].v) && /refused/.test(T['Shield thickness'].cls), 'the chain\'s thickness is refused');
  ok(close(num(T['Main drag area'].v), RC.descent.chutes.main_cds_m2, 1e-3), 'main drag area tile');
  for (const k of Object.keys(T)) ok(['derived', 'assumed', 'measured', 'refused'].includes(T[k].c.trim()), 'tile ' + k + ' has a confidence chip: ' + T[k].c);
  const refs = await page.$$eval('#refusals .refusal', (rs) => rs.length);
  ok(refs === RC.refusals.length, 'own refusals shown ' + refs + ' vs ' + RC.refusals.length);
  const carried = await page.$$eval('#carriedList .refusal', (rs) => rs.length);
  ok(carried === RC.carried.length && carried === 42, 'carried refusals ' + carried);
  ok(/tps_thickness/.test(await page.textContent('#refusals')) && /export-control/.test(await page.textContent('#refusals')), 'the thickness refusal quotes the export control');
  for (const id of ['heatChart', 'downChart', 'shieldChart']) ok((await drawn(page, id)) > 2000, id + ' drawn');
  ok((await page.$$eval('.hbar', (b) => b.length)) === 3, 'three heritage bars');
  ok(/2\.11×/.test(await page.textContent('#heritage')), 'heat-load bar 2.11×');
  const evs = await page.$$eval('#events li', (l) => l.map((x) => x.textContent));
  ok(evs.length === RC.descent.events.length && /touchdown/.test(evs[evs.length - 1]), 'events listed ' + evs.length);
  // the reality table is the kernel's
  const real = await page.$$eval('#realTable tbody tr[data-id]', (rs) => rs.map((r) => ({ id: r.dataset.id, cells: [...r.querySelectorAll('td')].map((c) => c.textContent) })));
  ok(real.length === RL.rows.length, 'reality rows ' + real.length + ' vs ' + RL.rows.length);
  for (const r of real) {
    const k = RL.rows.find((x) => x.id === r.id);
    ok(!!k && !/NaN|undefined/.test(r.cells.join(' ')), 'reality row ' + r.id);
    if (k && k.units !== 'kg/m³') ok(close(num(r.cells[2]), k.model, 0.01), 'reality model ' + r.id + ' ' + r.cells[2] + ' vs ' + k.model);
  }
  ok(/6.25 mm/.test(real.find((r) => r.id === 'sd_recession').cells[1]), 'Stardust CT 6.25 mm shown');
  // hover the heating chart: the readout names a time and both heating terms
  const box = await page.$eval('#heatChart', (c) => { c.scrollIntoView(); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.5);
  ok(/s after entry .* radiative/.test(await page.textContent('#heatRead')), 'heat readout: ' + await page.textContent('#heatRead'));
  // a control changes the run: radiation off
  await act(page, () => page.click('#radIn'));
  T = await tiles(page);
  const Roff = K.run(Object.assign(K.defaults(), { radiative: false }));
  ok(close(num(T['Heat load'].v), Roff.heat.Q_total / 1e7, 0.002), 'radiation off: heat load ' + T['Heat load'].v);
  ok(/radiative_heating/.test(await page.textContent('#refusals')), 'radiation off is refused as such');
  await act(page, () => page.click('#radIn'));
  // the touchdown speed slider re-sizes the main
  await setNum(page, 'tdIn', 9);
  T = await tiles(page);
  const R9 = K.run(Object.assign(K.defaults(), { touchdown_m_s: 9 }));
  ok(close(num(T['Main drag area'].v), R9.descent.chutes.main_cds_m2, 1e-3), 'touchdown 9 m/s: main area ' + T['Main drag area'].v);
  // an out-of-range number is refused, tiles cleared, export says why
  await setNum(page, 'tdIn', 0.2);
  T = await tiles(page);
  ok(!!T['Refused'], 'touchdown 0.2 m/s refused');
  await page.click('#copyBtn');
  ok(/Nothing to export/.test(await page.textContent('#hoStatus')), 'export refuses with the reason');
  await setNum(page, 'tdIn', 4.5);
  // Stardust: heritage carries the thickness; the parachutes are the SRC's
  await act(page, () => page.click('[data-src="stardust"]'));
  T = await tiles(page);
  const RS = K.run({ source: 'stardust' });
  ok(/5\.82/.test(T['Shield thickness'].v), 'Stardust thickness 5.82 cm');
  ok(close(num(T['Touchdown'].v), RS.land.speed, 0.005), 'Stardust touchdown');
  ok(close(num(T['Recession'].v), RS.shield.recession_stag_m * 1000, 0.002), 'Stardust recession');
  // (review) where a flown capsule's flight ends is refused: its entry point is idea 48's stand-in at UTTR
  ok(/refused/.test(T['Lands at'].v) && T['Lands at'].c.trim() === 'refused', 'Stardust: landing place refused, not shown: ' + T['Lands at'].v);
  ok(/not where the capsule landed/.test(await page.textContent('#refusals')), 'Stardust: the landing-site refusal says why');
  // Genesis: no parachute, carbon-carbon refused
  await act(page, () => page.click('[data-src="genesis"]'));
  T = await tiles(page);
  ok(num(T['Touchdown'].v) > 50, 'Genesis hits hard: ' + T['Touchdown'].v);
  ok(/shield_material/.test(await page.textContent('#refusals')), 'Genesis carbon-carbon refusal');
  // (review) Genesis with parachutes: sized, not Stardust's and OSIRIS-REx's canopies, and said so
  await act(page, () => page.click('[data-chute="nominal"]'));
  T = await tiles(page);
  const RGn = K.run({ source: 'genesis', chutes: 'nominal' });
  ok(close(num(T['Main drag area'].v), RGn.descent.chutes.main_cds_m2, 1e-3) && T['Main drag area'].c.trim() === 'assumed', 'Genesis with parachutes: a sized main ' + T['Main drag area'].v);
  ok(/Genesis's own drogue and main are not on file/.test(await page.textContent('#refusals')), 'Genesis: its own canopies are not on file');
  // OSIRIS-REx with its drogue
  await act(page, () => page.click('[data-src="osirisrex"]'));
  await act(page, () => page.click('[data-chute="nominal"]'));
  T = await tiles(page);
  ok(!!T['Drogue opens'], 'OSIRIS-REx with a drogue shows it');
  // (review) a G-switch that never fires: the parachute sequence is refused with the speed it hits at
  await act(page, () => page.click('[data-src="chain"]'));
  await setNum(page, 'gIn', 20);
  T = await tiles(page);
  ok(num(T['Touchdown'].v) > 50 && /bad/.test(T['Touchdown'].cls), 'G-switch at 20 g: hits hard ' + T['Touchdown'].v);
  ok(/parachute_sequence/.test(await page.textContent('#refusals')) && /never fires/.test(await page.textContent('#refusals')), 'G-switch at 20 g: refused as such');
  await setNum(page, 'gIn', 3);
  // (review) ground below the spheroid is refused at the input
  await setNum(page, 'gndIn', -5);
  T = await tiles(page);
  ok(!!T['Refused'] && /spheroid/.test(T['Refused'].s), 'ground -5 m refused: ' + (T['Refused'] ? T['Refused'].s.slice(0, 60) : 'no'));
  await setNum(page, 'gndIn', '');
  // the download reads back in Node
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const got = fs.readFileSync(await dl.path(), 'utf8');
  ok(!K.parseHandoff(got).refusal, 'the downloaded handoff reads back in Node');
  // imports: garbage, idea 47's, an edited one refused; the sample and idea 48's accepted
  for (const [t, good, name] of [['{oops', false, 'garbage'], [H47, false, 'idea 47\'s handoff'], [SAMPLE.replace('"landed_kg": 9537', '"landed_kg": 9637'), false, 'an edited handoff'], [SAMPLE, true, 'the sample'], [H48, true, 'idea 48\'s handoff']]) {
    await page.fill('#importText', t);
    const before = await seq(page);
    await page.click('#importBtn');
    if (good) await waitRun(page, before);
    const st = await page.textContent('#hoStatus');
    ok(good ? !/Refused/.test(st) : /Refused/.test(st), name + ': ' + st.slice(0, 90));
  }
  // an imported idea 48 handoff that is not the chain enables "Your import"
  const other = L.chain(); other.produced = '2026-11-02T00:00:00Z';
  await page.fill('#importText', JSON.stringify(other));
  await act(page, () => page.click('#importBtn'));
  ok(!(await page.$eval('#srcImported', (b) => b.disabled)), 'your import is enabled');
  ok(await page.$eval('#srcImported', (b) => b.getAttribute('aria-pressed')) === 'true', 'and chosen');
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------------------------------- links
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(SAMPLE));
  ok(/read back/.test(await page.textContent('#hoStatus')), '#h= with the sample: ' + await page.textContent('#hoStatus'));
  await context.close();
  const o2 = await open(DESK, URL0 + '#h=' + b64(H48));
  ok(/accepted/.test(await o2.page.textContent('#hoStatus')), '#h= with idea 48\'s handoff');
  ok(errors.length === 0 && o2.errors.length === 0, 'links: no console errors');
  await o2.context.close();
}

// ------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(ov <= 0, scheme + ' phone: no horizontal overflow (' + ov + ')');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const small = await page.$$eval('body *', (els) => els.filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11 && e.offsetParent).length);
  ok(small === 0, scheme + ' phone: no text under 11 px (' + small + ')');
  for (const id of ['heatChart', 'downChart', 'shieldChart']) ok((await drawn(page, id)) > 2000, scheme + ' phone: ' + id + ' drawn');
  const box = await page.$eval('#downChart', (c) => { c.scrollIntoView(); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.touchscreen.tap(box.x + box.w * 0.5, box.y + box.h * 0.5);
  ok(/km/.test(await page.textContent('#downRead')), scheme + ' phone: a tap reads the descent ' + await page.textContent('#downRead'));
  ok(!/NaN/.test(await page.textContent('main')), scheme + ' phone: no NaN');
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`${checks - failures} of ${checks} UI checks pass`);
process.exit(failures ? 1 : 0);
