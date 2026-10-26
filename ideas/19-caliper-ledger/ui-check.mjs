#!/usr/bin/env node
// Drives the page in headless Chromium the way a person at the bench would: at phone width by touch in the
// dark scheme, and at desktop width with the mouse and keyboard. Run from the bank root:
//   node ideas/19-caliper-ledger/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does; prints "skipped" and exits 0 without it.
// The measurement report it imports is INVENTED (built here with PartForge's own measurementRows(), from the
// shape flightCheck() writes); no real report exists in the PartForge checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require(path.join(here, 'ledger.js'));
const PF = C.PartForge;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch {
  try { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); } catch { console.log('ui-check: skipped (Playwright is not installed)'); process.exit(0); }
}
const browser = await pw.chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caliper-ledger-ui-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* already gone */ } });
let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }

const PHONE_DARK = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark', acceptDownloads: true };
const DESK = { viewport: { width: 1280, height: 900 }, colorScheme: 'light', acceptDownloads: true };

async function open(opts, init) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => { if (!r.url().startsWith('blob:')) errors.push('request failed: ' + r.url()); });
  page.on('dialog', (d) => d.accept());
  if (init) await page.addInitScript(init);
  await page.goto(URL0);
  await page.waitForTimeout(100);
  return { context, page, errors };
}
const card = (page, id) => page.locator(`li.feat[data-id="${id}"]`);
const chip = (page, id) => card(page, id).locator('.chip').textContent();
const word = (page) => page.locator('#sword').textContent();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
async function tapOrClick(page, loc) { if ((page.viewportSize() || {}).width < 500) await loc.tap(); else await loc.click(); }
async function openCard(page, id) { const d = card(page, id).locator('details'); if (!(await d.evaluate((x) => x.open))) await tapOrClick(page, card(page, id).locator('summary')); }
async function addInstrument(page, kind, unit, resolution, accuracy = '') {
  await tapOrClick(page, page.locator('#addInst'));
  const li = page.locator('#shelf li.inst').last();
  await li.locator('select').first().selectOption(kind);
  await li.locator('select').nth(1).selectOption(unit);
  await li.locator('input').nth(0).fill(resolution);
  if (accuracy) await li.locator('input').nth(1).fill(accuracy);
}
async function readings(page, id, inst, values) {
  await openCard(page, id);
  const c = card(page, id);
  await c.locator('select').first().selectOption({ label: inst });
  const box = c.locator('.readings input');
  for (let i = 0; i < values.length; i++) {
    if ((await box.count()) <= i) await tapOrClick(page, c.getByRole('button', { name: 'Add a reading' }));
    await box.nth(i).fill(values[i]);
  }
  for (let i = values.length; i < (await box.count()); i++) await box.nth(i).fill('');   // blank boxes are not readings
}
/* the invented report: the shape index.html's flightCheck() writes, through PartForge's measurementRows() */
function inventedReport(name, part) {
  const d = C.loadDeclaration(PF.templates[name].text);
  const f = d.flight;
  const rows = {
    lint: [], critical: f.critical.map((c) => ({ ...c, measured: c.nominal_mm + 0.001, ok: true, note: '' })),
    od: f.od.map((e) => ({ ...e, r: { ok: true, d_mean: e.d_mm - 0.001 }, ok: true })),
    bores: f.bores.map((e) => ({ ...e, r: { ok: true, d_mean: e.d_mm + 0.002, centre_offset_mm: 0.001 }, ok: true })),
    holes: f.holes.map((e) => ({ ...e, r: { ok: true, holes: C.holePositions(e).map(() => ({ present: true, d_mean: e.d_mm + 0.003, centre_offset_mm: 0.001 })) }, ok: true })),
    revolve: [], gauges: f.gauges.map((g) => ({ ...g, ok: true, note: 'clear as required' })), loads: [],
  };
  return JSON.stringify({ ok: true, tool: 'check', value: { verdict: 'pass', fails: [], part: part || d.part, flight: { measurements: PF.measurementRows(rows) } } });
}

// ---------------------------------------------------------------- 1. phone, touch, dark: the bulkhead at the bench
let savedRecord = null;
{
  const { context, page, errors } = await open(PHONE_DARK);
  ok((await page.locator('#tpl').inputValue()) === 'bulkhead', 'opens on the bulkhead template');
  ok((await page.locator('li.feat').count()) === 21, '21 feature rows (one per hole)');
  ok(!(await page.locator('#storageNote').isVisible()), 'no storage warning when storage works');
  ok((await page.locator('#declFacts').textContent()).includes('ea41c20b0c1ba26896d381bf52a75bfbba24250f4c0876d6acc9c65f06ac24d8'), 'the FLIGHT hash shown is the sed | sha256sum value');
  ok((await word(page)) === 'INCOMPLETE', 'a fresh ledger is INCOMPLETE');
  ok((await page.locator('#sline').textContent()).includes('21 of 21 features not measured'), 'and says 21 of 21 not measured');
  ok((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(20, 22, 27)', 'dark scheme background');

  // no instrument yet: typing a reading is not a verdict
  await openCard(page, 'critical|bulkhead OD|0');
  await card(page, 'critical|bulkhead OD|0').locator('.readings input').first().fill('146.20');
  ok((await chip(page, 'critical|bulkhead OD|0')) === 'NOT MEASURED', 'a reading without an instrument gets no verdict');
  ok((await card(page, 'critical|bulkhead OD|0').locator('.problems').textContent()).includes('Choose an instrument'), 'and says why');

  await addInstrument(page, 'micrometer', 'mm', '0.001');
  await addInstrument(page, 'caliper', 'mm', '0.02');
  const MIC = 'Micrometer (0.001 mm)', CAL = 'Caliper (0.02 mm)';

  // the oval OD: a perfect mean and OUT
  await readings(page, 'critical|bulkhead OD|0', MIC, ['146.14', '146.26']);
  ok((await chip(page, 'critical|bulkhead OD|0')) === 'OUT', 'oval OD 146.14 / 146.26 is OUT');
  const statsText = await card(page, 'critical|bulkhead OD|0').locator('.stats').textContent();
  ok(statsText.includes('146.2000 mm') && statsText.includes('-0.010 mm'), 'its mean 146.2000 and worst margin -0.010 are shown');
  ok((await word(page)) === 'NONCONFORMING', 'one OUT makes the part NONCONFORMING');
  await readings(page, 'critical|bulkhead OD|0', MIC, ['146.20', '146.21']);
  ok((await chip(page, 'critical|bulkhead OD|0')) === 'IN', 'corrected readings are IN');
  ok((await word(page)) === 'INCOMPLETE', 'and the part is back to INCOMPLETE');

  // the limit is inside
  await readings(page, 'holes|all-thread rods 1/4 in|0|1', MIC, ['6.700']);
  ok((await chip(page, 'holes|all-thread rods 1/4 in|0|1')) === 'IN', '6.700 on a 6.60 ±0.10 hole is IN');

  // GO/NO-GO by touch
  const rod = 'holes|all-thread rods 1/4 in|0|0';
  await openCard(page, rod);
  await card(page, rod).getByRole('button', { name: 'GO / NO-GO gauges' }).tap();
  await card(page, rod).locator('input[id$="go"]').first().fill('6.50');
  await card(page, rod).getByRole('group', { name: 'GO result', exact: true }).getByRole('button', { name: 'went in' }).tap();
  ok((await chip(page, rod)) === 'UNDECIDED', 'a GO pin alone is UNDECIDED');
  await card(page, rod).locator('input[id$="nogo"]').fill('6.70');
  await card(page, rod).getByRole('group', { name: 'NO-GO result' }).getByRole('button', { name: 'stopped' }).tap();
  ok((await chip(page, rod)) === 'IN', 'GO 6.50 in, NO-GO 6.70 stopped is IN');

  // discrimination flag with a 0.02 caliper on ±0.05
  await readings(page, 'critical|plate thickness|0', CAL, ['12.70']);
  ok((await card(page, 'critical|plate thickness|0').locator('.flags li[data-code="discrimination"]').count()) === 1, 'a 0.02 caliper on ±0.05 is flagged by the 10:1 rule of thumb');

  // a declared gauge
  const g = 'gauges|groove ID wall NO-GO|0';
  await openCard(page, g);
  await card(page, g).locator('input').first().fill('NO-GO ring 126.52');
  await card(page, g).getByRole('button', { name: /Blocked/ }).tap();
  ok((await chip(page, g)) === 'IN', 'the NO-GO ring blocked, as declared: IN');

  // the model column: an invented report, pasted
  const before = await page.evaluate(() => Array.from(document.querySelectorAll('.readings input')).map((x) => x.value));
  await page.locator('#reportText').fill(inventedReport('bulkhead'));
  await page.locator('#importReport').tap();
  ok((await page.locator('#reportOut').textContent()).includes('No reading was filled'), 'report imported');
  ok((await card(page, 'critical|overall height|0').locator('.modelled').textContent()).includes('37.701'), 'as modelled 37.701 shown for overall height');
  const after = await page.evaluate(() => Array.from(document.querySelectorAll('.readings input')).map((x) => x.value));
  ok(JSON.stringify(before) === JSON.stringify(after), 'no reading box changed when the report came in');
  ok((await chip(page, 'critical|overall height|0')) === 'NOT MEASURED', 'and an unmeasured feature stays NOT MEASURED');
  await page.locator('#reportText').fill(inventedReport('bulkhead', 'Some other part'));
  await page.locator('#importReport').tap();
  ok((await page.locator('#reportOut .refusal').textContent()).includes('wrong_part'), 'a report for another part is refused');
  ok((await card(page, 'critical|overall height|0').locator('.modelled').textContent()).includes('37.701'), 'and the earlier model column is kept');

  // the record
  await page.locator('#operator').fill('A. Machinist');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dlJson').tap()]);
  const file = path.join(tmp, 'rec.json');
  await dl.saveAs(file);
  savedRecord = fs.readFileSync(file, 'utf8');
  const rec = JSON.parse(savedRecord);
  ok(rec.declaration_sha256 === 'ea41c20b0c1ba26896d381bf52a75bfbba24250f4c0876d6acc9c65f06ac24d8', 'the record carries the FLIGHT hash');
  ok(rec.rows.find((r) => r.id === rod).verdict === 'IN' && rec.rows.find((r) => r.id === 'critical|bulkhead OD|0').entry.readings.join() === '146.20,146.21', 'the record carries the readings and verdicts as typed');
  ok(rec.operator === 'A. Machinist' && rec.status.verdict === 'INCOMPLETE', 'and the operator and part status');
  const [dm] = await Promise.all([page.waitForEvent('download'), page.locator('#dlMd').tap()]);
  const mdf = path.join(tmp, 'rec.md'); await dm.saveAs(mdf);
  const md = fs.readFileSync(mdf, 'utf8');
  ok(md.includes('| Interface | Nominal (mm) | Nominal (in) | Tol (mm) | Tolerance from | As modelled | Verified on the article |'), 'the Markdown keeps the ICD header');
  ok(md.includes('| bulkhead OD (plate, x) | 146.200 | 5.7559 | ±0.05 | **tool default** | 146.201 | IN · 146.200–146.210 mm'), 'and fills both columns of the OD row');

  // everything open, at 390 px, dark: nothing scrolls sideways
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(100);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px with every card open');
  // persistence: reload
  await page.reload(); await page.waitForTimeout(150);
  ok((await chip(page, rod)) === 'IN' && (await chip(page, 'critical|bulkhead OD|0')) === 'IN', 'entries survive a reload');
  ok((await page.locator('#operator').inputValue()) === 'A. Machinist', 'and so does the operator');
  ok(errors.length === 0, 'no console errors on the phone: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 2. desktop: resume, keyboard, a whole part to ALL IN, refusals
{
  const { context, page, errors } = await open(DESK);
  // resume the phone's record in a fresh browser
  await page.locator('#resumeFile').setInputFiles({ name: 'rec.json', mimeType: 'application/json', buffer: Buffer.from(savedRecord) });
  await page.waitForTimeout(150);
  ok((await page.locator('#outMsg').textContent()).startsWith('Resumed'), 'a record resumes in a fresh browser');
  ok((await chip(page, 'holes|all-thread rods 1/4 in|0|0')) === 'IN' && (await chip(page, 'critical|bulkhead OD|0')) === 'IN', 'with its verdicts');
  ok((await page.locator('#shelf li.inst').count()) === 2, 'and its instruments');

  // a record for another revision is refused: the coupler's declaration is not the bulkhead's
  await page.locator('#tpl').selectOption('coupler');
  await page.locator('#resumeFile').setInputFiles({ name: 'rec.json', mimeType: 'application/json', buffer: Buffer.from(savedRecord) });
  await page.waitForTimeout(150);
  ok((await page.locator('#outMsg').textContent()).includes('different FLIGHT block'), 'a record is refused against another declaration');

  // keyboard: Tab to the first card's summary, Enter opens it; Enter in a reading adds the next box
  const first = 'critical|length|0';
  await card(page, first).locator('summary').focus();
  await page.keyboard.press('Enter');
  ok(await card(page, first).locator('details').evaluate((d) => d.open), 'Enter on a summary opens the card');
  await card(page, first).locator('select').first().selectOption({ label: 'Micrometer (0.001 mm)' });
  await card(page, first).locator('.readings input').first().focus();
  await page.keyboard.type('300.02');
  await page.keyboard.press('Enter');
  await page.keyboard.type('299.95');
  ok((await card(page, first).locator('.readings input').count()) === 2, 'Enter in the last reading adds another box and moves to it');
  ok((await chip(page, first)) === 'IN', 'both readings typed by keyboard: IN');

  // the coupler to ALL IN through the page: 7 features
  await readings(page, 'od|coupler OD|0', 'Micrometer (0.001 mm)', ['149.30', '149.31', '149.29']);
  await readings(page, 'bores|bore|0', 'Micrometer (0.001 mm)', ['142.95']);
  for (const id of ['holes|shear pin, aft, 0°|0|0', 'holes|shear pin, fwd, 0°|0|0']) {
    await openCard(page, id);
    await card(page, id).getByRole('button', { name: 'GO / NO-GO gauges' }).click();
    await card(page, id).locator('input[id$="go"]').first().fill('2.10');
    await card(page, id).getByRole('group', { name: 'GO result', exact: true }).getByRole('button', { name: 'went in' }).click();
    await card(page, id).locator('input[id$="nogo"]').fill('2.30');
    await card(page, id).getByRole('group', { name: 'NO-GO result' }).getByRole('button', { name: 'stopped' }).click();
  }
  await readings(page, 'holes|rail button tap drill #8-32|0|0', 'Micrometer (0.001 mm)', ['3.45']);
  ok((await card(page, 'holes|rail button tap drill #8-32|0|0').locator('.flags li.hint').textContent()).includes('tap-drill size'), 'the tap-drill row says when it can be measured');
  const gg = 'gauges|shear pins at 120° and 240°, both ends|0';
  await openCard(page, gg);
  await card(page, gg).locator('input').first().fill('2.10 pin in each of the four holes');
  await card(page, gg).getByRole('button', { name: /Clear/ }).click();
  ok((await word(page)) === 'INCOMPLETE' && (await page.locator('#sline').textContent()).includes('operator not recorded'), 'all IN but no operator: still INCOMPLETE');
  await page.locator('#operator').fill('B. Inspector');
  ok((await word(page)) === 'ALL IN', 'all 7 coupler features IN with operator and date: ALL IN');
  await page.locator('#idate').fill('');
  ok((await word(page)) === 'INCOMPLETE', 'clearing the date makes it INCOMPLETE again');
  await page.locator('#idate').fill('2026-10-26');
  // the inch view of a limit, and the flag for a coarse inch caliper
  await addInstrument(page, 'caliper', 'in', '0.0005');
  await readings(page, 'od|coupler OD|0', 'Caliper (0.0005 in)', ['5.878']);
  ok((await card(page, 'od|coupler OD|0').locator('.flags li[data-code="discrimination"]').count()) === 1, 'a 0.0005 in caliper on ±0.05 mm is flagged');
  ok((await card(page, 'od|coupler OD|0').locator('.body > p.hint').first().textContent()).includes('5.87599 … 5.87992 in'), 'inch limits are printed rounded inward');

  // the filter
  await page.locator('#filter').selectOption('problems');
  ok((await page.locator('li.feat:visible').count()) === 0, '"OUT or undecided" shows none on a clean coupler');
  await page.locator('#filter').selectOption('all');

  // refusals: a file with no FLIGHT block, malformed JSON
  await page.locator('#tpl').selectOption('__paste');
  await page.locator('#paste').fill('// PART: bracket\ncube([10,10,10]);\n');
  await page.locator('#usePaste').click();
  const ref = await page.locator('#declRefusal').textContent();
  ok(ref.includes('no FLIGHT block') && ref.includes('What would help'), 'a .scad with no FLIGHT block is refused with what would help');
  ok((await page.locator('li.feat').count()) === 0 && (await page.locator('#dlJson').isDisabled()), 'and nothing can be measured or exported');
  ok((await word(page)) === '—', 'and the status shows no verdict');
  await page.locator('#paste').fill('// FLIGHT-BEGIN\n// {"critical":[}\n// FLIGHT-END\n');
  await page.locator('#usePaste').click();
  ok((await page.locator('#declRefusal').textContent()).includes('not valid JSON'), 'a malformed FLIGHT block is refused');
  // a pasted part with its own FLIGHT block works and survives the template switch
  const own = '// PART: test spacer\n// FLIGHT-BEGIN\n// {"critical":[{"name":"length","module":"main","axis":"z","nominal_mm":25.4,"tol_mm":0.1,"tol_src":"user"}]}\n// FLIGHT-END\ncylinder(d=10,h=25.4,$fn=64);\n';
  await page.locator('#paste').fill(own);
  await page.locator('#usePaste').click();
  ok((await page.locator('li.feat').count()) === 1 && (await page.locator('#partName').textContent()) === 'test spacer', 'a pasted declaration loads');
  ok(errors.length === 0, 'no console errors on the desktop: ' + errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 3. storage blocked: the page still works for the session
{
  const { context, page, errors } = await open({ ...PHONE_DARK, colorScheme: 'light' }, () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  ok((await page.locator('li.feat').count()) === 21, 'with storage blocked the page still loads the bulkhead');
  await addInstrument(page, 'micrometer', 'mm', '0.001');
  await readings(page, 'critical|plate thickness|0', 'Micrometer (0.001 mm)', ['12.75']);
  ok((await chip(page, 'critical|plate thickness|0')) === 'IN', 'and still gives verdicts');
  ok((await page.locator('#storageNote').textContent()).includes('Download the record'), 'and says nothing will be kept');
  ok(!(await overflow(page)), 'no overflow at 390 px in the light scheme');
  ok(errors.length === 0, 'no console errors with storage blocked: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
