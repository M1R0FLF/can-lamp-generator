// "Balloons" — hot air balloons at dawn.
//
// The envelope is the single best closed form in this whole set: a ~30mm
// teardrop, bright, with dark gore seams cut down it. That is rule 3 and rule 5
// working together — the big form carries legibility, the dark gores carry
// tone, and neither depends on a thin line surviving the sampling grid.
//
// Balloons sit at different heights and sizes to make a diagonal read up the
// can, so the wrap has a direction instead of being a flat row of motifs.
import { FieldCtx, clamp01, maxInto, subtractInto, heroSize, motifCount, harmonic, specks, wrapVary } from '../fieldkit';
import { circle, poly, band, thickline, rect, wedge, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

/**
 * Envelope + basket. `R` is the envelope half-width; the classic inverted
 * teardrop is built as a circle fused to a downward taper.
 */
function balloon(d: DrawCtx, cx: number, cy: number, R: number, gores: number) {
  const neckY = cy - R * 1.02;
  const neckHalf = R * 0.26;

  // --- envelope silhouette ---
  circle(d, cx, cy, R, 255);
  poly(d, [
    [cx - R * 0.96, cy - R * 0.28],
    [cx - neckHalf, neckY],
    [cx + neckHalf, neckY],
    [cx + R * 0.96, cy - R * 0.28],
  ], 255);

  // --- dark gore seams: vertical arcs following the envelope curvature ---
  for (let k = 0; k <= gores; k++) {
    const t = -1 + (2 * k) / gores; // -1..1 across the envelope
    const pts: Array<[number, number]> = [];
    for (let s = 0; s <= 26; s++) {
      const v = s / 26; // 0 at the top, 1 at the neck
      const ang = Math.PI * 0.5 - v * Math.PI * 0.92;
      const yy = cy + Math.sin(ang) * R * 1.0;
      // seams converge at top and bottom, bulge at the equator
      const xx = cx + t * Math.cos(ang) * R * 0.99;
      pts.push([xx, Math.max(yy, neckY)]);
    }
    thickline(d, pts, R * 0.075, 0);
  }
  // one bright horizontal band around the equator, cutting the gores
  const bandPts: Array<[number, number]> = [];
  for (let s = 0; s <= 40; s++) {
    const u = -1 + (2 * s) / 40;
    bandPts.push([cx + u * R * 0.99, cy + R * 0.1]);
  }
  thickline(d, bandPts, R * 0.14, 255);

  // --- basket: a small solid block hung below on two fat lines ---
  const bY = neckY - R * 0.5;
  thickline(d, [[cx - neckHalf * 0.8, neckY], [cx - R * 0.2, bY + R * 0.16]], R * 0.055, 255);
  thickline(d, [[cx + neckHalf * 0.8, neckY], [cx + R * 0.2, bY + R * 0.16]], R * 0.055, 255);
  rect(d, cx - R * 0.24, bY - R * 0.06, R * 0.48, R * 0.24, 255);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(3300);
  const groundY = 13.0;
  const skyTop = H - 8.5;

  // --- dawn sky: bright at the horizon, cooling upward ---
  let F = ctx.fn((x, y) => {
    if (y < groundY || y > skyTop) return 0;
    const glow = 0.6 + 0.4 * Math.exp(-Math.pow(ctx.dx(0.22 * W, x) / (0.3 * W), 2));
    const vert = Math.exp(-Math.max(y - groundY, 0) / 40);
    return Math.min(1, 0.07 + 0.8 * glow * vert);
  });

  // long dim cloud streaks — horizontal, so they never compete with the
  // balloons' vertical forms (rule 7 texture, not a second subject)
  const clouds = ctx.mask((d: DrawCtx) => {
    const n = harmonic(W, 84);
    for (let k = 0; k < 7; k++) {
      const y = groundY + 12 + k * 15.5;
      if (y > skyTop - 4) break;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= 110; s++) {
        const x = (s / 110) * W;
        pts.push([x, y + 2.4 * Math.sin((2 * Math.PI * n * x) / W + k * 1.3)]);
      }
      thickline(d, pts, 1.5 + (k % 3) * 0.8, 255);
    }
  });
  F = ctx.dimTexture(F, clouds, 0.26);

  maxInto(
    F,
    specks(ctx, {
      count: Math.max(12, Math.round((55 * W) / 204.2)),
      seed: 330,
      sizeLo: 0.4,
      sizeHi: 0.7,
      yLo: Math.min(skyTop - 6, groundY + 78),
      yHi: skyTop - 3,
    })
  );
  clamp01(F);

  // --- the sun, low and partly behind the horizon haze ---
  const sunR = heroSize(W, H, 13);
  const sun = ctx.mask((d: DrawCtx) => {
    wedge(d, 0.22 * W, groundY + 3, 0, sunR, 8, 172, 255);
  });
  maxInto(F, sun);

  // --- balloons ---
  // Sized per rule 3b's repeated-subject target: ~a quarter of the wall, no
  // more. An 18mm radius envelope is ~36mm across on a 142mm can. Deliberately
  // NOT pushed to half the wall — that overshoots for a multi-subject scene.
  const bigR = heroSize(W, H, 18.0, 0.16, 0.15);
  const count = motifCount(W, 58, 3);
  const balloons = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < count; k++) {
      // x as a fraction of the wrap; height and size vary via wrapVary() so the
      // sequence stays continuous across the seam. Using `k % 3` here put two
      // same-height balloons side by side over the seam.
      const cx = ((k + 0.42) / count) * W;
      // Two harmonics, not one: a single sine over N motifs only takes ~3
      // distinct values, so small counts get repeats. Both terms are integer
      // harmonics, so the sequence still closes across the seam.
      const wobble = 0.72 * wrapVary(k, count, 1) + 0.28 * wrapVary(k, count, 2, 1.1);
      const cy = groundY + (skyTop - groundY) * (0.55 + 0.21 * wobble);
      const R = bigR * (0.85 + 0.15 * wrapVary(k, count, 1, Math.PI / 2));
      balloon(d, cx, cy, R, 5 + (k % 2));
    }
  });
  F = ctx.moat(F, balloons, 3.2, 1.0);

  // --- ground: dark hills with a dim scrub texture ---
  const hills = ctx.mask((d: DrawCtx) => {
    const n = harmonic(W, 68);
    const pts: Array<[number, number]> = [[0, 0]];
    for (let s = 0; s <= 130; s++) {
      const x = (s / 130) * W;
      pts.push([x, groundY + 2.6 * Math.sin((2 * Math.PI * n * x) / W) + 1.6 * Math.sin((2 * Math.PI * n * 2 * x) / W + 1)]);
    }
    pts.push([W, 0]);
    poly(d, pts, 255);
  });
  subtractInto(F, hills, 1.0);

  const scrub = ctx.mask((d: DrawCtx) => {
    const m = motifCount(W, 3.4, 12);
    for (let k = 0; k < m; k++) {
      const x = (k + 0.5) * (W / m);
      const y = groundY - 1.6 - rng() * 4.0;
      poly(d, [[x - 0.9, y], [x + 0.9, y], [x, y + 2.2]], 255);
    }
  });
  F = ctx.dimTexture(F, scrub, 0.2);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= 7.0 && y <= skyTop) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.8, 1.2);
    band(d, H - 6.0, 1.2);
    band(d, H - 2.6, 2.6);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const balloons: Preset = {
  id: 'balloons',
  name: 'Balloons',
  group: 'urban',
  description: 'Hot air balloons climbing a dawn sky, gore seams cut dark into bright envelopes.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.08, mode: 'hybrid', knee: 0.46, gamma: 0.66 },
  build,
};
