#!/usr/bin/env node
// Drives index.html in headless Chromium and checks what the page shows against the kernel run
// in Node on the same data. Run from the bank root: node ideas/21-homeward-porkchop/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" without it.
// Screenshots (light and dark, 1280 and 390 px) go to $UI_SHOTS or the OS temp directory.
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const H = req(path.join(here, 'homeward.js'));
const D = req(path.join(here, 'data.js'));
const E = req(path.join(here, 'snapshots', 'earth-weekly.js'));
const LEGS = req(path.join(here, 'snapshots', 'nhats-legs.js'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
let pw;
try {
  pw = req('playwright');
} catch {
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check: skipped (Playwright not installed)');
    process.exit(0);
  }
}
const C = D.constants;
const earth = H.makeEphemeris(E.records, C.secondsPerDay);
const lattice = H.defaultLattice(earth, D.lattice);
const f3 = (x) => x.toFixed(3);
const body = (des) => D.bodies.find((b) => b.designation === des);
const grids = {};
const gridOf = (des) => (grids[des] ||= H.computeGrid(body(des), earth, lattice, C));

let checks = 0;
let failures = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`FAIL ${msg}`);
  }
}
const browser = await pw.chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };

async function open(opts, init) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('file:')) requests.push(r.url()); });
  if (init) await page.addInitScript(init);
  await page.goto(URL0);
  await page.waitForSelector('#readout dd');
  return { context, page, errors, requests };
}
const text = (page, sel) => page.locator(sel).innerText();
async function readout(page) {
  return page.evaluate(() => {
    const out = {};
    const dts = [...document.querySelectorAll('#readout dt')];
    for (const dt of dts) {
      const label = dt.firstChild.textContent.trim();
      out[label] = dt.nextElementSibling.textContent.trim();
    }
    return out;
  });
}
async function cellPoint(page, i, j) {
  await page.locator('#pc').scrollIntoViewIfNeeded();
  return page.evaluate(([i, j, nD, nT]) => {
    const cv = document.getElementById('pc');
    const r = cv.getBoundingClientRect();
    const PAD = { l: 46, r: 10, t: 10, b: 40 };
    const pw = cv.clientWidth - PAD.l - PAD.r;
    const ph = cv.clientHeight - PAD.t - PAD.b;
    return { x: r.left + PAD.l + (i + 0.5) * (pw / nD), y: r.top + PAD.t + (nT - 1 - j + 0.5) * (ph / nT) };
  }, [i, j, D.lattice.nDep, D.lattice.nTof]);
}
// Every NHATS leg, solved in Node by the kernel, in the page's plotting order.
const audits = H.nhatsRows(LEGS).map((r) => H.auditNhatsLeg(body(r.des), earth, r, C));
const auditSum = H.auditSummary(audits);
const plotted = audits.filter((a) => a.status === H.STATUS.OK && a.daysFromEncounter !== null)
  .sort((a, b) => a.daysFromEncounter - b.daysFromEncounter || a.des.localeCompare(b.des) || a.tid - b.tid);
async function auditPoint(page, tid) {
  await page.locator('#au').scrollIntoViewIfNeeded();
  // The page's geometry (app.js auGeom), recomputed here from the kernel's numbers.
  const yrs = plotted.map((a) => a.daysFromEncounter / 365.25);
  const x0 = Math.floor(Math.min(...yrs) - 0.5);
  const x1 = Math.ceil(Math.max(...yrs) + 0.5);
  const a = plotted.find((p) => p.tid === tid);
  const ms = Math.min(1e6, Math.max(0.1, Math.abs(a.residual.vInfDep) * 1000));
  return page.evaluate(([yr, lg, x0, x1]) => {
    const cv = document.getElementById('au');
    const r = cv.getBoundingClientRect();
    const PAD = { l: 52, r: 12, t: 12, b: 40 };
    const pw = cv.clientWidth - PAD.l - PAD.r;
    const ph = cv.clientHeight - PAD.t - PAD.b;
    return { x: r.left + PAD.l + ((yr - x0) / (x1 - x0)) * pw, y: r.top + PAD.t + ph - ((lg + 1) / 7) * ph };
  }, [a.daysFromEncounter / 365.25, Math.log10(ms), x0, x1]);
}
function nearestCell(des, depJd, tofDays) {
  const g = gridOf(des);
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < g.deps.length; i += 1) if (Math.abs(g.deps[i] - depJd) < Math.abs(g.deps[bi] - depJd)) bi = i;
  for (let j = 0; j < g.tofs.length; j += 1) if (Math.abs(g.tofs[j] - tofDays) < Math.abs(g.tofs[bj] - tofDays)) bj = j;
  return [bi, bj];
}
function expectCell(rd, des, i, j, label) {
  const g = gridOf(des);
  const cell = H.cellAt(g, body(des), earth, i, j, C);
  ok(rd['Leave the body'] === H.jdToIso(g.deps[i]), `${label}: leave date ${rd['Leave the body']} vs ${H.jdToIso(g.deps[i])}`);
  ok(rd['Flight time'] === `${g.tofs[j].toFixed(0)} d`, `${label}: flight time`);
  if (cell.status === H.STATUS.OK) {
    ok(rd['Departure v∞ at the body'] === `${f3(cell.vInfDep)} km/s`, `${label}: departure v∞ ${rd['Departure v∞ at the body']} vs ${f3(cell.vInfDep)}`);
    ok(rd['Earth-arrival v∞'] === `${f3(cell.vInfArr)} km/s`, `${label}: arrival v∞`);
    ok(rd[`Entry speed at ${C.entryAltitudeKm} km`] === `${f3(cell.entrySpeed)} km/s`, `${label}: entry speed`);
    ok(rd['Arrival declination'] === `${cell.decArrDeg.toFixed(2)}°`, `${label}: declination`);
  }
  return cell;
}

// 1. Desktop, light: defaults, minima, readout against the kernel, refusals, no kg anywhere.
{
  const { context, page, errors, requests } = await open(DESK);
  ok((await page.locator('#body').inputValue()) === '1999 AO10', 'default body is 1999 AO10');
  const g = gridOf('1999 AO10');
  ok((await text(page, '#lattice')) === `${g.label} · zero-revolution transfers only`, 'lattice label is the kernel’s derived label');
  ok(g.label === '200×70 grid · 27.4 d × 10 d steps', 'label value');
  const minima = await text(page, '#minima');
  const mA = g.minima.vInfArr;
  ok(minima.includes(`${f3(g.vInfArr[mA.k])} km/s, leaving ${H.jdToIso(g.deps[mA.i])} with ${g.tofs[mA.j].toFixed(0)} d to Earth (${g.label})`), 'minimum arrival v∞ with its lattice');
  ok(minima.includes('0.255 km/s'), '1999 AO10 lowest supported arrival v∞ is 0.255 km/s');
  ok(minima.includes('Lower past the L1 boundary: 0.843 km/s'), 'lower departure v∞ past the boundary is disclosed, not hidden');
  ok(minima.includes('13,083 of 14,000 legs computed; 917 refused'), 'counts');
  ok(minima.includes('edge of what was searched (first departure date)'), 'edge minimum disclosed');
  let rd = await readout(page);
  expectCell(rd, '1999 AO10', mA.i, mA.j, 'default selection = minimum');
  const ref = await text(page, '#refusal');
  ok(ref.includes('Delivered mass: refused') && ref.includes('out_of_envelope'), 'delivered-mass refusal card');
  ok(ref.includes('What would help: A return-vehicle mass model'), 'refusal says what would help');
  const all = await page.evaluate(() => document.body.innerText);
  ok(!/\d[\d,.]*\s*kg\b/.test(all), 'no kilogram figure anywhere on the page');
  ok((await text(page, '#tier')).includes('supported through 2029-02-14'), 'tier sentence names the boundary');
  // NHATS table.
  const rows = await page.locator('#nhTable tbody tr').allInnerTexts();
  ok(rows.length === 5, `five NHATS rows (${rows.length})`);
  ok(rows.some((r) => r.includes('(1999 AO10)') && r.includes('2.106 / 2.106') && r.includes('11.880 / 11.879') && r.includes('supported')), 'AO10 reproduces NHATS');
  ok(rows.some((r) => r.includes('(2001 GP2)') && r.includes('refused') && r.includes('Show body')), 'GP2 refused, its button only shows the body');
  ok(rows.some((r) => r.includes('Apophis') && r.includes('past the L1 boundary (2028-09-12)')), 'Apophis past the boundary');
  // Every NHATS leg against the tier rule: the note and table carry the kernel's counts.
  const note = await text(page, '#auNote');
  ok(note.includes(`lists ${auditSum.legs} distinct round trips`) && auditSum.legs === 82, 'audit note: 82 legs');
  ok(note.includes(`supports ${auditSum.supported}; every one is within 30.5 m/s`) && auditSum.supported === 23, 'audit note: 23 supported, within 30.5 m/s');
  ok(note.includes(`Of the 57 past the boundary, 52 miss by more, up to 185.7 km/s; 5 do not`), 'audit note: 52 of 57 past miss, 5 do not');
  ok(note.includes('it would support 15 and refuse 8 that reproduce'), 'audit note: arrival rule supports 15, refuses 8 good legs');
  const auRows = await page.locator('#auTable tbody tr').allInnerTexts();
  ok(auRows.length === 5, `five bodies in the audit table (${auRows.length})`);
  ok(auRows.some((r) => r.includes('(1999 AO10)') && r.includes('24') && r.includes('9, 30.5 m/s') && r.includes('15, 12')), 'AO10 row: 9 supported to 30.5 m/s, 12 of 15 past miss');
  ok(auRows.some((r) => r.includes('Bennu') && r.includes('14, 27.9 m/s')), 'Bennu row: 14 supported to 27.9 m/s');
  ok(auRows.some((r) => r.includes('(2000 SG344)') && r.includes('19, 19')), 'SG344 row: all 19 past miss');
  const foot = await text(page, '#auTable tfoot');
  ok(/All five\s+82\s+23, 30\.5 m\/s\s+57, 52\s+2/.test(foot), `audit total row (${foot.replace(/\s+/g, ' ')})`);
  // Keyboard on the audit chart: the first leg is Bennu's earliest departure; Enter shows it on the porkchop.
  await page.focus('#au');
  await page.keyboard.press('ArrowRight');
  const first = plotted[0];
  const sel1 = await text(page, '#auSel');
  ok(sel1.includes(`NHATS trajectory ${first.tid}`) && sel1.includes(`Departure v∞ ${f3(first.page.vInfDep)} here, ${first.nhats.vInfDep.toFixed(3)} NHATS`), `arrow key selects the first leg (${sel1.slice(0, 80)})`);
  ok((await page.locator('#body').inputValue()) === '1999 AO10', 'arrow keys alone do not switch the body');
  await page.keyboard.press('Enter');
  ok((await page.locator('#body').inputValue()) === first.des, 'Enter switches to the leg’s body');
  let [ci, cj] = nearestCell(first.des, first.depJd, first.tofDays);
  expectCell(await readout(page), first.des, ci, cj, 'Enter shows the leg on the porkchop');
  // Click a point: Apophis's leg that leaves in March 2029 and reproduces (past the boundary, within the line).
  await page.selectOption('#body', '1999 AO10');
  const ap = plotted.find((a) => a.tid === 112246);
  const apPt = await auditPoint(page, 112246);
  await page.mouse.click(apPt.x, apPt.y);
  const sel2 = await text(page, '#auSel');
  ok(sel2.includes('NHATS trajectory 112246') && sel2.includes('Past the boundary') && sel2.includes(`${(Math.abs(ap.residual.vInfDep) * 1000).toFixed(1)} m/s apart`), `click picks the Apophis March 2029 leg (${sel2.slice(0, 90)})`);
  ok((await page.locator('#body').inputValue()) === '99942', 'click switches the body');
  [ci, cj] = nearestCell('99942', ap.depJd, ap.tofDays);
  expectCell(await readout(page), '99942', ci, cj, 'clicked audit leg on the porkchop');
  await page.selectOption('#body', '1999 AO10');
  // Metric toggle.
  await page.click('#mDep');
  ok((await page.getAttribute('#mDep', 'aria-checked')) === 'true', 'departure metric checked');
  ok((await text(page, '#plotTitle')).includes('departure v∞ at the body'), 'title follows the metric');
  ok((await text(page, '#rampCap')).startsWith('Departure v∞ at the body, km/s'), 'legend follows the metric');
  // Click a cell.
  const pt = await cellPoint(page, 45, 20);
  await page.mouse.click(pt.x, pt.y);
  rd = await readout(page);
  expectCell(rd, '1999 AO10', 45, 20, 'clicked cell');
  ok(g.deps[45] > H.supportBoundary(body('1999 AO10').tier).encounterJd && g.deps[41] < H.supportBoundary(body('1999 AO10').tier).encounterJd, 'boundary falls between columns 41 and 45');
  ok((await text(page, '#support')).startsWith('Past the L1 boundary'), 'cell 45 (2029-05) is past the 2029-02-14 boundary');
  // Hover tooltip.
  const pt2 = await cellPoint(page, 10, 30);
  await page.mouse.move(pt2.x, pt2.y);
  const tip = await text(page, '#tip');
  const k = 10 * D.lattice.nTof + 30;
  ok(tip.includes(`${f3(g.vInfArr[k])} km/s`) && tip.includes(`${f3(g.vInfDep[k])} km/s`), 'tooltip values');
  // Keyboard.
  await page.focus('#pc');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  rd = await readout(page);
  expectCell(rd, '1999 AO10', 46, 21, 'arrow keys');
  await page.keyboard.press('Home');
  rd = await readout(page);
  const mD = g.minima.vInfDep;
  expectCell(rd, '1999 AO10', mD.i, mD.j, 'Home jumps to the minimum of the shown metric');
  // A refused cell (Earth arrival after the ephemeris): last column, longest flight.
  const p3 = await cellPoint(page, D.lattice.nDep - 1, D.lattice.nTof - 1);
  await page.mouse.click(p3.x, p3.y);
  const ref3 = await text(page, '#refusal');
  ok(ref3.includes('This leg: refused') && ref3.includes('insufficient_data') && ref3.includes('2040-12-31'), 'refused cell shows insufficient_data');
  ok((await page.locator('#readout dt').count()) === 3, 'a refused cell shows no velocities');
  // Apophis: drift readout and NHATS jump.
  await page.selectOption('#body', '99942');
  await page.click('#jNhats');
  rd = await readout(page);
  ok(rd['Body state vs JPL integrated truth'] !== undefined, 'Apophis shows its measured two-body drift');
  ok(/^[\d,]+ km, [\d.]+ m\/s$/.test(rd['Body state vs JPL integrated truth'] || ''), 'drift format');
  ok((await text(page, '#support')).startsWith('Past the L1 boundary'), 'Apophis NHATS leg is past the boundary');
  // Show button on the Bennu row.
  await page.locator('#nhTable button[data-body="101955"]').click();
  ok((await page.locator('#body').inputValue()) === '101955', 'Show switches the body');
  rd = await readout(page);
  ok(rd['Leave the body'].startsWith('2036-'), `Bennu NHATS cell leaves in 2036 (${rd['Leave the body']})`);
  ok((await text(page, '#support')).startsWith('Supported'), 'Bennu NHATS leg supported');
  // GP2: NHATS jump disabled (its leg is refused); Eros: no boundary.
  await page.selectOption('#body', '2001 GP2');
  ok(await page.locator('#jNhats').isDisabled(), 'GP2 NHATS button disabled');
  await page.selectOption('#body', '433');
  ok((await text(page, '#tier')).includes('Fidelity tier L2'), 'Eros L2 sentence');
  ok((await text(page, '#keyWash')) === 'No L1 boundary for this body', 'Eros has no wash');
  ok(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  ok(requests.length === 0, `no network requests (${requests.join(' ')})`);
  await page.screenshot({ path: path.join(SHOTS, 'homeward-desktop-light.png'), fullPage: true });
  await context.close();
}

// 2. Phone, dark, by touch: no sideways scroll, taps select, colours follow the scheme.
{
  const { context, page, errors } = await open({ ...PHONE, colorScheme: 'dark' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(16, 18, 22)', `dark background (${bg})`);
  const pt = await cellPoint(page, 5, 15);
  await page.touchscreen.tap(pt.x, pt.y);
  const rd = await readout(page);
  expectCell(rd, '1999 AO10', 5, 15, 'tap');
  ok(await page.locator('#tip').isHidden(), 'no hover tooltip on touch');
  for (const des of ['101955', '99942', '433']) {
    await page.selectOption('#body', des);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, `no horizontal overflow at 390 px with ${des} (${over})`);
  }
  const tableBox = await page.evaluate(() => {
    const t = document.getElementById('nhTable');
    return t.parentElement.scrollWidth - t.parentElement.clientWidth;
  });
  ok(tableBox <= 1, `NHATS table fits at 390 px (${tableBox})`);
  const auBox = await page.evaluate(() => {
    const t = document.getElementById('auTable');
    return t.parentElement.scrollWidth - t.parentElement.clientWidth;
  });
  ok(auBox <= 1, `audit table fits at 390 px (${auBox})`);
  // A tap on an audit point (Bennu's 2030-10-16 leg, alone at the left) selects it and switches the body.
  const bPt = await auditPoint(page, 5494);
  await page.touchscreen.tap(bPt.x, bPt.y);
  ok((await text(page, '#auSel')).includes('NHATS trajectory 5494') && (await page.locator('#body').inputValue()) === '101955', 'tap on an audit point');
  ok(await page.locator('#auTip').isHidden(), 'no audit tooltip on touch');
  ok(errors.length === 0, `no console errors on phone (${errors.join(' | ')})`);
  await page.selectOption('#body', '1999 AO10');
  await page.screenshot({ path: path.join(SHOTS, 'homeward-phone-dark.png'), fullPage: true });
  await context.close();
}

// 3. Desktop dark and phone light screenshots; storage blocked still works.
{
  const { context, page, errors } = await open({ ...DESK, colorScheme: 'dark' }, () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  ok((await page.locator('#readout dd').count()) > 5, 'works with storage blocked');
  ok(errors.length === 0, `no console errors with storage blocked (${errors.join(' | ')})`);
  await page.screenshot({ path: path.join(SHOTS, 'homeward-desktop-dark.png'), fullPage: true });
  await context.close();
  const ph = await open(PHONE);
  await ph.page.screenshot({ path: path.join(SHOTS, 'homeward-phone-light.png'), fullPage: true });
  ok(ph.errors.length === 0, 'phone light no errors');
  await ph.context.close();
}

// 4. The remembered body and metric survive a reload.
{
  const context = await browser.newContext(DESK);
  const page = await context.newPage();
  await page.goto(URL0);
  await page.waitForSelector('#readout dd');
  await page.selectOption('#body', '2000 SG344');
  await page.click('#mDep');
  await page.reload();
  await page.waitForSelector('#readout dd');
  ok((await page.locator('#body').inputValue()) === '2000 SG344', 'body remembered');
  ok((await page.getAttribute('#mDep', 'aria-checked')) === 'true', 'metric remembered');
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed; screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
