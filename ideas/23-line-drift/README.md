# Line Drift
> Checks every `path:line` citation, backticked path and commit hash in 26 of Aster's control-plane documents against the checkout. At 62ddb17 it reads 1,316 references and flags 96 as drift plus 2 partial quotes; a hand check of all 98 finds 30 that need a fix (STATUS.md still carries the porkchop "Grid spans" literal fixed at 446e3a7 and the hook bug fixed at f7b19e7 as open, and none of the 13 bundles its deploy paragraph names exists), 63 that are true but expected, and 5 false alarms.

**Kind:** linter
**For:** Aster
**Run:** `node ideas/23-line-drift/line-drift.mjs /home/user/asteroid-mining-planner` from the bank root (text report; `--markdown`, `--json`, `--only GONE,MOVED`, `--all`, `--allow FILE`, `--accept-annotated`, `--rev REV`, `--no-history`, `--help`; exit 0 no unallowed drift, 1 drift, 2 refused, 3 usage). `example.txt` is that run's saved output and `example-full-history.txt` the same on a full-history clone. Open `ideas/23-line-drift/index.html` for every finding with its history and hand verdict, plus a panel that runs the checker on text you paste (classic scripts, works from `file://`, no network). Tests: `node --test ideas/23-line-drift/linedrift.test.mjs` (26 tests, Node built-ins and git, about 10 s; 4 need the Aster checkout at 62ddb17 and skip without it, 1 needs `LINE_DRIFT_FULL_CLONE=<full clone at 62ddb17>`) and `node ideas/23-line-drift/ui-check.mjs` (44 checks in headless Chromium through the globally installed Playwright; `check.mjs` runs it for `tools/check.mjs`). `node ideas/23-line-drift/build-report.mjs [checkout] [--full CLONE]` regenerates `example.txt`, `example-full-history.txt` and `report-data.js`; `build-data.mjs` cuts the four excerpts in `snapshots/`.
**Made by:** Tidemark

## What it is

A read-only linter for the Markdown an Aster agent is told to trust first. `line-drift.mjs <checkout>` reads `STATUS.md`, `INVARIANTS.md`, `AGENTS.md`, `README.md`, `mcp/README.md`, every `SLICE_*_FOUNDING.md` at the root and under `src/v2/`, and `strategy/*.md` (26 files at 62ddb17; `--doc` replaces the set), and pulls out three kinds of reference:

- **line citations**: `src/v2/app/porkchop/main.ts:637`, `:187-194`, `mcp/src/index.ts:3,26`, a bare `:646` that inherits the path before it, and plain-text `delta-v.ts:30-42`;
- **paths**: a backticked repository path with an extension or a trailing `/` (`tools/slice18-research/tier-sizing-results.json`, `src/v2/core/`);
- **commits**: 7-12 or 40 hex digits with at least one digit and one letter (`bcf1738`).

For each it answers the questions INV-034 and AGENTS rule 5 ask by hand: does the path exist, is it tracked, is it ignored; is the cited line inside the file; and, when the same sentence carries a backticked snippet or a quoted string next to the citation, does that text still sit on the cited line, and if not, where it lives now. Every reference gets one status:

| Status | Meaning | Fails a run? |
|---|---|---|
| OK | path tracked; snippet on the cited line(s); commit in this clone | no |
| PARTIAL | the cited line holds at least 5 consecutive words of the quote and a third of it; the rest is not verbatim | no |
| MOVED | the snippet is in the file, but not on the cited lines (where it is now is printed) | yes |
| GONE | the snippet is nowhere in the file | yes |
| IN-RANGE | no snippet in the sentence; only "the cited line exists" was checked, and the report says so | no |
| PAST-EOF | a cited line is beyond the end of the file | yes |
| MISSING-PATH | no such file or folder (with a same-name suggestion when one exists) | yes |
| IGNORED | `git check-ignore` matches it (present or absent: INV-034's failure mode) | yes |
| UNTRACKED | present, not ignored, not tracked | yes |
| UNREACHABLE-COMMIT | no such object in a **full** clone | yes |
| NOT-A-COMMIT | the hex names a blob or tree | no |
| UNCHECKABLE | could not be checked, with the reason: shallow clone, several files share the name, a content hash, a placeholder name, no git | no |

A MOVED or GONE verdict is "at HEAD", never "wrong": a citation is legitimately pinned to the commit its sentence was written at. So every drift finding is also re-judged against three older trees and the report prints what it was there: the commit where the reference's text **first appeared** in the document (`git log -S`), the commit that **last edited** its line (`git blame`), and a commit its **sentence** (or else its paragraph) **names**. "first appeared 2032b9e, 2026-09-22: held; line last edited 0052ecb, 2026-09-23: MOVED" says the citation was right when written and the code moved later. Each finding also gets context hints from the document itself: its sentence or the next one says the thing is gone or corrected; another paragraph names the same reference beside correction words (`annotated at :212`); it reads as a plan; it names another project. `--accept-annotated` stops the first two from failing the run, and `--allow FILE` takes a JSON list of `{doc, ref, line?, reason}` (a reason is required).

**At Aster 62ddb17** (`example.txt`; the counts below are checked against a fresh run by the tests):

<!-- counts:start -->
| status | line | path | commit | total |
|---|---:|---:|---:|---:|
| OK | 22 | 516 | 39 | 577 |
| PARTIAL | 2 | 0 | 0 | 2 |
| MOVED | 13 | 0 | 0 | 13 |
| GONE | 8 | 0 | 0 | 8 |
| IN-RANGE | 53 | 0 | 0 | 53 |
| MISSING-PATH | 2 | 71 | 0 | 73 |
| IGNORED | 0 | 2 | 0 | 2 |
| UNCHECKABLE | 8 | 32 | 548 | 588 |
<!-- counts:end -->

The local checkout is a shallow clone of 50 commits (history starts at `fbe8e89`, 2026-10-12), so 538 of its 577 commit references, and the history column for nearly every finding, read "not checkable here" rather than "unreachable". Run on a full-history clone at the same commit (`example-full-history.txt`, 983 commits), all 577 commit references resolve, every one an ancestor of HEAD; the other 10 commit-shaped tokens are a tarball shasum, prompt-prefix fingerprints and run ids. The 98 drift and PARTIAL findings are identical in both runs.

I then checked all 98 by hand, reading the cited file at 62ddb17 and at the commits the history column names, and recorded a verdict and one line of evidence for each in `adjudication.json`:

| Hand verdict | Count | |
|---|---:|---|
| stale claim | 18 | the cited thing changed or went away and the document does not say so |
| stale line number | 8 | the snippet is still there, at another line |
| off when written | 2 | already wrong when the citation first appeared |
| misquote | 2 | the two PARTIALs: right place, quote not verbatim |
| **needs a fix** | **30** | |
| acknowledged | 23 | the document itself records it (all 23 carry a context hint) |
| history | 17 | a record of a named past commit, right at that commit |
| plan | 14 | a file proposed or planned, never made at that path |
| not in this repository | 9 | poliastro, Skyhook, a sibling folder, a vault file, build output |
| **true at HEAD, nothing to fix** | **63** | |
| tool error | 3 | a snippet paired with a citation it does not quote |
| shorthand | 2 | `view.ts:974`, a name no file has; `porkchop-view.ts:974` held the string |
| **false alarms** | **5** | |

`index.html` shows the same run: headline tiles, a bar per document stacked by verdict (tap a segment to list those findings), every finding with its tool status, snippet, history line, context and hand verdict, the count tables for both runs, and a **Try it** panel that runs `linedrift.js` on a passage and one file you paste. It starts on the Slice 9 amendment and Aster's `.gitignore` (both snapshots) and shows `.gitignore:17` MOVED to `:19`; with no git in a browser, commits and paths other than the loaded file read UNCHECKABLE, never MISSING.

## Why I made it

The independent audit at `69472a3` opens its second theme with "The agent control plane is stale in load-bearing ways" (`tools/audit/sanity-69472a3/ASTER_AUDIT_REPORT.md:246-275`): STATUS 36 commits behind, one of thirteen deploy bundle names still existing, done work still queued. Its convergence table records `".gitignore:17" citation is off at HEAD` from two readers (`:563`, detail rows `:924`, `:1020`). `AGENTS.md:54-58` tells every session to compare HEAD against STATUS before doing anything, and §2.1 rule 5 (`AGENTS.md:117-118`, INV-033) says "every hash/path/count/version confirmed in THIS repo". INV-034 (`INVARIANTS.md:171-180`, index row `:208`) says cited evidence must be tracked and `git check-ignore -v <path>` must return nothing. Every one of those checks is done by hand today; the only automated one is `tests/v2-about-evidence.test.mjs`, which pins one commit and one heading anchor for the About page. The audit did the citation pass once, in prose, and the drift it found is still there.

Alternatives I weighed:

- **A path-only checker** (exists, tracked, ignored). Cheap and exact, and it is half of this tool, but it cannot see the commonest drift: 19 of the 30 findings that need a fix are line citations or quotes whose file still exists.
- **"Is the cited line inside the file?"** The obvious next step, and nearly worthless: the 53 IN-RANGE citations at 62ddb17 are exactly what it can say, and a stale line number is almost always still inside the file.
- **A new citation format** (`path:line#sha` or an anchor quote in every citation). The robust fix, but a convention change across additive-only documents that cannot be rewritten. Line Drift instead reads the snippets authors already put next to citations: 45 of the 108 line citations carry one.
- **"Has the cited line changed since the document line was written?"** (blame both sides). It flags every edit near a cited line, including harmless ones, and says nothing about where the content went. Snippet search says MOVED to `:19` or GONE; the history column then uses blame and `git log -S` only to date the verdict.

The snippet pairing plus three-commit history won because it separates "the number moved" (8), "the claim is stale" (18) and "it was right when written" from each other, which is what a maintainer needs to decide between editing, annotating and leaving a historical record alone.

**What I changed from the judged proposal, after checking its citations at 62ddb17:**

- The proposal expected `src/v2/app/porkchop/main.ts:637` with "Grid spans 2026-2040" to read **MOVED to :647**. It is **GONE**: commit `446e3a7` (2026-10-14, "fix(ui): derive porkchop and catalog span labels") replaced the literal with `${PORKCHOP_DEPARTURE_SPAN_LABEL}`; only the words "Grid spans" sit on `:647`. STATUS.md:417-425 still lists the item as open, and that is the finding. The test pins GONE.
- Both of its MISSING-PATH examples are **already annotated** in their own founding documents: `src/v2/launch-vehicles.ts` at `src/v2/SLICE_15_FOUNDING.md:212` ("That path has never existed in this repository"), and `tools/slice18-research/tier-sizing-results.json` at `src/v2/SLICE_18_FOUNDING.md:245` (its real history). Line Drift reports them as MISSING-PATH with `annotated at :212` / `:207`, and `--accept-annotated` stops them failing; the proposal's landing note asked for exactly this distinction.
- `.githooks/pre-commit:53` is not "a comment": the cited `grep -c '^-[^-]'` line was replaced at `f7b19e7` (2026-09-22) by `--numstat` counting, and the old pattern survives only in the explanatory comment at `:51`. GONE, and C17 (`STATUS.md:535`) is stale.
- `mcp/src/tools/compute-shared.ts:139` is `}` at HEAD, as the proposal said, but the citation is `src/tools/compute-shared.ts:139-144` in `mcp/README.md:75`: a path relative to the document's folder. Resolution tries the document folder, and the finding is MOVED (`withinEarthSpan` is at `:167`).
- The proposal's counts ("16 file:line citations in STATUS.md and 32 across INVARIANTS.md and the Slice 15-19 founding docs") were a hand count. The tool, counting bare `:N` continuations and plain-text citations, finds 35 in STATUS.md and 38 across INVARIANTS.md, `SLICE_17_FOUNDING.md` and the Slice 15, 16, 18, 19 and 19.5 founding documents.
- Added beyond the proposal: PARTIAL (a misquote is not drift), the "first appeared / last edited / named commit" history (the proposal had only the named commit), the paragraph-level pinned commit, context hints and `--accept-annotated`, the force-added check (a tracked file under an ignored glob with no `!` exception, INV-034's other half), placeholder names, the 7-12-or-40 commit rule, and a full hand adjudication.
- Not built as proposed: the "300-byte snapshot of STATUS.md:417-419". The extraction test needs the whole item, so the excerpt is lines 417-425 (1,073 bytes), with three more excerpts and three whole target files.

## How it works

**Units and sentences** (`linedrift.js`, pure: no fs, no git, no clock). A document is split into paragraphs, list items, table rows and headings; fenced code is skipped. Code spans follow CommonMark (a run of n backticks closes on the next run of exactly n; line endings become spaces). Quoted strings are `"…"` or curly pairs outside code, kept as snippets when they have 2+ words and 8+ characters (a one-word scare quote is not one). Sentences end at `. ! ?` before a capital, quote, backtick or bracket (not after `e.g`, `vs`, `No`), after a quoted sentence that ends in a period, at ` · `, and at every unescaped `|` of a table row; `\|` inside a table's code span becomes `|`.

**References.** A code span that is `path:lines` is a citation (the path needs an extension or a dotfile name, or a folder: `.githooks/pre-commit:53`); `:lines` alone inherits the last citation's path in the paragraph, else the first backticked path of its sentence, else of its paragraph, and the report says which. Plain text yields citations whose path has an extension (`5.9:1` and `13:43:53` do not match). A code span is a path when it has a known extension or ends in `/` and holds no glob, `$`, space, `..` or scheme; `.md` alone is not a path, and `file.new.ts`, `foo/`, `path/to/` are placeholders. A hex token is a commit candidate only at 7-12 or exactly 40 digits (git's abbreviations and full ids) with a digit and a letter; it is set aside as a content hash when it is followed by `…`, or "sha256", "md5", "shasum", "blob", "hash", "fingerprint", "tarball" stands within 40 characters before it in the same sentence. Before I added the length rule and "shasum"/"fingerprint", the full-history run called 10 tokens UNREACHABLE-COMMIT; all 10 were hashes.

**Pairing.** Each snippet goes to one citation in its sentence: one joined to it only by connective words (`` `x` is at `:7` ``, `` `:646` (`Grid…`) ``, "renders", "reads", "at", "(") if there is one; otherwise the nearest within 80 characters, with a citation across a clause break (`,`, `;`, "and", "but") only as a last resort. These rules are heuristics tuned on this corpus; the 80-character gap and the connective list were set after reading the first run's GONE findings, three of which were snippets from another clause. Unpaired citations get only the range check and read IN-RANGE.

**Resolution.** A path is tried from the repository root, then from the citing document's folder (`mcp/README.md` cites `src/tools/…`), then as a unique suffix of a tracked file (`porkchop-view.ts:468`), then as a suffix whose folder the same paragraph names; several candidates read UNCHECKABLE with the count (`main.ts:291`: 10 files). A missing path gets same-name suggestions (`src/v2/launch-vehicles.ts` → `src/v2/porkchop/launch-vehicles.ts`).

**Judging.** Tracking comes from one `git ls-files -z`; ignore rules from one `git check-ignore -v -n -z --stdin` over every untracked or missing target (the INV-034 command, which never reports tracked files), and one more with `--no-index` over tracked files, which finds force-added files under an ignored glob. Lines: a cited range past the end is PAST-EOF. A snippet is searched in the file with whitespace collapsed (exact), then with every dash folded to `-`, every quote mark to `"` and `×` to `x` (loose; STATUS writes `x` for the source's `×` and ASCII hyphens for en dashes, audit finding A4-F20), then, for code, with all spaces removed (`confidence:"assumed"` against `confidence: 'assumed'`). An elided quote is searched by its longest part. OK if any occurrence touches a cited line, MOVED (with up to six places) if it occurs elsewhere, else GONE; with several snippets the best wins. PARTIAL needs the cited lines to hold a run of at least 5 consecutive snippet words that is at least a third of it. Commits: one `git cat-file --batch-check`; in a shallow clone a missing commit is UNCHECKABLE with the boundary named, never UNREACHABLE; one `git rev-list HEAD` tells whether a found commit is an ancestor of HEAD. Without git (the checkout has no `.git` of its own; `GIT_CEILING_DIRECTORIES` stops git walking up) lines and existence are still checked and everything else reads UNCHECKABLE.

**History** (drift only). `first`: `git log --format=%H -S <reference> --reverse -- <doc>`, the first commit whose document contains that text (skipped for a bare `:N`). `last`: `git blame --porcelain --root`, the commit that last changed the line. `pinned`: the single commit in the sentence, else in the paragraph. Each tree is read with `git ls-tree` and `git cat-file blob` and the same judge runs on it. This occurrence's citation was written between `first` and `last`; when they disagree both are printed. A commit at a shallow clone's boundary stands for older history and is not judged.

**What every number traces to.** The counts, statuses, notes and history lines are the output of `line-drift.mjs` on `/home/user/asteroid-mining-planner` at `62ddb17` (`example.txt`) and on a full clone of `https://github.com/hudsonclavin-cloud/asteroid-mining-planner` checked out at `62ddb1713feab34ac0730ecd66f18db8a076d718` (`example-full-history.txt`; the clone lived in scratch space and was deleted). The verdict classes and their evidence are mine (`adjudication.json`). `report-data.js` is generated from those three by `build-report.mjs`. `snapshots/` holds four line excerpts cut by `build-data.mjs` (STATUS.md 417-425 and 535, INVARIANTS.md 171-180, SLICE_9_FOUNDING.md 423-428) and three whole files copied by `tools/snapshot.mjs` (`.gitignore`, `.githooks/pre-commit`, `src/v2/app/porkchop/main.ts`), each with a provenance sidecar at 62ddb17.

## Tests

`linedrift.test.mjs`, 26 tests (21 run anywhere, 4 need the checkout, 1 the full clone):

- **The pure module** (9). CommonMark code spans; extraction of full, bare, comma-list and plain-text citations with fenced code skipped and `5.9:1` ignored; the three inheritance rules for `:N`; the commit rule (7, 12 and 40 digits in; a 16-digit prompt prefix, a 24-digit run id, a shasum, an 8-digit sha256 prefix, `defaced` and `1234567` out); paths, placeholders and non-paths; pairing (connectives bind, a quote that ends its sentence stays there, 61 characters pairs and 101 does not); every line verdict (OK, MOVED with `:3`, GONE, PAST-EOF with "the file has 7 lines; snippet now at :3", IN-RANGE, the loose `×`, the compact quote style, PARTIAL "14 of the snippet's 16 words", a 4-word run that is not PARTIAL); resolution (document folder, unique suffix, folder in the paragraph, ambiguity, same-name suggestion); annotation found in a later paragraph but not for a 9-character name.
- **The CLI on a git repository built in the test** (7): two commits, one inserting two lines in `a.ts` and deleting `gone.json`. Every proposal status with where the snippet went (`a.ts:3` → `:5`, `:7` → `:9`), IGNORED with `.gitignore:3`, force-added, UNTRACKED, MISSING-PATH annotated at `:25`, a reachable and an unreachable commit; history (held where it first appeared, MOVED at a later edit of the line, GONE from the start); `--rev` at the first commit; the allowlist (all drift allowed exits 0, one missing leaves 1, a blank reason refuses) and `--accept-annotated` (exactly the two annotated `gone.json` lines); a `--depth 1` clone where the unreachable commit reads UNCHECKABLE and no commit is called unreachable; a git-less copy; usage, refusals, `--help` and Markdown.
- **Real Aster prose and targets from `snapshots/`** (5), pinned to what the documents and the audit say: STATUS.md:417-425 yields exactly `main.ts:637`, `:646`, `:187-194`, `:189` and one bundle path with the right snippets; against main.ts at 62ddb17 the literal is GONE, `:189` MOVED to `:196`, and line 647 holds the derived label; INV-034's prose pairs its quote with `SLICE_9_FOUNDING.md:202` and leaves `.gitignore:17` unpaired; the SLICE_9 amendment against `.gitignore` gives MOVED to `:19` (the audit's off-by-two, `ASTER_AUDIT_REPORT.md:924`, `:1020`); the C17 row unescapes `\|`, reads GONE, and the old pattern is found only on `:51`.
- **The checkout** (4, skipped unless `/home/user/asteroid-mining-planner` is clean at 62ddb17): the three spot checks re-judged (including the SLICE_15:212 correction text); INV-034's own origin, `slice9-cutover-sample.json`, reads IGNORED by `.gitignore:19`, and the audit row at `:563` is read from the file; no commit called unreachable in the shallow clone; and the README's counts table, `example.txt` and the key set of `adjudication.json` all equal a fresh run.
- **The full clone** (1, with `LINE_DRIFT_FULL_CLONE`): HEAD is 62ddb17 and not shallow, no UNREACHABLE-COMMIT, every commit-shaped token resolves or reads as a hash, `example-full-history.txt` reproduces (checkout path normalised), and the drift keys equal the shallow run's.

**Teeth.** I broke the code sixteen ways in a copy of this folder and counted the tests that newly fail (25 run, the full-clone test skipped; the baseline is 25 passing). Every sabotage is caught; the README/example/adjudication test catches ten of them as well, because the saved run stops matching:

| Sabotage | Tests that fail |
|---|---:|
| Cited-line overlap never true (every found snippet reads MOVED) | 4 |
| Line numbers off by one in extraction | 12 |
| Pairing gap 80 → 1,000 characters | 2 |
| Connective words ignored in pairing | 3 |
| No loose folding of dashes, quotes and × | 2 |
| A commit missing from a shallow clone called UNREACHABLE | 3 |
| No resolution from the document's folder | 1 |
| Force-added check off | 1 |
| Any 7-40 hex digits taken as a commit | 2 |
| Gone/correction words never match | 3 |
| History judged at HEAD instead of the older commit | 2 |
| Exit 0 even with drift | 1 |
| PARTIAL from a 3-word run | 1 |
| Plain-text citations ignored | 2 |
| PAST-EOF check off | 2 |
| `git check-ignore` result dropped | 3 |

`ui-check.mjs`, 44 checks: the tiles equal the data and `adjudication.json` (30 / 63 / 5, partitioning the 98); one bar per document whose segments sum to its findings; the GONE chip lists exactly the 8 GONE findings; the class, document and text filters (stale claims, then in STATUS.md, then "pre-commit" leaves one card naming `f7b19e7`); a bar segment sets the filters; the `.gitignore:17` card shows MOVED to `:19` and "held" at `ac24663`; the status table equals the data; Try it computes `.gitignore:17` on line 427 MOVED to `:19` in the page, OK once the two comment lines are deleted, refuses an empty passage and one with no reference, and calls a commit UNCHECKABLE without git; Space presses a focused chip; at 390 px in dark mode nothing scrolls sideways, the dark colours are the dark steps, a tap on a segment filters, and there are no console errors at either size.

`node tools/check.mjs ideas/23-line-drift` passes: README format, size, snapshot sidecars, the tests, `check.mjs` (the UI check), and the smoke test at 1280 and 390 px.

## Honest assessment

What works:

- **[Certain]** The mechanical statements are right for every finding I checked: all 73 MISSING-PATH paths are absent at 62ddb17, both IGNORED paths match the rule shown, and every MOVED or GONE snippet is or is not where the tool says. Of the 21 MOVED and GONE verdicts, 17 are drift a maintainer would fix (8 stale line numbers, 7 stale claims, 2 off when written), 1 is a past-tense record whose lines moved under it, and 3 are false alarms from pairing. One of the 7 stale claims is right for the wrong reason (`STATUS.md:429`: `loader.ts:8-9` no longer re-exports the Slice 7 and 8 loaders, but the snippet the tool searched, an asset glob, was never in that file).
- **[Certain]** In the full-history clone every one of the 577 commit references names a commit that is an ancestor of HEAD. Commit drift is not where Aster's control plane rots; line citations and named files are.
- **[Certain]** The history column separates drift from history: 16 of the 73 MISSING-PATH findings are records of a named past commit (bundles a rebuild produced or replaced, a file committed for the first time), and the pinned-commit check confirms each against that commit's tree; the citation `.gitignore:17` held when written at `ac24663` and drifted when two comment lines were inserted above it.
- **[Likely]** `--accept-annotated` excused exactly the 23 findings I judged acknowledged and nothing else at 62ddb17 (73 remain failing). The context words and the 12-character rule for bare names were tuned on these documents, so on others I would expect misses both ways.
- **[Likely]** The page, the tests and the CLI run with Node 22 built-ins and git; nothing is installed or fetched.

What is rough:

- **[Certain]** Pairing is a heuristic. Three of 98 findings are false alarms from it (a sentence's subject, a function name around the cited rotation lines, a paraphrase in code formatting) and 53 citations carry no usable snippet, so a stale line number there is invisible. Of the 30 findings that need a fix, the tool's evidence is wrong for one.
- **[Certain]** A shallow clone hides nearly all history. Aster's local checkout has 50 commits; its run can judge 39 of 577 commits and almost no history lines. Aster's CI `full-tests` job already fetches full history (`.github/workflows/ci.yml:81`, commit 62ddb17), which is where this would run.
- **[Certain]** "first appeared" is the first commit whose document contained the reference's text anywhere; when the same reference appears on several lines, a later occurrence was written later than that. The line's last edit bounds it from the other side, and both are printed.
- **[Certain]** It cannot tell a shorthand (`view.ts:974` for `porkchop-view.ts:974`) from a missing file, a placeholder from a real name beyond a short list, or a path in another repository from a missing one; those read MISSING-PATH with hints, and the allowlist is the remedy.
- **[Likely]** The adjudication is one reader's. Each verdict names the file, line and commit it rests on, so it can be checked, but a second reader may class some history/stale-claim borderlines differently (for example `STATUS.md:345`, a past-tense record I called history).
- **[Speculative]** That maintainers will act on a 73-item failing list. With `--accept-annotated`, an allowlist of the 45 history, plan, not-in-repository and false-alarm findings leaves the 28 drift findings that need a fix (the two misquotes are PARTIAL and never fail); whether the rest should be allowlisted, annotated or rewritten is a decision for the founding-document process, not this tool.

**Findings about the source repo** (at 62ddb17; full evidence per item in `adjudication.json` and on the page):

1. `STATUS.md:417-425` (Slice 19 item 1) says the porkchop literal "Grid spans 2026-2040 departures …" at `src/v2/app/porkchop/main.ts:637` is "NOT fixed". It was fixed at `446e3a7` (2026-10-14; the derived label is at `main.ts:647`). In the same item, the `Grid: ${GRID_PARAMS.nDep}x${…}` line cited at `:646` no longer exists, `:189` is now `:196`, and the bundle named at `:425` (`docs/assets/porkchopV2-z3nhVK2W.js`) is gone; `docs/assets` ships `porkchopV2-CeMrUCV7.js`.
2. `STATUS.md:535` (Cleanup C17) describes the additive-only hook's `grep -c '^-[^-]'` at `.githooks/pre-commit:53` as an open bug. `f7b19e7` (2026-09-22) fixed it; the pattern survives only in the comment at `:51`. The audit at `69472a3` said the same; it is still open at 62ddb17.
3. `STATUS.md:28` (Deploy boundary): none of the 13 bundle names exists in `docs/` at 62ddb17. The audit found one of 13 at `69472a3`.
4. `STATUS.md:239` and `:256` say the ui-overlay porkchop passes `M: 1` at `app/ui-overlay/overlay.ts:339`; it now passes `M: 0` at `:341` with the M=1 contour toggle.
5. `STATUS.md:429`: `src/v2/app/solar-system/loader.ts:8-9` no longer re-exports the Slice 7 and 8 catalog loaders (line 8 re-exports the Slice 9 loader), so the paragraph's reason for those catalogs entering the build is stale. I did not re-measure whether they are still bundled.
6. Stale line numbers: `src/v2/SLICE_9_FOUNDING.md:427` `.gitignore:17` → `:19` (the audit's A2-F13/C1-F10, still unfixed; `INVARIANTS.md:179` cites the same `.gitignore:17`, which the tool can only range-check because its sentence has no snippet); `STATUS.md:213` `main.ts:916` → `:996`; `mcp/README.md:59`, `:73`, `:75` `compute-shared.ts:130-136`, `:146-148`, `:139-144` → `:141`, `:179`, `:167`; `src/v2/SLICE_16_FOUNDING.md:247` `:237-267` → `:270`; `src/v2/SLICE_19_FOUNDING.md:85` `honesty-disclosure.ts:74-82` → `:83`.
7. Off when written: `STATUS.md:253` cites `porkchop-view.ts:468` for `findGlobalMinimumCell`, which was on `:468` at `a7670c4` (2026-08-31) but on `:508` when the citation was committed at `01494ee` (2026-09-02); `INVARIANTS.md:178` attributes "the committed 162-body set" to `SLICE_9_FOUNDING.md:202` and `:350-353`, which never held that phrase; it is the cutover harness's, quoted in the amendment at `:426-427`.
8. `src/v2/SLICE_19_5_FOUNDING.md:57` (locked) says the FK3 tour's AMBER step "still says 'flies only with a dogleg'" at `fk3-guided-tour.ts:36`; it was on `:37`, and `e6d4f7f` (2026-10-14) replaced the copy. The locked document does not record the fix.
9. Misquotes: `SLICE_17_FOUNDING.md:617` drops a clause from the Stuart & Binzel quote at `V6_H_TO_DIAMETER_VERIFIED.md:33` without an ellipsis; `src/v2/SLICE_19_5_FOUNDING.md:413` quotes "not a liftable formula" where `3d-verification-record.md:22` says "not as a liftable formula".
10. `src/v2/SLICE_13_FOUNDING.md:98` cites `aster-audit-reports/slice13-phaseF-audit.md`, a folder outside the repository, as the record that closed the Phase F gates. The showcase recon from the same folder is annotated as untracked at `:112`; this one is not. That is the INV-034 pattern.

Gates this has not been through: Aster's multi-agent audit (it touches no math layer, but its verdicts would feed STATUS), the founding-document DEC process for the status vocabulary and the allowlist policy, the session-start and CI wiring AGENTS.md would need, and an independent second adjudication of the 98 findings. It is an idea-bank prototype.

## Where it would land

Aster, as `tools/lint/citations.mjs` (with `linedrift.js` beside it and these tests under `tests/`), run two ways: at session start next to `git log --oneline -1` (AGENTS.md §2 "Session start"), printing the drift in STATUS.md before an agent trusts it; and in the CI `full-tests` job, which already has full history, so the history column works there. Its table would feed each STATUS refresh. To ship for real:

- agree the status vocabulary and add it to AGENTS.md (a protected path: a Hudson-signed dispatch);
- decide whether `--accept-annotated` is the default for the additive-only founding documents (whose stale sentences are kept and annotated, never deleted; it excuses the 23 acknowledged findings), and commit an allowlist, with reasons, for the other 45 that need no fix (17 history, 14 plans, 9 not in the repository, 5 false alarms);
- fix or annotate the 30 that need a fix (the ten findings above), then make the job fail on new drift only;
- replace the snapshot-based tests with tests against the repository itself, and have a second reader re-adjudicate before any verdict is quoted as fact.
