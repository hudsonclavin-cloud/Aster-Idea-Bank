#!/usr/bin/env node
// Drives The Long Way Round's page in headless Chromium (desktop by mouse, phone by touch, light and dark) and compares
// what it shows with mission.js on the same bundle. From the bank root: node ideas/50-the-long-way-round/ui-check.mjs
// (about 30 s). Uses the globally installed Playwright, as tools/smoke.mjs does; check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const IDEAS = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'mission.js'));
const D = require(path.join(here, 'snapshots/missions.js'));
const K = M.create({ aster: require(path.join(here, 'snapshots/aster.js')), ledger47: require(path.join(here, 'snapshots/home-ledger.js')), isa: require(path.join(here, 'snapshots/isa.js')), nhats: require(path.join(here, 'snapshots/nhats.js')) });
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => { const t = String(s).replace(/,/g, ''); const m = /-?[0-9.]+(e[+-]?\d+)?/i.exec(t); if (!m) return NaN; let v = parseFloat(m[0]); if (/\d\s*t\b/.test(t) && !/kg/.test(t)) v *= 1000; return v; };
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mis = (key) => M.mission(M.unpack(D, key));

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.LWRpage && document.querySelectorAll('.tile').length > 0, null, { timeout: 30000 });
  return { context, page, errors };
}
const tiles = (page, sel = '#tiles') => page.$$eval(sel + ' .tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').firstChild.textContent.trim(), { v: t.querySelector('.v').textContent, s: (t.querySelector('.s') || {}).textContent || '', chip: (t.querySelector('.chip') || {}).textContent || '', refused: t.querySelector('.v').classList.contains('refused') }])));
async function pick(page, rocket, prop, ast) {
  await page.selectOption('#rocket', rocket);
  if (prop && !(await page.$eval('#propellant', (e) => e.disabled))) await page.selectOption('#propellant', prop);
  if (ast && !(await page.$eval('#asteroid', (e) => e.disabled))) await page.selectOption('#asteroid', ast);
}

// ------------------------------------------------------------------------------------------- the default mission, desktop
{
  const { context, page, errors } = await open(DESK);
  const m = mis('chain|lox-rp1|99942'), L = m.record.links;
  let T = await tiles(page);
  ok(close(num(T['Liftoff mass'].v), L[34].v.liftoff_kg, 1e-3), 'liftoff tile ' + T['Liftoff mass'].v);
  ok(close(num(T['Spacecraft at launch'].v), L[42].v.launch_kg, 1e-4), 'spacecraft tile ' + T['Spacecraft at launch'].v);
  ok(/short/.test(T['Earth departure'].v) && close(num(T['Earth departure'].v), L[38].v.prop_short_kg, 1e-3), 'departure short tile ' + T['Earth departure'].v);
  ok(close(num(T['Material home'].v), L[47].v.material_kg, 1e-4), 'material tile');
  ok(close(num(T['Landed'].v), L[49].v.landed_kg, 1e-4), 'landed tile');
  ok(num(T['Refusals carried'].v) === m.refusals.length, 'refusal count tile');
  ok(Object.values(T).every((t) => t.chip), 'every tile has a confidence chip');
  const v = await page.$eval('#verdict', (e) => ({ cls: e.className, text: e.textContent }));
  ok(/open/.test(v.cls) && /does not close/.test(v.text) && /runs dry/.test(v.text), 'verdict: lands but does not close, the departure named');
  ok(await page.$$eval('#massChart circle', (c) => c.length) === 9, 'nine masses on the mass chart');
  ok(await page.$$eval('#dvChart rect[fill="url(#hatch)"]', (r) => r.length) === m.deltaV.filter((d) => !d.flown).length, 'unflown burns hatched');
  ok(await page.$$eval('#timeChart circle', (c) => c.length) === m.events.length, 'every event on the timeline');
  ok(await page.$$eval('#seams tr', (r) => r.length) === m.seams.length + 1, 'every seam in the table');
  ok(await page.$$eval('#refusals .ref', (r) => r.length) === m.refusals.length, 'every refusal listed');
  await page.check('#blockingOnly');
  ok(await page.$$eval('#refusals .ref', (r) => r.length) === m.refusals.filter((r) => r.blocking).length, 'blocking filter');
  await page.uncheck('#blockingOnly');
  await page.selectOption('#phase', 'return');
  ok(await page.$$eval('#refusals .ref', (r) => r.length) === m.refusals.filter((r) => r.phase === 'return').length, 'phase filter');
  await page.selectOption('#phase', '');
  // hovering the mass chart reads a source
  await page.hover('#massChart circle >> nth=3');
  ok(/idea|ideas\//.test(await page.$eval('#tip', (e) => e.textContent)), 'hover reads the source');
  await page.click('#massChart circle >> nth=0');
  ok(/34-stack/.test(await page.$eval('#massRead', (e) => e.textContent)), 'tap reads the source');
  // the what-if at the chain's settings equals the chain; moving the dry mass moves the kernel's numbers
  let W = await tiles(page, '#whatTiles');
  ok(close(num(W['Spacecraft at launch'].v), L[42].v.launch_kg, 1e-4), 'what-if launch mass = idea 42');
  ok(close(num(W['Material home'].v), L[47].v.material_kg, 1e-4), 'what-if material = idea 47');
  ok(close(num(W['Main parachute'].v), L[49].v.main_cds_m2, 1e-3), 'what-if parachute = idea 49');
  ok(W['Launcher can send'].refused, 'the chain\'s rocket: capability refused');
  await page.fill('#dryNum', '1200'); await page.press('#dryNum', 'Tab');
  W = await tiles(page, '#whatTiles');
  const c12 = K.closure(m, { dry_kg: 1200 });
  ok(close(num(W['Spacecraft at launch'].v), c12.outbound.launch_kg, 1e-4), 'dry 1200: launch mass ' + W['Spacecraft at launch'].v + ' vs ' + c12.outbound.launch_kg);
  ok(close(num(W['Material home'].v), c12.home.material_kg, 1e-4), 'dry 1200: material');
  ok(await page.$$eval('#massChart path[stroke-dasharray]', (p) => p.length) === 1, 'the what-if drawn dashed');
  await page.selectOption('#launcher', '0');
  W = await tiles(page, '#whatTiles');
  const cfh = K.closure(m, { dry_kg: 1200, launcher: 0 });
  ok(close(num(W['Launcher can send'].v), cfh.launch.capability_kg, 5e-4) && /\+/.test(W['Launch margin'].v), 'Falcon Heavy at this C3 ' + W['Launcher can send'].v + ' (4 figures shown)');
  ok(/carry the/.test(await page.$eval('#lvRead', (e) => e.textContent)), 'launcher readout');
  await page.check('#tag');
  W = await tiles(page, '#whatTiles');
  ok(/paid/.test(W['Touch and go'].v), 'touch-and-go paid when sized in');
  await page.fill('#dryNum', '5'); await page.press('#dryNum', 'Tab');
  ok(/must be 10 to 50,000 kg/.test(await page.$eval('#whatRefusals', (e) => e.textContent)), 'a 5 kg spacecraft refused');
  ok(!/NaN/.test(await page.$eval('main', (e) => e.textContent)), 'no NaN after a refused input');
  await page.click('#resetWhat');
  W = await tiles(page, '#whatTiles');
  ok(close(num(W['Spacecraft at launch'].v), L[42].v.launch_kg, 1e-4), 'reset to the chain\'s');
  // NHATS table and lead
  const st = K.nhatsStats(K.nhatsCompare(require(path.join(here, 'snapshots/nhats-chain.js'))));
  ok(await page.$$eval('#nhats tr', (r) => r.length) === st.inside.total.n + 1, 'NHATS rows inside the envelope');
  ok((await page.$eval('#nhatsLead', (e) => e.textContent)).includes(M.fmt(st.inside.total.median, 3) + ' m/s'), 'NHATS median stated');
  await page.check('#nhatsAll');
  ok(await page.$$eval('#nhats tr', (r) => r.length) === 62, 'all 61 NHATS rows');
  // the matrix: one button per flown mission, the current one marked
  ok(await page.$$eval('#matrix button', (b) => b.length) === D.runs.length, 'a button per mission flown');
  ok(await page.$$eval('#matrix button.cur', (b) => b.length) === 1, 'the current mission marked');
  // switch: AS-512 carrying the spacecraft departs; tag sized in closes it
  await pick(page, 'as512-sc', null, '99942');
  T = await tiles(page);
  ok(/to spare/.test(T['Earth departure'].v), 'AS-512 with the spacecraft departs');
  ok(await page.$eval('#propellant', (e) => e.disabled), 'propellant disabled for AS-512');
  ok(/touch-and-go/.test(await page.$eval('#verdict', (e) => e.textContent)), 'its one break is the touch-and-go');
  await page.check('#tag');
  ok(/every budget closes/.test(await page.$eval('#whatRefusals', (e) => e.textContent)), 'the what-if closes it');
  // an asteroid where the chain stops
  await pick(page, 'as512-sc', null, '162173');
  const vt = await page.$eval('#verdict', (e) => ({ cls: e.className, text: e.textContent }));
  ok(/halts/.test(vt.cls) && /idea 43/.test(vt.text), 'Ryugu stops at idea 43');
  T = await tiles(page);
  ok(T['Landed'].refused && /stops at idea 43/.test(T['Landed'].s), 'its landed mass refused with the reason');
  ok(/No shape model/.test(await page.$eval('#refusals', (e) => e.textContent)), 'the halt\'s refusal listed');
  // a combination that was not flown
  await pick(page, 'chain', 'lox-lh2', '433');
  ok(/Not flown/.test(await page.$eval('#verdict', (e) => e.textContent)) && /run-chain\.mjs --rocket chain --propellant lox-lh2 --asteroid "433"/.test(await page.$eval('#verdict', (e) => e.textContent)), 'not flown: refused with the command');
  ok(!/NaN/.test(await page.$eval('main', (e) => e.textContent)), 'no NaN when refused');
  // export, download, read back in Node
  await pick(page, 'chain', 'lox-ch4', '99942');
  const dl = page.waitForEvent('download'); await page.click('#exportDownload'); const d = await dl;
  const got = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
  const back = M.parseHandoff(got);
  ok(back.own && back.mission.key === 'chain|lox-ch4|99942', 'the browser\'s download reads back in Node');
  // imports: garbage, a foreign module, idea 49's committed handoff (walked, digest resolved)
  await page.fill('#importText', 'not json'); await page.click('#importBtn');
  ok(/Refused/.test(await page.$eval('#ioMsg', (e) => e.textContent)), 'garbage refused');
  await page.fill('#importText', fs.readFileSync(path.join(IDEAS, '19-caliper-ledger/README.md'), 'utf8').slice(0, 50)); await page.click('#importBtn');
  ok(/Refused/.test(await page.$eval('#ioMsg', (e) => e.textContent)), 'non-handoff refused');
  await page.fill('#importText', fs.readFileSync(path.join(IDEAS, '49-hot-return/handoff.json'), 'utf8')); await page.click('#importBtn');
  const io = await page.$eval('#ioMsg', (e) => e.textContent);
  ok(/31 to 49/.test(io) && /resolved/.test(io), 'idea 49\'s committed handoff walked to 31: ' + io.slice(0, 160));
  ok(await page.$$eval('#links tr', (r) => r.length) === 20, 'nineteen links');
  ok(/12,792|12,790|12,79/.test(await page.$eval('#verdict', (e) => e.textContent)), 'the walked chain names the departure shortfall');
  // the page's own SHA-256 agrees with node:crypto (it resolves digests)
  for (const s of ['', 'abc', 'é€'.repeat(40), 'x'.repeat(55), 'y'.repeat(64)]) ok(await page.evaluate((x) => window.LWRsha256(x), s) === crypto.createHash('sha256').update(s).digest('hex'), 'sha256 of ' + JSON.stringify(s.slice(0, 8)));
  ok(errors.length === 0, 'no console errors (desktop): ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------------------------------- links
{
  const h = M.makeHandoff(mis('as512-sc|-|99942'), { produced: '2026-11-02T00:00:00Z' });
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(JSON.stringify(h)));
  ok(await page.$eval('#rocket', (e) => e.value) === 'as512-sc', '#h= link opens on its mission');
  const h49 = fs.readFileSync(path.join(IDEAS, '49-hot-return/handoff.json'), 'utf8');
  await page.goto(URL0 + '#h=' + b64(h49)); await page.waitForFunction(() => document.querySelectorAll('.tile').length > 0);
  ok(/Imported/.test(await page.$eval('#rocketNote', (e) => e.textContent)), 'a #h= link with idea 49\'s handoff is walked');
  ok(errors.length === 0, 'no console errors (links): ' + errors.join(' | '));
  await context.close();
}

// ------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, scheme + ': no horizontal overflow at 390 px (' + over + ')');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? /rgb\(21, 23, 27\)/.test(bg) : /rgb\(246, 245, 241\)/.test(bg), scheme + ' background ' + bg);
  const small = await page.$$eval('svg text', (ts) => ts.filter((t) => { const r = t.getBoundingClientRect(); return r.height > 0 && parseFloat(getComputedStyle(t).fontSize) < 11; }).length);
  ok(small === 0, scheme + ': no chart text under 11 px (' + small + ')');
  const tiny = await page.$$eval('body *', (es) => es.filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(e).fontSize) < 11).length);
  ok(tiny === 0, scheme + ': no text under 11 px (' + tiny + ')');
  for (const id of ['massChart', 'dvChart', 'timeChart', 'lvChart']) ok(await page.$$eval('#' + id + ' svg *', (e) => e.length) > 10, scheme + ': ' + id + ' drawn');
  await page.tap('#massChart circle >> nth=5');
  ok(/ideas\//.test(await page.$eval('#massRead', (e) => e.textContent)), scheme + ': a tap reads the mass chart');
  await page.tap('#matrix button >> nth=19');
  ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, scheme + ': no overflow after switching mission');
  ok(!/NaN|undefined/.test(await page.$eval('main', (e) => e.textContent)), scheme + ': no NaN or undefined');
  ok(errors.length === 0, scheme + ': no console errors: ' + errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(failures ? failures + ' of ' + checks + ' checks failed' : 'all ' + checks + ' checks pass');
process.exit(failures ? 1 : 0);
