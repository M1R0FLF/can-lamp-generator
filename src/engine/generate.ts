import { FieldCtx, bandLimit } from './fieldkit';
import { getPreset } from './presets';
import { stipple, StippleParams, Hole, DEFAULT_STIPPLE } from './stipple';
import { computeMinWeb } from './minweb';
import { writeSvg } from './svg';
import {
  PhotoSource,
  PhotoParams,
  buildPhotoField,
} from './photo';
import { CustomShape, buildCustomField, CUSTOM_STIPPLE } from './customShapes';

/**
 * Presets are authored against a fixed reference height (matching the two
 * ported generators, which anchor content to absolute mm from H=142) rather
 * than the can the user actually asked for. Without this, a short can (say
 * 30mm) would just silently show whatever fraction of the artwork happens to
 * fall in y=0..30mm with no way to choose which part — the composition was
 * effectively cropped by accident. Building at the reference height and then
 * windowing down to the real height (via panY) turns that accident into a
 * control.
 */
export const DESIGN_HEIGHT_MM = 142;

/** Keep holes this far clear of the wall's top/bottom edge. */
const EDGE_MARGIN_MM = 0.3;

export interface CanSpec {
  diameterMm: number;
  heightMm: number;
  ppm: number;
  /** 0 keeps the bottom of the reference design, 1 keeps the top. Presets only. */
  panY?: number;
}

export type SourceSpec =
  | { kind: 'preset'; presetId: string }
  | { kind: 'photo'; source: PhotoSource; params: PhotoParams }
  | { kind: 'custom'; shapes: CustomShape[] };

export interface CropWindow {
  fromMm: number;
  toMm: number;
}

export interface GenerateResult {
  W: number;
  /** the physical can height — what `holes` and the SVG use */
  H: number;
  /** the height the design was authored at; > H when cropping is in play */
  designH: number;
  PPM: number;
  Wp: number;
  /** rows in `field`, which is always at designH */
  Hp: number;
  field: Float32Array;
  /** final holes, y in [0, H] — this is what gets exported */
  holes: Hole[];
  /** every hole at design height, y in [0, designH] — for the crop preview */
  designHoles: Hole[];
  pitch: number;
  rows: number;
  cols: number;
  minWeb: number;
  stipple: StippleParams;
  buildMs: number;
  sampleMs: number;
  /** null when the design fits the can exactly and nothing is cropped */
  cropWindow: CropWindow | null;
}

export function generate(
  can: CanSpec,
  source: SourceSpec,
  stippleOverrides: Partial<StippleParams> = {}
): GenerateResult {
  const W = Math.PI * can.diameterMm;
  const H = can.heightMm;
  const panY = Math.min(1, Math.max(0, can.panY ?? 0));

  const designStipple =
    source.kind === 'preset' ? getPreset(source.presetId).stipple :
    source.kind === 'custom' ? CUSTOM_STIPPLE : {};
  const params: StippleParams = { ...DEFAULT_STIPPLE, ...designStipple, ...stippleOverrides };

  // Presets are authored against DESIGN_HEIGHT_MM, at NATURAL PROPORTIONS.
  //
  //  H <= reference: build at the reference height and crop a window out of
  //    it (panY picks which) — a short can shows PART of the scene.
  //
  //  H  > reference: build at the real height. Presets anchor content in mm
  //    from the nearest edge, so the scene keeps its authored size and the
  //    extra height becomes extra sky/background.
  //
  // Do NOT scale the scene up to fill a taller can. That was tried: uniform
  // scaling by H/142 keeps circles circular but the circumference does not
  // grow with it, so the design becomes relatively WIDER — Escarcha's hero
  // went from ~50% to ~70% of the wrap at H=200 and the crystals crowded into
  // each other. Height and circumference are independent; only content added
  // vertically can fill extra height honestly.
  const designH = source.kind === 'preset' ? Math.max(H, DESIGN_HEIGHT_MM) : H;
  const ctx = new FieldCtx(W, designH, can.ppm);

  const t0 = performance.now();
  let field: Float32Array;
  if (source.kind === 'preset') {
    field = getPreset(source.presetId).build(ctx);
    // presets author their own tone structure; a light band-limit keeps
    // sub-grid detail from aliasing into the stipple (rule 6)
    field = bandLimit(field, ctx.Wp, ctx.Hp, params.pitchMm * 0.6, can.ppm);
  } else if (source.kind === 'custom') {
    field = buildCustomField(ctx, source.shapes);
    field = bandLimit(field, ctx.Wp, ctx.Hp, params.pitchMm * 0.6, can.ppm);
  } else {
    field = buildPhotoField(source.source, ctx, source.params, params.pitchMm).field;
  }
  const t1 = performance.now();

  // Sample once at design height, then window the resulting holes. Doing it
  // in this order (rather than cropping the field first) means the preview can
  // show the whole design with the discarded part greyed out, using the very
  // same holes that the kept window is taken from.
  const sampled = stipple(field, W, designH, ctx.Wp, ctx.Hp, can.ppm, params);
  const designHoles = sampled.holes;

  let holes: Hole[];
  let cropWindow: CropWindow | null = null;
  if (designH > H + 1e-6) {
    const fromMm = panY * (designH - H);
    const toMm = fromMm + H;
    cropWindow = { fromMm, toMm };
    holes = [];
    for (const h of designHoles) {
      const y = h.y - fromMm;
      if (y <= EDGE_MARGIN_MM || y >= H - EDGE_MARGIN_MM) continue;
      holes.push({ x: h.x, y, r: h.r });
    }
  } else {
    holes = designHoles;
  }

  const minWeb = computeMinWeb(holes, W, Math.max(sampled.pitch * 1.2, 0.5));
  const t2 = performance.now();

  return {
    W,
    H,
    designH,
    PPM: can.ppm,
    Wp: ctx.Wp,
    Hp: ctx.Hp,
    field,
    holes,
    designHoles,
    pitch: sampled.pitch,
    rows: sampled.rows,
    cols: sampled.cols,
    minWeb,
    stipple: params,
    buildMs: t1 - t0,
    sampleMs: t2 - t1,
    cropWindow,
  };
}

export function resultToSvg(r: GenerateResult, title: string): string {
  return writeSvg(r.holes, r.W, r.H, title);
}
