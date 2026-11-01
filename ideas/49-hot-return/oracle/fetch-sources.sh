#!/usr/bin/env bash
# Fetch every outside document idea 49 (Hot Return) reads, into an empty directory given as $1.
# Then `node ideas/49-hot-return/build-data.mjs <that dir>` checks each file's sha256, finds every quoted passage verbatim
# (pdftotext from poppler-utils is needed for that step only) and writes snapshots/reentry-sources.js.
# All are NASA technical reports (NTRS; US government work, public domain in the US) or NIST's CODATA page.
set -euo pipefail
out="${1:?usage: fetch-sources.sh <empty dir>}"
mkdir -p "$out"
n() { curl -sS --max-time 240 -L "https://ntrs.nasa.gov/api/citations/$1/downloads/$2" -o "$out/$3"; }
# the flown capsules (Stardust, Genesis, OSIRIS-REx): timelines, parachutes, ground
n 20090004445 20090004445.pdf stardust-edl-ops.pdf             # Desai et al., EDL operations analysis for the Stardust entry capsule (2008)
n 20080008567 20080008567.pdf stardust-reconstruction.pdf      # Desai & Qualls, Stardust entry reconstruction, AIAA 2008-1198
n 20080020376 20080020376.pdf genesis-edl-ops.pdf              # Desai & Lyons, EDL operations analysis for the Genesis entry capsule
n 20080019649 20080019649.pdf genesis-reconstruction.pdf       # Desai, Qualls & Schoenenberger, Reconstruction of the Genesis entry
n 20070014646 20070014646.pdf genesis-src-overview.pdf         # Genesis sample return capsule overview (JPL/Lockheed Martin, 2005)
n 20240000629 OREX_EDL_paper_011124_afternoon.pdf orex-edl.pdf        # EDL analysis for the OSIRIS-REx sample return capsule (AAS 2024)
n 20240014280 OREX_FM_SciTech2025_v2.pdf orex-edl-performance.pdf     # OSIRIS-REx EDL performance (SciTech 2025)
# heating
n 19720018273 19720018273.pdf apollo-aerothermo.pdf            # Apollo experience report: aerothermodynamics evaluation, TN D-6843 (1972)
n 19740021216 19740021216.pdf suttles-radfits.pdf              # Suttles, Sullivan & Margolis, radiative heating curve fits, TN D-7622 (1974)
n 19900014359 19900014359.pdf sutton-hartung-radtables.pdf     # Sutton & Hartung, equilibrium radiative heating tables, TM-102652 (1990)
n 20140004052 20140004052.pdf src-aerothermo-issues.pdf        # Johnston et al., aerothermodynamic modeling issues for high-speed sample return (STO-AVT-218)
n 20100021412 20100021412.pdf stardust-slit.pdf                # Winter, Trumble et al., SLIT observation of the Stardust re-entry (2010)
# the heat shield (PICA)
n 20070014634 20070014634.pdf stardust-pica-perf.pdf           # Covington, performance of PICA for the Stardust SRC (IPPW-2, 2005)
n 20100027549 20100027549.pdf stardust-xray-ct.pdf             # X-ray CT inspection of the Stardust heat shield (2010)
n 20140005558 20140005558.pdf pica-postflight.pdf              # Stackpoole et al., post-flight evaluation of PICA and PICA-X (2013 poster)
n 20160000305 20160000305.pdf pica-envelope.pdf                # Investigation of performance envelope for PICA (2016)
n 20110012891 20110012891.pdf pica-model-validation.pdf        # Milos & Chen, ablation and thermal response property model validation for PICA (AIAA 2009-0262)
# a constant
curl -sS --max-time 60 'https://physics.nist.gov/cgi-bin/cuu/Value?sigma' -o "$out/nist-sigma.html"   # CODATA 2022 Stefan-Boltzmann
ls -la "$out"
