# Lambert Multi-Rev Pinned Cells Fixture

This fixture pins small, hand-inspectable Lambert inputs and outputs for replay by Node without regenerating a grid or invoking Python.

## Files

- Fixture: `tests/fixtures/v2/lambert-multi-rev-pinned-cells.json`
- Spec: `tests/fixtures/v2/lambert-multi-rev-pinned-cells.spec.md`

## Generation

- Generated at: `2026-07-07T20:24:51.432Z`
- Solver commit: `de5c4ee`
- Node version: `v24.18.0`
- Method: Throwaway tsc compile to .tmp-lambert-fixture, then dynamic import of compiled JS; temp dir deleted after generation.
- Geometry source: `tests/fixtures/v2/nea-catalog-slice9.json` + `src/v2/data/horizons-inner-solar-system-2026-2040.json`, following the current production long-Earth-fixture path (the older tests/fixtures path was moved in Slice 11).
- Body/geometry: one Apophis geometry (departure `2028-01-31`, TOF `834.8214285714286` days) reused for M=0, M=1, and M=2.
- Null case: same r1/r2 geometry, M=2, with `tofSeconds` below dimensional `T_min(M=2)` (63710029.77122234 s), confirming `lambertMultiRev` returns `null`.
- Tolerance for replay: `1e-9` relative. The solver's internal multi-rev root tolerance is `1e-8`; this fixture tolerance is for output regression comparisons.

## Provenance classes

Every cell has `provenanceClass`. Feasible cells are currently `oracle-anchored`; the null cell is `aster-self-consistent`.

Oracle upgrade: succeeded. poliastro 0.17.0 returned values for all feasible selected branches. Feasible selected-branch cells carry `poliastroCheck` blocks. The null cell remains self-consistent because its purpose is to pin Aster's null-return boundary behavior.

## Regeneration rule

Do not hand-edit numeric values. Regenerate this fixture if any file in the `lambert-multi-rev.ts -> vec3, initial-guess, householder, tof -> hyp2f1b` transitive graph changes, or if geometry fixtures are intentionally changed.
