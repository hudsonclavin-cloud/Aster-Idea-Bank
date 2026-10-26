#!/usr/bin/env node
// Drives index.html in headless Chromium, opened from file:// as a person would, at phone width by
// touch and desktop width by mouse and keyboard, and checks the numbers on the page against the
// pure reader, the refusal states, the pane order, dark mode and overflow. Uses the globally
// installed Playwright, as tools/smoke.mjs does. From the bank root:
//   node ideas/03-where-it-lands/ui-check.mjs [--shots DIR]   (DIR gets full-page screenshots)
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const M = req(path.join(here, 'model.js'));
const G = req(path.join(here, 'snapshots', 'decision_grid.js'));
const R = req(path.join(here, 'snapshots', 'rev_a.excerpt.js'));
const L = req(path.join(here, 'snapshots', 'ladder.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? path.resolve(process.argv[i + 1]) : null; })();
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
let pw;
try { pw = req('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }

const browser = await pw.chromium.launch();
let checks = 0;
let failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 860 } };
const CIS = 'cislunar_revenue_gated_option';
const P3 = 'phase3_growth_option';
const read = (sel) => M.reading(G, R, L, sel);

async function open(opts, url = URL0) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  await page.goto(url);
  await page.waitForTimeout(200);
  return { context, page, errors };
}
const text = (page, sel) => page.locator(sel).textContent();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const before = (page, a, b) => page.evaluate(([a, b]) => !!(document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING), [a, b]);
const canvasColours = (page) => page.evaluate(() => {
  const c = document.getElementById('plane');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const s = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return s.size;
});
async function setNum(page, id, value) {
  await page.locator(`#${id}`).fill(String(value));
  await page.waitForTimeout(60);
}
const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true }); };

// 1. Phone, touch, light: the default reading, pane order, anchors, tiers, refusals.
{
  const { context, page, errors } = await open(PHONE);
  const prov = await text(page, '#prov');
  ok(/27229e2/.test(prov) && /34935cb/.test(prov) && /450 points/.test(prov), `provenance strip names the grid commit, the snapshot commit and 450 points (${prov.trim().slice(0, 120)})`);
  ok((await page.locator('#launch-num').inputValue()) === '3245', 'opens at the rev_a.json Falcon 9 anchor, $3,245/kg');
  ok((await page.locator('#tiers button[aria-pressed="true"]').textContent()).startsWith('Reference · 2.5 km/s'), 'reference tier is selected and labelled from rev_a.json');
  ok(/Conservative · 30% derate/.test(await page.locator('#columns button[aria-pressed="true"]').textContent()), 'Conservative column is selected, derate from the workbook ladder');
  const leg = Number(await page.locator('#leg-num').inputValue());
  const rd = read({ tier: 'reference', column: 'Conservative', launch: 3245, leg });
  ok((await text(page, '#delivered')) === M.money(rd.delivered.value, 2), `delivered shows ${M.money(rd.delivered.value, 2)} (page: ${await text(page, '#delivered')})`);
  ok((await text(page, '#breakeven')) === M.money(rd.breakeven.value, 2), `breakeven shows ${M.money(rd.breakeven.value, 2)}`);
  ok((await text(page, '#plusleg')) === M.money(rd.plusLeg.value, 2), `delivered + leg shows ${M.money(rd.plusLeg.value, 2)} (page: ${await text(page, '#plusleg')})`);
  ok(/^year 18/.test(await text(page, '#payback')), `payback is stepped to the $3,255.04 node: year 18 (page: ${await text(page, '#payback')})`);
  ok((await text(page, '#npv')) === M.moneyM(rd.stepped.npv_10pct_M), `NPV is the node's ${M.moneyM(rd.stepped.npv_10pct_M)}`);
  ok(/3,255\.04/.test(await text(page, '#stepped-where')), 'the stepped card names the nearest node');
  ok(/121\.83×/.test(await text(page, '#massratio')), 'mass ratio 121.83x at the conservative rung');
  ok((await before(page, '#pane-cost', '#comparability')) && (await before(page, '#comparability', '#pane-price')), 'cost pane, then the comparability warning, then the price pane');
  ok((await text(page, '#comparability-text')) === G.comparability_warning, 'the warning is the grid\'s text verbatim');
  ok(await page.locator('#partial-tier').isHidden(), 'no partial-tier caveat on the reference tier');
  ok((await text(page, '#lanes-list')).includes('lane_multiplier_GEO = 3.5') && (await text(page, '#lanes-list')).includes('Not applied anywhere'), 'lane multipliers listed as text, marked not applied');
  ok((await canvasColours(page)) > 40, 'the plane is drawn (many distinct colours)');
  ok(!(await overflow(page)), 'no sideways scroll at 390 px');
  await shot(page, 'phone-light');
  // an anchor chip by touch
  await page.locator('#launch-markers button', { hasText: 'Workbook Optimistic' }).tap();
  ok((await page.locator('#launch-num').inputValue()) === '800', 'tapping the workbook Optimistic chip sets $800');
  const rd800 = read({ tier: 'reference', column: 'Conservative', launch: 800, leg });
  ok((await text(page, '#delivered')) === M.money(rd800.delivered.value, 2), `delivered at $800 is ${M.money(rd800.delivered.value, 2)}`);
  // the cislunar tier at $800: the rev_a.json pin, and the partial-tier caveat appears
  await page.locator('#tiers button', { hasText: 'Cislunar' }).tap();
  ok((await text(page, '#breakeven')) === '$516.80', `cislunar / Conservative breakeven at $800 reads $516.80 (page: ${await text(page, '#breakeven')})`);
  ok(await page.locator('#partial-tier').isVisible(), 'the partial-tier caveat appears for a non-reference tier');
  ok((await text(page, '#partial-tier-text')) === G.partial_tier_caveat, 'and it is the grid\'s text verbatim');
  // the off-axis anchor refuses
  await page.locator('#launch-markers button', { hasText: 'Rideshare' }).tap();
  ok(await page.locator('#refusal').isVisible(), 'the rideshare chip ($7,000) produces a refusal');
  ok(/\$7,000\/kg is outside the exported construction_launch_per_kg axis/.test(await text(page, '#refusal')), 'which names the axis and says the grid does not extrapolate');
  ok(await page.locator('#panes').isHidden(), 'and no numbers are shown');
  ok(/outside the exported/.test(await text(page, '#launch-note')), 'the slider note repeats the refusal');
  // typing a value back on the axis restores the reading; phase 3 at $3,500 has no payback
  await setNum(page, 'launch-num', 3500);
  ok(await page.locator('#panes').isVisible(), 'typing $3,500 restores the reading');
  await page.locator('#tiers button', { hasText: 'Phase 3' }).tap();
  ok(/not reached within 40 years/.test(await text(page, '#payback')), `phase 3 / Conservative at $3,500: payback "not reached within 40 years" (page: ${await text(page, '#payback')})`);
  ok((await text(page, '#tag-cost')) === 'exact node', 'the $3,500 node is reported as an exact node');
  // an off-axis leg refuses only the composed figure
  await setNum(page, 'leg-num', 20000);
  ok((await text(page, '#plusleg')) === 'refused' && /outside the exported leg_cost_per_kg axis/.test(await text(page, '#plusleg-derive')), 'a $20,000 leg refuses the composed figure only');
  ok(await page.locator('#panes').isVisible() && (await text(page, '#delivered')) !== '', 'delivered is still shown');
  // touch on the plane moves both numbers
  await page.locator('#plane').scrollIntoViewIfNeeded();
  const box = await page.locator('#plane').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const l1 = Number(await page.locator('#launch-num').inputValue());
  const g1 = Number(await page.locator('#leg-num').inputValue());
  ok(l1 > 100 && l1 < 3500 && g1 > 300 && g1 < 15000, `a tap on the plane places both numbers on the axes (launch ${l1}, leg ${g1})`);
  // touch on the launch slider
  await page.locator('#launch-range').scrollIntoViewIfNeeded();
  const sb = await page.locator('#launch-range').boundingBox();
  await page.touchscreen.tap(sb.x + sb.width * 0.1, sb.y + sb.height / 2);
  const l2 = Number(await page.locator('#launch-num').inputValue());
  ok(l2 < l1 && l2 >= 100, `a tap near the slider's left end lowers the launch price (${l2})`);
  ok(!(await overflow(page)), 'still no sideways scroll');
  ok(errors.length === 0, `no console errors on the phone: ${errors.join('; ')}`);
  await context.close();
}

// 2. Desktop, mouse and keyboard: sliders, the plane, the chart hover, the file loader.
{
  const { context, page, errors } = await open(DESK);
  await page.locator('#launch-range').focus();
  const v0 = Number(await page.locator('#launch-num').inputValue());
  await page.keyboard.press('ArrowRight');
  const v1 = Number(await page.locator('#launch-num').inputValue());
  ok(v1 > v0, `ArrowRight on the launch slider raises the price (${v0} -> ${v1})`);
  await page.locator('#plane').focus();
  await page.keyboard.press('ArrowDown');
  const v2 = Number(await page.locator('#launch-num').inputValue());
  ok(v2 < v1, `ArrowDown on the focused plane lowers it (${v1} -> ${v2})`);
  const g0 = Number(await page.locator('#leg-num').inputValue());
  await page.keyboard.press('ArrowRight');
  ok(Number(await page.locator('#leg-num').inputValue()) > g0, 'ArrowRight on the plane raises the leg');
  // a mouse drag across the plane
  await page.locator('#plane').scrollIntoViewIfNeeded();
  const box = await page.locator('#plane').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.3 + 0.05 * i), box.y + box.height * (0.7 - 0.05 * i));
  await page.mouse.up();
  const la = Number(await page.locator('#launch-num').inputValue());
  const lg = Number(await page.locator('#leg-num').inputValue());
  ok(la > 300 && la < 3500 && lg > 1000 && lg < 15000, `dragging up and right moves the crosshair to higher launch and leg (${la}, ${lg})`);
  const rd = read({ tier: 'reference', column: 'Conservative', launch: la, leg: lg });
  ok((await text(page, '#plusleg')) === M.money(rd.plusLeg.value, 2), 'and the composed figure follows');
  // chart hover and click
  await page.locator('#breakeven-chart').scrollIntoViewIfNeeded();
  const cb = await page.locator('#breakeven-chart').boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5);
  ok(await page.locator('#chart-tip').isVisible() && /launch/.test(await text(page, '#chart-tip')) && /Conservative/.test(await text(page, '#chart-tip')), `hovering the breakeven chart shows the three columns at that launch (${(await text(page, '#chart-tip')).trim()})`);
  await page.mouse.click(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5);
  const lc = Number(await page.locator('#launch-num').inputValue());
  ok(lc !== la && lc > 100 && lc < 3500, `clicking the chart sets the launch price (${lc})`);
  await page.locator('#columns button', { hasText: 'Baseline' }).click();
  ok(/Baseline · 15% derate/.test(await page.locator('#columns button[aria-pressed="true"]').textContent()), 'Baseline selected by mouse');
  ok((await text(page, '#tag-cost')).length > 0 && (await text(page, '#payback')).startsWith('year'), 'baseline reading renders');
  // the node table is the node verbatim
  await page.locator('.nodedetails summary').click();
  const rows = await page.locator('#node-table tbody tr').count();
  ok(rows === 16, `the nearest node table has all 16 fields (${rows})`);
  // file loader: a schema 1.0.0 grid is refused, a multiply rule is refused, a valid grid is read
  const plain = JSON.parse(JSON.stringify(G));
  const bad1 = { ...plain, schema_version: '1.0.0' };
  await page.locator('#grid-file').setInputFiles({ name: 'old_grid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad1)) });
  await page.waitForTimeout(300);
  ok(/Refused old_grid\.json: schema_version is "1\.0\.0"/.test(await text(page, '#load-msg')), `a schema 1.0.0 grid is refused (${(await text(page, '#load-msg')).slice(0, 90)})`);
  ok(/snapshot taken at Skyhook 34935cb/.test(await text(page, '#prov')), 'and the snapshot stays');
  const bad2 = JSON.parse(JSON.stringify(G));
  bad2.composition_rules[0].operator = 'multiply';
  await page.locator('#grid-file').setInputFiles({ name: 'mul.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad2)) });
  await page.waitForTimeout(300);
  ok(/Refused mul\.json: .*not the published addition/.test(await text(page, '#load-msg')), 'a grid whose rule is not the published addition is refused');
  await page.locator('#grid-file').setInputFiles({ name: 'not.json', mimeType: 'application/json', buffer: Buffer.from('{nope') });
  await page.waitForTimeout(300);
  ok(/not valid JSON/.test(await text(page, '#load-msg')), 'a file that is not JSON is refused');
  const newer = JSON.parse(JSON.stringify(G));
  newer.git_commit = 'abcdef0123456789';
  newer.generated_at = '2026-12-01T00:00:00+00:00';
  newer.rev_a_md5 = 'ffffffffffffffffffffffffffffffff';
  await page.locator('#grid-file').setInputFiles({ name: 'newer_grid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(newer)) });
  await page.waitForTimeout(400);
  ok(/Reading newer_grid\.json: schema 2\.0\.0, 450 points, built at abcdef0/.test(await text(page, '#load-msg')), `a valid grid is read (${(await text(page, '#load-msg')).slice(0, 90)})`);
  ok(/loaded from file newer_grid\.json/.test(await text(page, '#prov')) && /abcdef0/.test(await text(page, '#prov')), 'the provenance strip now names the file and its commit');
  ok(/built from a different rev_a\.json/.test(await text(page, '#prov')), 'and warns that it was built from a different rev_a.json than the snapshot excerpt');
  ok((await text(page, '#delivered')).startsWith('$'), 'the reading continues from the loaded grid');
  ok(!(await overflow(page)), 'no sideways scroll on desktop');
  await shot(page, 'desktop-light');
  ok(errors.length === 0, `no console errors on desktop: ${errors.join('; ')}`);
  await context.close();
}

// 3. Dark scheme, both sizes: drawn, legible background, no overflow, no errors.
for (const [opts, label] of [[{ ...PHONE, colorScheme: 'dark' }, 'phone dark'], [{ ...DESK, colorScheme: 'dark' }, 'desktop dark']]) {
  const { context, page, errors } = await open(opts);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(/rgb\(13, 13, 13\)/.test(bg), `${label}: dark page background (${bg})`);
  ok((await canvasColours(page)) > 40, `${label}: the plane draws`);
  for (const s of await page.locator('summary').all()) await s.click();
  ok(!(await overflow(page)), `${label}: no sideways scroll with every section open`);
  ok((await text(page, '#insurance-text')) === G.insurance_status, `${label}: insurance status is verbatim`);
  await shot(page, label.replace(' ', '-'));
  ok(errors.length === 0, `${label}: no console errors: ${errors.join('; ')}`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
