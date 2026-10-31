/* Saturn V AS-512 (Apollo 17): what the flight report says about its guidance and about how far the flight strayed
 * from its own prediction, from NASA's flight evaluation report:
 *   MPR-SAT-FE-73-1 (NASA-TM-X-69534), "Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17
 *   Mission", Saturn Flight Evaluation Working Group, NASA Marshall Space Flight Center, 28 February 1973.
 *   NTRS 19730025089, https://ntrs.nasa.gov/api/citations/19730025089/downloads/19730025089.pdf
 *   (sha256 8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42, the PDF ideas 34 and 35 transcribed).
 *
 * HAND-TRANSCRIBED by idea 36 from the pages rendered at 90 to 150 dpi with pdftoppm and read as images (Table 2-2,
 * sections 5.1, 6.3, 7.3, 9.3) or from the text layer where it is clean (sections 7.9, 16.2, A.5.3), PDF page numbers
 * given per entry. Units as printed (range time s from range zero, percent, lbf, lbm/s, lbf-s/lbm, m, m/s); the
 * kernel converts. "Predicted" is MSFC's pre-flight prediction (the operational trajectory, OT, in section 9).
 * Loads as a classic script (window.AS512_GUIDANCE) and with require().
 */
(function (root) {
  var D = {
    report: 'MPR-SAT-FE-73-1 (NASA-TM-X-69534), Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17 Mission, NASA MSFC, 28 Feb 1973 (NTRS 19730025089)',
    // Table 2-2 (cont'd), Significant Event Times Summary, printed page 2-5 (PDF page 38), ACTUAL range time, s
    events: {
      igmPhase1: 204.1,          // item 36, ITERATIVE GUIDANCE MODE (IGM) PHASE 1 INITIATED (ACT-PRED 0.0)
      igmPhase1FromBase: 42.9,   // item 36, TIME FROM BASE, ACTUAL: base T3, which starts at S-IC outboard cutoff (161.20 s; 204.1 - 42.9 = 161.2)
      siiCeco: 461.21,           // item 37, S-II CENTER ENGINE CUTOFF
      artificialTauStart: 489.0, // item 38, START OF ARTIFICIAL TAU MODE
      siiEmrShift: 489.2,        // item 39, S-II LOW ENGINE MIXTURE RATIO (EMR) SHIFT (ACTUAL)
      artificialTauEnd: 499.0,   // item 40, END OF ARTIFICIAL TAU MODE
      siiOeco: 559.66,           // item 41, S-II OUTBOARD ENGINE CUTOFF
    },
    // Section 7.3 (PDF page 103, read as an image): "The first burn time was 138.8 seconds, terminated by a guidance
    // velocity cutoff command, which was 3.7 seconds less than predicted for the actual flight azimuth of 91.5 degrees.
    // This difference is composed of 4.1 seconds less due to the higher than expected S-II/S-IVB separation velocity and
    // 0.4 second longer due to lower S-IVB performance." Section 7.4: "S-IVB first ECO was initiated at 702.65 seconds".
    sivbBurn1: { burnTimeS: 138.8, lessThanPredictedS: 3.7, fromSeparationVelocityS: -4.1, fromLowerPerformanceS: 0.4, ecoRangeTimeS: 702.65, cutoff: 'guidance velocity cutoff command' },
    // Section 9.3, printed page 9-3 (PDF page 142): "At first S-IVB ECO total velocity was 0.20 m/s (0.66 ft/s) less
    // than the OT and the radius vector was 30.8 m (101.0 ft) greater than the OT." (LVDC navigation against the
    // operational trajectory: how close the closed loop came to the state it was aiming for.)
    insertionVsPrediction: { velocityMs: -0.20, velocityFtS: -0.66, radiusM: 30.8, radiusFt: 101.0 },
    // Actual minus predicted, per stage (percent; positive = higher than predicted)
    deviations: {
      // Section 5.1, printed page 5-1 (PDF page 66): "Overall stage site thrust was 0.30 percent higher than predicted.
      // Total propellant consumption rate was 0.16 percent higher than predicted ... Specific impulse was 0.14 percent
      // higher than predicted. Total propellant consumption from Holddown Arm (HDA) release to Outboard Engines Cutoff
      // (OECO) was low by 0.14 percent." "OECO was initiated by the fuel depletion sensors at 161.20 seconds, 0.47
      // seconds earlier than predicted. This is well within the +5.99, -4.22 second 3-sigma limits."
      sic: { thrustPct: 0.30, flowPct: 0.16, ispPct: 0.14, propellantConsumedPct: -0.14, oecoActMinusPredS: -0.47, oeco3SigmaS: [5.99, -4.22], page: 66 },
      // Section 6.3, printed page 6-8 (PDF page 84): "At ESC +61 seconds, total stage thrust was 1,156,694 lbf which was
      // 1585 lbf (0.14 percent) below the preflight prediction. Total propellant flowrate including pressurization flow,
      // was 2743.4 lbm/s, 0.19 percent below predicted. Stage specific impulse ... was 421.6 lbf-s/lbm, 0.05 percent
      // above predicted." "the trajectory reconstruction ... indicated that the S-II stage produced approximately 23 m/s
      // more velocity than predicted. While this difference is within the normal range of trajectory dispersion ..."
      sii: { thrustLbf: 1156694, thrustDevLbf: -1585, thrustPct: -0.14, flowLbmS: 2743.4, flowPct: -0.19, ispLbfSLbm: 421.6, ispPct: 0.05, extraVelocityMs: 23, page: 84 },
      // Table 7-1, S-IVB Steady State Performance - First Burn (STDV open +135-second time slice at standard altitude
      // conditions), PDF page 103: [predicted, reconstruction, flight deviation, percent deviation]
      sivb: { thrustLbf: [207197, 205797, -1400, -0.68], ispLbfSLbm: [428.3, 427.7, -0.6, -0.14], loxFlowLbmS: [403.40, 401.26, -2.14, -0.53], fuelFlowLbmS: [80.37, 79.96, -0.41, -0.51], emr: [5.019, 5.018, -0.001, -0.02], page: 103 },
    },
    // Section 7.9 (PDF page 109, text layer): "The best estimate full load propellant masses were 0.027 percent greater
    // for LOX and 0.005 percent greater for LH2 than predicted." "Extrapolation of best estimate residuals data to
    // depletion, using the propellant flowrates, indicated that a LOX depletion would have occurred approximately 9.22
    // seconds after the second burn velocity cutoff."
    sivbLoad: { loxPct: 0.027, lh2Pct: 0.005, loxDepletionAfterSecondCutoffS: 9.22, page: 109 },
    // Section 16.2 (PDF page 225, text layer): "Dry weights of the inert stages and the loaded spacecraft were all within
    // 0.9 percent of predicted". "During S-II burn phase, the total vehicle mass was less than predicted by 740
    // kilograms (1630 lbm) (0.11 percent) at ignition ... the result of a lower than predicted S-II LOX load and a
    // higher than predicted upper stage mass."
    mass: { dryWithinPct: 0.9, siiIgnitionMassKg: -740, siiIgnitionMassPct: -0.11, page: 225 },
    // Appendix A.5.3 (PDF page 286, read as an image): "Atmospheric density deviations were small, being within 4
    // percent of the PRA-63 below 36 kilometers (118,109 ft) altitude. The density deviation reached a maximum of 3.91
    // percent greater than the PRA-63 value at 17.00 kilometers (55,774 ft)".
    density: { withinPct: 4, belowKm: 36, maxPct: 3.91, maxAtKm: 17.0, page: 286 },
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.AS512_GUIDANCE = D;
})(typeof self !== 'undefined' ? self : this);
