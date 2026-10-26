# Sensitivity Findings — Conservative (Rule-4) Case
**Generated overnight 2026-07-02 by `finance/sensitivity.py` (deterministic, seed 20260702), on `finance/skyhook_finance.py` reconciled to the corrected workbook @ commit 2c27b05. All monetary figures $M unless noted.**

---

## The headline

**The conservative case fails the 15-year window by a hair, not by a mile — and cadence is the cheapest fix.**

The Rule-4 base case (2.5 km/s reference, 30% derate, $2,500/kg construction launch, 1 catch/day, $500/kg customer price) pays back in **Y17**, two years outside the window, with **NPV@10% = −$3,883M** over 15 years. But the minimal-relaxation analysis shows the case closes if **any one** of the following holds [Certain, within the model's own assumptions]:

| Input (alone, others conservative) | Conservative value | Closes at | Relaxation required |
|---|---|---|---|
| **Cadence** | 1 catch/day | **≥ 1.10 catches/day** | **+10.4%** |
| **Customer price** | $500/kg | **≥ $550/kg** | **+10.0%** |
| Payload per catch | 5,000 kg | ≥ 5,758 kg | +15.2% |
| Program+fleet capex | $6,000M | ≤ $5,095M | −15.1% |
| Fiber strength derate | 30% | ≤ 21.2% | −8.8 pts |
| Construction launch | $2,500/kg | ≤ $1,674/kg | −33% |
| Hardware mass factor | 1.8× | ≤ 1.21× | −33% (below even the optimistic 1.4× — implausible alone) |
| Fixed annual ops | $80M | **cannot close alone** (would need < $0) |

**The single most controlling input** by tornado span (±30%, NPV@10%) is **program+fleet capex** (span $2,822M), followed by derate ($2,178M), customer price ($2,067M), and cadence ($1,994M). But controlling-by-span is not the same as cheapest-to-fix: capex and derate are engineering outcomes years away, while **cadence and customer price are market/ops assumptions that a single anchor-customer LOI or ops-concept study could move by the required 10% tomorrow.**

**Cheapest path to a closing conservative case:** evidence supporting **1.1+ catches/day** at maturity (a 10% cadence improvement — e.g. 8 catches/week instead of 7), or a **$550/kg** anchor price. Both are exactly the external-evidence items already flagged open (no named customer; cadence is a Part 7.3 planning anchor).

---

## 1. Tornado (±30% each input, others conservative, ranked by NPV@10% span)

| Input | −30% NPV | +30% NPV | Span | −30% payback | +30% payback |
|---|---|---|---|---|---|
| Program+fleet capex | −2,472 | −5,293 | 2,822 | Y14 | Y19 |
| Fiber strength derate | −3,161 | −5,339 | 2,178 | Y15 | Y19 |
| Customer price | −4,916 | −2,849 | 2,067 | Y22 | Y14 |
| Cadence | −4,880 | −2,885 | 1,994 | Y22 | Y14 |
| Construction launch | −3,238 | −4,527 | 1,289 | Y16 | Y18 |
| Hardware mass factor | −3,238 | −4,527 | 1,289 | Y16 | Y18 |
| Payload per catch | −4,235 | −3,530 | 705 | Y21 | Y15 |
| Fixed annual ops | −3,776 | −3,989 | 213 | Y16 | Y17 |

Notes [Certain]: construction launch and hardware factor produce identical spans because they enter the capex chain as a pure product (fiber t × $/kg × factor). Payload's span is muted because it raises revenue and fiber capex together. NPV@10% stays negative across every single ±30% swing — **no single input at ±30% turns the 15-year NPV positive**; the case needs either two coordinated improvements or a longer horizon.

## 2. Minimal relaxation — baseline-value substitutions

Swapping single inputs from conservative to their **baseline-column** values (not optimistic):

- **Singles that close (4):** cadence→2/day (payback **Y11**); construction launch→$1,500/kg (Y15); derate→15% (Y15); program capex→$5,000M (Y15).
- **Pairs:** 14 of 15 tested pairs close. Best pairs: **cadence + derate → Y10**, **cadence + program capex → Y10**, **launch + cadence → Y10**. The only failing pair is hardware factor + fixed ops.
- Customer price and payload are deliberately identical across ladder columns, so they have no "baseline substitution" — their thresholds are in the table above.

Interpretation [Likely]: the conservative case is **not structurally broken** — it sits just outside the window, and any one of four independent assumptions moving to its own baseline value rescues it. The Rule-4 discipline (build the base case only on conservative values) is doing its job: it is telling us precisely which conservative assumptions are load-bearing.

## 3. Monte Carlo (10,000 triangular draws over all eight inputs, seed 20260702)

| Metric | Value |
|---|---|
| NPV@10% P10 | **−$4,441M** |
| NPV@10% P50 | **−$1,916M** |
| NPV@10% P90 | **+$1,780M** |
| **P(payback by Y15)** | **75.2%** |

All distribution ranges are **[Speculative]**, self-set tonight with one-line justifications recorded in `sensitivity.py` (`RANGES_JUSTIFICATION`). Headlines:

- **75% of draws pay back within the window** even though the all-conservative corner does not — consistent with the minimal-relaxation finding that the conservative corner is a near-miss.
- **Median NPV@10% is still negative (−$1.9B).** Undiscounted payback-by-Y15 and 10%-discounted NPV are answering different questions: the program typically returns its capital within 15 years but does not typically clear a 10% hurdle rate in that window. Infrastructure-style capital (Part 7.6) with longer horizons or lower hurdle rates is the implied financing fit — at 8% the conservative-case NPV is −$3,617M over 15y and improves with every year of horizon extension.
- P10–P90 spans ~$6.2B: the model is dominated by a handful of unvalidated commercial inputs, exactly matching the tornado ranking.

## Caveats and honesty

1. Ranges in §3 are [Speculative] — no vendor fiber quote, no launch quote, no named customer. The MC quantifies the *shape* of uncertainty, not validated risk.
2. The cash-flow schedule (capex Y1–4 at 15/30/35/20%, ops from Y5, ramp 0.3→0.6→1.0) is inherited from the workbook and untested against any real program plan [Likely at best].
3. NPV uses end-of-year discounting over the 15-year window only; terminal value is deliberately excluded (a real toll-bridge asset has one — this understates the true economics, conservatively).
4. The prior "2.5 km/s pays back Y14 at $800/kg" claim is reproduced by the model as a labeled variant (conservative-except-launch@$800: capex $6,877M, payback Y14) — it was a real computation, but of a mixed case, not the conservative case. See `docs/DECISION_LOG.md` item 7.
