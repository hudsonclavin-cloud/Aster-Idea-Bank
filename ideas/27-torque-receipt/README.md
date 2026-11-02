# Torque Receipt
> PartForge's own dry-run end cap says "Torque M8 bolts to 25 N·m (grade 8.8 lubricated)". Worked from PartForge's own tables, that is 20,833 N nominal (98 % of proof) and 711.5 MPa at the top of NASA-STD-5020B's ±25 % preload scatter: past yield, proof SF 0.82, before the tank is pressurised. PartForge's bolt_shear check passes the same joint at SF 2.22. The page works the same receipt for any M2–M20 or inch bolt: preload band, stress against proof, yield and UTS, the two-pitch protrusion rule and thread strip. Every line is COMPUTED, never PASS.

**Kind:** tool
**For:** PartForge
**Run:** open `ideas/27-torque-receipt/index.html` in a browser (classic scripts, works from `file://`, no build, no network; `?preset=endcap`, `endcap-dry`, `m6-through`, `by-feel` or `quarter-20` opens a worked example). Command line, from the bank root: `node ideas/27-torque-receipt/torque-receipt.mjs --preset endcap` (`--help` for every option; `--guide` reproduces the table's torque-guide column, `--sweep` runs one torque under every thread condition, `--json` prints the receipt object; exit 0 computed, 2 refused, 3 usage). Tests: `node --test ideas/27-torque-receipt/torque.test.mjs` (17 tests, under 2 s) and `node ideas/27-torque-receipt/ui-check.mjs` (79 checks in headless Chromium; `check.mjs` runs it for `tools/check.mjs`). `node ideas/27-torque-receipt/build-data.mjs [--check]` rebuilds or verifies `snapshots/` from a PartForge checkout.
**Made by:** Clicker

## What it is

A receipt for one bolt. You give it what the assembly instruction gives: a size, a grade, a torque, whether the threads were lubricated, the axial load each bolt carries, and the joint (through with a nut, or into a tapped part). It answers with what that torque actually promises, line by line, each with the table, field and confidence it came from:

- the nominal preload F = T/(K·d), and the band F·(1 ∓ u) that NASA-STD-5020B says a torque-controlled joint scatters over (±25 % lubricated at assembly, ±35 % otherwise), read from PartForge's own `design_factors_nasa.json`;
- the bolt stress at the top of that band, against proof, yield and UTS printed separately;
- the same with the external load added at no joint-stiffness credit (C = 1), labelled as an upper bound;
- the torque window that puts the nominal at the table's 0.65–0.75 × proof target, and the torque cap above which the top of the scatter passes proof. This line needs no torque, so it survives "tightened by feel";
- protrusion past the nut against two thread pitches (the NASA rule PartForge's table says it "does not check yet"), or, for a tapped hole, PartForge's own `threadCheck()` cut verbatim from `index.html`, held to what the screw actually reaches;
- a sweep of the same torque under every thread condition the table gives a nut factor for.

Nothing on it says PASS. PartForge's fastener table says "do not rely on torque alone for a pressure boundary", and the roadmap evaluation's guard for this feature is "Force COMPUTED, never PASS, for torque-derived preload". When an input is missing (no torque, a grade whose strengths the repo does not carry, an inch screw below J429's size floor, a declared value with no source), that line is a structured refusal that names what is missing and what would help, never a stand-in number.

The page opens on PartForge's own dry-run end cap (`tests/dryrun/endcap.scad`) and shows, beside the receipt, what PartForge reports for the same joint today.

## Why I made it

**The open item.** PartForge's roadmap evaluation ranks "Bolt preload & flange separation" as idea 4 and rules "build trimmed (2 d of 9) — tension only: the missing tension primitive is real; separation is the wrong criterion for a radial piston seal" (`docs/roadmap-evaluation.md:79`). Its appendix (`:396-405`) says what to build: "bolt tensile stress at the declared joint load vs ISO 898-1 PROOF, a torque-vs-proof installation check (T = K*F*d), and thread strip at the joint load". It says to drop the joint diagram, to read the proof strengths, nut factors, scatter and target band from `data/tables/fasteners_metric.json` (which already ships them) rather than an inline table, and to force COMPUTED. This is that cheap half, as a tool beside the app rather than a patch to it.

**Citations, checked against PartForge at `0974a62` before I relied on them.** The judged proposal is `queue/proposals/27-torque-receipt.json`.

- `index.html:4733`: the loads whitelist is `hoop|flutter|thread|bolt_shear`, with no tension kind. Held.
- `index.html:5804`: `GRADE_SY` (8.8 → 640, grade 2 → 393, and so on). Held. Test 11 checks that its 8.8, 10.9, 12.9, A2-70 and J429 grade 5 and 8 yields equal the tables this tool reads (grade 2 and A4-80 have no row in those tables).
- `index.html:5502` (`dbHints`) prints "PartForge does NOT check preload, joint separation or joint slip", and so does the doctrine at `:1464`. `dbDesignFactors()` is at `:5154` and already returns `preload_uncertainty` (`:5165`). Held.
- `design_factors_nasa.json` rows `preload_uncertainty_lubricated` (0.25), `preload_uncertainty_as_received` (0.35) and `fastener_protrusion_min` (2 pitches, note "PartForge does not check it yet"), and `reconciliation.withheld` naming NASA TM-106943 as "the source to work from if a preload/separation check is built next". Held. There is no protrusion logic anywhere in `index.html` outside the embedded table.
- `fasteners_metric.json` `design_rules.preload_and_torque`, the `torque_guide_8_8_dry_Nm` column definition and the `grades` block. Held.
- `tests/dryrun/endcap.scad`: `:49` declares the 48,641 N axial pressure load as `bolt_shear`, `:11` says "6 080 N per bolt … SF ≈ 3.0 — PASS", and `:51` carries the torque note. Held. **One judge's note was wrong.** It said the fixture "contains no 'Torque M8 bolts to 25 N·m (lubricated)' note". The note is there, inside the FLIGHT block's `mfg.notes` array on line 51: "Torque M8 bolts to 25 N·m (grade 8.8 lubricated) in star pattern". It is not on a `// NOTE:` line, which is likely why a grep missed it. The test reads it from the fixture by line.
- `tests/templates/bulkhead.scad:11` says its recovery-shock tension was "Declared as bolt_shear per the contract". Held.
- `tests/flight-eng.test.mjs:246`: the M6, 9 mm, 6061 `threadCheck` vector. Held, and reproduced through this tool's tapped path.
- The proposal's test plan asked for the guide-column fraction to land in [0.697, 0.702] for all 12 sizes. The real spread is 0.69729–0.70205, so that band would fail on rounding; the test uses [0.697, 0.703].

**Alternatives weighed.**
- *Add a `bolt_tension` kind to the shipped evaluator.* That is where it belongs (see Where it would land), but this bank does not patch PartForge, and the change touches `partTier()` and the loads evaluator, which need PartForge's own review.
- *The full joint diagram* (bolt and member stiffness, the load factor C, separation). The evaluation drops it, with two skeptics agreeing: separation is the wrong criterion for the one pressure fixture, a radial piston seal; the single-material Shigley frustum is non-conservative for aluminium on steel; and the frustum gate does not even fire on the end cap. I kept C = 1 and say it is an upper bound.
- *A table of recommended torques.* It would duplicate `torque_guide_8_8_dry_Nm`, which is the duplication `tests/flight-db-embed.test.mjs` exists to prevent. This tool reads that column and reproduces it instead.
- *This:* a receipt that reads the shipped tables, shows the band rather than one number, refuses where the repo has no data, and puts PartForge's current verdict on the same joint next to it.

**What other ideas in the bank already cover, and what this one does instead.** Idea 11 *Hole Stack* works out clearance holes, counterbores, nut pockets and tapped holes from the same fastener table, and runs `threadCheck` at the table's engagement (it found that `threadCheck` wants more engagement than the table's `min_engagement_6061T6_8_8_mm` at all 12 sizes). Idea 07 *Shadow Lint* asks which `bolt_shear` inputs have a geometric witness. Neither computes tension, preload, a torque window or protrusion. This idea stays off hole geometry. It uses `threadCheck` the other way round: strip capacity against the worst-case bolt *load* (F_max + F_ext), not only against the bolt's own UTS.

## How it works

**Data, never retyped.** `build-data.mjs` writes six classic-script snapshots, each with a provenance sidecar, from PartForge at `0974a62`:
- the exact text of `data/tables/fasteners_metric.json`, `data/tables/design_factors_nasa.json` and `tests/dryrun/endcap.scad` (test 1 re-hashes each against its sidecar's `sourceSha256`);
- all 16 rows of `fasteners_un.json`, cut to size, pitch, stress area and their labels, plus the nut and Type A washer entries with their own labels and usage notes (4), (6) and (7) as exact substrings;
- code cut verbatim from `index.html` by anchor regex: lines 780–899 (thread tables, `parseThreadSize`, `tensileStressArea_mm2`, `ENGAGEMENT_RULE`, `threadCheck`, `boltShear`), 935–999 (`FLIGHT_MATERIALS`), 5744 (`matClass`) and 5804 (`GRADE_SY`);
- lines 79 and 396–405 of `docs/roadmap-evaluation.md`.

`build-data.mjs --check` reports all six current against the checkout. The sidecars carry `copiedAt` 2026-10-26, the date the folder was rebuilt by transcript replay; the commit, blob and sha256 they record are what matter, and they match.

`torque.js` then reads numbers out of the tables' own words. Each read goes through `must()`, which throws rather than guessing if the text changes. The nut factors K = 0.20 dry, 0.14–0.16 lubricated or zinc-plated and ~0.12 with anti-seize come from the design-rule sentence. So do the 0.65–0.75 × proof target and the guide column's "K = 0.20 and F = 0.7 x proof load". The inch K values (0.20, 0.15–0.17, 0.12–0.14 moly, 0.25–0.35 stainless) come from `fasteners_un` notes (6). The SAE J429 grade 5 and 8 strengths, labelled `[certain, SAE J429-2014]` by PartForge, come from notes (7) prose, as does its floor "J429 grades start at 1/4 in; #2-#12 machine screws are NOT graded to J429". Test 2 checks the metric values against the evaluation's own summary of them (`:398`).

**The math** (N, mm, MPa; d in metres inside F = T/(K·d)):

| Line | Formula | Inputs from |
|---|---|---|
| preload | F = T / (K·d); band F(1 − u) … F(1 + u) | K: the table's range, mid by default (low/high selectable); u: NASA row by "lubricated at assembly" |
| proof load | F_proof = A_s × S_p | `tensile_stress_area_mm2` and the grade's `proof_MPa` (8.8 above M16 from the grade note: 600/660/830) |
| at assembly | σ = F_max / A_s against proof, yield, UTS | `grades` |
| in service | σ = (F_max + F_ext) / A_s, C = 1 | F_ext declared per bolt, with its source |
| torque window | T = K·f·F_proof·d, f = 0.65, 0.70, 0.75; cap T = K·F_proof/(1 + u)·d | design rule |
| protrusion | L − (stack + n_w·t_w + m) ≥ 2p | `nut_h_mm` (ISO 4032, m max), `washer_t_mm`; nyloc and jam heights are `recall` fields and the receipt flags them |
| tapped | PartForge `threadCheck()`, verbatim; also strip / (F_max + F_ext) | `FLIGHT_MATERIALS`; engagement clipped to L − stack − washer when both are given |

The proof load uses A_s × S_p rather than the table's `proof_load_8_8_N` column, so that F/F_proof always equals σ/S_p. The column rides along on the receipt as a cross-check. The guide column decides it: recomputed from its own definition with A_s × S_p, all 12 cells reproduce to 3 sf; recomputed from the 3-sf proof column, five miss (M2.5, M6, M8, M10, M12). So the guide was built from A_s × S_p too.

**The end cap, worked** (`--preset endcap`, all from the fixture's own text). M8 (A_s 36.6 mm², d 8 mm), 8.8 (proof 580 / yield 640 / UTS 800 MPa [likely, ISO 898-1:2013 Table 3]), 25 N·m, lubricated, K 0.15 (the middle of 0.14–0.16), u 0.25 [certain, NASA-STD-5020B TFSR 6 / Table 2]:

| | Value | Worked |
|---|---|---|
| nominal preload | 20,833 N, 98.1 % of proof | 25 / (0.15 × 0.008); 36.6 × 580 = 21,228 N |
| band | 15,625 N – 26,042 N | × 0.75, × 1.25 |
| at assembly | 711.5 MPa: past yield; SF 0.82 proof, 0.90 yield, 1.12 UTS | 26,042 / 36.6 |
| torque window | 16.6 N·m – 19.1 N·m (17.8 N·m at 0.70); cap 20.4 N·m | 0.15 × {0.65, 0.70, 0.75} × 21,228 × 0.008; 0.15 × 21,228 / 1.25 × 0.008 |
| in service, upper bound | 877.6 MPa: past UTS at C = 1 | (26,042 + 6,080) / 36.6; F_ext = 48,641 / 8 from `:49` |
| thread in 6061-T6, 16 mm | strip 31,165 N vs bolt 29,287 N; strip / (F_max + F_ext 32,122 N) = 0.97 | `threadCheck`, verbatim |
| PartForge today | shear SF 2.22, bearing 9.22 ≥ sf_min 2.0: passes | `boltShear` with `GRADE_SY` 640, threads in the shear plane |

The evaluation's own counter-example (`:403`: "F_i = 20.8 kN against a 21.2 kN proof load (At 36.6 mm2, 580 MPa) … 712 MPa and the proof SF is 0.82") reproduces exactly. The sweep shows what the 25 N·m was right for: dry at K 0.20 it gives 15,625 N, 73.6 % of proof, inside the target band, and the top of the ±35 % scatter is 576.3 MPa, within proof. The dry window is 22.1–25.5 N·m and the table's own dry guide for M8 is 23.8 N·m. With anti-seize (K 0.12) the same torque gives 122.7 % of proof nominal.

**The other presets** are illustrations, and say so. `m6-through` uses the table's M6 dry guide torque (9.79 N·m, which lands at 70.0 % of proof) with a 500 N "example load": protrusion 20 − (10 + 1.6 + 5.2) = 3.20 mm against 2p = 2.00 mm. `quarter-20` is 1/4-20 J429 grade 5 dry at 10.7 N·m (the window's 0.70 point at K 0.20) with a 2,500 N "example load"; its nut and washer heights are `recall` in the inch table, and the receipt says so. Neither load comes from a PartForge part.

**Refusals.** No torque, or "tightened by feel": the preload, assembly and service lines are refused, quoting the NASA row's note "A joint tightened by feel has no defensible preload at all". The torque window stays, because it says what to set. Other refusals: a size not in either table; an unknown grade; a declared grade without a source, or with proof > yield > UTS out of order; an inch screw below 1/4 in with a J429 grade; A574 or F837 (whose strengths are `recall` in the notes); zinc-plated inch threads (the notes give no K); a declared K without its source or its lubrication state; a negative external load; a nyloc nut on a size whose height is null; a tapped part that is not a metal. A verdict also names any line it left out ("Not computed: in service (no external load per bolt was given)"), so a refused line never reads as a passed one.

## Tests

`torque.test.mjs`, 17 tests, Node built-ins. What they are pinned to, outside this folder's code:

- **The snapshots are the source.** Three snapshots re-hash to their sidecars' `sourceSha256`. All six were read at one commit. The code cut contains `threadCheck`'s exact signature line.
- **The evaluation's numbers** (`roadmap-evaluation.md:398`, `:403`, read from the snapshot): the four facts at `:398` equal what the parser read from the tables. The `:403` counter-example (20.8 kN, 21.2 kN, 36.6 mm², 580 MPa, 1.25, 712 MPa, SF 0.82) reproduces field by field from a regex over that line. Exact: σ = 711.5209 MPa.
- **The table's own columns.** `torque_guide_8_8_dry_Nm` is reproduced to 3 sf at all 12 sizes from its own definition, and recomputing it from the proof column misses exactly M2.5, M6, M8, M10 and M12. The proof-load columns agree with A_s × S_p within 0.5 % for 4 grades × 12 sizes, with the worst miss above 0.1 %, so the comparison is not vacuous.
- **The fixture.** The torque note, the `bolt_shear`, `thread` and hole rows are read at lines 51, 49, 48 and 43, and line 11's "6 080 N per bolt" equals 48,641 / 8 rounded. The receipt's states are pinned: assembly past yield, service past UTS, preload above band, dry within proof. PartForge's own `boltShear` gives SF 2.22 and passes. 25 N·m sits inside the dry window (hand-worked 22.07712–25.4736 N·m), as does the table's 23.8 N·m guide, and above the lubricated cap. Bearing SF equals σ_y / (F/(d·t)) by hand, and an unknown fixture material throws instead of silently using 6061-T6.
- **PartForge's tests.** The `threadCheck` vector at `tests/flight-eng.test.mjs:246` (A_t 20.1, rule 12 mm, `ok_rule` false, F_strip = 0.5·310·0.5·π·6·9) goes through the tapped path. `GRADE_SY`'s yields equal the tables' yields for 8.8, 10.9, 12.9, A2-70 and J429 5 and 8.
- **The inch table's own worked example** (notes (6): 0.75 × 153 ksi × 0.0318 in² = 3,650 lbf, T = 0.20 × 3,650 × 0.25 ≈ 180 lbf-in) round-trips through the kernel in inch-pounds. J429-5 is 586/634/827 MPa, J429-8 is 827/896/1034 MPa.
- **Hand-worked stacks and closed forms.** M6 protrusion: 3.20 mm with 20 mm, −0.80 mm with 16 mm (ends inside the nut), short by 0.80 mm with 18 mm, 1.60 mm with a second washer, nyloc 6.0 mm (flagged recall), and 2p of 1/4-20 = 2.54 mm. F_max/F_min = 1.25/0.75. F ∝ T. T_mid lands at 0.70 proof and T_cap puts F_max exactly at proof, for four size/grade/condition sets. K 0.14 and 0.16 give 25/(K·0.008).
- **Refusals and words.** 19 refusal cases each check the code, the missing field or the reason, and a refused line carries no number. Across every size × grade × condition (over 100 receipts), no headline or note says PASS. Stainless dry carries the 0.25–0.35 K caveat. A verdict names the lines it did not compute.
- **The CLI.** `--help` exits 0; the end cap prints the receipt lines above; by-feel and an unknown size exit 2; usage errors exit 3; `--guide` prints 12 rows; `example.txt` equals the CLI's current output byte for byte.
- **The README** quotes the kernel's end-cap numbers (this file), and the page loads every snapshot.

`ui-check.mjs` (79 checks, headless Chromium, about 5 s). At 390 px in dark mode by touch: the end cap's receipt numbers, two OVER stamps, the sweep, the "today" card (visible), the chart's label, its marks and the nominal dot at the middle of the scatter bar, and a tap tooltip. Tightened by feel refuses with no stress number, a disabled torque field and no chart bar. Typing 17.8 N·m brings the nominal to about 70 % and the headline to the C = 1 bound only. At 1280 px in light mode by keyboard: M6 protrusion, a 16 mm screw ending inside the nut, the nyloc recall flag, a declared grade refused until it has a source, #8-32 J429-5 refused in the table's own words, the 1/4-20 lbf·in readout, a cleared load naming the line left out, the K-range caption styled as a caption, and Enter on a preset button. Every preset at both widths and both schemes: no horizontal overflow, no console errors.

**Teeth.** I broke the code on purpose, one sabotage at a time, and counted failing tests out of 17:

| Sabotage in `torque.js` | Tests failing |
|---|---|
| d in mm/100 instead of mm/1000 | 8 |
| proof load from the 3-sf table column instead of A_s × S_p | 6 |
| lubricated and as-received scatter rows swapped | 5 |
| assembly stress at the nominal, not the top of the scatter | 5 |
| service adds F_ext to the nominal, not F_max | 4 |
| mid K is the low end of the range | 4 |
| torque cap ignores the scatter | 4 |
| target band read lo/hi swapped | 4 |
| 8.8 above M16 uses the small-size properties | 2 |
| the yield step dropped from the classifier | 2 |
| protrusion ignores the nut | 1 |
| one washer counted when two are fitted | 1 |
| protrusion rule one pitch, not the row's two | 1 |
| tapped reach ignores the head washer | 1 |
| strip ratio against F_max, ignoring F_ext | 1 (the CLI's printed 0.97) |
| "tightened by feel" not refused as such | 1 |
| declared grade accepted without a source | 1 |
| J429 size floor ignored | 1 |
| negative external load accepted | 1 |
| stainless dry K caveat dropped | 1 |
| the verdict stops naming the lines it left out | 1 |
| the end cap's bearing against a hard-coded 6061-T6 | 1 |
| lbf approximated as 4.45 N | 1 |
| anti-seize treated as not lubricated (±35 %) | 1 (this one escaped until I added the per-condition K and u pin) |
| the headline says PASS when nothing exceeds | 1 |
| *data:* 8.8 proof 580 → 590 in the snapshot | 8 |
| *data:* the fixture's torque 25 → 20 N·m | 4 |

All 27 are caught. The page sabotages, counted against `ui-check.mjs`:

| Sabotage in `app.js` / `style.css` | Checks failing |
|---|---|
| the assembly line's proof SF prints the yield SF | 1 |
| the torque field stays enabled when tightened by feel | 1 |
| the "as PartForge checks it today" card is never shown | 1 (escaped until I added a visibility check: Playwright's `innerText` reads hidden text) |
| the scatter bar drawn from the nominal, not F_min | 1 (escaped until I added the dot-at-the-middle check) |
| the dark-mode page colour lost | 1 |

The scripts that ran these lived in the session scratchpad and are not shipped; each mutation was applied alone to a copy of this folder.

## Honest assessment

**What works.**
- [Certain] The arithmetic is right where it can be checked from outside. It reproduces the evaluation's worked counter-example to the digit, the table's own torque-guide column at all 12 sizes, PartForge's `threadCheck` test vector, the inch notes' worked example, and hand-worked protrusion stacks. I also recomputed the end-cap numbers in Python straight from the JSON tables, not through `torque.js`; they agree.
- [Certain] No number on the page or in the CLI is typed into the code. Every one is read from a snapshot whose sha256 matches PartForge `0974a62`, or computed from those, and each line names its table, field and PartForge confidence label.
- [Certain] It refuses rather than guesses: no torque, no grade, no source, a grade outside the repo's data, an inch screw below J429's floor.
- [Likely] The NASA ±25 % / ±35 % rows are the right scatter to put on a torque-controlled amateur joint as a citable floor, which is how PartForge's table itself presents them ("Used here as a CITABLE floor … conservative for amateur HPR").

**What is rough.**
- [Certain] The in-service line is an upper bound (C = 1), sometimes a loose one. The end cap's 877.6 MPa "past UTS" is the highest preload plus the whole pressure load. The bolt's real share is smaller, and settling it needs the joint diagram that the evaluation chose not to build. The headline says so.
- [Certain] Stress is tension only. While the wrench turns, thread friction twists the bolt, so it yields at a lower preload than tension alone shows. The assembly line is therefore optimistic, not conservative. The page lists this under "What this does not check". No torsion number is given because no PartForge table carries the thread-friction split.
- [Likely] K is a design-rule range, not a measurement. The receipt uses the middle and shows the low/high preload as a sensitivity, but does not stack the K range on the NASA ±u, since the NASA scatter already includes nut-factor variation. A user who picks K "low" and reads the top of the band is partly double-counting.
- [Likely] "Zinc-plated, as received" uses the table's lubricated-or-plated K with the ±35 % non-lubricated row. That is my reading of NASA's "lubricated at assembly", not something either table states for plating.
- [Speculative] Whether the real end cap is over-torqued depends on whether its threads really are lubricated, which only the builder knows. What is certain is that the fixture's own words, worked through PartForge's own tables, put the top of the scatter past yield.
- [Certain] Metric stainless dry uses the plain-steel K 0.20, because `fasteners_metric.json` has no stainless K. The receipt quotes the inch table's 0.25–0.35 and says a higher real K means less preload than shown.
- [Certain] There is no external oracle beyond PartForge's own numbers, hand-worked cases and an independent Python recomputation. The evaluation names me-toolbox (MIT) as an offline cross-check, but for the joint diagram, which this does not build, so I did not run it.
- [Certain] The provenance sidecars carry `copiedAt` 2026-10-26, the replay date, not the builder's original copy time.

**Findings about the source repo** (PartForge at `0974a62`; none fixed there):
1. **The end cap's torque note is a dry torque labelled lubricated.** `tests/dryrun/endcap.scad:51` (FLIGHT `mfg.notes`) says "Torque M8 bolts to 25 N·m (grade 8.8 lubricated)". On the repo's own tables, 25 N·m sits inside the dry window (22.1–25.5 N·m at K 0.20) next to the table's dry guide of 23.8 N·m. Lubricated (K 0.14–0.16) it gives 98.1 % of proof nominal and 711.5 MPa at +25 %. The guide column's own note says to multiply by 0.7–0.8 for lubricated threads, which gives 16.7–19.0 N·m. The evaluation (`:403`) reached 0.82 as "the scope's own worked example"; it is also the shipped fixture's assembly instruction.
2. **The end cap's shear note disagrees with the app's own check.** `endcap.scad:11` says "M8 grade 8.8 single shear capacity ~18 kN per bolt; SF ≈ 3.0 — PASS". That is 0.577 × 640 MPa on the 50.3 mm² shank. The evaluator puts the threads in the shear plane by default (`index.html:5809-5810`) and reports SF 2.22. Both treat a 48,641 N axial pressure load as shear (`:49`), as `bulkhead.scad:11` does with its recovery tension. The evaluation names that defect at `:405`.
3. **Stale line citations in the evaluation.** `docs/roadmap-evaluation.md:400` gives the whitelist at `index.html:4126` (now `:4733`), `GRADE_SY` at 4929 (now `:5804`) and the `partTier` hoop escalation at 4178 (now `:4785`, function at `:4771`). `:404` gives `threadCheck`'s signature at `:835` (now `:848`).
4. **The torque guide was computed from A_s × S_p, not from the proof column beside it.** Its definition says "F = 0.7 x proof load", but recomputing from the 3-sf `proof_load_8_8_N` misses the guide by one in the third figure at M2.5, M6, M8, M10 and M12. Harmless, but the two columns are rounded independently.
5. **The two fastener tables give different lubricated nut factors:** 0.14–0.16 "lubricated or zinc-plated" (`fasteners_metric.json` design rule) against 0.15–0.17 "lubricated or waxed" (`fasteners_un.json` notes (6)). At mid K that is a 6–7 % difference in preload for the same torque.
6. **No stainless nut factor in the metric table**, although it carries A2-70, A2-50 and A2-80 and its own A2-70 note warns that A2 galls on A2. Only the inch notes give 0.25–0.35 stainless-on-stainless dry.
7. **`min_engagement_6061T6_8_8_mm` has no confidence label.** It is neither a core field nor in `field_confidence` (idea 11 also records this).
8. **The protrusion rule is still unchecked.** `design_factors_nasa.json` `fastener_protrusion_min` says "PartForge does not check it yet", and there is no protrusion logic in `index.html` outside the embedded table.

**Gates not passed.** An idea-bank prototype. It has not been through PartForge's geometry gate (it measures no mesh: stack and engagement are typed or read from the fixture's declarations), its data-provenance pipeline or its skeptic review. It has not had an independent review in this bank. PartForge's maintainers have not seen it. NASA TM-106943, the source PartForge's table names for this check, has not been used to validate it.

**How this folder came to be.** It was begun by a builder before the 2026-10-26 hold, which stopped it after `torque.js`, 14 tests, the CLI, the page and a 75-check `ui-check.mjs`, with no README and never run through the bank checker. It was recovered from `hold/ideas-20-30` by transcript replay and finished on 2026-11-02. I re-verified every citation above and every snapshot against the checkout, and recomputed the end-cap numbers independently. Kept: the kernel's math, the snapshots and `build-data.mjs` (all six current), the CLI and the page. Fixed: a verdict could say "No line exceeds proof" while the in-service line had been refused for want of a load; it now names the lines it left out. `endcapToday()` used a hard-coded 6061-T6 and now reads the fixture's own FLIGHT material. Added: three tests (the dry-torque finding, the not-computed verdict and fixture material, the CLI and `example.txt`), a per-condition K and scatter pin and three page checks (each added because a sabotage escaped), the torsion caveat on the page, a phone layout for the condition sweep, a halo on the chart labels so reference lines do not strike through them, a fix for the K-range caption that rendered as a bordered box, `check.mjs`, `example.txt` and this README.

## Where it would land

**PartForge, `index.html`, as a `bolt_tension` loads kind.**
- Add `bolt_tension` to the whitelist (`:4733`). Add an evaluator branch next to `bolt_shear` (`:5779-5814`) that takes `size`, `grade`, `torque_Nm`, `lubricated` and `force_N`/`n`. It should report the preload band, σ at F_max and at F_max + F_ext against proof, yield and UTS, and always COMPUTED: never set `row.ok` from a torque-derived margin.
- Read the tables through `dbRows('fasteners_metric')` and `dbDesignFactors()` (`:5154`, which already exposes `preload_uncertainty`) instead of these snapshots.
- Add a protrusion row, or a `flightLint` (`:4827`) rule, that needs a declared screw length and stack.
- Make `partTier()` (`:4771`) escalate a pressure part that declares only tension rows, as the evaluation's hook note asks.
- Change the doctrine line (`:1464`) and the `dbHints` line (`:5502`) that say preload is not checked.
- Re-declare `tests/dryrun/endcap.scad:49` as tension and fix its `:51` torque or its thread condition.
- Add `tests/flight-eng.test.mjs` cases reproducing `roadmap-evaluation.md:403` and this folder's guide-column reconciliation, and keep `tests/flight-db-embed.test.mjs` green (no inline proof table).

To ship for real it needs PartForge's skeptic review, the provenance pipeline's sign-off on the K and scatter rows it reads, and validation against NASA TM-106943, as the table's reconciliation names.
