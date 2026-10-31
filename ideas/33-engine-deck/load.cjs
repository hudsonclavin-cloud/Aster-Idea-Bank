// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts. Returns {M, db, Bell, B, Engine, E, TD, table, presets, densities, pf, THERMO}.
'use strict';
const path = require('node:path');
const here = __dirname;
const req = (f) => require(path.join(here, f));
const M = req('snapshots/mixture.js');
const db = M.parseThermo(req('snapshots/thermo-excerpt.js'));
const pf = req('snapshots/isa.js');
const Bell = req('snapshots/bell.js');
const B = Bell.create({ Mixture: M, db, charts: req('snapshots/nozzle-charts.js'), rules: req('snapshots/nozzle-rules.js'), isa: pf.isa, g0: pf.ISA_G0 });
const TD = req('snapshots/turbo-data.js');
const table = req('snapshots/sp8120-table1.js');
const presets = req('snapshots/mixture-presets.js');
const densities = req('snapshots/propellant-densities.js');
const Engine = req('engine.js');
const E = Engine.create({ Mixture: M, db, B, turbo: TD, table: table.ROWS, presets: presets.PRESETS, densities, isa: pf.isa, g0: pf.ISA_G0 });
// The thermo.inp identity idea 31 records in its handoffs (idea 31's snapshots/thermo-excerpt.js.provenance.json).
const THERMO = { repo: 'https://github.com/nasa/cea', commit: '2f79a647e85737742fb08a127da00d1ea1d069da', path: 'data/thermo.inp', sha256: 'fa7746572952d74e249e818a82a35c113829742fb421a308e167185528884363' };
module.exports = { M, db, pf, Bell, B, TD, table, presets, densities, Engine, E, THERMO };
