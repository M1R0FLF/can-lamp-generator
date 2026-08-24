// Measured open-area response of the sampler — verification infrastructure,
// not a shipped code path.
//
// This started out as an attempt to implement the TODO that photo.ts's
// DEFAULT_PHOTO_PARAMS comment ends with: stop guessing at the sampler's
// exponent, measure the open-area response curve, and invert it as a printer
// linearisation lookup so that tone stops being coupled to sampler tuning.
//
// Measuring it settled the question the other way, which is why only the
// measurement survives. Normalised response, tone 0..1 in 1/8 steps:
//
//   hash        0.000 0.059 0.148 0.258 0.386 0.530 0.689 0.864 1.000
//   blue        0.000 0.059 0.148 0.258 0.386 0.530 0.691 0.865 1.000
//   diffusion   0.000 0.058 0.148 0.258 0.386 0.530 0.690 0.865 1.000
//   organic     0.000 0.058 0.146 0.254 0.381 0.527 0.689 0.866 1.000  (*)
//   Draft       0.000 0.056 0.144 0.252 0.379 0.524 0.685 0.862 1.000
//   Ultra       0.000 0.054 0.140 0.248 0.375 0.520 0.682 0.859 1.000
//
// Two things fall out of that table:
//
// (*) the off-grid pattern that measured this row was later dropped on its look
// (CLAUDE.md rule 10); the row is kept because it is the strongest evidence for
// point 1 — invariance holds even across a completely different point layout.
//
// 1. The SHAPE is invariant — within 3% across every grid, dither and quality
//    tuple. So the worry that motivated the linearisation (that adding grid
//    and dither axes to stipple.ts would make "pick a different look" mean
//    "re-expose the image") is simply not real. Only the maximum changes
//    (7.2% open at Draft to 15.1% at Ultra), and that is honest physics: more
//    and finer holes pass more light.
//
// 2. The existing hard-coded constant is already right. At tone 0.5 the
//    sampler delivers 0.386, an exponent of log(0.386)/log(0.5) = 1.373;
//    DEFAULT_PHOTO_PARAMS.gamma of 1.6 therefore lands the end-to-end
//    exponent at 1.6 x 1.373 = 2.197 against its stated 2.2 target. That is
//    0.15% out. The comment that guessed 1.37 guessed correctly.
//
// So a linearisation pass would have replaced a verified-correct tuned
// constant with a computed one, for no visible change — which is the
// "clean it up and round it off" move CLAUDE.md's reference-implementation
// note exists to forbid. What is worth keeping is the instrument, so the next
// person to touch `knee`, `mode` or the size curve can re-check the exponent
// in one command instead of re-deriving it.
import { StippleParams, stipple } from '../../src/engine/stipple';

/** Open-area response of one sampler configuration. */
export interface ToneResponse {
  /** open area (fraction of the wall) at tone i/(steps-1) */
  open: Float32Array;
  /** open area at tone 1, i.e. the most light this configuration can pass */
  maxOpen: number;
}

const RESPONSE_STEPS = 33;

/**
 * Measure open area as a function of requested tone, for one exact sampler
 * configuration.
 *
 * The 1x1 field is not a trick so much as an exploitation of a property
 * stipple() already has: it clamps the sampled pixel index into range, so a
 * single-pixel field is read by every candidate point regardless of geometry.
 * That means the measurement runs the REAL sampler — real grid, real jitter,
 * real dither, real size curve — rather than a model of it, which is the whole
 * point. A model is what we are trying to stop relying on.
 */
export function measureResponse(
  params: StippleParams,
  W: number,
  H: number,
  PPM: number,
  steps = RESPONSE_STEPS
): ToneResponse {
  const open = new Float32Array(steps);
  const one = new Float32Array(1);
  const area = W * H;
  for (let s = 0; s < steps; s++) {
    one[0] = s / (steps - 1);
    const r = stipple(one, W, H, 1, 1, PPM, params);
    let a = 0;
    for (const h of r.holes) a += Math.PI * h.r * h.r;
    open[s] = a / area;
  }
  // Enforce monotonicity. The curve is monotone in principle, but it is
  // measured from a dithered process, so a step can come out a hair below its
  // predecessor — and a non-monotone response inverts into a lookup that
  // reverses tone locally, which shows up as a visible band. Clamping upward
  // is the conservative repair: it never invents brightness that the sampler
  // cannot produce.
  for (let s = 1; s < steps; s++) if (open[s] < open[s - 1]) open[s] = open[s - 1];
  return { open, maxOpen: open[steps - 1] };
}
