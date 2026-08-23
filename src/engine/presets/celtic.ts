// "Celtic" — interlaced knotwork plait.
//
// The other "boring repeating pattern" entry alongside Nordic. The strands are
// deliberately FAT (~4mm) rather than drawn as outlines: a thin interlace is
// exactly the filigree that dissolves at this pitch (rule 3), while a chunky
// plait stays legible as a woven ribbon from across the room.
//
// Over/under is faked the cheap way — at each crossing the under-strand gets a
// dark notch cut across it. That reads as weaving without needing real path
// clipping.
import { FieldCtx, clamp01, maxInto, repeatsFor, harmonic } from '../fieldkit';
import { thickline, circle, band, ngon, DrawCtx } from '../draw';
import { Preset } from './types';

/** One sinusoidal strand as a polyline, sampled fine enough to look smooth. */
function strandPts(
  W: number,
  yc: number,
  amp: number,
  cycles: number,
  phase: number
): Array<[number, number]> {
  const steps = Math.max(48, cycles * 24);
  const pts: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const x = (s / steps) * W;
    pts.push([x, yc + amp * Math.sin((2 * Math.PI * cycles * x) / W + phase)]);
  }
  return pts;
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const yLo = 9.5;
  const yHi = H - 9.5;

  // Authored band height in mm; a taller can gets more plait rows.
  const rowH = 21.0;
  const rowCount = Math.max(2, Math.floor((yHi - yLo) / rowH));
  const rh = (yHi - yLo) / rowCount;
  // Integer cycle count keeps every strand closing on itself at the seam.
  const cycles = harmonic(W, 26.0);
  const amp = rh * 0.28;
  const strandW = Math.min(4.2, rh * 0.24);

  // Two counter-phase strands per row = a classic plait.
  const plait = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j < rowCount; j++) {
      const yc = yLo + (j + 0.5) * rh;
      thickline(d, strandPts(W, yc, amp, cycles, 0), strandW, 255);
      thickline(d, strandPts(W, yc, amp, cycles, Math.PI), strandW, 255);
    }
  });

  // Dark notches at the crossings, where the two strands share a y.
  const notches = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j < rowCount; j++) {
      const yc = yLo + (j + 0.5) * rh;
      for (let k = 0; k < cycles * 2; k++) {
        // sin(t) == sin(t+pi) at the zero crossings: x = k * W/(2*cycles)
        const x = (k * W) / (2 * cycles);
        const lean: Array<[number, number]> = k % 2 === 0
          ? [[x - strandW * 0.9, yc - strandW * 0.9], [x + strandW * 0.9, yc + strandW * 0.9]]
          : [[x - strandW * 0.9, yc + strandW * 0.9], [x + strandW * 0.9, yc - strandW * 0.9]];
        thickline(d, lean, strandW * 0.42, 255);
      }
    }
  });

  // Round bosses in the lens-shaped voids between rows — the closed forms that
  // give the eye something solid to land on.
  const bosses = ctx.mask((d: DrawCtx) => {
    const n = repeatsFor(W, 26.0);
    const u = W / n;
    for (let j = 0; j <= rowCount; j++) {
      const y = yLo + j * rh;
      if (y < yLo + 0.5 || y > yHi - 0.5) continue;
      for (let k = 0; k < n; k++) {
        const cx = (k + (j % 2 ? 0.5 : 0.0)) * u;
        const R = Math.min(u * 0.17, rh * 0.2);
        circle(d, cx, y, R, 255);
        circle(d, cx, y, R * 0.42, 0);
      }
    }
  });

  // Dim triangular fill in the voids (rule 7) so the ground isn't dead black.
  const voids = ctx.mask((d: DrawCtx) => {
    const n = repeatsFor(W, 13.0);
    const u = W / n;
    for (let j = 0; j < rowCount; j++) {
      const yc = yLo + (j + 0.5) * rh;
      for (let k = 0; k < n; k++) {
        const cx = (k + 0.5) * u;
        ngon(d, cx, yc + rh * 0.4, Math.min(u * 0.2, rh * 0.1), 3, 90, 255);
        ngon(d, cx, yc - rh * 0.4, Math.min(u * 0.2, rh * 0.1), 3, -90, 255);
      }
    }
  });

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, voids, 0.15);
  F = ctx.moat(F, bosses, 1.6, 0.72);
  F = ctx.moat(F, plait, 2.4, 1.0);
  // cut the over/under notches back out of the finished ribbon
  for (let i = 0; i < F.length; i++) if (notches[i] > 0.5) F[i] = 0;

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.8, 1.4);
    band(d, H - 6.1, 1.4);
    band(d, H - 2.7, 2.7);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const celtic: Preset = {
  id: 'celtic',
  name: 'Celtic',
  group: 'art',
  description: 'Interlaced knotwork plait in fat ribbons, with round bosses between the rows.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.09, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.7 },
  build,
};
