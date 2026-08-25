// Photo -> perforation field.
//
// The governing constraint: at a 1.45mm pitch on a 65mm can you get roughly
// 141 x 113 sample points. That is a thumbnail. A photograph carries far more
// detail than the grid can represent, and detail finer than the grid becomes
// aliasing rather than information (CLAUDE.md rule 6). So the pipeline is
// mostly about throwing information away in a controlled way — hence the
// posterize and the large-radius local contrast, and hence band-limiting as
// the very last step before the stipple samples it.
//
// A photo also does not wrap. `seam` handles that explicitly rather than
// leaving a visible discontinuity at x=0.
import { FieldCtx, boxBlur, clamp01, guidedSelf } from './fieldkit';
import { DEFAULT_STIPPLE, StippleParams, stipple } from './stipple';

/**
 * sRGB transfer-function tables, so luminance is computed from LIGHT rather
 * than from the gamma-encoded bytes.
 *
 * Rec.709's 0.2126/0.7152/0.0722 are *linear-light* weights. Applying them
 * straight to sRGB bytes (which is what this file used to do) computes "luma"
 * Y', not luminance Y, and the two disagree most on saturated colour: pure
 * sRGB blue gives Y' = 0.072 — indistinguishable from black — where correct
 * luminance re-encoded for display is ~0.30, dark but clearly present. Photos
 * with a blue sky or a red garment were losing those whole regions to solid
 * black before they ever reached the tone controls.
 *
 * Decode is an exact 256-entry table (one per possible byte). Re-encode is a
 * 4096-entry table instead of a per-pixel pow(): a field is ~1.9M pixels, and
 * the quantisation error at 12 bits is far below one output step.
 */
const SRGB_DECODE = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const SRGB_ENCODE = (() => {
  const n = 4096;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = i / (n - 1);
    t[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  return t;
})();

export type PhotoFit = 'cover' | 'contain' | 'stretch';
export type SeamMode = 'fade' | 'mirror' | 'stretch';

export interface PhotoPlacement {
  fit: PhotoFit;
  seam: SeamMode;
  /** zoom multiplier applied on top of the fit */
  zoom: number;
  /** pan, in fractions of the canvas */
  offsetX: number;
  offsetY: number;
  /** fraction of circumference the image occupies (seam: 'fade' only) */
  coverage: number;
}

export interface PhotoParams {
  invert: boolean;
  /** auto black/white point from histogram percentiles */
  autoLevels: boolean;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  /**
   * Overall gain, -1..+1, 0 = neutral. A MULTIPLIER rather than an offset:
   * adding a constant would lift pure black off zero, and rule 5 is explicit
   * that real blacks (no holes at all) are what make an image read. A gain
   * leaves black at black and opens up everything above it.
   */
  brightness: number;
  /**
   * Contrast around mid-tone, -1..+1, 0 = neutral. Pivots at 0.5 in perceptual
   * space, i.e. the same space posterize quantises in, so the two compose the
   * way a user expects.
   */
  contrast: number;
  /** large-radius unsharp = local contrast / "clarity". 0 = off */
  localContrast: number;
  /**
   * Radius of that local contrast, in MILLIMETRES — deliberately not a
   * fraction of the circumference, which is the one place rule 1 inverts.
   * Rule 1 governs *layout*, which must wrap; this is a perceptual filter
   * scale, a property of the viewer's eye and of rule 3's ~16mm legible-
   * feature floor, so it has to stay physically constant as the can's
   * diameter changes. As a fraction it also came out far too small: 0.06 of a
   * 204mm circumference is 12.3mm, i.e. operating at eye-and-nose scale,
   * which is sharpening in disguise — and sharpening at this pitch actively
   * hurts (rule 6). ~30mm normalises the SUBJECT against its BACKGROUND,
   * which is the actual goal, and leaves 16mm features intact.
   */
  localContrastRadiusMm: number;
  /**
   * Use an edge-aware reference for the local-contrast pass (guidedSelf() in
   * fieldkit.ts) instead of a plain blur.
   *
   * OFF by default, and that default is the measured answer rather than
   * caution. The plain blur unquestionably haloes — against a 40mm bright
   * subject on textured dark ground it drags the ground 7.3% darker where it
   * meets the subject, and against a hard-edged one it clips 30mm of
   * background to pure black. The guided reference cuts that to 1.5%.
   *
   * But the halo is doing CLAUDE.md rule 4's job. Rule 4 calls a dark moat
   * around a bright shape "the single biggest legibility lever", and an
   * unsharp mask at a 30mm radius produces one for free. Rendered side by side
   * the haloed portrait is brighter and its eyes, nose shadow and mouth all
   * read more clearly; the halo-free one is flatter and reads worse. Nor can
   * it be dialled back in: a self-guided filter only amplifies variance INSIDE
   * a region, and smooth skin has almost none, so pushing `localContrast` from
   * 0.45 to 0.95 moved open area from 1.11% to 1.13% and changed nothing
   * visible.
   *
   * So this is not an upgrade, it is an escape hatch — worth having for images
   * where the halo is destructive rather than helpful (a high-key photo, or
   * one with several bright regions whose 30mm halos would eat all the
   * background between them), and worth leaving off everywhere else.
   */
  localContrastEdgeAware: boolean;
  /**
   * Edge threshold for that filter, in units of tone variance: a window whose
   * tone spread exceeds ~sqrt(eps) is treated as structure to preserve rather
   * than texture to average away.
   */
  localContrastEdgeEps: number;
  /** quantise to N tone steps. 0 or 1 = off */
  posterize: number;
  /** add Sobel gradient magnitude so structure survives the low sample count */
  edgeBoost: number;
  /** darken toward the frame; also what makes the seam work in 'fade' mode */
  vignette: number;
  /** floor tone applied inside the image area, so mid-dark areas aren't dead */
  ambient: number;
}

/**
 * Wrap the whole way round by default.
 *
 * An earlier version defaulted to a narrow 'fade' medallion (coverage 0.55) on
 * the reasoning that a cylinder only shows its front half, so anything wider
 * is wasted. That reasoning optimises the wrong thing: it treats the can as a
 * poster viewed from one fixed side, when the object is something you pick up
 * and turn. Its real effect on a landscape photo was a small vignetted patch
 * floating on a mostly-black can — reported, accurately, as "tiny and
 * useless", and flagged by the open-area guardrail too (0.6% against the 1.8%
 * floor, i.e. rule 8's "reads as broken, not minimalist").
 *
 * The medallion is still the right answer for a *portrait*, where wrapping a
 * face past the front hemisphere means you can never see all of it at once.
 * So the choice is genuinely image-dependent rather than a single good
 * default, and `placementFor()` picks it from the image's own aspect ratio.
 * These values are the fallback for "no image yet".
 */
export const DEFAULT_PLACEMENT: PhotoPlacement = {
  fit: 'cover',
  seam: 'stretch',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  coverage: 1,
};

/**
 * Starting placement for a freshly loaded image, chosen from its shape.
 *
 * Landscape-ish (roughly the can's own proportions or wider) wraps the full
 * circumference: the seam lands at the back, which is where rule 9 already
 * puts the LED notch, and the vignette darkens toward it so a left/right edge
 * mismatch is hidden rather than displayed.
 *
 * Portrait-ish stays a front medallion and fades out before the seam, so the
 * subject sits whole inside the visible front hemisphere.
 */
export function placementFor(
  imgWidth: number,
  imgHeight: number,
  canvasW: number,
  canvasH: number
): PhotoPlacement {
  const imgAspect = imgWidth / Math.max(1, imgHeight);
  const canvasAspect = canvasW / Math.max(1e-6, canvasH);
  // 0.8 of the canvas aspect, not 1.0: a 4:3 landscape (1.33) is still much
  // better served by wrapping than by being squeezed into a medallion, even
  // though it's narrower than the ~1.44 wrap.
  const wrapsWell = imgAspect >= canvasAspect * 0.8;
  return {
    ...DEFAULT_PLACEMENT,
    seam: wrapsWell ? 'stretch' : 'fade',
    coverage: wrapsWell ? 1 : 0.62,
  };
}

/**
 * Stipple defaults for photographs, which differ sharply from the presets'.
 *
 * A preset authors its own tone structure and can afford a low knee, because
 * its bright forms are *meant* to be solid. A photograph cannot: with a low
 * knee everything above it gets full density and the only thing left varying
 * is hole diameter, which spans about 4x in area — nowhere near enough to
 * carry continuous tone (CLAUDE.md rule 5). A face comes out as one flat
 * blob. Pushing the knee close to 1 makes density track tone across the whole
 * range, which is what actually renders a photograph.
 */
export const PHOTO_STIPPLE = {
  mode: 'hybrid' as const,
  knee: 0.95,
  gamma: 0.5,
  thresh: 0.05,
};

/**
 * Quality ladder for general photographs, replacing QUALITY_PRESETS when a
 * photo is loaded — the same arrangement PORTRAIT_QUALITY already has, and for
 * the same reason: a photograph and a preset want different tuples, and the
 * quality part is applied after the design's own, so a preset tuple would
 * otherwise overwrite whatever the photo asked for.
 *
 * Two things are different from the preset ladder, both measured over 18 real
 * photographs (tools/measure/photos.mjs).
 *
 * 1. MAXIMUM OPEN AREA IS FLAT ACROSS THE LADDER. The preset ladder's is not:
 *    it runs 7.20% at Draft, 11.66% at Standard, 14.51% at Fine and 15.11% at
 *    Ultra, because dMax was scaled by eye rather than held to a ratio. On a
 *    preset that hardly shows — the artwork's own tone structure dominates.
 *    On a photograph it makes the Quality picker a second brightness control,
 *    which is exactly what CLAUDE.md rule 10 says an axis must never be
 *    ("open area must stay flat across the set, or the picker doubles as a
 *    brightness control and every switch needs the tone sliders re-tuned").
 *    Holding dMax/pitch at 0.40 lands every tuple within 1% of 14.5%.
 *
 * 2. IT IS BRIGHTER, AND AT THE SAME TIME SAFER. 0.40 is PORTRAIT_QUALITY's
 *    ratio, not a new gamble; the preset ladder's Standard runs 0.359 and
 *    measures 0.434mm of web against rule 2's 0.30mm floor, i.e. it was
 *    leaving a third of the available web — and therefore a quarter of the
 *    available light — unspent. A photograph has nowhere else to get
 *    brightness from: unlike a preset it cannot simply draw a bigger bright
 *    shape.
 *
 *    Bigger holes alone would spend that margin (1.45/0.58 at the preset
 *    ladder's jitter 0.15 measures 0.374mm, and 0.274mm once ±0.05mm of
 *    positional error is allowed for, i.e. under the floor). Easing jitter off
 *    at the same time buys back MORE than the holes cost, because jitter is a
 *    fraction of pitch and eats web at twice the nominal rate:
 *
 *      1.45/0.52 jitter 0.15   11.66% max   0.434mm worst web   (shipped)
 *      1.45/0.58 jitter 0.15   14.51% max   0.374mm
 *      1.45/0.58 jitter 0.10   14.51% max   0.536mm             <- chosen
 *
 *    So this ladder is 24% brighter than the preset one AND has 23% more web,
 *    at an identical hole count and cut time. What it gives up is lattice
 *    irregularity; that is affordable here because a photograph's own tone
 *    varies everywhere, so there is no flat region for the residual grid to
 *    show itself in (the presets' jitter 0.15 exists for their large areas of
 *    constant tone). Below jitter ~0.05 the hex lattice reads as vertical
 *    striping and needs `rowShift` instead — see stipple.ts.
 */
export const PHOTO_QUALITY = [
  { label: 'Draft', pitch: 2.2, dMin: 0.32, dMax: 0.88, jitter: 0.15 },
  { label: 'Standard', pitch: 1.45, dMin: 0.28, dMax: 0.58, jitter: 0.1 },
  { label: 'Fine', pitch: 1.15, dMin: 0.24, dMax: 0.46, jitter: 0.08 },
  { label: 'Ultra', pitch: 0.98, dMin: 0.2, dMax: 0.39, jitter: 0.05 },
];

/**
 * Tone defaults for photographs.
 *
 * ---------------------------------------------------------------------------
 * `gamma`: open area tracks PERCEPTUAL tone, not display luminance
 * ---------------------------------------------------------------------------
 * A hole is fully open or fully closed, so open-area fraction equals
 * transmitted-light fraction directly. The obvious move from there is to treat
 * the can as a display: a digital photo is gamma-encoded (~2.2) so equal steps
 * LOOK equally spaced, therefore aim for an end-to-end exponent of 2.2 and a
 * nominal 50% grey transmits 0.5^2.2 =~ 0.22.
 *
 * That was the reasoning behind the old default of 1.6, and the arithmetic was
 * right — the sampler contributes its own exponent, measured at 1.373 in
 * HYBRID mode with PHOTO_STIPPLE, and 1.6 x 1.373 = 2.197 lands within 0.15%
 * of 2.2 (tools/measure/response.ts).
 *
 * The TARGET was wrong. A monitor can put out a real white; this can cannot.
 * Maximum open area at the Standard tuple is 11.67%, so the whole output range
 * is one dim eighth of the wall, and squaring it throws most of that away.
 * Measured on two real portraits shot against bright backgrounds, the face
 * came out at 1.29% open against a 3.15% background — the SUBJECT rendered
 * 2.4x darker than its surroundings, which is rule 3b exactly inverted, and
 * reported (accurately) as "both faces are too dark".
 *
 * So the target is open area proportional to perceptual tone, i.e. an
 * end-to-end exponent of ~1.0, which needs 1/1.373 = 0.73. At 0.7 the same
 * face measures 3.52% against a 3.41% background — a subject slightly
 * brighter than its surroundings instead of a hole in them.
 *
 * The synthetic portrait used to develop this pipeline hid it: it was built
 * dark-background and light-subject, the one polarity where a compressive
 * curve does no visible harm.
 *
 * ---------------------------------------------------------------------------
 * `vignette`: 0.3 — this pipeline no longer has a background to suppress
 * ---------------------------------------------------------------------------
 * This was 0.7, and the reasoning for it was sound at the time and is now
 * simply about a different pipeline. The argument was rule 3b subject
 * dominance: the falloff darkens toward the frame, on a PORTRAIT the frame is
 * exactly where the background lives, so it is the one control that suppresses
 * background without touching the subject.
 *
 * Faces then moved out to portrait.ts — which chose 0.35 for itself, having
 * gained adaptive framing that crops most of the background away — and left
 * this file holding a portrait's tuning while serving everything that is NOT a
 * portrait. On a landscape, an object, an animal, a building, there is no
 * "background at the frame" to suppress; the frame is more picture. So the
 * control was spending a quarter of the can's light suppressing the subject.
 *
 * It is by a wide margin the biggest darkener in the pipeline. Ablated over 18
 * real photographs, mean open area over the covered band:
 *
 *   as shipped (0.7)     3.35%        localContrast 0    3.15%  (darker)
 *   vignette 0.35        4.11%        posterize off      3.26%
 *   vignette 0           5.05%        edgeBoost 0        3.34%
 *
 * i.e. every other stage is worth less than 6% and the vignette is worth 51%.
 * That is the "way too dark" report, and why the fix is here rather than in
 * the tone curve.
 *
 * 0.3 rather than 0: some falloff is still wanted. On a full wrap the
 * horizontal falloff darkens toward x=0/W, which rule 9 establishes as the
 * BACK of the can, so it hides the one place a photograph cannot be made
 * continuous. What it must no longer do is carry the seam on its own — see
 * SEAM_FADE_FRAC in buildPhotoField(), which took that job over precisely so
 * that this number is free to be a look.
 *
 * `invert` stays a manual button. Auto-detecting bright-background portraits
 * and flipping them was tried, worked exactly as designed, and looked worse:
 * inverting a face makes hair bright and skin dark, i.e. a photographic
 * negative, which reads as eerie rather than as a portrait. The real problem
 * those images had was the gamma above, not their polarity.
 */
export const DEFAULT_PHOTO_PARAMS: PhotoParams = {
  invert: false,
  autoLevels: true,
  blackPoint: 0.04,
  whitePoint: 0.96,
  gamma: 0.7,
  brightness: 0,
  contrast: 0,
  localContrast: 0.45,
  localContrastRadiusMm: 30,
  localContrastEdgeAware: false,
  localContrastEdgeEps: 0.01,
  posterize: 6,
  // kept low by default: edge boost also amplifies background grain, which
  // shows up as stray specks around the subject
  edgeBoost: 0.1,
  vignette: 0.3,
  ambient: 0.0,
};

/**
 * Measurement resolution for the auto-Punch solve, in px/mm.
 *
 * Lower than the render's 8 because the solve builds the field three times.
 * Unlike the contrast target this replaced, the quantity being matched here is
 * a physical open-area fraction rather than a resolution-dependent index, so
 * this constant is no longer half of a calibration — but it is not free of
 * resolution either: a coarser field is a slightly blurrier one, which narrows
 * the tone distribution and so moves E[tone^k]. Measured over the 9 of 18 test
 * photographs whose solve does not hit a clamp (a clamped one measures the
 * clamp, not the solve), mean |error| in the open area actually rendered at
 * 8 px/mm, against the target:
 *
 *   probe ppm    2       4       8
 *   error      2.16%   0.69%   0.17%
 *
 * 4 is the knee: a quarter of the error of probing at 2, for a sixteenth of the
 * cost of solving at the render's 8.
 *
 * It is not free — three field builds at 4 px/mm measure ~240ms warm, against
 * the ~200ms budget CLAUDE.md sets for a full regeneration. That is affordable
 * only because this runs once per image load or pipeline switch and never on a
 * slider drag, and because a load is already paying for a decode, the face
 * cascade and a draft render. If it ever needs to run more often than that,
 * drop to 3 px/mm before giving up the refinement step — the refinement is
 * worth more than the resolution (0.69% against 1.47% at this resolution).
 */
const PROBE_PPM = 4;

/**
 * Target for auto-Punch: open area over the covered band, in percent.
 *
 * ---------------------------------------------------------------------------
 * Why this is a BRIGHTNESS target and not the contrast one it replaces
 * ---------------------------------------------------------------------------
 * The previous target was whole-image relative local contrast, anchored on the
 * single value a human had approved: portrait 1 at gamma 0.7. That was the
 * right anchor for the pipeline as it then stood, which was the FACE pipeline.
 * Faces have since moved to portrait.ts, and portrait.ts does not call this
 * function at all — so the one approved measurement holding the target up was
 * taken on an image this code path no longer sees.
 *
 * It does not transfer. Measured over 18 real non-face photographs, the solve
 * hit a clamp on 12 of them: 9 pinned to the 0.60 floor and 3 to the 1.60
 * ceiling. A solver that saturates on two thirds of its inputs is not adapting
 * to the image, it is picking one of two constants — and it was worse than
 * inert, because it actively fought the vignette fix above: lowering the
 * vignette raises open area, so the contrast target answered by RAISING gamma
 * and taking the light straight back out (g0.94 -> g1.06 on one image).
 *
 * The reported failure is also not a contrast failure. It is "way too dark",
 * which is a brightness failure, and brightness is measurable directly. So the
 * loop now closes on the thing that is wrong.
 *
 * ---------------------------------------------------------------------------
 * Why 4.5%, measured over the COVERED BAND
 * ---------------------------------------------------------------------------
 * Anchored on rule 8's guardrail, which is itself calibrated from a human
 * rating pass over the whole preset library: the presets rated good measured
 * 2.0-4.5% open and the ones rated too sparse sat at 1.3-1.7%. 4.5% is the top
 * of the rated-good range (Escarcha), which is where a photograph wants to be
 * — a preset can be dim and still read, because it is two big shapes, whereas
 * a photograph has no such structure to fall back on and simply goes murky.
 *
 * Over the covered band rather than the whole wall because a 'fade' medallion
 * covers ~62% of the circumference, and a whole-wall target would try to
 * recover the dark surround's missing light by blowing out the picture. The
 * band figure is what the eye actually reads; on a full wrap the two are the
 * same number.
 *
 * ---------------------------------------------------------------------------
 * The clamps are load-bearing now, in one direction
 * ---------------------------------------------------------------------------
 * A brightness target on a genuinely low-key photograph — a night scene, a
 * dark object on black — would lift it into flat grey and destroy the real
 * blacks that rule 5 says carry the image. AUTO_PUNCH_MIN is what stops that:
 * such an image runs out of gamma before it reaches the target and stays dark,
 * which is the correct answer rather than a failed solve. Four of the 18 do
 * exactly this and land at 2.0-4.0% instead of 4.5%; see AUTO_PUNCH_MIN for
 * where that floor was put and why not lower.
 */
export const AUTO_PUNCH_OPEN_PCT = 4.5;

/**
 * Bounds on the solved value.
 *
 * These stopped being mere sanity rails when the target became brightness:
 * they are now what an image that CANNOT reach the target rests against, so
 * they set how a very dark or very bright photograph comes out. Both moved
 * outward when the target changed, measured over 18 photographs by how many
 * ended up outside rule 8's 1.8-8% band:
 *
 *   bounds        at floor  at ceiling  under 1.8%  over 8%
 *   0.6 - 1.6         4          5           1         0
 *   0.6 - 2.4         4          2           1         0
 *   0.5 - 2.4         4          2           0         0     <- chosen
 *   0.4 - 3.0         3          2           0         0
 *
 * The old 1.6 ceiling was calibrated against the old, dimmer sampler tuple; a
 * bright flat image now has further to come down, and five of the eighteen were
 * resting on it. The old 0.6 floor left the darkest image at exactly 1.80% —
 * on rule 8's floor to the pixel, i.e. at the edge of "reads as broken". 0.5
 * clears it at 2.04%.
 *
 * Not opened wider than that on purpose. 0.4 would take the darkest image to
 * 2.34% but starts lifting genuine shadow into the mid-tones, and rule 5 is
 * explicit that real blacks are what make an image read. A low-key photograph
 * resting on the floor and staying dark is the correct answer, not a failure.
 */
const AUTO_PUNCH_MIN = 0.5;
const AUTO_PUNCH_MAX = 2.4;

/** The two gammas the solver probes first. Chosen to span the useful range. */
const PUNCH_PROBES = [0.7, 1.3];

/**
 * Solve for the `gamma` ("Punch") that lands this image on
 * AUTO_PUNCH_OPEN_PCT of open area over its covered band.
 *
 * Runs the REAL sampler rather than a model of it. Open area could be
 * predicted analytically — response.ts measured the sampler's own exponent at
 * 1.373, so open ~= maxOpen * E[tone^(1.373*gamma)] — but that exponent was
 * measured for one tuple, holds only within 3% across the others, and would
 * silently go stale the moment PHOTO_QUALITY changes. Calling stipple() costs
 * a few thousand hole decisions per probe and is self-calibrating against
 * whatever tuple, dither and knee are actually in play, which is the same
 * reason the measurement harness samples the real thing instead of modelling
 * it (CLAUDE.md's note on the 1x1 field).
 *
 * Secant on log(open area) against gamma, two probes plus one refinement.
 * log-linear because open area is E[tone^k] with k proportional to gamma:
 * exactly straight for a single tone, gently convex for a real distribution,
 * so two points get close and the third lands it. The refinement is worth its
 * third field build — over the unclamped test photographs it takes mean
 * |error| from 1.47% of target to 0.69%.
 */
export function solveAutoPunch(
  img: HTMLImageElement | ImageBitmap,
  W: number,
  H: number,
  place: PhotoPlacement,
  params: PhotoParams,
  tuple: Partial<StippleParams>
): number {
  const ctx = new FieldCtx(W, H, PROBE_PPM);
  const src = sampleImage(img, ctx, place);
  let coverN = 0;
  for (let i = 0; i < src.cover.length; i++) if (src.cover[i] > 0) coverN++;
  const coverFrac = coverN / Math.max(1, src.cover.length);
  if (coverFrac <= 0) return params.gamma;
  const pitchMm = tuple.pitchMm ?? DEFAULT_STIPPLE.pitchMm;

  const clampRound = (g: number) =>
    Math.min(AUTO_PUNCH_MAX, Math.max(AUTO_PUNCH_MIN, Math.round(g * 100) / 100));

  // PHOTO_STIPPLE underneath the caller's tuple, exactly as generate() layers
  // it — the solve has to sample through the same knee the render will use, and
  // a caller passing only a quality tuple would otherwise be measured against
  // DEFAULT_STIPPLE's preset-shaped knee of 0.42.
  const sampler: Partial<StippleParams> = { ...PHOTO_STIPPLE, ...tuple };

  /** open area over the covered band, in percent, at this gamma */
  const openAt = (gamma: number): number => {
    const built = buildPhotoField(src, ctx, { ...params, gamma }, pitchMm);
    const r = stipple(built.field, ctx.W, ctx.H, ctx.Wp, ctx.Hp, ctx.PPM, sampler);
    let area = 0;
    for (const h of r.holes) area += Math.PI * h.r * h.r;
    return (area / (ctx.W * ctx.H * coverFrac)) * 100;
  };

  const lt = Math.log(AUTO_PUNCH_OPEN_PCT);
  const probe = (g: number) => ({ g, l: Math.log(openAt(g)) });
  const secant = (a: { g: number; l: number }, b: { g: number; l: number }): number =>
    Math.abs(b.l - a.l) < 1e-6 ? NaN : a.g + ((lt - a.l) * (b.g - a.g)) / (b.l - a.l);

  const [lo, hi] = PUNCH_PROBES;
  const a = probe(lo);
  const b = probe(hi);
  // A blank or single-tone image gives no slope to solve on, and an image that
  // produces no holes at all gives -Infinity. Nothing to do but keep the
  // default; the tone sliders are still there.
  if (!isFinite(a.l) || !isFinite(b.l)) return params.gamma;
  const first = secant(a, b);
  if (!isFinite(first)) return params.gamma;

  const g1 = clampRound(first);
  // Refine against whichever original probe sits on the far side of the
  // target, so the second step interpolates rather than extrapolating.
  const c = probe(g1);
  if (!isFinite(c.l)) return g1;
  const other = (c.l > lt) === (a.l > lt) ? b : a;
  const second = secant(c, other);
  return isFinite(second) ? clampRound(second) : g1;
}

export interface PhotoSource {
  /** luminance 0..1 at field resolution */
  luma: Float32Array;
  /** 1 inside the placed image, 0 outside */
  cover: Float32Array;
  Wp: number;
  Hp: number;
}

/**
 * Resample an image into field resolution and return its luminance plus a
 * coverage mask. Kept separate from the tonal pipeline so dragging a tone
 * slider doesn't redo the resample.
 */
export function sampleImage(
  img: HTMLImageElement | ImageBitmap,
  ctx: FieldCtx,
  place: PhotoPlacement
): PhotoSource {
  const { Wp, Hp } = ctx;
  const canvas = document.createElement('canvas');
  canvas.width = Wp;
  canvas.height = Hp;
  const c2d = canvas.getContext('2d', { willReadFrequently: true })!;
  // A photo is almost always much larger than the field, so this drawImage is
  // a downscale — and the default 'low' quality does a cheap bilinear tap that
  // skips most source pixels, which is aliasing introduced at the very first
  // step, before rule 6's band-limit can do anything about it.
  c2d.imageSmoothingEnabled = true;
  c2d.imageSmoothingQuality = 'high';
  c2d.fillStyle = '#000';
  c2d.fillRect(0, 0, Wp, Hp);

  const iw = img.width;
  const ih = img.height;

  // target box: full canvas, or a centred slice of it when fading at the seam
  const targetW = place.seam === 'fade' ? Wp * Math.min(1, Math.max(0.1, place.coverage)) : Wp;
  const drawW = place.seam === 'mirror' ? targetW / 2 : targetW;
  const boxX = (Wp - targetW) / 2;

  let sw = iw;
  let sh = ih;
  let dw = drawW;
  let dh = Hp;
  if (place.fit !== 'stretch') {
    const scaleFit =
      place.fit === 'cover'
        ? Math.max(drawW / iw, Hp / ih)
        : Math.min(drawW / iw, Hp / ih);
    const s = scaleFit * place.zoom;
    dw = iw * s;
    dh = ih * s;
  } else {
    dw = drawW * place.zoom;
    dh = Hp * place.zoom;
  }

  const dx = boxX + (drawW - dw) / 2 + place.offsetX * drawW;
  const dy = (Hp - dh) / 2 - place.offsetY * Hp;

  c2d.save();
  // clip so 'cover' overflow doesn't bleed outside the intended box
  c2d.beginPath();
  c2d.rect(boxX, 0, place.seam === 'mirror' ? drawW : targetW, Hp);
  c2d.clip();
  c2d.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
  c2d.restore();

  if (place.seam === 'mirror') {
    // mirror the drawn half into the other half: continuous by construction,
    // so the wrap is exact at any diameter
    const half = Math.round(drawW);
    const src = c2d.getImageData(Math.round(boxX), 0, half, Hp);
    const mirrored = c2d.createImageData(half, Hp);
    for (let y = 0; y < Hp; y++) {
      for (let x = 0; x < half; x++) {
        const s = (y * half + (half - 1 - x)) * 4;
        const d = (y * half + x) * 4;
        mirrored.data[d] = src.data[s];
        mirrored.data[d + 1] = src.data[s + 1];
        mirrored.data[d + 2] = src.data[s + 2];
        mirrored.data[d + 3] = 255;
      }
    }
    c2d.putImageData(mirrored, Math.round(boxX) + half, 0);
  }

  const data = c2d.getImageData(0, 0, Wp, Hp).data;
  const luma = new Float32Array(Wp * Hp);
  const cover = new Float32Array(Wp * Hp);
  const x0 = Math.floor(boxX);
  const x1 = Math.ceil(boxX + targetW);
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    // Rec.709 luminance from LINEAR light (see the SRGB_* tables), then
    // re-encoded to perceptual space. Everything downstream — levels, local
    // contrast, posterize — wants perceptually-even steps, so this is the
    // space to shape in; `params.gamma` at the end of buildPhotoField() is
    // what converts back out to physical open area.
    const Y =
      0.2126 * SRGB_DECODE[data[i]] +
      0.7152 * SRGB_DECODE[data[i + 1]] +
      0.0722 * SRGB_DECODE[data[i + 2]];
    luma[p] = SRGB_ENCODE[Math.min(4095, Math.max(0, Math.round(Y * 4095)))];
    const col = p % Wp;
    cover[p] = col >= x0 && col < x1 ? 1 : 0;
  }
  return { luma, cover, Wp, Hp };
}

/** Histogram percentiles, for auto black/white point. */
function percentiles(src: Float32Array, mask: Float32Array, lo: number, hi: number): [number, number] {
  const bins = 256;
  const hist = new Int32Array(bins);
  let total = 0;
  for (let i = 0; i < src.length; i++) {
    if (mask[i] <= 0) continue;
    const b = Math.min(bins - 1, Math.max(0, Math.round(src[i] * (bins - 1))));
    hist[b]++;
    total++;
  }
  if (total === 0) return [0, 1];
  const loTarget = total * lo;
  const hiTarget = total * hi;
  let acc = 0;
  let loV = 0;
  let hiV = 1;
  let gotLo = false;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (!gotLo && acc >= loTarget) {
      loV = b / (bins - 1);
      gotLo = true;
    }
    if (acc >= hiTarget) {
      hiV = b / (bins - 1);
      break;
    }
  }
  if (hiV - loV < 0.02) return [Math.max(0, loV - 0.05), Math.min(1, loV + 0.05)];
  return [loV, hiV];
}

/**
 * Width of a medallion's edge close-out, as a fraction of the band width.
 *
 * Only has to be wide enough that the fade is not itself a visible edge. At
 * Standard quality the wall carries ~140 samples across, so 8% of a 62%-
 * coverage band is ~7 cells — a few holes' worth of ramp, which is enough to
 * read as a fade and narrow enough not to cost real picture.
 */
const SEAM_FADE_FRAC = 0.08;

export interface PhotoBuildResult {
  field: Float32Array<ArrayBufferLike>;
  /** resolved black/white point actually used (after autoLevels) */
  blackPoint: number;
  whitePoint: number;
}

/**
 * Tonal pipeline. Order is deliberate: all tone shaping happens first, and
 * band-limiting is LAST so it antialiases the posterize boundaries down to the
 * grid scale instead of letting them alias into the stipple.
 */
export function buildPhotoField(
  src: PhotoSource,
  ctx: FieldCtx,
  params: PhotoParams,
  pitchMm: number
): PhotoBuildResult {
  const { Wp, Hp } = ctx;
  const n = Wp * Hp;
  let f = new Float32Array(src.luma);

  if (params.invert) {
    for (let i = 0; i < n; i++) f[i] = 1 - f[i];
  }

  // --- local contrast: large-radius unsharp. This is "clarity", not
  // sharpening; fine-scale sharpening actively hurts at this pitch (rule 6). ---
  if (params.localContrast > 0) {
    const r = Math.max(2, Math.round(params.localContrastRadiusMm * ctx.PPM));
    const reference = params.localContrastEdgeAware
      ? guidedSelf(f, Wp, Hp, r, params.localContrastEdgeEps)
      : boxBlur(f, Wp, Hp, r, r);
    for (let i = 0; i < n; i++) {
      f[i] = f[i] + params.localContrast * (f[i] - reference[i]);
    }
  }

  // --- levels ---
  let bp = params.blackPoint;
  let wp = params.whitePoint;
  if (params.autoLevels) {
    [bp, wp] = percentiles(f, src.cover, 0.015, 0.985);
  }
  const span = Math.max(1e-4, wp - bp);
  for (let i = 0; i < n; i++) {
    f[i] = Math.min(1, Math.max(0, (f[i] - bp) / span));
  }

  // --- brightness and contrast: the two plain controls.
  //
  // Placed after levels and before posterize on purpose. Levels normalise the
  // image's own range first, so these two act on a predictable 0..1 signal
  // rather than fighting whatever the histogram happened to be; and running
  // before posterize means the quantisation steps land on the adjusted tone,
  // so raising contrast redistributes the steps instead of leaving them where
  // the unadjusted image put them.
  //
  // Contrast first, then brightness: contrast pivots about mid-grey, so
  // applying it after a gain would pivot about the wrong point and a
  // brightness change would silently alter the contrast response. ---
  if (params.contrast !== 0) {
    const k = 1 + params.contrast;
    for (let i = 0; i < n; i++) {
      const v = (f[i] - 0.5) * k + 0.5;
      f[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  if (params.brightness !== 0) {
    const k = 1 + params.brightness;
    for (let i = 0; i < n; i++) {
      const v = f[i] * k;
      f[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  // --- posterize: the "dumb it down" step. Hard tone steps read far better
  // than a continuous ramp when you only have ~140x113 samples.
  //
  // Runs BEFORE gamma, i.e. while the field is still perceptual, so the steps
  // are evenly spaced *to the eye*. Quantising after gamma instead spaces them
  // evenly in physical open area, which is not the same thing at all: with 6
  // levels the perceived jumps came out 0.36, 0.20, 0.17, 0.15, 0.12 — the
  // step out of black three times the size of the ones between highlights,
  // which reads as a hard terminator across the shadows plus mushy,
  // indistinguishable brights. Gamma is monotonic, so applying it afterwards
  // still leaves exactly `steps` distinct values; only their spacing moves. ---
  if (params.posterize >= 2) {
    const steps = Math.round(params.posterize);
    for (let i = 0; i < n; i++) {
      f[i] = Math.round(f[i] * (steps - 1)) / (steps - 1);
    }
  }

  // --- gamma: the perceptual -> open-area conversion. See
  // DEFAULT_PHOTO_PARAMS for why the default is 1.6 rather than 2.2 (the
  // sampler supplies the remaining ~1.37 of the exponent itself). ---
  if (params.gamma !== 1) {
    // Through a 4096-entry LUT rather than ~1.4M Math.pow() calls — the same
    // trick SRGB_ENCODE uses above, and for the same reason. pow() is the most
    // expensive operation in this file and the input is already a bounded
    // 0..1 ramp, so tabulating it is exact to well under one output step.
    const g = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) g[i] = Math.pow(i / 4095, params.gamma);
    for (let i = 0; i < n; i++) {
      const v = f[i];
      f[i] = g[v <= 0 ? 0 : v >= 1 ? 4095 : (v * 4095) | 0];
    }
  }

  // --- edge boost: Sobel on the (already simplified) field. Outlines are what
  // survive downsampling, so a little goes a long way. ---
  if (params.edgeBoost > 0) {
    const soft = boxBlur(f, Wp, Hp, 1, 1);
    const edges = new Float32Array(n);
    // Row-pointer arithmetic rather than an at(col,row) closure. The closure
    // version did two modulo ops per access and was called 12 times per pixel
    // — ~17M closure invocations with `%` on a full-resolution field, which
    // made this the second-hottest loop in the file after gamma. The wrap only
    // ever matters at the two edge columns, so the interior runs branch-free
    // and those two columns are handled explicitly.
    let peak = 1e-6;
    for (let row = 0; row < Hp; row++) {
      const rUp = (row === 0 ? 0 : row - 1) * Wp;
      const rMid = row * Wp;
      const rDn = (row === Hp - 1 ? Hp - 1 : row + 1) * Wp;
      for (let col = 0; col < Wp; col++) {
        const cL = col === 0 ? Wp - 1 : col - 1;
        const cR = col === Wp - 1 ? 0 : col + 1;
        const ul = soft[rUp + cL], um = soft[rUp + col], ur = soft[rUp + cR];
        const ml = soft[rMid + cL], mr = soft[rMid + cR];
        const dl = soft[rDn + cL], dm = soft[rDn + col], dr = soft[rDn + cR];
        const gx = -ul - 2 * ml - dl + ur + 2 * mr + dr;
        const gy = -ul - 2 * um - ur + dl + 2 * dm + dr;
        // sqrt, not hypot: hypot does overflow-safe rescaling that costs
        // several times more, and these operands are bounded 0..1 sums.
        const m = Math.sqrt(gx * gx + gy * gy);
        edges[rMid + col] = m;
        if (m > peak) peak = m;
      }
    }
    const k = params.edgeBoost / peak;
    for (let i = 0; i < n; i++) {
      const v = f[i] + k * edges[i];
      f[i] = v > 1 ? 1 : v;
    }
  }

  // --- ambient floor, so large dark regions still carry a hint of texture ---
  if (params.ambient > 0) {
    for (let i = 0; i < n; i++) {
      if (src.cover[i] > 0) f[i] = Math.max(f[i], params.ambient);
    }
  }

  // --- vignette + seam handling ---
  //
  // These are two jobs, and they used to be one number. `vignette` is a look.
  // Closing a medallion's edge down to zero is STRUCTURAL: in 'fade' mode the
  // image occupies a centred band, and if tone is still finite where the band
  // ends then the holes simply stop at a hard vertical line — a cropped
  // rectangle floating on the can, not a vignetted medallion. (The old comment
  // here claimed the falloff took tone to zero before x=0. It did not: at
  // vignette 0.7 the band edge still sat at 1 - 0.7 = 0.30 of full tone and
  // then fell off a cliff to nothing, because the only thing that actually
  // zeroed it was the `cover` mask.)
  //
  // Conflating them is what made `vignette` un-lowerable, and it is exactly
  // rule 10's lesson in a different corner of the engine: an axis that is
  // secretly load-bearing for something else cannot be tuned. So the edge
  // close-out is now unconditional and independent of `vignette`, over the
  // outer SEAM_FADE_FRAC of the band, and only when the image really is a
  // medallion (a full wrap covers every column and needs none of this).
  const vig = params.vignette;
  const coverX = new Float32Array(Wp);
  const seamFade = new Float32Array(Wp);
  {
    // distance from the covered band's edges, in fractions of the band width
    let firstCol = Wp;
    let lastCol = -1;
    for (let col = 0; col < Wp; col++) {
      if (src.cover[col] > 0) {
        if (col < firstCol) firstCol = col;
        if (col > lastCol) lastCol = col;
      }
    }
    if (lastCol < firstCol) {
      firstCol = 0;
      lastCol = Wp - 1;
    }
    const bandW = Math.max(1, lastCol - firstCol);
    // A band that reaches both edges is a full wrap; anything narrower is a
    // medallion whose edges have to be closed out.
    const medallion = firstCol > 0 || lastCol < Wp - 1;
    for (let col = 0; col < Wp; col++) {
      if (col < firstCol || col > lastCol) {
        coverX[col] = 0;
        seamFade[col] = 0;
        continue;
      }
      const t = (col - firstCol) / bandW; // 0..1 across the band
      const edge = Math.min(t, 1 - t) * 2; // 0 at either edge, 1 at centre
      coverX[col] = vig > 0 ? Math.pow(Math.min(1, edge / 0.55), 1.1) : 1;
      if (!medallion) {
        seamFade[col] = 1;
        continue;
      }
      // Smoothstep rather than a linear ramp: a linear fade leaves a visible
      // kink where it meets full tone, and at ~140 samples across the wall a
      // kink is a couple of cells wide and reads as a band.
      const u = Math.min(1, Math.min(t, 1 - t) / SEAM_FADE_FRAC);
      seamFade[col] = u * u * (3 - 2 * u);
    }
  }
  for (let row = 0; row < Hp; row++) {
    const ty = row / Math.max(1, Hp - 1);
    const edgeY = Math.min(ty, 1 - ty) * 2;
    const vy = vig > 0 ? Math.pow(Math.min(1, edgeY / 0.5), 1.1) : 1;
    for (let col = 0; col < Wp; col++) {
      const i = row * Wp + col;
      const shade = 1 - vig * (1 - Math.min(coverX[col], vy));
      f[i] *= Math.max(0, shade) * seamFade[col] * (src.cover[i] > 0 ? 1 : 0);
    }
  }

  // --- rule 6: band-limit to the grid, last thing before sampling ---
  const limited = boxBlur(f, Wp, Hp, Math.max(1, Math.round((pitchMm * ctx.PPM) / 2)));
  clamp01(limited);
  return { field: limited, blackPoint: bp, whitePoint: wp };
}
