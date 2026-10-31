# The Long Way Round: launch to asteroid and back, in twenty working modules

The owner asked (2026-10-31): *"focus on actual interactable things that could be applied, like mixtures … create an actual simulation of the launch process of any rocket, understanding the intricacies of everything to the point where you return with the asteroid … add 20 more things … sequentially."*

So ideas **31–50** are one chain. Each is a working, interactive module that a person can use on its own for real analysis, *and* a link: it accepts the previous module's result and hands its own to the next. Idea 50 runs the whole chain: pick a rocket and a propellant, pick a near-Earth asteroid, and fly launch → orbit → departure → cruise → rendezvous → mining → refuelling → return → re-entry with every number traceable. They are built one at a time, in order, and each may reuse what the earlier ones built.

This brief adds to `BUILDER_BRIEF.md` (read it first; it still binds you) and overrides it where it says so.

## The twenty modules

| No. | Name | What it simulates | Takes | Hands on |
|---|---|---|---|---|
| 31 | Mixture | Propellant combustion: chemical-equilibrium chamber state by Gibbs-energy minimisation for real bipropellant pairs, against mixture ratio and chamber pressure | propellant pair, O/F, Pc | chamber state (Tc, molar mass, γ, c\*, composition, propellant densities) |
| 32 | Bell | Nozzle flow: isentropic expansion (frozen and, via 31, shifting), area ratio, thrust coefficient against ambient pressure, over/under-expansion and flow separation, a bell contour | chamber state | nozzle (ε, CF(pa), Isp(pa), throat and exit size for a thrust) |
| 33 | Engine Deck | A whole engine: thrust and Isp against altitude and throttle, mass flows, and the pump-fed cycle power balance (gas generator, staged combustion, expander) with real engines as presets compared to their published figures | chamber + nozzle | engine deck |
| 34 | Stack | A rocket: stages, engines, propellant loads, tank volumes from the propellant densities, dry masses, payload; staged Δv; real vehicles as presets with sourced masses | engine decks | vehicle |
| 35 | Max Q | Ascent through the atmosphere: 1976 standard atmosphere, drag against Mach, gravity turn over a rotating round Earth, throttle bucket, staging; gravity, drag and steering losses | vehicle | burnout / insertion state |
| 36 | Closed Loop | Ascent guidance to a target orbit (linear-tangent / powered explicit guidance) against open-loop pitch programmes, with Monte Carlo dispersions | vehicle + target orbit | parking orbit achieved, with its scatter |
| 37 | Window | Launch site to parking orbit to departure asymptote: azimuth, inclination, node timing, the daily window that lines the orbit up with the departure direction (RLA/DLA), J2 regression over the coast | parking orbit + asymptote | departure geometry |
| 38 | Burn Out | The Earth-departure burn as a finite burn: gravity loss against thrust-to-weight, perigee burns, comparison with the impulsive Δv from C3 | parking orbit + engine + C3 | hyperbolic departure state |
| 39 | Lambert's Road | Heliocentric transfer to a real near-Earth asteroid from Aster's catalog: Lambert solutions, a porkchop, the chosen window | departure date range + target | transfer (v∞ out, v∞ in, dates) |
| 40 | Long Coast | Cruise: propagate the transfer with the Sun and planets, trajectory-correction manoeuvres, and how navigation uncertainty grows and is cut back | transfer | arrival state + TCM budget |
| 41 | Signal | Talking to the spacecraft all mission: Earth range, one-way light time, a deep-space link budget and data rate, solar-conjunction blackouts | trajectory | comms timeline |
| 42 | Closing In | Arrival at the asteroid: braking, approach, relative motion near a small body, its Hill sphere, station-keeping at stand-off | arrival state + asteroid | spacecraft at stand-off |
| 43 | Lumpy | The asteroid's gravity: a polyhedron gravity model from a real shape model, surface gravity and slope, orbits that the lumps make unstable | shape model + density | gravity field |
| 44 | Touch and Go | Descent and contact in milligravity: approach, contact dynamics, bounce, anchoring, collecting material | gravity field | on-surface state, sample mass |
| 45 | Dig | Mining: excavating regolith without pushing yourself off the asteroid, heating it to drive off water, power from the Sun at that distance, throughput over time | asteroid class + power | water produced per day |
| 46 | Split | Refuelling: electrolysis of that water, the mixture ratio you can actually burn (back to 31), liquefaction or storage, boil-off, or using the water directly as propellant | water rate | return propellant (mass, Isp) |
| 47 | Homeward | Leaving the asteroid: return windows to Earth, Δv against the propellant made, how much material comes home | propellant + asteroid | Earth-arrival v∞ and date, returned mass |
| 48 | Catch | Earth arrival options compared: direct entry, aerocapture, lunar gravity assist, propulsive capture, and the Skyhook upper-tip catch (idea 01's kernel) | Earth-arrival v∞ | capture choice + state |
| 49 | Hot Return | Re-entry of the sample capsule: entry trajectory, deceleration, stagnation-point heating, heat-shield ablation, parachute | entry state | landed mass, peak loads |
| 50 | The Long Way Round | The whole mission, chained: one page that runs 31–49 in sequence with a mass ledger and a Δv waterfall, a timeline, and every refusal carried through | a rocket, a propellant, an asteroid | the mission |

Each module's spec above is a direction, not a contract: build the honest version of it. If the data for part of it does not exist, the module refuses that part and says what would supply it.

## Handoffs: how the modules chain

Each module defines a **handoff**: one JSON object it exports and the next module imports. Shape:

```json
{ "handoff": "long-way-round", "version": 1, "from": "31-mixture", "produced": "<ISO time>",
  "inputs": { ... what the user chose ... },
  "outputs": { "<name>": { "value": <number|array|object>, "units": "<SI unit>", "confidence": "measured|derived|assumed", "source": "<file or computation>" } },
  "refusals": [ { "code": "insufficient_data|out_of_envelope|not_found|invalid_input", "reason": "...", "what_would_help": "..." } ],
  "assumptions": [ "..." ] }
```

This is Aster's evidence-envelope idea applied to a mission: every number carries units, a confidence class and where it came from, and a refusal travels down the chain instead of turning into a made-up number later. Every page has **Import** (paste a handoff, or load one from the URL fragment `#h=<base64url>`) and **Export** (copy, download, or a link to the next module with the handoff in its fragment). Every page also works stand-alone with sensible defaults and presets. Put the handoff schema for your module in your README and a sample `handoff.json` in your folder. Module N must accept the handoff module N−1 actually exports (read N−1's folder; it is already committed).

## Shared conventions

- **Units.** SI inside the code (m, s, kg, N, Pa, K, J); convert only at the display. Say which time scale (UTC vs TDB) and which frame (Earth-centred inertial J2000 near Earth; heliocentric ICRF/J2000 for cruise, as Aster uses) every state is in.
- **Constants.** Earth and Sun gravitational parameters, Earth radius and the like: take them from Aster's core (`src/v2/core/constants/`, `src/v2/porkchop/delta-v.ts`) by snapshot, so the chain agrees with Aster; Skyhook tether constants only from `params/rev_a.json`. Idea 14 (Whose Earth) lists where the two repos disagree; state which you use.
- **Reuse earlier modules.** When module N needs what module M < N computes, copy M's kernel into your `snapshots/` with `node tools/snapshot.mjs /home/user/Aster-Idea-Bank ideas/M-slug/<kernel>.js ideas/N-slug/snapshots/<kernel>.js` (the bank is a git repo; M is committed), and use it unmodified. Never write a second, different implementation of the same physics. Earlier ideas that are useful too: 02 Hot Skin (PartForge's 1976 atmosphere `isa()`, verbatim), 01 Tip Match (Skyhook upper-tip catch), 05 Round-Trip Ledger (NHATS round trips), 09 Two Seconds at the Bottom, 16 Spin Wobble.

## Data and validation (overrides BUILDER_BRIEF where they differ)

- **Fetching primary data at build time is allowed.** Network works through the proxy. Use authoritative, citable sources: NASA Technical Reports Server (NTRS), NASA Glenn thermodynamic data (McBride, Zehe & Gordon, NASA/TP-2002-211556, public domain), JPL Small-Body Database and Horizons APIs, PDS Small Bodies Node shape models, manufacturer or agency documents for engine and vehicle figures. Save what you use under `snapshots/` with a hand-written `<file>.provenance.json` carrying `{"repo": "<URL>", "path": "<URL path or document section>", "commit": "retrieved <ISO date>", "retrieved": "<ISO date>", "sourceSha256": "<sha256 of what you downloaded>", "license": "<license or public-domain basis>", "note": "<what you excerpted and why>"}` (the checker requires `repo`, `path` and `commit` keys). The page itself still never touches the network.
- **Never type a physical number from memory.** Thermochemical coefficients, enthalpies of formation, engine chamber pressures, vehicle masses, shape models, densities: every one comes from a fetched source, a source repo, or a computation, and the README cites it. A figure you can only recall is labelled [Speculative] and is not used as a default.
- **Validate against an independent oracle wherever one exists.** You may create a throw-away Python venv under the session scratchpad (`python3 -m venv <scratchpad>/venv-NN && <scratchpad>/venv-NN/bin/pip install cantera rocketcea poliastro ...`) to *generate* oracle values. Commit the oracle script and its output as a fixture (e.g. `oracle/cea-oracle.py` and `oracle/cea-oracle.json`); your tests compare against the fixture. Oracles are never imported by the page and never shipped. Typical oracles: NASA CEA (via rocketcea) or Cantera for 31–33; published engine and vehicle figures for 33–34; closed-form or textbook worked examples for 35–38 and 42–44; poliastro or Aster's pinned Lambert fixtures for 39; Horizons for 40; published mission figures (OSIRIS-REx, Hayabusa2, Stardust) for 42–49.
- **State the gap between model and reality as a number** where the oracle allows: "predicts 311.8 s against the published 311 s (+0.3 %)" is the standard.

## Interaction bar

These are tools a person uses, not posters. Every module has: presets of real hardware or real bodies; live controls (sliders and typed values, touch-friendly); at least one chart that updates as you move them; the numbers that matter, each with units and a confidence label; Import/Export of the handoff; structured refusals for out-of-envelope inputs; a "how this works" section on the page. Phone width 390 px works. No external CDN; canvas or inline SVG.

## Commit protocol for this series (overrides BUILDER_BRIEF's "no git" rule)

The bank is `/home/user/Aster-Idea-Bank` on branch `main`. Pull first (`git pull -q origin main`).

- **Builder**, after `node tools/check.mjs ideas/NN-slug` prints `all ideas pass`: `git add ideas/NN-slug && git commit -m "Add idea NN: <Title>, <one-line what it does>" -m "<two or three sentences>" -m "<attribution lines>"` and `git push origin main`. Stage only your folder. Never `git add -A`, never force-push, never touch another idea's folder, `tools/`, `queue/`, `BRIEFING.md`.
- **Reviewer-fixer**, after fixing and re-checking: commit the folder as `Revise NN <Title> after independent review` with a body listing what changed, then run `node tools/gallery.mjs` (it rewrites `index.html` and the ledger between the markers in `README.md`, and makes `ideas/NN-slug/preview.jpg`), check `git diff --stat` touches only those, commit them as `Gallery: add NN <Title>`, and push.
- Attribution lines to end every commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Lb6mmFA8TwAdhUWTxQ12Aw`
- If a push is rejected, `git pull --rebase -q origin main` once and push again; if it still fails, stop and report.

## Persona names

Pick a `**Made by:**` persona no earlier idea in the bank uses (`grep -h '^\*\*Made by' ideas/*/README.md`).
