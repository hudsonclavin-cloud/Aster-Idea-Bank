/**
 * Convert a UTC date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) to TDB seconds
 * since J2000.
 *
 * APPROXIMATION: TDB differs from UTC by approximately TAI-UTC + 32.184 s, with
 * additional small periodic terms below the millisecond level. As of 2026:
 *   TAI - UTC = 37 s (leap seconds accumulated since 1972)
 *   TDB - TAI ≈ 32.184 s (constant offset)
 *   TDB - UTC ≈ 69.184 s
 *
 * The periodic TDB-TT correction is < 2 ms peak and is ignored here as
 * negligible for patched-conic mission planning at NHATS fidelity.
 *
 * This helper assumes the leap-second count is 37, correct for any date from
 * 2017-01-01 onward. If IERS publishes a new leap second, update
 * TDB_MINUS_UTC_SECONDS.
 *
 * NUMERICAL IMPLEMENTATION NOTE:
 * The naive approach is to convert UTC -> JD UTC -> JD TDB -> TDB seconds since
 * J2000. This forms (2451545.0 + small), which loses precision via catastrophic
 * cancellation. We instead compute the offset directly from Unix epoch to
 * J2000-TDB-noon, which is exactly 10957.5 days = 946728000 seconds. The direct
 * computation has no cancellation; result is exact to single ULP.
 */

import { SECONDS_PER_DAY } from '../units.js';

export const TDB_MINUS_UTC_SECONDS = 69.184;

const UNIX_TO_J2000_DAYS = 10957.5;
const UNIX_TO_J2000_SECONDS = UNIX_TO_J2000_DAYS * SECONDS_PER_DAY;

/**
 * Parse a UTC date/time string and convert to TDB seconds since J2000.
 *
 * Accepted formats:
 *   "YYYY-MM-DD"           -> assumed UTC midnight (00:00:00)
 *   "YYYY-MM-DDTHH:mm:ss"  -> explicit UTC time
 *   "YYYY-MM-DDTHH:mm:ssZ" -> explicit UTC time
 */
export function utcStringToTdbSeconds(utcString: string): number {
  let isoString = utcString;
  if (/^\d{4}-\d{2}-\d{2}$/.test(utcString)) {
    isoString = `${utcString}T00:00:00Z`;
  } else if (!utcString.endsWith('Z') && !utcString.includes('+')) {
    isoString = `${utcString}Z`;
  }

  const utcMs = Date.parse(isoString);
  if (!Number.isFinite(utcMs)) {
    throw new Error(`Cannot parse UTC date string: ${utcString}`);
  }

  const utcSecondsSinceUnix = utcMs / 1000;
  return utcSecondsSinceUnix - UNIX_TO_J2000_SECONDS + TDB_MINUS_UTC_SECONDS;
}
