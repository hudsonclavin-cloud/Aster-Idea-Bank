#!/usr/bin/env bash
# Fetch JPL NHATS round trips for the five NHATS validation targets this deposit carries, into an
# empty directory given as $1. Then `node ideas/21-homeward-porkchop/build-data.mjs --nhats <that dir>`
# derives snapshots/nhats-legs.json (the return leg of every distinct trajectory) and its sidecar.
# Source: JPL NHATS Data API v1.3, https://ssd-api.jpl.nasa.gov/nhats.api (public JPL API, US Government work).
# The query grid is idea 47's (dv 6|8|12 km/s, dur 360|450 d, stay 8|32 d, three launch spans), so the
# legs on the three bodies both deposits carry can be compared row for row.
set -euo pipefail
out="${1:?usage: fetch-nhats.sh <empty dir>}"
mkdir -p "$out/nhats"
api='https://ssd-api.jpl.nasa.gov/nhats.api'
for des in "1999%20AO10" 101955 "2000%20SG344" 99942 "2001%20GP2"; do
  for L in 2025-2030 2030-2035 2035-2040; do
    for dv in 6 8 12; do for dur in 360 450; do for stay in 8 32; do
      f="$out/nhats/$(echo "$des" | sed 's/%20/_/')_${L}_${dv}_${dur}_${stay}.json"
      curl -sS --max-time 60 "${api}?des=${des}&dv=${dv}&dur=${dur}&stay=${stay}&launch=${L}" -o "$f"
    done; done; done
  done
done
ls "$out/nhats" | wc -l
