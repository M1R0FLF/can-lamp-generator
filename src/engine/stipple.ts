// Hex-grid stipple sampler. Implements the three tone-carrying modes from
// CLAUDE.md rule 5 (density carries tone, not size):
//
//   FM     - fixed hole size, density dithered. Background texture.
//   AM     - every grid point above threshold gets a hole, size varies as
//            tone^gamma. gamma 0.5 makes open area linear in tone, which is
//            the principled default; the reference presets use their own
//            tuned exponents (Mango 0.85, Escarcha 1.0) and keep them.
//   HYBRID - full density above `knee`, density falls off below it, and size
//            varies too. The reference Escarcha behaviour; best general default.
//
// pitch >= d_max + min_web is the caller's job to verify against the measured
// holes (rule 2) — with jitter the nominal bound degrades, so minweb.ts
// measures the real thing.
//
// ---------------------------------------------------------------------------
// `dither` is a separate axis from `mode`
// ---------------------------------------------------------------------------
// `mode` above decides how tone becomes density-and-size. `dither` decides HOW
// the density decision is made at each grid cell, and keeping the two separate
// is what lets the reference presets keep their exact tuning while the user
// picks a look:
//
//   'hash'      - the reference generators' screen hash (interleaved gradient
//                 noise). The default, and the pre-existing code path.
//   'blue'      - a void-and-cluster mask (bluenoise.ts). Same tone, but
//                 without the hash's tendency to lay dots into chains.
//   'diffusion' - serpentine error diffusion. The only one of the three that
//                 reproduces the requested density *exactly* rather than
//                 statistically, which is where its detail advantage comes
//                 from.
//
// The default is 'hash', reproduced hole-for-hole (see
// tools/measure/baseline.mjs — every preset's checksum is unchanged). A new
// axis must never silently restyle a tuned preset.
//
// An off-grid `grid` axis was also built here — a wrapped Poisson-disk set, for
// a hand-stippled look that cannot moire against regular structure in a photo.
// It worked and was dropped on the look; CLAUDE.md rule 10 records what it
// measured and what was worth keeping from it.
import { mulberry32 } from './rng';
import { blueNoiseMask, maskAt } from './bluenoise';

export type StippleMode = 'fm' | 'am' | 'hybrid';
export type DitherKind = 'hash' | 'blue' | 'diffusion';

export interface Hole {
  x: number;
  y: number;
  r: number;
}

export interface StippleParams {
  pitchMm: number;
  dMin: number;
  dMax: number;
  jitter: number;
  thresh: number;
  mode: StippleMode;
  /** size exponent for AM/HYBRID; 0.5 => open area linear in tone */
  gamma: number;
  /** HYBRID: below this tone, density starts dropping out */
  knee: number;
  /** FM: the one hole size used everywhere */
  fixedDiameterMm: number;
  seed: number;
  /** density decision rule. 'hash' is the reference screen hash. */
  dither: DitherKind;
}

export const DEFAULT_STIPPLE: StippleParams = {
  pitchMm: 1.45,
  dMin: 0.28,
  dMax: 0.52,
  jitter: 0.15,
  thresh: 0.13,
  mode: 'hybrid',
  gamma: 0.5,
  knee: 0.42,
  fixedDiameterMm: 0.35,
  seed: 3,
  dither: 'hash',
};

export interface StippleResult {
  holes: Hole[];
  pitch: number;
  rows: number;
  cols: number;
}

function mod1(v: number): number {
  return v - Math.floor(v);
}

/**
 * Low-discrepancy per-cell dither value in [0,1). These constants are the
 * reference generators' verbatim screen hash (interleaved-gradient-noise
 * style); it yields a blue-noise-ish spatial distribution, which matters
 * because clumped dropouts read as mottling rather than smooth tone.
 */
function ditherHash(i: number, j: number): number {
  return mod1(52.9829189 * mod1(0.06711056 * i + 0.00583715 * j));
}

/**
 * Error-diffusion weights over the hex lattice.
 *
 * Floyd-Steinberg's 7/3/5/1 assumes a square grid with three cells on the row
 * below. A hex row is offset by half a pitch, so a cell has only TWO nearest
 * neighbours below and they sit symmetrically at +/-0.5 pitch. An even split
 * between them is therefore the geometrically honest choice, and the forward
 * in-row weight keeps Floyd-Steinberg's 7/16.
 */
const ED_FORWARD = 7 / 16;
const ED_BELOW = 4.5 / 16;

/**
 * Threshold modulation depth, per Zhou & Fang's improvement on Ostromoukhov.
 *
 * Plain error diffusion produces "worms": in near-flat areas the error walks in
 * a correlated way and the dots line up into chains. On a backlit can that
 * reads as scratches. Jittering the decision threshold with the blue-noise
 * mask decorrelates it, at the cost of some of the detail advantage that is
 * the whole reason to use error diffusion — so the depth is a measured
 * trade-off, not a taste. Nearest-neighbour directional concentration at
 * mid-tone (lower is better) against modulation transfer at 48 cycles per
 * circumference, i.e. ~4mm features (higher is better):
 *
 *   depth   aniso@0.5   MTF@48c
 *   0.12      0.294      0.959
 *   0.40      0.153      0.897     <- chosen
 *   0.60      0.095      0.816
 *
 * 0.40 halves the chaining while keeping MTF well clear of the mask dithers
 * (hash 0.796, blue 0.785). Past it the curve turns: 0.60 buys little more
 * isotropy and gives back most of the detail, degrading error diffusion back
 * toward ordinary mask dithering exactly as the theory says it should.
 */
const ED_THRESHOLD_MOD = 0.4;

export function stipple(
  F: Float32Array,
  W: number,
  H: number,
  Wp: number,
  Hp: number,
  PPM: number,
  params: Partial<StippleParams> = {}
): StippleResult {
  const p0 = { ...DEFAULT_STIPPLE, ...params };
  const { pitchMm, dMin, dMax, jitter, thresh, mode, gamma, knee, fixedDiameterMm, dither } = p0;

  const cols = Math.max(1, Math.round(W / pitchMm));
  const p = W / cols;
  const rowsp = (p * Math.sqrt(3)) / 2;
  const rows = Math.max(1, Math.round(H / rowsp));

  // ---- pass 1: candidate points and the tone sampled at each ----
  //
  // Split from the decision pass because error diffusion cannot be made in
  // scan order at the same time as sampling: it needs every cell's demand
  // before it can distribute the first cell's error. The hash and blue paths
  // do not need two passes, but sharing one structure is what keeps them
  // provably in step — and pass 1 draws from the RNG in exactly the reference
  // order (two calls per cell, before any culling test), so the 'hash' path
  // stays hole-for-hole identical to the single-pass version it replaces.
  const rng = mulberry32(p0.seed);
  // Float64, not Float32: these are hole coordinates in mm and they go
  // straight into the exported SVG. Rounding them to single precision moves
  // every hole by a few nanometres, which is invisible on the can but makes
  // the sampler no longer bit-identical to the reference path — and
  // bit-identical is the property that proves the new axis did not restyle a
  // tuned preset.
  const count = rows * cols;
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  for (let j = 0; j < rows; j++) {
    const yRow = (j + 0.5) * rowsp;
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      let x = (i + (j % 2 ? 0.5 : 0.0)) * p + p * 0.5;
      x += (rng() - 0.5) * 2 * jitter * p;
      cx[k] = x;
      cy[k] = yRow + (rng() - 0.5) * 2 * jitter * rowsp;
    }
  }

  // tone per candidate, and whether it is eligible at all
  const cf = new Float32Array(count);
  const live = new Uint8Array(count);
  const cxw = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const y = cy[k];
    if (!(y > 0.3 && y < H - 0.3)) continue;
    const xw = ((cx[k] % W) + W) % W;
    cxw[k] = xw;
    const px = Math.min(Wp - 1, Math.max(0, Math.floor(xw * PPM)));
    const py = Math.min(Hp - 1, Math.max(0, Math.floor((H - y) * PPM)));
    const f = F[py * Wp + px];
    if (f <= thresh) continue;
    cf[k] = f;
    live[k] = 1;
  }

  // ---- demand: the fraction of candidates that should carry a hole ----
  //
  // One signal for all three dithers, so switching dither cannot change what
  // tone is being asked for — only how faithfully it is delivered.
  const demand = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    if (!live[k]) continue;
    const f = cf[k];
    if (mode === 'fm') {
      // Reproduces the reference test `f > 0.78 || f > 0.04 + 0.84*t` exactly:
      // that fires when t < (f-0.04)/0.84, with a hard override to full
      // density above 0.78.
      demand[k] = f > 0.78 ? 1 : Math.min(1, Math.max(0, (f - 0.04) / 0.84));
    } else if (mode === 'hybrid') {
      demand[k] = Math.min(1, f / Math.max(knee, 1e-6));
    } else {
      // AM carries tone entirely in hole size, so every eligible point emits
      // and there is no density decision for a dither to make.
      demand[k] = 1;
    }
  }

  // ---- pass 2: decide ----
  const on = new Uint8Array(count);
  if (mode === 'am') {
    for (let k = 0; k < count; k++) on[k] = live[k];
  } else if (dither === 'diffusion') {
    diffuse(on, demand, live, rows, cols);
  } else {
    const mask = dither === 'blue' ? blueNoiseMask() : null;
    for (let k = 0; k < count; k++) {
      if (!live[k]) continue;
      const i = k % cols;
      const j = (k / cols) | 0;
      const t = mask ? maskAt(mask, i, j) : ditherHash(i, j);
      if (t < demand[k]) on[k] = 1;
    }
  }

  // ---- emit ----
  const holes: Hole[] = [];
  const fixedR = fixedDiameterMm / 2;
  for (let k = 0; k < count; k++) {
    if (!on[k]) continue;
    if (mode === 'fm') {
      holes.push({ x: cxw[k], y: H - cy[k], r: fixedR });
      continue;
    }
    const g = (cf[k] - thresh) / (1 - thresh);
    const d = dMin + (dMax - dMin) * Math.pow(g, gamma);
    holes.push({ x: cxw[k], y: H - cy[k], r: d / 2 });
  }

  return { holes, pitch: p, rows, cols };
}

/**
 * Serpentine error diffusion over the hex lattice.
 *
 * Why it is worth a second sampler: a mask dither decides each cell against a
 * fixed threshold, so the density it produces is only correct *on average over
 * a neighbourhood*, and at ~140x113 samples for a whole photograph the
 * neighbourhood is most of a face. Error diffusion instead carries the
 * rounding error of every decision forward, so the count is right over any
 * region large enough to hold a couple of dots. That is the difference between
 * an eye that is the right brightness and an eye that is one dot too dark.
 */
function diffuse(
  on: Uint8Array,
  demand: Float32Array,
  live: Uint8Array,
  rows: number,
  cols: number
): void {
  const err = new Float32Array(on.length);
  const mask = blueNoiseMask();
  for (let j = 0; j < rows; j++) {
    const ltr = j % 2 === 0;
    // Which two cells in row j+1 are the nearest neighbours depends on the row
    // stagger: an even row sits at offset 0 and the row below at +0.5 pitch,
    // so cells i and i-1 straddle it; an odd row is the mirror image.
    const belowB = j % 2 ? 1 : -1;
    for (let step = 0; step < cols; step++) {
      const i = ltr ? step : cols - 1 - step;
      const k = j * cols + i;
      // A culled cell is a hard black (or off the wall edge). It takes no dot
      // and propagates nothing: `thresh` exists precisely to protect real
      // blacks (rule 5), so letting accumulated error leak a dot into them
      // would defeat it.
      if (!live[k]) continue;

      const v = demand[k] + err[k];
      const thr = 0.5 + ED_THRESHOLD_MOD * (maskAt(mask, i, j) - 0.5);
      const lit = v >= thr;
      if (lit) on[k] = 1;
      const e = v - (lit ? 1 : 0);
      if (e === 0) continue;

      // The forward in-row neighbour wraps with the cylinder, so on the last
      // cell of a row it is one that has already been decided. Hand its share
      // to the row below rather than dropping it, which keeps the error
      // conserved and the aggregate density exact.
      const wrapsOntoDone = ltr ? i === cols - 1 : i === 0;
      let belowShare = ED_BELOW;
      if (wrapsOntoDone) {
        belowShare += ED_FORWARD / 2;
      } else {
        const fi = ltr ? i + 1 : i - 1;
        err[j * cols + fi] += e * ED_FORWARD;
      }

      if (j + 1 < rows) {
        const base = (j + 1) * cols;
        err[base + i] += e * belowShare;
        err[base + ((((i + belowB) % cols) + cols) % cols)] += e * belowShare;
      }
    }
  }
}
