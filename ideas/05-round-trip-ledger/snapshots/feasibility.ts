export type LaunchSite = {
  name: string;
  /** Geographic latitude, deg N. Descriptive metadata ONLY — not a classification input (AMD-12-1). */
  latitudeDeg: number;
  /**
   * Minimum achievable inclination from the site's range-safety azimuth corridor, deg.
   * The GREEN band edge. Equals latitude only where due-east (Az=90) launch is permitted.
   */
  iMinDeg: number;
  /**
   * Maximum achievable inclination from the corridor, deg. Sourced metadata — NOT a |DLA|
   * threshold: an orbit at inclination i covers declinations only up to min(i, 180-i),
   * so once i exceeds 90 this number must not be compared against |DLA| (AMD-12-1).
   */
  iMaxDeg: number;
  /**
   * Maximum |DLA| coplanar-injectable from the corridor, deg: max over achievable i of
   * min(i, 180-i). The AMBER/RED band edge. 90 for corridors that include polar (Az=180).
   */
  dlaCeilingDeg: number;
};
export type FeasibilityClass = 'GREEN' | 'AMBER' | 'RED' | null;

// Azimuths 35-120 deg -> inclinations 28.5-57 deg (NASA Shuttle overview 1988,
// history.nasa.gov/shuttleoverview1988/part1.htm: Az=90 due east -> 28.5 = latitude,
// Az=35 -> 57). Due-east permitted, so iMin = latitude here — that coincidence is why
// the pre-AMD-12-1 model appeared correct. All-prograde corridor -> ceiling = iMax = 57.
export const CAPE_CANAVERAL: LaunchSite = {
  name: 'Cape Canaveral',
  latitudeDeg: 28.5,
  iMinDeg: 28.5,
  iMaxDeg: 57,
  dlaCeilingDeg: 57,
};

// Southward/polar corridor — due-east is PROHIBITED (overflight), which is WHY iMinDeg (70)
// far exceeds latitudeDeg (34.7). Azimuths 158-201 deg -> inclinations 70-104 deg
// (NASA Shuttle overview 1988: Az=158 -> 70, Az=201 -> 104; corroborated by USPTO 4,368,578
// "approximately 70 and 104 degrees" and orbitalradar.com "70 deg to retrograde").
// Spherical check: cos(i) = cos(34.7)*sin(158) -> i = 72.06 deg, consistent with the 70 deg
// operational floor (rotating-Earth azimuth correction). Corridor spans Az=180 (polar,
// i=90), which covers every declination -> dlaCeilingDeg = 90: RED is legitimately
// unreachable from this site at screening level.
export const VANDENBERG_SFB: LaunchSite = {
  name: 'Vandenberg SFB',
  latitudeDeg: 34.7,
  iMinDeg: 70,
  iMaxDeg: 104,
  dlaCeilingDeg: 90,
};

export const LAUNCH_SITES: ReadonlyArray<LaunchSite> = [CAPE_CANAVERAL, VANDENBERG_SFB];

/**
 * Classify a DLA value against a launch site's constraints (band model per AMD-12-1,
 * which corrected DEC-12-3 after Phase E audit finding H-1).
 *
 * A parking orbit of inclination i contains asymptote declinations |DLA| <= min(i, 180-i);
 * the injection constraint is i >= |DLA| — an inequality, so low declinations are FREE,
 * not penalized:
 * GREEN: |DLA| <= iMinDeg (direct from the site's minimum-inclination orbit, no penalty)
 * AMBER: iMinDeg < |DLA| <= dlaCeilingDeg (direct but penalized — raise parking-orbit
 *        inclination to at least |DLA|, per the OQ-12-2 band semantics)
 * RED: |DLA| > dlaCeilingDeg (dogleg required — beyond the corridor's declination coverage)
 * null: DLA is null (non-converged cell or near-zero |vInf|) or non-finite (NaN/Infinity
 *       guard — Phase E audit M-A)
 *
 * latitudeDeg and iMaxDeg are metadata and deliberately NOT classification inputs.
 * See src/v2/SLICE_12_FOUNDING.md AMD-12-1 / OQ-12-2 / DEC-12-3.
 * INV-016d: callers must surface a disclosure that this classifies screening
 * feasibility only, not day-specific launch geometry.
 */
export function classifyFeasibility(dlaDeg: number | null, site: LaunchSite): FeasibilityClass {
  if (dlaDeg === null || !Number.isFinite(dlaDeg)) {
    return null;
  }
  const absDla = Math.abs(dlaDeg);
  if (absDla <= site.iMinDeg) {
    return 'GREEN';
  }
  if (absDla <= site.dlaCeilingDeg) {
    return 'AMBER';
  }
  return 'RED';
}
