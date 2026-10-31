// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const deps = {
  lambert: req('snapshots/lambert.js'), coast: req('snapshots/coast.js'), constants: req('snapshots/aster-constants.js'), nav: req('snapshots/nav-sources.js'),
  horizons: req('snapshots/horizons-approach.js'), bodies: req('snapshots/bodies.js'), sources: req('snapshots/approach-sources.js')
};
const ClosingIn = req('closing.js');
const K = ClosingIn.create(deps);
const sample41 = () => req('snapshots/signal-handoff.js');
module.exports = { K, ClosingIn, deps, req, sample41 };
