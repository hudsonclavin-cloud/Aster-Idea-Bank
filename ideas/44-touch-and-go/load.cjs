// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts and wires them the same way (app.js): idea 43's kernel first, built from its own snapshots, then this one.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const lumpyDeps = {
  shapes: req('snapshots/shapes.js'), attitude: req('snapshots/attitude.js'), geophysics: req('snapshots/geophysics.js'), orbitB: req('snapshots/orbit-b.js'), orbitBSunlight: req('snapshots/orbit-b-sunlight.js'),
  coast: req('snapshots/integrator.js'), sources: req('snapshots/approach-sources.js'), constants: req('snapshots/aster-constants.js')
};
const Lumpy = req('snapshots/lumpy.js');
const K43 = Lumpy.create(lumpyDeps);
const Touch = req('touch.js');
const deps = { lumpy: K43, lumpyDeps, recon: req('snapshots/tag-recon.js'), sources: req('snapshots/tag-sources.js'), coast: lumpyDeps.coast, constants: lumpyDeps.constants, nist: lumpyDeps.sources.nist };
const K = Touch.create(deps);
const sample43 = () => req('snapshots/lumpy-handoff.js');
module.exports = { K, K43, Touch, Lumpy, deps, req, sample43 };
