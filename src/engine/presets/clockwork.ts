// "Clockwork" — meshing gear train.
//
// This is the tech-group design done the way Circuit should have been: PCB
// traces failed because a trace is a thin line, and a field of thin lines has
// no closed form anywhere in it. A gear is the opposite — a fat disc with
// chunky teeth, ~30mm across, with all its detail cut DARK inside the disc
// (hub, spokes, lightening holes).
//
// Teeth are drawn as trapezoids on the rim rather than as a stroked outline, so
// the wheel stays one solid silhouette.
import { FieldCtx, clamp01, maxInto, motifCount, heroSize, harmonic, wrapVary } from '../fieldkit';
import { circle, band, thickline, wedge, poly, DrawCtx } from '../draw';
import { Preset } from './types';

interface Gear {
  cx: number;
  cy: number;
  R: number;
  teeth: number;
  spokes: number;
  phase: number;
}

function gear(d: DrawCtx, g: Gear) {
  const { cx, cy, R, teeth, spokes, phase } = g;
  const toothH = R * 0.15;
  const rBody = R - toothH;

  // --- teeth: trapezoids standing on the body rim ---
  for (let k = 0; k < teeth; k++) {
    const a0 = phase + (k * 2 * Math.PI) / teeth;
    const halfIn = (Math.PI / teeth) * 0.56;
    const halfOut = (Math.PI / teeth) * 0.34;
    const p: Array<[number, number]> = [
      [cx + rBody * Math.cos(a0 - halfIn), cy + rBody * Math.sin(a0 - halfIn)],
      [cx + R * Math.cos(a0 - halfOut), cy + R * Math.sin(a0 - halfOut)],
      [cx + R * Math.cos(a0 + halfOut), cy + R * Math.sin(a0 + halfOut)],
      [cx + rBody * Math.cos(a0 + halfIn), cy + rBody * Math.sin(a0 + halfIn)],
    ];
    poly(d, p, 255);
  }

  // --- solid body ---
  circle(d, cx, cy, rBody, 255);

  // --- dark structure inside: rim groove, lightening holes, hub bore ---
  circle(d, cx, cy, rBody * 0.82, 0);
  circle(d, cx, cy, rBody * 0.74, 255);
  // spokes: bright bars across the dark web
  for (let k = 0; k < spokes; k++) {
    const a = phase * 0.4 + (k * 2 * Math.PI) / spokes;
    thickline(
      d,
      [
        [cx + rBody * 0.1 * Math.cos(a), cy + rBody * 0.1 * Math.sin(a)],
        [cx + rBody * 0.8 * Math.cos(a), cy + rBody * 0.8 * Math.sin(a)],
      ],
      rBody * 0.17,
      255
    );
  }
  // hub
  circle(d, cx, cy, rBody * 0.28, 255);
  circle(d, cx, cy, rBody * 0.12, 0);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const yLo = 9.0;
  const yHi = H - 9.0;
  const mid = (yLo + yHi) / 2;

  // A wider can gets more gears in the train, not bigger ones (rule 1).
  const bigR = heroSize(W, H, 21, 0.16, 0.19);
  const n = motifCount(W, 41, 3);
  const u = W / n;

  const gears: Gear[] = [];
  for (let k = 0; k < n; k++) {
    const cx = (k + 0.5) * u;
    // The train undulates up and down so it reads as a mechanism rather than a
    // row. Driven by wrapVary(), not `k % 2`: strict alternation cannot close
    // on a wrap at all when the gear count is odd (and it often is), which
    // leaves two same-height gears adjacent across the seam.
    const cy = mid + wrapVary(k, n) * bigR * 0.62;
    gears.push({ cx, cy, R: bigR, teeth: 18, spokes: 6, phase: (k * Math.PI) / 18 });
    // a small idler wheel tucked between each pair, riding the opposite phase
    gears.push({
      cx: cx + u * 0.5,
      cy: mid - wrapVary(k, n, 1, Math.PI / n) * bigR * 0.74,
      R: bigR * 0.44,
      teeth: 10,
      spokes: 4,
      phase: 0.2 + k,
    });
  }
  const wheels = ctx.mask((d: DrawCtx) => {
    for (const g of gears) gear(d, g);
  });

  // --- dim plate texture behind the train (rule 7) ---
  // Guilloché is the right reference — it's what's actually engraved on watch
  // movements, so it reads as a machined surface rather than as noise. Drawn
  // as strokes into a mask rather than via the analytic guilloche() helper:
  // that helper is O(pixels x lines) with two sin() per line per pixel, which
  // cost ~800ms here on its own. Canvas rasterizes the same curves in C (see
  // the port plan in CLAUDE.md).
  const plateWaves = harmonic(W, 41);
  const plate = ctx.mask((d: DrawCtx) => {
    const lines = 30;
    for (let k = 0; k < lines; k++) {
      const base = yLo + ((k + 0.5) * (yHi - yLo)) / lines;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= 160; s++) {
        const x = (s / 160) * W;
        const t = (2 * Math.PI * plateWaves * x) / W;
        pts.push([x, base + 4.2 * Math.sin(t + k * 0.7) + 2.1 * Math.sin(t * 2.3 + k)]);
      }
      thickline(d, pts, 0.4, 255);
    }
  });
  // plus a few bright screw bosses on the plate
  const screws = ctx.mask((d: DrawCtx) => {
    const s = motifCount(W, 23, 4);
    for (let k = 0; k < s; k++) {
      for (const y of [yLo + 3.4, yHi - 3.4]) {
        const x = ((k + 0.5) / s) * W;
        circle(d, x, y, 1.5, 255);
        thickline(d, [[x - 1.1, y], [x + 1.1, y]], 0.5, 0);
      }
    }
  });

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, plate, 0.15);
  F = ctx.moat(F, screws, 1.2, 0.62);
  F = ctx.moat(F, wheels, 2.8, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.7, 1.2);
    band(d, H - 6.0, 1.2);
    band(d, H - 2.6, 2.6);
    // ratchet teeth along the very bottom
    const t = motifCount(W, 4.2, 10);
    for (let k = 0; k < t; k++) {
      const x = k * (W / t);
      wedge(d, x, 6.2, 0, 1.5, 0, 180, 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const clockwork: Preset = {
  id: 'clockwork',
  name: 'Clockwork',
  group: 'tech',
  description: 'A meshing gear train with chunky teeth and spoked hubs on a guilloché plate.',
  stipple: { pitchMm: 1.2, dMin: 0.26, dMax: 0.5, jitter: 0.08, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.68 },
  build,
};
