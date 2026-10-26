export type PorkchopCellStatus = 'ok' | 'no_solution' | 'stall';
export type Rgb = readonly [number, number, number];

export const C3_COLOR_MIN = 1;
export const C3_COLOR_MAX = 1000;
export const NO_SOLUTION_RGB: Rgb = [36, 36, 42];
export const STALL_RGB: Rgb = [255, 0, 180];

interface ViridisStop {
  readonly t: number;
  readonly rgb: Rgb;
}

const VIRIDIS_STOPS: readonly ViridisStop[] = [
  { t: 0.0, rgb: [68, 1, 84] },
  { t: 0.25, rgb: [59, 82, 139] },
  { t: 0.5, rgb: [33, 145, 140] },
  { t: 0.75, rgb: [94, 201, 98] },
  { t: 1.0, rgb: [253, 231, 37] },
] as const;

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function lerpChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

export function c3ToViridisRgb(c3Km2S2: number): Rgb {
  if (!Number.isFinite(c3Km2S2)) {
    return NO_SOLUTION_RGB;
  }
  const c3ClampedToFloor = Math.max(c3Km2S2, C3_COLOR_MIN);
  const normalized = clamp01(
    (Math.log(c3ClampedToFloor) - Math.log(C3_COLOR_MIN)) /
      (Math.log(C3_COLOR_MAX) - Math.log(C3_COLOR_MIN)),
  );

  for (let index = 1; index < VIRIDIS_STOPS.length; index += 1) {
    const previous = VIRIDIS_STOPS[index - 1];
    const next = VIRIDIS_STOPS[index];
    if (normalized > next.t) {
      continue;
    }
    const localT = (normalized - previous.t) / (next.t - previous.t);
    return [
      lerpChannel(previous.rgb[0], next.rgb[0], localT),
      lerpChannel(previous.rgb[1], next.rgb[1], localT),
      lerpChannel(previous.rgb[2], next.rgb[2], localT),
    ];
  }

  return VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1].rgb;
}

export function colorForPorkchopCell(status: PorkchopCellStatus, c3Km2S2: number | null): Rgb {
  if (status === 'no_solution') {
    return NO_SOLUTION_RGB;
  }
  if (status === 'stall') {
    return STALL_RGB;
  }
  return c3ToViridisRgb(c3Km2S2 ?? C3_COLOR_MAX);
}
