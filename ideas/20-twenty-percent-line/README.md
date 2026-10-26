# Twenty Percent Line
> Skyhook's construction baseline (HMPE bulk, 20 km of Zylon at the lower tip) weighs 122.56× its payload under the canon's sizing rule, which loads every HMPE metre to 28 % of break while a payload rides; holding the HMPE to DECISION_LOG item 10's 20 % on every load makes it 454.78× (+1,661 t), holding it to 20 % only between catches, when the tips are bare, makes it 212.11×, and the two readings put the extra PBO at opposite ends of the arm (SK99 density from the founding document, not canon).

**Kind:** explorable
**For:** Skyhook
**Run:** open `ideas/20-twenty-percent-line/index.html` in a browser (classic scripts, works from `file://`; no build, no network). Tests, from the bank root: `node --test ideas/20-twenty-percent-line/twenty.test.mjs` (18 tests, Node built-ins plus `python3` for two oracle tests that skip without it; about 2 s) and `node ideas/20-twenty-percent-line/ui-check.mjs` (82 checks in headless Chromium through the globally installed Playwright; about 10 s; `check.mjs` runs it for `tools/check.mjs`). `node ideas/20-twenty-percent-line/build-data.mjs /home/user/skyhook` regenerates `snapshots/` and `page-data.js` from a Skyhook checkout at `34935cb`.
**Made by:** Thimble

## What it is

A page about one sentence in Skyhook's decision log: *HMPE at 28–40 % of break versus ≤ 20 % multi-year guidance* (`docs/DECISION_LOG.md` item 10, open). It costs the creep line in tonnes on a two-material arm, the construction baseline's, instead of a single-fibre one.

- **The tether.** Two arms of 320 km (`rev_a.json`). The baseline (`docs/project_instructions.md:108`) is HMPE for the bulk of each arm with the outer ~20 km of the lower arm in Zylon PBO; the upper arm is all HMPE. A slider adds PBO to each arm, either **at the tip end** (HMPE stays at the hub, the baseline's order) or **at the hub end** (a PBO core with HMPE outboard; the lower arm keeps its Zylon tip). At 320 km both arms are all PBO, which is the canon's own single-fibre tether.
- **Three ways to size the HMPE**, each a uniform-working-stress taper like EQ-6:
  - *Canon rule, no cap*: both fibres at (1 − derate)/SF of break while a payload rides, 28 % at the canon's SF 2.5 and 30 % derate.
  - *Cap on every load*: HMPE held to the cap (20 %, item 10's guidance) with or without a payload. This is item 10's own reading ("Reaching 20% sustained load would require SF ≈ 5").
  - *Cap between catches*: HMPE held to 28 % while a payload rides and to 20 % between catches, when the tips are bare. This reading is mine, not the program's (see *Honest assessment*).
- **Controls**: the three `rev_a.json` tip-speed tiers, the PBO added and where, the working load (with buttons for the canon ladder's 0 / 15 / 30 % derates), the cap, the mass each tip carries between catches (0 by default, as Skyhook's dynamics model has it), and the HMPE fibre (SK99, or a custom fibre typed by hand and marked not canon).
- **Readout**: tether mass over payload (two arms), tonnes at the canon's 5,000 kg payload, the all-PBO tether at the same load, the length of HMPE above the cap *with a payload aboard* and *between catches*, the highest HMPE load between catches, the HMPE share of the fibre mass, and a sentence that says it with all three rules side by side.
- **Where the load sits**: the tether drawn twice, tip to hub to tip, as a round line whose width follows √area, coloured by load as a fraction of break (grey at the cap, red above, blue below; PBO hatched), once with a payload aboard and once between catches, with ▲ where HMPE drops under the cap.
- **What the PBO buys back**: mass ratio against PBO added, one curve per rule, log scale, draggable by mouse or touch, with a table view.
- **Which end should the PBO go to?** Five rows of PBO added, both ends, for the two capped rules, the lighter of each pair in bold.
- **Item 10, recomputed**: its consequence sentence quoted verbatim, a table of EQ-6 at every load fraction the item and the canon name (ticked against `rev_a.json` where the canon has the rung), and four computed findings.

If `page-data.js` does not load, the page says *No canon file, no numbers*, disables every control and shows no ratio anywhere. If the SK99 density line, the layout line or the guidance line is missing or reworded, the parts that need it refuse with what would help, and the rest still works.

## Why I made it

Item 10 (`docs/DECISION_LOG.md:66-78`, status OPEN, dated 2026-09-02) names HMPE creep a hard part and lists four admissible outcomes "not yet decided": (a) a creep-governed replacement cadence, (b) "hybrid material boundary shifted toward PBO for the high-stress fraction", (c) an HMPE grade change (DM20 "reported to creep >50× slower than SK78", `docs/research/lr001_splice_literature.md:45`), (d) a mix. The same text is in `docs/research/mp001_market_pricing.md:46` (§3c) and `docs/program_manifest.md:65`. Nothing in the repo models a two-material tether: `physics/tether_dynamics.py:17-25` and `tools/twin/physics.js:187` integrate the single-material profile A(s) = A_L·exp[x²(1 − s²/L²)], and the program site's taper drawing (`tools/sims/skyhook_program_site.html:366`) is single-material too. So outcome (b) exists in the log only as an adjective. I checked every citation in the judged proposal against the checkout at `34935cb` before building.

What I weighed:

- **Outcome (a), a replacement cadence.** It needs a creep law (none in the repo; the guidance is one point, "SK78 ≈ 8 years at 20% load, 20 °C", secondary-sourced) and a fibre price (`economics.fiber_cost_per_kg: null`, "WEAKEST INPUT"). Anything I built would be a made-up curve with a real-looking number on it.
- **Outcome (c), DM20.** The repo has a ratio (">50×") and no strength, density or curve. Same problem.
- **A lint for the "~800×" sentence.** Idea 15 (*Taper Is Not Mass*) already found that EQ-6 at SF 5 gives 484.06×, not ~800×. Repeating it would add nothing.
- **This: outcome (b) as a computation.** It is the one outcome the canon's own physics can price, with the canon's own sizing rule, and it can refuse cleanly where the data stops. Building it turned up two things the log does not say (below): the "steady" 28 % is the load *with a payload aboard*, and which end of the arm the PBO belongs at depends on which load the 20 % is applied to.

## What I changed from the proposal

- **The SK99 density is not in `rev_a.json`.** The proposal reads "Dyneema SK99 3.6 GPa, 970 kg/m3, rev_a.json alternative_fibers". The canon has the strength only (`materials.alternative_fibers.Dyneema_SK99_GPa`); 970 kg/m³ is in the founding document's material survey (`docs/project_instructions.md:67`), corroborated by MP-001's "0.97 g/cm³" (`mp001_market_pricing.md:22`, secondary spec sheets). Rule 1 says a deviation must be explicit, so the page reads it from a snapshot of that line, labels every HMPE-dependent number *ρ not canon*, and refuses SK99 (offering a typed custom fibre) if the line is missing or reworded. Idea 15 made the other choice (refuse SK99 outright); here HMPE is the subject, so refusing it by default would leave nothing.
- **Controls.** The proposal has three: boundary position, f_H and f_P. I use one working load for both fibres (the canon has one SF and one derate) plus a cap and a rule. Its two curves (f_H = 0.28 and f_H = 0.20 at f_P = 0.28) are this page's *canon rule* and *cap on every load* curves; f_H < f_P is the second. I added the *cap between catches* rule, the hub-end layout, and the tip-mass slider, and dropped a free f_P slider.
- **The boundary is "PBO added per arm" from the §4.1 baseline**, not one boundary on a symmetric tether: the baseline is asymmetric (Zylon only on the lower arm), and the proposal's own landing names §4.1 as the case to generalise. The single-fibre limits the proposal's tests ask for (all PBO, all SK99) are tested through the kernel directly.
- **"Length above the 20 % line … is simply the HMPE share of length."** True with a payload aboard (tested: 620 of 620 km at the baseline). Between catches it is not, and that turned out to be the interesting part, so the strip shows both states.
- **The SF 5 numbers are kept but reframed.** 484.06× / 1,104.53× / 3,515.24× at 0 / 15 / 30 % derate reproduce, but they are three different load fractions (20 / 17 / 14 % of break); only the first is "20 %". The page credits idea 15 for 484.06×.
- **The 20 % line's citation** is `docs/DECISION_LOG.md:70` (which quotes MP-001 §3c), parsed from the snapshot, with the item's own "[Likely … spot-check pending]" label carried on the page.
- **The proposal's "1e5-point numerical quadrature to 1e-6"** became an RK4 integration of the tension ODE with the sizing rules written out directly (no erf, no closed form), 20,000 steps per arm length, over 48 configurations; worst relative difference from the closed form is 5.6 × 10⁻⁹.

## How it works

**One arm, nondimensional [Certain].** Put u = s/L (hub 0, tip 1), t = T/T_L with T_L = m·v²/L the tip tension with the payload aboard, and masses in payloads. A fibre of strength σ and density ρ has V_c = √(2σ/ρ) (EQ-4) and k = (v/V_c)². A section held at a fraction f of break has area A = T/(fσ). The centrifugal balance dT/ds = −ρAω²s becomes dt/du = −2X²·t·u with X² = k/f, and the mass per unit u is 2X²·t. So within a section from u₀ to u₁, with t₁ the tension at its outer end:

t(u) = t₁·exp[X²(u₁² − u²)],  mass = √π·X·t₁·e^{X²u₁²}·[erf(Xu₁) − erf(Xu₀)].

One section from hub to tip gives √π·x·e^{x²}·erf(x) per arm, EQ-6 with x = (v/V_c)/√f. That is why SF and derate never matter separately: x depends on them only through **f = (1 − derate)/SF**. Sections are chained from the tip inward with t continuous at each boundary (the tension has to be; the area steps by the ratio of working stresses, σ_P/σ_H = 1.61 between Zylon and SK99 at equal f). The derivation is the standard constant-stress taper, generalised by me to piecewise sections; it ignores gravity gradient and the orbit, as EQ-6 does.

**The three rules [Certain as algebra].** PBO is always held at f_s. HMPE: *canon rule* at f_s; *cap on every load* at min(f_s, c); *cap between catches* with A = max(T/(f_s σ), T_off/(c σ)), where T_off = T − (1 − β)·T_L is the same tether's tension with only β payloads on the tip. Going inward t rises, so the second term takes over at t* = (1 − β)/(1 − c/f_s); inboard of that the section follows T_off with Y² = k/c, the same closed form. At t* both terms give the same area, so the profile is continuous. With β = 1 the rule is *cap on every load*; with c ≥ f_s it is the canon rule (both tested).

**Load as a fraction of break [Certain].** With a payload aboard a uniform section carries exactly f everywhere, which is why under the canon rule every HMPE metre is above 20 % (the proposal's point). Between catches the same section carries f·(1 − (1 − β)/t). At the hub of the baseline that is 28 % × (1 − 1/20.23) = 26.6 %, and it falls to zero at the tip. For an all-HMPE arm the crossing is at 1 − u*² = ln[1/(1 − c/f)]/X², u* = 0.764: the outer 24 % of each arm is under the line between catches. The payload rides for half a rotation per catch (`docs/project_instructions.md:10`), πL/v = 6.7 min at 2.5 km/s, half of `rev_a.json`'s 13.4 min period.

**Why the ends differ [Certain, tested by finite differences].** Swapping a short length at u_b from PBO to HMPE changes the arm's mass by 2(X_H² − X_P²)·[t(u_b) + u_b·M_in(u_b)] per unit u, where M_in is the mass inboard of u_b. The bracket's derivative is M_in ≥ 0, so the same swap costs more the further out it is: a kilogram far out is carried by every metre inboard of it. Under *cap on every load* HMPE is the costlier fibre everywhere, so it belongs at the hub and the PBO at the tip, the baseline's order. Under *cap between catches* HMPE costs extra only where the cap binds, which is near the hub; there, replacing HMPE with PBO is what pays.

**The numbers** (computed by `model.js`; 2.5 km/s, f_s = 28 %, cap 20 %, bare tips; SK99 with ρ = 970 kg/m³ not canon):

| Layout | canon rule | cap on every load | cap between catches |
|---|---|---|---|
| §4.1 baseline | 122.56× (612.8 t) | 454.78× (2,273.9 t) | 212.11× (1,060.6 t) |
| + 100 km PBO per arm, tip end | 122.22× | 244.41× | 201.51× |
| + 100 km PBO per arm, hub end | 122.41× | 355.17× | 170.46× |
| all PBO (320 km per arm) | 121.83× | 121.83× | 121.83× |

The all-PBO row is the canon's conservative rung, 121.83× (`rev_a.json` `conservative_30pct_derate`). Under the canon rule the baseline sits 0.6 % above it (+3.7 t) because SK99's V_c (2.7245 km/s) is within 0.09 % of Zylon's (2.7269 km/s); at equal load the boundary is nearly free and only the cap makes it matter. Between catches, under the canon rule, 489 km of the baseline's 620 km of HMPE is above 20 %, up to 26.6 % at the hub. Under *cap between catches*, 231 km of PBO per arm at the hub end brings the tether within 1 % of all-PBO; at the tip end it takes 311 km (searched in 1 km steps). The *cap between catches* figure rises with tip mass: 221.01× at β = 0.1, 231.46× at 0.2, 278.76× at 0.5, and 454.78× at 1. At the other tiers the baseline is 297.41× / 1,465.36× / 692.80× (2.8 km/s; all-PBO 295.27×) and 3,119.27× / 34,175.56× / 16,881.95× (3.5 km/s; all-PBO 3,085.95×).

**Item 10, recomputed [Certain arithmetic].** EQ-6 for one fibre, both arms, at 2.5 km/s:

| f = (1 − derate)/SF | where it comes from | all Zylon | all SK99 (ρ not canon) |
|---|---|---|---|
| 40 % | SF 2.5, 0 % derate (canon rung 40.32×) | 40.32× | 40.52× |
| 34 % | SF 2.5, 15 % (64.30×) | 64.30× | 64.65× |
| 28 % | SF 2.5, 30 % (121.83×) | 121.83× | 122.60× |
| 20 % | SF 5, 0 %; equally SF 3.5 at 30 % | 484.06× | 488.14× |
| 17 % | SF 5, 15 % | 1,104.53× | 1,115.31× |
| 14 % | SF 5, 30 % | 3,515.24× | 3,556.21× |

"from ~41× to order ~800×" (`DECISION_LOG.md:72`): ~41× is the 40 % rung, and 20 % of break gives 484.06×, 12.0 times as heavy, not ~20. 800× needs f = 18.07 % (SF 5 at a 9.67 % derate), which no rung names. Item 10's "28–40 %" reproduces exactly from `rev_a.json` (1/2.5 and 0.7/2.5).

**erf [Certain].** The all-positive series (Abramowitz & Stegun 7.1.6) below 2.25 and the continued fraction for erfc (A&S 7.1.14) above, so erf(b) − erf(a) near 1 keeps its relative precision. Agrees with CPython's `math.erf` to 2 × 10⁻¹⁵ and `math.erfc` to 10⁻¹² on [0, 6] (tested). The A&S numbering is from my memory [Likely]; the values are tested.

**Where every input comes from.** `snapshots/rev_a.json` is a whole copy of `params/rev_a.json` at `34935cb` (sha256 `d0828c1e…`): Zylon σ 5.8 GPa and ρ 1,560 kg/m³, SK99 σ 3.6 GPa, SF, derate, half-length, the three tier speeds, the rotation period, the 5,000 kg payload and the ladder. `snapshots/lines/*.json` hold 27 verbatim lines keyed by their line numbers in five Skyhook files (`DECISION_LOG.md:66-76`, `project_instructions.md:10,67,108,112`, `mp001_market_pricing.md:22,23,46`, `lr001_splice_literature.md:45`, `tether_dynamics.py:17-25,81,120,353,357`), each with a provenance sidecar; the page parses the numbers it needs from them with patterns anchored to the wording (970 kg/m³, the 20 km Zylon tip, the 20 % cap, 28–40 %, SF ≈ 5, ~41× and ~800×, >50×, ~4 %, 3–5×) and refuses a number whose line changed. `snapshots/skyhook_physics.py` is Skyhook's physics module, used only as a test oracle. `page-data.js` wraps the snapshots as a classic script (generated, and tested deep-equal to them).

**The page.** `model.js` is pure and loads with `require()` or as a script; `app.js` draws inline SVG sized to its container. Colours are CSS variables with a dark set under `prefers-color-scheme`; the three rules use the first three slots of a validated categorical palette and are also labelled directly; the strip's diverging scale runs blue → grey (at the cap) → red in OKLab, saturating ten points above the cap (a display choice). No storage, no network.

## Tests

`twenty.test.mjs`, 18 tests (Node built-ins; python3 for two):

- **Snapshots.** `page-data.js` equals the snapshots; every snapshot's sha256 matches its sidecar at `34935cb`; all 27 quoted lines are verbatim at their line numbers in `git show 34935cb:<file>` (skips without the checkout).
- **Inputs.** Each value read from the snapshots, the prose numbers parsed exactly, and the ladder parser finds exactly the canon's rung keys.
- **External pins.** erf/erfc against CPython. The all-PBO limit, through the hybrid kernel in all three rules and both layouts, reproduces all five mass-ratio rungs and their tonnages in `rev_a.json` within 5 × 10⁻⁴ (the tolerance of Skyhook's own ladder test, `tests/test_rev_a_physics.py:180-185`). Skyhook's `skyhook_physics.py` (the snapshot, run with `python3 -I -B` in a temporary tree) gives V_c and EQ-6 equal to the kernel's single-fibre limits to 10⁻¹² for Zylon and SK99 at 36 points each (v 2.0–3.5, SF 2.5–5, derate 0–30 %), including the proposal's 122.6 and 488.1.
- **Independent integrator.** RK4 on the tension ODE with the rules written as area = max of what each constraint needs, 48 configurations (two tiers, both ends, three rules, four settings including a custom fibre and tip mass), within 10⁻⁶ of the closed form (measured 5.6 × 10⁻⁹).
- **Closed forms and limits.** Tension continuous at every boundary to 10⁻¹², load × area equal on both sides, area step = σ_P/σ_H; the marginal-cost formula against finite differences (10⁻⁶) and increasing outward; the between-catch crossing u* and the hub fraction f(1 − e^{−X²}); between with β = 1 equals every; a cap at or above f_s equals the canon rule; the between rule rises with β and stays between the other two.
- **Shape.** With a cap on every load the mass falls at every 5 km of PBO added, at both ends; under the canon rule it is flat within 1 %; a weaker custom HMPE is not flat (so flatness is the V_c coincidence, not the model). Which end: the cap on every load favours the tip end and the cap between catches the hub end, at six lengths and two tiers.
- **Item 10.** The canon rungs tick; SF 5 gives 484.06 / 1,104.53 / 3,515.24 (idea 15's published values) at f = 20 / 17 / 14 %; SF 3.5 at 30 % is the same tether as SF 5 at 0 %; 800× ⇔ f = 0.1807; the 28–40 % range reproduces; all-SK99 between catches is 212.21×.
- **Refusals.** No canon (four shapes), no PBO density, no SK99 row, a reworded SK99 row, no SK99 strength, no layout line, no cap line (canon rule still computes, capped rules refuse), five bad custom fibres, nine bad controls, and an overflow (`out_of_envelope`); each with a code and what would help, none with a substituted number.
- **No literals; README.** `model.js`, `app.js` and `index.html` (comments stripped) contain no number from `rev_a.json`'s materials, mass-ratio, geometry or kinematics sections, no 970, and none of the headline results; this README's tagline and table say what the code computes.

**Teeth.** Each sabotage below was applied to a copy of the folder and both suites were run (failing tests of 18, failing checks of 82):

| Sabotage | file | unit tests | ui-check |
|---|---|---|---|
| between-catch regime drops the payload's tip load when it hands tension inward | `model.js` | 3 | 1 |
| switch point t* = (1 − β)/(c/f) instead of (1 − β)/(1 − c/f) | `model.js` | 4 | 3 |
| section mass ignores the tension carried in from outboard | `model.js` | 6 | 10 |
| tension grows with Δu instead of Δ(u²) | `model.js` | 7 | 12 |
| EQ-4 without the 2 | `model.js` | 7 | 19 |
| cap on every load takes the larger fraction | `model.js` | 5 | 4 |
| hub-end layout drops the lower arm's Zylon tip | `model.js` | 4 | 4 |
| erf series denominator off by one | `model.js` | 9 | 22 |
| erfc branch of the section integral swapped | `model.js` | 1 | 0 |
| between-catch crossing uses f/c for c/f | `model.js` | 1 | 1 |
| working load ignores the derate (40 % for 28 %) | `model.js` | 6 | 15 |
| missing SK99 density falls back to a typed 970 | `model.js` | 2 | 3 |
| missing cap line falls back to 0.20 | `model.js` | 1 | 4 |
| between-catch load 5 % high | `model.js` | 2 | 0 |
| page's all-PBO tile computes the baseline | `app.js` | 0 | 1 |
| strip marks every HMPE piece end | `app.js` | 0 | 1 |
| refused state leaves the previous tiles on screen | `app.js` | 0 | 1 |
| withheld data leaves the controls live | `app.js` | 0 | 2 |

Every sabotage is caught by at least one suite. The weakest are the swapped erfc branch (only the direct `gauss()` check sees it: at these speeds a section rarely starts beyond X·u₀ = 2.25, so the branch barely runs) and the page-only sabotages, which only the browser checks see.

`ui-check.mjs`, 82 checks: at 1280 px, light, from `file://`: the tiles against `model.js` and against `rev_a.json`'s ladder (121.83×, 40.32× via the 0 % derate button, 295.27× and 3,085.95× at the other tiers, all PBO), the sentence, the three rules (122.56×, 454.78×, 212.11×), arrow keys on the rule radios with focus following, β = 100 % equal to the cap on every load, End on the slider, the hub end at 100 km (170.46×), the which-end note and its ten bold cells, the item 10 table and findings, a mouse drag on the chart and its tooltip, the strip's two rows and their ▲ marks (two between catches under the canon rule, none with a payload aboard, none under a cap on every load), the custom fibre refusing with one value and computing with two. At 390 px, dark, touch: no sideways scroll (default, custom refusal, 3.5 km/s, every section open), both tables fitting without their own scroll, a dark page plane, a tap on the chart. Over HTTP with `page-data.js` withheld: the notice, every control disabled, no ratio anywhere; with the SK99 line removed: the refusal, the PBO column still computing, a typed fibre computing; with the cap line removed: the canon rule computing, capped rules refusing until a cap is set; with σ tampered: all three canon rungs crossed.

`node tools/check.mjs ideas/20-twenty-percent-line` passes: README format, size, sidecars, both suites, and the smoke test at 1280 px and 390 px.

## Honest assessment

What works:

- **[Certain]** The kernel is closed-form, agrees with an independent ODE integration to 5.6 × 10⁻⁹, reduces to Skyhook's own EQ-6 implementation to 10⁻¹² in the single-fibre limits, and reproduces every mass-ratio rung in `rev_a.json`.
- **[Certain]** Under the canon's sizing rule every HMPE metre is at 28 % of break while a payload rides, and between catches 489 km of the baseline's 620 km of HMPE is still above 20 %, up to 26.6 % at the hub. Item 10's "28–40 %" is the payload-aboard figure.
- **[Certain]** Holding HMPE to 20 % under every load costs the baseline 454.78×, +1,661 t at 5,000 kg; adding PBO at the tip end recovers it fastest (244.41× with 100 km per arm, against 355.17× at the hub end).
- **[Certain as computation, Speculative as engineering]** If the 20 % applies only between catches, the baseline is 212.11×, and PBO at the hub end recovers it fastest (170.46× with 100 km). Whether creep allows that reading depends on how HMPE creeps under a steady load with brief periodic excursions to a higher one (6.7 min per catch at 28 % instead of ≤ 20 %). Nothing in the repo answers that: ST-002 as proposed hangs two coupons at constant loads, ~20 % and ~40 % of break (`mp001_market_pricing.md:48`, `DECISION_LOG.md:76`), and TP-001's creep series has no protocol in the checkout.
- **[Certain]** Every number on the page is read from a snapshot or computed from one; the tests fail if a canon number is typed into the page or model.

What is rough:

- **[Certain]** The SK99 density (970 kg/m³) is not canon. It moves the HMPE numbers only through V_c; the conclusions about the cap do not depend on it, but every HMPE-dependent figure is flagged.
- **[Certain]** Which HMPE the baseline uses is not settled in the repo: `rev_a.json` names "Spectra/UHMWPE core" and gives a strength only for Dyneema SK99, and the creep guidance is for SK78. The page applies the SK78 guidance to SK99, as item 10 implicitly does.
- **[Certain]** Free-space centrifugal load only, the EQ-6 approximation: no gravity gradient (`tether_dynamics.py:353` puts its tension modulation at ~4 %), no catch transient, no joints, the same spin rate with and without the payload, and no tip-vehicle mass unless you set one. β = 0 is a lower bound on the between-catch load, matching how `tether_dynamics.py` models the tether between catches (`:81`, `:357`), not an estimate of real tip hardware.
- **[Certain]** PBO gets no cap: the repo gives none (MP-001 calls its creep 3–5× lower than HMPE's). Zylon's UV/AO degradation (`project_instructions.md:112`) is not modelled.
- **[Certain]** Nothing is priced. In mass, PBO always wins once HMPE is capped; whatever made HMPE the bulk fibre (price, availability, handling) is outside the page, and `fiber_cost_per_kg` is null.
- **[Likely]** Only two layouts. A three-section arm with PBO at both ends, or a stepped (5–20 km segment) taper as §4.1 allows, would do at least as well under *cap between catches*; the slider explores one family.
- **[Likely]** The strip's colour scale saturates ten points above the cap, a display choice; the readout and the strip's summary line carry the exact figures.

**Findings about the source repo** (Skyhook at `34935cb`; reported, not fixed):

1. **`docs/DECISION_LOG.md:72`** (same text in `docs/research/mp001_market_pricing.md:46` and `docs/program_manifest.md:65`): "Reaching 20% sustained load would require SF ≈ 5 … from ~41× to order ~800×". SF 5 reaches 20 % only if the derate is not applied in sizing; with the canon's 30 % derate it is SF 3.5, and SF 5 means 14 %. Either way the 20 % tether is 484.06× (Zylon) or 488.14× (SK99), 12.0 times the 40.32× rung, not ~20; ~800× corresponds to 18.07 % of break. (484.06× was first reported by idea 15; the f framing, SF 3.5 and the 18.07 % are new here.) [Certain]
2. **`docs/DECISION_LOG.md:70`**: "a steady centrifugal load of 28–40% of rated break … The centrifugal load is genuinely sustained in the rotating frame". The 28 % is the load with a payload aboard, which is half a rotation per catch. The genuinely sustained part is the arm's own weight: about 95 % of the hub tension (1 − 1/20.23 for an SK99 arm at 28 %; 1 − 1/20.12 for the canon's all-Zylon one) but zero at the tip. Between catches, at the canon rule, the HMPE hub carries 26.6 % and the outer 24 % of an all-HMPE arm is below 20 %. The item's conclusion that SF 2.5 HMPE is in the bad regime still holds near the hub. [Certain arithmetic; the creep consequence is Speculative]
3. **`docs/DECISION_LOG.md:74`, outcome (b), "hybrid material boundary shifted toward PBO for the high-stress fraction"**: under the canon's uniform-stress taper every metre of a fibre runs at the same fraction, so there is no high-stress fraction with a payload aboard. One exists only between catches, and it is at the hub, the opposite end from the baseline's Zylon tip (`docs/project_instructions.md:108`). Under item 10's own reading (cap on every load) the PBO belongs at the tip end; under the between-catch reading at the hub end. The log does not say which load the guidance applies to, and the two readings point opposite ways. [Certain]
4. **`params/rev_a.json` carries neither an SK99 density nor the hybrid layout.** `materials.alternative_fibers` has `Dyneema_SK99_GPa` only (also idea 15's finding); `materials.construction_baseline` says "Spectra/UHMWPE core + Zylon outer arm" with no length, while the founding document (`project_instructions.md:108`) says HMPE bulk with the outer ~20 km of the *lower* arm in Zylon. The canon's ladder (121.83× etc.) is an all-Zylon tether, while the baseline is 97 % HMPE by length; at equal load fraction that costs only +0.6 % (122.56×), so the ladder is a fair proxy until the HMPE is capped. [Certain]
5. **The fibre named for the bulk, the fibre with a canon strength and the fibre the creep guidance is for are three different grades**: Spectra (`rev_a.json:69`), Dyneema SK99 (`rev_a.json:71`), SK78 (`DECISION_LOG.md:70`). [Certain]

**Gates this has not been through.** Skyhook's Rule 1 canon review (it reads a snapshot, and uses a non-canon density and a founding-document layout, both flagged); a verification-memo entry for the piecewise derivation and the between-catch rule (nothing here is in VM-001); the pytest suite (`tests/`, not installed in this sandbox; the oracle test runs the physics module directly instead). No creep data of any kind. It is an idea-bank prototype.

## Where it would land

**Skyhook, `physics/hybrid_taper.py`** (the kernel ported to Python beside `tether_dynamics.py`, importing `params/rev_a.json` through `skyhook_physics.PARAMS`) with **`tests/test_hybrid_taper.py`** (the single-fibre limits against `integrated_mass_ratio`, the ODE cross-check, continuity, the marginal-cost and which-end tests), and the page as **`tools/sims/skyhook_twenty_percent_line.html`**, reading the canon with the twin's `loadRevA()` (`tools/twin/params-loader.js:49`) instead of `page-data.js`. To ship there for real:

- Add to `rev_a.json` what the page has to read from prose: a keyed SK99 (or baseline HMPE) density, the baseline's HMPE grade, and the hybrid layout (`zylon_outer_lower_arm_km`), so nothing comes from the founding document.
- Decide, as an engineering position in DECISION_LOG item 10, which load the creep guidance applies to (payload aboard, or between catches), and scope ST-002 and the TP-001 creep series to test it: a hold at the between-catch load with periodic excursions to the payload-aboard load.
- Put the recomputed figures (484.06× at 20 %, SF 3.5 at the canon derate, 800× ⇔ 18.07 %, the 26.6 % hub load between catches, the which-end result) in item 10's evidence list, and correct the "~41× to order ~800×" sentence in the log, MP-001 §3c and the manifest.
- Pass a VM review of the piecewise derivation and the between-catch sizing rule; run the ported tests under pytest.
