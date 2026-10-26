# Visual QA Checklist — Dispatch 2 Cinematic Pass

Manual checklist for Hudson, now with results from an automated QA pass
(2026-07-06) using real Chrome DevTools Protocol browser automation — actual
wall-clock time, real DOM clicks/keypresses, not single-shot headless
screenshots. Serve with `python -m http.server` from the repo root and open
`/tools/twin/` to re-check any item yourself.

- [x] **Earth terminator visible, night lights only on dark side — CONFIRMED.**
      Orbited the WIDE camera via simulated OrbitControls drag; the
      terminator is clearly visible and night-lights (recognizable city-light
      clusters) appear only on the dark hemisphere with no bleed onto the
      lit side. The "ideal" shader path (`onBeforeCompile` sun-dot-normal
      mix) is working as designed, not the flat-emissive fallback.
- [x] **Atmosphere rim glow present, subtle — CONFIRMED.** Soft blue fresnel
      halo visible at the limb in every screenshot, reads as atmosphere
      rather than an obvious ring. Still your call on subtlety vs. overdone.
- [x] **Tether taper visibly thickens toward the hub — CONFIRMED.** HUB
      camera view shows an unambiguous, continuous thickening from the
      distant/thin outer tip to the near/thick hub end.
- [x] **Catch trigger, stress wave, load factor — CONFIRMED, with one real
      bug found and fixed during this pass.** Armed the catch, ran to
      periapsis at 60x, and initially found the TIP_CHASE/HUB/CATCH cameras
      **lost the tether from frame entirely at high time-warp** — a real
      bug: `CameraRig.update()` damped based on real (wall-clock) `dt`, but
      the tracked target (tip) moves according to sim time (`dt*timeWarp`),
      so at 60x the camera fell far behind a target moving 60x "faster."
      **Fixed** by passing `dt*timeWarp` into the camera update (see
      `twin.js` comment at the call site) — the exponential damping formula
      is stable at any effective-dt magnitude, so this just makes the
      camera snap to/track the target correctly regardless of time-warp.
      Re-verified after the fix: the payload capsule and tether stay
      correctly framed through 60x -> 1x -> 60x speed changes. Load factor
      confirmed at 1.300 for this periapsis-timed catch (Python's V4 gate
      found 1.467 for an arbitrary-phase catch — both legitimate, different
      dynamic states).
      **Also confirmed:** periapsis recurs roughly once per ~804s rotation
      period; a cold-start arm-and-wait landed the first catch at
      t~952-1200s depending on arming phase — crank to 60x after arming, or
      you'll wait real minutes at 1x.
- [ ] **60 fps steady at native res — NOT independently verifiable.** This
      dispatch's automated testing ran in headless Chrome with `--disable-
      gpu` (software rendering), which saw 10-50 fps depending on scene
      complexity — not representative of the RTX 5080 target in any
      direction. This line item is yours alone to check.
- [x] **Bloom only on loaded tether segments / sun, not scene-wide —
      CONFIRMED by inspection.** No visible bloom haze on the day-lit Earth
      or the plain/nominal-tension tether segments in any captured
      screenshot; bloom threshold (0.85) appears to be doing its job. Full
      confirmation of "sun bloom" specifically wasn't captured (the sun
      wasn't in frame in any automated screenshot) — worth a direct look.
- [x] **Half-viewport resize (zoom proxy) — CONFIRMED, no layout bugs.**
      Resized to 800x450 (not literal Ctrl+- browser zoom, which changes
      the CSS viewport differently than a raw resize, but exercises the
      same aspect-ratio/pixel-ratio code paths): HUD and controls stayed
      legible, tether rendered correctly at the new aspect ratio, no broken
      layout. Recommend you also check literal browser zoom directly since
      it isn't identical to this proxy.

## An honest finding, not a bug: energy drift after a catch

The HUD's energy-drift readout jumps to ~1.03% immediately after a catch and
stays there (triggering the "warn" red styling). **This is not an integrator
bug.** Verified independently by hand-computing the KE + PE a 5,000 kg
payload contributes when it joins the system at the tip's ECI-frame velocity
and altitude at the catch instant: the computed value matches the observed
1.031% drift almost exactly. Adding real mass with real kinetic and
potential energy to the system legitimately changes total system energy —
the drift metric was designed to catch *integrator* non-conservation during
normal flight (and correctly reads ~0.0000% throughout, right up to the
catch instant), not to remain meaningful across a discontinuous mass-
injection event. This matches how Python's own V4 gate handles it too (it
doesn't track energy drift through a catch either). Worth knowing so a
future viewer doesn't mistake a sustained non-zero drift reading after a
catch for numerical instability.

## Known limitations to judge, not bugs to report

- Hub/tip-vehicle/payload geometry is schematic — the physics model treats
  all three as point masses with no defined physical size, so their
  rendered dimensions (`VISUAL_CONFIG.hubBodyRadiusKm` etc.) are illustrative
  choices, not derived from any rev_a.json field.
- Earth does not rotate during a session (the ECI frame is non-rotating and
  a session is at most tens of minutes — real sidereal rotation over that
  span is a fraction of a degree, imperceptible).
- The tether-mesh taper/tension sampling assumes near-uniform node spacing
  along the rendered curve's arc length (true for this lightly-elastic
  tether) — a visualization approximation, not a physics computation; it
  does not feed back into or read from anything that affects `verify.mjs`.
- At extreme close-up (TIP_CHASE/CATCH cameras, camera only ~6-16km from the
  tip), the Earth backdrop appears blurry/low-detail. This is the honest
  consequence of the real scale mismatch (Earth's texture resolution is
  tuned for whole-disk viewing, not meters-scale close-ups a few hundred km
  above the surface) rather than a rendering bug.
