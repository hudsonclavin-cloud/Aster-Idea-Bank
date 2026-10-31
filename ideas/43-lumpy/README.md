# Lumpy
> Give the asteroid its real shape and read its gravity. Apophis's radar model and Bennu's laser-altimetry model are filled with uniform density, and the page gives exact polyhedron gravity anywhere, slopes and escape speeds on every plate, the points where spin and gravity balance, and which close orbits the lumps destroy. Against JPL's reconstruction of OSIRIS-REx in orbit 0.9 km from Bennu, 2-hour legs flown under the shape miss by a median 0.022 mm/s where a point mass misses by 0.252 mm/s, 5.3 m against 33.8 m after 40 hours. The field matches an independent implementation to 2e-10. The gap to reality is uniform density itself: Bennu's measured J2 is 3.7% above this model's (J3 14.6%, J4 3.4%), and Apophis's observed tumbling needs inertia ratios 0.61/0.965 where the radar shape filled evenly gives 0.730/0.947. On the chain, Apophis is 335.8 m across (2,025 kg/m³ at GM 2.68), its plates slope 14.7° on average, it spins too slowly for spin to matter, and the plate under idea 42's stand-off has 95.3 µm/s² of gravity (a point mass says 133) and a 7.1° slope.

**Kind:** explorable tool
**For:** Aster
**Run:** open `ideas/43-lumpy/index.html` in a browser (classic scripts, `file://` works, no network; it also opens on a `#h=` link carrying idea 42's or this page's handoff). Tests from the bank root: `node --test ideas/43-lumpy/lumpy.test.mjs` (14 tests, about 8 s; two run idea 42's own kernel and parser) and `node ideas/43-lumpy/ui-check.mjs` (66 checks in headless Chromium, about 50 s; `check.mjs` runs it for `tools/check.mjs`). Regeneration, none needed to run anything: `bash ideas/43-lumpy/oracle/fetch-sources.sh` in an empty directory, then in a throw-away venv with `spiceypy numpy` run `python3 ideas/43-lumpy/build_data.py <that directory>`, then `node ideas/43-lumpy/build-sample.mjs`, then with `polyhedral-gravity harmonica scipy` added run `python3 ideas/43-lumpy/oracle/oracle.py <that directory>`.
**Made by:** Mascon

## What it is

Idea 43 is module 13 of the twenty in *The Long Way Round* (ideas 31 to 50, launch to asteroid and back). Idea 42 flew the spacecraft to a stand-off 18.6 km from Apophis. It refused one thing it could not do (`gravity_field`): its asteroid was a point mass. This page replaces the point with the body's published shape.

- **Choose the body.** Either the chain (idea 42's handoff: Apophis, stand-off 11 July 2028), or **Bennu on 19 June 2019**, when OSIRIS-REx was in Orbital B about 0.9 km out. Bennu is the case where the model can be held to a real orbit.
- **Choose the mass.** For Apophis: idea 42's GM 2.68 m³/s², the ends of its 1.36 to 4.37 range, or a density. For Bennu: the particle-tracking GM or the spacecraft-tracking GM (Scheeres et al. 2020, Table 1), or a density.
- **Look at the shape.** Drag to turn it (by touch too, or the arrow keys). It is coloured by slope, the acceleration a grain feels, gravity alone, the height above the mean geopotential, or the escape speed straight up. **Tap a plate** to make it the site handed to module 44. The default site is the plate under idea 42's stand-off.
- **Read** GM and density, size and the Brillouin sphere, the surface gravity range, slopes, escape speeds, how wrong a point mass is, J2, the equilibria (or why there are none), and, for Bennu, the Orbital B test. Each number carries a confidence chip, and every refusal is shown, with the 10 carried from ideas 40 to 42.
- **Watch** six charts:
  - the coloured shape with its spin axis and the site;
  - the slope histogram;
  - how far the shape's gravity is from a point mass's against distance, beside idea 42's sunlight;
  - the equilibria on the equatorial cross-section;
  - a chosen orbit's track;
  - OSIRIS-REx's error against JPL's reconstruction, point mass against shape.
- **Fly close orbits.** Circular starts from just outside the Brillouin sphere to four times it, at the inclinations you tick, for as many days as you choose, under the shape's gravity as the body turns. Each ends as an impact, an escape, or survives; tap one to draw it.
- **Check it** against 11 rows of published and measured numbers, computed live.
- **Export the handoff** for module 44 (copy, download, link).

## Why I made it

- **The series needs it next.** `queue/SERIES_LONG_WAY_ROUND.md`, row 43: "The asteroid's gravity: a polyhedron gravity model from a real shape model, surface gravity and slope, orbits that the lumps make unstable", taking a shape model and density and handing on a gravity field. Idea 42's own refusal (`gravity_field`): "Gravity is a point mass: 99942 Apophis (2004 MN4)'s shape and spin are not in it, so orbits within a few radii are not right here. What would help: A shape model and density (module 43, Lumpy)." Idea 42's README, *Where it would land*: "Module 43 (Lumpy) takes `body` and `standoff_state` and replaces the point mass with a shape".
- **What a person decides with it.**
  - Where to touch down: which plates are flat against the real down (gravity and spin), how strong gravity is there, and how slow a bounce must be to stay.
  - How close an orbiter can fly, and in which direction: prograde orbits crash where retrograde ones survive.
  - Whether a gravity number is worth trusting: what the mass is pinned to, and where uniform density is known to be wrong.
- **For Aster.** Aster's ΔV stack and catalog treat every body as a point with a size from an assumed albedo (`src/v2/core/constants/asteroids.ts:9`, `ASTEROID_DEFAULT_ALBEDO = 0.14`). Its catalog has no shape, spin or density (BRIEFING §1: "No rotation period, no taxonomy/spectral class"). This is what a shape adds, for the two bodies whose shapes are public at NAIF.

Alternatives weighed.
1. *A triaxial ellipsoid from the PCK radii (closed-form gravity).* Rejected. It has no lumps, and Apophis's PCK radii are a placeholder built from a mean diameter and lightcurve axis ratios (its own comment says so).
2. *A mascon (sphere-packed) model.* Rejected as the model: its error near the surface is the very thing being studied.
3. *Spherical harmonics alone.* Rejected for the surface: the series diverges inside the Brillouin sphere, where landers live. Kept as an output (degree 4) for consumers that only need the field outside it.

**Built:** the exact constant-density polyhedron of Werner and Scheeres (1997), which is valid on and inside the surface, tested against Tsoulis's independent line-integral formulation. Shapes were looked for at the PDS Small Bodies Node (unreachable from this session's proxy), JPL's radar group (no Apophis or Bennu) and NAIF, which serves both the Apophis radar DSK and the Bennu altimetry DSKs that OSIRIS-REx and OSIRIS-APEX fly with.

## How it works

**The shapes** (`build_data.py`, `snapshots/shapes.js`).
- *Apophis:* NAIF's `apophis_g_25000mm_rad_obj_0000n00000_v001.bds`, the Brozović et al. (2018) radar model delivered for OSIRIS-APEX (`orx_shape_v04.tf`). It has 2,000 vertices and 3,996 plates about 25 m across, in the `APOPHIS_CK` frame. It is unchanged: the kilometre values have 6 decimals, so integer millimetres are exact (asserted).
- *Bennu:* NAIF's `bennu_g_12600mm_alt_obj_0000n00000_v021.bds`, OSIRIS-REx laser altimetry v021 at 12.6 m (Daly et al. 2020), in `IAU_BENNU`. It is an ICQ grid of 6 × 33 × 33 vertices (asserted from the counts and the first plates). Every second grid vertex is kept, welded at the cube edges and triangulated as the DSK triangulates. That gives 1,538 vertices and 3,072 plates (25 m), rounded to 1 mm.
- Both are stored as little-endian base64 (int32 mm, uint16 indices).
- On load each is checked closed and wound outward: every directed edge appears once and its reverse once, and the volume is positive. A broken mesh is refused, not computed.
- The origin is moved to the uniform-density centre of mass: 5.16 m from the DSK origin at Apophis, 1.31 m at Bennu. The setting `centre: 'dsk'` keeps the DSK's origin.

**Mass properties** (`massProps()`). Signed tetrahedra from the origin give the volume, the centroid and the second moments (the closed form per tetrahedron). The inertia's principal axes come from cyclic Jacobi rotations. The density is GM / (G V), with G from NIST via idea 42's `approach-sources.js`.

**The field** (`fieldRaw()`, Werner and Scheeres 1997).
- The potential is U = Gρ/2 [Σ_edges r_e·E_e·r_e L_e − Σ_plates r_f·F_f·r_f ω_f], with L_e = ln((r₁+r₂+e)/(r₁+r₂−e)) and ω_f the plate's signed solid angle by the van Oosterom-Strackee formula.
- Gravity is −Gρ Σ E_e r_e L_e + Gρ Σ F_f r_f ω_f.
- The Hessian is Gρ Σ E_e L_e − Gρ Σ F_f ω_f, and the Laplacian −Gρ Σ ω_f. So Σ ω_f is 4π inside and 0 outside: the impact test costs nothing extra.
- U is positive (GM/r far away). One evaluation over ~4,000 plates takes about 0.25 ms in V8.
- Known here from the paper's equations as widely restated, and checked against an independent code (below).

**Harmonics** (`harmonics()`). The exterior Stokes coefficients are volume integrals of the solid harmonics r^n P_nm e^{imλ}, a polynomial of degree n.
- They are integrated exactly over every signed tetrahedron with the Grundmann-Möller (1978) simplex rule of degree 5 (15 points).
- Fully normalised, without the Condon-Shortley phase (the geodesy convention Scheeres et al. use); J_n = −C̄_n0.
- They are handed on to degree 4 about the centre of mass with R₀ = the Brillouin radius, and valid only outside that sphere.

**Spin.**
- *Bennu:* `bennu_v17.tpc`, pole RA 85.45864°, Dec −60.36468°, W = 150.48977 + 2011.143058731885 d + 2.0e-6 d² degrees (d in TDB days past J2000), giving C = R3(W) R1(90° − δ) R3(90° + α).
- *Apophis tumbles.* NAIF's `apophis_npa_220101_330101_nominal_pravec_v1.bc` stores the attitude every 900.0000855 s. Its comment lists Pravec et al. (2014)'s solution: I₁/I₃ 0.61, I₂/I₃ 0.965, angular momentum RA 118.790629°, Dec −79.408659°.
- The build keeps one CK sample every 20 days, 2026-01-01 to the 2029 Earth encounter (60 samples).
- **The CK's segments are relative to ECLIPJ2000** (frame 17), so each C-matrix is turned into J2000 with SPICE's `pxform` before storing.
- The kernel flies Euler's equations, I ω̇ = (I ω) × ω and dC/dt = −[ω×] C, from the nearest sample with idea 40's integrator at rtol 1e-12.
- After 2029-04-13 21:45:03.515 UTC (the encounter epoch named in NAIF's other Apophis CK) the page refuses: the spin is unknown.

**The surface** (`surface()`). At each plate's centroid:
- **gravity** g;
- **the acceleration a grain at rest feels**, a = g − ω×(ω×r) − ω̇×r;
- **slope** = angle between the inward normal and a (over 90° the ground overhangs its own down);
- **geopotential** Φ = −U − ½|ω×r|², and **height** = (Φ − its area mean) / |a|;
- **escape speeds** from energy in a non-rotating field: √(2U) inertially; straight up relative to the surface (solving ½|v n + ω×r|² = U); and along the spin, √(2U) − |ω×r|.

Statistics are area-weighted, with the area-weighted median. The site is the plate the ray from the centre to idea 42's stand-off (in body axes at its epoch) leaves through: the outermost crossing.

**Equilibria** (`equilibria()`, principal-axis rotators only). Newton's method on ∇U + ω²(x, y, 0) = 0, from 24 starts on the synchronous radius (GM/ω²)^{1/3}, keeping points outside the body.
- **Stability:** det(λ² I + 2λ [Ω×] − H_eff) is a cubic in λ². It is fitted exactly through four values, solved by Durand-Kerner, and each root classed as oscillatory, real (a saddle) or complex (a quartet: an unstable centre).
- **The rotational Roche lobe:** surface whose Φ lies below the lowest equilibrium's energy.
- A tumbler is refused: no frame turns with it at a constant rate.

**Close orbits** (`orbitOne()`, `orbitScan()`).
- Each start is circular at √(GM/r) on the node of the spin equator (the angular momentum's for Apophis), at the chosen inclination.
- It is flown in ICRF axes about the centre of mass with the body turning: Bennu by the PCK; Apophis by integrating Euler's equations alongside, 18 states in idea 40's Dormand-Prince at rtol 1e-9.
- Checked 24 times per orbit for an impact (inside the shape by the solid angle) or an escape (unbound beyond max(4 Brillouin radii, 3r), or beyond the Hill radius if that is nearer).
- Radii run from 1.05 to 4 Brillouin radii. A radius where idea 42's sunlight passes 5% of gravity is refused (`scan`): sunlight and the Sun's tide are idea 42's to fly, and are left out here. Under a point mass every start would last forever, so every impact and escape is the lumps' doing.

**The test in flight: OSIRIS-REx in Orbital B** (`orbitB()`). JPL Horizons' reconstruction (`-64` relative to `2101955`, source `ORX_merged`, ICRF) every 2 h from 2019-06-19 00:00 TDB.
- Each of 20 legs is flown from the reconstructed state, and the arc of 40 h from the first, under a point mass or the shape.
- Both add idea 42's sunlight (flat absorber, OSIRIS-APEX's 81.119 kg/m²) and the Sun's tide. These come from idea 42's own `accel()`, evaluated at build time along the reconstruction (`snapshots/orbit-b-sunlight.js`) and interpolated in time; the tests show the table reproduces 42's kernel to 0.05 m.
- The leg from 40 to 42 h is excluded: the reconstruction has an impulse there (0.18 mm/s against a typical 0.02), a momentum dump or an arc boundary, visible as a step in both models' errors.

**Reusing earlier modules.**
- Idea 40's integrator: `inv3()`, the Dormand-Prince tableau and `dopri()`, excerpted verbatim. Lines 77-82 and 106-146 of `coast.js` are copied by `build-sample.mjs`, and the test proves each block is a substring of the committed file. That carries 4 KB of idea 40 instead of 87.
- Idea 42's NIST G and Aster's TDB−UTC (`approach-sources.js`, `aster-constants.js`, byte-identical).
- Idea 42's sunlight model, as the table above.
- Idea 42's committed handoff, wrapped for the stand-alone page.

**Importing idea 42's handoff** (`importClosing()`). It is checked for consistency, not re-flown (idea 42's kernels and data are 330 KB):
- surface gravity = GM/R², escape speed = √(2GM/R), density = GM/(G 4/3 π R³);
- the Hill radius = d (GM/3μ☉)^{1/3}, and the Sun distance = |asteroid heliocentric r|;
- the stand-off range = |r|, and gravity there = GM/r²;
- UTC matches TDB, and GM lies inside its range;
- idea 42's own `gravity_field` refusal is present.

The tests run idea 42's own `parseHandoff` on its committed sample. Idea 41's handoff is refused with a pointer to idea 42.

**Handoff schema (version 1, `from: "43-lumpy"`).** `handoff.json` is the sample: idea 42's committed handoff with this page's defaults (59 KB).

| inputs | |
|---|---|
| `closing_handoff` | idea 42's handoff, whole (and through it 41's, 40's and 39's), or `null` |
| `case` | `null`, or `"bennu2019"` for the stand-alone Bennu case |
| `settings` | `{gm, density_kg_m3, centre, scan, scanDays, scanRadii, scanIncl, site, orbitB}` |

| outputs | units | confidence |
|---|---|---|
| `body` `{designation, name, shape_model, shape_reference, shape_dsk, shape_dsk_sha256, plates, vertices, frame, volume_m3, equivalent_radius_m, area_m2, brillouin_radius_m, uniform_com_in_dsk_frame_m, GM_m3_s2, GM_source, GM_confidence, density_kg_m3, G_m3_kg_s2, inertia_ratios_uniform, inertia_ratios_dynamical, hill_radius_m}` | m, m³, m², m³/s², kg/m³ | measured (Bennu) or assumed |
| `spin` `{kind, epoch_tdb_s, epoch_utc, C_icrf_to_body, omega_body_rad_s, period_h, pole_or_angular_momentum_icrf, model}` | rad/s, h | derived |
| `field` `{model, origin, harmonics {R0_m, nmax 4, C, S, J, valid_outside_m, normalisation}, point_mass_error_at[]}` | m, – | derived |
| `surface` `{epoch_tdb_s, gravity_m_s2, accel_m_s2, slope_deg, height_m, escape_up_m_s, escape_min_m_s (each {mean, median, min, max}), area_fraction_steeper_30deg, ..._40deg, ..._over_90deg, slope_hist_5deg, roche_lobe_area_fraction}` | m/s², deg, m, m/s | derived |
| `equilibria` `{synchronous_radius_m, roche_energy_J_kg, points[{body_m, r_m, lon_deg, energy_J_kg, type, stable, efold_h, periods_h}]}` or null (refused) | m, J/kg, h | derived |
| `site` `{face, body_fixed_m, lat_deg, lon_deg, radius_m, normal_body, gravity_body_m_s2, gravity_m_s2, accel_m_s2, slope_deg, height_m, escape_up_m_s, escape_min_m_s, escape_inertial_m_s, plate_area_m2, point_mass_gravity_m_s2, epoch_tdb_s}` | m, m/s², deg, m/s | derived |
| `orbits` `{days, inclinations_deg, radii_m, refused_radii_m, rows[{r_m, inc_deg, outcome, t_days, rmin_m, rmax_m}]}` or null | m, deg, days | derived |
| `orbit_b` `{GM_m3_s2, legs, sunlight, point_mass {...}, polyhedron {leg_dv_median_m_s, leg_dv_max_m_s, leg_dr_median_m, arc_end_m, arc_max_m}}` or null | m, m/s | measured |

**Refusals.** Ideas 40 to 42's are carried with their `from`; this module's own have none:
- always: `density` (uniform density, with Bennu's measured gaps) and `resolution` (25 m plates);
- Apophis: `inertia` (the uniform shape cannot tumble as observed) and `equilibria` (`out_of_envelope`: a tumbler has none);
- `spin` (`out_of_envelope`) after the 2029 encounter or before the samples;
- `shape` (`not_found`) for any body but these two (Ryugu, Didymos, Eros, 2000 SG344 from idea 41's presets);
- `body_mass` (Apophis has no measured mass);
- `scan` when sunlight passes 5% of gravity, or when no spacecraft is given;
- `invalid_input` for bad settings or meshes.

**Reading one back** (`parseHandoff`): idea 42's inside is checked as above, then everything is recomputed and compared to 1e-6 relative, along with the refusal codes.

**For module 44** (Touch and Go): `site` (where to land, its gravity vector, slope and escape speeds), `body` and `spin` (to turn the field with the body), and the kernel `fieldRaw()` with `snapshots/shapes.js` to fly descent under the exact field. The harmonics serve only outside the Brillouin sphere.

## Tests

`lumpy.test.mjs`, 14 tests, Node built-ins, about 8 s:

- **Snapshots.** Every sidecar's sha256 matches its file. `approach-sources.js` and `aster-constants.js` are idea 42's committed files byte for byte. The integrator excerpt's two blocks are lines 77-82 and 106-146 of idea 40's `coast.js`, verbatim. The wrapped sample is idea 42's committed `handoff.json`.
- **Shapes and mass properties.**
  - Counts as published (2,000/3,996; 1,538/3,072), Euler characteristic 2.
  - Volume, area and centroid equal the oracle's numpy values to 1e-12.
  - Bennu's 12,288-plate DSK volume is 0.061242 km³ against Barnouin et al. 2019's 0.0615 ± 0.0001 (−0.42%; a different model, SPC v20).
  - Bennu's density from the particle GM is 1,200.45 kg/m³, inside Barnouin's 1,190 ± 13.
  - The centre-of-figure offset sits within 0.35 m of Barnouin's [1.38, −0.43, −0.12] (0.16 m short in x).
  - Apophis's volume-equivalent diameter is 335.80 m; its uniform inertia ratios are 0.73044 and 0.94743.
  - An open mesh and an inside-out tetrahedron are refused.
- **The field against an independent implementation.** The oracle is `polyhedral-gravity` 3.3.1 (Schuhmacher et al. 2024, JOSS: Tsoulis and Petrović's line-integral formulation in C++). It is evaluated at 80 points per body: on axes at 1.02 to 10 Brillouin radii, random exterior points, interior points, and plate centroids on the surface.
  - Potential within 1e-10, gravity within 1e-9; the worst relative difference is 2.2e-10.
  - The Hessian within 1e-7 nearby and 5e-6 beyond three Brillouin radii, where the oracle itself warns of lost digits. Here, central differences of this kernel's own gravity confirm its Hessian to 1e-7.
  - The Hessian is not compared on the surface, where it jumps (the Laplacian is −4πGρ inside and 0 outside).
- **Closed forms.**
  - A 200 × 100 × 50 m box matches harmonica's closed-form prism (Nagy et al. 2000) to 1e-12 in potential and gravity at five points.
  - Poisson inside and Laplace outside from the Hessian's trace; the solid angle is 4π inside and 0 outside.
  - The far field approaches GM/r² as (R/r)².
  - A subdivided icosahedron has gravity within 1% of GM/r² and slopes under 2°.
- **Harmonics.**
  - The simplex rule integrates x^a y^b z^c over the unit tetrahedron exactly (a!b!c!/(a+b+c+3)!) to degree 5, and not at degree 6.
  - Bennu's C̄_nm and S̄_nm to degree 4 match the oracle's (Gauss-Legendre quadrature of the independent potential on a sphere) to 2e-7.
  - C̄20 and C̄22 equal the inertia closed forms to 1e-14.
  - The degree-4 expansion meets the polyhedron to 2e-4 at 2 Brillouin radii, better at 4.
- **Bennu against Scheeres et al. 2020, Table 1** (R₀ = 290 m, DSK origin).
  - This subsample's J2 is 0.018488; the full DSK's (oracle) is 0.018565, 1.0% below Scheeres's own constant-density 0.01875791 on the SPC v42 shape (J3 +1.0%, J4 −2.4%).
  - Reality: the particle-tracking J2 0.01926101 is 3.75% above the full DSK's uniform value (J3 14.6%, J4 3.4%).
  - The subsample costs 0.42% in J2, and at most 0.30% in gravity at 1.05 × 290 m (oracle: full DSK against shipped).
- **Spin.**
  - Bennu's C matches SPICE `pxform` to 2e-10 at three epochs.
  - `q2m` matches SPICE's to 5e-14.
  - Apophis integrated from a stored sample matches the CK's own samples (SPICE `ckgpav` at the samples' own ticks, which equal `pxform` there to 1e-12): 0.21″ after 1 day, 0.57″ after 5, 0.96″ after 10, 0.75″ 10 days back; spin vectors within 5e-6.
  - The angular momentum points at RA 118.79063°, Dec −79.40866°, as the CK comment states.
  - L/I₃ is 0.2041986 rad/h against the comment's 0.20419588 (1.3e-5).
  - After the encounter and before the samples: refused.
- **The surface.**
  - Bennu's area statistics (DSK origin) equal the oracle's independent run to 1e-6.
  - The mean slope is 14.17° on 25 m plates and 15.80° on the 12.6 m DSK, against Barnouin's 17 ± 2° on 3 m plates.
  - The largest acceleration with spin is 8.064e-5 m/s² against Barnouin's 0.000080 (+0.8%).
  - Barnouin's area mean (0.0000595) is not reproduced: 0.0000553, −7.1%.
- **Equilibria.**
  - Bennu's 8 points (4 saddles, 4 centres) match the oracle's Newton on the independent field to 1 cm.
  - Their growth rates match numpy's eigenvalues of the 6 × 6 linearisation to 1e-5.
  - None is stable. The synchronous radius is (GM/ω²)^{1/3} = 309.44 m, and 47.05% of the surface lies inside the Roche lobe.
  - A point mass's circular orbit gives λ² = 0, −ω², −ω², as it must.
  - Apophis is refused.
- **Orbits.**
  - The Jacobi integral holds to 3e-7 over 6 h about spinning Bennu.
  - A 1-day scan pins its outcomes (all starts at 302 m crash; 589 m and 1,149 m survive).
  - The chain's scan plan refuses no radius (sunlight is 5% of gravity at 1,314 m, beyond 4 Brillouin radii); stronger sunlight refuses the outer ones.
- **Reality, Orbital B.** The page's sunlight table equals idea 42's `accel()` at every row, and flying with 42's kernel directly gives the same legs to 1e-7 m/s. Pinned:
  - spacecraft-field GM: legs 0.0223 mm/s (shape) against 0.2521 (point mass); 40-h arc 5.34 m against 33.77 m;
  - particle-field GM: 0.0427 against 0.2655 mm/s; arc 13.70 m against 14.70 m;
  - without sunlight the shape's legs are 0.2480 mm/s;
  - the 40-42 h leg misses by more than 5 times the worst clean leg.
- **The chain.**
  - Idea 42's committed handoff passes idea 42's own `parseHandoff` and this import.
  - Pinned defaults: density 2,025.344, instantaneous period 29.955 h, gravity 81.637 to 95.781 µm/s², mean slope 14.723°, 4.838% steeper than 30°.
  - Site plate 346 at 46.645°/−126.669°, slope 7.126°, escape straight up 18.554 cm/s; the stand-off ray really crosses plate 346.
  - Own refusals exactly `density`, `inertia`, `equilibria`, `resolution`; 10 carried.
  - The point-mass error is 6.79% at the Brillouin sphere and 1.03% at four times it.
- **Refusals the inputs raise.**
  - Bad GM mode, density 100, plate 99,999: `invalid_input`. A measured mass for Apophis: `body_mass`.
  - Low and high GM scale gravity exactly. Density mode gives GM = GρV.
  - After the encounter: `spin`. Ryugu: `not_found`.
  - Editing idea 42's GM, radius, stand-off, surface gravity alone or stand-off gravity alone, or dropping its refusal, is refused. Idea 41's handoff points to idea 42; garbage is refused.
- **The handoff.** The sample is exactly what its inputs give. Every output has units, a confidence and a source. A round trip passes, for Bennu too. An edited slope, density or refusal is refused.

**Teeth.** I made 25 sabotages of `lumpy.js`, each alone, in a scratch copy of the bank. **All 25 were caught, each by at least one test other than the sample regression** (test 14, which catches any change in outputs and so proves nothing on its own). The first run caught 24: "the import skips the GM/R² check" was caught by none, because the edit tests changed GM or radius, which other checks also catch. A test that edits only the handed-on surface gravity now catches it. Failing tests in brackets:

| Sabotage | Failing tests |
|---|---|
| Solid angle without its factor 2 | 3, 4, 5, 8, 9, 10, 11, 12, 14 |
| Edge term's sign in x | 3, 4, 8, 9, 10, 11, 12, 14 |
| Edge normal pointing inward | 3, 4, 8, 9, 10, 11, 12, 14 |
| Centroid over 12, not 24 | 2, 4, 5, 9, 10, 11, 12, 14 |
| Potential without its ½ | 3, 4, 5, 9, 10, 12, 14 |
| Density 2% off | 2, 4, 8, 9, 11, 12, 14 |
| Origin left at the DSK centre | 4, 5, 9, 10, 11, 12, 14 |
| Bennu pole RA with the wrong sign | 7, 11, 14 |
| Euler equations' torque term reversed | 7, 12, 14 |
| Attitude kinematics sign | 7, 12, 14 |
| Apophis spin from the first sample only | 7, 12, 14 |
| Centrifugal pull inward | 8, 12, 14 |
| Slope against the outward normal | 8, 12, 14 |
| Normalisation with 2n for 2n+1 | 5, 6, 14 |
| Legendre recurrence (n+m) for (n+m−1) | 5, 6, 14 |
| Second moments over 60, not 120 | 2, 5 |
| q2m sign | 7, 14 |
| Equilibrium Jacobian without the spin | 9, 14 |
| Site: the innermost crossing | 12, 14 |
| Import skips the GM/R² check | 13 |
| Simplex rule weight 2^−s | 5 |
| Coriolis halved in the stability test | 9 |
| Sunlight table interpolated backwards | 11 |
| No impacts (inside test never true) | 10 |
| Scan out to 3, not 4, Brillouin radii | 10 |

Writing the tests caught three of my own errors:
- the ECLIPJ2000 frame of the CK (below);
- a hand-guessed synchronous radius (309.83 m, not the 309.44 the formula gives);
- a point-mass error I had not measured (I had written 3.4%; it is 6.8%).

`ui-check.mjs`, 66 checks in headless Chromium:
- the tiles equal the kernel's (GM, density, size, mean slope, point-mass error), with the right confidence chips;
- the site box and its escape speed; the four own refusals and ten carried; 11 check rows with no NaN;
- the shape drawn, turned by the arrow keys and by dragging, and a tap that picks a plate whose slope is the kernel's; the site reset; colour by escape speed;
- density mode recomputes GM; density 100 is refused with no tiles;
- a 2-orbit scan whose outcomes are the kernel's, with a tapped orbit drawn;
- the download parses in the kernel, with and without the scan;
- Bennu: 8 equilibria, the Orbital B tile, charts drawn, the spacecraft GM;
- imports of idea 42's handoff and this page's; garbage, idea 41's and an edited handoff refused;
- `#h=` links with idea 42's and this page's handoffs;
- at 390 px in dark and light: no overflow, no text under 11 px, the right background, charts drawn, a tap picks a plate, no NaN, no console errors.

`node tools/check.mjs ideas/43-lumpy` passes (README, sidecars, tests, `check.mjs`, smoke at 1280 and 390 px), with a size warning (below).

## Honest assessment

- **[Certain as measured] The field is the polyhedron's.**
  - It agrees with an independent formulation to 2e-10 in potential and gravity, and with a closed-form prism to 1e-12.
  - Its harmonics agree with the independent code's to 2e-7, and with the inertia closed form to 1e-14.
  - What that proves: the kernel computes the gravity of a uniform solid of this shape. It does not prove the asteroid is uniform.
- **[Certain as measured] The lumps are real in flight.**
  - OSIRIS-REx's reconstructed Orbital B, flown in 2-h legs, is matched 11 times better by the shape than by a point mass (0.022 against 0.252 mm/s, spacecraft-field GM; 6 times with the particle-field GM).
  - Without sunlight the shape's legs miss by 0.248 mm/s: at 0.9 km, sunlight and the lumps matter about equally, and this is idea 42's sunlight model, not the navigation team's.
  - Over 40 h the shape stays within 5.3 m (spacecraft GM) or 13.7 m (particle GM). The arc depends on which published GM one takes, the legs hardly.
- **[Certain as measured] Uniform density is the gap to reality.**
  - At Bennu the particle-tracking field's J2 is 3.7% larger than this shape's uniform J2 (J3 14.6%, J4 3.4%). Scheeres et al. 2020 measure the same direction against their own shape (2.7%, 15.8%, 0.9%) and read it as an under-dense centre and equator.
  - They report surface gravity off by up to ±3% and slopes by ±1° from this cause. And their measured field makes every centre equilibrium unstable, where their uniform model had one stable.
  - This model has none stable even at uniform density: a different shape model and density (1,200 against 1,190 kg/m³). I have not separated the two causes [Likely: shape model].
  - At Apophis the radar shape filled evenly gives inertia ratios 0.730/0.947, where Pravec et al.'s tumbling solution needs 0.61/0.965 (+20% in I₁/I₃). Either the density is far from uniform or the shape is off. Every number beyond GM carries that doubt (refused as `inertia`).
- **[Certain as numbers; Likely as physics] Apophis on the chain.**
  - 335.8 m across (SBDB 340 m, −1.2%), so at idea 42's GM 2.68 its density is 2,025 kg/m³, not the 1,951 idea 42 got from a 170 m sphere.
  - Surface gravity 81.6 to 95.8 µm/s². Spin hardly matters: the instantaneous period is about 30 h, and the spin changes the acceleration a grain feels by under 0.9% on any plate.
  - Slopes average 14.7°, and 4.8% of the area is steeper than 30°.
  - Escape straight up takes 15.8 to 19.2 cm/s.
  - A point mass is 6.8% wrong at the Brillouin sphere along the long axis, 3.2% at twice it, 1.0% at four times.
  - The plate under idea 42's stand-off (46.6°N, 126.7°W in the radar model's frame) has 95.3 µm/s² of gravity, where a point mass at its radius says 133.2: inside the Brillouin sphere a point mass overstates the pull by 40%.
- **[Likely] Close orbits.**
  - In 3 days, circular starts just outside the Brillouin sphere crash at both bodies, and prograde orbits crash further out than polar or retrograde ones. Apophis: the 287 m prograde orbit hits in 2.4 days while the polar and retrograde ones survive. Bennu: the 365 m prograde orbit hits in 2.3 hours, polar and retrograde survive. From 1.5 Brillouin radii out everything survives 3 days.
  - The prograde/retrograde asymmetry is the known result for orbits close to rotating small bodies.
  - The scan's starts are circular for a point mass, so near the body they are really eccentric, and 3 days is short. It says which orbits fail fast, not which last.
- **What is rough or cut.**
  - *Uniform density only.* No layered or heterogeneous interior, no fit to a measured field (Scheeres's degree-9 particle field would be the next step at Bennu).
  - *25 m plates.* Slopes and gravity under a lander's footprint are not resolved. Bennu's slopes come out smoother than at 3 m (14.2° against 17°).
  - *Two bodies.* PDS's Small Bodies Node, which holds the Brozović Apophis bundle (2026), Ryugu and others, was unreachable from this session's proxy. The radar shapes at JPL do not include Apophis or Bennu. Everything else is refused as `not_found`.
  - *Bennu's mean acceleration.* Barnouin et al. 2019's area-weighted mean (0.0000595 m/s²) is 7% above this model's and the full DSK's (0.0000553). Their range begins at a negative "−0.000058", which no definition I tried reproduces. I do not know their exact quantity [Speculative].
  - *The orbit scan flies gravity alone.* Sunlight and the tide are idea 42's; where they pass 5% the radius is refused, and on the chain they never do inside 4 Brillouin radii.
  - *Spin.* Apophis after the 2029 encounter is refused. Bennu's YORP term is in the PCK, but its spin state is taken as exact.
  - *The site* is the plate under the stand-off, or one you tap. No landing-site selection logic (that is module 44's).
  - *Size.* 570 KB as the checker counts: over the 500 KB budget, under the 650 KB limit. The two shapes are 115 KB. Idea 42's sample appears twice (the page's stand-alone case, and inside `handoff.json`), 108 KB. Idea 40's integrator was excerpted to 4 KB instead of carried whole (87 KB) to stay under the limit.
- **Findings about the source repo (Aster, `62ddb17`).**
  - **No body in Aster has a shape, spin or density.** The catalog fixture (`tests/fixtures/v2/nea-catalog-slice9.json`) carries a radius from an assumed albedo (`src/v2/core/constants/asteroids.ts:9`) and no rotation (BRIEFING §1). NAIF already serves public shapes and spins for Apophis and Bennu. Aster's K3 spin-barrier hint (`strategy/IDEA_KERNELS_2026-09.md`), which "needs rotation periods the catalog lacks", could start from the PCK and CK used here for these two.
  - **A point mass is not a surface gravity.** Anything Aster derives at the surface from GM/R² is 40% high at the Apophis plate under idea 42's stand-off (95.3 against 133.2 µm/s²), because the radius there is inside the Brillouin sphere.
- **Findings about the sources and earlier modules.**
  - **NAIF's Apophis CK segments are relative to ECLIPJ2000 (frame 17), not J2000.** Read raw, the quaternions put the angular momentum at RA 250°, Dec −75°: exactly the ecliptic longitude and latitude in the CK comment. I made that mistake, and the test pinned to the comment's J2000 values caught it.
  - The CK's samples sit 900.0000855 s apart in a millisecond SCLK, so their ticks are fractional. Rounding them to whole ticks moves the attitude by 3e-8 rad.
  - `polyhedral-gravity` 3.3.1's mesh-orientation check flags hundreds of plates of NAIF's untouched Apophis and Bennu DSKs as inward. This folder's own check (directed edges, volume, ray parity) finds none; the library's check was disabled for the oracle. Its gravity tensor also loses about 2e-6 at four Brillouin radii, where it warns.
  - Barnouin et al. 2019 Table 1's "Gravitational acceleration −0.000058 to 0.000080 m/s²" has a negative lower bound with no stated sign convention.
  - Idea 42's `body.radius_m` (170 m, from SBDB's diameter) gives a density 3.7% below the shape's (1,951 against 2,025 kg/m³); idea 42 flies a point mass, so its results stand.
  - JPL's reconstruction of OSIRIS-REx has an impulse between 2019-06-20 16:00 and 18:00 TDB (0.18 mm/s), presumably a momentum dump. It is not in this folder's sources by name [Speculative as to cause].
- **Gates not passed.** Aster's multi-agent math audit; oracle validation in Aster's own harness (the polyhedral-gravity, harmonica, SPICE and Horizons oracles here are this folder's fixtures); the founding-doc DEC process; the protected core (`src/v2/core/**`). This Idea Bank's independent review has not been done yet.

## Where it would land

- **Aster, a body page or the MCP server** (`mcp/src/tools/`). A `body_field` tool could return `body`, `spin`, `surface` and `site` in the evidence envelope. Its refusals would be `not_found` for every body without a published shape, and `insufficient_data` for density. The envelope would need `invalid_input`, as ideas 31 to 42 noted.
  - To ship: shapes fetched from PDS or NAIF at build time with their hashes, the multi-agent audit of the polyhedron kernel against this folder's oracles, and a DEC for which shape models are canonical.
- **Aster, `src/v2/core/constants/asteroids.ts`.** Where a shape exists, the volume-equivalent radius and the spin should come from it (Apophis 335.8 m; Bennu's PCK), with the albedo default only as a labelled fallback.
- **The Long Way Round.**
  - Module 44 (Touch and Go) takes `site`, `body`, `spin` and the kernel's `fieldRaw()` to fly descent and contact in the exact field.
  - Module 45 (Dig) takes the site's gravity and escape speeds: digging must not throw regolith off at 15 to 19 cm/s.
  - Module 50 chains it, with the uniform-density refusal carried to the end.
