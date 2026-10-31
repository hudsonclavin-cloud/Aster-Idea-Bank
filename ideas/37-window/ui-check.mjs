#!/usr/bin/env node
// Drives the Window page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by touch,
// light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/37-window/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const W = L.W;
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
const hms = (ms) => new Date(Math.round(ms)).toISOString().slice(11, 19);

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' / ')));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#apTable tbody tr').length > 0, null, { timeout: 30000 });
  return { context, page, errors };
}
const tileVal = (page, k) => page.evaluate((k) => { const t = [...document.querySelectorAll('#tiles .tile')].find((x) => x.querySelector('.k').textContent === k); return t ? t.querySelector('.v').textContent : null; }, k);
const noNaN = async (page, where) => { const t = await page.locator('main').innerText(); const bad = t.match(/.{0,60}(\bNaN\b|undefined|Infinity).{0,40}/); ok(!bad, where + ': no NaN/undefined on the page' + (bad ? ' (' + bad[0] + ')' : '')); };
const setNum = async (page, sel, v) => { await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); await page.waitForTimeout(150); };
const refusals = (page) => page.locator('#refusals .refusal').allInnerTexts();

// kernel expectations: the page's AS-512 default
const h36 = L.as512Handoff36(), st = W.importClosedLoop(h36), set = W.defaults(st.siteId), spec = W.apophisSpec();
const R = W.compute(st, spec, set), win = R.windows[0];

// ------------------------------------------------------------------ desktop, light
{
  const { context, page, errors } = await open(DESK);
  ok(await page.locator('#vehicle').inputValue() === 'as512', 'opens on AS-512');
  ok((await page.locator('#preApophis').getAttribute('aria-pressed')) === 'true', 'opens on the Apophis asymptote');
  ok(await tileVal(page, 'Launch') === hms(R.launch.ms) + 'UTC', 'launch tile is the kernel\'s window opening: ' + await tileVal(page, 'Launch'));
  ok(Math.abs(num(await tileVal(page, 'Azimuth')) - R.launch.azDeg) < 0.0006, 'azimuth tile');
  ok(Math.abs(num(await tileVal(page, 'Propellant left')) - R.flight.propellant) < 0.6, 'propellant tile is idea 36 re-flown');
  ok(Math.abs(num(await tileVal(page, 'Impulsive Δv')) - R.departure.dv) < 0.6, 'impulsive delta-v tile');
  ok((await page.locator('#tiles .tile .c').count()) === (await page.locator('#tiles .tile').count()), 'a confidence chip on every tile');
  // (independent review) the propellant left buys less than the impulsive departure needs: one refusal, for that
  const rf0 = await refusals(page);
  ok(rf0.length === 1 && /departure_propellant/.test(rf0[0]) && /cannot make this departure/.test(rf0[0]), 'the default carries the departure_propellant refusal only: ' + rf0.join(' | '));
  ok(Math.abs(num(await tileVal(page, 'Δv it buys')) - R.capacity.dv) < 0.6, 'delta-v tile is the kernel\'s capacity');
  ok((await page.locator('#tiles .tile.short').count()) === 1, 'the capacity tile is marked short');
  const v = await page.locator('#verdict').innerText();
  ok(/AMBER/.test(v) && v.includes(hms(win.openMs) + '–' + hms(win.closeMs)) && /eq\. 14/.test(v), 'verdict: Aster\'s band, the window, the split limit');
  ok((await page.locator('#oppSeg button').count()) === R.windows.length, 'a button per window');
  ok((await page.locator('#azChart path.line').count()) === 1 && (await page.locator('#azChart rect.win').count()) === 1, 'azimuth chart: the curve and the window');
  ok((await page.locator('#perfChart circle.pt').count()) === R.perf.length, 'a point per re-flown moment');
  ok((await page.locator('#skyChart circle').count()) === 3, 'sky: pad, asymptote, departure point');
  // Apollo 17 table
  const ap = W.apollo17(), rows = await page.locator('#apTable tbody tr').allInnerTexts();
  ok(rows.length === 6, 'six Apollo 17 rows');
  ok(/Table 16-7/.test(rows[5]) && rows[5].includes('3,129') && rows[5].includes('2,991'), 'the translunar-burn yardstick row: ' + rows[5].replace(/\s+/g, ' '));
  ok(rows[1].includes(hms(ap.predictedCloseMs)) && rows[1].includes('+369 s'), 'window close against the press kit: ' + rows[1].replace(/\s+/g, ' '));
  // the slider moves the launch inside the window, and the page re-flies the vehicle as the kernel does
  await page.locator('#fracRange').fill('0.5'); await page.waitForTimeout(300);
  const mid = W.compute(st, spec, Object.assign({}, set, { fraction: 0.5 }), { perf: false });
  ok(await tileVal(page, 'Launch') === hms(mid.launch.ms) + 'UTC', 'slider at 0.5 gives the kernel\'s launch');
  ok(Math.abs(num(await tileVal(page, 'Propellant left')) - mid.flight.propellant) < 0.6, 'and its propellant');
  ok(Math.abs(num(await tileVal(page, 'Δv it buys')) - mid.capacity.dv) < 0.6, 'and what it buys');
  const rfm = await refusals(page);
  ok(rfm.length === 1 && rfm[0].includes(String(Math.round(mid.departure.dv - mid.capacity.dv))), 'the refusal follows the moment: ' + rfm.join(' | '));
  // a tap inside the window on the azimuth chart, then the arrow keys
  await page.locator('#azChart').scrollIntoViewIfNeeded();
  const box = await page.locator('#azChart').boundingBox();
  const vb = await page.evaluate(() => document.getElementById('azChart').viewBox.baseVal.width);
  const xh = (h) => box.x + (46 + h / 24 * (vb - 46 - 12)) * box.width / vb;
  const before = await tileVal(page, 'Launch');
  await page.mouse.click(xh(4), box.y + box.height / 2); await page.waitForTimeout(300);
  const after = await tileVal(page, 'Launch');
  const secs = (t) => t.slice(0, 8).split(':').reduce((a, x) => 60 * a + +x, 0);
  ok(after !== before && Math.abs(secs(after) - 4 * 3600) < 120, 'tapping the chart at 4 h moves the launch there: ' + after);
  const fr = +(await page.locator('#fracRange').inputValue()), w0 = R.windows[0];
  ok(Math.abs(w0.openMs + fr * (w0.closeMs - w0.openMs) - (Date.UTC(2026, 6, 2) + secs(after) * 1000)) < 2000, 'the slider follows the tap');
  await page.locator('#azChart').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
  ok((await tileVal(page, 'Launch')) !== after, 'the arrow key moves it on');
  // J2 off: the window opens earlier by the kernel's 53.7 s
  await page.locator('#j2In').uncheck(); await page.waitForTimeout(500);
  ok((await page.locator('#verdict').innerText()).includes(hms(R.windowsNoJ2[0].openMs)), 'J2 off: the window the kernel gives without J2');
  await page.locator('#j2In').check(); await page.waitForTimeout(500);
  // the Apollo 17 preset: its two daily windows, the actual liftoff, the departure refused (C3 < 0)
  await page.click('#preApollo'); await page.waitForTimeout(600);
  const apv = await page.locator('#verdict').innerText();
  ok(apv.includes(hms(ap.predictedOpenMs) + '–' + hms(ap.predictedCloseMs)), 'Apollo 17: the fitted window ' + apv);
  ok(await tileVal(page, 'Launch') === '05:33:00UTC' && Math.abs(num(await tileVal(page, 'Azimuth')) - 91.504) < 0.0006, 'Apollo 17: liftoff 05:33:00 on 91.504 deg');
  ok((await refusals(page)).some((t) => /departure/.test(t) && /target vector/.test(t)), 'Apollo 17: the departure point is refused (C3 < 0)');
  await noNaN(page, 'Apollo 17');
  // a typed asymptote beyond the corridor's reach: refused, with eq. 14
  await page.click('#preApophis'); await page.waitForTimeout(500);
  await setNum(page, '#dlaIn', 70); await page.waitForTimeout(400);
  const rf = await refusals(page);
  ok(rf.length === 1 && /window/.test(rf[0]) && /eq\. 14/.test(rf[0]), 'DLA 70: no window, refused');
  ok((await page.locator('#tiles .tile').count()) === 0, 'no tiles on a refusal');
  await noNaN(page, 'DLA 70');
  // a date before the leap-second table: refused for the time, and the verdict does not claim there is no window
  await setNum(page, '#dateIn', '1965-01-01'); await page.waitForTimeout(400);
  ok((await refusals(page)).some((t) => /time/.test(t)) && !/no launch window/.test(await page.locator('#verdict').innerText()), 'pre-1972: time refused, no false "no window"');
  await setNum(page, '#dateIn', '2026-07-02'); await setNum(page, '#dlaIn', 70); await page.waitForTimeout(400);
  // the declination slider: at 10 deg the day has two windows
  await page.locator('#dlaRange').fill('10'); await page.waitForTimeout(900);
  ok((await page.locator('#oppSeg button').count()) === 2, 'DLA 10: two windows');
  await page.locator('#oppSeg button').nth(1).click(); await page.waitForTimeout(400);
  ok((await page.locator('#oppSeg button').nth(1).getAttribute('aria-pressed')) === 'true', 'the second window chosen');
  // the Apollo corridor on Apophis: no window
  await page.click('#preApophis'); await page.waitForTimeout(500);
  await page.click('[data-cor="apollo"]'); await page.waitForTimeout(500);
  ok((await refusals(page)).some((t) => /window/.test(t)), 'Apophis inside 72-100 deg: no window');
  await page.click('[data-cor="aster"]'); await page.waitForTimeout(500);
  // an invalid longitude is refused, not drawn
  await setNum(page, '#lonIn', ''); await page.waitForTimeout(300);
  ok((await refusals(page)).some((t) => /site/.test(t)), 'no longitude: refused');
  await noNaN(page, 'no longitude');
  await setNum(page, '#lonIn', W.PAD39A.lonDeg); await page.waitForTimeout(300);
  // the export is a 37 handoff carrying 36's that the kernel accepts; the next link and the download
  const ho = await page.evaluate(() => window.__window.state.handoff);
  ok(ho.from === '37-window' && ho.inputs.closed_loop_handoff.from === '36-closed-loop', 'export carries idea 36\'s handoff');
  const back = W.parseHandoff(ho);
  ok(!back.refusal, 'the kernel re-computes the page\'s handoff to the same numbers' + (back.refusal ? ': ' + back.refusal.reason : ''));
  ok((await page.locator('#nextLink').getAttribute('href')).startsWith('../38-burn-out/index.html#h='), 'link to module 38');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  ok(dl.suggestedFilename() === 'handoff.json', 'download');
  // the other vehicle
  await page.selectOption('#vehicle', 'sample'); await page.waitForTimeout(1500);
  ok(/6,578|200\.0/.test(await page.locator('#vehSource').innerText()) || /× 200/.test(await page.locator('#vehSource').innerText()), 'sample stack at Aster\'s parking orbit');
  ok(num(await tileVal(page, 'Propellant left')) < 3000, 'the sample stack has little left at Apophis\'s inclination');
  // imports: idea 36's committed sample, garbage, idea 35's handoff
  const h36s = fs.readFileSync(path.join(here, '..', '36-closed-loop', 'handoff.json'), 'utf8');
  await page.fill('#importText', h36s); await page.click('#importBtn'); await page.waitForTimeout(2500);
  ok(/Imported/.test(await page.locator('#status').innerText()), 'idea 36\'s committed handoff imports');
  await page.fill('#importText', '{"handoff": "nope"'); await page.click('#importBtn'); await page.waitForTimeout(200);
  ok(/Refused/.test(await page.locator('#status').innerText()), 'garbage refused');
  await page.fill('#importText', fs.readFileSync(path.join(here, '..', '35-max-q', 'handoff.json'), 'utf8')); await page.click('#importBtn'); await page.waitForTimeout(400);
  ok(/idea 36/.test(await page.locator('#status').innerText()), 'idea 35\'s handoff refused, pointing at idea 36');
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png'), fullPage: true });
  await context.close();
}

// ------------------------------------------------------------------ links: idea 36's handoff and this page's own
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(h36));
  ok(/Imported from the link/.test(await page.locator('#status').innerText()), 'opens on idea 36\'s link');
  const own = await page.evaluate(() => window.__window.state.handoff);
  await context.close();
  const o2 = await open(DESK, URL0 + '#h=' + b64(own));
  ok(/this page's handoff, re-checked/.test(await o2.page.locator('#status').innerText()), 'this page\'s own handoff round-trips through #h=');
  ok(Math.abs(num(await o2.page.locator('#dlaIn').inputValue()) - R.asym.dlaDeg) < 0.001, 'with its asymptote');
  const ed = JSON.parse(JSON.stringify(own)); ed.outputs.launch.value.azimuth_deg += 0.01;
  await o2.page.fill('#importText', JSON.stringify(ed)); await o2.page.click('#importBtn'); await o2.page.waitForTimeout(1500);
  ok(/Refused/.test(await o2.page.locator('#status').innerText()) && /edited/.test(await o2.page.locator('#status').innerText()), 'an edited handoff is refused');
  ok(errors.length === 0 && o2.errors.length === 0, 'links: no console errors ' + errors.concat(o2.errors).join(' | '));
  await o2.context.close();
}

// ------------------------------------------------------------------ phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, scheme + ' phone: no horizontal overflow (' + over + ')');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const minText = await page.evaluate(() => Math.min(...[...document.querySelectorAll('svg.chartsvg text')].map((t) => t.getBoundingClientRect().height)));
  ok(minText >= 11, scheme + ' phone: chart text at least 11 px (' + minText.toFixed(1) + ')');
  const off = await page.evaluate(() => [...document.querySelectorAll('.tile, td, button, input, select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + 1 || r.left < -1); }).length);
  ok(off === 0, scheme + ' phone: every tile, cell and control on screen (' + off + ')');
  // touch: tap inside the window on the chart
  await page.locator('#azChart').scrollIntoViewIfNeeded();
  const box = await page.locator('#azChart').boundingBox(), before = await tileVal(page, 'Launch');
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height / 2); await page.waitForTimeout(400);
  ok((await tileVal(page, 'Launch')) !== before, scheme + ' phone: a tap on the chart moves the launch');
  await noNaN(page, scheme + ' phone');
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`${checks - failures} of ${checks} UI checks pass`);
process.exit(failures ? 1 : 0);
