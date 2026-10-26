#!/usr/bin/env node
// blob-basis: hash a file on every basis at once (working copy, committed blob, and each one
// LF-normalised and CRLF-synthesised) and say which basis a recorded provenance hash was taken on.
// Node built-ins only; git is called read-only (rev-parse, cat-file, ls-files, check-attr,
// rev-list, log, config --get, hash-object --stdin without -w). Nothing is written anywhere.
//
// Run `node blob-basis.mjs --help` for usage. Exit codes: 0 everything asked was checked and held,
// 1 a recorded hash matched no basis (or not the --require basis), 2 refused: something needed
// could not be read (no git, path not in the revision, no path for a scanned hash), 3 usage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BB = createRequire(import.meta.url)(path.join(here, 'basis.js'));

const USAGE = `blob-basis: which bytes was this hash taken on?

  node blob-basis.mjs <repo> <path>... [options]
  node blob-basis.mjs <repo> --scan <file.json> [--map KEY=PATH]... [options]

For each path, hashes six candidate byte strings and groups the identical ones:
  disk       the working-tree file (or the --against copy)
  blob       the committed blob at --rev (git cat-file blob REV:path)
  *-lf       the same with CRLF -> LF        *-crlf   the same with bare LF -> CRLF
and says how the working copy relates to the blob: IDENTICAL, CRLF-CHECKOUT, EOL-ONLY, DIRTY
(or UNTRACKED / NOT-ON-DISK / UNAVAILABLE, with the reason).

Options
  --rev REV          revision for the blob basis (default HEAD)
  --expect HEX       a recorded hash to place: 64 hex sha256, 32 hex md5, 40 hex git blob id,
                     or an 8-31 hex prefix. Repeatable. Prints BLOB-BASIS, CRLF-BASIS, LF-BASIS,
                     WORKTREE-BASIS or NO-MATCH (HISTORY with --history), and every basis it equals.
  --bytes N          the byte count recorded with the --expect just before it (checked too)
  --scan FILE.json   find every recorded hash in a JSON file (64/32 hex strings, 40 hex under a
                     key naming a blob) and place each one. The file a hash is about comes from
                     --map, else from a sibling "path" key; a sibling "bytes" number is checked too.
                     Other 40-hex strings (commit ids) are listed with whether this clone has them.
  --map KEY=PATH     the file a scanned hash is about, by key name or JSON pointer. Repeatable.
                     Scanned paths are taken relative to the repository root.
  --against FILE     compare FILE's bytes (a copy: a packaged asset, a download) with REV:path
                     instead of the working-tree file. Needs exactly one <path>.
  --history          when a hash matches nothing at REV, look through every earlier committed
                     version of the path this clone has, and name the commit if one matches
  --require BASIS    exit 1 unless every placed hash (or, with no --expect/--scan, the bytes under
                     test) is on BASIS: one of ${BB.BASIS_NAMES.join(', ')}
  --brief            one line per path (verdict, bytes, sha256 of the blob and of its CRLF form)
  --json             print the whole result as JSON
  -h, --help         this text

Exit: 0 held, 1 a hash matched no basis or not the --require basis, 2 refused (could not read what
was needed), 3 usage.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const o = { positional: [], rev: 'HEAD', expect: [], scan: [], map: {}, against: null, history: false, require: null, json: false, brief: false, help: false };
  const need = (i, flag) => {
    if (i >= argv.length) throw new UsageError(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--rev') o.rev = need(++i, a);
    else if (a === '--expect') o.expect.push({ value: need(++i, a), bytes: null });
    else if (a === '--bytes') {
      const v = need(++i, a);
      if (!/^\d+$/.test(v)) throw new UsageError(`--bytes takes a whole number, got "${v}"`);
      if (!o.expect.length || o.expect[o.expect.length - 1].bytes != null) throw new UsageError('--bytes goes right after the --expect it belongs to');
      o.expect[o.expect.length - 1].bytes = Number(v);
    } else if (a === '--scan') o.scan.push(need(++i, a));
    else if (a === '--map') {
      const v = need(++i, a);
      const eq = v.indexOf('=');
      if (eq < 1 || eq === v.length - 1) throw new UsageError(`--map takes KEY=PATH, got "${v}"`);
      o.map[v.slice(0, eq)] = v.slice(eq + 1);
    } else if (a === '--against') o.against = need(++i, a);
    else if (a === '--history') o.history = true;
    else if (a === '--require') {
      o.require = need(++i, a);
      if (!BB.BASIS_NAMES.includes(o.require)) throw new UsageError(`--require takes one of ${BB.BASIS_NAMES.join(', ')}, got "${o.require}"`);
    } else if (a === '--json') o.json = true;
    else if (a === '--brief') o.brief = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else o.positional.push(a);
  }
  if (o.help) return o;
  if (!o.positional.length) throw new UsageError('give a repository directory');
  const paths = o.positional.slice(1);
  if (!paths.length && !o.scan.length) throw new UsageError('give at least one <path> or --scan FILE');
  if (o.expect.length && !paths.length) throw new UsageError('--expect needs a <path> to place the hash against');
  if (o.against && paths.length !== 1) throw new UsageError('--against needs exactly one <path>');
  for (const e of o.expect) {
    const c = BB.classifyHex(e.value);
    if (!c.ok) throw new UsageError(`--expect ${e.value}: ${c.why}`);
  }
  return o;
}

// ------------------------------------------------------------------------------------------------
// git, read-only.

function gitRun(cwd, args, { input = null, buffer = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, maxBuffer: 1 << 30, encoding: buffer ? 'buffer' : 'utf8' });
  if (r.error) return { ok: false, missing: r.error.code === 'ENOENT', err: r.error.message, out: buffer ? Buffer.alloc(0) : '' };
  return { ok: r.status === 0, out: buffer ? r.stdout : String(r.stdout).trim(), err: String(r.stderr || '').trim() };
}

const NODE_HASHER = {
  name: 'node:crypto',
  sha256: (b) => crypto.createHash('sha256').update(b).digest('hex'),
  md5: (b) => crypto.createHash('md5').update(b).digest('hex'),
  blobId: (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'),
  equal: (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength)),
};

function gitContext(repoDir, rev) {
  const ctx = { repoDir: path.resolve(repoDir), rev, available: false };
  if (!fs.existsSync(ctx.repoDir) || !fs.statSync(ctx.repoDir).isDirectory()) {
    ctx.why = `${repoDir} is not a directory`;
    ctx.fatal = true;
    return ctx;
  }
  const v = gitRun(ctx.repoDir, ['--version']);
  if (!v.ok) {
    ctx.why = v.missing ? 'git is not installed or not on PATH' : `git --version failed: ${v.err}`;
    return ctx;
  }
  ctx.gitVersion = v.out.replace(/^git version\s*/, '');
  const top = gitRun(ctx.repoDir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    ctx.why = `${ctx.repoDir} is not inside a git work tree`;
    return ctx;
  }
  ctx.top = top.out;
  ctx.shallow = gitRun(ctx.repoDir, ['rev-parse', '--is-shallow-repository']).out === 'true';
  const count = gitRun(ctx.repoDir, ['rev-list', '--count', 'HEAD']);
  ctx.reachableCommits = count.ok ? Number(count.out) : null;
  const ac = gitRun(ctx.repoDir, ['config', '--get', 'core.autocrlf']);
  ctx.autocrlf = ac.ok && ac.out ? ac.out : 'unset';
  const c = gitRun(ctx.repoDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (!c.ok || !c.out) {
    ctx.why = `revision ${rev} is not a commit in this clone${ctx.shallow ? ' (it is a shallow clone, so older history is absent)' : ''}`;
    return ctx;
  }
  ctx.commit = c.out;
  ctx.commitDate = gitRun(ctx.repoDir, ['log', '-1', '--format=%cI', ctx.commit]).out;
  ctx.available = true;
  return ctx;
}

// Resolve symlinks so a path under a symlinked directory still lands inside the repository.
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

function relInRepo(ctx, absPath) {
  if (!ctx.top) return null;
  const rel = path.relative(real(ctx.top), real(absPath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function readAttributes(ctx, rel) {
  const attrs = {};
  const ca = gitRun(ctx.top, ['check-attr', 'text', 'eol', '--', rel]);
  if (ca.ok) {
    for (const line of ca.out.split('\n')) {
      const m = /: (text|eol): (.*)$/.exec(line);
      if (m) attrs[m[1]] = m[2];
    }
  }
  const lf = gitRun(ctx.top, ['ls-files', '--eol', '--', rel]);
  attrs.lsFilesEol = lf.ok && lf.out ? lf.out.split('\t')[0].replace(/\s+/g, ' ').trim() : null;
  return attrs;
}

// ------------------------------------------------------------------------------------------------
// One path.

function examinePath(ctx, p, opts) {
  const abs = path.resolve(ctx.repoDir, p);
  const res = { path: p, repoPath: null, against: !!opts.against, diskFile: opts.against ? path.resolve(opts.against) : abs };
  const sources = { disk: null, blob: null };
  if (fs.existsSync(res.diskFile) && fs.statSync(res.diskFile).isFile()) sources.disk = new Uint8Array(fs.readFileSync(res.diskFile));
  else sources.diskWhy = `${opts.against ? 'the --against file' : 'the working-tree file'} ${res.diskFile} ${fs.existsSync(res.diskFile) ? 'is not a file' : 'does not exist'}`;

  let blobCode = 'UNAVAILABLE';
  if (!ctx.available) sources.blobWhy = ctx.why;
  else {
    const rel = relInRepo(ctx, abs);
    if (!rel) sources.blobWhy = `${abs} is outside the repository ${ctx.top}`;
    else {
      res.repoPath = rel;
      const spec = `${ctx.commit}:${rel}`;
      const id = gitRun(ctx.top, ['rev-parse', '--verify', '--quiet', spec]);
      if (!id.ok || !id.out) {
        sources.blobWhy = `${rel} is not in ${ctx.commit.slice(0, 7)}`;
        blobCode = 'UNTRACKED';
      } else {
        const type = gitRun(ctx.top, ['cat-file', '-t', id.out]).out;
        if (type !== 'blob') sources.blobWhy = `${rel} at ${ctx.commit.slice(0, 7)} is a ${type || 'missing object'}, not a file`;
        else {
          const blob = gitRun(ctx.top, ['cat-file', 'blob', id.out], { buffer: true });
          if (!blob.ok) sources.blobWhy = `git cat-file blob ${id.out} failed: ${blob.err}`;
          else {
            sources.blob = new Uint8Array(blob.out);
            res.committedBlobId = id.out;
          }
        }
      }
      res.attributes = readAttributes(ctx, rel);
    }
  }
  const bases = BB.computeBases(sources, NODE_HASHER);
  res.bases = bases;
  res.verdict = BB.workingVerdict(bases, { blobCode });
  if (sources.disk && res.committedBlobId && res.verdict.code !== 'IDENTICAL') {
    // A second opinion from git itself: pass the bytes under test through the filters
    // .gitattributes selects for this path (what `git add` would store) and compare with the
    // committed blob id. hash-object without -w writes nothing.
    const filtered = gitRun(ctx.top, ['hash-object', `--path=${res.repoPath}`, '--stdin'], { input: Buffer.from(sources.disk) });
    res.gitFiltered = filtered.ok ? filtered.out : null;
    res.gitAgrees = res.gitFiltered === res.committedBlobId;
  }
  return res;
}

// Look through every committed version of the path this clone has for one that a hash matches.
function historySearch(ctx, rel, value, recordedBytes, skipBlobId) {
  const out = { searched: true, shallow: ctx.shallow, versions: 0, commits: 0, found: null };
  const list = gitRun(ctx.top, ['rev-list', ctx.commit, '--', rel]);
  if (!list.ok) {
    out.why = `git rev-list failed: ${list.err}`;
    return out;
  }
  const commits = list.out ? list.out.split('\n') : [];
  out.commits = commits.length;
  const seen = new Set(skipBlobId ? [skipBlobId] : []);
  for (const c of commits) {
    const id = gitRun(ctx.top, ['rev-parse', '--verify', '--quiet', `${c}:${rel}`]);
    if (!id.ok || !id.out || seen.has(id.out)) continue;
    seen.add(id.out);
    out.versions++;
    const blob = gitRun(ctx.top, ['cat-file', 'blob', id.out], { buffer: true });
    if (!blob.ok) continue;
    const bases = BB.computeBases({ disk: null, diskWhy: 'history', blob: new Uint8Array(blob.out) }, NODE_HASHER);
    const m = BB.matchHash(value, bases, recordedBytes);
    if (m.matches.length) {
      out.found = { commit: c, date: gitRun(ctx.top, ['log', '-1', '--format=%cI', c]).out, blobId: id.out, code: m.code, matches: m.matches };
      break;
    }
  }
  if (commits.length) {
    const oldest = commits[commits.length - 1];
    out.oldest = { commit: oldest, date: gitRun(ctx.top, ['log', '-1', '--format=%cI', oldest]).out };
  }
  // The version at REV itself counts as searched.
  out.versions += skipBlobId ? 1 : 0;
  return out;
}

function placeHash(ctx, res, value, recordedBytes, opts) {
  const m = BB.matchHash(value, res.bases, recordedBytes);
  if (m.code === 'NO-MATCH' && opts.history && ctx.available && res.repoPath) {
    m.history = historySearch(ctx, res.repoPath, value, recordedBytes, res.committedBlobId);
    if (m.history.found) m.code = 'HISTORY';
  }
  return m;
}

// ------------------------------------------------------------------------------------------------
// Outcome: 0 held, 1 failed, 2 refused.

function outcomeOfMatch(m, opts, res) {
  if (!m.ok) return 2;
  if (res && res.verdict.code === 'UNAVAILABLE') return 2;
  if (m.code === 'NO-MATCH') return m.blobAvailable ? 1 : 2;
  if (opts.require && !m.matches.includes(opts.require)) {
    const reqRow = opts.require.startsWith('blob') ? m.blobAvailable : true;
    return reqRow ? 1 : 2;
  }
  return 0;
}

function outcomeOfPath(res, opts) {
  const disk = BB.row(res.bases, 'disk');
  if (res.verdict.code === 'UNAVAILABLE') return 2;
  if (!disk.available && !BB.row(res.bases, 'blob').available) return 2;
  if (!opts.require || opts.expect.length) return 0;
  const want = BB.row(res.bases, opts.require);
  if (!disk.available || !want.available) return 2;
  return disk.family === want.family ? 0 : 1;
}

function combine(codes) {
  if (codes.includes(1)) return 1;
  if (codes.includes(2)) return 2;
  return 0;
}

// ------------------------------------------------------------------------------------------------
// Text rendering.

const g3 = BB.group3;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function sameReason(rows, r) {
  const first = rows.find((q) => q.available && q.family === r.family);
  if (first === r) return null;
  const sameSource = first.source === r.source;
  return `= ${first.name}${sameSource ? (r.name.endsWith('-lf') ? '  (no CRLF to remove)' : '  (no bare LF to convert)') : ''}`;
}

function renderBasisTable(res) {
  const lines = [];
  lines.push(`  ${pad('basis', 11)}${lpad('bytes', 12)}${lpad('CRLF', 11)}${lpad('bare LF', 11)}${lpad('bare CR', 9)}  sha256`);
  for (const r of res.bases.rows) {
    if (!r.available) {
      lines.push(`  ${pad(r.name, 11)}${lpad('-', 12)}  UNAVAILABLE: ${r.why}`);
      continue;
    }
    const same = sameReason(res.bases.rows, r);
    if (same) lines.push(`  ${pad(r.name, 11)}${lpad(g3(r.bytes), 12)}  ${same}`);
    else lines.push(`  ${pad(r.name, 11)}${lpad(g3(r.bytes), 12)}${lpad(g3(r.stats.crlf), 11)}${lpad(g3(r.stats.bareLf), 11)}${lpad(g3(r.stats.bareCr), 9)}  ${r.sha256}`);
  }
  return lines;
}

function short(h) {
  return `${h.slice(0, 16)}…`;
}

function renderMatch(m, indent) {
  const lines = [];
  if (!m.ok) {
    lines.push(`${indent}INVALID: ${m.why}`);
    return lines;
  }
  const algo = m.prefix ? `prefix of ${BB.ALGO_LABEL[m.algo] || 'any hash'}` : BB.ALGO_LABEL[m.algo];
  let head = `${indent}${m.code}`;
  if (m.matches.length) head += `  ${algo} equals ${m.matches.join(' = ')}`;
  else head += `  (${algo})`;
  lines.push(head);
  if (m.code !== 'HISTORY') lines.push(`${indent}  ${BB.MATCH_TEXT[m.code]}`);
  if (m.matches.length && !m.discriminating) lines.push(`${indent}  every available basis has these bytes, so this reading cannot tell the bases apart`);
  if (!m.blobAvailable) lines.push(`${indent}  blob basis UNAVAILABLE: cannot say whether this is also the committed blob`);
  if (m.recordedBytes != null) {
    if (m.bytesAgree === true) lines.push(`${indent}  recorded bytes ${g3(m.recordedBytes)} agree`);
    else if (m.bytesAgree === false) lines.push(`${indent}  recorded bytes ${g3(m.recordedBytes)} DISAGREE with the matching basis`);
    else lines.push(`${indent}  recorded bytes ${g3(m.recordedBytes)}: ${m.basesWithThoseBytes.length ? `the length of ${m.basesWithThoseBytes.join(', ')}` : 'the length of no basis'}`);
  }
  if (m.history) {
    const h = m.history;
    if (h.found) {
      lines.push(`${indent}  ${BB.MATCH_TEXT.HISTORY}: the blob ${h.found.blobId.slice(0, 12)} introduced at ${h.found.commit.slice(0, 12)} (${h.found.date}), as ${h.found.matches.join(' = ')}`);
    } else if (h.why) lines.push(`${indent}  history: ${h.why}`);
    else {
      const span = h.oldest ? ` back to ${h.oldest.commit.slice(0, 7)} (${h.oldest.date})` : '';
      lines.push(`${indent}  history: ${h.versions} committed version${h.versions === 1 ? '' : 's'} of the path in ${h.commits} commit${h.commits === 1 ? '' : 's'}${span}: no match.${h.shallow ? ' This is a shallow clone; versions older than that are not here to check.' : ''}`);
    }
  }
  return lines;
}

function renderBrief(res) {
  const name = res.repoPath || res.path;
  const blob = BB.row(res.bases, 'blob');
  const crlf = BB.row(res.bases, 'blob-crlf');
  const lines = [`  ${pad(res.verdict.code, 14)} ${name}`];
  if (blob.available) lines.push(`  ${pad('', 14)}   blob ${lpad(g3(blob.bytes), 11)} B  ${short(blob.sha256)}   blob-crlf ${lpad(g3(crlf.bytes), 11)} B  ${crlf.family === blob.family ? '= blob' : short(crlf.sha256)}`);
  else lines.push(`  ${pad('', 14)}   ${res.verdict.text}`);
  for (const m of res.expect || []) lines.push(...renderMatch(m, `  ${pad('', 14)}   `));
  return lines;
}

function renderPath(res, matches) {
  const lines = [];
  const head = res.repoPath || res.path;
  lines.push(head);
  if (res.against) lines.push(`  disk        ${res.diskFile}  (--against copy, not the working-tree file)`);
  if (res.attributes) {
    const a = res.attributes;
    lines.push(`  attributes  text=${a.text || '?'} eol=${a.eol || '?'}${a.lsFilesEol ? `   (git ls-files --eol: ${a.lsFilesEol})` : ''}`);
  }
  const diskRow = BB.row(res.bases, 'disk');
  if (res.committedBlobId) lines.push(`  blob id     ${res.committedBlobId}  committed (git rev-parse REV:path)`);
  if (res.committedBlobId && diskRow.available) lines.push(`              ${diskRow.blobId}  the bytes under test, as a git blob (sha1 of "blob <n>\\0" + bytes)`);
  const disk = BB.row(res.bases, 'disk');
  if (disk.available && disk.binary) lines.push(`  binary      a NUL byte in the first ${g3(BB.BINARY_SNIFF_BYTES)} bytes: git never converts this file's line endings, so the -lf and -crlf rows are not bytes git would produce`);
  lines.push(...renderBasisTable(res));
  lines.push(`  verdict     ${res.verdict.code}: ${res.verdict.text}`);
  if (res.gitAgrees != null) {
    lines.push(`              git ${res.gitAgrees ? 'agrees' : 'does not agree'}: git hash-object --path turns these bytes into ${res.gitAgrees ? 'the committed blob' : `${res.gitFiltered || '(failed)'}, not the committed blob`}`);
  }
  for (const m of matches) {
    lines.push(`  expect      ${m.prefix ? m.value : short(m.value)}${m.fullHash && m.prefix ? ` (= ${short(m.fullHash)})` : ''}`);
    lines.push(...renderMatch(m, '              '));
  }
  return lines;
}

function renderScan(scan) {
  const lines = [];
  lines.push(`scan ${scan.file}  (${scan.entries.length} recorded hash${scan.entries.length === 1 ? '' : 'es'}${scan.ids.length ? `, ${scan.ids.length} other id${scan.ids.length === 1 ? '' : 's'}` : ''})`);
  for (const e of scan.entries) {
    lines.push(`  ${e.pointer}`);
    lines.push(`      recorded  ${BB.ALGO_LABEL[e.algo]} ${e.value}${e.recordedBytes != null ? `, bytes ${g3(e.recordedBytes)}` : ''}`);
    if (!e.path) {
      lines.push(`      UNRESOLVED  no file named for this hash (no sibling "path"); pass --map ${e.key}=<path>`);
      continue;
    }
    lines.push(`      file      ${e.path}  (from ${e.pathFrom})`);
    const res = e.pathResult;
    lines.push(`      at rev    ${res.verdict.code === 'IDENTICAL' ? '' : `${res.verdict.code}; `}${describeFamilies(res, e.algo)}`);
    lines.push(...renderMatch(e.match, '      '));
  }
  for (const id of scan.ids) {
    lines.push(`  ${id.pointer}`);
    lines.push(`      id        ${id.value}  ${id.type ? `${id.type} in this clone` : `not in this clone${id.shallow ? ' (shallow clone)' : ''}`}; an object id under a key that names no blob: listed, not placed`);
  }
  return lines;
}

function describeFamilies(res, algo) {
  const groups = new Map();
  for (const r of res.bases.rows) {
    if (!r.available) continue;
    if (!groups.has(r.family)) groups.set(r.family, { names: [], hash: r[algo || 'sha256'], bytes: r.bytes });
    groups.get(r.family).names.push(r.name);
  }
  const unavailable = res.bases.rows.filter((r) => !r.available).map((r) => r.name);
  const parts = [...groups.values()].map((g) => `${g.names.join(' = ')} ${short(g.hash)} (${g3(g.bytes)} B)`);
  if (unavailable.length) parts.push(`${unavailable.join(', ')} unavailable`);
  return parts.join('; ');
}

// ------------------------------------------------------------------------------------------------

function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) return { exit: 3, text: `blob-basis: ${e.message}\n\n${USAGE}`, stream: 'stderr' };
    throw e;
  }
  if (opts.help) return { exit: 0, text: USAGE, stream: 'stdout' };

  const ctx = gitContext(opts.positional[0], opts.rev);
  if (ctx.fatal) return { exit: 3, text: `blob-basis: ${ctx.why}`, stream: 'stderr' };
  const paths = opts.positional.slice(1);
  const result = {
    tool: 'blob-basis',
    repo: ctx.repoDir,
    git: ctx.available
      ? { available: true, version: ctx.gitVersion, rev: opts.rev, commit: ctx.commit, commitDate: ctx.commitDate, shallow: ctx.shallow, reachableCommits: ctx.reachableCommits, autocrlf: ctx.autocrlf }
      : { available: false, why: ctx.why, version: ctx.gitVersion || null },
    paths: [],
    scans: [],
  };
  const codes = [];

  for (const p of paths) {
    const res = examinePath(ctx, p, opts);
    const matches = opts.expect.map((e) => placeHash(ctx, res, e.value, e.bytes, opts));
    res.expect = matches;
    result.paths.push(res);
    codes.push(outcomeOfPath(res, opts));
    for (const m of matches) codes.push(outcomeOfMatch(m, opts, res));
  }

  const pathCache = new Map();
  for (const file of opts.scan) {
    const scan = { file, entries: [], ids: [] };
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    } catch (e) {
      scan.error = `cannot read ${file} as JSON: ${e.message.split('\n')[0]}`;
      result.scans.push(scan);
      codes.push(2);
      continue;
    }
    const found = BB.scanJson(doc, opts.map);
    for (const h of found.hashes) {
      const e = { ...h };
      if (h.path) {
        // Paths recorded in provenance files (and given with --map) are relative to the repository root.
        const target = ctx.top ? path.join(ctx.top, h.path) : h.path;
        if (!pathCache.has(h.path)) pathCache.set(h.path, examinePath(ctx, target, { against: null }));
        e.pathResult = pathCache.get(h.path);
        e.match = placeHash(ctx, e.pathResult, h.value, h.recordedBytes, opts);
        codes.push(outcomeOfMatch(e.match, opts, e.pathResult));
      } else codes.push(2);
      scan.entries.push(e);
    }
    for (const id of found.ids) {
      const t = ctx.available ? gitRun(ctx.top, ['cat-file', '-t', id.value]) : { ok: false };
      scan.ids.push({ ...id, type: t.ok ? t.out : null, shallow: !!ctx.shallow });
    }
    result.scans.push(scan);
  }

  result.exit = combine(codes);
  return { exit: result.exit, result, opts, ctx };
}

function renderText(out) {
  const { result, ctx } = out;
  const lines = [];
  if (ctx.available) {
    lines.push(`blob-basis  repo ${result.repo}`);
    lines.push(`            rev  ${result.git.rev === result.git.commit ? '' : `${result.git.rev} = `}${result.git.commit.slice(0, 12)} (${result.git.commitDate})${result.git.shallow ? ` · shallow clone, ${result.git.reachableCommits} commits reachable` : ''} · git ${result.git.version} · core.autocrlf ${result.git.autocrlf}`);
  } else {
    lines.push(`blob-basis  ${result.repo}`);
    lines.push(`            blob basis UNAVAILABLE: ${result.git.why}`);
  }
  if (out.opts.brief && result.paths.length) lines.push('');
  for (const res of result.paths) {
    if (out.opts.brief) {
      lines.push(...renderBrief(res));
      continue;
    }
    lines.push('');
    lines.push(...renderPath(res, res.expect));
  }
  for (const scan of result.scans) {
    lines.push('');
    if (scan.error) lines.push(`scan ${scan.file}\n  REFUSED: ${scan.error}`);
    else lines.push(...renderScan(scan));
  }
  lines.push('');
  lines.push(`exit ${result.exit}: ${['held', 'a recorded hash matched no basis, or not the required one', 'refused: something needed could not be read'][result.exit]}`);
  return lines.join('\n');
}

// JSON: drop byte arrays, keep everything else.
function toJson(result) {
  return JSON.stringify(result, (k, v) => (v instanceof Uint8Array ? undefined : v), 2);
}

export { run, renderText, toJson, parseArgs, NODE_HASHER };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = run(process.argv.slice(2));
  if (out.text) {
    (out.stream === 'stderr' ? process.stderr : process.stdout).write(`${out.text}\n`);
  } else {
    process.stdout.write(`${out.opts.json ? toJson(out.result) : renderText(out)}\n`);
  }
  process.exitCode = out.exit;
}
