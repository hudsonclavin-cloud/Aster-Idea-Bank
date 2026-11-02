# Cold Read
> Reads a PartForge `.scad` before it renders and names each SPEC and FLIGHT declaration problem by line and column, with the app's own `parseFlight`, `parseSpec`, `flightLint`, `lint` and `flightContradictions` deciding what is dropped, demoted, contradicted or flagged. On PartForge's endcap dry run it names, in a few milliseconds, the 2 of the gate's 4 recorded failures that are in the text (the other 2 need the mesh); its named entries equal `parseFlight`'s own counters on all 35 bundled texts and 675 corrupted copies; and it finds that the flight gate's by-construction shortcut lets `main()` leave out a declared part. It never says a part passes.

**Kind:** linter
**For:** PartForge
**Run:** from the bank root, open `ideas/24-cold-read/index.html` (works from `file://`, no network): pick any of the 35 bundled PartForge texts or paste your own, break one with the proposal's mutations, and read the diagnostics as you type. CLI: `node ideas/24-cold-read/cold-read.mjs ../Partforge/tests/dryrun/endcap.scad` (`--json`, `--grade flight|hobby`, `--no-info`, `--corpus` for all 35 texts, `--rules` for the catalogue, `-` for stdin; exit 0 no errors, 1 errors, 2 usage). Tests: `node --test ideas/24-cold-read/coldread.test.mjs` (26 tests, about 4 s) and `node ideas/24-cold-read/ui-check.mjs` (50 checks in headless Chromium; `check.mjs` runs it for `tools/check.mjs`). `node ideas/24-cold-read/build-data.mjs` rebuilds `snapshots/` from a PartForge checkout.
**Made by:** Blueline

## What it is

PartForge's model writes a `.scad` whose comments carry two JSON declarations: a `SPEC` (parts, sizes, joints, rules, layout, profiles) and, in flight grade, a `FLIGHT` block (critical extents, ODs, bores, hole patterns, revolve profiles, gauges, loads). The app compiles the file first and only then reads those blocks, so a trailing comma, a part whose module was renamed, a hole circle with `n: 0`, or a critical dimension that cannot match its own SPEC part is reported after a full CGAL render. Several of them are not reported at all: `parseSpec` returns `null` on any malformed SPEC and the gate silently skips every SPEC check, and `parseFlight` counts dropped and demoted entries without naming them.

Cold Read reads the text without rendering and reports each problem as `file:line:col`, with the rule, a message that says what the app will do about it, and the source line. It comes as:

- **`coldread.js`**: the pure linter (classic script and `require()`); 51 rules, listed by `--rules` and on the page.
- **`cold-read.mjs`**: the CLI, Node built-ins only.
- **`index.html`**: a page that lints as you type, with a gutter that marks error and warning lines, diagnostics that jump to their line, a comparison against what PartForge's gate is recorded to have said about the same file, the 35-text corpus as a table, and the rule catalogue.

Every report ends `text checks only; geometry not checked`. A file with no errors and no warnings is reported as "no textual errors or warnings. That is not a pass: nothing here was rendered or measured."

## Why I made it

**The open item.** I checked every citation in the judged proposal (`queue/proposals/24-cold-read.json`) against PartForge at `0974a62`; all held:

- `index.html:2899` `parseSpec()` returns `null` on any problem (`:2928` `catch(e){ return null; }`), and `specCheckInner` then notes "SPEC block present but its JSON did not parse — checks skipped" (`:3221`). On a first candidate that is not a failure.
- `index.html:4672` `parseFlight()` returns `{malformed:true}` or counts `dropped`/`demoted`; the gate prints only counts: "N FLIGHT entries were ignored: missing axis, nominal, tolerance, from/to or pattern fields" (`:5586`) and "N entries claim a cited tolerance with no tol_ref" (`:5587`).
- `index.html:4827` `flightLint()`, `:5915` `lint()`, `:4847` `flightContradictions()`. The comment above `flightContradictions` (`:4840-4846`) says of the endcap's two contradictions: "Both are visible in the text, before a render, and both were spent on 20-minute CGAL retries."
- The order is the problem: `generate()` renders (`runCode`, `:7614`) and only then runs `specCheck` (`:7627`), which runs `specCheckInner` and `flightCheck` (`:3202-3205`). The only pre-render use of any of these functions is `specProbeExprs` (`:3174`), which calls `parseSpec` to pick probes to prefetch and reports nothing.
- `docs/STATUS.md` "Open, with numbers", item 1 (`:266-271`): the SPEC part batch re-renders the whole part, "24 s on the retainer fixture, 8.5 s on the bulkhead's five probes"; harness gate time "total 121.7 s across ten cases". A containment probe once took 445 s on a nose cone (`index.html:3231`).
- `tests/dryrun/cases.json` names the endcap's textual contradictions and its geometric failures separately; I use it as the oracle below.

**Alternatives weighed.**

- *Re-implement `parseFlight`'s acceptance rules* (what the proposal's "computes" line says). Rejected: that is a second truth about what the app accepts, and it would drift. Instead Cold Read runs the app's own `parseFlight` on each entry alone (`{"<category>":[entry]}`) and takes its verdict. It keeps its own field-by-field rules only to say *which field* failed. If the two ever disagree, it reports the app's verdict and a `PARITY` error. The proposal's honesty section asked for exactly that safeguard, and this goes one step further.
- *Run the real gate headless* (`headless/cli.mjs check`). That is the gate itself and pays the render; `openscad-wasm` is not installed here and the brief forbids `npm install`. Cold Read is the pre-render complement, not a substitute.
- *A general OpenSCAD parser.* Heavier, and it would still know nothing about PartForge's contract (SPEC/FLIGHT, the doctrine's `main()` rule, the parameter sentinel), which is where every problem above lives. A small tokenizer over comment- and string-blanked text is enough for module tables, statement-position calls, `* % ! #` modifiers and reachability.
- *Fold it into idea 07 (Shadow Lint).* See the overlap below. Different question, so a separate tool.

**What other ideas in the bank already cover, and what this one does instead.**

- **07 Shadow Lint** reads the same FLIGHT blocks, but asks of each *loads row*: can the declared geometry see this input? It diffs an attempt against its retry, and it refuses a malformed FLIGHT block as a whole. It does not locate a JSON fault, name dropped or demoted entries, check module existence or `main()` reachability, or run `flightContradictions`/`flightLint`. The recorded first-attempt failure in 5 of 6 Gemini rings ("no bolt grade", `docs/runs/2026-10-06-gemini-flight-x5/README.md`) is a loads-row content gap that Shadow Lint lists among its gaps; Cold Read deliberately does not duplicate it.
- **19 Caliper Ledger** runs the same verbatim `parseFlight` to build inspection rows and refuses malformed or empty declarations. It does not lint.
- **18 Second Copy** compares numbers the doctrine and templates restate with their tables. It does not look at declaration structure.

So Cold Read is the bank's only tool that gives positions, names the entries `parseFlight` drops or demotes, checks modules and reachability, and runs the gate's text-only rules before a render.

## How it works

**The app's rules, verbatim.** `build-data.mjs` copies out of PartForge `index.html` at `0974a62` (sha256 `a1561e3c…`), byte for byte, the `DECL-BEGIN … DECL-END` block (lines 4646-4859: `parseFlight`, `flightLint`, `flightContradictions`, `FLIGHT_CAP`, `FLIGHT_AXIS`, `TOL_SRC`, `FLIGHT_HAZARD`), `parseSpec` (2899-2929), `lint` (5915-5922), `parseManifest` (5925-5935), `mainPlainUnion` (4536-4550), `topLevelIsOnlyMain` (4561-4583) and `PARAM_RE` (6420). It also wraps the gate's defined-modules statement (3176, 3226, 5707) in a function, and lifts 19 regex literals from inside those functions (the block regexes, the revolve types, the load checks, the hole patterns), plus the hole count range `1..64` (`:4714`), each recorded with its line, and parseSpec's four caps (8 rules, 8 notes, 12 relations, 10 profiles), read from its own `.slice(0, N)` calls in 2899-2929. If a pattern stops matching, the script fails rather than guessing. The output is `snapshots/app-rules.js`, a classic script, with a provenance sidecar.

**Reading a block.** The SPEC and FLIGHT blocks are found with the app's own regexes (`:2900`, `:4673`), and each line's `//` prefix is removed with the app's own regex (`:4675`), while keeping a map from every JSON offset back to the source offset. `JSON.parse` (which the app runs) decides accept or reject. A strict position-keeping reader in `coldread.js` only says *where*, using V8's "at position N" convention: the offending character, or for a trailing comma the comma itself. It also reports duplicate keys, which `JSON.parse` resolves silently by keeping the last.

**Dropped, demoted, capped, uncounted.** Each FLIGHT entry is given to `parseFlight` alone. If the app drops it, Cold Read names the first failing field, checked in the app's own order (axis, then the positive numbers, then from ≠ to, then pattern, `n`, `bc_d_mm`; revolve `type`; gauge `module`; load `check`). A `"source"` tolerance or input with no reference is a demotion, named at its key. A quirk the app has: `round()` (`:4698`) calls `prov()` before the hole pattern and `n` checks (`:4710`, `:4714`), so a dropped hole still counts its demotion. Cold Read names both and says so. Entries past `FLIGHT_CAP = 24` (`:4652`), and non-object entries, are filtered out before the app counts anything; Cold Read names those too. SPEC entries are handled the same way through `parseSpec`.

**The app's text rules, located.** `flightContradictions(parseSpec(code), parseFlight(code))` runs as the app runs it, and each contradiction is placed at its entry's `nominal_mm`. `flightLint` and the hobby `lint()` run on the raw text. Their findings are placed with the regexes lifted from those functions. `lint()` tests the raw source with no word boundary and warns once if `minkowski(`, `text(` or `import(` appears anywhere, so Cold Read places that warning at the first match that is real code. Only when every match is inside a comment, a string or the tail of an identifier is the warning marked false and kept as a note. (`$fn` is different: `lint()` reads only the first `$fn = N`, so its warning is about that one match, and a later high `$fn` is `FN_HIGH`.)

**Structure.** A tokenizer over the text, with comments and strings blanked so offsets stay true, builds the module table, the statement-position calls in each module and at the top level, and the `* % ! #` modifiers. Reachability is from what the top level renders. A SPEC part, critical module or gauge module with no definition is `MODULE_MISSING`, judged with the gate's own regex, so it matches the gate. A call to something that is neither defined nor an OpenSCAD built-in is `UNKNOWN_MODULE`. A SPEC part that nothing draws is `MAIN_UNREACHED`. When the file qualifies for the flight gate's by-construction shortcut (both `mainPlainUnion` and `topLevelIsOnlyMain` true, `:3235`), the message says the containment check will not run.

**The parameter block.** The block is read with the app's `PARAM_RE` up to the `// --- end parameters ---` sentinel. The checks: assignments the panel will not show and why, a missing sentinel, `tess_tol` not first (the doctrine at `:1479`), and the `tess_tol` parameter against FLIGHT `tess_tol_mm`.

**Severity.** *Error*: the gate fails the file for it, or something the file declares silently stops being checked (a dropped entry, a joint naming no module, a part nothing draws). *Warning*: the app silently reads something as something else, or the file breaks the doctrine. *Note*: worth knowing, no effect on the verdict. In hobby grade, `flightLint` findings are warnings and `TOP_LEVEL` is a note, because the gate consults `topLevelIsOnlyMain` only in flight grade.

**The corpus** (`corpus.js`): 35 PartForge texts, each wrapped verbatim with its sha256 and its own provenance sidecar. Every text's recorded gate result is read from PartForge's records, never typed:

| Texts | Source | Gate result recorded in |
|---|---|---|
| 3 dry runs | `tests/dryrun/*.scad` | `tests/dryrun/cases.json` (4, 1 and 0 failures) |
| 8 model runs (gemini-3.6-flash) | `docs/runs/*/*.scad` | the line of each run's `README.md` that gives its verdict (all PASS) |
| 7 template fixtures | `tests/templates/*.scad` | `tests/flight-templates-cases.json` (no failures) |
| 7 flight + 10 hobby templates the app ships | `index.html` `TEMPLATES_FLIGHT`, `TEMPLATES` | none; 6 of the 7 flight ones are byte-identical to a fixture and borrow its result |

Read cold, the 35 texts give 2 errors (both in the endcap), 7 warnings (one loads demotion in each of the 7 recorded flight runs) and 34 notes. The page measures its own lint time. The timings it quotes for PartForge are cited, not computed.

## Tests

`coldread.test.mjs`, 26 tests, Node built-ins, about 4 s. What they are pinned to, outside this folder's code:

- **PartForge's own parser.** On every bundled text, the dropped, demoted and kept counts Cold Read names equal what `parseFlight` returns, with no `PARITY` error. A sweep corrupts every checked field of every FLIGHT entry in the 10 test fixtures (plus a synthetic revolve entry, since no bundled file declares one), one field at a time. That is **675 corrupted files, 495 drops and 131 demotions** by `parseFlight`. Every one is named, at the corrupted entry, with the field. `FLIGHT_CAP`: 27 critical entries give 24 kept by the app, 0 counted, and 3 named.
- **PartForge's recorded gate results.** Endcap (`cases.json`): the two `Critical dimension` failures are found as `CONTRADICTION` errors at lines 29 and 30, at the `nominal_mm` column. The message contains the gate's own recorded text ("but your SPEC gives shoulder a size of 101.500 × 101.500 × 20.000"). Neither geometric failure ("shoulder OD", "o-ring groove bottom diameter") is claimed. Retainer: its one recorded failure is geometric, so 0 errors and 0 warnings, and the report says it is not a pass. The 7 template fixtures (no recorded failures) and the 17 shipped templates: 0 errors, 0 warnings, and `flightLint` is empty on each flight one. The 8 recorded runs (each run log says PASS): 0 errors.
- **V8's `JSON.parse`.** Delete, double or insert structural characters in three real FLIGHT blocks. On the **2,367** malformed blocks where V8 reports "at position N", Cold Read's offset equals N (V8 gives no position for 313 more). Three of those cases get hand-counted offsets instead.
- **index.html itself**, when the checkout is at the snapshotted sha. All 7 verbatim blocks are byte-identical to their line ranges. All 73 cited lines (every `index.html:N` in `coldread.js` and `app.js`) still contain the quoted text.
- **The proposal's mutations**, each pinned to line and column. Renaming `module ring()` gives `MODULE_MISSING` at 12, 16, 17 and 18, and `UNKNOWN_MODULE` at main's call. `main()` leaving out `bosses()` gives `MAIN_UNREACHED`, after asserting that the app's `mainPlainUnion` and `topLevelIsOnlyMain` both accept the file. A `"source"` tolerance without a reference gives a demotion at line 18. `n: 0` gives a drop at line 21, field `n`, "outside 1..64". `$fn = 200` gives the app's exact `flightLint` string at its line. `text("A")` gives the app's warning at its column, and the same words in a comment are marked false. A trailing comma is reported at the comma.
- **Every rule** (added in review). One table-driven test breaks a real PartForge text once per rule (35 cases covering 32 of the 33 rules no other test reached; the 33rd, `PARITY`, has its own test below) and asserts the rule fires, at the catalogue's severity, at the line of the edit. Each case also runs the app's own function on the same text and checks what the message says the app does: `parseSpec` keeps exactly 8 rules, `parseFlight` reads `"Pressure"` as hazard `none`, a non-object entry leaves `dropped` at 0, `topLevelIsOnlyMain` rejects a stray `cube(1);`, and so on. The test then asserts that every one of the 51 catalogued rules is pinned by some test. A second test hands Cold Read a `parseFlight` that over-counts one drop and asserts the `PARITY` error reports the app's number.
- **The hobby `lint()` placement** (added in review). A real `text("A")`, `import("x.stl")` and `minkowski()` after a comment, a string and an identifier (`mytext`) that mention them are each a warning at the real call; a mention only inside a string is a note that says so.
- Plus SPEC unclosed, SPEC trailing comma and a nameless part. FLIGHT missing or unclosed. Every 1/40th prefix of every text (1,436 runs) lints without throwing and without `PARITY`. The CLI's exit codes and output.

**Teeth.** I broke the code on purpose and counted failing tests:

| Sabotage in `coldread.js` | Tests failing |
|---|---|
| line numbers off by one | 12 |
| comment prefix not mapped back (columns shift) | 6 |
| `cylinder` missing from the built-ins | 6 |
| footer weakened to "text checks only" | 3 |
| contradiction placed at the block start | 2 |
| hole count `n < 64` instead of `n <= 64` | 1 |
| own drop rule used instead of the app's verdict | 1 |
| a dropped hole's demotion not explained | 1 |
| `FLIGHT_CAP` off by one | 1 |
| JSON error one character early on a stray `}`/`]` | 1 (this one escaped until I added hand-counted cases) |
| a number ending in `.` reported one early | 1 |
| `*`/`%` modifiers ignored | 1 |
| shortcut never detected | 1 |
| comment-borne `lint()` hits not marked false | 1 |
| loads demotion not naming `inputs_ref` | 1 |
| a line dropped from the citation table | 1 |
| `flightLint` a warning in flight grade | 1 |
| duplicate keys not collected | 1 |
| *data:* one character of the wrapped endcap changed | 1 (sha) |
| *data:* `parseFlight`'s copy edited to `n <= 63` | 3 (sha, byte compare with index.html, sweep) |

**Teeth, recounted in review.** The table above was true but partial: deleting any one of 33 of the 51 rules from `coldread.js` (making `add()` drop that code) left all 23 original tests passing, and 11 of 15 further sabotages escaped. After the review's tests, deleting any one of the 51 rules fails at least one test (47 fail 1, 2 fail 2, 1 fails 3, 1 fails 4), and the 17 sabotages below are all caught:

| Sabotage in `coldread.js` (review) | Tests failing before review | after |
|---|---|---|
| the first raw match decides a `lint()` warning (the bug fixed in review) | n/a | 1 |
| a match inside a string counted as code | n/a | 1 |
| an identifier tail (`mytext(`) counted as code | 0 | 1 |
| `%` treated as rendering | 0 | 1 |
| `SPEC_CAP` off by one | 0 | 1 |
| a non-object FLIGHT entry not counted as uncounted | 0 | 1 |
| `JOINT_MODULE` never raised | 0 | 1 |
| `GAUGE_RENDERED` never raised | 0 | 1 |
| `TOP_LEVEL` a note in flight grade | 0 | 1 |
| `MAIN_MISSING` a warning in hobby grade | 0 | 1 |
| `UNKNOWN_MODULE` an error even after an `include` | 0 | 1 |
| `TESS_MISMATCH` tolerance 1e-12 widened to 1 mm | 0 | 1 |
| `DUP_MODULE` never raised | 0 | 1 |
| hole count upper bound ignored | 1 | 1 |
| a loads demotion not explained | 4 | 4 |
| `HAZARD` test inverted | 6 | 7 |
| contradiction placed at `tol_mm` | 2 | 2 |

`ui-check.mjs`, 50 checks in headless Chromium. Every count, line and order on the page is compared with the kernel run in Node on the same text. It also covers: the gate comparison ("2 of 4"), click and tap to jump to a line, typing re-lints, every "Break it" preset, the grade switch, the filters, the corpus table (click and Enter), your own empty text, 1280 px and 390 px with no sideways scroll, dark mode, touch, a throwing `localStorage`, no console errors and no network requests. On six sabotages of `app.js`/`style.css` (gate hits never counted, jump selects the next line, typing not re-linted, filters ignored, an edited text keeping the borrowed verdict, no dark scheme) it fails 1, 1, 3, 1, 1 and 1 checks.

## Honest assessment

**What works.**
- [Certain] Every dropped, demoted or capped FLIGHT entry in the bundled corpus and the 675-file sweep is named at its entry, with the field, and the counts equal the app's.
- [Certain] JSON faults are located exactly where V8 locates them, whenever V8 gives a position.
- [Certain] The endcap's two textual failures are found before any render, in a few milliseconds (the page measures each read: 3 to 6 ms here), where the gate found them only after rendering.
- [Certain] No error on any of the 33 texts PartForge records as passing or ships.

**What is rough.**
- [Certain] It sees text only. It cannot find the retainer's lip filled into its pocket or the endcap's groove declared as a bore. A clean read is never a pass, and it never says otherwise.
- [Likely] The tokenizer is not OpenSCAD's parser. List comprehensions, `let`, function literals and modules defined in `include`/`use` files are handled loosely (an `include` turns unknown-module errors into warnings). `UNKNOWN_MODULE` relies on a list of OpenSCAD's built-in modules taken from the language reference (34 names, including version-dependent ones such as `roof`). "OpenSCAD keeps the later definition" and "an unknown module draws nothing, with a warning" are [Likely], from the language's documented behaviour, not run here.
- [Likely] The `MAIN_UNREACHED` "the gate misses this" claim (finding 2 below) rests on two app functions run here and one branch read, not on a run of the full gate.
- [Certain] PartForge keeps no failing first attempts from its recorded runs (only the files that passed), so apart from the two dry runs, Cold Read has never been tested on a real failing model attempt. Its error side is exercised by mutations of real files.
- [Certain] The hand-built severity policy is a judgement. PartForge has no equivalent.

**Findings about the source repo** (PartForge at `0974a62`; none fixed there):
1. [Certain] The flight doctrine says a critical nominal that matches none of its part's SPEC extents "is rejected before anything is rendered" (`index.html:1455`). The only call to `flightContradictions` is inside `flightCheck` (`index.html:5620`, and `headless/core.gen.mjs:4114`), which runs after the render (`:7614` then `:7627`). The doctrine promises a check the code does not make at that point.
2. [Certain / Likely] The flight gate's by-construction shortcut (`index.html:3235`, `:3424-3426`) trusts `mainPlainUnion` (`:4536-4549`). That function checks that every call in `main()` is a declared part, but not that every declared part is called. With the av-sled template's `main()` reduced to `union(){ plate(); }`, both `mainPlainUnion` and `topLevelIsOnlyMain` return true (run here verbatim), so `placement` becomes `{ok:true, byConstruction:true}` and the containment check never runs, while `bosses()` is never drawn. [Likely] for the end-to-end result: the branch is read, not run with the engine. The FLIGHT entries measured on the finished object may still catch it, by chance. No PartForge test calls either function (they are exported at `:8539` and appear nowhere under `tests/` or `headless/test/`). The fix would be to require that the set of calls equals the set of declared parts.
3. [Certain] The report line for demotions (`index.html:5587`) says "a cited tolerance with no tol_ref" for every demotion. A loads demotion (`:4740`) is a cited *input* with no `inputs_ref`. All 7 recorded Gemini flight runs in `docs/runs/` carry exactly one such loads demotion, so on PartForge's own recorded files the report names the wrong key.
4. [Certain] `parseFlight` counts a demotion for a hole entry it then drops: `round()` (`:4698`) calls `prov()` before the pattern and `n` checks (`:4710`, `:4714`). So `demoted` can count an entry that is not in the output.
5. [Certain] The hobby `lint()` (`:5915-5921`) tests the raw source, comments included, with no word boundary. A comment that mentions `text()` or `import()` raises a false warning (shown here by running the verbatim function). It also reads only the first `$fn = N` (`:5918`).
6. [Certain] The shipped `TEMPLATES_FLIGHT[2]` "Av-bay bulkhead" is not byte-identical to `tests/templates/bulkhead.scad`. Line 11, a NOTE comment, differs, and it is the shipped copy (`index.html:2062`) that carries the newer wording: `git log -S` puts the fixture's sentence ("this file used to pass only because an undeclared grade silently defaulted to 8.8") in `9e79f4c` and the shipped one ("A bent U-bolt's real rating is the vendor's working load…") in `ebde615`, seven minutes later. So the template test exercises a text the app does not ship. PartForge's own drift check (`tests/flight-decl.test.mjs:163-182`, added in `ebde615` for exactly this kind of drift) compares only each template's `"loads":[` line, which is why it still passes. It is a comment only, so the gate verdict cannot differ. The other six flight templates are identical to their fixtures. (Corrected in review: the deposit had said the fixture was the newer copy.)

**Gates not passed.** An idea-bank prototype. It has not been through PartForge's geometry gate, its data provenance pipeline or skeptic review. It has had one independent review in this bank (below); PartForge's own maintainers have not seen it. The PartForge confidence words (`certain / likely / recall`) are not used here; the bank's [Certain]/[Likely]/[Speculative] are.

**What the independent review changed** (2026-11-02). The reviewer recomputed, outside this folder's code, the 7 loads demotions in the recorded runs and the endcap's two contradictions at lines 29 and 30 (with a fresh copy of the `DECL` block and `parseSpec` cut from `index.html`), the 675 / 495 / 131 / 19 sweep counts and the 2,367 / 313 V8 counts (from the tests' own diagnostics), and the 51 rules and 73 citations. All held, every snapshot matched its sidecar and its PartForge source byte for byte, and 14,000 random text and value mutations of the corpus raised no exception and no `PARITY` error. What it found and fixed:
- [Certain] **A bug in the hobby `lint()` placement.** Cold Read located the app's `text()`/`import()`/`minkowski()` warning at the first raw match only. When that match was in a comment or the tail of an identifier, it called the warning "false here", even with a real `text("A")` further down, which it then never reported. The kernel now places the warning at the first match that is real code, also treats matches inside strings as not code, and a test pins it.
- [Certain] **Weak tests.** 33 of the 51 rules could each be deleted with every test still passing, and 11 of the reviewer's 15 sabotages escaped. The review added three tests (one case per rule, a `PARITY` injection, the `lint()` placement) and a `%`-modifier check; now every rule deletion and all 17 sabotages are caught (counts in Tests above).
- [Certain] **A wrong source-repo finding.** Finding 6 had the age of the two bulkhead copies backwards. Corrected above, and PartForge's own drift check, which explains why it is not caught, is now named.
- [Likely] **An unlabelled claim about the gate.** Outside the shortcut, `MAIN_UNREACHED` said the containment check "fails this after the render". It now says [Likely] and why: the check covers only parts that passed their own checks (`index.html:3424`), and in hobby grade only while probes remain (`SPEC_MAX_PROBES = 16`, `:3169`, now in the checked citation table). The diagnostic is now credited to Cold Read rather than to the app, since the reachability is Cold Read's own reading.
- Small: the rule catalogue now lists every severity a rule can carry (`SPEC_CAP`, `UNKNOWN_MODULE`, `SHORTCUT`, `PARITY` raised more than they said, and the new test checks it); "a object" became "an object"; README counts updated.

**How this folder came to be.** It was begun by a builder before the 2026-10-26 hold, which stopped it after the linter kernel, the CLI and `example.txt`. It was recovered from `hold/ideas-20-30` by transcript replay, and finished on 2026-11-02. Kept from that builder: `coldread.js` (all 72 of its index.html citations re-verified; three messages corrected: the shortcut claim now says what was run and what was read, `TOP_LEVEL` is a note in hobby grade, and the loads demotion names `inputs_ref`), `build-data.mjs` (every snapshot reproduces byte for byte; extended to the recorded runs) and the CLI. Fixed: the `app-rules.js` sidecar had a stale `writtenSha256` from an earlier build. Added: `corpus.js`, the 8 recorded runs and their logs, the tests, the page, `ui-check.mjs` and this README.

## Where it would land

In PartForge, in three places:

- **Headless:** `headless/cli.mjs lint part.scad` and an MCP tool `lint_part`, returning the standard envelope with `confidence: "derived"` and each diagnostic with its line, column and rule, in milliseconds and with no engine.
- **The Generate loop:** before `runCode` (`index.html:7614`), run the lint. For findings the gate would fail anyway (`FLIGHT_JSON`, `SPEC_JSON` on a retry, `MODULE_MISSING`, `CONTRADICTION`, flight-grade `APP_FLIGHT_LINT`), send the retry prompt with the line quoted instead of spending a render. That also makes the doctrine's "rejected before anything is rendered" (`:1455`) true.
- **The code pane:** inline diagnostics beside it.

What must change to ship it for real:

1. The rules must be generated from `index.html` by `headless/build.mjs` (as `core.gen.mjs` already is), not kept as this copy, so the browser and headless cannot disagree.
2. The position-keeping JSON reader and the tokenizer move into `index.html` itself.
3. PartForge decides which findings may skip a render; that is a gate change and goes through its skeptic review.
4. Finding 2 is better fixed in `mainPlainUnion` itself, by requiring that every declared part is called, than worked around here.
