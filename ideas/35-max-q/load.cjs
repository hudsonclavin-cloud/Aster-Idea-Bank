// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts. Returns {pf, Stack, S, AS512, T512, EARTH, AERO, ENG34, H34, H34AS512, MaxQ, A}.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const pf = req('snapshots/isa.js');
const Stack = req('snapshots/stack.js');
const S = Stack.create({ E: null, isa: pf.isa, g0: pf.ISA_G0 }); // idea 34's ledger; idea 33's engine model is not loaded (see README)
const AS512 = req('snapshots/as512-flight.js');
const T512 = req('snapshots/as512-trajectory.js');
const EARTH = req('snapshots/earth.js');
const AERO = req('snapshots/saturn-v-axial-force.js');
const DATA = req('snapshots/data-json.js');
const ENG34 = DATA.engines34, H34 = DATA.sample34, H34AS512 = DATA.as512;
const MaxQ = req('ascent.js');
const A = MaxQ.create({ S, isa: pf.isa, g0: pf.ISA_G0, isaTop: { R0: pf.ISA_R0, HMAX: pf.ISA_H_MAX }, earth: EARTH, aero: AERO, engines34: ENG34, as512: AS512, trajectory: T512 });
module.exports = { pf, Stack, S, AS512, T512, EARTH, AERO, ENG34, H34, H34AS512, MaxQ, A };
