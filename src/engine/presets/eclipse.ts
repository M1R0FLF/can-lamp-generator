// "Eclipse" — total solar eclipse with corona.
//
// The cosmic-group design, and a direct answer to why Orrery's constellation
// lines failed: instead of thin bright lines in empty space, the corona is
// built from broad TAPERED streamers that are widest where they meet the
// bright ring and fade outward. Every bright element is anchored to the disc.
//
// The black moon disc is the biggest real black in the whole preset set, which
// is exactly what makes the ring read (rule 5 — real blacks carry the image).
import { FieldCtx, clamp01, maxInto, specks, subtractInto, heroSize, motifCount } from '../fieldkit';
import { circle, band, taper2, wedge, thickline, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(4747);
  const yLo = 8.5;
  const skyTop = H - 8.5;

  // The disc sits at a fraction of the wrap, vertically centred.
  const cx = 0.34 * W;
  const cy = (yLo + skyTop) / 2;
  const R = heroSize(W, H, 26, 0.17, 0.22);

  // --- deep space: near-black with a faint gradient toward the disc ---
  let F = ctx.fn((x, y) => {
    if (y < yLo || y > skyTop) return 0;
    const d = Math.hypot(ctx.dx(cx, x), y - cy);
    return Math.min(1, 0.03 + 0.2 * Math.exp(-Math.pow(d / (R * 3.6), 2)));
  });

  // --- corona streamers: wide at the ring, tapering outward ---
  const streamers = ctx.mask((d: DrawCtx) => {
    const count = 26;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + 0.12;
      // equatorial streamers are longest — the real shape of a corona
      const equat = Math.abs(Math.cos(a));
      const len = R * (0.5 + 1.5 * Math.pow(equat, 1.6)) * (0.72 + rng() * 0.5);
      const w0 = R * (0.2 + rng() * 0.13);
      const x0 = cx + Math.cos(a) * R * 1.0;
      const y0 = cy + Math.sin(a) * R * 1.0;
      const x1 = cx + Math.cos(a) * (R + len);
      const y1 = cy + Math.sin(a) * (R + len);
      taper2(d, [x0, y0], [x1, y1], w0, w0 * 0.14, 255);
    }
  });

  // --- the chromosphere ring: the brightest thing on the can ---
  const ring = ctx.mask((d: DrawCtx) => {
    circle(d, cx, cy, R * 1.1, 255);
    circle(d, cx, cy, R * 0.99, 0);
  });

  // --- prominences: fat blobs licking off the ring edge ---
  const proms = ctx.mask((d: DrawCtx) => {
    const spots = [22, 96, 152, 238, 310];
    for (let i = 0; i < spots.length; i++) {
      const a = (spots[i] * Math.PI) / 180;
      const px = cx + Math.cos(a) * R * 1.06;
      const py = cy + Math.sin(a) * R * 1.06;
      circle(d, px, py, R * (0.1 + (i % 3) * 0.035), 255);
      wedge(d, cx, cy, R * 1.0, R * 1.22, spots[i] - 7, spots[i] + 7, 255);
    }
  });

  // corona sits at mid brightness so the ring still wins
  for (let i = 0; i < F.length; i++) if (streamers[i] > 0) F[i] = Math.max(F[i], 0.46);
  // dark radial partings inside the corona so it isn't a uniform halo (rule 7)
  const partings = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < 13; k++) {
      const a = (k / 13) * Math.PI * 2 + 0.36;
      thickline(
        d,
        [
          [cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05],
          [cx + Math.cos(a) * R * 3.0, cy + Math.sin(a) * R * 3.0],
        ],
        R * 0.055,
        255
      );
    }
  });
  for (let i = 0; i < F.length; i++) if (partings[i] > 0.4) F[i] *= 0.3;

  F = ctx.moat(F, proms, 1.2, 0.86);
  maxInto(F, ring);

  // --- the moon: punch the centre to absolute black, last, over everything ---
  const disc = ctx.mask((d: DrawCtx) => {
    circle(d, cx, cy, R * 0.985, 255);
  });
  subtractInto(F, disc, 1.0);
  clamp01(F);

  // --- background star field, thinned near the corona so it stays readable ---
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(60, Math.round((260 * W) / 204.2)),
      seed: 474,
      sizeLo: 0.45,
      sizeHi: 0.9,
      yLo: yLo + 2,
      yHi: skyTop - 2,
      accept: (x, y) => {
        const d = Math.hypot(ctx.dx(cx, x), y - cy);
        return d < R * 2.4 ? 0.05 : 1;
      },
    })
  );

  // a couple of bright "diamond ring" beads at one edge for asymmetry
  const beads = ctx.mask((d: DrawCtx) => {
    circle(d, cx + Math.cos(-0.5) * R * 1.05, cy + Math.sin(-0.5) * R * 1.05, R * 0.13, 255);
  });
  F = ctx.moat(F, beads, 2.0, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= skyTop) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.7, 1.2);
    band(d, H - 6.0, 1.2);
    band(d, H - 2.6, 2.6);
    // ticked scale along the base, like an instrument bezel
    const t = motifCount(W, 5.1, 10);
    for (let k = 0; k < t; k++) {
      const x = (k + 0.5) * (W / t);
      thickline(d, [[x, 6.0], [x, k % 5 === 0 ? 9.4 : 7.9]], 0.7, 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const eclipse: Preset = {
  id: 'eclipse',
  name: 'Eclipse',
  group: 'cosmic',
  description: 'Total solar eclipse: a black disc ringed with fire and broad corona streamers.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.6 },
  build,
};
