#!/usr/bin/env node
// Drives the Mixture page in headless Chromium and checks what a person would do with it, at phone width by
// touch and at desktop width by mouse and keyboard, in light and dark. Run from the bank root:
//   node ideas/31-mixture/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'mixture.js'));
const P = require(path.join(here, 'presets.js'));
const db = M.parseThermo(require(path.join(here, 'snapshots', 'thermo-excerpt.js')));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pw;
try {
  pw = require('playwright');
} catch {
  pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
}
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`FAIL ${msg}`); }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForTimeout(250);
  return { context, page, errors };
}
const handoff = (page) => page.evaluate(() => JSON.parse(document.getElementById('exportText').value));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const kernel = (h) => {
  const inp = M.parseHandoff(h).inputs;
  return M.rocket(db, inp, inp.of, inp.pc);
};

// 1. Desktop, light: the default preset, numbers equal the kernel's, presets, refusals, blends, metrics, keyboard.
{
  const { context, page, errors } = await open(DESK);
  ok(await page.locator('#preset').inputValue() === 'lox-rp1', 'starts on LOX / RP-1 and the select says so');
  let h = await handoff(page);
  const pk = M.maxCstar(db, { oxidizer: P.PRESETS[1].oxidizer, fuel: P.PRESETS[1].fuel }, 1e7, 1, 4);
  ok(Math.abs(h.inputs.mixture_ratio - +pk.of.toFixed(3)) < 1e-12, `starts at the computed c* peak (${h.inputs.mixture_ratio} vs ${pk.of})`);
  let r = kernel(h);
  // Chromium's and Node's V8 differ in the last bits of some Math functions (measured: 1.4e-14 relative on c*).
const same = (a, b) => Math.abs(a - b) <= 1e-10 * Math.abs(b);
  ok(same(h.outputs.cstar.value, r.cstar), `exported c* is the kernel value for the exported inputs (${h.outputs.cstar.value} vs ${r.cstar})`);
  const heroTxt = await page.locator('.tile.hero .v').textContent();
  ok(heroTxt.startsWith(r.cstar.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })), `hero tile shows c* (${heroTxt})`);
  const tcTxt = await page.locator('.tile').nth(1).locator('.v').textContent();
  ok(tcTxt.startsWith(r.chamber.T.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })), `Tc tile (${tcTxt})`);
  const chips = await page.locator('.tile:not(.refused) .c').count(), numbered = await page.locator('.tile:not(.refused)').count();
  ok(chips === numbered && numbered >= 14, `every numeric tile carries a confidence class (${chips}/${numbered})`);
  ok(await page.locator('#chart path.line').count() === 2, 'two curves drawn (pc and pc/10)');
  ok(await page.locator('#chart circle.peak').count() === 1, 'c* peak marked');
  ok(await page.locator('#comp .bar').count() >= 6, 'composition bars drawn');

  // LOX/LH2 preset
  await page.selectOption('#preset', 'lox-lh2');
  await page.waitForTimeout(150);
  h = await handoff(page);
  r = kernel(h);
  ok(h.inputs.preset === 'lox-lh2' && Math.abs(h.inputs.mixture_ratio - 3.339) < 0.002, `LOX/LH2 starts at its c* peak (${h.inputs.mixture_ratio})`);
  ok(Math.abs(h.outputs.cstar.value - r.cstar) < 1e-9, 'LOX/LH2 c* matches the kernel');

  // fuel-rich LOX/RP-1 refuses (graphite)
  await page.selectOption('#preset', 'lox-rp1');
  await page.fill('#ofNum', '1.0');
  await page.locator('#ofNum').press('Enter');
  await page.locator('#pcNum').focus();
  await page.waitForTimeout(150);
  const refTxt = await page.locator('#refusals').textContent();
  ok(/C\(gr\)/.test(refTxt) && /out_of_envelope/.test(refTxt), 'O/F 1.0 is refused with the graphite reason');
  ok((await page.locator('.tile.hero .v').textContent()).includes('refused'), 'hero tile says refused, shows no number');
  h = await handoff(page);
  ok(!h.outputs.cstar && h.refusals.some((x) => x.code === 'out_of_envelope'), 'the handoff carries the refusal, not a c*');
  ok(await page.locator('#chart rect.refband').count() >= 1, 'refused band drawn on the chart');

  // blend editor: 50 % RP-1 alone is invalid; add methane at 50 % to make a custom blend
  await page.selectOption('#preset', 'lox-rp1');
  await page.locator('#side-fuel .comp-row input').first().fill('50');
  await page.waitForTimeout(100);
  ok(/must be 100/.test(await page.locator('#side-fuel .side-sum').textContent()), 'a fuel side summing to 50 % is flagged');
  ok(/invalid_input/.test(await page.locator('#refusals').textContent()), 'and the chamber state is refused as invalid input');
  await page.locator('#side-fuel button.add').click();
  await page.locator('#side-fuel .comp-row select').nth(1).selectOption('CH4(L)');
  await page.locator('#side-fuel .comp-row input').nth(1).fill('50');
  await page.waitForTimeout(150);
  ok(await page.locator('#preset').inputValue() === 'custom', 'an edited blend becomes Custom');
  h = await handoff(page);
  ok(h.inputs.fuel.length === 2 && h.outputs.cstar && h.outputs.fuel_density.confidence === 'derived', 'RP-1/methane blend computes, with a derived (volume-additive) density');

  // metrics
  for (const label of ['Chamber T', 'Molar mass', 'γs', 'Bulk density', 'Density × c*', 'c*']) {
    await page.locator('#metrics button').filter({ hasText: new RegExp('^' + label.replace(/[*×]/g, '.') + '$') }).click();
    ok(await page.locator('#metrics button[aria-pressed="true"]').textContent() === label, `metric ${label} selectable`);
  }

  // keyboard on the chart
  await page.selectOption('#preset', 'nto-mmh');
  await page.waitForTimeout(100);
  const before = (await handoff(page)).inputs.mixture_ratio;
  await page.locator('#chart').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const after = (await handoff(page)).inputs.mixture_ratio;
  ok(after > before, `arrow keys on the focused chart raise O/F (${before} -> ${after})`);

  // mouse drag on the chart
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  const dragged = (await handoff(page)).inputs.mixture_ratio;
  ok(dragged > after + 0.5, `dragging across the chart moves O/F (${dragged})`);
  ok(await page.locator('#tip').isVisible(), 'hover tooltip shows over the chart');

  // GOX/RP-1: measured points, oxidizer density refused, rest computed
  await page.selectOption('#preset', 'gox-rp1');
  await page.waitForTimeout(150);
  ok(await page.locator('#chart circle.dotm').count() === 6, 'six measured c* points drawn for GOX/RP-1');
  ok(/oxidizer density is refused/.test(await page.locator('#refusals').textContent()), 'gaseous oxygen density refused');
  h = await handoff(page);
  ok(h.outputs.cstar && !h.outputs.bulk_density && h.refusals.length === 1, 'GOX handoff: c* present, bulk density absent, one refusal');
  ok(Math.abs(h.inputs.chamber_pressure_Pa - 175 * P.PSI) < 1e-6, 'GOX preset starts at the report\'s 175 psia');

  // Added by the independent review. Leaving GOX goes back to 100 bar; the c* peak ring stays visible on the dot.
  await page.selectOption('#preset', 'lox-rp1');
  await page.waitForTimeout(150);
  h = await handoff(page);
  ok(h.inputs.chamber_pressure_Pa === P.PC_DEFAULT, `leaving the GOX preset returns to 100 bar (${h.inputs.chamber_pressure_Pa})`);
  ok(await page.evaluate(() => { const c = [...document.querySelectorAll('#chart circle')]; const pk = c.findIndex((e) => e.classList.contains('peak')), d = c.findIndex((e) => e.classList.contains('dot1')); return pk > d && +c[pk].getAttribute('r') > +c[d].getAttribute('r') && getComputedStyle(c[pk]).fill === 'none'; }),
    'the hollow peak ring is drawn around the current dot, not under it');
  // a typed pressure outside the checked 0.1-300 bar is refused, not computed
  await page.fill('#pcNum', '1000000');
  await page.locator('#pcNum').press('Enter');
  await page.locator('#ofNum').focus();
  await page.waitForTimeout(200);
  ok(/out_of_envelope/.test(await page.locator('#refusals').textContent()) && (await page.locator('.tile.hero .v').textContent()).includes('refused'), 'a million bar is refused');
  h = await handoff(page);
  ok(!h.outputs.cstar && h.refusals.some((x) => x.code === 'out_of_envelope'), 'and the handoff carries no c*');
  await page.fill('#pcNum', '100');
  await page.locator('#pcNum').press('Enter');
  await page.locator('#ofNum').focus();
  // an emptied O/F field: a refusal, never NaN on the page or null in the handoff's outputs
  await page.evaluate(() => { const e = document.getElementById('ofNum'); e.value = ''; e.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(150);
  await page.locator('#metrics button').first().click();
  ok(!/NaN|Infinity|undefined/.test(await page.evaluate(() => document.body.innerText)), 'an empty O/F shows no NaN anywhere');
  h = await handoff(page);
  ok(!h.outputs.mixture_ratio && h.refusals.some((x) => x.code === 'invalid_input'), 'and the handoff has a refusal, not a null O/F output');

  // import: paste the sample handoff
  const sample = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
  await page.fill('#importText', sample);
  await page.click('#importBtn');
  await page.waitForTimeout(150);
  h = await handoff(page);
  ok(h.inputs.preset === 'lox-rp1' && h.inputs.mixture_ratio === 2.6 && h.inputs.chamber_pressure_Pa === 1e7, 'importing handoff.json restores its inputs');
  ok(same(h.outputs.cstar.value, JSON.parse(sample).outputs.cstar.value), 'and reproduces its c* to 1e-10');
  await page.fill('#importText', '{"handoff":"something-else"}');
  await page.click('#importBtn');
  ok(/invalid_input/.test(await page.locator('#importStatus').textContent()), 'a foreign object is refused on import');

  // copy and download do not throw
  await page.click('#copyBtn');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 3000 }).catch(() => null), page.click('#dlBtn')]);
  ok(dl && dl.suggestedFilename() === 'handoff.json', 'download offers handoff.json');
  ok(/32-bell\/index\.html#h=/.test(await page.locator('#nextLink').getAttribute('href')), 'the next-module link carries the handoff in #h=');
  ok(!(await overflow(page)), 'no horizontal overflow at desktop');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desk-light.png'), fullPage: true });
  ok(errors.length === 0, `no console errors on desktop: ${errors.join(' | ')}`);
  await context.close();
}

// 2. URL fragment import.
{
  const h = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  h.inputs.mixture_ratio = 2.2;
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + M.b64urlEncode(JSON.stringify(h)));
  const got = await handoff(page);
  ok(got.inputs.mixture_ratio === 2.2, `a #h= link opens on its inputs (${got.inputs.mixture_ratio})`);
  ok(errors.length === 0, 'no errors opening a #h= link');
  await context.close();
}

// 3. Phone, dark and light: touch, layout.
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(!(await overflow(page)), `no horizontal overflow at 390 px (${scheme})`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', `${scheme} background (${bg})`);
  const before = (await handoff(page)).inputs.mixture_ratio;
  const box = await page.locator('#chart').boundingBox();
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box2 = await page.locator('#chart').boundingBox();
  await page.touchscreen.tap(box2.x + box2.width * 0.85, box2.y + box2.height * 0.5);
  await page.waitForTimeout(150);
  const after = (await handoff(page)).inputs.mixture_ratio;
  ok(after !== before && after > 3, `tapping the chart sets O/F on a phone (${before} -> ${after})`);
  ok(box.width <= 390, 'chart fits the phone');
  const fontPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#chart text')).fontSize));
  ok(fontPx >= 11, `chart text stays readable (${fontPx}px)`);
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  ok(!(await overflow(page)), `no overflow with every section open (${scheme})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phone-${scheme}.png`), fullPage: true });
  ok(errors.length === 0, `no console errors on phone (${scheme}): ${errors.join(' | ')}`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} ui checks passed`);
process.exit(failures ? 1 : 0);
