#!/usr/bin/env node
// census.mjs — the Confidence Census as a command-line linter.
//
//   node census.mjs <partforge-checkout> [--json findings.json] [--md summary.md] [--quiet]
//   node census.mjs --snapshot [...]          run on the snapshots committed in this folder
//
// Reads data/tables/*.json, data/README.md and docs/data/PROVENANCE.md from the checkout (it never
// writes there), prints a Markdown summary, and exits 1 if any finding is a defect, 0 if none,
// 2 on a usage or input error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadCheckout, loadSnapshots } from './checkout.mjs';

const require = createRequire(import.meta.url);
const Census = require('./census.js');
const here = path.dirname(fileURLToPath(import.meta.url));

const HELP = `Confidence Census — lint PartForge's reference tables against what they say about themselves.

Usage:
  node census.mjs <partforge-checkout> [--json <file>] [--md <file>] [--quiet]
  node census.mjs --snapshot [--json <file>] [--md <file>] [--quiet]

  <partforge-checkout>  a PartForge working tree (reads data/tables/*.json, data/README.md,
                        docs/data/PROVENANCE.md; nothing is written there)
  --snapshot            use the lint views committed under snapshots/ instead of a checkout
  --json <file>         write the findings JSON (meta, summary, census, reconciliation, findings)
  --md <file>           write the Markdown summary to a file
  --quiet               do not print the summary

Exit: 1 if any finding has severity "defect", 0 if none, 2 on a usage or input error.
Rules and severities: see README.md "How it works".`;

function main(argv) {
  const opts = { json: null, md: null, quiet: false, snapshot: false, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(HELP); return 0; }
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--md') opts.md = argv[++i];
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--snapshot') opts.snapshot = true;
    else if (a.startsWith('-')) { console.error(`unknown option ${a}\n\n${HELP}`); return 2; }
    else if (!opts.repo) opts.repo = a;
    else { console.error(`one checkout only\n\n${HELP}`); return 2; }
  }
  if ((opts.json === undefined) || (opts.md === undefined)) { console.error(`--json and --md need a file\n\n${HELP}`); return 2; }
  if (!opts.snapshot && !opts.repo) { console.error(HELP); return 2; }
  let input;
  try {
    input = opts.snapshot ? loadSnapshots(here) : loadCheckout(path.resolve(opts.repo));
  } catch (e) {
    console.error(`census: ${e.message}`);
    return 2;
  }
  const res = Census.run(input.views, input.policy);
  const md = Census.toMarkdown(res);
  if (opts.json) fs.writeFileSync(opts.json, Census.serialize(res));
  if (opts.md) fs.writeFileSync(opts.md, md);
  if (!opts.quiet) process.stdout.write(md);
  return res.summary.exit;
}

process.exitCode = main(process.argv.slice(2));
