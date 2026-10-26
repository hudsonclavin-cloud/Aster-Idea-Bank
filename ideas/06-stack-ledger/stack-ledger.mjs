#!/usr/bin/env node
// Stack Ledger, command line: the same kernel (stack.js) over the same PartForge snapshots as the page.
//
//   node ideas/06-stack-ledger/stack-ledger.mjs <stack.json> [--json] [--repo <Partforge-dir> [--embedded]]
//   node ideas/06-stack-ledger/stack-ledger.mjs --example <id> [--json] [--repo <Partforge-dir> [--embedded]]
//   node ideas/06-stack-ledger/stack-ledger.mjs --list
//   node ideas/06-stack-ledger/stack-ledger.mjs --help
//
// Exit codes follow PartForge's headless/cli.mjs (0 pass, 1 fail, 2 refused, 3 usage), with one change: a stack
// never passes, so 0 is CLEARS, the worst case inside the requirement on a screening row; 1 FAIL; 2 refused or not
// gated (a stack with a contributor the tables cannot source, or with no requirement); 3 usage or unreadable input.
// --repo reads data/tables/{fits,materials_thermal,stock}.json live from a checkout instead of this folder's
// snapshots (all 192 stock rows become available); with --embedded it reads the app's own embedded copy instead,
// the FLIGHT_DB_DATA literal between index.html's DB-DATA markers (a projection: see build-data.mjs). The
// dbFit()/dbFitThermal() are the verbatim copies either way.
// Node built-ins only; no network.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractDbData } from './build-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(here, 'snapshots', 'partforge.js'));
const L = require(path.join(here, 'stack.js'));
const E = require(path.join(here, 'examples.js'));

const HELP = `Stack Ledger: a one-dimensional tolerance stack over PartForge's fits.json, stock.json and
materials_thermal.json. Worst case gates; RSS is printed as information; a contributor the tables
cannot source is refused with a reason.

usage: node ideas/06-stack-ledger/stack-ledger.mjs <stack.json> [--json] [--repo DIR [--embedded]]
       node ideas/06-stack-ledger/stack-ledger.mjs --example <id> [--json] [--repo DIR [--embedded]]
       node ideas/06-stack-ledger/stack-ledger.mjs --list
       node ideas/06-stack-ledger/stack-ledger.mjs --help

  <stack.json>     {gap_name, contributors:[...], require:{min_mm, max_mm}}; contributor kinds:
                   declared {nominal_mm, plus_mm, minus_mm | tol_mm, tol_src, tol_ref, dir}
                   fit      {size_mm, hole:["H",7], shaft:["g",6], dir}
                   iso      {size_mm, feature:"hole"|"shaft", letter, grade, dir}
                   stock    {key, surface:"od"|"id"|"thickness", tol_src?, tol_ref?, dir}
                   coating  {per_side_mm | [min,max], surfaces:1|2, src, dir (default -1)}
                   thermal  {D_mm, hole_mat, shaft_mat, dT_K:[low,high], hoop_cte?:{hole|shaft:{cte_um_m_K, src}}}
  --example <id>   run one of the shipped worked stacks (--list names them)
  --json           print the full result object instead of the ledger text
  --repo DIR       read the three tables live from a PartForge checkout instead of the snapshots
  --embedded       with --repo: read them from the app's embedded copy in index.html (the projection
                   tools/db/embed.mjs writes) instead of data/tables/*.json

A stack is a screening row: it can FAIL, or CLEAR the requirement on its worst case, but a clear is
never a pass, because nothing here measures the gap.

exit codes: 0 CLEARS (worst case inside the requirement) . 1 FAIL . 2 refused or not gated . 3 usage or unreadable input`;

function out(s) { process.stdout.write(`${s}\n`); }
function err(s) { process.stderr.write(`${s}\n`); }

function liveTables(repo) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(repo, 'data', 'tables', p), 'utf8'));
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a checkout */ }
  return { tables: { fits: read('fits.json'), materials_thermal: read('materials_thermal.json'), stock: read('stock.json') }, commit };
}
function embeddedTables(repo) {
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const { data, firstLine, lastLine } = extractDbData(html);
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a checkout */ }
  return { tables: { fits: data.fits, materials_thermal: data.materials_thermal, stock: data.stock }, commit, lines: `${firstLine}-${lastLine}` };
}

function main(argv) {
  const args = [...argv];
  const flags = { json: false, list: false, help: false, embedded: false, example: null, repo: null, file: null };
  while (args.length) {
    const a = args.shift();
    if (a === '--json') flags.json = true;
    else if (a === '--list') flags.list = true;
    else if (a === '--embedded') flags.embedded = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--example') flags.example = args.shift() ?? '';
    else if (a === '--repo') flags.repo = args.shift() ?? '';
    else if (a.startsWith('--')) { err(`unknown option ${a}\n\n${HELP}`); return 3; }
    else if (flags.file) { err(`one stack file at a time (got ${flags.file} and ${a})\n\n${HELP}`); return 3; }
    else flags.file = a;
  }
  if (flags.help) { out(HELP); return 0; }
  const examples = E.build(S);
  if (flags.list) {
    for (const ex of examples) out(`${ex.id.padEnd(26)} ${ex.title}`);
    return 0;
  }
  if (!flags.file && flags.example == null) { err(HELP); return 3; }
  if (flags.embedded && !flags.repo) { err(`--embedded needs --repo DIR\n\n${HELP}`); return 3; }

  let meta = { tables: 'snapshots', commit: S.provenance.commit, verbatim: `${S.verbatim.firstLine}-${S.verbatim.lastLine}` };
  if (flags.repo) {
    try {
      const live = flags.embedded ? embeddedTables(path.resolve(flags.repo)) : liveTables(path.resolve(flags.repo));
      S.useTables(live.tables);
      meta = { tables: flags.embedded ? `embedded DB-DATA block, index.html:${live.lines} of ${path.resolve(flags.repo)}` : `live checkout ${path.resolve(flags.repo)}`, commit: live.commit || 'unknown', verbatim: meta.verbatim };
    } catch (e) {
      err(`--repo: cannot read ${flags.embedded ? 'the DB-DATA block of index.html' : 'data/tables/*.json'} under ${flags.repo}: ${e.message}`);
      return 3;
    }
  }

  let stack;
  let source;
  if (flags.example != null) {
    const ex = E.byId(examples, flags.example);
    if (!ex) { err(`no example "${flags.example}"; --list names them`); return 3; }
    stack = ex.stack;
    source = `example ${ex.id}: ${ex.title}`;
  } else {
    let text;
    try { text = fs.readFileSync(flags.file, 'utf8'); } catch (e) { err(`cannot read ${flags.file}: ${e.message}`); return 3; }
    const p = L.parseStack(text);
    if (p.error) { err(`${flags.file}: ${p.error}`); return 3; }
    stack = p.stack;
    source = flags.file;
  }

  const ctx = L.create(S, meta);
  const res = L.stackUp(ctx, stack);
  if (flags.json) out(JSON.stringify({ source, result: res }, null, 1));
  else {
    out(`source: ${source}`);
    out(L.ledgerText(res));
  }
  return res.verdict === 'CLEARS' ? 0 : res.verdict === 'FAIL' ? 1 : 2;
}

process.exit(main(process.argv.slice(2)));
