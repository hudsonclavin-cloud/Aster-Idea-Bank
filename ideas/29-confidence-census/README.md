# Confidence Census
> A linter that counts what PartForge's 14 reference tables (2,346 rows) say about themselves and checks the repo's two hand-written census statements against them: 56 of 69 countable claims hold, 2 in `data/README.md`'s policy column do not (the airframe vendors it calls `likely` hold 45 `recall` rows; `fasteners_un`, called `likely`, holds 4), and it lists 13 row fields no `columns` block describes, 9 tables with no date anywhere and 94 rows whose label says more than their source text.

**Kind:** linter
**For:** PartForge
**Run:** open `ideas/29-confidence-census/index.html` (classic scripts, works from `file://`, no network). Command line, from the bank root: `node ideas/29-confidence-census/census.mjs /path/to/Partforge` (Markdown summary; `--json out.json` writes the findings; exit 1 on any defect, 2 on a usage error), or `--snapshot` to run on the committed snapshots. Tests: `node --test ideas/29-confidence-census/census.test.mjs` (about 1 s) and `node ideas/29-confidence-census/ui-check.mjs` (headless Chromium, about 3 s). Rebuild the snapshots: `node ideas/29-confidence-census/build-data.mjs /path/to/Partforge`.
**Made by:** Tallyman

## What it is

PartForge keeps its reference data (airframe tubes, motors, drills, fasteners, O-rings, stock, rails, avionics, fits, materials, NASA design factors) in fourteen `data/tables/*.json` files of one shape: `{table, license_note, columns, rows: [{key, confidence, source, …}], notes, reconciliation}`. Every row carries a confidence label (`certain` / `likely` / `recall`). Two documents state the census by hand: the policy column of `data/README.md:30-45` and the "Overall confidence" line in each section of `docs/data/PROVENANCE.md`.

The Confidence Census reads the tables and both documents and reports, per table:

- **the census**: rows per label, disputed rows, the newest date in the metadata, the supplement's own labels;
- **the reconciliation**: each countable statement in the two documents (69 at `0974a62`) against the rows, as *matches*, *contradicted*, or *prose* (a statement the parser cannot count is shown, never guessed);
- **findings** `{table, key, rule, severity, detail}` in three severities: **defect** (the repo states something its own rows contradict, or a row breaks the shape `data/README.md:21-24` promises), **review** (a judgment only the maintainer can make), **info** (a census fact);
- **the disputed ledger**: every `disputed` entry, browsable by table on the page.

The page (`index.html`) recomputes all of it in the browser from the committed snapshots and says which commit they were read at, so it cannot pass for a fresh scan. The CLI (`census.mjs`) runs the same kernel on a checkout and exits 1 on any defect. It never writes to the checkout.

At `0974a62`: 182 findings, 15 defect / 134 review / 33 info.

| severity | rule | count | what |
|---|---|---:|---|
| defect | undocumented-field | 13 | `airframes` `lengths_all_mm`, `pns_all`; `motor_perf` `disputed`; ten `design_factors_nasa` fields including `ultimate_design_factor`, `yield_design_factor`, `proof_test_factor` and `note` (on all 12 rows) |
| defect | policy-mismatch | 2 | `data/README.md:32` and `:39`, below |
| review | label-vs-text | 94 | stock 44, drills 16, fasteners_un 12, npt 7, materials_thermal 7, rails 5, avionics 3 |
| review | field-weaker-than-row | 30 | drills 5, fasteners_metric 11, npt 14 (aggregated per field) |
| review | dateless | 9 | airframes, avionics, drills, fasteners_metric, fits, materials_thermal, motor_perf, npt, stock |
| review | supplement-no-key | 1 | none of the 119 `motors.supplement` rows has a `key` |
| info | disputed, inch-mm, inch-mm-undeclared, length-vs-records, supplement-census, policy-prose | 33 | 321 disputed rows in 11 tables + 5 table-level `fits` entries; two rounding-chain notes; the two motor length outliers (both already disputed); 11 prose statements |

## Why I made it

`docs/roadmap-evaluation.md:245-246` puts *the data-integrity sweep* second of "the five to build first" ("wrong numbers *shipping right now*"), and its Wrong-number risk 2 (`:284`) is "recall data printed as cited provenance", counted there as 161/291 airframe, 148/192 stock and 29/124 motor rows, with the guard "a data-date on every hint line" (`:286`). The counts in that sentence, in `data/README.md:30-45` and in `PROVENANCE.md` were all typed by hand, and nothing reconciles them: `tests/flight-db.test.mjs:14-29` ("== data integrity ==") checks ID < OD, plausible walls, the three kinds, vendor/PN presence, motor diameters and lengths, the label vocabulary for airframes and motors, duplicate motor sets and the credits; `tests/flight-db-embed.test.mjs` proves the embedded literal equals the files row by row. Neither counts labels, checks that `columns` describes every field, looks for dates, or reads a source string.

Alternatives I weighed:

- **The roadmap's own guard, a provenance state recall rows cannot promote out of.** That is an edit to PartForge's app and doctrine, which this bank may not make, and its scope is exactly what a census measures first.
- **Hard asserts added to `flight-db.test.mjs`.** They would fail on day one (15 defects) and have no way to say "review": 94 of the findings are cases where `likely` may legitimately rest on recall (`PROVENANCE.md:15` defines `likely` as matching "at least one independent published copy or three independent recalls").
- **A counts-only dashboard.** Cheaper, but it would not have caught the two contradicted statements, which are the findings most likely to mislead a reader of the docs.

A linter with three severities and a page to triage from won: the maintainer reads the review list once, agrees the severities, and only then makes the exit code strict.

**What I changed from the judged proposal** (`queue/proposals/29-confidence-census.json`), after checking every citation against the checkout:

- I also reconcile `PROVENANCE.md`'s "Overall confidence" lines. They carry most of the counts the proposal's test plan called "the README's own numbers" (drills 204/74/4 is `PROVENANCE.md:105`; `data/README.md:41` says "204 `certain`, 78 `likely`/`recall`"), and they turn out to be right where the README column is wrong.
- The proposal listed six tables for label-vs-text (89 rows). The same rule finds 94: `rails` adds 5 (four `certain` rod rows whose source says "(recall)" about real rod-stock undersize, and `lug_rod_025`, whose source says it "agrees with the compiled table's recall").
- The proposal named `AMW 75-3500` "497 against 870" as a length outlier. The rule does flag it (497 vs a two-record median of 683.5), but the table's own disputed entry says the **870** record is the error ("the AMW 98-11000 length copied by mistake") and 497 is right. Both outliers it finds (that one and `Loki|38/240`, 117 vs 177.4) are already disputed, so they are `info`; the rule finds no undisputed one.
- The proposal said O-ring tolerances "stored to 0.01 mm against 3-dp IDs" give "339 pairs" that differ only by rounding. I count 252 `id_tol` and 299 `cs_tol` rows past 0.0005 mm, all inside the 2-decimal rounding their `columns` text declares, so the census reports none.
- `findings.json` keeps one disputed line per table instead of 321 per-row lines (the page lists every entry from the snapshots); this kept the folder inside its size budget.

## How it works

**Inputs.** `data/tables/*.json`, the `data/README.md` policy table (lines 30-45) and the `PROVENANCE.md` "## N. table" headings and "**Overall confidence:**" lines, read at PartForge `0974a62`. `build-data.mjs` writes one *lint view* per table (`snapshots/views/*.js`, made by `census.js` `viewOf()`) and the two policy extracts, each with a `tools/snapshot.mjs --sidecar-only` provenance sidecar naming the source file, commit and sha256. A view keeps exactly what the rules read: every row's key, label and full source text (stored as a front-coded dictionary of its `"; "`-separated segments), its field-name set, its disputed entries and `field_confidence` (deduplicated), numeric inch/mm pair values, `*_confidence`, vendor and motor-length fields; the `columns` keys (description text kept only for inch/mm fields); the ISO dates found in each metadata block; the supplement's keys and labels. It is lossless for the rules: a test rebuilds every view from the checkout and compares bytes, and `rowsOf()` restores keys, labels, sources, field sets and disputed entries exactly (a fixture test with `"; "`, `|`, empty and missing sources).

**Rules.**

| rule | severity | fires when | expectation from |
|---|---|---|---|
| key-missing, key-duplicate, confidence-invalid, source-missing | defect | a row lacks a key or source, shares a key, or has a label outside the three | `data/README.md:22-23` |
| undocumented-field / no-columns | defect | a row carries a field `columns` does not name | `data/README.md:22` |
| no-license-note | defect | no `license_note` text | `data/README.md:21-22` |
| policy-mismatch | defect | a parsed statement disagrees with the counted rows | the statement itself |
| label-vs-text | review | label `certain`/`likely` and the source matches `\b(recall(ed)?\|from memory)\b`; quotes the words | `PROVENANCE.md:15` |
| field-weaker-than-row | review | a `field_confidence` entry, table-level `field_confidence` or `*_confidence` field is weaker than its row's label; one finding per field | `PROVENANCE.md:17`: row confidence "is always the weakest load-bearing field" |
| dateless | review | no `YYYY-MM-DD` in any non-row block (edition years such as `B94.11M-1993` do not count) | roadmap `:286` |
| inch-mm | review / info | \|in × 25.4 − mm\| exceeds the rounding the two `columns` texts declare | each pair's own `columns` text |
| length-vs-records | review / info | \|`len_mm` − median(`len_variants`)\| > 20 % of the median; info if already disputed | roadmap `:246` (c) |
| supplement-no-key | review | supplement rows without a key | |
| disputed, unused-column, inch-mm-undeclared, supplement-census, policy-prose | info | census facts | |

The inch/mm budget is half a unit in each declared last place: 0.5·10⁻ᴺ mm for an mm column declaring N decimals plus 25.4·0.5·10⁻ᴺ mm for an inch column declaring N ("3 dp", "to 3 decimals", "rounded to 4 places"). A pair beyond the budget but within one full unit (twice it) is what a chain of roundings produces and is `info`; beyond that, one side was probably edited alone, `review`. A pair with no declaration on either side is listed, never judged. The 20 % length threshold is the proposal's screening choice, not a standard.

**The policy parsers** are pinned by tests to the current documents. In `data/README.md` a cell beginning with a label is a whole-table claim; "N `label`" (N opening the cell or a clause, so "Table 1 values `certain`" is not a count of 1), "N rows flagged `disputed`" and "N values … withheld" are counts; "*names* rows `label`" where every name prefixes a `vendor` value is a vendor claim; the rows cell gives rows, "(N current)", "+ N supplement" or "N steps + N fits". "(103 current)" is counted with `current_upstream_main > 0`, as `motors.json`'s notes (item 7) say to; the stale `current` field gives 100, and the page says so. In `PROVENANCE.md`, "`label` (N rows)", "(all N rows)", "+ \`key\`" inside the brackets, "`label` 0", "No row is `label`" and "`label` for \`k1\`, \`k2\`" are read. Anything else with a label or a clause-opening number is *prose*. A missing header is "could not reconcile" (info), never a defect.

**Outputs.** `findings.json` (meta with each input's path and sha256, summary, census, reconciliation, findings; deterministic, one record per line), the Markdown summary (`example.txt` is the run on the checkout) and the page.

## Tests

`census.test.mjs`, 20 tests (node:test), all passing:

- **Every rule fires on a planted fixture and is silent on a clean one**: a missing source, a missing and a duplicate key, the label `verified` (counted as *other*, never as one of the three), "(recall)", "from memory" and "(recalled)" under `certain`/`likely` (and "Recallibrated" not), an undocumented `ultimate_design_factor`, an unused column, no licence, no date (an edition year left in the notes), an inch value edited by 0.5 mm (review), a 0.0009 mm rounding step (info), the motors shape 117 mm ↔ 4.606 in (silent) and 4.616 in (review), the Loki 117-vs-[117, 177, 177.8, 190] row (review, then info once disputed), a row within 20 % (silent), a field weaker and a field stronger than its row, supplements without keys.
- **Pins to what PartForge publishes about itself**, each with its file:line and a check that the snapshot text says it: drills 204/74/4 (`PROVENANCE.md:105`), airframes 161 recall (`:195`), stock 148 recall (`:123`), motor_perf 162 recall (`data/README.md:36`), avionics 19 recall (`PROVENANCE.md:159`), motors 29 recall (`:177`), orings 289 likely (`data/README.md:37`); 2,346 rows in all; exactly two contradicted statements (`data/README.md:32`, `:39`) and none in `PROVENANCE.md`; 56/2/11; the parser's claims for motor_perf, drills, fits, motors, npt and rails (including `5 vendor buttons + \`lug_rod_025\`` = 6).
- **The proposal's findings re-counted**: the three undocumented-field lists, the nine dateless tables by name, label-vs-text per table, disputed rows per table, both supplements, both outliers.
- **Reproducibility**: `findings.json` equals a fresh run on the snapshots byte for byte; with a PartForge checkout whose tables have the snapshot's sha256 (here, `/home/user/Partforge` or `$PARTFORGE_DIR`), every view and policy extract equals a fresh build and the checkout run equals `findings.json` (otherwise this one test skips and says why); the CLI exits 1 on the snapshot, 0 on a clean one-table checkout, 1 on a bad label, 2 on usage errors.

**Teeth.** I applied 15 sabotages to `census.js` one at a time and ran the suite; every one failed at least one test: dropping "recalled" from the text rule (6 tests fail), 20 % → 10 % (5), flipping the field-weaker comparison (5), 25.4 → 2.54 in the inch budget (5), counting any year as a date (3), dropping the clause-start guard so "Table 1" counts (6), vendor match by equality instead of prefix (5), front coding off by one (7), unknown labels counted as recall (1), losing disputed entries in the view (8), skipping undocumented fields on fewer than ten rows (6), reporting a contradiction as prose (4), counting "current" with the stale field (5), ignoring "+ \`key\`" (6), exit 0 with defects (4).

`ui-check.mjs`, 37 checks in headless Chromium: the severity chips, all 14 census rows and the nine "none" dates equal the kernel's; the two contradicted cites; "All" lists 69; filters (stock × label-vs-text = 44; search finds `ultimate_design_factor`; an empty result says so); Space and Enter toggle a filter from the keyboard; the ledger (airframes 169 rows, fits 5 table-level, motors 53 rows / 60 entries); no overflow at 1280 and 390 px; dark mode; tap; no console errors or network requests; and with the views blocked the page refuses, names what is missing and shows no number.

## Honest assessment

What works:

- [Certain] The census numbers are counted from the rows and agree with every count `PROVENANCE.md` states for its ten tables (all its countable claims match).
- [Certain] The two contradictions are real readings of the current text: `data/README.md:32` says "Madcow/Blue Tube/PML/Estes `likely`" and 45 of their 175 rows are `recall` (40 of them disputed; `PROVENANCE.md:195` lists them as carbon, kraft couplers, glassed phenolic, centering rings and disputed rows); `data/README.md:39` says "`likely`" for `fasteners_un` and `#2-56`, `#12-24`, `1/2-13`, `1/2-20` are `recall`, as `PROVENANCE.md:51-53` says.
- [Certain] The 13 undocumented fields, 9 dateless tables and 119 keyless supplement rows are mechanical facts of the files at `0974a62`.
- [Likely] The review classes are the right posture: many label-vs-text hits are deliberate (`npt`'s "(recall)" is about the standard's edition and the rule-of-thumb columns; the four rods are `certain` by definition and their "(recall)" is about rod stock), so they are a list to read, not errors.

What is rough:

- [Certain] The policy parsers are pinned to today's wording. A reworded cell becomes *prose* (reported, never miscounted), but it stops being checked. 11 of the 69 statements are prose already, and three of those are wrong when checked by hand (below).
- [Certain] label-vs-text is a word match on the source string; it cannot tell which field a "(recall)" is about.
- [Likely] field-weaker-than-row cannot know what is "load-bearing" (`PROVENANCE.md:17`'s word): DIN 338 jobber lengths are `recall` on every `certain` drill row, which is probably fine for a diameter lookup.
- [Certain] The date rule only knows ISO dates in table metadata; `motor_perf`'s per-row `updated` (an upstream record date) is mentioned, not counted.
- [Certain] `orings_as568.supplement` is an object (gland data, project issues), not rows, so it has no supplement census.
- [Speculative] The severities are mine. A maintainer may well call undocumented fields `review`.

**Findings about the source repo** (PartForge at `0974a62`; reported, not fixed):

1. `data/README.md:32`: "Madcow/Blue Tube/PML/Estes `likely`" — 45 of those vendors' 175 airframe rows are `recall` (Madcow 22, Blue Tube 16, PML 7). `PROVENANCE.md:195` has it right.
2. `data/README.md:39`: `fasteners_un` "`likely`" — 4 of 16 rows are `recall`; `PROVENANCE.md:51` has it right.
3. Checked by hand, not by the parser: `data/README.md:43` says "vendor buttons `recall`" but all five `button_*` rows are `likely` (as `PROVENANCE.md:141` says); `:40` says "Table 1 values `certain`" but the table's own `field_confidence` and `PROVENANCE.md:87` put L1, L2, L4, L5, E0–E2 and K0 (Table 1 columns) at `likely`; `:33` says "ThrustCurve data `likely`" while 29 of 124 motor rows are `recall` (`PROVENANCE.md:177`).
4. Undocumented row fields: `airframes.json` `lengths_all_mm` (9 rows), `pns_all` (7); `motor_perf.json` `disputed` (7); `design_factors_nasa.json` `ultimate_design_factor`, `yield_design_factor`, `proof_test_factor`, `qualification_test_factor`, `service_life_factor`, `coefficient_of_friction_max`, `preload_uncertainty`, `protrusion_min_pitches`, `verification_approach`, `note` — the table's numbers live in fields its `columns` never describes.
5. Nine tables carry no date in any metadata block (list above), against the roadmap guard at `docs/roadmap-evaluation.md:286`.
6. None of the 119 `motors.json` supplement rows has a `key`, so a supplement row cannot be addressed; 30 of them are `recall`, 88 `likely`, 1 `certain`.
7. `docs/roadmap-evaluation.md:246` (c) says "quarantine the 29 recall motor **supplement** rows"; the 29 recall rows are in `motors.rows` (`PROVENANCE.md:177`, and `:284` says "29/124 motor rows"); the supplement has 30. [Likely] a wording slip; the evaluation predates the October edits (`680546e`).
8. 94 rows labelled `certain`/`likely` whose source text says recall, and 30 field-level labels weaker than their row: the review lists on the page.
9. No inch/mm pair disagrees by more than one unit of its declared last place; the largest gap in a pair with no declared rounding is 0.0122 mm (`rails` `pocket_depth`). The two rounding-chain notes: `airframes` `wall_in` is declared "4 dp" but is computed from 3-dp `od_in`/`id_in` (14 rows past the 4-dp budget, worst 0.0024 mm), and `stock` `id_nominal_mm` (33 rows, worst 0.001 mm).

Gates this has **not** been through: PartForge's data provenance pipeline and its three-skeptic review; it is not run by `tests/run.mjs`; no maintainer has agreed the rules or severities. The geometry gate does not apply. It is an idea-bank prototype.

## Where it would land

PartForge, as `tools/db/lint.mjs`: `census.js` unchanged (it reads plain table objects; the lint views exist only to keep this folder small), with `checkout.mjs`'s loader, run from `tests/run.mjs` after `tests/flight-db-embed.test.mjs`. The report would join ⚙ Settings → *Data sources…* or ship as `docs/data/census.html`, and the policy column of `data/README.md` could be generated from the census instead of typed. To ship for real: agree the rules and severities in `data/README.md`; fix or accept the 15 defects (describe 13 fields, correct two policy cells); triage the review lists once and record the accepted ones, so the exit code can be made strict; put a date in every table's `reconciliation` block so the roadmap's data-date guard has something to print.
