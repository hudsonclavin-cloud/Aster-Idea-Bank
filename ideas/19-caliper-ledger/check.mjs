#!/usr/bin/env node
// Run by tools/check.mjs after the *.test.mjs files: confirms snapshots/partforge.js is still what
// build-data.mjs derives (when the PartForge checkout is present at the snapshot's commit), then drives the
// page in headless Chromium via ui-check.mjs (which prints "skipped" and exits 0 without Playwright).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
const repo = '/home/user/Partforge';
if (fs.existsSync(path.join(repo, 'index.html'))) {
  const head = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const side = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'partforge.js.provenance.json'), 'utf8'));
  if (head === side.commit) {
    const r = spawnSync(process.execPath, [path.join(here, 'build-data.mjs'), repo, '--check'], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
  } else console.log(`build-data --check skipped: PartForge is at ${head.slice(0, 7)}, the snapshot at ${side.commit.slice(0, 7)}`);
} else console.log('build-data --check skipped: no PartForge checkout');
const r = spawnSync(process.execPath, [path.join(here, 'ui-check.mjs')], { stdio: 'inherit' });
if (r.status !== 0) failed++;
process.exit(failed ? 1 : 0);
