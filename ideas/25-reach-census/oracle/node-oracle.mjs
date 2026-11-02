#!/usr/bin/env node
// Build-time oracle (not imported by the page or the tests): runs REAL Node binaries'
// `node --test` over a fixture tree and records, per Node version and argument list, which
// files actually ran and whether the run stopped. census.test.mjs compares the census's
// model of `node --test` (nodeTestReach in census.js) against this record.
//
//   node oracle/node-oracle.mjs <node-binary> [<node-binary> ...]   > oracle/node-behaviour.json
//
// The binaries used for the committed record were the official linux-x64 builds of
// v20.19.5 and v24.18.0 from nodejs.org/dist (sha256 checked against SHASUMS256.txt) and the
// v22.22.0 installed here. Each fixture file registers one test named after its own path, so
// the TAP output names exactly the files Node loaded. No shell is involved: the arguments
// reach Node as written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const FILES = [
  't/a.test.mjs', 't/b.test.js', 't/helper.mjs', 't/sub/c.test.mjs', 't/.hidden.test.mjs', 't/.dot/d.test.mjs',
  't/node_modules/e.test.mjs', 'test/x.mjs', 'test/unit/helper.cjs', 'up/test/unit/u.mjs',
  'lib/foo-test.mjs', 'lib/test-bar.cjs', 'lib/test.js', 'lib/baz_test.mjs', 'lib/qux.spec.mjs', 'lib/plain.mjs',
  'src/v2/m.test.mjs', 'src/v2/docs/n.test.mjs',
];
export const CASES = [
  ['t/'], ['t'], ['t/*.test.mjs'], ['t/**/*.test.mjs'], ['t/**'], ['missing.mjs'], ['t/a.test.mjs', 'missing.mjs'],
  ['missing1.mjs', 'missing2.mjs'], ['nomatch/*.mjs'], ['nomatch/*.mjs', 'missing.mjs'], ['up/test/unit'], ['up/test'],
  ['test'], ['lib'], ['lib/*'], ['{t,lib}/*.mjs'], ['**/*.test.mjs'], ['src/**/*.test.mjs'], ['t/a.test.mjs', 't/sub/c.test.mjs'],
];

function body(rel) {
  const name = JSON.stringify(rel);
  return rel.endsWith('.cjs') || rel.endsWith('.js')
    ? `const test = require('node:test'); test(${name}, () => {});\n`
    : `import test from 'node:test'; test(${name}, () => {});\n`;
}

function run(bin) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-oracle-'));
  try {
    for (const f of FILES) { fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body(f)); }
    // .js files are CommonJS here (no package.json "type")
    const version = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim();
    const cases = [];
    for (const args of CASES) {
      const r = spawnSync(bin, ['--test', '--test-reporter=tap', ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      const ran = [];
      for (const m of out.matchAll(/^\s*ok \d+ - (.+?)\s*$/gm)) if (FILES.includes(m[1])) ran.push(m[1]);
      cases.push({
        args, exit: r.status, ran: Array.from(new Set(ran)).sort(),
        couldNotFind: /Could not find/.test(out), cannotFindModule: /Cannot find module/.test(out),
      });
    }
    return { node: version, cases };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const bins = process.argv.slice(2);
  if (!bins.length) { console.error('usage: node node-oracle.mjs <node-binary> ...'); process.exit(3); }
  const record = {
    about: 'Which files real `node --test <args>` ran in a fixture tree, per Node version. Written by oracle/node-oracle.mjs; compared against census.js by census.test.mjs.',
    recorded: new Date().toISOString().slice(0, 10), files: FILES, runs: bins.map(run),
  };
  process.stdout.write(compactJson(record) + '\n');
}

// Pretty JSON with every array or object of plain values on one line (records stay diffable, and small).
function compactJson(v, ind = '') {
  const flat = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) ? x : Object.values(x)).every((y) => y === null || typeof y !== 'object' || (Array.isArray(y) && y.every((z) => z === null || typeof z !== 'object')));
  if (v === null || typeof v !== 'object' || flat(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return '[\n' + v.map((x) => ind + ' ' + compactJson(x, ind + ' ')).join(',\n') + '\n' + ind + ']';
  return '{\n' + Object.keys(v).map((k) => ind + ' ' + JSON.stringify(k) + ': ' + compactJson(v[k], ind + ' ')).join(',\n') + '\n' + ind + '}';
}
