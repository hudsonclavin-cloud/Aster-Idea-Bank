# Required Life
> If HMPE replacement is booked as a rolling operating line (1/L of it relaunched every year), Skyhook's conservative case keeps its Y17 payback only if the HMPE in the Rev A tether, taken as all of it, lasts at least 28.5 years at 28% of rated break (14.3 years to slip one year; under 19.0 years, replacing it costs more than the whole $80M fixed-ops line; 13.0 years if each swap is instead paid in full when it falls due), against one anchored datum of about 8 years for SK78 at 20% load. The page adds the replacement line DECISION_LOG item 10 asks for, runs it backwards, and never prints a predicted life.

**Kind:** study
**For:** Skyhook
**Run:** open `ideas/26-required-life/index.html` in a browser (classic scripts, works from `file://`, no network). Tests, from the bank root: `node --test ideas/26-required-life/model.test.mjs` (28 tests, under a second; one reconciles against a committed fixture of Skyhook's own `finance/skyhook_finance.py` outputs and always runs, one runs that module live through `crosscheck.py` and skips if `/home/user/skyhook` or openpyxl is missing) and `node ideas/26-required-life/ui-check.mjs` (57 checks in headless Chromium with the globally installed Playwright; the folder's `check.mjs` runs it for `tools/check.mjs`). Rebuild the data: `python3 -B ideas/26-required-life/build_data.py --repo /home/user/skyhook`.
**Made by:** Holdfast

## What it is

A one-page study for Skyhook's newest named hard part. DECISION_LOG item 10 says the HMPE bulk of the tether carries a steady centrifugal load of 28–40% of its rated break, against published guidance of about 20% for multi-year life, and lists as admissible outcome (a) a "creep-governed tether replacement cadence, costed into ops". Nobody in the repository knows how long HMPE lasts at 28–40%: the only life on record is secondary guidance, "SK78 ≈ 8 yr at 20% load, 20 °C" (MP-001 §1). So the page does not guess one. It adds a replacement line to Skyhook's own cash flow and asks the inverse question: how long would the HMPE have to last for the case to hold?

What you can do on it:

- **Pick a tier and a ladder column.** The 2.5 km/s reference, the 2.8 km/s cislunar option or the 3.5 km/s Phase 3 option (the finance model's partial tier model), and the Conservative column (the Rule 4 base case) or the Baseline and Optimistic sensitivity columns.
- **Choose an HMPE share of tether mass.** It is not in canon, so the page computes nothing until you choose. It offers two readings of the founding document's "outer ~20 km of the lower arm in Zylon" (by length, 96.9%; by mass along the EQ-6 taper, 99.63% at the reference), all-HMPE, or your own share. Before you choose, the verdict says only what is true for any share: the conservative case keeps Y17 if the HMPE lasts at least 28.5 years × the share.
- **Price the fiber, or leave it unpriced.** `rev_a.json` has `fiber_cost_per_kg: null`. Left empty, the term is absent (not zero-priced) and marked *unpriced: a floor*. A typed number is labelled "your bracket, not a quote".
- **Choose a convention.** *Rolling* replaces 1/L of the HMPE every operating year (the cost of keeping the machine, an operating line). *Lumpy* replaces all of it at once at the end of each life.
- **Read the answer.** A verdict ("needs at least 28.4 years at 28% of rated break for payback to stay at Y17 … the only anchored point is about 8 years for SK78 at 20% … the gap is what ST-002 and TP-001 must measure"), a table of required lives for each criterion, and a step chart of payback year against life with the anchored SK78 tick, an optional DM20 tick and the life you are testing.
- **Test a life.** A logarithmic slider (it starts at the anchored 8 years, labelled as generous rather than a forecast) shows the replacement line per year, its size against fixed ops and mature revenue, the payback year and NPV@10% with and without it.
- **Read the sources.** Every quoted line (DECISION_LOG, MP-001, LR-001, the founding document, `rev_a.json`) is shown with its path and line number.

## Why I made it

**The open item.** `docs/DECISION_LOG.md:74` lists outcome (a), replacement cadence costed into ops, as "not yet decided", and `:78` opens "risk register row update; TP-001 scope addition; ST-002 protocol" as downstream actions. Nothing downstream exists yet: `finance/skyhook_finance.py:259` books operating cost as `var * m + s.fixed_ops_M` with no replacement term, no file under `finance/` mentions creep or tether replacement, and `tools/financial/skyhook_risk_register.xlsx` has twelve risk rows and none for creep. The proposal I was given (judged S2-05) said this; I checked each citation against Skyhook at `34935cb` before building, and they hold, with the corrections listed under *Changes from the proposal*.

**Alternatives I weighed.**

- *A creep-life predictor.* Fit a Vlasblom–Bosman or power-law creep model and turn 28–40% load into a life. Rejected: the repository has no primary creep curve, the one datum is secondary and does not even say what "life" means (rupture, or an elongation limit), and the output would be a life nobody can defend. This is exactly the guess the program should not make.
- *Costing outcome (b), the boundary shifted toward PBO.* That is a mass question, not an operations one, and idea 20 (*Twenty Percent Line*, built in parallel and now in the bank) answers it.
- *Pricing the fiber itself.* Idea 13 (*The Null Input*) adds fiber purchase to Rev A capex and says explicitly that a replacement cadence is out of its scope (its README, "a replacement cadence is out of scope and unmodelled"), so the two do not overlap: this page prices fiber only inside each swap, and only if you type a bracket.
- *A replacement axis on `finance/decision_grid.json`.* The grid has no such axis; adding one means re-exporting Skyhook's grid, which this bank cannot do.
- *Re-deriving item 10's "~41× to ~800×" at SF 5.* Already done by idea 15 (*Taper Is Not Mass*, 484.06×).

The inverse won because it is the honest form of the question: life stays an input, the output is a requirement in years, and that requirement is a number ST-002's coupons and TP-001's creep series can be judged against when they report.

## How it works

**The base model** is a line-by-line port of `finance/skyhook_finance.py` at `34935cb` into `model.js`: EQ-6 fiber mass (`fiber_mass_t`), system and total capex, marginal cost per kg (reboost electricity plus ops/wear), mature upmass and revenue, the revenue ramp, `net_cash_flows_M`, `payback_year` (first year cumulative net cash flow > 0, searched to 40 years) and `npv_M` (10%, 15-year window). Its inputs all come from snapshots:

| Input | From | How |
|---|---|---|
| σ 5.8 GPa, ρ 1,560 kg/m³, SF 2.5, tier tip speeds, half-length 320 km, CoM 610 km, μ, `fiber_cost_per_kg: null` | `params/rev_a.json` | `snapshots/rev_a.excerpt.json` (tools/snapshot.mjs `--pick`) |
| the 14 × 3 ladder (retention 0.70/0.85/1.00, launch $2,500/1,500/800 per kg, fixed ops $80/60/45M, price $500/kg, 1/2/3 catches a day, 5,000 kg, ramp, program capex …) | `tools/financial/skyhook_financial_model.xlsx`, Assumptions rows 3–16 | `snapshots/ladder.json`, derived by `build_data.py` with `zipfile` + `xml.etree`, rows named by `_LADDER_ROWS` (`skyhook_finance.py:56`) |
| capex spread 15/30/35/20%, ops from Y5, ramp step 0.3, 15-year window, 40-year payback search, 10% NPV rate | `finance/skyhook_finance.py:74–77, :264, :324` | `snapshots/finance_conventions.json`, read with `ast` |
| R_E = 6,371 km for the reboost line's v_orb | `physics/skyhook_physics.py:40` | `snapshots/physics_constants.json` (rev_a's `com_radius_km` 6,988 implies 6,378; the finance model uses 6,371, so this does too; see BRIEFING and idea 01) |
| "outer ~20 km of the lower arm in … Zylon" | `docs/project_instructions.md:108` | `snapshots/founding_hybrid.json` |
| 8 yr, 20% load, 20 °C; 28–40%; >50×; 0.97 g/cm³; SK99 +15–20% over SK78; ST-002 coupons at 20% and 40% | MP-001:23, :46, :22, :48; LR-001:45 | copied Markdown snapshots; `build_data.py` parses the numbers out of the quoted lines into `data.js`, and the tests check each line against its snapshot |

With no replacement line the port reproduces Skyhook's published conservative triple, $8,741M / Y17 / −$3,883M (DECISION_LOG items 6 and 8), the Baseline and Optimistic triples of item 6, and all five EQ-6 mass ratios and fiber masses in `rev_a.json` (40.32× … 3,085.95×; 201.6 t … 15,429.8 t). It also agrees with Skyhook's own module to 1e-12 relative in every flow of every tier and column, both against a committed fixture of the module's outputs (`snapshots/skyhook_finance_outputs.json`, written by `crosscheck.py --fixture`, sidecar at `34935cb`) and, when the checkout is present, run live.

**The replacement line** (this study's addition, a convention):

- replaced mass = *f* × fiber mass, where *f* is the HMPE share of tether mass;
- cost per kg = the column's construction launch price + fiber purchase (absent while unpriced);
- one full replacement costs *P* = *f* × fiber kg × cost per kg;
- *rolling*: *P*/*L* in every operating year from Y5; *lumpy*: *P* at *t* = 4 + *kL* years (*k* = 1, 2, …), booked in the year that contains *t*.

Swap hardware, installation operations, downtime and lost revenue are left out, and so is the hardware mass factor (hub, arrays and tips are not replaced). All of those are non-negative, so every required life here is a floor at the column's launch price.

**Hand-worked, conservative reference, all-HMPE, fiber unpriced, rolling.** One replacement is 609.1304 t × $2,500/kg = $1,522.83M. At *L* = 8 years that is $190.35M a year: 2.38× the $80M fixed-ops line and 20.9% of the $912.5M mature revenue (1 catch a day × 365 × 5,000 kg × $500/kg). Payback moves from Y17 to Y20 and NPV@10% from −$3,883M to −$4,727M.

**The inverse.** Under the rolling convention payback holds at year *Y* exactly when the cumulative base cash flow at *Y*, *C*(*Y*), exceeds the replacement spend booked up to *Y*, *P* × (*Y* − 4)/*L*. So the required life is *L*\*(*Y*) = *P*(*Y* − 4)/*C*(*Y*), exclusive (at *L*\* itself the cumulative is exactly zero and payback slips). For the conservative reference *C*(17) = $695.49M, so *L*\* = 1,522.83 × 13 / 695.49 = **28.5 years** (28.46) for payback to stay at Y17; *C*(18) = $1,495.88M gives **14.3 years** (14.25) for Y18, then 9.95 for Y19 and 7.87 for Y20. The page also solves it by bisection on the payback year itself, which is how it handles the lumpy convention; the two agree to 1e-9 under rolling. Two continuous criteria sit beside the stepped ones: replacement equal to fixed ops at *L* = *P*/$80M = **19.0 years** (19.04), and the floor *P*/(mature operating margin) = 1,522.83/(912.5 − 32.12 − 80) = **1.9 years** (1.903), below which the line outruns the margin and the case never pays back at any horizon. All of these are exactly proportional to *f* and to cost per kg: each $100/kg of fiber adds 1.14 years to the 28.46, and at $300/kg it is 31.9 years. ($300/kg is only an example bracket. It happens to be MP-001:24's Zylon marketplace proxy, "not a Toyobo quote". It is not an HMPE price, and the repository has none.)

**The HMPE share.** By length, the founding document's boundary leaves (640 − 20)/640 = 96.875% of the two-arm length in HMPE. By mass it is more, because the Zylon sits at the thin tip. A uniform-stress arm has area *A*(*r*) = *A*<sub>tip</sub> exp[*x*²(1 − *r*²/*L*²)], with *x* the EQ-6 argument, so the mass outboard of radius *a* in one arm is proportional to erf(*x*) − erf(*x a*/*L*). With *x* = 1.7326 at the conservative reference, the outer 20 km of one arm holds 0.37% of the tether and the HMPE share is **99.63%**, which makes the verdict 28.4 years (28.36). The test integrates the profile numerically and checks both this share and that the same integral is EQ-6.

**Load.** EQ-6 sizes the tether at a working stress of σ(1 − derate)/SF, so the HMPE runs at 0.70/2.5 = 28% of rated break in the Conservative column, 34% in Baseline and 40% in Optimistic: DECISION_LOG's 28–40% is the ladder.

**The ticks.** SK78 at 8 years is drawn at 8. The DM20 checkbox adds a second tick at 8 × 50 = 400 years, labelled as a lower bound ("DM20 > 400 yr") and as [Speculative], because turning ">50× slower creep" into "50× longer life" assumes life scales as 1/creep rate at the same load. Neither tick ever moves the life being tested. Both are at 20% load; the tether is not.

**A reading for ST-002 [Speculative].** On that same assumption, a grade that lasts *A* years at 20% meets a requirement *L*\* at a higher load only if creep there runs at most *A*/*L*\* times faster than at 20%. For SK78, 8/28.46 = 0.28: below 1, and creep does not slow as load rises, so SK78 cannot meet the requirement at 28% under this assumption. For a DM20-class grade, 400/28.46 = 14.05 (14.1 with the mass share): ST-002's 20% and 40% coupons measure a creep-rate ratio that bounds the 28%/20% one from above, so a measured 40%/20% ratio at or under 14.1 would be enough, if the kitchen throw line creeps like the flight grade.

**Every tier and column** (all-HMPE, fiber unpriced, rolling):

| Tier, column | HMPE load | Base payback | Payback holds | Slips ≤ 1 yr | = fixed ops | Never pays back below |
|---|---|---|---|---|---|---|
| 2.5 km/s, Conservative | 28% | Y17 | 28.46 yr | 14.25 yr | 19.04 yr | 1.90 yr |
| 2.8 km/s, Conservative (partial tier model) | 28% | Y22 | 85.81 yr | 44.57 yr | 46.14 yr | 4.62 yr |
| 3.5 km/s, Conservative (partial tier model) | 28% | not within 40 years | refused | refused | 482.2 yr | 48.4 yr |
| 2.5 km/s, Baseline | 34% | Y9 | 1.94 yr | 0.97 yr | 8.04 yr | 0.28 yr |
| 2.5 km/s, Optimistic | 40% | Y7 | 0.26 yr | 0.14 yr | 3.58 yr | 0.06 yr |

**Refusals.** No HMPE share: no required life, no chart, no forward view, only the per-share scaling and what would help. A base case that does not pay back within 40 years (3.5 km/s, Conservative): "No life is long enough", with the fixed-ops and floor lives still shown. The 15-year window for a case that already misses it (Conservative): refused, citing DECISION_LOG item 8. A life of zero or less, a share outside 0–1, or a negative fiber price: refused with what to enter.

## Tests

`model.test.mjs`, 28 tests, Node built-ins only, under a second:

- **Data.** `data.js` deep-equals the five JSON snapshots and `build_data.py --check` agrees it is fresh; every quoted line equals its snapshot line (DECISION_LOG:47, :57, :70, :74, :76, :78; MP-001:22, :23, :46, :48, :57; LR-001:45), and the parsed numbers are the documents' own (8 yr, 20%, 20 °C, 28%, 40%, 50×, the 20% and 40% coupons, 0.97 g/cm³); every one of the nine snapshots has a sidecar naming Skyhook `34935cb`.
- **Reconciliation.** erf at eight points against Python's `math.erf` to 1e-14 (from the committed fixture; the builder's version pinned three values "quoted from memory", which the review removed); the conservative triple $8,741M / Y17 / −$3,883M, parsed from the DECISION_LOG snapshot; the Baseline and Optimistic triples of item 6; all five mass ratios and fiber masses in `rev_a.json`; and Skyhook's own module twice. `crosscheck.py` imports Skyhook's `finance/skyhook_finance.py` (bytecode off, nothing written to the checkout), takes the base cash flows from `net_cash_flows_M`, and subtracts a replacement line written a second time in Python. `model.js` must match it to 1e-12 in mass, capex, revenue, every flow, payback, NPV and the closed-form *L*\* for all nine tier × column cases, and in payback, NPV and cumulative cash for ten replacement runs each. The first test checks against `snapshots/skyhook_finance_outputs.json`, the module's outputs at `34935cb` committed at review, so it runs on any machine. The second runs the module live when the checkout and openpyxl are here, also compares the 40-year flows of every run, and fails if the module's outputs have drifted from the fixture.
- **The line.** The $190.35M hand check; zero in Y1–4 and exactly *P*/*L* from Y5; monotone in *L*, linear in *f* and cost per kg; closed form equals bisection for every case and target, with payback holding at *L*\*(1 + 1e-6) and slipping at *L*\*(1 − 1e-6), and the proposal's own check (payback Y18 just below 28.46, Y17 at 28.46 + 0.01); the conservative table above; exact proportionality to *f* and to price; the floor (no payback in 400 years just below it, payback just above); lumpy events in years 12, 20, 28, 36 for *L* = 8 and 11, 17, 23, 29, 36 for *L* = 6.25, the same average cost as rolling, and the lumpy *L*\* of 13 years; a hand-worked exact-zero cash flow that pins "strictly positive" in the payback rule; the window criterion at its boundary (Baseline at 3.5 km/s pays back in exactly Y15, so it gets a window life).
- **Refusals**, the unpriced term (absent, flagged, only ever raises *L*\*), the two share readings (Simpson integration of the taper profile, and the profile integral equals EQ-6), the 28/34/40% load, the DM20 tick (adds 400, leaves the SK78 tick alone), the ST-002 thresholds, the grade sensitivity (with the heavier tether's capex carried through: base payback Y19 and Y20, fixed-ops lives 32.4 and 38.6 years), and that this README states the numbers the code computes, including every cell of the every-tier-and-column table.

`ui-check.mjs`, 57 checks: at 390 px in dark mode by touch, the page opens refused (no life printed, table hidden, chart and forward view refusing) and states the per-share scaling, with every sourced figure in its static text (28–40%, the 20% and 8-year datum, the >50× quote, the fiber note) filled from `data.js`; after choosing the mass share the verdict, all six table rows, the chart's SK78 and required-life markers and the forward view's $/yr, payback and NPV equal `model.js`; the DM20 toggle leaves the tested life, the slider and the forward view untouched and adds the 400-year tick and the 14.1× reading; a typed fiber price is labelled a bracket and raises the life to 31.8 years, a negative one is refused with nothing printed, Clear restores "unpriced"; lumpy shows 13.0 years and counts swaps; a zero life is refused; the 3.5 km/s tier refuses; a $1e300/kg bracket and a 1e-300-year life print in exponent form without sideways scroll (added at review); at 1280 px in light mode the share radios work by keyboard (Space, arrow keys), a Baseline column is labelled a sensitivity at 34% load, and a share of 0 says there is nothing to replace instead of "at least 0 years" (added at review); no sideways scroll, no console errors, no network requests.

**Teeth, counted (re-run at review).** Each mutation was applied to `model.js` alone in a copy of the folder, and the node suite was run twice: with the Skyhook checkout present (28 tests) and with the live cross-check pointed at a missing checkout (27 run, 1 skipped). The counts are failing tests. Every mutation is caught both ways.

| Sabotage | with checkout | without |
|---|---|---|
| replacement added instead of subtracted | 8 | 7 |
| rolling replacement starts in Y4 | 7 | 6 |
| rolling replacement starts in Y6 | 5 | 4 |
| closed form uses *Y* − 5 operating years | 8 | 7 |
| erf series stopped at 1e-6 | 4 | 3 |
| payback on cumulative ≥ 0 | 1 | 1 |
| ramp step 0.2 instead of 0.3 | 10 | 9 |
| lumpy events booked a year late | 3 | 2 |
| Zylon counted in both arms (mass share) | 2 | 2 |
| length share taken over one arm | 1 | 1 |
| load fraction from derate instead of retention | 2 | 2 |
| DM20 factor applied to the SK78 tick | 1 | 1 |
| v_orb from rev_a's 6,988 km radius | 3 | 2 |
| unpriced fiber silently priced at $1,000/kg | 12 | 11 |
| hardware mass factor applied to replacement | 10 | 9 |
| 360 days a year instead of 365 | 10 | 9 |
| NPV discounted at the start of each year | 3 | 2 |
| floor margin without the variable cost | 4 | 4 |
| HMPE share above 1 accepted | 1 | 1 |
| ST-002 ratio inverted | 1 | 1 |
| window row needs base payback < 15 (boundary) | 1 | 1 |
| hardware factor dropped from capex | 13 | 12 |

Before the review, the v_orb mutation was caught only by the live cross-check. It moves the reboost line by $0.0028 per kilogram and NPV by $0.02M, below every rounded figure Skyhook publishes, so without the checkout it passed. The committed fixture now catches it on any machine. The window-boundary mutation passed the builder's 25 tests and is caught by a test added at review. The builder also counted two page mutations, caught only by ui-check: the DM20 toggle scaling the tested life (2 checks) and a life printed before a share is chosen (6). The review did not re-run those. ui-check compares the page with `model.js`, so a mutation of the model moves both together. Model mutations are the node suite's job, and page mutations are ui-check's. `node tools/check.mjs ideas/26-required-life` passes: README, size, sidecars, both suites, and the smoke test at 1280 and 390 px.

## Honest assessment

What works:

- **[Certain]** The base model is Skyhook's finance model: it reproduces the published triples and mass ratios listed above and matches the module itself to 1e-12 relative (a committed fixture of its outputs, and live when the checkout is present). I did not reproduce the breakeven figures (`rev_a.json`'s $686/kg and $517/kg, `finance/SENSITIVITY_FINDINGS.md`), which need solvers this study does not use.
- **[Certain]** Under the stated convention the replacement arithmetic and the inverse are exact: closed form and bisection agree, and the required life is exactly proportional to the HMPE share and to cost per kg.
- **[Certain]** The page never prints a predicted life. Its only lives are requirements, the anchored datum with its load and temperature, and the DM20 tick labelled as a lower bound on an assumption.
- **[Certain]** Every required life is a floor at the column's launch price: what is left out (fiber while unpriced, swap hardware, installation, downtime, lost revenue) can only add cost.

What is rough:

- **[Certain] The headline rests on $695M of slack.** The conservative case clears Y17 by $695.49M of cumulative cash, and any line averaging more than $53.5M a year (695.49/13) pushes payback to Y18. The payback criterion is a step function; the fixed-ops (19.0 years) and floor (1.9 years) criteria are continuous and are the steadier numbers.
- **[Certain] The convention matters a lot.** Lumpy replacement keeps Y17 from 13.0 years, rolling needs 28.5: lumpy only asks the first swap to fall after Y17 (4 + 13 = 17), while the $1,523M swap still recurs after it. I made rolling the default because item 10 says "costed into ops", and the page says so. Rolling is an accrual. It books replacement from Y5, before any fiber has aged, so it is the steady-state cost of keeping the machine running. It is not the cash timing of a tether installed new at Y5, which is the lumpy case. It is the conservative choice (Rule 4), so 28.5 years is a requirement under that convention, not a cash fact, and the tagline now says so.
- **[Certain] It is linear in launch price too.** If replacement launches were cheaper than the column's $2,500/kg the requirement would fall in proportion; at `rev_a.json`'s speculative $629/kg marginal it would be 7.2 years. I did not offer that switch: mixing a cheaper price into the conservative column is the error DECISION_LOG item 7 records.
- **[Speculative] The HMPE share.** Not in canon. The two readings of the founding document give 96.875% and 99.63%, so against all-HMPE they move the answer by 3.1% and 0.4%, but a different architecture (a whole Zylon arm, one reading of `rev_a.json`'s "Zylon outer arm") would halve it.
- **[Likely] The single-material mass is a close stand-in for SK99, not for SK78.** EQ-6 here uses Zylon σ and ρ for the whole tether, as Skyhook does. With `rev_a.json`'s SK99 3.6 GPa and MP-001's 0.97 g/cm³ (secondary) an all-HMPE tether is 122.60×, 0.6% heavier than 121.83×. But the creep datum is for SK78, and MP-001 puts SK99 15–20% stronger than SK78: at SK78's strength (3.6 GPa ÷ 1.15–1.20) the tether would be 1.70–2.03× heavier. That does more than lengthen the required life. The heavier tether also costs $1,930–2,812M more system capex (fiber launch × hardware factor), which alone moves the base payback from Y17 to Y19–Y20 before any replacement. So at SK78 strength no life keeps Y17. Only the capex-free criteria scale with the mass: replacement equals fixed ops at 32.4–38.6 years, and the floor rises to 3.24–3.85 years. (The builder's version said the Y17 requirement would be 1.70–2.03× longer, 48–58 years. That holds the base case at the canonical mass, which a heavier tether cannot do. The review corrected it, and a test now pins both readings.)
- **[Likely] The anchored 8 years is generous for Rev A,** since it was given at 20% load and creep rises with load. It is also secondary-sourced and does not say what failure it means.
- **[Speculative] The ST-002 reading** rests on life ∝ 1/creep rate at a given load (a fixed allowable stretch reached at a steady rate), on LR-001's ">50×" holding as a life factor, and on the throw line creeping like the flight grade.
- **[Certain] Partial tier model.** The 2.8 and 3.5 km/s rows change only tip speed, as `finance/skyhook_finance.py` does; they are not those tiers' business cases.
- **[Likely] The NPV and window figures** use the finance model's 15-year window; payback years past 15 are its steady-state extrapolation.

**Findings about the source repo** (Skyhook at `34935cb`; not fixed there):

- `finance/skyhook_finance.py:259`: operating cost is `var * m + s.fixed_ops_M`; DECISION_LOG item 10 outcome (a) (`docs/DECISION_LOG.md:74`) has no cost line anywhere under `finance/`.
- `tools/financial/skyhook_risk_register.xlsx` (sheet Risk Register, rows 5–16) has no creep row. `docs/research/mp001_market_pricing.md:57` asks Hudson to "update the UHMWPE-creep row", which does not exist; `docs/program_manifest.md:39` correctly says "add: UHMWPE creep". `docs/DECISION_LOG.md:78` still lists the row as an open downstream action.
- `params/rev_a.json` `materials.construction_baseline` ("Spectra/UHMWPE core + Zylon outer arm (Hoytether architecture)") does not state the hybrid boundary, and "Zylon outer arm" can be read as a whole arm; `docs/project_instructions.md:108` says "the outer ~20 km of the lower arm". The HMPE share every creep cost depends on is not in canon.
- `docs/research/mp001_market_pricing.md:23` gives the only creep life for SK78, while `rev_a.json` `materials.alternative_fibers` carries SK99 strength (3.6 GPa), and MP-001:22 says the two differ by 15–20%. The life datum and the strength datum are for different grades, and the life's failure criterion is not stated.
- (About this bank's proposal, not Skyhook.) The judged proposal's third note says MP-001 line 46 carries the DM20 ">50×" figure; it is in `docs/research/lr001_splice_literature.md:45` (DECISION_LOG:74 cites it correctly).

**Gates not passed.** Skyhook's Rule 1 canon (the HMPE share and the replacement convention are not in `params/rev_a.json`, and Hudson has not chosen them), a verification memo of the arithmetic, and the pytest suite: the cross-check runs Skyhook's finance module but this deposit has no pytest test inside Skyhook. It is an idea-bank prototype.

**What the independent review changed (2026-11-02).** The review recomputed the load-bearing numbers in its own Python on top of Skyhook's `finance/skyhook_finance.py`. It got $1,522.83M per swap, *C*(17) = $695.49M, *L*\* = 28.46 / 14.25 / 9.95 / 7.87 years, 19.04 and 1.903 years, $190.35M a year at 8 years, NPV −$4,727M, the 99.63% taper share and every row of the tier table. All of them held except the ones listed here. It opened every citation, ran 22 sabotage mutations, and drove the page at 390 and 1280 px in light and dark with empty, zero, negative and absurd inputs. What it changed:

- **Wrong claim, fixed.** *The single-material mass* paragraph said a tether at SK78 strength would need "1.70–2.03× longer (48–58 years)". That holds the base case at the canonical mass. With the heavier tether's capex carried through, the base payback is Y19–Y20 and no life keeps Y17, so the paragraph now says that. The capex-free criteria (32.4–38.6 years, 3.24–3.85 years) are pinned by a test.
- **Headline made conditional.** The tagline stated 28.5 years with no convention. It now names the rolling line, all-HMPE, and the 13.0 years a pay-when-due swap needs. The convention bullet explains that rolling is an accrual.
- **Wrong table cell, fixed.** In the 2.5 km/s Baseline row, "slips ≤ 1 yr" was 0.98 years; the code gives 0.9749, so 0.97. A new test checks every cell of that table against the code.
- **Reconciliation that runs everywhere.** The reconciliation against Skyhook's module skipped without the checkout, and with it the only test that caught the v_orb mutation. The module's outputs are now a committed fixture (`snapshots/skyhook_finance_outputs.json`, written by `crosscheck.py --fixture`, sidecar from `tools/snapshot.mjs`). The live run still checks it for drift.
- **No number from memory.** The three erf values "quoted from memory" were replaced by Python's `math.erf` at eight points, from the fixture.
- **Boundary test.** A window-row mutation (`base < 15` for `base <= 15`) passed all 25 of the builder's tests. A test now pins Baseline at 3.5 km/s, whose base payback is exactly Y15.
- **Page.** A $1e300/kg fiber bracket pushed the page about 2,800 px sideways at 390 px. Absurd magnitudes now print in exponent form, and long source paths wrap. An HMPE share of 0 printed "needs at least 0 years"; it now says there is nothing to replace. ui-check has 4 more checks (57).
- **Wording.** Idea 20 is now in the bank, and idea 13's fiber-purchase line is named as a non-overlap. The $300/kg example is traced to MP-001:24's Zylon proxy, which is not an HMPE price. The proposal finding is marked as being about this bank's proposal, not Skyhook.

## Where it would land

Skyhook, as `finance/creep_cadence.py` with `finance/CREEP_CADENCE_FINDINGS.md`: a Python port of `model.js`'s replacement line and inverse, importing `finance/skyhook_finance.py` and `params/rev_a.json` through the physics module instead of these snapshots, reconciliation-gated like `finance/rightsize_sensitivity.py` (replacement off must reproduce $8,741M / Y17 / −$3,883M before anything prints). Its numbers would feed the creep row to be added to `tools/financial/skyhook_risk_register.xlsx`, the TP-001 creep-series scope, and the ST-002 protocol as a pass/fail ratio. To ship for real it needs: a canonical hybrid boundary (and so HMPE share) in `rev_a.json`; Hudson's choice of replacement convention; a sourced creep-life datum at 28–40% (ST-002's coupon ratio, TP-001, or a rope-maker application-engineering dataset); cost lines for the swap itself; pytest tests in `tests/`; and the page, if wanted, under `tools/sims/` reading the Python module's exported JSON.

## Changes from the proposal

- **No `ladder.json` in Skyhook.** The proposal listed one as data to snapshot; the ladder lives only in the workbook, so `build_data.py` derives it from the .xlsx with the standard library, rows named by the finance module's own row map.
- **Added a taper-weighted mass reading** of the founding document's boundary (99.63%) beside the length reading (96.875%) the proposal suggested: the Zylon is at the thin tip, so length overstates its mass share.
- **Added the lumpy convention** as a labelled sensitivity, because the rolling answer (28.5 years) and the lumpy one (13.0) differ so much that showing one alone would hide a choice.
- **The proposal's boundary test was made exclusive.** At *L*\* exactly the cumulative cash flow is zero and round-off decides the payback year, so the test checks just below *L*\* (Y18) and at *L*\* + 0.01 (Y17).
- **"28–40% load" became the column's own load** (28/34/40%, derived from the ladder and SF), so the verdict states the load the chosen column actually runs.
- **The page states the per-share scaling before a share is chosen** (28.5 years × the share), instead of showing nothing; it is exact for any share and needs none.
- **Added the [Speculative] ST-002 reading and the grade sensitivity,** both with their assumptions stated, because they turn the gap into something the planned tests can confirm or refute.
- **Kept, not dropped:** the "never a predicted life" rule, the unpriced badge mirroring `finance/inspace_fork.py`'s `require_non_null` (line 194), the DM20 tick moving only the tick, the fixed-ops crossing, and the closing sentence.
