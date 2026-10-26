# Perplexity research — JPL Trajectory Browser and NHATS

**Source:** Perplexity, 2026-05-22
**Prompt context:** Roadmap doc, Perplexity Prompt 2 (JPL Trajectory Browser and NHATS, Slices 10-12)
**Capture method:** Conversational thread, captured as text (no source file)

---

## Initial query response

Here's the current benchmark picture: JPL's Trajectory Browser is still available as a web tool, with a JSON-backed NHATS API for the "Accessible NEAs" tables, while ESA does not appear to have a one-to-one public equivalent that combines human-mission accessibility screening with a searchable trajectory browser; ESA's closest public infrastructure is its NEO Coordination Centre plus the planetary-defence data portal rather than an NHATS-style mission-accessibility database.

### JPL Trajectory Browser state

Trajectory Browser is a NASA Ames web app that provides a search engine, visualizer, and mission summaries for trajectories to planets and small bodies, and its FAQ states it is intended as a preliminary, low-fidelity analysis tool using a Lambert solver with impulsive maneuvers and Sun-only dynamics.

The FAQ also says trajectories are pre-computed and stored in a database, the system supports up to 100 displayed results per query, and it assumes 200 km LEO injection plus 200 km Earth inertial reentry for its trajectory model.

### JPL APIs and exports

For NHATS-linked accessibility data, JPL exposes a documented JSON API at:

  https://ssd-api.jpl.nasa.gov/nhats.api

That API supports summary mode and object-detail mode, with filters such as dv, dur, stay, launch, h, and occ, and the response includes fields like minimum delta-v, minimum duration, viable trajectory count, and detailed trajectory records when an object is requested.

The Trajectory Browser FAQ says new bodies are not computed on demand; trajectories are precomputed, and users can request additions by contacting the team.

### Most recent NHATS update

The NHATS API documentation you can cite is version 1.3, dated 2019 September, and its change log says the main update was expanding the launch window from 2015-2040 to 2020-2045.

The FAQ on the Trajectory Browser is from 2016 and reflects an older operational description, but the NHATS API doc is the best current machine-readable reference for the accessible-target table interface.

### NHATS accessibility rules

NHATS defines an object as compliant if it offers at least one round-trip trajectory satisfying these constraints:
- Earth departure date between 2015-01-01 and 2040-12-31 in the study writeup
- Total mission Δv ≤ 12 km/s
- Total mission duration ≤ 450 days
- Stay time at the asteroid ≥ 8 days
- Earth atmospheric entry speed ≤ 12 km/s at 125 km altitude

The NHATS API documentation shows the current public web-page "standard" filters as dv=6, dur=360, stay=8, and launch=2020-2045, which is the practical default screening set now exposed by the API.

In the API's detailed trajectory record, the total mission delta-v includes Earth departure from a 400 km parking orbit, arrival matching, departure from the NEA, and any required Earth-return entry constraint.

### Validation and citation papers

For comparing your Lambert-solver results against Trajectory Browser output, the key citable sources are the Trajectory Browser FAQ itself and the NHATS mission-accessibility paper by Barbee et al., which describes the automated NHATS system and its public data distribution.

The FAQ explicitly says the Trajectory Browser uses a Lambert solver and is a low-fidelity tool, which is useful to justify why small mismatches against higher-fidelity propagation are expected.

The NHATS paper is also the cleanest citation for the fact that NHATS data are updated automatically and published via a web site and daily notifications.

### ESA equivalent

ESA's closest public analogue is the Near-Earth Object Coordination Centre (NEOCC) and its planetary-defence portal, which provides orbital information, impact monitoring, risk analysis, and public data access for NEOs.

However, that is not the same thing as a public, NHATS-like human mission accessibility catalog, and I did not find an ESA public resource that mirrors JPL's NHATS/Trajectory Browser combination for round-trip crewed asteroid accessibility screening.

If your planner needs an ESA-side benchmark, NEOCC is the right public institutional source to align object data and orbital context, but not a direct mission-feasibility oracle.

### Practical benchmark guidance

For benchmark compatibility, I would mirror NHATS by implementing: Sun-only patched-conic or Lambert-based screening, 400 km parking-orbit departure cost, 125 km reentry-speed constraint, round-trip mission accounting, and the same threshold set on Δv, duration, stay time, launch window, H magnitude, and OCC.

For regression tests, use the API's object-detail mode on well-known cases like Apophis or 2000 SG344 and compare against the min_dv_traj and min_dur_traj records rather than only the summary minima.

A good citation pair for your paper or README is the NHATS API documentation plus the Trajectory Browser FAQ, because together they document both the screening thresholds and the solver/model assumptions.

---

## Follow-up: Limitations of the Lambert solver used in Trajectory Browser

Trajectory Browser's Lambert-based solver is intentionally low fidelity, so its main limitations are the usual patched-conic ones: it assumes the Sun is the only gravitating body, so it ignores planetary gravity, solar radiation pressure, and third-body perturbations.

It also uses fixed mission assumptions such as 200 km LEO injection and 200 km Earth-inertial reentry, so it does not model launch vehicle injection details, capture strategies, atmospheric entry dispersion, or finite-burn maneuvers.

For benchmark work, the important implication is that it is best treated as a fast screening tool, not a truth model.

You should expect mismatches versus higher-fidelity propagators when transfers pass near planets, require long flight times, involve multiple revolutions, or are sensitive to small phasing changes, because a single-arc Lambert solution does not capture those effects.

The Trajectory Browser user guide also explicitly notes that the solver has "several limitations" due to approximations and assumptions, which is the official wording to cite when describing why results are approximate.
