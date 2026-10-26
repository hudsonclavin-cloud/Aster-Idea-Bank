#!/usr/bin/env node
// whose-earth.mjs — which Earth do Aster and Skyhook compute on, and what does the difference do?
// Verifies every row of the concordance (registry.js) against the two checkouts, scans them for Earth
// constants the registry does not list, recomputes Skyhook's params/rev_a.json and the K2 interface
// quantities on each program's Earth, and reconciles four accountings of reboost energy.
// Node built-ins only. Run with --help for usage.
import { collect, Reg, Model as M } from './collect.mjs';

const USAGE = `usage: node ideas/14-whose-earth/whose-earth.mjs [options]

Reads the Aster and Skyhook checkouts (read-only) and prints the concordance of Earth constants, the
canon recomputed on each Earth, the K2 interface effects, the reboost-energy reconciliation and the
reconciliation gates.

  --aster DIR      Aster checkout   (default ${Reg.REPOS.aster.dir})
  --skyhook DIR    Skyhook checkout (default ${Reg.REPOS.skyhook.dir})
  --offline        no checkouts: verify what snapshots/ holds, take the other citations from data.js
  --no-scan        skip the scan for unregistered occurrences (faster; drift in the rows still fails)
  --section NAME   print one part: concordance, earths, canon, interface, reboost, gates
  --json           print the whole result as JSON
  -h, --help       this text

exit 0  every row on its stated line, nothing unregistered, every gate holds
exit 1  a row moved or vanished, an occurrence is not in the registry, or a gate failed
exit 2  refused: a checkout is missing (the message says what would help)
exit 3  usage`;

function parseArgs(argv) {
  const o = { section: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--offline') o.offline = true;
    else if (a === '--no-scan') o.noScan = true;
    else if (a === '--aster' || a === '--skyhook' || a === '--section') {
      const v = argv[++i];
      if (!v) return { error: `${a} needs a value` };
      o[a.slice(2)] = v;
    } else return { error: `unknown option ${a}` };
  }
  const sections = ['all', 'concordance', 'earths', 'canon', 'interface', 'reboost', 'gates'];
  if (!sections.includes(o.section)) return { error: `--section must be one of ${sections.join(', ')}` };
  return o;
}

// ---------------------------------------------------------------- text helpers
const out = [];
const say = (s = '') => out.push(s);
// wrap prose at 116 columns; continuation lines indented to `hang`
function sayw(text, indent = '  ', hang = indent + '  ') {
  const words = text.split(' ');
  let line = indent;
  let first = true;
  for (const w of words) {
    const lead = first ? indent : hang;
    if (line.length > lead.length && (line + ' ' + w).length > 116) {
      out.push(line);
      line = hang + w;
      first = false;
    } else line = line.length > lead.length || (!first && line.length > hang.length) ? `${line} ${w}` : `${line}${w}`;
  }
  out.push(line);
}
function table(head, rows, align) {
  const all = [head, ...rows].map((r) => r.map((c) => String(c == null ? '' : c)));
  const w = head.map((_, i) => Math.max(...all.map((r) => [...r[i]].length)));
  const line = (r) => r.map((c, i) => (align && align[i] === 'r' ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ').replace(/\s+$/, '');
  say(`  ${line(all[0])}`);
  say(`  ${w.map((n) => '─'.repeat(n)).join('  ')}`);
  for (const r of all.slice(1)) say(`  ${line(r)}`);
}
const f = M.fmt;
const sgn = M.fmtSigned;
const where = (r) => `${r.path}:${r.foundLine || r.line}`;
const REPO = { aster: 'Aster', skyhook: 'Skyhook' };
const FAM = {
  mu: { title: 'Gravitational parameter μ⊕', unit: 'km³/s²', d: (v) => (Number.isInteger(v) ? 0 : String(v).split('.')[1].length) },
  R: { title: 'Earth radius R⊕', unit: 'km', d: (v) => Math.min(4, Number.isInteger(v) ? 0 : String(v).split('.')[1].length) },
  g0: { title: 'Standard gravity g0', unit: 'm/s²', d: (v) => String(v).split('.')[1].length },
  rot: { title: 'Earth surface rotation speed at the equator', unit: 'km/s', d: (v) => String(v).split('.')[1].length },
  energy: { title: 'Reboost energy per kilogram thrown', unit: 'MJ/kg mechanical; kWh/kg electrical where marked', d: (v) => (Number.isInteger(v) ? 0 : Math.min(2, String(v).split('.')[1].length)) },
};

function concordance(r) {
  const a = r.analysis;
  say('1. CONCORDANCE: every line in either repository that states the constant (rows verified this run)');
  for (const fam of ['mu', 'R', 'g0', 'rot', 'energy']) {
    const meta = FAM[fam];
    const groups = a.groups[fam];
    say('');
    const ref = fam === 'energy' ? `Skyhook finance 2·v_orb·v_tip at 2.5 km/s = ${f(a.reboostRows[0].byEarth.skyhook.momentum, 2)} (finance/skyhook_finance.py:215)`
      : fam === 'mu' ? 'Skyhook canon (params/rev_a.json:11)' : 'Skyhook physics module (physics/skyhook_physics.py)';
    say(`${meta.title} [${meta.unit}]`);
    say(`  relative to: ${ref}`);
    const rows = [];
    for (const g of groups) {
      const kwh = g.rows.every((row) => row.unit === 'kWhkg');
      const label = g.family === 'elec' ? `${f(g.value, 0)} kWh/kg el.` : kwh ? `${f(g.value, 2)} (= ${g.rows[0].literal} kWh/kg)` : f(g.value, meta.d(g.value));
      const byRole = {};
      for (const row of g.rows) {
        const k = `${REPO[row.repo]} ${Reg.ROLES[row.role]}`;
        (byRole[k] ||= []).push(row);
      }
      let first = true;
      for (const [k, rs] of Object.entries(byRole)) {
        const tags = rs.map((row) => `${where(row)}${row.kind === 'comment' ? ' (comment)' : row.kind.startsWith('implied') ? ' (implied)' : row.kind === 'equivalent' ? ' (as m per s of UT1)' : row.approx ? ' (~)' : ''}`);
        // wrap the file:line list so the table stays readable
        const lines = [];
        let cur = '';
        for (const t of tags) {
          if (cur && (cur + ', ' + t).length > 66) {
            lines.push(cur + ',');
            cur = t;
          } else cur = cur ? `${cur}, ${t}` : t;
        }
        lines.push(cur);
        lines.forEach((ln, i) => {
          rows.push([first && i === 0 ? label : '', first && i === 0 ? (g.rel == null ? '' : M.fmtRel(g.rel)) : '', i === 0 ? k : '', ln]);
        });
        first = false;
      }
    }
    table(['value', 'rel. diff', 'where', 'file:line'], rows, ['r', 'r', 'l', 'l']);
    if (fam === 'rot') sayw('Aster src/v2 states no Earth rotation rate: refused, not zero (what would help: Slice 21 plans one, strategy/ASTER_ROADMAP_2026-08.md:283-285).');
    if (fam === 'energy') {
      const claim = r.rows.find((x) => x.id === 'sk-manifest-claim-71');
      if (claim) sayw(`Also: ${where(claim)} says the founding document's figure became "30–60 MJ/kg"; ${where(r.rows.find((x) => x.id === 'sk-doc-energy-218'))} still says ~30.`);
    }
    if (r.scans) {
      for (const s of Object.values(r.scans)) {
        for (const sum of Object.values(s.summaries)) {
          const vals = Object.entries(sum.byValue).filter(([k]) => k.startsWith(`${fam} `)).map(([k, n]) => `${k.slice(fam.length + 1)} ×${n}`);
          if (vals.length) sayw(`Not in the table: ${REPO[s.repo]} ${sum.why.split(',')[0].split(' (')[0]} (${sum.files.length} files) states ${vals.join(', ')}.`);
        }
      }
    }
  }
  say('');
}

function earths(r) {
  say('2. THE EARTHS (each value comes from a concordance row above)');
  const rows = r.analysis.earths.map((e) => [e.label, f(e.mu, 4), f(e.R, 3), f(e.g0, 5), e.vRot == null ? 'none (refused)' : f(e.vRot, 3)]);
  table(['Earth', 'μ km³/s²', 'R km', 'g0 m/s²', 'v_rot km/s'], rows, ['l', 'r', 'r', 'r', 'r']);
  for (const e of r.analysis.earths) {
    const src = ['mu', 'R', 'g0', 'vRot'].map((k) => (e.sources[k] ? `${k} ${where(r.rows.find((x) => x.id === e.sources[k].id))}` : null)).filter(Boolean).join('; ');
    sayw(`${e.label}: ${src}`, '  ', '    ');
  }
  say(`  Aster's R is its parking radius minus the altitude the porkchop page discloses (${f(r.analysis.parkingAltitudeKm, 0)} km).`);
  say('');
}

function canon(r) {
  const a = r.analysis;
  say('3. params/rev_a.json RECOMPUTED FROM ITS OWN INPUTS ON EACH EARTH (✓ = rounds to the printed value)');
  const S = a.canonTables.skyhook;
  const A = a.canonTables.aster;
  const C = a.canonTables['canon-com'];
  const rows = [];
  for (let i = 0; i < S.length; i++) {
    const q = S[i];
    if (!q.depends.length) continue;
    const cell = (t) => (t.refused ? 'refused' : `${f(t.value, Math.max(2, M.decimalsOf(q.printed ?? 0) + 2))} ${t.reproduces ? '✓' : '✗'}`);
    const delta = !A[i].refused && !q.refused && q.value != null && A[i].value != null ? sgn(A[i].value - q.value, Math.max(2, M.decimalsOf(q.printed ?? 0) + 2)) : '';
    rows.push([q.path.replace('kinematics.cislunar_revenue_gated_option', 'cislunar').replace('kinematics.phase3_growth_option', 'phase3').replace(/^kinematics\./, 'ref.').replace('market_thresholds.', 'mkt.'),
      M.fmtPrinted(q.printed), cell(q), cell(A[i]), delta, cell(C[i])]);
  }
  table(['key (Earth-dependent)', 'printed', 'Skyhook Earth', 'Aster Earth', 'Aster − Skyhook', 'R from com_radius'], rows, ['l', 'r', 'r', 'r', 'r', 'r']);
  const indep = S.filter((q) => !q.depends.length);
  say('');
  say(`  ${indep.length} more values need no Earth constant and are identical on all three Earths; all reproduce:`);
  const short = (p) => p.replace('mass_ratio.integrated_tether_to_payload_both_arms.', 'EQ-6 ').replace('kinematics.cislunar_revenue_gated_option.', 'cislunar ')
    .replace('kinematics.phase3_growth_option.', 'phase3 ').replace('integrated_mass_ratio_30pct_derate_both_arms', 'mass ratio').replace(/^(geometry|materials|mass_ratio)\./, '');
  const list = indep.map((q) => `${short(q.path)} ${q.printed} (${f(q.value, M.decimalsOf(q.printed) + 2)})`);
  for (let i = 0; i < list.length; i += 2) say(`    ${list.slice(i, i + 2).join(' · ')}`);
  const refused = S.filter((q) => q.refused);
  for (const q of refused) sayw(`refused: ${q.path} (${q.printed}): ${q.refused.reason}; what would help: ${q.refused.what_would_help}`);
  say('');
}

function iface(r) {
  const a = r.analysis;
  say('4. THE K2 INTERFACE: what the Earth choice moves (Skyhook Earth → Aster Earth)');
  const rows = a.iface.map((t) => [t.label, f(t.c3.A, 4), f(t.c3.B, 4), sgn(t.c3.shift.both, 4), sgn(t.c3.shift.muOnly, 6), sgn(t.c3.shift.rOnly, 4), sgn(t.c3.shift.mixed, 4)]);
  table(['tier', 'C3 Skyhook', 'C3 Aster', 'Δ both', 'Δ μ only', 'Δ R only', 'Δ mixed*'], rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r']);
  say('  * mixed: v_orb from the Skyhook Earth, r_tip from the Aster Earth: one program\'s speed with the other\'s radius.');
  say('');
  const ap = a.iface.filter((t) => t.apogee.A != null).map((t) => [t.label, f(t.apogee.A, 0), f(t.apogee.B, 0), sgn(t.apogee.B - t.apogee.A, 0), `${sgn((100 * (t.apogee.B - t.apogee.A)) / t.apogee.A, 2)} %`, sgn(t.apogee.mixed - t.apogee.A, 0)]);
  table(['apogee altitude', 'Skyhook km', 'Aster km', 'Δ km', 'Δ', 'Δ mixed km'], ap, ['l', 'r', 'r', 'r', 'r', 'r']);
  say('');
  const k = a.iface.map((t) => [t.label, t.vInfStar.A == null ? 'none (C3 < 0)' : `${f(t.vInfStar.A, 4)} → ${f(t.vInfStar.B, 4)}`, `${f(t.trim0.A, 4)} → ${f(t.trim0.B, 4)}`,
    `${f(t.injection.AonA, 4)} → ${f(t.injection.BonB, 4)}`, sgn(1000 * (t.injection.BonB - t.injection.AonA), 2)]);
  table(['tier', 'v∞* km/s', 'trim at v∞=0 km/s', 'Aster injection to this C3', 'Δ m/s'], k, ['l', 'r', 'r', 'r', 'r']);
  sayw(`Aster injection: src/v2/porkchop/delta-v.ts:18-26 from a ${f(a.parkingAltitudeKm, 0)} km parking orbit, on each Earth. Earth rotation enters none of these.`);
  say('');
  const pins = a.pins.map((p) => [`C3 = ${p.c3}`, p.printed, `${f(p.dvAster, 4)} ${p.reproduces ? '✓' : '✗'}`, `${f(p.dvSky, 4)} ${p.reproducesOnSkyhook ? '✓' : '✗'}`, p.where]);
  say('  Aster\'s own published injection values, recomputed with its function on each Earth:');
  table(['case', 'published km/s', 'Aster Earth', 'Skyhook Earth', 'published at'], pins, ['l', 'r', 'r', 'r', 'l']);
  say('');
}

function reboost(r) {
  const a = r.analysis;
  say('5. REBOOST ENERGY PER KILOGRAM THROWN (MJ/kg = km²/s²)');
  const rows = a.reboostRows.map((t) => [t.label, f(t.byEarth.skyhook.momentum, 2), f(t.byEarth.skyhook.orbital, 2), f(t.byEarth.skyhook.angular, 2), f(t.byEarth.skyhook.groundRel, 2), f(t.byEarth.aster.orbital, 2)]);
  table(['tier', '2·v_orb·v_tip', 'orbital energy', 'n·ΔH check', 'ground-rel catch', 'orbital, Aster Earth'], rows, ['l', 'r', 'r', 'r', 'r', 'r']);
  const ref = a.reboostRows[0].byEarth.skyhook;
  sayw(`The orbital-energy view adds μ(1/r_low − 1/r_tip) = ${f(ref.potential, 3)} MJ/kg to 2·v_orb·v_tip (+${f((100 * ref.potential) / ref.momentum, 1)}\u00a0%), the lever-arm term the finance model leaves out; n·ΔH (mean motion times the payload's angular-momentum gain) agrees with it to ${f((100 * Math.abs(ref.angular - ref.orbital)) / ref.orbital, 2)}\u00a0%. The ground-relative column uses the catch speed in the wrong frame and is shown only because it is the nearest principled reading to MP-001's ${a.target}.`);
  const s = a.sweep;
  sayw(`Sweep: ${s.length} readings of the canon (${new Set(s.map((x) => x.R)).size} radii × v_orb computed or printed × release computed or printed × 3 catch speeds × 4 potential terms); none rounds to ${a.target}. Nearest: ${f(s[0].value, 2)} (${s[0].catchName}, ${s[0].peName}, ${s[0].vOrbName}, R ${s[0].R}).`);
  say('');
  if (!a.gridCheck.refused) {
    say('  finance/decision_grid.json reboost_electricity_per_kg = E / η / 3.6 × $/kWh (η, $/kWh: workbook Assumptions rows 6, 7):');
    const g = a.gridCheck.points.map((p) => [p.tier, p.column, f(p.eta, 2), f(p.price, 2), f(p.published.reboost_electricity_per_kg, 4),
      `${f(p.dollars.skyhook.momentum, 4)} ${M.reproduces(p.dollars.skyhook.momentum, p.published.reboost_electricity_per_kg) ? '✓' : '✗'}`,
      `${f(p.dollars.aster.momentum, 4)} ${M.reproduces(p.dollars.aster.momentum, p.published.reboost_electricity_per_kg) ? '✓' : '✗'}`,
      `${f(p.dollars.skyhook.orbital, 4)} (${sgn(p.dollars.skyhook.orbital - p.published.reboost_electricity_per_kg, 2)})`, f(p.published.marginal_cost_per_kg, 2)]);
    table(['tier', 'column', 'η', '$/kWh', 'published $/kg', '2·v_orb·v_tip', 'same, Aster Earth', 'orbital view', 'marginal $/kg'], g, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
    const prop = Object.entries(a.gridCheck.proportionality).map(([c, p]) => `${c} ${f(p.min, 4)}–${f(p.max, 4)}`).join(', ');
    sayw(`published $/kg ÷ v_tip per column (constant iff the line is linear in v_tip): ${prop}.`);
  }
  say('');
}

function gates(r) {
  say('6. RECONCILIATION GATES');
  for (const g of r.analysis.gates) sayw(`${g.ok ? 'pass' : 'FAIL'}  ${g.id}: ${g.detail}`, '  ', '        ');
  say('');
}

function header(r) {
  say('WHOSE EARTH — the Earth constants Aster and Skyhook compute on, and what the differences do at the K2 interface');
  for (const k of ['aster', 'skyhook']) {
    const s = r.sources[k];
    say(`${REPO[k].padEnd(8)}${(s.commit || 'unknown').slice(0, 7)}  ${s.from === 'checkout' ? `${(s.commitDate || '').slice(0, 10)}  ${s.dir}` : 'from snapshots/ and data.js (offline)'}`);
  }
  const st = r.rows.reduce((acc, x) => ((acc[x.status] = (acc[x.status] || 0) + 1), acc), {});
  say(`Registry: ${r.rows.length} rows; ${Object.entries(st).map(([k, n]) => `${n} ${k}`).join(', ')}.`);
  if (st.saved) say('  saved = line text from the run recorded in data.js at the commits above; not re-verified offline.');
  if (r.scans) {
    const s = r.scans;
    say(`Scan: Aster ${s.aster.filesScanned} files, ${s.aster.hits.length} lines with a candidate; Skyhook ${s.skyhook.filesScanned} files, ${s.skyhook.hits.length} lines; ${r.unregistered.length} not in the registry.`);
  } else say(r.offline ? 'Scan: not run (offline).' : 'Scan: skipped (--no-scan).');
  say('');
}

function summary(r) {
  const a = r.analysis;
  const S = a.earths.find((e) => e.id === 'skyhook');
  const A = a.earths.find((e) => e.id === 'aster');
  const ref = a.iface[0];
  const cis = a.iface[1];
  const shifts = a.iface.map((t) => t.c3.shift.both);
  const reb = a.reboostRows[0].byEarth.skyhook;
  const cons = a.gridCheck.refused ? null : a.gridCheck.points.find((p) => p.tier === 'reference' && p.column === 'Conservative');
  const nonS = a.canonTables.skyhook.filter((q) => q.depends.length && q.reproduces === false).length;
  const nonA = a.canonTables.aster.filter((q) => q.depends.length && q.reproduces === false).length;
  say('In short');
  const H = '      ';
  sayw(`μ   Aster ${f(A.mu, 4)} vs Skyhook ${f(S.mu, 0)} km³/s² (${M.fmtRel((A.mu - S.mu) / S.mu)}): moves the tether C3 by ${sgn(ref.c3.shift.muOnly, 6)} km²/s². Negligible.`, '  ', H);
  sayw(`R   Aster ${f(A.R, 3)} (WGS84 a, implied by its 200 km parking orbit) vs Skyhook ${f(S.R, 0)} (mean): C3 ${sgn(Math.min(...shifts), 3)} to ${sgn(Math.max(...shifts), 3)} km²/s² with each program self-consistent, ${sgn(ref.c3.shift.mixed, 3)} if one's speed meets the other's radius; cislunar apogee ${sgn(cis.apogee.B - cis.apogee.A, 0)}\u00a0km (${sgn((100 * (cis.apogee.B - cis.apogee.A)) / cis.apogee.A, 2)}\u00a0%). rev_a.json is on neither Earth alone: ${nonS} Earth-dependent values miss on Skyhook's, ${nonA} on Aster's (its orbital block is 6378, its kinematics 6371).`, '  ', H);
  sayw(`g0  9.80665 in both programs' code; Skyhook's two browser sims divide by 9.81 (${M.fmtRel((9.81 - S.g0) / S.g0)}).`, '  ', H);
  sayw(`rot Skyhook hard-codes ${f(S.vRot, 3)} km/s in code (the canon has it only in a note); Aster states none. It enters no K2 quantity, only the lower-tip ground speed.`, '  ', H);
  sayw(`E   Reboost per kg: finance 2·v_orb·v_tip = ${f(reb.momentum, 2)} MJ/kg; the orbital energy the tether gives up is ${f(reb.orbital, 2)} (${sgn((100 * reb.potential) / reb.momentum, 1)}\u00a0%); MP-001 says ${a.target}, which none of ${a.sweep.length} readings of the canon reproduces${cons ? `; at the conservative column the gap is ${sgn(cons.dollars.skyhook.orbital - cons.published.reboost_electricity_per_kg, 2)} $/kg on ${f(cons.published.marginal_cost_per_kg, 2)} $/kg marginal` : ''}.`, '  ', H);
  say('');
}

function footer(r) {
  for (const d of r.drift) say(`DRIFT ${d.id}: ${d.repo} ${d.path}:${d.line} ${d.status}${d.foundLine ? ` (now line ${d.foundLine})` : ''}${d.candidates ? ` (lines ${d.candidates.join(', ')})` : ''}`);
  for (const u of r.unregistered) say(`UNREGISTERED ${u.family} ${u.path}:${u.line} ${JSON.stringify(u.matches)}  ${u.text}`);
  say(r.ok ? 'Result: every row on its stated line, nothing unregistered, every gate holds.' : `Result: ${r.drift.length} drifted rows, ${r.unregistered.length} unregistered occurrences, ${r.failedGates.length} failed gates.`);
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error(`${o.error}\n\n${USAGE}`);
    process.exitCode = 3;
    return;
  }
  if (o.help) {
    console.log(USAGE);
    return;
  }
  const r = collect(o);
  if (r.refused) {
    if (o.json) console.log(JSON.stringify({ refusal: r.refused }, null, 1));
    else console.error(`refused (${r.refused.code}): ${r.refused.reason}\nwhat would help: ${r.refused.what_would_help}`);
    process.exitCode = 2;
    return;
  }
  if (o.json) {
    const { inputs, ...rest } = r;
    console.log(JSON.stringify(Object.assign(rest, { inputs_read: Object.keys(inputs) }), (k, v) => (v instanceof Set ? [...v] : v), 1));
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  const parts = { concordance, earths, canon, interface: iface, reboost, gates };
  if (o.section === 'all') {
    header(r);
    summary(r);
    for (const p of Object.values(parts)) p(r);
  } else parts[o.section](r);
  footer(r);
  console.log(out.join('\n'));
  // exitCode, not process.exit(): a pipe is written asynchronously and exit() would cut long output short
  process.exitCode = r.ok ? 0 : 1;
}

main();
