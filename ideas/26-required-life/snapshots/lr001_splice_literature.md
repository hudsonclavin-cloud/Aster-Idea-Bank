# LR-001 — Splice-Joint Literature Review (HMPE) · 31 Aug 2026

**Design revision assumed:** Rev A reference (v_tip 2.5 km/s, SF 2.5, per `params/rev_a.json`).
**Provenance:** Perplexity Deep Research run by Hudson against the scoped splice-precedent query (`claude/skyhook_perplexity_research_brief.md` companion), 31 Aug 2026. Secondary-sourced; **the citations below are Perplexity-surfaced and must be spot-checked before any external/publication use.** This note upgrades the founding-doc joint requirement (Part IV §4.1) from *literature assumption* to *sourced-with-identified-gap* — closing a standing Rule 2 debt.

---

## Bottom line
Well-executed **eye splices** in 12-strand HMPE retain roughly **90–100%** of parent break strength — this is established in manufacturer and marine-rigging practice and is where our H2 came from. But the public record is **genuinely thin for a structural end-for-end / mid-line splice, especially in ≤2 mm HMPE**, under sustained load, cyclic load, and orbital environment. **Verdict: a properly controlled bench program on ≤2 mm end-for-end HMPE splices would produce novel, decision-relevant data — not merely reproduce a known result.** This is the opposite of what we assumed this morning; ST-001 is now worth doing on its scientific merits, not only as a credibility prop.

## The load-bearing numbers

| Joint | Retention | Fiber / dia | Source | Type |
|---|---|---|---|---|
| **Yale Ultrex factory splice** — *the strongest real spliced/unspliced ratio found* | **88.5–92.8%** (6 mm 92.6% · 22 mm 89.7% · 51 mm 88.5%) | HMPE-core double braid, 6–51 mm | Yale Cordage, Ultrex Plus data sheet | Manufacturer data sheet |
| Eye splice, correctly made | ~90% (loss ≤10%) | HMPE/Dyneema | Marlow, "Rope Strength & How to Retain It," 2017 | Mfr guidance |
| Knot in HMPE | **~20–40%** retained | Dyneema | Marlow 2017; Practical Sailor 2024 | Mfr / trade |
| Bury-length rule of thumb | **60–72 × diameter** per buried tail | Hollow HMPE braid | Animated Knots; Sailing Mag 2023; Premium Ropes | Instructional |
| **End-for-end / mid-line splice (locked Brummel + long bury)** | **NO CONTROLLED PUBLIC DATA** | Dyneema | Rigging Doctor tutorial describes *construction*, reports no break ratio | Gap |
| **Fine HMPE ≤2 mm splice (eye or inline)** | **NO PUBLIC DATA** | ≤2 mm Dyneema | none located | Gap |

**Caveat that matters:** many catalog "rope strengths" are measured on *spliced-end specimens*, so a datasheet number often already bakes in the splice — it is not an independent splice-vs-parent ratio. The Yale Ultrex figures above are the cleanest exception found.

## Established vs. genuine gap

**Established:** knots are a poor termination (~20–40%); a correct HMPE eye splice is much stronger (~90–100%, use 90% as the conservative planning value); slippery HMPE needs a long tapered bury (60–72D); offshore practice qualifies the *complete assembly*, not bare rope (OCIMF MEG4, ABS 2021) — the right philosophical model for a tether.

**Genuine public gaps (this is our target list):**
1. **End-for-end / mid-line HMPE splice efficiency** — no robust public dataset; no vetted range for a symmetric locked-Brummel + long-bury joint vs. matched unspliced line.
2. **Eye-vs-inline A/B** at the same rope/dia/protocol — not public.
3. **Retention-vs-bury-length curve** η(L_bury/D) with scatter and failure modes — rules exist, the curve doesn't.
4. **≤2 mm diameter** — no controlled splice-retention data; large-mooring results are *not* assumed scale-invariant.
5. **Splice creep** — tail migration / joint elongation / residual strength after sustained hold: thin.
6. **Tether environment** — inline splice under vacuum/UV/thermal cycle/AO/micrometeoroid + cyclic tension: none.
7. **Space-tether programs** (Hoytether, HASTOL, MXER, YES2, space-elevator) discuss architecture and redundancy but publish **no HMPE splice-retention numbers** — which is precisely why the founding doc lists joints as the #1 risk.

## Strategic implications

**A · This turns ST-001 from a confidence-builder into a research contribution.** Our Samson Zing-It test article is **1.75 mm — inside the ≤2 mm public gap.** Even the kitchen version, done with matched controls, hits under-characterized ground. That is a materially stronger reason to run it than we had this morning.

**B · But the credible version needs a real instrument.** The review effectively wrote the spec: documented fiber grade (not just "Dyneema"), matched unspliced controls, a bury sweep (24/36/48/60/72/96 D), failure-mode logging (parent rupture vs. taper vs. lock vs. tail extraction vs. grip), interrupted sustained-load + residual-strength tests, 5th-percentile reporting, and testing at the actual small diameter. That is a tensile-lab program, not a single kitchen pull. → **This makes the NC State / Wilson College of Textiles path the main event, not a fallback.** We now hold what almost no student walks in with: a cited literature review proving a specific public gap + a protocol to fill it = a *research proposal*, not a request for money.

**C · Honest counterweight — "public gap" ≠ "unknown."** The review states plainly that this data is likely sitting in *proprietary offshore-mooring qualification dossiers and class-society approval files*. So (i) we'd be first to **publish it openly** (real academic value) but should not claim to be first to ever measure it; and (ii) a single industry contact (a rope engineer at Yale / Samson / Avient-DSM) could hand over a chunk of it **for free, faster than any experiment** — a cheap parallel move worth making.

**D · Creep couples straight into MP-001 §3c.** Published HMPE creep concern rises above ~15–20% of break load; **DM20 grade creeps >50× slower than SK78**; offshore uses creep safety factors ~5–8. Our Rev A HMPE sections sit at 28–40% steady load — squarely in the bad regime — so **material grade (DM20-class) may matter as much as splice geometry**, and ST-002's coupons test exactly this. Feeds TP-001 and the risk register.

## Dispositions
1. **Founding doc §4.1:** joint requirement now sourced — cite Yale Ultrex (88.5–92.8%) and Marlow (~90%) for the achievable eye-splice figure; state explicitly that the ≥85% target is **unproven for the end-for-end geometry we actually need**. (Wording edit queued.)
2. **ST-001 protocol:** reframe from "confirm 85%" to "pilot the method + probe the ≤2 mm end-for-end gap"; add an **eye-vs-inline** comparison arm; record the limitation that Zing-It is generic coated HMPE of undocumented grade; note 1.75 mm fortuitously lands in the gap. (Revision queued — not yet applied.)
3. **Risk register:** joints row → "eye splice ~90% established (Yale/Marlow); end-for-end at tether scale = public data gap, LR-001." Add DM20-vs-SK78 creep note.
4. **Next build:** a one-page **NC State research proposal** (lit gap + scoped minimal experiment + the ask) — the natural crystallization of this review; affiliation-independent.
5. **Parallel free move:** contact a rope-maker application engineer (Yale/Samson/Avient) for end-for-end HMPE splice qualification data.

## Key sources (verify before external use)
Yale Cordage — Ultrex Plus data sheet · Marlow Ropes, "Rope Strength and How to Retain It," 2017 · Samson Rope splice guidance / AmSteel-Blue · Practical Sailor, "Working with High-Tech Ropes," 2024 · OCIMF MEG4; ABS Fiber Rope for Offshore Mooring, 2021 · Vlasblom & Bosman, "Predicting the Creep Lifetime of HMPE Mooring Rope"; Lian, Zheng & Liu (ASME OMAE 2018) · NASA NTRS, "2006 Status of the MXER Tether System" · US Patent 6,290,186 (Forward failsafe multistrand tether) · YES2 / Dyneema 2007.
