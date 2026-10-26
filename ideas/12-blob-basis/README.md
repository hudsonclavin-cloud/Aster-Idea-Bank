# Blob Basis
> Hashes a file on six bases at once (working copy and committed blob, each as it is, CRLF-folded and CRLF-synthesised) and names the basis a recorded hash was taken on: at Aster 62ddb17 the screening cache's Horizons hash is the committed blob's, while earth-vz-span-max.json pins the CRLF form, 7,214,102 + 295,920 = 7,510,022 bytes, which no clone reproduces without adding a CR to every line.

**Kind:** tool
**For:** Aster
**Run:** from the bank root, `node ideas/12-blob-basis/blob-basis.mjs /home/user/asteroid-mining-planner src/v2/data/horizons-inner-solar-system-2026-2040.json --expect c91f4e50` (one file: six bases, a verdict, the hash placed), or `node ideas/12-blob-basis/blob-basis.mjs <repo> --scan <provenance.json> --map KEY=PATH --history --require blob` (every recorded hash in a JSON file); `--help` for the rest; exit 0 held, 1 a hash matched no basis (or not the `--require` one), 2 refused, 3 usage. `example.txt` is saved output of five runs against the Aster and Skyhook checkouts. `ideas/12-blob-basis/index.html` shows those runs and checks a copy you pick, in the browser (classic scripts, works from `file://`, nothing is uploaded). Tests: `node --test ideas/12-blob-basis/blob-basis.test.mjs` (20 tests, Node built-ins, about 25 s with both checkouts, 1 skipped here) and `node ideas/12-blob-basis/ui-check.mjs` (80 checks in headless Chromium through the globally installed Playwright; `check.mjs` runs it for `tools/check.mjs`). `node ideas/12-blob-basis/build-example.mjs` regenerates `example.txt` and `example-data.js` (`--check` says whether they are stale); `build-data.mjs` derives the one snapshot that lives in history.
**Made by:** Carriage

## What it is

A provenance hash says "these bytes went into this artefact". It is only checkable if you know which bytes. For a text file in a git checkout there are at least six candidates, and they hash differently:

| | as it is | CRLF folded to LF | a CR before every bare LF |
|---|---|---|---|
| **disk**: the working-tree file (or any copy, with `--against`) | `disk` | `disk-lf` | `disk-crlf` |
| **blob**: `git cat-file blob REV:path`, what a clone has and a static host serves | `blob` | `blob-lf` | `blob-crlf` |

`blob-basis.mjs` reads both sources, makes the six byte strings, hashes each one three ways (sha256, md5, and the git blob id), groups the ones that are byte-identical, and answers two questions:

1. **How does the copy relate to the commit?** `IDENTICAL` (byte for byte), `CRLF-CHECKOUT` (exactly the blob with a CR before every LF, what a Windows checkout writes), `EOL-ONLY` (same content once line endings are folded, but not a plain CRLF checkout: mixed endings, or a blob committed with CRLF), `DIRTY` (the content differs), or `UNTRACKED` / `NOT-ON-DISK` / `UNAVAILABLE` with the reason.
2. **Which basis was a recorded hash taken on?** `--expect HEX` (or every hash in a JSON file with `--scan`) answers `BLOB-BASIS` (reproducible from any clone), `CRLF-BASIS` (only by re-adding CRs), `LF-BASIS`, `WORKTREE-BASIS` (only from this copy), `HISTORY` (an older committed version, with `--history`), or `NO-MATCH`, and lists every basis it equals. A recorded byte count next to the hash is checked too.

Run against Aster at `62ddb17` (saved in `example.txt`), it places all four hashes Aster's two provenance files record:

| Recorded in | Hash | About | Placed |
|---|---|---|---|
| `tests/fixtures/v2/lambert-screen-cache.json` `metadata.provenance.horizonsFixtureSha256` | `b278dd5567f30266593c49bf4fef203e7570d3613187fd112dc7015109a39c15` | the Horizons fixture | **BLOB-BASIS** |
| same, `catalogFixtureSha256` | `f88028d2…` | `tests/fixtures/v2/nea-catalog-slice9.json` | **BLOB-BASIS** |
| same, `precomputeScriptSha256` | `44d9443500cb280a625fc99cfd12756c2928430390cda8c46d7b55763f6db4f7` | the generator script | **NO-MATCH** at 62ddb17 (the script there hashes to `124637322914b33e388a362ee96e87cde40718c2366c93f21b355afe2995c780`); history before `fbe8e89` is not in this shallow clone. What the full history shows is under *Findings*. |
| `tools/slice12-research/data/earth-vz-span-max.json` `fixture.sha256`, `fixture.bytes` | `c91f4e50da0e6fc550bc5900a94b95aa9256b9623dfcb876d01b22501241bc49`, 7,510,022 | the Horizons fixture | **CRLF-BASIS**, bytes agree |

With `--require blob`, the gate a CI job could run, that scan exits 1: two of the four cannot be reproduced from a clone. The same tool on Skyhook places `finance/decision_grid.json`'s `rev_a_md5` on the blob basis today, and the value commit `34935cb` replaced (`7540d4fb6b031a5f7117098ab07e656e`, read from the parent commit) on the CRLF basis, which is the cause that commit's message gives.

The page (`index.html`) draws the Horizons fixture's six bases as a grid (same letter and colour = same bytes), lists every placed hash with its explanation, shows the seven files the MCP package bakes (all `IDENTICAL` at 62ddb17), and has a **Check a copy** panel: pick a file, paste the committed blob id (`git rev-parse HEAD:path`) and a recorded hash, and it does the same in the browser. Four samples (an LF text, its CRLF twin, a mixed copy, a mixed copy with one digit changed) show the four verdicts without a file.

## Why I made it

Aster has an open question that is exactly this. OQ-17-7 (screening-cache reproducibility, `SLICE_17_FOUNDING.md:392-394`) was restated in `STATUS.md:452-461` (Slice 19 item 5): the cache's recorded `horizonsFixtureSha256` is the hash of the fixture's committed LF blob, a CRLF checkout hashes to `c91f4e50…`, and the generator hashes the bytes it reads (`tools/build/precompute-lambert-screen.mjs:181`), so "Verify provenance against `git cat-file blob`, never against on-disk bytes." The independent audit at `69472a3` found the same pattern in a committed measurement (`tools/audit/sanity-69472a3/ASTER_AUDIT_REPORT.md:316-319`, consensus row `:554`, three readers) and recommended re-pinning it "on the committed-blob basis rather than a CRLF working copy" (`:501-502`, recommendation 13). The locked Slice 19.5 founding document schedules that as Front D3 (`src/v2/SLICE_19_5_FOUNDING.md:305-306`), and notes at `:44-45` that "D04 fixed the fixture, but `earth-vz-span-max.json` still pins the CRLF hash". Every site that turns a file into a provenance record reads the working copy, not the blob: the generator's three hashes (`precompute-lambert-screen.mjs:180-182`), `tools/slice12-research/measure-earth-vz.mjs:77-78`, and `mcp/scripts/bake-provenance.mjs:48`, which copies working-tree files into the published package.

Nobody has a tool that answers "which bytes was this hash taken on?". Each fix so far was a person hashing by hand and reading the result. Alternatives I weighed:

- **Normalise before hashing**, Skyhook's answer (`finance/export_grid.py:97`, commit `34935cb`: hash text "modulo line endings", explicitly "not a tamper seal"). It stops the mismatch for new records but cannot say what an existing record was taken on, and Aster's records are sha256 of exact bytes. Blob Basis is the reconciler that either choice still needs, and it reads Skyhook's md5s too.
- **A one-off script for the one fixture.** It would close D3's measurement half and nothing else; the scan found a second unexplained hash (the generator script) in the same block.
- **A `.gitattributes` lint.** Already done in Aster (`.gitattributes:21-22`, `* text=auto eol=lf`, S19-D04), and it governs checkouts, not records already written.

A basis report with a verdict, a placer for recorded hashes, a scanner for provenance JSON and a history search won because it answers the open question with evidence, works for every provenance record in all three repositories, and refuses (exit 2, `UNAVAILABLE` with the reason) instead of guessing when git, the revision or the path is missing.

## How it works

**The six byte strings** (`basis.js`). `toLf` folds each CR+LF pair to LF in one pass and leaves a lone CR alone, which is what git's CRLF-to-LF conversion does (a test passes a CRLF text through `git hash-object --path=<a text=auto path>` and gets the blob id of `toLf` of it). `toCrlf` puts a CR before every LF that lacks one; it is idempotent, and its line-ending counts follow from the input's (every bare LF becomes a CRLF, a lone CR stays lone), which a 2,000-case property test checks. `toLf` has no such shortcut: `\r\r\n` becomes `\r\n`, which turns a lone CR into a CRLF, so its counts are recounted. Byte-identical candidates are hashed once and share a *family*; the CLI compares with `Buffer.equals`, the page byte by byte.

**Hashes.** sha256, md5 and SHA-1 are written out in `basis.js` (FIPS 180-4, RFC 1321) so the page works from `file://` with nothing installed; their round constants are computed from their definitions (cube and square roots of primes, `|sin(i+1)|·2³²`) rather than typed. The CLI passes `node:crypto` in instead. A git blob id is SHA-1 over `"blob <decimal length>\0"` followed by the bytes. Recorded values are classified by length: 64 hex sha256, 40 git blob id, 32 md5, 8 to 31 a prefix of any of them (prose like `b278dd55…`).

**Verdicts.** `IDENTICAL` if disk and blob are one family; `CRLF-CHECKOUT` if disk equals `blob-crlf`; `EOL-ONLY` if `disk-lf` equals `blob-lf`; else `DIRTY`. For anything but `IDENTICAL`, the CLI also asks git for a second opinion: `git hash-object --path=<path> --stdin` runs the bytes through the filters `.gitattributes` selects (what `git add` would store) and says whether that is the committed blob id. A placed hash is `BLOB-BASIS` if it equals `blob`, else `CRLF-BASIS` if `blob-crlf`, `LF-BASIS` if `blob-lf`, `WORKTREE-BASIS` if only disk forms, else `NO-MATCH`. When all available bases are one byte string (a file with no line endings), the match is reported as unable to tell bases apart.

**`--scan`** walks a JSON file for strings of 64 or 32 hex, and 40 hex under a key containing "blob"; other 40-hex strings (commit ids such as `solverCommit`) are listed with whether this clone has the object. The file a hash is about comes from `--map KEY=PATH` (a key name or a JSON pointer), else from a sibling `"path"` string; with neither it is `UNRESOLVED` (exit 2), never guessed. The cache records hashes without paths, so the three `--map` lines come from the generator: `HORIZONS_FIXTURE` at `precompute-lambert-screen.mjs:159-165`, `NEA_FIXTURE` at `:166`, its own file at `:167`, hashed in that order at `:180-182`. A test re-reads those lines at the snapshot commit and fails if they change.

**`--history`.** For a hash that matches nothing at `--rev`, walk `git rev-list REV -- path`, take each distinct blob, and place the hash on its `blob`, `blob-lf` and `blob-crlf`. A hit names the commit that introduced that version. In a shallow clone it says how far back it could look and that older versions are not there to check.

**What every number traces to.** The recorded hashes come from three snapshots taken with `tools/snapshot.mjs` (`lambert-screen-cache.metadata.json`, `earth-vz-span-max.fixture.json`, `decision_grid.keys.json`, each with its sidecar) and one derived by `build-data.mjs` from `git show 27229e2:finance/decision_grid.json` (sidecar mode `derived`). Every other hash and byte count is computed: by the CLI from the checkouts at the snapshot commits (`example.txt`, `example-data.js`), or by the page from the copy the reader picks. The fixture's byte account, from the committed blob at 62ddb17: **7,214,102** bytes with **295,920** LFs and no CR; the CRLF form adds one byte per LF, **7,510,022** bytes, sha256 `c91f4e50da0e6fc550bc5900a94b95aa9256b9623dfcb876d01b22501241bc49`, the value and byte count `earth-vz-span-max.json:8-9` records. The page recomputes the sum from the run's counts and says whether it closes. The MCP asset list is parsed from `mcp/scripts/bake-provenance.mjs` at the snapshot commit (`runtimeAssetPaths`, line 12), not typed.

**The page** shows the saved runs (`example-data.js`, the same five runs as `example.txt`, with their commands at the foot) and runs `basis.js` on a picked file. A browser has no git, so the blob rows are `UNAVAILABLE` until you paste the committed blob id; then, if one of the copy's three forms has that id (SHA-1 over the content, so the same trust git places in it), those bytes are the blob and all six bases follow. If none does, it says the copy is not that blob in any line-ending form, and that it cannot tell a content change from an id for another file. Files over 100 MB are refused (pure-JS hashing; use the CLI).

## Tests

`blob-basis.test.mjs`, 20 tests (19 run here, about 25 s; the full-clone test skips itself with its reason):

- **Hashes.** Eight published vectors (FIPS 180 "abc" and the 448-bit message, RFC 1321's, RFC 3174's "abc", the empty string), each also confirmed against `node:crypto` in the same test so a mistyped vector would fail; pure JS equal to `node:crypto` for sha256, SHA-1 and md5 on every length 0 to 300, 300 random lengths and 1 MB; the git blob id equal to `git hash-object --no-filters --stdin` and to git's empty-blob id.
- **Transforms and verdicts.** The ~1 KB sample's CRLF twin is the LF text plus one byte per newline and folds back to the LF hash; the property tests above; the four sample copies give `IDENTICAL`, `CRLF-CHECKOUT`, `EOL-ONLY`, `DIRTY`; every placement code, prefixes, too-short values, recorded-byte agreement and disagreement, non-discriminating matches; `scanJson`'s pointer escaping, map precedence and id/hash split; `inferBlob`'s four outcomes.
- **CLI.** `--help` 0; eight usage errors 3; outside a repository and with git removed from `PATH`, the disk triad prints, the blob basis is `UNAVAILABLE` and the exit is 2; a missing `--rev` refuses with 2.
- **Reconciliation (pinned outside this code).** Recomputed with `node:crypto` and `git cat-file` at the snapshot commit, not through `basis.js`: sha256 of the Horizons blob equals the snapshot's `horizonsFixtureSha256`; blob bytes plus LF count equals the snapshot's 7,510,022; sha256 of the split-and-join CRLF form equals the snapshot's `c91f4e50…`; the catalog hash matches; the script hash matches neither the blob nor its CRLF form. Then the CLI's `--scan` must give exactly BLOB, BLOB, NO-MATCH, CRLF with `--require blob` exit 1. A CRLF, a mixed and an edited copy of a real Aster fixture through `--against` give `CRLF-CHECKOUT`, `EOL-ONLY`, `DIRTY`, and git's own filter agrees on the first two only. `--history` finds the oldest reachable version of `STATUS.md` (on both the blob and blob-crlf basis) and names the commit `git rev-list` says introduced it. Skyhook: md5 of `params/rev_a.json`'s blob equals today's `rev_a_md5`, md5 of its CRLF form equals the parent commit's, and `rev_a.json` did not change between them.
- **Saved outputs and words.** `build-example.mjs --check` reproduces `example.txt` and `example-data.js` byte for byte (skipped unless both checkouts are clean at the snapshot commits); the README quotes the recomputed hashes and byte counts, and the tagline the three byte counts.

`ui-check.mjs`, 80 checks at 390 px by touch in dark mode and 1280 px in light mode: the headline (four chips in file order), the grid's families and pins, the arithmetic line equal to a sum the check recomputes from the data, eight placed chips (5 BLOB, 2 CRLF, 1 NO-MATCH) and the `--require blob` line, seven baked rows, each sample's verdict and placement chip, the refusal with no blob id and for the edited copy, an invalid recorded value, a real CRLF file through the file input with a pasted blob id and a prefix, keyboard Tab and Enter, no overflow, the scheme's background, no console errors or network requests.

**Teeth.** Each sabotage below was applied to a copy of the folder and the suite run (`node --test` failures / ui-check failures):

| # | Sabotage | File | `node --test` failing (of 20) | `ui-check` failing (of 80) |
|---|---|---|---|---|
| 1 | toCrlf puts the CR after the LF | `basis.js` | 11 | 5 |
| 2 | toLf drops the LF of a CRLF instead of the CR | `basis.js` | 7 | 11 |
| 3 | git blob header uses a space instead of NUL (basis.js) | `basis.js` | 2 | 0 |
| 4 | CLI blob id counts one byte too many | `blob-basis.mjs` | 2 | 0 |
| 5 | CRLF-CHECKOUT accepts any copy whose LF form is the blob | `basis.js` | 2 | 2 |
| 6 | CRLF-BASIS checked before BLOB-BASIS | `basis.js` | 1 | 0 |
| 7 | SHA-256 round constants from square roots | `basis.js` | 3 | 0 |
| 8 | MD5 first shift 8 instead of 7 | `basis.js` | 3 | 0 |
| 9 | scan ignores a sibling "path" | `basis.js` | 3 | 0 |
| 10 | CLI exits 0 on NO-MATCH | `blob-basis.mjs` | 1 | 0 |
| 11 | history skips the oldest commit | `blob-basis.mjs` | 1 | 0 |
| 12 | inferBlob tries only the as-is form | `basis.js` | 1 | 9 |
| 13 | CRLF stats forget the added bytes | `basis.js` | 1 | 0 |
| 14 | prefix matches anywhere in the hash | `basis.js` | 1 | 0 |
| 15 | 7-hex prefixes accepted | `basis.js` | 1 | 0 |
| 16 | page sums the CRLF row's bare LFs | `app.js` | 0 | 4 |
| 17 | page colours families by first appearance | `app.js` | 0 | 2 |
| 18 | page ignores the pasted blob id | `app.js` | 0 | 15 |

Every sabotage is caught by at least one suite. The three page sabotages are caught only by `ui-check.mjs`, because `app.js` is not loaded by the node tests. Six are caught by a single test and nothing else (rows 6, 10, 11, 13, 14 and 15), so that test is the only guard for that line. Rows 4 and 9 each count the `example.txt` staleness test among their failures, and that test skips itself when a checkout has moved on; the other failing tests in those rows do not skip.

## Honest assessment

What works:

- [Certain] The six bases, the verdicts and the placements agree with independent recomputation (`node:crypto`, `git cat-file`, `git hash-object`) on every case I constructed and every real record I found: four Aster hashes, four Skyhook md5s, seven baked assets. The hash functions match `node:crypto` and the published vectors; the git blob id matches `git hash-object`.
- [Certain] `earth-vz-span-max.json`'s pinned sha256 and byte count are the CRLF synthesis of the fixture's committed blob, exactly, and the cache's `horizonsFixtureSha256` and `catalogFixtureSha256` are the committed blobs'. The tests recompute these without the tool's code.
- [Certain] At 62ddb17 Aster's working copy is the committed blob for every file the tool read (the seven baked assets, the fixtures, the script), and `git ls-files --eol` shows 1,093 `i/lf w/lf` files and no CRLF working copy. So the mismatch STATUS describes cannot recur from this checkout; what remains are records written before S19-D04 and the hashing sites that would silently record a non-blob basis if a working copy ever differed again.
- [Certain] It refuses rather than guesses: no git, a revision this clone does not have, a path outside the repository, a hash with no named file all produce `UNAVAILABLE` or `UNRESOLVED` with the reason and exit 2; a history search cut short by a shallow clone says how far back it looked.

What is rough:

- [Certain] `CRLF-CHECKOUT` means "the blob with a CR before every LF". git with `text=auto` treats a file containing a lone CR as binary and does not convert it (checked here with git 2.43: `printf 'a\rb\r\nc\r\n' | git hash-object --path=<a text=auto path> --stdin` equals the unfiltered id, while a text without the lone CR is folded), so for such a file the LF and CRLF rows are bytes git would not write; the tool counts lone CRs and flags NUL-containing (binary) files, but it does not model every git filter (`ident`, `working-tree-encoding`, custom clean/smudge), so `EOL-ONLY` and `DIRTY` mean what they say about bytes, not about git's intent. The `git hash-object --path` second opinion covers what git would do.
- [Certain] Only these six bases. A hash taken after some other transformation (a BOM, trailing-whitespace stripping, JSON reformatting, Skyhook's lone-CR folding on a file that has lone CRs) is `NO-MATCH`, not explained.
- [Certain] `--history` follows one path; a renamed file's older name is not searched. In this sandbox both checkouts are 50-commit shallow clones, so the history search could not reach the script version that explains the fourth Aster hash; I found it another way (below), and the test for it skips itself here.
- [Certain] `--scan` places every 64- or 32-hex string; a hex id that is not a file hash shows up as `UNRESOLVED` (exit 2) and there is no ignore option. Keys are mapped by name or JSON pointer only.
- [Likely] Speed: the scan of both Aster snapshots (which reads the 53 MB catalog and its 55 MB CRLF form) takes about 6 to 7 s here; the page hashes about 50 MB/s in plain JavaScript and refuses files over 100 MB. I have not measured it on a phone, and the 100 MB refusal is not exercised by `ui-check.mjs`.
- [Certain] The page needs the blob id pasted; without it the blob rows stay unavailable by design.

**Findings about the source repos** (reported, not fixed there):

1. [Certain] **Aster: the generator script's recorded hash is explained, and the cache records the wrong commit for it.** `precomputeScriptSha256` `44d9443500cb280a625fc99cfd12756c2928430390cda8c46d7b55763f6db4f7` matches nothing at 62ddb17 (audit B4-F15, `ASTER_AUDIT_REPORT.md:997`; A4-F06 at `:944` calls it "the real mismatch"). It is the sha256, on the blob basis, of the script as committed in `9e93ffc` (blob `0bbef916ed7e7cd78197286ef0365556c5f149f8`, 13,679 bytes, committed 2026-05-30T04:45:22Z, the same commit that committed the cache, whose `generatedAt` is 04:43:31.918Z). `9e93ffc`'s parent is `8471659`, the cache's recorded `solverCommit`, whose script (blob `ff059a55…`, 11,064 bytes) hashes to `785516923ce5154dda5221d567b5f615261b3f0c52b1ccb4969ba122f7bdae20`. So the generator ran from an uncommitted script and recorded HEAD: `precompute-lambert-screen.mjs:170-179` takes `git rev-parse HEAD` with no dirty check, where `mcp/scripts/bake-provenance.mjs:31` records `dirty`. The script then changed in `be5ef60` and `6d9b8bc` (both 2026-08-05), and `6d9b8bc`'s version is the one at 62ddb17. Provenance is intact on the blob basis for the commit that holds the cache; it is not a CRLF problem. *How verified:* outside the tool, because these commits are beyond this shallow clone: `gh api -H "Accept: application/vnd.github.raw" "repos/hudsonclavin-cloud/asteroid-mining-planner/contents/tools/build/precompute-lambert-screen.mjs?ref=<commit>" | sha256sum` for each of `8471659`, `ff92d161`, `9e93ffc`, `be5ef60`, `6d9b8bc`, and `gh api repos/hudsonclavin-cloud/asteroid-mining-planner/commits/9e93ffc48a92` for the parent and file list. In a full clone (Aster's CI full-tests job fetches with `fetch-depth: 0`, `.github/workflows/ci.yml:81`), `blob-basis … --expect 44d94435… --history` should name `9e93ffc`; that is the test that skips itself here, so [Likely] for the tool, [Certain] for the bytes.
2. [Certain] **Aster `STATUS.md:458`** says "This checkout's on-disk copy is CRLF and hashes to `c91f4e50...`". Stale at 62ddb17: the working copy is LF and identical to the blob (audit A3-F03, `:931`, says the same; confirmed). `STATUS.md:412-414` says `.gitattributes:9` makes `docs/` on-disk copies larger than what is served; at 62ddb17 the two `docs/` files I ran the tool on (`docs/assets/horizons-inner-solar-system-2026-2040-Bl0fvEH3.json` and `docs/lambert-screen-cache.json`) are `IDENTICAL` to their blobs and `git ls-files --eol` shows every tracked text file `w/lf`, so that sentence is stale too.
3. [Certain] **Aster `STATUS.md:519`** still lists C1, "CRLF / `.gitattributes` normalization pass", in the Cleanup Queue, while `src/v2/SLICE_19_FOUNDING.md:164` records ".gitattributes + renormalize (e70c00b, 59a7dd9)" as shipped and `.gitattributes:21-22` carries `* text=auto eol=lf`. [Likely] the row is done and not marked; I cannot see `e70c00b` in this clone.
4. [Certain] **Aster `tools/slice12-research/data/earth-vz-span-max.json:8-9`** pins `c91f4e50…`/7,510,022, the CRLF form. Known (audit A2-F03/B2-F09/C1-F15; Slice 19.5 D3 open at 62ddb17). What this adds is the exact account: the committed blob's 7,214,102 bytes plus one CR for each of its 295,920 LFs, and the value to re-pin: `b278dd5567f30266593c49bf4fef203e7570d3613187fd112dc7015109a39c15`, 7,214,102 bytes.
5. [Certain] **Skyhook:** the `rev_a_md5` that `34935cb` replaced (`7540d4fb6b031a5f7117098ab07e656e`, in `finance/decision_grid.json` at `27229e2`) is md5 of `params/rev_a.json`'s CRLF form (7,260 bytes; the blob is 7,125). This confirms the cause the commit message gives; nothing to fix, since `provenance_md5` now normalises.

**A finding about this bank's own tooling** [Certain]: `tools/snapshot.mjs` records `readBlob` with `git hash-object <path>`, which applies the path's `.gitattributes` filters, so for a CRLF working copy of a `text=auto` file it returns the committed blob id and `readMatchesCommitted: true`, although the bytes read are not the blob. (`sourceSha256` does record the bytes read.) Shown read-only by the test that passes a CRLF text through `git hash-object --path=… --stdin`, and early in the session in a throwaway repository in the scratch directory, since deleted. `git hash-object --no-filters` would record the bytes actually read.

**Gates this has not been through** [Certain]: Aster's multi-agent audit (this is tooling, not math-layer code, but its findings would land in provenance records), the founding-doc DEC process (choosing a hashing basis for new records is a decision, and closing OQ-17-7 or D3 is a dispatch), and Aster's own test runner and CI. It touches no protected path. Oracle validation does not apply as such; the hash functions are validated against `node:crypto`, published vectors and git. It is an idea-bank prototype.

## Where it would land

**Aster**, as `tools/provenance/blob-basis.mjs` with `basis.js` beside it (Node built-ins, no dependency), and a test `tests/provenance-basis.test.mjs` that runs `--scan --require blob` over every committed provenance record (`tests/fixtures/v2/lambert-screen-cache.json`, `tools/slice12-research/data/earth-vz-span-max.json`, `tools/slice17-research/data/s17-*.json`, which repeat the cache's three hashes). What must change first, in this order:

1. Slice 19.5 Front D3 re-emits `earth-vz-span-max.json` with the blob-basis value above (the tool prints it), so the test can pass.
2. Decide what `precomputeScriptSha256` should mean. Either record the commit that holds the script that ran (here `9e93ffc`) beside `solverCommit`, additively, or regenerate the 52-minute cache (`wallTimeSeconds` 3,137.7), which OQ-17-7 calls "not a casual edit". Either way the generator should refuse to run, or record `dirty`, when its inputs differ from HEAD, as `bake-provenance.mjs:31` does.
3. Make the hashing sites (`precompute-lambert-screen.mjs:180-182`, `measure-earth-vz.mjs:77-78`) hash `git cat-file blob HEAD:<path>`, or call this tool's `--require blob` before hashing disk bytes, and record the basis in the artefact (`"basis": "blob"`).
4. Close OQ-17-7 additively in `SLICE_17_FOUNDING.md` and the Slice 19.5 record, citing the reconciliation; strike or annotate `STATUS.md:458` and `:412-414`, and mark C1.

Run it in the full-tests CI job, which already fetches full history, so `--history` can explain a stale record instead of only failing it. **Skyhook** needs nothing; the same tool could check `decision_grid.json` in its provenance test, but `provenance_md5` already solved Skyhook's case by normalising.

## Changes from the judged proposal

- **Six bases, not four.** The proposal hashed disk, LF(disk), CRLF(disk) and the blob. A CRLF form of the *blob* is what a Windows checkout writes; CRLF(disk) only equals it when the working copy is clean. With both sources and three transforms the verdicts are exact.
- **`CRLF-CHECKOUT` is stricter, and `EOL-ONLY` is new.** The proposal called a copy `CRLF-CHECKOUT` when LF(disk) equals the blob, and said "a mixed-EOL fixture is DIRTY". Here `CRLF-CHECKOUT` requires disk to equal CRLF(blob) exactly; a mixed-ending copy with the same content is `EOL-ONLY`; a mixed copy with an edit is `DIRTY`. Calling a same-content copy "dirty" would have been wrong.
- **The premise moved.** The proposal and `STATUS.md:458` describe a CRLF checkout. At 62ddb17 the checkout is LF (S19-D04, `.gitattributes:21-22`), so every working-copy verdict is `IDENTICAL`. The tool's value is reconciling existing records and gating new ones, not diagnosing a live CRLF checkout, and the tagline says what it found rather than "so OQ-17-7 stops recurring".
- **The scan found four hashes, not two.** The proposal expected "one BLOB-BASIS match and one CRLF-BASIS match". The cache's block holds three hashes plus `solverCommit`; the catalog's is blob-basis and the generator script's matches nothing at HEAD, which led to Finding 1.
- **Added:** md5 and git-blob-id matching and prefixes (Skyhook records md5; prose quotes prefixes); `--history`, `--against`, `--require`, `--brief`; exit codes in PartForge's headless convention (0/1/2/3); the Skyhook reconciliation; the MCP baked-asset run; `index.html`, which the proposal's CLI surface did not include.
- **Landing.** The proposal named `SLICE_17_FOUNDING.md` for closing OQ-17-7. The open, scheduled item is now Slice 19.5 Front D3 (`SLICE_19_5_FOUNDING.md:305-306`), so the landing starts there.
- **Snapshots.** `earth-vz-span-max.json` was picked as `generatedAtUtc,source,fixture` (the proposal said `fixture`) to keep the date and source with the pin; two Skyhook excerpts were added.
