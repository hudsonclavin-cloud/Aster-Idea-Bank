#!/usr/bin/env node
// Tip Match on the command line: the same K2 kernel as index.html, printing Aster-shaped
// evidence envelopes. Node built-ins only. From the bank root:
//   node ideas/01-tip-match/tip-match.mjs --vinf 3.61 --tier phase3
//   node ideas/01-tip-match/tip-match.mjs --vinf 0 --tier reference --tol 1 --text
// Exit 0: the energy question was answered (its plane and phase companions are always refusals).
// Exit 1: the energy question itself was refused (bad v∞, unknown tier, canon missing a key).
// Exit 2: usage error.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TipMatch = require(path.join(here, 'tip-match.js'));
const REV_A = require(path.join(here, 'snapshots', 'rev_a.data.js'));

const HELP = `Tip Match — can a payload arriving at Earth with hyperbolic excess speed v∞ be met at a
rotating tether's upper tip, and what trim Δv remains? Energy condition only; plane and
phase are structured refusals. Tether constants come from the snapshot of Skyhook
params/rev_a.json in ./snapshots (nothing retyped).

Usage: node ideas/01-tip-match/tip-match.mjs --vinf <km/s> [--tier reference|cislunar|phase3]
                                             [--tol <m/s>] [--as-of YYYY-MM-DD] [--text] [--source typed|aster-cache]

  --vinf     Earth-arrival v∞ in km/s (0 = parabolic arrival). Required.
  --tier     tip-speed tier from rev_a.json: reference (2.5), cislunar (2.8), phase3 (3.5). Default reference.
  --tol      grapple relative-velocity tolerance in m/s the "energy-matched" flag uses. Default 1.
  --as-of    date stamped into the envelopes (default today), so saved output is reproducible.
  --source   where v∞ comes from; "aster-cache" is refused (no such quantity exists). Default typed.
  --text     human-readable summary instead of JSON.
  --help     this text.

Output (JSON): { "energy": envelope, "plane": envelope, "phase": envelope } — or, with
--source aster-cache, { "vinf_source": refusal envelope }. Exit codes: 0 answered, 1 refused, 2 usage.`;

function parseArgs(argv) {
  const o = { tier: 'reference', tol: 1, text: false, source: 'typed', asOf: null, vinf: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--vinf') o.vinf = Number(next());
    else if (a === '--tier') o.tier = next();
    else if (a === '--tol') o.tol = Number(next());
    else if (a === '--as-of') o.asOf = next();
    else if (a === '--source') o.source = next();
    else if (a === '--text') o.text = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function fmt(q, digits) {
  return q === null || q === undefined ? '—' : `${q.value.toFixed(digits)} ${q.units}`;
}

function text(out) {
  const lines = [];
  if (out.vinf_source) {
    const r = out.vinf_source.refusal;
    lines.push(`REFUSED (${r.code}): ${r.reason}`, `What would help: ${r.what_would_help}`);
    return lines.join('\n');
  }
  const e = out.energy;
  if (!e.value) {
    const r = e.refusal;
    lines.push(`REFUSED (${r.code}): ${r.reason}`, `What would help: ${r.what_would_help}`);
    return lines.join('\n');
  }
  const v = e.value;
  const u = v.upper_tip;
  lines.push(`Tip Match ${v.kernel_version} — ${v.tier.label} tier, v_tip ${fmt(v.tier.v_tip_kms, 1)} (${v.tier.v_tip_path}), v∞ ${fmt(v.input.vinf_kms, 3)}`);
  lines.push(`Geometry: R_E ${fmt(v.geometry.earth_radius_km, 0)}, r_com ${fmt(v.geometry.r_com_km, 0)}, r_tip ${fmt(v.geometry.r_tip_km, 0)}, v_orb ${fmt(v.geometry.v_orb_kms, 4)}`);
  lines.push(`Upper tip, top of swing: tip ${fmt(u.v_tip_inertial_kms, 4)} vs payload ${fmt(u.v_payload_kms, 4)} → trim Δv ${fmt(u.trim_dv_kms, 4)} (${u.payload_faster_than_tip ? 'payload faster, retrograde trim' : 'payload slower, prograde trim'})`);
  lines.push(`Tier release energy: C3 ${fmt(u.c3_tier_kms2, 3)}, ${u.release_bound ? `bound, apogee ${fmt(u.apogee_altitude_km, 0)}` : 'hyperbolic'}; zero-trim v∞* ${u.vinf_star_kms ? fmt(u.vinf_star_kms, 4) : 'none (C3 < 0: every hyperbolic arrival overshoots this tip)'}`);
  lines.push(`Zero-trim tip speed for this v∞: ${fmt(v.zero_trim.tip_speed_needed_kms, 3)} = ${v.zero_trim.over_vc.value.toFixed(2)} × V_c${v.zero_trim.guardrail_over_vc ? ` (guardrail ${v.zero_trim.guardrail_over_vc.value}×: ${v.zero_trim.beyond_guardrail ? 'beyond' : 'inside'})` : ''}`);
  lines.push(`Lower tip: payload ${fmt(v.lower_tip.v_payload_kms, 3)} vs tip ${fmt(v.lower_tip.v_tip_inertial_kms, 3)} → ${v.lower_tip.verdict} (gap ${fmt(v.lower_tip.gap_kms, 3)})`);
  lines.push(`Match (tolerance ${fmt(v.match.tolerance_ms, 1)}): ${v.match.energy_matched ? 'ENERGY-MATCHED' : 'NOT MATCHED'} — ${v.match.verdict}`);
  for (const c of v.conditions) {
    if (c.status === 'computed') lines.push(`  ${c.condition}: computed`);
    else lines.push(`  ${c.condition}: REFUSED (${c.refusal.code}) — ${c.refusal.what_would_help}`);
  }
  lines.push(`Confidence ${e.confidence} (weakest of ${e.provenance.map((p) => p.confidence).join(', ')}); canon ${e.provenance[0].path} @ ${String(e.provenance[0].commit).slice(0, 7)}; as of ${e.as_of}`);
  return lines.join('\n');
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`tip-match: ${err.message}\n\n${HELP}`);
  process.exit(2);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.vinf === undefined && opts.source !== 'aster-cache') {
  console.error(`tip-match: --vinf is required\n\n${HELP}`);
  process.exit(2);
}

const kernel = TipMatch.create(REV_A.data, REV_A.provenance);
const asOf = opts.asOf || TipMatch.isoDate();
let out;
let code = 0;
if (opts.source !== 'typed') {
  out = { vinf_source: kernel.vinfSource(opts.source, { as_of: asOf }) };
  code = 1;
} else {
  const energy = kernel.energy({ vinf_kms: opts.vinf, tier: opts.tier, tolerance_ms: opts.tol, as_of: asOf });
  out = { energy, plane: kernel.plane({ as_of: asOf }), phase: kernel.phase({ as_of: asOf }) };
  code = energy.value ? 0 : 1;
}
for (const [k, env] of Object.entries(out)) {
  const problems = TipMatch.validateEnvelope(env);
  if (problems.length) {
    console.error(`tip-match: ${k} envelope would be rejected by Aster's validator: ${problems.join('; ')}`);
    process.exit(1);
  }
}
console.log(opts.text ? text(out) : JSON.stringify(out, null, 2));
process.exit(code);
