/**
 * Near-zero minimum-C3 degeneracy threshold, in km^2/s^2.
 * Origin: src/v2/app/catalog-list/honesty-disclosure.ts, Close-approach degeneracy.
 */
export const NEAR_ZERO_C3_DEGENERACY_THRESHOLD_KM2_S2 = 0.1;

/** True only for a finite C3 value strictly below the near-zero threshold. */
export function isNearZeroC3Degenerate(c3: number | null): boolean {
  return c3 !== null && Number.isFinite(c3) && c3 < NEAR_ZERO_C3_DEGENERACY_THRESHOLD_KM2_S2;
}
