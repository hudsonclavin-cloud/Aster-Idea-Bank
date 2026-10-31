/**
 * Declination of the Launch Asymptote (DLA), in degrees.
 *
 * DLA = arcsin(vZ / |v|) computed DIRECTLY on the departure v-infinity
 * components - NO ecliptic->equatorial rotation is applied, deliberately.
 * Slice 12 OQ-12-1 measured the porkchop pipeline's frame: Earth velocity
 * sampled from the worker's own fixture reaches |vZ| = 11.715 km/s
 * (seasonal), impossible in an ecliptic frame - the components are
 * heliocentric ICRF (equatorial-aligned) J2000. Applying the "one
 * obliquity rotation" from the pre-research summary here would introduce
 * up to ~23.4 deg of silent error. See src/v2/SLICE_12_FOUNDING.md
 * OQ-12-1 / DEC-12-2 before "fixing" this.
 *
 * Inputs are unit-agnostic (the ratio is dimensionless) but must be
 * consistent; epsilonMag is in the SAME unit as the components and
 * defaults to 1e-3 (= 1 m/s for km/s inputs, the production case).
 * Returns null when |v| < epsilonMag (DLA undefined near C3 ~ 0).
 */
export function dlaDegFromVInf(vx: number, vy: number, vz: number, epsilonMag = 1e-3): number | null {
    const mag = Math.hypot(vx, vy, vz);
    // Non-finite components (NaN/±Infinity) return null, never NaN or a fabricated
    // value — same guard pattern as classifyFeasibility (Slice 12 audit M-A residual,
    // Slice 13 founding doc §2 pre-slice dependency).
    if (!Number.isFinite(mag) || mag < epsilonMag) {
        return null;
    }

    const sinDla = Math.min(1, Math.max(-1, vz / mag));
    return Math.asin(sinDla) * (180 / Math.PI);
}
