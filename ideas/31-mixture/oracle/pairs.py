"""Propellant pairs used by the oracle scripts (oracle-only; the page has its own copy in presets.js,
and mixture.test.mjs checks that the two agree). Reactant names are NASA Glenn thermo.inp names;
temperatures are the ones thermo.inp assigns (cryogens at their listed T, storables at 298.15 K)."""

PAIRS = {
    "LOX/LH2":        {"ox": [("O2(L)", 1.0, 90.17)], "fuel": [("H2(L)", 1.0, 20.27)], "of": (2.0, 12.0)},
    "LOX/RP-1":       {"ox": [("O2(L)", 1.0, 90.17)], "fuel": [("RP-1", 1.0, 298.15)], "of": (1.0, 4.0)},
    "LOX/CH4":        {"ox": [("O2(L)", 1.0, 90.17)], "fuel": [("CH4(L)", 1.0, 111.643)], "of": (1.5, 5.0)},
    "N2O4/MMH":       {"ox": [("N2O4(L)", 1.0, 298.15)], "fuel": [("CH6N2(L)", 1.0, 298.15)], "of": (0.8, 4.0)},
    "N2O4/UDMH":      {"ox": [("N2O4(L)", 1.0, 298.15)], "fuel": [("C2H8N2(L),UDMH", 1.0, 298.15)], "of": (1.0, 4.5)},
    "N2O4/A-50":      {"ox": [("N2O4(L)", 1.0, 298.15)],
                       "fuel": [("N2H4(L)", 0.5, 298.15), ("C2H8N2(L),UDMH", 0.5, 298.15)], "of": (0.8, 3.5)},
    "N2O4/N2H4":      {"ox": [("N2O4(L)", 1.0, 298.15)], "fuel": [("N2H4(L)", 1.0, 298.15)], "of": (0.6, 2.5)},
    "LOX/Ethanol-75": {"ox": [("O2(L)", 1.0, 90.17)],
                       "fuel": [("C2H5OH(L)", 0.75, 298.15), ("H2O(L)", 0.25, 298.15)], "of": (0.6, 2.5)},
    "HTP-98/RP-1":    {"ox": [("H2O2(L)", 0.98, 298.15), ("H2O(L)", 0.02, 298.15)],
                       "fuel": [("RP-1", 1.0, 298.15)], "of": (4.0, 10.0)},
    "GOX/RP-1":       {"ox": [("O2", 1.0, 298.15)], "fuel": [("RP-1", 1.0, 298.15)], "of": (1.3, 2.3)},
}
