/* Measured characteristic velocity of a real chamber, for the page's "model vs reality" marks and the tests.
 * NASA/TP-2002-211729 (Bai, Dumbacher & Cole, 2002), Tables 11 and 13: gaseous oxygen / RP-1 runs in MSFC's
 * 1,000-lbf test chamber. Transcribed by script from the verbatim lines in oracle/published-excerpts.txt
 * (each `lines` entry below is one of those lines). Units as published: ft/s and psig. */
(function (root) {
  var MEASURED = {
    "source": "NASA/TP-2002-211729, Tables 11 and 13 (NTRS 20020052436)",
    "propellant": "GOX / RP-1",
    "lines": {
      "table11": {
        "mr": "Mixture Ratio                1.92                  2                      1.9                 2.19",
        "th": "C* (theory)            5,893 (100%)          5,919 (100%)          5,887 (100%)           5,919 (100%)",
        "ex": "C* (experiment)       5,359 (90.9%)          5,406 (91.3%)         5,350 (90.9%)          5,465 (92.3%)",
        "pc": "Pc(psig)                  157.74                155.63                157.56                  154.4"
      },
      "table13": {
        "mr": "Mixture Ratio                 2.08                2.09                   2.08                     2.10",
        "th": "C* (theory)           5,922 (100%)        5,923 (100%)            6,006 (100%)               5,999 (100%)",
        "ex": "C* (experiment) 5,432.10 (91.7%) 5,446.70 (91.96%)               5,486.40 (91.3%)          5,496.20 (91.6%)",
        "pc": "Pc(psig)                     156.75             158.10                 159.28                    160.25"
      }
    },
    "runs": [
      {
        "test": 18,
        "mixture_ratio": 1.92,
        "pc_psig": 157.74,
        "cstar_theory_ft_s": 5893.0,
        "cstar_measured_ft_s": 5359.0
      },
      {
        "test": 20,
        "mixture_ratio": 2.0,
        "pc_psig": 155.63,
        "cstar_theory_ft_s": 5919.0,
        "cstar_measured_ft_s": 5406.0
      },
      {
        "test": 17,
        "mixture_ratio": 1.9,
        "pc_psig": 157.56,
        "cstar_theory_ft_s": 5887.0,
        "cstar_measured_ft_s": 5350.0
      },
      {
        "test": 35,
        "mixture_ratio": 2.19,
        "pc_psig": 154.4,
        "cstar_theory_ft_s": 5919.0,
        "cstar_measured_ft_s": 5465.0
      },
      {
        "test": 22,
        "mixture_ratio": 2.08,
        "pc_psig": 156.75,
        "cstar_theory_ft_s": 5922.0,
        "cstar_measured_ft_s": 5432.1
      },
      {
        "test": 23,
        "mixture_ratio": 2.09,
        "pc_psig": 158.1,
        "cstar_theory_ft_s": 5923.0,
        "cstar_measured_ft_s": 5446.7
      }
    ],
    "assumptions": [
      "Pc is gauge (psig); ambient is taken as 1 atm, 14.696 psi [Likely]",
      "the gaseous oxygen is taken at 298.15 K (the report does not state its temperature) [Likely]"
    ]
  };
  if (typeof module === 'object' && module.exports) module.exports = MEASURED;
  else root.MEASURED_CSTAR = MEASURED;
})(typeof self !== 'undefined' ? self : this);
