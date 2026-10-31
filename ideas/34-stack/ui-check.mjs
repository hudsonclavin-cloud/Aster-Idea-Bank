#!/usr/bin/env node
// Drives the Stack page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by touch,
// light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/34-stack/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const { S, M, AS512: D } = L;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const b64 = (o) => M.b64urlEncode(JSON.stringify(o));

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForTimeout(500);
  return { context, page, errors };
}
const handoff = (page) => page.evaluate(() => JSON.parse(document.getElementById('exportText').value));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const tileVal = (page, k) => page.evaluate((k) => { const t = [...document.querySelectorAll('#tiles .tile')].find((x) => x.querySelector('.k').textContent.startsWith(k)); return t ? t.querySelector('.v').textContent : null; }, k);
const noNaN = async (page, where) => { const t = await page.locator('main').innerText(); ok(!/\bNaN\b|undefined|Infinity/.test(t), where + ': no NaN/undefined on the page'); };
const refusalText = (page) => page.locator('#refusals').innerText();

// kernel expectations
const ENG = S.as512Engines();
const V = S.fromAS512(D), R = S.evaluate(V, ENG), RS = S.evaluate(S.simplify(V), ENG);
const H33 = JSON.parse(fs.readFileSync(path.join(here, 'snapshots/33-handoff.json'), 'utf8'));
const H34 = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
const FC = S.flightCheck(D, ENG);

// ------------------------------------------------------------------ desktop, light
{
  const { context, page, errors } = await open(DESK);
  ok(await page.locator('#vehicle').inputValue() === 'as512', 'opens on AS-512');
  ok(Math.abs(num(await tileVal(page, 'Liftoff mass')) - R.liftoff.mass / 1000) < 0.6, 'liftoff mass tile = kernel');
  ok(Math.abs(num(await tileVal(page, 'Ideal delta-v')) - R.dv / 1000) < 0.0006, `delta-v tile ${await tileVal(page, 'Ideal delta-v')} = kernel ${R.dv / 1000}`);
  ok(Math.abs(num(await tileVal(page, 'Thrust / weight')) - R.liftoff.tw) < 0.0006, 'liftoff T/W tile = kernel');
  ok(await page.locator('#stageTable tbody tr').count() === 3, 'three stage rows');
  ok(await page.locator('#stages .stagecard').count() === 3, 'three stage cards');
  ok((await page.locator('#tiles .tile .c').count()) === 5, 'a confidence chip on every tile');
  // Against Apollo 17
  const recRows = await page.locator('#tblRecord tbody tr:not(.hl)').count();
  ok(recRows === FC.rows.length, `record table has every check (${recRows} of ${FC.rows.length})`);
  const recText = await page.locator('#tblRecord').innerText();
  ok(recText.includes('+0.14 %') && recText.includes('+11.76 %') && recText.includes('+2.43 %'), 'record table shows the F-1, S-IVB J-2 and S-IC burn-time gaps');
  ok((await page.locator('#trustList li').count()) === 4, 'four trust statements');
  // the burns chart: tap, keys, acceleration view with flight points
  await page.locator('#chartFly').scrollIntoViewIfNeeded();
  const box = await page.locator('#chartFly').boundingBox();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
  ok(/S-IC/.test(await page.locator('#capFly').innerText()), 'tapping the burns chart early reads the S-IC');
  await page.locator('#chartFly').focus(); await page.keyboard.press('ArrowRight');
  ok(/At [0-9.,]+ s of burning/.test(await page.locator('#capFly').innerText()), 'arrow key moves the cursor');
  await page.click('[data-fly="a"]');
  ok(await page.locator('#chartFly circle.flight').count() === 4, 'acceleration view shows four flight points (Table 4-1)');
  await page.click('[data-fly="m"]');
  ok(await page.locator('#chartFly circle.flight').count() === 4, 'mass view shows four flight masses (Table 16-9)');
  // events off
  await page.click('[data-events="simple"]');
  ok(Math.abs(num(await tileVal(page, 'Ideal delta-v')) - RS.dv / 1000) < 0.0006, 'no events: delta-v = kernel simplify()');
  ok(Math.abs(num(await tileVal(page, 'Liftoff mass')) - R.liftoff.mass / 1000) < 0.6, 'no events: same liftoff mass');
  await page.click('[data-events="flown"]');
  // payload: typed, chart keys
  await page.fill('#plNum', '100'); await page.locator('#plNum').dispatchEvent('change');
  const R100 = S.evaluate(S.withPayload(V, 100000), ENG);
  ok(Math.abs(num(await tileVal(page, 'Ideal delta-v')) - R100.dv / 1000) < 0.0006, 'payload 100 t: delta-v = kernel');
  await page.locator('#chartPay').focus(); await page.keyboard.press('ArrowRight');
  ok(Math.abs(num(await page.locator('#plNum').inputValue()) - 101) < 1e-9, 'arrow key on the payload chart adds 1 t');
  await page.locator('#chartPay').scrollIntoViewIfNeeded();
  const pb = await page.locator('#chartPay').boundingBox();
  await page.mouse.click(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5);
  ok(num(await page.locator('#plNum').inputValue()) > 50, 'tapping the payload chart sets the payload');
  // target solve
  const sol = await page.locator('#solve').innerText();
  ok(/At most [0-9.,]+ t of payload/.test(sol), 'parking-orbit target solves a payload');
  const want = S.solvePayload(S.withPayload(V, 0), ENG, R.stages[0].dv + R.stages[1].dv + R.stages[2].burns[0].dv).payload;
  ok(Math.abs(num(sol.match(/At most ([0-9.,]+) t/)[1]) - want / 1000) < 0.06, `solved payload ${sol.match(/At most ([0-9.,]+) t/)[1]} t = kernel ${(want / 1000).toFixed(1)}`);
  await page.selectOption('#target', 'typed'); await page.fill('#targetNum', '20000'); await page.locator('#targetNum').dispatchEvent('change');
  ok(/Refused \(out_of_envelope\): Even with no payload/.test(await page.locator('#solve').innerText()), 'an impossible target is refused');
  // engines: fewer F-1s until it cannot lift off, then a J-2 on the pad
  await page.selectOption('#vehicle', 'as512');
  for (let k = 0; k < 4; k++) await page.click('#stage0 .stepper button:first-child');
  ok(/shut down all 1 engines/.test(await refusalText(page)), 'one F-1 with the centre-engine cutoff still scheduled: refused');
  await page.click('#stage0 .stepper button:last-child');
  ok(/does not leave the pad/.test(await refusalText(page)), 'two F-1s under a Saturn V: refused, does not leave the pad');
  await page.selectOption('#eng0', 'J-2');
  ok(/separates at sea level/.test(await refusalText(page)), 'a J-2 first stage: refused, separates at sea level');
  await page.selectOption('#vehicle', 'as512');
  await page.fill('#dry0', '0'); await page.locator('#dry0').dispatchEvent('change');
  ok(/no dry mass/.test(await refusalText(page)) && /refused/.test(await tileVal(page, 'Stack')), 'zero dry mass refused, no numbers shown');
  ok(/Refused|refused/.test(await page.locator('#solve').innerText()), 'payload chart says the stack is refused');
  await page.selectOption('#vehicle', 'as512');
  // add a stage, scale its dry mass, remove it
  await page.click('#addStage');
  ok(await page.locator('#stages .stagecard').count() === 4 && await page.locator('#stageTable tbody tr').count() === 4, 'a fourth stage added');
  await page.selectOption('#frac3', '2'); await page.click('#stage3 .fx button');
  const st = await page.evaluate(() => window.__stack.state.veh.stages[3]);
  const P3 = st.burns[0].propellant, f3 = S.inertFractions(D)[2].value;
  ok(Math.abs(st.dry - P3 * f3 / (1 - f3)) < 1e-6, 'scale dry mass = kernel dryForFraction (S-IVB fraction)');
  await page.click('#stage3 .rm');
  ok(await page.locator('#stages .stagecard').count() === 3, 'stage removed');
  // export
  await page.selectOption('#vehicle', 'as512');
  const h = await handoff(page);
  ok(h.from === '34-stack' && h.inputs.vehicle.id === 'AS-512', 'export is a 34-stack AS-512 handoff');
  ok(Math.abs(h.outputs.delta_v_ideal.value - R.dv) < 1e-6, 'exported delta-v = kernel');
  ok(h.outputs.liftoff_mass.confidence === 'measured', 'AS-512 liftoff mass exported as measured');
  ok(/#h=/.test(await page.locator('#nextLink').getAttribute('href')), 'next-module link carries the handoff');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  ok(dl.suggestedFilename() === 'handoff.json', 'download handoff.json');
  // import: idea 33's committed handoff, an edited one, a 32 handoff
  await page.fill('#importText', JSON.stringify(H33)); await page.click('#importBtn');
  ok(/Imported from the text box: idea 33's engine/.test(await page.locator('#importStatus').innerText()), 'idea 33 handoff imported');
  ok(await page.locator('#vehicle').inputValue() === 'imp', 'switched to the imported-engine vehicle');
  ok(Math.abs(num(await tileVal(page, 'Ideal delta-v')) - H34.outputs.delta_v_ideal.value / 1000) < 0.0006, 'imported-engine vehicle = the sample handoff\'s delta-v');
  const ed = JSON.parse(JSON.stringify(H33)); ed.outputs.thrust_vacuum.value *= 1.01;
  await page.fill('#importText', JSON.stringify(ed)); await page.click('#importBtn');
  ok(/Refused \(invalid_input\)/.test(await page.locator('#importStatus').innerText()), 'edited idea 33 handoff refused');
  await page.fill('#importText', JSON.stringify(H33.inputs.nozzle_handoff)); await page.click('#importBtn');
  ok(/Refused \(insufficient_data\).*chamber and nozzle/.test(await page.locator('#importStatus').innerText()), 'idea 32 handoff refused: no engine');
  await page.fill('#importText', 'not a handoff'); await page.click('#importBtn');
  ok(/Refused \(invalid_input\)/.test(await page.locator('#importStatus').innerText()), 'garbage refused');
  await noNaN(page, 'desktop');
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desk.png'), fullPage: true });
  await context.close();
}

// ------------------------------------------------------------------ links: idea 33's export link, this page's own round trip
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(H33));
  ok(await page.locator('#vehicle').inputValue() === 'imp', 'opens on idea 33\'s #h= link with its engine');
  ok(/from the link/.test(await page.locator('#importStatus').innerText()), 'link import reported');
  await context.close();
  const o2 = await open(DESK, URL0 + '#h=' + b64(H34));
  ok(await o2.page.locator('#vehicle').inputValue() === 'impveh', 'opens on its own #h= link with the vehicle');
  ok(Math.abs(num(await tileVal(o2.page, 'Ideal delta-v')) - H34.outputs.delta_v_ideal.value / 1000) < 0.0006, 'round trip: same delta-v');
  ok(errors.length === 0 && o2.errors.length === 0, 'links: no console errors ' + errors.concat(o2.errors).join(' | '));
  await o2.context.close();
}

// ------------------------------------------------------------------ phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(!(await overflow(page)), scheme + ' phone: no horizontal overflow');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(200);
  ok(!(await overflow(page)), scheme + ' phone: no overflow with every section open');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const minFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#chartFly text, #chartPay text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0)));
  ok(minFont >= 10.5, scheme + ' phone: chart text at least 11 px (' + minFont.toFixed(1) + ')');
  const wide = await page.evaluate(() => [...document.querySelectorAll('table td')].filter((td) => { const r = td.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length);
  ok(wide === 0, scheme + ' phone: every table cell on screen (' + wide + ' off)');
  // touch the payload chart
  await page.locator('#chartPay').scrollIntoViewIfNeeded();
  const pb2 = await page.locator('#chartPay').boundingBox();
  await page.touchscreen.tap(pb2.x + pb2.width * 0.3, pb2.y + pb2.height * 0.5);
  ok(Math.abs(num(await page.locator('#plNum').inputValue()) - 50.6) > 0.5, scheme + ' phone: a tap on the payload chart sets the payload');
  // the engine stepper by touch
  await page.locator('#stage0 .stepper button:last-child').tap();
  ok(await page.locator('#cnt0').inputValue() === '6', scheme + ' phone: stepper adds an engine by touch');
  await noNaN(page, scheme + ' phone');
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  await context.close();
}

await browser.close();
console.log(`ui-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
