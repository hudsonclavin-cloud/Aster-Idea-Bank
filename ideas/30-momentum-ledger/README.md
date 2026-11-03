# Momentum Ledger
> One 5-tonne throw at Skyhook's Rev A reference takes 43.03 MJ/kg (215 GJ) out of the tether system and, before any reboost, drops its perigee 125 km (lower tip 290 → 165 km at the 200 t placeholder hub; Skyhook's own 17-node tether model gives 168 km); putting it back inside the founding document's 5–10-day rule with 30 % margin needs 2.49–4.98 MW at 26 % efficiency and duty 0.5, and 24.9 MW at the 1-day mature interval, against the "100 kW–1 MW" the same document calls meaningful.

**Kind:** explorable
**For:** Skyhook
**Run:** open `ideas/30-momentum-ledger/index.html` in a browser (classic scripts, works from `file://`, no network). The command-line twin, in `finance/reboost_bound.py`'s table format: `python3 ideas/30-momentum-ledger/reboost_bound_rev_a.py [--tier reference|cislunar|phase3] [--derate 0|0.15|0.3] [--hub-t T] [--payload-kg KG] [--release canon|loaded] [--floor-km KM] [--json] [--skyhook DIR]` (`--help`; exit 0 printed, 1 a self-check failed, 2 refused, 3 usage; `example.txt` is its saved output). Tests, from the bank root: `node --test ideas/30-momentum-ledger/ledger.test.mjs` (23 tests, about 1.5 s, including three runs of Skyhook's tether model), `python3 -m unittest discover -s ideas/30-momentum-ledger -p 'test_*.py'` (10 tests) and `node ideas/30-momentum-ledger/ui-check.mjs [--shots DIR]` (65 checks in headless Chromium with the globally installed Playwright; the folder's `check.mjs` runs it for `tools/check.mjs`). `python3 ideas/30-momentum-ledger/build_data.py` rebuilds the snapshots and `data.js` from `/home/user/skyhook` (read-only); `--check` says whether they are stale.
**Made by:** Ledgerline

## What it is

The bookkeeping for one catch-and-throw by the Rev A tether, in three columns, for the three tiers `params/rev_a.json` defines (2.5 km/s reference, 2.8 km/s cislunar option, 3.5 km/s Phase 3 option):

1. **What one throw takes.** The payload is caught at the lower tip and let go at the upper tip. With nothing dissipated, the tether system loses the orbital energy the payload gains: 43.03 MJ/kg at the reference, 215 GJ for the 5,000 kg design payload, split into 37.78 MJ/kg of speed and 5.25 MJ/kg of lift.
2. **Putting it back.** Recovery time at any installed power, efficiency and duty (log slider, presets from every place the repository names a value), against the founding document's sizing rule drawn as a band; the installed power that rule needs at every efficiency and duty; the same at the financial workbook's own mature cadence, with the array mass that implies; and what the program site's "ED reboost: ON" button amounts to on this system.
3. **The orbit in between.** What the throw does to the tether's own orbit before any reboost: the semi-major-axis drop, the centre of mass dropping at the throw point, the perigee half an orbit later and the lower tip's lowest altitude; how many un-reboosted throws a chosen tip-altitude floor allows (every catch at apogee, or every catch at perigee), and the smallest hub that keeps one throw above the floor. A table sets this ledger beside the judged proposal's impulsive model and beside **Skyhook's own tether model** (`tools/twin/physics.js`, verbatim), which a button runs through the catch, the swing, the throw and one orbit in the browser.

Then the page checks itself against what Skyhook publishes (the canon's printed C3 and apogee for every tier; `reboost_bound.py`'s golden energy, its 24-row recovery grid and its six minimum powers, all reproduced), applies the same ledger to the DRAFT in-space fork that `reboost_bound.py` covers, lists what it refuses to say, and shows every cited source line as read.

Inputs you control: tier; fibre derate (0 / 15 / 30 %, only where the canon prints a fibre mass); hub mass, an explicit **[Speculative]** input defaulting to the 200 t placeholder of `physics/tether_dynamics.py:77`; payload up to the 5,000 kg design payload; and the release state (as the canon promises it, or where a loaded tether at the canon spin rate actually lets go, see below).

**History.** This idea was begun before the bank's 2026-10-26 hold, stopped part-way, rebuilt by replaying its builder's transcript (kernel, Python CLI, page and both test suites existed; no README, no ui-check), recovered from `hold/ideas-20-30` and finished on 2026-11-03. Finishing it meant re-verifying every citation and number against the Skyhook checkout, then: the program-site comparison (two more cited lines, a kernel function and its test), a corrected array-mass statement (the original said the finance model never books array mass; it does, inside the hardware mass factor), a touch-tooltip fix, phone-width charts, two tests and one ui-check that close mutations the earlier suites let through, `ui-check.mjs`, `check.mjs` and this README. An independent review on the same day then made the ledger refuse a tip that one throw takes underground and a floor below the ground (see Honest assessment).

## Why I made it

**The open item.** Skyhook bounds the energy of reboost only for its non-canonical in-space fork: `finance/reboost_bound.py:1-5` "reads params/service_mxer_draft.json", and its scope line (`:35-43`) says "The full orbit-integrated ed_reboost.py remains the open workstream named by the external review". Nothing computes the same for the Rev A ladder. The founding document states a sizing requirement, "restore the momentum of one full design-payload boost within the planned inter-catch interval (initially 5–10 days, shrinking to < 1 day at maturity) with 30% margin" (`docs/project_instructions.md:145`), and says "Power levels of 100 kW–1 MW yield meaningful daily momentum restoration" (`:143`); nothing in the repository checks one against the other. The glossary defines the *momentum ledger* (`docs/glossary.md:35-36`: every upbound throw is a "withdrawal" and the "tether orbit drops") without saying by how much, and the founding document says "ballast mass improves catch dynamics" (`:118`) without a number. I checked each citation in the judged proposal against the checkout at `34935cb`; all hold, with the line numbers above.

**What other deposits already cover, and what this adds.** Idea 14 (*Whose Earth*) already reconciles the energy per kilogram the repository states four ways (37.78 MJ/kg in `finance/skyhook_finance.py:215`, 43.03 by orbital energy, 44.8 in MP-001 `:37`, "~30" in `docs/project_instructions.md:218`), runs a 144-reading sweep that fails to reproduce 44.8, and reproduces the decision grid's reboost line. This page shows that table for context, credits idea 14, books the 43.03 orbital-energy figure and does not re-argue it. What it adds, which no other deposit does: the time and installed power to put a throw back for each Rev A tier against the founding rule, what a throw does to the tether's orbit before reboost, how many throws a tip floor allows, the hub that a floor needs, a cross-check against Skyhook's own tether model through a loaded catch and throw, and the same orbit ledger for the in-space fork. Idea 16 (*Spin Wobble*) studies the unloaded twin's spin and says "no payload at catch"; this one is the loaded case. Ideas 01 and 04 found that `rev_a.json` carries two Earth radii; I cite that rather than rediscover it. Idea 08 (*Blue Cells*) reads the workbook's Assumptions sheet; I read five of its rows the same way (`zipfile` + `xml.etree`).

**Alternatives I weighed.**

- *The proposal's impulsive model* (two tangential impulses m·v_tip/(M+m) + m·v_tip/M at one point, perigee drop 2Δa). Implemented exactly as written, it gives the proposal's 30.8 m/s, 57 km, 114 km and 176 km. It is kept as a comparison column, not as the ledger, because it misses Skyhook's own tether model by about 10 % on the semi-major-axis drop: it leaves out the payload's lift through the gravity well (12 % of the energy) and the centre of mass dropping when the loaded tether flips.
- *Integrating every throw in Skyhook's tether model.* It is the better physics, but one throw plus one orbit is about 63,000 RK4 steps (0.3 s in Node), too slow to recompute on every slider move and the throw-to-floor count needs dozens. So the closed-form ledger drives the page and the twin runs on a button and in the tests, as a check.
- *A Lorentz-force ED model.* Refused: plasma density, field geometry and current collection would all be invented here, which is what the repository's own scope line declines to do. Efficiency and duty stay as brackets.
- *A price per kilogram.* Refused: `rev_a.json`'s economics block holds no electricity price.

## How it works

Units inside the kernel are SI (m, m/s, kg, J, W, s); the page converts at the edges. `ledger.js` holds no physical number: everything comes in as an argument from the snapshots.

**Inputs.**

| Quantity | Value | From |
|---|---|---|
| μ, CoM altitude, half-length, tip speeds, fibre masses (0 / 15 / 30 % derate at 2.5 km/s; 30 % only at 2.8 and 3.5), design payload | 3.986×10¹⁴ m³/s², 610 km, 320 km, 2.5 / 2.8 / 3.5 km/s, 201.6 / 321.5 / 609.1 t, 1,476.3 t, 15,429.8 t, 5,000 kg | `snapshots/rev_a.json`, whole file |
| Earth radius | 6,371 km | `physics/skyhook_physics.py:40` (the radius the canon's printed C3 sits on; see idea 01 for the 6,378 that `com_radius_km` implies) |
| hub mass | 200 t **[Speculative]** (Phase 2 range 100–300 t) | `physics/tether_dynamics.py:75-77`, `docs/project_instructions.md:193` |
| sizing rule | 5 and 10 days, 1 day at maturity, 30 % margin | `docs/project_instructions.md:145` |
| efficiency ladder | 15 / 26 / 40 % | MP-001 §3a, `docs/research/mp001_market_pricing.md:37` |
| duty, installed powers, array specific power | 0.3 / 0.5; 50 / 100 / 250 / 500 kW; 50 / 100 W/kg | `finance/reboost_bound.py:30-33` (all [FLAGGED] there) |
| workbook ladder | efficiency 0.15 / 0.20 / 0.30 (row 6), hardware mass factor 1.8 / 1.6 / 1.4 (row 9), 1 / 2 / 3 catches a day (row 11) | `tools/financial/skyhook_financial_model.xlsx`, Assumptions sheet, read by `build_data.py` |
| in-space fork (DRAFT) | CoM perigee 600 km, apogee 7,418 km, v_perigee 8.715 km/s, L 150 km, v_tip 1.071 km/s, 5 t payload, 16.1 t fibre, 30 t hub ("[FLAGGED] … floored at 30 t") | `snapshots/service_mxer_draft.json` (excerpt) |
| program-site sketch | 2×10⁻⁶ per node per step, in km/s² (μ = 398600 km³/s²), at 610 km and 2.5 km/s | `tools/sims/skyhook_program_site.html:794, :801, :847` |

Every number from a source line is parsed out of that line by a regular expression in `build_data.py`; the exact text of each cited line is saved in `snapshots/<file>.lines.json` and shown on the page.

**Energy** [Certain given the canon's catch and release states]. The catch state is (r, v) = (R − L, v_orb − v_tip), the canon release state (R + L, v_orb + v_tip), with R = 6,371 + 610 km and v_orb = √(μ/R). The payload's specific orbital energy ε = v²/2 − μ/r rises by

ΔE = 2·v_orb·v_tip + μ/(R − L) − μ/(R + L) = 37.78 + 5.25 = 43.03 MJ/kg (11.95 kWh/kg; 2.151×10¹¹ J per 5,000 kg).

The first term is `finance/skyhook_finance.py:215`'s "momentum view"; the second is the lift. The same states give the canon's printed release numbers for all three tiers: C3 −8.06 / −1.94 / +13.05 km²/s² and apogee 85,222 / 397,819 km / escape. On a 6,378 km Earth the throw costs 43.00 MJ/kg and the printed C3 no longer reproduces.

**The canon release assumes an infinitely heavy tether** [Likely]. At the catch the payload's velocity matches the tip's, so the loaded tether keeps the canon spin rate but turns about the combined centre of mass, mL/(M + m) below its own. Half a turn later the payload leaves from L·f above the old centre at v_tip·f faster, with f = (M − m)/(M + m). At the reference (809.1 t) that is C3 −8.74 km²/s² and apogee 77,580 km instead of −8.06 and 85,222; at the cislunar tier (1,676.3 t), −2.31 and 331,366 km instead of −1.94 and 397,819. Skyhook's own tether model gives −8.743 and −2.302. The "at the canon spin rate" release option carries this through the whole page.

**Putting it back** [Certain arithmetic; the efficiency and duty brackets are the repository's, FLAGGED there]. t_rec = E / (P·η·d), as `reboost_bound.py:146-147`; the power the rule needs is P = 1.3·E / (η·d·T). At the reference: 1 MW at 26 % and duty 0.5 takes 19.2 days (a day restores 5.2 % of one throw); the rule needs 2.49 MW for 10 days, 4.98 MW for 5 and 24.9 MW for the 1-day maturity interval. The proposal's figures (250 kW at 26 % taking 38 days, about 9.6 MW for a catch a day) are the duty-1, no-margin case and reproduce: 38.3 days, 9.58 MW. At the workbook's mature cadence and efficiency, the rule needs 43.2 / 64.7 / 64.7 MW (conservative / baseline / optimistic, duty 0.5) and 71.9 / 107.9 / 107.9 MW at duty 0.3. The finance model books reboost as electricity per kilogram (`skyhook_finance.py:215-216`); arrays reach its capex only inside the hardware mass factor, 1.8× the tether's launch cost for "hub/arrays/tips" (`:193-200`), which read as mass allows 487 t beside the 609.1 t conservative tether. At 100 W/kg and duty 0.5 the conservative cadence's arrays alone are 432 t; at 50 W/kg, 863 t.

**The program site's reboost button** [Certain arithmetic]. The sketch in `tools/sims/skyhook_program_site.html` works in km (μ = 398600 km³/s², `:794`) on the Rev A orbit and tip speed (`:801`), and "ED reboost: ON" adds 2×10⁻⁶ km/s² along every node's velocity (`:847`). A uniform tangential push a on the whole system delivers a·M·v of orbital power: 12.2 MW on the 809.1 t reference system, 94.1 MW installed at 26 % and duty 0.5, which puts one throw back in 4.9 hours (`constantPush`, E / (a·M·v), the same as the energy-equivalent Δv over a).

**The ledger** [Likely]. The tether system (hub plus fibre, mass M) gives up m·ΔE: its specific orbital energy falls by (m/M)·ΔE, with its spin assumed to end where it started. The loaded flip leaves its centre 2mL/(M + m) lower at the throw point. From those two facts: the new semi-major axis a₁ = −μ/(2ε₁); the throw point (radius r − 2mL/(M + m), moving horizontally) is an apside; the other apside, half an orbit later, is 2a₁ − r₁, where the lower tip comes lowest (perigee − L; Skyhook's twin puts its lowest node within about 10 km of that, 3.2 km at the reference and 9.3 km at 0 % derate, because the spin phase at perigee varies). The angular momentum this implies agrees with the payload's angular-momentum gain about Earth's centre to better than 1.5×10⁻⁵ for every tier and both release states (measured at most 7.0×10⁻⁶), a consistency check the tests assert. At the reference with the 200 t hub (809.1 t, 162× the payload): semi-major axis −64.4 km (35.2 m/s of energy-equivalent reboost Δv), throw point −3.9 km (it becomes the apogee), perigee −124.9 km 48 minutes later, lower tip lowest at 165.1 km, down from 290. The drop scales as 1/M, so the lighter, less-derated tethers are the hardest to keep up: with the same 200 t hub one throw leaves the lower tip's lowest point at 97.2 km at 15 % derate and 40.7 km at 0 %. Lighter still (0 % derate below a 143 t hub, 15 % below 23 t) one throw takes it below the ground; there the page and the CLI refuse the perigee and the tip altitude (`out_of_envelope`, naming the hub that keeps the tip up) instead of printing a negative altitude.

**Three models of the same throw** (reference, 30 %, 200 t):

| | Ledger, canon release | Ledger, at canon spin | Proposal's impulsive model | Skyhook's tether model |
|---|---|---|---|---|
| semi-major axis drop | 64.42 km | 63.92 km | 56.92 km | 63.90 km at release; 63.48 km orbit mean |
| centre of mass, half an orbit later | −124.9 km | −123.9 km | −113.8 km | −123.5 km (lowest over the orbit) |
| lower tip, lowest | 165.1 km | 166.1 km | 176.2 km | 168.2 km (lowest node) |
| release C3 | −8.06 | −8.74 | not modelled | −8.74 |

The twin is `tools/twin/physics.js` verbatim (17 lumped masses, inverse-square gravity on every node, RK4 at 0.1 s; the JS port of `physics/tether_dynamics.py`). `twin-check.js` adds no physics: it builds the twin from `rev_a.json` with the chosen tier and hub (`TetherConfig`, `TetherSim`), adds the payload mass to the lower-tip node at the canon catch state, steps until that node passes the local vertical above the system's centre, removes the payload, and flies the empty tether one orbit. The tether loses what the payload gains to 1×10⁻⁶ and the integrator drifts under 3×10⁻¹⁰ over the orbit. The loaded-release ledger matches the twin's semi-major-axis drop at release to 0.03 % for all three tested configurations; the canon-release ledger sits 1.5–1.9 % above its orbit mean, and the impulsive model 9–10 % below.

**Throws to a floor.** With no reboost, each throw at the current apogee (or each at the current perigee), counting until the next would take the lower tip below the floor. The repository names no floor (`project_instructions.md:44` puts a HASTOL-class tip at 80–150 km), so the floor is your input. At the reference: none above 200 km, 1 (apogee) or 2 (perigee) above 150 km. The smallest hub that keeps one throw above 200 km is 517 t (a 1,126 t system, 225× the payload); above 150 km, 112 t.

**The in-space fork's own ledger** [Likely]. The same energy function on `service_mxer_draft.json` (catch at its centre-of-mass perigee at its v_perigee) gives 1.056547×10¹¹ J, `reboost_bound.py`'s golden, whose own route (circular catch orbit in, GEO-transfer ellipse out) the kernel also reproduces. The fork's system is 46.1 t, 9.2× its 5 t payload: one throw at perigee lowers its semi-major axis by 1,107 km and its apogee by 2,184 km, from 7,418 km altitude.

**Refusals.** A structured refusal (code, reason, what would help) replaces every number the canon cannot support: a price per kilogram (`insufficient_data`; the refusal lists the five economics keys the canon has, read from the file, so it changes if a price is added); the 2.8 and 3.5 km/s tiers below 30 % derate (`insufficient_data`; the canon prints no fibre mass there, and EQ-6 would give one, but this page shows only what the canon prints); a payload over 5,000 kg (`out_of_envelope`: the canon sizes every tier for it); a negative or blank hub mass, zero payload, power, efficiency or duty out of range, a floor that is not a number (`invalid_input`); a floor at or above the 290 km design tip altitude, or below the ground; a perigee and tip altitude after a throw that takes the tip underground (`out_of_envelope`); and the ED physics itself, as `reboost_bound.py`'s scope line does.

**Data and provenance.** `build_data.py` copies with the bank's `tools/snapshot.mjs`: `rev_a.json` whole; `service_mxer_draft.json` as an excerpt (`--pick status,confidence,catch_origin,tether_com_orbit,tether,payload_class,capex_inputs.hub_mass_t,capex_inputs.hub_mass_note`); `finance/REBOOST_BOUND_FINDINGS.md` whole (its tables are reproduced by the tests); `tools/twin/physics.js` whole as `twin-physics.mjs`. It derives, with `--sidecar-only` provenance: `twin-classic.js` (the same file with its six `export ` keywords removed and a classic-script wrapper, because ES modules do not load from `file://`; a test proves that is the only difference and that both copies give identical runs); `workbook-ladder.json` (Assumptions rows 2, 6, 7, 9, 11, 12); and nine `<file>.lines.json` files holding the exact text of each cited line. All at Skyhook `34935cb`, every read matching the committed blob. The sidecars carry `copiedAt` 2026-11-03, the day the folder was finished and rebuilt from the checkout. `data.js` bundles all of it for the page. `build_data.py --check` exits 1 if any of it is stale; a test runs it whenever the checkout is present.

## Tests

`ledger.test.mjs` (23 tests). **Pinned outside this code:**

- the canon's printed release C3 and apogee for all three tiers, and the 290 km design tip altitude, from `rev_a.json`; and that on a 6,378 km Earth the printed C3 does not reproduce;
- `reboost_bound.py`'s golden 1.056547×10¹¹ J (`tests/test_analysis_layer.py:77`) through this kernel and through `reboost_bound.py`'s own route, both within 1×10⁻⁶; all 24 rows of its published recovery grid to the printed decimal, all 24 supportability labels and all 6 minimum powers in `REBOOST_BOUND_FINDINGS.md`, and the test file's 150.0 and 416.6 kW within its 1 %;
- Skyhook's own tether model, run three times (reference at 30 % and 0 % derate, cislunar): its system mass equals the canon's within 0.1 %, it conserves energy through the catch and throw, the loaded-release ledger matches its semi-major-axis drop to 0.1 % and its release C3 to 0.03 km²/s², the canon ledger sits within 0.0–2.5 % above its orbit mean while the impulsive model sits more than 8 % below, and the classic copy the page runs gives identical results;
- the energy by hand (μ, radii and speeds typed into the test as a worked example) to 1×10⁻¹²; 43.03 MJ/kg, 37.78 MJ/kg and 11.95 kWh/kg; n·ΔH agreeing to 0.1 % (idea 14's check);
- the program-site sketch's 2×10⁻⁶ and its km units read from the cited lines, and its 12.2 MW and 4.9 h by hand (a·M·v);
- the Rev A grid with the 30 % margin against the Python CLI's saved table (`example.txt`), all 60 rows and labels: the Python is a separate implementation.

**Properties and limits:** recovery is monotone in power, efficiency and duty, and `requiredPower` inverts it with the margin; the orbit drop halves when M doubles and vanishes as M grows or m shrinks; heavier (more derated) tethers keep the tip higher; throw counts are integers, non-increasing in the floor, and the boundary sits exactly at the tip altitude one throw leaves (1 m either side); the minimum hub lands the tip on the floor to under 1 m; every refusal named above, including that the price refusal is read from the canon and not hard-wired. Added by the review: a tip taken underground is flagged and refused with the 143 t hub that keeps it up (which lands it on the ground to under 1 m), the throw sequence stops exactly before the throw that would go underground, a floor below the ground or not a number is refused, and the angular-momentum residual stays under 1.5×10⁻⁵ for all three tiers and both releases.

`test_ledger.py` (10 tests): the Python CLI reproduces the canon's C3 and apogee, the energy split, the founding rule's parse and the workbook cadence; it agrees with `ledger.js` to 1×10⁻⁹ on eight quantities and the floor counts in six configurations (both releases, three tiers, hubs of 0, 200 and 1,000 t), and in the one where the tip goes underground (15 % derate, no hub, loaded release) both refuse the perigee and tip and agree on the other six; its refusals exit 2 with a structured reason, usage errors exit 3; a floor that is not a number exits 2, a floor below the ground and an underground tip are refused in the report rather than printed; `example.txt` is its current output.

`ui-check.mjs` (65 checks in headless Chromium): every tile, the energy table, the loaded-release note, the recovery verdict at three powers (including one where only the 30 % margin moves it from the 5-day to the 10-day end), the sizing table, the workbook cadence, the array-mass and program-site lines, the ledger tiles, the floor count at 200 and 150 km, the minimum hub, the twin run from the button (its C3, Δa and lowest node equal a Node run of the same model), the twin column going stale and coming back when the hub changes, all four reconciliations, the three standing refusals, the overload and blank-hub refusals replacing every number below them, the underground-tip refusal at 0 % derate with no hub (no perigee or tip tile, "below the ground" in the models table, the 143 t hub named), a 0.001 kg payload shown as such, the derate buttons disabled at the cislunar tier, keyboard selection of a tier and the power slider, a chart tooltip by touch, dark mode on the phone and light on the desktop, no sideways scroll at 390 px with the tooltip and the cited lines open, no console error and no network request.

**Teeth.** Thirty deliberate breaks, each applied to a copy of the folder and every suite run against it (node tests failed / Python tests failed / ui-check failures, where run). Every one is caught:

| Sabotage | node | py | ui |
|---|---|---|---|
| potential term's sign flipped in ε | 15 | 1 | |
| release radius r − L·f | 12 | 1 | |
| energy per kg = speed term only (the finance model's view) | 1 | 1 | |
| recovery time drops duty | 3 | 0 | |
| required power drops the margin | 1 | 0 | |
| grid labels drop the margin | 1 | 0 | |
| CoM drop mL/(M+m) instead of 2mL/(M+m) | 4 | 1 | |
| CoM drop omitted | 4 | 1 | |
| tether loses m/(M+m) of the energy instead of m/M | 5 | 1 | |
| loaded release factor M/(M+m) | 1 | 1 | |
| in-space fork caught at circular speed | 2 | 0 | |
| floor test shifted by 5 km | 1 | 1 | |
| perigee phasing reads the apogee | 1 | 1 | |
| price refusal hard-wired | 1 | 0 | |
| overload check removed | 1 | 0 | |
| impulsive Δv uses m·v_tip/(M+m) twice | 1 | 0 | |
| program-site power uses the payload mass | 1 | 0 | |
| minimum hub returns the low bracket | 1 | 0 | |
| a sidereal day for DAY_S | 2 | 0 | |
| twin throws at the bottom of the swing | 2 | 0 | |
| twin catches on the upper tip | 3 | 0 | |
| Python: potential sign | 0 | 6 | |
| Python: CoM drop omitted | 0 | 3 | |
| Python: recovery drops duty | 0 | 1 | |
| Python: loaded factor 1 | 0 | 1 | |
| Python: floor phasing ignored | 0 | 1 | |
| page: recovery verdict ignores the margin | 0 | 0 | 1 |
| page: Δa tile shows the perigee drop | 0 | 0 | 1 |
| page: sketch push read as m/s² instead of km/s² | 0 | 0 | 1 |
| page: a refused payload silently replaced by 5,000 kg | 0 | 0 | 3 |

Before finishing, the grid-margin, floor-boundary and verdict-margin breaks passed every suite; the 60-row grid test, the boundary test and the 4.5-day ui-check case were added for them. ui-check compares the page with `ledger.js`, so a kernel break moves both together: kernel breaks are the node suite's job, page breaks are ui-check's. The counts above were measured by the builder before the review added tests; tests were only added or extended since, so they are lower bounds.

**Review breaks**, run by the independent reviewer on copies of the finished folder against the final suites (node / py / ui failures; ui run only for page-facing breaks). Two of the reviewer's first 17 kernel breaks passed every suite of the builder's version: the throw sequence running on below the ground, and a loaded release speed that forgets the factor f (it moves only the angular-momentum check, which then tolerated 1×10⁻⁴). Both are caught now, with the review's other breaks:

| Sabotage | node | py | ui |
|---|---|---|---|
| throw sequence runs on below the ground | 1 | 0 | |
| loaded release speed forgets f | 1 | 0 | |
| below-ground flag never set | 1 | 1 | 3 |
| a floor below the ground is counted | 1 | 0 | |
| ground refusal names the hub for a 50 km floor | 1 | 0 | 1 |
| Python prints an underground tip | 0 | 2 | |
| Python counts throws to a NaN floor | 0 | 1 | |
| page: underground tip tile printed | 0 | 0 | 2 |
| page: a 0.001 kg payload shown as 0 kg | 0 | 0 | 1 |

One break still passes and is left: the "48 min after the throw" tile computed from the old orbit instead of the new one rounds to the same minute.

## Honest assessment

What works:

- **[Certain]** The energy per throw, the recovery time and the required power are exact arithmetic on canon values and the repository's own brackets, and they reproduce every number Skyhook publishes for the same quantities (canon C3 and apogee for three tiers; `reboost_bound.py`'s golden, 24-row grid and minimum powers).
- **[Certain]** The Python CLI and the JavaScript kernel are separate implementations that agree to 1×10⁻⁹.
- **[Likely]** The orbit ledger is a two-fact conservation model (energy, and the flip about the combined centre of mass) checked against Skyhook's own 17-node tether model: 0.03 % on the semi-major-axis drop at release with the loaded release, 1.5–1.9 % on the orbit mean with the canon release, and within 10 km on the lower tip's lowest altitude (3.2 km at the reference, 9.3 km at 0 % derate).

What is rough:

- **[Likely]** The ledger assumes the spin ends where it started, so the whole energy comes out of the orbit. In the twin the payload leaves at the canon spin rate and the spin does change; the energy-equivalent reboost Δv (35.2 m/s) is the energy bound, not a thrust plan. `reboost_bound.py` flags the same thing ("Angular-momentum restoration is assumed co-managed").
- **[Likely]** The centre of mass is treated as a point on a Keplerian orbit, the catch and the throw as if at one place in the orbit (the swing takes about 8 minutes, 476 s in the twin, about 30° of orbit), and the throw point as an apside. The twin shows what this costs: the tip residual above.
- **[Likely]** No drag. A lower tip at 165 km, let alone the 40 km the 0 % derate tether reaches, would feel the atmosphere; the throw count, the chart and the tiles stop only at the ground (below it they refuse).
- **[Speculative]** The hub mass. Everything in section 3 scales with it; the 200 t default is a placeholder in the repository's own words. The "workbook row 9 read as mass" preset (0.8 × fibre mass for the conservative column) is my reading of a cost factor, not a mass budget.
- **[Likely]** Efficiency and duty are brackets, not physics: MP-001's 26 % is a placeholder back-solved from a 48 kWh/kg electrical figure, and `reboost_bound.py`'s duty factors are [FLAGGED] there.
- The twin runs on a button because one run is about 63,000 steps; on a slow phone it takes a few seconds. Its result is tied to the configuration it ran for and marked stale when you change tier, derate, hub or payload.
- The CLI's power-system mass table sets array mass against the hub placeholder only; the page also sets it against the hardware mass factor.

**What the independent review changed** (2026-11-03). The reviewer recomputed the headline numbers from `rev_a.json` by separate Python (43.03 MJ/kg = 37.78 + 5.25; 2.151×10¹¹ J; 2.49 / 4.98 / 24.9 MW; 19.2 days and 5.2 % a day at 1 MW; 64.4 / 124.9 / 165.1 km at 200 t; 30.8 m/s, 57 / 114 / 176 km for the proposal's model; 12.2 MW, 94.1 MW and 4.9 h for the program-site push; C3 −8.74 and apogee 77,580 km loaded), re-ran Skyhook's twin for four configurations (63.90 / 63.48 km, −123.5 km, 168.2 km, C3 −8.743; cislunar −2.302; tip residuals 3.2, 6.7 and 9.3 km), opened every cited line at `34935cb` (all 34 match) and the workbook rows, and found these, all fixed here:

- [Certain] **A negative altitude printed as a result.** At 0 % derate with a hub under 143 t (the 100 t Phase 2 preset is one) or 15 % derate under 23 t, one throw takes the lower tip's lowest point below the ground, and the page showed it as a number (−197.6 km with no hub at 0 % derate, beside "Skyhook's tether model lands within about 10 km"), as did the models table and the CLI ("lowest -197.6 km"). Below the surface this drag-free ledger means nothing, which the chart caption already said. Now the kernel flags it (`ledger().belowGround`), the page and the CLI give an `out_of_envelope` refusal in place of the perigee and tip altitude, and the page names the hub that keeps the tip above the ground (`belowGroundRefusal`).
- [Certain] **A floor that is not a number was counted.** `reboost_bound_rev_a.py --floor-km nan` printed 239 and 271 throws (every comparison with NaN is false, so the count ran until the tether had no orbit); a negative floor was accepted by both kernels and counted throws with the tip underground. Now NaN exits 2 (`invalid_input`) and a floor below the ground is refused in both kernels; a count that reaches the 500 cap prints "500 or more" in the CLI, as the page already did.
- [Certain] **Two breaks no suite caught**, closed by tests (above).
- Wording: this README said the lower tip comes lowest "within a few km depending on spin phase" while the page and the twin say within about 10 km; and "97.2 km at 15 % derate and 40.7 km at 0 %" read as drops when they are tip altitudes. A typed 0.001 kg payload showed as "0 GJ … for 0 kg". The cadence table's headers wrapped one word per line at 390 px.

**Findings about the source repo** (Skyhook at `34935cb`; reported here, not fixed there):

1. **`docs/project_instructions.md:143` against `:145`.** ":143" says 100 kW–1 MW "yield meaningful daily momentum restoration"; at 1 MW, 26 % and duty 0.5 one day restores 5.2 % of one 5,000 kg reference throw. The ":145" sizing rule (5–10 days, 30 % margin) needs 2.49–4.98 MW at the same efficiency and duty, and 24.9 MW at its own 1-day maturity interval. [Certain arithmetic; Likely as a conclusion, since efficiency and duty are brackets]
2. **The orbit drop is not budgeted anywhere.** `docs/glossary.md:36` says the tether orbit drops; no file says how far, and no file sets a tip-altitude floor. One reference throw from 610 km circular takes the lower tip's lowest point from 290 km to 165 km at the 200 t placeholder hub (Skyhook's own twin: 168 km); keeping it above 200 km needs a 517 t hub. [Likely]
3. **`params/rev_a.json` `kinematics` (`v_upper_release_kms` 10.06, `c3_kms2` −8.06, `apogee_altitude_km` 85,222, and the cislunar option's −1.94 and 397,819 km) assume an infinitely heavy tether.** At the canon spin rate the loaded 809.1 t reference system releases at C3 −8.74 km²/s² (apogee 77,580 km) and the 1,676.3 t cislunar system at −2.31 (331,366 km, 66,453 km short of the canon's apogee). `tools/twin/physics.js` gives −8.743 and −2.302. Delivering the canon state needs a faster spin at release, a heavier system or a longer arm. [Likely; the size depends on the Speculative hub]
4. **`tools/sims/skyhook_program_site.html:847`.** The sketch's "ED reboost: ON" pushes every node at 2×10⁻⁶ km/s²: on the Rev A reference system that is 12.2 MW of orbital power (94 MW installed at 26 % and duty 0.5, 94× the top of `:143`'s range) and restores one throw in 4.9 hours. The sketch shows reboost as far faster than the founding document's power levels. [Certain arithmetic]
5. **Array mass inside the hardware mass factor.** The finance model books reboost as electricity per kilogram (`finance/skyhook_finance.py:215-216`) and arrays only inside the hardware mass factor (`:193-200`, workbook Assumptions row 9, "hub/arrays/tips"). Read as mass, the conservative 1.8× allows 487 t beside the 609.1 t tether; the arrays alone for that column's cadence (1 catch a day at 15 %, sizing rule margin) are 432 t at 100 W/kg and duty 0.5, 863 t at 50 W/kg, and 719–1,439 t at duty 0.3. [Likely: depends on reading a cost factor as mass, and arrays only, no PMAD or thermal]
6. **`finance/reboost_bound.py` books the in-space fork's energy but not its orbit.** One 5 t throw at the DRAFT fork's perigee lowers its apogee by 2,184 km (from 7,418 km altitude) on its 46.1 t system. [Likely]
7. **Already reported by idea 14, restated for completeness:** `finance/skyhook_finance.py:211-216` books 2·v_orb·v_tip = 37.78 MJ/kg, 12.2 % short of the 43.03 MJ/kg the tether actually loses; MP-001 (`docs/research/mp001_market_pricing.md:37`) states 44.8 MJ/kg, which no reading of the canon reproduces.
8. **Confirmed, no defect:** `reboost_bound.py`'s golden, grid, labels and minimum powers all reproduce from an independent implementation.

**About the judged proposal.** Its impulsive orbit numbers (57 km semi-major axis, 114 km perigee, 176 km tip) reproduce as written but understate Skyhook's own tether model by about 10 %; this page reports the conservation ledger (64.4 / 124.9 / 165.1 km) instead and keeps the impulsive model as a labelled comparison.

**Gates not passed.** This is an idea-bank prototype. It has not been through Skyhook's Rule 1 canon process (it reads a snapshot of `rev_a.json` and cited lines, not the physics module's imports), any verification memo, or the pytest suite; the twin cross-check runs `tools/twin/physics.js` but not `tools/twin/verify.mjs` or the Python reference `physics/tether_dynamics.py`; the hub mass is a placeholder; and no ED physics is modelled.

## Where it would land

**Repository:** Skyhook.

- `finance/reboost_bound_rev_a.py`, the CLI here, beside `reboost_bound.py` and in its table format so the two diff; and `finance/REBOOST_BOUND_REV_A_FINDINGS.md`, generated from it as `REBOOST_BOUND_FINDINGS.md` is.
- A derived `reboost` block in `params/rev_a.json` with a confidence label: energy per catch (43.03 MJ/kg) and, once a hub budget exists, the per-throw orbit drop; plus a reconciliation note at `finance/skyhook_finance.py:215` and MP-001 §3a (idea 14 has the full table).
- The twin cross-check as a test beside `tools/twin/verify.mjs` (a loaded catch and throw against the ledger), and the "loaded release" correction to the `kinematics` notes if the program agrees.
- The page as `tools/sims/momentum_ledger.html`, reading the canon through `params-loader.js` instead of a snapshot.

**What must change to ship for real:** Rule 1 imports (canon values through `physics/skyhook_physics.py` and the twin's params loader, not snapshots); a hub mass budget to replace the 200 t placeholder; a tip-altitude floor named by the program; a verification memo and pytest coverage; and, for the reboost itself, the orbit-integrated `ed_reboost.py` the external review asked for, which would replace the efficiency and duty brackets.
