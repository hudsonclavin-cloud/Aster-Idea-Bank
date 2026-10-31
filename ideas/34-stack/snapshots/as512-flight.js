/* Saturn V AS-512 (Apollo 17) as flown, from NASA's flight evaluation report:
 *   MPR-SAT-FE-73-1 (NASA-TM-X-69534), "Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17
 *   Mission", Saturn Flight Evaluation Working Group, NASA Marshall Space Flight Center, 28 February 1973.
 *   NTRS 19730025089, https://ntrs.nasa.gov/api/citations/19730025089/downloads/19730025089.pdf
 *   (sha256 8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42, 292 pages).
 *
 * HAND-TRANSCRIBED from the pages rendered at 170-400 dpi with pdftoppm: the PDF text layer of every table here is
 * unreadable OCR (Table 16-9 comes out as "~-1' STAG~E~,~T~ru,I~A.~L"), so the numbers were read off the images.
 * Every Table 16-9 row carries the report's own pound-mass figure where it is legible (null where it is not), and
 * stack.test.mjs checks kg x 2.20462 against it, every "AT" subtotal against the rows above it, and the stage
 * tables (16-1, 16-3, 16-5, 16-7) against Table 16-9: three independent readings that catch a misread digit.
 * Prose numbers (S-II thrust, burn times) are also in snapshots/as512-sources.txt, the verbatim text layer.
 * Units as printed: kg, lbm, lbf, lbm/s, lbf-s/lbm, s (range time from range zero), m/s, m/s^2, km.
 * ACTUAL (reconstructed) columns only; PREDICTED columns are not used.
 * Loads as a classic script (window.AS512_FLIGHT) and with require().
 */
(function (root) {
  var D = {
    id: 'AS-512',
    label: 'Saturn V AS-512 (Apollo 17), as flown',
    report: 'MPR-SAT-FE-73-1 (NASA-TM-X-69534), Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17 Mission, NASA MSFC, 28 Feb 1973 (NTRS 19730025089)',
    launch: '7 December 1972, 00:33:00 EST, Kennedy Space Center Complex 39 Pad A; flight azimuth 91.504 deg (abstract, PDF page 3)',

    // Table 16-9, Flight Sequence Mass Summary, printed pages 16-11 and 16-12 (PDF pages 235-236), ACTUAL columns.
    // [row as printed, kg, lbm]. Rows whose name ends in "AT ..." are running totals of the vehicle.
    sequence: [
      ['S-IC STAGE, TOTAL', 2285679, 5039062],
      ['S-IC/S-II IS, TOTAL', 4524, 9975],
      ['S-II STAGE, TOTAL', 492557, 1085902],
      ['S-II/S-IVB IS, TOTAL', 3637, 8019],
      ['S-IVB STAGE, TOTAL', 120695, 266087],
      ['INSTRUMENT UNIT', 2027, 4470],
      ['SPACECRAFT, TOTAL', 52738, 116269],
      ['1ST FLT STG AT IGN', 2961859, 6529784],
      ['THRUST BUILDUP', -44015, -97037],
      ['1ST FLT STG AT HDAR', 2917843, 6432746],
      ['FROST', -294, -650],
      ['MAINSTAGE', -2076017, -4576836],
      ['N2 PURGE GAS', -16, -37],
      ['THRUST DECAY-IE', -997, -2198],
      ['ENG EXPENDED PROP', -189, -418],
      ['S-II INSUL PURGE', -17, -38],
      ['S-II FROST', -204, -450],
      ['S-IVB FROST', -90, -200],
      ['THRUST DECAY-OE', 0, 0],
      ['1ST FLT STG AT OECO', 840016, 1851919],
      ['THRUST DECAY-OE', -3988, -8793],
      ['S-IC/S-II ULL RKT', 0, 0],
      ['1ST FLT STG AT SEP', 836027, 1843126],
      ['STG AT SEPARATION', -160159, -353091],
      ['S-IC/S-II SMALL IS', -616, -1359],
      ['S-IC/S-II ULL RKT', 0, 0],
      ['2ND FLT STG AT SSC', 675251, 1488675],
      ['FUEL LEAD', 0, 0],
      ['S-IC/S-II ULL RKT', 0, 0],
      ['2ND FLT STG AT IGN', 675251, 1488675],
      ['THRUST BUILDUP', -582, -1284],
      ['START TANK', -11, -25],
      ['S-IC/S-II ULL RKT', 0, 0],
      ['2ND FLT STG AT MS', 674657, 1487366],
      ['MAINSTAGE', -449797, -991633],
      ['LES', -4129, -9104],
      ['S-IC/S-II LARGE IS', -3908, -8616],
      ['TD & ENG PROP', -44, -97],
      ['2ND FLT STG AT COS', 216778, 477915],
      ['THRUST DECAY', -108, -238],
      ['S-IVB ULL RKT PROP', -2, -5],
      ['2ND FLT STG AT SEP', 216668, 477671],
      ['STG AT SEPARATION', -41791, -92135],
      ['S-II/S-IVB IS DRY', -3154, -6955],
      ['S-II/S-IVB PROP', -482, -1064],
      ['S-IVB AFT FRAME', -21, -48], // the kg column prints "21." without its minus sign; lbm prints -48
      ['S-IVB ULL RKT PROP', -1, -3],
      ['S-IVB DET PKG', -1, -3],
      ['3RD FLT STG 1ST SSC', 171214, 377463],
      ['ULLAGE ROCKET PROP', -39, null],
      ['FUEL LEAD', -1, -3],
      ['3RD FLT STG 1ST IGN', 171173, 377372],
      ['ULLAGE ROCKET PROP', -9, -22],
      ['START TANK', -1, null],
      ['THRUST BUILDUP', -160, null],
      ['3RD FLT STG 1ST MS', 171000, 376992],
      ['ULLAGE ROCKET CASE', -61, -135],
      ['MAINSTAGE', -30006, -66152],
      ['APS', -3, -7],
      ['3RD FLT STG 1ST COS', 140930, null],
      ['THRUST DECAY', -36, null],
      ['3RD FLT STG 1ST ETD', 140893, null],
      ['ENGINE PROP', -18, -40],
      ['FUEL TANK LOSS', -1041, -2297],
      ['LOX TANK LOSS', 0, 0],
      ['APS', -63, -141],
      ['START TANK', 0, -2],
      ['O2/H2 BURNER', -7, -16],
      ['3RD FLT STG 2ND SSC', 139761, 308122],
      ['FUEL LEAD', -11, -25],
      ['3RD FLT STG 2ND IGN', 139750, 308097],
      ['START TANK', -1, -4],
      ['THRUST BUILDUP', -198, null],
      ['3RD FLT STG 2ND MS', 139549, 307655],
      ['MAINSTAGE', -73828, -162764],
      ['APS', -4, -11],
      ['3RD FLT STG 2ND COS', 65711, 144869],
      ['THRUST DECAY', -42, null],
      ['3RD FLT STG 2ND ETD', 65664, 144765],
    ],

    // Stage mass tables, ACTUAL columns, kilograms: Table 16-1 (S-IC burn, printed page 16-3, PDF page 227),
    // 16-3 (S-II burn, 16-5, PDF 229), 16-5 (S-IVB first burn, 16-7, PDF 231), 16-7 (S-IVB second burn, 16-9,
    // PDF 233). Per event: range time (s), DRY STAGE, LOX = "LOX IN TANK" + "LOX BELOW TANK", FUEL = "FUEL IN
    // TANK" + "FUEL BELOW TANK" (the two rows given separately), TOTAL of the burning stage, TOTAL VEHICLE.
    stageTables: {
      'S-IC': { table: '16-1', page: 227, events: {
        // review: the column's other seven rows (LOX ULLAGE GAS, FUEL ULLAGE GAS, N2 PURGE GAS, HELIUM IN BOTTLE, FROST,
        // RETROROCKET PROP, OTHER), so the test that sums the column to its total reads them from here
        'ground ignition': { t: -6.55, dry: 130342, lox: [1482255, 21126], fuel: [645190, 4318], stage: 2285680, vehicle: 2961860,
          otherRows: [['LOX ULLAGE GAS', 191], ['FUEL ULLAGE GAS', 30], ['N2 PURGE GAS', 36], ['HELIUM IN BOTTLE', 288], ['FROST', 635], ['RETROROCKET PROP', 1026], ['OTHER', 239]] },
        'holddown arm release': { t: 0.24, dry: 130342, lox: [1447435, 21886], fuel: [633521, 6001], stage: 2241664, vehicle: 2917844 },
        'center engine cutoff': { t: 139.30, dry: 130342, lox: [158699, 21869], fuel: [76625, 6001], stage: 398652, vehicle: 1074520 },
        // OECO range time printed "161.2" with an illegible last digit; Tables 2-2 and 4-2 give 161.20
        'outboard engine cutoff': { t: null, dry: 130342, lox: [810, 15736], fuel: [5968, 5963], stage: 164148, vehicle: 840016 } } },
      'S-II': { table: '16-3', page: 229, events: {
        'S-II ignition': { t: 164.59, dry: 36479, lox: [382137, 737], fuel: [72668, 110], stage: 492335, vehicle: 675251 },
        'S-II mainstage': { t: 166.33, dry: 36479, lox: [381684, 800], fuel: [72455, 127], stage: 491741, vehicle: 674658 },
        'S-II engine cutoff': { t: 559.66, dry: 36479, lox: [635, 787], fuel: [1248, 123], stage: 41900, vehicle: 216778 } } },
      'S-IVB burn 1': { table: '16-5', page: 231, events: {
        'S-IVB ignition': { t: 563.83, dry: 11334, lox: [88572, 166], fuel: [19819, 23], stage: 120536, vehicle: 171173 },
        'S-IVB mainstage': { t: 565.22, dry: 11324, lox: [88443, 180], fuel: [19773, 23], stage: 120363, vehicle: 171000 },
        'S-IVB engine cutoff': { t: 702.65, dry: 11273, lox: [63344, 180], fuel: [14802, 23], stage: 90293, vehicle: 140930 } } },
      'S-IVB burn 2': { table: '16-7', page: 233, events: {
        'S-IVB ignition': { t: 11556.60, dry: 11273, lox: [63281, 166], fuel: [13606, 23], stage: 89113, vehicle: 139750 },
        'S-IVB mainstage': { t: 11559.10, dry: 11273, lox: [63155, 180], fuel: [13520, 23], stage: 88913, vehicle: 139549 },
        'S-IVB engine cutoff': { t: 11907.64, dry: 11273, lox: null, fuel: null, stage: 15074, vehicle: 65711 } } },
    },

    // Table 2-2, Significant Event Times Summary, printed pages 2-4 to 2-6 (PDF pages 37-39), range time (s)
    events: {
      holddownRelease: 0.2,      // item 10, "ALL HOLDDOWN ARMS RELEASED (FIRST MOTION)"; the mass tables give 0.24
      sicCeco: 139.30,           // item 19
      sicOeco: 161.20,           // item 22
      siiEsc: 163.6,             // item 28
      siiIgnitionStdv: 164.6,    // item 29
      siiMainstage: 166.4,       // item 30
      siiAftInterstageJettison: 192.9, // item 34, "S-II SECOND PLANE SEPARATION COMMAND (JETTISON S-II AFT INTERSTAGE)"
      letJettison: null,         // item 35, "LAUNCH ESCAPE TOWER (LET) JETTISON": "*Data not available."
      siiCeco: 461.21,           // item 37
      siiEmrShift: 489.2,        // item 39, "S-II LOW ENGINE MIXTURE RATIO (EMR) SHIFT (ACTUAL)"
      siiOeco: 559.66,           // item 41
      sivbIgnitionStdv: 563.8,   // item 47
      sivbMainstage: 566.2,      // item 48
      sivbUllageCaseJettison: 572.4, // item 50
      sivbFirstEco: 702.65,      // item 55
      parkingOrbitInsertion: 712.6, // item 61
    },

    // Table 4-1, Comparison of Significant Trajectory Events, printed page 4-5 (PDF page 60): maximum total
    // non-gravitational acceleration ("Nearest Time Points Available"), ACTUAL. [range time s, m/s^2, ft/s^2, g]
    acceleration: {
      firstMotion: [0.24, 10.60, 34.78, 1.08],
      sic: [161.20, 37.95, 124.51, 3.87],
      sii: [461.21, 17.07, 56.00, 1.74],
      sivb1: [702.66, 6.54, 21.46, 0.67],
      sivb2: [11907.65, 13.86, 45.47, 1.41],
    },
    // Table 4-2, Comparison of Cutoff Events, printed page 4-6 (PDF page 61), ACTUAL. [range time s, altitude km,
    // space-fixed velocity m/s, same in ft/s]. The S-IC CECO velocity is smudged and not transcribed.
    cutoff: {
      sicOeco: [161.20, 66.5, 2746.9, 9012.1],
      siiCeco: [461.21, 173.0, 5620.4, 18439.6],
      siiOeco: [559.66, 172.6, 6990.1, 22933.4],
      sivb1Gcs: [702.69, 170.5, 7802.3, 25598.1],
      sivb2Gcs: [11907.64, 300.0, 10844.6, 35579.4],
    },
    // Table 4-2, same page, S-IVB second guidance cutoff, "C3, m^2/s^2 (ft^2/s^2)": [ACTUAL, NOMINAL, ACT-NOM], each
    // [m^2/s^2, ft^2/s^2] (added in review). The ACTUAL ft^2/s^2 entry's third digit is smudged (it reads as 9 or 8);
    // NOMINAL + ACT-NOM = -19,086,760 settles it, and the m^2/s^2 column agrees.
    c3AtSivb2Gcs: { actual: [-1773218, -19086760], nominal: [-1769310, -19044694], difference: [-3908, -42066] },
    // Table 4-4, Parking Orbit Insertion Conditions, printed page 4-8 (PDF page 63), ACTUAL
    parkingOrbit: { t: 712.66, altitudeKm: 170.5, velocity: 7804.1, velocityFt: 25604.0, flightPathDeg: 0.003, inclinationDeg: 28.526,
      eccentricity: 0.0000, apogeeKm: 167.2, perigeeKm: 166.6, periodMin: 87.83 },

    // Engine performance as reconstructed from flight
    engines: {
      // Table 5-2, S-IC Individual Standard Sea Level Engine Performance, printed page 5-6 (PDF page 71),
      // RECONSTRUCTION ANALYSIS column, engines 1-5: "Performance levels were reduced to standard sea level and pump
      // inlet conditions. Data were taken from the 35 to 38-second time slice."
      f1StandardSeaLevel: { thrustKlbf: [1516, 1515, 1523, 1524, 1521], ispS: [265.0, 265.7, 265.2, 265.4, 264.9],
        flowLbmS: [5722, 5702, 5742, 5742, 5741], mixtureRatio: [2.248, 2.284, 2.257, 2.263, 2.280], predictedThrustKlbf: 1522 },
      // Section 6.3 (PDF page 84), prose: "At ESC +61 seconds, total stage thrust was 1,156,694 lbf
      // ... Total propellant flowrate including pressurization flow, was 2743.4 lbm/s ... Stage specific impulse,
      // including the effect of pressurization gas flowrate, was 421.6 lbf-s/lbm"; "S-II burn duration was 396.1
      // seconds" (five J-2 engines, high EMR 5.5 phase; section 6.5 gives the 4.8 start and 5.5 high EMR).
      siiStageEsc61: { engines: 5, thrustLbf: 1156694, flowLbmS: 2743.4, ispS: 421.6, burnDurationS: 396.1, lowEmrThrustLbf: 787009 },
      // Table 7-1 (PDF page 103) and Table 7-2 (printed page 7-14, PDF page 111), S-IVB Steady State
      // Performance, RECONSTRUCTION column, "at Standard Altitude Conditions"; burn times from section 7.1 (PDF page 98)
      sivbFirstBurn: { thrustLbf: 205797, ispS: 427.7, loxFlowLbmS: 401.26, fuelFlowLbmS: 79.96, mixtureRatio: 5.018, burnTimeS: 138.8 },
      sivbSecondBurn: { thrustLbf: 205608, ispS: 427.6, loxFlowLbmS: 400.95, fuelFlowLbmS: 79.91, mixtureRatio: 5.018, burnTimeS: 351.0 },
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.AS512_FLIGHT = D;
})(typeof self !== 'undefined' ? self : this);
