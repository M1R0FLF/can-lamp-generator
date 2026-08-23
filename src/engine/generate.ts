import { FieldCtx, bandLimit, clamp01 } from './fieldkit';
import { label as drawLabel } from './draw';
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

/**
 * A real through-cut for the LED strip's power cable — one clean circle, laser
 * traces only its border, nothing to do with the stippled pattern. Lives on
 * `CanSpec` rather than the design/source, because which physical can you're
 * holding is what decides whether it needs a wire hole at all, not which
 * pattern is on it.
 *
 * Front/back convention (new, and the reason this doesn't need a "which way
 * is front" setting): the flat design is authored to be VIEWED centred at
 * x = W/2, so the wall's horizontal centre is the front the viewer sees on a
 * shelf, and the seam at x = 0/W is the back. The hole sits a few mm off the
 * exact seam (not on it) so the cut never has to straddle the sheet's two
 * edges — see the placement comment in generate().
 */
export interface LedHoleSpec {
  enabled: boolean;
  diameterMm: number;
  /** distance from the hole's centre to the can's bottom edge */
  marginBottomMm: number;
}

export interface CanSpec {
  diameterMm: number;
  heightMm: number;
  ppm: number;
  /** 0 keeps the bottom of the reference design, 1 keeps the top. Presets only. */
  panY?: number;
  ledHole?: LedHoleSpec;
}

/**
 * A short user-supplied label (a name, a date) composited on top of whatever
 * source produced the field — preset or custom, doesn't matter, since this
 * runs after both. `xFrac` is a fraction of the circumference (rule 1: never
 * an absolute mm position). `yOffsetMm` is measured away from `yAnchor`
 * toward the can's centre (e.g. anchor 'bottom' + offset 10 sits 10mm up from
 * the bottom edge).
 */
export interface AnnotationSpec {
  text: string;
  xFrac: number;
  yAnchor: 'top' | 'center' | 'bottom';
  yOffsetMm: number;
  sizeMm: number;
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

/**
 * y (up-from-bottom mm, matching every draw primitive) for an anchor+offset
 * pair, measured in the PHYSICAL can's own height — not the preset reference
 * frame. So "bottom" means the bottom of the can the user actually has,
 * regardless of any 142mm-reference cropping going on underneath it.
 */
function anchoredY(H: number, anchor: AnnotationSpec['yAnchor'], offsetMm: number): number {
  if (anchor === 'top') return H - offsetMm;
  if (anchor === 'bottom') return offsetMm;
  return H / 2 + offsetMm;
}

/**
 * Composite a user label into the field, after whatever source built it.
 * Works identically for preset and custom sources since it runs after both.
 *
 * `cy` arrives already converted into design-space (see the `fromMm` comment
 * in generate()), so "bottom" lands on the physical can's bottom edge even
 * when a preset is being cropped out of its 142mm reference frame.
 */
function applyAnnotation(
  ctx: FieldCtx,
  field: Float32Array,
  a: AnnotationSpec,
  cy: number,
  pitchMm: number
): Float32Array {
  const cx = a.xFrac * ctx.W;
  const maxWidthMm = ctx.W * 0.9;
  let mask = ctx.mask((d) => drawLabel(d, a.text, cx, cy, a.sizeMm, maxWidthMm));
  // rule 6: band-limit before sampling, same as every other field layer
  mask = bandLimit(mask, ctx.Wp, ctx.Hp, pitchMm * 0.6, ctx.PPM);
  // rule 4: a bright shape needs a dark moat to read as a figure, not mush
  return clamp01(ctx.moat(field, mask, 3.0, 1.0));
}

export function generate(
  can: CanSpec,
  source: SourceSpec,
  stippleOverrides: Partial<StippleParams> = {},
  annotation?: AnnotationSpec
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
  // Where the kept H-tall window starts within the (possibly taller)
  // reference frame. Depends only on panY/designH/H, so it's known before a
  // single pixel is built — needed now so an annotation's "bottom" can target
  // the physical can's bottom edge rather than the reference frame's.
  const fromMm = designH > H + 1e-6 ? panY * (designH - H) : 0;

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
  if (annotation && annotation.text.trim()) {
    const cy = fromMm + anchoredY(H, annotation.yAnchor, annotation.yOffsetMm);
    field = applyAnnotation(ctx, field, annotation, cy, params.pitchMm);
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

  // Rule 2/CLAUDE.md: measured from the real stippled pattern only. The LED
  // hole is added below, AFTER this — it's a single deliberate through-cut,
  // not a stipple-tension concern, and its center-to-edge "distance" to
  // itself would otherwise register as a large negative min-web and paint
  // the readout red for no real reason.
  const minWeb = computeMinWeb(holes, W, Math.max(sampled.pitch * 1.2, 0.5));
  const t2 = performance.now();

  if (can.ledHole?.enabled) {
    const r = can.ledHole.diameterMm / 2;
    // A few mm off the exact seam, not on it — so the cut is a single circle
    // wholly within one edge of the flat sheet rather than needing to
    // straddle x=0/x=W as two matching half-moons. "Back" only needs to be
    // unambiguously away from the front (x=W/2); it doesn't need to be the
    // mathematically exact opposite point.
    const holeX = Math.min(6, W * 0.05);
    const holeYInH = Math.max(r + 0.3, H - can.ledHole.marginBottomMm);
    holes.push({ x: holeX, y: holeYInH, r });
    // holes === designHoles by reference when there's no crop window (see the
    // branch above), so that case is already covered by the push above.
    if (cropWindow) {
      designHoles.push({ x: holeX, y: cropWindow.fromMm + holeYInH, r });
    }
  }

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
