# Split
> Turn the asteroid's water into return propellant: split it with the spacecraft's own arrays, then liquefy it, compress it or keep it for a steam thruster, and burn the mixture worth burning. On the chain (Apophis, at most 11.3 kg of water) the liquefied route keeps 7.1 kg at 423 s because over a third of the hydrogen boils off in the dark. At Bennu, NEAR's 1.8 kW arrays idle one 20 K cooler but split only 33 of 1,131 kg (24 kg kept), while Psyche's 21 kW arrays make 765 kg. Electrolysis energies match NIST-JANAF to 0.02 mV and every Isp matches NASA CEA to 1.2 ppm.

**Kind:** explorable tool
**For:** Aster
**Run:** open `ideas/46-split/index.html` in a browser (classic scripts, `file://` works, no network; it also opens on a `#h=` link carrying idea 45's handoff or this page's). Tests from the bank root: `node --test ideas/46-split/split.test.mjs` (11 tests, about 1 s) and `node ideas/46-split/ui-check.mjs` (80 checks in headless Chromium, about 10 s; `check.mjs` runs it for `tools/check.mjs`). Regeneration, none needed to run anything: `bash ideas/46-split/oracle/fetch-sources.sh <empty dir>`, then `node ideas/46-split/build-data.mjs <that dir>` (finds every transcribed figure in its source and writes `snapshots/split-sources.js`), `node ideas/46-split/build-data.mjs --partforge` (PartForge's metals and NASA factor), `--handoffs` (idea 45's two handoffs) and `--sample` (writes `handoff.json`). CEA oracle: `python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install cea==3.3.4 && <scratch>/venv/bin/python -I -B ideas/46-split/oracle/cea_split.py`.
**Made by:** Anode

## What it is

Idea 46 is module 16 of the twenty in *The Long Way Round* (ideas 31 to 50, launch to asteroid and back). Idea 45 left a mining plant on the asteroid baking water out of the regolith every day. This page turns that water into propellant for the trip home and hands module 47 a mass and a specific impulse.

- **Choose the case.** The chain is idea 45's committed handoff: Apophis, 90 days from 12 July 2028, at most 11.3 kg of water (an upper bound). The other case is idea 45's own Bennu case, run by idea 45's kernel: 1,131 kg of water from Murchison-like rock. You can also import any handoff idea 45 exports.
- **Choose the route.**
  - *Split and liquefy:* a PEM electrolyser, then liquid oxygen and parahydrogen at 1 atm in insulated spheres.
  - *Split and compress:* the cell itself delivers both gases at the storage pressure into metal spheres.
  - *Keep the water:* no splitting at all; the water is boiled in a steam thruster on the way home.
- **Set the plant.**
  - *The cell:* DOE's PEM stack points (1.9 V today, 1.8 and 1.6 V as targets) or a voltage you set. The Faraday efficiency defaults to the 98.3 % the ISS oxygen generator's published figures imply. The cell temperature can be set from 280 to 360 K.
  - *The arrays:* NEAR Shoemaker's (the chain's own spacecraft, 1.8 kW at 1 au), Psyche's (21 kW), or any power you type.
  - *For liquefying:* the insulation's warm-side temperature, whether the coolers hold the boil-off by day, and the 90 K stage's efficiency.
  - *For gas:* the storage pressure and one of PartForge's flight metals for the tanks.
  - *For steam:* the heater temperature, chamber pressure and area ratio.
  - *The engine:* the mixture ratio (the most Δv, all the oxygen, or a value you set by slider, number or by tapping the chart), its chamber pressure and area ratio, and the dry mass going home.
- **Read the result.** Tiles give the propellant, the vacuum Isp (delivered, ideal and frozen), the mixture ratio burned and its chamber temperature, and a Δv estimate on the dry mass carried home. They also give the water split and left, the cell voltage against its reversible and thermoneutral voltages, the boil-off, how many 20 K coolers are needed and their mass, and the tanks. A bar shows where the array energy went. Every number carries a confidence chip, and every refusal is shown, including the 23 carried from ideas 40 to 45.
- **Compare the three routes** in one table, run on the same water and the same arrays.
- **Six charts:**
  - the stay day by day (water mined, split, in the tanks, boiled away, with power-limited days shaded);
  - array power against what the plant uses;
  - Isp and Δv against mixture ratio (a control: tap, drag or use the arrow keys);
  - reversible and thermoneutral voltages against temperature, with NIST-JANAF's values as dots;
  - kilograms of tank per kilogram of gas against pressure;
  - steam Isp against heater temperature, beside the hydrogen-oxygen routes.
- **Check it against reality:** fourteen rows, computed live.
- **Export the handoff** for module 47 (copy, download or link).

## Why I made it

- **The series needs it next.** `queue/SERIES_LONG_WAY_ROUND.md`, row 46, asks for "Refuelling: electrolysis of that water, the mixture ratio you can actually burn (back to 31), liquefaction or storage, boil-off, or using the water directly as propellant". It takes a water rate and hands on return propellant (mass, Isp). Idea 45's README, *Where it would land*, says: "Module 46 (Split) takes `water_rate`, `timeline` and the other gases".
- **What a person decides with it.**
  - **Whether to split at all.** Steam needs no power at the asteroid but gives 176 s. Hydrogen and oxygen give 423 to 432 s but need the arrays, the coolers or the tanks.
  - **Liquid or gas.** Gas needs no cooler power, but with aluminium spheres it costs about 4 kg of tank per kilogram of propellant. Liquid costs cooler power, and the hydrogen boils away in the dark.
  - **How big the arrays must be.** A 20 K cooler draws 631 W before it lifts anything. At Bennu, NEAR's arrays (about 1 kW there) idle one cooler and have little left to split with: 33 of 1,131 kg. Psyche's split 859 kg.
  - **Which mixture ratio to burn.** It is the water's own 7.94, not the engine's best-Isp ratio near 5. The page shows why: burning at 5 on the chain gives 34.9 m/s against 49.5.
- **For Aster.** Aster's thesis names "composition and economics" as what comes after accessibility (BRIEFING §1). Its legacy redirect planner values asteroid water at $500 to $1,500 per kilogram with no step between water and propellant (Findings). This module is that step, priced in joules and kilograms, with every number traced.

Alternatives weighed.
1. *A fixed "kWh per kg" electrolysis figure.* I rejected it. DOE publishes one, but it hides the voltage, the crossover and the thermoneutral heat. Here the energy comes from Faraday's law and the voltage, and DOE's kWh/kg becomes a check rather than an input (it is reproduced to 1.5 to 2.3 %).
2. *A polarization-curve cell model (Butler-Volmer plus ohmic loss).* I cut it. Its exchange currents and resistances would be fitted to curves this session could not fetch as data; the ISS OGA papers show its cell voltages only as plots. DOE's tabulated stack points are real figures.
3. *A liquefier quoted as a single "kWh per kg of LH₂".* I rejected it. NASA's flight-class 20 K cooler has a measured turndown table (2026), and NIST gives the heat to remove. The page combines them, including the cooler's large idle power, which a single figure would hide.
4. *A new mixture-ratio Isp fit.* I rejected it as not allowed: the series says never to reimplement an earlier module's physics. The page calls idea 31's equilibrium and idea 32's nozzle unmodified, and checks them at these new conditions against NASA CEA.

## How it works

**Importing idea 45** (`importDig()`). The page checks idea 45's handoff without re-running its plant, which would need idea 43's whole shape kernel:
- the envelope and the units of each output it reads;
- that each day's water equals regolith × water fraction;
- that the days sum to idea 45's total, mean, minimum and maximum.

The tolerance is 2e-5, because idea 45 rounds its timeline to 6 significant figures and its totals to 9 (Findings). It carries idea 45's refusals with their `from` field: 23 on the chain, 8 at Bennu. The spacecraft mass (487.1 kg, NEAR's; 880 kg at Bennu) is the default dry mass.

**Splitting** (`electrolysis()`, `cell()`). H₂O(l) → H₂ + ½O₂ at the cell temperature, with ΔH, ΔS and ΔG from idea 31's NASA Glenn records (H2O(L), H2, O2) and idea 31's gas constant.
- E_rev = ΔG/2F and E_tn = ΔH/2F: 1.22888 V and 1.48121 V at 298.15 K.
- F is N_A × e, both exact in the SI (NIST CODATA 2022).
- At storage pressure p the cell pays the Nernst term (RT/2F) × 1.5 ln(p/1 bar), which is 114 mV at 20 MPa and 333 K. Overpotentials are assumed not to change with pressure.
- The energy is 2FV / (M_H₂O η_F), which is 20.70 MJ per kg of water at 1.9 V. What does not become the products' enthalpy is heat: 4.9 MJ/kg, 24 % of the power.
- DOE's 1.9, 1.8 and 1.6 V points come from the DOE HFTO "Technical Targets for PEM Electrolysis" table.
- η_F defaults to the ISS OGA: 28 cells at 46.9 A should make 9.4071 kg of O₂ a day by Faraday's law, and the OGA makes 9.25 (ICES-2024-101; cells from the ICES-2015 paper). That gives 98.33 %.

**Power** (`arrayPower()`). Each lit day the plant gets P(1 au) × (1 au / r)², with r and the lit hours taken from idea 45's timeline. There are no batteries.

**Liquefying** (`liquefaction()`, `cooler20()`, `sp90()`). Gas from the cell is cooled at 1 atm, using NIST WebBook (SRD 69) enthalpies for normal hydrogen, parahydrogen and oxygen.
- The cell makes normal hydrogen (three parts ortho) and nothing converts it above 20 K (no catalyst in the 90 K stage), so the gas is cooled along NIST's **normal**-hydrogen isobar.
- A 90 K stage takes that hydrogen to 90 K (3.24 MJ/kg from 333 K) and liquefies all the oxygen (0.437 MJ/kg). This is the two-stage 20 K + 90 K architecture NASA describes (NTRS 20205010721).
- The 20 K stage condenses the hydrogen as normal liquid at parahydrogen's boiling point and converts it to para: 1.72 MJ/kg, of which 527 kJ/kg is the conversion. That figure is 254 cal/mol from Weitzel et al. 1958, J. Res. NBS 60:221 ("the exothermic heat of conversion of ortho- to parahydrogen at 20° K is about 254 calories per mole" of freshly liquefied 3:1 hydrogen), with the thermochemical calorie (4.184 J, NIST SP 811).
- The check: NIST's parahydrogen isobar alone gives 4.945 MJ/kg from 333 K to para liquid, because below about 300 K its extra rotational heat *is* the ortho-para heat. Normal isobar plus NBS's conversion gives 4.962 MJ/kg, 0.35 % more; the remainder is the ortho-para energy still in the gas at 333 K, and it fades with temperature (31, 18, 12 and 7 kJ/kg at 300, 333, 360 and 400 K). The first build cooled along the para table and then added the 527 kJ/kg again, 10.7 % too much (review, below).
- The 20 K stage is NASA and Creare's reverse turbo-Brayton cooler, interpolated on its measured turndown table: 631 W at no lift, 830 W at 3 W, 1304 W at 10 W, 1642 W at 16.5 W (NTRS 20260005078, Table 2, "corrected" input power). Above 16.5 W the page adds units, each 19.2 W × 5.5 kg/W = 106 kg (NTRS 20220009350, Table 1). That 5.5 kg/W is a flight-like projection, not a weighed unit (its note 3), the 19.2 W was tested at 285 K rejection (note 1), and both exclude the drive electronics' mass and inefficiency, so the cooler's mass is projected and its power a lower bound.
- No 90 K unit's measurements are on file. It is costed at the 20 K unit's 13.95 % of Carnot rejecting at 300 K, which is 16.7 W per W, and given no mass. A refusal says so.

**Boil-off** (`mliFlux()`). The tanks are spheres just big enough for the most the stay puts in them: the peak inventory, after a day's making and before that night's boil-off (no ullage). A smaller tank leaks less, which lets more hydrogen survive, which needs a bigger tank, so the tank and the stay are solved together (`sizeAndRun()`, a damped fixed point, 25 to 35 passes, converged to 1e-9). The first build sized every tank for all of idea 45's water even when the arrays left most of it unsplit (review, below).
- The insulation is MHTB's 45-layer variable-density MLI: 0.085 W/m² at a 164 K warm boundary and 0.22 at 305 K (Hastings and Martin, NTRS 19990084079). The page uses a power law through those two points and refuses outside them.
- Leak ÷ latent heat (NIST: 446 kJ/kg for H₂, 213 kJ/kg for O₂) boils liquid away: all day with the coolers off, and only in the dark with them on (the coolers have no power at night).
- The coolers also hold that leak by day when the arrays can run them. If even that is impossible, zero boil-off is dropped, and a refusal says on how many days.

**The day.** The plant has the array energy (P × lit hours). It splits the most water it can, bisecting on the split rate so that cell power plus cooler power fits in P. Water it cannot split stays as water. Oxygen beyond the ratio the burn needs is vented before liquefaction. A day whose power is below one idling 20 K cooler (631 W) liquefies nothing, and a refusal counts those days.

**Gas** (`gasDensity()`, `tankMass()`).
- Densities come from NIST at 293.15 K, 1 to 70 MPa. At 20 MPa hydrogen's Z is 1.12.
- The tanks are thin-walled spheres, sized for the gas the stay makes: m = 3/2 · p V ρ_m · 1.4 / σ_u. The wall is t/r = 1.4 p / (2 σ_u) of the radius; above 10 % (6061-T6 past about 44 MPa) the thin-wall formula is refused as too light.
- The 1.4 is NASA-STD-5001B's metallic ultimate design factor, as PartForge's `design_factors_nasa.json` carries it. σ_u and ρ_m come from PartForge's `FLIGHT_MATERIALS`, which marks 6061-T6 "verify".
- Tank mass per kilogram of gas is pressure-independent for an ideal gas. Only Z makes it change.

**Steam** (`engineSteam()`).
- Idea 31's equilibrium is run on water vapour at the heater temperature, and idea 32 expands it.
- The heat per kg is H_steam(T) − H_liquid(293 K): 3.96 MJ/kg at 1023 K.
- Where the shifting expansion has no answer, the frozen expansion is used and a refusal says why. It may condense, or idea 32 may not reach the area ratio (Findings).
- Idea 45's concentrator reaches (C η S / σ)^¼ at most: 1712 K on the chain's first day. A hotter heater is refused as solar.

**The engine and the mixture ratio** (`engineIsp()`, `ofTrade()`).
- Reactants are idea 31's O2(L)/H2(L) records at their boiling points (liquid route) or gaseous O₂/H₂ at 293.15 K (gas route).
- Idea 31's `rocket()` gives the chamber. Idea 32's `flow()` and `stationAtArea()` give the shifting and frozen expansion at the area ratio, and `lambdaBell()` gives the divergence factor.
- Delivered Isp is ideal shifting × 0.97913. That factor is the RL10A-3-3's published 444 s (NASA SP-8120 Table I) over its ideal at its own conditions (453.46 s), from idea 32's `engineCase()`. Defaults are the RL10A-3-3's: 400 psia, area ratio 57, its bell length.
- Every station is checked to be at the area ratio asked for (Findings), and calls into idea 31 that throw are turned into refusals.
- Δv(r) = v_e(r) ln((m_dry + m_H(1 + r)) / m_dry), with all the hydrogen burned and at most the oxygen kept. The "most Δv" choice sweeps O/F from 2 to the water's 7.937 (from idea 31's molar masses, equal to its `stoichiometricOF`) and refines by golden section.
- Where idea 31 cannot expand a ratio (O/F 2 to about 2.2 at area ratio 57), the propellant mass and Δv are `null` with an `engine` refusal, not 0 kg.
- If the best ratio is below 7.94, the stay is re-run so that only the oxygen the burn uses is liquefied.

**Reusing earlier modules.** These are byte-identical snapshots (`tools/snapshot.mjs`, tested):
- idea 31's `mixture.js`, `thermo-excerpt.js`, `propellant-densities.js` and `presets.js`;
- idea 32's `bell.js`, `nozzle-charts.js`, `nozzle-rules.js`, `isa.js` and `sp8120-table1.js`.

Idea 45's committed handoff is wrapped, and idea 45's kernel was run on its Bennu case at build time and read back by its own parser.

**Handoff schema (version 1, `from: "46-split"`).** `handoff.json` is the sample: the chain with this page's defaults (46 KB).

| inputs | |
|---|---|
| `dig_handoff` | idea 45's handoff, with any handoff nested in *its* inputs (idea 44's, which holds 43's to 39's) replaced by `{pruned, from, produced, bytes, sha256}`. Nothing here reads idea 45's inputs. Carrying the cascade made this file 124 KB and the folder 652 KB, over the bank's limit. The SHA-256 is the kernel's own, tested against `node:crypto`. |
| `settings` | `{route, cell, V_custom, etaF, T_cell, array, P1au, Twb, zbo, fCarnot90, p_store_MPa, material, of_mode, of, pc, eps, Lf, T_heat, pc_steam, eps_steam, dry_kg}` (SI; full precision so a re-run reproduces the outputs) |

| outputs | units | confidence |
|---|---|---|
| `propellant` `{route, fuel, oxidizer, mixture_ratio, mass_kg, fuel_kg, oxidizer_kg, isp_s, isp_ideal_s, isp_frozen_s, ve_m_s, Tc_K, pc_Pa, eps, reactant_state, calibration, h2_left_kg, o2_left_kg, tanks or tank}` | kg, s, m/s, K, Pa | derived (assumed when idea 45's water is an upper bound) |
| `site` `{body, key, spectral_class, mass_kg, stay_start_utc, stay_end_utc, r_au_end}` | kg, au | derived |
| `dry_mass` `{craft_kg, tanks_kg, coolers_kg, total_kg, refused[]}` | kg | assumed |
| `delta_v_estimate` | m/s | derived (comparison only) |
| `totals` `{water_in_kg, water_split_kg, water_left_kg, h2_made_kg, o2_made_kg, o2_vented_kg, boiloff_h2_kg, boiloff_o2_kg, h2_end_kg, o2_end_kg, energy_J, days}` | kg, J | derived |
| `ledger` `{first_day_utc, days, P_W[], used_W[], split_kg[], buffer_kg[], h2_kg[], o2_kg[], limit[]}` | W, kg | derived |
| `electrolyser` `{V_cell, V_1bar, V_nernst, E_rev, E_tn, etaF, T_K, p_Pa, J_per_kg_water, heat_J_per_kg_water, kWh_per_kg_h2}` | V, J/kg | derived |
| `cryo` `{liquefaction_J_per_kg, sp90_W_per_W, mli_W_m2, leak_W, boiloff_passive_kg_per_day, coolers20, …}` (liquid route) | J/kg, W, kg/day | derived |
| `of_trade` `{of[], isp_s[], dv_m_s[], of_max, of_opt}` (split routes) | 1, s, m/s | derived |

**Refusals.** Ideas 40 to 45's are carried with their `from`. This module's own:
- *Always or by route:*
  - `water`: an upper bound, carried from idea 45's S-type.
  - `cleanup`: the CO₂, SO₂ and organics from a CM must be separated first; not modelled.
  - `electrolyser`: no mass on file.
  - `arrays`: the 1/r² law is checked only beyond 1 au.
  - `engine`: the RL10 factor is carried away from O/F 5.
  - `cryo_tanks`: no wall or insulation mass.
  - `mli`: MHTB's 18 m³ tank, so a lower bound for small tanks.
  - `cooler90`: no 90 K unit measured.
  - `night`: no batteries.
  - `pressure`: Nernst only, no crossover model, and the vessel standard is not on file.
  - `steam`: no flown steam thruster on file, plus the frozen-only and heater-too-hot cases.
- *When they happen:*
  - `cooler20`: days the arrays cannot run even one idling 20 K cooler.
  - `zbo`: days the arrays idle a cooler but cannot also hold the tanks' leak.
  - `power`: water left unsplit.
  - `propellant`: nothing left to burn (or no water to boil).
  - `engine`: idea 31 cannot expand the chosen ratio (the propellant is then `null`).
  - `tank`: a thin-walled tank past 10 % wall-to-radius.
- *For bad inputs:* `invalid_input` for settings and handoffs, and `out_of_envelope` for a cell outside 280 to 360 K, a voltage at or below reversible, a warm boundary outside MHTB's 164 to 305 K, or a pressure outside NIST's 1 to 70 MPa.

**Reading one back** (`parseHandoff`). This page's own handoff is re-run from its inputs and must reproduce its propellant (to 1e-6) and its refusal codes.

**For module 47** (Homeward), which takes "propellant + asteroid":
- `propellant.mass_kg`, `isp_s` and `mixture_ratio`;
- `dry_mass.total_kg`;
- `site.stay_end_utc`;
- `cryo.boiloff_passive_kg_per_day`, because the liquid keeps boiling until the departure burn.

On the chain that is 7.1 kg at 423 s on 593 kg dry: about 50 m/s. Module 47 will have to refuse a return on that.

## Tests

`split.test.mjs`, 11 tests, Node built-ins, about 1 s:

1. **Snapshots.**
   - Every sidecar's sha256 matches its file and names repo, path and commit. The nine files from ideas 31 and 32 are byte-identical to the committed ones.
   - The wrapped chain handoff is idea 45's `handoff.json`, its nested idea 44 handoff replaced by a digest equal to `node:crypto`'s SHA-256. The kernel's own SHA-256 matches `node:crypto` on six test strings, including the 55/56/64-byte padding edges and non-ASCII text.
   - 33 quotes were found in their sources (including the cooler's "flight-like projections" note), F = N_A·e, and PartForge's 6061-T6 row is as the PartForge checkout prints it.
2. **The oracle: NIST-JANAF.** E_rev and E_tn from idea 31's NASA Glenn data against −Δ_fG°/2F and −Δ_fH°/2F of JANAF's liquid water at 280, 298.15, 300, 320, 340 and 360 K agree within 0.05 mV (measured 0.018 mV and 0.0023 mV). The suite also checks a Gibbs-Helmholtz identity, the Nernst term by hand (114.08 mV at 20 MPa), and refusals at 270 and 361 K.
3. **The cell.**
   - Faraday by hand (20.35185 MJ per kg of water at 1.9 V).
   - Product fractions that sum to 1, and the water's O/F equal to idea 31's `stoichiometricOF`.
   - DOE's three points reproduced at +1.60, +2.27 and +1.48 %, each pinned between 1 and 2.5 %.
   - The ISS OGA's 9.40713 kg/day at 100 % and 98.330 % implied.
   - A cell at 1.15 V refused, and the gas route paying the Nernst term.
4. **Arrays.** The 1/r² law against NEAR (−7.02 % at 2.2 au) and Psyche (−17.2 % at 3.32 au, −3.51 % at 2.53 au), and the chain's first-day power.
5. **Cryogenics.**
   - NIST's normal-hydrogen latent heat against NBS 1958's 216 cal/mol (+0.09 %; parahydrogen's is −0.50 %), the LOX and LH₂ densities against idea 31's, the 527.18 kJ/kg conversion by hand, and the liquefaction loads interpolated by hand from NIST's normal-hydrogen rows (3.2407 and 1.7218 MJ/kg).
   - The oracle for the liquefaction: NIST's two hydrogen fluid models must agree on the total once the conversion is counted once. Normal table plus NBS conversion against the para table alone is positive, under 1 % and falls with temperature at 300, 333, 360 and 400 K (the double-counted first build read 10.7 % high).
   - The cooler reproduces its table, adds units past 16.5 W, and its transcription is self-consistent (lift / input / Carnot = the table's own % of Carnot to 0.15 points).
   - MHTB's two points are reproduced exactly and nothing outside them is used.
   - The chain's first-day boil-off by hand, with the coolers on (dark hours only) and off (all day); passive tanks end up smaller.
6. **Tanks.**
   - The NIST rows at 20 MPa; hydrogen Z between 1.10 and 1.15 and oxygen's under 1.
   - A 1 m sphere at 10 MPa in 6061-T6 worked by hand: 766.14 kg.
   - Tank per kilogram depends on pressure only through the gas's density, and gets heavier for hydrogen.
   - The tanks are for the gas made, hydrogen's Z by hand (1.12472670), the thin-wall limit (70 MPa aluminium refused at 15.8 %, 20 MPa not), and the steam route's water tank by hand from NIST's water density at 293.15 K.
7. **The oracle: NASA CEA 3.3.4.** 36 vacuum Isp values (liquid and gas H₂/O₂ at O/F 2.5 to 7.94 at the RL10's conditions; steam at 1023 to 2500 K), shifting and frozen, divided by idea 32's divergence factor, agree within 3 ppm (measured 1.2 ppm). So do the chamber temperatures. Idea 32's misplaced station (ε 9.287 for 10) is reproduced and refused here, idea 31's TypeError is reproduced and turned into a refusal, and CEA's own full run condenses 5.9 % liquid where idea 31 refuses. The RL10A-3-3 factor is 0.979132.
8. **The mixture-ratio trade.** On the chain the optimum is the water's ratio. At 16 kg of propellant per kg dry it is exactly 7.94; at 19 it is already inside. Bisection on the sign of dΔv/d(O/F) at 7.94 puts the edge at 17.29 to 1 (liquid) and 17.76 (gas). At 2,000 kg of hydrogen on 100 kg dry brute force on a 0.05 grid agrees with the golden section. Oxygen-limited cases burn less hydrogen.
9. **The stay.**
   - Nine runs (chain cryo, gas and steam; Bennu cryo with NEAR, Psyche and 900 W arrays, gas with NEAR and Psyche, steam): water in = split + left, hydrogen kept + boiled = made, oxygen kept + boiled + vented = made, and no day uses more power than the arrays give.
   - Pins: the chain's 7.11154 kg at 423.300 s, 0.469 kg of hydrogen boiled, gas 11.306 kg at 432.243 s, steam 176.179 s.
   - Bennu: NEAR's 24.056 kg, one cooler, 90 power-limited days; Psyche's 765.32 kg and 3 coolers; gas with Psyche 5,342.8 kg dry home, gas with NEAR 1,604.8 kg (tanks for the 184 kg it makes, by hand).
   - Tank sizing: on four stays (one whose mining stops half way, so it peaks mid-stay) the hydrogen and oxygen tanks equal the fullest day, the fixed point converged, and no day overfills.
   - The gas route is linear in power. A 900 W array cannot idle a cooler on any of 90 days (`cooler20`, 0 kg); 1,160 W idles one but drops zero boil-off on 14 days (`zbo`), never overdrawing.
   - O/F 2 fixed: the propellant and Δv are `null` with an `engine` refusal, no "O/F null" text, and the handoff reads back. Steam with no water refuses.
   - The steam heat is checked by hand (3.96016 MJ/kg).
   - A plant with weightless coolers and a 1 kg craft has an interior optimum: the stay is re-run until the oxygen kept is the ratio times the hydrogen.
10. **The handoff.** It reads back, also as a `#h=` link. `handoff.json` is exactly what its inputs give. An edited propellant mass and a dropped refusal are refused.
11. **Refusals the inputs raise.**
    - Bad handoffs: garbage, a non-handoff, version 2, idea 44's handoff (pointed to idea 45), an edited day of idea 45's water, an edited total, and wrong units.
    - Twelve bad settings.
    - A 2000 K heater beyond idea 45's mirror (1712.303 K by hand from 300 × 0.85 × 1911.587 W/m²; Bennu's 1351.387 K).
    - The always-on refusals by route.

**Teeth.** The table below is the builder's run on the first build (`ea3a9d3`). The review then ran 35 more single sabotages of the revised `split.js` in a scratch copy, by script, and the suite catches **35 of 35**:
- 24 of the reviewer's own on the builder's code paths (O₂ latent heat for H₂ boil-off, passive tanks boiling only in the dark, sphere area as V^1.5, the safety factor dividing, stagnation from 1 au sunlight, oxygen liquefied to hydrogen's liquid zero, divergence factor dropped, the Δv trade on ideal Isp, a 2e-2 import tolerance, cooler units rounded down, the dry total without tanks, cell heat from ΔG, kWh/kg on water's mass, rMax as a max, a loose station check, the 90 K leak dropped from zero boil-off, water at 1000 kg/m³, steam heat from 298 K, the stay ending a day early, a bent MLI exponent, the cleanup refusal dropped, the 1 au note inverted, passive boil-off per hour, Z at 298 K). The first pass missed two (water density, Z's temperature); test 6 now pins both by hand.
- 11 on the review's changes (cooling along the para table, the conversion dropped, normal liquid at its own boiling point, tanks for all the water, tanks sized from the last day, the idle-cooler refusal dropped, an engine refusal shown as 0 kg, the carried-factor refusal on a null ratio, a 20 % thin-wall limit, the steam no-water refusal dropped, the latent-heat row on para). "Tanks sized from the last day" passed until test 9 gained the stay that stops mining half way.

The builder's method: single sabotages of `split.js`, each alone, in a scratch copy of the bank (ideas 31, 32, 44 and 45 linked in), the whole suite run on each.
- The first run caught 33 of 36. The three it missed showed gaps: no case where the arrays cannot run the zero-boil-off coolers, the steam heater's energy never pinned, and no run with an interior mixture-ratio optimum. Test 9 now covers all three.
- Two sabotages aimed at the SHA-256 and the pruning came next. The pruning one passed every test, because every test fed in an already-pruned handoff; test 10 now imports idea 45's full committed handoff.
- The final run, on the code as committed, caught **38 of 38**.

| Sabotage | Failing tests |
|---|---|
| E_rev from ΔH instead of ΔG | 2, 10 |
| One electron per water, not two | 3, 9, 10 |
| Faraday efficiency multiplied in | 9, 10 |
| Nernst sign flipped | 2, 3, 9, 10 |
| Nernst without the 3/2 | 2, 3, 9, 10 |
| Oxygen per kg of water without the ½ | 3, 10 |
| Arrays fall off as 1/r | 4, 9, 10 |
| Ortho-para heat left out | 5, 9, 10 |
| International-table calorie for the thermochemical one | 5, 9, 10 |
| One 20 K cooler however large the load | 5, 9 |
| 90 K stage at Carnot | 5, 9, 10 |
| MLI flux flat at the hot point | 5 |
| Boil all day even with zero boil-off | 5, 9, 10 |
| Latent heat as h_v alone | 5, 10 |
| Tank without the safety factor | 6, 9 |
| Tank as 3 pV instead of 3/2 | 6, 9 |
| Delivered Isp = ideal (no RL10 factor) | 9, 10 |
| Delivered from frozen, not shifting | 9, 10 |
| Fuel not limited by the oxygen left | 8 |
| Station area-ratio check removed | 7, 9 |
| Power limit ignored | 9 |
| Unburnable oxygen kept, not vented | 9, 10 |
| Import skips idea 45's day arithmetic | 11 |
| Carried refusals dropped | 9, 10 |
| Read-back ignores refusals | 10 |
| Split water not taken from the buffer | 9, 10 |
| Power over 24 h instead of the lit hours | 9, 10 |
| Zero-boil-off overhead never checked (first run: missed) | 9 |
| Steam heat from vapour at 293 K (first run: missed) | 9 |
| Stagnation with a square root | 11 |
| OGA with 2 electrons per O₂ | 3, 9 |
| Oxygen tank leak from the hydrogen tank's area | 9, 10 |
| Cryo tanks sized from the vapour density | 5, 9, 10 |
| Liquefaction from the upper stage, not the cell temperature | 5, 9, 10 |
| Optimal O/F never iterated (first run: missed) | 9 |
| SHA-256 with a wrong rotation | 1, 10 |
| Upstream handoff not pruned (second run: missed) | 10 |
| Dry mass leaves out the coolers | 10 |

Caught by one test only:
- test 5 alone catches the MLI flux;
- test 8 alone catches the oxygen limit on fuel;
- test 9 alone catches the power limit and the three gaps the first run found;
- test 10 alone catches the read-back of refusals, the cooler mass and the pruning;
- test 11 alone catches the import's day check and the stagnation exponent.

`ui-check.mjs` runs 80 checks in headless Chromium:
- **Tiles and refusals.** The tiles equal the kernel's (propellant, Isp, O/F, Δv, boil-off, coolers) and carry the right chips (the chain's propellant `assumed · at most`, Bennu's `derived`). The own and 23 carried refusals are shown.
- **Charts and tables.** All six charts are drawn. The reality table has no NaN and shows NEAR's −7.02 % and the OGA's +1.7 %. The three-route table equals the kernel's runs.
- **Controls.**
  - Switching to gas shows its tanks and refusal, and 50 MPa gives the kernel's tanks.
  - Steam is frozen and says so, and a 2000 K heater is refused as solar.
  - Passive boil-off equals the kernel.
  - A click on the mixture chart at O/F 5 sets it, with the kernel's Isp, less Δv and no carried-calibration refusal, and the arrow keys step it. A click at its left edge (O/F 2) shows the propellant refused, not 0 kg, with no "null" on the page. (The first build's check here ended in `|| true` and could not fail.)
  - A 250 K cell and a 1.15 V cell are refused.
- **Handoff.**
  - The download reads back in the kernel.
  - Garbage, idea 44's handoff and an edited idea 45 handoff are refused, and the sample imports and matches.
  - A `#h=` link with idea 45's Bennu handoff opens Bennu: NEAR gives the kernel's 24.06 kg, 900 W gives 0 kg with the idle-cooler refusal, Psyche gives the kernel's 765.3 kg.
- **Phone.** At 390 px in dark and light: no overflow, the right background, no text under 11 px, charts drawn, a tap switches the route, no NaN, and no console errors.

`node tools/check.mjs ideas/46-split` passes (README, sidecars, tests, `check.mjs`, smoke at 1280 and 390 px).

## Honest assessment

- **What the independent review changed** (the first build was `ea3a9d3`; every change below is tested):
  - **[Certain] The liquefaction load counted the ortho-para heat twice.** It cooled the cell's normal hydrogen along NIST's *parahydrogen* isobar (3.73 MJ/kg to 90 K), whose extra rotational heat below about 300 K is the conversion heat, and then added NBS's 527 kJ/kg again: 5.47 MJ/kg in all against 4.96. The review fetched NIST's normal-hydrogen isobar (`oracle/fetch-sources.sh`, `snapshots/split-sources.js`), cools along it (3.24 MJ/kg to 90 K, 1.72 MJ/kg at 20 K) and checks the total against the para table (0.35 % apart at 333 K, falling with temperature). Alone this moved Bennu with Psyche's arrays from 715.5 to 735.1 kg and left the chain unchanged (its cooler idles).
  - **[Certain] Every tank was sized for all of idea 45's water, split or not.** At Bennu, NEAR's arrays split 23.5 kg of 1,131 into a 1.79 m³ hydrogen sphere whose 1.6 W leak boiled 0.15 kg a night against 0.03 kg made a day, so the first build reported 0 kg and said NEAR's arrays "cannot run a 20 K cooler". They can: the cooler idled on all 90 days. Gas tanks carried 4,463 kg of aluminium for 184 kg of gas. Tanks are now sized for their fullest day (`sizeAndRun()`), which gives Bennu/NEAR 24.1 kg, Bennu/Psyche 765.3 kg, the chain 7.11 kg (from 5.62) and Bennu's gas route with NEAR 1,605 kg dry home (from 5,343).
  - **[Certain] "Until the propellant outweighs the dry craft about 90 to 1" was false.** The water's 7.94 stops being the best ratio at about 17 to 1 (17.29 liquid, 17.76 gas). The first build's own test sat at 17.9 to 1, where the optimum is already 7.92, and passed on a 0.05 tolerance. Test 8 now bisects the edge.
  - **Placeholder zero and "O/F null".** At a fixed O/F of 2 to 2.2, where idea 31 cannot expand, the page showed "0 kg, nothing left to burn" and a refusal reading "At O/F null that factor is carried". The propellant and Δv are now `null` with the `engine` refusal, and the tile says the engine model refused.
  - **New refusals:** `cooler20` (arrays below one idling cooler, which the old `zbo` refusal only covered by accident of tank size), `tank` (thin-wall formula past 10 % of the radius: 70 MPa aluminium is 15.8 %, and a 10¹⁷ Pa steam tank had weighed 2 × 10¹⁰ kg without comment), and `propellant` for steam with no water.
  - **Labels and citations.** The cooler's mass is a projection and its power excludes the electronics (the tile said "measured"); NBS's 216 cal/mol is normal hydrogen's (the reality row compared parahydrogen); the "ISRU yields are theoretical" quote is in Aster's slice-14 provenance file, not slice-15's; the redirect planner's S-type water is 100 to 300 times idea 45's, not "up to about 100".
  - **Tests.** Pins re-derived; a vacuous UI check (`|| true`) replaced; new pins for the steam tank, hydrogen's Z and the stagnation temperature (to 1e-3 K, from a 0.5 K band); 35 new sabotages, all caught (Tests).
  - **Checked and found sound:** all 33 quoted figures re-fetched and found in their sources (the regenerated `split-sources.js` was byte-identical before the additions); NASA CEA 3.3.4 re-run in a fresh venv reproduces `oracle/cea-split.json` exactly; E_rev from JANAF (1.228898 V vs 1.228882 V), the OGA's 9.40713 kg/day, the 44.6 kg of gas tanks and the chain's boil-off were recomputed by hand; idea 45's kernel, re-run on its two cases and nine other settings, exports handoffs this page imports through `#h=` links, runs on all three routes and reads back (one refusal: steam's default heater is idea 45's peak, below this page's 500 K floor, when idea 45 heats to 200 °C).
- **[Certain as measured] The thermodynamics and the Isp.** Electrolysis energies from idea 31's NASA Glenn data match NIST-JANAF's liquid water within 0.018 mV (E_rev) and 0.0023 mV (E_tn) over 280 to 360 K. Every vacuum Isp the page computes at its conditions matches NASA CEA 3.3.4 within 1.2 ppm over 36 cases, once idea 32's misplaced station is refused. These are checks of the computation, and they hold.
- **[Likely] The cell's energy.** At DOE's stated voltages and its 2.5 % crossover, Faraday's law gives 1.5 to 2.3 % more kWh per kg of hydrogen than DOE's own table. DOE's figures are rounded and may assume another basis, so the page is conservative by about that much. The ISS OGA implies 98.3 % Faraday efficiency from its published current and output, but those are a "selectable rate, up to" specification, not a measured efficiency. The cell voltage is a DOE stack figure for terrestrial stacks; no flight cell at these current densities is on file.
- **[Likely] The arrays.** The 1/r² law reads 7.0 % low for NEAR at 2.2 au and 3.5 to 17 % low for Psyche beyond 2.5 au, because arrays run cooler and are often designed for low light. The chain sits at 0.75 to 0.84 au, inside every check. There hotter cells make the law likely optimistic, by an amount nothing here measures.
- **[Likely] Liquefaction and boil-off.**
  - The 20 K stage's *power* is measured hardware on its measured curve, but it is the paper's "corrected" input power, and NASA's KPP table says its figures exclude the drive electronics' inefficiency, so the cooler power here is a lower bound. Its *mass*, 5.5 kg/W, is a flight-like projection (that table's note 3), not a weighed unit. The 90 K stage is not measured at all: it is costed at the 20 K unit's 13.95 % of Carnot, and real 90 K coolers are usually more efficient, so that part is [Speculative] and probably pessimistic.
  - [Certain as arithmetic] The heat removed is NIST's normal-hydrogen isobar plus NBS 1958's conversion, which agrees with NIST's parahydrogen isobar to 0.35 % at 333 K; what remains is the ortho-para energy still in the gas there.
  - MHTB's insulation was measured on an 18 m³ tank. The chain's 11 L hydrogen sphere will leak more per m² through supports and lines, so the boil-off here is a lower bound.
  - The tanks are sized for their fullest day with no ullage; a real tank needs a few per cent more volume and so leaks a little more.
  - The ortho-para heat is read from a 1958 OCR'd sentence ("about 254 calories per mole") as per mole of normal hydrogen; it agrees with the 527 kJ/kg other sources give.
- **[Certain as arithmetic, on the assumptions above] On the chain** (Apophis, NEAR's arrays, liquefied, defaults):
  - The arrays give 2.5 to 3.2 kW while the Sun is up (11.9 h a day on average), and the plant splits all 11.3 kg of water.
  - The 20 K cooler's idle power takes 92 % of the energy: it runs every lit hour to hold a 0.05 W leak.
  - The coolers have no power at night, so 0.469 kg of the 1.265 kg of hydrogen (37 %) boils away in the dark.
  - Burned at the water's 7.94, that leaves 7.11 kg at 423.3 s, in an 11.2 L hydrogen and an 8.1 L oxygen sphere.
  - With one 106 kg cooler carried home on 487 kg, it buys 49.5 m/s. Gas at 20 MPa keeps all 11.3 kg at 432 s in 44.6 kg of aluminium (89 m/s). Steam keeps 11.3 kg at 176 s (40 m/s).
  - Every one of these is an upper bound, because the water is.
- **[Certain as arithmetic, on the assumptions above] At Bennu** (1,131 kg of water over 90 days at 1.35 to 1.24 au):
  - NEAR's arrays (about 1.0 to 1.2 kW there) idle one cooler (631 W) and have the rest for splitting: 33.4 kg of water on 90 power-limited days. 28 % of the 3.74 kg of hydrogen boils, leaving 24.1 kg at 423.3 s, 100 m/s on 986 kg dry.
  - Psyche's arrays (about 11 to 14 kW there) split 859 kg with three coolers, and 11 % of the hydrogen boils. That leaves 765.3 kg at 423.3 s, 2,052 m/s on 1,197 kg dry, at 55 MJ per kg of water split (21 of them in the cell).
  - Gas with Psyche's arrays keeps all 1,131 kg at 432 s, but in 4,463 kg of aluminium spheres (814 m/s). With NEAR's it makes 184 kg in 725 kg of spheres (459 m/s).
  - Steam keeps all 1,131 kg at 176 s in a 21 kg tank (1,406 m/s on 901 kg).
- **[Certain as arithmetic; Likely as advice] The mixture ratio.** The water's own 7.94 buys the most Δv for any craft the page can build. The Isp lost from O/F 5 to 7.94 (444 to 423 s at the RL10's conditions) is worth less than the extra mass of oxygen until the propellant outweighs the dry craft about 17 to 1 (17.3 liquid, 17.8 gas, by bisection). The most any plant here reaches is about 12 to 1 (a weightless craft, 10 MW of arrays and a year at Bennu), because each 20 K cooler weighs 106 kg; so the iteration that re-runs the stay for an interior optimum is tested only with a synthetic weightless-cooler plant. **[Speculative]** It is an open question whether an engine can run at 7.94: the delivered-Isp factor is the RL10's at O/F 5, carried, and the chamber is about 3,460 K. A refusal says so.
- **[Speculative] The steam route's Isp.**
  - It is ideal: no flown steam thruster's measured Isp is on file to calibrate it.
  - At the default 1023 K, 10 bar and area ratio 10, the shifting expansion has no answer here (Findings). The frozen value, 176 s, is used; at these temperatures the two differ by ppm wherever both exist.
  - The heater is either idea 45's concentrator, which is refused above 1712 K, or an electric heater whose power is shown per kg, not budgeted.
- **What is rough or cut.**
  - *No electrolyser mass, no pumps, dryers, power conditioning or water purification.* The electrolyser stays on the asteroid, and the CM's CO₂, SO₂ and organics are assumed separated (refused, not modelled).
  - *No batteries:* the plant runs only while the Sun is up.
  - *No cryogenic tank walls or MLI mass, and no 90 K cooler mass.* The liquid route's dry mass is therefore too light; refused and listed in `dry_mass.refused`.
  - *No radiators* for the cell's heat (4.9 MJ per kg of water) or the coolers' rejection.
  - *Cut:* steam or solid-oxide electrolysis, a polarization-curve cell, mechanical compression, and gas or COPV tanks (PartForge's composites are "recall" rows). Also cut: pressure-vessel standards (ANSI/AIAA S-080 is not on file; NASA-STD-5001B's structural factor stands in) and two-phase steam nozzles.
  - *Idea 45's day-by-day water* is used as handed on: rounded to 6 significant figures, arriving evenly over each day.
  - *Size.* 559 KB as the checker counts after the review (528 KB before; NIST's normal-hydrogen table and the new tests): over the 500 KB budget, under the 650 KB limit. Ideas 31's and 32's kernels and data are about 165 KB of it, idea 45's two handoffs 40 KB, and this page's sample handoff 46 KB.
- **Findings about earlier modules.**
  - **Idea 32's `stationAtArea()` can return a station at another area ratio without refusing** (`ideas/32-bell/bell.js:227`: `if (hi - lo < 1e-13) { st.iterations = k + 1; return st; }` returns the last converged station when the bracket collapses).
    - Steam at 1023 K, 10 bar, asked for ε 10, gets ε 9.287 back, and an Isp 0.42 % under NASA CEA's.
    - The bracket collapses because idea 31's equilibrium refuses some steps toward it (next finding).
    - This page checks every station's ε and refuses the mismatch; test 7 reproduces it.
  - **Idea 31's `equilibrate()` throws instead of refusing when a converged state falls below its 200 K data floor.** In `ideas/31-mixture/mixture.js:423`, `properties()` reads `thermoAt(...).cp` with no null check; the iteration checks each step, but `properties()` re-evaluates at the converged T.
    - LOX/LH2 at O/F 2, 400 psia, ε 57 throws `TypeError: Cannot read properties of null (reading 'cp')` through idea 32's `stationAtArea()`.
    - For nearly pure steam, the SP solve turns singular below about 0.2 bar when started from the throat's state, though it converges from a nearby station.
    - This page wraps every call and refuses.
  - **Idea 45 rounds its timeline to 6 significant figures and its totals to 9** (`ideas/45-dig/dig.js:423`, `r6` against `r9`). Its day-by-day water times regolith fraction holds only to about 1e-5 at Bennu. Harmless, but any importer must allow for it; this page uses 2e-5.
  - **The handoff cascade outgrows the bank.** Idea 45's handoff is 97 KB, 75 KB of it idea 44's (which holds 43's to 39's). Nested whole once more it made this folder 652 KB, over the 650 KB limit; hence the digest (see the schema). Module 47 will meet the same wall.
- **Findings about the sources.**
  - NIST-JANAF table H-063 (liquid water) prints its 380 K row's Δ_fH° and Δ_fG° without minus signs ("283.237  224.102", retrieved 2026-11-01). That row is the metastable liquid above the 1 bar boiling point and is not used here.
  - DOE's PEM table cannot be reproduced exactly from its own voltages and stated crossover: the kernel gets 1.5 to 2.3 % more energy (above).
  - NBS 1958's "216 calories per mole" heat of vaporization is freshly made (normal) liquid hydrogen's: NIST's normal hydrogen gives 216.2 (+0.09 %), its parahydrogen 214.9 (−0.50 %). The first build compared it with parahydrogen.
  - NTRS 20220009350's Table 1 notes that its 5.5 kg/W is a flight-like projection, that the tested lift needed 285 K heat rejection, and that none of it includes the drive electronics.
- **Findings about the source repos.**
  - **Aster (`62ddb17`): the legacy redirect planner gives every asteroid the same water.** In `src/workers/physics/planner/redirect.ts:111-119`, `mineable_kg = mass_kg * 0.05` and `water_kg = mineable_kg * (1 - miningFraction)` for every spectral type.
    - It prices that water at $1,500/kg (C), $500/kg (M and others) with literals and no provenance.
    - An S-type therefore holds 5 % × (1 − f) water, where idea 45 found Itokawa's measured bulk silicate holds 160 to 510 ppm: at f = 0 that is about 100 to 300 times less.
    - It also has no step from water to propellant: it counts no joules, no boil-off and no tank mass.
    - Its research folders cite a ChatGPT Deep Research synthesis (`src/v2/research/slice-15-isru/PROVENANCE.md`) whose own stated gap is "ISRU yields are theoretical, no flight data" (listed in `src/v2/research/slice-14-composition/PROVENANCE.md:19`; the first build attributed the quote to the slice-15 file).
  - **PartForge (`0974a62`): `data/tables/design_factors_nasa.json` has no pressure-vessel or propellant-tank burst factor**, only the 1.05 proof-test note for tanks; the word "burst" does not occur. Tank sizing here had to borrow NASA-STD-5001B's structural ultimate factor, 1.4. `FLIGHT_MATERIALS` marks 6061-T6 and Ti-6Al-4V `verify: true`; the page shows it.
- **Gates not passed.** None of Aster's gates has been passed:
  - the multi-agent math audit;
  - oracle validation in Aster's own harness (JANAF, CEA, DOE, OGA, NEAR and Psyche here are this folder's fixtures);
  - the founding-doc DEC process;
  - the protected core (`src/v2/core/**`).

  PartForge's data provenance pipeline has not reviewed the use of its metals for pressure vessels.

## Where it would land

- **Aster, the MCP server** (`mcp/src/tools/`). A `propellant_from_water` tool could return `propellant`, `totals` and `cryo` in the evidence envelope for a body, a plant and a route. It would refuse with `insufficient_data` for any body whose water is an upper bound and for the masses not on file.
  - It needs idea 45's `water_yield` first.
  - It needs the envelope's `invalid_input` code that ideas 31 to 45 noted.
  - To ship: the multi-agent audit of the cell, liquefaction and tank arithmetic; a DEC on which cell and cooler data are canonical (DOE's stack points and NASA's 20 K turndown, or newer flight data); and a measured 90 K cooler and electrolyser mass.
- **Aster's legacy redirect planner** (`src/workers/physics/planner/redirect.ts`). Replace the class-blind 5 % water and the $/kg literals with a class-based water content (idea 45) and a water-to-propellant step (this module) that carries its refusals.
- **PartForge** (`data/tables/design_factors_nasa.json`). Add a sourced pressure-vessel row (ANSI/AIAA S-080/S-081 burst and proof factors) before any tank is sized from its metals.
- **The Long Way Round.**
  - Module 47 (Homeward) takes `propellant`, `dry_mass`, `site.stay_end_utc` and the boil-off rates (which are now those of tanks sized for what they hold). On the chain it gets 7.1 kg at 423 s on 593 kg dry and should refuse a return; at Bennu with Psyche's arrays, 765 kg on 1,197 kg. It must accept `propellant.mass_kg: null` with an `engine` refusal.
  - Module 50 chains it, with the `water` upper bound carried to the end.
