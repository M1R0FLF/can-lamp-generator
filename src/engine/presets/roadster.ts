// "Roadster" — retro cars cruising a night road under stars and a big moon.
//
// Each car is built from three closed forms (body, cabin, wheels) so it stays
// legible as a solid silhouette rather than a wireframe outline — the same
// lesson as the reference generators' hero shapes.
import { FieldCtx, clamp01, maxInto, specks, subtractInto, rim, heroSize, motifCount } from '../fieldkit';
import { poly, circle, band, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

function car(d: DrawCtx, cx: number, groundY: number, scale: number, facing: 1 | -1) {
  const s = scale * facing;
  // Field's y-axis runs up from the bottom (see fieldkit.ts), but the shape
  // below is authored with v increasing downward (wheels at v=+0.6, roof at
  // v=-0.42) like a normal screen sketch — negate v to sit it right-side up.
  //
  // A retro hood/tailfin profile was tried here and didn't survive stipple
  // pitch — the fine silhouette detail that makes a profile read as "retro"
  // is well under rule 3's ~16mm legible-feature floor at this scale, so it
  // just added noisy bumps rather than character. This version bets on
  // proportion instead of profile: a plain low body, and a cabin that's
  // unmistakably narrower and half as tall, wide enough to hold a big dark
  // window band. That body/cabin/window relationship is what a car icon
  // reads by, even reduced to three closed shapes.
  const T = (u: number, v: number): [number, number] => [cx + u * s, groundY - v * scale];

  // body: one smooth low silhouette, bumper to bumper
  poly(
    d,
    [
      T(-1.0, 0.6), T(-0.96, 0.24), T(-0.7, 0.03), T(0.7, 0.03),
      T(0.96, 0.24), T(1.0, 0.6),
    ],
    255
  );
  // cabin: wide flat-topped roof, clearly narrower than the body
  poly(d, [T(-0.5, -0.01), T(-0.32, -0.42), T(0.28, -0.42), T(0.42, -0.01)], 255);
  // dark window band cut into the cabin (rule 3: structure inside the solid)
  poly(d, [T(-0.4, -0.06), T(-0.25, -0.34), T(0.2, -0.34), T(0.3, -0.08)], 0);
  // headlight (front) and taillight (rear)
  circle(d, ...T(-0.97, 0.32), scale * 0.07, 0);
  circle(d, ...T(0.97, 0.32), scale * 0.06, 0);
  // wheels
  circle(d, ...T(-0.56, 0.6), scale * 0.24, 255);
  circle(d, ...T(-0.56, 0.6), scale * 0.1, 0);
  circle(d, ...T(0.56, 0.6), scale * 0.24, 255);
  circle(d, ...T(0.56, 0.6), scale * 0.1, 0);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(6006);
  const skyLo = 48;
  const skyHi = H - 10;
  const roadY = 43;

  let F = ctx.blank(0.02);
  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y < 8.5 || y > skyHi) {
      F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
    }
  }

  maxInto(
    F,
    specks(ctx, {
      count: Math.max(30, Math.round((150 * W) / 204.2)),
      seed: 606,
      sizeLo: 0.5,
      sizeHi: 0.9,
      yLo: skyLo,
      yHi: skyHi - 3,
    })
  );

  const moonX = 0.74 * W;
  const moonY = 111;
  const moonR = heroSize(W, H, 14);
  const moon = ctx.mask((d: DrawCtx) => {
    circle(d, moonX, moonY, moonR, 255);
    circle(d, moonX + moonR * 0.35, moonY + moonR * 0.15, moonR * 0.85, 0);
  });
  subtractInto(F, rim(ctx, moon, 3.0), 0.9);
  maxInto(F, moon);
  clamp01(F);

  // road surface: a dim band with bright dashed centre line. Dash length and
  // gap are mm, so a wider can gets more dashes, not longer ones.
  const road = ctx.fn((_x, y) => (y >= 11 && y <= roadY ? 1 : 0));
  F = ctx.dimTexture(F, road, 0.1);
  const dashCount = motifCount(W, 8.5, 6);
  const dashes = ctx.mask((d: DrawCtx) => {
    const u = W / dashCount;
    for (let k = 0; k < dashCount; k++) {
      const x0 = (k + 0.2) * u;
      const len = Math.min(6.1, u * 0.6);
      poly(d, [[x0, roadY * 0.5 - 0.85], [x0 + len, roadY * 0.5 - 0.85], [x0 + len, roadY * 0.5 + 0.85], [x0, roadY * 0.5 + 0.85]], 255);
    }
  });
  maxInto(F, (() => { const t = dashes.slice(); for (let i = 0; i < t.length; i++) t[i] *= 0.7; return t; })());

  // Cars at a fixed authored size; a longer road fits more of them rather
  // than stretching each one.
  const carScale = heroSize(W, H, 27, 0.3, 0.22);
  const carCount = motifCount(W, 68, 1);
  const cars = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < carCount; k++) {
      const cx = ((k + 0.5) / carCount) * W;
      const facing: 1 | -1 = k % 2 === 0 ? 1 : -1;
      const scale = carScale * (k % 3 === 1 ? 1.14 : 1.0);
      car(d, cx, roadY * 0.62, scale, facing);
    }
  });
  F = ctx.moat(F, cars, 2.4, 1.0);

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 4.0, 1.1);
    band(d, H - 6.4, 1.1);
    band(d, H - 2.8, 2.8);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const roadster: Preset = {
  id: 'roadster',
  name: 'Night Drive',
  group: 'urban',
  description: 'Retro cars cruising a night road under a big moon and scattered stars.',
  stipple: { pitchMm: 1.3, dMin: 0.26, dMax: 0.5, jitter: 0.11, thresh: 0.07, mode: 'hybrid', knee: 0.42, gamma: 0.65 },
  build,
};
