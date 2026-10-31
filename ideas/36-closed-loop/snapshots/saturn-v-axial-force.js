/* Apollo/Saturn V axial force coefficient against Mach number at zero angle of attack, wind tunnel, from:
 *   C. E. Walker, "Results of Several Experimental Investigations of the Static Aerodynamic Characteristics for the
 *   Apollo/Saturn V Launch Vehicle", NASA TM X-53770, Aero-Astrodynamics Laboratory, NASA Marshall Space Flight
 *   Center, 21 August 1968. NTRS 19690009748, https://ntrs.nasa.gov/api/citations/19690009748/downloads/19690009748.pdf
 *   (sha256 f60fed99deaf8228fa2490e4eb68097f752d871ddbb77e9841700ec9c3670a9d, 186 pages).
 *   Figure 28, "Variation of Axial Force Coefficient with Mach Number for the APOLLO-SATURN V Launch Vehicle
 *   (alpha ~ 0 deg)", printed page 147 (PDF page 157); configuration 1 (the complete launch vehicle); six facilities
 *   (MSFC 14-in, CAL 8-ft, LTV 4-ft, AEDC 40-in "A", 12-in "E", 16-ft), Mach 0.5 to 7.81.
 *
 * DIGITIZED BY HAND, not tabulated in the source. The figure is a 300 dpi 1-bit scan, printed sideways. Procedure
 * (oracle/digitize_fig28.py): render at 300 dpi, rotate upright, fit an affine map from pixels to (Mach, coefficient)
 * on the major grid lines (Mach 0..8, coefficient 0..0.8 lower panel, 0..1.4 upper panel; largest residual 1.6 px,
 * i.e. 0.0055 in Mach and 0.0022 in coefficient), list the dark runs crossing the curve at each station (sampled 0.02
 * Mach either side, off the grid lines), and pick the run on the report's SOLID fairing by eye on zoomed crops.
 * Reading uncertainty [Likely]: +-0.01 in the coefficient above Mach 1.5, +-0.02 from Mach 0.5 to 1.5 where the
 * fairing runs through the data symbols and beside the dashed design-criteria curve (NASA TM X-53517, not on NTRS).
 *
 * Definitions (Walker, "Definition of Symbols", PDF page 9): C_AT total axial force coefficient = axial force / (q S);
 * C_Ab base axial force coefficient = (p - p_b) A_b / (q S); C_Af forebody = C_AT - C_Ab. S = reference area based on
 * D, "Saturn V reference diameter (S-IC stage), 33 feet, full scale": S = pi D^2 / 4. Wind-tunnel models have no
 * engines firing, so C_AT carries power-OFF base drag; with five F-1s running the base pressure is set by the plumes,
 * which this figure does not cover. This module uses C_Af as its drag coefficient and C_AT as a power-off bound.
 * Loads as a classic script (window.SATURN_V_AXIAL_FORCE) and with require().
 */
(function (root) {
  var D = {
    source: 'Walker, NASA TM X-53770 (1968), Figure 28, Apollo-Saturn V configuration 1, alpha ~ 0 (NTRS 19690009748)',
    referenceDiameterFt: 33,
    FT: 0.3048, // exact definition of the international foot
    machRange: [0.5, 7.8],
    // forebody axial force coefficient C_Af, the report's solid fairing (lower panel)
    forebody: {
      mach: [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.6, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 4.75, 5.0, 5.25, 5.5, 5.75, 6.0, 6.25, 6.5, 6.75, 7.0, 7.25, 7.5, 7.75, 7.8],
      ca:   [0.209, 0.215, 0.23, 0.275, 0.35, 0.40, 0.50, 0.605, 0.655, 0.665, 0.665, 0.655, 0.625, 0.603, 0.586, 0.564, 0.530, 0.493, 0.463, 0.428, 0.410, 0.392, 0.366, 0.343, 0.329, 0.314, 0.300, 0.288, 0.271, 0.254, 0.249, 0.237, 0.229, 0.2205, 0.216, 0.2136, 0.207, 0.201, 0.178, 0.140, 0.135],
    },
    // total axial force coefficient C_AT, the solid fairing (upper panel): includes power-off base drag
    total: {
      mach: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.6, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.75, 5.25, 5.75, 6.25, 7.25, 7.4, 7.5, 7.6, 7.7, 7.8],
      ca:   [0.668, 0.672, 0.69, 0.71, 0.74, 0.81, 0.93, 1.13, 1.225, 1.26, 1.24, 1.22, 1.165, 1.105, 1.045, 1.0, 0.927, 0.80, 0.713, 0.645, 0.568, 0.53, 0.485, 0.45, 0.414, 0.39, 0.369, 0.331, 0.296, 0.263, 0.236, 0.205, 0.1925, 0.1817, 0.167, 0.1528, 0.15],
    },
    readingUncertainty: { above15: 0.01, below15: 0.02 },
    // base axial force coefficient C_Ab, power off: the figure's third curve (upper panel, lower line), which the table
    // above does not use. Read by the module's independent reviewer at stations clear of data symbols, with its own grid
    // calibration (Mach 0..8 and coefficient 0..1.4 major lines found by projection on the same 300 dpi rendering), as the
    // centre of the dark run 0.02 Mach either side of each station. By Walker's definitions C_AT = C_Af + C_Ab, so it
    // checks the two curves above against a third reading (ascent.test.mjs).
    base: {
      mach: [2.25, 2.75, 4.5, 5.5, 6.0, 6.5, 7.0],
      ca:   [0.219, 0.143, 0.051, 0.030, 0.021, 0.013, 0.008],
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.SATURN_V_AXIAL_FORCE = D;
})(typeof self !== 'undefined' ? self : this);
