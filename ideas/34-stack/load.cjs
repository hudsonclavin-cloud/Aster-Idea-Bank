// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts. Returns {M, db, pf, B, E, Engine, Stack, S, AS512, THERMO}.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const M = req('snapshots/mixture.js');
const db = M.parseThermo(req('snapshots/thermo-excerpt.js'));
const pf = req('snapshots/isa.js');
const Bell = req('snapshots/bell.js');
const B = Bell.create({ Mixture: M, db, charts: req('snapshots/nozzle-charts.js'), rules: req('snapshots/nozzle-rules.js'), isa: pf.isa, g0: pf.ISA_G0 });
const Engine = req('snapshots/engine.js');
const E = Engine.create({ Mixture: M, db, B, turbo: req('snapshots/turbo-data.js'), table: req('snapshots/sp8120-table1.js').ROWS, presets: req('snapshots/mixture-presets.js').PRESETS, densities: req('snapshots/propellant-densities.js'), isa: pf.isa, g0: pf.ISA_G0 });
const Stack = req('stack.js');
const S = Stack.create({ E, isa: pf.isa, g0: pf.ISA_G0 });
const AS512 = req('snapshots/as512-flight.js');
module.exports = { M, db, pf, B, Engine, E, Stack, S, AS512 };
