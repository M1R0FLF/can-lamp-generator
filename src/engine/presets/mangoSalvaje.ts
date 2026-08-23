// "Mango Salvaje" — 360deg seamless tropical day/night wrap.
// Port of reference/mango_salvaje_generator.py. One full revolution is one
// full day: dawn -> day -> dusk -> night -> dawn. Tone constants, layout
// numbers and thresholds are the reference's, verbatim (CLAUDE.md).
import { FieldCtx, maxInto, clamp01, specks } from '../fieldkit';
import { poly, band, DrawCtx } from '../draw';
import { frond, monstera, agave, mangoBranch, grass, blade, bird, greca } from '../shapes/botanical';
import { mulberry32 } from '../rng';
import { Preset } from './types';

const SUNX = 52.0;
const SUNY = 70.0;
const GROUND = 15.5;
const SKYTOP_REF = 132.8;
const REF_H = 142.0;

// Reference layout is authored against a 65mm x 142mm can (W = 204.2mm).
// Positions are stored as fractions of circumference so any diameter keeps
// the composition (CLAUDE.md rule 1) — see fx() below. generate.ts always
// builds this preset at H >= REF_H (a taller can gets more headroom, not a
// stretched design) and crops down afterward, so topOffset here is what
// makes the border/sky-ceiling elements track the real top edge instead of
// leaving a dead gap above them on a taller can.
const REF_W = Math.PI * 65.0;

function build(ctx: FieldCtx): Float32Array {
  const { W, H, Wp, Hp, PPM } = ctx;
  /** reference mm x -> this canvas's mm x, as a fraction of circumference */
  const fx = (x: number) => (x / REF_W) * W;
  const topOffset = H - REF_H;
  const SKYTOP = SKYTOP_REF + topOffset;

  const sunx = fx(SUNX);
  const F = ctx.blank(0.035);

  const dayCol = new Float64Array(Wp);
  for (let col = 0; col < Wp; col++) {
    dayCol[col] = Math.exp(-Math.pow(ctx.dx(sunx, ctx.xAt(col)) / fx(62.0), 2));
  }

  // The sky's decay length is stretched in proportion to a taller-than-
  // reference canvas. The reference constants (36 / 14 / 12) fall out of a
  // 142mm wall and decay within ~30mm of the horizon; on a 350mm can that
  // left the whole upper two thirds of the day side below threshold, i.e.
  // dead black. skyStretch is exactly 1 at the reference height, so the
  // ported behaviour there is untouched.
  const skyStretch = Math.max(1, H / REF_H);
  for (let row = 0; row < Hp; row++) {
    const y = ctx.yAt(row);
    const base = row * Wp;
    for (let col = 0; col < Wp; col++) {
      const day = dayCol[col];
      const v =
        (0.1 + 0.9 * day) *
        Math.exp(-Math.max(y - 36.0, 0) / ((14.0 + 12.0 * day) * skyStretch));
      if (v > F[base + col]) F[base + col] = v;
    }
  }

  for (const [hb, amp, sig, n1] of [
    [92, 0.24, 2.6, 2],
    [112, 0.18, 2.2, 3],
  ] as Array<[number, number, number, number]>) {
    for (let col = 0; col < Wp; col++) {
      const x = ctx.xAt(col);
      const day = dayCol[col];
      const off = 7.0 * Math.sin((2 * Math.PI * n1 * x) / W + hb);
      for (let row = 0; row < Hp; row++) {
        const y = ctx.yAt(row);
        F[row * Wp + col] += amp * day * Math.exp(-Math.pow((y - hb - off) / sig, 2));
      }
    }
  }

  const disc = (cx: number, cy: number, rx: number, ry: number, x: number, y: number) => {
    const u = ctx.dx(cx, x) / rx;
    const v = (y - cy) / ry;
    return { r: Math.sqrt(u * u + v * v), th: Math.atan2(v, u) };
  };

  const moonx = fx(165.0);
  const moon2x = fx(169.8);
  for (let row = 0; row < Hp; row++) {
    const y = ctx.yAt(row);
    const base = row * Wp;
    for (let col = 0; col < Wp; col++) {
      const x = ctx.xAt(col);
      const idx = base + col;

      const { r, th } = disc(sunx, SUNY, fx(31.0), 29.0, x, y);
      const fib = 0.5 + 0.5 * Math.cos(16 * th);
      let sun = r <= 1.0 && (fib < 0.82 || r < 0.3) ? 1.0 : 0.0;
      const rayw = Math.min(Math.max(1.0 - (r - 1.18) / 0.62, 0), 1);
      const raysd = r > 1.18 && r < 1.8;
      if (raysd && fib < 0.38) sun = Math.max(sun, 0.3 + 0.7 * rayw);
      const ramp = Math.min(Math.max((y - 44.0) / 18.0, 0), 1);
      let gap = raysd && fib >= 0.38 ? ramp : 0.0;
      if (r > 1.0 && r < 1.18) gap = Math.max(gap, 1.0);
      F[idx] = Math.max(F[idx], sun) * (1.0 - 0.97 * gap);

      const m1 = disc(moonx, 99.0, fx(14.5), 14.5, x, y).r;
      const m2 = disc(moon2x, 102.4, fx(12.7), 12.7, x, y).r;
      if (m1 <= 1.0 && m2 > 1.0) F[idx] = Math.max(F[idx], 0.95);
    }
  }

  const isNight = (sx: number) => Math.exp(-Math.pow(ctx.dx(sunx, sx) / fx(62.0), 2)) < 0.32;
  // star counts follow canvas area so density stays put; a taller can gets
  // proportionally more stars rather than the reference 150 spread thin
  const areaScale = (W * H) / (REF_W * REF_H);
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(30, Math.round(150 * areaScale)),
      seed: 7,
      sizeLo: 0.648,
      sizeHi: 0.648,
      yLo: GROUND + 6,
      yHi: SKYTOP - 6,
      bandCenter: (x) => 96.0 + 15.0 * Math.sin((2 * Math.PI * 1.5 * x) / W + 0.8),
      bandSigma: 7.0,
      accept: (x) => (isNight(x) ? 1 : 0),
    })
  );
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(20, Math.round(90 * areaScale)),
      seed: 1207,
      sizeLo: 0.742,
      sizeHi: 0.742,
      yLo: GROUND + 20,
      yHi: SKYTOP - 5,
      accept: (x) => (isNight(x) ? 1 : 0),
    })
  );
  clamp01(F);

  // --- decorative borders ---
  const border = ctx.mask((d: DrawCtx) => {
    greca(d, 2.0, 4.6, 16);
    for (let xk = 0; xk < 24; xk++) {
      const cx = (xk + 0.5) * (W / 24);
      poly(d, [[cx, 135.4 + topOffset], [cx + 2.5, 137.9 + topOffset], [cx, 140.4 + topOffset], [cx - 2.5, 137.9 + topOffset]], 255);
    }
    band(d, 7.8, 0.9);
    band(d, 133.6 + topOffset, 0.9);
    band(d, 141.1 + topOffset, H - (141.1 + topOffset));
    bird(d, fx(116.0), 86.0, 9.0);
    bird(d, fx(131.0), 99.0, 6.0);
    bird(d, fx(124.0), 114.0, 4.6);
    bird(d, fx(189.0), 108.0, 6.5);
  });

  for (let row = 0; row < Hp; row++) {
    const y = ctx.yAt(row);
    const base = row * Wp;
    const cut = y < 9.6 || y > SKYTOP;
    for (let col = 0; col < Wp; col++) {
      const idx = base + col;
      if (cut) F[idx] = 0;
      if (border[idx] > F[idx]) F[idx] = border[idx];
    }
  }

  // --- jungle silhouette ---
  const gr = mulberry32(11);
  const sil = ctx.mask((d: DrawCtx) => {
    poly(d, [[-W, 9.6], [2 * W, 9.6], [2 * W, GROUND], [-W, GROUND]], 255);
    frond(d, fx(1.0), 15.0, 40, 78, -48, 14, 14.0, 3.6);
    monstera(d, fx(17.0), 30.0, 16.0, -22);
    agave(d, fx(37.0), 14.5, 29, 10, 64, 4.8);
    mangoBranch(d, fx(68.0), 14.5, 1.3);
    monstera(d, fx(89.0), 28.0, 15.5, 16);
    frond(d, fx(105.0), 15.0, 48, 80, -46, 14, 16.0, 3.8);
    agave(d, fx(121.0), 14.5, 37, 10, 76, 5.0);
    mangoBranch(d, fx(134.0), 14.5, 1.2);
    blade(d, fx(146.0), 15.0, 42, 108, 6.5, 15.0, 7);
    monstera(d, fx(158.0), 32.0, 17.0, 12);
    blade(d, fx(170.0), 15.0, 39, 72, -6.0, 13.5, 6);
    agave(d, fx(191.0), 14.5, 43, 10, 82, 5.4);
    blade(d, fx(203.0), 15.0, 36, 100, 5.0, 13.0, 6);
    for (const gx of [27, 58, 84, 100, 180]) {
      grass(d, fx(gx + (gr() - 0.5) * 4), 14.5, 8 + gr() * 5, gr);
    }
  });

  const silD = ctx.dilate(sil, 3 / PPM);
  const silRim = ctx.dilate(silD, 15 / PPM);

  for (let row = 0; row < Hp; row++) {
    const y = ctx.yAt(row);
    const base = row * Wp;
    const rimGate = y > 9.2 && y < SKYTOP + 0.2 ? 1.0 : 0.0;
    for (let col = 0; col < Wp; col++) {
      const idx = base + col;
      const s = silD[idx];
      let rimV = Math.min(Math.max(silRim[idx] - s, 0), 1);
      rimV *= Math.min(Math.max((0.55 - dayCol[col]) / 0.3, 0), 1) * rimGate;
      F[idx] = Math.max(F[idx], 0.95 * rimV) * (1.0 - s);
    }
  }
  return clamp01(F);
}

export const mangoSalvaje: Preset = {
  id: 'mango-salvaje',
  name: 'Mango Salvaje',
  group: 'nature',
  description: 'Tropical day-to-night wrap: radiant sun, crescent moon, jungle silhouette.',
  stipple: { pitchMm: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15, thresh: 0.13, mode: 'am', gamma: 0.85 },
  build,
};
