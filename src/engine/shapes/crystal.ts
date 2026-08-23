// Direct port of the ice-crystal shape helpers from
// reference/escarcha_generator.py. Numbers kept as-is per CLAUDE.md.
//
// Note the deliberate design lesson embedded here (rule 3): `dendrite` is the
// botanically correct branching form and reads as noise at this pitch;
// `starFlake` is the chunky solid replacement that actually reads across a
// room. Both are kept — dendrite is used small, as accent, not as a hero.
import { DrawCtx, poly, thickline, taper2, hexagon, hexring } from '../draw';

const D2R = Math.PI / 180;

export function dendrite(d: DrawCtx, cx: number, cy: number, R: number, rot = 90.0, fill = 255) {
  hexagon(d, cx, cy, R * 0.13, rot, fill);
  hexring(d, cx, cy, R * 0.26, rot, 2.8, fill);
  for (let k = 0; k < 6; k++) {
    const a = (rot + 60 * k) * D2R;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    taper2(d, [cx, cy], [cx + R * ca, cy + R * sa], 5.0, 2.4, fill);
    for (const t of [0.34, 0.52, 0.7, 0.86]) {
      const px = cx + R * t * ca;
      const py = cy + R * t * sa;
      const bl = R * (0.36 * Math.pow(1.0 - t, 0.7) + 0.045);
      for (const s of [1, -1]) {
        const ba = a + s * 60 * D2R;
        const bx = px + bl * Math.cos(ba);
        const by = py + bl * Math.sin(ba);
        taper2(d, [px, py], [bx, by], 3.0, 2.2, fill);
        if (t < 0.6 && bl > 9.0) {
          const qx = px + bl * 0.6 * Math.cos(ba);
          const qy = py + bl * 0.6 * Math.sin(ba);
          const sl = bl * 0.34;
          for (const s2 of [1, -1]) {
            const sb = ba + s2 * 60 * D2R;
            taper2(d, [qx, qy], [qx + sl * Math.cos(sb), qy + sl * Math.sin(sb)], 2.4, 2.1, fill);
          }
        }
      }
    }
    hexagon(d, cx + R * 0.985 * ca, cy + R * 0.985 * sa, R * 0.085, rot, fill);
  }
}

/** Chunky solid six-point snow star with dark detail cuts inside it. */
export function starFlake(d: DrawCtx, cx: number, cy: number, R: number, rot = 90.0, fill = 255) {
  hexagon(d, cx, cy, R * 0.34, rot, fill);
  for (let k = 0; k < 6; k++) {
    const a = (rot + 60 * k) * D2R;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    taper2(d, [cx + R * 0.05 * ca, cy + R * 0.05 * sa], [cx + R * ca, cy + R * sa], R * 0.27, R * 0.11, fill);
    const arms: Array<[number, number, number]> = [
      [0.4, 0.34, 0.17],
      [0.62, 0.25, 0.13],
      [0.82, 0.15, 0.1],
    ];
    for (const [t, ln, w] of arms) {
      const px = cx + R * t * ca;
      const py = cy + R * t * sa;
      for (const sg of [1, -1]) {
        const ba = a + sg * 60 * D2R;
        taper2(d, [px, py], [px + R * ln * Math.cos(ba), py + R * ln * Math.sin(ba)], R * w, R * w * 0.55, fill);
      }
    }
    hexagon(d, cx + R * 0.99 * ca, cy + R * 0.99 * sa, R * 0.105, rot, fill);
  }
  // dark cuts inside the solid form — rule 3: a solid form with dark cuts in it
  for (let k = 0; k < 6; k++) {
    const a = (rot + 60 * k) * D2R;
    thickline(
      d,
      [
        [cx + R * 0.1 * Math.cos(a), cy + R * 0.1 * Math.sin(a)],
        [cx + R * 0.94 * Math.cos(a), cy + R * 0.94 * Math.sin(a)],
      ],
      R * 0.036,
      0
    );
    for (const [t, ln] of [[0.4, 0.3], [0.62, 0.21]] as Array<[number, number]>) {
      const px = cx + R * t * Math.cos(a);
      const py = cy + R * t * Math.sin(a);
      for (const sg of [1, -1]) {
        const ba = a + sg * 60 * D2R;
        thickline(d, [[px, py], [px + R * ln * Math.cos(ba), py + R * ln * Math.sin(ba)]], R * 0.032, 0);
      }
    }
  }
  hexring(d, cx, cy, R * 0.215, rot, R * 0.032, 0);
  hexring(d, cx, cy, R * 0.46, rot, R * 0.03, 0);
}

/** Sectored hexagonal plate. */
export function plate(d: DrawCtx, cx: number, cy: number, R: number, rot = 90.0, fill = 255) {
  for (const [rr, w] of [[1.0, 3.6], [0.74, 3.0], [0.48, 2.6]] as Array<[number, number]>) {
    hexring(d, cx, cy, R * rr, rot, w, fill);
  }
  hexagon(d, cx, cy, R * 0.2, rot, fill);
  for (let k = 0; k < 6; k++) {
    const a = (rot + 60 * k) * D2R;
    taper2(d, [cx, cy], [cx + R * Math.cos(a), cy + R * Math.sin(a)], 3.4, 2.6, fill);
    const a2 = (rot + 30 + 60 * k) * D2R;
    taper2(
      d,
      [cx + R * 0.2 * Math.cos(a2), cy + R * 0.2 * Math.sin(a2)],
      [cx + R * 0.87 * Math.cos(a2), cy + R * 0.87 * Math.sin(a2)],
      2.8,
      2.2,
      fill
    );
    hexagon(d, cx + R * Math.cos(a), cy + R * Math.sin(a), R * 0.1, rot, fill);
  }
}

/** Recursive frost fern — many short barbs, feathery. */
export function fern(
  d: DrawCtx,
  x0: number,
  y0: number,
  ang: number,
  L: number,
  w: number,
  depth: number,
  fill = 255,
  rnd?: () => number
) {
  const a = ang * D2R;
  const tx = x0 + L * Math.cos(a);
  const ty = y0 + L * Math.sin(a);
  taper2(d, [x0, y0], [tx, ty], w, Math.max(w * 0.55, 1.9), fill);
  if (depth <= 0) return;
  const n = depth >= 2 ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const t = 0.16 + (0.78 * i) / (n - 1);
    const px = x0 + L * t * Math.cos(a);
    const py = y0 + L * t * Math.sin(a);
    const bl = L * (0.34 * Math.pow(1.0 - t, 0.85) + 0.055);
    if (bl < 3.2) continue;
    for (const s of [1, -1]) {
      const j = rnd ? (rnd() - 0.5) * 14 : 0.0;
      fern(d, px, py, ang + s * 58 + j, bl, Math.max(w * 0.6, 2.0), depth - 1, fill, rnd);
    }
  }
}

/** Hanging icicle triangle. */
export function icicle(d: DrawCtx, x0: number, yTop: number, len: number, w: number, fill = 255) {
  poly(d, [[x0 - w / 2, yTop], [x0 + w / 2, yTop], [x0 + w * 0.1, yTop - len]], fill);
}
