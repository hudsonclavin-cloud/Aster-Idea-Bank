#!/usr/bin/env node
// Line Drift: checks every file:line citation, backticked repository path and commit hash in a
// repository's control-plane Markdown against the checkout, and reports which have moved, vanished,
// or point at ignored or untracked evidence. It reads; it never edits anything.
//
//   node line-drift.mjs <checkout> [options]
//
// Options:
//   --rev REV          read documents and targets from commit REV instead of the working tree
//   --doc PATH         check this document (repeatable; replaces the default set)
//   --json             print the full report as JSON
//   --markdown         print the counts and the drift findings as Markdown tables
//   --all              list every reference, not only drift (text and Markdown output)
//   --only S1,S2       list only findings with these statuses (counts stay complete)
//   --allow FILE       JSON allowlist: [{"doc":"STATUS.md","ref":"src/x.ts:12","line":418,"reason":"..."}]
//   --accept-annotated do not fail on drift whose own document says it is stale (listed anyway)
//   --no-history       skip re-judging drift at the commit it first appeared, the commit that last
//                      edited its line, and the commit its sentence names
//   -h, --help         this text
//
// Exit: 0 no unallowed drift; 1 drift found; 2 refused (no checkout, no documents, bad --rev or
// allowlist); 3 usage. Drift = MOVED, GONE, PAST-EOF, MISSING-PATH, IGNORED, UNTRACKED,
// UNREACHABLE-COMMIT. IN-RANGE, NOT-A-COMMIT and UNCHECKABLE are reported and never fail a run.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(path.join(here, 'linedrift.js'));

export const DEFAULT_DOCS = [
  'STATUS.md', 'INVARIANTS.md', 'AGENTS.md', 'README.md', 'mcp/README.md',
  { dir: '', re: /^SLICE_.*_FOUNDING\.md$/ },
  { dir: 'src/v2', re: /^SLICE_.*_FOUNDING\.md$/ },
  { dir: 'strategy', re: /\.md$/ },
];
const MAX_READ = 24 * 1024 * 1024;

// --help prints the comment block at the top of this file, and nothing below it.
const HELP = (() => {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines.slice(0, end < 0 ? lines.length : end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
})();

class Refusal extends Error {}
class Usage extends Error {}

function parseArgs(argv) {
  const o = { docs: [], json: false, markdown: false, all: false, only: null, allow: null, acceptAnnotated: false, history: true, rev: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Usage(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--rev') o.rev = val();
    else if (a === '--doc') o.docs.push(val());
    else if (a === '--json') o.json = true;
    else if (a === '--markdown') o.markdown = true;
    else if (a === '--all') o.all = true;
    else if (a === '--only') o.only = val().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--allow') o.allow = val();
    else if (a === '--accept-annotated') o.acceptAnnotated = true;
    else if (a === '--no-history') o.history = false;
    else if (a.startsWith('-')) throw new Usage(`unknown option ${a}`);
    else o.positional.push(a);
  }
  if (o.help) return o;
  if (o.positional.length !== 1) throw new Usage('give exactly one checkout directory');
  if (o.json && o.markdown) throw new Usage('--json and --markdown are exclusive');
  if (o.only) for (const s of o.only) if (!L.STATUSES.includes(s)) throw new Usage(`--only: unknown status ${s}`);
  return o;
}

// ---------------------------------------------------------------------------------------------
// git, never walking above the checkout (GIT_CEILING_DIRECTORIES), so a folder without its own
// .git is checked without git rather than against whatever repository contains it.

function makeGit(root) {
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root), GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const run = (args, input, opts = {}) => {
    const r = spawnSync('git', args, { cwd: root, env, input, encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return { ok: r.status === 0, status: r.status, out: r.stdout, err: r.stderr ? String(r.stderr) : '', error: r.error };
  };
  return run;
}

function gitInfo(root, git, rev) {
  const top = git(['rev-parse', '--show-toplevel']);
  if (!top.ok || !top.out || path.resolve(top.out.trim()) !== fs.realpathSync(root)) return { available: false, reason: top.error ? 'git not installed' : 'not the top of a git checkout' };
  const head = git(['rev-parse', rev || 'HEAD']);
  if (!head.ok) return { available: true, revError: `cannot resolve ${rev || 'HEAD'}` };
  const full = head.out.trim();
  const date = git(['log', '-1', '--format=%cI', full]).out.trim();
  const shallow = git(['rev-parse', '--is-shallow-repository']).out.trim() === 'true';
  let boundary = [];
  if (shallow) {
    const sp = git(['rev-parse', '--git-path', 'shallow']).out.trim();
    try { boundary = fs.readFileSync(path.resolve(root, sp), 'utf8').split('\n').filter(Boolean); } catch { boundary = []; }
  }
  const boundaryDates = boundary.map((b) => ({ commit: b, date: (git(['log', '-1', '--format=%cI', b]).out || '').trim() }));
  const count = Number(git(['rev-list', '--count', full]).out.trim());
  const dirty = rev ? 0 : git(['status', '--porcelain']).out.split('\n').filter(Boolean).length;
  const remote = (git(['remote', 'get-url', 'origin']).out || '').trim();
  return { available: true, head: full, date, shallow, boundary: boundaryDates, commits: count, dirty, remote };
}

// ---------------------------------------------------------------------------------------------
// Trees: the working tree (fs + index) or a commit (ls-tree + cat-file)

function dirsOf(files) {
  const dirs = new Set();
  for (const f of files) {
    let k = f.lastIndexOf('/');
    while (k > 0) {
      const d = f.slice(0, k);
      if (dirs.has(d)) break;
      dirs.add(d);
      k = d.lastIndexOf('/');
    }
  }
  return dirs;
}

function worktreeEnv(root, git, info) {
  const tracked = info.available ? git(['ls-files', '-z']).out.split('\0').filter(Boolean) : [];
  const trackedSet = new Set(tracked);
  const trackedDirs = dirsOf(tracked);
  const whyMap = new Map();
  const inside = (p) => {
    const abs = path.resolve(root, p);
    return abs === root || abs.startsWith(root + path.sep) ? abs : null;
  };
  return {
    label: 'worktree',
    shallow: info.shallow,
    shallowSince: info.boundary && info.boundary[0] ? `${info.boundary[0].commit.slice(0, 7)}, ${info.boundary[0].date.slice(0, 10)}` : '',
    files: () => tracked,
    exists(p) {
      const abs = inside(p);
      if (!abs) return null;
      try {
        const st = fs.statSync(abs);
        return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
      } catch { return null; }
    },
    read(p) {
      const abs = inside(p);
      try {
        const st = fs.statSync(abs);
        if (st.size > MAX_READ) { whyMap.set(p, `file is ${(st.size / 1048576).toFixed(1)} MB; not indexed (limit ${MAX_READ / 1048576} MB)`); return null; }
        return fs.readFileSync(abs, 'utf8');
      } catch (e) { whyMap.set(p, `unreadable: ${e.code || e.message}`); return null; }
    },
    why: (p) => whyMap.get(p),
    tracked(p, type) {
      if (!info.available) return null;
      return type === 'dir' ? trackedDirs.has(p.replace(/\/$/, '')) : trackedSet.has(p);
    },
    ignoredMap: new Map(),
    forceMap: new Map(),
    ignored(p) { return info.available ? this.ignoredMap.get(p) ?? null : undefined; },
    forceAdded(p) { return info.available ? this.forceMap.get(p) ?? null : undefined; },
    commitMap: new Map(),
    commit(hex) { return info.available ? this.commitMap.get(hex) : undefined; },
  };
}

function commitEnv(git, commit, info) {
  const files = git(['ls-tree', '-r', '-z', '--name-only', commit]).out.split('\0').filter(Boolean);
  const set = new Set(files);
  const dirs = dirsOf(files);
  const whyMap = new Map();
  return {
    label: commit,
    shallow: info.shallow,
    files: () => files,
    exists: (p) => (set.has(p) ? 'file' : dirs.has(p.replace(/\/$/, '')) ? 'dir' : null),
    read(p) {
      const r = git(['cat-file', '-s', `${commit}:${p}`]);
      if (r.ok && Number(r.out) > MAX_READ) { whyMap.set(p, `file is ${(Number(r.out) / 1048576).toFixed(1)} MB; not indexed`); return null; }
      const b = git(['cat-file', 'blob', `${commit}:${p}`]);
      return b.ok ? b.out : null;
    },
    why: (p) => whyMap.get(p),
    tracked: (p, type) => (type === 'dir' ? dirs.has(p.replace(/\/$/, '')) : set.has(p)),
    ignored: () => null,
    forceAdded: () => null,
    commit: undefined,
  };
}

// git check-ignore over many paths at once. Without --no-index tracked files never match (the
// INV-034 verification command); with it, a tracked file that matches a rule was force-added.
function checkIgnore(git, paths, noIndex) {
  const out = new Map();
  if (!paths.length) return out;
  const args = ['check-ignore', '-v', '-n', '-z', '--stdin'];
  if (noIndex) args.splice(1, 0, '--no-index');
  const r = git(args, paths.join('\0') + '\0');
  if (r.status !== 0 && r.status !== 1) return out;
  const f = r.out.split('\0');
  for (let i = 0; i + 3 < f.length; i += 4) {
    const [source, line, pattern, p] = f.slice(i, i + 4);
    if (source && !pattern.startsWith('!')) out.set(p, { source, line: Number(line), pattern });
  }
  return out;
}

function catFileBatch(git, hexes) {
  const out = new Map();
  if (!hexes.length) return out;
  const r = git(['cat-file', '--batch-check'], hexes.join('\n') + '\n');
  const lines = (r.out || '').split('\n');
  hexes.forEach((h, i) => {
    const ln = lines[i] || '';
    const parts = ln.split(' ');
    if (parts[1] === 'missing') out.set(h, { type: 'missing' });
    else if (parts[1] === 'ambiguous') out.set(h, { type: 'ambiguous' });
    else if (/^[0-9a-f]{40}$/.test(parts[0])) out.set(h, { type: parts[1], full: parts[0] });
  });
  return out;
}

// git blame --porcelain: final line number -> {commit, date}
function blame(git, doc, rev) {
  const args = ['blame', '--porcelain', '--root'];
  if (rev) args.push(rev);
  args.push('--', doc);
  const r = git(args);
  const map = new Map();
  if (!r.ok) return map;
  const meta = new Map();
  let cur = null;
  for (const ln of r.out.split('\n')) {
    const h = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/.exec(ln);
    if (h) {
      cur = { commit: h[1], final: Number(h[3]) };
      if (!meta.has(cur.commit)) meta.set(cur.commit, {});
      continue;
    }
    if (!cur) continue;
    if (ln.startsWith('committer-time ')) meta.get(cur.commit).time = Number(ln.slice(15));
    else if (ln.startsWith('\t')) {
      const m = meta.get(cur.commit);
      map.set(cur.final, { commit: cur.commit, date: m.time ? new Date(m.time * 1000).toISOString().slice(0, 10) : '' });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------------------------

function listDocs(root, env, git, info, rev, explicit) {
  if (explicit.length) return explicit.map((d) => d.replace(/^\.\//, ''));
  const found = [];
  const all = rev ? env.files() : null;
  for (const spec of DEFAULT_DOCS) {
    if (typeof spec === 'string') {
      if (env.exists(spec) === 'file') found.push(spec);
      continue;
    }
    let names = [];
    if (rev) names = all.filter((f) => L.dirname(f) === spec.dir).map((f) => f.split('/').pop());
    else {
      try { names = fs.readdirSync(path.join(root, spec.dir)).filter((n) => fs.statSync(path.join(root, spec.dir, n)).isFile()); } catch { names = []; }
    }
    for (const n of names.sort()) if (spec.re.test(n)) found.push(spec.dir ? `${spec.dir}/${n}` : n);
  }
  return [...new Set(found)];
}

function loadAllow(file) {
  let list;
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Refusal(`allowlist ${file}: ${e.message}`); }
  if (!Array.isArray(list)) throw new Refusal('allowlist must be a JSON array');
  list.forEach((e, i) => {
    if (!e || typeof e.doc !== 'string' || typeof e.ref !== 'string' || typeof e.reason !== 'string' || !e.reason.trim()) {
      throw new Refusal(`allowlist entry ${i} needs "doc", "ref" and a non-empty "reason"`);
    }
  });
  return list;
}

export function run(opts) {
  const root = path.resolve(opts.positional[0]);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Refusal(`no such directory: ${root}`);
  const realRoot = fs.realpathSync(root);
  const git = makeGit(realRoot);
  const info = gitInfo(realRoot, git, opts.rev);
  if (opts.rev && !info.available) throw new Refusal(`--rev needs a git checkout (${info.reason})`);
  if (info.revError) throw new Refusal(info.revError);
  const env = opts.rev ? commitEnv(git, info.head, info) : worktreeEnv(realRoot, git, info);
  if (opts.rev) env.commitMap = new Map();
  const docs = listDocs(realRoot, env, git, info, opts.rev, opts.docs);
  const allow = opts.allow ? loadAllow(opts.allow) : [];

  // 1. Extract.
  const perDoc = [];
  const missingDocs = [];
  for (const d of docs) {
    const text = env.read(d);
    if (text == null) { missingDocs.push(d); continue; }
    const ex = L.extract(text, d);
    perDoc.push({ doc: d, units: ex.units, refs: ex.refs, lines: L.lineCount(text) });
  }
  if (!perDoc.length) throw new Refusal(`no documents to check in ${realRoot}${missingDocs.length ? ` (missing: ${missingDocs.join(', ')})` : ''}`);
  const refs = perDoc.flatMap((p) => p.refs);

  // 2. Batch git lookups: commits, and ignore rules for every path a reference resolves to.
  if (info.available) {
    const hexes = [...new Set(refs.filter((r) => r.kind === 'commit' && !r.hashLike).map((r) => r.hex))];
    const lineHexes = refs.filter((r) => r.pinnedCommit).map((r) => r.pinnedCommit);
    const cm = catFileBatch(git, [...new Set([...hexes, ...lineHexes])]);
    const ancestors = new Set(git(['rev-list', info.head]).out.split('\n').filter(Boolean));
    for (const v of cm.values()) if (v.type === 'commit') v.onHead = ancestors.has(v.full);
    env.commit = (hex) => cm.get(hex);
    if (!opts.rev) {
      const untracked = new Set();
      const trackedPaths = new Set();
      for (const p of perDoc) {
        for (const r of p.refs) {
          if (r.kind === 'commit') continue;
          const res = L.resolvePath(r.path, r.doc, env, p.units[r.unit] && p.units[r.unit].text);
          if (res.status === 'MISSING') untracked.add(res.path);
          else if (res.status === 'FOUND') (env.tracked(res.path, res.type) ? trackedPaths : untracked).add(res.path);
        }
      }
      env.ignoredMap = checkIgnore(git, [...untracked], false);
      env.forceMap = checkIgnore(git, [...trackedPaths].filter((p) => env.exists(p) === 'file'), true);
    }
  }

  // 3. Judge, with context for anything not OK.
  const findings = [];
  for (const p of perDoc) {
    for (const r of p.refs) {
      const unitText = p.units[r.unit] && p.units[r.unit].text;
      const j = L.judge(r, env, unitText);
      const f = { ...r, ...j };
      delete f.unit;
      delete f.near;
      delete f.heading;
      if (L.isDrift(f) || f.status === 'PARTIAL') {
        const c = L.context(r, p.units);
        if (Object.keys(c).length) f.context = c;
      }
      findings.push(f);
    }
  }

  // 4. History, for drift only. A citation is legitimately pinned to the commit its sentence was
  //    written at, so each drift finding is re-judged against the tree of:
  //    - first: the first commit whose version of the document contains the reference's text
  //      (git log -S, oldest first; skipped for a bare `:N`, which is not distinctive);
  //    - last: the commit that last changed the document line (git blame);
  //    - pinned: the one commit its sentence (or else its paragraph) names, if any.
  //    The citation of this occurrence was written somewhere between first and last. In a shallow
  //    clone a commit at the boundary may stand for older history, so it reads "before this clone".
  const trees = new Map();
  const treeAt = (c) => {
    if (!trees.has(c)) trees.set(c, commitEnv(git, c, info));
    return trees.get(c);
  };
  const unitTextAt = (f) => {
    const p = perDoc.find((d) => d.doc === f.doc);
    const u = p.units.find((x) => f.line >= x.firstLine && f.line < x.firstLine + x.lineStarts.length);
    return u ? u.text : undefined;
  };
  if (info.available && opts.history) {
    const boundary = new Set((info.boundary || []).map((b) => b.commit));
    const blames = new Map();
    const dates = new Map();
    const dateOf = (c) => {
      if (!dates.has(c)) dates.set(c, (git(['log', '-1', '--format=%cs', c]).out || '').trim());
      return dates.get(c);
    };
    const at = (c) => {
      if (/^0+$/.test(c)) return { state: 'uncommitted' };
      if (boundary.has(c)) return { state: 'before-clone', commit: c, date: dateOf(c) };
      return { state: 'checked', commit: c, date: dateOf(c) };
    };
    for (const f of findings) {
      if (!L.isDrift(f) || f.kind === 'commit') continue;
      const h = {};
      if (!f.raw.startsWith(':') && f.raw.length >= 5 && /[\/.]/.test(f.raw)) {
        const r = git(['log', '--format=%H', '-S', f.raw, '--reverse', opts.rev || info.head, '--', f.doc]);
        const first = r.ok ? r.out.split('\n').filter(Boolean)[0] : null;
        if (first) h.first = at(first);
      }
      if (!blames.has(f.doc)) blames.set(f.doc, blame(git, f.doc, opts.rev));
      const b = blames.get(f.doc).get(f.line);
      if (b) h.last = at(b.commit);
      for (const k of ['first', 'last']) {
        if (!h[k] || h[k].state !== 'checked') continue;
        const j = L.judge(f, treeAt(h[k].commit), unitTextAt(f));
        h[k].status = j.status;
        if (j.note) h[k].note = j.note;
      }
      if (h.first || h.last) f.history = h;
    }
    for (const f of findings) {
      if (!f.pinnedCommit || !L.isDrift(f)) continue;
      const ci = env.commit(f.pinnedCommit);
      if (!ci || ci.type !== 'commit') {
        f.pinned = { commit: f.pinnedCommit, scope: f.pinnedScope, state: ci && ci.type === 'ambiguous' ? 'ambiguous' : info.shallow ? 'not in this shallow clone' : 'not in this clone' };
        continue;
      }
      const j = L.judge(f, treeAt(ci.full), unitTextAt(f));
      f.pinned = { commit: ci.full, scope: f.pinnedScope, state: 'checked', date: dateOf(ci.full), status: j.status };
      if (j.note) f.pinned.note = j.note;
    }
  }

  // 5. Allowlist and annotation excuses.
  for (const f of findings) {
    const hit = allow.find((e) => e.doc === f.doc && (e.ref === f.raw || e.ref === f.path || e.ref === f.hex) && (e.line == null || e.line === f.line));
    if (hit) f.allowed = hit.reason;
    if (opts.acceptAnnotated && f.context && (f.context.annotatedAt || f.context.saysGone)) f.excused = true;
  }
  const failing = findings.filter((f) => L.isDrift(f) && !f.allowed && !f.excused);
  return {
    tool: 'line-drift', checkout: realRoot, mode: opts.rev ? `rev ${opts.rev}` : 'worktree',
    git: info.available ? { head: info.head, date: info.date, shallow: info.shallow, boundary: info.boundary, commits: info.commits, dirty: info.dirty, remote: info.remote } : { available: false, reason: info.reason },
    docs: perDoc.map((p) => ({ doc: p.doc, lines: p.lines, refs: p.refs.length })),
    missingDocs,
    counts: L.tally(findings),
    failing: failing.length,
    findings,
  };
}

// ---------------------------------------------------------------------------------------------
// Output

const SHORT = { 'MISSING-PATH': 'MISSING', 'UNREACHABLE-COMMIT': 'UNREACH', 'NOT-A-COMMIT': 'NOTCOMMIT', UNCHECKABLE: 'UNCHECK', 'IN-RANGE': 'IN-RANGE', 'PAST-EOF': 'PAST-EOF', UNTRACKED: 'UNTRACK' };
const COLS = L.STATUSES;
const short = (s) => SHORT[s] || s;
const shortHash = (h) => (h ? h.slice(0, 7) : '');

function header(rep) {
  const g = rep.git;
  const lines = [];
  lines.push(`Line Drift: ${rep.findings.length} references in ${rep.docs.length} documents`);
  lines.push(`checkout ${rep.checkout} (${rep.mode})`);
  if (g.available === false) lines.push(`git: unavailable (${g.reason}); existence and lines checked, tracking and commits not`);
  else {
    lines.push(`at ${shortHash(g.head)} (${g.date})${g.remote ? ` from ${g.remote}` : ''}; ${g.commits} commits reachable${g.dirty ? `; ${g.dirty} changed files in the working tree` : '; working tree clean'}`);
    if (g.shallow) lines.push(`shallow clone: history starts at ${g.boundary.map((b) => `${shortHash(b.commit)} (${b.date.slice(0, 10)})`).join(', ')}; older commits read UNCHECKABLE, not unreachable`);
  }
  if (rep.missingDocs.length) lines.push(`documents absent: ${rep.missingDocs.join(', ')}`);
  return lines;
}

function countsTable(rep) {
  const c = rep.counts;
  const lines = [];
  lines.push(`${L.pad('status', 20)}${L.pad('line', 7)}${L.pad('path', 7)}${L.pad('commit', 8)}total`);
  for (const s of COLS) {
    const t = c.byStatus[s] || 0;
    if (!t) continue;
    lines.push(`${L.pad(s, 20)}${L.pad(c.byKind.line[s] || 0, 7)}${L.pad(c.byKind.path[s] || 0, 7)}${L.pad(c.byKind.commit[s] || 0, 8)}${t}`);
  }
  const kinds = ['line', 'path', 'commit'].map((k) => Object.values(c.byKind[k]).reduce((a, b) => a + b, 0));
  lines.push(`${L.pad('all', 20)}${L.pad(kinds[0], 7)}${L.pad(kinds[1], 7)}${L.pad(kinds[2], 8)}${c.total}`);
  return lines;
}

function docTable(rep) {
  const used = COLS.filter((s) => rep.counts.byStatus[s]);
  const w = Math.max(10, ...rep.docs.map((d) => d.doc.length)) + 2;
  const lines = [`${L.pad('document', w)}${L.pad('refs', 6)}${used.map((s) => L.pad(short(s), 10)).join('')}`];
  for (const d of rep.docs) {
    const row = rep.counts.byDoc[d.doc] || {};
    lines.push(`${L.pad(d.doc, w)}${L.pad(d.refs, 6)}${used.map((s) => L.pad(row[s] || 0, 10)).join('')}`);
  }
  return lines;
}

function describe(f) {
  const target = f.kind === 'commit' ? f.hex : f.raw;
  const bits = [];
  if (f.kind === 'line' && f.form === 'continuation') bits.push(`(${f.path || 'no path'})`);
  if (f.target && f.kind !== 'commit' && f.target !== (f.path || '').replace(/\/$/, '')) bits.push(`-> ${f.target}`);
  if (f.note) bits.push(f.note);
  const snip = (f.snippetResults || []).find((s) => s.verdict === f.lineStatus) || (f.snippetResults || [])[0];
  const lines = [`${f.doc}:${f.line}  ${f.kind}  ${target}  ${f.status}${bits.length ? `  ${bits.join('; ')}` : ''}`];
  if (snip) lines.push(`    snippet: ${snip.form === 'quote' ? `"${snip.text}"` : `\`${snip.text}\``}`.slice(0, 200));
  const hist = L.describeHistory(f);
  if (hist) lines.push(`    history: ${hist}`);
  const ctx = L.describeContext(f);
  if (ctx) lines.push(`    context: ${ctx}`);
  return lines;
}

export function formatText(rep, opts = {}) {
  const out = [...header(rep), '', ...countsTable(rep), '', ...docTable(rep), ''];
  const shown = rep.findings.filter((f) => (opts.only ? opts.only.includes(f.status) : opts.all || L.isDrift(f)));
  const order = (f) => COLS.indexOf(f.status);
  shown.sort((a, b) => order(a) - order(b) || a.doc.localeCompare(b.doc) || a.line - b.line);
  out.push(opts.only ? `Findings with status ${opts.only.join(', ')} (${shown.length}):` : opts.all ? `Every reference (${shown.length}):` : `Drift (${shown.length}; ${rep.failing} not allowlisted${opts.acceptAnnotated ? ' or annotated' : ''}):`);
  for (const f of shown) out.push(...describe(f));
  if (!opts.all && !opts.only) {
    const unch = rep.findings.filter((f) => f.status === 'UNCHECKABLE' || f.status === 'NOT-A-COMMIT');
    if (unch.length) {
      const why = new Map();
      for (const f of unch) {
        const k = `${f.kind}: ${(f.note || 'no reason').replace(/\d+ files end in .*/, 'several files share this name').replace(/history starts at .*\)/, 'history starts at the boundary)')}`;
        why.set(k, (why.get(k) || 0) + 1);
      }
      out.push('', `Not fully checkable (${unch.length}), by reason:`);
      for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) out.push(`  ${L.pad(n, 6)}${k}`);
    }
    const inr = rep.counts.byStatus['IN-RANGE'];
    if (inr) out.push('', `IN-RANGE (${inr}): the cited line exists, but no snippet sits in the sentence to check it against; --only IN-RANGE lists them.`);
  }
  out.push('', rep.failing ? `exit 1: ${rep.failing} drift finding${rep.failing === 1 ? '' : 's'} not allowlisted` : 'exit 0: no unallowed drift');
  return out.join('\n');
}

const mdEsc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function formatMarkdown(rep, opts = {}) {
  const out = [];
  const g = rep.git;
  out.push(`**Line Drift** at \`${g.head ? shortHash(g.head) : 'no git'}\`${g.shallow ? ' (shallow clone)' : ''}: ${rep.findings.length} references in ${rep.docs.length} documents; ${rep.failing} drift findings not allowlisted.`, '');
  out.push('| status | line | path | commit | total |', '|---|---:|---:|---:|---:|');
  for (const s of COLS) {
    const t = rep.counts.byStatus[s];
    if (t) out.push(`| ${s} | ${rep.counts.byKind.line[s] || 0} | ${rep.counts.byKind.path[s] || 0} | ${rep.counts.byKind.commit[s] || 0} | ${t} |`);
  }
  out.push('', '| document | refs | drift | OK | IN-RANGE | UNCHECKABLE |', '|---|---:|---:|---:|---:|---:|');
  for (const d of rep.docs) {
    const r = rep.counts.byDoc[d.doc] || {};
    const drift = [...L.DRIFT].reduce((a, s) => a + (r[s] || 0), 0);
    out.push(`| \`${d.doc}\` | ${d.refs} | ${drift} | ${r.OK || 0} | ${r['IN-RANGE'] || 0} | ${(r.UNCHECKABLE || 0) + (r['NOT-A-COMMIT'] || 0)} |`);
  }
  const shown = rep.findings.filter((f) => (opts.only ? opts.only.includes(f.status) : opts.all || L.isDrift(f)));
  out.push('', '| where | reference | status | detail | history | context |', '|---|---|---|---|---|---|');
  for (const f of shown) {
    out.push(`| \`${f.doc}:${f.line}\` | \`${mdEsc(f.kind === 'commit' ? f.hex : f.raw)}\` | ${f.status} | ${mdEsc(f.note || '')} | ${mdEsc(L.describeHistory(f))} | ${mdEsc(L.describeContext(f))} |`);
  }
  return out.join('\n');
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`line-drift: ${e.message}\n\n${HELP}`);
    return 3;
  }
  if (opts.help) { console.log(HELP); return 0; }
  let rep;
  try {
    rep = run(opts);
  } catch (e) {
    if (e instanceof Refusal) { console.error(`line-drift: refused: ${e.message}`); return 2; }
    throw e;
  }
  if (opts.json) console.log(JSON.stringify(rep, null, 1));
  else if (opts.markdown) console.log(formatMarkdown(rep, opts));
  else console.log(formatText(rep, opts));
  return rep.failing ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
export { main, parseArgs, Refusal };
