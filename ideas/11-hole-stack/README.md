# Hole Stack
> PartForge's fifth selector, for holes: give it M2–M20, a head and what holds the far end, and it works the clearance hole, counterbore or countersink, nut pocket and tapped hole out of `fasteners_metric.json` and `fits.json`, citing a FLIGHT row only when every field behind it is likely or certain with a named standard (M6: ISO 273 medium 6.6 H13 → Ø6.71 ±0.11, cited; counterbore from the knurled head, ≥ 10.62, never the recall 11). It refuses the 14 of 36 clearance bands `fits.json` cannot give, and finds that the table's own 9.5 mm M6 engagement fails PartForge's thread check, which wants 12.

**Kind:** tool
**For:** PartForge
**Run:** open `ideas/11-hole-stack/index.html` in a browser (classic scripts, works from `file://`, no build, no network; `?size=M10&far=nyloc&plate=30`, `?size=M7` and the other inputs preload from the URL). Command line, from the bank root: `node ideas/11-hole-stack/hole-stack.mjs M6 --far nut --plate 16 --verify` (`--scad`, `--flight`, `--json`, `--svg FILE`, `--repo /path/to/Partforge`, `--help`; exit 0 built, 2 refused, 3 usage; `example.txt` is saved output of eight runs). Tests: `node --test ideas/11-hole-stack/holestack.test.mjs` (19 tests, Node built-ins, about 3 s) and `node ideas/11-hole-stack/ui-check.mjs` (60 checks in headless Chromium with the globally installed Playwright; `--shots` saves full-page screenshots; `check.mjs` runs it for `tools/check.mjs`). `node ideas/11-hole-stack/build-data.mjs /path/to/Partforge` re-derives the snapshots; `--check` says whether they are stale.
**Made by:** Spotface

## What it is

A selector in the sense PartForge's README uses the word: the designer (or a person) asks a question in the build direction, "I have an M6 socket-head screw through a 12 mm plate into a tapped part", and gets the finished answer worked from the tables, not a table row to do arithmetic on. You choose:

- a **size**: one of the 12 rows of `fasteners_metric.json` (M2, M2.5, M3, M4, M5, M6, M8, M10, M12, M14, M16, M20, coarse pitch);
- a **head**: socket (counterbore), countersunk (countersink), button (nothing cut) or none, and whether an ISO 7089 **washer** sits under it;
- the ISO 273 **clearance series**: fine, medium or coarse;
- the **plate** thickness;
- the **far end**: through (nut outside), an ISO 4032 nut pocket, a nylon-insert nut pocket, or a tapped mating part (its thickness, through or blind, standard or stainless tap drill, and whether the hole is modelled at the internal minor diameter D1 or at the tap drill);
- the **process**, whose PartForge capability row supplies the default tolerance.

It returns:

1. **The numbers**, each with the table field it came from, the standard `field_sources` names for that field, and the table's confidence for that **field** (`field_confidence`, else the row label for a core field, else *unlabelled*).
2. **An OpenSCAD cutter module** to `difference()` from your plate, in PartForge's flight dialect: `tess_tol` first, the `fn_tol()` helper verbatim, `$fn=fn_tol(d)` on every round primitive, a comment on every dimension naming field, standard and confidence, GO-gauge modules for the non-round features.
3. **FLIGHT rows** (`holes`, `bores`, `gauges`) in a block PartForge's own `parseFlight()` reads, with `tol_src` derived mechanically from the field confidences.
4. **A section drawing** (SVG) with the features, the largest head, washer and nut the table describes (dashed), and callouts coloured by provenance.
5. **Refusals by name**: what is missing, and what would help.

The page and the CLI run the same kernel (`holestack.js`). On the page, every FLIGHT block and OpenSCAD module is re-read live by PartForge's own `parseFlight()` and `flightLint()`, copied verbatim out of `index.html`, and every clearance band is compared with PartForge's own `dbFit()`.

The worked M6 stack (socket head, medium, no washer, 12 mm plate), all from the M6 row unless named:

| Feature | Number | From | FLIGHT |
|---|---|---|---|
| Clearance hole | 6.6 mm, H13 → 6.600–6.820, written Ø6.710 ±0.110 | `clearance_medium_mm` [likely], ISO 273:1979; IT13 of the 6–10 mm step = 220 µm, `fits.json` [likely]; H13 from the column's own "(H13)" | `holes`, `tol_src: "source"`, `tol_ref: "ISO 273:1979 medium M6 6.6, H13; ISO 286 IT13 6-10 mm = 220 um (fits.json)"` |
| Counterbore | ≥ 10.62 (knurled dk 10.22 + 0.4), written Ø10.750 ±0.130, 6.5 deep | `shcs_head_d_knurled_mm` [likely], ISO 4762; "+ 0.4" read from `columns.cbore_d_mm`; ±0.13 = `FLIGHT_PROCESSES.cnc_mill.tol_general_mm`; depth `cbore_depth_flush_mm` [unlabelled] | `bores`, `tol_src: "default"` |
| (not used) | 11 | `cbore_d_mm` [recall], "DIN 974-1 style" | shown, never cited |
| with a washer | ≥ 12.0, 8.1 deep | `washer_od_mm` 12 [likely] ("use as spot-face diameter minimum"), + `washer_t_mm` 1.6 | `bores`, default |
| Tapped part | D1 4.917, written Ø5.047 ±0.130; drill 5.0 (77 %) or 5.2 stainless | `minor_D1_mm` [certain], ISO 724; `tap_drill_mm` [likely, trade practice] | `holes`, default |
| Nut pocket | 10.130 ±0.130 across flats, 11.697 across corners ≥ sharp 11.547, 5.2 deep (nyloc 6.0 [recall]) | `nut_af_mm` [likely], `nut_ac_sharp_mm` [certain], `nut_h_mm` [likely] | GO gauge, expect clear |
| Engagement | 9.5 mm + 1–2 pitches = 10.5–11.5 mm in 6061-T6 | `min_engagement_6061T6_8_8_mm` [unlabelled] | text; PartForge's `threadCheck` says it needs 12 |

## Why I made it

**The gap it fills.** PartForge's README argues "The lookups are worked, not quoted" (`README.md:706-732`) and ships four selectors that turn rows into answers: `dbPickORing` (`index.html:5041`), `dbPickDrill` (`:5100`), `dbPickStock` (`:5117`) and `dbBoreMm` (`:5137`). None of them composes a hole. `dbPickDrill` names a drill for a diameter you already have; nothing works out which diameter, which band, which counterbore and which pocket. The doctrine prescribes that stack only in prose (`docs/data/PROVENANCE.md:37`: tap at D1, clearance at `clearance_medium_mm`, counterbore to `cbore_d_mm` or knurled dk + 0.4, hex pockets to `nut_ac_min_mm` across corners and `nut_h_mm` deep, engagement against `min_engagement_6061T6_8_8_mm`), and for metric threads the model gets one line per size from `dbHints()` (`index.html:5319-5337`) and does the arithmetic itself.

**What goes wrong when it does.** I ran the shipped `dbHints()` on "an M6 socket head cap screw in a counterbore". Its M6 line ends `SHCS head Ø10 × 6 mm, key 5 mm, counterbore Ø11` and carries the tag `[likely, disputed]`. That tag is the **row** label (`dbTag(row)`, `index.html:5336`); the counterbore Ø11 is `cbore_d_mm`, which `field_confidence` marks **recall** on all 12 rows, and Ø10 is the plain-head dk the column itself says never to size a counterbore from. The flight doctrine then tells the model "a [certain] or [likely] line is tol_src "source"" (`index.html:1454`). So the path PartForge built to stop recall numbers being cited cites one, for the commonest hole in the app. The first dry run shows the same failure from the other side: its retainer declares `"M6 bolt clearance holes","d_mm":6.600,"tol_mm":0.100,…,"tol_src":"source","tol_ref":"ISO 273 medium clearance M6 = 6.6 mm"` (`tests/dryrun/retainer-fixed.scad:51-53`), and its end cap the same for M8 at 9.000 ±0.100 (`tests/dryrun/endcap.scad:43`). ISO 273 gives the diameter; its medium series is H13, which runs 6.600–6.820. The declared band runs 6.500–6.700: it accepts a hole 0.1 mm under the ISO 273 minimum, rejects 6.70–6.82, and cites ISO 273 for a ±0.1 the standard does not give.

**Alternatives I weighed.**

- *A lint for FLIGHT blocks* that flags a `tol_src: "source"` row whose number matches a recall field. Cheaper, but it catches the lie after the model has written it, and it cannot tell a coincidence from a citation.
- *Fixing the hint line* to tag each field with its own confidence. That is a one-line change inside PartForge, not a bank deposit; it is reported below as a finding instead.
- *The inch twin* from `fasteners_un.json`. It doubles the surface, and the proposal itself said to start metric.
- *A printable hole-gauge coupon*. Useful at a printer, but its point would be physical testing, which cannot be done here.

The selector won because it is the thing PartForge's own argument asks for, and because building it forces every provenance decision to be made in code where a test can hold it: which field, which confidence, which standard, cited or not.

**What I changed from the judged proposal.**

- **No H14.** The proposal planned "it_um['12'|'13'|'14'] (6-10 mm step: 150/220/360 um)". `fits.json` carries IT5–IT13 only (`columns.it_um`, `data/tables/fits.json:10`; no step has a `"14"`). The coarse series is therefore refused at every size, with the reason, rather than given a band from a formula the table chose not to ship. `fits.json` also withholds IT12 for the 1–3 mm step (formula 85 µm against a published 100 µm), so M2 and M2.5 fine are refused too: 14 of 36 size × series bands.
- **The washer case.** The proposal kept the counterbore at 10.62 and only deepened it to 8.1 with a washer. A 12.0 mm washer does not go into a 10.62 mm counterbore. The stack opens the counterbore to `washer_od_mm`, the table's own "spot-face diameter minimum", and says that the table gives no wall clearance for a washer that drops into a bore.
- **The `whyNow` citation.** `docs/roadmap-evaluation.md:42` does not record an open failure. It records that the hand-typed UN clearances were deleted from the doctrine. What is still hand-typed is the metric list in the flight doctrine (`index.html:1493`). All 23 of its numbers agree with the table today; a test now fails if one drifts.
- **Symmetric FLIGHT tolerances.** The proposal wrote the band "+IT/0". PartForge's FLIGHT grammar has one `tol_mm`, checked symmetrically (`cmmVerdicts`, `index.html:3849`). An H band is therefore written as its centre ± IT/2 (6.710 ±0.110), and the feature is modelled at that centre so the module and the row agree. A feature the table gives only a minimum for (counterbore, nut pocket, tapped hole) is written as minimum + the process's default tolerance, centred, with `tol_src: "default"`.
- **Not every cut is a cylinder.** The nut pocket is a hexagon (`linear_extrude` of a polygon), so it gets no `fn_tol`; PartForge's doctrine sends non-round features to `gauges`, so the pocket and the countersink cone get GO-gauge modules and gauge rows instead of tolerance rows.
- **Where to model a tapped hole is a choice the page exposes**, because PartForge gives two answers (finding 3 below). D1 is the default, as the table and `PROVENANCE.md` say.
- **Two findings the proposal did not anticipate** are computed and tested: the table's engagement fails PartForge's own thread check, and the doctrine's nut-pocket rule makes a pocket the nut cannot enter.
- **Node tests only.** The proposal mentioned `python3 -m unittest` as well; one test runtime was enough for what is tested here.

## How it works

**Data.** `build-data.mjs` writes four derived snapshots and copies two files, each with a provenance sidecar from `tools/snapshot.mjs` (PartForge at `0974a62`):

- `snapshots/fasteners_metric.js` and `snapshots/fits.js` hold the **exact text** of the two tables inside a classic-script wrapper, so the page works from `file://`. A test re-hashes the text and checks it against the sidecar's `sourceSha256` and, when the checkout is present, against the file itself.
- `snapshots/partforge-code.js` holds code cut **verbatim** out of `index.html` between anchors found by regular expression: the thread tables, `parseThreadSize`, `tensileStressArea_mm2`, `ENGAGEMENT_RULE` and `threadCheck` (lines 780–872); the 6061-T6 entry of `FLIGHT_MATERIALS` (936–938, inside a wrapper object); `FLIGHT_PROCESSES` (1001–1035); the whole DECL block with `parseFlight` and `flightLint` (4646–4859); `DB_MEMO`/`dbMemo` (4898–4899); `dbF`, `dbConf`, `dbTag`, `dbRows`, `dbRowsBuild` and `dbFit` (4969–5012); the one-line `matClass` (5744). It also holds two doctrine passages as strings (the "Use standard sizes" line, 1493, and the provenance rule from 1454). A test checks every cut is still in the checkout unedited. PartForge is Apache-2.0.
- `snapshots/provenance-doctrine.js` holds `docs/data/PROVENANCE.md` section 1, exact lines.
- `snapshots/dryrun-retainer-fixed.scad` and `dryrun-endcap.scad` are plain copies of the first dry run's two parts.

**Rules come out of the table's own text.** Nothing below is typed from memory. The kernel reads each rule out of the column descriptions when it loads. If the counterbore rule, the countersink angle or a series' H grade is missing from the text, the feature is refused (a test deletes the counterbore rule and checks); if the pitch allowance is missing, the engagement is compared with the bare minimum instead:

| Rule | Read from |
|---|---|
| fine H12, medium H13, coarse H14 | `columns.clearance_{fine,medium,coarse}_mm`: "(H12)" … |
| counterbore ≥ knurled dk + **0.4** | `columns.cbore_d_mm`: "Any value >= shcs_head_d_knurled_mm + 0.4 works" |
| flush depth = k + **0.5** | `columns.cbore_depth_flush_mm` (the column value is used; the test checks the identity on all 12 rows) |
| countersink at **90°** | `columns.csk_head_d_mm`: "countersink to this diameter at 90 deg" |
| engagement + **1–2 pitches** | `columns.min_engagement_6061T6_8_8_mm`: "Add 1-2 pitches for chamfer and incomplete threads" |

**Provenance, mechanically.** For each field of the row, the confidence is `field_confidence[field]`, else the row label if the field is in `core_fields`, else **unlabelled**. The basis is what `field_sources[field]` names: *recall* (the string says recall), *computed*, *rule* (design rule or trade practice) or *standard* (begins ISO/DIN/ASME). A field is **citable** only if it is certain or likely **and** its basis is a standard. A FLIGHT row gets `tol_src: "source"` and a `tol_ref` only when every field behind both its diameter and its tolerance is citable. In practice that is only the clearance hole: ISO 273 [likely] plus an IT width from `fits.json` [likely]. Everything else is `"default"` and carries no `tol_ref`; recall numbers appear only as shown values, in gauge `why` text with `[recall]`, or not at all. A test runs all 2,304 input combinations and checks that no cited row has a non-citable field behind it.

**Clearance hole.** d = `clearance_<series>_mm`. The size step is the `fits.json` row with `from_mm < d ≤ to_mm`, which is `dbFit`'s rule. The H band is [d, d + IT], from the step's `it_um`. If the grade is missing, the band is refused, and the reason quotes the `disputed` entry when there is one. The hole is modelled at the band centre d + IT/2, and the FLIGHT row is d + IT/2 ± IT/2 from the counterbore floor (or the top face, or where the countersink cone meets the hole, so no CMM station sits in the cone) down to the bottom face or the nut pocket's ceiling.

**Counterbore.** The minimum is `shcs_head_d_knurled_mm` + 0.4, or `washer_od_mm` if a washer is under the head and that is larger. The band is [min, min + 2t], where t is `FLIGHT_PROCESSES[process].tol_general_mm`, PartForge's "typical ± without a callout" (0.13 for CNC milling, from the Protolabs and Hubs guides it cites). It is modelled at the centre. Depth is `cbore_depth_flush_mm`, plus `washer_t_mm` with a washer. The recall tool size `cbore_d_mm` is shown beside it and never used. The counterbore is refused if it would be as deep as the plate.

**Countersink.** `csk_head_d_mm` at the face, 90° included, cut as a cone from the face down to the modelled clearance diameter (depth (dk − d_hole)/2). It is refused when the field is null (M2, M2.5: "null = size not in ISO 10642"), when the cone would pass through the plate, and with a washer. All its fields are recall, so it gets a GO gauge (the largest head, seated flush, `expect: "clear"`) and no tolerance row. A button head is drawn proud of the face (recall, nothing cut) and refused where the table has nulls (M2, M2.5, M14, M20).

**Nut pocket.** The nut at its largest is `nut_af_mm` (s max) across flats. The pocket is s max + t across flats, centred in [s max, s max + 2t]. A regular hexagon's across-corners is across-flats / cos 30°, so the pocket's 11.697 at M6 clears `nut_ac_sharp_mm` 11.547 automatically, as the table's column says. Depth is `nut_h_mm` (m max), or `locknut_h_mm` [recall] for a nyloc (refused at M2 and M2.5, where it is null). Two checks are computed:

- *Milled corners.* A round cutter of radius r leaves each 120° corner r(2/√3 − 1) short along the diagonal, so the corners span AC − 2r(2/√3 − 1). With CNC milling's `min_internal_corner_r_mm` 0.8 that is 11.450 at M6: a nut at e min (11.05) fits, a sharp-cornered one (11.547) does not. The table's own advice applies: corner relief.
- *DIN nuts.* At M10, M12 and M14, `din934_nut_af_mm` and the nyloc column's "DIN 985 M10 is 17 AF (ISO 16)" are larger than the pocket.

The GO gauge is the nut at s max and full height, `expect: "clear"`.

**Tapped part.** The hole is modelled at `minor_D1_mm` [certain, ISO 724] or, by choice, at the tap drill. Its band is [that minimum, minimum + 2t], `tol_src: "default"`: the 6H minor-diameter tolerance of ISO 965 is in no PartForge table. The drill (`tap_drill_mm` [likely, trade practice] or `tap_drill_stainless_mm` [unlabelled]) and its percent of thread are shown. The page notes when the chosen drill falls outside the default band (the 5.2 mm stainless drill does: at M6 the band ends at D1 + 2 × 0.13 = 5.177). The table's minimum engagement `min_engagement_6061T6_8_8_mm` (class 8.8 in 6061-T6 only) plus 1–2 pitches is compared with the part (through) or modelled as the thread depth (blind; refused if the part is too thin). Then PartForge's own `threadCheck`, verbatim, is run at the table's engagement and at this stack's length with the inputs the app's loads evaluator uses (bolt UTS 800 MPa, 6061-T6 `su` 310 MPa, `matClass` → aluminium, `index.html:5773`).

**OpenSCAD.** Parameters first (`tess_tol`, then `cut_ext = 1`, a cutter overrun so no coplanar faces remain, labelled as a modelling allowance rather than a dimension), then `fn_tol` verbatim, an `m6_hex(af, h)` helper when a pocket is needed, `hole_stack_<size>_clamp()` (and `hole_stack_<size>_tapped()`), then the gauge modules. The plate's bottom face is z = 0 and the screw is on the z axis. Every parameter's comment quotes `field value [confidence] (standard)`, and a test checks each quoted value and label against the table.

**The drawing** is a section through the axis (through the nut's flats). The material on each side is the plate rectangle up to the cut wall. The dotted line in a nut pocket marks its across-corners. Leaders run to callouts coloured cited / tool default / recall / refused.

## Tests

`holestack.test.mjs`, 19 tests, about 3 s:

- **Snapshots** are byte-exact: the embedded table text hashes to the sidecar's `sourceSha256` and equals the checkout file; every verbatim code cut is still in `index.html` unedited; the `PROVENANCE.md` lines match; the dry-run copies hash right.
- **Rules from the table text**: H12/H13/H14, + 0.4, + 0.5, 90°, 1–2 pitches; with the counterbore text removed the counterbore is refused and no bore row is emitted.
- **The proposal's M6 stack, number by number**: 6.6 → 6.600–6.820 (IT13 220 µm, 6–10 mm), row 6.71 ±0.11 cited with its exact `tol_ref`; counterbore min 10.62, depth 6.5, the exact bore row, the recall 11 absent from all code; washer depth 8.1 and diameter 12.0 (and the table's tool size below the washer OD at 11 sizes, equal at M5); D1 4.917, drill 5.0, stainless 5.2, Le 9.5, need 10.5–11.5; the tapped row 5.047 ±0.13 through 16; nut 11.547 sharp, 11.05 min, 5.2 deep, pocket 10.13; nyloc 6.0 recall in the gauge `why`; M3 countersink 6.72 at 90°, cone depth (6.72 − 3.49)/2 by hand, clearance row starting below the cone.
- **Closed forms on all 12 rows**: D1 = d − 1.08253p and d3 = d − 1.22687p (ISO 724, as the columns state); sharp across-corners = s / cos 30°; 90° head k = (dk − d)/2; flush depth = k + 0.5; tool size ≥ knurled + 0.4; percent thread by the Machinery's Handbook formula the column quotes.
- **Against PartForge's shipped `dbFit()`**: all 22 bands equal `dbFit(d, 'H', g, 'h', g).hole`, and the 14 refusals fall exactly where `dbFit` returns null; the refusal texts quote the withheld IT12 and the missing IT14.
- **All 2,304 combinations** (12 sizes × 4 heads × 3 series × washer × 4 far ends × 2 tapped-hole models): PartForge's `flightLint()` returns nothing, its `parseFlight()` drops and demotes nothing, every `tol_mm` ≥ 2 × `tess_tol_mm`, `tol_ref` only on cited rows (≤ 140 characters), no non-citable field behind a cited row, and exactly 1,408 cited rows (the 22 bands × 64), nothing else cited.
- **Every OpenSCAD parameter**, over all combinations, against an independent recomputation in the test file (15,168 values), with no parameter beyond those; every `field value [label]` in the comments against the table; no numeral in the code outside the parameters except the hexagon's and `fn_tol`'s.
- **Refusals**: M7 (lists the 12 rows), M8×1 (fine pitch), M2 countersunk (quotes the null), M14 button, M2.5 nyloc, countersunk + washer, a counterbore deeper than the plate, a pocket meeting the counterbore, a blind hole too deep, bad input.
- **The dry run**: its M6 and M8 rows, read by PartForge's `parseFlight`, are nominal ±0.1 cited to ISO 273, admitting 0.1 below the H13 minimum and stopping short of its maximum; Hole Stack writes 6.71 ±0.11 and 9.11 ±0.11.
- **Findings**: `threadCheck` fails the table's engagement at all 12 sizes (M6 needs 11.020 to stop the strip, 12 for the rule); a hexagon at e min across corners is narrower than s max at all 12 sizes; the doctrine's two tapped-hole instructions; its 23 hand-typed metric numbers agree with the table (a tripwire); the shipped `dbHints()` line (live checkout, skipped without it); the nine unlabelled supplementary fields.
- **SVG and text** carry the result's numbers, with no NaN in any of the 2,304 drawings; the **CLI**'s exit codes and its `--verify` line; `build-data --check` reports the snapshots current.

**The tests have teeth.** Each sabotage below was applied to `holestack.js` alone and the suite re-run:

| Sabotage | Tests failing |
|---|---|
| use the row label instead of `field_confidence` | 4 |
| H grade one step finer (H12 for medium) | 8 |
| counterbore allowance halved (0.2) | 3 |
| nut pocket sized to e min across corners, as `PROVENANCE.md` says | 3 |
| FLIGHT clearance row written as nominal ± IT (the dry run's shape) | 3 |
| washer ignored in the counterbore diameter | 2 |
| counterbore cited as `source` with a DIN 974-1 `tol_ref` | 3 |
| tapped hole modelled at d3 instead of D1 | 2 |
| band centre and half-width at the full IT | 6 |
| countersink at 82° instead of the table's 90° | 1 |
| a withheld IT silently replaced by IT13 instead of refused | 4 |

`ui-check.mjs` (60 checks): at 390 px, dark, by touch, the default M6 shows its counts, drawing callouts, stack values, the cited and default rows, the absence of the recall 11 from the FLIGHT text, and the live "dropped 0, demoted 0 … flightLint clean" line. Then the nut pocket (doctrine and milled-corner notes, the gauge row), the washer (12.130, 8.1), the coarse refusal (no hole row, "band refused" in the drawing), the M2 countersink refusal, the M3 countersink, and the tapped part (FAIL from `threadCheck`, "short" at 10 mm). `?size=M7` refuses with the 12 rows and draws nothing. At 1280 px, light, by mouse and keyboard: `?size=M10&far=nyloc&plate=30` preloads and shows the DIN notes; an arrow key moves the head choice; the downloaded `.scad` equals the text shown. Dark at 1280 too. Nowhere does the page overflow sideways or log a console error. `node tools/check.mjs ideas/11-hole-stack` passes: README format, size, sidecars, the Node tests, `check.mjs`, and the smoke test at 1280 and 390 px.

## Honest assessment

What works:

- [Certain] Every number the tool prints comes from the two snapshot tables (exact text, hash-checked), from a rule the table states in its own column text, from PartForge's process table, or from arithmetic on those. The tests recompute every OpenSCAD parameter for every input combination independently, compare every band with PartForge's `dbFit()`, and pin the M6, M3 and dry-run numbers by hand.
- [Certain] No FLIGHT row is cited unless every field behind it is likely or certain with a named standard, over all 2,304 input combinations, and PartForge's own parser accepts every block without dropping or demoting a row.
- [Certain] Every clearance band equals what PartForge's shipped `dbFit()` gives, and the tool refuses exactly where `dbFit()` has no answer.
- [Likely] "Likely" here is PartForge's word: the fastener table says it was "compiled from memory of those standards … and reviewed, not transcribed". Citing a likely ISO 273 diameter as `tol_src: "source"` follows PartForge's own rule (`index.html:1454`). In this bank's vocabulary it is [Likely], not [Certain]. Before a pressure part is cut the table itself says to check the row against a vendor catalogue.

What is rough:

- [Certain] The OpenSCAD has **not been compiled**: OpenSCAD is not installed here, and PartForge's in-browser openscad-wasm is not vendored. It passes `flightLint` and a structural test, nothing more. The countersink GO gauge and the cut cone use different `$fn`, so their facets can overlap by up to about `tess_tol`. I expect that to read as a touch (PartForge's threshold is 0.02 mm), but I have not run PartForge's CMM on it [Likely].
- [Certain] The default tolerance (±0.13 for CNC milling) is PartForge's "typical ± without a callout", not a requirement. Rows that use it print in PartForge as "tool default — accept or replace before release", which is what they are.
- [Certain] The washer-in-counterbore band starts at the washer's d2 max, so a washer at its largest touches the wall; the table gives no clearance and neither does this tool. The same is true of the nut pocket's flats: the table gives no clearance, so the band starts at s max. The page says both.
- [Certain] The engagement figure covers only class 8.8 in 6061-T6, the one combination the table tabulates. Its prose scaling factors for other grades and parents are not applied.
- [Certain] One hole at the origin: no bolt circles or patterns (edit `at_mm` or use `pattern: "circle"` in the row yourself). Metric only: no inch twin.
- [Likely] The milled-corner check assumes the cutter's radius is the process's `min_internal_corner_r_mm`. A real shop may use a smaller tool.
- [Speculative] That a designer model given this selector's output would stop citing recall numbers for holes. I have not run PartForge's generator with it.

**Findings about the source repo** (PartForge at `0974a62`; none fixed there):

1. **The hint line cites a recall counterbore under a likely tag.** `dbHints()` builds the metric thread line with `SHCS head Ø… counterbore Ø${cbore_d_mm}` (`index.html:5332`) and tags the whole line with the row label (`dbTag(row)`, `index.html:5336`). For M6 it prints `[likely, disputed] … SHCS head Ø10 × 6 mm, key 5 mm, counterbore Ø11`. `cbore_d_mm` is recall on all 12 rows, and the doctrine says a likely line becomes `tol_src: "source"` (`index.html:1454`). The line also gives the plain-head dk 10, which `columns.shcs_head_d_mm` says never to size a counterbore from, and not the knurled 10.22. The copy of the table embedded in `index.html` does keep `field_confidence` (I checked by evaluating the embedded literal; no test pins this), so the per-field tag is available to the code. Minor: `dbF` prints the certain D1 4.917 as 4.92 (`index.html:5328`).
2. **The doctrine's nut pocket does not take the nut.** `PROVENANCE.md:37` says "hex pockets to `nut_ac_min_mm` across corners". A regular hexagon 11.05 mm across corners is 9.570 mm across flats, 0.43 mm narrower than the M6 nut's 10.0 (s max); the same holds at all 12 sizes. The table's own column (`nut_ac_sharp_mm`) has the right rule: at least the sharp span.
3. **Two instructions on where to model a tapped hole.** `PROVENANCE.md:37`, the table's `columns.minor_D1_mm` and notes (2), and the hint line (`index.html:5328`) say model at D1. The flight doctrine says "Model tapped holes at the tap drill" (`index.html:1493`).
4. **The table's engagement fails the app's own thread check.** `PROVENANCE.md:37` says to check every tapped aluminium joint against `min_engagement_6061T6_8_8_mm` (τ = 0.6·UTS; M6 9.5 mm). PartForge's "thread" load check (`threadCheck`, `index.html:848-872`, judged `ok_strip && ok_rule` at `:5776`) uses τ = 0.5·UTS and the `ENGAGEMENT_RULE` aluminium 2.0·d (`:832`). It fails the table's figure at all 12 sizes: at M6 it needs 11.02 mm against the strip and 12 mm for the rule. A model that follows the doctrine and then declares the check fails it.
5. **The washered counterbore.** `columns.cbore_depth_flush_mm` says "Add washer_t_mm if a washer sits under the head", and the doctrine says counterbore to `cbore_d_mm`. But `cbore_d_mm` is smaller than `washer_od_mm` at 11 of 12 sizes and equal at M5. The table has no washered counterbore diameter.
6. **Nine supplementary fields have no confidence.** The table's notes (9) (`data/tables/fasteners_metric.json:1135`) say `field_confidence` "lists every supplementary field". On no row does it list `tap_drill_pct_thread`, `tap_drill_stainless_mm`, `tap_drill_stainless_pct_thread`, `us_tap_drill`, `us_clearance_drill`, `cbore_depth_flush_mm`, `din934_nut_af_mm`, `torque_guide_8_8_dry_Nm` or `min_engagement_6061T6_8_8_mm`. Three of those are fields the doctrine uses.
7. **No band for the coarse series anywhere in the app.** The clearance column texts name H14 for coarse, and `PROVENANCE.md:37` recommends coarse for hand-drilled sheet, but `fits.json` stops at IT13 (`data/tables/fits.json:10`) and withholds IT12 for 1–3 mm, so `dbFit` returns null for every coarse hole and for M2 and M2.5 fine.
8. **The FLIGHT grammar cannot express a one-sided band.** `tol_mm` is symmetric (`parseFlight` `round()`, `index.html:4698-4704`; `cmmVerdicts`, `:3849`). The shipped templates and the dry run write clearance holes as nominal ± tol, for example the motor retainer's `"M6 retention bolts","d_mm":6.40,"tol_mm":0.10` (`index.html:2314`, tool default). That accepts holes below the ISO 273 diameter. The dry run also cites ISO 273 for its ±0.100 (`tests/dryrun/retainer-fixed.scad:51-53`, `tests/dryrun/endcap.scad:43`), a tolerance the standard does not give.
9. **Hand-typed metric sizes (a tripwire, not a defect today).** `index.html:1493` still types 9 medium clearances, 5 fine clearances and 9 tap drills. All 23 agree with the table at `0974a62`; the test fails if either side changes. `docs/roadmap-evaluation.md:42` records that the UN equivalents were deleted for drifting one fit class.

Gates this has **not** been through: PartForge's geometry gate (nothing here was compiled, rendered or CMM-measured), its data provenance pipeline (`tools/db/` and `embed.mjs`), its skeptic review, and its own test runner (`tests/run.mjs`, `tests/flight-db.test.mjs`).

## Where it would land

**Repository:** PartForge (`hudsonclavin-cloud/Partforge`), in `index.html`'s DB block, as `dbHoleStack(spec)` beside `dbPickDrill()` (`index.html:5100`), with the same no-DOM, Node-testable shape as the other selectors. From there:

- `dbHints()` would print one worked "HOLE STACK" line for a request that names a metric thread, instead of the per-row line at `:5323-5336`.
- ⚙ Settings → *Look up real hardware…* and the headless `lookup` command would return it.
- The FLIGHT rows would be offered to the designer as rows to copy, provenance already decided.

**What has to change to ship it:**

- Port the kernel into the DB block's style, reading `FLIGHT_DB_DATA.fasteners_metric` (the embedded copy keeps `field_confidence`) and `FLIGHT_PROCESSES` directly.
- Move the tests into `tests/flight-db.test.mjs`, so the selector runs under `tests/run.mjs` on the shipped code.
- Decide the tapped-hole convention (finding 3), correct the doctrine's nut-pocket and engagement lines (findings 2 and 4), and tag hint lines per field (finding 1). Without that, the doctrine will still contradict the selector's output.
- Add IT14 to `fits.json` through `tools/db/derive-fits.mjs` with its two-derivation cross-check, if the coarse series should have a band.
- Pass the geometry gate on a real part that uses the module.
- Then the inch twin from `fasteners_un.json`, with its `related_hardware` recall rules.
