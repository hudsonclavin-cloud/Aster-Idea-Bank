#!/usr/bin/env node
// Drives the page in headless Chromium and checks what a reader would see and do: the numbers on
// the page against the model and the study data, the controls by mouse, keyboard and touch, the
// refusals, and phone width in light and dark. Run from the bank root:
//   node ideas/17-known-unknowns/ui-check.mjs [--shots DIR]
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" and exits 0
// when Playwright is not installed.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const K = req(path.join(here, 'model.js'));
const S = req(path.join(here, 'snapshots', 'study.data.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const shotDir = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null;
let pw;
try {
  pw = req('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check skipped: Playwright is not installed');
    process.exit(0);
  }
}
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
const k = S.constants;
const fi = K.fmtInt;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const E = K.OURS.arcEdgesDays;

async function open(opts, init) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  if (init) await page.addInitScript(init);
  await page.goto(URL0);
  await page.waitForTimeout(200);
  return { context, page, errors, requests };
}
const text = (page, sel) => page.locator(sel).first().innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const rowsShown = (page) => page.locator('#list-table tbody tr').count();
const firstDes = (page) => page.locator('#list-table tbody tr').first().getAttribute('data-des');
const resultCount = async (page) => Number(await page.locator('#wi-result').getAttribute('data-survive'));

// 1. Desktop, light: headline, cross-tab, the reversal chart, the what-if filter, the list, the audit.
{
  const { context, page, errors, requests } = await open({ ...DESK, colorScheme: 'light' });
  const H = S.headline;
  const lede = await text(page, '#lede');
  ok(lede.includes(K.fmtPct(H.uHighlyUncertain, H.bodies, 1)) && lede.includes(fi(H.bodies)), 'lede gives the U >= 7 share of all bodies');
  ok(lede.includes(K.fmtRho(S.stratified.all.rhoU)), 'lede gives the catalog-wide rho');
  ok(lede.includes(fi(S.list.total)), 'lede gives the list size');
  ok((await page.locator('.tile').count()) === 4, 'four tiles');
  ok((await text(page, '#tiles')).includes(`${H.arcMedianDays} d`), 'median arc tile');

  // cross-tab: U view, then every other view by click and by arrow key
  ok((await page.locator('#ct-table tbody tr').count()) === 11, 'U view has U 0-9 and not reported');
  ok((await page.locator('#ct-table').getAttribute('data-total')) === '41906', 'cross-tab totals the catalog');
  const u7 = await page.locator('#ct-table tbody tr').nth(7).innerText();
  const ct = K.crossTab(S.hists, 'U');
  ok(u7.includes(fi(ct.rows[7].cells[1])) && u7.includes(K.fmtPct(ct.rows[7].cells[1], ct.rows[7].total, 1)), 'U 7 row shows its 0.1-1 count and share');
  const gridLabel = `${S.lattice.columns}×${S.lattice.rows} cache grid`;
  ok((await text(page, '#ct-table thead')).includes(gridLabel), 'DEC-19-2: the cross-tab names its grid beside the C3 bands');
  ok((await text(page, '#lede')).includes(gridLabel), 'DEC-19-2: the lede names the grid of its medians');
  const headTxt = await text(page, '#ct-table thead');
  ok(headTxt.includes(`< ${k.nearZeroC3} flag`) && headTxt.includes(`${k.c3FirstContour}–${k.feasibleC3Max}`), 'column heads carry Aster’s band edges');
  await page.locator('#ct-views button[data-view="H"]').click();
  ok((await page.locator('#ct-table').getAttribute('data-view')) === 'H', 'H view on click');
  const hUnknown = await page.locator('#ct-table tbody tr.unknown th').innerText();
  ok(hUnknown.includes(fi(S.catalogHeader.catalog.missingAbsoluteMagnitudeCount)), 'H view: not-reported row = the catalog’s missing-H count');
  await page.locator('#ct-views button[data-view="H"]').focus();
  await page.keyboard.press('ArrowLeft');
  ok((await page.locator('#ct-table').getAttribute('data-view')) === 'obs', 'arrow key moves to the observations view');
  ok((await page.locator('#ct-views button[aria-checked="true"]').getAttribute('data-view')) === 'obs', 'and marks it checked');
  ok((await page.locator('#ct-table tbody tr.unknown').count()) === 0, 'no empty not-reported row for observations');
  await page.keyboard.press('ArrowLeft');
  ok((await page.locator('#ct-table').getAttribute('data-view')) === 'arc', 'then the arc view');
  ok((await page.locator('#ct-table').getAttribute('data-total')) === '41906', 'every view totals the catalog');
  const noteTxt = await text(page, '#ct-note');
  ok(noteTxt.includes(S.quotes.mpcWarning.text), 'the MPC warning is quoted verbatim');
  ok(noteTxt.includes(S.constantSources.nearZeroC3.path), 'the near-zero constant is cited');

  // reversal chart
  ok((await page.locator('#why-chart circle.hit').count()) === 14, 'fourteen points: two groups in seven rows');
  ok((await page.locator('#why-chart circle.hollow').count()) === S.stratified.bands.filter((b) => b.uncertain.n < 30).length + S.stratified.bands.filter((b) => b.tight.n < 30).length, 'small groups drawn hollow');
  await page.locator('#why-chart circle.hit[data-row="0"][data-group="s2"]').focus();
  const tipTxt = await text(page, '#tip');
  ok(!(await page.locator('#tip').isHidden()) && tipTxt.includes(K.fmtSig(S.stratified.all.uncertain.medianC3)), 'keyboard focus shows the median in a tooltip');
  await page.keyboard.press('Escape');
  ok(await page.locator('#tip').isHidden(), 'Escape hides it');
  await page.locator('#why summary').click();
  ok((await page.locator('#why-table tbody tr').count()) === 7, 'table view has all + six H bands');
  const whySub = await text(page, '#why-sub');
  ok(whySub.includes(K.fmtRho(S.stratified.all.rhoHU)), 'rho(H, U) stated');

  // what-if filter
  const i30 = E.indexOf(30);
  ok((await page.locator('#u-in').inputValue()) === '6' && (await page.locator('#d-in').inputValue()) === String(i30), 'starts at U <= 6, arc >= 30 d');
  ok((await resultCount(page)) === K.survivors(S.hists.byArc, 6, i30).survive, 'survivor count = model');
  ok((await text(page, '#wi-result')).includes(fi(K.survivors(S.hists.byArc, 6, i30).survive)), 'and printed');
  await page.locator('#u-in').focus();
  let prev = -1;
  let mono = true;
  await page.keyboard.press('Home');
  for (let u = 0; u <= 9; u++) {
    const n = await resultCount(page);
    if (n !== K.survivors(S.hists.byArc, u, i30).survive) mono = false;
    if (n < prev) mono = false;
    prev = n;
    await page.keyboard.press('ArrowRight');
  }
  ok(mono, 'stepping U 0..9 by keyboard: each count matches the model and never falls');
  await page.locator('#d-in').focus();
  await page.keyboard.press('End');
  ok((await page.locator('#d-out').innerText()) === `${E[E.length - 1]} d`, 'End sets the longest arc limit');
  ok((await resultCount(page)) === K.survivors(S.hists.byArc, 9, E.length - 1).survive, 'and the count follows');
  const policy = await text(page, '#wi-policy');
  ok(policy.includes(S.quotes.dec174.text) && policy.includes(S.quotes.planningTier.text), 'DEC-17-4 and the planning-tier reservation quoted');
  ok(/what-if filter, not a tier/.test(policy), 'labelled a what-if filter, not a tier');
  const plot = page.locator('#wi-chart rect.plotbg');
  const bb = await plot.boundingBox();
  await page.mouse.click(bb.x + 2, bb.y + bb.height / 2);
  ok((await page.locator('#d-in').inputValue()) === '0', 'clicking the chart’s left edge sets "any arc"');
  ok((await page.locator('#wi-chart path.sel').count()) === 1 && (await page.locator('#wi-chart path.other').count()) === 9, 'one highlighted U line and nine grey');

  // list
  ok((await rowsShown(page)) === 20, 'list shows 20 rows');
  const rows = S.list.rows.map(K.rowFromArray);
  ok((await firstDes(page)) === rows[S.list.rankings.H[0]].des, 'brightest-first top row');
  ok((await text(page, '#list-table thead')).includes(gridLabel), 'DEC-19-2: the list’s C3 column names its grid');
  ok((await page.locator('#why-chart svg').innerHTML()).includes(gridLabel), 'DEC-19-2: the reversal chart’s axis names its grid');
  await page.locator('#list-more').click();
  ok((await rowsShown(page)) === 40, 'Show more adds 20');
  await page.locator('#list-sort button[data-sort="c3"]').click();
  ok((await rowsShown(page)) === 20, 'changing the ranking resets to 20');
  ok((await firstDes(page)) === rows[S.list.rankings.c3[0]].des, 'lowest-C3 top row');
  ok((await page.locator('#list-table .badge', { hasText: S.quotes.nearZeroBadge.text }).count()) === 20, 'every top-C3 row carries Aster’s near-zero badge');
  const rankNote = await text(page, '#list-rank-note');
  ok(rankNote.includes(fi(S.list.firstNotNearZeroRankByC3 - 1)), 'rank note says how many near-zero rows lead the ranking');
  await page.locator('#hide-nz').check();
  const hidden = await page.locator('#list-table td.c3 .hidden-note').allInnerTexts();
  ok(hidden.length === 20 && hidden.every((t) => t === S.quotes.nearZeroHidden.template.replace('{count}', '20')), 'hiding replaces each value in place with Aster’s notice');
  ok((await page.locator('#list-table .badge', { hasText: S.quotes.nearZeroBadge.text }).count()) === 0, 'and the badge with it');
  ok((await rowsShown(page)) === 20, 'hiding removes no rows (DEC-19-1)');
  await page.locator('#hide-nz').uncheck();
  ok((await page.locator('#list-table td.c3 .hidden-note').count()) === 0, 'unhiding restores the values');
  // an L1 row after its encounter carries Aster's own sentence
  await page.locator('#list-sort button[data-sort="H"]').click();
  const enc = page.locator('#list-table .badge', { hasText: 'encounter' }).first();
  const encTitle = await enc.getAttribute('title');
  ok(/^Arrival is after this object's \d{4}-\d{2}-\d{2} encounter\. This cell is computed from an orbit that encounter invalidates\.$/.test(encTitle), 'encounter badge uses the support-boundary sentence');

  // qualityRank calculator
  const qr = await text(page, '#qr-out');
  ok(qr.includes(K.qualityRankSpec(9, 94131).toFixed(6)) && qr.includes(K.qualityRankLiteral(9, 94131).toFixed(6)), 'calculator default: spec and string readings');
  ok((await page.locator('#qr-out').getAttribute('data-state')) === 'differ', 'and they differ');
  await page.locator('#qr-u').fill('10');
  ok((await page.locator('#qr-out').getAttribute('data-state')) === 'refused', 'U 10 is refused, not computed');
  await page.locator('#qr-u').fill('3');
  await page.locator('#qr-arc').fill('500');
  ok((await page.locator('#qr-out').getAttribute('data-state')) === 'agree', 'arc under 1000 d: the readings agree');
  const audit = await text(page, '#audit-body');
  ok(audit.includes(fi(S.qualityAudit.literalDisagrees)) && audit.includes(S.formulas.fixtureString.text), 'audit names the count and quotes the string');

  // refusals and provenance
  const codes = await page.locator('#ref-list .refusal-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
  ok(codes.length === 4 && codes.every((c) => S.quotes.refusalCodes.codes.includes(c)), 'four refusals, each with a code from Aster’s enum');
  ok((await text(page, '#ref-list')).includes(S.quotes.slice18Caveat.text), 'Slice 18 caveat quoted verbatim');
  ok((await text(page, '#prov-body')).includes(S.aster.commit), 'provenance names the full commit');
  ok(requests.every((u) => u.startsWith('file:')), 'no network requests');
  ok(errors.length === 0, `no console errors on desktop (${errors.join(' | ')})`);
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'desktop-light.png'), fullPage: true });
  await context.close();
}

// 2. Phone, by touch, light and dark.
for (const scheme of ['light', 'dark']) {
  const { context, page, errors } = await open({ ...PHONE, colorScheme: scheme });
  ok(!(await overflow(page)), `${scheme}: no sideways scroll at 390 px`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(17, 17, 16)' : bg === 'rgb(244, 243, 239)', `${scheme}: body background follows the scheme (${bg})`);
  const wrapScrolls = await page.locator('#crosstab .table-wrap').evaluate((e) => e.scrollWidth > e.clientWidth);
  ok(wrapScrolls, `${scheme}: the cross-tab scrolls inside its own box`);
  const sticky = await page.locator('#ct-table tbody th.rowh').first().evaluate((e) => getComputedStyle(e).position);
  ok(sticky === 'sticky', `${scheme}: row labels stay put while it scrolls`);
  ok((await page.locator('#list-table tbody tr').first().evaluate((e) => getComputedStyle(e).display)) === 'grid', `${scheme}: list rows become cards`);
  const card = await page.locator('#list-table tbody tr').first().boundingBox();
  ok(card.width <= 390 - 2 * 16 + 1, `${scheme}: a card fits the screen (${card.width.toFixed(0)} px)`);
  // drag the U slider's thumb to its left end with real touch events
  await page.locator('#u-in').scrollIntoViewIfNeeded();
  const s = await page.locator('#u-in').boundingBox();
  const cdp = await context.newCDPSession(page);
  const y = s.y + s.height / 2;
  const x0 = s.x + 8 + ((s.width - 16) * 6) / 9;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - ((x0 - s.x) * i) / 8, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const u = Number(await page.locator('#u-in').inputValue());
  ok(u <= 1, `${scheme}: dragging the U thumb left by touch sets U to ${u}`);
  ok((await resultCount(page)) === K.survivors(S.hists.byArc, u, Number(await page.locator('#d-in').inputValue())).survive, `${scheme}: count follows the touch`);
  // and the arc thumb to its right end
  const t = await page.locator('#d-in').boundingBox();
  const ty = t.y + t.height / 2;
  const tx0 = t.x + 8 + ((t.width - 16) * E.indexOf(30)) / (E.length - 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx0, y: ty }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx0 + ((t.x + t.width - tx0) * i) / 8, y: ty }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const d = Number(await page.locator('#d-in').inputValue());
  ok(d >= E.length - 2, `${scheme}: dragging the arc thumb right by touch sets the limit to ${E[d]} d`);
  ok((await resultCount(page)) === K.survivors(S.hists.byArc, u, d).survive, `${scheme}: count follows both thumbs`);
  await page.locator('#list-sort button[data-sort="c3"]').tap();
  ok((await firstDes(page)) === K.rowFromArray(S.list.rows[S.list.rankings.c3[0]]).des, `${scheme}: tapping the ranking switches it`);
  await page.locator('#hide-nz').tap();
  ok((await page.locator('#list-table td.c3 .hidden-note').count()) === 20, `${scheme}: tapping hide replaces the values`);
  const dot = await page.locator('#why-chart circle.hit').first().boundingBox();
  await page.touchscreen.tap(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.waitForTimeout(80);
  ok(!(await overflow(page)), `${scheme}: still no sideways scroll after every control`);
  ok(errors.length === 0, `${scheme}: no console errors on the phone (${errors.join(' | ')})`);
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `phone-${scheme}.png`), fullPage: true });
  await context.close();
}

// 3. Without the study data the page refuses instead of showing placeholders.
{
  const { context, page } = await open(DESK, () => {
    Object.defineProperty(window, 'KU_STUDY', { configurable: false, get: () => undefined, set: () => {} });
  });
  const body = await page.locator('main').innerText();
  ok(body.includes('The study data did not load.'), 'missing data: a refusal, not a placeholder');
  ok(!/\d{2},\d{3}/.test(body), 'missing data: no counts on the page');
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
if (shotDir) console.log(`screenshots in ${shotDir}`);
process.exit(failures ? 1 : 0);
