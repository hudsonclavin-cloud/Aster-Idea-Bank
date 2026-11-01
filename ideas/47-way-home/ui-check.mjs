#!/usr/bin/env node
// Drives the Way Home page in headless Chromium (desktop by mouse and keys, phone by touch, light and dark) and
// compares its numbers with the kernel's. From the bank root: node ideas/47-way-home/ui-check.mjs (about 60 s).
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
const H46 = JSON.stringify(L.chain()), H45 = fs.readFileSync(path.join(here, '..', '45-dig', 'handoff.json'), 'utf8');
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const seq = (page) => page.evaluate(() => window.WayHomePage.state.seq);
async function waitRun(page, before) { await page.waitForFunction((b) => window.WayHomePage.state.seq > b, before, { timeout: 90000 }); }
async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.WayHomePage && window.WayHomePage.state.seq > 0, null, { timeout: 90000 });
  return { context, page, errors };
}
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '', s: (t.querySelector('.sub') || {}).textContent || '', cls: t.className }])));
const own = (page) => page.$$eval('#refusals .refusal b', (bs) => bs.map((b) => b.textContent));
const drawn = (page, id) => page.$eval('#' + id, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
async function act(page, fn) { const b = await seq(page); await fn(); await waitRun(page, b); }
async function setNum(page, id, v) { await act(page, async () => { await page.fill('#' + id, String(v)); await page.press('#' + id, 'Tab'); }); }

const RC = K.run(K.defaults(), { split: L.chain() });
const RH = K.run(Object.assign(K.defaults(), { hold: 'held' }), { split: L.chain() });
const RD = K.run(Object.assign(K.defaults(), { objective: 'dv' }), { split: L.chain() });

// ------------------------------------------------------------------------------------------- the chain, desktop
{
  const { context, page, errors } = await open(DESK);
  await page.waitForFunction(() => window.WayHomePage.state.checks, null, { timeout: 60000 });
  let T = await tiles(page);
  ok(T['Leave the asteroid'].v === K.K39.utcOf(RC.sel.depTdb).slice(0, 16).replace('T', '') + ' UTC', 'departure tile ' + T['Leave the asteroid'].v);
  ok(close(num(T['Δv at the asteroid'].v), RC.flight.dvMag, 0.006), 'delta-v tile ' + T['Δv at the asteroid'].v + ' vs ' + RC.flight.dvMag);
  ok(/patched conic 2\.46/.test(T['Δv at the asteroid'].s), 'patched-conic delta-v beside it');
  ok(close(num(T['Material home'].v), RC.mass.material_kg, 0.6), 'material tile ' + T['Material home'].v + ' vs ' + RC.mass.material_kg);
  ok(/assumed/i.test(T['Material home'].c), 'material is labelled assumed (idea 46\'s water is an upper bound)');
  ok(close(num(T['Arrival v∞'].v), RC.flight.flown.v_infinity_m_s / 1000, 0.0006), 'v_inf tile');
  ok(close(num(T['Entry speed at 125 km'].v), RC.entry.speed_m_s / 1000, 0.006) && /warn/.test(T['Entry speed at 125 km'].cls), 'entry speed tile, flagged above 12 km/s');
  ok(close(num(T['Δv the propellant gives'].v), RC.mass.capacity_m_s, 0.06), 'capacity tile');
  ok(Object.values(T).every((t) => t.c), 'every tile carries a confidence chip');
  ok(/rides 99942 Apophis/.test(await page.$eval('#rideLine', (e) => e.textContent)), 'the ride is named');
  const R0 = await own(page);
  ok(R0.length === RC.refusals.filter((r) => !r.from).length && R0.some((b) => /entry_speed/.test(b)), 'own refusals shown: ' + R0.join(' | '));
  ok(/31 refusals carried/.test(await page.$eval('#carriedSum', (e) => e.textContent)), 'carried refusals counted');
  for (const [id, n] of [['porkChart', 200000], ['dateChart', 8000], ['orbitChart', 4000]]) { const d = await drawn(page, id); ok(d > n, id + ' drawn (' + d + ' pixels)'); }
  const rows = await page.$$eval('#checkTable tbody tr', (rs) => rs.map((r) => r.textContent));
  ok(rows.length === 10, 'ten reality rows (' + rows.length + ')');
  ok(rows.every((r) => !/NaN|undefined/.test(r)), 'no NaN in the reality table');
  ok(rows.some((r) => /median 0\.28 m\/s, max 5\.50/.test(r)), 'NHATS departure-burn row');
  ok(rows.some((r) => /\+2\.65 %/.test(r)) && rows.some((r) => /-0\.30 %/.test(r)), 'OSIRIS-REx rows');
  ok(rows.some((r) => /38,011\.5 km/.test(r) && /\+1\.66 km/.test(r)), 'Apophis 2029 distance row');
  ok(rows.some((r) => /pass: time/.test(r) && /0\.081 s/.test(r)), 'Apophis 2029 time row, refined to 1 ms (review)');
  ok(/The dot is the chosen return, 2\.33 m\/s/.test(await page.$eval('#dateCap', (e) => e.textContent)) && /chosen return/.test(await page.$eval('#dateLegend', (e) => e.textContent)), 'the date chart shows the chosen return\'s cost (review)');
  ok(/flight through the planets its perigee 2029-04-13 20:18/.test(await page.$eval('#orbitCap', (e) => e.textContent)), 'the orbit caption tells the patched-conic arrival from the flown perigee (review)');
  ok(rows.some((r) => /×0\.00048/.test(r)), 'Aster\'s symmetric sample-return row');

  // controls
  await act(page, () => page.click('[data-hold="held"]'));
  T = await tiles(page);
  ok(close(num(T['Material home'].v), RH.mass.material_kg, 0.6), 'held coolers: ' + T['Material home'].v + ' vs ' + RH.mass.material_kg);
  await act(page, () => page.click('[data-hold="passive"]'));
  await act(page, () => page.click('[data-obj="dv"]'));
  T = await tiles(page);
  ok(close(num(T['Δv at the asteroid'].v), RD.flight.dvMag, 0.006), 'least delta-v: ' + T['Δv at the asteroid'].v + ' vs ' + RD.flight.dvMag);
  await act(page, () => page.click('[data-obj="material"]'));
  await act(page, () => page.click('[data-arr="brake"]'));
  T = await tiles(page);
  ok((await own(page)).some((b) => /return/.test(b)) && close(num(T['Entry speed at 125 km'].v), 12, 0.006), 'braking to 12 km/s is beyond 7 kg of propellant');
  await act(page, () => page.click('[data-arr="handon"]'));
  // a click on the porkchop chooses that cell; arrows move; Enter refines
  const box = await page.$eval('#porkChart', (c) => { c.scrollIntoView(); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await act(page, () => page.mouse.click(box.x + 46 + (box.w - 56) * 0.5, box.y + 8 + (box.h - 40) * 0.5));
  let st = await page.evaluate(() => window.WayHomePage.state.R.sel && { src: window.WayHomePage.state.R.sel.source, dep: window.WayHomePage.state.R.sel.depTdb, dv: window.WayHomePage.state.R.sel.q.dvMag });
  ok(st && st.src === 'chosen', 'a click chooses a cell');
  const k = K.cell(K.ephemeris(K.K39.findBody('99942')), st.dep, (await page.evaluate(() => window.WayHomePage.state.R.sel.tofS)), [0, 1]);
  ok(k.ok && k.sols.some((q) => close(q.dvMag, st.dv, 1e-6)), 'the clicked cell is the kernel\'s');
  await page.focus('#porkChart');
  await act(page, () => page.keyboard.press('ArrowRight'));
  const st2 = await page.evaluate(() => window.WayHomePage.state.R.sel.depTdb);
  ok(st2 > st.dep, 'the arrow key moves the selection later');
  await act(page, () => page.keyboard.press('Enter'));
  ok((await page.evaluate(() => window.WayHomePage.state.R.sel.source)) === 'refined', 'Enter refines');
  await act(page, () => page.click('#bestBtn'));

  // bad input: refused, nothing stale, nothing to export
  await setNum(page, 'tofMinIn', 1);
  ok((await own(page)).some((b) => /invalid_input/.test(b)) && (await page.$$('.tile')).length === 0, 'a 1-day flight is refused and the tiles cleared');
  await page.click('#copyBtn');
  ok(/Nothing to export/.test(await page.$eval('#hoStatus', (e) => e.textContent)), 'export says why there is nothing');
  await setNum(page, 'tofMinIn', 20);
  // review: an emptied field was read as zero (the latest departure ran as the stay's end, the aim as 0 km)
  for (const id of ['waitIn', 'aimIn']) {
    await setNum(page, id, '');
    ok((await own(page)).some((x) => /invalid_input/.test(x)) && (await page.$$('.tile')).length === 0, 'an empty ' + id + ' is refused, not read as zero');
    await act(page, () => page.click('#resetBtn'));
  }

  // export, read back in Node (another JavaScript engine's run)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  const back = K.parseHandoff(text);
  ok(!back.refusal, 'the download reads back in Node: ' + (back.refusal && back.refusal.reason));
  // imports
  for (const [label, bad] of [['garbage', 'not json'], ['idea 45', H45], ['edited', SAMPLE.replace(/"material_kg":[0-9.]+/, '"material_kg":9999')]]) {
    await page.fill('#importText', bad); await page.click('#importBtn');
    ok(/Refused/.test(await page.$eval('#hoStatus', (e) => e.textContent)), label + ' refused');
  }
  await page.fill('#importText', SAMPLE);
  await act(page, () => page.click('#importBtn'));
  T = await tiles(page);
  ok(/verified/.test(await page.$eval('#hoStatus', (e) => e.textContent)) && close(num(T['Material home'].v), JSON.parse(SAMPLE).outputs.mass.value.material_kg, 0.6), 'the sample imports and matches');
  ok(errors.length === 0, 'desktop console errors: ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------------------------------- a craft you describe
{
  const { context, page, errors } = await open(DESK);
  await act(page, () => page.click('[data-case="custom"]'));
  await act(page, () => page.selectOption('#bodySel', '101955'));
  await act(page, async () => { await page.fill('#stayIn', '2030-01-01'); await page.press('#stayIn', 'Tab'); });
  await setNum(page, 'propIn', 765.32); await setNum(page, 'dryIn', 1196.8);   // the Isp stays idea 46's (it shows as 423.3)
  const S = Object.assign(K.defaults(), { case: 'custom', custom: { body: '101955', stay_end_utc: '2030-01-01T00:00:00Z', propellant_kg: 765.32, isp_s: L.chain().outputs.propellant.value.isp_s, dry_kg: 1196.8, boiloff_kg_per_day: 0, g0: L.chain().outputs.propellant.value.ve_m_s / L.chain().outputs.propellant.value.isp_s } });
  const RB = K.run(S, null), T = await tiles(page);
  ok(close(num(T['Δv at the asteroid'].v), RB.flight.dvMag, 0.6), 'Bennu stand-alone: ' + T['Δv at the asteroid'].v + ' vs ' + RB.flight.dvMag);
  ok(close(num(T['Material home'].v), RB.mass.material_kg, 0.6), 'Bennu material ' + T['Material home'].v + ' vs ' + RB.mass.material_kg);
  ok((await own(page)).some((b) => /craft/.test(b)), 'the stand-alone craft says it is typed in');
  ok(errors.length === 0, 'custom console errors: ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------------------------------- links
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(SAMPLE));
  ok(/verified/.test(await page.$eval('#hoStatus', (e) => e.textContent)), 'a #h= link with this page\'s handoff opens verified');
  await context.close();
  const g = L.chain(); g.produced = '2026-11-03T00:00:00Z';
  const o2 = await open(DESK, URL0 + '#h=' + b64(JSON.stringify(g)));
  ok(/Imported idea 46/.test(await o2.page.$eval('#hoStatus', (e) => e.textContent)), 'a #h= link with idea 46\'s handoff runs it');
  ok(errors.length === 0 && o2.errors.length === 0, 'link console errors');
  await o2.context.close();
}

// ------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ov <= 0, scheme + ' phone overflow ' + ov);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const small = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.tagName + ':' + e.textContent.slice(0, 20)));
  ok(small.length === 0, scheme + ' text under 11 px: ' + small.slice(0, 4).join(' | '));
  for (const [id, n] of [['porkChart', 100000], ['dateChart', 5000], ['orbitChart', 3000]]) { const d = await drawn(page, id); ok(d > n, scheme + ' phone ' + id + ' drawn (' + d + ')'); }
  const box = await page.$eval('#porkChart', (c) => { c.scrollIntoView(); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await act(page, () => page.touchscreen.tap(box.x + box.w * 0.6, box.y + box.h * 0.4));
  ok((await page.evaluate(() => window.WayHomePage.state.R.sel && window.WayHomePage.state.R.sel.source)) === 'chosen', scheme + ' a tap chooses a cell');
  ok(!/NaN/.test(await page.evaluate(() => document.body.innerText)), scheme + ' no NaN');
  ok(errors.length === 0, scheme + ' phone console errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`${checks - failures} of ${checks} UI checks pass`);
process.exit(failures ? 1 : 0);
