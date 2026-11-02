#!/usr/bin/env node
// ui-check.mjs — drives index.html in headless Chromium. Every number the page shows is compared
// with what coldread.js computes in Node for the same text; the gate comparison, the mutations,
// typing, the filters, the corpus table, phone width, dark mode, touch and a throwing localStorage
// are exercised. Run from the bank root: node ideas/24-cold-read/ui-check.mjs (check.mjs runs it
// for tools/check.mjs). Uses the globally installed Playwright; prints "skipped" if it is absent.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CR = require(path.join(here, 'coldread.js'));
const entries = [];
for (const d of ['snapshots', 'snapshots/fixtures'])
  for (const f of fs.readdirSync(path.join(here, d)).filter((x) => x.endsWith('.js') && x !== 'app-rules.js')) entries.push(require(path.join(here, d, f)));
const LIST = require(path.join(here, 'corpus.js')).build(entries);
const text = (id) => LIST.find((c) => c.id === id).text;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('skipped: playwright is not installed'); process.exit(0); }
}

let checks = 0, failed = 0;
function ok(cond, name) { checks++; if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name); }
const plural = (n, one) => `${n} ${n === 1 ? one : one + 's'}`;

async function open(browser, opts, init) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network: ' + r.url()); });
  if (init) await p.addInitScript(init);
  await p.goto(URL0, { waitUntil: 'load' });
  await p.waitForTimeout(200);
  return { ctx, p, errors };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const counts = (p) => p.evaluate(() => [document.getElementById('n-err').textContent, document.getElementById('n-warn').textContent, document.getElementById('n-info').textContent]);
const want = (r) => [plural(r.summary.errors, 'error'), plural(r.summary.warnings, 'warning'), plural(r.summary.infos, 'note')];
const diagLines = (p) => p.$$eval('#diags .diag', (b) => b.map((x) => [x.dataset.code, +x.dataset.line]));

async function main() {
  const browser = await pw.chromium.launch();
  try {
    // ---------------------------------------------------------------- desktop, light
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
      const endcap = text('tests/dryrun/endcap.scad');
      const r = CR.lint(endcap);
      ok(await p.inputValue('#pick') === 'tests/dryrun/endcap.scad', 'opens on the endcap dry run');
      ok(JSON.stringify(await counts(p)) === JSON.stringify(want(r)), `counts match the kernel: ${want(r).join(', ')}`);
      const dl = await diagLines(p);
      ok(JSON.stringify(dl) === JSON.stringify(r.diagnostics.map((d) => [d.code, d.line])), `the ${dl.length} diagnostics are the kernel's, in its order`);
      ok(dl[0][0] === 'CONTRADICTION' && dl[0][1] === 29 && dl[1][1] === 30, 'the two contradictions are first, at lines 29 and 30');
      const gate = await p.textContent('#gate-line');
      ok(/recorded 4 failures/.test(gate) && /2 of 4/.test(gate), 'gate comparison: 2 of the 4 recorded failures named before any render');
      ok((await p.locator('#gate .found').count()) === 2 && (await p.locator('#gate .mesh').count()) === 2, 'the two geometric failures are marked as found on the rendered part');
      ok((await p.textContent('#footer')).includes('text checks only; geometry not checked'), 'footer line present');
      // jump to a line
      await p.click('#diags .diag >> nth=1');
      const sel = await p.evaluate(() => { const c = document.getElementById('code'); return [c.selectionStart, c.selectionEnd, document.querySelector('#gutter .cur') && document.querySelector('#gutter .cur').textContent]; });
      const L = endcap.split('\n'); const start = L.slice(0, 29).reduce((n, l) => n + l.length + 1, 0);
      ok(sel[0] === start && sel[1] === start + L[29].length && sel[2] === '30', 'clicking the second contradiction selects line 30 and marks it in the gutter');
      ok(await p.evaluate(() => document.querySelector('#gutter [data-l="29"]').className === 'e'), 'gutter marks line 29 as an error line');
      // typing: paste a broken file, lint follows
      const broken = text('tests/templates/centering-ring.scad').replace('"n":4,"bc_d_mm":126.00,"start_deg":45', '"n":0,"bc_d_mm":126.00,"start_deg":45');
      await p.fill('#code', broken);
      await p.waitForTimeout(400);
      const rb = CR.lint(broken);
      ok(JSON.stringify(await diagLines(p)) === JSON.stringify(rb.diagnostics.map((d) => [d.code, d.line])), 'typed text is linted again: a FLIGHT_DROP at line 21 appears');
      ok((await p.textContent('#gate')).includes('has been edited'), 'an edited text gets no borrowed gate verdict');
      // mutation presets
      await p.selectOption('#breakit', 'omit');
      await p.waitForTimeout(100);
      const omit = text('tests/templates/av-sled.scad').replace('union(){ plate(); bosses(); }', 'union(){ plate(); }');
      ok(await p.inputValue('#pick') === 'tests/templates/av-sled.scad' && await p.inputValue('#code') === omit, 'Break it: av sled with bosses() left out of main()');
      const codes = (await diagLines(p)).map((x) => x[0]);
      ok(codes.includes('MAIN_UNREACHED') && codes.includes('SHORTCUT'), 'MAIN_UNREACHED and the shortcut warning are shown');
      for (const b of await p.$$eval('#breakit option', (o) => o.map((x) => x.value).filter(Boolean))) {
        await p.selectOption('#breakit', b);
        await p.waitForTimeout(50);
        const e = await p.textContent('#n-err'), w = await p.textContent('#n-warn');
        if (b === 'comment') {   // the app's lint() fires on a comment; Cold Read keeps it as a note marked false
          const n = await p.$$eval('#diags .diag[data-code="APP_LINT"]', (x) => x.map((y) => y.className + ' ' + y.textContent));
          ok(n.length === 1 && /info/.test(n[0]) && /inside a comment/.test(n[0]) && e === '0 errors' && w === '0 warnings', 'Break it "comment": the app\'s text() warning, shown as a note marked false');
          continue;
        }
        ok(!(await p.locator('#refusal').count()) && (e !== '0 errors' || w !== '0 warnings'), `Break it "${b}" applies and raises something (${e}, ${w})`);
      }
      // grade override
      await p.selectOption('#breakit', 'fn');
      await p.selectOption('#grade', 'hobby');
      await p.waitForTimeout(50);
      const fl = await p.$$eval('#diags .diag[data-code="APP_FLIGHT_LINT"]', (b) => b.map((x) => x.className));
      ok(fl.length === 1 && /warning/.test(fl[0]), 'grade hobby turns flightLint into a warning');
      await p.selectOption('#grade', '');
      // retainer: clean text, not a pass
      await p.selectOption('#pick', 'tests/dryrun/retainer.scad');
      await p.waitForTimeout(50);
      ok(JSON.stringify(await counts(p)) === JSON.stringify(['0 errors', '0 warnings', '0 notes']), 'retainer: 0 / 0 / 0');
      ok((await p.textContent('#footer')).includes('That is not a pass'), 'retainer: says a clean read is not a pass');
      ok(/0 of 1/.test(await p.textContent('#gate-line')), 'retainer: the gate\'s one failure is not claimed');
      // a recorded run
      await p.selectOption('#pick', 'docs/runs/2026-10-06-gemini-flight-x5/ring3.scad');
      await p.waitForTimeout(50);
      ok((await p.textContent('#gate')).includes('PASS on attempt 2') && (await p.textContent('#gate')).includes('README.md:13'), 'ring3: the run log\'s verdict and its line');
      ok((await p.locator('#diags .diag[data-code="FLIGHT_DEMOTE"]').count()) === 1, 'ring3: the one loads demotion');
      // filters
      await p.selectOption('#pick', 'tests/dryrun/endcap.scad');
      await p.uncheck('#f-info');
      await p.waitForTimeout(50);
      ok((await p.locator('#diags .diag.info').count()) === 0 && (await p.locator('#diags .diag.error').count()) === 2, 'unticking notes hides the 4 notes');
      await p.check('#f-info');
      // corpus table
      ok((await p.locator('#corpus tr.row').count()) === LIST.length, `corpus table lists all ${LIST.length} texts`);
      const totals = LIST.reduce((a, c) => { const s = CR.lint(c.text).summary; return [a[0] + s.errors, a[1] + s.warnings, a[2] + s.infos]; }, [0, 0, 0]);
      ok((await p.textContent('#corpus-intro')).includes(`${plural(totals[0], 'error')}, ${plural(totals[1], 'warning')}, ${plural(totals[2], 'note')}`), `corpus totals match the kernel: ${totals.join(' / ')}`);
      await p.click('#corpus tr.row[data-id="tests/templates/fin.scad"]');
      await p.waitForTimeout(50);
      ok(await p.inputValue('#pick') === 'tests/templates/fin.scad' && (await p.locator('#corpus tr.sel').count()) === 1, 'clicking a corpus row loads it and marks the row');
      await p.focus('#corpus tr.row[data-id="tests/dryrun/retainer-fixed.scad"]');
      await p.keyboard.press('Enter');
      ok(await p.inputValue('#pick') === 'tests/dryrun/retainer-fixed.scad', 'Enter on a focused corpus row loads it');
      // own text, empty
      await p.click('#clear');
      await p.waitForTimeout(50);
      ok(await p.inputValue('#pick') === 'own' && JSON.stringify(await counts(p)) === JSON.stringify(['0 errors', '0 warnings', '1 note']), 'cleared: your own text, empty, one note (no SPEC block)');
      ok((await p.textContent('#gate')).includes('no gate result is recorded'), 'own text: no gate result claimed');
      ok((await p.locator('#rules tr').count()) === CR.RULES.length + 1, `rule catalogue lists ${CR.RULES.length} rules`);
      ok(!(await overflow(p)), 'no horizontal overflow at 1280 px');
      ok(errors.length === 0, 'no console errors or network requests at 1280 px' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
    // ---------------------------------------------------------------- phone, dark, touch
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
      const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      ok(bg === 'rgb(21, 23, 26)', `dark scheme background (${bg})`);
      ok(!(await overflow(p)), 'no horizontal overflow at 390 px');
      await p.tap('#diags .diag >> nth=0');
      await p.waitForTimeout(100);
      const cur = await p.evaluate(() => document.querySelector('#gutter .cur') && document.querySelector('#gutter .cur').textContent);
      ok(cur === '29', 'a tap on the first diagnostic marks line 29');
      const top = await p.evaluate(() => document.getElementById('code').getBoundingClientRect().top);
      ok(top < 844 && top > -400, 'and scrolls the editor into view');
      await p.locator('details summary').tap();
      ok(!(await overflow(p)), 'no horizontal overflow at 390 px with the rule table open');
      for (const b of ['n0', 'comma', 'omit']) {
        await p.selectOption('#breakit', b);
        ok(!(await overflow(p)), `no overflow at 390 px after "${b}"`);
      }
      ok(errors.length === 0, 'no console errors at 390 px' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
    // ---------------------------------------------------------------- storage blocked
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 800, height: 900 } }, () => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      });
      ok(await p.inputValue('#pick') === 'tests/dryrun/endcap.scad' && (await p.textContent('#n-err')) === '2 errors', 'with localStorage throwing, the page still opens and reads');
      await p.selectOption('#pick', 'own');
      await p.fill('#code', '// SPEC-BEGIN\n// {"parts":[{"name":"a"}],}\n// SPEC-END\n');
      await p.waitForTimeout(400);
      ok((await p.locator('#diags .diag[data-code="SPEC_JSON"]').count()) === 1, 'own text with a trailing comma in SPEC: SPEC_JSON named');
      ok(errors.length === 0, 'no console errors with storage blocked' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
