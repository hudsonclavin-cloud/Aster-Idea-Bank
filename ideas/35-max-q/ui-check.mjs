#!/usr/bin/env node
// Drives the Max Q page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by touch,
// light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/35-max-q/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const { A, T512 } = L;
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

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForTimeout(400);
  return { context, page, errors };
}
const tileVal = (page, k) => page.evaluate((k) => { const t = [...document.querySelectorAll('#tiles .tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t ? t.querySelector('.v').textContent : null; }, k);
const tileSub = (page, k) => page.evaluate((k) => { const t = [...document.querySelectorAll('#tiles .tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t && t.querySelector('.sub') ? t.querySelector('.sub').textContent : null; }, k);
const noNaN = async (page, where) => { const t = await page.locator('main').innerText(); ok(!/\bNaN\b|undefined|Infinity/.test(t), where + ': no NaN/undefined on the page'); };
const refusalText = (page) => page.locator('#refusals').innerText();
const setNum = async (page, sel, v) => { await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); await page.waitForTimeout(60); };

// kernel expectations: the page's AS-512 default (flight-average flow, kick fitted, upper stages solved level)
function as512Ref(cal) {
  const v = A.vehicleFromHandoff(L.H34AS512), p = A.defaultPlan(v.vehicle);
  if (cal) p.flowScale[0] = A.as512FlowScale(v.engines);
  p.kickDeg = A.solveKick(v.vehicle, v.engines, p, T512.cutoff.sicOeco.fpa).kickDeg;
  p.upper.startDeg = A.solveInsertion(v.vehicle, v.engines, p).pitchDeg;
  return { v, p, r: A.fly(v.vehicle, v.engines, p) };
}
const REF = as512Ref(true), REF0 = as512Ref(false);

// ------------------------------------------------------------------ desktop, light
{
  const { context, page, errors } = await open(DESK);
  ok(await page.locator('#vehicle').inputValue() === 'as512', 'opens on AS-512');
  ok(Math.abs(num(await tileVal(page, 'Max Q')) - REF.r.maxQ.q / 1000) < 0.006, `max Q tile ${await tileVal(page, 'Max Q')} = kernel ${REF.r.maxQ.q / 1000}`);
  ok(Math.abs(num(await tileVal(page, 'Mach 1')) - REF.r.mach1.t) < 0.06, 'Mach 1 tile = kernel');
  ok(Math.abs(num(await tileVal(page, 'Burnout altitude')) - REF.r.final.altitude / 1000) < 0.06, 'burnout altitude = kernel');
  ok(Math.abs(num(await tileVal(page, 'Burnout speed')) - REF.r.final.speed / 1000) < 0.0006, 'burnout speed = kernel');
  ok(Math.abs(num(await tileVal(page, 'Earth\'s spin')) - REF.r.v0) < 0.06, 'rotation tile = omega R cos(lat)');
  ok((await tileVal(page, 'Orbit')) === 'not in orbit', 'AS-512 open loop: not in orbit, said so');
  ok(/orbit: refused/.test(await refusalText(page)), 'the orbit refusal is shown');
  ok((await page.locator('#tiles .tile .c').count()) === (await page.locator('#tiles .tile').count()), 'a confidence chip on every tile');
  ok(Math.abs(num(await page.locator('#kickNum').inputValue()) - REF.p.kickDeg) < 1e-3, 'kick solved on load = kernel');
  ok(/Table 4-2/.test(await page.locator('#kickNote').innerText()), 'the fitted number is named');
  // the record table: one row per kernel row, the fitted row highlighted
  const rows = A.as512Rows(REF.r, Object.assign({ fitKick: true, fitInsertion: true }, REF.p));
  ok((await page.locator('#tblRecord tbody tr').count()) === rows.length, 'record table has every comparison');
  ok((await page.locator('#tblRecord tbody tr.hl').count()) >= 1, 'fitted rows highlighted');
  ok(/-4\.4 %/.test(await page.locator('#recordSummary').innerText()), 'max-Q gap in the summary');
  // stage table: three cutoffs
  ok((await page.locator('#stageTable tbody tr').count()) === 3, 'three cutoffs in the ascent');
  ok(/S-IVB burn 2/.test(await page.locator('#warnings').innerText()), 'the restart is named as not flown');
  // the chart: every metric draws, flight points for AS-512, tap and keys read a point
  for (const m of ['q', 'alt', 'v', 'a', 'mach']) {
    await page.click(`[data-metric="${m}"]`); await page.waitForTimeout(40);
    const d = await page.locator('#chart path.line').first().getAttribute('d');
    ok(d && d.split('L').length > 20, m + ': a line is drawn');
    ok((await page.locator('#chart circle.flight').count()) >= 1, m + ': flight points drawn');
  }
  await page.click('[data-metric="q"]');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5); await page.waitForTimeout(40);
  ok(await page.locator('#tip').isVisible(), 'clicking the chart shows a read-out');
  const t1 = await page.locator('#tip').innerText();
  await page.focus('#chart'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(40);
  ok((await page.locator('#tip').innerText()) !== t1, 'arrow keys move the read-out');
  // the budget: both accountings, every row
  ok((await page.locator('#wf .wfrow').count()) === 9, 'Earth-relative budget rows');
  await page.click('[data-budget="inertial"]'); await page.waitForTimeout(40);
  ok((await page.locator('#wf .wfrow').count()) === 7, 'inertial budget rows');
  ok(/closes to/.test(await page.locator('#wfCap').innerText()), 'closure stated');
  // F-1 flow: idea 33's engine (kick and upper stages re-solved)
  await page.click('[data-cal="model"]'); await page.waitForTimeout(150);
  ok(Math.abs(num(await tileVal(page, 'Max Q')) - REF0.r.maxQ.q / 1000) < 0.006, `idea 33's F-1: max Q ${await tileVal(page, 'Max Q')} = kernel ${REF0.r.maxQ.q / 1000}`);
  await page.click('[data-cal="flight"]'); await page.waitForTimeout(150);
  // the kick by keyboard on its slider, then a typed kick that brings it down
  await page.focus('#kickRange'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60);
  const k2 = num(await page.locator('#kickNum').inputValue());
  ok(Math.abs(k2 - REF.p.kickDeg) > 1e-4 && (await page.locator('#kickNote').innerText()) === '', 'kick slider by keyboard; the fit note clears');
  const pk = Object.assign({}, REF.p, { kickDeg: k2 }), rk = A.fly(REF.v.vehicle, REF.v.engines, pk);
  ok(rk.ok && Math.abs(num(await tileVal(page, 'Max Q')) - rk.maxQ.q / 1000) < 0.006, 'max Q after the kick = kernel');
  await setNum(page, '#kickNum', 5);
  ok(/comes back to the ground/.test(await refusalText(page)), 'a 5 deg kick is refused: it comes down');
  ok((await tileVal(page, 'Ascent')) === 'refused', 'no numbers when refused');
  await page.click('#solveKick'); await page.waitForTimeout(200);
  ok(Math.abs(num(await page.locator('#kickNum').inputValue()) - REF.p.kickDeg) < 1e-3, 'Solve restores the fitted kick');
  // throttle bucket: band drawn, max Q lower; out-of-deck level refused
  const q0 = num(await tileVal(page, 'Max Q'));
  await page.check('#bucketOn'); await page.waitForTimeout(80);
  ok((await page.locator('#chart rect.bucket').count()) === 1, 'bucket band drawn');
  ok(num(await tileVal(page, 'Max Q')) < q0, 'the bucket lowers max Q');
  ok(/Solved/.test(await page.locator('#kickNote').innerText()), 'the fitted kick is re-solved with the bucket');
  await setNum(page, '#bLevelNum', 30);
  ok(/outside the first stage engine's deck/.test(await refusalText(page)), 'a 30 % throttle is refused (idea 33\'s deck starts at 40 %)');
  await setNum(page, '#bLevelNum', 70);
  await page.uncheck('#bucketOn'); await page.waitForTimeout(80);
  // azimuth outside the corridor
  await setNum(page, '#azNum', 150);
  ok(/range-safety corridor/.test(await refusalText(page)), 'azimuth outside Cape Canaveral\'s corridor refused');
  await setNum(page, '#azNum', T512.flightAzimuthDeg);
  // upper stages: gravity turn disables the solve; linear + solve says Solved
  await page.click('[data-upper="gravity"]'); await page.waitForTimeout(80);
  ok(await page.locator('#solveLevel').isDisabled(), 'gravity turn: nothing to solve');
  await page.click('[data-upper="linear"]'); await page.click('#solveLevel'); await page.waitForTimeout(250);
  ok(/Solved/.test(await page.locator('#upperNote').innerText()), 'solve for a level burnout');
  ok(Math.abs(num(await tileSub(page, 'Burnout altitude').then((s) => s.split('angle ')[1]))) < 0.01, 'level burnout shown');
  // Earth rotation off: no spin
  await page.uncheck('#rotation'); await page.waitForTimeout(80);
  ok(num(await tileVal(page, 'Earth\'s spin')) === 0, 'rotation off: the pad does not move');
  await page.check('#rotation'); await page.waitForTimeout(80);
  // drag off: zero drag in the budget
  await page.click('[data-drag="none"]'); await page.waitForTimeout(80);
  ok(/drag 0\.0,/.test(await tileSub(page, 'Lost to gravity')), 'no drag');
  // review: with drag off the page said max Q 0.00 kPa and Mach 1 "never"; q and Mach belong to the flight
  { const p0 = JSON.parse(JSON.stringify(await page.evaluate(() => window.__maxq.cur.plan))); const rN = A.fly(REF.v.vehicle, REF.v.engines, p0);
    ok(num(await tileVal(page, 'Max Q')) > 30 && Math.abs(num(await tileVal(page, 'Max Q')) - rN.maxQ.q / 1000) < 0.006, 'no drag: max Q is still the flight\'s (' + (await tileVal(page, 'Max Q')) + ' kPa)');
    ok(Math.abs(num(await tileVal(page, 'Mach 1')) - rN.mach1.t) < 0.06, 'no drag: Mach 1 is still reached'); }
  await page.click('[data-drag="forebody"]'); await page.waitForTimeout(80);
  // review: an absurd diameter is refused as drag the integrator cannot follow, not handed on as an escape
  await setNum(page, '#diaNum', 100000); await page.waitForTimeout(150);
  ok(/drag: refused/.test(await refusalText(page)) && !/escapes/.test(await refusalText(page)), 'a 100 km diameter is refused, not an escape');
  await setNum(page, '#diaNum', REF.p.diameter);
  // review: an empty bucket throttle said "Throttle NaN %"
  await page.check('#bucketOn'); await page.waitForTimeout(100); await setNum(page, '#bLevelNum', '');
  ok(/throttle: refused/.test(await refusalText(page)) && !/NaN/.test(await refusalText(page)), 'an empty bucket throttle is refused without NaN');
  await page.uncheck('#bucketOn'); await page.waitForTimeout(150);
  // export: a 35-max-q handoff equal to the kernel's
  const h = JSON.parse(await page.locator('#exportText').inputValue());
  ok(h.from === '35-max-q' && h.inputs.vehicle_handoff.from === '34-stack', 'export is a 35 handoff carrying 34\'s');
  const back = A.parseHandoff(h);
  ok(!back.refusal && Math.abs(back.result.final.speed - h.outputs.burnout_speed_inertial.value) < 1e-6, 'the export re-flies to its own numbers in the kernel');
  ok(/#h=/.test(await page.locator('#nextLink').getAttribute('href')), 'next-module link carries the handoff');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  ok(dl.suggestedFilename() === 'handoff.json', 'download handoff.json');
  // import: idea 34's sample (a vehicle), then refusals
  await page.fill('#importText', JSON.stringify(L.H34)); await page.click('#importBtn'); await page.waitForTimeout(300);
  ok(/Imported/.test(await page.locator('#importStatus').innerText()) && (await page.locator('#vehicle').inputValue()) === 'imp', 'idea 34\'s sample imports');
  ok(/Load "Saturn V AS-512/.test(await page.locator('#recordSummary').innerText()), 'no flight comparison for another vehicle');
  ok((await page.locator('#chart circle.flight').count()) === 0, 'no flight points for another vehicle');
  const ed = JSON.parse(JSON.stringify(L.H34AS512)); ed.outputs.delta_v_ideal.value += 5;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn'); await page.waitForTimeout(100);
  ok(/Refused \(invalid_input\)/.test(await page.locator('#importStatus').innerText()), 'an edited 34 handoff is refused');
  const h33 = Object.values(L.H34.inputs.engines).find((e) => e.engine_handoff).engine_handoff;
  await page.fill('#importText', JSON.stringify(h33)); await page.click('#importBtn'); await page.waitForTimeout(100);
  ok(/Refused \(insufficient_data\)/.test(await page.locator('#importStatus').innerText()), 'an engine (idea 33) is not a vehicle');
  await page.fill('#importText', 'not json'); await page.click('#importBtn'); await page.waitForTimeout(100);
  ok(/Refused/.test(await page.locator('#importStatus').innerText()), 'garbage refused');
  // review: idea 34's export of an edited Saturn V (payload 10 % lighter, made by idea 34's own kernel) opened on
  // "Ascent refused": the 1-degree default kick brought it down. It now solves the kick, then the level burnout.
  { const L34 = require(path.join(here, '..', '34-stack', 'load.cjs'));
    const v34 = L34.S.fromAS512(L34.AS512), e34 = L34.S.as512Engines(); v34.payload.mass = Math.round(v34.payload.mass * 0.9);
    await page.fill('#importText', JSON.stringify(L34.S.makeHandoff(v34, e34, L34.S.evaluate(v34, e34), { produced: 'x' }))); await page.click('#importBtn'); await page.waitForTimeout(2500);
    ok(/Imported/.test(await page.locator('#importStatus').innerText()) && !/the flight report's/.test(await page.locator('#vehicle').innerText()), 'an edited AS-512 from idea 34 imports, demoted');
    ok((await tileVal(page, 'Ascent')) === null && num(await tileVal(page, 'Max Q')) > 0, 'and flies: ' + (await refusalText(page)).slice(0, 80)); }
  await noNaN(page, 'desktop');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png'), fullPage: true });
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------ links: idea 34's #h= and this page's own
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(L.H34AS512));
  ok(/from the link/.test(await page.locator('#importStatus').innerText()), 'idea 34\'s #h= link imports');
  ok(/the flight report's/.test(await page.locator('#vehicle').innerText()), 'an unedited AS-512 keeps its name');
  ok(Math.abs(num(await tileVal(page, 'Max Q')) - REF.r.maxQ.q / 1000) < 0.006, 'idea 34\'s AS-512 link flies the default plan');
  const own = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  await page.goto(URL0 + '#h=' + b64(own)); await page.reload(); await page.waitForTimeout(400);
  ok(Math.abs(num(await tileVal(page, 'Max Q')) - own.outputs.max_dynamic_pressure.value / 1000) < 0.006, 'this module\'s own handoff round-trips through #h=');
  ok(Math.abs(num(await page.locator('#kickNum').inputValue()) - own.inputs.plan.kickDeg) < 1e-6, 'its plan comes with it');
  ok(errors.length === 0, 'links: no console errors ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------ phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), scheme + ' phone: no horizontal overflow');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const minFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#chart text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0)));
  ok(minFont >= 11, scheme + ' chart text at least 11 px tall: ' + minFont);
  const wide = await page.evaluate(() => [...document.querySelectorAll('table td, .wfrow')].filter((td) => { const r = td.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length);
  ok(wide === 0, scheme + ' every table cell and budget row on screen');
  // touch the chart
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.waitForTimeout(60);
  ok(await page.locator('#tip').isVisible(), scheme + ' tapping the chart reads a point');
  await page.locator('[data-metric="alt"]').tap(); await page.waitForTimeout(60);
  ok((await page.locator('#chart circle.flight').count()) === 4, scheme + ' altitude view by touch, four flight cutoffs');
  await page.locator('#bucketOn').tap(); await page.waitForTimeout(80);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), scheme + ' phone: no overflow with the bucket open');
  await noNaN(page, scheme + ' phone');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
