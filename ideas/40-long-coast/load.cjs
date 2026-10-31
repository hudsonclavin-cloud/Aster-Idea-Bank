// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const deps = {
  LambertsRoad: req('snapshots/lambert.js'), constants: req('snapshots/aster-constants.js'), earth: req('snapshots/earth-cheb.js'),
  refs: req('snapshots/aster-refs.js'), catalog: req('snapshots/catalog-elements.js'), asterBodies: req('snapshots/aster-bodies-cheb.js'),
  outerPlanets: req('snapshots/outer-planets-cheb.js'), de440: req('snapshots/de440-constants.js'), nav: req('snapshots/nav-sources.js'),
  erfa: req('snapshots/erfa-iau2006.js'), truth: req('snapshots/horizons-truth.js')
};
const LongCoast = req('coast.js');
const K = LongCoast.create(deps);
module.exports = { K, deps, LongCoast, req };
