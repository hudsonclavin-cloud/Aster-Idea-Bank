#!/usr/bin/env node
// Run by tools/check.mjs after the generic test step: drives the page with ui-check.mjs (headless
// Chromium via the globally installed Playwright; ui-check prints SKIP and exits 0 without it).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync('node', [path.join(here, 'ui-check.mjs')], { encoding: 'utf8', timeout: 240000 });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 1);
