#!/usr/bin/env node
// Drives the Near Field Guide page in headless Chromium and checks what a reader sees and does:
// the counts on the page against the kernel summed over the shipped bins and against the
// fixture's own header, the chips by mouse, touch and keyboard, the T_J convention toggle, a
// landmark, the empty-selection refusal and the two load refusals, phone width and dark mode.
// Run from the bank root:
//   node ideas/28-near-field-guide/ui-check.mjs [--shots DIR]
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" and exits 0
// when Playwright is not installed.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const G = req(path.join(here, 'guide.js'));
const D = req(path.join(here, 'snapshots', 'bins.data.js'));
const HEADER = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'catalog-header.json'), 'utf8')).catalog;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const shotDir = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null;
let pw;
try {
  pw = req('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check skipped: Playwright is not installed');
    process.exit(0);
  }
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
const fmt = G.fmtInt;
const n = (sel) => G.summarize(D.atoms, sel).n;

async function open(url, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, colorScheme: opts.scheme || 'light', hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
  await page.goto(url);
  await page.waitForTimeout(150);
  return { page, ctx, errors };
}
const text = (page, sel) => page.$eval(sel, (el) => el.textContent);
const chip = (dim, key) => `.chip[data-dim="${dim}"][data-key="${key}"]`;
const panelMeta = (page, key) => page.$eval(`figure.panel[data-key="${key}"] .p-meta`, (el) => el.textContent);
const barCount = (page, key) => page.$$eval(`figure.panel[data-key="${key}"] svg .bar`, (els) => els.length);
const nonzeroBins = (key, sel) => {
  const spec = G.SPECS.find((s) => s.key === key);
  const S = G.summarize(D.atoms, sel);
  return G.bars(spec).filter((b) => b.kind === 'bin' && S.h[key][b.idx] > 0).length;
};

// ---------------------------------------------------------------- desktop, light
{
  const { page, ctx, errors } = await open(URL0);
  ok(errors.length === 0, `no console errors on load: ${errors.join(' | ')}`);
  ok((await text(page, '#lede')).includes(fmt(HEADER.totalBodies)), 'lede states the header total 41,906');
  ok((await text(page, '#selection')).startsWith(`${fmt(HEADER.totalBodies)} of ${fmt(HEADER.totalBodies)}`), 'selection starts at the whole fixture');
  for (const [cls, v] of Object.entries(HEADER.classDistribution)) {
    if (!['ATE', 'APO', 'AMO', 'IEO'].includes(cls)) continue;
    ok((await text(page, `${chip('cls', cls)} .n`)) === fmt(v), `${cls} chip shows the header's ${v}`);
  }
  ok((await text(page, `${chip('cls', 'tail')} .n`)) === fmt(HEADER.anomalyTailCount), 'comet-tail chip shows the header anomalyTailCount 208');
  for (const t of ['L0', 'L1', 'L2']) ok((await text(page, `${chip('fid', t)} .n`)) === fmt(D.header && n({ fid: t })), `${t} chip count`);
  ok((await text(page, `${chip('tier', 'planning-tier')} .n`)) === '0', 'planning-tier chip shows 0');
  // every histogram: n in its meta, one rect per non-empty bin
  for (const s of G.SPECS) {
    if (s.key === 'TJe') continue;
    ok((await panelMeta(page, s.key)).startsWith(`n ${fmt(HEADER.totalBodies)}`), `${s.key} panel states n 41,906`);
    ok((await barCount(page, s.key)) === nonzeroBins(s.key, {}), `${s.key} panel draws one bar per non-empty bin (${nonzeroBins(s.key, {})})`);
  }
  ok((await panelMeta(page, 'H')).includes(`not reported ${fmt(HEADER.missingAbsoluteMagnitudeCount)}`), 'H panel states the 210 not reported');
  ok((await panelMeta(page, 'U')).includes('not reported 10'), 'U panel states 10 not reported');
  ok((await panelMeta(page, 'arc')).includes('not reported 417'), 'arc panel states 417 not reported');
  ok((await panelMeta(page, 'sigmaA')).includes('not reported 137'), 'sigmaA panel states 137 not reported');
  // census table and the missing cards
  ok((await page.$$eval('#census-table tbody tr', (r) => r.length)) === D.census.keyPaths.length, 'census table has one row per key path (34)');
  ok((await page.$eval('#census-table', (t) => t.textContent)).includes('41,906'), 'census table shows G null 41,906');
  ok((await page.$$eval('#missing-cards .card', (c) => c.length)) === 4, 'four missing-field cards (G, assumed albedo, rotation, taxonomy + albedo)');
  // grid meta from the kernel
  const S0 = G.summarize(D.atoms, {});
  ok((await text(page, '#grid-meta')).startsWith(`${fmt(G.sum(S0.grid))} of ${fmt(S0.n)}`), 'grid meta counts the bodies on the a-e grid');
  // static findings with their numbers
  const dis = await text(page, '#disagree');
  ok(dis.includes(`${D.classCheck.disagreements.length} bodies disagree`), 'class-check count 82 on the page');
  ok(dis.includes(fmt(D.oracle.conventions[0].reproduced)) && dis.includes(fmt(D.oracle.conventions[1].reproduced)), 'SBDB oracle counts on the page');
  ok(dis.includes('2008-Oct-07.116') && dis.includes('2014-Jan-02.128'), 'SBDB not-valid-after dates on the page');
  ok((await text(page, '#prereport')).includes('4 more'), 'pre-research comparison: 4 more bodies');

  // tap APO: every panel re-counts
  await page.click(chip('cls', 'APO'));
  const apo = HEADER.classDistribution.APO;
  ok((await text(page, '#selection')).startsWith(fmt(apo)), 'APO selection shows 23,757');
  ok((await panelMeta(page, 'a')).startsWith(`n ${fmt(apo)}`), 'a panel re-counts to APO');
  ok((await barCount(page, 'e')) === nonzeroBins('e', { cls: 'APO' }), 'e panel redrawn from the APO bins');
  ok((await page.getAttribute(chip('cls', 'APO'), 'aria-pressed')) === 'true', 'APO chip pressed');
  ok((await text(page, `${chip('fid', 'L1')} .n`)) === fmt(n({ cls: 'APO', fid: 'L1' })), 'L1 chip shows the APO-and-L1 count');
  ok(page.url().includes('cls=APO'), 'selection written to the URL hash');

  // planning-tier: refusal, panels hidden
  await page.click(chip('tier', 'planning-tier'));
  ok((await text(page, '#empty-root')).includes('refusal · insufficient_data'), 'planning-tier selection refuses with insufficient_data');
  ok((await text(page, '#empty-root')).includes('reserved product/policy label for Slice 10'), 'refusal quotes the spec on planning-tier');
  ok(await page.$eval('#panels-orbits', (el) => el.closest('section').hidden), 'panels hidden under the refusal');
  ok((await page.$$('#panels-orbits figure')).length === 0, 'no empty chart drawn');
  await page.click(chip('tier', 'all'));
  await page.click(chip('cls', 'all'));
  ok(!(await page.$eval('#panels-orbits', (el) => el.closest('section').hidden)), 'panels back after All');
  ok((await text(page, '#empty-root')) === '', 'refusal cleared');

  // AMO + L0 is empty too (no AMO body is L0)
  ok(n({ cls: 'AMO', fid: 'L0' }) === 0, 'kernel: no AMO body is L0');
  await page.click(chip('cls', 'AMO'));
  await page.click(chip('fid', 'L0'));
  ok((await text(page, '#empty-root')).includes('insufficient_data'), 'AMO + L0 refuses');
  await page.click(chip('fid', 'all'));
  await page.click(chip('cls', 'all'));

  // comet tail + L2: STATUS.md's 206
  await page.click(chip('cls', 'tail'));
  await page.click(chip('fid', 'L2'));
  ok((await text(page, '#selection')).startsWith('206'), 'comet tail at L2 is 206 bodies (STATUS.md\'s "206 structurally-blind comets")');
  await page.click(chip('fid', 'all'));
  await page.click(chip('cls', 'all'));

  // landmark Eros
  await page.selectOption('#landmark', '433');
  const lmA = await page.$eval('figure.panel[data-key="a"] .p-landmark', (el) => el.textContent);
  ok(lmA.includes('433 Eros') && lmA.includes('1.458'), `a panel marks Eros at 1.458 AU: ${lmA}`);
  ok((await page.$$('figure.panel[data-key="a"] svg .lm')).length === 1, 'a panel draws the landmark line');
  ok((await page.$eval('figure.panel[data-key="cls"] .p-landmark', (el) => el.textContent)).includes('AMO'), 'class panel names Eros\'s class');
  ok((await page.getAttribute('.lm-pick[data-des="433"]', 'aria-pressed')) === 'true', 'Eros card button pressed');
  await page.selectOption('#landmark', '');

  // T_J convention toggle
  await page.click('figure.panel[data-key="TJ"] button[data-tj="TJe"]');
  ok((await page.$$('figure.panel[data-key="TJe"]')).length === 1, 'toggle swaps in the ecliptic T_J panel');
  ok((await barCount(page, 'TJe')) === nonzeroBins('TJe', {}), 'ecliptic T_J panel drawn from its own bins');
  ok(page.url().includes('tj=ecl'), 'convention in the URL hash');
  await page.click('figure.panel[data-key="TJe"] button[data-tj="TJ"]');

  // log count axis
  await page.click('#scale-log');
  ok((await page.getAttribute('#scale-log', 'aria-pressed')) === 'true', 'log axis pressed');
  ok((await barCount(page, 'e')) === nonzeroBins('e', {}), 'log axis keeps every bar');
  await page.click('#scale-lin');

  // keyboard: read bars of the eccentricity panel
  await page.focus('figure.panel[data-key="e"] svg');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const eSpec = G.SPECS.find((s) => s.key === 'e');
  const want = `${G.bars(eSpec)[1].label}: ${fmt(S0.h.e[1])} bodies`;
  ok((await page.$eval('figure.panel[data-key="e"] .p-note', (el) => el.textContent)).startsWith(want), `arrow keys read the second e bar (${want})`);
  await page.keyboard.press('End');
  ok((await page.$eval('figure.panel[data-key="e"] .p-note', (el) => el.textContent)).startsWith(G.bars(eSpec)[49].label), 'End reads the last e bin');
  // keyboard chips
  await page.focus(chip('cls', 'IEO'));
  await page.keyboard.press('Enter');
  ok((await text(page, '#selection')).startsWith(fmt(HEADER.classDistribution.IEO)), 'Enter on a chip selects it');
  await page.click(chip('cls', 'all'));
  // grid keyboard
  await page.focus('#grid-canvas');
  await page.keyboard.press('ArrowRight');
  ok(/bodies$/.test(await text(page, '#grid-note')), 'arrow keys read a grid cell');
  if (shotDir) {
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'desktop.png'), fullPage: true });
  }
  ok(errors.length === 0, `no console errors after interaction: ${errors.join(' | ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- state from the URL hash
{
  const { page, ctx, errors } = await open(`${URL0}#cls=IEO&fid=L1&lm=163693`);
  ok((await text(page, '#selection')).startsWith(fmt(n({ cls: 'IEO', fid: 'L1' }))), 'hash restores IEO + L1');
  ok((await page.$eval('#landmark', (el) => el.value)) === '163693', 'hash restores the landmark');
  ok(errors.length === 0, 'no errors from a hash-restored state');
  await ctx.close();
}

// ---------------------------------------------------------------- phone, dark, touch
{
  const { page, ctx, errors } = await open(URL0, { viewport: { width: 390, height: 844 }, scheme: 'dark', touch: true });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, `no horizontal overflow at 390 px (${over})`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(/rgb\((\d+)/.exec(bg)[1]) < 40, `dark background in dark mode (${bg})`);
  await page.tap(chip('cls', 'ATE'));
  ok((await text(page, '#selection')).startsWith(fmt(HEADER.classDistribution.ATE)), 'tap selects ATE on a phone');
  const wide = await page.$$eval('figure.panel svg', (els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
  ok(wide <= 390, `charts fit the phone (${wide})`);
  const box = await page.$eval('figure.panel[data-key="H"] svg', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.$eval('figure.panel[data-key="H"] svg', (el) => el.scrollIntoView({ block: 'center' }));
  const box2 = await page.$eval('figure.panel[data-key="H"] svg', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(box2.x, box2.y);
  ok(/bodies \(/.test(await page.$eval('figure.panel[data-key="H"] .p-note', (el) => el.textContent)), `a tap on a chart reads a bar (${box.x})`);
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over2 <= 0, 'still no overflow after interaction');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'phone-dark.png'), fullPage: true });
  ok(errors.length === 0, `no console errors on the phone: ${errors.join(' | ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- load refusals, on throw-away copies
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-ui-'));
  try {
    for (const f of ['index.html', 'style.css', 'app.js', 'guide.js']) fs.copyFileSync(path.join(here, f), path.join(tmp, f));
    fs.mkdirSync(path.join(tmp, 'snapshots'));
    // 1: bins binned under other edges
    const data = fs.readFileSync(path.join(here, 'snapshots', 'bins.data.js'), 'utf8').replace('"specSignature":"a|', '"specSignature":"a-changed|');
    fs.writeFileSync(path.join(tmp, 'snapshots', 'bins.data.js'), data);
    let r = await open(pathToFileURL(path.join(tmp, 'index.html')).href);
    ok((await text(r.page, '#refusal-root')).includes('out_of_envelope'), 'bins under other edges: out_of_envelope refusal');
    ok(await r.page.$eval('#guide', (el) => el.hidden), 'no panels drawn under a mismatched signature');
    await r.ctx.close();
    // 2: no data file at all
    fs.rmSync(path.join(tmp, 'snapshots', 'bins.data.js'));
    r = await open(pathToFileURL(path.join(tmp, 'index.html')).href);
    ok((await text(r.page, '#refusal-root')).includes('insufficient_data'), 'missing bins: insufficient_data refusal');
    ok((await text(r.page, '#refusal-root')).includes('build-data.mjs --write'), 'the refusal says what would help');
    await r.ctx.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
