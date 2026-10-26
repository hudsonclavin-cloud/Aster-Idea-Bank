#!/usr/bin/env node
// Run by tools/check.mjs: spawns the headless UI check so the checker exercises the page, not
// just the model. Exits non-zero if any UI check fails.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(here, 'ui-check.mjs')], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
