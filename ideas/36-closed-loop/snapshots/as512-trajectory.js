/* Saturn V AS-512 (Apollo 17) ascent trajectory as reconstructed after flight, from NASA's flight evaluation report:
 *   MPR-SAT-FE-73-1 (NASA-TM-X-69534), "Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17
 *   Mission", Saturn Flight Evaluation Working Group, NASA Marshall Space Flight Center, 28 February 1973.
 *   NTRS 19730025089, https://ntrs.nasa.gov/api/citations/19730025089/downloads/19730025089.pdf
 *   (sha256 8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42, the same PDF idea 34 transcribed).
 *
 * HAND-TRANSCRIBED from the pages rendered at 300 and 500 dpi with pdftoppm (the tables' text layer is unreadable OCR).
 * ACTUAL columns only. Where an ACTUAL entry is smudged, the value is NOMINAL + (ACT-NOM), both legible, and the
 * entry says so; ascent.test.mjs checks every m/s against its ft/s, every km against its n mi, and those
 * reconstructions against the legible digits of the smudged entry.
 * Units as printed: range time s (range zero 05:33:00 GMT; first motion at 0.24 s), km, n mi, m/s, ft/s, deg,
 * N/cm^2, lbf/ft^2. Altitudes in these tables are geodetic (above the ellipsoid); apogee and perigee in Table 4-4
 * are not (see `insertion`). "Space-fixed" velocity is inertial (Earth-centred, non-rotating); "Earth-fixed" is
 * relative to the rotating Earth.
 * Loads as a classic script (window.AS512_TRAJECTORY) and with require().
 */
(function (root) {
  var D = {
    report: 'MPR-SAT-FE-73-1 (NASA-TM-X-69534), Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17 Mission, NASA MSFC, 28 Feb 1973 (NTRS 19730025089)',
    // Section 4.1 (printed page 4-1, PDF page 56): "The vehicle was launched on an azimuth 90 degrees east of north. A
    // roll maneuver was initiated at 13.0 seconds that placed the vehicle on a flight azimuth of 91.504 degrees east
    // of north." (the text layer reads "13.0"; Table 2-2 item 14 gives 12.9 for the start of pitch and roll)
    launchAzimuthDeg: 90, flightAzimuthDeg: 91.504,
    // Section 4.2.1 (PDF page 57): Mach number and dynamic pressure "were calculated using meteorological data measured
    // to an altitude of 58.3 kilometers (31.5 n mi). Above this altitude, the measured data were merged into the U.S.
    // Standard Reference Atmosphere."
    metDataTopKm: 58.3,
    // Table 2-2, Significant Event Times Summary, printed page 2-4 (PDF page 37), ACTUAL range time, s
    events: {
      firstMotion: 0.2,          // item 10, ALL HOLDDOWN ARMS RELEASED (FIRST MOTION); Table 4-1 gives 0.24
      beginTowerYaw: 1.7,        // item 12, BEGIN TOWER CLEARANCE YAW MANEUVER
      endTowerYaw: 9.7,          // item 13, END YAW MANEUVER
      beginPitchRoll: 12.9,      // item 14, BEGIN PITCH AND ROLL MANEUVER (time from base 12.3 + T1 at 0.6)
      endRoll: 14.3,             // item 16, END ROLL MANEUVER
      outboardCant: 20.6,        // item 15, S-IC OUTBOARD ENGINE CANT
      mach1: 67.5,               // item 17, MACH 1
      maxQ: 82.5,                // item 18, MAXIMUM DYNAMIC PRESSURE (MAX Q)
      ceco: 139.30,              // item 19, S-IC CENTER ENGINE CUTOFF
      tiltArrest: 160.1,         // item 21, END PITCH MANEUVER (TILT ARREST)
      oeco: 161.20,              // item 22, S-IC OUTBOARD ENGINE CUTOFF
    },
    // Table 4-1, Comparison of Significant Trajectory Events, printed page 4-5 (PDF page 60), ACTUAL
    mach1: { t: 67.5, altitudeKm: 8.0, altitudeNmi: 4.3 },
    maxQ: { t: 82.5, qNcm2: 3.36, qLbfFt2: 701.75, altitudeKm: 13.1, altitudeNmi: 7.1 },
    // Appendix A.4.1 (PDF page 278, text layer): "Maximum dynamic pressure occurred at 13.06 kilometers (42,847 ft). At
    // max Q altitude, the wind speed and direction was 33.2 m/s (64.5 knots), from 314 degrees." A.4.3: "The maximum
    // tailwind, in the altitude range of 8 to 16 kilometers (26,247 to 52,493 ft), was 34.8 m/s (67.6 knots) observed
    // at 12.18 kilometers (39,944 ft) altitude."
    maxQAppendix: { altitudeKm: 13.06, altitudeFt: 42847, windMs: 33.2, windFromDeg: 314, maxTailwindMs: 34.8, maxTailwindAltKm: 12.18 },
    // Table 4-1, maximum Earth-fixed velocity ("nearest time points available"): [range time s, m/s, ft/s]
    maxEarthFixedVelocity: { sic: [162.00, 2374.4, 7790.0], sii: [560.60, 6573.8, 21567.6], sivb1: [712.66, 7385.6, 24231.0] },
    // Table 4-2, Comparison of Cutoff Events, printed page 4-6 (PDF page 61), ACTUAL.
    // [range time s, altitude km, altitude n mi, space-fixed velocity m/s, ft/s, flight path angle deg, heading deg,
    //  surface range km, surface range n mi, cross range km, cross range velocity m/s]
    cutoff: {
      sicCeco: { t: 139.30, altKm: 47.0, altNmi: 25.4, v: 2091.8, vFt: 6862.9, fpa: 23.199, heading: 91.355, rangeKm: 51.5, rangeNmi: 27.8, crossKm: 0.2, crossV: 1.5,
        smudged: { v: 'printed "2,_91.8" and "(_,_62.9)" with the marked digits illegible; 6,862.9 ft/s x 0.3048 = 2,091.8 m/s' } },
      sicOeco: { t: 161.20, altKm: 66.5, altNmi: 35.9, v: 2746.9, vFt: 9012.1, fpa: 20.429, heading: 91.718, rangeKm: 91.0, rangeNmi: 49.1, crossKm: 0.3, crossV: 6.4,
        smudged: { fpa: 'printed "_.429"; NOMINAL 20.473 + ACT-NOM -0.044', heading: 'illegible; NOMINAL 91.892 + ACT-NOM -0.174', rangeKm: 'printed "_1.0"; NOMINAL 91.6 + ACT-NOM -0.6' },
        nominal: { fpa: 20.473, heading: 91.892, rangeKm: 91.6 }, actMinusNom: { fpa: -0.044, heading: -0.174, rangeKm: -0.6 } },
      siiCeco: { t: 461.21, altKm: 173.0, altNmi: 93.4, v: 5620.4, vFt: 18439.6, fpa: -0.058, heading: 97.647, rangeKm: 1095.0, rangeNmi: 591.3, crossKm: 18.6, crossV: 135.4 },
      siiOeco: { t: 559.66, altKm: 172.6, altNmi: 93.2, v: 6990.1, vFt: 22933.4, fpa: 0.254, heading: 100.395, rangeKm: 1657.6, rangeNmi: 895.0, crossKm: 34.8, crossV: 194.9 },
      sivb1Gcs: { t: 702.69, altKm: 170.5, altNmi: 92.1, v: 7802.3, vFt: 25598.1, fpa: 0.001, heading: 104.718,
        smudged: { fpa: 'printed "0.0_1"; NOMINAL -0.002 + ACT-NOM 0.003' }, nominal: { fpa: -0.002 }, actMinusNom: { fpa: 0.003 } },
    },
    // Table 4-4, Parking Orbit Insertion Conditions, printed page 4-8 (PDF page 63), ACTUAL. Apogee and perigee are
    // [Likely] heights above a sphere of the equatorial radius: 166.6 km of perigee with eccentricity 0.0000 against a
    // geodetic insertion altitude of 170.5 km at 24.680 deg N is the ellipsoid's ~4 km of polar flattening at that
    // latitude (the report does not say which reference it uses).
    insertion: { t: 712.66, altKm: 170.5, altNmi: 92.1, v: 7804.1, vFt: 25604.0, fpa: 0.003, heading: 105.021, inclination: 28.526, descendingNode: 86.978,
      eccentricity: 0.0000, apogeeKm: 167.2, apogeeNmi: 90.3, perigeeKm: 166.6, perigeeNmi: 90.0, periodMin: 87.83, latitude: 24.680, longitude: -53.810 },
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.AS512_TRAJECTORY = D;
})(typeof self !== 'undefined' ? self : this);
