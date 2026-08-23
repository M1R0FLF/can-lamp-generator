// "Saguaro" — desert at sundown.
//
// Same inverted figure/ground as Alpenglow and Metropolis, which is the
// formula that reads best on a lamp: the SKY is the bright field and the
// cacti are the real blacks, so the silhouette is read as negative space.
//
// A saguaro is the ideal subject for rule 3 — a fat trunk with two or three
// thick raised arms is a big closed form with no filigree anywhere in it.
import { FieldCtx, clamp01, maxInto, specks, subtractInto, rim, heroSize, motifCount, harmonic } from '../fieldkit';
import { circle, band, rect, thickline, poly, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

interface Cactus {
  x: number;
  h: number;
  w: number;
  /** arm height up the trunk, side, and length — undefined = no arm */
  arms: Array<{ at: number; side: 1 | -1; len: number }>;
}

/** Trunk plus arms, each arm an elbow: out sideways then straight up. */
function cactus(d: DrawCtx, c: Cactus, groundY: number) {
  const cx = c.x;
  const r = c.w / 2;
  rect(d, cx - r, groundY, c.w, c.h, 255);
  circle(d, cx, groundY + c.h, r, 255);
  for (const a of c.arms) {
    const y0 = groundY + c.h * a.at;
    const elbowX = cx + a.side * (r + c.w * 0.62);
    const armW = c.w * 0.66;
    // horizontal run out from the trunk
    thickline(d, [[cx, y0], [elbowX, y0]], armW, 255);
    // vertical rise, capped round
    thickline(d, [[elbowX, y0], [elbowX, y0 + a.len]], armW, 255);
    circle(d, elbowX, y0 + a.len, armW / 2, 255);
  }
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(5150);
  const groundY = 15.5;
  const skyTop = H - 8.5;
  const sunX = 0.3 * W;
  const sunY = groundY + 26;
  const sunR = heroSize(W, H, 17.5);

  // --- sky: bright at the horizon and around the sun, falling off upward ---
  let F = ctx.fn((x, y) => {
    if (y < groundY || y > skyTop) return 0;
    const halo = Math.exp(-Math.pow(Math.hypot(ctx.dx(sunX, x), (y - sunY) * 1.15) / (sunR * 3.4), 2));
    const horizon = Math.exp(-Math.max(y - groundY, 0) / 34);
    return Math.min(1, 0.06 + 0.72 * horizon + 0.6 * halo);
  });

  // Banded sky: a few hard-edged strata, the classic poster-desert look. The
  // stratum count comes from harmonic() so it doesn't stretch with height.
  const strata = ctx.mask((d: DrawCtx) => {
    const n = harmonic(W, 74);
    for (let k = 0; k < 5; k++) {
      const y = sunY + 8 + k * 9.5;
      if (y > skyTop - 3) break;
      const amp = 1.4;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= 96; s++) {
        const x = (s / 96) * W;
        pts.push([x, y + amp * Math.sin((2 * Math.PI * n * x) / W + k)]);
      }
      thickline(d, pts, 1.5, 255);
    }
  });
  maxInto(F, (() => { const t = strata.slice(); for (let i = 0; i < t.length; i++) t[i] *= 0.5; return t; })());

  // --- the sun: a solid disc with dark ruled slots, deco-style ---
  const sun = ctx.mask((d: DrawCtx) => {
    circle(d, sunX, sunY, sunR, 255);
    for (let k = 0; k < 6; k++) {
      const y = sunY - sunR + (k + 0.7) * (sunR * 2) / 7;
      if (y > sunY + sunR * 0.15) continue;
      thickline(d, [[sunX - sunR, y], [sunX + sunR, y]], sunR * 0.11, 0);
    }
  });
  subtractInto(F, rim(ctx, sun, 3.0), 0.92);
  maxInto(F, sun);
  clamp01(F);

  // faint stars high up where the sky has gone dark
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(14, Math.round((60 * W) / 204.2)),
      seed: 515,
      sizeLo: 0.45,
      sizeHi: 0.75,
      yLo: Math.min(skyTop - 6, sunY + 42),
      yHi: skyTop - 3,
    })
  );

  // --- cacti at authored mm sizes: a wider can gets more, not bigger ---
  const n = motifCount(W, 34, 3);
  const plants: Cactus[] = [];
  for (let k = 0; k < n; k++) {
    const hgt = 40 + rng() * 34;
    const arms: Cactus['arms'] = [];
    if (rng() > 0.18) arms.push({ at: 0.42 + rng() * 0.1, side: 1, len: hgt * (0.2 + rng() * 0.16) });
    if (rng() > 0.42) arms.push({ at: 0.58 + rng() * 0.12, side: -1, len: hgt * (0.16 + rng() * 0.16) });
    plants.push({
      x: ((k + 0.5) / n) * W + (rng() - 0.5) * (W / n) * 0.3,
      h: hgt,
      w: 7.4 + rng() * 2.2,
      arms,
    });
  }

  const silhouette = ctx.mask((d: DrawCtx) => {
    for (const c of plants) cactus(d, c, groundY);
    // a few round barrel cacti and rocks along the ground line
    const m = motifCount(W, 15, 4);
    for (let k = 0; k < m; k++) {
      const x = ((k + 0.5) / m) * W;
      const rr = 2.6 + rng() * 2.6;
      circle(d, x, groundY + rr * 0.4, rr, 255);
    }
  });

  // cacti punch the sky out to black
  subtractInto(F, silhouette, 1.0);

  // ribbed flutes: thin BRIGHT lines inside the black trunks. Sub-legible
  // individually, they work only as texture within the big form (rule 3).
  const flutes = ctx.mask((d: DrawCtx) => {
    for (const c of plants) {
      const cols = Math.max(2, Math.round(c.w / 2.5));
      for (let i = 1; i < cols; i++) {
        const x = c.x - c.w / 2 + (i * c.w) / cols;
        thickline(d, [[x, groundY + 1.5], [x, groundY + c.h * 0.94]], 0.34, 255);
      }
    }
  });
  for (let i = 0; i < F.length; i++) {
    if (flutes[i] > 0 && silhouette[i] > 0) F[i] = Math.max(F[i], 0.34);
  }

  // --- ground: dark, with a dim pebble/scrub texture so it isn't dead ---
  const scrub = ctx.mask((d: DrawCtx) => {
    const m = motifCount(W, 3.1, 12);
    for (let k = 0; k < m; k++) {
      const x = (k + 0.5) * (W / m);
      const y = groundY - 1.2 - rng() * 4.2;
      poly(d, [[x - 1.1, y], [x + 1.1, y], [x, y + 1.6]], 255);
    }
  });
  F = ctx.dimTexture(F, scrub, 0.2);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= 8.0 && y <= skyTop) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 4.0, 1.2);
    band(d, H - 6.0, 1.2);
    band(d, H - 2.6, 2.6);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const saguaro: Preset = {
  id: 'saguaro',
  name: 'Desert',
  group: 'nature',
  description: 'Desert sundown: black saguaro silhouettes against a banded sky and a slotted sun.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.09, mode: 'hybrid', knee: 0.46, gamma: 0.66 },
  build,
};
