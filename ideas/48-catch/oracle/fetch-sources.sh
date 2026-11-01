#!/usr/bin/env bash
# Fetch every outside document idea 48 (Catch) reads, into an empty directory given as $1.
# Then `node ideas/48-catch/build-data.mjs <that dir>` checks each file's sha256, finds every quoted passage verbatim
# (pdftotext from poppler-utils is needed for that step only) and writes snapshots/entry-sources.js.
# All are NASA technical reports (NTRS, US government work, public domain in the US) or NASA's NSSDCA fact sheet.
set -euo pipefail
out="${1:?usage: fetch-sources.sh <empty dir>}"
mkdir -p "$out"
n() { curl -sS --max-time 180 -L "https://ntrs.nasa.gov/api/citations/$1/downloads/$2" -o "$out/$3"; }
n 20090004445 20090004445.pdf stardust-edl-ops.pdf            # Desai et al., EDL operations analysis for the Stardust entry capsule (2008)
n 20080008567 20080008567.pdf stardust-reconstruction.pdf     # Desai & Qualls, Stardust entry reconstruction, AIAA 2008-1198
n 20040105538 20040105538.pdf stardust-aero.pdf               # Mitcheltree et al., Aerodynamics of Stardust sample return capsule (1997)
n 20080020376 20080020376.pdf genesis-edl-ops.pdf             # Desai & Lyons, EDL operations analysis for the Genesis entry capsule
n 20080019649 20080019649.pdf genesis-reconstruction.pdf      # Desai, Qualls & Schoenenberger, Reconstruction of the Genesis entry
n 20240000629 OREX_EDL_paper_011124_afternoon.pdf orex-edl.pdf       # EDL analysis for the OSIRIS-REx sample return capsule
n 20240014280 OREX_FM_SciTech2025_v2.pdf orex-edl-performance.pdf    # OSIRIS-REx EDL performance (SciTech 2025)
n 20240000800 O_REx_Earth_Return_Entry_Nav_Ops_LL_v4.pdf orex-nav.pdf  # OSIRIS-REx Earth return & entry navigation (AAS 24-151)
n 19720003329 19720003329.pdf sutton-graves.pdf               # Sutton & Graves, NASA TR R-376 (1971)
n 20000102372 20000102372.pdf transhab-aerocapture.pdf        # Earth return aerocapture for the TransHab/Ellipsled vehicle (2000)
n 19720018273 19720018273.pdf apollo-aerothermo.pdf           # Apollo experience report: aerothermodynamics evaluation (1972)
n 20150001236 20150001236.pdf arrm-trajectory.pdf             # Interplanetary trajectory design for the ARRM alternate approach trade study
curl -sS --max-time 60 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html' -o "$out/moonfact.html"
ls -la "$out"
