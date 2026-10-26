# Rule One
> A canon-drift scanner for Skyhook: it checks the numbers its rules attribute to Rev A quantities in the repository's prose, HTML, JSX, JS and Python against `params/rev_a.json`, classes each hit by `docs/DEVIATIONS.md`, and prints a quote card so the next number is cited, not remembered. At `34935cb` it finds 12 NEW drifts (a JSX simulator reading a key the canon file does not have, SK99 at 3.9 GPa, a 0.6/0.72/0.85 ladder, "our 100–200× planning range", a banner that gives 10.05 km/s and 41×/65×/123× as the reference), and its self-check reproduces idea 01's finding that `rev_a.json` mixes two Earth radii: of its 42 derived values, 3 fail under one radius and 7 under the other.

**Kind:** linter
**For:** Skyhook
**Run:** from the bank root, `python3 ideas/04-rule-one/lint_canon.py /path/to/skyhook` (Markdown report on stdout; exit 1 when there is a NEW finding, 2 for unreadable inputs or a canon that lacks a key the rules read; `--format json`, `--verbose`, `--verify-canon`, `--rules`, `--label-coverage`). Quote card: `python3 ideas/04-rule-one/lint_canon.py --cite kinematics.v_tip_kms --params ideas/04-rule-one/snapshots/rev_a.json`. The saved run against the checkout is `example.txt` (`lint_canon.py /home/user/skyhook --verify-canon`); `index.html` shows the same run with filters, every quote card and the canon self-check (plain classic scripts, works from `file://`). Tests: `python3 -m unittest discover -s ideas/04-rule-one -p 'test_*.py'` (Python 3 standard library, 56 tests, about 10 s) and `node ideas/04-rule-one/ui-check.mjs` (headless Chromium through the globally installed Playwright, 38 checks).
**Made by:** Plumbline

## What it is

Skyhook's Rule 1 is that every tether number comes from `params/rev_a.json`, never from memory, and the program's own handoff records two errors that came from breaking it. Nothing in the repository enforces the rule where numbers actually get written: the founding document, the glossary, the FAQ, the program site's HTML, the React simulators, the finance notes. `lint_canon.py` walks a checkout and does four things:

1. **Quantity rules.** Every number that carries a unit (GPa, kg/m³, km/s, km, g, min, km²/s², ×, $/kg, $M, t) is attributed to the nearest keyword on its line, counted in tokens. If that keyword names a canonical quantity ("SK99", "mass ratio", "apogee", "lower tip", "Falcon 9" …) the number is compared, rounding-aware, with the `rev_a.json` keys the rule lists. If it names a quantity the repository legitimately states that is not canon (payload, Δv, exhaust velocity, perigee, prices, moduli: the *sinks*), the number is left alone. Assignments in code (`VTIP=3.5`, `sigma: 3.9e9`, `L=320`) are attributed directly.
2. **Tiers.** Every allowed value carries the tier its key path names: the reference, the cislunar revenue-gated option, the Phase 3 growth option, the 0/15/30 % derate rungs, a market threshold, or HASTOL heritage. A number that is canon only for a tier its own clause does not name is a `tier` finding. "295× at the 2.5 km/s reference" is one (295.27 is the cislunar figure), and so is "the Rev A reference tip acceleration is 3.9 g" (3.9 g is Phase 3's). A clause that names no tier is read as the reference. A threshold value needs threshold words in its clause, and a heritage value needs HASTOL (or Boeing, Tethers Unlimited) on its line or in its wide window.
3. **Stale patterns.** "3.5 km/s" with no Phase-3 label within reach; "440×" with no unsourced/historical label; "100–200×" in any spelling; a Conservative / Baseline / Optimistic ladder whose derate or retention rungs are not the tier's own `rev_a.json` value.
4. **Schema drift.** Parameter paths in code (`revA.a.b`, `PARAMS["a"]["b"]`, `["a", "b"]` pairs) and dotted keys quoted in prose after "rev_a.json" are resolved against the JSON. A path that does not exist is reported together with the keys that do.

Each hit is classed from the deviations register:

- **ACCEPTED**: the row's disposition starts with *Leave* for that file, a deviation that states itself.
- **KNOWN OPEN**: tracked in the register, not marked EXECUTED.
- **NEW**: untracked, or in a row marked EXECUTED for that file, which makes it a regression.
- **LABELLED**: a quantity mismatch that carries a self-label. That is either a strong marker in its wide window or section heading (*Phase 3*, *historical*, *superseded*, *unsourced*, *HASTOL*, *SF 5* …) or a near marker in its own clause (*corrected from*, *earlier*, *sensitivity* …). LABELLED findings are shown but never fail the run.

Only NEW sets the exit code. `--cite <key>` prints a Markdown quote card: the value, the notes beside it in the file, their confidence labels, the file, its commit and the sha256 of its bytes. `--verify-canon` recomputes every derived value in `rev_a.json` from the file's own inputs, under two Earth radii. That is 42 of the file's 66 numeric keys. The other 24 are 11 inputs and 13 stated figures such as prices and heritage, and a test checks that the three lists cover the file.

The report at `34935cb` (`example.txt`, 65 files):

| class | count | what |
|---|---|---|
| NEW | 12 | `tools/sims/skyhook_no_leo_stress_test.jsx:48` reads `revA.mass_ratio.tether_to_payload_single_arm_range`, a key `rev_a.json` does not have, so the simulator throws on load (finding 1); `tools/sims/skyhook_calculator.jsx:11` SK99 `sigma: 3.9e9` against 3.6 and `:20-22` ladder `derate: 0.6 / 0.72 / 0.85` against 0.30/0.15/0, the untracked twin of DEVIATIONS #8 (2); `docs/glossary.md:27` "our 100–200× planning range" (3); `tools/sims/skyhook_program_site.html:219` "lower tip grazes ~100–150 km" against 290 (4); `docs/objections_faq.md:38` "A 600 km structure" against 2L = 640 (5); `docs/program_manifest.md:6`, the 25 August banner's "Reference numbers" 10.05 km/s and ~41× (65×/123×) against 10.06 and 40.32 / 64.30 / 121.83, four findings (6) |
| KNOWN OPEN | 3 | `skyhook_program_site.html:1135` `LAD` rungs `.6 / .72 / .85`, DEVIATIONS #8 |
| ACCEPTED | 4 | `docs/original_README.md:6` (#1), `docs/project_instructions.md:31` "say, 3.5 km/s" and `:126` "1-second timing error at 3.5 km/s" (#5), `skyhook_orbit_theater.html:39` `VTIP=3.5` (#4) |
| LABELLED | 20 | among them the SF ≈ 5 hypotheticals (`docs/DECISION_LOG.md:72`, `docs/program_manifest.md:65`, `docs/research/mp001_market_pricing.md:46`), each of which also gives the SF 2.5 mass ratio as "~41×"; HASTOL's own figures; `tests/test_rev_a_physics.py:167-168`'s SF 2.0/3.0 sensitivity bracket; `finance/DEMAND_SENSITIVITY_FINDINGS.md:24`'s "earlier $3,364/kg" |
| skipped | 62 | labelled pattern mentions ("the 3.5 km/s Phase 3 growth option" and the like), listed with `--verbose` |
| tier | 0 | no number in the checkout is a value of a tier its clause does not name |

The self-check at the end of `example.txt` runs both Earth radii. Under R_E = 6371 km (the file's notes, `physics/skyhook_physics.py:40`) 39 of the 42 derived values reproduce; under 6378 km (what `com_radius_km` 6988 − 610 implies) 35 do. No single radius reproduces the file (finding 8).

Not flagged, on purpose: the calculator's `launch: 2500 / 1500 / 800`, which is the financial workbook's "Launch price during construction ($/kg)" ladder (`tools/financial/skyhook_financial_model.xlsx`, Assumptions sheet), not a `rev_a.json` quantity.

## Why I made it

The open items this serves, with where they are written down:

- `handoff.md:21` "Two errors found & fixed this session (both from quoting canon by memory)" and `handoff.md:24` "Lesson: tether numbers come from `params/rev_a.json`, never from memory". `handoff.md:35`, open item 6, says the founding-doc worked example and the teaser/deck/FAQ "still carry old canon".
- `docs/DEVIATIONS.md:14` item 8: "Align to rev_a.json's canonical factors (0.70 / 0.85 / 1.00) in a future calculator pass. Not fixed here." The register is kept by hand and nothing re-checks it.
- `CLAUDE.md:20` rule 2, "Never hardcode a physics parameter", which the two `.jsx` simulators break in opposite ways: one hardcodes, the other imports a key that does not exist.
- The bank's `BRIEFING.md` §4 (line 109): "Linting tools that catch canon drift, literal labels and provenance gaps are wanted everywhere and exist nowhere."

What already exists, and why it is not this:

- `tests/test_rev_a_physics.py` checks `rev_a.json` against the physics module.
- `tests/test_finance.py` checks the workbook's derate ladder against it.
- `tests/test_export_grid.py` checks the grid's provenance hashes.
- `tools/twin/params-loader.js` validates eight required keys at runtime, for the twin only.

None of them reads prose, HTML or JSX, and none resolves a JavaScript property path against the JSON. That gap is how the stress-test simulator's bug survives in a repository whose CI is green.

Alternatives I weighed:

- **(a) A pure regex grep** for the known stale strings (3.9, 0.72, 440, 100–200). It catches the strings someone already knows about and nothing tomorrow, and it cannot say *why* a number is wrong.
- **(b) A JSON-schema contract for `rev_a.json` consumers.** It catches the missing key but says nothing about prose. The consumers also share no schema:
  - two Python modules parse the file, `physics/skyhook_physics.py:29-36` (`load_params`) and `finance/leg_cost.py:63-64` (`load_rev_a`);
  - `finance/export_grid.py` hashes it;
  - `tests/test_finance_tiers.py:38-44` opens it directly;
  - three JavaScript consumers read it: `tools/twin/params-loader.js` for the browser twin, `tools/twin/verify.mjs`, and the stress-test JSX by `import`.
- **(c) Keeping `DEVIATIONS.md` better by hand.** That is the current state, and item 8 has said "not fixed here" since 2026-07-06.
- **(d) This tool**, which I chose: a rule table keyed to `rev_a.json`'s own keys, with the register as the allow-list, so the maintainer's existing habit (write a row) is what silences a finding. The quote card is the other half. A finding tells you a number is wrong; the card gives you the right one with its provenance so you do not retype it.

## How it works

**The canon.** `rev_a.json` is flattened to dotted paths (`materials.alternative_fibers.Dyneema_SK99_GPa`, with list items as `[i]`). Numeric leaves whose names do not start with `_` are the checkable values: 66 of them (`--list-keys`). Units come from the key suffixes the file already uses (`_kms`, `_km`, `_GPa`, `_kgm3`, `_g`, `_min`, `_kms2`, `_kgs`, `_M`, `_t`). Some allowed values are not keys. They are derived in the open and named as such in the report:

- total length 2L = 640 km;
- the inertial lower-tip speed, both as `v_orb_kms − v_tip_kms` = 5.05 and as `v_upper_release_kms − 2 v_tip` = 5.06 (the file supports both; see finding 8);
- the retention `1 − derate` for each rung;
- the per-tier rungs, read off the key names `conservative_30pct_derate`, `baseline_15pct_derate` and `optimistic_0pct_derate`.

**Rounding rule** [Certain, `rounds_to`]. A literal matches canon when canon, rounded to the lesser of the two precisions, equals it. So 122×, 121.8×, 121.83× and 121.826× all match 121.83. An integer ending in zeros is read at the precision of its last non-zero digit, so 85,200 km matches 85,222. Two caps keep this honest:

- The tolerance may never exceed 5 % of canon, so "SF 3" is not 2.5, "41×" is not 40.32 and "10.05" is not 10.06.
- The trailing-zero rule may never hide more than 3 %, so "600 km" is not 640, but "~600 t" matches 609.1 and "~3,000×" matches 3085.95.

Some smaller rules complete it:

- Fraction rules read a round rung at two decimals, so 0.4 is not a derate of 0.
- A range (40–122×, 2.7–2.8 km/s, $10–30M) passes when it brackets a canonical value.
- A number preceded by a comparison (≤, <, below, at most, up to …) is a bound, not a claim.
- A number is an expression, not the quantity, when the gap to its keyword holds an operator, an `@`, or another number with words around it (`v_orb + v_tip ≈ 10.06`, `fiber @ 5 t`, `sits at 0.92 V_c`). Markdown bold in that gap is emphasis, not an operator. A bare value list (`~41× (65×/123×`) is not an expression.

**Attribution** [Likely]. For each unit-bearing number, the scanner looks 100 characters back and 80 forward on the same line for every rule keyword and every sink. It measures the distance in whitespace tokens and gives the number to the nearest one. Ties go to the keyword before the number, then to the rule stated in the number's unit. A keyword more than 8 tokens away does not count, and if the winner is a sink, or a rule stated in a different unit, nothing is checked.

Three kinds of keyword are skipped:

- an operand, as in `v_orb − v_tip`;
- a keyword inside a parenthetical that closes before the number. In "(tip-speed convention) to ~3.0 km/s" the number is the Δv from the line above.
- a keyword after the number that is itself followed by a number. In "2.5 km/s reference — release 10.06", *release* names the 10.06, not the 2.5.

A rule can also give way to a more specific one within reach. "Each arm is 300 km long" is checked against L = 320, not against 2L = 640.

**Tiers** [Likely]. A number's clause is the text between the nearest ". " or ";" on its line, with the number itself left out. The clause's words decide its tier and rung:

- **Reference:** *reference*.
- **Cislunar option:** *cislunar*, *TLI*, *revenue-gated*.
- **Phase 3 option:** *Phase 3*, *growth option*, *Mars*.
- **Any tier:** that tier's own tip speed written as a speed. The 2.5, 2.8 and 3.5 km/s are read from the file, and a speed inside a range names nothing.
- **Rungs:** *optimistic* / 0 %, *baseline* / 15 %, *conservative* / 30 %.

Exceptions:

- A negated mention ("not cislunar", "not a cislunar throw") names nothing.
- The Markdown heading counts only when the clause names no tier or rung.

The value then has to fit what the clause names. With no tier words, it has to be a reference value. A market threshold (2.1, 2.8, 2.9, 3.3, 3.5 km/s) needs a threshold word such as *threshold*, *reach*, *escape*, *GTO* or *class*. HASTOL's 10× needs HASTOL (or Boeing, Tethers Unlimited) on the line or in the wide window. A match outside its context is a `tier` finding when the value belongs to another tier. When only a threshold or heritage value matched, it is reported under the quantity's own rule with that explanation; "the rotor spins at 3 km/s" rounds only to the 2.9 km/s escape threshold.

**Self-labels** [Likely]. The labels come in three strengths:

- **Strong markers** are read in the wide window (200 characters back and 120 forward, spilling into the neighbouring lines) and in the section heading: *Phase 1/2/3*, *by phase*, *lariat*, *pathfinder*, *growth option*, *HASTOL*, *historical*, *unsourced*, *superseded*, *retired*, *retracted*, *archival*, *pre-reconciliation*, *previously*, *formerly*, *no longer*, *purged*, *hypothetical*, *SF ≥ 3*, *MXER*, *draft*.
- **Near markers** count only inside the number's own clause, and at most 80 characters before or 60 after it: *corrected*/*correction*, *erratum*, *wrong*, *earlier*, *old*, *stale*, *legacy*, *sensitivity*, *bracket*, *sweep*, `_low`/`_high`, *slider*, *illustrative*, *say,*.
- **Weak words** (*was*, *had*, *range*, *option*, *audit*, *convention*, *Mars*, *escape*, *threshold*, *supersedes* …) still excuse a stale-pattern hit, because "the 3.5 km/s Mars-class option" is self-labelled, but they never make a quantity mismatch LABELLED.

A tier finding is not excused by the tier's own name ("Phase 3"). `--label-coverage` measures how much this excuses. Of the 891 Markdown lines that carry a number, in files the quantity rules run on, a mismatch at the first number would be LABELLED on 138 (15 %). The full vocabulary, which still excuses patterns, would cover 288 (32 %). Before this revision the quantity rules used the full vocabulary, which covered 385 of all 1,051 numbered Markdown lines (37 %). The review measured that figure, and I reproduced it.

**Classes** [Certain for the matching, Likely for the wording]. `DEVIATIONS.md` is parsed by its table rows. The parser reads:

- the backticked paths in the location column;
- the `"…"` and `` `…` `` snippets that carry a number. An elided tail is kept as a prefix, so "meet our launch vehicle at, say, 3.5 km/s slower…" still matches.
- the numbers named;
- the disposition.

A row is Leave only when its disposition *starts* with Leave. Row 3's "Change default to 2.5 …, or leave untouched if Hudson prefers … EXECUTED" is therefore fixed: an un-chosen "or leave" no longer silences a regression. A row that does not start with Leave is fixed if it says EXECUTED and open otherwise.

A Leave-first row is split by file. A later clause that names one of its files, by a distinctive word of the file name, gives that file the action's state; quoted text and parentheticals are ignored. So row 7 is Leave for `docs/original_README.md` and fixed for `skyhook_program_site.html`, and row 1, whose executed action is a header note that leaves the 3.5 km/s content in place, stays Leave. At `34935cb` the header reads: "marked EXECUTED: #1, #2, #3, #6, #7, #9; disposition starts with Leave: #1, #4, #5, #7; neither: #8. Read per file as 4 Leave, 5 fixed, 1 open."

A finding still matching the snippet of a row that is fixed for its file goes back to NEW with "Regression: DEVIATIONS #n is marked EXECUTED for this file". A row with snippets matches a finding by snippet on the finding's line. A row without snippets matches by value; item 8 quotes `{d:.6,...}` with an ellipsis.

Files that declare, near the top, that they run on `params/service_mxer_draft.json` (the DRAFT in-space set) are scanned for patterns and schema only, and the report header names them. Three files are skipped because quoting the wrong numbers is their job: `params/rev_a.json`, `docs/DEVIATIONS.md` and `docs/verification_memo.md`.

**Refusals** (exit 2). The tool refuses rather than half-checking in these cases:

- no canon file, or one that is not JSON;
- a canon that lacks any of the 63 paths the rules and the self-check read. `--rules` lists them, and the message reads "rev_a.json lacks kinematics.phase3_growth_option.…; the rule table needs updating". A schema change therefore cannot look like ordinary drift (exit 1) or end in a traceback.
- an explicitly named `--deviations` file that cannot be read;
- canon values that make the self-check undefined, such as a density of 0.

Only the default register path may be absent; the report then says "Allow-list: none".

**Quote card.** For a key, the card collects:

- the notes in the same object whose name shares a token with the key or whose text mentions its stem (`v_tip_kms` gets `_lower_tip_note` and `_tip_accel_note`);
- their `[Certain]/[Likely]/[Speculative]` or "; Certain" labels;
- the provenance: the snapshot's sidecar commit when the file is a snapshot, else the checkout's HEAD if git tracks the file.

The sha256 is taken over the file's bytes, so a CRLF checkout prints its own hash. A snapshot never borrows the commit of the repository it was copied into. Git is called with `GIT_OPTIONAL_LOCKS=0`, so `git status` does not rewrite the checkout's index.

**Canon self-check** [Certain]. `--verify-canon` recomputes every value in `DERIVED_KEYS` from the file's σ, ρ, SF, tip speeds, altitude, half-length, μ and payload:

- V_c = √(2σ/ρ) and specific strength σ/ρ;
- the CoM radius and v_orb;
- the lower-tip altitude and rotation period;
- for each tier: release, ground-relative catch, tip g, C3 at the upper-tip radius and, when bound, apogee;
- the seven integrated mass ratios by EQ-6 (Moravec/Forward, `2√π·x·eˣ²·erf(x)`, `x = (V_t/V_c)√(SF/(1−derate))`, with `math.erf` and the derate read off the key name) and their fiber masses;
- the two copies of SF and v_tip;
- `tip_speed_to_Vc_ratio`;
- the six market thresholds: GTO as the tip speed whose apogee is GEO altitude, TLI as apogee at the mean lunar distance, escape at C3 = 0, and Mars-class at C3 = 8 and 13 from the key name.

A value written to d decimals agrees when it is the computed value rounded to d decimals. Each row is computed twice: with R_E = 6371 km, the radius of the notes' "r = R_E + 610 + 320 = 7301 km" and of `physics/skyhook_physics.py:40`, and with the R_E that `com_radius_km` implies (6988 − 610 = 6378 km). Five constants are not in the file, and the tool declares them: R_E 6371 km, the sidereal day 86164.0905 s (which gives the 0.465 km/s equatorial speed the notes use), g₀ 9.80665 m/s², GEO altitude 35,786 km and the mean lunar distance 384,400 km. All seven mass ratios reproduce to two decimals with the *exact* V_c of 2.7269 km/s; the rounded 2.73 gives 120.84, not 121.83. The two-radii result is idea 01's (Tip Match, F1/F2); this is an independent reproduction, extended to every derived key.

**Data.** `snapshots/rev_a.json` and `snapshots/DEVIATIONS.md` are whole copies made with the bank's `snapshot.mjs`, as are two fixtures (`skyhook_calculator.jsx`, `glossary.md`). The other seven fixtures under `snapshots/fixtures/` are excerpts derived by `build_data.py`. The listed line ranges are copied verbatim and every other line is left empty, so a finding at `snapshots/fixtures/tools/sims/skyhook_program_site.html:1135` is the repository's own `file:line`. Each excerpt carries a `--sidecar-only` provenance sidecar naming the ranges and the commit. `example.txt` is the live run against `/home/user/skyhook`. `page-data.js` is the same run, written by `--emit-page-data` for the page, which computes nothing itself; to keep the folder small it stores the 66 quote cards as one table of distinct lines (the page joins each card's lines) and leaves out fields the page does not show, which `--format json` keeps. Findings carry the exact source text they matched and an excerpt centred on it; a line longer than 220 characters is shown as 100 characters either side with ellipses.

## Tests

`test_lint.py` has 56 tests and runs in about 10 s.

- **The rounding rule** (4 tests). Eighteen literals that are fair roundings and twelve that are not; the scales (3.9e9 Pa, 30 %, 2500 m/s); the two-decimal floor (0.4 is not a derate of 0, which the 5 % cap alone cannot say for a canon of zero); and the range rule.
- **Canon reconciliation** (6), pinned outside this code:
  - EQ-6 from the snapshot's σ, ρ, SF and tip speeds reproduces the published 40.32 / 64.30 / 121.83 / 295.27 / 3085.95 to two decimals, and only with the exact V_c.
  - The inputs, derived values and stated figures (11 / 42 / 13) are disjoint and together are exactly the file's 66 numeric keys.
  - Under 6371 km exactly `com_radius_km`, `v_orb_kms` and the Phase 3 release disagree. Under 6378 km exactly seven disagree, and no key fails under both radii.
  - The escape threshold is worked by hand in the test from μ and the two radii (2.8931 km/s).
  - The landing fix (com_radius_km 6981, v_orb_kms 7.56, Phase 3 release 11.06) makes all 42 rows reproduce under both columns, and com_radius_km alone leaves two failing.
- **Planted drift** (12). Each case is caught with the right rule, class and canonical key:
  - SK99 at 3.9 GPa, in prose and as `sigma: 3.9e9`; retention 0.72; a three-rung ladder, checked per tier; bare 440×; 100–200× in two spellings; 3.5 km/s unlabelled, in prose and as `VTIP=3.5`.
  - a missing `revA.mass_ratio.nope_key`, a `PARAMS["kinematics"]["v_tip"]` and a `["materials", "sigma_GPa"]` pair, each with the real sibling keys named.
  - wrong Zylon strength and density, apogee, dedicated launch price, TSS-1R length, rotation period and release speed.
  - the six tier-confusion sentences from review round 1, plus "The tip acceleration is 3.9 g." with no tier word. Each must give `tier` findings whose canon is the named tier's value (121.83, 1.99, 121.83, −8.06, 3085.95, 1.99, one each; the release-and-apogee sentence gives two, 10.06 and 85,222).
  - "spins at 3 km/s" (threshold only), "~10× its payload" with no HASTOL, and "Each arm is 300 km long" against L = 320.
  - three sentences where only a weak word ("was", "audit", a "## Sensitivity" heading) sits near a wrong number, and one where "correction" sits in another clause. All four must be NEW.
  - regressions against executed rows: `value="3.5"` in the program site (#2); a calculator `useState(3.5)` (#3, the row whose "or leave" used to make it Leave); an "EQ 1–5" line in the program site (#7, fixed there), while an "EQ 1–5" line in `original_README.md` stays ACCEPTED #7.
  - `VTIP=3.5` in the orbit theater classed ACCEPTED #4, and the `LAD` ladder classed KNOWN OPEN #8.
- **Acceptable silence** (7):
  - roundings of canon; labelled options; bounds; expressions; sinks;
  - the inertial 5.05/5.06 km/s lower-tip speed;
  - the workbook's old 2.0/2.8/3.5 ladder described in the past tense;
  - tier words that fit, including a negated "not a cislunar throw";
  - keywords that name another number (`v_release = 10.06`, "**2.5 km/s reference** — release 10.06", "(tip-speed convention) to ~3.0 km/s");
  - a file that declares the MXER draft set (patterns only) against one that merely mentions MXER (scanned).
- **Labels** (3). The 25 August banner's 10.05 km/s and 41×/65×/123× come out NEW. "Dyneema SK99 (corrected from 3.9 GPa …)" and "the earlier $3,364/kg" come out LABELLED, and the same price without "earlier" comes out NEW. A "### Phase 2 pathfinder" heading labels the number under it. "SF ≈ 5 … ~41× to ~800×" is LABELLED.
- **The register** (2). Nine rows with the expected per-row and per-file states (row 7 split, row 3 fixed); the EXECUTED and Leave-first lists; row 8's paths and 0.60/0.72/0.85; row 5's "say, 3.5 km/s" snippet; row 4's `VTIP=3.5`. Four disposition wordings ("Change … or leave … EXECUTED", the same unexecuted, "Leave. Optional polish", Leave plus a header note naming README.md in quotes).
- **The fixture tree** (8):
  - Exact lists by `(path, line, rule, found, row)`: 12 NEW, 3 KNOWN OPEN, 4 ACCEPTED and 3 LABELLED, plus 18 skipped mentions including `project_instructions.md:46` and `program_manifest.md:68`.
  - Every finding's excerpt contains the text it matched and stays within 222 characters.
  - The schema finding names `mass_ratio`'s real keys.
  - Every fixture's sidecar is at the snapshot commit.
- **The command line** (12):
  - Exit codes: exit 1 on the fixtures, with the exact Result line and register header; exit 0 on a clean temporary tree with "Allow-list: none"; exit 2 without a canon, for an unknown `--cite` key, for a missing `--deviations` file, for a canon without `kinematics.phase3_growth_option` (message names it, no traceback), for `{}`, and for a density of 0.
  - Deleting each of the canon's 116 paths in turn (every leaf and every object) never raises. The 74 deletions that remove something the rules or the self-check read are refused with exit 2; the other 42 (notes, text fields, keys no rule reads) run normally.
  - A reference tip speed that escapes reports its apogee as "none", not a crash.
  - A CRLF copy prints the CRLF bytes' sha256, not the LF one.
  - `--label-coverage` counts 43 numbered Markdown lines in the fixtures.
  - The v_tip card contains 2.5, the `_lower_tip_note` text read from the snapshot, and the sidecar's sha256, which equals the sha256 of the snapshot bytes.
  - The SK99 card carries its VM-001 note.
  - The JSON report's counts are right, and its commit source is "provenance sidecar".
  - `--verify-canon` prints both radii's summaries; `--rules` runs.
- **Saved outputs** (2). `page-data.js` carries the snapshot's bytes (same sha256) and the sidecar's commit, a card for every numeric key, cards equal to `cite()` for three keys, counts equal to `example.txt`'s Result line, every finding's `path:line` in `example.txt`, and self-check rows equal to a fresh `verify_canon` of the snapshot. When `/home/user/skyhook` is present at the commit `example.txt` names, a fresh `--verify-canon` run must equal `example.txt` line for line, the generation stamp aside; elsewhere that test skips and says why.

The tests have teeth. Each row below is one change to `lint_canon.py`, applied to a copy of the folder, and the number of the 56 tests that then fail or error (baseline 0):

| sabotage | fail |
|---|---|
| raise the 5 % rounding cap to 100 % | 4 |
| drop the two-decimal fraction floor | 2 |
| let a keyword 100 tokens away claim a number | 1 |
| check ladder rungs against any tier | 7 |
| switch the schema detector off | 6 |
| scale every literal by 1.01 | 15 |
| quantity labels never match | 7 |
| pattern labels never match | 7 |
| let weak words label quantities (the old vocabulary) | 8 |
| read Leave-first rows as open | 10 |
| read "leave" anywhere as Leave (round 1's bug) | 5 |
| check EXECUTED before Leave | 8 |
| no per-file split of Leave-first rows | 4 |
| drop `erf` from EQ-6 | 7 |
| stop recognising km/s | 11 |
| remove the unit tie-break | 1 |
| let every range bracket | 7 |
| switch the tier check off | 2 |
| let a clause without tier words admit every tier | 1 |
| ignore negation | 1 |
| C3 sign flipped (+2μ/r) | 5 |
| R_E 6378 instead of 6371 | 6 |
| mean lunar distance 300,000 km | 2 |
| switch the required-key refusal off | 2 |
| hash the decoded text instead of the bytes | 1 |
| excerpt = the first 220 characters | 2 |
| switch `yields_to` off | 2 |
| silent fallback for a missing `--deviations` | 1 |
| let a keyword in a closed parenthetical count | 2 |
| let an after-keyword that names its own number claim | 5 |

`ui-check.mjs` has 38 checks.

- **At 390 px, dark mode, by touch:** the header names the commit and the five tiles show the saved counts; the list names the stress-test key, the SK99 line, DEVIATIONS #8 and the glossary line; the glossary excerpt reaches "our 100–200× planning range" and the banner finding shows "mass ratio ~41×"; the NEW tile hides the KNOWN OPEN card and shows exactly the NEW count; the text filter narrows to the one SK99 finding; the body is dark; nothing scrolls sideways with every section open.
- **At 1280 px, light mode:** the v_tip card shows 2.5, `_lower_tip_note`, the sidecar's sha256 and commit, and equals the CLI's `--cite` output (date and params path aside); the SK99 card carries its VM-001 note; Copy reports what it did; the self-check table has 42 rows with the 10 that disagree in either column marked, columns named 6371 and 6378 km, the Phase 3 release row at 11.0563 DISAGREES, and a summary naming both conventions; the three label strengths and register row 7's per-file states are listed; Tab reaches a control; every rule is listed.
- **Both pages** show no console errors.

`node tools/check.mjs ideas/04-rule-one` passes: README format, size, the tests, and the smoke test at 1280 px and 390 px.

## Honest assessment

- [Certain] The rounding, range, key-resolution and self-check arithmetic does what this README says. The tests above exercise each branch, and the sabotage counts show which tests notice which break.
- [Certain] Eleven of the twelve NEW findings are real disagreements with `rev_a.json` at `34935cb` (findings 1–4 and 6 below); I opened each line. The stress-test key is absent from `rev_a.json` (grep count 0). The glossary's "100–200×" is the range `docs/DECISION_LOG.md:20` says was purged from the founding document.
- [Likely] The twelfth, `docs/objections_faq.md:38` "A 600 km structure", is 6 % short of 2L = 640 km. It is flagged because of the 3 % trailing-zero cap, which is a choice, not a law, and a reader could take 600 as a rounding.
- [Likely] The keyword windows, tier words and self-label vocabulary catch what a reader would read as a canon claim. They are heuristics, and the report keeps what they suppress visible (LABELLED, `--verbose`). Known limits:
  - **Strong labels still excuse a lot.** A strong marker anywhere in the wide window or heading excuses a mismatch: 15 % of the numbered Markdown lines the quantity rules see, by `--label-coverage`.
  - **Tier words are read from the number's own clause, or else its Markdown heading.** A tier named only in a table header row, an earlier sentence or a previous line is not seen, and the number is then read as the reference. A clause that names two tiers admits both. Negation is recognised only as not/no/nor/never with at most an article ("not a cislunar throw").
  - **One line at a time.** The scanner attributes numbers within one line (strong labels also look at the neighbouring lines and the heading), so a sentence wrapped across lines can lose its keyword. `docs/program_manifest.md:68` ("v_tip 3.5 km/s reaffirmed in all three ladders") is skipped because ERRATUM sits on the same line.
  - **The 3 % trailing-zero cap is a choice.** It flags "600 km structure" (6 %) and passes "1,600 kg/m³" (2.6 %).
  - **Coverage gaps.** The derate rule reads only fractions and percentages. Quantities with no key in `rev_a.json` (payload, Δv, construction launch price) are never checked.
  - **Some LABELLED entries are noise**, such as HASTOL's SF 3.
- [Likely] The register parser depends on the disposition starting with *Leave*, on the word EXECUTED, on backticked paths, and on quoted snippets. The failure that remains is silent. A Leave-first row whose executed change concerns a file its later clauses do not name (by a distinctive word of the file name) is read as Leave for that file, so a regression there is ACCEPTED. And because only NEW fails the run, any row misread as Leave or open hides a regression against it. Row 1 is matched by its quoted sentence, so the archival header line that paraphrases it is not pulled in.
- [Certain] The tool never writes to the checkout. Its outputs are stdout, `--out` and `--emit-page-data`, and its git calls run with optional locks off.
- [Certain] This is an idea-bank prototype. It has not been through Skyhook's Rule 1 canon review, a verification memo, or the repository's pytest suite; pytest is not installed in this sandbox, and the tests here use `unittest`. The page shows one saved run dated to one commit and computes nothing itself.
- [Speculative] Whether a maintainer would keep the register in sync once a linter nags about it is the human half. The design bet is that writing a `DEVIATIONS.md` row, which Hudson already does, is the right way to silence a finding.

**Findings about the source repo** (observed at `34935cb`; not fixed there):

1. `tools/sims/skyhook_no_leo_stress_test.jsx:48` reads `revA.mass_ratio.tether_to_payload_single_arm_range`, and `:79` computes `REVA.massRatioArmRange[1] * 2`. `params/rev_a.json` has no such key; its `mass_ratio` object holds `integrated_tether_to_payload_both_arms` and `tip_speed_to_Vc_ratio`. The module therefore throws at import. `CLAUDE.md:29` names this file the canonical simulator, and `:28` calls it "the canonical No-LEO simulator".
2. `tools/sims/skyhook_calculator.jsx:11` has Dyneema SK99 `sigma: 3.9e9`; VM-001 corrected it to 3.6 GPa (`rev_a.json:71-72`). `:20-22` has `derate: 0.6 / 0.72 / 0.85`, the same bug DEVIATIONS #8 tracks for the program site's `LAD` object but not for this file.
3. `docs/glossary.md:27` says "our 100–200× planning range is a deliberate conservative derate of our own". The Rev A ladder is 40.32 / 64.30 / 121.83×.
4. `tools/sims/skyhook_program_site.html:219` has the SVG label "lower tip grazes ~100–150 km — rendezvous happens here", against `geometry.tip_altitude_lower_km = 290` (610 − 320). The site's own calculator computes the lower-tip altitude as `alt − L` = 290 km (`skyhook_program_site.html:1168`, `var tipAlt=alt-L;`).
5. [Likely] `docs/objections_faq.md:38` says "A 600 km structure sweeping through Starlink", against 2 × 320 = 640 km. The hero-banner fix noted in DEVIATIONS already changed "600–700 km" to "640 km" on the site.
6. `docs/program_manifest.md:6`, the 25 August "CANON CORRECTION" banner, gives as "Reference numbers" "release 10.05 km/s … mass ratio ~41× (65×/123× at 15%/30% derate)". `rev_a.json` says 10.06 and 40.32 / 64.30 / 121.83, which round to 40 / 64 / 122. The 31 August banner at `:8` has the right ladder. The 10.05 is the file's own `v_orb_kms` 7.55 + 2.5, a symptom of finding 8. "~41×" for the SF 2.5 ratio recurs in `docs/DECISION_LOG.md:72` and `docs/research/mp001_market_pricing.md:46` (both "the … reference mass ratio from ~41×") and in `docs/program_manifest.md:65`. There it sits in the same sentence as an SF ≈ 5 hypothetical, so the tool shows it as LABELLED.
7. `docs/program_manifest.md:68` (the 24 August session delta) says "v_tip 3.5 km/s reaffirmed in all three ladders". It is marked superseded only by the file-level banner at `:6` ("Every artifact that said "Rev B / 3.5 km/s reference / reaffirmed" has been corrected to Rev A"), not on the line itself. The tool skips it as a labelled pattern mention because ERRATUM sits on the same line, so this one is recorded by hand.
8. `params/rev_a.json` mixes two Earth radii. Idea 01 (Tip Match) documents this as F1 and F2; `--verify-canon` reproduces it independently and extends it to every derived key.
   - **R_E = 6371 km** is the radius of the notes' "r = R_E + 610 + 320 = 7301 km" and of `physics/skyhook_physics.py:40` (`R_EARTH_KM = 6371.0`). Under it, three values do not follow: `orbital.com_radius_km` 6988 (6981 expected), `orbital.v_orb_kms` 7.55 (7.5563, which rounds to 7.56) and the Phase 3 `v_upper_release_kms` 11.05 (11.0563, which rounds to 11.06).
   - **R_E = 6378 km** is what `com_radius_km` implies. Under it, seven do not follow: the reference and cislunar release speeds 10.06 and 10.36 (10.0525 and 10.3525), the C3 values −8.06, −1.94 and 13.05 (−8.033, −1.911, 13.072) and the apogees 85,222 and 397,819 km (85,559 and 403,445).

   No single radius reproduces the file. `python3 physics/skyhook_physics.py` still prints ALL PASS: it computes v_orb at 6371 km (7.5563 against the file's 7.55, 0.08 %) under a 2 % tolerance (`:260`) and does not check `com_radius_km`. Consequences in prose: `docs/project_instructions.md:46` "~7.55 + 2.5 ≈ 10.06 km/s" (the arithmetic gives 10.05); `docs/program_manifest.md:6` "release 10.05 km/s"; and the teasers' "~5.06 km/s inertial lower-tip speed" (`materials/teaser_investor.html:62`, `materials/teaser_defense.html:20,65`, `materials/core.md:35`) against `7.55 − 2.5 = 5.05`. The tool allows both 5.05 and 5.06 for that reason.
9. `docs/DEVIATIONS.md:6` item 1 names `docs/original_README.md` line 4, but the header note the same item prepended moved the sentence to line 6.
10. Some register dispositions mix decisions. Row 3 offers an alternative ("or leave untouched if Hudson prefers") beside the executed one; rows 1 and 7 combine a Leave with an EXECUTED action. The register has no machine-readable state, so any tool has to read prose to know what was decided.
11. `docs/verification_memo.md` and `docs/DEVIATIONS.md` are the two files a canon linter must skip, because they quote the wrong numbers on purpose. A future register might carry a machine-readable marker so that choice is not the tool's.

## Where it would land

Skyhook, as `scripts/lint_canon.py`, with a step in `.github/workflows/ci.yml` after `pytest tests/ -v --tb=short`: `python3 scripts/lint_canon.py . --format json --out lint_canon.json && python3 scripts/lint_canon.py . --verify-canon`, reading `params/rev_a.json` and `docs/DEVIATIONS.md` live. Exit 2 would mean an unreadable input or a canon whose schema moved, which is distinct from drift. The page would not ship; `--emit-page-data` is for this bank.

What must change to ship for real:

- **Defaults.** `--params` and `--deviations` already default to the repository's paths, but the snapshot sidecar logic becomes dead code there.
- **Triage.** Hudson triages the twelve NEW findings into register rows (fix, Leave, or track), so the first CI run is green or deliberately red.
- **Hook policy.** It decides whether NEW blocks a commit or only a merge.
- **A register state column.** `DEVIATIONS.md` would gain a machine-readable state per file (Leave / open / executed). Reading prose is what misread rows 3 and 7 in review round 1, and it is where the parser's remaining silent failure lives.
- **Inline markers.** The self-label vocabulary should be replaced, or at least backed, by an explicit inline marker (`<!-- canon: option -->`, `# canon: historical`) that the register and the linter both understand. Word heuristics still excuse 15 % of numbered lines and let `program_manifest.md:68` through.
- **The stress-test simulator** either gets its key path corrected to `integrated_tether_to_payload_both_arms` or is relabelled legacy in `CLAUDE.md`.
- **One list of keys.** `tools/twin/params-loader.js`'s `REQUIRED_PATHS` could be generated from the same flatten, so there is one list of the keys consumers depend on.
- **A decision on the Earth radius.** The self-check's ten disagreements want a one-line decision in `rev_a.json`: set `orbital.com_radius_km` to 6981, `orbital.v_orb_kms` to 7.56 and `kinematics.phase3_growth_option.v_upper_release_kms` to 11.06, or state R_E as a key. `test_the_landing_fix_makes_the_self_check_pass` checks that the three edits make all 42 rows reproduce under both columns, and that changing `com_radius_km` alone leaves two failing. Then `last_verified` can move.
- **Review of the rule table.** Rule 1 canon review and a VM entry apply to the tool's own rule table, since it decides what counts as a canonical claim.
