# Held for next week

On 2026-10-26 the owner asked to stop spending on ideas 20 and above and to save the work rather than discard it. This folder and the branch `hold/ideas-20-30` hold everything needed to pick up where it stopped. Nothing here is in the gallery yet; `tools/check.mjs` only scans `ideas/`.

## Status of every queued idea

| No. | Idea | For | State | Where the work is |
|---|---|---|---|---|
| 11 | Hole Stack | PartForge | built and checked, **not yet independently reviewed** | `main`, `ideas/11-hole-stack/` |
| 12 | Blob Basis | Aster | built and checked, not yet reviewed | `main` |
| 14 | Whose Earth | Aster + Skyhook | built and checked, not yet reviewed | `main` |
| 15 | Taper Is Not Mass | Skyhook | built and checked, not yet reviewed | `main` |
| 16 | Spin Wobble | Skyhook | built and checked, not yet reviewed | `main` |
| 17 | Known Unknowns | Aster | built and checked, not yet reviewed | `main` |
| 18 | Second Copy | PartForge | built and checked, not yet reviewed | `main` |
| 19 | Caliper Ledger | PartForge | built and checked, not yet reviewed | `main` |
| 20 | Twenty Percent Line | Skyhook | built; its builder's checks passed; not reviewed | `hold/ideas-20-30` |
| 22 | Said vs Derived | Aster | built; its builder's checks passed; not reviewed (a review was stopped part-way, no findings kept) | `hold/ideas-20-30` |
| 26 | Required Life | Skyhook | built; its builder's checks passed; not reviewed | `hold/ideas-20-30` |
| 23 | Line Drift | Aster | **complete**: kernel, CLI, page, tests, README; `tools/check.mjs` passes; not reviewed. Recovered by transcript replay | `hold/ideas-20-30` |
| 21 | Homeward Porkchop | Aster | **nearly complete**: README, kernel, 25 passing tests, page and ui-check; the builder was stopped at its final check, so the smoke test and README accuracy are unchecked. Recovered by replay | `hold/ideas-20-30` |
| 30 | Momentum Ledger | Skyhook | **kernel, Python CLI, page and tests done** (node and Python tests pass); **no README**. Recovered by replay | `hold/ideas-20-30` |
| 27 | Torque Receipt | PartForge | kernel, tests, CLI and page files written; **no README**, tests not yet checked by the bank checker. Recovered by replay | `hold/ideas-20-30` |
| 24 | Cold Read | PartForge | linter kernel, CLI and example output; **no tests, page or README**. Recovered by replay | `hold/ideas-20-30` |
| 28 | Near Field Guide | Aster | kernel and a first page; **no tests or README**. Recovered by replay | `hold/ideas-20-30` |
| 25 | Reach Census | Aster + PartForge + Skyhook | census script and its output data; **no tests, page or README**. Recovered by replay | `hold/ideas-20-30` |
| 29 | Confidence Census | PartForge | never started | proposal only |

Beyond these, `waitlist.json` holds the next fifteen candidates the judging panel ranked (31–45) and the six it dropped as duplicates.


`hold/ideas-20-30` was built on top of `main` as it stood when the hold began, so it also contains older, pre-review copies of ideas 01-13. Do not merge it; restore only the folders you want: `git checkout origin/hold/ideas-20-30 -- ideas/NN-slug`.

## What is in this folder

- `proposals/NN-slug.json`: the judged proposal for each of ideas 11–30: pitch, the open item it serves with file citations, what it computes, data plan, honesty risks, test plan, landing, and the three judges' notes.
- `build-reports/NN-slug.json`: each finished builder's own report: what it built, what the tests pin, what it found in the source repositories, how it deviated from the proposal, and what it could not do. A reviewer is given this as the list of claims to test.
- `BUILDER_BRIEF.md`, `REVIEWER_BRIEF.md`: the contracts the builders and reviewers worked to.
- `build-review-workflow.js`: the orchestration script (build, independent review, fix, and a second review only where the first found something blocking), with the brief paths pointed at this folder.
- `waitlist.json`: candidates 31–45 and the duplicates dropped.

## How to resume cheaply

What it cost this week, so the choice is informed: one builder, reviewer or fixer is roughly a third of a million tokens; every review so far found at least one real error (a wrong number, a false citation, a crash, a mislabelled certainty), and about half found something blocking.

1. **Review 11–19 first.** They are on `main` but unreviewed. One combined review-and-fix agent per idea (about eight agents) is the cheapest honest step; give it `REVIEWER_BRIEF.md`, the folder, the proposal and `build-reports/NN-*.json`.
2. **Then 20, 22, 23, 26:** restore the folder from `hold/ideas-20-30` (`git checkout hold/ideas-20-30 -- ideas/20-twenty-percent-line` and so on), run `node tools/check.mjs ideas/NN-slug`, review as above, commit to `main`.
3. **Then the part-built ones:** restore the folder, give a builder the brief, the proposal and the recovered folder, and tell it to finish rather than restart. 21 is closest to done.
4. **29** starts from its proposal.

The briefs name absolute paths under `/home/user/`. A new session that clones the four repositories to the same places can use them as they are.

## Tool change made while recovering

`tools/check.mjs` now ignores everything under `snapshots/` when it looks for an idea's tests. Idea 21 had snapshotted two of Aster's own test files as reference data, and the checker ran them as 21's tests; they import Aster's modules and fail here. Copies of source files are data, not tests.

## Recovery

The part-built folders were deleted from disk when the builds were stopped, then rebuilt the same day by replaying each builder's session transcript: every file write and edit that succeeded and every shell command, in order, in the directory it ran in, with git writes outside `/tmp` and any write into the source repositories refused. The replayed state is the builder's state at its last finished step. Provenance sidecars written during the replay carry the replay's date in `copiedAt`, not the original.
