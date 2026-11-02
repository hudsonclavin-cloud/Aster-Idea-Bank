# Slice 9 NEA Catalog Fixture Spec

## Purpose

`tests/fixtures/v2/nea-catalog-slice9.json` is the production Slice 9 data fixture.
It captures the full JPL SBDB `sb-group=neo` catalog as of build time, with:

- per-object osculating elements from SBDB
- anchor state derived by propagating those SBDB elements at the element epoch
- optional Horizons re-anchor replacement for stale-element bodies
- inline quality metadata
- CAD-window-backed `inv014Tier` assignment

This fixture is data only. It does not choose renderer, spatial-index, or ui-hud behavior.

## Top-level shape

```json
{
  "selectionSource": "string",
  "anchorSource": "string",
  "frame": "ICRF/J2000",
  "timeScale": "TDB",
  "units": {
    "anchorPosition": "km",
    "anchorVelocity": "km/s",
    "anchorTime": "TDB JD",
    "semiMajorAxis": "km",
    "estimatedRadius": "m",
    "angles": "rad",
    "dataArc": "days",
    "sigmaA": "au",
    "sigmaE": "unitless"
  },
  "propagation": {
    "method": "keplerian-two-body",
    "epochPolicy": "per-body-sbdb-osculating-elements"
  },
  "closeApproachWindow": {
    "start": "YYYY-MM-DD",
    "stop": "YYYY-MM-DD",
    "distMaxAu": "0.05",
    "bodies": ["Earth", "Venus"]
  },
  "catalog": {
    "totalBodies": 0,
    "includedClasses": ["AMO", "APO", "ATE", "IEO", "ETC", "HTC", "JFC"],
    "classDistribution": { "AMO": 0 },
    "inv014TierDistribution": {
      "visualization-tier": 0,
      "planning-tier": 0,
      "not-kepler-safe": 0
    },
    "missingAbsoluteMagnitudeCount": 0,
    "anomalyTailCount": 0,
    "qualityRankFormula": "string"
  },
  "asteroids": {
    "asteroid-<designation>": {
      "...": "per-body record"
    }
  }
}
```

## Per-body record

```json
{
  "designation": "433",
  "spkId": 20000433,
  "name": "(433 Eros)",
  "class": "AMO",
  "orbitClass": "AMO",
  "isCuratedNea": false,
  "neo": true,
  "pha": false,
  "H": 10.39,
  "G": null,
  "estimatedRadiusM": 8472.593,
  "anchor": {
    "epochTdbJd": 2461000.5,
    "positionKm": [0, 0, 0],
    "velocityKmPerS": [0, 0, 0]
  },
  "elements": {
    "aKm": 0,
    "e": 0.0,
    "iRad": 0.0,
    "omRad": 0.0,
    "wRad": 0.0,
    "maRad": 0.0,
    "epochTdbJd": 2461000.5
  },
  "elementsFrame": "HELIO_J2000_ECLIPTIC",
  "eccentricityBand": "A",
  "conditionCode": 0,
  "dataArcDays": 12345,
  "nObsUsed": 999,
  "sigmaA": 1e-9,
  "sigmaE": 1e-9,
  "inv014Tier": "visualization-tier",
  "qualityRank": 0.972341,
  "anchorSource": "sbdb",
  "reanchorEpochTdbJd": null
}
```

## Nullability rules

- `H` may be `null` when SBDB does not report an absolute magnitude.
- `estimatedRadiusM` must be `null` when `H` is `null`.
- `G` is `null` in Slice 9 because the bulk SBDB query does not include it.
- Quality fields may be `null` when SBDB does not report them.

## INV-014 tier assignment

The fixture does **not** numerically assign the future `planning-tier`.

- `not-kepler-safe`
  - body has at least one CAD close approach within the standard validation window
  - window is recorded in `closeApproachWindow`
  - OR body is anomaly-tail / cometary (`orbitClass` in `{ETC, HTC, JFC}`)
  - OR body is stale-unanchored (`anchorSource = "stale-unanchored"`)
- `visualization-tier`
  - body is **not** CAD-flagged in that window
  - AND body is **not** anomaly-tail / cometary
  - AND body is not stale-unanchored
- `planning-tier`
  - reserved product/policy label for Slice 10 consumption
  - distribution is expected to remain `0` in the Slice 9 fixture

The ~50,000 km visualization envelope is validated by the Slice 9 cutover harness, not recomputed per body at fixture-build time.

## Hybrid anchor semantics

Slice 9 A.2b amends the original SBDB-only anchor policy with a stale-body re-anchor pass.

- `anchorSource: "sbdb"`
  - body kept its original SBDB osculating elements and anchor
  - expected for fresh bodies (`staleness <= T`) and any non-stale anomaly-tail body
- `anchorSource: "horizons-reanchor"`
  - body exceeded the stale threshold and was refreshed from a recent Horizons state
  - `reanchorEpochTdbJd` must be present
  - `anchor.epochTdbJd`, `elements.epochTdbJd`, and `reanchorEpochTdbJd` must all match
- `anchorSource: "stale-unanchored"`
  - body exceeded the stale threshold but Horizons could not resolve a replacement anchor
  - body must be tagged `inv014Tier = "not-kepler-safe"`
  - `reanchorEpochTdbJd` must be `null`

## qualityRank

`qualityRank` is a documented scalar for future Slice 9 Phase C down-ranking. It does **not** prescribe UI visuals.

Formula:

```text
conditionScore = condition_code == null ? 0 : clamp01(1 - condition_code / 9)
dataArcScore   = data_arc_days == null ? 0 : clamp01(log10(1 + data_arc_days) / log10(1001))
qualityRank    = clamp01(0.6 * conditionScore + 0.4 * dataArcScore)
```

Interpretation:

- range is `[0, 1]`
- higher is better-constrained / longer-arc
- phase-C visuals decide how to map the scalar; the fixture only preserves it

## Anchor semantics

Slice 9 supports two anchor paths:

- SBDB path
  - `anchor` is derived by propagating each body's own SBDB osculating elements at that body's own `elements.epochTdbJd`
  - `anchorSource` is `sbdb`
- Horizons re-anchor path
  - stale bodies are refreshed from a Horizons state at a common re-anchor epoch
  - refreshed elements are derived from that state and replace the stale SBDB elements in the fixture
  - `anchorSource` is `horizons-reanchor`

For both paths:

- `anchor.epochTdbJd` must equal `elements.epochTdbJd`
- anchor vectors are stored in heliocentric ICRF/J2000 kilometers and km/s
