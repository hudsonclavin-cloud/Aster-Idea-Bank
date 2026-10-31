// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const deps40 = {
  LambertsRoad: req('snapshots/lambert.js'), constants: req('snapshots/aster-constants.js'), earth: req('snapshots/earth-cheb.js'),
  refs: req('snapshots/aster-refs.js'), catalog: req('snapshots/catalog-elements.js'), asterBodies: req('snapshots/aster-bodies-cheb.js'),
  outerPlanets: req('snapshots/outer-planets-cheb.js'), de440: req('snapshots/de440-constants.js'), nav: req('snapshots/nav-sources.js'),
  erfa: req('snapshots/erfa-iau2006.js')
};
const LongCoast = req('snapshots/coast.js');
const K40 = LongCoast.create(deps40);
const Signal = req('signal.js');
const K = Signal.create({ K40, dsn: req('snapshots/dsn-telecom.js'), craft: req('snapshots/craft-telecom.js'), presets40: req('snapshots/coast-presets.js') });
module.exports = { K, K40, deps40, Signal, LongCoast, req };
