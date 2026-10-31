#!/usr/bin/env node
// Copies Aster's pinned Lambert cells (inputs only) from the verbatim snapshot into oracle/cases.json for lambert_oracle.py.
//   node ideas/39-lamberts-road/oracle/build-cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pinned = JSON.parse(fs.readFileSync(path.join(here, '..', 'snapshots', 'aster-lambert-pinned-cells.json'), 'utf8'));
const cells = pinned.cells.filter((c) => c.expected && c.expected.ok).map((c) => ({ id: c.id, r1Km: c.r1Km, r2Km: c.r2Km, tofSeconds: c.tofSeconds, M: c.M }));
fs.writeFileSync(path.join(here, 'cases.json'), JSON.stringify({ source: 'snapshots/aster-lambert-pinned-cells.json (Aster tests/fixtures/v2/lambert-multi-rev-pinned-cells.json, 62ddb17)', aster_pinned: cells }, null, 1) + '\n');
console.log('cases', cells.length);
