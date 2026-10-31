# Closing In
> Fly the last two months to the asteroid: the braking burns, OSIRIS-REx's approach waypoints, first sight in the camera, and holding station where sunlight outpulls gravity. Re-flown from JPL Horizons' reconstruction, the model reproduces OSIRIS-REx's approach to Bennu: after 61 days AAM-1 comes 32 km short of its published 175,000 km with its angles inside Table 1's 0.1° rounding, measured burns agree with AAS 19-035 Table 3 to 0.0006 m/s, the burns it plans come within 0.03 to 7%, and fits to the first orbit return Bennu's mass within 1% (0.42% over 10 days). The gap to reality is 3.0 km of drift over two weeks (4.4 km over 17 days), where JPL's own predictions held to 500 m. On the chain, Apophis arrives at 4.16 km/s, so the first burn alone is 4,012 m/s (1,545 kg of propellant), and the whole arrival needs 1,654 kg on NEAR Shoemaker's 487 kg dry mass, against the 318 kg NEAR carried. The camera sees Apophis 11.2 days before that burn, and holding 18.6 km off costs 6.8 mm/s a day.

**Kind:** explorable tool
**For:** Aster
**Run:** open `ideas/42-closing-in/index.html` in a browser (classic scripts, `file://` works, no network; it also opens on a `#h=` link carrying idea 41's or this page's handoff). Tests from the bank root: `node --test ideas/42-closing-in/closing.test.mjs` (18 tests, about 3 s; one runs idea 41's own parser on its committed sample) and `node ideas/42-closing-in/ui-check.mjs` (51 checks in headless Chromium; `check.mjs` runs it for `tools/check.mjs`). Regeneration, none needed to run anything: `bash ideas/42-closing-in/oracle/fetch-sources.sh` in an empty directory, then `node ideas/42-closing-in/build-data.mjs <that directory>`, `node ideas/42-closing-in/build-sample.mjs`, `node ideas/42-closing-in/oracle/build-cases.mjs`, and the Python oracle `python3 anh3bp_oracle.py cases.json anh3bp-oracle.json` (numpy and scipy, in a throw-away venv).
**Made by:** Deadband

## What it is

Idea 42 is module 12 of the twenty in *The Long Way Round* (ideas 31 to 50, launch to asteroid and back). Idea 40 delivered the spacecraft to the asteroid at its arrival speed (aimed at the centre: a collision course), and left two things to this module. One is the approach's optical navigation, under its `target_knowledge` refusal. The other is everything after: braking, the slow approach, and the stand-off. Idea 41 said a command takes 11.5 minutes to get there and back. This page flies the arrival. You can:

- **Choose the case.** Either the chain (idea 41's handoff: Apophis, 9 May 2028, 4.16 km/s), or **OSIRIS-REx at Bennu in 2018**, started from JPL Horizons' reconstructed state on 1 August 2018 (3.07 million km out, 701 m/s) and flown with the same plan. That makes the page's own model visible against the real flight.
- **Choose the spacecraft.** NEAR Shoemaker's engine and tanks (NSSDCA), or a custom one (dry mass, propellant, thrust, specific impulse). Choose whether the tanks are as built or sized to the job; idea 40's cruise-correction allowance (mean, 99th, 99.73th percentile); and the sunlit area per mass (OSIRIS-APEX's published value, the value fitted here to OSIRIS-REx's first orbit, or none).
- **Choose the asteroid's mass.** SBDB's measured GM where it exists (or SBDB's published density times the body's volume where SBDB has a density but no GM, as for Didymos), the OSIRIS-APEX team's 1.36 to 4.37 m³/s² range for Apophis, or a density of your own times the body's volume.
- **Choose the approach.** OSIRIS-REx's waypoints (AAS 19-035 Table 1, at the same days after the first burn) or a single braking leg. Set the first burn's distance, how many days ahead the ground designs a burn, and the late-update turnaround.
- **Choose the stand-off.** Its distance and direction (OSIRIS-REx's arrival point, sunward or the terminator), the deadband, and the stay. You can also scan circular orbits at fourteen radii for 30 days each.
- **Read** the first burn and the whole approach in m/s, the propellant and a mass ledger, the stand-off date, the Hill radius, sunlight against gravity, the station-keeping cost per day and its burn cadence, how many days before the first burn the camera sees the asteroid, the command round trip, and the knowledge before the camera. Each carries a confidence chip, and every refusal is shown.
- **Watch** five charts:
  - speed against distance, beside OSIRIS-REx as flown and JPL's OSIRIS-APEX plan at Apophis;
  - distance against time;
  - gravity, sunlight and the Sun's tide against distance from the asteroid;
  - the corridor seen from the orbit pole;
  - the deadband flown.

  **Tap any burn** to mark it.
- **Check it against the oracles** (19 rows, computed live): Horizons' magnitudes, AAS 19-035's maneuvers as flown and as designed, the 61-day and 17-day ballistic arcs, and Bennu's GM fitted to Orbital A.
- **Export the handoff** for module 43 (copy, download, link).

## Why I made it

- **The series needs it next.** `queue/SERIES_LONG_WAY_ROUND.md`, row 42: "Arrival at the asteroid: braking, approach, relative motion near a small body, its Hill sphere, station-keeping at stand-off", taking the arrival state and the asteroid and handing on the spacecraft at stand-off. Idea 40's own refusal (`target_knowledge`): "the approach (optical navigation) that cuts the target's uncertainty is module 42's". Idea 41's README, *Where it would land*: "module 42 (Closing In) takes `arrival_link` (the round trip sets the approach's autonomy)".
- **What a person decides with it.**
  - How much of the propellant budget the arrival eats. On the chain's transfer it is nearly all of it, which sends the designer back to idea 39 for a slower arrival.
  - Where to start braking, and whether a finite burn fits.
  - Whether the camera sees the target early enough for the ground to aim the big burn, or the spacecraft must navigate itself.
  - How far out to hold station, what holding costs, and how often it needs a burn.
  - Which orbits are worth trying once the mass is known.
- **For Aster.** Aster's ΔV stack (`src/v2/porkchop/delta-v.ts` at `62ddb17`) carries the rendezvous as one number (the arrival v-infinity) and the stay as a flat 150 m/s (line 5). This module flies both and shows what they are made of.

Alternatives weighed. (1) *Rendezvous Δv = v-infinity and stop.* That is Aster's screening number. Rejected as the module: it says nothing about when, where, how long, or whether the camera sees the target first. It is kept as the check that the planned burns sum to it (4,155.3 against 4,156.1 m/s). (2) *Hill's (Clohessy-Wiltshire) equations, linear.* Rejected for the flight: the approach starts 3 million km out, where the tide is far from linear over 60 days. Kept as the oracle: AAS 24-063's augmented Hill problem, integrated independently in Python, agrees with this kernel's exact-tide flight to 0.1 to 12 mm. (3) *Invent an approach plan.* Rejected. **Built: OSIRIS-REx's own plan** (AAS 19-035 Table 1), and the reconstructed flight in Horizons to hold the model to. (4) *A gravity field from a shape model.* That is module 43's job, and it is refused here.

## How it works

**Frame and forces** (`closing.js` `accel()`, `fly()`). Everything is relative to the asteroid in non-rotating ICRF axes, with time in TDB seconds past J2000. The asteroid flies about the Sun on a conic from idea 40's arrival state (idea 39's `propagate()`, snapshotted unmodified). The forces on the spacecraft are:
- the asteroid as a point mass;
- the Sun's tide, exact: −μ☉(r_a + ρ)/|r_a + ρ|³ + μ☉ r_a/|r_a|³, with μ☉ from Aster via idea 39;
- sunlight on a flat absorber: P(1 au) = L/(4π au² c) (idea 40's formula, coast.js:179; L from NSSDCA through idea 40), times area per mass, times (au/r)², cut off in the asteroid's cylindrical shadow.

Integration is idea 40's Dormand-Prince 5(4) (`dopri()`, snapshotted unmodified), at a relative tolerance of 1e-11. Directions are given in AAS 19-035's Sun Anti-Momentum (SAM) frame (p. 4): x toward the Sun, z against the asteroid's orbital angular momentum. Solar latitude and longitude are its angles, and the phase angle is the angle from x.

**The approach** (`approach()`, `aim()`).
- Idea 40's arrival is aimed at the asteroid's centre. It is flown backwards without the asteroid's pull (which bends a 4 km/s path by about 1e-8 rad) to where the incoming arc is at the first-burn distance (175,000 km, AAS 19-035 Table 1's AAM-1). On the chain that is 11.7 h before the nominal arrival.
- Each burn aims at the next waypoint: a distance, solar latitude and longitude at a time. The waypoints are Table 1's AAM-2 (6,500 km), AAM-3 (250 km), AAM-3a, AAM-4 and M0P, at the same days after AAM-1 as OSIRIS-REx flew them. AAM-2a was waived in flight (p. 17), so it is left out.
- Aiming is by Newton iteration on the initial velocity, with a finite-difference Jacobian and 40's `inv3()`, to 1 m.
- The last burn stops the spacecraft at the stand-off point, fixed in the rotating SAM frame (velocity ω × r). The default is 18.6 km at 22.3°/89.6°, OSIRIS-REx's arrival point.

**Burns and mass.**
- Burns are impulsive for aiming. Their length is T = (m₀ v_e/F)(1 − e^(−Δv/v_e)), with v_e = Isp·g₀ and g₀ = 9.80665 m/s² (exact by definition).
- The distance covered while braking straight down from v₀ is s = v₀T − v_e (m₀/ṁ)(1 − u + u ln u), with u = m₁/m₀. This closed form is derived here and checked against an RK4 in the tests.
- The main engine fires above 1 m/s and the small thrusters below.
- NEAR Shoemaker (NSSDCA 1996-008A): 450 N main engine, 21 N thrusters, 209 kg of hydrazine and 109 kg of NTO, and "a total delta-V potential of 1450 m/s". The facts-in-brief "Mass: 487 kg" is read as dry: 487 + 318 = 805, and 1450/(g₀ ln(805/487)) = 294.2 s. Read as a launch mass it would imply 140 s, too low for any hydrazine engine. So 294.2 s is an effective specific impulse.
- The ledger runs idea 40's TCMs (99th percentile, 116.6 m/s), then each burn, then the stay.

**Seeing it** (`detection()`).
- The brightness is Horizons' asteroid law: APmag = H + 5 log₁₀(Δ) + 5 log₁₀(r) − 2.5 log₁₀((1−G)φ₁ + Gφ₂) (Horizons manual).
- The phase functions are φᵢ = exp(−Aᵢ tan(α/2)^Bᵢ) with A = 3.33, 1.87 and B = 0.63, 1.22 (Bowell et al. 1989). Those four coefficients are known here from secondary sources, and the tests pin them by reproducing Horizons' own APmag.
- H and G come from SBDB.
- The detection threshold is Bennu's V when OSIRIS-REx's PolyCam first imaged it (17 Aug 2018, ~2,184,000 km, AAS 19-035 p. 5), by the same law from Horizons' geometry: 13.084.
- After first sight, the line of sight is known to the range × 13.5 µrad (PolyCam's pixel, Table 2) × 0.1 pixel (the achieved centroiding, p. 7).
- If the asteroid is already that bright where the computed incoming arc begins (10 to 60 days before the first burn), the lead is a lower bound: the page shows "≥" and the handoff sets `lead_is_lower_bound`. If it first reaches it after the first burn, the page says so ("days after").
- Before first sight, the spacecraft is known as idea 40 left it (6.13 km), and Apophis as its orbit allows: Horizons' 1-sigma at the arrival epoch is 1.24 km.

**The ground loop.** A burn needs its final design 5 to 7 days ahead (AAS 19-035 p. 11-12), and proximity operations use 24-hour late updates. Both are settings, plus idea 41's round-trip light time. First sight later than the design lead is refused as `autonomy`; a deadband cycle shorter than the late update is refused as `station_keeping`.

**Regimes** (`regimes()`). The Hill radius is d(μ/3μ☉)^(1/3). AAS 24-063's length unit is DU = d(μ/μ☉)^(1/3), with β̃ = (sunlight)/(μ☉ε/d²) (its eq. 2b with G₁ = P(1 au) au², which is 1.6% above the 1e8 kg km³/s²/m² it rounds to). Its dark-side equilibrium solves 1/x² = β̃ + 3x by bisection, and the distance where gravity equals sunlight is √(μ/a_SRP). That equilibrium is a point of AAS 24-063's circular ANH3BP, which has no shadow: it lies on the anti-Sun axis, inside the asteroid's shadow, where this model (and the real spacecraft) has no sunlight, so it is reported as their number, not as a place to hold station.

**Holding station** (`hover()`, `deadband()`).
- A point fixed in the rotating frame needs an inertial acceleration of ω̇ × r + ω × (ω × r). The control is that minus what gravity, the tide and sunlight provide, and its size times one day is the cost.
- The deadband is flown under every force. At the wall the spacecraft is pushed out of, a burn sends it back along the control direction fast enough to coast to the far wall, and walks any sideways offset out over the cycle. That gives 2√(2aL) every 2√(2L/a).
- The flown cost is compared with the control acceleration averaged over the flight, because sunlight grows as Apophis heads toward perihelion.

**Orbit scan** (`orbitScan()`). Circular orbits at 14 radii, from 1.5 radii out to the Hill radius, are flown in the terminator plane (normal toward the Sun) and in the noon-midnight plane for 30 days each. Each ends as impact, escape (beyond the Hill radius) or survival.

**Planets.** None. Idea 41's weekly Earth range sets the Earth's tide (μ⊕/ρ³) against the Sun's at the asteroid (μ☉/d³, with d the asteroid's distance from the Sun that week on idea 39's conic) over the approach and the stay; above 1% it is refused as `planets`.

**Importing idea 41's handoff** (`importSignal()`). It is checked for consistency, not re-flown, because ideas 40 and 41's kernels and ephemerides are 420 KB and 10 s:
- the v-infinity vector equals the spacecraft minus the target velocity, and its magnitude agrees;
- the arrival is within 100 km of the target;
- the UTC matches the TDB;
- the link is at the arrival epoch, the one-way light time is the range over c, and the round trip is twice the one-way;
- the comms timeline, idea 40's covariance, and 41's own `spacecraft` and `uplink` refusals are present.

The tests run idea 41's own `parseHandoff` on its committed sample. Idea 40's handoff is refused with a pointer to idea 41.

**Handoff schema (version 1, `from: "42-closing-in"`).** `handoff.json` is the sample: idea 41's committed handoff with this page's defaults.

| inputs | |
|---|---|
| `signal_handoff` | idea 41's handoff, whole (and through it 40's and 39's) |
| `case` | `null`, or `"orex2018"` for the as-flown Bennu case |
| `settings` | `{craft, dry_kg, propellant_kg, thrust_N, smallThrust_N, isp_s, tanks, tcm, am_m2_kg, cr, gm, gmCase, density_kg_m3, template, firstBurnRange_m, directDays, standoff_m, standoffLat_deg, standoffLon_deg, box_m, simDays, stayDays, groundLoopDays, lateUpdateHours, detectV, scan}` |

| outputs | units | confidence |
|---|---|---|
| `standoff_state` `{tdb_s_past_j2000, utc, frame, r_m, v_m_s, sam {range_m, lat_deg, lon_deg, phase_deg}, asteroid_heliocentric {r_m, v_m_s}, spacecraft_heliocentric}` | s, m, m/s, deg | derived |
| `body` `{designation, name, GM_m3_s2, GM_range_m3_s2, GM_confidence, GM_source, radius_m, radius_confidence, bulk_density_kg_m3, rotation_h, H, G, surface_gravity_m_s2, escape_speed_m_s, hill_radius_m, sun_distance_m}` | m³/s², m, kg/m³, h | measured or assumed |
| `environment` `{srp_accel_m_s2, gravity/tide/srp_at_standoff_m_s2, gravity_equals_srp_m, anh3bp_length_unit_m, anh3bp_beta, dark_side_equilibrium_m, area_per_mass_m2_kg}` | m/s², m | derived |
| `approach` `{template, first_burn_utc, standoff_utc, duration_s, total_dv_m_s, burns[{name, utc, tdb, range_m, lat_deg, lon_deg, dv_m_s, dv_vec_m_s, speed_before_m_s, engine, propellant_kg, duration_s}], legs_shorter_than_ground_loop}` | s, m, deg, m/s, kg | derived |
| `mass` `{isp_s, dry_kg, propellant_loaded_kg, launch_kg, arrival_kg, standoff_kg, end_of_stay_kg, required_propellant_kg, required_dv_m_s, tcm_dv_m_s, tanks}` | kg, s, m/s | assumed |
| `station_keeping` `{point_sam, control_accel_m_s2, dv_per_day_m_s, box_m, cycle_s, dv_per_cycle_m_s, stay_days, stay_dv_m_s, simulated}` | m/s², m/s, m, s | derived |
| `navigation` `{spacecraft_knowledge_sigma_m, asteroid_ephemeris_sigma_m, detection {v_limit, imager, first_seen_utc, first_seen_range_m, lead_to_first_burn_s, lead_is_lower_bound, optical_sigma_at_first_burn_m}, ground_loop_s, round_trip_light_time_s}` | m, s | derived |

**Refusals.** Idea 41's and idea 40's are carried on with `from` (41's own get `from: "41-signal"`). This module's own have no `from`:
- always: `gravity_field` (point mass: module 43) and `spacecraft` (the propulsion is borrowed);
- `body_mass` when the GM is not measured;
- `tankage`, as a refusal when the as-built tanks run dry, or noted when the tanks are sized;
- `finite_burn` when a braking burn covers more than half its distance;
- `autonomy` (first sight inside the ground loop, or after the first burn; `insufficient_data` when the asteroid is already bright where the computed arc begins and the loop is longer than that arc), `station_keeping`, `planets` and `standoff` (outside the Hill sphere);
- `invalid_input` and `insufficient_data` for bad settings, including a stand-off at or below the surface (`invalid_input`/`standoff`, nothing computed).

**Reading one back** (`parseHandoff`): idea 41's handoff inside is checked as above, then everything is recomputed and compared to 1e-6 relative (epochs to 1 ms), along with the refusal codes.

**For module 43** (Lumpy): `body` (GM, radius, rotation; the shape and density are its own), `standoff_state` (where the spacecraft waits), `environment` (sunlight against gravity) and `mass`.

## Tests

`closing.test.mjs`, 18 tests, Node built-ins, about 3 s:

- **Snapshots.** Every file's sha256 matches its sidecar. `lambert.js` and `coast.js` are ideas 39's and 40's committed files byte for byte, and the wrapped sample is idea 41's committed handoff.
- **Closed forms.**
  - NEAR's 294.20 s by hand.
  - Propellant by the rocket equation, and duration × mass flow = propellant.
  - The braking distance against an independent RK4 of dv/dt = −F/m, dm/dt = −F/v_e.
  - P(1 au) = L/(4π au² c), which sits 1.6% above Scheeres's rounded G₁.
  - Bennu's Hill radius at 1 au, 34.517 km by hand.
- **The SAM frame.** It is orthonormal, x points at the Sun and z against the angular momentum, and latitude and longitude round-trip. Five of Table 1's phase angles agree with their own latitude and longitude to rounding; AAM-1's printed 58.0° is 57.776° (a finding, below).
- **H-G against Horizons.** The phase law reproduces Horizons' APmag at 77 epochs, from phase 3° to 105°, within 0.001 mag (worst 0.0008). Bennu at the first PolyCam image is V 13.084.
- **AAS 19-035 Table 3, measured from the flight.** Horizons' states 3 h either side of each burn are flown ballistically across it. AAM-1 is 351.2815 against 351.2821 m/s, AAM-2 137.0700 against 137.0702, AAM-3 5.1425 against 5.1428, AAM-3a 0.0606 against 0.0602, AAM-4 0.1703 against 0.1704 and M0P 0.0136 against 0.0138. Over 12 h either side the raw velocity difference misses AAM-1 by 0.075 m/s, which the ballistic model takes out.
- **The planner against Table 3's designs.** Started from the flown state at each burn and aimed at the next Table 1 point:

  | Burn | Planned (m/s) | Designed (m/s) | Gap |
  |---|---|---|---|
  | AAM-1 | 351.191 | 351.2984 | −0.03% |
  | AAM-2 | 137.034 | 137.0493 | −0.01% |
  | AAM-3 | 5.1338 | 5.1274 | +0.12% |
  | AAM-3a (the clean-up of AAM-3's execution error) | 0.0609 | 0.0598 | +1.9% |
  | AAM-4 | 0.1667 | 0.1698 | −1.9% |
  | M0P | 0.0124 | 0.0133 | −6.8% |

- **The as-flown case.** From 1 Aug 2018, 61 days ballistic, AAM-1 comes at 174,968 km, 20.47°, 55.38° and 491.30 m/s, against Table 1's 175,000 km, 20.5°, 55.3° and 491.3 m/s. The pre-burn speeds at AAM-2 (141) and AAM-3 (5.2) also match. The gaps are pinned:
  - 135.7 km after 61 days with OSIRIS-APEX's area per mass, and 404.6 km without sunlight;
  - 4.42 km after 13 to 30 Nov, and 65.3 km without sunlight.
- **Orbital A.** The initial state, Bennu's GM and the area per mass are fitted to Horizons' states every 4 h. Bennu's GM comes back within 1% of SBDB's 4.8904 m³/s² (Chesley et al. 2020) over 2, 5 and 10 days, at under 30 m rms. The area per mass is within 5% of OSIRIS-APEX's 1/81.119, and the 10-day fit is pinned at 4.9107.
- **The independent integrator** (`oracle/anh3bp_oracle.py`). AAS 24-063's eqs. (1)-(3), the augmented normalised Hill problem of Scheeres and Marzari (2002), are integrated in the true anomaly in the pulsating rotating frame by SciPy DOP853 at a relative tolerance of 1e-13, on four cases this kernel built. The kernel lands within these distances of it:

  | Case | Gap |
  |---|---|
  | Terminator orbit at 3 km, 10 days | 0.7 mm |
  | Drift from the stand-off, 5 days | 1.1 mm |
  | Closing from 1,000 km at 1 m/s, 10 days | 12 mm |
  | Bennu's Orbital A, 3 days | 0.09 mm |

  The oracle's β̃ equals `regimes()`'s.
- **Physics.**
  - The dark-side equilibrium satisfies 1/x² = β̃ + 3x and holds within 0.1 m for 3 days on a circular orbit, while 1% further out falls away by over 30 m (a saddle).
  - The deadband flown 60 days costs the averaged control acceleration within 5%; the start-time value alone is 10% low.
  - The hover cost at 18.6 km is 6.78 mm/s a day, with sunlight more than 9 times gravity.
  - At Bennu, the scan's 30-day terminator survivors span OSIRIS-REx's flown Orbital A (1.6 to 2.1 km) and B (0.9 km), and the orbit at the Hill radius escapes.
- **Checked one by one.**
  - No sunlight in the shadow, full sunlight beside it.
  - The stand-off velocity is ω × r, |ω| r cos(22.3°) = 4.48 mm/s.
  - Holding the dark-side equilibrium on a circular orbit costs under 1e-12 m/s², which needs every frame term.
  - Every leg, re-flown, reaches the next burn within 1 m.
  - The arrival offset is spacecraft minus target.
  - A v-infinity vector turned at constant magnitude is refused.
  - PolyCam's line-of-sight sigma at 2,184,000 km is 2,948.4 m.
  - A 258-day stay meets the week of 30 March 2029, when the Earth's tide is 2.5% of the Sun's at Apophis (1.041 au from the Sun), recomputed by hand from idea 41's Earth range, and is refused.
- **The chain.**
  - Idea 41's committed sample passes idea 41's parser. It arrives 2028-05-09T18:15 UTC at 4156.094 m/s and 21.7 m from the centre, with a round trip of 687.628 s and idea 40's 6,130 m of knowledge.
  - The defaults, pinned: seven burns; AAM-1 4,012.166 m/s at 175,000 km, 11.70 h early, a 2.75 h burn covering 25,755 km; 4,155.33 m/s in all; 1,654.3 kg of propellant; stand-off on 2028-07-11 at 06:33; Hill radius 23.98 km; first sight 11.21 days ahead; Apophis's 1-sigma 1,235.1 m.
  - The own refusals are exactly `body_mass`, `gravity_field`, `spacecraft` and `tankage`.
- **Refusals the settings raise.** As-built tanks give `tankage` (out of envelope, nothing computed). A 300-day stay gives `planets`, a 40 km stand-off `standoff`, and a 10 m box `station_keeping`. A custom engine with no Isp gives `insufficient_data`. A big custom engine with enough tanks raises nothing. The Hill radius scales as GM^(1/3) between 1.36 and 4.37. Ten bad settings give `invalid_input`.
- **The review's test** (added by the independent review): the deadband's cycle and kick against 2√(2L/a) and 2√(2aL) (88.69 h by hand); AAM-3 on the main engine and AAM-3a on the 21 N thrusters; AAS 24-063's GM range in order; density mode on Apophis computes (it threw) with GM = Gρ(4/3)πR³ = 2.747 m³/s² by hand; Didymos takes SBDB's 2,170 kg/m³; a stand-off inside the body is refused; first sight after the first burn is worded "after"; first sight at the arc's start is a lower bound, refused as `insufficient_data` against a longer loop; and the dark-side equilibrium point gets no sunlight in the shadow.
- **Edited handoffs.** Changing the spacecraft velocity, the light time, an own refusal, or moving the arrival 200 km is refused. Idea 40's handoff points to idea 41, and garbage is refused.
- **The sample.** It is what its inputs give, every output has units, a confidence and a source, and 41's and 40's refusals are carried (3 each). Moving the stand-off by 1e-5, setting GM to 3, changing the mass by 0.1%, dropping a refusal or changing a setting is refused. The as-flown case round-trips without a 41 handoff.

**Teeth.** I made 27 sabotages of `closing.js`, each alone. **All 27 were caught, each by at least one test other than the sample regression (test 15, which catches any change and so proves nothing on its own).** Failing tests in brackets:

| Sabotage | Failing tests |
|---|---|
| Sunlight as a pull | 9 |
| P(1 au) of a mirror | 9 |
| No solar tide | 8 |
| Gravity repelling | 8 |
| SAM z along +h | 6 |
| Sunlight as 1/r | 6 |
| The first-burn search's sign (a bug I had) | 5 |
| β̃ / 3 | 4 |
| NEAR's Isp with propellant for dry | 3 |
| Hill radius with 2 for 3 | 3 |
| H-G exponents swapped | 3 |
| H-G with 5 log | 3 |
| g₀ = 9.81 | 2 |
| The braking distance's sign | 2 |
| Stand-off held inertially | 2 |
| Hover without the centrifugal term | 2 |
| Targeting to 1 km | 2 |
| AAM-2a flown | 2 |
| Arrival offset reversed | 2 |
| SBDB diameter as radius | 2 |
| Centroid at 1 px | 2 |
| No shadow | 1 |
| Import skipping the vector check | 1 |
| Earth-tide threshold at 10% | 1 |
| The deadband firing at both walls | 1 |
| UTC sign | 1 |
| The scan's noon-midnight plane made terminator | 1 |

**The independent review's own 24 sabotages** (each alone, in a scratch copy of the bank, against the revised suite): all caught by a test other than the sample regression. Before the review's test was added, three of its first twenty were caught by the sample regression alone: AAM-3 moved to the small thrusters (main-engine threshold 10 m/s), the deadband cycle as 2√(L/a), and AAS 24-063's GM range written high-to-low. The review's test now catches each, and also: density mode reading the Apophis range again (1), a stand-off inside the body flown again (1), the first-sight lower bound dropped (1), SBDB's density ignored (1), and the Earth's tide taken against the Sun's at 1 au again (1). Others it tried and the original suite already caught: shadow on the sunward side (3), ω̇'s sign (3), the braking distance's u ln u sign (2), the phase angle from the wrong side (2), the import's 100 km check off (1), a left-handed SAM frame (6), the stay left out of the budget (2), each deadband burn counted twice (2), orbits started at escape speed (1), the integrator at 1e-6 (2), measured maneuvers without sunlight (1), p99 reading p99.73 (2), waypoint days counted from AAM-2 (9), the last bright row taken as first sight (3), 1/x² = β̃ + 2x (3), sunlight along the asteroid's Sun line (3).

The first run of the builder's suite caught only 19 of 27 outside the sample test. The shadow, the vector check, the Earth-tide threshold, the stand-off's hold velocity, the hover's frame term, the targeting tolerance, the offset's sign and the centroid were then given tests of their own. Writing the tests also caught two of my own hand values (Bennu's Hill radius at 1 au is 34.52 km, not the 31 I had in mind) and a deadband controller that cost 2.2 times the physics.

`ui-check.mjs`, 51 checks in headless Chromium:
- the default tiles equal the kernel's (first burn, all burns, propellant, stand-off date, Hill radius, hover, first sight, round trip) with the right confidence chips;
- the four own refusals and six carried;
- 19 oracle rows with no NaN, including AAM-1 at 351.28 and Orbital A at +0.4x%;
- five charts drawn, seven burns, and a tapped burn marked and named;
- as-built tanks refused with no tiles; GM 4.37 gives the kernel's Hill radius; a 40 km stand-off is refused, and a 0.1 km one (inside Apophis) is refused with no tiles; reset works; "From a density" on the chain computes with no page error (it threw before the review);
- the single leg gives two burns; the scan gives 14 orbits; a custom spacecraft with enough propellant raises no `tankage`;
- the as-flown case gives AAM-1 at 351.3 m/s and arrival on 3 Dec 2018;
- the download is parsed by the kernel in Node;
- idea 41's handoff imports; idea 40's, garbage and an edited 42 are refused;
- `#h=` links with this page's and idea 41's handoffs open;
- at 390 px, dark and light: no overflow, no text under 11 px, no NaN, the background, charts drawn, a tap marks a burn, and no console errors.

`node tools/check.mjs ideas/42-closing-in` passes (README, sidecars, tests, `check.mjs`, smoke at 1280 and 390 px), with a size warning (below).

## Honest assessment

- **[Certain as measured] The model reproduces OSIRIS-REx's approach.**
  - From Horizons' 1 August 2018 state, 61 days of the Sun's tide and sunlight bring the spacecraft to AAM-1 32 km short of its published 175,000 km, 0.03° and 0.08° off its published angles and within 0.001 m/s of its speed. Table 1 rounds the angles to 0.1°, which is 305 km across at that range, so the point is matched to the table's precision, not to 32 km (the 3-D distance to the point as printed is 248 km).
  - Every maneuver measured from the reconstructed flight is AAS 19-035's estimate to 0.0006 m/s or better.
  - Planning from the flown state reproduces the designed AAM-1 and AAM-2 to 0.03%, AAM-3 to 0.12%, and even AAM-3a, a correction for AAM-3's execution error, to 1.9%.
  - Fits to the first orbit return Bennu's SBDB mass within 1% over 2, 5 and 10 days (−0.10%, +0.94%, +0.42%; 22 m rms over 10 days).
- **[Certain as measured] The gap to reality is km over weeks.**
  - Flown ballistically from 150 km on 13 Nov 2018, the model is 3.0 km from the reconstruction after two weeks and 4.4 km after 17 days (30 Nov; 3.6 km after fitting the area per mass). The navigation team's predictions held to 500 m over two weeks (AAS 19-035 p. 15) with a ten-plate sunlight model, thermal re-radiation and modelled momentum dumps; this model has a flat absorber, no thermal model and no dumps.
  - Over 61 days from 3 million km the gap is 136 km (15 km after fitting): the planets' tides are left out.
  - So the plan's Δv is right to fractions of a percent, while a long ballistic prediction near the asteroid is good to kilometres, not hundreds of metres.
- **[Certain as numbers; Likely as a design] The chain's arrival is expensive.**
  - Apophis on idea 39's transfer comes in at 4.16 km/s, so AAM-1 is 4,012 m/s (97% of the approach) and needs 1,545 kg of propellant from a 2,056 kg spacecraft.
  - NEAR's as-built 318 kg (1,450 m/s) cannot do it. With the tanks sized to the job, NEAR's 487 kg dry mass needs 1,654 kg in all (2,141 kg at launch). That understates a real redesign, since bigger tanks weigh more (refused as `tankage`).
  - The burn takes 2.75 h at 450 N and covers 25,755 km of the 175,000.
  - JPL's own OSIRIS-APEX predict reaches Apophis at under 50 m/s by riding Apophis's April 2029 pass of the Earth (Horizons, daily, queried by the review on 2026-10-31: the predict's speed relative to Apophis is 4.98 km/s on 13 April 2029 and 0.044 km/s on 15 April, with the spacecraft passing the Earth at about 28,000 km and Apophis at about 38,000 km within hours of each other; only the 17 April onward part is in this folder's snapshot). This model cannot fly that (refused as `planets`). The finding points back to idea 39: choose a transfer by arrival speed, not departure C3 alone.
- **[Likely] Seeing it.**
  - Apophis (H 19.09, albedo 0.35) reaches Bennu's first-image brightness at 4.2 million km, 11.2 days before AAM-1, so the ground can design the burn with the target in sight.
  - The threshold is a demonstrated detection (OSIRIS-REx's first scheduled image), not PolyCam's sensitivity limit, and the H-G law is a disk-integrated mean that ignores lightcurve amplitude. Apophis tumbles with a 30.56 h period (SBDB).
  - The optical knowledge (range × iFOV × 0.1 px) is the achieved centroiding for a point source, not a navigation filter.
- **[Certain as numbers; Likely as costs] Holding station.**
  - At 18.6 km from Apophis sunlight (7.8e-8 m/s²) is 10 times gravity. Gravity equals sunlight at 5.9 km, the Hill radius is 24 km, and AAS 24-063's dark-side equilibrium is at 5.8 km. That point is on the anti-Sun axis inside the asteroid's shadow, where there is no sunlight to balance (the circular ANH3BP has no shadow), so it is their model's number, not a place to hold station.
  - Holding costs 6.8 mm/s a day (0.61 m/s for 90 days), with a burn every 89 h in a 1 km box; the deadband flown for 10 days costs 3.3% more than the control acceleration averaged over those days (7.28 against 7.05 mm/s a day; over 60 days the test holds it within 5%).
  - Aster's flat 150 m/s station-keeping allowance is about 250 times this. It is a screening lump, so this is a finding, not a defect.
  - The cost depends on the area per mass: OSIRIS-APEX's 81.119 kg/m² is borrowed (refused as `spacecraft`).
- **[Likely] Orbits.**
  - Circular terminator orbits last 30 days from 0.36 to 2.1 km at Apophis (GM 2.68) and from 0.51 to 2.9 km at Bennu, and escape beyond. Noon-midnight orbits fail sooner.
  - This is consistent with what flew: Orbital A at Bennu at 1.6 to 2.1 km, Orbital B at 0.9 km, and AAS 24-063's planned Apophis orbits reaching 3 to 6 km only as corrected resonant terminator orbits.
  - A point mass, so within a few radii the shape matters (module 43).
- **What is rough or cut.**
  - *No planets.* Refused where the Earth's tide passes 1% of the Sun's. At million-km ranges even 0.01% costs km over two months (the 61-day gap).
  - *Sunlight* acts on a flat absorber along the Sun line: no attitude, no reflection, no thermal re-radiation.
  - *Burns* are impulsive for aiming, with no settling burns, no execution errors and no Sun keep-out (OSIRIS-REx's AAM-3 was split in two for it). One specific impulse serves every engine.
  - *No navigation filter.* Knowledge is a before-and-after picture, not a covariance flown through the approach. Idea 40's `target_knowledge` refusal is answered with numbers (Horizons' 1.24 km for Apophis, PolyCam's angular accuracy) but carried on, not lifted.
  - *No asteroid shape or spin.* Point mass only.
  - *No low-thrust approach.* Dawn's ion engine gave 92 mN (NSSDCA 2007-043A). At that thrust this braking would take about 1,040 days (mΔv/F = 2,056 kg × 4,012 m/s ÷ 0.092 N), not weeks as the builder's draft said, and the page refuses such a burn as `finite_burn`.
  - *The import does not re-fly ideas 40 and 41.* It checks consistency; the tests run idea 41's own parser on the committed sample.
  - *Size.* 554 KB as the checker counts after the review (536 KB before it; the README's review record and the new tests are most of the difference): over the 500 KB budget, under the 650 KB limit. Idea 39's and 40's kernels are 154 KB of it, used for one propagator and one integrator because the series forbids a second implementation; idea 41's sample appears twice (the page's stand-alone case and inside `handoff.json`).
- **Findings about the source repo (Aster, `62ddb17`).**
  - **Apophis's size from the default albedo is 59% too large in diameter, so 4 times in volume.** `src/v2/core/constants/asteroids.ts:9` sets `ASTEROID_DEFAULT_ALBEDO = 0.14`, and line 80's D = 1329/√p · 10^(−H/5) gives 540 m for H 19.09. SBDB carries Apophis's radar diameter (340 m, Brozović et al. 2018) and albedo (0.35), and the same formula with 0.35 gives 342 m. Any mass or gravity Aster derived from the default would be 4 times too large for Apophis; this module uses SBDB's diameter where it exists.
  - **The 150 m/s station-keeping allowance** (`src/v2/porkchop/delta-v.ts:5`, `STATIONKEEPING_DV_KMPS = 0.150`) is about 250 times what holding station costs here (0.61 m/s for 90 days at 18.6 km). The approach's clean-up burns after AAM-2 sum to 5.4 m/s. As a screening margin it is conservative; it should say what it covers.
- **Findings about the sources and earlier modules.**
  - AAS 19-035 Table 1 prints AAM-1's phase as 58.0°, while its own latitude and longitude (20.5°, 55.3°) give 57.78° and the flown state gives 57.83° (Horizons' states 3 h either side: 57.754° and 57.898°). The other rows agree to rounding.
  - NSSDCA 2016-055A gives OSIRIS-REx's launch mass as 1,529 kg (and "Mass: 1528 kg"), where NASA's press kit (PDF p. 4) and the Horizons record give 2,110 kg wet and 880 kg dry.
  - NSSDCA 1996-008A's "Mass: 487 kg" for NEAR is not labelled dry or wet; it is dry by the arithmetic above.
  - Idea 40's arrival state is aimed at the asteroid's centre (21.7 m off), a collision course, which an approach must re-aim (AAM-1 does, here).
- **What the independent review changed** (2026-10-31; a second agent tried to prove this module wrong, then fixed what it found).
  - *Recomputed and confirmed* [Certain as measured], with a different formulation written for the review (spacecraft and asteroid integrated heliocentrically in SciPy DOP853, Newton targeting and the SAM frame's acceleration by finite differences): AAM-1 4,012.1657 m/s, 11.696 h before arrival, from 4,156.1945 m/s; the Hill radius 23.98 km; holding 6.7809 mm/s a day with sunlight 10.02 times gravity, equal at 5,875 m; 1,654.27 kg of propellant (1,544.6 kg of it for AAM-1, a 2.751 h burn); NEAR's 294.20 s; Bennu's Hill radius at 1 au 34.517 km. From freshly fetched Horizons files (not the snapshot): the six measured maneuvers to the 0.1 mm/s printed above, AAM-1 from 1 Aug at 174,968.0 km, 20.468°, 55.379°, 491.301 m/s, and the ballistic gaps 135.674, 404.603, 4.423 and 65.269 km. The Python ANH3BP oracle re-run reproduces its fixture exactly, and the kernel lands 0.09 to 12 mm from it. Every document hash in the sidecars matches a fresh download; Table 1, Table 3, the page citations of AAS 19-035 and AAS 24-063, NSSDCA's NEAR, OSIRIS-REx and Dawn figures, the press kit (PDF p. 4) and the Horizons magnitude law were each checked against the text. Idea 41's kernel was run fresh for all six of its transfer presets (and three radios for Apophis): every export imports here, Apophis's round-trips, Bennu, Ryugu, Didymos and 2000 SG344 compute with their refusals, and Eros is refused as `out_of_envelope` (around Eros's SBDB GM of 446,300 m³/s², aiming between Bennu's 250, 200 and 150 km waypoints does not converge): a refusal, not a number.
  - *Crash fixed* [Certain]: "From a density" on the chain's Apophis threw (`GM_range_m3_s2.join` on null in the `body_mass` reason), leaving the page showing the previous results.
  - *Missing refusal added* [Certain]: a stand-off at or inside the surface (100 m from a 170 m-radius Apophis) was flown and costed (23 m/s a day); it is now refused as `invalid_input`/`standoff` with nothing computed.
  - *Wrong physics fixed* [Certain]: the Earth-tide check compared the Earth's tide with the Sun's tide at 1 au, not at the asteroid. The default stay's worst week is now 7.66e-5 (Apophis 0.759 au from the Sun), not 1.755e-4; the 258-day case is 2.5%, not 2.2%. No default refusal changes.
  - *False numbers on the page fixed* [Certain]: first sight after the first burn was shown as "−2.33 days before" (now "2.33 days after", and the `autonomy` reason says "after"); first sight already at the start of the computed arc was shown as a value, though it is only a lower bound (now "≥", `lead_is_lower_bound` in the handoff, and `insufficient_data` when the ground loop is longer than the arc).
  - *Data source used* [Likely]: where SBDB has a density but no GM (Didymos, 2,170 kg/m³), "measured or published" now uses it instead of the slider's 2,000 kg/m³.
  - *False or overstated sentences corrected*: the tagline's "AAM-1 lands 32 km from its published point" (32 km is the range; the point as printed is 248 km away, inside Table 1's rounding), "the first burn alone ... needs 1,654 kg" (that is the whole arrival; AAM-1 alone is 1,545 kg), "4.4 km of drift over two weeks" (3.0 km over two weeks, 4.4 km over 17 days), "Bennu's mass within 0.42%" (within 1%; 0.42% is the 10-day fit); "the deadband agrees within 3%" (3.3%); AAM-3a and AAM-4 at 1.8% (1.9%); AAM-1's flown phase 57.81° (57.83°); "a 92 mN engine would need weeks" (about 1,040 days) and an unsourced claim that Hayabusa2 "spiralled in on ion engines" (removed); the OSIRIS-APEX "4.9 km/s over four days" (two days, now cited to the review's Horizons query); the page's claim that OSIRIS-REx "hovered or flew slow passes rather than orbit" (it orbited Bennu at 1 to 2 km; reworded); and the dark-side equilibrium, now said to lie in the asteroid's shadow, where it is not an equilibrium of this model.
  - *Tests with more teeth*: three of the review's sabotages were caught only by the sample regression; a new test pins the deadband's cycle and kick to their closed forms (88.69 h by hand), AAM-3 and AAM-3a's engines, the GM range's order, and every fix above. 18 node tests and 51 UI checks.
  - *Layout*: at 390 px the speed chart's "1 day / 1 week / 1 month" labels overprinted each other, the distance chart's "first sight" and "design lead" collided, and the forces chart's axis title was cut off; all three fixed.
  - *Provenance*: `approach-sources.js.provenance.json` and `build-data.mjs` cited the press kit's masses to PDF p. 3; they are on p. 4.
- **Gates not passed.** Aster's multi-agent math audit; oracle validation in Aster's own harness (the Horizons, AAS 19-035, SBDB and Python oracles here are this folder's fixtures); the founding-doc DEC process; the protected core (`src/v2/core/**`). This Idea Bank's independent review has been done once (above); it is not a substitute for any of Aster's gates.

## Where it would land

- **Aster, the ΔV stack** (`src/v2/porkchop/delta-v.ts`). It could replace the flat rendezvous and station-keeping numbers with a disclosed breakdown: the first braking burn (≈ v-infinity), the clean-up, the hover cost per day at a stated stand-off and area per mass. Station-keeping should refuse without a spacecraft area per mass, rather than add 150 m/s. To ship it needs the multi-agent audit and a DEC for the new constants (the AAS 19-035 schedule, the H-G law), with the asteroid's GM and size from SBDB, not from the default albedo.
- **Aster, `src/v2/core/constants/asteroids.ts`.** Prefer SBDB's measured diameter and albedo where they exist, with the default only as a labelled fallback (the Apophis finding).
- **Aster, the MCP server** (`mcp/src/tools/`). An `approach_plan` tool could return `approach`, `station_keeping` and `body` in the evidence envelope, with its refusals (the envelope would need `invalid_input`, as ideas 31 to 41 noted).
- **The Long Way Round.** Module 43 (Lumpy) takes `body` and `standoff_state` and replaces the point mass with a shape; 44 (Touch and Go) starts from the stand-off; 47 (Homeward) leaves from the end of the stay with `mass.end_of_stay_kg`; 50 chains it, with the approach's burns in the Δv waterfall.
