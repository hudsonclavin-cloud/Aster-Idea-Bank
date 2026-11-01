#!/usr/bin/env node
// Drives the Touch and Go page in headless Chromium as a person would (desktop by mouse, phone by touch, light and dark)
// and compares its numbers with the kernel's. Run from the bank root: node ideas/44-touch-and-go/ui-check.mjs (about 2 min)
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, sample43 } = require(path.join(here, 'load.cjs'));
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
const H43 = JSON.stringify(sample43()), H42 = fs.readFileSync(path.join(here, '..', '42-closing-in', 'handoff.json'), 'utf8');

const idle = (page, pred) => page.waitForFunction(pred || (() => { const P = window.TouchPage; return P && P.state.R && !P.state.running; }), null, { timeout: 120000 });
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
async function waitRun(page, before) { await page.waitForFunction((b) => { const P = window.TouchPage; return P.state.R !== b && !P.state.running; }, before, { timeout: 120000 }); }

// ---------------------------------------------------------------------------------------------------- the chain, desktop
const RC = K.run(K.importLumpy(sample43()), {});
{
  const { context, page, errors } = await open(DESK);
  const T = await tiles(page);
  ok(Math.abs(num(T['Total Δv with back-away'].v) - RC.plan.total_dv_m_s * 100) < 0.051, 'total dv tile ' + T['Total Δv with back-away'].v);
  ok(T['Contact ellipse (3σ)'].v.startsWith(RC.dispersion.pos3_m[0].toFixed(2)), 'ellipse tile ' + T['Contact ellipse (3σ)'].v);
  ok(T['Contact ellipse (3σ)'].c === 'derived', 'ellipse confidence');
  ok(Math.abs(num(T['Propellant for this'].v) - RC.propellant.needed_kg * 1000) < 0.6, 'propellant tile');
  ok(T['Sinks before backing away'].c === 'assumed', 'sinking is labelled assumed');
  ok(T['Back-away'].v === 'leaves', 'back-away leaves');
  ok(T['Sample mass'].v === 'refused', 'sample refused for Apophis');
  ok(Math.abs(num(T['Weight at the site'].v) - RC.hold.weight_N * 1000) < 0.06, 'weight tile');
  const R = await refusals(page);
  ok(R.length === 5 && R[0].includes('propellant') && R.some((x) => x.includes('anchors')), 'own refusals ' + R.join(' | '));
  ok((await page.$eval('#carriedSum', (e) => e.textContent)).startsWith('14 '), '14 carried');
  ok((await page.$$eval('#burnTable tbody tr', (r) => r.length)) === 4, 'burn table rows');
  for (const id of ['descChart', 'ellChart', 'penChart', 'hopChart', 'holdChart', 'smpChart']) ok(await drawn(page, id) > 2000, id + ' drawn');
  await page.waitForFunction(() => document.querySelectorAll('#checkTable tbody tr').length > 10, null, { timeout: 120000 });
  const rows = await page.$$eval('#checkTable tbody tr', (r) => r.map((x) => x.textContent));
  ok(rows.length === 13 && !rows.some((t) => /NaN|undefined/.test(t)), 'checks table, 13 rows, no NaN');
  ok(rows[0].includes('0.4 m') && rows[0].includes('2.07 m'), 'last-fall row: ' + rows[0].slice(0, 160));
  // a slider moves the plan: a softer touch
  let before = await page.evaluate(() => window.TouchPage.state.R);
  await page.fill('#vtdIn', '5'); await page.press('#vtdIn', 'Enter'); await page.$eval('#vtdIn', (e) => e.dispatchEvent(new Event('change')));
  await waitRun(page, before);
  const R5 = K.run(K.importLumpy(sample43()), { v_td: 0.05 });
  const T5 = await tiles(page);
  ok(Math.abs(num(T5['Total Δv with back-away'].v) - R5.plan.total_dv_m_s * 100) < 0.051, '5 cm/s total dv ' + T5['Total Δv with back-away'].v);
  // stay on rigid rock: bounces
  before = await page.evaluate(() => window.TouchPage.state.R);
  await page.click('[data-mode="stay"]'); await waitRun(page, before);
  before = await page.evaluate(() => window.TouchPage.state.R);
  await page.click('[data-surf="rigid"]'); await waitRun(page, before);
  const Rr = K.run(K.importLumpy(sample43()), { v_td: 0.05, mode: 'stay', surface: 'rigid' });
  const Tr = await tiles(page);
  ok(Tr['Bounces'] && num(Tr['Bounces'].v) === Rr.stay.bounce.hops.length, 'bounce count ' + (Tr['Bounces'] || {}).v + ' vs ' + Rr.stay.bounce.hops.length);
  ok(await page.isVisible('#eRow'), 'restitution control shown');
  // invalid settings are refused, not computed
  before = await page.evaluate(() => window.TouchPage.state.R);
  await page.fill('#hcpIn', '5'); await page.$eval('#hcpIn', (e) => e.dispatchEvent(new Event('change'))); await waitRun(page, before);
  ok((await page.$$eval('.tile', (t) => t.length)) === 0 && (await refusals(page))[0].startsWith('invalid input'), 'a 5 m Checkpoint is refused');
  // export: the download parses in the kernel's own reader
  await page.click('#resetBtn'); await idle(page, () => { const P = window.TouchPage; return P.state.R && !P.state.R.refusal && !P.state.running; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const text = fs.readFileSync(await dl.path(), 'utf8'), h = JSON.parse(text);
  ok(h.from === '44-touch-and-go' && h.inputs.lumpy_handoff.from === '43-lumpy', 'download is a 44 handoff carrying 43');
  const back = K.parseHandoff(h);
  ok(!back.refusal, 'the download parses in the kernel: ' + (back.refusal ? back.refusal.reason : ''));
  // imports: garbage, idea 42's (pointed to 43), an edited 43, this page's own
  await page.fill('#importText', 'not json'); await page.click('#importBtn'); await page.waitForFunction(() => /Refused/.test(document.getElementById('hoStatus').textContent));
  await page.fill('#importText', H42); await page.click('#importBtn'); await page.waitForFunction(() => /idea 43/.test(document.getElementById('hoStatus').textContent), null, { timeout: 60000 });
  ok(/Refused/.test(await page.$eval('#hoStatus', (e) => e.textContent)), 'idea 42 refused');
  const ed = JSON.parse(H43); ed.outputs.site.value.slope_deg += 2;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn'); await page.waitForFunction(() => /Idea 43 refuses|Refused/.test(document.getElementById('hoStatus').textContent) && !/Working/.test(document.getElementById('hoStatus').textContent), null, { timeout: 60000 });
  ok(/Idea 43 refuses/.test(await page.$eval('#hoStatus', (e) => e.textContent)), 'an edited 43 handoff is refused');
  await page.fill('#importText', SAMPLE); await page.click('#importBtn'); await page.waitForFunction(() => /matches|Refused/.test(document.getElementById('hoStatus').textContent), null, { timeout: 120000 });
  ok(/matches/.test(await page.$eval('#hoStatus', (e) => e.textContent)), 'own sample imports and matches');
  ok(errors.length === 0, 'desktop console errors: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------------------------------------------- Bennu and the #h= link
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(H43));
  ok(/Imported idea 43/.test(await page.$eval('#hoStatus', (e) => e.textContent)), '#h= with idea 43\'s handoff');
  let before = await page.evaluate(() => window.TouchPage.state.R);
  await page.click('[data-case="bennu"]'); await waitRun(page, before);
  const RB = K.run(K.bennuCase(), {}), T = await tiles(page);
  ok(Math.abs(num(T['Total Δv with back-away'].v) - RB.plan.total_dv_m_s * 100) < 0.051, 'Bennu total dv');
  ok(T['Contact ellipse (3σ)'].v.startsWith(RB.dispersion.pos3_m[0].toFixed(2)), 'Bennu ellipse ' + T['Contact ellipse (3σ)'].v);
  ok(T['Sample (TAGSAM, predicted)'] && Math.abs(num(T['Sample (TAGSAM, predicted)'].v) - RB.sample.mass_kg * 1000) < 0.6, 'Bennu sample tile');
  ok(T['Propellant for this'].v === 'refused', 'no propellant number for OSIRIS-REx');
  const flown = await page.$$eval('#burnTable tbody tr td:nth-child(4)', (t) => t.map((x) => x.textContent));
  ok(flown[0].startsWith('80.07'), 'flown departure burn ' + flown[0]);
  ok((await page.$eval('#descLegend', (e) => e.textContent)).includes('reconstructed'), 'reconstruction drawn on the descent chart');
  // GM from radio tracking changes the body and so the burns
  before = await page.evaluate(() => window.TouchPage.state.R);
  await page.check('#gmChk'); await waitRun(page, before);
  const Rsc = K.run(K.bennuCase('measured_sc'), { gm: 'measured_sc' }), Tsc = await tiles(page);
  ok(Math.abs(num(Tsc['Total Δv with back-away'].v) - Rsc.plan.total_dv_m_s * 100) < 0.051, 'spacecraft GM total dv');
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
  for (const id of ['descChart', 'ellChart', 'smpChart']) ok(await drawn(page, id) > 1000, scheme + ' ' + id + ' drawn');
  const before = await page.evaluate(() => window.TouchPage.state.R);
  await page.tap('[data-mode="stay"]'); await waitRun(page, before);
  ok((await tiles(page))['Sinks and stops'], scheme + ' stay on regolith by touch');
  ok(!(await page.$eval('main', (e) => e.textContent)).includes('NaN'), scheme + ' no NaN');
  ok(errors.length === 0, scheme + ' phone console errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log((failures ? failures + ' of ' : 'all ') + checks + ' UI checks ' + (failures ? 'FAILED' : 'passed'));
process.exit(failures ? 1 : 0);
