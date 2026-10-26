#!/usr/bin/env node
// Drives index.html in headless Chromium (the globally installed Playwright tools/smoke.mjs uses)
// and checks what a person sees against the census: the headline numbers, the charts' marks, the
// keyboard and touch tooltips, the refusal states, phone width in light and dark, no console errors
// and no network requests. From the bank root: node ideas/10-edge-of-the-grid/ui-check.mjs
// Exits 0 when every check passes, 1 otherwise; prints "skipped" and exits 0 without Playwright.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const G = require(path.join(here, 'grid-census.js'));
const D = require(path.join(here, 'snapshots', 'edge-census.data.js'));
const C = D.census, L = C.lattice, E = C.edges.byEdge;
const f = G.fmtInt;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright is not installed)');
    process.exit(0);
  }
}
let checks = 0, failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const browser = await pw.chromium.launch();

async function open(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('file:')) errors.push(`network request: ${r.url()}`);
  });
  await page.goto(URL0);
  await page.waitForTimeout(250);
  return { context, page, errors };
}
const labelsApart = (page) => page.evaluate(() => {
  const r = [...document.querySelectorAll('#mini svg text.basin-label')].map((t) => t.getBoundingClientRect());
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (!(r[i].right <= r[j].left || r[j].right <= r[i].left || r[i].bottom <= r[j].top || r[j].bottom <= r[i].top)) return false;
  return r.length > 0;
});
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const text = (page, sel) => page.locator(sel).first().textContent();
const count = (page, sel) => page.locator(sel).count();
const tipText = (page, id) => page.evaluate((i) => (document.getElementById(i).hidden ? null : document.getElementById(i).textContent), id);

// 1. Desktop: the numbers a reader sees are the census's
{
  const { context, page, errors } = await open(DESK);
  const lede = await text(page, '#lede');
  ok(lede.includes(f(C.edges.any)), `lede carries the edge count ${f(C.edges.any)}`);
  ok(lede.includes(f(E.tofMin.touched)) && lede.includes(L.firstDepartureUtc) && lede.includes(L.lastDepartureUtc), 'lede carries the floor count and both edge dates');
  ok(lede.includes(f(C.viewTail.minimaAfter)) && lede.includes(C.viewTail.depEndUtc), 'lede carries the view-tail count and date');
  ok((await text(page, '#gridSentence')).includes(C.gridSentence), 'grid sentence is the derived one');
  ok((await count(page, '#tiles .tile')) === 6, 'six headline tiles');
  ok((await text(page, '#tiles .tile.hero .value')) === f(C.edges.any), 'hero tile is the any-edge count');
  const tileValues = await page.locator('#tiles .tile .value').allTextContents();
  for (const v of [f(E.tofMin.touched), f(E.first.touched), f(E.last.touched), f(E.tofMax.touched), f(C.viewTail.minimaAfter)]) ok(tileValues.includes(v), `a tile reads ${v}`);
  // heatmap
  ok((await count(page, '#heat svg rect.cell')) === L.nRows * L.years.length, `heatmap has ${L.nRows * L.years.length} cells`);
  const zeros = C.heat.minima.flat().filter((v) => v === 0).length;
  ok((await count(page, '#heat svg rect.cell.hc0')) === zeros, `${zeros} zero cells drawn as surface`);
  ok((await count(page, '#heat svg rect.cell.hc5')) === C.heat.minima.flat().filter((v) => v >= 500).length, 'top class holds the cells of 500 or more');
  ok((await count(page, '#heatLegend .sw')) === 7, 'legend: zero, five classes, edge');
  const heatLabel = await page.getAttribute('#heat', 'aria-label');
  ok(heatLabel.includes(f(Math.max(...C.heat.minima.flat()))), 'heatmap aria-label names the largest cell');
  const yearLabels = await page.locator('#heat svg text').allTextContents();
  for (const y of L.years) ok(yearLabels.includes(String(y.year)), `year ${y.year} labelled`);
  ok(yearLabels.includes(f(L.tofMinDays)) && yearLabels.includes(f(L.lastTofDays)), 'floor and ceiling rows labelled');
  ok(yearLabels.includes(f(C.years[0].minima)) && yearLabels.includes(f(C.years[C.years.length - 1].minima)), 'first and last year totals direct-labelled on the marginal');
  // keyboard on the heatmap
  await page.focus('#heat');
  await page.waitForTimeout(80);
  let tip = await tipText(page, 'heatTip');
  ok(tip && tip.includes('cheapest windows'), 'focusing the heatmap shows a tooltip at the largest cell');
  const maxCell = Math.max(...C.heat.minima.flat());
  ok(tip && tip.includes(f(maxCell)), `tooltip names the largest cell ${f(maxCell)}`);
  await page.keyboard.press('Home');
  await page.waitForTimeout(60);
  tip = await tipText(page, 'heatTip');
  ok(tip && tip.includes(`${f(L.tofMinDays)}-day`), 'Home moves the cursor to the floor row');
  await page.keyboard.press('End');
  await page.waitForTimeout(60);
  tip = await tipText(page, 'heatTip');
  ok(tip && tip.includes(`${f(L.lastTofDays)}-day`), 'End moves the cursor to the ceiling row');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  ok((await tipText(page, 'heatTip')) === null, 'Escape hides the heatmap tooltip');
  // all-windows mode
  await page.check('input[name="heatMode"][value="allWindows"]');
  await page.waitForTimeout(120);
  const allMax = Math.max(...C.heat.allWindows.flat());
  ok((await page.getAttribute('#heat', 'aria-label')).includes(f(allMax)), 'all-windows mode relabels with its largest cell');
  const heatTable = await page.locator('#heatTable tbody tr').count();
  ok(heatTable === L.nRows + 1, 'heat table has one row per flight time plus totals');
  const lastTotal = await page.locator('#heatTable tbody tr').last().locator('td').last().textContent();
  ok(lastTotal === f(C.verification.windowsChecked), `all-windows table totals ${f(C.verification.windowsChecked)}`);
  await page.check('input[name="heatMode"][value="minima"]');
  await page.waitForTimeout(120);
  const lastTotal2 = await page.locator('#heatTable tbody tr').last().locator('td').last().textContent();
  ok(lastTotal2 === f(C.bodies.withWindows), `minima table totals ${f(C.bodies.withWindows)}`);
  // per-column chart
  ok((await count(page, '#cols svg path.s1-line')) === 1, 'one series line');
  ok((await count(page, '#cols svg circle.edge-dot')) === 2, 'two edge markers');
  const colsLabels = await page.locator('#cols svg text').allTextContents();
  ok(colsLabels.some((t) => t.includes(f(E.first.touched)) && t.includes(L.firstDepartureUtc)), 'first edge direct-labelled with its count and date');
  ok(colsLabels.some((t) => t.includes(f(E.last.touched)) && t.includes(L.lastDepartureUtc)), 'last edge direct-labelled');
  ok((await count(page, '#cols svg line.ref')) === 1 && (await text(page, '#colsLegend')).includes(`interior median, ${f(C.interior.medianPerCol)} per date`), 'interior median reference drawn and named in the legend');
  ok(!colsLabels.some((t) => t.includes('interior median')), 'no reference label drawn over the data line');
  await page.focus('#cols');
  await page.waitForTimeout(80);
  tip = await tipText(page, 'colsTip');
  ok(tip && tip.includes(L.firstDepartureUtc) && tip.includes(f(E.first.touched)), 'focusing the column chart shows the first date');
  await page.keyboard.press('End');
  await page.waitForTimeout(60);
  tip = await tipText(page, 'colsTip');
  ok(tip && tip.includes(L.lastDepartureUtc) && tip.includes(f(E.last.touched)) && tip.includes('last departure date'), 'End shows the last date and names it as the edge');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(60);
  tip = await tipText(page, 'colsTip');
  ok(tip && tip.includes(G.colDate(L, L.nCols - 2)) && tip.includes(f(C.perColumn.minima[L.nCols - 2])), 'ArrowLeft steps one departure date');
  const colsRows = await page.locator('#colsTable tbody tr').count();
  ok(colsRows === 21, 'column table: ten, an ellipsis, ten');
  // edge table: counts, per edge cell and the next three lines in
  const edgeRows = page.locator('#edgeTable tbody tr');
  ok((await edgeRows.count()) === 5, 'edge table: four edges and a total');
  for (let i = 0; i < 4; i++) {
    const k = G.EDGE_KEYS[i];
    const cells = await edgeRows.nth(i).locator('td').allTextContents();
    ok(cells[0] === G.EDGE_NAMES[k] && cells[2] === f(E[k].touched) && cells[4] === f(E[k].cellsOnEdge) && cells[5] === E[k].minimaPerEdgeCell.toFixed(2) && cells[6] === E[k].inwardLines.slice(1).map(f).join(' · '), `edge row ${k} reads ${f(E[k].touched)}, ${E[k].minimaPerEdgeCell.toFixed(2)} per cell, ${E[k].inwardLines.slice(1).join('/')}`);
  }
  const totalCells = await edgeRows.nth(4).locator('td').allTextContents();
  ok(totalCells[2] === f(C.edges.any) && totalCells[1].includes(String(C.edges.multiple)), 'edge total row');
  const eh = await text(page, '#edgesHint');
  ok(eh.includes('but not on the floor') && eh.includes(`${f(E.tofMin.inwardLines[1])} at ${f(L.tofMinDays + L.tofSpacingDays)}`) && /Speculative/.test(eh), 'edges note: the floor shows no pile-up; truncation labelled Speculative');
  ok(!/binds/.test(eh.replace('not because it is shown to bind', '')), 'edges note does not claim the floor binds');
  // the inward rise
  const rn = await text(page, '#riseNotes');
  ok(rn.includes(E.tofMin.riseBound.median.toFixed(3)) && rn.includes(`n ${f(E.tofMin.riseBound.n)}`) && rn.includes(E.first.riseRecorded.median.toFixed(3)), 'rise notes carry recorded and bounded medians');
  ok(rn.includes(`beyond the edge for ${C.edges.vertex.beyond}`) && rn.includes(`for ${C.edges.vertex.inside}`) && rn.includes(`for ${C.edges.vertex.none}`), 'rise notes carry the vertex split');
  ok(rn.includes('within half a lattice step of the edge or beyond it'), 'the half-step statement');
  const riseRows = page.locator('#riseTable tbody tr');
  ok((await riseRows.count()) === 4, 'rise table: four edges');
  const rr = await riseRows.nth(2).locator('td').allTextContents();
  ok(rr[0] === G.EDGE_NAMES.tofMin && rr[1] === f(E.tofMin.riseRecorded.n) && rr[4] === f(E.tofMin.riseBound.n) && rr[5] === E.tofMin.riseBound.median.toFixed(3), 'rise table floor row: recorded n, bound n and median bound');
  const body = await page.locator('body').innerText();
  ok(!/likely clipped|undetermined/i.test(body), 'no "likely clipped" or "undetermined" verdicts anywhere');
  // another stored window off the edge, under each rule
  const alt = await text(page, '#altHint');
  const AR = C.interiorAlternative.byRule;
  ok(alt.includes(f(AR[0].withAlternative)) && alt.includes(f(AR.find((r) => r.rule.arrival).withAlternative)) && alt.includes(f(E.tofMin.arrivalLine.withWindow)), 'alternative note: box, arrival-aware and the floor\'s arrival line');
  ok(!/fallback/.test(alt), 'no "fallback"');
  ok((await count(page, '#altTable tbody tr')) === AR.length, 'one alternative row per basin rule');
  // tail
  const tailVals = await page.locator('#tailTiles .tile .value').allTextContents();
  ok(tailVals.includes(f(C.viewTail.minimaAfter)) && tailVals.includes(f(C.viewTail.anyWindowAfter)) && tailVals.includes(C.viewTail.depEndUtc) && tailVals.includes(L.lastDepartureUtc), 'tail tiles: counts and both end dates');
  ok((await text(page, '#tailHint')).includes(`line ${C.inputs.viewGrid.spanLabelDerivedAtLine}`), 'tail note cites the derived span label line');
  // who
  const firstRow = await page.locator('#whoTable tbody tr').first().locator('td').allTextContents();
  ok(firstRow[0] === C.tables.byClass[0].key && firstRow[1] === f(C.tables.byClass[0].n) && firstRow[2] === f(C.tables.byClass[0].any), `class table first row ${C.tables.byClass[0].key}`);
  ok((await count(page, '#whoTable tbody tr')) === C.tables.byClass.length, 'one row per class');
  await page.selectOption('#tablePick', 'byH');
  await page.waitForTimeout(60);
  ok((await count(page, '#whoTable tbody tr')) === G.H_BANDS.length, 'H table rows');
  const hRow = await page.locator('#whoTable tbody tr').last().locator('td').allTextContents();
  ok(hRow[0] === 'H missing' && hRow[1] === f(C.tables.byH.find((r) => r.key === 'H missing').n), 'H-missing row kept');
  await page.selectOption('#tablePick', 'bySynodic');
  await page.waitForTimeout(60);
  ok((await count(page, '#whoTable tbody tr')) === G.SYNODIC_BANDS.length, 'synodic table rows');
  ok((await text(page, '#whoHint')).includes(`line ${C.inputs.auKm.line}`), 'synodic note cites the AU line');
  await page.selectOption('#tablePick', 'byCoOrbital');
  await page.waitForTimeout(60);
  const coRow = await page.locator('#whoTable tbody tr').first().locator('td').allTextContents();
  ok(coRow[1] === f(C.bodies.coOrbital), 'co-orbital row count');
  // basins
  ok((await count(page, '#basins svg path.s1-fill')) === 5, 'five basin bars');
  const basinLabels = await page.locator('#basins svg text').allTextContents();
  for (const k of ['1', '2', '3', '4', '5']) ok(basinLabels.includes(f(C.basins[0].histogram[k])), `basin bar ${k} labelled ${f(C.basins[0].histogram[k])}`);
  ok((await count(page, '#basinsTable tbody tr')) === C.basins.length, 'one basin-rule row per rule');
  const arrIdx = C.basins.findIndex((b) => b.rule.arrival);
  await page.selectOption('#basinRule', String(arrIdx));
  await page.waitForTimeout(80);
  const arrLabels = await page.locator('#basins svg text').allTextContents();
  ok(['1', '2', '3', '4', '5'].every((k) => arrLabels.includes(f(C.basins[arrIdx].histogram[k]))), 'the rule picker redraws the bars for the arrival-aware rule');
  ok((await text(page, '#basinsHint')).includes(f(C.basins[arrIdx].histogram[1])), 'basins note names the arrival-aware one-basin count');
  // inspector
  const eros = C.sample.find((s) => s.bodyId === 'asteroid-433');
  let head = await text(page, '#inspectHead');
  ok(head.includes(`column ${eros.evidence.cell.col}`) && head.includes(`row ${eros.evidence.cell.row}`) && head.includes(`${eros.basins} basins`), 'inspector opens on Eros with column, row and basins');
  ok(head.includes('interior minimum'), 'Eros is an interior minimum');
  ok(await labelsApart(page), 'Eros: basin labels do not overlap');
  ok((await count(page, '#mini svg g.win')) === 5, 'five windows drawn');
  ok((await count(page, '#inspectTable tbody tr')) === 5, 'five window rows');
  await page.selectOption('#bodyPick', 'asteroid-2015 D1');
  await page.waitForTimeout(80);
  ok(!(await page.locator('#inspectRefusal').isHidden()), 'the body without windows shows a refusal');
  ok((await text(page, '#inspectRefusal')).includes('insufficient_data'), 'refusal code shown');
  ok(await page.locator('#mini').isHidden(), 'no chart for the refused body');
  await page.selectOption('#bodyPick', 'asteroid-190166');
  await page.waitForTimeout(80);
  head = await text(page, '#inspectHead');
  ok(head.includes('rise recorded') && head.includes('chain of 3') && head.includes('beyond the edge'), 'chain-of-three body shows its recorded rise and vertex');
  ok((await count(page, '#mini svg g.zwin')) === 3, 'zoom panel shows the three windows in the first columns');
  ok((await count(page, '#mini svg rect.zcell.zedge')) === 5, 'zoom panel marks the first column\'s five cells as the edge');
  ok((await page.locator('#mini svg text').allTextContents()).some((t) => /2 of 5 windows lie outside the zoom/.test(t)), 'zoom panel says how many windows it does not show');
  ok(await page.locator('#inspectRefusal').isHidden(), 'refusal hidden again');
  await page.selectOption('#bodyPick', 'asteroid-66063');
  await page.waitForTimeout(80);
  ok((await text(page, '#inspectHead')).includes('rise bounded below') && (await text(page, '#inspectHead')).includes('rise ≥'), 'unstored-neighbour body shows its bound');
  await page.selectOption('#bodyPick', 'asteroid-2006 KD40');
  await page.waitForTimeout(80);
  ok((await count(page, '#inspectTable tbody tr.edge-row')) >= 1 && (await page.locator('#inspectHead .edge-ev').count()) === 2, 'two-edge body shows two edge lines');
  // mini tooltip by mouse on the minimum (scrolled into view first: mouse coordinates are viewport-relative)
  await page.locator('#mini svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#mini svg circle.edge-dot').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  tip = await tipText(page, 'miniTip');
  ok(tip && tip.includes('C3') && tip.includes('basin 0'), 'hovering the minimum shows its C3 and basin');
  // cannot-say and provenance
  ok((await count(page, '#cannot .r')) === 5, 'five structured refusals');
  const cannotText = await text(page, '#cannot');
  ok(cannotText.includes('insufficient_data') && cannotText.includes('out_of_envelope') && cannotText.includes(f(M_totalSolves())), 'refusals carry codes and the cache\'s totalSolves');
  const probe = G.floorProbe(L, E.tofMin.touched, 2);
  ok(cannotText.includes(`about ${f(probe.total)} in all`) && cannotText.includes('bound the sub-floor cost'), `floor refusal proposes the ${f(probe.total)}-solve probe and says it bounds`);
  const fwd = Math.round(365 / L.departureSpacingDays) * L.nRows * E.last.touched;
  ok(cannotText.includes(`about ${f(fwd)} solves`) && !cannotText.includes('each side'), `extension refusal is forward-only (${f(fwd)} solves)`);
  ok(cannotText.includes('hyperbolic') && cannotText.includes(C.bodies.withoutWindows[0].elements.e.toFixed(4)), 'the body without windows: its hyperbolic elements named');
  const prov = await text(page, '#prov');
  ok(prov.includes(D.censusProvenance.commit.slice(0, 12)) && prov.includes(D.censusProvenance.sourceSha256), 'provenance shows the commit and sha256');
  ok(prov.includes('equals the cache\'s catalogFixtureSha256'), 'catalog hash reconciled on the page');
  ok(errors.length === 0, `desktop: no console errors or network requests (${errors.join('; ')})`);
  ok(!(await overflow(page)), 'desktop: no horizontal overflow');
  await context.close();
}
function M_totalSolves() {
  return D.metadata.totalSolves;
}

// 2. Phone, touch, light and dark
for (const scheme of ['light', 'dark']) {
  const { context, page, errors } = await open({ ...PHONE, colorScheme: scheme });
  ok(!(await overflow(page)), `phone ${scheme}: no horizontal overflow on load`);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = bg.match(/\d+/g).slice(0, 3).map(Number).reduce((s, x) => s + x, 0) / 3;
  ok(scheme === 'dark' ? lum < 60 : lum > 200, `phone ${scheme}: body background follows the scheme (${bg})`);
  // every card inside the viewport
  const wide = await page.evaluate(() => [...document.querySelectorAll('.card, .tile, .chart svg')].filter((n) => n.getBoundingClientRect().right > window.innerWidth + 1).length);
  ok(wide === 0, `phone ${scheme}: no card, tile or chart past the viewport (${wide})`);
  // open every details (table views) and check again
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), `phone ${scheme}: no horizontal overflow with the table views open`);
  // tap a heat cell
  const cell = page.locator('#heat svg rect.cell').nth(Math.floor((L.nRows - 4) * L.years.length + 7));
  await cell.scrollIntoViewIfNeeded();
  const cb = await cell.boundingBox();
  await page.touchscreen.tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForTimeout(100);
  let tip = await tipText(page, 'heatTip');
  ok(tip && tip.includes('cheapest windows'), `phone ${scheme}: tapping a heat cell shows its tooltip`);
  // tap the column chart
  await page.locator('#cols svg').scrollIntoViewIfNeeded();
  const colsBox = await page.locator('#cols svg').boundingBox();
  await page.touchscreen.tap(colsBox.x + colsBox.width * 0.5, colsBox.y + colsBox.height * 0.5);
  await page.waitForTimeout(100);
  tip = await tipText(page, 'colsTip');
  ok(tip && /departure date \d+ of/.test(tip), `phone ${scheme}: tapping the column chart shows a date`);
  // tap a window dot in the inspector
  await page.locator('#mini svg').scrollIntoViewIfNeeded();
  const dot = await page.locator('#mini svg circle.edge-dot').first().boundingBox();
  await page.touchscreen.tap(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.waitForTimeout(100);
  tip = await tipText(page, 'miniTip');
  ok(tip && tip.includes('C3'), `phone ${scheme}: tapping the minimum shows its tooltip`);
  // every caption and label in the inspector chart fits inside its SVG (none cut off mid-word)
  const cut = await page.evaluate(() => {
    const svg = document.querySelector('#mini svg');
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.right > box.right + 0.5 || r.left < box.left - 0.5; }).map((t) => t.textContent);
  });
  ok(cut.length === 0, `phone ${scheme}: no inspector text runs past the chart (${cut.join(' | ')})`);
  ok(await labelsApart(page), `phone ${scheme}: Eros basin labels do not overlap`);
  // the heatmap's cell colours follow the scheme
  const fill = await page.evaluate(() => getComputedStyle(document.querySelector('#heat svg rect.cell.hc5')).fill);
  ok(scheme === 'dark' ? /rgb\(183, 211, 246\)/.test(fill) : /rgb\(16, 66, 129\)/.test(fill), `phone ${scheme}: top heat class is the ${scheme} ramp's end (${fill})`);
  ok(errors.length === 0, `phone ${scheme}: no console errors (${errors.join('; ')})`);
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
