#!/usr/bin/env node
// Drives the Catch page in headless Chromium (desktop by mouse and keys, phone by touch, light and dark) and compares its
// numbers with the kernel's. From the bank root: node ideas/48-catch/ui-check.mjs (about a minute).
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const K = L.K;
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/,/g, '').replace(/[^0-9.eE+-]/g, ' ').trim().split(/\s+/)[0]);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SAMPLE = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H47 = JSON.stringify(L.chain()), H46 = fs.readFileSync(path.join(here, '..', '46-split', 'handoff.json'), 'utf8');
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const seq = (page) => page.evaluate(() => window.CatchPage.state.seq);
async function waitRun(page, before) { await page.waitForFunction((b) => window.CatchPage.state.seq > b, before, { timeout: 90000 }); }
async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.CatchPage && window.CatchPage.state.seq > 0 && window.CatchPage.state.sweep, null, { timeout: 90000 });
  return { context, page, errors };
}
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '', s: (t.querySelector('.sub') || {}).textContent || '', cls: t.className }])));
const verdicts = (page) => page.$$eval('#optTable tr.opt', (rs) => Object.fromEntries(rs.map((r) => [r.dataset.opt, r.querySelector('.chip').textContent])));
const drawn = (page, id) => page.$eval('#' + id, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
async function act(page, fn) { const b = await seq(page); await fn(); await waitRun(page, b); }
async function setNum(page, id, v) { await act(page, async () => { await page.fill('#' + id, String(v)); await page.press('#' + id, 'Tab'); }); }
async function sweepDone(page) { await page.waitForFunction(() => window.CatchPage.state.sweepKey !== null && window.CatchPage.state.sweep, null, { timeout: 60000 }); await page.waitForTimeout(100); }

const RC = K.run(K.defaults(), null);
const RD = K.run(Object.assign(K.defaults(), { choice: 'direct' }), null);
const R5 = K.run(Object.assign(K.defaults(), { gLimit: 5 }), null);

// ------------------------------------------------------------------------------------------- the chain, desktop
{
  const { context, page, errors } = await open(DESK);
  let V = await verdicts(page);
  for (const k of ['direct', 'skip', 'aerocapture', 'propulsive', 'lunar', 'skyhook']) ok((V[k].includes('feasible') && !V[k].includes('energy')) === !!RC.options[k].feasible, `verdict ${k}: ${V[k]} vs kernel ${RC.options[k].feasible}`);
  ok(await page.$eval('#optTable tr.opt.hl', (r) => r.dataset.opt) === RC.choice, 'the handed-on row is the kernel\'s choice (' + RC.choice + ')');
  ok(/Skip entry/.test(await page.textContent('#choiceLine')), 'choice line names the skip entry');
  let T = await tiles(page);
  ok(close(num(T['Entry speed'].v), RC.entry.speed_inertial_m_s / 1000, 0.0006), 'entry speed tile ' + T['Entry speed'].v);
  ok(close(num(T['Entry angle'].v), RC.entry.fpa_inertial_deg, 0.006), 'entry angle tile ' + T['Entry angle'].v);
  ok(close(num(T['Peak deceleration'].v), RC.options.skip.loads.peak_g, 0.06), 'peak g tile ' + T['Peak deceleration'].v);
  ok(close(num(T['Aim perigee'].v), RC.retarget.perigee_alt_m / 1000, 0.06), 'aim perigee tile ' + T['Aim perigee'].v);
  ok(T['Entry speed'].c === 'derived' && T['Mass in the air'].c === 'assumed', 'confidence chips');
  const refs = await page.$$eval('#refusals .refusal b', (bs) => bs.map((b) => b.textContent));
  ok(refs.some((t) => /retarget/.test(t)) && refs.some((t) => /radiative_heating/.test(t)) && refs.some((t) => /tps_mass/.test(t)), 'own refusals shown: ' + refs.join(' | '));
  ok(/\(36\)/.test(await page.textContent('#carriedSum')), 'idea 47\'s 36 refusals carried');
  // a row opens its refusals
  await page.click('#optTable tr.opt[data-opt="propulsive"]');
  ok(!(await page.$eval('tr.optref[data-for="propulsive"]', (r) => r.classList.contains('hide'))) && /6,780|6780/.test(await page.textContent('tr.optref[data-for="propulsive"]')), 'propulsive row opens its refusal with the propellant');
  await sweepDone(page);
  for (const id of ['gChart', 'apoChart', 'passChart', 'loadChart', 'vinfChart']) ok(await drawn(page, id) > 2000, id + ' drawn');
  ok(/5\.69° wide/.test(await page.textContent('#gCap')), 'corridor caption: ' + (await page.textContent('#gCap')).slice(0, 80));
  ok(/2 passes/.test(await page.textContent('#passCap')), 'skip pass caption');
  // reality table, live from the kernel
  const rows = await page.$$eval('#checkTable tbody tr', (rs) => rs.map((r) => Array.from(r.cells).map((c) => c.textContent)));
  const X = K.reality();
  ok(rows.length === X.rows.length, 'reality rows ' + rows.length);
  ok(close(num(rows[0][2]), X.rows[0].model, 0.006) && /-0\.34 %/.test(rows[0][3]), 'Stardust row: ' + rows[0].join(' / '));
  ok(rows[0][1].startsWith('32.89'), 'NASA\'s figure at its own precision: ' + rows[0][1]);
  ok(rows[2][1].startsWith('27.0 '), 'Genesis\'s 27.0 g kept at its precision (review): ' + rows[2][1]);
  // review: the skip row shows its own corridor at bank 90, not the aerocapture corridor
  const skipRow = await page.textContent('#optTable tr.opt[data-opt="skip"] td[data-k="Corridor"]');
  ok(/skips from/.test(skipRow) && skipRow.includes(RC.options.skip.corridor.width_deg.toFixed(2)), 'skip row: its own corridor ' + skipRow);
  // review: under auto (the skip handed on) a tap on the corridor chart sets the direct entry's angle and the chart shows it
  const pix = () => page.$eval('#gChart', (c) => c.toDataURL());
  const before = await pix();
  const gb = await page.$eval('#gChart', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await act(page, () => page.mouse.click(gb.x + 46 + (gb.w - 58) * (8 / 14), gb.y + gb.h / 2));   // -10 deg
  await sweepDone(page); await page.waitForTimeout(300);
  ok(close(await page.evaluate(() => window.CatchPage.state.S.fpaDeg), -10, 0.06) && (await pix()) !== before, 'auto: a tap moves the direct entry\'s marker on the chart');
  ok(/direct entry's angle/.test(await page.textContent('#gCap')), 'caption says what a tap sets');
  await setNum(page, 'fpaIn', '');
  ok(!rows.some((r) => /NaN|undefined/.test(r.join(''))), 'no NaN in the reality table');
  // choose direct
  await act(page, () => page.click('[data-choice="direct"]'));
  T = await tiles(page);
  ok(close(num(T['Peak deceleration'].v), RD.options.direct.loads.peak_g, 0.06), 'direct: peak g tile ' + T['Peak deceleration'].v + ' vs ' + RD.options.direct.loads.peak_g);
  ok(close(num(T['Entry angle'].v), RD.options.direct.gamma, 0.006), 'direct: mid-corridor angle');
  // tap the corridor chart: an angle; arrow keys move it
  await sweepDone(page);
  const box = await page.$eval('#gChart', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await act(page, () => page.mouse.click(box.x + 46 + (box.w - 58) * (7 / 14), box.y + box.h / 2));   // -2 - 7 = -9 deg
  let S = await page.evaluate(() => window.CatchPage.state.S.fpaDeg);
  ok(close(S, -9, 0.06), 'tap sets the entry angle near -9: ' + S);
  await page.focus('#gChart');
  await act(page, () => page.keyboard.press('ArrowRight'));
  const S2 = await page.evaluate(() => window.CatchPage.state.S.fpaDeg);
  ok(close(S2, S - 0.05, 1e-9), 'ArrowRight steepens by 0.05: ' + S2);
  const R9 = K.run(Object.assign(K.defaults(), { choice: 'direct', fpaDeg: S2 }), null);
  T = await tiles(page);
  ok(close(num(T['Peak deceleration'].v), R9.options.direct.loads.peak_g, 0.06), 'tapped angle: peak g tile equals the kernel ' + R9.options.direct.loads.peak_g);
  // a 5 g limit (the TransHab crew study): nothing feasible, nothing handed on, export says why
  await act(page, () => page.click('[data-choice="auto"]'));
  await setNum(page, 'fpaIn', '');
  await setNum(page, 'gIn', 5);
  ok(R5.choice === null && /Nothing is handed on/.test(await page.textContent('#choiceLine')), 'at 5 g nothing is handed on');
  V = await verdicts(page); ok(/refused/.test(V.direct) && /refused/.test(V.skip), '5 g: direct and skip refused');
  // an emptied limit is refused, not read as zero
  await setNum(page, 'gIn', '');
  ok(/invalid_input/.test(await page.textContent('#refusals')) && (await page.$$('.tile')).length === 0, 'emptied g limit: refused, tiles cleared');
  await page.click('#copyBtn'); await page.waitForTimeout(150);
  ok(/Nothing to export/.test(await page.textContent('#hoStatus')), 'export says why');
  await act(page, () => page.click('#resetBtn'));
  ok(await page.evaluate(() => window.CatchPage.state.S.gLimit) === 40, 'reset');
  // Stardust as flown
  await act(page, () => page.click('[data-arr="stardust"]'));
  V = await verdicts(page); ok(/refused/.test(V.aerocapture) && /feasible/.test(V.direct), 'Stardust: no aerocapture without lift; direct entry works');
  ok(/45\.8|46 kg/.test(await page.textContent('#srcLine')), 'Stardust\'s mass in the source line');
  // your v-infinity: tap the v-infinity chart at about 3.6 km/s
  await act(page, () => page.click('[data-arr="chain"]'));
  const vb = await page.$eval('#vinfChart', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await act(page, () => page.mouse.click(vb.x + 52 + (vb.w - 64) * (3.613 / 8), vb.y + vb.h / 2));
  const cu = await page.evaluate(() => window.CatchPage.state.S);
  ok(cu.arrival === 'custom' && close(cu.custom.vinf_m_s, 3613, 25), 'v-infinity chart tap makes your arrival: ' + cu.custom.vinf_m_s);
  await setNum(page, 'vinfIn', 0);
  ok(/invalid_input/.test(await page.textContent('#refusals')) && /parabola/.test(await page.textContent('#refusals')) && (await page.$$('.tile')).length === 0, 'v-infinity 0 refused, no tiles (review: it used to fly a state at the Earth\'s centre)');
  await setNum(page, 'vinfIn', 3.6127); await setNum(page, 'massIn', 4000);
  V = await verdicts(page); ok(/energy only/.test(V.skyhook), 'at v-infinity* and 4 t the Skyhook is energy-matched (plane and phase refused): ' + V.skyhook);
  // handoff: download reads back in Node
  await act(page, () => page.click('[data-arr="chain"]'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const dlText = fs.readFileSync(await dl.path(), 'utf8');
  ok(!K.parseHandoff(dlText).refusal, 'the browser\'s download reads back in Node');
  // imports
  const imp = async (t) => { await page.fill('#importText', t); await page.click('#importBtn'); await page.waitForTimeout(300); return page.textContent('#hoStatus'); };
  ok(/Refused/.test(await imp('garbage')), 'garbage refused');
  ok(/Refused/.test(await imp(H46)), 'idea 46\'s handoff refused (not an arrival)');
  const ed = JSON.parse(SAMPLE); ed.outputs.screening.value.peak_g += 1;
  ok(/Refused/.test(await imp(JSON.stringify(ed))), 'edited handoff refused');
  ok(/read back/.test(await imp(SAMPLE)), 'the sample reads back');
  ok(/accepted/.test(await imp(H47)), 'idea 47\'s handoff accepted');
  ok(errors.length === 0, 'desktop: no console errors ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------------------------------- links
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(SAMPLE));
  ok(/read back/.test(await page.textContent('#hoStatus')), '#h= with this page\'s sample');
  const { context: c2, page: p2 } = await open(DESK, URL0 + '#h=' + b64(H47));
  ok(/accepted/.test(await p2.textContent('#hoStatus')), '#h= with idea 47\'s handoff');
  ok(errors.length === 0, 'links: no console errors');
  await context.close(); await c2.close();
}

// ------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), scheme + ' phone: no horizontal overflow');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg === 'rgb(13, 13, 13)' : bg === 'rgb(249, 249, 247)', scheme + ' background ' + bg);
  const small = await page.$$eval('body *', (els) => els.filter((e) => e.offsetParent && e.childNodes.length && Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.tagName + '.' + e.className));
  ok(small.length === 0, scheme + ': no text under 11 px ' + small.slice(0, 5).join(','));
  await sweepDone(page);
  for (const id of ['gChart', 'passChart', 'vinfChart']) ok(await drawn(page, id) > 1000, scheme + ' phone: ' + id + ' drawn');
  const box = await page.$eval('#gChart', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await act(page, () => page.touchscreen.tap(box.x + 46 + (box.w - 58) * 0.5, box.y + box.h / 2));
  ok(close(await page.evaluate(() => window.CatchPage.state.S.fpaDeg), -9, 0.3), scheme + ' phone: a tap chooses an angle');
  ok(!/NaN/.test(await page.textContent('main')), scheme + ' phone: no NaN on the page');
  ok(errors.length === 0, scheme + ' phone: no console errors ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
