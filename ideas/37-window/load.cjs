// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts. Returns {W, C, A, S, DATA, ...}: W is this module's kernel over idea 36's (C), 35's (A) and 34's (S).
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
const ClosedLoop = req('snapshots/closedloop.js');
const C = ClosedLoop.create({ A, S, earth: EARTH, trajectory: T512, guidance512: G512, parking: PARK, as512: AS512, data: DATA });
const ERFA = req('snapshots/erfa-iau2006.js');
const NAIF = req('snapshots/naif-time-gravity.js');
const ASTER = req('snapshots/aster-constants.js');
const AP17 = req('snapshots/apollo17-window.js');
const APOPHIS = req('snapshots/aster-apophis-vinf.json');
const Window = req('window.js');
const W = Window.create({ C, erfa: ERFA, naif: NAIF, aster: ASTER, apollo17: AP17, apophis: APOPHIS, earth: EARTH, trajectory: T512 });
/** Idea 36's handoff for the Saturn V AS-512, as idea 36's page opens on it (guided to Apollo 17's parking orbit). */
function as512Handoff36(produced) {
  const ctx = C.setup(DATA.as512);
  const R = C.run(ctx, { samples: false });
  return C.makeHandoff(ctx, R, null, { produced: produced || '2026-10-31T12:00:00Z' });
}
module.exports = { W, C, A, S, DATA, EARTH, T512, AS512, ERFA, NAIF, ASTER, AP17, APOPHIS, Window, ClosedLoop, MaxQ, as512Handoff36 };
