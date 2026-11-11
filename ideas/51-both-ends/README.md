# Both Ends
> One Aster round trip flown with a Skyhook tether at both ends: on the 128 JPL NHATS round trips in Aster's fixtures, the 2.5 km/s reference tether leaves every craft owing 0.395 to 1.766 km/s after the throw (median 0.636, against a 3.456 km/s rocket injection) and 0.396 to 1.261 km/s before the catch; only the 3.5 km/s Phase 3 tether, at 3,086 times its payload, throws 120 and catches 108 of them with no burn, and a throw followed by a catch gives back a median 71 % of the orbital energy it took.

**Kind:** explorable merge
**For:** Aster + Skyhook
**Run:** open `ideas/51-both-ends/index.html`; `node ideas/51-both-ends/cli.mjs` (census) or `node ideas/51-both-ends/cli.mjs --des 101955 --tier phase3`; tests `node --test ideas/51-both-ends/both-ends.test.mjs`; page check `node ideas/51-both-ends/ui-check.mjs`
**Made by:** Sheave

## What it is

The two programs joined into one. Aster plans a round trip to a near-Earth asteroid: the C3 to leave Earth, the burns at the asteroid, the speed coming home. Skyhook's tether throws a payload from its upper tip and can catch one there. This page picks one of 128 real round trips, picks one of Skyhook's three tether tiers, and flies the trip through both programs at once:

- **Out.** Where on the tether's swing the tip has exactly the orbital energy the trip needs, or, if even the top of the swing is short, the burn the craft still owes.
- **At the asteroid.** The record's own rendezvous and departure burns, under Aster's stationkeeping, margin and Isp.
- **Home.** The same question for the catch, then the speed the craft is set down at from the lower tip instead of a direct entry.
- **Mass.** What comes home on the tether path, beside what Aster's eight launch-vehicle curves bring home on a direct-entry path.
- **Energy.** What the throw takes out of the tether's orbit and what the catch puts back.

Five things it refuses to answer, on every trip, with what would let it: the orbit plane, the phase and date, the launcher to the lower tip, the catch itself, and price.

## Why I made it

The request was to rebuild a merge of the Skyhook and Aster programs and put it here. Aster names the join itself: kernel K2, "the Aster → Skyhook interface" (`strategy/IDEA_KERNELS_2026-09.md:35` @ `b902c59`), and the "Aster Momentum" lens, a 2027 concept (`strategy/ASTER_FAMILY_MASTER_PLAN.md:41`).

The bank already holds pieces. Idea 01 (Tip Match) answers one end: can an inbound payload be met at the upper tip. Idea 21 builds return legs. Idea 30 books one throw's energy. Nobody had run a whole trip through both programs, and nobody had done the outbound end at all: Aster's departure C3 against the tether's release.

Alternatives weighed:

- *A code merge of the two repositories.* Rejected. One is TypeScript in a browser with a protected core, the other Python with a canon file; this bank may not modify either. A merged repository would also have to pick one Earth (idea 14 found they differ).
- *Re-run Aster's own porkchop cells against the tether.* Rejected for now: Aster's cells carry outbound legs only. The NHATS records in its fixtures are complete round trips from a primary source, with both ends.
- *Top-of-swing release only, as idea 01 does for the catch.* Rejected: it books a burn whenever the tether is too fast, which is wrong. A tether that is too fast lets go earlier in its swing. That one change is why the Phase 3 tether needs no burn on 120 trips.

## How it works

**Data.** `build-data.mjs` writes `snapshots/data.js` from four whole-file snapshot copies and Aster's committed NHATS fixtures. Nothing is typed in.

| Number | Source |
|---|---|
| Tether μ 398,600 km³/s², hub altitude 610 km, half-length 320 km, tip speeds 2.5 / 2.8 / 3.5 km/s, payload class 5,000 kg, mass ratios 121.83 / 295.27 / 3,085.95 | Skyhook `params/rev_a.json` @ `34935cb` |
| Earth radius 6,371 km on the tether side | Skyhook `physics/skyhook_physics.py:40` |
| Aster μ 398,600.4418, LEO parking radius 6,578.137 km | Aster `src/v2/porkchop/delta-v.ts:3-4` @ `b902c59` |
| Isp 320 s, 5 % margin, 150 m/s stationkeeping, g0, eight vehicle curves (40 anchors, NASA LSP elvperf as-of 2024-02-29) | Aster `src/v2/porkchop/launch-vehicles.ts` |
| 128 round trips: C3, both asteroid burns, entry speed, declinations, dates | JPL NHATS API records in Aster `tests/fixtures/v2` (135 files, 5 API error records listed and dropped) |
| 200 km LEO, 400 km NHATS parking orbit, 125 km and 200 km entry altitudes | Aster prose; the build finds each by its quoted text and stops if the quote is gone |

**The tether.** A rigid tether of half-length L turns in its orbit plane about a hub on a circular orbit of radius R = 6,371 + 610 km at v_orb = √(μ/R). At swing angle θ from straight up, the tip is at

- r(θ) = √(R² + L² + 2RL cos θ)
- v(θ) = √(v_orb² + v_tip² + 2 v_orb v_tip cos θ)
- C3(θ) = v² − 2μ/r

C3 falls steadily from the top (θ = 0) to the bottom (θ = 180°). The top gives −8.06, −1.94 and +13.05 km²/s² for the three tiers, which are the canon's own figures.

**Each end.** If the trip's C3 is at or below the top value, there is a swing angle where the tip has it: the craft is let go (or caught) there and owes nothing. If it is above, the craft is let go at the top and burns Δv = √(C3 + 2μ/r_top) − v_top, where both velocities are tangential. The catch is the same in reverse, with C3 = v∞². v∞ comes from the NHATS entry speed: v∞² = v_entry² − 2μ/(R_E + 125 km), with Aster's μ and radius.

**Mass.** Rocket rows: Aster's `payloadAtC3` (linear between published anchors, refused outside) then m·exp(−Δv/(g0·Isp)) over rendezvous, departure, 5 % margin on both, and 150 m/s stationkeeping. With no sample this is exactly Aster's `deliveredMassKg` in sample-return mode, except that departure is the record's own burn, not Aster's assumption that it equals arrival (idea 05 measured that gap). Tether row: 5,000 kg at release, the throw trim, the same asteroid burns, the catch trim. A sample is added at the asteroid.

**Energy.** A throw raises a payload from the lower tip to the release point: (C3_release − C3_bottom)/2 per kg. A catch lowers one from the catch point to the lower tip and gives the same expression back. In km²/s² this is MJ/kg. At the reference tier a full swing is 43.03 MJ/kg, the figure idea 30 derives. Its 2·v_orb·v_tip part, 37.78, is what Skyhook's finance model books as reboost energy (`finance/skyhook_finance.py:215`); Skyhook states neither number literally, so both pins are to this bank's ideas 14 and 30.

## Tests

`both-ends.test.mjs`, 13 tests, about 0.2 s. What they pin to things outside this code:

- **Skyhook canon.** Release C3, release speed and tip g for all three tiers against `rev_a.json`'s stated values; upper-tip radius 7,301 km; lower-tip speed against the canon's ground-relative figure.
- **Reboost energy.** 43.03 MJ/kg for a full reference swing and 37.78 for 2·v_orb·v_tip, the two figures ideas 14 and 30 published.
- **Idea 01.** Its published 0.393 and 0.093 km/s shortfalls, v∞* = 3.613 km/s, and its 20 faster / 108 slower count.
- **NHATS.** Aster's injection formula reproduces `dv_dep_park` on all 128 records at 400 km to under 0.6 m/s; Bennu by hand, 3.9608.
- **Aster.** `payloadAtC3` at anchors, between them and outside; Bennu on Falcon Heavy Recovery worked by hand through Aster's sample-return budget.
- **Closed forms.** Tip geometry at 0°, 90° and 180°; the swing-angle solver inverts the energy to 1e-9°; a swing hand-over has exactly the asked C3; a top burn makes up exactly the shortfall; the two modes meet at the top value.
- **Refusals.** Unknown body, tier and reading; a negative or missing sample mass; a record with a missing field; a sub-escape arrival; an over-weight catch; a data module with a constant removed.

Teeth, tried: swapping the tether's Earth radius for Aster's fails 5 tests; taking |cos θ| in the tip speed fails 5; dropping the margin from the rendezvous burn fails 3; measuring the trim from orbital speed instead of release speed fails 4; measuring catch energy from the wrong tip fails 2.

`ui-check.mjs` drives the page in headless Chromium: the headline numbers for Bennu, a tier change, the refusal state for an empty sample box, phone width and dark mode.

## Honest assessment

What holds:

- [Certain] The energy arithmetic, under its model: two-body, impulsive, a rigid tether whose hub stays on a circular orbit. It reproduces both repositories' published numbers.
- [Certain] On these 128 trips the reference and cislunar tethers never reach escape, so every throw and every catch owes a burn: at least 0.395 km/s (reference) or 0.095 km/s (cislunar) each way.
- [Certain] The census counts follow from the records and the canon: Phase 3 throws 120 of 128 and catches 108 of 128 with no burn, 106 both.
- [Likely] The mass rows. Isp 320 s, 5 % margin and 150 m/s stationkeeping are Aster's screening values, not a spacecraft design.
- [Likely] v∞ from the entry speed. The record does not say which altitude its entry speed is quoted at; the page offers both readings. At 200 km fewer catches are free.

What is rough, and it matters:

- [Certain] **Energy is necessary, not sufficient.** A burn-free hand-over also fixes the direction of the craft's velocity, so the asymptote points where the geometry says, not where the trip needs. Timing the release along the orbit turns it within the orbit plane. Out of plane there is no freedom at all, and the canon gives the tether no inclination. Departure declinations in these records reach beyond ±40°. Some of the "free" throws are certainly unreachable from any single tether plane. The page says so and gives no count, because it cannot.
- [Certain] **The tether row has no launch behind it.** Someone must deliver 5,000 kg to the lower tip at 290 km and 5.06 km/s (reference). Neither repository has a vehicle curve to that state. So the mass table is not a comparison of cost or of launch mass, and the page says that above the table.
- [Speculative] **The catch.** Meeting a tip from a hyperbola, once, at about 11 km/s, inside Skyhook's ~1 m/s and 3 to 10 s capture window (`docs/project_instructions.md:124`), is not shown feasible anywhere. Idea 09 found the window at the reference tip is under 2 s even for a matched vehicle.
- [Certain] The only tier that works without burns is the one Skyhook itself calls launch-cost-dominated: 3,085.95× the payload, 15,430 t of fibre for a 5 t payload.
- [Likely] The tether's orbit is treated as unchanged by the throw. Idea 30 found one reference throw drops perigee about 125 km at a 200 t hub, so the catch a year later meets a different tether unless it is reboosted. The energy ledger is the debt; the changed orbit is not modelled.
- [Certain] The tether side uses Skyhook's μ and radius, the Aster side Aster's. Idea 14 measured the effect of that mix at 0.02 to 0.03 km²/s² in release C3. It is not reconciled here.
- Not independently reviewed. Every earlier review in this bank found at least one real error; read this as a first draft.

Findings about the source repos:

- Skyhook `params/rev_a.json:36`: Phase 3 `v_upper_release_kms` is 11.05, but √(μ/R) + 3.5 is 11.056, which rounds to 11.06. Line 26 (10.06) and line 48 (10.36) round the unrounded sum; line 36 adds 3.5 to a rounded 7.55. Two conventions in one file.
- Skyhook `params/rev_a.json`: no orbit inclination anywhere. Any interface to an interplanetary trip needs it first.
- Skyhook `params/rev_a.json:45-58`: the cislunar block has no `v_lower_tip_groundrel_kms`, though the reference (`:24`) and Phase 3 (`:35`) blocks do.
- Skyhook `params/rev_a.json:10`: `com_radius_km` 6988 is 6,378 + 610, while the physics module evaluates at 6,371 + 610 = 6,981. Found before by ideas 01 and 14; still there at `34935cb`.
- Aster: the "200 km circular LEO" line idea 01 cited at `src/v2/app/porkchop/main.ts:981` is now at `:1016`. Not a defect; older citations in this bank have drifted.

Gates not passed. Aster: the multi-agent math audit, oracle validation, the founding-document DEC process, and the protected core. Skyhook: Rule 1 canon review, VM verification, and its pytest suite.

## Where it would land

- **Aster:** `hudsonclavin-cloud/asteroid-mining-planner`, as the first cut of the Aster Momentum lens (L9) and kernel K2, beside the porkchop cost card in `src/v2/porkchop/`. To ship: a return-leg kernel (K1) so the trip is Aster's own cell and not an NHATS record; the tether constants imported from Skyhook's canon, not this snapshot; one Earth μ and radius chosen across the interface; the math audit; a DEC for the refusals.
- **Skyhook:** `hudsonclavin-cloud/skyhook`, as `physics/` functions for off-vertical release energy and catch energy with tests in `tests/test_rev_a_physics.py`, and a line in `docs/DECISION_LOG.md` on whether asteroid traffic is a market at all given the Phase 3 mass ratio. To ship: an inclination in `params/rev_a.json`; a lower-tip launcher curve; a hyperbolic-catch error budget; a VM memo for the numbers above.
