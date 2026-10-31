#!/usr/bin/env node
// Drives the Bell page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by touch,
// light and dark. Run from the bank root: node ideas/32-bell/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
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
const rel = (a, b) => Math.abs(a / b - 1);

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForTimeout(300);
  return { context, page, errors };
}
const handoff = (page) => page.evaluate(() => JSON.parse(document.getElementById('exportText').value));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const text = (page, sel) => page.locator(sel).innerText();
/** What the kernel computes, in Node, for the inputs a page handoff states. */
function kernelFor(h) {
  const p = L.B.parseHandoff(h);
  const r = L.B.chamberFromHandoff(p.chamberHandoff, p.inputs);
  const n = h.inputs.nozzle;
  return L.B.analyze(r, { eps: n.area_ratio, contour: n.contour, ambient: n.ambient, design: n.design_flow, freeze: n.freeze_point, thrust: n.thrust_N });
}
async function setNum(page, sel, v) { await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); await page.waitForTimeout(80); }

// 1. Desktop, light: opens on the F-1 at sea level; the page's numbers are the kernel's; every tile is labelled.
{
  const { context, page, errors } = await open(DESK);
  let h = await handoff(page);
  const f1 = L.table.ROWS.find((r) => r.engine === 'F-1');
  ok(h.inputs.mixture_ratio === 2.27 && rel(h.inputs.chamber_pressure_Pa, 1126 * L.Bell.PSI) < 1e-12, 'opens on the F-1: O/F 2.27, 1126 psia');
  ok(h.inputs.nozzle.area_ratio === 16 && h.inputs.nozzle.ambient.kind === 'altitude' && h.inputs.nozzle.ambient.alt_m === 0, 'F-1 nozzle: area ratio 16 at sea level');
  ok(rel(h.inputs.nozzle.thrust_N, 1522000 * L.Bell.LBF) < 1e-5, 'F-1 sea-level thrust 1,522,000 lbf');
  ok((await text(page, '#chamberSource')).includes('SP-8120 Table I: F-1'), 'the chamber line says where the inputs came from');
  const A = kernelFor(h);
  ok(rel(h.outputs.specific_impulse_ambient_shifting.value, A.flows.shifting.amb.isp) < 1e-10, 'page Isp at sea level = kernel');
  ok(rel(h.outputs.specific_impulse_vacuum_frozen.value, A.flows.frozen.vac.Ivac) < 1e-10, 'page frozen vacuum Isp = kernel');
  ok(rel(h.outputs.throat_diameter.value, A.sizing.Dt) < 1e-10, 'page throat diameter = kernel');
  const hero = await text(page, '.tile.hero');
  ok(hero.includes((A.flows.shifting.amb.isp / L.pf.ISA_G0).toFixed(1)), 'hero tile shows the kernel Isp in seconds: ' + hero.replace(/\s+/g, ' '));
  const tiles = await page.locator('#tiles .tile').count(), chips = await page.locator('#tiles .tile .c').count();
  ok(tiles >= 12 && tiles === chips, `every tile has a confidence chip (${chips}/${tiles})`);
  ok((await page.locator('#verdict').getAttribute('class')).includes('full'), 'F-1 at sea level flows full');
  ok((await page.locator('#contour polyline.wall').count()) === 2, 'the contour draws both walls');
  ok((await page.locator('#contour circle.mark').count()) === 2, 'N and E are marked');
  // the engine table: 16 points with Load buttons, 4 engines refused with a reason
  ok((await page.locator('#engines button').count()) === 16, '16 engine points with Load');
  ok((await page.locator('#engines td', { hasText: 'Not modelled' }).count()) === 4, '4 engines not modelled, with a reason');
  // load the J-2 at sea level: it separates; the full-flowing Isp is refused, not shown
  await page.locator('#engines button[aria-label="Load J-2 (sl)"]').click();
  await page.waitForTimeout(150);
  h = await handoff(page);
  ok((await page.locator('#verdict').getAttribute('class')).includes('separated'), 'J-2 at sea level: separated');
  ok((await text(page, '.tile.hero')).includes('refused'), 'hero refuses the separated Isp');
  ok(!h.outputs.specific_impulse_ambient_shifting && h.refusals.some((r) => r.applies_to === 'specific_impulse_ambient_shifting'), 'handoff carries the refusal, not a number');
  ok((await page.locator('#engines tr.current').count()) === 1, 'the loaded engine row is marked');
  // cone: the closed form
  await page.click('[data-contour="cone"]');
  await page.waitForTimeout(100);
  ok(await page.locator('#alphaCtl').isVisible(), 'cone half-angle control appears');
  await setNum(page, '#alphaNum', 15);
  h = await handoff(page);
  ok(Math.abs(h.outputs.divergence_efficiency.value - (1 + Math.cos(15 * Math.PI / 180)) / 2) < 1e-15, 'cone 15 deg: lambda = (1 + cos 15)/2');
  await page.click('[data-contour="bell"]');
  // vacuum
  await page.click('[data-amb="vacuum"]');
  await page.waitForTimeout(100);
  ok((await page.locator('#verdict').getAttribute('class')).includes('vacuum'), 'vacuum verdict');
  // envelope refusals: area ratio 500, altitude 90 km; no NaN anywhere
  await setNum(page, '#epsNum', 500);
  h = await handoff(page);
  ok(h.refusals.some((r) => /outside the 1.5 to 400/.test(r.reason)) && !h.outputs.exit_pressure_shifting, 'area ratio 500 refused with no exit numbers');
  ok(!/NaN|Infinity|undefined/.test(await text(page, '#results')), 'no NaN on the page after a refusal');
  await setNum(page, '#epsNum', 16);
  await page.click('[data-amb="altitude"]');
  await setNum(page, '#altNum', 90);
  h = await handoff(page);
  ok(h.refusals.some((r) => r.applies_to === 'ambient' && /86 km/.test(r.reason)), 'altitude 90 km refused (ISA table ends at 86 km)');
  await setNum(page, '#altNum', 0);
  // the two helpers: exit = ambient, and the largest area ratio that flows full with SP-8120's 20 % margin
  await page.click('#toIdeal'); await page.waitForTimeout(150);
  h = await handoff(page);
  ok(rel(h.outputs.exit_pressure_shifting.value, 101325) < 2e-3, 'exit = ambient button: exit pressure ' + h.outputs.exit_pressure_shifting.value);
  await page.click('#toLimit'); await page.waitForTimeout(150);
  h = await handoff(page);
  const pc = h.inputs.chamber_pressure_Pa, pSep = 101325 * 0.583 * Math.pow(101325 / pc, 0.195);
  ok(rel(h.outputs.exit_pressure_shifting.value, 1.2 * pSep) < 2e-3, 'largest-full button: exit pressure 20 % above separation');
  // sizing: blank thrust gives no sizing; a negative one is refused
  await page.fill('#thrustNum', ''); await page.dispatchEvent('#thrustNum', 'change'); await page.waitForTimeout(80);
  h = await handoff(page);
  ok(!h.outputs.throat_diameter && !h.refusals.some((r) => r.applies_to === 'sizing'), 'no thrust: no sizing and no refusal');
  ok((await text(page, '#contourCap')).includes('per throat radius'), 'contour drawn per throat radius without a thrust');
  await setNum(page, '#thrustNum', -5);
  h = await handoff(page);
  ok(h.refusals.some((r) => r.applies_to === 'sizing' && r.code === 'invalid_input'), 'negative thrust refused');
  await setNum(page, '#thrustNum', 100);
  // chart: area-ratio view, click sets the area ratio, keys move it; altitude view, keys move altitude
  await page.click('[data-chart="eps"]'); await page.waitForTimeout(150);
  await setNum(page, '#epsNum', 3);
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2); await page.waitForTimeout(150);
  h = await handoff(page);
  const e1 = h.inputs.nozzle.area_ratio;
  ok(e1 > 50 && e1 < 120, 'clicking 3/4 along the log axis sets the area ratio near 70 (from 3): ' + e1);
  await page.focus('#chart'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  h = await handoff(page);
  ok(h.inputs.nozzle.area_ratio > e1, 'arrow key raises the area ratio');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const bx = await page.locator('#chart').boundingBox(); // the layout above may have moved since the click
  await page.mouse.move(bx.x + bx.width * 0.3, bx.y + bx.height / 2); await page.mouse.down();
  await page.mouse.move(bx.x + bx.width * 0.5, bx.y + bx.height / 2, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
  h = await handoff(page);
  ok(h.inputs.nozzle.area_ratio > 5 && h.inputs.nozzle.area_ratio < 40, 'dragging sets the area ratio: ' + h.inputs.nozzle.area_ratio);
  await page.click('[data-chart="alt"]'); await page.waitForTimeout(150);
  await page.focus('#chart'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  h = await handoff(page);
  ok(h.inputs.nozzle.ambient.alt_m === 1000, 'arrow key in the altitude view moves to 1 km');
  ok((await page.locator('#chart polyline.line').count()) >= 3, 'altitude chart draws shifting, frozen and the ideal envelope');
  // export: copy, download, next-module link
  await page.click('#copyBtn'); await page.waitForTimeout(100);
  ok(/Copied|Copy failed/.test(await text(page, '#exportStatus')), 'copy reports');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  ok(dl.suggestedFilename() === 'handoff.json', 'download is handoff.json');
  const href = await page.locator('#nextLink').getAttribute('href');
  ok(href.startsWith('../33-engine-deck/index.html#h='), 'next-module link carries #h=');
  // import idea 31's committed sample, then an edited copy, then a foreign object
  const s31 = fs.readFileSync(path.join(here, 'snapshots/31-handoff.json'), 'utf8');
  await page.fill('#importText', s31); await page.click('#importBtn'); await page.waitForTimeout(200);
  ok((await page.locator('#importStatus').getAttribute('class')).includes('ok'), 'idea 31 sample imports');
  ok((await text(page, '#chamberSource')).includes('imported'), 'chamber line says imported');
  h = await handoff(page);
  ok(h.inputs.mixture_ratio === 2.6 && h.outputs.cstar_shifting.value === JSON.parse(s31).outputs.cstar.value, 'imported chamber passes through idea 31\'s c* bit for bit');
  const ed = JSON.parse(s31); ed.outputs.cstar.value *= 1.001;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn'); await page.waitForTimeout(200);
  h = await handoff(page);
  ok(h.refusals.some((r) => /cstar/.test(r.reason)) && !h.outputs.exit_velocity_shifting, 'an edited handoff\'s chamber is refused');
  await page.fill('#importText', '{"handoff":"long-way-round","version":1,"from":"40-long-coast","inputs":{}}'); await page.click('#importBtn'); await page.waitForTimeout(100);
  ok((await page.locator('#importStatus').getAttribute('class')).includes('bad'), 'a foreign handoff is not imported');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desk.png'), fullPage: true });
  ok(errors.length === 0, 'no console errors on desktop: ' + errors.join(' | '));
  await context.close();
}

// 2. A #h= link as idea 31's page writes it opens on that chamber.
{
  const s31 = fs.readFileSync(path.join(here, 'snapshots/31-handoff.json'), 'utf8');
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + L.M.b64urlEncode(s31));
  const h = await handoff(page);
  ok(h.inputs.mixture_ratio === 2.6 && h.inputs.chamber_handoff.from === '31-mixture', '#h= link from idea 31 opens on its chamber');
  ok((await page.locator('#importStatus').innerText()).includes('from the link'), 'status says it came from the link');
  // and this page's own handoff round-trips through its link
  const own = await page.locator('#exportText').inputValue();
  await page.goto(URL0 + '#h=' + L.M.b64urlEncode(own)); await page.waitForTimeout(300);
  const h2 = await handoff(page);
  ok(JSON.stringify(h2.outputs) === JSON.stringify(h.outputs), 'own handoff round-trips through #h=');
  ok(errors.length === 0, 'no console errors on link import: ' + errors.join(' | '));
  await context.close();
}

// 3. Phone, dark and light: no overflow, readable drawings, touch on the chart.
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(!(await overflow(page)), scheme + ' phone: no horizontal overflow');
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), scheme + ' phone: no overflow with every section open');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const minFont = await page.evaluate(() => {
    let m = 99;
    document.querySelectorAll('#chart text, #contour text').forEach((t) => {
      const svg = t.ownerSVGElement, vb = svg.viewBox.baseVal, scale = svg.getBoundingClientRect().width / vb.width;
      m = Math.min(m, parseFloat(getComputedStyle(t).fontSize) * scale);
    });
    return m;
  });
  ok(minFont >= 10.5, scheme + ' phone: drawing text at least 11 px (' + minFont.toFixed(1) + ')');
  await page.click('[data-chart="eps"]'); await page.waitForTimeout(200);
  const box = await page.locator('#chart').boundingBox();
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const b2 = await page.locator('#chart').boundingBox();
  await page.touchscreen.tap(b2.x + b2.width * 0.2, b2.y + b2.height / 2); await page.waitForTimeout(200);
  const h = await handoff(page);
  ok(h.inputs.nozzle.area_ratio < 6, scheme + ' phone: a tap on the chart sets the area ratio (' + h.inputs.nozzle.area_ratio + ')');
  ok(box.width <= 390, 'chart fits the phone');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  ok(errors.length === 0, scheme + ' phone: no console errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
