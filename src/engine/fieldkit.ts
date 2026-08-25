// Field toolkit: the shared vocabulary every preset is written in.
//
// A "field" is a Float32Array of Wp*Hp tone values in 0..1, row-major, with
// row 0 at the TOP of the canvas (device order). Preset code mostly works in
// millimetres with y up, via ctx.fn() / ctx.mask(); the raw layout only
// matters to the ops in here.
//
// The design idioms encoded here come straight from the CLAUDE.md domain
// rules — moat() is rule 4, dimTexture() is rule 7, bandLimit() is rule 6.
import { DrawCtx, createMask, maskToField } from './draw';
import { dilateMm } from './maxfilter';
import { mulberry32 } from './rng';

export class FieldCtx {
  readonly Wp: number;
  readonly Hp: number;

  constructor(
    readonly W: number,
    readonly H: number,
    readonly PPM: number
  ) {
    this.Wp = Math.round(W * PPM);
    this.Hp = Math.round(H * PPM);
  }

  /** Shortest signed x-distance from cx to x, respecting the wrap. */
  dx(cx: number, x: number): number {
    const W = this.W;
    return ((((x - cx + W / 2) % W) + W) % W) - W / 2;
  }

  /** mm coordinate of a pixel column/row centre (y measured up from bottom). */
  xAt(col: number): number {
    return (col + 0.5) / this.PPM;
  }
  yAt(row: number): number {
    return this.H - (row + 0.5) / this.PPM;
  }

  blank(v = 0): Float32Array {
    const f = new Float32Array(this.Wp * this.Hp);
    if (v !== 0) f.fill(v);
    return f;
  }

  /** Build a field from a function of mm coordinates. */
  fn(f: (x: number, y: number) => number): Float32Array {
    const out = new Float32Array(this.Wp * this.Hp);
    for (let row = 0; row < this.Hp; row++) {
      const y = this.yAt(row);
      const base = row * this.Wp;
      for (let col = 0; col < this.Wp; col++) {
        out[base + col] = f(this.xAt(col), y);
      }
    }
    return out;
  }

  /** Row-separable variant: hoists per-row work out of the column loop. */
  fnRows(makeRow: (y: number) => (x: number) => number): Float32Array {
    const out = new Float32Array(this.Wp * this.Hp);
    for (let row = 0; row < this.Hp; row++) {
      const y = this.yAt(row);
      const g = makeRow(y);
      const base = row * this.Wp;
      for (let col = 0; col < this.Wp; col++) out[base + col] = g(this.xAt(col));
    }
    return out;
  }

  /** Draw a bright mask with the seamless-wrap helpers and read it back. */
  mask(draw: (d: DrawCtx) => void): Float32Array {
    const d = createMask(this.W, this.H, this.PPM);
    draw(d);
    return maskToField(d);
  }

  dilate(f: Float32Array, mm: number): Float32Array {
    return dilateMm(f, this.Wp, this.Hp, mm, this.PPM);
  }

  /**
   * Rule 4 — bright shapes need a dark moat. Carve a dark ring around every
   * bright form in `mask`, then lay the form back on top at `level`.
   * This is the single biggest legibility lever; without it a bright shape
   * sitting in textured background has no figure/ground separation.
   */
  moat(base: Float32Array, mask: Float32Array, moatMm: number, level = 1.0, keep = 0.03): Float32Array {
    const grown = this.dilate(mask, moatMm);
    const out = new Float32Array(base.length);
    for (let i = 0; i < base.length; i++) {
      const ring = Math.min(1, Math.max(0, grown[i] - mask[i]));
      const dimmed = base[i] * (keep + (1 - keep) * (1 - ring));
      out[i] = Math.max(dimmed, mask[i] * level);
    }
    return out;
  }

  /**
   * Rule 7 — busy is not the same as no black. Adds a texture layer at a
   * fraction of the hero brightness (the references use roughly 1/7) so quiet
   * areas get some life without flattening into uniform mid-tone.
   */
  dimTexture(base: Float32Array, tex: Float32Array, level: number, gate?: Float32Array): Float32Array {
    const out = new Float32Array(base.length);
    for (let i = 0; i < base.length; i++) {
      const g = gate ? gate[i] : 1;
      out[i] = Math.max(base[i], tex[i] * level * g);
    }
    return out;
  }
}

/**
 * Integer harmonic count whose wavelength is closest to `wavelengthMm`.
 *
 * This is the resolution of a real tension in rule 1. POSITIONS must be
 * fractions of circumference so the layout wraps. But SIZES must not scale
 * with circumference — the can's height doesn't change when its diameter
 * does, so a sun radius written as `0.09 * W` balloons on a fat can while
 * everything around it stays put, and terrain written with a fixed integer
 * frequency stretches into a flat smear as W grows.
 *
 * The fix for anything periodic is to hold the wavelength constant in mm and
 * let the harmonic COUNT grow with the circumference. Rounding to an integer
 * keeps the wrap seamless; a non-integer harmonic would not close on itself.
 *
 * Sizes that aren't periodic (radii, lengths, widths) should simply be mm
 * constants — see the reference ports, which do exactly that.
 */
export function harmonic(W: number, wavelengthMm: number): number {
  return Math.max(1, Math.round(W / Math.max(wavelengthMm, 1e-6)));
}

/** Repeat count for a tessellation with a target cell width in mm. */
export function repeatsFor(W: number, cellMm: number): number {
  return Math.max(2, Math.round(W / Math.max(cellMm, 1e-6)));
}

/**
 * Size for a hero form: its authored mm size, but never so large it overruns
 * the can it has to live on.
 *
 * The governing rule is "don't scale the main drawing, add more of it" — a
 * wider can should get MORE motifs at the authored size, not one stretched
 * one (see motifCount). The clamp exists only for the other end: on a very
 * small can (a 10mm tube is barely 31mm around) an authored size would wrap
 * over itself, so it has to give way.
 */
export function heroSize(
  W: number,
  H: number,
  authoredMm: number,
  maxFracW = 0.34,
  maxFracH = 0.42
): number {
  return Math.min(authoredMm, W * maxFracW, H * maxFracH);
}

/**
 * How many copies of a motif to place around the wrap, given the footprint
 * each one wants. Grows with circumference so a wider can gains motifs rather
 * than dead space, and never drops below 1.
 */
export function motifCount(W: number, footprintMm: number, min = 1): number {
  return Math.max(min, Math.round(W / Math.max(footprintMm, 1e-6)));
}

/**
 * Seam-safe per-motif variation, in -1..1.
 *
 * Use this instead of `k % n` for ANY property that varies from motif to
 * motif — height, size, facing, tilt.
 *
 * The trap: on a wrapped canvas the last motif and the first are NEIGHBOURS.
 * `k % 3` over 4 motifs gives 0,1,2,0 — so motif 3 and motif 0 get identical
 * treatment and sit right next to each other across the seam, which reads as
 * an obvious duplicated pair. (Found exactly this way: two balloons at the
 * same height ended up adjacent over the seam.) It only looks correct when
 * `count` happens to be a multiple of `n`, and count changes with diameter,
 * so it will eventually break at some can size.
 *
 * Driving the variation with an integer harmonic of the angle around the can
 * is continuous across the seam by construction, at every diameter.
 */
export function wrapVary(k: number, count: number, harmonics = 1, phase = 0): number {
  return Math.sin(2 * Math.PI * Math.max(1, Math.round(harmonics)) * (k / Math.max(count, 1)) + phase);
}

// ---------- elementwise ops ----------

export function maxInto(a: Float32Array, b: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i++) if (b[i] > a[i]) a[i] = b[i];
  return a;
}

export function addInto(a: Float32Array, b: Float32Array, scale = 1): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] += b[i] * scale;
  return a;
}

export function mulInto(a: Float32Array, b: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] *= b[i];
  return a;
}

/** a *= (1 - b*strength) — the "carve darkness where b is bright" op. */
export function subtractInto(a: Float32Array, b: Float32Array, strength = 1): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] *= 1 - Math.min(1, Math.max(0, b[i])) * strength;
  return a;
}

export function scaleInto(a: Float32Array, s: number): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] *= s;
  return a;
}

export function clamp01(a: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] = a[i] < 0 ? 0 : a[i] > 1 ? 1 : a[i];
  return a;
}

export function gammaInto(a: Float32Array, g: number): Float32Array {
  if (g === 1) return a;
  for (let i = 0; i < a.length; i++) a[i] = Math.pow(Math.min(1, Math.max(0, a[i])), g);
  return a;
}

/** Difference of a mask and its own dilation: a rim just outside the form. */
export function rim(ctx: FieldCtx, mask: Float32Array, mm: number): Float32Array {
  const grown = ctx.dilate(mask, mm);
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = Math.min(1, Math.max(0, grown[i] - mask[i]));
  return out;
}

// ---------- separable box blur (wrapping in x, clamping in y) ----------

export function boxBlur(
  src: Float32Array,
  Wp: number,
  Hp: number,
  radiusX: number,
  radiusY = radiusX
): Float32Array {
  let cur = src;
  if (radiusX > 0) {
    const out = new Float32Array(Wp * Hp);
    const win = radiusX * 2 + 1;
    for (let row = 0; row < Hp; row++) {
      const base = row * Wp;
      let acc = 0;
      for (let k = -radiusX; k <= radiusX; k++) acc += cur[base + (((k % Wp) + Wp) % Wp)];
      for (let col = 0; col < Wp; col++) {
        out[base + col] = acc / win;
        const outIdx = ((col - radiusX) % Wp + Wp) % Wp;
        const inIdx = ((col + radiusX + 1) % Wp + Wp) % Wp;
        acc += cur[base + inIdx] - cur[base + outIdx];
      }
    }
    cur = out;
  }
  if (radiusY > 0) {
    const out = new Float32Array(Wp * Hp);
    const win = radiusY * 2 + 1;
    const clampRow = (r: number) => (r < 0 ? 0 : r >= Hp ? Hp - 1 : r);
    for (let col = 0; col < Wp; col++) {
      let acc = 0;
      for (let k = -radiusY; k <= radiusY; k++) acc += cur[clampRow(k) * Wp + col];
      for (let row = 0; row < Hp; row++) {
        out[row * Wp + col] = acc / win;
        acc += cur[clampRow(row + radiusY + 1) * Wp + col] - cur[clampRow(row - radiusY) * Wp + col];
      }
    }
    cur = out;
  }
  return cur === src ? src.slice() : cur;
}

/**
 * Edge-aware smoothing (He, Sun & Tang's guided filter, with the field as its
 * own guide), for use as the reference in a local-contrast pass.
 *
 * Why not just boxBlur: unsharp masking against a BLURRED reference haloes.
 * The reference bleeds the bright side of an edge into the dark side, so the
 * difference `f - reference` overshoots on one side and undershoots on the
 * other, and a bright subject picks up a dark rim and a dark background picks
 * up a bright one. At the ~30mm radius photo.ts uses for subject/background
 * normalisation the halo is 30mm wide too, which is larger than rule 3's whole
 * legible-feature floor.
 *
 * A guided filter smooths WITHIN regions but not ACROSS edges: per window it
 * fits a linear model of the output on the guide, and `a = var/(var+eps)`
 * makes that fit approach the identity wherever the window straddles real
 * structure (high variance) and approach the plain mean where it does not.
 * Cost is four box blurs instead of one, all O(n) running sums.
 *
 * `eps` is in units of tone VARIANCE, so it is comparable across images:
 * 0.01 means a window whose tone spread is more than ~0.1 counts as an edge.
 */
export function guidedSelf(
  src: Float32Array,
  Wp: number,
  Hp: number,
  radius: number,
  eps: number
): Float32Array {
  const n = Wp * Hp;
  const meanI = boxBlur(src, Wp, Hp, radius, radius);
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) sq[i] = src[i] * src[i];
  const meanII = boxBlur(sq, Wp, Hp, radius, radius);
  // reuse sq for `a` and meanII for `b`; both are dead after this loop, and at
  // 1.9M floats a field is 7.4MB, so not allocating two more matters
  const a = sq;
  const b = meanII;
  for (let i = 0; i < n; i++) {
    const varI = Math.max(0, meanII[i] - meanI[i] * meanI[i]);
    const ai = varI / (varI + eps);
    a[i] = ai;
    b[i] = meanI[i] * (1 - ai);
  }
  const meanA = boxBlur(a, Wp, Hp, radius, radius);
  const meanB = boxBlur(b, Wp, Hp, radius, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = meanA[i] * src[i] + meanB[i];
  return out;
}

/**
 * Rule 6 — band-limit before sampling. Anything finer than the hole grid
 * becomes aliasing, not detail, so blur to roughly the grid cell before the
 * stipple samples it. (Sharpening at this scale actively hurts.)
 */
export function bandLimit(
  src: Float32Array,
  Wp: number,
  Hp: number,
  pitchMm: number,
  ppm: number
): Float32Array {
  const r = Math.max(1, Math.round((pitchMm * ppm) / 2));
  return boxBlur(src, Wp, Hp, r, r);
}

// ---------- procedural texture generators ----------

/** Seamless-in-x value noise, smoothstep-interpolated. */
export function valueNoise(
  ctx: FieldCtx,
  cellsX: number,
  cellsY: number,
  seed: number
): Float32Array {
  const rng = mulberry32(seed);
  const gx = Math.max(2, Math.round(cellsX));
  const gy = Math.max(2, Math.round(cellsY));
  const grid = new Float32Array((gy + 1) * gx);
  for (let j = 0; j <= gy; j++) {
    for (let i = 0; i < gx; i++) grid[j * gx + i] = rng();
  }
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return ctx.fn((x, y) => {
    const fx = (x / ctx.W) * gx;
    const fy = ((ctx.H - y) / ctx.H) * gy;
    const i0 = Math.floor(fx);
    const j0 = Math.min(gy - 1, Math.floor(fy));
    const tx = smooth(fx - i0);
    const ty = smooth(fy - j0);
    const i0w = ((i0 % gx) + gx) % gx;
    const i1w = (i0w + 1) % gx;
    const a = grid[j0 * gx + i0w];
    const b = grid[j0 * gx + i1w];
    const c = grid[(j0 + 1) * gx + i0w];
    const dd = grid[(j0 + 1) * gx + i1w];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + dd * tx) * ty;
  });
}

/** Fractal sum of valueNoise octaves. */
export function fbm(
  ctx: FieldCtx,
  cellsX: number,
  cellsY: number,
  octaves: number,
  seed: number,
  gain = 0.5
): Float32Array {
  const out = new Float32Array(ctx.Wp * ctx.Hp);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(ctx, cellsX * Math.pow(2, o), cellsY * Math.pow(2, o), seed + o * 977);
    addInto(out, layer, amp);
    norm += amp;
    amp *= gain;
  }
  return scaleInto(out, 1 / Math.max(norm, 1e-6));
}

export interface CrackOptions {
  seeds: number;
  widthLo: number;
  widthHi: number;
  seed: number;
  /** relative seed density as a function of mm coords; default uniform */
  density?: (x: number, y: number) => number;
  yLo?: number;
  yHi?: number;
}

/**
 * Wrapped Voronoi crack network: brightness follows (d2 - d1), i.e. the
 * cell *boundaries* light up. This is Escarcha's crack_field. Uses a
 * spatial grid over the seeds so cost is ~O(pixels) rather than the
 * reference's O(pixels x seeds) brute force.
 */
export function crackField(ctx: FieldCtx, opts: CrackOptions): Float32Array {
  const { W, H } = ctx;
  const rng = mulberry32(opts.seed);
  const yLo = opts.yLo ?? 0;
  const yHi = opts.yHi ?? H;
  const density = opts.density;

  const sx: number[] = [];
  const sy: number[] = [];
  let guard = 0;
  while (sx.length < opts.seeds && guard < opts.seeds * 400) {
    guard++;
    const x = rng() * W;
    const y = yLo + rng() * (yHi - yLo);
    if (density) {
      if (rng() > density(x, y)) continue;
    }
    sx.push(x);
    sy.push(y);
  }
  const n = sx.length;
  if (n < 2) return ctx.blank(0);

  // Bucket seeds at roughly the mean seed spacing, then per pixel expand
  // ring by ring until the next ring cannot possibly beat the current second
  // nearest. Correct regardless of density variation, and ~1 seed per bucket
  // keeps the per-pixel test count small (a fixed wide window was 4x slower).
  const cell = Math.max(W / 200, Math.sqrt((W * Math.max(yHi - yLo, 1)) / Math.max(n, 1)));
  const nbx = Math.max(1, Math.floor(W / cell));
  const cw = W / nbx;
  const nby = Math.max(1, Math.ceil(H / cell));
  const ch = H / nby;
  const buckets: number[][] = Array.from({ length: nbx * nby }, () => []);
  for (let k = 0; k < n; k++) {
    const bx = Math.min(nbx - 1, Math.floor(sx[k] / cw));
    const by = Math.min(nby - 1, Math.max(0, Math.floor(sy[k] / ch)));
    buckets[by * nbx + bx].push(k);
  }
  const maxRing = Math.max(nbx, nby);

  return ctx.fn((x, y) => {
    let d1 = Infinity;
    let d2 = Infinity;
    const bx0 = Math.floor(x / cw);
    const by0 = Math.floor(y / ch);

    const testBucket = (bx: number, by: number) => {
      if (by < 0 || by >= nby) return;
      const bucket = buckets[by * nbx + (((bx % nbx) + nbx) % nbx)];
      for (let bi = 0; bi < bucket.length; bi++) {
        const k = bucket[bi];
        const ddx = ctx.dx(sx[k], x);
        const ddy = y - sy[k];
        const dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd < d1) {
          d2 = d1;
          d1 = dd;
        } else if (dd < d2) {
          d2 = dd;
        }
      }
    };

    testBucket(bx0, by0);
    for (let ring = 1; ring <= maxRing; ring++) {
      // nothing in the next ring can be closer than this
      const reach = (ring - 1) * Math.min(cw, ch);
      if (isFinite(d2) && reach > d2) break;
      for (let dbx = -ring; dbx <= ring; dbx++) {
        testBucket(bx0 + dbx, by0 - ring);
        testBucket(bx0 + dbx, by0 + ring);
      }
      for (let dby = -ring + 1; dby <= ring - 1; dby++) {
        testBucket(bx0 - ring, by0 + dby);
        testBucket(bx0 + ring, by0 + dby);
      }
    }
    if (!isFinite(d2)) return 0;
    const t = Math.min(Math.max(1.0 - (y - 10.0) / 110.0, 0), 1);
    const wid = opts.widthLo + (opts.widthHi - opts.widthLo) * t;
    return Math.min(Math.max(1.0 - (d2 - d1) / wid, 0), 1);
  });
}

/** Guilloché / rose-engine line texture: thin interference curves. */
export function guilloche(
  ctx: FieldCtx,
  lines: number,
  freq: number,
  amp: number,
  thicknessMm: number,
  phase = 0
): Float32Array {
  const t = thicknessMm;
  return ctx.fn((x, y) => {
    let best = 0;
    for (let k = 0; k < lines; k++) {
      const base = (ctx.H * (k + 0.5)) / lines;
      const yc =
        base +
        amp * Math.sin((2 * Math.PI * freq * x) / ctx.W + phase + k * 0.7) +
        amp * 0.5 * Math.sin((2 * Math.PI * freq * 2.3 * x) / ctx.W + phase * 1.7 + k);
      const dist = Math.abs(y - yc);
      if (dist < t) best = Math.max(best, 1 - dist / t);
    }
    return best;
  });
}

/** Scattered points stamped as small gaussian blobs (stars, plankton, bubbles). */
export interface SpeckOptions {
  count: number;
  seed: number;
  sizeLo: number;
  sizeHi: number;
  yLo?: number;
  yHi?: number;
  /** acceptance probability in 0..1 as a function of mm coords */
  accept?: (x: number, y: number) => number;
  /** y centre-line for a band distribution, e.g. a milky way */
  bandCenter?: (x: number) => number;
  bandSigma?: number;
}

export function specks(ctx: FieldCtx, opts: SpeckOptions): Float32Array {
  const out = ctx.blank(0);
  const rng = mulberry32(opts.seed);
  const gauss = () => {
    const u1 = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
  };
  const yLo = opts.yLo ?? 0;
  const yHi = opts.yHi ?? ctx.H;
  let placed = 0;
  let guard = 0;
  while (placed < opts.count && guard < opts.count * 500) {
    guard++;
    const x = rng() * ctx.W;
    let y: number;
    if (opts.bandCenter) y = opts.bandCenter(x) + gauss() * (opts.bandSigma ?? 7);
    else y = yLo + rng() * (yHi - yLo);
    if (y < yLo || y > yHi) continue;
    if (opts.accept && rng() > opts.accept(x, y)) continue;

    const size = opts.sizeLo + rng() * (opts.sizeHi - opts.sizeLo);
    const varDenom = size * size;
    const reach = size * 2.8;
    const c0 = Math.round(x * ctx.PPM);
    const r0 = Math.round((ctx.H - y) * ctx.PPM);
    const span = Math.ceil(reach * ctx.PPM);
    for (let dr = -span; dr <= span; dr++) {
      const row = r0 + dr;
      if (row < 0 || row >= ctx.Hp) continue;
      const py = ctx.yAt(row);
      const dy = py - y;
      for (let dc = -span; dc <= span; dc++) {
        let col = (c0 + dc) % ctx.Wp;
        if (col < 0) col += ctx.Wp;
        const ddx = ctx.dx(x, ctx.xAt(col));
        const v = Math.exp(-(ddx * ddx + dy * dy) / varDenom);
        const idx = row * ctx.Wp + col;
        if (v > out[idx]) out[idx] = v;
      }
    }
    placed++;
  }
  return out;
}
