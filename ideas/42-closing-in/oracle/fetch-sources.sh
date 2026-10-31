#!/bin/bash
# Every external source behind snapshots/ (retrieved 2026-10-31). Run in an empty directory, then
#   node ideas/42-closing-in/build-data.mjs <that directory>
# JPL Horizons (vectors and observer tables), JPL SBDB (physical parameters), NASA NTRS (AAS 19-035, AAS 24-063),
# NASA NSSDCA (spacecraft pages), the OSIRIS-REx press kit, the Horizons manual (magnitude law), NIST CODATA (G).
set -e
H="https://ssd.jpl.nasa.gov/api/horizons.api"
vec(){ local name=$1 cmd=$2 ctr=$3 a=$4 b=$5 s=$6
  curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$cmd'" --data-urlencode "OBJ_DATA='NO'" --data-urlencode "MAKE_EPHEM='YES'" \
   --data-urlencode "EPHEM_TYPE='VECTORS'" --data-urlencode "CENTER='$ctr'" --data-urlencode "START_TIME='$a'" --data-urlencode "STOP_TIME='$b'" \
   --data-urlencode "STEP_SIZE='$s'" --data-urlencode "REF_SYSTEM='ICRF'" --data-urlencode "REF_PLANE='FRAME'" --data-urlencode "VEC_TABLE='2'" --data-urlencode "VEC_CORR='NONE'" \
   --data-urlencode "OUT_UNITS='KM-S'" --data-urlencode "CSV_FORMAT='YES'" --data-urlencode "TIME_TYPE='TDB'" > $name.txt; }
tvec(){ local name=$1 cmd=$2 ctr=$3 list=$4 extra=${5:-2}
  curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$cmd'" --data-urlencode "OBJ_DATA='NO'" --data-urlencode "MAKE_EPHEM='YES'" \
   --data-urlencode "EPHEM_TYPE='VECTORS'" --data-urlencode "CENTER='$ctr'" --data-urlencode "TLIST=$list" --data-urlencode "TLIST_TYPE='JD'" --data-urlencode "TIME_TYPE='TDB'" \
   --data-urlencode "REF_SYSTEM='ICRF'" --data-urlencode "REF_PLANE='FRAME'" --data-urlencode "VEC_TABLE='$extra'" --data-urlencode "VEC_CORR='NONE'" \
   --data-urlencode "OUT_UNITS='KM-S'" --data-urlencode "CSV_FORMAT='NO'" > $name.txt; }
obs(){ local name=$1 cmd=$2 ctr=$3 a=$4 b=$5 s=$6
  curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$cmd'" --data-urlencode "OBJ_DATA='YES'" --data-urlencode "MAKE_EPHEM='YES'" \
   --data-urlencode "EPHEM_TYPE='OBSERVER'" --data-urlencode "CENTER='$ctr'" --data-urlencode "START_TIME='$a'" --data-urlencode "STOP_TIME='$b'" \
   --data-urlencode "STEP_SIZE='$s'" --data-urlencode "QUANTITIES='9,19,20,24'" --data-urlencode "CSV_FORMAT='YES'" --data-urlencode "EXTRA_PREC='YES'" > $name.txt; }
# OSIRIS-REx relative to Bennu (Horizons "ORX_merged", the reconstructed trajectory) and Bennu about the Sun
vec orex-daily -64 '500@2101955' '2018-08-01' '2018-12-04' '1 d'
vec bennu-daily 2101955 '500@10' '2018-08-01' '2018-12-04' '1 d'
vec orex-orbita -64 '500@2101955' '2019-01-01' '2019-01-11' '1 h'
vec bennu-orbita 2101955 '500@10' '2019-01-01' '2019-01-11' '1 h'
# around each Approach maneuver of AAS 19-035 Table 1 (epoch 17:00 UTC; TDB = UTC + 69.184 s): 12 h and 3 h either side
node -e '
const T=["2018-10-01","2018-10-15","2018-10-29","2018-11-05","2018-11-12","2018-11-30","2018-12-03"].map(d=>Date.parse(d+"T17:00:00Z")/864e5+2440587.5+69.184/86400);
const L=[];for(const t of T)for(const h of [-12,-3,3,12])L.push((t+h/24).toFixed(9));
require("fs").writeFileSync("burns.lst",L.join("\n")+"\n");'
tvec orex-burns -64 '500@2101955' "$(paste -sd' ' burns.lst)"
tvec bennu-burns 2101955 '500@10' "$(paste -sd' ' burns.lst)"
# JPL's OSIRIS-APEX predict at Apophis (after the Earth encounter) and Apophis about the Sun over the same days
vec apex-apophis -64 '500@2099942' '2029-04-17' '2029-08-01' '1 d'
# Apophis at the chain's arrival epoch (idea 40: TDB 894780969.184 s past J2000) with its 1-sigma uncertainties
tvec apophis-arrival 'DES=2099942;' '500@10' "$(node -e 'console.log((2451545+894780969.184/86400).toFixed(9))')" '2xarp'
# Apparent magnitudes (Horizons applies the IAU H-G law): Bennu seen from OSIRIS-REx, Apophis and Bennu seen from the Earth
obs bennu-from-orex 2101955 '500@-64' '2018-08-17' '2018-12-02' '5 d'
obs apophis-from-earth 'DES=2099942;' '500@399' '2026-01-01' '2028-12-31' '20 d'
# Small-Body Database physical parameters
for s in 99942 101955 162173 25143 433 65803; do curl -sS -o sbdb-$s.json "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=$s&phys-par=1"; done
# Horizons spacecraft records (masses, dimensions)
for s in -64 -37; do curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$s'" --data-urlencode "OBJ_DATA='YES'" --data-urlencode "MAKE_EPHEM='NO'" > horizons-record$s.txt; done
# Documents
curl -sSL -o aas19-035.pdf "https://ntrs.nasa.gov/api/citations/20190002612/downloads/20190002612.pdf"
curl -sSL -o aas24-063.pdf "https://ntrs.nasa.gov/api/citations/20240000812/downloads/AAS%20GNCC%202024%20Breckenridge%20-%20Paper%20-%20Draft%20V3.pdf"
curl -sSL -o orex-presskit.pdf "https://www.nasa.gov/sites/default/files/atoms/files/osiris-rex_press_kit_0.pdf"
for id in 1996-008A 2016-055A 2007-043A; do curl -sSL -o nssdc-$id.html "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=$id"; done
curl -sSL -o horizons-manual.html "https://ssd.jpl.nasa.gov/horizons/manual.html"
curl -sSL -o nist-G.html "https://physics.nist.gov/cgi-bin/cuu/Value?bg"
sha256sum * > SHA256SUMS
