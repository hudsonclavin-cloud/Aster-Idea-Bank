// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts (app.js wires them the same way).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const C = req('snapshots/aster-constants.js');
const EARTH = req('snapshots/earth-cheb.js');
const BODIES = req('snapshots/neo-excerpt.js');
const REFS = req('snapshots/aster-refs.js');
const LambertsRoad = req('lambert.js');
const K = LambertsRoad.create({ constants: C, earth: EARTH, bodies: BODIES, refs: REFS });
module.exports = { K, C, EARTH, BODIES, REFS, LambertsRoad, req };
