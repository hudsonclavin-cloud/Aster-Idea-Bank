#!/usr/bin/env node
// Drives index.html in headless Chromium at phone width (dark scheme, touch) and desktop width
// (light scheme) and checks that what the page shows is what the saved run wrote: the tiles, the
// 14 ladder rows and their blue input styling, the census, the checks, the provenance in the
// header; then feeds the page the snapshot workbook (same file), the shuffled fixture (refused) and
// a workbook with one changed input (drift listed), through the browser's own inflater. Run by
// check.mjs, which tools/check.mjs spawns. From the bank root:  node ideas/08-blue-cells/ui-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const BC = req(path.join(here, 'bluecells.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try {
  pw = req('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright is not installed)');
    process.exit(0);
  }
}
const data = JSON.parse(fs.readFileSync(path.join(here, 'page-data.js'), 'utf8').replace(/^[\s\S]*?window\.BLUE_CELLS_DATA = /, '').replace(/;\s*$/, ''));
const XLSX = path.join(here, 'snapshots', 'skyhook_financial_model.xlsx');
const FIXTURE = path.join(here, 'fixtures', 'shuffled_assumptions.xlsx');
const RECALC = path.join(here, 'fixtures', 'recalculated_by_libreoffice.xlsx');

// A copy of the snapshot with Assumptions!B5 changed from 2500 to 2600, as a stored zip, in a temp dir.
function storedZip(members) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, body] of members) {
    const nameB = Buffer.from(name, 'utf8');
    const crc = BC.crc32(new Uint8Array(body));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameB.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(body.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameB]));
    parts.push(local, nameB, body);
    offset += 30 + nameB.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(members.length, 8); eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-cells-'));
const DRIFT = path.join(tmp, 'drift.xlsx');
{
  const bytes = new Uint8Array(fs.readFileSync(XLSX));
  const members = [];
  for (const e of BC.readZip(bytes)) {
    let body = Buffer.from(await BC.inflateEntry(e, (u8) => new Uint8Array(zlib.inflateRawSync(u8))));
    if (e.name === 'xl/worksheets/sheet2.xml') body = Buffer.from(body.toString('utf8').replace('<c r="B5" s="17" t="n"><v>2500</v></c>', '<c r="B5" s="17" t="n"><v>2600</v></c>'), 'utf8');
    members.push([e.name, body]);
  }
  fs.writeFileSync(DRIFT, storedZip(members));
}

const browser = await pw.chromium.launch();
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

async function open(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL0);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const rgb = (s) => (s.match(/\d+/g) || []).map(Number);

// 1. Phone, dark, touch: the saved run.
{
  const { context, page, errors } = await open(PHONE);
  const meta = await page.locator('#meta').textContent();
  ok(meta.includes(data.provenance.commit.slice(0, 7)), 'header names the snapshot commit');
  ok(meta.includes(data.workbook.md5) && meta.includes(data.workbook.sha256), 'header carries md5 and sha256');
  const tiles = await page.locator('.tile .n').allTextContents();
  ok(tiles.join('|') === ['146', '0', '81', '63'].join('|'), `tiles read 146 / 0 / 81 / 63 (got ${tiles.join(' / ')})`);
  ok(Number(tiles[0]) === data.census.totals.formula_cells && Number(tiles[1]) === data.census.totals.formula_cells_with_cached_value, 'tiles equal the saved census');
  ok((await page.locator('#finding').textContent()).includes('146 formula cells and 0 cached results'), 'the finding sentence is shown');
  ok((await page.locator('#ladder tbody tr').count()) === Object.keys(data.ladder.rows).length, '14 ladder rows');
  const launch = page.locator('#ladder tbody tr[data-key="construction_launch_per_kg"]');
  const vals = await launch.locator('td.num').allTextContents();
  ok(vals.join('/') === '2500/1500/800', `launch price row reads 2500/1500/800 (got ${vals.join('/')})`);
  ok((await launch.locator('td').nth(4).textContent()) === 'B5:D5', 'launch price row names B5:D5');
  const blueCells = await page.locator('#ladder td.blue').count();
  ok(blueCells === 42, `all 42 ladder cells are marked blue (${blueCells})`);
  const colour = rgb(await launch.locator('td.num').first().evaluate((el) => getComputedStyle(el).color));
  ok(colour.length >= 3 && colour[2] > colour[0] + 40 && colour[2] > colour[1] + 20, `blue cells render blue in dark mode (rgb ${colour.join(',')})`);
  const yellow = await page.locator('#ladder td.yellow').count();
  ok(yellow === 3, `the three yellow-filled ladder cells (B8:D8) are marked (${yellow})`);
  ok((await page.locator('#ladder tbody tr[data-key="tip_speed_kms"] td.num').allTextContents()).join('/') === '2.5/2.5/2.5', 'tip speed is 2.5 in every column');
  const census = await page.locator('#census tbody tr').allInnerTexts();
  ok(census.length === 6, 'census has five sheets and a total');
  ok(/Design Calcs\s+143\s+81\s+0\s+0\s+58/.test(census[2]), `Design Calcs row reads 143 / 81 / 0 / 0 / 58 (${census[2].replace(/\s+/g, ' ')})`);
  ok(/TOTAL\s+395\s+146\s+0\s+81\s+164\s+63\s+5\s+4/.test(census[5]), `total row reads 395 / 146 / 0 / 81 / 164 / 63 / 5 / 4 (${census[5].replace(/\s+/g, ' ')})`);
  ok((await page.locator('#checks li').count()) === data.checks.length && (await page.locator('#checks li.bad').count()) === 0, 'six checks, none failing');
  const design = await page.locator('#design tbody tr td.key').allTextContents();
  ok(design.includes('com_altitude_km') && design.includes('earth_radius_km') && design.length === 12, '10 design-point rows and 2 constants listed');
  const bg = rgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  ok(bg[0] < 60 && bg[1] < 60 && bg[2] < 60, `dark scheme gives a dark background (${bg.join(',')})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px');
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  await page.locator('#tiles').first().tap();
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px with every section open');
  // The same reader in the browser, on the committed file: byte-identical.
  await page.setInputFiles('#file', XLSX);
  await page.waitForFunction(() => /Same file|Not the committed|Refused|Cannot/.test(document.querySelector('#own').textContent), null, { timeout: 10000 });
  const own = await page.locator('#own').innerText();
  ok(own.includes('Same file as the snapshot') && own.includes(data.workbook.md5), 'the snapshot workbook is recognised as byte-identical, with its md5');
  ok(own.includes(data.workbook.sha256), 'the browser computed the same sha256');
  const rep = await page.locator('#own-report').textContent();
  ok(rep.includes('TOTAL                     395       146       0       81'), 'the in-browser report has the same census line as the CLI');
  ok(rep.includes('construction_launch_per_kg            2500          1500           800  B5:D5'), 'the in-browser report has the same ladder line as the CLI');
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px with the report shown');
  // The shuffled fixture: refused, naming the row.
  await page.setInputFiles('#file', FIXTURE);
  await page.waitForFunction(() => /Refused/.test(document.querySelector('#own').textContent), null, { timeout: 10000 });
  const refused = await page.locator('#own').innerText();
  ok(refused.includes("ladder row 5 (construction_launch_per_kg): column A reads 'Boost price to customer ($/kg)'"), 'the shuffled fixture is refused with the row and labels named');
  ok(await page.locator('#own-report').isHidden(), 'no report is shown for a refused file');
  ok(errors.length === 0, `no console errors on the phone (${errors.join(' | ')})`);
  await context.close();
}

// 2. Desktop, light: drift detection, copy, keyboard.
{
  const { context, page, errors } = await open(DESK);
  await page.setInputFiles('#file', DRIFT);
  await page.waitForFunction(() => /Not the committed|Same file|Refused|Cannot/.test(document.querySelector('#own').textContent), null, { timeout: 10000 });
  const own = await page.locator('#own').innerText();
  ok(own.includes('Not the committed file'), 'a changed workbook is not called the committed one');
  ok(own.includes('1 ladder cell differ') && own.includes('construction_launch_per_kg Conservative (B5): snapshot 2500 → yours 2600'), `the one changed cell is listed with both values (${own.split('\n').find((l) => l.includes('B5')) || 'no B5 line'})`);
  ok(!own.includes('cached result'), 'no cached results are reported for a file that stores none');
  // A copy re-saved by LibreOffice: same inputs, 146 cached results, shared strings.
  await page.setInputFiles('#file', RECALC);
  await page.waitForFunction(() => /146 cached results|Refused|Cannot/.test(document.querySelector('#own').textContent), null, { timeout: 10000 });
  const lo = await page.locator('#own').innerText();
  ok(lo.includes('Not the committed file') && lo.includes('All 42 ladder cells equal the snapshot'), 'the recalculated copy keeps the same 42 inputs');
  ok(lo.includes('Your copy stores 146 cached results'), 'the recalculated copy is reported as storing 146 cached results');
  ok(lo.includes('written by LibreOffice'), 'the writer of the dropped file is named');
  const loReport = await page.locator('#own-report').textContent();
  ok(/TOTAL\s+395\s+146\s+146\s+81/.test(loReport), 'the in-browser report shows 146 formulas, 146 cached for the recalculated copy');
  ok(loReport.includes('shared strings: 158'), 'the in-browser report counts the shared strings');
  const bg = rgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  ok(bg[0] > 200 && bg[1] > 200 && bg[2] > 200, `light scheme gives a light background (${bg.join(',')})`);
  await page.locator('#copy-report').click();
  await page.waitForTimeout(150);
  const status = await page.locator('#copy-status').textContent();
  ok(status.length > 0, 'Copy reports what it did');
  const copied = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
  const shown = await page.locator('#copy-fallback').isVisible();
  ok((copied && copied.includes('Checks    6 of 6 passed')) || (shown && (await page.locator('#copy-fallback').textContent()).includes('Checks    6 of 6 passed')), 'the copied (or shown) report is the saved run');
  await page.locator('#copy-json').click();
  await page.waitForTimeout(150);
  const copiedJson = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
  const fb = await page.locator('#copy-fallback').isVisible() ? await page.locator('#copy-fallback').textContent() : '';
  const jsonText = (copiedJson && copiedJson.trim().startsWith('{')) ? copiedJson : fb;
  let parsed = null;
  try { parsed = JSON.parse(jsonText); } catch { /* reported below */ }
  ok(parsed && parsed.workbook && parsed.workbook.md5 === data.workbook.md5 && parsed.census.totals.formula_cells === 146, 'the copied ladder.json parses and carries the md5 and census');
  await page.focus('#copy-json');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  ok(!!focused && focused !== 'BODY', `Tab moves focus to a control (${focused})`);
  await page.focus('#file');
  ok((await page.evaluate(() => document.activeElement.id)) === 'file', 'the file input is keyboard-focusable');
  ok((await page.locator('#ladder tbody tr').count()) === 14, '14 ladder rows at desktop width');
  ok(errors.length === 0, `no console errors on the desktop (${errors.join(' | ')})`);
  await context.close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
