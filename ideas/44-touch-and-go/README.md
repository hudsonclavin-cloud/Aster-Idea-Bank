# Touch and Go
> Fly OSIRIS-REx's touch-and-go again, then fly it at Apophis. Under idea 43's exact gravity with the body turning, OSIRIS-REx's reconstructed last 10-minute fall to Bennu is matched to 0.40 m and 2.6 mm/s (a point mass misses by 2.07 m and 9.2 mm/s), and the mission's own error tables give a contact ellipse of 6.2 m (3σ semi-major axis) against its published 8.1 m Monte Carlo and 6.5 m late update. On the chain, idea 42's NEAR-class craft descending from its 18.6 km stand-off to idea 43's site needs 94.6 cm/s and 160 g of propellant for a touch-and-go but carries 103 g (landing to stay takes 92 g); once down it weighs 46 mN, so any push over 0.046 N lifts it off.

**Kind:** explorable tool
**For:** Aster
**Run:** open `ideas/44-touch-and-go/index.html` in a browser (classic scripts, `file://` works, no network; it also opens on a `#h=` link carrying idea 43's handoff or this page's). Tests from the bank root: `node --test ideas/44-touch-and-go/touch.test.mjs` (9 tests, about 40 s) and `node ideas/44-touch-and-go/ui-check.mjs` (58 checks in headless Chromium, about 2 min; `check.mjs` runs it for `tools/check.mjs`). Regeneration, none needed to run anything: `bash ideas/44-touch-and-go/oracle/fetch-sources.sh <empty dir>`, then `node ideas/44-touch-and-go/build-data.mjs <that dir>` (checks every quoted figure against its document, writes `snapshots/tag-recon.js`), then `node ideas/44-touch-and-go/build-data.mjs --sample` (writes `handoff.json`).
**Made by:** Matchpoint

## What it is

Idea 44 is module 14 of the twenty in *The Long Way Round* (ideas 31 to 50, launch to asteroid and back). Idea 43 gave Apophis its radar shape and handed on a site: plate 346, gravity 95.3 µm/s², slope 7.1°, escape straight up 18.6 cm/s. This page flies the spacecraft down to that site and touches it.

- **Choose the case.** The chain (idea 43's handoff: Apophis, idea 42's NEAR-class spacecraft at its stand-off 18.6 km out on 11 July 2028), or **OSIRIS-REx at Bennu on 20 October 2020**, starting from its reconstructed state just before Orbit Departure and aiming at the published sampling spot (55.9°N, 41.8°E). Bennu is the case the model is held to.
- **Choose the ending.** Touch and go (back away after a few seconds), or stay (land): on loose regolith the spacecraft sinks and stops; on rigid rock it bounces.
- **Shape the descent** (sliders and typed values): departure-to-Checkpoint time, Checkpoint height, Checkpoint-to-Matchpoint and Matchpoint-to-contact times, contact speed, arm length, back-away speed, time on the surface, sunlight on or off, and for Bennu which measured GM.
- **Set the errors**: OSIRIS-REx's in-flight or pre-launch navigation and burn errors, a scale factor, and the safe radius.
- **Set contact and work**: spacecraft mass, rigid-ground restitution, and the push the spacecraft's own work (sampling, digging) puts on it.
- **Set the sampler**: particle mobility, the smallest particles, and how far a rock tilts the head.
- **Read** the total Δv and each burn (with OSIRIS-REx's flown burns beside them for Bennu), the 3σ contact ellipse and the chance of landing inside the safe radius, the contact speed spread, propellant needed against propellant carried, how deep the head sinks before backing away, whether the back-away leaves, bounces or sinking, the weight at the site and what holding down costs, the sample mass, and the Matchpoint height the targeting produces. Every number carries a confidence chip; every refusal is shown, with the 14 carried from ideas 40 to 43.
- **Watch** six charts: distance from the site against time to contact (log-log, with OSIRIS-REx's reconstruction as dots for Bennu); the contact ellipse and safe radius from above (with where OSIRIS-REx really was at contact); the head's depth against time; the back-away climb or the hops; propellant to hold down against the push; and the sample masses against what came home.
- **Check it** against 13 rows of reality, computed live from the Bennu case.
- **Export the handoff** for module 45 (copy, download, link): the surface state, its weight, what holding down costs, and every refusal so far.

## Why I made it

- **The series needs it next.** `queue/SERIES_LONG_WAY_ROUND.md`, row 44: "Descent and contact in milligravity: approach, contact dynamics, bounce, anchoring, collecting material", taking a gravity field and handing on an on-surface state and a sample mass. Idea 43's README, *Where it would land*: "Module 44 (Touch and Go) takes `site`, `body`, `spin` and the kernel's `fieldRaw()` to fly descent and contact in the exact field."
- **What a person decides with it.**
  - How to come down: how long the departure leg is, how high the Checkpoint, how fast the touch, and what that costs in Δv and propellant (and whether the spacecraft has it).
  - Whether the site is big enough for the navigation they have: the contact ellipse against the safe radius, and which error source to buy down (the error budget).
  - Whether to touch and go or to stay: how far a sampler sinks before it leaves, whether a lander bounces off rock or escapes, and how hard the work on the surface can push before the spacecraft lifts away.
  - Whether a TAGSAM-class sampler would collect enough, and why that cannot be said for Apophis yet.
- **For Aster.** Aster's ΔV stack stops at rendezvous (`src/v2/porkchop/delta-v.ts:5-6`: a flat 150 m/s stationkeeping allowance and a 10% margin). Proximity operations, descent and contact are not in it, and its catalog has no shape or surface (BRIEFING §1). This is what the last metres cost, for the two bodies whose shapes are public.

Alternatives weighed.
1. *A point-mass descent with closed-form two-body arcs.* Rejected: the reality test below shows a point mass misses OSIRIS-REx's last 10-minute fall by 2.07 m and 9.2 mm/s, nearly half of the 20 mm/s contact-velocity limit OSIRIS-REx was designed to.
2. *A full Monte Carlo for the dispersions on the page.* Rejected for the page (each draw is two flights through 3,000 to 4,000 plates); linear covariance through the exact flights is used, and the tests check it against a 150-draw Monte Carlo of the nonlinear flights.
3. *A granular contact model (Katsuragi-Durian or discrete elements).* Rejected: the papers that fit Bennu's contact (Walsh et al. 2022, Sci. Adv.; Ballouz et al. 2021, MNRAS) were not reachable from this session's network, and a law with unknown parameters would be decoration. A single constant resistance fitted to NASA's published figures is used, labelled as a fit.

## How it works

**The cases** (`importLumpy()`, `bennuCase()`).
- *Chain:* idea 43's handoff is re-run by idea 43's own `parseHandoff` (everything recomputed and compared to 1e-6); the start is idea 42's stand-off state inside it, the site idea 43's plate, the spacecraft idea 42's mass block (487.1 kg at the stand-off, 487 kg dry, Isp 294.2 s) and its sunlight (7.76e-8 m/s²).
- *Bennu:* idea 43's Bennu shape and spin at the TAG epoch, with Scheeres et al. 2020's particle-tracking GM (or the radio-tracking one). The start is JPL Horizons' reconstructed state 10 s before Orbit Departure. The aim point is where the ray from the DSK origin at 55.9°N, 41.8°E (Walsh et al. 2022, the "actual sampling location") pierces the shape: plate 121, slope 27.3° on the 25 m plates.

**The descent** (`plan()`). Three impulsive burns after OSIRIS-REx's profile (Berry et al. 2020: "Approximately 4 hours later, the spacecraft arrives at Checkpoint with an altitude of 125 m above the TAG site"; "followed by the Matchpoint burn 10 minutes later"; "with a vertical velocity of –10 cm/s"):
- *Departure:* the velocity that reaches a point `h_cp` above the aim point (along the plate's normal, turned with the body to that epoch) at the Checkpoint time. Newton's method with a finite-difference Jacobian through the exact flight, refreshed by Broyden updates, with backtracking; to 1 mm.
- *Checkpoint and Matchpoint together:* six unknowns (the velocity leaving Checkpoint and the Matchpoint burn) and six conditions at the contact time: the spacecraft's reference point the arm's length (3.4 m, TAGSAM's, JPL Horizons' -64 record) above the aim point, and a velocity relative to the turning ground of exactly `-v_td` along the normal. This is the guidance's job as Berry et al. 2021 state it ("two burns to target the TAG site position and TAG velocity"). The Matchpoint's height is an outcome.
- *Every flight* is idea 43's `fly()` under the constant-density polyhedron (Werner and Scheeres 1997), turning with the body (Bennu: `bennu_v17.tpc`; Apophis: Euler's equations from the nearest CK sample), plus sunlight: for Bennu idea 42's own `accel()` (sunlight with Bennu's shadow and the exact solar tide) tabulated along the reconstruction by `build-data.mjs`; for the chain idea 42's handed-on magnitude along the Sun line, off in the body's shadow cylinder (idea 42's rule).
- *Passive safety:* each leg is flown with a sample every ~2 min; where a sample is lower above the shape (by `rayHit`) than twice the distance flown between samples, that stretch is flown again every 20 s with idea 43's solid-angle inside test. A leg that passes through the shape is refused.
- *Back-away:* the burn adds `bab` along the normal to the ground's velocity; it leaves if its inertial speed beats √(2U) (idea 43's convention for escape in a non-rotating field).
- *Propellant:* the rocket equation on idea 42's mass and Isp; g0 = 9.80665 m/s², exact by definition (Aster's `launch-vehicles.ts` and idea 42 use it).

**Where it lands** (`dispersion()`). From Checkpoint on, as OSIRIS-REx flew it:
- the onboard (NFT) estimate is off by its knowledge error, 1 m and 1 mm/s per axis (3σ; Berry et al. 2021 Table 3, "Late Update"; pre-launch: 3 m and 3 mm/s);
- both burns were computed from that estimate, and each carries Berry et al. 2021 Table 2's execution errors per body axis: magnitude RSS(a, b% of the component), transverse c + d% of it. The spacecraft's Z axis is taken along the site normal (the TAG attitude aligns the arm with it), X along the burn's horizontal part. The table's sigma level is not printed; it is read as 3σ like Tables 1 and 3 [Likely].
- State transition matrices come from finite differences of the exact flights (6 perturbed Checkpoint states, 3 perturbed Matchpoint burns). Errors at the contact time are carried along the ground-relative velocity to the aim plane: a 2×2 position covariance (the ellipse), the horizontal and vertical speed spreads, and P(inside the safe radius) by quadrature of the 2-D Gaussian.
- The budget splits the ellipse's long axis by source.

**Contact** (`regolithFromTag()`, `penetration()`). NASA: contact at 10 cm/s, the head "sunk 1.6 feet (48.8 centimeters)", "touched Bennu's surface for approximately 6 seconds", and "by the time we fired our thrusters to leave the surface we were still plunging into the asteroid". A constant net deceleration a fits v₀τ − aτ²/2 = d: a = 2(0.6 − 0.488)/36 = 0.00622 m/s², still moving at 6.27 cm/s at 6 s. On the 32 cm base plate (Walsh et al. 2022) and a spacecraft of 880 to 2,110 kg (its dry and launch masses, Horizons' -64 record; its mass at TAG is not in these sources) that is 68.8 to 165.0 Pa, gravity included. Carried to another spacecraft: deceleration = p A / m − g_n, until it stops at v₀²/2a. The Bennu case backs away at NASA's ~6 s for this contact (so it shows the 48.8 cm it was fitted to); the chain backs away at the post-TAG paper's design value, "approximately 5 seconds after detecting surface contact".

**Bouncing** (`bounce()`). On rigid ground the rebound keeps the tangential velocity and reverses the normal one times e; the lander flies under the shape as the body turns; impacts are found on idea 43's plates by the inside test, refined by bisection to 1 ms, and the new plate's normal is taken. It stops when the normal speed is under 1 mm/s, after 12 hops, or when a rebound beats √(2U) (escape). The threshold e* = escape speed straight up (idea 43) / contact speed is shown.

**Holding down** (`holdDown()`). Weight = m × the acceleration a grain feels at the site (idea 43: gravity, spin and Euler terms); its normal part m a cos(slope) is what a push must exceed to lift the spacecraft; thrusters make up the rest at F / (Isp g0) of propellant. Anchors that rely on soil strength are refused (below).

**The sample** (`sampleOf()`). Walsh et al. 2022's sampleability estimates for the spot TAGSAM touched, made after TAG (their section 6, once the contact location was known) from the pre-TAG particle maps (low or high mobility; mapped particles, smallest 7.65 mm, or sub-pixel, 3.8 mm): 32.37, 112.30, 150.48, 249.89 g, all with the mapped rock-tilt efficiency of 0.434. Their tilt function is exponential, 50% at 3.7°, so 0.434 is 4.46° of tilt and the zero-tilt values are the estimates / 0.434 (their 258 g and 575 g, printed truncated). The TAG images showed the head flush with the surface, so the authors favour zero tilt; the page's default is zero tilt, and it applies the tilt you set. For Apophis there is no particle map: the mass is refused, and the Nightingale scenario scaled by bulk density (2,025 against 1,190 kg/m³) is shown as an analog only.

**The reality test** (`reality()`, `snapshots/tag-recon.js`). JPL Horizons' OSIRIS-REx (-64) about Bennu, ICRF, TDB, source ORX_merged:
- The descent (17:00 to 21:51 TDB) comes from the segment `orx_200827_201020_201020_od294-N_tag_v1`. It ends between 21:51:02.0 and 21:51:02.5 TDB, where the range jumps 1.92 m into `od292` (a pre-TAG prediction with a modelled back-away) and later into `od295-R`. That end is taken as the contact [Likely]: plus 18.517 min of light time it is 22:08:24 UTC at Earth, the minute NASA gives ("The team on Earth received confirmation at 6:08 p.m. EDT").
- The burns are found from the 10-s rows: Orbit Departure 17:30:30-17:31:00, Checkpoint 21:29:20-21:31:00 (three components in sequence), Matchpoint 21:40:30-21:41:00 TDB. The flown Δv of each is the state after flown back and the state before flown forward to the burn's middle.
- Each coast leg is flown from the reconstructed state after one burn to the row before the next (or to contact), under the shape and under a point mass, with idea 42's sunlight.

**Reusing earlier modules.** Idea 43's kernel and all its data (`lumpy.js`, `shapes.js`, `attitude.js`, `geophysics.js`, `orbit-b*.js`, idea 40's integrator excerpt, idea 42's `approach-sources.js`, Aster's constants), byte-identical (`tools/snapshot.mjs`, tested); idea 43's committed handoff, wrapped; idea 42's `accel()` at build time.

**Handoff schema (version 1, `from: "44-touch-and-go"`).** `handoff.json` is the sample: idea 43's committed handoff with this page's defaults (75 KB).

| inputs | |
|---|---|
| `lumpy_handoff` | idea 43's handoff, whole (and through it 42's to 39's), or `null` |
| `case` | `null`, or `"bennuTAG"` for the stand-alone Bennu case |
| `settings` | `{gm, mode, depToCp_h, h_cp, cpToMp_min, mpToTag_min, v_td, arm_m, bab_m_s, contact_s, errors, errScale, safeRadius_m, mass_kg, surface, e, reaction_N, mobility, particles, rockTilt_deg, sun}` |

| outputs | units | confidence |
|---|---|---|
| `descent` `{site {face, aim_body_m, normal_body, frame}, departure/checkpoint/matchpoint/contact UTC, burns[{name, tdb_s, dv_icrf_m_s, dv_m_s}], backaway_m_s, total_dv_m_s, contact_state_icrf, contact_rel_body_m_s, contact_normal_m_s, contact_horizontal_m_s, fall_s}` | m, m/s, s | derived |
| `dispersion` `{contact_ellipse_3sigma_m, major_axis_deg, horizontal/vertical_speed_3sigma_m_s, safe_radius_m, p_inside_safe_radius, budget_major_3sigma_m, errors, scale}` | m, m/s, deg | derived |
| `contact` `{v_in_m_s, head_area_m2, inferred_deceleration_m_s2, resistance_Pa [low, high], contact_s, cases[{p_Pa, m_kg, deceleration, depth_at_backaway_m, speed_at_backaway_m_s, stop_m, stop_s}]}` | m, m/s, Pa, kg, s | assumed |
| `backaway` `{dv_m_s, inertial_speed_m_s, escape_speed_m_s, escapes}` or null (stay) | m/s | derived |
| `surface_state` `{mode, body, epoch, site_face, aim_body_m, normal_body, C_icrf_to_body, omega_body_rad_s, gravity_m_s2, accel_m_s2, slope_deg, escape_up_m_s, spacecraft_mass_kg, weight_N, hold_normal_N, along_slope_N, friction_needed_to_stay, isp_s, hold_propellant_kg_per_N_hour, propellant_left_kg (null when short), propellant_short_kg (null when not), stay}` | m, m/s², deg, N, kg | derived |
| `propellant` `{dv_m_s, needed_kg, available_kg, isp_s}` or null | kg, m/s, s | derived |
| `sample` `{sampler, scenario, rock_tilt_deg, tilt_efficiency, mass_kg (null for Apophis), nightingale_analog_kg, density_ratio, bennu_returned_kg}` | kg | assumed |
| `reality` (Bennu only) `{legs[{leg, hours, polyhedron, point_mass}], flown_burns_m_s, contact_utc, contact_lat_lon_deg, contact_normal/horizontal_m_s, earth_receive_utc}` | m, m/s | measured |

**Refusals.** Ideas 40 to 43's 14 are carried with their `from`. This module's own:
- `hazards` (always): the 25 m plates are coarser than the 8 m safe radius and the 0.32 m head, so only P(inside the safe radius) is given, not the chance of an unsafe contact;
- `regolith` (always): the resistance is a fit to one contact (Bennu) or an analog (Apophis);
- `anchors` (always): soil-strength anchors are not modelled;
- `propellant` (`out_of_envelope`) when the spacecraft does not carry enough;
- `sample` for a body with no particle map; `spacecraft_mass` for Bennu without a mass;
- `descent` / `terrain` (`out_of_envelope`) when no descent converges, a leg passes through the shape, or the last fall meets a neighbouring plate; `contact_velocity` over 20 mm/s horizontal; `invalid_input` for settings.

**Reading one back** (`parseHandoff`): idea 43's inside is re-run by idea 43, then everything here is recomputed and compared to 1e-6, refusal codes included.

**For module 45** (Dig): `surface_state` (where the spacecraft is, the local acceleration and slope, its weight there and the propellant per newton-hour of holding down) and the `regolith` and `anchors` refusals: digging that pushes harder than 46 mN must be held down by thrust.

## Tests

`touch.test.mjs`, 9 tests, Node built-ins, about 40 s:

1. **Snapshots.** Every sidecar's sha256 matches its file; the nine files from idea 43 are byte-identical to idea 43's committed ones; the wrapped handoff equals idea 43's `handoff.json`; the execution-error arrays re-form the printed rows of Berry et al. 2021 Table 2 (`build-data.mjs` found these and every other quoted figure, 64 strings, in their documents); the sunlight table equals idea 42's committed `accel()` at its rows.
2. **Reality, leg by leg** (JPL Horizons):
   - the last fall, Matchpoint to contact (10.0 min): the shape misses by 0.400 m and 2.63 mm/s, a point mass by 2.074 m and 9.25 mm/s;
   - Checkpoint to Matchpoint (9.5 min): 0.145 against 0.553 m;
   - Departure to Checkpoint (3.97 h): 1.694 against 7.290 m;
   - on each leg the shape is more than 3.5 times better; in the last fall the model falls too fast (−0.38 m, −2.6 mm/s radially);
   - the reconstruction's contact: 10.05 cm/s against NASA's 10 cm/s; 6.1 mm/s horizontal (limit 20); Earth hears it at 22:08 UTC as NASA said; the spacecraft's reference point 4.23 m above this page's aim point, 0.83 m more than the 3.4 m arm (the 25 m plates sitting low, or the trajectory's reference point not being an arm's length straight above the head: that offset is not published; not separated);
   - flown heights 127.6 m at Checkpoint and 58.2 m at Matchpoint; flown burns 80.07, 176.48, 72.15 mm/s.
3. **The planner on OSIRIS-REx's timeline.** It hits its targets (contact within 2 mm of the aim, −10 cm/s to 2e-6, no horizontal speed). Its burns are 72.90, 134.08, 96.34 mm/s: the departure 9.0% under the flown one, Checkpoint plus Matchpoint 7.3% under. The Matchpoint comes out 53.57 m up, inside the published 50 m (2020) to 55 m (2014). No leg passes through the shape, and the safety check does fire on a path straight through Bennu (and not on one that passes by). A 150 m Checkpoint re-solves the cached departure leg and reaches it. The 40 cm/s back-away leaves (escape 20.4 cm/s); a 17 cm/s one (18 cm/s inertial, with the turning ground) falls back and a 25 cm/s one leaves (added in review).
4. **Dispersions.**
   - In-flight inputs: 3σ semi-axes 6.20 × 5.30 m, 23.6% under Berry et al. 2020's Nightingale Monte Carlo (8.12 m) and 4.6% under Berry et al. 2021's late update (6.5 m); horizontal 6.64 mm/s against 6.64; vertical 8.50 against 6.95 mm/s (+22%).
   - Pre-launch inputs: 14.62 m against the published 17-20 m; horizontal 13.26 mm/s inside 12-15; vertical 18.21 above 9.4-15.
   - Doubling every error doubles the ellipse; a 150-draw Monte Carlo of the nonlinear flights matches the linear axes within 15% (measured: +3% and +6% on a 200-draw run).
   - Closed form: a circular Gaussian puts 1 − exp(−R²/2σ²) inside R.
5. **Contact.** The fit is exact: each pressure on the mass it was inferred for gives back 48.8 cm at 6 s, still moving, and would stop at 80.4 cm; the Bennu case's own defaults back away at that 6 s and show the 48.8 cm (added in review). On the chain's 487 kg craft: 35.9 cm or 18.4 cm deep at the 5-s back-away (the stiffer case has already stopped).
6. **Bounce.** A low hop (e = 0.1 at 10 cm/s) lasts 307.9 s against 2ev/a_n = 306.0 s (0.6%); a rebound above the escape speed leaves and one under it comes back; e* as the closed form.
7. **Holding down and sampling.** Weight 46.18 mN = m a; holding 1 N costs 1.1906 kg/h = (1 − 0.0458)/(Isp g0) × 3600; 0.434 is 4.456° of tilt; the zero-tilt numbers truncate to the paper's 258 g and 575 g; against the 121.6 g returned, the estimate with the mapped rock tilt (112.30 g) is 7.6% under and the zero-tilt one the authors favour 113% over; Apophis's mass is refused.
8. **The chain.** The chain's sunlight equals idea 42's committed `accel()` (sunlight part) at seven points, sunward, in the shadow, beside it, just inside and just outside the shadow's edge behind the body (the last two added in review), and at the stand-off; idea 43's handoff passes idea 43's own parser; 14 refusals carried, 5 own; burns 212.0, 248.0, 85.6 mm/s; ellipse 12.67 m, P(inside 8 m) 0.910; propellant 0.1596 kg needed, 0.1030 carried, and the handoff carries the 56.6 g shortfall with no propellant left (not a negative mass); landing to stay pays no back-away, 92.1 g, inside what it carries (both added in review); the sample handoff is exactly what its inputs give; an edited output or a dropped refusal is refused.
9. **Refusals the inputs raise.** Garbage; idea 42's handoff (pointed to idea 43); an edited idea 43 handoff (idea 43's parser refuses it); a 5 m/s contact; an unknown mode; a Checkpoint below the arm; Bennu's own refusal set; no propellant number for OSIRIS-REx.

**Teeth.** I made 22 sabotages of `touch.js`, each alone, in a scratch copy of the bank (`ideas/43-lumpy` and `ideas/42-closing-in` linked in), and ran the suite on each. **21 of 22 were caught.** Failing tests:

| Sabotage | Failing tests |
|---|---|
| Contact velocity targeted upward (sign of vtd) | 3, 4, 5, 6, 8, 9 |
| Ground-relative velocity without the spin | 2, 3, 4, 8 |
| Aim point turned with the transposed attitude | 3, 4, 8, 9 |
| Bennu sunlight left out | 2, 3 |
| Chain sunlight toward the Sun | 8 |
| Burn magnitude error read as 1 sigma | 4, 8 |
| Onboard knowledge read as 1 sigma | 4, 8 |
| Contact-plane shift with the wrong sign | **none** |
| Inside-the-circle integral without r dr | 4, 8 |
| Regolith deceleration without its factor 2 | 5, 8 |
| Gravity helping the head out of the hole | 5, 8 |
| Rebound without the restitution | 6 |
| Weight on the slope with sine for cosine | 7, 8 |
| Tilt efficiency e-folding for halving | 7 |
| Flown burns measured at the burn start | 3, 4 |
| Rocket equation inverted | 8 |
| Back-away ignores the turning ground | 8 |
| Departure cache blind to the Checkpoint height | 3 |
| Passive-safety check never fires | 3 |
| Bennu site from the centre of mass, not the DSK origin | 3 |
| Chain shadow on the sunward side (the bug found while writing the tests) | 8 |
| Matchpoint execution errors dropped | 4, 8 |

- *Not caught:* flipping the sign of the shift along the path onto the contact plane. While the planner targets zero horizontal speed at contact, the path is normal to the plane and the shift has no in-plane part, so the sabotage changes nothing the page shows; it would matter only for a contact with sideways speed, which this planner never produces.
- *Caught by one test only, and how:* the chain's sunlight sign and the chain's shadow side by test 8's comparison with idea 42's `accel()`; the inverted rocket equation by test 8's propellant pin; the back-away without the ground's speed only by test 8's sample regression (the handoff's inertial speed), since the back-away still leaves; the restitution by test 6's closed-form hop; the tilt function by test 7's 0.5 at 3.7°; the departure cache, the safety check and the Bennu site's ray origin by test 3.
- Test 3's checks of the safety check and the departure cache were written for those two sabotages, before this run.

**The review's sabotages** (same method, a scratch copy of the bank, each alone; failing tests on the suite as revised, and on the builder's suite where it differed):

| Sabotage | Failing tests |
|---|---|
| Penetration depth without the ½ | 5, 8 |
| Hold-down propellant without g0 | 7 |
| Matchpoint burn costed with the Checkpoint rows of Table 2 | 4, 8 |
| Landing to stay still pays the back-away | 8 (builder's suite: **none**) |
| Rebound reverses the tangential velocity | 6 |
| UTC = TDB + 69.184 s | 2, 8 |
| Chain shadow cylinder twice the radius | 8 (builder's suite: **none**) |
| Back-away escape energy without the ½ | 3 (builder's suite: **none**) |
| Regolith pressure on the 21 cm opening, not the 32 cm base | 5, 8 |
| Apophis sample analog scaled by the inverse density ratio | 7, 8 |
| Checkpoint knowledge velocity error dropped | 4, 8 |
| Site weight from gravity alone, without the spin | 7, 8 |
| Rocket equation without g0 | 8 |
| Propellant left handed on as a negative mass again | 8 |
| Bennu's back-away at the 5 s design value again | 5 |
| Contact velocity targeted upward (the builder's first row, re-run) | 3, 4, 5, 6, 8, 9 |

`ui-check.mjs`, 58 checks in headless Chromium: the tiles equal the kernel's (total Δv, ellipse, propellant, weight; chain, Bennu and Bennu with the radio-tracking GM), with the right confidence chips; the five own and 14 carried refusals; six charts drawn; the 13-row reality table with no NaN; a softer touch typed in moves the plan as the kernel does; stay on rigid rock gives the kernel's hop count; a 5 m Checkpoint is refused with no tiles; the download parses in the kernel; garbage, idea 42's handoff and an edited idea 43 handoff are refused; this page's sample imports and matches; a `#h=` link with idea 43's handoff; OSIRIS-REx's flown burns in the table; Bennu's sinking tile as one number, NASA's 49 cm, and the sample row naming both of Walsh et al.'s estimates (both added in review); at 390 px in dark and light: no overflow, the right background, no text under 11 px, charts drawn, a tap changes the mode, no NaN, no console errors.

`node tools/check.mjs ideas/44-touch-and-go` passes (README, sidecars, tests, `check.mjs`, smoke at 1280 and 390 px), with a size warning (below).

## Honest assessment

- **[Certain as measured] The exact field matters in the last minutes.** Flown from OSIRIS-REx's reconstructed state after Matchpoint, the shape reaches the contact epoch 0.40 m and 2.6 mm/s from the reconstruction; a point mass is 2.07 m and 9.2 mm/s off. The Checkpoint-to-Matchpoint leg: 0.145 against 0.553 m.
- **[Likely] The four-hour leg's result leans on sunlight.** With idea 42's sunlight the shape misses by 1.69 m and a point mass by 7.29 m; without sunlight the shape misses by 7.55 m and a point mass by 1.76 m. Sunlight (3e-8 m/s², 3 m over 4 h) and the shape's pull are the same size there. With the radio-tracking GM the shape's miss is 0.68 m.
- **[Speculative as to cause] The model falls a little too fast near Nightingale.** Its radial speed error in the last fall is −2.6 mm/s: its gravity there is too strong. Two candidates: an under-dense near surface, which uniform density ignores (NASA 2022 quotes Walsh: "we found a lot of void space in the surface"; the abstract of Walsh et al. 2022, Sci. Adv., seen here only through a web-search summary because the paper was not reachable, puts it at about half the bulk density); and the 25 m plates, which fill in the 20 m Hokioi crater. Not separated.
- **[Certain as numbers; Likely as comparison] The planner's burns are within 7 to 9% of the flown ones**, split differently between Checkpoint and Matchpoint (134 + 96 planned against 176 + 72 flown mm/s). OSIRIS-REx's guidance updated both burns onboard from its own estimate and aimed at its own site model; this page aims at a plate of the 25 m shape. The Checkpoint burn's three components spanned 80 s, so its impulsive measurement leaves a 4 m position gap.
- **[Likely] The contact ellipse is 24% smaller than the mission's Monte Carlo and 5% smaller than its late update** (its 3σ semi-major axis, 6.2 m, against their 8.12 m and 6.5 m maximum). The horizontal speed spread matches (6.64 against 6.64 mm/s), the vertical one is 22% larger. Only navigation knowledge and burn errors from Checkpoint on are modelled; the mission also had gravity, sunlight, spin and attitude errors, and its burn axes are not published (the Z axis is taken along the site normal). The pre-launch case lands inside the published horizontal range and 14% under its position range.
- **[Certain as arithmetic; Speculative as physics] Sinking.** One constant deceleration fitted to three published numbers reproduces them by construction; nothing here tests it. The real resistance grows with depth and speed, the arm has a constant-force spring, the gas jet fired after 1 s. Carrying Bennu's fit to Apophis, an S-type body, is an analog only.
- **[Likely] Bouncing** follows the closed form for low hops (0.6%) but runs on 25 m plates: the boulders that decide a real bounce are not in the shape, and restitution has no measured default here (0.5 is a setting, not a datum).
- **[Certain as numbers] On the chain:**
  - From idea 42's stand-off, a 24-hour departure leg costs 212 + 248 + 86 mm/s plus the 40 cm/s back-away: 94.6 cm/s, 160 g of propellant; idea 42's NEAR-class craft reaches the stand-off with 103 g (its tanks were sized to finish the 90-day stay at zero). Landing to stay needs 92 g. A 48-hour leg needs 132 g for the touch-and-go; a 12-hour leg 241 g.
  - The ellipse's 3σ semi-axes are 12.7 × 8.7 m, 91% inside 8 m; the Checkpoint burn's execution error is 12.5 m of the 12.7 (the burn cancels a 25 cm/s approach). A slower departure leg shrinks both: 48 h gives 9.1 m and 98.7%.
  - Once down it weighs 46.2 mN; a push over 45.8 mN lifts it; holding 1 N for an hour takes 1.19 kg of propellant, eleven times what it has. Module 45 cannot dig by pushing without anchoring, and soil-strength anchors are refused here (Bennu's near surface is "loosely packed and lightly bound", NASA 2022).
- **[Certain as transcribed; Likely as comparison] The sample:** Walsh et al. 2022's sampleability estimate for the spot touched (low mobility, sub-pixel particles), made after TAG from the pre-TAG particle maps, is 258 g with no tilt, the case the authors favour because the TAG images show the head flush: 112% over the 121.6 g returned. With the mapped rock tilt (efficiency 0.434) it is 112.3 g, 7.6% under; that one is closer, which is not evidence it is right. The returned mass is what survived the return, not what TAGSAM held.
- **What is rough or cut.**
  - *No hazard map.* The 25 m plates cannot show the hazards an 8 m site is about; Bennu's 5 cm Nightingale model (67 MB) is named in the refusal, not used.
  - *No onboard guidance after Checkpoint, no wave-off at 5 m, no tip-over, no attitude.* Burns are impulsive.
  - *Dispersions* start at Checkpoint; the departure leg's own navigation errors (Berry et al. 2021 Table 1) are not propagated.
  - *Contact is one-dimensional*, with one constant resistance; no spring, gas jet, contact pads or leakage.
  - *Only two bodies* (idea 43's shapes); the site for Apophis is idea 43's plate.
  - *Speed.* The chain's first run takes about 6 s in a browser (a 24-hour flight about a tumbling body, many times over for the targeting); later changes reuse the departure leg (about 1.5 s).
  - *Size.* About 610 KB as the checker counts (600 KB as built; the review's README additions are the rest): over the 500 KB budget, under the 650 KB limit. Idea 43's kernel and data are 230 KB of it, and idea 43's 61 KB handoff appears twice (the page's stand-alone case, and inside `handoff.json`).
- **What writing the tests caught in my own code.**
  - The chain's sunlight was switched off on the sunward side of Apophis instead of in its shadow (the sign of one dot product). Comparing with idea 42's own `accel()` caught it; it moved the chain's burns by under 0.1 mm/s because the descent is lit.
  - A lander's bounce started from the spacecraft's reference point, the arm's 3.4 m above the ground, so the first hop fell 3.4 m too far (1.70 times the closed-form hop time); it now starts on the plate.
  - A first Matchpoint formulation (fixed Matchpoint height, free fall time) left 17.9 mm/s of sideways speed at contact on Bennu; the joint six-condition targeting replaced it.
- **What the independent review changed** (a second agent, 2026-11-01: it re-fetched every source with `oracle/fetch-sources.sh`, rebuilt the snapshots, recomputed numbers outside this kernel, drove the page at 390 and 1280 px in light and dark with edge inputs, and sabotaged the kernel).
  - *Re-derived independently* [Certain]: on a fresh fetch, `build-data.mjs` finds all 64 quotes and rewrites `snapshots/tag-recon.js` byte-identically, and the five PDFs match their recorded sha256. A separate Python script on the raw Horizons rows (point mass, GM 4.89045 m³/s², RK4, no sunlight) gives the last fall's point-mass miss as 2.071 m and 9.24 mm/s (this page: 2.074 m, 9.25 mm/s, with sunlight) and Checkpoint to Matchpoint 0.549 m (0.553); the flown burns as 80.07, 176.35, 72.35 mm/s (80.07, 176.48, 72.15); the speed relative to the turning Bennu at the end of the descent segment as 100.67 mm/s (this page: √(100.48² + 6.08²) = 100.66); and Earth receipt at 22:08:23.8 UTC.
  - *Chain check*: handoffs exported fresh from idea 43's kernel (its defaults; density 2,600 kg/m³; plates 100 and 500; the low end of the GM range) all import here and run, and this page's own export of one of them parses back.
  - *Fixed, a mislabelled comparison.* The README and the reality table called Walsh et al.'s 112.3 g a "pre-contact prediction" and labelled the comparison [Certain]. Their section 6 made it after TAG, for the spot found to have been touched, from the pre-TAG maps with the mapped rock tilt, and then favours zero tilt (258 g) because the TAG images show the head flush. Both are now shown and named for what they are.
  - *Fixed, a negative mass handed down the chain.* `surface_state.propellant_left_kg` gave module 45 −0.0566 kg on the default chain. It is now null when the descent needs more than the craft carries, with the shortfall in a new `propellant_short_kg` beside the `propellant` refusal. A 44 handoff exported before this review is refused by `parseHandoff` (its outputs are not what its inputs now give).
  - *Fixed, Bennu's sinking contradicted its own fit.* The Bennu case backed away at the 5 s design value, so its tile read "42–42 cm" beside NASA's 48.8 cm in ~6 s, the figures the resistance is fitted to. It now backs away at NASA's 6 s for this contact and shows 49 cm; a range that collapses shows one number.
  - *Fixed, sizes that read as widths.* "12.67 × 8.67 m" is the 3σ ellipse's semi-axes; the tile, the reality row, the tagline and this README now say so.
  - *Fixed, an over-attribution.* The 0.83 m by which the reconstruction's reference point sits higher than the 3.4 m arm was put down to the 25 m plates alone; the trajectory reference point's offset from the TAGSAM head is not published, so both causes are named and not separated.
  - *Fixed, weak tests.* Of 12 new single sabotages the review made against the builder's suite, 9 were caught and 3 missed: landing to stay still paying for the back-away (the 92 g in the tagline was untested), a shadow cylinder twice Apophis's radius, and the back-away's escape test without its ½. Tests 3 and 8 now pin a back-away on each side of escape, two points either side of the shadow's edge behind the body, and the stay-mode propellant; on the revised suite all 12 are caught, and so are four more: two guarding the review's own fixes, a rocket equation without g0, and the builder's first row re-run (table above).
  - *Polish*: the hop chart's tracks start on the ground (they started at the first sample, about 2 m up); the escape-threshold tile says when no restitution can escape; the mass refusal no longer says "null"; two UI checks were added (Bennu's single 49 cm, the sample row's wording), 58 in all.
  - *Recorded, not changed*: the sidecars' sha256 for the Horizons text files and the NASA HTML pages cannot be reproduced by re-fetching (Horizons stamps each reply with the time it ran; the pages are dynamic); the PDFs can, and the derived `tag-recon.js` rebuilds byte-identically from a fresh fetch. The folder is now about 610 KB, over the 500 KB budget and under the 650 KB limit; the 11 KB added is this README.
- **Findings about the sources and earlier modules.**
  - **JPL Horizons' OSIRIS-REx trajectory switches segments during TAG.** The reconstructed descent (`od294-N_tag`) ends at 21:51:02.0-02.5 TDB; 70 s of a pre-TAG prediction (`od292-N-T1D-L-T1R1`, solution date 2020-10-19) follow, with a modelled contact and back-away, before the reconstruction resumes (`od295-R`, from 21:52:14). The joins jump 1.92 m and 6.54 m. Anyone reading Horizons across the contact gets 70 s of a plan, not a flight.
  - **The back-away speed is 70 cm/s in Berry et al. 2020 (AAS 20-088) and 40 cm/s in the later papers and NASA's release**; the reconstruction after it shows 36.6 cm/s relative to Bennu's centre. This page uses 40.
  - **The Matchpoint height is 55 m in May et al. 2014 and 50 m in Berry et al. 2020**; the reconstruction puts the spacecraft 58.2 m above this page's aim point at the Matchpoint burn.
  - **Idea 42's spacecraft cannot afford a touch-and-go.** Its tanks are sized to end the 90-day stay with zero propellant (idea 42's `mass.end_of_stay_kg` 487 = dry), and it has 103 g at the stand-off: this page's `propellant` refusal says so; idea 42's own `tankage` refusal is carried.
- **Findings about the source repo (Aster, `62ddb17`).**
  - **Aster's ΔV stack has no descent or contact term, and does not say what its allowance covers.** `src/v2/porkchop/delta-v.ts:5` (`STATIONKEEPING_DV_KMPS = 0.150`) is added to every mission at `:46`, one-way or sample return, then a 10% margin (`:6`). This page puts a touch-and-go from a nearby stand-off at under 1 m/s, so the flat 150 m/s covers it many times over; the gap is only that the stack does not state whether sampling is inside it. An observation, not a defect.
- **Gates not passed.** Aster's multi-agent math audit; oracle validation in Aster's own harness (the Horizons and published-figure checks here are this folder's fixtures); the founding-doc DEC process; the protected core (`src/v2/core/**`). This Idea Bank's independent review has been done once (below); nothing else has.

## Where it would land

- **Aster, the MCP server** (`mcp/src/tools/`). A `touchdown_plan` tool could return `descent`, `dispersion`, `propellant` and `surface_state` in the evidence envelope, refusing with `not_found` for every body without a shape (inheriting idea 43's `body_field` refusal) and `out_of_envelope` for a spacecraft that cannot afford it. The envelope would need `invalid_input`, as ideas 31 to 43 noted.
  - To ship: the multi-agent audit of the targeting and the covariance against this folder's Horizons legs and the mission's published tables, a DEC for which error model is canonical, and a refusal for any site with no hazard map.
- **Aster, `src/v2/porkchop/delta-v.ts`.** A sample-return mode could carry a proximity-operations line computed this way, with its refusals, beside the flat stationkeeping term (`:5`, `:46`).
- **The Long Way Round.**
  - Module 45 (Dig) takes `surface_state`: the weight, the hold-down cost per newton-hour, and the `anchors` and `regolith` refusals.
  - Module 50 chains it, with the propellant refusal carried to the end.
