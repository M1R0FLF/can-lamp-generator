// Faces. A separate pipeline from photo.ts, on purpose.
//
// photo.ts treats a photograph as an image to reproduce faithfully: normalise
// its histogram, apply a tone curve, band-limit, sample. That is the right goal
// for a picture in general and it is the wrong goal for a face, which is why
// faces came out of it unrecognisable however the constants were tuned.
//
// ---------------------------------------------------------------------------
// What actually makes a face recognisable
// ---------------------------------------------------------------------------
// Face identity is carried by a narrow band of spatial frequencies, roughly
// 8-16 cycles per face width, and recognition falls apart below about 6-8.
// (Consistent across the psychophysics and in machine face recognition too;
// see e.g. Keil 2008, "Does face image statistics predict a preferred spatial
// frequency for human face processing?")
//
// Convert that to millimetres and the old pipeline's problem is obvious. For a
// face 75mm wide on the can, the identity band is features between 75/16 =
// 4.7mm and 75/8 = 9.4mm. photo.ts had:
//
//   - local contrast at a 30mm radius. That is ~2 cycles per face width, an
//     octave BELOW the identity band. It was normalising subject-against-
//     background, which is a different and much coarser job.
//   - band-limiting at pitch/2, which is correct but only removes what is too
//     fine to sample.
//   - nothing at all operating between 4 and 10mm.
//
// So the band that carries identity was attenuated by the sampler's own MTF and
// boosted by nothing. Every metric reported on it averaged straight across that
// band, which is why the numbers agreed with each other while the faces did
// not read.
//
// Two consequences drive this file:
//
//   1. THE FACE MUST BE BIG. The identity band has to land where the sampler
//      still has MTF to give. At 1.45mm pitch a 52mm face puts 16 c/fw at 0.89
//      of Nyquist, where measured MTF is 0.79. Doubling the face width halves
//      that. Framing is not composition here, it is bandwidth.
//   2. EMPHASISE THE BAND, don't sharpen. A difference of two blurs at the band
//      edges amplifies exactly the octave that carries identity and leaves
//      everything else alone. Unsharp masking at a single small radius would
//      boost the finest detail instead, which the grid cannot represent and
//      which turns into noise.
import { FieldCtx, boxBlur, clamp01 } from './fieldkit';
import { PhotoPlacement, PhotoSource } from './photo';

/**
 * Framing: how much of the wall height the FACE should occupy.
 *
 * Not the image — the face. 0.7 of a 142mm wall is a ~100mm face, which at
 * 0.85mm pitch is ~117 cells across, putting the top of the identity band at
 * 0.27 of Nyquist where the sampler still has essentially all its contrast.
 *
 * This is the single highest-leverage number in the file. Measured on four
 * faces, going from the old auto-placement to a framing like this (with pitch
 * held constant) was the difference between a murky blob and a recognisable
 * person.
 */
export const DEFAULT_FACE_HEIGHT_FRAC = 0.7;

/**
 * Head height as a fraction of the wall, for the adaptive framing in
 * faceFind.ts. Larger than DEFAULT_FACE_HEIGHT_FRAC because a head box includes
 * hair and jaw, which the face box does not.
 */
export const DEFAULT_HEAD_HEIGHT_FRAC = 0.82;

/**
 * Placement that makes a face fill the wall.
 *
 * `coverage` 0.55 keeps the whole face inside the visible front hemisphere —
 * half the circumference is 102mm and the face is ~75-100mm wide, so it sits
 * whole in one view rather than wrapping out of sight. The seam fades, so the
 * back of the can stays dark and there is nothing to mismatch where the ends
 * meet.
 *
 * `zoom` is what actually makes the face big: with `fit: 'cover'` on a squarish
 * portrait the image height matches the wall, and a face is typically half the
 * frame, so zoom ~1.35 brings a face from ~50% to ~70% of the wall height.
 * `offsetY` nudges the eyes up off centre, which is where they sit in a
 * portrait people find natural.
 */
export const PORTRAIT_PLACEMENT: PhotoPlacement = {
  fit: 'cover',
  seam: 'fade',
  zoom: 1.35,
  offsetX: 0,
  offsetY: 0.06,
  coverage: 0.55,
};

/**
 * Sampler tuple for faces. Deliberately much finer than any preset's.
 *
 * `pitchMm` 0.85 against the presets' 1.2-1.45. Measured on a pitch sweep, face
 * legibility keeps improving all the way down to ~0.65mm and only then
 * saturates — the presets' pitch was simply far too coarse for a face, which is
 * most of why faces never read. 0.85 is where that gain meets the laser limits:
 * it is the finest tuple whose measured web still survives +/-0.05mm of
 * positional error (see tools/measure/laserability.mjs), and 0.75 and 0.65 do
 * not. Revisit once the calibration can (tools/measure/calibration-tile.mjs)
 * gives real numbers for this machine instead of assumed ones.
 *
 * `jitter` stays low because a fine pitch has little web to spare, and
 * `rowShift` does the job jitter would otherwise be needed for — see the
 * `rowShift` docs in stipple.ts. Without it a hex lattice at this jitter reads
 * as visible vertical striping.
 *
 * `dMax` 0.34 rather than 0.36 buys back the web that rowShift costs, so the
 * measured figure stays clear of the 0.3mm floor.
 */
export const PORTRAIT_STIPPLE = {
  pitchMm: 0.85,
  dMin: 0.18,
  dMax: 0.34,
  jitter: 0.05,
  rowShift: 0.25,
  dither: 'diffusion' as const,
  mode: 'hybrid' as const,
  knee: 0.95,
  gamma: 0.5,
  thresh: 0.05,
};

export interface PortraitParams {
  /**
   * Assumed face width in mm on the can. Sets the identity band's scale, so it
   * is the one geometric quantity the tone stage needs. Estimated from the
   * framing by `faceWidthFor()` rather than detected — see that function.
   */
  faceWidthMm: number;
  /**
   * Gain on the identity band (8-16 cycles per face width). 0 disables it.
   *
   * This replaces photo.ts's `localContrast`, which operated an octave too
   * coarse. Implemented as a difference of two box blurs at the band edges,
   * which is a true band-pass: it cannot amplify the sub-pitch detail that a
   * single-radius unsharp mask would, and that matters because such detail is
   * unrepresentable on the grid and lands as noise.
   */
  identityBoost: number;
  /**
   * Overall gain, -1..+1, 0 neutral. A multiplier, so black stays black —
   * an additive lift would put holes into what should be solid dark.
   */
  brightness: number;
  /** Contrast about mid-tone, -1..+1, 0 neutral. */
  contrast: number;
  /**
   * Tone steps. 0 or 1 = continuous.
   *
   * Kept because a face at this sample count is closer to a print than a photo,
   * and hard steps can read better than a continuous ramp. Applied before the
   * output curve so the steps are spaced evenly to the EYE.
   */
  levels: number;
  /**
   * Output exponent, perceptual tone -> open area. 1.0 means open area tracks
   * perceived brightness. Values above 1 trade brightness for contrast.
   */
  gamma: number;
  /**
   * Darken toward the frame. On a portrait the frame is where background lives.
   *
   * Lower than photo.ts's 0.7 because adaptive framing (faceFind.ts) already
   * crops most of the background away, so the vignette no longer has to do that
   * job alone. Measured: it does NOT eat into the face — at 0.55 vs 0.0 the
   * face is unchanged and only the surround differs — but 0.55 pushed a
   * tightly-cropped portrait under rule 8's open-area floor (1.79%), and 0.35
   * clears it (1.88%) with no visible difference to the subject.
   */
  vignette: number;
  /**
   * Normalise levels on the FACE region rather than the whole frame.
   *
   * On a portrait shot against a bright wall, a whole-frame histogram is
   * dominated by the wall, so the black and white points get set by background
   * and the face ends up compressed into the middle of the range. Measuring the
   * percentiles over the centre box instead — where the framing above has
   * deliberately put the face — sets them from the thing that matters.
   */
  faceMeteredLevels: boolean;
}

export const DEFAULT_PORTRAIT_PARAMS: PortraitParams = {
  faceWidthMm: 75,
  identityBoost: 1.0,
  brightness: 0,
  contrast: 0,
  levels: 0,
  gamma: 1,
  vignette: 0.35,
  faceMeteredLevels: true,
};

/**
 * Estimate the face width the framing produces, in mm.
 *
 * Deliberately an estimate from the geometry rather than a detection. A face
 * detector is out of reach here — CLAUDE.md puts the halftone portrait
 * generator out of scope precisely because it needs OpenCV — and the framing
 * above is the thing that decides how big the face is anyway. The estimate only
 * has to be good enough to set a filter scale: the identity band is an octave
 * wide, so being 20% out moves the band by a fifth of its own width and changes
 * very little.
 *
 * `FACE_FRAC_OF_FRAME` is the assumption doing the work: in an ordinary
 * head-and-shoulders portrait the head spans roughly half the frame's shorter
 * side. Wrong for a full-body shot, which is what the manual override is for.
 */
const FACE_FRAC_OF_FRAME = 0.5;

export function faceWidthFor(place: PhotoPlacement, canvasW: number, canvasH: number): number {
  const bandW = place.seam === 'fade' ? canvasW * place.coverage : canvasW;
  // 'cover' scales the image so the short side fills the box, then zoom scales
  // further; the face rides along with it.
  const shortSide = Math.min(bandW, canvasH);
  return shortSide * FACE_FRAC_OF_FRAME * Math.max(0.2, place.zoom);
}

/** Percentiles over a mask, for black/white point. */
function percentiles(
  src: Float32Array,
  weight: (i: number) => boolean,
  lo: number,
  hi: number
): [number, number] {
  const bins = 512;
  const hist = new Int32Array(bins);
  let total = 0;
  for (let i = 0; i < src.length; i++) {
    if (!weight(i)) continue;
    const b = Math.min(bins - 1, Math.max(0, Math.round(src[i] * (bins - 1))));
    hist[b]++;
    total++;
  }
  if (total === 0) return [0, 1];
  let acc = 0;
  let loV = 0;
  let hiV = 1;
  let gotLo = false;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (!gotLo && acc >= total * lo) {
      loV = b / (bins - 1);
      gotLo = true;
    }
    if (acc >= total * hi) {
      hiV = b / (bins - 1);
      break;
    }
  }
  if (hiV - loV < 0.05) return [Math.max(0, loV - 0.1), Math.min(1, loV + 0.1)];
  return [loV, hiV];
}

export interface PortraitBuildResult {
  field: Float32Array;
  blackPoint: number;
  whitePoint: number;
  /** the band edges actually used, in mm — for the measurement harness */
  bandLoMm: number;
  bandHiMm: number;
}

/**
 * Build the sampling field for a face.
 *
 * Order matters and differs from photo.ts. Levels first, so the identity band
 * is boosted on a signal that already spans 0..1 rather than on whatever
 * fraction of the range the exposure happened to occupy. Then the band boost,
 * then the plain brightness/contrast, then quantisation, then the output curve,
 * then the vignette, and band-limiting last so nothing finer than the grid
 * survives into the sampler.
 */
export function buildPortraitField(
  src: PhotoSource,
  ctx: FieldCtx,
  params: PortraitParams,
  pitchMm: number
): PortraitBuildResult {
  const { Wp, Hp } = ctx;
  const n = Wp * Hp;
  const f = new Float32Array(src.luma);

  // ---- levels, metered on the face ----
  let inFace: (i: number) => boolean;
  if (params.faceMeteredLevels) {
    // the framing puts the face in the middle of the covered band; meter a box
    // around that rather than the whole frame
    let c0 = Wp;
    let c1 = -1;
    for (let x = 0; x < Wp; x++) {
      if (src.cover[x] > 0) {
        if (x < c0) c0 = x;
        if (x > c1) c1 = x;
      }
    }
    if (c1 < c0) {
      c0 = 0;
      c1 = Wp - 1;
    }
    const cx = (c0 + c1) / 2;
    const halfW = ((c1 - c0) * 0.42) / 2 + 1;
    const y0 = Hp * 0.1;
    const y1 = Hp * 0.72;
    inFace = (i: number) => {
      const x = i % Wp;
      const y = (i / Wp) | 0;
      return Math.abs(x - cx) <= halfW && y >= y0 && y <= y1;
    };
  } else {
    inFace = (i: number) => src.cover[i] > 0;
  }
  const [bp, wp] = percentiles(f, inFace, 0.02, 0.98);
  const span = Math.max(1e-4, wp - bp);
  for (let i = 0; i < n; i++) {
    const v = (f[i] - bp) / span;
    f[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // ---- identity-band emphasis ----
  //
  // Difference of two box blurs at the band edges. Radii are half the feature
  // size, since a box blur of radius r suppresses detail finer than ~2r.
  const bandHiMm = params.faceWidthMm / 8; // coarse edge of the band
  const bandLoMm = params.faceWidthMm / 16; // fine edge
  if (params.identityBoost > 0) {
    const rFine = Math.max(1, Math.round((bandLoMm / 2) * ctx.PPM));
    const rCoarse = Math.max(rFine + 1, Math.round((bandHiMm / 2) * ctx.PPM));
    const fine = boxBlur(f, Wp, Hp, rFine, rFine);
    const coarse = boxBlur(f, Wp, Hp, rCoarse, rCoarse);
    for (let i = 0; i < n; i++) {
      const band = fine[i] - coarse[i];
      const v = f[i] + params.identityBoost * band;
      f[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  // ---- plain contrast then brightness ----
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

  // ---- quantise, while still perceptual ----
  if (params.levels >= 2) {
    const steps = Math.round(params.levels);
    for (let i = 0; i < n; i++) {
      f[i] = Math.round(f[i] * (steps - 1)) / (steps - 1);
    }
  }

  // ---- output curve ----
  if (params.gamma !== 1) {
    const lut = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) lut[i] = Math.pow(i / 1023, params.gamma);
    for (let i = 0; i < n; i++) {
      const v = f[i];
      f[i] = lut[v <= 0 ? 0 : v >= 1 ? 1023 : (v * 1023) | 0];
    }
  }

  // ---- vignette, and hard zero outside the image ----
  const vig = params.vignette;
  {
    let c0 = Wp;
    let c1 = -1;
    for (let x = 0; x < Wp; x++) {
      if (src.cover[x] > 0) {
        if (x < c0) c0 = x;
        if (x > c1) c1 = x;
      }
    }
    if (c1 < c0) {
      c0 = 0;
      c1 = Wp - 1;
    }
    const bandW = Math.max(1, c1 - c0);
    const colShade = new Float32Array(Wp);
    for (let x = 0; x < Wp; x++) {
      if (x < c0 || x > c1) {
        colShade[x] = 0;
        continue;
      }
      const t = (x - c0) / bandW;
      const edge = Math.min(t, 1 - t) * 2;
      colShade[x] = vig > 0 ? Math.pow(Math.min(1, edge / 0.5), 1.1) : 1;
    }
    for (let y = 0; y < Hp; y++) {
      const ty = y / Math.max(1, Hp - 1);
      const edgeY = Math.min(ty, 1 - ty) * 2;
      const vy = vig > 0 ? Math.pow(Math.min(1, edgeY / 0.45), 1.1) : 1;
      const row = y * Wp;
      for (let x = 0; x < Wp; x++) {
        const i = row + x;
        const shade = 1 - vig * (1 - Math.min(colShade[x], vy));
        f[i] *= Math.max(0, shade) * (src.cover[i] > 0 ? 1 : 0);
      }
    }
  }

  // ---- band-limit to the grid, last ----
  const limited = boxBlur(f, Wp, Hp, Math.max(1, Math.round((pitchMm * ctx.PPM) / 2)));
  clamp01(limited);
  return { field: limited, blackPoint: bp, whitePoint: wp, bandLoMm, bandHiMm };
}
