#!/usr/bin/env node
// Drives the Closed Loop page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by
// touch, light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/36-closed-loop/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const { C, DATA } = L;
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
  page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' / ')));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForTimeout(500);
  return { context, page, errors };
}
const tileVal = (page, k, box = '#tiles') => page.evaluate(([k, box]) => { const t = [...document.querySelectorAll(box + ' .tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t ? t.querySelector('.v').textContent : null; }, [k, box]);
const noNaN = async (page, where) => { const t = await page.locator('main').innerText(); const bad = t.match(/.{0,60}(\bNaN\b|undefined|Infinity).{0,40}/); ok(!bad, where + ': no NaN/undefined on the page' + (bad ? ' (' + bad[0] + ')' : '')); };
const setNum = async (page, sel, v) => { await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); await page.waitForTimeout(120); };
const waitMC = (page) => page.waitForFunction(() => /flights, each/.test(document.getElementById('mcStatus').textContent), null, { timeout: 60000 });

// kernel expectations
const CTX = C.setup(DATA.as512), R = C.run(CTX, { samples: false }), G = R.guided;

// ------------------------------------------------------------------ desktop, light
{
  const { context, page, errors } = await open(DESK);
  ok(await page.locator('#vehicle').inputValue() === 'as512', 'opens on AS-512');
  const orb = await tileVal(page, 'Orbit reached');
  ok(orb === (G.orbit.perigeeAlt / 1000).toFixed(2) + ' × ' + (G.orbit.apogeeAlt / 1000).toFixed(2) + 'km', 'orbit tile is the kernel\'s: ' + orb);
  ok(Math.abs(num(await tileVal(page, 'S-IVB propellant')) - G.guided.propellantUsed / 1000) < 0.006, 'S-IVB propellant tile is the kernel\'s');
  ok(/not in orbit/.test(await tileVal(page, 'Open loop')), 'idea 35\'s open loop: not in orbit');
  ok((await page.locator('#tiles .tile .c').count()) === (await page.locator('#tiles .tile').count()), 'a confidence chip on every tile');
  ok((await page.locator('#refusals .refusal').count()) === 0, 'no refusal on the default flight');
  ok((await page.locator('#tblRecord tbody tr').count()) === C.as512Rows(CTX, R).length, 'every flight comparison row');
  ok((await page.locator('#recordSummary .tile').count()) === 4, 'four summary tiles against Apollo 17');
  ok(/Insertion at perigee/.test(await page.locator('#tgtLine').innerText()), 'the target is spelled out');
  // the chart: every metric draws, the altitude view has the flight's four cutoffs, reading a point
  for (const m of ['alt', 'pitch', 'yaw', 'v', 'tgo']) {
    await page.click(`[data-metric="${m}"]`); await page.waitForTimeout(60);
    ok((await page.locator('#chart path.line, #chart circle.dot1').count()) > 0, m + ' draws');
  }
  await page.click('[data-metric="alt"]'); await page.waitForTimeout(60);
  ok((await page.locator('#chart circle.flight').count()) === 4, 'altitude: four Apollo 17 cutoffs');
  ok((await page.locator('#chart path.line').count()) === 2, 'altitude: guided and open loop');
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5); await page.waitForTimeout(60);
  ok(await page.locator('#tip').isVisible(), 'a click reads a point');
  const t1 = await page.locator('#tip').innerText();
  await page.locator('#chart').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60);
  ok((await page.locator('#tip').innerText()) !== t1, 'the arrow key moves the reading');
  // targets
  await setNum(page, '#incNum', 20);
  ok(/cannot be inclined less/.test(await page.locator('#refusals').innerText()) || /cannot be inclined less/.test(await page.locator('#tgtLine').innerText()), 'an inclination below the latitude is refused');
  await noNaN(page, 'refused target');
  await setNum(page, '#incNum', 32);
  ok(/32\.0000 deg/.test(await page.locator('#tiles').innerText()), 'guided into a 32 deg plane');
  {
    const c2 = C.setup(DATA.as512); c2.target = Object.assign({}, c2.target, { inclinationDeg: 32, source: 'user' });
    const r2 = C.run(c2, { samples: false }).guided;
    ok(Math.abs(num(await tileVal(page, 'S-IVB propellant')) - r2.guided.propellantUsed / 1000) < 0.006, 'the 32 deg flight is the kernel\'s');
  }
  await page.click('#tgtAster'); await page.waitForTimeout(150);
  ok(/^200\.0/.test(await tileVal(page, 'Orbit reached')), 'Aster\'s parking orbit: about 200 km');
  await page.click('#tgtFlight'); await page.waitForTimeout(150);
  ok(Math.abs(num(await page.locator('#incNum').inputValue()) - 28.526) < 1e-9, 'back to Table 4-4');
  await page.selectOption('#cycleSel', '0.5'); await page.waitForTimeout(200);
  ok(/^166\.60 × 167\.20/.test(await tileVal(page, 'Orbit reached')), 'a 0.5 s cycle still reaches the target');
  await page.selectOption('#cycleSel', '2'); await page.waitForTimeout(200);
  // the kick slider by keyboard: the page's flight is the kernel's on the same kick
  await page.locator('#kickRange').focus(); for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  {
    const k = num(await page.locator('#kickNum').inputValue());
    const c3 = C.setup(DATA.as512); c3.plan.kickDeg = k; const r3 = C.run(c3, { samples: false }).guided;
    ok(k > CTX.plan.kickDeg + 0.09 && k < CTX.plan.kickDeg + 0.11, 'the kick moved about 0.1 deg by keyboard: ' + k);
    ok(r3.ok && Math.abs(num(await tileVal(page, 'S-IVB propellant')) - r3.guided.propellantUsed / 1000) < 0.006, 'a bigger kick: the page is the kernel');
  }
  await page.selectOption('#vehicle', 'as512'); await page.waitForTimeout(300);
  // Monte Carlo: 50 flights at AS-512 sizes, the page's counts are the kernel's
  await page.selectOption('#mcN', '50'); await page.click('#mcRun'); await waitMC(page);
  const mcK = C.monteCarlo(CTX, R, { n: 50, seed: 1, sigmaScale: 1 }); mcK.step(50); const mr = mcK.result();
  ok((await tileVal(page, 'Closed loop on target', '#mcSummary')) === mr.guided.onTarget + ' / 50', 'closed loop on target: ' + mr.guided.onTarget + '/50');
  ok((await tileVal(page, 'Open loop in orbit', '#mcSummary')) === mr.replay.inOrbit + ' / 50', 'open loop in orbit: ' + mr.replay.inOrbit + '/50');
  ok(Math.abs(num(await tileVal(page, 'Reserve', '#mcSummary')) - mr.reserve.threeSigma) < 1, 'reserve is the kernel\'s');
  ok((await page.locator('#mcChart circle.pt-g').count()) === 50, 'fifty closed-loop dots');
  ok((await page.locator('#mcChart circle.pt-o, #mcChart path.pt-x').count()) === mr.replay.flown, 'an open-loop mark per flight that reached cutoff');
  await page.click('[data-mcview="prop"]'); await page.waitForTimeout(80);
  ok((await page.locator('#mcChart rect.hist-g').count()) > 3, 'the propellant histogram draws');
  await page.click('[data-mcview="orbit"]'); await page.waitForTimeout(80);
  const mb = await page.locator('#mcChart').boundingBox();
  await page.mouse.click(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5); await page.waitForTimeout(60);
  ok(await page.locator('#mcTip').isVisible(), 'a click on the scatter reads the nearest flight');
  const exp = JSON.parse(await page.locator('#exportText').inputValue());
  ok(exp.outputs.scatter && exp.outputs.scatter.value.n === 50, 'the export carries the scatter');
  // scaled dispersions
  await page.selectOption('#mcScale', 'msfc'); await page.waitForTimeout(150);
  const ms = C.msfcScale(CTX, C.dispersionTable(CTX.veh));
  ok(Math.abs(num(await page.locator('#sig0').inputValue()) - 0.16 * ms.scale) < 1e-3, 'MSFC scale applied to the table');
  ok(/changed/.test(await page.locator('#mcStatus').innerText()), 'the old scatter is marked stale');
  await page.click('#mcCard details summary'); await page.waitForTimeout(60);
  await setNum(page, '#sig0', 0.5);
  ok(Math.abs(num(await page.locator('#sig0').inputValue()) - 0.5) < 1e-9, 'a sigma can be edited');
  await page.selectOption('#mcScale', 'as512'); await page.waitForTimeout(150);
  // tornado
  await page.click('#tornRun'); await page.waitForFunction(() => /flights in/.test(document.getElementById('tornStatus').textContent), null, { timeout: 60000 });
  ok((await page.locator('#tornado .trow').count()) === C.dispersionTable(CTX.veh).length, 'a tornado row per dispersion');
  // export and the next link
  const own = JSON.parse(await page.locator('#exportText').inputValue());
  ok(own.from === '36-closed-loop' && own.inputs.ascent_handoff.from === '35-max-q', 'export is a 36 handoff carrying 35\'s');
  ok(!C.parseHandoff(own).refusal, 'the export re-flies to its own numbers in the kernel');
  ok(/#h=/.test(await page.locator('#nextLink').getAttribute('href')), 'the next-module link carries the handoff');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  ok(dl.suggestedFilename() === 'handoff.json', 'download handoff.json');
  // import: idea 35's committed sample, garbage, an engine, an edited one of ours
  const h35 = JSON.parse(fs.readFileSync(path.join(here, '..', '35-max-q', 'handoff.json'), 'utf8'));
  await page.fill('#importText', JSON.stringify(h35)); await page.click('#importBtn'); await page.waitForTimeout(400);
  ok(/Imported/.test(await page.locator('#importStatus').innerText()), 'idea 35\'s sample imports');
  ok(/^199\.9/.test(await tileVal(page, 'Orbit reached')), 'and is guided to Aster\'s parking orbit');
  ok(/Load "Saturn V/.test(await page.locator('#recordSummary').innerText()), 'the flight comparison hides for another vehicle');
  await page.fill('#importText', 'not json'); await page.click('#importBtn'); await page.waitForTimeout(100);
  ok(/Refused/.test(await page.locator('#importStatus').innerText()), 'garbage refused');
  await page.fill('#importText', JSON.stringify({ handoff: 'long-way-round', version: 1, from: '33-engine-deck' })); await page.click('#importBtn'); await page.waitForTimeout(100);
  ok(/engine/.test(await page.locator('#importStatus').innerText()), 'an engine handoff refused as not a vehicle');
  const ed = JSON.parse(JSON.stringify(own)); ed.outputs.parking_orbit.value.perigee_altitude_m += 50;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn'); await page.waitForTimeout(300);
  ok(/edited/.test(await page.locator('#importStatus').innerText()), 'an edited handoff refused');
  // review additions: an edited insertion state (what modules 37 and 38 start from) is refused too; guidance settings that
  // cannot fly, and a first call that does not settle, are refused on the page rather than flown as a held attitude
  const ed4 = JSON.parse(JSON.stringify(own)); ed4.outputs.insertion_state.value.r_m[0] += 100;
  await page.fill('#importText', JSON.stringify(ed4)); await page.click('#importBtn'); await page.waitForTimeout(300);
  ok(/edited/.test(await page.locator('#importStatus').innerText()), 'an edited insertion state refused');
  await page.selectOption('#vehicle', 'as512'); await page.waitForTimeout(300);
  await setNum(page, '#startNum', -5);
  ok(/guidance: refused \(invalid_input\)/.test(await page.locator('#refusals').innerText()), 'a negative guidance start is refused');
  await noNaN(page, 'negative start');
  await setNum(page, '#startNum', 1000);
  ok(/Guidance never starts/.test(await page.locator('#refusals').innerText()), 'a start after burnout is refused');
  await setNum(page, '#startNum', 42.9); await setNum(page, '#kickNum', 2.2);
  ok(/first call does not settle/.test(await page.locator('#refusals').innerText()), 'a flat first stage: guidance says it cannot steer');
  await noNaN(page, 'unsteerable');
  await noNaN(page, 'desktop');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png'), fullPage: true });
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------ links
{
  const h = C.makeHandoff(Object.assign({}, CTX, { target: Object.assign({}, CTX.target, { inclinationDeg: 30, source: 'user' }) }), C.run(Object.assign({}, CTX, { target: Object.assign({}, CTX.target, { inclinationDeg: 30 }) }), { samples: false }), null, { produced: 'x' });
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(h));
  ok(Math.abs(num(await page.locator('#incNum').inputValue()) - 30) < 1e-9, 'this module\'s handoff round-trips through #h= with its target');
  ok(/30\.0000 deg/.test(await page.locator('#tiles').innerText()), 'and flies to it');
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
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.waitForTimeout(60);
  ok(await page.locator('#tip').isVisible(), scheme + ' tapping the chart reads a point');
  await page.locator('[data-metric="pitch"]').tap(); await page.waitForTimeout(60);
  ok((await page.locator('#chart path.line').count()) === 1, scheme + ' pitch view by touch');
  await page.selectOption('#mcN', '50'); await page.locator('#mcRun').tap(); await waitMC(page);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), scheme + ' phone: no overflow with the scatter drawn');
  const wide = await page.evaluate(() => [...document.querySelectorAll('table td, .trow, .tile')].filter((td) => { const r = td.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length);
  ok(wide === 0, scheme + ' every table cell and tile on screen');
  const mcFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#mcChart text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0)));
  ok(mcFont >= 11, scheme + ' scatter text at least 11 px tall: ' + mcFont);
  await noNaN(page, scheme + ' phone');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
