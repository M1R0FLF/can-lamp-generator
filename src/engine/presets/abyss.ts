// "Abyss" — bioluminescence in deep water. Mostly real black, which is what
// makes the few bright forms read (rule 5: real blacks make the image).
//
// Jellyfish bells are the hero closed forms: solid domes with dark radial
// cuts, each with a generous moat. Tentacles trail from them as tapered
// ribbons. Bubbles are bright annuli; plankton is the dim texture layer.
import { FieldCtx, clamp01, maxInto, specks, subtractInto, rim, fbm, harmonic, heroSize, motifCount } from '../fieldkit';
import { poly, circle, thickline, band, wedge, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

interface Jelly {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  tentacles: number;
  reach: number;
}

/** Dome: upper half-ellipse with a slightly scalloped fringe. */
function bell(d: DrawCtx, j: Jelly, seedRng: () => number) {
  const pts: Array<[number, number]> = [];
  const steps = 96;
  for (let s = 0; s <= steps; s++) {
    const th = Math.PI * (s / steps); // 0..pi, left to right over the top
    const scallop = 1 + 0.045 * Math.sin(th * 9);
    pts.push([j.cx - j.rx * Math.cos(th) * scallop, j.cy + j.ry * Math.sin(th) * scallop]);
  }
  // fringed lower edge
  const lobes = 7;
  for (let s = lobes; s >= 0; s--) {
    const t = s / lobes;
    const x = j.cx - j.rx + 2 * j.rx * t;
    const dip = j.cy - j.ry * (0.1 + 0.16 * Math.abs(Math.sin(t * Math.PI * lobes)));
    pts.push([x, dip]);
  }
  poly(d, pts, 255);

  // dark radial ribs inside the solid dome
  for (let k = 0; k < 9; k++) {
    const th = Math.PI * ((k + 0.5) / 9);
    thickline(
      d,
      [
        [j.cx - j.rx * 0.1 * Math.cos(th), j.cy + j.ry * 0.08],
        [j.cx - j.rx * 0.93 * Math.cos(th), j.cy + j.ry * 0.9 * Math.sin(th)],
      ],
      Math.max(0.5, j.rx * 0.035),
      0
    );
  }
  // dark concentric arcs
  for (const rr of [0.42, 0.7]) {
    const arcPts: Array<[number, number]> = [];
    for (let s = 0; s <= 48; s++) {
      const th = Math.PI * (s / 48);
      arcPts.push([j.cx - j.rx * rr * Math.cos(th), j.cy + j.ry * rr * Math.sin(th)]);
    }
    thickline(d, arcPts, Math.max(0.45, j.rx * 0.03), 0);
  }
}

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(77);
  const yLo = 7;
  const yHi = H - 7;

  // One jellyfish per ~68mm of circumference, each at its authored size
  // (clamped so it can't wrap over itself on a very small can). A wider can
  // gains jellyfish; it does not get one giant stretched jellyfish.
  const bellR = heroSize(W, H, 17.4, 0.3, 0.2);
  const count = motifCount(W, 68, 1);
  const jellies: Jelly[] = [];
  for (let k = 0; k < count; k++) {
    // vary size and depth per instance so a repeated motif still reads as a shoal
    const wobble = 0.62 + 0.38 * ((k * 0.37) % 1);
    const rx = bellR * wobble;
    jellies.push({
      cx: ((k + 0.5) / count) * W,
      cy: Math.min(yHi - 22, 62 + ((k * 43) % 46)),
      rx,
      ry: rx * 1.35,
      tentacles: 7 + (k % 3),
      reach: rx * 3.1,
    });
  }

  // --- dim water: slow vertical shafts + a faint plankton haze ---
  const shaftFreq = harmonic(W, 41);
  const shafts = ctx.fn((x, y) => {
    if (y < yLo || y > yHi) return 0;
    const s = 0.5 + 0.5 * Math.sin((2 * Math.PI * shaftFreq * x) / W + 0.7);
    const fall = Math.min(1, Math.max(0, (y - 0.3 * H) / (0.6 * H)));
    return Math.pow(s, 3) * fall;
  });
  const cloud = fbm(ctx, 7, 5, 3, 404);

  let F = ctx.blank(0);
  F = ctx.dimTexture(F, shafts, 0.11);
  F = ctx.dimTexture(F, cloud, 0.07);

  // --- plankton specks, brighter deep down ---
  // counts scale with area so density stays constant across can sizes
  const areaScale = (W * H) / (204.2 * 142);
  maxInto(
    F,
    (() => {
      const s = specks(ctx, {
        count: Math.max(20, Math.round(190 * areaScale)),
        seed: 909,
        sizeLo: 0.45,
        sizeHi: 0.8,
        yLo,
        yHi,
        accept: (_x, y) => 0.25 + 0.75 * (1 - (y - yLo) / (yHi - yLo)),
      });
      for (let i = 0; i < s.length; i++) s[i] *= 0.5;
      return s;
    })()
  );

  // --- bubbles: bright rings ---
  const bubbleCount = Math.max(6, Math.round(34 * areaScale));
  const bubbles = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < bubbleCount; k++) {
      const x = rng() * W;
      const y = yLo + rng() * (yHi - yLo);
      const r = 0.9 + rng() * 3.4;
      circle(d, x, y, r, 255);
      circle(d, x, y, r * 0.55, 0);
    }
  });
  F = ctx.moat(F, bubbles, 1.1, 0.8);

  // --- tentacles, drawn before the bells so the bells overlap them ---
  const tentacles = ctx.mask((d: DrawCtx) => {
    for (const j of jellies) {
      for (let t = 0; t < j.tentacles; t++) {
        const f = (t + 0.5) / j.tentacles;
        const x0 = j.cx - j.rx * 0.85 + 2 * j.rx * 0.85 * f;
        const amp = j.rx * 0.24 * (0.5 + rng());
        const freq = 2.0 + rng() * 2.2;
        const len = j.reach * (0.55 + 0.45 * rng());
        const pts: Array<[number, number]> = [];
        const steps = 34;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const y = j.cy - j.ry * 0.1 - len * u;
          pts.push([x0 + amp * Math.sin(u * freq * Math.PI + f * 5), y]);
        }
        thickline(d, pts, 0.85, 255);
      }
    }
  });
  subtractInto(F, rim(ctx, tentacles, 1.0), 0.9);
  maxInto(F, (() => { const t = tentacles.slice(); for (let i = 0; i < t.length; i++) t[i] *= 0.72; return t; })());

  // --- the heroes ---
  const bells = ctx.mask((d: DrawCtx) => {
    for (const j of jellies) bell(d, j, rng);
  });
  F = ctx.moat(F, bells, 3.4, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.4, 0.9);
    band(d, H - 5.4, 0.9);
    band(d, H - 2.3, 2.3);
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const abyss: Preset = {
  id: 'abyss',
  name: 'Abyss',
  group: 'nature',
  description: 'Bioluminescent jellyfish drifting in deep water: bright bells, trailing tentacles, plankton.',
  stipple: { pitchMm: 1.3, dMin: 0.26, dMax: 0.52, jitter: 0.13, thresh: 0.06, mode: 'hybrid', knee: 0.38, gamma: 0.6 },
  build,
};
