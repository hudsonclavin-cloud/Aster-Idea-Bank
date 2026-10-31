#!/usr/bin/env node
// Writes handoff.json: the chain's Apophis transfer (idea 40's preset "99942", Aster's DLA-oracle cell, picked by idea
// 39's kernel and flown by idea 40's with its defaults: the same cruise as idea 40's committed sample, to the metre),
// talked to with this module's defaults (Dawn's radio, the DSN 34-m BWG subnet, idea 40's 3 passes a week of 8 h).
// Idea 40's committed sample carries ideas 31-39 inside it (112 KB); built from it, this sample would put the folder over
// the bank's size limit, so it is built from the preset, and the tests import idea 40's committed sample as well.
// Usage: node ideas/41-signal/build-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K } = require('./load.cjs');
const src = K.fromPreset('99942', '2026-10-31T12:00:00Z');
if (src.refusal) { console.error(src.refusal.reason); process.exit(1); }
const R = K.run(src, K.defaults('dawn', src.R40.S.nav));
if (R.refusal) { console.error(R.refusal.reason); process.exit(1); }
const h = K.buildHandoff(R, '2026-10-31T12:00:00Z');
fs.writeFileSync(path.join(here, 'handoff.json'), JSON.stringify(h));
console.log('wrote handoff.json', JSON.stringify(h).length, 'bytes;', R.days.length, 'days;', h.refusals.length, 'refusals');
