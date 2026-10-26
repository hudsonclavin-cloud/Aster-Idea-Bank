#!/usr/bin/env node
// index.html in headless Chromium, phone (dark, touch) and desktop (light): the page shows the saved
// run (tiles, ladder, blue cells, census, checks, provenance) with no clipped value at 390 px, and
// the drop zone handles the snapshot (same), the shuffled and pre-fix files (refused), a corrupt
// member and a cut sheet part (unreadable), one changed input (listed) and the LibreOffice copy
// (146 cached). Run by check.mjs. From the bank root:  node ideas/08-blue-cells/ui-check.mjs
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
const PRE_FIX = path.join(here, 'fixtures', 'pre_fix_7bb5b5f.xlsx');

// Stored zips the tests build: the snapshot with one edit to sheet2.xml.
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
async function variant(file, edit) {
  const members = [];
  for (const e of BC.readZip(new Uint8Array(fs.readFileSync(XLSX)))) {
    const body = Buffer.from(await BC.inflateEntry(e, (u8) => new Uint8Array(zlib.inflateRawSync(u8))));
    members.push([e.name, e.name === 'xl/worksheets/sheet2.xml' ? edit(body) : body]);
  }
  fs.writeFileSync(path.join(tmp, file), storedZip(members));
  return path.join(tmp, file);
}
// B5 2500 -> 2600; and sheet2.xml cut 50 bytes short, after </sheetData> (a sound zip, broken XML).
const DRIFT = await variant('drift.xlsx', (b) => Buffer.from(b.toString('utf8').replace('<v>2500</v>', '<v>2600</v>')));
const TRUNCATED = await variant('truncated.xlsx', (b) => b.subarray(0, b.length - 50));
// One byte inverted 50 bytes into sheet2.xml's deflate data, as the unit tests do.
const CORRUPT = path.join(tmp, 'corrupt.xlsx');
{
  const bytes = new Uint8Array(fs.readFileSync(XLSX));
  const e = BC.readZip(bytes).find((x) => x.name === 'xl/worksheets/sheet2.xml');
  bytes[e.data.byteOffset + 50] ^= 0xff;
  fs.writeFileSync(CORRUPT, bytes);
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
// Choose a file in the drop zone; wait for a verdict matching re; return the verdict's text.
async function dropFile(page, file, re) {
  await page.setInputFiles('#file', file);
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#own').textContent), re, { timeout: 10000 });
  return page.locator('#own').innerText();
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
  ok(colour.length >= 3 && colour[2] > colour[0] + 40 && colour[2] > colour[1] + 20, `blue in dark mode (${colour.join(',')})`);
  const yellow = await page.locator('#ladder td.yellow').count();
  ok(yellow === 3, `the three yellow-filled ladder cells (B8:D8) are marked (${yellow})`);
  ok((await page.locator('#ladder tbody tr[data-key="tip_speed_kms"] td.num').allTextContents()).join('/') === '2.5/2.5/2.5', 'tip speed 2.5 everywhere');
  const census = await page.locator('#census tbody tr').allInnerTexts();
  ok(census.length === 6, 'census has five sheets and a total');
  ok(/Design Calcs\s+143\s+81\s+0\s+0\s+58/.test(census[2]), `Design Calcs row (${census[2].replace(/\s+/g, ' ')})`);
  ok(/TOTAL\s+395\s+146\s+0\s+81\s+164\s+63\s+5\s+4/.test(census[5]), `total row (${census[5].replace(/\s+/g, ' ')})`);
  ok((await page.locator('#checks li').count()) === 4 && (await page.locator('#checks li.bad').count()) === 0, 'four checks, none failing');
  ok((await page.locator('#guards li.held').count()) === 2, 'two guards listed as held');
  const design = await page.locator('#design tbody tr td.key').allTextContents();
  ok(design.includes('com_altitude_km') && design.includes('earth_radius_km') && design.length === 12, '10 design rows, 2 constants');
  const bg = rgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  ok(bg[0] < 60 && bg[1] < 60 && bg[2] < 60, `dark scheme gives a dark background (${bg.join(',')})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px');
  // Every value cell of the three tables lies wholly inside its wrapper's visible box: nothing is
  // clipped mid-number or hidden behind a sideways scroll.
  for (const id of ['ladder', 'design', 'census']) {
    const r = await page.evaluate((tid) => {
      const wrap = document.getElementById(tid).closest('.tablewrap');
      const w = wrap.getBoundingClientRect();
      const cells = [...document.querySelectorAll(`#${tid} td.num`)];
      const out = cells.filter((td) => { const b = td.getBoundingClientRect(); return b.left < w.left - 0.5 || b.right > w.right + 0.5 || b.width < 1; });
      return { n: cells.length, out: out.map((td) => td.textContent), scroll: wrap.scrollWidth - wrap.clientWidth };
    }, id);
    ok(r.n > 0 && r.out.length === 0 && r.scroll <= 1, `#${id}: ${r.n} value cells inside the wrapper (clipped: ${r.out.join(', ') || 'none'}; scroll ${r.scroll})`);
  }
  const first = await page.evaluate(() => [...document.querySelectorAll('#ladder tbody tr:first-child td.num')].map((td) => {
    const b = td.getBoundingClientRect(); return { text: td.textContent, label: getComputedStyle(td, '::before').content, right: b.right };
  }));
  ok(first.map((x) => x.text).join('/') === '0.7/0.85/1' && first.every((x) => x.right <= 390 - 16), `row 1 reads 0.7/0.85/1 (${first.map((x) => x.text).join('/')})`);
  ok(first.map((x) => x.label.replace(/"/g, '')).join('/') === 'Conservative/Baseline/Optimistic', `values labelled by column (${first.map((x) => x.label).join('/')})`);
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  await page.locator('#tiles').first().tap();
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), 'no overflow with every section open');
  // The same reader in the browser, on the committed file: byte-identical.
  const own = await dropFile(page, XLSX, 'Same file|Not the committed|Refused|Cannot');
  ok(own.includes('Same file as the snapshot') && own.includes(data.workbook.md5), 'snapshot recognised as byte-identical');
  ok(own.includes(data.workbook.sha256), 'the browser computed the same sha256');
  const rep = await page.locator('#own-report').textContent();
  ok(rep.includes('TOTAL                     395       146       0       81'), 'in-browser census line = CLI');
  ok(rep.includes('construction_launch_per_kg            2500          1500           800  B5:D5'), 'in-browser ladder line = CLI');
  ok(!(await overflow(page)), 'no overflow with the report shown');
  // The shuffled fixture: refused, naming the row.
  const refused = await dropFile(page, FIXTURE, 'Refused');
  ok(refused.includes("ladder row 5 (construction_launch_per_kg): column A reads 'Boost price to customer ($/kg)'"), 'shuffled fixture refused on row 5');
  ok(await page.locator('#own-report').isHidden(), 'no report for a refused file');
  // The workbook as it was before the ladder fix: refused on row 3.
  ok((await dropFile(page, PRE_FIX, 'row 3')).includes("ladder row 3 (strength_retention): column A reads 'Fiber strength derate (joints/weave/aging)'"), 'pre-fix refused on row 3');
  // A corrupt member: cannot be read, the member named, no fetch-style message.
  const bad = await dropFile(page, CORRUPT, 'Cannot read');
  ok(bad.includes('Cannot read this file as a workbook') && bad.includes('member xl/worksheets/sheet2.xml could not be read: its deflate data is corrupt'), `corrupt member named (${bad.slice(0, 120)})`);
  ok(!/Failed to fetch/i.test(bad), 'not reported as a network failure');
  ok(await page.locator('#own-report').isHidden(), 'no report for an unreadable file');
  // A sound zip whose sheet part was cut short after </sheetData>: unreadable, not "all 42 equal".
  const cut = await dropFile(page, TRUNCATED, 'not well-formed|Same file|Not the committed|Refused');
  ok(cut.includes('Cannot read this file as a workbook') && cut.includes('xl/worksheets/sheet2.xml is not well-formed XML') && !cut.includes('ladder cells equal'), `cut sheet part unreadable (${cut.slice(0, 120)})`);
  ok(await page.locator('#own-report').isHidden(), 'no report for a cut sheet part');
  ok(errors.length === 0, `no console errors on the phone (${errors.join(' | ')})`);
  await context.close();
}

// 2. Desktop, light: drift detection, copy, keyboard.
{
  const { context, page, errors } = await open(DESK);
  const own = await dropFile(page, DRIFT, 'Not the committed|Same file|Refused|Cannot');
  ok(own.includes('Not the committed file'), 'a changed workbook is not the committed one');
  ok(own.includes('1 ladder cell differs from the snapshot') && own.includes('construction_launch_per_kg Conservative (B5): snapshot 2500 → yours 2600'), `the changed cell is listed (${own.slice(0, 160)})`);
  ok(!own.includes('cached result'), 'no cached results reported');
  // A copy re-saved by LibreOffice: same inputs, 146 cached results, shared strings.
  const lo = await dropFile(page, RECALC, '146 cached results|Refused|Cannot');
  ok(lo.includes('Not the committed file') && lo.includes('All 42 ladder cells equal the snapshot'), 'recalculated copy: same 42 inputs');
  ok(lo.includes('Your copy stores 146 cached results'), 'recalculated copy: 146 cached results');
  ok(lo.includes('written by LibreOffice'), 'the writer of the dropped file is named');
  const loReport = await page.locator('#own-report').textContent();
  ok(/TOTAL\s+395\s+146\s+146\s+81/.test(loReport), 'recalculated report: 146 / 146');
  ok(loReport.includes('shared strings: 158'), 'recalculated report: 158 shared strings');
  const bg = rgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  ok(bg[0] > 200 && bg[1] > 200 && bg[2] > 200, `light background (${bg.join(',')})`);
  await page.locator('#copy-report').click();
  await page.waitForTimeout(150);
  const status = await page.locator('#copy-status').textContent();
  ok(status.length > 0, 'Copy reports what it did');
  const copied = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
  const shown = await page.locator('#copy-fallback').isVisible();
  const CHK = 'Checks    4 of 4 passed (reported, not enforced)';
  ok((copied && copied.includes(CHK)) || (shown && (await page.locator('#copy-fallback').textContent()).includes(CHK)), 'copied (or shown) report is the saved run');
  await page.locator('#copy-json').click();
  await page.waitForTimeout(150);
  const copiedJson = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
  const fb = await page.locator('#copy-fallback').isVisible() ? await page.locator('#copy-fallback').textContent() : '';
  const jsonText = (copiedJson && copiedJson.trim().startsWith('{')) ? copiedJson : fb;
  let parsed = null;
  try { parsed = JSON.parse(jsonText); } catch { /* reported below */ }
  ok(parsed && parsed.workbook && parsed.workbook.md5 === data.workbook.md5 && parsed.census.totals.formula_cells === 146, 'copied ladder.json parses, with md5 and census');
  await page.focus('#copy-json');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  ok(!!focused && focused !== 'BODY', `Tab moves focus to a control (${focused})`);
  await page.focus('#file');
  ok((await page.evaluate(() => document.activeElement.id)) === 'file', 'file input focusable');
  ok((await page.locator('#ladder tbody tr').count()) === 14, '14 ladder rows at desktop width');
  ok(errors.length === 0, `no console errors on the desktop (${errors.join(' | ')})`);
  await context.close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
