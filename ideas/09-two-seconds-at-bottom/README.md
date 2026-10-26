# Two Seconds at the Bottom
> At the bottom of its swing the Rev A tether's lower tip pulls away from a vehicle matched to it at 20.34 m/s² (2.07 g), or 21.00 m/s² if the canon's 2.5 km/s is the rotation mean rather than the speed at the vertical. So a passive vehicle stays inside ±10 m for under 2 s and inside ±1 m/s for 0.1 s, and holding the founding document's 3–10 s costs 61–210 m/s of Δv. All of it is computed from `params/rev_a.json` alone.

**Kind:** explorable
**For:** Skyhook
**Run:** open `ideas/09-two-seconds-at-bottom/index.html` in a browser (classic scripts, works from `file://`, no network, no build). Tests, from the bank root: `node --test ideas/09-two-seconds-at-bottom/catchwindow.test.mjs` (25 tests, Node built-ins, about 0.5 s) and `node ideas/09-two-seconds-at-bottom/ui-check.mjs` (91 checks in headless Chromium with the globally installed Playwright; `check.mjs` runs it for `tools/check.mjs`). `node ideas/09-two-seconds-at-bottom/build-data.mjs --check` confirms the data wrapper is current.
**Made by:** Plumbline

## What it is

Skyhook's founding document asks the catch to hold "relative position within meters and relative velocity within ~1 m/s at the moment of capture, sustained through a window of 3–10 seconds" (`docs/project_instructions.md:124`, §4.3). Its glossary says the window's duration is "set by tether length, tip speed, and the vehicle's trajectory accuracy" (`docs/glossary.md:11-12`). The program site's Monte Carlo takes the window as a slider (`tools/sims/skyhook_program_site.html:1336`). Nothing in the repository computes it. This page does, from the tether's own kinematics, and prices what it costs to make the window longer.

You pick a tier from the Rev A canon (2.5 km/s reference, 2.8 km/s cislunar option, 3.5 km/s Phase 3) and a half-length (canon 320 km, movable). You also set a capture envelope (±10 m by default), a velocity tolerance (±1 m/s by default) and a held window (3 or 10 s at a tap). The page returns:

- the **relative acceleration** between the lower tip and a ballistic vehicle matched to it at the bottom of the swing, a_rel = v_tip²/L − μ/R² + μ/(R−L)², and the tip's own inertial acceleration;
- the **passive windows**: how long the vehicle stays inside the envelope (±√(2e/a_rel)) and inside the velocity tolerance (±v_tol/a_rel), which of the two binds, and the speed at which it leaves the envelope. It also gives the best any passive trajectory can do, which is to graze the far edge: 4√(e/a_rel), arriving at 2√(a_rel e);
- what the 3 s and 10 s requirements would **need passively** (envelope ±a_rel(T/2)²/2, edge speed a_rel T/2) and what they **cost held**. Holding means thrust at a_rel for the whole window, Δv = a_rel T, shown as a share of the catch speed and as the equivalent if a reel at the tip pays instead. The page also says what §5.2(d)'s "tens of meters wide" envelope would allow on position alone;
- **which speed v_tip is**: the gravity gradient makes the tip fastest at the vertical, so the canon's 2.5 km/s can mean the speed at the catch or the rotation mean. The repository says both. The page gives a_rel under each reading, for any tier and half-length, from a libration model that reproduces the twin's golden run;
- a sketch of the bottom of the swing in the centre-of-mass frame, a two-panel timeline of separation and relative speed with the envelope and tolerance as bands, the passive window against half-length with the §4.3 line drawn, and a tier table. A provenance table names the key or equation behind every number, and a card compares three Earth-relative speeds that the parameter sheet does not tell apart;
- structured refusals, never a placeholder. The page refuses a missing canon, a non-positive input, a typed value outside the input boxes' ranges, a half-length below 1 km or with the tip at or below the ground, and any window longer than 4 % of a rotation, where the closed forms stop holding. A tip below 150 km is computed and flagged, because a vehicle there is not ballistic.

## Why I made it

- **The open item.** `docs/project_instructions.md:48` (§2.2) requires every design iteration's parameter sheet to carry "rendezvous window duration"; `params/rev_a.json` has no such field (grep `window` finds nothing). `docs/glossary.md:11-12` names what sets the window but gives no formula or number. The site's glossary (`skyhook_program_site.html:1434-1435`) defines the catch window as "The 3–10 second interval", which restates the requirement as a definition. §5.2 (b) and (d) (`:167`) say "the launch vehicle does all the matching" with "margin propellant" and that the envelope is "engineered to be tens of meters wide with multi-second windows by shaping tip trajectory and using the smart grapple's own terminal maneuvering"; neither is quantified. The Monte Carlo (`:1318-1400`) scatters errors against a window literal (`mc-w`, `:1336`, default ±3 s), and FAQ Q2 (`docs/objections_faq.md:12`) leans on it. "Multi-second precision rendezvous at hypersonic closing geometries" is one of the program's six named hard parts (`project_instructions.md:286`, `handoff.md`). The number that makes the hard part quantitative, the relative acceleration at the catch, appears nowhere.

- **Alternatives weighed.**
  - *A full rendezvous simulation* with a guided vehicle on a climbing arc, lateral offsets, a tracking law and dispersions. It would need a vehicle model, a guidance law and error budgets, none of which exist in the repository. Every input would be invented, and the output would be a capture probability nobody could check. The honesty rule kills it: a kernel that must invent numbers does not ship.
  - *Re-derive the Monte Carlo with coupled errors* (timing, position and velocity are not independent for a passive vehicle; see Findings). Useful, but it inherits every invented dispersion of the original and answers "what fraction latches", not "what the window is".
  - *A Python function in `physics/skyhook_physics.py`* with a `pytest` pin. That is where this should land, but a deposit here cannot write there. The explorable form also makes the point visible: the band the vehicle leaves in a second, the parabola, the 3 s line the curve never reaches.
  - *This.* A rigid rotor and a ballistic vehicle give a closed form in three terms, each traceable to a canon key, that turns a prose requirement into a derived number and a bill. It is the smallest thing that is true. An exact two-body integration beside it shows where the closed form holds, and a libration model brackets the one input whose meaning the repository leaves open.

## How it works

**Constants.** Everything comes from `snapshots/`, copied with `tools/snapshot.mjs` from Skyhook at `34935cb`: `rev_a.json` whole (sha256 `d0828c1e…`), `skyhook_physics.py` whole (read-only evidence, not executed) and `tools/twin/golden.json` whole. `build-data.mjs` wraps them as `snapshots/canon.data.js` (`window.SKYHOOK_CANON` / `module.exports`) so `index.html` can read them from `file://`. The wrapper holds the parsed `rev_a.json` and its sidecar, and the twin's t = 0 node states and 600 s means. It also holds three constants regexed from the physics-module snapshot with their line numbers: `R_EARTH_KM = 6371.0` (line 40), `G_STD = 9.80665` (line 41) and EQ-3a's `v_earth_rot = 0.465` literal (line 109, applied when `equatorial_prograde` is true). A test re-derives the wrapper byte for byte and checks every snapshot still hashes to its own sidecar. `index.html` and `app.js` carry no tether constant as static text; a test greps for 27 of them.

**Geometry (SI inside the kernel; the canon is in km).** The inputs are:

- μ = `orbital.mu_earth_m3s2` = 3.986×10¹⁴ m³/s²;
- CoM altitude h = `orbital.com_altitude_km` = 610 km;
- half-length L = `geometry.tether_half_length_km` = 320 km;
- tip speeds from `kinematics.v_tip_kms` (2.5), `kinematics.cislunar_revenue_gated_option.v_tip_kms` (2.8) and `kinematics.phase3_growth_option.v_tip_kms` (3.5).

The CoM radius is R = R_E + h = 6981 km, with R_E the physics module's 6371. That is the radius `tools/twin/physics.js:21`, the golden run and the file's own "r_tip = 7301 km" C3 notes use. The file's `orbital.com_radius_km` is 6988 (idea 01's finding F1). The page discloses it and the kernel can run with it: a_rel moves from 20.336 to 20.334 m/s², 0.01 %, so nothing here depends on which radius is right. Tip radius R − L = 6661 km; tip altitude 290 km = `geometry.tip_altitude_lower_km`.

**The scene [Certain for the equations].** A rigid rotor spins at ω = v_tip/L = 7.8125×10⁻³ rad/s (period 2πL/v_tip = 13.40 min, the file's 13.4). Its CoM is on a circular orbit, v_orb = √(μ/R) = 7556.3 m/s. At the bottom of the swing the lower tip moves at v_orb − v_tip = 5056.311 m/s. The twin's golden run starts from exactly this state (`golden.json` `checkpoints.0.state[0..3]` = [6 661 000 m, 0, 0, 5056.311 m/s]), and the kernel reproduces it to 10⁻¹² relative. A ballistic vehicle at the apex of its arc is matched to the tip there: same place, same velocity.

**The three terms.** At the bottom, the tip's inertial acceleration is centripetal minus the hub's gravity: ω²L − μ/R² = 19.531 − 8.179 = 11.352 m/s² outward. (ω²L = v_tip²/L is the file's `tip_acceleration_g` 1.99 g, EQ-3c; g₀ = 9.80665 from the module.) The vehicle's acceleration is gravity at the tip radius, μ/(R−L)² = 8.984 m/s² inward. Tip minus vehicle, radial:

  a_rel = v_tip²/L − μ/R² + μ/(R−L)² = 19.531 − 8.179 + 8.984 = **20.336 m/s² = 2.074 g**.

The gravity-gradient part, μ/(R−L)² − μ/R² = 0.805 m/s², is what the linearised 2μL/R³ = 0.750 would give to within 7 %; the kernel uses the exact difference. Both accelerations are radial at the match instant, so to first order the separation is a_rel t²/2 and the relative speed a_rel t.

**Passive windows.** Inside ±e: |t| ≤ √(2e/a_rel) = 0.9917 s for e = 10 m, 1.983 s in all, leaving at √(2 a_rel e) = 20.2 m/s. Inside ±v_tol: |t| ≤ v_tol/a_rel = 0.0492 s for 1 m/s, 0.098 s in all, by which time the separation is v_tol²/(2a_rel) = 2.5 cm. So the velocity tolerance binds, by a factor of twenty. The longest any passive trajectory can stay inside ±e is 4√(e/a_rel) = 2.80 s, arriving at 2√(a_rel e) = 28.5 m/s: enter at the top of the band falling, turn at the bottom, leave at the top. Scaling: t_pos ∝ √e and 1/√a_rel; t_vel ∝ v_tol and 1/a_rel.

**What §4.3 would need, and what it costs.** A passive window of total duration T needs an envelope of ±a_rel (T/2)²/2 and meets the vehicle at a_rel T/2: for 3 s, ±22.9 m at 30.5 m/s; for 10 s, ±254 m at 102 m/s. On position alone, then, §5.2(d)'s "tens of meters wide" envelope would allow a passive 3 s. But the vehicle would cross its edges at 30.5 m/s, about thirty times the ~1 m/s that §4.3 asks to be sustained through the window. (The site's catch sketch injects "a 30 m/s along-track mismatch" as deliberately bad, `:790`; that is 1.48 s of free fall here.)

Held instead, the vehicle must thrust at a_rel for the whole window, at a thrust-to-weight of 2.07. That is Δv = a_rel T = 61.0 m/s for 3 s and 203.4 m/s for 10 s, 1.3 % and 4.4 % of EQ-3a's 4.591 km/s catch speed. Who pays is a design choice. It could be the vehicle's engine, the grapple's own thrusters, or a reel at the tip paying line in and out by a_rel (T/2)²/2 (254 m for 10 s) at up to a_rel T/2 (102 m/s). The bill a_rel × T is physics.

**Against half-length.** a_rel falls as v_tip²/L shrinks, so the window grows as √L: 0.80 s in all at L = 50 km, 1.98 s at 320 km. With the tip at sea level (L = h = 610 km, a_rel = 11.89 m/s²) it reaches 2.59 s inside ±10 m and 0.17 s inside ±1 m/s. No half-length that keeps the tip above the ground reaches a passive 3 s at any of the three tip speeds. The curve is monotonic over the whole range (tested).

**Tiers.** At the canon L:

- cislunar: a_rel = 25.30 m/s² (2.58 g), ±0.889 s / ±0.040 s, 253 m/s per 10 s;
- Phase 3: a_rel = 39.09 m/s² (3.99 g), ±0.715 s / ±0.026 s, 391 m/s per 10 s.

The tip accelerations reproduce the file's 1.99 / 2.5 / 3.9 g at the file's precision. The file states those only for its own L, so at any other L the tier table shows a dash in their place. The EQ-3a speeds reproduce the file's 4.59 and 3.59 km/s; the file states none for the cislunar tier, where it would be 4.29.

**Validity of the closed forms.** They are the t → 0 limit of a rotating scene. The kernel refuses any half-window longer than 4 % of a rotation (ωt ≤ 0.25 rad: ±32.2 s at Rev A, ±3.6 s at 3.5 km/s and L = 50 km). This covers the passive windows, the held window and each requirement card (a card past the bound shows its own refusal while the rest of the page is computed). At that bound the exact integration and the closed forms agree to within 0.29 % for separation, relative speed and hold Δv. This was tested at 2.5 and 3.5 km/s for L = 10, 100, 320 and 600 km. The separation and relative-speed errors depend almost only on ωt: 4–7×10⁻⁴ at 2 % of a rotation and 1.5–2.9×10⁻³ at 4 %. The hold Δv error is smaller, at most 2.4×10⁻³. The kernel also refuses a half-length below 1 km, the minimum its own advice names. Both bounds are this prototype's scope choices, not Skyhook numbers. Separately, the page refuses typed values outside its input boxes' declared ranges rather than passing them on.

**Exact check.** `catchwindow.js` integrates the real scene, with no small-angle step:

- the CoM on a circular Kepler orbit;
- the tip on a rigid rotor about it (x = R cos Ωt − L cos ωt, y = R sin Ωt − L sin ωt);
- the vehicle under μ/r² from the matched state, by RK4 at 2 ms;
- the exact tracking thrust |a_tip − g(r_tip)|, integrated by Simpson's rule over a symmetric window.

Separation lags a_rel t²/2 by 2×10⁻⁶ at 1 s, 4×10⁻⁵ at 5 s and 1.8×10⁻⁴ at 10 s (1016.6 m against 1016.8). The exit time from ±10 m is 0.99171 s against 0.99170. The exact hold Δv for 10 s is 203.355 m/s against 203.360, and the thrust magnitude moves by 7×10⁻⁵ over ±5 s. The page prints the exit time and the exact Δv next to the closed forms.

**Which speed is v_tip? [Likely for the model; the arithmetic is Certain].** A tether in orbit does not spin at a constant rate. The model here is a rigid line body (any mass distribution along the line) on a circular orbit, which pitches as θ'' = −(3/2)Ω² sin 2θ, with θ measured in the orbit frame from the local vertical and Ω = √(μ/R³). This is the standard planar pitch equation of gravity-gradient attitude dynamics, a textbook result (for example Hughes, *Spacecraft Attitude Dynamics*); I know it from secondary sources and checked it here against the twin, not against the book.

Its energy integral θ'² = θ'_v² − 3Ω² sin²θ makes the tip fastest at the vertical, which is the catch. The tip speed relative to the CoM is L(θ' + Ω). Over one orbit-frame rotation the time mean of θ' is θ'_v · AGM(1, √(1 − 3Ω²/θ'_v²)), an elliptic integral in closed form. At Rev A, with 2.5 km/s at the vertical, the tip speed swings 3.41 % peak to trough, one cycle every 476 s (half the 953 s orbit-frame rotation). The rotation mean is 2457.16 m/s, 1.71 % below the vertical value, inside the glossary's "~1.5-2 %" (`docs/glossary.md:24`).

The repository does not say which speed `kinematics.v_tip_kms` names (F8). Two readings follow:

- *v_tip is the speed at the vertical.* This is the twin's initial condition and this page's numbers: a_rel = 20.34 m/s².
- *v_tip is the rotation mean.* This is what `physics/tether_dynamics.py:259-264` says. Solving for the spin whose rotation mean is 2500 m/s, the tip passes the vertical at 2541.98 m/s, and a_rel = 20.997 m/s² (+3.25 %). Then envelope windows are 1.59 % shorter (±0.976 s), velocity windows 3.15 % shorter (±0.048 s), and every hold Δv 3.25 % larger (63.0 / 210.0 m/s for 3 / 10 s).

So a_rel at Rev A lies between 20.34 and 21.00 m/s². The shift scales with Ω²/θ'²: +2.56 % for the cislunar tier, +1.61 % for Phase 3, +0.29 % for the reference tier at L = 100 km. The page computes it for whatever is selected.

The check against the twin is only possible where the twin was run, the reference tier at L = 320 km with the hub at 6981 km. There, integrating the same pitch equation from the golden run's initial state over its 600 s at its 1/60 s step gives a mean tip speed of 2462.53 m/s, against the golden file's 2462.64 (−4.4×10⁻⁵). The mean centripetal acceleration is 18.953 against 18.956 (−1.5×10⁻⁴). At the 60, 300 and 600 s checkpoints the tip speeds agree to 0.04, 0.11 and 0.16 % (the twin is elastic) and the pitch angles to 0.03°. The golden 2462.64 is a 600 s mean: 0.746 of an 804 s rotation and 1.26 modulation cycles, not a rotation mean, and it sits 0.22 % above the model's rotation mean. Using its ratio as if it were a rotation mean would give a_rel = 20.93 instead of 21.00. At any other configuration the page says the twin does not cover it and shows the model's figures alone.

The catch itself is unaffected by the libration over a few seconds: θ'' is zero at the vertical, and θ' changes by about 4×10⁻⁵ of itself over ±5 s. So the convention changes only which speed the tip has at the vertical, not the shape of the scene. Elasticity, damping and the catch transient are not modelled; the twin's dynamic load factor is a different question.

**Earth rotation [Certain arithmetic, Likely constants].** All three speeds below are for a prograde equatorial orbit; EQ-3a's literal applies only when `equatorial_prograde` is true, and `rev_a.json` states no inclination.

- *EQ-3a* (`skyhook_physics.py:95-110`) subtracts a literal 0.465 km/s "at equator" from the tip's inertial speed: 7556.3 − 2500 − 465 = 4591 m/s, the file's 4.59. That literal is the equatorial *surface* speed. The one external constant in this deposit is Earth's sidereal rotation period, 23.9345 h, with the equatorial radius 6378.137 km and volumetric mean radius 6371.000 km, from the NASA NSSDC Earth Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html, read 2026-10-26, rows quoted verbatim in the kernel). They give ω_E = 7.2921×10⁻⁵ rad/s and 465.1 m/s at the equatorial surface. So EQ-3a is launch-site bookkeeping: what a vehicle launched from the equator still has to add.
- *The velocity relative to the rotating Earth at the tip's own radius* subtracts ω_E × 6661 km = 485.7 m/s instead, giving 4571 m/s, 21 m/s lower. This is the physically ground-relative velocity at 290 km, and it is also the tip's airspeed in a co-rotating atmosphere, the number for drag and heating.
- *The ground-track speed*, the speed of the point beneath the tip across the surface, is a third quantity: (v/r_tip − ω_E) × R_E = 4372 m/s on the module's 6371 km.

The parameter sheet does not say whether `v_lower_tip_groundrel_kms` means the bookkeeping figure or the relative velocity. The page reports all three and leaves the choice to a verification memo.

**Drawing.** Inline SVG sized to its rendered width (the viewBox is set to the element's pixel width and redrawn on resize), so labels stay 11–12 px on a phone. The sketch's horizontal axis is the distance along the tip's own motion, so time runs left to right as in the timeline (the lower tip moves backward along the orbit; the caption and axis say so).

Colours are the dataviz reference palette's first two slots, validated in both modes (light `#2a78d6 #eb6834`, dark `#3987e5 #d95926`; worst adjacent CVD ΔE 24.7 / 26.8, all checks pass). Series 1, blue, is position and the envelope; series 2, orange, is velocity and the tolerance. The held window is a neutral wash; status chips carry an icon and a word.

Hover, tap, or focus with the arrow keys shows a crosshair and one tooltip listing both series; every value is also in the tables. The sketch stretches the vertical (stated, ×20 at desktop width) because the tip rises 295 m over 27 km of travel. Long unbreakable strings (dotted JSON keys, the fact-sheet URL) wrap inside their boxes.

## Tests

`catchwindow.test.mjs` (25 tests, Node built-ins, about 0.5 s). What they pin, and to what outside this code:

- **Snapshots.** Every file under `snapshots/` hashes to its own sidecar's `writtenSha256`. The three copies' written hash equals the source hash. Sidecars carry a 40-hex commit, the Skyhook remote and `readMatchesCommitted: true`. `canon.data.js` re-derives byte for byte through `build-data.mjs`'s own `derive()`/`render()` and deep-equals `rev_a.json`, and the three physics-module constants re-extract to the same values and lines (40, 41, 109).
- **The canon's own numbers reproduced.** Tip accelerations 1.99 / 2.5 / 3.9 g at the file's precision; EQ-3a speeds 4.59 and 3.59 km/s to two decimals; rotation period 13.4 min; upper release speed 10.06 km/s; tip altitude 290 km.
- **The twin's golden state.** The lower tip is at 6 661 000 m moving 5056.311 m/s, the hub at 6 981 000 m at v_orb, and the upper tip at v_orb + v_tip, all to 10⁻¹² relative. The exact-scene integrator starts from the identical state.
- **Hand-worked closed forms**, computed in the test from the raw constants without calling the kernel:
  - a_rel to 10⁻¹² against v²/L − μ/R² + μ/(R−L)²; the three terms 19.53125 / 8.1790 / 8.9838; 20.34 m/s² and 2.07 g to two decimals; the proposal's 20.34 within 0.1 %; the gradient 0.805 within 8 % of 2μL/R³;
  - aRelG and aCentripetalG equal a/`G_STD` exactly;
  - t_pos = √(2e/a) and 0.9917 s; t_vel 0.0492 s; velocity binds; totals under 3 s and 0.2 s and the title's 1.9–2.0 s; edge speed 20.17 m/s; 2.5 cm; the grazing bound 4√(e/a) = 2.805 s at 28.5 m/s; scaling by √e, v_tol, 1/√a, 1/a;
  - Δv = aT, 61.0 and 203.4 m/s; the catch-speed share against EQ-3a's speed worked by hand to 10⁻⁶ (203.36/4591.31); reel 254 m / 101.7 m/s;
  - the 3 s and 10 s needs, ±22.9 m / 30.5 m/s and ±254 m / 101.7 m/s; 30 m/s at 1.48 s.
- **Monotonicity and the ceiling.** 100 half-lengths from 50 to 609 km: t_pos strictly increasing, a_rel strictly decreasing, tip above ground. The ceiling at L = 610 km is 2.594 s, under 3 s, and the velocity ceiling is under 0.2 s, for all three tiers.
- **Two radii.** a_rel with the file's 6988 km is within 0.02 % of the 6981 km value. 6988 reproduces the file's v_orb 7.55 and 6981 gives 7.56 (F1, observed not fixed); both round the EQ-3a speed to 4.59.
- **Earth rotation.** ω_E 7.2921×10⁻⁵ rad/s; ω_E × 6378.137 km within 0.2 % of the 0.465 literal; 485.7 m/s at the tip radius; EQ-3a 4.5913 and Earth-fixed 4.5706 km/s, a 20.7 m/s gap; the sub-point speed by its hand formula and 4.3716 km/s, more than 150 m/s below both; the module's 6371 equals the fact sheet's volumetric mean radius.
- **Exact two-body check.** Separation and relative speed are within 2×10⁻⁵ (1 s), 10⁻⁴ (5 s) and 3×10⁻⁴ (10 s) of the closed forms, about a kilometre at 10 s, and below the closed form. The exit time from ±10 m is within 10⁻⁴. The exact hold Δv is within 10⁻⁵ (3 s), 10⁻⁴ (10 s) and 2×10⁻⁴ (20 s). Thrust at the match instant equals a_rel to 10⁻⁹, and at the edges is within 5×10⁻⁴.
- **The libration model against the twin** (read straight from `snapshots/golden.json`). The 600 s mean tip speed is within 10⁻⁴ of the golden 2462.64 m/s and the mean centripetal within 3×10⁻⁴ of 18.956 m/s². Tip speeds at 60/300/600 s are within 2×10⁻³ of the checkpoints' `tip_speed_rel_com`, and the pitch angle from the local vertical (tip minus hub against the hub's nadir) within 0.1°.
- **Rotation mean versus the 600 s mean.** The closed-form AGM mean equals the integrated mean over one orbit-frame rotation to 10⁻⁶. The depression is 1.714 % (inside the glossary's 1.5–2 %) and the peak to trough 3.41 %. The golden window covers 0.746 rotations and 1.26 modulation cycles, and its 600 s mean is more than 0.2 % above the rotation mean.
- **The mean reading of v_tip.** The solved spin's rotation mean is 2500 m/s to 10⁻⁹. It passes the vertical at 2541.98 m/s; a_rel is 20.997 (by hand from that speed too) and +3.25 %; envelope windows are 1.59 % shorter. The golden 600 s ratio would give 20.93, inside the range.
- **Away from the golden configuration.** At Phase 3 / 320 km, at reference / 100 km and with the 6988 km radius, `golden.applicable` is false and no model-vs-twin line is produced. The shift is +1.61 % and +0.29 % (the old unscaled caveat said +2.99 % and +3.05 %). The mean depression matches its small-k limit (3/4)(Ω²/θ'²)(θ'/ω) within 6 % and is below the reference's. A spin too slow to pass the horizontal is refused.
- **Refusals and validity.**
  - `not_found`: `null`, `{}`, a canon without `orbital.mu_earth_m3s2` (the reason names the key) or without `R_EARTH_KM`, and an unknown tier.
  - `out_of_envelope` naming the ground: L = 610 and 700 km; 609 km is accepted.
  - `out_of_envelope`: 0, −1, `NaN`, `Infinity`, the string `'10'`, `undefined` and `null` for the envelope, tolerance, hold time and tip speed.
  - Refusals carry a reason and `what_would_help` and no numbers. The 150 km flag flips between L = 460 and 470 km.
  - L = 0.001 km is refused naming the 1 km minimum, and 1 km is accepted.
  - The closed-form bound is ±32.2 s at Rev A: a 64 s hold passes and 65 s is refused. The reviewer's extrapolations (envelope 10⁷ m, tolerance 10⁶ m/s, hold 1000 s) are refused with no numbers. At 3.5 km/s and L = 50 km the 10 s requirement slot refuses while the 3 s slot and the page compute.
  - At the bound, exact and closed form agree within 0.3 % for 2 tip speeds × 4 half-lengths.
  - At L = 100 km every tier's file tip g is withheld; at 320 km it is the file's three values.
- **The page.** `index.html` and `app.js` contain none of 27 constant strings (6371, 6981, 6988, 6661, 320 km, 2.5 km/s, 20.3, 203 m/s, 4.59, 0.465, 2462, 21.0, 4371, …) as literal text. The page loads only the three local scripts and has the viewport meta, and `app.js` makes no request.

**Teeth.** Each sabotage below was applied to a scratch copy of the folder and all 25 tests run:

| sabotage | tests failing |
|---|---|
| g_tip sign flipped (a_rel = v²/L − g_hub − g_tip) | 14 |
| CoM radius taken from the file's `com_radius_km` 6988 | 13 |
| hub gravity dropped (a_rel = v²/L + g_tip) | 12 |
| gravity gradient dropped (g_tip evaluated at R) | 10 |
| tip speed added instead of subtracted at the bottom | 6 |
| exact integrator puts the tip on the far side of the CoM | 4 |
| t_pos = √(e/a), the 2 lost | 3 |
| t_vel = √(v_tol/a) | 3 |
| `G_STD` retyped as 9.81 in the data wrapper | 3 |
| energy integral with 2Ω² instead of 3Ω² (closed-form rotation mean) | 3 |
| inertial spin used as the orbit-frame spin in the libration model | 3 |
| Δv = aT/2 | 2 |
| pitch equation with Ω² instead of (3/2)Ω² (golden-run integration) | 2 |
| the old caveat: the golden 600 s ratio applied at every tier and L | 2 |
| ω_E from a 24 h day | 1 |
| an underground tether accepted | 1 |
| g divided by 9.81 instead of `G_STD` in the kernel (aRelG and aCentripetalG) | 1 |
| catch-speed share taken against the Earth-fixed speed (20.7 m/s lower) | 1 |
| golden-run check claimed at every configuration | 1 |
| closed-form bound 40 % of a rotation instead of 4 % | 1 |
| 1 km minimum not enforced | 1 |
| the file's tip g offered at every half-length | 1 |

`ui-check.mjs` (91 checks, headless Chromium, about 10 s; `check.mjs` runs it from `tools/check.mjs`) runs six scenes.

1. **Desktop, light.** The page opens on the reference tier at the canon half-length. It shows the headline; four chips; status chips (velocity binds; tip above the 150 km line; the passive window misses the §4.3 bound; the open v_tip convention with the kernel's 21.00); the sketch, both timeline series, both curve series and the timeline's edge labels. Then:
   - the §5.2(d) note (±22.9 m at 30.5 m/s);
   - the 3 s and 10 s cards (±23 m / 30.5 m/s / 61 m/s; ±254 m / 101.7 m/s / 203 m/s / 4.4 %);
   - three tier rows reconciling with the file: 1.99 (1.99), 4.591 (4.59), a dash for the cislunar EQ-3a speed, 391 m/s for Phase 3;
   - the provenance table's a_rel, golden pin, both radii and the exact-check line;
   - the convention card's 4.591 / 4.571 / 465.1 / 485.7 / 21 m/s, "launch-site bookkeeping", "also its airspeed" and the kernel's 4.372 ground-track speed;
   - the v_tip card's two a_rel readings equal to the kernel's, "does not settle it", and none of the old "consistent ones" wording;
   - the golden line's 2462.64 and 2462.53 m/s and "0.75 of a rotation";
   - the sketch's −0.99 s marker left of +0.99 s and its "tip moves →" axis;
   - the footer's commit and NASA source; a hover tooltip listing both series; Home and ArrowRight on the focused chart; Escape hiding it; no console error or network request.
2. **Desktop, interaction.**
   - An envelope of 40 m doubles the window as the kernel says. The 3 s button and ArrowRight on the slider change the headline to 3 s and 3.5 s.
   - Phase 3 shows its a_rel, is highlighted in the tier table, and its v_tip card says the twin covers only the reference configuration and shows the kernel's scaled 39.71.
   - At L = 100 km every tier row shows a dash for the file's tip g, with the caption saying why, and the v_tip card claims no golden check.
   - Typed envelope 10⁷ m, hold 1000 s and half-length 0.001 km are each refused as outside the input range, with the results hidden. A 100 s hold at Phase 3 (inside the box's range, past 4 % of a rotation) is refused by the kernel, and 3.5 s clears it.
   - L = 500 km warns of a 110 km tip without refusing. L = 650 km refuses with `out_of_envelope`, "below the ground" and a what-would-help while hiding every number, and the canon button restores. A zero envelope refuses and 10 m clears it.
3. **Canon suppressed.** The page shows a `not_found` refusal naming `build-data.mjs` and no numbers, without a console error.
4. **390 px, dark, touch.** The body colours follow the scheme. `scrollWidth` ≤ `clientWidth`, and no element reaches past the viewport (the tier table stacks into cards). No text node's rectangles pass its card or the page; this is measured on text ranges because element rectangles miss overflowing text. `innerWidth` stays 390, so the layout viewport was not widened. The 10 s button and the cislunar radio work by tap, a tap on the half-length chart shows a tooltip with both series, the smallest chart glyph is at least 10 px tall, and the timeline's viewBox width equals its rendered width.
5. **390 px, light.** The refusal state has no page or text overflow.
6. **A plain 390 px window without mobile emulation.** `scrollWidth` ≤ `clientWidth`, and no text spills.

Page-level sabotages, each on a scratch copy:

- removing the CSS wrap rule fails 3 ui-checks (the dotted tier keys spill their card, at 378 px against 374);
- drawing the sketch with time running right to left fails 1;
- dropping the page's input-range refusal fails 3 (the kernel then refuses those inputs itself, with its own reasons).

`node tools/check.mjs ideas/09-two-seconds-at-bottom` passes: README format, folder size, snapshot sidecars, the 25 tests, `check.mjs`, and the smoke test at 1280 and 390 px.

## Honest assessment

- **[Certain] The equations.** For a rigid rotor on a circular orbit in a point-mass field, the tip's acceleration at the vertical instant is ω²L − μ/R² outward, and a ballistic vehicle's is μ/(R−L)² inward. The relative acceleration is their difference, and separation a_rel t²/2 and relative speed a_rel t follow; an exact integration of the same scene agrees to 2×10⁻⁴ at 10 s and to 0.3 % out to 4 % of a rotation, the bound the kernel enforces. The hold Δv is a_rel T by the same token. The closed forms are checked against hand-worked values, the canon's stated numbers and the twin's golden state.
- **[Certain] At Rev A, a passive vehicle matched at the bottom of the swing is outside ±1 m/s after ±0.05 s and outside ±10 m after ±0.99 s** (±0.048 s and ±0.976 s if v_tip is the rotation mean). No half-length that keeps the tip above the ground gives a passive 3 s inside ±10 m at any of the three tip speeds.
- **[Certain, on the reading that the ±1 m/s tolerance must hold through the window] The founding document's 3–10 s is a station-keeping requirement, not a property of the geometry.** §4.3:124 asks for the tolerance "at the moment of capture, sustained through a window of 3–10 seconds"; I read "sustained" as covering both the position and the velocity limits. On position alone, §5.2(d)'s "tens of meters wide" envelope (`:167`) does allow a passive 3 s: it needs ±22.9 m. But the vehicle would meet the envelope's edges at 30.5 m/s, about thirty times the ~1 m/s tolerance. If the program means only the position limit to be sustained, the passive 3 s is geometrically possible at that closing speed and the claim above narrows to the velocity tolerance.
- **[Likely] The rigid-rotor numbers describe the Rev A catch to a few percent, and the few percent is a named open question.**
  - What the libration model adds: whether `kinematics.v_tip_kms` is the speed at the vertical or the rotation mean moves a_rel from 20.34 to 21.00 m/s² (+3.25 %). It moves the envelope windows by −1.6 % and the hold Δv by +3.25 %. The repository says both (F8). This page's headline takes the vertical reading, the one the twin's golden run is spun up with, labels it as such, and shows the other reading beside it.
  - Why the model is trusted: it reproduces the golden run's 600 s mean tip speed to 4×10⁻⁵ and its phase to 0.03°.
  - Where it is not checked: the golden file covers only the reference tier at 320 km, so the scaled figures elsewhere are the model's alone, and the page says so.
  - What is outside it: elasticity, damping and the catch transient are not in this page at all.
- **[Likely] The bill can be paid by someone other than the vehicle.** The reel and grapple columns are the same kinematics with a different actor. Whether a tip reel can run at 100 m/s line speed, or a grapple can carry 200 m/s of Δv, is engineering this page does not touch.
- **[Likely] The Earth-rotation conventions.** The arithmetic is exact. The fact-sheet constants are a published reference read on the date given; they are labelled [Likely] rather than [Certain] because I quote them from a web page, not the IERS conventions. Which convention the program means is for its verification memo.
- **[Speculative] That a 2.07 g hold is how the catch will actually be flown.** A guided vehicle would not hold station symmetrically about apex. It might arrive early and low and fly up the tip's arc, or the grapple might do the last metres. The Δv for any such profile over the same window is still of order a_rel T, but the profile, the margins and the abort logic are design work.
- **[Certain] What is out of scope**, and said so on the page: off-apex and climbing vehicles, lateral offsets, inclined orbits, grapple reach, latch mechanics, reel dynamics, tether elasticity and damping. Atmosphere is out of scope too: the tip at 290 km is flagged clear, and below 150 km the ballistic idealisation is marked wrong rather than extrapolated.
- **Rough.**
  - The sketch's vertical exaggeration is a drawing choice and changes with the window, and the "best passive" grazing bound is stated, not drawn.
  - The ±3 s default of the Monte Carlo is not reproduced here.
  - The tier table's phone layout is CSS-stacked rather than redesigned.
  - The 150 km scope line, the 1 km minimum and the 4 %-of-a-rotation bound are this prototype's choices, not Skyhook numbers.
  - The 21.00 m/s² rests on the rigid model's rotation mean; the twin itself has never been run for a whole modulation-cancelling interval in `golden.json`.
  - Sliders are checked by keyboard and number entry in `ui-check.mjs`, not by a synthetic touch drag, because native range inputs do not respond reliably to Playwright's touch drag. Buttons, radios and the charts are tapped.
- **Fidelity.** An idea-bank prototype. It has not been through Skyhook's Rule 1 canon process (constants come from a snapshot, not an import through `physics/skyhook_physics.py`), a verification memo, or the `pytest tests/` suite (pytest is not installed in this sandbox and nothing here was run against it).

**Findings about the source repo** (observed in the checkout at `34935cb`; not fixed there):

- **F1. The parameter sheet lacks the field its own instructions require.** `docs/project_instructions.md:48` (§2.2) lists "rendezvous window duration" among the kinematics every design iteration must document; `params/rev_a.json` has no window, catch or relative-acceleration key. [Certain] (gap).
- **F2. Two glossaries, neither derives the window.** `docs/glossary.md:11-12` says duration is "set by tether length, tip speed, and the vehicle's trajectory accuracy". The program site's glossary (`tools/sims/skyhook_program_site.html:1434-1435`) defines the catch window as "The 3–10 second interval", the §4.3 requirement restated as a definition. For a passive vehicle the length-and-speed dependence is a_rel = v_tip²/L − μ/R² + μ/(R−L)², and the 3–10 s is a hold, not a window. [Certain]
- **F3. The Monte Carlo's errors are independent where the kinematics couple them.** `skyhook_program_site.html:1366-1369` draws lateral position, closing velocity and timing errors independently and passes a trial that is inside all three limits. The window is a literal (`mc-w`, `:1336`, default ±3 s) and the timing error's default 1σ is 1.2 s (`mc-st`, `:1328`). For a passive vehicle a timing error t is not free: it is a_rel t²/2 of position and a_rel t of velocity, so 1.2 s is 14.6 m and 24 m/s at Rev A, outside the tool's own ±10 m and 1 m/s. The independence holds only for a vehicle that holds station through the window. The site does not state this, and it costs the 2.07 g / 203 m/s computed here. FAQ Q2 (`docs/objections_faq.md:12`) cites the tool's ">99 %" without that condition. Arithmetic [Certain]; the reading of the model [Likely].
- **F4. EQ-3a's "ground-relative" speed is launch-site bookkeeping with a hardcoded literal and an unstated convention.**
  - `physics/skyhook_physics.py:109` sets `v_earth_rot = 0.465 if equatorial_prograde else 0.0` ("km/s at equator [Certain]") in code, against Rule 2, because `rev_a.json` has no Earth-rotation key. `docs/project_instructions.md:39,45` and the site's FIG 1 (`:317`) say "~0.46", while FIG 2 (`:355`) says 0.465.
  - The literal is ω_E × 6378.137 km, the equatorial surface speed, paired with `R_EARTH_KM = 6371.0`, the volumetric mean radius. So `v_lower_tip_groundrel_kms` = 4.591 km/s is inertial speed minus surface speed: what a vehicle launched from the equator still has to add.
  - The tip's velocity relative to the rotating Earth at 290 km, which is also its airspeed in a co-rotating atmosphere, is 4.571 km/s. That is the physically ground-relative value; 4.591 is its approximation. The 21 m/s between them is twenty times the capture tolerance.
  - Neither is a ground-track speed; the tip's sub-point crosses the surface at 4.372 km/s.
  - The key name does not say which is meant. Suggested: an `earth_rotation_rad_s` key and a VM note naming the convention. [Certain]
- **F5. The 4.59 is pinned nowhere.** `tests/test_rev_a_physics.py:115-120` asserts only 0 < v_groundrel < v_orb. No test in `tests/` holds the canon's 4.59 or 3.59 km/s; grep for `4.59`, `3.59` and `groundrel` finds only that test and its import. [Certain]
- **F6. An asymmetric record.** `rev_a.json` states `v_lower_tip_groundrel_kms` for the reference (4.59) and Phase 3 (3.59) tiers and not for the cislunar option (4.29 by the same formula). [Certain] (gap)
- **F7. Idea 01's F1 confirmed from a third place.** `golden.json`'s hub node sits at 6 981 000 m and `tools/twin/physics.js:21` sets `R_EARTH_KM = 6371.0`, while the file's `orbital.com_radius_km: 6988` implies 6378. For this deposit the difference is 0.01 % of a_rel. [Certain]
- **F8. The repository gives v_tip two meanings.**
  - *v_tip is the rotation mean.* `physics/tether_dynamics.py:259-264` (`run_measuring` docstring, labelled [Certain]) says instantaneous tip speed "oscillates about the analytic EQ-3 value" and "the rotation-average is the quantity that matches v_tip and v_tip^2/L".
  - *v_tip is the speed at the vertical.* The twin is spun up with v_tip = 2500 m/s at the vertical: the golden t = 0 state, and `tests/test_tether_dynamics.py:51-56`, "spun up at radial phase". `tools/twin/twin.js:384-387` says the rotation mean sits "~1.5-2% below the free-space 2500 m/s figure". `docs/glossary.md:24` says the nominal spin "must be set slightly above the target release speed".
  - At Rev A the two readings differ by 1.7 % (42 m/s) in tip speed at the vertical and by 3.25 % in a_rel at the catch. The same 42 m/s carries into the upper-tip release speed if release is at the vertical.
  - The golden file's mean is labelled a "run-long rotation-averaged tip speed" (`scripts/generate_golden.py:13-15`). But its 600 s is 0.746 of an 804 s rotation and 1.26 gravity-gradient cycles, so it is a 600 s mean, 0.22 % above the rigid model's rotation mean.
  - The docstring's "averaging over an integer number of rotations cancels the periodic exchange" holds for orbit-frame rotations (953 s at Rev A; the exchange repeats every 476 s), not for the 804 s inertial rotation that `tests/test_tether_dynamics.py:63-64` integrates. That test runs with gravity off, so it is unaffected.
  - Arithmetic and quotations [Certain]; the modulation periods and the rotation mean from the rigid libration model [Likely].
  - Suggested: name the convention in `rev_a.json` (for example `v_tip_kms_meaning: "at the vertical"`) and in a VM entry, and average the golden mean over a whole number of modulation cycles.

**Deviations from the judged proposal, and why.**

- The proposal led with the two-second position window; the page leads with both and says the velocity tolerance binds (0.10 s). That is what the arithmetic says, and the title would otherwise overstate the passive case.
- The proposal drew the tip path "in the Earth-fixed frame"; the sketch is in the centre-of-mass frame. There the bottom of the swing is literally the bottom of a circle and the vehicle's path is a tangent, which is the picture. The Earth-fixed frame adds a 4.6 km/s translation and nothing to the relative motion.
- Added, beyond the proposal:
  - the grazing bound (4√(e/a_rel) = 2.8 s at 28.5 m/s);
  - the passive ceiling with the tip at sea level (no L reaches 3 s);
  - the reel-paid alternative;
  - the exact two-body integration and the closed forms' validity bound;
  - the libration model with both readings of v_tip and its check against the golden run;
  - the three Earth-relative speeds;
  - the coupled-error finding about the Monte Carlo.
- The proposal said the tier table should reproduce 4.59 "within 2 %"; the tests pin it to the file's two decimals exactly, and 3.59 likewise, and record that the cislunar tier has no stated value.
- The proposal quoted the tip-radius co-rotation as 0.486 km/s. With the fact sheet's ω_E and the 6661 km tip radius it is 0.4857 (0.4862 at the file's 6668 km). Both round to 0.486; the deposit uses a cited constant rather than a remembered one.
- The proposal's smoke test wanted "touch-dragged sliders"; the ui-check taps buttons, radios and charts by touch and drives the sliders by keyboard and number entry instead, for the reason given under Rough.

**Changes after review round 1.**

- The claim that the golden run establishes v_tip as the bottom-of-swing value is withdrawn and replaced by F8 and the libration model. The reviewer's 20.93 came from the 600 s ratio; with a true rotation mean the upper end of the a_rel range is 21.00.
- The modulation figures are computed for the selected tier and L instead of reusing the reference ratio, and the golden check appears only at the golden configuration.
- "Ground-track" is renamed EQ-3a (launch-site bookkeeping) and Earth-fixed (ground-relative at the tip, equal to the airspeed), with the true ground-track speed added.
- Long strings wrap, and the phone checks now measure text rectangles against `clientWidth`.
- Out-of-range typed values, sub-1 km tethers and windows past 4 % of a rotation are refused.
- The [Certain] station-keeping claim is conditioned on the velocity tolerance, with the §5.2(d) envelope reconciled.
- The physics-module sidecar note now says line 109.
- The sketch runs left to right.
- The file's tip g is withheld away from its own L.
- New tests pin g₀, the catch-speed share and the caveat away from the defaults.

## Where it would land

**Repository:** Skyhook. **Surface:** `physics/skyhook_physics.py`, as a new numbered equation (EQ-8, catch kinematics):

- the functions `catch_relative_accel_ms2(v_tip_kms, L_km, com_altitude_km)`, `passive_catch_window_s(a_rel, envelope_m, vel_tol_mps)` and `hold_delta_v_mps(a_rel, window_s)`, each with a confidence label and the rigid-rotor assumption in its docstring;
- a derived block in `params/rev_a.json` per §2.2, with the same entries for the 2.8 and 3.5 km/s options. For example: `rendezvous: { relative_accel_at_catch_ms2: 20.34, relative_accel_if_v_tip_is_mean_ms2: 21.00, passive_window_s_at_10m: 1.98, passive_window_s_at_1mps: 0.10, hold_delta_v_mps_per_s: 20.34, confidence: "[Likely] rigid rotor; v_tip read as the speed at the vertical (see F8)" }`;
- a `pytest` pin in `tests/test_rev_a_physics.py` for a_rel, the windows and (F5) the 4.59;
- the Monte Carlo's `mc-w` default and the two glossary entries derived from the new block rather than typed;
- the FAQ Q2 answer carrying the hold condition.

**To ship for real:**

- import every constant through `params/rev_a.json` and the physics module instead of this snapshot (Rule 1 and Rule 2, which also means adding an Earth-rotation key, F4);
- a verification memo entry naming the EQ-3a or Earth-fixed convention and, above all, which speed v_tip names (F8);
- a check against the lumped-mass twin's lower-tip acceleration at the vertical instant. `physics/tether_dynamics.py:300`'s `tip_centripetal_accel` is averaged over 600 s in the golden file, so a per-step or vertical-phase readout is needed, and a run over whole modulation cycles to put a measured number on the rotation mean that the libration model gives here;
- the `pytest tests/` run that Rule 1 of `CLAUDE.md` requires before any commit to `main`.
