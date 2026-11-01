#!/usr/bin/env bash
# Fetch every outside source idea 47 (Way Home) uses, into an empty directory given as $1.
# Then `node ideas/47-way-home/build-data.mjs <that dir>` checks them and writes snapshots/return-oracles.js.
# Sources (all public, US government work or JPL public APIs):
#   JPL NHATS API v1.3      https://ssd-api.jpl.nasa.gov/nhats.api   round trips, return legs (oracle)
#   CNEOS NHATS caveats     https://cneos.jpl.nasa.gov/nhats/caveats.html   method, 125 km, 12 km/s
#   JPL SBDB close approach https://ssd-api.jpl.nasa.gov/cad.api     Apophis 2029 encounter
#   JPL Horizons API        https://ssd.jpl.nasa.gov/api/horizons.api   OSIRIS-REx's flown return (reconstructed)
set -euo pipefail
out="${1:?usage: fetch-sources.sh <empty dir>}"
mkdir -p "$out/nhats"
api='https://ssd-api.jpl.nasa.gov/nhats.api'
for des in 99942 101955 "2000%20SG344" 162173 65803 433; do
  for L in 2025-2030 2030-2035 2035-2040; do
    for dv in 6 8 12; do for dur in 360 450; do for stay in 8 32; do
      f="$out/nhats/$(echo "$des" | sed 's/%20/_/')_${L}_${dv}_${dur}_${stay}.json"
      curl -sS --max-time 60 "${api}?des=${des}&dv=${dv}&dur=${dur}&stay=${stay}&launch=${L}" -o "$f"
    done; done; done
  done
done
curl -sS --max-time 60 'https://cneos.jpl.nasa.gov/nhats/caveats.html' -o "$out/nhats-caveats.html"
curl -sS --max-time 60 'https://ssd-api.jpl.nasa.gov/doc/nhats.html' -o "$out/nhats-doc.html"
curl -sS --max-time 60 'https://ssd-api.jpl.nasa.gov/cad.api?des=99942&date-min=2028-01-01&date-max=2030-01-01&dist-max=0.2&fullname=true' -o "$out/cad-apophis.json"
H='https://ssd.jpl.nasa.gov/api/horizons.api'
hz() { # command center start stop step file
  curl -sS --max-time 90 -G "$H" --data-urlencode "format=json" --data-urlencode "COMMAND='$1'" --data-urlencode "EPHEM_TYPE='VECTORS'" \
    --data-urlencode "CENTER='$2'" --data-urlencode "START_TIME='$3'" --data-urlencode "STOP_TIME='$4'" --data-urlencode "STEP_SIZE='$5'" \
    --data-urlencode "VEC_TABLE='2'" --data-urlencode "OUT_UNITS='KM-S'" --data-urlencode "REF_PLANE='FRAME'" --data-urlencode "REF_SYSTEM='ICRF'" \
    --data-urlencode "TIME_TYPE='TDB'" --data-urlencode "CSV_FORMAT='YES'" -o "$out/$6"
}
hz '-64' '500@10' '2021-05-10 20:00' '2021-05-10 20:20' '10m' orex-helio-adm.json
hz 'DES=2101955;' '500@10' '2021-05-10 20:00' '2021-05-10 20:20' '10m' bennu-helio-adm.json
hz '-64' '500@399' '2023-09-24 06:00' '2023-09-24 11:00' '1h' orex-geo-arrival.json
hz '399' '500@10' '2023-09-24 12:00' '2023-09-24 17:00' '1h' earth-helio-arrival.json
ls -la "$out" | head
