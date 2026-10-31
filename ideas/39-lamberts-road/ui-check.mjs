#!/usr/bin/env node
// Drives the Lambert's Road page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by
// touch, light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/39-lamberts-road/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K } = require(path.join(here, 'load.cjs'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/,/g, '').replace('−', '-'));
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const H38 = JSON.parse(fs.readFileSync(path.join(here, '..', '38-burn-out', 'handoff.json'), 'utf8'));
const H37 = JSON.parse(fs.readFileSync(path.join(here, '..', '37-window', 'handoff.json'), 'utf8'));
function closingH38() {   // idea 38's own committed kernel: the chain's AS-512 departure with a 25 t payload, which closes
  const L38 = require(path.join(here, '..', '38-burn-out', 'load.cjs'));
  const B = L38.B, st = B.importWindow(L38.WIN), set = Object.assign(B.defaults(), { payloadKg: 25000, sweep: false, capability: false });
  return B.makeHandoff({ window: st }, set, B.compute({ window: st }, set), { produced: '2026-10-31T12:00:00Z' });
}

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' / ')));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#selTiles .tile').length > 5 && document.querySelectorAll('#checkTable tbody tr').length > 0, null, { timeout: 30000 });
  return { context, page, errors };
}
const tileVal = (page, key) => page.evaluate((k) => { const t = [...document.querySelectorAll('.tile')].find((x) => x.querySelector('.k').textContent === k); return t ? t.querySelector('.v').textContent : null; }, key);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s).textContent, sel);
async function inkPixels(page, id) {
  return page.evaluate((i) => { const c = document.getElementById(i), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 16) if (d[k] > 0) n++; return n; }, id);
}
async function clickCell(page, i, j, tap) {
  const box = await page.evaluate(([i, j]) => { const c = document.getElementById('pork'), r = c.getBoundingClientRect(), G = window.LambertsRoadPage.state.R.grid, m = { l: 46, r: 8, t: 8, b: 30 }; const pw = r.width - m.l - m.r, ph = r.height - m.t - m.b; return { x: r.left + m.l + (i + 0.5) * pw / G.nDep, y: r.top + m.t + (G.nTof - 1 - j + 0.5) * ph / G.nTof }; }, [i, j]);
  if (tap) await page.touchscreen.tap(box.x, box.y); else await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------- desktop, light: the default
{
  const { context, page, errors } = await open(DESK);
  const R = K.run(K.defaults(), null), q = R.transfer.sol;
  ok((await tileVal(page, 'Departure (UTC)')).startsWith('2026-07-02 14:00'), 'default departure is Aster\'s cell');
  ok(Math.abs(num(await tileVal(page, 'C3 at departure')) - q.c3 / 1e6) < 1e-4, 'C3 tile = kernel');
  ok((await tileVal(page, 'DLA (declination)')).includes('AMBER') && Math.abs(num(await tileVal(page, 'DLA (declination)')) - q.dlaDeg) < 0.01, 'DLA tile and band');
  ok(Math.abs(num(await tileVal(page, 'Arrival v∞')) - q.vInfArr / 1000) < 1e-4, 'arrival v-inf tile');
  ok(Math.abs(num(await tileVal(page, 'Aster\'s ΔV stack')) - q.dv.total_oneway_m_s / 1000) < 1e-3, 'delta-v stack tile');
  ok(Math.abs(num(await tileVal(page, 'Against Aster\'s cell')) - R.asterCell.dv_m_s * 1000) < 1e-3, 'Aster cell gap tile');
  const chips = await page.evaluate(() => [...document.querySelectorAll('#selTiles .tile')].every((t) => t.querySelector('.c')));
  ok(chips, 'every tile has a confidence chip');
  ok((await text(page, '#gridNote')).includes('10800 of 10800 cells solved') && (await text(page, '#gridNote')).includes('is refused'), 'grid note with the refused raw minimum');
  ok(await inkPixels(page, 'pork') > 10000 && await inkPixels(page, 'orbit') > 1000, 'both charts drawn');
  ok((await page.$$('#checkTable tbody tr')).length >= 9, 'oracle rows');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#checkTable tbody tr')].map((r) => r.textContent));
  ok(rows.some((r) => r.includes('is that window real?') && r.includes('refused')), 'Aster cache best window refused row');
  ok(rows.some((r) => r.includes('JPL\'s integrated orbit') && /[0-9] km/.test(r)), 'drift row present');
  ok(rows.some((r) => r.includes('Earth between Aster') && r.includes('9,786')), 'Earth C0 row');
  ok((await text(page, '#refusals')).includes('dynamics'), 'patched-conic refusal shown');
  ok(!(await page.evaluate(() => document.body.innerText.includes('NaN'))), 'no NaN');
  // click a cell: the tiles follow the kernel
  await clickCell(page, 30, 40);
  const sel = await page.evaluate(() => window.LambertsRoadPage.state.S.selection);
  const R2 = K.run(Object.assign(K.defaults(), { selection: sel }), null, { grid: false });
  ok(sel && sel.i === 30 && sel.j === 40, 'click selects that cell');
  ok(Math.abs(num(await tileVal(page, 'C3 at departure')) / (R2.transfer.sol.c3 / 1e6) - 1) < 6e-4, 'clicked C3 = kernel (4 significant figures)');
  // keyboard: one step right, then Enter refines
  await page.focus('#pork'); await page.keyboard.press('ArrowRight');
  ok((await page.evaluate(() => window.LambertsRoadPage.state.S.selection.i)) === 31, 'arrow key moves the selection');
  const before = await page.evaluate(() => window.LambertsRoadPage.state.R.transfer.sol.c3);
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.LambertsRoadPage.state.R.transfer.sol.c3);
  ok(after <= before + 1e-6 && (await text(page, '#status')).startsWith('Refined'), 'Enter refines');
  // the grid's best
  await page.click('#minBtn');
  ok(Math.abs(num(await tileVal(page, 'C3 at departure')) - R.grid.min.c3 / 1e6) < 1e-5, 'go to minimum = kernel grid minimum');
  ok((await text(page, '#selLine')).startsWith('The grid\'s best'), 'selection line');
  // objective and revolutions
  await page.click('[data-obj="dv_oneway"]');
  ok((await text(page, '#porkCap')).includes('ΔV one-way'), 'objective caption');
  await page.click('[data-revs="0"]');
  ok((await text(page, '#porkCap')).includes('direct transfers') && (await page.evaluate(() => window.LambertsRoadPage.state.R.transfer.M)) === 0, 'direct only');
  // another body
  await page.click('[data-tgt="101955"]');
  ok((await text(page, '#tgtInfo')).includes('Bennu') && await page.evaluate(() => document.getElementById('asterBtn').disabled), 'Bennu: no Aster cell');
  ok((await page.evaluate(() => [...document.querySelectorAll('#checkTable tbody tr')].filter((r) => r.textContent.includes('JPL mission design')).length)) >= 1, 'JPL rows for Bennu');
  // out of envelope: a flight time above the page's 3,000 days
  await page.fill('#tofZ', '5000'); await page.dispatchEvent('#tofZ', 'change');
  ok((await text(page, '#refusals')).includes('invalid_input') && !(await page.evaluate(() => document.body.innerText.includes('NaN'))), 'settings refusal, no NaN');
  await page.click('#resetBtn');
  ok((await tileVal(page, 'Departure (UTC)')).startsWith('2026-07-02 14:00'), 'reset');
  ok(errors.length === 0, 'desktop errors: ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desk.png'), fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- the chain: imports, exports, links
{
  const { context, page, errors } = await open(DESK);
  await page.fill('#importText', JSON.stringify(H38)); await page.click('#importBtn');
  ok((await text(page, '#status')).includes('does not depart'), 'import 38 sample');
  ok((await text(page, '#carriedSum')).match(/^1[0-9] refusals carried from ideas 33, 35, 36, 37, 38/), 'carried refusals: ' + await text(page, '#carriedSum'));
  ok((await text(page, '#refusals')).includes('chain_departure'), 'chain_departure refusal');
  const h38 = closingH38();
  await page.fill('#importText', JSON.stringify(h38)); await page.click('#importBtn');
  ok((await text(page, '#status')).includes('departs 2026-07-02 04:06'), 'import closing 38');
  ok(Math.abs(num(await tileVal(page, 'Correction to re-aim')) - 3.312) < 0.002, 're-aim correction tile');
  ok(Math.abs(num(await tileVal(page, 'Uncorrected, at arrival')) - 318455) < 50, 'uncorrected miss tile');
  ok(Math.abs(num(await tileVal(page, 'Before the transfer\'s epoch by')) - 9.88) < 0.01, 'hours early');
  ok((await page.evaluate(() => document.getElementById('orbitLegend').textContent)).includes('flown uncorrected'), 'flown arc in the orbit view');
  // download, parse back with the kernel
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const got = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const back = K.parseHandoff(got);
  ok(!back.refusal && got.outputs.chain_departure && Math.abs(got.outputs.chain_departure.value.reaimed.correction_magnitude_m_s - 3.312) < 0.002, 'download parses back: ' + (back.refusal && back.refusal.reason));
  // refused imports
  await page.fill('#importText', '{nope'); await page.click('#importBtn');
  ok((await text(page, '#status')).includes('not JSON'), 'garbage refused');
  await page.fill('#importText', JSON.stringify(H37)); await page.click('#importBtn');
  ok((await text(page, '#status')).includes('37-window'), '37 handoff refused');
  const ed = JSON.parse(JSON.stringify(got)); ed.outputs.transfer.value.time_of_flight_s += 86400;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn');
  ok((await text(page, '#status')).includes('Not imported'), 'edited 39 handoff refused');
  ok(errors.length === 0, 'chain errors: ' + errors.join(' | '));
  await context.close();
  // #h= links: this page's own, idea 38's, and an edited one
  for (const [label, h, expect] of [['own', got, 'identical'], ['38', h38, 'departs'], ['edited', ed, 'Not imported']]) {
    const o = await open(DESK, URL0 + '#h=' + b64(h));
    ok((await text(o.page, '#status')).includes(expect), '#h= ' + label + ': ' + await text(o.page, '#status'));
    if (label === 'own') ok((await tileVal(o.page, 'Correction to re-aim')) !== null, 'own link restores the chain');
    ok(o.errors.length === 0, '#h= ' + label + ' errors: ' + o.errors.join(' | '));
    await o.context.close();
  }
}

// ---------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 0, scheme + ' phone overflow ' + over);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const small = await page.evaluate(() => [...document.querySelectorAll('.legend li, .chart-cap, .tile .k, td, .note')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).length);
  ok(small === 0, scheme + ' text under 11 px: ' + small);
  await page.locator('#pork').scrollIntoViewIfNeeded();
  await clickCell(page, 10, 20, true);
  ok((await page.evaluate(() => window.LambertsRoadPage.state.S.selection && window.LambertsRoadPage.state.S.selection.i)) === 10, scheme + ' tap selects');
  ok(!(await page.evaluate(() => document.body.innerText.includes('NaN'))), scheme + ' no NaN');
  ok(errors.length === 0, scheme + ' phone errors: ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: false });
  await context.close();
}

await browser.close();
console.log(checks + ' checks, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
