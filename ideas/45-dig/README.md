# Dig
> Bake water out of the asteroid the chain landed on. At Apophis (spectral class Sq, ordinary-chondrite-like) the rock holds at most 510 ppm and heating it costs 1,585 MJ per kg of water, so a 25 kg batch oven gets at most 126 g a day (395 g if the oven kept up with the 8.5 m² mirror); at Bennu (B) the same mirror makes 12.6 kg a day from Murchison-like rock at 13.4 MJ/kg. The Sun's direction at Nightingale matches JPL Horizons' own within 0.015°; the CM analog's 9.7 wt% of water sits 7.7% under another CM (Winchcombe) and 53% over Bennu's hydrogen measured from orbit.

**Kind:** explorable tool
**For:** Aster
**Run:** open `ideas/45-dig/index.html` in a browser (classic scripts, `file://` works, no network; it also opens on a `#h=` link carrying idea 44's handoff or this page's). Tests from the bank root: `node --test ideas/45-dig/dig.test.mjs` (9 tests, about 15 s) and `node ideas/45-dig/ui-check.mjs` (59 checks in headless Chromium, about 20 s; `check.mjs` runs it for `tools/check.mjs`). Regeneration, none needed to run anything: `bash ideas/45-dig/oracle/fetch-sources.sh <empty dir>`, then `node ideas/45-dig/build-data.mjs <that dir>` (finds every transcribed figure in its source, writes `snapshots/dig-sources.js`, `snapshots/sun-ephem.js` and `oracle/horizons-bennu-sun.json`), `node ideas/45-dig/build-data.mjs --handoffs` (idea 44's two handoffs) and `node ideas/45-dig/build-data.mjs --sample` (writes `handoff.json`).
**Made by:** Calciner

## What it is

Idea 45 is module 15 of the twenty in *The Long Way Round* (ideas 31 to 50, launch to asteroid and back). Idea 44 left the spacecraft standing on the asteroid: on Apophis's plate 346, weighing 46 mN, with no propellant left. This page puts a mining plant there and asks how much water comes out each day.

- **Choose the case.** The chain (idea 44's handoff: Apophis, 12 July 2028), or **Bennu at Nightingale**, idea 44's own OSIRIS-REx case (20 October 2020), the one body whose surface a spacecraft has touched and whose sampling site has a published latitude.
- **Choose the rock.** By default from the body's spectral class in JPL's Small-Body Database (Apophis Sq, Bennu B): the S complex is matched to Itokawa's measured water, the C complex to Murchison's measured release. Or set the analog by hand (labelled a what-if). For a CM: pick one of six measured heating runs (500 or 750 °C, 2 to 20 °C a minute, argon or vacuum). Set the regolith's start temperature and how much heat is recovered from spent rock.
- **Size the power.** A Sun-tracking mirror (aperture, presets from OSIRIS-REx's 8.5 m² of arrays to 100 m²), its concentration ratio, optical efficiency, the oven cavity's emissivity, a horizon mask, and the length of the stay.
- **Size the oven** (batch mass) and **the digging**: NASA IPEx bucket drums (small, medium, RASSOR 2.0), counter-rotating pairs, cut depth and speed, how unbalanced the pair is, the regolith resistance (idea 44's low or high fit), whether thrusters cancel the drums' sideways push, a friction coefficient for the feet (blank by default: none is measured, so the feet are not judged; a number is a what-if), the regolith density and the mass on the ground.
- **Read** water per day (mean, range, total), heat per kg of water and its parts, regolith baked per day and what limited each day, how much of the time the Sun is up and how bright it is, how much of the mirror's light the oven keeps, the drums' sideways push and the friction the feet then need, what thrust would cost to cancel it over the stay, the other gases that come off with the water, and the water content assumed. Every number carries a confidence chip; every refusal is shown, with the 19 carried from ideas 40 to 44.
- **Watch** six charts: water per day over the stay against what heat, oven and drums each allow; the Sun's elevation at the site over the first three days; water released against oven temperature (every measured run, Winchcombe, Bennu from orbit, Itokawa); heat per kg of water against water content; the oven's share of sunlight against concentration; the friction the feet need against cut depth, with the slope alone (and any friction set) marked.
- **Check it** against reality (six or seven rows, computed live).
- **Export the handoff** for module 46 (copy, download, link): the water per day and day by day, the gases with it, the energy and every refusal so far.

## Why I made it

- **The series needs it next.** `queue/SERIES_LONG_WAY_ROUND.md`, row 45: "Mining: excavating regolith without pushing yourself off the asteroid, heating it to drive off water, power from the Sun at that distance, throughput over time", taking an asteroid class and power, handing on water produced per day. Idea 44's README, *Where it would land*: "Module 45 (Dig) takes `surface_state`: the weight, the hold-down cost per newton-hour, and the `anchors` and `regolith` refusals."
- **What a person decides with it.**
  - Whether a body is worth mining for water at all: the chain's Apophis is an S-type, and the answer is grams a day at best; a B-type like Bennu gives kilograms from the same mirror.
  - How big a mirror, how hot an oven, how much concentration (below about 40 to 100× a 750 °C oven loses all its heat through its own opening), how fast to heat (slow heating frees more water per kg but cycles fewer batches: Murchison run E at 2 °C/min gives 8.9 wt% but only 4.4 kg a day against run D's 12.6).
  - How hard the drums push the spacecraft sideways, what friction its feet then need, and whether it has the propellant to cancel the push for the whole stay.
  - Which of power, oven and digging is the bottleneck, day by day.
- **For Aster.** Aster's thesis names "composition and economics" as what comes after accessibility (`ASTER_PRODUCT_VISION.md`, quoted in BRIEFING §1), and its catalog carries no spectral class (`strategy/IDEA_KERNELS_2026-09.md` §6.1). This is the first number in the chain that depends on what the asteroid is made of, so it had to go to JPL's Small-Body Database for the class and to returned samples and meteorites for the water.

Alternatives weighed.
1. *A water content per taxonomic class from a table of averages.* Rejected: the series asks for real data and a release that depends on temperature; Suttle et al. (2024) measured exactly that, gas by gas, on Murchison chips heated in a TGA-MS, in argon and in vacuum, so the page uses their six runs and shows their spread instead of one average.
2. *A heat capacity curve fitted to meteorites (Biele et al. 2022).* Rejected for this build: the fits and mineral database are in the paper's supplement, which this session could not reach, and the Bennu sample's measured heat capacity (Nat. Commun. 2026) is likewise in a supplement. Robie and Hemingway's USGS tables, public domain and complete, give every mineral's heat capacity and enthalpy of formation, so the heat is a Hess cycle over named minerals that the tests reproduce against the tables themselves.
3. *A soil-mechanics excavation model (Balovnev, McKyes).* Rejected: NASA's own comparison (Gallo et al. 2010, NASA/TM-2010-215591) shows those models need site-specific cohesion and friction angles and that the blade version only matched after an ad hoc correction; no such values exist for these asteroids. The page uses the only in-situ resistance there is, idea 44's fit to OSIRIS-REx's contact, plus momentum, and labels it.
4. *Photovoltaic power with a temperature model.* Cut: a solar-thermal concentrator follows 1/r² exactly and its one loss (the cavity's re-radiation) is closed-form, so the "power at that distance" part needs no fitted panel data.

## How it works

**The site** (`importTouch()`). Idea 44's handoff is checked without re-flying its descent (that needs idea 43's whole shape kernel, about 300 KB, and seconds): the envelope, the surface state's fields and units, its own arithmetic (weight = mass × acceleration; normal and along-slope parts = weight × cos and sin of the slope, to 1e-6), and its attitude at the contact epoch against idea 43's spin (`attitudeAt`, to 1e-3; the chain's differs by 1.4e-5 because idea 44 carried the attitude through its flight while idea 43 restarts from the nearest CK sample). The site normal, slope, acceleration, regolith resistance (68.8 to 165.0 Pa), hold-down cost (1.248 kg per N-hour) and propellant come from idea 44; the regolith density from idea 43's body (2,025 kg/m³) or, for Bennu, the Small-Body Database (1,194 kg/m³, Daly et al. 2020). Idea 44's Bennu case hands on no spacecraft mass, so the page uses OSIRIS-REx's dry mass, 880 kg (NASA press kit, via idea 42), labelled as set here.

**The rock** (`feedstock()`). Spectral class from the SBDB (`sbdb.api ... phys-par=1`): Apophis Sq (Binzel et al. 2009), Bennu B (Clark et al. 2011), Ryugu Cb, Itokawa S(IV). The S complex (and Q) maps to ordinary chondrites; B, C and F to CM chondrites; anything else is refused.
- *CM:* Suttle et al. (2024), Nat. Commun. 15:7178, Table 2: water released in step 2 of the first heating (above 200 °C; step 1 is terrestrial water and is left out, as the authors do): D 9.687 wt% (750 °C, 10 °C/min, vacuum), E 8.903 (2 °C/min, argon), F 6.536 (10, argon), G 4.023 (20, argon), A 1.135 (500 °C, 10), C 2.234 (500 °C, 20). The CO₂, SO₂ and organics of each run come along to the handoff.
- *S-type:* Jin and Bose (2019), Sci. Adv. 5:eaav8106: "the water content of bulk silicate Itokawa (BSI) to be 160 to 510 ppm". All 510 ppm is counted at the oven temperature set; how much an oven really releases from pyroxene and olivine is not in these sources, so every S-type water number is an upper bound and says so (refusal `release`).

**The heat** (`energy()`). Hess's law over Robie and Hemingway (1995), USGS Bulletin 2131: the water is carried as chrysotile, Mg₃Si₂O₅(OH)₄ → Mg₂SiO₄ + MgSiO₃ + 2 H₂O(g) (13.0 wt% water), so a rock with water fraction w is w/0.130 serpentine and the rest forsterite. Heat per kg = Σ products n H(T_peak) − Σ reactants n H(T_start), with H = ΔfH°(298.15 K) + ∫Cp dT and Cp = A1 + A2 T + A3/T² + A4/√T + A5 T² from the bulletin's equations (chrysotile valid to 900 K, forsterite 1,800, enstatite 1,000, steam 2,500 K; enstatite at 1,023 K is 23 K beyond its range and said so). The reaction at 298 K costs 157.8 kJ per mol of chrysotile, 4.38 MJ per kg of water; evaporating free liquid water costs 2.44 (both from the bulletin). For run D: 1.299 MJ per kg of rock (rock 0.730, serpentine 0.424, steam 0.145), 13.4 MJ per kg of water. For Itokawa's 510 ppm: 0.808 MJ per kg of rock, 1,585 MJ per kg of water. Recovered heat (a setting) hands back that fraction of the spent rock's sensible heat.

**The Sun at the site** (`sunlight()`).
- Distance and direction: JPL Horizons, the asteroid about the Sun, ICRF axes, TDB, every 2 days, linear in between (Apophis 2026-01-01 to 2029-04-15; Bennu 2020 and 2021).
- Flux: the Sun's luminosity (NSSDCA, 3.828e26 W, the value idea 40 uses for sunlight pressure) over 4π r²: 1,361.17 W/m² at 1 au.
- Day and night: idea 43's spin, unmodified: Bennu's IAU rotation from `bennu_v17.tpc`; Apophis tumbling by Euler's equations from the nearest NAIF CK sample. The Sun's direction in the body frame is compared with the site plate's normal from idea 44 every 5 minutes. That plate is a 25 m facet of idea 43's shape: at Nightingale it is tilted 16.8° from the geodetic vertical the Horizons oracle uses (16.75° from the radial direction), so the page's sunrise over the plate is not Nightingale's geodetic sunrise; the oracle tests the Sun's direction, not the plate. For Apophis the kernel is called every 2 h (each call integrates up to 10 days from its CK sample) and the direction is interpolated in between by a cubic Hermite on the kernel's direction and its rate (−ω × s from the kernel's spin vector); Bennu is interpolated the same way between 5-minute kernel calls.
- Apophis's spin is not known past its Earth encounter on 13 April 2029 (idea 43's refusal), so a stay is cut there: from the chain's contact, 275 days at most.

**The mirror and the oven** (`receiverFlux()`). Heat into the oven per square metre of mirror = η_opt S − ε σ T⁴ / C: the opening is the mirror's area over the concentration C and radiates as a cavity at the oven's temperature (σ, NIST CODATA, exact). Below C = ε σ T⁴ / (η_opt S) nothing goes in (refusal `receiver`). The oven heats batches at the chosen run's rate, (T_peak − T_start) / rate per batch (72.5 min for 750 °C at 10 °C/min), only while the Sun is up; nothing is lost or kept overnight.

**Digging** (`dig()`, rewritten in review). IPEx's counter-rotating bucket drums (NASA KSC, ASCE Earth & Space 2022, Tables 1-3: widths 198.9, 246.1 and 352.6 mm; cut speeds 10 and 30 mm/s; cut depth 10 mm; no deeper than half the scoop). IPEx measured the excavation force as horizontal ("The force in the X direction is the primary force of excavation"; the vertical force "equates to the weight of the regolith captured", at 1 g). So:
- per pair, the horizontal cutting forces cancel but for the imbalance fraction of one drum's p w d (p from idea 44);
- the regolith the buckets fling to their tip speed is caught inside the drums, so that momentum stays aboard; the craft only feels the dug regolith brought from rest to its own speed, ṁ v, with ṁ = 2 ρ w d v per pair, the same direction for every drum;
- sideways force H = pairs × imbalance × p w d + ṁ v (33.6 mN on the chain: 32.8 from the imbalance, 0.8 from the regolith);
- a sideways force does not lift the craft: the feet hold it by friction, with the slope's own along-ground weight. Friction needed = (W_t + H) / W_n, digging downhill (the worst case): 0.86 on the chain against 0.13 for the slope alone (idea 44's tan of the slope), with W_n = 45.8 mN;
- no friction coefficient is measured for this regolith, so by default the feet are not judged (refusal `traction`, insufficient data). A coefficient typed in is a what-if: a cut that would need more is held to the depth where W_t + H = μ W_n (refusal `traction`, out of envelope), and below the slope's own tan(slope) nothing is dug;
- thrusters (Feet and thrusters) cancel what the feet are not trusted with (all of H with no coefficient set; the excess over μ W_n with one) at idea 44's kg per N-hour while digging, and only if the propellant idea 44 hands on lasts the whole stay (refusal `hold` otherwise). The chain's spacecraft has none left;
- whether a cut lifts a lander that weighs millinewtons is not measured anywhere (IPEx's vertical force at 1 g was the regolith's weight) and is refused under `excavation`.

**Day by day** (`run()`). Each day the plant bakes the least of: the day's heat over the heat per kg of rock; the oven's batches while lit; the drums' digging while lit. Water is that times the water fraction. The handoff carries the mean, the range, the total and every day.

**Reusing earlier modules.** Idea 43's kernel and spin data (`lumpy.js`, `attitude.js`, idea 40's integrator excerpt, idea 42's sources, Aster's constants) and idea 40's `nav-sources.js`, byte-identical (`tools/snapshot.mjs`, tested); idea 44's committed handoff, wrapped; idea 44's own kernel run on its Bennu case at build time and read back by its own parser.

**Handoff schema (version 1, `from: "45-dig"`).** `handoff.json` is the sample: idea 44's committed handoff with this page's defaults (96 KB).

| inputs | |
|---|---|
| `touch_handoff` | idea 44's handoff, whole (and through it 43's to 39's for the chain) |
| `settings` | `{analog, run, peakS_C, rateS_C_min, T0_K, recovery, aperture_m2, eta_opt, conc, eps, horizon_deg, stay_days, oven_kg, drum, pairs, depth_m, cut_m_s, imbalance, resistance, hold, mu (null = not judged), rho_kg_m3, mass_kg}` |

| outputs | units | confidence |
|---|---|---|
| `site` `{body, key, spectral_class, spectral_class_ref, epoch_tdb_s, epoch_utc, face, lat_lon_deg, normal_body, accel_m_s2, slope_deg, mass_kg, weight_N, weight_normal_N, attitude_check}` | m/s², deg, kg, N | derived |
| `feedstock` `{analog, label, hypothetical, run, peak_K, rate_K_s, water_mass_fraction, bound, water_range_750C, other_gases_mass_fraction {co2, so2, organics}, serpentine_fraction}` | kg/kg, K, K/s | measured (CM) / assumed (S-type) |
| `energy` `{T0_K, Tpeak_K, per_kg_regolith_J, per_kg_water_J, parts_J_per_kg {solids, reaction, steam, recovered}, reaction_J_per_kg_water, extrapolated_K, recovery}` | J/kg, K | derived |
| `collector` `{aperture_m2, eta_opt, concentration, emissivity, S_1au_W_m2, S_epoch_W_m2, receiver_efficiency_epoch, min_concentration_epoch}` | m², W/m² | derived |
| `sunlight` `{days, horizon_deg, lit_fraction, r_au_range, sampling}` | days, deg, au, s | derived |
| `dig` `{drum, pairs, width_m, depth_set_m, depth_used_m, depth_max_m (null with no friction set), cut_m_s, rho_kg_m3, resistance_Pa, sideways_set_N, sideways_used_N, weight_normal_N, along_slope_N, friction_needed_slope, friction_needed, friction_coefficient, slides_as_set, rate_kg_s, hold, hold_thrust_N, hold_propellant_kg_per_day, hold_propellant_stay_kg}` | m, m/s, kg/m³, Pa, N, kg/s, kg | assumed |
| `timeline` `{day[], utc0[], r_au[], lit_h[], heat_J[], regolith_kg[], water_kg[], limit[]}` | days, au, h, J, kg | derived (CM) / assumed (S-type) |
| `water_rate` `{mean_kg_per_day, min_kg_per_day, max_kg_per_day, total_kg, days, first_day_utc, bound, limits {heat, oven, dig}, other_gases_kg_per_day, regolith_kg_per_day}` | kg/day, kg | derived (CM) / assumed (S-type, an upper bound) |

**Refusals.** Ideas 40 to 44's are carried with their `from` (19 on the chain, 4 on Bennu). This module's own:
- `release` (S-type, always): every water number is an upper bound; `feedstock` (CM, always): the release is Murchison's, not the asteroid's;
- `excavation` (always): the cutting resistance is idea 44's contact fit, nothing has been dug in milligravity;
- `terrain` (always): no terrain shadows;
- `traction` (always, unless thrust cancels the push): `insufficient_data` with no friction coefficient set (the friction needed is shown, not judged), `out_of_envelope` when a coefficient set as a what-if is exceeded and the cut is held back;
- `analog` (`out_of_envelope`) when the analog is set against the spectral class; `hold` when thrust would outlast idea 44's propellant over the stay; `receiver` when the concentration cannot reach the oven temperature; `stay` when the stay is cut by the spin model or the ephemeris; `invalid_input` for settings and handoffs; `not_found` for a body with no spin, ephemeris or class here.

**Reading one back** (`parseHandoff`): idea 44's inside is checked as above, then everything here is recomputed and compared to 1e-6, refusal codes included.

**For module 46** (Split): `water_rate` (kg per day, with `bound: "upper"` for the chain) and `timeline`, and `feedstock.other_gases_mass_fraction`: on a CM, 1.4 kg a day of CO₂, SO₂ and organics come off with 12.6 kg of water and must be separated before electrolysis.

## Tests

`dig.test.mjs`, 9 tests, Node built-ins, about 15 s:

1. **Snapshots.** Every sidecar's sha256 matches its file; the six files from ideas 43 and 40 are byte-identical to the committed ones; the wrapped handoff equals idea 44's `handoff.json`; every Robie-Hemingway equation, integrated, gives back the bulletin's own detailed tables (Cp and (H − H298)/T at 500, 800 and 900 or 1,000 K) to their printed 0.01 (12 checkpoints for four minerals); build-data found all 50 quoted strings in their sources; 1 au gives L/(4π au²) = 1,361.17 W/m².
2. **The oracle: JPL Horizons.** The Sun's elevation at Nightingale (55.9°N, 41.8°E, geodetic on IAU_BENNU) every 5 minutes on 20 October 2020, 15 January 2021 and 1 April 2021 (435 rows, from Horizons' own Bennu rotation model and DE441), against this page's (Horizons' heliocentric table, idea 43's `bennu_v17.tpc` spin, the geodetic normal): largest difference 0.0145°, mean 0.0065°, the same samples in daylight. The test fails above 0.03° and below 0.001° (the two rotation models are not identical).
3. **Day and night.** Apophis: the Hermite between 2-hour kernel calls stays within 0.02° of the kernel called directly (measured 0.008° over 3 days); the first ten days' lit hours are pinned (6.42 to 15.17 h, uneven because Apophis tumbles). Bennu: a 10° horizon mask lights exactly the samples the kernel puts above 10° (added after the sabotage run found the mask untested); the daylight over one turn, 50.58%, against the closed form arccos(−tan φ tan δ)/π = 50.54% (0.1%).
4. **Heat.** The reaction from the four enthalpies of formation (157.8 kJ/mol, 4.38 MJ per kg of water, by hand); dry rock to 1,000 K equals the bulletin's tabulated forsterite rise, 109.28 × 1,000 / 0.140693 J/kg (2e-5); path independence: reacting at 298 K then heating the products equals heating the reactants then reacting at 800 K (1e-6); rock that starts at 380 K costs less by exactly the reactants' heat from 298.15 K (added in review: every other test starts at 298.15 K, where that term is zero); full recovery hands back exactly the spent rock's sensible heat; more water than serpentine holds is refused; run D's 1.2995 MJ/kg and 13.415 MJ per kg of water.
5. **The concentrator.** The receiver flux is η S − ε σT⁴/C; at 0.999 of the break-even concentration nothing goes in, at 1.01 something does; a concentration of 50 at Bennu is refused and makes no water; a grey cavity (ε = 0.5) loses half, in the formula, in the day's heat and in the break-even concentration (added in review: every other case has ε = 1).
6. **Digging** (rewritten in review). The chain's sideways push by hand, 0.1 p w d + (2 ρ w d v) v = 33.61 mN; the weight on and along the ground equal idea 44's printed figures; the friction for the slope alone is idea 44's `friction_needed_to_stay`, and with digging (W_t + H)/W_n; with no coefficient set nothing is capped and `traction` is `insufficient_data`; two pairs push and dig twice as much; balanced drums push only by ṁ v; at μ = 0.5 the deepest cut solves W_t + H = μ W_n (5.112 mm, also from idea 44's printed weights) and a 20 mm cut is held there; at μ = 0.1, below the slope's 0.125, nothing is dug and no water is made; the chain's craft cannot use thrust (no propellant left); a craft with 5 kg left cannot hold 90 days (refusal `hold`) but can hold 2 days, at H × idea 44's kg per N-hour, the stay's total equal to that rate times the lit hours, with the feet left holding only the slope; with μ set, thrust takes only the excess over μ W_n.
7. **The rock.** Sq and S(IV) map to ordinary, B and Cb to CM; the SBDB classes; Itokawa's 510 ppm; every Murchison run's water; a CM Apophis is labelled a what-if; the reality rows (below).
8. **The chain.** Both of idea 44's handoffs import; the attitude check sits between 1e-6 and 1e-4; 19 and 4 refusals carried; every day is the least of the three capacities times the water fraction, and they sum to the total; the chain's 0.125624 kg/day and Bennu's 12.5690 kg/day; doubling the mirror doubles heat-limited water exactly; the handoff round trip; the sample in the folder is exactly what its inputs give; an edited water rate and a dropped refusal are refused; a 365-day stay at Apophis is cut to 275 days with the 2029-04-13 refusal.
9. **Refusals the inputs raise.** Garbage; a non-handoff; idea 43's handoff (pointed to idea 44); idea 44's handoff with its weight doubled, or its attitude turned; a body with no spin here; ten bad settings (two of them friction coefficients, 0 and 5); an S-type oven below the start temperature.

**Teeth.** The builder made 28 single sabotages of `dig.js` and the suite caught all 28. The independent review found four more that passed every test (the cavity emissivity dropped from the receiver and from the day's heat, the drum pairs dropped, the regolith's start heat dropped: every test used ε = 1, one pair and 298.15 K) and rewrote the digging model, so it re-ran 35 sabotages, each alone, in a scratch copy of the bank (ideas 40, 43 and 44 linked in), on the suite as committed: **35 of 35 caught**.

| Sabotage | Failing tests |
|---|---|
| Dehydroxylation enthalpy with its sign flipped | 4, 8 |
| Serpentine carries one water, not two | 3, 4, 5, 7, 8 |
| Steam leaves without its sensible heat | 4, 8 |
| Steam heated only to the start temperature | 4, 8 |
| Reactants' start heat ignored | 4 |
| Heat recovery added instead of subtracted | 4 |
| Cavity loss times C instead of over C | 5, 8 |
| Emissivity dropped from the receiver | 5 |
| Daily heat with the cavity loss dropped | 5, 8 |
| Emissivity dropped from the daily heat | 5 |
| Sunlight falls off as 1/r | 8 |
| Flux at 1 au over 2 pi au^2 | 1, 5, 8 |
| Sun direction toward the asteroid, not the Sun | 2, 3, 8 |
| Rate of the Sun direction with the wrong sign | 3, 8 |
| Sun direction held between kernel calls | 3, 8 |
| Horizon mask ignored | 3 |
| Pairs dropped from the cutting imbalance | 6 |
| Imbalance dropped (full cut force) | 6, 8 |
| Dug regolith brought to the tip speed (the old error) | 6, 8 |
| Friction cap ignores the slope | 6 |
| Thrust takes all of H even with mu set | 6 |
| Thrust budget over the stay not checked | 6 |
| Ledger takes the most of heat, oven and digging | 5, 6, 8 |
| Oven batch heated from 0 C | 8 |
| Murchison water includes the adsorbed water | 3, 4, 5, 7, 8 |
| S complex mapped to CM | 3, 5, 6, 7, 8 |
| Itokawa low end used | 7, 8 |
| Import skips the weight arithmetic | 9 |
| Import skips the attitude check | 9 |
| UTC = TDB + 69.184 s | 8 |
| Ephemeris read one row late | 2, 3, 5, 8 |
| Hydrogen fraction of water with one H | 7 |
| Stay not cut at the end of the spin model | 8 |
| Read-back ignores the refusals | 8 |
| What-if analog refusal dropped | 7 |

- *Caught by one test only, and how:* the reactants' start heat and heat recovery's sign by test 4's exact identities; the emissivity (twice) by test 5's grey cavity; the 1/r flux, the oven batch from 0 °C, the UTC sign, the stay cut and the refusal read-back by test 8 (the water pins and the round trip); the horizon mask by test 3's masked day; the drum pairs, the friction cap without the slope, thrust taking all of the push with a coefficient set, and the unchecked propellant budget by test 6; the import's weight and attitude checks by test 9; the hydrogen fraction and the what-if refusal by test 7.

`ui-check.mjs`, 59 checks in headless Chromium: the tiles equal the kernel's (water per day, heat per kg of water, the sideways push and the friction it needs, shown as not judged, the water content) with the right confidence chips (the S-type water `assumed` and marked "at most"; the CM water `derived`); the four own and 19 carried refusals; six charts drawn; the reality table with no NaN and Winchcombe's −7.7%; a 1,000 kg oven makes heat the limit, then a doubled mirror doubles the water as the kernel does; a friction of 0.5 typed in holds a 20 mm cut back (refused, the tile says so, the push equals the kernel's) and clearing it returns to not judged; a concentration of 20 is refused; a CM Apophis is labelled a what-if; the download parses in the kernel; garbage, idea 43's handoff and an edited idea 44 handoff are refused; this page's sample imports and matches; a `#h=` link with idea 44's Bennu handoff opens the Bennu case with its water, heat and seven reality rows; run E's water; at 390 px in dark and light: no overflow, the right background, no text under 11 px, charts drawn, a tap switches the case, no NaN, no console errors.

`node tools/check.mjs ideas/45-dig` passes (README, sidecars, tests, `check.mjs`, smoke at 1280 and 390 px).

## Honest assessment

- **[Certain as measured] The Sun's direction at the site.** Against JPL Horizons' own Sun elevation above Nightingale's geodetic vertical on three days six months apart, this page's Sun direction is within 0.0145° (mean 0.0065°), with every 5-minute sample on the same side of the horizon. That tests the ephemeris, the time scales, idea 43's Bennu spin and the frame chain end to end. It does not test the ground: the page's day and night are over idea 44's plate, a 25 m facet tilted 16.8° from that vertical, so its sunrises differ from Nightingale's geodetic ones by up to that angle (the yield barely moves: 12.572 kg a day over the geodetic vertical against 12.569 over the plate, because a tracking mirror cares about the lit hours). For Apophis there is no such oracle (Horizons has no tumbling model); the page's Apophis days are idea 43's spin, interpolated to 0.008°.
- **[Certain as arithmetic] The heat.** Robie and Hemingway's equations reproduce their own tables to the printed digits, Hess's law holds to 1e-6 on two paths, the dry-rock heat equals the tabulated forsterite rise. **[Likely] as physics:** real CM phyllosilicate is Fe-rich serpentine and saponite with tochilinite, not Mg chrysotile; all of the water is charged chrysotile's dehydroxylation heat (an upper estimate for the part that is adsorbed or interlayer water); the rest of the rock is forsterite; the carbonates' and sulfides' heats of reaction are left out although their CO₂ and SO₂ are counted.
- **[Likely] The CM water, as an analog.** Murchison run D (vacuum, 750 °C) gives 9.69 wt%: 7.7% under Winchcombe (10.5 ± 1.1 wt%, another CM, all water above 200 °C by stepwise pyrolysis), inside its uncertainty. Against Bennu from orbit (Praet et al. 2021, OVIRS, read here as water): +52.7% against Nightingale's latitude band (~0.71 wt% H, 6.35 wt% water) and +90% against the surface average (0.57 wt% H, 5.09 wt%). Bennu's returned sample is CI-like (Glavin et al. 2025), and its own release curve, which would settle this, is not in this folder. The serpentine that run D's water implies, 74.5% by mass, sits 2.1% from Murchison's ~73 vol% phyllosilicate (different bases, a consistency check only).
- **[Certain as transcribed; Likely as a bound] The S-type water.** Itokawa's bulk silicate holds 160 to 510 ppm (Jin and Bose 2019), in pyroxene and olivine; the page counts all 510 ppm as released, an upper bound it labels. The chain's answer, at most 126 g a day from an 8.5 m² mirror, could be near zero in practice; nothing here measures how much an oven frees.
- **[Certain as numbers] On the chain:** at Apophis, 0.84 au from the Sun on 12 July 2028 (1,912 W/m²), the Sun is above the site 49.6% of the time but the days run from 3.7 to 20.8 hours (it tumbles); an 8.5 m² mirror at concentration 300 keeps 87% of its light at 750 °C (break-even 38); 25 kg batches of 72.5 min limit every day: 246 kg of rock and at most 126 g of water a day, 11.3 kg in 90 days. A 1,000 kg oven would make it heat-limited at 395 g a day. If Apophis were a CM (it is not), the same plant would make 23.9 kg a day. Digging 10 mm deep with one pair of IPEx small drums pushes it 33.6 mN sideways; with 45.8 mN of weight on the ground the feet then need a friction coefficient of 0.86 (0.13 for the 7° slope alone), which nothing here can judge; at a coefficient of 1 typed in as a what-if the deepest cut would be 11.9 mm, and the craft has no propellant left to cancel the push with thrust. The stay ends at the Earth encounter (275 days).
- **[Certain as numbers] At Bennu:** 1.35 to 1.24 au over 90 days (742 W/m² at the start), the oven keeps 67% at concentration 300 (break-even 99), heat limits every day: 130 kg of rock and 12.6 kg of water a day (10.8 to 15.4 as Bennu nears the Sun), 1,131 kg in 90 days, with 1.4 kg a day of CO₂, SO₂ and organics. Run by run: D 12.6, F 9.7, C 8.1, G 6.7, E 4.4 (oven-limited at 2 °C/min), A 4.3 kg a day. Half the spent rock's heat recovered: 17.5 kg a day.
- **[Speculative] The digging forces.** The resistance is idea 44's single constant fitted to OSIRIS-REx's dynamic contact at 10 cm/s, used as a static pressure on a drum's cut face at 1 cm/s; the imbalance (0.1) is a guess; IPEx's measured drum forces exist only as plots for lunar simulant at 1 g. The push numbers show the trade (shallower, slower, balanced, heavier) more than they predict a force. **[Likely]** that the force is sideways: IPEx says so for its drums at 1 g; whether a cut also lifts a milligravity lander is not measured and is refused, not modelled. On Bennu's 27° plate the slope alone needs a friction coefficient of 0.52 and a 10 mm cut raises it to 1.10; no friction is measured for this regolith, so the page shows the numbers and judges them only against a coefficient typed in.
- **What is rough or cut.**
  - *No terrain shadows* (idea 43's 25 m plates; a horizon mask is offered), no heat lost or kept overnight, no warm-up penalty for short days.
  - *No release kinetics* beyond the six measured runs: the page cannot interpolate between temperatures, and an S-type oven's temperature changes only its heat, not its water.
  - *No electrical budget* for the drums, the condenser, the radiators or the electronics; no condenser at all (the steam's heat is counted as spent).
  - *No lift from the cut and no measured friction*: the feet are judged only against a friction coefficient the user types in.
  - *Only two bodies* (those idea 43 has spins for); the Bennu case's weight uses OSIRIS-REx's dry mass because idea 44 hands on none.
  - *Speed.* Apophis's first run takes about 3 s in a browser (1,080 calls to idea 43's spin for 90 days; 275 days take about 9 s); plant changes reuse it.
  - *Size.* About 556 KB as the checker counts after the review (535 KB as built): over the 500 KB budget, under the 650 KB limit. Idea 44's 75 KB handoff appears twice (wrapped for the page, and inside `handoff.json`) and idea 43's kernel is 75 KB, of which this page uses the spin.
- **What writing the tests caught in my own code.**
  - Bennu's Sun was sampled at the start of each 5-minute step while the step's middle was meant: the horizon-mask test found 2 samples in a day on the wrong side; Bennu is now interpolated like Apophis (12.5689 → 12.5690 kg a day).
  - A first Apophis interpolation (normalised linear between 2-hour kernel calls) was 0.50° off; the Hermite on the kernel's rate is 0.008°.
  - The charts first converted Bennu's hydrogen to water with a stray factor of 100, putting the orbit band off the chart; and the push chart multiplied millinewtons by 1,000 again.
- **Findings about the sources and earlier modules.**
  - **JPL Horizons' Sun record still quotes the old solar constant.** Its header gives "Solar constant (1 AU) = 1367.6 W/m^2" beside "Luminosity, 10^24 J/s = 382.8", which over 4π au² is 1,361.2 W/m² (retrieved 2026-11-01). This page uses the luminosity, as idea 40 does.
  - **Idea 44's Bennu case hands on no mass and no specific impulse**, so module 45 cannot cost holding down at Bennu, and the weight there is this page's assumption (idea 44's `spacecraft_mass` refusal says why).
  - **Idea 44's attitude and idea 43's differ by 1.4e-5 at the same epoch** (idea 44 integrates the spin along its flight; idea 43 restarts from the nearest CK sample). Harmless; this page tolerates 1e-3.
- **Findings about the source repo (Aster, `62ddb17`).**
  - **The catalog's radii for the two bodies the chain lands on are off by large factors.** `tests/fixtures/v2/nea-catalog-slice9.json` gives Apophis `estimatedRadiusM` 270.0 and Bennu 161.2 (from H under the assumed albedo `ASTEROID_DEFAULT_ALBEDO = 0.14`, `src/v2/core/constants/asteroids.ts:9`; D = 1329 km / √0.14 × 10^(−H/5) reproduces both), while the Small-Body Database carries measured diameters, 0.34 km (Brozovic et al. 2018) and 0.484 km (Daly et al. 2020), with albedos 0.35 and 0.044. Apophis is 59% too big and Bennu 33% too small, so any mass of resource scaled from these radii is 4.0× too high for Apophis and 3.4× too low for Bennu. The field is labelled an estimate; the finding is that measured sizes exist for these bodies and are not used.
  - **No spectral class in the catalog** (known, `strategy/IDEA_KERNELS_2026-09.md` §6.1): this page had to go to the SBDB, which serves it with a reference for both bodies.
- **What the independent review changed** (the reviewer re-fetched every source with `oracle/fetch-sources.sh`: the papers, the bulletin and the IPEx report match the recorded sha256; recomputed the Hess heat by Simpson integration of the bulletin's Cp equations in Python, 1.29947 MJ per kg for run D and 0.80820 for Itokawa's 510 ppm, as the kernel; the receiver, 87.25% and a break-even of 38.24 on the chain, 67.1% and 98.6 at Bennu; Bennu's first day, 10.78 kg of water from 741.6 W/m² over 11.17 lit hours; Praet's 0.71 and 0.57 wt% H as 6.345 and 5.094 wt% water; and the Aster catalog radii from H at albedo 0.14, 270.04 and 161.22 m, exactly):
  - *The digging physics was wrong and is rewritten.* The kernel counted the regolith's fling to the drums' tip speed, ṁ v_tip, as an uncancelled push, although the same counter-rotation that cancels the cut cancels it and the caught regolith keeps that momentum aboard (only ṁ v reaches the craft, 0.8 mN instead of 6.9). And it compared a sideways force with the weight normal to the ground as "lifting off", although IPEx measures the excavation force as horizontal; a sideways force is held by friction, which is unmeasured here. The push on the chain falls from 39.66 to 33.61 mN, "11.6 mm would lift it off" is gone, and the page now shows the friction needed, judges it only against a coefficient the user types in (new setting `mu`, blank by default), and refuses `traction` otherwise. Water numbers are unchanged (digging never limited a day at the defaults).
  - *Thrust could outlast the propellant.* Idea 44's own stay-mode handoff hands on 10.9 g of propellant; this page held a 30 mm cut by thrust for 275 days (307 kg) without a word. Thrust is now used only if idea 44's propellant lasts the stay (refusal `hold`).
  - *Four sabotages went uncaught*: the cavity emissivity dropped (every test had ε = 1), the number of drum pairs dropped (every test had one pair), and the regolith's start heat dropped (every test started at 298.15 K). Tests 4, 5 and 6 now vary them.
  - *Numbers typed from memory removed*: the Apophis chart caption gave tumbling "periods of about 30 and 264 h" that are in no snapshot; Bennu's "4.3 h" and "55.9°N" were literals. They are now the kernel's own spin period at contact and the site's latitude.
  - *A false caption*: the Bennu Sun chart said "the tests hold this curve to JPL Horizons' own within 0.03°", but the curve is over idea 44's plate, 16.8° from the vertical the oracle uses; caption, README and the page's "how this works" now say what the oracle does and does not test.
  - *The tagline* said the chain's 126 g a day comes from the mirror; the 25 kg oven batches limit every day (the mirror alone would allow 395 g). It now says so.
  - Chain check: idea 44's kernel was run now on idea 43's handoff (defaults, stay mode, a 2,000 kg craft, no dispersions) and each export imports here, recomputes and round-trips; the stay-mode export is the one that found the propellant bug.
- **Gates not passed.** Aster's multi-agent math audit; oracle validation in Aster's own harness (the Horizons, bulletin and closed-form checks here are this folder's fixtures); the founding-doc DEC process; the protected core (`src/v2/core/**`). The digging model rewritten in review has no external oracle either.

## Where it would land

- **Aster, the MCP server** (`mcp/src/tools/`). A `water_yield` tool could return `feedstock`, `energy` and `water_rate` in the evidence envelope for a body and a plant, refusing with `not_found` for a body with no spectral class in the SBDB and `insufficient_data` (`release`) for an S-type. It would need the SBDB's taxonomy ingested next to the catalog (the catalog has none) and the envelope's `invalid_input` code that ideas 31 to 44 noted.
  - To ship: the multi-agent audit of the Hess cycle and the receiver, a DEC on which release data is canonical (Murchison runs, or the Bennu and Ryugu sample curves when they can be fetched), and a refusal for any class without a measured analog.
- **Aster's catalog** (`tests/fixtures/v2/nea-catalog-slice9.json` and its ingestion under `tools/`): use the SBDB's measured diameter and albedo where they exist, with `confidence: measured`, before any resource mass is computed from a radius.
- **The Long Way Round.**
  - Module 46 (Split) takes `water_rate`, `timeline` and the other gases: the chain hands on an upper bound of 126 g a day, Bennu 12.6 kg.
  - Module 50 chains it, with the `release` refusal carried to the end.
