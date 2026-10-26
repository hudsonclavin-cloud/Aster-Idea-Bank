# Outreach Log

Every external contact for the Skyhook program. This file is the year's real progress metric — commits don't count here, only signatures, quotes, and responses.

## ⚠ Reconciliation — August workstream vs. the July plan (31 Aug 2026)

The July plan below was partly superseded by the August workstream. Honest reconciliation; July content preserved as the historical record.

**What August actually sent (redacted/public materials throughout):**
- Rocket Lab (HASTE), Gmail — rocket-leg price/payload vs. deployment velocity. NEW; no leg outreach in July. Gates the correlation hedge.
- Toyobo (Zylon PBO), web form — second touch (also direct-emailed 2026-07-02).
- FibrXL (Dyneema SK78), web form — different vendor + material from July's Avient/PBO row (UHMWPE, not PBO); effectively new.
- Impulse Space, web form — OVERRODE the July deferral (see below).

**Divergences:**
1. Impulse deferral overridden inadvertently — the August (claude.ai) session couldn't see this repo-only decision. Go-forward (Hudson, 31 Aug): ENGAGE, DISCIPLINED — public/redacted materials only, capture their Δv $/kg, share no design specifics. Harm low (redacted; concept is public physics). Root cause: split source of truth → fix = consolidate to repo.
2. Toray (T1100G carbon) dropped — consistent with the Rev B UHMWPE/PBO hybrid lock. Reclassify as retired, not pending.
3. Customer shortlist NOT contacted — Astranis/Firefly/Astrobotic remain un-contacted. Per the July pressure-test, customer outreach should wait for the right-size analysis and target a demand-cap + price data point. Pending, not missed.
4. Option-speed canon is THREE tiers, not two: 2.5 km/s reference · 2.8 km/s cislunar_revenue_gated_option (295.27×) · 3.5 km/s phase3_growth_option — all three are canon in params/rev_a.json, test-backed. demand_sensitivity.py's 2.8 keying for cislunar is CORRECT — do NOT change it. The error is in the August artifacts (BF-001 frontier, MP-001, manifest, LR-001), which conflated the 2.8 cislunar tier with the 3.5 growth tier and mis-attributed cislunar economics to 3.5. Correction owed to those artifacts, not to canon.

**Strategic: the July pressure-test and the August frontier (BF-001) are two faces of one problem.** BF-001 found healthy per-kg margin; this pressure-test found no realistic shortlist amortizes the 1,825 t/yr capacity-sized cost base within 40 yr. Per-kg profit is necessary, not sufficient — the binding constraint is the capacity-demand mismatch. Both point to a right-sized bootstrap system (Rule 5). Integrating BF-001 with demand_sensitivity.py + the rightsize model is the core open economic question, ahead of customer outreach.

## Fiber Vendors

| Date | Vendor | Channel | Material | Ask | Status |
|---|---|---|---|---|---|
| 2026-07-02 | Toyobo USA | Direct email (info@toyobousa.com) | Zylon PBO (5.8 GPa) | Pricing + lead time, 1t/100t/600t ladder | Sent, awaiting response |
| 2026-07-02 | Avient | Contact form ("Other/I Don't Know" category, Company: Skyhook) | Zylon PBO (5.8 GPa) | Pricing + lead time, 1t/100t/600t ladder | Submitted, awaiting response |
| 2026-07-02 | Toray Composite Materials America | Contact form | T1100G (~7.0 GPa) | Availability + pricing, 1t qualification → larger run | Submitted, awaiting response |

**Follow-up dates:** Follow-up dates (offices closed for July 4th holiday, clock starts Mon Jul 6): Toyobo direct email → follow up if no response by 2026-07-15. Avient and Toray contact forms → follow up if no response by 2026-07-22.

**Response clock:** budget 2-3 weeks for the two contact-form submissions (Avient, Toray) before follow-up; 1-2 weeks for the direct Toyobo email. Flag in this log the moment any of the three responds, and log total silence past the deadline too — that's data, not failure.

## Customers

Tier mapping matters: cislunar rows validate the revenue-gated 2.8 km/s option, NOT the 2.5 km/s base case (Rule 1 of demand analysis).

| Rank | Target | Tier (GTO base-case / cislunar 2.8-gate) | Annual tonnage signal + label | Controls high-energy-leg spend? | The ask | Status |
|---|---|---|---|---|---|---|
| 1 | Astranis | GTO | [Certain] 5 GEO flown, 6 Omega planned 2026, 24/yr ambition [Likely] (~4→16 t/yr) | Yes — buys dedicated F9 + months of orbit-raising | Committed t/yr at ~half current leg cost, days-not-months delivery | Not contacted |
| 2 | Firefly Aerospace | Cislunar (2.8-gate) | [Certain] NASA 10 landers/yr target from 2027, ~$590M new CLPS awards 2026-06-30; [Speculative] 20–40 t/yr TLI-class ecosystem-wide | Yes | TLI tonnage commitment framing; note Elytra OTV overlap | Not contacted — **FIRST outreach target** |
| 3 | Astrobotic | Cislunar (2.8-gate) | Same ecosystem signal; two new Peregrine awards $297.9M [Certain] | Yes | — | Not contacted — second |
| 4 | Intuitive Machines | Cislunar (2.8-gate) | IM-4 award $148.3M [Certain] | Yes | — | Reserve |
| 5 | USSF Maneuverable GEO | GTO | [Certain] $895–905M/5yr | Capability buyer | — | **EXHIBIT ONLY** — no cold outreach until a named reviewer exists |
| 6 | Impulse Space | Channel/competitor | [Certain] Helios 300 kg GEO rideshare ports — aggregates segment tonnage | — | — | **DEFERRED** — approach last (competitor information-leakage risk logged) |
| 7 | Legacy GEO operators (SES/Intelsat/Eutelsat/Viasat) | GTO | [Likely] largest tonnage pool, ~5–7 t/sat | — | — | Reserve tier |

### Pressure test — shortlist tonnage vs. the demand-capped model (2026-07-06)

Ran the table's own tonnage signals through the demand-capped conservative model (`finance/demand_sensitivity.py`, reconciled to `finance/skyhook_finance.py`), including at the Astranis ask price itself ("~half current leg cost" = half the verified GTO premium: ~$2,835/kg on the max-performance basis, ~$5,105/kg bookable). Payback year, conservative case:

| Demand scenario (from the table above) | $500/kg | $550/kg | $2,835/kg | $5,105/kg |
|---|---|---|---|---|
| Astranis floor (4 t/yr) | >Y40 | >Y40 | >Y40 | >Y40 |
| Astranis full ambition (16 t/yr) | >Y40 | >Y40 | >Y40 | >Y40 |
| Astranis + Firefly-ecosystem max (56 t/yr — knowingly mixes 2.8-gate tonnage into the base case) | >Y40 | >Y40 | >Y40 | >Y40 |
| Grid anchor 100 t/yr | >Y40 | >Y40 | >Y40 | Y28 |
| Grid anchor 200 t/yr | >Y40 | >Y40 | Y25 | Y15 |

**Findings, plainly [Certain within the model's assumptions]:**

1. **Full shortlist conversion does not close the conservative case — at any price tested, including the ask.** Even granting every named target's maximum signal *and* illegitimately counting the cislunar (2.8-gate) tonnage toward the base case, 56 t/yr at $2,835/kg yields ~$159M/yr mature revenue against a capacity-sized cost base of ~$112M/yr — barely cash-positive in operations, and payback never arrives inside 40 years. At Astranis-only volumes (16 t/yr, $45M/yr revenue), operating cash flow is **negative before any capex recovery**.
2. **The cadence and price "closers" are not independent of demand.** `SENSITIVITY_FINDINGS`' cheapest closers (≥1.10 catches/day, ≥$550/kg) implicitly assume selling ~full capacity (1,825 t/yr). Shortlist-realistic demand implies **0.01–0.11 catches/day sold** — two orders of magnitude below the cadence closer. The demand column dominates both, which is `DEMAND_SENSITIVITY_FINDINGS`' headline, now confirmed with named targets instead of grid anchors.
3. **What outreach can and cannot prove:** the Astranis conversation tests *price and willingness* for the base case (the only named base-case row), and Firefly/Astrobotic test the *2.8-gate option* — but no realistic shortlist outcome validates the 1,825 t/yr capacity-revenue assumption. Reaching even the 200 t/yr grid anchor requires ~33 GEO-class sats/yr through the system at the table's own 5–7 t/sat figure. The honest evidence goal for this outreach round is a demand-cap data point and a price point, not base-case validation.
4. **Constructive implication (already flagged in `DEMAND_SENSITIVITY_FINDINGS` caveats, now urgent):** at shortlist-scale demand the binding problem is the capacity-sized cost base, not price. A **cadence-matched / right-sized system variant** (capex and opex scaled to realistic early demand instead of 1,825 t/yr) is the natural next analysis before any anchor conversation turns into a term sheet.

## Community / Technical Review

*(none yet — Week 5 target: TU Delft, Universidad Carlos III, Tethers Unlimited alumni)*
