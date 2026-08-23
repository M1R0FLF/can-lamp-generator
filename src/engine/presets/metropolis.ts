// "Metropolis" — city skyline at dusk.
//
// Figure/ground is inverted relative to the other presets: the buildings are
// the real blacks and the sky is bright, so the silhouette is read as negative
// space. Lit windows are deliberately sub-legible individually — they work as
// a texture inside the big black forms, not as forms themselves (rule 3).
import { FieldCtx, clamp01, maxInto, specks, subtractInto, rim, heroSize, motifCount } from '../fieldkit';
import { rect, circle, band, poly, thickline, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

interface Tower {
  x: number;
  w: number;
  top: number;
  cols: number;
  rows: number;
  spire?: number;
  setback?: boolean;
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(8080);
  const groundY = 11;
  const skyTop = H - 8.5;

  // --- dusk sky: brightest at the horizon, fading upward ---
  const F = ctx.fn((x, y) => {
    if (y < groundY || y > skyTop) return 0;
    // angular horizon glow — scales with the wrap
    const glow = 0.55 + 0.45 * Math.exp(-Math.pow(ctx.dx(0.4 * W, x) / (0.34 * W), 2));
    const vert = Math.exp(-Math.max(y - groundY, 0) / 48);
    return Math.min(1, 0.1 + 0.95 * glow * vert);
  });

  // stars, only high up where the sky has gone dark
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(18, Math.round((90 * W) / 204.2)),
      seed: 4242,
      sizeLo: 0.45,
      sizeHi: 0.8,
      yLo: Math.min(skyTop - 8, 85),
      yHi: skyTop - 3,
    })
  );

  // --- moon ---
  const moonX = 0.82 * W;
  const moonY = 114;
  const moonR = heroSize(W, H, 10.7);
  const moon = ctx.mask((d: DrawCtx) => {
    circle(d, moonX, moonY, moonR, 255);
    circle(d, moonX + moonR * 0.4, moonY + moonR * 0.15, moonR * 0.82, 0);
  });
  subtractInto(F, rim(ctx, moon, 2.6), 0.9);
  maxInto(F, moon);
  clamp01(F);

  // Towers at a fixed authored width in mm — a wider can gets MORE towers,
  // not wider ones. Count comes from the circumference, then a small uniform
  // normalise closes the row exactly so the skyline wraps seamlessly.
  const towers: Tower[] = [];
  const avgTowerMm = 12.0;
  const n = motifCount(W, avgTowerMm, 4);
  let cursor = 0;
  for (let k = 0; k < n; k++) {
    const w = 7.1 + rng() * 7.1;
    const gap = 0.8 + rng() * 1.6;
    const top = groundY + 23 + rng() * 71;
    towers.push({
      x: cursor,
      w,
      top,
      cols: Math.max(2, Math.round(w / 2.25)),
      rows: Math.max(3, Math.round((top - groundY) / 4.5)),
      spire: rng() > 0.72 ? 7 + rng() * 13 : undefined,
      setback: rng() > 0.6,
    });
    cursor += w + gap;
  }
  const scale = W / cursor;
  for (const t of towers) {
    t.x *= scale;
    t.w *= scale;
  }

  const buildings = ctx.mask((d: DrawCtx) => {
    for (const t of towers) {
      rect(d, t.x, groundY, t.w, t.top - groundY, 255);
      if (t.setback) {
        rect(d, t.x + t.w * 0.18, t.top, t.w * 0.64, 5.0, 255);
        rect(d, t.x + t.w * 0.34, t.top + 5.0, t.w * 0.32, 3.6, 255);
      }
      if (t.spire) {
        const cx = t.x + t.w / 2;
        const base = t.top + (t.setback ? 8.6 : 0);
        poly(d, [[cx - t.w * 0.06, base], [cx + t.w * 0.06, base], [cx, base + t.spire]], 255);
      }
    }
  });

  const windows = ctx.mask((d: DrawCtx) => {
    for (const t of towers) {
      const wpad = t.w * 0.14;
      const cw = (t.w - 2 * wpad) / t.cols;
      const ch = (t.top - groundY) / t.rows;
      for (let r = 0; r < t.rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          if (rng() > 0.55) continue;
          const wx = t.x + wpad + c * cw + cw * 0.18;
          const wy = groundY + r * ch + ch * 0.25;
          rect(d, wx, wy, cw * 0.62, ch * 0.46, 255);
        }
      }
    }
  });

  // buildings punch the sky out to black, then windows light up inside them
  subtractInto(F, buildings, 1.0);
  for (let i = 0; i < F.length; i++) {
    if (windows[i] > 0 && buildings[i] > 0) F[i] = Math.max(F[i], 0.95);
  }

  // --- ground haze band, and a dim street-level glow ---
  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= groundY && y <= skyTop) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 4.3, 1.1);
    band(d, H - 6.0, 1.1);
    band(d, H - 2.6, 2.6);
    // street lights at a fixed spacing along the base
    const lamps = motifCount(W, 4.4, 8);
    for (let k = 0; k < lamps; k++) {
      const x = (k + 0.5) * (W / lamps);
      circle(d, x, 7.4, 0.7, 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const metropolis: Preset = {
  id: 'metropolis',
  name: 'Metropolis',
  group: 'urban',
  description: 'Dusk skyline: black towers against a glowing sky, windows lit from within.',
  stipple: { pitchMm: 1.2, dMin: 0.24, dMax: 0.48, jitter: 0.09, thresh: 0.1, mode: 'hybrid', knee: 0.46, gamma: 0.65 },
  build,
};
