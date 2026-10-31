// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const deps = {
  shapes: req('snapshots/shapes.js'), attitude: req('snapshots/attitude.js'), geophysics: req('snapshots/geophysics.js'), orbitB: req('snapshots/orbit-b.js'), orbitBSunlight: req('snapshots/orbit-b-sunlight.js'),
  coast: req('snapshots/integrator.js'), sources: req('snapshots/approach-sources.js'), constants: req('snapshots/aster-constants.js')
};
const Lumpy = req('lumpy.js');
const K = Lumpy.create(deps);
const sample42 = () => req('snapshots/closing-handoff.js');
module.exports = { K, Lumpy, deps, req, sample42 };
