# ED Reboost Energy Bound Findings

Date: 2026-07-12
HEAD: `5cbaa5c`
Config source: `params/service_mxer_draft.json` at `5cbaa5c`.
Scope line: this is an ENERGY bound, not a Lorentz-force thrust model. Plasma density, field geometry, current collection, arcing, and eclipse are folded into the efficiency and duty brackets [FLAGGED]. Angular-momentum restoration is assumed co-managed with energy restoration via thrust-profile shaping [FLAGGED - standard MXER assumption]. The full orbit-integrated ed_reboost.py remains the open workstream named by the external review; this bound neither replaces nor prejudges it.

Reference config: CoM perigee 600 km / apogee 7418 km, L_half 150 km, v_tip 1.071031 km/s, catch altitude 450 km, payload class 5.0 t.

ENERGY SUMMARY
- r_catch = 6821.0 km; r_release = 7121.0 km; a_transfer = 24642.5 km
- E_in = -29,218,590 J/kg; E_out = -8,087,653 J/kg
- dE_throw = 1.056547e+11 J
- delta-v JSON = 2.142062 km/s; recomputed = 2.142062 km/s

Cadence intervals: 24 t/yr = 4.8 catches/yr = 76.1 days; 56 t/yr = 11.2 catches/yr = 32.6 days.

RECOVERY-TIME GRID
| eta | duty | installed power kW | t_rec days | supportability |
|---:|---:|---:|---:|---|
| 0.3 | 0.3 | 50 | 271.7 | neither |
| 0.3 | 0.3 | 100 | 135.9 | neither |
| 0.3 | 0.3 | 250 | 54.3 | 24 only |
| 0.3 | 0.3 | 500 | 27.2 | both |
| 0.3 | 0.5 | 50 | 163.0 | neither |
| 0.3 | 0.5 | 100 | 81.5 | neither |
| 0.3 | 0.5 | 250 | 32.6 | both |
| 0.3 | 0.5 | 500 | 16.3 | both |
| 0.5 | 0.3 | 50 | 163.0 | neither |
| 0.5 | 0.3 | 100 | 81.5 | neither |
| 0.5 | 0.3 | 250 | 32.6 | both |
| 0.5 | 0.3 | 500 | 16.3 | both |
| 0.5 | 0.5 | 50 | 97.8 | neither |
| 0.5 | 0.5 | 100 | 48.9 | 24 only |
| 0.5 | 0.5 | 250 | 19.6 | both |
| 0.5 | 0.5 | 500 | 9.8 | both |
| 0.7 | 0.3 | 50 | 116.5 | neither |
| 0.7 | 0.3 | 100 | 58.2 | 24 only |
| 0.7 | 0.3 | 250 | 23.3 | both |
| 0.7 | 0.3 | 500 | 11.6 | both |
| 0.7 | 0.5 | 50 | 69.9 | 24 only |
| 0.7 | 0.5 | 100 | 34.9 | 24 only |
| 0.7 | 0.5 | 250 | 14.0 | both |
| 0.7 | 0.5 | 500 | 7.0 | both |

MINIMUM INSTALLED POWER FOR 56 T/YR
| eta | duty | minimum installed power kW |
|---:|---:|---:|
| 0.3 | 0.3 | 416.6 |
| 0.3 | 0.5 | 250.0 |
| 0.5 | 0.3 | 250.0 |
| 0.5 | 0.5 | 150.0 |
| 0.7 | 0.3 | 178.6 |
| 0.7 | 0.5 | 107.1 |

POWER-SYSTEM MASS CHECK
| installed power kW | array specific power W/kg | array mass t | fraction of 30 t hub allowance |
|---:|---:|---:|---:|
| 50 | 50 | 1.00 | 3.3% |
| 50 | 100 | 0.50 | 1.7% |
| 100 | 50 | 2.00 | 6.7% |
| 100 | 100 | 1.00 | 3.3% |
| 250 | 50 | 5.00 | 16.7% |
| 250 | 100 | 2.50 | 8.3% |
| 500 | 50 | 10.00 | 33.3% |
| 500 | 100 | 5.00 | 16.7% |

LOAD-BEARING PARAMETERS
- R_GEO_KM = 42164 km [FLAGGED - GEO radius convention inherited from in-space fork solver]
- P_installed = 50, 100, 250, 500 kW [FLAGGED - candidate power-system classes; 250 kW ~ ISS-array order]
- eta_chain = 0.3, 0.5, 0.7 [FLAGGED - electrical-to-orbital-energy efficiency including tether I2R, contactor, PMAD]
- duty = 0.3, 0.5 [FLAGGED - usable-thrust fraction: plasma density along ellipse, eclipse, thrust-direction windows]
- ED thrust is most effective near perigee where plasma is densest; directionally favorable for restoring a perigee-throw ellipse but not quantified here [FLAGGED]
- array specific power = 50, 100 W/kg [FLAGGED - array-class bracket; excludes PMAD, thermal, tether-current hardware]
- supportable means t_rec <= inter-catch interval at the 5 t payload class [Certain arithmetic criterion]

Neutral closing paragraph:
At 24 t/yr, supportable cells are: 250 kW eta 0.3 duty 0.3; 500 kW eta 0.3 duty 0.3; 250 kW eta 0.3 duty 0.5; 500 kW eta 0.3 duty 0.5; 250 kW eta 0.5 duty 0.3; 500 kW eta 0.5 duty 0.3; 100 kW eta 0.5 duty 0.5; 250 kW eta 0.5 duty 0.5; 500 kW eta 0.5 duty 0.5; 100 kW eta 0.7 duty 0.3; 250 kW eta 0.7 duty 0.3; 500 kW eta 0.7 duty 0.3; 50 kW eta 0.7 duty 0.5; 100 kW eta 0.7 duty 0.5; 250 kW eta 0.7 duty 0.5; 500 kW eta 0.7 duty 0.5. At 56 t/yr, supportable cells are: 500 kW eta 0.3 duty 0.3; 250 kW eta 0.3 duty 0.5; 500 kW eta 0.3 duty 0.5; 250 kW eta 0.5 duty 0.3; 500 kW eta 0.5 duty 0.3; 250 kW eta 0.5 duty 0.5; 500 kW eta 0.5 duty 0.5; 250 kW eta 0.7 duty 0.3; 500 kW eta 0.7 duty 0.3; 250 kW eta 0.7 duty 0.5; 500 kW eta 0.7 duty 0.5. Minimum installed power for 56 t/yr by eta/duty pair: eta 0.3/duty 0.3: 416.6 kW; eta 0.3/duty 0.5: 250.0 kW; eta 0.5/duty 0.3: 250.0 kW; eta 0.5/duty 0.5: 150.0 kW; eta 0.7/duty 0.3: 178.6 kW; eta 0.7/duty 0.5: 107.1 kW.

