#!/usr/bin/env node
// Drives the Engine Deck page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by
// touch, light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/33-engine-deck/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const { E, B, M, pf } = L;
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
const handoff = (page) => page.evaluate(() => JSON.parse(document.getElementById('exportText').value));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const tileVal = (page, k) => page.evaluate((k) => { const t = [...document.querySelectorAll('#tiles .tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t ? t.querySelector('.v').textContent : null; }, k);
const noNaN = async (page, where) => { const t = await page.locator('main').innerText(); ok(!/\bNaN\b|undefined|Infinity/.test(t), where + ': no NaN/undefined on the page'); };

// kernel expectations
const F1 = E.engineSpec('F-1'), pSL = E.point(F1.context, F1.spec.pc, pf.isa(0).P_Pa), pV = E.point(F1.context, F1.spec.pc, 0);
const H32 = fs.readFileSync(path.join(here, 'snapshots/32-handoff.json'), 'utf8');
// an idea 32 handoff with no thrust (so no throat), built with idea 32's own functions
const nz = { eps: 20, contour: { type: 'bell', Lf: 0.8 }, ambient: { kind: 'vacuum' }, design: 'shifting', freeze: 'chamber', thrust: null };
const ch = B.chamberHandoff({ preset: 'lox-ch4', oxidizer: L.presets.PRESETS[2].oxidizer, fuel: L.presets.PRESETS[2].fuel, of: 3.2, pc: 80e5 }, L.densities, L.THERMO, '2026-10-31T12:00:00Z');
const H32noSize = JSON.stringify(B.makeHandoff(ch.handoff, nz, B.analyze(ch.rocket, nz), { produced: '2026-10-31T12:00:00Z' }));

// ------------------------------------------------------------------ desktop, light
{
  const { context, page, errors } = await open(DESK);
  ok(await page.locator('#engine').inputValue() === 'F-1', 'opens on the F-1');
  const thrust = num(await tileVal(page, 'Thrust at'));
  ok(Math.abs(thrust - pSL.F / 1e3) < 0.06, `F-1 sea-level thrust tile ${thrust} kN = kernel ${pSL.F / 1e3}`);
  const vac = await tileVal(page, 'Vacuum');
  ok(Math.abs(num(vac) - pV.Fvac / 1e3) < 0.06, 'vacuum thrust tile');
  const nTiles = await page.locator('#tiles .tile').count(), nChips = await page.locator('#tiles .tile .c').count();
  ok(nTiles >= 7 && nChips === nTiles, `every tile has a confidence chip (${nChips}/${nTiles})`);
  ok((await tileVal(page, 'Specific impulse at')).includes('–'), 'gas-generator engine Isp is a bracket');
  ok(/52\.7/.test(await tileVal(page, 'Lowest throttle')), 'F-1 lowest sea-level throttle 52.7 %');
  ok(/82\.6\d kg\/s|82\.67/.test(await page.locator('#cycleTiles').innerText()), 'gas-generator flow tile');
  // throttle to 40 % at sea level: separated, refused, no NaN
  await page.fill('#thrNum', '40'); await page.press('#thrNum', 'Enter'); await page.waitForTimeout(200);
  ok(/separates/.test(await page.locator('#verdict').innerText()), 'separated verdict at 40 %');
  ok((await tileVal(page, 'Thrust at')) === 'refused', 'thrust refused when separated');
  ok(await page.locator('#refusals .refusal').count() >= 1, 'refusal shown');
  await noNaN(page, '40 % at sea level');
  // vacuum button
  await page.click('#vacBtn'); await page.waitForTimeout(150);
  ok(/vacuum/.test(await page.locator('#verdict').innerText()), 'vacuum verdict');
  await page.click('#slBtn'); await page.fill('#thrNum', '100'); await page.press('#thrNum', 'Enter'); await page.waitForTimeout(150);
  // chart clicks: throttle chart sets the throttle, altitude chart the altitude, arrow keys
  await page.locator('#chartThr').scrollIntoViewIfNeeded();
  const box = await page.locator('#chartThr').boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.5); await page.waitForTimeout(150);
  const thr1 = num(await page.locator('#thrNum').inputValue());
  ok(thr1 > 60 && thr1 < 90, 'click on the throttle chart sets the throttle (' + thr1 + ')');
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
  ok(num(await page.locator('#thrNum').inputValue()) > thr1 + 10, 'drag on the throttle chart');
  await page.focus('#chartThr'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
  const thr2 = num(await page.locator('#thrNum').inputValue());
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
  ok(num(await page.locator('#thrNum').inputValue()) === thr2 - 1, 'arrow key on the throttle chart');
  await page.locator('#chartAlt').scrollIntoViewIfNeeded();
  const ab = await page.locator('#chartAlt').boundingBox();
  await page.mouse.click(ab.x + ab.width * 0.5, ab.y + ab.height * 0.5); await page.waitForTimeout(150);
  const alt = num(await page.locator('#altNum').inputValue());
  ok(alt > 30 && alt < 50, 'click on the altitude chart sets the altitude (' + alt + ')');
  await page.click('[data-metric="thrust"]'); await page.waitForTimeout(100);
  ok(/thrust \(kN\)/.test(await page.locator('#chartAlt').textContent()), 'thrust view');
  // efficiency out of envelope
  await page.fill('#etaC', '1.3'); await page.press('#etaC', 'Enter'); await page.waitForTimeout(200);
  ok(/out of envelope/i.test(await page.locator('#refusals').innerText()), 'efficiency 1.3 refused');
  await noNaN(page, 'efficiency refused');
  await page.click('#etaCal'); await page.waitForTimeout(200);
  ok(Math.abs(num(await page.locator('#etaC').inputValue()) - F1.spec.etaCstar) < 1e-4, 'calibrated values restored');
  // J-2: separated at sea level, flows full at 20 km
  await page.selectOption('#engine', 'J-2'); await page.waitForTimeout(400);
  await page.click('#slBtn'); await page.waitForTimeout(150);
  ok(/separates/.test(await page.locator('#verdict').innerText()), 'J-2 separates at sea level');
  await page.fill('#altNum', '20'); await page.press('#altNum', 'Enter'); await page.waitForTimeout(150);
  ok(/flows full/.test(await page.locator('#verdict').innerText()), 'J-2 flows full at 20 km');
  ok(/idea 31 gas/.test(await page.locator('#cycleTiles').innerText()), 'J-2 drive gas from idea 31');
  // review additions: the J-2's engine-level vacuum Isp brackets its published engine value (423 s), and a typed
  // turbine inlet temperature that is not positive is refused rather than silently replaced
  const jVac = await page.locator('.tile', { hasText: 'Vacuum' }).first().innerText();
  const jm = jVac.match(/Isp ([0-9.]+)–([0-9.]+) s/);
  ok(jm && +jm[1] <= 423.05 && +jm[2] >= 423, 'J-2 engine vacuum Isp bracket holds 423 s (' + (jm ? jm[0] : jVac.replace(/\n/g, ' ')) + ')');
  await page.selectOption('#cycleRef', 'SSME (EPL)'); await page.waitForTimeout(400);
  await page.fill('#tinNum', '-5'); await page.press('#tinNum', 'Enter'); await page.waitForTimeout(300);
  ok(/Refused: .*positive number/.test(await page.locator('#cycleVerdict').innerText()), 'a typed -5 K turbine inlet is refused');
  ok(/invalid input/i.test(await page.locator('#refusals').innerText()), 'and listed among the refusals');
  await page.fill('#tinNum', ''); await page.press('#tinNum', 'Enter'); await page.waitForTimeout(300);
  ok(/closes/.test(await page.locator('#cycleVerdict').innerText()), 'blank: the reference temperature again');
  // RL10: expander
  await page.selectOption('#engine', 'RL10A-3-3'); await page.waitForTimeout(400);
  ok(/Expander closes/.test(await page.locator('#cycleVerdict').innerText()), 'RL10 expander closes');
  ok(!(await page.locator('#tinCtl').isHidden()), 'turbine inlet temperature box for a closed cycle');
  await page.fill('#tinNum', '120'); await page.press('#tinNum', 'Enter'); await page.waitForTimeout(250);
  ok(/Refused: .*200 K/.test(await page.locator('#cycleVerdict').innerText()), 'hydrogen below its fit: refused, saying why');
  await page.fill('#tinNum', ''); await page.press('#tinNum', 'Enter'); await page.waitForTimeout(250);
  // F-1 with the SSME's staged combustion: fuel-rich kerosene preburner refused
  await page.selectOption('#engine', 'F-1'); await page.waitForTimeout(400);
  await page.selectOption('#cycleRef', 'SSME (EPL)'); await page.waitForTimeout(400);
  ok(/Refused/.test(await page.locator('#cycleVerdict').innerText()), 'kerosene staged combustion refused');
  await noNaN(page, 'SC refused');
  await page.click('[data-rich="ox"]'); await page.waitForTimeout(300);
  ok(/insufficient|no fetched source/i.test(await page.locator('#cycleVerdict').innerText()), 'oxidizer-rich needs a temperature');
  // sled engine: no cycle
  await page.selectOption('#engine', 'YLR113-AJ-1'); await page.waitForTimeout(400);
  ok(/no turbopump data/.test(await page.locator('#cycleNote').innerText()), 'sled engine: no cycle data');
  // the published record
  ok(await page.locator('#tblPumps tbody tr').count() === 28 && await page.locator('#tblTurbines tbody tr').count() === 16, 'record tables: 28 pumps, 16 turbines');
  ok(/\+0\.32 %/.test(await page.locator('#recordSummary').innerText()), 'throttle check in the summary');
  // export: handoff, copy, download, next link
  await page.selectOption('#engine', 'F-1'); await page.waitForTimeout(400);
  const h = await handoff(page);
  ok(h.from === '33-engine-deck' && h.inputs.nozzle_handoff.from === '32-bell' && h.inputs.nozzle_handoff.inputs.chamber_handoff.from === '31-mixture', 'handoff carries 32 and 31');
  ok(Math.abs(h.outputs.thrust_vacuum.value - pV.Fvac) < 1e-6 * pV.Fvac, 'handoff vacuum thrust = kernel');
  ok(h.outputs.deck.value.thrust.length === 5 && h.outputs.deck.value.altitude_m.length === 12, 'deck 5 x 12');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('#copyBtn'); await page.waitForTimeout(100);
  ok(/Copied|selected/.test(await page.locator('#exportStatus').innerText()), 'copy');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  ok(dl.suggestedFilename() === 'handoff.json', 'download');
  ok(/#h=/.test(await page.locator('#nextLink').getAttribute('href')), 'next link carries #h=');
  // import idea 32's committed handoff
  await page.fill('#importText', H32); await page.click('#importBtn'); await page.waitForTimeout(500);
  ok(/Imported/.test(await page.locator('#importStatus').innerText()) && await page.locator('#engine').inputValue() === 'imported', 'imports idea 32');
  await page.click('#slBtn'); await page.fill('#thrNum', '100'); await page.press('#thrNum', 'Enter'); await page.waitForTimeout(200);
  ok(Math.abs(num(await tileVal(page, 'Thrust at')) - 1000) < 0.06, 'idea 32 sample: 1,000.0 kN at sea level (ideal deck = idea 32\'s sizing)');
  const ed = JSON.parse(H32); ed.outputs.specific_impulse_vacuum_ideal_shifting.value *= 1.001;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn'); await page.waitForTimeout(300);
  ok(/Refused \(invalid_input\)/.test(await page.locator('#importStatus').innerText()), 'edited handoff refused');
  // an idea 32 handoff with no thrust: no throat, then sized here
  await page.fill('#importText', H32noSize); await page.click('#importBtn'); await page.waitForTimeout(500);
  ok(/throat area/i.test(await page.locator('#refusals').innerText()), 'no throat: refusal');
  ok((await page.locator('#sizeKN').count()) === 1, 'sizing box offered');
  await page.fill('#sizeKN', '500'); await page.press('#sizeKN', 'Enter'); await page.waitForTimeout(400);
  await page.click('#vacBtn'); await page.waitForTimeout(150);
  ok(Math.abs(num(await tileVal(page, 'Thrust at')) - 500) < 0.06, 'sized here: 500 kN in vacuum');
  await noNaN(page, 'imported and sized');
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png'), fullPage: true });
  await context.close();
}

// ------------------------------------------------------------------ links: idea 32's #h= and this page's own round trip
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + M.b64urlEncode(H32));
  ok(await page.locator('#engine').inputValue() === 'imported', 'opens on idea 32\'s #h= link');
  const h = await handoff(page);
  await context.close();
  const r = await open(DESK, URL0 + '#h=' + M.b64urlEncode(JSON.stringify(h)));
  const h2 = await handoff(r.page);
  ok(Math.abs(h2.outputs.thrust_sea_level_chamber.value - h.outputs.thrust_sea_level_chamber.value) < 1e-6, 'own handoff round-trips through #h=');
  ok(errors.length === 0 && r.errors.length === 0, 'links: no console errors');
  await r.context.close();
}

// ------------------------------------------------------------------ phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(!(await overflow(page)), scheme + ' phone: no horizontal overflow');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(200);
  ok(!(await overflow(page)), scheme + ' phone: no overflow with every section open');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const minFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#chartAlt text, #chartThr text, #chartCyc text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0)));
  ok(minFont >= 10.5, scheme + ' phone: chart text at least 11 px (' + minFont.toFixed(1) + ')');
  const wide = await page.evaluate(() => [...document.querySelectorAll('table td')].filter((td) => { const r = td.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length);
  ok(wide === 0, scheme + ' phone: every table cell on screen (' + wide + ' off)');
  // review addition: the record tables' captions used to be squeezed into a ~120 px column at this width
  const narrow = await page.evaluate(() => [...document.querySelectorAll('table caption')].filter((c) => { const r = c.getBoundingClientRect(), t = c.closest('table').getBoundingClientRect(); return r.width > 0 && r.width < 0.8 * t.width; }).length);
  const nCap = await page.evaluate(() => document.querySelectorAll('table caption').length);
  ok(nCap >= 3 && narrow === 0, scheme + ' phone: table captions span their tables (' + narrow + ' of ' + nCap + ' narrow)');
  await page.locator('#chartThr').scrollIntoViewIfNeeded();
  const box = await page.locator('#chartThr').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.waitForTimeout(200);
  const t = num(await page.locator('#thrNum').inputValue());
  ok(t > 45 && t < 85, scheme + ' phone: a tap on the throttle chart sets the throttle (' + t + ')');
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
