#!/usr/bin/env bash
# Fetches what build-data.mjs --nhats reads: JPL's NHATS API for the 43 queries behind idea 47's NHATS rows (each
# response carries its least-delta-v and its shortest round trip, with the C3 and the Earth-departure delta-v idea 47's
# excerpt left out), and CNEOS's caveats page, which defines the total delta-v. Network; nothing here is shipped.
#   bash ideas/50-the-long-way-round/oracle/fetch-sources.sh <empty directory>
set -euo pipefail
out="${1:?usage: fetch-sources.sh <empty directory>}"
mkdir -p "$out/nhats"
here="$(cd "$(dirname "$0")" && pwd)"
node -e '
const R = require(process.argv[1]);
for (const q of [...new Set(R.nhats.map((r) => r[12]))]) console.log(q);
' "$here/../../47-way-home/snapshots/return-oracles.js" > "$out/queries.txt"
while read -r q; do
  rest="$(echo "$q" | grep -o '[0-9]*-[0-9]*_[0-9]*_[0-9]*_[0-9]*$')"
  des="${q%_$rest}"; des="${des//_/%20}"
  IFS=_ read -r launch dv dur stay <<< "$rest"
  curl -sS -m 60 -o "$out/nhats/$q.json" "https://ssd-api.jpl.nasa.gov/nhats.api?des=$des&dv=$dv&dur=$dur&stay=$stay&launch=$launch"
done < "$out/queries.txt"
curl -sS -m 60 -o "$out/cneos-caveats.html" "https://cneos.jpl.nasa.gov/nhats/caveats.html"
curl -sS -m 60 -o "$out/ssd-api-nhats.html" "https://ssd-api.jpl.nasa.gov/doc/nhats.html"
ls "$out/nhats" | wc -l
