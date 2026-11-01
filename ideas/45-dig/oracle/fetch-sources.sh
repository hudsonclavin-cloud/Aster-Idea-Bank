#!/usr/bin/env bash
# Fetches every primary source this module was built from into the directory given (default: the current one).
# Nothing here runs at page time. build-data.mjs reads these files, checks that every figure it transcribes is
# really in them, and writes snapshots/dig-sources.js, snapshots/sun-ephem.js and oracle/horizons-bennu-sun.json.
#   bash ideas/45-dig/oracle/fetch-sources.sh /tmp/src45
set -euo pipefail
D="${1:-.}"; mkdir -p "$D"; cd "$D"
V='https://ssd.jpl.nasa.gov/api/horizons.api?format=text&EPHEM_TYPE=VECTORS&VEC_TABLE=1&REF_PLANE=FRAME&REF_SYSTEM=ICRF&OUT_UNITS=AU-D&CSV_FORMAT=YES&TIME_TYPE=TDB&CENTER=%27500@10%27'
# 1. Where the two asteroids are, about the Sun's centre, ICRF axes, TDB, au, every 2 days (sunlight at the site).
curl -sS -o horizons-apophis-helio.txt "$V&COMMAND=%2799942%3B%27&START_TIME=%272026-01-01%27&STOP_TIME=%272029-04-15%27&STEP_SIZE=%272%20d%27"
curl -sS -o horizons-bennu-helio.txt "$V&COMMAND=%272101955%27&START_TIME=%272020-01-01%27&STOP_TIME=%272021-12-31%27&STEP_SIZE=%272%20d%27"
# 2. The oracle for the site's day and night: the Sun's elevation seen from Nightingale (OSIRIS-REx's sampling site,
#    55.9 N 41.8 E, Walsh et al. 2022 via idea 44) on Bennu, by JPL Horizons' own Bennu rotation model, on three days.
O='https://ssd.jpl.nasa.gov/api/horizons.api?format=text&EPHEM_TYPE=OBSERVER&COMMAND=%2710%27&CENTER=%27coord@2101955%27&COORD_TYPE=%27GEODETIC%27&SITE_COORD=%2741.8,55.9,0%27&STEP_SIZE=%275m%27&QUANTITIES=%274%27&CSV_FORMAT=YES'
curl -sS -o horizons-bennu-nightingale-sun-20201020.txt "$O&START_TIME=%272020-10-20%2000:00%27&STOP_TIME=%272020-10-20%2012:00%27"
curl -sS -o horizons-bennu-nightingale-sun-20210115.txt "$O&START_TIME=%272021-01-15%2000:00%27&STOP_TIME=%272021-01-15%2012:00%27"
curl -sS -o horizons-bennu-nightingale-sun-20210401.txt "$O&START_TIME=%272021-04-01%2000:00%27&STOP_TIME=%272021-04-01%2012:00%27"
# 3. Spectral class of each body (JPL Small-Body Database, physical parameters with their references).
for b in 99942 101955 162173 25143; do curl -sS -o "sbdb-$b.json" "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=$b&phys-par=1"; done
# 4. Open-access papers through PubMed Central's E-utilities (JATS XML of the full text).
E='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='
curl -sS -o suttle2024-murchison-heating.xml "${E}11339282"; sleep 1      # Suttle et al. 2024, Nat. Commun. 15:7178 (CC BY 4.0)
curl -sS -o jin-bose2019-itokawa-water.xml "${E}6527261"; sleep 1         # Jin & Bose 2019, Sci. Adv. 5:eaav8106 (CC BY-NC 4.0)
curl -sS -o king2022-winchcombe.xml "${E}9668287"; sleep 1                # King et al. 2022, Sci. Adv. 8:eabq3925 (CC BY 4.0)
curl -sS -o glavin2025-bennu-ammonia.xml "${E}11842271"; sleep 1          # Glavin et al. 2025, Nat. Astron. 9:199 (CC BY 4.0)
# 5. NASA Technical Reports Server.
N='https://ntrs.nasa.gov/api/citations'
curl -sS -o praet2021-bennu-hydrogen.docx "$N/20205006710/downloads/Article_Praet-et-al_v6.docx"            # Praet et al. 2021, Icarus (author manuscript)
curl -sS -o ipex2022-bucket-drum-scaling.pdf "$N/20210025846/downloads/ASCE%20E%26S%202022-%20ISRU%20Pilot%20Excavator%20BD%20scaling.pdf"
# Read for the choice of method, not used for any number: NASA's comparison of blade-force models with field tests.
curl -sS -o gallo2010-blade-force.pdf "$N/20100012787/downloads/20100012787.pdf"   # Gallo et al., NASA/TM-2010-215591
# 6. Robie and Hemingway (1995), USGS Bulletin 2131: heat capacities and enthalpies of formation (public domain, 21 MB).
curl -sSL -o robie-hemingway-1995-b2131.pdf 'https://pubs.usgs.gov/bul/2131/report.pdf'
# 7. NIST CODATA: the Stefan-Boltzmann constant (exact since the 2019 SI), for what a hot oven radiates away.
curl -sS -o nist-sigma.html 'https://physics.nist.gov/cgi-bin/cuu/Value?sigma'
# Text layers: pdftotext for the PDFs, the docx's document.xml with its tags stripped, the XML with its tags stripped.
for f in *.pdf; do pdftotext -layout "$f" "${f%.pdf}.txt"; done
python3 -I - <<'EOF'
import glob, re, zipfile
for f in glob.glob('*.xml') + glob.glob('*.html'):
    t = re.sub(r'\s+', ' ', re.sub(r'&nbsp;', ' ', re.sub(r'<[^>]+>', ' ', open(f, encoding='latin-1' if f.endswith('.html') else 'utf8').read())))
    open(f.rsplit('.', 1)[0] + '.txt', 'w', encoding='utf8').write(t)
for f in glob.glob('*.docx'):
    x = zipfile.ZipFile(f).read('word/document.xml').decode('utf8')
    open(f[:-5] + '.txt', 'w', encoding='utf8').write(re.sub(r'<[^>]+>', '', re.sub(r'</w:p>', '\n', x)))
EOF
sha256sum ./* | sort -k2
