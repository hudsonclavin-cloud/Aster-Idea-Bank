#!/usr/bin/env bash
# Downloads every primary source idea 43 (Lumpy) uses, into the current (empty) directory. Run once; then
#   python3 ../ideas/43-lumpy/build_data.py <this directory>      (needs spiceypy + numpy: a throw-away venv)
#   python3 ../ideas/43-lumpy/oracle/oracle.py <this directory>   (needs polyhedral-gravity, harmonica, spiceypy, scipy)
# Retrieved 2026-10-31. The page never touches the network; these are build-time inputs only.
set -euo pipefail
NAIF=https://naif.jpl.nasa.gov/pub/naif
# Shape models (SPICE DSK type 2): Apophis radar model (Brozovic et al. 2018, "Apophis RAD v001", ~25 m plates) and
# Bennu OLA altimetry model v021 at 12.6 m (Daly et al. 2020), both delivered by the OSIRIS-REx/APEX project to NAIF.
curl -sS -O $NAIF/ORX/kernels/dsk/apophis_g_25000mm_rad_obj_0000n00000_v001.bds
curl -sS -O $NAIF/ORX/kernels/dsk/bennu_g_12600mm_alt_obj_0000n00000_v021.bds
# Orientation: Bennu's PCK (pole and prime meridian), Apophis's non-principal-axis CK (Pravec et al. 2014 spin state,
# 15-minute samples) with the frame kernel that defines APOPHIS_CK and its artificial SCLK, the leap-second kernel.
curl -sS -O $NAIF/ORX/kernels/pck/bennu_v17.tpc
curl -sS -O $NAIF/ORX/kernels/pck/apophis_v01.tpc
curl -sS -O $NAIF/ORX/kernels/ck/apophis_npa_220101_330101_nominal_pravec_v1.bc
curl -sS -O $NAIF/ORX/kernels/ck/apophis_npa_220101_330101_cuni_A_v1.bc   # its comment names the 2029 encounter epoch
curl -sS -O $NAIF/ORX/kernels/fk/orx_shape_v04.tf
curl -sS -O $NAIF/ORX/kernels/fk/orx_v15.tf
curl -sS -O $NAIF/generic_kernels/lsk/naif0012.tls
# Published geophysics (open access, PubMed Central JATS XML): Scheeres et al. 2020 Sci. Adv. 6:eabc3350 (Bennu's
# measured gravity field, Table 1) and Barnouin et al. 2019 Nat. Geosci. 12:247 (Bennu's physical parameters, Table 1).
E=https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
curl -sS -g -o pmc7544499.xml "$E?db=pmc&id=7544499&rettype=xml"
curl -sS -g -o pmc6505705.xml "$E?db=pmc&id=6505705&rettype=xml"
# JPL Horizons: OSIRIS-REx (-64, reconstructed) relative to Bennu in Orbital B, and Bennu about the Sun, ICRF, TDB.
H="https://ssd.jpl.nasa.gov/api/horizons.api"
vec() { curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$1'" --data-urlencode "OBJ_DATA='NO'" \
  --data-urlencode "MAKE_EPHEM='YES'" --data-urlencode "EPHEM_TYPE='VECTORS'" --data-urlencode "CENTER='$2'" \
  --data-urlencode "START_TIME='$3'" --data-urlencode "STOP_TIME='$4'" --data-urlencode "STEP_SIZE='$5'" \
  --data-urlencode "REF_PLANE='FRAME'" --data-urlencode "VEC_TABLE='2'" --data-urlencode "OUT_UNITS='KM-S'" --data-urlencode "CSV_FORMAT='YES'"; }
vec -64 500@2101955 2019-06-18 2019-06-26 '30 m' > horizons-orex-orbitb.txt
vec 2101955 500@10 2019-06-18 2019-06-26 '30 m' > horizons-bennu-helio.txt
sha256sum * > SHA256SUMS
