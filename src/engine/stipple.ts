// Hex-grid stipple sampler. Implements the three tone-carrying modes from
// CLAUDE.md rule 5 (density carries tone, not size):
//
//   FM     - fixed hole size, density dithered. Background texture.
//   AM     - every grid point above threshold gets a hole, size varies as
//            tone^gamma. gamma 0.5 makes open area linear in tone, which is
//            the principled default; the reference presets use their own
//            tuned exponents (Mango 0.85, Escarcha 1.0) and keep them.
//   HYBRID - full density above `knee`, density falls off below it, and size
//            varies too. The reference Escarcha behaviour; best general default.
//
// pitch >= d_max + min_web is the caller's job to verify against the measured
// holes (rule 2) — with jitter the nominal bound degrades, so minweb.ts
// measures the real thing.
import { mulberry32 } from './rng';

export type StippleMode = 'fm' | 'am' | 'hybrid';

export interface Hole {
  x: number;
  y: number;
  r: number;
}

export interface StippleParams {
  pitchMm: number;
  dMin: number;
  dMax: number;
  jitter: number;
  thresh: number;
  mode: StippleMode;
  /** size exponent for AM/HYBRID; 0.5 => open area linear in tone */
  gamma: number;
  /** HYBRID: below this tone, density starts dropping out */
  knee: number;
  /** FM: the one hole size used everywhere */
  fixedDiameterMm: number;
  seed: number;
}

export const DEFAULT_STIPPLE: StippleParams = {
  pitchMm: 1.45,
  dMin: 0.28,
  dMax: 0.52,
  jitter: 0.15,
  thresh: 0.13,
  mode: 'hybrid',
  gamma: 0.5,
  knee: 0.42,
  fixedDiameterMm: 0.35,
  seed: 3,
};

export interface StippleResult {
  holes: Hole[];
  pitch: number;
  rows: number;
  cols: number;
}

function mod1(v: number): number {
  return v - Math.floor(v);
}

/**
 * Low-discrepancy per-cell dither value in [0,1). These constants are the
 * reference generators' verbatim screen hash (interleaved-gradient-noise
 * style); it yields a blue-noise-ish spatial distribution, which matters
 * because clumped dropouts read as mottling rather than smooth tone.
 */
function ditherHash(i: number, j: number): number {
  return mod1(52.9829189 * mod1(0.06711056 * i + 0.00583715 * j));
}

export function stipple(
  F: Float32Array,
  W: number,
  H: number,
  Wp: number,
  Hp: number,
  PPM: number,
  params: Partial<StippleParams> = {}
): StippleResult {
  const p0 = { ...DEFAULT_STIPPLE, ...params };
  const { pitchMm, dMin, dMax, jitter, thresh, mode, gamma, knee, fixedDiameterMm } = p0;

  const cols = Math.max(1, Math.round(W / pitchMm));
  const p = W / cols;
  const rowsp = (p * Math.sqrt(3)) / 2;
  const rows = Math.max(1, Math.round(H / rowsp));

  const holes: Hole[] = [];
  const rng = mulberry32(p0.seed);
  const fixedR = fixedDiameterMm / 2;

  for (let j = 0; j < rows; j++) {
    const yRow = (j + 0.5) * rowsp;
    for (let i = 0; i < cols; i++) {
      let x = (i + (j % 2 ? 0.5 : 0.0)) * p + p * 0.5;
      x += (rng() - 0.5) * 2 * jitter * p;
      const y = yRow + (rng() - 0.5) * 2 * jitter * rowsp;
      if (!(y > 0.3 && y < H - 0.3)) continue;

      const xw = ((x % W) + W) % W;
      const px = Math.min(Wp - 1, Math.max(0, Math.floor(xw * PPM)));
      const py = Math.min(Hp - 1, Math.max(0, Math.floor((H - y) * PPM)));
      const f = F[py * Wp + px];
      if (f <= thresh) continue;

      const g = (f - thresh) / (1 - thresh);
      const yFlipped = H - y;

      if (mode === 'fm') {
        const t = ditherHash(i, j);
        if (f > 0.78 || f > 0.04 + 0.84 * t) {
          holes.push({ x: xw, y: yFlipped, r: fixedR });
        }
        continue;
      }

      if (mode === 'hybrid') {
        const t = ditherHash(i, j);
        // full density once tone reaches the knee, proportional below it
        if (t >= Math.min(1.0, f / Math.max(knee, 1e-6))) continue;
      }

      const d = dMin + (dMax - dMin) * Math.pow(g, gamma);
      holes.push({ x: xw, y: yFlipped, r: d / 2 });
    }
  }

  return { holes, pitch: p, rows, cols };
}
