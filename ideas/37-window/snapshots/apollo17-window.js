/* Apollo 17's launch window and parking orbit, as the flight report and the press kit give them: the data Window checks
 * its launch geometry, its window and its J2 coast against.
 *
 *   [R] MPR-SAT-FE-73-1 (NASA-TM-X-69534), "Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17
 *       Mission", NASA MSFC, 28 Feb 1973. NTRS 19730025089, sha256 8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42
 *       (the PDF ideas 34, 35 and 36 transcribed).
 *   [P] "Apollo 17" press kit, NASA release 72-220K, 26 Nov 1972. NTRS 20090012049, sha256
 *       1e09036f4f99086a63300e13ca62667253577236ea9d343e9f2d1590d3143fca.
 *
 * HAND-TRANSCRIBED by idea 37 from page images rendered with pdftoppm at 120 to 200 dpi (PDF page numbers per entry);
 * where the text layer disagrees with the image the image is used and the entry says so. Units as printed.
 * Loads as a classic script (window.APOLLO17_WINDOW) and with require().
 */
(function (root) {
  var D = {
    report: 'MPR-SAT-FE-73-1 (NASA-TM-X-69534), NASA MSFC, 28 Feb 1973 (NTRS 19730025089)',
    pressKit: 'Apollo 17 press kit, NASA release 72-220K, 26 Nov 1972 (NTRS 20090012049)',
    // [R] section 3.1, PDF page 46: "launched at 00:33:00 Eastern Standard Time (EST) (05:33:00 UT) on December 7, 1972,
    // from Pad 39A of the Kennedy Space Center"
    liftoffUtc: '1972-12-07T05:33:00Z',
    // [R] section 3.2.2, PDF page 48: "During the first unscheduled hold at 02:52:30 UT (T-30 seconds)": the scheduled
    // liftoff was 30 s later, 02:53:00 UT, which is [P]'s window opening, 9:53 pm EST on 6 December.
    holdUtc: '1972-12-07T02:52:30Z', holdAtTminus_s: 30,
    // [R] section 9.3.1 "Variable Launch Azimuth", PDF page 146: "The two hour 40 minute launch delay resulted in a change
    // of the flight azimuth from 72.141 degrees to 91.504 degrees East of North."
    azimuthScheduledDeg: 72.141, azimuthFlownDeg: 91.504, delayText: 'two hour 40 minute',
    // [P] page -20- (PDF page 25), "Launch Windows": "Launch windows are based on flight azimuth limits of 72 deg to
    // 100 deg (Earth-fixed heading east of north of the launch vehicle at the end of the roll program), on booster and
    // spacecraft performance, on insertion tracking, and on Sun elevation angle at the lunar landing site. All times are
    // EST." December 6, 1972: OPEN 9:53 pm EST, CLOSE 1:31 am, Sun elevation 13 deg. "* Launch azimuth limits for January
    // are 84 deg to 100 deg." (EST = UT - 5 h.)
    window: { date: 'December 6, 1972', openEst: '21:53', closeEst: '01:31', openUtc: '1972-12-07T02:53:00Z', closeUtc: '1972-12-07T06:31:00Z', azimuthLimitsDeg: [72, 100], januaryLimitsDeg: [84, 100] },
    // [R] Table 4-3, Comparison of Separation Events, PDF page 62 (ACTUAL): used to place Pad 39A (the report gives no
    // pad coordinates): the S-IC/S-II separation point, 94.7 km down range and 0.3 km cross range from the pad.
    sicSiiSeparation: { rangeTime: 162.9, altitudeKm: 68.1, surfaceRangeKm: 94.7, crossRangeKm: 0.3, headingDeg: 91.741, geodeticLatDeg: 28.580, longitudeEastDeg: -79.637 },
    siiSivbSeparation: { rangeTime: 560.6, surfaceRangeKm: 1663.6, crossRangeKm: 35.0, geodeticLatDeg: 26.865, longitudeEastDeg: -63.831 },
    // [R] Table 4-4, Parking Orbit Insertion Conditions, PDF page 63 (ACTUAL; the text layer reads "86.979", the image
    // 86.978, as idea 35 transcribed it): descending node measured eastward from the launch meridian, space-fixed.
    insertion: { rangeTime: 712.66, altitudeKm: 170.5, velocityMs: 7804.1, fpaDeg: 0.003, headingDeg: 105.021, inclinationDeg: 28.526, descendingNodeDeg: 86.978,
      perigeeKm: 166.6, apogeeKm: 167.2, periodMin: 87.83, geodeticLatDeg: 24.680, longitudeEastDeg: -53.810 },
    // [R] Table 4-5, Translunar Injection Conditions, PDF page 64 (ACTUAL; the image reads eccentricity 0.9720, the text
    // layer 0.9710). Second S-IVB ECO at 11,907.64 s (summary, text layer, PDF page 25).
    tli: { rangeTime: 11917.65, altitudeKm: 313.5, velocityMs: 10837.0, fpaDeg: 7.384, headingDeg: 118.116, inclinationDeg: 28.474, descendingNodeDeg: 86.061, eccentricity: 0.9720, c3_m2s2: -1695985 },
    secondEcoRangeTime: 11907.64,
    // [R] Table 16-7, Total Vehicle Mass - S-IVB Second Burn Phase - Kilograms, PDF page 233 (page image; the text
    // layer is unreadable), ACT columns: TOTAL VEHICLE 139,750 kg at S-IVB ignition (range time 11,556.60 s) and 65,711
    // kg at engine cutoff (11,907.64 s). Added by idea 37's independent review: the real translunar burn's mass ratio,
    // the yardstick for the delta-v the chain's propellant buys.
    tliBurn: { ignitionRangeTime: 11556.60, cutoffRangeTime: 11907.64, massIgnitionKg: 139750, massCutoffKg: 65711 },
    // [R] Table 2-1, Time Base Summary, PDF page 34 (text layer): T0 -16.96 s "Guidance Reference Release"; T6
    // 10,978.65 s (03:02:58.65) "Restart Equation Solution" (also section 4.2.2, PDF page 57).
    guidanceReferenceRelease_s: -16.96, timeBase6RangeTime: 10978.65,
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.APOLLO17_WINDOW = D;
})(typeof self !== 'undefined' ? self : this);
