// "Escarcha" — 360deg seamless frost/ice wrap, twin of Mango Salvaje.
// Port of reference/escarcha_generator.py. Bigger motifs, finer grid, dense
// crack network: busy but legible. Numbers are the reference's, verbatim.
import { FieldCtx, crackField, clamp01, maxInto, subtractInto, rim } from '../fieldkit';
import { band, poly, hexagon, hexring, DrawCtx } from '../draw';
import { starFlake, plate, dendrite, fern, icicle } from '../shapes/crystal';
import { mulberry32 } from '../rng';
import { Preset } from './types';

const REF_W = Math.PI * 65.0;
const SKYTOP_REF = 132.6;
const REF_H = 142.0;
const FLOOR = 10.4;

function build(ctx: FieldCtx): Float32Array {
  const { W, H, Wp, Hp } = ctx;
  const fx = (x: number) => (x / REF_W) * W;
  // generate.ts always builds at H >= REF_H; the extra headroom on a taller
  // can should read as more sky above the scene, not a stretched design — so
  // only the top-edge-tracking elements (ceiling cutoff, top border) shift.
  const topOffset = H - REF_H;
  const SKYTOP = SKYTOP_REF + topOffset;

  const HERO_X = fx(52.0);
  const HERO_Y = 78.0;
  const HERO_R = 51.0;

  // seed count follows area so the crack cells keep their size — a fixed 460
  // over a taller canvas would stretch every cell
  const areaScale = (W * H) / (REF_W * REF_H);
  const cracks = crackField(ctx, {
    seeds: Math.max(80, Math.round(460 * areaScale)),
    widthLo: 0.95,
    widthHi: 1.35,
    seed: 5,
    yLo: 6.0,
    yHi: H - 4.0,
    density: (x, y) =>
      Math.min(
        1,
        (0.34 +
          0.62 * Math.exp(-Math.pow((y - 14.0) / 62.0, 2)) +
          0.5 * Math.exp(-Math.pow(ctx.dx(fx(150.0), x) / fx(48.0), 2))) /
          1.4
      ),
  });

  // crack brightness follows a broad glow around the hero crystal
  const glow = ctx.fn((x, y) => {
    const dxv = ctx.dx(HERO_X, x) * 0.85;
    const dyv = (y - HERO_Y) * 0.85;
    return Math.exp(-Math.pow(Math.hypot(dxv, dyv) / 86.0, 2));
  });

  const F = new Float32Array(Wp * Hp);
  for (let i = 0; i < F.length; i++) {
    F[i] = cracks[i] * (0.125 + 0.16 * glow[i]);
    // faint frost haze only where the ice is thin (keeps real blacks elsewhere)
    F[i] = Math.max(F[i], 0.075 * glow[i]);
  }

  const crys = ctx.mask((d: DrawCtx) => {
    starFlake(d, HERO_X, HERO_Y, HERO_R, 90);
    plate(d, fx(156.0), 94.0, 33.0, 90);
    plate(d, fx(104.0), 46.0, 19.0, 60);
    starFlake(d, fx(196.0), 52.0, 22.0, 90);
    dendrite(d, fx(112.0), 112.0, 20.0, 90);
    for (const [cx, cy, rr, ro] of [
      [134.0, 124.0, 9.0, 90],
      [176.0, 28.0, 8.0, 60],
      [72.0, 24.0, 8.5, 60],
      [166.0, 64.0, 8.0, 90],
      [118.0, 22.0, 8.0, 90],
      [200.0, 96.0, 8.5, 60],
      [148.0, 52.0, 8.0, 90],
    ] as Array<[number, number, number, number]>) {
      hexagon(d, fx(cx), cy, rr, ro);
      hexring(d, fx(cx), cy, rr * 0.52, ro, 1.9, 0);
    }
  });

  const rf = mulberry32(9);
  const frost = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < 5; k++) {
      const fxx = (k + 0.5) * (W / 5) + (rf() - 0.5) * 14;
      fern(d, fxx, 12.6, 90 + (rf() - 0.5) * 44, 28 + rf() * 10, 3.6, 2, 255, rf);
    }
    for (let k = 0; k < 5; k++) {
      const fxx = k * (W / 5) + (rf() - 0.5) * 14;
      fern(d, fxx, 12.6, 90 + (rf() - 0.5) * 60, 14 + rf() * 7, 2.8, 1, 255, rf);
    }
  });

  const ic = mulberry32(4);
  const bord = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < 20; k++) {
      const x0 = k * (W / 20);
      poly(
        d,
        [
          [x0, 2.2],
          [x0 + W / 40, 7.4],
          [x0 + W / 20, 2.2],
          [x0 + W / 20, 4.6],
          [x0 + W / 40, 9.8],
          [x0, 4.6],
        ],
        255
      );
    }
    band(d, 9.9, 1.0);
    band(d, 133.4 + topOffset, 1.0);
    band(d, 141.0 + topOffset, H - (141.0 + topOffset));
    for (let k = 0; k < 28; k++) {
      const x0 = (k + 0.5) * (W / 28);
      icicle(d, x0, 133.6 + topOffset, 6.0 + ic() * 9.0, 3.4 + ic() * 1.8);
    }
  });

  // dark separation gaps -> crisp edges (rule 4: the trick that made the sun read)
  subtractInto(F, ctx.dilate(crys, 25 / ctx.PPM), 1.0);
  subtractInto(F, rim(ctx, frost, 15 / ctx.PPM), 0.92);
  for (let i = 0; i < F.length; i++) {
    F[i] = Math.max(F[i], 0.55 * frost[i]);
    F[i] = Math.max(F[i], crys[i]);
  }
  for (let row = 0; row < Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= FLOOR && y <= SKYTOP) continue;
    F.fill(0, row * Wp, row * Wp + Wp);
  }
  maxInto(F, bord);
  return clamp01(F);
}

export const escarcha: Preset = {
  id: 'escarcha',
  name: 'Escarcha',
  group: 'nature',
  description: 'Frost and ice: a hero snow star, hexagonal plates and a dense crack network.',
  stipple: { pitchMm: 1.15, dMin: 0.26, dMax: 0.52, jitter: 0.1, thresh: 0.05, mode: 'hybrid', knee: 0.42, gamma: 1.0 },
  build,
};
