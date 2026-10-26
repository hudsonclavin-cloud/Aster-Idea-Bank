#!/usr/bin/env node
// Torque Receipt on the command line: the same kernel (torque.js) and snapshots as the page.
// Run from the bank root, e.g.
//   node ideas/27-torque-receipt/torque-receipt.mjs --preset endcap
//   node ideas/27-torque-receipt/torque-receipt.mjs --size M6 --grade 8.8 --torque 9.8 --condition dry --fext 2000 --nut iso4032 --length 20 --stack 10 --washer-nut
// Exit codes: 0 a receipt was computed; 2 the preload (or the whole receipt) was refused; 3 usage.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TR = require('./torque.js');
const ctx = TR.makeContext(require('./node-data.cjs')(here));

const HELP = `Torque Receipt: what a tightening torque promises for one bolt, from PartForge's tables.

Usage: node torque-receipt.mjs [--preset NAME | options] [--json]

Presets:
  --preset endcap        tests/dryrun/endcap.scad as written (M8 8.8, 25 N·m lubricated, its own loads)
  --preset endcap-dry    the same torque on a dry joint (what 25 N·m was right for)
  --preset m6-through    M6 8.8 at the table's dry guide torque, 500 N per bolt, through a
                         10 mm plate with a washer under the nut and a 20 mm screw
  --preset by-feel       the end cap "tightened by feel" (the preload is refused)
  --preset quarter-20    1/4-20 SAE J429 grade 5, dry, through 12.7 mm with a hex nut

Fastener:   --size M8 | 1/4-20 | #10-32 ...   --grade 8.8 | 10.9 | 12.9 | A2-70 | A2-50 | A2-80 | J429-5 | J429-8 | declared
            --proof MPa --yield MPa --uts MPa --grade-source TEXT   (with --grade declared)
Tightening: --torque N·m | --by-feel    --condition dry | plated | lubricated | antiseize | moly | declared
            --k-pick low | mid | high   (within the table's range; default mid)
            --k K --k-source TEXT --lubricated | --not-lubricated   (with --condition declared)
Load:       --fext N   axial tension per bolt (0 if none)   --fext-source TEXT
Nut joint:  --nut iso4032 | nyloc | jam | hex | declared  --nut-h mm --nut-source TEXT
            --length mm (under the head)  --stack mm  --washer-head  --washer-nut
Tapped:     --tapped --engagement mm --material 6061-T6 | 7075-T6 | ...  [--length mm --stack mm --washer-head]
Other:      --guide   reproduce the torque_guide_8_8_dry_Nm column for all 12 metric sizes
            --sweep   the same torque under every condition the table gives a nut factor for
            --json    print the receipt object instead of text
            --help

Every line is COMPUTED, never PASS: a torque-derived preload is not evidence.
Exit: 0 computed, 2 refused, 3 usage.`;

function parse(argv) {
  const o = { flags: new Set() };
  const val = new Set(['--preset', '--size', '--grade', '--proof', '--yield', '--uts', '--grade-source', '--torque', '--condition', '--k-pick', '--k', '--k-source', '--fext', '--fext-source', '--nut', '--nut-h', '--nut-source', '--length', '--stack', '--engagement', '--material']);
  const flag = new Set(['--by-feel', '--lubricated', '--not-lubricated', '--washer-head', '--washer-nut', '--tapped', '--guide', '--sweep', '--json', '--help', '-h']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (val.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[a.slice(2)] = argv[++i]; }
    else if (flag.has(a)) o.flags.add(a);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function presetInput(name) {
  const p = TR.presets(ctx)[name];
  return p ? JSON.parse(JSON.stringify(p.input)) : null;
}

function inputFrom(o) {
  let inp = {};
  if (o.preset) {
    inp = presetInput(o.preset);
    if (!inp) throw new Error(`unknown preset ${o.preset} (endcap, endcap-dry, m6-through, by-feel, quarter-20)`);
  }
  const n = (k) => (o[k] !== undefined ? Number(o[k]) : undefined);
  if (o.size) inp.size = o.size;
  if (o.grade) inp.grade = o.grade;
  if (o.grade === 'declared') inp.declared = { proof_MPa: n('proof'), yield_MPa: n('yield'), uts_MPa: n('uts'), source: o['grade-source'] };
  if (o.torque !== undefined) inp.torque_Nm = o.torque;
  if (o.flags.has('--by-feel')) { inp.byFeel = true; inp.torque_Nm = null; }
  if (o.condition) inp.condition = o.condition;
  if (o['k-pick']) inp.K_pick = o['k-pick'];
  if (o.k !== undefined) { inp.K = n('k'); inp.K_source = o['k-source']; }
  if (o.flags.has('--lubricated')) inp.lubricated = true;
  if (o.flags.has('--not-lubricated')) inp.lubricated = false;
  if (o.fext !== undefined) inp.Fext_N = o.fext;
  if (o['fext-source']) inp.Fext_source = o['fext-source'];
  if (o.flags.has('--tapped')) inp.joint = 'tapped';
  else if (o.nut || o.length || o.stack) inp.joint = inp.joint || 'nut';
  if (o.nut) inp.nut = o.nut;
  if (o['nut-h'] !== undefined) { inp.nut_h_mm = n('nut-h'); inp.nut_h_source = o['nut-source']; }
  if (o.length !== undefined) inp.screw_len_mm = n('length');
  if (o.stack !== undefined) inp.stack_mm = n('stack');
  if (o.flags.has('--washer-head')) inp.washer_head = true;
  if (o.flags.has('--washer-nut')) inp.washer_nut = true;
  if (o.engagement !== undefined) inp.engagement_mm = n('engagement');
  if (o.material) inp.material = o.material;
  if (!inp.condition) inp.condition = 'dry';
  return inp;
}

const W = 78;
const rule = (c = '-') => c.repeat(W);
function wrap(text, indent = '    ') {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = indent;
  for (const w of words) {
    if (line.length + w.length + 1 > W && line.trim()) { out.push(line.replace(/\s+$/, '')); line = indent; }
    line += (line.trim() ? ' ' : '') + w;
  }
  if (line.trim()) out.push(line);
  return out.join('\n');
}
const STATE = { over: 'OVER', warn: 'CHECK', ok: 'ok', info: '', refused: 'REFUSED' };
const stamp = (s) => `COMPUTED${STATE[s.state] ? ' · ' + STATE[s.state] : ''}`;

function text(r, inp) {
  const L = [];
  L.push(rule('='));
  if (!r.ok) {
    L.push(`TORQUE RECEIPT · REFUSED (${r.refusal.code})`);
    L.push(wrap(r.refusal.reason));
    L.push(wrap('What would help: ' + r.refusal.what_would_help));
    L.push(rule('='));
    return L.join('\n');
  }
  const { size, grade: g, tightening: t, sections: S } = r;
  L.push(`TORQUE RECEIPT · ${size.key} ${g.label} · ${t.condition.label}`);
  L.push(rule());
  L.push(`Fastener   d ${size.d_mm} mm, p ${size.p_mm} mm, As ${size.As_mm2} mm²`);
  L.push(wrap(`from ${size.asSrc}`, '           '));
  L.push(`Grade      proof ${g.proof_MPa} / yield ${g.yield_MPa} / UTS ${g.uts_MPa} MPa [${g.confidence}]`);
  L.push(wrap(`from ${g.source}`, '           '));
  L.push(`           proof load ${TR.fmtN(g.proofLoad_N)} = As × proof` + (g.proofLoadColumn ? ` (table column ${g.proofLoadColumn.field}: ${TR.fmtN(g.proofLoadColumn.N)})` : ''));
  L.push(`Nut factor K ${t.K}` + (t.Krange.lo !== t.Krange.hi ? ` (${t.Kpick} of ${t.Krange.lo}–${t.Krange.hi})` : '') + ` [${t.Kconf}]`);
  L.push(wrap(`from ${t.Ksrc}`, '           '));
  L.push(`Scatter    ±${Math.round(t.u * 100)} % [${t.uRow.confidence}] from ${t.uRow.key}`);
  L.push(wrap(`"${t.uRow.quote}"`, '           '));
  L.push(rule());
  const w = S.window;
  L.push(wrap(`Torque window at K ${t.K}: ${TR.fmtNm(w.T_lo_Nm)} – ${TR.fmtNm(w.T_hi_Nm)} puts the nominal at ${ctx.band.lo}–${ctx.band.hi} × proof (${TR.fmtNm(w.T_mid_Nm)} at 0.70); at most ${TR.fmtNm(w.T_cap_Nm)} keeps F × (1 + ${t.u}) at or below proof.`, ''));
  L.push(rule());
  if (S.preload.status !== 'computed') {
    L.push(`PRELOAD    REFUSED (${S.preload.refusal.code})`);
    L.push(wrap(S.preload.refusal.reason));
    L.push(wrap('What would help: ' + S.preload.refusal.what_would_help));
  } else {
    const p = S.preload;
    L.push(`PRELOAD    ${stamp(p)} · ${p.word}`);
    L.push(`  T ${TR.fmtNm(p.T_Nm)}${p.T_lbfin ? ` (${p.T_lbfin.toFixed(1)} lbf·in)` : ''} → F = T/(K·d) = ${TR.fmtN(p.F_nom_N)}, ${(p.ratio_proof * 100).toFixed(1)} % of proof`);
    L.push(`  scatter ${TR.fmtN(p.F_min_N)} – ${TR.fmtN(p.F_max_N)}`);
    if (p.Ksens) L.push(`  across the K range: ${TR.fmtN(p.Ksens.F_at_Klo)} at K ${p.Ksens.K_lo}, ${TR.fmtN(p.Ksens.F_at_Khi)} at K ${p.Ksens.K_hi}`);
    const a = S.assembly;
    L.push(`ASSEMBLY   ${stamp(a)} · ${a.word}`);
    L.push(`  σ at F_max = ${TR.fmtMPa(a.sigma_MPa)}: SF ${a.sf_proof.toFixed(2)} on proof, ${a.sf_yield.toFixed(2)} on yield, ${a.sf_uts.toFixed(2)} on UTS`);
    const s = S.service;
    if (s.status !== 'computed') {
      L.push(`SERVICE    not computed: ${s.refusal.reason}`);
    } else {
      L.push(`SERVICE    ${stamp(s)} · ${s.word} (no joint-stiffness credit)`);
      L.push(`  F_ext ${TR.fmtN(s.Fext_N)} per bolt (${s.FextSrc})`);
      L.push(`  σ at F_max + F_ext = ${TR.fmtMPa(s.sigma_MPa)}: SF ${s.sf_proof.toFixed(2)} proof, ${s.sf_yield.toFixed(2)} yield, ${s.sf_uts.toFixed(2)} UTS; F_ext alone ${TR.fmtMPa(s.sigma_ext_only_MPa)}`);
    }
  }
  if (S.protrusion) {
    const p = S.protrusion;
    if (p.status !== 'computed') L.push(`PROTRUSION not computed: ${p.refusal.reason}`);
    else {
      L.push(`PROTRUSION ${stamp(p)} · ${p.word}${p.recallInput ? ' (uses a recall field: not cited)' : ''}`);
      L.push(`  ${p.formula} = ${p.protrusion_mm.toFixed(2)} mm vs 2p = ${p.need_mm.toFixed(2)} mm; shortest screw ${p.minLen_mm.toFixed(2)} mm`);
      L.push(wrap(`nut ${p.nut_h_mm} mm from ${p.nutSrc}`, '  '));
    }
  }
  if (S.engagement) {
    const e = S.engagement;
    if (e.status !== 'computed') L.push(`THREAD     not computed: ${e.refusal.reason}`);
    else {
      L.push(`THREAD     ${stamp(e)} · ${e.word}`);
      L.push(`  threadCheck: Le ${e.Le_mm} mm in ${e.materialName} (σu ${e.su_MPa}); strip ${TR.fmtN(e.tc.F_strip_N)} vs bolt ${TR.fmtN(e.tc.F_bolt_N)}; needs ≥ ${e.tc.Le_req_mm.toFixed(1)} mm, rule ≥ ${e.tc.Le_min_rule_mm.toFixed(1)} mm`);
      if (e.worst) L.push(`  strip / worst bolt load (${e.worst.what} = ${TR.fmtN(e.worst.F_N)}) = ${e.strip_over_worst.toFixed(2)}`);
      if (e.tableMin) L.push(wrap(`table minimum ${e.tableMin.mm} mm, ${e.tableMin.src}`, '  '));
      for (const n of e.notes) L.push(wrap(n, '  '));
    }
  }
  L.push(rule());
  L.push(wrap(`${r.headline.state.toUpperCase()}: ${r.headline.text}`, ''));
  for (const n of r.notes) L.push(wrap('· ' + n, ''));
  L.push(rule('='));
  return L.join('\n');
}

function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { console.error(e.message + '\n\n' + HELP); process.exit(3); }
  if (o.flags.has('--help') || o.flags.has('-h')) { console.log(HELP); process.exit(0); }
  if (o.flags.has('--guide')) {
    console.log('torque_guide_8_8_dry_Nm, recomputed from its own definition: ' + ctx.guide.quote);
    console.log('size   table N·m   K·0.7·As·Sp·d   3 sf   guide/(0.2·d)/proof column');
    for (const g of TR.guideTable(ctx)) console.log(`${g.key.padEnd(6)} ${String(g.guide_Nm).padStart(9)}   ${g.recomputed_Nm.toFixed(4).padStart(13)}   ${String(g.sf3).padStart(5)}   ${g.frac_back.toFixed(4)}`);
    process.exit(0);
  }
  let inp;
  try { inp = inputFrom(o); } catch (e) { console.error(e.message); process.exit(3); }
  if (!inp.size) { console.error('give --size or --preset\n\n' + HELP); process.exit(3); }
  if (o.flags.has('--sweep')) {
    console.log(`Same torque (${inp.torque_Nm} N·m on ${inp.size} ${inp.grade}), every condition with a table nut factor (mid K):`);
    for (const s of TR.conditionSweep(ctx, inp)) console.log(s.ok ? `  ${s.label.padEnd(34)} K ${String(s.K).padEnd(5)} ±${Math.round(s.u * 100)} %  F ${TR.fmtN(s.F_nom_N).padStart(9)} (${(s.ratio * 100).toFixed(1)} % proof)  σ_max ${TR.fmtMPa(s.sigma_max_MPa)} ${s.word}` : `  ${s.label}: refused`);
    process.exit(0);
  }
  const r = TR.receipt(ctx, inp);
  if (o.flags.has('--json')) console.log(JSON.stringify(r, (k, v) => (k === 'row' || k === 'uRow' ? undefined : v), 1));
  else console.log(text(r, inp));
  process.exit(!r.ok || r.sections.preload.status !== 'computed' ? 2 : 0);
}
main();
