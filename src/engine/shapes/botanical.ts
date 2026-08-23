// Direct port of the jungle-silhouette / border shape helpers from
// reference/mango_salvaje_generator.py. Numbers and structure are kept
// as-is per CLAUDE.md — these constants were tuned by eye and are the spec.
import { DrawCtx, poly, thickline, ell, taper, rawLine } from '../draw';

const D2R = Math.PI / 180;

export function frond(
  d: DrawCtx,
  x0: number,
  y0: number,
  L: number,
  ang0: number,
  curve: number,
  nleaf = 16,
  lmax = 9.0,
  lw = 2.0,
  fill = 255
) {
  let x = x0;
  let y = y0;
  let ang = ang0 * D2R;
  const step = L / 59.0;
  const spine: Array<[number, number]> = [[x, y]];
  for (let i = 0; i < 59; i++) {
    ang += (curve * D2R) / 59.0;
    x += step * Math.cos(ang);
    y += step * Math.sin(ang);
    spine.push([x, y]);
  }
  thickline(d, spine, 1.5, fill);
  for (let k = 0; k < nleaf; k++) {
    const t = 0.1 + (0.88 * k) / (nleaf - 1);
    const i = Math.floor(t * 59);
    const [px, py] = spine[i];
    const [qx, qy] = spine[Math.min(i + 1, 59)];
    const a = Math.atan2(qy - py, qx - px);
    const ln = lmax * Math.pow(Math.sin(Math.PI * Math.min(t * 1.05, 1.0)), 0.55);
    const spread = (62 - 26 * t) * D2R;
    for (const s of [1, -1]) {
      const aa = a + s * spread;
      const tip: [number, number] = [px + ln * Math.cos(aa), py + ln * Math.sin(aa)];
      taper(d, [px, py], tip, lw, s * ln * 0.14, fill);
    }
  }
}

export function monstera(d: DrawCtx, cx: number, cy: number, R: number, rot = 0.0, fill = 255) {
  const ro = rot * D2R;
  const T = (u: number, v: number): [number, number] => [
    cx + u * Math.cos(ro) - v * Math.sin(ro),
    cy + u * Math.sin(ro) + v * Math.cos(ro),
  ];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 180; i++) {
    const th = (2 * Math.PI * i) / 180;
    const r = R * (0.86 + 0.2 * Math.cos(th) - 0.1 * Math.cos(2 * th));
    pts.push(T(r * Math.cos(th) * 0.92, r * Math.sin(th)));
  }
  poly(d, pts, fill);
  thickline(d, [T(0, -R * 1.05), T(0.0, R * 0.05)], 1.6, fill);
  for (const s of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      const v = -R * 0.62 + k * R * 0.42;
      const uOut = s * R * 1.25;
      const w = R * 0.16;
      poly(
        d,
        [
          T(uOut, v - w),
          T(s * R * 0.12, v - w * 0.35),
          T(s * R * 0.12, v + w * 0.35),
          T(uOut, v + w),
        ],
        0
      );
    }
  }
  const [ecx, ecy] = T(0, 0);
  ell(d, ecx, ecy, R * 0.055, R * 0.055, 0);
}

export function agave(
  d: DrawCtx,
  x0: number,
  y0: number,
  h: number,
  n = 9,
  spread = 76,
  w = 3.0,
  fill = 255
) {
  for (let k = 0; k < n; k++) {
    const f = (k / (n - 1)) * 2 - 1;
    const a = (90 + f * spread) * D2R;
    const ln = h * (0.55 + 0.45 * Math.cos(f * 1.35));
    const tip: [number, number] = [x0 + ln * Math.cos(a), y0 + ln * Math.sin(a)];
    taper(d, [x0, y0], tip, w, f * ln * 0.1, fill);
  }
}

export function mango(
  d: DrawCtx,
  cx: number,
  cy: number,
  L: number,
  rot = 0.0,
  stem = true,
  fill = 255
) {
  const ro = rot * D2R;
  const T = (u: number, v: number): [number, number] => [
    cx + u * Math.cos(ro) - v * Math.sin(ro),
    cy + u * Math.sin(ro) + v * Math.cos(ro),
  ];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 220; i++) {
    const th = (2 * Math.PI * i) / 220;
    const rr = 1.0 + 0.17 * Math.cos(th) - 0.08 * Math.cos(2 * th) + 0.06 * Math.sin(th);
    pts.push(T(0.5 * L * rr * Math.cos(th), 0.5 * L * 0.64 * rr * Math.sin(th)));
  }
  poly(d, pts, fill);
  if (stem) {
    thickline(d, [T(-0.44 * L, 0.16 * L), T(-0.6 * L, 0.3 * L)], 0.09 * L, fill);
    taper(d, T(-0.56 * L, 0.26 * L), T(-0.86 * L, 0.44 * L), 0.2 * L, 0.05 * L, fill);
  }
}

export function mangoBranch(d: DrawCtx, x0: number, y0: number, sc = 1.0, fill = 255) {
  const L = 36 * sc;
  const spine: Array<[number, number]> = [];
  for (let i = 0; i < 35; i++) {
    spine.push([x0 + 4.0 * sc * Math.sin((2.4 * i) / 34), y0 + (L * i) / 34]);
  }
  thickline(d, spine, 1.5 * sc, fill);
  const branches: Array<[number, number, number]> = [
    [0.52, 34, 13],
    [0.7, 148, 12],
    [0.88, 42, 11],
    [0.97, 132, 10],
  ];
  for (const [t, a, ln] of branches) {
    const [px, py] = spine[Math.floor(t * 34)];
    const ar = a * D2R;
    taper(d, [px, py], [px + ln * sc * Math.cos(ar), py + ln * sc * Math.sin(ar)], 3.6 * sc, 1.6 * sc, fill);
  }
  const fruits: Array<[number, -1 | 1, number]> = [
    [0.58, -1, 8],
    [0.72, 1, 10],
    [0.86, -1, 7],
  ];
  for (const [t, side, ped] of fruits) {
    const [px, py] = spine[Math.floor(t * 34)];
    const ex = px + side * 3.0 * sc;
    const ey = py - ped * sc;
    thickline(d, [[px, py], [ex, ey]], 0.7 * sc, fill);
    mango(d, ex + side * 1.2 * sc, ey - 4.2 * sc, 11.0 * sc, -78 + side * 16, false, fill);
  }
}

export function grass(
  d: DrawCtx,
  x0: number,
  y0: number,
  h: number,
  rng: () => number,
  n = 7,
  fill = 255
) {
  for (let k = 0; k < n; k++) {
    const f = (k / (n - 1)) * 2 - 1;
    const a = (90 + f * 46) * D2R;
    const ln = h * (0.6 + 0.4 * rng());
    taper(d, [x0, y0], [x0 + ln * Math.cos(a), y0 + ln * Math.sin(a)], 1.1, f * ln * 0.22, fill);
  }
}

export function blade(
  d: DrawCtx,
  x0: number,
  y0: number,
  L: number,
  ang: number,
  bend: number,
  w: number,
  slits = 6,
  fill = 255
) {
  const a = ang * D2R;
  const tip: [number, number] = [x0 + L * Math.cos(a), y0 + L * Math.sin(a)];
  taper(d, [x0, y0], tip, w, bend, fill);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  for (let k = 0; k < slits; k++) {
    const t = 0.22 + (0.7 * k) / (slits - 1);
    const px = x0 + L * t * Math.cos(a);
    const py = y0 + L * t * Math.sin(a);
    const sg = k % 2 ? 1 : -1;
    const ww = w * 0.55 * Math.sin(Math.PI * t);
    rawLine(
      d,
      [px + nx * sg * ww * 0.15, py + ny * sg * ww * 0.15],
      [px + nx * sg * ww * 1.5 + Math.cos(a) * 2.0, py + ny * sg * ww * 1.5 + Math.sin(a) * 2.0],
      Math.max(1, Math.trunc(0.9 * d.PPM)),
      0
    );
  }
}

export function bird(d: DrawCtx, cx: number, cy: number, s: number, fill = 255) {
  const shape: Array<[number, number]> = [
    [-1.0, 0.02], [-0.62, 0.3], [-0.3, 0.16], [-0.1, 0.3],
    [0.0, 0.1], [0.1, 0.3], [0.3, 0.16], [0.62, 0.3],
    [1.0, 0.02], [0.55, 0.06], [0.0, -0.1], [-0.55, 0.06],
  ];
  poly(d, shape.map(([u, v]) => [cx + u * s, cy + v * s]), fill);
}

export function greca(d: DrawCtx, ybase: number, band: number, reps = 16, fill = 255) {
  const u = d.W / reps;
  for (let k = 0; k < reps; k++) {
    const x = k * u;
    const st = band / 3.0;
    const segs: Array<[number, number]> = [[0.1, 0.9], [0.24, 0.76], [0.38, 0.62]];
    segs.forEach(([a, b], i) => {
      poly(
        d,
        [
          [x + a * u, ybase + i * st],
          [x + b * u, ybase + i * st],
          [x + b * u, ybase + (i + 1) * st],
          [x + a * u, ybase + (i + 1) * st],
        ],
        fill
      );
    });
    poly(
      d,
      [
        [x + 0.945 * u, ybase],
        [x + 1.055 * u, ybase],
        [x + 1.055 * u, ybase + st * 0.55],
        [x + 0.945 * u, ybase + st * 0.55],
      ],
      fill
    );
  }
}
