#!/usr/bin/env node
// Drives index.html in headless Chromium, opened from file:// as a person would, at phone width by
// touch and desktop width by mouse and keyboard, and checks the numbers on the page against the
// pure reader, the refusal states, the pane order, dark mode and overflow. Uses the globally
// installed Playwright, as tools/smoke.mjs does. From the bank root:
//   node ideas/03-where-it-lands/ui-check.mjs [--shots DIR]   (DIR gets full-page screenshots;
//   VERBOSE=1 prints every passing check too)
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
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } else if (process.env.VERBOSE) console.log(`ok   ${msg}`); }
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
  ok(/^Conservativewhole ladder · derate 30%$/.test(await page.locator('#columns button[aria-pressed="true"]').textContent()), 'Conservative column is selected, labelled as the whole ladder with its derate');
  ok(/is the workbook's whole Conservative column, not only its derate: 11 of the 14 Assumptions rows differ/.test(await text(page, '#column-levers')), 'the note under the columns says what else the column changes');
  ok(/not an estimate; set your own leg quote/.test(await text(page, '#leg-note')), `the default leg is labelled as the axis midpoint, not an estimate (${await text(page, '#leg-note')})`);
  const leg = Number(await page.locator('#leg-num').inputValue());
  const rd = read({ tier: 'reference', column: 'Conservative', launch: 3245, leg });
  ok((await text(page, '#delivered')) === M.money(rd.delivered.value, 2), `delivered shows ${M.money(rd.delivered.value, 2)} (page: ${await text(page, '#delivered')})`);
  ok((await text(page, '#breakeven')) === M.money(rd.breakeven.value, 2), `breakeven shows ${M.money(rd.breakeven.value, 2)}`);
  ok((await text(page, '#plusleg')) === M.money(rd.plusLeg.value, 2), `delivered + leg shows ${M.money(rd.plusLeg.value, 2)} (page: ${await text(page, '#plusleg')})`);
  ok(/^year 17–18the bracketing nodes disagree: year 17 at \$3,027\.23, year 18 at \$3,255\.04/.test(await text(page, '#payback')), `payback is the bracket of the two nodes: year 17–18 (page: ${await text(page, '#payback')})`);
  ok((await text(page, '#npv')) === M.moneyM(rd.stepped.npv_10pct_M), `NPV is the node's ${M.moneyM(rd.stepped.npv_10pct_M)}`);
  ok(/3,255\.04/.test(await text(page, '#stepped-where')), 'the stepped card names the nearest node');
  ok(/^121\.83×params\/rev_a\.json conservative_30pct_derate/.test(await text(page, '#massratio')), `mass ratio 121.83x, labelled as the rev_a.json value (${await text(page, '#massratio')})`);
  ok(/^609\.1 tparams\/rev_a\.json conservative_30pct_fiber_mass_t/.test(await text(page, '#fibre')), 'fibre mass 609.1 t, from rev_a.json');
  ok((await before(page, '#pane-delivered', '#comparability')) && (await before(page, '#comparability', '#pane-breakeven')), 'delivered-cost pane, then the comparability warning, then the breakeven-price pane');
  ok((await text(page, '#h-delivered')).startsWith('Delivered cost') && (await text(page, '#h-breakeven')).startsWith('Y15 breakeven price'), 'the panes are titled by what each quantity is');
  ok(!/cost side|price side/i.test(await page.evaluate(() => document.body.innerText)), 'nothing on the page frames them as a cost side and a price side');
  ok((await text(page, '#comparability-text')) === G.comparability_warning, 'the warning is the grid\'s text verbatim');
  ok(await page.locator('#partial-flag').isHidden(), 'no partial-tier caveat on the reference tier');
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
  ok(await page.locator('#partial-flag').isVisible(), 'the partial-tier caveat appears for a non-reference tier');
  ok(await page.evaluate(() => document.getElementById('reading').contains(document.getElementById('partial-flag'))), 'inside the reading itself');
  ok((await before(page, '#partial-flag', '#panes')) && (await before(page, '#partial-flag', '#stepped')), 'above every number in it');
  ok((await text(page, '#partial-first')) === M.partialTierSummary(G.partial_tier_caveat).first && /^Do NOT read a non-reference row/.test(await text(page, '#partial-last')), 'its first and last sentences verbatim');
  ok((await text(page, '#partial-tier-text')) === G.partial_tier_caveat, 'and the whole grid text verbatim one tap away');
  const flagGap = await page.evaluate(() => document.getElementById('panes').getBoundingClientRect().top - document.getElementById('partial-flag').getBoundingClientRect().top);
  ok(flagGap > 0 && flagGap < 400, `the flag sits right above the panes on a phone (${Math.round(flagGap)} px)`);
  ok(/^295\.27×params\/rev_a\.json cislunar_2p8kms_30pct_derate/.test(await text(page, '#massratio')), `cislunar / Conservative mass ratio is the published 295.27x rung (${await text(page, '#massratio')})`);
  // the off-axis anchor refuses
  await page.locator('#launch-markers button', { hasText: 'Rideshare' }).tap();
  ok(await page.locator('#refusal').isVisible(), 'the rideshare chip ($7,000) produces a refusal');
  ok(/\$7,000\/kg is above the maximum of the exported construction_launch_per_kg axis/.test(await text(page, '#refusal')), 'which names the axis and the end it fell off, and says the grid does not extrapolate');
  ok(await page.locator('#panes').isHidden(), 'and no numbers are shown');
  ok(/above the maximum of the exported/.test(await text(page, '#launch-note')), 'the slider note repeats the refusal');
  ok((await page.locator('#partial-flag').isVisible()) && (await text(page, '#partial-first')).length > 40, 'the partial-tier caveat stays attached, with its text, while the reading is refused');
  // typing a value back on the axis restores the reading; phase 3 at $3,500 has no payback
  await setNum(page, 'launch-num', 3500);
  ok(await page.locator('#panes').isVisible(), 'typing $3,500 restores the reading');
  await page.locator('#tiers button', { hasText: 'Phase 3' }).tap();
  ok(/not reached within 40 years/.test(await text(page, '#payback')), `phase 3 / Conservative at $3,500: payback "not reached within 40 years" (page: ${await text(page, '#payback')})`);
  ok((await text(page, '#tag-delivered')) === 'exact node', 'the $3,500 node is reported as an exact node');
  // phase 3 / Optimistic: rev_a.json publishes no rung, so the tether figures are withheld (the grid's 440.40x is not shown)
  await page.locator('#columns button[data-column="Optimistic"]').tap();
  const mrOpt = await text(page, '#massratio');
  ok(/^not shownparams\/rev_a\.json publishes no integrated mass ratio for 3\.5 km\/s at 0% derate/.test(mrOpt) && /^not shown/.test(await text(page, '#fibre')), `phase 3 / Optimistic withholds mass ratio and fibre mass (${mrOpt.slice(0, 90)})`);
  ok(!/440/.test(await text(page, '#stepped .facts')), 'and the off-canon 440x figure appears nowhere among the stepped figures');
  await page.locator('.nodedetails summary').tap();
  ok(/mass_ratio_x§/.test(await text(page, '#node-table')) && /§ finance-model output with no matching params\/rev_a\.json rung/.test(await text(page, '#node-foot')), 'the verbatim node table marks the two fields as not canon');
  await page.locator('#columns button[data-column="Conservative"]').tap();
  // an off-axis leg refuses only the composed figure
  await setNum(page, 'leg-num', 20000);
  ok((await text(page, '#plusleg')) === 'refused' && /\$20,000\/kg is above the maximum of the exported leg_cost_per_kg axis/.test(await text(page, '#plusleg-derive')), 'a $20,000 leg refuses the composed figure only');
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

// 1b. Phone, touch gestures and edge inputs, from a fresh page: a scroll that starts on the chart,
// the plane or a slider must not move a number; a tap or a drag from the crosshair must.
{
  const { context, page, errors } = await open(PHONE);
  const cdp = await context.newCDPSession(page);
  const swipe = async (x, y, dy, steps = 10) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  };
  const nums = async () => [await page.locator('#launch-num').inputValue(), await page.locator('#leg-num').inputValue()];
  const scrollY = () => page.evaluate(() => window.scrollY);
  // the chart: an upward swipe scrolls the page and leaves the launch alone; a tap sets it
  await page.locator('#breakeven-chart').scrollIntoViewIfNeeded();
  let b = await page.locator('#breakeven-chart').boundingBox();
  let before0 = await nums();
  let y0 = await scrollY();
  await swipe(b.x + b.width * 0.3, b.y + b.height * 0.6, -200);
  ok(JSON.stringify(await nums()) === JSON.stringify(before0), `a swipe that starts on the breakeven chart changes nothing (${before0} -> ${await nums()})`);
  ok((await scrollY()) !== y0, 'and scrolls the page');
  await page.locator('#breakeven-chart').scrollIntoViewIfNeeded();
  b = await page.locator('#breakeven-chart').boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.3, b.y + b.height * 0.5);
  await page.waitForTimeout(100);
  const tapped = Number(await page.locator('#launch-num').inputValue());
  ok(tapped !== Number(before0[0]) && tapped > 100 && tapped < 3500, `a tap on the chart sets the launch (${tapped})`);
  // the plane: a swipe away from the crosshair scrolls; a drag that starts on the crosshair moves it
  await page.locator('#plane').scrollIntoViewIfNeeded();
  b = await page.locator('#plane').boundingBox();
  const [lv, gv] = (await nums()).map(Number);
  const hx = b.x + 50 + M.axisFrac(G.axes.leg_cost_per_kg, gv) * (b.width - 64);
  const hy = b.y + 12 + (1 - M.axisFrac(G.axes.construction_launch_per_kg, lv)) * (b.height - 46);
  const farX = hx < b.x + b.width / 2 ? b.x + b.width * 0.85 : b.x + b.width * 0.25;
  before0 = await nums();
  y0 = await scrollY();
  await swipe(farX, b.y + b.height * 0.6, -150);
  ok(JSON.stringify(await nums()) === JSON.stringify(before0), `a swipe that starts on the plane away from the crosshair changes nothing (${before0} -> ${await nums()})`);
  ok((await scrollY()) !== y0, 'and scrolls the page');
  await page.locator('#plane').scrollIntoViewIfNeeded();
  b = await page.locator('#plane').boundingBox();
  const hy2 = b.y + 12 + (1 - M.axisFrac(G.axes.construction_launch_per_kg, lv)) * (b.height - 46);
  await swipe(hx, hy2, hy2 - 60 > b.y + 20 ? -60 : 60);
  const [lv2] = (await nums()).map(Number);
  const top2 = (await page.locator('#plane').boundingBox()).y;
  // scroll anchoring may change scrollY as the reading above grows or shrinks; what must not move is the plane under the finger
  ok(lv2 !== lv && Math.abs(top2 - b.y) < 2, `a drag that starts on the crosshair moves the launch (${lv} -> ${lv2}) and the plane stays under the finger (${Math.round(b.y)} -> ${Math.round(top2)})`);
  // the launch slider: a vertical swipe across it does not change the value
  await page.locator('#launch-range').scrollIntoViewIfNeeded();
  b = await page.locator('#launch-range').boundingBox();
  before0 = await nums();
  await swipe(b.x + b.width * 0.2, b.y + b.height / 2, -150);
  ok(JSON.stringify(await nums()) === JSON.stringify(before0), `a vertical swipe across the launch slider changes nothing (${before0} -> ${await nums()})`);
  await page.locator('#launch-range').scrollIntoViewIfNeeded();
  b = await page.locator('#launch-range').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * 0.2, y: b.y + b.height / 2 }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width * (0.2 + 0.05 * i), y: b.y + b.height / 2 }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const dragged = Number(await page.locator('#launch-num').inputValue());
  ok(dragged > Number(before0[0]) || Math.abs(dragged - M.axisValue(G.axes.construction_launch_per_kg, 0.7)) / dragged < 0.05, `a sideways drag along the launch slider still moves it (${before0[0]} -> ${dragged})`);
  // edge inputs
  await page.locator('#launch-range').scrollIntoViewIfNeeded();
  const pos0 = await page.locator('#launch-range').inputValue();
  await setNum(page, 'launch-num', '');
  ok(/^Refused: no construction-launch price entered/.test(await text(page, '#refusal')) && await page.locator('#panes').isHidden(), `an empty launch box is "nothing entered", not an off-axis dollar figure (${(await text(page, '#refusal')).slice(0, 70)})`);
  ok((await page.locator('#launch-range').inputValue()) === pos0, 'and the slider stays where it was');
  await setNum(page, 'launch-num', '3500.001');
  ok(/\$3,500\.001\/kg is above the maximum/.test(await text(page, '#refusal')), 'just above the axis is printed as entered and called above the maximum');
  await setNum(page, 'leg-num', '299.99');
  await setNum(page, 'launch-num', '686');
  ok(/\$299\.99\/kg is below the minimum of the exported leg_cost_per_kg axis/.test(await text(page, '#plusleg-derive')), 'a leg just below the axis is called below the minimum');
  await page.locator('#tiers button[data-tier="cislunar_revenue_gated_option"]').tap();
  ok(/^year 15–16the bracketing nodes disagree: year 15 at \$659\.63, year 16 at \$709\.27/.test(await text(page, '#payback')), `at the $686 cislunar gate payback reads year 15–16, not one node's year (${(await text(page, '#payback')).slice(0, 40)})`);
  ok(!(await overflow(page)), 'no sideways scroll');
  ok(errors.length === 0, `no console errors in the touch checks: ${errors.join('; ')}`);
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
  ok(/^Baselinewhole ladder · derate 15%$/.test(await page.locator('#columns button[aria-pressed="true"]').textContent()), 'Baseline selected by mouse');
  ok((await text(page, '#tag-delivered')).length > 0 && (await text(page, '#payback')).startsWith('year'), 'baseline reading renders');
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
  // a grid whose tier the rev_a.json excerpt cannot label: its button says so and selecting it refuses
  const renamed = JSON.parse(JSON.stringify(G));
  for (const p of renamed.points) if (p.tier === P3) p.tier = 'mars_class_2027';
  await page.locator('#grid-file').setInputFiles({ name: 'renamed_tier.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(renamed)) });
  await page.waitForTimeout(400);
  const ub = page.locator('#tiers button[data-tier="mars_class_2027"]');
  ok(/no tip speed in the rev_a\.json excerpt: refused/.test(await ub.textContent()), 'an unknown tier is labelled as refused');
  await ub.click();
  ok((await page.locator('#refusal').isVisible()) && /has no kinematics block in the rev_a\.json excerpt/.test(await text(page, '#refusal')) && (await page.locator('#panes').isHidden()) && (await page.locator('#stepped').isHidden()), 'and selecting it refuses the reading: no delivered, payback or NPV');
  // refused first, then a non-reference tier: the caveat card is attached with its text
  await page.locator('#tiers button[data-tier="reference"]').click();
  await page.locator('#launch-markers button', { hasText: 'Rideshare' }).click();
  await page.locator('#tiers button[data-tier="cislunar_revenue_gated_option"]').click();
  ok((await page.locator('#partial-flag').isVisible()) && (await text(page, '#partial-tier-text')) === G.partial_tier_caveat, 'refused, then cislunar: the partial-tier caveat is shown with its full text');
  await setNum(page, 'launch-num', 1000);
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
  for (const s of await page.locator('summary:visible').all()) await s.click();
  ok(!(await overflow(page)), `${label}: no sideways scroll with every section open`);
  ok((await text(page, '#insurance-text')) === G.insurance_status, `${label}: insurance status is verbatim`);
  await shot(page, label.replace(' ', '-'));
  ok(errors.length === 0, `${label}: no console errors: ${errors.join('; ')}`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
