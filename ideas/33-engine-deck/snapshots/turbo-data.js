/* Turbomachinery and turbine-gas data for the Engine Deck, HAND-TRANSCRIBED from three NASA reports fetched from
 * NTRS on 2026-10-31 and read off pages rendered at 150-220 dpi (the text layers garble numbers: SP-8107's F-1
 * oxygen discharge reads "t600", the RL10A-3-3 turbine inlet "106" without its minus sign, the SSME oxidizer
 * turbine pressure ratio "159"; RL10A-3-3A Table 6.1.1 has no text layer at all). Units exactly as printed.
 * snapshots/turbo-sources.txt holds the verbatim text-layer lines (runs of spaces collapsed) that the tests
 * check every transcribed number against where the text layer is legible.
 *
 *   SP8107  NASA SP-8107, Turbopump Systems for Liquid Rocket Engines (1974), NTRS 19750012398,
 *           Table I (p. 3), Table II (p. 4), Table III (p. 5); "best available data as of mid-1973".
 *   SP8110  NASA SP-8110, Liquid Rocket Engine Turbines (1974), NTRS 19740026132, Table III (p. 16).
 *   TM107318 NASA TM-107318, RL10A-3-3A Rocket Engine Modeling Project (Binder, Tomsik & Veres, 1997),
 *           NTRS 19970010379, Table 6.1.1 (p. 37), "Steady-state Cycle Performance Prediction" (a model output,
 *           not a test), and Table 2.5.1 (p. 6).
 *
 * Loads as a classic script (window.TurboData) and with require(). */
(function (root) {
  // SP-8107 Table I: engine, application, thrust lbf, chamber pressure psia, turbopump arrangement.
  var SP8107_T1 = [
    { engine: 'A-7', application: 'Redstone', thrust: 78000, pc: 318, arrangement: 'Single shaft, turbine in middle' },
    { engine: 'MB-3', application: 'Thor', thrust: 170000, pc: 594, arrangement: 'Geared turbine' },
    { engine: 'LR87-AJ-3', application: 'Titan I, 1st stage', thrust: 150000, pc: 585, arrangement: 'Geared turbine and pumps' },
    { engine: 'LR91-AJ-3', application: 'Titan I, 2nd stage', thrust: 80000, pc: 682, arrangement: 'Geared O2 pump' },
    { engine: 'H-1', application: 'Saturn IB', thrust: 205000, pc: 702, arrangement: 'Geared turbine' },
    { engine: 'MA-5 sustainer', application: 'Atlas', thrust: 57000, pc: 706, arrangement: 'Geared turbine' },
    { engine: 'MA-5 booster', application: 'Atlas', thrust: 330000, pc: 577, arrangement: 'Geared turbine', note: 'footnote 2: "Two engines, each developing 165 000 hp" (sic; read as lbf)' },
    { engine: 'F-1', application: 'Saturn IC', thrust: 1522000, pc: 1122, arrangement: 'Single shaft, turbine on end' },
    { engine: 'YLR81-BA-11', application: 'Agena', thrust: 16000, pc: 506, arrangement: 'Geared turbine and pumps' },
    { engine: 'YLR87-AJ-7', application: 'Gemini-Titan 1st stage', thrust: 215000, pc: 784, arrangement: 'Geared turbine and pumps' },
    { engine: 'YLR91-AJ-7', application: 'Gemini-Titan 2nd stage', thrust: 100000, pc: 804, arrangement: 'Geared N2O4 pump' },
    { engine: 'RL10A-3-3', application: 'Centaur', thrust: 15000, pc: 400, arrangement: 'Geared O2 pump' },
    { engine: 'J-2', application: 'Saturn S-II and S-IVB', thrust: 230000, pc: 787, arrangement: 'Dual turbopump, series turbines' },
    { engine: 'SSME (EPL)', application: 'Space Shuttle', thrust: 512300, pc: 3237, arrangement: 'Dual turbopump, parallel turbines', note: 'footnote 3: "Not operational, but presented for comparative purposes"; EPL = emergency power level' },
  ];
  // SP-8107 Table II, one row per pump: density lbm/ft^3, discharge and inlet psia, head ft, weight flow lbm/s,
  // volume flow gpm, speed rpm, efficiency percent, power hp. null where the table prints a dash.
  // The SSME oxygen pump has two stages: 90 % of the flow leaves the first (5174 psia), 10 % goes on through a
  // second stage alone (8491 psia; footnote 8). Both are given; the table's 27 400 hp is the pump's total.
  var SP8107_PUMPS = [
    { engine: 'A-7', fluid: 'Oxygen', rho: 71.4, pd: 356, pin: 49.8, head: 616, w: 205, gpm: 1290, rpm: 4718, eff: 72.0, hp: 320 },
    { engine: 'A-7', fluid: 'Alcohol (75 % alcohol, 25 % water)', rho: 56.6, pd: 464, pin: 42.5, head: 1139, w: 150, gpm: 1190, rpm: 4718, eff: 70.0, hp: 418 },
    { engine: 'MB-3', fluid: 'Oxygen', rho: 71.4, pd: 867, pin: 53.0, head: 1651, w: 456, gpm: 2870, rpm: 6303, eff: 79.0, hp: 1830 },
    { engine: 'MB-3', fluid: 'RJ-1', rho: 53.2, pd: 913, pin: 48.0, head: 2337, w: 202, gpm: 1700, rpm: 6303, eff: 72.0, hp: 1210 },
    { engine: 'LR87-AJ-3', fluid: 'Oxygen', rho: 71.4, pd: 798, pin: 53.0, head: 1510, w: 412.7, gpm: 2600, rpm: 7949, eff: null, hp: null },
    { engine: 'LR87-AJ-3', fluid: 'RP-1', rho: 50.5, pd: 1034, pin: 22.0, head: 2881, w: 183.3, gpm: 1630, rpm: 8780, eff: null, hp: null },
    { engine: 'LR91-AJ-3', fluid: 'Oxygen', rho: 71.4, pd: 819, pin: 35.0, head: 1613, w: 175.6, gpm: 1100, rpm: 8945, eff: null, hp: null },
    { engine: 'LR91-AJ-3', fluid: 'RP-1', rho: 50.5, pd: 1097, pin: 42.0, head: 3024, w: 74.1, gpm: 659, rpm: 25207, eff: null, hp: null },
    { engine: 'H-1', fluid: 'Oxygen', rho: 70.8, pd: 980, pin: 65.0, head: 1851, w: 537, gpm: 3410, rpm: 6680, eff: 77.8, hp: 2340 },
    { engine: 'H-1', fluid: 'RP-1', rho: 50.5, pd: 1020, pin: 57.0, head: 2719, w: 240, gpm: 2130, rpm: 6680, eff: 71.8, hp: 1670 },
    { engine: 'MA-5 sustainer', fluid: 'Oxygen', rho: 71.4, pd: 982, pin: 53.0, head: 1879, w: 193.2, gpm: 1200, rpm: 10160, eff: 64.2, hp: 1018 },
    { engine: 'MA-5 sustainer', fluid: 'RP-1', rho: 50.5, pd: 996, pin: 77.0, head: 2616, w: 91.6, gpm: 745, rpm: 10160, eff: 64.5, hp: 620 },
    { engine: 'MA-5 booster', fluid: 'Oxygen', rho: 71.4, pd: 877, pin: 50.0, head: 1679, w: 458, gpm: 2862, rpm: 6314, eff: 74.3, hp: 1800 },
    { engine: 'MA-5 booster', fluid: 'RP-1', rho: 50.5, pd: 839, pin: 73.0, head: 2184, w: 211, gpm: 1867, rpm: 6314, eff: 73.6, hp: 1151 },
    { engine: 'F-1', fluid: 'Oxygen', rho: 71.4, pd: 1600, pin: 65.0, head: 3097, w: 4070, gpm: 25200, rpm: 5488, eff: 74.6, hp: 30200 },
    { engine: 'F-1', fluid: 'RP-1', rho: 50.5, pd: 1856, pin: 45.0, head: 5168, w: 1715, gpm: 15250, rpm: 5488, eff: 72.6, hp: 22100 },
    { engine: 'YLR81-BA-11', fluid: 'IRFNA', rho: 98.2, pd: 949, pin: 24.0, head: 1360, w: 39.3, gpm: 180, rpm: 25389, eff: null, hp: 352 },
    { engine: 'YLR81-BA-11', fluid: 'UDMH', rho: 49.4, pd: 749, pin: 24.0, head: 2110, w: 15.3, gpm: 139, rpm: 14410, eff: null, hp: 352 },
    { engine: 'YLR87-AJ-7', fluid: 'N2O4', rho: 90.3, pd: 1182, pin: 84.0, head: 1740, w: 550, gpm: 2700, rpm: 8382, eff: 68.0, hp: 2560 },
    { engine: 'YLR87-AJ-7', fluid: 'A-50', rho: 56.1, pd: 1363, pin: 33.5, head: 3381, w: 274, gpm: 2180, rpm: 9209, eff: 68.0, hp: 2480 },
    { engine: 'YLR91-AJ-7', fluid: 'N2O4', rho: 90.3, pd: 1112, pin: 41.0, head: 1713, w: 207, gpm: 1010, rpm: 8405, eff: 67.4, hp: 960 },
    { engine: 'YLR91-AJ-7', fluid: 'A-50', rho: 56.1, pd: 1201, pin: 44.5, head: 2981, w: 115, gpm: 904, rpm: 23685, eff: 57.1, hp: 1090 },
    { engine: 'RL10A-3-3', fluid: 'Oxygen', rho: 68.8, pd: 597, pin: 60.5, head: 1120, w: 28.2, gpm: 184, rpm: 12100, eff: 62.9, hp: 94 },
    { engine: 'RL10A-3-3', fluid: 'Hydrogen', rho: 4.35, pd: 990, pin: 30.0, head: 31800, w: 5.6, gpm: 581, rpm: 30250, eff: 55.0, hp: 592 },
    { engine: 'J-2', fluid: 'Oxygen', rho: 70.8, pd: 1114, pin: 39.0, head: 2185, w: 460.4, gpm: 2920, rpm: 8753, eff: 80.0, hp: 2358 },
    { engine: 'J-2', fluid: 'Hydrogen', rho: 4.4, pd: 1238, pin: 30.0, head: 38000, w: 83.6, gpm: 8530, rpm: 27130, eff: 73.0, hp: 7977 },
    { engine: 'SSME (EPL)', fluid: 'Oxygen', rho: 70.4, pd: 5174, pin: 379, head: 9640, w: 1137, gpm: 7250, rpm: 31000, eff: 78.1, hp: 27400,
      second: { pd: 8491, pin: 4940, head: 7100, w: 120, gpm: 633, eff: 69.6 } },
    { engine: 'SSME (EPL)', fluid: 'Hydrogen', rho: 4.38, pd: 6981, pin: 188, head: 193900, w: 160.5, gpm: 16450, rpm: 37400, eff: 74.1, hp: 76400 },
  ];
  // SP-8107 Table III, one row per turbine: inlet temperature degF, inlet pressure psia, pressure ratio, flow
  // lbm/s, speed rpm, efficiency percent, power hp. 'tt': footnote ** "Total-to-total fluid condition basis"
  // (the SSME rows); the others do not say. 'drives': which pumps of Table II the turbine drives.
  var SP8107_TURBINES = [
    { engine: 'A-7', fluid: 'H2O2', stages: '1*', type: '2-row velocity compounded', Tin: 740, pin: 371, pr: 21.2, w: 6.68, rpm: 4718, eff: 37.2, hp: 758, drives: ['Oxygen', 'Alcohol (75 % alcohol, 25 % water)'] },
    { engine: 'MB-3', fluid: 'O2/RJ-1', stages: '2', type: 'pressure compounded', Tin: 1204, pin: 523, pr: 17.6, w: 15.4, rpm: 30540, eff: null, hp: 3162, drives: ['Oxygen', 'RJ-1'] },
    { engine: 'LR87-AJ-3', fluid: 'O2/RP-1', stages: '2', type: 'pressure compounded', Tin: 1334, pin: 413, pr: 17.8, w: 11.7, rpm: 25172, eff: 63.6, hp: 3678, drives: ['Oxygen', 'RP-1'] },
    { engine: 'LR91-AJ-3', fluid: 'O2/RP-1', stages: '2', type: 'pressure compounded', Tin: 1240, pin: 560, pr: 28.2, w: 6.31, rpm: 25207, eff: 63.1, hp: 1480, drives: ['Oxygen', 'RP-1'] },
    { engine: 'H-1', fluid: 'O2/RP-1', stages: '2', type: 'pressure compounded', Tin: 1200, pin: 622, pr: 17.7, w: 18.0, rpm: 32700, eff: 70.2, hp: 4141, drives: ['Oxygen', 'RP-1'] },
    { engine: 'MA-5 sustainer', fluid: 'O2/RP-1', stages: '2', type: 'pressure compounded', Tin: 1075, pin: 692, pr: 25.0, w: 9.73, rpm: 38000, eff: 46.3, hp: 1663, drives: ['Oxygen', 'RP-1'] },
    { engine: 'MA-5 booster', fluid: 'O2/RP-1', stages: '2', type: 'pressure compounded', Tin: 1240, pin: 497, pr: 15.7, w: 14.07, rpm: 30986, eff: 66.9, hp: 3140, drives: ['Oxygen', 'RP-1'] },
    { engine: 'F-1', fluid: 'O2/RP-1', stages: '1*', type: '2-row velocity compounded', Tin: 1450, pin: 920, pr: 16.4, w: 171.8, rpm: 5488, eff: 60.5, hp: 52900, drives: ['Oxygen', 'RP-1'] },
    { engine: 'YLR81-BA-11', fluid: 'IRFNA/UDMH', stages: '1', type: 'impulse, partial admission', Tin: 1400, pin: 480, pr: 37.7, w: 1.58, rpm: 24800, eff: 41.0, hp: 352, drives: ['IRFNA', 'UDMH'] },
    { engine: 'YLR87-AJ-7', fluid: 'N2O4/A-50', stages: '2', type: 'pressure compounded', Tin: 1667, pin: 443, pr: 17.8, w: 12.85, rpm: 23992, eff: 56.0, hp: 5180, drives: ['N2O4', 'A-50'] },
    { engine: 'YLR91-AJ-7', fluid: 'N2O4/A-50', stages: '2', type: 'pressure compounded', Tin: 1650, pin: 420, pr: 29.0, w: 5.46, rpm: 23685, eff: 53.0, hp: 2122, drives: ['N2O4', 'A-50'] },
    { engine: 'RL10A-3-3', fluid: 'Hydrogen', stages: '2', type: 'pressure compounded', Tin: -106, pin: 698, pr: 1.42, w: 5.35, rpm: 30250, eff: 74.0, hp: 687, drives: ['Oxygen', 'Hydrogen'] },
    { engine: 'J-2', turbine: 'Oxidizer', fluid: 'O2/H2', stages: '1*', type: '2-row velocity compounded', Tin: 760, pin: 89.5, pr: 2.5, w: 5.0, rpm: 8753, eff: 48.4, hp: 2358, drives: ['Oxygen'] },
    { engine: 'J-2', turbine: 'Fuel', fluid: 'O2/H2', stages: '1*', type: '2-row velocity compounded', Tin: 1200, pin: 657, pr: 7.3, w: 7.0, rpm: 27130, eff: 60.1, hp: 7977, drives: ['Hydrogen'] },
    { engine: 'SSME (EPL)', turbine: 'High pressure oxidizer', fluid: 'O2/H2', stages: '2', type: 'reaction', Tin: 1101, pin: 5880, pr: 1.59, w: 63.3, rpm: 31000, eff: 72.9, hp: 27400, tt: true, drives: ['Oxygen'] },
    { engine: 'SSME (EPL)', turbine: 'High pressure fuel', fluid: 'O2/H2', stages: '2', type: 'reaction', Tin: 1391, pin: 5820, pr: 1.56, w: 159.0, rpm: 37400, eff: 79.0, hp: 76400, tt: true, drives: ['Hydrogen'] },
  ];
  // SP-8110 Table III: turbine working-fluid gas properties. Source chamber pressure psi, turbine inlet degF,
  // gamma, cp Btu/(lbm degR), R ft-lbf/(lbm degR). "Products of combustion of propellant combinations listed";
  // the N2O4 fuel "50-50" is "Hydrazine-UDMH" (footnote **).
  var SP8110_GAS = {
    'LOX/RP-1': { pSource: 1000, T: [1100, 1300, 1500, 1600, 1700], gamma: [1.097, 1.115, 1.132, 1.140, 1.148], cp: [0.635, 0.648, 0.656, 0.660, 0.662], R: [44, 52, 59, 63, 67] },
    'LOX/LH2': { pSource: 1500, T: [1000, 1200, 1500, 1700, 1900], gamma: [1.374, 1.364, 1.348, 1.337, 1.326], cp: [1.998, 1.910, 1.802, 1.738, 1.687], R: [423, 396, 362, 341, 323] },
    'LF2/LH2': { pSource: 750, T: [900, 1100, 1300, 1500, 1700], gamma: [1.395, 1.388, 1.380, 1.373, 1.366], cp: [2.765, 2.608, 2.509, 2.318, 2.192], R: [626, 574, 529, 491, 457] },
    'FLOX/CH4': { pSource: 750, T: [1300, 1500, 1700, 1900, 2100], gamma: [1.176, 1.189, 1.215, 1.233, 1.242], cp: [0.857, 0.855, 0.834, 0.810, 0.791], R: [100, 106, 113, 116, 117] },
    'Hydrogen': { pSource: null, T: [700, 800, 900, 1000, 1100], gamma: [1.396, 1.394, 1.392, 1.390, 1.388], cp: [3.481, 3.490, 3.501, 3.516, 3.531], R: [766, 766, 766, 766, 766] },
    'N2O4/50-50': { pSource: 1500, T: [1700, 1750, 1800, 1850], gamma: [1.248, 1.249, 1.254, 1.260], cp: [0.726, 0.719, 0.708, 0.694], R: [112, 111, 111, 111] },
  };
  // NASA TM-107318 Table 6.1.1, RL10A-3-3A steady-state cycle prediction (NASA Lewis model output). Pressures
  // psia, temperatures degR, flows lb/s, densities lb/ft^3 (the oxidizer block's header prints "lb/cu.in", but
  // its values, 68-69, are LOX in lb/ft^3), enthalpies Btu/lb.
  var RL10A33A = {
    overall: { pc_injector_face: 475.5, thrust: 16412, of_inlet: 4.993, of_combustion: 5.055, isp: 445.6, fuel_flow: 6.161, ox_flow: 30.76 },
    chamber: { p_nozzle_stagnation: 473.5, T_combustion: 5816, cstar_efficiency: 0.9892, cstar_ideal_in_s: 93885, p_exit_ambient: 0.01, fuel_lox_heat: 40.36 },
    // [location, static p, total p, total T, mass flow, density, total enthalpy]
    fuel: [
      ['Fuel Tank', 27.68, 27.68, 38.60, null, 4.337, -105.1],
      ['Fuel Pump Inlet', 26.08, 27.19, 38.6, 6.161, 4.337, -105.1],
      ['Fuel Pump Interstage', 532.2, 534.8, 47.65, 6.118, 4.285, -68.21],
      ['Fuel Pump Discharge', 1058.9, 1067.3, 57.63, 6.082, 4.220, -27.84],
      ['Cooling Jacket Inlet', 1018.3, 1026.6, 57.94, 6.082, 4.185, -27.84],
      ['Cooling Jacket Exit', 816.8, 830.9, 384.2, 6.082, 0.3855, 1240.5],
      ['Turbine Inlet', 796.7, 813.8, 384.2, 6.056, 0.3767, 1240.5],
      ['Turbine Housing Exit', 562.2, 576.2, 361.1, 6.082, 0.2868, 1149.2],
      ['Fuel Injector Plenum', 537.9, 537.9, 359.4, 6.082, 0.2742, 1142.4],
    ],
    ox: [
      ['Oxygen Tank', 42.35, 42.35, 174.7, null, 69.07, 66.42],
      ['Ox Pump Inlet', 36.33, 39.96, 174.7, 30.76, 69.07, 66.42],
      ['Ox Pump Discharge', 601.5, 621.1, 178.6, 30.75, 69.02, 68.84],
      ['Oxid. Injector Plenum', 529.4, 539.3, 182.1, 30.75, 68.31, 70.15],
    ],
    // [stage, delta-head ft, volume flow gpm, speed rpm, torque lbf-in, efficiency]
    pumps: [['Fuel Pump 1st stage', 16858, 637.8, 31494, 645.5, 0.5854], ['Fuel Pump 2nd stage', 17901, 641.0, 31494, 700.7, 0.5686], ['LOX Pump', 1212, 199.9, 12598, 529.1, 0.6408]],
    turbine: { pr_ts: 1.402, p_exit_static: 580.6, T_exit: 360.9, dh: 92.02, eff: 0.7353, torque: 1577.8, velocity_ratio: 0.4581 },
    jacket: { dp_total: 195.7, dT: 326.3, heat: 7714.2, T_metal_max: 1500.8 },
    valves: { thrust_control_area: 0.004836, turbine_bypass_flow: 0.02634, ocv_area: 0.5783, ocv_primary: 28.10, ocv_bypass: 2.659 },
    table251: { chamber_diameter_in: 5.13, throat_diameter_in: 2.47, area_ratio: 61.0, pc_injector_face_static: 482.0, T_combustion: 5888, of: 5.26, mass_flow: 37.36, thrust: 16452, cstar_efficiency: 0.9892, cstar_in_s: 7824, isp: 440.3 },
  };
  var api = { SP8107_T1: SP8107_T1, SP8107_PUMPS: SP8107_PUMPS, SP8107_TURBINES: SP8107_TURBINES, SP8110_GAS: SP8110_GAS, RL10A33A: RL10A33A,
    sources: {
      SP8107: 'NASA SP-8107, Turbopump Systems for Liquid Rocket Engines (1974), NTRS 19750012398',
      SP8110: 'NASA SP-8110, Liquid Rocket Engine Turbines (1974), NTRS 19740026132',
      TM107318: 'NASA TM-107318, RL10A-3-3A Rocket Engine Modeling Project (1997), NTRS 19970010379',
    } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TurboData = api;
})(typeof self !== 'undefined' ? self : this);
