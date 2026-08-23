// "Current" — a river bending through gentle hills, sun glinting on the water.
//
// The river is the hero: a bright winding ribbon with its own moat, carrying
// a soft mirrored reflection of the sky above it. Reeds along the banks
// (borrowed straight from the botanical shape library) keep the foreground
// from reading as empty.
import { FieldCtx, clamp01, maxInto, subtractInto, rim, harmonic, heroSize, motifCount } from '../fieldkit';
import { poly, circle, band, DrawCtx } from '../draw';
import { grass } from '../shapes/botanical';
import { mulberry32 } from '../rng';
import { Preset } from './types';

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(4004);
  const sunX = 0.34 * W;
  const sunY = 102;
  const horizon = 71;
  const skyTop = H - 10;
  const glowMm = 0.34 * W; // angular
  const reflectGlowMm = 0.22 * W;

  // --- sky: soft warm glow low over the hills ---
  const F = ctx.fn((x, y) => {
    if (y > skyTop) return 0;
    if (y < horizon) return 0; // river band fills below; set separately
    const glow = Math.exp(-Math.pow(ctx.dx(sunX, x) / glowMm, 2));
    const vert = Math.exp(-Math.max(y - horizon, 0) / (20 + 31 * glow));
    return Math.min(1, 0.06 + 0.6 * glow * vert);
  });

  // --- river: a winding band, brighter where it mirrors the sun. Meander
  // wavelength and width are mm, so a wider can gets more bends of the same
  // size rather than one stretched bend. ---
  const meanderFreq = harmonic(W, 102);
  const widthFreq = harmonic(W, 68);
  const riverCenter = (x: number) => 31 + 12.8 * Math.sin((2 * Math.PI * meanderFreq * x) / W + 0.6);
  const riverHalfW = (x: number) => 7.1 + 2.6 * Math.sin((2 * Math.PI * widthFreq * x) / W + 2.1);
  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= horizon) continue;
    const base = row * ctx.Wp;
    for (let col = 0; col < ctx.Wp; col++) {
      const x = ctx.xAt(col);
      const c = riverCenter(x);
      const hw = riverHalfW(x);
      if (Math.abs(y - c) > hw) continue;
      const glow = Math.exp(-Math.pow(ctx.dx(sunX, x) / reflectGlowMm, 2));
      const mirrorY = horizon + (horizon - y) * 0.6; // reflect the sky glow
      const reflect = Math.exp(-Math.max(mirrorY - horizon, 0) / (20 + 31 * glow));
      F[base + col] = Math.min(1, 0.12 + 0.55 * glow * reflect + 0.15 * (1 - Math.abs(y - c) / hw));
    }
  }
  clamp01(F);

  // --- sun with a dark separation ring, sitting right at the waterline ---
  const sunR = heroSize(W, H, 12);
  const sun = ctx.mask((d: DrawCtx) => circle(d, sunX, sunY, sunR));
  subtractInto(F, rim(ctx, sun, 2.6), 0.85);
  maxInto(F, sun);
  clamp01(F);

  // --- far hill silhouette above the river ---
  const hillF1 = harmonic(W, 102);
  const hillF2 = harmonic(W, 41);
  const hill = ctx.mask((d: DrawCtx) => {
    const steps = 340;
    const pts: Array<[number, number]> = [];
    for (let s = 0; s <= steps; s++) {
      const x = (W * s) / steps;
      const y =
        82 +
        7.1 * Math.sin((2 * Math.PI * hillF1 * x) / W + 1.1) +
        2.8 * Math.sin((2 * Math.PI * hillF2 * x) / W + 3.0);
      pts.push([x, y]);
    }
    pts.push([W, skyTop + 2], [0, skyTop + 2]);
    poly(d, pts, 255);
  });
  subtractInto(F, hill, 1.0);

  // near bank silhouette below the river, with reeds
  const bank = ctx.mask((d: DrawCtx) => {
    const steps = 260;
    const pts: Array<[number, number]> = [];
    for (let s = 0; s <= steps; s++) {
      const x = (W * s) / steps;
      const c = riverCenter(x);
      const hw = riverHalfW(x);
      pts.push([x, c - hw]);
    }
    pts.push([W, -2], [0, -2]);
    poly(d, pts, 255);
    // reeds at a fixed spacing along the bank
    const reeds = motifCount(W, 51, 2);
    for (let k = 0; k < reeds; k++) {
      const x = ((k + 0.2) / reeds) * W;
      const y = riverCenter(x) - riverHalfW(x) - 1;
      grass(d, x, y, 5 + rng() * 4, rng, 6);
    }
  });
  subtractInto(F, bank, 1.0);

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.6, 1.0);
    band(d, H - 6.0, 1.0);
    band(d, H - 2.6, 2.6);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const current: Preset = {
  id: 'current',
  name: 'Current',
  group: 'nature',
  description: 'A river bending through the hills, catching the low sun; reeds along the bank.',
  stipple: { pitchMm: 1.3, dMin: 0.26, dMax: 0.5, jitter: 0.13, thresh: 0.07, mode: 'hybrid', knee: 0.4, gamma: 0.6 },
  build,
};
