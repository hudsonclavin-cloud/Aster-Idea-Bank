#!/usr/bin/env node
// Drives index.html in headless Chromium (the globally installed Playwright, as tools/smoke.mjs
// uses) and checks what a person would see and do: at 390 px in dark mode by touch, and at
// 1280 px in light mode by keyboard. Run from the bank root:
//   node ideas/22-said-vs-derived/ui-check.mjs
// check.mjs in this folder runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, 'page-data.js'), 'utf8'), ctx);
const RUN = ctx.window.SAID_DERIVED_RUN;
// --shots DIR saves one screenshot per size there; by default nothing is written anywhere.
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1] || '.') : null;

let pw;
try {
  pw = createRequire(import.meta.url)('playwright');
} catch {
  pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
}
const browser = await pw.chromium.launch();
let checks = 0;
let failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' };
const DESK = { viewport: { width: 1280, height: 900 }, colorScheme: 'light' };

async function open(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
  await page.goto(URL0);
  await page.waitForSelector('.finding');
  return { context, page, errors };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ------------------------------------------------------------------------------ phone, dark, touch
{
  const { context, page, errors } = await open(PHONE);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(18, 21, 26)', `dark background at 390 px (got ${bg})`);
  ok(await noOverflow(page), 'no sideways scroll at 390 px on load');

  const meta = await page.textContent('#run-meta');
  ok(meta.includes(`Aster ${RUN.meta.commit}`) && meta.includes(`${RUN.failing.length} failing`), `header names the commit and the failing count (${meta})`);

  // the four pairs, every value from the run
  const pairs = await page.$$eval('.pair', (ns) => ns.map((n) => n.innerText));
  ok(pairs.length === 4, `four pair cards (got ${pairs.length})`);
  const thr = RUN.findings.find((f) => f.path === 'src/v2/app/catalog-list/honesty-disclosure.ts' && f.line === 59);
  ok(pairs[0].includes(thr.literal) && pairs[0].includes(thr.homes[0].name) && pairs[0].includes('src/v2/app/compare/main.ts:956'), 'threshold card: the typed literal, its metadata home, and the runtime read');
  ok(pairs[1].includes('0.053 – 0.166') && pairs[1].includes('ALBEDO_C_COMPLEX') && pairs[1].includes('compare/main.ts:271'), 'albedo card: typed range, its own constants, the derived next line');
  ok(pairs[2].includes('5%') && pairs[2].includes('DETERMINISTIC_MARGIN_FRACTION') && pairs[2].includes('porkchop/main.ts:892'), 'margin card: MCP literal and the porkchop page derived read');
  ok(pairs[3].includes("'2040-01-01'") && pairs[3].includes('2040-12-31') && pairs[3].includes('typed in 4 files'), 'window card: the typed end in four files and the cache date');
  ok((await page.$$('.pair .refusal')).length === 0, 'no pair card refuses on the saved run');

  // tiles equal the run and filter by touch
  const tiles = await page.$$eval('.tile', (ns) => ns.map((n) => [n.dataset.class, Number(n.querySelector('.n').textContent.replace(/,/g, ''))]));
  ok(tiles.length === 6 && tiles.every(([c, n]) => RUN.counts[c] === n), `tile counts equal page-data (${JSON.stringify(tiles)})`);
  ok((await page.$$('#findings .finding')).length === RUN.findings.length, 'every finding listed before filtering');
  await page.tap('.tile[data-class="TWO-HOMES"]');
  const twoHomes = await page.$$eval('#findings .finding', (ns) => ns.map((n) => n.innerText));
  ok(twoHomes.length === RUN.counts['TWO-HOMES'], `TWO-HOMES tile filters to ${RUN.counts['TWO-HOMES']} (got ${twoHomes.length})`);
  ok(twoHomes.filter((t) => t.includes('Allowed:')).length === RUN.allowlist.applied, 'the allowed ones carry their reason');
  ok((await page.getAttribute('.tile[data-class="TWO-HOMES"]', 'aria-pressed')) === 'true', 'the tile reports itself pressed');
  await page.tap('.tile[data-class="TWO-HOMES"]');
  ok((await page.$$('#findings .finding')).length === RUN.findings.length, 'tapping again clears the filter');
  await page.fill('#q', '69.184');
  const n69 = (await page.$$('#findings .finding')).length;
  ok(n69 === RUN.findings.filter((f) => f.literal === '69.184').length && n69 === 7, `text filter 69.184 shows the seven retyped sites (got ${n69})`);
  ok((await page.textContent('#count')).startsWith(`${n69} of ${RUN.findings.length}`), 'the count line says how many are shown');
  await page.fill('#q', '');

  // the snippet scanner, by touch
  const tryText = await page.textContent('#try-out');
  ok(/LITERAL-MATCHES-CONSTANT/.test(tryText) && tryText.includes('metadata.feasibleC3MaxKm2S2'), 'the example snippet flags the typed threshold against the cache metadata');
  ok(tryText.includes('DETERMINISTIC_MARGIN_FRACTION') && tryText.includes('RETYPED-CONSTANT') && tryText.includes('TDB_MINUS_UTC_SECONDS'), 'the example snippet flags the margin and the retyped offset');
  ok(/line 5 · console/.test(tryText), 'the console literal is shown as console, not flagged');
  ok(/line 3 reads GRID_PARAMS\.tofMinDays/.test(tryText), 'the derived grid sentence is named as derived');
  await page.fill('#snippet', '');
  await page.tap('#scan');
  ok((await page.textContent('#try-out')).includes('Nothing to scan.'), 'empty input refuses');
  await page.fill('#snippet', 'const s = `open ${a} C3 ≤ 25 km²/s²');
  await page.tap('#scan');
  const cut = await page.textContent('#try-out');
  ok(cut.includes('could not close') && cut.includes('unterminated') && !cut.includes('LITERAL-MATCHES'), 'an unterminated template refuses and reports nothing');
  await page.fill('#snippet', "const note = 'Feasible below 25 km²/s² only';");
  await page.tap('#scan');
  const unrelated = await page.textContent('#try-out');
  ok(unrelated.includes('LITERAL-MATCHES-CONSTANT') && unrelated.includes('feasibleC3MaxKm2S2'), 'a pasted line with the threshold and the word "feasible" matches the metadata');
  await page.tap('#reset');
  ok((await page.inputValue('#snippet')).includes('GRID_PARAMS'), 'restore puts the example back');

  // open everything, still no overflow, still dark
  await page.$$eval('details', (ds) => ds.forEach((d) => (d.open = true)));
  ok(await noOverflow(page), 'no sideways scroll at 390 px with every section open');
  const rows = (await page.$$('#canon-table tbody tr')).length;
  ok(rows === RUN.canon.length, `canon table lists every home (${rows})`);
  await page.fill('#cq', 'Km2S2');
  const kmRows = await page.$$eval('#canon-table tbody tr', (ns) => ns.map((n) => n.innerText));
  ok(kmRows.length >= 3 && kmRows.every((t) => /km2s2/i.test(t)), `canon filter narrows to the C3 constants (${kmRows.length})`);
  ok((await page.textContent('#dates-body')).includes('2040-12-31'), 'the dates section names the cache end date');
  ok(errors.length === 0, `no console errors at 390 px: ${errors.join(' | ')}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'said-vs-derived-phone-dark.png') });
  await context.close();
}

// ------------------------------------------------------------------------------ desktop, light, keyboard
{
  const { context, page, errors } = await open(DESK);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(247, 246, 242)', `light background at 1280 px (got ${bg})`);
  ok(await noOverflow(page), 'no sideways scroll at 1280 px');
  await page.focus('#q');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.class);
  ok(focused === 'LITERAL-WITH-UNITS', `Shift+Tab from the filter reaches the last tile (got ${focused})`);
  await page.keyboard.press('Enter');
  const shown = (await page.$$('#findings .finding')).length;
  ok(shown === RUN.counts['LITERAL-WITH-UNITS'], `Enter on a tile filters (${shown})`);
  await page.keyboard.press('Space');
  ok((await page.$$('#findings .finding')).length === RUN.findings.length, 'Space on the same tile clears it');
  await page.focus('#snippet');
  await page.keyboard.press('Tab');
  ok((await page.evaluate(() => document.activeElement.id)) === 'scan', 'Tab from the snippet reaches the scan button');
  ok(errors.length === 0, `no console errors at 1280 px: ${errors.join(' | ')}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'said-vs-derived-desktop-light.png') });
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
