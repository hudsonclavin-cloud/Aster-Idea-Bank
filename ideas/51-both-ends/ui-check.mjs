#!/usr/bin/env node
// Drives index.html in headless Chromium and checks what a person sees against the kernel.
//   node ideas/51-both-ends/ui-check.mjs
// Exits 0 when every check passes, 1 otherwise; prints "skipped" and exits 0 without Playwright.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const B = require('./both-ends.js').create(require('./snapshots/data.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch {
    console.log('ui-check: skipped (Playwright is not installed)');
    process.exit(0);
  }
}
let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } };
const kg = (x) => Math.round(x).toLocaleString('en-US');
const browser = await pw.chromium.launch();

for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 860 } }], ['phone-dark', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL0);

  // default: Bennu on Phase 3
  let m = B.mission('101955', 'phase3');
  let head = await page.textContent('#headline');
  ok(head.includes(`${m.outbound.trimKmps.toFixed(3)} km/s`), `${name}: Bennu throw trim on the page`);
  ok(head.includes(`${m.inbound.trimKmps.toFixed(3)} km/s`), `${name}: Bennu catch trim on the page`);
  ok(head.includes(`${kg(m.tether.caughtKg)} kg`), `${name}: Bennu caught mass on the page`);
  ok((await page.locator('#refused li').count()) === 5, `${name}: five standing refusals`);
  ok((await page.locator('#mass td.no').count()) === 2, `${name}: both Falcon 9 rows refused at C3 17.6`);
  ok((await page.locator('#census tr').count()) === 4, `${name}: census has three tiers`);

  // a trip the Phase 3 tether flies with no burn at either end
  await page.selectOption('#body', '2000 SG344');
  m = B.mission('2000 SG344', 'phase3');
  head = await page.textContent('#headline');
  ok((head.match(/No burn/g) || []).length === 2, `${name}: SG344 owes no burn at either end`);
  ok((await page.textContent('#diagram')).includes(`out ${m.outbound.thetaDeg.toFixed(1)}°`), `${name}: release angle drawn`);

  // tier change (label click works by touch and by mouse)
  await page.locator('#tiers label').first().click();
  m = B.mission('2000 SG344', 'reference');
  head = await page.textContent('#headline');
  ok(head.includes(`${m.outbound.trimKmps.toFixed(3)} km/s`), `${name}: reference tier owes a throw burn`);
  ok((await page.locator('#census tr.sel').textContent()).startsWith('Reference'), `${name}: census row follows the tier`);

  // sample mass, then the refusal state
  await page.fill('#sample', '200');
  m = B.mission('2000 SG344', 'reference', { sampleKg: 200 });
  ok((await page.textContent('#headline')).includes(`${kg(m.tether.caughtKg)} kg`), `${name}: sample changes the caught mass`);
  await page.fill('#sample', '');
  ok(await page.isVisible('#refusal'), `${name}: empty sample box is refused`);
  ok(!(await page.isVisible('#headline')), `${name}: no numbers shown under a refusal`);
  await page.fill('#sample', '0');
  ok(!(await page.isVisible('#refusal')), `${name}: refusal clears`);

  // the other entry-altitude reading
  await page.selectOption('#reading', 'reentry-200');
  m = B.mission('2000 SG344', 'reference', { reading: 'reentry-200' });
  ok((await page.textContent('#legs')).includes(`v∞ ${m.inbound.vInf.toFixed(3)} km/s`), `${name}: 200 km reading changes v-infinity`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, `${name}: no horizontal overflow (${overflow}px)`);
  if (name === 'phone-dark') {
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok(bg === 'rgb(20, 24, 28)', `${name}: dark background (${bg})`);
  }
  ok(errors.length === 0, `${name}: console errors: ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
