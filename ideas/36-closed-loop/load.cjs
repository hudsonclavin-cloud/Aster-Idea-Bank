// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts. Returns {pf, S, A, C, DATA, T512, G512, EARTH, AERO, AS512, ClosedLoop}.
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const pf = req('snapshots/isa.js');
const Stack = req('snapshots/stack.js');
const S = Stack.create({ E: null, isa: pf.isa, g0: pf.ISA_G0 });
const AS512 = req('snapshots/as512-flight.js');
const T512 = req('snapshots/as512-trajectory.js');
const G512 = req('snapshots/as512-guidance.js');
const EARTH = req('snapshots/earth.js');
const AERO = req('snapshots/saturn-v-axial-force.js');
const DATA = req('snapshots/data-json.js');
const PARK = req('snapshots/aster-parking.js');
const MaxQ = req('snapshots/ascent.js');
const A = MaxQ.create({ S, isa: pf.isa, g0: pf.ISA_G0, isaTop: { R0: pf.ISA_R0, HMAX: pf.ISA_H_MAX }, earth: EARTH, aero: AERO, engines34: DATA.engines34, as512: AS512, trajectory: T512 });
const ClosedLoop = req('closedloop.js');
const C = ClosedLoop.create({ A, S, earth: EARTH, trajectory: T512, guidance512: G512, parking: PARK, as512: AS512, data: DATA });
module.exports = { pf, S, A, C, DATA, T512, G512, EARTH, AERO, AS512, PARK, MaxQ, ClosedLoop };
