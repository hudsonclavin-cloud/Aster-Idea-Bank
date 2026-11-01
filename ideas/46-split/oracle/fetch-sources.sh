#!/usr/bin/env bash
# Fetch every external source idea 46 (Split) transcribes or checks against, into an empty directory.
# Nothing here is needed to run the page or the tests; build-data.mjs reads this directory to regenerate
# snapshots/split-sources.js and verifies that every transcribed figure is found in its source.
#
#   bash ideas/46-split/oracle/fetch-sources.sh <empty dir>
#
# Retrieved for the committed snapshot on 2026-11-01 (sha256 of each file in snapshots/split-sources.js.provenance.json).
set -euo pipefail
D="${1:?usage: fetch-sources.sh <empty dir>}"
mkdir -p "$D"
cd "$D"
UA="Mozilla/5.0"
get() { curl -sS -L -m 120 -A "$UA" -o "$1" "$2"; echo "$1 $(wc -c < "$1") bytes"; }

# Electrolysis: DOE's PEM electrolyser targets (stack V/cell, kWh/kg H2, crossover note).
get doe-pem-targets.html "https://www.energy.gov/eere/fuelcells/technical-targets-proton-exchange-membrane-electrolysis"
# ISS Oxygen Generation Assembly: 46.9 A, 9.25 kg/day (ICES-2024-101) and 28 cells (ICES-2015).
get ntrs-20240006776-aoga.pdf "https://ntrs.nasa.gov/api/citations/20240006776/downloads/ICES%202024%20101%20AOGA%20final.pdf"
get ntrs-20150016494-oga.pdf "https://ntrs.nasa.gov/api/citations/20150016494/downloads/20150016494.pdf"
# Exact SI constants (Faraday = N_A e) and the thermochemical calorie.
get codata-na.html "https://physics.nist.gov/cgi-bin/cuu/Value?na"
get codata-e.html "https://physics.nist.gov/cgi-bin/cuu/Value?e"
get codata-sigma.html "https://physics.nist.gov/cgi-bin/cuu/Value?sigma"
get nist-sp811-b9.html "https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9"
# NIST-JANAF: liquid water, delta-f H and delta-f G (the electrolysis oracle).
get janaf-H-063.txt "https://janaf.nist.gov/tables/H-063.txt"
# Solar arrays: NEAR Shoemaker (the chain's spacecraft) and Psyche, with Psyche's orbit from the SBDB.
get nssdca-near.html "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1996-008A"
get nasa-psyche-spacecraft.html "https://science.nasa.gov/mission/psyche/spacecraft/"
get sbdb-16.json "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=16&phys-par=1"
# Cryogenics: MHTB MLI heat leak (abstract), NASA/Creare 20 K cryocooler (2026 characterization, 2022 KPP table),
# ortho-para conversion heat (Weitzel et al. 1958, J. Res. NBS 60:221).
get ntrs-19990084079.json "https://ntrs.nasa.gov/api/citations/19990084079"
get ntrs-20205010721.json "https://ntrs.nasa.gov/api/citations/20205010721"
get ntrs-20260005078-cryocooler.pdf "https://ntrs.nasa.gov/api/citations/20260005078/downloads/NUGENT_Updated.pdf"
get ntrs-20220009350-cryocooler.pdf "https://ntrs.nasa.gov/api/citations/20220009350/downloads/MAN_8.3_Nugent_06-16-22.pdf"
get nbs-jres60-221.pdf "https://nvlpubs.nist.gov/nistpubs/jres/60/jresv60n3p221_A1b.pdf"
# NIST Chemistry WebBook fluid properties (SRD 69), tab-delimited, default reference states.
U="TUnit=K&PUnit=MPa&DUnit=kg%2Fm3&HUnit=kJ%2Fkg&WUnit=m%2Fs&VisUnit=uPa*s&STUnit=N%2Fm&RefState=DEF&Digits=8"
W="https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on"
get nist-ph2-isobar.tsv "$W&ID=B5000001&Type=IsoBar&P=0.101325&THigh=400&TLow=20&TInc=2&$U"
get nist-o2-isobar.tsv "$W&ID=C7782447&Type=IsoBar&P=0.101325&THigh=400&TLow=90&TInc=2&$U"
get nist-nh2-isotherm.tsv "$W&ID=C1333740&Type=IsoTherm&T=293.15&PHigh=70&PLow=1&PInc=1&$U"
get nist-o2-isotherm.tsv "$W&ID=C7782447&Type=IsoTherm&T=293.15&PHigh=70&PLow=1&PInc=1&$U"
get nist-water-isobar.tsv "$W&ID=C7732185&Type=IsoBar&P=0.101325&THigh=370&TLow=280&TInc=5&$U"
# Text layers for the PDFs (pdftotext -layout, poppler).
for f in *.pdf; do pdftotext -layout "$f" "${f%.pdf}.txt" 2>/dev/null; done
echo done
