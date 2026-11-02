<!-- excerpt of src/v2/SLICE_9_FOUNDING.md lines 423-428 at 62ddb17 -->
## Amendment (2026-07-12, RR wave) -- Slice 9 A.3 cutover fixture provenance correction

The Slice 9 A.3 cutover harness references
`tools/slice9-research/data/slice9-cutover-sample.json` as "the committed
162-body set." That file was NEVER COMMITTED -- `.gitignore:17` excludes
`tools/slice9-research/data/*` with five `!` exceptions that do not include it.
