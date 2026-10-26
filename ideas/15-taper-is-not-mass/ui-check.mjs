#!/usr/bin/env node
// Drives index.html in headless Chromium and checks what a person sees: the numbers against the
// canon file, the refusals, snapping, keyboard, mouse and touch, phone width and dark mode, and
// the page's behaviour when the canon is withheld or tampered with. Uses the globally installed
// Playwright, as tools/smoke.mjs does; prints "skipped" and exits 0 if it is not installed.
// From the bank root: node ideas/15-taper-is-not-mass/ui-check.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require('./model.js');
const json = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'rev_a.json'), 'utf8'));
const LB = json.mass_ratio.integrated_tether_to_payload_both_arms;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright not installed)');
    process.exit(0);
  }
}

let checks = 0;
let failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log('FAIL ' + msg);
  }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' };
const DESK = { viewport: { width: 1280, height: 900 }, colorScheme: 'light' };
const browser = await pw.chromium.launch();

async function open(opts, url = URL0) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  const uncaught = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => uncaught.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(150);
  return { context, page, errors, uncaught };
}
const tiles = (page) => page.$$eval('#tiles .tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent.trim(), t.querySelector('.v').textContent.trim()])));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const vOut = (page) => page.textContent('#v-out');
const snap = (page, re) => page.locator('#snaps button', { hasText: re }).click();
const fmt2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A section that throws (a locator that never appears) counts as one failure, and the run goes on.
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: stopped by ${String(e.message).split('\n')[0]}`);
  }
}

// 1. Desktop, light, from file://
await section('desktop', async () => {
  const { context, page, errors, uncaught } = await open(DESK);
  const t = await tiles(page);
  ok(t['Mass ratio, EQ-6'] === fmt2(LB.conservative_30pct_derate) + '×', `mass tile ${t['Mass ratio, EQ-6']} vs rev_a.json ${LB.conservative_30pct_derate}`);
  const Vc = M.characteristicVelocityKms(json.materials.tensile_strength_GPa, json.materials.density_kgm3);
  const ev = M.evaluate({ vTipKms: json.kinematics.v_tip_kms, derate: json.materials.derate_fraction, SF: json.materials.safety_factor, sigmaGPa: json.materials.tensile_strength_GPa, rhoKgm3: json.materials.density_kgm3, payloadKg: LB.payload_mass_kg_for_tonnage });
  ok(t['Taper, EQ-5'] === fmt2(ev.taper), `taper tile ${t['Taper, EQ-5']}`);
  ok(Math.round(ev.taper * 10) / 10 === 20.1, 'the glossary\'s 20.1');
  ok(t['x'] === ev.x.toFixed(3), `x tile ${t['x']}`);
  ok(t['Mass ÷ taper'] === ev.gap.toFixed(2), `gap tile ${t['Mass ÷ taper']}`);
  ok(t['Fibre mass'] === LB.conservative_30pct_fiber_mass_t.toLocaleString('en-US', { minimumFractionDigits: 1 }) + ' t', `fibre tile ${t['Fibre mass']}`);
  ok(t['v_tip / V_c'] === (json.kinematics.v_tip_kms / Vc).toFixed(3), 'v/Vc tile');
  ok((await page.textContent('#canon-count')).startsWith('14 of 14 ladder values re-derived'), 'canon count');
  ok((await page.textContent('#canon-line')).includes('34935cb'), 'commit shown');
  ok((await page.locator('#ledger tr[data-status="reproduces"]').count()) === 14, '14 ladder rows reproduce');
  ok((await page.locator('#ledger tr[data-status="matches as rounded"]').count()) === 3, '3 rounded rows match');
  ok((await page.locator('#history li[data-status="exact"]').count()) === 5, '5 history claims exact');
  ok((await page.locator('#history li[data-claim="creep72"][data-status="no"]').count()) === 1, 'item 10 claim does not reproduce');
  ok((await page.textContent('#history li[data-claim="creep72"]')).includes('484.06'), 'item 10 shows 484.06');
  ok((await page.locator('#plot-curves [data-mark^="rung:"]').count()) === 5, '5 rung rings');
  ok((await page.locator('#plot-curves [data-mark^="claim:"]').count()) === 2, '2 historical diamonds');
  ok((await page.locator('#plot-curves circle[stroke="var(--crit)"]').count()) === 0, 'no ring is red');
  ok((await page.locator('#crossover').count()) === 1, 'crossover dot drawn');
  // Pinned to the closed form: 2·sqrt(pi)·x·erf(x) = 1 at x = 0.5224 (taper.test.mjs checks the equation).
  ok((await page.locator('#crossover + text').textContent()) === 'equal at x = 0.522', 'crossover label');
  const cx = Number(await page.locator('#crossover').getAttribute('cx'));
  const vStar = 0.5224186 * Vc * Math.sqrt((1 - json.materials.derate_fraction) / json.materials.safety_factor);
  const svgBox = await page.locator('#plot-curves svg').boundingBox();
  ok(Math.abs(cx - (46 + (vStar - 0.5) / 3.5 * (svgBox.width - 60))) < 1, `crossover drawn at v* = ${vStar.toFixed(3)} km/s`);
  ok((await page.locator('#guard-label').textContent()) === 'v/V_c > 1.3', 'guardrail label from _ratio_note');
  ok((await page.locator('#curve-mass').getAttribute('d')).length > 200, 'mass curve drawn');
  ok((await page.textContent('#factors')).includes(fmt2(LB.conservative_30pct_derate)), 'factor line ends at the canon value');
  // snaps
  await snap(page, /^Phase 3/);
  ok((await tiles(page))['Mass ratio, EQ-6'] === fmt2(LB.phase3_3p5kms_30pct_derate) + '×', 'Phase 3 snap gives 3,085.95×');
  ok((await page.locator('#snaps button', { hasText: /^Phase 3/ }).getAttribute('aria-pressed')) === 'true', 'snap pressed state');
  await snap(page, /^Cislunar/);
  ok((await tiles(page))['Mass ratio, EQ-6'] === fmt2(LB.cislunar_2p8kms_30pct_derate) + '×', 'cislunar snap gives 295.27×');
  await snap(page, /440× ghost/);
  ok((await tiles(page))['Mass ratio, EQ-6'] === '440.40×', 'ghost snap gives 440.40×');
  await snap(page, /^Item 10/);
  ok((await tiles(page))['Mass ratio, EQ-6'] === '484.06×', 'item 10 snap gives 484.06×');
  // keyboard on the slider
  await snap(page, /^Conservative/);
  await page.focus('#v');
  await page.keyboard.press('ArrowRight');
  ok((await vOut(page)) === (json.kinematics.v_tip_kms + 0.01).toFixed(2) + ' km/s', 'ArrowRight moves the tip speed by 0.01');
  // keyboard on a ring
  const ring = page.locator('#plot-curves [data-mark$="optimistic_0pct_derate"]');
  await ring.focus();
  await page.keyboard.press('Enter');
  ok((await tiles(page))['Mass ratio, EQ-6'] === fmt2(LB.optimistic_0pct_derate) + '×', 'Enter on the optimistic ring sets 40.32×');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-mark') !== null), 'focus stays on the ring after redraw');
  // mouse: hover shows a tooltip, a drag sets the tip speed
  const box = await page.locator('#plot-curves svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  ok(!(await page.locator('#tooltip').isHidden()), 'hover shows the tooltip');
  ok((await page.textContent('#tooltip')).includes('km/s'), 'tooltip names the tip speed');
  await page.mouse.down();
  await page.mouse.move(box.x + 46 + (box.width - 60) * (0.5 / 3.5), box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  const v1 = parseFloat(await vOut(page));
  ok(Math.abs(v1 - 1.0) < 0.03, `drag to 1.0 km/s set ${v1}`);
  // Below the crossover the sentence says the taper overstates the mass.
  await page.locator('#v').fill('0.5');
  ok((await page.textContent('#sentence')).includes('overstates'), 'below x* the sentence flips');
  // SK99: refused, no numbers
  const sk = await page.$eval('#material', (s) => [...s.options].find((o) => /SK99/.test(o.textContent)).value);
  await page.selectOption('#material', sk);
  ok(!(await page.locator('#refusal').isHidden()), 'SK99 shows a refusal');
  ok(/no density/.test(await page.textContent('#refusal')), 'refusal says what is missing');
  ok(Object.values(await tiles(page)).every((v) => v === '—'), 'no tile shows a number for SK99');
  ok((await page.locator('#curve-mass').count()) === 0, 'no curve for SK99');
  // T1100G: density from the note
  const t1 = await page.$eval('#material', (s) => [...s.options].find((o) => /T1100G/.test(o.textContent)).value);
  await page.selectOption('#material', t1);
  ok(/read from the note/.test(await page.textContent('#mat-note')), 'T1100G says its density came from a note');
  ok(/×$/.test((await tiles(page))['Mass ratio, EQ-6']), 'T1100G computes');
  // custom fibre: refused until typed, then dashed and marked not canon
  await page.selectOption('#material', 'custom');
  ok(!(await page.locator('#custom').isHidden()), 'custom inputs shown');
  ok(!(await page.locator('#refusal').isHidden()), 'empty custom fibre is refused');
  await page.fill('#c-sigma', '3.6');
  await page.fill('#c-rho', '970');
  ok((await page.locator('#refusal').isHidden()), 'typed custom fibre computes');
  ok((await page.locator('#curve-mass').getAttribute('stroke-dasharray')) !== null, 'custom curves are dashed');
  ok((await page.locator('#mat-note .notcanon').count()) === 1, 'custom fibre marked not canon');
  await page.fill('#c-sigma', '0');
  ok(!(await page.locator('#refusal').isHidden()), 'zero strength refused');
  // extremes
  await page.selectOption('#material', canon0());
  await page.locator('#v').fill('4');
  await page.locator('#d').fill('50');
  await page.locator('#sf').fill('5');
  ok(/10[⁰¹²³⁴⁵⁶⁷⁸⁹]+×$/.test((await tiles(page))['Mass ratio, EQ-6']), 'extreme corner shows a finite number in scientific form');
  ok(errors.length === 0 && uncaught.length === 0, 'desktop: no console errors: ' + errors.concat(uncaught).join(' | '));
  await context.close();
});
function canon0() {
  return 'primary';
}

// 2. Phone, dark, touch
await section('phone', async () => {
  const { context, page, errors, uncaught } = await open(PHONE);
  ok(!(await overflow(page)), 'phone: no sideways scroll');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(13, 13, 13)', 'phone: dark page plane ' + bg);
  const box = await page.locator('#plot-curves svg').boundingBox();
  ok(box.width <= 390, 'phone: chart fits');
  // touch drag via pointer events
  await page.evaluate(({ x0, x1, y }) => {
    const box = document.getElementById('plot-curves');
    const ev = (type, x) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, isPrimary: true });
    const svg = box.querySelector('svg');
    svg.dispatchEvent(ev('pointerdown', x0));
    box.dispatchEvent(ev('pointermove', (x0 + x1) / 2));
    box.dispatchEvent(ev('pointermove', x1));
    box.dispatchEvent(ev('pointerup', x1));
  }, { x0: box.x + box.width * 0.5, x1: box.x + box.width * 0.85, y: box.y + box.height * 0.5 });
  const v = parseFloat(await vOut(page));
  ok(v > 3 && v < 4, 'phone: touch drag moved the tip speed to ' + v);
  ok(await page.locator('#tooltip').isHidden(), 'phone: tooltip hides after the touch ends');
  // tap a ring
  await page.locator('#plot-curves').scrollIntoViewIfNeeded();
  const ring = await page.locator('#plot-curves [data-mark$="baseline_15pct_derate"] .hit').boundingBox();
  await page.touchscreen.tap(ring.x + ring.width / 2, ring.y + ring.height / 2);
  ok((await tiles(page))['Mass ratio, EQ-6'] === fmt2(LB.baseline_15pct_derate) + '×', 'phone: tapping the baseline ring sets 64.30×');
  for (const pick of ['custom', 'alt:Dyneema_SK99']) {
    await page.selectOption('#material', pick);
    ok(!(await overflow(page)), 'phone: no sideways scroll with ' + pick);
  }
  ok(errors.length === 0 && uncaught.length === 0, 'phone: no console errors: ' + errors.concat(uncaught).join(' | '));
  await context.close();
});

// 3. Over HTTP: the canon withheld, then tampered with
const dataPath = path.join(here, 'snapshots', 'rev_a.data.js');
let mode = 'ok';
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(here)) return res.writeHead(403).end();
  if (p === dataPath && mode === 'withheld') return res.writeHead(404).end('withheld');
  let body;
  try {
    body = fs.readFileSync(p);
  } catch {
    return res.writeHead(404).end();
  }
  if (p === dataPath && mode === 'sigma') body = Buffer.from(body.toString().replace('"tensile_strength_GPa": 5.8', '"tensile_strength_GPa": 5.7'));
  if (p === dataPath && mode === 'nodensity') body = Buffer.from(body.toString().replace(/"density_kgm3": \d+,/, ''));
  const type = p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html';
  res.writeHead(200, { 'content-type': type + '; charset=utf-8' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
await section('withheld', async () => {
  mode = 'withheld';
  const { context, page, uncaught } = await open(DESK, base);
  ok(!(await page.locator('#notice').isHidden()), 'withheld: the notice shows');
  ok(/No canon file, no numbers/.test(await page.textContent('#notice')), 'withheld: says so');
  ok(Object.values(await tiles(page)).every((v) => v === '—'), 'withheld: no tile shows a number');
  ok(!/\d/.test(await page.textContent('#ledger tbody')), 'withheld: ledger shows no digits');
  ok(!/\d/.test(await page.textContent('#history')), 'withheld: history shows no digits');
  ok(await page.locator('#v').isDisabled(), 'withheld: controls disabled');
  ok(uncaught.length === 0, 'withheld: no uncaught errors: ' + uncaught.join(' | '));
  await context.close();
});
await section('tampered', async () => {
  mode = 'sigma';
  const { context, page, uncaught } = await open(DESK, base);
  ok((await page.textContent('#canon-count')).startsWith('0 of 14'), 'tampered σ: no badge survives');
  const tj = JSON.parse(JSON.stringify(json));
  tj.materials.tensile_strength_GPa = 5.7;
  const tc = M.readCanon({ data: tj });
  const expectDiffer = tc.ladder.filter((r) => r.status === 'differs').length + tc.rounded.filter((r) => r.status === 'differs').length;
  ok(tc.ladder.every((r) => r.status === 'differs'), 'tampered σ: the model flags all 14 ladder values');
  ok((await page.locator('#ledger tr[data-status="differs"]').count()) === expectDiffer, `tampered σ: ${expectDiffer} rows differ on the page`);
  ok((await page.locator('#plot-curves circle[stroke="var(--crit)"]').count()) === 5, 'tampered σ: 5 red rings');
  ok(uncaught.length === 0, 'tampered σ: no uncaught errors');
  await context.close();
});
await section('no density', async () => {
  mode = 'nodensity';
  const { context, page, uncaught } = await open(DESK, base);
  ok(!(await page.locator('#refusal').isHidden()), 'no density: the primary fibre is refused');
  ok((await page.locator('#ledger tr[data-status="refused"]').count()) === 14, 'no density: 14 ladder rows refused');
  ok(Object.values(await tiles(page)).every((v) => v === '—'), 'no density: no tile shows a number');
  ok(uncaught.length === 0, 'no density: no uncaught errors');
  await context.close();
});
server.close();
await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
