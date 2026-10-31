// Node loader for the kernel and its snapshots (tests and build scripts). The page loads the same files as classic
// scripts (app.js wires them the same way). Returns {B, W, ...}: B is this module's kernel over idea 37's (W).
'use strict';
const path = require('node:path');
const req = (f) => require(path.join(__dirname, f));
const EARTH = req('snapshots/earth.js');
const ERFA = req('snapshots/erfa-iau2006.js');
const NAIF = req('snapshots/naif-time-gravity.js');
const ASTER = req('snapshots/aster-constants.js');
const AP17 = req('snapshots/apollo17-window.js');
const AS512 = req('snapshots/as512-flight.js');
const TLI = req('snapshots/as512-tli-burn.js');
const WIN = req('snapshots/window-as512-apophis.js');
const Window = req('snapshots/window.js');
const BurnOut = req('burnout.js');
/** Idea 37's kernel needs idea 36's only for re-flying ascents; the functions used here read its constants alone, which
 * idea 36 takes from the same Aster file (earth.js), so they are passed directly. */
function makeWindow() { return Window.create({ C: { constants: { MU: EARTH.mu_m3_s2, RE: EARTH.radius_m } }, erfa: ERFA, naif: NAIF, aster: ASTER, apollo17: AP17, apophis: null, earth: EARTH, trajectory: null }); }
/** Idea 33's J-2 as the chain flies it (idea 34's vehicle inside idea 37's AS-512 handoff), for the Apollo 17 replay. */
function chainJ2(h37) {
  const h34 = h37.inputs.closed_loop_handoff.inputs.ascent_handoff.inputs.vehicle_handoff, e = h34.inputs.engines['J-2'];
  return { F: e.thrust_vacuum_N, mdot: e.mass_flow_kg_s, label: 'J-2 as idea 33\'s deck gives it (the chain\'s)', source: 'idea 33\'s J-2 deck in idea 34\'s AS-512 vehicle' };
}
const W = makeWindow();
const B = BurnOut.create({ W, apollo17: AP17, as512: AS512, tli: TLI, aster: ASTER, earth: EARTH, chainJ2: chainJ2(WIN) });
module.exports = { B, W, EARTH, ERFA, NAIF, ASTER, AP17, AS512, TLI, WIN, Window, BurnOut, makeWindow, chainJ2 };
