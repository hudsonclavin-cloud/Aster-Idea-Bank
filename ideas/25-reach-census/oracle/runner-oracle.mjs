#!/usr/bin/env node
// Build-time oracle (not imported by the page or the tests): exports each pinned commit of the
// source repositories with `git archive` (read-only on the checkout) into a scratch directory,
// then asks the repositories' OWN runners which files they launch:
//   Aster        node tools/run-tests.mjs   -> its "Discovered N test files" list (killed as soon
//                                              as the list is printed, before any test runs)
//                sh -c 'printf "%s\n" tests/*.test.mjs'  -> what `npm test` hands to node
//   PartForge    node tests/run.mjs          -> the "===== <file> =====" banners it prints for
//                                              every file it launches, and its SKIPPED line
//                                              (this one runs PartForge's suites to the end)
//                and again after `npm ci` in headless/ (needs the npm registry), when the
//                existsSync condition at tests/run.mjs:59 holds
//   Skyhook      node tools/twin/verify.mjs  -> its exit code and last line (no dependencies)
// census.test.mjs compares the census's reach for the same commands against this record.
//
//   node oracle/runner-oracle.mjs <scratch-dir> [--aster DIR] [--partforge DIR] > oracle/runners.json
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SCRATCH = args[0];
if (!SCRATCH || SCRATCH.startsWith('--')) { console.error('usage: node runner-oracle.mjs <scratch-dir> [--aster DIR] [--partforge DIR]'); process.exit(3); }
const DIRS = { aster: opt('--aster', '/home/user/asteroid-mining-planner'), partforge: opt('--partforge', '/home/user/Partforge'), skyhook: opt('--skyhook', '/home/user/skyhook') };

function exportTree(repo, commit) {
  const dest = path.join(SCRATCH, `${path.basename(DIRS[repo])}-${commit.slice(0, 7)}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', commit], { cwd: DIRS[repo], maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dest], { input: tar });
  return dest;
}

function runTestsDiscovery(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/run-tests.mjs'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const done = (files) => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve(files); };
    child.stdout.on('data', (c) => {
      out += c;
      const m = /Discovered (\d+) test files[^\n]*\n([\s\S]*?)\n\n/.exec(out);
      if (m) done({ discovered: Number(m[1]), files: m[2].split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.split(path.sep).join('/')) });
    });
    child.on('exit', () => reject(new Error('run-tests.mjs exited before printing its list:\n' + out.slice(0, 2000))));
  });
}

function shGlob(dir, pattern) {
  const r = spawnSync('sh', ['-c', `printf '%s\\n' ${pattern}`], { cwd: dir, encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean);
}

function partforgeRun(dir) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['tests/run.mjs'], { cwd: dir, encoding: 'utf8', timeout: 900000, maxBuffer: 256 << 20 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const launched = [];
  for (const m of out.matchAll(/^===== ([^\n]+?) =====$/gm)) {
    const b = m[1];
    if (/^node --test: /.test(b)) for (const f of b.slice(13).split(', ')) launched.push('tests/' + f.trim());
    else if (/^[\w.-]+\.test\.mjs$/.test(b)) launched.push('tests/' + b);
    else if (/^headless: api, http, llm tests/.test(b)) launched.push('headless/test/api.test.mjs', 'headless/test/http.test.mjs', 'headless/test/llm.test.mjs');
  }
  return {
    command: 'node tests/run.mjs', launched: launched.sort(), headlessSkipped: /headless: SKIPPED/.test(out),
    exit: r.status, seconds: Math.round((Date.now() - t0) / 1000),
    banners: Array.from(out.matchAll(/^===== ([^\n]+?) =====$/gm)).map((m) => m[1]),
  };
}

const record = { about: 'What each repository\'s own runner launches at a pinned commit (git archive export, so only tracked files; no node_modules). Written by oracle/runner-oracle.mjs.', recorded: new Date().toISOString().slice(0, 10), node: process.version, runs: [] };
for (const commit of ['62ddb1713feab34ac0730ecd66f18db8a076d718', 'a697963506c2638bbfa9d7a3c644b5f0aaf8709b']) {
  const dir = exportTree('aster', commit);
  const d = await runTestsDiscovery(dir);
  record.runs.push({ repo: 'asteroid-mining-planner', commit, command: 'node tools/run-tests.mjs', discovered: d.discovered, launched: d.files.sort() });
  record.runs.push({ repo: 'asteroid-mining-planner', commit, command: "sh -c 'printf \"%s\\n\" tests/*.test.mjs'  (what npm test's sh hands to node)", launched: shGlob(dir, 'tests/*.test.mjs').sort() });
  fs.rmSync(dir, { recursive: true, force: true });
}
for (const commit of ['0974a62b309b8cf7acd33771b49e9357d4d191f4', '60a90cd0475df8ae0ae28accb28e1a41448a6c8b']) {
  const dir = exportTree('partforge', commit);
  record.runs.push(Object.assign({ repo: 'Partforge', commit }, partforgeRun(dir)));
  if (commit.startsWith('0974a62')) {
    const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(dir, 'headless'), encoding: 'utf8', timeout: 600000 });
    if (ci.status === 0) {
      const t = spawnSync('npm', ['test'], { cwd: path.join(dir, 'headless'), encoding: 'utf8', timeout: 600000 });
      const out = `${t.stdout}${t.stderr}`;
      record.runs.push({ repo: 'Partforge', commit, command: 'npm test  (in headless/, after npm ci)', exit: t.status, tests: Number((/^. tests (\d+)/m.exec(out) || [])[1]), pass: Number((/^. pass (\d+)/m.exec(out) || [])[1]) });
      record.runs.push(Object.assign({ repo: 'Partforge', commit }, partforgeRun(dir), { command: 'node tests/run.mjs  (after npm ci in headless/)' }));
    } else record.runs.push({ repo: 'Partforge', commit, command: 'npm ci (in headless/)', exit: ci.status, note: 'install failed; the with-headless runs were not recorded' });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const commit = '34935cb1f67a8422a9fd49481e080faade2c0d92';
  const dir = exportTree('skyhook', commit);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['tools/twin/verify.mjs'], { cwd: dir, encoding: 'utf8', timeout: 600000 });
  record.runs.push({ repo: 'skyhook', commit, command: 'node tools/twin/verify.mjs', exit: r.status, seconds: Math.round((Date.now() - t0) / 100) / 10, lastLine: (r.stdout || '').trim().split('\n').pop() });
  fs.rmSync(dir, { recursive: true, force: true });
}
process.stdout.write(compactJson(record) + '\n');

// Pretty JSON with every array or object of plain values on one line (records stay diffable, and small).
function compactJson(v, ind = '') {
  const flat = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) ? x : Object.values(x)).every((y) => y === null || typeof y !== 'object' || (Array.isArray(y) && y.every((z) => z === null || typeof z !== 'object')));
  if (v === null || typeof v !== 'object' || flat(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return '[\n' + v.map((x) => ind + ' ' + compactJson(x, ind + ' ')).join(',\n') + '\n' + ind + ']';
  return '{\n' + Object.keys(v).map((k) => ind + ' ' + JSON.stringify(k) + ': ' + compactJson(v[k], ind + ' ')).join(',\n') + '\n' + ind + '}';
}
