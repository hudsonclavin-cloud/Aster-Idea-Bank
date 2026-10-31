// Node loader for the kernel and its snapshots (tests and build-sample.mjs). The page loads the same files as
// classic scripts. Returns {M, db, B, Bell, charts, rules, table, presets, densities, pf, THERMO}.
'use strict';
const path = require('node:path');
const here = __dirname;
const req = (f) => require(path.join(here, f));
const M = req('snapshots/mixture.js');
const db = M.parseThermo(req('snapshots/thermo-excerpt.js'));
const charts = req('snapshots/nozzle-charts.js');
const rules = req('snapshots/nozzle-rules.js');
const pf = req('snapshots/isa.js');
const Bell = req('bell.js');
const B = Bell.create({ Mixture: M, db, charts, rules, isa: pf.isa, g0: pf.ISA_G0 });
// The thermo.inp identity idea 31 records in its handoffs (snapshots/thermo-excerpt.js.provenance.json of idea 31).
const THERMO = { repo: 'https://github.com/nasa/cea', commit: '2f79a647e85737742fb08a127da00d1ea1d069da', path: 'data/thermo.inp', sha256: 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363' };
module.exports = { M, db, B, Bell, charts, rules, pf, THERMO, table: req('snapshots/sp8120-table1.js'), presets: req('snapshots/mixture-presets.js'), densities: req('snapshots/propellant-densities.js') };
