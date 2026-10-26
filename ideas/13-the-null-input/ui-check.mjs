#!/usr/bin/env node
// Drives index.html in headless Chromium: the refusal at load, the card after a price is typed or a
// marker tapped, the numbers against the Python command line's own card, phone width in dark mode,
// keyboard reach, charts and provenance. Run from the bank root: node ideas/13-the-null-input/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" and exits 0 without it.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.resolve(here, '..', '..');
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try {
  pw = createRequire(import.meta.url)('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright is not installed)');
    process.exit(0);
  }
}

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' };
const DESK = { viewport: { width: 1280, height: 860 }, colorScheme: 'light' };

const browser = await pw.chromium.launch();
async function open(opts, url = URL0) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(200);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (page, sel) => page.locator(sel).innerText();
const luminance = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : NaN;
};

// The CLI's own card at $300/kg, to compare line for line with the page's.
const cli = spawnSync('python3', ['-B', path.join(here, 'fiber_sweep.py'), '--quote', '300', '--no-sweep'], { cwd: BANK, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
ok(cli.status === 0, `CLI --quote 300 exits 0 (${cli.status})`);
const cliAdds = cli.stdout.split('\n').filter((l) => /^\s+adds \$/.test(l)).map((l) => l.trim());
ok(cliAdds.length === 5, `CLI card has five "adds" lines (${cliAdds.length})`);
const cliThr = (cli.stdout.split('\n').find((l) => /conservative single-input thresholds move:/.test(l)) || '').split('move: ')[1] || '';

// 1. Phone, dark, touch: refusal at load, marker chip, card text equals the CLI's, clear.
{
  const { context, page, errors } = await open(PHONE);
  ok(errors.length === 0, `phone: no console errors (${errors.join(' | ')})`);
  const body = await page.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
  ok(luminance(body) < 0.25, `phone: dark background (${body})`);
  ok(!(await overflow(page)), 'phone: no sideways scroll at 390 px');
  ok((await text(page, '#meta')).includes('fiber_cost_per_kg = null'), 'header shows the null input');
  ok((await text(page, '#gate-summary')).includes('19 of 19'), 'gate summary: 19 of 19 anchors');
  ok((await page.locator('#gate tbody tr').count()) === 19, 'gate table has 19 rows');
  ok((await page.locator('#gate tbody .bad').count()) === 0, 'gate table has no BAD rows');
  const ref = await text(page, '#refusal');
  ok(/null_input/.test(ref) && /fiber_cost_per_kg is null/.test(ref) && /What would help/.test(ref), 'refusal shown at load with code, reason and help');
  ok(await page.locator('#card').isHidden(), 'card hidden at load');
  const quoteSec = await text(page, '#sec-quote');
  ok(!/adds \$/.test(quoteSec), 'no fiber line printed without a price');
  ok((await page.locator('#chips .chip').count()) === 5, 'five marker chips (3 MP-001, inspace_fork, stress-test)');
  await page.locator('#chips .chip', { hasText: '$300' }).tap();
  ok((await page.locator('#price').inputValue()) === '300', 'tapping the $300 chip fills the price');
  ok(await page.locator('#card').isVisible(), 'card appears');
  const card = await text(page, '#card');
  ok(/marker, not a quote/.test(await text(page, '#card-source')), 'card says the price is a marker, not a quote');
  for (const line of cliAdds) ok(card.includes(line), `card line equals the CLI's: ${line.slice(0, 60)}…`);
  ok(card.includes(cliThr.trim()), 'card threshold line equals the CLI\'s');
  ok(/prog capex -> \$5,000M does not close/.test(card), 'card: program-capex single no longer closes at $300');
  ok(/launch -> \$1,500 closes \(Y15\)/.test(card), 'card: launch single still closes at $300');
  ok(/economics\.fiber_cost_per_kg = 300/.test(card), 'card names the rev_a key to fill');
  ok(!(await overflow(page)), 'phone: still no sideways scroll with the card open');
  await page.locator('#clear').tap();
  ok(await page.locator('#card').isHidden() && /null_input/.test(await text(page, '#refusal')), 'Clear restores the refusal');
  // sweep tables
  const sweep = await text(page, '#sweep');
  ok(/\$3,000/.test(sweep) && /Y19\*/.test(sweep), 'sweep table: conservative reaches Y19* at $3,000');
  ok(/>Y40/.test(sweep), 'sweep table: phase 3 never pays back');
  const thr = await text(page, '#thresholds');
  ok(/\$1,508/.test(thr) && /\$1,674/.test(thr) && /cannot/.test(thr), 'thresholds table shows $1,674 -> $1,508 and "cannot"');
  ok((await page.locator('#chart-relax path.series').count()) === 7, 'relaxation chart draws 7 series');
  ok((await page.locator('#legend-relax li').count()) === 7 && /cannot close past \$2,365/.test(await text(page, '#legend-relax')), 'legend lists 7 inputs and where launch stops closing');
  const vb = await page.locator('#chart-relax').getAttribute('viewBox');
  ok(Number(vb.split(' ')[2]) < 400, `phone: chart redrawn at phone width (viewBox ${vb})`);
  const fontPx = await page.locator('#chart-relax text.lbl').first().evaluate((t) => t.getBoundingClientRect().height);
  ok(fontPx >= 10, `phone: chart text renders at readable size (${fontPx.toFixed(1)} px)`);
  ok((await page.locator('#chart-singles rect.bar').count()) === 4, 'singles chart draws 4 bars');
  ok((await page.locator('#chart-singles line.marker').count()) === 5, 'singles chart draws 5 marker lines');
  ok((await page.locator('#prov li').count()) === 6 && /34935cb/.test(await text(page, '#prov')), 'provenance lists six sidecars at 34935cb');
  await context.close();
}

// 2. Desktop, light: typing, keyboard reach, multiplier, URL preload, invalid input.
{
  const { context, page, errors } = await open(DESK);
  const body = await page.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
  ok(luminance(body) > 0.8, `desktop: light background (${body})`);
  await page.locator('#price').focus();
  await page.keyboard.type('300');
  const src = await text(page, '#card-source');
  ok(/typed on this page/.test(src) && /still null/.test(src), 'typed price is labelled as typed, with rev_a still null');
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'mult'), 'Tab from the price reaches the multiplier');
  await page.locator('#mult').fill('1.3');
  const card = await text(page, '#card');
  ok(/\$300\/kg × 1\.30 .* = \$390\/kg of tether mass/.test(card), 'multiplier 1.3 gives $390/kg of tether mass');
  ok(/adds \$238M capex \(\$8,741M -> \$8,979M, \+2\.7%\)/.test(card), 'conservative adds $238M at ×1.3 (CLI agrees)');
  ok(/launch -> \$1,500 does not close/.test(card), 'at $390/kg the launch single no longer closes');
  await page.locator('#price').fill('-5');
  ok(/invalid_input/.test(await text(page, '#refusal')) && (await page.locator('#card').isHidden()), 'negative price is refused');
  await page.locator('#price').fill('1000');
  await page.locator('#mult').fill('1');
  const c1000 = await text(page, '#card');
  ok(/Conservative[^\n]*\n?adds \$609M capex/.test(c1000.replace(/\n(adds)/g, '\n$1')) || /adds \$609M capex/.test(c1000), 'at $1,000/kg the conservative case adds $609M');
  ok(/payback Y22\* -> Y23\*/.test(c1000), 'at $1,000/kg cislunar slips Y22 -> Y23');
  ok(errors.length === 0, `desktop: no console errors (${errors.join(' | ')})`);
  await context.close();
}
{
  const { context, page, errors } = await open(DESK, `${URL0}?p=300`);
  ok(await page.locator('#card').isVisible() && /the page URL \(not a quote\)/.test(await text(page, '#card-source')), '?p=300 preloads a card labelled as from the URL');
  ok(/adds \$183M capex/.test(await text(page, '#card')), 'URL-preloaded card has the $183M line');
  ok(errors.length === 0, 'URL preload: no console errors');
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
