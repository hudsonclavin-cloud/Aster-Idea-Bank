// Tests for Line Drift. From the bank root:
//   node --test ideas/23-line-drift/linedrift.test.mjs
// Four groups: the pure module on hand-made text; the CLI on a throwaway git repository built
// here (full, shallow and git-less copies); the module on real Aster prose and targets copied
// under snapshots/ at 62ddb17 (always runs); and the CLI on the Aster checkout itself (skipped when
// /home/user/asteroid-mining-planner or its commit 62ddb17 is absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(path.join(here, 'linedrift.js'));
const CLI = path.join(here, 'line-drift.mjs');
const SNAP = path.join(here, 'snapshots');
const ASTER = '/home/user/asteroid-mining-planner';

function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const json = (args) => {
  const r = cli([...args, '--json']);
  return { code: r.code, rep: JSON.parse(r.out) };
};
const find = (rep, doc, raw, line) => rep.findings.filter((f) => f.doc === doc && (f.raw === raw || f.hex === raw) && (line == null || f.line === line));
const one = (rep, doc, raw, line) => {
  const hits = find(rep, doc, raw, line);
  assert.equal(hits.length, 1, `exactly one finding for ${doc}:${line} ${raw} (got ${hits.length})`);
  return hits[0];
};

// A tiny in-memory env for the pure module.
function memEnv(files, extra = {}) {
  const list = Object.keys(files);
  return {
    files: () => list,
    exists: (p) => (p in files ? 'file' : list.some((f) => f.startsWith(`${p.replace(/\/$/, '')}/`)) ? 'dir' : null),
    read: (p) => (p in files ? files[p] : null),
    tracked: (p) => p in files,
    ignored: () => null,
    forceAdded: () => null,
    ...extra,
  };
}
const refsOf = (text, doc = 'DOC.md') => L.extract(text, doc).refs;
const judgeAll = (text, files, doc = 'DOC.md', extra) => {
  const ex = L.extract(text, doc);
  const env = memEnv(files, extra);
  return ex.refs.map((r) => ({ ...r, ...L.judge(r, env, ex.units[r.unit].text) }));
};

// Excerpt snapshots carry one header line naming the source lines they came from.
function excerpt(name) {
  const raw = fs.readFileSync(path.join(SNAP, name), 'utf8');
  const m = /^<!-- excerpt of (\S+) lines (\d+)-(\d+) at (\w+) -->\n/.exec(raw);
  assert.ok(m, `${name} has its header`);
  return { doc: m[1], from: Number(m[2]), to: Number(m[3]), commit: m[4], text: raw.slice(m[0].length) };
}

// ---------------------------------------------------------------------------------------------
// 1. The pure module

test('code spans follow CommonMark: n backticks close on exactly n, line endings become spaces', () => {
  const spans = L.codeSpans('a `x` b ``y ` z`` c `one` and `two\nlines` d ``never closed');
  assert.deepEqual(spans.map((s) => s.content), ['x', 'y ` z', 'one', 'two lines']);
  assert.deepEqual(L.codeSpans('`a\nb`').map((s) => s.content), ['a b']);
});

test('extraction: full, bare-continuation, comma-list and plain-text citations; fenced code is skipped', () => {
  const text = [
    'See `src/x.ts:12` and `:14-16`, and `lib/y.mjs:3,7-8`.',
    '',
    'Plain: tools/z.py:40 and a ratio of 5.9:1 and a time 13:43:53.',
    '',
    '```',
    '`src/inside-fence.ts:1`',
    '```',
    '',
    'A bare `:9` with no path before it.',
  ].join('\n');
  const refs = refsOf(text).filter((r) => r.kind === 'line');
  assert.deepEqual(refs.map((r) => [r.line, r.path, L.fmtRanges(r.ranges)]), [
    [1, 'src/x.ts', '12'], [1, 'src/x.ts', '14-16'], [1, 'lib/y.mjs', '3,7-8'], [3, 'tools/z.py', '40'], [9, null, '9'],
  ]);
  const extless = refsOf('The hook `.githooks/pre-commit:53` counts.').filter((r) => r.kind === 'line');
  assert.deepEqual(extless.map((r) => r.path), ['.githooks/pre-commit']);
});

test('a bare :N takes the last citation, else the first path of its sentence, else of its paragraph', () => {
  const refs = refsOf('`tools/a.mjs` reads `data/b.json` at `:5` (`x`). Then `c.ts:1` and `:2`.').filter((r) => r.kind === 'line');
  assert.deepEqual(refs.map((r) => [r.path, r.inherited || '']), [['tools/a.mjs', 'path named in the sentence'], ['c.ts', ''], ['c.ts', 'last citation']]);
});

test('commit tokens: 7-12 or 40 hex with a digit and a letter; fingerprints, hashes and words are not commits', () => {
  const refs = refsOf('Commits `abc1234`, `0123456789ab`, plain d8c4681, full `' + 'a'.repeat(39) + '1`. A prompt prefix `6f9b1c8c74020915`. A run `c72de26bafcbda8d5693483e`. A tarball shasum c912f2b. A sha256 `b278dd55`. The word `defaced`. The number 1234567.');
  const commits = refs.filter((r) => r.kind === 'commit');
  assert.deepEqual(commits.map((r) => [r.hex.slice(0, 8), !!r.hashLike]), [
    ['abc1234', false], ['01234567', false], ['d8c4681', false], ['aaaaaaaa', false],
    ['6f9b1c8c', true], ['c72de26b', true], ['c912f2b', true], ['b278dd55', true],
  ]);
});

test('paths: extensions and folders count; extension-only, globs, routes and node: specifiers do not', () => {
  for (const p of ['src/v2/core/', 'tools/x/y.json', 'STATUS.md', '.gitignore', 'mcp/.gitignore']) assert.equal(L.looksLikePath(p), true, p);
  for (const p of ['.md', '.ts', 'docs/**', '/v2/porkchop/', 'node:test', 'GRID_PARAMS.nDep', 'km/s', '../a.ts', 'a b.md']) assert.equal(L.looksLikePath(p), false, p);
  assert.equal(L.isPlaceholder('file.new.ts'), true);
  assert.equal(L.isPlaceholder('src/v2/launch-vehicles.ts'), false);
});

test('snippets pair with the nearest citation in their sentence, within the gap, never across sentences', () => {
  const near = refsOf('`a.ts:3` returns `alpha`, and `b.ts:9` returns `beta`.').filter((r) => r.kind === 'line');
  assert.deepEqual(near.map((r) => r.snippets.map((s) => s.text)), [['alpha'], ['beta']]);
  const joined = refsOf('`twice` is at `a.ts:4`, and `LIMIT = 75` is at `:7`.').filter((r) => r.kind === 'line');
  assert.deepEqual(joined.map((r) => r.snippets.map((s) => s.text)), [['twice'], ['LIMIT = 75']], '"is at" binds a snippet to the citation after it');
  const quoteThenCite = refsOf('It says "the whole sentence here." And `c.ts:4` is unrelated.').filter((r) => r.kind === 'line');
  assert.deepEqual(quoteThenCite[0].snippets, [], 'a quote that ends its own sentence does not pair with the next one');
  const at = (gap) => refsOf(`\`a.ts:1\` ${'word '.repeat(gap / 5)}\`far\``).filter((r) => r.kind === 'line')[0].snippets.length;
  assert.equal(at(60), 1, 'a snippet 61 characters away pairs');
  assert.equal(at(100), 0, 'a snippet 101 characters away is left unpaired (the gap is 80)');
  const scare = refsOf('`a.ts:1` is "committed" here.').filter((r) => r.kind === 'line');
  assert.deepEqual(scare[0].snippets, [], 'a one-word scare quote is not a snippet');
});

test('line verdicts: OK, MOVED (with where), GONE, PAST-EOF, IN-RANGE, PARTIAL, and the loose and compact matches', () => {
  const a = ['// one', '// two', 'export const answer = 42;', '// four', "const s = 'Grid: 200×100';", 'const k = { confidence: \'assumed\' };', 'p_V = 0.14 ± 0.02 – the bias-corrected mean albedo of the NEO population, "for which", Stuart', ''].join('\n');
  const files = { 'a.ts': a };
  const v = (doc) => judgeAll(doc, files).filter((r) => r.kind === 'line')[0];
  assert.equal(v('At `a.ts:3` (`export const answer = 42`).').status, 'OK');
  const moved = v('At `a.ts:4` (`export const answer = 42`).');
  assert.equal(moved.status, 'MOVED');
  assert.deepEqual(moved.movedTo, [':3']);
  assert.equal(v('At `a.ts:3` (`export const answer = 43`).').status, 'GONE');
  const eof = v('At `a.ts:40` (`answer`).');
  assert.equal(eof.status, 'PAST-EOF');
  assert.match(eof.note, /the file has 7 lines; snippet now at :3/);
  assert.equal(v('Just `a.ts:2`.').status, 'IN-RANGE');
  const loose = v('Here `a.ts:5` (`Grid: 200x100`).');
  assert.equal(loose.status, 'OK');
  assert.match(loose.note, /folding/);
  const compact = v('Here `a.ts:6` sets `confidence:"assumed"`.');
  assert.equal(compact.status, 'OK');
  assert.match(compact.note, /spacing and quote style/);
  const partial = v('`a.ts:7` reads "p_V = 0.14 ± 0.02 — the bias-corrected mean albedo of the NEO population — Stuart".');
  assert.equal(partial.status, 'PARTIAL');
  assert.match(partial.note, /hold 14 of the snippet's 16 words/);
  assert.equal(v('`a.ts:7` reads "the bias-corrected mean albedo was something else entirely, and more".').status, 'GONE', 'a 4-word common run is not PARTIAL');
});

test('path resolution: repo root, the document folder, a unique suffix, a folder named in the paragraph, ambiguity', () => {
  const files = { 'mcp/src/tools/c.ts': 'x\n', 'src/v2/app/porkchop/main.ts': 'm\n', 'src/v2/app/compare/main.ts': 'm\n', 'src/v2/porkchop/launch-vehicles.ts': 'l\n' };
  const env = memEnv(files);
  assert.deepEqual(L.resolvePath('src/tools/c.ts', 'mcp/README.md', env).path, 'mcp/src/tools/c.ts');
  assert.equal(L.resolvePath('src/tools/c.ts', 'mcp/README.md', env).how, 'document folder');
  assert.equal(L.resolvePath('tools/c.ts', 'X.md', env).how, 'unique suffix');
  assert.equal(L.resolvePath('main.ts', 'X.md', env).status, 'AMBIGUOUS');
  assert.equal(L.resolvePath('main.ts', 'X.md', env, 'see src/v2/app/porkchop/ first').path, 'src/v2/app/porkchop/main.ts');
  const miss = L.resolvePath('src/v2/launch-vehicles.ts', 'X.md', env);
  assert.equal(miss.status, 'MISSING');
  assert.deepEqual(miss.sameName, ['src/v2/porkchop/launch-vehicles.ts']);
});

test('context: a later paragraph that corrects the same path is found; generic names do not count', () => {
  const doc = [
    'The vehicles live in `src/v2/launch-vehicles.ts`.',
    '',
    'Unrelated: `REPORT.md` is fine.',
    '',
    'Correction: `src/v2/launch-vehicles.ts` has never existed; the module is elsewhere.',
    '',
    'The write-up goes to `evals/x/REPORT.md`.',
    '',
    'Another REPORT.md was removed.',
  ].join('\n');
  const ex = L.extract(doc, 'D.md');
  const first = ex.refs.find((r) => r.raw === 'src/v2/launch-vehicles.ts' && r.line === 1);
  assert.equal(L.context(first, ex.units).annotatedAt, 5);
  const rep = ex.refs.find((r) => r.raw === 'evals/x/REPORT.md');
  assert.equal(L.context(rep, ex.units).annotatedAt, undefined, 'a 9-character file name is too generic to match on its own');
});

// ---------------------------------------------------------------------------------------------
// 2. The CLI on a throwaway git repository

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'line-drift-test-'));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1', HOME: tmpRoot };
const g = (cwd, ...args) => execFileSync('git', args, { cwd, env: { ...gitEnv, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

const A_V1 = ['// fixture', "export const greeting = 'hello';", 'export const answer = 42;', 'export function twice(x) {', '  return x * 2;', '}', 'export const LIMIT_SECONDS = 75 * 60;', '// end', ''].join('\n');
const A_V2 = `// header one\n// header two\n${A_V1}`;
const NOTES = (c1, absent, v2) => [
  '# Notes',
  '',
  'The answer is set at `a.ts:3` (`export const answer = 42`).',
  '',
  'The helper `twice` is at `a.ts:4`, and `LIMIT_SECONDS = 75 * 60` is at `:7`.',
  '',
  `The greeting reads "export const greeting = 'hello'" at \`a.ts:2\`${v2 ? ' (reworded)' : ''}.`,
  '',
  'A wrong quote: `a.ts:5` says `return x * 3`.',
  '',
  'Past the end: `a.ts:99`.',
  '',
  'Evidence: `secret/data.json`.',
  '',
  'Kept: `secret/keep.json`. Forced: `secret/forced.json`.',
  '',
  'Scratch: `untracked.txt`.',
  '',
  'Data: `gone.json`.',
  '',
  'Other: `nowhere/missing.json`.',
  '',
  `The first commit is \`${c1}\`; a commit that is not here: \`${absent}\`.`,
  '',
].join('\n');
const ABSENT = '0123456789abcdef0123456789abcdef01234567';
let REPO;
let C1;
let C2;

function buildRepo() {
  if (REPO) return;
  REPO = path.join(tmpRoot, 'repo');
  fs.mkdirSync(REPO);
  g(REPO, 'init', '-q', '-b', 'main');
  write(REPO, 'a.ts', A_V1);
  write(REPO, '.gitignore', '# fixture ignore rules\n# evidence under this glob needs ! exceptions\nsecret/*\n!secret/keep.json\n');
  write(REPO, 'secret/keep.json', '{}\n');
  write(REPO, 'secret/forced.json', '{}\n');
  write(REPO, 'gone.json', '{}\n');
  write(REPO, 'docs/NOTES.md', NOTES('c1c1c1c', ABSENT));
  g(REPO, 'add', 'a.ts', '.gitignore', 'secret/keep.json', 'gone.json', 'docs/NOTES.md');
  g(REPO, 'add', '-f', 'secret/forced.json');
  g(REPO, 'commit', '-q', '-m', 'c1');
  C1 = g(REPO, 'rev-parse', 'HEAD');
  // Second commit: two header lines push a.ts down by two, gone.json goes, and the notes now name
  // the real first commit and record the removal in a later paragraph.
  write(REPO, 'a.ts', A_V2);
  fs.rmSync(path.join(REPO, 'gone.json'));
  write(REPO, 'docs/NOTES.md', `${NOTES(C1.slice(0, 7), ABSENT, true)}\nCorrection: \`gone.json\` was deleted in the second commit.\n`);
  g(REPO, 'add', '-A');
  g(REPO, 'commit', '-q', '-m', 'c2');
  C2 = g(REPO, 'rev-parse', 'HEAD');
  write(REPO, 'secret/data.json', '{}\n');
  write(REPO, 'untracked.txt', 'x\n');
}
const DOC = 'docs/NOTES.md';

test('CLI on a fixture repository: every status the proposal names, with where a moved snippet went', () => {
  buildRepo();
  const { code, rep } = json([REPO, '--doc', DOC]);
  assert.equal(code, 1, 'drift found, so exit 1');
  const st = (raw, line) => one(rep, DOC, raw, line);
  const moved = st('a.ts:3', 3);
  assert.equal(moved.status, 'MOVED');
  assert.deepEqual(moved.movedTo, [':5']);
  assert.deepEqual(st('a.ts:4', 5).movedTo, [':6']);
  const cont = st(':7', 5);
  assert.equal(cont.path, 'a.ts');
  assert.deepEqual(cont.movedTo, [':9']);
  assert.deepEqual(st('a.ts:2', 7).movedTo, [':4']);
  assert.equal(st('a.ts:5', 9).status, 'GONE');
  assert.equal(st('a.ts:99', 11).status, 'PAST-EOF');
  const ign = st('secret/data.json');
  assert.equal(ign.status, 'IGNORED');
  assert.match(ign.note, /\.gitignore:3 `secret\/\*`/);
  assert.equal(st('secret/keep.json').status, 'OK');
  const forced = st('secret/forced.json');
  assert.equal(forced.status, 'OK');
  assert.match(forced.note, /tracked, but matches \.gitignore:3/);
  assert.equal(st('untracked.txt').status, 'UNTRACKED');
  const gone = st('gone.json', 19);
  assert.equal(gone.status, 'MISSING-PATH');
  assert.equal(gone.context.annotatedAt, 25);
  assert.equal(st('nowhere/missing.json').status, 'MISSING-PATH');
  assert.equal(st(C1.slice(0, 7)).status, 'OK');
  assert.equal(st(ABSENT).status, 'UNREACHABLE-COMMIT');
  assert.equal(rep.counts.total, rep.findings.length);
  assert.equal(Object.values(rep.counts.byStatus).reduce((a, b) => a + b, 0), rep.counts.total);
});

test('history: drift is re-judged where the citation first appeared and where its line was last edited', () => {
  buildRepo();
  const { rep } = json([REPO, '--doc', DOC]);
  const moved = one(rep, DOC, 'a.ts:3', 3);
  assert.equal(moved.history.first.commit, C1);
  assert.equal(moved.history.first.status, 'OK', 'held when it first appeared');
  const wrong = one(rep, DOC, 'a.ts:5', 9);
  assert.equal(wrong.history.first.status, 'GONE', 'never matched: wrong when written');
  const gone = one(rep, DOC, 'gone.json', 19);
  assert.equal(gone.history.first.status, 'OK');
  assert.equal(L.describeHistory(moved), `first appeared and last edited ${C1.slice(0, 7)}, 2026-01-01: held`);
  const reworded = one(rep, DOC, 'a.ts:2', 7);
  assert.equal(L.describeHistory(reworded), `first appeared ${C1.slice(0, 7)}, 2026-01-01: held; line last edited ${C2.slice(0, 7)}, 2026-01-01: MOVED (snippet now at :4)`);
  const noHist = json([REPO, '--doc', DOC, '--no-history']).rep;
  assert.equal(one(noHist, DOC, 'a.ts:3', 3).history, undefined);
});

test('--rev reads the document and targets at a commit; at the first commit the moved citations held', () => {
  buildRepo();
  const { rep } = json([REPO, '--doc', DOC, '--rev', C1]);
  assert.equal(one(rep, DOC, 'a.ts:3', 3).status, 'OK');
  assert.equal(one(rep, DOC, 'gone.json').status, 'OK');
  assert.equal(one(rep, DOC, 'untracked.txt').status, 'MISSING-PATH', 'not in that tree');
  assert.equal(cli([REPO, '--rev', 'nosuchref']).code, 2);
});

test('allowlist and --accept-annotated silence named drift only; a reason is required', () => {
  buildRepo();
  const { rep } = json([REPO, '--doc', DOC]);
  const drift = rep.findings.filter((f) => L.isDrift(f));
  const allowFile = path.join(tmpRoot, 'allow.json');
  fs.writeFileSync(allowFile, JSON.stringify(drift.map((f) => ({ doc: f.doc, ref: f.raw, line: f.line, reason: 'fixture' }))));
  const allowed = json([REPO, '--doc', DOC, '--allow', allowFile]);
  assert.equal(allowed.code, 0);
  assert.equal(allowed.rep.failing, 0);
  fs.writeFileSync(allowFile, JSON.stringify(drift.slice(1).map((f) => ({ doc: f.doc, ref: f.raw, line: f.line, reason: 'fixture' }))));
  assert.equal(json([REPO, '--doc', DOC, '--allow', allowFile]).rep.failing, 1);
  fs.writeFileSync(allowFile, JSON.stringify([{ doc: DOC, ref: 'a.ts:3', reason: ' ' }]));
  assert.equal(cli([REPO, '--doc', DOC, '--allow', allowFile]).code, 2);
  const ann = json([REPO, '--doc', DOC, '--accept-annotated']).rep;
  assert.deepEqual(ann.findings.filter((f) => f.excused).map((f) => `${f.raw}@${f.line}`), ['gone.json@19', 'gone.json@25'], 'the annotated mention and the annotation itself');
  assert.equal(ann.failing, rep.failing - 2);
});

test('a shallow clone never calls a commit unreachable: missing commits read UNCHECKABLE and say why', () => {
  buildRepo();
  const shallow = path.join(tmpRoot, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${REPO}`, shallow], { env: gitEnv, stdio: 'ignore' });
  const { rep } = json([shallow, '--doc', DOC]);
  assert.equal(rep.git.shallow, true);
  const c1 = one(rep, DOC, C1.slice(0, 7));
  assert.equal(c1.status, 'UNCHECKABLE');
  assert.match(c1.note, /shallow clone/);
  assert.equal(one(rep, DOC, ABSENT).status, 'UNCHECKABLE');
  assert.equal(rep.counts.byStatus['UNREACHABLE-COMMIT'], 0);
  assert.equal(one(rep, DOC, 'a.ts:3', 3).history.last.state, 'before-clone');
  assert.match(cli([shallow, '--doc', DOC]).out, /shallow clone: history starts at [0-9a-f]{7}/);
});

test('without git: lines and existence are still checked, tracking and commits read UNCHECKABLE', () => {
  buildRepo();
  const bare = path.join(tmpRoot, 'nogit');
  fs.cpSync(REPO, bare, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) || src.endsWith('.gitignore') });
  const { rep } = json([bare, '--doc', DOC]);
  assert.equal(rep.git.available, false);
  assert.equal(one(rep, DOC, 'a.ts:3', 3).status, 'MOVED');
  const ign = one(rep, DOC, 'secret/data.json');
  assert.equal(ign.status, 'UNCHECKABLE');
  assert.match(ign.note, /tracking not checkable without git/);
  assert.equal(one(rep, DOC, 'gone.json', 19).status, 'MISSING-PATH');
  assert.equal(one(rep, DOC, ABSENT).status, 'UNCHECKABLE');
});

test('usage and refusals: --help 0, bad option 3, missing directory 2, no documents 2; Markdown output', () => {
  buildRepo();
  assert.equal(cli(['--help']).code, 0);
  assert.match(cli(['--help']).out, /Exit: 0 no unallowed drift/);
  assert.doesNotMatch(cli(['--help']).out, /GIT_CEILING_DIRECTORIES/, '--help stops at the header block');
  assert.equal(cli([REPO, '--bogus']).code, 3);
  assert.equal(cli([]).code, 3);
  assert.equal(cli([path.join(tmpRoot, 'no-such-dir')]).code, 2);
  const empty = path.join(tmpRoot, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const r = cli([empty]);
  assert.equal(r.code, 2);
  assert.match(r.err, /no documents to check/);
  const md = cli([REPO, '--doc', DOC, '--markdown']).out;
  assert.match(md, /^\| MOVED \| 4 \| 0 \| 0 \| 4 \|$/m);
});

// ---------------------------------------------------------------------------------------------
// 3. Real Aster prose and targets, copied under snapshots/ at 62ddb17 (no checkout needed)

const snapEnv = () => memEnv({
  '.gitignore': fs.readFileSync(path.join(SNAP, 'gitignore.txt'), 'utf8'),
  '.githooks/pre-commit': fs.readFileSync(path.join(SNAP, 'githooks-pre-commit.txt'), 'utf8'),
  'src/v2/app/porkchop/main.ts': fs.readFileSync(path.join(SNAP, 'porkchop-main.ts.txt'), 'utf8'),
});
function snapJudge(name) {
  const e = excerpt(name);
  const ex = L.extract(e.text, e.doc);
  const env = snapEnv();
  return ex.refs.map((r) => ({ ...r, line: r.line + e.from - 1, ...L.judge(r, env, ex.units[r.unit].text) }));
}

test('STATUS.md:417-425 (snapshot) yields exactly its four citations, their snippets, and its one bundle path', () => {
  const e = excerpt('STATUS.md.417-425.md');
  const refs = L.extract(e.text, e.doc).refs.map((r) => ({ ...r, line: r.line + e.from - 1 }));
  const lines = refs.filter((r) => r.kind === 'line');
  assert.deepEqual(lines.map((r) => [r.line, r.raw, r.path]), [
    [418, 'src/v2/app/porkchop/main.ts:637', 'src/v2/app/porkchop/main.ts'],
    [420, ':646', 'src/v2/app/porkchop/main.ts'],
    [421, ':187-194', 'src/v2/app/porkchop/main.ts'],
    [421, ':189', 'src/v2/app/porkchop/main.ts'],
  ]);
  assert.deepEqual(lines.map((r) => r.snippets.map((s) => s.text)), [
    ['Grid spans 2026-2040 departures and 182.5-1826.25 day flight times.'],
    ['Grid: ${GRID_PARAMS.nDep}x${GRID_PARAMS.nTof}'],
    [],
    ["depEndJD: utcMidnightToJdTdb('2040-01-01')"],
  ]);
  assert.deepEqual(refs.filter((r) => r.kind === 'path').map((r) => [r.line, r.raw]), [[425, 'docs/assets/porkchopV2-z3nhVK2W.js']]);
});

test('against main.ts at 62ddb17 (snapshot): the literal is GONE, the grid end MOVED to :196, the derived label sits at :647', () => {
  const r = snapJudge('STATUS.md.417-425.md');
  const by = (raw) => r.find((x) => x.raw === raw);
  assert.equal(by('src/v2/app/porkchop/main.ts:637').status, 'GONE');
  assert.equal(by(':646').status, 'GONE');
  assert.equal(by(':187-194').status, 'IN-RANGE');
  assert.equal(by(':189').status, 'MOVED');
  assert.deepEqual(by(':189').movedTo, [':196']);
  // The literal was replaced by a derived label (commit 446e3a7): the sentence's first words now
  // stand on :647 next to ${PORKCHOP_DEPARTURE_SPAN_LABEL}, which is why GONE and not MOVED.
  const main = fs.readFileSync(path.join(SNAP, 'porkchop-main.ts.txt'), 'utf8').split('\n');
  assert.match(main[646], /Grid spans \$\{PORKCHOP_DEPARTURE_SPAN_LABEL\} departures/);
  assert.match(main[195], /depEndJD: utcMidnightToJdTdb\('2040-01-01'\)/);
});

test('INV-034 prose (snapshot): the quote pairs with SLICE_9_FOUNDING.md:202, and .gitignore:17 is left unpaired', () => {
  const e = excerpt('INVARIANTS.md.171-180.md');
  const lines = L.extract(e.text, e.doc).refs.filter((r) => r.kind === 'line');
  assert.deepEqual(lines.map((r) => [r.raw, r.snippets.map((s) => s.text)]), [
    ['SLICE_9_FOUNDING.md:202', ['the committed 162-body set']],
    [':350-353', []],
    ['.gitignore:17', []],
  ]);
});

test('the SLICE_9 amendment (snapshot) against .gitignore at 62ddb17: :17 MOVED to :19, the audit\'s off-by-two', () => {
  const r = snapJudge('src__v2__SLICE_9_FOUNDING.md.423-428.md');
  const gi = r.find((x) => x.raw === '.gitignore:17');
  assert.equal(gi.line, 427);
  assert.equal(gi.status, 'MOVED');
  assert.deepEqual(gi.movedTo, [':19']);
  assert.equal(gi.snippetResults[0].text, 'tools/slice9-research/data/*');
  const giText = fs.readFileSync(path.join(SNAP, 'gitignore.txt'), 'utf8').split('\n');
  assert.match(giText[16], /^# Evidence artifacts/, 'line 17 is now a comment');
  assert.equal(giText[18], 'tools/slice9-research/data/*');
  assert.deepEqual(r.filter((x) => x.kind === 'path').map((x) => x.raw), ['tools/slice9-research/data/slice9-cutover-sample.json']);
});

test('STATUS.md C17 (snapshot): the escaped pipe is unescaped, and the cited hook line is GONE; only the comment keeps the pattern', () => {
  const r = snapJudge('STATUS.md.535-535.md');
  const hook = r.find((x) => x.raw === '.githooks/pre-commit:53');
  assert.equal(hook.snippetResults[0].text, `git diff --cached -- "$doc" | grep -c '^-[^-]'`);
  assert.equal(hook.status, 'GONE');
  const idx = L.indexText(fs.readFileSync(path.join(SNAP, 'githooks-pre-commit.txt'), 'utf8'));
  assert.deepEqual(L.locate(idx, "grep -c '^-[^-]'").hits, [[51, 51]]);
});

// ---------------------------------------------------------------------------------------------
// 4. The Aster checkout (skipped when absent)

const asterAt = (() => {
  try {
    const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ASTER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ASTER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { head, clean: !dirty };
  } catch { return null; }
})();
const atPin = asterAt && asterAt.head === '62ddb17' && asterAt.clean;
const skipAster = atPin ? false : `needs a clean ${ASTER} at 62ddb17 (found ${asterAt ? asterAt.head : 'none'})`;
let ASTER_REP;
const asterRep = () => (ASTER_REP ||= json([ASTER]).rep);
// One key per drift or PARTIAL finding, in report order; a repeat of the same reference on the
// same line gets " #2", " #3".
function adjudicationKeys(rep) {
  const seen = new Map();
  return rep.findings.filter((f) => L.isDrift(f) || f.status === 'PARTIAL').map((f) => {
    const k = `${f.doc}:${f.line} ${f.raw} ${f.status}`;
    seen.set(k, (seen.get(k) || 0) + 1);
    return seen.get(k) > 1 ? `${k} #${seen.get(k)}` : k;
  });
}

test('Aster at 62ddb17: the proposal\'s three spot checks, re-judged', { skip: skipAster }, () => {
  const rep = asterRep();
  const gi = one(rep, 'src/v2/SLICE_9_FOUNDING.md', '.gitignore:17');
  assert.equal(gi.status, 'MOVED');
  assert.deepEqual(gi.movedTo, [':19']);
  // The proposal expected "Grid spans" MOVED to :647. The literal itself is gone; GONE is right.
  assert.equal(one(rep, 'STATUS.md', 'src/v2/app/porkchop/main.ts:637', 418).status, 'GONE');
  const lv = one(rep, 'src/v2/SLICE_15_FOUNDING.md', 'src/v2/launch-vehicles.ts', 62);
  assert.equal(lv.status, 'MISSING-PATH');
  assert.match(lv.note, /src\/v2\/porkchop\/launch-vehicles\.ts/);
  assert.equal(lv.context.annotatedAt, 212, 'the founding document already corrects it at :212');
  assert.match(fs.readFileSync(path.join(ASTER, 'src/v2/SLICE_15_FOUNDING.md'), 'utf8').split('\n')[211], /That path has never existed/);
});

test('Aster at 62ddb17: INV-034\'s own origin reads IGNORED, by the glob on .gitignore:19', { skip: skipAster }, () => {
  const f = one(asterRep(), 'src/v2/SLICE_9_FOUNDING.md', 'tools/slice9-research/data/slice9-cutover-sample.json');
  assert.equal(f.status, 'IGNORED');
  assert.match(f.note, /\.gitignore:19 `tools\/slice9-research\/data\/\*`/);
  // The audit's convergence row records the same off-by-two this deposit reproduces.
  const audit = fs.readFileSync(path.join(ASTER, 'tools/audit/sanity-69472a3/ASTER_AUDIT_REPORT.md'), 'utf8').split('\n');
  assert.match(audit[562], /"\.gitignore:17" citation is off at HEAD/);
});

test('Aster shallow checkout: no commit is called unreachable; every unchecked one says shallow or hash', { skip: skipAster }, () => {
  const rep = asterRep();
  assert.equal(rep.git.shallow, true);
  assert.equal(rep.counts.byStatus['UNREACHABLE-COMMIT'], 0);
  for (const f of rep.findings.filter((x) => x.kind === 'commit' && x.status === 'UNCHECKABLE')) {
    assert.match(f.note, /shallow clone|content hash/, `${f.doc}:${f.line} ${f.hex}`);
  }
});

test('README counts, example.txt and adjudication.json all match a fresh run of the checkout', { skip: skipAster }, () => {
  const rep = asterRep();
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const block = readme.split('<!-- counts:start -->')[1].split('<!-- counts:end -->')[0];
  for (const s of L.STATUSES) {
    const m = new RegExp(`^\\| ${s} \\| (\\d+) \\| (\\d+) \\| (\\d+) \\| (\\d+) \\|$`, 'm').exec(block);
    const n = rep.counts.byStatus[s] || 0;
    if (!n) { assert.equal(m, null, `${s} absent from the README table when zero`); continue; }
    assert.ok(m, `README table has a ${s} row`);
    assert.deepEqual(m.slice(1).map(Number), [rep.counts.byKind.line[s] || 0, rep.counts.byKind.path[s] || 0, rep.counts.byKind.commit[s] || 0, n], s);
  }
  const fresh = cli([ASTER]).out.trimEnd();
  assert.equal(fs.readFileSync(path.join(here, 'example.txt'), 'utf8').trimEnd(), fresh, 'example.txt is the saved output of this run');
  const adj = JSON.parse(fs.readFileSync(path.join(here, 'adjudication.json'), 'utf8'));
  const keys = adjudicationKeys(rep);
  assert.deepEqual(adj.findings.map((a) => a.key).sort(), [...keys].sort(), 'every drift and PARTIAL finding is adjudicated, and nothing else');
});

// Optional: a full-history clone of Aster at 62ddb17 (LINE_DRIFT_FULL_CLONE=/path/to/clone). The
// saved example-full-history.txt is that run's output; this re-runs it and compares, so the
// history column and the commit counts the README quotes can be re-derived by anyone who clones.
const FULL = process.env.LINE_DRIFT_FULL_CLONE;
test('full-history clone at 62ddb17: every commit reference resolves, and the saved run reproduces', { skip: FULL ? false : 'set LINE_DRIFT_FULL_CLONE to a full clone of Aster checked out at 62ddb17' }, () => {
  const { rep } = json([FULL]);
  assert.equal(rep.git.head.slice(0, 7), '62ddb17');
  assert.equal(rep.git.shallow, false);
  assert.equal(rep.counts.byStatus['UNREACHABLE-COMMIT'], 0);
  const commits = rep.findings.filter((f) => f.kind === 'commit');
  assert.equal(commits.filter((f) => f.status === 'OK').length + commits.filter((f) => f.hash).length, commits.length, 'every commit-shaped token is a reachable commit or reads as a hash');
  const norm = (t) => t.replace(/^checkout .*$/m, 'checkout <full clone>').replace(/ from \S+;/, ';').trimEnd();
  assert.equal(norm(fs.readFileSync(path.join(here, 'example-full-history.txt'), 'utf8')), norm(cli([FULL]).out));
  const shallowKeys = asterRep && atPin ? adjudicationKeys(asterRep()) : null;
  if (shallowKeys) assert.deepEqual(adjudicationKeys(rep), shallowKeys, 'drift is the same with and without history');
});
