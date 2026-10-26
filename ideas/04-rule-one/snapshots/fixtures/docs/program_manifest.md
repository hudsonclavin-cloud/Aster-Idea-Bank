# Skyhook Program — Master Artifact Manifest

**Single authoritative index for the Project. Supersedes the prior data-room README.**
Reference design: **Rev A** (repo `params/rev_a.json`) — CoM 610 km · L 320 km · **v_tip 2.5 km/s** · SF 2.5. **Canon is a three-tier ladder: 2.5 km/s reference (GTO/high-elliptical, 40/64/122× mass ratio at 0/15/30% derate) · 2.8 km/s cislunar_revenue_gated_option (TLI, 295×) · 3.5 km/s phase3_growth_option (Mars-class escape, 3086×). 3.5 is neither the reference nor cislunar.** The 22 Aug "Rev B" work wrongly promoted 3.5 to reference; **corrected 25 Aug per Hudson's Option 1** — the repo stays canon. Rev B's tip-speed-independent locks still stand: **UHMWPE-bulk/Zylon-hot-section hybrid construction, era-gated rocket-leg ladder, Aug-2026 launch canon, corrected heritage claims**. Per Rule 1, any artifact that deviates says so explicitly.

> **⚠ CANON CORRECTION (25 Aug 2026).** Every artifact that said "Rev B / 3.5 km/s reference / reaffirmed" has been corrected to Rev A (2.5 km/s reference), with 3.5 km/s labeled the growth option: the **public site** (index/bible/theater — corrected files delivered, theater gained a Rev A/Growth toggle), the **bible** (.md + Artifact), **RB-001** and **TS-001** (correction banners). Reference numbers: catch 5.05 km/s ECI, release 10.05 km/s (below escape — high-energy ellipse), tip 2.0 g, mass ratio ~41× (65×/123× at 15%/30% derate), delivered ladder $6,196/$2,260/$979 per kg. **Closed since:** the two .jsx simulators are re-anchored (stress-tester relabeled as the growth-option tool; strategy sim defaults to the 2.5 km/s reference ladder) and a corrected `rotovator-rev-a` SKILL.md was delivered for Hudson to save. **Still open:** founding-doc §2.2 worked example, teaser/deck/FAQ wording, and financial-model inputs still carry 3.5-era numbers.

> **⚠ CANON CORRECTION (31 Aug 2026, verified against `params/rev_a.json`).** Rev A canon is a **three-tier ladder**, not two. **2.5 km/s reference** — release 10.06, C3 −8.06, apogee 85,222 km; mass ratio 40.3 / 64.3 / 121.8× at 0/15/30% derate; GTO/high-elliptical. **2.8 km/s `cislunar_revenue_gated_option`** — release 10.36, C3 −1.94, apogee 397,819 km (lunar-apogee/TLI); **295.27×** at 30% derate; canon economics: viable only if construction launch < ~$686/kg (at $500/kg customer price, Y15 payback), needs a named cislunar anchor. **3.5 km/s `phase3_growth_option`** — C3 +13.05, Mars-class escape; **3085.95×** at 30% derate; launch-cost-dominated, not near-term. All three mass ratios re-derived from the Moravec formula in the file and confirmed. The August artifacts (**BF-001, MP-001, the BF-001 delta below, LR-001**) **conflated cislunar with the 3.5 tier and costed 3.5 at ~440× — ~7× too light.** **Retracted:** "the 3.5 growth option carries the business at 67–73% margin." **Corrected:** cislunar = the 2.8 tier; the near-term business case is that 2.8 option, hard-gated at construction launch < ~$686/kg. Frontier banner + reading corrected & republished; repo doc banners queued for Codex; the frontier's interactive growth-mode $/kg still needs a rebuild against `finance/skyhook_finance.py`.

Last reconciled: **22 Aug 2026**. Trust legend: **[Verified]** checked against primary sources (VM-001/VM-002) · **[Anchored]** built on the verified physics/economics chain · **[Planning]** labeled assumptions · **[Demo]** illustrative, not engineering-grade.





















































- **NEW:** `claude/skyhook_perplexity_research_brief.md` — paste-ready 7-module desk-research brief targeting the numbers the pending vendor replies would supply.
- **NEW:** `claude/skyhook_mp001_market_pricing.md` (**MP-001**) — the processed results of that pass. Now sourced: LEO benchmarks (Transporter $7,000/kg, F9-capacity arithmetic $3,245/kg, Electron ~$25,000/kg), HASTE ≈ $9.5M/flight (no $/kg possible), insurance brackets (launch 5–20% of value, in-orbit 0.6–1.0%/yr, ~$0.9B/yr market), HMPE creep guidance, mature-Starship scenario ladder ($2,000/$200/$20 per kg). Confirmed NO PUBLIC DATA: leg-at-handoff pricing, OTV rate cards (→ **the GTO/GEO/cislunar multipliers stay internal assumptions**), bulk fiber contracts, rotovator capex, first-of-kind insurance. Three new owned derivations: **reboost 48 kWh/kg ≡ ~26% ED efficiency vs the 12.4 kWh/kg canon energy** (ladder $7.60/$4.40/$2.85 per kg); **insurance decomposition → the early market is low-value-per-kg bulk mass** [Likely], since the unproven-system surcharge scales with payload value; **creep vs SF 2.5 [Likely]: HMPE sections run at 28–40% of break vs ≤20% multi-year guidance — SF 5 would blow mass ratio ~41×→~800×, so the honest outcomes are creep-governed replacement cadence and/or a hybrid boundary shifted toward PBO** (new named hard part; feeds TP-001 + proposed **ST-002** kitchen creep coupons). Frontier (BF-001) annotated + republished accordingly.

## Session delta — 24 Aug 2026
- **NEW:** `claude/skyhook_rev_c_tradestudy.md` (TS-001) — the tip-speed ↔ rocket-leg coupled costing. **v_tip 3.5 km/s reaffirmed in all three ladders**; includes **ERRATUM E1 to RB-001** (facility capex corrected to $5.7/$3.8/$1.7B; delivered $/kg to $3,919/$1,538/$658) and identifies the one [Speculative] assumption (leg-cost slope vs Δv) that provider pricing will settle.
- **NEW:** `claude/skyhook_outreach_pack.md` (OP-001) — three ready-to-send emails (Toyobo MC, FibrXL/Avient, Rocket Lab) that convert the weakest estimates to grade-A numbers; the Rocket Lab reply directly tests TS-001's load-bearing assumption.
- **UPDATED:** `claude/skyhook_rev_b.md` — Erratum E1 appended.
