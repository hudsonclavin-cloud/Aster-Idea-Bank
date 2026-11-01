// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const catchDeps = {
  isa: req('snapshots/isa.js'), earth: req('snapshots/earth.js'), de440: req('snapshots/de440-constants.js'), erfa: req('snapshots/erfa-iau2006.js'),
  sources: req('snapshots/entry-sources.js'), radii: req('snapshots/earth-radii.js')
};
const Catch = req('snapshots/catch.js');
const HotReturn = req('hotreturn.js');
const deps = { Catch, catchDeps, sources: req('snapshots/reentry-sources.js'), chain: req('snapshots/catch-handoff.js') };
const K = HotReturn.create(deps);
const chain = () => JSON.parse(JSON.stringify(deps.chain.handoff));
module.exports = { K, deps, HotReturn, Catch, req, chain };
