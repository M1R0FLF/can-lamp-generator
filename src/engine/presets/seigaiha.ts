// "Seigaiha" — Japanese wave scallops with koi.
//
// Seigaiha tessellates perfectly: overlapping concentric arcs on a lattice
// whose rows are offset by half a cell. Cell width is W/repeats (integer), so
// it wraps at any diameter. The waves are the dim field; the koi are the
// bright heroes with moats, and a moon disc anchors the top.
import { FieldCtx, clamp01, maxInto, subtractInto, rim, repeatsFor, heroSize, motifCount } from '../fieldkit';
import { circle, thickline, band, poly, taper, ell, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

/** Solid koi body with dark fin detail; angle in degrees. */
function koi(d: DrawCtx, cx: number, cy: number, L: number, ang: number) {
  const a = (ang * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const T = (u: number, v: number): [number, number] => [cx + u * ca - v * sa, cy + u * sa + v * ca];

  // body: teardrop
  const pts: Array<[number, number]> = [];
  const steps = 80;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = -L * 0.42 + L * 0.84 * t;
    const taperF = Math.sin(Math.PI * Math.pow(t, 0.85));
    const v = L * 0.22 * taperF;
    pts.push(T(u, v));
  }
  for (let s = steps; s >= 0; s--) {
    const t = s / steps;
    const u = -L * 0.42 + L * 0.84 * t;
    const taperF = Math.sin(Math.PI * Math.pow(t, 0.85));
    pts.push(T(u, -L * 0.22 * taperF));
  }
  poly(d, pts, 255);

  // forked tail
  poly(d, [T(-L * 0.38, 0), T(-L * 0.66, L * 0.26), T(-L * 0.5, 0), T(-L * 0.66, -L * 0.26)], 255);
  // pectoral fins
  taper(d, T(-L * 0.02, L * 0.14), T(L * 0.12, L * 0.34), L * 0.11, 0, 255);
  taper(d, T(-L * 0.02, -L * 0.14), T(L * 0.12, -L * 0.34), L * 0.11, 0, 255);
  // dark detail inside the solid body (rule 3)
  thickline(d, [T(-L * 0.3, 0), T(L * 0.34, 0)], L * 0.03, 0);
  for (const u of [-0.18, 0.0, 0.18]) {
    thickline(d, [T(L * u, L * 0.15), T(L * u, -L * 0.15)], L * 0.028, 0);
  }
  circle(d, ...T(L * 0.33, L * 0.07), L * 0.032, 0);
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(555);
  const yLo = 8.5;
  const yHi = H - 8.5;
  const waveTop = 102;

  // scallop cell held at ~18.6mm so the wave pattern keeps its grain
  const repeats = repeatsFor(W, 18.6);
  const cw = W / repeats;
  const scallopR = cw * 0.52;
  const rowH = scallopR * 0.62;

  // --- seigaiha wave field: concentric arcs, offset rows ---
  const waves = ctx.mask((d: DrawCtx) => {
    const rows = Math.ceil((waveTop - yLo) / rowH) + 2;
    for (let j = 0; j < rows; j++) {
      const cy = yLo + j * rowH;
      const offset = j % 2 ? cw / 2 : 0;
      for (let i = -1; i <= repeats; i++) {
        const cx = i * cw + offset + cw / 2;
        for (const rr of [1.0, 0.76, 0.52, 0.28]) {
          const pts: Array<[number, number]> = [];
          for (let s = 0; s <= 40; s++) {
            const th = Math.PI * (s / 40);
            pts.push([cx - scallopR * rr * Math.cos(th), cy + scallopR * rr * Math.sin(th)]);
          }
          thickline(d, pts, scallopR * 0.11, 255);
        }
      }
    }
  });

  let F = ctx.blank(0);
  // waves brighten toward the bottom so the top stays dark for the moon
  const waveGate = ctx.fn((_x, y) => {
    if (y < yLo || y > waveTop) return 0;
    return Math.min(1, Math.max(0.25, 1.15 - (y - yLo) / (waveTop - yLo)));
  });
  // waves stay well below hero brightness so the koi have room to read
  F = ctx.dimTexture(F, waves, 0.26, waveGate);

  // --- moon in the clear upper sky, with a dark separation ring ---
  const moonX = 0.68 * W;
  const moonY = H - 21;
  const moonR = heroSize(W, H, 14.2);
  const moon = ctx.mask((d: DrawCtx) => {
    circle(d, moonX, moonY, moonR, 255);
    // faint dark maria so the disc has internal structure
    circle(d, moonX - moonR * 0.3, moonY + moonR * 0.22, moonR * 0.2, 0);
    circle(d, moonX + moonR * 0.26, moonY - moonR * 0.16, moonR * 0.15, 0);
    circle(d, moonX + moonR * 0.05, moonY + moonR * 0.42, moonR * 0.11, 0);
  });
  F = ctx.moat(F, moon, 3.6, 1.0);

  // --- drifting clouds as very dim structure in the sky ---
  const cloudCount = motifCount(W, 29, 2);
  const clouds = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < cloudCount; k++) {
      const cx = ((k + 0.5) / cloudCount + (rng() - 0.5) * 0.5 / cloudCount) * W;
      const cy = waveTop + 5.7 + rng() * Math.max(4, yHi - waveTop - 8.5);
      const rx = 10.2 + rng() * 12.3;
      for (let b = 0; b < 4; b++) {
        ell(d, cx + (b - 1.5) * rx * 0.5, cy + (rng() - 0.5) * 1.7, rx * 0.55, 2.0, 255);
      }
    }
  });
  F = ctx.dimTexture(F, clouds, 0.13);

  // --- koi: the bright heroes at a fixed authored length; a wider can gets
  // more of them. Generous moat, because they sit directly in the wave
  // texture and without it there is no figure/ground (rule 4). ---
  const koiLen = heroSize(W, H, 41, 0.3, 0.3);
  const koiCount = motifCount(W, 68, 1);
  const koiMask = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < koiCount; k++) {
      const cx = ((k + 0.35) / koiCount) * W;
      const cy = 33 + ((k * 29) % 46);
      const len = koiLen * (k % 3 === 1 ? 0.8 : 1.0);
      const ang = k % 2 === 0 ? 14 : -158;
      koi(d, cx, cy, len, ang);
    }
  });
  F = ctx.moat(F, koiMask, 5.0, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.7, 1.1);
    band(d, H - 6.0, 1.1);
    band(d, H - 2.6, 2.6);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const seigaiha: Preset = {
  id: 'seigaiha',
  name: 'Waves',
  group: 'art',
  description: 'Japanese wave scallops under a full moon, with koi cutting across the current.',
  stipple: { pitchMm: 1.25, dMin: 0.26, dMax: 0.5, jitter: 0.1, thresh: 0.07, mode: 'hybrid', knee: 0.42, gamma: 0.7 },
  build,
};
