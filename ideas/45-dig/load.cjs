// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js): idea 43's kernel first, built from its spin data, then this one.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
// idea 43's kernel needs only its spin data, idea 40's integrator, idea 42's sources (G) and Aster's constants for attitudeAt();
// its shapes and Orbital B data are not used here and are not carried (empty objects in their place).
const lumpyDeps = { shapes: {}, attitude: req('snapshots/attitude.js'), geophysics: {}, orbitB: {}, coast: req('snapshots/integrator.js'), sources: req('snapshots/approach-sources.js'), constants: req('snapshots/aster-constants.js') };
const Lumpy = req('snapshots/lumpy.js');
const K43 = Lumpy.create(lumpyDeps);
const Dig = req('dig.js');
const deps = { lumpy: K43, sources: req('snapshots/dig-sources.js'), ephem: req('snapshots/sun-ephem.js'), nav: req('snapshots/nav-sources.js'), constants: lumpyDeps.constants, approach: lumpyDeps.sources };
const K = Dig.create(deps);
const sample44 = () => req('snapshots/touch-handoff.js');
const bennu44 = () => req('snapshots/touch-bennu-handoff.js');
module.exports = { K, K43, Dig, Lumpy, deps, req, sample44, bennu44 };
