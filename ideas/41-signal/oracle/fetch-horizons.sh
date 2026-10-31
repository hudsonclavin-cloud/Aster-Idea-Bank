#!/bin/bash
# The JPL Horizons queries behind snapshots/horizons-geometry.js (retrieved 2026-10-31). Run in an empty directory, then
#   node ideas/41-signal/build-data.mjs <that directory>
# Station sites are given to Horizons as ITRF93 cylindrical coordinates (810-005 module 301 Table 2).
set -e
H="https://ssd.jpl.nasa.gov/api/horizons.api"
DSS26CYL="243.126983580,5209.766362,3668.871755"; DSS36CYL="148.978544233,5205.719750,-3674.083901"; DSS56CYL="355.747939306,4862.806461,4114.646987"
obs(){ local name=$1 cmd=$2 ctr=$3 q=$4 a=$5 b=$6 s=$7; shift 7
  curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$cmd'" --data-urlencode "OBJ_DATA='NO'" --data-urlencode "MAKE_EPHEM='YES'" \
   --data-urlencode "EPHEM_TYPE='OBSERVER'" --data-urlencode "CENTER='$ctr'" --data-urlencode "START_TIME='$a'" --data-urlencode "STOP_TIME='$b'" \
   --data-urlencode "STEP_SIZE='$s'" --data-urlencode "QUANTITIES='$q'" --data-urlencode "CSV_FORMAT='YES'" --data-urlencode "ANG_FORMAT='DEG'" \
   --data-urlencode "EXTRA_PREC='YES'" --data-urlencode "APPARENT='AIRLESS'" "$@" > $name.txt; }
vec(){ local name=$1 cmd=$2 ctr=$3 a=$4 b=$5 s=$6
  curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$cmd'" --data-urlencode "OBJ_DATA='NO'" --data-urlencode "MAKE_EPHEM='YES'" \
   --data-urlencode "EPHEM_TYPE='VECTORS'" --data-urlencode "CENTER='$ctr'" --data-urlencode "START_TIME='$a'" --data-urlencode "STOP_TIME='$b'" \
   --data-urlencode "STEP_SIZE='$s'" --data-urlencode "REF_SYSTEM='ICRF'" --data-urlencode "REF_PLANE='FRAME'" --data-urlencode "VEC_TABLE='2'" --data-urlencode "VEC_CORR='NONE'" \
   --data-urlencode "OUT_UNITS='KM-S'" --data-urlencode "CSV_FORMAT='YES'" --data-urlencode "TIME_TYPE='UT'" > $name.txt; }
tv(){ curl -sS -G "$H" --data-urlencode "format=text" --data-urlencode "COMMAND='$2'" --data-urlencode "OBJ_DATA='NO'" --data-urlencode "MAKE_EPHEM='YES'" --data-urlencode "EPHEM_TYPE='VECTORS'" \
   --data-urlencode "CENTER='500@10'" --data-urlencode "TLIST=$3" --data-urlencode "TLIST_TYPE='JD'" --data-urlencode "TIME_TYPE='UT'" --data-urlencode "REF_SYSTEM='ICRF'" \
   --data-urlencode "REF_PLANE='FRAME'" --data-urlencode "VEC_TABLE='2'" --data-urlencode "VEC_CORR='NONE'" --data-urlencode "OUT_UNITS='KM-S'" --data-urlencode "CSV_FORMAT='YES'" > $1.txt; }
obs ds1-obs -30 500@399 '20,21,23' 2000-10-15 2000-12-10 '1 d'
vec ds1-vec -30 500@10 2000-10-15 2000-12-10 '1 d'
vec ds1-earth 399 500@10 2000-10-15 2000-12-10 '1 d'
obs juno-dss26 -61 'coord@399' '4,20,21' '2012-07-05 19:12' '2012-07-05 19:13' '1 m' --data-urlencode "COORD_TYPE='CYLINDRICAL'" --data-urlencode "SITE_COORD='$DSS26CYL'"
vec juno-geo -61 500@399 '2012-07-05 18:42' '2012-07-05 19:12' '30 m'
obs dawn-dct -203 500@399 '20,21,23' '2014-12-16 00:00' '2014-12-16 00:01' '1 m'
obs dawn-2009 -203 500@399 '20,21,23' '2009-05-31 00:00' '2009-06-08 00:00' '1 d'
obs apo-obs 99942 500@399 '1,20,21,23' '2026-07-02 14:00' '2029-07-01 14:00' '10 d'
obs apo-arr 99942 500@399 '1,20,21,23' '2028-05-09 18:15' '2028-05-09 18:16' '1 m'
obs apo-flyby 99942 500@399 '1,20,21,23' '2029-04-10' '2029-04-17' '12 h'
for s in 26 36 56; do v=DSS${s}CYL; obs apo-dss$s 99942 'coord@399' '4' '2028-05-09 00:00' '2028-05-10 00:00' '1 h' --data-urlencode "COORD_TYPE='CYLINDRICAL'" --data-urlencode "SITE_COORD='${!v}'"; done
vec apo-geo 99942 500@399 '2028-05-09 00:00' '2028-05-10 00:00' '1 h'
# Apophis (at each observer epoch and an hour before) and the Earth (at each epoch), heliocentric, by TLIST in chunks of 40
node -e '
const fs=require("fs");const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const rows=(f)=>{const t=fs.readFileSync(f,"utf8");return t.slice(t.indexOf("$$SOE")+5,t.indexOf("$$EOE")).trim().split("\n");};
const ep=[];for(const f of ["apo-obs.txt","apo-arr.txt","apo-flyby.txt"])for(const r of rows(f)){const m=r.trim().match(/^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);ep.push(Date.UTC(+m[1],M[m[2]],+m[3],+m[4],+m[5])/864e5+2440587.5);}
const u=[...new Set(ep.map(x=>x.toFixed(9)))].sort(), all=[...new Set(u.flatMap(j=>[(+j).toFixed(9),(+j-1/24).toFixed(9)]))].sort();
fs.writeFileSync("recv.lst",u.join("\n")+"\n");fs.writeFileSync("both.lst",all.join("\n")+"\n");'
split -l 40 -d both.lst bothpart_; split -l 40 -d recv.lst recvpart_
for p in bothpart_*; do tv apo-vec-$p 99942 "$(paste -sd' ' $p | sed "s/\([0-9.]*\)/'\1'/g")"; done
for p in recvpart_*; do tv earth-vec-$p 399 "$(paste -sd' ' $p | sed "s/\([0-9.]*\)/'\1'/g")"; done
rm -f both.lst recv.lst bothpart_* recvpart_*
