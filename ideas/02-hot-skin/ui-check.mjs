#!/usr/bin/env node
// Drives Hot Skin in headless Chromium: phone width by touch in dark mode, desktop width by mouse
// and keyboard in light mode. Asserts the numbers on the page, the refusal states, the table, the
// chart's hover readout, no console errors and no horizontal overflow. Run by this folder's check.mjs,
// which tools/check.mjs runs; by hand from the bank root: node ideas/02-hot-skin/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does, and prints "skipped" (exit 0)
// when it is not installed.
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
  try {
    pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright');
  } catch {
    console.log('ui-check skipped: Playwright is not installed');
    process.exit(0);
  }
}
const outDir = process.argv.includes('--shots') ? path.join(os.tmpdir(), 'hot-skin-ui') : null;
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
const verdictText = (page) => page.locator('#verdict').innerText();
const bodyText = (page) => page.locator('body').innerText();
async function setSpeed(page, s) { await page.fill('#speed', s); await page.waitForTimeout(60); }
async function setAlt(page, s) { await page.fill('#alt', s); await page.waitForTimeout(60); }

// 1. Phone, touch, dark: the fin template opens, numbers, table, slider by touch, refusals.
{
  const { context, page, errors } = await open(PHONE);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(21, 23, 28)', `dark scheme applied (body ${bg})`);
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px on load');
  ok((await page.inputValue('#speed')) === '700' && (await page.inputValue('#alt')) === '3000' && (await page.inputValue('#material')) === '6061-T6', 'opens on the fin template condition');
  let vt = await verdictText(page);
  ok(/SCREEN/.test(vt) && /bound exceeds the limit/.test(vt), 'verdict is SCREEN, bound exceeds the limit');
  for (const n of ['−4.5 °C', '2.13', '239.4 °C', '213.1 °C', '201.0 °C', '170 °C', 'likely', '−69.4 °C', '−43.1 °C', '592 / 627 m/s']) ok(vt.includes(n), `verdict shows ${n}`);
  ok(/tool-proposed/.test(vt), 'the inputs_src default flag is shown');
  ok(/upper bound/.test(vt), 'the bound caveat is shown');
  ok(/airspeed, relative to the air/.test(vt) && vt.includes('7.0 K per 10 m/s of headwind'), 'the bound caveat says the speed is airspeed, 7.0 K per 10 m/s of headwind at 700 m/s');
  ok(/Airspeed/.test(await page.locator('label[for="speed"]').innerText()) && /relative to the air/.test(await page.locator('#speed-hint').innerText()), 'the speed field is labelled airspeed, relative to the air');
  ok(vt.includes('ISA−69.4 K') && vt.includes('none in the band') === false, '6061-T6 at the fin condition names its day, ISA−69.4 K, inside the band');
  ok(!/\bPASS\b/.test((await bodyText(page)).replace(/never PASS|never a pass/g, '')), 'the word PASS appears nowhere as a verdict');
  ok((await page.locator('#matRows tr').count()) === 21, '21 material rows');
  ok((await page.locator('#matRows tr.over').count()) === 13, '13 rows over');
  ok((await page.locator('#matRows tr.near').count()) === 1 && (await page.locator('#matRows tr[data-key="PEEK"]').getAttribute('class')) === 'near', 'PEEK is the one near row');
  ok((await page.locator('#matRows tr.under').count()) === 7, '7 rows under');
  ok(/recall/.test(await page.locator('#matRows tr[data-key="G10-FR4"]').innerText()), 'G10-FR4 row shows its recall confidence');
  // Show the arithmetic.
  await page.locator('.arith summary').tap();
  await page.waitForTimeout(80);
  const ar = await page.locator('#arith').innerText();
  ok(/1004\.685/.test(ar) && /243\.858 K/.test(ar), 'arithmetic shows cp and the V²/2cp cross-check');
  // Touch the speed slider near its right end: the speed changes and the verdict follows.
  await page.locator('#speedRange').scrollIntoViewIfNeeded();
  const sl = await page.locator('#speedRange').boundingBox();
  await page.touchscreen.tap(sl.x + sl.width * 0.9, sl.y + sl.height / 2);
  await page.waitForTimeout(100);
  const v1 = Number(await page.inputValue('#speed'));
  ok(v1 > 1200 && v1 <= 1500, `touching the slider set the speed (${v1})`);
  vt = await verdictText(page);
  ok(/SCREEN/.test(vt) && !vt.includes('239.4 °C'), 'verdict re-computed after the touch');
  ok(/above 800 K/.test(vt), 'a stagnation temperature above 800 K is flagged');
  // Touch the altitude slider too.
  await page.locator('#altRange').scrollIntoViewIfNeeded();
  const al = await page.locator('#altRange').boundingBox();
  await page.touchscreen.tap(al.x + al.width * 0.5, al.y + al.height / 2);
  await page.waitForTimeout(100);
  const a1 = Number(await page.inputValue('#alt'));
  ok(a1 > 15000 && a1 < 25000, `touching the altitude slider set the altitude (${a1})`);
  // Mach is refused with the two-altitude example.
  await setSpeed(page, 'Mach 2');
  ok(!(await page.locator('#refusal').isHidden()) && (await page.locator('#verdict').isHidden()), 'Mach input shows the refusal and hides the verdict');
  const rt = await page.locator('#refusal').innerText();
  ok(/invalid_input/.test(rt) && /V²\/2cp/.test(rt), 'refusal names the code and the reason');
  ok(rt.includes('210.4 °C') && rt.includes('125.6 °C') && rt.includes('84.8 °C apart'), 'refusal carries the 3 km / 25 km example');
  ok((await page.locator('#matRows tr').count()) === 0, 'no table under a refusal');
  // A Mach number past the ceiling is not worked: the example falls back to Mach 2 and says why.
  await setSpeed(page, 'Mach 10');
  const rt10 = await page.locator('#refusal').innerText();
  ok(/invalid_input/.test(rt10) && rt10.includes('210.4 °C') && rt10.includes('125.6 °C') && /Mach 10 is not worked here/.test(rt10) && /Mach 2 at two altitudes/.test(rt10), 'Mach 10 refuses with the Mach 2 example and the reason');
  const temps10 = (rt10.match(/−?[\d,]+\.\d °C/g) || []).map((x) => Number(x.replace('−', '-').replace(/,/g, '').replace(' °C', '')));
  ok(temps10.length >= 4 && temps10.every((t) => t + 273.15 <= 2000), `no temperature past 2,000 K in the Mach 10 refusal (${temps10.join(', ')})`);
  ok(!rt10.includes('5368.7') && !rt10.includes('4379.4'), 'the Mach 10 perfect-gas numbers are not printed');
  await setSpeed(page, 'Mach 99999');
  ok(!/\d{5,}\.\d °C/.test(await page.locator('#refusal').innerText()), 'Mach 99999 prints no huge temperature');
  // "700 m" is an unfinished m/s, not Mach 700.
  await setSpeed(page, '700 m');
  const rtm = await page.locator('#refusal').innerText();
  ok(/did you mean m\/s/.test(rtm) && (await page.locator('#refExample').isHidden()), '"700 m" asks for m/s and shows no Mach example');
  // Other units are reported, not converted.
  await setSpeed(page, '500 km/h');
  ok(/km\/h/.test(await page.locator('#refusal').innerText()), 'km/h is refused by name');
  await setSpeed(page, 'fast');
  ok(/needs a number/.test(await page.locator('#refusal').innerText()), 'garbage is refused');
  // Out of the ISA table.
  await setSpeed(page, '700');
  await setAlt(page, '90000');
  const rt2 = await page.locator('#refusal').innerText();
  ok(/out_of_envelope/.test(rt2) && /86 km/.test(rt2), 'altitude above the table is refused as out_of_envelope');
  ok(/No table/.test(await page.locator('#tableCond').innerText()), 'the table says why it is empty');
  // Back to a condition under the limit.
  await page.locator('#finBtn').tap();
  await page.waitForTimeout(80);
  ok((await page.inputValue('#speed')) === '700' && (await page.inputValue('#alt')) === '3000', 'the fin button restores the template condition');
  await page.selectOption('#material', '304');
  await page.waitForTimeout(80);
  vt = await verdictText(page);
  ok(/bound under the limit/.test(vt) && vt.includes('800 °C') && vt.includes('+560.6 °C'), '304 at the fin condition: under, margin +560.6');
  ok(vt.includes('none in the band') && /under the limit on every day from ISA−90 to ISA\+50 K/.test(vt) && !/560\.6 K/.test(vt), '304: no accepted day brings T0 to the limit, and ISA+560.6 K is not printed');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'phone-304.png'), fullPage: true });
  await page.selectOption('#material', 'Graphite');
  await page.waitForTimeout(80);
  vt = await verdictText(page);
  ok(vt.includes('none under the ceiling') && !/\b20\d\d\b m\/s|2007|2125/.test(vt), 'Graphite: no limit-speed crossing past the 2,000 K ceiling is named');
  await page.selectOption('#material', 'PEEK');
  await page.waitForTimeout(80);
  ok(/within 25 °C/.test(await verdictText(page)), 'PEEK at the fin condition is near');
  await page.selectOption('#src', 'user');
  await page.waitForTimeout(80);
  ok(!/tool-proposed/.test(await verdictText(page)), 'a user-declared speed is not flagged provisional');
  ok(/ISA\+10\.6 K/.test(await verdictText(page)), 'the standard-day flag names the offset that erases PEEK’s margin');
  // A hot day: ISA+11 takes PEEK from near to stagnation, and every bound rises by 11 K.
  await page.fill('#dt', '11');
  await page.waitForTimeout(80);
  vt = await verdictText(page);
  ok(/recovery under, stagnation over/.test(vt) && vt.includes('250.4 °C') && vt.includes('−0.4 °C') && /ISA\+11\.0 K/.test(vt), `ISA+11: PEEK goes to stagnation, T0 250.4 °C, margin −0.4 (${vt.slice(0, 60)}…)`);
  await page.fill('#dt', '60');
  await page.waitForTimeout(80);
  ok(/out_of_envelope/.test(await page.locator('#refusal').innerText()) && (await page.locator('#matRows tr').count()) === 0, 'ISA+60 is refused and draws no table');
  ok(!/this day is/.test(await page.locator('#dtNow').innerText()), 'the hint names no day temperature for a refused offset');
  await page.fill('#dt', '-300');
  await page.waitForTimeout(80);
  ok(!/this day is|304\.5/.test(await page.locator('#dtNow').innerText()) && /out_of_envelope/.test(await page.locator('#refusal').innerText()), 'ISA−300 is refused and the hint prints no day below absolute zero');
  await page.fill('#dt', '0');
  await page.waitForTimeout(80);
  // A cited source needs its citation, as in PartForge.
  await page.selectOption('#src', 'source');
  await page.waitForTimeout(80);
  ok(!(await page.locator('#ref').isHidden()), 'choosing source shows the citation field');
  vt = await verdictText(page);
  ok(/demoted to default/.test(vt) && /tool-proposed/.test(vt), 'source with no citation is demoted and provisional');
  await page.fill('#ref', 'OpenRocket sim, run 3');
  await page.waitForTimeout(80);
  vt = await verdictText(page);
  ok(!/demoted/.test(vt) && !/tool-proposed/.test(vt), 'a citation clears both flags');
  // The table's own note on the row is printed.
  ok(/most notes describe expansion/.test(vt) && /Below the glass transition/.test(vt), 'the verdict prints PEEK’s table note');
  ok((await page.locator('#matRows tr[data-key="6061-T6"] details').count()) === 1, 'the table row carries its note');
  ok(!(await overflow(page)), 'no horizontal overflow at 390 px after interaction');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'phone-dark.png'), fullPage: true });
  ok(errors.length === 0, `no console errors on the phone (${errors.join('; ')})`);
  await context.close();
}

// 2. Desktop, light, mouse and keyboard: chart hover, keyboard on the slider, query strings.
{
  const { context, page, errors } = await open(DESK);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(244, 241, 234)', `light scheme applied (body ${bg})`);
  // The chart has drawn something: sample pixels are not all one colour.
  const painted = await page.evaluate(() => {
    const c = document.getElementById('chart'); const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data; const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`);
    return seen.size;
  });
  ok(painted > 6, `chart canvas is painted (${painted} distinct sampled colours)`);
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(60);
  const read = await page.locator('#chartRead').innerText();
  ok(/^at \d+ m\/s \(Mach [\d.]+\): T0 [\d.]+ °C · Tr turbulent [\d.]+ · Tr laminar [\d.]+ · limit 170$/.test(read), `hover readout reads the curves (${read})`);
  await page.mouse.move(box.x - 20, box.y - 20);
  await page.waitForTimeout(60);
  ok(/Hover or touch/.test(await page.locator('#chartRead').innerText()), 'leaving the chart resets the readout');
  // Keyboard on the speed slider.
  await page.focus('#speedRange');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  ok((await page.inputValue('#speed')) === '701', 'ArrowRight on the slider adds 1 m/s');
  ok(/701 m\/s/.test(await verdictText(page)), 'the verdict follows the keyboard');
  // Tab order reaches the material select and the fin button.
  await page.focus('#material');
  await page.keyboard.press('Tab');
  ok((await page.evaluate(() => document.activeElement.id)) === 'src', 'Tab from material goes to the source select');
  // The provenance footer names the commit and files.
  const pt = await page.locator('#prov').innerText();
  ok(/index\.html lines 620–684 at 0974a62/.test(pt) && /materials_thermal\.json/.test(pt) && /fin\.scad/.test(pt), 'provenance footer names files, lines and commit');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'desktop-light.png'), fullPage: true });
  ok(errors.length === 0, `no console errors on the desktop (${errors.join('; ')})`);
  await context.close();
}

// 3. Query strings: a bare Mach refuses on load; a declared condition loads without the provisional flag.
{
  const a = await open(DESK, `${URL0}?mach=2&alt=3000&m=6061-T6`);
  ok(!(await a.page.locator('#refusal').isHidden()) && /210\.4 °C/.test(await a.page.locator('#refusal').innerText()), '?mach=2 refuses on load with the example');
  ok(a.errors.length === 0, 'no console errors with ?mach');
  await a.context.close();
  const b = await open(PHONE, `${URL0}?v=300&alt=0&m=PEEK&src=user`);
  const vt = await verdictText(b.page);
  ok(vt.includes('15.0 °C') && vt.includes('0.88') && vt.includes('59.8 °C') && vt.includes('250 °C') && /bound under the limit/.test(vt), `?v=300&alt=0&m=PEEK: T∞ 15.0, Mach 0.88, T0 59.8, limit 250 (${vt.slice(0, 80)}…)`);
  ok(!/tool-proposed/.test(vt) && /recall/.test(vt), 'src=user is not provisional; PEEK recall confidence printed');
  ok(!(await overflow(b.page)), 'no overflow on the phone with a query');
  ok(b.errors.length === 0, 'no console errors with ?v');
  await b.context.close();
  // An unknown material is refused by name, not swapped for 6061-T6; an empty altitude is absent, not 0.
  const c = await open(DESK, `${URL0}?m=Unobtainium&v=300&alt=`);
  const rc = await c.page.locator('#refusal').innerText();
  ok(/not_found/.test(rc) && /Unobtainium/.test(rc) && (await c.page.locator('#verdict').isHidden()), '?m=Unobtainium is refused as not_found');
  ok((await c.page.inputValue('#alt')) === '3000', '?alt= (empty) leaves the template altitude');
  ok(c.errors.length === 0, 'no console errors with ?m=Unobtainium');
  await c.context.close();
  const d = await open(DESK, `${URL0}?v=700&alt=3000&m=PEEK&dt=20`);
  const vd = await verdictText(d.page);
  ok(vd.includes('259.4 °C') && vd.includes('−9.4 °C') && /ISA\+20\.0 K/.test(vd), `?dt=20: PEEK T0 259.4 °C, margin −9.4 (${vd.slice(0, 60)}…)`);
  ok(d.errors.length === 0, 'no console errors with ?dt');
  await d.context.close();
}

// 4. Speeds far outside the envelope are refused at once, not computed. Before the ceiling existed a typed
//    1,000,000 m/s froze the tab in the chart's grid loop; now the input handler must return in well under a
//    second, the refusal must name the ceiling, no table is drawn, and the chart's axis stops at the ceiling speed.
{
  const { context, page, errors } = await open(DESK);
  for (const s of ['2000', '1000000', '10000000', '99999999']) {
    const t0 = Date.now();
    await page.fill('#speed', s, { timeout: 5000 });
    await page.waitForSelector('#refusal:not([hidden])', { timeout: 5000 });
    const dt = Date.now() - t0;
    const rt = await page.locator('#refusal').innerText();
    ok(dt < 1000, `${s} m/s is refused within a second (${dt} ms)`);
    ok(/out_of_envelope/.test(rt) && /passes 2000 K/.test(rt) && /Stay below 1865\.1 m\/s/.test(rt) && /does not apply/.test(rt), `${s} m/s names the 2,000 K ceiling and the 1,865.1 m/s stay-below speed at 3,000 m`);
    ok(await page.locator('#verdict').isHidden(), `${s} m/s shows no verdict`);
    ok((await page.locator('#matRows tr').count()) === 0 && /No table/.test(await page.locator('#tableCond').innerText()), `${s} m/s draws no table and says why`);
  }
  // Just under the ceiling the page computes and the hot flag names the ceiling; one metre per second more refuses.
  await setSpeed(page, '1865');
  const vt = await verdictText(page);
  ok(/SCREEN/.test(vt) && /above 800 K/.test(vt) && /2000 K ceiling/.test(vt), 'just under the ceiling: SCREEN with the hot flag naming the ceiling');
  // With the marker near the ceiling the chart's speed axis stops at the ceiling speed for this altitude
  // (a quarter beyond 1,865 would be 2,500; the cap holds it at 1,865): hovering the right edge reads 1,865 m/s.
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height * 0.5);
  await page.waitForTimeout(60);
  const read = await page.locator('#chartRead').innerText();
  const m = /^at (\d+) m\/s \(Mach ([\d.]+)\): T0 ([\d.]+) °C/.exec(read);
  ok(m && Number(m[1]) === 1865 && Number(m[3]) < 1727, `the chart axis stops at the ceiling speed and T0 there is under 1,727 °C = 2,000 K (${read.slice(0, 60)})`);
  await page.mouse.move(box.x - 20, box.y - 20);
  await setSpeed(page, '1866');
  ok(!(await page.locator('#refusal').isHidden()) && /out_of_envelope/.test(await page.locator('#refusal').innerText()), 'one m/s over the ceiling at 3,000 m: refused');
  // Without an accepted speed the axis falls back to its 1,000 m/s minimum; the chart still draws.
  // (The refusal card is shorter than the verdict card, so the chart has moved: re-measure it.)
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const box2 = await page.locator('#chart').boundingBox();
  await page.mouse.move(box2.x + box2.width - 1, box2.y + box2.height * 0.5);
  await page.waitForTimeout(60);
  ok(/^at 1000 m\/s/.test(await page.locator('#chartRead').innerText()), 'after a refusal the axis is back to 1,000 m/s');
  await page.mouse.move(box2.x - 20, box2.y - 20);
  // A trailing or leading decimal point is a number, not garbage.
  await setSpeed(page, '700.');
  ok(/239\.4 °C/.test(await verdictText(page)), '"700." is read as 700 m/s');
  await setSpeed(page, '.5');
  ok(/bound under the limit/.test(await verdictText(page)), '".5" is read as 0.5 m/s');
  // The day where T0 meets the limit is named only inside the band: 6061-T6 at 1,500 m/s and 3 km would
  // need ISA−945.3 K (a free stream at −676.6 K), so the page says no accepted day brings T0 down to it.
  await setSpeed(page, '1500');
  let v15 = await verdictText(page);
  ok(v15.includes('none in the band') && /over the limit on every day from ISA−90 to ISA\+50 K/.test(v15) && !/ISA−945\.3/.test(v15) && v15.includes('−945.3 °C'), '1,500 m/s in 6061-T6: margin −945.3 °C, no accepted day, and ISA−945.3 K is not printed');
  await page.fill('#dt', '20');
  await page.waitForTimeout(80);
  v15 = await verdictText(page);
  ok(/ISA\+20\.0 K/.test(v15) && /over it on every day from ISA−90\.0 K to ISA\+50\.0 K/.test(v15) && !/ISA−9[46]5\.3/.test(v15), 'and at ISA+20 the offset flag says over on every accepted day, with no ISA−965 K');
  await page.fill('#dt', '0');
  await page.waitForTimeout(60);
  ok(!(await overflow(page)), 'no horizontal overflow after the out-of-envelope inputs');
  ok(errors.length === 0, `no console errors with out-of-envelope inputs (${errors.join('; ')})`);
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed${outDir ? `; screenshots in ${outDir}` : ''}`);
process.exit(failures ? 1 : 0);
