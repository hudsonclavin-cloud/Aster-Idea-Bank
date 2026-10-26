# DECISION LOG — Mass-Model and Reference-Design Due Diligence
**Compiled overnight 2026-07-02 on branch `overnight-20260702`, from the git record (commits e0ff4d8 → 2c27b05 on main), params/rev_a.json, physics/skyhook_physics.py, the corrected financial workbook, and VM-001. Every number below is cited to one of those artifacts, not to memory (Rule 2).**

This is the definitive record of how the program's mass model and reference tip speed got to their current state, including the two errors that were caught and what remains open.

---

## 1. The unsourced 440× figure [Certain — from commit 3401723's diff]

Program memory carried a "440× tether-to-payload" figure with no derivation. The audit (commit 3401723, `rev_a.json` `tether_to_payload_440x_flag`) showed it does not derive cleanly from any stated parameter set: EQ-5 at SF 2.5 with 30% derate gave ~360× per arm at the then-reference 3.5 km/s; 440× would require a 23.64% derate (or SF 3.274 at zero derate). Disposition: recorded as non-canonical, retained only as an audit trail entry, superseded entirely by item 2.

**Addendum, 2026-07-06 [Likely — numerical coincidence plus plausibility, provenance chain unrecoverable]:** the 2026-07-06 site-reconciliation pass computed the *correct* integrated two-arm mass ratio (EQ-6, `physics.skyhook_physics.integrated_mass_ratio`) at the old 3.5 km/s reference, SF 2.5, **0% derate**: `integrated_mass_ratio(3.5, Vc=2.7269, SF=2.5, derate=0.0)` = **440.3996× ≈ 440.40×** — verified by running the computation directly against `rev_a.json`'s canonical σ=5.8 GPa, ρ=1560 kg/m³ before writing this line, not copied from memory. This is an exact match to four significant figures. The historical "440×" therefore most likely originated from the correct integrated formula evaluated at zero derate, at some point mislabeled or misremembered as the *conservative* case — item 2's original audit only ever checked it against the wrong formula (peak-taper EQ-5), so this match was never tested at the time. **Lesson:** an unsourced correct number is still a liability. It was "corrected" to a wrong-formula value precisely because it carried no derivation — a right answer with no shown work is indistinguishable from a wrong one until someone re-derives it, which took until this pass.

## 2. Taper-ratio vs integrated-mass conflation [Certain]

The original mass model used EQ-5, `Taper = exp[(v_tip/V_c)² · SF]`, as if it were a mass ratio. It is not: it is the **peak cross-sectional area ratio** (center ÷ tip), and the peak exists only near the center. The correct tether-to-payload mass ratio integrates the tapered profile over the full length (Moravec/Forward):

> **M/m = 2·√π·x·e^(x²)·erf(x)**, x = (V_t/V_c)·√(SF/(1−derate)), V_c = √(2σ/ρ)  — now EQ-6, implemented in `physics/skyhook_physics.py::integrated_mass_ratio` and tested.

At the 2.5 km/s reference (Zylon: σ 5.8 GPa, ρ 1560 kg/m³, V_c 2.73 km/s, SF 2.5 — all rev_a.json): peak area taper is ~8.2 (no derate), while the integrated two-arm mass ratio is **40.32× (0% derate) / 64.30× (15%) / 121.83× (30%)** (rev_a.json `mass_ratio.integrated_tether_to_payload_both_arms`). Commit 800e58f removed the EQ-5-as-mass-ratio entry; 2c27b05 purged the last prose remnant from the founding doc (§2.3's "100–200×" → the integrated ladder).

## 3. HASTOL reconciliation [Certain per VM-001 §3]

VM-001 found the "HASTOL tether massed ~100× payload" claim was a **misattribution**: HASTOL Phase I's tether-control-station mass was 150 Mg for a 15 Mg payload — **~10× at safety factor 3** at their tip speed (3.5 km/s, mostly Spectra 2000 with a Zylon outer 20 km). Our much larger figures come from our own deliberately conservative derates and safety factors and are presented as ours, not HASTOL's. This is favorable: the literature design point is far lighter than our planning case. (NIAC 355Bogar/391Grant reports, cited in VM-001.)

## 4. C3 correction and the threshold goalpost error — caught and reverted [Certain — from commit 800e58f's diff]

Two coupled errors existed before 800e58f:

- **C3/energy bookkeeping:** release energy had been claimed loosely ("exceeds escape velocity") without evaluating it at the correct radius. Corrected: energy is evaluated at the **upper-tip radius** r = R_E + 610 + 320 = 7,301 km. At 2.5 km/s, v_release = 10.06 km/s gives **C3 = −8.06 km²/s²** — bound, apogee ≈ 85,200 km, i.e. GTO/high-elliptical class, *not* cislunar and *not* escape (rev_a.json `kinematics`). The 3.5 km/s case does escape (C3 = +13.05).
- **Goalpost-moving:** the old test suite asserted `mars_escape_tip_speed == v_tip` exactly ("Mars threshold and Rev A tip speed have drifted apart") — i.e., the market threshold was *defined to track the chosen reference*, so changing the reference silently moved the goalposts. Reverted in 800e58f: thresholds are now physics constants evaluated at the tip radius (GTO ≈ 2.1, TLI ≈ 2.8, C3=0 ≈ 2.9, Mars-class C3 8–13 ≈ 3.3–3.5 km/s), guarded by the rev_a.json note **"Do not move these thresholds to match the chosen reference"** and by `test_mars_escape_is_phase3_option`, which now fails if the threshold drifts back toward the reference.

## 5. The financial gate: reference moved 3.5 → 2.8 → 2.5 km/s [Certain for the numbers; the decision itself is a program judgment]

The mass ratio's exponential-in-x² growth makes tip speed the dominant cost driver once the integrated model is used (item 2):

| Tip speed | Integrated M/m @ 30% derate | Fiber @ 5 t payload | Status (rev_a.json) |
|---|---|---|---|
| 2.5 km/s | 121.83× | 609.1 t | **Rev A reference** (GTO/high-elliptical) |
| 2.8 km/s | 295.27× | 1,476.3 t | Cislunar/TLI — revenue-gated, needs named anchor customer |
| 3.5 km/s | 3,085.95× | 15,429.8 t | Phase 3 Mars-class growth option; launch-cost-dominated |

Breakeven figures recorded with the 2.8 km/s gate (rev_a.json `cislunar_revenue_gated_option`): at $500/kg customer price, construction launch must be ≤ ~$686/kg for Y15 payback; at $800/kg construction launch, breakeven customer price is ~$517/kg. The 3.5 km/s case was retired as reference because ~15,430 t of fiber launch dominates all economics (financial analysis 2026-07-02, commit 800e58f).

## 6. The workbook ladder conflation and its fix [Certain — commit 2c27b05]

The financial workbook's "conservatism ladder" had tip speed at **2.0 / 2.8 / 3.5 km/s** across Conservative/Baseline/Optimistic — silently switching *destination class* (GTO reference / cislunar option / Mars option) while claiming to vary *conservatism*, the same conflation as item 4 in financial form. Fixed in 2c27b05: all three columns now run the 2.5 km/s reference; conservatism is expressed **only** through fiber strength derate (30% / 15% / 0%, matching the rev_a.json ladder). Post-fix workbook results: Conservative 121.83× / 609 t / $8,741M / payback ~Y17; Baseline 64.30× / 322 t / $5,772M / Y9; Optimistic 40.32× / 202 t / $4,226M / Y7.

## 7. The "2.5 km/s is robust" claim mixed an optimistic launch price into the conservative case [Certain — reproduced computationally]

Stated plainly: **a prior analysis claimed "2.5 km/s pays back Y14 at $800/kg construction launch" as if it were the conservative case. It was not. $800/kg is the optimistic column's launch price; the conservative column's own launch price is $2,500/kg (workbook Assumptions B5).** The Python model (`finance/skyhook_finance.py`, `conservative_except_launch`) reproduces the mixed configuration exactly — conservative-except-launch@$800: total capex $6,877M, payback Y14 — confirming it was a real computation of a mislabeled case. The true conservative case is $8,741M with payback ~Y17. A regression test (`test_variant_is_not_the_conservative_case`) now guards against re-mixing.

**Addendum, 2026-07-06:** the mixed-case error class recurred in a dispatch spec (launch=$800 paired with the $2,500-basis triple, in the right-size grid's reconciliation-gate instructions) and was caught by the reconciliation gate itself (`finance/rightsize_sensitivity.py`) — gates catch their authors; this is why they exist.

## 8. Current open state [labels per item]

- **[Certain]** The Rule-4 conservative case **fails the 15-year window**: payback ~Y17, NPV@10% −$3,883M over 15 years.
- **[Certain, within model assumptions]** Minimal-relaxation results (finance/SENSITIVITY_FINDINGS.md): the case closes if any ONE of: cadence ≥ 1.10 catches/day (+10.4%); customer price ≥ $550/kg (+10.0%); payload ≥ 5,758 kg; program capex ≤ $5,095M; derate ≤ 21.2%; construction launch ≤ $1,674/kg. Fixed ops cannot close it alone. Four single baseline-value substitutions close it (cadence→2/day gives Y11; launch→$1,500, derate→15%, program capex→$5,000M each give Y15).
- **[Speculative]** Monte Carlo (10k draws, self-set triangular ranges): P(payback by Y15) ≈ 75%; median NPV@10% ≈ −$1.9B — capital typically returned inside the window, 10% hurdle typically not cleared inside it.
- **Unvalidated inputs:** customer price ($500/kg — no named customer) and construction launch $/kg (no quote) are both assumptions; **fiber vendor quote outstanding** (rev_a.json `economics.fiber_cost_per_kg` = null, flagged WEAKEST INPUT — note the financial model currently prices fiber *launch*, not fiber *purchase*, so a quote adds capex not yet in the model); **no named cislunar anchor customer** (gates the 2.8 km/s option).

## 9. Right-size grid: the Phase 2 valley is an NRE problem, not a hardware problem [Certain within the stated scaling assumptions]

Right-size grid (2026-07-06, `finance/RIGHTSIZE_FINDINGS.md`): the NRE floor dominates all other scaling levers — the zero-NRE counterfactual closes 16 t/yr of demand at Y12 on ~$127M of hardware, while the carried NRE ($3.6–6B) pushes the minimum viable market to 152–242 t/yr against the ~24–56 t/yr accessible per the customer shortlist (`docs/outreach_log.md`). The Phase 2 valley is now **quantified as an NRE problem, not a hardware problem**. Consequence: **procure-vs-develop for the suborbital leg is the pivotal open business-architecture decision** — the trade is NRE-down vs marginal-up, and it MUST be modeled with sourced provider pricing before any anchor conversation approaches terms. Construction-launch verdict: a capacity-scale dependency only (right-sized configs survive even the $3,245/kg Falcon 9 anchor price; the 16/56 t/yr grids fail even at $800/kg) — the Week 1 construction-launch pressure test is closed.

## 10. HMPE creep at Rev A sustained load — named hard part [Likely — creep guidance is secondary-sourced (MP-001), spot-check pending]

**Date 2026-09-02 · Status OPEN · Sources: `docs/research/mp001_market_pricing.md` §3c; `docs/research/lr001_splice_literature.md` §D.**

At SF 2.5 the HMPE bulk sections carry a steady centrifugal load of 28–40% of rated break strength (40% raw; 28% if the 30% strength derate is applied in sizing). Published HMPE guidance is to keep sustained load at or below ~20% of break for multi-year life (SK78 ≈ 8 years at 20% load, 20 °C). The centrifugal load is genuinely sustained in the rotating frame, so this is the unfavourable regime.

**Consequence:** Reaching 20% sustained load would require SF ≈ 5, which cuts characteristic velocity by √2 and drives the 2.5 km/s reference mass ratio from ~41× to order ~800× under the Moravec form. That is a refutation of the design, not a variant of it. SF 2.5 therefore stands, and the creep exposure is carried as a named hard part rather than designed away.

**Admissible outcomes (not yet decided):** (a) creep-governed tether replacement cadence, costed into ops; (b) hybrid material boundary shifted toward PBO for the high-stress fraction; (c) HMPE grade change — DM20-class is reported to creep >50× slower than SK78 (LR-001 §D), so grade may matter as much as geometry; (d) some mix of the above.

**Evidence that would close or change this entry:** ST-002 coupon creep-rate ratio at ~20% vs ~40% of break (4–8 week hold); the TP-001 creep test series; a rope-maker application-engineering dataset on DM20 vs SK78 sustained-load life; a primary-source creep curve replacing the secondary guidance above.

**Downstream actions opened by this entry (tracked elsewhere, not done here):** risk register row update; TP-001 scope addition; ST-002 protocol.

---
*Log compiled by the overnight autonomous run. Nothing in this file modifies canonical parameters; it records how they got here.*
