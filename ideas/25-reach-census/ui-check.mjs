#!/usr/bin/env node
// ui-check.mjs — drives index.html in headless Chromium. Every count the page shows is compared
// with what census.js computes in Node from the same packs; the runner picker, the findings, the
// command evaluator (including its refusals and the Node 20 / 24 difference), the historical
// commits, the CI-gate policy, phone width, dark mode and keyboard reach are exercised.
// Run from the bank root: node ideas/25-reach-census/ui-check.mjs (check.mjs runs it for
// tools/check.mjs). Uses the globally installed Playwright; prints "skipped" if it is absent.
// --shots DIR also saves screenshots there.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require(path.join(here, 'census.js'));
const P = {};
for (const k of ['aster', 'partforge', 'skyhook', 'aster-a697963', 'partforge-60a90cd']) P[k] = require(path.join(here, 'snapshots', `pack-${k}.js`));
const census = (k) => C.censusRepo(C.treeFromPack(P[k], P[k].base ? P[P[k].base].config : P[k].config, P), {});
const R = { aster: census('aster'), partforge: census('partforge'), skyhook: census('skyhook') };
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots') > 0 ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('skipped: playwright is not installed'); process.exit(0); }
}

let checks = 0, failed = 0;
function ok(cond, name) { checks++; if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name); }

async function open(browser, opts, hash) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network: ' + r.url()); });
  await p.goto(URL0 + (hash || ''), { waitUntil: 'load' });
  await p.waitForTimeout(150);
  return { ctx, p, errors };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (p, sel) => p.locator(sel).first().innerText();
const cardCounts = (p, repo) => p.$$eval(`.repo[data-repo="${repo}"] [data-count]`, (xs) => xs.map((x) => [x.getAttribute('data-count'), Number(x.querySelector('.chip').textContent)]));
const want = (r) => C.CLASSES.map((k) => [k, r.counts[k]]);

async function main() {
  const browser = await pw.chromium.launch();
  try {
    // ---------------------------------------------------------------- desktop, light
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
      for (const k of ['aster', 'partforge', 'skyhook']) ok(JSON.stringify(await cardCounts(p, k)) === JSON.stringify(want(R[k])), `${k} card counts match the kernel: ${want(R[k]).map((x) => x.join(' ')).join(', ')}`);
      ok(await p.getAttribute('.repo[data-repo="aster"]', 'aria-pressed') === 'true', 'Aster is selected first');
      ok((await text(p, '.repo[data-repo="aster"] .head')).includes('node --test tests/*.test.mjs reaches 74 of the 97 files CI runs'), 'Aster headline: the AGENTS.md command reaches 74 of 97');
      ok((await text(p, '.repo[data-repo="skyhook"] .head')).includes('1 orphan: tools/twin/verify.mjs'), 'Skyhook headline names the orphan');
      ok((await text(p, '.repo[data-repo="partforge"] .head')).startsWith('no CI workflow'), 'PartForge headline: no CI workflow');
      // map: folders and their files
      const nFiles = await p.locator('#map .file').count();
      ok(nFiles === R.aster.files.length, `the map lists all ${R.aster.files.length} Aster test files (${nFiles})`);
      // pick npm test from package.json
      const npmTest = R.aster.entries.find((e) => e.kind === 'script' && e.file === 'package.json' && e.name === 'test');
      await p.selectOption('#route', npmTest.id);
      const sum = await text(p, '#route-summary');
      ok(sum.includes('reaches 74 of 106') && sum.includes('misses 23'), `npm test: "${sum.slice(0, 120)}…"`);
      ok(await p.locator('#map .file.dim').count() === 106 - 74, '32 files marked not reached');
      ok(await p.locator('#map .dir[data-dir="tests/v2-lambert"] .dcount').innerText() === '0 of 12 reached', 'tests/v2-lambert: 0 of 12 reached by npm test');
      // the documented suite command, presented as the suite at AGENTS.md:32 and :177
      const agents = R.aster.entries.find((e) => e.kind === 'doc' && e.command === 'node --test tests/*.test.mjs');
      await p.selectOption('#route', agents.id);
      ok((await text(p, '#route-summary')).includes('Presented as the suite at AGENTS.md:32, AGENTS.md:177'), 'the doc route names its claim sources');
      // class filter
      await p.selectOption('#route', '');
      await p.uncheck('#show-ci');
      ok(await p.locator('#map .file').count() === R.aster.counts['ci-less'], `unticking CI leaves the ${R.aster.counts['ci-less']} CI-less files`);
      await p.check('#show-ci');
      // findings
      const fx = await text(p, '#findings');
      ok(fx.includes('Doc drift: node --test tests/*.test.mjs') && fx.includes('Presented as the test suite at AGENTS.md:32, AGENTS.md:177'), 'findings: doc drift with its claim sources');
      ok(fx.includes('node --test tools/slice16-harness/test/') && fx.includes('Cannot find module'), 'findings: the RUNBOOK directory command reaches nothing under Node 24');
      ok(fx.includes('9 CI-less files'), 'findings: 9 CI-less files');
      // try a command
      ok((await text(p, '#tryout .big')) === 'Reaches 74 test files', 'try: npm test reaches 74');
      await p.click('#examples button:has-text("node --test tools/slice16-harness/test/")');
      ok((await text(p, '#tryout')).includes('Broken.') && (await text(p, '#tryout .big')) === 'Reaches 0 test files', 'try: the directory form is broken under Node 24 and reaches 0');
      await p.selectOption('#node', '20');
      ok((await text(p, '#tryout .big')) === 'Reaches 6 test files', 'try: under Node 20 it reaches 6');
      await p.selectOption('#node', '24');
      await p.fill('#cmd', "node --test 'tests/**/*.test.mjs'");
      await p.waitForTimeout(300);
      const deep = C.evaluateCommand(C.treeFromPack(P.aster, P.aster.config), "node --test 'tests/**/*.test.mjs'", { node: 24 }).reach.length;
      ok((await text(p, '#tryout .big')) === `Reaches ${deep} test files`, `try: the quoted recursive glob reaches ${deep} under Node 24`);
      await p.selectOption('#node', '20');
      ok((await text(p, '#tryout')).includes('Could not find'), 'try: and Node 20 cannot find it');
      // policy
      ok((await text(p, '#policy .big')) === 'exit 1', 'gate: exit 1 on orphan (verify.mjs)');
      await p.selectOption('#failon', 'ci-less');
      const allLess = C.census(['aster', 'partforge', 'skyhook'].map((k) => C.treeFromPack(P[k], P[k].config)), { failOn: 'ci-less' }).failing.length;
      ok((await text(p, '#policy')).includes(`${allLess} files at or beyond "ci-less"`), `gate: ${allLess} files at or beyond ci-less`);
      ok(!(await overflow(p)), 'no horizontal overflow at 1280 px');
      if (shotsAt) await p.screenshot({ path: path.join(shotsAt, 'desktop-aster.png'), fullPage: true });
      // PartForge, then its historical commit
      await p.click('.repo[data-repo="partforge"]');
      ok((await text(p, '#findings')).includes('No CI workflow'), 'PartForge: the no-workflow finding');
      ok((await text(p, '#tryout .big')) === 'Reaches 13 test files (3 only under a condition)', 'PartForge try: node tests/run.mjs reaches 13, 3 conditional');
      await p.selectOption('#commit', 'partforge-60a90cd');
      const hist = await text(p, '#findings');
      ok(hist.includes('2 orphans') && hist.includes('tests/local-server.test.mjs') && hist.includes('tests/provider-auth.test.mjs'), 'at 60a90cd: the two orphans its later comment names');
      ok((await text(p, '#map-title')).startsWith('PartForge @ 60a90cd'), 'map title follows the commit');
      // Skyhook
      await p.click('.repo[data-repo="skyhook"]');
      const sk = await text(p, '#findings');
      ok(sk.includes('1 orphan') && sk.includes('tools/twin/verify.mjs') && sk.includes('materials/core.md:96'), 'Skyhook: verify.mjs orphan with where it is named');
      ok(sk.includes('NOT installed') && sk.includes('README.md:70'), 'Skyhook: the Quick start route does not install openpyxl');
      await p.fill('#cmd', 'python3 -m unittest discover tests');
      await p.waitForTimeout(300);
      ok((await text(p, '#tryout')).includes('Not understood.'), 'try: unittest discovery is refused, not counted');
      if (shotsAt) await p.screenshot({ path: path.join(shotsAt, 'desktop-skyhook.png'), fullPage: true });
      ok(errors.length === 0, 'no console errors or requests at 1280 px' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
    // ---------------------------------------------------------------- phone, dark, touch, keyboard
    {
      const { ctx, p, errors } = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' }, '#partforge');
      const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      ok(bg === 'rgb(21, 23, 26)', `dark scheme background (${bg})`);
      ok(await p.getAttribute('.repo[data-repo="partforge"]', 'aria-pressed') === 'true', '#partforge opens PartForge');
      ok(!(await overflow(p)), 'no horizontal overflow at 390 px');
      for (const d of await p.$$('#map details.dir:not([open]) > summary')) await d.tap();
      ok(!(await overflow(p)), 'no horizontal overflow at 390 px with every folder open');
      await p.locator('.repo[data-repo="aster"]').tap();
      for (const d of await p.$$('#map details.dir:not([open]) > summary')) await d.tap();
      await p.locator('#examples button').nth(3).tap();
      ok(!(await overflow(p)), 'no horizontal overflow at 390 px: Aster, all folders open, a broken command shown');
      if (shotsAt) await p.screenshot({ path: path.join(shotsAt, 'phone-dark.png'), fullPage: false });
      // keyboard: the repository cards are buttons in the tab order
      await p.focus('.repo[data-repo="skyhook"]');
      await p.keyboard.press('Enter');
      ok(await p.getAttribute('.repo[data-repo="skyhook"]', 'aria-pressed') === 'true', 'Enter on a focused card selects it');
      ok(errors.length === 0, 'no console errors at 390 px' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
