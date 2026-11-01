// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js): ideas 39 and 40's kernels and data, the oracles, idea 46's handoff.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const deps = {
  LongCoast: req('snapshots/coast.js'), LambertsRoad: req('snapshots/lambert.js'), constants: req('snapshots/aster-constants.js'), earth: req('snapshots/earth-cheb.js'),
  catalog: req('snapshots/catalog-elements.js'), asterBodies: req('snapshots/aster-bodies-cheb.js'), outerPlanets: req('snapshots/outer-planets-cheb.js'),
  de440: req('snapshots/de440-constants.js'), nav: req('snapshots/nav-sources.js'), erfa: req('snapshots/erfa-iau2006.js'),
  oracles: req('snapshots/return-oracles.js'), outbound: req('snapshots/chain-outbound.js'), chain: req('snapshots/split-handoff.js')
};
const WayHome = req('home.js');
const K = WayHome.create(deps);
const chain = () => JSON.parse(JSON.stringify(deps.chain));
module.exports = { K, deps, WayHome, req, chain };
