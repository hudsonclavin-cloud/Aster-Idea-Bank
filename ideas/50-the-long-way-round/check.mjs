#!/usr/bin/env node
// Run by tools/check.mjs after the node tests: drives the page in headless Chromium (ui-check.mjs).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(here, 'ui-check.mjs')], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
