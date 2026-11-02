#!/usr/bin/env node
// ui-check.mjs — drives index.html in headless Chromium and compares what the page shows with what
// census.js computes in Node from the same snapshots: the severity counts, the census rows, the two
// contradicted statements, the findings filters, the ledger, keyboard use, phone width, dark mode,
// and the refusal when the snapshots do not load. Run from the bank root:
//   node ideas/29-confidence-census/ui-check.mjs
// (check.mjs runs it for tools/check.mjs). Uses the globally installed Playwright; prints "skipped"
// and exits 0 if it is absent.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSnapshots } from './checkout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require(path.join(here, 'census.js'));
const SNAP = loadSnapshots(here);
const RES = C.run(SNAP.views, SNAP.policy);
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('skipped: playwright is not installed'); process.exit(0); }
}

let checks = 0, failed = 0;
function ok(cond, name) { checks++; if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name); }

async function open(browser, opts, init) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network: ' + r.url()); });
  if (init) await p.addInitScript(init);
  await p.goto(URL0, { waitUntil: 'load' });
  await p.waitForTimeout(150);
  return { ctx, p, errors };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const count = (p, sel) => p.$$eval(sel, (els) => els.length);
const S = RES.summary.by_severity;
const want = (pred) => RES.findings.filter(pred).length;

async function main() {
  const browser = await pw.chromium.launch();
  try {
    // ------------------------------------------------------------ desktop, light
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
      const chips = await p.$$eval('#summary .chip', (els) => els.map((e) => [e.dataset.sev, +e.querySelector('b').textContent]));
      ok(JSON.stringify(chips) === JSON.stringify([['defect', S.defect], ['review', S.review], ['info', S.info]]), `severity chips match the kernel: ${S.defect} / ${S.review} / ${S.info}`);
      ok(/at 0974a62 \(14 tables, 2,346 rows\)/.test(await p.textContent('#stamp')), 'the stamp names the commit and the row total');
      ok(/Not a live scan/.test(await p.textContent('#stamp')), 'the stamp says it is not a live scan');
      ok(/exit 1\. Of 69 hand-written census statements, 56 match the rows, 2 are contradicted, 11 are prose/.test(await p.textContent('#sumline')), 'summary line: exit 1, 69 statements, 56 / 2 / 11');
      const rows = await p.$$eval('#census tbody tr', (trs) => trs.map((tr) => [tr.dataset.table, tr.querySelector('.nums').textContent, tr.children[4].textContent]));
      ok(rows.length === 14, '14 tables in the census');
      for (const c of RES.census) {
        const r = rows.find((x) => x[0] === c.table);
        if (!r || r[1] !== `${c.certain} · ${c.likely} · ${c.recall}` || r[2] !== (c.dates.length ? c.dates[c.dates.length - 1] : 'none')) ok(false, `census row ${c.table}`);
      }
      ok(rows.find((x) => x[0] === 'drills')[1] === '204 · 74 · 4', 'drills reads 204 · 74 · 4 (PROVENANCE.md:105)');
      ok(rows.filter((x) => x[2] === 'none').length === 9, 'nine tables show no date');
      // reconciliation
      const shown = await p.$$eval('#claims li', (lis) => lis.map((li) => [li.dataset.status, li.dataset.cite]));
      ok(shown.length === 13 && shown.every((x) => x[0] !== 'match'), 'by default the 2 contradicted and 11 prose statements are listed');
      ok(JSON.stringify(shown.filter((x) => x[0] === 'mismatch').map((x) => x[1])) === JSON.stringify(['data/README.md:32', 'data/README.md:39']), 'contradicted: data/README.md:32 and :39');
      ok(/130 likely, 45 not \(45 recall; 40 of them disputed\)/.test(await p.textContent('#claims li.st-mismatch')), 'the airframes contradiction shows the counts');
      await p.click('[data-rec=all]');
      ok(await count(p, '#claims li') === RES.reconciliation.length, `"All" lists all ${RES.reconciliation.length} statements`);
      // findings
      const nDR = want((f) => f.severity !== 'info');
      ok(await count(p, '#findings li') === nDR, `defect + review shown by default: ${nDR}`);
      ok(await count(p, '#findings li.sev-defect') === S.defect, `${S.defect} defects listed`);
      await p.click('button[data-sev=info]');
      ok(await count(p, '#findings li') === RES.findings.length, `info toggled on: all ${RES.findings.length}`);
      await p.selectOption('#f-table', 'stock');
      await p.selectOption('#f-rule', 'label-vs-text');
      ok(await count(p, '#findings li') === 44, 'stock × label-vs-text: 44 rows');
      ok(/Showing 44 of 44/.test(await p.textContent('#f-count')), 'the count line agrees');
      await p.selectOption('#f-table', '');
      await p.selectOption('#f-rule', '');
      await p.fill('#f-text', 'ultimate_design_factor');
      const hit = await p.$$eval('#findings li', (lis) => lis.map((li) => [li.dataset.table, li.dataset.rule]));
      ok(JSON.stringify(hit) === JSON.stringify([['design_factors_nasa', 'undocumented-field']]), 'search finds the undocumented ultimate_design_factor');
      await p.fill('#f-text', 'no such thing anywhere');
      ok(await count(p, '#findings li') === 0 && /No finding matches/.test(await p.textContent('#f-count')), 'an empty filter says so');
      await p.fill('#f-text', '');
      // keyboard: tab to the defect toggle and switch it off with the space bar
      await p.focus('button[data-sev=defect]');
      await p.keyboard.press('Space');
      ok(await p.getAttribute('button[data-sev=defect]', 'aria-pressed') === 'false' && await count(p, '#findings li.sev-defect') === 0, 'keyboard: Space toggles the defect filter off');
      await p.keyboard.press('Enter');
      ok(await count(p, '#findings li.sev-defect') === S.defect, 'keyboard: Enter toggles it back on');
      // ledger
      const L = C.ledger(SNAP.views.find((v) => v.table === 'airframes'));
      ok(await p.inputValue('#l-table') === 'airframes', 'the ledger opens on airframes');
      ok(await count(p, '#ledger li') === L.rows.length && L.rows.length === 169, 'airframes ledger: 169 disputed rows');
      await p.click('#ledger li:first-child summary');
      ok(/skeptic_value/.test(await p.textContent('#ledger li:first-child .entry')), 'opening a row shows its entry fields');
      await p.selectOption('#l-table', 'fits');
      ok(await count(p, '#ledger li') === 5 && /plus 5 table-level/.test(await p.textContent('#l-count')), 'fits: the five withheld values (table-level entries)');
      await p.selectOption('#l-table', 'motors');
      ok(/^53 rows with 60 entries/.test(await p.textContent('#l-count')), 'motors ledger: 53 rows, 60 entries');
      ok(!(await overflow(p)), 'no horizontal overflow at 1280 px');
      ok(errors.length === 0, 'no console errors or network requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
    // ------------------------------------------------------------ phone, dark
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true });
      ok(!(await overflow(p)), 'no horizontal overflow at 390 px');
      const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      ok(bg === 'rgb(21, 23, 27)', `dark mode background (${bg})`);
      await p.tap('button[data-sev=info]');
      ok(await count(p, '#findings li') === RES.findings.length, 'tap toggles info on the phone');
      await p.tap('#ledger li:first-child summary');
      ok(await p.$eval('#ledger li:first-child details', (d) => d.open), 'tap opens a ledger row');
      ok(!(await overflow(p)), 'still no overflow with everything open');
      if (process.env.CENSUS_SHOT) await p.screenshot({ path: process.env.CENSUS_SHOT, fullPage: true });
      ok(errors.length === 0, 'no console errors on the phone' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
    // ------------------------------------------------------------ refusal: the snapshots did not load
    {
      const block = () => Object.defineProperty(window, 'CENSUS_VIEWS', { get() { return undefined; }, set() {}, configurable: false });
      const { ctx, p, errors } = await open(browser, { viewport: { width: 390, height: 844 } }, block);
      ok(await count(p, '#summary .refuse') === 1, 'without the views the page refuses');
      ok(/no table views were found/.test(await p.textContent('#summary .refuse')), 'and says what is missing and how to rebuild');
      ok(await count(p, '#census tr') === 0 && await count(p, '#findings li') === 0 && await count(p, '#summary .chip') === 0, 'and shows no number');
      ok(errors.length === 0, 'the refusal raises no console error');
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
