// Stamp library: nature / celestial / tech motifs for the "make your own" composer.
//
// Every motif is authored against the CLAUDE.md legibility rules, because these
// get perforated at ~1.2-1.45 mm hole pitch:
//
//   * rule 3 — big closed forms read, filigree does not. Silhouettes are chunky
//     and solid; nothing relies on a hairline to be recognisable. Where the real
//     subject is filigree (fern frond) it is drawn as a solid blade with the
//     pinnae *cut out* instead of built up.
//   * rule 4 — a solid form with dark cuts inside it reads far better than an
//     outline, so interior detail is carved at fill 0 on top of a 255 fill,
//     exactly like `starFlake` in crystal.ts.
//   * every dimension is a multiple of `size` so a motif looks the same at
//     10 mm and at 20 mm; interior cut widths go through `cw()`, which floors
//     them at 0.55 mm absolute so a web never disappears.
//
// Coordinates inside a motif are a local frame: +u right, +v up, origin at the
// motif centre. `xf()` maps that frame to mask mm and folds in the rotation, so
// the shape bodies never touch trigonometry. Seamless wrap comes free from the
// draw.ts primitives.
import { DrawCtx, poly, thickline, taper2, circle } from '../draw';

export type ShapeCategory = 'basic' | 'geometric' | 'nature' | 'celestial' | 'tech' | 'decor';

export interface ShapeDef {
  id: string;                 // unique kebab-case
  name: string;               // short human label, max ~14 chars
  category: ShapeCategory;
  glyph: string;              // ONE unicode symbol/emoji for a 38px palette button
  defaultSizeMm: number;      // sensible default "radius-ish" size, typically 10-18
  /** Draw centred at (cx,cy). `size` is the nominal radius/half-extent in mm. rotation in DEGREES. */
  draw(d: DrawCtx, cx: number, cy: number, size: number, rotation: number): void;
  noRotate?: boolean;         // set true for rotationally symmetric shapes
  fullWidth?: boolean;        // set true if the shape spans the whole circumference
}

// ---------------------------------------------------------------------------
// local-frame helpers
// ---------------------------------------------------------------------------

const D2R = Math.PI / 180;

type Pt = [number, number];
/** Local (u right, v up) -> mask mm, with the motif's rotation applied. */
type Xf = (u: number, v: number) => Pt;

function xf(cx: number, cy: number, rotation: number): Xf {
  const a = rotation * D2R;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
}

/** Minimum-safe interior cut width: scales with the motif but never tears a web. */
function cw(size: number, k = 0.055): number {
  return Math.max(0.55, size * k);
}

function pl(d: DrawCtx, T: Xf, pts: Pt[], fill = 255) {
  poly(d, pts.map(([u, v]) => T(u, v)), fill);
}

function ln(d: DrawCtx, T: Xf, pts: Pt[], w: number, fill = 255) {
  thickline(d, pts.map(([u, v]) => T(u, v)), w, fill);
}

function tp(d: DrawCtx, T: Xf, base: Pt, tip: Pt, w0: number, w1: number, fill = 255) {
  taper2(d, T(base[0], base[1]), T(tip[0], tip[1]), w0, w1, fill);
}

function disc(d: DrawCtx, T: Xf, u: number, v: number, r: number, fill = 255) {
  const [x, y] = T(u, v);
  circle(d, x, y, Math.max(0.05, r), fill);
}

/** Ellipse as a polygon, so a tilt inside the local frame survives the transform. */
function oval(
  d: DrawCtx,
  T: Xf,
  u: number,
  v: number,
  ru: number,
  rv: number,
  tilt = 0,
  fill = 255,
  steps = 64
) {
  const ta = tilt * D2R;
  const ct = Math.cos(ta);
  const st = Math.sin(ta);
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    const a = ru * Math.cos(th);
    const b = rv * Math.sin(th);
    pts.push([u + a * ct - b * st, v + a * st + b * ct]);
  }
  pl(d, T, pts, fill);
}

/** Stroked ellipse outline. */
function ovalRing(
  d: DrawCtx,
  T: Xf,
  u: number,
  v: number,
  ru: number,
  rv: number,
  tilt: number,
  w: number,
  fill = 255,
  steps = 72
) {
  const ta = tilt * D2R;
  const ct = Math.cos(ta);
  const st = Math.sin(ta);
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    const a = ru * Math.cos(th);
    const b = rv * Math.sin(th);
    pts.push([u + a * ct - b * st, v + a * st + b * ct]);
  }
  ln(d, T, pts, w, fill);
}

function boxL(d: DrawCtx, T: Xf, u: number, v: number, hw: number, hh: number, fill = 255) {
  pl(d, T, [[u - hw, v - hh], [u + hw, v - hh], [u + hw, v + hh], [u - hw, v + hh]], fill);
}

/** Stroked rectangle — the inset frame cut used by the tech motifs. */
function frameL(
  d: DrawCtx,
  T: Xf,
  u: number,
  v: number,
  hw: number,
  hh: number,
  w: number,
  fill = 255
) {
  ln(
    d,
    T,
    [
      [u - hw, v - hh],
      [u + hw, v - hh],
      [u + hw, v + hh],
      [u - hw, v + hh],
      [u - hw, v - hh],
    ],
    w,
    fill
  );
}

function ringL(d: DrawCtx, T: Xf, u: number, v: number, r: number, w: number, fill = 255) {
  ovalRing(d, T, u, v, r, r, 0, w, fill);
}

function arcL(
  d: DrawCtx,
  T: Xf,
  u: number,
  v: number,
  r: number,
  a0: number,
  a1: number,
  w: number,
  fill = 255
) {
  const steps = Math.max(10, Math.ceil(Math.abs(a1 - a0) / 4));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + ((a1 - a0) * i) / steps) * D2R;
    pts.push([u + r * Math.cos(a), v + r * Math.sin(a)]);
  }
  ln(d, T, pts, w, fill);
}

/** Radial trapezoid — gear tooth / sun ray. Half-angles in degrees. */
function polarTrap(
  d: DrawCtx,
  T: Xf,
  rIn: number,
  rOut: number,
  aMid: number,
  hIn: number,
  hOut: number,
  fill = 255
) {
  const p = (r: number, a: number): Pt => [r * Math.cos(a * D2R), r * Math.sin(a * D2R)];
  pl(d, T, [p(rIn, aMid - hIn), p(rOut, aMid - hOut), p(rOut, aMid + hOut), p(rIn, aMid + hIn)], fill);
}

/** Lens/blade silhouette: half-width as a function of position along the axis. */
function lens(vLo: number, vHi: number, hwFn: (t: number) => number, steps = 44): Pt[] {
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = vLo + (vHi - vLo) * t;
    const hw = hwFn(t);
    right.push([hw, v]);
    left.push([-hw, v]);
  }
  return [...right, ...left.reverse()];
}

// ---------------------------------------------------------------------------
// nature
// ---------------------------------------------------------------------------

function drawLeaf(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const vLo = -s * 0.66;
  const vHi = s;
  const hwFn = (t: number) => s * 0.44 * Math.pow(Math.sin(Math.PI * t), 0.6);
  // stem first, blade over it
  tp(d, T, [0, -s], [0, -s * 0.5], s * 0.13, s * 0.11);
  pl(d, T, lens(vLo, vHi, hwFn));
  // interior: midrib plus paired side veins, all dark cuts
  const mid = cw(s, 0.062);
  ln(d, T, [[0, -s * 0.62], [0, s * 0.9]], mid, 0);
  const fine = cw(s, 0.045);
  for (let i = 0; i < 5; i++) {
    const t = 0.2 + (0.6 * i) / 4;
    const v = vLo + (vHi - vLo) * t;
    const hw = hwFn(t);
    for (const sg of [1, -1]) {
      ln(d, T, [[sg * hw * 0.08, v], [sg * hw * 0.74, v + (vHi - vLo) * 0.11]], fine, 0);
    }
  }
}

function drawMonstera(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  tp(d, T, [0, -s], [0, -s * 0.4], s * 0.13, s * 0.1);
  const pts: Pt[] = [];
  for (let i = 0; i < 180; i++) {
    const th = (2 * Math.PI * i) / 180;
    const r = s * (0.86 + 0.2 * Math.cos(th) - 0.1 * Math.cos(2 * th));
    pts.push([r * Math.sin(th) * 0.9, r * Math.cos(th)]);
  }
  pl(d, T, pts);
  // the characteristic edge fenestrations, cut in from both margins
  for (const sg of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      const v = -s * 0.6 + k * s * 0.4;
      const w = s * 0.14;
      pl(
        d,
        T,
        [
          [sg * s * 1.3, v - w],
          [sg * s * 0.12, v - w * 0.34],
          [sg * s * 0.12, v + w * 0.34],
          [sg * s * 1.3, v + w],
        ],
        0
      );
    }
  }
  ln(d, T, [[0, -s * 0.5], [0, s * 0.78]], cw(s, 0.055), 0);
}

function drawFern(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const vLo = -s * 0.78;
  const vHi = s;
  const hwFn = (t: number) => s * 0.36 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.02, 1)), 0.62);
  tp(d, T, [0, -s], [0, -s * 0.6], s * 0.12, s * 0.1);
  pl(d, T, lens(vLo, vHi, hwFn));
  // pinnae are CUT, not built: solid blade minus angled slits (rule 3)
  const slit = cw(s, 0.05);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const t = 0.1 + (0.82 * k) / (n - 1);
    const v = vLo + (vHi - vLo) * t;
    const hw = hwFn(t);
    for (const sg of [1, -1]) {
      ln(
        d,
        T,
        [
          [sg * s * 0.035, v],
          [sg * (hw + s * 0.1), v + (vHi - vLo) * 0.085],
        ],
        slit,
        0
      );
    }
  }
  ln(d, T, [[0, -s * 0.7], [0, s * 0.9]], cw(s, 0.05), 0);
}

function drawFlower(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = 90 + (360 / n) * k;
    const ar = a * D2R;
    oval(d, T, s * 0.55 * Math.cos(ar), s * 0.55 * Math.sin(ar), s * 0.44, s * 0.27, a);
  }
  disc(d, T, 0, 0, s * 0.32);
  // dark moat between disc and petals, then one vein per petal
  ringL(d, T, 0, 0, s * 0.33, cw(s, 0.06), 0);
  const vein = cw(s, 0.05);
  for (let k = 0; k < n; k++) {
    const ar = (90 + (360 / n) * k) * D2R;
    ln(
      d,
      T,
      [
        [s * 0.42 * Math.cos(ar), s * 0.42 * Math.sin(ar)],
        [s * 0.9 * Math.cos(ar), s * 0.9 * Math.sin(ar)],
      ],
      vein,
      0
    );
  }
  disc(d, T, 0, 0, s * 0.11, 0);
}

function drawTulip(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  // stem and leaves first
  tp(d, T, [0, -s], [0, s * 0.12], s * 0.13, s * 0.11);
  for (const sg of [1, -1]) {
    tp(d, T, [0, -s * 0.5], [sg * s * 0.62, -s * 0.98], s * 0.2, s * 0.05);
  }
  const cup: Pt[] = [
    [-0.44, 0.06],
    [-0.52, 0.5],
    [-0.4, 0.94],
    [-0.16, 0.58],
    [0, 1.0],
    [0.16, 0.58],
    [0.4, 0.94],
    [0.52, 0.5],
    [0.44, 0.06],
    [0, -0.12],
  ];
  pl(d, T, cup.map(([u, v]) => [u * s, v * s] as Pt));
  const gap = cw(s, 0.055);
  for (const sg of [1, -1]) {
    ln(d, T, [[sg * s * 0.19, s * 0.02], [sg * s * 0.22, s * 0.6]], gap, 0);
  }
}

function drawTree(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const cvy = s * 0.3;
  const R = s * 0.7;
  boxL(d, T, 0, -s * 0.36, s * 0.14, s * 0.64);
  for (const sg of [1, -1]) {
    tp(d, T, [0, -s * 0.05], [sg * s * 0.34, s * 0.3], s * 0.14, s * 0.07);
  }
  const pts: Pt[] = [];
  for (let i = 0; i < 160; i++) {
    const th = (2 * Math.PI * i) / 160;
    const r = R * (1 + 0.1 * Math.cos(3 * th) + 0.07 * Math.cos(5 * th + 1.1));
    pts.push([r * Math.cos(th), cvy + r * Math.sin(th)]);
  }
  pl(d, T, pts);
  // foliage clumps read as dark gaps inside the solid canopy
  const gap = cw(s, 0.055);
  for (let k = 0; k < 6; k++) {
    const a = (28 + 60 * k) * D2R;
    ln(
      d,
      T,
      [
        [R * 0.22 * Math.cos(a), cvy + R * 0.22 * Math.sin(a)],
        [R * 0.86 * Math.cos(a), cvy + R * 0.86 * Math.sin(a)],
      ],
      gap,
      0
    );
  }
  ringL(d, T, 0, cvy, R * 0.44, gap, 0);
  ln(d, T, [[0, -s * 0.9], [0, s * 0.1]], gap, 0);
}

function drawPine(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  boxL(d, T, 0, -s * 0.74, s * 0.13, s * 0.26);
  const tiers: Array<[number, number, number]> = [
    [-s * 0.58, s * 0.64, s * 0.76],
    [-s * 0.08, s * 0.5, s * 0.7],
    [s * 0.4, s * 0.34, s * 0.6],
  ];
  for (const [base, hw, ap] of tiers) {
    pl(d, T, [[-hw, base], [hw, base], [0, base + ap]]);
  }
  const gap = cw(s, 0.055);
  for (const [base, hw] of tiers) {
    ln(d, T, [[-hw * 0.92, base + s * 0.02], [0, base + s * 0.16], [hw * 0.92, base + s * 0.02]], gap, 0);
  }
}

function drawMushroom(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  // stalk first so the cap overlaps it
  tp(d, T, [0, -s * 0.92], [0, s * 0.2], s * 0.44, s * 0.34);
  const capV = s * 0.06;
  const pts: Pt[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const th = Math.PI * (i / steps);
    pts.push([s * 0.86 * Math.cos(th), capV + s * 0.62 * Math.sin(th)]);
  }
  pts.push([-s * 0.86, capV - s * 0.1]);
  pts.push([s * 0.86, capV - s * 0.1]);
  pl(d, T, pts);
  const gap = cw(s, 0.06);
  // cap/stalk separation is the single biggest legibility lever here
  ln(d, T, [[-s * 0.8, capV], [s * 0.8, capV]], gap, 0);
  for (const [u, v, r] of [
    [-s * 0.38, capV + s * 0.3, s * 0.14],
    [s * 0.06, capV + s * 0.44, s * 0.12],
    [s * 0.46, capV + s * 0.24, s * 0.13],
  ] as Array<[number, number, number]>) {
    disc(d, T, u, v, r, 0);
  }
  ln(d, T, [[0, -s * 0.82], [0, capV - s * 0.12]], gap, 0);
}

function drawButterfly(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  for (const sg of [1, -1]) {
    oval(d, T, sg * s * 0.5, s * 0.34, s * 0.56, s * 0.4, sg * 32);
    oval(d, T, sg * s * 0.42, -s * 0.42, s * 0.42, s * 0.33, -sg * 26);
  }
  oval(d, T, 0, 0, s * 0.11, s * 0.66, 0);
  disc(d, T, 0, s * 0.72, s * 0.13);
  for (const sg of [1, -1]) {
    ln(d, T, [[0, s * 0.74], [sg * s * 0.3, s * 1.0]], Math.max(0.6, s * 0.09));
  }
  const gap = cw(s, 0.05);
  for (const sg of [1, -1]) {
    // fore/hind wing split, then two veins fanning out of the body
    ln(d, T, [[sg * s * 0.16, s * 0.02], [sg * s * 0.88, -s * 0.14]], gap, 0);
    for (const t of [0.3, 0.62]) {
      const a = (18 + 46 * t) * D2R;
      ln(
        d,
        T,
        [
          [sg * s * 0.16, s * 0.12],
          [sg * s * 0.92 * Math.cos(a), s * 0.12 + s * 0.82 * Math.sin(a)],
        ],
        gap,
        0
      );
    }
    disc(d, T, sg * s * 0.62, s * 0.44, s * 0.14, 0);
    disc(d, T, sg * s * 0.5, -s * 0.46, s * 0.11, 0);
  }
}

function drawBird(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  oval(d, T, -s * 0.05, -s * 0.02, s * 0.56, s * 0.28, -6);
  disc(d, T, s * 0.5, s * 0.16, s * 0.21);
  tp(d, T, [s * 0.6, s * 0.14], [s * 1.0, s * 0.08], s * 0.17, s * 0.03);
  pl(d, T, [
    [-s * 0.42, s * 0.06],
    [-s * 1.0, s * 0.26],
    [-s * 0.9, -s * 0.08],
    [-s * 0.4, -s * 0.14],
  ]);
  pl(d, T, [
    [-s * 0.12, s * 0.1],
    [-s * 0.56, s * 0.88],
    [s * 0.06, s * 0.72],
    [s * 0.3, s * 0.16],
  ]);
  const gap = cw(s, 0.05);
  for (const t of [0.3, 0.56, 0.8]) {
    ln(
      d,
      T,
      [
        [-s * 0.06 + s * 0.26 * t, s * 0.14 + s * 0.1 * t],
        [-s * 0.5 + s * 0.62 * t, s * 0.84 - s * 0.14 * t],
      ],
      gap,
      0
    );
  }
  ln(d, T, [[-s * 0.46, s * 0.04], [-s * 0.94, s * 0.2]], gap, 0);
  disc(d, T, s * 0.55, s * 0.22, Math.max(0.35, s * 0.07), 0);
}

function drawFish(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  // tail and fins first, body over them
  pl(d, T, [
    [-s * 0.4, 0],
    [-s * 1.0, s * 0.44],
    [-s * 0.78, 0],
    [-s * 1.0, -s * 0.44],
  ]);
  pl(d, T, [[-s * 0.14, s * 0.24], [s * 0.1, s * 0.66], [s * 0.34, s * 0.22]]);
  pl(d, T, [[-s * 0.04, -s * 0.24], [s * 0.04, -s * 0.6], [s * 0.3, -s * 0.2]]);
  const body = lens(0, 1, (t) => s * 0.38 * Math.pow(Math.sin(Math.PI * t), 0.62)).map(
    ([hw, t]) => [-s * 0.46 + (s * 1.2) * t, hw] as Pt
  );
  pl(d, T, body);
  const gap = cw(s, 0.055);
  arcL(d, T, s * 0.14, 0, s * 0.3, -62, 62, gap, 0);
  for (const u of [s * 0.42, s * 0.12, -s * 0.18]) {
    arcL(d, T, u - s * 0.34, 0, s * 0.26, -58, 58, cw(s, 0.045), 0);
  }
  disc(d, T, s * 0.5, s * 0.09, Math.max(0.4, s * 0.085), 0);
}

function drawPaw(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  oval(d, T, 0, -s * 0.34, s * 0.58, s * 0.45, 0);
  const toes: Array<[number, number, number]> = [
    [-0.66, 0.1, 148.7],
    [-0.3, 0.6, 108.8],
    [0.3, 0.6, 71.2],
    [0.66, 0.1, 31.3],
  ];
  for (const [u, v, a] of toes) oval(d, T, u * s, v * s, s * 0.29, s * 0.21, a);
  for (const sg of [1, -1]) {
    pl(d, T, [[sg * s * 0.28, s * 0.08], [sg * s * 0.1, -s * 0.2], [sg * s * 0.02, s * 0.08]], 0);
  }
}

// ---------------------------------------------------------------------------
// celestial
// ---------------------------------------------------------------------------

function drawSun(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  for (let k = 0; k < 12; k++) polarTrap(d, T, s * 0.5, s, k * 30, 13, 5);
  disc(d, T, 0, 0, s * 0.58);
  const gap = cw(s, 0.055);
  ringL(d, T, 0, 0, s * 0.42, gap, 0);
  for (let k = 0; k < 12; k++) {
    const a = (15 + 30 * k) * D2R;
    ln(
      d,
      T,
      [
        [s * 0.46 * Math.cos(a), s * 0.46 * Math.sin(a)],
        [s * 0.56 * Math.cos(a), s * 0.56 * Math.sin(a)],
      ],
      gap,
      0
    );
  }
  disc(d, T, 0, 0, s * 0.13, 0);
}

function drawCrescent(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  disc(d, T, 0, 0, s);
  disc(d, T, s * 0.46, s * 0.1, s * 0.86, 0);
  // two craters keep the limb from reading as a plain sliver
  disc(d, T, -s * 0.6, s * 0.3, Math.max(0.5, s * 0.1), 0);
  disc(d, T, -s * 0.66, -s * 0.18, Math.max(0.45, s * 0.08), 0);
}

function drawFullMoon(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  disc(d, T, 0, 0, s);
  const maria: Array<[number, number, number, number, number]> = [
    [-0.3, 0.4, 0.34, 0.24, 24],
    [0.24, 0.46, 0.24, 0.18, -30],
    [0.42, -0.06, 0.3, 0.22, 60],
    [-0.44, -0.3, 0.26, 0.2, -14],
    [0.02, -0.5, 0.22, 0.16, 40],
  ];
  for (const [u, v, ru, rv, t] of maria) oval(d, T, u * s, v * s, ru * s, rv * s, t, 0);
  for (const [u, v, r] of [
    [-0.02, 0.06, 0.12],
    [0.62, 0.42, 0.09],
    [-0.62, 0.02, 0.08],
    [0.3, -0.62, 0.08],
  ] as Array<[number, number, number]>) {
    disc(d, T, u * s, v * s, Math.max(0.4, r * s), 0);
  }
}

function drawSparkle(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const pts: Pt[] = [];
  for (let i = 0; i < 200; i++) {
    const th = (2 * Math.PI * i) / 200;
    const r = s * (0.16 + 0.84 * Math.pow(Math.abs(Math.cos(2 * th)), 2.2));
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  pl(d, T, pts);
  const gap = cw(s, 0.05);
  for (let k = 0; k < 4; k++) {
    const a = 90 * k * D2R;
    ln(
      d,
      T,
      [
        [s * 0.1 * Math.cos(a), s * 0.1 * Math.sin(a)],
        [s * 0.72 * Math.cos(a), s * 0.72 * Math.sin(a)],
      ],
      gap,
      0
    );
  }
}

function drawPlanet(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  ovalRing(d, T, 0, 0, s * 1.06, s * 0.34, -18, s * 0.15);
  // dark moat so the ring reads as passing behind the globe
  disc(d, T, 0, 0, s * 0.66, 0);
  disc(d, T, 0, 0, s * 0.58);
  const gap = cw(s, 0.055);
  const R = s * 0.58;
  for (const v of [0.3, 0.06, -0.2]) {
    // chord of the globe at that latitude, pulled in a touch so it stays inside
    const y = v * s;
    const hw = Math.sqrt(Math.max(0, R * R - y * y)) * 0.88;
    ln(d, T, [[-hw, y], [hw, y]], gap, 0);
  }
  disc(d, T, s * 0.2, -s * 0.3, s * 0.12, 0);
}

function drawComet(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  tp(d, T, [s * 0.5, s * 0.5], [-s * 0.86, -s * 0.86], s * 0.66, s * 0.06);
  disc(d, T, s * 0.52, s * 0.52, s * 0.34);
  const gap = cw(s, 0.05);
  for (const off of [-0.22, 0, 0.22]) {
    const nx = -0.7071 * off;
    const ny = 0.7071 * off;
    ln(
      d,
      T,
      [
        [s * (0.24 + nx), s * (0.24 + ny)],
        [s * (-0.7 + nx * 0.35), s * (-0.7 + ny * 0.35)],
      ],
      gap,
      0
    );
  }
  ringL(d, T, s * 0.52, s * 0.52, s * 0.2, gap, 0);
}

function drawCloud(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  boxL(d, T, s * 0.02, -s * 0.24, s * 0.88, s * 0.24);
  const lobes: Array<[number, number, number]> = [
    [-0.56, -0.06, 0.4],
    [-0.16, 0.22, 0.54],
    [0.3, 0.08, 0.44],
    [0.66, -0.14, 0.32],
  ];
  for (const [u, v, r] of lobes) disc(d, T, u * s, v * s, r * s);
  const gap = cw(s, 0.05);
  for (const [u, v, r] of lobes) arcL(d, T, u * s, v * s, r * s * 0.6, 200, 340, gap, 0);
  ln(d, T, [[-s * 0.8, -s * 0.42], [s * 0.82, -s * 0.42]], gap, 0);
}

function drawBolt(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const p: Pt[] = [
    [0.0, 1.0],
    [-1.0, -0.2],
    [-0.222, -0.2],
    [-0.333, -1.0],
    [1.0, 0.2],
    [0.222, 0.2],
    [0.444, 1.0],
  ];
  pl(d, T, p.map(([u, v]) => [u * s * 0.84, v * s] as Pt));
}

// ---------------------------------------------------------------------------
// tech
// ---------------------------------------------------------------------------

function drawGear(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const n = 9;
  for (let k = 0; k < n; k++) polarTrap(d, T, s * 0.68, s, (360 / n) * k, 13, 9);
  disc(d, T, 0, 0, s * 0.76);
  const gap = cw(s, 0.055);
  ringL(d, T, 0, 0, s * 0.66, gap, 0);
  disc(d, T, 0, 0, s * 0.24, 0);
  for (let k = 0; k < 5; k++) {
    const a = (72 * k + 36) * D2R;
    disc(d, T, s * 0.48 * Math.cos(a), s * 0.48 * Math.sin(a), s * 0.14, 0);
  }
}

function drawChip(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  for (let i = 0; i < 6; i++) {
    const v = -s * 0.52 + i * s * 0.208;
    for (const sg of [1, -1]) boxL(d, T, sg * s * 0.76, v, s * 0.17, s * 0.058);
  }
  boxL(d, T, 0, 0, s * 0.6, s * 0.74);
  const gap = cw(s, 0.055);
  frameL(d, T, 0, 0, s * 0.47, s * 0.61, gap, 0);
  boxL(d, T, 0, -s * 0.04, s * 0.26, s * 0.32, 0);
  boxL(d, T, 0, -s * 0.04, s * 0.11, s * 0.14, 255);
  disc(d, T, -s * 0.34, s * 0.48, Math.max(0.45, s * 0.09), 0);
}

function drawVia(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  for (let k = 0; k < 4; k++) {
    const a = 90 * k * D2R;
    tp(
      d,
      T,
      [s * 0.4 * Math.cos(a), s * 0.4 * Math.sin(a)],
      [s * Math.cos(a), s * Math.sin(a)],
      s * 0.22,
      s * 0.18
    );
  }
  disc(d, T, 0, 0, s * 0.64);
  const gap = cw(s, 0.06);
  disc(d, T, 0, 0, s * 0.26, 0);
  ringL(d, T, 0, 0, s * 0.46, gap, 0);
  ringL(d, T, 0, 0, s * 0.82, gap, 0);
}

function drawBulb(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  pl(d, T, [
    [-s * 0.3, -s * 0.12],
    [-s * 0.36, s * 0.2],
    [s * 0.36, s * 0.2],
    [s * 0.3, -s * 0.12],
  ]);
  boxL(d, T, 0, -s * 0.42, s * 0.3, s * 0.24);
  boxL(d, T, 0, -s * 0.74, s * 0.15, s * 0.1);
  disc(d, T, 0, s * 0.36, s * 0.58);
  const gap = cw(s, 0.06);
  // filament: a dark zigzag inside the bright glass
  ln(
    d,
    T,
    [
      [-s * 0.22, s * 0.14],
      [-s * 0.22, s * 0.34],
      [-s * 0.06, s * 0.56],
      [s * 0.06, s * 0.34],
      [s * 0.22, s * 0.56],
      [s * 0.22, s * 0.14],
    ],
    gap,
    0
  );
  ln(d, T, [[-s * 0.32, -s * 0.14], [s * 0.32, -s * 0.14]], gap, 0);
  for (const v of [-0.32, -0.48]) {
    ln(d, T, [[-s * 0.28, v * s], [s * 0.28, v * s]], gap, 0);
  }
}

function drawRocket(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  for (const sg of [1, -1]) {
    pl(d, T, [
      [sg * s * 0.28, -s * 0.16],
      [sg * s * 0.74, -s * 0.74],
      [sg * s * 0.28, -s * 0.62],
    ]);
  }
  pl(d, T, [
    [-s * 0.24, -s * 0.52],
    [-s * 0.36, -s * 0.88],
    [s * 0.36, -s * 0.88],
    [s * 0.24, -s * 0.52],
  ]);
  boxL(d, T, 0, -s * 0.06, s * 0.31, s * 0.52);
  pl(d, T, [[-s * 0.31, s * 0.42], [0, s], [s * 0.31, s * 0.42]]);
  const gap = cw(s, 0.055);
  disc(d, T, 0, s * 0.26, s * 0.17, 0);
  ln(d, T, [[-s * 0.3, s * 0.44], [s * 0.3, s * 0.44]], gap, 0);
  ln(d, T, [[-s * 0.29, -s * 0.02], [s * 0.29, -s * 0.02]], gap, 0);
  ln(d, T, [[-s * 0.27, -s * 0.5], [s * 0.27, -s * 0.5]], gap, 0);
  for (const sg of [1, -1]) {
    ln(d, T, [[sg * s * 0.3, -s * 0.2], [sg * s * 0.3, -s * 0.56]], gap, 0);
  }
}

function drawCassette(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  boxL(d, T, 0, 0, s * 0.92, s * 0.58);
  const gap = cw(s, 0.055);
  boxL(d, T, 0, s * 0.08, s * 0.5, s * 0.22, 0);
  for (const sg of [1, -1]) {
    disc(d, T, sg * s * 0.28, s * 0.08, s * 0.14, 255);
    disc(d, T, sg * s * 0.28, s * 0.08, Math.max(0.4, s * 0.06), 0);
    disc(d, T, sg * s * 0.76, s * 0.42, Math.max(0.4, s * 0.07), 0);
    disc(d, T, sg * s * 0.76, -s * 0.42, Math.max(0.4, s * 0.07), 0);
  }
  ln(d, T, [[-s * 0.66, s * 0.42], [s * 0.66, s * 0.42]], gap, 0);
  // spindle notch, cut clear through the bottom edge of the silhouette
  boxL(d, T, 0, -s * 0.54, s * 0.3, s * 0.12, 0);
  ln(d, T, [[-s * 0.72, -s * 0.24], [s * 0.72, -s * 0.24]], gap, 0);
}

function drawBattery(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  boxL(d, T, s * 0.8, 0, s * 0.11, s * 0.18);
  boxL(d, T, -s * 0.1, 0, s * 0.8, s * 0.46);
  boxL(d, T, -s * 0.1, 0, s * 0.66, s * 0.32, 0);
  for (const u of [-0.52, -0.1, 0.32]) boxL(d, T, u * s, 0, s * 0.15, s * 0.24, 255);
}

function drawWifi(d: DrawCtx, cx: number, cy: number, s: number, rot: number) {
  const T = xf(cx, cy, rot);
  const v0 = -s * 0.72;
  disc(d, T, 0, v0, s * 0.17);
  for (const r of [0.4, 0.68, 0.96]) {
    arcL(d, T, 0, v0, r * s, 34, 146, s * 0.15);
  }
}

// ---------------------------------------------------------------------------

export const LIBRARY_MOTIFS: ShapeDef[] = [
  // --- nature -------------------------------------------------------------
  {
    id: 'leaf',
    name: 'Leaf',
    category: 'nature',
    glyph: '🍃',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawLeaf(d, cx, cy, s, r),
  },
  {
    id: 'monstera-leaf',
    name: 'Monstera',
    category: 'nature',
    glyph: '🌿',
    defaultSizeMm: 16,
    draw: (d, cx, cy, s, r) => drawMonstera(d, cx, cy, s, r),
  },
  {
    id: 'fern-frond',
    name: 'Fern frond',
    category: 'nature',
    glyph: '🪶',
    defaultSizeMm: 16,
    draw: (d, cx, cy, s, r) => drawFern(d, cx, cy, s, r),
  },
  {
    id: 'flower',
    name: 'Flower',
    category: 'nature',
    glyph: '🌸',
    defaultSizeMm: 13,
    noRotate: true,
    draw: (d, cx, cy, s, r) => drawFlower(d, cx, cy, s, r),
  },
  {
    id: 'tulip',
    name: 'Tulip',
    category: 'nature',
    glyph: '🌷',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawTulip(d, cx, cy, s, r),
  },
  {
    id: 'tree',
    name: 'Tree',
    category: 'nature',
    glyph: '🌳',
    defaultSizeMm: 16,
    draw: (d, cx, cy, s, r) => drawTree(d, cx, cy, s, r),
  },
  {
    id: 'pine-tree',
    name: 'Pine tree',
    category: 'nature',
    glyph: '🌲',
    defaultSizeMm: 16,
    draw: (d, cx, cy, s, r) => drawPine(d, cx, cy, s, r),
  },
  {
    id: 'mushroom',
    name: 'Mushroom',
    category: 'nature',
    glyph: '🍄',
    defaultSizeMm: 13,
    draw: (d, cx, cy, s, r) => drawMushroom(d, cx, cy, s, r),
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    category: 'nature',
    glyph: '🦋',
    defaultSizeMm: 15,
    draw: (d, cx, cy, s, r) => drawButterfly(d, cx, cy, s, r),
  },
  {
    id: 'bird',
    name: 'Bird',
    category: 'nature',
    glyph: '🕊',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawBird(d, cx, cy, s, r),
  },
  {
    id: 'fish',
    name: 'Fish',
    category: 'nature',
    glyph: '🐟',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawFish(d, cx, cy, s, r),
  },
  {
    id: 'paw-print',
    name: 'Paw print',
    category: 'nature',
    glyph: '🐾',
    defaultSizeMm: 12,
    draw: (d, cx, cy, s, r) => drawPaw(d, cx, cy, s, r),
  },

  // --- celestial ----------------------------------------------------------
  {
    id: 'sun',
    name: 'Sun',
    category: 'celestial',
    glyph: '☀',
    defaultSizeMm: 15,
    noRotate: true,
    draw: (d, cx, cy, s, r) => drawSun(d, cx, cy, s, r),
  },
  {
    id: 'crescent-moon',
    name: 'Crescent',
    category: 'celestial',
    glyph: '🌙',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawCrescent(d, cx, cy, s, r),
  },
  {
    id: 'full-moon',
    name: 'Full moon',
    category: 'celestial',
    glyph: '🌕',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawFullMoon(d, cx, cy, s, r),
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    category: 'celestial',
    glyph: '✦',
    defaultSizeMm: 11,
    draw: (d, cx, cy, s, r) => drawSparkle(d, cx, cy, s, r),
  },
  {
    id: 'ringed-planet',
    name: 'Planet',
    category: 'celestial',
    glyph: '🪐',
    defaultSizeMm: 15,
    draw: (d, cx, cy, s, r) => drawPlanet(d, cx, cy, s, r),
  },
  {
    id: 'comet',
    name: 'Comet',
    category: 'celestial',
    glyph: '☄',
    defaultSizeMm: 15,
    draw: (d, cx, cy, s, r) => drawComet(d, cx, cy, s, r),
  },
  {
    id: 'cloud',
    name: 'Cloud',
    category: 'celestial',
    glyph: '☁',
    defaultSizeMm: 15,
    draw: (d, cx, cy, s, r) => drawCloud(d, cx, cy, s, r),
  },
  {
    id: 'lightning-bolt',
    name: 'Bolt',
    category: 'celestial',
    glyph: '⚡',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawBolt(d, cx, cy, s, r),
  },

  // --- tech ---------------------------------------------------------------
  {
    id: 'gear',
    name: 'Gear',
    category: 'tech',
    glyph: '⚙',
    defaultSizeMm: 14,
    noRotate: true,
    draw: (d, cx, cy, s, r) => drawGear(d, cx, cy, s, r),
  },
  {
    id: 'chip',
    name: 'IC chip',
    category: 'tech',
    glyph: '▦',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawChip(d, cx, cy, s, r),
  },
  {
    id: 'via-pad',
    name: 'Via pad',
    category: 'tech',
    glyph: '◎',
    defaultSizeMm: 12,
    draw: (d, cx, cy, s, r) => drawVia(d, cx, cy, s, r),
  },
  {
    id: 'lightbulb',
    name: 'Lightbulb',
    category: 'tech',
    glyph: '💡',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawBulb(d, cx, cy, s, r),
  },
  {
    id: 'rocket',
    name: 'Rocket',
    category: 'tech',
    glyph: '🚀',
    defaultSizeMm: 16,
    draw: (d, cx, cy, s, r) => drawRocket(d, cx, cy, s, r),
  },
  {
    id: 'cassette',
    name: 'Cassette',
    category: 'tech',
    glyph: '📼',
    defaultSizeMm: 15,
    draw: (d, cx, cy, s, r) => drawCassette(d, cx, cy, s, r),
  },
  {
    id: 'battery',
    name: 'Battery',
    category: 'tech',
    glyph: '🔋',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawBattery(d, cx, cy, s, r),
  },
  {
    id: 'wifi',
    name: 'Wifi',
    category: 'tech',
    glyph: '📶',
    defaultSizeMm: 14,
    draw: (d, cx, cy, s, r) => drawWifi(d, cx, cy, s, r),
  },
];
