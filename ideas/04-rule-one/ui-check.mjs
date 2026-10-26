#!/usr/bin/env node
// Drives index.html in headless Chromium at phone width (dark) and desktop width (light)
// and checks that what the page shows is what the saved run wrote: the tile counts, the
// headline findings, the quote card against the CLI's own --cite output and the snapshot's
// provenance sidecar, the class filter, no horizontal overflow, no console errors.
// Not run by tools/check.mjs (it needs a browser). From the bank root:
//   node ideas/04-rule-one/ui-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try {
  pw = createRequire(import.meta.url)('playwright');
} catch {
  pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
}
const data = JSON.parse(fs.readFileSync(path.join(here, 'page-data.js'), 'utf8').replace(/^[\s\S]*?window\.RULE_ONE_DATA = /, '').replace(/;\s*$/, ''));
const sidecar = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'rev_a.json.provenance.json'), 'utf8'));

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
const tileCount = (page, cls) => page.locator(`.tile[data-cls="${cls}"] .n`).textContent().then(Number);

// 1. Phone, dark: counts, headline findings, filter by touch, overflow, contrast.
{
  const { context, page, errors } = await open(PHONE);
  ok((await page.locator('#meta').textContent()).includes((data.meta.commit || '').slice(0, 7)), 'header names the commit');
  for (const c of ['NEW', 'KNOWN OPEN', 'ACCEPTED', 'LABELLED']) {
    ok((await tileCount(page, c)) === (data.counts[c] || 0), `${c} tile shows ${data.counts[c]}`);
  }
  ok((await tileCount(page, 'ALL')) === data.findings.length, 'ALL tile equals the number of findings');
  const text = await page.locator('#findings').innerText();
  ok(text.includes('skyhook_no_leo_stress_test.jsx:48'), 'the missing-key schema finding is listed');
  ok(text.includes('tether_to_payload_single_arm_range'), 'the missing key is named');
  ok(text.includes('skyhook_calculator.jsx:11'), 'the SK99 3.9e9 finding is listed');
  ok(text.includes('skyhook_program_site.html:1135'), 'DEVIATIONS #8 (KNOWN OPEN) is listed');
  ok(/DEVIATIONS #8/.test(text), 'the KNOWN OPEN card names its register row');
  ok(text.includes('glossary.md:27'), 'the glossary 100-200x finding is listed');
  ok(text.includes('our 100–200× planning range'), 'the glossary excerpt reaches the offending literal');
  ok(text.includes('program_manifest.md:6') && text.includes('mass ratio ~41×'), 'the 25 August banner values are listed with their excerpt');
  await page.locator('.tile[data-cls="NEW"]').tap();
  await page.waitForTimeout(100);
  const newText = await page.locator('#findings').innerText();
  ok(!newText.includes('skyhook_program_site.html:1135'), 'filtering by NEW hides the KNOWN OPEN card');
  ok((await page.locator('#findings .finding').count()) === data.counts.NEW, 'NEW filter shows exactly the NEW count');
  await page.fill('#q', 'sk99');
  await page.waitForTimeout(100);
  ok((await page.locator('#findings .finding').count()) === 1, 'text filter narrows to the one SK99 finding');
  await page.fill('#q', '');
  await page.locator('.tile[data-cls="ALL"]').tap();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 60, `dark scheme gives a dark background (${bg})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px');
  for (const d of await page.locator('details').all()) await d.evaluate((e) => { e.open = true; });
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px with every section open');
  ok(errors.length === 0, `no console errors on the phone (${errors.join(' | ')})`);
  await context.close();
}

// 2. Desktop, light: the quote card equals the CLI's own card, keyboard reaches the controls.
{
  const { context, page, errors } = await open(DESK);
  const key = 'kinematics.v_tip_kms';
  await page.selectOption('#key', key);
  const card = await page.locator('#card').textContent();
  ok(card.includes(`${key} = 2.5`), 'card for v_tip shows 2.5');
  ok(card.includes('_lower_tip_note'), 'card carries the _lower_tip_note');
  ok(card.includes(sidecar.sourceSha256), 'card carries the sha256 recorded in the provenance sidecar');
  ok(card.includes((sidecar.commit || '').slice(0, 7)), 'card names the snapshot commit from the sidecar');
  const cli = spawnSync('python3', [path.join(here, 'lint_canon.py'), '--cite', key, '--params', path.join(here, 'snapshots', 'rev_a.json')], { encoding: 'utf8' });
  // The saved cards name the checkout's params path, the CLI here names the snapshot: compare the Source line from its commit on.
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('> Cited ')).map((l) => (l.startsWith('> Source: ') ? l.replace(/^> Source: .*? @ /, '> Source: @ ') : l)).join('\n').trim();
  ok(cli.status === 0 && strip(cli.stdout) === strip(card), 'the page card equals the CLI --cite output (date and params path aside)');
  await page.selectOption('#key', 'materials.alternative_fibers.Dyneema_SK99_GPa');
  ok((await page.locator('#card').textContent()).includes('Corrected from 3.9 GPa per VM-001'), 'SK99 card carries its VM-001 note');
  await page.locator('#copy').click();
  await page.waitForTimeout(100);
  ok((await page.locator('#copy-status').textContent()).length > 0, 'Copy reports what it did');
  const verifyRows = await page.locator('#verify tbody tr').count();
  ok(verifyRows === data.verify.rows.length && verifyRows === 42, `canon self-check lists ${data.verify.rows.length} rows`);
  const badRows = await page.locator('#verify tbody tr.bad').count();
  ok(badRows === data.verify.rows.filter((r) => !(r.ok && r.ok_alt)).length && badRows === 10, `disagreeing rows are marked (${badRows})`);
  ok((await page.locator('#re-a').textContent()) === 'at R_E 6371 km' && (await page.locator('#re-b').textContent()) === 'at R_E 6378 km',
    'the two radius columns are named');
  const summary = await page.locator('#verify-summary').textContent();
  ok(summary.includes('39 of 42 reproduce') && summary.includes('orbital.com_radius_km') && summary.includes('No single Earth radius'),
    'the summary names both conventions and the com_radius_km disagreement');
  const p3 = page.locator('#verify tbody tr', { hasText: 'phase3_growth_option.v_upper_release_kms' });
  ok((await p3.locator('td').nth(2).textContent()) === '11.0563' && (await p3.locator('td').nth(3).textContent()) === 'DISAGREES',
    'the Phase 3 release row shows 11.0563 against the file’s 11.05');
  await page.focus('#q');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className));
  ok(!!focused, `Tab moves focus to a control (${focused})`);
  ok((await page.locator('#labels-weak').textContent()).includes('\\bwas\\b') && (await page.locator('#labels-strong').textContent()).includes('historical'),
    'the three label strengths are listed');
  ok((await page.locator('#devs tbody tr').nth(6).textContent()).includes('original_README.md: accepted; skyhook_program_site.html: fixed'),
    'register row 7 shows its per-file states');
  const rulesRows = await page.locator('#rules tbody tr').count();
  ok(rulesRows === data.rules.rules.length, 'every rule is listed');
  ok(errors.length === 0, `no console errors on the desktop (${errors.join(' | ')})`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
