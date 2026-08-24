// Void-and-cluster blue-noise threshold mask (Ulichney 1993), plus the
// wrapped Poisson-disk point set the "organic" grid is built on.
//
// Why this exists at all: stipple.ts's density dither decides, per grid cell,
// whether a hole is placed. The quality of that decision IS the quality of the
// tone — CLAUDE.md rule 5 puts density ahead of size as the tone carrier, and
// its failure mode is clumping ("clumped dropouts read as mottling rather than
// smooth tone"). So the threshold sequence wants to be blue noise: every
// prefix of it evenly distributed, no low-frequency energy to show up as
// blotches on a flat wall.
//
// The existing `ditherHash` (interleaved gradient noise) stays the default,
// and on the obvious metric it is genuinely fine: measured over 5x5-cell
// windows its density variance is 0.36-0.60x that of random placement, i.e.
// already well-behaved, and a void-and-cluster mask does not beat it there.
//
// What the density metric cannot see is DIRECTION. Measuring the concentration
// of nearest-neighbour bearings instead (0 = isotropic, 1 = every dot aligned
// with its neighbour) finds the hash laying its dots into chains at mid-tone:
//
//   tone        0.15   0.30   0.50   0.70
//   hash        0.258  0.522  0.378  0.058
//   this mask   0.061  0.037  0.013  0.015
//
// A closed-form hash is a lattice function, so at tone values near a simple
// rational it degenerates toward a regular pattern; an optimised sequence has
// no such structure to fall into. On a backlit can those chains read as faint
// scratches across a smooth gradient. That — not variance — is what this file
// buys, and it is why the "Smooth" generator exists at all.
// See tools/measure/dither.mjs and tools/measure/mtf.mjs.
import { mulberry32 } from './rng';

/**
 * Mask edge length. 64x64 is the standard choice and the reason is a cost
 * curve: the void-and-cluster ranking is O(N^2) in the cell count (an O(N)
 * scan for the extremum, N times), so 64x64 is ~17M operations and about
 * 40ms, while 128x128 would be 268M and over a second.
 *
 * The tile then repeats across the grid. On a 65mm can at 1.45mm pitch that
 * is a ~93mm period against a 204mm circumference, i.e. barely over two
 * repeats — which would be a real problem for a *structured* mask (a Bayer
 * matrix would show its crosshatch beating against itself) and is a non-issue
 * for this one. Blue noise has no visible structure to repeat; two abutting
 * copies just read as more noise. Same argument covers the x=0/W wrap, where
 * the tile does not divide the column count evenly: a discontinuity between
 * two noise fields is another noise field. Only *structure* seams show, which
 * is what CLAUDE.md rule 1 is really about.
 */
export const MASK_SIZE = 64;

/**
 * Gaussian energy sigma. Ulichney's filter-design paper settles on ~1.5 cells
 * for the cluster/void detector; smaller stops seeing the neighbourhood at
 * all, larger blurs the extremum out and slows convergence.
 */
const SIGMA = 1.5;
const KERNEL_R = 6; // 4 sigma, past which the weights are < 1e-4

let cached: Float32Array | null = null;

/**
 * The mask, as values in [0,1). Lazily built and memoised — it depends on
 * nothing but the constants above, so one page load pays for it once, and
 * only if a blue-noise sampler is actually selected.
 */
export function blueNoiseMask(): Float32Array {
  if (cached) return cached;
  cached = buildMask();
  return cached;
}

/** Sample the tiled mask at integer grid coordinates. */
export function maskAt(mask: Float32Array, i: number, j: number): number {
  const x = ((i % MASK_SIZE) + MASK_SIZE) % MASK_SIZE;
  const y = ((j % MASK_SIZE) + MASK_SIZE) % MASK_SIZE;
  return mask[y * MASK_SIZE + x];
}

function buildMask(): Float32Array {
  const N = MASK_SIZE;
  const n = N * N;

  // Precomputed wrapped Gaussian kernel, as a flat (2r+1)^2 window.
  const kw = KERNEL_R * 2 + 1;
  const kernel = new Float32Array(kw * kw);
  for (let dy = -KERNEL_R; dy <= KERNEL_R; dy++) {
    for (let dx = -KERNEL_R; dx <= KERNEL_R; dx++) {
      kernel[(dy + KERNEL_R) * kw + (dx + KERNEL_R)] =
        Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
    }
  }

  const on = new Uint8Array(n);
  // Energy is maintained incrementally: toggling one cell splats or unsplats
  // the kernel, which is 169 writes instead of a full 4096-cell reconvolution.
  // Without this the ranking is ~1.4 billion operations rather than ~17
  // million and the lazy build would be unusable.
  const energy = new Float32Array(n);

  const splat = (idx: number, sign: number) => {
    const cx = idx % N;
    const cy = (idx / N) | 0;
    for (let dy = -KERNEL_R; dy <= KERNEL_R; dy++) {
      const y = ((cy + dy) % N + N) % N;
      const krow = (dy + KERNEL_R) * kw;
      const erow = y * N;
      for (let dx = -KERNEL_R; dx <= KERNEL_R; dx++) {
        const x = ((cx + dx) % N + N) % N;
        energy[erow + x] += sign * kernel[krow + (dx + KERNEL_R)];
      }
    }
  };

  const place = (idx: number) => {
    on[idx] = 1;
    splat(idx, 1);
  };
  const clear = (idx: number) => {
    on[idx] = 0;
    splat(idx, -1);
  };

  /** Tightest cluster: the ON cell sitting in the most crowded neighbourhood. */
  const tightestCluster = (): number => {
    let best = -1;
    let bestE = -Infinity;
    for (let i = 0; i < n; i++) {
      if (on[i] && energy[i] > bestE) {
        bestE = energy[i];
        best = i;
      }
    }
    return best;
  };

  /** Largest void: the OFF cell sitting in the emptiest neighbourhood. */
  const largestVoid = (): number => {
    let best = -1;
    let bestE = Infinity;
    for (let i = 0; i < n; i++) {
      if (!on[i] && energy[i] < bestE) {
        bestE = energy[i];
        best = i;
      }
    }
    return best;
  };

  // --- phase 0: an arbitrary but deterministic starting pattern, ~10% on ---
  const rng = mulberry32(0x5eed);
  const initialOnes = Math.max(1, Math.round(n * 0.1));
  {
    let placed = 0;
    while (placed < initialOnes) {
      const idx = (rng() * n) | 0;
      if (on[idx]) continue;
      place(idx);
      placed++;
    }
  }

  // --- phase 1: relax to the "initial binary pattern". Repeatedly move the
  // tightest cluster into the largest void. Converged when the vacated cell IS
  // the largest void, i.e. the move is a no-op and no swap can improve. ---
  for (let guard = 0; guard < n * 4; guard++) {
    const c = tightestCluster();
    clear(c);
    const v = largestVoid();
    if (v === c) {
      place(c);
      break;
    }
    place(v);
  }

  const rank = new Int32Array(n).fill(-1);
  const ibp = Uint8Array.from(on);

  // --- phase 2: ranks initialOnes-1 .. 0. Remove the tightest cluster over
  // and over; the LAST point standing is the most isolated, so it earns rank
  // 0 and is the first dot to appear as tone rises off black. ---
  for (let r = initialOnes - 1; r >= 0; r--) {
    const c = tightestCluster();
    rank[c] = r;
    clear(c);
  }

  // --- phase 3: ranks initialOnes .. n-1. Back to the IBP, then repeatedly
  // fill the largest void.
  //
  // Ulichney's phase 3 is usually described as switching criterion past the
  // halfway point: once ON is the majority the minority class is OFF, so you
  // should be hunting the "tightest cluster of OFF" rather than the "largest
  // void of ON". With a symmetric linear filter on a *toroidal* domain those
  // are provably the same cell, so there is nothing to switch:
  //
  //   conv(OFF)[i] = SUM_j K(i-j)*(1 - ON[j]) = Ktot - conv(ON)[i]
  //
  // and Ktot is identical at every i precisely because the domain wraps (no
  // edge truncation). Maximising conv(OFF) over the OFF cells is therefore
  // exactly minimising conv(ON) over them, which is what largestVoid()
  // already scans for. Writing the branch out would be two identical arms. ---
  for (let i = 0; i < n; i++) {
    if (ibp[i] && !on[i]) place(i);
    else if (!ibp[i] && on[i]) clear(i);
  }
  for (let r = initialOnes; r < n; r++) {
    const idx = largestVoid();
    if (idx < 0) break;
    rank[idx] = r;
    place(idx);
  }

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rank[i] < 0 ? 0 : rank[i]) / n;
  return out;
}

// ---------- organic point set ----------

export interface OrganicPoint {
  x: number;
  y: number;
}

/**
 * Wrapped Poisson-disk point set (Bridson 2007), for the "organic" grid.
 *
 * The reason this is worth having: a hex grid is a lattice, and a lattice
 * beats against any regular structure in the source image — a striped shirt,
 * a brick wall, a picket fence — producing moire that is not in the photo.
 * An irregular point set cannot moire because it has no fundamental frequency
 * to beat with.
 *
 * The hard constraint is CLAUDE.md rule 2: `pitch >= d_max + min_web`. On a
 * hex grid that bound is exact because all six neighbours sit at exactly the
 * pitch. Poisson-disk sampling gives the same guarantee for free and in fact
 * more strongly — `minDist` is a floor on the distance between *every* pair,
 * enforced by construction, and unlike the hex grid it needs no jitter (the
 * set is already irregular), so the nominal bound does not degrade the way
 * jitter degrades the grid's. That makes organic structurally *safer* than
 * hex at the same nominal pitch, not riskier.
 *
 * Wrapping: x is periodic on [0, W). The background grid's column index wraps
 * and the distance test uses the shortest signed dx, so the point set is
 * seamless at x=0/W by construction rather than by inspection.
 */
export function poissonDisk(
  W: number,
  H: number,
  minDist: number,
  seed: number,
  k = 20
): OrganicPoint[] {
  // Memoised, because the tone-response measurement in tonemap.ts calls the
  // sampler ~33 times with the same geometry and only the field value
  // changing. Bridson over ~16k points is a few million distance tests; paying
  // that once per geometry keeps a measurement in the low tens of ms instead
  // of seconds. The result is a pure function of the arguments, so a cache
  // cannot go stale — it only has to be keyed on all of them.
  const key = `${W}|${H}|${minDist}|${seed}|${k}`;
  const hit = poissonCache.get(key);
  if (hit) return hit;
  const built = buildPoissonDisk(W, H, minDist, seed, k);
  // Two entries covers the realistic worst case (a preview grid and an export
  // grid alive at once) without letting a slider drag grow the map unbounded.
  if (poissonCache.size >= 2) poissonCache.delete(poissonCache.keys().next().value!);
  poissonCache.set(key, built);
  return built;
}

const poissonCache = new Map<string, OrganicPoint[]>();

function buildPoissonDisk(
  W: number,
  H: number,
  minDist: number,
  seed: number,
  k: number
): OrganicPoint[] {
  const rng = mulberry32(seed);
  const cell = minDist / Math.SQRT2;
  // ceil, not floor. The grid holds at most one point per cell, which is only
  // sound while the cell DIAGONAL does not exceed minDist — two points in one
  // cell would overwrite each other and the survivor would stop blocking for
  // the other. Rounding the column count down makes cells slightly wider than
  // `cell` and pushes the diagonal just past minDist; rounding up keeps it
  // just under, so the invariant holds with margin.
  const gw = Math.max(1, Math.ceil(W / cell));
  const cw = W / gw; // exact division, so the column wrap is seamless
  const gh = Math.max(1, Math.ceil(H / cell));
  const ch = H / gh;
  const grid = new Int32Array(gw * gh).fill(-1);

  const xs: number[] = [];
  const ys: number[] = [];
  const active: number[] = [];
  const minD2 = minDist * minDist;

  const dxWrap = (a: number, b: number) => {
    let d = b - a;
    if (d > W / 2) d -= W;
    else if (d < -W / 2) d += W;
    return d;
  };

  const fits = (x: number, y: number): boolean => {
    const gx = Math.min(gw - 1, Math.floor(x / cw));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(y / ch)));
    for (let dy = -2; dy <= 2; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= gh) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = ((gx + dx) % gw + gw) % gw;
        const idx = grid[ny * gw + nx];
        if (idx < 0) continue;
        const ddx = dxWrap(xs[idx], x);
        const ddy = y - ys[idx];
        if (ddx * ddx + ddy * ddy < minD2) return false;
      }
    }
    return true;
  };

  const push = (x: number, y: number) => {
    const idx = xs.length;
    xs.push(x);
    ys.push(y);
    const gx = Math.min(gw - 1, Math.floor(x / cw));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(y / ch)));
    // One point per background cell is Bridson's invariant: cell diagonal is
    // minDist, so two points in one cell would be closer than minDist.
    grid[gy * gw + gx] = idx;
    active.push(idx);
  };

  push(rng() * W, rng() * H);

  while (active.length > 0) {
    const ai = (rng() * active.length) | 0;
    const parent = active[ai];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const ang = rng() * Math.PI * 2;
      // annulus [minDist, 2*minDist), sampled area-uniformly
      const rad = Math.sqrt(rng() * 3 + 1) * minDist;
      const x = ((xs[parent] + Math.cos(ang) * rad) % W + W) % W;
      const y = ys[parent] + Math.sin(ang) * rad;
      if (y < 0 || y >= H) continue;
      if (!fits(x, y)) continue;
      push(x, y);
      placed = true;
      break;
    }
    if (!placed) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }

  const out: OrganicPoint[] = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = { x: xs[i], y: ys[i] };
  return out;
}
