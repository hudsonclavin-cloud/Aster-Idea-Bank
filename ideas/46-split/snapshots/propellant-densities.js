/* Liquid propellant densities for idea 31 (Mixture). Hand-transcribed from the verbatim excerpts in
 * snapshots/density-sources.txt; every `quote` below is an exact substring of that file (mixture.test.mjs
 * checks this, and that `value` is the quoted number in kg/m^3). g/cm^3 x 1000 = kg/m^3; 68 F = 293.15 K;
 * 77 F = 298.15 K. `T` is the temperature the density belongs to, which is not always the temperature
 * thermo.inp assigns the reactant's enthalpy at; the kernel says so when they differ.
 * `cross` lists the independent values the primary is checked against (gap stated in the README). */
(function (root) {
  var DENSITIES = {
    components: {
      'O2(L)': { value: 1141.26, T: 90.17, src: 'NIST', quote: '90.1700\t0.101136\t1141.26',
        note: 'saturated liquid at the 90.17 K thermo.inp assigns O2(L)',
        cross: [{ src: 'SP125', value: 1142, quote: '-182     1142', note: 'Table 1-5, at the boiling point; the scanned page prints 1.142 g/cc, the PDF text layer drops the decimal point' }] },
      'H2(L)': { value: 70.8295, T: 20.27, src: 'NIST', quote: '20.2700\t0.101287\t70.8295',
        note: 'saturated para-hydrogen at 20.27 K (stored liquid hydrogen converts to para; normal hydrogen is the cross-check)',
        cross: [{ src: 'NIST', value: 70.9608, quote: '20.2700\t0.0983977\t70.9608', note: 'normal hydrogen' },
                { src: 'SP125', value: 71, quote: '-400.3   0.071', note: 'Table 1-5, at the boiling point' }] },
      'CH4(L)': { value: 422.391, T: 111.643, src: 'NIST', quote: '111.643\t0.101123\t422.391',
        note: 'saturated liquid at the 111.643 K thermo.inp assigns CH4(L)', cross: [] },
      'RP-1': { value: 810, T: 293.15, src: 'SP125', quote: '0.8 to', quote2: '0.82at', range: [800, 820],
        note: 'Table 1-4 gives a range, "0.8 to 0.82 at 68 F" (MIL-F-25576B); the midpoint is used and the range carried',
        cross: [{ src: 'TP2002', value: 820, quote: 'AFRL-1    is 0.82', note: 'specific gravity, temperature not stated' },
                { src: 'TP2002', value: 832, quote: 'RP-I: 0.832', note: 'specific gravity in Table 12, temperature not stated' }] },
      'N2O4(L)': { value: 1440, T: 293.15, src: 'SP125', quote: '111 at   1.44 at',
        note: 'Table 1-4, "1.44 at 68 F"; N2O4 boils at 70 F, so at 298.15 K it is a liquid only under pressure',
        cross: [{ src: 'PubChem', value: 1450, quote: '1.45 g/cu cm at 20 °C', note: 'HSDB' },
                { src: 'PubChem', value: 1493, quote: '1.493 @ 20°C', note: 'DOE PAC database; disagrees with HSDB and SP-125' }] },
      'CH6N2(L)': { value: 878, T: 293.15, src: 'SP125', quote: '8.S at    0.878 at',
        note: 'MMH, Table 1-4, "0.878 at 68 F"',
        cross: [{ src: 'PubChem', value: 874, T: 298.15, quote: '0.874 at 25 °C', note: 'HSDB, at 25 C' }] },
      'C2H8N2(L),UDMH': { value: 789, T: 293.15, src: 'SP125', quote: '17.6 at 0.789 at',
        note: 'UDMH, Table 1-4, "0.789 at 68 F"',
        cross: [{ src: 'PubChem', value: 791, T: 295.15, quote: '0.791 at 22 °C/4 °C', note: 'HSDB, specific gravity to water at 4 C' }] },
      'N2H4(L)': { value: 1010, T: 293.15, src: 'SP125', quote: '2.8 at   1.01 at',
        note: 'hydrazine, Table 1-4, "1.01 at 68 F"',
        cross: [{ src: 'PubChem', value: 1003.6, T: 298.15, quote: '1.0036 at 25 °C/4 °C', note: 'HSDB, at 25 C' }] },
      'C2H5OH(L)': { value: 789.3, T: 293.15, src: 'PubChem', quote: '0.7893 g/cu cm at 20 °C',
        note: 'ethanol, HSDB via PubChem (SP-125 lists only 92.5 % ethyl alcohol)',
        cross: [{ src: 'PubChem', value: 790, quote: '0.79 at 68 °F (USCG, 1999)', note: 'CAMEO' }] },
      'H2O(L)': { value: 997.048, T: 298.15, src: 'NIST', quote: '298.150\t0.101325\t997.048',
        note: 'liquid water at 298.15 K and 1 atm', cross: [] },
      'H2O2(L)': null
    },
    // Blends whose density was measured as a blend. A blend not listed here gets a volume-additive estimate.
    blends: [
      { name: 'HTP-98', parts: { 'H2O2(L)': 0.98, 'H2O(L)': 0.02 }, value: 1432, T: 298.15, src: 'SP125',
        quote: '0.043 at 1.432 at', note: '98 % hydrogen peroxide, Table 1-4, "1.432 at 77 F"', cross: [] },
      // Added by the independent review: SP-125 Table 1-4 also measures the 95 % grade (same fetched page).
      { name: 'HTP-95', parts: { 'H2O2(L)': 0.95, 'H2O(L)': 0.05 }, value: 1414, T: 298.15, src: 'SP125',
        quote: '0.05 at   1.414 at', note: '95 % hydrogen peroxide, Table 1-4, "1.414 at 77 F"', cross: [] }
    ],
    sources: {
      SP125: 'NASA SP-125, Huzel & Huang, Design of Liquid Propellant Rocket Engines, 2nd ed. (1971), Tables 1-4 and 1-5 (NTRS 19710019929)',
      NIST: 'NIST Chemistry WebBook SRD 69, Thermophysical Properties of Fluid Systems (retrieved 2026-10-31)',
      PubChem: 'PubChem PUG-View "Density" records (HSDB, CAMEO, DOE PAC), retrieved 2026-10-31',
      TP2002: 'NASA/TP-2002-211729, Bai, Dumbacher & Cole (2002), NTRS 20020052436'
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = DENSITIES;
  else root.PROPELLANT_DENSITIES = DENSITIES;
})(typeof self !== 'undefined' ? self : this);
