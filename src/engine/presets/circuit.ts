// "Circuit" — printed-circuit board.
//
// Redesigned for legibility: clean orthogonal (Manhattan) traces instead of
// diagonal doglegs, fewer but bigger DIP-style chips with a real pin row on
// each side, and bigger annular vias — all with generous moats so the board
// reads as an object at a glance rather than dissolving into grain.
import { FieldCtx, clamp01, maxInto, subtractInto, rim, heroSize, motifCount } from '../fieldkit';
import { rect, circle, thickline, band, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

interface Chip {
  cx: number;
  cy: number;
  w: number;
  h: number;
  pins: number;
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(1337);
  const yLo = 11.4;
  const yHi = H - 11.4;

  // Chips at a fixed authored footprint; a wider board carries more of them.
  const chipW = heroSize(W, H, 30.6, 0.26, 0.3);
  const chipCount = motifCount(W, 68, 1);
  const chips: Chip[] = [];
  for (let k = 0; k < chipCount; k++) {
    const tall = k % 2 === 0;
    chips.push({
      cx: ((k + 0.5) / chipCount) * W,
      cy: tall ? 82 : 48,
      w: tall ? chipW : chipW * 1.33,
      h: tall ? 40 : 27,
      pins: tall ? 6 : 7,
    });
  }

  // --- orthogonal bus grid: a handful of full runs, horizontal + vertical ---
  const hBuses = [0.2, 0.4, 0.62, 0.83].map((f) => yLo + f * (yHi - yLo));
  const vBusCount = motifCount(W, 51, 2);
  const vBuses = Array.from({ length: vBusCount }, (_, k) => ((k + 0.35) / vBusCount) * W);

  const traceMask = ctx.mask((d: DrawCtx) => {
    for (const y of hBuses) thickline(d, [[0, y], [W, y]], 1.0, 255);
    for (const x of vBuses) thickline(d, [[x, yLo], [x, yHi]], 1.0, 255);
    // short orthogonal stubs connecting chips to the nearest bus
    for (const c of chips) {
      for (const side of [-1, 1] as const) {
        const x = c.cx + (side * c.w) / 2;
        const nearestBus = hBuses.reduce((a, b) => (Math.abs(b - c.cy) < Math.abs(a - c.cy) ? b : a));
        thickline(d, [[x, c.cy], [x + side * 6.1, c.cy], [x + side * 6.1, nearestBus]], 0.9, 255);
      }
    }
  });

  // --- vias on a coarse jittered grid, skipping chip footprints. Column
  // count follows the circumference so via spacing stays constant. ---
  const vias: Array<[number, number, number]> = [];
  const cols = motifCount(W, 10.2, 4);
  const rows = 9;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ((i + 0.5 + (rng() - 0.5) * 0.4) / cols) * W;
      const y = yLo + ((j + 0.5 + (rng() - 0.5) * 0.4) / rows) * (yHi - yLo);
      const insideChip = chips.some((c) => Math.abs(ctx.dx(c.cx, x)) < c.w * 0.68 && Math.abs(y - c.cy) < c.h * 0.68);
      if (insideChip || rng() > 0.38) continue;
      vias.push([x, y, 1.3 + rng() * 1.0]);
    }
  }
  const padMask = ctx.mask((d: DrawCtx) => {
    for (const [x, y, r] of vias) {
      circle(d, x, y, r, 255);
      circle(d, x, y, r * 0.4, 0);
    }
  });

  const chipMask = ctx.mask((d: DrawCtx) => {
    for (const c of chips) {
      rect(d, c.cx - c.w / 2, c.cy - c.h / 2, c.w, c.h, 255);
      const pinW = c.w * 0.16;
      const pinH = (c.h * 0.62) / c.pins;
      for (let p = 0; p < c.pins; p++) {
        const py = c.cy - c.h * 0.31 + (p + 0.5) * pinH;
        rect(d, c.cx - c.w / 2 - pinW * 0.3, py - pinH * 0.3, pinW, pinH * 0.6, 0);
        rect(d, c.cx + c.w / 2 - pinW * 0.7, py - pinH * 0.3, pinW, pinH * 0.6, 0);
      }
      // orientation notch
      circle(d, c.cx, c.cy - c.h * 0.36, Math.min(c.w, c.h) * 0.07, 0);
      // dark centre channel — a solid form with a clean cut, not clutter (rule 3)
      rect(d, c.cx - c.w * 0.28, c.cy - c.h * 0.06, c.w * 0.56, c.h * 0.12, 0);
    }
  });

  // dim board grid at a fixed pitch, so the substrate texture keeps its grain
  const gridCols = motifCount(W, 4.44, 8);
  const gridRows = motifCount(H, 5.46, 6);
  const grid = ctx.fn((x, y) => {
    if (y < yLo || y > yHi) return 0;
    const gx = Math.abs(((x / W) * gridCols) % 1 - 0.5);
    const gy = Math.abs(((y / H) * gridRows) % 1 - 0.5);
    return gx > 0.46 || gy > 0.46 ? 1 : 0;
  });

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, grid, 0.09);
  subtractInto(F, rim(ctx, traceMask, 1.0), 0.85);
  maxInto(F, (() => { const t = traceMask.slice(); for (let i = 0; i < t.length; i++) t[i] *= 0.68; return t; })());

  F = ctx.moat(F, padMask, 1.8, 0.9);
  F = ctx.moat(F, chipMask, 3.6, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 5.1, 1.1);
    band(d, H - 6.3, 1.1);
    band(d, H - 2.8, 2.8);
    // castellated edge fingers at a fixed pitch
    const n = motifCount(W, 5.1, 8);
    for (let k = 0; k < n; k++) {
      const u = W / n;
      const x = (k + 0.15) * u;
      rect(d, x, 7.1, u * 0.7, 2.8, 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const circuit: Preset = {
  id: 'circuit',
  name: 'Circuit',
  group: 'tech',
  description: 'Printed-circuit board: three DIP chips on a clean orthogonal bus grid.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.07, mode: 'hybrid', knee: 0.45, gamma: 0.7 },
  build,
};
