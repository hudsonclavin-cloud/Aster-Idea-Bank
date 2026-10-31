#!/usr/bin/env node
// Drives the Closing In page in headless Chromium as a person would (desktop by mouse, phone by touch, light and dark)
// and compares its numbers with the kernel's. Run from the bank root: node ideas/42-closing-in/ui-check.mjs
// Uses the globally installed Playwright, as tools/smoke.mjs does. check.mjs runs it for tools/check.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, sample41 } = require(path.join(here, 'load.cjs'));
const URL0 = pathToFileURL(path.join(here, 'index.html')).href;
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'))('playwright'); }
const browser = await pw.chromium.launch();
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SAMPLE = fs.readFileSync(path.join(here, 'handoff.json'), 'utf8');
const H41 = JSON.stringify(sample41()), H40 = fs.readFileSync(path.join(here, '..', '40-long-coast', 'handoff.json'), 'utf8');

async function open(opts, url = URL0, scheme = 'light') {
  const context = await browser.newContext({ ...opts, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#checkTable tbody tr').length > 0, null, { timeout: 30000 });
  return { context, page, errors };
}
const settle = (page) => page.waitForTimeout(450);
const tiles = (page) => page.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, c: (t.querySelector('.c') || {}).textContent || '' }])));
const refusals = (page) => page.$$eval('#refusals .refusal b', (bs) => bs.map((b) => b.textContent));
async function canvasesDrawn(page) {
  return page.$$eval('canvas.chart', (cs) => cs.map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / (d.length / 4); }));
}

// ------------------------------------------------------------------------------------------- desktop, the chain
{
  const { context, page, errors } = await open(DESK);
  const R = K.run(K.importSignal(sample41()), K.defaults()), T = await tiles(page);
  ok(T['First braking burn'] && Math.abs(num(T['First braking burn'].v) - R.burns[0].dv_m_s) < 1, 'AAM-1 dv tile ' + JSON.stringify(T['First braking burn']));
  ok(Math.abs(num(T['Approach, all burns'].v) - R.mass.burns_dv_m_s) < 0.1, 'approach dv tile');
  ok(Math.abs(num(T['Propellant needed'].v) - R.mass.required_propellant_kg) < 1 && T['Propellant needed'].c === 'assumed', 'propellant tile');
  ok(T['At stand-off'].v === K.utcOf(R.ap.standoff.t).slice(0, 10), 'stand-off date tile');
  ok(Math.abs(num(T['Hill radius'].v) - R.regimes.hill_radius_m / 1000) < 0.5 && T['Hill radius'].c === 'assumed', 'Hill tile, assumed (Apophis GM is an estimate)');
  ok(Math.abs(num(T['Holding station'].v) - R.hover.dv_per_day_m_s * 1000) < 0.01, 'hover tile');
  ok(Math.abs(num(T['First sight in the camera'].v) - R.detection.leadToFirstBurn_s / 86400) < 0.1, 'first sight tile');
  ok(Math.abs(num(T['Command round trip'].v) - 687.627903 / 60) < 0.05, 'round trip from idea 41');
  const refs = await refusals(page);
  ok(refs.length === 4 && refs.some((r) => /tankage/.test(r)) && refs.some((r) => /gravity field/.test(r)), 'own refusals ' + refs);
  ok(/6 refusals carried/.test(await page.textContent('#carriedSum')), 'six carried refusals');
  const rows = await page.$$eval('#checkTable tbody tr', (rs) => rs.map((r) => r.textContent));
  ok(rows.length === 19 && !rows.some((r) => /NaN|undefined/.test(r)), 'oracle rows ' + rows.length);
  ok(rows.some((r) => /AAM-1 measured/.test(r) && /351\.28/.test(r)), 'AAM-1 measured row');
  ok(rows.some((r) => /Orbital A/.test(r) && /0\.4\d%/.test(r)), 'Orbital A GM row');
  const drawn = await canvasesDrawn(page);
  ok(drawn.length === 5 && drawn.every((x) => x > 0.01), 'five charts drawn ' + drawn.map((x) => x.toFixed(3)));
  ok((await page.$$('#burnTable tbody tr')).length === 7, 'seven burns');
  await page.click('#burnTable tbody tr:nth-child(2)'); await settle(page);
  ok(await page.$eval('#burnTable tbody tr:nth-child(2)', (r) => r.classList.contains('hl')), 'a tapped burn is marked');
  ok(/AAM-2/.test(await page.textContent('#rtCap')), 'its caption names it');
  // as-built tanks: refused, nothing computed
  await page.click('[data-tanks="asbuilt"]'); await settle(page);
  ok((await page.$$('.tile')).length === 0 && /tankage/.test((await refusals(page)).join()), 'as-built tanks refused with no tiles');
  await page.click('[data-tanks="sized"]'); await settle(page);
  // the GM range moves the Hill radius as its cube root
  await page.click('[data-gmcase="max"]'); await settle(page);
  const Rmax = K.run(K.importSignal(sample41()), Object.assign(K.defaults(), { gmCase: 'max' }));
  ok(Math.abs(num((await tiles(page))['Hill radius'].v) - Rmax.regimes.hill_radius_m / 1000) < 0.5, 'Hill radius at GM 4.37');
  await page.click('[data-gmcase="best"]'); await settle(page);
  // a stand-off outside the Hill sphere, typed
  await page.fill('#soIn', '40'); await page.dispatchEvent('#soIn', 'change'); await page.waitForTimeout(700);
  ok((await refusals(page)).some((r) => /standoff/.test(r)), 'stand-off outside the Hill sphere refused');
  // review: a stand-off inside the body is refused with nothing computed (it was flown)
  await page.fill('#soIn', '0.1'); await page.dispatchEvent('#soIn', 'change'); await page.waitForTimeout(700);
  ok((await page.$$('.tile')).length === 0 && /invalid input: standoff/.test((await refusals(page)).join()), 'stand-off inside Apophis refused');
  await page.click('#resetBtn'); await settle(page);
  ok((await page.inputValue('#soIn')) === '18.6', 'reset');
  // review: "From a density" on the chain threw (Apophis's AAS 24-063 range was read when there was none)
  const nErr = errors.length;
  await page.click('[data-gm="density"]'); await settle(page);
  const Td = await tiles(page), Rd = K.run(K.importSignal(sample41()), Object.assign(K.defaults(), { gm: 'density' }));
  ok(errors.length === nErr && Math.abs(num(Td['Hill radius'].v) - Rd.regimes.hill_radius_m / 1000) < 0.5, 'density on the chain computes ' + errors.slice(nErr));
  await page.click('[data-gm="measured"]'); await settle(page);
  // one braking leg, by slider: a different plan
  await page.click('[data-tpl="direct"]'); await settle(page);
  ok((await page.$$('#burnTable tbody tr')).length === 2, 'one leg: two burns');
  await page.click('[data-tpl="orex"]'); await settle(page);
  // the orbit scan
  await page.check('#scanChk'); await page.waitForTimeout(900);
  ok((await page.$$('#scanBox .scan div')).length === 14, 'fourteen orbits scanned');
  await page.uncheck('#scanChk'); await settle(page);
  // custom spacecraft with a big engine and tanks: no tankage refusal
  await page.click('[data-craft="custom"]'); await settle(page);
  for (const [id, v] of [['dryIn', '1000'], ['propIn', '5000'], ['thrIn', '3000'], ['ispIn', '320']]) { await page.fill('#' + id, v); await page.dispatchEvent('#' + id, 'change'); }
  await page.click('[data-tanks="asbuilt"]'); await page.waitForTimeout(700);
  ok(!(await refusals(page)).some((r) => /tankage/.test(r)) && (await page.$$('.tile')).length === 10, 'custom spacecraft with enough propellant');
  await page.click('#resetBtn'); await settle(page);
  // the as-flown case
  await page.click('[data-case="orex2018"]'); await settle(page);
  const Tb = await tiles(page);
  ok(Math.abs(num(Tb['First braking burn'].v) - 351.3) < 0.2, 'OSIRIS-REx AAM-1 from the flown state ' + Tb['First braking burn'].v);
  ok(Tb['At stand-off'].v === '2018-12-03', 'arrives 3 Dec 2018');
  await page.click('[data-case="chain"]'); await settle(page);
  // export: the download is read back by the kernel in Node
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
  const got = fs.readFileSync(await dl.path(), 'utf8'), parsed = K.parseHandoff(got);
  ok(!parsed.refusal && parsed.from === '42-closing-in', 'downloaded handoff parses in Node ' + JSON.stringify(parsed.refusal));
  // imports: idea 41's, idea 40's (refused, pointing at 41), garbage
  await page.fill('#importText', H41); await page.click('#importBtn'); await settle(page);
  ok(/Imported idea 41/.test(await page.textContent('#hoStatus')), 'imports idea 41');
  await page.fill('#importText', H40); await page.click('#importBtn'); await settle(page);
  ok(/idea 41/.test(await page.textContent('#hoStatus')) && (await page.getAttribute('#hoStatus', 'class')).includes('bad'), 'idea 40 refused');
  await page.fill('#importText', '{garbage'); await page.click('#importBtn'); await settle(page);
  ok(/not JSON/.test(await page.textContent('#hoStatus')), 'garbage refused');
  const edited = JSON.parse(SAMPLE); edited.outputs.body.value.GM_m3_s2 = 3;
  await page.fill('#importText', JSON.stringify(edited)); await page.click('#importBtn'); await settle(page);
  ok(/not what its own inputs give/.test(await page.textContent('#hoStatus')), 'edited 42 handoff refused');
  ok(errors.length === 0, 'desktop console errors ' + errors);
  await context.close();
}

// ------------------------------------------------------------------------------------------- links
{
  const { context, page, errors } = await open(DESK, URL0 + '#h=' + b64(SAMPLE));
  ok(/Imported this page/.test(await page.textContent('#hoStatus')), 'a #h= link with this page\'s handoff');
  const { context: c2, page: p2 } = await open(DESK, URL0 + '#h=' + b64(H41));
  ok(/Imported idea 41/.test(await p2.textContent('#hoStatus')), 'a #h= link with idea 41\'s handoff');
  ok(errors.length === 0, 'link console errors ' + errors);
  await context.close(); await c2.close();
}

// ------------------------------------------------------------------------------------------- phone, dark and light
for (const scheme of ['dark', 'light']) {
  const { context, page, errors } = await open(PHONE, URL0, scheme);
  const m = await page.evaluate(() => {
    let small = 0; for (const el of document.querySelectorAll('body *')) { if (!el.childNodes.length || !(el.offsetWidth || el.offsetHeight)) continue; const has = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (has && parseFloat(getComputedStyle(el).fontSize) < 11) small++; }
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bg: getComputedStyle(document.body).backgroundColor, nan: /NaN|undefined/.test(document.querySelector('main').innerText), small };
  });
  ok(m.sw <= m.cw, scheme + ': no horizontal overflow ' + m.sw + '/' + m.cw);
  ok(m.small === 0, scheme + ': no text under 11 px (' + m.small + ')');
  ok(!m.nan, scheme + ': no NaN');
  ok(scheme === 'dark' ? m.bg === 'rgb(13, 13, 13)' : m.bg === 'rgb(249, 249, 247)', scheme + ' background ' + m.bg);
  ok((await canvasesDrawn(page)).every((x) => x > 0.01), scheme + ': charts drawn');
  await page.tap('#burnTable tbody tr:nth-child(1)'); await settle(page);
  ok(await page.$eval('#burnTable tbody tr:nth-child(1)', (r) => r.classList.contains('hl')), scheme + ': a tap marks a burn');
  ok(errors.length === 0, scheme + ' phone console errors ' + errors);
  await context.close();
}

await browser.close();
console.log(failures ? failures + ' of ' + checks + ' UI checks failed' : 'all ' + checks + ' UI checks pass');
process.exit(failures ? 1 : 0);
