// "Honeycomb" — hex comb with bees.
//
// A tessellation like Girih, but the cells are deliberately NOT uniform: cell
// brightness follows a fullness gradient (honey pools at the bottom) plus
// per-cell jitter, with a scatter of empty cells left black. A comb of
// identical mid-tone cells would be exactly the "uniform mid-tone everywhere"
// that rule 7 warns kills contrast.
//
// The bees are the hero closed forms (rule 3) at ~16mm, moated against the
// comb so they read as figures rather than dissolving into the lattice.
import { FieldCtx, clamp01, maxInto, motifCount, repeatsFor, heroSize, wrapVary } from '../fieldkit';
import { ngon, ell, circle, band, thickline, taper2, poly, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

/**
 * One bee, drawn schematically rather than naturalistically.
 *
 * The first version fused abdomen, thorax and wings into a single striped
 * ellipse and read as a fish. What actually makes a bee legible at this scale
 * is three separated masses along the body axis plus BOLD stripes — and wings
 * held clear of the body with a visible dark gap, so they don't merge into the
 * silhouette. `L` is the total body length.
 */
function bee(d: DrawCtx, cx: number, cy: number, L: number, tilt: number) {
  const ct = Math.cos((tilt * Math.PI) / 180);
  const st = Math.sin((tilt * Math.PI) / 180);
  const T = (u: number, v: number): [number, number] => [
    cx + (u * ct - v * st) * L,
    cy + (u * st + v * ct) * L,
  ];

  // --- wings: two paddles above the body, separated from it by a gap ---
  for (const [uBase, uTip, vTip, w] of [
    [-0.06, 0.16, 0.52, 0.2],
    [-0.14, -0.3, 0.46, 0.16],
  ] as const) {
    taper2(d, T(uBase, 0.24), T(uTip, vTip), L * w, L * (w * 0.55), 255);
  }
  // dark vein down each wing so they aren't flat slabs
  thickline(d, [T(-0.05, 0.28), T(0.14, 0.5)], L * 0.028, 0);
  thickline(d, [T(-0.13, 0.28), T(-0.28, 0.44)], L * 0.028, 0);

  // --- abdomen: the dominant striped mass, tapering to a point ---
  ell(d, ...T(0.2, 0.0), L * 0.3, L * 0.2, 255);
  poly(d, [T(0.44, 0.14), T(0.6, 0.0), T(0.44, -0.14)], 255);
  // bold dark stripes — the single strongest "bee" cue
  for (let k = 0; k < 3; k++) {
    const u = 0.06 + k * 0.15;
    thickline(d, [T(u, -0.19), T(u, 0.19)], L * 0.062, 0);
  }

  // --- thorax: a separate round mass, with a dark waist pinching it off ---
  circle(d, ...T(-0.16, 0.0), L * 0.19, 255);
  thickline(d, [T(-0.02, -0.2), T(-0.02, 0.2)], L * 0.05, 0);

  // --- head: smaller still, with a dark eye and two antennae ---
  circle(d, ...T(-0.44, 0.0), L * 0.14, 255);
  circle(d, ...T(-0.47, 0.05), L * 0.05, 0);
  thickline(d, [T(-0.52, 0.1), T(-0.66, 0.28)], L * 0.035, 255);
  thickline(d, [T(-0.5, 0.13), T(-0.56, 0.32)], L * 0.035, 255);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const yLo = 9.0;
  const yHi = H - 9.0;
  const rng = mulberry32(1712);

  // Pointy-top hex tiling. Integer column count keeps the wrap seamless; the
  // cell size is authored in mm, so a wider can gets more cells (rule 1).
  const cols = repeatsFor(W, 13.4);
  const hexW = W / cols;
  const R = hexW / Math.sqrt(3);
  const rowH = R * 1.5;
  const rowCount = Math.max(3, Math.round((yHi - yLo) / rowH));

  // Per-cell fill level, decided once so the mask layers agree.
  const level: number[][] = [];
  for (let j = 0; j < rowCount; j++) {
    level[j] = [];
    for (let i = 0; i < cols; i++) {
      const t = 1 - j / Math.max(1, rowCount - 1); // fuller at the bottom
      const v = 0.28 + 0.72 * t + (rng() - 0.5) * 0.5;
      // leave roughly one cell in seven properly empty — the real blacks
      level[j][i] = rng() < 0.14 ? 0 : Math.min(1, Math.max(0, v));
    }
  }

  // Bright cells, drawn at three tiers so the comb never flattens out.
  const combHi = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j < rowCount; j++) {
      const cy = yLo + (j + 0.5) * rowH;
      for (let i = 0; i < cols; i++) {
        if (level[j][i] < 0.66) continue;
        const cx = (i + (j % 2 ? 0.5 : 0.0)) * hexW;
        ngon(d, cx, cy, R * 0.86, 6, 30, 255);
        ngon(d, cx, cy, R * 0.42, 6, 30, 0);
      }
    }
  });
  const combMid = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j < rowCount; j++) {
      const cy = yLo + (j + 0.5) * rowH;
      for (let i = 0; i < cols; i++) {
        const L = level[j][i];
        if (L < 0.24 || L >= 0.66) continue;
        const cx = (i + (j % 2 ? 0.5 : 0.0)) * hexW;
        ngon(d, cx, cy, R * 0.82, 6, 30, 255);
        ngon(d, cx, cy, R * 0.5, 6, 30, 0);
      }
    }
  });

  // Dim wax webbing between every cell (rule 7).
  const webs = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j < rowCount; j++) {
      const cy = yLo + (j + 0.5) * rowH;
      for (let i = 0; i < cols; i++) {
        const cx = (i + (j % 2 ? 0.5 : 0.0)) * hexW;
        const pts: Array<[number, number]> = [];
        for (let k = 0; k <= 6; k++) {
          const a = ((30 + 60 * k) * Math.PI) / 180;
          pts.push([cx + R * 0.97 * Math.cos(a), cy + R * 0.97 * Math.sin(a)]);
        }
        thickline(d, pts, 0.5, 255);
      }
    }
  });

  // Bees sized per rule 3b, and only two of them: at 16.5mm with four bees the
  // comb simply outcompeted them and they read as dark smudges.
  const beeL = heroSize(W, H, 34, 0.24, 0.26);
  const beeCount = motifCount(W, 96, 2);
  const bees = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < beeCount; k++) {
      // positions as fractions of the wrap (rule 1); height and tilt via
      // wrapVary() so they stay varied across the seam (see fieldkit)
      const cx = ((k + 0.35) / beeCount) * W;
      const cy = yLo + (yHi - yLo) * (0.5 + 0.17 * wrapVary(k, beeCount));
      bee(d, cx, cy, beeL, 13 * wrapVary(k, beeCount, 1, 0.6));
    }
  });

  // Carve a genuinely dark clearing in the comb around each bee. Without it the
  // bee is bright-on-bright and only its moat ring survives visually — which is
  // exactly how the first version failed. Rule 3b: the subject needs dark
  // breathing room, not just a moat.
  const clearing = ctx.dilate(bees, 9.0);

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, webs, 0.15);
  F = ctx.moat(F, combMid, 0.9, 0.5);
  F = ctx.moat(F, combHi, 1.1, 0.84);
  for (let i = 0; i < F.length; i++) {
    if (clearing[i] > 0) F[i] *= 1 - 0.94 * Math.min(1, clearing[i]);
  }
  F = ctx.moat(F, bees, 2.4, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.6, 1.3);
    band(d, H - 5.9, 1.3);
    band(d, H - 2.6, 2.6);
    // a row of small hex pips along the base
    const n = motifCount(W, 6.2, 8);
    for (let k = 0; k < n; k++) ngon(d, (k + 0.5) * (W / n), 6.6, 1.1, 6, 30, 255);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const honeycomb: Preset = {
  id: 'honeycomb',
  name: 'Honeycomb',
  group: 'nature',
  description: 'Hex comb filled unevenly with honey, worked by a few big moated bees.',
  stipple: { pitchMm: 1.2, dMin: 0.26, dMax: 0.5, jitter: 0.08, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.68 },
  build,
};
