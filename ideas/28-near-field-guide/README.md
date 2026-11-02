# Near Field Guide
> Every distribution Aster's 41,906-body NEA catalog fixture can show about itself, binned over the whole file with its nulls and missing fields on the page; re-deriving its labels finds 82 re-anchored bodies whose stored class their own elements contradict, two of them (2008 TC3, 2014 AA) carried at q 2.91 and 2.64 AU on orbits JPL marks invalid after an Earth encounter closer than Earth's radius.

**Kind:** explorable
**For:** Aster
**Run:** open `ideas/28-near-field-guide/index.html` in a browser (classic scripts, works from `file://`, no build, no network; the data is the derived `snapshots/bins.data.js`). Rebuild or verify the data against an Aster checkout: `node ideas/28-near-field-guide/build-data.mjs` (text summary; `example.txt` is its saved output), `--write`, `--check` (byte-for-byte), `--json`, `--aster DIR`, `--help`; exit 0 ok, 1 a reconciliation failed or the snapshot is stale, 2 an input is missing, 3 usage. Tests, from the bank root: `node --test ideas/28-near-field-guide/guide.test.mjs` (20 tests, Node built-ins, about 2 s; the one live-checkout test skips without `/home/user/asteroid-mining-planner`) and `node ideas/28-near-field-guide/ui-check.mjs` (106 checks in headless Chromium with the globally installed Playwright, about 5 s; `check.mjs` runs it for `tools/check.mjs`; `--shots DIR` saves screenshots). The SBDB oracle is rebuilt with `node ideas/28-near-field-guide/oracle/sbdb-tjup.mjs <sbdb-query.json>` from a 6 MB SBDB download that is not shipped (its URL is in the script).
**Made by:** Blink Comparator

## What it is

A field guide to the catalog Aster actually ships: `tests/fixtures/v2/nea-catalog-slice9.json` at Aster `62ddb17`, 41,906 records, 53 MB. A derivation script reads every record once, bins it, and ships only the bins (115 KB). The page draws every panel from those bins:

- **Thirteen histograms**: semi-major axis, eccentricity, inclination, perihelion q, aphelion Q, the Tisserand parameter T_J (in two conventions, a toggle), absolute magnitude H, `estimatedRadiusM` (titled as a formula of H at the assumed albedo), condition code U (the raw ordinal), data arc, observations used and sigma-a. Nulls, hyperbolic orbits, undefined aphelia, zero-day arcs and overflow each get their own bar under "Beyond the axis"; none is dropped. Each panel prints its n, its null count and the bar that holds the median. Reference lines come from sources: Aster's class thresholds and band edges, Slice 18's Jupiter-crossing Q, the NEO bound as Aster quotes it, and T_J = 2 and 3 from JPL's own class table.
- **Seven label counts**: orbitClass, inv014Tier, Slice 18 screening-fidelity tier, eccentricityBand, anchorSource, PHA, designation kind.
- **An a-e density grid** (60 × 50 cells) with Aster's class boundaries and the Jupiter-crossing line drawn as curves.
- **Chips** for orbit class (ATE, APO, AMO, IEO, or the comet tail ETC + HTC + JFC), inv014Tier and Slice 18 tier. Every chip shows how many bodies it would hold, and every panel re-counts from that selection's bins. A selection with no bodies (planning-tier, or AMO at L0) gets a refusal shaped like Aster's MCP refusal (`insufficient_data`, what is missing, what would help, and for planning-tier the spec's own lines), not an empty chart. A panel on which every body of the selection falls outside the axis refuses on its own the same way: the comet tail's H and radius panels, since all 208 comet-tail bodies have H null (added in review; before it, those panels drew an empty axis).
- **What the catalog does not carry**, read from a census of every key path of every record, not written by hand: G is null for all 41,906; there is no rotation-period, taxonomy or albedo key at all, each card quoting the Aster document that asks for it; size is a formula of H. A table re-counts the nulls of all 34 key paths for the current selection.
- **Where the labels and the elements disagree**: SBDB's own record of 2008 TC3 and 2014 AA beside the catalog's; the 82 stored classes that Aster's class rule contradicts; the 11 NEA-class bodies at q ≥ 1.3 AU; T_J against JPL's published value; the 25 NEA-class bodies with a comet-like T_J < 2.
- **The committed fixture against the pre-research pull**: the Slice 9 report's condition-code and data-arc tables (41,902 rows) recounted on the fixture.
- **Eleven landmarks** (Eros, Bennu, Apophis, Atira, 152637, Halley, Biela, 2008 TC3, 2014 AA, C/2015 D1, 2017 UR52), copied verbatim. Pick one to mark it on every panel and the grid.
- **Provenance**: the commit, every input's sha256, every constant with the source line it was read from.

The selection, landmark, axis and T_J convention live in the URL hash, so a view can be linked.

## Why I made it

The proposal (A4-02, `queue/proposals/28-near-field-guide.json`) asked for the first view of the catalog as a population. I checked its premises against Aster `62ddb17` before finishing:

- Aster has no distribution view. The catalog list offers a class filter and sort keys only (`src/v2/app/catalog-list/panel.ts:47`, `ORBIT_CLASSES = ['ALL', 'ATE', 'APO', 'AMO', 'IEO']`). There is no Tisserand code anywhere in Aster: `grep -ri tisserand` over the repository finds only a main-belt asteroid named Tisserand in the Slice 8 fixtures.
- The null census is as the judges reproduced it: G 41,906, H 210 (= the header's `missingAbsoluteMagnitudeCount`), data arc 417, sigma-a 137, condition code 10. The fields Aster's documents ask for are absent: `strategy/IDEA_KERNELS_2026-09.md:133` and `:137` (no rotation period, "zero without a new SBDB pull"), `strategy/ASTER_FAMILY_MASTER_PLAN.md:34` (Prospect: spectral, taxonomy, albedo enrichment).
- The pre-research report's tables (`tools/slice9-research/SLICE_9_PRERESEARCH_REPORT.md:52-77`) come from a 41,902-row pull (`:19`), not the committed fixture.
- **The proposal was wrong about one thing.** It said to take the AU "from `src/v2/core/constants/`". Aster's core has no AU constant. The AU is typed as a literal in 21 files under `src/` and `tools/` (none under `mcp/`): 17 type 149,597,870.7 km and 4 more only 149,597,870,700 m (`git grep -l -E '149_?597_?870'` at `62ddb17`; corrected in review from "149,597,870.7 km in 21 files under `src/`, `mcp/src` and `tools/`"). Idea 22 (Said vs Derived) already lists five of these homes as one length typed in several places (its README finding 13 and `example.txt:144`). This deposit reads it from `tools/slice18-research/tier-sizing.mjs:32`, the script whose Slice 18 tiers the bins are reconciled against.

**What other ideas in this bank already cover.** Idea 17 (Known Unknowns) crosses condition code, data arc, observations and H with the screening cache's minimum C3. This guide does not touch the screening cache. It shows those quality fields one-dimensionally, as part of the whole population, and reconciles them with the pre-research report, which idea 17 does not. Idea 22 (Said vs Derived) scans Aster's code for typed literals. This guide re-derives the catalog's stored labels from its stored elements, which is the data-side version of the same rule. No idea in the bank plots orbital-element distributions, T_J or the null census.

**State of the folder when I picked it up.** The builder was stopped on 2026-10-26 with the kernel (`guide.js`), the derivation (`build-data.mjs`), 13 snapshots and a first `index.html` and `style.css`. There were no tests, no README, and no `app.js`, which `index.html` loads, so the page could not draw. I re-ran the derivation against the same Aster commit and it reproduced `bins.data.js` byte for byte. I checked every constant and quoted line against the checkout and kept the kernel. Then I added:

1. the ecliptic T_J convention, after JPL's SBDB showed it is the one SBDB publishes;
2. two oracles fetched from JPL (Horizons' osculating elements of Jupiter, SBDB's `t_jup` for all 43,039 NEOs);
3. SBDB's own records of 2008 TC3 and 2014 AA, and SBDB's orbit-class table;
4. the tests, the page, the ui-check and this README.

**Alternatives weighed.**

- *Ship per-body data and bin in the browser.* Even five fields per body for 41,906 bodies is close to the folder budget, and bin edges would then be a browser choice that no test pins. Shipping bins keeps the browser to sums, with every count reproducible by `--check`.
- *One histogram set per class.* That cannot answer "APO bodies at L1". Binning per atom (orbitClass × inv014Tier × Slice 18 tier, 18 non-empty atoms) answers every combination of the three filters by addition.
- *One T_J convention.* I first had only the textbook one, with inclination measured from Jupiter's orbit plane. SBDB's published values turned out to use the ecliptic. The two differ by up to 0.026 and put 38 bodies on opposite sides of T_J = 3. Showing one and calling it T_J would be wrong for anyone who checks against JPL, so the page has both and says which is which.

## How it works

**Inputs [Certain].** `build-data.mjs` reads three files from the Aster checkout and records each one's sha256 and blob (both equal to the committed blob at `62ddb17`):

| File | Size |
|---|---|
| the catalog fixture | 52,969,826 bytes, sha256 `f88028d2…` |
| `docs/tier-sizing-per-body.json` (Slice 18 tier per body, joined by designation) | |
| `tests/fixtures/v2/horizons-jupiter-system-90d.json` (Jupiter's state) | |

Every constant is read by regex from its source line, and the line is recorded:

| Constant | Value | Source |
|---|---|---|
| AU | 149,597,870.7 km | `tier-sizing.mjs:32` |
| GM_sun | 1.32712440018e20 m³/s² | `src/v2/core/propagators/keplerian.ts:9` |
| GM_Jupiter | 126,712,764.1 km³/s² | `tools/slice18-research/dv-scope.mjs:33` |
| obliquity | 84,381.448″ | `src/v2/core/units.ts:5` |
| albedo | 0.14 | `src/v2/core/constants/asteroids.ts:9` |
| radius formula literals | 1329 and 500 | `asteroids.ts:80`, `:87` |
| eccentricity band edges | 0.1, 0.2, 0.3 | `asteroids.ts:94-100` |
| class rule | Q < 0.983, a < 1.0, q < 1.017 | `src/physics/catalog/normalizers.ts:103-105` |
| Jupiter-crossing Q | 4.95 AU | `tier-sizing.mjs:33` |
| NEO bound | 1.3 AU | a literature note, `tools/slice17-research/literature/S17_Q2_PRESENTATION_RESULT.md:253`, labelled as such |
| Earth radius | 6,378,136.6 m | `src/v2/core/constants/bodies.ts:45` |

The 27 passages the page quotes are found the same way. The output has no timestamps, so `--check` compares byte for byte.

**Per-body derivation (`guide.js`, pure, loads in the browser and in Node).**

- a = `aKm` / AU, q = a(1 − e), Q = a(1 + e), i in degrees from `iRad`.
- An orbit with e ≥ 1 or a ≤ 0 goes to its own "hyperbolic" and "undefined" bars. There is one, C/2015 D1.
- T_J = a_J/a + 2 cos i √((a/a_J)(1 − e²)), computed twice:
  - with i measured from Jupiter's orbit plane (the restricted three-body definition), using cos i = (orbit pole) · (Jupiter's pole), the body's pole from its ecliptic i and node;
  - with i measured from the ecliptic, as JPL's SBDB does.
- a_J = 5.20339 AU by vis-viva from Jupiter's heliocentric ICRF state at 2026-05-01 TDB (the catalog's common re-anchor epoch), with μ = GM_sun + GM_Jupiter. Jupiter's pole comes from the same state rotated to the ecliptic. GM_sun alone would give 5.2083 AU; over the 90-day file a_J runs 5.2010–5.2041.
- The stored class, band and radius are re-derived with Aster's own rules, and designation kind is read from the name.

Bins are decimal edges rounded to 10 places, so an edge equals the double that a source literal parses to. A value on an edge opens the upper bar, which is what Aster's strict `<` thresholds mean. Log axes bin log10(value) but compare in the linear domain. A value with no bar throws, so a changed catalog fails the derivation loudly instead of dropping bodies.

**Reconciliations the derivation enforces [Certain] (exit 1 if any fails).**

- Every histogram in every atom sums to its n.
- The atoms sum to the header's `totalBodies`, `classDistribution`, `inv014TierDistribution`, `missingAbsoluteMagnitudeCount` and `anomalyTailCount`.
- The Slice 18 counts L0 11, L1 10,150 and L2 31,745 equal the tier artifact's populations.
- Every stored eccentricityBand equals the band recomputed from e (0 mismatches).
- `estimatedRadiusM` recomputed from H matches all 41,696 bodies that have H, to a relative 2.5e-16.

**The comparison with the pre-research report [Certain as arithmetic].** The fixture has every body the report counted plus 4. For condition code, U 7 has +2, U 8 has +1 and U 9 has +1. For data arc, the 4 are in the under-7-days bucket, when the report's buckets are read as [lo, hi). Read as (lo, hi], the fixture would have 828 fewer bodies in 7–30 days than the report, which a later pull of a growing list should not. The report does not say which end is closed, and the page shows both readings.

**Oracles from outside Aster [Certain as measured].**

- *JPL Horizons* (`oracle/horizons-jupiter-elements.txt`, retrieved 2026-11-02): Jupiter's osculating ecliptic elements at the same instant, with the Keplerian GM Horizons used. With that GM, `elementsFromState` on Aster's state reproduces a (5.2033915 AU), e, i (1.303505°) and node to 1e-12. With this deposit's μ, a_J moves by under 2e-7 relative.
- *JPL SBDB* (`oracle/sbdb-tjup.json`, from the SBDB Query API, 43,039 NEO rows, retrieved 2026-11-02). From SBDB's own a, e and i at a_J = 5.20339 AU:
  - the ecliptic form reproduces 42,419 rows to SBDB's printed ±0.0005 and every row to within 0.00054;
  - the Jupiter-plane form reproduces 8,202, with a maximum difference of 0.026;
  - every row reproduces exactly at a_J 5.203363–5.2033631 AU, 2.7e-5 AU below the vis-viva value here.

  So SBDB uses the ecliptic inclination and a fixed a_J [Likely, inferred from the fit]. Against the catalog's own elements (at 2026-05-01, while SBDB's sit at their own epochs), the ecliptic form's median difference is 0.0003 for each anchor source. 517 re-anchored bodies differ by more than 0.01; they were moved by planetary encounters between SBDB's epoch and 2026-05-01, which is what the re-anchor is for. 76 catalog designations are not in today's SBDB NEO list under the same designation (renumbered or no longer NEOs; not followed up).
- *SBDB records* (`snapshots/sbdb-2008-TC3.json`, `snapshots/sbdb-2014-AA.json`) and *SBDB's orbit-class table* (`snapshots/sbdb-orbit-classes.txt`, from the SBDB filter API documentation). The table is where the T_J = 2 and 3 lines come from ("Jupiter-family comet, as defined by Levison and Duncan (2 < Tj < 3)"). I know Levison and Duncan only through that table.

**Fidelity.** An idea-bank prototype that describes one committed fixture, not the near-Earth population. The page says so in its header and footer.

## Tests

`guide.test.mjs`, 20 tests. Every constant a test needs is parsed from the snapshot of the Aster file it lives in, never taken from `bins.data.js`. What they pin:

- **Bins**: an edge value opens its bar (e = 0.1, a = 1 AU, Q = 4.95 AU, 10 days); nulls and tokens go to their own bars; values off the axis throw.
- **Aster's rules**: band and class thresholds use strict `<`, parsed from `asteroids.ts` and `normalizers.ts`.
- **Radius**: a hand-worked H = 15 case gives 1,775.95 m, and every landmark's stored `estimatedRadiusM` is reproduced.
- **Tisserand closed forms**: Jupiter itself gives exactly 3; a = a_J/4 circular gives 5; a polar circular orbit gives 1.
- **Per-body derivation** (added in review): `derive()` on every landmark gives Aster's own a, e and Q from Slice 18's per-body artifact (`snapshots/tier-landmarks.json`, `tools/slice18-research/tier-sizing.mjs:116-117`, rounded at `:166`), and on 1P/Halley and 3D/Biela, whose catalog elements sit at SBDB's own epoch, reproduces SBDB's a, e and i to 1e-9.
- **Null census per record** (added in review): `nullPaths()` on the landmarks yields exactly the shipped census's 34 key paths, G null in all 11, H and `estimatedRadiusM` null together (the three comets), `elements.maRad` null only for the hyperbolic C/2015 D1.
- **Median and the empty-axis refusal** (added in review): `medianBar()` on hand-built histograms (nulls left out), and `numericCount()`: 0 for the comet tail's H and radius (so the page refuses those panels), 41,906 − 210 for the whole catalog's H.
- **Horizons oracle**: a, e, i and node to 1e-12 / 1e-9; a_J in 5.19–5.21.
- **SBDB oracle** (308 sample rows, including every landmark): the ecliptic form is within 0.0006 of every row at this deposit's a_J, and within rounding at the oracle's a_J; the Jupiter-plane form fails for most rows.
- **Eros and Halley**: Eros by hand from its stored a, e, i, within 0.001 of SBDB's 4.582. Halley shares SBDB's 1968 epoch, so it matches to rounding in the ecliptic form and misses in the Jupiter-plane form.
- **2008 TC3 and 2014 AA**: SBDB gives `not_valid_after`; the Earth MOID is below Earth's radius; the catalog's q exceeds SBDB's by more than 1.5 AU; the stored class is APO while the elements say AMO.
- **Shipped bins**: every panel sums to its n. The totals equal the header, the tier artifact, and the L0/L1/L2 numbers parsed from `SLICE_18_FOUNDING.md:304-306`. "Structurally blind = 688 (206 comets + 482 Jupiter-crossing)" (`:307`) and STATUS.md's "26 of the 206" (`STATUS.md:326`) are recomputed from the Q histograms.
- **Nulls**: the null census equals the header's missing-H count, the spec's two null rules, and the pre-research report's "missing" rows (10 and 417). The report's U table differs from the fixture by exactly 41,906 − 41,902.
- **Class check**: 82 disagreements, all re-anchored.
- **Grid**: the a-e grid holds exactly the bodies the 1-D a histogram puts on the axis.
- **Live**: `build-data.mjs --check` against the checkout.

**Teeth, counted.** The builder's twelve sabotages, applied one at a time to a scratch copy; every one fails at least one test that does not need the Aster checkout (the review re-ran four of them and got the same counts):

| Sabotage | Tests that fail |
|---|---|
| T_J factor 2 → 1 | 4 |
| bin floor `<=` → `<` | 2 |
| ICRF-to-ecliptic rotation sign | 2 |
| vis-viva sign | 4 |
| band `<` → `<=` | 1 |
| radius exponent H/5 → H/2.5 | 2 |
| ATE and APO tests swapped | 3 |
| ecliptic T_J computed with the Jupiter-plane cosine | 2 |
| `countBelow` counting the straddling bar | 1 |
| sparse sum off by one | 5 |
| one atom's n + 1 in the shipped data | 4 |
| orbit-pole node sign | 2 |

The review's own sabotages, counted on the 20 tests (the live `--check` test included where it fails). The first four passed every checkout-free test before the review's three tests were added: three were caught only by the live test, and the median shift by nothing.

| Sabotage | Before review | After review |
|---|---|---|
| `derive()` Q = a(1 − e) | 1 (live only) | 2 |
| `derive()` i × 57 instead of × 180/π | 1 (live only) | 2 |
| `nullPaths()` never reports null | 1 (live only) | 2 |
| `medianBar()` shifted one bar | 0 | 1 |
| `nullPaths()` stops walking nested objects | not tried | 2 |
| AU retyped as 149,600,000 km in `derive()` | not tried | 3 |
| `numericCount()` counting the null bars | (new) | 1 |
| `matches()` ignoring a single-valued filter | 2 | 2 |
| `countAtOrAbove` `>=` → `>` | 1 | 1 |

`ui-check.mjs`, 106 checks:

- **Counts on the page against the kernel and the header**: every chip count, every panel's n and null count, and one bar per non-empty bin in every histogram.
- **Interaction**: APO re-counts every panel. planning-tier and AMO + L0 refuse and draw no chart. Comet tail at L2 gives STATUS.md's 206. The Eros landmark is marked at 1.458 AU. The T_J toggle swaps panels; the log axis works; the arrow keys read bars and grid cells; Enter selects a chip; the state is restored from the URL hash.
- **Panel refusals** (added in review): with the comet tail chosen, the H and radius panels carry `insufficient_data`, draw no chart, count the 208 nulls and claim no median, the radius refusal quotes the spec's null rule, the a panel still draws, and no panel refuses on the whole fixture.
- **Phone and dark**: 390 px in dark mode with touch taps and no horizontal overflow, including with the panel refusals showing.
- **Load refusals**: bins made under other edges give `out_of_envelope`; a missing data file gives `insufficient_data`.

## Honest assessment

**What works.**

- [Certain] Every count on the page is a sum of shipped bins, and every bin set re-derives byte for byte from the checkout. The whole-catalog totals equal the fixture's own header and Slice 18's artifact and founding document.
- [Certain] The kernel's orbital routines agree with JPL Horizons and JPL SBDB as stated under How it works.
- [Certain] The null census and the missing-field cards come from the data, not from prose.

**What the independent review changed** (2026-11-02; it recomputed the null census, the 82 class disagreements and their 80 near-threshold, the 11 bodies at q ≥ 1.3 AU, a_J 5.2033905 AU, the 38 bodies that change side of T_J = 3, the 482 + 206 = 688 and 26-of-206 counts, the 25 NEA-class bodies with T_J < 2, Eros's T_J 4.5820 and the pre-research differences in its own Python straight from the 53 MB fixture, and all matched; it re-fetched SBDB's two records, Horizons' Jupiter elements and the 6 MB SBDB query (same sha256) and re-ran `oracle/sbdb-tjup.mjs` to a byte-identical `sbdb-tjup.json`; it re-opened all 27 quoted lines and every constant line at `62ddb17`):

- [Certain] **A missing refusal, fixed.** With the comet tail chosen (6 of the 51 non-empty selections the chips can make, each with 2 such panels), every body has H null, and the H and radius panels drew an empty axis with three "0" gridlines and an invitation to read a bar. They now refuse with `insufficient_data` (what is missing: all 208 are null; what would help), the radius refusal quoting the spec's null rule. The kernel gained `numericCount()`; the a-e grid refuses the same way if a selection ever leaves it empty (none can today).
- [Certain] **A wrong number, fixed.** The README said 149,597,870.7 km is typed in 21 files under `src/`, `mcp/src` and `tools/`. It is 17 files in kilometres plus 4 that type the AU only in metres, and none under `mcp/`; idea 22 had already reported part of it, which is now credited.
- [Certain] **Tests with more teeth.** `derive()`'s Q and i and `nullPaths()` were checked only by the live `--check` test, and `medianBar()` by nothing: Q = a(1 − e), i × 57 and a never-null census each passed all 16 checkout-free tests, and a shifted median passed all 17. Three tests now pin them to Aster's Slice 18 per-body rows (a new snapshot excerpt), to SBDB's own a, e, i for 1P and 3D, to the shipped census and to hand-built histograms. 17 → 20 tests; 91 → 106 ui-checks.
- [Certain] **Wording and labels.** The page called the re-anchor mechanism [Likely] while this README called it [Speculative]; the page now says [Speculative]. "Plans transfers to them" now says what the screening cache does (solves them, status `high_departure_c3`, both above its C3 limit of 25). The class rule is now described as the legacy normalizer's fallback. Smaller: duplicate y-axis labels on one-body charts, a space before °, the T_J toggle splitting across two lines, and a comment in `build-data.mjs` that sat above the wrong constant.
- [Certain] **Checked and left alone.** Every snapshot is byte-identical to its source at `62ddb17` or re-fetched; the 11 landmarks are verbatim; `build-data.mjs --check` still reproduces `bins.data.js` byte for byte (no bin changed); the builder's sabotage counts reproduce.

**What is rough.**

- [Certain] The bins are fixed at derivation time. The page cannot re-bin, and it filters only on orbit class, inv014Tier and Slice 18 tier. PHA, H range or anchor source as filters would need more atoms.
- [Certain] The page is long: about 9,900 px at 1280 px wide and 20,000 px on a phone. The sections are in reading order, but there is no table of contents.
- [Likely] The SBDB comparison is against SBDB as of 2026-11-02, not the pull the fixture was built from. Class codes and orbits may have changed since; the page says so.
- [Likely] SBDB uses a fixed a_J near 5.20336 AU. That is inferred from the fit, not documented anywhere I read.
- [Speculative] The two re-anchored impact-encounter orbits were produced by integrating through the encounter. I did not run Aster's re-anchor to confirm it.
- [Certain] The provenance sidecars of 12 of the 13 snapshots the first builder wrote carry `copiedAt` 2026-10-26, the day of the transcript replay that rebuilt the folder. Their content hashes match the Aster commit. The 13th, `bins.data.js`, was re-derived here, and it and every sidecar written in this session carry 2026-11-02, as does `snapshots/tier-landmarks.json`, added in review.
- [Certain] The T_J = 2 and 3 lines and the Levison–Duncan attribution come from JPL's class table, a secondary source for that paper.

**Findings about the source repo** (Aster `62ddb17`; nothing was changed there):

1. [Certain] **Two bodies are carried past the end of their own orbits.** SBDB says 2008 TC3's orbit is "not valid after 2008-Oct-07.116" and 2014 AA's after "2014-Jan-02.128". Their Earth MOIDs are 1,167 km and 68 km, both below Earth's radius (6,378.1366 km, `src/v2/core/constants/bodies.ts:45`). The fixture carries both at 2026-05-01 with re-anchored elements (q 2.911 and 2.640 AU; T_J 3.19 and 3.17 against SBDB's 4.929 and 5.403), stored class APO, Slice 18 tier L2 "unmeasured"/"quiet". Aster's own A.2b diagnostic noticed 2008 TC3's band (`tools/slice9-diagnostic/SLICE_9_A2B_DERIVED_FIELDS_DIAGNOSTIC.md:64`) but not its orbit. The screening cache (`tests/fixtures/v2/lambert-screen-cache.json` at `62ddb17`, cited here, not shipped) solves transfers to both and reports them as live targets with status `high_departure_c3`: 2008 TC3 at min C3 47.53 km²/s² launching 2030-03-28 (632-day flight), 2014 AA at 41.34 launching 2034-12-14 (512 days), on orbits SBDB says stopped being valid in 2008 and 2014. Both minima are above the cache's own `feasibleC3MaxKm2S2` of 25, so neither is shown as a cheap target; the defect is that they are screened at all. [Likely] Both bodies struck the Earth; that is what an Earth MOID inside Earth's radius at the last observation means, and SBDB's own comment on 2014 AA cites "7 optical and 1 infrasound observations" (`snapshots/sbdb-2014-AA.json`), but this deposit relies only on SBDB's fields, not on an impact record.
2. [Certain] **Re-anchoring does not recompute orbitClass.** `applyReanchor` (`tools/slice9-ingestion/reanchor-stale-subset.mjs:267-288`) replaces the elements and calls `recomputeDerivedFields` (`tools/slice9-ingestion/derived-fields.mjs:34-40`), which recomputes band, qualityRank and radius only. On the stored elements, Aster's own class rule disagrees with the stored class for 82 bodies (the rule is the fallback in the legacy normalizer, `src/physics/catalog/normalizers.ts:99-107`, applied only when SBDB's row has no class; its thresholds are JPL's, `snapshots/sbdb-orbit-classes.txt:4-7`), all `horizons-reanchor`; 80 of them are within 0.1 AU of a threshold. 11 NEA-class bodies sit at q ≥ 1.3 AU (the two above, plus nine at 1.300–1.319).
3. [Certain] **Ingestion upper-cases SBDB's class code** (`tools/slice9-ingestion/build-nea-catalog.mjs:62-65`). SBDB distinguishes JFc (Levison–Duncan, 2 < T_J < 3) from JFC (classical, P < 20 y), and its Encke-type code is ETc. Today SBDB gives the fixture's 166 "JFC" as 155 JFc + 11 JFC, and its 6 "ETC" as ETc. [Likely] The fixture's raw codes at pull time were the same mix; only today's SBDB was checked. The boundary's tail set (`src/v2/boundary/slice9-nea-catalog.ts:164`) and the spec (`tests/fixtures/v2/nea-catalog-slice9.spec.md:123`) inherit the merged codes.
4. [Certain] **There is no AU constant in `src/v2/core`.** The AU is a literal in 21 files under `src/` and `tools/`: 149,597,870.7 km in 17 (for example `src/v2/render/slice9-spatial-partition.ts:78`) and 149,597,870,700 m only in 4 more (for example `src/v2/app/solar-system/runtime.ts:73`); none under `mcp/`. Idea 22 reported part of this first (five homes of one length).
5. [Certain] **The pre-research report's U and data-arc tables are from a 41,902-row pull** (`SLICE_9_PRERESEARCH_REPORT.md:19`, `:52-77`) and do not say which end of an arc bucket is closed. The fixture has 4 more bodies. Quote the fixture.

Not a defect, but worth knowing: one record has `elements.maRad` null (the census shows it), the hyperbolic comet C/2015 D1, whose mean anomaly is not defined the elliptic way.

**Gates this has not been through.** Aster's founding-document seat and DEC process; the multi-agent math audit; Aster's own oracle validation (the Horizons and SBDB comparisons here are this deposit's, not Aster's process); the protected-core review for anything that would move into `src/v2/core`; DEC-17-5's computation-derived labels (`SLICE_17_FOUNDING.md:197-212`); and INV-026 (`src/v2/SLICE_14_FOUNDING.md:49`), under which every count on a trust surface must render from one committed provenance artifact.

## Where it would land

- **The page:** Aster `src/v2/app/` as a "distributions" drawer on the catalog list (`src/v2/app/catalog-list/panel.ts`), or a data page beside the about pages. Shipping it for real needs a founding-document seat, labels derived per DEC-17-5, and INV-026 provenance on every count.
- **The derivation:** `tools/slice9-ingestion/` beside `build-nea-catalog.mjs`, so the bins regenerate whenever the fixture does, and `--check` becomes a CI step. Shipping it there means:
  - importing the AU from a core constant (which would have to be created);
  - importing the class rule, band edges and radius formula from `src/v2/core` rather than reading them by regex;
  - re-running the SBDB oracle against the pull the fixture is built from, not today's SBDB.
- **The findings** belong in Aster's re-anchor path: drop or flag bodies whose SBDB orbit carries `not_valid_after` before the re-anchor epoch, recompute orbitClass (or record it as SBDB's label at SBDB's epoch), and keep SBDB's class codes' case.
