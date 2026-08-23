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
import { FieldCtx, boxBlur, clamp01 } from './fieldkit';

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
  /** large-radius unsharp = local contrast / "clarity". 0 = off */
  localContrast: number;
  /** radius of that local contrast, as a fraction of canvas width */
  localContrastRadius: number;
  /** quantise to N tone steps. 0 or 1 = off */
  posterize: number;
  /** add Sobel gradient magnitude so structure survives the low sample count */
  edgeBoost: number;
  /** darken toward the frame; also what makes the seam work in 'fade' mode */
  vignette: number;
  /** floor tone applied inside the image area, so mid-dark areas aren't dead */
  ambient: number;
}

export const DEFAULT_PLACEMENT: PhotoPlacement = {
  fit: 'cover',
  seam: 'fade',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  coverage: 0.82,
};

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
 * Lithophane-informed correction, quickly borrowed from a different craft
 * that solved a related problem. A lithophane maps luminance to material
 * THICKNESS, and thin/thick both transmit light non-linearly (Beer-Lambert);
 * our case is simpler because a hole is fully open or fully closed, so open-
 * area fraction already equals transmitted light fraction directly (linear).
 * But the photo's pixel values are NOT linear — a digital photo is
 * gamma-encoded (~2.2) so that equal steps LOOK equally spaced to a human
 * eye. Feeding that encoded value straight in as "fraction open" over-
 * brightens midtones: a nominal 50%-gray pixel wants to be perceived at
 * ~50% brightness, which requires physical transmission of roughly
 * 0.5^2.2 =~ 0.22, not 0.5. Net effect: backlit halftones read as too flat/
 * washed out in the midtones unless you push gamma well past what looks
 * right on an ordinary (non-backlit) print. Default bumped from a print-like
 * 1.1 to ~1.9 accordingly; still user-tunable since posterize/local contrast
 * interact with it.
 */
export const DEFAULT_PHOTO_PARAMS: PhotoParams = {
  invert: false,
  autoLevels: true,
  blackPoint: 0.04,
  whitePoint: 0.96,
  gamma: 1.9,
  localContrast: 0.45,
  localContrastRadius: 0.06,
  posterize: 6,
  // kept low by default: edge boost also amplifies background grain, which
  // shows up as stray specks around the subject
  edgeBoost: 0.1,
  vignette: 0.55,
  ambient: 0.0,
};

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
    // Rec.709 luma
    luma[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
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
    const r = Math.max(2, Math.round(params.localContrastRadius * Wp));
    const blurred = boxBlur(f, Wp, Hp, r, r);
    for (let i = 0; i < n; i++) {
      f[i] = f[i] + params.localContrast * (f[i] - blurred[i]);
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

  // --- gamma. Backlit media are perceived roughly as L^(1/2.2), so raising
  // this above 1 trades midtone lift for punch; 1.0-1.6 is the useful range. ---
  if (params.gamma !== 1) {
    for (let i = 0; i < n; i++) f[i] = Math.pow(f[i], params.gamma);
  }

  // --- posterize: the "dumb it down" step. Hard tone steps read far better
  // than a continuous ramp when you only have ~140x113 samples. ---
  if (params.posterize >= 2) {
    const steps = Math.round(params.posterize);
    for (let i = 0; i < n; i++) {
      f[i] = Math.round(f[i] * (steps - 1)) / (steps - 1);
    }
  }

  // --- edge boost: Sobel on the (already simplified) field. Outlines are what
  // survive downsampling, so a little goes a long way. ---
  if (params.edgeBoost > 0) {
    const soft = boxBlur(f, Wp, Hp, 1, 1);
    const edges = new Float32Array(n);
    const at = (col: number, row: number) => {
      const c = ((col % Wp) + Wp) % Wp;
      const r = row < 0 ? 0 : row >= Hp ? Hp - 1 : row;
      return soft[r * Wp + c];
    };
    let peak = 1e-6;
    for (let row = 0; row < Hp; row++) {
      for (let col = 0; col < Wp; col++) {
        const gx =
          -at(col - 1, row - 1) - 2 * at(col - 1, row) - at(col - 1, row + 1) +
          at(col + 1, row - 1) + 2 * at(col + 1, row) + at(col + 1, row + 1);
        const gy =
          -at(col - 1, row - 1) - 2 * at(col, row - 1) - at(col + 1, row - 1) +
          at(col - 1, row + 1) + 2 * at(col, row + 1) + at(col + 1, row + 1);
        const m = Math.hypot(gx, gy);
        edges[row * Wp + col] = m;
        if (m > peak) peak = m;
      }
    }
    for (let i = 0; i < n; i++) {
      f[i] = Math.min(1, f[i] + params.edgeBoost * (edges[i] / peak));
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
