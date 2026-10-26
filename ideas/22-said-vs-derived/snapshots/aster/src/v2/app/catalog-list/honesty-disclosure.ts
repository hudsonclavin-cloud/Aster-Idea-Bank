/**
 * Honesty layer disclosure text (INV-016 amendment, OQ-1 surface).
 *
 * Phase C.4 surfaces these limitations to UI consumers. Updating any of
 * these strings does not require a code change elsewhere — the panel
 * reads them at render time.
 *
 * The screening-window years derive from the cache metadata
 * (metadata.screeningWindow) rather than literals, so this copy cannot
 * drift from the data it describes (sweep R-04/R-11). While the cache has
 * not loaded, the window phrase is omitted entirely — no claim is made
 * before the data that would back it exists.
 */

import type { LambertScreenCacheMetadata } from '../../boundary/lambert-screen-cache.js';
import { NEAR_ZERO_C3_DEGENERACY_THRESHOLD_KM2_S2 } from '../../core/constants/near-zero-c3.js';

export type ScreeningWindow = LambertScreenCacheMetadata['screeningWindow'];

export interface DisclosureSection {
  title: string;
  body: string;
}

export function screeningWindowLabel(window: ScreeningWindow): string {
  return `${window.startUtc}–${window.endUtc}`;
}

export function footerText(window: ScreeningWindow | null): string {
  return window === null
    ? 'Patched-conic screen'
    : `Patched-conic screen · ${screeningWindowLabel(window)}`;
}

export const FOOTER_CLICK_HINT = 'click for details';

export function disclosureIntro(window: ScreeningWindow | null): string {
  const windowPhrase =
    window === null
      ? 'the departure window'
      : `the ${screeningWindowLabel(window)} departure window`;
  return (
    'The catalog status colors and "min C3" values come from a patched-conic Lambert ' +
    `screen across ${windowPhrase}. They are a first-pass mission-design ` +
    'filter, not a full mission accessibility verdict.'
  );
}

export function disclosureSections(window: ScreeningWindow | null): DisclosureSection[] {
  const rangePhrase =
    window === null
      ? 'the screening range'
      : `the ${screeningWindowLabel(window)} screening range`;
  return [
    {
      title: 'What "low C3" actually means',
      body:
        'A "low_departure_c3" status means the body has at least one (departure, ' +
        `time-of-flight) window in ${rangePhrase} with departure C3 ≤ 25 km²/s². ` +
        'That is a necessary condition for a low-energy launch, but not sufficient: arrival ' +
        'ΔV, stay time, and return ΔV are not factored in. NHATS-style accessibility verdicts ' +
        'require the full mission stack, which later slices add.',
    },
    {
      title: 'Co-orbital targets are tagged for a reason',
      body:
        'Bodies marked co-orbital (cyan tint in the 3D view) have orbits very similar to ' +
        "Earth's — low eccentricity, low inclination, semi-major axis within 0.05 AU of 1 AU. " +
        'Both the catalog and comparison screens use patched-conic propagation; this is a ' +
        'patched-conic-versus-patched-conic comparison, not an N-body truth run. For co-orbital ' +
        'targets the approximation can diverge materially, so the tag is a flag to treat the ' +
        'numbers with extra caution and re-validate before committing to a mission profile.',
    },
    {
      title: 'Close-approach degeneracy',
      body:
        'For bodies that pass very close to Earth during the screening window, the Lambert ' +
        'solver can find "transfer" geometries with near-zero relative velocity — the ' +
        'spacecraft and target are accidentally in nearly the same heliocentric state because ' +
        'Earth and the body are nearly co-located. Apophis at its 2029 close approach is the ' +
        'canonical example. The resulting minC3 is mathematically valid but operationally ' +
        'meaningless: it does not describe a real rendezvous mission. Treat any minC3 below ' +
        `${NEAR_ZERO_C3_DEGENERACY_THRESHOLD_KM2_S2} km²/s² as a flag to inspect the geometry, not a real planning number.`,
    },
  ];
}
