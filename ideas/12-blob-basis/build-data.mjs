#!/usr/bin/env node
// Derives the one snapshot tools/snapshot.mjs cannot take, because it lives in history rather than
// in the working tree: the provenance keys of Skyhook's finance/decision_grid.json as they stood
// in the parent of 34935cb, the commit that switched Skyhook's provenance hash to a
// newline-normalised md5 ("CRLF on the authoring machine and LF in Linux CI"). The parent's
// rev_a_md5 is the value that commit replaced; blob-basis places it.
//
//   node ideas/12-blob-basis/build-data.mjs [--skyhook DIR] [--check]
//
// Reads with `git show` only. Then record provenance (from the bank root):
//   node tools/snapshot.mjs /home/user/skyhook finance/decision_grid.json \
//     ideas/12-blob-basis/snapshots/decision_grid.parent.json --sidecar-only \
//     --note "derived by build-data.mjs: provenance keys of finance/decision_grid.json at <parent>, the parent of 34935cb"
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--skyhook');
const SKYHOOK = path.resolve(i >= 0 ? process.argv[i + 1] : '/home/user/skyhook');
const CHECK = process.argv.includes('--check');
const CHILD = '34935cb1f67a8422a9fd49481e080faade2c0d92';
const KEYS = ['schema_version', 'generated_at', 'git_commit', 'rev_a_md5', 'workbook_md5'];

const git = (args) => {
  const r = spawnSync('git', args, { cwd: SKYHOOK, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

const parent = git(['rev-parse', `${CHILD}^`]);
const grid = JSON.parse(git(['show', `${parent}:finance/decision_grid.json`]));
const out = { derivedFrom: { repo: 'https://github.com/hudsonclavin-cloud/skyhook', rev: parent, path: 'finance/decision_grid.json', childCommit: CHILD } };
for (const k of KEYS) out[k] = grid[k];
// The md5 is of params/rev_a.json; say whether that file changed between the parent and 34935cb.
out.derivedFrom.revAJsonIdAtParent = git(['rev-parse', `${parent}:params/rev_a.json`]);
out.derivedFrom.revAJsonIdAtChild = git(['rev-parse', `${CHILD}:params/rev_a.json`]);

const file = path.join(here, 'snapshots', 'decision_grid.parent.json');
const text = `${JSON.stringify(out, null, 1)}\n`;
if (CHECK) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(same ? 'decision_grid.parent.json is current' : 'stale: decision_grid.parent.json');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`wrote snapshots/decision_grid.parent.json (keys of finance/decision_grid.json at ${parent.slice(0, 7)})`);
