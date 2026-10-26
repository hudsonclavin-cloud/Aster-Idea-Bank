# MP-001 — Market-Pricing Desk-Research Pass (Perplexity), 31 Aug 2026

**Design revision assumed:** Rev A reference (v_tip 2.5 km/s, SF 2.5, per `params/rev_a.json`).

> **⚠ Canon correction (31 Aug 2026).** This note originally treated "the growth option (3.5 km/s)" as the cislunar tier. Canon is **three tiers**: 2.5 reference · **2.8 km/s cislunar_revenue_gated_option (295×** — this is the cislunar/propellant tier**)** · 3.5 phase3_growth_option (Mars-class, 3086×, not near-term). Wherever the text below says cislunar economics ride on "the growth option," read **the 2.8 km/s revenue-gated tier**, whose canon gate is construction launch < ~$686/kg. The §3b bulk-propellant→cislunar finding is unchanged and, if anything, strengthened: the 2.8 machine (295×) is far lighter than the mistaken 3.5 (3086×) figure implied.
**Provenance:** Perplexity Deep Research run by Hudson against the SKYHOOK research brief (`claude/skyhook_perplexity_research_brief.md`), 31 Aug 2026. Everything here is **secondary-sourced desk research — spot-check any figure before external use.** RN-002 remains reserved for ST-001 splice data.
**Purpose:** replace placeholders with sourced numbers where the market publishes them; where it doesn't, say NO PUBLIC DATA and keep the placeholder explicitly labeled internal.

---

## 1 · Now sourced (usable as market inputs)

| Input | Cons | Base | Opt | Unit | Source class |
|---|---|---|---|---|---|
| Falcon 9 Transporter rideshare | 7,000 | 7,000 | 7,000 | $/kg LEO | advertised rate |
| F9 dedicated-capacity arithmetic ($74M ÷ 22,800 kg) | 3,245 | 3,245 | 3,070 | $/kg LEO | list price + arithmetic (not a paid price) |
| Electron dedicated | 26,700 | 25,000 | 25,000 | $/kg LEO | reported market figure |
| HASTE mission price (contract-implied, $190M/20) | 22.0M | 9.5M | 9.5M | $/flight | contract-implied — **no $/kg possible: payload-at-trajectory undisclosed** |
| Launch insurance rate | 20 | 10 | 5 | % of insured value | broker/market commentary, 2026 |
| In-orbit insurance rate | 1.0 | 0.7 | 0.6 | %/yr of value | broker/market commentary |
| Global space-insurance premium volume | 0.8 | 0.9 | 1.0 | $B/yr | market estimate |
| HMPE (SK78/SK99) specs: 0.97 g/cm³, SK99 ≈ +15–20% strength vs SK78, melt 145 °C | — | — | — | — | secondary spec sheets |
| HMPE creep guidance: sustained load ≤ ~20% of break for multi-year life; SK78 ≈ 8 yr at 20% load, 20 °C; creep 3–5× aramid | — | — | — | — | secondary engineering guidance |
| Zylon (PBO) marketplace proxy (10 kg MOQ, **not** a Toyobo quote) | 300 | 259 | 170 | $/kg | marketplace listing — low confidence |
| PBO headline specs: 5.8 GPa, 270 GPa modulus, >350 °C; UV/hydrolysis protection required | — | — | — | — | seller technical listing |
| US industrial electricity | 0.0917 | 0.0917 | 0.0738 | $/kWh | EIA / state rates |
| Mature Starship scenario ladder (analyst-anchored, **not** a price) | 2,000 | 200 | 20 | $/kg LEO | analyst estimates + stated targets |

**Validation received:** the strategy sim's "$3,245/kg today" LEO figure and the frontier's cheap-launch floor ($200 ≈ mature Starship baseline) both land on independently sourced anchors.

## 2 · Confirmed NO PUBLIC DATA — placeholders stay internal, now with proof of absence

Leg price at a Mach 10–17 handoff (any provider) · payload-mass-vs-handoff-velocity curves · small-launch marginal cost · OTV LEO→GTO/GEO/cislunar rate cards → **the 2.2× / 3.5× / 6.0× multipliers are unvalidated internal assumptions** · tonne-scale SK78/SK99 or branded-Zylon contract pricing · full-scale rotovator capex (MXER record is R&D-scale; no $B anchor exists for $5.7/$3.8/$1.7B) · insurance for a first-of-kind rotating tether facility. **Proof of absence is itself useful:** these numbers only exist inside vendor conversations, which is what the outstanding outreach is for — and the report's "request curves, not prices" vendor-ask lists are the correct follow-up asks.

## 3 · Derivations we now own (from canon + the sourced brackets)

**3a · Reboost coefficient grounded [Anchored].** Rev A imparts 44.8 MJ/kg = 12.4 kWh/kg of mechanical energy to the payload. Our 48 kWh/kg electrical placeholder therefore implies **~26% wall-to-momentum ED-reboost efficiency** — a derivable, defensible middle. Ladder at 15% / 26% / 40% efficiency → 83 / 48 / 31 kWh/kg → **$7.60 / $4.40 / $2.85 per kg** at 9.17¢/kWh. Reboost stays a rounding error; the coefficient is no longer a magic number.

**3b · Insurance decomposed [Anchored structure, Planning values].** The old $180/kg ≡ 10% × $1,800/kg insured value — now decomposable into three parts that behave differently:
- *Facility in-orbit cover:* 0.7%/yr × $3.8B = $26.6M/yr → **$266/kg at 100 t/yr cadence, $27/kg at 1,000 t/yr, $14/kg at mature ~1,860 t/yr.** Dominant early, trivial late. Also: a $3.8B insured value likely exceeds per-risk market capacity (~$0.9B *total annual premium* market) → expect partial cover + self-insurance priced into capital [Likely].
- *Payload-transit differential:* what matters vs conventional launch is the **rate difference** for an unproven system (say +5–10 points early), and it scales with **payload value per kg**. A $40,000/kg comsat at +6 points = **+$2,400/kg** — prohibitive. Propellant/bulk mass at ~$100s/kg value = **single-digit $/kg** — negligible.
- *Third-party liability:* unpriced; a conversation with a broker, not a table.

**Strategic implication [Likely]: the early market is low-value-per-kg bulk mass** (propellant, water, structure, shielding) because the unproven-system insurance surcharge scales with payload value and vanishes for bulk. This independently re-derives the cislunar-propellant lane the growth option needs — the insurance market and the physics point at the same customer. Anchor-customer list (AC-001) should be re-ranked accordingly.

**3c · Creep vs SF 2.5 — a newly quantified named problem [Likely].** At SF 2.5 the HMPE bulk sections carry a **steady centrifugal load of 28–40% of rated break strength** (40% raw; 28% if the 30% strength derate is applied in sizing). Public guidance: keep sustained HMPE load **≤ ~20%** for multi-year life (SK78 ≈ 8 yr at 20% and 20 °C). The centrifugal load is genuinely sustained in the rotating frame — this is exactly the bad regime. Reaching 20% load needs SF ≈ 5, which cuts Vc by √2 and blows the reference mass ratio from **~41× to order ~800×** (Moravec form) — not a design, a refutation. So the honest outcomes are: (a) HMPE sections have a **creep-governed replacement cadence** costed into ops; (b) the **hybrid boundary shifts toward PBO** (aramid-class creep, 3–5× lower) for the high-stress fraction; or (c) some mix. This goes on the risk register with numbers, feeds the TP-001 creep series, and motivates **ST-002** (below). Per Rule 6, this joins the named hard parts.

**ST-002 (proposed, ~$0 extra):** with the ST-001 line, hang two coupons at ~58 kg (20% of break) and ~116 kg (40%) from a beam, mark gauge points, measure elongation weekly for 4–8 weeks. Toy-scale creep-rate ratio between the two regimes is exactly the datum the design argument needs.

## 4 · The Starship comparator [Planning scenario]

Mature fully-reusable Starship: **$2,000 / $200 / $20 per kg** (cons/base/opt; long-term aspiration $10). None is a purchasable price today. The frontier's cheap-launch world (floor $200) *is* the Starship-baseline world. Consequence already visible on the plane: the reference machine is underwater there; the growth option survives only by selling **destination energy** — the honest comparison is `skyhook price to destination` vs `Starship + N tankers + OTV to destination`, for which **no public $/kg exists** (and Starship's own GTO/GEO/cislunar cost is NO PUBLIC DATA). The kill criterion stands unchanged: cheap launch + expensive leg.

## 5 · Dispositions

1. **Frontier (BF-001)** — annotated with the sourcing footnote, insurance decomposition, and Starship anchor; model values unchanged (nothing was overturned — labels were). Republished 31 Aug.
2. **Risk register (Hudson, xlsx):** update the UHMWPE-creep row: "quantified 31 Aug: steady load 28–40% of break vs ≤20% guidance; SK78 8 yr @ 20%/20 °C; mitigation = replacement cadence, hybrid-boundary shift, or ST-002/TP-001 data." Add row: "unproven-system insurance surcharge scales with payload value — early lanes restricted to bulk cargo."
3. **AC-001:** re-rank anchor customers toward bulk-mass buyers (propellant/cislunar logistics) per §3b.
4. **Vendor asks:** unchanged targets, upgraded form — request **curves, not prices** (payload-vs-handoff-velocity, price-vs-cadence, tonne-scale fiber ladders, insurance structure per element), per the brief's follow-up lists.
5. **Financial model (xlsx):** when next updated, insurance becomes value-scaled (rate × insured $/kg), not a flat $/kg; reboost uses the §3a efficiency ladder.
