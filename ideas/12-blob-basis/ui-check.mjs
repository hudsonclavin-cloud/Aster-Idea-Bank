#!/usr/bin/env node
// Drives index.html in headless Chromium (the globally installed Playwright, loaded the way
// tools/smoke.mjs loads it) and checks what a reader sees: the numbers on the page equal the saved
// run's, the arithmetic is recomputed, every verdict chip, the refusals, a real file picked through
// the file input, phone width by touch, dark mode, keyboard. From the bank root:
//   node ideas/12-blob-basis/ui-check.mjs
// Exits 0 when every check passes, 1 otherwise; prints "skipped" and exits 0 without Playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BB = require(path.join(here, 'basis.js'));
const EX = require(path.join(here, 'example-data.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright is not installed)');
    process.exit(0);
  }
}

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
const browser = await pw.chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-basis-ui-'));

async function open(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('file:')) errors.push(`network request: ${r.url()}`);
  });
  await page.goto(URL0);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (page, sel) => page.locator(sel).first().innerText();
const chips = (page, sel) => page.$$eval(`${sel} .chip`, (els) => els.map((e) => e.textContent));
const count = (arr, x) => arr.filter((y) => y === x).length;

const horizons = EX.runs.find((r) => r.id === 'aster-horizons').paths[0];
const row = (name) => horizons.rows.find((r) => r.name === name);
const g3 = BB.group3;

for (const [label, opts] of [['phone', PHONE], ['desktop', DESK]]) {
  const { context, page, errors } = await open(opts);

  // Section 1: the grid, its families and pins, and the arithmetic recomputed from the run.
  const fam = await page.$$eval('#six-grid .cell', (els) => Object.fromEntries(els.map((e) => [e.dataset.basis, e.dataset.family])));
  ok(fam.blob === 'A' && fam['blob-lf'] === 'A' && fam.disk === 'A' && fam['disk-lf'] === 'A', `${label}: the LF bases are one byte string (A)`);
  ok(fam['blob-crlf'] === 'B' && fam['disk-crlf'] === 'B', `${label}: the CRLF bases are another (B)`);
  const blobCell = await text(page, '#six-grid [data-basis="blob"]');
  ok(blobCell.includes(`${g3(row('blob').bytes)} bytes`) && blobCell.includes(row('blob').sha256.slice(0, 16)), `${label}: blob cell shows the run's bytes and sha256`);
  ok(blobCell.includes('lambert-screen-cache.json'), `${label}: the cache's hash is pinned to the blob`);
  const crlfCell = await text(page, '#six-grid [data-basis="blob-crlf"]');
  ok(crlfCell.includes(g3(row('blob-crlf').bytes)) && crlfCell.includes('earth-vz-span-max.json'), `${label}: earth-vz's hash is pinned to blob-crlf`);
  const arith = await text(page, '#six-arith');
  const sum = row('blob').bytes + row('blob').bareLf;
  ok(arith.includes(`${g3(row('blob').bytes)} + ${g3(row('blob').bareLf)} = ${g3(sum)}`), `${label}: arithmetic shown (${arith})`);
  ok(sum === row('blob-crlf').bytes && arith.includes('which is the blob-crlf size') && arith.includes('the measurement recorded'), `${label}: arithmetic closes against blob-crlf and the recorded bytes`);
  const pinChips = await chips(page, '#six-pins');
  ok(pinChips.join(',') === 'BLOB-BASIS,CRLF-BASIS', `${label}: two recorded hashes on the fixture (${pinChips})`);

  // The headline: Aster's four recorded hashes, placed, in file order.
  const hl = await chips(page, '#headline');
  ok(hl.join(',') === 'BLOB-BASIS,BLOB-BASIS,NO-MATCH,CRLF-BASIS', `${label}: headline chips ${hl}`);

  // Section 2: every recorded hash.
  const placed = await chips(page, '#placed');
  ok(count(placed, 'BLOB-BASIS') === 5 && count(placed, 'CRLF-BASIS') === 2 && count(placed, 'NO-MATCH') === 1 && placed.length === 8, `${label}: placed chips ${placed}`);
  const exitLine = await text(page, '#placed .exitline');
  ok(/exits 1/.test(exitLine) && /2 of 4 recorded hashes/.test(exitLine), `${label}: --require blob line (${exitLine})`);
  const placedText = await text(page, '#placed');
  ok(placedText.includes('shallow clone') && placedText.includes('solverCommit') && placedText.includes('not in this clone'), `${label}: the script hash's history and the absent solverCommit are explained`);

  // Section 3: the baked assets.
  const baked = await chips(page, '#baked');
  const bakedRun = EX.runs.find((r) => r.id === 'aster-baked');
  ok(baked.length === bakedRun.paths.length && baked.every((c) => c === 'IDENTICAL'), `${label}: baked chips ${baked}`);
  ok((await text(page, '#baked-sub')).includes(`${bakedRun.paths.length} of ${bakedRun.paths.length} are identical`), `${label}: baked summary is derived`);

  // Section 4: check a copy, with the samples.
  ok((await text(page, '#check-out')).includes('No copy chosen yet'), `${label}: empty state says what to do, shows no number`);
  const want = { lf: ['IDENTICAL', 'CRLF-BASIS'], crlf: ['CRLF-CHECKOUT', 'CRLF-BASIS'], mixed: ['EOL-ONLY', 'CRLF-BASIS'], edited: ['NOT-THE-BLOB', 'NO-MATCH'] };
  const v = BB.sampleVariants();
  for (const [k, [verdict, placement]] of Object.entries(want)) {
    const b = page.locator(`[data-sample="${k}"]`);
    if (opts.hasTouch) await b.tap();
    else await b.click();
    await page.waitForTimeout(80);
    const c = await chips(page, '#check-out');
    ok(c[0] === verdict && c[1] === placement, `${label} sample ${k}: ${c.slice(0, 2)} want ${verdict},${placement}`);
    ok((await page.locator(`[data-sample="${k}"]`).getAttribute('aria-pressed')) === 'true', `${label} sample ${k}: pressed state`);
    const head = await text(page, '#check-out .out-head');
    ok(head.includes(`${g3(v[k].length)} bytes`), `${label} sample ${k}: byte count ${head}`);
  }
  ok((await text(page, '#check-out .refusal')).includes('not that blob in any line-ending form'), `${label}: the edited copy refuses to name a blob`);
  // Remove the blob id: the blob rows refuse and say what would help.
  await page.fill('#blobid', '');
  await page.waitForTimeout(60);
  const ref = await text(page, '#check-out .refusal');
  ok(/Blob basis unavailable/.test(ref) && /What would help/.test(ref), `${label}: refusal without a blob id (${ref.slice(0, 80)})`);
  ok((await page.locator('#check-out .cell.na').count()) === 3, `${label}: the three blob cells are unavailable`);
  await page.fill('#recorded', 'zz');
  await page.waitForTimeout(60);
  ok((await chips(page, '#check-out')).includes('INVALID'), `${label}: a non-hex recorded value is refused`);

  // A real file through the file input: a CRLF copy, with the LF version's blob id pasted.
  const lfText = 'alpha\nbeta\ngamma\n';
  const crlfFile = path.join(tmp, 'copy-crlf.txt');
  fs.writeFileSync(crlfFile, lfText.replace(/\n/g, '\r\n'));
  await page.setInputFiles('#file', crlfFile);
  await page.waitForTimeout(200);
  ok((await page.locator('[data-sample][aria-pressed="true"]').count()) === 0, `${label}: picking a file releases the sample`);
  await page.fill('#blobid', BB.gitBlobId(BB.asciiBytes(lfText)));
  await page.fill('#recorded', BB.sha256(BB.asciiBytes(lfText)).slice(0, 10));
  await page.waitForTimeout(100);
  const fc = await chips(page, '#check-out');
  ok(fc[0] === 'CRLF-CHECKOUT' && fc[1] === 'BLOB-BASIS', `${label}: picked CRLF file ${fc}`);
  ok((await text(page, '#check-out .out-head')).includes('copy-crlf.txt'), `${label}: file name shown`);
  ok((await text(page, '#check-out .placement')).includes('Prefix of sha256 equals'), `${label}: prefix placement says so`);
  const blobFam = await page.$eval('#check-out [data-basis="blob"]', (e) => e.dataset.family);
  ok(blobFam === 'A', `${label}: the committed blob is family A in the checker too`);

  ok(!(await overflow(page)), `${label}: no horizontal overflow`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
  ok(opts.colorScheme === 'dark' ? lum < 60 : lum > 200, `${label}: ${opts.colorScheme} scheme background ${bg}`);
  ok(errors.length === 0, `${label}: console errors or requests: ${errors.join(' | ')}`);
  await context.close();
}

// Keyboard: Tab reaches a sample button and Enter runs it.
{
  const { context, page } = await open(DESK);
  await page.focus('#file');
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-sample') === 'crlf');
  }
  ok(reached, 'keyboard: Tab reaches the CRLF twin button');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  ok((await chips(page, '#check-out'))[0] === 'CRLF-CHECKOUT', 'keyboard: Enter runs the sample');
  await context.close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
