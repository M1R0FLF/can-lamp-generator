// Separable square max-filter (dilation), standing in for PIL's
// ImageFilter.MaxFilter. Used for the dark-moat trick: dilate a bright mask,
// subtract the mask itself, and you have a ring of "moat" around every form
// (CLAUDE.md rule 4 / the reference generators' dil() calls).
//
// Uses a monotonic descending deque so cost is O(1) amortized per pixel
// regardless of kernel size — a naive O(k) scan made the 15px and 25px
// dilations the dominant cost of a whole regeneration.
//
// X wraps circularly (seamless-wrap requirement) by padding each row with
// its own opposite edge; Y clamps to the edge.

function maxDeque1D(
  src: Float32Array,
  srcOffset: number,
  srcStride: number,
  n: number,
  k: number,
  wrap: boolean,
  out: Float32Array,
  outOffset: number,
  outStride: number,
  padBuf: Float32Array,
  idxBuf: Int32Array
) {
  const radius = k >> 1;
  const padded = n + 2 * radius;

  for (let i = 0; i < padded; i++) {
    let j = i - radius;
    if (wrap) j = ((j % n) + n) % n;
    else j = j < 0 ? 0 : j >= n ? n - 1 : j;
    padBuf[i] = src[srcOffset + j * srcStride];
  }

  let head = 0;
  let tail = 0;
  for (let i = 0; i < padded; i++) {
    const v = padBuf[i];
    while (tail > head && padBuf[idxBuf[tail - 1]] <= v) tail--;
    idxBuf[tail++] = i;
    const windowStart = i - k + 1;
    if (idxBuf[head] < windowStart) head++;
    if (i >= k - 1) {
      out[outOffset + (i - k + 1) * outStride] = padBuf[idxBuf[head]];
    }
  }
}

export function maxFilter2D(src: Float32Array, Wp: number, Hp: number, k: number): Float32Array {
  if (k <= 1) return src.slice();
  const kk = k % 2 === 0 ? k + 1 : k;
  const radius = kk >> 1;

  const tmp = new Float32Array(Wp * Hp);
  const maxDim = Math.max(Wp, Hp);
  const padBuf = new Float32Array(maxDim + 2 * radius);
  const idxBuf = new Int32Array(maxDim + 2 * radius);

  for (let row = 0; row < Hp; row++) {
    maxDeque1D(src, row * Wp, 1, Wp, kk, true, tmp, row * Wp, 1, padBuf, idxBuf);
  }
  const out = new Float32Array(Wp * Hp);
  for (let col = 0; col < Wp; col++) {
    maxDeque1D(tmp, col, Wp, Hp, kk, false, out, col, Wp, padBuf, idxBuf);
  }
  return out;
}

/** Dilate by a radius given in millimetres. */
export function dilateMm(src: Float32Array, Wp: number, Hp: number, mm: number, ppm: number): Float32Array {
  const k = Math.max(1, Math.round(mm * ppm));
  return maxFilter2D(src, Wp, Hp, k);
}
