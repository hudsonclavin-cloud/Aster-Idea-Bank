#!/usr/bin/env node
// reach-census: for every test file in one or more checkouts, which runner reaches it and which
// CI job runs that runner. Reads only; runs no test and no runner. Node built-ins only.
//
//   node reach-census.mjs <checkout> [<checkout> ...] [options]
//
// See --help. Exit codes: 0 clean, 1 files at or beyond --fail-on outside the allow list,
// 2 census incomplete (a CI step or package script it does not understand), 3 usage error.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const C = require('./census.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `reach-census — which runner reaches each test file, and which CI job runs that runner

Usage:
  node reach-census.mjs <checkout> [<checkout> ...] [options]

A test file is any tracked *.test.{mjs,cjs,js,ts,mts,cts}, *.spec.*, test_*.py or *_test.py,
plus extra candidates declared per repository in the config file. Runners are read from
.github/workflows/*.yml run steps, every package.json script, and runner commands written in the
repository's Markdown (code spans and code blocks). Two Node runner-script shapes are read (a
list/readdir/conditional launcher and a recursive directory walker); anything else that looks
like it launches tests is reported as "not understood", never as reached.

Classes, best first:
  ci        a CI workflow step reaches the file
  ci-less   a package script or a documented suite command reaches it; no CI step does
  manual    only one-file commands written in docs reach it
  orphan    nothing reaches it

Options:
  --fail-on <class>   exit 1 when a file is in this class or worse (ci-less, manual, orphan;
                      default orphan), unless the allow list covers it
  --allow <file>      JSON allow list: [{"repo","glob","upTo","reason","cite"}]
  --config <file>     per-repository config (default: census.config.json beside this script)
  --no-config         ignore the config file (no extra candidates, local Node unknown)
  --node <major>      Node major version assumed for package scripts and docs (default: the
                      config's localNode, else 22); CI steps use their setup-node version
  --json <file>       also write the full census as JSON ('-' for stdout, text then suppressed)
  --md <file>         also write a Markdown matrix
  --verbose           list documented commands the census could not read
  -h, --help          this text

Exit: 0 clean · 1 files at or beyond --fail-on · 2 census incomplete · 3 usage error`;

function die(msg) { console.error(`reach-census: ${msg}\n(try --help)`); process.exit(3); }

function parseArgs(argv) {
  const o = { repos: [], failOn: 'orphan', allow: null, config: path.join(HERE, 'census.config.json'), useConfig: true, node: null, json: null, md: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) die(`${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--fail-on') o.failOn = val();
    else if (a === '--allow') o.allow = val();
    else if (a === '--config') o.config = val();
    else if (a === '--no-config') o.useConfig = false;
    else if (a === '--node') { o.node = Number(val()); if (!Number.isInteger(o.node) || o.node < 16) die('--node needs a major version such as 20 or 24'); }
    else if (a === '--json') o.json = val();
    else if (a === '--md') o.md = val();
    else if (a === '--verbose') o.verbose = true;
    else if (a.startsWith('-')) die(`unknown option ${a}`);
    else o.repos.push(a);
  }
  if (!o.repos.length) die('name at least one checkout');
  if (!['ci-less', 'manual', 'orphan'].includes(o.failOn)) die(`--fail-on must be ci-less, manual or orphan (got ${o.failOn})`);
  return o;
}

function git(dir, args) {
  try { return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch { return null; }
}

// The tracked file list is what a fresh CI checkout contains. Outside a git checkout the
// directory is walked instead (skipping .git and node_modules).
export function listFiles(dir) {
  const out = git(dir, ['ls-files', '-z']);
  if (out != null) return { files: out.split('\0').filter(Boolean), tracked: true };
  const files = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) files.push(r);
    }
  };
  walk('');
  return { files, tracked: false };
}

export function repoId(dir) {
  const url = git(dir, ['remote', 'get-url', 'origin']);
  if (url) return url.trim().replace(/\.git$/, '').split(/[/:]/).pop();
  return path.basename(path.resolve(dir));
}

const TEXT_EXT = /\.(md|markdown|html|htm|ya?ml|json|txt|sh|toml|cfg|ini)$/i;
const MAX_TEXT = 4 << 20;

// A live tree over a checkout: reads files from disk, extracts documented commands from every
// tracked Markdown file, and finds where a path is named in tracked text files.
export function liveTree(dir, config) {
  const { files, tracked } = listFiles(dir);
  const id = repoId(dir);
  const read = (p) => {
    const abs = path.join(dir, p);
    try { const st = fs.statSync(abs); if (!st.isFile() || st.size > MAX_TEXT * 4) return null; return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  };
  const docs = files.filter((f) => /\.md$/i.test(f) && !f.split('/').includes('node_modules'));
  const docCommands = [];
  for (const f of docs) {
    const t = read(f);
    if (t != null && t.length <= MAX_TEXT) for (const c of C.extractDocCommands(t, f)) docCommands.push(c);
  }
  const mentionsFor = (paths) => {
    const out = {};
    const texts = files.filter((f) => TEXT_EXT.test(f));
    for (const f of texts) {
      const t = read(f);
      if (t == null || t.length > MAX_TEXT) continue;
      const lines = t.split('\n');
      for (const p of paths) {
        if (f === p) continue;
        const base = p.split('/').pop();
        if (!t.includes(base)) continue;
        lines.forEach((l, i) => { if (l.includes(p)) (out[p] ||= []).push({ file: f, line: i + 1 }); });
      }
    }
    return out;
  };
  return C.makeTree({
    id, label: (config && config.label) || id,
    commit: tracked ? (git(dir, ['rev-parse', 'HEAD']) || '').trim() || null : null,
    files, read, docCommands, mentionsFor, config: config || {},
  });
}

export function loadConfig(file, useConfig) {
  if (!useConfig || !file) return {};
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).repos || {}; } catch (e) { die(`config ${file}: ${e.message}`); }
}

function configFor(all, id) {
  const k = Object.keys(all).find((x) => x.toLowerCase() === String(id).toLowerCase());
  return k ? all[k] : {};
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const cfgAll = loadConfig(o.config, o.useConfig);
  let allow = [];
  if (o.allow) {
    try { allow = JSON.parse(fs.readFileSync(o.allow, 'utf8')); } catch (e) { die(`allow list ${o.allow}: ${e.message}`); }
    if (!Array.isArray(allow)) die('the allow list must be a JSON array');
    for (const a of allow) if (!a.glob || !a.reason) die('every allow entry needs "glob" and "reason"');
  }
  const trees = [];
  for (const r of o.repos) {
    if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) die(`not a directory: ${r}`);
    const id = repoId(r);
    const cfg = Object.assign({}, configFor(cfgAll, id));
    if (o.node) { cfg.localNode = o.node; cfg.localNodeSource = '--node'; }
    trees.push(liveTree(r, cfg));
  }
  let result;
  try { result = C.census(trees, { failOn: o.failOn, allow }); } catch (e) { die(e.message); }
  if (o.json) {
    const text = JSON.stringify(result, null, 1) + '\n';
    if (o.json === '-') process.stdout.write(text);
    else fs.writeFileSync(o.json, text);
  }
  if (o.md) fs.writeFileSync(o.md, C.renderMarkdown(result));
  if (o.json !== '-') process.stdout.write(C.renderText(result, { verbose: o.verbose }) + '\n');
  // let stdout drain before exiting (a piped stdout is asynchronous)
  process.exitCode = result.exit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
