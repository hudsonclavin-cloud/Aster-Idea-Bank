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
const cliMaterial = (cli.stdout.split('\n').find((l) => /^\s+material: /.test(l)) || '').trim();
ok(/Zylon PBO/.test(cliMaterial), `CLI card names the material (${cliMaterial.slice(0, 40)})`);

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
  ok((await page.locator('#chips .chip').count()) === 9, 'nine marker chips (3 MP-001, 3 inspace_fork, 3 stress-test sim)');
  ok(/^9 fiber prices from 3 sources/.test(await text(page, '#markers-lead')), 'markers section counts nine prices from three sources');
  await page.locator('#chips .chip', { hasText: '$300' }).tap();
  ok((await page.locator('#price').inputValue()) === '300', 'tapping the $300 chip fills the price');
  ok(await page.locator('#card').isVisible(), 'card appears');
  const card = await text(page, '#card');
  ok(/marker, not a quote/.test(await text(page, '#card-source')), 'card says the price is a marker, not a quote');
  for (const line of cliAdds) ok(card.includes(line), `card line equals the CLI's: ${line.slice(0, 60)}…`);
  ok(card.includes(cliThr.trim()), 'card threshold line equals the CLI\'s');
  ok((await text(page, '#card-material')).trim() === cliMaterial, `card material line equals the CLI's (${await text(page, '#card-material')})`);
  ok(/prog capex -> \$5,000M does not close/.test(card), 'card: program-capex single no longer closes at $300');
  ok(/launch -> \$1,500 closes \(Y15\)/.test(card), 'card: launch single still closes at $300');
  ok(/economics\.fiber_cost_per_kg = 300/.test(card), 'card names the rev_a key to fill');
  ok(!(await overflow(page)), 'phone: still no sideways scroll with the card open');
  await page.locator('#clear').tap();
  ok(await page.locator('#card').isHidden() && /null_input/.test(await text(page, '#refusal')), 'Clear restores the refusal');
  // a quote for another fiber is refused, not multiplied by the PBO mass
  await page.locator('#chips .chip', { hasText: '$300' }).tap();
  await page.locator('#material').selectOption('uhmwpe');
  const mref = await text(page, '#refusal');
  ok(/material_not_in_canon/.test(mref) && /SK78/.test(mref) && (await page.locator('#card').isHidden()), 'UHMWPE (FibrXL SK78) quote is refused with material_not_in_canon');
  ok(!/adds \$/.test(await text(page, '#sec-quote')), 'no fiber line for a non-PBO quote');
  ok(await page.locator('#refusal p').first().evaluate((p) => p.scrollWidth <= p.clientWidth + 1), 'phone: the refusal text wraps inside its box');
  const cliMat = spawnSync('python3', ['-B', path.join(here, 'fiber_sweep.py'), '--quote', '300', '--material', 'uhmwpe', '--no-sweep'], { cwd: BANK, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const cliWhat = ((cliMat.stderr.split('\n').find((l) => /^refused \(material_not_in_canon\): /.test(l)) || '').split('): ')[1] || '').trim();
  ok(cliMat.status === 2 && cliWhat.length > 50 && mref.includes(cliWhat), 'the page\'s material refusal reads as the CLI\'s, word for word');
  await page.locator('#material').selectOption('pbo');
  ok(await page.locator('#card').isVisible(), 'back to Zylon PBO the card returns');
  ok(!(await overflow(page)), 'phone: no sideways scroll with the material refusal shown');
  await page.locator('#clear').tap();
  // sweep tables
  const sweep = await text(page, '#sweep');
  ok(/\$3,000/.test(sweep) && /Y19\*/.test(sweep), 'sweep table: conservative reaches Y19* at $3,000');
  ok(/>Y40/.test(sweep), 'sweep table: phase 3 never pays back');
  const thr = await text(page, '#thresholds');
  ok(/\$1,508/.test(thr) && /\$1,674/.test(thr) && /cannot/.test(thr), 'thresholds table shows $1,674 -> $1,508 and "cannot"');
  ok((await page.locator('#chart-relax path.series').count()) === 7, 'relaxation chart draws 7 series');
  const legend = await text(page, '#legend-relax');
  ok((await page.locator('#legend-relax li').count()) === 7 && (legend.match(/cannot close above \$2,114\/kg/g) || []).length === 2 && !/2,365/.test(legend),
    'legend lists 7 inputs; launch and hw factor cannot close above $2,114/kg (exact, not the grid\'s $2,365)');
  const launchEnd = Number(await page.locator('#chart-relax path.series[data-field="construction_launch_per_kg"]').getAttribute('data-end'));
  ok(Math.abs(launchEnd - 2113.82) < 0.01, `launch series ends at the exact vanish price (${launchEnd})`);
  ok(/launch \$2,114/.test(await text(page, '#thresholds-note')), 'threshold note lists the exact vanish prices');
  const vb = await page.locator('#chart-relax').getAttribute('viewBox');
  ok(Number(vb.split(' ')[2]) < 400, `phone: chart redrawn at phone width (viewBox ${vb})`);
  const fontPx = await page.locator('#chart-relax text.lbl').first().evaluate((t) => t.getBoundingClientRect().height);
  ok(fontPx >= 10, `phone: chart text renders at readable size (${fontPx.toFixed(1)} px)`);
  ok((await page.locator('#chart-singles rect.bar').count()) === 4, 'singles chart draws 4 bars');
  ok((await page.locator('#chart-singles line.marker').count()) === 9, 'singles chart draws 9 marker lines');
  ok((await page.locator('#prov li').count()) === 7 && /34935cb/.test(await text(page, '#prov')) && /outreach_log\.md/.test(await text(page, '#prov')), 'provenance lists seven sidecars at 34935cb, outreach_log.md among them');
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
  await page.locator('#price').fill('1e308');
  ok(/invalid_input/.test(await text(page, '#refusal')) && (await page.locator('#card').isHidden()) && !/Infinity|NaN/.test(await text(page, '#sec-quote')), '1e308 $/kg is refused, no Infinity on the page');
  await page.locator('#price').fill('300');
  await page.locator('#mult').fill('1e308');
  ok(/invalid_input/.test(await text(page, '#refusal')) && (await page.locator('#card').isHidden()) && !/Infinity|NaN/.test(await text(page, '#sec-quote')), 'multiplier 1e308 is refused, no Infinity on the page');
  await page.locator('#price').fill('-0');
  await page.locator('#mult').fill('1');
  ok(/fiber_cost_per_kg = 0 /.test((await text(page, '#card')) + ' ') && !/\$-0|= -0/.test(await text(page, '#card')), '-0 reads as 0');
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
