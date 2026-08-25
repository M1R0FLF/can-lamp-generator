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
 * `vignette`: 0.7, because it is subject dominance, not decoration
 * ---------------------------------------------------------------------------
 * The falloff darkens toward the frame, and on a portrait the frame is exactly
 * where the background lives. It is therefore the one control that suppresses
 * background without touching the subject, which is rule 3b's "give the hero
 * genuinely dark breathing room". Measured in the right direction: dropping it
 * from 0.55 to 0.35 raised background open area from 3.64% to 4.51% with the
 * face unchanged. Raised to 0.7 for the same reason, in reverse.
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
  vignette: 0.7,
  ambient: 0.0,
};

/**
 * Measurement resolution for the auto-Punch solve, in px/mm.
 *
 * MUST be kept in step with AUTO_PUNCH_TARGET below — the two are one
 * calibration, not two independent knobs. Relative local contrast is
 * resolution-dependent because a lower-resolution field carries less fine
 * detail: the same approved setting measures 0.2064 here at 2 px/mm and 0.1959
 * at the render's 8. Changing this constant without re-deriving the target
 * silently biases every solve (it first shipped mismatched, and drove a
 * portrait that wanted 0.70 down onto the 0.60 clamp).
 */
const PROBE_PPM = 2;

/**
 * Target for auto-Punch, in units of whole-image relative local contrast
 * (RMS of the 4mm high-pass over the mean, across the covered area), measured
 * at PROBE_PPM.
 *
 * Anchored on the ONE setting a human has explicitly approved: portrait 1 at
 * gamma 0.7, which measures 0.2064 at this resolution. Everything else here is
 * machinery; this number is the whole judgement, so it is the number to change
 * if results drift.
 *
 * A single target transfers between images at all only because the quantity
 * itself does. Measured on two portraits at the settings each wanted, contrast
 * came out within 9% of each other despite one being a bespectacled face with
 * dark hair and the other an evenly-lit studio shot, and despite the two
 * needing gammas nearly a factor of two apart.
 *
 * It is measured over the WHOLE covered area rather than over the subject,
 * because nothing in production knows where the subject is — this project
 * cannot have a face detector (CLAUDE.md puts the halftone portrait generator
 * out of scope precisely because it needs OpenCV). That dilution has a real
 * cost, and it is worth being honest about its direction: an image with a large
 * flat background reads LOW, so the solver pushes its gamma further than a
 * subject-only measurement would. On the second portrait that lands 1.31 where
 * a face-only match would have said ~1.1 — more contrast and less brightness
 * than strictly necessary, which is at least the direction that image was
 * reported as needing. No single whole-image target can reproduce a face-only
 * match for both; that is the trade this approach makes.
 */
export const AUTO_PUNCH_TARGET = 0.2064;

/** Bounds on the solved value, so a pathological image cannot produce a silly one. */
const AUTO_PUNCH_MIN = 0.6;
const AUTO_PUNCH_MAX = 1.6;

/** The two gammas the solver probes. Chosen to span the useful range. */
const PUNCH_PROBES = [0.7, 1.3];

/**
 * Relative local contrast at ~4mm scale over the covered area: RMS of the
 * high-pass divided by the mean.
 *
 * Normalised by the mean deliberately. Raw RMS scales with overall brightness,
 * so it scores any change that darkens the image as a loss of contrast even
 * when the features have become MORE distinct — which is exactly backwards for
 * choosing a tone curve, and it sent an earlier version of this measurement
 * the wrong way.
 */
function relativeLocalContrast(
  field: Float32Array,
  Wp: number,
  Hp: number,
  cover: Float32Array,
  ppm: number
): number {
  const r = Math.max(1, Math.round(4 * ppm));
  const blur = boxBlur(field, Wp, Hp, r, r);
  let mean = 0;
  let rms = 0;
  let n = 0;
  for (let i = 0; i < field.length; i++) {
    if (cover[i] <= 0) continue;
    mean += field[i];
    const d = field[i] - blur[i];
    rms += d * d;
    n++;
  }
  if (n === 0) return 0;
  mean /= n;
  if (mean <= 1e-6) return 0;
  return Math.sqrt(rms / n) / mean;
}

/**
 * Solve for the `gamma` ("Punch") that lands this image on AUTO_PUNCH_TARGET.
 *
 * Punch trades face brightness against face contrast, and which value is right
 * is a property of the photograph, not a constant: a face with glasses and
 * dark hair carries its own contrast and wants a low value, while an evenly-lit
 * studio portrait needs nearly twice as much before its features separate from
 * the skin. A single default cannot serve both — reported as one image being
 * right and the other "too bright, you can't see face details".
 *
 * Closed loop rather than a heuristic: probe two gammas, measure what actually
 * comes out of the real tone pipeline, and interpolate. Relative contrast is
 * very nearly linear in gamma over this range (measured 0.190 -> 0.256 across
 * 0.6 -> 1.5, and 0.138 -> 0.212 on the other image), so two probes are enough
 * and a third would only confirm the straight line.
 *
 * Runs at PROBE_PPM (2 px/mm) instead of the render's 8, which makes the two
 * extra field builds about 1/16 the cost each. A 4mm feature is still 8 px
 * across there, so the measurement holds up while the solve stays a few tens
 * of milliseconds instead of most of a second — but see PROBE_PPM: the target
 * is calibrated to that resolution and the two must move together.
 */
export function solveAutoPunch(
  img: HTMLImageElement | ImageBitmap,
  W: number,
  H: number,
  place: PhotoPlacement,
  params: PhotoParams,
  pitchMm: number
): number {
  const ctx = new FieldCtx(W, H, PROBE_PPM);
  const src = sampleImage(img, ctx, place);
  const measured: number[] = [];
  for (const g of PUNCH_PROBES) {
    const built = buildPhotoField(src, ctx, { ...params, gamma: g }, pitchMm);
    measured.push(relativeLocalContrast(built.field, ctx.Wp, ctx.Hp, src.cover, PROBE_PPM));
  }
  const [g0, g1] = PUNCH_PROBES;
  const [c0, c1] = measured;
  const slope = c1 - c0;
  // A flat response means contrast does not respond to Punch at all (a blank
  // or single-tone image). Nothing to solve; leave the default in place.
  if (!isFinite(slope) || Math.abs(slope) < 1e-6) return params.gamma;
  const solved = g0 + ((AUTO_PUNCH_TARGET - c0) / slope) * (g1 - g0);
  if (!isFinite(solved)) return params.gamma;
  return Math.min(AUTO_PUNCH_MAX, Math.max(AUTO_PUNCH_MIN, Math.round(solved * 100) / 100));
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

  // --- vignette + seam handling. In 'fade' mode the horizontal falloff is
  // what makes the wrap work: tone reaches zero before x=0, so there are no
  // holes at the seam and nothing to mismatch. ---
  const vig = params.vignette;
  const coverX = new Float32Array(Wp);
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
    for (let col = 0; col < Wp; col++) {
      if (col < firstCol || col > lastCol) {
        coverX[col] = 0;
        continue;
      }
      const t = (col - firstCol) / bandW; // 0..1 across the band
      const edge = Math.min(t, 1 - t) * 2; // 0 at either edge, 1 at centre
      coverX[col] = vig > 0 ? Math.pow(Math.min(1, edge / 0.55), 1.1) : 1;
    }
  }
  for (let row = 0; row < Hp; row++) {
    const ty = row / Math.max(1, Hp - 1);
    const edgeY = Math.min(ty, 1 - ty) * 2;
    const vy = vig > 0 ? Math.pow(Math.min(1, edgeY / 0.5), 1.1) : 1;
    for (let col = 0; col < Wp; col++) {
      const i = row * Wp + col;
      const shade = 1 - vig * (1 - Math.min(coverX[col], vy));
      f[i] *= Math.max(0, shade) * (src.cover[i] > 0 ? 1 : 0);
    }
  }

  // --- rule 6: band-limit to the grid, last thing before sampling ---
  const limited = boxBlur(f, Wp, Hp, Math.max(1, Math.round((pitchMm * ctx.PPM) / 2)));
  clamp01(limited);
  return { field: limited, blackPoint: bp, whitePoint: wp };
}
