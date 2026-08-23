// Stamp library, part 1: 'basic', 'geometric' and 'decor' families.
//
// Every entry draws through the draw.ts primitives, so seamless X wrap comes
// for free (each primitive paints three times at x-W / x / x+W).
//
// Design rules these obey — all of them learned the hard way, see CLAUDE.md:
//   * Chunky closed forms read at 1.2-1.45 mm pitch; filigree turns to noise,
//     so nothing here relies on a feature thinner than ~2 mm at its default
//     size, and every dimension is a fraction of `size` so it scales.
//   * Interior detail is CARVED (fill 0 painted over a 255 fill), never drawn
//     as an outline — a solid form with dark cuts in it reads from across the
//     room, an outline does not. `starFlake` in crystal.ts is the archetype.
//   * Full-width decor bands tile an integer number of periods into the
//     circumference, so the pattern closes on itself at the seam.
import {
  DrawCtx,
  poly,
  thickline,
  circle,
  band,
  taper2,
  ngon,
  ngonRing,
  hexagon,
  hexring,
  star,
  arc,
  wedge,
} from '../draw';

export type ShapeCategory = 'basic' | 'geometric' | 'nature' | 'celestial' | 'tech' | 'decor';

export interface ShapeDef {
  id: string;                 // unique kebab-case
  name: string;               // short human label, max ~14 chars
  category: ShapeCategory;
  glyph: string;              // ONE unicode symbol/emoji for a 38px palette button
  defaultSizeMm: number;      // sensible default "radius-ish" size, typically 10-18
  /** Draw centred at (cx,cy). `size` is the nominal radius/half-extent in mm. rotation in DEGREES. */
  draw(d: DrawCtx, cx: number, cy: number, size: number, rotation: number): void;
  noRotate?: boolean;         // set true for rotationally symmetric shapes (circle, ring)
  fullWidth?: boolean;        // set true if the shape spans the whole circumference (bands)
}

const D2R = Math.PI / 180;

/**
 * Local -> world transform. `u` runs along the shape's own +x axis, `v` along
 * its +y, both in mm; the result is rotated by `deg` about (cx,cy). Same trick
 * crystal.ts uses inline, factored out because nearly every shape needs it.
 */
function xf(cx: number, cy: number, deg: number) {
  const a = deg * D2R;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return (u: number, v: number): [number, number] => [cx + u * ca - v * sa, cy + u * sa + v * ca];
}

type Xf = ReturnType<typeof xf>;

/** Keep an interior cut wide enough to actually swallow a row of holes. */
function cutW(size: number, frac: number): number {
  return Math.max(0.55, size * frac);
}

function ellipsePts(t: Xf, rx: number, ry: number, steps = 72): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    out.push(t(rx * Math.cos(a), ry * Math.sin(a)));
  }
  return out;
}

function roundRectPts(t: Xf, hw: number, hh: number, r: number, per = 6): Array<[number, number]> {
  const corners: Array<[number, number, number]> = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, 90],
    [-(hw - r), -(hh - r), 180],
    [hw - r, -(hh - r), 270],
  ];
  const out: Array<[number, number]> = [];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = (a0 + (90 * i) / per) * D2R;
      out.push(t(ox + r * Math.cos(a), oy + r * Math.sin(a)));
    }
  }
  return out;
}

/**
 * Vesica / pointed-oval outline as two circular arcs. `halfH` is the long
 * half-axis; the waist comes out at ~0.54x that, the classic 1:sqrt(3) feel.
 */
function vesicaPts(t: Xf, halfH: number, steps = 40): Array<[number, number]> {
  const k = 0.55;
  const R = halfH / Math.sqrt(1 - k * k);
  const dx = k * R;
  const a0 = Math.acos(k) / D2R;
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const a = (-a0 + (2 * a0 * i) / steps) * D2R;
    out.push(t(-dx + R * Math.cos(a), R * Math.sin(a)));
  }
  for (let i = 0; i <= steps; i++) {
    const a = (180 - a0 + (2 * a0 * i) / steps) * D2R;
    out.push(t(dx + R * Math.cos(a), R * Math.sin(a)));
  }
  return out;
}

/** Plus/cross outline, `a` = arm half-thickness, `size` = half-extent. */
function crossPts(t: Xf, size: number, a: number): Array<[number, number]> {
  return [
    t(size, -a), t(size, a), t(a, a), t(a, size), t(-a, size), t(-a, a),
    t(-size, a), t(-size, -a), t(-a, -a), t(-a, -size), t(a, -size), t(a, -a),
  ];
}

/** Integer period count across the circumference — the seam-safe divisor. */
function periods(d: DrawCtx, wanted: number, min = 4): number {
  return Math.max(min, Math.round(d.W / Math.max(0.5, wanted)));
}

// ---------------------------------------------------------------------------
// basic
// ---------------------------------------------------------------------------

const BASIC: ShapeDef[] = [
  {
    id: 'circle',
    name: 'Circle',
    category: 'basic',
    glyph: '●',
    defaultSizeMm: 12,
    noRotate: true,
    draw(d, cx, cy, size) {
      circle(d, cx, cy, size, 255);
    },
  },
  {
    id: 'ring',
    name: 'Ring',
    category: 'basic',
    glyph: '◯',
    defaultSizeMm: 13,
    noRotate: true,
    draw(d, cx, cy, size) {
      circle(d, cx, cy, size, 255);
      circle(d, cx, cy, size * 0.58, 0);
    },
  },
  {
    id: 'square',
    name: 'Square',
    category: 'basic',
    glyph: '■',
    defaultSizeMm: 12,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      poly(d, [t(-size, -size), t(size, -size), t(size, size), t(-size, size)], 255);
    },
  },
  {
    id: 'round-rect',
    name: 'Round rect',
    category: 'basic',
    glyph: '▢',
    defaultSizeMm: 14,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      const hh = size * 0.62;
      poly(d, roundRectPts(t, size, hh, Math.min(size, hh) * 0.34), 255);
    },
  },
  {
    id: 'triangle',
    name: 'Triangle',
    category: 'basic',
    glyph: '▲',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      ngon(d, cx, cy, size, 3, rotation + 90, 255);
    },
  },
  {
    id: 'diamond',
    name: 'Diamond',
    category: 'basic',
    glyph: '◆',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      const hw = size * 0.66;
      poly(d, [t(0, size), t(hw, 0), t(0, -size), t(-hw, 0)], 255);
    },
  },
  {
    id: 'ellipse',
    name: 'Ellipse',
    category: 'basic',
    glyph: '⬬',
    defaultSizeMm: 14,
    draw(d, cx, cy, size, rotation) {
      poly(d, ellipsePts(xf(cx, cy, rotation), size, size * 0.6), 255);
    },
  },
  {
    id: 'capsule',
    name: 'Capsule',
    category: 'basic',
    glyph: '▭',
    defaultSizeMm: 14,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      const r = size * 0.42;
      thickline(d, [t(-(size - r), 0), t(size - r, 0)], r * 2, 255);
    },
  },
];

// ---------------------------------------------------------------------------
// geometric
// ---------------------------------------------------------------------------

const GEOMETRIC: ShapeDef[] = [
  {
    id: 'pentagon',
    name: 'Pentagon',
    category: 'geometric',
    glyph: '⬟',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      ngon(d, cx, cy, size, 5, rotation + 90, 255);
      ngonRing(d, cx, cy, size * 0.60, 5, rotation + 90, cutW(size, 0.1), 0);
    },
  },
  {
    id: 'hexagon',
    name: 'Hexagon',
    category: 'geometric',
    glyph: '⬢',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      hexagon(d, cx, cy, size, rotation, 255);
      hexring(d, cx, cy, size * 0.60, rotation, cutW(size, 0.1), 0);
    },
  },
  {
    id: 'octagon',
    name: 'Octagon',
    category: 'geometric',
    glyph: '🛑',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      ngon(d, cx, cy, size, 8, rotation + 22.5, 255);
      ngonRing(d, cx, cy, size * 0.60, 8, rotation + 22.5, cutW(size, 0.1), 0);
    },
  },
  {
    id: 'star-5',
    name: '5-point star',
    category: 'geometric',
    glyph: '★',
    defaultSizeMm: 15,
    draw(d, cx, cy, size, rotation) {
      star(d, cx, cy, size, size * 0.46, 5, rotation + 90, 255);
    },
  },
  {
    id: 'star-6',
    name: '6-point star',
    category: 'geometric',
    glyph: '✶',
    defaultSizeMm: 15,
    draw(d, cx, cy, size, rotation) {
      star(d, cx, cy, size, size * 0.52, 6, rotation + 90, 255);
      hexring(d, cx, cy, size * 0.30, rotation + 90, cutW(size, 0.085), 0);
    },
  },
  {
    id: 'star-8',
    name: '8-point star',
    category: 'geometric',
    glyph: '✴',
    defaultSizeMm: 15,
    draw(d, cx, cy, size, rotation) {
      star(d, cx, cy, size, size * 0.54, 8, rotation, 255);
      arc(d, cx, cy, size * 0.31, 0, 360, cutW(size, 0.085), 0);
    },
  },
  {
    id: 'rings-3',
    name: 'Concentric',
    category: 'geometric',
    glyph: '◎',
    defaultSizeMm: 15,
    noRotate: true,
    draw(d, cx, cy, size) {
      // three bright annuli, widths ~0.18R with ~0.14R of dark between them
      circle(d, cx, cy, size, 255);
      circle(d, cx, cy, size * 0.82, 0);
      circle(d, cx, cy, size * 0.68, 255);
      circle(d, cx, cy, size * 0.50, 0);
      circle(d, cx, cy, size * 0.36, 255);
      circle(d, cx, cy, size * 0.16, 0);
    },
  },
  {
    id: 'crescent',
    name: 'Crescent',
    category: 'geometric',
    glyph: '☾',
    defaultSizeMm: 14,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      circle(d, cx, cy, size, 255);
      const [ox, oy] = t(size * 0.44, 0);
      circle(d, ox, oy, size * 0.90, 0);
    },
  },
  {
    id: 'cross',
    name: 'Cross',
    category: 'geometric',
    glyph: '✚',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      poly(d, crossPts(xf(cx, cy, rotation), size, size * 0.34), 255);
    },
  },
  {
    id: 'chevron',
    name: 'Chevron',
    category: 'geometric',
    glyph: '⌃',
    defaultSizeMm: 13,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      thickline(
        d,
        [t(-size, -size * 0.45), t(0, size * 0.45), t(size, -size * 0.45)],
        size * 0.36,
        255
      );
    },
  },
  {
    id: 'spiral',
    name: 'Spiral',
    category: 'geometric',
    glyph: '🌀',
    defaultSizeMm: 15,
    draw(d, cx, cy, size, rotation) {
      // Archimedean: 2.2 turns, radial advance 0.38R per turn, so the dark gap
      // between successive whorls stays ~0.23R even after the stroke width.
      const turns = 2.2;
      const r0 = size * 0.16;
      const steps = 168;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const a = (rotation + 360 * turns * f) * D2R;
        const r = r0 + (size - r0) * f;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      thickline(d, pts, size * 0.15, 255);
    },
  },
  {
    id: 'vesica',
    name: 'Vesica',
    category: 'geometric',
    glyph: '⬮',
    defaultSizeMm: 15,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation + 90);
      poly(d, vesicaPts(t, size), 255);
      poly(d, vesicaPts(t, size * 0.52), 0);
    },
  },
];

// ---------------------------------------------------------------------------
// decor — the full-width entries treat `size` as the band's half-height and
// ignore cx; period counts are integers so the motif closes at the seam.
// ---------------------------------------------------------------------------

const DECOR: ShapeDef[] = [
  {
    id: 'band-solid',
    name: 'Solid band',
    category: 'decor',
    glyph: '▬',
    defaultSizeMm: 3,
    noRotate: true,
    fullWidth: true,
    draw(d, _cx, cy, size) {
      band(d, cy - size, size * 2, 255);
    },
  },
  {
    id: 'band-dots',
    name: 'Dot band',
    category: 'decor',
    glyph: '⋯',
    defaultSizeMm: 3.5,
    noRotate: true,
    fullWidth: true,
    draw(d, _cx, cy, size) {
      const n = periods(d, size * 2.4, 6);
      const p = d.W / n;
      const r = Math.min(size, p * 0.36);
      for (let i = 0; i < n; i++) circle(d, (i + 0.5) * p, cy, r, 255);
    },
  },
  {
    id: 'band-zigzag',
    name: 'Zigzag band',
    category: 'decor',
    glyph: '〰',
    defaultSizeMm: 4,
    noRotate: true,
    fullWidth: true,
    draw(d, _cx, cy, size) {
      const w = size * 0.5;
      const amp = size - w * 0.5;
      const n = periods(d, size * 4.0, 4);
      const p = d.W / n;
      const pts: Array<[number, number]> = [];
      // 2n half-periods, so the first and last point share a y and the wrap
      // copies continue the run cleanly across the seam.
      for (let i = 0; i <= 2 * n; i++) {
        pts.push([(i * p) / 2, cy + (i % 2 === 0 ? -amp : amp)]);
      }
      thickline(d, pts, w, 255);
    },
  },
  {
    id: 'band-scallop',
    name: 'Scallop band',
    category: 'decor',
    glyph: '◠',
    defaultSizeMm: 5,
    noRotate: true,
    fullWidth: true,
    draw(d, _cx, cy, size) {
      // Lower half solid, bumps centred on the mid-line so their hidden lower
      // halves sink into the strip and nothing spills past cy +/- size.
      band(d, cy - size, size, 255);
      const n = periods(d, size * 1.6, 6);
      const p = d.W / n;
      const r = Math.min(size, p * 0.56); // slight overlap => one wavy edge
      for (let i = 0; i < n; i++) circle(d, (i + 0.5) * p, cy, r, 255);
    },
  },
  {
    id: 'band-fret',
    name: 'Greek fret',
    category: 'decor',
    glyph: '⌗',
    defaultSizeMm: 9,
    noRotate: true,
    fullWidth: true,
    draw(d, _cx, cy, size) {
      // Square-wave meander with an inward tooth on each run: the classic
      // Greek key, but chunky enough to survive a 1.35 mm pitch. A true
      // interlocking spiral needs webs under 1 mm here and dissolves.
      const w = cutW(size, 0.2);
      const vHi = size - w * 0.5;
      const vLo = -vHi;
      const h = vHi - vLo;
      const n = periods(d, size * 2.4, 3);
      const p = d.W / n;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const x0 = i * p;
        pts.push([x0, cy + vLo], [x0, cy + vHi], [x0 + p * 0.5, cy + vHi], [x0 + p * 0.5, cy + vLo]);
      }
      pts.push([d.W, cy + vLo]);
      thickline(d, pts, w, 255);
      for (let i = 0; i < n; i++) {
        const x0 = i * p;
        thickline(d, [[x0 + p * 0.25, cy + vHi], [x0 + p * 0.25, cy + vHi - h * 0.45]], w, 255);
        thickline(d, [[x0 + p * 0.75, cy + vLo], [x0 + p * 0.75, cy + vLo + h * 0.45]], w, 255);
      }
    },
  },
  {
    id: 'rosette',
    name: 'Sunburst',
    category: 'decor',
    glyph: '✺',
    defaultSizeMm: 15,
    draw(d, cx, cy, size, rotation) {
      const n = 12;
      const step = 360 / n;
      const half = step * 0.29; // ray ~2 mm wide at its narrow inner end
      const rIn = size * 0.46;
      for (let k = 0; k < n; k++) {
        const a = rotation + step * k;
        wedge(d, cx, cy, rIn, size, a - half, a + half, 255);
      }
      circle(d, cx, cy, size * 0.34, 255);
      circle(d, cx, cy, size * 0.13, 0);
    },
  },
  {
    id: 'wreath',
    name: 'Laurel ring',
    category: 'decor',
    glyph: '🌿',
    defaultSizeMm: 16,
    draw(d, cx, cy, size, rotation) {
      const n = 12;
      const stem = size * 0.52;
      arc(d, cx, cy, stem, 0, 360, cutW(size, 0.12), 255);
      for (let k = 0; k < n; k++) {
        const a = (rotation + (360 / n) * k) * D2R;
        const b = a + 24 * D2R; // sweep, so the leaves lie back like laurel
        taper2(
          d,
          [cx + size * 0.56 * Math.cos(a), cy + size * 0.56 * Math.sin(a)],
          [cx + size * 0.98 * Math.cos(b), cy + size * 0.98 * Math.sin(b)],
          size * 0.2,
          size * 0.06,
          255
        );
      }
    },
  },
  {
    id: 'frame-corners',
    name: 'Corner frame',
    category: 'decor',
    glyph: '⛶',
    defaultSizeMm: 16,
    draw(d, cx, cy, size, rotation) {
      const t = xf(cx, cy, rotation);
      const arm = size * 0.62;
      const w = size * 0.2;
      const quads: Array<[number, number]> = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (const [sx, sy] of quads) {
        thickline(
          d,
          [t(sx * size, sy * (size - arm)), t(sx * size, sy * size), t(sx * (size - arm), sy * size)],
          w,
          255
        );
      }
    },
  },
];

export const LIBRARY_BASIC: ShapeDef[] = [...BASIC, ...GEOMETRIC, ...DECOR];
