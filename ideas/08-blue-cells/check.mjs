#!/usr/bin/env node
// Run by tools/check.mjs after the test files: drives the page in headless Chromium via
// ui-check.mjs (which prints "skipped" and exits 0 when Playwright is not installed).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync('node', [path.join(here, 'ui-check.mjs')], { stdio: 'inherit' });
process.exit(r.status === 0 ? 0 : 1);
