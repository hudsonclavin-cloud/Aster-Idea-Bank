#!/usr/bin/env node
// Drives index.html in headless Chromium (the globally installed Playwright, loaded the way
// tools/smoke.mjs loads it) and checks what a reader sees against the data the page was built
// from and against adjudication.json: the headline numbers, the chart's segments, the filters,
// the tables, the "Try it" panel (live verdicts, refusals, no git), phone width, dark mode and
// the keyboard. From the bank root:
//   node ideas/23-line-drift/ui-check.mjs [--shots DIR]
// Exits 0 when every check passes, 1 otherwise; prints "skipped" and exits 0 without Playwright.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'linedrift.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null;

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

// The data the page renders, read the same way the page reads it.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, 'report-data.js'), 'utf8'), sandbox);
const D = sandbox.window.LINE_DRIFT_DATA;
const ADJ = JSON.parse(fs.readFileSync(path.join(here, 'adjudication.json'), 'utf8'));
const GROUP = { 'stale-line': 'fix', 'stale-claim': 'fix', 'off-when-written': 'fix', misquote: 'fix', acknowledged: 'expected', history: 'expected', plan: 'expected', 'not-in-repo': 'expected', 'tool-error': 'limit', shorthand: 'limit' };
const byGroup = (g) => ADJ.findings.filter((a) => GROUP[a.class] === g).length;
const drift = [...L.DRIFT].reduce((a, s) => a + (D.checkout.counts.byStatus[s] || 0), 0);

async function page(browser, { width, height, scheme }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 500, isMobile: width < 500 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
  await p.goto(URL0);
  await p.waitForSelector('#cards .card');
  return { p, ctx, errors };
}
const text = (p, sel) => p.$eval(sel, (n) => n.textContent);
const count = (p, sel) => p.$$eval(sel, (ns) => ns.length);

async function main() {
  const browser = await pw.chromium.launch();
  try {
    // ---------------------------------------------------------------- desktop, light
    {
      const { p, ctx, errors } = await page(browser, { width: 1280, height: 900, scheme: 'light' });
      ok(ADJ.findings.length === D.findings.length, `adjudication covers the page's ${D.findings.length} findings`);
      ok(D.findings.every((f) => f.cls), 'every finding on the page carries a hand verdict');
      ok((await text(p, '#t-refs .big')) === D.checkout.counts.total.toLocaleString('en-US'), 'references tile = data total');
      ok((await text(p, '#t-drift .big')) === String(drift), `drift tile = ${drift}`);
      ok((await text(p, '#t-fix .big')) === String(byGroup('fix')), `needs-a-fix tile = ${byGroup('fix')} from adjudication.json`);
      ok((await text(p, '#t-exp .big')) === String(byGroup('expected')), `nothing-to-fix tile = ${byGroup('expected')}`);
      ok((await text(p, '#t-lim .big')) === String(byGroup('limit')), `tool-limit tile = ${byGroup('limit')}`);
      ok(byGroup('fix') + byGroup('expected') + byGroup('limit') === D.findings.length, 'the three groups partition the findings');
      if (D.full) {
        const commits = D.full.counts.byKind.commit.OK;
        ok((await text(p, '#t-commits .big')).startsWith(`${commits} of`), `commit tile starts with the full run's ${commits}`);
      }
      // Chart: one row per document with findings, segments summing to that document's count.
      const rows = await p.$$eval('.bar-row', (rs) => rs.map((r) => ({ doc: r.querySelector('.doc').textContent, n: Number(r.querySelector('.n').textContent), segs: [...r.querySelectorAll('.seg')].map((s) => Number(s.getAttribute('aria-label').match(/: (\d+) /)[1])) })));
      const perDoc = new Map();
      for (const f of D.findings) perDoc.set(f.doc, (perDoc.get(f.doc) || 0) + 1);
      ok(rows.length === perDoc.size, `chart has a row per document with findings (${perDoc.size})`);
      ok(rows.every((r) => r.n === perDoc.get(r.doc) && r.segs.reduce((a, b) => a + b, 0) === r.n), 'each bar\'s segments sum to its document\'s findings');
      ok(rows[0].doc === 'src/v2/SLICE_18_FOUNDING.md' || rows[0].n >= rows[1].n, 'bars sorted by size');
      // Cards and filters.
      ok((await count(p, '#cards .card')) === D.findings.length, 'all findings listed at first');
      await p.click('#chips .chip[data-status="GONE"]');
      ok((await count(p, '#cards .card')) === D.checkout.counts.byStatus.GONE, 'GONE chip lists the GONE findings');
      ok((await p.$$eval('#cards .card', (cs) => cs.every((c) => c.dataset.status === 'GONE'))), 'and only those');
      await p.click('#chips .chip[data-status="all"]');
      await p.selectOption('#f-group', 'c:stale-claim');
      ok((await count(p, '#cards .card')) === ADJ.findings.filter((a) => a.class === 'stale-claim').length, 'class filter: stale claims');
      await p.selectOption('#f-doc', 'STATUS.md');
      const stStatus = ADJ.findings.filter((a) => a.class === 'stale-claim' && a.key.startsWith('STATUS.md:')).length;
      ok((await count(p, '#cards .card')) === stStatus, `stale claims in STATUS.md: ${stStatus}`);
      await p.fill('#f-text', 'pre-commit');
      ok((await count(p, '#cards .card')) === 1, 'search narrows to the C17 hook citation');
      ok(/f7b19e7/.test(await text(p, '#cards .card')), 'its verdict names the fixing commit');
      await p.fill('#f-text', 'no such words anywhere');
      ok(/No finding matches/.test(await text(p, '#cards')), 'an empty result says so');
      // A chart segment sets the filters.
      await p.click('.seg[data-doc="src/v2/SLICE_15_FOUNDING.md"]');
      ok((await p.$eval('#f-doc', (s) => s.value)) === 'src/v2/SLICE_15_FOUNDING.md', 'segment click selects its document');
      ok((await count(p, '#cards .card')) === D.findings.filter((f) => f.doc === 'src/v2/SLICE_15_FOUNDING.md').length, 'and lists its findings');
      // The known findings render their evidence.
      await p.selectOption('#f-group', 'all');
      await p.selectOption('#f-doc', 'all');
      await p.fill('#f-text', '.gitignore:17');
      const gi = await text(p, '#cards .card[data-key^="src/v2/SLICE_9_FOUNDING.md:427"]');
      ok(/MOVED/.test(gi) && /snippet now at :19/.test(gi), 'SLICE_9:427 .gitignore:17 reads MOVED to :19');
      ok(D.full ? /first appeared and last edited ac24663, 2026-07-12: held/.test(gi) : true, 'and held when written (ac24663)');
      // Tables.
      const tRows = await p.$$eval('#t-status tbody tr[data-status]', (rs) => rs.map((r) => [r.dataset.status, Number(r.children[4].textContent.replace(/,/g, ''))]));
      ok(tRows.every(([s, n]) => n === (D.checkout.counts.byStatus[s] || 0)), 'status table totals = data');
      ok((await count(p, '#t-docs tbody tr')) === D.checkout.docs.length, 'document table lists all 26 documents');
      // Try it: the default example.
      const tryRows = await p.$$eval('#try-list li', (rs) => rs.map((r) => ({ ref: r.dataset.ref, status: r.dataset.status, line: r.dataset.line, det: r.textContent })));
      const tgi = tryRows.find((r) => r.ref === '.gitignore:17');
      ok(tgi && tgi.status === 'MOVED' && tgi.line === '427' && /snippet now at :19/.test(tgi.det), 'Try it: .gitignore:17 on line 427 MOVED to :19 (computed in the page)');
      ok(tryRows.some((r) => r.ref === 'tools/slice9-research/data/slice9-cutover-sample.json' && r.status === 'UNCHECKABLE'), 'Try it: a path not loaded is UNCHECKABLE, not MISSING');
      // Edit the target: drop the two comment lines and the citation holds.
      await p.$eval('#try-file', (t) => { t.value = t.value.replace(/^# Evidence artifacts.*\n# before any.*\n/m, ''); });
      await p.click('#try-run');
      ok((await p.$eval('#try-list li[data-ref=".gitignore:17"]', (r) => r.dataset.status)) === 'OK', 'Try it: without the two comment lines, :17 is OK');
      // Refusals and the no-git commit.
      await p.fill('#try-doc', 'Nothing here cites anything.');
      await p.click('#try-run');
      ok(/No reference found/.test(await text(p, '#try-out')), 'Try it: a passage with no reference refuses');
      await p.fill('#try-doc', '');
      await p.click('#try-run');
      ok(/Nothing to check/.test(await text(p, '#try-out')), 'Try it: an empty passage refuses');
      await p.fill('#try-doc', 'Fixed at `f7b19e7`, see `.gitignore:3` (`.env`).');
      await p.click('#try-run');
      ok(/a browser has no git/.test(await text(p, '#try-out')), 'Try it: a commit is UNCHECKABLE without git');
      ok((await p.$eval('#try-list li[data-ref=".gitignore:3"]', (r) => r.dataset.status)) === 'MOVED', 'Try it: `.env` is not on line 3 of the edited file');
      await p.click('#try-reset');
      ok((await p.$eval('#try-list li[data-ref=".gitignore:17"]', (r) => r.dataset.status)) === 'MOVED', 'reset restores the Aster example');
      // Keyboard: Tab reaches a chip, Space presses it.
      await p.focus('#chips .chip[data-status="MOVED"]');
      await p.keyboard.press('Space');
      ok((await p.$eval('#chips .chip[data-status="MOVED"]', (b) => b.getAttribute('aria-pressed'))) === 'true', 'Space presses a focused chip');
      ok((await count(p, '#cards .card')) >= 1, 'keyboard filter lists findings');
      ok(errors.length === 0, `no console errors on desktop (${errors.join(' | ')})`);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'desktop-light.png'), fullPage: true });
      await ctx.close();
    }
    // ---------------------------------------------------------------- phone, dark, touch
    {
      const { p, ctx, errors } = await page(browser, { width: 390, height: 844, scheme: 'dark' });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 0, `no sideways scroll at 390 px (overflow ${overflow})`);
      const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      ok(bg === 'rgb(18, 20, 22)', `dark background in dark mode (${bg})`);
      const ink = await p.evaluate(() => getComputedStyle(document.body).color);
      ok(ink === 'rgb(232, 233, 230)', `light ink in dark mode (${ink})`);
      const seg = await p.evaluate(() => getComputedStyle(document.querySelector('.seg.g-fix')).backgroundColor);
      ok(seg === 'rgb(57, 135, 229)', `dark chart colours are the dark steps (${seg})`);
      await p.tap('.seg[data-doc="STATUS.md"][data-group="fix"]');
      const statusFix = D.findings.filter((f) => f.doc === 'STATUS.md' && GROUP[f.cls] === 'fix').length;
      ok((await count(p, '#cards .card')) === statusFix, `tapping STATUS.md's needs-a-fix segment lists ${statusFix}`);
      const wide = await p.$$eval('.card, .tile, .chart, .filters, textarea', (ns) => ns.filter((n) => n.getBoundingClientRect().right > window.innerWidth + 1).length);
      ok(wide === 0, 'no card, tile or field runs off the screen');
      ok(errors.length === 0, `no console errors on the phone (${errors.join(' | ')})`);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'phone-dark.png'), fullPage: true });
      await ctx.close();
    }
    if (SHOTS) {
      for (const [w, h, s] of [[390, 844, 'light'], [1280, 900, 'dark']]) {
        const { p, ctx } = await page(browser, { width: w, height: h, scheme: s });
        await p.screenshot({ path: path.join(SHOTS, `${w < 500 ? 'phone' : 'desktop'}-${s}.png`), fullPage: true });
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
