// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js): idea 31's kernel and data, idea 32's nozzle kernel, then this one.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const M = req('snapshots/mixture.js');
const db = M.parseThermo(req('snapshots/thermo-excerpt.js'));
const pf = req('snapshots/isa.js');
const Bell = req('snapshots/bell.js');
const B = Bell.create({ Mixture: M, db, charts: req('snapshots/nozzle-charts.js'), rules: req('snapshots/nozzle-rules.js'), isa: pf.isa, g0: pf.ISA_G0 });
const Split = req('split.js');
const deps = { Mixture: M, db, B, sources: req('snapshots/split-sources.js'), materials: req('snapshots/partforge-materials.js'), factor: req('snapshots/partforge-factor.js'),
  table: req('snapshots/sp8120-table1.js'), presets: req('snapshots/mixture-presets.js').PRESETS, densities: req('snapshots/propellant-densities.js'), g0: pf.ISA_G0 };
const K = Split.create(deps);
const sample45 = () => req('snapshots/dig-handoff.js');
const bennu45 = () => req('snapshots/dig-bennu-handoff.js');
module.exports = { K, Split, M, db, B, deps, req, sample45, bennu45 };
