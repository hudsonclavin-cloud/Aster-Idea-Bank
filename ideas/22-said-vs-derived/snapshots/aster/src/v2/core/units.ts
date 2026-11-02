export const J2000_TDB_JULIAN_DATE = 2451545.0;
export const SECONDS_PER_DAY = 86400;
export const METERS_PER_KILOMETER = 1000;
export const ARCSECONDS_TO_RADIANS = Math.PI / (180 * 3600);
export const J2000_ECLIPTIC_OBLIQUITY_RAD = 84381.448 * ARCSECONDS_TO_RADIANS;

export function kilometersToMeters(valueKm: number): number {
  return valueKm * METERS_PER_KILOMETER;
}

export function kilometersPerSecondToMetersPerSecond(valueKmS: number): number {
  return valueKmS * METERS_PER_KILOMETER;
}

export function jdTdbToSecondsSinceJ2000(jdTdb: number): number {
  return (jdTdb - J2000_TDB_JULIAN_DATE) * SECONDS_PER_DAY;
}

