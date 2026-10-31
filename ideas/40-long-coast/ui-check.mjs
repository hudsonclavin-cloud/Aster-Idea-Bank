#!/usr/bin/env node
// Drives the Long Coast page in headless Chromium as a person would (desktop by mouse, phone by touch, light and dark)
// and compares its numbers with the kernel's. Run from the bank root:
//   node ideas/40-long-coast/ui-check.mjs [--shots <dir>]
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
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const H39 = fs.readFileSync(path.join(here, '..', '39-lamberts-road', 'handoff.json'), 'utf8');
const H40 = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H38 = fs.readFileSync(path.join(here, '..', '38-burn-out', 'handoff.json'), 'utf8');

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' / ')));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await settle(page);
  return { context, page, errors };
}
async function settle(page) {
  await page.waitForFunction(() => { const s = window.LongCoastPage && window.LongCoastPage.state; return s && s.R && !document.querySelector('main').classList.contains('busy') && document.querySelectorAll('#checkTable tbody tr').length > 0; }, null, { timeout: 60000 });
}
const tileVal = (page, key) => page.evaluate((k) => { const t = [...document.querySelectorAll('.tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t ? t.querySelector('.v').textContent : null; }, key);
const ink = (page, id) => page.evaluate((i) => { const c = document.getElementById(i), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 16) if (d[k] > 0) n++; return n; }, id);

// the kernel's own numbers for the default (the chain's Apophis cell made by idea 39's kernel, this page's defaults)
const P = require(path.join(here, 'presets.js')).list[0];
const src = K.importLambertsRoad(K.lambertsRoadFrom(P.settings)), R = K.run(src, K.defaults());

// ---------------------------------------------------------------- desktop, light: the default
{
  const { context, page, errors } = await open(DESK);
  ok(Math.abs(num(await tileVal(page, 'Re-aimed injection')) - R.reaim.dvinf_m_s) < 0.1, 're-aim tile');
  ok(Math.abs(num(await tileVal(page, 'TCM-1 if the departure')) - R.tcm1AsGiven.dv_m_s) < 0.5, 'TCM-1 as given tile');
  ok(Math.abs(num(await tileVal(page, 'TCM budget')) - R.budget.totalP99_m_s) < 0.1, 'budget tile');
  ok(Math.abs(num(await tileVal(page, 'Kepler')) - R.target.shift_m / 1e3) < 100, 'target shift tile');
  const deliv = await tileVal(page, 'Delivery');
  ok(Math.abs(num(deliv.split('×')[0]) - R.delivery.dispersion.semiMajor3s_m / 1e3) < 0.1, 'delivery tile ' + deliv);
  ok(await page.evaluate(() => [...document.querySelectorAll('.tile .c')].length >= 9), 'confidence chips');
  for (const id of ['uncChart', 'tcmChart', 'orbitChart', 'bpChart']) ok((await ink(page, id)) > 200, 'chart drawn ' + id);
  ok((await page.$$eval('#tcmTable tbody tr', (r) => r.length)) === 6, 'TCM table rows');
  ok((await page.$$eval('#checkTable tbody tr', (r) => r.length)) >= 12, 'oracle rows');
  const gaps = await page.$$eval('#checkTable td.gap-bad', (r) => r.length); ok(gaps === 0, 'no oracle gap flagged ' + gaps);
  const own = await page.$$eval('#refusals .refusal', (r) => r.map((x) => x.textContent));
  ok(own.some((t) => /srp/.test(t)) && own.some((t) => /target_knowledge/.test(t)), 'own refusals shown');
  // a slider: no Delta-DOR widens the delivery
  await page.fill('#ddorIn', '0'); await page.dispatchEvent('#ddorIn', 'change'); await settle(page);
  const d0 = num((await tileVal(page, 'Delivery')).split('×')[0]);
  ok(d0 > 3 * R.delivery.dispersion.semiMajor3s_m / 1e3, 'no DDOR widens delivery ' + d0);
  // the aim: TCM-1 carries the deterministic correction
  await page.click('[data-aim="tcm1"]'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'TCM budget')) - K.run(src, Object.assign(K.defaults(), { aim: 'tcm1', nav: Object.assign(K.navPreset('lucy'), { ddorPerWeek: 0 }) })).budget.totalP99_m_s) < 0.5, 'tcm1 aim budget');
  ok(!(await page.$('.tile .k') && (await tileVal(page, 'Re-aimed injection'))), 'no re-aim tile in tcm1 mode');
  // the oracle fit on OSIRIS-APEX
  await page.click('#apexBtn'); await page.waitForFunction(() => document.querySelectorAll('#checkTable tbody tr').length >= 15, null, { timeout: 60000 });
  const apex = await page.$$eval('#checkTable tbody tr', (r) => r.slice(-2).map((x) => x.textContent));
  ok(/Cr A\/m = 0\.01[3-5]/.test(apex[0]), 'OSIRIS-APEX fit ' + apex[0].slice(0, 160));
  // a preset that the page refuses part of (2000 SG344: patched conic is no starting point), from the defaults
  await page.click('#resetBtn'); await settle(page);
  await page.selectOption('#presetSel', '2000 SG344'); await settle(page);
  const own2 = await page.$$eval('#refusals .refusal', (r) => r.map((x) => x.textContent));
  ok(own2.some((t) => /patched_conic/.test(t)), 'SG344 refused patched conic');
  // reset
  await page.click('#resetBtn'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'TCM budget')) - R.budget.totalP99_m_s) < 0.1, 'reset');
  // export: download parses back through the kernel
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  const pd = K.parseHandoff(txt); ok(!pd.refusal, 'downloaded handoff parses ' + (pd.refusal ? pd.refusal.reason : ''));
  // import idea 39's committed sample: 15 refusals carried in, the same numbers as the committed handoff.json
  await page.fill('#importText', H39); await page.click('#importBtn'); await settle(page);
  ok(/Imported/.test(await page.textContent('#hoStatus')), 'imported 39 sample');
  ok(/15 refusals carried in/.test(await page.textContent('#srcLine')), 'carried count ' + (await page.textContent('#srcLine')));
  const h40 = JSON.parse(H40);
  ok(Math.abs(num(await tileVal(page, 'TCM budget')) - h40.outputs.tcm_budget.value.total_p99_m_s) < 0.1, 'chain budget equals the committed handoff');
  ok((await page.$$eval('#carriedList .refusal', (r) => r.length)) === 13, 'carried list (13: idea 39\'s 15 less dynamics and post_cutoff)');
  // garbage, idea 38's handoff and an edited 40 handoff are refused
  await page.fill('#importText', '{nope'); await page.click('#importBtn');
  ok(/Refused/.test(await page.textContent('#hoStatus')), 'garbage refused');
  await page.fill('#importText', H38); await page.click('#importBtn');
  ok(/idea 39/.test(await page.textContent('#hoStatus')), '38 refused');
  const ed = JSON.parse(H40); ed.outputs.tcm_budget.value.total_p99_m_s += 1;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn');
  ok(/edited/.test(await page.textContent('#hoStatus')), 'edited 40 refused');
  // a refused setting: TCM-1 beyond the cruise
  await page.fill('.tDays[data-i="0"]', '900'); await page.dispatchEvent('.tDays[data-i="0"]', 'change'); await settle(page);
  ok(/outside/.test(await page.textContent('#refusals')) && (await page.$$eval('#tiles .tile', (t) => t.length)) === 0, 'settings refusal, no stale tiles');
  await page.click('#dlBtn'); ok(/Nothing to export/.test(await page.textContent('#hoStatus')), 'nothing to export');
  ok(errors.length === 0, 'desktop errors: ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png'), fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- #h= links: the committed 40 sample, and idea 39's
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(H40));
  ok(/idea 40/.test(await page.textContent('#srcLine')), '#h= 40 link');
  ok(Math.abs(num(await tileVal(page, 'TCM budget')) - JSON.parse(H40).outputs.tcm_budget.value.total_p99_m_s) < 0.1, '#h= 40 numbers');
  await page.goto(URL0 + '#h=' + b64(H39)); await settle(page);
  ok(/idea 39/.test(await page.textContent('#srcLine')), '#h= 39 link');
  ok(errors.length === 0, 'link errors: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- phone, dark and light: layout, touch
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, scheme + ' phone overflow ' + over);
  const small = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.offsetParent && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.5).length);
  ok(small === 0, scheme + ' text under 11 px: ' + small);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? /rgb\(13, 13, 13\)/.test(bg) : /rgb\(249, 249, 247\)/.test(bg), scheme + ' background ' + bg);
  await page.locator('[data-tgt="two_body"]').tap(); await settle(page);
  ok(await page.evaluate(() => window.LongCoastPage.state.S.target === 'two_body'), scheme + ' tap target');
  const txt = await page.textContent('main'); ok(!/NaN|undefined/.test(txt), scheme + ' NaN or undefined on the page');
  for (const id of ['uncChart', 'orbitChart']) ok((await ink(page, id)) > 100, scheme + ' phone chart ' + id);
  ok(errors.length === 0, scheme + ' phone errors: ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  await context.close();
}

await browser.close();
console.log((failures ? 'FAILED ' : 'ok ') + (checks - failures) + ' of ' + checks + ' ui checks');
process.exit(failures ? 1 : 0);
