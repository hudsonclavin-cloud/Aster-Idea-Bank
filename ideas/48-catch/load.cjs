// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const TipMatch = req('snapshots/tip-match.js');
const deps = {
  isa: req('snapshots/isa.js'), earth: req('snapshots/earth.js'), de440: req('snapshots/de440-constants.js'), erfa: req('snapshots/erfa-iau2006.js'),
  sources: req('snapshots/entry-sources.js'), radii: req('snapshots/earth-radii.js'), TipMatch, revA: req('snapshots/rev_a.data.js'), aster: req('snapshots/aster.data.js'), chain: req('snapshots/way-home-handoff.js')
};
const Catch = req('catch.js');
const K = Catch.create(deps);
const chain = () => JSON.parse(JSON.stringify(deps.chain.handoff));
module.exports = { K, deps, Catch, req, chain };
