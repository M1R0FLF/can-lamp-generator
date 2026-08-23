// "Nordic" — Fair Isle knitting registers.
//
// Deliberately a "boring" repeating pattern (rule 8): no scene, no hero shape,
// just stacked horizontal bands of chunky geometric motifs. What carries it is
// register CONTRAST — a wide solid rose band, then a thin chevron rule, then a
// diamond lattice — not any one clever form. Girih proved this category reads.
//
// Seamless by construction: every register's motif count comes from
// repeatsFor(), so each band closes on itself at any diameter (rule 1). The
// stack is authored in mm and repeats up the wall, so a taller can gets MORE
// registers rather than stretched ones.
import { FieldCtx, clamp01, maxInto, repeatsFor } from '../fieldkit';
import { star, ngon, band, thickline, circle, DrawCtx } from '../draw';
import { Preset } from './types';

type RegisterKind = 'rose' | 'chevron' | 'diamond' | 'pip';

const STACK: Array<{ kind: RegisterKind; h: number }> = [
  { kind: 'rose', h: 24 },
  { kind: 'chevron', h: 6.0 },
  { kind: 'diamond', h: 13 },
  { kind: 'chevron', h: 6.0 },
  { kind: 'pip', h: 7.5 },
  { kind: 'chevron', h: 6.0 },
];

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const yLo = 9.0;
  const yHi = H - 9.0;

  const rows: Array<{ kind: RegisterKind; y0: number; y1: number }> = [];
  let cursor = yLo;
  for (let i = 0; cursor < yHi - 3; i++) {
    const r = STACK[i % STACK.length];
    const y1 = cursor + r.h;
    // Don't leave a squashed partial band at the top; stop instead.
    if (y1 > yHi) break;
    rows.push({ kind: r.kind, y0: cursor, y1 });
    cursor = y1 + 1.5;
  }

  // Heroes: the big solid rose and diamond registers.
  const heroes = ctx.mask((d: DrawCtx) => {
    for (const r of rows) {
      const cy = (r.y0 + r.y1) / 2;
      const hh = (r.y1 - r.y0) / 2;
      if (r.kind === 'rose') {
        const n = repeatsFor(W, 25.5);
        const u = W / n;
        const R = Math.min(u * 0.45, hh * 0.98);
        for (let k = 0; k < n; k++) {
          const cx = (k + 0.5) * u;
          star(d, cx, cy, R, R * 0.45, 8, 22.5, 255);
          // dark inner detail so the solid form has structure (rule 3)
          star(d, cx, cy, R * 0.37, R * 0.16, 8, 22.5, 0);
          circle(d, cx, cy, R * 0.12, 255);
          // half-drop side lozenges tie the register together
          ngon(d, cx + u * 0.5, cy, Math.min(u * 0.13, hh * 0.34), 4, 90, 255);
        }
      } else if (r.kind === 'diamond') {
        const n = repeatsFor(W, 12.8);
        const u = W / n;
        const R = Math.min(u * 0.47, hh * 0.95);
        for (let k = 0; k < n; k++) {
          const cx = (k + 0.5) * u;
          ngon(d, cx, cy, R, 4, 90, 255);
          ngon(d, cx, cy, R * 0.44, 4, 90, 0);
        }
      }
    }
  });

  // Secondary: chevron rules and pip rows — brighter than texture, dimmer
  // than the heroes, so the stack has three tiers instead of two.
  const rules = ctx.mask((d: DrawCtx) => {
    for (const r of rows) {
      const cy = (r.y0 + r.y1) / 2;
      const hh = (r.y1 - r.y0) / 2;
      if (r.kind === 'chevron') {
        const n = repeatsFor(W, 6.4);
        const u = W / n;
        const pts: Array<[number, number]> = [];
        for (let k = 0; k <= n * 2; k++) {
          pts.push([(k * u) / 2, k % 2 === 0 ? cy - hh * 0.62 : cy + hh * 0.62]);
        }
        thickline(d, pts, Math.min(1.7, hh * 0.7), 255);
      } else if (r.kind === 'pip') {
        const n = repeatsFor(W, 8.2);
        const u = W / n;
        for (let k = 0; k < n; k++) {
          const cx = (k + 0.5) * u;
          ngon(d, cx, cy, Math.min(u * 0.3, hh * 0.85), 4, 90, 255);
          circle(d, cx + u * 0.5, cy, Math.min(u * 0.11, hh * 0.3), 255);
        }
      }
    }
  });

  // Dim ground texture (rule 7): a faint knit-stitch grid so the gaps between
  // registers aren't dead black, at roughly 1/7 hero brightness.
  const stitches = ctx.mask((d: DrawCtx) => {
    const n = repeatsFor(W, 2.15);
    const u = W / n;
    for (let k = 0; k < n; k++) thickline(d, [[k * u, yLo], [k * u, yHi]], 0.34, 255);
    const vr = Math.max(4, Math.round((yHi - yLo) / 2.15));
    for (let j = 0; j <= vr; j++) {
      const y = yLo + (j * (yHi - yLo)) / vr;
      thickline(d, [[0, y], [W, y]], 0.3, 255);
    }
  });

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, stitches, 0.14);
  F = ctx.moat(F, rules, 1.2, 0.6);
  F = ctx.moat(F, heroes, 2.2, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.6, 1.3);
    band(d, H - 5.9, 1.3);
    band(d, H - 2.6, 2.6);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const nordic: Preset = {
  id: 'nordic',
  name: 'Nordic',
  group: 'art',
  description: 'Fair Isle knitting registers: solid rose bands, chevron rules and diamond lattice.',
  stipple: { pitchMm: 1.2, dMin: 0.26, dMax: 0.5, jitter: 0.08, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.7 },
  build,
};
