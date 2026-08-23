// "Alpenglow" — layered mountain ridgelines against a low sun.
//
// Ridgelines are sums of sine harmonics with INTEGER frequencies, so every
// layer is periodic in W and wraps seamlessly at any diameter. Layers are
// composited back-to-front: each gets a rim light before being punched out as
// silhouette, so back ridges keep a lit edge where a nearer ridge crosses them.
import { FieldCtx, clamp01, maxInto, specks, rim, subtractInto, harmonic, heroSize } from '../fieldkit';
import { poly, band, circle, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

interface Ridge {
  /** baseline height in mm from the bottom edge */
  baseMm: number;
  /** [wavelengthMm, amplitudeMm, phase] — mm so peaks keep their shape/height */
  harmonics: Array<[number, number, number]>;
  rimMm: number;
  rimLevel: number;
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const sunX = 0.3 * W;
  // the sun must clear the highest ridgeline or it is simply hidden behind it
  const sunY = 90;
  const horizon = 14;
  const skyTop = H - 10;
  // angular atmospheric spreads scale with the wrap; the disc below does not
  const glowMm = 0.3 * W;
  const haloMm = 0.34 * W;

  // --- sky: warm glow around the sun over a broad horizon wash. The wash is
  // what the ridge silhouettes are read against, so it has to be generous. ---
  const F = ctx.fn((x, y) => {
    if (y < horizon || y > skyTop) return 0;
    const glow = Math.exp(-Math.pow(ctx.dx(sunX, x) / glowMm, 2));
    const halo = Math.exp(-Math.pow(Math.hypot(ctx.dx(sunX, x) * 0.8, (y - sunY) * 1.5) / haloMm, 2));
    const vert = Math.exp(-Math.max(y - horizon, 0) / (37 + 48 * glow));
    return Math.min(1, 0.05 + 0.7 * glow * vert + 0.75 * halo);
  });

  // --- sun disc, with a hard dark separation ring so it reads as an object ---
  const sunR = heroSize(W, H, 23);
  const sunMask = ctx.mask((d: DrawCtx) => circle(d, sunX, sunY, sunR));
  const sunGap = rim(ctx, sunMask, 3.4);
  subtractInto(F, sunGap, 0.95);
  maxInto(F, sunMask);

  // --- horizontal haze bars, day-gated so they only show near the sun ---
  for (const [hMm, amp, sigMm, waveMm] of [
    [105, 0.2, 2.8, 102],
    [118, 0.15, 2.4, 68],
  ] as Array<[number, number, number, number]>) {
    const freq = harmonic(W, waveMm);
    const layer = ctx.fn((x, y) => {
      const glow = Math.exp(-Math.pow(ctx.dx(sunX, x) / glowMm, 2));
      const off = 6.4 * Math.sin((2 * Math.PI * freq * x) / W);
      return amp * glow * Math.exp(-Math.pow((y - hMm - off) / sigMm, 2));
    });
    for (let i = 0; i < F.length; i++) F[i] += layer[i];
  }

  // --- stars, only away from the sun where the sky is actually dark ---
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(24, Math.round((110 * W) / 204.2)),
      seed: 31,
      sizeLo: 0.6,
      sizeHi: 0.95,
      yLo: Math.min(skyTop - 8, 85),
      yHi: skyTop - 3,
      accept: (x) => (Math.exp(-Math.pow(ctx.dx(sunX, x) / glowMm, 2)) < 0.18 ? 1 : 0),
    })
  );
  clamp01(F);

  // --- ridge layers, far to near. Bases stay below the sun so it reads as
  // sitting behind the range rather than being occluded by it. Wavelengths
  // and amplitudes are mm, so a wider can gets MORE peaks of the same size
  // rather than the same peaks stretched flat. ---
  const ridges: Ridge[] = [
    { baseMm: 57, harmonics: [[102, 21, 0.4], [68, 8.5, 2.1], [41, 4.3, 4.0], [19, 1.7, 1.3]], rimMm: 1.6, rimLevel: 1.0 },
    { baseMm: 41, harmonics: [[68, 17, 3.2], [41, 7.8, 1.1], [26, 3.1, 0.6], [16, 1.4, 2.7]], rimMm: 1.4, rimLevel: 0.85 },
    { baseMm: 28, harmonics: [[102, 14, 5.0], [51, 7.1, 2.6], [23, 2.8, 3.4]], rimMm: 1.2, rimLevel: 0.65 },
    { baseMm: 17, harmonics: [[204, 10, 1.7], [41, 4.3, 4.4], [29, 2.1, 0.9]], rimMm: 0.0, rimLevel: 0.0 },
  ];

  for (const ridge of ridges) {
    const freqs = ridge.harmonics.map(([waveMm]) => harmonic(W, waveMm));
    const yOf = (x: number) => {
      // |sin| on the dominant harmonic gives sharp alpine peaks rather than
      // the rolling hills a plain sine sum produces
      let y = ridge.baseMm;
      ridge.harmonics.forEach(([, ampMm, phase], i) => {
        const s = Math.sin((2 * Math.PI * freqs[i] * x) / W + phase);
        y += ampMm * (i === 0 ? Math.abs(s) * 1.15 - 0.35 : s);
      });
      return y;
    };
    const mask = ctx.mask((d: DrawCtx) => {
      const steps = 420;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= steps; s++) {
        const x = (W * s) / steps;
        pts.push([x, yOf(x)]);
      }
      pts.push([W, -2], [0, -2]);
      poly(d, pts, 255);
    });
    if (ridge.rimMm > 0) {
      const r = rim(ctx, mask, ridge.rimMm);
      for (let i = 0; i < F.length; i++) F[i] = Math.max(F[i], r[i] * ridge.rimLevel);
    }
    subtractInto(F, mask, 1.0);
  }

  // --- borders ---
  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.0, 1.1);
    band(d, H - 6.4, 1.1);
    band(d, H - 2.4, 2.4);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const alpenglow: Preset = {
  id: 'alpenglow',
  name: 'Alpenglow',
  group: 'nature',
  description: 'Layered mountain ridgelines silhouetted against a low sun, stars in the far sky.',
  stipple: { pitchMm: 1.35, dMin: 0.26, dMax: 0.52, jitter: 0.14, thresh: 0.1, mode: 'hybrid', knee: 0.4, gamma: 0.6 },
  build,
};
