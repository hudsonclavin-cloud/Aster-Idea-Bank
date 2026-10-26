import { FRAME_HELIO_J2000_ICRF } from '../frames/ids.js';
import type { AsteroidOrbitalElements } from '../constants/asteroids.js';
import type { CanonicalPositionM, CanonicalState, CanonicalVelocityMps, Vec3F64 } from '../types.js';
import { J2000_ECLIPTIC_OBLIQUITY_RAD } from '../units.js';

const TWO_PI = 2 * Math.PI;

// IAU 2015 nominal heliocentric GM used in Slice 7 pre-research and cutover bars.
export const GM_SUN_M3_S2 = 1.32712440018e20;

export interface KeplerSolverOptions {
  readonly toleranceRad?: number;
  readonly maxIterations?: number;
}

export type KeplerianElements = AsteroidOrbitalElements;

export interface KeplerianPropagationOptions {
  readonly gmM3S2?: number;
  readonly radiusM?: number;
}

export interface KeplerianPropagationMetadata {
  readonly orbitalRadiusM: number;
  readonly meanMotionRadPerSec: number;
  readonly meanAnomalyRad: number;
  readonly eccentricAnomalyRad: number;
}

export interface PropagatedKeplerianStateVectors {
  readonly positionM: CanonicalPositionM;
  readonly velocityMps: CanonicalVelocityMps;
  readonly metadata: KeplerianPropagationMetadata;
}

export interface OrbitSamplePoint extends Vec3F64 {
  readonly trueAnomalyRad: number;
  readonly orbitalRadiusM: number;
}

function assertFiniteNumber(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function validateKeplerianElements(elements: KeplerianElements): void {
  assertFiniteNumber('aM', elements.aM);
  assertFiniteNumber('e', elements.e);
  assertFiniteNumber('iRad', elements.iRad);
  assertFiniteNumber('omRad', elements.omRad);
  assertFiniteNumber('wRad', elements.wRad);
  assertFiniteNumber('maRad', elements.maRad);
  assertFiniteNumber('epochTdbSeconds', elements.epochTdbSeconds);

  if (elements.aM <= 0) {
    throw new RangeError('aM must be > 0 for elliptical Kepler propagation');
  }
  if (elements.e < 0 || elements.e >= 1) {
    throw new RangeError('e must be in [0, 1) for elliptical Kepler propagation');
  }
}

function rotatePerifocalToEcliptic(
  vector: Vec3F64,
  cosOm: number,
  sinOm: number,
  cosI: number,
  sinI: number,
  cosW: number,
  sinW: number,
): Vec3F64 {
  const q11 = cosOm * cosW - sinOm * sinW * cosI;
  const q12 = -cosOm * sinW - sinOm * cosW * cosI;
  const q21 = sinOm * cosW + cosOm * sinW * cosI;
  const q22 = -sinOm * sinW + cosOm * cosW * cosI;
  const q31 = sinW * sinI;
  const q32 = cosW * sinI;

  return {
    x: q11 * vector.x + q12 * vector.y,
    y: q21 * vector.x + q22 * vector.y,
    z: q31 * vector.x + q32 * vector.y,
  };
}

function rotateEclipticToEquatorial(vector: Vec3F64): Vec3F64 {
  const cosObliquity = Math.cos(J2000_ECLIPTIC_OBLIQUITY_RAD);
  const sinObliquity = Math.sin(J2000_ECLIPTIC_OBLIQUITY_RAD);
  return {
    x: vector.x,
    y: vector.y * cosObliquity - vector.z * sinObliquity,
    z: vector.y * sinObliquity + vector.z * cosObliquity,
  };
}

export function normalizeAngleRadians(value: number): number {
  return ((value % TWO_PI) + TWO_PI) % TWO_PI;
}

function normalizeSignedAngleRadians(value: number): number {
  const wrapped = normalizeAngleRadians(value);
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped;
}

export function solveKeplerEquation(
  meanAnomalyRad: number,
  eccentricity: number,
  options: KeplerSolverOptions = {},
): number {
  assertFiniteNumber('meanAnomalyRad', meanAnomalyRad);
  assertFiniteNumber('eccentricity', eccentricity);
  if (eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError('eccentricity must be in [0, 1) for elliptical propagation');
  }

  const tolerance = options.toleranceRad ?? 1e-12;
  const maxIterations = options.maxIterations ?? 50;
  const meanAnomaly = normalizeSignedAngleRadians(meanAnomalyRad);
  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomaly : (meanAnomaly >= 0 ? Math.PI : -Math.PI);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const f = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
    const fp = 1 - eccentricity * Math.cos(eccentricAnomaly);
    const delta = f / fp;
    eccentricAnomaly -= delta;
    if (Math.abs(delta) <= tolerance) {
      return eccentricAnomaly;
    }
  }

  throw new Error(`Kepler solver failed to converge for e=${eccentricity} M=${meanAnomalyRad}`);
}

function rotatePerifocalPositionToCanonicalFrame(
  perifocalPositionM: Vec3F64,
  elements: KeplerianElements,
): Vec3F64 {
  const cosOm = Math.cos(elements.omRad);
  const sinOm = Math.sin(elements.omRad);
  const cosI = Math.cos(elements.iRad);
  const sinI = Math.sin(elements.iRad);
  const cosW = Math.cos(elements.wRad);
  const sinW = Math.sin(elements.wRad);

  // Slice 7 stores classical elements in heliocentric J2000 ecliptic orientation.
  // Propagation returns canonical heliocentric ICRF by rotating the ecliptic result
  // through the J2000 obliquity exactly once.
  const eclipticPositionM = rotatePerifocalToEcliptic(
    perifocalPositionM,
    cosOm,
    sinOm,
    cosI,
    sinI,
    cosW,
    sinW,
  );
  return rotateEclipticToEquatorial(eclipticPositionM);
}

export function sampleOrbitEllipse(
  elements: KeplerianElements,
  segmentCount: number,
): OrbitSamplePoint[] {
  validateKeplerianElements(elements);
  assertFiniteNumber('segmentCount', segmentCount);
  if (!Number.isInteger(segmentCount) || segmentCount < 3) {
    throw new RangeError('segmentCount must be an integer >= 3');
  }

  const semiLatusRectumM = elements.aM * (1 - elements.e * elements.e);
  const samples: OrbitSamplePoint[] = [];

  for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex += 1) {
    const trueAnomalyRad = (segmentIndex / segmentCount) * TWO_PI;
    const orbitalRadiusM = semiLatusRectumM / (1 + elements.e * Math.cos(trueAnomalyRad));
    const perifocalPositionM = {
      x: orbitalRadiusM * Math.cos(trueAnomalyRad),
      y: orbitalRadiusM * Math.sin(trueAnomalyRad),
      z: 0,
    };
    const canonicalPositionM = rotatePerifocalPositionToCanonicalFrame(perifocalPositionM, elements);
    samples.push({
      x: canonicalPositionM.x,
      y: canonicalPositionM.y,
      z: canonicalPositionM.z,
      trueAnomalyRad,
      orbitalRadiusM,
    });
  }

  return samples;
}

export function propagateKeplerianStateVectors(
  elements: KeplerianElements,
  targetTdbSeconds: number,
  options: KeplerianPropagationOptions = {},
): PropagatedKeplerianStateVectors {
  validateKeplerianElements(elements);
  assertFiniteNumber('targetTdbSeconds', targetTdbSeconds);

  const gmM3S2 = options.gmM3S2 ?? GM_SUN_M3_S2;
  assertFiniteNumber('gmM3S2', gmM3S2);
  if (gmM3S2 <= 0) {
    throw new RangeError('gmM3S2 must be > 0');
  }

  const deltaSeconds = targetTdbSeconds - elements.epochTdbSeconds;
  const meanMotionRadPerSec = Math.sqrt(gmM3S2 / (elements.aM * elements.aM * elements.aM));
  const meanAnomalyRad = elements.maRad + meanMotionRadPerSec * deltaSeconds;
  const eccentricAnomalyRad = solveKeplerEquation(meanAnomalyRad, elements.e);

  const cosE = Math.cos(eccentricAnomalyRad);
  const sinE = Math.sin(eccentricAnomalyRad);
  const denominator = 1 - elements.e * cosE;
  const sqrtOneMinusESquared = Math.sqrt(1 - elements.e * elements.e);
  const orbitalRadiusM = elements.aM * denominator;

  const perifocalPositionM = {
    x: elements.aM * (cosE - elements.e),
    y: elements.aM * sqrtOneMinusESquared * sinE,
    z: 0,
  };
  const perifocalVelocityMps = {
    x: (-elements.aM * meanMotionRadPerSec * sinE) / denominator,
    y: (elements.aM * meanMotionRadPerSec * sqrtOneMinusESquared * cosE) / denominator,
    z: 0,
  };

  const cosOm = Math.cos(elements.omRad);
  const sinOm = Math.sin(elements.omRad);
  const cosI = Math.cos(elements.iRad);
  const sinI = Math.sin(elements.iRad);
  const cosW = Math.cos(elements.wRad);
  const sinW = Math.sin(elements.wRad);

  const canonicalPositionM = rotatePerifocalPositionToCanonicalFrame(perifocalPositionM, elements);
  const eclipticVelocityMps = rotatePerifocalToEcliptic(
    perifocalVelocityMps,
    cosOm,
    sinOm,
    cosI,
    sinI,
    cosW,
    sinW,
  );

  return {
    positionM: canonicalPositionM,
    velocityMps: rotateEclipticToEquatorial(eclipticVelocityMps),
    metadata: {
      orbitalRadiusM,
      meanMotionRadPerSec,
      meanAnomalyRad,
      eccentricAnomalyRad,
    },
  };
}

export function propagateKeplerianState(
  elements: KeplerianElements,
  targetTdbSeconds: number,
  options: KeplerianPropagationOptions = {},
): CanonicalState {
  const propagated = propagateKeplerianStateVectors(elements, targetTdbSeconds, options);
  return {
    positionM: propagated.positionM,
    velocityMps: propagated.velocityMps,
    frame: FRAME_HELIO_J2000_ICRF,
    tdbSeconds: targetTdbSeconds,
    ...(typeof options.radiusM === 'number' ? { radiusM: options.radiusM } : {}),
  };
}
