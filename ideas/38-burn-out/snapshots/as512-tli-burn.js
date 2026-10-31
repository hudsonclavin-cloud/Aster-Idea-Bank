/* Apollo 17's translunar injection burn (the S-IVB's second burn), as the flight report reconstructs it: the data Burn
 * Out replays its finite-burn model against.
 *
 *   MPR-SAT-FE-73-1 (NASA-TM-X-69534), "Saturn V Launch Vehicle Flight Evaluation Report - AS-512 Apollo 17 Mission",
 *   NASA MSFC, 28 Feb 1973. NTRS 19730025089, sha256 8e543894efef0d9a3862ded599001d1d9c83b0e5684f85dbe85abd981f2eaa42
 *   (the same PDF ideas 34 to 37 transcribed; its other tables are in as512-flight.js and apollo17-window.js).
 *
 * HAND-TRANSCRIBED by idea 38 from the page images (pdftoppm, 110 to 300 dpi), PDF page numbers per entry. Units as
 * printed (lbf-s, s of range time). Section 7 prose is also clean in the text layer; Table 2-2's text layer is not, so
 * its times were read off the images, each cross-checked against its own "time from base" column (T6 = 10,978.65 s,
 * Table 2-1, in apollo17-window.js).
 * Loads as a classic script (window.AS512_TLI_BURN) and with require().
 */
(function (root) {
  var D = {
    report: 'MPR-SAT-FE-73-1 (NASA-TM-X-69534), NASA MSFC, 28 Feb 1973 (NTRS 19730025089)',
    // Section 7.6, PDF page 109: "The MRCV was in the proper full open (4.5 EMR) position prior to the second start. The
    // total impulse from STDV open to STDV open +2.5 seconds was 182,502 lbf-s."
    buildup: { emr: 4.5, durationS: 2.5, impulseLbfS: 182502 },
    // Section 7.7, PDF page 109: "The second burn time was 351.0 seconds which was 4.0 seconds longer than predicted ...
    // The total impulse from STDV open +2.5 seconds to ECO was 69.59 x 10^6 lbf-s which was 466,296 lbf-s more than
    // predicted." Table 7-2 (its STDV open +172 s slice, EMR 5.0) is in as512-flight.js (engines.sivbSecondBurn).
    mainstage: { burnTimeS: 351.0, impulseLbfS: 69.59e6, impulseAboveNominalLbfS: 466296, sliceAfterStdvS: 172 },
    // Section 7.8, PDF page 109: "S-IVB second ECO was initiated at 11,907.64 seconds. ... The total cutoff impulse to zero
    // thrust was 46,260 lbf-s ... Cutoff occurred with the MRCV in the 5.0 EMR position."
    cutoff: { ecoRangeTime: 11907.64, impulseLbfS: 46260, emr: 5.0 },
    // Section 7.9, PDF page 109: "a LOX depletion would have occurred approximately 9.22 seconds after the second burn
    // velocity cutoff."
    loxDepletionAfterCutoffS: 9.22,
    // Table 2-2, Significant Event Times Summary, printed pages 2-7 and 2-8 (PDF pages 40 and 41), ACTUAL range time (s)
    // and time from base (T6 for items 85 to 93, T7 = item 96, S-IVB engine cutoff interrupt at 11,907.9 s, for 94 and 98).
    // Item 90's last digit is blurred; T6 + 671.2 = 11,649.85 is consistent with 11,649.9 (the image reads as a 9).
    events: {
      restartCommand: { item: 85, t: 11548.6, fromT6: 570.0, text: 'S-IVB ENGINE RESTART COMMAND (FUEL LEAD INITIATION) (SECOND ESC)' },
      secondIgnition: { item: 88, t: 11556.6, fromT6: 578.0, text: 'S-IVB SECOND IGNITION (STDV OPEN)' },
      mainstage: { item: 89, t: 11559.1, fromT6: 580.4, text: 'S-IVB MAINSTAGE' },
      emrShift: { item: 90, t: 11649.9, fromT6: 671.2, text: 'ENGINE MIXTURE RATIO (EMR) CONTROL VALVE SHIFT (BEGIN VALVE MOVEMENT)' },
      terminalGuidance: { item: 92, t: 11879.1, fromT6: 900.5, text: 'BEGIN TERMINAL GUIDANCE' },
      chiFreeze: { item: 93, t: 11905.2, fromT6: 926.6, text: 'BEGIN CHI FREEZE' },
      guidanceCutoff: { item: 94, t: 11907.64, fromT7: -0.24, text: 'S-IVB SECOND GUIDANCE CUTOFF COMMAND NO. 1 (SECOND ECO)' },
      tli: { item: 98, t: 11917.6, fromT7: 9.8, text: 'TRANSLUNAR INJECTION (TLI)' },
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.AS512_TLI_BURN = D;
})(typeof self !== 'undefined' ? self : this);
