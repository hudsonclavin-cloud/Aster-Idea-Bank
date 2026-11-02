// Tests for census.js. Run from the bank root: node --test ideas/25-reach-census/census.test.mjs
//
// What the numbers are pinned to (none of it is this folder's own arithmetic):
//   oracle/node-behaviour.json  real `node --test` on a fixture tree, Node 20.19.5 / 22.22.0 / 24.18.0
//   oracle/runners.json         the repositories' own runners at the pinned commits: Aster's
//                               tools/run-tests.mjs discovery list, the sh expansion npm test feeds
//                               node, PartForge's tests/run.mjs banners (git archive exports)
//   oracle/pytest.txt           real pytest collection of Skyhook's tests/ with and without openpyxl
//   live                        fs.globSync, dash and bash on a temp tree, at test time
//   the source repos' own text  fix2-LOG.md:14 "96/96 files" at a697963; PartForge tests/run.mjs:44-47
//                               naming the two node:test files run.mjs never ran
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = require('./census.js');
const PACKS = {};
for (const k of ['aster', 'partforge', 'skyhook', 'aster-a697963', 'partforge-60a90cd']) PACKS[k] = require(`./snapshots/pack-${k}.js`);
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'census.config.json'), 'utf8')).repos;
const NODE_ORACLE = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/node-behaviour.json'), 'utf8'));
const RUNNERS = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/runners.json'), 'utf8'));
const PYTEST = fs.readFileSync(path.join(HERE, 'oracle/pytest.txt'), 'utf8');

const treeOf = (k) => { const p = PACKS[k]; return C.treeFromPack(p, p.base ? PACKS[p.base].config : p.config, PACKS); };
const censusOf = (k, opts) => C.censusRepo(treeOf(k), opts || {});
const runnerOracle = (repo, commit, cmdStart) => RUNNERS.runs.find((r) => r.repo === repo && r.commit.startsWith(commit) && r.command.startsWith(cmdStart));
const sorted = (a) => a.slice().sort();

// An in-memory tree; Markdown files get their documented commands extracted as the CLI does.
function fx(files, config) {
  const docCommands = [];
  for (const [f, t] of Object.entries(files)) if (/\.md$/i.test(f)) docCommands.push(...C.extractDocCommands(t, f));
  return C.makeTree({ id: 'fx', files: Object.keys(files), read: (p) => (p in files ? files[p] : null), docCommands, config: config || {} });
}
const ASTER_RUNNER = PACKS.aster.contents['tools/run-tests.mjs'];
const PF_RUNNER = PACKS.partforge.contents['tests/run.mjs'];
const T = "import test from 'node:test'; test('x', () => {});\n";
const WF = (run, node) => `name: CI\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '${node || 24}'\n      - name: tests\n        run: ${run}\n`;

// ---------------------------------------------------------------- real Node, recorded
test('node --test model matches real Node 20, 22 and 24 on every recorded case', () => {
  const tree = C.makeTree({ id: 'o', files: NODE_ORACLE.files, read: () => T });
  let n = 0;
  for (const run of NODE_ORACLE.runs) {
    const major = Number(/^v(\d+)/.exec(run.node)[1]);
    for (const c of run.cases) {
      const r = C.evaluateCommand(tree, 'node --test ' + c.args.map((a) => `'${a}'`).join(' '), { node: major });
      const launched = sorted(r.reach.concat(r.nonCandidates));
      assert.deepEqual(launched, c.ran, `Node ${major} ${c.args.join(' ')}: launched`);
      assert.equal(r.broken.length > 0, c.exit !== 0, `Node ${major} ${c.args.join(' ')}: fails (${r.broken.map((b) => b.why).join('; ')})`);
      n++;
    }
  }
  assert.equal(n, 57, '19 cases x 3 Node versions');
  assert.deepEqual(NODE_ORACLE.runs.map((r) => r.node), ['v20.19.5', 'v22.22.0', 'v24.18.0']);
});

test('the three Node behaviours the census depends on, as recorded', () => {
  const at = (v, args) => NODE_ORACLE.runs.find((r) => r.node.startsWith(v)).cases.find((c) => c.args.join(' ') === args);
  // a directory argument: Node 20 searches it, Node >= 21 fails
  assert.equal(at('v20', 't/').ran.length, 5);
  assert.ok(at('v24', 't/').cannotFindModule && at('v24', 't/').exit !== 0);
  // a quoted glob: Node 20 cannot find it, Node >= 21 expands it (no dot entries, no node_modules)
  assert.ok(at('v20', 't/**/*.test.mjs').couldNotFind);
  assert.deepEqual(at('v24', 't/**/*.test.mjs').ran, ['t/a.test.mjs', 't/sub/c.test.mjs']);
  // all-literal missing paths stop Node >= 21; one glob among them does not
  assert.ok(at('v22', 'missing1.mjs missing2.mjs').couldNotFind);
  assert.equal(at('v22', 'nomatch/*.mjs missing.mjs').exit, 0);
});

// ---------------------------------------------------------------- live: fs.globSync, dash, bash
const LIVE_FILES = NODE_ORACLE.files.concat(['lib/[x].mjs', 'lib/a b.mjs']);
function liveDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-live-'));
  for (const f of LIVE_FILES) { fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(root, f), T); }
  return root;
}
const LIVE_TREE = C.makeTree({ id: 'live', files: LIVE_FILES, read: () => T });

test('Node-glob expansion matches fs.globSync on a live tree', { skip: typeof fs.globSync !== 'function' && 'fs.globSync needs Node >= 22' }, () => {
  const root = liveDir();
  try {
    const v = C.view(LIVE_TREE, null);
    const pats = ['t/*.test.mjs', 't/**/*.test.mjs', '**/*.test.mjs', 't/**', '{t,lib}/*.mjs', 'lib/*', 'lib/?oo-test.mjs', 'lib/[bf]*.mjs', 't/.*.mjs', 'src/**/n.test.mjs', 'up/**/u.mjs', 'nomatch/*'];
    for (const p of pats) {
      const want = sorted(fs.globSync(p, { cwd: root, exclude: (n) => (typeof n === 'string' ? n : n.name) === 'node_modules' }).map((x) => x.split(path.sep).join('/')));
      assert.deepEqual(C.nodeGlob(v, '', p), want, p);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('sh (dash) and bash word expansion match the real shells on a live tree', () => {
  const root = liveDir();
  try {
    const v = C.view(LIVE_TREE, null);
    const cases = [
      ['sh', 't/*.test.mjs'], ['sh', 't/**/*.test.mjs'], ['sh', '*/*.test.mjs'], ['sh', 'nomatch/*'], ['sh', 't/.*.mjs'],
      ['sh', 'lib/[bf]*.mjs'], ['sh', '{t,lib}/*.mjs'], ['bash', '{t,lib}/*.mjs'], ['bash', 't/**/*.test.mjs'], ['sh', 'lib/\\[x\\].mjs'],
    ];
    for (const [shell, pat] of cases) {
      const real = spawnSync(shell, ['-c', `for w in ${pat}; do printf '%s\\n' "$w"; done`], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
      const mine = C.shExpand(v, '', pat, shell).map((w) => w.text);
      assert.deepEqual(mine, real, `${shell}: ${pat}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the repositories' own runners
test('Aster @62ddb17: CI full-tests reaches exactly what tools/run-tests.mjs discovers (97)', () => {
  const r = censusOf('aster');
  const o = runnerOracle('asteroid-mining-planner', '62ddb17', 'node tools/run-tests.mjs');
  assert.equal(o.discovered, 97);
  const step = r.entries.find((e) => e.kind === 'ci' && e.command === 'node tools/run-tests.mjs');
  assert.equal(step.source, '.github/workflows/ci.yml:93');
  assert.deepEqual(step.reach, o.launched);
});

test('Aster @62ddb17: npm test reaches exactly the 74 files sh hands to node', () => {
  const r = censusOf('aster');
  const o = runnerOracle('asteroid-mining-planner', '62ddb17', 'sh -c');
  const npmTest = r.entries.find((e) => e.kind === 'script' && e.file === 'package.json' && e.name === 'test');
  assert.deepEqual(npmTest.reach, o.launched);
  assert.equal(o.launched.length, 74);
});

test('Aster @a697963: 96 files, the count fix2-LOG.md:14 records for npm run verify ("96/96 files")', () => {
  const r = censusOf('aster-a697963');
  const o = runnerOracle('asteroid-mining-planner', 'a697963', 'node tools/run-tests.mjs');
  const verify = r.entries.find((e) => e.kind === 'script' && e.name === 'verify');
  assert.equal(verify.reach.length, 96);
  assert.deepEqual(verify.reach, o.launched);
  const npmTest = r.entries.find((e) => e.kind === 'script' && e.file === 'package.json' && e.name === 'test');
  assert.deepEqual(npmTest.reach, runnerOracle('asteroid-mining-planner', 'a697963', 'sh -c').launched);
});

test('PartForge @0974a62: node tests/run.mjs reaches what the real run.mjs launches; headless is the quoted condition', () => {
  const r = censusOf('partforge');
  const o = runnerOracle('Partforge', '0974a62', 'node tests/run.mjs');
  assert.equal(o.exit, 0);
  assert.ok(o.headlessSkipped, 'a fresh export has no headless/node_modules');
  const e = r.entries.find((x) => x.kind === 'doc' && x.command === 'node tests/run.mjs');
  assert.deepEqual(sorted(e.reach.filter((p) => !e.conditionalReach.includes(p))), o.launched);
  assert.deepEqual(e.conditionalReach, ['headless/test/api.test.mjs', 'headless/test/http.test.mjs', 'headless/test/llm.test.mjs']);
  const f = r.files.find((x) => x.path === 'headless/test/api.test.mjs');
  const route = f.routes.find((x) => x.entry === e.id);
  assert.match(route.conditions[0], /^tests\/run\.mjs:61 if \(fs\.existsSync\(path\.join\(hl, 'node_modules', 'openscad-wasm'\)\)\)$/);
  assert.equal(e.sources.length, 21);
});

test('PartForge @60a90cd: run.mjs reaches the 6 listed files; the two orphans are the two its later comment names', () => {
  const r = censusOf('partforge-60a90cd');
  const o = runnerOracle('Partforge', '60a90cd', 'node tests/run.mjs');
  const e = r.entries.find((x) => x.kind === 'doc' && x.command === 'node tests/run.mjs');
  assert.deepEqual(e.reach, o.launched);
  // tests/run.mjs:44-47 (today): "the local proxy, the provider error text ... the first two ... were never run by this file"
  assert.deepEqual(r.files.filter((f) => f.class === 'orphan').map((f) => f.path), ['tests/local-server.test.mjs', 'tests/provider-auth.test.mjs']);
  // and at 0974a62 both are reached by run.mjs's name-pattern readdir
  const now = censusOf('partforge').entries.find((x) => x.kind === 'doc' && x.command === 'node tests/run.mjs');
  assert.ok(now.reach.includes('tests/local-server.test.mjs') && now.reach.includes('tests/provider-auth.test.mjs'));
});

test('Skyhook @34935cb: pytest reach and the openpyxl skips match real pytest collection', () => {
  const r = censusOf('skyhook');
  const venvB = PYTEST.split('## venv b')[1];
  const collected = sorted(Array.from(venvB.matchAll(/^\s+\d+ (tests\/test_\w+\.py)$/gm)).map((m) => m[1]));
  const step = r.entries.find((e) => e.kind === 'ci' && /^pytest/.test(e.command));
  assert.deepEqual(step.reach, collected);
  assert.equal(collected.length, 6);
  // venv A is README.md's Quick start (pip install pytest): real pytest skips exactly these two files whole
  const venvA = PYTEST.split('## venv a')[1].split('## venv b')[0];
  const skipped = sorted(Array.from(venvA.matchAll(/SKIPPED \[1\] (tests\/\w+\.py):\d+: could not import 'openpyxl'/g)).map((m) => m[1]));
  assert.deepEqual(skipped, ['tests/test_export_grid.py', 'tests/test_finance.py']);
  for (const p of skipped) {
    const f = r.files.find((x) => x.path === p);
    const ci = f.routes.find((x) => x.kind === 'ci');
    const quick = f.routes.find((x) => x.kind === 'doc' && r.entries.find((e) => e.id === x.entry).sources.includes('README.md:70'));
    assert.equal(ci.fileConditions[0].satisfied, true, 'CI installs openpyxl (ci.yml:23)');
    assert.equal(quick.fileConditions[0].satisfied, false, 'the Quick start installs only pytest');
  }
  // the files pytest collected in venv A are exactly the other four
  const collectedA = sorted(Array.from(venvA.matchAll(/^\s+\d+ (tests\/test_\w+\.py)$/gm)).map((m) => m[1]));
  assert.deepEqual(collectedA, collected.filter((p) => !skipped.includes(p)));
});

test('PartForge @0974a62 with headless/node_modules installed: run.mjs launches all 13, as the census\'s conditional route says', () => {
  const o = RUNNERS.runs.find((r) => r.repo === 'Partforge' && r.command.startsWith('node tests/run.mjs  (after npm ci'));
  assert.equal(o.headlessSkipped, false);
  const e = censusOf('partforge').entries.find((x) => x.kind === 'doc' && x.command === 'node tests/run.mjs');
  assert.deepEqual(e.reach, o.launched);
  assert.equal(RUNNERS.runs.find((r) => r.command.startsWith('npm test  (in headless/')).pass, 27);
});

// ---------------------------------------------------------------- the drafted landings, read by the census itself
function withFiles(k, extra) {
  const p = PACKS[k];
  const files = Array.from(new Set(C.packFiles(p, PACKS).concat(Object.keys(extra))));
  return C.makeTree({ id: p.id, label: p.label, commit: p.commit, files, read: (f) => (f in extra ? extra[f] : p.contents[f] ?? null), docCommands: C.unpackDocCommands(p.docCommands), config: p.config });
}
const LAND = (f) => fs.readFileSync(path.join(HERE, 'landing', f), 'utf8');
test('landing: the drafted PartForge workflow puts 13 files in CI; only the slow parity pair and the harness stay out', () => {
  const r = C.censusRepo(withFiles('partforge', { '.github/workflows/ci.yml': LAND('partforge-ci.yml') }), {});
  assert.deepEqual(r.fatal, []);
  assert.deepEqual([r.counts.ci, r.counts['ci-less'], r.counts.manual, r.counts.orphan], [13, 2, 12, 0]);
  assert.deepEqual(r.files.filter((f) => f.class === 'ci-less').map((f) => f.path), ['headless/test/eval-truth.test.mjs', 'headless/test/parity.test.mjs']);
});
test('landing: the drafted Skyhook steps put tools/twin/verify.mjs in CI and the exit goes to 0', () => {
  const ci = PACKS.skyhook.contents['.github/workflows/ci.yml'] + '\n' + LAND('skyhook-ci-steps.yml');
  const res = C.census([withFiles('skyhook', { '.github/workflows/ci.yml': ci })], {});
  assert.deepEqual(res.repos[0].fatal, []);
  assert.equal(res.repos[0].files.find((f) => f.path === 'tools/twin/verify.mjs').class, 'ci');
  assert.equal(res.exit, 0);
  assert.equal(RUNNERS.runs.find((r) => r.repo === 'skyhook').exit, 0, 'and verify.mjs itself exits 0 at 34935cb');
});
test('landing: Aster with the census as a CI step reads its own step, and the allow list takes --fail-on ci-less to 0', () => {
  const ci = PACKS.aster.contents['.github/workflows/ci.yml'] + '\n' + LAND('aster-ci-step.yml');
  const tree = withFiles('aster', {
    '.github/workflows/ci.yml': ci,
    'tools/reach-census/reach-census.mjs': fs.readFileSync(path.join(HERE, 'reach-census.mjs'), 'utf8'),
    'tools/reach-census/census.js': fs.readFileSync(path.join(HERE, 'census.js'), 'utf8'),
    'tools/reach-census/allow.json': LAND('aster-reach-allow.json'),
  });
  const allow = JSON.parse(LAND('aster-reach-allow.json'));
  const without = C.census([tree], { failOn: 'ci-less' });
  assert.deepEqual(without.repos[0].fatal, [], 'the census does not refuse its own step');
  assert.equal(without.exit, 1);
  assert.equal(without.failing.length, 9);
  const withAllow = C.census([tree], { failOn: 'ci-less', allow });
  assert.equal(withAllow.exit, 0);
  assert.equal(withAllow.repos[0].counts.allowed, 9);
});

// ---------------------------------------------------------------- the census of the three repositories
test('Aster census: 106 test files, 97 in CI, 9 CI-less, no orphan; the 23 npm test misses', () => {
  const r = censusOf('aster');
  assert.deepEqual([r.counts.candidates, r.counts.ci, r.counts['ci-less'], r.counts.manual, r.counts.orphan], [106, 97, 9, 0, 0]);
  const ciLess = r.files.filter((f) => f.class === 'ci-less').map((f) => f.path);
  assert.deepEqual(ciLess.filter((p) => p.startsWith('mcp/')), ['mcp/test/compute-tools.test.ts', 'mcp/test/envelope.test.ts', 'mcp/test/provenance-bake.test.ts']);
  assert.equal(ciLess.filter((p) => p.startsWith('tools/slice16-harness/test/')).length, 6);
  const d = r.drift.find((x) => x.command === 'node --test tests/*.test.mjs');
  assert.deepEqual([d.reach, d.ciReach, d.missing.length], [74, 97, 23]);
  assert.deepEqual(d.claimSources, ['AGENTS.md:32', 'AGENTS.md:177']);
  // 13 under tests/ subfolders (the proposal's count) plus 10 colocated under src/v2 (which it missed)
  assert.equal(d.missing.filter((p) => p.startsWith('tests/')).length, 13);
  assert.equal(d.missing.filter((p) => p.startsWith('src/v2/')).length, 10);
  // the mcp suite is reached only through tsc's emitted dist/ (rootDir .., outDir dist)
  const mcp = r.entries.find((e) => e.kind === 'script' && e.file === 'mcp/package.json' && e.name === 'test');
  assert.deepEqual(mcp.reach, ['mcp/test/compute-tools.test.ts', 'mcp/test/envelope.test.ts', 'mcp/test/provenance-bake.test.ts']);
  // the documented directory form fails under Node >= 21 and would reach 6 under Node 20
  const dir = r.docBroken.find((x) => x.command === 'node --test tools/slice16-harness/test/');
  assert.ok(dir.sources.includes('tools/slice16-harness/RUNBOOK.md:41'));
  assert.ok(dir.why.some((w) => /Cannot find module/.test(w)) && dir.why.some((w) => /Node 20 would reach 6/.test(w)));
});

test('PartForge census: no workflow, 27 test files, 15 CI-less, 12 manual, server.mjs excluded with a reason', () => {
  const r = censusOf('partforge');
  assert.deepEqual(r.workflows, []);
  assert.deepEqual([r.counts.candidates, r.counts.ci, r.counts['ci-less'], r.counts.manual, r.counts.orphan], [27, 0, 15, 12, 0]);
  assert.ok(!r.files.some((f) => f.path === 'tests/harness/server.mjs'));
  assert.ok(r.files.filter((f) => f.class === 'manual').every((f) => f.path.startsWith('tests/harness/')));
});

test('Skyhook census: tools/twin/verify.mjs is the one orphan, and exit is 1 for it', () => {
  const res = C.census([treeOf('skyhook')], {});
  const r = res.repos[0];
  assert.deepEqual(r.files.filter((f) => f.class === 'orphan').map((f) => f.path), ['tools/twin/verify.mjs']);
  assert.equal(res.exit, 1);
  assert.deepEqual(res.failing, [{ repo: 'skyhook', path: 'tools/twin/verify.mjs', class: 'orphan' }]);
  assert.deepEqual(r.files.find((f) => f.path === 'tools/twin/verify.mjs').mentions.map((m) => `${m.file}:${m.line}`), ['materials/core.md:96', 'tools/sims/skyhook_program_site.html:948']);
  // an allow list covering it turns the exit to 0; one capped at ci-less does not
  assert.equal(C.census([treeOf('skyhook')], { allow: [{ repo: 'skyhook', glob: 'tools/twin/*.mjs', reason: 'run by hand' }] }).exit, 0);
  assert.equal(C.census([treeOf('skyhook')], { allow: [{ glob: 'tools/twin/*.mjs', upTo: 'ci-less', reason: 'x' }] }).exit, 1);
});

test('census.json is exactly what the packs recompute to (it cannot go stale silently)', () => {
  const trees = ['aster', 'partforge', 'skyhook'].map(treeOf);
  const fresh = JSON.parse(JSON.stringify(C.compact(C.census(trees, {}))));
  const stored = JSON.parse(fs.readFileSync(path.join(HERE, 'census.json'), 'utf8'));
  assert.deepEqual(fresh, stored);
});

const pinnedCheckout = (dir, commit) => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() === commit && execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim() === ''; } catch { return false; } };
for (const [k, dir] of [['aster', '/home/user/asteroid-mining-planner'], ['partforge', '/home/user/Partforge'], ['skyhook', '/home/user/skyhook']]) {
  test(`a live checkout of ${k} at the pinned commit gives the same census as its pack`, { skip: !pinnedCheckout(dir, PACKS[k].commit) && `${dir} is not a clean checkout at ${PACKS[k].commit.slice(0, 7)}` }, async () => {
    const { liveTree } = await import('./reach-census.mjs');
    const id = PACKS[k].id;
    const live = C.compact(C.census([liveTree(dir, CONFIG[id])], {}));
    const pack = C.compact(C.census([treeOf(k)], {}));
    assert.deepEqual(JSON.parse(JSON.stringify(live)), JSON.parse(JSON.stringify(pack)));
  });
}

// ---------------------------------------------------------------- fixture repositories
test('fixture: a CI runner, a narrower npm test, a doc that calls npm test the suite, an orphan', () => {
  const runner = ASTER_RUNNER.replace("const searchRoots = ['tests', path.join('src', 'v2')];", "const searchRoots = ['tests'];");
  assert.notEqual(runner, ASTER_RUNNER, 'the runner text changed shape; update the fixture');
  const tree = fx({
    'package.json': JSON.stringify({ scripts: { test: 'node --test tests/*.test.mjs', 'test:all': 'node tools/run-tests.mjs' } }),
    '.github/workflows/ci.yml': WF('node tools/run-tests.mjs'),
    'tools/run-tests.mjs': runner,
    'tests/a.test.mjs': T, 'tests/b.test.mjs': T, 'tests/deep/c.test.mjs': T, 'tests/docs/skipped.test.mjs': T,
    'lib/x.test.mjs': T,
    'CONTRIBUTING.md': 'Before any commit, run the test suite: `npm test`.\n',
  });
  const r = C.censusRepo(tree, {});
  const cls = Object.fromEntries(r.files.map((f) => [f.path, f.class]));
  assert.deepEqual(cls, { 'lib/x.test.mjs': 'orphan', 'tests/a.test.mjs': 'ci', 'tests/b.test.mjs': 'ci', 'tests/deep/c.test.mjs': 'ci', 'tests/docs/skipped.test.mjs': 'orphan' });
  assert.equal(r.drift.length, 1);
  assert.deepEqual([r.drift[0].command, r.drift[0].reach, r.drift[0].ciReach, r.drift[0].missing], ['npm test', 2, 3, ['tests/deep/c.test.mjs']]);
  assert.deepEqual(r.drift[0].claimSources, ['CONTRIBUTING.md:1']);
});

test('fixture: CI-less and conditional, read from PartForge\'s own runner shape', () => {
  const tree = fx({
    'index.html': '<!-- -->',
    'tests/run.mjs': PF_RUNNER,
    'tests/flight-eng.test.mjs': T, 'tests/flight-cmm.test.mjs': T, 'tests/flight-decl.test.mjs': T, 'tests/flight-dxf.test.mjs': T, 'tests/flight-db.test.mjs': T, 'tests/flight-db-embed.test.mjs': T,
    'tests/zz-new.test.mjs': T, 'tests/flight-new.test.mjs': T,
    'headless/package.json': JSON.stringify({ scripts: {} }),
    'headless/test/api.test.mjs': T, 'headless/test/http.test.mjs': T, 'headless/test/llm.test.mjs': T,
    'README.md': 'Run every suite before a push: `node tests/run.mjs`\n',
  });
  const r = C.censusRepo(tree, {});
  const cls = Object.fromEntries(r.files.map((f) => [f.path, f.class + (f.conditional ? '+cond' : '')]));
  // listed (6), picked up by the readdir pattern (zz-new), excluded by it (flight-new: listed nowhere)
  assert.equal(cls['tests/zz-new.test.mjs'], 'ci-less');
  assert.equal(cls['tests/flight-new.test.mjs'], 'orphan');
  assert.equal(cls['headless/test/api.test.mjs'], 'ci-less+cond');
  assert.equal(r.counts.conditional, 3);
  assert.equal(Object.values(cls).filter((c) => c === 'ci-less').length, 7);
});

test('refusal: a runner the parser cannot read is "not understood", never reached, and exits 2', () => {
  const runner = "import { spawnSync } from 'node:child_process';\nimport { globSync } from 'node:fs';\nfor (const f of globSync('tests/**/*.test.mjs')) spawnSync(process.execPath, ['--test', f]);\n";
  const tree = fx({ '.github/workflows/ci.yml': WF('node tools/run.mjs'), 'tools/run.mjs': runner, 'tests/a.test.mjs': T });
  const res = C.census([tree], {});
  const r = res.repos[0];
  assert.equal(res.exit, 2);
  assert.equal(r.files[0].class, 'orphan', 'not counted as reached');
  assert.match(r.fatal[0].why, /runner not understood/);
  assert.match(C.renderText(res), /CENSUS INCOMPLETE/);
});

test('refusal: unknown CI programs, YAML anchors, pytest configuration, reusable workflows', () => {
  const one = (files) => C.census([fx(files)], {});
  assert.equal(one({ '.github/workflows/ci.yml': WF('make test'), 'tests/a.test.mjs': T }).exit, 2);
  const anchors = 'jobs:\n  a: &x\n    runs-on: ubuntu-latest\n  b: *x\n';
  const ra = one({ '.github/workflows/ci.yml': anchors, 'tests/a.test.mjs': T });
  assert.equal(ra.exit, 2);
  assert.match(ra.repos[0].fatal[0].why, /anchor, alias or tag/);
  const rp = one({ '.github/workflows/ci.yml': WF('pytest tests/'), 'pytest.ini': '[pytest]\ntestpaths = other\n', 'tests/test_a.py': 'def test_a(): pass\n' });
  assert.equal(rp.exit, 2);
  assert.match(rp.repos[0].fatal[0].why, /pytest configuration in pytest\.ini/);
  const ru = one({ '.github/workflows/ci.yml': 'jobs:\n  call:\n    uses: org/repo/.github/workflows/t.yml@v1\n', 'tests/a.test.mjs': T });
  assert.match(ru.repos[0].fatal[0].why, /reusable workflow/);
});

test('documented commands: placeholders are skipped, cd chains are followed, a missing path is broken', () => {
  const tree = fx({
    'headless/package.json': JSON.stringify({ scripts: { 'test:parity': 'node --test test/p.test.mjs' } }),
    'headless/test/p.test.mjs': T,
    'docs/HOW.md': 'Run `cd headless && npm run test:parity`, then `node --test <file>`, then `node --test tests/gone.test.mjs`.\n',
  });
  const r = C.censusRepo(tree, { localNode: 24 });
  assert.equal(r.files[0].class, 'ci-less');
  const cmds = r.entries.filter((e) => e.kind === 'doc').map((e) => e.command);
  assert.ok(cmds.includes('cd headless && npm run test:parity'));
  assert.ok(!cmds.some((c) => /<file>/.test(c)), 'placeholder skipped');
  const gone = r.docBroken.find((d) => /gone/.test(d.command));
  assert.match(gone.why[0], /Could not find/);
});

test('tsc: emitted paths follow rootDir and outDir; extends is refused rather than guessed', () => {
  const files = (cfg) => fx({
    'pkg/package.json': JSON.stringify({ scripts: { test: 'tsc -p . && node --test dist/test/*.js' } }),
    'pkg/tsconfig.json': JSON.stringify(cfg),
    'pkg/test/a.test.ts': '', 'pkg/test/b.test.ts': '', 'pkg/src/x.ts': '',
  });
  // rootDir "." keeps test/ in the output path: dist/test/a.test.js
  let r = C.censusRepo(files({ compilerOptions: { rootDir: '.', outDir: 'dist' }, include: ['test/**/*.ts'] }), {});
  assert.deepEqual(r.entries.find((e) => e.kind === 'script').reach, ['pkg/test/a.test.ts', 'pkg/test/b.test.ts']);
  // no rootDir: tsc uses the inputs' common folder (pkg/test), so the files land in dist/ and the glob misses them
  r = C.censusRepo(files({ compilerOptions: { outDir: 'dist' }, include: ['test/**/*.ts'] }), {});
  assert.deepEqual(r.entries.find((e) => e.kind === 'script').reach, []);
  r = C.censusRepo(files({ extends: '../base.json', compilerOptions: { outDir: 'dist' } }), {});
  assert.match(r.fatal[0].why, /extends/);
});

test('every snapshot\'s sidecar records the bytes on disk (writtenSha256) and a source commit', () => {
  const crypto = require('node:crypto');
  for (const f of fs.readdirSync(path.join(HERE, 'snapshots')).filter((x) => x.endsWith('.js'))) {
    const sc = JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots', f + '.provenance.json'), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, 'snapshots', f))).digest('hex');
    assert.equal(sc.writtenSha256, sha, f);
    assert.equal(sc.commit, require(path.join(HERE, 'snapshots', f)).commit, f);
  }
});

// ---------------------------------------------------------------- parsers
test('YAML subset: block scalars, flow sequences, quoted scalars, comments, line numbers', () => {
  const y = C.parseYaml('on:\n  push:\n    branches: [main, "dev"]\njobs:\n  t:\n    steps:\n      - run: |\n          a \\\n            b\n          c\n      - run: >-\n          x\n          y\n      - name: \'it\'\'s\'  # comment\n        run: echo "#not a comment"\n');
  assert.deepEqual(y.on.push.branches, ['main', 'dev']);
  assert.equal(y.jobs.t.steps[0].run, 'a \\\n  b\nc\n');
  assert.equal(y.jobs.t.steps[1].run, 'x y');
  assert.equal(y.jobs.t.steps[2].name, "it's");
  assert.equal(y.jobs.t.steps[2].run, 'echo "#not a comment"');
  assert.equal(y.jobs.t.steps.__lines[2], 14);
  const aster = C.parseYaml(PACKS.aster.contents['.github/workflows/ci.yml']);
  assert.deepEqual(Object.keys(aster.jobs), ['typecheck', 'build', 'golden-numbers', 'full-tests']);
  assert.equal(aster.jobs['full-tests'].steps[0].with['fetch-depth'], '0');
});

test('YAML subset agrees with PyYAML (BaseLoader) on the workflows and the edge cases it claims to read', () => {
  const Y = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/yaml-behaviour.json'), 'utf8'));
  // BaseLoader resolves no tags, so it keeps ~ and null as text where the YAML core schema (and
  // census.js) reads null; both sides fold null and '' together, nothing else is normalised
  const mine = (x) => (x === null ? '' : Array.isArray(x) ? x.map(mine) : typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, mine(v)])) : String(x));
  const theirs = (x) => (x === '~' || x === 'null' ? '' : Array.isArray(x) ? x.map(theirs) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, theirs(v)])) : x);
  assert.equal(Y.docs.length, 11);
  for (const d of Y.docs) assert.deepEqual(mine(C.parseYaml(d.text)), theirs(d.value), d.name);
});

test('shell parsing: quotes protect globs, separators, redirections and || conditions', () => {
  const p = C.shellParse("cd a && node --test 'x/*.mjs' \"y z\" 2>&1 | grep ok || echo no; FOO=1 npm test > out.txt");
  assert.equal(p.error, null);
  assert.deepEqual(p.cmds.map((c) => [c.words.map((w) => w.text).join(' '), c.sep]), [['cd a', '&&'], ['node --test x/*.mjs y z', '|'], ['grep ok', '||'], ['echo no', ';'], ['npm test', null]]);
  assert.equal(p.cmds[1].words[2].pat, 'x/\\*.mjs', 'the quoted * is escaped so sh would not expand it');
  assert.deepEqual(p.cmds[4].assigns, ['FOO=1']);
  assert.match(C.shellParse('node $(ls)').error, /substitution/);
  const tree = fx({ 'a.test.mjs': T, 'b.test.mjs': T });
  const r = C.evaluateCommand(tree, 'false || node --test a.test.mjs');
  assert.deepEqual(r.conditional, ['a.test.mjs']);
});

test('front coding of path lists round-trips the three packs\' file lists', () => {
  for (const k of ['aster', 'partforge', 'skyhook']) {
    const files = C.packFiles(PACKS[k], PACKS);
    assert.equal(files.length, PACKS[k].fileCount);
    assert.deepEqual(C.unpackPaths(C.packPaths(files)), sorted(files));
  }
  assert.equal(C.packFiles(PACKS['aster-a697963'], PACKS).length, PACKS['aster-a697963'].fileCount);
});

// ---------------------------------------------------------------- CLI
test('CLI: exit codes 0 / 1 / 2 / 3 and --json on a fixture directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-cli-'));
  const cli = path.join(HERE, 'reach-census.mjs');
  const w = (f, t) => { fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  const run = (...a) => spawnSync(process.execPath, [cli, root, '--no-config', ...a], { encoding: 'utf8' });
  try {
    w('package.json', JSON.stringify({ scripts: { test: 'node --test tests/*.test.mjs' } }));
    w('tests/a.test.mjs', T);
    assert.equal(run().status, 0);
    assert.equal(run('--fail-on', 'ci-less').status, 1);
    w('lib/orphan.test.mjs', T);
    const r1 = run('--json', '-');
    assert.equal(r1.status, 1);
    const j = JSON.parse(r1.stdout);
    assert.deepEqual(j.failing.map((f) => f.path), ['lib/orphan.test.mjs']);
    w('allow.json', JSON.stringify([{ glob: 'lib/*.test.mjs', reason: 'fixture' }]));
    assert.equal(run('--allow', path.join(root, 'allow.json')).status, 0);
    w('.github/workflows/ci.yml', WF('make check'));
    assert.equal(run().status, 2);
    assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 3);
    assert.equal(run('--fail-on', 'ci').status, 3);
    assert.match(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).stdout, /Exit: 0 clean/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
