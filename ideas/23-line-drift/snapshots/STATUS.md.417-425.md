<!-- excerpt of STATUS.md lines 417-425 at 62ddb17 -->
1. **Literal window label on a trust surface — the first Slice 19 item. Product code; its own commit; NOT fixed
   here.** `src/v2/app/porkchop/main.ts:637` renders the hardcoded string "Grid spans 2026-2040 departures and
   182.5-1826.25 day flight times." into the dedicated porkchop page. DEC-17-5 requires a derived label, and the
   same file derives the adjacent line correctly at `:646` (`Grid: ${GRID_PARAMS.nDep}x${GRID_PARAMS.nTof}`); the
   grid itself is defined at `:187-194`, with `depEndJD: utcMidnightToJdTdb('2040-01-01')` at `:189`. This is an
   **honesty defect, not a cosmetic one**: the literal's "2040" and the catalog footer's *derived* "2040" denote
   different bounds — the porkchop grid's last departure is 2040-01-01, while the footer derives from the screening
   cache's `metadata.screeningWindow.endUtc` of 2040-12-31 — so the sentence advertises roughly twelve months of
   departures the grid does not have. The literal ships: `docs/assets/porkchopV2-z3nhVK2W.js` contains it.
