/* Propellant presets and the component list for the Mixture page. Names are NASA Glenn thermo.inp names.
 * Temperatures are the ones thermo.inp assigns (cryogens at their listed temperature, storables at
 * 298.15 K); mixture.test.mjs checks them against the excerpt and checks every preset that oracle/pairs.py
 * also lists has the same components, fractions and O/F range, because those ranges are what the kernel
 * was compared with NASA CEA over. No preset carries a remembered "typical" O/F or chamber pressure: the
 * page starts each preset at its computed maximum-c* O/F and at an arbitrary 100 bar. */
(function (root) {
  var PSI = 4.4482216152605 / (0.0254 * 0.0254); // Pa per lbf/in^2, from the definitions of lbf and inch
  var PRESETS = [
    { id: 'lox-lh2', label: 'LOX / LH2', oxidizer: [{ name: 'O2(L)', w: 1, T: 90.17 }], fuel: [{ name: 'H2(L)', w: 1, T: 20.27 }], ofRange: [2, 12] },
    { id: 'lox-rp1', label: 'LOX / RP-1', oxidizer: [{ name: 'O2(L)', w: 1, T: 90.17 }], fuel: [{ name: 'RP-1', w: 1, T: 298.15 }], ofRange: [1, 4] },
    { id: 'lox-ch4', label: 'LOX / methane', oxidizer: [{ name: 'O2(L)', w: 1, T: 90.17 }], fuel: [{ name: 'CH4(L)', w: 1, T: 111.643 }], ofRange: [1.5, 5] },
    { id: 'nto-mmh', label: 'N2O4 / MMH', oxidizer: [{ name: 'N2O4(L)', w: 1, T: 298.15 }], fuel: [{ name: 'CH6N2(L)', w: 1, T: 298.15 }], ofRange: [0.8, 4] },
    { id: 'nto-udmh', label: 'N2O4 / UDMH', oxidizer: [{ name: 'N2O4(L)', w: 1, T: 298.15 }], fuel: [{ name: 'C2H8N2(L),UDMH', w: 1, T: 298.15 }], ofRange: [1, 4.5] },
    { id: 'nto-a50', label: 'N2O4 / Aerozine 50', oxidizer: [{ name: 'N2O4(L)', w: 1, T: 298.15 }],
      fuel: [{ name: 'N2H4(L)', w: 0.5, T: 298.15 }, { name: 'C2H8N2(L),UDMH', w: 0.5, T: 298.15 }], ofRange: [0.8, 3.5] },
    { id: 'nto-n2h4', label: 'N2O4 / hydrazine', oxidizer: [{ name: 'N2O4(L)', w: 1, T: 298.15 }], fuel: [{ name: 'N2H4(L)', w: 1, T: 298.15 }], ofRange: [0.6, 2.5] },
    { id: 'lox-eth75', label: 'LOX / 75 % ethanol', oxidizer: [{ name: 'O2(L)', w: 1, T: 90.17 }],
      fuel: [{ name: 'C2H5OH(L)', w: 0.75, T: 298.15 }, { name: 'H2O(L)', w: 0.25, T: 298.15 }], ofRange: [0.6, 2.5] },
    { id: 'htp-rp1', label: '98 % H2O2 / RP-1', oxidizer: [{ name: 'H2O2(L)', w: 0.98, T: 298.15 }, { name: 'H2O(L)', w: 0.02, T: 298.15 }],
      fuel: [{ name: 'RP-1', w: 1, T: 298.15 }], ofRange: [4, 10] },
    { id: 'gox-rp1', label: 'GOX / RP-1 (NASA MSFC test chamber)', oxidizer: [{ name: 'O2', w: 1, T: 298.15 }], fuel: [{ name: 'RP-1', w: 1, T: 298.15 }],
      ofRange: [1.3, 2.3], pc: 175 * PSI, measured: true,
      note: 'NASA/TP-2002-211729 tested this pair in a 1,000-lbf chamber; its Table 3 gives theory at 175 psia, which is where this preset starts.' },
  ];
  // Components offered in the blend editor, with plain names. Either side may hold any of them.
  var COMPONENTS = [
    { name: 'O2(L)', label: 'liquid oxygen', T: 90.17 },
    { name: 'O2', label: 'gaseous oxygen', T: 298.15 },
    { name: 'N2O4(L)', label: 'nitrogen tetroxide', T: 298.15 },
    { name: 'H2O2(L)', label: 'hydrogen peroxide', T: 298.15 },
    { name: 'H2(L)', label: 'liquid hydrogen', T: 20.27 },
    { name: 'CH4(L)', label: 'liquid methane', T: 111.643 },
    { name: 'RP-1', label: 'RP-1 kerosene', T: 298.15 },
    { name: 'CH6N2(L)', label: 'MMH', T: 298.15 },
    { name: 'C2H8N2(L),UDMH', label: 'UDMH', T: 298.15 },
    { name: 'N2H4(L)', label: 'hydrazine', T: 298.15 },
    { name: 'C2H5OH(L)', label: 'ethanol', T: 298.15 },
    { name: 'H2O(L)', label: 'water', T: 298.15 },
  ];
  var api = { PRESETS: PRESETS, COMPONENTS: COMPONENTS, PSI: PSI, PC_DEFAULT: 100e5, PC_MIN: 1e5, PC_MAX: 300e5 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MixturePresets = api;
})(typeof self !== 'undefined' ? self : this);
