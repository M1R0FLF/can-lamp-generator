// "Girih" — Islamic geometric star tessellation.
//
// Seamless by construction: the motif repeats an INTEGER number of times
// around the circumference, so the pattern closes on itself at any diameter
// (the cell width is W/repeats, never a fixed mm value — rule 1).
//
// Bright solid stars and hexagons are the closed forms; the strapwork between
// them is cut dark, which is what stops the tessellation reading as mush.
import { FieldCtx, clamp01, maxInto, subtractInto, rim, repeatsFor } from '../fieldkit';
import { star, ngon, poly, band, thickline, circle, DrawCtx } from '../draw';
import { Preset } from './types';

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  // Hold the cell size in mm and let the repeat COUNT grow with the
  // circumference — a tessellation should gain tiles on a wider can, not
  // inflate each one. Rounding to an integer keeps the wrap seamless.
  const repeats = repeatsFor(W, 29.2);
  const cw = W / repeats;
  const yLo = 9.2;
  const yHi = H - 9.2;
  const bandH = yHi - yLo;
  const rowCount = Math.max(3, Math.round(bandH / (cw * 0.72)));
  const rh = bandH / rowCount;

  const starR = Math.min(cw * 0.42, rh * 0.62);
  const smallR = starR * 0.4;

  // --- strapwork lattice: the dark interlace grid the stars sit in ---
  const strap = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j <= rowCount; j++) {
      const y = yLo + j * rh;
      thickline(d, [[0, y], [W, y]], 0.75, 255);
    }
    for (let j = 0; j < rowCount; j++) {
      const y0 = yLo + j * rh;
      const offset = j % 2 ? cw / 2 : 0;
      for (let i = 0; i <= repeats; i++) {
        const x = i * cw + offset;
        thickline(d, [[x, y0], [x, y0 + rh]], 0.75, 255);
        // diagonals forming the girih net
        thickline(d, [[x - cw / 2, y0], [x, y0 + rh / 2], [x - cw / 2, y0 + rh]], 0.7, 255);
        thickline(d, [[x + cw / 2, y0], [x, y0 + rh / 2], [x + cw / 2, y0 + rh]], 0.7, 255);
      }
    }
  });

  // --- hero stars on the offset lattice ---
  const stars = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j < rowCount; j++) {
      const cy = yLo + (j + 0.5) * rh;
      const offset = j % 2 ? cw / 2 : 0;
      for (let i = 0; i < repeats; i++) {
        const cx = (i + 0.5) * cw + offset;
        star(d, cx, cy, starR, starR * 0.46, 8, 22.5, 255);
        // dark inner detail so the solid star has structure
        star(d, cx, cy, starR * 0.34, starR * 0.16, 8, 22.5, 0);
        circle(d, cx, cy, starR * 0.1, 255);
      }
    }
  });

  // --- secondary rosettes at the lattice vertices ---
  const rosettes = ctx.mask((d: DrawCtx) => {
    for (let j = 0; j <= rowCount; j++) {
      const cy = yLo + j * rh;
      if (cy < yLo - 0.1 || cy > yHi + 0.1) continue;
      const offset = j % 2 ? 0 : cw / 2;
      for (let i = 0; i < repeats; i++) {
        const cx = (i + 0.5) * cw + offset;
        ngon(d, cx, cy, smallR, 8, 22.5, 255);
        ngon(d, cx, cy, smallR * 0.44, 8, 22.5, 0);
      }
    }
  });

  let F = ctx.blank(0);
  // strapwork as the dim connective texture (rule 7)
  F = ctx.dimTexture(F, strap, 0.16);
  F = ctx.moat(F, rosettes, 1.3, 0.66);
  F = ctx.moat(F, stars, 2.4, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  // --- borders: a running key band top and bottom ---
  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.7, 1.3);
    band(d, H - 6.0, 1.3);
    band(d, H - 2.6, 2.6);
    const n = repeats * 4;
    for (let k = 0; k < n; k++) {
      const x = k * (W / n);
      const u = W / n;
      poly(d, [[x + 0.15 * u, 6.0], [x + 0.85 * u, 6.0], [x + 0.5 * u, 8.8]], 255);
      poly(d, [[x + 0.15 * u, H - 8.0], [x + 0.85 * u, H - 8.0], [x + 0.5 * u, H - 10.8]], 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const girih: Preset = {
  id: 'girih',
  name: 'Star Lattice',
  group: 'art',
  description: 'Islamic eight-point star tessellation with dark strapwork — seamless by construction.',
  stipple: { pitchMm: 1.2, dMin: 0.26, dMax: 0.5, jitter: 0.08, thresh: 0.07, mode: 'hybrid', knee: 0.44, gamma: 0.7 },
  build,
};
