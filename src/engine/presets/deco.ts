// "Deco" — Art Deco sunburst and ziggurat bands.
//
// Radial fans are the heroes; stepped chevron bands and vertical fluting give
// the strong verticals that suit a cylinder. Fan wedge counts and band repeats
// are integers so everything closes around the wrap.
import { FieldCtx, clamp01, maxInto, subtractInto, heroSize, motifCount } from '../fieldkit';
import { wedge, circle, poly, band, arc, thickline, DrawCtx } from '../draw';
import { Preset } from './types';

/** Radiating wedge fan with a solid hub — the Deco sunburst. */
function sunburst(
  d: DrawCtx,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  rays: number,
  duty: number,
  a0 = 0,
  a1 = 360
) {
  const span = (a1 - a0) / rays;
  for (let k = 0; k < rays; k++) {
    const s = a0 + k * span;
    wedge(d, cx, cy, rIn, rOut, s, s + span * duty, 255);
  }
  circle(d, cx, cy, rIn, 255);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const heroX = 0.25 * W;
  const heroY = 80;
  const heroR = heroSize(W, H, 31.7, 0.3, 0.3);

  // --- vertical fluting at a fixed pitch: the dim texture layer ---
  const fluteCount = motifCount(W, 2.43, 12);
  const flutes = ctx.fn((x, y) => {
    if (y < 13 || y > H - 13) return 0;
    const t = ((x / W) * fluteCount) % 1;
    return Math.abs(t - 0.5) > 0.36 ? 1 : 0;
  });

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, flutes, 0.14);

  // --- concentric arc halo behind the hero ---
  const halo = ctx.mask((d: DrawCtx) => {
    for (const rr of [1.35, 1.62, 1.86]) {
      arc(d, heroX, heroY, heroR * rr, 0, 360, 0.9, 255);
    }
  });
  F = ctx.dimTexture(F, halo, 0.34);

  // --- hero sunburst + a smaller counterpoint fan ---
  const heroes = ctx.mask((d: DrawCtx) => {
    sunburst(d, heroX, heroY, heroR * 0.3, heroR, 16, 0.56);
    // dark concentric cuts inside the solid hub (rule 3)
    circle(d, heroX, heroY, heroR * 0.22, 0);
    circle(d, heroX, heroY, heroR * 0.13, 255);
    arc(d, heroX, heroY, heroR * 0.62, 0, 360, heroR * 0.045, 0);

    const secX = 0.72 * W;
    const secY = 60;
    const secR = heroR * 0.62;
    sunburst(d, secX, secY, secR * 0.32, secR, 12, 0.54);
    circle(d, secX, secY, secR * 0.16, 0);
  });

  // --- rising ziggurat steps, fixed mm so they keep their proportions ---
  const zig = ctx.mask((d: DrawCtx) => {
    const n = 6;
    const stepW = 8.2;
    const stride = 11.2;
    for (let k = 0; k < n; k++) {
      const h = 14 + k * 5;
      const x0 = 0.42 * W + k * stride;
      poly(d, [[x0, 14], [x0 + stepW, 14], [x0 + stepW, 14 + h], [x0, 14 + h]], 255);
      const x1 = 0.98 * W - k * stride;
      poly(d, [[x1 - stepW, 14], [x1, 14], [x1, 14 + h], [x1 - stepW, 14 + h]], 255);
    }
  });

  F = ctx.moat(F, zig, 2.2, 0.8);
  F = ctx.moat(F, heroes, 3.6, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= 10.7 && y <= H - 10.7) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  // --- chevron border bands at a fixed fret pitch ---
  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 4.3, 1.4);
    band(d, H - 6.8, 1.4);
    band(d, H - 2.8, 2.8);
    const n = motifCount(W, 6.4, 8);
    for (let k = 0; k < n; k++) {
      const u = W / n;
      const x = k * u;
      // stepped fret, top and bottom
      poly(d, [[x, 7.1], [x + u * 0.5, 10.2], [x + u, 7.1], [x + u, 8.8], [x + u * 0.5, 11.9], [x, 8.8]], 255);
      poly(d, [[x, H - 9.1], [x + u * 0.5, H - 12.2], [x + u, H - 9.1], [x + u, H - 10.8], [x + u * 0.5, H - 13.9], [x, H - 10.8]], 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const deco: Preset = {
  id: 'deco',
  name: 'Art Deco',
  group: 'art',
  description: 'Art Deco sunburst fans, ziggurat steps and stepped fret borders over vertical fluting.',
  stipple: { pitchMm: 1.3, dMin: 0.26, dMax: 0.52, jitter: 0.1, thresh: 0.08, mode: 'hybrid', knee: 0.42, gamma: 0.7 },
  build,
};
