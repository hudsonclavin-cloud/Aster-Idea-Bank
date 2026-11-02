import { FRAME_HELIO_J2000_ECLIPTIC, type FrameId } from '../frames/ids.js';
import type { CanonicalState } from '../types.js';

export type AsteroidBodyId = `asteroid-${string}`;
export type BodyClass = 'star' | 'planet' | 'moon' | 'asteroid';
export type AsteroidOrbitClass = 'MBA' | 'APO' | 'ATE' | 'AMO' | (string & {});
export type AsteroidEccentricityBand = 'A' | 'B' | 'C' | 'D';

export const ASTEROID_DEFAULT_ALBEDO = 0.14;
export const ASTEROID_PROPAGATION_CADENCE_SECONDS = 86_400;
export const ASTEROID_KEPLERIAN_ERROR_BAR_M = 100_000_000;
export const ASTEROID_PROPAGATION_INVARIANT_ID = 'INV-012' as const;
export const ASTEROID_ORBIT_LINE_THRESHOLD_H = 10.98;

export interface AsteroidOrbitalElements {
  readonly aM: number;
  readonly e: number;
  readonly iRad: number;
  readonly omRad: number;
  readonly wRad: number;
  readonly maRad: number;
  readonly epochTdbSeconds: number;
}

export interface AsteroidBodyIdentity {
  readonly bodyId: AsteroidBodyId;
  readonly bodyClass: 'asteroid';
  readonly designation: string;
  readonly spkId: number;
  readonly name: string | null;
  readonly class: AsteroidOrbitClass;
  readonly isCuratedNea: boolean;
  readonly neo: boolean;
  readonly pha: boolean;
  readonly H: number;
  readonly G: number | null;
  readonly estimatedRadiusM: number;
  readonly elementsFrame: FrameId;
  readonly eccentricityBand?: AsteroidEccentricityBand;
  readonly hasOrbitLine?: boolean;
}

export interface AsteroidBody extends AsteroidBodyIdentity {
  readonly anchorState: CanonicalState;
  readonly elements: AsteroidOrbitalElements;
}

export interface AsteroidCatalogIndex<T extends AsteroidBodyIdentity = AsteroidBodyIdentity> {
  readonly byBodyId: ReadonlyMap<AsteroidBodyId, T>;
  readonly byDesignation: ReadonlyMap<string, T>;
  readonly bySpkId: ReadonlyMap<number, T>;
  readonly curatedNeas: readonly T[];
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number`);
  }
}

export function isAsteroidBodyId(bodyId: string): bodyId is AsteroidBodyId {
  return bodyId.startsWith('asteroid-') && bodyId.length > 'asteroid-'.length;
}

export function toAsteroidBodyId(designation: string): AsteroidBodyId {
  if (typeof designation !== 'string' || designation.length === 0) {
    throw new Error('Asteroid designation must be a non-empty string');
  }
  return `asteroid-${designation}` as AsteroidBodyId;
}

export function deriveAsteroidDiameterKmFromAbsoluteMagnitude(
  absoluteMagnitude: number,
  albedo = ASTEROID_DEFAULT_ALBEDO,
): number {
  assertFinitePositive(albedo, 'Asteroid albedo');
  if (!Number.isFinite(absoluteMagnitude)) {
    throw new Error('Asteroid absolute magnitude H must be finite');
  }
  return (1329 / Math.sqrt(albedo)) * 10 ** (-absoluteMagnitude / 5);
}

export function deriveAsteroidRadiusMFromAbsoluteMagnitude(
  absoluteMagnitude: number,
  albedo = ASTEROID_DEFAULT_ALBEDO,
): number {
  return deriveAsteroidDiameterKmFromAbsoluteMagnitude(absoluteMagnitude, albedo) * 500;
}

export function eccentricityBandForBody(eccentricity: number): AsteroidEccentricityBand {
  if (!Number.isFinite(eccentricity) || eccentricity < 0) {
    throw new Error('Asteroid eccentricity must be a finite non-negative number');
  }
  if (eccentricity < 0.1) {
    return 'A';
  }
  if (eccentricity < 0.2) {
    return 'B';
  }
  if (eccentricity < 0.3) {
    return 'C';
  }
  return 'D';
}

export function hasOrbitLineForBody(absoluteMagnitude: number): boolean {
  if (!Number.isFinite(absoluteMagnitude)) {
    throw new Error('Asteroid absolute magnitude H must be finite');
  }
  return absoluteMagnitude < ASTEROID_ORBIT_LINE_THRESHOLD_H;
}

export function createAsteroidCatalogIndex<T extends AsteroidBodyIdentity>(
  asteroids: Iterable<T>,
): AsteroidCatalogIndex<T> {
  const byBodyId = new Map<AsteroidBodyId, T>();
  const byDesignation = new Map<string, T>();
  const bySpkId = new Map<number, T>();
  const curatedNeas: T[] = [];

  for (const asteroid of asteroids) {
    if (!isAsteroidBodyId(asteroid.bodyId)) {
      throw new Error(`Invalid asteroid body id "${asteroid.bodyId}"`);
    }
    if (asteroid.bodyId !== toAsteroidBodyId(asteroid.designation)) {
      throw new Error(
        `Asteroid body id "${asteroid.bodyId}" does not match designation "${asteroid.designation}"`,
      );
    }
    if (asteroid.elementsFrame !== FRAME_HELIO_J2000_ECLIPTIC) {
      throw new Error(
        `Asteroid "${asteroid.bodyId}" must use ${FRAME_HELIO_J2000_ECLIPTIC}; received ${asteroid.elementsFrame}`,
      );
    }
    assertFinitePositive(asteroid.estimatedRadiusM, `${asteroid.bodyId}.estimatedRadiusM`);
    const orbitalEccentricity = (asteroid as { readonly elements?: { readonly e: number } }).elements?.e;
    if (typeof orbitalEccentricity === 'number') {
      const expectedBand = eccentricityBandForBody(orbitalEccentricity);
      if (typeof asteroid.eccentricityBand !== 'undefined' && asteroid.eccentricityBand !== expectedBand) {
        throw new Error(
          `Asteroid "${asteroid.bodyId}" eccentricityBand mismatch: expected ${expectedBand}, received ${asteroid.eccentricityBand}`,
        );
      }
    }
    const expectedHasOrbitLine = hasOrbitLineForBody(asteroid.H);
    if (typeof asteroid.hasOrbitLine !== 'undefined' && asteroid.hasOrbitLine !== expectedHasOrbitLine) {
      throw new Error(
        `Asteroid "${asteroid.bodyId}" hasOrbitLine mismatch: expected ${expectedHasOrbitLine}, received ${asteroid.hasOrbitLine}`,
      );
    }

    if (byBodyId.has(asteroid.bodyId)) {
      throw new Error(`Duplicate asteroid body id "${asteroid.bodyId}"`);
    }
    if (byDesignation.has(asteroid.designation)) {
      throw new Error(`Duplicate asteroid designation "${asteroid.designation}"`);
    }
    if (bySpkId.has(asteroid.spkId)) {
      throw new Error(`Duplicate asteroid SPK id "${asteroid.spkId}"`);
    }

    byBodyId.set(asteroid.bodyId, asteroid);
    byDesignation.set(asteroid.designation, asteroid);
    bySpkId.set(asteroid.spkId, asteroid);
    if (asteroid.isCuratedNea) {
      curatedNeas.push(asteroid);
    }
  }

  return {
    byBodyId,
    byDesignation,
    bySpkId,
    curatedNeas,
  };
}

export function getAsteroidByDesignation<T extends AsteroidBodyIdentity>(
  index: AsteroidCatalogIndex<T>,
  designation: string,
): T | undefined {
  return index.byDesignation.get(designation);
}

export function getAsteroidBySpkId<T extends AsteroidBodyIdentity>(
  index: AsteroidCatalogIndex<T>,
  spkId: number,
): T | undefined {
  return index.bySpkId.get(spkId);
}
