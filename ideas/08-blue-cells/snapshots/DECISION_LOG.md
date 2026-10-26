











































## 6. The workbook ladder conflation and its fix [Certain — commit 2c27b05]

The financial workbook's "conservatism ladder" had tip speed at **2.0 / 2.8 / 3.5 km/s** across Conservative/Baseline/Optimistic — silently switching *destination class* (GTO reference / cislunar option / Mars option) while claiming to vary *conservatism*, the same conflation as item 4 in financial form. Fixed in 2c27b05: all three columns now run the 2.5 km/s reference; conservatism is expressed **only** through fiber strength derate (30% / 15% / 0%, matching the rev_a.json ladder). Post-fix workbook results: Conservative 121.83× / 609 t / $8,741M / payback ~Y17; Baseline 64.30× / 322 t / $5,772M / Y9; Optimistic 40.32× / 202 t / $4,226M / Y7.

## 7. The "2.5 km/s is robust" claim mixed an optimistic launch price into the conservative case [Certain — reproduced computationally]

Stated plainly: **a prior analysis claimed "2.5 km/s pays back Y14 at $800/kg construction launch" as if it were the conservative case. It was not. $800/kg is the optimistic column's launch price; the conservative column's own launch price is $2,500/kg (workbook Assumptions B5).** The Python model (`finance/skyhook_finance.py`, `conservative_except_launch`) reproduces the mixed configuration exactly — conservative-except-launch@$800: total capex $6,877M, payback Y14 — confirming it was a real computation of a mislabeled case. The true conservative case is $8,741M with payback ~Y17. A regression test (`test_variant_is_not_the_conservative_case`) now guards against re-mixing.

**Addendum, 2026-07-06:** the mixed-case error class recurred in a dispatch spec (launch=$800 paired with the $2,500-basis triple, in the right-size grid's reconciliation-gate instructions) and was caught by the reconciliation gate itself (`finance/rightsize_sensitivity.py`) — gates catch their authors; this is why they exist.

## 8. Current open state [labels per item]

- **[Certain]** The Rule-4 conservative case **fails the 15-year window**: payback ~Y17, NPV@10% −$3,883M over 15 years.
