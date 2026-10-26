#!/usr/bin/env node
// Copies data out of one of the source repositories into an idea folder and writes a provenance
// sidecar beside it, so a number in this bank can always be traced to a file and a commit in the
// repo it came from instead of being retyped from memory (the failure mode the Skyhook handoff
// warns about twice, and the Aster invariants INV-025/026 forbid on trust surfaces).
//
//   node tools/snapshot.mjs <repo-dir> <path-in-repo> <dest> [options]
//
// Writes <dest> and <dest>.provenance.json. Options:
//   --pick a.b,c.d      copy only these dot-path keys of a JSON file (an excerpt, recorded as such)
//   --limit a.b=N       cut the array at dot path a.b to its first N items (repeatable)
//   --note "text"       free-text note stored in the sidecar (what was excerpted and why)
//   --sidecar-only      do not copy; <dest> is a file this idea derived itself (by its own script),
//                       and the sidecar records which source file and commit it was derived from
//
// The sidecar records: repo remote URL, path, HEAD commit and its date, the committed blob id for
// the path (git rev-parse HEAD:path), the blob id of the bytes actually read (git hash-object),
// whether those differ (a dirty or line-ending-normalised checkout), the sha256 and byte count of
// the source file, and of the file written. Nothing is fetched; everything is read from the local
// checkout named on the command line.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

function usage(code) {
  console.error('Usage: node tools/snapshot.mjs <repo-dir> <path-in-repo> <dest> [--pick a.b,c] [--limit a.b=N] [--note "..."] [--sidecar-only]');
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { pick: null, limits: [], note: '', sidecarOnly: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pick') opts.pick = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') {
      const m = /^(.+)=(\d+)$/.exec(argv[++i] || '');
      if (!m) usage(2);
      opts.limits.push({ path: m[1], n: Number(m[2]) });
    } else if (a === '--note') opts.note = argv[++i] || '';
    else if (a === '--sidecar-only') opts.sidecarOnly = true;
    else if (a === '-h' || a === '--help') usage(0);
    else opts.positional.push(a);
  }
  if (opts.positional.length !== 3) usage(2);
  return opts;
}

function git(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [repoArg, relPath, destArg] = opts.positional;
  const repo = path.resolve(repoArg);
  const src = path.join(repo, relPath);
  const dest = path.resolve(destArg);
  if (!fs.existsSync(path.join(repo, '.git'))) {
    console.error(`not a git checkout: ${repo}`);
    process.exit(2);
  }
  if (!fs.existsSync(src)) {
    console.error(`no such file in repo: ${relPath}`);
    process.exit(2);
  }
  const srcBytes = fs.readFileSync(src);
  const provenance = {
    repo: git(repo, ['remote', 'get-url', 'origin']) || path.basename(repo),
    path: relPath.split(path.sep).join('/'),
    commit: git(repo, ['rev-parse', 'HEAD']),
    commitDate: git(repo, ['log', '-1', '--format=%cI']),
    pathLastChanged: git(repo, ['log', '-1', '--format=%h %cI', '--', relPath]),
    committedBlob: git(repo, ['rev-parse', `HEAD:${relPath.split(path.sep).join('/')}`]),
    readBlob: git(repo, ['hash-object', relPath]),
    sourceSha256: sha256(srcBytes),
    sourceBytes: srcBytes.length,
    copiedAt: new Date().toISOString(),
    mode: opts.sidecarOnly ? 'derived' : opts.pick || opts.limits.length ? 'excerpt' : 'copy',
    note: opts.note,
  };
  provenance.readMatchesCommitted = !!provenance.committedBlob && provenance.committedBlob === provenance.readBlob;

  let outBytes;
  if (opts.sidecarOnly) {
    if (!fs.existsSync(dest)) {
      console.error(`--sidecar-only: ${dest} does not exist yet; derive it first, then record its provenance`);
      process.exit(2);
    }
    outBytes = fs.readFileSync(dest);
  } else if (opts.pick || opts.limits.length) {
    let data;
    try {
      data = JSON.parse(srcBytes.toString('utf8'));
    } catch (e) {
      console.error(`--pick/--limit need a JSON source: ${e.message}`);
      process.exit(2);
    }
    let out = data;
    if (opts.pick) {
      out = {};
      for (const k of opts.pick) {
        const v = getPath(data, k);
        if (v === undefined) {
          console.error(`--pick: no such key ${k}`);
          process.exit(2);
        }
        setPath(out, k, v);
      }
      provenance.picked = opts.pick;
    }
    for (const { path: lp, n } of opts.limits) {
      const arr = getPath(out, lp);
      if (!Array.isArray(arr)) {
        console.error(`--limit: ${lp} is not an array in the picked data`);
        process.exit(2);
      }
      setPath(out, lp, arr.slice(0, n));
      (provenance.limits ||= []).push({ path: lp, kept: Math.min(n, arr.length), of: arr.length });
    }
    outBytes = Buffer.from(`${JSON.stringify(out, null, 1)}\n`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, outBytes);
  } else {
    outBytes = srcBytes;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, outBytes);
  }
  provenance.writtenSha256 = sha256(outBytes);
  provenance.writtenBytes = outBytes.length;
  fs.writeFileSync(`${dest}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`${provenance.mode}  ${path.relative(process.cwd(), dest)}  (${outBytes.length} bytes from ${provenance.path} @ ${(provenance.commit || '').slice(0, 7)}${provenance.readMatchesCommitted ? '' : ', read bytes differ from committed blob'})`);
}

main();
