# Homeward Porkchop
> The return leg Aster does not plan yet: a 200×70 grid of asteroid-to-Earth Lambert legs for six bodies that shows the push to leave, the Earth-arrival v∞ Skyhook would be handed, its declination and entry speed, and refuses every delivered mass. Inside JPL NHATS's round trip for 1999 AO10 it reproduces the 2.106 km/s departure, the 11.879 km/s entry at 125 km and the −18.81° arrival declination; where Aster's own fidelity tier says the orbit is invalid (Apophis, 2000 SG344) it misses by 1.9 and 2.5 km/s, and the page says why.

**Kind:** prototype
**For:** Aster
**Run:** open `ideas/21-homeward-porkchop/index.html` in a browser (classic scripts, works from `file://`, no network). Tests, from the bank root: `node --test ideas/21-homeward-porkchop/homeward.test.mjs` (25 tests, Node built-ins, about 3 s) and `node ideas/21-homeward-porkchop/ui-check.mjs` (77 checks in headless Chromium with the globally installed Playwright; `check.mjs` runs it for `tools/check.mjs`). Data rebuild: `node ideas/21-homeward-porkchop/build-data.mjs /path/to/asteroid-mining-planner`.
**Made by:** Backsight

## What it is

Aster's porkchop page answers "when do I leave Earth for this asteroid, and what does it cost". Mining is a round trip, and nothing in Aster plans the trip home. This page does, for six bodies: the five JPL NHATS validation targets Aster keeps in its fixtures (1999 AO10, 101955 Bennu, 2000 SG344, 99942 Apophis, 2001 GP2) and 433 Eros.

Pick a body. The plot's x axis is the day you leave the asteroid (2026-01-01 to 2040-12-01), its y axis the flight time to Earth (30 to 720 days), and each of the 14,000 cells is a zero-revolution Lambert leg from the body's two-body position to Earth's JPL Horizons position. Colour it by **Earth-arrival v∞** (the quantity Aster's kernel K2 would hand to Skyhook) or by **departure v∞ at the body** (the burn to leave). Tap, click or arrow-key to a cell and the panel gives:

- the dates and flight time;
- departure v∞ at the body, Earth-arrival v∞, and the arrival asymptote's declination (equatorial, `asin(vz/|v∞|)`, the convention of Aster's DLA);
- the direct-entry speed at 125 km (NHATS's convention, with NHATS's 12 km/s cap flagged), and the propulsive capture into Aster's 200 km circular parking orbit;
- for Apophis and Eros, how far the two-body state of the body is from JPL's integrated truth at the nearest checkpoint;
- **Delivered mass: refused**, as an Aster evidence-envelope refusal (`out_of_envelope`, the reason, and what would help), on every cell.

Cells whose Earth arrival falls after 2040-12-31 are hatched and refused (`insufficient_data`: the committed Earth ephemeris ends there). Cells that leave the body on or after its Slice 18 "L1" encounter are washed, never hidden. Each minimum is printed with the lattice it came from, says when it sits on an edge of what was searched, and says when a lower value exists only past the L1 boundary. A table sets the page's numbers beside JPL NHATS's for the return leg inside each target's minimum-ΔV round trip.

## Why I made it

**The open item.** K1, the return-leg porkchop, is row 3 of `strategy/IDEA_KERNELS_2026-09.md` §1 (line 22) and item 2 of its near-term shortlist (§3, lines 62-65: "highest thesis value per unit cost … any delivered-mass cell must be a structured refusal, not a number … the prerequisite to K2"). `src/v2/SLICE_19_5_FOUNDING.md:33` parks it for Slice 20+, and `STATUS.md:509` lists "the K1 return leg" among the next candidates. Today the only stand-in is the symmetric-return line in the sample-return stack, `departureDvFromVInf` returning the outbound arrival v∞ (`src/v2/porkchop/delta-v.ts:32-34`).

**Alternatives weighed.**
- *A study of the departure assumption over all 128 NHATS round trips.* Idea 05 (Round-Trip Ledger) already measured it (ratio 0.214 to 11.627); repeating it adds nothing, and a study gives K1 no surface.
- *Transpile `izzo.ts` and run Aster's own solver.* The bank has no build step, `src/v2/core` is protected, and INV-024 forbids porting oracles; a clean-room solver that must reproduce Aster's oracle vectors is the honest substitute, and is what this deposit does.
- *Jump to K2 (catch envelope).* Idea 01 (Tip Match) already takes an Earth-arrival v∞ as typed input; what was missing is the computed one.
- *The proposal as written: six bodies, ~9,000 cells, solver, Kepler, Hermite, refusals.* Built, scoped (see the deviations below), because every input is committed in Aster and JPL's NHATS records give an external answer to reproduce.

## How it works

**Data, all from Aster `62ddb17` (2026-10-25), nothing retyped.** `build-data.mjs` copies every source through the bank's `tools/snapshot.mjs`, which writes a provenance sidecar (repo, path, commit, blob, sha256):
- `catalog-six.json`: the six bodies' records from `tests/fixtures/v2/nea-catalog-slice9.json` (elements in J2000 ecliptic, anchor state, epoch 2026-05-01 TDB); `tier-six.json`: their Slice 18 tier records from `docs/tier-sizing-per-body.json`; `nhats/*.json`: the five NHATS fixtures, whole.
- Constants by regex from verbatim copies of Aster's source: GM☉ 1.32712440018e20 m³/s² (`keplerian.ts:9`), obliquity 84,381.448″ (`units.ts:5`), μ⊕ 398,600.4418 km³/s² and the 6,578.137 km parking radius (`delta-v.ts:3-4`), Earth radius 6,378,136.6 m (`bodies.ts:45`), the colormap (`colormap.ts`), the refusal codes (`mcp/src/tools/envelope-schema.ts`), the 125 km / 12 km/s NHATS entry convention (`src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md:42`). A missing match stops the build. Aster's Lambert oracle file, pinned cells, `c3-grid.test.mjs` and `support-boundary.ts` are copied for the tests.
- Two derived excerpts (`--sidecar-only`, the rule in the sidecar note): `earth-weekly.js`, every 7th of the 5,479 daily Earth records in `src/v2/data/horizons-inner-solar-system-2026-2040.json` plus the last (784), with the interpolation error measured against the other 4,695 and the six daily records of the worst interval; `drift-excerpt.json`, half-yearly checkpoints of JPL's integrated Apophis and Eros states from `tests/fixtures/v2/nea-drift-truth-2026-2046.json` (Slice 18's two-body-drift truth).
- `data.js`, the page's bundle, is built from the snapshots alone; a test rebuilds it and requires byte equality.

**The body [Certain arithmetic].** Two-body Kepler from the catalog elements (Newton on Kepler's equation to 1e-14 rad), perifocal to J2000 ecliptic, then one rotation by the obliquity into ICRF, the same chain as Aster's `propagateKeplerianStateVectors`. Propagated to their own epoch, all six land within 0.4 mm and 1e-12 km/s of the catalog's anchor state: the elements were made from the anchor with this chain.

**The frame, by measurement (INV-021).** That match proves consistency, not the frame. The frame is measured three ways in the tests: rotating each anchor back by −ε puts every body within r·sin(i) of the ecliptic, while unrotated 1999 AO10 sits at |z|/r = 0.294 against sin(i) = 0.045; the daily Earth records reach |vz| = 11.897 km/s (11.893 in the weekly ones), impossible in an ecliptic frame; and at 1999 AO10 the equatorial arrival declination hits NHATS's −18.811° to 0.002° where the ecliptic reading is −20.34°, and the launch declination −11.682° against NHATS's −11.685° where ecliptic gives −33.28°.

**Earth [Certain, measured].** Cubic Hermite on the weekly records (positions and velocities at the nodes; velocity is the derivative of the position cubic, as in Aster's `hermite.ts`). Against all 4,695 daily records left out: at most 204.8 km in position (2030-11-25) and 0.994 m/s in velocity (2030-11-27). The proposal's analytic bound (82 km for a circular 1 au orbit) does not hold for Earth: [Likely, textbook figure not measured here] the geocentre swings about 4,700 km around the Earth–Moon barycentre every month, which adds a fourth-derivative term as large as the orbital one. For a leg the 205 km moves v∞ by ~2e-5 km/s; the 1 m/s goes straight into the arrival v∞, so the third decimal of every displayed v∞ carries ±0.001 km/s.

**Lambert [Certain against the oracles below].** Universal variables (Bate, Mueller & White, *Fundamentals of Astrodynamics*, 1971, ch. 5; the z/Stumpff form and dT/dz of Curtis, *Orbital Mechanics for Engineering Students*, Algorithm 5.2), written from my knowledge of the textbook formulation, not from any code and without the books open here [Likely as to the exact chapter and algorithm numbers], zero revolutions, solved by Newton on z inside a bracket that always holds T(lo) < tof ≤ T(hi), with bisection whenever a step leaves it; stops at 1e-14 relative time. Direction follows Aster: `lambertMultiRev(…, lw=true)` passes `lw` as `prograde` (`lambert-multi-rev.ts:282,291`), meaning the transfer's angular momentum has z ≥ 0 in the input frame (ICRF here). 14,000 cells take 100–230 ms in Node on this machine.

**Per cell.** v∞ at departure = |v₁ − v_body(t_dep)|; Earth-arrival v∞ = |v₂ − v_Earth(t_arr)|; declination = asin(v∞z/|v∞|); entry speed = √(v∞² + 2μ⊕/(R⊕ + 125 km)), the escape term being 122.5871 km²/s²; capture = √(v∞² + 2μ⊕/r) − √(μ⊕/r) at r = 6,578.137 km, which a test shows is Aster's own `injectionDvFromC3(v∞²)` executed from the snapshot's source. The body's own gravity is ignored (no mass or density is in the catalog, so the page cannot size that term).

**The support boundary, flipped [Certain].** Aster marks an outbound cell unsupported when it *arrives* on or after the L1 encounter (`support-boundary.ts:49-50`, recorded as OQ-19-4 at `SLICE_19_FOUNDING.md:204-208`), because the body's state is used at arrival. On a return leg it is used at *departure*, so here a cell is unsupported when it leaves on or after the encounter: a vertical line. The L1 sentence on the page is Aster's (`tier-disclosure.ts:110-113`) reworded from "Arrivals after it" to departures, and says so.

**Lattice, minima, colour.** Departures run from the first Earth record to the last minus the shortest flight; flights 30–720 d; 200 × 70. The label is derived with the wording of Aster's `formatJdC3GridLabel` (`c3-grid.ts:42-75`): `200×70 grid · 27.4 d × 10 d steps`. Minima are over supported cells; `edgesOf` names the edge a minimum sits on (first or last departure, shortest or longest flight, the last flight inside the ephemeris, the last departure before the encounter). Colour is Aster's porkchop scale, log-viridis over 1–1000 km²/s² (`colormap.ts`), applied to v∞² of the chosen end, so below 1 km/s every cell is the darkest colour (the legend says so). That breaks the dataviz rule of one hue for magnitude on purpose: it is the scale Aster's users already read.

**NHATS [Certain arithmetic; the dates are read as TDB midnight, ≤ 69 s off].** NHATS's `min_dv_traj` gives launch, outbound days, stay and return days. The return leg leaves the asteroid at launch + `dur_out` + `dur_at` and flies `dur_ret`:

| Body | Leaves, flight | Status | v∞ at departure, page / NHATS | Entry at 125 km | Arrival dec. |
|---|---|---|---|---|---|
| 1999 AO10 | 2026-05-14, 305 d | supported (boundary 2029-02-14) | 2.1060 / 2.106 | 11.8795 / 11.879 | −18.809 / −18.811° |
| 101955 Bennu | 2036-12-03, 105 d | supported (2037-02-11) | 1.5515 / 1.533 | 11.7967 / 11.832 | −38.335 / −37.492° |
| 2000 SG344 | 2030-05-09, 161 d | past the boundary (2027-05-16) | 2.7010 / 0.166 | 11.7293 / 11.150 | −13.643 / −13.060° |
| 99942 Apophis | 2029-06-07, 297 d | past the boundary (2028-09-12) | 3.1483 / 1.285 | 12.6557 / 11.744 | 19.875 / 19.317° |
| 2001 GP2 | 2041-03-20, 233 d | refused: reaches Earth 2041-11-08 | — / 0.649 | — / 11.633 | — / 8.771° |

The same pipeline run outbound gives 1999 AO10's launch C3 as 5.5284 against 5.528. At 200 km instead of 125 km, AO10's entry speed would be 11.8205, 59 m/s off. For Apophis, JPL's integrated state at the NHATS departure date is 11,990,403 km and 3.37 km/s from the two-body state, against at most ~1.06e5 km before its encounters: the 2029-04-13 flyby, not the solver, is the miss.

## Tests

`homeward.test.mjs`, 25 tests, about 3 s. What they pin, and to what outside this code:

- **Provenance.** 20 snapshots hash to their sidecars, one clean commit; `data.js` equals the aggregate rebuilt from the snapshots; when an Aster checkout at that commit is present (default path or `ASTER_DIR`) the two derived excerpts re-derive byte for byte, else that test skips. Constants equal Aster's lines (GM☉, ε, μ⊕, parking radius, R⊕, 125 km, the symmetric-return line at `delta-v.ts:32`), and `homeward.js`, `app.js` and `index.html` type none of them.
- **Lambert against Aster's oracles.** The three end-to-end cases parsed from Aster's own `tests/v2-lambert/lambert-endtoend.test.mjs` (Curtis 5.2, 5.3, a heliocentric case) inside Aster's `TOL` of 1e-8; its two refusal cases; the poliastro-checked M=0 pinned cell (the fixture holds one) to the fixture's 1e-9 relative, v₁, v₂, C3 and v∞. 150 random heliocentric legs (long-way included): both ends share energy, angular momentum and eccentricity vector to 1e-9, are prograde, and the 119 that stay outside 0.2 au fly onto r₂ with v₂ under an independent RK4 to 1.1e-9 (the 31 Sun-grazers are left to the invariants, since a fixed-step RK4 cannot fly them). Circular-orbit closed form both ways round to 1e-10. Stumpff series against a 12-term Taylor sum and across their switch.
- **Kepler and frame.** All six anchors to < 1 m; the three frame measurements above.
- **Earth.** Exact at nodes, null outside 2026-01-01..2040-12-31, and the whole-span maxima (204.8 km, 0.994 m/s) reproduce exactly at the recorded dates.
- **NHATS.** 1999 AO10 within 0.002 km/s, 0.002 km/s and 0.01°, and its outbound C3, launch declination and arrival speed; the frame and 125 km conventions settled as above; Bennu's residuals pinned (+0.0185, −0.0353 km/s, −0.84°); Apophis and SG344 flagged past their boundaries and off by > 1.5 km/s; GP2 refused with a schema code; Apophis's and Eros's drift against JPL's truth.
- **Grid and refusals.** Every one of 14,000 cells carries the `out_of_envelope` delivered-mass refusal (a code in Aster's schema, no `kg` field); refused cells count exactly the cells with arrival past the span and carry `insufficient_data`; readout and grid agree cell by cell. The departure-keyed boundary: a Bennu cell leaving 30 d before the encounter is supported, Bennu's NHATS leg would be flagged by the arrival rule, and for SG344 the arrival rule would flag 893 of the 1,330 cells this rule supports. Body-level refusals (`not_found`, missing tier, L0, a hyperbola). Edge flags on real minima. Aster's two pinned grid labels (`731×100 grid · 7.0 d × 16.6 d steps`, `200×100 grid · 25.7 d × 16.6 d steps`) reproduce. Colour stops at both ends and the middle. Calendar and NHATS date arithmetic.

**Teeth.** Each mutation was applied to `homeward.js` in a scratch copy of the folder and the suite run (counts include the checkout-dependent re-derivation test where it fails):

| sabotage | failing tests |
|---|---|
| obliquity rotation sign flipped | 6 |
| Lambert direction retrograde | 8 |
| Lambert v₂ = (ġ r₂ + r₁)/g | 7 |
| Stumpff C or S series term sign | 1 each |
| Lambert stops at 1e-6 relative time | 2 |
| mean motion with a² | 6 |
| Hermite velocity term without h | 5 |
| Earth velocity interpolated linearly | 4 |
| Earth span lets Hermite extrapolate 30 d | 3 |
| declination from vx | 2 |
| vis-viva 2μ/r → μ/r | 4 |
| capture adds the circular speed | 1 |
| boundary strict (>), or keyed 100 d early | 1, 3 |
| NHATS departure without the stay | 7 |
| readout arrival v∞ against the body's velocity | 4 |
| grid arrival v∞ against a scaled Earth position | 2 |
| lattice label to two decimals | 1 |
| colour linear in energy | 1 |
| delivered-mass refusal code changed | 1 |
| minima ignore the L1 boundary | 1 |
| first-departure edge flag dropped | 1 |

All 23 are caught. The Stumpff series is reached by no grid cell (|z| < 1e-3 means a near-parabolic leg), so only its unit test sees it.

`ui-check.mjs` (77 checks): at 1280 px the default body, the derived label, the minima with their lattice and edge note, the counts (13,083 computed, 917 refused), the readout against the kernel run in Node for the default, a clicked, an arrow-keyed and a Home-keyed cell, the tooltip, a refused cell (no velocities, `insufficient_data`), no kilogram figure anywhere, the NHATS table (AO10 2.106 / 2.106 and 11.880 / 11.879, Apophis past its boundary, GP2 refused with only "Show body"), Apophis's drift readout, Bennu's Show, GP2's disabled NHATS button, Eros's L2 sentence; no console errors, no network requests. At 390 px in dark mode by touch: the scheme's background, a tap selects the right cell, no hover tooltip, no horizontal overflow for three bodies, the NHATS table fits. Storage blocked: still works. Body and colour survive a reload. Six mutations of `app.js` (readout shows departure as arrival, tooltip likewise, delivered-mass card removed, minima without the lattice label, cell picking one row off, edge note dropped) fail 5, 1, 2, 1, 18 and 1 checks.

`node tools/check.mjs ideas/21-homeward-porkchop` passes, and its smoke screenshots and the ui-check screenshots (light and dark, 1280 and 390 px) were looked at.

## Honest assessment

- **[Certain] The solver reproduces Aster's Lambert oracles** (three end-to-end vectors to 1e-8, the poliastro-checked cell to 1e-15 measured) and every random leg flies or conserves its invariants. It is still not `izzo.ts`; Aster would ship its own.
- **[Certain for this record] The pipeline reproduces JPL NHATS's 1999 AO10 return leg to the record's rounding**, and with it settles, for this record, the two conventions idea 05 left open (its F4, F5): `dec_arr`/`dec_dep` are equatorial and `v_arr_earth` is the speed at 125 km. [Likely] the same holds for the whole NHATS set; one record decides it only for itself. These match the unshipped two-body check idea 05's reviewer ran; here it ships with tests.
- **[Certain] Bennu's residuals (+18.5 m/s, −35 m/s, −0.84°)** are measured. [Likely] they are 10.6 years of two-body drift from the 2026-05-01 epoch (Aster has no integrated Bennu truth to show it).
- **[Certain] Where Aster's L1 tier says the orbit is invalid, the return leg is wrong by km/s**, and the page washes those cells instead of hiding them. Apophis's drift is measured (11,990,403 km at the NHATS departure). Apophis's boundary is its 2.6 m/s 2028-09-12 pass while its drift stays below ~1.06e5 km until the 2029-04-13 flyby: the earliest-material rule is conservative there, as ratified.
- **[Certain] No delivered mass is ever shown**; the refusal is the same object on every cell.
- **[Speculative] Which cells matter for a mission.** The page is a two-body screen: no Earth or Moon flyby on the way home, no multi-revolution transfers (cheaper ones may exist for flights longer than about a year), impulsive burns, the body's gravity ignored, no stay or outbound leg coupled to it.
- **Rough.** The Earth is good to 205 km and 1 m/s, so the third decimal of a v∞ is ±1; NHATS rounds to the same decimal. Minima are lattice samples (27.4 d × 10 d). Viridis is not the house one-hue ramp (kept for parity with Aster). Body names are the catalog's (so "(1999 AO10)" keeps its brackets). The L2 sentence for Eros is mine, not Aster's verbatim string. No person has used the page.
- **Gates not passed.** Idea-bank fidelity: not through Aster's multi-agent math audit, oracle validation with Aster's own solver, the founding-document DEC process or the protected-core review; nothing in Aster was changed.

**Findings about the source repo** (observed at Aster `62ddb17`; not fixed there):

- **F1. K1's arrival quantity does not exist yet.** `strategy/IDEA_KERNELS_2026-09.md:125-129` (§6.1) says "The arrival quantity K1 needs therefore exists end to end today", citing `vInfArr` at `src/v2/porkchop/grid-compute.ts:36`. That `vInfArr` is the outbound v∞ at the asteroid (`|v₂ − v_asteroid|`, `grid-compute.ts:116-120`), not the Earth-arrival v∞ of a body-to-Earth leg, which nothing in Aster computes. The remaining K1 work is the whole leg, not only "the Earth-as-departure assumptions".
- **F2. The support boundary and its sentence are outbound-only.** `support-boundary.ts:49-50` keys on arrival and `tier-disclosure.ts:112` says "Arrivals after it …". Reused for K1 they would flag return cells that leave before the encounter: 893 of SG344's 1,330 supported cells on this lattice (947 of 2,940 for AO10, 974 of 10,430 for Bennu), including Bennu's NHATS leg, which reproduces. OQ-19-4 (`SLICE_19_FOUNDING.md:204-208`) should gain a return-leg clause.
- **F3. `lw` means prograde.** `lambertMultiRev`'s last parameter is named `lw` (`lambert-multi-rev.ts:282`), conventionally "long way", but it is passed to `buildGeometry(r1, r2, prograde)` (`:50`, `:291`), and the pinned-cells fixture records `"lw": true`. Anyone writing K1's grid could read it as a transfer-angle switch.
- **F4. One NHATS validation target cannot validate K1 in the window.** 2001 GP2's min-ΔV return reaches Earth 2041-11-08, after the Earth ephemeris (2040-12-31); its launch (2040-10-10) is also after its L1 boundary (2039-04-30). Two others (Apophis, SG344) leave after their boundaries. Of the five, only AO10 and Bennu are usable two-body return-leg checks.
- **F5. Weekly is not enough for Aster's Earth.** Not a defect (Aster interpolates daily records), but a measurement for C0 (Chebyshev vs Hermite, `IDEA_KERNELS` §1): cubic Hermite at 7 days gives 204.8 km and 0.994 m/s, dominated by the monthly lunar wobble, not the orbit.

**Deviations from the judged proposal, and why.**
- *Cut:* both transfer directions (prograde only, as Aster); "~150 × 60" became 200 × 70 (Aster's departure step is 25.7 d; this one 27.4 d); the proposal's "every M=0 pinned cell" is one cell (judge 3 was right), so the solver is also pinned to Aster's three end-to-end vectors, RK4, invariants and a closed form.
- *Corrected:* the departure line is `delta-v.ts:32-34`, not `:36`. The Hermite bound of ~82 km and the test "< 200 km and ≤ 2× the analytic bound" fail on real data (204.8 km); the measured bound is pinned instead. The proposal's held-out set (the 90-day fixture) is a byte-identical copy of the same Horizons data; it was replaced by the whole-span measurement, re-derivable from the checkout. "Slice 18 found 1,000 km along-track moves C3 by ~0.001%" is in no file I could find; dropped. "Eros escape ~10 m/s" is not computable from the catalog (no mass); dropped. NHATS "< 0.5 km/s for each of the five" is false for three (past the boundary or past the ephemeris); the residuals are pinned as measured and explained.
- *Added:* the departure-keyed support boundary (F2), edge flags on minima, the JPL drift-truth readout, capture Δv executed against Aster's own injection code, the frame measured three ways, the outbound C3 cross-check.

## Where it would land

- **Aster** (`/home/user/asteroid-mining-planner`): a `src/v2/porkchop/return-grid-compute.ts` beside `grid-compute.ts`, endpoints swapped, calling `lambertMultiRev` (so multi-revolution returns come free), the daily Earth ephemeris, and a departure-keyed `isDepartureAfterEncounter` beside `isArrivalAfterEncounter` in `support-boundary.ts`; a `?leg=return` mode on `/v2/porkchop/` (`src/v2/app/porkchop/main.ts`) whose cost card renders the refusal through the existing envelope shape; `explain_cell`/`porkchop_scan` gaining a `leg` argument so the MCP envelope carries Earth-arrival v∞ for K2.
- **Tests to carry over:** the AO10 NHATS reconciliation and the two settled conventions as `tests/v2-nhats-return-leg.test.mjs`; the Bennu residuals as regression values; GP2, Apophis and SG344 as expected refusals or flagged legs.
- **What must change to ship:** Aster's own solver instead of this one and daily Earth records instead of weekly; a K1 charter and founding-document DECs for the return-leg assumptions (impulsive departure, body gravity ignored, departure-keyed support, refusal wording); the multi-agent math audit before anything enters `src/v2/core`; the tier sentence's return-leg wording ruled; H0 before any return past 2040.
- **Idea Bank:** this page's Earth-arrival v∞ is the input idea 01 (Tip Match) asks a person to type.
