// Canvas2D drawing primitives for building bright-mask layers.
//
// Coordinates are millimetres with y measured UP from the bottom edge, matching
// the reference generators' P(x, y) helper. Seamless wrap is handled per the
// CLAUDE.md port plan: every path is drawn three times at x-W, x, x+W and the
// canvas clips the overflow, replacing the Python 3-tile + np.maximum.reduce
// fold. Anything drawn near either seam therefore appears correctly on both
// sides without the caller thinking about it.

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  W: number;
  H: number;
  PPM: number;
  Wp: number;
  Hp: number;
}

export function createMask(W: number, H: number, PPM: number): DrawCtx {
  const Wp = Math.round(W * PPM);
  const Hp = Math.round(H * PPM);
  const canvas = document.createElement('canvas');
  canvas.width = Wp;
  canvas.height = Hp;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, Wp, Hp);
  return { ctx, canvas, W, H, PPM, Wp, Hp };
}

/** mm (y up from bottom) -> device px */
export function toPx(d: DrawCtx, x: number, y: number): [number, number] {
  return [x * d.PPM, (d.H - y) * d.PPM];
}

function gray(fill: number): string {
  const v = Math.round(Math.min(255, Math.max(0, fill)));
  return `rgb(${v},${v},${v})`;
}

/** Run `draw` three times, offset by -W / 0 / +W, so paths wrap across the seam. */
export function wrapDraw(d: DrawCtx, draw: (shiftX: number) => void) {
  draw(-d.W);
  draw(0);
  draw(d.W);
}

export function poly(d: DrawCtx, pts: Array<[number, number]>, fill = 255) {
  if (pts.length < 3) return;
  wrapDraw(d, (shift) => {
    const c = d.ctx;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = toPx(d, pts[i][0] + shift, pts[i][1]);
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = gray(fill);
    c.fill();
  });
}

export function thickline(d: DrawCtx, pts: Array<[number, number]>, wMm: number, fill = 255) {
  if (pts.length < 2) return;
  wrapDraw(d, (shift) => {
    const c = d.ctx;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = toPx(d, pts[i][0] + shift, pts[i][1]);
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.lineWidth = Math.max(1, wMm * d.PPM);
    c.strokeStyle = gray(fill);
    c.stroke();
  });
}

/** Straight segment with the width given in device pixels rather than mm. */
export function rawLine(
  d: DrawCtx,
  p1: [number, number],
  p2: [number, number],
  widthPx: number,
  fill = 255
) {
  wrapDraw(d, (shift) => {
    const c = d.ctx;
    const [x1, y1] = toPx(d, p1[0] + shift, p1[1]);
    const [x2, y2] = toPx(d, p2[0] + shift, p2[1]);
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.lineCap = 'round';
    c.lineWidth = Math.max(1, widthPx);
    c.strokeStyle = gray(fill);
    c.stroke();
  });
}

export function ell(d: DrawCtx, cx: number, cy: number, rx: number, ry: number, fill = 255) {
  wrapDraw(d, (shift) => {
    const c = d.ctx;
    const [pcx, pcy] = toPx(d, cx + shift, cy);
    c.beginPath();
    c.ellipse(pcx, pcy, Math.max(0.01, rx * d.PPM), Math.max(0.01, ry * d.PPM), 0, 0, Math.PI * 2);
    c.fillStyle = gray(fill);
    c.fill();
  });
}

export function circle(d: DrawCtx, cx: number, cy: number, r: number, fill = 255) {
  ell(d, cx, cy, r, r, fill);
}

export function rect(d: DrawCtx, x: number, y: number, w: number, h: number, fill = 255) {
  poly(d, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill);
}

/** Full-width horizontal band; the commonest border primitive. */
export function band(d: DrawCtx, y: number, h: number, fill = 255) {
  const c = d.ctx;
  const [, py0] = toPx(d, 0, y + h);
  const [, py1] = toPx(d, 0, y);
  c.fillStyle = gray(fill);
  c.fillRect(0, py0, d.Wp, py1 - py0);
}

/** Tapered blade from base to tip with an optional sideways bend. */
export function taper(
  d: DrawCtx,
  base: [number, number],
  tip: [number, number],
  w: number,
  bend = 0.0,
  fill = 255
) {
  const [bx, by] = base;
  const [tx, ty] = tip;
  const ax = tx - bx;
  const ay = ty - by;
  const L = Math.hypot(ax, ay) || 1e-6;
  const nx = -ay / L;
  const ny = ax / L;
  const mx = (bx + tx) / 2 + nx * bend;
  const my = (by + ty) / 2 + ny * bend;
  poly(
    d,
    [
      [bx + (nx * w) / 2, by + (ny * w) / 2],
      [mx + nx * w * 0.3, my + ny * w * 0.3],
      [tx, ty],
      [mx - nx * w * 0.3, my - ny * w * 0.3],
      [bx - (nx * w) / 2, by - (ny * w) / 2],
    ],
    fill
  );
}

/** Trapezoid blade: independent base and tip widths (Escarcha's taper). */
export function taper2(
  d: DrawCtx,
  base: [number, number],
  tip: [number, number],
  w0: number,
  w1: number,
  fill = 255
) {
  const [bx, by] = base;
  const [tx, ty] = tip;
  const ax = tx - bx;
  const ay = ty - by;
  const L = Math.hypot(ax, ay) || 1e-6;
  const nx = -ay / L;
  const ny = ax / L;
  poly(
    d,
    [
      [bx + (nx * w0) / 2, by + (ny * w0) / 2],
      [tx + (nx * w1) / 2, ty + (ny * w1) / 2],
      [tx - (nx * w1) / 2, ty - (ny * w1) / 2],
      [bx - (nx * w0) / 2, by - (ny * w0) / 2],
    ],
    fill
  );
}

/** Regular n-gon. rot in degrees. */
export function ngon(
  d: DrawCtx,
  cx: number,
  cy: number,
  R: number,
  n: number,
  rot = 0.0,
  fill = 255
) {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const a = ((rot + (360 / n) * k) * Math.PI) / 180;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  poly(d, pts, fill);
}

export function hexagon(d: DrawCtx, cx: number, cy: number, R: number, rot = 0.0, fill = 255) {
  ngon(d, cx, cy, R, 6, rot, fill);
}

/** Outline of a regular n-gon, stroked at width w. */
export function ngonRing(
  d: DrawCtx,
  cx: number,
  cy: number,
  R: number,
  n: number,
  rot: number,
  w: number,
  fill = 255
) {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const a = ((rot + (360 / n) * k) * Math.PI) / 180;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  thickline(d, pts, w, fill);
}

export function hexring(d: DrawCtx, cx: number, cy: number, R: number, rot: number, w: number, fill = 255) {
  ngonRing(d, cx, cy, R, 6, rot, w, fill);
}

/** Star polygon with alternating outer/inner radii. */
export function star(
  d: DrawCtx,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  points: number,
  rot = 0.0,
  fill = 255
) {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? rOuter : rInner;
    const a = ((rot + (180 / points) * k) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  poly(d, pts, fill);
}

/** Stroked circular arc, angles in degrees. */
export function arc(
  d: DrawCtx,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  wMm: number,
  fill = 255
) {
  const steps = Math.max(8, Math.ceil((Math.abs(a1 - a0) / 360) * 128));
  const pts: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const a = ((a0 + ((a1 - a0) * s) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  thickline(d, pts, wMm, fill);
}

/** Filled annulus sector (pie wedge with a hole), angles in degrees. */
export function wedge(
  d: DrawCtx,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  a0: number,
  a1: number,
  fill = 255
) {
  const steps = Math.max(6, Math.ceil((Math.abs(a1 - a0) / 360) * 96));
  const outer: Array<[number, number]> = [];
  const inner: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const a = ((a0 + ((a1 - a0) * s) / steps) * Math.PI) / 180;
    outer.push([cx + rOut * Math.cos(a), cy + rOut * Math.sin(a)]);
    inner.push([cx + rIn * Math.cos(a), cy + rIn * Math.sin(a)]);
  }
  poly(d, [...outer, ...inner.reverse()], fill);
}

/** Read the mask back as a 0..1 field. */
export function maskToField(d: DrawCtx): Float32Array {
  const data = d.ctx.getImageData(0, 0, d.Wp, d.Hp).data;
  const out = new Float32Array(d.Wp * d.Hp);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = data[i] / 255;
  return out;
}
