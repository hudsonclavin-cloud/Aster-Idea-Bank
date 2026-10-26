#!/usr/bin/env node
// Derives the line excerpts under snapshots/ from the Aster checkout at 62ddb17 and records their
// provenance with the bank's tools/snapshot.mjs (--sidecar-only). The tests extract references from
// these excerpts (real prose, so the regexes are pinned on what the documents actually say) and
// judge them against the whole-file copies of the cited targets (copied by snapshot.mjs, not here).
//
//   node ideas/23-line-drift/build-data.mjs [/path/to/asteroid-mining-planner]
//
// Refuses unless the checkout's HEAD is 62ddb17 and the excerpted files are unmodified, so each
// sidecar's commit is the commit the excerpt was cut from. Each excerpt starts with one header
// line, "<!-- excerpt of <path> lines A-B at 62ddb17 -->", so a test can map its lines back.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bank = path.resolve(here, '..', '..');
const repo = path.resolve(process.argv[2] || '/home/user/asteroid-mining-planner');
const COMMIT = '62ddb17';

export const EXCERPTS = [
  { path: 'STATUS.md', from: 417, to: 425, why: 'Slice 19 item 1: the porkchop "Grid spans" literal with citations :637, :646, :187-194, :189' },
  { path: 'STATUS.md', from: 535, to: 535, why: 'Cleanup C17: a table row citing .githooks/pre-commit:53 with an escaped pipe in its code span' },
  { path: 'INVARIANTS.md', from: 171, to: 180, why: 'INV-034 evidence-artifact tracking, citing SLICE_9_FOUNDING.md:202, :350-353 and .gitignore:17' },
  { path: 'src/v2/SLICE_9_FOUNDING.md', from: 423, to: 428, why: 'the 2026-07-12 amendment: .gitignore:17 next to the glob it names' },
];

const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function main() {
  const head = git(['rev-parse', '--short=7', 'HEAD']).trim();
  if (head !== COMMIT) {
    console.error(`refused: ${repo} is at ${head}, not ${COMMIT}`);
    process.exit(2);
  }
  for (const e of EXCERPTS) {
    const committed = git(['show', `${COMMIT}:${e.path}`]);
    const onDisk = fs.readFileSync(path.join(repo, e.path), 'utf8');
    if (committed !== onDisk) {
      console.error(`refused: ${e.path} differs from its committed blob`);
      process.exit(2);
    }
    const lines = committed.split('\n').slice(e.from - 1, e.to);
    const name = `${e.path.replace(/\//g, '__')}.${e.from}-${e.to}.md`;
    const dest = path.join(here, 'snapshots', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `<!-- excerpt of ${e.path} lines ${e.from}-${e.to} at ${COMMIT} -->\n${lines.join('\n')}\n`);
    execFileSync(process.execPath, [
      path.join(bank, 'tools', 'snapshot.mjs'), repo, e.path, dest, '--sidecar-only',
      '--note', `derived by build-data.mjs: lines ${e.from}-${e.to} verbatim after a one-line header; ${e.why}`,
    ], { stdio: 'inherit' });
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
