# Reach Census
> For every test file in Aster, PartForge and Skyhook, which runner launches it and which CI job runs that runner, read from the text and checked against the real runners: Aster's CI reaches 97 of its 106 test files while the `node --test tests/*.test.mjs` its AGENTS.md calls the suite reaches 74, PartForge has no CI at all, and Skyhook's cross-language gate `tools/twin/verify.mjs` is launched by nothing.

**Kind:** linter
**For:** Aster + PartForge + Skyhook
**Run:** from the bank root, open `ideas/25-reach-census/index.html` (classic scripts, works from `file://`, no network): pick a repository and a commit, pick a runner to see what it misses, type any command to see what it would launch under Node 20, 22 or 24, and set the CI-gate policy. CLI: `node ideas/25-reach-census/reach-census.mjs ../asteroid-mining-planner ../Partforge ../skyhook` (`--fail-on orphan|manual|ci-less`, `--allow FILE`, `--json FILE|-`, `--md FILE`, `--node N`, `--no-config`, `--verbose`, `--help`; exit 0 clean, 1 files at or beyond `--fail-on`, 2 census incomplete, 3 usage). `example.txt` is that run's saved output. Tests: `node --test ideas/25-reach-census/census.test.mjs` (33 tests, about 6 s; 3 need the checkouts clean at the pinned commits and skip otherwise) and `node ideas/25-reach-census/ui-check.mjs` (39 checks in headless Chromium through the globally installed Playwright; `check.mjs` runs it for `tools/check.mjs`). `node ideas/25-reach-census/build-data.mjs` rebuilds `snapshots/` and `census.json` from the checkouts; the scripts in `oracle/` regenerate the oracle records (they need the Node binaries, venvs and network named in their headers).
**Made by:** Muster

## What it is

A static census of test reach across the three repositories. A *test file* is any tracked `*.test.*` or `*.spec.*` JavaScript/TypeScript file, `test_*.py` or `*_test.py`, plus files a repository declares in `census.config.json` (PartForge's browser harness scripts, Skyhook's `tools/twin/verify.mjs`). For each one it lists every *route* that launches it: a workflow step, a `package.json` script, or a runner command written in the repository's Markdown, followed through `npm run`, `cd`, `&&`, `||`, shell globs, `tsc` output folders and two shapes of runner script. Each file then gets a class:

- **ci**: a CI workflow step launches it;
- **ci-less**: a package script or a documented suite command (one that reaches two or more files) launches it, and no CI step does;
- **manual**: only one-file commands written in the docs launch it;
- **orphan**: nothing launches it.

Routes that only fire under a condition (an `existsSync` in a runner, `||`, a Node version) carry the condition, quoted. Two derived findings: **doc drift** (a documented command reaches a strict subset of what CI reaches) and **documented commands that reach nothing** (broken as written). Nothing is executed. "Reached" means launched, not passed. A runner the census cannot read is reported as *not understood* and the census exits 2. It is never counted as reached.

At the pinned heads (Aster `62ddb17`, PartForge `0974a62`, Skyhook `34935cb`):

| | test files | ci | ci-less | manual | orphan |
|---|---|---|---|---|---|
| Aster | 106 | 97 | 9 | 0 | 0 |
| PartForge | 27 | 0 | 15 | 12 | 0 |
| Skyhook | 7 | 6 | 0 | 0 | 1 |

The page recomputes all of it in the browser from five *packs* in `snapshots/` (three heads and two historical commits). The CLI does the same over live checkouts and can be dropped into a CI job as a gate. `landing/` holds the drafted workflow changes and allow list that would close the gaps, and a test runs the census over each one.

## Why I made it

**The open items.** I checked every citation in the judged proposal (`queue/proposals/25-reach-census.json`) against the checkouts. All held:

- Aster `package.json:11` is `node --test tests/*.test.mjs`, which is not recursive. `AGENTS.md:32` ("tests/ ← test suite: node --test tests/*.test.mjs") and `AGENTS.md:177` ("Run the test suite (`node --test tests/*.test.mjs`)") present it as the suite. CI's `full-tests` job runs `node tools/run-tests.mjs` (`.github/workflows/ci.yml:93`), which walks `tests/` and `src/v2/` (`tools/run-tests.mjs:25`). Aster already knows part of this: `STATUS.md:348` records "**CI gap, still open (L4-1):** CI runs neither the MCP package tests nor the Slice 16 suite, and the default `npm test` is not truthful about coverage", and `STATUS.md:400` queues the fix. `STATUS.md:533` (Cleanup C15) is about `run-tests.mjs` counting tests inside a run. It cannot see a file the walker never discovers. This census can.
- PartForge has no `.github/` directory. `tests/run.mjs:44-47` says two `node:test` files "shipped passing under `node --test` and were never run by this file, which is the one every doc tells you to run".
- Skyhook's `.github/workflows/ci.yml` runs `pytest tests/ -v --tb=short` (`:26`) and `python3 physics/skyhook_physics.py` (`:29`), and never `tools/twin/verify.mjs`, whose header (`:3`) calls itself "Cross-language verification gate".

Three of the proposal's scouting numbers were off, and the census corrects them. The proposal counted 103 Aster test files; there are 106. The difference is the 3 TypeScript tests in `mcp/test/`, which the proposal names elsewhere and probably left out of the count [Likely]. It said 13 files are missed by `npm test`; the real number is 23: the 13 in `tests/v2-golden/` and `tests/v2-lambert/`, plus 10 colocated under `src/v2/`. It said PartForge has 13 manual harness scripts; there are 13 `.mjs` files in `tests/harness/`, but `server.mjs` is the static server the others load the app from (its header, `:1-2`), so the config excludes it and the count is 12.

**Alternatives weighed.**
- *Run each runner under a tracer and record what it launches.* That is exact for one machine and one Node version, but it executes every suite (PartForge's harness needs Chromium, the MCP tests need a `tsc` build), and it can never say what Node 20 would do or what a doc command would do. I used it as the **oracle** instead (`oracle/runners.json`), so the static model is checked against the dynamic truth at each pinned commit.
- *Grep CI files for test file names.* Misses globs, directory walkers and `npm run` chains, which is how all three repositories actually reach their tests.
- *A per-repo checklist in prose.* It goes stale the day it is written. Doc drift is what this idea is about.

**What other ideas in the bank already cover, and what this one does instead.** No other deposit asks which runner reaches which test file. Idea 23 (Line Drift) checks that `path:line` citations in Aster's control-plane documents still resolve. It does not ask what a documented command launches, and this idea does. Idea 16 (Spin Wobble) cites `tools/twin/verify.mjs` as the check that validates Skyhook's JS physics port. This census shows nothing launches that check. It runs only when someone remembers to type it.

## How it works

**Inventory.** `git ls-files` at the checkout (a fresh CI checkout contains exactly these), test-named files outside `node_modules`, plus `extraCandidates` from `census.config.json` with their reasons and an `exclude` list (each exclusion with its reason).

**Entries.** Three sources of commands:
1. *CI*: every `run:` step of `.github/workflows/*.yml`, parsed by a YAML subset (block and flow collections, quoted and block scalars; anchors, aliases, tags, complex keys and reusable workflows are refused). Each step carries its job, `working-directory`, `shell`, the job's `actions/setup-node` major version, earlier `pip install`s, and `if:`/matrix conditions.
2. *Scripts*: every `package.json` script, with `pre`/`post` hooks and arguments passed after `--`.
3. *Docs*: runner commands (`node`, `npm`, `npx`, `pytest`, `python`, `tsc`) in code blocks, indented blocks and code spans of every tracked Markdown file. Placeholders (`<file>`, `...`, `[a|b]`) are skipped. A line that presents the command as the suite ("test suite", "must pass", "before any commit") marks that source as a *claim*. A documented command runs from its own folder first, then from the repository root.

**Evaluation** walks each command over the tracked tree:
- *Shell*: a small `sh` parser (quotes, escapes, `&&`, `||`, `;`, pipes, redirections). Words are glob-expanded as dash does (no `**`, no braces; an unmatched glob stays literal) or as bash does (braces first). After `||` a route is conditional. A `cd` that fails stops the `&&` chain. A `$VAR` or `$(…)` in a runner command is *not understood*.
- *npm*: `npm test`/`run`/`start` resolve the nearest `package.json`; `npm ci`/`install` run the install hooks; `--prefix` and workspaces are not understood.
- *node --test*: on Node 21+, each argument is a glob (globstar, braces, dot entries and `node_modules` excluded); a directory match is handed to the loader, which fails ("Cannot find module"); if nothing matched and no argument was a pattern, the run stops ("Could not find"). On Node 20, arguments are paths, a directory is searched with Node 20's name rules (every `.js/.cjs/.mjs` once the search has passed through a folder named `test`), and one missing path stops the whole run. CI steps use their `setup-node` version; scripts and docs use the repository's local Node from the config (Aster 24, `STATUS.md:339` "Node v24.18.0"; PartForge and Skyhook assumed 22 and labelled "assumed"). When Node 20 and Node 21+ would reach different files, the entry carries a version note.
- *Runner scripts*, read as text: (a) a launcher that spawns `process.execPath` over a literal list, a `readdirSync(dir).filter(...)` with `endsWith`/`startsWith`/`includes` terms, or literal `path.join` paths, inside `if (fs.existsSync(P))` blocks, whose conditions are quoted (PartForge `tests/run.mjs`); (b) a recursive directory walker fed from a list of roots, with a segment-skip predicate and a suffix filter (Aster `tools/run-tests.mjs`). Any other spawn of node in a script that mentions tests makes the script *not understood*.
- *tsc*: `tsc -p` reads `tsconfig.json` (`include`, `exclude`, `rootDir`, `outDir`) and records the emitted `.js` paths so a later `node --test dist/...` in the same chain resolves to the `.ts` sources. `extends`, `references`, `files`, `outFile` and `composite` are refused.
- *pytest*: default collection (`test_*.py`, `*_test.py`, default `norecursedirs`). Any `pytest.ini`, `pyproject.toml [tool.pytest.ini_options]`, `tox.ini`, `setup.cfg` section or collection-changing `conftest.py` makes the run *not understood*. A column-0 `pytest.importorskip("m")` makes the file conditional on `m` being installed. The route is "installed" when the CI job or the documented block `pip install`s `m`, "NOT installed" when the block installs other packages but not `m`, and unknown otherwise. `python -m unittest` is not understood.

**Classes and findings.** A file's class is its best route (ci, then ci-less, then manual, then orphan). It is *conditional* when every route at that level carries a condition. *Doc drift* is a documented command that reaches at least two files, all inside CI's reach, and fewer files than CI reaches; it is sorted by how many places present it as the suite. *Documented commands that reach nothing* are commands that look like test commands and reach no test file because they are broken or depend on the Node version.

**Packs** (`snapshots/pack-*.js`, written by `build-data.mjs`) hold what the census needs from one commit: the tracked file list (front-coded), the text of every file the census read, the documented commands of all Markdown files, and the mention lookups. Runner definitions (`package.json`, `tsconfig`, workflows, runner scripts) are kept whole. Python test files keep only their module-level skip lines. Files read only to decide they launch nothing are kept as blank lines of the same count, with their git blob id, so re-reading gives the same verdict. Every pack has a provenance sidecar. The three head packs' sidecars come from `tools/snapshot.mjs --sidecar-only`. The two historical sidecars are hand-written with the same fields, because `snapshot.mjs` records HEAD, not a historical commit. A test checks every sidecar's `writtenSha256` against the bytes on disk. The two historical packs are built from git objects: Aster `a697963`, the HEAD from which `tools/audit/sanity-69472a3/s19-5-runs/fix2-LOG.md:14` logs `npm run verify` at "96/96 files"; and PartForge `60a90cd`, the first parent of `b011ddc`, the merge whose `tests/run.mjs` comment names the two files it never ran. `census.json` is the compact census of the three heads, and a test recomputes it from the packs.

**Where every number on the page comes from:** a pack, through `census.js`, in the browser. There are no other numbers. The oracle records are in `oracle/`; the tests compare against them, and the page never loads them:

| Oracle | What it is |
|---|---|
| `oracle/node-behaviour.json` | 19 `node --test` argument lists over an 18-file fixture tree, run with real Node v20.19.5 and v24.18.0 (official linux-x64 builds from nodejs.org/dist, sha256 checked against `SHASUMS256.txt`) and the installed v22.22.0 (`oracle/node-oracle.mjs`) |
| `oracle/runners.json` | each repository's own runner on a `git archive` export of each pinned commit: Aster's `run-tests.mjs` discovery list and the `sh` expansion `npm test` hands to node (both commits); PartForge's `tests/run.mjs` banners (both commits, and again at `0974a62` after `npm ci` in `headless/`), headless `npm test`, and Skyhook's `verify.mjs` (`oracle/runner-oracle.mjs`) |
| `oracle/pytest.txt` | pytest 9.2.0 `--collect-only` of Skyhook's `tests/` in two throw-away venvs: `pytest` alone (the README Quick start) and `pytest openpyxl` (CI) (`oracle/pytest-oracle.sh`) |
| `oracle/yaml-behaviour.json` | PyYAML 6.0.3 `BaseLoader` parse of the four workflow files in the packs and 8 edge cases (`oracle/yaml-oracle.mjs`) |

## Tests

`census.test.mjs`, 33 tests, about 6 s. What they pin, and to what:

- **Real Node** (`oracle/node-behaviour.json`): on all 57 cases (19 argument lists × Node 20, 22, 24), the files the census says are launched equal the files Node ran, and the census reports a failure exactly when Node exited non-zero. A second test pins the three behaviours the findings rest on: a directory argument (Node 20 searches it, Node 21+ fails), a quoted glob (Node 20 cannot find it, Node 21+ expands it without dot entries or `node_modules`), and all-literal missing paths (Node 21+ stops).
- **Live, at test time**: `nodeGlob` against `fs.globSync` on 12 patterns, and `shExpand` against real `dash` and `bash` on 10 patterns, over a temp tree with dot files, `node_modules`, brackets and spaces in names.
- **The repositories' own runners** (`oracle/runners.json`, `oracle/pytest.txt`): Aster's CI `full-tests` reach is exactly `run-tests.mjs`'s 97-file discovery list; `npm test` is exactly the 74 files `sh` expands; at `a697963` `npm run verify` reaches exactly 96, the "96/96 files" of `fix2-LOG.md:14`. PartForge's `node tests/run.mjs` reaches the 10 files the real runner launches plus the 3 headless files under the quoted `tests/run.mjs:61` condition; with `headless/node_modules` installed the real runner launches all 13. At `60a90cd` it reaches the 6 listed files, and the two orphans are exactly `local-server` and `provider-auth`, the two `tests/run.mjs:44-47` names. Skyhook's pytest reach is the 6 files real pytest collects, and the two files real pytest skips without openpyxl are the two the census marks NOT installed on the README Quick start route and installed on CI.
- **YAML** against PyYAML on 11 documents, and a hand-written document with block scalars, folding, quotes and line numbers.
- **The census of the three heads**: the counts in the table above, the 23 files `npm test` misses (13 under `tests/`, 10 under `src/v2/`), the `AGENTS.md:32`/`:177` claim sources, the 3 `mcp/test` files reached only through `tsc`'s `dist/` output, the RUNBOOK directory command broken under Node 24 and reaching 6 under Node 20, `verify.mjs` as the single orphan, the exit code, and the allow list (an entry capped at `ci-less` does not excuse an orphan).
- **`census.json`** equals what the packs recompute to. With the checkouts clean at the pinned commits, a live `liveTree` census equals the pack census for each repository (3 tests; they skip otherwise).
- **Fixture repositories**: Aster's own walker with one root plus a doc that calls `npm test` the suite (drift, orphan, the `docs/` skip); PartForge's own `tests/run.mjs` over a fixture (the readdir pattern picks up a new file and excludes a new `flight-*` one; the headless condition); refusals (an unreadable runner is not counted and exits 2; `make test`, YAML anchors, `pytest.ini`, reusable workflows); placeholders, `cd` chains and a missing path; `tsc` `rootDir` versus the inferred root, and `extends` refused; the CLI's exit codes 0/1/2/3 and `--json`.
- **Landing**: the drafted PartForge workflow gives 13 ci and 2 ci-less (the slow parity pair). The drafted Skyhook steps make `verify.mjs` ci and the exit 0. Aster with the census as its own CI step: the census reads that step without refusing it, `--fail-on ci-less` fails on 9 files, and the drafted allow list takes the exit to 0.
- **Sidecars**: every snapshot's `writtenSha256` matches its bytes and its commit matches the pack.

**Teeth.** I broke `census.js` 25 ways, one at a time, and counted failing tests (the sabotage script lived in the session scratchpad):

| Sabotage | Failing tests |
|---|---|
| Node 21+ "Could not find" rule for all-literal missing paths removed | 2 |
| Node 20: a `test` folder above the named directory counts | 1 |
| Node glob: dot entries not skipped under `**` | 2 |
| Node glob: `node_modules` not excluded | 2 |
| trailing `**` matches no files | 2 |
| `sh` expands braces like bash | 1 |
| walker's skip predicate (`docs`, `node_modules`) ignored | 1 |
| readdir predicate's negation ignored | 1 |
| `existsSync` condition dropped | 3 |
| module-level `importorskip` ignored | 2 |
| documented `pip install`s ignored | 2 |
| doc drift: the subset check dropped | 1 |
| a one-file doc command counts as a suite | 2 |
| an unreadable runner silently reaches nothing instead of "not understood" | 1 |
| YAML value keeps its leading space (`run: \|` breaks) | 2 |
| YAML folding doubles empty lines | 1 |
| `tsc` `rootDir` ignored | 1 |
| exit 1 only *beyond* `--fail-on` | 3 |
| allow list's `upTo` ignored | 1 |
| config `exclude` ignored | 2 |
| placeholders evaluated | 1 |
| Node 20: a missing path does not stop the run | 1 |
| npm reads only the `pre`/`post` scripts | 11 |
| a failed `cd` does not stop `&&` | 1 |
| `\|\|` not marked conditional | 1 |

All 25 are caught. Three of them (doc-drift subset, placeholders, failed `cd`) are caught only by the `census.json` recompute test. That test detects any change from the committed output, but it is not an independent oracle.

`ui-check.mjs`, 39 checks: the three cards' counts equal the kernel's. The headlines are checked. Picking `npm test` shows "74 of 106" and "misses 23", dims 32 files, and shows `tests/v2-lambert` at 0 of 12. The doc route names its claim sources. The class filter works. The findings show drift, the broken RUNBOOK command and 9 CI-less files. The command evaluator gives 74 for `npm test`, Broken and 0 for the directory form under Node 24, 6 under Node 20, 87 for the quoted recursive glob under Node 24 and Could not find under Node 20. The gate shows exit 1, and 37 files at `ci-less`. PartForge shows no workflow and 13 (3 conditional), and at `60a90cd` the two orphans. Skyhook shows the orphan with its mentions, the NOT installed route, and unittest refused. No console errors or network requests. At 390 px in dark mode there is no horizontal overflow with every folder open, `#partforge` deep-links, and Enter on a focused card selects it.

## Honest assessment

**What works.**
- [Certain] At the three pinned heads and the two historical commits, every reach set the tests compare is identical to what the repository's own runner launched on a clean export: 97, 74, 96, 73, 10 (+3 conditional, 13 with headless installed), 6, and pytest's 6 with 2 conditional on openpyxl.
- [Certain] Its `node --test` model matches real Node 20.19.5, 22.22.0 and 24.18.0 on all 57 recorded cases, and its glob and shell expansion match `fs.globSync`, dash and bash on the patterns tested.
- [Certain] It refuses instead of guessing: unknown programs in CI, unreadable runner shapes, pytest configuration, `tsc` project references and YAML outside its subset all exit 2 and are listed. None of them is counted as reached.
- [Likely] The drafted landings are runnable. PartForge's two jobs were run by hand on a clean export with Node 22.22.0: `tests/run.mjs` exits 0, and headless `npm ci && npm test` passes 27 of 27 in about 13 s. Skyhook's `verify.mjs` prints PASS and exits 0 in under a second on Node 20, 22 and 24. None of them has run on GitHub's runners.

**What is rough.**
- [Certain] Only two runner-script shapes are read, the two these repositories use. A third repository, or a rewrite of either runner, will most likely be refused (exit 2) until a form is added. That is the safe failure, but it is a failure.
- [Certain] "Reached" means launched. Whether the file passes, whether its dependencies are installed (other than the quoted `existsSync` and `importorskip` conditions), whether it is fast enough for CI, and which branches trigger the workflow are not modelled. Aster's golden test needs Node ≥22.18 (the comment at `.github/workflows/ci.yml:64-67`), and the census only knows the major version.
- [Likely] The `ci-less` / `manual` line is a heuristic: a documented command that reaches two or more files counts as a suite. The "presented as the suite" label comes from a phrase list over the surrounding prose, so it can miss a claim or flag a mention.
- [Likely] The local Node version for PartForge and Skyhook is assumed (22) and shown as assumed. Only Aster records one (`STATUS.md:339`).
- [Certain] The PartForge harness count (12) depends on the config's judgement that `tests/harness/*.mjs` are checks. `probe.mjs` and `run.mjs` there are measurement tools more than pass/fail checks.

**Findings about the source repos** (none fixed there):

*Aster at `62ddb17`*
1. [Certain] `AGENTS.md:32` and `AGENTS.md:177` present `node --test tests/*.test.mjs` as the test suite. It reaches 74 of the 97 files CI's `full-tests` job runs (`.github/workflows/ci.yml:93`). It misses 23: 12 in `tests/v2-lambert/`, 1 in `tests/v2-golden/`, 8 in `src/v2/porkchop/`, 1 in `src/v2/boundary/`, 1 in `src/v2/app/catalog-list/`. `npm test` (`package.json:11`) is the same command and is written in 17 places, among them `AGENTS.md:163` and `.claude/skills/dispatch-writer/SKILL.md:108`. This is the "not truthful about coverage" half of L4-1 (`STATUS.md:348`), now with a count.
2. [Certain] `tools/slice16-harness/RUNBOOK.md:41`, `:217` and `PRE_RUN_GATE.md:56` write `node --test tools/slice16-harness/test/`, a directory. Under Node 21+ that fails with "Cannot find module" and runs nothing; under Node 20 it runs the 6 files. Real Node 22.22.0 and 24.18.0 fail on the same form in the fixture tree. `STATUS.md:347` says the last Node 20 machine is retired, so the runbook form is broken on every machine the project now uses. The `*.test.mjs` form at `STATUS.md:341` works.
3. [Certain] The 3 `mcp/test/*.test.ts` files and the 6 `tools/slice16-harness/test/*.test.mjs` files are run by no CI step (the other half of L4-1, `STATUS.md:348`, `:400`). The mcp ones are reached only by `npm test` in `mcp/` (`mcp/package.json:37`: `tsc -p .` with `rootDir ".."`, then `node --test dist/mcp/test/*.js`). That emission path is modelled, not run here [Likely].

*PartForge at `0974a62`*

4. [Certain] There is no workflow file, so no test runs on a push or a pull request. `node tests/run.mjs`, written in 21 places (first `README.md:676`), is the suite every doc names.
5. [Certain] Without `headless/node_modules/openscad-wasm`, `node tests/run.mjs` skips the headless api/http/llm tests (`tests/run.mjs:59-63`) and still ends "all suites passed" with exit 0. On a fresh clone it runs 10 of its 13 files.
6. [Certain] `headless/test/parity.test.mjs:5-6` says "`npm test` here does" run it. `headless/package.json:18` (`test`) runs only api/http/llm; parity and eval-truth are under `test:parity` (`:19`). The comment is stale.
7. [Certain] 12 harness scripts in `tests/harness/` are reached only by one-file commands in `tests/harness/README.md` and `docs/STATUS.md`.
8. [Certain] At `60a90cd`, `tests/run.mjs` launched its 6 listed files and `tests/local-server.test.mjs` and `tests/provider-auth.test.mjs` were orphans. This confirms the later comment at `tests/run.mjs:44-47`. At `0974a62` the name-pattern readdir reaches both.

*Skyhook at `34935cb`*

9. [Certain] `tools/twin/verify.mjs`, "Cross-language verification gate" by its own header (`:3`), is launched by no CI step, package script or documented command. It is named, not as a command, only at `materials/core.md:96` (as the source of a [Certain] claim) and `tools/sims/skyhook_program_site.html:948`. On a clean export it passes in under a second with no install.
10. [Certain] The README Quick start (`README.md:69-70`) installs only `pytest`, then says "all physics tests should pass". With that install, real pytest 9.2.0 skips `tests/test_export_grid.py` and `tests/test_finance.py` whole (`importorskip("openpyxl")`) and collects 45 of the 74 tests CI collects. CI installs openpyxl (`ci.yml:23`, added in `941b8c0` "ci: install openpyxl so analysis-layer regression tests run"). The skip is by design (`docs/DEVIATIONS.md:11`), but the Quick start was not updated with CI [Likely].

**Gates this has not been through.** It is an idea-bank prototype. Aster: it touches CI, which is protected territory. It has not been through the multi-agent audit or the founding-doc DEC process, and a change to `AGENTS.md` needs a dispatch. PartForge: no skeptic review, and its maintainers have not seen the drafted workflow. Skyhook: no VM verification, and it is not part of the pytest suite. It has had no independent review in this bank yet.

**How this folder came to be.** It was begun by a builder before the 2026-10-26 hold, which stopped it after the census kernel, the CLI, `build-data.mjs`, the five packs and `census.json`. It was recovered from `hold/ideas-20-30` by transcript replay and finished on 2026-11-02.
- *Kept*: the kernel's structure, the CLI, `build-data.mjs` and the config. The rebuilt packs reproduced the replayed ones byte for byte at the pinned commits (PartForge's changed only through the config change below).
- *Fixed in `census.js`* (each now has a test):
  - Node 21+ said a missing literal path "does not fail"; real Node stops with "Could not find" when no argument is a pattern.
  - Node 20's directory search counted a `test` folder above the named directory.
  - A trailing `**` matched no files.
  - The YAML subset could not parse `key: |` block scalars, the usual form of a multi-line `run:` step, because the value kept its leading space. Such a workflow would have been refused (exit 2). None of the three repositories' workflows uses one, so their census was unaffected.
  - Folded scalars doubled empty lines, and `|+` counted the file's final newline as a line.
- *Changed*: `server.mjs` excluded through a new config `exclude` field; `census.json` made smaller.
- *Added*: provenance sidecars (the snapshots had none), the oracles, the tests, the page, `ui-check.mjs`, `example.txt`, `landing/` and this README.

## Where it would land

- **Aster.** Copy `census.js` and `reach-census.mjs` to `tools/reach-census/`, with `landing/aster-reach-allow.json` as `allow.json`, and append the step in `landing/aster-ci-step.yml` to the `full-tests` job. Then CI fails the day a new test file lands where no CI step reaches it, which is how 23 files drifted out of `npm test`'s reach. The two allow entries cite L4-1 and are meant to be deleted in the commits that add the MCP and Slice 16 jobs (`STATUS.md:400`). Separately: change `AGENTS.md:32` and `:177` (and `package.json:11`, if `npm test` should mean the suite) to `node tools/run-tests.mjs`, and replace the directory form in `RUNBOOK.md:41`, `:217` and `PRE_RUN_GATE.md:56` with the `*.test.mjs` glob. `AGENTS.md` is the authority file, so that needs a dispatch.
- **PartForge.** `landing/partforge-ci.yml` as `.github/workflows/ci.yml`. It has two jobs: `node tests/run.mjs` (no dependencies), and headless `npm ci && npm test`. `test:parity` is left out because its own header calls it slow. The maintainers should also correct `headless/test/parity.test.mjs:5-6`.
- **Skyhook.** The two steps in `landing/skyhook-ci-steps.yml` appended to the `test` job in `ci.yml` (`setup-node`, then `node tools/twin/verify.mjs`). The Quick start at `README.md:69` should install `openpyxl` too, or say that two files skip without it.
- **To ship any of it for real:** a reviewer outside this bank, a run on GitHub's runners, and a decision per repository on `--fail-on` (`orphan` is safe today everywhere except Skyhook until the step lands; `ci-less` needs the allow list).
