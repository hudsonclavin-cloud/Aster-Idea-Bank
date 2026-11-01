#!/usr/bin/env node
// Drives the Dig page in headless Chromium as a person would (desktop by mouse, phone by touch, light and dark) and
// compares its numbers with the kernel's. Run from the bank root: node ideas/45-dig/ui-check.mjs (about a minute)
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, sample44, bennu44 } = require(path.join(here, 'load.cjs'));
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
const H44 = JSON.stringify(sample44()), HB = JSON.stringify(bennu44()), H43 = JSON.stringify(sample44().inputs.lumpy_handoff);

const idle = (page) => page.waitForFunction(() => { const P = window.DigPage; return P && P.state.R && !P.state.running; }, null, { timeout: 120000 });
async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await idle(page);
  return { context, page, errors };
}
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '', s: (t.querySelector('.sub') || {}).textContent || '' }])));
const refusals = (page) => page.$$eval('#refusals .refusal b', (bs) => bs.map((b) => b.textContent));
const drawn = (page, id) => page.$eval('#' + id, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
// each finished run bumps state.seq; wait for the next one (an object cannot be compared across the page boundary)
async function waitRun(page, before) { await page.waitForFunction((b) => { const P = window.DigPage; return P.state.seq > b && !P.state.running; }, before, { timeout: 120000 }); }
const seq = (page) => page.evaluate(() => window.DigPage.state.seq);
async function setNum(page, id, v) { const before = await seq(page); await page.fill('#' + id, String(v)); await page.press('#' + id, 'Tab'); await waitRun(page, before); }
const water = (T) => T['Water per day (at most)'] || T['Water per day'];

// ---------------------------------------------------------------------------------------------------- the chain, desktop
const srcC = K.parseHandoff(sample44()).src, srcB = K.parseHandoff(bennu44()).src;
const RC = K.run(srcC, {});
{
  const { context, page, errors } = await open(DESK);
  let T = await tiles(page);
  ok(water(T) && /at most/.test(Object.keys(T).find((k) => /Water per day/.test(k))), 'the chain\'s water is an upper bound');
  ok(Math.abs(num(water(T).v) - RC.water.mean * 1000) < 0.6 && /g$/.test(water(T).v), 'water tile ' + water(T).v + ' vs ' + RC.water.mean * 1000 + ' g');
  ok(water(T).c === 'assumed', 'S-type water is labelled assumed');
  ok(Math.abs(num(T['Heat per kg of water'].v) / (RC.energy.perKgWater_J / 1e6) - 1) < 0.005, 'heat per kg water (3 figures) ' + T['Heat per kg of water'].v);
  ok(Math.abs(num(T['Digging pushes sideways'].v) - RC.dig.sideUsed_N * 1000) < 0.06, 'sideways push tile ' + T['Digging pushes sideways'].v);
  ok(T['Digging pushes sideways'].s.includes(RC.dig.friction_needed.toFixed(2)) && /not judged/.test(T['Digging pushes sideways'].s), 'friction needed shown, not judged: ' + T['Digging pushes sideways'].s);
  ok(num(T['Water in the rock'].v) === 510, 'Itokawa 510 ppm');
  const R = await refusals(page);
  ok(R.length === 4 && R.some((x) => x.includes('release')) && R.some((x) => x.includes('excavation')) && R.some((x) => x.includes('terrain')) && R.some((x) => x.includes('insufficient data · traction')), 'own refusals ' + R.join(' | '));
  ok((await page.$eval('#carriedSum', (e) => e.textContent)).startsWith('19 '), '19 carried');
  for (const id of ['dayChart', 'sunChart', 'yieldChart', 'energyChart', 'recChart', 'pushChart']) ok(await drawn(page, id) > 2000, id + ' drawn');
  let rows = await page.$$eval('#checkTable tbody tr', (r) => r.map((x) => x.textContent));
  ok(rows.length === 6 && !rows.some((t) => /NaN|undefined/.test(t)), 'checks table, 6 rows for Apophis, no NaN');
  ok(rows.some((t) => /Winchcombe/.test(t) && /−7\.7%/.test(t)), 'Winchcombe gap −7.7%');
  // a bigger oven makes heat the limit; then doubling the mirror doubles the water, as the kernel says
  await setNum(page, 'ovIn', 1000);
  T = await tiles(page);
  const k1 = K.run(srcC, { oven_kg: 1000 }).water.mean, k2 = K.run(srcC, { oven_kg: 1000, aperture_m2: 17 }).water.mean;
  ok(Math.abs(num(water(T).v) - k1 * 1000) < 0.6, 'oven 1000 kg: ' + water(T).v + ' vs ' + k1 * 1000);
  ok(/heat 90/.test(T['Regolith baked per day'].s), 'heat now limits every day');
  await setNum(page, 'apIn', 17);
  T = await tiles(page);
  ok(Math.abs(num(water(T).v) - k2 * 1000) < 1.1 && Math.abs(k2 / k1 - 2) < 1e-9, 'mirror doubled: ' + water(T).v);
  // a friction coefficient set as a what-if, then a cut too deep for it: the page holds it back and says why
  await setNum(page, 'muIn', 0.5);
  await setNum(page, 'depIn', 20);
  const RM = K.run(srcC, { oven_kg: 1000, aperture_m2: 17, mu: 0.5, depth_m: 0.02 });
  ok((await refusals(page)).some((x) => x.includes('out of envelope · traction')), 'a 20 mm cut at friction 0.5 is held back');
  T = await tiles(page);
  ok(/held there/.test(T['Digging pushes sideways'].s) && Math.abs(num(T['Digging pushes sideways'].v) - RM.dig.sideUsed_N * 1000) < 0.06, 'held-back push ' + T['Digging pushes sideways'].v + ' vs ' + RM.dig.sideUsed_N * 1000);
  { const b1 = await seq(page); await page.fill('#muIn', ''); await page.press('#muIn', 'Tab'); await waitRun(page, b1); }
  ok((await refusals(page)).some((x) => x.includes('insufficient data · traction')), 'a blank friction is not judged again');
  // too little concentration: no heat goes into the oven
  await setNum(page, 'cIn', 20);
  T = await tiles(page);
  ok((await refusals(page)).some((x) => x.includes('receiver')) && num(water(T).v) === 0, 'concentration 20 refused, no water');
  let b0 = await seq(page); await page.click('#resetBtn'); await waitRun(page, b0);
  // a what-if: Apophis as a CM chondrite
  let before = await seq(page);
  await page.selectOption('#anaSel', 'cm'); await waitRun(page, before);
  ok((await refusals(page)).some((x) => x.includes('analog')), 'a CM Apophis is labelled a what-if');
  ok(await page.isVisible('#runRow') && !(await page.isVisible('#sRow')), 'the run picker shows for a CM');
  b0 = await seq(page); await page.selectOption('#anaSel', 'auto'); await waitRun(page, b0);
  // export: the download parses in the kernel's own reader
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const h = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(h.from === '45-dig' && h.inputs.touch_handoff.from === '44-touch-and-go', 'download is a 45 handoff carrying 44');
  const back = K.parseHandoff(h);
  ok(!back.refusal, 'the download parses in the kernel: ' + (back.refusal ? back.refusal.reason : ''));
  // imports that must be refused
  for (const [text, re, what] of [['garbage', /not JSON/, 'garbage'], [H43, /idea 44/, 'idea 43\'s handoff'], [H44.replace('"weight_N":0.0461787287', '"weight_N":0.09'), /weighs/, 'an edited 44 handoff']]) {
    await page.fill('#importText', text); await page.click('#importBtn');
    await page.waitForFunction(() => !/Working/.test(document.getElementById('hoStatus').textContent));
    const st = await page.$eval('#hoStatus', (e) => e.textContent);
    ok(/^Refused/.test(st) && re.test(st), what + ' refused: ' + st.slice(0, 120));
  }
  // this page's own sample imports and matches
  await page.fill('#importText', SAMPLE); await page.click('#importBtn');
  await page.waitForFunction(() => /matches|Refused/.test(document.getElementById('hoStatus').textContent));
  ok(/recomputed it: it matches/.test(await page.$eval('#hoStatus', (e) => e.textContent)), 'the sample imports and matches');
  ok(errors.length === 0, 'desktop console errors: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------------------------------------------- Bennu, by a #h= link with idea 44's handoff
{
  const RB = K.run(srcB, {}), RE = K.run(srcB, { run: 'E' });
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(HB));
  ok(/Imported idea 44/.test(await page.$eval('#hoStatus', (e) => e.textContent)), '#h= with idea 44\'s Bennu handoff');
  await idle(page);
  let T = await tiles(page);
  ok(Math.abs(num(water(T).v) - RB.water.mean) < 0.051 && /kg$/.test(water(T).v), 'Bennu water ' + water(T).v + ' vs ' + RB.water.mean);
  ok(water(T).c === 'derived', 'CM water is derived from measured release');
  ok(Math.abs(num(T['Heat per kg of water'].v) - RB.energy.perKgWater_J / 1e6) < 0.051, 'Bennu heat per kg water');
  ok((await refusals(page)).some((x) => x.includes('feedstock')), 'feedstock refusal for a CM analog');
  const rows = await page.$$eval('#checkTable tbody tr', (r) => r.map((x) => x.textContent));
  ok(rows.length === 7 && rows.some((t) => /closed form/.test(t)), 'Bennu adds the daylight closed form');
  const before = await seq(page);
  await page.selectOption('#runSel', 'E'); await waitRun(page, before);
  T = await tiles(page);
  ok(Math.abs(num(water(T).v) - RE.water.mean) < 0.051, 'run E: ' + water(T).v + ' vs ' + RE.water.mean);
  ok(errors.length === 0, 'Bennu console errors: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, scheme + ' phone overflow ' + sw);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const small = await page.$$eval('body *', (els) => els.filter((e) => e.children.length === 0 && e.textContent.trim() && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.tagName + ':' + e.textContent.slice(0, 20)));
  ok(small.length === 0, scheme + ' text under 11 px: ' + small.slice(0, 5).join(', '));
  for (const id of ['dayChart', 'sunChart', 'pushChart']) ok(await drawn(page, id) > 2000, scheme + ' phone ' + id + ' drawn');
  const before = await seq(page);
  await page.tap('[data-case="bennu"]'); await waitRun(page, before);
  ok((await page.getAttribute('[data-case="bennu"]', 'aria-pressed')) === 'true', scheme + ' a tap switches to Bennu');
  ok(!(await page.$eval('main', (e) => e.textContent)).includes('NaN'), scheme + ' no NaN');
  ok(errors.length === 0, scheme + ' phone console errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks pass`);
process.exit(failures ? 1 : 0);
