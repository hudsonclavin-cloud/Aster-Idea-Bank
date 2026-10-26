<!-- excerpt of INVARIANTS.md lines 171-180 at 62ddb17 -->
### Evidence artifact tracking (INV-034)

Any file referenced by a founding document, INVARIANTS.md, or a test as
committed evidence MUST be git-tracked. Evidence directories under an ignored
glob require an explicit `!` exception at commit time. Verification:
`git check-ignore -v <path>` returns nothing for every claimed-committed
artifact. Born from the Slice 9 A.3 cutover sample -- described as "the
committed 162-body set" (`SLICE_9_FOUNDING.md:202`, `:350-353`), silently
excluded by `.gitignore:17`, never committed, unrecoverable.

