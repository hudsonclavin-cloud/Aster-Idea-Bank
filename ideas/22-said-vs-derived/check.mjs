#!/usr/bin/env node
// Run by tools/check.mjs: the browser checks in ui-check.mjs (headless Chromium).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync('node', [path.join(here, 'ui-check.mjs')], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
