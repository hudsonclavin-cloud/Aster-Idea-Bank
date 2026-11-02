// checkout.mjs — reads a PartForge checkout into the census inputs: one lint view per
// data/tables/*.json (census.js viewOf) and the policy extract (the data/README.md policy table
// and the docs/data/PROVENANCE.md headings and "Overall confidence" lines, with line numbers).
// Shared by census.mjs (the CLI) and build-data.mjs (which writes the committed snapshots), so a
// run on the checkout and a run on the snapshots see the same bytes. Reads only; the one git call
// is `git rev-parse HEAD`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Census = require('./census.js');

export const README_PATH = 'data/README.md';
export const PROVENANCE_PATH = 'docs/data/PROVENANCE.md';
export const TABLES_DIR = 'data/tables';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function headCommit(repo) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// The lines of each policy document the parsers read, with their 1-based line numbers.
export function extractReadme(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\|\s*table\s*\|\s*what\s*\|\s*rows\s*\|\s*confidence policy\s*\|\s*$/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start; i < lines.length && /^\|/.test(lines[i]); i++) out.push({ n: i + 1, text: lines[i] });
  return out;
}
export function extractProvenance(text) {
  return text.split('\n').map((t, i) => ({ n: i + 1, text: t })).filter((l) => /^##\s+\d+\.\s/.test(l.text) || /^\*\*Overall confidence:\*\*/.test(l.text));
}

export function loadCheckout(repo) {
  const commit = headCommit(repo);
  const dir = path.join(repo, TABLES_DIR);
  if (!fs.existsSync(dir)) throw new Error(`no ${TABLES_DIR} under ${repo}`);
  const views = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const buf = fs.readFileSync(path.join(dir, f));
    let t;
    try {
      t = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error(`${TABLES_DIR}/${f} is not JSON: ${e.message}`);
    }
    views.push(Census.viewOf(f.replace(/\.json$/, ''), t, { path: `${TABLES_DIR}/${f}`, commit, sha256: sha256(buf) }));
  }
  const policy = {};
  for (const [k, rel, extract] of [['readme', README_PATH, extractReadme], ['provenance', PROVENANCE_PATH, extractProvenance]]) {
    const p = path.join(repo, rel);
    if (!fs.existsSync(p)) { policy[k] = { path: rel, commit, sha256: null, lines: [] }; continue; }
    const buf = fs.readFileSync(p);
    policy[k] = { path: rel, commit, sha256: sha256(buf), lines: extract(buf.toString('utf8')) };
  }
  return { views, policy, commit };
}

// The snapshot files: a classic script that registers itself on window, and module.exports in Node.
export function viewModule(v) {
  return `// Lint view of PartForge ${v.source.path} at ${String(v.source.commit).slice(0, 7)} — written by build-data.mjs (census.js viewOf).\n` +
    `(function (root, v) { if (typeof module === 'object' && module.exports) module.exports = v; else (root.CENSUS_VIEWS = root.CENSUS_VIEWS || {})[v.table] = v; })(typeof self !== 'undefined' ? self : this,\n` +
    JSON.stringify(v) + ');\n';
}
export function policyModule(kind, p) {
  const what = kind === 'readme' ? 'the data/README.md confidence-policy table' : 'the docs/data/PROVENANCE.md table headings and "Overall confidence" lines';
  return `// ${what} at PartForge ${String(p.commit).slice(0, 7)}, with line numbers — written by build-data.mjs.\n` +
    `(function (root, k, p) { if (typeof module === 'object' && module.exports) module.exports = p; else (root.CENSUS_POLICY = root.CENSUS_POLICY || {})[k] = p; })(typeof self !== 'undefined' ? self : this, ${JSON.stringify(kind)},\n` +
    JSON.stringify(p, null, 1) + ');\n';
}

// The committed snapshots, read back in Node (the CLI's --snapshot mode and the tests).
export function loadSnapshots(here) {
  const dir = path.join(here, 'snapshots', 'views');
  const views = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => require(path.join(dir, f)));
  const policy = { readme: require(path.join(here, 'snapshots', 'readme-policy.js')), provenance: require(path.join(here, 'snapshots', 'provenance-overall.js')) };
  return { views, policy };
}
