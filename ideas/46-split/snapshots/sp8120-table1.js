/* NASA SP-8120, Liquid Rocket Engine Nozzles (1976), Table I, "Chief Features of Nozzles Used in Operational
 * High-Thrust Liquid Rocket Engines", printed pages 5-6 (PDF pages 19-20 of NTRS 19770009165, sha256
 * c6aa5043...f79f). HAND-TRANSCRIBED from the scan rendered at 300 dpi: the table is printed sideways and the
 * PDF text layer is unreadable there, so there is no verbatim text to quote; every row below is the table's
 * own wording, units as printed (lbf, psia, lbf-sec/lbm, inches, in^2, degrees). Conditions: 'vac' vacuum,
 * 'alt' altitude, 'sl' sea level, as printed. 'prop' maps the row to an idea-31 propellant preset id, or null
 * when idea 31 has no data for it (IRFNA, ammonia). '50:50' is the table's name for the N2O4 engines' fuel
 * (Aerozine 50, hydrazine and UDMH; the split by mass is assumed, the table does not say). The engines that
 * idea 32 compares with are those whose propellant idea 31 can burn and whose row gives one operating point.
 * Loads as a classic script (window.SP8120_TABLE1) and with require(). */
(function (root) {
  var ROWS = [
    { engine: 'RS-1801', application: 'Lunar Excursion Module ascent engine', thrust: [[3500, 'vac']], pc: [[120, 'vac']], isp: [[310, 'vac']],
      ox: 'N2O4', fuel: '50:50', mr: 1.60, acAt: 2.9, joint: 'Integral', entranceHalfAngle: '30.0',
      Dt: 4.578, At: 16.5, L: 35.27, exit: '72% bell', divergence: '-', De: 30.9, Ae: 750, eps: 45.6, extension: 'None', cooling: 'Film and ablation', prop: 'nto-a50' },
    { engine: 'AJ10-118', application: 'Delta second stage', thrust: [[7575, 'alt']], pc: [[206, 'alt']], isp: [[267, 'alt']],
      ox: 'IRFNA', fuel: 'UDMH', mr: 2.8, acAt: 3.27, joint: 'Welded', entranceHalfAngle: '25',
      Dt: 5.25, At: 21.64, L: 23.1, exit: 'Complex contour', divergence: '-', De: 23.5, Ae: 432.8, eps: 20, extension: 'Optional', cooling: 'Regenerative to 20:1; radiation to 30:1 or 40:1', prop: null },
    { engine: 'AJ10-138', application: 'Titan III transtage', thrust: [[8000, 'alt']], pc: [[105, 'alt']], isp: [[302, 'alt']],
      ox: 'N2O4', fuel: '50:50', mr: 2.0, acAt: 2.54, joint: 'Integral', entranceHalfAngle: '7.5',
      Dt: 7.48, At: 43.9, L: 49.61, exit: 'Bell', divergence: '-', De: 47.33, Ae: 1758.5, eps: 40, extension: 'Yes', cooling: 'Ablation to extension; radiation thereafter', prop: 'nto-a50' },
    { engine: 'VTR-10', application: 'Lunar Excursion Module descent engine', thrust: [[9850, 'vac']], pc: [[104, 'vac']], isp: [[305, 'vac']],
      ox: 'N2O4', fuel: '50:50', mr: 1.6, acAt: 2.52, joint: '-', entranceHalfAngle: '-',
      Dt: 8.320, At: 54.34, L: 62.11, exit: '72.3% bell, round entrance', divergence: '-', De: 57.26, Ae: 2574.0, eps: 47.5, extension: 'Yes', cooling: 'Ablation to 16:1; radiation to 47.5:1', prop: 'nto-a50' },
    { engine: 'RL10A-3-3', application: 'Centaur upper stage', thrust: [[15000, 'alt']], pc: [[400, 'alt']], isp: [[444, 'alt']],
      ox: 'LOX', fuel: 'LH2', mr: 5.0, acAt: 4, joint: 'Integral', entranceHalfAngle: '10.5',
      Dt: 5.14, At: 20.75, L: 46.3, exit: 'Bell', divergence: '32.5', De: 38.8, Ae: 1182.75, eps: 57, extension: 'None', cooling: 'Regenerative', prop: 'lox-lh2' },
    { engine: 'YLR81-BA-11', application: 'Agena upper stage', thrust: [[15800, 'vac']], pc: [[506, 'vac']], isp: [[298, 'vac']],
      ox: 'IRFNA', fuel: 'UDMH', mr: 2.57, acAt: 5.335, joint: 'Welded', entranceHalfAngle: '-',
      Dt: 4.670, At: 17.13, L: 39.8, exit: 'Bell', divergence: '25.7', De: 31.326, Ae: 770.32, eps: 45, extension: 'Yes', cooling: 'Regenerative to 13:1; radiation to 45:1', prop: null },
    { engine: 'AJ10-137', application: 'Apollo Service Module', thrust: [[20500, 'vac']], pc: [[97, 'vac']], isp: [[310, 'vac']],
      ox: 'N2O4', fuel: '50:50', mr: 1.6, acAt: 2.00, joint: 'Bolted', entranceHalfAngle: '7.5',
      Dt: 12.447, At: 121.675, L: 111.8, exit: 'Bell', divergence: '-', De: 98.40, Ae: 7605, eps: 62.5, extension: 'Yes', cooling: 'Ablation to 6:1; radiation to 62.5:1', prop: 'nto-a50' },
    { engine: 'YLR99-RM-1', application: 'X-15 aircraft; Pioneer spacecraft', thrust: [[49390, 'alt']], pc: [[600, 'alt']], isp: [[236, 'alt']],
      ox: 'LOX', fuel: 'NH3', mr: 1.25, acAt: 4.10, joint: 'Integral', entranceHalfAngle: '31.5',
      Dt: 8.64, At: 58.6, L: null, exit: 'Conical', divergence: '20', De: 27.20, Ae: 574.3, eps: 9.8, extension: 'None', cooling: 'Regenerative', prop: null },
    { engine: 'YLR113-AJ-1', application: 'Rocket sled', thrust: [['50 000 to 150 000', 'sl']], pc: [['235 to 595', 'sl']], isp: [['195 to 240', 'sl']],
      ox: 'N2O4', fuel: 'UDMH', mr: 2.1, acAt: 2.04, joint: 'Integral', entranceHalfAngle: '25',
      Dt: 15.25, At: 182.56, L: 35.41, exit: 'Conical', divergence: '17', De: 36.41, Ae: 1040.66, eps: 5.7, extension: 'None', cooling: 'Film', prop: 'nto-udmh',
      excluded: 'the row gives ranges (a throttled sled engine), not one operating point' },
    { engine: 'LR91-AJ-5', application: 'Titan II second stage', thrust: [[100000, 'alt']], pc: [[827, 'alt']], isp: [[321, 'alt']],
      ox: 'N2O4', fuel: '50:50', mr: 1.80, acAt: 2.51, joint: 'Integral', entranceHalfAngle: '30',
      Dt: 9.12, At: 65.41, L: 72, exit: 'Bell', divergence: '17', De: 64.0, Ae: 3217, eps: 49.2, extension: 'Yes', cooling: 'Regenerative to 13:1; ablation to 49.2:1', prop: 'nto-a50' },
    { engine: 'LR89-NA-7', application: 'Atlas MA-5 booster engine', thrust: [[330000, 'sl']], thrustNote: '2 thrust chambers', chambers: 2, pc: [[578, 'sl']], isp: [[254, 'sl']],
      ox: 'LOX', fuel: 'RP-1', mr: 2.28, acAt: 1.67, joint: 'Integral', entranceHalfAngle: '-',
      Dt: 16.2, At: 206.0, L: 58, exit: '100% bell', divergence: '-', De: 45.83, Ae: 1648.8, eps: 8, extension: 'None', cooling: 'Regenerative', prop: 'lox-rp1' },
    { engine: 'LR79-NA-11', application: 'Thor MB-3', thrust: [[169500, 'sl']], pc: [[588, 'sl']], isp: [[256, 'sl']],
      ox: 'LOX', fuel: 'RP-1', mr: 2.15, acAt: 1.67, joint: 'Integral', entranceHalfAngle: '10',
      Dt: 16.2, At: 206.0, L: 58, exit: '100% bell', divergence: '-', De: 45.8, Ae: 1646.6, eps: 8, extension: 'None', cooling: 'Regenerative', prop: 'lox-rp1' },
    { engine: 'H-1C and H-1D', application: 'S-1 stage of Saturn 1B launch vehicle', thrust: [[204300, 'sl'], [228800, 'alt']], pc: [[705, 'sl'], [707, 'alt']], isp: [[269, 'sl'], [301, 'alt']],
      ox: 'LOX', fuel: 'RP-1', mr: 2.23, acAt: 1.62, joint: 'Integral', entranceHalfAngle: '-',
      Dt: 16.16, At: 205, L: 55, exit: 'Bell', divergence: '-', De: 45.49, Ae: 1630, eps: 8, extension: 'Yes', cooling: 'Regenerative', prop: 'lox-rp1' },
    { engine: 'LR87-AJ-5', application: 'Titan II first stage', thrust: [[214400, 'sl'], [236400, 'alt']], pc: [[783, 'sl'], [783, 'alt']], isp: [[263, 'sl'], [289, 'alt']],
      ox: 'N2O4', fuel: '50:50', mr: 1.93, acAt: 2.04, joint: 'Integral', entranceHalfAngle: '25',
      Dt: 15.25, At: 182.56, L: 42.46, exit: 'Bell', divergence: '23', De: 43.14, Ae: 1461.6, eps: 8, extension: 'None', cooling: 'Film and regenerative', prop: 'nto-a50' },
    { engine: 'J-2', application: 'S-II and S-IV stages of Saturn V', thrust: [[230000, 'alt']], pc: [[725, 'nozzle stagnation']], isp: [[423, 'alt'], [294, 'sl']],
      ox: 'LOX', fuel: 'LH2', mr: 5.5, acAt: 1.58, joint: 'Integral', entranceHalfAngle: '13.73',
      Dt: 14.7, At: 169.6, L: 90, exit: 'Bell', divergence: '4.226 min, 27.5 max', De: 77, Ae: 4656.6, eps: 27.5, extension: 'None', cooling: 'Combined fluid and regenerative', prop: 'lox-lh2' },
    { engine: 'F-1', application: 'S-1C stage of Saturn V', thrust: [[1522000, 'sl'], [1748000, 'alt']], pc: [[1126, 'injector'], [983, 'throat']], isp: [[274, 'sl'], [315, 'alt']],
      ox: 'LOX', fuel: 'RP-1', mr: 2.27, acAt: 1.307, joint: 'Integral', entranceHalfAngle: '13',
      Dt: 35, At: 961.4, L: 158, exit: 'Bell', divergence: '-', De: 140, Ae: 15400, eps: 16, extension: 'Yes', cooling: 'Regenerative to 10:1; turbine exhaust to 16:1', prop: 'lox-rp1' },
  ];
  var api = { ROWS: ROWS, source: 'NASA SP-8120 (1976) Table I, NTRS 19770009165, PDF pages 19-20, hand-transcribed from the scan' };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SP8120_TABLE1 = api;
})(typeof self !== 'undefined' ? self : this);
