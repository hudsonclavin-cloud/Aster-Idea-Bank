#!/usr/bin/env node
// Build-time oracle (not imported by the page or the tests): what REAL pytest collects from a
// fixture tree under default configuration, per argument list. census.test.mjs compares the
// census's pytest model (evalPytest and the inventory's test_*.py / *_test.py rule in census.js)
// against this record. Added by the independent review: before it, the default norecursedirs
// list and the *_test.py rule were pinned by no test.
//
//   node oracle/pytest-collection-oracle.mjs <absolute-path-to-pytest> > oracle/pytest-collection.json
//
// The committed record used pytest 9.2.0 from PyPI in a throw-away venv under the session
// scratchpad (python3 -m venv ... && pip install pytest==9.2.0). Every fixture file defines one
// test, and basenames are unique so pytest's default import mode never errors on a clash.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const FILES = [
  'test_top.py', 'helper.py',
  't/test_a.py', 't/b_test.py', 't/helper2.py', 't/Test_cap.py', 't/testing.py', 't/tests_plural.py',
  't/sub/test_c.py', 't/sub/deep/d_test.py',
  't/.hid/test_hid.py', 't/node_modules/test_nm.py', 't/build/test_build.py', 't/dist/test_dist.py',
  't/venv/test_venv.py', 't/x.egg/test_egg.py', 't/CVS/test_cvs.py', 't/_darcs/test_darcs.py',
  't/{arch}/test_arch.py', 't/builds/test_builds.py', 't/node_modules_x/test_nmx.py',
  'build/test_rootbuild.py', 't/env/pyvenv.cfg', 't/env/test_env.py', 't/.venv/pyvenv.cfg', 't/.venv/test_dotvenv.py',
];
export const CASES = [
  [], ['t'], ['t/'], ['build'], ['t/build'], ['t/.hid'], ['t/helper2.py'], ['t', 't/sub'],
  ['t/sub/test_c.py::test_it'], ['--ignore=t/sub', 't'], ['missing'], ['t/sub/deep'], ['t/env'],
];

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const bin = process.argv[2];
  if (!bin) { console.error('usage: node pytest-collection-oracle.mjs <pytest>'); process.exit(3); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-pytest-'));
  try {
    for (const f of FILES) {
      fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), 'def test_it():\n    pass\n');
    }
    const version = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    const cases = [];
    for (const args of CASES) {
      const r = spawnSync(bin, ['--collect-only', '-q', '-p', 'no:cacheprovider', ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      const collected = new Set();
      for (const m of out.matchAll(/^([^\s:]+\.py)::/gm)) collected.add(m[1]);
      cases.push({ args, exit: r.status, collected: Array.from(collected).sort() });
    }
    const head = {
      about: 'Which files real pytest collects (--collect-only, default configuration, no conftest) from a fixture tree, per argument list. Written by oracle/pytest-collection-oracle.mjs; compared against census.js by census.test.mjs.',
      recorded: new Date().toISOString().slice(0, 10),
      pytest: `${version.stdout || ''}${version.stderr || ''}`.trim(),
      files: FILES,
    };
    // one case per line, so a diff of the record reads case by case
    console.log(JSON.stringify(head).slice(0, -1) + ',"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(',\n') + '\n]}');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
