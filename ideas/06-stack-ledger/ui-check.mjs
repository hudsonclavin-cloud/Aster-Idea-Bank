#!/usr/bin/env node
// Drives Stack Ledger in headless Chromium: phone width by touch in dark mode, desktop width by mouse and
// keyboard in light mode. Asserts the numbers on the page, the refusal states, the table, the number line,
// no console errors and no horizontal overflow. Not run by tools/check.mjs (the name is not *.test.mjs);
// run from the bank root: node ideas/06-stack-ledger/ui-check.mjs [--shots]
// Uses the globally installed Playwright, as tools/smoke.mjs does.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try {
  pw = createRequire(import.meta.url)('playwright');
} catch {
  pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
}
const outDir = process.argv.includes('--shots') ? path.join(os.tmpdir(), 'stack-ledger-ui') : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' };
const DESK = { viewport: { width: 1280, height: 900 }, colorScheme: 'light' };

async function open(opts, url = URL0) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}`));
  await page.goto(url);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const ledgerText = (page) => page.locator('#ledger').innerText();
const bodyText = (page) => page.locator('body').innerText();
async function pick(page, id) { await page.selectOption('#preset', id); await page.waitForTimeout(120); }
async function setJson(page, obj) { await page.fill('#stackJson', JSON.stringify(obj, null, 2)); await page.waitForTimeout(320); }

// 1. Phone, touch, dark: opens on the bulkhead example, numbers, refusals, table, text ledger.
{
  const { context, page, errors } = await open(PHONE);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(21, 23, 28)', `dark scheme applied (body ${bg})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px on load');
  ok((await page.inputValue('#preset')) === 'bulkhead-declared', 'opens on the bulkhead-declared example');
  let lt = await ledgerText(page);
  ok(/^FAIL/.test(lt.trim()), 'verdict reads FAIL');
  for (const n of ['−0.030', '0.170', '0.100', 'margin −0.030', 'N = 3', 'no statistical basis below N=4', '0.070', '0.062', '0.008 to 0.132', '38% narrower']) ok(lt.includes(n), `ledger shows ${n}`);
  ok(/Thermal: none declared/.test(lt), 'no thermal line for this stack');
  ok((await page.locator('#crows tr').count()) === 3, '3 contributor rows');
  const rows = await page.locator('#crows').innerText();
  ok(/146\.270/.test(rows) && /146\.330/.test(rows) && /−146\.250 \.\. −146\.150/.test(rows), 'table shows limits and the signed band of the bulkhead OD');
  ok(/default/.test(rows) && /ILLUSTRATIVE/.test(rows) && /fits\.json notes \(6\)/.test(rows), 'table shows tol_src words and the anodise source');
  ok(await page.locator('#refusals').isHidden(), 'no refusal card for an evaluable stack');
  ok((await page.locator('#numberLine line.worst').count()) === 1 && (await page.locator('#numberLine line.rssb').count()) === 1 && (await page.locator('#numberLine rect.req').count()) === 1, 'number line draws worst, RSS and requirement');
  const svgW = await page.evaluate(() => document.getElementById('numberLine').getBoundingClientRect().width);
  ok(svgW > 300 && svgW <= 390, `number line fits the phone (${svgW}px)`);
  const flags = await page.locator('#flags').innerText();
  ok(/false comfort/.test(flags) && /tool default/.test(flags), 'notes name the RSS false comfort and the tool default');
  ok(/Measurable on a mesh: none/.test(await page.locator('#mesh').innerText()), 'the mesh line is printed');
  await page.locator('details.text summary').tap();
  await page.waitForTimeout(80);
  const pre = await page.locator('#ledgerText').innerText();
  ok(/^STACK LEDGER/.test(pre) && /VERDICT      FAIL/.test(pre) && /verbatim from index\.html:4994-5024/.test(pre), 'text ledger is the CLI text');
  // The template as declared: REFUSED with three refusals and no numbers.
  await pick(page, 'bulkhead-as-declared');
  lt = await ledgerText(page);
  ok(/^REFUSED/.test(lt.trim()), 'bulkhead-as-declared is REFUSED');
  ok(!/worst-case minimum/.test(lt), 'no worst-case figure under a refusal');
  ok(await page.locator('#lineWrap').isHidden(), 'number line hidden under a refusal');
  ok(!(await page.locator('#refusals').isHidden()), 'refusal card shown');
  const rt = await page.locator('#refList').innerText();
  ok(/no_tolerance/.test(rt) && /coating_undeclared/.test(rt) && /cte_placeholder/.test(rt), 'three refusal codes');
  ok(/three clockings/.test(rt) && /0\.005 to 0\.025/.test(rt) && /hoop_cte/.test(rt), 'each refusal says what would help');
  ok((await page.locator('#crows tr.refused').count()) === 3 && (await page.locator('#crows tr').count()) === 4, '3 of 4 rows marked refused');
  ok(!/\bPASS\b/.test(await bodyText(page)), 'PASS appears nowhere on a refused stack');
  // Stock recall as source.
  await pick(page, 'stock-recall-as-source');
  ok(/recall_as_source/.test(await page.locator('#refList').innerText()), 'recall row claimed as source is refused');
  // A passing stack by touch.
  await pick(page, 'motor-tube-in-ring');
  lt = await ledgerText(page);
  ok(/^CLEARS/.test(lt.trim()) && lt.includes('0.030') && lt.includes('0.106') && /N = 1/.test(lt) && /screening only, not a pass/.test(lt), 'motor tube: CLEARS 0.030 / 0.106, N=1, screening');
  ok(/Thermal · \+0\.000 to \+0\.000/.test(lt), 'like-for-like thermal prints as +0.000');
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px after switching examples');
  // No example, whatever its verdict, prints the word PASS anywhere on the page.
  const ids = await page.locator('#preset option').evaluateAll((os) => os.map((o) => o.value));
  let passSeen = [];
  for (const id of ids) { await pick(page, id); if (/\bPASS\b/.test(await bodyText(page))) passSeen.push(id); }
  ok(ids.length === 9 && passSeen.length === 0, `PASS appears on no example (${passSeen.join(', ')})`);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'phone-dark.png'), fullPage: true });
  ok(errors.length === 0, `no console errors on the phone (${errors.join('; ')})`);
  await context.close();
}

// 2. Desktop, light, mouse and keyboard: edit the JSON, bad JSON keeps the last ledger, Compute button, provenance.
{
  const { context, page, errors } = await open(DESK);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(243, 241, 236)', `light scheme applied (body ${bg})`);
  await pick(page, 'plug-in-steel-bore');
  let lt = await ledgerText(page);
  ok(/^FAIL/.test(lt.trim()) && lt.includes('−0.001') && lt.includes('0.107') && /Thermal · −0\.013 to \+0\.038/.test(lt), 'steel bore: FAIL −0.001 / 0.107 with the thermal shift');
  ok(/N = 1 manufacturing contributor/.test(lt) && /thermal kept out/.test(lt), 'RSS excludes the thermal term');
  ok(/with the thermal shift added at both ends, as the worst case adds it, −0\.001 to 0\.107 mm/.test(lt), 'the RSS line adds the thermal envelope like for like');
  ok(!/false comfort/.test(await page.locator('#flags').innerText()), 'no false-comfort note on the steel bore: N=1, no narrowing');
  const bars = await page.evaluate(() => ['worst', 'rssb'].map((c) => { const l = document.querySelector('#numberLine line.' + c); return [Number(l.getAttribute('x1')), Number(l.getAttribute('x2'))]; }));
  ok(Math.abs(bars[0][0] - bars[1][0]) < 0.5 && Math.abs(bars[0][1] - bars[1][1]) < 0.5, `the dashed bar (RSS + thermal) spans the worst-case bar at N=1 (${JSON.stringify(bars)})`);
  ok(/dashed: RSS \+ thermal/.test(await page.locator('#numberLine').textContent()), 'the key says the dashed bar carries the thermal shift');
  // Edit the JSON: drop the thermal term -> PASS with the fit alone.
  const stack = JSON.parse(await page.inputValue('#stackJson'));
  await setJson(page, { ...stack, contributors: stack.contributors.slice(0, 1) });
  lt = await ledgerText(page);
  ok(/^CLEARS/.test(lt.trim()) && lt.includes('0.012') && lt.includes('0.069'), 'without the thermal term the fit alone clears: 0.012 / 0.069');
  // Bad JSON: error shown, last ledger kept.
  await page.fill('#stackJson', '{ "gap_name": "x", ');
  await page.waitForTimeout(320);
  ok(!(await page.locator('#parseError').isHidden()) && /not JSON/.test(await page.locator('#parseError').innerText()), 'bad JSON shows a parse error');
  ok(/^CLEARS/.test((await ledgerText(page)).trim()), 'the last ledger stays while the JSON is being edited');
  // Reload example restores it.
  await page.click('#reload');
  await page.waitForTimeout(150);
  ok(await page.locator('#parseError').isHidden(), 'reload clears the parse error');
  ok(/^FAIL/.test((await ledgerText(page)).trim()), 'reload restores the example');
  // A G10 bore: the placeholder CTE and the fit class on a composite tube are both refused.
  await pick(page, 'plug-in-g10-coupler');
  let rl = await page.locator('#refList').innerText();
  ok(/cte_placeholder/.test(rl) && /fit_on_composite/.test(rl), 'G10 bore refused twice: placeholder CTE and a fit class on a composite tube');
  const g10 = JSON.parse(await page.inputValue('#stackJson'));
  g10.contributors[1].hoop_cte = { hole: { cte_um_m_K: 14, src: 'ILLUSTRATIVE: pretend the in-plane value is the hoop value' } };
  await setJson(page, g10);
  rl = await page.locator('#refList').innerText();
  ok(/^REFUSED/.test((await ledgerText(page)).trim()) && /fit_on_composite/.test(rl) && !/cte_placeholder/.test(rl), 'a hoop CTE lifts the thermal refusal, not the fit one');
  ok(/hoop CTE supplied by the user/.test(await page.locator('#crows').innerText()), 'the thermal row prints as user-supplied');
  // The honest form: the coupler bore measured, the plug an ISO g6 shaft.
  g10.contributors[0] = { kind: 'declared', name: 'G10 coupler ID, measured', nominal_mm: 101.7, tol_mm: 0.04, tol_src: 'user', tol_ref: 'ILLUSTRATIVE three-clocking measurement', dir: 1 };
  g10.contributors.splice(1, 0, { kind: 'iso', name: 'plug g6', size_mm: 101.6, feature: 'shaft', letter: 'g', grade: 6, dir: -1 });
  await setJson(page, g10);
  lt = await ledgerText(page);
  ok(/^CLEARS/.test(lt.trim()) && lt.includes('0.052') && lt.includes('0.233') && await page.locator('#refusals').isHidden(), 'measured bore + g6 plug + user hoop CTE evaluates: CLEARS 0.052 / 0.233');
  // Keyboard: the select is reachable and ArrowDown changes the example; Compute by Enter.
  await page.focus('#preset');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  ok((await page.inputValue('#preset')) === 'bar-as-pin', 'ArrowDown on the select moves to the next example');
  lt = await ledgerText(page);
  ok(/^FAIL/.test(lt.trim()) && lt.includes('−0.038') && lt.includes('0.091'), 'bar as pin: FAIL −0.038 / 0.091');
  ok(/likely/.test(await page.locator('#crows').innerText()) && /ovality/.test(await page.locator('#crows').innerText()) === false, 'stock bar row shows likely; no ovality note for a bar');
  await page.focus('#compute');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  ok(/^FAIL/.test((await ledgerText(page)).trim()), 'Compute by keyboard keeps the ledger');
  // The RSS-centre lesson: two-plus-minus.
  await pick(page, 'two-plus-minus');
  lt = await ledgerText(page);
  ok(/^CLEARS/.test(lt.trim()) && lt.includes('−0.100') && lt.includes('0.100') && lt.includes('0.071') && /29% narrower/.test(lt) && /N = 2/.test(lt), 'two ±0.05: ±0.100 worst, 0.071 RSS, 29% narrower, N=2');
  // Stack-level refusals are not counted as contributors; overflow and an undrawable window refuse or hide, never NaN.
  await setJson(page, null);
  ok(/the stack itself is refused/.test(await ledgerText(page)) && !/contributor refused/.test(await ledgerText(page)), 'null: the stack is refused, not "1 contributor"');
  const huge = { kind: 'declared', name: 'h', nominal_mm: 1e308, tol_mm: 1e307, tol_src: 'user', tol_ref: 't', dir: 1 };
  await setJson(page, { gap_name: 'overflow', contributors: [huge, { ...huge, name: 'h2' }], require: { min_mm: 0 } });
  lt = await ledgerText(page);
  ok(/^REFUSED/.test(lt.trim()) && /invalid_input/.test(await page.locator('#refList').innerText()) && !/NaN|Infinity/.test(await bodyText(page)), 'an overflowing sum is refused with no NaN on the page');
  await setJson(page, { gap_name: 'wide', contributors: [{ kind: 'declared', name: 'a', nominal_mm: 1, tol_mm: 0.1, tol_src: 'user', tol_ref: 't', dir: 1 }], require: { min_mm: -1e308, max_mm: 1e308 } });
  ok(/^CLEARS/.test((await ledgerText(page)).trim()) && await page.locator('#lineWrap').isHidden(), 'a requirement window too wide to draw hides the number line instead of drawing NaN');
  // Provenance footer names the commit, lines and files.
  const pt = await page.locator('#prov').innerText();
  ok(/0974a62/.test(pt) && /lines 4994–5024/.test(pt) && /fits\.json, whole/.test(pt) && /10 of 192 rows/.test(pt) && /bulkhead\.scad and coupler\.scad/.test(pt), 'provenance footer names commit, lines, tables and templates');
  ok(!(await overflow(page)), 'no horizontal overflow at desktop');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'desktop-light.png'), fullPage: true });
  ok(errors.length === 0, `no console errors on the desktop (${errors.join('; ')})`);
  await context.close();
}

// 3. Query string preloads an example; an unknown id falls back.
{
  const a = await open(PHONE, `${URL0}?example=coupler-as-declared`);
  ok((await a.page.inputValue('#preset')) === 'coupler-as-declared' && /^REFUSED/.test((await ledgerText(a.page)).trim()), '?example=coupler-as-declared loads and refuses');
  ok(/no_tolerance/.test(await a.page.locator('#refList').innerText()) && /coating_undeclared/.test(await a.page.locator('#refList').innerText()), 'coupler: two refusals');
  ok(!(await overflow(a.page)), 'no overflow with a query');
  ok(a.errors.length === 0, 'no console errors with ?example');
  await a.context.close();
  const b = await open(DESK, `${URL0}?example=nope`);
  ok((await b.page.inputValue('#preset')) === 'bulkhead-declared', 'unknown example id falls back to the default');
  ok(b.errors.length === 0, 'no console errors with a bad ?example');
  await b.context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed${outDir ? `; screenshots in ${outDir}` : ''}`);
process.exit(failures ? 1 : 0);
