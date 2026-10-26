# Taper Is Not Mass
> Skyhook's peak-area taper (EQ-5) and two-arm mass ratio (EQ-6) are functions of one number, x = (v/V_c)·√(SF/(1−derate)), and differ by exactly 2√π·x·erf(x): 6.05 at the Rev A reference (taper 20.12 at 30 % derate, tether 121.83× the payload), and below x = 0.5224 the taper is the larger. The page draws both across tip speed, re-derives all 14 mass-ratio and fibre-mass values in `rev_a.json` from σ and ρ on every load, and re-derives the program's quoted history: the old 440× is EQ-6 at 0 % derate (440.3996), and DECISION_LOG item 10's ~800× at SF 5 comes out at 484.06×.

**Kind:** explorable
**For:** Skyhook
**Run:** open `ideas/15-taper-is-not-mass/index.html` in a browser (classic scripts, works from `file://`; no build, no network). Tests, from the bank root: `node --test ideas/15-taper-is-not-mass/taper.test.mjs` (18 tests, Node built-ins; two of them also call `python3` as an oracle and skip that part without it; about 1 s) and `node ideas/15-taper-is-not-mass/ui-check.mjs` (74 checks in headless Chromium through the globally installed Playwright; about 5 s; `check.mjs` runs it for `tools/check.mjs`). `node ideas/15-taper-is-not-mass/build-data.mjs` regenerates `snapshots/rev_a.data.js` from `snapshots/rev_a.json`.
**Made by:** Hawser

## What it is

One page about one sentence the Skyhook program spent a night purging: the taper ratio is not the mass ratio.

- **Four controls.** Fibre (the canon's primary fibre, its two alternative fibres, or a custom fibre marked *not canon*), tip speed 0.5–4 km/s, strength derate 0–50 %, safety factor 1–5. Buttons set the controls to each rung of the `rev_a.json` ladder, to the historical 440× point and to the SF 5 case of DECISION_LOG item 10.
- **A readout** that says it in words: "At 2.50 km/s, 30 % derate and SF 2.5 for Zylon PBO, the centre of the tether is 20.12× as thick as its tip, and the tether weighs 121.83× the payload: 6.05 times what reading the taper as a mass ratio would say." Below the crossover the sentence turns round and says the taper *overstates* the mass. Tiles give x, the taper (and the taper with no derate, which is what `physics/skyhook_physics.py taper_ratio()` returns), the mass ratio, mass ÷ taper, v_tip/V_c against the file's 1.3 guardrail, and the fibre mass in tonnes at the file's 5,000 kg payload.
- **Both curves across tip speed**, on one log axis: EQ-6 (blue) and EQ-5 (orange) at the current derate, SF and fibre. The three canon tiers (2.5, 2.8, 3.5 km/s) are pinned; the region above v_tip/V_c = 1.3 is shaded; the point where the curves cross is marked. Green rings are the five mass-ratio rungs of `rev_a.json`, drawn at the values *in the file*; a ring is green only if this page's own EQ-6 lands within 5 × 10⁻⁴ of it, red otherwise. Grey diamonds are two figures from the program's history: 440× (EQ-6 at 3.5 km/s, 0 % derate) on the mass curve and "~360× per arm" (EQ-5 at 3.5 km/s, 30 %) on the taper curve. Drag across the plot to move the tip speed; hover for a readout; tap or press Enter on a ring or diamond to set the controls to it.
- **Height, not area.** The cross-section along the tether, tip to centre to tip, as a multiple of the tip's. The taper is the height of the peak; the mass is the area. A dashed line marks the mean height, and a line underneath does the arithmetic: M/m = 2 arms × 2x² × mean height.
- **The ladder in rev_a.json, re-derived.** Every mass-ratio and fibre-mass value in the file (10 in the ladder block, 4 duplicates under the tier options), each with where its inputs came from, the recomputed value, the relative error and a tick; plus the three rounded values (V_c, specific strength, v_tip/V_c) checked at the precision they are written to.
- **Numbers the program has quoted, re-derived.** Six quotations from `docs/DECISION_LOG.md` and `docs/glossary.md`, verbatim, each recomputed and marked exact, close, or does not reproduce.

If `snapshots/rev_a.data.js` does not load, the page says *No canon file, no numbers*, disables the controls and shows only the equations. A fibre whose density the canon does not give is refused, with what would help, not guessed.

## Why I made it

The proposal (No. 15 in the judged list) points at four places in Skyhook, and I checked each at `34935cb` before building:

- `docs/DECISION_LOG.md:8-20`, items 1 and 2: the unsourced 440× and the EQ-5-as-mass-ratio conflation. Both are there as cited; the item 1 addendum (`:12`) prints `integrated_mass_ratio(3.5, Vc=2.7269, SF=2.5, derate=0.0)` = 440.3996×.
- `docs/DEVIATIONS.md:14`, item 8: `tools/sims/skyhook_program_site.html:1135` carries `LAD={Conservative:{d:.6,…},Baseline:{d:.72,…},Optimistic:{d:.85,…}}`, open. Confirmed verbatim.
- `tools/sims/skyhook_calculator.jsx:11` (`"Dyneema SK99": { sigma: 3.9e9, rho: 970 }`) and `:20-22` (the same 0.6/0.72/0.85 ladder). Confirmed.
- `docs/glossary.md:48`, the "Taper ratio" entry: taper ≈ 8.2, ≈ 20.1 with 30 % derate, "This is not tether mass ratio". Confirmed.

So the conflation is resolved in the canon and the physics module, but the program's interactive tools still show taper and mass as two point values side by side, with a ladder that is not the canon's, and nothing in the repo shows *why* the two numbers differ or by how much. What I weighed:

- **A corrected copy of the program site's calculator** (canon ladder, canon materials). It would close DEVIATIONS item 8, but it is mostly re-skinning an existing tool, and it still shows two numbers at one point, which is the presentation that allowed the conflation in the first place.
- **A lint for the conflation.** A sibling deposit in this bank, 04 *Rule One*, already scans the repo for canon drift (it reports the SK99 and ladder drifts), so a second scanner would duplicate it.
- **A reconciliation table only.** `verify_rev_a()` (`physics/skyhook_physics.py:260`) already checks one rung at 2 %, and the test suite checks five at 5 × 10⁻⁴ (`tests/test_rev_a_physics.py:171-185`).
- **This: both quantities as curves of one variable, with the canon checked on the page.** It won because, once both are written in terms of x, the difference between them is not a fudge factor but a closed form, 2√π·x·erf(x), that you can see open up as you drag, and that also says where they are equal. The badges make Rule 1 something the page checks on every load instead of a number someone typed, and the history panel turned up two things worth reporting (the item 10 figure, and the one-arm label in the program site).

## What I changed from the proposal

- **"EQ-6 > EQ-5 for every grid point in the slider ranges" is false, so it is not a test; its opposite is.** Mass ÷ taper = 2√π·x·erf(x) equals 1 at x = 0.5224 and is below 1 under it. The slider ranges reach x = 0.18 (0.5 km/s, SF 1, no derate, Zylon), where the mass ratio is 0.138 and the taper 1.034. The page marks the crossing and says so; a test pins it.
- **"Vc(3.6 GPa, 970) = 2.72" is not computable from the canon.** `rev_a.json` gives Dyneema SK99 a strength (`materials.alternative_fibers.Dyneema_SK99_GPa`, 3.6) and no density anywhere; 970 kg/m³ is in the founding document's material survey (`docs/project_instructions.md:67`), which is not the canon file. The page refuses SK99 with what would help, and the custom fibre lets a reader type 970 (it then draws dashed and marked not canon; V_c comes out 2.7245 km/s, within 0.1 % of Zylon's 2.7269).
- **T1100G's density** (1,790 kg/m³) exists in `rev_a.json` only inside the prose note `_t1100g_note` ("Verified per VM-001; density 1790 kg/m3", `params/rev_a.json:74`). The page reads it from there with a strict pattern, says it did, and would refuse T1100G if the note changed shape.
- **The "2 % guardrail" is not in `rev_a.json`.** The 2 % is `verify_rev_a()`'s tolerance and the test suite's `TOL` (`tests/test_rev_a_physics.py:33`), not a design limit, so the page does not draw it. The 1.3 guardrail is drawn, read from `mass_ratio._ratio_note`, applied to v_tip/V_c as that note does.
- **erf is not Abramowitz & Stegun 7.1.26.** The page uses the all-positive-term series (A&S 7.1.6), which agrees with CPython's `math.erf` to 2 × 10⁻¹⁵ on [0, 6] (tested), so the badges do not depend on a 1.5 × 10⁻⁷ approximation. The tests still check that 7.1.26, which Skyhook's sims and twin use, is within its stated 1.5 × 10⁻⁷.
- **The derated taper is defined explicitly.** `taper_ratio()` in the physics module takes no derate; the glossary's 20.1 applies the derate inside the exponent exactly as EQ-6 does. The page plots EQ-5 at the same x as EQ-6 (which is what makes the identity exact) and shows the no-derate value beside it.
- **Added beyond the proposal:** the profile chart, the factor decomposition M/m = 2 × 2x² × mean height, the "numbers the program has quoted" panel (which is where the item 10 finding came from), the oracle test against Skyhook's own `skyhook_physics.py`, and a test that runs the program site's calculator lines verbatim.

## How it works

**The equations [Certain].** From `params/rev_a.json` the page takes σ and ρ and computes V_c = √(2σ/ρ) (EQ-4). Then x = (v_tip/V_c)·√(SF/(1 − derate)), the argument of EQ-6 in `rev_a.json`'s own `mass_ratio.integrated_tether_to_payload_both_arms.equation`. EQ-5 at the same strength is taper = exp(x²); EQ-6 is M/m = 2√π·x·exp(x²)·erf(x). Dividing, **M/m ÷ taper = 2√π·x·erf(x)**, a function of x alone. It is increasing, ≈ 4x² for small x and → 2√π·x for large x, and equals 1 at x\* = 0.5224 (bisection; a test checks 2√π·x\*·erf(x\*) = 1 to 10⁻¹²). For Zylon at SF 2.5 the crossing is at 0.90 km/s with no derate and 0.75 km/s at 30 %.

**Why they differ [Certain as algebra; Likely as the physics of the canon's formula].** Both come from one arm built at constant working stress σ_w = σ(1 − derate)/SF. Spinning at tip speed v, its cross-section grows from the tip inward as A(u)/A_tip = exp(x²(1 − u²)), u = r/L, with x² = ρv²/(2σ_w). The peak (u = 0) is exp(x²): that is EQ-5. The tip area holds the payload, σ_w·A_tip = m·v²/L, so an arm of length L with the tip's area all the way in would weigh 2x² times the payload. The real arm weighs 2x² × (mean of A/A_tip) = 2x² × exp(x²)·√π·erf(x)/(2x) = √π·x·exp(x²)·erf(x), and two arms make EQ-6. So **M/m = 2 arms × 2x² × mean height, taper = peak height**, and the ratio of the two is 2 × 2x² × (mean ÷ peak). This is my own derivation of the form the repo cites as Moravec/Forward; it is the standard constant-stress taper and ignores gravity gradient and the orbit, as the canon's formula does. A test integrates the profile numerically (Simpson, 4,000 intervals, no erf) and gets EQ-6 to 10⁻¹⁰ for x from 0.05 to 3.1.

At the canon's settings (computed by the page; Zylon, SF 2.5):

| | x | taper (EQ-5) | M/m (EQ-6) | mass ÷ taper | mean ÷ peak |
|---|---|---|---|---|---|
| 2.5 km/s, 0 % | 1.4496 | 8.18 | 40.32 | 4.93 | 0.587 |
| 2.5 km/s, 15 % | 1.5723 | 11.85 | 64.30 | 5.43 | 0.549 |
| 2.5 km/s, 30 % (Rev A) | 1.7326 | 20.12 | 121.83 | 6.05 | 0.504 |
| 2.8 km/s, 30 % | | 43.19 | 295.27 | 6.84 | |
| 3.5 km/s, 30 % | | 359.11 | 3,085.95 | 8.59 | |

**Reading the canon [Certain].** `snapshots/rev_a.json` is a whole-file copy of `params/rev_a.json` at `34935cb` (sidecar: blob `7b64e55`, sha256 `d0828c1e…`); `build-data.mjs` wraps it as `snapshots/rev_a.data.js` so the page can read it from `file://`, and a test checks the two are deep-equal. The page and model hold no tether number of their own: a test scans `index.html`, `app.js` and `model.js` (outside the block of quoted history claims) for every non-trivial number in the file's `materials` and `mass_ratio` sections and the three tier speeds, and fails if one appears. What is read, and from where:

- Primary fibre: `materials.primary_fiber`, `tensile_strength_GPa` (5.8), `density_kgm3` (1,560).
- Alternative fibres: each `materials.alternative_fibers.<name>_GPa`. A density comes from a keyed `<name>_density_kgm3` if one exists (none does), else from a matching `_<token>_note` containing "density N kg/m3" (only T1100G's does), else the fibre is refused.
- Tier pins: `kinematics.v_tip_kms`, `kinematics.cislunar_revenue_gated_option.v_tip_kms`, `kinematics.phase3_growth_option.v_tip_kms`.
- Ladder: every key of `mass_ratio.integrated_tether_to_payload_both_arms` of the form `<rung>[_<a>p<b>kms]_<n>pct_derate`. The derate comes from `<n>pct` (the file has no numeric field for 0 % or 15 %; 30 % is also `materials.derate_fraction`, and the page says when they agree), the tip speed from `<a>p<b>kms` or else `reference_v_tip_kms`, SF from the block's `SF`. The paired `_fiber_mass_t` keys are checked as M/m × `payload_mass_kg_for_tonnage` ÷ 1000, and the four duplicates under the tier options against the same inputs. A test fails if the parser misses or invents a key.
- Guardrail: the number before "x mass-growth guardrail" in `mass_ratio._ratio_note` (1.3), applied as v_tip/V_c.

**The badges [Certain].** A ladder value reproduces when |computed − file| / file ≤ 5 × 10⁻⁴, the tolerance of Skyhook's own ladder test (`tests/test_rev_a_physics.py:180-185`). At `34935cb` all 14 do, the worst at 7.1 × 10⁻⁵ (`baseline_15pct_derate`, because the file rounds 64.3046 to 64.3). V_c is always computed from σ and ρ, never read from `materials.V_c_kms`: that value is 2.73, a three-figure rounding of 2.7269, and using it misses every rung by 0.61–1.45 % (inside the repo's 2 % `TOL`, outside its 5 × 10⁻⁴). The rounded values themselves are checked at the precision they are written to: 2.7269 → 2.73, 3.718 → 3.72 MJ/kg, 0.9168 → 0.92.

**History [Certain for the arithmetic].** Each quotation is copied verbatim from `snapshots/DECISION_LOG.md` or `snapshots/glossary.md` (a test checks the text at the cited line). A claim's own inputs (its tip speed, its SF, its "440×") are the claim's; strength, density, the canon SF and the 30 % derate come from the canon. A quoted figure is *exact* if the computation rounds to it at the number of significant figures it was written with, *close* within 5 %, otherwise *does not reproduce*:

| Quote | Computed | Verdict |
|---|---|---|
| `DECISION_LOG.md:10` "EQ-5 at SF 2.5 with 30% derate gave ~360× per arm at the then-reference 3.5 km/s" | EQ-5 = 359.11 | exact |
| `DECISION_LOG.md:10` "440× would require a 23.64% derate (or SF 3.274 at zero derate)" | 23.64 % and 3.274, solving **2 arms × EQ-5** = 440 | exact (one arm gives 32.34 % and 3.695) |
| `DECISION_LOG.md:12` "… = **440.3996× ≈ 440.40×**" | EQ-6 at 3.5 km/s, 0 % = 440.3996 | exact |
| `DECISION_LOG.md:20` "peak area taper is ~8.2 (no derate)" | 8.18 | exact |
| `glossary.md:48` "peak area taper ~= 8.2; with 30% strength derate it is ~=20.1" | 8.18, 20.12 | exact |
| `DECISION_LOG.md:72` "… from ~41× to order ~800× under the Moravec form" | 40.32 at SF 2.5; at SF 5: **484.06** (0 %), **1,104.53** (15 %), **3,515.24** (30 %) | ~41 close; ~800 does not reproduce |

The second row is the one I found most telling: the 2 July audit's two numbers come out to four figures only if "mass" meant two arms × the area taper, so the audit that found no source for 440× was testing it against the conflated model. The log's own addendum (`:12`) already says the audit "only ever checked it against the wrong formula"; this reproduces the numbers that show it.

**erf [Certain].** erf(x) = (2/√π)·e^{−x²}·Σ 2ⁿx^{2n+1}/(1·3·…·(2n+1)) (A&S 7.1.6), all terms positive, summed until a term is below 10⁻¹⁷ of the total; 1 beyond x = 6. It matches CPython's `math.erf` to 2 × 10⁻¹⁵ on a 0.05 grid over [0, 6].

**The page.** `model.js` is pure (no DOM, no clock) and loads as a classic script or with `require()`. `app.js` draws inline SVG sized to its container, so text stays at 11 px on a phone. The chart's markers sit at their own settings, not the sliders', and a press picks the nearest marker within 14 px (at 2.5 km/s on a phone, three rings are 7–10 px apart). Light and dark schemes follow `prefers-color-scheme`; the two series colours (#2a78d6/#eb6834 light, #3987e5/#d95926 dark) pass a colour-vision check at ΔE 24.7 (protan) light and 26.8 dark, and every series also has a direct label. No storage, no network.

## Tests

`taper.test.mjs`, 18 tests:

- **Snapshots.** `rev_a.data.js` deep-equals `rev_a.json`; all four snapshots match their sidecars' sha256 at `34935cb`.
- **External pins.** erf against CPython's `math.erf` (2 × 10⁻¹⁵); the 14 ladder values against the numbers in `rev_a.json` (5 × 10⁻⁴), with the parser checked against the file's key list; the three rounded values; 440.3996 parsed from `DECISION_LOG.md:12`; 8.2 and 20.1 parsed from `glossary.md:48`, and that the V_c = 2.73 the line states gives 8.1 and 20.0 instead; 23.64 % and 3.274 parsed from `DECISION_LOG.md:10`.
- **Oracle.** Skyhook's own `physics/skyhook_physics.py` (the snapshot, run under `python3 -I -B` in a temporary tree beside the `rev_a.json` snapshot) gives EQ-4, EQ-5 and EQ-6 equal to `model.js` within 10⁻¹² at 72 points (tip speed 0.5–4, SF 1–5, derate 0–50 %), and its own `verify_rev_a()` passes.
- **Closed forms.** The identity M/m ÷ taper = 2√π·x·erf(x); M/m = 2 × 2x² × mean height by Simpson quadrature with no erf; the crossover at 0.5224 with the mass ratio below the taper under it and above it over it; the limits (taper 1 and M/m 0 at x = 0, M/m ≈ 4x², gap → 2√π·x).
- **Refusals.** No canon (four shapes) gives `no_canon` and no ladder; a deleted `density_kgm3` refuses the primary fibre and all 14 rows instead of using a default; a deleted tier speed or guardrail note drops the pin with a note; eight bad inputs each refuse with a code and what would help, including x² > 709 as `out_of_envelope`; SK99 refused for want of a density; T1100G's density read from its note; a keyed density preferred to a note.
- **Tamper.** σ 5.7 GPa turns all 14 rows to *differs*; editing one value (121.83 → 121.9) flags only that row.
- **History** verdicts as in the table above, with every quote verbatim at its line.
- **The program site.** The three lines of `skyhook_program_site.html` (`:1135`, `:1158`, `:1159`) are quoted in the test, checked verbatim against the Skyhook checkout when it is present, and run as-is in a `vm` sandbox: the Conservative/Baseline/Optimistic rows give 109×/55×/32× one-arm and 1,092/552/322 t, equal to one-arm EQ-6 at 40/28/15 % derate.
- **No literals; README.** The page and model contain no canon number of their own; this README states x\*, the 6.05, the 20.12 and the item 10 values the code computes.

**Teeth.** Each sabotage below was applied to a copy of the folder and both suites run (counts are failing tests out of 18, and failing checks out of 74):

| Sabotage in `model.js` | unit tests | ui-check |
|---|---|---|
| EQ-6 with one arm (the program site's error) | 10 | 14 |
| x = (v/V_c)·√(SF·(1 − derate)) | 11 | 12 |
| EQ-4 without the 2 | 11 | 15 |
| erf series denominator off by one | 12 | 16 |
| EQ-5 as exp(x) | 7 | 4, and the desktop pass stops early |
| badge tolerance 5 × 10⁻² | 1 | 3 |
| ladder ignores the tip speed in the key name | 3 | 5 |
| derate read as `<n>pct` ÷ 10 | 4 | 7, and the desktop pass stops early |
| gap with π for √π | 4 | 2 |
| no density from notes | 1 | 2 |
| "close" widened to 50 % | 1 | 1 |
| missing density falls back to a typed 1,560 | 2 | 3 |

Several of the unit-test counts include the README test, which recomputes the README's numbers with the (sabotaged) model. The weakest rows are the tolerance and verdict rules, each caught by one dedicated test (the tamper test, and the history test's "~800× does not reproduce").

`ui-check.mjs`, 74 checks: at 1280 px, light, from `file://`: the six tiles against `rev_a.json` (121.83×, 609.1 t, and the computed taper, x, gap and v/V_c), the canon count, 14 + 3 ledger rows, the history verdicts, five green rings and two diamonds, the guardrail label, the crossover drawn at v\* = 0.754 km/s from the closed form; the snap buttons (3,085.95×, 295.27×, 440.40×, 484.06×); ArrowRight on the slider; Enter on a ring, with focus kept; hover tooltip; a mouse drag to 1.0 km/s; the sentence flipping below x\*; SK99 refused with no number on the page; T1100G's note; custom fibre refused until typed, then dashed and marked; the extreme corner (4 km/s, 50 %, SF 5) shown in scientific form. At 390 px, dark, touch: no sideways scroll (also with the custom and SK99 states), a dark page plane, a touch drag, a tap on the crowded baseline ring. Over HTTP with the canon withheld: the notice, no digits anywhere in tiles, ledger or history, controls disabled; with σ tampered: 0 of 14, all rows differ, five red rings; with the density deleted: the fibre and all 14 rows refused.

`node tools/check.mjs ideas/15-taper-is-not-mass` passes: README format, size, snapshot sidecars, both suites, and the smoke test at 1280 px and 390 px.

## Honest assessment

What works:

- **[Certain]** Every number on the page is read from the `rev_a.json` snapshot or computed from it; the tests fail if a canon number is typed into the page or model, and the page refuses (and says what would help) when the file, a key or a density is missing.
- **[Certain]** All 14 mass-ratio and fibre-mass values in `rev_a.json` at `34935cb` re-derive from σ and ρ within 5 × 10⁻⁴, and Skyhook's own `skyhook_physics.py` agrees with `model.js` to 10⁻¹² over the whole slider range.
- **[Certain]** M/m ÷ taper = 2√π·x·erf(x) exactly, and the curves cross once, at x\* = 0.5224.
- **[Certain]** The 440× of DECISION_LOG item 1 is EQ-6 at 3.5 km/s and 0 % derate (440.3996), and the audit's 23.64 % and SF 3.274 are the two-arms-of-EQ-5 reading.
- **[Likely]** Seeing the two curves move apart as the derate goes up teaches the distinction faster than the glossary sentence does. Nobody from the program has used the page.

What is rough:

- **[Certain]** It is a single-material, constant-stress model, the canon's. The construction baseline in `rev_a.json` is a Spectra/UHMWPE core with a Zylon outer arm (`materials.construction_baseline`); the page, like the ladder, treats the whole tether as Zylon. Gravity gradient, the orbit and the tip mass hardware are outside EQ-6.
- **[Certain]** T1100G's density is parsed out of a prose note. It is in the canon file, but a reworded note silently becomes a refusal.
- **[Certain]** The derates of the ladder are parsed from key names. A renamed key would drop or change a rung; the tests would catch it only for this snapshot.
- **[Likely]** The history verdict rule (significant figures, 5 % for "close") is my choice. "~41×" against 40.32 is called *close*, which is generous to a "~"; "~800×" against 484.06 is 39.5 % off and called *does not reproduce*.
- **[Speculative]** Where "~800×" came from. EQ-6 at SF 5 gives 815.12× at a 10 % derate, which is not a ladder rung; I cannot tell whether that, or something else, was meant.
- **[Certain]** The ledger is long on a phone (17 rows). It is grouped by parent key and compact, but it is a lot of scrolling.
- The derivation is mine; I know Moravec (1977) and the Moravec/Forward attribution from the repo and from secondary sources, not from the papers. The erf series is A&S 7.1.6 as I remember the numbering [Likely]; the series itself is checked against CPython.

**Findings about the source repo** (Skyhook at `34935cb`; reported, not fixed):

1. **`docs/DECISION_LOG.md:72` (item 10): "drives the 2.5 km/s reference mass ratio from ~41× to order ~800× under the Moravec form."** EQ-6 at SF 5 gives 484.06× at 0 % derate, the like-for-like rung for ~41× (which is itself 40.32×); 1,104.53× at 15 %; 3,515.24× at 30 %. No ladder rung gives ~800×. At the conservative rung the SF 5 tether is 28.9× the SF 2.5 one (3,515.24 / 121.83), not ~20×. The item's conclusion ("a refutation of the design") only gets stronger. [Certain] (This bank's own `BRIEFING.md` repeats "~41× to ~800×" in its Skyhook docs paragraph.)
2. **`tools/sims/skyhook_program_site.html:1089` and `tools/sims/skyhook_calculator.jsx:279`: the row labelled "Tether ÷ payload mass" shows a one-arm ratio** (`mr`, `:1159`; `massRatio`, jsx `:112-113`, whose comment says "per arm"), next to a "Total tether mass (2 arms)" row. `rev_a.json`'s ratio is two-arm (`integrated_tether_to_payload_both_arms`). Measured in headless Chromium at the site's defaults (Zylon, 2.5 km/s, SF 2.5, 5,000 kg): Conservative 109× and 1,092 t, Baseline 55× and 552 t, Optimistic 32× and 322 t, against the canon's 121.83× / 609.1 t, 64.30× / 321.5 t and 40.32× / 201.6 t. [Certain]
3. **DEVIATIONS item 8, quantified.** The site's `d` = 0.6 / 0.72 / 0.85 (`:1135`; the same ladder in `skyhook_calculator.jsx:20-22`) are derates of 40 / 28 / 15 %. Its Conservative tonnage (1,092 t) is 1.79× the canon's 609.1 t, and its "Optimistic" rung is the canon's *baseline* derate (322 t against 321.5 t). [Certain]
4. **`tools/sims/skyhook_program_site.html:1179` flags the "working ratio" x as bad above 1.35.** The canon's guardrail is on v_tip/V_c ≤ 1.3 (`params/rev_a.json:98`, `mass_ratio._ratio_note`; `docs/project_instructions.md:74`), a different quantity. x at the Rev A reference is 1.733, so the site marks its own reference design red in all three modes (x = 1.871 / 1.708 / 1.572, measured). [Certain]
5. **`docs/verification_memo.md:14` and `:43` record SK99 as corrected to 3.6 GPa "in the site, calculator, and instructions".** The site (`skyhook_program_site.html:1134`) and the instructions (`docs/project_instructions.md:67`) are; `tools/sims/skyhook_calculator.jsx:11` still has `sigma: 3.9e9`. (The 3.9 itself is known; that VM-001 records it as done is the addition.) [Certain]
6. **`params/rev_a.json` cannot feed EQ-4 for its own alternative fibres.** `Dyneema_SK99_GPa` (`:71`) has no density anywhere in the file; T1100G's density is only in the prose of `_t1100g_note` (`:74`). The ladder's 0 % and 15 % derates exist only in key names (`:85`, `:87`) and in the `_derate_note` prose (`:68`). [Certain]
7. **The rounded V_c in prose.** `docs/glossary.md:48`, `docs/DECISION_LOG.md:20` and the `taper_ratio()` docstring (`physics/skyhook_physics.py:214`, "exp[(2.5/2.73)^2 * 2.5] ~= 8.2") state V_c = 2.73; that expression evaluates to 8.14 (8.1), and with the 30 % derate to 19.99 (20.0). The quoted 8.2 and 20.1 come from V_c = 2.7269 (σ and ρ). Cosmetic, but the same trap as `materials.V_c_kms` (`:64`), which misses the ladder by 0.61–1.45 % if used as an input. [Certain]
8. **Observation, not a defect:** `tests/test_rev_a_physics.py:156-162` (`test_integrated_mass_ratio_exceeds_area_taper`) holds at the reference but is not a general property: below x = 0.5224 EQ-6 is smaller than EQ-5. It also compares EQ-6 at 30 % derate with EQ-5 at none. [Certain]

**Gates this has not been through.** Skyhook's Rule 1 canon review (it reads a snapshot, not the live file); a verification memo (nothing here is in VM-001); the pytest suite (`tests/test_rev_a_physics.py`, not installed in this sandbox; the oracle test runs the physics module directly instead). It is an idea-bank prototype.

## Where it would land

**Skyhook, `tools/sims/skyhook_taper_vs_mass.html`**, a standalone page beside the program site, or the site's "Reference Design Calculator" materials-and-mass block replaced by its two charts. To ship there for real:

- Read `../../params/rev_a.json` live with the twin's loader, `loadRevA()` in `tools/twin/params-loader.js` (which fails loudly rather than defaulting, and needs the repo served over HTTP, since `fetch` of a file is blocked from `file://`), instead of `snapshots/rev_a.data.js`; keep the *No canon file, no numbers* state for when it fails, and add the alternative-fibre and ladder keys to its required list.
- Give `rev_a.json` the fields the page has to parse around: keyed densities for the alternative fibres (SK99 has none; T1100G's is in a note), and numeric derates for the ladder rungs, so nothing is read out of key names or prose.
- Keep the custom fibre only behind an explicit deviation label (Rule 1), or drop it.
- Port the reconciliation and identity tests into `tests/test_rev_a_physics.py` (the crossover, the quadrature check and the "rounded V_c misses the ladder" test are the new ones), and run the page past the Rule 1 review and a verification memo entry.
- Separately, and not this page's job: the program site's "Tether ÷ payload mass" label (one arm), its ladder (DEVIATIONS item 8) and its x > 1.35 flag, and the DECISION_LOG item 10 figure.

## Sources

- Skyhook repository at `34935cb`: `params/rev_a.json`, `physics/skyhook_physics.py`, `docs/DECISION_LOG.md`, `docs/glossary.md` (snapshots with sidecars in `snapshots/`); `docs/DEVIATIONS.md`, `docs/verification_memo.md`, `docs/project_instructions.md`, `tests/test_rev_a_physics.py`, `tools/sims/skyhook_program_site.html`, `tools/sims/skyhook_calculator.jsx` (cited by line, read in the checkout).
- H. Moravec, "A Non-Synchronous Orbital Skyhook", *Journal of the Astronautical Sciences* 25(4), 1977: the taper and mass-ratio form, as the repo cites it; I have not read the paper.
- M. Abramowitz and I. Stegun, *Handbook of Mathematical Functions* (1964), 7.1.6 (the series used) and 7.1.26 (the approximation Skyhook's sims use).
