#!/usr/bin/env node
// Drives index.html in headless Chromium: the fixture table matches the module's own classification
// of the snapshot text, the pair view shows the synthetic retry's finding, pasted text is linted
// live (including a refusal), and at 390 px in dark mode nothing scrolls sideways. Run from the bank
// root: node ideas/07-shadow-lint/ui-check.mjs  (check.mjs runs it for tools/check.mjs). Uses the
// globally installed Playwright, as tools/smoke.mjs does; prints "skipped" if it is absent.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(here, 'shadow.js'));
const snaps = path.join(here, 'snapshots');
const data = { metric: require(path.join(snaps, 'fasteners_metric.excerpt.js')), un: require(path.join(snaps, 'fasteners_un.excerpt.js')), motors: require(path.join(snaps, 'motor_perf.excerpt.js')) };
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('skipped: playwright is not installed'); process.exit(0); }
}

let checks = 0, failed = 0;
function ok(cond, name) { checks++; if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name); }

async function page(browser, opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network: ' + r.url()); });
  await p.goto(URL0, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  return { ctx, p, errors };
}

async function main() {
  const browser = await pw.chromium.launch();
  try {
    // ---- desktop, light
    {
      const { ctx, p, errors } = await page(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
      ok(await p.locator('#fixture').inputValue() === 'bulkhead.scad', 'opens on bulkhead.scad');
      const bulk = S.lint(fs.readFileSync(path.join(snaps, 'bulkhead.scad'), 'utf8'), data, 'bulkhead.scad').result;
      const rows = await p.locator('#lint .input').count();
      ok(rows === bulk.rows.reduce((n, r) => n + r.inputs.length + r.missing.length, 0), `bulkhead shows ${rows} input rows, as the module classifies`);
      const classes = await p.locator('#lint .input .badge').allTextContents();
      ok(JSON.stringify(classes) === JSON.stringify(bulk.rows.flatMap((r) => r.inputs.map((i) => i.class))), 'bulkhead badges equal the module\'s classes in order');
      const chips = await p.locator('#lint .chip').allTextContents();
      ok(chips[0] === `${bulk.totals.WITNESSED} witnessed` && chips[2] === `${bulk.totals.UNWITNESSED} unwitnessed`, 'summary chips carry the totals');
      ok((await p.locator('#lint').innerText()).includes('critical "plate thickness" plate/z 12.70'), 'plate_t_mm witness names the critical row');
      ok((await p.locator('#commit').innerText()) === '0974a62', 'the PartForge commit is shown');

      await p.selectOption('#fixture', 'endcap.scad');
      await p.waitForTimeout(100);
      const txt = await p.locator('#lint').innerText();
      ok(txt.includes('Ø95.96/2 = 47.98') && txt.includes('(101.5 − 95.96)/2 = 2.77'), 'endcap: ri_mm and t_mm derivations shown');
      ok(txt.includes('17.4') && txt.includes('UNWITNESSED') && txt.includes('nearest'), 'endcap: the 17.4 wall is unwitnessed with a nearest candidate');

      await p.selectOption('#fixture', 'av-sled.scad');
      await p.waitForTimeout(100);
      ok((await p.locator('#lint .refusal').count()) === 1 && (await p.locator('#lint').innerText()).includes('insufficient_data'), 'av-sled is a structured refusal (no loads rows)');

      // pairs
      ok((await p.locator('#diff').innerText()).includes('IDENTICAL'), 'synthetic pair: geometry identical');
      ok((await p.locator('#diff .finding').count()) === 1 && (await p.locator('#diff').innerText()).includes('force_N 20000 → 12000'), 'synthetic pair: one finding, force_N moved');
      await p.selectOption('#pair', '1');
      await p.waitForTimeout(100);
      const d1 = await p.locator('#diff').innerText();
      ok(d1.includes('floor_loss') && d1.includes('od 2→1') && d1.includes('loads inputs: unchanged'), 'retainer → retainer-fixed: floor loss on od, inputs unchanged');
      await p.selectOption('#pair', '2');
      await p.waitForTimeout(100);
      ok((await p.locator('#diff .ok').count()) === 1, 'ring1 → ring6: no findings');

      // own text
      await p.fill('#own-a', 'cube(1);');
      await p.click('#run');
      await p.waitForTimeout(100);
      ok((await p.locator('#own').innerText()).includes('not_found'), 'pasted bare code refuses with not_found');
      await p.fill('#own-a', fs.readFileSync(path.join(snaps, 'fin.scad'), 'utf8'));
      await p.click('#run');
      await p.waitForTimeout(150);
      const fin = await p.locator('#own').innerText();
      ok(fin.includes('root_mm') && fin.includes('WITNESSED') && fin.includes('v_max_m_s'), 'pasted fin.scad is linted live');
      await p.click('#load-sample');
      await p.waitForTimeout(150);
      ok((await p.locator('#own .finding').count()) === 1 && (await p.locator('#own').innerText()).includes('IDENTICAL'), 'the loaded sample pair is flagged');
      // keyboard: the Lint button is reachable and works by Enter
      await p.fill('#own-a', '');
      await p.focus('#run');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(100);
      ok((await p.locator('#own').innerText()).includes('nothing pasted'), 'empty paste refuses, via keyboard');
      ok(errors.length === 0, 'desktop: no console errors, no network' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
    // ---- phone, dark, touch
    {
      const { ctx, p, errors } = await page(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
      const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      ok(/rgb\(21, 23, 26\)/.test(bg), `dark scheme applied (body ${bg})`);
      const over = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      ok(over.sw <= over.iw + 1, `no horizontal overflow at 390 px (${over.sw} <= ${over.iw})`);
      await p.selectOption('#fixture', 'endcap.scad');
      await p.selectOption('#pair', '1');
      await p.waitForTimeout(150);
      const over2 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      ok(over2.sw <= over2.iw + 1, 'no overflow with the longest fixture and the longest pair');
      const wide = await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
      ok(wide === 0, `no element reaches past the viewport (${wide})`);
      await p.tap('#load-sample');
      await p.waitForTimeout(150);
      ok((await p.locator('#own .finding').count()) === 1, 'the sample pair button works by touch');
      const over3 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      ok(over3.sw <= over3.iw + 1, 'no overflow after the live lint');
      ok(errors.length === 0, 'phone: no console errors, no network' + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
