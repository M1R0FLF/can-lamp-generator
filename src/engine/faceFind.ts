// Where is the face, and how should the can be framed around it?
//
// Framing is bandwidth here, not composition (see portrait.ts): how big the face
// lands decides whether the identity band falls where the sampler still has
// contrast to give. A fixed zoom got that right on average and clipped chins and
// crowns on individual photos, so the crop has to be derived from where the face
// actually is.
//
// ---------------------------------------------------------------------------
// Why a real detector, after trying not to use one
// ---------------------------------------------------------------------------
// The first attempt was dependency-free: skin-tone chroma mask, largest
// connected region, trim at the neck. It failed, and instructively. Drawn over
// the 12 test faces the boxes were nearly the whole frame, because skin chroma
// is not discriminative against a WARM BACKGROUND — a beige wall, brown wood or
// olive foliage all pass the same Cb/Cr test as a face, so the "largest region"
// merged face, neck and backdrop into one blob. Four of the twelve were
// full-frame. It is the kind of failure a confidence number computed from the
// same bad region cannot see, which is why the check was to draw the boxes.
//
// pico.js gets 12/12 with tight boxes in 10-19ms. It is a trained
// pixel-intensity-comparison cascade in ~200 lines, MIT, and the cascade asset
// is 234KB — fetched lazily, so a session that never loads a photo never pays
// for it.
import pico from '../vendor/pico.js';
import { PhotoPlacement } from './photo';

export interface FaceBox {
  /** the face proper — brows to chin, cheek to cheek. Source-image pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** the same face grown to include hair and jaw, for framing. Source pixels. */
  headX: number;
  headY: number;
  headW: number;
  headH: number;
  /** pico's detection score. Higher is stronger; see DETECT_FLOOR. */
  score: number;
}

/**
 * Minimum pico score to believe.
 *
 * Measured over the 12 test faces the scores ran 51.7 to 185.9, and pico's own
 * webcam demo uses 50. 30 sits below every true positive seen here with margin,
 * while still rejecting the low-scoring noise the cascade emits on textured
 * non-faces. A missed face is cheap (fall back to a fixed crop); a false
 * positive is expensive (the can gets framed on a doorknob).
 */
const DETECT_FLOOR = 30;

/**
 * Resolution the cascade runs at. A bounding box needs no more than this, and
 * cost is roughly linear in pixel count.
 */
const SCAN = 320;

/**
 * Face box -> head box. pico brackets the face itself, so hair and crown sit
 * OUTSIDE it; framing on the raw box scalps every portrait. Grown asymmetrically
 * because a head is not centred on its face: mostly upward for hair, a little
 * down for jaw and chin, a little out for ears.
 */
const HEAD_UP = 0.34;
const HEAD_DOWN = 0.14;
const HEAD_SIDE = 0.09;

let classifier: ((r: number, c: number, s: number, px: Uint8Array, ld: number) => number) | null = null;
let loading: Promise<void> | null = null;

/**
 * Fetch and unpack the cascade. Idempotent, and safe to call concurrently —
 * repeated calls share one in-flight promise rather than starting a second
 * 234KB download.
 */
export function loadFaceFinder(url = 'facefinder'): Promise<void> {
  if (classifier) return Promise.resolve();
  if (loading) return loading;
  loading = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`face cascade ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      classifier = pico.unpack_cascade(new Int8Array(buf));
    })
    .catch((e) => {
      // leave `classifier` null so callers fall back to a fixed crop; a failed
      // download must not break loading a photo
      loading = null;
      throw e;
    });
  return loading;
}

export function faceFinderReady(): boolean {
  return classifier !== null;
}

/** Strongest face in the image, or null. Requires loadFaceFinder() first. */
export function findFace(img: HTMLImageElement | ImageBitmap): FaceBox | null {
  if (!classifier || !img.width || !img.height) return null;
  const s = Math.min(1, SCAN / Math.max(img.width, img.height));
  const w = Math.max(24, Math.round(img.width * s));
  const h = Math.max(24, Math.round(img.height * s));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data;

  // pico wants 8-bit grey; these are its own demo's weights
  const gray = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    gray[p] = (2 * rgba[p * 4] + 7 * rgba[p * 4 + 1] + 1 * rgba[p * 4 + 2]) / 10;
  }

  let dets = pico.run_cascade(
    { pixels: gray, nrows: h, ncols: w, ldim: w },
    classifier,
    {
      shiftfactor: 0.1,
      // a face smaller than 12% of the frame is not the subject of a portrait,
      // and excluding it speeds the scan up considerably
      minsize: Math.round(Math.min(w, h) * 0.12),
      maxsize: Math.min(w, h),
      scalefactor: 1.1,
    }
  );
  dets = pico.cluster_detections(dets, 0.2);

  let best: number[] | null = null;
  for (const d of dets) {
    if (d[3] < DETECT_FLOOR) continue;
    if (!best || d[3] > best[3]) best = d;
  }
  if (!best) return null;

  // pico returns (row, col, scale, score) in the scanned image
  const [row, col, scale, score] = best;
  const inv = 1 / s;
  const size = scale * inv;
  const cx = col * inv;
  const cy = row * inv;
  const x = cx - size / 2;
  const y = cy - size / 2;

  return {
    x,
    y,
    w: size,
    h: size,
    headX: x - size * HEAD_SIDE,
    headY: y - size * HEAD_UP,
    headW: size * (1 + 2 * HEAD_SIDE),
    headH: size * (1 + HEAD_UP + HEAD_DOWN),
    score,
  };
}

/**
 * Where the face's vertical centre should sit on the wall, as a fraction of
 * height. Slightly above the middle: a portrait with the eyes a little high
 * reads as composed, dead-centre reads as a passport photo.
 */
const FACE_CENTRE_Y = 0.45;

/**
 * How much wider than the face the lit medallion should be. The face needs dark
 * ground around it to read as a figure, and the medallion must still fit inside
 * the visible front hemisphere — half the circumference — or the sides of the
 * face wrap out of sight.
 */
const MEDALLION_OVER_FACE = 1.7;

/**
 * Solve a placement that puts this face at a chosen fraction of the wall height,
 * centred on the front of the can.
 *
 * This inverts `sampleImage`'s placement arithmetic rather than guessing at
 * zoom and offsets. With `fit: 'cover'` that code draws the image at
 * `scaleFit * zoom` where `scaleFit = max(drawW/iw, Hp/ih)`, so asking for an
 * exact head height on the wall pins the total scale, and `zoom` is whatever
 * multiple of `scaleFit` produces it. The offsets then place the face centre.
 */
export function framingFor(
  box: FaceBox,
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  ppm: number,
  headHeightFrac: number
): PhotoPlacement {
  const Wp = Math.round(canvasW * ppm);
  const Hp = Math.round(canvasH * ppm);

  // Clamp the head box to the image. On a tightly-cropped portrait the grown
  // box runs off the top of the frame, and sizing to a box that is partly
  // outside the picture makes the visible content smaller than asked for.
  const hx0 = Math.max(0, box.headX);
  const hy0 = Math.max(0, box.headY);
  const hx1 = Math.min(imgW, box.headX + box.headW);
  const hy1 = Math.min(imgH, box.headY + box.headH);
  const headW = Math.max(1, hx1 - hx0);
  const headH = Math.max(1, hy1 - hy0);

  // medallion width from the head's aspect at the target height
  const scaleWanted = (headHeightFrac * Hp) / headH; // device px per source px
  const coverage = Math.min(
    0.7,
    Math.max(0.35, (headW * scaleWanted * MEDALLION_OVER_FACE) / Wp)
  );

  const targetW = Wp * coverage;
  const scaleFit = Math.max(targetW / imgW, Hp / imgH);
  // Never below 1. `scaleFit` is already the scale at which the image exactly
  // covers the medallion, so zoom < 1 would letterbox — and worse, it would
  // shrink the face, which is the one thing this whole pipeline exists to avoid.
  // If the head is already larger than the target, that is the good direction:
  // take it.
  const zoom = Math.min(6, Math.max(1, scaleWanted / scaleFit));

  // re-derive the actual scale after clamping, so the offsets stay consistent
  const s = scaleFit * zoom;
  const dw = imgW * s;
  const dh = imgH * s;
  const boxX = (Wp - targetW) / 2;

  // face centre in source px -> where we want it on the canvas
  const fcx = box.x + box.w / 2;
  const fcy = (hy0 + hy1) / 2;
  const offsetX = (Wp / 2 - fcx * s - boxX - (targetW - dw) / 2) / targetW;
  const offsetY = ((Hp - dh) / 2 + fcy * s - Hp * FACE_CENTRE_Y) / Hp;

  return {
    fit: 'cover',
    seam: 'fade',
    coverage,
    zoom,
    // clamped to the ranges the UI sliders expose, so a solved placement is
    // always one the user can then adjust by hand rather than a state they
    // cannot reproduce
    offsetX: Math.min(0.5, Math.max(-0.5, offsetX)),
    offsetY: Math.min(0.5, Math.max(-0.5, offsetY)),
  };
}

/** The face's width on the can in mm, for the identity-band filter scale. */
export function faceWidthOnCan(
  box: FaceBox,
  place: PhotoPlacement,
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  ppm: number
): number {
  const Wp = Math.round(canvasW * ppm);
  const Hp = Math.round(canvasH * ppm);
  const targetW = place.seam === 'fade' ? Wp * place.coverage : Wp;
  const scaleFit = Math.max(targetW / imgW, Hp / imgH);
  const s = scaleFit * place.zoom;
  return (box.w * s) / ppm;
}
