# Spin Wobble
> The gravity-gradient wobble in Skyhook's tip speed, derived instead of observed: at Rev A the tip slows 3.41 % (85.2 m/s) from vertical to horizontal, its rotation mean sits 1.71 % low, and a tip is back at the bottom every 952.5 s, not every 804 s; the closed form reproduces the twin's golden-run mean tip speed to 0.0044 %.

**Kind:** study
**For:** Skyhook
**Run:** open `ideas/16-spin-wobble/index.html` in a browser (classic scripts, works from `file://`, no network, no build). The study against Skyhook's twin: `node ideas/16-spin-wobble/study.mjs` (add `--sweeps` for the stiffness and node-count reruns, `--write` to re-record the overlay the page plots; `--help`; exits 1 if a gate fails; saved output in `example.txt`). Tests, from the bank root: `node --test ideas/16-spin-wobble/wobble.test.mjs` (19 tests, Node built-ins, about 6 s), `python3 -m unittest discover -s ideas/16-spin-wobble -p 'test_*.py'` (7 tests, under 1 s) and `node ideas/16-spin-wobble/ui-check.mjs` (92 checks in headless Chromium with the globally installed Playwright; `check.mjs` runs it for `tools/check.mjs`). `node ideas/16-spin-wobble/build-data.mjs --check` confirms the data wrapper is current.
**Made by:** Nutation

## What it is

A spinning tether in orbit does not keep a steady tip speed. The orbit's gravity gradient pulls the tether toward the local vertical, so it brakes the spin as the tether swings toward horizontal and hands the speed back as it comes vertical again. Skyhook's glossary records this as an observation from its lumped-mass model, "~±3 %" and "~1.5-2 %", labelled [Likely] (`docs/glossary.md:23-24`). This deposit derives it in closed form from `params/rev_a.json`, and then holds the closed form against Skyhook's own 17-node twin, run from a byte-identical snapshot.

Three surfaces:

- **The page** (`index.html`). Pick a tier from the canon (2.5, 2.8 or 3.5 km/s), a half-length, the angle at which the spin is set (0° = tether vertical, where catch and release happen; 90° = horizontal) and the centre-of-mass radius convention. It shows:
  - the tip speed at the vertical and at the horizontal, the rotation mean, and the time from one vertical to the next, with what it would be without the gradient;
  - tip speed through one turn, with the recorded twin run drawn over it at the canon settings;
  - the twin minus the closed form over just over two turns, with the vertical times, periapsis times, the twin's port gate and a rigid-body check;
  - the dip against half-length: exact, first order, and the form the model's docstring states;
  - the three tiers side by side;
  - **What the program says, checked**: the four sentences in the repository about this effect, quoted verbatim from the snapshots with file and line, each with a computed verdict, plus `golden.json`'s mean tip speed reproduced;
  - structured refusals instead of numbers when the canon snapshot is missing, when the twin recording is missing (chart B only), or when the inputs leave the closed form's envelope (tip below the ground, spin no faster than the orbit, too slow to go over the top).
- **The study** (`study.mjs`). It runs `snapshots/twin-physics.mjs`, Skyhook's `tools/twin/physics.js` copied byte for byte. It checks the port against `golden.json` with `verify.mjs`'s own tolerances, reproduces the golden run's 600 s means with the closed form, and overlays two turns. It also runs a rigid line body built from the twin's own masses under exact point-mass gravity, and (with `--sweeps`) the twin 50× stiffer and at 33 nodes. Its output is `example.txt`; `--write` records `snapshots/twin-overlay.js` for the page.
- **A landing sketch** (`gg_modulation.py`, standard-library Python, with `test_gg_modulation.py`). This is the same closed form written the way it would sit beside EQ-1 to EQ-6 in `physics/skyhook_physics.py`.

## Why I made it

**The open item.** The effect is in the record five times, always as an observation and never derived:

- `docs/glossary.md:24` labels it "[Likely — observed in the lumped-mass model, V1/V2 development, 2026-07-02.]". It draws a design rule from it: "implies nominal spin rate must be set slightly above the target release speed".
- `tests/test_tether_dynamics.py:51-56` (V1 docstring) logs it as a development observation for the morning report.
- `MORNING_REPORT.md:38` lists it as a "[Likely] **New physical finding**". `MORNING_REPORT.md:55` puts "the tip-speed depression finding" on the prioritised review list: "treat as first estimates, not design numbers".
- `physics/tether_dynamics.py:259-264` states a size, "of order 1.5*n^2/omega^2 ~ 3%", without derivation and labels it [Certain]. `:353` says "~4%".
- `tools/twin/twin.js:384-387` repeats the glossary numbers under a [Certain] label.

The glossary also calls it "directly relevant to release-timing and injection accuracy". The founding document spins the tether up "over weeks" (`docs/project_instructions.md:137`), so the angle at which the spin is trimmed is a real operating choice. Nobody has said which way it pushes. A closed form settles the size, the sign and the period. A twin that already exists in the repository is the natural oracle.

**Alternatives weighed.**

- *Re-run the Python model and tabulate.* pytest is not installed here, and the JS port is validated against it (`tools/twin/verify.mjs`). More numbers from the same model would still not explain why it does what it does, and could not check the docstring's formula.
- *A higher-order perturbation series in n/ω.* Unnecessary: the first integral is exact for a rigid body, and the rotation mean has an exact closed form (Gauss's arithmetic-geometric mean). A series would add an approximation where none is needed.
- *A flexible-body model with damping, J2 and an eccentric orbit.* This is the right tool for the residual the twin shows, but every damping and stiffness input would be invented (the twin's own hub mass and modulus are [Speculative]/[Likely] in `tether_dynamics.py:75-79`). Under the house rule, a kernel that must invent its inputs does not ship.
- *A page that only plots the twin.* That would show the wobble without explaining it, and it could not say which way the spin-trim rule goes.
- *This.* A one-line closed form whose every input is a canon key, checked three independent ways: a numerical integration sharing no code with it, a rigid body under exact gravity, and the program's own twin and golden file. The page then turns those sentences, and `golden.json`'s own number, into computed verdicts.

**What I changed from the judged proposal, and why.** The proposal (`S1-05`) had the right equation and the right oracle. Several of its numbers did not survive checking:

- **The headline formula was the docstring's, and it is wrong for the quantity the twin measures.** The proposal wrote ω(θ)² = ω₀² − 3n² sin²θ with ω₀ = v_tip/L, and got a peak of 1.5n²/ω² = 2.88 % (72 m/s). The first integral holds for the spin *relative to the orbiting frame*, θ′ = ω − n. The twin measures tip speed relative to the centre of mass in *inertial* space, L(n + θ′). The correct first order is 1.5n²/(ω(ω − n)) = 3.34 %, and the exact dip is 3.41 % (85.2 m/s). The twin decides it: its first trough is 3.38 % below its start, and a test fails if the trough is within 0.4 % of the docstring form.
- **Per-tier figures**: 2.88 / 2.30 / 1.47 % became **3.41 / 2.66 / 1.65 %**. A test pins both rows, to show that the proposal's row is the docstring form.
- **The mean depression** was 0.75n²/ω² = 1.44 % "by quadrature". It is **1.714 %**, in closed form: L(n + AGM(θ′_max, θ′_min)). A horizontal spin-up raises the mean by **1.632 %**, not by "the same magnitude".
- **The golden reconciliation was mis-framed.** The proposal compared an "analytic mean 2,464" with `golden.json`'s 2,462.6 and put the gap down to elasticity. But `golden.json`'s mean covers 600 s from the vertical, which is 1.26 modulation periods, not a rotation. Integrated over the same window at the same step and averaged the same way, the closed form gives **2,462.533 m/s against 2,462.641 m/s: 0.108 m/s, 4.4×10⁻⁵**.
- **"Modulation scales as L² within 1 % between 160 and 320 km"** is false. Doubling L multiplies the dip by **4.39** (first order 4.32), because the dip goes as L²/(1 − nL/v). A test pins it.
- **"Residual from elastic and discretisation effects"** is mostly wrong. A twin 50× stiffer axially keeps the gap (7.47 vs 7.32 m/s). Going to 33 nodes shrinks it by 8 %. A rigid body with the twin's own masses under exact gravity stays within 0.074 m/s of the closed form. What remains is (I think) the chain bending sideways.
- **The overlay is on the page, not a static figure.** The study records the twin run as data (`snapshots/twin-overlay.js`, with a sidecar), and a test regenerates it and compares. The page plots it only at the canon settings and says so elsewhere.
- **Added:** the time between verticals (476.3 s) and between bottoms (952.5 s), checked against the twin and against `VISUAL_QA.md`'s "~804s"; the rigid-body check; the libration, retrograde and below-ground refusals; the Python landing sketch.

## How it works

**Inputs (all from `snapshots/`, Skyhook at `34935cb`).**

- μ = `orbital.mu_earth_m3s2` = 3.986×10¹⁴ m³/s².
- CoM altitude `orbital.com_altitude_km` = 610 km.
- Half-length `geometry.tether_half_length_km` = 320 km.
- Tip speeds `kinematics.v_tip_kms` = 2.5, `kinematics.cislunar_revenue_gated_option.v_tip_kms` = 2.8 and `kinematics.phase3_growth_option.v_tip_kms` = 3.5 km/s.
- The Earth radius is `R_EARTH_KM = 6371.0` from the twin (`tools/twin/physics.js:21`, mirroring `physics/skyhook_physics.py:40`), so R = 6981 km. That is the radius the twin and the golden run use, so it is the default. The file's own `orbital.com_radius_km` = 6988 is the alternative on the page. It moves the dip from 3.410 % to 3.399 %, so nothing here depends on which is right (the BRIEFING's two-radii note; idea 01's finding).
- `build-data.mjs` wraps all of this as `snapshots/canon.data.js`, together with the four claims quoted verbatim with their line numbers, and `golden.json`'s means and checkpoint speeds. A test re-derives it byte for byte. `index.html` and `app.js` carry no tether constant as literal text (a test greps for 19).

**The model [Certain for a rigid line body on a circular orbit, to quadrupole order].**

- Take a straight rigid tether, with any mass distribution along it (hub and payloads included). It spins in the orbit plane. θ is its angle from the local vertical, measured in the frame that turns with the orbit at n = √(μ/R³) = 1.082411×10⁻³ rad/s.
- The gravity-gradient torque gives the standard pitch equation θ″ = −3n² sin θ cos θ. Its first integral is θ′² + 3n² sin²θ = C. For a body along a line, the moment of inertia cancels, so the mass distribution does not enter.
- The tip's speed relative to the centre of mass is **v(θ) = L(n + θ′)**: the spin relative to the orbiting frame plus the frame's own turn. This is what the twin's `tipSpeedRelCom()` measures, and what EQ-3 adds to v_orb.
- Spun up (or trimmed) to tip speed v₀ at angle θ₀: θ′(θ₀) = v₀/L − n and C = (v₀/L − n)² + 3n² sin²θ₀.
- Hence θ′_max = √C at the vertical and θ′_min = √(C − 3n²) at the horizontal.
- The tether goes over the top only if C > 3n². For a vertical spin-up that means v₀ > nL(1 + √3) = 946 m/s at Rev A geometry. Below that it librates, and the kernel refuses. It also refuses v₀ ≤ nL = 346 m/s (no prograde rotation in the orbiting frame).

**The rotation mean, exactly.** Time from vertical to vertical is T½ = ∫₀^π dθ/θ′ = 2K(k)/√C, a complete elliptic integral of the first kind with k² = 3n²/C. Gauss's identity K(k) = π/(2·AGM(1, √(1 − k²))) turns the time-mean of θ′ over a modulation period into **AGM(θ′_max, θ′_min)**. So the rotation-mean tip speed is L(n + AGM(θ′_max, θ′_min)) and T½ = π/AGM(θ′_max, θ′_min). Tests check this against a 40,000-point midpoint quadrature (to 10⁻¹⁰) and against an RK4 integration (to 10⁻⁶ m/s), and check the AGM against Gauss's constant.

**Rev A numbers** (reference tier, L = 320 km, R = 6981 km, spin set at the vertical). n/ω = 0.13855 and n²/ω² = 1.920 %; `MORNING_REPORT.md:38` says "≈ 1.9%".

| Quantity | Value | From |
|---|---|---|
| Tip speed at the vertical | 2,500.0 m/s | the set value: the spin was set there |
| Tip speed at the horizontal | 2,414.75 m/s | L(n + √(C − 3n²)) |
| Dip, vertical to horizontal | **3.410 %** = 85.25 m/s | exact |
| First order, 1.5n²/(ω(ω − n)) | 3.342 % | expansion in n/ω |
| The docstring's 1.5n²/ω² | 2.879 % | `tether_dynamics.py:260-261`, 16 % low |
| Rotation mean (time average) | **2,457.16 m/s, −1.714 %** | AGM closed form |
| About the mean | +1.74 % / −1.73 % | so "±1.7 %", not "±3 %" |
| Vertical to vertical | **476.27 s** | π/AGM |
| Same, with no gradient | 466.80 s | π/(ω − n) |
| A tip back at the bottom | **952.54 s = 15.88 min** | 2T½ |
| Inertial rotation period | 804.25 s = 13.40 min | 2πL/v = `rotation_period_min` 13.4 |

Tiers at L = 320 km: the dip is 3.410 / 2.660 / 1.645 % (85.2 / 74.5 / 57.6 m/s), the mean −1.714 / −1.335 / −0.825 %, and vertical to vertical 476.27 / 416.06 / 321.72 s.

**Which way the spin trim goes.** Release (EQ-3: v_orb + v_tip at the upper tip) and catch (v_orb − v_tip at the lower tip) both happen with the tether vertical. There θ′ is at its *maximum*, whatever the spin-up angle, because sin θ = 0. So:

- A spin set at the vertical releases at exactly the set value. The canon's 2.5 km/s is self-consistent read that way, and EQ-3 needs no correction.
- A "nominal" quoted as the rotation mean has to be set 1.71 % *below* the target release speed. One set at the horizontal has to be set 3.41 % below.
- Set 2,500 m/s at the horizontal and the tether releases at 2,582.0 m/s (+3.28 %), with a mean 1.63 % above the set value.

The glossary's "set slightly above the target release speed" therefore has the sign reversed in every reading. The vertical is also a stationary point: a timing error Δt costs L·3n² sin²(θ′Δt)/(2θ′), which is 0.38 m/s at 10 s and 3.4 m/s at 30 s for the rigid tether.

**Reconciliation with `golden.json`.** The page and the tests integrate θ″ = −3n² sin θ cos θ by RK4 from the golden start (vertical, 2,500 m/s), for `golden.meta.duration_s` = 600 s at `golden.meta.dt` = 1/60 s. They sample the speed after each step and divide by the step count, as `scripts/generate_golden.py` and `verify.mjs` do.

| | closed form | golden | gap |
|---|---|---|---|
| mean tip speed | 2,462.533 m/s | 2,462.641 m/s | 0.108 m/s (4.4×10⁻⁵) |
| mean centripetal, v²/L | 18.95294 m/s² | 18.95569 m/s² | 1.45×10⁻⁴ |
| tip speed at 60 s | 2,487.110 m/s | 2,486.112 m/s | −0.999 m/s |
| tip speed at 300 s | 2,427.950 m/s | 2,430.513 m/s | +2.564 m/s |
| tip speed at 600 s | 2,454.329 m/s | 2,458.171 m/s | +3.843 m/s |

The window mean (−1.49 %) is not the rotation mean (−1.71 %), because 600 s is 1.26 modulation periods.

**Against the twin (`study.mjs`; numbers from `example.txt`).**

- **The port gate.** The snapshot twin lands on `golden.json`'s checkpoints within 1.6×10⁻¹⁰, and its mean tip speed within 1.6×10⁻¹⁰. `verify.mjs:32-35` allows 10⁻³ and 10⁻². So the oracle is the validated port, unchanged.
- **The overlay.** The run goes 1,920 s from the golden start. The tether's angle is the lower-tip-to-upper-tip chord, from the local vertical through the CoM.
  - The largest gap between the twin and the closed form at the same angle is **7.32 m/s, 8.6 % of the 85.25 m/s swing**. The mean gap is +0.64 m/s.
  - The twin crosses the vertical at 476.15 / 952.30 / 1428.45 / 1904.63 s, against the closed form's 476.27 / 952.54 / 1428.82 / 1905.09 s. Without the gradient the crossings would come 9.5 s earlier per half-turn.
  - Its tip speed at those verticals is 2,498.7 / 2,499.9 / 2,499.9 / 2,501.2 m/s.
  - Its lower tip reaches periapsis (detected the way `twin.js:307-318` detects it) at **952.02 s and 1904.72 s**.
- **What the gap is not.** A rigid line body with the twin's 17 lump masses (I/(ML²) = 0.114), integrated under exact point-mass gravity with the orbit free to respond, stays within **0.074 m/s** of the closed form. So neither the quadrupole truncation nor the circular-orbit assumption matters at this level. A uniform rod and a 5 t payload on one tip stay within 10⁻⁴ of v₀ too.
- **What the gap probably is.** A twin 50× stiffer axially (target strain 10⁻⁴) has a gap of 7.47 m/s; at 33 nodes it is 6.73 m/s. The chain bends by up to 0.28° (tips seen from the CoM) at 17 nodes and 0.25° at 33. My reading is that the twin's undamped lateral string motion, excited by its straight-line start, carries the tip a few m/s off the rigid curve [Likely].

**The page.**

- Inline SVG, redrawn at the element's pixel width.
- Blue for the closed form, orange for the twin, aqua for the first-order line, neutral dashed for the docstring's form and the rotation mean. These are the dataviz reference palette's first three slots, run through its validator in both modes: all pairs pass, and aqua is under 3:1 on the light surface, so it is direct-labelled and in the table.
- Each chart has a crosshair readout on hover, tap, or focus with the arrow keys (Shift for steps of 10, Escape to hide).
- The claim verdicts are computed at the canon whatever the controls say.
- Text is set with `textContent` throughout.

## Tests

**`wobble.test.mjs` (19 tests, about 6 s).** What they pin, and to what outside this code:

- **Snapshots.** Every file under `snapshots/` hashes to its sidecar's `writtenSha256`. Copies equal their source hash. Sidecars carry the 40-hex commit and `readMatchesCommitted: true`. `canon.data.js` re-derives byte for byte, and its four quotes are verbatim at the cited lines (glossary 24; tether_dynamics 259-264 and 353-354; VISUAL_QA 37-39). `twin-overlay.js` matches a fresh `study.mjs` run.
- **Canon and refusals.**
  - The tier ladder and both radii are read from `rev_a.json`. Removing any of four keys gives `not_found`, with a reason that names the key and carries no numbers.
  - `NaN`, `Infinity`, strings, `null` and `undefined` in each input give `out_of_envelope`, as do zero and negative values.
  - At L = 610 km the tip is below the ground, so the kernel refuses; 609 km is accepted.
  - A spin slower than the orbit is refused. The libration boundary nL(1 + √3) is refused 0.1 % below and accepted 0.1 % above, and accepted at the same speed for a horizontal spin-up.
- **The closed form, three independent ways.**
  - The AGM gives Gauss's constant to 10⁻¹⁵, and agrees with a midpoint quadrature of dθ/θ′ to 10⁻¹⁰ (four cases).
  - An RK4 integration lands on the extremes to 10⁻⁶ m/s, on the vertical times to 10⁻⁴ s and on the one-period mean to 10⁻⁶ m/s, and conserves the first integral to 10⁻¹² (three cases including 45° and 90° spin-ups).
  - A rigid line body under exact gravity follows it within 10⁻⁴ of v₀, for the twin's masses, a uniform rod, and a payload on one tip.
- **Limits.** μ → 0 gives no dip and a mean of v₀. At L = 1 km and 0.1 km the first-order forms are within 2n/ω. At Rev A, exact ÷ docstring form = 1.184, and first order = docstring form ÷ (1 − n/ω) exactly.
- **The numbers the README and page quote.** Every Rev A row of the table above, the horizontal spin-up (2,582.00, +1.632 %, 458.12 s), and the three-tier rows. The proposal's 2.88 / 2.30 / 1.47 % row is pinned as the docstring form. `rotation_period_min` 13.4 is reproduced as the inertial period, and the bottom-to-bottom time exceeds it by more than 2.4 min. The L = 160 → 320 km ratio is 4.39, more than 0.25 from 4. The 6988 km radius gives a dip of 3.399 %.
- **Against the twin and `golden.json`.**
  - The port gate passes at better than 10⁻⁸.
  - The golden mean is reproduced within 10⁻⁴ (pinned at 0.108 m/s), the centripetal mean within 2×10⁻⁴, and the three checkpoints within 0.2 %. The golden start is the vertical value.
  - The overlay gap is under 10 % of the swing (pinned at 8.6 %), and the twin's first trough is within 0.1 % of the closed form and more than 0.4 % from the docstring form.
  - The verticals fall within 0.6 s of k·T½ and more than 9k s from the no-gradient times.
  - The periapsis times fall within 0.6 s of 2k·T½ and more than 140 s from k·804 s. The first one is within 1 s of the 952 s `VISUAL_QA.md` reports, and the quote contains "~804s" and "t~952-1200s".
  - The rigid body's gap is pinned at 0.074 m/s.
  - 50× stiffness changes the gap by under 5 %, and 33 nodes shrink it by under 10 %.
- **The page.** No tether constant appears as literal text (19 strings), the page loads only the four local scripts, it has the viewport meta, and it makes no request.

**Teeth.** Each sabotage was applied to a scratch copy of the folder and the 19 tests run:

| Sabotage | Tests failing |
|---|---|
| S1 forget the orbiting frame at spin-up (θ′₀ = ω, not ω − n) | 12 |
| S4 torque coefficient 2 instead of 3 at the horizontal | 11 |
| S5 twin radius taken as `com_radius_km` 6988 | 8 |
| S7 half-period 2π/mean rate instead of π/mean rate | 6 |
| S3 arithmetic mean in place of the AGM | 4 |
| S8 tip speed L·θ′ (frame rate dropped) | 4 |
| S10 a 0.05 rad error in the twin's tether angle (`study.mjs`) | 3 |
| S2 gradient sign flipped in the RK4 check | 2 |
| S6 rigid-body torque sign flipped | 2 |
| S9 libration refusal disabled | 1 |

**`test_gg_modulation.py` (7 tests, unittest).** Gauss's constant. The Rev A numbers to the README's precision. The half-period against a 20,000-point quadrature. `rotation_period_min` 13.4. The horizontal spin-up (2,582.00 m/s, mean above). Refusals for 0.3 km/s (not prograde), 0.9 km/s (librates) and NaN. The golden 600 s mean within 10⁻⁴, by the module's own RK4. Sabotage on a copy: θ′₀ = ω fails 4; arithmetic mean for AGM fails 2; dropping n from the integration's start fails 1.

**`ui-check.mjs` (92 checks, headless Chromium).**

- At desktop size in light mode:
  - The four tiles equal the kernel's values.
  - The twin overlay, the closed form and the residual are drawn.
  - There are five claim rows, three marked wrong, every quote verbatim, and the docstring row quotes both dips.
  - The golden-window mean shown is the kernel's.
  - Keyboard focus on a chart shows a readout, ArrowRight moves it to 91° with the kernel's value and both twin turns, and Escape hides it.
- At desktop size in dark mode:
  - Half-length 400 km matches the kernel, the overlay disappears with a reason, and the state note names the change.
  - A 90° spin-up, the Phase 3 tier and the file radius each match the kernel.
  - At L = 620 km the page refuses (`out_of_envelope`, "below the ground", what would help), shows no results, and keeps the claims.
  - *Back to the canon* restores everything.
- At phone size in dark mode, by touch: no horizontal overflow, a tap shows the readout, a tap moves the slider and its output, and tile text contrast is above 7:1.
- With `canon.data.js` blocked: a `not_found` refusal naming the file, no controls, and no speed anywhere on the page.
- With `twin-overlay.js` blocked: chart B refuses, there is no overlay, and the closed form is still shown.
- No console errors in any of these.

`node tools/check.mjs ideas/16-spin-wobble` passes: README format, size, snapshot sidecars, all three test files, `check.mjs`, and the smoke test at 1280 and 390 px.

## Honest assessment

What works:

- [Certain] The closed form is exact for its model: a rigid line body on a circular orbit under the quadrupole gravity gradient. Three computations that share no code with it agree: quadrature, RK4, and a rigid body under exact point-mass gravity with the orbit free. The last agrees to 0.074 m/s over 1,920 s with the twin's own masses, so the quadrupole truncation and the circular-orbit assumption cost less than 0.1 m/s at Rev A geometry.
- [Certain] The docstring's 1.5n²/ω² understates the inertial-frame dip by the factor 1/(1 − n/ω) = 1.16 at Rev A. The exact dip is 3.41 %, and the twin's own four troughs are 3.21 % to 3.53 % below its start (3.38 % for the first; 5 s samples).
- [Certain] `golden.json`'s 600 s mean tip speed is reproduced by the closed form to 4.4×10⁻⁵, with the golden run's own window, step and averaging.
- [Certain] Release and catch happen at the vertical, where the rigid tip speed is at its maximum. A spin set at the vertical needs no offset, and any other nominal must be set below the target, never above. [Likely] that operations would actually release at the vertical: EQ-3 assumes it, but a real release point is a mission choice.
- [Certain for the rigid tether, [Likely] for the real one] A tip is back at the bottom every 952.5 s (15.88 min), not every 13.4 min. The twin agrees to 0.5 s. With no gradient it would be 933.6 s, so the gradient alone moves catch opportunities by 19 s per turn, more than the glossary's "few seconds to tens of seconds" catch window.

What is rough:

- [Likely] The attribution of the 7.3 m/s twin residual to lateral bending of the chain rests on elimination (rigidity, axial stiffness and node count each ruled out or shown small) and a measured bend of 0.28°. I did not model the string modes or show the residual's frequency content.
- [Certain] The model is planar, unloaded and undamped, on a circular Keplerian orbit. There is no J2, no eccentricity, no payload at catch (a catch changes the spin, and with it C), no out-of-plane motion, no atmosphere on the lower tip, and no ED reboost torque.
- [Certain] "Spin set at angle θ₀" idealises a spin-up that takes weeks (`project_instructions.md:137`). It means the angle at which the spin is trimmed or measured.
- [Speculative] Whether 19 s per turn matters operationally depends on how catch timing is planned. Any planner that propagates the real dynamics already has it; one that uses 2πL/v or the synodic period does not.
- [Certain] The twin overlay on the page is a recording. If `tools/twin/physics.js` changes, the page is stale until `study.mjs --write` and the sidecar are re-run. A test catches staleness against the snapshot, not against the live repository.
- The two citations for standard results (the pitch equation and Gauss's AGM form of K) are from memory of standard references, not opened here. The tests check both identities numerically, so no number depends on the citation.

**Findings about the source repo** (Skyhook at `34935cb`; reported here, not fixed there):

1. `physics/tether_dynamics.py:259-261`: "fractional tip-speed modulation of order 1.5*n^2/omega^2 ~ 3%". For the inertial tip speed the twin and EQ-3 use, the first order is 1.5n²/(ω(ω − n)) = 3.34 % and the exact value is 3.41 %. The stated form gives 2.88 %, 16 % low.
2. `physics/tether_dynamics.py:262-264`: "The rotation-average is the quantity that matches v_tip and v_tip^2/L; averaging over an integer number of rotations cancels the periodic exchange." It does not. The rotation mean is 1.71 % below v_tip for a vertical spin-up, because the exchange is one-sided. The modulation repeats every 476.3 s (vertical to vertical), so whole 804 s rotations are not whole periods. `run_measuring` itself is fine, and V1 runs with gravity off, so no committed test depends on the claim.
3. `physics/tether_dynamics.py:353`: "Gravity-gradient modulation (~4% at this geometry)". It is 3.41 %, which also disagrees with the same file's "~3%" at line 261.
4. `docs/glossary.md:24`:
   - "~±3%" is one-sided: 0 to −3.41 % from the vertical value, or ±1.7 % about the mean.
   - "~1.5-2%" holds (1.71 %) only for a spin set at the vertical; set at the horizontal, the mean is 1.63 % *above*.
   - "implies nominal spin rate must be set slightly above the target release speed" has the sign reversed.
   - The [Likely — observed] label can become derived: [Certain] for the rigid first order, [Likely] for the twin residual.
5. `tools/twin/VISUAL_QA.md:37`: "periapsis recurs roughly once per ~804s rotation period". It recurs every 952.5 s (twin 952.0 s). The note's own "first catch at t~952-1200s" (line 38-39) fits the closed form, not 804 s.
6. `tools/twin/twin.js:384-387` labels the modulation "[Certain]" while citing the glossary's [Likely] entry, and repeats "~+/-3%". The same wording is in `tests/test_tether_dynamics.py:51-56` and `MORNING_REPORT.md:38`, whose "n²/ω² ≈ 1.9%" is right (1.920 %).
7. `tools/twin/golden.json` `mean_tip_speed_mps` (2,462.64) is a 600 s window mean, 1.26 modulation periods long. Anyone reading it as the rotation mean is 0.22 % off. The rotation mean is 2,457.16 m/s.

A note for this bank, not the source repo: `ideas/09-two-seconds-at-bottom/README.md` ("What the rigid rotor ignores, quantified") quotes the rigid-dumbbell estimate as 3Ω²/(2ω²) = 2.9 %. It also reads golden's 600 s mean as the rotation mean, so it takes the tip at the bottom to be ~2,538 m/s if v_tip were the mean. The closed form gives 3.41 % and 2,543.6 m/s. Idea 09's conclusion (the canon's v_tip is the bottom-of-swing value) is unchanged.

**Gates this has not passed.** Skyhook's Rule 1 canon review: it reads `rev_a.json` but is not part of it, and it does not settle the two-radius question. No verification memo (VM) has checked the derivation. Skyhook's pytest suite: `test_gg_modulation.py` is unittest, run here, not in `tests/`. The multi-body flexible-dynamics model the founding document makes the authority for operations (`project_instructions.md:138`). This is an idea-bank prototype.

## Where it would land

- **`physics/skyhook_physics.py`**: a `gravity_gradient_modulation(v_tip_kms, L_km, spinup_phase_deg=0)` beside EQ-6. `gg_modulation.py` is the body, written to drop in. To ship: import `MU_EARTH`, `R_EARTH_KM` and `PARAMS` instead of taking them as arguments (Rule 1). Decide which CoM radius the canon means. Port `test_gg_modulation.py` to pytest under `tests/`, keeping the `golden.json` window reconciliation as the tooth.
- **`docs/glossary.md:23-24`**: replace the entry with the derived form. Dip 3.41 % from vertical to horizontal at Rev A, [Certain] for a rigid tether. Rotation mean −1.71 % for a spin set at the vertical. A tip at the bottom every 15.88 min. No spin offset needed if v_tip is specified at the vertical. Cite the function.
- **`docs/DECISION_LOG.md`**: one item recording that `v_tip` in `rev_a.json` means the tip speed at the vertical, where release and catch happen, and that the "set slightly above" rule is withdrawn.
- **`physics/tether_dynamics.py:259-264` and `:353`, `tools/twin/twin.js:384-387`, `tools/twin/VISUAL_QA.md:37`**: correct the docstrings, comment and QA note (findings 1, 2, 3, 5, 6).
- **`tools/twin/`**: the page's "against the twin" chart could become a twin HUD line (tip speed against the closed form at the current angle), since the twin already computes everything it needs.

## Sources

- The planar pitch-libration equation of a rigid body in a circular orbit, θ″ + 3n² sin θ cos θ = 0 for a body along a line: standard gravity-gradient attitude dynamics, e.g. P. C. Hughes, *Spacecraft Attitude Dynamics* (Wiley, 1986). From memory of the standard result, not opened here; the tests confirm it against exact point-mass gravity.
- Gauss's arithmetic-geometric mean and K(k) = π/(2·AGM(1, √(1 − k²))): NIST Digital Library of Mathematical Functions §19.8(i). From memory, not opened here; the tests confirm it against quadrature and Gauss's constant.
- H. Moravec, "A Non-Synchronous Orbital Skyhook", *Journal of the Astronautical Sciences* 25(4), 1977: the rotovator concept the program cites. Context only; no number here comes from it.
