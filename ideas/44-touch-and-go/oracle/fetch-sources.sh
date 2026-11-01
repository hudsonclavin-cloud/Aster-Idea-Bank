#!/usr/bin/env bash
# Fetches every primary source this module was built from into the directory given (default: the current one).
# Nothing here runs at page time; build-data.mjs reads these files, checks each quoted figure is really in them,
# and writes snapshots/tag-recon.js and the sha256 sums in snapshots/tag-sources.js.provenance.json.
#   bash ideas/44-touch-and-go/oracle/fetch-sources.sh /tmp/src44
set -euo pipefail
D="${1:-.}"; mkdir -p "$D"; cd "$D"
H='https://ssd.jpl.nasa.gov/api/horizons.api?format=text&EPHEM_TYPE=VECTORS&VEC_TABLE=2&REF_PLANE=FRAME&OUT_UNITS=KM-S&CSV_FORMAT=YES&TIME_TYPE=TDB'
# OSIRIS-REx (-64) relative to Bennu's centre, ICRF, every 10 s from orbit departure to past the back-away (1,800 steps).
curl -sS -o horizons-orex-tag-10s.txt "$H&COMMAND='-64'&CENTER='@2101955'&START_TIME='2020-10-20%2017:00'&STOP_TIME='2020-10-20%2022:00'&STEP_SIZE='1800'"
# The same at 0.5 s around the end of the descent segment (od294-N_tag), which is taken as the contact epoch.
curl -sS -o horizons-orex-tag-contact-0.5s.txt "$H&COMMAND='-64'&CENTER='@2101955'&START_TIME='2020-10-20%2021:51:00'&STOP_TIME='2020-10-20%2021:51:04'&STEP_SIZE='8'"
# Bennu relative to the Sun (for idea 42's sunlight and solar tide along the descent).
curl -sS -o horizons-bennu-helio-tag.txt "$H&COMMAND='2101955'&CENTER='@10'&START_TIME='2020-10-20%2017:00'&STOP_TIME='2020-10-20%2022:00'&STEP_SIZE='5'"
# Earth-spacecraft one-way light time at contact (quantity 21), to check NASA's 6:08 pm EDT confirmation.
curl -sS -o horizons-orex-geo-tag.txt "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&EPHEM_TYPE=OBSERVER&COMMAND='-64'&CENTER='500@399'&START_TIME='2020-10-20%2021:45'&STOP_TIME='2020-10-20%2021:55'&STEP_SIZE='10'&QUANTITIES='20,21'&TIME_TYPE=UT"
# NASA Technical Reports Server: the flight-dynamics papers on TAG, and the sampleability paper (all public NASA or open access).
N='https://ntrs.nasa.gov/api/citations'
curl -sS -o berry2021-tag-performance.pdf "$N/20210025295/downloads/Berry_TAG_Performance_v8.pdf"
curl -sS -o berry2020-revisiting-tag.pdf "$N/20200000774/downloads/20200000774.pdf"
curl -sS -o may2014-tag-mission-design.pdf "$N/20140017837/downloads/20140017837.pdf"
curl -sS -o walsh2022-sampleability.pdf "$N/20220006342/downloads/Dworkin.assessing.STI.pdf"
curl -sS -o post-tag-trajectory.pdf "$N/20220000264/downloads/OSIRIS_REx_Post_TAG_Observation_Trajectory_Design_and_Navigation_Performance_v2.pdf"
# NASA news pages (US government works).
curl -sSL -o nasa-2020-10-21-tag.html 'https://www.nasa.gov/solar-system/osiris-rex-tags-surface-of-asteroid-bennu/'
curl -sSL -o nasa-2021-04-15-mark.html 'https://www.nasa.gov/solar-system/nasas-osiris-rex-leaves-its-mark-on-asteroid-bennu/'
curl -sSL -o nasa-2022-07-07-ballpit.html 'https://www.nasa.gov/missions/surprise-again-asteroid-bennu-reveals-its-surface-is-like-a-plastic-ball-pit/'
curl -sSL -o nasa-2024-02-15-mass.html 'https://science.nasa.gov/blogs/osiris-rex/2024/02/15/nasa-announces-osiris-rex-bulk-sample-mass/'
# both layouts: -layout keeps tables in rows, the plain mode keeps two-column sentences whole
for f in *.pdf; do pdftotext -layout "$f" "${f%.pdf}.txt"; pdftotext "$f" "${f%.pdf}.raw.txt"; done
sha256sum ./* | sort -k2
