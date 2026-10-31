#!/usr/bin/env node
// Drives the Burn Out page in headless Chromium the way a person would: desktop by mouse and keyboard, phone by touch,
// light and dark; compares the page's numbers with the kernel's. Run from the bank root:
//   node ideas/38-burn-out/ui-check.mjs [--shots <dir>]
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const B = L.B;
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
const num = (s) => parseFloat(String(s).replace(/,/g, '').replace('−', '-'));
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const H37 = JSON.parse(fs.readFileSync(path.join(here, '..', '37-window', 'handoff.json'), 'utf8'));
const H36 = JSON.parse(fs.readFileSync(path.join(here, '..', '36-closed-loop', 'handoff.json'), 'utf8'));

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' / ')));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#apTable tbody tr').length > 0 && document.querySelectorAll('#twChart path').length > 0, null, { timeout: 30000 });
  return { context, page, errors };
}
const settle = async (page) => { await page.waitForFunction(() => !document.body.hasAttribute('data-busy') && !/computing/.test(document.getElementById('hoPreview').textContent), null, { timeout: 30000 }); };
const tileVal = (page, k) => page.evaluate((k) => { const t = [...document.querySelectorAll('#tiles .tile')].find((x) => x.querySelector('.k').textContent === k); return t ? t.querySelector('.v').textContent : null; }, k);
const noNaN = async (page, where) => { const t = await page.locator('main').innerText(); const bad = t.match(/.{0,60}(\bNaN\b|undefined|Infinity).{0,40}/); ok(!bad, where + ': no NaN/undefined on the page' + (bad ? ' (' + bad[0] + ')' : '')); };
const setNum = async (page, sel, v) => { await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); await settle(page); };
const refusals = (page) => page.locator('#refusals .refusal').allInnerTexts();
const apRow = (page, label) => page.evaluate((label) => { const r = [...document.querySelectorAll('#apTable tbody tr')].find((x) => x.children[0].textContent.startsWith(label)); return r ? [...r.children].map((c) => c.textContent) : null; }, label);

// kernel expectations
const ST = B.importWindow(L.WIN);
const K = (set) => B.compute({ window: ST }, Object.assign(B.defaults(), { sweep: false }, set || {}));
const k0 = K(), kOpt = K({ steering: 'optimal' }), kFix = K({ steering: 'fixed' }), kAp = B.compute({ apollo17: true }, Object.assign(B.defaults(), { sweep: false }));

// ------------------------------------------------------------------ desktop, light
{
  const { context, page, errors } = await open(DESK);
  await settle(page);
  ok((await page.locator('#preChain').getAttribute('aria-pressed')) === 'true', 'opens on the chain\'s AS-512 departure');
  ok(Math.abs(num(await tileVal(page, 'Delta-v spent (finite burn)')) - k0.sol.dvFinite) < 0.06, 'delta-v tile is the kernel\'s');
  ok(Math.abs(num(await tileVal(page, 'Finite-burn (gravity) loss')) - k0.sol.loss) < 0.006, 'loss tile: ' + await tileVal(page, 'Finite-burn (gravity) loss'));
  ok(Math.abs(num(await tileVal(page, 'Propellant needed')) - k0.sol.mUsed) < 0.6, 'propellant tile');
  ok(Math.abs(num(await tileVal(page, 'Payload the stage can send')) - k0.cap.finite) < 0.6, 'capability tile: ' + await tileVal(page, 'Payload the stage can send'));
  ok(Math.abs(num(await tileVal(page, 'Thrust-to-weight')) - k0.sc.tw0) < 0.0006, 'T/W tile');
  ok((await page.locator('#tiles .tile .c').count()) === (await page.locator('#tiles .tile').count()), 'a confidence chip on every tile');
  ok(/^Refused/.test(await page.locator('#verdict').innerText()), 'verdict refuses the departure');
  const rf = await refusals(page);
  ok(rf.length === 1 && /departure_propellant/.test(rf[0]), 'one refusal, departure_propellant: ' + rf.length);
  ok((await page.locator('#twChart path.line').count()) === 3, 'three loss curves');
  ok((await page.locator('#twChart circle.mk').count()) === 1, 'this burn marked on the curve');
  ok((await page.locator('#planeChart path.burn').count()) === 1 && (await page.locator('#planeChart path.hyp').count()) === 1, 'burn arc and hyperbola drawn');
  ok((await page.locator('#steerChart path.line').count()) === 2, 'steering chart');
  const bt = await apRow(page, 'Burn time');
  ok(bt && Math.abs(num(bt[1]) - kAp.apollo.rows[0].model) < 0.006 && Math.abs(num(bt[2]) - 351.04) < 0.006, 'Apollo 17 burn time row: ' + bt);
  ok((await page.locator('#apTable tbody tr').count()) === kAp.apollo.rows.length + 1, 'Apollo rows');
  await noNaN(page, 'desktop default');

  // steering laws
  await page.click('[data-steer="optimal"]'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'Finite-burn (gravity) loss')) - kOpt.sol.loss) < 0.006, 'optimised loss: ' + await tileVal(page, 'Finite-burn (gravity) loss'));
  ok(/optimised law turns the thrust/.test(await page.locator('#steerCap').innerText()), 'steering caption follows the law');
  await page.click('[data-steer="fixed"]'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'Finite-burn (gravity) loss')) - kFix.sol.loss) < 0.006, 'fixed-attitude loss');
  ok(/optimised|fixed attitude/i.test(await page.locator('#apIntro').innerText()), 'the Apollo table follows the steering');
  // perigee burns force the along-velocity law
  await page.click('[data-n="3"]'); await settle(page);
  ok((await page.locator('[data-steer="tangential"]').getAttribute('aria-pressed')) === 'true', 'three burns switch to along-velocity');
  ok((await page.locator('#burnList li').count()) === 3, 'three burns listed');
  const lb = K({ burns: 3 }).sol.final, arcLast = Math.acos(Math.min(1, lb.start.r.reduce((s, x, i) => s + x * lb.r[i], 0) / Math.hypot(...lb.start.r) / Math.hypot(...lb.r))) / (Math.PI / 180);
  ok(Math.abs(num(await tileVal(page, 'Burn arc')) - arcLast) < 0.06, 'with perigee burns the arc tile is the last burn\'s, not first ignition to last cutoff: ' + await tileVal(page, 'Burn arc') + ' vs ' + arcLast.toFixed(2));
  ok((await refusals(page)).some((t) => /asymptote_epoch/.test(t)), 'asymptote_epoch refusal with perigee burns');
  const k3 = K({ burns: 3, capability: true });
  ok(Math.abs(num(await tileVal(page, 'Loss if the launch were aimed for the phasing')) - k3.sol.inPlane.loss) < 0.006, 'in-plane loss tile');
  await page.click('[data-n="1"]'); await page.click('[data-steer="tangential"]'); await settle(page);
  // thrust-to-weight: typed, slider by keyboard on the chart, tap on the chart
  await setNum(page, '#twIn', 0.3);
  const k03 = K({ thrustScale: 0.3 / (k0.sc.tw0) });
  ok(Math.abs(num(await tileVal(page, 'Finite-burn (gravity) loss')) - k03.sol.loss) < 0.006, 'loss at T/W 0.3 is the kernel\'s: ' + await tileVal(page, 'Finite-burn (gravity) loss'));
  await page.focus('#twChart'); await page.keyboard.press('ArrowRight'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'Thrust-to-weight')) - 0.315) < 0.002, 'arrow key raises T/W 5 %');
  await page.locator('#twChart').scrollIntoViewIfNeeded();
  const box = await page.locator('#twChart').boundingBox();
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.5); await settle(page);
  ok(num(await tileVal(page, 'Thrust-to-weight')) > 1.5, 'a tap on the right of the chart sets a high T/W: ' + await tileVal(page, 'Thrust-to-weight'));
  await page.click('#twReset'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'Thrust-to-weight')) - k0.sc.tw0) < 0.0006, 'engine as handed');
  // a payload that closes the departure
  await setNum(page, '#payIn', 25000);
  ok(/^Departs/.test(await page.locator('#verdict').innerText()), 'a 25 t payload departs: ' + (await page.locator('#verdict').innerText()).slice(0, 80));
  ok((await refusals(page)).length === 0, 'no refusal when it closes');
  ok(Math.abs(num(await tileVal(page, 'C3 at infinity')) - 0.5114) < 0.0002, 'C3 at infinity is the target');
  // export, parse back with the kernel
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const dlPath = await dl.path(), exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  ok(exported.from === '38-burn-out' && exported.outputs.hyperbolic_departure_state && exported.outputs.v_infinity, 'downloaded handoff has the departure state');
  const back = B.parseHandoff(exported);
  ok(!back.refusal, 'the kernel recomputes the exported handoff and agrees' + (back.refusal ? ': ' + back.refusal.reason : ''));
  ok(exported.inputs.settings.payloadKg === 25000, 'the settings travel');
  // import idea 37's committed sample, then garbage, then idea 36's
  await page.fill('#importText', JSON.stringify(H37)); await page.click('#importBtn'); await settle(page);
  ok(/Imported idea 37/.test(await page.locator('#status').innerText()), 'imports idea 37\'s committed sample');
  ok((await refusals(page)).some((t) => /payload_capability/.test(t)), 'the sample cannot send any payload');
  ok(Math.abs(num(await tileVal(page, 'Propellant needed')) - 13935) < 1, 'the sample needs 13,935 kg');
  await page.fill('#importText', '{"handoff": "long-way-round", "from": "37-win'); await page.click('#importBtn');
  ok(/Refused/.test(await page.locator('#status').innerText()), 'garbage refused');
  await page.fill('#importText', JSON.stringify(H36)); await page.click('#importBtn');
  ok(/idea 37/.test(await page.locator('#status').innerText()), 'idea 36\'s handoff refused, pointing at idea 37');
  const h37e = JSON.parse(JSON.stringify(H37)); h37e.outputs.departure_point.value.r_m[0] += 50;
  await page.fill('#importText', JSON.stringify(h37e)); await page.click('#importBtn');
  ok(/not self-consistent/.test(await page.locator('#status').innerText()), 'an edited idea 37 handoff refused');
  // Apollo 17 preset and its engines
  await page.click('#preApollo'); await settle(page);
  ok(/^Replayed/.test(await page.locator('#verdict').innerText()), 'Apollo replay verdict');
  ok(await page.locator('#twIn').isDisabled(), 'thrust is the flight\'s in the replay');
  ok(await page.locator('[data-n="2"]').isDisabled(), 'one burn only in the replay');
  ok(Math.abs(num(await tileVal(page, 'Thrust-to-weight')) - kAp.sc.tw0) < 0.0006 && Math.abs(kAp.sc.tw0 - B.apollo17Engine().meanF / (139750 * B.G0)) < 1e-9, 'Apollo T/W at the burn\'s mean thrust (the sweep\'s engine)');
  await page.selectOption('#apEngine', 'chain'); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'Burn time')) - 301.98) < 0.06, 'the chain\'s J-2 burns 302 s: ' + await tileVal(page, 'Burn time'));
  await noNaN(page, 'Apollo');
  // your own: a weak engine refused, a bad altitude refused
  await page.click('#preCustom'); await settle(page);
  ok(/^Refused: this departure needs 67,2\d\d kg/.test(await page.locator('#verdict').innerText()), 'custom starts from the chain\'s numbers, so it is short as the chain is: ' + (await page.locator('#verdict').innerText()).slice(0, 60));
  await setNum(page, '#cPay', 25000);
  ok(/^Departs/.test(await page.locator('#verdict').innerText()), 'custom with 25 t departs');
  await setNum(page, '#cThrust', 2);
  ok((await refusals(page)).some((t) => /burn_length/.test(t)), 'a 2 kN engine is refused (burn too long): ' + (await refusals(page)).join(' | ').slice(0, 200));
  await setNum(page, '#cThrust', 1023); await setNum(page, '#cAlt', 50);
  ok((await refusals(page)).some((t) => /invalid_input/.test(t) && /altitude/.test(t)), 'a 50 km orbit refused: ' + (await refusals(page)).join(' | ').slice(0, 300) + ' / verdict ' + (await page.locator('#verdict').innerText()).slice(0, 100));
  await noNaN(page, 'custom refused');
  await setNum(page, '#cAlt', 300);
  ok(/^Refused|^Departs/.test(await page.locator('#verdict').innerText()), 'custom recovers');
  // added by the independent review: a bound target does not "depart"; a stage whose finite-burn loss eats the impulsive
  // margin shows no capability (it showed 0 kg); an engine that cannot reach the C3 says so without NaN
  await setNum(page, '#cPay', 20000); await setNum(page, '#cC3', -5);
  ok(/^Reaches C3 -?\d/.test(await page.locator('#verdict').innerText()) && /bound orbit/.test(await page.locator('#verdict').innerText()), 'a bound target reaches a bound orbit, not a departure: ' + (await page.locator('#verdict').innerText()).slice(0, 90));
  ok((await tileVal(page, 'C3 reached (bound)')) !== null && (await tileVal(page, 'C3 at infinity')) === null, 'its C3 tile is not "at infinity"');
  await setNum(page, '#cC3', 10); await setNum(page, '#cIsp', 51);
  ok((await refusals(page)).some((t) => /targeting/.test(t) && /2 % of its ignition mass/.test(t)), 'an engine that cannot reach the C3 is refused in words: ' + (await refusals(page)).join(' | ').slice(0, 200));
  await noNaN(page, 'custom unreachable');
  const sc0 = B.customScenario({ altitudeKm: 300, inclinationDeg: 0, c3: 1e6, inertKg: 1, propellantKg: 5e4, payloadKg: 1, thrustN: 3e4, veMS: 450 * B.G0, j2: true }, B.defaults());
  const inertTight = Math.round(5e4 / (Math.exp(sc0.dvImp / (450 * B.G0)) - 1) - 50);
  await setNum(page, '#cIsp', 450); await setNum(page, '#cC3', 1); await setNum(page, '#cProp', 50000); await setNum(page, '#cInert', inertTight); await setNum(page, '#cPay', 1000); await setNum(page, '#cThrust', 30);
  ok((await tileVal(page, 'Payload the stage can send')) === 'none', 'the finite-burn loss eats a 50 kg impulsive margin: no capability, not 0 kg (' + await tileVal(page, 'Payload the stage can send') + ')');
  ok((await refusals(page)).some((t) => /payload_capability/.test(t)), 'with its payload_capability refusal');
  await noNaN(page, 'custom tight');
  ok(errors.length === 0, 'desktop: no console errors: ' + errors.slice(0, 3).join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png'), fullPage: true });
  await context.close();
}

// ------------------------------------------------------------------ links in both directions
{
  const set = Object.assign(B.defaults(), { payloadKg: 25000 }), R = B.compute({ window: ST }, set), h38 = B.makeHandoff({ window: ST }, set, R, { produced: '2026-10-31T12:00:00Z' });
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(h38));
  await settle(page);
  ok(/Imported this page/.test(await page.locator('#status').innerText()), 'opens on its own #h= link');
  ok(Math.abs(num(await page.locator('#payIn').inputValue()) - 25000) < 1, 'with the link\'s payload');
  await context.close();
  const o2 = await open(DESK, URL0 + '#h=' + b64(L.WIN));
  await settle(o2.page);
  ok(/Imported idea 37/.test(await o2.page.locator('#status').innerText()), 'opens on idea 37\'s #h= link');
  ok(Math.abs(num(await tileVal(o2.page, 'Finite-burn (gravity) loss')) - k0.sol.loss) < 0.006, 'and burns it as the default does');
  const bad = JSON.parse(JSON.stringify(h38)); bad.outputs.finite_burn_loss.value.loss_m_s += 1;
  const o3 = await open(DESK, URL0 + '#h=' + b64(bad));
  ok(/Refused/.test(await o3.page.locator('#status').innerText()), 'an edited link refused');
  ok(errors.length + o2.errors.length + o3.errors.length === 0, 'links: no console errors');
  await o2.context.close(); await o3.context.close();
}

// ------------------------------------------------------------------ phone, light and dark
for (const scheme of ['light', 'dark']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  await settle(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, scheme + ' phone: no horizontal overflow (' + over + ' px)');
  const minText = await page.evaluate(() => Math.min(...[...document.querySelectorAll('svg.chartsvg text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0)));
  ok(minText >= 11, scheme + ' phone: chart text at least 11 px (' + minText.toFixed(1) + ')');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? /rgb\(13, 13, 13\)/.test(bg) : /rgb\(249, 249, 247\)/.test(bg), scheme + ' background ' + bg);
  await page.locator('[data-steer="optimal"]').tap(); await settle(page);
  ok(Math.abs(num(await tileVal(page, 'Finite-burn (gravity) loss')) - kOpt.sol.loss) < 0.006, scheme + ' phone: tap changes the law');
  await page.locator('#twChart').scrollIntoViewIfNeeded();
  const box = await page.locator('#twChart').boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.5); await settle(page);
  ok(num(await tileVal(page, 'Thrust-to-weight')) < 0.5, scheme + ' phone: a tap on the chart sets T/W');
  await noNaN(page, scheme + ' phone');
  ok(errors.length === 0, scheme + ' phone: no console errors: ' + errors.slice(0, 3).join(' | '));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-' + scheme + '.png'), fullPage: true });
  await context.close();
}

await browser.close();
console.log((failures ? 'FAILED ' : 'ok ') + (checks - failures) + '/' + checks + ' UI checks');
process.exit(failures ? 1 : 0);
