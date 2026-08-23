// Real-world can geometry.
//
// `heightMm` is the STRAIGHT cylindrical wall only — always shorter than the
// can's overall height, because the neck taper at the top and the domed base
// are both excluded (perforating a taper puts the galvo out of focus, see
// CLAUDE.md). These are approximate starting points; cans vary by producer
// and market, so measure the can you actually have.
//
// The Ø65 x 142 entry is the reference the two ported presets were authored
// against, taken from the original generators.

export interface CanSize {
  id: string;
  name: string;
  diameterMm: number;
  heightMm: number;
}

// Only the first entry is a measured figure (Ø65 x 142, the Monster 500 ml the
// reference presets were authored against). Everything below it is an
// approximate starting point derived from nominal can diameters — treat those
// as "get close, then measure", not as spec.
export const CAN_SIZES: CanSize[] = [
  { id: 'monster-500', name: 'Monster 500 ml — Ø65 × 142 (measured)', diameterMm: 65, heightMm: 142 },
  { id: 'energy-473', name: 'Energy tallboy 473 ml — Ø66 × 128 ≈', diameterMm: 66, heightMm: 128 },
  { id: 'std-330', name: 'Standard 330 ml — Ø66 × 98 ≈', diameterMm: 66, heightMm: 98 },
  { id: 'slim-250', name: 'Slim 250 ml — Ø53 × 112 ≈', diameterMm: 53, heightMm: 112 },
  { id: 'tin-large', name: 'Large food tin — Ø99 × 100 ≈', diameterMm: 99, heightMm: 100 },
  { id: 'tin-squat', name: 'Squat tin — Ø73 × 78 ≈', diameterMm: 73, heightMm: 78 },
];

/** The can this tool was built around; the app's startup geometry. */
export const DEFAULT_CAN = CAN_SIZES[0];

/** Hard bounds. Outside these you are not looking at a can any more. */
export const CAN_LIMITS = {
  diameterMin: 40,
  diameterMax: 120,
  heightMin: 30,
  heightMax: 260,
};

/**
 * Plausible height:diameter band for a real cylindrical container — roughly a
 * squat tin at the low end and a slim energy can at the high end. Outside it
 * the geometry still generates fine, it just isn't a shape you can buy, so
 * this warns rather than blocks.
 */
const ASPECT_MIN = 0.7;
const ASPECT_MAX = 3.0;

export function clampCan(diameterMm: number, heightMm: number) {
  return {
    diameterMm: Math.min(CAN_LIMITS.diameterMax, Math.max(CAN_LIMITS.diameterMin, diameterMm)),
    heightMm: Math.min(CAN_LIMITS.heightMax, Math.max(CAN_LIMITS.heightMin, heightMm)),
  };
}

export function aspectWarning(diameterMm: number, heightMm: number): string | null {
  const ratio = heightMm / diameterMm;
  if (ratio > ASPECT_MAX) {
    return `Ø${diameterMm.toFixed(0)} × ${heightMm.toFixed(0)} mm is ${ratio.toFixed(
      1
    )}× taller than it is wide — taller than any real can. It will still generate, but narrative presets will show a lot of sky.`;
  }
  if (ratio < ASPECT_MIN) {
    return `Ø${diameterMm.toFixed(0)} × ${heightMm.toFixed(0)} mm is unusually squat for a can. It will still generate, but designs are composed for a taller wall.`;
  }
  return null;
}

/** Nearest catalogue entry, or null when the numbers are custom. */
export function matchCanSize(diameterMm: number, heightMm: number): CanSize | null {
  return (
    CAN_SIZES.find(
      (c) => Math.abs(c.diameterMm - diameterMm) < 0.05 && Math.abs(c.heightMm - heightMm) < 0.05
    ) ?? null
  );
}
