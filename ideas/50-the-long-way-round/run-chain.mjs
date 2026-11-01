#!/usr/bin/env node
// The Long Way Round, run whole. Drives the committed kernels of ideas 31 to 49 in order, each through its own loader
// and its own sample recipe (32 to 40: the exported sample() of its build-sample.mjs; 41 to 49: the import, run and
// buildHandoff calls its build script makes), so a mission is launch, ascent, guidance, window, departure burn, transfer,
// cruise, comms, arrival, gravity, touchdown, mining, refuelling, return, capture and re-entry, each by the module that
// owns it, with nothing re-implemented here. What this file adds is the order, the choices and the loop:
//   * a rocket: idea 34's sample stack built on idea 31-33's engine for the propellant you pick ("chain"), the same stack
//     carrying only the spacecraft idea 42 sizes ("chain-sc"), Saturn V AS-512 as flown with its Apollo payload ("as512"),
//     or AS-512 departing with the spacecraft instead ("as512-sc", idea 38's own payload setting: the ascent is not
//     re-flown, so that departure is idea 38's stated lower bound);
//   * the closed loop: the spacecraft mass the rocket carries is the launch mass idea 42 sizes for the arrival this very
//     departure produces, iterated until the two agree;
//   * an asteroid: Apophis takes Aster's own cell (the chain's); any other body of idea 40's six is solved by idea 39
//     first (least delta-v for a sample return), and that transfer's asymptote is handed to idea 37.
// It never writes outside its own folder. Run from the bank root:
//   node ideas/50-the-long-way-round/run-chain.mjs --help
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IDEAS = path.resolve(HERE, '..');
const BANK = path.resolve(IDEAS, '..');
const require = createRequire(import.meta.url);
const M50 = require(path.join(HERE, 'mission.js'));

export const ORDER = ['31-mixture', '32-bell', '33-engine-deck', '34-stack', '35-max-q', '36-closed-loop', '37-window', '38-burn-out', '39-lamberts-road',
  '40-long-coast', '41-signal', '42-closing-in', '43-lumpy', '44-touch-and-go', '45-dig', '46-split', '47-way-home', '48-catch', '49-hot-return'];
// The produced stamps of the committed samples, reused so the default run reproduces them and every run is deterministic.
const PRODUCED = { 31: '2026-10-31T12:00:00Z', 32: '2026-10-31T12:00:00Z', 33: '2026-10-31T12:00:00Z', 34: '2026-10-31T12:00:00Z', 35: '2026-10-31T12:00:00Z',
  36: '2026-10-31T12:00:00Z', 37: '2026-10-31T12:00:00Z', 38: '2026-10-31T12:00:00Z', 39: '2026-10-31T12:00:00Z', 40: '2026-10-31T12:00:00Z', 41: '2026-10-31T12:00:00Z',
  42: '2026-10-31T12:00:00Z', 43: '2026-10-31T12:00:00Z', 44: '2026-10-31T12:00:00Z', 45: '2026-11-01T12:00:00Z', 46: '2026-11-01T18:00:00Z', 47: '2026-11-01T20:00:00Z',
  48: '2026-11-01T18:00:00Z', 49: '2026-11-01T22:00:00Z' };
export const ROCKETS = {
  chain: 'Idea 34\'s sample stack: seven of idea 33\'s engine (built from the propellant chosen) on 400 t, one J-2 on 100 t, 10 t of payload',
  'chain-sc': 'The same stack carrying only the spacecraft idea 42 sizes (closed loop)',
  as512: 'Saturn V AS-512 as flown (ideas 34 to 36: the flight report\'s stack and its Apollo payload)',
  'as512-sc': 'Saturn V AS-512, departing with the spacecraft idea 42 sizes instead of the Apollo stack (idea 38\'s payload setting)',
};
// Propellants offered for the chain's own stack: idea 31's presets a first stage can burn (GOX/RP-1 is a test chamber).
export const PROPELLANTS = ['lox-rp1', 'lox-lh2', 'lox-ch4', 'nto-mmh', 'nto-udmh', 'nto-a50', 'nto-n2h4', 'lox-eth75', 'htp-rp1'];
export const ASTEROIDS = { '99942': 'Apophis', '101955': 'Bennu', '162173': 'Ryugu', '65803': 'Didymos', '433': 'Eros', '2000 SG344': '2000 SG344' };

// ------------------------------------------------------------------------------------------------ the modules
const load = (d) => require(path.join(IDEAS, d, 'load.cjs'));
let MOD = null;
async function modules() {
  if (MOD) return MOD;
  const imp = (d) => import(path.join(IDEAS, d, 'build-sample.mjs'));
  MOD = {
    m31: require(path.join(IDEAS, '31-mixture/mixture.js')), p31: require(path.join(IDEAS, '31-mixture/presets.js')),
    thermo31: require(path.join(IDEAS, '31-mixture/snapshots/thermo-excerpt.js')), dens31: require(path.join(IDEAS, '31-mixture/snapshots/propellant-densities.js')),
    s32: await imp('32-bell'), s33: await imp('33-engine-deck'), s34: await imp('34-stack'), s35: await imp('35-max-q'), s36: await imp('36-closed-loop'),
    s37: await imp('37-window'), s38: await imp('38-burn-out'), s39: await imp('39-lamberts-road'), s40: await imp('40-long-coast'),
    L36: load('36-closed-loop'), L37: load('37-window'), L38: load('38-burn-out'), L39: load('39-lamberts-road'),
    K41: load('41-signal').K, K42: load('42-closing-in').K, K43: load('43-lumpy').K, K44: load('44-touch-and-go').K, K45: load('45-dig').K,
    K46: load('46-split').K, K47: load('47-way-home').K, K48: load('48-catch').K, K49: load('49-hot-return').K,
  };
  MOD.db31 = MOD.m31.parseThermo(MOD.thermo31);
  return MOD;
}

// ------------------------------------------------------------------------------------------------ idea 31's handoff
// Idea 31 builds its handoff in its page script (app.js buildHandoff, lines 452-471 at the bank's HEAD): the kernel's
// rocket(), sideDensity(), stoichiometricOF() and makeHandoff(), and two assumption sentences. The same calls are made
// here, the sentences copied from app.js; a test checks that LOX/RP-1 at O/F 2.6 and 10 MPa gives idea 31's committed
// handoff.json exactly. The O/F for another preset is the one idea 31's page opens it at (applyPreset: the c* peak inside
// the preset's checked range, rounded to 0.001); the chamber pressure is the chain's 10 MPa.
const THERMO31 = { repo: 'https://github.com/nasa/cea', commit: '2f79a647e85737742fb08a127da00d1ea1d069da', path: 'data/thermo.inp', sha256: 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363' };
export function chamberOf(m, presetId, pcPa) {
  const pr = m.p31.PRESETS.find((p) => p.id === presetId);
  if (!pr) throw new Error('no idea 31 preset ' + presetId);
  const prop = { oxidizer: JSON.parse(JSON.stringify(pr.oxidizer)), fuel: JSON.parse(JSON.stringify(pr.fuel)) };
  if (presetId === 'lox-rp1') return { pr, prop, of: 2.6, ofBasis: 'the chain\'s O/F 2.6 (idea 31\'s committed sample)' };
  const pk = m.m31.maxCstar(m.db31, prop, pcPa, pr.ofRange[0], pr.ofRange[1]);
  return { pr, prop, of: isFinite(pk.cstar) ? +pk.of.toFixed(3) : (pr.ofRange[0] + pr.ofRange[1]) / 2, ofBasis: 'the c* peak at 10 MPa, where idea 31\'s page opens this preset' };
}
export function make31(m, presetId, pcPa = 1e7) {
  const M = m.m31, db = m.db31, D = m.dens31, P = m.p31;
  const c = chamberOf(m, presetId, pcPa), pr = c.pr, state = { presetId, oxidizer: c.prop.oxidizer, fuel: c.prop.fuel, of: c.of, pc: pcPa };
  const DEFT = {}; P.COMPONENTS.forEach((x) => { DEFT[x.name] = x.T; });
  const current = M.rocket(db, { oxidizer: state.oxidizer, fuel: state.fuel }, state.of, state.pc);
  const dens = { oxidizer: M.sideDensity(D, state.oxidizer, 'oxidizer'), fuel: M.sideDensity(D, state.fuel, 'fuel') };
  const stoich = M.stoichiometricOF(db, state.oxidizer, state.fuel);
  // ---- from idea 31's app.js buildHandoff
  const asm = [];
  const env = M.PC_ENVELOPE;
  const inEnv = pr && state.of >= pr.ofRange[0] && state.of <= pr.ofRange[1] && state.pc >= env[0] && state.pc <= env[1];
  asm.push(inEnv ? 'Inside the envelope checked against NASA CEA 3.3.4 for this propellant (O/F ' + pr.ofRange[0] + '-' + pr.ofRange[1] + ', ' + env[0] / 1e5 + '-' + env[1] / 1e5 + ' bar).'
    : 'Outside the envelope this propellant was checked against NASA CEA over (or a custom blend): the method applies, but this point was not compared.');
  ['oxidizer', 'fuel'].forEach((s) => {
    const d = dens[s];
    if (d && !d.refusal) {
      const Td = [].concat(d.T);
      const Tr = state[s].map((p) => (p.T == null ? DEFT[p.name] : p.T));
      if (Td.some((t, i) => Tr[i] != null && Math.abs(t - Tr[i]) > 0.01) || (Td.length === 1 && Tr.some((t) => Math.abs(t - Td[0]) > 0.01))) {
        asm.push('The ' + s + ' density is for ' + Td.join('/') + ' K while its enthalpy is for ' + Tr.join('/') + ' K.');
      }
    }
  });
  return { h: M.makeHandoff({ preset: state.presetId, oxidizer: state.oxidizer, fuel: state.fuel, of: state.of, pc: state.pc }, current, dens,
    { stoichiometric_mixture_ratio: stoich, thermo: THERMO31, assumptions: asm, produced: PRODUCED[31] }), of: c.of, ofBasis: c.ofBasis };
}

// ------------------------------------------------------------------------------------------------ one link at a time
class Halt extends Error { constructor(at, refusal) { super(refusal.reason); this.at = at; this.refusal = refusal; } }
function must(at, r) { if (r && r.refusal) throw new Halt(at, r.refusal); return r; }
function guard(at, f) {
  try { return f(); } catch (e) {
    if (e instanceof Halt) throw e;
    throw new Halt(at, { code: 'insufficient_data', reason: 'Idea ' + at + '\'s recipe stops here: ' + String(e.message || e).slice(0, 600), what_would_help: 'Open idea ' + at + '\'s page on the previous module\'s handoff to see the refusal in full.' });
  }
}
function as512h36(m) {
  const C = m.L36.C, ctx = must(36, C.setup(m.L36.DATA.as512));
  const R = C.run(ctx, { samples: false });
  if (!R.guided.ok) throw new Halt(36, R.guided.refusals[0]);
  const mc = C.monteCarlo(ctx, R, { n: 100, seed: 1, sigmaScale: 1 }); mc.step(100);
  return C.makeHandoff(ctx, R, mc.result(), { produced: PRODUCED[36] });
}
function window37(m, h36, spec) {
  if (!spec) return m.s37.sample(h36).handoff;
  const W = m.L37.W, st = must(37, W.importClosedLoop(h36)), set = W.defaults(st.siteId), R = W.compute(st, spec, set);
  if (R.refusal) throw new Halt(37, R.refusal);
  return W.makeHandoff(st, spec, set, R, { produced: PRODUCED[37] });
}
function burn38(m, h37, payloadKg) {
  if (payloadKg == null) return m.s38.sample(h37).handoff;
  const B = m.L38.B, st = must(38, B.importWindow(h37)), set = Object.assign(B.defaults(), { payloadKg }), src = { window: st }, R = B.compute(src, set);
  if (R.refusal) throw new Halt(38, R.refusal);
  return B.makeHandoff(src, set, R, { produced: PRODUCED[38] });
}
function road39(m, h38, settings) {
  if (!settings) return m.s39.sample(h38).handoff;
  const K = m.L39.K, chain = h38 ? must(39, K.importBurnOut(h38)) : null, R = K.run(settings, chain ? { chain } : null);
  if (R.refusal) throw new Halt(39, R.refusal);
  if (!R.transfer) throw new Halt(39, R.refusals[R.refusals.length - 1] || { code: 'not_found', reason: 'No transfer selected.', what_would_help: 'Another window.' });
  return K.buildHandoff(R, PRODUCED[39]);
}
// 40 to 49 from idea 39's handoff: exactly the calls the modules' own build scripts make, each on the previous link.
function deepHalf(m, h39, H, upTo = 49) {
  H[40] = guard(40, () => m.s40.sample(h39).handoff);
  if (upTo === 40) return H;
  H[41] = guard(41, () => { const K = m.K41, src = must(41, K.importLongCoast(H[40])), R = must(41, K.run(src, K.defaults('dawn', src.R40.S.nav))); return K.buildHandoff(R, PRODUCED[41]); });
  H[42] = guard(42, () => { const K = m.K42, src = must(42, K.importSignal(H[41])), R = must(42, K.run(src, K.defaults())); return K.buildHandoff(R, PRODUCED[42]); });
  if (upTo === 42) return H;
  H[43] = guard(43, () => { const K = m.K43, src = must(43, K.importClosing(H[42])), R = must(43, K.run(src, K.defaults())); return K.buildHandoff(R, PRODUCED[43]); });
  H[44] = guard(44, () => { const K = m.K44, src = must(44, K.importLumpy(H[43])), R = must(44, K.run(src, K.defaults())); return K.buildHandoff(R, PRODUCED[44]); });
  H[45] = guard(45, () => { const K = m.K45, p = must(45, K.parseHandoff(H[44])), R = must(45, K.run(p.src, {})); return K.buildHandoff(R, PRODUCED[45]); });
  H[46] = guard(46, () => { const K = m.K46, p = must(46, K.parseHandoff(H[45])), R = must(46, K.run(p.src, K.defaults(p.src))); return K.buildHandoff(R, PRODUCED[46]); });
  H[47] = guard(47, () => { const K = m.K47, R = must(47, K.run(K.defaults(), { split: H[46] })); return K.buildHandoff(R, PRODUCED[47]); });
  H[48] = guard(48, () => { const K = m.K48, R = must(48, K.run(K.defaults(), { h47: H[47] })); return K.buildHandoff(R, PRODUCED[48]); });
  H[49] = guard(49, () => { const K = m.K49, R = must(49, K.run(Object.assign(K.defaults(), { source: 'imported' }), { h48: H[48] })); return K.buildHandoff(R, PRODUCED[49]); });
  return H;
}
const launchKgOf = (h42) => h42.outputs.mass.value.launch_kg;

/** The transfer for a body other than Apophis: idea 39 alone over its default window, least delta-v for a sample return. */
export function transferSettings(m, target) {
  const K = m.L39.K;
  if (target === '99942') return null;   // the chain's: Aster's own Apophis cell, chosen by idea 39's defaults
  return Object.assign(K.defaults(), { target, objective: 'dv_return' });
}
function specFrom39(h39) {
  const v = h39.outputs.v_infinity_departure.value, t = h39.outputs.transfer.value;
  return { vinf_m_s: v.vector_m_s.slice(), dateUtc: t.departure_utc.slice(0, 10), source: 'idea 39 (Lambert\'s Road) run by idea 50 for ' + h39.outputs.target.value.name + ': departure ' + t.departure_utc + ', TOF ' + (t.time_of_flight_s / 86400).toFixed(3) + ' d, M=' + t.revolutions + ' ' + t.branch + ', selected by ' + t.selected_by };
}

/**
 * One mission. choice: {rocket, propellant, asteroid}. Returns {choice, links: {31..49: handoff}, halt: {at, refusal} | null,
 * loop: [{payload_kg, launch_kg}], notes, ms}.
 */
export async function runMission(choice) {
  const m = await modules(), t0 = Date.now();
  const ch = Object.assign({ rocket: 'chain', propellant: 'lox-rp1', asteroid: '99942' }, choice);
  if (!ROCKETS[ch.rocket]) throw new Error('unknown rocket ' + ch.rocket);
  if (!ASTEROIDS[ch.asteroid]) throw new Error('unknown asteroid ' + ch.asteroid);
  const chainRocket = ch.rocket === 'chain' || ch.rocket === 'chain-sc';
  if (chainRocket && PROPELLANTS.indexOf(ch.propellant) < 0) throw new Error('unknown propellant ' + ch.propellant);
  if (!chainRocket) ch.propellant = null;
  const H = {}, out = { choice: ch, links: H, halt: null, loop: [], notes: [] };
  try {
    // the transfer first when the body is not the chain's: its asymptote is what idea 37 aims the launch at
    const set39 = transferSettings(m, ch.asteroid);
    let spec37 = null, sel = null;
    if (set39) {
      const pre = guard(39, () => road39(m, null, set39));
      spec37 = specFrom39(pre);
      const t = pre.inputs.settings.selection; sel = { depTdb: t.depTdb, tofS: t.tofS, M: t.M, branch: t.branch, source: 'idea 50: idea 39\'s ' + t.source + ' for this body, solved before the launch' };
      out.notes.push('Transfer solved first by idea 39 (' + set39.objective + ' over ' + set39.depStartUtc + ' to ' + set39.depEndUtc + '); its departure asymptote is idea 37\'s target.');
    }
    const settings39 = set39 ? Object.assign({}, set39, { selection: sel }) : null;
    // the rocket's front half, 31 to 36 (once: the closed loop below only changes the payload)
    let front = null;
    if (chainRocket) {
      const r31 = guard(31, () => make31(m, ch.propellant));
      H[31] = r31.h; out.notes.push('Idea 31 at O/F ' + r31.of + ' (' + r31.ofBasis + '), 10 MPa.');
      H[32] = guard(32, () => m.s32.sample(H[31], m.s32.SAMPLE_NOZZLE, PRODUCED[32]));
      H[33] = guard(33, () => m.s33.sample(H[32]));
    } else {
      out.notes.push('Ideas 31 to 33 are not on this path: AS-512\'s engines are idea 33\'s F-1 and J-2 presets, carried in idea 34\'s AS-512 vehicle.');
      front = guard(36, () => as512h36(m));
      // idea 36 carries idea 35's handoff whole, and idea 35 carries idea 34's: the AS-512 stack and its ascent are read from there
      H[35] = front.inputs.ascent_handoff; H[34] = H[35] && H[35].inputs && H[35].inputs.vehicle_handoff;
    }
    const sc = ch.rocket === 'chain-sc' || ch.rocket === 'as512-sc';
    // the spacecraft mass: idea 42's launch mass for this arrival; first guess from the arrival without a flown departure
    let payload = null;
    if (sc) {
      // flown into the mission's own links, so a halt here (before any launch) still shows the links that explain it
      if (!chainRocket) H[36] = front;
      H[39] = guard(39, () => road39(m, null, settings39 || m.L39.K.defaults()));
      out.notes.push('Spacecraft sized first: ideas 39 to 42 without a flown departure, then the rocket flown with that payload, and the loop repeated until the two masses agree.');
      deepHalf(m, H[39], H, 42);
      payload = launchKgOf(H[42]);
      delete H[40]; delete H[41]; delete H[42];
    }
    for (let it = 0; it < 6; it++) {
      if (chainRocket) {
        H[34] = guard(34, () => m.s34.sample(H[33], Object.assign({}, m.s34.SAMPLE, sc ? { payload } : {})).handoff);
        H[35] = guard(35, () => m.s35.sample(H[34]).handoff);
        H[36] = guard(36, () => m.s36.sample(H[35]).handoff);
      } else H[36] = front;
      H[37] = guard(37, () => window37(m, H[36], spec37));
      H[38] = guard(38, () => burn38(m, H[37], ch.rocket === 'as512-sc' ? payload : null));
      H[39] = guard(39, () => road39(m, H[38], settings39));
      if (!sc) break;
      deepHalf(m, H[39], H, 42);
      const need = launchKgOf(H[42]);
      out.loop.push({ payload_kg: payload, launch_kg: need });
      if (Math.abs(need - payload) <= 0.01) break;
      payload = need;
      if (it === 5) out.notes.push('The closed loop did not settle to 0.01 kg in six passes.');
    }
    deepHalf(m, H[39], H, 49);
  } catch (e) {
    if (!(e instanceof Halt)) throw e;
    out.halt = { at: e.at, refusal: e.refusal };
  }
  out.ms = Date.now() - t0;
  return out;
}

// ------------------------------------------------------------------------------------------------ pins and digests
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const blobSha1 = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');
/** Every file of ideas 31 to 49 this process has loaded, with its git blob id: the kernels a fixture was computed with. */
export function kernelPins() {
  const files = new Set(Object.keys(require.cache).filter((f) => f.startsWith(IDEAS + path.sep) && !f.startsWith(HERE + path.sep)));
  ORDER.slice(1, 10).forEach((d) => { const f = path.join(IDEAS, d, 'build-sample.mjs'); if (fs.existsSync(f)) files.add(f); });
  const out = {};
  [...files].sort().forEach((f) => { out[path.relative(BANK, f).split(path.sep).join('/')] = blobSha1(fs.readFileSync(f)); });
  return out;
}
/** The pins as one rollup: sha256 of the sorted "path blob" lines, with the files grouped by folder (what the test re-hashes). */
export function pinRollup(pins) {
  const keys = Object.keys(pins).sort(), files = {};
  keys.forEach((k) => { const i = k.indexOf('/', 'ideas/'.length); (files[k.slice(0, i)] = files[k.slice(0, i)] || []).push(k.slice(i + 1)); });
  return { rule: 'sha256 of the newline-joined "path git-blob-sha1" lines, paths sorted', sha256: sha256(keys.map((k) => k + ' ' + pins[k]).join('\n')), count: keys.length, files };
}
export function committedLinks() {
  const H = {};
  ORDER.forEach((d) => { H[+d.slice(0, 2)] = JSON.parse(fs.readFileSync(path.join(IDEAS, d, 'handoff.json'), 'utf8')); });
  return H;
}

// ------------------------------------------------------------------------------------------------ verify
/** Re-run the chain's own choices and compare with the 19 committed handoffs. */
// Idea 31's committed handoff.json predates its review, which changed this source text in mixture.js (158fe6b); ideas 32
// and 33 pass it through. The numbers are the same; --verify (like the tests) reads the old text as the new and says so.
export const STALE_31 = ['RP-1311 eq 6.13 form', 'RP-1311 eqs 6.11-6.12'];
export async function verify() {
  const R = await runMission({ rocket: 'chain', propellant: 'lox-rp1', asteroid: '99942' });
  const C = committedLinks(), rows = [];
  for (let n = 31; n <= 49; n++) {
    const a = C[n], b = R.links[n], own = (h) => JSON.stringify((h.refusals || []).filter((r) => !r.from || r.from === h.from));
    const ca = JSON.stringify(a.outputs), cb = JSON.stringify(b && b.outputs), stale = ca.includes(STALE_31[0]);
    rows.push({ n, from: a.from, outputs: ca.split(STALE_31[0]).join(STALE_31[1]) === cb, stale_text: stale, own_refusals: b ? own(a) === own(b) : false,
      refusals_committed: a.refusals.length, refusals_unbroken: b ? b.refusals.length : null, inputs_equal: JSON.stringify(a.inputs) === JSON.stringify(b && b.inputs) });
  }
  return { rows, halt: R.halt, ms: R.ms };
}

// ------------------------------------------------------------------------------------------------ the NHATS oracle
/**
 * JPL NHATS's round trips (snapshots/nhats.js) flown through the chain's two legs: idea 39's cell() for the way out
 * (its two-body target from Aster's elements, Earth from its Horizons fit) on NHATS's launch date at 0 h TDB and outbound
 * time, and idea 47's own nhatsChecks() for the way back (its n-body asteroid). This module sums them as NHATS does
 * (mission.js roundTrip); the fixture keeps the legs, the sums are made where they are read.
 */
export async function nhatsLegs() {
  const m = await modules(), K39 = m.L39.K, NH = require(path.join(HERE, 'snapshots', 'nhats.js'));
  const back = {}; m.K47.nhatsChecks().forEach((r) => { back[r.tid] = r; });
  const J2000_UNIX_S = K39.constants.unixToJ2000Days * 86400, rows = [];
  NH.rows.forEach((r) => {
    const o = {}; NH.columns.forEach((c, i) => { o[c] = r[i]; });
    const b = K39.findBody(o.des), t = Date.parse(o.launch + 'T00:00:00Z') / 1000 - J2000_UNIX_S;
    const c = b ? K39.cell(b, t, o.dur_out * 86400, { revs: [0] }) : null, q = c && c.ok ? c.sols[c.best] : null, ret = back[o.tid];
    // idea 39's own rule (grid(), lambert.js:403 and :423): a cell arriving after an Earth encounter since the elements' epoch is refused
    const enc = b ? K39.encounters(b, K39.jdTdbToTdb(b.elements.epochTdbJd), t + o.dur_out * 86400) : [];
    rows.push({ tid: o.tid, des: o.des, outside_39: enc.length ? { encounter_utc: K39.utcOf(enc[0].t), distance_m: enc[0].distance_m } : null,
      legs: q && ret ? { c3_m2_s2: q.c3, vinf_arr_neo_m_s: q.vInfArr, dv_dep_neo_m_s: ret.dv_m_s, vinf_ret_m_s: ret.vinf_m_s } : null,
      missing: !b ? 'body' : !q ? 'outbound: ' + (c && c.refusal ? c.refusal.reason : 'no solution') : !ret ? 'return: not among idea 47\'s legs' : null });
  });
  return { note: 'Idea 39 cell(body, launch 0 h TDB, dur_out, M=0) for c3 and the arrival v-infinity; idea 47 nhatsChecks() for the departure burn and the Earth-arrival v-infinity; summed as NHATS sums by mission.js roundTrip()', rows };
}

// ------------------------------------------------------------------------------------------------ the scenario set
export const SCENARIOS = (() => {
  const s = [];
  PROPELLANTS.forEach((p) => { s.push({ rocket: 'chain', propellant: p, asteroid: '99942' }); s.push({ rocket: 'chain-sc', propellant: p, asteroid: '99942' }); });
  s.push({ rocket: 'as512', asteroid: '99942' }, { rocket: 'as512-sc', asteroid: '99942' });
  ['101955', '162173', '65803', '433', '2000 SG344'].forEach((a) => {
    s.push({ rocket: 'chain-sc', propellant: 'lox-rp1', asteroid: a }, { rocket: 'as512', asteroid: a }, { rocket: 'as512-sc', asteroid: a });
  });
  return s;
})();
export const keyOf = (c) => [c.rocket, c.rocket === 'as512' || c.rocket === 'as512-sc' ? '-' : c.propellant, c.asteroid].join('|');

async function build(outFile) {
  const t0 = Date.now(), runs = [];
  for (const c of SCENARIOS) {
    const r = await runMission(c);
    runs.push(M50.recordOf(r, sha256));
    process.stderr.write(keyOf(c) + ': ' + (r.halt ? 'halts at ' + r.halt.at : 'lands') + ', ' + r.ms + ' ms\n');
  }
  const committed = M50.recordOf({ choice: { rocket: 'committed', propellant: 'lox-rp1', asteroid: '99942' }, links: committedLinks(), halt: null, loop: [], notes: ['The 19 sample handoffs as committed in the bank, each read from its folder.'] }, sha256);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: BANK, encoding: 'utf8' }).trim();
  const data = M50.packRecords(runs.concat([committed]));
  data.built = { bank_commit: head, scenarios: SCENARIOS.length + 1, by: 'ideas/50-the-long-way-round/run-chain.mjs --build' };
  data.pins = pinRollup(kernelPins());
  const body = '/* The Long Way Round, every scenario this folder offers, run whole by run-chain.mjs --build on the kernels of ideas 31 to 49\n' +
    ' * (their git blob ids in .pins), each link reduced to the numbers the ledger reads (mission.js EXTRACT) and its own refusals.\n' +
    ' * GENERATED; do not edit. Classic script (window.LWR_MISSIONS) and require(). */\n' +
    '(function (root) {\n  var D = ' + JSON.stringify(data) + ';\n  if (typeof module === \'object\' && module.exports) module.exports = D;\n  else root.LWR_MISSIONS = D;\n})(typeof self !== \'undefined\' ? self : this);\n';
  fs.writeFileSync(outFile, body);
  fs.writeFileSync(outFile + '.provenance.json', JSON.stringify({
    repo: 'https://github.com/hudsonclavin-cloud/Aster-Idea-Bank', path: 'ideas/31-mixture … ideas/49-hot-return (committed kernels, loaders and sample recipes)', commit: head,
    mode: 'derived', sourceSha256: sha256(body), files: data.pins.count,
    note: 'derived by run-chain.mjs --build: ' + (SCENARIOS.length) + ' missions run whole (rocket x propellant x asteroid, see SCENARIOS) plus the 19 committed sample handoffs read as they are; each link reduced by mission.js recordOf(); the kernels\' git blob ids are in the file\'s pins and mission.test.mjs checks them against the folders',
  }, null, 1) + '\n');
  process.stderr.write('wrote ' + path.relative(BANK, outFile) + ' (' + body.length + ' bytes) in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n');
}

// ------------------------------------------------------------------------------------------------ CLI
const HELP = `run-chain.mjs: fly the whole Long Way Round (ideas 31 to 49) with their committed kernels, in order.

  node ideas/50-the-long-way-round/run-chain.mjs [--rocket R] [--propellant P] [--asteroid A] [--handoff FILE] [--json]
      R: ${Object.keys(ROCKETS).join(' | ')}   (default chain)
      P: ${PROPELLANTS.join(' | ')}   (chain rockets only; default lox-rp1)
      A: ${['99942', '101955', '162173', '65803', '433', '2000 SG344'].map((k) => JSON.stringify(k) + ' ' + ASTEROIDS[k]).join(' | ')}   (default 99942)
      Prints the mission ledger; --handoff FILE writes this module's mission handoff (idea 50), --json prints it.
  --verify   re-run the chain's own choices and compare every link with the 19 committed handoff.json files
             (exit 1 if any output differs)
  --build    regenerate snapshots/missions.js (all ${SCENARIOS.length} missions; about 6 minutes)
  --nhats    fly JPL NHATS's round trips through ideas 39 and 47 and write snapshots/nhats-chain.js
  --sample   write handoff.json, this module's sample (the page's default mission, from snapshots/missions.js)
  --help     this text
Exit status: 0 the mission ran (landed or halted with a refusal), 1 a verification mismatch, 2 bad arguments.`;

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  if (argv.includes('--verify')) {
    const v = await verify();
    v.rows.forEach((r) => console.log(String(r.n), r.from.padEnd(17), 'outputs', r.outputs ? (r.stale_text ? 'identical*' : 'identical ') : 'DIFFER    ', ' own refusals', r.own_refusals ? 'identical' : 'DIFFER   ',
      ' refusals carried: committed', String(r.refusals_committed).padStart(2), 'unbroken', String(r.refusals_unbroken).padStart(2)));
    const bad = v.rows.filter((r) => !r.outputs || !r.own_refusals);
    if (v.rows.some((r) => r.stale_text)) console.log('* apart from idea 31\'s stale c* source text "' + STALE_31[0] + '" (now "' + STALE_31[1] + '"), which ideas 32 and 33 pass through: README, Findings');
    console.log(bad.length ? bad.length + ' link(s) differ' : 'all 19 links reproduce their committed outputs and own refusals (' + (v.ms / 1000).toFixed(1) + ' s)');
    return bad.length ? 1 : 0;
  }
  if (argv.includes('--build')) { await build(path.join(HERE, 'snapshots', 'missions.js')); return 0; }
  if (argv.includes('--sample')) {
    // this module's sample handoff: the page's default mission (the chain's own choices), with the what-if at the chain's settings
    const D = require(path.join(HERE, 'snapshots', 'missions.js')), mis = M50.mission(M50.unpack(D, 'chain|lox-rp1|99942'));
    const K = M50.create({ aster: require(path.join(HERE, 'snapshots', 'aster.js')), ledger47: require(path.join(HERE, 'snapshots', 'home-ledger.js')), isa: require(path.join(HERE, 'snapshots', 'isa.js')), nhats: require(path.join(HERE, 'snapshots', 'nhats.js')) });
    const h = M50.makeHandoff(mis, { produced: '2026-11-02T00:00:00Z', source: 'bundled', whatIf: { dry: null, plant: false, tag: false, launcher: 'flown', td: null }, closure: K.closure(mis, {}) });
    fs.writeFileSync(path.join(HERE, 'handoff.json'), JSON.stringify(h) + '\n');
    console.log('wrote handoff.json', JSON.stringify(h).length, 'bytes;', h.refusals.length, 'refusals; verdict:', mis.verdict.summary);
    return 0;
  }
  if (argv.includes('--nhats')) {
    const F = await nhatsLegs(), file = path.join(HERE, 'snapshots', 'nhats-chain.js'), head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: BANK, encoding: 'utf8' }).trim();
    F.built = { bank_commit: head, by: 'run-chain.mjs --nhats' };
    const all = kernelPins(), some = {};
    Object.keys(all).filter((k) => /ideas\/(39-lamberts-road|47-way-home)\//.test(k)).forEach((k) => { some[k] = all[k]; });
    F.pins = pinRollup(some);
    F.rows.forEach((r) => { if (r.legs) for (const k in r.legs) r.legs[k] = +r.legs[k].toPrecision(10); if (r.outside_39) r.outside_39.distance_m = Math.round(r.outside_39.distance_m); });
    const body = '/* JPL NHATS\'s round trips flown through the chain\'s two legs (ideas 39 and 47, their kernels pinned by git blob id in .pins).\n' +
      ' * GENERATED by ideas/50-the-long-way-round/run-chain.mjs --nhats; do not edit. Classic script (window.LWR_NHATS_CHAIN) and require(). */\n' +
      '(function (root) {\n  var D = ' + JSON.stringify(F) + ';\n  if (typeof module === \'object\' && module.exports) module.exports = D;\n  else root.LWR_NHATS_CHAIN = D;\n})(typeof self !== \'undefined\' ? self : this);\n';
    fs.writeFileSync(file, body);
    fs.writeFileSync(file + '.provenance.json', JSON.stringify({ repo: 'https://github.com/hudsonclavin-cloud/Aster-Idea-Bank', path: 'ideas/39-lamberts-road/lambert.js (cell, encounters) and ideas/47-way-home/home.js (nhatsChecks), on snapshots/nhats.js', commit: head,
      mode: 'derived', sourceSha256: sha256(body), note: 'derived by run-chain.mjs --nhats: for each of the ' + F.rows.length + ' NHATS trajectories, idea 39\'s cell() at the launch date 0 h TDB for the outbound time (C3 and arrival v-infinity) and its encounters() rule, and idea 47\'s nhatsChecks() leg for the same trajectory id (departure burn and Earth-arrival v-infinity); the sums are mission.js roundTrip()\'s, made where they are read' }, null, 1) + '\n');
    console.log('wrote', path.relative(BANK, file), F.rows.length, 'rows,', F.rows.filter((r) => r.legs).length, 'with both legs');
    return 0;
  }
  const choice = { rocket: arg('--rocket') || 'chain', propellant: arg('--propellant') || 'lox-rp1', asteroid: arg('--asteroid') || '99942' };
  if (!ROCKETS[choice.rocket] || !ASTEROIDS[choice.asteroid] || PROPELLANTS.indexOf(choice.propellant) < 0) { console.error(HELP); return 2; }
  const r = await runMission(choice);
  const rec = M50.recordOf(r, sha256), mis = M50.mission(rec);
  const h = M50.makeHandoff(mis, { produced: new Date().toISOString(), source: 'run-chain.mjs' });
  if (arg('--handoff')) fs.writeFileSync(arg('--handoff'), JSON.stringify(h) + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify(h, null, 1));
  else console.log(M50.textReport(mis));
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e && e.stack || e); process.exit(1); });
}
