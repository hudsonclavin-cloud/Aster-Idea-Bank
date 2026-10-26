// Tests for Blob Basis. From the bank root: node --test ideas/12-blob-basis/blob-basis.test.mjs
//
// Four groups:
//   1. the hash functions in basis.js against the published test vectors and node:crypto, and the
//      git blob id against git itself;
//   2. the line-ending transforms and verdicts on a made-up ~1 KB text and its variants;
//   3. the CLI's options, refusals and exit codes;
//   4. reconciliation against the real Aster and Skyhook checkouts: the recorded hashes in the
//      snapshots are recomputed here with node:crypto and git, independently of basis.js, and the
//      CLI must place each one on the basis the recomputation says. Group 4 skips itself (saying
//      why) when a checkout or the snapshot commit is not present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BB = require(path.join(here, 'basis.js'));
const CLI = path.join(here, 'blob-basis.mjs');
const { run } = await import(CLI);

const ASTER = '/home/user/asteroid-mining-planner';
const SKYHOOK = '/home/user/skyhook';
const snap = (f) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f), 'utf8'));
const CACHE = snap('lambert-screen-cache.metadata.json').metadata.provenance;
const VZ = snap('earth-vz-span-max.fixture.json').fixture;
const ASTER_REV = snap('lambert-screen-cache.metadata.json.provenance.json').commit;
const GRID = snap('decision_grid.keys.json');
const GRID_PARENT = snap('decision_grid.parent.json');
const SKYHOOK_REV = snap('decision_grid.keys.json.provenance.json').commit;

const nodeHash = (algo, b) => crypto.createHash(algo).update(b).digest('hex');
const u8 = (s) => new Uint8Array(Buffer.from(s, 'binary'));
const git = (cwd, args, input) => spawnSync('git', args, { cwd, input, maxBuffer: 1 << 30 });
const gitOk = (cwd, args) => git(cwd, args).status === 0;
const hasGit = spawnSync('git', ['--version']).status === 0;
const hasCommit = (repo, rev) => hasGit && fs.existsSync(path.join(repo, '.git')) && gitOk(repo, ['cat-file', '-e', `${rev}^{commit}`]);
const asterReady = hasCommit(ASTER, ASTER_REV);
const skyReady = hasCommit(SKYHOOK, SKYHOOK_REV) && hasCommit(SKYHOOK, GRID_PARENT.derivedFrom.rev);
const asterSkip = asterReady ? false : `Aster checkout with ${ASTER_REV.slice(0, 7)} not present at ${ASTER}`;
const skySkip = skyReady ? false : `Skyhook checkout with ${SKYHOOK_REV.slice(0, 7)} not present at ${SKYHOOK}`;
const blobAt = (repo, rev, p) => git(repo, ['cat-file', 'blob', `${rev}:${p}`]).stdout;
// The CRLF form computed the plain way, independently of basis.js: split on LF, join with CRLF
// (valid for a blob with no CR, which the test asserts first).
const crlfOf = (buf) => Buffer.from(buf.toString('latin1').split('\n').join('\r\n'), 'latin1');

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: env || process.env, maxBuffer: 1 << 26 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function cliJson(args) {
  const r = cli([...args, '--json']);
  return { code: r.code, json: JSON.parse(r.out) };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-basis-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ------------------------------------------------------------------------------------------------
// 1. Hash functions.

test('hashes: published test vectors (FIPS 180-4 examples, RFC 1321 A.5, RFC 3174) and node:crypto agree', () => {
  const vectors = [
    ['sha256', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['sha256', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['sha256', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['sha1', 'abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['sha1', '', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['md5', '', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['md5', 'abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['md5', 'message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ];
  for (const [algo, msg, want] of vectors) {
    assert.equal(nodeHash(algo, Buffer.from(msg)), want, `node:crypto ${algo}(${JSON.stringify(msg)}): the vector itself`);
    assert.equal(BB[algo](u8(msg)), want, `basis.js ${algo}(${JSON.stringify(msg)})`);
  }
});

test('hashes: pure JS equals node:crypto on 600 random inputs, every padding boundary, and 1 MB', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const lengths = [];
  for (let n = 0; n <= 300; n++) lengths.push(n);
  for (let i = 0; i < 300; i++) lengths.push(Math.floor(rnd() * 5000));
  lengths.push(1 << 20);
  for (const n of lengths) {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256);
    const a = new Uint8Array(b);
    assert.equal(BB.sha256(a), nodeHash('sha256', b), `sha256 length ${n}`);
    assert.equal(BB.sha1(a), nodeHash('sha1', b), `sha1 length ${n}`);
    assert.equal(BB.md5(a), nodeHash('md5', b), `md5 length ${n}`);
  }
});

test('git blob id: sha1 of "blob <n>\\0" + bytes equals git hash-object --no-filters (and git\'s empty blob)', { skip: hasGit ? false : 'git not installed' }, () => {
  assert.equal(BB.gitBlobId(new Uint8Array(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const v = BB.sampleVariants();
  for (const [k, bytes] of Object.entries(v)) {
    const g = git(tmp, ['hash-object', '--no-filters', '--stdin'], Buffer.from(bytes)).stdout.toString().trim();
    assert.equal(BB.gitBlobId(bytes), g, `sample ${k}`);
  }
});

// ------------------------------------------------------------------------------------------------
// 2. Transforms and verdicts.

test('the sample: CRLF twin = LF original + one byte per newline; folding it back gives the LF hash', () => {
  const v = BB.sampleVariants();
  const st = BB.eolStats(v.lf);
  assert.equal(st.crlf, 0);
  assert.ok(st.bareLf > 20 && v.lf.length > 800 && v.lf.length < 1100, 'about 1 KB, one record per line');
  assert.equal(v.crlf.length, v.lf.length + st.bareLf);
  assert.deepEqual(BB.eolStats(v.crlf), { bytes: v.crlf.length, crlf: st.bareLf, bareLf: 0, bareCr: 0, binary: false });
  assert.equal(BB.sha256(BB.toLf(v.crlf)), BB.sha256(v.lf));
  assert.equal(Buffer.from(v.crlf).toString('latin1'), Buffer.from(v.lf).toString('latin1').split('\n').join('\r\n'), 'the plain split/join CRLF form');
  const ms = BB.eolStats(v.mixed);
  assert.ok(ms.crlf > 0 && ms.bareLf > 0, 'the mixed copy really is mixed');
});

test('transforms: CRLF stats follow from the input; toCrlf is idempotent; toLf undoes it on CR-free text; "\\r\\r\\n" folds once', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const alphabet = [97, 13, 10, 0, 98];
  for (let t = 0; t < 2000; t++) {
    const n = Math.floor(rnd() * 40);
    const x = new Uint8Array(n);
    for (let i = 0; i < n; i++) x[i] = alphabet[Math.floor(rnd() * alphabet.length)];
    const c = BB.toCrlf(x);
    assert.deepEqual(BB.crlfStatsFrom(BB.eolStats(x)), BB.eolStats(c), `stats of toCrlf for ${Buffer.from(x).toString('hex')}`);
    assert.ok(BB.sameBytes(BB.toCrlf(c), c), 'idempotent');
    if (!x.includes(13)) assert.ok(BB.sameBytes(BB.toLf(c), x), 'toLf(toCrlf(x)) = x without CRs');
  }
  assert.equal(Buffer.from(BB.toLf(u8('\r\r\n'))).toString('latin1'), '\r\n', 'one pass, as git\'s CRLF -> LF conversion does');
});

function basesFor(disk, blob) {
  return BB.computeBases({ disk, blob });
}

test('verdicts on the four sample copies against the LF original as the committed blob', () => {
  const v = BB.sampleVariants();
  const want = { lf: 'IDENTICAL', crlf: 'CRLF-CHECKOUT', mixed: 'EOL-ONLY', edited: 'DIRTY' };
  for (const [k, code] of Object.entries(want)) assert.equal(BB.workingVerdict(basesFor(v[k], v.lf)).code, code, k);
  // The CRLF twin as the blob (a file committed with CRLF) and the LF original on disk: EOL-ONLY.
  assert.equal(BB.workingVerdict(basesFor(v.lf, v.crlf)).code, 'EOL-ONLY');
  // Families: an LF original has two distinct byte strings among the six bases.
  assert.equal(basesFor(v.lf, v.lf).families, 2);
  assert.equal(basesFor(v.edited, v.lf).families, 5, 'edited mixed copy: three disk forms, blob, blob-crlf');
});

test('placing recorded hashes: every algorithm, prefixes, recorded bytes, and each verdict', () => {
  const v = BB.sampleVariants();
  const b = basesFor(v.lf, v.lf);
  const crlfSha = nodeHash('sha256', Buffer.from(v.crlf));
  let m = BB.matchHash(crlfSha, b, v.crlf.length);
  assert.equal(m.code, 'CRLF-BASIS');
  assert.deepEqual(m.matches, ['disk-crlf', 'blob-crlf']);
  assert.equal(m.bytesAgree, true);
  assert.equal(m.discriminating, true);
  m = BB.matchHash(crlfSha, b, v.lf.length);
  assert.equal(m.bytesAgree, false, 'a byte count that is not the matching basis\'s');
  assert.equal(BB.matchHash(nodeHash('sha256', Buffer.from(v.lf)), b).code, 'BLOB-BASIS');
  m = BB.matchHash(nodeHash('md5', Buffer.from(v.lf)), b);
  assert.equal(m.code, 'BLOB-BASIS');
  assert.equal(m.algo, 'md5');
  assert.equal(BB.matchHash(BB.gitBlobId(v.crlf), b).code, 'CRLF-BASIS', 'a git blob id of the CRLF form');
  m = BB.matchHash(`${crlfSha.slice(0, 8)}...`, b);
  assert.equal(m.code, 'CRLF-BASIS');
  assert.equal(m.prefix, true);
  assert.equal(m.fullHash, crlfSha);
  assert.equal(BB.matchHash(crlfSha.slice(0, 7), b).ok, false, 'seven hex digits are too few');
  const inner = crlfSha.slice(5, 15);
  assert.ok(![BB.sha256, BB.md5, BB.gitBlobId].some((f) => [v.lf, v.crlf].some((x) => f(x).startsWith(inner))), 'the middle slice is no basis\'s prefix');
  assert.equal(BB.matchHash(inner, b).code, 'NO-MATCH', 'a prefix matches only at the start');
  assert.equal(BB.matchHash('zz', b).ok, false);
  m = BB.matchHash('0'.repeat(64), b, v.crlf.length);
  assert.equal(m.code, 'NO-MATCH');
  assert.deepEqual(m.basesWithThoseBytes, ['disk-crlf', 'blob-crlf']);
  // Worktree basis: the hash of a dirty copy.
  const d = basesFor(v.edited, v.lf);
  assert.equal(BB.matchHash(nodeHash('sha256', Buffer.from(v.edited)), d).code, 'WORKTREE-BASIS');
  // LF basis: a blob committed with CRLF, hash taken newline-normalised.
  const c = basesFor(v.crlf, v.crlf);
  m = BB.matchHash(nodeHash('sha256', Buffer.from(v.lf)), c);
  assert.equal(m.code, 'LF-BASIS');
  assert.deepEqual(m.matches, ['disk-lf', 'blob-lf']);
  // A file with no line endings: all six bases are one byte string, so a match tells nothing apart.
  const flat = u8('no newline here');
  m = BB.matchHash(nodeHash('sha256', Buffer.from(flat)), basesFor(flat, flat));
  assert.equal(m.code, 'BLOB-BASIS');
  assert.equal(m.discriminating, false);
  // No blob: matches can only be worktree, and the result says the blob is unavailable.
  m = BB.matchHash(crlfSha, BB.computeBases({ disk: v.lf, blob: null, blobWhy: 'no git' }));
  assert.equal(m.code, 'WORKTREE-BASIS');
  assert.equal(m.blobAvailable, false);
});

test('scanJson: hashes by length, blob ids only under blob keys, paths from map or sibling, pointers escaped', () => {
  const doc = {
    fixture: { path: 'a/b.json', sha256: 'a'.repeat(64), bytes: 12 },
    provenance: { catalogSha: 'b'.repeat(64), solverCommit: 'c'.repeat(40), readBlob: 'd'.repeat(40) },
    'odd/key~': { md5: 'e'.repeat(32) },
    list: [{ path: 'x.txt', sha256: 'F'.repeat(64) }],
    short: 'abcdef12',
  };
  const s = BB.scanJson(doc, { catalogSha: 'cat.json', '/odd~1key~0/md5': 'odd.txt' });
  const by = Object.fromEntries(s.hashes.map((h) => [h.pointer, h]));
  assert.deepEqual(Object.keys(by).sort(), ['/fixture/sha256', '/list/0/sha256', '/odd~1key~0/md5', '/provenance/catalogSha', '/provenance/readBlob'].sort());
  assert.equal(by['/fixture/sha256'].path, 'a/b.json');
  assert.equal(by['/fixture/sha256'].recordedBytes, 12);
  assert.equal(by['/provenance/catalogSha'].path, 'cat.json');
  assert.equal(by['/provenance/catalogSha'].pathFrom, 'map');
  assert.equal(by['/provenance/readBlob'].algo, 'blobId');
  assert.equal(by['/provenance/readBlob'].path, null, 'no path: unresolved, not guessed');
  assert.equal(by['/odd~1key~0/md5'].path, 'odd.txt');
  assert.equal(by['/list/0/sha256'].value, 'f'.repeat(64));
  assert.deepEqual(s.ids.map((i) => i.pointer), ['/provenance/solverCommit']);
});

test('inferBlob: a pasted blob id recovers the committed bytes from the matching form, or refuses', () => {
  const v = BB.sampleVariants();
  const id = BB.gitBlobId(v.lf);
  const cases = { lf: ['FOUND', 'disk'], crlf: ['FOUND', 'disk-lf'], mixed: ['FOUND', 'disk-lf'], edited: ['NOT-FOUND', undefined] };
  for (const [k, [code, via]] of Object.entries(cases)) {
    const r = BB.inferBlob(v[k], BB.computeBases({ disk: v[k] }), id);
    assert.equal(r.code, code, k);
    assert.equal(r.via, via, k);
    if (r.blob) assert.ok(BB.sameBytes(r.blob, v.lf), `${k}: recovered bytes are the blob`);
  }
  assert.equal(BB.inferBlob(v.lf, BB.computeBases({ disk: v.lf }), '').code, 'NO-ID');
  assert.equal(BB.inferBlob(v.lf, BB.computeBases({ disk: v.lf }), 'abc').code, 'BAD-ID');
});

// ------------------------------------------------------------------------------------------------
// 3. The CLI.

test('CLI: --help exits 0; usage errors exit 3', () => {
  const h = cli(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /--expect HEX/);
  for (const args of [[], [tmp], [tmp, 'x', '--expect', 'zz'], [tmp, 'x', '--bytes', '5'], [tmp, 'x', '--wat'], [tmp, '--expect', 'a'.repeat(64)], [tmp, 'a', 'b', '--against', 'c'], ['/no/such/dir', 'x']]) {
    assert.equal(cli(args).code, 3, `usage: ${args.join(' ')}`);
  }
});

test('CLI: outside git it prints the disk triad, says the blob basis is UNAVAILABLE, and exits 2', () => {
  const v = BB.sampleVariants();
  fs.writeFileSync(path.join(tmp, 'crlf.json'), v.crlf);
  const r = cliJson([tmp, 'crlf.json', '--expect', nodeHash('sha256', Buffer.from(v.lf))]);
  assert.equal(r.code, 2);
  const p = r.json.paths[0];
  assert.equal(p.verdict.code, 'UNAVAILABLE');
  assert.match(p.verdict.text, /not inside a git work tree/);
  assert.deepEqual(p.bases.rows.filter((x) => x.available).map((x) => x.name), ['disk', 'disk-lf', 'disk-crlf']);
  assert.equal(p.expect[0].code, 'WORKTREE-BASIS');
  assert.deepEqual(p.expect[0].matches, ['disk-lf']);
  // git missing from PATH entirely.
  const noGit = cli([tmp, 'crlf.json'], { ...process.env, PATH: path.join(tmp, 'empty-path') });
  assert.equal(noGit.code, 2);
  assert.match(noGit.out, /git is not installed or not on PATH/);
});

// ------------------------------------------------------------------------------------------------
// 4. Reconciliation against the checkouts.

test('Aster: the cache\'s horizonsFixtureSha256 is sha256 of the committed blob; earth-vz\'s pin is its CRLF form, bytes and all', { skip: asterSkip }, () => {
  const blob = blobAt(ASTER, ASTER_REV, 'src/v2/data/horizons-inner-solar-system-2026-2040.json');
  assert.equal(blob.includes(13), false, 'the committed blob has no CR');
  assert.equal(nodeHash('sha256', blob), CACHE.horizonsFixtureSha256);
  const lfCount = blob.toString('latin1').split('\n').length - 1;
  assert.equal(blob.length + lfCount, VZ.bytes, 'blob bytes + one CR per LF = the recorded byte count');
  assert.equal(nodeHash('sha256', crlfOf(blob)), VZ.sha256);
  assert.notEqual(nodeHash('sha256', blob), VZ.sha256);
  // The catalog's hash too, and the generator script's does not match the script at this revision.
  assert.equal(nodeHash('sha256', blobAt(ASTER, ASTER_REV, 'tests/fixtures/v2/nea-catalog-slice9.json')), CACHE.catalogFixtureSha256);
  const script = blobAt(ASTER, ASTER_REV, 'tools/build/precompute-lambert-screen.mjs');
  assert.notEqual(nodeHash('sha256', script), CACHE.precomputeScriptSha256);
  assert.notEqual(nodeHash('sha256', crlfOf(script)), CACHE.precomputeScriptSha256);
});

test('Aster: the --map paths are the ones the generator hashes (precompute-lambert-screen.mjs:159-182)', { skip: asterSkip }, () => {
  const src = blobAt(ASTER, ASTER_REV, 'tools/build/precompute-lambert-screen.mjs').toString('utf8');
  assert.match(src, /const HORIZONS_FIXTURE = path\.join\(\s*repoRoot,\s*'src',\s*'v2',\s*'data',\s*'horizons-inner-solar-system-2026-2040\.json',?\s*\)/);
  assert.match(src, /const NEA_FIXTURE = path\.join\(repoRoot, 'tests', 'fixtures', 'v2', 'nea-catalog-slice9\.json'\)/);
  assert.match(src, /const SCRIPT_BYTES = fs\.readFileSync\(__filename\)/);
  assert.match(src, /const catalogFixtureSha256 = sha256Buffer\(NEA_BYTES\);\s*const horizonsFixtureSha256 = sha256Buffer\(HORIZONS_BYTES\);\s*const precomputeScriptSha256 = sha256Buffer\(SCRIPT_BYTES\);/);
});

const ASTER_MAP = [
  '--map', 'catalogFixtureSha256=tests/fixtures/v2/nea-catalog-slice9.json',
  '--map', 'horizonsFixtureSha256=src/v2/data/horizons-inner-solar-system-2026-2040.json',
  '--map', 'precomputeScriptSha256=tools/build/precompute-lambert-screen.mjs',
];

test('Aster: --scan places the four recorded hashes; --require blob exits 1', { skip: asterSkip }, () => {
  const out = run([ASTER, '--rev', ASTER_REV, '--scan', path.join(here, 'snapshots', 'lambert-screen-cache.metadata.json'),
    '--scan', path.join(here, 'snapshots', 'earth-vz-span-max.fixture.json'), ...ASTER_MAP, '--history', '--require', 'blob']);
  assert.equal(out.result.exit, 1);
  const codes = Object.fromEntries(out.result.scans.flatMap((s) => s.entries).map((e) => [e.pointer, e.match.code]));
  assert.deepEqual(codes, {
    '/metadata/provenance/catalogFixtureSha256': 'BLOB-BASIS',
    '/metadata/provenance/horizonsFixtureSha256': 'BLOB-BASIS',
    '/metadata/provenance/precomputeScriptSha256': 'NO-MATCH',
    '/fixture/sha256': 'CRLF-BASIS',
  });
  const vz = out.result.scans[1].entries[0].match;
  assert.deepEqual(vz.matches, ['disk-crlf', 'blob-crlf']);
  assert.equal(vz.bytesAgree, true);
  const script = out.result.scans[0].entries[2].match;
  assert.equal(script.history.searched, true);
  assert.equal(script.history.found, null);
  assert.deepEqual(out.result.scans[0].ids.map((i) => i.key), ['solverCommit']);
  // A CRLF-basis match alone exits 0: it is placed, and only --require turns it into a failure.
  const plain = run([ASTER, '--rev', ASTER_REV, '--scan', path.join(here, 'snapshots', 'earth-vz-span-max.fixture.json')]);
  assert.equal(plain.result.exit, 0, 'a CRLF-basis match is a placement, not a failure, unless --require says so');
});

test('Aster: a CRLF copy of a committed file is CRLF-CHECKOUT and git agrees; mixed is EOL-ONLY; an edit is DIRTY', { skip: asterSkip }, () => {
  const rel = 'tests/fixtures/v2/horizons-earth-moon-30d.json';
  const blob = blobAt(ASTER, ASTER_REV, rel);
  const lines = blob.toString('latin1').split('\n');
  const variants = {
    crlf: [crlfOf(blob), 'CRLF-CHECKOUT', true],
    mixed: [Buffer.from(lines.map((l, i) => (i % 2 && i < lines.length - 1 ? `${l}\r` : l)).join('\n'), 'latin1'), 'EOL-ONLY', true],
    edited: [Buffer.from(crlfOf(blob).toString('latin1').replace('2', '3'), 'latin1'), 'DIRTY', false],
    same: [blob, 'IDENTICAL', undefined],
  };
  for (const [k, [bytes, code, agrees]] of Object.entries(variants)) {
    const f = path.join(tmp, `${k}.json`);
    fs.writeFileSync(f, bytes);
    const r = cliJson([ASTER, rel, '--rev', ASTER_REV, '--against', f]);
    assert.equal(r.code, 0, k);
    const rows = Object.fromEntries(r.json.paths[0].bases.rows.map((x) => [x.name, x]));
    assert.equal(rows.disk.blobId, git(ASTER, ['hash-object', '--no-filters', f]).stdout.toString().trim(), `${k}: the CLI's blob id of the copy is git's`);
    assert.equal(rows.blob.blobId, r.json.paths[0].committedBlobId, `${k}: the CLI's blob id of the blob is the committed id`);
    assert.equal(rows.blob.sha256, nodeHash('sha256', blob), `${k}: the CLI's sha256 of the blob`);
    assert.equal(r.json.paths[0].verdict.code, code, k);
    assert.equal(r.json.paths[0].gitAgrees, agrees, `${k}: git hash-object --path agrees`);
    assert.equal(cli([ASTER, rel, '--rev', ASTER_REV, '--against', f, '--require', 'blob']).code, k === 'same' ? 0 : 1, `${k} --require blob`);
  }
  // git's own clean filter for this path turns the sample's CRLF twin into the LF original's blob:
  // basis.js's CRLF -> LF is git's.
  const v = BB.sampleVariants();
  const g = git(ASTER, ['hash-object', `--path=${rel}`, '--stdin'], Buffer.from(v.crlf)).stdout.toString().trim();
  assert.equal(g, BB.gitBlobId(BB.toLf(v.crlf)));
});

test('Aster: --history names the commit that introduced an older version; a missing --rev refuses', { skip: asterSkip }, () => {
  const commits = git(ASTER, ['rev-list', ASTER_REV, '--', 'STATUS.md']).stdout.toString().trim().split('\n');
  if (commits.length < 2) return; // nothing older reachable
  const oldest = commits[commits.length - 1];
  const old = blobAt(ASTER, oldest, 'STATUS.md');
  for (const [bytes, basis] of [[old, 'blob'], [crlfOf(old), 'blob-crlf']]) {
    const want = nodeHash('sha256', bytes);
    const r = cliJson([ASTER, 'STATUS.md', '--rev', ASTER_REV, '--expect', want, '--history']);
    const m = r.json.paths[0].expect[0];
    assert.equal(m.code, 'HISTORY');
    assert.equal(m.history.found.commit, oldest);
    assert.ok(m.history.found.matches.includes(basis), basis);
    assert.equal(r.code, 0);
    const noHist = cliJson([ASTER, 'STATUS.md', '--rev', ASTER_REV, '--expect', want]);
    assert.equal(noHist.json.paths[0].expect[0].code, 'NO-MATCH');
    assert.equal(noHist.code, 1);
  }
  const missing = cli([ASTER, 'STATUS.md', '--rev', '0123456789abcdef0123456789abcdef01234567']);
  assert.equal(missing.code, 2);
  assert.match(missing.out, /is not a commit in this clone/);
});

test('Aster: the script hash in a full clone (only when 9e93ffc is present)', { skip: asterReady && hasCommit(ASTER, '9e93ffc48a9200f6c79e2e4c2af7414ebad8f3a9') ? false : 'commit 9e93ffc is not in this clone (shallow); see README Findings for what the full history shows' }, () => {
  const r = cliJson([ASTER, 'tools/build/precompute-lambert-screen.mjs', '--rev', ASTER_REV, '--expect', CACHE.precomputeScriptSha256, '--history']);
  assert.equal(r.json.paths[0].expect[0].code, 'HISTORY');
  assert.equal(r.json.paths[0].expect[0].history.found.commit, '9e93ffc48a9200f6c79e2e4c2af7414ebad8f3a9');
});

test('Skyhook: rev_a_md5 is md5 of the committed blob; the value 34935cb replaced is md5 of its CRLF form', { skip: skySkip }, () => {
  const blob = blobAt(SKYHOOK, SKYHOOK_REV, 'params/rev_a.json');
  assert.equal(blob.includes(13), false);
  assert.equal(nodeHash('md5', blob), GRID.rev_a_md5);
  assert.equal(nodeHash('md5', crlfOf(blob)), GRID_PARENT.rev_a_md5);
  assert.equal(GRID_PARENT.derivedFrom.revAJsonIdAtParent, GRID_PARENT.derivedFrom.revAJsonIdAtChild, 'rev_a.json did not change between the two');
  assert.equal(nodeHash('md5', blobAt(SKYHOOK, SKYHOOK_REV, 'tools/financial/skyhook_financial_model.xlsx')), GRID.workbook_md5);
  const map = ['--map', 'rev_a_md5=params/rev_a.json', '--map', 'workbook_md5=tools/financial/skyhook_financial_model.xlsx'];
  const now = run([SKYHOOK, '--rev', SKYHOOK_REV, '--scan', path.join(here, 'snapshots', 'decision_grid.keys.json'), ...map]);
  const before = run([SKYHOOK, '--rev', GRID_PARENT.derivedFrom.rev, '--scan', path.join(here, 'snapshots', 'decision_grid.parent.json'), ...map]);
  assert.deepEqual(now.result.scans[0].entries.map((e) => e.match.code), ['BLOB-BASIS', 'BLOB-BASIS']);
  assert.deepEqual(before.result.scans[0].entries.map((e) => e.match.code), ['CRLF-BASIS', 'BLOB-BASIS']);
  assert.equal(now.result.exit, 0);
});

// ------------------------------------------------------------------------------------------------
// The saved outputs and the README quote what the code computes.

const sameHeads = asterReady && skyReady &&
  git(ASTER, ['rev-parse', 'HEAD']).stdout.toString().trim() === ASTER_REV &&
  git(SKYHOOK, ['rev-parse', 'HEAD']).stdout.toString().trim() === SKYHOOK_REV &&
  git(ASTER, ['status', '--porcelain', '--untracked-files=no']).stdout.toString().trim() === '';

test('example.txt and example-data.js are what build-example.mjs produces now', { skip: sameHeads ? false : 'checkouts are not clean at the snapshot commits, so the working-copy side may differ' }, () => {
  const r = spawnSync(process.execPath, [path.join(here, 'build-example.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const data = require(path.join(here, 'example-data.js'));
  assert.deepEqual(data.runs.map((x) => [x.id, x.exit]), [['aster-scan', 1], ['aster-horizons', 0], ['aster-baked', 0], ['skyhook-grid', 0], ['skyhook-grid-parent', 0]]);
});

test('README quotes the recomputed values, not typed ones', { skip: asterSkip || skySkip }, () => {
  const md = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const blob = blobAt(ASTER, ASTER_REV, 'src/v2/data/horizons-inner-solar-system-2026-2040.json');
  const lfCount = blob.toString('latin1').split('\n').length - 1;
  const g3 = BB.group3;
  for (const s of [nodeHash('sha256', blob), nodeHash('sha256', crlfOf(blob)), g3(blob.length), g3(lfCount), g3(blob.length + lfCount),
    nodeHash('md5', crlfOf(blobAt(SKYHOOK, SKYHOOK_REV, 'params/rev_a.json'))), CACHE.precomputeScriptSha256,
    nodeHash('sha256', blobAt(ASTER, ASTER_REV, 'tools/build/precompute-lambert-screen.mjs'))]) {
    assert.ok(md.includes(s), `README should quote ${s}`);
  }
  const tagline = md.split('\n').find((l) => l.startsWith('> '));
  for (const s of [g3(blob.length), g3(lfCount), g3(blob.length + lfCount)]) assert.ok(tagline.includes(s), `tagline quotes ${s}`);
});
