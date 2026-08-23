// "Horizon" — a calm, soft far-off landscape: gentle rolling hills under a
// wide sky, one big soft sun low on the horizon, and a flock of birds.
//
// Deliberately the quiet counterpart to Alpenglow: no dramatic ray-burst, no
// jagged peaks, no night sky — just a soft glow and gentle silhouettes. Rule
// 3 in a minor key: the hero is a single plain disc, big and closed.
//
// Sizes are mm constants and hill wavelengths are held constant via
// harmonic(), so the composition looks the same on a 65mm can and a 100mm one
// (see harmonic()'s note on why `0.09 * W` was wrong).
import { FieldCtx, clamp01, maxInto, subtractInto, rim, harmonic, heroSize, motifCount } from '../fieldkit';
import { poly, circle, band, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(2024);
  const sunR = heroSize(W, H, 18);
  // Atmospheric falloff is ANGULAR — it's a spread across the sky, so it
  // legitimately scales with circumference. Only solid objects (the disc
  // below) are fixed mm. Getting this backwards left a fat can mostly dark.
  const glowMm = 0.42 * W;
  const sunX = 0.62 * W;
  const sunY = 60;
  const horizon = 13;
  const skyTop = H - 10;

  // The ambient floor has to clear the stipple threshold (0.10) with room to
  // spare. At 0.08 the far-from-sun sky bottomed out at 0.099 — grazing the
  // cutoff, so neighbouring samples flipped between "holes" and "no holes"
  // and carved a hard-edged wedge out of a smooth gradient. Either commit to
  // real black or stay clearly above the threshold; never sit on it.
  let F = ctx.fn((x, y) => {
    if (y < horizon || y > skyTop) return 0;
    const glow = Math.exp(-Math.pow(ctx.dx(sunX, x) / glowMm, 2));
    const vert = Math.exp(-Math.max(y - horizon, 0) / (42 + 50 * glow));
    return Math.min(1, 0.125 + 0.55 * glow * vert);
  });

  // sun: one plain soft disc with a dark separation ring
  const sun = ctx.mask((d: DrawCtx) => circle(d, sunX, sunY, sunR));
  subtractInto(F, rim(ctx, sun, 3.0), 0.85);
  maxInto(F, sun);
  clamp01(F);

  // Birds: a fixed density per mm of circumference, so a wider can gets more
  // of them rather than bigger ones. Drawn as DARK silhouettes rather than
  // bright forms with a moat — a moat separates a bright shape from a dark
  // background, but against this bright sky it just made each bird read as a
  // dark speck. A bird against a sunset is a silhouette anyway.
  const birdCount = motifCount(W, 23, 3);
  const birds = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < birdCount; k++) {
      const x = ((k + 0.5) / birdCount + (rng() - 0.5) * 0.4 / birdCount) * W;
      const y = Math.min(skyTop - 6, 78 + rng() * 42);
      const s = 2.4 + rng() * 1.8;
      const a = -0.5 + rng() * 0.3;
      poly(
        d,
        [
          [x - s, y + s * a * 0.4],
          [x, y],
          [x + s, y + s * a * 0.4],
          [x, y - s * 0.35],
        ],
        255
      );
    }
  });
  subtractInto(F, birds, 1.0);

  // Rolling hill layers. Wavelengths and amplitudes in mm, baselines anchored
  // in mm from the bottom, so the terrain is identical at any diameter and a
  // taller can simply gains sky above it.
  const layers: Array<{ baseMm: number; waveMm: number; ampMm: number; phase: number }> = [
    { baseMm: 34, waveMm: 104, ampMm: 7.0, phase: 0.7 },
    { baseMm: 23, waveMm: 68, ampMm: 5.0, phase: 2.3 },
    { baseMm: 12, waveMm: 150, ampMm: 4.0, phase: 4.1 },
  ];
  for (const layer of layers) {
    const freq = harmonic(W, layer.waveMm);
    const yOf = (x: number) =>
      layer.baseMm + layer.ampMm * Math.sin((2 * Math.PI * freq * x) / W + layer.phase);
    const mask = ctx.mask((d: DrawCtx) => {
      const steps = 360;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= steps; s++) {
        const x = (W * s) / steps;
        pts.push([x, yOf(x)]);
      }
      pts.push([W, -2], [0, -2]);
      poly(d, pts, 255);
    });
    subtractInto(F, mask, 1.0);
  }

  // borders anchored in mm to each edge, so they sit at the rim on any can
  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.4, 1.0);
    band(d, H - 6.7, 1.0);
    band(d, H - 2.3, 2.3);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const horizon: Preset = {
  id: 'horizon',
  name: 'Horizon',
  group: 'nature',
  description: 'A quiet far-off landscape: soft sun, rolling hills, a flock of birds crossing the sky.',
  stipple: { pitchMm: 1.35, dMin: 0.26, dMax: 0.5, jitter: 0.14, thresh: 0.1, mode: 'hybrid', knee: 0.4, gamma: 0.6 },
  build,
};
