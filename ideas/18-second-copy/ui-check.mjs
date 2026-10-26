#!/usr/bin/env node
// Drives index.html in headless Chromium and checks it against the module run on the same
// snapshots in Node: the totals chips, the nine failing pairings with both values, every tab's
// card count per filter, the paste box (a planted drift, the 2026-09-18 UN block, an empty paste
// and an unpairable text refuse), keyboard use, no network requests, no console errors, and at
// 390 px in dark mode by touch nothing scrolls sideways. Run from the bank root:
//   node ideas/18-second-copy/ui-check.mjs [--shots DIR]
// check.mjs runs it for tools/check.mjs. Uses the globally installed Playwright, as
// tools/smoke.mjs does; prints "skipped" and exits 0 if it is absent.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SC = require(path.join(here, 'second-copy.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('skipped: playwright is not installed'); process.exit(0); }
}

// the expected numbers, from the module on the snapshots (what the CLI's --snapshots prints)
const S = path.join(here, 'snapshots');
const T = {};
for (const n of Object.keys(SC.TABLE_FILES)) T[n] = require(path.join(S, `table-${n}.js`));
const idx = require(path.join(S, 'index-0974a62.js'));
const doc = { text: idx.doctrine.text, lineBase: idx.doctrine.lineBase }, gsy = { text: idx.gradeSy.text, lineBase: idx.gradeSy.lineBase };
const templates = fs.readdirSync(S).filter((f) => /^tpl-.*\.scad\.js$/.test(f)).sort().map((f) => { const t = require(path.join(S, f)); return { name: f.replace(/^tpl-/, '').replace(/\.scad\.js$/, ''), file: t.file, text: t.text }; });
const shipped = SC.rebuildShipped(idx.shipped, templates);
const hist = require(path.join(S, 'history.js'));
const history = ['ad4d587', '3bffbe0'].map((c) => hist[c]);
const R = SC.run(T, { commit: '0974a62', doctrine: doc, gradeSy: gsy, templates, shipped, history });
const headSrc = R.sources.filter((s) => !s.history);
const headTot = SC.count(headSrc.flatMap((s) => s.findings));
const failing = headSrc.flatMap((s) => s.findings).filter((f) => SC.FAILING[f.verdict]);
const group = { doctrine: (s) => s.id === 'doctrine', grades: (s) => s.id === 'GRADE_SY', templates: (s) => s.id.startsWith('template:'), copies: (s) => s.id === 'copies', history: (s) => !!s.history };

let checks = 0, failed = 0;
function ok(cond, name) { checks++; if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name); }

async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network: ' + r.url()); });
  await p.goto(URL0, { waitUntil: 'load' });
  await p.waitForTimeout(200);
  return { ctx, p, errors };
}
const cards = (p, sel) => p.locator(`${sel} article.card`).count();

async function main() {
  const browser = await pw.chromium.launch();

  // ---- desktop, light
  {
    const { ctx, p, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    const chips = await p.$$eval('#totals .chip', (cs) => cs.map((c) => [c.dataset.verdict, +c.dataset.count]));
    ok(JSON.stringify(chips) === JSON.stringify(SC.VERDICTS.filter((v) => headTot[v]).map((v) => [v, headTot[v]])), `totals chips equal the module's ${JSON.stringify(headTot)}`);
    ok((await p.textContent('#commit')) === '0974a62', 'the commit is shown');
    ok(await cards(p, '#failing') === failing.length && failing.length === 9, `nine failing pairings are listed (${failing.length})`);
    const failText = await p.textContent('#failing');
    ok(/AS568-250/.test(failText) && /0\.139 in/.test(failText) && /-159/.test(failText), 'the AS568-250 cross-section disagreement shows both values and the -159 dash');
    ok(/\.140–\.146/.test(failText) && /0\.136–0\.142 in/.test(failText), 'the liquids width shows both bands');
    ok(/20\.000–20\.021/.test(failText) && /19\.95–20\.05/.test(failText), 'the nosecone H7 shows both zones');
    ok(/149\.261–149\.286/.test(failText), 'the doctrine example g6 zone is shown');
    ok(/four \(4\)/.test(failText) && /PML PT-6\.0 ID 152\.578/.test(failText), 'the four-vendors claim shows the count and PML');
    ok(/and tension in the 4 all-thread rods/.test(failText) && /index\.html line 2062/.test(failText), 'the copy drift shows both lines');

    for (const [tab, pred] of Object.entries(group)) {
      await p.click(`#tab-${tab}`);
      const fs_ = R.sources.filter(pred).flatMap((s) => s.findings);
      for (const [flt, keep] of [['not', (f) => f.verdict !== 'AGREES'], ['all', () => true], ['agree', (f) => f.verdict === 'AGREES']]) {
        await p.click(`#filters button[data-filter="${flt}"]`);
        ok(await cards(p, '#list') === fs_.filter(keep).length, `${tab} / ${flt}: ${fs_.filter(keep).length} cards`);
      }
    }
    await p.click('#tab-doctrine');
    await p.click('#filters button[data-filter="all"]');
    const listText = await p.textContent('#list');
    ok(/M6 7\.0/.test(listText) === false && /M6/.test(listText) && /p6 at Ø18–30/.test(listText) && /width 13 µm equals the table's IT6 = 13 µm/.test(listText), 'the doctrine tab lists the M6 pairings and the p6 width note');
    ok(/QUOTED/.test(listText) && /6\.76 mm was the NORMAL hole for 1\/4 in/.test(listText), 'the quoted 6.76 is shown as QUOTED with its sentence');
    await p.click('#tab-history');
    await p.click('#filters button[data-filter="not"]');
    const hist = await p.textContent('#list');
    ok(/1\/4-20 75 % tap drill \(#7\)/.test(hist), 'history shows that the old "#10 normal 5.11" equals the 1/4-20 tap drill');

    // paste box
    await p.click('#sample');
    ok(await cards(p, '#tryout') === 26, 'the planted M6 sample lints to 26 pairings');
    const tr = await p.textContent('#tryout');
    ok(/1 DISAGREES/.test(tr) && /M6 clearance_coarse 7/.test(tr), 'and names the moved value as the coarse hole');
    ok(!/index\.html:/.test(tr) && /pasted:1/.test(tr), 'pasted findings are located in the pasted text, not in index.html');
    ok((await p.locator('#tryout article.card').first().getAttribute('data-verdict')) === 'DISAGREES', 'the disagreement is listed first');
    await p.click('#sample2');
    ok(/15 DISAGREES/.test(await p.textContent('#tryout')), 'the 2026-09-18 UN line lints to 15 disagreements');
    await p.fill('#paste', '');
    await p.click('#lint');
    ok(await p.locator('#tryout [data-refusal="empty"]').count() === 1, 'an empty paste is refused, not linted');
    await p.fill('#paste', 'The sled weighs 120 g and sits 40 mm aft.');
    await p.click('#lint');
    ok(await p.locator('#tryout [data-refusal="unpaired"]').count() === 1, 'text with no pairable shape is refused with what it would need');
    await p.selectOption('#kind', 'gradeSy');
    await p.fill('#paste', "const GRADE_SY = { '8.8':660, '12.9':1100 };");
    await p.click('#lint');
    const g = await p.textContent('#tryout');
    ok(/1 DISAGREES, 1 AGREES/.test(g) && /640 MPa/.test(g), 'a pasted GRADE_SY with 8.8 at 660 disagrees with 640');

    // keyboard: tab to the first source tab and press Enter
    await p.focus('#tab-copies');
    await p.keyboard.press('Enter');
    ok((await p.getAttribute('#tab-copies', 'aria-selected')) === 'true', 'a tab is reachable and activates by keyboard');
    ok(errors.length === 0, 'no console errors or network requests (desktop): ' + errors.join(' | '));
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, 'desktop-light.png'), fullPage: false }); }
    await ctx.close();
  }

  // ---- phone, dark, touch
  {
    const { ctx, p, errors } = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok(bg === 'rgb(21, 23, 26)', `dark background applied (${bg})`);
    const over = async () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    ok(!(await over()), 'no horizontal overflow at 390 px');
    await p.tap('#tab-templates');
    await p.tap('#filters button[data-filter="all"]');
    ok(!(await over()), 'no horizontal overflow with every template pairing shown');
    const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length);
    ok(wide === 0, `no element reaches past the viewport (${wide})`);
    await p.tap('#sample2');
    ok(await cards(p, '#tryout') > 0 && !(await over()), 'the sample lints by touch and still fits');
    const badge = await p.evaluate(() => { const b = document.querySelector('#failing .badge'); const s = getComputedStyle(b); return [s.color, s.backgroundColor]; });
    ok(badge[0] !== badge[1], 'verdict badges keep a readable colour pair in dark mode');
    ok(errors.length === 0, 'no console errors or network requests (phone): ' + errors.join(' | '));
    if (shots) { await p.screenshot({ path: path.join(shots, 'phone-dark.png'), fullPage: false }); }
    await ctx.close();
  }

  // ---- storage blocked: the page still renders
  {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 700 } });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL0, { waitUntil: 'load' });
    ok(await cards(p, '#failing') === 9 && errors.length === 0, 'with storage blocked the page renders and remembers nothing');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
