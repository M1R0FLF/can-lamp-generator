// "Orrery" — a ringed planet, its moons, and constellation figures.
//
// Almost entirely real black, which is exactly why the bright bodies read.
// The planet is the hero closed form; its ring is an ellipse annulus cut by
// the planet's own silhouette so it passes behind convincingly.
import { FieldCtx, clamp01, maxInto, specks, subtractInto, rim, harmonic, heroSize, motifCount } from '../fieldkit';
import { circle, ell, thickline, band, arc, DrawCtx } from '../draw';
import { mulberry32 } from '../rng';
import { Preset } from './types';

function build(ctx: FieldCtx): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(2718);
  const yLo = 7;
  const yHi = H - 7;
  const areaScale = (W * H) / (204.2 * 142);

  const planetX = 0.28 * W;
  const planetY = 78;
  const planetR = heroSize(W, H, 23.5, 0.28, 0.24);

  let F = ctx.blank(0);

  // --- milky way band + field stars. Integer harmonic so the band closes on
  // itself at the seam. ---
  const mwFreq = harmonic(W, 136);
  const mwCenter = (x: number) => 88 + 15.6 * Math.sin((2 * Math.PI * mwFreq * x) / W + 0.9);
  maxInto(
    F,
    (() => {
      const s = specks(ctx, {
        count: Math.max(40, Math.round(240 * areaScale)),
        seed: 5150,
        sizeLo: 0.4,
        sizeHi: 0.7,
        yLo,
        yHi,
        bandCenter: mwCenter,
        bandSigma: 10.7,
      });
      for (let i = 0; i < s.length; i++) s[i] *= 0.42;
      return s;
    })()
  );
  maxInto(
    F,
    specks(ctx, {
      count: Math.max(24, Math.round(120 * areaScale)),
      seed: 99,
      sizeLo: 0.5,
      sizeHi: 1.15,
      yLo,
      yHi,
    })
  );

  // --- constellation: bright nodes joined by thin lines ---
  const nodeCount = motifCount(W, 7.2, 5);
  const nodes: Array<[number, number]> = [];
  for (let k = 0; k < nodeCount; k++) {
    nodes.push([0.5 * W + rng() * 0.46 * W, yLo + 21 + rng() * Math.max(12, yHi - yLo - 34)]);
  }
  const constellation = ctx.mask((d: DrawCtx) => {
    for (let k = 0; k < nodes.length - 1; k++) {
      const a = nodes[k];
      const b = nodes[k + 1];
      if (Math.abs(ctx.dx(a[0], b[0])) > 0.2 * W) continue;
      thickline(d, [a, b], 0.6, 255);
    }
    for (const [x, y] of nodes) circle(d, x, y, 1.5 + rng() * 1.1, 255);
  });
  F = ctx.moat(F, constellation, 1.5, 0.95);

  // --- orbit arcs, dim ---
  const orbits = ctx.mask((d: DrawCtx) => {
    for (const rr of [1.9, 2.6, 3.4]) {
      arc(d, planetX, planetY, planetR * rr, 0, 360, 0.6, 255);
    }
  });
  F = ctx.dimTexture(F, orbits, 0.2);

  // --- the ring, then the planet on top of it ---
  const planetMask = ctx.mask((d: DrawCtx) => circle(d, planetX, planetY, planetR, 255));

  const ring = ctx.mask((d: DrawCtx) => {
    ell(d, planetX, planetY, planetR * 2.15, planetR * 0.52, 255);
    ell(d, planetX, planetY, planetR * 1.72, planetR * 0.4, 0);
    ell(d, planetX, planetY, planetR * 1.58, planetR * 0.36, 255);
    ell(d, planetX, planetY, planetR * 1.24, planetR * 0.27, 0);
  });
  // the front half of the ring stays; the planet body will cover the rest
  F = ctx.moat(F, ring, 1.8, 0.85);

  // planet: solid disc with dark banding, plus a crescent terminator
  const planet = ctx.mask((d: DrawCtx) => {
    circle(d, planetX, planetY, planetR, 255);
    for (let k = -3; k <= 3; k++) {
      const yy = planetY + k * planetR * 0.26;
      const halfW = Math.sqrt(Math.max(0, planetR * planetR - (yy - planetY) * (yy - planetY)));
      thickline(d, [[planetX - halfW, yy], [planetX + halfW, yy]], planetR * 0.055, 0);
    }
    // night side
    circle(d, planetX + planetR * 0.52, planetY + planetR * 0.1, planetR * 0.92, 0);
  });
  F = ctx.moat(F, planet, 3.2, 1.0);

  // --- moons, fixed mm radii ---
  const moons = ctx.mask((d: DrawCtx) => {
    const spots: Array<[number, number, number]> = [
      [0.44 * W, 111, 4.5],
      [0.13 * W, 40, 3.1],
      [0.4 * W, 34, 2.2],
    ];
    for (const [x, y, r] of spots) {
      circle(d, x, y, r, 255);
      circle(d, x + r * 0.42, y + r * 0.18, r * 0.8, 0);
    }
  });
  F = ctx.moat(F, moons, 2.0, 1.0);

  for (let row = 0; row < ctx.Hp; row++) {
    const y = ctx.yAt(row);
    if (y >= yLo && y <= yHi) continue;
    F.fill(0, row * ctx.Wp, row * ctx.Wp + ctx.Wp);
  }

  const borders = ctx.mask((d: DrawCtx) => {
    band(d, 3.1, 0.9);
    band(d, H - 4.8, 0.9);
    band(d, H - 2.1, 2.1);
    // tick marks like an instrument bezel, at a fixed pitch
    const n = motifCount(W, 2.84, 12);
    for (let k = 0; k < n; k++) {
      const x = (k + 0.5) * (W / n);
      const long = k % 6 === 0;
      thickline(d, [[x, 4.5], [x, 4.5 + (long ? 2.6 : 1.3)]], 0.5, 255);
    }
  });
  maxInto(F, borders);
  return clamp01(F);
}

export const orrery: Preset = {
  id: 'orrery',
  name: 'Orrery',
  group: 'cosmic',
  description: 'A ringed planet with moons, orbit arcs and constellation figures on a deep star field.',
  stipple: { pitchMm: 1.3, dMin: 0.26, dMax: 0.52, jitter: 0.12, thresh: 0.05, mode: 'hybrid', knee: 0.36, gamma: 0.6 },
  build,
};
