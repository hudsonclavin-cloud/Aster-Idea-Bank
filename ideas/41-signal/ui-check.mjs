#!/usr/bin/env node
// Drives the Signal page in headless Chromium as a person would (desktop by mouse, phone by touch, light and dark) and
// compares its numbers with the kernel's. Run from the bank root: node ideas/41-signal/ui-check.mjs [--shots <dir>]
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
const SAMPLE = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H40path = path.join(here, '..', '40-long-coast', 'handoff.json'), H40 = fs.existsSync(H40path) ? fs.readFileSync(H40path, 'utf8') : null;

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await settle(page);
  return { context, page, errors };
}
async function settle(page) {
  await page.waitForTimeout(50);
  await page.waitForFunction(() => { const s = window.SignalPage && window.SignalPage.st; return s && s.R && !document.querySelector('main').classList.contains('busy') && document.querySelectorAll('#checkTable tbody tr').length > 0; }, null, { timeout: 60000 });
}
const tileVal = (page, key) => page.evaluate((k) => { const t = [...document.querySelectorAll('.tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t ? t.querySelector('.v').textContent : null; }, key);
const ink = (page, id) => page.evaluate((i) => { const c = document.getElementById(i), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 16) if (d[k] > 0) n++; return n; }, id);
const refusals = (page) => page.evaluate(() => [...document.querySelectorAll('#refusals .refusal b')].map((b) => b.textContent));

// the kernel's own numbers for the default: idea 40's Apophis preset, Dawn's radio, the 34-m subnet
const src = K.fromPreset('99942'), R = K.run(src, K.defaults('dawn', src.R40.S.nav)), A = R.arrival;

// ---------------------------------------------------------------- desktop, light: the default
{
  const { context, page, errors } = await open(DESK);
  ok(Math.abs(num(await tileVal(page, 'Distance at arrival')) - A.range_m / K.AU) < 1e-4, 'distance tile');
  ok(Math.abs(num(await tileVal(page, 'One-way light time')) - A.owlt_s / 60) < 1e-3, 'light time tile');
  ok(Math.abs(num(await tileVal(page, 'Command round trip')) - A.rtlt_s / 60) < 1e-2, 'round trip tile');
  ok(Math.abs(num(await tileVal(page, 'Pt/No at arrival')) - A.dct.lines.ptn0_dBHz) < 0.01, 'Pt/No tile');
  ok((await tileVal(page, 'Data rate at arrival')).startsWith('123.8'), 'rate tile');
  ok((await tileVal(page, 'Receiver overload days')) === String(R.totals.saturation_days), 'saturation days');
  for (const id of ['rangeChart', 'sunChart', 'linkChart', 'rateChart', 'viewChart']) ok((await ink(page, id)) > 500, id + ' drawn');
  ok((await page.locator('#checkTable tbody tr').count()) >= 17, 'oracle rows');
  ok((await page.locator('#checkTable').textContent()).includes('Juno DCT'), 'Juno row');
  ok((await page.locator('#dctTable tbody tr').count()) > 25, 'DCT lines');
  ok((await page.locator('#rateTable tbody tr').count()) === 7, 'Dawn\'s seven rates');
  const own = await refusals(page);
  ok(own.some((t) => t.includes('spacecraft')) && own.some((t) => t.includes('uplink')) && own.some((t) => t.includes('saturation')), 'own refusals: ' + own.join(' | '));
  // pick a day by clicking the range chart: the DCT follows
  const before = await page.locator('#dayLabel').textContent();
  await page.locator('#rangeChart').scrollIntoViewIfNeeded(); const box = await page.locator('#rangeChart').boundingBox();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
  ok((await page.locator('#dayLabel').textContent()) !== before, 'a click picks a day');
  // Deep Impact's radio: a smaller dish and less power: a lower rate, equal to the kernel's
  await page.selectOption('#craftSel', 'di'); await settle(page);
  const Rdi = K.run(src, Object.assign(K.defaults('di', src.R40.S.nav), { stayDays: 365 }));
  ok(num(await tileVal(page, 'Data rate at arrival')) === +(Rdi.arrival.dct.best.bps / 1e3).toPrecision(4), 'DI rate ' + (await tileVal(page, 'Data rate at arrival')) + ' vs ' + Rdi.arrival.dct.best.bps);
  // the 70-m antennas: about 6 dB more
  const p34 = num(await tileVal(page, 'Pt/No at arrival'));
  await page.click('[data-ant="70m"]'); await settle(page);
  ok(num(await tileVal(page, 'Pt/No at arrival')) - p34 > 5, '70 m is louder');
  // Ka band (34 m only): its own refusal
  await page.click('[data-band="Ka"]'); await settle(page);
  ok((await refusals(page)).some((t) => t.includes('ka_band')), 'Ka refusal');
  ok((await page.locator('[data-ant="34m"]').getAttribute('aria-pressed')) === 'true', 'Ka switches to 34 m');
  // a margin outside the envelope: refused, no tiles
  await page.fill('#marIn', '20'); await page.waitForTimeout(400); await settle(page);
  ok((await page.locator('.tile').count()) === 0 && (await refusals(page)).some((t) => t.includes('invalid_input')), 'margin 20 refused');
  await page.click('#resetBtn'); await settle(page);
  ok((await tileVal(page, 'Data rate at arrival')).startsWith('123.8'), 'reset');
  // Eros: a superior conjunction, 13 days blacked out at X
  await page.selectOption('#presetSel', '433'); await settle(page);
  ok((await tileVal(page, 'Blacked-out days')) === '13', 'Eros blackout days');
  ok((await page.locator('#conjTable').textContent()).includes('2029-01-08'), 'Eros conjunction row');
  ok((await page.locator('#conjTable').textContent()).includes('superior'), 'superior');
  // export: the page's handoff, read back by the kernel in Node
  const dl = page.waitForEvent('download'); await page.click('#dlBtn'); const file = await (await dl).path();
  const P = K.parseHandoff(fs.readFileSync(file, 'utf8'));
  ok(!P.refusal, 'browser export parses in Node' + (P.refusal ? ': ' + P.refusal.reason : ''));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desk-eros.png'), fullPage: true });
  // imports: idea 40's committed handoff, garbage, a stranger
  if (H40) {
    await page.fill('#importText', H40); await page.click('#importBtn'); await settle(page);
    ok((await page.locator('#hoStatus').textContent()).startsWith('Imported'), 'idea 40\'s handoff imported');
    ok((await page.locator('#carriedSum').textContent()).startsWith('16 '), '16 refusals carried: ' + (await page.locator('#carriedSum').textContent()));
  }
  await page.fill('#importText', '{"handoff":"long-way-round","from":"39-lamberts-road"}'); await page.click('#importBtn'); await page.waitForTimeout(200);
  ok((await page.locator('#hoStatus').textContent()).includes('idea 40'), '39 refused, pointing to 40');
  await page.fill('#importText', 'not json'); await page.click('#importBtn'); await page.waitForTimeout(200);
  ok((await page.locator('#hoStatus').textContent()).startsWith('Refused'), 'garbage refused');
  ok(errors.length === 0, 'desktop console: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- a link carrying this page's sample handoff
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(SAMPLE));
  ok((await page.locator('#srcLine').textContent()).includes('Imported (link)'), 'link import');
  ok(Math.abs(num(await tileVal(page, 'Pt/No at arrival')) - A.dct.lines.ptn0_dBHz) < 0.01, 'link: the sample\'s Pt/No');
  ok(errors.length === 0, 'link console: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, scheme + ' phone: no overflow');
  const small = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.offsetParent && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).length);
  ok(small === 0, scheme + ' phone: no text under 11 px (' + small + ')');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const before = await page.locator('#dayLabel').textContent();
  await page.locator('#sunChart').scrollIntoViewIfNeeded(); const box = await page.locator('#sunChart').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height / 2);
  ok((await page.locator('#dayLabel').textContent()) !== before, scheme + ' phone: a tap picks a day');
  ok(!(await page.locator('main').textContent()).includes('NaN'), scheme + ' phone: no NaN');
  for (const id of ['rangeChart', 'linkChart']) ok((await ink(page, id)) > 300, scheme + ' ' + id);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  ok(errors.length === 0, scheme + ' phone console: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks pass`);
process.exit(failures ? 1 : 0);
